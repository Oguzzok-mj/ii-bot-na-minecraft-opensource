import argparse
import ctypes
import json
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
import queue
import re
import shlex
import sys
import threading
import urllib.parse
import urllib.request

from PySide6.QtCore import QEvent, QRectF, Qt, QTimer, QUrl
from PySide6.QtGui import QColor, QFont, QFontDatabase, QIntValidator, QKeySequence, QShortcut, QTextCursor
from PySide6.QtWidgets import QApplication, QComboBox, QHBoxLayout, QLabel, QLineEdit, QPlainTextEdit, QPushButton, QStackedWidget, QVBoxLayout, QWidget
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings, QWebEngineUrlRequestInterceptor
from PySide6.QtWebEngineWidgets import QWebEngineView

import main as project
from terminal_theme import apply_theme, native_glass, paint_glass, property_value, TerminalInk

ROOT = project.ROOT
COMMANDS = ('help', 'connect', 'start', 'auto', 'pause', 'resume', 'stop', 'view', 'console', 'mine', 'host', 'username', 'port', 'home', 'portal', 'qwen', 'steps', 'goal', 'model', 'record', 'train', 'demo', 'deposit', 'status', 'inventory', 'xray', 'esp', 'clear', 'exit')
HELP = """start [netherite|enchant|diamonds|iron|stone|wood]
                                  запуск; по умолчанию — незерит
connect                           подключиться и наблюдать
auto on|off                       подготовка и улучшения в добыче
host адрес / username ник         адрес сервера / ник бота
pause / resume / stop              пауза / продолжить / отключить
view / console                    вид от лица бота / журнал · F2
port 25565 / steps 1500 / goal 8    порт мира / лимит шагов / брёвна
model own|demo                     своя / учебная модель
record / train / demo              записать опыт / обучить / демо
train miner                       обучение выбора алмазных жил
home X Y Z                         координаты базы
portal X Y Z [overworld|the_nether] координаты портала
qwen on|off                        Qwen / быстрый выбор жил; для «руды»
deposit home                       руды в сундуки базы
deposit [ник]                      ресурсы в сундук у игрока
status / inventory                 состояние / инвентарь · F3
mine [руда стаки]                  окно добычи; например mine diamond 2
xray on|off / esp on|off|diamond    руды; ESP принимает тип руды
clear / exit                       очистить / закрыть
↑ ↓ история · Tab дополнение · Ctrl+L очистить · Ctrl+C остановить"""


def local_url(value):
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.username or parsed.password or not parsed.port:
        raise ValueError('Нужен адрес локального просмотрщика 127.0.0.1.')
    return f'http://127.0.0.1:{parsed.port}/'


class LogWriter:
    encoding = 'utf-8'

    def __init__(self, messages, logger):
        self.messages = messages
        self.logger = logger

    def write(self, value):
        if value:
            self.messages.put(('log', value))
            if self.logger and value.strip():
                self.logger.info(value.rstrip())
        return len(value)

    def flush(self):
        pass

    def isatty(self):
        return False


class LocalRequests(QWebEngineUrlRequestInterceptor):
    def __init__(self, origin, parent):
        super().__init__(parent)
        self.origin = origin

    def interceptRequest(self, info):
        url = info.requestUrl()
        if url.scheme() in ('data', 'blob', 'qrc', 'about'):
            return
        if url.scheme() not in ('http', 'ws') or url.host() != '127.0.0.1' or url.port() != self.origin.port():
            info.block(True)


class ScenePage(QWebEnginePage):
    def __init__(self, profile, parent):
        super().__init__(profile, parent)
        self.setBackgroundColor(QColor('#11151b'))

    def acceptNavigationRequest(self, url, kind, main_frame):
        origin = self.profile().localRequests.origin
        return url.scheme() == 'about' or (url.scheme() == 'http' and url.host() == '127.0.0.1' and url.port() == origin.port())

    def createWindow(self, kind):
        return None

    def javaScriptConsoleMessage(self, level, message, line, source):
        if level == QWebEnginePage.JavaScriptConsoleMessageLevel.ErrorMessageLevel:
            print(f'view: {message}')


class Caption(QLabel):
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.window().windowHandle().startSystemMove()

    def mouseDoubleClickEvent(self, event):
        window = self.window()
        window.showNormal() if window.isMaximized() else window.showMaximized()


