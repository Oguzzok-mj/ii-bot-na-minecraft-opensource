import argparse
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import time
import tempfile
import webbrowser

import numpy as np
from brain import ACTIONS, Brain, features, teacher
from progression import iron_stage, full_iron
from diamond import diamond_stage, full_diamond
from endgame import Development, full_netherite

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent


class Minecraft:

    def __init__(self, args, stop_event=None):
        self.stop_event = stop_event
        self.args = args
        self.saved_at = 0
        self.last_state = None
        self.qwen = None
        self.open_browser = not getattr(args, "no_browser", False)
        node = shutil.which("node")
        if not node:
            raise RuntimeError("Не найден Node.js. Установите Node.js и выполните npm install.")
        if not (ROOT / "node_modules" / "mineflayer").exists():
            raise RuntimeError("Не установлены игровые зависимости. Выполните npm install.")
        options = {"host": getattr(args, "host", "127.0.0.1"), "port": args.port,
                   "username": args.username, "auth": args.auth,
                   "viewer": getattr(args, "viewer", False), "viewerPort": 3007,
                   "home": getattr(args, "home", {"x": 0, "y": 64, "z": 0})}
        try:
            previous = json.loads((ROOT / 'data/progress.json').read_text(encoding='utf-8'))
            if previous.get('host') == options['host'] and previous.get('port') == options['port'] and previous.get('username') == options['username']:
                options['portals'] = previous.get('state', {}).get('portals', {})
                options['portalPlan'] = previous.get('state', {}).get('portalPlan')
                options['miningTrail'] = previous.get('state', {}).get('miningTrail', {})
                options['pendingLoot'] = previous.get('state', {}).get('pendingLoot')
                options['mineResume'] = previous.get('state', {}).get('mineResume')
                options['obsidianFactory'] = previous.get('state', {}).get('obsidianFactory')
        except (OSError, ValueError, TypeError):
            pass
        options['portalOverrides'] = getattr(args, 'portals', {})
        if args.version:
            options["version"] = args.version
        if args.auth == "microsoft":
            options["profilesFolder"] = str(ROOT / "data" / "login")
        self.messages = queue.Queue()
        self.counter = 0
        directory = ROOT / 'data'
        directory.mkdir(exist_ok=True)
        self.options_file = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', suffix='.json', prefix='.bridge-', dir=directory, delete=False) as configuration:
                self.options_file = Path(configuration.name)
                json.dump(options, configuration, ensure_ascii=False)
            self.process = subprocess.Popen(
                [node, str(ROOT / "bridge.js"), '--options-file', str(self.options_file)], cwd=ROOT,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                encoding="utf-8", errors="replace", bufsize=1,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except BaseException:
            if self.options_file:
                self.options_file.unlink(missing_ok=True)
            raise
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=self._read_errors, daemon=True).start()

    def _read_errors(self):
        for line in self.process.stderr:
            print(line.rstrip(), file=sys.stderr, flush=True)

    def _read(self):
        for line in self.process.stdout:
            try:
                value = json.loads(line)
                if 'checkpoint' in value:
                    self.last_state = value['checkpoint']
                else:
                    self.messages.put(value)
            except json.JSONDecodeError:
                pass
        self.messages.put({"error": "Соединение с Minecraft закрыто."})

    def request(self, command, **kwargs):
        planned = kwargs.pop('_qwen_planned', False)
        if command not in ("state", "status", "control_state", "pause", "furnace_close", "delivery_cancel"):
            waiting = False
            while self._request("control_state").get("paused"):
                if not waiting:
                    waiting = True
                    callback = getattr(self.args, "pause_callback", None)
                    if callback:
                        callback(True)
                if self.stop_event:
                    if self.stop_event.wait(.2):
                        raise InterruptedError("Остановлено пользователем.")
                else:
                    time.sleep(.2)
                self._request("state", peek=True)
            if waiting:
                callback = getattr(self.args, "pause_callback", None)
                if callback:
                    callback(False)
        if command == 'mine_resource' and not planned and getattr(self.args, 'planner', 'miner') == 'qwen' and self.args.command != 'resource':
            resource = kwargs.get('resource')
            from mining_job import ORES
            if resource in ORES:
                observation = self._request('mining_candidates', resource=resource)
                if observation.get('candidates'):
                    current = self._request('state', peek=True)
                    if current['health'] <= 8 or current.get('inLava') or any(enemy['distance'] < 5 for enemy in current.get('threats', [])):
                        raise RuntimeError('Опасность рядом с ботом; планирование Qwen остановлено.')
                    if self.qwen is None:
                        from qwen_planner import QwenPlanner
                        self.qwen = QwenPlanner(ROOT, self.stop_event)
                    callback = getattr(self.args, 'planner_callback', None)
                    if callback:
                        callback('thinking')
                    identifier = self.qwen.choose(observation)
                    current = self._request('state', peek=True)
                    if current['health'] <= 8 or current.get('inLava') or any(enemy['distance'] < 5 for enemy in current.get('threats', [])):
                        raise RuntimeError('Опасность после планирования Qwen; добыча остановлена.')
                    self._request('mining_select', resource=resource, target_id=identifier)
                    if callback:
                        callback('active')
                elif not observation.get('active'):
                    callback = getattr(self.args, 'planner_callback', None)
                    if callback:
                        callback('scouting')
                return self.request(command, _qwen_planned=True, **kwargs)
        return self._request(command, **kwargs)

    def checkpoint(self, state=None, force=False):
        if state is not None:
            self.last_state = state
        if self.last_state is None or (not force and time.monotonic()-self.saved_at < 5):
            return
        value = {"saved_at": time.strftime("%Y-%m-%d %H:%M:%S"), "host": getattr(self.args, "host", "127.0.0.1"), "port": self.args.port,
                 "command": self.args.command, "username": self.args.username, "state": self.last_state}
        directory = ROOT / "data"
        directory.mkdir(exist_ok=True)
        temporary = directory / "progress.tmp"
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(directory / "progress.json")
        self.saved_at = time.monotonic()

    def _request(self, command, **kwargs):
        if self.process.poll() is not None:
            raise RuntimeError("Игровой модуль завершился. Проверьте сообщение выше и порт мира.")
        self.counter += 1
        request_id = self.counter
        request = {"id": request_id, "command": command, **kwargs}
        try:
            self.process.stdin.write(json.dumps(request) + "\n")
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as error:
            raise RuntimeError("Игровой модуль отключился.") from error
        timeout = 600 if command == "home_deposit" else 180 if command in ("build_portal", "find_template", "home_withdraw") else 90 if command in ("mine_stone", "mine_iron", "mine_resource", "deliver_step", "enter_portal", "pack_table", "return_table") else 30
        deadline = time.monotonic() + timeout
        while True:
            if self.stop_event and self.stop_event.is_set():
                raise InterruptedError("Остановлено пользователем.")
            try:
                response = self.messages.get(timeout=.25)
            except queue.Empty as error:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Minecraft не ответил за {timeout} секунд.") from error
                continue
            if "id" not in response or response.get("id") == request_id:
                if response.get("error"):
                    raise RuntimeError(response["error"])
                value = response["result"]
                if command == "state" and isinstance(value, dict):
                    self.checkpoint(value)
                elif command == "act" and value.get("state"):
                    self.checkpoint(value["state"])
                return value
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Minecraft не ответил за {timeout} секунд.")

    def wait_ready(self):
        print("Подключаем бота. Если запрошен вход Microsoft, выполните его самостоятельно.")
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                state = self.request("state")
                if state.get("viewer"):
                    (ROOT / "data").mkdir(exist_ok=True)
                    (ROOT / "data/viewer-url.txt").write_text(state["viewer"], encoding="utf-8")
                    print(f"Вид от лица бота: {state['viewer']}", flush=True)
                    callback = getattr(self.args, "viewer_callback", None)
                    if callback:
                        callback(state["viewer"])
                    if self.open_browser and not getattr(self, "opened_viewer", False):
                        self.opened_viewer = True
                        webbrowser.open(state["viewer"])
                return state
            except RuntimeError as error:
                if self.process.poll() is not None:
                    raise
                if str(error) != 'Бот пока не готов или погиб.':
                    raise
                time.sleep(1)
        raise TimeoutError("Бот не появился. Проверьте, что мир открыт по сети и порт верный.")

    def close(self):
        if self.qwen:
            self.qwen.close()
        try:
            self.checkpoint(force=True)
        except OSError as error:
            print(f"Прогресс не сохранён: {error}", file=sys.stderr)
        if self.process.stdin and not self.process.stdin.closed:
            try:
                self.process.stdin.close()
            except OSError:
                pass
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=3)
        if self.process.stdout:
            self.process.stdout.close()
        if self.process.stderr:
            self.process.stderr.close()
        if self.options_file:
            self.options_file.unlink(missing_ok=True)


