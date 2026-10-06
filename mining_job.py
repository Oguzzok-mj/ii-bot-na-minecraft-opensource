import queue
import time
import json
from pathlib import Path

MIN_FREE_SLOTS = 7


def load_job(path, identity):
    if not path:
        return None
    try:
        saved = json.loads(Path(path).read_text(encoding='utf-8'))
        if saved.get('identity') != identity:
            return None
        if saved.get('resource') not in ORES or type(saved.get('stacks')) is not int or not 1 <= saved['stacks'] <= 576:
            return None
        if saved.get('target') != saved['stacks'] * 64 or type(saved.get('gathered')) is not int or saved['gathered'] < 0:
            return None
        if type(saved.get('inventory_amount')) is not int or saved['inventory_amount'] < 0 or saved.get('status') not in ('running', 'returning', 'done', 'stopped', 'error'):
            return None
        return saved
    except (OSError, ValueError, TypeError, AttributeError):
        return None

ORES = {
    'diamond': ('Алмазы', ('diamond', 'diamond_ore', 'deepslate_diamond_ore'), 2),
    'iron': ('Железо', ('raw_iron', 'iron_ore', 'deepslate_iron_ore'), 1),
    'coal': ('Уголь', ('coal', 'coal_ore', 'deepslate_coal_ore'), 0),
    'gold': ('Золото', ('raw_gold', 'gold_ore', 'deepslate_gold_ore', 'gold_nugget'), 2),
    'lapis': ('Лазурит', ('lapis_lazuli', 'lapis_ore', 'deepslate_lapis_ore'), 1),
    'redstone': ('Редстоун', ('redstone', 'redstone_ore', 'deepslate_redstone_ore'), 2),
    'copper': ('Медь', ('raw_copper', 'copper_ore', 'deepslate_copper_ore'), 1),
    'emerald': ('Изумруды', ('emerald', 'emerald_ore', 'deepslate_emerald_ore'), 2),
    'quartz': ('Кварц · Незер', ('quartz', 'nether_quartz_ore'), 0),
    'ancient_debris': ('Древние обломки · Незер', ('ancient_debris',), 3),
    'obsidian': ('Обсидиан', ('obsidian',), 3),
}


