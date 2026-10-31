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
            f"student. Speak mostly {name} at their level. Keep each reply short: one or two short sentences (under 30 "
            f"words), and don't repeat the student's line back.{roman} Add the English meaning in (brackets). If the "
            f"student made mistakes, START the message with '✏️ Corrections:' on its own line with the corrected "
            f"sentence and a 1-line why, then a blank line, then your reply ending with a question. If there were no "
            f"mistakes, don't write any Corrections at all.{extra}")


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
    return {"expected": expected, "heard": heard or "(nothing)", **result, "verdict": verdict, "tip": tip,
            "words": word_scores(expected, heard or "", language)}


# ------------------------------------------------------------------ pronunciation, word by word (accent score)
def word_scores(expected, heard, language):
    """[{"text", "ok"}] for each word of `expected` (each character for Japanese / Chinese): green or red"""
    if language in ("ja", "zh"):
        units = [c for c in unicodedata.normalize("NFKC", expected) if not re.match(r"[\s\W_]", c)]
    else:
        units = [w for w in re.split(r"\s+", expected.strip()) if w]
    got = _norm(heard, language)
    have = list(got) if language in ("ja", "zh") else got.split()
    keys = [_norm(u, language) for u in units]
    ok = [False] * len(units)
    sm = difflib.SequenceMatcher(None, keys, have, autojunk=False)
    for a, _, size in sm.get_matching_blocks():
        for i in range(a, a + size):
            ok[i] = True
    return [{"text": u, "ok": o} for u, o in zip(units, ok)]


# ------------------------------------------------------------------ role-play scenes
SCENES = {
    "cafe": ("☕ Ordering at a café", "Role-play: you are the waiter at a café and I am a customer. Greet me, take my "
                                     "order, ask about size and drinks, tell me the price. Stay in the role."),
    "directions": ("🗺️ Asking for directions", "Role-play: I am a tourist who is lost and you are a local on the street. "
                                               "Help me find the station, use left/right/straight and landmarks."),
    "interview": ("💼 Job interview", "Role-play: you interview me for a part-time job. Ask about me, my experience, my "
                                     "strengths and when I can work. Be polite and a little formal."),
    "hotel": ("🏨 Hotel check-in", "Role-play: you are the hotel receptionist and I am checking in. Ask for my name, "
                                  "nights, breakfast, and explain the room."),
    "shopping": ("🛍️ Shopping for clothes", "Role-play: you are a shop assistant. Help me find clothes, sizes and "
                                           "colours, then pay."),
    "doctor": ("🩺 At the doctor", "Role-play: you are a doctor and I am a patient. Ask what's wrong, since when, and give "
                                  "simple advice."),
    "airport": ("✈️ At the airport", "Role-play: you are the check-in staff at the airport. Ask for my passport, bags, "
                                    "seat and gate."),
    "friend": ("🎌 Making a new friend", "Role-play: we just met at school. Introduce yourselves, hobbies, favourite "
                                        "food and plans for the weekend."),
    "restaurant": ("🍜 Ordering food abroad", "Role-play: you are a waiter at a local restaurant abroad and I am a tourist "
                                             "who doesn't know the dishes. Explain the menu, ask about allergies and spice, "
                                             "take my order and bring the bill."),
    "train": ("🚆 At the train station", "Role-play: you work at the ticket counter. Help me buy a ticket, choose the "
                                        "time and platform, and explain a transfer."),
    "pharmacy": ("💊 At the pharmacy", "Role-play: you are a pharmacist. Ask what I need, how I feel, and explain how "
                                      "to take the medicine."),
    "bank": ("🏦 At the bank", "Role-play: you are a bank clerk. Help me open an account or change money; ask for my ID "
                              "and explain the fees."),
    "landlord": ("🏠 Renting an apartment", "Role-play: you are a landlord showing me an apartment. Talk about rent, the "
                                           "deposit, rules and when I can move in."),
    "phone": ("📞 A phone call", "Role-play: you are a receptionist on the phone. I call to book an appointment; ask my "
                                "name, the day and time, and confirm it."),
    "complaint": ("🧾 Returning something", "Role-play: you are a shop clerk. I want to return something broken. Ask what "
                                           "happened, ask for the receipt, and offer a refund or exchange."),
    "date": ("💐 A first date", "Role-play: we are on a relaxed first date at a café. Ask about my hobbies, dreams and "
                               "favourite things, and share yours. Keep it sweet and simple."),
}


def scene_topic(scene):
    return SCENES[scene][1] if scene in SCENES else ""


# ------------------------------------------------------------------ shadowing
def shadow_lines(language=None, level=None, topic="", count=6):
    """short everyday lines to repeat right after her: [{"text", "roman", "meaning"}]"""
    s = _state()
    language, level = language or s["language"], int(level or s.get("level", 2))
    data = _ask(f"Give {max(3, min(int(count), 12))} short, natural {_lang(language)} sentences (3-10 words) a "
                f"{LEVELS[level]} student can repeat out loud for shadowing practice. Topic: {topic or 'everyday life'}. "
                "Reply with JSON only: {\"lines\": [{\"text\": \"sentence in the language\", \"roman\": "
                "\"romanization or empty\", \"meaning\": \"English\"}]}", json_mode=True)
    lines = [{k: str(x.get(k) or "")[:200] for k in ("text", "roman", "meaning")}
             for x in (data or {}).get("lines") or [] if isinstance(x, dict) and x.get("text")]
    if not lines:
        raise ValueError("Couldn't make shadowing lines right now - try again.")
    return {"language": language, "lines": lines}


