"""
mind.py - journal, "think" tools, remembering past chats, and noticing what you're doing.

Journal (data/journal.json) holds four kinds of entries:
  decision - Decision Journal: what you chose and why; review later and write the outcome.
  idea     - Idea Incubator: half-formed ideas the AI can grow later.
  goal     - Milestone Guardian: goals with small steps you tick off.
  story    - Digital Legacy Journal: memories, stories and lessons to keep.

Think tools (one bigger-model call each, except the council):
  council, what_if, simulate, foresight, fusion, patterns, reverse.
"""
import json
import math
import os
import re
import sys
import uuid
from datetime import datetime, date, timedelta

from paths import data_file

JOURNAL_FILE = data_file("journal.json")
ARCHIVE_FILE = data_file("vermeil_archive.json")
MEMORY_FILE = data_file("vermeil_memory_0.json")
THINK_MODEL = "smart"          # local model role (llm.py)
KINDS = ("decision", "idea", "goal", "story")

# ---------------------------------------------------------------- style shifter
STYLES = {
    "companion": "Talk like a warm, playful companion (your normal self).",
    "tutor": "Act as a patient tutor: explain step by step, check understanding with a short question, use simple examples.",
    "strategist": "Act as a sharp strategist: be structured, weigh options, name risks and the best next move.",
    "assistant": "Act as a professional assistant: concise, polite, practical, no flirting or teasing.",
    "coach": ("Act as a social rehearsal coach: role-play the other person in the situation the user describes "
              "(interview, hard talk, presentation), stay in that role, then give 2-3 short tips when they ask for feedback."),
}

EMERGENCY_NOTE = (
    "If the user describes an emergency (injury, fire, someone not breathing, danger, thoughts of hurting themselves), "
    "first tell them to call emergency services now (911 in the Philippines), then give only clear basic first-aid or "
    "safety steps. Never replace professionals.")


def style_note(style):
    return STYLES.get(style or "companion", STYLES["companion"])


# ---------------------------------------------------------------- journal
def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def _write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def _entries():
    data = _read(JOURNAL_FILE, [])
    return data if isinstance(data, list) else []


def list_journal(kind=None):
    items = [e for e in _entries() if not kind or e["kind"] == kind]
    return sorted(items, key=lambda e: e["created"], reverse=True)


def add_journal(kind, title, text="", steps=None, review_in_days=None):
    if kind not in KINDS:
        return {"error": f"kind must be one of {', '.join(KINDS)}"}
    if not (title or "").strip():
        return {"error": "Give it a title."}
    entry = {"id": uuid.uuid4().hex[:8], "kind": kind, "title": title.strip(), "text": (text or "").strip(),
             "created": datetime.now().isoformat(timespec="seconds"), "status": "open", "outcome": "",
             "steps": [{"text": s.strip(), "done": False} for s in (steps or []) if s and s.strip()]}
    if kind == "decision":
        entry["review_on"] = (date.today() + timedelta(days=int(review_in_days or 30))).isoformat()
    items = _entries()
    items.append(entry)
    _write(JOURNAL_FILE, items)
    return entry


def update_journal(entry_id, **changes):
    items = _entries()
    for e in items:
        if e["id"] == entry_id:
            for k in ("title", "text", "status", "outcome"):
                if k in changes and changes[k] is not None:
                    e[k] = str(changes[k])
            if "add_step" in changes and changes["add_step"]:
                e["steps"].append({"text": changes["add_step"], "done": False})
            if "toggle_step" in changes and changes["toggle_step"] is not None:
                i = int(changes["toggle_step"])
                if 0 <= i < len(e["steps"]):
                    e["steps"][i]["done"] = not e["steps"][i]["done"]
            if e["steps"] and e["kind"] == "goal":
                e["status"] = "done" if all(s["done"] for s in e["steps"]) else "open"
            _write(JOURNAL_FILE, items)
            return e
    return {"error": "Not found."}


def remove_journal(entry_id):
    items = _entries()
    left = [e for e in items if e["id"] != entry_id]
    _write(JOURNAL_FILE, left)
    return len(left) < len(items)


def decisions_to_review(today=None):
    today = (today or date.today()).isoformat()
    return [e for e in _entries() if e["kind"] == "decision" and not e["outcome"] and e.get("review_on", "9") <= today]


