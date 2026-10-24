"""
f1.py - Vermeil's feature functions (commands).

Every function returns a short text reply that pinakamain.py speaks or prints.
Heavy libraries (YOLO, OpenCV, sympy, yt-dlp, pycaw) are imported only when the
feature that needs them is used, so Vermeil starts much faster.
"""

# ===== Standard Library =====
import os
import re
import json
import random
import shutil
import smtplib
import datetime
import threading
import time as _time
import subprocess
import queue
import webbrowser
from urllib.parse import quote_plus
from email.mime.text import MIMEText

# ===== Third-Party =====
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the project folder (f1.py is in skills/)
from paths import data_file  # saved files live in the data/ folder
DATA_FILE = data_file("data.json")
NOTES_FILE = data_file("notes.txt")
PLAYLIST_FILE = data_file("playlist.txt")
COOKIES_FILE = data_file("cookies.txt")
BUNDLED_FFPLAY = os.path.join(BASE_DIR, "Packages", "ffmpeg-8.0-full_build", "bin", "ffplay.exe")

NOT_HEARD = "I didn't catch that, so I didn't change anything."


# ---------------- Speaking (set by pinakamain.py) ---------------- #
_speaker = print


def set_speaker(fn):
    """pinakamain.py passes its Kokoro speak() here so f1 uses the same voice."""
    global _speaker
    _speaker = fn


def speak(text):
    try:
        _speaker(text)
    except Exception as e:
        print(f"[speak error] {e}")


# ---------------- Data file ---------------- #
def _empty_data():
    return {"reminders": [], "tasks": [], "schedule": {}, "birthdays": [], "shopping": {}, "events": []}


def load_data():
    data = _empty_data()
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data.update(json.load(f))
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: could not read {DATA_FILE} ({e}); starting with empty data.")
    # Older versions stored schedule as a list and shopping as a list of dicts.
    if isinstance(data.get("schedule"), list):
        sched = {}
        for s in data["schedule"]:
            sched.setdefault(s.get("day", "Unknown"), []).append(
                {"activity": s.get("activity"), "time": s.get("time"), "added": s.get("added")})
        data["schedule"] = sched
    if isinstance(data.get("shopping"), list):
        merged = {}
        for group in data["shopping"]:
            for cat, items in group.items():
                merged.setdefault(cat, []).extend(items)
        data["shopping"] = merged
    return data


def save_data(data):
    """Write to a temp file first so a crash can never leave data.json half-written."""
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


user_data = load_data()


def _now():
    return datetime.datetime.now()


def _stamp():
    return _now().strftime("%Y-%m-%d %H:%M:%S")


# -------- Volume Control -------- #
def _volume_interface():
    from ctypes import cast, POINTER
    from comtypes import CLSCTX_ALL
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    speakers = AudioUtilities.GetSpeakers()
    if hasattr(speakers, "EndpointVolume"):          # newer pycaw versions
        return speakers.EndpointVolume
    interface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)  # older pycaw
    return cast(interface, POINTER(IAudioEndpointVolume))


def set_volume(percent):
    """Set system volume (1-100%). Uses the same scale as the Windows volume slider."""
    if percent is None:
        return NOT_HEARD
    try:
        percent = max(1, min(100, int(percent)))
        _volume_interface().SetMasterVolumeLevelScalar(percent / 100, None)
        return f"Volume set to {percent}%."
    except Exception as e:
        return f"Error setting volume: {e}"


# ---------------- Utilities ---------------- #
def get_weather(city):
    if not city:
        return NOT_HEARD
    import web
    f = web.forecast(city, 1)
    if "error" in f:
        return f["error"]
    return f"The weather in {f['place'].split(',')[0]} is {f['now']['text'].lower()} with a temperature of {f['now']['temp_c']}°C."


def get_time_date():
    return _now().strftime("%A, %B %d, %Y %I:%M %p")


def web_search(query):
    if not query:
        return NOT_HEARD
    webbrowser.open(f"https://www.google.com/search?q={quote_plus(query)}")
    return f"Searching Google for {query}..."


def system_control(command):
    commands = {
        "shutdown": {"windows": "shutdown /s /t 5", "linux": "shutdown -h now"},
        "restart": {"windows": "shutdown /r /t 5", "linux": "reboot"},
        "log off": {"windows": "shutdown /l", "linux": "pkill -KILL -u $USER"},
    }
    if command not in commands:
        return "Invalid system command. Available commands: shutdown, restart, log off."
    os.system(commands[command]["windows" if os.name == "nt" else "linux"])
    return f"Executing {command} command."


