"""
herlife.py - the little things that make Vermeil feel like she lives with you.

  notice(text, today)          remembers small things you say ("I have an exam tomorrow") to ask about later
  followups_due(today)         what she should ask about now ("How did your exam go?")
  asked(fid)                   she asked it: don't ask again
  outfit_for(hour, weather, today, birthday)   what she wears: by time of day, weather, season, holidays, your birthday
  wardrobe() / wardrobe_save(o) / wardrobe_remove(name) / wardrobe_wear(name|"auto")   your saved outfits for her
  is_birthday(md, today)       is it your birthday today ("MM-DD")
  morning(facts) / night(facts)   the good-morning and good-night routines (what she says)
  holiday_greeting(today)      a holiday greeting once a year per holiday

Saved in data/herlife.json.
"""
import json
import os
import re
import threading
import uuid
from datetime import date, timedelta

from paths import data_file

STATE_FILE = data_file("herlife.json")
_lock = threading.Lock()

# ---------------------------------------------------------------- small things to ask about later
# (what you said, how she asks later). {x} = the thing you named.
EVENTS = [
    (r"\b(exam|test|quiz|midterms?|finals?|board exam)\b", "How did your {x} go?"),
    (r"\b(interview)\b", "How did the interview go? I've been wondering!"),
    (r"\b(presentation|defen[cs]e|thesis defen[cs]e|report)\b", "How did your {x} go?"),
    (r"\b(appointment|check-?up|doctor|dentist)\b", "How was the {x}? Everything okay?"),
    (r"\b(date)\b", "Sooo... how was the date? 👀"),
    (r"\b(trip|flight|travel(?:ling)?|vacation)\b", "How was the {x}?"),
    (r"\b(game|match|tournament|competition|race)\b", "How did the {x} go? Did you win?"),
    (r"\b(deadline|due date)\b", "Did you make the {x}?"),
    (r"\b(workout|gym session|leg day)\b", "How was the {x}? Sore yet?"),
]
FEELINGS = [
    (r"\b(i'?m|i am|i feel|feeling) (sick|ill|unwell|feverish|under the weather)\b", "Are you feeling better today?"),
    (r"\bmy (\w+) (is|was) sick\b", "Is your {x} feeling better?"),
    (r"\b(i'?m|i am) (so )?(stressed|anxious|worried|nervous)\b", "You seemed stressed last time. Are you doing okay now?"),
    (r"\b(headache|migraine|stomach ?ache|toothache)\b", "How's the {x}? Better now?"),
]
WHEN = [
    (r"\btoday|tonight|later\b", 1), (r"\btomorrow\b", 1), (r"\bday after tomorrow\b", 2), (r"\bnext week\b", 7),
    (r"\bthis weekend\b|\bon the weekend\b", None),
]
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _read():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(d):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)


def _ask_day(text, today):
    """when to ask: the day after the thing happens"""
    t = text.lower()
    for i, d in enumerate(DAYS):
        if re.search(rf"\b(on |this |next )?{d}\b", t):
            ahead = (i - today.weekday()) % 7 or 7
            return today + timedelta(days=ahead + 1)
    if re.search(r"\bday after tomorrow\b", t):
        return today + timedelta(days=3)
    if re.search(r"\btomorrow\b", t):
        return today + timedelta(days=2)
    if re.search(r"\bnext week\b", t):
        return today + timedelta(days=8)
    if re.search(r"\bthis weekend\b|\bon the weekend\b", t):
        return today + timedelta(days=(7 - today.weekday()) % 7 + 1)
    if re.search(r"\b(today|tonight|later|this (morning|afternoon|evening))\b", t):
        return today + timedelta(days=1)
    return None


