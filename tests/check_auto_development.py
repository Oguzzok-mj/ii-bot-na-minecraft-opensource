from argparse import Namespace
from copy import deepcopy
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from auto_development import AutoDevelopment,good_pick
from mining_job import run

class Game:
    def __init__(self):
        self.calls=[]
        self.value={'health':20,'food':20,'level':22,'dimension':'overworld','position':{'x':0,'y':64,'z':0},'emptySlots':20,'pendingLoot':None,
            'inventory':{'diamond_pickaxe':1,'stick':4,'birch_planks':8,'coal':1,'cobblestone':32},
            'tools':[{'name':'diamond_pickaxe','remaining':1500,'enchants':[]}],
            'armor':{s:'iron_'+n for s,n in [('head','helmet'),('torso','chestplate'),('legs','leggings'),('feet','boots')]}}
    def request(self,command,**kw):
        self.calls.append((command,kw));inv=self.value['inventory']
        if command=='state':return deepcopy(self.value)
        if command=='mine_resource':
            assert kw['resource']=='iron'
            inv['raw_iron']=6
        if command=='smelt_start':
            assert inv['raw_iron']>=kw['count']
            inv['raw_iron']-=kw['count'];inv['iron_ingot']=inv.get('iron_ingot',0)+kw['count']
            return {'input':0,'output':inv['iron_ingot']}
        if command=='craft':
            item,n=kw['item'],kw['count']
            if item=='bucket':inv['iron_ingot']-=3*n;inv['bucket']=inv.get('bucket',0)+n
            elif item=='diamond_pickaxe':
                assert inv['diamond']>=3*n and inv['stick']>=2*n
                inv['diamond']-=3*n;inv['stick']-=2*n;inv[item]=inv.get(item,0)+n
                self.value['tools'].append({'name':item,'remaining':1561,'enchants':[]})
            elif item=='birch_planks':inv['birch_log']-=n;inv['birch_planks']=inv.get('birch_planks',0)+4*n
            elif item=='stick':inv['birch_planks']-=2*n;inv['stick']=inv.get('stick',0)+4*n
            elif item=='netherite_ingot':inv['netherite_scrap']-=4*n;inv['gold_ingot']-=4*n;inv[item]=n
            else:
                cost={'diamond_helmet':5,'diamond_boots':4}[item]
                assert inv['diamond']>=cost
                inv['diamond']-=cost;inv[item]=1
        if command=='equip':
            self.value['armor'][kw['destination']]=kw['item'];inv.pop(kw['item'])
        if command=='enchant_pickaxe':
            self.value['tools'][0]['enchants']=[{'name':'efficiency','lvl':4},{'name':'fortune','lvl':3},{'name':'unbreaking','lvl':3}]
            self.value['level']-=3;inv['lapis_lazuli']-=3
        if command=='combine_pickaxes':return {'complete':False}
        if command=='smith_upgrade':
            assert kw['item']=='diamond_pickaxe'
            inv['netherite_ingot']-=1;inv['netherite_upgrade_smithing_template']-=1
            inv.pop('diamond_pickaxe');inv['netherite_pickaxe']=1
            self.value['tools'][0]['name']='netherite_pickaxe'
        if command=='home_deposit':return {'done':True,'remaining':0}
        return True

args=Namespace(steps=100,home={'x':0,'y':64,'z':0})
game=Game();dev=AutoDevelopment(game,args,lambda _:None,lambda:deepcopy(game.value))
dev.prepare('obsidian',3)
assert game.value['inventory']['bucket']==2
assert any(c=='mine_resource' and k['resource']=='iron' for c,k in game.calls)
assert any(c=='smelt_start' for c,k in game.calls)
assert good_pick(game.value,3)
print('PASS: obsidian job autonomously mines iron, smelts it and crafts both buckets')

game=Game();game.value['inventory']={'diamond':3,'birch_log':1,'diamond_pickaxe':1}
game.value['tools'][0]['remaining']=5
dev=AutoDevelopment(game,args,lambda _:None,lambda:deepcopy(game.value));dev.prepare_pick(3)
assert good_pick(game.value,3) and game.value['inventory']['diamond']==0
assert not any(c=='mine_resource' for c,k in game.calls)
print('PASS: worn tool is replaced using existing materials, without unnecessary mining')

game=Game();game.value['inventory']['diamond']=12
game.value['armor'].update(torso='diamond_chestplate',legs='diamond_leggings')
dev=AutoDevelopment(game,args,lambda _:None,lambda:deepcopy(game.value));dev.service('diamond',2)
assert game.value['inventory']['diamond']==3
assert game.value['armor']['head']=='diamond_helmet' and game.value['armor']['feet']=='diamond_boots'
game=Game();game.value['level']=30
game.value['inventory'].update(lapis_lazuli=3,netherite_upgrade_smithing_template=1,netherite_scrap=4,gold_ingot=4)
dev=AutoDevelopment(game,args,lambda _:None,lambda:deepcopy(game.value));dev.service('diamond',2)
assert game.value['tools'][0]['name']=='netherite_pickaxe'
assert any(e['name']=='fortune' and e['lvl']==3 for e in game.value['tools'][0]['enchants'])
assert any(c=='enchant_pickaxe' for c,k in game.calls) and any(c=='smith_upgrade' for c,k in game.calls)
assert game.value['inventory']['netherite_upgrade_smithing_template']==0
print('PASS: available diamonds upgrade armor; XP/lapis enchant the pick; smithing retains enchantments')

class QuotaGame(Game):
    def request(self,command,**kw):
        if command=='mine_resource':self.value['inventory']['diamond']+=64;return True
        if command=='home_deposit':self.value['inventory']['diamond']=0;return {'done':True,'remaining':0}
        return super().request(command,**kw)
class Maintenance:
    def __init__(self,game,args,*unused):self.game=game;args.active_reserve={'diamond':3}
    def prepare(self,*unused):self.game.value['inventory']['diamond']=7
    def service(self,*unused):self.game.value['inventory']['diamond']+=9
game=QuotaGame();quota=Namespace(resource='diamond',stacks=1,steps=20,home=args.home,auto_develop=True)
with patch('auto_development.AutoDevelopment',Maintenance):
    result=run(game,quota,lambda _:None)
assert result['gathered']==64 and result['status']=='done'
assert game.value['inventory']['diamond']==0
print('PASS: maintenance/chest supplies never inflate the quota; final return still deposits all chosen resources')

game=Game();game.value['level']=29
original=game.request
def xp(command,**kwargs):
    if command=='xp_resource':return {'resource':'redstone','score':4.5}
    if command=='mine_resource':
        assert kwargs['resource']=='redstone'
        game.value['level']=30
        return True
    return original(command,**kwargs)
game.request=xp
dev=AutoDevelopment(game,args,lambda _:None,lambda:deepcopy(game.value))
dev.dev.experience(30)
assert game.value['level']==30
print('PASS: experience training follows the available XP target and stops at the required level')

game=Game();game.value['level']=30
game.value['armor']={s:'diamond_'+n for s,n in [('head','helmet'),('torso','chestplate'),('legs','leggings'),('feet','boots')]}
game.value['inventory'].update(diamond_axe=1,diamond_shovel=1,diamond_sword=1)
dev=AutoDevelopment(game,args,lambda _:None,lambda:deepcopy(game.value))
reserve=args.active_reserve.copy()
with patch('endgame.Development.netherite',return_value=game.value) as advancement:
    dev.service('diamond',2)
    advancement.assert_called_once()
assert args.active_reserve==reserve
print('PASS: full diamond gear and sufficient XP automatically start the complete enchantment/netherite goal; mining reserve is restored')
