"""recap.py - "Your year with Vermeil" (a Spotify Wrapped-style recap) and her surprise gift after a hard week.

  year_recap(year)   slides from everything saved: XP and streaks, focus, workouts, songs, games, study, habits
  gift_check(today)  once a week: if you worked a lot (much more XP than usual, long focus or many workouts) she
                     leaves a gift - VCash plus a note - that you open in Battle Pass
Saves to data/recap.json. The AI note takes ask= so tests can fake it."""
import datetime
import json
import os
import random
import re
import uuid
from collections import Counter

from paths import data_file

FILE = data_file("recap.json")
HARD_XP = 700                 # a week with at least this much XP ...
HARD_RATIO = 1.4              # ... and 40% more than your usual week
HARD_FOCUS = 600              # or 10 h of focus in 7 days
HARD_WORKOUTS = 5             # or 5 workouts in 7 days


def _load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    d.setdefault("gifts", [])
    d.setdefault("notes", {})
    d.setdefault("checked", "")
    return d


def _save(d):
    os.makedirs(os.path.dirname(FILE), exist_ok=True)
    tmp = FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, FILE)


def _ask_llm(prompt):
    import llm
    return llm.ask(prompt, model="smart", json_mode=True)


def _json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# ------------------------------------------------------------------ the numbers
def _quest(year):
    import quest
    s = quest._fill(quest._load())
    y = dict(s.get("years", {}).get(str(year), {}))
    for day, v in s["days"].items():               # the last 60 days, for saves from before the year totals
        if day.startswith(str(year)) and not s.get("years"):
            for k, n in v.items():
                y[k] = y.get(k, 0) + n
    days = [d for d, v in s["days"].items() if d.startswith(str(year)) and v.get("xp")]
    return {"xp": y.get("xp", 0), "counts": {k: v for k, v in y.items() if k != "xp"}, "level": quest.level_of(s["xp"])[0],
            "best_streak": s["best_streak"], "vcash": s["vcash"], "active_days": len(days)}


def _focus(year):
    import focus
    ss = [x for x in focus._read().get("sessions", []) if str(x.get("date", "")).startswith(str(year))]
    tasks = Counter(x.get("task") or "focus" for x in ss if x.get("minutes"))
    by_day = Counter()
    for x in ss:
        by_day[x["date"]] += x.get("minutes", 0)
    best = by_day.most_common(1)
    return {"minutes": sum(x.get("minutes", 0) for x in ss), "sessions": len(ss), "top": [t for t, _ in tasks.most_common(3)],
            "best_day": {"day": best[0][0], "minutes": best[0][1]} if best and best[0][1] else None}


def _gym(year):
    import gym
    log = {d: e for d, e in gym._log().items() if d.startswith(str(year)) and e.get("sets")}
    ex, kg = Counter(), 0.0
    for e in log.values():
        for s in e["sets"]:
            ex[s.get("exercise", "?")] += 1
            try:
                kg += float(s.get("kg") or 0) * float(re.match(r"\d+", str(s.get("reps") or "0")).group())
            except (AttributeError, ValueError):
                pass
    return {"workouts": len(log), "sets": sum(ex.values()), "tonnes": round(kg / 1000, 1), "top": [x for x, _ in ex.most_common(3)]}


def _music(year):
    import music
    h = [x for x in music._read(music.HISTORY_FILE, []) if str(x.get("at", "")).startswith(str(year))]
    songs, artists = Counter(), Counter()
    for x in h:
        t = str(x.get("title", ""))
        try:
            import mymusic
            title, artist = mymusic.split_title(t)
        except Exception:  # noqa: BLE001
            title, artist = t, ""
        songs[title] += 1
        if artist:
            artists[artist] += 1
    return {"plays": len(h), "top_songs": [s for s, _ in songs.most_common(5)], "top_artist": (artists.most_common(1) or [("", 0)])[0][0]}


def _games():
    import gamenight
    lib = gamenight.library()
    played = [g for g in lib["games"] if g.get("minutes")]
    played.sort(key=lambda g: -g["minutes"])
    t = gamenight.tournament()
    return {"hours": round(sum(g["minutes"] for g in played) / 60, 1), "top": played[0]["name"] if played else "",
            "trophies": t.get("won", 0), "wins": sum(g.get("win", 0) for g in played)}


