from pathlib import Path
import os
import shutil
import subprocess
import sys


def main():
    root = Path(__file__).resolve().parents[1]
    node = shutil.which('node')
    if not node:
        raise SystemExit('Node.js is required. Install dependencies with npm ci first.')
    env = {**os.environ, 'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
    failed = []
    checks = sorted((root / 'tests').glob('check_*.py')) + sorted((root / 'tests').glob('check_*.cjs'))
    for check in checks:
        executable = sys.executable if check.suffix == '.py' else node
        print(f'\n--- {check.name} ---', flush=True)
        try:
            result = subprocess.run([executable, str(check)], cwd=root, env=env, timeout=90)
            if result.returncode:
                failed.append(check.name)
        except subprocess.TimeoutExpired:
            failed.append(check.name + ' (timeout)')
    print(f'\n{len(checks) - len(failed)}/{len(checks)} checks passed.')
    if failed:
        print('Failed: ' + ', '.join(failed))
    return bool(failed)


if __name__ == '__main__':
    raise SystemExit(main())
