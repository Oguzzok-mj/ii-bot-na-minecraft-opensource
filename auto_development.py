import math
import time

from endgame import ARMOR, Development, enchanted_pickaxe, full_netherite
from diamond import full_diamond

MATERIALS = ('wooden', 'stone', 'iron', 'diamond', 'netherite')
RESERVE = {'diamond': 3, 'iron_ingot': 6, 'raw_iron': 6, 'coal': 4, 'lapis_lazuli': 3,
           'gold_ingot': 4, 'netherite_scrap': 4, 'netherite_ingot': 1, 'netherite_upgrade_smithing_template': 1}


def good_pick(current, tier, durability=64):
    return any(tool['name'] in [material + '_pickaxe' for material in MATERIALS[tier:]]
               and tool['remaining'] >= durability and not any(e['name'] == 'silk_touch' for e in tool.get('enchants', [])) for tool in current.get('tools', []))


class AutoDevelopment:
    def __init__(self, game, args, announce, state, stop_event=None):
        self.game, self.args, self.announce, self.state = game, args, announce, state
        self.dev = Development(game, args, announce, state, stop_event)
        self.args.active_reserve = RESERVE.copy()
        self.last_service = -math.inf
        self.last_full_goal = -math.inf

    def home(self, requested=None):
        current = self.dev.checked()
        p, home = current.get('position'), self.args.home
        if not p or current.get('dimension') not in ('overworld', 'minecraft:overworld') or math.dist(tuple(p[a] for a in 'xyz'), tuple(home[a] for a in 'xyz')) > 8:
            self.game.request('home_deposit', home=home, reserve=self.args.active_reserve, archive=True)
        self.game.request('home_withdraw', items=requested or {}, food=8)

    def gather(self, resource, enough):
        previous = self.dev.repairing
        self.dev.repairing = True
        try:
            return self.dev.gather(resource, enough, 'overworld')
        finally:
            self.dev.repairing = previous

    def planks(self, amount):
        total = lambda s: sum(n for name, n in s['inventory'].items() if name.endswith('_planks'))
        if total(self.state()) >= amount:
            return
        self.gather('wood', lambda s: total(s) + sum(n * 4 for name, n in s['inventory'].items() if name.endswith(('_log', '_stem'))) >= amount)
        for name, n in list(self.state()['inventory'].items()):
            if n and name.endswith(('_log', '_stem')) and total(self.state()) < amount:
                self.dev.craft(name.removeprefix('stripped_').rsplit('_', 1)[0] + '_planks', min(n, 8, (amount-total(self.state())+3)//4))

    def sticks(self, amount=2):
        current = self.dev.checked()
        if current['inventory'].get('stick', 0) >= amount:
            return
        self.planks(2 * max(1, (amount-current['inventory'].get('stick', 0)+3)//4))
        self.dev.craft('stick', max(1, (amount - self.state()['inventory'].get('stick', 0) + 3) // 4))

    def iron(self, amount):
        if self.dev.checked()['inventory'].get('iron_ingot', 0) >= amount:
            return
        self.gather('iron', lambda s: sum(s['inventory'].get(name, 0) for name in ('iron_ingot', 'raw_iron', 'iron_ore', 'deepslate_iron_ore')) >= amount)
        self.gather('coal', lambda s: s['inventory'].get('coal', 0) + s['inventory'].get('charcoal', 0) >= (amount + 7) // 8)
        self.home()
        self.dev.smelt('iron', 'iron_ingot', amount)

    def prepare_pick(self, tier):
        current = self.dev.checked()
        if good_pick(current, tier):
            return
        self.announce('Авторазвитие · восстанавливаю рабочую кирку')
        self.home({'diamond_pickaxe': 1, 'iron_pickaxe': 1, 'diamond': 3, 'iron_ingot': 3, 'stick': 2, 'coal': 1})
        current = self.dev.checked()
        if good_pick(current, tier):
            return
        self.sticks()
        if current['inventory'].get('diamond', 0) >= 3:
            self.dev.craft('diamond_pickaxe')
        else:
            if not good_pick(self.state(), 1):
                if not good_pick(self.state(), 0):
                    self.planks(7)
                    self.dev.craft('wooden_pickaxe')
                self.gather('stone', lambda s: s['inventory'].get('cobblestone', 0) + s['inventory'].get('cobbled_deepslate', 0) >= 3)
                self.sticks()
                self.dev.craft('stone_pickaxe')
            if tier >= 2 and not good_pick(self.state(), 2):
                self.iron(3)
                self.sticks()
                self.dev.craft('iron_pickaxe')
            if tier >= 3 and not good_pick(self.state(), 3):
                self.gather('diamond', lambda s: s['inventory'].get('diamond', 0) >= 3)
                self.home()
                self.sticks()
                self.dev.craft('diamond_pickaxe')
        if not good_pick(self.dev.checked(), tier):
            raise RuntimeError('Авторазвитие не смогло восстановить подходящую кирку.')

    def prepare(self, resource, tier):
        self.prepare_pick(tier)
        if resource == 'obsidian':
            current = self.dev.checked()
            total = lambda s: sum(s['inventory'].get(name, 0) for name in ('bucket', 'water_bucket', 'lava_bucket'))
            if total(current) < 2:
                self.announce('Авторазвитие · добываю железо и делаю вёдра для обсидиана')
                self.home({'bucket': 2, 'water_bucket': 1, 'lava_bucket': 1, 'iron_ingot': 6})
                missing = max(0, 2 - total(self.state()))
                if missing:
                    self.iron(missing * 3)
                    self.dev.craft('bucket', missing)
                if total(self.dev.checked()) < 2:
                    raise RuntimeError('Сервер не подтвердил создание двух вёдер.')

    def service(self, resource, tier):
        current = self.dev.checked()
        if current.get('pendingLoot'):
            return
        if not good_pick(current, tier, 32):
            self.prepare_pick(tier)
            current = self.dev.checked()
        if time.monotonic() - self.last_service < 30:
            return
        self.last_service = time.monotonic()
        p, home = current.get('position'), self.args.home
        if not p or current.get('dimension') not in ('overworld', 'minecraft:overworld') or math.dist(tuple(p[a] for a in 'xyz'), tuple(home[a] for a in 'xyz')) > 8:
            return
        inventory = current['inventory']
        targets = [('head', 'diamond_helmet', 5), ('torso', 'diamond_chestplate', 8), ('legs', 'diamond_leggings', 7), ('feet', 'diamond_boots', 4)]
        for slot, item, cost in targets:
            equipped = current.get('armor', {}).get(slot) or ''
            if equipped.startswith(('diamond_', 'netherite_')):
                continue
            if inventory.get(item, 0):
                self.game.request('equip', item=item, destination=slot)
            elif inventory.get('diamond', 0) >= cost + 3:
                self.dev.craft(item)
                self.game.request('equip', item=item, destination=slot)
            current = self.dev.checked();inventory = current['inventory']
        if not good_pick(current, 3) and inventory.get('diamond', 0) >= 3:
            self.sticks();self.dev.craft('diamond_pickaxe')
            current = self.dev.checked();inventory = current['inventory']
        if full_diamond(current) and (current.get('level', 0) >= 30 or enchanted_pickaxe(current)) and not (full_netherite(current) and enchanted_pickaxe(current, 'netherite_pickaxe')) and time.monotonic()-self.last_full_goal >= 300:
            self.last_full_goal = time.monotonic()
            reserve = self.args.active_reserve
            self.announce('Авторазвитие · целевые зачарования, портал и незеритовое снаряжение')
            try:
                Development(self.game, self.args, self.announce, self.state, self.dev.stop).netherite()
            except RuntimeError as error:
                self.announce(f'Развитие приостановлено: {error}')
            finally:
                self.args.active_reserve = reserve
            self.dev.checked()
            return
        if current.get('level', 0) >= 30 and inventory.get('lapis_lazuli', 0) >= 3 and not enchanted_pickaxe(current):
            plain = any(t['name'] == 'diamond_pickaxe' and t['remaining'] >= 64 and not t.get('enchants') for t in current.get('tools', []))
            if plain:
                self.announce('Авторазвитие · зачаровываю кирку')
                try:
                    self.game.request('enchant_pickaxe')
                    self.game.request('combine_pickaxes')
                except RuntimeError as error:
                    self.announce(f'Зачарование: {error}')
        current = self.dev.checked();inventory = current['inventory']
        if inventory.get('netherite_upgrade_smithing_template', 0):
            if not inventory.get('netherite_ingot', 0) and inventory.get('netherite_scrap', 0) >= 4 and inventory.get('gold_ingot', 0) >= 4:
                self.dev.craft('netherite_ingot')
                inventory = self.dev.checked()['inventory']
            if inventory.get('netherite_ingot', 0):
                target = next((item for item in ('diamond_pickaxe', 'diamond_axe', 'diamond_shovel', 'diamond_sword') if inventory.get(item, 0) and not inventory.get(item.replace('diamond_', 'netherite_'), 0)), None)
                slot = None
                if not target:
                    slot = next((slot for slot in ARMOR if current.get('armor', {}).get(slot) == 'diamond_' + ARMOR[slot]), None)
                    target = 'diamond_' + ARMOR[slot] if slot else None
                if target:
                    self.announce(f'Авторазвитие · незеритовое улучшение {target}')
                    self.game.request('place_workbench', item='smithing_table')
                    self.game.request('smith_upgrade', item=target)
                    if slot:
                        self.game.request('equip', item=target.replace('diamond_', 'netherite_'), destination=slot)
