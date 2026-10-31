"""
studylife.py - the Study round: what to review today, a mistake notebook, a grade tracker, citations, an essay
coach, handwritten notes from photos (with duplicate topics merged), video chapters, formula sheets by subject,
USB files sorted by subject, exam-week mode, a daily curiosity fact and pronunciation coaching.

  today_list(due, cards_due, mistakes_n, weak, exam)   the "do these today" list (spaced repetition + mistakes)
  exam_report(review, results)                          practice-exam score report by part / file
  mistakes: add_mistakes(review, results, subject) / mistakes(subject) / mistake_done(mid)
  grades: grades() / grade_save(course) / grade_remove(cid) / grade_calc(course, target)   "what do I need on the final?"
  cite(fields, style) / cite_lookup(text)               APA 7 and MLA 9 from a link or a book title
  essay_outline(topic) / essay_feedback(outline, draft) thesis -> points -> evidence, then feedback on your draft
  notebook: photo_notes(path, subject) / notebook() / merge_duplicates() / note_remove(nid)
  chapters(file_id)                                     a video lecture split into chapters with times
  formula_for_subject(subject, files)                   one formula sheet per subject (Hydrology, RCD, Steel...)
  guess_subject(path, subjects)                         which subject a USB file belongs to
  exam_plan(exams, today, sleep) / exam_active(state)   exam week: a daily plan, a bedtime, lighter chat
  fact_of_day(subjects)                                 one interesting fact a day about your subjects
  pron_coach(expected, heard, missed, language)         how to say the words you got wrong

Saved in data/studylife.json.
"""
import json
import os
import re
import threading
import uuid
from datetime import date, timedelta

from paths import data_file

STATE_FILE = data_file("studylife.json")
_lock = threading.Lock()


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


def _ask_json(prompt, ask=None, temperature=None):
    if ask is None:
        import llm
        ask = lambda p: llm.ask(p, model="smart", json_mode=True, temperature=temperature)
    d = ask(prompt)
    if isinstance(d, str):
        try:
            d = json.loads(d)
        except ValueError:
            d = {}
    return d if isinstance(d, dict) else {}


_W = re.compile(r"[a-z0-9]+")
_STOP = {"the", "a", "an", "of", "and", "to", "in", "on", "for", "notes", "lecture", "part", "chapter", "ch", "lesson"}


def _words(text):
    return {w for w in _W.findall((text or "").lower()) if w not in _STOP}


def _similar(a, b):
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return False
    return wa <= wb or wb <= wa or len(wa & wb) / len(wa | wb) >= 0.6


# ---------------------------------------------------------------- 62 what to review today
def today_list(due, cards_due, mistakes_n, weak, exam=None):
    """due = academic.due_reviews(); weak = academic.weak_topics(); exam = today's exam-week day (or None)"""
    out = []
    if exam:
        out.append({"icon": "🎯", "text": f"Exam week: {exam['focus']}", "minutes": 0, "action": "exam"})
    for r in due[:6]:
        late = (date.today() - date.fromisoformat(r["due"])).days if r.get("due") else 0
        out.append({"icon": "🔁", "text": f"Review: {r['title']}" + (f" ({late} days late)" if late > 0 else ""),
                    "minutes": 10, "action": "review", "id": r["id"]})
    if cards_due:
        out.append({"icon": "🃏", "text": f"{cards_due} flashcards", "minutes": max(3, round(cards_due * 0.3)), "action": "cards"})
    if mistakes_n:
        out.append({"icon": "📕", "text": f"Redo {min(mistakes_n, 10)} past mistakes", "minutes": 8, "action": "mistakes"})
    for w in weak[:2]:
        out.append({"icon": "💪", "text": f"Weak topic: {w['topic']} ({w['pct']}%)", "minutes": 15, "action": "weak"})
    return {"items": out, "minutes": sum(i["minutes"] for i in out)}