def journal_text(kind=None):
    """Short text version for the AI."""
    items = list_journal(kind)
    if not items:
        return "The journal is empty."
    out = []
    for e in items[:30]:
        steps = f" steps: {sum(s['done'] for s in e['steps'])}/{len(e['steps'])} done" if e["steps"] else ""
        extra = f" outcome: {e['outcome']}" if e["outcome"] else ""
        out.append(f"[{e['id']}] {e['kind']} ({e['created'][:10]}, {e['status']}): {e['title']} - {e['text'][:200]}{steps}{extra}")
    return "\n".join(out)


# ---------------------------------------------------------------- contextual recall / archivist
def _tok(text):
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def _everything():
    """(source, date, text) for every searchable thing: chats, archive, journal, notes, study files."""
    docs = []
    for path, label in ((MEMORY_FILE, "chat"), (ARCHIVE_FILE, "older chat")):
        data = _read(path, {})
        if isinstance(data, dict):
            for user, val in data.items():
                msgs = val.get("conversations", []) if isinstance(val, dict) else val if isinstance(val, list) else []
                for i in range(0, len(msgs) - 1, 2):              # user + reply as one piece
                    pair = msgs[i:i + 2]
                    docs.append((label, "", " / ".join(f"{m.get('role')}: {m.get('content')}" for m in pair if isinstance(m, dict))))
    for e in _entries():
        docs.append((f"journal {e['kind']}", e["created"][:10], f"{e['title']}: {e['text']} {e['outcome']}"))
    try:
        import f1
        for n in f1.load_data().get("notes", []):
            docs.append(("note", "", str(n)))
    except Exception:
        pass
    for sc in list_screens():                               # screenshots she looked at
        docs.append((f"screenshot {sc['file']}", sc["at"][:10], f"{sc['question']} {sc['text']}"))
    try:                                                    # your study library (lectures, notes, photos of notes)
        import academic
        for f in academic.list_files():
            for i, page in enumerate(academic.file_pages(f["id"]) or []):
                if page.strip():
                    docs.append((f"file {f['name']} p.{i + 1}", f.get("added", "")[:10], page[:1500]))
    except Exception:
        pass
    return docs


# ---------------------------------------------------------------- screenshot archive
SCREENS_DIR = data_file("screens")
SCREENS_FILE = data_file("screens.json")
MAX_SCREENS = 300


