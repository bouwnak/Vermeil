"""
gamebuddy.py - your character in a small box over whatever game you're playing (Steam, Epic, GOG, Ubisoft, your own
games and the emulator), like a friend watching next to you.

How it works (beginner version):
- A watcher checks every second which program is in front. If it's a game, her box opens over it, and it hides as soon
  as you switch to something else. When the game closes, so does the box.
- Her box sits in the game's top-left corner. If the picture has black bars at the side that are wide enough (a Game Boy
  or DS game on a wide screen), she moves into the bar. Drag her anywhere and she stays where you put her.
- She commentates: she keeps looking at the game and says what's going on, like a friend watching next to you. The
  picture is of the game's window only, and only while the game is in front. 👁 on the box stops her looking; ✕ closes
  the box for this game. On a local AI each look can take a while on a smaller graphics card, so she runs a bit behind.

A game running in exclusive full screen draws over every other window, so she can't show there: pick "borderless" or
"windowed fullscreen" in that game's video settings.
"""
import base64
import io
import json
import os
import re
import threading
import time

import overlaywin as ow
from paths import data_file

TITLE = "VermeilGameBuddy"
SETTINGS_FILE = data_file("gamebuddy.json")
TIP_EVERY = 20.0             # seconds from one comment to her next look at the game
FIRST_TIP_AFTER = 12.0
AFTER_AN_ERROR = 300.0       # the AI isn't answering: try again later
MIN_BAR = 200                # a black bar this wide (pixels) is room for her
CORNER = 190                 # her box in a corner
BUBBLE_WIDE = 330            # her words next to the box
BUBBLE_TALL = 118            # her words under the box (in a side bar)
MARGIN = 12

say_aloud = None             # the app's "say it out loud" (set by app.py)
on_game_front = None         # called with True / False when a game comes to the front or leaves it (set by app.py)
get_look = None              # the app's character: name, model, outfit, hair
retro_title = ""             # the emulator's game right now (skills/retroplay.py)


# ---------------- on / off ----------------
def settings():
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            return {"on": True, "see": True, **json.load(f)}
    except (OSError, ValueError):
        return {"on": True, "see": True}


def save_settings(**changes):
    s = {**settings(), **changes}
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(s, f)
    except OSError as e:
        print(f"[game buddy] couldn't save: {e}")
    return s


# ---------------- which program is a game? ----------------
_dirs, _dirs_at = {}, 0.0


def _game_dirs():
    """{folder (lower case): game name} from the launchers and your own games, read again every few minutes"""
    global _dirs, _dirs_at
    if time.time() - _dirs_at > 300:
        _dirs_at = time.time()
        found = {}
        try:
            import launchers
            found.update(launchers.game_dirs())
        except Exception as e:  # noqa: BLE001
            print(f"[game buddy] launchers: {e}")
        try:
            import mygames
            for g in mygames.list_games().get("games", []):
                found[os.path.normcase(os.path.join(mygames.GAMES_DIR, g["folder"]))] = g["name"]
        except Exception as e:  # noqa: BLE001
            print(f"[game buddy] my games: {e}")
        _dirs = found
    return _dirs


def game_name(exe, dirs=None):
    """the game a program belongs to, or None. exe = the program's full path."""
    if not exe:
        return None
    low = os.path.normcase(exe)
    if os.path.basename(low) == "retroarch.exe":
        return retro_title or "this game"
    m = re.search(r"[\\/]steamapps[\\/]common[\\/]([^\\/]+)[\\/]", exe, re.I)
    if m:
        return m.group(1)
    for folder, name in (_game_dirs() if dirs is None else dirs).items():
        if low.startswith(folder + os.sep):
            return name
    return None


