"""
sensei.py - Multilingual Sensei: a language teacher.

  lesson(lang, topic, level)          a lesson with examples, romanization and practice (scripts too: hiragana,
                                       katakana, kanji, hanzi, hangul)
  make_quiz(lang, topic, kind, n)      vocabulary / grammar quiz saved as a Study review (so it gets spaced repetition)
  conversation practice                mind.practice_start("sensei", topic, level, lang)  - corrections every turn
  pronunciation(expected, lang)        record you saying a phrase, compare with what Whisper heard, give feedback
  streak / mistakes                    daily streak; mistakes from conversations feed "lesson from my mistakes"
"""
import difflib
import json
import os
import re
import time
import unicodedata
import uuid
from datetime import date, timedelta

from paths import data_file

STATE_FILE = data_file("sensei.json")
LANGS = {"ja": "Japanese", "zh": "Chinese (Mandarin)", "ko": "Korean", "es": "Spanish", "fr": "French",
         "de": "German", "it": "Italian", "pt": "Portuguese", "en": "English", "tl": "Filipino (Tagalog)",
         "ru": "Russian", "vi": "Vietnamese", "th": "Thai", "id": "Indonesian"}
LEVELS = {1: "absolute beginner", 2: "beginner", 3: "intermediate", 4: "upper intermediate", 5: "advanced"}
NEEDS_ROMAN = {"ja", "zh", "ko", "ru", "th"}


_SCRIPTS = {"ja": r"[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f\u3005\u30fc]", "zh": r"[\u3400-\u9fff]",
            "ko": r"[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]", "th": r"[\u0e00-\u0e7f]", "ru": r"[\u0400-\u04ff]"}
_EN_WORDS = {"the", "and", "is", "are", "you", "your", "to", "of", "in", "it", "this", "that", "for", "with", "means",
             "say", "use", "when", "how", "what", "a", "an", "be", "can", "or", "example", "word", "words"}


def speakable(text, language):
    """Only the bits worth reading aloud in `language`: no English translation in brackets, no romaji, no markdown."""
    import re
    if language in _SCRIPTS:
        t = re.sub(r"\([^)]*\)|（[^）]*）|\[[^\]]*\]", " ", text or "")
        rx = _SCRIPTS[language]
        punct = r"[ 、。！？!?,・～〜「」『』…ー]"
        parts = re.findall(rf"{rx}(?:{rx}|{punct})*", t)
        return " ".join(p.strip(" 、,・") for p in parts if p.strip()).strip()
    out = []
    for line in re.split(r"[\n•]+", text or ""):
        bold = re.findall(r"\*\*(.+?)\*\*", line)
        plain = re.sub(r"\([^)]*\)|\[[^\]]*\]", " ", re.sub(r"[*_`#>|]", " ", line))
        words = re.findall(r"[^\W\d_]+", plain.lower())
        if words and sum(w in _EN_WORDS for w in words) / len(words) < 0.3:     # mostly not English: read the line
            out.append(plain.strip(" :-–"))
        else:                                                                   # English explanation: read only **bold** words
            out += [re.sub(r"\([^)]*\)", "", b).strip() for b in bold]
    return re.sub(r"\s{2,}", " ", " ".join(x for x in out if x)).strip()


def _state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {"language": "ja", "level": 2, "streak": 0, "last_day": "", "days": [], "mistakes": []}


def _save(s):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2, ensure_ascii=False)


def settings():
    s = _state()
    return {k: s.get(k) for k in ("language", "level", "streak", "last_day")} | {
        "languages": LANGS, "levels": LEVELS, "mistakes": s.get("mistakes", [])[-15:], "days": s.get("days", [])[-60:]}


def set_language(language=None, level=None):
    s = _state()
    if language in LANGS:
        s["language"] = language
    if level:
        s["level"] = max(1, min(5, int(level)))
    _save(s)
    return settings()


