"""
planlife.py - the Focus & planning round: hard lock, website blocking, break ideas, the week calendar, a travel
planner, the habit heatmap, a goal tree, screen time and deadline countdowns.

  UNLOCK_SENTENCE / unlock_ok(typed)       hard-lock focus: type the sentence exactly to stop early
  BLOCK_SITES / site_blocked(title, sites) a browser window showing a blocked site (YouTube, TikTok...) during focus
  break_idea(n, hour)                      what to do on a break (stretch, water, 20-20-20 eyes...)
  week(tasks, events, start)               7 days of tasks (by deadline) and events for the drag-and-drop calendar
  move_item(kind, title, old, new)         a dragged task/event moves to another day
  countdowns(tasks, events, today)         days left until each deadline / event (soonest first)
  heatmap(habit_list, days)                one row per habit: how much of the goal was done each day (0-1)
  goal tree: goals() / goal_add(title, parent) / goal_toggle(gid) / goal_remove(gid)   goals -> sub-goals -> steps, with progress
  screen time: screen_sample(app) / screen_today(day) / screen_week()     minutes per app, sampled by app.py
  travel planner: travel_plan(req) / travel_swap(plan, day, index, why)   AI plan: airfare, spots, food, commutes, hotels
  travel_links(req)                         real search links (Google Flights, Skyscanner, Booking, Airbnb, Maps)

Saved in data/goaltree.json, data/screentime.json, data/travel.json.
"""
import json
import os
import re
import threading
import uuid
from datetime import date, datetime, timedelta
from urllib.parse import quote_plus

from paths import data_file

GOALS_FILE = data_file("goaltree.json")
SCREEN_FILE = data_file("screentime.json")
TRAVEL_FILE = data_file("travel.json")
_lock = threading.Lock()


def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, type(default)) else default
    except (OSError, ValueError):
        return default


def _write(path, d):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


# ---------------------------------------------------------------- hard lock + website blocking
UNLOCK_SENTENCE = "I am choosing to give up on this focus session even though I promised myself I would finish it"


def unlock_ok(typed):
    norm = lambda s: re.sub(r"[^a-z ]", "", re.sub(r"\s+", " ", (s or "").lower())).strip()
    return norm(typed) == norm(UNLOCK_SENTENCE)


BLOCK_SITES = ["youtube", "tiktok", "facebook", "instagram", "twitter", "x.com", "reddit", "netflix", "twitch",
               "discord", "shopee", "lazada", "9gag", "pinterest"]
BROWSERS = ("google chrome", "microsoft edge", "edge", "firefox", "brave", "opera", "chrome")


def site_blocked(title, sites=None):
    """the blocked site a browser window shows ("Funny cats - YouTube - Google Chrome" -> "youtube"), else None"""
    low = (title or "").lower()
    if not any(b in low for b in BROWSERS):
        return None
    for s in sites if sites is not None else BLOCK_SITES:
        s = s.strip().lower()
        if s and (re.search(rf"(^|[\s\-|·(]){re.escape(s)}($|[\s\-|·)])", low) or (("." in s) and s in low)):
            return s
    return None


# ---------------------------------------------------------------- breaks
BREAKS = [
    ("🧘", "Stretch: arms up, then touch your toes. 30 seconds."),
    ("💧", "Drink a glass of water."),
    ("👀", "20-20-20: look at something 20 feet away for 20 seconds."),
    ("🚶", "Walk around the room or get some sunlight."),
    ("🌬️", "Box breathing: in 4, hold 4, out 4, hold 4. Three times."),
    ("🤸", "10 squats or jumping jacks to wake up."),
    ("🍎", "A healthy snack: fruit or nuts."),
    ("🪟", "Open the window and get some fresh air."),
    ("🧹", "Tidy your desk for 2 minutes."),
    ("😌", "Close your eyes and relax your shoulders."),
]


def break_idea(n=0, hour=None):
    hour = datetime.now().hour if hour is None else hour
    pool = BREAKS if 6 <= hour < 21 else [b for b in BREAKS if b[0] not in ("🤸", "🪟")]
    icon, text = pool[n % len(pool)]
    return {"icon": icon, "text": text}


# ---------------------------------------------------------------- week calendar + countdowns
def week(tasks, events, start=None):
    start = start or (date.today() - timedelta(days=date.today().weekday()))
    if isinstance(start, str):
        start = date.fromisoformat(start)
    days = []
    for i in range(7):
        d = (start + timedelta(days=i)).isoformat()
        days.append({"date": d, "weekday": (start + timedelta(days=i)).strftime("%a"),
                     "tasks": [{"title": t["task"], "priority": t.get("priority", "normal"), "done": bool(t.get("done"))}
                               for t in tasks if t.get("deadline") == d],
                     "events": [{"title": e["title"], "time": e.get("time")} for e in events if e.get("date") == d]})
    undated = [{"title": t["task"], "priority": t.get("priority", "normal")} for t in tasks if not t.get("deadline") and not t.get("done")]
    return {"start": start.isoformat(), "days": days, "undated": undated}


