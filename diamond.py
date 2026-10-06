import time

ARMOR = {"head": ("diamond_helmet", 5), "torso": ("diamond_chestplate", 8),
         "legs": ("diamond_leggings", 7), "feet": ("diamond_boots", 4)}
TOOLS = {"diamond_pickaxe": 3, "diamond_axe": 3, "diamond_shovel": 1, "diamond_sword": 2}


def missing_diamonds(current):
    items = current["inventory"]
    return sum(cost for slot, (item, cost) in ARMOR.items()
               if current["armor"].get(slot) not in (item, item.replace('diamond_', 'netherite_')) and not items.get(item, 0) and not items.get(item.replace('diamond_', 'netherite_'), 0)) + sum(
        cost for item, cost in TOOLS.items() if not items.get(item, 0) and not items.get(item.replace('diamond_', 'netherite_'), 0))


def full_diamond(current):
    return missing_diamonds(current) == 0 and all(current["armor"].get(slot) in (item, item.replace('diamond_', 'netherite_'))
                                               for slot, (item, _) in ARMOR.items())


def diamond_stage(game, args, announce, state, stop_event=None):
    def craft(item, count=1):
        game.request("craft", item=item, count=count)
    def local_table():
        game.request("place_table", local=True)
    def pack_table():
        game.request("pack_table")
    def supplies():
        items = state()["inventory"]
        if (sum(n for name, n in items.items() if name.endswith("_planks")) < 4 and not items.get("crafting_table", 0)) or items.get("stick", 0) < 8:
            announce("Пополнение досок и палок")
            mine("wood", lambda s: sum(n * (4 if name.endswith(("_log", "_stem")) else 1)
                 for name, n in s["inventory"].items() if name.endswith(("_log", "_stem", "_planks"))) >= 24)
            for name, count in list(state()["inventory"].items()):
                if name.endswith(("_log", "_stem")):
                    while count:
                        craft(name.removeprefix("stripped_").rsplit("_", 1)[0] + "_planks", min(count, 8))
                        count -= min(count, 8)
            if state()["inventory"].get("stick", 0) < 12:
                craft("stick", (12-state()["inventory"].get("stick", 0)+3)//4)
    def mine(resource, enough):
        failures = 0
        for step in range(args.steps):
            current = state()
            if enough(current):
                return
            try:
                game.request("mine_resource", resource=resource)
                failures = 0
            except RuntimeError as error:
                print(error, flush=True)
                failures += 1
                if failures >= 12:
                    raise RuntimeError(f"Нет безопасного пути к руде {resource}. Можно разгрузиться или продолжить позже.") from error
        raise RuntimeError("Лимит шагов достигнут. Повторный запуск продолжит по текущему инвентарю.")
    if full_diamond(state()):
        return state()
    def prepare_pickaxe():
        if any(tool['name'] in ('iron_pickaxe','diamond_pickaxe','netherite_pickaxe') and tool['remaining'] >= 16 for tool in state()['tools']):
            return
        supplies()
        announce("Запасная железная кирка для добычи алмазов")
        try:
            game.request("furnace_recover")
        except RuntimeError as error:
            print(error, flush=True)
        if state()["inventory"].get("iron_ingot", 0) < 3:
            mine("iron", lambda s: sum(s["inventory"].get(n, 0) for n in ("raw_iron", "iron_ore", "deepslate_iron_ore", "iron_ingot")) >= 3)
            mine("coal", lambda s: s["inventory"].get("coal", 0)+s["inventory"].get("charcoal", 0) >= 2)
            local_table()
            game.request("place_furnace")
            game.request("smelt_start", count=3-state()["inventory"].get("iron_ingot", 0))
            deadline = time.monotonic()+120
            try:
                while game.request("smelt_tick")["ingots"] < 3:
                    if time.monotonic() > deadline:
                        raise RuntimeError("Не удалось выплавить железо для кирки.")
                    if stop_event:
                        if stop_event.wait(2):
                            raise InterruptedError("Остановлено пользователем.")
                    else:
                        time.sleep(2)
            finally:
                game.request("furnace_close")
        local_table()
        if state()["inventory"].get("stick", 0) < 2:
            craft("stick")
        craft("iron_pickaxe")
        pack_table()
    supplies()
    prepare_pickaxe()
    failures = 0
    for step in range(args.steps):
        supplies()
        current = state()
        needed = missing_diamonds(current)
        amount = current["inventory"].get("diamond", 0)
        if amount >= needed:
            break
        if amount >= 3 and not any(current["inventory"].get(name,0) for name in ('diamond_pickaxe','netherite_pickaxe')):
            local_table()
            if state()["inventory"].get("stick", 0) < 2:
                craft("stick")
            craft("diamond_pickaxe")
            pack_table()
            continue
        prepare_pickaxe()
        announce(f"Алмазы: {amount}/{needed} · цель броня + 4 инструмента · Y {current['position']['y']:.0f}")
        try:
            game.request("mine_resource", resource="diamond")
            failures = 0
        except RuntimeError as error:
            print(error, flush=True)
            failures += 1
            if failures >= 12:
                raise RuntimeError("Не удалось пройти к алмазам безопасно. Повторный запуск продолжит задачу.") from error
    else:
        raise RuntimeError("Лимит поиска алмазов достигнут. Запусти снова для продолжения.")
    for _ in range(32):
        if not game.request('collect_loot').get('handled'):
            break
    else:
        raise RuntimeError('Сначала нужно завершить подбор выпавшей руды; повторный запуск продолжит его.')
    announce("Крафт алмазной брони и инструментов")
    local_table()
    for destination, (item, _) in ARMOR.items():
        if state()["armor"].get(destination) not in (item, item.replace('diamond_', 'netherite_')):
            upgraded = item.replace('diamond_', 'netherite_')
            if state()["inventory"].get(upgraded, 0):
                game.request('equip', item=upgraded, destination=destination)
                continue
            if not state()["inventory"].get(item, 0):
                craft(item)
            game.request("equip", item=item, destination=destination)
    needed_sticks = sum(1 if name.endswith("sword") else 2 for name in TOOLS if not state()["inventory"].get(name, 0) and not state()["inventory"].get(name.replace('diamond_', 'netherite_'), 0))
    if state()["inventory"].get("stick", 0) < needed_sticks:
        craft("stick", (needed_sticks-state()["inventory"].get("stick", 0)+3)//4)
    for item in TOOLS:
        if not state()["inventory"].get(item, 0) and not state()["inventory"].get(item.replace('diamond_', 'netherite_'), 0):
            craft(item)
    game.request("equip", item="netherite_pickaxe" if state()['inventory'].get('netherite_pickaxe', 0) else "diamond_pickaxe")
    final = state()
    if not full_diamond(final):
        raise RuntimeError("Сервер не подтвердил полный алмазный комплект.")
    return final
