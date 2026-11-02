"""
retrobar.py - the bar over a running retro game (ui/games/retrobar.html): restart, pause, save, load, speed, sound...

RetroArch runs in its own window, so the bar is a small always-on-top window of its own. It shows when the mouse goes
near the bottom of the screen and hides again, like the bar of a video player. Every button sends RetroArch one of its
own network commands (skills/retroplay.py send_command).
"""
import ctypes
from ctypes import wintypes
import os
import threading
import time

import overlaywin as ow
import retroplay

WIDTH, HEIGHT = 860, 62
SHOW_NEAR_BOTTOM = 80        # pixels from the bottom of the screen
ALLOWED = {"RESET", "PAUSE_TOGGLE", "SAVE_STATE", "LOAD_STATE", "FAST_FORWARD", "SCREENSHOT", "MUTE", "VOLUME_UP", "VOLUME_DOWN",
           "MENU_TOGGLE", "FULLSCREEN_TOGGLE", "STATE_SLOT_PLUS", "STATE_SLOT_MINUS"}


def window_of(pid):
    """the biggest visible window of a process (its main one), or 0"""
    user32 = ctypes.windll.user32
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    best, area = 0, 0
    def check(hwnd, _):
        nonlocal best, area
        p, r = wintypes.DWORD(), wintypes.RECT()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid and user32.IsWindowVisible(hwnd) and user32.GetWindowRect(hwnd, ctypes.byref(r)):
            size = (r.right - r.left) * (r.bottom - r.top)
            if size > area:
                best, area = hwnd, size
        return True
    user32.EnumWindows(ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)(check), 0)
    return best


class BarApi:
    """what the bar's buttons call. (Names starting with _ stay hidden from the page.)"""
    def __init__(self, proc, title):
        self._proc, self._title = proc, title

    def _game_window(self):
        return window_of(self._proc.pid) if self._proc.poll() is None else 0

    def _back_to_game(self):
        hwnd = self._game_window()
        if hwnd:
            ctypes.windll.user32.SetForegroundWindow(hwnd)     # the keys and controller go to the game again

    def cmd(self, name):
        if name not in ALLOWED:
            return {"error": "unknown"}
        retroplay.send_command(name)
        self._back_to_game()
        return {"ok": True}

    def leave(self):
        """close the game. (RetroArch saves the game's own save as it quits.)"""
        retroplay.send_command("QUIT")
        threading.Timer(4, lambda: self._proc.poll() is None and self._proc.terminate()).start()
        return {"ok": True}


def attach(proc, title):
    """show the bar for a running game; it closes by itself with the game. Does nothing outside the app's window."""
    try:
        import webview
    except ImportError:
        return
    if not webview.windows:
        return
    W, H = ctypes.windll.user32.GetSystemMetrics(0), ctypes.windll.user32.GetSystemMetrics(1)
    page = os.path.join(retroplay.APP_ROOT, "ui", "retrobar.html")
    win = webview.create_window("VermeilRetroBar", page, js_api=BarApi(proc, title), frameless=True, easy_drag=False, on_top=True,
                                width=min(WIDTH, W - 20), height=HEIGHT, x=max(0, (W - WIDTH) // 2), y=H - HEIGHT - 12,
                                hidden=True, background_color="#0e1116")
    threading.Thread(target=_follow_mouse, args=(proc, win, H), daemon=True, name="retro-bar").start()


def _follow_mouse(proc, win, screen_h):
    class P(ctypes.Structure):
        _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
    shown = False
    last_near = 0.0
    hwnd = 0
    p = P()
    time.sleep(2)                                   # let the page load
    while proc.poll() is None:
        ctypes.windll.user32.GetCursorPos(ctypes.byref(p))
        if p.y >= screen_h - SHOW_NEAR_BOTTOM:
            last_near = time.time()
        want = time.time() - last_near < 2.0
        hwnd = hwnd or ow.find("VermeilRetroBar")
        if hwnd and not shown and want:
            ow.never_take_focus(hwnd)
        if hwnd and want != shown:
            shown = want
            ow.show(hwnd) if want else ow.hide(hwnd)
        time.sleep(0.15)
    try:
        win.destroy()
    except Exception:  # noqa: BLE001
        pass