# ---------------------------------------------------------------- 63 practice exam score report
def exam_report(review, results):
    items = review.get("items") or []
    parts = {}
    for it, ok in zip(items, results or []):
        part = str(it.get("source") or "Other").split(",")[0].strip() or "Other"
        p = parts.setdefault(part, {"part": part, "right": 0, "total": 0})
        p["total"] += 1
        p["right"] += bool(ok)
    right = sum(p["right"] for p in parts.values())
    total = max(1, sum(p["total"] for p in parts.values()))
    pct = round(100 * right / total)
    grade = "A" if pct >= 90 else "B" if pct >= 80 else "C" if pct >= 70 else "D" if pct >= 60 else "F"
    rows = sorted(({**p, "pct": round(100 * p["right"] / p["total"])} for p in parts.values()), key=lambda p: p["pct"])
    return {"pct": pct, "grade": grade, "right": right, "total": total, "parts": rows,
            "redo": [p["part"] for p in rows if p["pct"] < 70]}


# ---------------------------------------------------------------- 72 mistake notebook
def _as_mistake(it):
    if "choices" in it:
        try:
            right = it["choices"][int(it.get("answer_index", 0))]
        except (IndexError, ValueError, TypeError):
            right = ""
        return it.get("question"), right, it.get("explanation", "")
    if "sentence" in it:
        return it.get("sentence"), it.get("answer"), ""
    if "statement" in it:
        return it.get("statement"), "True" if it.get("answer") else "False", it.get("explanation", "")
    if "front" in it:
        return it.get("front"), it.get("back"), ""
    if "problem" in it:
        return it.get("problem"), it.get("answer"), " → ".join(it.get("steps") or [])
    return None, None, ""


def add_mistakes(review, results, subject=""):
    added = 0
    with _lock:
        d = _read()
        book = d.setdefault("mistakes", [])
        seen = {m["q"] for m in book}
        for it, ok in zip(review.get("items") or [], results or []):
            if ok:
                continue
            q, right, why = _as_mistake(it)
            if not q or q in seen:
                continue
            book.append({"id": uuid.uuid4().hex[:8], "q": str(q)[:600], "right": str(right or "")[:400],
                         "why": str(why or "")[:800], "source": str(it.get("source") or "")[:120],
                         "subject": subject, "review": review.get("title", ""), "added": date.today().isoformat()})
            seen.add(q)
            added += 1
        d["mistakes"] = book[-500:]
        _write(d)
    return added


def mistakes(subject=None):
    book = _read().get("mistakes", [])
    if subject:
        book = [m for m in book if (m.get("subject") or "").lower() == subject.lower()]
    return book[::-1]


def mistake_done(mid):
    with _lock:
        d = _read()
        d["mistakes"] = [m for m in d.get("mistakes", []) if m["id"] != mid]
        _write(d)
    return mistakes()


# ---------------------------------------------------------------- 73 grade tracker
def grades():
    return [{**c, **grade_calc(c, c.get("target", 75))} for c in _read().get("grades", [])]


def _num(v):
    try:
        return None if v in (None, "") else float(v)
    except (TypeError, ValueError):
        return None


def grade_save(course):
    name = str(course.get("name") or "").strip()[:60]
    if not name:
        return {"error": "Type the subject name."}
    parts = [{"name": str(p.get("name") or "Part")[:40], "weight": _num(p.get("weight")) or 0, "score": _num(p.get("score"))}
             for p in course.get("parts") or []]
    if abs(sum(p["weight"] for p in parts) - 100) > 0.5:
        return {"error": f"The weights add up to {sum(p['weight'] for p in parts):g}%, they should add up to 100%."}
    c = {"id": course.get("id") or uuid.uuid4().hex[:8], "name": name, "parts": parts,
         "target": _num(course.get("target")) or 75}
    with _lock:
        d = _read()
        d["grades"] = [g for g in d.get("grades", []) if g["id"] != c["id"]] + [c]
        _write(d)
    return {"grades": grades()}