def move_item(data, kind, title, old, new):
    """data = f1.user_data. A task's deadline (or an event's date) becomes `new` (None = no deadline)."""
    if new:
        date.fromisoformat(new)                        # a real date, or ValueError
    if kind == "task":
        for t in data.get("tasks", []):
            if t["task"] == title and (t.get("deadline") or None) == (old or None):
                t["deadline"] = new or None
                return True
    elif kind == "event" and new:
        for e in data.get("events", []):
            if e["title"] == title and e.get("date") == old:
                e["date"] = new
                return True
    return False


def countdowns(tasks, events, today=None):
    today = today or date.today()
    out = []
    for t in tasks:
        if t.get("deadline") and not t.get("done"):
            out.append({"title": t["task"], "kind": "task", "date": t["deadline"]})
    for e in events:
        if e.get("date"):
            out.append({"title": e["title"], "kind": "event", "date": e["date"]})
    for o in out:
        try:
            o["days"] = (date.fromisoformat(o["date"]) - today).days
        except ValueError:
            o["days"] = None
    return sorted([o for o in out if o["days"] is not None and o["days"] >= -1], key=lambda o: o["days"])[:12]


# ---------------------------------------------------------------- habit heatmap
def heatmap(habit_list, days=84, today=None):
    """habit_list = habits._load()["habits"] (each has goal + log {date: count})"""
    today = today or date.today()
    keys = [(today - timedelta(days=days - 1 - i)).isoformat() for i in range(days)]
    rows = []
    for h in habit_list:
        goal = max(1, int(h.get("goal") or 1))
        rows.append({"id": h.get("id"), "name": h.get("name"), "icon": h.get("icon", "✅"),
                     "cells": [round(min(1.0, (h.get("log", {}).get(k, 0) or 0) / goal), 2) for k in keys]})
    return {"days": keys, "habits": rows}


# ---------------------------------------------------------------- goal tree
def goals():
    items = _read(GOALS_FILE, {"goals": []})["goals"]
    kids = {}
    for g in items:
        kids.setdefault(g.get("parent"), []).append(g)

    def node(g):
        ch = [node(c) for c in kids.get(g["id"], [])]
        prog = (sum(c["progress"] for c in ch) / len(ch)) if ch else (1.0 if g.get("done") else 0.0)
        return {**g, "children": ch, "progress": round(prog, 2)}
    return [node(g) for g in kids.get(None, [])]


def goal_add(title, parent=None):
    title = str(title or "").strip()[:120]
    if not title:
        return {"error": "Type the goal first."}
    with _lock:
        d = _read(GOALS_FILE, {"goals": []})
        if parent and not any(g["id"] == parent for g in d["goals"]):
            return {"error": "That goal is gone."}
        d["goals"].append({"id": uuid.uuid4().hex[:8], "title": title, "parent": parent or None, "done": False,
                           "added": date.today().isoformat()})
        _write(GOALS_FILE, d)
    return {"goals": goals()}


def goal_toggle(gid):
    with _lock:
        d = _read(GOALS_FILE, {"goals": []})
        for g in d["goals"]:
            if g["id"] == gid:
                g["done"] = not g.get("done")
        _write(GOALS_FILE, d)
    return {"goals": goals()}


def goal_remove(gid):
    with _lock:
        d = _read(GOALS_FILE, {"goals": []})
        gone = {gid}
        while True:                                       # its sub-goals go too
            more = {g["id"] for g in d["goals"] if g.get("parent") in gone} - gone
            if not more:
                break
            gone |= more
        d["goals"] = [g for g in d["goals"] if g["id"] not in gone]
        _write(GOALS_FILE, d)
    return {"goals": goals()}


# ---------------------------------------------------------------- screen time
APP_NAMES = {"chrome": "Chrome", "msedge": "Edge", "firefox": "Firefox", "code": "VS Code", "discord": "Discord",
             "spotify": "Spotify", "steam": "Steam", "explorer": "File Explorer", "winword": "Word", "excel": "Excel",
             "powerpnt": "PowerPoint", "acrord32": "Acrobat", "python": "Vermeil", "pythonw": "Vermeil", "vlc": "VLC"}


