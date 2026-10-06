from PySide6.QtCore import Qt
from PySide6.QtWidgets import QComboBox, QHBoxLayout, QLabel, QPlainTextEdit, QProgressBar, QPushButton, QSpinBox, QVBoxLayout, QWidget
from mining_job import ORES
from terminal_theme import apply_theme, native_glass, paint_glass, TerminalInk


class DragLabel(QLabel):
    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self.window().windowHandle().startSystemMove()


class MiningConsole(QWidget):
    def __init__(self, owner):
        super().__init__(owner, Qt.WindowType.Window | Qt.WindowType.FramelessWindowHint)
        self.owner = owner
        self.last_progress = None
        self.setWindowTitle('NeuroWood · добыча руд')
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setFont(owner.font())
        self.resize(540, 360)
        self.setMinimumSize(480, 320)
        apply_theme(self)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(26, 16, 26, 24)
        layout.setSpacing(12)
        caption = QHBoxLayout()
        title = DragLabel('neuro / добыча')
        title.setObjectName('caption')
        caption.addWidget(title, 1)
        close = QPushButton('×')
        close.setObjectName('close')
        close.setAccessibleName('Закрыть окно добычи')
        close.setFixedSize(25, 24)
        close.clicked.connect(self.hide)
        caption.addWidget(close)
        layout.addLayout(caption)
        settings = QHBoxLayout()
        self.ore = QComboBox()
        self.ore.setAccessibleName('Руда для добычи')
        for resource, (name, _, _) in ORES.items():
            self.ore.addItem(name, resource)
        self.ore.setCurrentIndex(max(0, self.ore.findData(owner.settings.get('resource', 'diamond'))))
        settings.addWidget(self.ore, 1)
        self.stacks = QSpinBox()
        self.stacks.setRange(1, 576)
        self.stacks.setValue(owner.settings.get('stacks', 1))
        self.stacks.setAccessibleName('Количество стаков')
        self.stacks.setSuffix(' ст.')
        self.stacks.setFixedWidth(122)
        settings.addWidget(self.stacks)
        layout.addLayout(settings)
        self.amount = QLabel()
        self.amount.setObjectName('hint')
        self.stacks.valueChanged.connect(self.update_amount)
        self.update_amount()
        layout.addWidget(self.amount)
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumBlockCount(200)
        self.log.setAccessibleName('Журнал добычи руды')
        self.ink = TerminalInk(self.log.document())
        self.log.setPlainText('Выбери руду и количество.\nПосле сбора — домой, в сундуки.')
        layout.addWidget(self.log, 1)
        self.meter = QProgressBar()
        self.meter.setFixedHeight(2)
        self.meter.setTextVisible(False)
        self.meter.setRange(0, 100)
        self.meter.setValue(0)
        self.meter.setAccessibleName('Собрано от цели')
        layout.addWidget(self.meter)
        row = QHBoxLayout()
        self.progress = QLabel('ожидание')
        self.progress.setObjectName('hint')
        row.addWidget(self.progress, 1)
        start = QPushButton('запуск')
        start.setProperty('primary', True)
        start.setAccessibleName('Начать добычу выбранной руды')
        start.clicked.connect(lambda: owner.start_resource(self.ore.currentData(), self.stacks.value()))
        row.addWidget(start)
        stop = QPushButton('стоп')
        stop.setProperty('danger', True)
        stop.setAccessibleName('Остановить добычу')
        stop.clicked.connect(lambda checked=False: owner.stop())
        row.addWidget(stop)
        layout.addLayout(row)

    def update_amount(self):
        self.amount.setText(f'Цель: {self.stacks.value() * 64} предметов · 1 стак = 64')

    def update_progress(self, job):
        gathered, target = job['gathered'], job['target']
        self.progress.setText(f'{gathered} / {target} · {gathered / 64:.2f} / {job["stacks"]} стака')
        self.meter.setRange(0, max(1, target))
        self.meter.setValue(min(gathered, target))
        key = (gathered, job['status'], job.get('message'))
        if key == self.last_progress:
            return
        self.last_progress = key
        status = {'running': 'добыча', 'returning': 'возврат домой', 'done': 'готово', 'stopped': 'остановлено', 'error': 'остановлено'}[job['status']]
        self.log.appendPlainText(f'{status}: {ORES[job["resource"]][0]} · {gathered}/{target}')
        if job.get('message'):
            self.log.appendPlainText(job['message'])

    def paintEvent(self, event):
        paint_glass(self)

    def showEvent(self, event):
        super().showEvent(event)
        native_glass(self)