class Terminal(QWidget):
    def __init__(self, redirect=True):
        super().__init__()
        self.setWindowTitle('Neuro Farmer · terminal')
        self.setWindowFlags(Qt.WindowType.Window | Qt.WindowType.FramelessWindowHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.resize(1040, 680)
        self.setMinimumSize(640, 420)
        self.messages = queue.Queue()
        self.control_queue = queue.Queue()
        self.stop_event = threading.Event()
        self.thread = None
        self.current_command = None
        self.next_command = None
        self.closing = False
        self.paused = False
        self.viewer_url = None
        self.web = None
        self.profile = None
        self.view_requested = False
        self.inventory_requested = False
        self.esp = True
        self.ore = 'all'
        self.history = []
        self.history_index = 0
        self.history_draft = ''
        self.last_status = ''
        self.mining_console = None
        self.mining_progress = None
        self.planner_status = None
        self.settings = {'host': '127.0.0.1', 'username': 'NeuroFarmer', 'port': 25565, 'home': {'x': 0, 'y': 64, 'z': 0}, 'steps': 1500, 'goal': 8, 'player': '', 'resource': 'diamond', 'stacks': 1, 'model': 'own' if (ROOT / 'models/brain.npz').exists() else 'demo'}
        self.settings.update(portals={}, auto_develop=True, planner='qwen' if (ROOT / 'models/Qwen3-1.7B-Q8_0.gguf').exists() else 'miner')
        try:
            saved = json.loads((ROOT / 'data/settings.json').read_text(encoding='utf-8'))
            if isinstance(saved, dict):
                for key in ('port', 'steps', 'goal'):
                    value = int(saved.get(key, self.settings[key]))
                    if 0 < value <= (65535 if key == 'port' else 10_000_000):
                        self.settings[key] = value
                self.settings['player'] = str(saved.get('player', ''))[:32]
                if re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}', str(saved.get('host', ''))):
                    self.settings['host'] = saved['host']
                if re.fullmatch(r'[A-Za-z0-9_]{1,16}', str(saved.get('username', ''))):
                    self.settings['username'] = saved['username']
                if saved.get('model') in ('own', 'demo'):
                    self.settings['model'] = saved['model']
                if saved.get('planner') in ('qwen', 'miner'):
                    self.settings['planner'] = saved['planner']
                if type(saved.get('auto_develop')) is bool:
                    self.settings['auto_develop'] = saved['auto_develop']
                portals = saved.get('portals', {})
                if isinstance(portals, dict):
                    for dimension, coordinates in portals.items():
                        if self.valid_portal(dimension, coordinates):
                            self.settings['portals'][dimension] = coordinates.copy()
                from mining_job import ORES
                if saved.get('resource') in ORES:
                    self.settings['resource'] = saved['resource']
                if type(saved.get('stacks')) is int and 1 <= saved['stacks'] <= 576:
                    self.settings['stacks'] = saved['stacks']
                home = saved.get('home')
                if isinstance(home, dict) and all(isinstance(home.get(axis), int) and -30000000 <= home[axis] <= 30000000 for axis in ('x', 'y', 'z')):
                    self.settings['home'] = {axis: home[axis] for axis in ('x', 'y', 'z')}
        except (OSError, ValueError, TypeError):
            pass
        from mining_job import load_job
        self.mining_progress = load_job(ROOT / 'data/mining-job.json', {key: self.settings[key] for key in ('host', 'port', 'username')})
        if self.mining_progress and self.mining_progress['status'] in ('running', 'returning'):
            self.mining_progress.update(status='stopped', message='Прогресс сохранён. Нажми «запуск», чтобы продолжить.')
        families = QFontDatabase.families()
        if not families and sys.platform == 'win32':
            QFontDatabase.addApplicationFont(str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts/consola.ttf'))
            families = QFontDatabase.families()
        family = next((name for name in ('Cascadia Code', 'Consolas', 'DejaVu Sans Mono') if name in families), None)
        font = QFont(family, 11) if family else QFontDatabase.systemFont(QFontDatabase.SystemFont.FixedFont)
        font.setStyleHint(QFont.StyleHint.Monospace)
        self.setFont(font)
        apply_theme(self)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(26, 16, 26, 22)
        layout.setSpacing(12)
        caption = QHBoxLayout()
        self.caption = Caption('neuro / terminal')
        self.caption.setObjectName('caption')
        caption.addWidget(self.caption, 1)
        self.connection = QLabel('offline')
        self.connection.setObjectName('connection')
        self.connection.setAccessibleName('Режим управления ботом')
        caption.addWidget(self.connection)
        caption.addSpacing(14)
        for label, name, action in (('−', 'minimize', self.showMinimized), ('□', 'maximize', self.toggle_maximize), ('×', 'close', self.close)):
            button = QPushButton(label)
            button.setObjectName('close' if name == 'close' else 'windowControl')
            button.setAccessibleName(name)
            button.setFixedSize(28, 24)
            button.clicked.connect(action)
            caption.addWidget(button)
        layout.addLayout(caption)
        self.stack = QStackedWidget()
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumBlockCount(2000)
        self.log.setFrameShape(QPlainTextEdit.Shape.NoFrame)
        self.log.setAccessibleName('Журнал терминала')
        self.ink = TerminalInk(self.log.document())
        self.stack.addWidget(self.log)
        layout.addWidget(self.stack, 1)
        task_row = QHBoxLayout()
        task_row.setSpacing(4)
        self.task_buttons = {}
        for label, command in (('старт', 'start netherite'), ('кирка', 'start enchant'), ('руды', 'mine'), ('вид', 'view'), ('инв', 'inventory'), ('дом', 'deposit home'), ('пауза', 'pause'), ('стоп', 'stop')):
            if command in ('view', 'pause'):
                task_row.addStretch(1)
            button = QPushButton(label)
            button.setObjectName('task')
            button.setAccessibleName(label)
            button.setToolTip({'view': 'Вид от лица бота · F2', 'inventory': 'Инвентарь · F3', 'mine': 'Руда и количество', 'deposit home': 'Вернуться и сложить ресурсы', 'start netherite': 'Автопилот: незеритовое снаряжение', 'start enchant': 'Автопилот: зачарование кирки', 'pause': 'Приостановить движение', 'stop': 'Остановить и отключиться'}[command])
            button.setProperty('primary', command == 'start netherite')
            button.setProperty('danger', command == 'stop')
            self.task_buttons[command] = button
            if command == 'pause':
                self.pause_button = button
            button.clicked.connect(lambda checked=False, value=command: self.execute('resume' if value == 'pause' and self.paused else value))
            task_row.addWidget(button)
        layout.addLayout(task_row)
        tabs = QHBoxLayout()
        tabs.setSpacing(4)
        self.coordinate_tabs = {}
        for label, index in (('дом', 0), ('портал', 1)):
            button = QPushButton(label)
            button.setObjectName('coordinateTab')
            button.setAccessibleName(f'Вкладка координат: {label}')
            button.clicked.connect(lambda checked=False, page=index: self.select_coordinates(page))
            self.coordinate_tabs[index] = button
            tabs.addWidget(button)
        tabs.addStretch(1)
        self.qwen_button = QPushButton('qwen')
        self.qwen_button.setObjectName('coordinateTab')
        self.qwen_button.setCheckable(True)
        self.qwen_button.setChecked(self.settings['planner'] == 'qwen')
        self.qwen_button.setAccessibleName('Планировщик Qwen для добычи руд')
        self.qwen_button.setToolTip('Локальный Qwen3 1.7B выбирает жилы в режиме «руды». Выключено — быстрый miner.')
        self.qwen_button.clicked.connect(lambda checked: self.set_planner('qwen' if checked else 'miner'))
        property_value(self.qwen_button, 'active', self.qwen_button.isChecked())
        tabs.addWidget(self.qwen_button)
        layout.addLayout(tabs)
        self.coordinate_stack = QStackedWidget()
        home_page = QWidget()
        home_row = QHBoxLayout(home_page)
        home_row.setContentsMargins(0, 0, 0, 0)
        home_row.setSpacing(8)
        home_label = QLabel('home')
        home_label.setObjectName('hint')
        home_row.addWidget(home_label)
        self.home_fields = {}
        for axis in ('x', 'y', 'z'):
            axis_label = QLabel(axis.upper())
            axis_label.setObjectName('hint')
            home_row.addWidget(axis_label)
            field = QLineEdit(str(self.settings['home'][axis]))
            field.setObjectName('coordinate')
            field.setAccessibleName(f'Координата дома {axis.upper()}')
            field.setFixedWidth(68)
            field.setValidator(QIntValidator(-64 if axis == 'y' else -30000000, 320 if axis == 'y' else 30000000, field))
            field.setToolTip(f'Координата дома {axis.upper()}')
            field.setPlaceholderText(axis.upper())
            field.editingFinished.connect(self.update_home)
            self.home_fields[axis] = field
            home_row.addWidget(field)
        home_row.addStretch(1)
        hint = QLabel('F2 вид · F3 инв')
        hint.setObjectName('hint')
        home_row.addWidget(hint)
        self.coordinate_stack.addWidget(home_page)
        portal_page = QWidget()
        portal_row = QHBoxLayout(portal_page)
        portal_row.setContentsMargins(0, 0, 0, 0)
        portal_row.setSpacing(8)
        self.portal_dimension = QComboBox()
        self.portal_dimension.setObjectName('dimension')
        self.portal_dimension.addItem('обычный мир', 'overworld')
        self.portal_dimension.addItem('незер', 'the_nether')
        self.portal_dimension.setFixedWidth(130)
        self.portal_dimension.setAccessibleName('Измерение портала')
        portal_row.addWidget(self.portal_dimension)
        self.portal_fields = {}
        for axis in ('x', 'y', 'z'):
            label = QLabel(axis.upper())
            label.setObjectName('hint')
            portal_row.addWidget(label)
            field = QLineEdit()
            field.setObjectName('coordinate')
            field.setAccessibleName(f'Координата портала {axis.upper()}')
            field.setFixedWidth(68)
            field.setPlaceholderText('—')
            field.setValidator(QIntValidator(-64 if axis == 'y' else -30000000, 320 if axis == 'y' else 30000000, field))
            field.editingFinished.connect(self.update_portal)
            self.portal_fields[axis] = field
            portal_row.addWidget(field)
        portal_row.addStretch(1)
        self.clear_portal_button = QPushButton('сброс')
        self.clear_portal_button.setObjectName('coordinateTab')
        self.clear_portal_button.setToolTip('Убрать ручные координаты этого измерения')
        self.clear_portal_button.clicked.connect(self.clear_portal)
        portal_row.addWidget(self.clear_portal_button)
        self.portal_dimension.currentIndexChanged.connect(self.load_portal_fields)
        self.load_portal_fields()
        self.coordinate_stack.addWidget(portal_page)
        self.select_coordinates(0)
        layout.addWidget(self.coordinate_stack)
        command_bar = QWidget()
        command_bar.setObjectName('commandBar')
        prompt_row = QHBoxLayout(command_bar)
        prompt_row.setContentsMargins(12, 4, 12, 4)
        prompt_row.setSpacing(10)
        self.prompt = QLabel('neuro@minecraft ~ $')
        self.prompt.setObjectName('prompt')
        prompt_row.addWidget(self.prompt)
        self.entry = QLineEdit()
        self.entry.setAccessibleName('Команда боту')
        self.entry.setPlaceholderText('help')
        self.entry.returnPressed.connect(self.submit)
        self.entry.installEventFilter(self)
        prompt_row.addWidget(self.entry, 1)
        layout.addWidget(command_bar)
        for key, action in (('F2', self.toggle_view), ('F3', self.toggle_inventory), ('Escape', self.hide_inventory_or_console), ('Ctrl+L', self.log.clear), ('Ctrl+C', self.stop)):
            shortcut = QShortcut(QKeySequence(key), self)
            shortcut.setContext(Qt.ShortcutContext.WindowShortcut)
            shortcut.activated.connect(action)
        self.entry.setFocus()
        self.original_streams = (sys.stdout, sys.stderr)
        self.logger = None
        if redirect:
            try:
                (ROOT / 'data').mkdir(exist_ok=True)
                self.logger = logging.getLogger('minecraft.terminal')
                self.logger.setLevel(logging.INFO)
                self.logger.propagate = False
                handler = RotatingFileHandler(ROOT / 'data/session.log', maxBytes=2_000_000, backupCount=2, encoding='utf-8')
                handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
                self.logger.addHandler(handler)
                logging.raiseExceptions = False
            except OSError:
                self.logger = None
            sys.stdout = sys.stderr = LogWriter(self.messages, self.logger)
        self.write(f"{self.settings['username']} @ {self.settings['host']}:{self.settings['port']}\n")
        self.write('help — команды    view — вид от лица бота\n\n')
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.poll)
        self.timer.start(50)
        self.refresh_chrome()

    def toggle_maximize(self):
        self.showNormal() if self.isMaximized() else self.showMaximized()

    def showEvent(self, event):
        super().showEvent(event)
        native_glass(self)

    def paintEvent(self, event):
        paint_glass(self)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton and not self.isMaximized():
            p = event.position()
            edges = Qt.Edge(0)
            if p.x() < 10:
                edges |= Qt.Edge.LeftEdge
            elif p.x() > self.width() - 10:
                edges |= Qt.Edge.RightEdge
            if p.y() < 8:
                edges |= Qt.Edge.TopEdge
            elif p.y() > self.height() - 8:
                edges |= Qt.Edge.BottomEdge
            if edges:
                self.windowHandle().startSystemResize(edges)
        super().mousePressEvent(event)

    def eventFilter(self, obj, event):
        if obj is self.entry and event.type() == QEvent.Type.KeyPress:
            key = event.key()
            if key in (Qt.Key.Key_Up, Qt.Key.Key_Down):
                if self.history_index == len(self.history):
                    self.history_draft = self.entry.text()
                self.history_index = max(0, min(len(self.history), self.history_index + (-1 if key == Qt.Key.Key_Up else 1)))
                self.entry.setText(self.history[self.history_index] if self.history_index < len(self.history) else self.history_draft)
                return True
            if key == Qt.Key.Key_Tab:
                matches = [value for value in COMMANDS if value.startswith(self.entry.text())]
                if len(matches) == 1:
                    self.entry.setText(matches[0] + ' ')
                return True
        return super().eventFilter(obj, event)

    def write(self, text):
        bar = self.log.verticalScrollBar()
        follow = bar.value() >= bar.maximum() - 2 and not self.log.textCursor().hasSelection()
        position = bar.value()
        cursor = QTextCursor(self.log.document())
        cursor.movePosition(QTextCursor.MoveOperation.End)
        cursor.insertText(text[-65536:])
        bar.setValue(bar.maximum() if follow else position)

    def update_home(self):
        try:
            home = {axis: int(field.text()) for axis, field in self.home_fields.items()}
            if any(abs(number) > 30000000 for number in home.values()) or not -64 <= home['y'] <= 320:
                raise ValueError()
        except ValueError:
            for field in self.home_fields.values():
                property_value(field, 'invalid', not field.hasAcceptableInput())
            self.write('Дом: укажи целые X/Z и высоту Y от -64 до 320.\n')
            return False
        for field in self.home_fields.values():
            property_value(field, 'invalid', False)
        previous = self.settings['home']
        self.settings['home'] = home
        if self.running and previous != home:
            self.control_queue.put({'command': 'set_home', 'home': home.copy()})
        self.save_settings()
        return True

    def submit(self):
        value = self.entry.text().strip()
        self.entry.clear()
        if not value:
            return
        if not self.history or self.history[-1] != value:
            self.history.append(value)
            self.history = self.history[-200:]
        self.history_index = len(self.history)
        self.history_draft = ''
        self.execute(value)

    @staticmethod
    def valid_portal(dimension, coordinates):
        return (dimension in ('overworld', 'the_nether') and isinstance(coordinates, dict)
                and all(type(coordinates.get(axis)) is int and abs(coordinates[axis]) <= 30000000 for axis in ('x', 'y', 'z'))
                and (0 <= coordinates['y'] <= 255 if dimension == 'the_nether' else -64 <= coordinates['y'] <= 320))

    def select_coordinates(self, page):
        self.coordinate_stack.setCurrentIndex(page)
        for index, button in self.coordinate_tabs.items():
            property_value(button, 'active', page == index)

    def load_portal_fields(self):
        dimension = self.portal_dimension.currentData()
        value = self.settings['portals'].get(dimension, {})
        self.portal_fields['y'].setValidator(QIntValidator(0 if dimension == 'the_nether' else -64, 255 if dimension == 'the_nether' else 320, self.portal_fields['y']))
        for axis, field in self.portal_fields.items():
            field.setText(str(value[axis]) if axis in value else '')
            property_value(field, 'invalid', False)

    def update_portal(self):
        if all(not field.text().strip() for field in self.portal_fields.values()):
            return True
        dimension = self.portal_dimension.currentData()
        try:
            coordinates = {axis: int(field.text()) for axis, field in self.portal_fields.items()}
            if not self.valid_portal(dimension, coordinates):
                raise ValueError()
        except ValueError:
            for field in self.portal_fields.values():
                property_value(field, 'invalid', not field.hasAcceptableInput())
            return False
        previous = self.settings['portals'].get(dimension)
        self.settings['portals'][dimension] = coordinates
        for field in self.portal_fields.values():
            property_value(field, 'invalid', False)
        if previous != coordinates:
            self.save_settings()
            if self.running:
                self.control_queue.put({'command': 'set_portals', 'portals': {key: value.copy() for key, value in self.settings['portals'].items()}})
        return True

    def clear_portal(self):
        self.settings['portals'].pop(self.portal_dimension.currentData(), None)
        self.load_portal_fields()
        self.save_settings()
        if self.running:
            self.control_queue.put({'command': 'set_portals', 'portals': {key: value.copy() for key, value in self.settings['portals'].items()}})

    def set_planner(self, mode):
        if self.running and self.current_command != 'connect':
            self.qwen_button.setChecked(self.settings['planner'] == 'qwen')
            self.write('Планировщик: сначала останови добычу, затем выбери режим.\n')
            return
        if mode == 'qwen' and not all(path.exists() for path in (ROOT / 'models/Qwen3-1.7B-Q8_0.gguf', ROOT / 'runtime/qwen/llama-server.exe')):
            self.qwen_button.setChecked(False)
            self.write('Qwen: нужен полный комплект с моделью и runtime/qwen.\n')
            return
        self.settings['planner'] = mode
        self.qwen_button.setChecked(mode == 'qwen')
        property_value(self.qwen_button, 'active', mode == 'qwen')
        self.save_settings()
        self.write('Руды: ' + ('Qwen3 1.7B + игровые навыки.\n' if mode == 'qwen' else 'Быстрый выбор жил miner.\n'))

    def execute(self, value):
        self.write(f'\n$ {value}\n')
        try:
            words = shlex.split(value)
            if not words:
                return
            command, args = words[0].lower(), words[1:]
            if command == 'help' and not args:
                self.write(HELP + '\n')
                self.show_console()
            elif command in ('host', 'username') and len(args) == 1:
                if self.running:
                    raise ValueError('Сначала stop, затем измени подключение.')
                pattern = r'[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}' if command == 'host' else r'[A-Za-z0-9_]{1,16}'
                if not re.fullmatch(pattern, args[0]):
                    raise ValueError('Укажи адрес сервера без http:// или ник Minecraft до 16 символов.')
                self.settings[command] = args[0]
                self.save_settings()
                self.write(f'{command} = {args[0]}\n')
            elif command == 'connect' and not args:
                self.start('connect')
            elif command == 'qwen' and len(args) == 1 and args[0] in ('on', 'off'):
                self.set_planner('qwen' if args[0] == 'on' else 'miner')
            elif command == 'portal' and len(args) in (3, 4):
                dimension = args[3] if len(args) == 4 else 'overworld'
                coordinates = dict(zip(('x', 'y', 'z'), map(int, args[:3])))
                if not self.valid_portal(dimension, coordinates):
                    raise ValueError('Портал: X Y Z и измерение overworld или the_nether; Y в Незере 0…255.')
                self.portal_dimension.setCurrentIndex(self.portal_dimension.findData(dimension))
                for axis, number in coordinates.items():
                    self.portal_fields[axis].setText(str(number))
                self.update_portal()
                self.select_coordinates(1)
            elif command == 'home' and len(args) == 3:
                for axis, value in zip(('x', 'y', 'z'), args):
                    self.home_fields[axis].setText(value)
                if self.update_home():
                    self.write(f"home = {self.settings['home']}\n")
            elif command in ('port', 'steps', 'goal') and len(args) == 1:
                number = int(args[0])
                if not 0 < number <= (65535 if command == 'port' else 10_000_000):
                    raise ValueError('Значение вне допустимого диапазона.')
                if command == 'port' and self.running:
                    raise ValueError('Сначала stop, затем измени порт.')
                self.settings[command] = number
                self.save_settings()
                self.write(f'{command} = {number}\n')
            elif command == 'model' and len(args) == 1 and args[0] in ('own', 'demo'):
                self.settings['model'] = args[0]
                self.save_settings()
                self.write(f"model = {args[0]}\n")
            elif command == 'auto' and len(args) == 1 and args[0] in ('on', 'off'):
                self.settings['auto_develop'] = args[0] == 'on'
                self.save_settings()
                self.write(f'auto = {args[0]} · применяется при следующем запуске задачи\n')
            elif command == 'start' and len(args) <= 1:
                mission = args[0] if args else 'netherite'
                modes = {'wood': 'run', 'stone': 'mission', 'iron': 'iron', 'diamonds': 'diamonds', 'enchant': 'enchant', 'netherite': 'netherite'}
                if mission not in modes:
                    raise ValueError('start netherite|enchant|diamonds|iron|stone|wood')
                self.start(modes[mission])
            elif command == 'train' and args == ['miner']:
                self.start('train_miner')
            elif command in ('train', 'record', 'demo') and not args:
                self.start(command)
            elif command == 'deposit' and len(args) <= 1:
                if args == ['home']:
                    if not self.update_home():
                        return
                    if self.running:
                        self.control_queue.put({'command': 'home_deposit', 'all': True})
                        self.write('Возврат домой и разгрузка поставлены в очередь.\n')
                    else:
                        self.start('home_deposit')
                    return
                if args:
                    if not args[0].isascii() or not args[0].replace('_', '').isalnum() or len(args[0]) > 16:
                        raise ValueError('Укажи ник Minecraft: буквы, цифры, _, до 16 символов.')
                    self.settings['player'] = args[0]
                    self.save_settings()
                if self.running:
                    self.control_queue.put({'command': 'deposit', 'player': self.settings['player']})
                    self.write('Разгрузка в очереди после текущего действия.\n')
                else:
                    self.start('deposit')
            elif command in ('pause', 'resume') and not args:
                self.control('pause', enabled=command == 'pause')
            elif command == 'stop' and not args:
                self.stop()
            elif command == 'view' and not args:
                self.show_view()
            elif command == 'console' and not args:
                self.show_console()
            elif command == 'xray' and len(args) == 1 and args[0] in ('on', 'off'):
                self.control('xray', enabled=args[0] == 'on')
            elif command == 'esp' and len(args) == 1:
                filters = ('all', 'coal', 'copper', 'iron', 'gold', 'redstone', 'lapis', 'diamond', 'emerald', 'quartz', 'ancient_debris', 'lava')
                if args[0] in ('on', 'off'):
                    self.esp = args[0] == 'on'
                elif args[0] in filters:
                    self.ore, self.esp = args[0], True
                else:
                    raise ValueError('esp on|off|all|diamond|iron|coal|gold|redstone|lapis|copper|emerald|quartz|ancient_debris')
                self.apply_esp()
                self.write(f"esp = {'on' if self.esp else 'off'} · {self.ore}\n")
            elif command == 'inventory' and not args:
                self.toggle_inventory()
            elif command == 'mine' and not args:
                self.show_mining_console()
            elif command == 'mine' and len(args) == 2:
                self.start_resource(args[0], int(args[1]))
            elif command == 'status' and not args:
                self.fetch_state(command)
            elif command == 'clear' and not args:
                self.log.clear()
            elif command == 'exit' and not args:
                self.close()
            else:
                raise ValueError('Неизвестная команда или параметры. Введи help.')
        except (ValueError, OSError) as error:
            self.write(f'{error}\n')
            self.show_console()

    @property
    def running(self):
        return bool(self.thread and self.thread.is_alive())

    def save_settings(self):
        try:
            directory = ROOT / 'data'
            directory.mkdir(exist_ok=True)
            temporary = directory / 'settings.tmp'
            temporary.write_text(json.dumps(self.settings, ensure_ascii=False, indent=2), encoding='utf-8')
            temporary.replace(directory / 'settings.json')
        except OSError as error:
            self.write(f'Настройки не сохранены: {error}\n')

    def show_mining_console(self):
        if self.mining_console is None:
            from mining_console import MiningConsole
            self.mining_console = MiningConsole(self)
            if self.mining_progress:
                self.mining_console.update_progress(self.mining_progress)
        self.mining_console.show()
        self.mining_console.raise_()
        self.mining_console.activateWindow()

    def start_resource(self, resource, stacks):
        from mining_job import ORES
        if resource not in ORES or type(stacks) is not int or not 1 <= stacks <= 576:
            raise ValueError('Выбери руду и количество от 1 до 576 стаков.')
        self.settings.update(resource=resource, stacks=stacks)
        self.save_settings()
        self.show_mining_console()
        self.mining_console.ore.setCurrentIndex(self.mining_console.ore.findData(resource))
        self.mining_console.stacks.setValue(stacks)
        self.start('resource', force_restart=True)

    def start(self, command, force_restart=False):
        if not self.update_home():
            return
        if self.closing:
            return
        if self.running:
            if command == self.current_command and not force_restart:
                self.write('Эта задача уже запущена.\n')
            else:
                self.next_command = command
                self.stop(cancel_next=False)
                self.write(f'Следующая задача: {command}\n')
            return
        model = ROOT / 'models' / ('brain.npz' if self.settings['model'] == 'own' or command == 'train' else 'demo.npz')
        if command not in ('record', 'train', 'train_miner', 'demo', 'connect', 'home_deposit', 'resource') and not model.exists():
            self.write('Нет своей модели. record → train или model demo.\n')
            return
        if command == 'demo':
            model = ROOT / 'models/demo.npz'
        args = argparse.Namespace(command=command, port=self.settings['port'], goal=self.settings['goal'], steps=self.settings['steps'],
                                  host=self.settings['host'], username=self.settings['username'], version='1.20.1', home=self.settings['home'].copy(), auth='offline', manual=False, epochs=120, seed=42,
                                  data=ROOT / 'data/episodes.jsonl', model=model, viewer=True, keep_viewer=True,
                                  control_queue=self.control_queue, player=self.settings['player'], no_browser=True,
                                  viewer_callback=lambda url: self.messages.put(('viewer', url)),
                                  pause_callback=lambda enabled: self.messages.put(('paused', enabled)),
                                  resource=self.settings['resource'], stacks=self.settings['stacks'],
                                  planner=self.settings['planner'], auto_develop=self.settings['auto_develop'], portals={key: value.copy() for key, value in self.settings['portals'].items()},
                                  planner_callback=lambda status: self.messages.put(('planner', status)),
                                  mining_callback=lambda progress: self.messages.put(('mining', progress)),
                                  status_callback=lambda text: self.messages.put(('status', text)))
        self.save_settings()
        self.paused = False
        self.planner_status = None
        self.stop_event.clear()
        while not self.control_queue.empty():
            self.control_queue.get_nowait()
        self.viewer_url = None
        self.view_requested = command not in ('demo', 'train')
        self.unload_scene()
        self.write(f"{command} · {args.username} @ {args.host}:{args.port}\n")
        self.thread = threading.Thread(target=self.work, args=(args,), daemon=True)
        self.current_command = command
        self.thread.start()

    def work(self, args):
        success = False
        try:
            if args.command == 'connect':
                project.connect(args, stop_event=self.stop_event)
            elif args.command == 'resource':
                project.mine_quota(args, stop_event=self.stop_event)
            elif args.command in ('record', 'run'):
                project.play(args, stop_event=self.stop_event)
            elif args.command in ('mission', 'iron', 'diamonds', 'enchant', 'netherite', 'deposit', 'home_deposit'):
                project.mission(args, stop_event=self.stop_event)
            elif args.command == 'train':
                project.train(args, stop_event=self.stop_event)
            elif args.command == 'train_miner':
                from miner_learning import course
                course(args, stop_event=self.stop_event)
            else:
                project.demo(args)
            success = True
            self.messages.put(('log', 'Операция завершена.\n'))
        except InterruptedError:
            self.messages.put(('log', 'Остановлено. Бот отключён.\n'))
        except Exception as error:
            if self.logger:
                self.logger.exception('Ошибка задачи %s: %s',args.command,error)
            self.messages.put(('log', f'Ошибка: {error}\n'))
        finally:
            self.messages.put(('done', (args.command, success)))

    def stop(self, cancel_next=True):
        if cancel_next:
            self.next_command = None
        if self.running:
            self.stop_event.set()
            self.write('Останавливаем…\n')
        else:
            self.write('Бот отключён.\n')

    def control(self, command, **extra):
        if not self.viewer_url:
            raise ValueError('Сначала start и дождись подключения к миру.')
        base = self.viewer_url
        def send():
            try:
                request = urllib.request.Request(base + 'api/control', data=json.dumps({'command': command, **extra}).encode(), headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(request, timeout=6) as response:
                    result = json.load(response)
                if command == 'pause':
                    self.messages.put(('paused', bool(result['paused'])))
                else:
                    self.messages.put(('log', f"{command} = {'on' if extra.get('enabled') else 'off'}\n"))
            except Exception as error:
                self.messages.put(('log', f'{command}: {error}\n'))
        threading.Thread(target=send, daemon=True).start()

    def fetch_state(self, kind):
        if not self.viewer_url:
            self.write(f"offline · {self.settings['username']} @ {self.settings['host']}:{self.settings['port']} · model {self.settings['model']}\n")
            if kind == 'inventory':
                self.write('Для актуального инвентаря подключись к миру.\n')
            return
        base = self.viewer_url
        def fetch():
            try:
                with urllib.request.urlopen(base + 'api/state?oreRevision=none', timeout=4) as response:
                    state = json.loads(response.read(2_000_000))
                self.messages.put(('state', (kind, state)))
            except Exception as error:
                self.messages.put(('log', f'{kind}: {error}\n'))
        threading.Thread(target=fetch, daemon=True).start()
        if kind == 'status' and self.web:
            self.web.page().runJavaScript('window.mineFps || 0', lambda fps: self.write(f'view: {fps} FPS · target 120\n') if fps else None)

    def apply_esp(self):
        if self.web:
            self.web.page().runJavaScript(f'window.setMineESP && window.setMineESP({json.dumps(self.esp)}, {json.dumps(self.ore)})')

    def show_view(self):
        self.view_requested = True
        if not self.viewer_url:
            self.write('Вид появится после подключения. start — запуск.\n')
            return
        if self.web is None:
            self.profile = QWebEngineProfile(self)
            self.profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.MemoryHttpCache)
            self.profile.setPersistentCookiesPolicy(QWebEngineProfile.PersistentCookiesPolicy.NoPersistentCookies)
            self.profile.localRequests = LocalRequests(QUrl(self.viewer_url), self.profile)
            self.profile.setUrlRequestInterceptor(self.profile.localRequests)
            self.web = QWebEngineView()
            self.web.setAccessibleName('Вид от лица бота')
            page = ScenePage(self.profile, self.web)
            self.web.setPage(page)
            page.settings().setAttribute(QWebEngineSettings.WebAttribute.JavascriptCanOpenWindows, False)
            page.settings().setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, False)
            self.web.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
            self.web.loadFinished.connect(self.scene_loaded)
            self.stack.addWidget(self.web)
            self.web.setUrl(QUrl(self.viewer_url + 'scene'))
        self.stack.setCurrentWidget(self.web)
        self.entry.setFocus()

    def scene_loaded(self, ok):
        if ok:
            self.apply_esp()
            if self.inventory_requested:
                self.web.page().runJavaScript('window.setMineInventory && window.setMineInventory(true)')
        elif self.viewer_url and not self.closing:
            self.write('Просмотрщик недоступен. Проверь подключение; повтори view.\n')
            self.unload_scene()
            self.show_console()

    def unload_scene(self):
        self.stack.setCurrentWidget(self.log)
        if self.web:
            self.web.stop()
            self.stack.removeWidget(self.web)
            self.web.deleteLater()
            self.web = None
        if self.profile:
            self.profile.deleteLater()
            self.profile = None

    def show_console(self):
        self.inventory_requested = False
        self.view_requested = False
        self.stack.setCurrentWidget(self.log)
        self.entry.setFocus()

    def toggle_view(self):
        self.show_console() if self.web and self.stack.currentWidget() is self.web else self.show_view()

    def toggle_inventory(self):
        if not self.viewer_url:
            self.fetch_state('inventory')
            return
        visible = self.web is not None and self.stack.currentWidget() is self.web
        if visible:
            def changed(opened):
                self.inventory_requested = bool(opened)
            self.web.page().runJavaScript('window.toggleMineInventory && window.toggleMineInventory()', changed)
        else:
            self.inventory_requested = True
            self.show_view()
            if self.web:
                self.web.page().runJavaScript('window.setMineInventory && window.setMineInventory(true)')

    def hide_inventory_or_console(self):
        if self.web and self.stack.currentWidget() is self.web:
            def hidden(was_open):
                self.inventory_requested = False
                if not was_open:
                    self.show_console()
            self.web.page().runJavaScript('Boolean(document.getElementById("inventory") && !document.getElementById("inventory").hidden) && (window.setMineInventory(false), true)', hidden)
        else:
            self.show_console()

    def refresh_chrome(self):
        mode = {'run': 'нейросеть', 'record': 'запись', 'train': 'обучение', 'train_miner': 'обучение жил', 'demo': 'демо', 'connect': 'online'}.get(self.current_command, 'автопилот')
        if self.current_command == 'resource' and self.mining_progress and self.mining_progress.get('resource') == 'diamond' and self.mining_progress.get('policy', {}).get('name') == 'miner-12x32x16':
            mode = 'нейросеть + навыки'
        if self.planner_status:
            mode = {'thinking': 'Qwen · выбор жилы', 'active': 'Qwen + навыки', 'scouting': 'навыки · поиск руд'}.get(self.planner_status, 'Qwen')
        if self.current_command == 'resource' and self.mining_progress and self.mining_progress.get('planner'):
            status = self.mining_progress['planner'].get('status')
            mode = {'waiting': 'Qwen · ожидание', 'thinking': 'Qwen · выбор жилы', 'scouting': 'навыки · поиск руд', 'active': 'Qwen + навыки', 'error': 'Qwen · ошибка'}.get(status, 'Qwen')
        if not self.running:
            mode = 'offline'
        elif self.paused:
            mode += ' · пауза'
        elif self.current_command == 'resource' and self.mining_progress and self.mining_progress['status'] == 'returning':
            mode += ' · домой'
        elif not self.viewer_url and self.current_command not in ('train', 'train_miner', 'demo'):
            mode += ' · подключение'
        if self.connection.text() != mode:
            self.connection.setText(mode)
        property_value(self.connection, 'online', bool(self.viewer_url))
        viewing = self.web is not None and self.stack.currentWidget() is self.web
        self.caption.setText('neuro / view' if viewing else 'neuro / terminal')
        for command, active in (('view', viewing), ('inventory', self.inventory_requested), ('pause', self.paused), ('mine', bool(self.mining_console and self.mining_console.isVisible()))):
            property_value(self.task_buttons[command], 'active', active)
        self.pause_button.setEnabled(bool(self.viewer_url))
        self.task_buttons['stop'].setEnabled(self.running)

    def poll(self):
        for _ in range(400):
            try:
                kind, value = self.messages.get_nowait()
            except queue.Empty:
                break
            if kind == 'log':
                self.write(value)
            elif kind == 'status':
                if value != self.last_status:
                    self.last_status = value
            elif kind == 'mining':
                self.mining_progress = value
                if self.mining_console:
                    self.mining_console.update_progress(value)
            elif kind == 'planner':
                self.planner_status = value
            elif kind == 'viewer':
                try:
                    self.viewer_url = local_url(value)
                    self.write('view — смотреть · console — журнал · F2 — переключить\n')
                    if self.view_requested:
                        self.show_view()
                except ValueError as error:
                    self.write(str(error) + '\n')
            elif kind == 'paused':
                if value != self.paused:
                    self.paused = value
                    self.pause_button.setText('дальше' if value else 'пауза')
                    self.write('Пауза.\n' if value else 'Продолжаем.\n')
            elif kind == 'state':
                mode, state = value
                if mode == 'inventory':
                    counts = {}
                    for item in state.get('inventory', []):
                        if item:
                            counts[item['name']] = counts.get(item['name'], 0) + item['count']
                    self.write('\n'.join(f'{name:<28} {count}' for name, count in sorted(counts.items())) + '\n')
                    self.write('armor: ' + ', '.join(f'{slot}={name or "—"}' for slot, name in state.get('armor', {}).items()) + '\n')
                else:
                    self.write(f"{'paused' if state.get('paused') else 'online'} · {state.get('stage', '')}\nhealth {state.get('health', '?')}/20 · food {state.get('food', '?')}/20 · {state.get('position', {})}\n")
            elif kind == 'done':
                command, success = value
                self.current_command = None
                if success and command == 'train':
                    self.settings['model'] = 'own'
                    self.save_settings()
                self.viewer_url = None
                self.paused = False
                self.pause_button.setText('пауза')
                self.unload_scene()
                self.show_console()
                if self.closing:
                    QTimer.singleShot(25, self.close)
                elif self.next_command:
                    following = self.next_command
                    self.next_command = None
                    QTimer.singleShot(75, lambda selected=following: self.start(selected))
        self.refresh_chrome()

    def closeEvent(self, event):
        self.save_settings()
        if self.running:
            self.closing = True
            self.entry.setEnabled(False)
            self.stop()
            event.ignore()
            return
        self.timer.stop()
        self.unload_scene()
        sys.stdout, sys.stderr = self.original_streams
        event.accept()


