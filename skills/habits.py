"""
habits.py - Habit tracker: water, sleep, reading or your own habits, ticked each day, with streaks.

  habits()                 every habit with today's count, its streak and the last 7 days
  add(name, icon, goal)    a new habit (goal = how many times a day, e.g. 8 glasses of water)
  tick(hid, n=1)           count one more today (n=-1 takes one back)
  remove(hid)
  find(text)               the habit a sentence talks about ("I drank water" -> Water)

Saved in data/habits.json. Each tick also earns XP (skills/quest.py).
"""
import json
import os
import re
import uuid
from datetime import date, timedelta

from paths import data_file

STATE_FILE = data_file("habits.json")
DEFAULTS = [("Water", "💧", 8, "water drink glass hydrate"), ("Sleep 8 hours", "😴", 1, "sleep slept bed"),
            ("Reading", "📖", 1, "read reading book")]


def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            s = json.load(f)
        if isinstance(s, dict) and isinstance(s.get("habits"), list):
            return s
    except (OSError, ValueError):
        pass
    return {"habits": [{"id": uuid.uuid4().hex[:8], "name": n, "icon": i, "goal": g, "words": w, "log": {}}
                       for n, i, g, w in DEFAULTS]}


def _save(s):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=1, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)


def streak(h, today=None):
    """days in a row the goal was reached, counting today only if it's already reached"""
    today = today or date.today()
    d = today if h["log"].get(today.isoformat(), 0) >= h["goal"] else today - timedelta(days=1)
    n = 0
    while h["log"].get(d.isoformat(), 0) >= h["goal"]:
        n += 1
        d -= timedelta(days=1)
    return n


def _view(h, today):
    week = [{"day": (today - timedelta(days=i)).isoformat(), "count": h["log"].get((today - timedelta(days=i)).isoformat(), 0)}
            for i in range(6, -1, -1)]
    return {"id": h["id"], "name": h["name"], "icon": h["icon"], "goal": h["goal"],
            "today": h["log"].get(today.isoformat(), 0), "streak": streak(h, today), "week": week,
            "done": h["log"].get(today.isoformat(), 0) >= h["goal"]}


def habits(today=None):
    today = today or date.today()
    s = _load()
    _save(s)
    return [_view(h, today) for h in s["habits"]]


def add(name, icon="✅", goal=1):
    name = (name or "").strip()[:40]
    if not name:
        raise ValueError("Give the habit a name.")
    s = _load()
    s["habits"].append({"id": uuid.uuid4().hex[:8], "name": name, "icon": (icon or "✅")[:4],
                        "goal": max(1, min(50, int(goal or 1))), "words": name.lower(), "log": {}})
    _save(s)
    return habits()


def remove(hid):
    s = _load()
    s["habits"] = [h for h in s["habits"] if h["id"] != hid]
    _save(s)
    return habits()


def tick(hid, n=1, today=None):
    """returns (habit view, reached the goal just now?)"""
    today = today or date.today()
    s = _load()
    h = next((x for x in s["habits"] if x["id"] == hid), None)
    if not h:
        raise ValueError("No such habit.")
    k = today.isoformat()
    before = h["log"].get(k, 0)
    h["log"][k] = max(0, min(h["goal"] * 3, before + int(n)))
    if not h["log"][k]:
        h["log"].pop(k)
    for old in sorted(h["log"])[:-400]:
        h["log"].pop(old)
    _save(s)
    return _view(h, today), before < h["goal"] <= h["log"].get(k, 0)


def find(text):
    words = set(re.findall(r"[a-z]+", (text or "").lower()))
    best = None
    for h in _load()["habits"]:
        hit = len(words & set(re.findall(r"[a-z]+", (h.get("words") or "") + " " + h["name"].lower())))
        if hit and (not best or hit > best[0]):
            best = (hit, h["id"])
    return best[1] if best else None
