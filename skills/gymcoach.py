"""
gymcoach.py - Gym -> Calories: the meal log (a photo of your plate -> a calorie / protein estimate) and
rest-day + sleep tips from your training history.

  parse_estimate(text)          the vision model's JSON answer -> {name, kcal, protein, carbs, fat, note}
  add_meal(meal, day)  meals(day)  remove_meal(meal_id, day)   -> {"meals": [...], "total": {...}}
  log_sleep(hours, day)                                          -> last night's sleep
  advice(history, streak, today)                                 -> {"rest": bool, "title", "tips": [...]}

Saved in data/meal_log.json (meals + sleep, the last 60 days).
"""
import json
import os
import re
import uuid
from datetime import date, timedelta

from paths import data_file

STATE_FILE = data_file("meal_log.json")
KEEP_DAYS = 60
MACROS = ("kcal", "protein", "carbs", "fat")

PHOTO_PROMPT = ("This is a photo of a meal. Estimate what it is and its nutrition for the whole plate. Answer ONLY JSON: "
                '{"name": "short dish name", "kcal": number, "protein": grams, "carbs": grams, "fat": grams, '
                '"note": "one short sentence: what you saw and how sure you are"}. '
                'If it is not food, answer {"name": "", "note": "That doesn\'t look like food."}.')


def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict):
            d.setdefault("meals", {})
            d.setdefault("sleep", {})
            return d
    except (OSError, ValueError):
        pass
    return {"meals": {}, "sleep": {}}


def _save(d):
    cutoff = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    for k in ("meals", "sleep"):
        d[k] = {day: v for day, v in d[k].items() if day >= cutoff}
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)


def _num(v, top=5000):
    try:
        return max(0, min(top, round(float(v))))
    except (TypeError, ValueError):
        return 0


def parse_estimate(text):
    """the model's answer -> a clean meal (name "" = not food / couldn't tell)"""
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        d = json.loads(m.group(0)) if m else {}
    except ValueError:
        d = {}
    if not isinstance(d, dict):
        d = {}
    out = {"name": str(d.get("name") or "").strip()[:80], "note": str(d.get("note") or "").strip()[:200]}
    for k in MACROS:
        out[k] = _num(d.get(k), 5000 if k == "kcal" else 500)
    return out


def _view(d, day):
    items = d["meals"].get(day, [])
    return {"day": day, "meals": items, "total": {k: sum(_num(m.get(k)) for m in items) for k in MACROS},
            "sleep": d["sleep"].get(day)}


def meals(day=None):
    return _view(_load(), day or date.today().isoformat())


def add_meal(meal, day=None):
    day = day or date.today().isoformat()
    meal = meal or {}
    name = str(meal.get("name") or "").strip()[:80]
    if not name:
        return {"error": "Give the meal a name."}
    d = _load()
    entry = {"id": uuid.uuid4().hex[:8], "name": name, **{k: _num(meal.get(k), 5000 if k == "kcal" else 500) for k in MACROS},
             "photo": bool(meal.get("photo"))}
    d["meals"].setdefault(day, []).append(entry)
    _save(d)
    return _view(d, day)


def remove_meal(meal_id, day=None):
    day = day or date.today().isoformat()
    d = _load()
    d["meals"][day] = [m for m in d["meals"].get(day, []) if m.get("id") != meal_id]
    _save(d)
    return _view(d, day)


def log_sleep(hours, day=None):
    """hours slept last night, saved on today's date"""
    day = day or date.today().isoformat()
    try:
        h = max(0.0, min(16.0, round(float(hours) * 2) / 2))
    except (TypeError, ValueError):
        return {"error": "How many hours? e.g. 7.5"}
    d = _load()
    d["sleep"][day] = h
    _save(d)
    return _view(d, day)


def advice(history, streak=0, today=None):
    """rest-day + sleep tips. history = gym.history(14) (newest first), streak = days trained in a row"""
    today = today or date.today()
    d = _load()
    week_ago = (today - timedelta(days=7)).isoformat()
    days7 = sorted({h["date"] for h in history if h["date"] > week_ago})
    trained_today = any(h["date"] == today.isoformat() for h in history)
    vols = [h.get("volume") or 0 for h in history]
    recent = sum(vols[:3]) / max(1, len(vols[:3]))
    older = sum(vols[3:10]) / max(1, len(vols[3:10])) if len(vols) > 3 else 0
    sleep = [d["sleep"][k] for k in sorted(d["sleep"]) if k > week_ago]
    avg_sleep = round(sum(sleep) / len(sleep), 1) if sleep else None
    last_sleep = d["sleep"].get(today.isoformat())

    tips, rest = [], False
    if streak >= 4:
        rest = True
        tips.append(f"You've trained {streak} days in a row. Take today off (or just walk and stretch): muscles grow while you rest.")
    elif len(days7) >= 6:
        rest = True
        tips.append(f"{len(days7)} workouts in the last 7 days. One full rest day this week will make the next ones stronger.")
    elif older and recent < older * 0.8 and len(vols) >= 4:
        rest = True
        tips.append("Your last sessions moved less weight than usual. That often means you're tired: rest a day or do a light session.")
    elif not days7:
        tips.append("No workouts in the last week. Start easy today: 2-3 exercises, lighter weight, and build back up.")
    elif trained_today:
        tips.append("You trained today. Eat some protein in the next couple of hours and go to bed on time.")
    else:
        tips.append(f"{len(days7)} workout{'s' if len(days7) != 1 else ''} this week. You're good to train today.")

    if last_sleep is not None and last_sleep < 6:
        rest = rest or streak >= 2
        tips.append(f"Only {last_sleep:g} h of sleep last night. Keep today lighter (fewer sets, no new max) and aim for bed 30 min earlier.")
    if avg_sleep is not None:
        if avg_sleep < 7:
            tips.append(f"You average {avg_sleep:g} h of sleep. 7-9 h helps recovery and strength more than any supplement.")
        else:
            tips.append(f"You average {avg_sleep:g} h of sleep. Nice, keep it up.")
    else:
        tips.append("Log how long you slept below, and the tips get smarter.")
    tips.append("Sleep tip: same wake-up time every day, no screens 30 min before bed, and no caffeine after 2 pm.")
    return {"rest": rest, "title": "Take a rest day" if rest else "Ready to train", "tips": tips,
            "avg_sleep": avg_sleep, "last_sleep": last_sleep}