# ---------------- Math ---------------- #
_MATH_WORDS = [
    (r"\bto the power of\b", "**"), (r"\bsquared\b", "**2"), (r"\bcubed\b", "**3"),
    (r"\bmultiplied by\b", "*"), (r"\btimes\b", "*"), (r"\bdivided by\b", "/"), (r"\bover\b", "/"),
    (r"\bplus\b", "+"), (r"\bminus\b", "-"), (r"\bequals\b|\bis equal to\b", "="),
    (r"\bsquare root of\b", "sqrt"), (r"\bx\b(?=\s*\d)", "*"),  # "5 x 3" -> 5*3
    (r"^\s*(what is|what's|solve|calculate|compute)\s+", ""),
]


def solve_math(equation):
    """Solve or evaluate a typed/spoken equation, e.g. '2x + 3 = 7' or '12 times 8'."""
    if not equation:
        return NOT_HEARD
    import sympy as sp
    from sympy.parsing.sympy_parser import (parse_expr, standard_transformations,
                                            implicit_multiplication_application, convert_xor)
    text = equation.lower().strip().rstrip("?")
    for pattern, repl in _MATH_WORDS:
        text = re.sub(pattern, repl, text)
    if not re.fullmatch(r"[0-9a-z+\-*/^().=,\s]+", text):
        return "That doesn't look like a math problem I can read."
    allowed = {"sqrt": sp.sqrt, "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "log": sp.log,
               "pi": sp.pi, "e": sp.E}
    tf = standard_transformations + (implicit_multiplication_application, convert_xor)
    try:
        def parse(s):
            return parse_expr(s, local_dict=allowed, transformations=tf)
        if "=" in text:
            left, right = text.split("=", 1)
            expr = parse(left) - parse(right)
            symbols = sorted(expr.free_symbols, key=str)
            if not symbols:
                return "That equation is " + ("true." if sp.simplify(expr) == 0 else "false.")
            solutions = sp.solve(expr, symbols[0])
            if not solutions:
                return "That equation has no solution."
            return f"{symbols[0]} = " + ", ".join(str(sp.nsimplify(s)) for s in solutions)
        result = sp.simplify(parse(text))
        if result.is_number:
            value = float(result)
            return f"The answer is {int(value) if value.is_integer() else round(value, 6)}."
        return f"That simplifies to {result}."
    except Exception:
        return "Sorry, I couldn't solve that one."


# ---------------- Notes ----------------
def manage_notes(action, note=""):
    if action in ("add", "remove") and not note:
        return NOT_HEARD
    if action == "add":
        with open(NOTES_FILE, "a", encoding="utf-8") as f:
            f.write(note + "\n")
        return "Note saved."
    if action == "remove":
        if not os.path.exists(NOTES_FILE):
            return "No notes found."
        with open(NOTES_FILE, "r", encoding="utf-8") as f:
            notes = f.readlines()
        kept = [n for n in notes if note.lower() not in n.lower()]
        with open(NOTES_FILE, "w", encoding="utf-8") as f:
            f.writelines(kept)
        return "Note removed." if len(kept) < len(notes) else "Note not found."
    if action == "view":
        if os.path.exists(NOTES_FILE):
            with open(NOTES_FILE, "r", encoding="utf-8") as f:
                content = f.read().strip()
            return content or "No notes found."
        return "No notes found."
    if action == "clear":
        if os.path.exists(NOTES_FILE):
            open(NOTES_FILE, "w", encoding="utf-8").close()
            return "All notes cleared."
        return "No notes to clear."
    return "Invalid note action. Use 'add', 'remove', 'view', or 'clear'."


# ---------------- Reminders ----------------
REPEATS = ("none", "daily", "weekdays", "weekly", "monthly", "yearly")


def add_reminder(event, date_time, repeat="none"):
    """date_time 'YYYY-MM-DD HH:MM'. repeat: none / daily / weekdays / weekly / monthly / yearly."""
    if not event or not date_time:
        return "I need both the event and a date and time, so I didn't save that reminder."
    try:
        datetime.datetime.strptime(date_time, "%Y-%m-%d %H:%M")
    except ValueError:
        return "The reminder time should look like 2026-10-21 17:00."
    repeat = repeat if repeat in REPEATS else "none"
    user_data["reminders"].append({"event": event, "date_time": date_time, "repeat": repeat, "added": _stamp()})
    save_data(user_data)
    return f"Reminder set for {event} on {date_time}" + (f", repeating {repeat}." if repeat != "none" else ".")


