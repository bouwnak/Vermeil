"""
smartremind.py - reminders that wait for a situation instead of a clock time.

  "remind me to take out the trash when I get home"   -> on="home": goes off the next time you come back to the
                                                          computer after being away 20+ minutes (or open Vermeil)
  "remind me to print my notes before my 2 pm class"  -> on="before", match="class": goes off `minutes` (default 30)
                                                          before the next calendar event / weekly-schedule item today
                                                          whose name matches (a time like "2 pm" picks that one)

  add(event, on, match="", minutes=30)   list_all()   remove(text)
  due(now, came_back)                    -> texts to say now (each goes off once)

Saved in data/smart_reminders.json.
"""
import json
import os
import re
from datetime import datetime, timedelta

from paths import data_file

STATE_FILE = data_file("smart_reminders.json")
AWAY_MINUTES = 20


def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def _save(items):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=1, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)


def add(event, on="home", match="", minutes=30):
    event = (event or "").strip()[:200]
    if not event:
        return "What should I remind you about?"
    on = "before" if on == "before" else "home"
    items = _load()
    items.append({"event": event, "on": on, "match": (match or "").strip()[:80], "minutes": max(1, min(240, int(minutes or 30))),
                  "added": datetime.now().isoformat(timespec="minutes")})
    _save(items)
    if on == "home":
        return f"Okay, I'll remind you to {event} when you get back to your computer."
    return f"Okay, I'll remind you to {event} {int(minutes or 30)} minutes before your {match or 'next event'}."


def list_all():
    return _load()


def remove(text):
    items = _load()
    keep = [r for r in items if (text or "").lower() not in r["event"].lower()]
    _save(keep)
    return len(items) - len(keep)


_CLOCK = re.compile(r"\b(\d{1,2})(?::(\d\d))?\s*(am|pm)?\b", re.I)


def _wanted_time(match):
    m = _CLOCK.search(match or "")
    if not m or not (m.group(2) or m.group(3)):
        return None
    h = int(m.group(1)) % 12 + (12 if (m.group(3) or "").lower() == "pm" else 0) if m.group(3) else int(m.group(1))
    return f"{h:02d}:{m.group(2) or '00'}"


def _today_items(now):
    """[(HH:MM, name)] from the calendar and the weekly schedule for today"""
    import f1
    today = now.strftime("%Y-%m-%d")
    out = [(e["time"], e["title"]) for e in f1.user_data.get("events", []) if e.get("date") == today and e.get("time")]
    for a in f1.user_data.get("schedule", {}).get(now.strftime("%A"), []):
        if a.get("time"):
            out.append((a["time"], a["activity"]))
    return sorted(out)


def _find_start(r, now):
    want = _wanted_time(r["match"])
    words = set(re.findall(r"[a-z]{3,}", _CLOCK.sub(" ", r["match"].lower()))) - {"next", "the", "my"}
    for clock, name in _today_items(now):
        if want and clock != want:
            continue
        if words and not words & set(re.findall(r"[a-z]{3,}", name.lower())):
            continue
        try:
            start = datetime.strptime(f"{now:%Y-%m-%d} {clock}", "%Y-%m-%d %H:%M")
        except ValueError:
            continue
        if start > now:
            return start, name
    return None, None


def due(now=None, came_back=False):
    now = now or datetime.now()
    items, fired, keep = _load(), [], []
    for r in items:
        if r["on"] == "home":
            if came_back:
                fired.append(f"Welcome back! You asked me to remind you: {r['event']}")
                continue
        else:
            start, name = _find_start(r, now)
            if start and start - timedelta(minutes=r["minutes"]) <= now:
                fired.append(f"{name} starts at {start:%H:%M}. You asked me to remind you: {r['event']}")
                continue
        keep.append(r)
    if fired:
        _save(keep)
    return fired


def idle_minutes():
    """minutes since the last mouse/keyboard input (Windows); 0 elsewhere"""
    try:
        import ctypes

        class _LII(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
        lii = _LII()
        lii.cbSize = ctypes.sizeof(_LII)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
            return 0
        return (ctypes.windll.kernel32.GetTickCount() - lii.dwTime) / 60000
    except Exception:  # noqa: BLE001
        return 0
