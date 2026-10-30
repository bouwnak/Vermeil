"""
quest.py - the game layer shared by Study, Language, Gym, Habits and Focus: XP, levels, a daily streak,
3 daily quests, badges and the Battle Pass (30 tiers of room items, wallpapers and titles to unlock).

  award(kind, n=1, xp=None)    something you did (a flashcard, a perfect sentence, a focus block...) -> XP
  state()                       everything the UI shows: level, tier, XP bar, quests, badges, unlocked rewards
  week(kind=None)               counts per day for the last 7 days (weekly reports)

Saved in data/quest.json.
"""
import json
import os
import random
import threading
from datetime import date, timedelta

from paths import data_file

STATE_FILE = data_file("quest.json")
TIER_XP = 300                       # XP for each battle-pass tier
SEASON = "Season 1: Cozy Scholar"
_lock = threading.Lock()

# what each thing is worth (n = how many)
XP = {"card_right": 5, "card_wrong": 1, "review": 20, "talk_right": 10, "talk_miss": 3, "shadow": 8, "draw": 6,
      "word": 2, "focus_block": 30, "ask_library": 5, "formula_sheet": 10, "habit": 5, "meal": 5, "workout": 40,
      "roleplay": 15, "pronounce": 6}

# the Battle Pass: tier -> reward. "item" = a room item from ui/rewards.js, "wallpaper" = a room wallpaper,
# "title" = a title shown on your pass card.
PASS = [
    (1, "title", "Fresh Scholar", "🎓"), (2, "item", "rwPlushie", "🧸"), (3, "wallpaper", "sakura", "🌸"),
    (4, "item", "rwLavaLamp", "🫧"), (5, "title", "Flashcard Fiend", "🃏"), (6, "item", "rwGlobe", "🌍"),
    (7, "item", "rwTrophyBronze", "🥉"), (8, "wallpaper", "galaxy", "🌌"), (9, "item", "rwBeanPlant", "🌱"),
    (10, "title", "Word Collector", "📚"), (11, "item", "rwAquarium", "🐠"), (12, "item", "rwTelescope", "🔭"),
    (13, "wallpaper", "gold", "✨"), (14, "item", "rwTrophySilver", "🥈"), (15, "title", "Focus Ninja", "🥷"),
    (16, "item", "rwArcade", "🕹️"), (17, "item", "rwNeonHeart", "💜"), (18, "item", "rwCrystalLamp", "💎"),
    (19, "wallpaper", "circuit", "🔌"), (20, "title", "Polyglot", "🗣️"), (21, "item", "rwStarProjector", "🌠"),
    (22, "item", "rwMedalFrame", "🏅"), (23, "item", "rwBonsai", "🌳"), (24, "item", "rwTrophyGold", "🥇"),
    (25, "title", "Battle-Pass Hero", "🦸"), (26, "item", "rwPiano", "🎹"), (27, "item", "rwHammock", "🏝️"),
    (28, "wallpaper", "aurora", "🌈"), (29, "item", "rwThrone", "👑"), (30, "title", "Legend of the Room", "🏆"),
]
NAMES = {"rwPlushie": "Teddy plushie", "rwLavaLamp": "Lava lamp", "rwGlobe": "Desk globe", "rwTrophyBronze": "Bronze trophy",
         "rwBeanPlant": "Lucky bean plant", "rwAquarium": "Aquarium", "rwTelescope": "Telescope", "rwTrophySilver": "Silver trophy",
         "rwArcade": "Arcade cabinet", "rwNeonHeart": "Neon heart", "rwCrystalLamp": "Crystal lamp",
         "rwStarProjector": "Star projector", "rwMedalFrame": "Medal frame", "rwBonsai": "Bonsai tree",
         "rwTrophyGold": "Gold trophy", "rwPiano": "Piano", "rwHammock": "Hammock", "rwThrone": "Golden throne",
         "sakura": "Sakura wallpaper", "galaxy": "Galaxy wallpaper", "gold": "Gold wallpaper", "circuit": "Circuit wallpaper",
         "aurora": "Aurora wallpaper"}

QUEST_POOL = [
    ("card", "Answer 20 flashcards", 20, 60), ("card", "Answer 40 flashcards", 40, 100),
    ("talk_right", "Say 5 sentences perfectly in Talk live", 5, 80), ("shadow", "Shadow 5 lines", 5, 60),
    ("draw", "Draw 5 characters", 5, 50), ("focus_block", "Finish a study timer block", 1, 60),
    ("ask_library", "Ask your library 2 questions", 2, 40), ("habit", "Tick 3 habits", 3, 50),
    ("word", "Learn 5 new words", 5, 50), ("review", "Finish a review", 1, 60), ("meal", "Log 2 meals", 2, 40),
]
QUEST_GROUP = {"card_right": "card", "card_wrong": "card", "talk_miss": None}   # several kinds count for one quest

BADGES = [
    ("streak3", "🔥 3-day streak", lambda s: s["best_streak"] >= 3), ("streak7", "🔥 7-day streak", lambda s: s["best_streak"] >= 7),
    ("streak10", "🔥 10-day streak", lambda s: s["best_streak"] >= 10), ("streak30", "☄️ 30-day streak", lambda s: s["best_streak"] >= 30),
    ("cards100", "🃏 100 flashcards", lambda s: _tot(s, "card_right") + _tot(s, "card_wrong") >= 100),
    ("cards1000", "🃏 1000 flashcards", lambda s: _tot(s, "card_right") + _tot(s, "card_wrong") >= 1000),
    ("perfect50", "🎯 50 perfect sentences", lambda s: _tot(s, "talk_right") >= 50),
    ("words100", "📚 100 words learned", lambda s: _tot(s, "word") >= 100),
    ("focus10", "🥷 10 focus blocks", lambda s: _tot(s, "focus_block") >= 10),
    ("artist50", "✍️ 50 characters drawn", lambda s: _tot(s, "draw") >= 50),
    ("gym20", "💪 20 workouts", lambda s: _tot(s, "workout") >= 20),
    ("level10", "⭐ Level 10", lambda s: level_of(s["xp"])[0] >= 10),
]