def list_screens():
    try:
        with open(SCREENS_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def archive_screen(jpg_b64, question, text):
    """Keep a screenshot she looked at + what she saw, so 'that error I showed you last week' can be found again."""
    import base64
    os.makedirs(SCREENS_DIR, exist_ok=True)
    now = datetime.now()
    name = now.strftime("%Y-%m-%d_%H-%M-%S") + f"_{uuid.uuid4().hex[:4]}.jpg"
    with open(os.path.join(SCREENS_DIR, name), "wb") as f:
        f.write(base64.b64decode(jpg_b64))
    items = list_screens()
    items.append({"file": name, "at": now.strftime("%Y-%m-%d %H:%M"), "question": (question or "")[:300], "text": (text or "")[:2000]})
    for old in items[:-MAX_SCREENS]:
        try:
            os.remove(os.path.join(SCREENS_DIR, old["file"]))
        except OSError:
            pass
    items = items[-MAX_SCREENS:]
    with open(SCREENS_FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=1, ensure_ascii=False)
    return name


def screen_path(name):
    return os.path.join(SCREENS_DIR, os.path.basename(name))


def find_screens(query, k=3):
    hits = [h for h in recall(query, k=12) if h["source"].startswith("screenshot ")][:k]
    return [{"file": h["source"].split(" ", 1)[1], "date": h["date"], "text": h["text"]} for h in hits]


# ---------------------------------------------------------------- recommendations
REC_CATEGORIES = ("movies", "shows", "anime", "books", "games", "music", "food", "recipes", "activities", "places", "youtube", "podcasts")


def recommend(category="anything", n=5, mood="", prefs=None):
    """Personal picks from what they like, their goals and recent chats. Returns [{"title", "why"}]."""
    import llm
    prefs = prefs if prefs is not None else {}
    goals = [e["title"] for e in _entries() if e["kind"] == "goal"][-6:]
    try:
        import music
        taste = music.top_songs(8)
    except Exception:
        taste = []
    recent = [h["text"][:160] for h in recall(f"{category} {mood} like love favorite enjoy", k=4)]
    data = llm.ask(
        f"Recommend {n} {category if category != 'anything' else 'things (mix of movies, books, food, activities)'} for "
        f"this person{f' who is in the mood for: {mood}' if mood else ''}.\n"
        f"What they like/dislike: {json.dumps(prefs, ensure_ascii=False)[:1500]}\nTheir goals: {goals}\n"
        f"Songs they play most: {taste}\nThings they said: {recent}\n"
        f"Pick real, specific titles/places/dishes. Avoid things they dislike. For each, one short reason tied to them.\n"
        f'Reply as JSON: {{"items": [{{"title": "...", "why": "..."}}]}}', model="chat", json_mode=True)
    return [{"title": str(i.get("title", "")).strip(), "why": str(i.get("why", "")).strip()}
            for i in (data.get("items") or [])[:n] if str(i.get("title", "")).strip()]


def recommend_text(category="anything", mood="", prefs=None):
    items = recommend(category, 5, mood, prefs)
    return "\n".join(f"- {i['title']}: {i['why']}" for i in items) or "I couldn't think of anything right now."


def recall(query, k=5):
    """Simple BM25 search over everything you've said and saved."""
    q = set(_tok(query)) - {"the", "a", "an", "i", "you", "we", "about", "what", "did", "remember", "when", "my", "me", "to", "of"}
    docs = _everything()
    if not q or not docs:
        return []
    toks = [_tok(d[2]) for d in docs]
    avg = sum(map(len, toks)) / len(toks) or 1
    df = {w: sum(1 for t in toks if w in t) for w in q}
    scored = []
    for d, t in zip(docs, toks):
        s = 0.0
        for w in q:
            tf = t.count(w)
            if tf:
                idf = math.log(1 + (len(docs) - df[w] + 0.5) / (df[w] + 0.5))
                s += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * len(t) / avg))
        if s > 0:
            scored.append((s, d))
    scored.sort(key=lambda x: -x[0])
    return [{"source": d[0], "date": d[1], "text": d[2][:400]} for _, d in scored[:k]]


def recall_text(query):
    hits = recall(query)
    if not hits:
        return "Nothing found about that."
    return "\n".join(f"({h['source']}{' ' + h['date'] if h['date'] else ''}) {h['text']}" for h in hits)


_PAST = re.compile(r"\b(remember|last time|before|we talked|i told you|earlier|again|that time)\b", re.I)


def recall_note(user_input):
    """Extra context when the user refers back to an old conversation."""
    if not _PAST.search(user_input or ""):
        return ""
    hits = recall(user_input, k=3)
    if not hits:
        return ""
    return "Relevant things from past conversations and notes: " + " | ".join(h["text"][:250] for h in hits)


# ---------------------------------------------------------------- contextual companion
APPS = [
    ("coding", r"visual studio|vs ?code|pycharm|\.py\b|\.js\b|github|terminal|powershell|cmd\.exe"),
    ("studying", r"\.pdf|canvas|google classroom|lecture|module|quizlet|docs\.google|word|notion"),
    ("gaming", r"steam|roblox|minecraft|valorant|genshin|league of legends|epic games|dota"),
    ("watching", r"youtube|netflix|twitch|prime video|crunchyroll"),
    ("chatting", r"discord|messenger|facebook|telegram|whatsapp|slack"),
]


def active_window_title():
    if sys.platform != "win32":
        return ""
    try:
        import ctypes
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        return buf.value
    except Exception:
        return ""


def current_activity(title=None):
    title = (active_window_title() if title is None else title) or ""
    for name, pattern in APPS:
        if re.search(pattern, title, re.I):
            return name
    return ""


def activity_note(title=None):
    act = current_activity(title)
    return f"The user seems to be {act} right now (from their active window); keep that in mind." if act else ""