def _next_occurrence(dt, repeat):
    """The next time a repeating reminder should go off after `dt`."""
    if repeat == "daily":
        return dt + datetime.timedelta(days=1)
    if repeat == "weekdays":
        nxt = dt + datetime.timedelta(days=1)
        while nxt.weekday() >= 5:
            nxt += datetime.timedelta(days=1)
        return nxt
    if repeat == "weekly":
        return dt + datetime.timedelta(weeks=1)
    if repeat == "monthly":
        y, m = (dt.year + (dt.month // 12), dt.month % 12 + 1)
        for day in (dt.day, 30, 29, 28):
            try:
                return dt.replace(year=y, month=m, day=day)
            except ValueError:
                continue
    if repeat == "yearly":
        try:
            return dt.replace(year=dt.year + 1)
        except ValueError:
            return dt.replace(year=dt.year + 1, day=28)
    return None


def _occurs_on(start, repeat, day):
    """Does a reminder that starts at `start` (datetime) happen on `day` (date)?"""
    if day < start.date():
        return False
    if repeat in (None, "none"):
        return day == start.date()
    if repeat == "daily":
        return True
    if repeat == "weekdays":
        return day.weekday() < 5
    if repeat == "weekly":
        return day.weekday() == start.weekday()
    if repeat == "monthly":
        return day.day == start.day
    if repeat == "yearly":
        return (day.month, day.day) == (start.month, start.day)
    return False


def remove_reminder(event):
    if not event:
        return NOT_HEARD
    before = len(user_data["reminders"])
    user_data["reminders"] = [r for r in user_data["reminders"] if r["event"].lower() != event.lower()]
    save_data(user_data)
    return f"Removed reminder for {event}." if len(user_data["reminders"]) < before else "Reminder not found."


def clear_reminders():
    user_data["reminders"] = []
    save_data(user_data)
    return "All reminders cleared."


def get_reminders():
    if user_data["reminders"]:
        return "\n".join(f"{r['event']} on {r.get('date_time') or 'no time set'}" for r in user_data["reminders"])
    return "No upcoming reminders."


# ---------------- Tasks (smart to-do list) ----------------
def add_task(task, time, priority="normal", deadline=None):
    if not task:
        return NOT_HEARD
    priority = priority if priority in ("low", "normal", "high") else "normal"
    user_data["tasks"].append({"task": task, "time": time, "priority": priority,
                               "deadline": deadline, "added": _stamp()})
    save_data(user_data)
    return f"Task added: {task} (priority {priority}" + (f", due {deadline})." if deadline else ").")


def complete_task(task, done=True):
    """Tick a task off (it stays in the list, marked done)."""
    if not task:
        return NOT_HEARD
    for t in user_data["tasks"]:
        if t["task"].lower() == task.lower() or task.lower() in t["task"].lower():
            t["done"] = bool(done)
            t["done_at"] = _stamp() if done else None
            save_data(user_data)
            return f"Marked '{t['task']}' as {'done' if done else 'not done'}."
    return "Task not found."


def remove_task(task):
    if not task:
        return NOT_HEARD
    before = len(user_data["tasks"])
    user_data["tasks"] = [t for t in user_data["tasks"] if t["task"].lower() != task.lower()]
    save_data(user_data)
    return f"Task removed: {task}." if len(user_data["tasks"]) < before else "Task not found."


def clear_tasks():
    user_data["tasks"] = []
    save_data(user_data)
    return "All tasks cleared."


def get_tasks():
    if not user_data["tasks"]:
        return "No tasks in the to-do list."
    order = {"high": 0, "normal": 1, "low": 2}
    tasks = sorted(user_data["tasks"], key=lambda t: order.get(t.get("priority", "normal"), 1))
    return "\n".join(
        f"{t['task']}" + (f" at {t['time']}" if t.get("time") else "")
        + f" | priority {t.get('priority', 'normal')}"
        + (f" | due {t['deadline']}" if t.get("deadline") else "")
        for t in tasks)


# ---------------- Schedule (stored per day) ----------------
def add_schedule(day, activity, time):
    if not day or not activity:
        return NOT_HEARD
    user_data["schedule"].setdefault(day, []).append({"activity": activity, "time": time, "added": _stamp()})
    save_data(user_data)
    return f"Added {activity}" + (f" at {time}" if time else "") + f" on {day}."


def remove_schedule(day, activity):
    if not day or not activity:
        return NOT_HEARD
    if day not in user_data["schedule"]:
        return "Day not found in schedule."
    before = len(user_data["schedule"][day])
    user_data["schedule"][day] = [a for a in user_data["schedule"][day]
                                  if a["activity"].lower() != activity.lower()]
    if not user_data["schedule"][day]:
        del user_data["schedule"][day]
    save_data(user_data)
    return f"Removed {activity} from your schedule on {day}." if before > len(user_data["schedule"].get(day, [])) else "Activity not found."


def clear_schedule():
    user_data["schedule"] = {}
    save_data(user_data)
    return "All schedules cleared."


def get_schedule():
    if not user_data["schedule"]:
        return "No schedule set for the week."
    return "\n".join(
        f"{day}: " + ", ".join(a["activity"] + (f" at {a['time']}" if a.get("time") else "") for a in acts)
        for day, acts in user_data["schedule"].items())


# ---------------- Music ---------------- #
current_process = None
music_queue = queue.Queue()
player_thread = None
is_playing = False
now_playing = ""
on_music = None          # app.py sets this to show "now playing" in the window
current_url = ""         # stream URL of the song playing now (for seek / replay)
current_query = ""
play_started = 0.0       # _time.time() when position 0 would have started
paused_at = None         # time.time() when paused, else None
restart_at = None        # seek/replay: the worker restarts the song at this many seconds
song_length = 0
NORMALIZE = True         # even out loud/quiet songs (ffmpeg dynaudnorm)


def _music_changed():
    if on_music:
        try:
            on_music({"playing": is_playing, "title": now_playing, "queued": music_queue.qsize()})
        except Exception:
            pass


def _ffplay_path():
    return shutil.which("ffplay") or (BUNDLED_FFPLAY if os.path.exists(BUNDLED_FFPLAY) else "ffplay")


now_info = {}            # the song playing now: id, title, channel, thumb (cover), duration, query


def _play_worker():
    """Background worker that plays songs from the queue one by one."""
    global current_process, is_playing, now_playing, now_info
    import yt_dlp
    while True:
        song = music_queue.get()
        if song is None:
            break
        try:
            opts = {"format": "bestaudio/best", "noplaylist": True, "quiet": True,
                    "default_search": "ytsearch1"}
            if os.path.exists(COOKIES_FILE):
                opts["cookiefile"] = COOKIES_FILE
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(song, download=False)
                if "entries" in info:
                    info = info["entries"][0]
            global current_url, current_query, play_started, paused_at, restart_at, song_length, now_info
            is_playing = True
            now_playing = info.get("title", song)
            now_info = {"id": info.get("id"), "title": now_playing, "channel": info.get("channel") or info.get("uploader") or "",
                        "thumb": info.get("thumbnail") or "", "duration": int(info.get("duration") or 0), "query": song}
            current_url, current_query, song_length = info["url"], song, int(info.get("duration") or 0)
            print(f"▶ Now playing: {now_playing}")
            _save_queue()
            try:
                import music
                music.add_history(now_playing, song)
            except Exception:
                pass
            _music_changed()
            pos = 0
            while True:
                # -reconnect options stop YouTube streams from cutting off early
                cmd = [_ffplay_path(), "-nodisp", "-autoexit", "-loglevel", "quiet",
                       "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
                if pos:
                    cmd += ["-ss", str(int(pos))]
                if NORMALIZE:
                    cmd += ["-af", "dynaudnorm"]
                proc = subprocess.Popen(cmd + [current_url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                current_process, play_started, paused_at = proc, _time.time() - pos, None
                proc.wait()
                if restart_at is None:
                    break
                pos, restart_at = max(0, restart_at), None
        except Exception as e:
            print(f"Music worker error: {e}")
        finally:
            current_process = None
            is_playing = False
            now_playing = ""
            now_info = {}
            current_url = ""
            _save_queue()
            _music_changed()


def _ensure_player():
    global player_thread
    if player_thread is None or not player_thread.is_alive():
        player_thread = threading.Thread(target=_play_worker, daemon=True)
        player_thread.start()


def load_playlist(filename=None):
    """Read playlist.txt, ignoring blank lines and '1.'-style numbering."""
    filename = filename or PLAYLIST_FILE
    if not os.path.exists(filename):
        return []
    with open(filename, "r", encoding="utf-8") as f:
        return [re.sub(r"^\s*\d+[.)]\s*", "", line).strip() for line in f if line.strip()]


def play_playlist(filename=None):
    songs = load_playlist(filename)
    if not songs:
        return "The playlist is empty or missing."
    _ensure_player()
    for song in songs:
        music_queue.put(song)
    return f"Loaded {len(songs)} songs from your playlist."


def show_playlist(filename=None):
    songs = load_playlist(filename)
    if not songs:
        return "The playlist is empty or missing."
    return "Playlist:\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(songs))


QUEUE_FILE = os.path.join(os.path.dirname(PLAYLIST_FILE), "music_queue.json")


def _save_queue():
    """Keep the upcoming songs on disk so 'resume my queue' works after a restart."""
    try:
        items = [x for x in list(music_queue.queue) if x]
        with open(QUEUE_FILE, "w", encoding="utf-8") as f:
            json.dump({"now": current_query if is_playing else "", "queue": items}, f)
    except Exception:
        pass


def resume_saved_queue():
    try:
        with open(QUEUE_FILE, encoding="utf-8") as f:
            saved = json.load(f)
    except (OSError, json.JSONDecodeError):
        return "There's no saved queue."
    songs = ([saved["now"]] if saved.get("now") else []) + saved.get("queue", [])
    if not songs:
        return "There's no saved queue."
    _ensure_player()
    for x in songs:
        music_queue.put(x)
    return f"Resumed your queue: {len(songs)} songs."


def _clear_queue():
    while not music_queue.empty():
        try:
            music_queue.get_nowait()
        except queue.Empty:
            break


def _put_first(song):
    """Put a song at the FRONT of the queue (it plays next)."""
    rest = [x for x in list(music_queue.queue) if x]
    _clear_queue()
    music_queue.put(song)
    for x in rest:
        music_queue.put(x)


def _stop_current_song():
    """End the song that's playing now, so the player moves on to the next one in the queue."""
    global restart_at
    restart_at = None
    p = current_process
    if p and p.poll() is None:
        if paused_at:                            # a paused (suspended) player must be woken before it can be closed
            try:
                import psutil
                psutil.Process(p.pid).resume()
            except Exception:
                pass
        p.kill()
        return True
    return False


def play_now(song):
    """Play this song RIGHT NOW: it jumps the queue and the current song stops."""
    if not song:
        return "Please tell me what song to play."
    _ensure_player()
    _put_first(song)
    _save_queue()
    _stop_current_song()
    return f"Playing '{song}' now."


external_player = None   # app.py: spotify.control - used instead of YouTube when use_external() is True
use_external = lambda: False


def music_control(action, query="", when="now"):
    """play / stop / skip / shuffle / queue / clear queue / playlist / show playlist.
    play: when="now" (default) plays it straight away, "next" puts it first in line, "later" adds it at the end."""
    global is_playing
    try:
        if external_player and use_external() and not (is_playing and action in ("stop", "pause", "skip")):
            return external_player(action, query, when)
        if action == "play":
            if not query:
                return "Please tell me what song to play."
            busy = is_playing or not music_queue.empty()
            if not busy or when == "now":
                return play_now(query)
            _ensure_player()
            if when == "next":
                _put_first(query)
                _save_queue()
                return f"'{query}' will play next."
            music_queue.put(query)
            _save_queue()
            return f"Added '{query}' to the end of the queue ({music_queue.qsize()} waiting)."
        if action == "play queued now":
            items = [x for x in list(music_queue.queue) if x]
            if not items:
                return "There's nothing in the queue."
            pick = query and next((x for x in items if query.lower() in x.lower()), None) or items[-1]
            rest = [x for x in items if x is not pick]
            _clear_queue()
            for x in [pick] + rest:
                music_queue.put(x)
            _stop_current_song()
            return f"Playing '{pick}' now."
        if action in ("pause", "resume", "replay", "resume queue", "favorite"):
            import music
            return {"pause": music.pause, "resume": music.resume, "replay": music.replay,
                    "resume queue": resume_saved_queue, "favorite": music.favorite_current}[action]()
        if action == "stop":
            _clear_queue()                       # clear first so the next song doesn't start
            _stop_current_song()
            is_playing = False
            return "Stopped music and cleared the queue."
        if action == "skip":
            if _stop_current_song():
                return "Skipped to the next song." if not music_queue.empty() else "Skipped — the queue is empty now."
            return "No song to skip."
        if action == "shuffle":
            items = list(music_queue.queue)
            if not items:
                return "The queue is empty, nothing to shuffle."
            _clear_queue()
            random.shuffle(items)
            for item in items:
                music_queue.put(item)
            return "Shuffled the queue."
        if action == "queue":
            items = list(music_queue.queue)
            if not items:
                return "The queue is empty."
            return "Queued songs:\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(items))
        if action == "clear queue":
            _clear_queue()
            _save_queue()
            return "Cleared all upcoming songs from the queue."
        if action == "playlist":
            return play_playlist()
        if action == "show playlist":
            return show_playlist()
        return "Unknown music control action."
    except Exception as e:
        return f"Error controlling music: {e}"


# ------- Messages ------- #
def _spoken_email(text):
    """'john dot doe at gmail dot com' -> 'john.doe@gmail.com'"""
    t = text.lower().strip()
    t = re.sub(r"\s+at\s+", "@", t)
    t = re.sub(r"\s+dot\s+", ".", t)
    return t.replace(" ", "")


def send_email(recipient, subject, message):
    """Send an email through Gmail. Needs EMAIL_ADDRESS and EMAIL_APP_PASSWORD in .env."""
    if not recipient or not message:
        return NOT_HEARD
    sender = os.environ.get("EMAIL_ADDRESS")
    password = os.environ.get("EMAIL_APP_PASSWORD")
    if not sender or not password:
        return "Email isn't set up: add EMAIL_ADDRESS and EMAIL_APP_PASSWORD to the .env file."
    to = _spoken_email(recipient)
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", to):
        return f"'{recipient}' isn't a valid email address."
    msg = MIMEText(message)
    msg["Subject"] = subject or "(no subject)"
    msg["From"] = sender
    msg["To"] = to
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as server:
            server.login(sender, password)
            server.send_message(msg)
        return f"Email sent to {to}."
    except Exception as e:
        return f"I couldn't send the email: {e}"


def send_message(platform, recipient, message):
    """Placeholder: SMS/Discord sending needs accounts and API setup that don't exist yet."""
    if platform and "mail" in platform:
        return send_email(recipient, "Message from Vermeil", message)
    return "Sending messages on that platform isn't set up yet. I can send emails, though."


# ------- Calendar (stored in data.json) -------- #
def _valid_date(d):
    try:
        datetime.datetime.strptime(d, "%Y-%m-%d")
        return True
    except (TypeError, ValueError):
        return False


def _valid_time(t):
    try:
        datetime.datetime.strptime(t, "%H:%M")
        return True
    except (TypeError, ValueError):
        return False


def add_event(title, date, time=None, end_time=None, notes=""):
    """Put an event on the calendar. date 'YYYY-MM-DD', time/end_time 'HH:MM' (optional = all day)."""
    if not title or not _valid_date(date):
        return "I need a title and a date like 2026-10-25 to add that to your calendar."
    if time and not _valid_time(time):
        return "The time should look like 17:30."
    event = {"title": title.strip(), "date": date, "time": time or None, "end_time": end_time if _valid_time(end_time) else None,
             "notes": (notes or "").strip(), "added": _stamp()}
    user_data["events"].append(event)
    user_data["events"].sort(key=lambda e: (e["date"], e.get("time") or "00:00"))
    save_data(user_data)
    when = datetime.datetime.strptime(date, "%Y-%m-%d").strftime("%A, %B %d")
    return f"Added '{event['title']}' to your calendar on {when}" + (f" at {time}." if time else " (all day).")


def list_events(start_date=None, days=7):
    """Events from start_date (default today) for the next `days` days."""
    start = start_date if _valid_date(start_date) else _now().strftime("%Y-%m-%d")
    first = datetime.datetime.strptime(start, "%Y-%m-%d")
    last = (first + datetime.timedelta(days=max(1, int(days or 7)) - 1)).strftime("%Y-%m-%d")
    found = [e for e in user_data["events"] if start <= e["date"] <= last]
    if not found:
        return f"Nothing on your calendar from {start} to {last}."
    out = []
    for e in found:
        day = datetime.datetime.strptime(e["date"], "%Y-%m-%d").strftime("%a %b %d")
        out.append(f"{day}" + (f" {e['time']}" if e.get("time") else "") + f": {e['title']}"
                   + (f" ({e['notes']})" if e.get("notes") else ""))
    return "\n".join(out)


def remove_event(title, date=None):
    if not title:
        return NOT_HEARD
    before = len(user_data["events"])
    user_data["events"] = [e for e in user_data["events"]
                           if not (title.lower() in e["title"].lower() and (not date or e["date"] == date))]
    save_data(user_data)
    removed = before - len(user_data["events"])
    return f"Removed {removed} event{'s' if removed != 1 else ''} called '{title}'." if removed else "I couldn't find that event."


def sync_calendar():
    return "Syncing with Google or Outlook calendar isn't set up yet, but your local calendar works."


def view_calendar():
    return list_events(days=14)


# ------- Alerts: reminders and events that are due -------- #
def due_alerts(now=None):
    """Reminders/events whose time has come and that haven't alerted yet. Marks them so each alerts once."""
    now = now or _now()
    stamp = now.strftime("%Y-%m-%d %H:%M")
    alerts = []
    for r in user_data["reminders"]:
        dt = r.get("date_time")
        if dt and dt <= stamp and not r.get("alerted"):
            alerts.append(f"Reminder: {r['event']}")
            nxt = _next_occurrence(datetime.datetime.strptime(dt, "%Y-%m-%d %H:%M"), r.get("repeat", "none"))
            while nxt and nxt.strftime("%Y-%m-%d %H:%M") <= stamp:      # computer was off: skip missed repeats
                nxt = _next_occurrence(nxt, r["repeat"])
            if nxt:
                r["date_time"] = nxt.strftime("%Y-%m-%d %H:%M")         # repeating: move to the next time
            else:
                r["alerted"] = True
    for e in user_data["events"]:
        if e.get("time") and not e.get("alerted"):
            start = datetime.datetime.strptime(f"{e['date']} {e['time']}", "%Y-%m-%d %H:%M")
            if start - datetime.timedelta(minutes=10) <= now <= start + datetime.timedelta(minutes=30):
                e["alerted"] = True
                alerts.append(f"Coming up at {e['time']}: {e['title']}")
    if alerts:
        save_data(user_data)
    return alerts


# --------- Birthdays -------- #
_DATE_FORMATS_WITH_YEAR = ("%Y-%m-%d", "%Y/%m/%d", "%B %d %Y", "%B %d, %Y", "%d %B %Y", "%m/%d/%Y")
_DATE_FORMATS_NO_YEAR = ("%B %d", "%b %d", "%d %B", "%d %b", "%m/%d", "%m-%d")


def _parse_birthday(text):
    """Return 'YYYY-MM-DD' or 'MM-DD' (no year), or None."""
    t = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", text.strip(), flags=re.I)
    for fmt in _DATE_FORMATS_WITH_YEAR:
        try:
            return datetime.datetime.strptime(t, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    for fmt in _DATE_FORMATS_NO_YEAR:
        try:
            return datetime.datetime.strptime(f"2000 {t}", f"%Y {fmt}").strftime("%m-%d")
        except ValueError:
            pass
    return None


def add_birthday(name, date):
    if not name or not date:
        return NOT_HEARD
    parsed = _parse_birthday(date)
    if not parsed:
        return f"I couldn't understand the date '{date}'. Try something like 'March 5'."
    user_data["birthdays"].append({"name": name, "date": parsed})
    save_data(user_data)
    return f"Birthday for {name} added."


def get_birthdays():
    if not user_data["birthdays"]:
        return "No birthdays saved."
    return "\n".join(f"{b['name']} on {b['date']}" for b in user_data["birthdays"])


def _days_until_birthday(date_str, today):
    month, day = map(int, date_str[-5:].split("-"))
    for year in (today.year, today.year + 1):
        try:
            nxt = datetime.date(year, month, day)
        except ValueError:                      # Feb 29 in a non-leap year
            nxt = datetime.date(year, 3, 1)
        if nxt >= today:
            return (nxt - today).days
    return None


def check_upcoming_birthdays(today=None):
    today = today or _now().date()
    alerts = []
    for b in user_data["birthdays"]:
        try:
            days = _days_until_birthday(b["date"], today)
        except (ValueError, KeyError):
            continue
        if days == 0:
            alerts.append(f"Today is {b['name']}'s birthday!")
        elif days is not None and days <= 7:
            alerts.append(f"{b['name']}'s birthday is in {days} day{'s' if days != 1 else ''}.")
    return "\n".join(alerts) if alerts else "No upcoming birthdays this week."


# --------- Planner views (calendar month & single day) -------- #
def _birthday_md(b):
    return b["date"][-5:]


def planner_day(date_str):
    """Everything happening on one day, as simple items for the planner panel."""
    try:
        day = datetime.datetime.strptime(date_str, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return []
    items = []
    for e in user_data["events"]:
        if e["date"] == date_str:
            items.append({"kind": "event", "title": e["title"], "time": e.get("time"), "detail": e.get("notes") or "",
                          "key": e["title"]})
    for r in user_data["reminders"]:
        dt = r.get("date_time")
        if not dt:
            continue
        start = datetime.datetime.strptime(dt, "%Y-%m-%d %H:%M")
        if _occurs_on(start, r.get("repeat", "none"), day) and not (r.get("alerted") and r.get("repeat", "none") == "none" and day < _now().date()):
            items.append({"kind": "reminder", "title": r["event"], "time": dt[11:16],
                          "detail": "" if r.get("repeat", "none") == "none" else f"repeats {r['repeat']}", "key": r["event"]})
    for t in user_data["tasks"]:
        if t.get("deadline") == date_str:
            items.append({"kind": "task", "title": t["task"], "time": t.get("time"), "detail": f"priority {t.get('priority', 'normal')}",
                          "done": bool(t.get("done")), "key": t["task"]})
    md = day.strftime("%m-%d")
    for b in user_data["birthdays"]:
        if _birthday_md(b) == md:
            age = ""
            if len(b["date"]) == 10:
                age = f"turns {day.year - int(b['date'][:4])}"
            items.append({"kind": "birthday", "title": f"{b['name']}'s birthday", "time": None, "detail": age, "key": b["name"]})
    weekday = day.strftime("%A")
    for d, acts in user_data["schedule"].items():
        if d.lower() == weekday.lower():
            for a in acts:
                items.append({"kind": "weekly", "title": a["activity"], "time": a.get("time"), "detail": f"every {weekday}",
                              "key": a["activity"], "day": d})
    items.sort(key=lambda i: (i["time"] is not None, i["time"] or ""))
    return items


def planner_month(year, month):
    """{'YYYY-MM-DD': {'event': 2, 'task': 1, ...}} for every day of a month that has something on it."""
    first = datetime.date(int(year), int(month), 1)
    out = {}
    d = first
    while d.month == first.month:
        counts = {}
        for item in planner_day(d.strftime("%Y-%m-%d")):
            counts[item["kind"]] = counts.get(item["kind"], 0) + 1
        if counts:
            out[d.strftime("%Y-%m-%d")] = counts
        d += datetime.timedelta(days=1)
    return out


# --------- Daily Agenda -------- #
def daily_agenda(today=None):
    """Everything relevant for today: reminders due today, tasks, today's schedule, birthdays."""
    now = today or _now()
    date_str = now.strftime("%Y-%m-%d")
    weekday = now.strftime("%A")
    agenda = []
    for r in user_data["reminders"]:
        if (r.get("date_time") or "").startswith(date_str):
            agenda.append(f"Reminder: {r['event']} at {r['date_time'][11:] or 'today'}")
    for e in user_data["events"]:
        if e["date"] == date_str:
            agenda.append(f"Event: {e['title']}" + (f" at {e['time']}" if e.get("time") else " (all day)"))
    for t in user_data["tasks"]:
        agenda.append(f"Task: {t['task']}" + (f" at {t['time']}" if t.get("time") else ""))
    for day, acts in user_data["schedule"].items():
        if day.lower() in (weekday.lower(), date_str):
            agenda.extend(f"Schedule: {a['activity']}" + (f" at {a['time']}" if a.get("time") else "") for a in acts)
    bdays = check_upcoming_birthdays(now.date() if isinstance(now, datetime.datetime) else now)
    if not bdays.startswith("No upcoming"):
        agenda.append(bdays)
    return "\n".join(agenda) if agenda else "Nothing on your agenda today."


# --------- Shopping List -------- #
_CATEGORIES = {
    "meat": {"chicken", "beef", "pork", "fish", "shrimp", "bacon", "hotdog", "ham"},
    "grains": {"rice", "bread", "pasta", "noodles", "oats", "cereal", "flour"},
    "household": {"detergent", "soap", "shampoo", "toothpaste", "tissue", "toilet paper"},
}


def add_shopping_items(items):
    if not items:
        return NOT_HEARD
    names = [i.strip().lower() for i in re.split(r",|\band\b", items) if i.strip()]
    shopping = user_data["shopping"]
    for item in names:
        cat = next((c for c, words in _CATEGORIES.items() if item in words), "other")
        if item not in shopping.setdefault(cat, []):
            shopping[cat].append(item)
    save_data(user_data)
    return f"Added to your shopping list: {', '.join(names)}."


def get_shopping_list():
    shopping = {c: items for c, items in user_data["shopping"].items() if items}
    if not shopping:
        return "Shopping list is empty."
    return "\n".join(f"{cat.title()}: {', '.join(items)}" for cat, items in shopping.items())


def remove_shopping_item(item):
    if not item:
        return NOT_HEARD
    item = item.strip().lower()
    found = False
    for cat, items in user_data["shopping"].items():
        if item in items:
            items.remove(item); found = True
    save_data(user_data)
    return f"Removed {item} from your shopping list." if found else f"{item} isn't on your shopping list."


def clear_shopping_list():
    user_data["shopping"] = {}
    save_data(user_data)
    return "Shopping list cleared."


# ---------------- Camera: seeing you (presence.py) ---------------- #
presence = None          # app.py / pinakamain.py puts a presence.Presence object here


def _get_presence():
    global presence
    if presence is None:
        from presence import Presence
        presence = Presence(on_event=lambda e: None)
    return presence


def camera_on():
    p = _get_presence()
    if p.running:
        return "My eyes are already open."
    p.start()
    return "Camera on. I can see you now." if p.owner else "Camera on. Teach me your face in Settings so I know it's you."


def camera_off():
    p = presence
    if p is None or not p.running:
        return "The camera is already off."
    p.stop()
    return "Camera off."


def who_do_you_see():
    p = presence
    if p is None or not p.running:
        return "My camera is off. Say 'camera on' first."
    state = p.state
    if not state["present"]:
        return "I don't see anyone right now."
    if state["who"] == "owner":
        return f"I see you, {p.owner_name}."
    return "I see someone, but I don't think it's you." if p.owner else "I see someone. Teach me your face so I can recognise you."
