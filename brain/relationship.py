"""
relationship.py - "our story": the history between you and your companion.

  touch(user_text, reply)   called after every chat message: counts days you talked, streaks, firsts
  milestones                first chat, 7 / 30 / 100 / 365 days talked, 100 / 1000 / 5000 messages, streaks
  moments                   memorable things you shared ("you passed your thesis defense"), picked out by the AI
                            once a day from recent chats, plus ones you add yourself
  note()                    a short line for the AI so she can mention your shared history naturally

Saved in data/relationship.json.
"""
import json
import time
from datetime import date, datetime, timedelta

from paths import data_file

FILE = data_file("relationship.json")
DAY_MARKS = (7, 30, 50, 100, 200, 365, 500, 1000)
MSG_MARKS = (100, 500, 1000, 5000, 10000)
STREAK_MARKS = (7, 14, 30, 60, 100)


def _load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, json.JSONDecodeError):
        d = {}
    d.setdefault("first_met", None)
    d.setdefault("days", [])          # dates you talked, "YYYY-MM-DD"
    d.setdefault("messages", 0)
    d.setdefault("milestones", [])    # {"date", "text", "kind"}
    d.setdefault("moments", [])       # {"date", "text", "auto"}
    d.setdefault("last_scan", None)
    return d


def _save(d):
    with open(FILE, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)


def streak(days, today=None):
    """How many days in a row (up to today or yesterday) you talked."""
    s = set(days)
    d = today or date.today()
    if d.isoformat() not in s:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in s:
        n += 1
        d -= timedelta(days=1)
    return n


def _mark(d, text, kind, today):
    if not any(m["text"] == text for m in d["milestones"]):
        d["milestones"].append({"date": today, "text": text, "kind": kind})
        return text
    return None


def touch(user_text="", reply="", name="you", today=None):
    """Record one message. Returns a new milestone sentence (or None) so she can celebrate it."""
    today = (today or date.today()).isoformat() if not isinstance(today, str) else today
    d = _load()
    new = None
    if not d["first_met"]:
        d["first_met"] = today
        new = _mark(d, "The day we first talked 💬", "first", today)
    if today not in d["days"]:
        d["days"].append(today)
        n = len(d["days"])
        if n in DAY_MARKS:
            new = _mark(d, f"{n} days of talking together", "days", today) or new
        s = streak(d["days"], date.fromisoformat(today))
        if s in STREAK_MARKS:
            new = _mark(d, f"{s}-day streak — we talked {s} days in a row", "streak", today) or new
    d["messages"] += 1
    if d["messages"] in MSG_MARKS:
        new = _mark(d, f"{d['messages']} messages exchanged", "messages", today) or new
    _save(d)
    return new


def add_moment(text, when=None, auto=False):
    d = _load()
    text = text.strip()
    if text and not any(m["text"].lower() == text.lower() for m in d["moments"]):
        d["moments"].append({"date": when or date.today().isoformat(), "text": text, "auto": auto})
        _save(d)
    return d["moments"]


def remove_moment(text):
    d = _load()
    d["moments"] = [m for m in d["moments"] if m["text"] != text]
    _save(d)
    return d["moments"]


def scan_moments(conversations, force=False):
    """Once a day: let the AI pick 0-2 memorable moments from recent chats."""
    d = _load()
    today = date.today().isoformat()
    if d["last_scan"] == today and not force:
        return []
    d["last_scan"] = today
    _save(d)
    recent = [m for m in conversations[-80:] if isinstance(m.get("content"), str)]
    if len(recent) < 6:
        return []
    import llm
    text = "\n".join(f"{'User' if m['role'] == 'user' else 'AI'}: {m['content'][:300]}" for m in recent)
    known = "; ".join(m["text"] for m in d["moments"][-30:]) or "(none)"
    try:
        data = llm.ask(f"Recent chat between a user and their AI companion:\n{text}\n\nAlready saved moments: {known}\n\n"
                       f"Pick 0-2 NEW meaningful moments worth remembering in their shared story: achievements, big "
                       f"news, important feelings, firsts, inside jokes. Not small talk or requests. Write each as one "
                       f"short warm sentence addressed to the user ('You told me you passed your thesis defense!').\n"
                       f'Reply as JSON: {{"moments": ["..."]}}', model="chat", json_mode=True)
    except Exception as e:
        print(f"[relationship] {e}")
        return []
    found = [str(x).strip() for x in (data.get("moments") or [])[:2] if str(x).strip()]
    for f in found:
        add_moment(f, auto=True)
    return found


def story(today=None):
    d = _load()
    today = today or date.today()
    known = (today - date.fromisoformat(d["first_met"])).days + 1 if d["first_met"] else 0
    timeline = sorted([{**m, "type": "milestone"} for m in d["milestones"]] + [{**m, "type": "moment"} for m in d["moments"]],
                      key=lambda x: x["date"], reverse=True)
    return {"first_met": d["first_met"], "days_known": known, "days_talked": len(d["days"]),
            "messages": d["messages"], "streak": streak(d["days"], today), "timeline": timeline}


def note():
    """One line for the AI's instructions."""
    s = story()
    if not s["first_met"]:
        return ""
    moments = [m["text"] for m in s["timeline"] if m["type"] == "moment"][:4]
    out = (f"Your shared history: you've known the user for {s['days_known']} days (talked on {s['days_talked']} of them, "
           f"current streak {s['streak']}).")
    if moments:
        out += " Memorable moments you can bring up when it fits (not every time): " + " | ".join(moments)
    return out


def text():
    s = story()
    if not s["first_met"]:
        return "We haven't started our story yet."
    lines = [f"We first talked on {datetime.fromisoformat(s['first_met']).strftime('%B %d, %Y')} — {s['days_known']} days ago. "
             f"We've talked on {s['days_talked']} days, {s['messages']} messages, streak {s['streak']}."]
    lines += [f"- {t['date']}: {t['text']}" for t in s["timeline"][:12]]
    return "\n".join(lines)
