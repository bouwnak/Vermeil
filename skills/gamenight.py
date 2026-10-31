"""gamenight.py - Game Night with Vermeil (the Games hub): the game library (hours played, favourites), the weekly
tournament with a trophy, puzzle of the day (sudoku, nonogram) with a streak, trivia night, word games (Wordle-style
and hangman, in English and other languages), typing words from your study cards, escape rooms from study topics,
the drawing game (she guesses your drawing / you guess her doodle) and song tempos for the rhythm game.
Chess and the card games run in the page (ui/games/night.js); this file keeps the scores.
Saves to data/gamenight.json. Every AI call takes ask= so tests can fake it."""
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


def _library(d):
    rows = []
    for gid in list(GAMES) + [g for g in d["plays"] if g not in GAMES]:
        p = d["plays"].get(gid, {})
        icon, name = GAMES.get(gid, ("🎮", gid.split(":", 1)[-1].replace("-", " ").title()))
        rows.append({"id": gid, "icon": icon, "name": name, "hours": round(p.get("seconds", 0) / 3600, 1),
                     "minutes": round(p.get("seconds", 0) / 60), "sessions": p.get("sessions", 0),
                     "win": p.get("win", 0), "loss": p.get("loss", 0), "draw": p.get("draw", 0),
                     "last": p.get("last", ""), "fav": gid in d["favs"]})
    rows.sort(key=lambda r: (not r["fav"], -r["minutes"], r["name"]))
    return {"games": rows, "total_hours": round(sum(p.get("seconds", 0) for p in d["plays"].values()) / 3600, 1)}


def library():
    return _library(_load())


def toggle_fav(game):
    d = _load()
    if game in d["favs"]:
        d["favs"].remove(game)
    else:
        d["favs"].append(game)
    _save(d)
    return _library(d)


# ------------------------------------------------------------------ puzzle of the day
def _sudoku_solve(g, limit=2):
    """how many solutions (stops at limit); g is a list of 81 ints, 0 = empty"""
    count = 0

    def ok(i, v):
        r, c = divmod(i, 9)
        if any(g[r * 9 + k] == v for k in range(9)) or any(g[k * 9 + c] == v for k in range(9)):
            return False
        br, bc = r // 3 * 3, c // 3 * 3
        return not any(g[(br + a) * 9 + bc + b] == v for a in range(3) for b in range(3))

    def go():
        nonlocal count
        try:
            i = g.index(0)
        except ValueError:
            count += 1
            return count >= limit
        for v in range(1, 10):
            if ok(i, v):
                g[i] = v
                if go():
                    g[i] = 0
                    return True
                g[i] = 0
        return False
    go()
    return count


