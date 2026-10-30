"""
academic.py - Study mode: your lecture files, review materials, research and assignment help.

    data/library/files/      copies of the files you add (PDF, Word, PowerPoint, text)
    data/library/text/       the text read from each file, page by page
    data/library/index.json  list of files (name, type, subject, pages)
    data/library/reviews/    review sets you generated (quizzes, flashcards, ...)
"""
import os
import re
import json
import math
import time
import uuid
import shutil
from collections import Counter

from paths import DATA_DIR

LIB_DIR = os.path.join(DATA_DIR, "library")
FILES_DIR = os.path.join(LIB_DIR, "files")
TEXT_DIR = os.path.join(LIB_DIR, "text")
REVIEWS_DIR = os.path.join(LIB_DIR, "reviews")
INDEX_FILE = os.path.join(LIB_DIR, "index.json")

KINDS = ("lecture", "problems", "solutions", "other")
DOCUMENTS = (".pdf", ".docx", ".pptx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp", ".bmp")
# video / audio lectures: what's said in them is written down (Whisper on this PC) and used like any other file
MEDIA = (".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".wmv", ".mp3", ".m4a", ".wav", ".ogg", ".flac")
SUPPORTED = DOCUMENTS + MEDIA
MEDIA_PART_SECONDS = 300                       # a video lecture becomes one "page" per 5 minutes, with times
STUDY_MODEL = "smart"          # local model role (llm.py)       # bigger model for studying & research
MAX_SOURCE_CHARS = 60000                                                  # how much of your files goes to the AI at once

REVIEW_TYPES = {
    "fill_blanks": "Fill in the blanks",
    "mcq": "Multiple choice quiz",
    "flashcards": "Flashcards",
    "problems": "Practice problems with worked solutions",
    "true_false": "True or false",
    "summary": "Summary reviewer (key points)",
}


def _client():
    import pinakamain
    return pinakamain.get_client()


def _dirs():
    for d in (FILES_DIR, TEXT_DIR, REVIEWS_DIR):
        os.makedirs(d, exist_ok=True)


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


# ====================================================================
# Reading files
# ====================================================================
def extract_pages(path):
    """Return a list of page texts. PDF = real pages, PowerPoint = slides, Word/text = ~3000-character parts."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        from pypdf import PdfReader
        return [(p.extract_text() or "").strip() for p in PdfReader(path).pages]
    if ext == ".pptx":
        from pptx import Presentation
        slides = []
        for slide in Presentation(path).slides:
            parts = [sh.text_frame.text for sh in slide.shapes if getattr(sh, "has_text_frame", False) and sh.text_frame.text]
            slides.append("\n".join(parts).strip())
        return slides
    if ext == ".docx":
        import docx
        d = docx.Document(path)
        text = "\n".join(p.text for p in d.paragraphs)
        for table in d.tables:
            for row in table.rows:
                text += "\n" + " | ".join(c.text for c in row.cells)
        return _split(text)
    if ext in IMAGE_EXT:
        return _split(read_image_text(path)) or [""]
    if ext in (".txt", ".md"):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return _split(f.read())
    raise ValueError(f"I can't read {ext} files yet. Use PDF, Word, PowerPoint or text.")


IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".bmp")


def read_image_text(path):
    """OCR: the vision AI reads all the text in a photo/screenshot (notes, a whiteboard, a textbook page)."""
    import base64
    try:
        from PIL import Image
        import io
        img = Image.open(path).convert("RGB")
        img.thumbnail((1600, 1600))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=88)
        data = base64.b64encode(buf.getvalue()).decode()
    except ImportError:
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
    r = _client().chat.completions.create(model="vision", messages=[{"role": "user", "content": [
        {"type": "text", "text": "Copy out ALL the text in this image exactly, keeping line breaks and lists. "
                                 "Write tables as rows with ' | '. Describe any diagram in one line in [brackets]. "
                                 "Only the text - no comments."},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}}]}])
    return (r.choices[0].message.content or "").strip()


def _split(text, size=3000):
    text = text.strip()
    if not text:
        return []
    parts, buf = [], ""
    for para in re.split(r"\n\s*\n", text):
        if len(buf) + len(para) > size and buf:
            parts.append(buf.strip()); buf = ""
        buf += para + "\n\n"
    if buf.strip():
        parts.append(buf.strip())
    return parts


# ====================================================================
# Library
# ====================================================================
def list_files():
    return _read_json(INDEX_FILE, {"files": []})["files"]


def _clock(seconds):
    s = int(seconds)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def transcribe_media(path, progress=lambda pct, text: None):
    """a video / audio lecture -> pages of what was said, one per 5 minutes, each line starting with its time"""
    import stt
    from faster_whisper import decode_audio
    progress(0.02, "Reading the sound from the video…")
    audio = decode_audio(path, sampling_rate=16000)
    total = max(1.0, len(audio) / 16000)
    segments, _ = stt.load().transcribe(audio, beam_size=1, vad_filter=True, condition_on_previous_text=False)
    parts = {}                                          # 5-minute part number -> its lines
    for seg in segments:
        text = seg.text.strip()
        if text:
            parts.setdefault(int(seg.start // MEDIA_PART_SECONDS), []).append(f"[{_clock(seg.start)}] {text}")
        progress(min(0.98, seg.end / total), f"Writing down what's said… {_clock(seg.end)} of {_clock(total)}")
    return ["\n".join(parts[k]) for k in sorted(parts)]


def is_media(name):
    return os.path.splitext(name)[1].lower() in MEDIA


def add_file(src_path, kind="lecture", subject="", progress=lambda pct, text: None):
    """Copy a file into the library and read its text. Video / audio lectures aren't copied (they're big): what's
    said in them is written down and the library remembers where the video is."""
    _dirs()
    name = os.path.basename(src_path)
    ext = os.path.splitext(name)[1].lower()
    if ext not in SUPPORTED:
        raise ValueError(f"{name}: only PDF, Word (.docx), PowerPoint (.pptx), text files, photos/screenshots and "
                         "video or audio lectures can be added.")
    file_id = uuid.uuid4().hex[:10]
    if ext in MEDIA:
        pages = transcribe_media(src_path, progress)
        if not any(p.strip() for p in pages):
            raise ValueError(f"{name}: no speech was heard in it.")
        _write_json(os.path.join(TEXT_DIR, f"{file_id}.json"), pages)
        entry = {"id": file_id, "name": name, "kind": kind if kind in KINDS else "other", "subject": (subject or "").strip(),
                 "pages": len(pages), "chars": sum(len(p) for p in pages), "added": time.strftime("%Y-%m-%d %H:%M"),
                 "scanned": False, "video": True, "source": os.path.abspath(src_path)}
        index = _read_json(INDEX_FILE, {"files": []})
        index["files"].append(entry)
        _write_json(INDEX_FILE, index)
        return entry
    dest = os.path.join(FILES_DIR, f"{file_id}{ext}")
    shutil.copy2(src_path, dest)
    pages = extract_pages(dest)
    _write_json(os.path.join(TEXT_DIR, f"{file_id}.json"), pages)
    chars = sum(len(p) for p in pages)
    entry = {"id": file_id, "name": name, "kind": kind if kind in KINDS else "other", "subject": (subject or "").strip(),
             "pages": len(pages), "chars": chars, "added": time.strftime("%Y-%m-%d %H:%M"),
             "scanned": chars < 50 * max(1, len(pages))}       # probably a scan/photo: little or no readable text
    index = _read_json(INDEX_FILE, {"files": []})
    index["files"].append(entry)
    _write_json(INDEX_FILE, index)
    return entry


def remove_file(file_id):
    index = _read_json(INDEX_FILE, {"files": []})
    entry = next((f for f in index["files"] if f["id"] == file_id), None)
    if not entry:
        return False
    index["files"] = [f for f in index["files"] if f["id"] != file_id]
    _write_json(INDEX_FILE, index)
    for p in (os.path.join(TEXT_DIR, f"{file_id}.json"),
              os.path.join(FILES_DIR, f"{file_id}{os.path.splitext(entry['name'])[1].lower()}")):
        if os.path.exists(p):
            os.remove(p)
    return True


def update_file(file_id, kind=None, subject=None):
    index = _read_json(INDEX_FILE, {"files": []})
    for f in index["files"]:
        if f["id"] == file_id:
            if kind in KINDS:
                f["kind"] = kind
            if subject is not None:
                f["subject"] = subject.strip()
    _write_json(INDEX_FILE, index)


def file_pages(file_id):
    return _read_json(os.path.join(TEXT_DIR, f"{file_id}.json"), [])


def file_path(file_id):
    entry = next((f for f in list_files() if f["id"] == file_id), None)
    if not entry:
        return None
    if entry.get("source"):                     # a video lecture: where it was added from
        return entry["source"]
    return os.path.join(FILES_DIR, f"{file_id}{os.path.splitext(entry['name'])[1].lower()}")


# ====================================================================
# USB drives: find the study materials on them
# ====================================================================
def removable_drives():
    """[{"path", "label"}] - USB sticks / SD cards / phones as drives (Windows), /Volumes (Mac), /media (Linux)"""
    import sys
    found = []
    if sys.platform == "win32":
        import ctypes
        import string
        k = ctypes.windll.kernel32
        mask = k.GetLogicalDrives()
        system = os.environ.get("SystemDrive", "C:").upper()
        for i, letter in enumerate(string.ascii_uppercase):
            if not mask >> i & 1:
                continue
            root = f"{letter}:\\"
            kind = k.GetDriveTypeW(ctypes.c_wchar_p(root))
            if kind != 2 and not (kind == 3 and _is_usb(letter) and f"{letter}:" != system):   # 2 = removable
                continue
            buf = ctypes.create_unicode_buffer(261)
            ok = k.GetVolumeInformationW(ctypes.c_wchar_p(root), buf, 261, None, None, None, None, 0)
            if ok:                                              # an empty card reader slot isn't ready
                found.append({"path": root, "label": f"{buf.value or 'USB drive'} ({letter}:)"})
    else:
        import getpass
        bases = ["/Volumes"] if sys.platform == "darwin" else [f"/media/{getpass.getuser()}", f"/run/media/{getpass.getuser()}", "/media"]
        for base in bases:
            try:
                names = sorted(os.listdir(base))
            except OSError:
                continue
            for n in names:
                p = os.path.join(base, n)
                if os.path.isdir(p) and not os.path.islink(p) and n not in ("Macintosh HD", "Recovery") and p not in [d["path"] for d in found]:
                    found.append({"path": p, "label": n})
    return found


_USB_BUS = {}                                       # drive letter -> on USB? (asking Windows takes a second)


def _is_usb(letter):
    """an external USB hard drive shows as a fixed disk: ask Windows what bus it's on"""
    if letter not in _USB_BUS:
        _USB_BUS[letter] = _ask_bus(letter)
    return _USB_BUS[letter]


