"""
gymlife.py - the Gym & health round: next week's weights, a coach plan that changes when you miss a day, a
personal-records wall, a weekly muscle map that fades, a protein bar, a grocery list with store prices, a sleep
goal with make-up tips, supplement reminders and GPS runs.

  next_weights(days, last_fn)                 heavier only when EVERY set hit the top of the rep range last time
  adjust_plan(log, days, next_day, today)     missed days -> catch-up message, merged key lifts, or a lighter week
  prs(log, e1rm, rep_value)                   best estimated 1-rep max / heaviest / most reps, with trophies
  week_muscles(log, muscles_for, today)       {muscle: 0..1} for the last 7 days (fades as days pass)
  protein_bar(total, target)                  today's protein vs the goal
  grocery_list(plan, days) / grocery_prices(items, country, ask)   a week's shopping from the meal plan + prices
  sleep_report(sleep, need, bedtime, today)   7-night sleep debt, make-up tips, progress for Focus
  supplements: supp_list(now) / supp_save(item) / supp_remove(sid) / supp_take(sid, slot) / supp_due(now)
  runs: run_save(points, note) / runs() / run_remove(rid) / run_stats(points)   Strava-like GPS runs

Saved in data/gymlife.json. Every AI call takes ask= so tests can fake it.
"""
import json
import math
import os
import re
import uuid
from datetime import date, datetime, timedelta

from paths import data_file

STATE_FILE = data_file("gymlife.json")


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


def _num(v):
    try:
        return float(re.findall(r"-?\d+(?:\.\d+)?", str(v))[0])
    except (IndexError, TypeError, ValueError):
        return None


def _top(target):
    nums = [int(n) for n in re.findall(r"\d+", target or "")]
    return max(nums) if nums else None


def _step(kg):
    return 2.5 if (kg or 0) >= 10 else 1.25


# ------------------------------------------------------------------ 84: progressive overload
def next_weights(days, last_fn):
    """days: routine["days"]. last_fn(name) -> gym.last_performance(name) or None.
    Heavier only when every planned set was done AND every set hit the top of the rep range."""
    out = []
    for day in days:
        for ex in day.get("exercises", []):
            name, top, sets = ex.get("name", ""), _top(ex.get("target")), int(ex.get("sets") or 1)
            row = {"name": name, "day": day.get("day"), "target": ex.get("target", ""), "sets": sets}
            last = last_fn(name)
            if ex.get("timed") or not top:
                out.append(row | {"status": "skip", "kg": ex.get("kg"), "next": ex.get("kg"), "why": "Timed or no rep target."})
                continue
            if not last:
                out.append(row | {"status": "new", "kg": ex.get("kg"), "next": ex.get("kg"), "why": "No log yet: do it once first."})
                continue
            done = last["sets"]
            kg = max((s.get("kg") or 0) for s in done) or (ex.get("kg") or 0)
            reps = [_num(s.get("reps")) for s in done]
            missed = [f"set {s['set']}: {_num(s.get('reps')) or 0:g}/{top}" for s in done
                      if (_num(s.get("reps")) or 0) < top]
            if len(done) < sets:
                out.append(row | {"status": "keep", "kg": kg, "next": kg, "date": last["date"],
                                  "why": f"Only {len(done)} of {sets} sets done last time. Same weight: do all {sets} sets."})
            elif all(r is not None and r >= top for r in reps):
                nxt = round(kg + _step(kg), 2)
                out.append(row | {"status": "up", "kg": kg, "next": nxt, "date": last["date"],
                                  "why": f"All {sets} sets hit {top} reps. Go to {nxt:g} kg."})
            else:
                out.append(row | {"status": "keep", "kg": kg, "next": kg, "date": last["date"],
                                  "why": f"Same weight until every set reaches {top} ({', '.join(missed)})."})
    return out