# ---------------- where she sits ----------------
def side_bars(grey):
    """how wide the black bars at the left and right of a picture are, as parts of its width. grey: a small greyscale
    picture. None when the middle is dark too (a fade or a loading screen says nothing about bars)."""
    import numpy as np
    a = np.asarray(grey, dtype=np.float32)
    cols = a.mean(axis=0)
    w = len(cols)
    if cols[int(w * 0.4):int(w * 0.6)].mean() < 14:
        return None
    dark = cols < 10
    left = 0
    while left < w and dark[left]:
        left += 1
    right = 0
    while right < w and dark[w - 1 - right]:
        right += 1
    return left / w, right / w


def best_spot(bars, game):
    """-> (mode, x, y, box size). game = the window's (left, top, right, bottom). bars = side_bars(), or None."""
    left, top, right, bottom = game
    width = right - left
    if bars:
        lw, rw = bars[0] * width, bars[1] * width
        room = max(lw, rw)
        if room >= MIN_BAR:
            size = int(min(room - 2 * MARGIN, 320))
            x = left + (lw - size) / 2 if lw >= rw else right - rw + (rw - size) / 2
            return "side", int(x), top + int((bottom - top) * 0.08), size
    return "corner", left + MARGIN, top + MARGIN, CORNER


def window_size(mode, size, talking):
    if mode == "side":
        return size, size + (BUBBLE_TALL if talking else 0)
    return size + (BUBBLE_WIDE if talking else 0), size


# ---------------- her words ----------------
def parse_line(text):
    """the AI's answer -> (what she says, her mood). Nothing usable = she stays quiet."""
    try:
        m = re.search(r"\{.*\}", text or "", re.S)
        d = json.loads(m.group(0)) if m else {}
    except ValueError:
        d = {}
    say = re.sub(r"\s+", " ", str(d.get("say") or "")).strip()[:170]
    mood = str(d.get("mood") or "").lower().strip()
    return say, mood if mood in ("happy", "laugh", "surprised", "think", "sad", "shy", "angry") else ""


def ask_ai(picture, game, name, said):
    """she looks at the game -> (what she says, her mood)"""
    import llm
    small = picture.copy()
    small.thumbnail((448, 448))
    buf = io.BytesIO()
    small.save(buf, "JPEG", quality=70)
    before = f' You just said: {" / ".join(said[-3:])}. Say something new.' if said else ""
    prompt = (f"You are {name}, sitting next to your friend and watching them play {game}. This is their screen right now. "
              "Commentate like a friend on the couch: say what's happening right now, name what you can really see, and add a quick tip or reaction if you have one. "
              f"One short, casual sentence. Only talk about what's in this picture. Leave it empty on a black or loading screen.{before} "
              'Answer only with JSON: {"say": "...", "mood": "happy|laugh|surprised|think|sad|shy|angry"}')
    r = llm.get_client().chat.completions.create(model="vision", max_tokens=80, response_format={"type": "json_object"}, messages=[
        {"role": "user", "content": [{"type": "text", "text": prompt},
                                     {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}}]}])
    return parse_line(r.choices[0].message.content)


class BoxApi:
    """what her box's buttons call. (Names starting with _ stay hidden from the page.)"""
    def __init__(self, session):
        self._s = session

    def info(self):
        look = {}
        try:
            look = get_look() if get_look else {}
        except Exception as e:  # noqa: BLE001
            print(f"[game buddy] look: {e}")
        return {"file": look.get("file"), "outfit": look.get("outfit"), "hair": look.get("hair"), "name": look.get("name") or "Vermeil",
                "game": self._s.game, "see": settings()["see"]}

    def set_see(self, on):
        save_settings(see=bool(on))
        ow.give_focus(self._s.game_hwnd)
        return {"see": bool(on)}

    def close_box(self):
        """hidden until this game closes"""
        self._s.dismissed = True
        self._s.set_visible(False)
        ow.give_focus(self._s.game_hwnd)
        return {"ok": True}

    def move_by(self, dx, dy):
        """you're dragging her: she stays where you put her"""
        s = self._s
        now = ow.rect(s.hwnd)
        if now:
            x, y, w, h = now[0] + int(dx), now[1] + int(dy), now[2] - now[0], now[3] - now[1]
            s.moved_by_you = True
            s.placed = (x, y, w, h)
            ow.place(s.hwnd, x, y, w, h)
        return {"ok": True}

    def back_to_game(self):
        ow.give_focus(self._s.game_hwnd)
        return {"ok": True}