def grade_remove(cid):
    with _lock:
        d = _read()
        d["grades"] = [g for g in d.get("grades", []) if g["id"] != cid]
        _write(d)
    return {"grades": grades()}


def grade_calc(course, target=75):
    """current grade so far, and the average score you need on what's left (e.g. the final) to reach `target`"""
    done = [p for p in course.get("parts", []) if p.get("score") is not None]
    left = [p for p in course.get("parts", []) if p.get("score") is None]
    w_done = sum(p["weight"] for p in done)
    w_left = sum(p["weight"] for p in left)
    earned = sum(p["weight"] * p["score"] / 100 for p in done)
    current = round(100 * earned / w_done, 1) if w_done else None
    if not w_left:
        return {"current": current, "final": round(earned, 1), "needed": None, "left": [],
                "message": f"Final grade: {earned:.1f}%."}
    needed = round(100 * (target - earned) / w_left, 1)
    names = ", ".join(p["name"] for p in left)
    if needed > 100:
        msg = f"Even 100% on {names} gets you {earned + w_left:.1f}%. {target:g}% isn't reachable, but every point still counts."
    elif needed <= 0:
        msg = f"You already have {target:g}% locked in. 🎉"
    else:
        msg = f"You need an average of {needed:g}% on {names} to finish with {target:g}%."
    return {"current": current, "final": None, "needed": needed, "left": [p["name"] for p in left], "message": msg}


# ---------------------------------------------------------------- 76 citations
def _split_name(full):
    full = re.sub(r"\s+", " ", str(full or "")).strip()
    if not full:
        return None
    if "," in full:
        last, first = [x.strip() for x in full.split(",", 1)]
    else:
        bits = full.split(" ")
        last, first = bits[-1], " ".join(bits[:-1])
    return first, last


def _apa_authors(names):
    ps = [p for p in map(_split_name, names) if p]
    fmt = [f"{last}, " + " ".join(f"{w[0]}." for w in re.split(r"[\s-]+", first) if w) if first else last for first, last in ps]
    fmt = [f.strip().rstrip(",") for f in fmt]
    if not fmt:
        return ""
    if len(fmt) == 1:
        return fmt[0]
    if len(fmt) > 20:
        fmt = fmt[:19] + ["...", fmt[-1]]
    return ", ".join(fmt[:-1]) + ", & " + fmt[-1]


def _mla_authors(names):
    ps = [p for p in map(_split_name, names) if p]
    if not ps:
        return ""
    first = f"{ps[0][1]}, {ps[0][0]}".strip(", ")
    if len(ps) == 1:
        return first
    if len(ps) == 2:
        return f"{first}, and {ps[1][0]} {ps[1][1]}".strip()
    return f"{first}, et al."