# ------------------------------------------------------------------ 92: plan that changes if you miss a day
def adjust_plan(log, days, next_day, today=None, per_week=None):
    """log: gym._log(). days: routine["days"]. next_day: the day number gym.next_day() picked.
    Missed sessions this week -> fold the next day's first two lifts into today. A long break -> lighter week."""
    today = today or date.today()
    if not days:
        return {"message": "", "day": None, "extra": [], "deload": False}
    trained = sorted(d for d, e in log.items() if e.get("sets") and d <= today.isoformat())
    per_week = int(per_week or min(6, len(days)))
    monday = today - timedelta(days=today.weekday())
    done = len([d for d in trained if d >= monday.isoformat()])
    trained_today = today.isoformat() in trained
    days_left = 7 - today.weekday() - (1 if trained_today else 0)       # including today, unless already done
    left = max(0, per_week - done)
    gap = (today - date.fromisoformat(trained[-1])).days if trained else None
    nums = [d["day"] for d in days]
    out = {"day": next_day, "extra": [], "deload": False, "done": done, "per_week": per_week, "gap": gap,
           "days_left": days_left, "left": left}
    if gap is not None and gap >= 10:
        out["deload"] = True
        out["message"] = (f"{gap} days since your last workout. This week is a comeback week: use about 80% of your "
                          "last weights and stop 2 reps before failure.")
        return out
    if left > days_left and not trained_today and next_day in nums:
        nxt = nums[(nums.index(next_day) + 1) % len(nums)]
        other = next(d for d in days if d["day"] == nxt)
        out["extra"] = [{"name": e["name"], "from_day": nxt, "sets": min(3, int(e.get("sets") or 3)),
                         "target": e.get("target", "")} for e in other.get("exercises", [])[:2]]
        out["message"] = (f"You missed some days: {left} workouts left but only {days_left} days this week. "
                          f"Today adds the 2 main lifts from Day {nxt} (3 sets each) so nothing big is skipped.")
    elif gap is not None and gap >= 3:
        out["message"] = f"{gap} days off. No problem: today is Day {next_day}, right where you stopped."
    else:
        out["message"] = f"On track: {done} of {per_week} workouts this week."
    return out


# ------------------------------------------------------------------ 93: personal records wall
TROPHIES = ["🥇", "🥈", "🥉"]


def prs(log, e1rm, rep_value, today=None):
    """best per exercise: estimated 1RM, heaviest kg, most reps. The top 3 by 1RM get trophies.
    'new' = the record was set in the last 7 days."""
    today = today or date.today()
    best = {}
    for d, entry in log.items():
        for s in entry.get("sets", []):
            name, kg, reps = s.get("exercise", ""), s.get("kg") or 0, rep_value(s.get("reps")) or 0
            if not name or not reps:
                continue
            b = best.setdefault(name.lower(), {"name": name, "e1rm": 0, "e1rm_date": d, "kg": 0, "kg_date": d,
                                               "reps": 0, "reps_date": d, "sets": 0})
            b["sets"] += 1
            one = e1rm(kg, reps) if kg else 0
            if one > b["e1rm"]:
                b.update(e1rm=one, e1rm_date=d, e1rm_set=f"{kg:g} kg × {s.get('reps')}")
            if kg > b["kg"]:
                b.update(kg=kg, kg_date=d)
            if reps > b["reps"]:
                b.update(reps=reps, reps_date=d)
    week_ago = (today - timedelta(days=7)).isoformat()
    rows = sorted(best.values(), key=lambda b: (-b["e1rm"], -b["reps"]))
    for i, b in enumerate(rows):
        b["trophy"] = TROPHIES[i] if i < 3 and b["e1rm"] else ""
        b["new"] = max(b["e1rm_date"], b["kg_date"], b["reps_date"]) >= week_ago
    return rows