# ---------------------------------------------------------------- think tools
MODES = {
    "what_if": "What-If Simulator: explore how this change could play out. Give 2-3 realistic scenarios "
               "(best, likely, worst) with short- and long-term effects, then what to watch for.",
    "simulate": "Daily Life Simulator: simulate this plan (schedule, study plan, budget or routine) hour by hour or "
                "week by week, show where it breaks (time, money, energy), and give an improved version.",
    "foresight": "Strategic Foresight: look 1, 3 and 5 years ahead. Name trends that matter, risks, opportunities, "
                 "and 3 concrete moves to make now.",
    "fusion": "Idea Fusion: combine the given ideas or fields into 3 new, original concepts. For each: name, one-line "
              "pitch, how it works, and the first small test.",
    "reverse": "Reverse Engineer: break this success (product, habit, result) into its parts, explain why each works, "
               "and turn it into a step-by-step recipe the user can copy.",
    "patterns": "Pattern Detective: from the user's own data below, point out repeating patterns (habits, moods, "
                "procrastination, busy days, recurring topics). Be specific and kind, and suggest 2-3 small changes.",
    "ritual": "Personal Ritual Designer: design a short, realistic routine (morning, study, wind-down...) with times, "
              "and say which steps could become repeating reminders.",
    "grow": "Idea Incubator: develop this idea further: who it's for, what makes it special, risks, and the next 3 steps.",
    # ---- thinking skills
    "hypothesis": "Hypothesis Generator: list 4-6 possible explanations for this problem, rank them by how well the "
                  "evidence supports them, and for each give a quick test that would confirm or rule it out.",
    "contradiction": "Contradiction Detector: compare the user's plans, notes, tasks, decisions and goals below. List every "
                     "place where they conflict (time clashes, goals that fight each other, decisions that go against "
                     "earlier ones). For each, say why it matters and one way to resolve it. If none, say so.",
    "causal": "Causal Reasoning Assistant: separate real causes from mere correlations. Name possible confounders and "
              "reverse causation, say what evidence would establish cause, and suggest a small experiment.",
    "blindspot": "Blind-Spot Finder: review this project/decision and list hidden assumptions, overlooked requirements, "
                 "missing information and risks, most important first, each with a question to answer.",
    "feasibility": "Goal Feasibility Checker: estimate the time, money, skills and effort this goal needs, compare with "
                   "the user's current commitments below, give a feasibility rating (1-10) and a realistic timeline.",
    "procrastination": "Procrastination Breaker: turn this intimidating task into a tiny first action that takes under "
                       "5 minutes, then the next 4-6 small steps. Be encouraging and concrete.",
    "habit": "Habit Experiment Designer: design a 1-2 week experiment for this habit change: the exact small change, "
             "what to measure daily, how to judge if it helped, and the check-in steps.",
    "challenge": "Personal Challenge Generator: create a daily or weekly challenge tailored to the user's interests and "
                 "level (see their data below), with clear rules, a way to track it, and an easier/harder version.",
    "prototype": "Concept-to-Prototype Planner: turn this idea into a buildable prototype: the smallest version worth "
                 "building, tools/materials, step-by-step build plan, how to test it, and what to build next.",
    "modeling": "3D Modeling Coach (Blender): guide step by step - blocking out, topology, edge loops, UVs, materials, "
                "rigging/weight painting and exporting a .glb/.vrm that works in the Vermeil room. Mention exact Blender "
                "menus and shortcuts.",
    "drift": "Routine Drift Detector: from the routine data below, find routines that are being missed again and again "
             "(and when), suggest realistic adjustments (new time, smaller version, different day) instead of more "
             "reminders.",
}
# modes that also look at the user's own data
NEEDS_DATA = {"contradiction", "feasibility", "challenge", "drift", "patterns"}
# modes that end in a list of steps the user can save as a goal
STEP_MODES = {"procrastination", "habit", "prototype", "challenge", "feasibility"}
COUNCIL = {
    "Researcher": "the facts, evidence and what is still unknown",
    "Planner": "a realistic step-by-step plan with time estimates",
    "Programmer": "technical options, tools and how to build it (say 'not technical' if it isn't)",
    "Critic": "weaknesses, risks and what could go wrong",
}


def _ask(prompt, max_chars=6000):
    import pinakamain
    r = pinakamain.get_client().chat.completions.create(
        model=THINK_MODEL, messages=[{"role": "user", "content": prompt[:max_chars * 3]}])
    return (r.choices[0].message.content or "").strip()