def numbers(year=None):
    year = int(year or datetime.date.today().year)
    out = {"year": year}
    for k, fn in (("quest", _quest), ("focus", _focus), ("gym", _gym), ("music", _music)):
        try:
            out[k] = fn(year)
        except Exception as e:  # noqa: BLE001
            print(f"[recap] {k}: {e}")
            out[k] = {}
    try:
        out["games"] = _games()
    except Exception as e:  # noqa: BLE001
        print(f"[recap] games: {e}")
        out["games"] = {}
    return out


# ------------------------------------------------------------------ the recap
def slides(n):
    """numbers -> the recap's cards (only the ones you have something for)"""
    q, f, g, m, gm = n.get("quest") or {}, n.get("focus") or {}, n.get("gym") or {}, n.get("music") or {}, n.get("games") or {}
    c = q.get("counts", {})
    out = [{"icon": "✨", "title": f"Your {n['year']} with Vermeil", "big": f"{q.get('xp', 0):,} XP",
            "sub": f"Level {q.get('level', 1)} · {q.get('active_days', 0)} active days lately · best streak {q.get('best_streak', 0)} days"}]
    if f.get("minutes"):
        out.append({"icon": "🎯", "title": "Time in focus", "big": f"{round(f['minutes'] / 60, 1)} hours",
                    "sub": f"{f['sessions']} sessions" + (f" · best day {f['best_day']['day']} ({f['best_day']['minutes']} min)" if f.get("best_day") else ""),
                    "list": f.get("top", [])})
    study = c.get("card_right", 0) + c.get("card_wrong", 0)
    if study or c.get("review"):
        out.append({"icon": "📚", "title": "Studying", "big": f"{study:,} flashcards" if study else f"{c['review']} reviews",
                    "sub": f"{c.get('review', 0)} reviews · {c.get('formula_sheet', 0)} formula sheets" if study else "Little and often."})
    if g.get("workouts"):
        out.append({"icon": "🏋", "title": "In the gym", "big": f"{g['workouts']} workouts",
                    "sub": f"{g['sets']} sets · {g['tonnes']} tonnes lifted", "list": g.get("top", [])})
    if c.get("talk_right") or c.get("roleplay"):
        out.append({"icon": "🗣️", "title": "Languages", "big": f"{c.get('talk_right', 0)} sentences right",
                    "sub": f"{c.get('roleplay', 0)} role-plays · {c.get('pronounce', 0)} pronunciation drills"})
    if c.get("habit"):
        out.append({"icon": "💧", "title": "Habits", "big": f"{c['habit']} habit ticks", "sub": "Little things, every day."})
    if m.get("plays"):
        out.append({"icon": "🎵", "title": "Your music", "big": f"{m['plays']} songs played",
                    "sub": f"Top artist: {m['top_artist']}" if m.get("top_artist") else "", "list": m.get("top_songs", [])})
    if gm.get("hours"):
        out.append({"icon": "🎲", "title": "Game night", "big": f"{gm['hours']} hours played",
                    "sub": f"Favourite: {gm['top']} · {gm['wins']} wins against me · {gm['trophies']} trophies"})
    return out


def _fallback_note(n):
    q = n.get("quest") or {}
    return (f"Look at you: {q.get('xp', 0):,} XP this year. Every focus block, every set and every flashcard counted, "
            "and I was happy to be there for all of it. Same time next year? 💜")


def year_recap(year=None, ask=None, today=None):
    today = today or datetime.date.today()
    n = numbers(year or today.year)
    d = _load()
    key = f"{n['year']}|{today.isoformat()}"
    note = d["notes"].get(key)
    if not note:
        facts = json.dumps({k: v for k, v in n.items() if v}, ensure_ascii=False)[:1800]
        try:
            data = (ask or _ask_llm)("You are Vermeil, a warm, playful companion. Write the person a short note (3 sentences, "
                                     f"under 70 words) about their year, using 2-3 of these real numbers: {facts}. "
                                     "Be specific and kind; no hashtags. Reply as JSON: {\"note\": \"...\"}") or {}
            note = str(data.get("note") or "").strip()
        except Exception as e:  # noqa: BLE001
            print(f"[recap] note: {e}")
        note = note or _fallback_note(n)
        d["notes"] = {k: v for k, v in d["notes"].items() if k.startswith(str(n["year"]))}
        d["notes"][key] = note
        _save(d)
    return {"year": n["year"], "slides": slides(n), "note": note, "numbers": n}