def mark_practice(today=None):
    """Counts today toward the streak (call after any lesson / quiz / conversation)."""
    s = _state()
    today = (today or date.today())
    t = today.isoformat()
    if s.get("last_day") != t:
        yesterday = (today - timedelta(days=1)).isoformat()
        s["streak"] = s.get("streak", 0) + 1 if s.get("last_day") == yesterday else 1
        s["last_day"] = t
        s.setdefault("days", []).append(t)
        s["days"] = s["days"][-400:]
    _save(s)
    return s["streak"]


def current_streak(today=None):
    s = _state()
    today = today or date.today()
    if s.get("last_day") in (today.isoformat(), (today - timedelta(days=1)).isoformat()):
        return s.get("streak", 0)
    return 0


def _lang(code):
    return LANGS.get(code, code or "Japanese")


def _ask(prompt, json_mode=False):
    import llm
    return llm.ask(prompt, model="smart", json_mode=json_mode)


# ------------------------------------------------------------------ lessons
def lesson(language=None, topic="", level=None):
    s = _state()
    language, level = language or s["language"], int(level or s.get("level", 2))
    name = _lang(language)
    roman = " Always add romanization (romaji / pinyin with tone marks / revised romanization) and the English meaning." \
        if language in NEEDS_ROMAN else " Add the English meaning."
    scripts = {"ja": " If the topic is hiragana, katakana or kanji: show the characters in a table with readings, stroke-"
                     "order tips and memory tricks.",
               "zh": " If the topic is hanzi or tones: show characters with pinyin, tones, radicals and memory tricks.",
               "ko": " If the topic is hangul: show the letters, how they combine into blocks, and memory tricks."}.get(language, "")
    text = _ask(f"You are a friendly {name} teacher. Teach a {LEVELS[level]} student this lesson: {topic or 'a useful everyday topic'}."
                f"{roman}{scripts} Structure: 1) short explanation, 2) 5-8 examples, 3) a common mistake to avoid, "
                f"4) {'politeness / honorific notes, ' if language in ('ja', 'ko') else ''}5) 5 practice sentences for the "
                f"student to translate (answers hidden at the end under 'Answers'). Use markdown with short headings.")
    mark_practice()
    return {"language": language, "topic": topic, "lesson": text, "streak": current_streak()}


def mistakes_lesson(language=None):
    s = _state()
    ms = [m["text"] for m in s.get("mistakes", []) if m.get("language") == (language or s["language"])][-12:]
    if not ms:
        return {"error": "No saved mistakes yet - do a conversation practice and get feedback first."}
    return lesson(language, "Fix these mistakes I keep making: " + "; ".join(ms))


# ------------------------------------------------------------------ quizzes (saved as Study reviews)
QUIZ_KINDS = {"flashcards": "Flashcards", "mcq": "Multiple choice quiz", "fill_blanks": "Fill in the blanks"}


def make_quiz(language=None, topic="", kind="flashcards", count=12, level=None):
    import academic
    s = _state()
    language, level = language or s["language"], int(level or s.get("level", 2))
    if kind not in QUIZ_KINDS:
        raise ValueError("Unknown quiz type.")
    name = _lang(language)
    roman = " Include romanization in brackets after every word in the target language." if language in NEEDS_ROMAN else ""
    data = _ask(f"Make {max(3, min(int(count), 30))} {QUIZ_KINDS[kind].lower()} items to practise {name} for a "
                f"{LEVELS[level]} student. Topic: {topic or 'common everyday vocabulary'}.{roman} Each item has a "
                f"\"topic\" (2-4 words) and \"source\": \"Sensei\". Reply with JSON only, in exactly this shape:\n"
                f"{academic._REVIEW_FORMATS[kind]}", json_mode=True)
    data = academic._clean_review(kind, data)
    review = {"id": uuid.uuid4().hex[:10], "type": kind, "type_label": QUIZ_KINDS[kind],
              "title": f"{name}: {topic or 'vocabulary'} ({QUIZ_KINDS[kind].lower()})", "files": [], "subject": name,
              "difficulty": LEVELS[level], "created": time.strftime("%Y-%m-%d %H:%M"),
              "srs": {"interval": 0, "due": date.today().isoformat()}, **data}
    academic._dirs()
    academic._write_json(os.path.join(academic.REVIEWS_DIR, f"{review['id']}.json"), review)
    mark_practice()
    return review