def personal_data():
    """What the pattern detective looks at."""
    parts = [journal_text()]
    try:
        import f1
        d = f1.load_data()
        parts.append("Tasks: " + json.dumps(d.get("tasks", []), ensure_ascii=False)[:2500])
        parts.append("Reminders: " + json.dumps(d.get("reminders", []), ensure_ascii=False)[:1500])
        parts.append("Weekly schedule: " + json.dumps(d.get("schedule", {}), ensure_ascii=False)[:1500])
        parts.append("Notes: " + json.dumps(d.get("notes", []), ensure_ascii=False)[:1500])
    except Exception:
        pass
    mem = _read(MEMORY_FILE, {})
    said = [m.get("content", "") for v in mem.values() if isinstance(v, dict)
            for m in v.get("conversations", [])[-120:] if m.get("role") == "user"]
    parts.append("Recent things the user said: " + " | ".join(said)[-4000:])
    return "\n\n".join(parts)


def think(mode, question):
    """Run one think tool. Returns {'answer': markdown, 'parts': [...]}."""
    question = (question or "").strip()
    if mode == "council":
        if not question:
            return {"error": "Ask the council something."}
        parts = []
        for role, focus in COUNCIL.items():
            parts.append({"role": role, "text": _ask(
                f"You are the {role} on an advisory council. Focus only on {focus}. Be concise (under 150 words, "
                f"bullet points ok).\n\nQuestion: {question}")})
        views = "\n\n".join(f"{p['role']}:\n{p['text']}" for p in parts)
        answer = _ask(f"You chair an advisory council. Combine these views into one clear recommendation for the user: "
                      f"where they agree, where they disagree, and the final advice with next steps. Use markdown.\n\n"
                      f"Question: {question}\n\n{views}")
        return {"answer": answer, "parts": parts}
    if mode == "evolve":
        return evolve(question)
    if mode not in MODES:
        return {"error": f"Unknown mode {mode}."}
    if mode in NEEDS_DATA:
        extra = drift_data() if mode == "drift" else ""
        question = (question or "Look at my data.") + "\n\nThe user's data:\n" + personal_data() + extra
    elif not question:
        return {"error": "Type what you want to think about."}
    prompt = f"{MODES[mode]} Use markdown with short headings. Be practical, beginner-friendly.\n\n{question}"
    if mode in STEP_MODES:
        import llm
        try:
            data = llm.ask(prompt + '\n\nReply as JSON: {"answer": "<the full markdown answer>", "goal": "<short goal '
                           'title>", "steps": ["<step 1>", "<step 2>", "..."]}', model=THINK_MODEL, json_mode=True)
            steps = [str(x)[:200] for x in data.get("steps", []) if str(x).strip()][:12]
            return {"answer": str(data.get("answer", "")), "parts": [], "goal": str(data.get("goal", ""))[:100], "steps": steps}
        except Exception as e:
            print(f"[think] step list skipped: {e}")
    return {"answer": _ask(prompt), "parts": []}


def evolve(problem, rounds=2):
    """Solution Evolution: make 3 solutions, test them against criteria, improve the best, repeat."""
    if not problem:
        return {"error": "Describe the problem to solve."}
    import llm
    data = llm.ask(f"Problem: {problem}\nList 4 clear criteria a good solution must meet, then 3 different candidate "
                   f'solutions. Reply as JSON: {{"criteria": ["..."], "solutions": ["..."]}}', model=THINK_MODEL, json_mode=True)
    criteria = [str(c) for c in data.get("criteria", [])][:6]
    best, parts = None, []
    pool = [str(x) for x in data.get("solutions", [])][:3]
    for r in range(rounds + 1):
        scored = llm.ask(f"Problem: {problem}\nCriteria: {criteria}\nScore each solution 1-10 per criterion and total "
                         f"it. Reply as JSON: {{\"scores\": [{{\"solution\": \"...\", \"total\": 0, \"weakness\": \"...\"}}]}}"
                         f"\nSolutions: {json.dumps(pool)}", model=THINK_MODEL, json_mode=True).get("scores", [])
        if not scored:
            break
        top = max(scored, key=lambda x: float(x.get("total", 0) or 0))
        best = top
        parts.append({"role": f"Round {r + 1}", "text": "\n".join(f"- **{float(x.get('total', 0) or 0):g}** - {x.get('solution', '')}"
                                                                 f" _(weak: {x.get('weakness', '')})_" for x in scored)})
        if r == rounds:
            break
        improved = llm.ask(f"Problem: {problem}\nCriteria: {criteria}\nBest solution so far: {top.get('solution')}\n"
                           f"Its weakness: {top.get('weakness')}\nMake 2 improved versions that fix the weakness. "
                           f'Reply as JSON: {{"solutions": ["...", "..."]}}', model=THINK_MODEL, json_mode=True)
        pool = [top.get("solution", "")] + [str(x) for x in improved.get("solutions", [])][:2]
    answer = (f"### Criteria\n" + "\n".join(f"- {c}" for c in criteria) +
              f"\n\n### Best solution (score {float((best or {}).get('total', 0) or 0):g})\n{(best or {}).get('solution', '')}")
    return {"answer": answer, "parts": parts}


