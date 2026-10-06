from pathlib import Path
from argparse import Namespace
from copy import deepcopy
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from endgame import Development, ENCHANTMENTS, full_netherite, enchanted_pickaxe

class Game:
    def __init__(self):
        self.calls=[]
        self.value={'health':20,'food':20,'level':30,'dimension':'overworld','emptySlots':20,
                    'armor':{'head':'diamond_helmet','torso':'diamond_chestplate','legs':'diamond_leggings','feet':'diamond_boots'},
                    'inventory':{'netherite_upgrade_smithing_template':8,'coal':16,'birch_planks':24,'iron_ingot':2,
                                 'ancient_debris':32,'gold_ingot':32,'diamond_pickaxe':1,'diamond_axe':1,'diamond_shovel':1,'diamond_sword':1},
                    'tools':[{'name':'diamond_pickaxe','remaining':1500,'enchants':[{'name':n,'lvl':l} for n,l in ENCHANTMENTS.items()]}]}
    def request(self,command,**kw):
        self.calls.append((command,kw,self.value['dimension']))
        inv=self.value['inventory']
        if command=='home_deposit': self.value['dimension']='overworld'
        elif command=='find_template': return {'found':True,'count':inv['netherite_upgrade_smithing_template']}
        elif command=='portal_status': return {'lit':True}
        elif command=='smelt_start':
            assert self.value['dimension']=='overworld'
            amount=inv.pop('ancient_debris',0)
            inv['netherite_scrap']=inv.get('netherite_scrap',0)+amount
        elif command=='craft' and kw['item']=='netherite_ingot':
            amount=kw['count']
            assert inv['netherite_scrap']>=4*amount and inv['gold_ingot']>=4*amount
            inv['netherite_scrap']-=amount*4;inv['gold_ingot']-=amount*4
            inv['netherite_ingot']=inv.get('netherite_ingot',0)+amount
        elif command=='smith_upgrade':
            assert inv['netherite_upgrade_smithing_template']>0 and inv['netherite_ingot']>0
            inv['netherite_upgrade_smithing_template']-=1;inv['netherite_ingot']-=1
            item=kw['item'].replace('diamond_','netherite_')
            inv[item]=1
            if kw['item']=='diamond_pickaxe':self.value['tools'][0]['name']=item
        elif command=='equip' and kw.get('destination'):
            self.value['armor'][kw['destination']]=kw['item'];inv.pop(kw['item'])
        elif command in ('enter_portal','mine_resource'):
            raise AssertionError('Existing materials must not cause a new Nether trip')
        return True

game=Game()
args=Namespace(steps=100,home={'x':0,'y':64,'z':0})
dev=Development(game,args,lambda text:None,lambda:deepcopy(game.value))
result=dev.netherite()
assert full_netherite(result) and enchanted_pickaxe(result,'netherite_pickaxe')
assert sum(cmd=='smith_upgrade' for cmd,_,_ in game.calls)==8
assert game.value['inventory']['netherite_upgrade_smithing_template']==0
assert game.value['inventory']['netherite_ingot']==0
assert any(cmd=='home_deposit' for cmd,_,_ in game.calls[:next(i for i,(cmd,_,_) in enumerate(game.calls) if cmd=='smelt_start')])
print('PASS: existing debris and gold used without unnecessary Nether trip; home furnaces, 8 templates/ingots, full enchanted netherite gear')

class RepairGame(Game):
    def __init__(self):
        super().__init__()
        self.value['inventory']={'diamond':3,'birch_log':1}
        self.value['tools']=[{'name':'diamond_pickaxe','remaining':5,'enchants':[]}]
    def request(self,command,**kw):
        self.calls.append((command,kw,self.value['dimension']))
        inv=self.value['inventory']
        if command=='craft':
            if kw['item']=='birch_planks':inv['birch_log']-=1;inv['birch_planks']=4
            elif kw['item']=='stick':inv['birch_planks']-=2;inv['stick']=4
            elif kw['item']=='diamond_pickaxe':
                inv['diamond']-=3;inv['stick']-=2
                self.value['tools'].append({'name':'diamond_pickaxe','remaining':1561,'enchants':[]})
        elif command=='mine_resource':
            assert kw['resource']=='coal'
            assert any(t['remaining']>=64 for t in self.value['tools'])
            inv['coal']=1
        return True

repair=RepairGame()
dev=Development(repair,args,lambda text:None,lambda:deepcopy(repair.value))
dev.gather('coal',lambda s:s['inventory'].get('coal',0)>=1,limit=10)
assert repair.value['inventory']['coal']==1
assert repair.value['inventory']['birch_log']==0
assert not dev.repairing
print('PASS: worn pickaxe replaced before continued mining; logs converted to planks and sticks; recursion guard cleared')

class PortalGame(Game):
    def __init__(self):
        super().__init__()
        self.value['inventory'].update(obsidian=14, flint_and_steel=1)
    def request(self, command, **kw):
        if command=='portal_status':return {'lit':False}
        if command=='home_deposit':
            assert kw['reserve']['obsidian']==14
            self.value['inventory']['obsidian']=min(self.value['inventory']['obsidian'],kw['reserve']['obsidian'])
        if command=='build_portal':
            assert self.value['inventory']['obsidian']==14
            self.value['inventory']['obsidian']=0
            return {'lit':True}
        return super().request(command,**kw)

portal=PortalGame()
dev=Development(portal,args,lambda text:None,lambda:deepcopy(portal.value))
dev.portal()
assert 'obsidian' not in args.active_reserve
print('PASS: portal construction retains its 14 obsidian during home storage; reserve released after construction')
