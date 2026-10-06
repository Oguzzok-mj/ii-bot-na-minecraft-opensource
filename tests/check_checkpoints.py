from pathlib import Path
import queue
import json
from types import SimpleNamespace
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from main import Minecraft
game=Minecraft.__new__(Minecraft)
game.messages=queue.Queue()
checkpoint={'inventory':{'diamond':3},'miningTrail':{'overworld':[{'x':1,'y':20,'z':3}]}}
game.process=SimpleNamespace(stdout=iter([json.dumps({'checkpoint':checkpoint}),json.dumps({'id':7,'result':True})]))
game._read()
assert game.last_state==checkpoint
assert game.messages.get_nowait()=={'id':7,'result':True}
assert 'error' in game.messages.get_nowait()
assert game.messages.empty()
print('PASS: background checkpoint retains live route during long actions without entering the request-response queue')