def save_example(file, state, action, *, ok=True, source="minecraft"):
    file.write(json.dumps({"state": state, "action": action,
                           "ok": ok, "source": source}, ensure_ascii=False) + "\n")
    file.flush()


def read_examples(path):
    samples, labels, sources = [], [], set()
    with Path(path).open(encoding="utf-8") as file:
        for number, line in enumerate(file, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                if not row.get("ok", True):
                    continue
                x = features(row["state"])
                if not np.isfinite(x).all():
                    raise ValueError("Признаки содержат нечисловые значения.")
                label = ACTIONS.index(row["action"])
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError(f"Неверный пример в строке {number}: {error}") from error
            samples.append(x)
            labels.append(label)
            sources.add(row.get("source", "unknown"))
    if len(samples) < 20:
        raise ValueError("В файле меньше 20 успешных примеров. Запишите больше действий.")
    return np.stack(samples), np.array(labels, dtype=np.int64), sources


def train(args, stop_event=None):
    x, y, sources = read_examples(args.data)
    print(f"Успешных примеров: {len(x)}. Источник: {', '.join(sorted(sources))}")
    for index, action in enumerate(ACTIONS):
        count = int(np.sum(y == index))
        print(f"  {action}: {count}" + (" — нет примеров, этому действию сеть не научится" if not count else ""))
    brain = Brain(seed=args.seed)
    print("Обучаем новые случайные веса, без готовой нейросети.")
    def progress(epoch, loss, accuracy):
        if stop_event and stop_event.is_set():
            raise InterruptedError("Обучение остановлено пользователем.")
        print(f"Эпоха {epoch:3}: ошибка={loss:.4f}, точность на отложенных примерах={accuracy:.1%}")
    accuracy = brain.fit(x, y, epochs=args.epochs, seed=args.seed, progress=progress)
    brain.save(args.model)
    print(f"Модель сохранена: {args.model}")
    print("Точность классификации примеров не равна успеху в Minecraft.")
    return brain, accuracy


def demo(args):

    rng = np.random.default_rng(args.seed)
    path = ROOT / "data" / "demo.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", encoding="utf-8") as file:
        for action in ACTIONS:
            for _ in range(700):
                state = {"log": None, "drop": None, "health": float(rng.uniform(10, 20)),
                         "food": float(rng.uniform(10, 20)), "wood": 0}
                if action in ("approach", "chop", "pickup"):
                    state["log"] = {"distance": float(rng.uniform(1, 24)), "can_chop": False}
                if action == "chop":
                    state["log"] = {"distance": float(rng.uniform(1, 4)), "can_chop": True}
                if action == "pickup":
                    if rng.random() < .35:
                        state["log"] = None
                    elif rng.random() < .5:
                        state["log"] = {"distance": float(rng.uniform(1, 4)), "can_chop": True}
                    state["drop"] = {"distance": float(rng.uniform(.5, 7))}
                save_example(file, state, teacher(state), source="synthetic_demo")
    args.data, args.model = path, ROOT / "models" / "demo.npz"
    print("УЧЕБНОЕ ДЕМО: искусственные примеры, не опыт игры в Minecraft.")
    brain, _ = train(args)
    example = {"log": {"distance": 2, "can_chop": True}, "drop": None,
               "health": 20, "food": 20}
    print("Пример: доступное бревно рядом ->", brain.predict(example))
    print("Следующий шаг: record, затем train на data/episodes.jsonl.")


