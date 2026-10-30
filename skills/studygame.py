"""
studygame.py - Study as a game (Study -> Play):

  deck(limit)                 today's flashcards: every flashcard set + your language word bank, one card at a
                              time. Cards you miss come back sooner (Leitner boxes 1-5: 1, 2, 4, 8, 16 days)
  answer(card_id, knew)       move the card to the next box (or back to box 1)
  find_moment(source, text)   a video-lecture source ("Beams.mp4, part 3") -> the second where it was said
  ask_library(question)       an answer from your own files, with [file, page] sources (videos: a ▶ time)
  formula_sheet(file_ids)     every formula in your lectures on one printable page

Card boxes are saved in data/cards.json.
"""
import json
import os
import re
from datetime import date, timedelta

import academic
from paths import data_file

CARDS_FILE = data_file("cards.json")
BOX_DAYS = {1: 1, 2: 2, 3: 4, 4: 8, 5: 16}
NEW_PER_DAY = 20


def _load():
    try:
        with open(CARDS_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(d):
    tmp = CARDS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
    os.replace(tmp, CARDS_FILE)


def all_cards():
    """every card you have: flashcard sets from Study and the language word bank"""
    out = []
    for r in academic.list_reviews():
        if r.get("type") != "flashcards":
            continue
        full = academic.get_review(r["id"]) or {}
        for i, it in enumerate(full.get("items") or []):
            if it.get("front") and it.get("back"):
                out.append({"id": f"{r['id']}:{i}", "front": it["front"], "back": it["back"], "source": it.get("source", ""),
                            "deck": r.get("title") or "Flashcards"})
    try:
        import sensei
        for w in sensei.word_bank():
            out.append({"id": f"w:{w['lang']}:{w['word']}", "front": w["word"] + (f"  ({w['reading']})" if w.get("reading") else ""),
                        "back": w["meaning"], "source": "", "deck": f"Word bank ({sensei.LANGS.get(w['lang'], w['lang'])})",
                        "say": w["word"], "lang": w["lang"]})
    except Exception:  # noqa: BLE001 - the word bank is optional here
        pass
    return out


def deck(limit=30, today=None):
    """cards due today (missed ones first), then up to NEW_PER_DAY new ones"""
    today = (today or date.today()).isoformat()
    boxes = _load()
    due, new = [], []
    for c in all_cards():
        b = boxes.get(c["id"])
        if not b:
            new.append({**c, "box": 0})
        elif b["due"] <= today:
            due.append({**c, "box": b["box"]})
    due.sort(key=lambda c: c["box"])
    picked = (due + new[:NEW_PER_DAY])[:max(1, int(limit))]
    return {"cards": picked, "due": len(due), "new": len(new), "total": len(due) + len(new)}


def answer(card_id, knew, today=None):
    today = today or date.today()
    boxes = _load()
    b = boxes.get(card_id, {"box": 0})
    box = min(5, b["box"] + 1) if knew else 1
    boxes[card_id] = {"box": box, "due": (today + timedelta(days=BOX_DAYS[box] if knew else 1)).isoformat()}
    _save(boxes)
    return boxes[card_id]


# ------------------------------------------------------------------ video lectures: jump to the moment
_TIME = re.compile(r"^\[(\d+(?::\d\d){1,2})\]\s*(.*)$")


def _seconds(clock):
    s = 0
    for part in clock.split(":"):
        s = s * 60 + int(part)
    return s


def find_moment(source, text=""):
    """'Week 1 - Beams.mp4, part 3' (+ the question/answer) -> {file_id, seconds, clock} or None"""
    m = re.match(r"\s*(.+?),\s*(?:part|p\.|slide)\s*(\d+)", source or "")
    files = [f for f in academic.list_files() if f.get("video")]
    entry = next((f for f in files if m and f["name"].lower() == m.group(1).strip().lower()), None)
    if not entry:
        return None
    pages = academic.file_pages(entry["id"])
    n = int(m.group(2)) - 1
    if not 0 <= n < len(pages):
        return None
    want = set(academic._tokens(text))
    best, best_hit = None, -1
    for line in pages[n].splitlines():
        t = _TIME.match(line.strip())
        if not t:
            continue
        hit = len(want & set(academic._tokens(t.group(2))))
        if hit > best_hit:
            best, best_hit = t.group(1), hit
    if best is None:
        return None
    return {"file_id": entry["id"], "name": entry["name"], "seconds": _seconds(best), "clock": best}


# ------------------------------------------------------------------ ask the library
def ask_library(question, file_ids=None):
    import llm
    hits = academic.search(question, k=6, file_ids=file_ids or None)
    if not hits:
        return {"answer": "I couldn't find anything about that in your library. Try other words, or add the lecture first.",
                "sources": []}
    material = "\n\n".join(f"[{h['label']}]\n{h['text'][:2000]}" for h in hits)
    answer_text = llm.ask(
        "Answer the student's question using ONLY these excerpts from their own lecture files. Be clear and short "
        "(under 150 words). After each fact put its [file, page] label exactly as written. If the excerpts don't "
        f"answer it, say so.\n\nQUESTION: {question}\n\nEXCERPTS:\n{material}", model="smart")
    sources = []
    for h in hits[:4]:
        s = {"label": h["label"], "file_id": h["file_id"], "page": h["page"]}
        moment = find_moment(h["label"], question)
        if moment:
            s["moment"] = moment
        sources.append(s)
    return {"answer": (answer_text or "").strip(), "sources": sources}


# ------------------------------------------------------------------ formula sheet
def formula_sheet(file_ids):
    import llm
    material = academic.source_text(file_ids)
    if not material.strip():
        raise ValueError("Tick files that have readable text first.")
    data = llm.ask(
        "List EVERY formula and equation in this lecture material, grouped by topic. Copy them exactly; write them in "
        "plain text math (e.g. M = w*L^2/8, sigma = M*c/I). For each give a short name, what each symbol means with "
        "units, and its [file, page] source. Reply with JSON only: {\"topics\": [{\"topic\": \"...\", \"formulas\": "
        "[{\"name\": \"...\", \"formula\": \"...\", \"symbols\": \"M = moment (kN·m), ...\", \"source\": \"file, p. 3\"}]}]}"
        f"\n\nMATERIAL:\n{material}", model="smart", json_mode=True)
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            data = {}
    topics = []
    for t in (data or {}).get("topics") or []:
        fs = [{k: str(f.get(k) or "")[:400] for k in ("name", "formula", "symbols", "source")}
              for f in t.get("formulas") or [] if isinstance(f, dict) and f.get("formula")]
        if fs:
            topics.append({"topic": str(t.get("topic") or "Formulas")[:80], "formulas": fs})
    if not topics:
        raise ValueError("No formulas were found in those files.")
    names = [f["name"] for f in academic.list_files() if f["id"] in file_ids]
    return {"title": "Formula sheet: " + ", ".join(names)[:100], "topics": topics,
            "count": sum(len(t["formulas"]) for t in topics)}
