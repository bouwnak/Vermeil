"""overlaywin.py - small always-on-top windows over a game: found by title, moved and shown without taking the keyboard
away from the game (the bar in skills/retrobar.py, her box in skills/gamebuddy.py)."""
import ctypes
import sys

GWL_EXSTYLE = -20
WS_EX_LAYERED, LWA_COLORKEY = 0x80000, 1
WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE, WS_EX_TOPMOST = 0x80, 0x08000000, 0x8
SW_HIDE, SW_SHOWNOACTIVATE = 0, 4
HWND_TOPMOST = -1
SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x10, 0x40


def _user32():
    from ctypes import wintypes
    u = ctypes.windll.user32
    u.FindWindowW.restype = wintypes.HWND
    u.GetForegroundWindow.restype = wintypes.HWND
    u.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    u.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    u.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    u.SetForegroundWindow.argtypes = [wintypes.HWND]
    u.IsWindowVisible.argtypes = [wintypes.HWND]
    u.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
    u.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
    u.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    u.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
    u.SetWindowLongPtrW.restype = ctypes.c_ssize_t
    return u


def find(title):
    return _user32().FindWindowW(None, title) or 0


def foreground():
    return _user32().GetForegroundWindow() or 0


def rect(hwnd):
    """(left, top, right, bottom) or None"""
    from ctypes import wintypes
    r = wintypes.RECT()
    if not hwnd or not _user32().GetWindowRect(hwnd, ctypes.byref(r)):
        return None
    return (r.left, r.top, r.right, r.bottom)


def pid_of(hwnd):
    from ctypes import wintypes
    p = wintypes.DWORD()
    _user32().GetWindowThreadProcessId(hwnd, ctypes.byref(p))
    return p.value


def never_take_focus(hwnd):
    """clicking it leaves the keyboard with the game, and it stays out of Alt+Tab and the taskbar"""
    u = _user32()
    u.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, u.GetWindowLongPtrW(hwnd, GWL_EXSTYLE) | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST)


def see_through(win, hwnd):
    """the window's empty parts show what's behind it. The web view is already transparent over the window's own colour:
    that colour is made dark (so soft edges fade into dark, not white) and then cut out."""
    r, g, b = 1, 1, 2
    try:
        from System import Action
        from System.Drawing import Color
        form = win.native
        form.Invoke(Action(lambda: setattr(form, "BackColor", Color.FromArgb(r, g, b))))
    except Exception as e:  # noqa: BLE001 - the default window colour still works, with paler edges
        print(f"[overlay] window colour: {type(e).__name__}: {e}")
        r, g, b = 0xF0, 0xF0, 0xF0
    u = _user32()
    u.SetLayeredWindowAttributes.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_ubyte, ctypes.c_uint32]
    u.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, u.GetWindowLongPtrW(hwnd, GWL_EXSTYLE) | WS_EX_LAYERED)
    u.SetLayeredWindowAttributes(hwnd, r | (g << 8) | (b << 16), 0, LWA_COLORKEY)


def show(hwnd):
    _user32().ShowWindow(hwnd, SW_SHOWNOACTIVATE)


def hide(hwnd):
    _user32().ShowWindow(hwnd, SW_HIDE)


def place(hwnd, x, y, w, h):
    _user32().SetWindowPos(hwnd, HWND_TOPMOST, int(x), int(y), int(w), int(h), SWP_NOACTIVATE)


def give_focus(hwnd):
    if hwnd:
        _user32().SetForegroundWindow(hwnd)


def mouse_down():
    """the left button is held (you may be dragging a window)"""
    return bool(ctypes.windll.user32.GetAsyncKeyState(0x01) & 0x8000)


def grab(game_rect):
    """a picture of the game's window only. With no window there's no picture: never the whole screen."""
    if not game_rect:
        raise ValueError("no game window")
    from PIL import ImageGrab
    return ImageGrab.grab(bbox=game_rect, all_screens=True).convert("RGB")


available = sys.platform == "win32"