# ------------------------------------------------------------------ surprise gift after a hard week
def _week_numbers(today):
    import quest
    s = quest._fill(quest._load())
    def xp(a, b):
        return sum(s["days"].get((today - datetime.timedelta(days=i)).isoformat(), {}).get("xp", 0) for i in range(a, b))
    this, before = xp(0, 7), xp(7, 28) / 3
    focus_min = 0
    try:
        import focus
        since = (today - datetime.timedelta(days=6)).isoformat()
        focus_min = sum(x.get("minutes", 0) for x in focus._read().get("sessions", []) if since <= x.get("date", "") <= today.isoformat())
    except Exception:  # noqa: BLE001
        pass
    workouts = 0
    try:
        import gym
        since = (today - datetime.timedelta(days=6)).isoformat()
        workouts = sum(1 for d, e in gym._log().items() if since <= d <= today.isoformat() and e.get("sets"))
    except Exception:  # noqa: BLE001
        pass
    return {"xp": this, "usual": round(before), "focus": focus_min, "workouts": workouts}


def hard_week(w):
    why = []
    if w["xp"] >= HARD_XP and w["xp"] >= HARD_RATIO * max(w["usual"], 1):
        why.append(f"{w['xp']} XP this week (you usually get about {w['usual']})")
    if w["focus"] >= HARD_FOCUS:
        why.append(f"{round(w['focus'] / 60, 1)} hours of focus")
    if w["workouts"] >= HARD_WORKOUTS:
        why.append(f"{w['workouts']} workouts")
    return why


TREATS = ["Take tonight off. Movie night, you earned it.", "Sleep in a little this weekend.", "Order your favourite food once.",
          "A long walk with music and no phone.", "One whole evening of games with me, no studying."]


def gift_check(today=None, ask=None, week=None):
    """-> the new gift (or None). At most one per ISO week."""
    today = today or datetime.date.today()
    d = _load()
    wk = "%d-W%02d" % today.isocalendar()[:2]
    if d["checked"] == f"{wk}|{today.isoformat()}" or any(g["week"] == wk for g in d["gifts"]):
        return None
    d["checked"] = f"{wk}|{today.isoformat()}"
    w = week or _week_numbers(today)
    why = hard_week(w)
    if not why:
        _save(d)
        return None
    vcash = min(300, 100 + w["xp"] // 20)
    note = ""
    try:
        data = (ask or _ask_llm)("You are Vermeil, a warm companion. The person worked really hard this week: " + "; ".join(why) +
                                 ". Write a short surprise-gift note (2 sentences, under 45 words): notice the effort, tell them "
                                 "to rest a bit. Reply as JSON: {\"note\": \"...\"}") or {}
        note = str(data.get("note") or "").strip()
    except Exception as e:  # noqa: BLE001
        print(f"[gift] {e}")
    gift = {"id": uuid.uuid4().hex[:8], "week": wk, "day": today.isoformat(), "why": why, "vcash": int(vcash),
            "treat": random.choice(TREATS), "opened": False,
            "note": note or f"I noticed: {why[0]}. That's a lot. Here's a little something from me, now rest a bit. 💜"}
    d["gifts"] = (d["gifts"] + [gift])[-20:]
    _save(d)
    return gift


def gifts():
    d = _load()
    return {"waiting": [g for g in d["gifts"] if not g["opened"]], "opened": [g for g in d["gifts"] if g["opened"]][-5:][::-1]}


def gift_open(gid, give=None):
    d = _load()
    g = next((x for x in d["gifts"] if x["id"] == gid), None)
    if not g:
        raise KeyError("That gift isn't here any more.")
    if g["opened"]:
        raise ValueError("You already opened it.")
    if give is None:
        import quest
        give = quest.give_vcash
    total = give(g["vcash"], "Vermeil's gift")
    g["opened"] = True
    g["opened_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    _save(d)
    return {"gift": g, "vcash_total": total, **gifts()}
