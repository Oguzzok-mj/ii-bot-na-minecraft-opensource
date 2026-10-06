from pathlib import Path
import os
import shutil
import subprocess
import sys


def main():
    if os.name != 'nt':
        raise SystemExit('Build the Windows application on Windows.')
    root = Path(__file__).resolve().parents[1]
    npm = shutil.which('npm.cmd')
    if not npm:
        raise SystemExit('Install Node.js before building.')
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', str(root / 'MinecraftNeural-v8.spec')], cwd=root, check=True)
    output = root / 'dist/MinecraftNeural-v8'
    for file in root.iterdir():
        if file.is_file() and (file.suffix in {'.js', '.html'} or file.name in {'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'NOTICE.md'}):
            shutil.copy2(file, output / file.name)
    for folder in ('assets', 'licenses', 'models'):
        destination = output / folder
        destination.mkdir(exist_ok=True)
        for file in (root / folder).iterdir():
            if file.is_file() and file.suffix != '.gguf':
                shutil.copy2(file, destination / file.name)
    subprocess.run([npm, 'ci', '--omit=dev'], cwd=output, check=True)
    print(output / 'MinecraftNeural-v8.exe')


if __name__ == '__main__':
    main()