# ------------------------------------------------------------------ conversation practice (uses mind.py's practice engine)
def conversation_prompt(language, level):
    name = _lang(language)
    roman = " After each line in the target language add the romanization." if language in NEEDS_ROMAN else ""
    extra = (" Explain honorifics/politeness (keigo, -san, -senpai...) when they come up. If the topic mentions anime, "
             "speak like a friendly anime character but still correctly.") if language == "ja" else \
        (" Explain formal vs informal speech when it comes up.") if language == "ko" else ""
    return (f"You are a patient native {name} speaker and teacher having a conversation with a {LEVELS[int(level)]} "
            f"student. Speak mostly {name} at their level, keep it under 60 words.{roman} Add the English meaning in "
            f"(brackets). If the student made mistakes, start with '✏️ Corrections:' showing the corrected sentence "
            f"and a 1-line why, then continue the conversation with a question.{extra}")


def save_mistakes(language, feedback):
    """Pull 'mistake' lines out of conversation feedback and keep them for later lessons."""
    lines = [re.sub(r"^[-*\d.)\s]+", "", l).strip() for l in feedback.splitlines()]
    found = [l for l in lines if 8 < len(l) < 200 and re.search(r"→|->|instead of|should be|not |✗|mistake", l, re.I)]
    if not found:
        return 0
    s = _state()
    s.setdefault("mistakes", []).extend({"language": language, "text": t, "at": date.today().isoformat()} for t in found[:8])
    s["mistakes"] = s["mistakes"][-100:]
    _save(s)
    return len(found[:8])


# ------------------------------------------------------------------ pronunciation
def _norm(text, language):
    text = unicodedata.normalize("NFKC", text).lower()
    text = re.sub(r"[\s\W_]+", " " if language not in ("ja", "zh") else "", text).strip()
    return text


def compare(expected, heard, language):
    """Score 0-100 and which parts were missed."""
    a, b = _norm(expected, language), _norm(heard, language)
    if not a:
        return {"score": 0, "missed": [], "extra": []}
    unit = (lambda t: list(t)) if language in ("ja", "zh") else (lambda t: t.split())
    ea, eb = unit(a), unit(b)
    sm = difflib.SequenceMatcher(None, ea, eb)
    missed, extra = [], []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op in ("replace", "delete"):
            missed.append(("" if language in ("ja", "zh") else " ").join(ea[i1:i2]))
        if op in ("replace", "insert"):
            extra.append(("" if language in ("ja", "zh") else " ").join(eb[j1:j2]))
    return {"score": round(100 * sm.ratio()), "missed": missed, "extra": extra}


def record(seconds=5):
    import sounddevice as sd
    audio = sd.rec(int(seconds * 16000), samplerate=16000, channels=1, dtype="float32")
    sd.wait()
    return audio.reshape(-1)


def pronunciation(expected, language=None, seconds=5):
    language = language or _state()["language"]
    import stt
    heard = stt.transcribe(record(seconds), keep_all=True, language=language if language != "tl" else "tl")
    result = compare(expected, heard, language)
    s = result["score"]
    verdict = "Excellent!" if s >= 90 else "Good - almost there." if s >= 70 else "Keep practising - listen and try again."
    tip = ""
    if result["missed"]:
        tip = f"I didn't clearly hear: {', '.join(m for m in result['missed'] if m)[:120]}."
    mark_practice()
    return {"expected": expected, "heard": heard or "(nothing)", **result, "verdict": verdict, "tip": tip}