def cite(f, style="apa"):
    """f: {kind web|book|article, authors[], year, date, title, site, publisher, journal, volume, issue, pages, url, edition, accessed}"""
    kind = f.get("kind") or ("web" if f.get("url") and not f.get("journal") else "book")
    title = (f.get("title") or "Untitled").strip().rstrip(".")
    year = str(f.get("year") or (f.get("date") or "")[:4] or "").strip()
    url = f.get("url") or ""
    if style == "mla":
        a = _mla_authors(f.get("authors") or [])
        lead = (a if a.endswith(".") else f"{a}.") + " " if a else ""
        if kind == "book":
            ed = f"{f['edition']} ed., " if f.get("edition") else ""
            return f"{lead}*{title}*. {ed}{f.get('publisher') or 'n.p.'}, {year or 'n.d.'}."
        if kind == "article":
            vol = ", ".join(x for x in [f"vol. {f['volume']}" if f.get("volume") else "", f"no. {f['issue']}" if f.get("issue") else "",
                                         year, f"pp. {f['pages']}" if f.get("pages") else ""] if x)
            return f"{lead}\"{title}.\" *{f.get('journal', '')}*, {vol}." + (f" {url}." if url else "")
        site = f.get("site") or ""
        return (f"{lead}\"{title}.\" " + (f"*{site}*, " if site else "") + (f"{f.get('date') or year}, " if (f.get("date") or year) else "")
                + f"{re.sub(r'^https?://', '', url)}." + (f" Accessed {f['accessed']}." if f.get("accessed") else ""))
    a = _apa_authors(f.get("authors") or [])
    when = f"({f.get('date') if kind == 'web' and f.get('date') else year or 'n.d.'})"
    if kind == "book":
        ed = f" ({f['edition']} ed.)" if f.get("edition") else ""
        return f"{a or title} {when}. " + (f"*{title}*{ed}. " if a else "") + f"{f.get('publisher') or ''}.".replace(" .", ".")
    if kind == "article":
        vi = f"*{f['volume']}*" + (f"({f['issue']})" if f.get("issue") else "") if f.get("volume") else ""
        return (f"{a or title} {when}. " + (f"{title}. " if a else "") + f"*{f.get('journal', '')}*"
                + (f", {vi}" if vi else "") + (f", {f['pages']}" if f.get("pages") else "") + "." + (f" {url}" if url else ""))
    site = f.get("site") or ""
    return f"{a or title} {when}. " + (f"*{title}*. " if a else "") + (f"{site}. " if site and site != a else "") + url


def _meta(html):
    """title / authors / date / site from a web page's <meta> tags"""
    def get(*names):
        for n in names:
            m = re.search(rf'<meta[^>]+(?:name|property)=["\']{re.escape(n)}["\'][^>]*content=["\']([^"\']+)', html, re.I) or \
                re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:name|property)=["\']{re.escape(n)}["\']', html, re.I)
            if m:
                return m.group(1).strip()
        return ""
    authors = re.findall(r'<meta[^>]+name=["\']citation_author["\'][^>]*content=["\']([^"\']+)', html, re.I)
    if not authors and get("author"):
        authors = [a.strip() for a in re.split(r",| and ", get("author")) if a.strip()]
    t = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return {"title": get("citation_title", "og:title", "twitter:title") or (t.group(1).strip() if t else ""),
            "authors": authors, "date": (get("citation_publication_date", "article:published_time", "date", "dc.date") or "")[:10],
            "site": get("og:site_name", "citation_journal_title"), "journal": get("citation_journal_title"),
            "volume": get("citation_volume"), "issue": get("citation_issue"),
            "pages": "-".join(x for x in [get("citation_firstpage"), get("citation_lastpage")] if x)}


def cite_lookup(text, fetch=None, ask=None, today=None):
    text = str(text or "").strip()
    if not text:
        return {"error": "Paste a link or type a book title."}
    if re.match(r"https?://", text):
        if fetch is None:
            import urllib.request
            def fetch(u):
                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=10) as r:
                    return r.read(400_000).decode("utf-8", "ignore")
        try:
            f = _meta(fetch(text))
        except Exception as e:  # noqa: BLE001
            return {"error": f"Couldn't open that link ({e})."}
        f.update(url=text, kind="article" if f.get("journal") else "web",
                 accessed=(today or date.today()).strftime("%d %b. %Y"))
        if not f["site"]:
            f["site"] = re.sub(r"^www\.", "", text.split("/")[2])
        f["year"] = f["date"][:4]
    else:
        f = _ask_json("Give the real bibliographic details of this book. If you're not sure it exists, set title to \"\". "
                      'JSON only: {"authors": ["First Last"], "year": "", "title": "", "publisher": "", "edition": ""}'
                      f"\n\nBOOK: {text[:200]}", ask)
        if not f.get("title"):
            return {"error": "I couldn't find that book. Type the details yourself."}
        f["kind"] = "book"
    return {"fields": f, "apa": cite(f, "apa"), "mla": cite(f, "mla")}


