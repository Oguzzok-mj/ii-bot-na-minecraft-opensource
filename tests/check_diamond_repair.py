from pathlib import Path
from argparse import Namespace
from copy import deepcopy
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from diamond import diamond_stage,full_diamond

class Game:
    def __init__(self):
        self.calls=[]
        self.value={'inventory':{'iron_ingot':3,'stick':12,'birch_planks':24,'diamond_pickaxe':1,'diamond_axe':1,'diamond_shovel':1,'stone_pickaxe':1},
                    'armor':{'head':'netherite_helmet','torso':'diamond_chestplate','legs':'diamond_leggings','feet':'diamond_boots'},
                    'tools':[{'name':'diamond_pickaxe','remaining':5},{'name':'stone_pickaxe','remaining':131}], 'position':{'y':-40}}
    def request(self,command,**kw):
        self.calls.append((command,kw))
        inv=self.value['inventory']
        if command=='collect_loot':
            return {'handled':False,'pending':None}
        if command=='craft':
            if kw['item']=='iron_pickaxe':
                inv['iron_ingot']-=3;inv['stick']-=2;inv['iron_pickaxe']=1
                self.value['tools'].append({'name':'iron_pickaxe','remaining':250})
            elif kw['item']=='diamond_sword':
                inv['diamond']-=2;inv['stick']-=1;inv['diamond_sword']=1
        elif command=='mine_resource':
            assert kw['resource']=='diamond'
            assert any(t['name']=='iron_pickaxe' and t['remaining']>=16 for t in self.value['tools'])
            inv['diamond']=2
        return True
game=Game()
result=diamond_stage(game,Namespace(steps=10),lambda text:None,lambda:deepcopy(game.value))
assert full_diamond(result)
assert result['armor']['head']=='netherite_helmet'
assert sum(c=='craft' and kw['item']=='iron_pickaxe' for c,kw in game.calls)==1
assert not any(c=='craft' and kw['item']=='stone_pickaxe' for c,kw in game.calls)
print('PASS: stone durability cannot hide a worn diamond pickaxe; usable iron replacement created before diamonds; upgraded armor retained')