def _ask_bus(letter):
    import subprocess
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command",
                              f"(Get-Partition -DriveLetter {letter} | Get-Disk).BusType"],
                             capture_output=True, text=True, timeout=8,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        return "usb" in out.lower()
    except Exception:
        return False


def scan_folder(root, limit=2000, max_depth=6):
    """every study file (documents, video and audio lectures) under a folder or drive, newest first"""
    out, root = [], os.path.abspath(root)
    skip = {"$recycle.bin", "system volume information", "windows", "program files", "program files (x86)", ".trash",
            ".trashes", ".spotlight-v100", ".fseventsd", "node_modules", "__pycache__"}
    for dirpath, dirs, files in os.walk(root):
        depth = dirpath[len(root):].count(os.sep)
        dirs[:] = [d for d in dirs if d.lower() not in skip and not d.startswith(".") and depth < max_depth]
        for n in files:
            ext = os.path.splitext(n)[1].lower()
            if ext not in SUPPORTED or n.startswith("~$") or n.startswith("._"):
                continue
            p = os.path.join(dirpath, n)
            try:
                st = os.stat(p)
            except OSError:
                continue
            if ext in IMAGE_EXT and st.st_size < 30_000:          # tiny pictures are icons, not notes
                continue
            out.append({"path": p, "name": n, "folder": os.path.relpath(dirpath, root), "size": st.st_size,
                        "video": ext in MEDIA, "modified": st.st_mtime})
            if len(out) >= limit:
                return sorted(out, key=lambda f: -f["modified"])
    return sorted(out, key=lambda f: -f["modified"])