# ---------------------------------------------------------------- 77 essay coach
def essay_outline(topic, kind="argumentative", ask=None):
    topic = str(topic or "").strip()
    if not topic:
        return {"error": "Type the essay topic or question."}
    d = _ask_json(f"Make a {kind} essay outline for a college student. Topic: {topic[:400]}. A clear one-sentence thesis, "
                  "3 main points, each with 2 kinds of evidence to look for (no made-up statistics), one counter-argument with "
                  'a reply, and a conclusion idea. JSON only: {"thesis": "", "points": [{"point": "", "evidence": ["", ""]}], '
                  '"counter": {"argument": "", "reply": ""}, "conclusion": ""}', ask)
    if not d.get("thesis"):
        return {"error": "The AI didn't return an outline. Try again."}
    return d


def essay_feedback(outline, draft, ask=None):
    draft = str(draft or "").strip()
    if len(draft.split()) < 40:
        return {"error": "Paste at least a paragraph of your draft (40+ words)."}
    d = _ask_json("You are a kind but honest writing tutor. Check this draft against its outline. Score it 1-10. Say what "
                  "works, then the 3-5 most important fixes, each quoting the exact sentence to change and a better version. "
                  'JSON only: {"score": 0, "thesis_clear": true, "strengths": [""], "fixes": [{"quote": "", "why": "", '
                  '"better": ""}], "next_step": ""}'
                  f"\n\nOUTLINE: {json.dumps(outline or {}, ensure_ascii=False)[:3000]}\n\nDRAFT:\n{draft[:12000]}", ask)
    if "score" not in d:
        return {"error": "The AI didn't return feedback. Try again."}
    return d


# ---------------------------------------------------------------- 67 handwritten notes -> notebook (duplicates merged)
def notebook(subject=None):
    notes = _read().get("notebook", [])
    if subject:
        notes = [n for n in notes if (n.get("subject") or "").lower() == subject.lower()]
    return sorted(notes, key=lambda n: n.get("updated", ""), reverse=True)


def _merge_lines(a, b):
    out, seen = [], set()
    for line in (a or "").splitlines() + (b or "").splitlines():
        k = re.sub(r"[^a-z0-9=+\-*/^().]", "", line.lower())
        if not line.strip():
            continue
        if k and k in seen:
            continue
        seen.add(k)
        out.append(line.rstrip())
    return "\n".join(out)


def save_note(topic, subject, text, formulas=None, source=""):
    """a new note joins the note on the same topic (same subject) instead of making a duplicate"""
    with _lock:
        d = _read()
        book = d.setdefault("notebook", [])
        same = next((n for n in book if _similar(n["topic"], topic)
                     and (n.get("subject") or "").lower() == (subject or "").lower()), None)
        if same:
            same["text"] = _merge_lines(same["text"], text)
            same["formulas"] = list(dict.fromkeys((same.get("formulas") or []) + (formulas or [])))
            same["sources"] = list(dict.fromkeys((same.get("sources") or []) + ([source] if source else [])))
            same["updated"] = date.today().isoformat()
            note, merged = same, True
        else:
            note = {"id": uuid.uuid4().hex[:8], "topic": str(topic)[:100], "subject": subject or "", "text": text,
                    "formulas": formulas or [], "sources": [source] if source else [], "updated": date.today().isoformat()}
            book.append(note)
            merged = False
        _write(d)
    return {"note": note, "merged": merged}


def photo_notes(path, subject="", ocr=None, ask=None):
    if ocr is None:
        import academic
        ocr = academic.read_image_text
    raw = ocr(path)
    if not (raw or "").strip():
        return {"error": "I couldn't read any writing in that photo. Try a brighter, sharper picture."}
    d = _ask_json("These are a student's handwritten notes (read from a photo, so fix obvious reading mistakes). Turn them "
                  "into clean study notes: short bullet points ('- '), keep every number and formula exactly. Name the "
                  "topic in 2-5 words." + (f" The subject is {subject}." if subject else " Guess the subject.") +
                  ' JSON only: {"topic": "", "subject": "", "notes": "- point\\n- point", "formulas": ["V = Q/A"]}'
                  f"\n\nNOTES:\n{raw[:8000]}", ask)
    if not d.get("notes"):
        return {"error": "Couldn't turn that into notes. Try again."}
    return {**save_note(d.get("topic") or "Notes", subject or d.get("subject") or "", d["notes"],
                        [str(x) for x in d.get("formulas") or []], os.path.basename(path)), "raw": raw}