def drift_data():
    """Facts for the Routine Drift Detector: gym attendance by weekday, overdue tasks, stale goal steps."""
    from datetime import date as _d
    lines = []
    try:
        import gym
        log = gym._log()
        days = [k for k, v in log.items() if v.get("sets") and k >= (_d.today() - timedelta(days=42)).isoformat()]
        by_wd = {}
        for k in days:
            wd = datetime.fromisoformat(k).strftime("%A")
            by_wd[wd] = by_wd.get(wd, 0) + 1
        lines.append(f"Gym sessions in the last 6 weeks: {len(days)}; by weekday: {by_wd or 'none'}. "
                     f"Routine has {len(gym.get_routine().get('days', []))} days per cycle.")
    except Exception:
        pass
    try:
        import f1
        d = f1.load_data()
        today = _d.today().isoformat()
        overdue = [t.get("task") for t in d.get("tasks", []) if not t.get("done") and t.get("deadline") and t["deadline"] < today]
        lines.append(f"Overdue tasks: {overdue or 'none'}.")
        lines.append(f"Repeating reminders: {[r.get('text') or r.get('reminder') for r in d.get('reminders', []) if r.get('repeat', 'none') != 'none']}.")
    except Exception:
        pass
    stale = [e["title"] for e in _entries() if e["kind"] == "goal" and e["status"] != "done"
             and e["created"] < (datetime.now() - timedelta(days=14)).isoformat()]
    lines.append(f"Goals open for more than 2 weeks: {stale or 'none'}.")
    return "\n\nRoutine facts:\n" + "\n".join(lines)


# ====================================================================== practice conversations
PRACTICE_FILE = data_file("practice.json")
PRACTICE = {
    "debate": ("AI Debate Partner. The user takes a position on the topic. You argue the OPPOSITE side well: challenge "
               "their assumptions, give the strongest counterarguments, ask one hard question each turn. Under 120 words."),
    "reflect": ("Reflection Interviewer. The user had a major event (described in the topic). Ask ONE structured, "
                "open question at a time (what happened, what went well, what was hard, what you'd change, the lesson). "
                "Briefly acknowledge their answer, then ask the next question. Under 60 words."),
    "rehearse": ("Confidence Rehearsal coach. Play the other person in the scenario (interview, presentation, hard "
                 "conversation). Stay in role. Difficulty level {level}/5: 1 = friendly and easy, 5 = tough, skeptical, "
                 "interrupting. Under 80 words per turn."),
}
SCORE_PROMPTS = {
    "debate": "Score the USER's reasoning in this debate, 1-10 for each: clarity, evidence, logic, handling "
              "counterarguments, persuasiveness. Give the total /50, their strongest point, weakest point and 2 tips.",
    "reflect": "Summarise this reflection: what happened, what went well, what was hard, the main lessons, and 1-3 "
               "actions for next time. Write it warmly, in second person.",
    "rehearse": "Give feedback on the user's performance in this rehearsal: confidence, clarity, structure, handling "
                "pressure (1-10 each), 3 specific tips, and whether they're ready for the next level.",
    "sensei": "You are the language teacher. Review the STUDENT's lines in this conversation: list each mistake as "
              "'wrong → right (why)', one per line; then words worth learning, a level estimate, and 2 tips. Use markdown.",
}


def _practices():
    data = _read(PRACTICE_FILE, {})
    return data if isinstance(data, dict) else {}


