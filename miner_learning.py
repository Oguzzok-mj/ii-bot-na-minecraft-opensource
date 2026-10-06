import hashlib
import json
from pathlib import Path
import time

import numpy as np

FEATURES = ('distance', 'vertical', 'vein', 'solid', 'hard', 'fluid', 'unknown', 'exposed', 'below', 'visited', 'dig_seconds', 'horizontal')


def load_samples(path):
    rows = {}
    for number, line in enumerate(Path(path).read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get('source') != 'minecraft_world_route_teacher':
            continue
        values = np.asarray(row.get('features'), dtype=np.float64)
        if values.shape != (12,) or not np.isfinite(values).all() or not np.isfinite(row.get('score', float('nan'))):
            raise ValueError(f'Некорректный пример добычи: строка {number}')
        rows[(row['query'], row['vein'])] = row
    rows = list(rows.values())
    if len(rows) < 100 or len({row['vein'] for row in rows}) < 12:
        raise ValueError('Нужны минимум 100 игровых примеров и 12 разных жил для независимой проверки.')
    return rows


def evaluate(rows, predictions):
    queries = {}
    for i, row in enumerate(rows):
        queries.setdefault(row['query'], []).append(i)
    regret, nearest, choices = [], [], []
    for ids in queries.values():
        if len(ids) < 2:
            continue
        best = max(rows[i]['score'] for i in ids)
        selected = max(ids, key=lambda i: predictions[i])
        close = min(ids, key=lambda i: rows[i]['features'][0])
        regret.append(best - rows[selected]['score'])
        nearest.append(best - rows[close]['score'])
        choices.append(abs(best - rows[selected]['score']) < np.log(1.15))
    return {'mae': float(np.mean(np.abs(predictions - np.array([r['score'] for r in rows])))),
            'queries': len(regret), 'mean_regret': float(np.mean(regret)) if regret else None,
            'nearest_regret': float(np.mean(nearest)) if nearest else None,
            'within_15_percent': float(np.mean(choices)) if choices else None}


def train(root, *, epochs=1000, stop_event=None, announce=print):
    root = Path(root)
    rows = load_samples(root / 'data/mining-training.jsonl')
    buckets = [int.from_bytes(hashlib.sha256(row['vein'].encode()).digest()[:4], 'little') % 100 for row in rows]
    partitions = [[i for i, b in enumerate(buckets) if low <= b < high] for low, high in ((0, 70), (70, 85), (85, 100))]
    if any(len(ids) < 15 for ids in partitions):
        raise ValueError('Недостаточно независимых жил в обучении, проверке или тесте; запиши больше данных.')
    training, validation, testing = partitions
    groups = [{rows[i]['vein'] for i in ids} for ids in partitions]
    assert not (groups[0] & groups[1] or groups[0] & groups[2] or groups[1] & groups[2])
    x = np.array([row['features'] for row in rows])
    y = np.array([row['score'] for row in rows])[:, None]
    mean, scale = x[training].mean(axis=0), np.maximum(x[training].std(axis=0), .05)
    x = (x - mean) / scale
    rng = np.random.default_rng(42)
    weights = [rng.normal(0, np.sqrt(1 / size), (size, out)) for size, out in ((12, 32), (32, 16), (16, 1))]
    biases = [np.zeros(32), np.zeros(16), np.array([y[training].mean()])]
    params = weights + biases
    first = [np.zeros_like(p) for p in params]
    second = [np.zeros_like(p) for p in params]

    def forward(values):
        h1 = np.tanh(values @ weights[0] + biases[0])
        h2 = np.tanh(h1 @ weights[1] + biases[1])
        return h1, h2, h2 @ weights[2] + biases[2]

    best, best_loss, best_epoch, steps = None, float('inf'), 0, 0
    announce(f'Добыча: {len(rows)} примеров из мира, {len(groups[0])}/{len(groups[1])}/{len(groups[2])} независимых жил.')
    for epoch in range(1, epochs + 1):
        if stop_event and stop_event.is_set():
            raise InterruptedError('Обучение остановлено.')
        order = rng.permutation(training)
        for start in range(0, len(order), 128):
            ids = order[start:start + 128]
            values = x[ids]
            h1, h2, prediction = forward(values)
            delta = 2 * (prediction - y[ids]) / len(ids)
            d2 = (delta @ weights[2].T) * (1 - h2 * h2)
            d1 = (d2 @ weights[1].T) * (1 - h1 * h1)
            grads = [values.T @ d1, h1.T @ d2, h2.T @ delta, d1.sum(axis=0), d2.sum(axis=0), delta.sum(axis=0)]
            steps += 1
            for i, (param, grad) in enumerate(zip(params, grads)):
                grad = np.clip(grad, -5, 5)
                first[i] *= .9
                first[i] += .1 * grad
                second[i] *= .999
                second[i] += .001 * grad * grad
                param -= .002 * (first[i] / (1 - .9 ** steps)) / (np.sqrt(second[i] / (1 - .999 ** steps)) + 1e-8)
        loss = float(np.mean((forward(x[validation])[2] - y[validation]) ** 2))
        if loss < best_loss - .00001:
            best_loss, best_epoch = loss, epoch
            best = [p.copy() for p in params]
        if epoch == 1 or epoch % 100 == 0:
            announce(f'Добыча: эпоха {epoch}, ошибка проверки {loss:.4f}')
        if epoch >= 200 and epoch - best_epoch >= 120:
            break
    for param, value in zip(params, best):
        param[:] = value
    test_rows = [rows[i] for i in testing]
    metrics = evaluate(test_rows, forward(x[testing])[2][:, 0])
    accepted = metrics['queries'] >= 3 and metrics['mae'] < .65 and metrics['mean_regret'] < .30 and metrics['mean_regret'] <= metrics['nearest_regret'] + .08
    metrics['accepted'] = bool(accepted)
    report = {'schema': 1, 'architecture': [12, 32, 16, 1], 'samples': len(rows), 'source': 'minecraft_world_route_teacher',
              'epochs': epoch, 'best_epoch': best_epoch, 'split': {'train': len(training), 'validation': len(validation), 'test': len(testing)},
              'veins': dict(zip(('train', 'validation', 'test'), map(len, groups))), 'validation': metrics,
              'route_success_samples': sum(row.get('routeStatus') == 'success' for row in rows),
              'actual_origin_samples': sum(row.get('actualOrigin', False) for row in rows),
              'trainedAt': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
              'limits': 'Имитация оценок планировщика на геометрии загруженного мира. Не обучение с подкреплением; ускорение в игре измеряется отдельно.'}
    directory = root / 'models'
    directory.mkdir(exist_ok=True)
    (directory / 'miner-training-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if not accepted:
        raise RuntimeError(f'Модель не прошла независимый тест: {metrics}; рабочие веса не заменены.')
    model = {**report, 'features': list(FEATURES), 'mean': mean.tolist(), 'scale': scale.tolist(),
             'layers': [{'w': w.tolist(), 'b': b.tolist()} for w, b in zip(weights, biases)]}
    temporary = directory / 'miner.tmp'
    temporary.write_text(json.dumps(model, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    temporary.replace(directory / 'miner.json')
    np.savez(directory / 'miner.npz', mean=mean, scale=scale, **{f'w{i}': w for i, w in enumerate(weights)}, **{f'b{i}': b for i, b in enumerate(biases)})
    announce(f'Добыча: модель сохранена. Тест: ошибка {metrics["mae"]:.3f}, потери выбора {metrics["mean_regret"]:.3f}; ближайшая жила {metrics["nearest_regret"]:.3f}.')
    return report


def course(args, stop_event=None):
    from main import Minecraft, ROOT
    game = Minecraft(args, stop_event)
    try:
        state = game.wait_ready()
        if state['dimension'] not in ('overworld', 'minecraft:overworld'):
            raise ValueError('Для обучения алмазной добычи подключись к обычному миру.')
        offset = 0
        while True:
            captured = game.request('mining_capture', offset=offset, batch=8)
            print(f'Данные добычи: +{captured["samples"]} примеров, позиции {captured["next"]}/{captured["origins"]}', flush=True)
            if captured['done']:
                break
            offset = captured['next']
        report = train(ROOT, stop_event=stop_event)
        game.request('mining_reload')
        return report
    finally:
        game.close()