def merge_duplicates():
    """join notes about the same topic (e.g. "Hardy Cross" and "Hardy Cross method")"""
    with _lock:
        d = _read()
        book, out, merged = d.get("notebook", []), [], 0
        for n in sorted(book, key=lambda n: n.get("updated", "")):
            same = next((o for o in out if _similar(o["topic"], n["topic"])
                         and (o.get("subject") or "").lower() == (n.get("subject") or "").lower()), None)
            if same:
                same["text"] = _merge_lines(same["text"], n["text"])
                same["formulas"] = list(dict.fromkeys((same.get("formulas") or []) + (n.get("formulas") or [])))
                same["sources"] = list(dict.fromkeys((same.get("sources") or []) + (n.get("sources") or [])))
                same["updated"] = max(same.get("updated", ""), n.get("updated", ""))
                merged += 1
            else:
                out.append(n)
        d["notebook"] = out
        _write(d)
    return {"merged": merged, "notes": notebook()}


def note_remove(nid):
    with _lock:
        d = _read()
        d["notebook"] = [n for n in d.get("notebook", []) if n["id"] != nid]
        _write(d)
    return notebook()


# ---------------------------------------------------------------- 70 video chapters
_TIME = re.compile(r"\[(\d+(?::\d\d){1,2})\]")


def _secs(clock):
    s = 0
    for part in clock.split(":"):
        s = s * 60 + int(part)
    return s