def launch():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int)
    parser.add_argument('--host')
    parser.add_argument('--username')
    parser.add_argument('--connect', action='store_true')
    parser.add_argument('--mining-menu', action='store_true')
    from mining_job import ORES
    parser.add_argument('--mine-resource', choices=tuple(ORES))
    parser.add_argument('--stacks', type=int, default=1)
    parser.add_argument('--diamonds', action='store_true')
    parser.add_argument('--netherite', action='store_true')
    parser.add_argument('--enchant', action='store_true')
    parser.add_argument('--iron', action='store_true')
    parser.add_argument('--mission', action='store_true')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--self-test', type=Path)
    parser.add_argument('--scene', type=local_url)
    args = parser.parse_args()
    app = QApplication([sys.argv[0]])
    app.setStyle('Fusion')
    app.setApplicationName('NeuroWood Terminal')
    window = Terminal(redirect=not args.self_test)
    if args.mining_menu:
        QTimer.singleShot(250, window.show_mining_console)
    if args.host:
        window.execute(f'host {args.host}')
    if args.username:
        window.execute(f'username {args.username}')
    if args.port:
        window.execute(f'port {args.port}')
    if args.self_test:
        from brain import Brain
        brain = Brain.load(ROOT / 'models/demo.npz')
        result = {'gui': True, 'native_terminal': True, 'embedded_view': True, 'root': str(ROOT), 'model_loaded': True,
                  'action': brain.predict({'log': {'distance': 2, 'can_chop': True}, 'drop': None, 'health': 20, 'food': 20}),
                  'viewer': all((ROOT / name).exists() for name in ('scene.html', 'observer.js', 'esp.js', 'framerate.js', 'items.js'))}
        if args.scene:
            import time
            window.viewer_url = args.scene
            window.show()
            window.show_view()
            started = time.monotonic()
            probe = QTimer(window)
            def finish(code):
                probe.stop()
                args.self_test.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
                window.close()
                QTimer.singleShot(100, lambda: app.exit(code))
            def receive(value):
                if value and probe.isActive():
                    metrics = json.loads(value)
                    if metrics.get('negative', 0) > 0 and metrics.get('fps', 0) > 0:
                        result.update(embedded_verified=True, scene=metrics)
                        window.show_console()
                        result['console_switch'] = window.stack.currentWidget() is window.log
                        window.show_view()
                        result['view_switch'] = window.stack.currentWidget() is window.web
                        finish(0)
            def check():
                if time.monotonic() - started > 30:
                    result.update(embedded_verified=False, error=window.log.toPlainText())
                    finish(1)
                elif window.web:
                    window.web.page().runJavaScript("JSON.stringify({fps:window.mineFps||0,negative:Object.keys(window.mineViewer?.world.sectionMeshs||{}).filter(k=>Number(k.split(',')[1])<0&&window.mineViewer.world.sectionMeshs[k].geometry.attributes.position.count>0).length,camera:window.mineViewer?.camera.position.toArray()})", receive)
            probe.timeout.connect(check)
            probe.start(1000)
            return app.exec()
        args.self_test.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        window.close()
        return 0
    window.show()
    if args.mine_resource:
        QTimer.singleShot(400, lambda: window.start_resource(args.mine_resource, args.stacks))
    if args.connect and not args.mine_resource:
        window.view_requested = True
        QTimer.singleShot(400, lambda: window.start('connect'))
    if args.scene:
        window.viewer_url = args.scene
        window.write('Тест сцены. Бот не подключён к Minecraft.\n')
        QTimer.singleShot(250, window.show_view)
    for selected, command in ((args.netherite, 'netherite'), (args.enchant, 'enchant'), (args.diamonds, 'diamonds'), (args.iron, 'iron'), (args.mission, 'mission')):
        if selected:
            QTimer.singleShot(400, lambda selected_command=command: window.start(selected_command))
            break
    return app.exec()