class Session:
    """her box over one game"""
    def __init__(self, game, pid):
        self.game, self.pid = game, pid
        self.game_hwnd = 0
        self.win = None
        self.hwnd = 0
        self.visible = False
        self.dismissed = False
        self.closing = False
        self.moved_by_you = False
        self.placed = None
        self.mode, self.size = "corner", CORNER
        self.talk_until = 0.0
        self.said = []

    def open(self):
        import webview
        page = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui", "buddy.html")
        self.win = webview.create_window(TITLE, page, js_api=BoxApi(self), frameless=True, easy_drag=False, on_top=True, width=CORNER, height=CORNER,
                                         hidden=True, transparent=True, focus=False)
        for _ in range(100):
            self.hwnd = ow.find(TITLE)
            if self.hwnd:
                break
            time.sleep(0.1)
        if self.hwnd:
            ow.never_take_focus(self.hwnd)
            ow.see_through(self.win, self.hwnd)
        threading.Thread(target=self._place_loop, daemon=True, name="buddy-place").start()
        threading.Thread(target=self._tip_loop, daemon=True, name="buddy-tips").start()

    def close(self):
        self.closing = True
        try:
            if self.win:
                self.win.destroy()
        except Exception:  # noqa: BLE001 - it went away with the app
            pass

    def _js(self, code):
        try:
            if self.win:
                self.win.evaluate_js(code)
        except Exception:  # noqa: BLE001 - the page isn't ready yet
            pass

    def set_visible(self, on):
        on = on and not self.dismissed and bool(self.hwnd)
        if on == self.visible:
            return
        self.visible = on
        self._js(f"window.buddy && buddy.pause({json.dumps(not on)})")
        if on:
            self._apply()
            ow.show(self.hwnd)
        elif self.hwnd:
            ow.hide(self.hwnd)

    def _apply(self):
        """put the window where it belongs, at the right size"""
        if not self.hwnd or not self.game_hwnd:
            return
        now = ow.rect(self.hwnd)
        if self.visible and self.placed and now and (abs(now[0] - self.placed[0]) > 3 or abs(now[1] - self.placed[1]) > 3):
            self.moved_by_you = True               # you dragged her: she stays there from now on
        talking = time.time() < self.talk_until
        w, h = window_size(self.mode, self.size, talking)
        x, y = (now[0], now[1]) if self.moved_by_you and now else self._spot_xy()
        if self.placed != (x, y, w, h):
            ow.place(self.hwnd, x, y, w, h)
            self.placed = (x, y, w, h)
            self._js(f"window.buddy && buddy.layout({json.dumps(self.mode)}, {json.dumps(talking)})")

    def _spot_xy(self):
        game = ow.rect(self.game_hwnd) or (0, 0, 0, 0)              # before the first measure: the game's corner
        return getattr(self, "spot_x", game[0] + MARGIN), getattr(self, "spot_y", game[1] + MARGIN)

    def _measure(self):
        """look for black bars at the sides of the game (her own box is painted out so she doesn't count as picture)"""
        game = ow.rect(self.game_hwnd)
        if not game or ow.foreground() not in (self.game_hwnd, self.hwnd):
            return
        from PIL import ImageDraw
        pic = ow.grab(game)
        own = ow.rect(self.hwnd) if self.visible else None
        if own:
            ImageDraw.Draw(pic).rectangle((own[0] - game[0], own[1] - game[1], own[2] - game[0], own[3] - game[1]), fill=(0, 0, 0))
        bars = side_bars(pic.convert("L").resize((160, 90)))
        if bars is None and self.placed:
            return                                  # a dark moment: she stays put
        self.mode, self.spot_x, self.spot_y, self.size = best_spot(bars, game)

    def _place_loop(self):
        measured = 0.0
        while not self.closing:
            try:
                if not self.visible and self.hwnd:
                    ow.hide(self.hwnd)              # a see-through window shows itself as its page loads
                elif ow.foreground() == self.hwnd and not ow.mouse_down():
                    ow.give_focus(self.game_hwnd)   # the keyboard always goes back to the game
                if self.visible:
                    if time.time() - measured > 4 and not self.moved_by_you:
                        measured = time.time()
                        self._measure()
                    self._apply()
            except Exception as e:  # noqa: BLE001
                print(f"[game buddy] place: {type(e).__name__}: {e}")
            time.sleep(0.25)

    def speak(self, text, mood=""):
        self.talk_until = time.time() + max(5.0, len(text) * 0.08)
        self._apply()
        self._js(f"window.buddy && buddy.say({json.dumps(text)}, {json.dumps(mood)}, {int((self.talk_until - time.time()) * 1000)})")
        if say_aloud:
            try:
                say_aloud(text)
            except Exception as e:  # noqa: BLE001
                print(f"[game buddy] voice: {e}")

    def _tip_loop(self, think=None):
        think = think or ask_ai
        next_look = time.time() + FIRST_TIP_AFTER
        while not self.closing:
            time.sleep(1)
            if time.time() < next_look or not self.visible or not settings()["see"] or ow.foreground() not in (self.game_hwnd, self.hwnd):
                continue
            game = ow.rect(self.game_hwnd)
            if not game:
                continue
            try:
                name = (get_look() if get_look else {}).get("name") or "Vermeil"
                text, mood = think(ow.grab(game), self.game, name, self.said)
                next_look = time.time() + TIP_EVERY
                if text and not self.closing and self.visible and not self.dismissed:
                    self.said.append(text)
                    self.speak(text, mood)
            except Exception as e:  # noqa: BLE001 - she just stays quiet
                print(f"[game buddy] look: {type(e).__name__}: {str(e)[:120]}")
                next_look = time.time() + AFTER_AN_ERROR


