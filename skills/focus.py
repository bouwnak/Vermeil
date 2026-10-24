"""
focus.py - Focus Session Director + Practice Performance Tracker.

Focus: work/break rounds (e.g. 25/5 x 4) on one task, a distraction log (typed by you, or noticed from the
active window when "Notice what I'm doing" is on), and a summary with tips at the end.
Progress: your trends over the last weeks - quiz scores, focus minutes, gym volume, language streak.
"""
import json
import time
from datetime import date, datetime, timedelta

from paths import data_file

LOG_FILE = data_file("focus.json")
DISTRACTING = {"gaming", "watching", "chatting"}


def _read():
    try:
        with open(LOG_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write(d):
    with open(LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)


# ------------------------------------------------------------------ sessions
def start(task, work=25, brk=5, rounds=4):
    d = _read()
    d["current"] = {"task": (task or "Focus").strip()[:100], "work": int(work), "break": int(brk), "rounds": int(rounds),
                    "started": datetime.now().isoformat(timespec="seconds"), "distractions": [], "done_rounds": 0}
    _write(d)
    return d["current"]


def current():
    return _read().get("current")


def add_distraction(what, auto=False):
    d = _read()
    cur = d.get("current")
    if not cur:
        return None
    cur["distractions"].append({"what": (what or "distracted")[:120], "at": datetime.now().strftime("%H:%M"), "auto": bool(auto)})
    _write(d)
    return len(cur["distractions"])


def round_done():
    d = _read()
    if d.get("current"):
        d["current"]["done_rounds"] += 1
        _write(d)
    return d.get("current")


def finish(focused_minutes=None, note=""):
    """End the session, save it, and return a short summary with tips."""
    d = _read()
    cur = d.pop("current", None)
    if not cur:
        return {"error": "No focus session is running."}
    started = datetime.fromisoformat(cur["started"])
    minutes = round(focused_minutes if focused_minutes is not None else cur["done_rounds"] * cur["work"])
    entry = {**cur, "ended": datetime.now().isoformat(timespec="seconds"), "minutes": minutes, "note": note,
             "date": started.date().isoformat()}
    d.setdefault("sessions", []).append(entry)
    d["sessions"] = d["sessions"][-500:]
    _write(d)
    dist = cur["distractions"]
    summary = (f"Focused {minutes} min on '{cur['task']}' ({cur['done_rounds']}/{cur['rounds']} rounds), "
               f"{len(dist)} distraction{'s' if len(dist) != 1 else ''}.")
    tips = ""
    try:
        import llm
        tips = llm.ask(f"A student just finished a focus session. {summary} Distractions: "
                       f"{[x['what'] for x in dist] or 'none'}. Their recent sessions: {stats(7)}. Give 2 short, kind, "
                       f"specific tips for the next session (one line each).", model="chat")
    except Exception:
        pass
    return {"summary": summary, "tips": tips, "session": entry}


def stats(days=7):
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    ss = [s for s in _read().get("sessions", []) if s.get("date", "") >= since]
    return {"sessions": len(ss), "minutes": sum(s.get("minutes", 0) for s in ss),
            "distractions": sum(len(s.get("distractions", [])) for s in ss)}


# ------------------------------------------------------------------ progress across everything
def progress(days=30):
    """Daily numbers for charts: quiz %, focus minutes, gym volume, language practice."""
    first = date.today() - timedelta(days=days - 1)
    keys = [(first + timedelta(days=i)).isoformat() for i in range(days)]
    quiz = {k: [] for k in keys}
    try:
        import academic
        for r in academic.list_reviews():
            full = academic.get_review(r["id"]) or {}
            for a in full.get("attempts", []):
                k = a["at"][:10]
                if k in quiz:
                    quiz[k].append(round(100 * a["score"] / max(a["total"], 1)))
        weak = academic.weak_topics()[:5]
    except Exception:
        weak = []
    focus = {k: 0 for k in keys}
    for s in _read().get("sessions", []):
        if s.get("date") in focus:
            focus[s["date"]] += s.get("minutes", 0)
    gym_vol = {k: 0 for k in keys}
    try:
        import gym
        for h in gym.history(days):
            if h["date"] in gym_vol:
                gym_vol[h["date"]] += h["volume"]
    except Exception:
        pass
    lang_days, streak = set(), 0
    try:
        import sensei
        lang_days = set(sensei._state().get("days", []))
        streak = sensei.current_streak()
    except Exception:
        pass
    return {"days": keys,
            "quiz": [round(sum(v) / len(v)) if v else None for v in quiz.values()],
            "focus": list(focus.values()), "gym": list(gym_vol.values()),
            "language": [1 if k in lang_days else 0 for k in keys],
            "totals": {"quizzes": sum(len(v) for v in quiz.values()), "focus_minutes": sum(focus.values()),
                       "gym_sessions": sum(1 for v in gym_vol.values() if v), "language_days": len(lang_days & set(keys)),
                       "language_streak": streak},
            "weak_topics": weak}


def progress_text():
    p = progress(14)
    t = p["totals"]
    q = [x for x in p["quiz"] if x is not None]
    return (f"Last 14 days: {t['quizzes']} quizzes" + (f" (average {round(sum(q) / len(q))}%)" if q else "") +
            f", {t['focus_minutes']} focus minutes, {t['gym_sessions']} gym days, language practice on "
            f"{t['language_days']} days (streak {t['language_streak']}). Weak topics: "
            f"{', '.join(w['topic'] for w in p['weak_topics']) or 'none yet'}.")
