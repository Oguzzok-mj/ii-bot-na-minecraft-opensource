from argparse import Namespace
from copy import deepcopy
from pathlib import Path
import sys
import threading
import tempfile
import json
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from mining_job import run

class Game:
    def __init__(self):
        self.value={'inventory':{'diamond':20},'tools':[{'name':'netherite_pickaxe','remaining':1900}], 'health':20,'food':20,'dimension':'overworld','emptySlots':20,'controls':[],'pendingLoot':None}
        self.mines=0;self.deposits=0;self.calls=[]
    def request(self,command,**kwargs):
        self.calls.append(command)
        if command=='state':return deepcopy(self.value)
        if command=='mine_resource':
            assert kwargs['resource']=='diamond'
            self.mines+=1;self.value['inventory']['diamond']+=32
            if self.mines==2:self.value['emptySlots']=4
        if command=='home_deposit':
            self.deposits+=1;self.value['inventory']['diamond']=0;self.value['emptySlots']=20
            return {'done':True,'remaining':0}
        return True

args=Namespace(resource='diamond',stacks=2,steps=20,home={'x':0,'y':64,'z':0},mining_callback=lambda p:progress.append(p))
progress=[];game=Game()
result=run(game,args,lambda text:None)
assert result['gathered']==128 and result['target']==128 and result['status']=='done'
assert game.mines==4 and game.deposits==2
assert game.value['inventory']['diamond']==0
assert 'returning' in [item['status'] for item in progress]
assert game.calls[-2:]==['home_deposit','state']
assert progress[-1]['gathered']==128
args.stacks=0
try:run(game,args,lambda text:None)
except ValueError:pass
else:raise AssertionError('invalid stack quantity')
args.stacks=1;args.resource='ancient_debris'
try:run(game,args,lambda text:None)
except RuntimeError as error:assert 'Незере' in str(error)
else:raise AssertionError('Wrong dimension')
args.resource='diamond';stop=threading.Event();stop.set()
try:run(game,args,lambda text:None,stop)
except InterruptedError:pass
else:raise AssertionError('Stop ignored')
assert progress[-1]['status']=='stopped'
args.resource='diamond';args.stacks=1
game=Game();original=game.request
def pending_drop(command,**kwargs):
    if command=='mine_resource':
        game.mines+=1
        game.value['inventory']['diamond']+=64
        game.value['pendingLoot']={'wanted':['diamond']}
        return True
    if command=='collect_loot':
        game.value['inventory']['diamond']+=3
        game.value['pendingLoot']=None
        game.calls.append(command)
        return {'handled':True,'pending':None}
    return original(command,**kwargs)
game.request=pending_drop
result=run(game,args,lambda text:None)
assert result['gathered']==67 and game.mines==1 and game.deposits==1
assert game.value['inventory']['diamond']==0 and 'collect_loot' in game.calls
args.resource='diamond';args.stacks=2
game=Game();game.value['emptySlots']=7;game.value['inventory']['birch_planks']=7
original=game.request
def checked(command,**kwargs):
    if command=='mine_resource':assert game.value['emptySlots']>7, 'Legacy chest cache would run before unload'
    return original(command,**kwargs)
game.request=checked
result=run(game,args,lambda text:None)
assert result['gathered']==128 and game.deposits==3

with tempfile.TemporaryDirectory() as folder:
    args.mining_job_path=Path(folder)/'mining-job.json'
    args.host='127.0.0.1';args.port=25565;args.username='NeuroFarmer'
    game=Game();game.value['inventory']['diamond']=7
    args.mining_job_path.write_text(json.dumps({'resource':'diamond','stacks':2,'target':128,'gathered':7,'inventory_amount':7,'status':'error','identity':{'host':args.host,'port':args.port,'username':args.username}}),encoding='utf-8')
    result=run(game,args,lambda text:None)
    assert result['gathered']==135 and game.mines==4
    saved=json.loads(args.mining_job_path.read_text(encoding='utf-8'))
    assert saved['gathered']==135 and saved['status']=='done'
    result=run(Game(),args,lambda text:None)
    assert result['gathered']==128, 'Completed job must start a fresh quota'
    args.mining_job_path.write_text('{bad',encoding='utf-8')
    result=run(Game(),args,lambda text:None)
    assert result['gathered']==128
    original_replace=Path.replace
    locked=[0]
    def transient_lock(path,target):
        if locked[0]<2:
            locked[0]+=1
            raise PermissionError('Windows temporary sharing violation')
        return original_replace(path,target)
    with patch.object(Path,'replace',autospec=True,side_effect=transient_lock),patch('mining_job.time.sleep'):
        result=run(Game(),args,lambda text:None)
    assert result['gathered']==128 and locked[0]==2
    assert json.loads(args.mining_job_path.read_text(encoding='utf-8'))['status']=='done'

    job={'resource':'diamond','stacks':2,'target':128,'gathered':129,'inventory_amount':47,'status':'returning','identity':{'host':args.host,'port':args.port,'username':args.username}}
    args.mining_job_path.write_text(json.dumps(job),encoding='utf-8')
    game=Game();game.value['inventory']['diamond']=47;game.value['tools']=[]
    result=run(game,args,lambda text:None)
    assert result['gathered']==129 and game.mines==0 and game.deposits==1 and game.value['inventory']['diamond']==0

    args.mining_job_path.write_text(json.dumps(job),encoding='utf-8')
    game=Game();game.value['inventory']['diamond']=47
    original=game.request
    def full_chests(command,**kwargs):
        if command=='home_deposit':return {'done':True,'remaining':47}
        return original(command,**kwargs)
    game.request=full_chests
    try:run(game,args,lambda text:None)
    except RuntimeError as error:assert 'Не все выбранные ресурсы' in str(error)
    else:raise AssertionError('Full chests must not complete delivery')
    assert game.mines==0 and game.value['inventory']['diamond']==47
    assert progress[-1]['status']=='error' and progress[-1]['gathered']==129
    game.request=original
    result=run(game,args,lambda text:None)
    assert result['status']=='done' and result['gathered']==129 and game.mines==0

    args.mining_job_path.write_text(json.dumps(job),encoding='utf-8')
    game=Game();game.value['inventory']['diamond']=47
    original=game.request
    def failed_route(command,**kwargs):
        if command=='home_deposit':raise RuntimeError('Безопасный путь домой не найден')
        return original(command,**kwargs)
    game.request=failed_route
    try:run(game,args,lambda text:None)
    except RuntimeError as error:assert 'путь домой' in str(error)
    else:raise AssertionError('Failed return must remain unfinished')
    assert json.loads(args.mining_job_path.read_text(encoding='utf-8'))['status']=='error' and game.mines==0
    del args.mining_job_path

game=Game();attempts=[]
original=game.request
def broken(command,**kwargs):
    if command=='mine_resource':
        attempts.append(command)
        raise RuntimeError('Недостаточно материалов: chest')
    return original(command,**kwargs)
game.request=broken
try:run(game,args,lambda text:None)
except RuntimeError as error:assert str(error)=='Недостаточно материалов: chest'
else:raise AssertionError('Permanent materials failure ignored')
assert len(attempts)==1 and progress[-1]['message']=='Недостаточно материалов: chest'
print('PASS: 2 stacks means 128 newly collected items; existing holdings excluded; unload retains quota progress; target stops mining; validation, dimension and cancellation')
print('PASS: 7 free slots with insufficient chest planks unload before mining; resumable progress survives relaunch; concrete permanent error retained without 8 instant retries')
print('PASS: goal triggers return and confirmed storage before completion; collected count retained; unfinished return resumes without mining or a pick; full chests and route failure never complete the job')