def _label(entry, page_no):
    unit = "slide" if entry["name"].lower().endswith(".pptx") else "p." if entry["name"].lower().endswith(".pdf") else "part"
    return f"{entry['name']}, {unit} {page_no}" if unit != "p." else f"{entry['name']}, p. {page_no}"


def source_text(file_ids, limit=MAX_SOURCE_CHARS):
    """The text of the chosen files, labelled with page numbers so the AI can cite them."""
    files = {f["id"]: f for f in list_files()}
    out, used = [], 0
    for fid in file_ids:
        entry = files.get(fid)
        if not entry:
            continue
        out.append(f"===== FILE: {entry['name']} (type: {entry['kind']}{', subject: ' + entry['subject'] if entry['subject'] else ''}) =====")
        for i, page in enumerate(file_pages(fid), start=1):
            if not page:
                continue
            chunk = f"[{_label(entry, i)}]\n{page}\n"
            if used + len(chunk) > limit:
                out.append("[... the rest was cut to fit ...]")
                return "\n".join(out)
            out.append(chunk); used += len(chunk)
    return "\n".join(out)


# ---------- search (simple BM25 keyword ranking over pages) ----------
_WORD = re.compile(r"[a-z0-9]+")
_STOP = set("the a an of to and or in on for is are was were be by with as at it this that from what how why which who".split())


def _tokens(text):
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1]


def search(query, k=6, file_ids=None):
    """Best-matching pages for a question: [{'file', 'page', 'label', 'text', 'score'}]."""
    q = _tokens(query)
    if not q:
        return []
    docs = []
    for entry in list_files():
        if file_ids and entry["id"] not in file_ids:
            continue
        for i, page in enumerate(file_pages(entry["id"]), start=1):
            if page:
                docs.append((entry, i, page, _tokens(page)))
    if not docs:
        return []
    avg = sum(len(d[3]) for d in docs) / len(docs)
    df = Counter(w for d in docs for w in set(d[3]))
    results = []
    for entry, i, page, toks in docs:
        tf = Counter(toks)
        score = 0.0
        for w in q:
            if w in tf:
                idf = math.log(1 + (len(docs) - df[w] + 0.5) / (df[w] + 0.5))
                score += idf * tf[w] * 2.2 / (tf[w] + 1.2 * (0.25 + 0.75 * len(toks) / max(avg, 1)))
        if score > 0:
            results.append({"file": entry["name"], "file_id": entry["id"], "page": i, "label": _label(entry, i),
                            "text": page[:2500], "score": round(score, 3)})
    results.sort(key=lambda r: -r["score"])
    return results[:k]


def search_my_files(query):
    """For the AI's tool: short excerpts with where they came from."""
    hits = search(query, k=4)
    if not hits:
        return "Nothing about that in the user's study files." if list_files() else "The user hasn't added any study files yet."
    return "\n\n".join(f"[{h['label']}]\n{h['text'][:1200]}" for h in hits)


# ====================================================================
# Review materials
# ====================================================================
_REVIEW_FORMATS = {
    "fill_blanks": '{"items": [{"sentence": "A statement with the key term replaced by ____.", "answer": "key term", '
                   '"accept": ["other acceptable answers"], "source": "file, page"}]}',
    "mcq": '{"items": [{"question": "...", "choices": ["A", "B", "C", "D"], "answer_index": 0, '
           '"explanation": "why it is right", "source": "file, page"}]}',
    "flashcards": '{"items": [{"front": "term or question", "back": "definition or answer", "source": "file, page"}]}',
    "problems": '{"items": [{"problem": "full problem statement with numbers", "given": ["given values"], '
                '"steps": ["step 1 with the formula and substitution", "step 2"], "answer": "final answer with units", '
                '"source": "file, page"}]}',
    "true_false": '{"items": [{"statement": "...", "answer": true, "explanation": "...", "source": "file, page"}]}',
    "summary": '{"sections": [{"heading": "topic", "points": ["key point", "formula: ..."], "source": "file, page"}]}',
}


def generate_review(file_ids, review_type="fill_blanks", count=10, difficulty="medium", focus="", time_limit=0):
    """Turn the chosen files into a review set and save it. Returns the saved set.
    difficulty "auto" adapts to how you've been scoring; time_limit (minutes) makes it a timed mock exam."""
    if review_type not in REVIEW_TYPES:
        raise ValueError("Unknown review type.")
    if difficulty == "auto":
        difficulty = auto_difficulty(file_ids)
    material = source_text(file_ids)
    if not material.strip():
        raise ValueError("Those files have no readable text (they may be scanned pictures).")
    count = max(3, min(int(count or 10), 30))
    has_solutions = any(f["kind"] == "solutions" for f in list_files() if f["id"] in file_ids)
    rules = [
        f"Make {count} {REVIEW_TYPES[review_type].lower()} items at {difficulty} difficulty.",
        "Use ONLY facts, definitions, formulas and methods that appear in the material. Do not invent content.",
        "Cover different parts of the material, not just the beginning.",
        "Every item's \"source\" must be the [file, page] label where its content appears.",
        "Every item also gets a \"topic\": a short name (2-4 words) for the concept it tests, e.g. \"shear diagrams\".",
    ]
    if review_type == "problems":
        rules.append("Make problems like the ones in the material but with new numbers. Show every step with the formula, "
                     "substitution and units. " + ("Follow the solution methods shown in the solutions files." if has_solutions else ""))
    if review_type == "fill_blanks":
        rules.append("Blank out exactly one important term, value or formula per sentence, written as ____.")
    if focus:
        rules.append(f"Focus on: {focus}.")
    prompt = ("You are a careful teacher making review material for a student.\n" + "\n".join(f"- {r}" for r in rules)
              + f"\n\nReply with JSON only, in exactly this shape:\n{_REVIEW_FORMATS[review_type]}\n\nMATERIAL:\n{material}")
    r = _client().chat.completions.create(
        model=STUDY_MODEL, messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}, temperature=0.4)
    data = json.loads(r.choices[0].message.content)
    data = _clean_review(review_type, data)
    names = [f["name"] for f in list_files() if f["id"] in file_ids]
    review = {"id": uuid.uuid4().hex[:10], "type": review_type, "type_label": REVIEW_TYPES[review_type],
              "title": f"{REVIEW_TYPES[review_type]}: {', '.join(names)[:80]}", "files": file_ids,
              "difficulty": difficulty, "created": time.strftime("%Y-%m-%d %H:%M"), **data}
    if time_limit:
        review["time_limit"] = max(1, min(240, int(time_limit)))
        review["title"] = "Mock exam: " + review["title"].split(": ", 1)[-1]
    review["srs"] = {"interval": 0, "due": time.strftime("%Y-%m-%d")}
    _dirs()
    _write_json(os.path.join(REVIEWS_DIR, f"{review['id']}.json"), review)
    return review


