if __name__ == '__main__':
    try:
        from terminal_app import launch
        raise SystemExit(launch())
    except Exception:
        import sys
        import traceback
        from pathlib import Path
        root = Path(sys.executable).resolve().parent if getattr(sys, 'frozen', False) else Path(__file__).resolve().parent
        (root / 'data').mkdir(exist_ok=True)
        (root / 'data/terminal-error.log').write_text(traceback.format_exc(), encoding='utf-8')
        raise