def notice(text, today=None):
    """Remember a small thing from what you said. Returns what was remembered (or None)."""
    today = today or date.today()
    t = (text or "").lower()
    if len(t) < 6:
        return None
    found = None
    for pat, q in FEELINGS:
        m = re.search(pat, t)
        if m:
            x = m.group(1) if "{x}" in q and m.lastindex else ""
            if pat.startswith(r"\bmy"):
                x = m.group(1)
            found = (q.format(x=x), today + timedelta(days=1), m.group(0))
            break
    if not found and re.search(r"\b(i have|i've got|i got|i'?ll have|my|there'?s|going to|gonna|i'?m going)\b", t):
        for pat, q in EVENTS:
            m = re.search(pat, t)
            if m:
                day = _ask_day(t, today)
                if day:
                    found = (q.format(x=m.group(1)), day, m.group(0))
                break
    if not found:
        return None
    question, ask_on, what = found
    with _lock:
        d = _read()
        items = d.setdefault("followups", [])
        if any(f["question"] == question and not f.get("asked") for f in items):
            return None
        item = {"id": uuid.uuid4().hex[:8], "question": question, "about": what, "said": text[:200],
                "noted": today.isoformat(), "ask_on": ask_on.isoformat()}
        items.append(item)
        d["followups"] = items[-60:]
        _write(d)
    return item


def followups_due(today=None):
    today = (today or date.today()).isoformat()
    return [f for f in _read().get("followups", []) if not f.get("asked") and f["ask_on"] <= today
            and f["ask_on"] >= (date.fromisoformat(today) - timedelta(days=5)).isoformat()]


def asked(fid):
    with _lock:
        d = _read()
        for f in d.get("followups", []):
            if f["id"] == fid:
                f["asked"] = True
        _write(d)


# ---------------------------------------------------------------- outfits and the wardrobe
# hats the room can put on her (room.js setOutfit): none beanie party crown santa witch headband headphones cap
def is_birthday(md, today=None):
    today = today or date.today()
    return bool(md) and today.strftime("%m-%d") == str(md)[-5:]


def outfit_for(hour, weather="clear", today=None, birthday=""):
    """the automatic outfit: {hat, glasses, color, why}"""
    today = today or date.today()
    m, d = today.month, today.day
    if is_birthday(birthday, today):
        return {"hat": "party", "glasses": False, "color": "#ff5fa0", "why": "It's your birthday! 🎉"}
    if (m == 10 and d >= 25) or (m == 11 and d == 1):
        return {"hat": "witch", "glasses": False, "color": "#6b3fbf", "why": "Halloween 🎃"}
    if m == 12 and 15 <= d <= 26:
        return {"hat": "santa", "glasses": False, "color": "#d83a3a", "why": "Christmas 🎄"}
    if m == 1 and d == 1:
        return {"hat": "party", "glasses": True, "color": "#ffd24d", "why": "New Year 🎆"}
    if weather in ("snow",) or m in (12, 1, 2) and hour < 9:
        return {"hat": "beanie", "glasses": False, "color": "#3e8eff", "why": "It's cold ❄️"}
    if hour >= 22 or hour < 6:
        return {"hat": "headphones", "glasses": False, "color": "#8f86ff", "why": "Late-night chill 🌙"}
    if weather == "clear" and 10 <= hour < 16 and m in (3, 4, 5, 6, 7, 8):
        return {"hat": "cap", "glasses": True, "color": "#ff9a3d", "why": "Sunny ☀️"}
    if weather in ("rain", "storm"):
        return {"hat": "beanie", "glasses": False, "color": "#4fb8a8", "why": "Rainy day 🌧️"}
    if 6 <= hour < 10:
        return {"hat": "headband", "glasses": False, "color": "#5fd08a", "why": "Morning 🌅"}
    return {"hat": "none", "glasses": False, "color": "#3e8eff", "why": "Everyday"}


HATS = ["none", "beanie", "party", "crown", "santa", "witch", "headband", "headphones", "cap"]


def wardrobe():
    d = _read()
    return {"outfits": d.get("wardrobe", []), "wearing": d.get("wearing", "auto"), "hats": HATS}