# ---------------- the watcher ----------------
_session = None
_watching = False
_front = False


def _game_in_front(on):
    global _front
    if on != _front:
        _front = on
        if on_game_front:
            on_game_front(on)


def _exe_of(pid):
    import psutil
    try:
        return psutil.Process(pid).exe()
    except Exception:  # noqa: BLE001 - some programs don't say
        return ""


def _tick():
    """one look at what's in front"""
    global _session
    import psutil
    s = _session
    if s and not psutil.pid_exists(s.pid):
        s.close()
        _session = s = None
    fg = ow.foreground()
    if s and fg == s.hwnd:
        return                                      # you're dragging her: nothing changes
    if not fg or ow.find("VermeilRetroBar") == fg:
        return
    pid = ow.pid_of(fg)
    name = game_name(_exe_of(pid))
    _game_in_front(bool(name))
    if not settings()["on"]:
        if s:
            s.set_visible(False)
        return
    if name:
        if not s or s.pid != pid:
            if s:
                s.close()
            s = _session = Session(name, pid)
            s.game_hwnd = fg
            s.open()
        s.game = name
        s.game_hwnd = fg
        s.set_visible(True)
    elif s:
        s.set_visible(False)


def _watch():
    while _watching:
        try:
            _tick()
        except Exception as e:  # noqa: BLE001
            print(f"[game buddy] {type(e).__name__}: {e}")
        time.sleep(1)


def start_watching():
    """from when the app has opened until it closes"""
    global _watching
    if _watching or not ow.available:
        return
    _watching = True
    threading.Thread(target=_watch, daemon=True, name="game-buddy").start()


def stop_watching():
    global _watching, _session
    _watching = False
    if _session:
        _session.close()
        _session = None