def run(game, args, announce, stop_event=None):
    resource, stacks = args.resource, args.stacks
    if resource not in ORES or type(stacks) is not int or not 1 <= stacks <= 576:
        raise ValueError('Выбери руду и количество от 1 до 576 стаков.')
    label, drops, tier = ORES[resource]
    target, gathered, failures = stacks * 64, 0, 0
    last_deposit = time.monotonic()
    previous = None
    job = {'resource': resource, 'stacks': stacks, 'target': target, 'gathered': 0, 'status': 'running'}
    job_path = getattr(args, 'mining_job_path', None)
    identity = {key: getattr(args, key, None) for key in ('host', 'port', 'username')}
    saved_payload = None
    last_announcement = (None, 0)
    planner = None
    development = None
    if getattr(args, 'auto_develop', False):
        from auto_development import AutoDevelopment
        development = AutoDevelopment(game, args, announce, lambda: state(), stop_event)
    if getattr(args, 'planner', 'miner') == 'qwen':
        from qwen_planner import QwenPlanner
        planner = QwenPlanner(getattr(args, 'root', Path(__file__).resolve().parent), stop_event, announce)
        job['planner'] = {'model': 'Qwen3-1.7B-Q8_0', 'status': 'waiting', 'decisions': 0}

    def report(status='running', message=None):
        nonlocal saved_payload
        job.update(gathered=gathered, status=status)
        job['message'] = message
        callback = getattr(args, 'mining_callback', None)
        if callback:
            callback(dict(job))
        if job_path and previous is not None:
            path = Path(job_path)
            payload = json.dumps({**job, 'identity': identity, 'inventory_amount': previous}, ensure_ascii=False, indent=2)
            if payload != saved_payload:
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix('.tmp')
                temporary.write_text(payload, encoding='utf-8')
                for attempt in range(6):
                    try:
                        temporary.replace(path)
                        saved_payload = payload
                        break
                    except PermissionError:
                        if attempt == 5:
                            raise RuntimeError('Не удалось сохранить счётчик: файл прогресса занят другой программой.')
                        time.sleep(.05 * (attempt + 1))

    def amount(state):
        inventory = state['inventory']
        return sum(inventory.get(name, 0) for name in drops)

    def state():
        if stop_event and stop_event.is_set():
            raise InterruptedError('Остановлено пользователем.')
        value = game.request('state')
        if value.get('miningPolicy'):
            job['policy'] = value['miningPolicy']
            job['metrics'] = value.get('miningMetrics', {})
        return value

    def commands(current):
        pending = list(current.get('controls', []))
        controls = getattr(args, 'control_queue', None)
        if controls:
            while True:
                try:
                    pending.append(controls.get_nowait())
                except queue.Empty:
                    break
        for command in pending:
            if command.get('command') == 'set_home':
                args.home = command['home']
                game.request('configure_home', home=args.home)
            elif command.get('command') == 'set_portals':
                args.portals = command['portals']
                game.request('configure_portals', portals=args.portals)
            elif command.get('command') == 'home_deposit':
                current = unload()
            elif command.get('command') == 'deposit':
                announce('Для этой задачи используй разгрузку на базе: кнопка «дом».')
        return current

    def unload(final=False):
        nonlocal previous, last_deposit
        message = 'Цель достигнута. Возвращаюсь домой и складываю ресурсы.' if final else 'Возвращаюсь на базу: освобождаю инвентарь.'
        announce(message)
        report('returning' if final else 'running', message)
        result = game.request('home_deposit', home=args.home, reserve={} if final or not development else args.active_reserve, archive=True)
        current = state()
        previous = amount(current)
        last_deposit = time.monotonic()
        report('returning' if final else 'running', 'Разгрузка на базе завершена.')
        if final and (not result.get('done') or amount(current)):
            raise RuntimeError('Не все выбранные ресурсы сложены в сундуки. Цель сохранена; освободи место на базе и нажми «запуск» для повторной разгрузки.')
        if result.get('remaining', 0) and current.get('emptySlots', 36) <= MIN_FREE_SLOTS:
            raise RuntimeError('Сундуки заполнены; руды сохранены, добыча остановлена.')
        return current

    try:
        current = state()
        previous = amount(current)
        saved = load_job(job_path, identity)
        if saved and saved['resource'] == resource and saved['stacks'] == stacks and saved['status'] != 'done':
            gathered = saved['gathered'] + max(0, previous - saved['inventory_amount'])
            announce(f'Продолжаю задачу: {label} · {gathered}/{target}')
        if development and gathered < target:
            development.prepare(resource, tier)
            current = state()
            previous = amount(current)
        materials = ('wooden', 'stone', 'iron', 'diamond', 'netherite')
        if gathered < target and not any(tool['name'] in [name + '_pickaxe' for name in materials[tier:]] and tool['remaining'] >= 16 for tool in current.get('tools', [])):
            raise RuntimeError('Нет подходящей исправной кирки для выбранной руды.')
        if gathered < target and resource in ('quartz', 'ancient_debris') and current.get('dimension') not in ('the_nether', 'minecraft:the_nether'):
            raise RuntimeError('Для выбранной руды бот должен находиться в Незере.')
        announce(f'{label}: цель {stacks} стаков ({target} предметов), осталось {max(0, target - gathered)}')
        report()
        for step in range(max(args.steps, target * 8)):
            current = state()
            gathered += max(0, amount(current) - previous)
            previous = amount(current)
            current = commands(current)
            if current['health'] <= 8 or current.get('inLava') or any(enemy['distance'] < 5 for enemy in current.get('threats', [])):
                raise RuntimeError('Опасность рядом с ботом; добыча остановлена.')
            if current['food'] < 14:
                if game.request('sustain'):
                    current = state()
                if current['food'] <= 6:
                    raise RuntimeError('Нужна еда перед дальнейшей добычей.')
            if gathered >= target and not current.get('pendingLoot'):
                break
            if development:
                development.service(resource, tier)
                current = state()
                previous = amount(current)
            if resource == 'diamond' and current.get('emptySlots', 36) <= MIN_FREE_SLOTS and current.get('miningPolicy'):
                try:
                    game.request('mining_compact')
                    current = state()
                except RuntimeError as error:
                    announce(f'Освобождение инвентаря: {error}')
            if current.get('emptySlots', 36) <= MIN_FREE_SLOTS or time.monotonic() - last_deposit >= 600:
                if current.get('pendingLoot'):
                    game.request('collect_loot', items=list(drops))
                    current = state()
                    gathered += max(0, amount(current) - previous)
                    previous = amount(current)
                    report()
                current = unload()
                if current.get('emptySlots', 36) <= MIN_FREE_SLOTS:
                    raise RuntimeError('Нужны свободные сундуки на базе.')
            if gathered != last_announcement[0] or time.monotonic() - last_announcement[1] >= 5:
                announce(f'{label}: {gathered}/{target} · {gathered / 64:.2f}/{stacks} стака')
                last_announcement = (gathered, time.monotonic())
            report()
            try:
                if planner and gathered < target and not current.get('pendingLoot'):
                    observation = game.request('mining_candidates', resource=resource)
                    if observation.get('candidates'):
                        observation.update(remaining=target-gathered, health=current['health'], food=current['food'])
                        job['planner']['status'] = 'thinking'
                        report()
                        identifier = planner.choose(observation)
                        current = commands(state())
                        if current['health'] <= 8 or current.get('inLava') or any(enemy['distance'] < 5 for enemy in current.get('threats', [])):
                            raise RuntimeError('Опасность после планирования; добыча остановлена.')
                        game.request('mining_select', resource=resource, target_id=identifier)
                        job['planner'].update(status='active', decisions=planner.decisions, target=identifier)
                        report()
                    elif not observation.get('active'):
                        job['planner']['status'] = 'scouting'
                game.request('collect_loot' if gathered >= target else 'mine_resource', resource=resource, items=list(drops))
                failures = 0
            except RuntimeError as error:
                if planner and ('Qwen' in str(error) or 'qwen' in str(error).lower()):
                    job['planner']['status'] = 'error'
                    raise
                failures += 1
                announce(str(error))
                report(message=str(error))
                if any(reason in str(error).lower() for reason in ('недостаточно материалов', 'рюкзак переполнен', 'нет места в рюкзаке', 'нет подходящей', 'кирка слом', 'соединение', 'игровой модуль')):
                    raise
                if failures >= 8:
                    raise RuntimeError(f'Добыча остановлена после 8 попыток: {error}') from error
        else:
            raise RuntimeError('Лимит поиска достигнут; собранные предметы остаются у бота.')
        unload(final=True)
        report('done', 'Ресурсы в сундуках. Бот ждёт дома.')
        announce(f'Готово: собрано {gathered} предметов ({gathered / 64:.2f} стака), ресурсы сложены в сундуки. Бот ждёт дома.')
        return dict(job)
    except InterruptedError:
        report('stopped')
        raise
    except Exception as error:
        report('error', str(error))
        raise
    finally:
        if planner:
            planner.close()
