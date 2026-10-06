from copy import deepcopy
from pathlib import Path
import sys
sys.stdout.reconfigure(encoding='utf-8')

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from progression import full_iron, iron_stage

expected = {'head':'iron_helmet','torso':'iron_chestplate','legs':'iron_leggings','feet':'iron_boots'}
assert full_iron({'armor':expected})
assert not full_iron({'inventory':dict.fromkeys(expected.values(),1),'armor':{}})
assert not full_iron({'armor':{**expected,'head':'golden_helmet'}})

class Game:
    def __init__(self, reject_equipment=False):
        self.value={'inventory':{'iron_ingot':24},'armor':{},'tools':[]}
        self.calls=[]
        self.reject_equipment=reject_equipment
    def request(self, command, **kwargs):
        self.calls.append((command,kwargs))
        if command=='craft':
            prices={'iron_helmet':5,'iron_chestplate':8,'iron_leggings':7,'iron_boots':4}
            self.value['inventory']['iron_ingot']-=prices[kwargs['item']]
            assert self.value['inventory']['iron_ingot']>=0
            self.value['inventory'][kwargs['item']]=1
        if command=='equip' and not self.reject_equipment:
            self.value['armor'][kwargs['destination']]=kwargs['item']
            del self.value['inventory'][kwargs['item']]

for rejected in (False,True):
    game=Game(rejected)
    try:
        final=iron_stage(game,None,None,lambda text:None,lambda:deepcopy(game.value),root)
        assert not rejected and full_iron(final)
        assert game.value['inventory']['iron_ingot']==0
        assert not any(command in ('mine_iron','smelt_start','act') for command,_ in game.calls)
    except RuntimeError as error:
        assert rejected and 'Сервер не подтвердил' in str(error)
print('PASS: inventory armor is insufficient; all four slots required; 24 ingots craft and equip; rejected equipment prevents success.')

game=Game()
game.value['armor']['head']='iron_helmet'
game.value['inventory']['iron_ingot']=19
final=iron_stage(game,None,None,lambda text:None,lambda:deepcopy(game.value),root)
assert full_iron(final)
assert sum(command=='craft' for command,_ in game.calls)==3
assert game.value['inventory']['iron_ingot']==0
print('PASS: equipped helmet resumes with 19 ingots and only three crafts.')
game=Game()
game.value['armor']['head']='netherite_helmet'
game.value['inventory']['iron_ingot']=11
game.value['inventory']['diamond_chestplate']=1
final=iron_stage(game,None,None,lambda text:None,lambda:deepcopy(game.value),root)
assert final['armor']['head']=='netherite_helmet'
assert final['armor']['torso']=='diamond_chestplate'
assert game.value['inventory']['iron_ingot']==0
assert sum(command=='craft' for command,_ in game.calls)==2
print('PASS: mixed upgraded armor retained; stronger carried armor equipped without duplicate iron crafting')
