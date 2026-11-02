"""
retrobar.py - a running retro game, inside Vermeil's window.

RetroArch is its own program, but its window is made a child of Vermeil's (Windows SetParent, as the browser tabs in skills/vbrowser.py),
so no new window opens: the game shows on the stage of the Games hub (ui/games/games.js), under a bar with restart, pause, save, load, speed
and sound. The page says where the stage is (place()). Every button sends RetroArch one of its own network commands
(skills/retroplay.py send_command). RetroArch can make its window again when a core changes the video driver, so the window is watched
for as long as the game runs and put back inside.
"""
import ctypes
from ctypes import wintypes
import threading
import time

import overlaywin as ow
import retroplay
import vbrowser

ALLOWED = {"RESET", "PAUSE_TOGGLE", "SAVE_STATE", "LOAD_STATE", "FAST_FORWARD", "SCREENSHOT", "MUTE", "VOLUME_UP", "VOLUME_DOWN",
           "MENU_TOGGLE", "STATE_SLOT_PLUS", "STATE_SLOT_MINUS"}
HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0, 0x10, 0x40

_game = {"proc": None, "title": "", "hwnd": 0, "rect": None}


def window_of(pid):
    """the biggest visible top-level window of a process, or 0. Once it's inside Vermeil it isn't top-level any more."""
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


def main_window():
    """Vermeil's own window, or 0"""
    try:
        import webview
        return int(webview.windows[0].native.Handle.ToInt64())
    except Exception:  # noqa: BLE001 - no window yet, or not on Windows
        return vbrowser.find_window("Vermeil")


def game_window():
    """the game's window inside Vermeil, or 0"""
    p = _game["proc"]
    return _game["hwnd"] if p and p.poll() is None else 0


def _layout():
    h, r = _game["hwnd"], _game["rect"]
    if h and r:
        ctypes.windll.user32.SetWindowPos(wintypes.HWND(h), HWND_TOP, r["x"], r["y"], r["w"], r["h"], SWP_NOACTIVATE | SWP_SHOWWINDOW)


def place(rect):
    """rect: {x, y, w, h}, the stage in Vermeil's window (pixels)"""
    if rect:
        _game["rect"] = {k: int(round(float(rect[k]))) for k in ("x", "y", "w", "h")}
        _layout()
    return True


def state():
    p = _game["proc"]
    return {"running": bool(p and p.poll() is None), "title": _game["title"]}


def command(name):
    if name not in ALLOWED:
        return {"error": "unknown"}
    retroplay.send_command(name)
    ow.give_focus(game_window())                    # the keys and controller go to the game again
    return {"ok": True}


def leave():
    """close the game. (RetroArch saves the game's own save as it quits.)"""
    p = _game["proc"]
    if p and p.poll() is None:
        retroplay.send_command("QUIT")
        threading.Timer(4, lambda: p.poll() is None and p.terminate()).start()
    return {"ok": True}


def _keep_inside(proc):
    while proc.poll() is None:
        try:
            loose = window_of(proc.pid)
            parent = main_window()
            if loose and parent and vbrowser.embed(loose, parent):
                _game["hwnd"] = loose
                _layout()
        except Exception as e:  # noqa: BLE001 - the game plays on in its own window rather than stopping
            print(f"[retro inside] {type(e).__name__}: {e}")
        time.sleep(0.25)
    if _game["proc"] is proc:
        _game.update(proc=None, hwnd=0, title="")


def attach(proc, title):
    """the game goes inside Vermeil's window, and stays there until it closes"""
    _game.update(proc=proc, title=title, hwnd=0)
    threading.Thread(target=_keep_inside, args=(proc,), daemon=True, name="retro-inside").start()