def play(args, stop_event=None):
    brain = Brain.load(args.model) if args.command == "run" else None
    if brain:
        print("Решения принимает обученная сеть. Учитель не используется.")
    else:
        print("Записываем действия простого учителя. Сеть пока не управляет ботом.")
    path = Path(args.data)
    path.parent.mkdir(parents=True, exist_ok=True)
    game = Minecraft(args, stop_event=stop_event)
    try:
        initial = game.wait_ready()
        starting_wood = initial["wood"]
        print(f"В начале {starting_wood} брёвен. Цель — добыть ещё {args.goal}.")
        failures = 0
        with path.open("a", encoding="utf-8") as dataset:
            for step in range(1, args.steps + 1):
                if stop_event and stop_event.is_set():
                    raise InterruptedError("Остановлено пользователем.")
                state = game.request("state")
                if state["wood"] - starting_wood >= args.goal:
                    print(f"Цель достигнута: добыто ещё {state['wood'] - starting_wood} брёвен.")
                    return
                if state["health"] <= 4:
                    print("Остановка: мало здоровья. Подготовьте безопасный учебный мир.")
                    return
                action = brain.predict(state) if brain else teacher(state)
                if args.command == "record" and args.manual:
                    print("Состояние:", json.dumps(state, ensure_ascii=False))
                    answer = input(f"Действие [{action}] ({', '.join(ACTIONS)}; q — выход): ").strip()
                    if answer == "q":
                        return
                    if answer:
                        if answer not in ACTIONS:
                            print("Неизвестное действие. Этот шаг пропущен.")
                            continue
                        action = answer
                confidence = f", уверенность={max(brain.probabilities(state)):.0%}" if brain else ""
                print(f"Шаг {step}: {action}, брёвна={state['wood']}{confidence}", flush=True)
                result = game.request("act", action=action)
                if not brain:
                    save_example(dataset, state, action, ok=result["ok"])
                if not result["ok"]:
                    failures += 1
                    print("  Действие не выполнено:", result.get("error"))
                    if failures >= 10:
                        print("10 неудач подряд. Нужны другие примеры или более простой участок мира.")
                        return
                else:
                    failures = 0
                if result.get("state") and result["state"]["wood"] - starting_wood >= args.goal:
                    print(f"Цель достигнута: добыто ещё {result['state']['wood'] - starting_wood} брёвен.")
                    return
            print("Лимит шагов достигнут. Цель пока не подтверждена.")
    finally:
        game.close()