def make_sudoku(seed, clues=30):
    rnd = random.Random(seed)
    # a full grid from the pattern, shuffled (rows inside bands, bands, columns, stacks, digits)
    base = lambda r, c: (r % 3 * 3 + r // 3 + c) % 9
    bands = rnd.sample(range(3), 3)
    rows = [b * 3 + r for b in bands for r in rnd.sample(range(3), 3)]
    stacks = rnd.sample(range(3), 3)
    cols = [s * 3 + c for s in stacks for c in rnd.sample(range(3), 3)]
    digits = rnd.sample(range(1, 10), 9)
    sol = [digits[base(r, c)] for r in rows for c in cols]
    grid = sol[:]
    for i in rnd.sample(range(81), 81):            # take numbers away while there is still only one answer
        if sum(1 for v in grid if v) <= clues:
            break
        keep, grid[i] = grid[i], 0
        if _sudoku_solve(grid[:]) != 1:
            grid[i] = keep
    return {"grid": grid, "solution": sol}


def nono_clues(lines):
    return [[len(run) for run in "".join("1" if v else "0" for v in line).split("0") if run] or [0] for line in lines]


def make_nonogram(seed, size=10):
    rnd = random.Random(seed)
    cells = [[1 if rnd.random() < 0.58 else 0 for _ in range(size)] for _ in range(size)]
    return {"size": size, "rows": nono_clues(cells), "cols": nono_clues(list(zip(*cells))), "solution": cells}


def daily_puzzle(kind, today=None):
    today = _today(today)
    seed = f"{kind}:{today.isoformat()}"
    d = _load()
    st = d["puzzles"].get(kind, {})
    streak = st.get("streak", 0) if st.get("last") in (today.isoformat(), (today - datetime.timedelta(days=1)).isoformat()) else 0
    info = {"kind": kind, "day": today.isoformat(), "streak": streak, "best": st.get("best", 0),
            "done_today": st.get("last") == today.isoformat()}
    if kind == "sudoku":
        p = make_sudoku(seed)
        return {**info, "grid": p["grid"]}
    if kind == "nonogram":
        p = make_nonogram(seed)
        return {**info, "size": p["size"], "rows": p["rows"], "cols": p["cols"]}
    raise ValueError("Unknown puzzle.")


def puzzle_check(kind, grid, today=None, seconds=0):
    """grid: sudoku = 81 numbers; nonogram = rows of 0/1. Nonograms are checked against the clues, so any picture
    that fits them counts."""
    today = _today(today)
    seed = f"{kind}:{today.isoformat()}"
    if kind == "sudoku":
        p = make_sudoku(seed)
        g = [int(v or 0) for v in (grid or [])][:81]
        wrong = [i for i, v in enumerate(g) if v and v != p["solution"][i]]
        solved = len(g) == 81 and not wrong and all(g)
        res = {"solved": solved, "wrong": wrong}
    elif kind == "nonogram":
        p = make_nonogram(seed)
        g = [[1 if v else 0 for v in row] for row in (grid or [])]
        solved = len(g) == p["size"] and nono_clues(g) == p["rows"] and nono_clues(list(zip(*g))) == p["cols"]
        res = {"solved": solved, "wrong": []}
    else:
        raise ValueError("Unknown puzzle.")
    if solved:
        d = _load()
        st = d["puzzles"].setdefault(kind, {"streak": 0, "best": 0, "last": ""})
        if st["last"] != today.isoformat():
            st["streak"] = st["streak"] + 1 if st["last"] == (today - datetime.timedelta(days=1)).isoformat() else 1
            st["best"] = max(st["best"], st["streak"])
            st["last"] = today.isoformat()
            _save(d)
            record(kind, seconds, None, today)
        res.update(streak=st["streak"], best=st["best"])
    return res


# ------------------------------------------------------------------ trivia
TRIVIA_CATEGORIES = ["General", "Science", "History", "Geography", "Movies & TV", "Music", "Games", "Anime",
                     "Sports", "Food", "Animals", "Language"]
TRIVIA_BANK = [
    ("Science", "What gas do plants take in from the air?", ["Oxygen", "Carbon dioxide", "Nitrogen", "Helium"], 1),
    ("Science", "How many bones does an adult human have?", ["186", "206", "226", "246"], 1),
    ("Science", "What is H2O?", ["Salt", "Water", "Hydrogen", "Ozone"], 1),
    ("Science", "Which planet is called the Red Planet?", ["Venus", "Jupiter", "Mars", "Mercury"], 2),
    ("History", "In which year did World War II end?", ["1939", "1945", "1950", "1918"], 1),
    ("History", "Who was the first person to walk on the Moon?", ["Yuri Gagarin", "Buzz Aldrin", "Neil Armstrong", "John Glenn"], 2),
    ("History", "Which ancient wonder stood in Egypt and still exists?", ["Colossus", "Great Pyramid of Giza", "Hanging Gardens", "Lighthouse of Alexandria"], 1),
    ("Geography", "What is the capital of Japan?", ["Osaka", "Kyoto", "Tokyo", "Nagoya"], 2),
    ("Geography", "Which is the largest ocean?", ["Atlantic", "Indian", "Arctic", "Pacific"], 3),
    ("Geography", "How many islands does the Philippines have (about)?", ["700", "7,600", "17,000", "1,200"], 1),
    ("Geography", "Which river is the longest in the world (most lists)?", ["Amazon", "Nile", "Yangtze", "Mississippi"], 1),
    ("Movies & TV", "Which movie has the song 'Let It Go'?", ["Moana", "Frozen", "Tangled", "Encanto"], 1),
    ("Movies & TV", "In which city does Batman live?", ["Metropolis", "Star City", "Gotham", "Central City"], 2),
    ("Music", "How many strings does a normal guitar have?", ["4", "5", "6", "8"], 2),
    ("Music", "Who is called the King of Pop?", ["Elvis Presley", "Michael Jackson", "Prince", "Freddie Mercury"], 1),
    ("Games", "What is the name of Mario's brother?", ["Wario", "Luigi", "Toad", "Yoshi"], 1),
    ("Games", "In chess, which piece can only move diagonally?", ["Rook", "Knight", "Bishop", "King"], 2),
    ("Games", "Which company makes the PlayStation?", ["Nintendo", "Microsoft", "Sega", "Sony"], 3),
    ("Anime", "What is Naruto's favourite food?", ["Sushi", "Ramen", "Onigiri", "Takoyaki"], 1),
    ("Anime", "Which Pokémon is Ash's first partner?", ["Bulbasaur", "Charmander", "Pikachu", "Squirtle"], 2),
    ("Sports", "How many players does a soccer team have on the field?", ["9", "10", "11", "12"], 2),
    ("Sports", "In basketball, how many points is a shot from behind the arc?", ["1", "2", "3", "4"], 2),
    ("Food", "Which country is sushi from?", ["China", "Korea", "Japan", "Thailand"], 2),
    ("Food", "What is the main ingredient of guacamole?", ["Tomato", "Avocado", "Pea", "Lime"], 1),
    ("Animals", "What is the fastest land animal?", ["Lion", "Cheetah", "Horse", "Gazelle"], 1),
    ("Animals", "How many legs does a spider have?", ["6", "8", "10", "12"], 1),
    ("Animals", "Which animal is the largest on Earth?", ["Elephant", "Blue whale", "Giraffe", "Shark"], 1),
    ("Language", "How do you say 'thank you' in Japanese?", ["Konnichiwa", "Arigatou", "Sayonara", "Sumimasen"], 1),
    ("Language", "Which language has the most native speakers?", ["English", "Spanish", "Mandarin Chinese", "Hindi"], 2),
    ("General", "How many minutes are in a day?", ["1,240", "1,440", "1,640", "1,040"], 1),
    ("General", "What colour do you get by mixing blue and yellow?", ["Purple", "Orange", "Green", "Brown"], 2),
    ("General", "How many continents are there?", ["5", "6", "7", "8"], 2),
]


def _clean_q(q):
    if not isinstance(q, dict):
        return None
    choices = [str(c)[:120] for c in (q.get("choices") or []) if str(c).strip()][:4]
    try:
        ans = int(q.get("answer"))
    except (TypeError, ValueError):
        ans = choices.index(str(q.get("answer"))) if str(q.get("answer")) in choices else -1
    if len(choices) != 4 or not 0 <= ans < 4 or not str(q.get("question") or "").strip():
        return None
    return {"category": str(q.get("category") or "")[:40], "question": str(q["question"])[:300], "choices": choices,
            "answer": ans, "fact": str(q.get("fact") or "")[:240]}


def trivia(categories=None, n=10, ask=None):
    cats = [c for c in (categories or []) if c] or ["General"]
    n = max(3, min(int(n or 10), 20))
    out = []
    try:
        data = (ask or _ask_llm)(
            f"Make {n} fun multiple-choice trivia questions for a trivia night. Categories (mix them): {', '.join(cats)}. "
            "Easy to medium, facts that are true and not changing. Reply with JSON only: {\"questions\": [{\"category\": "
            "\"...\", \"question\": \"...\", \"choices\": [4 short answers], \"answer\": index 0-3 of the right one, "
            "\"fact\": \"one short fun fact\"}]}")
        out = [q for q in map(_clean_q, (data or {}).get("questions") or []) if q]
    except Exception:
        out = []
    if len(out) < n:                           # no AI (or too few): the built-in questions
        pool = [b for b in TRIVIA_BANK if b[0] in cats] or TRIVIA_BANK
        random.shuffle(pool)
        for cat, q, ch, a in pool[: n - len(out)]:
            out.append({"category": cat, "question": q, "choices": ch, "answer": a, "fact": ""})
    random.shuffle(out)
    return {"questions": out[:n], "categories": TRIVIA_CATEGORIES}


# ------------------------------------------------------------------ word games
WORDS5 = """apple beach brain bread chair charm cloud crane dance dream eagle earth flame fruit ghost giant glass grape
green heart honey house juice knife laugh lemon light magic mango money month mouse music night ocean paint panda
party peach piano pilot plant power queen quiet radio river robot salad sheep shine skate sleep smile snake space
spoon sport star storm sugar sweet table tiger toast tower train truck video voice water whale world write young
zebra crown sword stone metal brave grace chess cards story frost blaze candy pearl berry lucky noble tempo""".split()
WORDS5 = [w for w in WORDS5 if len(w) == 5]
HANGMAN = [("elephant", "a big grey animal with a trunk"), ("umbrella", "you open it when it rains"),
           ("keyboard", "you type on it"), ("volcano", "a mountain that can erupt"), ("library", "a place full of books"),
           ("pineapple", "a spiky tropical fruit"), ("astronaut", "a person who travels to space"),
           ("rainbow", "colours in the sky after rain"), ("dinosaur", "a giant reptile from long ago"),
           ("guitar", "a music instrument with six strings"), ("penguin", "a bird that can't fly but swims"),
           ("sandwich", "food between two slices of bread"), ("calendar", "it shows the days and months"),
           ("treasure", "pirates look for it"), ("mountain", "very tall land"), ("blanket", "it keeps you warm in bed"),
           ("butterfly", "an insect with colourful wings"), ("homework", "school work you do at home"),
           ("vacation", "time off to travel or rest"), ("chocolate", "a sweet brown treat")]
LANGS = {"en": "English", "ja": "Japanese (romaji)", "es": "Spanish", "fr": "French", "de": "German", "it": "Italian",
         "pt": "Portuguese", "tl": "Filipino (Tagalog)", "ko": "Korean (romanized)", "id": "Indonesian"}


def _strip(w):
    import unicodedata
    w = unicodedata.normalize("NFKD", str(w)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", w)


def words(lang="en", ask=None):
    """{"five": [5-letter words], "hangman": [{word, hint}]} for a language (other languages come from the AI once,
    then are kept)"""
    lang = lang if lang in LANGS else "en"
    if lang == "en":
        return {"lang": lang, "langs": LANGS, "five": WORDS5, "hangman": [{"word": w, "hint": h} for w, h in HANGMAN]}
    d = _load()
    got = d["words"].get(lang)
    if not got:
        try:
            data = (ask or _ask_llm)(
                f"Give everyday {LANGS[lang]} words for word games, written in plain Latin letters with no accents. "
                "Reply with JSON only: {\"five\": [40 common words of exactly 5 letters], \"hangman\": [{\"word\": "
                "\"a 6-10 letter word\", \"hint\": \"the English meaning\"} x 20]}")
            five = sorted({_strip(w) for w in (data or {}).get("five") or [] if len(_strip(w)) == 5})
            hang = [{"word": _strip(x.get("word")), "hint": str(x.get("hint") or "")[:80]}
                    for x in (data or {}).get("hangman") or [] if isinstance(x, dict) and 4 <= len(_strip(x.get("word"))) <= 12]
        except Exception:
            five, hang = [], []
        if len(five) < 8 or len(hang) < 5:
            return {"lang": lang, "langs": LANGS, "five": WORDS5, "hangman": [{"word": w, "hint": h} for w, h in HANGMAN],
                    "note": f"Couldn't get {LANGS[lang]} words right now, so these are English."}
        got = d["words"][lang] = {"five": five, "hangman": hang}
        _save(d)
    return {"lang": lang, "langs": LANGS, **got}


# ------------------------------------------------------------------ typing + escape rooms (from your study cards)
COMMON = ("the quick brown fox jumps over lazy dog study focus practice memory review answer question science "
          "history language music planet energy water garden window morning evening friend family school").split()


def _cards():
    try:
        import studygame
        return studygame.all_cards()
    except Exception:
        return []


def typing_words(n=40, deck=""):
    cards = [c for c in _cards() if not deck or c.get("deck") == deck]
    pool = []
    for c in cards:
        for side in (c.get("front"), c.get("back")):
            s = re.sub(r"\s+", " ", str(side or "")).strip()
            if 2 <= len(s) <= 30 and s.isascii():
                pool.extend(s.split() if len(s.split()) > 3 else [s])
    source = "your study cards" if len(pool) >= 10 else "everyday words"
    pool = pool if len(pool) >= 10 else COMMON
    rnd = random.Random()
    return {"words": [rnd.choice(pool) for _ in range(max(10, min(int(n or 40), 200)))], "source": source,
            "decks": sorted({c.get("deck") for c in cards if c.get("deck")})}


def escape_topics():
    return sorted({c.get("deck") for c in _cards() if c.get("deck")})[:40]


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", _strip_keep_digits(s)).strip()


def _strip_keep_digits(s):
    import unicodedata
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()


def escape_room(topic="", ask=None):
    """three locked rooms; each lock opens with an answer about the topic"""
    topic = str(topic or "").strip()[:80] or "General knowledge"
    cards = [c for c in _cards() if c.get("deck") == topic]
    facts = "; ".join(f"{c['front']} = {c['back']}" for c in random.sample(cards, min(len(cards), 12)))
    try:
        data = (ask or _ask_llm)(
            f"Make a short escape-room game to study '{topic}'." + (f" Use these study facts: {facts}." if facts else "")
            + " Three rooms. Each room has a spooky-fun scene and a lock that opens with a short answer (1-3 words or a "
            "number). Reply with JSON only: {\"title\": \"...\", \"story\": \"one sentence\", \"rooms\": [{\"name\": "
            "\"...\", \"scene\": \"2 sentences\", \"question\": \"...\", \"answer\": \"...\", \"also\": [other accepted "
            "answers], \"hint\": \"...\"}]}")
        rooms = [{"name": str(r.get("name") or f"Room {i + 1}")[:60], "scene": str(r.get("scene") or "")[:300],
                  "question": str(r["question"])[:300], "answer": str(r["answer"])[:60],
                  "also": [str(a)[:60] for a in (r.get("also") or [])][:5], "hint": str(r.get("hint") or "")[:200]}
                 for r in (data or {}).get("rooms") or [] if isinstance(r, dict) and r.get("question") and r.get("answer")]
        if len(rooms) >= 2:
            return {"title": str(data.get("title") or f"Escape: {topic}")[:80], "story": str(data.get("story") or "")[:300],
                    "topic": topic, "rooms": rooms[:4]}
    except Exception:
        pass
    pick = random.sample(cards, min(len(cards), 3)) if cards else []
    if len(pick) < 3:
        pick += [{"front": q, "back": a} for q, a in random.sample(
            [("How many sides does a hexagon have?", "6"), ("What is 7 x 8?", "56"), ("What is the capital of France?", "Paris"),
             ("What planet do we live on?", "Earth"), ("What is frozen water called?", "Ice")], 3 - len(pick))]
    names = [("The dusty library", "Books whisper on the shelves. A brass lock waits on the door."),
             ("The clock room", "A hundred clocks tick at once. One of them has a keyhole."),
             ("The moonlit vault", "The last door glows. Vermeil grins: 'Last one!'")]
    return {"title": f"Escape: {topic}", "story": "Vermeil locked you in her puzzle house. Answer to get out!",
            "topic": topic, "rooms": [{"name": n, "scene": s, "question": c["front"], "answer": c["back"], "also": [],
                                       "hint": f"It starts with '{str(c['back'])[:1]}'."}
                                      for (n, s), c in zip(names, pick)]}


def escape_check(answer, room):
    """a typed answer against a room's answer (and the other accepted ones), ignoring case, accents and spaces"""
    a = _norm(answer)
    return bool(a) and any(a == _norm(x) or (len(_norm(x)) > 4 and _norm(x) in a)
                           for x in [room.get("answer")] + list(room.get("also") or []))


# ------------------------------------------------------------------ drawing game
# her doodles: strokes on a 100x100 board, drawn one by one while you guess
DOODLES = {
    "house": [[[20, 50], [50, 20], [80, 50]], [[25, 50], [25, 85], [75, 85], [75, 50]], [[45, 85], [45, 65], [57, 65], [57, 85]]],
    "sun": [[[50, 35], [62, 40], [65, 52], [58, 63], [45, 64], [36, 55], [37, 42], [50, 35]], [[50, 15], [50, 25]],
            [[50, 75], [50, 85]], [[15, 50], [25, 50]], [[75, 50], [85, 50]], [[25, 25], [32, 32]], [[75, 25], [68, 32]],
            [[25, 75], [32, 68]], [[75, 75], [68, 68]]],
    "tree": [[[45, 90], [45, 60], [55, 60], [55, 90]], [[50, 15], [25, 45], [35, 45], [20, 62], [80, 62], [65, 45], [75, 45], [50, 15]]],
    "fish": [[[20, 50], [35, 35], [60, 35], [72, 50], [60, 65], [35, 65], [20, 50]], [[72, 50], [88, 35], [88, 65], [72, 50]],
             [[32, 46], [33, 47]]],
    "star": [[[50, 12], [60, 40], [90, 40], [65, 58], [75, 88], [50, 70], [25, 88], [35, 58], [10, 40], [40, 40], [50, 12]]],
    "cat": [[[30, 40], [30, 20], [42, 32], [58, 32], [70, 20], [70, 40]], [[30, 40], [28, 55], [38, 68], [62, 68], [72, 55], [70, 40]],
            [[40, 48], [41, 49]], [[60, 48], [61, 49]], [[48, 56], [50, 58], [52, 56]], [[20, 55], [38, 57]], [[62, 57], [80, 55]]],
    "flower": [[[50, 90], [50, 50]], [[50, 50], [40, 38], [50, 28], [60, 38], [50, 50]], [[50, 50], [38, 55], [32, 45], [44, 42]],
               [[50, 50], [62, 55], [68, 45], [56, 42]], [[50, 72], [62, 64], [52, 66]]],
    "car": [[[12, 65], [12, 50], [30, 50], [38, 35], [65, 35], [75, 50], [88, 50], [88, 65], [12, 65]],
            [[25, 65], [27, 72], [33, 74], [38, 70], [37, 65]], [[63, 65], [65, 72], [71, 74], [76, 70], [75, 65]]],
    "heart": [[[50, 85], [18, 52], [15, 35], [25, 22], [40, 22], [50, 35], [60, 22], [75, 22], [85, 35], [82, 52], [50, 85]]],
    "boat": [[[15, 65], [85, 65], [72, 82], [28, 82], [15, 65]], [[50, 65], [50, 15]], [[50, 18], [78, 55], [50, 55]]],
    "moon": [[[60, 15], [42, 22], [32, 40], [34, 62], [48, 78], [68, 84], [52, 70], [46, 50], [50, 30], [60, 15]]],
    "umbrella": [[[15, 45], [30, 25], [50, 18], [70, 25], [85, 45], [15, 45]], [[50, 45], [50, 80], [45, 86], [40, 82]]],
}


def her_doodle(exclude=()):
    name = random.choice([k for k in DOODLES if k not in set(exclude or ())] or list(DOODLES))
    return {"id": name, "strokes": DOODLES[name], "letters": len(name)}


def doodle_check(doodle_id, guess):
    g = _norm(guess)
    syn = {"sun": ["sunshine"], "car": ["auto", "automobile"], "boat": ["ship", "sailboat"], "cat": ["kitty", "kitten"],
           "moon": ["crescent"], "house": ["home"], "fish": ["goldfish"]}
    return g in [doodle_id] + syn.get(doodle_id, []) or (g.endswith("s") and g[:-1] == doodle_id)


DRAW_PROMPTS = ["cat", "house", "tree", "sun", "car", "fish", "flower", "star", "heart", "boat", "moon", "umbrella",
                "dog", "apple", "rocket", "guitar", "pizza", "cloud", "bicycle", "snowman", "ice cream", "clock"]


def draw_prompt():
    return {"word": random.choice(DRAW_PROMPTS)}


def guess_drawing(data_uri, secret="", see=None):
    """she looks at your drawing and guesses. see(data_uri, prompt) -> dict lets tests fake the vision AI."""
    if not str(data_uri or "").startswith("data:image/"):
        return {"error": "No drawing."}
    prompt = ("This is a quick drawing from a guessing game (like Pictionary). Guess what it is. Reply with JSON only: "
              "{\"guess\": \"one or two words\", \"others\": [two other guesses], \"comment\": \"one short playful line "
              "as the friend guessing\"}")
    try:
        data = (see or _see)(data_uri, prompt) or {}
    except Exception as e:
        return {"error": f"I couldn't look at it ({str(e)[:80]})."}
    guesses = [str(data.get("guess") or "").strip()] + [str(x).strip() for x in data.get("others") or []]
    guesses = [g[:40] for g in guesses if g][:3]
    right = bool(secret) and any(_norm(secret) == _norm(g) or _norm(secret) in _norm(g) for g in guesses)
    return {"guesses": guesses, "comment": str(data.get("comment") or "")[:200], "right": right}


def _see(data_uri, prompt):
    import llm
    r = llm.get_client().chat.completions.create(model="vision", response_format={"type": "json_object"}, messages=[
        {"role": "user", "content": [{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": data_uri}}]}])
    return json.loads(r.choices[0].message.content or "{}")


# ------------------------------------------------------------------ rhythm: song tempo
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