def _tot(s, kind):
    return s.get("totals", {}).get(kind, 0)


def level_of(xp):
    """level grows a bit slower each time: level n needs 100*n XP more than the last"""
    lvl, need = 1, 100
    while xp >= need:
        xp -= need
        lvl += 1
        need = 100 * lvl
    return lvl, xp, need


def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            s = json.load(f)
        if isinstance(s, dict):
            return s
    except (OSError, ValueError):
        pass
    return {}


def _save(s):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=1, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)


def _fill(s):
    s.setdefault("xp", 0)
    s.setdefault("totals", {})
    s.setdefault("days", {})
    s.setdefault("streak", 0)
    s.setdefault("best_streak", 0)
    s.setdefault("last_day", "")
    s.setdefault("quests", {})
    return s


def daily_quests(day=None, s=None):
    day = day or date.today()
    key = day.isoformat()
    s = s if s is not None else _fill(_load())
    if s["quests"].get("day") != key:
        pick = random.Random(key).sample(QUEST_POOL, 3)
        s["quests"] = {"day": key, "list": [{"kind": k, "text": t, "goal": g, "xp": x, "have": 0, "done": False}
                                            for k, t, g, x in pick]}
    return s["quests"]["list"]


def tier_of(xp):
    return min(len(PASS), xp // TIER_XP)


def unlocked(xp=None):
    xp = _fill(_load())["xp"] if xp is None else xp
    t = tier_of(xp)
    return [r for r in PASS if r[0] <= t]


def award(kind, n=1, xp=None, today=None):
    """count something you did; returns what changed (XP gained, level up, new rewards, quests done)"""
    n = max(0, int(n))
    if not n and not xp:
        return {"xp": 0}
    today = today or date.today()
    with _lock:
        s = _fill(_load())
        gained = int(xp if xp is not None else XP.get(kind, 2) * n)
        before_lvl, before_tier = level_of(s["xp"])[0], tier_of(s["xp"])
        s["totals"][kind] = s["totals"].get(kind, 0) + n
        d = s["days"].setdefault(today.isoformat(), {})
        d[kind] = d.get(kind, 0) + n
        d["xp"] = d.get("xp", 0) + gained
        for old in sorted(s["days"])[:-60]:
            s["days"].pop(old)
        t = today.isoformat()
        if s["last_day"] != t:
            s["streak"] = s["streak"] + 1 if s["last_day"] == (today - timedelta(days=1)).isoformat() else 1
            s["last_day"] = t
            s["best_streak"] = max(s["best_streak"], s["streak"])
        done = []
        group = QUEST_GROUP.get(kind, kind)
        for q in daily_quests(today, s):
            if group and q["kind"] == group and not q["done"]:
                q["have"] = min(q["goal"], q["have"] + n)
                if q["have"] >= q["goal"]:
                    q["done"] = True
                    gained += q["xp"]
                    d["xp"] += q["xp"]
                    done.append(q["text"])
        s["xp"] += gained
        lvl, tier = level_of(s["xp"])[0], tier_of(s["xp"])
        _save(s)
    new = [_reward(r) for r in PASS if before_tier < r[0] <= tier]
    return {"xp": gained, "total": s["xp"], "level": lvl, "level_up": lvl > before_lvl, "tier": tier,
            "rewards": new, "quests_done": done, "streak": s["streak"]}


def _reward(r):
    tier, kind, key, icon = r
    return {"tier": tier, "kind": kind, "key": key, "icon": icon, "name": NAMES.get(key, key)}


def current_streak(s, today=None):
    today = today or date.today()
    return s["streak"] if s["last_day"] in (today.isoformat(), (today - timedelta(days=1)).isoformat()) else 0


def state(today=None):
    s = _fill(_load())
    quests = daily_quests(today, s)
    _save(s)
    lvl, into, need = level_of(s["xp"])
    tier = tier_of(s["xp"])
    got = [r for r in PASS if r[0] <= tier]
    titles = [r[2] for r in got if r[1] == "title"]
    return {"xp": s["xp"], "level": lvl, "level_xp": into, "level_need": need, "season": SEASON,
            "tier": tier, "tiers": len(PASS), "tier_xp": s["xp"] - tier * TIER_XP if tier < len(PASS) else TIER_XP,
            "tier_need": TIER_XP, "streak": current_streak(s, today), "best_streak": s["best_streak"],
            "title": titles[-1] if titles else "", "quests": quests,
            "pass": [{**_reward(r), "got": r[0] <= tier} for r in PASS],
            "items": [r[2] for r in got if r[1] == "item"], "wallpapers": [r[2] for r in got if r[1] == "wallpaper"],
            "badges": [{"id": b, "name": name, "got": bool(test(s))} for b, name, test in BADGES],
            "today_xp": s["days"].get((today or date.today()).isoformat(), {}).get("xp", 0)}


def week(kind=None, today=None):
    """[{day, count or {kind: count}}] for the last 7 days, oldest first"""
    s = _fill(_load())
    today = today or date.today()
    out = []
    for i in range(6, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        day = s["days"].get(d, {})
        out.append({"day": d, "count": day.get(kind, 0) if kind else dict(day)})
    return out