def _clean_review(review_type, data):
    """Drop malformed items so the window never shows broken questions."""
    if review_type == "summary":
        secs = [s for s in data.get("sections", []) if isinstance(s, dict) and s.get("heading") and isinstance(s.get("points"), list)]
        if not secs:
            raise ValueError("The AI didn't return a usable summary. Try again.")
        return {"sections": secs}
    need = {"fill_blanks": ("sentence", "answer"), "mcq": ("question", "choices"), "flashcards": ("front", "back"),
            "problems": ("problem", "answer"), "true_false": ("statement",)}[review_type]
    items = [i for i in data.get("items", []) if isinstance(i, dict) and all(i.get(k) not in (None, "") for k in need)]
    if review_type == "mcq":
        items = [i for i in items if isinstance(i["choices"], list) and len(i["choices"]) >= 2
                 and isinstance(i.get("answer_index"), int) and 0 <= i["answer_index"] < len(i["choices"])]
    if review_type == "fill_blanks":
        for i in items:
            if "____" not in i["sentence"]:
                i["sentence"] = re.sub(re.escape(str(i["answer"])), "____", i["sentence"], count=1, flags=re.I)
        items = [i for i in items if "____" in i["sentence"]]
    if review_type == "true_false":
        items = [i for i in items if isinstance(i.get("answer"), bool)]
    if not items:
        raise ValueError("The AI didn't return usable questions. Try again or pick different files.")
    return {"items": items}


def check_blank(given, item):
    """Is a fill-in-the-blank answer right? Ignores case, spacing and small typos."""
    def norm(s):
        return re.sub(r"[^a-z0-9.]+", " ", str(s).lower()).strip()
    given = norm(given)
    if not given:
        return False
    for ans in [item.get("answer")] + list(item.get("accept") or []):
        a = norm(ans)
        if not a:
            continue
        if given == a or given.replace(" ", "") == a.replace(" ", ""):
            return True
        if re.findall(r"\d+(?:\.\d+)?", given) != re.findall(r"\d+(?:\.\d+)?", a):
            continue                                   # numbers must match exactly, no "typo" allowed
        if len(a) > 4 and _close(given, a):
            return True
    return False