def practice_start(kind, topic, level=2, language=None):
    if kind not in PRACTICE and kind != "sensei":
        return {"error": "Unknown practice."}
    if not (topic or "").strip():
        return {"error": "Describe the topic or situation first."}
    level = max(1, min(5, int(level or 2)))
    sid = uuid.uuid4().hex[:8]
    if kind == "sensei":
        import sensei
        language = language or sensei._state()["language"]
        system = sensei.conversation_prompt(language, level) + f"\nConversation topic: {topic}"
    else:
        system = PRACTICE[kind].format(level=level) + f"\nTopic / situation: {topic}"
    opener = {"debate": f"State your position on: {topic}. I'll argue the other side.",
              "reflect": None, "rehearse": None, "sensei": None}[kind]
    msgs = [{"role": "system", "content": system}]
    if opener is None:
        msgs.append({"role": "user", "content": "(Start now with your first line.)"})
        first = _chat(msgs)
        msgs = msgs[:1] + [{"role": "assistant", "content": first}]
    else:
        msgs.append({"role": "assistant", "content": opener})
    data = _practices()
    data[sid] = {"id": sid, "kind": kind, "topic": topic.strip(), "level": level, "messages": msgs, "language": language,
                 "created": datetime.now().isoformat(timespec="seconds"), "score": ""}
    _write(PRACTICE_FILE, data)
    return _public(data[sid])


def _chat(messages):
    import pinakamain
    r = pinakamain.get_client().chat.completions.create(model=THINK_MODEL, messages=messages)
    return (r.choices[0].message.content or "").strip()


def _public(p):
    return {**{k: v for k, v in p.items() if k != "messages"},
            "messages": [m for m in p["messages"] if m["role"] != "system" and not m["content"].startswith("(Start now")]}


def practice_reply(sid, text):
    data = _practices()
    p = data.get(sid)
    if not p:
        return {"error": "That practice was not found."}
    p["messages"].append({"role": "user", "content": text})
    p["messages"].append({"role": "assistant", "content": _chat(p["messages"])})
    _write(PRACTICE_FILE, data)
    return _public(p)


def practice_finish(sid, save=True):
    data = _practices()
    p = data.get(sid)
    if not p:
        return {"error": "That practice was not found."}
    talk = "\n".join(f"{'USER' if m['role'] == 'user' else 'AI'}: {m['content']}" for m in p["messages"][1:])
    p["score"] = _ask(f"{SCORE_PROMPTS[p['kind']]} Use markdown.\n\nTopic: {p['topic']}\n\n{talk}")
    _write(PRACTICE_FILE, data)
    if save and p["kind"] == "reflect":
        add_journal("story", f"Reflection: {p['topic'][:60]}", p["score"])
    if p["kind"] == "sensei":
        import sensei
        sensei.save_mistakes(p.get("language"), p["score"])
        sensei.mark_practice()
    return _public(p)


def practice_list(kind=None):
    items = [p for p in _practices().values() if (p["kind"] == kind if kind else p["kind"] != "sensei")]
    return sorted((_public(p) for p in items), key=lambda p: p["created"], reverse=True)[:30]


# ====================================================================== self-check & humor
def self_check(question, answer):
    """Second look at an answer. Returns a corrected answer, or the same one if it was fine."""
    import llm
    try:
        data = llm.ask(f"Check this answer for factual mistakes, wrong math or missing key info. If it's fine reply "
                       f'{{"ok": true}}. If not, reply {{"ok": false, "fixed": "<the corrected answer, same tone and '
                       f'length>"}}.\n\nQUESTION: {question}\n\nANSWER: {answer}', model="chat", json_mode=True)
        if not data.get("ok") and str(data.get("fixed", "")).strip():
            return str(data["fixed"]).strip()
    except Exception as e:
        print(f"[self-check] skipped: {e}")
    return answer


HUMOR = {0: "Don't joke; be sincere.", 1: "Use light, gentle humor only now and then.",
         2: "Be playful and witty.", 3: "Be playful, witty and a little sarcastic (never mean)."}


def humor_note(level, emotion):
    """Adaptive humor: tone it down when the user is sad, stressed or angry."""
    level = int(level if level is not None else 2)
    if emotion in ("sad", "angry", "negative", "stressed", "anxious", "tired"):
        return "The user seems down or stressed: no sarcasm or teasing, be kind and supportive."
    return HUMOR.get(max(0, min(3, level)), HUMOR[2])


def think_text(mode, question):
    r = think(mode, question)
    return r.get("error") or r["answer"]