# ------------------------------------------------------------------ 97: muscles trained this week
def week_muscles(log, muscles_for, today=None, days=7):
    """{muscle: 0..1}: 1 = trained today, fading to ~0.15 after 6 days. More sets the same day count a bit more."""
    today = today or date.today()
    out = {}
    for d, entry in log.items():
        try:
            ago = (today - date.fromisoformat(d)).days
        except ValueError:
            continue
        if ago < 0 or ago >= days:
            continue
        fade = 1 - ago / days
        per = {}
        for s in entry.get("sets", []):
            for i, m in enumerate(muscles_for(s.get("exercise", ""))):
                per[m] = per.get(m, 0) + (1 if i == 0 else 0.5)          # main muscle counts full, helpers half
        for m, n in per.items():
            v = round(fade * min(1.0, 0.6 + n * 0.08), 2)
            out[m] = max(out.get(m, 0), v)
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


# ------------------------------------------------------------------ 88: protein bar
def protein_target(profile, goal="recomp"):
    w = _num((profile or {}).get("weight"))
    if not w:
        return None
    return round(w * (1.8 if goal == "bulk" else 2.0))


def protein_bar(total, target):
    have = round((total or {}).get("protein") or 0)
    if not target:
        return {"have": have, "target": None, "pct": 0, "text": "Fill in your weight in Calories to get a protein goal."}
    pct = min(100, round(have / target * 100))
    left = max(0, target - have)
    text = f"{have} / {target} g protein" + (f" · {left} g to go" if left else " · goal reached 💪")
    return {"have": have, "target": target, "pct": pct, "left": left, "text": text}


# ------------------------------------------------------------------ 89: grocery list + store prices
STORES = {
    "PH": {"store": "SM Supermarket", "currency": "₱", "search": "https://www.google.com/search?q=SM+Supermarket+price+{q}"},
    "US": {"store": "Walmart", "currency": "$", "search": "https://www.walmart.com/search?q={q}"},
}
PH_WORDS = ("philippines", "manila", "quezon", "cebu", "davao", "makati", "taguig", "pasig", "ph", "pampanga",
            "laguna", "cavite", "baguio", "iloilo", "bacolod")


def country_for(city):
    """'Quezon City' / 'Manila, PH' -> 'PH'; anything else -> 'US' (Walmart)"""
    words = re.findall(r"[a-z]+", (city or "").lower())
    return "PH" if any(w in PH_WORDS for w in words) else "US"


def grocery_list(plan, days=7):
    """plan: gym.meal_plan(...) for one day. Grams x days, rounded to sensible buy amounts."""
    total = {}
    for m in plan.get("meals", []):
        for it in m.get("items", []):
            total[it["food"]] = total.get(it["food"], 0) + it["grams"] * days
    out = []
    for food, g in sorted(total.items(), key=lambda kv: -kv[1]):
        if food == "Eggs":
            qty = f"{math.ceil(g / 50)} eggs"
        elif food in ("Milk",):
            qty = f"{math.ceil(g / 1000)} L"
        elif g >= 1000:
            qty = f"{math.ceil(g / 250) * 250 / 1000:g} kg"
        else:
            qty = f"{math.ceil(g / 50) * 50} g"
        out.append({"food": food, "grams": round(g), "qty": qty})
    return out


PRICE_PROMPT = ("You estimate grocery prices at {store} ({country}) in {currency}. For each item give the usual shelf "
                "price for the amount listed (a typical store brand). Answer ONLY JSON: "
                '{{"items": [{{"food": "...", "price": number}}], "note": "one short sentence"}}.\n\nItems:\n{items}')