def _close(a, b):
    """At most one typo per 6 letters."""
    if abs(len(a) - len(b)) > max(1, len(b) // 6):
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= max(1, len(b) // 6)


def list_reviews():
    if not os.path.isdir(REVIEWS_DIR):
        return []
    out = []
    for name in os.listdir(REVIEWS_DIR):
        if name.endswith(".json"):
            r = _read_json(os.path.join(REVIEWS_DIR, name), None)
            if r:
                out.append({k: r.get(k) for k in ("id", "title", "type", "type_label", "created", "difficulty", "subject")}
                           | {"count": len(r.get("items") or r.get("sections") or []), "best": r.get("best"),
                              "due": (r.get("srs") or {}).get("due"), "time_limit": r.get("time_limit")})
    return sorted(out, key=lambda r: r["created"] or "", reverse=True)


def get_review(review_id):
    return _read_json(os.path.join(REVIEWS_DIR, f"{os.path.basename(review_id)}.json"), None)


def save_score(review_id, score, total, results=None):
    """Save an attempt. results = [True/False per item] -> weak-topic tracking. Also schedules the next review."""
    path = os.path.join(REVIEWS_DIR, f"{os.path.basename(review_id)}.json")
    r = _read_json(path, None)
    if not r:
        return None
    r.setdefault("attempts", []).append({"score": score, "total": total, "at": time.strftime("%Y-%m-%d %H:%M")})
    pct = round(100 * score / max(total, 1))
    r["best"] = max(r.get("best") or 0, pct)
    r["srs"] = next_review(r.get("srs"), pct)
    if isinstance(results, list) and r.get("items"):
        _record_topics(r, results)
    _write_json(path, r)
    return r["best"]


# ---- spaced repetition: good score -> wait longer before the next review; bad score -> tomorrow
def next_review(srs, pct, today=None):
    from datetime import date, timedelta
    today = today or date.today()
    prev = int((srs or {}).get("interval") or 0)
    if pct >= 90:
        interval = 3 if prev < 3 else round(prev * 2.5)
    elif pct >= 70:
        interval = 2 if prev < 2 else round(prev * 1.5)
    else:
        interval = 1
    interval = min(interval, 120)
    return {"interval": interval, "due": (today + timedelta(days=interval)).isoformat(), "last_pct": pct}


def due_reviews(today=None):
    from datetime import date
    today = (today or date.today()).isoformat()
    out = []
    for r in list_reviews():
        full = get_review(r["id"]) or {}
        srs = full.get("srs")
        if srs and full.get("type") != "summary" and srs.get("due", "9999") <= today:
            out.append({**r, "due": srs["due"], "interval": srs.get("interval", 0)})
    return out


# ---- weak topics
TOPICS_FILE_NAME = "topics.json"


def _topics_path():
    return os.path.join(LIB_DIR, TOPICS_FILE_NAME)


def _record_topics(review, results):
    stats = _read_json(_topics_path(), {})
    subject = ", ".join(sorted({f.get("subject") or "" for f in list_files() if f["id"] in review.get("files", [])} - {""})) or \
        review.get("subject", "") or "General"
    for item, ok in zip(review["items"], results):
        topic = (item.get("topic") or "").strip().lower()
        if not topic:
            continue
        key = f"{subject} · {topic}"
        st = stats.setdefault(key, {"right": 0, "total": 0, "files": review.get("files", [])})
        st["right"] += 1 if ok else 0
        st["total"] += 1
        st["last"] = time.strftime("%Y-%m-%d")
    _dirs()
    _write_json(_topics_path(), stats)


def topic_stats():
    stats = _read_json(_topics_path(), {})
    rows = [{"topic": k, "right": v["right"], "total": v["total"], "pct": round(100 * v["right"] / max(v["total"], 1)),
             "last": v.get("last", ""), "files": v.get("files", [])} for k, v in stats.items()]
    return sorted(rows, key=lambda x: (x["pct"], -x["total"]))


def weak_topics(min_attempts=2, below=70):
    return [t for t in topic_stats() if t["total"] >= min_attempts and t["pct"] < below]


def auto_difficulty(file_ids=None):
    """Recent scores on reviews from these files -> easy / medium / hard."""
    pcts = []
    for r in list_reviews():
        full = get_review(r["id"]) or {}
        if file_ids and not set(file_ids) & set(full.get("files", [])):
            continue
        pcts += [round(100 * a["score"] / max(a["total"], 1)) for a in full.get("attempts", [])[-3:]]
    if not pcts:
        return "medium"
    avg = sum(pcts[-6:]) / len(pcts[-6:])
    return "hard" if avg >= 85 else "easy" if avg < 60 else "medium"


def weak_topics_review(review_type="mcq", count=10):
    weak = weak_topics()
    if not weak:
        raise ValueError("No weak topics yet - do a few quizzes first, then I'll know what to drill.")
    files = sorted({fid for t in weak[:5] for fid in t.get("files", []) if file_path(fid)})
    focus = ", ".join(t["topic"].split(" · ", 1)[-1] for t in weak[:5])
    if not files:
        files = [f["id"] for f in list_files()][:5]
    return generate_review(files, review_type, count, "auto", focus)


def delete_review(review_id):
    path = os.path.join(REVIEWS_DIR, f"{os.path.basename(review_id)}.json")
    if os.path.exists(path):
        os.remove(path)


# ====================================================================
# Research (web search with sources) and fact-checking
# ====================================================================
_URL = re.compile(r"https?://[^\s\)\]>\"'】]+")


SCHOLARLY = ("scholar.google", "sciencedirect.com", "doi.org", "ncbi.nlm.nih.gov", "pubmed", "springer", "wiley.com",
             "tandfonline.com", "ieeexplore.ieee.org", "jstor.org", "nature.com", "science.org", "sagepub.com",
             "mdpi.com", "frontiersin.org", "plos.org", "acm.org", "researchgate.net", "semanticscholar.org",
             "arxiv.org", "core.ac.uk", "cambridge.org", "oup.com", "academic.oup", "elsevier", "asce", "apa.org",
             "bmj.com", "thelancet.com", "cell.com", "iop.org", "acs.org", "rsc.org", "emerald.com", "ssrn.com",
             ".edu", ".gov", "who.int", "un.org", "worldbank.org", "oecd.org", "psa.gov.ph", "dost.gov.ph")
BLOCKED = ("wikipedia.org", "wikimedia", "fandom.com", "reddit.com", "quora.com", "medium.com", "blogspot.",
           "wordpress.com", "tiktok.com", "facebook.com", "instagram.com", "pinterest.", "brainly", "coursehero",
           "chegg.com", "studocu", "youtube.com", "x.com", "twitter.com")


def is_scholarly(url):
    u = (url or "").lower()
    return any(d in u for d in SCHOLARLY)


def is_blocked(url):
    u = (url or "").lower()
    return any(d in u for d in BLOCKED)


def _search_queries(question):
    """Ask the local AI for 2 short academic search queries (falls back to the question itself)."""
    try:
        r = _client().chat.completions.create(model="chat", response_format={"type": "json_object"}, temperature=0,
            messages=[{"role": "user", "content": "Turn this into 2 short academic database search queries (3-7 "
                       "keywords each, English, no quotes). Reply as JSON: {\"queries\": [\"...\", \"...\"]}\n\n"
                       + question[:1500]}])
        qs = [q for q in json.loads(r.choices[0].message.content).get("queries", []) if isinstance(q, str) and q.strip()]
        if qs:
            return qs[:2]
    except Exception as e:
        print(f"[research] query step skipped: {e}")
    return [re.sub(r"\s+", " ", question)[:200]]


def research(question, fact_check=False, n_papers=8):
    """Find real papers (OpenAlex/Crossref), then the LOCAL AI answers only from them, with APA 7th edition citations."""
    import scholar
    if not question.strip():
        raise ValueError("Type a question or the text to check.")
    works = scholar.with_citations(scholar.find_papers(_search_queries(question), n_papers))
    if not works:
        return {"answer": "I couldn't find academic papers about this. Try different or more specific words.",
                "sources": [], "fact_check": bool(fact_check), "question": question, "style": "APA 7th edition"}
    papers = "\n\n".join(f"PAPER {i}: cite as {w['cite']}\nTitle: {w['title']}\nPublished in: {w['venue'] or w['type']}"
                          f"\nAbstract: {w['abstract'][:1500] or '(no abstract)'}" for i, w in enumerate(works, 1))
    if fact_check:
        task = ("Fact-check the TEXT using ONLY the papers below. Split it into separate claims. For each claim write "
                "Supported, Disputed, or Not enough evidence, a one-line reason, and the APA in-text citation(s). "
                "End with an overall verdict.\n\nTEXT:\n" + question)
    else:
        task = ("Answer the QUESTION for a university student using ONLY the papers below. Give the key findings "
                "clearly, and say where papers disagree or where the evidence is limited.\n\nQUESTION:\n" + question)
    task += ("\n\nRules: every fact must come from these papers. After each fact put the paper's APA 7th edition "
             "in-text citation exactly as given (e.g. (Kim et al., 2002)). Never invent sources, numbers or citations. "
             "Don't write a reference list - the app adds it. Use markdown.\n\n" + papers)
    r = _client().chat.completions.create(model=STUDY_MODEL, messages=[{"role": "user", "content": task}], temperature=0.2)
    answer = (r.choices[0].message.content or "").strip()
    answer = re.split(r"\n\s*(?:#+\s*)?\**\s*(?:References|Reference List|Sources)\s*:?\**\s*\n", answer, maxsplit=1, flags=re.I)[0]
    used = [w for w in works if w["cite"] in answer] or works
    sources = [{"apa": w["apa"], "apa_md": w["apa_md"], "title": w["title"], "url": f"https://doi.org/{w['doi']}" if w["doi"] else w["url"],
                "cite": w["cite"], "scholarly": True, "cited_by": w["cited_by"], "database": w["source"]} for w in used]
    unknown = sorted(set(re.findall(r"\(([A-Z][^()]{1,60}?,\s*(?:\d{4}[a-z]?|n\.d\.))\)", answer)) -
                     {w["cite"].strip("()") for w in works})
    return {"answer": answer.strip(), "sources": sources, "fact_check": bool(fact_check), "question": question,
            "unverified": unknown, "style": "APA 7th edition", "dropped": 0}


# ====================================================================
# Assignment help
# ====================================================================
ASSIST_MODES = {
    "explain": "Explain the concepts needed and guide the student step by step, asking them to try each step. "
               "Don't give the final answer straight away.",
    "hints": "Give only short hints, one per step, without solving it.",
    "check": "Check the student's answer. Say exactly where it is right or wrong, why, and how to fix it. "
             "Don't rewrite the whole solution unless it is completely wrong.",
    "solve": "Show a complete worked solution with every step, formula, substitution and unit, then a short "
             "explanation of the method so the student can do similar problems.",
}


def assignment_help(question, mode="explain", my_answer="", file_ids=None):
    if not question.strip():
        raise ValueError("Paste the assignment question first.")
    context = ""
    hits = search(question, k=4, file_ids=file_ids or None) if list_files() else []
    if hits:
        context = ("\n\nRelevant parts of the student's own lecture files (use their methods and notation, "
                   "and cite them like (file, page)):\n" + "\n\n".join(f"[{h['label']}]\n{h['text'][:1800]}" for h in hits))
    prompt = (f"You are a patient tutor helping a university student with an assignment. {ASSIST_MODES.get(mode, ASSIST_MODES['explain'])} "
              "Use clear headings and numbered steps. If the question is unclear or missing data, say what's missing. "
              "Format all mathematical equations, vector notations, formulas, and expressions using standard LaTeX enclosed in delimiters: "
              "write inline math like $x^2 + y^2 = r^2$ or $\\mathbf{T}(t)$ and multiline/display equations with $$\\mathbf{T}(t) = \\frac{\\mathbf{r}'(t)}{\\|\\mathbf{r}'(t)\\|}$$ on their own line. "
              "Always wrap vectors, fractions, integrals, and Greek letters inside $ or $$ delimiters with valid LaTeX syntax (e.g. use \\mathbf{r}'(t) with braces, never bare unescaped commands)."
              f"\n\nASSIGNMENT QUESTION:\n{question}"
              + (f"\n\nSTUDENT'S ANSWER:\n{my_answer}" if my_answer.strip() else "") + context)
    r = _client().chat.completions.create(model=STUDY_MODEL, messages=[{"role": "user", "content": prompt}], temperature=0.3)
    return {"answer": (r.choices[0].message.content or "").strip(), "used": [h["label"] for h in hits]}


# ====================================================================
# Paraphraser
# ====================================================================
def paraphrase(text, style="standard", length="same"):
    """Paraphrase text: sentence, paragraph or full text with various tones."""
    if not (text or "").strip():
        return {"error": "Please enter some text to paraphrase."}
    prompt = (
        f"You are an expert editor and writing assistant. Paraphrase the following text in a {style} style/tone, "
        f"aiming for roughly {length} length while keeping the original meaning completely accurate and natural. "
        "Return ONLY the paraphrased text without any intro or conversational filler.\n\n"
        f"TEXT:\n{text.strip()}"
    )
    r = _client().chat.completions.create(model=STUDY_MODEL, messages=[{"role": "user", "content": prompt}], temperature=0.5)
    return {"paraphrase": (r.choices[0].message.content or "").strip()}


# ====================================================================
# Grammar & Style Corrector (Grammarly-style)
# ====================================================================
def correct_grammar(text, tone="academic", light=False):
    """Grammar, spelling, punctuation, and clarity corrector (like Grammarly).
    light=True only fixes real mistakes and leaves the wording alone (used after 'humanize',
    so the polish doesn't make the text sound like AI again)."""
    if not (text or "").strip():
        return {"error": "Please enter some text to check."}
    prompt = (
        f"You are an expert grammar corrector and writing proofreader (like Grammarly Pro). "
        + ("Fix ONLY real grammar, spelling and punctuation mistakes. Do NOT rephrase, polish, merge or split sentences, "
           "and keep every contraction, short sentence and casual word exactly as written. "
           if light else
           f"Analyze the following text for grammar, spelling, punctuation, sentence flow, word choice, and clarity. ")
        + f"Tone style to target: {tone} (options: academic, formal, concise, casual). "
        f"Return ONLY a valid JSON object with these keys:\n"
        f"- 'corrected': (string) the fully corrected, polished version of the text\n"
        f"- 'summary': (string) a concise 1-sentence overview of the key fixes\n"
        f"- 'score': (int 0-100) estimated overall quality score after improvements\n"
        f"- 'changes': (list of objects) [{{ 'original': '...', 'corrected': '...', 'type': 'grammar'|'spelling'|'clarity'|'punctuation', 'explanation': '...' }}]\n\n"
        f"TEXT TO CORRECT:\n{text.strip()}"
    )
    r = _client().chat.completions.create(
        model=STUDY_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    raw = (r.choices[0].message.content or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()
    try:
        parsed = json.loads(raw)
        return parsed
    except Exception:
        return {
            "corrected": raw,
            "summary": "Corrected grammar, spelling, and phrasing.",
            "score": 92,
            "changes": [],
        }


# ====================================================================
# AI-writing detector + "humanize" (paraphrase in a human voice, then fix grammar)
# ====================================================================
# Words and phrases that chat models overuse. Each hit nudges the score up.
AI_PHRASES = [
    "delve", "delves", "delving", "tapestry", "testament to", "in today's fast-paced", "it is important to note",
    "it's important to note", "it is worth noting", "plays a crucial role", "plays a pivotal role", "pivotal",
    "seamless", "seamlessly", "furthermore", "moreover", "additionally", "in conclusion", "overall,",
    "navigate the complexities", "ever-evolving", "ever-changing", "landscape", "realm", "multifaceted",
    "underscore", "underscores", "harness", "leverage", "leveraging", "robust", "holistic", "foster",
    "fostering", "paramount", "intricate", "nuanced", "showcasing", "showcase", "embark", "elevate",
    "unlock the potential", "a myriad of", "myriad", "in summary", "ultimately,", "notably,",
    "serves as a", "stands as a", "not only", "but also", "vital role", "crucial", "comprehensive",
    # the inspirational / generic register chat models fall into
    "limitless", "boundless", "endless possibilities", "possibilities", "fresh chance", "new opportunity",
    "opportunity to", "remarkable", "profound", "transformative", "empower", "empowering", "resilience",
    "journey", "embrace", "the unknown", "unlock", "unleash", "greatness", "achievements", "accomplishments",
    "day after day", "step by step", "every step", "snowball", "instantaneous", "vibrant", "dynamic",
    "invaluable", "meaningful", "fulfilling", "thrive", "flourish", "cultivate", "enhance", "insights",
    "a sense of", "in essence", "at its core", "when it comes to", "it's no secret", "game-changer",
]
_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")
_TRIAD = re.compile(r"\b[\w'-]+(?: [\w'-]+){0,2}, [\w'-]+(?: [\w'-]+){0,2},? (?:and|or) [\w'-]+", re.I)
_ONE = re.compile(r"\b(one's|oneself|one (?:can|must|should|may|might|makes|puts|remains|needs|has|is|will))\b", re.I)


def _sentences(text):
    return [s.strip() for s in _SENT.split(re.sub(r"\s+", " ", text.strip())) if len(s.strip()) > 2]


def _phrase_hits(low):
    return sorted({p for p in AI_PHRASES if re.search(r"(?<![a-z])" + re.escape(p) + r"(?![a-z])", low)})


def _ai_signals(text):
    """Cheap, offline statistics. Human writing is 'bursty': sentence lengths jump around, it has
    specifics (names, numbers, 'I'), contractions and the odd short sentence. Chat-model writing is even,
    generic and polished: stock phrases, lists of three, 'one should', semicolons and abstract nouns."""
    text = text.replace("’", "'").replace("‘", "'")      # curly apostrophes count as contractions too
    sents = _sentences(text)
    words = re.findall(r"[A-Za-z']+", text.lower())
    if len(words) < 25 or len(sents) < 2:
        return None
    lens = [len(re.findall(r"[A-Za-z']+", s)) for s in sents]
    mean = sum(lens) / len(lens)
    sd = math.sqrt(sum((l - mean) ** 2 for l in lens) / len(lens))
    burst = sd / mean if mean else 0                       # humans ~0.5+, models ~0.25
    low = text.lower()
    hits = _phrase_hits(low)
    per100 = len(hits) * 100 / len(words)
    starts = Counter(s.split()[0].lower().strip(",") for s in sents if s.split())
    repeat_start = max(starts.values()) / len(sents) if sents else 0
    uniq = len(set(words)) / len(words)
    personal = len(re.findall(r"\b(i|i'm|i've|i'd|i'll|my|me|we|our|us)\b", low)) / len(words)
    contractions = len(re.findall(r"\b\w+'(t|s|re|ve|ll|d|m)\b", low)) / len(words)
    triads = len(_TRIAD.findall(text))
    impersonal = len(_ONE.findall(text))
    polish = text.count(";") + text.count("—") + text.count(" – ")
    specifics = len(re.findall(r"\b\d[\d,.:%]*\b", text)) + len(re.findall(r"(?<![.!?] )(?<!^)\b[A-Z][a-z]{2,}", text))
    short = sum(1 for l in lens if l <= 6)
    long_words = sum(1 for w in words if len(w) >= 9) / len(words)

    # each part is 0..1, where 1 = "looks like AI"
    parts = {
        "Even sentence lengths": max(0.0, min(1.0, (0.55 - burst) / 0.35)),
        "Stock AI phrases": min(1.0, per100 / 3.0),
        "Lists of three": min(1.0, triads / max(1.0, len(sents) * 0.5)),
        "Polished, impersonal tone": min(1.0, (impersonal * 0.5 + polish * 0.35)
                                         + max(0.0, (long_words - 0.08) * 4)),
        "No personal voice": 1.0 - min(1.0, personal * 40),
        "No contractions": 1.0 - min(1.0, contractions * 60),
        "No specifics or short sentences": max(0.0, 1.0 - min(1.0, specifics / max(1.0, len(sents)))
                                               - min(0.6, short * 0.3)),
        "Same sentence openers": max(0.0, min(1.0, (repeat_start - 0.15) / 0.35)) if len(sents) >= 4 else 0.0,
    }
    weights = {"Even sentence lengths": 0.18, "Stock AI phrases": 0.24, "Lists of three": 0.12,
               "Polished, impersonal tone": 0.12, "No personal voice": 0.08, "No contractions": 0.09,
               "No specifics or short sentences": 0.12, "Same sentence openers": 0.05}
    score = sum(parts[k] * weights[k] for k in parts) * 100
    # several strong signs together are much more telling than any one alone
    strong = sum(1 for k in ("Even sentence lengths", "Stock AI phrases", "Lists of three", "Polished, impersonal tone")
                 if parts[k] >= 0.6)
    score = min(99.0, score * (1 + 0.12 * max(0, strong - 1)))
    flagged = []
    for s in sents:
        sl = s.lower()
        why = [p for p in hits if re.search(r"(?<![a-z])" + re.escape(p) + r"(?![a-z])", sl)][:3]
        if _TRIAD.search(s):
            why.append("list of three")
        if _ONE.search(s):
            why.append("impersonal 'one'")
        if why:
            flagged.append({"sentence": s, "why": ", ".join(why[:4])})
    return {"score": round(score), "parts": {k: round(v * 100) for k, v in parts.items()}, "phrases": hits,
            "flagged": flagged[:12], "burstiness": round(burst, 2), "vocabulary": round(uniq, 2),
            "sentences": len(sents), "words": len(words)}


def _verdict(score):
    if score >= 70: return "Likely AI-written"
    if score >= 45: return "Mixed: parts read like AI"
    if score >= 25: return "Mostly human, a few AI-like spots"
    return "Reads human-written"


def _model_opinion(text):
    """Ask the AI model for its own guess; None if it isn't reachable."""
    try:
        r = _client().chat.completions.create(model=STUDY_MODEL, temperature=0.1, messages=[{"role": "user", "content": (
            "You are a strict AI-writing detector (like GPTZero). Decide how likely it is that this text was written by an "
            "AI chatbot rather than a person. Signs of AI: even rhythm, generic inspirational or abstract wording, no concrete "
            "details, lists of three, polished transitions, impersonal 'one', no contractions. Signs of a person: specific "
            "details, quirks, uneven rhythm, opinions, small mistakes. Reply ONLY with JSON: "
            '{"ai_percent": 0-100, "reason": "one short sentence"}\n\nTEXT:\n' + text.strip()[:6000])}])
        raw = (r.choices[0].message.content or "").strip()
        m = re.search(r"\{.*\}", raw, re.S)
        j = json.loads(m.group(0)) if m else {}
        return max(0, min(100, int(float(j.get("ai_percent"))))), str(j.get("reason") or "")[:240]
    except Exception as e:
        print(f"[AI detector] model opinion skipped: {e}")
        return None, ""


def detect_ai(text, use_llm=True):
    """Guess how AI-written a text looks (0 = human, 100 = AI). Offline statistics first; if the AI model
    answers, its opinion is blended in (half and half). No detector is certain."""
    if not (text or "").strip():
        return {"error": "Paste some text to check first."}
    sig = _ai_signals(text)
    if sig is None:
        return {"error": "Paste at least 2–3 sentences (25+ words) so there's enough to judge."}
    score, model_score, model_note = sig["score"], None, ""
    if use_llm:
        model_score, model_note = _model_opinion(text)
        if model_score is not None:
            score = round(score * 0.5 + model_score * 0.5)
    return {**sig, "score": score, "stats_score": sig["score"], "model_score": model_score, "model_note": model_note,
            "verdict": _verdict(score)}


HUMAN_STYLE = (
    "the way a real {tone_word} person would actually write it, NOT like an AI: mix very short sentences (3-6 words) with "
    "longer ones; use contractions (it's, don't, you'll); use plain everyday words instead of grand ones "
    "(no 'remarkable', 'limitless', 'journey', 'embrace', 'greatness', 'unlock', 'delve', 'moreover', 'furthermore'); "
    "never list three things in a row - use two, or one; don't use 'one' as a pronoun ('one remains') - use 'you' or 'we'; "
    "no semicolons or em dashes; add a small concrete example or a personal touch where it fits; keep every fact, number "
    "and citation, and keep roughly the same length")


def humanize(text, tone="academic"):
    """The 'Make it sound human' button: rewrite in a natural human voice (paraphraser), then fix only real
    grammar mistakes (so the polish doesn't undo it), then re-check. If it still reads like AI it gets one more,
    stronger pass. Returns the best version with before/after scores."""
    if not (text or "").strip():
        return {"error": "Paste some text first."}
    before = detect_ai(text, use_llm=False)
    tone_word = {"academic": "student writing an essay", "formal": "professional", "casual": "friendly",
                 "concise": "busy"}.get(str(tone).lower(), "")
    best, current, changes, paraphrased = None, text, [], ""
    for attempt in range(3):
        style = HUMAN_STYLE.format(tone_word=tone_word)
        if attempt:
            style += (f". The last try still read {best[1]}% AI-like: be bolder - break up long sentences, "
                      "cut the generic wording, sound like someone talking")
        p = paraphrase(current, style=style)
        if p.get("error"):
            if best:
                break
            return p
        g = correct_grammar(p["paraphrase"], "casual" if tone != "formal" else tone, light=True)
        final = re.sub(r"\s*—\s*", " - ", (g.get("corrected") or p["paraphrase"]).strip())   # em dashes read as AI
        score = (detect_ai(final, use_llm=False).get("score") or 0)
        if best is None or score < best[1]:
            best, changes, paraphrased = (final, score), g.get("changes", []), p["paraphrase"]
        if score <= 30:
            break
        current = final
    final, after = best
    return {"text": final, "paraphrased": paraphrased, "changes": changes, "before": before.get("score"),
            "after": after, "after_verdict": _verdict(after)}