def app_name(exe):
    base = os.path.splitext(os.path.basename(exe or ""))[0].lower()
    return APP_NAMES.get(base, base[:1].upper() + base[1:] if base else "")


def screen_sample(app, seconds=30, day=None):
    if not app:
        return
    day = day or date.today().isoformat()
    with _lock:
        d = _read(SCREEN_FILE, {})
        today = d.setdefault(day, {})
        today[app] = round(today.get(app, 0) + seconds / 60, 2)
        for k in sorted(d)[:-35]:                         # keep 5 weeks
            del d[k]
        _write(SCREEN_FILE, d)


def screen_today(day=None):
    day = day or date.today().isoformat()
    apps = _read(SCREEN_FILE, {}).get(day, {})
    rows = sorted(({"app": a, "minutes": round(m)} for a, m in apps.items()), key=lambda r: -r["minutes"])
    return {"date": day, "total": round(sum(apps.values())), "apps": rows[:12]}


def screen_week(today=None):
    today = today or date.today()
    d = _read(SCREEN_FILE, {})
    return [{"date": (today - timedelta(days=6 - i)).isoformat(),
             "minutes": round(sum(d.get((today - timedelta(days=6 - i)).isoformat(), {}).values()))} for i in range(7)]


# ---------------------------------------------------------------- travel planner
PRICE_WORDS = {1: "super cheap (backpacker: hostels, street food, public transport)",
               2: "cheap (budget hotels, local eateries, jeepneys/buses/metro)",
               3: "average (3-star hotels, casual restaurants, mix of taxis and transit)",
               4: "comfortable (4-star hotels, nice restaurants, ride-hailing)",
               5: "expensive (luxury hotels, fine dining, private transfers)"}


def _clean_req(req):
    req = dict(req or {})
    place = str(req.get("place") or "").strip()[:80]
    try:
        days = max(1, min(14, int(req.get("days") or 0)))
    except (TypeError, ValueError):
        days = 0
    if not place or not req.get("days"):
        return None, "Type the place and how many days first."
    stars = max(1, min(5, int(req.get("stars") or 3)))
    return {"place": place, "days": days, "stars": stars, "origin": str(req.get("origin") or "").strip()[:80],
            "start": str(req.get("start") or "")[:10], "budget": str(req.get("budget") or "").strip()[:40],
            "currency": str(req.get("currency") or "PHP")[:5], "people": max(1, min(12, int(req.get("people") or 1))),
            "avoid": [str(a)[:80] for a in (req.get("avoid") or [])][:30]}, None


def travel_links(req):
    p, o = quote_plus(req["place"]), quote_plus(req.get("origin") or "")
    start = req.get("start") or ""
    end = ""
    if start:
        try:
            end = (date.fromisoformat(start) + timedelta(days=req["days"])).isoformat()
        except ValueError:
            start = ""
    links = {"flights": f"https://www.google.com/travel/flights?q=Flights%20to%20{p}" + (f"%20from%20{o}" if o else "")
                        + (f"%20on%20{start}" if start else ""),
             "skyscanner": "https://www.skyscanner.com/",
             "hotels": f"https://www.booking.com/searchresults.html?ss={p}" + (f"&checkin={start}&checkout={end}" if start else ""),
             "airbnb": f"https://www.airbnb.com/s/{p}/homes" + (f"?checkin={start}&checkout={end}" if start else ""),
             "maps": f"https://www.google.com/maps/search/{p}"}
    return links


def _travel_prompt(req, only_day=None, replace=None):
    price = PRICE_WORDS[req["stars"]]
    avoid = ("Do NOT suggest these places again: " + "; ".join(req["avoid"]) + ".") if req["avoid"] else ""
    if replace:
        return (f"Trip to {req['place']}, price level {req['stars']}/5 = {price}, currency {req['currency']}. {avoid} "
                f"Suggest ONE different {replace['kind']} to replace \"{replace['name']}\" around {replace.get('time', '')} on day "
                f"{only_day}, near the other stops of that day. {replace.get('why', '')} Return JSON: "
                '{"stop": {"time": "HH:MM", "kind": "spot|food|commute|hotel", "name": "", "area": "", "cost": number, '
                '"note": "one short line"}}')
    return (f"Plan a {req['days']}-day trip to {req['place']} for {req['people']} person(s)"
            + (f" flying from {req['origin']}" if req["origin"] else "") + (f" starting {req['start']}" if req["start"] else "")
            + f". Price level {req['stars']}/5 = {price}." + (f" Total budget about {req['budget']}." if req["budget"] else "")
            + f" Use {req['currency']} for every cost. {avoid} Use REAL, well-known tourist spots and restaurants that exist. "
            "Each day goes in order: commute -> spot -> food -> commute -> spot... with the commute mode (jeepney, bus, "
            "MRT, taxi, Grab, walk, ferry) and its typical fare per person. Give typical entrance fees and meal prices. "
            "Suggest 3 places to stay (hotel or Airbnb-type) near the main spots within the price level, with price per night. "
            "If flying, give a typical cheapest round-trip airfare range and which airline/airport. Costs are estimates. "
            "Return JSON only: {\"summary\": \"\", \"airfare\": {\"route\": \"\", \"low\": number, \"high\": number, "
            "\"airlines\": \"\", \"tip\": \"\"}, \"stays\": [{\"name\": \"\", \"type\": \"hotel|airbnb|hostel\", \"area\": \"\", "
            "\"per_night\": number, \"why\": \"\"}], \"days\": [{\"day\": 1, \"title\": \"\", \"stops\": [{\"time\": \"HH:MM\", "
            "\"kind\": \"commute|spot|food\", \"name\": \"\", \"area\": \"\", \"cost\": number, \"note\": \"\"}]}], "
            "\"tips\": [\"\"]}")