def grocery_prices(items, country="PH", ask=None, today=None):
    """AI price estimates per item from the nearest big store (SM Supermarket in PH, Walmart in the US).
    Cached per country + food for 7 days."""
    s = STORES.get(country, STORES["US"])
    today = today or date.today()
    d = _read()
    cache = d.setdefault("prices", {}).setdefault(country, {})
    fresh = (today - timedelta(days=7)).isoformat()
    need = [i for i in items if not (cache.get(i["food"]) and cache[i["food"]].get("qty") == i["qty"]
                                     and cache[i["food"]]["date"] >= fresh)]
    note = ""
    if need and ask:
        try:
            raw = ask(PRICE_PROMPT.format(store=s["store"], country=country, currency=s["currency"],
                                          items="\n".join(f"- {i['food']}: {i['qty']}" for i in need)))
            got = json.loads(raw) if isinstance(raw, str) else raw
            for row in got.get("items", []):
                p = _num(row.get("price"))
                match = next((i for i in need if i["food"].lower() == str(row.get("food", "")).lower()), None)
                if match and p is not None and p >= 0:
                    cache[match["food"]] = {"price": round(p, 2), "qty": match["qty"], "date": today.isoformat()}
            note = str(got.get("note", ""))[:200]
            _write(d)
        except Exception as e:  # noqa: BLE001
            note = f"Couldn't get prices right now ({e.__class__.__name__})."
    rows = []
    for i in items:
        c = cache.get(i["food"])
        price = c["price"] if c and c.get("qty") == i["qty"] else None
        rows.append(i | {"price": price, "link": s["search"].format(q=i["food"].replace(" ", "+"))})
    total = round(sum(r["price"] for r in rows if r["price"] is not None), 2)
    return {"store": s["store"], "currency": s["currency"], "country": country, "items": rows, "total": total,
            "note": note or "Prices are estimates. Check the store before you go."}


# ------------------------------------------------------------------ 91: sleep goal, debt and make-up tips
def sleep_settings():
    s = _read().get("sleep", {})
    return {"need": s.get("need", 8), "bedtime": s.get("bedtime", "23:00"), "wind_down": s.get("wind_down", 45)}


def sleep_save(need=None, bedtime=None, wind_down=None):
    d = _read()
    s = d.setdefault("sleep", {})
    if need not in (None, ""):
        n = _num(need)
        if n is None or not 4 <= n <= 12:
            return {"error": "Hours you need: 4 to 12 (most adults need 7-9)."}
        s["need"] = round(n * 2) / 2
    if bedtime:
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(bedtime)):
            return {"error": "Bedtime like 22:30"}
        s["bedtime"] = bedtime
    if wind_down not in (None, ""):
        s["wind_down"] = max(10, min(120, int(_num(wind_down) or 45)))
    _write(d)
    return sleep_settings()


def _hhmm(t, add_min=0):
    h, m = (int(x) for x in t.split(":"))
    total = (h * 60 + m + add_min) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"


def sleep_report(sleep, need=8, bedtime="23:00", today=None):
    """sleep: {date: hours} (gymcoach's meal_log.json 'sleep'). The last 7 nights -> debt, met nights, tips."""
    today = today or date.today()
    nights = []
    for i in range(6, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        nights.append({"date": d, "hours": sleep.get(d), "met": sleep.get(d) is not None and sleep[d] >= need})
    logged = [n for n in nights if n["hours"] is not None]
    debt = round(sum(max(0, need - n["hours"]) for n in logged), 1)
    met = sum(n["met"] for n in nights)
    avg = round(sum(n["hours"] for n in logged) / len(logged), 1) if logged else None
    streak = 0
    for n in reversed(nights):
        if not n["met"]:
            break
        streak += 1
    tips = []
    if not logged:
        tips.append("Log how long you slept each morning to see your sleep debt.")
    elif debt <= 0.5:
        tips.append(f"No sleep debt this week. Keep the same bedtime ({bedtime}).")
    else:
        earlier = min(60, max(15, round(debt * 60 / 4 / 15) * 15))      # pay it back over ~4 nights, max 1 h earlier
        tips.append(f"You owe {debt:g} h this week. Go to bed {earlier} min earlier ({_hhmm(bedtime, -earlier)}) for the next 4 nights.")
        if debt >= 2:
            tips.append("A 20-minute nap before 3 pm helps. Longer than 90 min makes it harder to sleep tonight.")
        tips.append("Don't sleep in more than 1 hour on weekends: it shifts your body clock and makes Monday worse.")
    if avg is not None and avg < need - 1:
        tips.append("No screens 30 min before bed and no coffee after 2 pm make falling asleep faster.")
    return {"need": need, "bedtime": bedtime, "nights": nights, "debt": debt, "met": met, "avg": avg,
            "streak": streak, "pct": round(met / 7 * 100), "tips": tips,
            "summary": f"{met}/7 nights with {need:g} h" + (f" · {debt:g} h sleep debt" if debt > 0.5 else "")}


def wind_down_due(now, bedtime="23:00", minutes=45):
    """True during the `minutes` before bedtime"""
    bed = now.replace(hour=int(bedtime[:2]), minute=int(bedtime[3:]), second=0, microsecond=0)
    left = (bed - now).total_seconds() / 60
    return 0 <= left <= minutes


# ------------------------------------------------------------------ 98: supplements / medicine
def _supps(d):
    return d.setdefault("supplements", {"items": [], "taken": {}})


def supp_save(item):
    """{name, dose, times: ['08:00', '20:00'], id?} -> the list"""
    name = str(item.get("name") or "").strip()[:60]
    if not name:
        return {"error": "Name it first (e.g. Creatine, Vitamin D)."}
    times = [t for t in (item.get("times") or []) if re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(t))]
    if not times:
        return {"error": "Add at least one time like 08:00."}
    d = _read()
    s = _supps(d)
    row = {"id": item.get("id") or uuid.uuid4().hex[:8], "name": name, "dose": str(item.get("dose") or "")[:40],
           "times": sorted(set(times))}
    s["items"] = [x for x in s["items"] if x["id"] != row["id"]] + [row]
    _write(d)
    return supp_list()


