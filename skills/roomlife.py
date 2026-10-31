"""
roomlife.py - the living room on the home screen: things that change by themselves and things you save.

  presets() / save_preset(name, layout) / load_preset(name) / delete_preset(name)   several room designs
  photos(folder)              the pictures a photo frame can show (newest first)
  photo_data(path, size)      one picture, made small, as a data: URL the 3D frame can use
  weather_kind(text)          "rain" | "snow" | "storm" | "fog" | "cloudy" | "clear" from a forecast's words
  weather_widget(city)        the wall clock/weather widget: now + 5 days (cached 30 min)
  plant(minutes_by_day)       the focus plant: grows with focus minutes, wilts after days without
  top_tasks(tasks)            the 3 most important unfinished tasks (the optional wall board)
  decor(today)                which seasonal decorations turn on by themselves
  holiday(today)              today's holiday (for Vermeil's greeting), or None
  achievements(layout, q)     room achievements (things you did with your room)
  tip()                       a loading-screen tip or one of Vermeil's lines

Saved in data/room_presets.json.
"""
import base64
import io
import json
import os
import random
import time
from datetime import date

from paths import data_file

PRESETS_FILE = data_file("room_presets.json")
PHOTO_TYPES = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")
_weather_cache = {}

TIPS = [
    "Tip: press ✏️ Edit room, then 🛒 Shop to spend your VCash on furniture.",
    "Tip: every XP you earn also gives you half as much VCash.",
    "Tip: the focus plant grows every day you focus, and wilts if you skip two days.",
    "Tip: click the weather clock on the wall to see the 5-day forecast.",
    "Tip: save more than one room design in Edit room → Designs.",
    "Tip: say \"search inside for ...\" to search in the app's own browser.",
    "Tip: a new themed furniture set comes to the shop every month.",
    "Tip: photo frames come in 6 styles and 3 sizes. Pick a folder of pictures in the frame's options.",
    "Tip: clap twice to wake Vermeil when the double-clap wake is on.",
    "Tip: Exam week mode clears your schedule down to studying, sleep and food.",
]
LINES = [
    "Vermeil: \"I tidied the room while you were away. Mostly.\"",
    "Vermeil: \"Don't forget to drink water today, okay?\"",
    "Vermeil: \"I saved you a spot on the sofa.\"",
    "Vermeil: \"Ready when you are!\"",
    "Vermeil: \"Let's make today a good one.\"",
    "Vermeil: \"Did you sleep enough? Be honest.\"",
]


# ---------------------------------------------------------------- room designs
def _read():
    try:
        with open(PRESETS_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(d):
    tmp = PRESETS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    os.replace(tmp, PRESETS_FILE)


def presets():
    d = _read()
    return [{"name": k, "saved": v.get("saved", ""), "items": len((v.get("layout") or {}).get("items", []))}
            for k, v in sorted(d.items(), key=lambda kv: kv[1].get("saved", ""), reverse=True)]


def save_preset(name, layout):
    name = (name or "").strip()[:40]
    if not name:
        return {"error": "Give the design a name."}
    if not isinstance(layout, dict) or "items" not in layout:
        return {"error": "Nothing to save."}
    d = _read()
    d[name] = {"saved": time.strftime("%Y-%m-%d %H:%M"), "layout": layout}
    _write(d)
    return {"ok": True, "presets": presets()}


def load_preset(name):
    p = _read().get(name)
    return {"layout": p["layout"]} if p else {"error": "That design isn't saved."}


def delete_preset(name):
    d = _read()
    d.pop(name, None)
    _write(d)
    return {"ok": True, "presets": presets()}


# ---------------------------------------------------------------- photo frames
def photos(folder=None, limit=60):
    folder = folder or os.path.join(os.path.expanduser("~"), "Pictures")
    if not os.path.isdir(folder):
        return {"folder": folder, "photos": [], "error": "That folder isn't there."}
    found = []
    for root, _dirs, files in os.walk(folder):
        for f in files:
            if f.lower().endswith(PHOTO_TYPES):
                p = os.path.join(root, f)
                try:
                    found.append((os.path.getmtime(p), p))
                except OSError:
                    pass
        if len(found) > 2000:
            break
    found.sort(reverse=True)
    return {"folder": folder, "photos": [{"name": os.path.basename(p), "path": p} for _t, p in found[:limit]]}


def photo_data(path, size=512):
    if not path or not os.path.isfile(path) or not path.lower().endswith(PHOTO_TYPES):
        return {"error": "That picture isn't there."}
    try:
        from PIL import Image, ImageOps
        im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
        im.thumbnail((size, size))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        return {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), "w": im.width, "h": im.height}
    except Exception as e:  # noqa: BLE001 - a broken picture just isn't shown
        return {"error": f"Couldn't open the picture ({e})."}


# ---------------------------------------------------------------- weather
def weather_kind(text):
    t = (text or "").lower()
    if any(w in t for w in ("thunder", "storm")):
        return "storm"
    if any(w in t for w in ("snow", "sleet", "blizzard", "ice")):
        return "snow"
    if any(w in t for w in ("rain", "drizzle", "shower")):
        return "rain"
    if any(w in t for w in ("fog", "mist", "haze")):
        return "fog"
    if any(w in t for w in ("cloud", "overcast")):
        return "cloudy"
    return "clear"