def wardrobe_save(o):
    name = str((o or {}).get("name") or "").strip()[:30]
    if not name:
        return {"error": "Name the outfit."}
    item = {"name": name, "hat": o.get("hat") if o.get("hat") in HATS else "none", "glasses": bool(o.get("glasses")),
            "color": str(o.get("color") or "#3e8eff")[:9], "look": str(o.get("look") or "")[:30]}
    with _lock:
        d = _read()
        d["wardrobe"] = [w for w in d.get("wardrobe", []) if w["name"] != name] + [item]
        _write(d)
    return wardrobe()


def wardrobe_remove(name):
    with _lock:
        d = _read()
        d["wardrobe"] = [w for w in d.get("wardrobe", []) if w["name"] != name]
        if d.get("wearing") == name:
            d["wearing"] = "auto"
        _write(d)
    return wardrobe()


def wardrobe_wear(name):
    with _lock:
        d = _read()
        d["wearing"] = name if name == "auto" or any(w["name"] == name for w in d.get("wardrobe", [])) else "auto"
        _write(d)
    return wardrobe()


def current_outfit(hour, weather="clear", today=None, birthday=""):
    w = wardrobe()
    if w["wearing"] != "auto":
        for o in w["outfits"]:
            if o["name"] == w["wearing"]:
                return {**o, "why": f"Your pick: {o['name']}"}
    return outfit_for(hour, weather, today, birthday)


# ---------------------------------------------------------------- routines and greetings
def morning(facts):
    """facts: {name, weather:{text,temp_c}, events:[...], tasks:[...], habits:[...], sleep_hours}"""
    name = facts.get("name")
    out = [f"Good morning{', ' + name if name else ''}! ☀️"]
    w = facts.get("weather") or {}
    if w.get("text"):
        out.append(f"It's {round(w.get('temp_c', 0))}°C and {w['text'].lower()} outside.")
    if facts.get("sleep_hours") is not None:
        h = facts["sleep_hours"]
        out.append(f"You slept {h:g} hours." + (" Let's take it easy today." if h < 6 else " Nice!"))
    ev = facts.get("events") or []
    if ev:
        out.append("Today you have " + ", ".join(ev[:3]) + ".")
    tasks = facts.get("tasks") or []
    if tasks:
        out.append("Your top tasks: " + "; ".join(tasks[:3]) + ".")
    if facts.get("habits"):
        out.append(f"Don't forget: {facts['habits'][0]}.")
    out.append("Drink some water first, okay? 💧")
    return " ".join(out)


def night(facts):
    """facts: {name, done:int, focus_minutes:int, tomorrow:[...], alarm:str}"""
    name = facts.get("name")
    out = [f"Good night{', ' + name if name else ''} 🌙"]
    if facts.get("done"):
        out.append(f"You finished {facts['done']} task{'s' if facts['done'] != 1 else ''} today.")
    if facts.get("focus_minutes"):
        out.append(f"And you focused for {facts['focus_minutes']} minutes. I'm proud of you.")
    tm = facts.get("tomorrow") or []
    if tm:
        out.append("Tomorrow: " + ", ".join(tm[:3]) + ".")
    if facts.get("alarm"):
        out.append(f"Your alarm is at {facts['alarm']}.")
    out.append("Phone down, lights off. Sleep well!")
    return " ".join(out)


def holiday_greeting(today=None):
    """a greeting the first time the app opens on a holiday (once per holiday per year)"""
    import roomlife
    today = today or date.today()
    h = roomlife.holiday(today)
    if not h:
        return None
    key = f"{today.year}:{h}"
    with _lock:
        d = _read()
        if key in d.get("greeted", []):
            return None
        d["greeted"] = (d.get("greeted", []) + [key])[-40:]
        _write(d)
    lines = {"Christmas": "Merry Christmas! 🎄 I'm so happy I get to spend it with you.",
             "Christmas Eve": "It's Christmas Eve! 🎁 Noche Buena tonight?",
             "New Year's Day": "Happy New Year! 🎆 Let's make this year amazing together.",
             "New Year's Eve": "Last day of the year! 🎇 Any resolutions?",
             "Halloween": "Happy Halloween! 🎃 Trick or treat?",
             "Valentine's Day": "Happy Valentine's Day! 💝"}
    return lines.get(h, f"Happy {h}! 🎉")