def supp_remove(sid):
    d = _read()
    s = _supps(d)
    s["items"] = [x for x in s["items"] if x["id"] != sid]
    _write(d)
    return supp_list()


def supp_take(sid, slot, day=None, undo=False):
    day = day or date.today().isoformat()
    d = _read()
    s = _supps(d)
    key = f"{sid}@{slot}"
    taken = set(s["taken"].get(day, []))
    taken.discard(key) if undo else taken.add(key)
    s["taken"][day] = sorted(taken)
    cutoff = (date.fromisoformat(day) - timedelta(days=30)).isoformat()
    s["taken"] = {k: v for k, v in s["taken"].items() if k >= cutoff}
    _write(d)
    return supp_list()


def supp_list(now=None):
    now = now or datetime.now()
    day, hm = now.date().isoformat(), now.strftime("%H:%M")
    s = _supps(_read())
    taken = set(s["taken"].get(day, []))
    rows = []
    for x in s["items"]:
        slots = [{"time": t, "taken": f"{x['id']}@{t}" in taken, "due": t <= hm and f"{x['id']}@{t}" not in taken}
                 for t in x["times"]]
        rows.append(x | {"slots": slots})
    week = []
    for i in range(6, -1, -1):
        d = (now.date() - timedelta(days=i)).isoformat()
        want = sum(len(x["times"]) for x in s["items"])
        week.append({"date": d, "taken": len(s["taken"].get(d, [])), "want": want})
    return {"items": rows, "week": week}


def supp_due(now=None, told=()):
    """slots whose time has come (within 2 h) and that aren't taken or already reminded -> [(key, text)]"""
    now = now or datetime.now()
    out = []
    for x in supp_list(now)["items"]:
        for sl in x["slots"]:
            key = f"{now.date().isoformat()}:{x['id']}@{sl['time']}"
            mins = (now - now.replace(hour=int(sl["time"][:2]), minute=int(sl["time"][3:]), second=0, microsecond=0)).total_seconds() / 60
            if sl["due"] and mins <= 120 and key not in told:
                out.append((key, f"💊 Time for {x['name']}" + (f" ({x['dose']})" if x["dose"] else "") + "."))
    return out


