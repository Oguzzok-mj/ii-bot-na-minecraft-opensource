import time

ENCHANTMENTS = {'efficiency': 5, 'fortune': 3, 'unbreaking': 3}
ARMOR = {'head': 'helmet', 'torso': 'chestplate', 'legs': 'leggings', 'feet': 'boots'}
TOOLS = ('pickaxe', 'axe', 'shovel', 'sword')


def enchanted_pickaxe(current, material=None):
    for item in current.get('tools', []):
        if item['name'] not in ('diamond_pickaxe', 'netherite_pickaxe'):
            continue
        if material and item['name'] != material:
            continue
        enchants = {entry['name']: entry['lvl'] for entry in item.get('enchants', [])}
        if all(enchants.get(name, 0) >= level for name, level in ENCHANTMENTS.items()):
            return True
    return False


def full_netherite(current):
    return all(current.get('armor', {}).get(slot) == 'netherite_' + suffix for slot, suffix in ARMOR.items()) and all(
        current.get('inventory', {}).get('netherite_' + suffix, 0) for suffix in TOOLS)


class Development:
    def __init__(self, game, args, announce, state, stop_event=None):
        self.game, self.args, self.announce, self.state, self.stop = game, args, announce, state, stop_event
        self.repairing = False
        self.last_home = -float('inf')
        self.args.active_reserve = {'diamond': 49, 'coal': 16, 'lapis_lazuli': 3, 'iron_ingot': 3,
                                    'raw_iron': 3, 'gold_ingot': 32, 'gold_nugget': 288,
                                    'ancient_debris': 32, 'netherite_scrap': 32, 'netherite_ingot': 8}

    def checked(self):
        current = self.state()
        if current['health'] <= 8:
            raise RuntimeError('Развитие остановлено: здоровье ниже безопасного уровня.')
        if current['food'] <= 6:
            raise RuntimeError('Нужна еда перед дальнейшей добычей и дорогой в Незер.')
        if any(enemy['distance'] < 5 for enemy in current.get('threats', [])):
            raise RuntimeError('Рядом враждебный моб; развитие остановлено в безопасном режиме.')
        return current

    def gather(self, resource, enough, dimension=None, limit=None):
        failures = 0
        for step in range(limit or self.args.steps):
            current = self.checked()
            if enough(current):
                return current
            if current.get('emptySlots', 36) <= 4:
                self.home()
                current = self.checked()
                if current.get('emptySlots', 36) <= 4:
                    raise RuntimeError('Инвентарь заполнен: нужны свободные сундуки на базе.')
            if dimension and current.get('dimension') != dimension:
                self.game.request('enter_portal')
                current = self.checked()
                if current.get('dimension') != dimension:
                    raise RuntimeError(f'Для {resource} нужно измерение {dimension}.')
            if resource not in ('wood', 'flint') and not self.repairing:
                picks=[tool for tool in current.get('tools',[]) if tool['name'] in ('diamond_pickaxe','netherite_pickaxe') and not any(e['name']=='silk_touch' for e in tool.get('enchants',[]))]
                if not any(tool['remaining']>=64 for tool in picks):
                    self.repairing = True
                    try:
                        from auto_development import AutoDevelopment
                        reserve = self.args.active_reserve
                        preparation = AutoDevelopment(self.game, self.args, self.announce, self.state, self.stop)
                        self.args.active_reserve = reserve
                        preparation.prepare_pick(3)
                    finally:
                        self.repairing = False
                    continue
            self.announce(f'{resource} · шаг {step + 1} · уровень {current.get("level", 0)}')
            try:
                self.game.request('mine_resource', resource=resource)
                failures = 0
            except RuntimeError as error:
                failures += 1
                print(error, flush=True)
                if failures >= 12:
                    raise RuntimeError(f'Нет безопасного пути к {resource}; можно продолжить после перемещения бота.') from error
        raise RuntimeError(f'Лимит поиска {resource} достигнут. Повторный запуск продолжит задачу.')

    def home(self):
        current = self.checked()
        p, home = current.get('position'), self.args.home
        if p and current.get('dimension') in ('overworld', 'minecraft:overworld') and sum((p[a]-home[a])**2 for a in 'xyz') <= 64 and current.get('emptySlots', 36) > 7 and time.monotonic()-self.last_home < 30:
            return
        self.announce('Возвращаюсь к рабочим столам на базе')
        self.game.request('home_deposit', home=self.args.home, reserve=self.args.active_reserve, archive=True)
        self.game.request('home_withdraw', items=self.args.active_reserve, food=16)
        self.checked()
        self.last_home = time.monotonic()

    def craft(self, item, amount=1):
        self.game.request('place_table', local=True)
        self.game.request('craft', item=item, count=amount)

    def smelt(self, resource, output, amount):
        self.gather('coal', lambda s: s['inventory'].get('coal', 0) + s['inventory'].get('charcoal', 0) >= (amount + 7)//8,
                    'overworld' if self.state().get('dimension') == 'overworld' else None)
        self.game.request('place_table', local=True)
        self.game.request('place_furnace')
        self.game.request('smelt_start', resource=resource, count=amount)
        deadline = time.monotonic() + max(120, amount*15)
        try:
            while self.checked()['inventory'].get(output, 0) < amount:
                result = self.game.request('smelt_tick')
                if result['output'] >= amount:
                    break
                if not result['input'] or time.monotonic() > deadline:
                    raise RuntimeError(f'Плавка {resource} остановилась: проверь сырьё и топливо.')
                if self.stop:
                    if self.stop.wait(2):
                        raise InterruptedError('Остановлено пользователем.')
                else:
                    time.sleep(2)
        finally:
            self.game.request('furnace_close')

    def enchant(self):
        if enchanted_pickaxe(self.checked()):
            return
        self.home()
        def prepare_picks():
            plain = sum(item['name'] == 'diamond_pickaxe' and item['remaining'] >= 64 and not item.get('enchants') for item in self.state()['tools'])
            missing = max(0, 2-plain)
            if not missing:
                return
            self.gather('diamond', lambda s: s['inventory'].get('diamond', 0) >= missing*3+3, 'overworld')
            self.home()
            if self.state()['inventory'].get('stick', 0) < missing*2:
                self.craft('stick', (missing*2-self.state()['inventory'].get('stick', 0)+3)//4)
            self.craft('diamond_pickaxe', missing)
        for attempt in range(32):
            prepare_picks()
            self.experience(30)
            self.gather('lapis', lambda s: s['inventory'].get('lapis_lazuli', 0) >= 3, 'overworld')
            self.home()
            try:
                result = self.game.request('combine_pickaxes')
                if result.get('complete'):
                    self.announce('Кирка: эффективность V, удача III, прочность III')
                    return
            except RuntimeError as error:
                print(error, flush=True)
            if self.checked().get('level', 0) < 30:
                continue
            prepare_picks()
            self.announce(f'Зачарование кирки · попытка {attempt + 1}')
            self.game.request('enchant_pickaxe')
            if enchanted_pickaxe(self.checked()):
                return
        raise RuntimeError('Целевые зачарования пока не получены. Запусти снова: готовые кирки сохраняются.')

    def experience(self, level):
        resource, failures = 'coal', 0
        for step in range(max(6000, self.args.steps)):
            current = self.checked()
            if current.get('level', 0) >= level:
                return
            if step % 12 == 0:
                choice = self.game.request('xp_resource')
                resource = choice.get('resource', 'coal')
                self.announce(f'Опыт {current.get("level", 0)}/{level} · {resource}')
            if current.get('emptySlots', 36) <= 7:
                self.home()
            try:
                self.game.request('mine_resource', resource=resource)
                failures = 0
            except RuntimeError as error:
                failures += 1
                if failures >= 8:
                    raise RuntimeError(f'Не удалось безопасно набрать опыт: {error}') from error
                resource = 'coal'
        raise RuntimeError('Лимит набора опыта достигнут; полученный опыт сохранён.')

    def portal(self):
        self.args.active_reserve['obsidian'] = 14
        self.home()
        if self.game.request('portal_status').get('lit'):
            self.args.active_reserve.pop('obsidian', None)
            return
        if self.state()['inventory'].get('obsidian', 0) < 14:
            from auto_development import AutoDevelopment
            reserve = self.args.active_reserve
            preparation = AutoDevelopment(self.game, self.args, self.announce, self.state, self.stop)
            self.args.active_reserve = reserve
            preparation.prepare('obsidian', 3)
        self.gather('obsidian', lambda s: s['inventory'].get('obsidian', 0) >= 14, 'overworld')
        needed_iron = 2 if self.state()['inventory'].get('flint_and_steel', 0) else 3
        if self.state()['inventory'].get('iron_ingot', 0) < needed_iron:
            self.gather('iron', lambda s: s['inventory'].get('raw_iron', 0) + s['inventory'].get('iron_ingot', 0) >= needed_iron, 'overworld')
            self.smelt('iron', 'iron_ingot', needed_iron)
        if not self.state()['inventory'].get('flint_and_steel', 0):
            self.gather('flint', lambda s: s['inventory'].get('flint', 0) >= 1, 'overworld')
            self.craft('flint_and_steel')
        self.home()
        result = self.game.request('build_portal', home=self.args.home)
        if not result.get('lit'):
            raise RuntimeError('Рама портала готова; для активации нужно огниво.')
        self.args.active_reserve.pop('obsidian', None)

    def netherite(self):
        if full_netherite(self.checked()) and enchanted_pickaxe(self.state(), 'netherite_pickaxe'):
            return self.state()
        self.home()
        self.game.request('find_template')
        self.enchant()
        current = self.state()
        upgrades = sum(current['armor'].get(slot) != 'netherite_' + suffix for slot,suffix in ARMOR.items()) + sum(
            not current['inventory'].get('netherite_' + suffix, 0) for suffix in TOOLS if suffix != 'pickaxe') + int(not enchanted_pickaxe(current, 'netherite_pickaxe'))
        ingots_needed = max(0, upgrades-current['inventory'].get('netherite_ingot', 0))
        raw_needed = ingots_needed*4
        self.args.active_reserve.update({'ancient_debris':raw_needed,'netherite_scrap':raw_needed,'gold_ingot':raw_needed,'gold_nugget':raw_needed*9,'netherite_ingot':upgrades})
        templates = current['inventory'].get('netherite_upgrade_smithing_template', 0)
        extra = max(0, upgrades-max(templates, 1))*7
        self.args.active_reserve['diamond'] = max(3,extra)
        self.gather('diamond', lambda s: s['inventory'].get('diamond', 0) >= extra, 'overworld')
        self.gather('coal', lambda s: s['inventory'].get('coal', 0) >= 16, 'overworld')
        self.gather('wood', lambda s: sum(n*(4 if name.endswith(('_log', '_stem')) else 1) for name,n in s['inventory'].items() if name.endswith(('_log','_stem','_planks'))) >= 24, 'overworld')
        for name, amount in list(self.state()['inventory'].items()):
            if name.endswith(('_log', '_stem')):
                while amount:
                    batch = min(8, amount)
                    self.craft(name.removeprefix('stripped_').rsplit('_', 1)[0] + '_planks', batch)
                    amount -= batch
        if self.state()['inventory'].get('iron_ingot', 0) < 2:
            self.gather('iron', lambda s: s['inventory'].get('raw_iron', 0)+s['inventory'].get('iron_ingot', 0) >= 2, 'overworld')
            self.smelt('iron', 'iron_ingot', 2)
        self.portal()
        self.gather('ancient_debris', lambda s: s['inventory'].get('ancient_debris', 0)+s['inventory'].get('netherite_scrap', 0) >= raw_needed, 'the_nether')
        self.gather('gold', lambda s: s['inventory'].get('gold_ingot', 0)*9+s['inventory'].get('gold_nugget', 0) >= raw_needed*9, 'the_nether')
        while self.state()['inventory'].get('gold_ingot', 0) < raw_needed:
            self.craft('gold_ingot', min(8, raw_needed-self.state()['inventory'].get('gold_ingot', 0)))
        if not self.state()['inventory'].get('netherite_upgrade_smithing_template', 0):
            self.announce('Проверяю доступные сундуки на шаблон улучшения')
            found = self.game.request('find_template')
            if not found.get('found'):
                raise RuntimeError('Шаблон улучшения не найден: положи его в сундук на базе.')
        copies = max(0, upgrades-self.state()['inventory'].get('netherite_upgrade_smithing_template', 0))
        if copies:
            self.gather('netherrack', lambda s: s['inventory'].get('netherrack', 0) >= copies, 'the_nether')
        self.args.active_reserve['netherrack'] = copies
        self.home()
        if self.state()['inventory'].get('netherite_scrap', 0) < raw_needed:
            self.smelt('ancient_debris', 'netherite_scrap', raw_needed)
        while self.state()['inventory'].get('netherite_ingot', 0) < upgrades:
            self.craft('netherite_ingot', min(8, upgrades-self.state()['inventory'].get('netherite_ingot', 0)))
        while self.state()['inventory'].get('netherite_upgrade_smithing_template', 0) < upgrades:
            self.craft('netherite_upgrade_smithing_template')
        self.home()
        self.game.request('place_table', local=True)
        self.game.request('place_workbench', item='smithing_table')
        for slot, suffix in ARMOR.items():
            if self.state()['armor'].get(slot) != 'netherite_' + suffix:
                self.game.request('smith_upgrade', item='diamond_' + suffix)
                self.game.request('equip', item='netherite_' + suffix, destination=slot)
        for suffix in TOOLS:
            if not self.state()['inventory'].get('netherite_' + suffix, 0) or suffix == 'pickaxe' and not enchanted_pickaxe(self.state(), 'netherite_pickaxe'):
                self.game.request('smith_upgrade', item='diamond_' + suffix)
        self.game.request('equip', item='netherite_pickaxe')
        final = self.checked()
        if not full_netherite(final) or not enchanted_pickaxe(final, 'netherite_pickaxe'):
            raise RuntimeError('Сервер не подтвердил полный незеритовый комплект.')
        return final