def deliver(game, args, announce, stop_event=None, player=None):
    announce("Разгрузка: иду к игроку и сундуку")
    for _ in range(args.steps):
        if stop_event and stop_event.is_set():
            raise InterruptedError("Остановлено пользователем.")
        result = game.request("deliver_step", player=player or getattr(args, "player", ""))
        if result["done"]:
            announce(f"Ресурсы сложены в сундук у {result['player']}: {result['deposited']} предметов")
            return result
    raise RuntimeError("Лимит пути к игроку достигнут.")


def deposit_home(game, args, announce, reserve=None, archive=False):
    home = getattr(args, "home", {"x": 0, "y": 64, "z": 0})
    announce(f"Дом: X {home['x']} Y {home['y']} Z {home['z']}")
    result = game.request("home_deposit", home=home, reserve=reserve or {}, archive=archive)
    announce(f"Сложено в сундуки: {sum(result['deposited'].values())} предметов; свободный остаток {result['remaining']}")
    return result


def mission(args, stop_event=None):
    brain = Brain.load(args.model)
    game = Minecraft(args, stop_event=stop_event)
    tool_names = ("pickaxe", "axe", "shovel", "sword")
    diamond_goal = args.command in ("diamonds", "enchant", "netherite")
    args.active_reserve = {"diamond": 33, "iron_ingot": 32, "raw_iron": 32, "coal": 16, "lapis_lazuli": 3} if diamond_goal else {"iron_ingot": 24, "raw_iron": 24, "coal": 8} if args.command == "iron" else {}
    pending_controls = []
    last_home_deposit = time.monotonic()
    iron_goal = args.command in ("iron", "diamonds", "enchant", "netherite") or getattr(args, "target", "stone") == "iron"
    def state():
        nonlocal last_home_deposit
        if stop_event and stop_event.is_set():
            raise InterruptedError("Остановлено пользователем.")
        value = game.request("state")
        if value.get('inLava') or any(enemy['name']=='creeper' and enemy['distance']<5 for enemy in value.get('threats', [])):
            raise RuntimeError('Опасность рядом с ботом: движение остановлено.')
        if value["health"] <= 4:
            raise RuntimeError("Мало здоровья: задача остановлена.")
        if value['food'] < 14 and 'inventory' == value.get('windowType'):
            if game.request('sustain'):
                value = game.request('state')
        pending_controls.extend(value.get("controls", []))
        control_queue = getattr(args, "control_queue", None)
        if control_queue:
            while True:
                try:
                    pending_controls.append(control_queue.get_nowait())
                except queue.Empty:
                    break
        if time.monotonic()-last_home_deposit >= 600:
            pending_controls.append({"command": "home_deposit", "archive": True})
            last_home_deposit = time.monotonic()
        if value.get('emptySlots',36)<=4 and args.command in ('mission','iron','diamonds','enchant','netherite') and not any(c.get('command')=='home_deposit' for c in pending_controls):
            pending_controls.insert(0,{'command':'home_deposit','archive':True,'crowded':True})
        if "furnace" not in value.get("windowType", "") and pending_controls:
            command = pending_controls.pop(0)
            if command.get('command') == 'set_portals':
                args.portals = command['portals']
                game.request('configure_portals', portals=args.portals)
                return value
            if command.get("command") == "set_home":
                args.home = command['home']
                game.request('configure_home', home=args.home)
            elif command.get("command") == "deposit":
                try:
                    deliver(game, args, announce, stop_event, command.get("player"))
                except (RuntimeError, TimeoutError) as error:
                    game.request("delivery_cancel")
                    announce(f"Разгрузка: {error}")
                value = game.request("state")
                pending_controls.extend(value.get("controls", []))
            elif command.get("command") == "home_deposit":
                reserve = {} if command.get("all") else args.active_reserve
                try:
                    deposit_home(game, args, announce, reserve, command.get('archive',False))
                    if command.get('archive'):
                        game.request('home_withdraw',items={},food=16)
                except (RuntimeError, TimeoutError) as error:
                    announce(f"Домашняя разгрузка: {error}")
                last_home_deposit = time.monotonic()
                value = game.request("state")
                if command.get('crowded') and value.get('emptySlots',36)<=4:
                    raise RuntimeError('Инвентарь заполнен, а на базе не удалось освободить место. Добыча остановлена без выбрасывания предметов.')
        return value
    def announce(text):
        print(text, flush=True)
        game.request("status", text=text)
        callback = getattr(args, "status_callback", None)
        if callback:
            callback(text)
    def inventory():
        return state()["inventory"]
    def craft(item, count=1):
        print(f"Крафт: {item}", flush=True)
        game.request("craft", item=item, count=count)
    def finish(final):
        if diamond_goal:
            if not all(str(final["armor"].get(slot, "")).startswith(("iron_", "diamond_", "netherite_")) for slot in ("head", "torso", "legs", "feet")):
                final = iron_stage(game,args,brain,announce,state,ROOT,stop_event)
            final = diamond_stage(game,args,announce,state,stop_event)
            if args.command == "netherite":
                final = Development(game,args,announce,state,stop_event).netherite()
                announce("Готово: незеритовая броня и инструменты; кирка — эффективность V, удача III, прочность III.")
            elif args.command == "enchant":
                Development(game,args,announce,state,stop_event).enchant()
                final = state()
                announce("Готово: кирка — эффективность V, удача III, прочность III.")
            else:
                announce("Готово: алмазная броня надета; алмазные кирка, топор, лопата и меч получены.")
        elif iron_goal:
            final = iron_stage(game,args,brain,announce,state,ROOT,stop_event)
            announce("Готово: полный комплект железной брони надет. Бот остановлен.")
        else:
            announce("Готово: каменная кирка, топор, лопата и меч.")
        game.request("inventory", open=True)
        args.active_reserve = {}
        (ROOT / "data/last-mission.json").write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
        if getattr(args, "keep_viewer", False):
            print("Задача завершена. Наблюдение остаётся открытым до кнопки «Остановить».", flush=True)
            while not (stop_event and stop_event.wait(.5)):
                state()
        return final
    try:
        game.wait_ready()
        if args.command == 'netherite' and not full_netherite(state()):
            deposit_home(game,args,announce,args.active_reserve)
            result = game.request('find_template')
            announce(f"Шаблоны улучшения из сундуков базы: {result['count']}")
            game.request('home_withdraw', items={'coal':16}, food=16)
        if args.command == "home_deposit":
            deposit_home(game,args,announce)
            if getattr(args,"keep_viewer",False):
                while not (stop_event and stop_event.wait(.5)):
                    state()
            return state()
        if args.command == "deposit":
            deliver(game,args,announce,stop_event,getattr(args,"player",None))
            if getattr(args,"keep_viewer",False):
                while not (stop_event and stop_event.wait(.5)):
                    state()
            return state()
        if diamond_goal and full_diamond(state()):
            return finish(state())
        if iron_goal and full_iron(state()):
            return finish(state())
        if all(any(inventory().get(material + '_' + name, 0) for material in ('stone','iron','diamond','netherite')) for name in tool_names):
            return finish(state())
        announce("Добыча дерева")
        failures = 0
        for step in range(args.steps):
            current = state()
            items = current["inventory"]
            planks = sum(count for name, count in items.items() if name.endswith("_planks"))
            if current["wood"] >= 8 or planks >= 24 or all(items.get("wooden_" + name, 0) for name in tool_names):
                break
            action = brain.predict(current)
            print(f"Дерево {current['wood']}/8 · {action}", flush=True)
            result = game.request("act", action=action)
            failures = failures + 1 if not result["ok"] else 0
            if not result["ok"]:
                print(result.get("error"), flush=True)
            if failures >= 10:
                raise RuntimeError("Не удалось добыть дерево: десять неудач подряд.")
        else:
            raise RuntimeError("Достигнут лимит поиска дерева.")
        announce("Инвентарь: доски, палки и верстак")
        while True:
            items = inventory()
            planks = sum(count for name, count in items.items() if name.endswith("_planks"))
            if planks >= 24 or not any(name.endswith(("_log", "_stem")) for name in items):
                break
            log = next(name for name in items if name.endswith(("_log", "_stem")))
            craft(log.removeprefix("stripped_").rsplit("_", 1)[0] + "_planks", min(items[log], 8))
        if inventory().get("stick", 0) < 16:
            craft("stick", (16 - inventory().get("stick", 0) + 3) // 4)
        if not state()["table"]:
            if not inventory().get("crafting_table", 0):
                craft("crafting_table")
            game.request("place_table")
        announce("Крафт деревянных инструментов")
        for name in tool_names:
            item = "wooden_" + name
            if not inventory().get(item, 0):
                craft(item)
        game.request("equip", item="wooden_pickaxe")
        announce("Поиск камня и ступенчатый спуск")
        failures = 0
        for step in range(args.steps):
            items = inventory()
            amount = items.get("cobblestone", 0) + items.get("cobbled_deepslate", 0)
            if amount >= 12:
                break
            print(f"Камень {amount}/12 · шаг {step + 1}", flush=True)
            try:
                game.request("mine_stone")
                failures = 0
            except RuntimeError as error:
                failures += 1
                print(str(error), flush=True)
                if failures >= 4:
                    raise RuntimeError("Не удалось продолжить безопасную добычу камня.") from error
        else:
            raise RuntimeError("Достигнут лимит добычи камня.")
        announce("Возвращение к верстаку")
        game.request("return_table")
        announce("Крафт каменных инструментов")
        for name in tool_names:
            item = "stone_" + name
            if not inventory().get(item, 0):
                craft(item)
        game.request("equip", item="stone_pickaxe")
        final = state()
        if not all(final["inventory"].get("stone_" + name, 0) for name in tool_names):
            raise RuntimeError("Не все каменные инструменты получены.")
        return finish(final)
    finally:
        game.close()


def mine_quota(args, stop_event=None):
    from mining_job import run
    args.mining_job_path = ROOT / 'data/mining-job.json'
    args.root = ROOT
    game = Minecraft(args, stop_event=stop_event)
    def announce(text):
        print(text, flush=True)
        game.request('status', text=text)
    try:
        game.wait_ready()
        try:
            result = run(game, args, announce, stop_event)
        except RuntimeError as error:
            if not getattr(args, 'keep_viewer', False):
                raise
            announce(f'Добыча остановлена: {error}')
            result = {'status': 'error', 'message': str(error)}
        if getattr(args, 'keep_viewer', False):
            while not (stop_event and stop_event.wait(.5)):
                if not stop_event:
                    time.sleep(.5)
                current = game.request('state')
                control_queue = getattr(args, 'control_queue', None)
                commands = current.get('controls', [])
                if control_queue:
                    while True:
                        try:
                            commands.append(control_queue.get_nowait())
                        except queue.Empty:
                            break
                for command in commands:
                    if command.get('command') == 'set_portals':
                        args.portals = command['portals']
                        game.request('configure_portals', portals=args.portals)
                        continue
                    if command.get('command') == 'set_home':
                        args.home = command['home']
                        game.request('configure_home', home=args.home)
                    elif command.get('command') == 'home_deposit':
                        try:
                            deposit_home(game, args, announce, archive=True)
                        except RuntimeError as error:
                            announce(f'Разгрузка: {error}')
        return result
    finally:
        game.close()


def connect(args, stop_event=None):
    game = Minecraft(args, stop_event=stop_event)
    try:
        initial = game.wait_ready()
        message = f"Подключён: {args.username} · {args.host}:{args.port}"
        print(message, flush=True)
        game.request("status", text=message)
        callback = getattr(args, "status_callback", None)
        if callback:
            callback(message)
        last_home_deposit = time.monotonic()
        while not (stop_event and stop_event.wait(.5)):
            if not stop_event:
                time.sleep(.5)
            state = game.request("state")
            commands = state.get("controls", [])
            control_queue = getattr(args, "control_queue", None)
            if control_queue:
                while True:
                    try:
                        commands.append(control_queue.get_nowait())
                    except queue.Empty:
                        break
            for command in commands:
                if command.get('command') == 'set_portals':
                    args.portals = command['portals']
                    game.request('configure_portals', portals=args.portals)
                    continue
                if command.get("command") == "set_home":
                    args.home = command['home']
                    game.request('configure_home', home=args.home)
                elif command.get("command") == "deposit":
                    try:
                        deliver(game, args, print, stop_event, command.get("player"))
                    except (RuntimeError, TimeoutError) as error:
                        game.request("delivery_cancel")
                        print(f"Разгрузка: {error}", flush=True)
                elif command.get("command") == "home_deposit":
                    try:
                        deposit_home(game, args, print)
                    except (RuntimeError, TimeoutError) as error:
                        print(f"Домашняя разгрузка: {error}", flush=True)
                    last_home_deposit = time.monotonic()
            if time.monotonic()-last_home_deposit >= 600:
                try:
                    deposit_home(game, args, print)
                except (RuntimeError, TimeoutError) as error:
                    print(f"Домашняя разгрузка: {error}", flush=True)
                last_home_deposit = time.monotonic()
        return initial
    finally:
        game.close()


def parser():
    result = argparse.ArgumentParser(description="Собственная нейросеть для Minecraft Java: первая задача — дерево.")
    modes = result.add_subparsers(dest="command", required=True)
    for name in ("demo", "train", "record", "run", "mission", "iron", "diamonds", "enchant", "netherite", "deposit", "home_deposit", "connect"):
        mode = modes.add_parser(name)
        mode.add_argument("--data", type=Path, default=ROOT / "data" / "episodes.jsonl")
        mode.add_argument("--model", type=Path, default=ROOT / "models" / "brain.npz")
        if name in ("demo", "train"):
            mode.add_argument("--epochs", type=int, default=120)
            mode.add_argument("--seed", type=int, default=42)
        else:
            mode.add_argument("--host", default="127.0.0.1")
            mode.add_argument("--port", type=int, default=25565, help="Порт сервера или локального мира")
            mode.add_argument("--version", default=None, help="Например 1.20.1; по умолчанию автоопределение")
            mode.add_argument("--username", default="NeuroFarmer")
            mode.add_argument("--auth", choices=("offline", "microsoft"), default="offline")
            mode.add_argument("--steps", type=int, default=300)
            mode.add_argument("--goal", type=int, default=64)
            mode.add_argument("--player", default="")
            mode.add_argument("--home-x", type=int, default=0)
            mode.add_argument("--home-y", type=int, default=64)
            mode.add_argument("--home-z", type=int, default=0)
            mode.add_argument("--viewer", action="store_true")
            mode.add_argument("--no-browser", action="store_true")
            if name == "record":
                mode.add_argument("--manual", action="store_true", help="Самостоятельно выбирайте учебные действия")
    return result


if __name__ == "__main__":

    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = parser().parse_args()
    if hasattr(args, "home_x"):
        args.home = {"x": args.home_x, "y": args.home_y, "z": args.home_z}
    try:
        if hasattr(args, "epochs") and args.epochs < 1:
            raise ValueError("Число эпох должно быть положительным.")
        if args.command in ("record", "run", "mission", "iron", "diamonds", "enchant", "netherite", "deposit", "home_deposit", "connect"):
            if not 1 <= args.port <= 65535 or args.steps < 1 or args.goal < 1:
                raise ValueError("Проверьте порт, число шагов и цель.")
            if args.command == "connect":
                connect(args)
            elif args.command in ("mission", "iron", "diamonds", "enchant", "netherite", "deposit", "home_deposit"):
                mission(args)
            else:
                play(args)
        elif args.command == "train":
            train(args)
        else:
            demo(args)
    except KeyboardInterrupt:
        print("\nОстановлено пользователем.")
    except (RuntimeError, ValueError, FileNotFoundError, TimeoutError, OSError) as error:
        print(f"Ошибка: {error}", file=sys.stderr)
        sys.exit(1)
