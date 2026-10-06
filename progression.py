import time

ARMOR = {"head": ("iron_helmet", 5), "torso": ("iron_chestplate", 8),
         "legs": ("iron_leggings", 7), "feet": ("iron_boots", 4)}


def full_iron(state):
    return all(state.get("armor", {}).get(slot) in (item, item.replace('iron_', 'diamond_'), item.replace('iron_', 'netherite_'))
               for slot, (item, _) in ARMOR.items())


def iron_stage(game, args, brain, announce, state, root, stop_event=None):
    def inventory():
        return state()["inventory"]
    def craft(item, amount=1):
        print(f"Крафт: {item}", flush=True)
        game.request("craft", item=item, count=amount)
    def missing_cost():
        current = state()
        return sum(cost for slot, (item, cost) in ARMOR.items()
                   if current["armor"].get(slot) not in (item, item.replace('iron_', 'diamond_'), item.replace('iron_', 'netherite_'))
                   and not any(current["inventory"].get(name, 0) for name in (item, item.replace('iron_', 'diamond_'), item.replace('iron_', 'netherite_'))))
    def gather_stone(wanted):
        for step in range(args.steps):
            items = inventory()
            amount = items.get("cobblestone", 0) + items.get("cobbled_deepslate", 0)
            if amount >= wanted:
                return
            game.request("mine_stone")
        raise RuntimeError("Не удалось собрать камень для печи и запасных кирок.")
    def prepare_pickaxe():
        current = state()
        remaining = sum(tool["remaining"] for tool in current["tools"] if tool["name"] in ("stone_pickaxe", "iron_pickaxe"))
        if remaining >= 40:
            return
        game.request("place_table", local=True)
        if inventory().get("stick", 0) < 2:
            craft("stick")
        craft("stone_pickaxe")
    current = state()
    if full_iron(current):
        return current
    required = missing_cost()
    if inventory().get("iron_ingot", 0) < required:
        game.request("furnace_recover")
    if inventory().get("iron_ingot", 0) < required:
        announce("Подготовка топлива и запасных кирок")
        failures = 0
        for step in range(args.steps):
            items = inventory()
            planks = sum(amount for name, amount in items.items() if name.endswith("_planks"))
            logs = sum(amount for name, amount in items.items() if name.endswith(("_log", "_stem")))
            if planks + logs * 4 >= (24 if items.get("furnace", 0) else 48):
                break
            result = game.request("act", action=brain.predict(state()))
            failures = failures + 1 if not result["ok"] else 0
            if failures >= 10:
                raise RuntimeError("Не удалось собрать дерево для топлива.")
        else:
            raise RuntimeError("Лимит сбора топлива достигнут.")
        while True:
            items = inventory()
            log = next((name for name in items if name.endswith(("_log", "_stem"))), None)
            if not log:
                break
            craft(log.removeprefix("stripped_").rsplit("_", 1)[0] + "_planks", min(items[log], 8))
        if not inventory().get("crafting_table", 0):
            craft("crafting_table")
        game.request("place_table", local=True)
        stone_needed = (0 if inventory().get("furnace", 0) else 8) + 9
        gather_stone(stone_needed)
        game.request("place_table", local=True)
        if inventory().get("stick", 0) < 12:
            craft("stick", (12 - inventory().get("stick", 0) + 3) // 4)
        for _ in range(max(0, 3 - inventory().get("stone_pickaxe", 0))):
            craft("stone_pickaxe")
        if not inventory().get("furnace", 0):
            craft("furnace")
        if not inventory().get("crafting_table", 0):
            craft("crafting_table")
        announce("Добыча железа")
        failures = 0
        for step in range(args.steps):
            items = inventory()
            raw = sum(items.get(name, 0) for name in ("raw_iron", "iron_ore", "deepslate_iron_ore"))
            needed = max(0, missing_cost() - items.get("iron_ingot", 0))
            if raw >= needed:
                break
            prepare_pickaxe()
            print(f"Железо {raw}/{needed} · шаг {step + 1}", flush=True)
            try:
                game.request("mine_iron")
                failures = 0
            except RuntimeError as error:
                print(str(error), flush=True)
                failures += 1
                if failures >= 12:
                    raise RuntimeError("Не удалось найти безопасный проход к железу.") from error
        else:
            raise RuntimeError("Лимит добычи железа достигнут. Запусти задачу снова для продолжения.")
        game.request("place_table", local=True)
        game.request("place_furnace")
        announce("Плавка железа в печи")
        needed = missing_cost()
        deadline = time.monotonic() + 900
        progress_deadline = time.monotonic() + 45
        last = inventory().get("iron_ingot", 0)
        game.request("smelt_start", count=max(1, needed-last))
        while inventory().get("iron_ingot", 0) < needed:
            if stop_event:
                if stop_event.wait(2):
                    raise InterruptedError("Остановлено пользователем.")
            else:
                time.sleep(2)
            current = game.request("smelt_tick")
            gained = current["ingots"]
            if gained > last:
                announce(f"Плавка железа: {gained}/{needed}")
                progress_deadline = time.monotonic() + 45
                last = gained
            if time.monotonic() > deadline or time.monotonic() > progress_deadline:
                raise RuntimeError("Плавка остановилась: проверь топливо и содержимое печи.")
            if current["input"] == 0 and gained < needed:
                game.request("smelt_start", count=needed-gained)
        game.request("furnace_close")
    announce("Крафт и надевание железной брони")
    game.request("place_table", local=True)
    for destination, (item, _) in ARMOR.items():
        if state()["armor"].get(destination) in (item, item.replace('iron_', 'diamond_'), item.replace('iron_', 'netherite_')):
            continue
        chosen = next((name for name in (item.replace('iron_', 'netherite_'), item.replace('iron_', 'diamond_'), item) if inventory().get(name, 0)), item)
        if not inventory().get(chosen, 0):
            craft(item)
        game.request("equip", item=chosen, destination=destination)
    final = state()
    if not full_iron(final):
        raise RuntimeError("Сервер не подтвердил полный комплект надетой железной брони.")
    return final