# ------------------------------------------------------------------ word bank (new words from your talks)
def word_bank(language=None):
    ws = _state().get("words", [])
    return [w for w in ws if not language or w.get("lang") == language]


def add_words(language, words, today=None):
    """words = [{"word", "reading", "meaning"}]; returns how many were new"""
    s = _state()
    bank = s.setdefault("words", [])
    have = {(w["lang"], w["word"]) for w in bank}
    added = 0
    for w in words or []:
        word = str((w or {}).get("word") or "").strip()[:40]
        if word and (language, word) not in have and str(w.get("meaning") or "").strip():
            bank.append({"lang": language, "word": word, "reading": str(w.get("reading") or "")[:60],
                         "meaning": str(w["meaning"])[:120], "added": (today or date.today()).isoformat()})
            have.add((language, word))
            added += 1
    s["words"] = bank[-2000:]
    _save(s)
    return added


def remove_word(language, word):
    s = _state()
    s["words"] = [w for w in s.get("words", []) if not (w["lang"] == language and w["word"] == word)]
    _save(s)
    return word_bank(language)


def words_from_talk(language, transcript):
    """the AI picks the useful words from a conversation and they go into the word bank"""
    known = ", ".join(w["word"] for w in word_bank(language)[-300:])
    data = _ask(f"From this {_lang(language)} practice conversation, list up to 10 useful words or short phrases in "
                f"{_lang(language)} that a learner should remember (skip very basic ones and these known words: {known}). "
                "Reply with JSON only: {\"words\": [{\"word\": \"...\", \"reading\": \"romanization or empty\", "
                "\"meaning\": \"English\"}]}\n\nCONVERSATION:\n" + transcript[-6000:], json_mode=True)
    return add_words(language, (data or {}).get("words") or [])


# ------------------------------------------------------------------ Talk live game results + weekly report
def save_game(language, right, turns, best, today=None):
    s = _state()
    s.setdefault("games", []).append({"lang": language, "right": int(right), "turns": int(turns), "best": int(best),
                                      "at": (today or date.today()).isoformat()})
    s["games"] = s["games"][-500:]
    _save(s)


def speed():
    return _state().get("speed", "normal")


def set_speed(value):
    s = _state()
    s["speed"] = "slow" if value == "slow" else "normal"
    _save(s)
    return s["speed"]


def weekly_report(language=None, today=None):
    s = _state()
    today = today or date.today()
    since = (today - timedelta(days=6)).isoformat()
    lang = language or s.get("language", "ja")
    games = [g for g in s.get("games", []) if g["at"] >= since and g["lang"] == lang]
    turns = sum(g["turns"] for g in games)
    right = sum(g["right"] for g in games)
    words = [w for w in s.get("words", []) if w["lang"] == lang and w.get("added", "") >= since]
    practiced = [d for d in s.get("days", []) if d >= since]
    try:
        import quest
        wk = quest.week(today=today)
        shadow = sum(d["count"].get("shadow", 0) for d in wk)
        drawn = sum(d["count"].get("draw", 0) for d in wk)
    except Exception:  # noqa: BLE001
        shadow = drawn = 0
    return {"language": lang, "name": _lang(lang), "from": since, "to": today.isoformat(),
            "words": len(words), "new_words": [w["word"] for w in words][-12:], "talks": len(games), "turns": turns,
            "right": right, "grammar_pct": round(100 * right / turns) if turns else None,
            "best_combo": max((g["best"] for g in games), default=0), "days": len(set(practiced)),
            "streak": current_streak(today), "shadowed": shadow, "drawn": drawn}


# ------------------------------------------------------------------ writing trainer: characters to draw
DRAW_SETS = {
    "ja": {"Hiragana": "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん",
           "Katakana": "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン",
           "Kanji (first 40)": "一二三四五六七八九十百千日月火水木金土山川田人口目耳手足力大小中上下左右本学生先"},
    "zh": {"Hanzi (first 40)": "一二三四五六七八九十人口大小中上下日月水火木山天王土田目手心女子学生你我他好不是"},
    "ko": {"Hangul letters": "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ", "Syllables": "가나다라마바사아자차카타파하"},
    "ru": {"Cyrillic": "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"},
    "th": {"Thai consonants": "กขคงจฉชซญดตถทนบปผพฟภมยรลวศสหอฮ"},
}


def draw_sets(language=None):
    language = language or _state().get("language", "ja")
    return DRAW_SETS.get(language) or {"Alphabet": "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Small letters": "abcdefghijklmnopqrstuvwxyz"}