def chapters(file_id, pages=None, ask=None):
    d = _read()
    if file_id in d.get("chapters", {}):
        return {"chapters": d["chapters"][file_id]}
    if pages is None:
        import academic
        pages = academic.file_pages(file_id)
    lines = []
    for p in pages or []:
        for line in str(p).splitlines():
            if _TIME.search(line):
                lines.append(line.strip()[:160])
    if not lines:
        return {"error": "Only video and audio lectures have chapters (it needs the times)."}
    step = max(1, len(lines) // 300)
    res = _ask_json("Split this lecture transcript into 4-12 chapters where the topic changes. Use the [mm:ss] time where "
                    'each chapter starts. JSON only: {"chapters": [{"time": "mm:ss", "title": "short title"}]}'
                    "\n\nTRANSCRIPT:\n" + "\n".join(lines[::step]), ask)
    out = []
    for c in res.get("chapters") or []:
        t = str(c.get("time") or "").strip("[]")
        if re.fullmatch(r"\d+(:\d\d){1,2}", t) and c.get("title"):
            out.append({"time": t, "seconds": _secs(t), "title": str(c["title"])[:80]})
    out.sort(key=lambda c: c["seconds"])
    if not out:
        return {"error": "Couldn't find chapters. Try again."}
    with _lock:
        d = _read()
        d.setdefault("chapters", {})[file_id] = out
        _write(d)
    return {"chapters": out}


# ---------------------------------------------------------------- 65 formula sheet per subject
DEFAULT_SUBJECTS = ["Hydrology", "RCD", "Steel"]


def subjects(files):
    have = [f.get("subject") for f in files if f.get("subject")]
    return list(dict.fromkeys(have + DEFAULT_SUBJECTS))


def formula_for_subject(subject, files, make=None):
    ids = [f["id"] for f in files if (f.get("subject") or "").lower() == (subject or "").lower()]
    notes = [f for n in notebook(subject) for f in n.get("formulas") or []]
    if not ids and not notes:
        return {"error": f"No {subject} files yet. In Library, set a file's subject to {subject} (or add handwritten notes)."}
    if make is None:
        import studygame
        make = studygame.formula_sheet
    sheet = {"topics": [], "count": 0}
    if ids:
        try:
            sheet = make(ids)
        except ValueError as e:
            if not notes:
                return {"error": str(e)}
    if notes:
        sheet["topics"] = sheet.get("topics", []) + [{"topic": "From your handwritten notes",
                                                       "formulas": [{"name": "", "formula": f, "symbols": "", "source": "Notebook"} for f in notes]}]
        sheet["count"] = sheet.get("count", 0) + len(notes)
    sheet["title"] = f"{subject} formula sheet"
    sheet["subject"] = subject
    sheet["made"] = date.today().isoformat()
    with _lock:
        d = _read()
        d.setdefault("formulas", {})[subject] = sheet
        _write(d)
    return sheet


def formula_saved():
    return _read().get("formulas", {})


# ---------------------------------------------------------------- 78 sort USB files by subject
KEYWORDS = {"Hydrology": ["hydrology", "hydro", "rainfall", "runoff", "hydrograph", "watershed", "infiltration", "evaporation"],
            "RCD": ["rcd", "reinforced", "concrete", "rebar", "aci", "usd", "flexure"],
            "Steel": ["steel", "aisc", "bolted", "weld", "welded", "column", "truss", "lrfd", "asd"],
            "Hydraulics": ["hydraulics", "fluid", "bernoulli", "pipe", "manning", "weir"],
            "Surveying": ["surveying", "traverse", "leveling", "stadia", "geodetic"],
            "Geotech": ["geotech", "soil", "foundation", "consolidation", "bearing"],
            "Math": ["calculus", "algebra", "differential", "integral", "trigonometry", "math"]}


def guess_subject(path, known=()):
    words = _W.findall(re.sub(r"([a-z])([A-Z])", r"\1 \2", path or "").lower())
    text = " ".join(words)
    for s in known:                                        # your own subject names win ("Structural Theory 2")
        sw = _words(s)
        if sw and sw <= set(words):
            return s
    best, hits = "", 0
    for s, keys in KEYWORDS.items():
        n = sum(1 for k in keys if re.search(rf"\b{k}\b", text))
        if n > hits:
            best, hits = s, n
    if best:
        return next((k for k in known if k.lower() == best.lower()), best)
    return ""


def usb_new(files, library_names=()):
    """the files on a drive that weren't imported before (by name + size), each with a guessed subject"""
    seen = set(_read().get("usb_seen", [])) | {n.lower() for n in library_names}
    return [f for f in files if f"{f['name']}|{f['size']}".lower() not in seen and f["name"].lower() not in seen]


def usb_mark(files):
    with _lock:
        d = _read()
        d["usb_seen"] = list(dict.fromkeys(d.get("usb_seen", []) + [f"{f['name']}|{f['size']}".lower() for f in files]))[-3000:]
        _write(d)


def exam_state():
    return {"on": False, "exams": [], "sleep": "22:30", **_read().get("exam", {})}


def exam_save(state):
    exams = [{"subject": str(e.get("subject") or "").strip()[:40], "date": str(e.get("date") or "")[:10]}
             for e in (state or {}).get("exams") or [] if e.get("subject") and re.fullmatch(r"\d{4}-\d\d-\d\d", str(e.get("date") or ""))]
    sleep = str((state or {}).get("sleep") or "22:30")[:5]
    with _lock:
        d = _read()
        d["exam"] = {"on": bool((state or {}).get("on")), "exams": exams, "sleep": sleep}
        _write(d)
    return d["exam"]


# ---------------------------------------------------------------- 79 exam week
def exam_active(state, today=None):
    today = today or date.today()
    exams = [e for e in (state or {}).get("exams", []) if e.get("date")]
    if not (state or {}).get("on") or not exams:
        return False
    last = max(date.fromisoformat(e["date"]) for e in exams)
    return today <= last and (last - today).days <= 14


def exam_plan(exams, today=None, sleep="22:30"):
    today = today or date.today()
    exams = sorted((e for e in exams if e.get("date") and date.fromisoformat(e["date"]) >= today), key=lambda e: e["date"])
    if not exams:
        return []
    last = date.fromisoformat(exams[-1]["date"])
    days = []
    d = today
    while d <= last and len(days) < 15:
        nxt = next(e for e in exams if date.fromisoformat(e["date"]) >= d)
        gap = (date.fromisoformat(nxt["date"]) - d).days
        s = nxt["subject"]
        if gap == 0:
            blocks = [f"🎯 {s} exam today: light review of your formula sheet only", "🍽️ Eat a real breakfast", "😌 After: rest, no cramming"]
            focus = f"{s} exam today"
        elif gap == 1:
            blocks = [f"📐 {s}: formula sheet + mistake notebook", f"📝 One short {s} practice exam", f"🛌 Bed by {sleep}: sleep helps memory"]
            focus = f"{s} tomorrow, so light review and early sleep"
        else:
            blocks = [f"📖 Morning: {s}, hardest topics first", f"📝 Afternoon: {s} practice exam (timed)",
                      "🃏 Evening: flashcards + mistakes", f"🛌 Bed by {sleep}"]
            focus = f"{s} in {gap} days"
        days.append({"date": d.isoformat(), "weekday": d.strftime("%a"), "focus": focus, "subject": s, "blocks": blocks})
        d += timedelta(days=1)
    return days


EXAM_CHAT_NOTE = ("It's the user's exam week: keep replies short, calm and encouraging, no long tangents or new projects, "
                  "and nudge them back to studying or to sleep if it's late.")


# ---------------------------------------------------------------- 80 curiosity corner
def fact_of_day(subject_list, today=None, ask=None):
    today = (today or date.today()).isoformat()
    d = _read()
    f = d.get("fact")
    if f and f.get("date") == today:
        return f
    subs = subject_list or ["engineering"]
    subject = subs[date.fromisoformat(today).toordinal() % len(subs)]
    old = [x.get("fact", "")[:60] for x in d.get("facts_seen", [])][-20:]
    res = _ask_json(f"Tell one surprising, TRUE and well-known fact related to {subject} that a college student would "
                    "enjoy (history, a famous structure, a real-world use). 1-2 sentences. Not one of these: "
                    f'{"; ".join(old)}. JSON only: {{"fact": "", "subject": "{subject}"}}', ask, temperature=0.9)
    if not res.get("fact"):
        return {"date": today, "subject": subject, "fact": ""}
    f = {"date": today, "subject": res.get("subject") or subject, "fact": str(res["fact"])[:400]}
    with _lock:
        d = _read()
        d["fact"] = f
        d["facts_seen"] = (d.get("facts_seen", []) + [f])[-60:]
        _write(d)
    return f


# ---------------------------------------------------------------- 74 pronunciation coach
def pron_coach(expected, heard, missed, language="ja", ask=None):
    missed = [m for m in (missed or []) if m][:6]
    if not missed:
        return None
    import sensei
    name = sensei.LANGS.get(language, language)
    d = _ask_json(f"A learner of {name} tried to say: \"{expected}\". Speech recognition heard: \"{heard}\". These parts "
                  f"were wrong or missing: {', '.join(missed)}. For each, explain how to say it for an English speaker: "
                  "syllables, which sound is tricky, and an English 'sounds like'. Short and friendly. JSON only: "
                  '{"tips": [{"word": "", "syllables": "", "how": "", "sounds_like": ""}], "encourage": ""}', ask)
    tips = [{k: str(t.get(k) or "")[:200] for k in ("word", "syllables", "how", "sounds_like")}
            for t in d.get("tips") or [] if isinstance(t, dict) and t.get("word")]
    return {"tips": tips, "encourage": str(d.get("encourage") or "")[:200]} if tips else None
