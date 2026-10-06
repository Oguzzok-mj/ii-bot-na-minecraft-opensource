import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from unittest.mock import patch
from argparse import Namespace
from copy import deepcopy

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from qwen_planner import QwenPlanner, validate_choice
from mining_job import run

candidates = [{'id': 'safe-vein'}]
assert validate_choice('{"target_id":"safe-vein"}', candidates) == 'safe-vein'
for value in ['{}', '[]', 'null', '{"target_id":"unknown"}', '{"target_id":0}', '{"target_id":"safe-vein","command":"kill"}', '<think>test</think>{"target_id":"safe-vein"}']:
    try:
        validate_choice(value, candidates)
    except (ValueError, TypeError):
        pass
    else:
        raise AssertionError('Invalid decision accepted: ' + value)
with tempfile.TemporaryDirectory() as folder:
    planner = QwenPlanner(folder, announce=lambda _: None)
    try:
        planner.start()
    except RuntimeError as error:
        assert 'Qwen' in str(error)
    else:
        raise AssertionError('Missing model must stop instead of pretending to infer')
    planner.stop_event.set()
    try:
        planner.choose({'candidates': candidates})
    except InterruptedError:
        pass
    else:
        raise AssertionError('Stopped planner executed inference')

class Game:
    def __init__(self):
        self.value = {'inventory': {'diamond': 0}, 'tools': [{'name': 'diamond_pickaxe', 'remaining': 1000}],
                      'health': 20, 'food': 20, 'dimension': 'overworld', 'emptySlots': 30, 'controls': [], 'pendingLoot': None}
        self.calls = []

    def request(self, command, **kwargs):
        self.calls.append(command)
        if command == 'state':
            return deepcopy(self.value)
        if command == 'mining_candidates':
            return {'resource': kwargs['resource'], 'candidates': candidates}
        if command == 'mining_select':
            assert kwargs['target_id'] == 'safe-vein'
            return {'accepted': True}
        if command == 'mine_resource':
            assert self.calls[-2] == 'mining_select'
            self.value['inventory']['diamond'] += 64
        if command == 'home_deposit':
            self.value['inventory']['diamond'] = 0
            return {'done': True}
        return True

class Planner:
    closed = False
    decisions = 0
    def __init__(self, *args):
        pass
    def choose(self, observation):
        assert observation['remaining'] == 64
        self.decisions += 1
        return 'safe-vein'
    def close(self):
        Planner.closed = True

args = Namespace(resource='diamond', stacks=1, steps=10, home={'x': 0, 'y': 69, 'z': 0}, planner='qwen')
with patch('qwen_planner.QwenPlanner', Planner):
    game = Game()
    result = run(game, args, lambda _: None)
    assert result['status'] == 'done' and result['gathered'] == 64
    assert game.calls.count('mine_resource') == 1 and Planner.closed
    assert result['planner']['decisions'] == 1
with patch('qwen_planner.QwenPlanner', Planner), patch.object(Planner, 'choose', side_effect=RuntimeError('Qwen: invalid output')):
    game = Game()
    try:
        run(game, args, lambda _: None)
    except RuntimeError:
        pass
    else:
        raise AssertionError('Broken Qwen silently replaced with scripted mining')
    assert 'mine_resource' not in game.calls
print('PASS: strict Qwen decisions, missing model, stop, executed choice, quota/home completion, no silent fallback')
