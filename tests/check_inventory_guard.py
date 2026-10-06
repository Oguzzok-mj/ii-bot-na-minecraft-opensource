from pathlib import Path
from argparse import Namespace
from copy import deepcopy
from tempfile import TemporaryDirectory
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import main

class Game:
    blocked=False
    def __init__(self,*a,**kw):
        self.calls=[]
        self.value={'health':20,'food':20,'emptySlots':2,'inventory':{'iron_ingot':24},'windowType':'inventory','controls':[],
                    'armor':{'head':'iron_helmet','torso':'iron_chestplate','legs':'iron_leggings','feet':'iron_boots'}}
        Game.last=self
    def wait_ready(self):return deepcopy(self.value)
    def request(self,command,**kw):
        self.calls.append((command,kw))
        if command=='home_deposit':
            assert kw['archive'] and kw['reserve']['iron_ingot']==24
            if not self.blocked:self.value['emptySlots']=16
            return {'deposited':{},'remaining':0}
        if command=='state':return deepcopy(self.value)
        return True
    def close(self):self.calls.append(('close',{}))

original,folder=main.Minecraft,main.ROOT
try:
    with TemporaryDirectory() as directory:
        main.ROOT=Path(directory)
        (main.ROOT/'data').mkdir()
        main.Minecraft=Game
        args=Namespace(command='iron',model=folder/'models/demo.npz',home={'x':0,'y':64,'z':0})
        for blocked in (False,True):
            Game.blocked=blocked
            try:
                result=main.mission(args)
                assert not blocked and result['emptySlots']==16
            except RuntimeError as error:
                assert blocked and 'Инвентарь заполнен' in str(error)
            assert any(c=='home_deposit' for c,_ in Game.last.calls)
            assert not any(c in ('act','mine_resource','mine_iron') for c,_ in Game.last.calls)
            assert Game.last.calls[-1][0]=='close'
finally:
    main.Minecraft,main.ROOT=original,folder
print('PASS: nearly full inventory triggers safe home archive with crafting reserves; full chests stop mining without item loss')