def _total(plan):
    for d in plan.get("days", []):
        d["total"] = round(sum(float(s.get("cost") or 0) for s in d.get("stops", [])), 2)
    stay = min((float(s.get("per_night") or 0) for s in plan.get("stays", [])), default=0)
    air = float((plan.get("airfare") or {}).get("low") or 0)
    plan["estimate"] = round(sum(d["total"] for d in plan.get("days", [])) + stay * max(0, len(plan.get("days", [])) - 1) + air, 2)
    return plan


def travel_plan(req, ask=None):
    """req: {place, days, stars 1-5, origin, start (YYYY-MM-DD), budget, currency, people, avoid[]}"""
    req, err = _clean_req(req)
    if err:
        return {"error": err}
    if ask is None:
        import llm
        ask = lambda p: llm.ask(p, json_mode=True, temperature=0.6)
    try:
        plan = ask(_travel_prompt(req))
    except Exception as e:  # noqa: BLE001
        return {"error": f"Couldn't make the plan right now ({e}). Check the internet / AI connection."}
    if not isinstance(plan, dict) or not plan.get("days"):
        return {"error": "The AI didn't return a plan. Try again."}
    plan = _total(plan)
    plan["request"], plan["links"] = req, travel_links(req)
    plan["made"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    with _lock:
        d = _read(TRAVEL_FILE, {"plans": []})
        d["plans"] = ([p for p in d["plans"] if p["request"]["place"] != req["place"]] + [plan])[-10:]
        _write(TRAVEL_FILE, d)
    return plan


def travel_swap(plan, day, index, why="", ask=None):
    """replace one stop the user doesn't like with a new suggestion (and never suggest the old one again)"""
    try:
        stops = plan["days"][int(day) - 1]["stops"]
        old = stops[int(index)]
    except (KeyError, IndexError, TypeError, ValueError):
        return {"error": "That stop isn't in the plan."}
    req, err = _clean_req({**plan.get("request", {}), "avoid": plan.get("request", {}).get("avoid", []) + [old.get("name", "")]})
    if err:
        return {"error": err}
    if ask is None:
        import llm
        ask = lambda p: llm.ask(p, json_mode=True, temperature=0.9)
    try:
        new = ask(_travel_prompt(req, int(day), {**old, "why": f"The user said: {why}" if why else ""})).get("stop")
    except Exception as e:  # noqa: BLE001
        return {"error": f"Couldn't get a new suggestion ({e})."}
    if not isinstance(new, dict) or not new.get("name"):
        return {"error": "No new suggestion came back. Try again."}
    stops[int(index)] = new
    plan["request"] = req
    return _total(plan)


def travel_edit(plan, day, index, stop):
    """you typed your own place / time / cost for a stop"""
    try:
        cur = plan["days"][int(day) - 1]["stops"]
        i = int(index)
    except (KeyError, IndexError, TypeError, ValueError):
        return {"error": "That day isn't in the plan."}
    clean = {"time": str(stop.get("time") or "")[:5], "kind": stop.get("kind") if stop.get("kind") in ("spot", "food", "commute", "hotel") else "spot",
             "name": str(stop.get("name") or "").strip()[:80], "area": str(stop.get("area") or "")[:60],
             "cost": float(stop.get("cost") or 0), "note": str(stop.get("note") or "")[:120]}
    if not clean["name"]:
        return {"error": "Type the place."}
    if i >= len(cur):
        cur.append(clean)
    else:
        cur[i] = clean
    return _total(plan)


def travel_saved():
    return _read(TRAVEL_FILE, {"plans": []})["plans"][::-1]
