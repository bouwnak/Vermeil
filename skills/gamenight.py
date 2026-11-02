"""gamenight.py - time played and wins per game, kept for your yearly recap (skills/recap.py), and song tempos for the
music visualizer. Saves to data/gamenight.json. Every AI call takes ask= so tests can fake it."""
import datetime
import json
import os
import random
import re

from paths import data_file

FILE = data_file("gamenight.json")

GAMES = {
    "chess": ("♟️", "Chess"), "uno": ("🃏", "Color Clash (Uno-style)"), "gofish": ("🐟", "Go Fish"),
    "trivia": ("❓", "Trivia night"), "wordle": ("🟩", "Five letters (Wordle-style)"), "hangman": ("🪢", "Hangman"),
    "draw": ("🎨", "Draw & guess"), "sudoku": ("🔢", "Sudoku of the day"), "nonogram": ("🧩", "Nonogram of the day"),
    "typing": ("⌨️", "Typing race"), "rhythm": ("🥁", "Rhythm"), "escape": ("🗝️", "Escape room"),
    "adventure": ("⚔️", "Adventure"), "retro": ("🕹️", "Retro games"),
}
SEPARATE = {"adventure", "retro"}      # their own games in the Games hub: time is kept (yearly recap) but not listed here
WIN, DRAW = 3, 1                       # tournament points


def _today(today=None):
    return today or datetime.date.today()


def _load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    for k, v in (("plays", {}), ("favs", []), ("trophies", []), ("puzzles", {}), ("bpm", {}), ("words", {})):
        d.setdefault(k, v)
    d.setdefault("tournament", {})
    return d


def _save(d):
    os.makedirs(os.path.dirname(FILE), exist_ok=True)
    tmp = FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, FILE)


def _ask_llm(prompt, json_mode=True):
    import llm
    return llm.ask(prompt, model="smart", json_mode=json_mode)


# ------------------------------------------------------------------ library + tournament
def _week(day):
    y, w, _ = day.isocalendar()
    return f"{y}-W{w:02d}"


def _roll_week(d, today):
    """a new week: last week's winner gets a trophy, the scores start again"""
    t, wk = d["tournament"], _week(today)
    if t.get("week") == wk:
        return
    if t.get("week") and (t.get("you") or t.get("her")):
        won = "you" if t["you"] > t["her"] else "her" if t["her"] > t["you"] else "tie"
        d["trophies"].insert(0, {"week": t["week"], "you": t["you"], "her": t["her"], "winner": won})
        d["trophies"] = d["trophies"][:52]
    d["tournament"] = {"week": wk, "you": 0, "her": 0, "games": []}


def tournament(today=None):
    today = _today(today)
    d = _load()
    _roll_week(d, today)
    _save(d)
    return _tournament_public(d, today)


def _tournament_public(d, today):
    t = d["tournament"]
    return {**t, "days_left": 7 - today.isoweekday(), "trophies": d["trophies"][:12],
            "won": sum(1 for x in d["trophies"] if x["winner"] == "you"),
            "leader": "you" if t["you"] > t["her"] else "her" if t["her"] > t["you"] else "tie"}


def record(game, seconds=0, result=None, today=None, detail=""):
    """a game was played: time for the library; a result ("win" / "loss" / "draw", from your side) for the tournament"""
    today = _today(today)
    game = re.sub(r"[^a-z0-9_:\-]", "", str(game or "").lower())[:60] or "other"
    d = _load()
    p = d["plays"].setdefault(game, {"seconds": 0, "sessions": 0, "win": 0, "loss": 0, "draw": 0, "last": ""})
    p["seconds"] += max(0, min(int(seconds or 0), 6 * 3600))
    p["sessions"] += 1
    p["last"] = today.isoformat()
    _roll_week(d, today)
    if result in ("win", "loss", "draw"):
        p[result] += 1
        t = d["tournament"]
        t["you"] += WIN if result == "win" else DRAW if result == "draw" else 0
        t["her"] += WIN if result == "loss" else DRAW if result == "draw" else 0
        t["games"] = ([{"game": game, "result": result, "day": today.isoformat(), "detail": str(detail)[:80]}]
                      + t["games"])[:40]
    _save(d)
    return {"library": _library(d), "tournament": _tournament_public(d, today)}


def _library(d, everything=False):
    rows = []
    for gid in list(GAMES) + [g for g in d["plays"] if g not in GAMES]:
        if gid in SEPARATE and not everything:
            continue
        p = d["plays"].get(gid, {})
        icon, name = GAMES.get(gid, ("🎮", gid.split(":", 1)[-1].replace("-", " ").title()))
        rows.append({"id": gid, "icon": icon, "name": name, "hours": round(p.get("seconds", 0) / 3600, 1),
                     "minutes": round(p.get("seconds", 0) / 60), "sessions": p.get("sessions", 0),
                     "win": p.get("win", 0), "loss": p.get("loss", 0), "draw": p.get("draw", 0),
                     "last": p.get("last", ""), "fav": gid in d["favs"]})
    rows.sort(key=lambda r: (not r["fav"], -r["minutes"], r["name"]))
    return {"games": rows, "total_hours": round(sum(r["minutes"] for r in rows) / 60, 1)}


def library(everything=False):
    """Game Night's games; everything=True also lists Adventure and Retro (for the yearly recap)"""
    return _library(_load(), everything)


def toggle_fav(game):
    d = _load()
    if game in d["favs"]:
        d["favs"].remove(game)
    else:
        d["favs"].append(game)
    _save(d)
    return _library(d)


# ------------------------------------------------------------------ rhythm: song tempo
def _norm(s):
    import unicodedata
    plain = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", plain).strip()


def song_bpm(title, artist="", ask=None):
    key = _norm(f"{title} {artist}")[:120]
    d = _load()
    if key in d["bpm"]:
        return {"bpm": d["bpm"][key], "known": True}
    bpm = 0
    try:
        data = (ask or _ask_llm)(f"What is the tempo (BPM) of the song '{title}'" + (f" by {artist}" if artist else "")
                                 + "? Reply with JSON only: {\"bpm\": number}")
        bpm = int(round(float((data or {}).get("bpm") or 0)))
    except Exception:
        bpm = 0
    while bpm and bpm < 70:
        bpm *= 2
    while bpm > 190:
        bpm //= 2
    if not bpm:
        return {"bpm": 104, "known": False}
    d["bpm"][key] = bpm
    _save(d)
    return {"bpm": bpm, "known": True}