# ------------------------------------------------------------------ 94: GPS runs / walks
def _haversine(a, b):
    r = 6371000
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def run_stats(points):
    """points: [[lat, lon, t_ms, accuracy_m?], ...] -> distance (m), seconds, pace (min/km), steps (estimate).
    Jumps faster than 12 m/s (GPS glitches) and fixes worse than 50 m are skipped."""
    pts = [p for p in points if len(p) >= 3 and (len(p) < 4 or p[3] is None or p[3] <= 50)]
    dist, keep = 0.0, pts[:1]
    for p in pts[1:]:
        step = _haversine(keep[-1], p)
        dt = max(0.001, (p[2] - keep[-1][2]) / 1000)
        if step / dt > 12:
            continue
        if step >= 2:                       # ignore standing-still jitter
            dist += step
            keep.append(p)
    secs = round((pts[-1][2] - pts[0][2]) / 1000) if len(pts) > 1 else 0
    km = dist / 1000
    pace = round(secs / 60 / km, 2) if km >= 0.05 else None
    return {"meters": round(dist), "km": round(km, 2), "seconds": secs, "pace": pace,
            "pace_text": f"{int(pace)}:{round(pace % 1 * 60):02d} /km" if pace else "-",
            "steps": round(dist / 0.78), "kcal": round(km * 60), "route": [[round(p[0], 6), round(p[1], 6)] for p in keep]}


def run_save(points, note="", kind="run", when=None):
    st = run_stats(points or [])
    if st["meters"] < 20:
        return {"error": "Too short to save (under 20 m). Was location allowed?"}
    route = st.pop("route")
    if len(route) > 400:                     # keep the file small
        k = math.ceil(len(route) / 400)
        route = route[::k] + [route[-1]]
    d = _read()
    row = {"id": uuid.uuid4().hex[:8], "date": (when or datetime.now()).isoformat(timespec="minutes"),
           "kind": kind if kind in ("run", "walk", "ride") else "run", "note": str(note)[:120], "route": route, **st}
    d.setdefault("runs", []).insert(0, row)
    d["runs"] = d["runs"][:200]
    _write(d)
    return runs()


def runs(today=None):
    today = today or date.today()
    rows = _read().get("runs", [])
    monday = (today - timedelta(days=today.weekday())).isoformat()
    week = [r for r in rows if r["date"][:10] >= monday]
    best = max((r for r in rows if r.get("pace") and r["km"] >= 1), key=lambda r: -r["pace"], default=None)
    return {"runs": rows, "week_km": round(sum(r["km"] for r in week), 2), "week_steps": sum(r["steps"] for r in week),
            "week_count": len(week), "best_pace": best["pace_text"] if best else None,
            "longest": max((r["km"] for r in rows), default=0)}


def run_remove(rid):
    d = _read()
    d["runs"] = [r for r in d.get("runs", []) if r["id"] != rid]
    _write(d)
    return runs()


# ------------------------------------------------------------------ 81: which demo move goes with an exercise
DEMOS = [  # (regex on the exercise name, demo key) - first match wins
    (r"squat|leg press|goblet|hack", "squat"), (r"lunge|split|step.?up|bulgarian", "lunge"),
    (r"deadlift|rdl|romanian|hip thrust|good morning|hinge", "deadlift"),
    (r"push.?up|press.?up|\bdips?\b", "pushup"), (r"curl", "curl"),
    (r"\brow(s|ing)?\b|pull.?up|chin.?up|\blats?\b|pulldown", "row"), (r"press|bench|fly|raise|extension|tricep", "press"),
    (r"plank|crunch|sit.?up|\babs?\b|\bcore\b|hollow", "plank"), (r"jump|jack|burpee|cardio|\brun|skipping", "jumping_jacks"),
]
DEMO_PROMPTS = {
    "squat": "An object does bodyweight squats, bending the knees and standing back up.",
    "lunge": "An object does forward lunges, alternating legs.",
    "deadlift": "An object bends at the hips with a flat back and stands up tall, like a deadlift.",
    "pushup": "An object does push-ups on the floor.",
    "curl": "An object does bicep curls with both arms.",
    "row": "An object pulls both arms back to the chest, like a rowing exercise.",
    "press": "An object pushes both hands straight up overhead and lowers them, like a shoulder press.",
    "plank": "An object holds a plank on the floor.",
    "jumping_jacks": "An object does jumping jacks.",
}


def demo_for(name):
    n = (name or "").lower()
    return next((k for rx, k in DEMOS if re.search(rx, n)), None)
