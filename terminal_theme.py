import ctypes
import re
import sys
from pathlib import Path

from PySide6.QtCore import QRectF
from PySide6.QtGui import QColor, QLinearGradient, QPainter, QPalette, QPen, QSyntaxHighlighter, QTextCharFormat

STYLE = '''
QWidget { color: #c9d4cd; background: transparent; font-size: 13px; }
QLabel#caption, QLabel#hint { color: #7f9388; font-size: 11px; }
QLabel#connection { color: #7f9388; font-size: 11px; }
QLabel#connection[online="true"] { color: #a0c4ac; }
QLabel#prompt { color: #a6cfb3; }
QWidget#commandBar { background: #0b100f75; border: 1px solid #29392f; border-radius: 7px; }
QPlainTextEdit { border: 0; background: transparent; selection-background-color: #30483a; selection-color: #edf3ef; }
QLineEdit { border: 0; padding: 4px 0; background: transparent; selection-background-color: #30483a; }
QLineEdit#coordinate { background: #10191599; border: 1px solid #2b3c32; border-radius: 5px; padding: 5px 7px; font-size: 12px; }
QLineEdit#coordinate:focus { border-color: #6c9b7a; background: #142119; }
QLineEdit#coordinate[invalid="true"] { border-color: #b77868; }
QPushButton { color: #99aaa0; background: transparent; border: 1px solid transparent; border-radius: 5px; padding: 6px 10px; font-size: 12px; }
QPushButton:hover { color: #e1e9e3; background: #b4c9ba10; border-color: #384d3f; }
QPushButton:pressed { background: #819c8a20; }
QPushButton:focus { border-color: #769b80; }
QPushButton:disabled { color: #596b5f; }
QPushButton[primary="true"] { color: #bedcc7; background: #263b2b65; border-color: #4b7057; }
QPushButton[primary="true"]:hover { background: #334f3890; border-color: #89b293; }
QPushButton[active="true"] { color: #c1e1cb; background: #28453170; border-color: #4b7057; }
QPushButton[danger="true"]:hover { color: #dfada3; border-color: #76534c; background: #422a2570; }
QPushButton#windowControl { padding: 0; color: #7f9388; font-size: 16px; }
QPushButton#coordinateTab { padding: 4px 10px; font-size: 11px; }
QComboBox#dimension { padding: 3px 8px; min-height: 20px; font-size: 11px; }
QPushButton#close { padding: 0; color: #7f9388; font-size: 17px; }
QPushButton#close:hover { color: #e2b0a3; background: #69433850; border-color: transparent; }
QComboBox, QSpinBox { color: #d4e0d7; background: #111a1590; border: 1px solid #354c3d; border-radius: 6px; padding: 7px 10px; min-height: 22px; }
QComboBox:hover, QSpinBox:hover { border-color: #62836c; }
QComboBox:focus, QSpinBox:focus { border-color: #9cbda3; }
QComboBox::drop-down { border: 0; width: 25px; }
QComboBox QAbstractItemView { background: #131d17; color: #d4e0d7; border: 1px solid #3b5543; padding: 4px; selection-background-color: #2c4533; outline: 0; }
QSpinBox::up-button, QSpinBox::down-button { background: transparent; border: 0; width: 21px; }
QProgressBar { background: #29362e; border: 0; border-radius: 1px; }
QProgressBar::chunk { background: #9ac6a5; border-radius: 1px; }
QScrollBar:vertical { background: transparent; width: 5px; margin: 0; }
QScrollBar::handle:vertical { background: #425649; border-radius: 2px; min-height: 28px; }
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical { background: transparent; }
QToolTip { color: #c9d4cd; background: #17221a; border: 1px solid #405647; padding: 6px; }
'''


def apply_theme(window):
    palette = window.palette()
    for role, color in ((QPalette.ColorRole.Window, '#101711'), (QPalette.ColorRole.Base, '#121c15'),
                        (QPalette.ColorRole.Text, '#d4e0d7'), (QPalette.ColorRole.WindowText, '#c9d4cd'),
                        (QPalette.ColorRole.ButtonText, '#bdcfc1'), (QPalette.ColorRole.Highlight, '#30483a'),
                        (QPalette.ColorRole.PlaceholderText, '#708378')):
        palette.setColor(role, QColor(color))
    window.setPalette(palette)
    assets = (Path(__file__).resolve().parent / 'assets').as_posix()
    window.setStyleSheet(STYLE + f'''QComboBox::down-arrow, QSpinBox::down-arrow {{ image: url("{assets}/down.svg"); width: 12px; height: 12px; }}
QSpinBox::up-arrow {{ image: url("{assets}/up.svg"); width: 12px; height: 12px; }}''')


def property_value(widget, name, value):
    if widget.property(name) != value:
        widget.setProperty(name, value)
        widget.style().unpolish(widget)
        widget.style().polish(widget)
        widget.update()


def paint_glass(window):
    painter = QPainter(window)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    rect = QRectF(window.rect()).adjusted(8, 8, -8, -8)
    painter.setPen(QPen(QColor(0, 0, 0, 14), 1))
    painter.setBrush(QColor(0, 0, 0, 10))
    for spread in (5, 3, 1):
        painter.drawRoundedRect(rect.adjusted(-spread, -spread, spread, spread + 2), 14, 14)
    gradient = QLinearGradient(rect.topLeft(), rect.bottomRight())
    gradient.setColorAt(0, QColor(21, 32, 25, 236))
    gradient.setColorAt(.42, QColor(14, 21, 17, 240))
    gradient.setColorAt(1, QColor(25, 25, 31, 237))
    painter.setBrush(gradient)
    painter.setPen(QPen(QColor(148, 174, 157, 48), 1))
    painter.drawRoundedRect(rect, 12, 12)


def native_glass(window):
    if sys.platform != 'win32':
        return
    try:
        handle = ctypes.c_void_p(int(window.winId()))
        dwm = ctypes.windll.dwmapi
        for attribute, value in ((20, 1), (33, 2), (38, 3)):
            number = ctypes.c_int(value)
            dwm.DwmSetWindowAttribute(handle, attribute, ctypes.byref(number), ctypes.sizeof(number))
        margins = (ctypes.c_int * 4)(-1, -1, -1, -1)
        dwm.DwmExtendFrameIntoClientArea(handle, ctypes.byref(margins))
    except (AttributeError, OSError):
        pass


class TerminalInk(QSyntaxHighlighter):
    def highlightBlock(self, text):
        def ink(start, length, color):
            style = QTextCharFormat()
            style.setForeground(QColor(color))
            self.setFormat(start, length, style)
        if re.search(r'Ошибка|остановлена|не найден|Traceback|Error:|WinError', text, re.I):
            ink(0, len(text), '#d2a397')
        elif text.startswith(('  File ', 'help ', 'view ', 'offline ', 'Выбери ', 'Счётчик ')):
            ink(0, len(text), '#84978b')
        elif text.startswith(('Готово:', 'Продолжаю ', 'Ресурсы в сундуках', '$ ')):
            ink(0, len(text), '#b5d7be')
        for match in re.finditer(r'\b\d+\s*/\s*\d+\b', text):
            ink(match.start(), len(match.group()), '#b8d8c0')