def weather_widget(city, fetch=None):
    if not city:
        return {"error": "Set your home city in Settings → Productivity first.", "kind": "clear"}
    hit = _weather_cache.get(city)
    if hit and time.time() - hit[0] < 1800:
        return hit[1]
    if fetch is None:
        import web
        fetch = web.forecast
    f = fetch(city, 5)
    if not f or f.get("error"):
        return {"error": (f or {}).get("error", "No weather right now."), "kind": "clear"}
    now = f.get("now") or {}
    out = {"place": f.get("place", city), "temp_c": now.get("temp_c"), "text": now.get("text", ""),
           "kind": weather_kind(now.get("text")), "days": f.get("days", [])[:5], "alerts": f.get("alerts", [])}
    _weather_cache[city] = (time.time(), out)
    return out


# ---------------------------------------------------------------- focus plant
def plant(minutes_by_day):
    """minutes_by_day: focus minutes for the last days, oldest first (today last).
    stage 0 (seed) .. 5 (blooming); wilt 0 (fine) .. 2 (badly wilted)."""
    days = list(minutes_by_day or [])
    total = sum(days[-14:])
    stage = 0
    for need in (10, 60, 180, 400, 800):
        if total >= need:
            stage += 1
    skipped = 0
    for m in reversed(days):
        if m:
            break
        skipped += 1
    wilt = 0 if skipped < 2 else (1 if skipped < 4 else 2)
    msg = ["A tiny seed. Focus to make it sprout!", "It sprouted!", "Little leaves are growing.",
           "It's getting bushy.", "Buds are coming!", "It's blooming! 🌸"][stage]
    if wilt:
        msg = "It's wilting... a focus session will perk it up." if wilt == 1 else "It's badly wilted. It misses you."
    return {"stage": stage, "wilt": wilt, "minutes": total, "skipped_days": skipped, "message": msg}


# ---------------------------------------------------------------- top 3 tasks
def top_tasks(tasks, n=3):
    order = {"high": 0, "normal": 1, "low": 2}
    open_ = [t for t in tasks or [] if not t.get("done")]
    open_.sort(key=lambda t: (order.get(t.get("priority", "normal"), 1), t.get("deadline") or "9999", t.get("added") or ""))
    return [{"task": t["task"], "priority": t.get("priority", "normal"), "deadline": t.get("deadline")} for t in open_[:n]]


# ---------------------------------------------------------------- seasons and holidays
HOLIDAYS = {(1, 1): "New Year's Day", (2, 14): "Valentine's Day", (3, 17): "St. Patrick's Day",
            (10, 31): "Halloween", (11, 1): "All Saints' Day", (12, 24): "Christmas Eve", (12, 25): "Christmas",
            (12, 30): "Rizal Day", (12, 31): "New Year's Eve", (6, 12): "Independence Day (PH)", (7, 4): "Independence Day (US)"}


def holiday(today=None):
    today = today or date.today()
    return HOLIDAYS.get((today.month, today.day))


def decor(today=None):
    """the seasonal decorations shown right now (they're not saved in your layout)"""
    t = today or date.today()
    m, d = t.month, t.day
    if (m == 10 and d >= 15) or (m == 11 and d <= 2):
        return "halloween"
    if m == 12 or (m == 1 and d <= 6):
        return "christmas"
    if m == 2 and d <= 14:
        return "valentine"
    if m in (3, 4, 5):
        return "spring"
    if m in (6, 7, 8):
        return "summer"
    if m == 11:
        return "autumn"
    return "none"


# ---------------------------------------------------------------- room achievements
ACHIEVEMENTS = [
    ("decorator", "Decorator: 10 things in your room", lambda c: c["items"] >= 10),
    ("collector", "Collector: 30 things in your room", lambda c: c["items"] >= 30),
    ("green", "Green thumb: 3 plants", lambda c: c["plants"] >= 3),
    ("gallery", "Gallery: 3 photo frames", lambda c: c["frames"] >= 3),
    ("shopper", "First purchase in the shop", lambda c: c["owned"] >= 1),
    ("big_spender", "Big spender: 10 shop items", lambda c: c["owned"] >= 10),
    ("themed", "Themed: a whole season set placed", lambda c: c["full_set"]),
    ("designer", "Designer: 3 saved room designs", lambda c: c["presets"] >= 3),
    ("bloom", "The focus plant bloomed", lambda c: c["plant_stage"] >= 5),
]


def achievements(layout, owned=(), sets=None, plant_stage=0):
    items = (layout or {}).get("items", [])
    types = [i.get("type", "") for i in items]
    sets = sets or {}
    c = {"items": len(items), "plants": sum(1 for t in types if "plant" in t.lower() or "bonsai" in t.lower()),
         "frames": sum(1 for t in types if t.startswith("photoFrame")), "owned": len(owned or []),
         "full_set": any(keys and all(k in types for k in keys) for keys in sets.values()),
         "presets": len(_read()), "plant_stage": plant_stage}
    return [{"id": a, "name": n, "got": bool(test(c))} for a, n, test in ACHIEVEMENTS]


def tip():
    return random.choice(TIPS + LINES)
