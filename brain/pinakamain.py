"""
pinakamain.py - Vermeil, a voice + text AI companion.

Run:  python terminal.py   (or the window app: python app.py)
  - Voice mode: say "vermi", then talk or give a command.
  - Text mode:  press ` (backtick) to switch, then type.

API keys live in the .env file next to this script (never in the code).
"""
import os as _os, sys as _sys   # lets this file run on its own too (VS Code "Run"): find brain/, senses/, skills/
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
import folders  # noqa: E402,F401

import io
import os
import queue
import re
import json
import time
import random
import threading
import subprocess
from datetime import datetime, timedelta

import requests
from rapidfuzz import fuzz, process
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

import f1
import tts
import tools
from Vprompt import VERMEIL_PROMPT

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the project folder (this file is in brain/)
from paths import data_file  # saved files live in the data/ folder


# ------------ Settings -----------------#
def load_env(path=None):
    """Tiny .env reader: KEY=value lines become environment variables.
    Also accepts a file named just 'env' (Windows downloads often drop the dot)."""
    if path is None:
        path = next((p for p in (os.path.join(BASE_DIR, ".env"), os.path.join(BASE_DIR, "env"))
                     if os.path.exists(p)), None)
        if path is None:
            print("⚠️ No .env (or env) file found in the project folder - the AI won't be able to reply.")
            return
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()

WAKE_WORD = "vermi"
WAKE_ALIASES = ("vermi", "vermeil", "vermie", "vermy", "bermi", "vermee")
MIC_INDEX = int(os.environ.get("MIC_INDEX", "1"))
LLM_MODEL = "chat"            # local model role, see llm.py / data/local_models.json
HISTORY_MESSAGES = 20          # how many past messages are sent to the AI each time
MEMORY_LIMIT = 1000            # messages kept in vermeil_memory_0.json; older ones go to the archive
MEMORY_FILE = data_file("vermeil_memory_0.json")
ARCHIVE_FILE = data_file("vermeil_archive.json")
INACTIVITY_LIMIT = 90          # seconds of silence before going back to wake-word mode

KOKORO_BASE = "http://localhost:8880"
KOKORO_URL = f"{KOKORO_BASE}/v1/audio/speech"
VOICE = tts.DEFAULT_VOICE      # Piper voice id, e.g. "piper:en_US-amy-medium" (see tts.py) - the offline voice
VOICE_ONLINE = None            # Kokoro voice id ("kokoro:af_heart") used while the AI is online (Groq), see kokoro.py
VOICE_RATE = "+0%"             # speed, e.g. "+15%"
VOICE_PITCH = "+0Hz"           # pitch, e.g. "+20Hz"
VOICE_VOLUME = 1.0             # 0.2 - 1.5 (character setting)
VOICE_STYLE = "normal"         # normal / whisper / energetic / storyteller / calm / cute
VOICE_RVC = None               # RVC voice clone {"model", "pitch", "index_rate", "base"} (see senses/rvc.py) or None
VOICE_EMOTION = 1.0            # how much her feelings change her voice (0 = flat, 1 = normal, 1.5 = dramatic), voice_emotion.py
VOICE_NATURAL = True           # breaths, real pauses and a speech melody (senses/expressive.py)
VOICE_CHATTER = False          # "Emotional voice": Chatterbox makes the English base voice (senses/chatter.py)
barge_in = False               # stop talking when the user starts talking (Settings; best with headphones)
voice_mood = None              # (mood, time) from voicemood.py
heard_language = None          # (language code, time) the user last spoke in
VOICE_STYLES = {               # rate %, pitch Hz, volume x, pause between sentences (s), how to write
    "normal": (0, 0, 1.0, 0.0, ""),
    "whisper": (-12, -8, 0.5, 0.15, "Speak softly and intimately, like whispering a secret. Short sentences."),
    "energetic": (15, 15, 1.15, 0.0, "Be upbeat and energetic, with exclamation marks!"),
    "storyteller": (-12, -4, 1.0, 0.45, "Narrate dramatically like a storyteller: vivid words, suspense, pauses (...)."),
    "calm": (-8, -4, 0.85, 0.2, "Be calm, slow and soothing."),
    "cute": (8, 25, 1.0, 0.0, "Be cute and bubbly."),
}

# ------------ Persona (changed by the app's character settings) -----------------#
persona = {"name": "Vermeil", "prompt": VERMEIL_PROMPT}

# ------------ UI hooks (set by app.py; harmless when running in the terminal) -----------------#
ui_emit = None          # function(dict) -> sends an event to the window
ask_hook = None         # function(prompt) -> answer typed in the window
_ctx = threading.local()


def emit(kind, **data):
    if ui_emit:
        try:
            ui_emit({"type": kind, **data})
        except Exception as e:
            print(f"[ui] {e}")


# ------------ State -----------------#
voice_mode = True
conversation_active = False
tts_ready = False
_speak_lock = threading.Lock()
stop_flag = False
_client = None
_recognizer = None
analyzer = SentimentIntensityAnalyzer()


# ------------ Kokoro TTS startup -----------------#
def is_accessible(url, timeout=3):
    try:
        return requests.get(url, timeout=timeout).status_code == 200
    except requests.RequestException:
        return False


def _run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).returncode == 0


def ensure_kokoro(max_wait=180):
    """Load Kokoro inside the app (no Docker, no server) if it isn't loaded yet, and wait until it's ready."""
    import kokoro
    ok = kokoro.start(wait=True, max_wait=max_wait)
    print("✅ Kokoro TTS is ready." if ok else f"⚠️ Kokoro TTS isn't available: {kokoro.status()['error'] or 'not running'}")
    return ok


def online_now():
    """Is the AI online right now (Groq answers)? Then the online (Kokoro) voice is used."""
    try:
        import llm
        return llm.which()["now"] == "groq"
    except Exception:
        return False


VOICE_GENDER = "female"        # the active character's gender: picks the default Kokoro voice when it has none


def online_voice_default():
    """Kokoro is THE voice while online: the character's own Kokoro voice, or a default one that fits."""
    if VOICE_ONLINE and str(VOICE_ONLINE).startswith("kokoro:"):
        return VOICE_ONLINE
    return "kokoro:am_michael" if str(VOICE_GENDER).lower().startswith("m") else "kokoro:af_heart"


def active_voice():
    """The voice to speak with now. Online (Groq) -> always Kokoro (if it's still loading, wait for it instead of
    switching to the offline voice). Offline -> the offline (Piper) voice."""
    if online_now():
        try:
            import kokoro
            if kokoro.ready() or (kokoro.installed() and kokoro.start(wait=True, max_wait=45)):
                return online_voice_default()
        except Exception:
            pass
    return VOICE


def start_tts():
    """Get the voice ready (Piper, offline). Loads the voice now so the first reply isn't slow.
    Kokoro (the online voice) is started in the background at the same time - nothing waits for it."""
    global tts_ready
    if True:                                      # Kokoro is the default online voice for everyone: always get it ready
        try:
            import kokoro
            threading.Thread(target=kokoro.start, daemon=True).start()
        except Exception as e:
            print(f"[Kokoro] {e}")
    tts_ready = tts.available()
    if tts_ready and tts.engine() != "edge":
        try:
            tts.synth("Ready.", VOICE, VOICE_RATE, VOICE_PITCH)
        except Exception as e:
            print(f"⚠️ Couldn't load the voice ({e}). Run: python scripts/setup_local.py")
            tts_ready = False
    return tts_ready


# ------------ Memory -----------------#
def load_memory():
    """Load saved conversations from vermeil_memory_0.json."""
    if not os.path.exists(MEMORY_FILE):
        return {}
    try:
        with open(MEMORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        print(f"Warning: could not read {MEMORY_FILE}; starting with empty memory.")
        return {}
    for user in data.values():
        user.setdefault("conversations", [])
        user.setdefault("preferences", {})
    return data


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    os.replace(tmp, path)


def save_memory(memory):
    """Keep the newest MEMORY_LIMIT messages per user; move older ones to vermeil_archive.json."""
    overflow = {}
    for user_id, user in memory.items():
        extra = len(user["conversations"]) - MEMORY_LIMIT
        if extra > 0:
            overflow[user_id] = user["conversations"][:extra]
            user["conversations"] = user["conversations"][extra:]
    if overflow:
        archive = {}
        if os.path.exists(ARCHIVE_FILE):
            try:
                with open(ARCHIVE_FILE, "r", encoding="utf-8") as f:
                    archive = json.load(f)
            except (json.JSONDecodeError, OSError):
                archive = {}
        for user_id, msgs in overflow.items():
            archive.setdefault(user_id, []).extend(msgs)
        _write_json(ARCHIVE_FILE, archive)
    _write_json(MEMORY_FILE, memory)


# ---------------------- Emotions / time ---------------------#
def detect_emotion(text):
    compound = analyzer.polarity_scores(text)["compound"]
    if compound >= 0.5:
        return "happy"
    if compound <= -0.5:
        return "angry"
    if compound < -0.3:
        return "sad"
    return "neutral"


def get_current_time():
    return datetime.now().strftime("%A, %B %d, %Y - %I:%M %p")


# ---------------------- AI reply ---------------------#
def get_client():
    """The AI runs on this computer (Ollama) - see llm.py."""
    import llm
    return llm.get_client()


EMOJI = re.compile("[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U00002B00-\U00002BFF\u200d\ufe0f\u20e3"
                   "\u2300-\u23ff\u25a0-\u25ff\u2900-\u297f\u3030\u303d\u3297\u3299]")


def strip_emoji(text):
    """Remove emojis (keeps letters of every language, like Japanese, and ~)."""
    text = EMOJI.sub("", text or "")
    text = re.sub(r"[ \t]{2,}", " ", text)
    return re.sub(r" +([,.!?])", r"\1", text).strip()


def clean_text(response):
    """Remove *actions*, emojis and any hidden <think> notes from replies."""
    response = re.sub(r"<think>.*?(</think>|$)", "", response, flags=re.S)
    return clean_endearments(strip_emoji(re.sub(r"\*.*?\*", "", response)))


# ---------------------- Seeing through the camera ---------------------#
VISION_MODEL = "vision"       # local vision model role, see llm.py
screen_source = None        # set by app.py: function returning a screenshot (base64 JPEG) or None
vision_source = None        # set by app.py: function returning the latest camera picture (base64 JPEG) or None
camera_on = lambda: False   # set by app.py
always_look = False         # True = send the picture with every message while the camera is on
_VISUAL = re.compile(
    r"\b(see|seeing|look|looking|watch|camera|webcam|holding|hold|wearing|wear|finger|fingers|hand|hands|"
    r"show|showing|face|hair|shirt|outfit|behind me|room|doing|color|colour|this|these|that thing|how do i look|"
    r"what am i|who is|count|picture|smile|smiling)\b", re.I)


# ---------------------- Remembering what the user tells us ---------------------#
_PREF_PATTERNS = [
    (re.compile(r"\b(?:call me|my name is|my name's)\s+([A-Za-z][\w'-]{0,20}(?:\s+[A-Z][\w'-]{0,20})?)", re.I),
     lambda m: ("name", _name(m.group(1)))),
    (re.compile(r"\bmy (?:favou?rite|fave) ([\w ]{2,25}?) (?:is|are) ([^.!?,]{1,40})", re.I),
     lambda m: (f"favourite {m.group(1).strip().lower()}", m.group(2).strip())),
    (re.compile(r"\bi (?:really )?(love|like|enjoy|hate|dislike|can't stand)\s+([^.!?,]{2,40})", re.I),
     lambda m: (f"{'likes' if m.group(1).lower() in ('love', 'like', 'enjoy') else 'dislikes'}: {_subject(m.group(2))}",
                m.group(1).lower())),
    (re.compile(r"\bi(?:'m| am) allergic to ([^.!?,]{2,30})", re.I), lambda m: ("allergic to", m.group(1).strip())),
    (re.compile(r"\bmy birthday is (?:on )?([^.!?,]{3,25})", re.I), lambda m: ("birthday", m.group(1).strip())),
    (re.compile(r"\bi(?:'m| am) (?:a |an )?(student|teacher|engineer|developer|programmer|designer|gamer|nurse|doctor)\b", re.I),
     lambda m: ("is a", m.group(1).lower())),
    (re.compile(r"\b(?:i live in|i'm from|i am from)\s+([A-Z][\w ]{1,30}?)(?:[.!,?]|$)", re.I), lambda m: ("lives in / from", m.group(1).strip())),
]
def _subject(raw):
    s = raw.strip().lower()
    s = re.sub(r"\s+(now|too|a lot|so much|very much|anymore|really|lol|haha)$", "", s)
    return s


def _name(raw):
    words = [w for w in raw.split() if w.lower() not in ("please", "pls", "now", "ok", "okay", "instead", "from")]
    name = " ".join(words)
    return name.title() if name.islower() else name      # keep "JP" as typed, fix "jp" -> "Jp"


_NOT_PREFS = re.compile(r"^(you|it|this|that|them|him|her|when|how|what|to |the way)", re.I)
MAX_PREFS = 40


def learn_preferences(text, prefs):
    """Pick up simple facts the user states ('call me JP', 'I love matcha'). Returns what was learned."""
    learned = {}
    clauses = re.split(r"[.!?;,]|\band\b|\bbut\b|\bso\b", text or "")
    for clause, (pattern, make) in ((c, p) for c in clauses for p in _PREF_PATTERNS):
        for m in pattern.finditer(clause):
            key, value = make(m)
            subject = key.split(": ", 1)[-1]
            if not value or _NOT_PREFS.match(subject) or len(subject) < 2 or subject.startswith("i "):
                continue
            if key.startswith(("likes: ", "dislikes: ")):          # liking something replaces disliking it
                opposite = ("dis" + key) if key.startswith("likes") else key[3:]
                prefs.pop(opposite, None)
            prefs[key] = value
            learned[key] = value
    while len(prefs) > MAX_PREFS:                                    # keep the newest ones
        prefs.pop(next(iter(prefs)))
    return learned


def describe_preferences(prefs):
    if not prefs:
        return ""
    lines = []
    for k, v in prefs.items():
        if k.startswith("likes: "):
            lines.append(f"{v}s {k[7:]}")
        elif k.startswith("dislikes: "):
            lines.append(f"doesn't like {k[10:]}")
        else:
            lines.append(f"{k}: {v}")
    return "Things you remember about the user (use them naturally, don't list them): " + "; ".join(lines) + "."


_SCREEN = re.compile(r"\b(my screen|on screen|the screen|screen shot|screenshot|this error|this window|what('?s| is) on my (screen|monitor)|my monitor|this page|this code on)\b", re.I)


def wants_to_look(text):
    """Should we send the camera picture with this message?"""
    return always_look or bool(_VISUAL.search(text or ""))


TOOL_NOTE = ("You can actually do things for the user with your tools: calendar events, reminders (the app alerts them "
             "when due), to-do tasks, weekly schedule, notes, birthdays, shopping list, weather, math, web search, music, "
             "volume, camera, email, the computer, a journal (decisions, ideas, goals, stories), gym mode (their workout routine, logging sets, rest timer, history), switching characters, recalling past chats, and "
             "missions (bigger goals done step by step in the background), recommendations, your shared story, "
             "deep 'think' tools (council, what-if, simulate, foresight, fusion, reverse, patterns, routines). "
             "Give recommendations based on what you know they like. Use a tool whenever the user asks for one of these, even casually "
             "('remind me...', 'what's on tomorrow?'). Work out exact dates from today's date. If something needed is "
             "missing (like the time), ask a short question instead of guessing. After using tools, tell the user what "
             "you did in a short, natural, in-character way; never mention tool names or JSON. "
             "For web searches, always search with full names from the conversation (not 'them'/'it'); if the user "
             "says search more/again or a search found nothing, search again with deep=true before giving up. "
             "Never use emojis in your replies. Never call the user pet names or endearments (no darling, babe, love, "
             "sweetie, honey, dear) - use their name or nothing. " + __import__("intent").GUIDE)
MAX_TOOL_ROUNDS = 8


quick_command = None         # app.py: text -> reply for instant commands, or None
app_actions = {}             # app.py: name -> function, for tools that change the window (switch character...)
style = "companion"          # app.py sets these from the settings
context_aware = False
humor_level = 2              # 0 none - 3 sarcastic (Settings)
self_check = False           # double-check answers before replying (Settings)
objects_seen = None           # app.py: () -> "a cup and a cell phone" from the camera's object detector
keep_screens = True          # keep screenshots she looked at, searchable later (Settings)


def _extra_notes(user_input, emotion="neutral"):
    import mind
    if emotion == "neutral" and voice_mood and time.time() - voice_mood[1] < 90 and voice_mood[0] in ("stressed", "tired"):
        emotion = voice_mood[0]
    notes = [f"Style: {mind.style_note(style)}", mind.humor_note(humor_level, emotion), mind.EMERGENCY_NOTE]
    if voice_mood and time.time() - voice_mood[1] < 90 and voice_mood[0] != "calm":
        notes.append(f"From their tone of voice the user sounds {voice_mood[0]}; respond to that gently.")
    lang = persona.get("language") or "auto"
    if lang not in ("auto", "en"):
        import sensei
        name = sensei.LANGS.get(lang, lang)
        notes.append(f"You are a native {name} speaker: ALWAYS reply in natural, simple {name}, even when the user writes "
                     f"English." + (" After your reply, add the English translation in square brackets [like this]."
                                    if persona.get("translate") else ""))
    elif heard_language and time.time() - heard_language[1] < 90 and heard_language[0] != "en":
        import sensei
        notes.append(f"The user just spoke {sensei.LANGS.get(heard_language[0], heard_language[0])}: reply in that language.")
    style_line = VOICE_STYLES.get(VOICE_STYLE, VOICE_STYLES["normal"])[4]
    if style_line:
        notes.append(f"Voice acting: {style_line}")
    if VOICE_CHATTER:
        notes.append("Your voice can really laugh, chuckle, sigh and gasp: write *laughs*, *chuckles*, *sighs* or "
                     "*gasps* right where you'd make that sound (at most one or two per reply), '...' for a pause.")
    elif VOICE_EMOTION > 0:
        notes.append("Your words are spoken aloud with feeling: let it show naturally, with a short *action* like "
                     "*giggles*, *sighs* or *gasps* when it fits, '...' for a thoughtful pause, and ! or ? where a person "
                     "would use them. Don't overdo it.")
    try:
        notes.append(mind.recall_note(user_input))
        import relationship
        notes.append(relationship.note())
        if context_aware:
            notes.append(mind.activity_note())
    except Exception as e:
        print(f"[recall error] {e}")
    return " ".join(n for n in notes if n)


def _ask_yes(question):
    return confirm(question)


stream_speech = True          # start speaking while the answer is still being written (Settings)


def _word_limit(used_tools):
    return 300 if used_tools == "long" else 160 if style in ("tutor", "strategist", "coach") else 110 if used_tools else 50


def get_vermeil_response(user_id, user_input, memory, none_on_error=False, on_text=None):
    emotion = detect_emotion(user_input)
    user_memory = memory.setdefault(user_id, {"conversations": [], "preferences": {}})
    history = user_memory["conversations"][-HISTORY_MESSAGES:]

    looking_at_screen = bool(screen_source and _SCREEN.search(user_input or ""))
    if looking_at_screen:
        image = screen_source()
    else:
        image = vision_source() if (vision_source and wants_to_look(user_input)) else None
    if image and looking_at_screen:
        camera_note = ("The attached picture is a screenshot of the user's screen (not the webcam). Answer about "
                       "what's on it; if there's an error, explain it simply and how to fix it.")
    elif image:
        camera_note = ("You can see the user through their webcam. The attached picture is what the camera sees "
                       "right now; describe or count what is really in it and never pretend.")
    elif camera_on():
        seen = objects_seen() if objects_seen else ""
        camera_note = ("Your camera is on, but you didn't look this time." +
                       (f" Your quick object detector sees: {seen} (use it if relevant; it can't read text or see details)." if seen else ""))
    else:
        camera_note = "Your camera is off, so you can't see the user right now; say so if they ask what you see."
    learn_preferences(user_input, user_memory["preferences"])
    system = (f"{persona['prompt']}\nThe current time is {get_current_time()} "
              f"(today is {datetime.now().strftime('%Y-%m-%d, %A')}). {TOOL_NOTE} "
              f"The user is feeling {emotion}. Adjust your response accordingly. {camera_note} "
              f"{describe_preferences(user_memory['preferences'])} {_extra_notes(user_input, emotion)}")

    reply = None
    if image:
        try:
            response = get_client().chat.completions.create(
                model=VISION_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    *history,
                    {"role": "user", "content": [
                        {"type": "text", "text": user_input},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image}"}},
                    ]},
                ],
            )
            reply = (response.choices[0].message.content or "").strip()
        except Exception as e:
            print(f"[vision error] {e} - answering without the picture")
            system = system.replace(camera_note, "You tried to look through the camera but it didn't work; say so.")
    used_tools = False
    prefix = random.choice(['Mmm~', 'Oh?', 'Hehe~', 'Well, well~', 'Hmph~', 'Oh my~']) if style == "companion" and random.random() < 0.5 else ""
    live = {"words": 0, "started": False}

    def stream_piece(piece):                         # words go to the voice as soon as they're written
        if not live["started"]:
            live["started"] = True
            if prefix:
                on_text(prefix + " ")
        left = _word_limit(used_tools) - live["words"]
        if left <= 0:
            return
        words = piece.split(" ")
        if len([w for w in words if w]) > left:
            piece = " ".join(words[:left]) + "."
        live["words"] += len(piece.split())
        on_text(piece)
    streaming = bool(on_text) and not (self_check and not image)
    if reply is None:
        messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": user_input}]
        last_user = next((m["content"] for m in reversed(history) if m.get("role") == "user" and isinstance(m.get("content"), str)), "")
        import intent
        active = tools.pick(f"{user_input} {intent.normalize(user_input)}", last_user)   # only the tools that fit this message
        try:
            for _ in range(MAX_TOOL_ROUNDS):
                response = get_client().chat.completions.create(
                    model=LLM_MODEL, messages=messages, tools=active, tool_choice="auto",
                    **({"on_text": stream_piece} if streaming else {}))
                msg = response.choices[0].message
                calls = getattr(msg, "tool_calls", None)
                calls = list(calls) if isinstance(calls, (list, tuple)) else []
                if not calls:
                    reply = (msg.content or "").strip()
                    break
                used_tools = used_tools or True
                if any(c.function.name in ("think", "recall", "view_journal") for c in calls):
                    used_tools = "long"
                messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [
                    {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
                    for c in calls]})
                import pc
                for c in calls:
                    if pc.stop_event.is_set():
                        result = "Stopped by the user (emergency stop)."
                        messages.append({"role": "tool", "tool_call_id": c.id, "content": result})
                        continue
                    if c.function.name == "more_tools":
                        try:
                            need = json.loads(c.function.arguments or "{}").get("need", "")
                        except (json.JSONDecodeError, AttributeError):
                            need = str(c.function.arguments)
                        extra = tools.more(need, [t["function"]["name"] for t in active])
                        active = active + extra
                        result = ("Added: " + ", ".join(t["function"]["name"] for t in extra)) if extra else "No other tools match that."
                        messages.append({"role": "tool", "tool_call_id": c.id, "content": result})
                        continue
                    result = tools.run_tool(c.function.name, c.function.arguments, confirm=_ask_yes)
                    print(f"[tool] {c.function.name}({c.function.arguments}) -> {result[:120]}")
                    emit("tool", name=c.function.name, result=result)
                    messages.append({"role": "tool", "tool_call_id": c.id, "content": result})
            if reply is None:
                reply = "Done."
        except Exception as e:
            print(f"[AI error] {e}")
            if none_on_error:
                return None
            return "Mmm, my mind went blank for a second. Say that again?"

    reply = reply.replace("I'm an AI", f"I'm {persona['name']}")
    reply = reply.replace("I’m just an AI", f"I'm {persona['name']}")
    reply = clean_text(reply)
    if self_check and not used_tools and not image and len(reply.split()) > 6:
        import mind
        reply = clean_text(mind.self_check(user_input, reply))
    if prefix:
        reply = f"{prefix} {reply}"
    if on_text and not live["started"]:              # nothing was streamed (camera answer, self-check...): speak it all now
        on_text(reply)
    words = reply.split()
    limit = _word_limit(used_tools)                  # lists like your agenda need a bit more room
    if len(words) > limit:
        reply = " ".join(words[:limit]) + "."

    user_memory["conversations"].append({"role": "user", "content": user_input})
    user_memory["conversations"].append({"role": "assistant", "content": reply})
    save_memory(memory)
    if image and looking_at_screen and keep_screens:
        try:
            import mind
            mind.archive_screen(image, user_input, reply)
        except Exception as e:
            print(f"[screens] {e}")
    try:
        import relationship
        new = relationship.touch(user_input, reply)
        if new:
            emit("milestone", text=new)
    except Exception as e:
        print(f"[relationship] {e}")
    return reply


_memory_ref = None      # app.py hands us its memory dict so greetings can use what we know


def shared_preferences():
    if not _memory_ref:
        return {}
    return _memory_ref.get(persona.get("memory_key", "user"), {}).get("preferences", {})


def quick_line(instruction):
    """Ask the character for one short line (e.g. a greeting) without saving it to memory."""
    try:
        r = get_client().chat.completions.create(model=LLM_MODEL, messages=[
            {"role": "system", "content": f"{persona['prompt']}\nThe current time is {get_current_time()}. "
                                          f"{describe_preferences(shared_preferences())}"},
            {"role": "user", "content": f"[{instruction} Reply with one short spoken line only.]"}])
        return clean_text(r.choices[0].message.content or "") or None
    except Exception as e:
        print(f"[AI error] {e}")
        return None


# --------------------- Speak ----------------#
class SpeechStream:
    """Speak an answer WHILE it's still being written.

    feed(piece)   add text as the AI writes it; every finished sentence starts being voiced right away
    finish(text)  no more text coming (if nothing was fed, `text` is spoken); waits until she's done talking
    """
    MIN_SENTENCE = 22

    def __init__(self, voice=None, rate=None, pitch=None, on_text=None, rvc=None):
        d_rate, d_pitch, self.vol_x, self.pause, _ = VOICE_STYLES.get(VOICE_STYLE, VOICE_STYLES["normal"])
        self.rate = _shift(rate or VOICE_RATE, d_rate, "%")
        self.pitch = _shift(pitch or VOICE_PITCH, d_pitch, "Hz")
        self.voice = voice or _voice_for_language() or active_voice()
        self.rvc = VOICE_RVC if rvc is None else rvc          # {} = no voice clone
        self.on_text = on_text                  # e.g. show the words in the speech bubble as they come
        self.buf, self.all, self.fed = "", "", False
        self.mood, self.said = ("neutral", 0.0), 0         # a feeling lasts a little into the next sentence
        self.pushed = 0                                    # pieces sent to be voiced so far
        self.futures = []                                  # the pieces being voiced, in order (see _submit)
        self.q = queue.Queue()
        self.thread = None

    def _start(self):
        if self.thread is None:
            self.thread = threading.Thread(target=self._play_all, daemon=True)
            self.thread.start()

    def _push(self, sentence):
        self.pushed += 1
        rate, pitch, gain, face, style = self.rate, self.pitch, 1.0, None, None
        if _use_chatter(sentence):              # Chatterbox acts *laughs* / *sighs* out itself: keep them as [tags]
            import chatter
            sentence = chatter.tagged(sentence)
        if VOICE_EMOTION > 0 or VOICE_NATURAL:     # her feeling in this sentence changes how she says it
            import voice_emotion, expressive
            emo, strength = voice_emotion.detect(sentence, analyzer) if VOICE_EMOTION > 0 else ("neutral", 0.0)
            if emo == "neutral" and self.mood[1] * 0.5 >= 0.25:
                emo, strength = self.mood[0], self.mood[1] * 0.5
            self.mood = (emo, strength)
            if VOICE_EMOTION > 0 and _use_chatter(sentence):      # Chatterbox says it happy / angry / scared...
                import chatter
                sentence = chatter.with_mood(sentence, emo, min(1.0, strength * VOICE_EMOTION))
            sound = None
            if VOICE_EMOTION > 0:
                d_rate, _, gain, face = voice_emotion.prosody(emo, strength, VOICE_EMOTION)
                rate = _shift(rate, d_rate, "%")   # speed by the voice itself; the pitch is the melody (expressive)
                sentence, sound = expressive.vocalize(sentence)
            style = expressive.plan(sentence, emo, strength, VOICE_EMOTION, natural=VOICE_NATURAL,
                                    first=not self.said, sound=sound)
            self.said += 1
        sentence = clean_endearments(clean_text(sentence))
        lang = persona.get("language") or "auto"
        if lang not in ("auto", "en"):
            # never read the English translation aloud - even when a [bracket] is split across sentences
            out, depth = "", getattr(self, "_br", 0)
            for ch in sentence:
                if ch in "[(（": depth += 1; continue
                if ch in "])）": depth = max(0, depth - 1); continue
                if not depth: out += ch
            self._br = depth
            sentence = out.strip()
            import sensei
            if lang in sensei._SCRIPTS:                                  # Japanese, Korean, Chinese...: only native-script text
                sentence = sensei.speakable(sentence, lang)
        if style and sentence:
            import expressive
            sentence = expressive.pronounce(sentence, lang)
        if sentence and tts_ready:
            self._start()
            self.q.put((sentence, self._submit(synth_voice, sentence, self.voice, rate, pitch, VOICE, self.rvc, style),
                        gain, face))
        elif style and style.get("breath") == "sigh" and tts_ready:      # a line that is only *sighs*
            import expressive
            self._start()
            self.q.put(("", self._submit(expressive.breath_only, style), gain, face))

    def _submit(self, fn, *args):
        """voice a piece in the background, in order and at most two at a time: the first piece gets the computer
        to itself (so she starts talking sooner), then each piece waits for the one two places before it - so the
        next piece she needs is always made first, while she's still saying the one before."""
        n = len(self.futures)
        wait = self.futures[0] if n == 1 else self.futures[n - 2] if n >= 2 else None
        if wait is None:
            fut = tts._pool.submit(fn, *args)
        else:
            def after(*a):
                try:
                    wait.result(timeout=30)
                except Exception:
                    pass
                return fn(*a)
            fut = tts._pool.submit(after, *args)
        self.futures.append(fut)
        return fut

    def feed(self, piece):
        if not piece:
            return
        self.fed = True
        self.buf += piece
        self.all += piece
        if self.on_text:
            try:
                self.on_text(clean_endearments(strip_emoji(self.all)))
            except Exception:
                pass
        while True:                                   # cut off every finished sentence - or a long one at a comma
            cut = self._cut(self.buf)
            if cut is None:
                return
            self._push(self.buf[:cut])
            self.buf = self.buf[cut:]

    FIRST_CLAUSE, CLAUSE, EARLY = 12, 40, 3      # the first 3 pieces are cut at any comma, later ones only when long

    def _cut(self, buf):
        """where the next piece to voice ends (None = wait for more text). A sentence end always cuts. A comma cuts
        too when the piece is long enough: very early for the first piece (she starts talking in about a second),
        and for long sentences after that - short pieces are voiced side by side, so the next one is ready in time,
        while short sentences stay whole so they keep their natural melody."""
        for m in re.finditer(r"[.!?~…]+[\"')\]]*\s+|\n+", buf):
            if len(buf[:m.end()].strip()) >= self.MIN_SENTENCE:
                return m.end()
        least = self.FIRST_CLAUSE if self.pushed < self.EARLY else self.CLAUSE
        for m in re.finditer(r"[,;:—–]\s+", buf):
            piece = buf[:m.end()].strip()
            if len(piece) >= least and len(piece.split()) >= 3:     # "Good morning, darling!" stays whole
                return m.end()
        return None

    def finish(self, text=None):
        print(f"{persona['name']}: {self.all or text}")
        if not self.fed and text:
            self.feed(text)
        if self.buf.strip():
            self._push(self.buf)
        self.buf = ""
        if self.thread:
            self.q.put(None)
            self.thread.join()

    def _play_all(self):
        global stop_flag
        import numpy as np
        import sounddevice as sd
        with _speak_lock:                             # never play two voices at once
            stop_flag = False
            started = False
            listener = _start_barge_in() if (barge_in and voice_mode) else None
            try:
                while True:
                    item = self.q.get()
                    if item is None:
                        break
                    if stop_flag:
                        continue                      # drain the queue quietly
                    sentence, future, gain, face = item
                    try:
                        data, samplerate = future.result(timeout=60)
                    except Exception as e:
                        print(f"[TTS error] {e}")
                        continue
                    if stop_flag:
                        continue
                    if not started:
                        _duck("speak")                # music and other apps get quieter while she talks
                        emit("speaking", on=True, text=self.all)
                        started = True
                    if face:                          # her face shows the feeling while she says it
                        emit("expression", name=face, seconds=round(len(data) / samplerate + 0.8, 1))
                    sd.play(np.asarray(data, dtype="float32") * min(1.6, max(0.1, VOICE_VOLUME * self.vol_x * gain)), samplerate)
                    end = time.time() + len(data) / samplerate + self.pause
                    while time.time() < end and not stop_flag:
                        time.sleep(0.03)
                sd.stop()
            except Exception as e:
                print(f"[TTS error] {e}")
            finally:
                if listener:
                    try:
                        listener.stop(); listener.close()
                    except Exception:
                        pass
                if started:
                    _unduck("speak")
                emit("speaking", on=False)


def _duck(reason):
    try:
        import ducking
        ducking.duck(reason)
    except Exception as e:
        print(f"[ducking] {e}")


def _unduck(reason=None, delay=None):
    try:
        import ducking
        if reason is None:
            ducking.release_all()
        else:
            ducking.release(reason, delay)
    except Exception as e:
        print(f"[ducking] {e}")


ENDEARMENTS = re.compile(r",?\s*\b(?:my\s+)?(?:darling|babe|baby|sweetie|sweetheart|honey|dear(?:est)?|love|cutie|hun)\b(?=\s*[,.!?~…]|\s*$)",
                         re.I)


def clean_endearments(text):
    """No pet names: 'Yes, darling?' -> 'Yes?'"""
    t = ENDEARMENTS.sub("", text or "")
    t = re.sub(r"^\s*(?:darling|babe|sweetie|sweetheart|honey|love)\s*[,!]\s*", "", t, flags=re.I)
    t = re.sub(r"\s+([,.!?~…])", r"\1", t)
    return t.strip()


def speak(text, voice=None, rate=None, pitch=None, rvc=None):
    """Say text out loud and wait until it finishes (stop_speaking() interrupts).
    Sentences are made in parallel, so the first one starts playing almost straight away."""
    if not text:
        return
    if not tts_ready:
        print(f"{persona['name']}: {text}")
        return
    SpeechStream(voice, rate, pitch, rvc=rvc).finish(text)


def _use_chatter(text):
    """The Emotional voice (Chatterbox) is on and this is English (it can't speak other languages)."""
    if not VOICE_CHATTER or (persona.get("language") or "auto") not in ("auto", "en"):
        return False
    if heard_language and time.time() - heard_language[1] < 90 and heard_language[0] != "en":
        return False
    letters = re.sub(r"[^\w]", "", re.sub(r"\[[^\]]*\]", "", text or ""))
    return bool(letters) and sum(c.isascii() for c in letters) >= 0.9 * len(letters)


def warm_chatter():
    """Load the Emotional voice in the background (the first load takes a while)."""
    try:
        import chatter
        if chatter.status()["ready"]:
            chatter.warm(*_chatter_base(VOICE, VOICE_RATE, VOICE_PITCH, VOICE, VOICE_RVC))
    except Exception as e:
        print(f"[Chatterbox] {e}")


def _chatter_base(voice, rate, pitch, fallback, clone):
    """(base voice id, make_ref) - Chatterbox copies the timbre of the voice the character would normally use.
    Only the pitch counts: the speed changes with every feeling, and Chatterbox picks its own pace."""
    base = voice
    if clone and clone.get("model"):
        import rvc
        base = rvc.base_voice(clone, "en", voice)
    return f"{base}|{pitch}", lambda t: tts.synth(t, base, "+0%", pitch, fallback)


def synth_voice(text, voice, rate, pitch, fallback, rvc_cfg=None, style=None):
    """One sentence -> (samples, rate). With an RVC voice clone: a normal voice says it first (in the right
    language), then RVC makes it sound like the clone. If RVC fails, the normal voice is used.
    style (expressive.plan) adds the melody, pauses and breaths; the melody goes in before RVC.
    With the Emotional voice (Chatterbox) on, Chatterbox says it instead of the normal voice - it acts the line
    out itself, so the melody isn't added (breaths, pauses and the RVC clone still are)."""
    clone = rvc_cfg if (rvc_cfg and rvc_cfg.get("model")) else None
    if _use_chatter(text):
        try:
            import chatter
            samples, sr = chatter.synth(text, *_chatter_base(voice, rate, pitch, fallback, clone))
            if clone:
                import rvc
                try:
                    samples, sr = rvc.convert(samples, sr, clone)
                except Exception as e:
                    print(f"[RVC] {e} - using the Chatterbox voice.")
            if style:
                import expressive
                samples = expressive.finish(samples, sr, {k: v for k, v in style.items() if k not in ("tone", "drive")})
            return samples, sr
        except Exception as e:
            print(f"[Chatterbox] {e} - using the normal voice.")
            text = re.sub(r"\s*\[[^\]]*\]\s*", " ", text).strip() or text
    if not clone and not style:
        return tts.synth(text, voice, rate, pitch, fallback)
    base = voice
    if clone:
        import rvc
        lang = rvc.text_language(text) or (persona.get("language") if persona.get("language") not in (None, "auto") else None)
        if not lang and heard_language and time.time() - heard_language[1] < 120:
            lang = heard_language[0]
        base = rvc.base_voice(clone, lang, voice)
    samples, sr = None, None
    if style:
        import expressive
        try:
            samples, sr = expressive.speak_parts(text, style, lambda part: tts.synth(part, base, rate, pitch, fallback))
        except Exception as e:
            print(f"[voice] {e} - without the melody.")
            style = None
    if samples is None:
        samples, sr = tts.synth(text, base, rate, pitch, fallback)
    if clone:
        try:
            samples, sr = rvc.convert(samples, sr, clone)
        except Exception as e:
            print(f"[RVC] {e} - using the normal voice.")
    if style:
        try:
            samples = expressive.finish(samples, sr, style)
        except Exception as e:
            print(f"[voice] {e}")
    return samples, sr


def _shift(value, delta, unit):
    """'+5%' + 10 -> '+15%'"""
    m = re.match(r"\s*([+-]?\d+(?:\.\d+)?)", str(value or "0"))
    n = (float(m.group(1)) if m else 0) + delta
    return f"{'+' if n >= 0 else ''}{n:g}{unit}"


def _voice_for_language():
    """If the user just spoke another language (e.g. Spanish), answer with an installed voice for it."""
    if not heard_language or time.time() - heard_language[1] > 120:
        return None
    lang = heard_language[0]
    current = (VOICE.split(":")[-1].split("_")[0] if VOICE else "en")
    if lang == current:
        return None
    try:
        return tts.voice_for_language(lang, female=True)
    except Exception as e:
        print(f"[voice language] {e}")
        return None


def _start_barge_in():
    """Listen while she talks; if the user talks over her for ~0.3 s, stop speaking."""
    import numpy as np
    import sounddevice as sd
    try:
        base = (_recognizer.energy_threshold / 32768.0) if _recognizer else 0.02
    except Exception:
        base = 0.02
    threshold = max(0.03, base * 3)
    loud = {"n": 0}

    def cb(indata, _frames, _t, _status):
        global stop_flag
        level = float(np.sqrt(np.mean(indata.astype("float32") ** 2)))
        loud["n"] = loud["n"] + 1 if level > threshold else 0
        if loud["n"] >= 10 and not stop_flag:            # 10 blocks x 32 ms
            stop_flag = True
            emit("interrupted")
    try:
        st = sd.InputStream(samplerate=16000, channels=1, dtype="float32", blocksize=512, callback=cb)
        st.start()
        return st
    except Exception as e:
        print(f"[barge-in] {e}")
        return None


def stop_speaking():
    global stop_flag
    stop_flag = True


f1.set_speaker(speak)


# --------------------- Listen ----------------#
def _get_recognizer():
    """Create the recognizer once and calibrate the mic once (saves ~1s per listen)."""
    global _recognizer
    if _recognizer is None:
        import speech_recognition as sr
        _recognizer = sr.Recognizer()
        _recognizer.pause_threshold = 1.5
        with sr.Microphone(device_index=MIC_INDEX) as source:
            _recognizer.adjust_for_ambient_noise(source, duration=1)
    return _recognizer


def listen_for_input(prompt=None, timeout=10, phrase_time_limit=30):
    """Listen once on the mic and return the text, or None if nothing was understood."""
    import speech_recognition as sr
    recognizer = _get_recognizer()
    try:
        with sr.Microphone(device_index=MIC_INDEX) as source:
            audio = recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)
        import stt
        import numpy as np
        wav = audio.get_wav_data(convert_rate=16000, convert_width=2)
        samples = np.frombuffer(wav[44:], dtype=np.int16).astype("float32") / 32768.0
        if noise_filter:
            try:
                import denoise
                text = stt.transcribe(denoise.reduce_noise(samples))
            except Exception as e:
                print(f"[noise filter] {e}")
                text = stt.transcribe(wav)
        else:
            text = stt.transcribe(wav)
        if not text:
            return None
        global voice_mood, heard_language
        if stt.last_language and stt.last_language_prob > 0.75:
            heard_language = (stt.last_language, time.time())
        try:
            import numpy as np
            import voicemood
            m = voicemood.mood(samples, text)
            voice_mood = (m, time.time()) if m else None
        except Exception as e:
            print(f"[voice mood] {e}")
        print(f"You said: {text}")
        emit("heard", text=text)
        return text
    except sr.WaitTimeoutError:
        return None
    except sr.UnknownValueError:
        return None
    except sr.RequestError as e:
        print(f"Speech recognition service error: {e}")
        return None


def ask(prompt):
    """Ask a follow-up question by voice or text, depending on the current mode."""
    if ask_hook and getattr(_ctx, "source", None) == "text":   # typed in the app window
        return ask_hook(prompt)
    if voice_mode:
        speak(prompt)
        return listen_for_input(prompt)
    answer = input(f"Vermeil: {prompt}\nYou: ").strip()
    return answer or None


# --------- small helpers for follow-up answers ---------
_NOTE_PREFIXES = [r"^(note (this )?(down)?[:\s-]+)", r"^(remember (this )?[:\s-]+)",
                  r"^(save (this )?[:\s-]+)", r"^(write (down )?[:\s-]+)"]
_SEARCH_PREFIXES = [r"^(search for\s+)", r"^(look up\s+)", r"^(find\s+)"]


def _strip_prefixes(text, patterns):
    if not text:
        return text
    t = text.strip()
    for p in patterns:
        t = re.sub(p, "", t, flags=re.I)
    return t.strip()


def _parse_time(text):
    """'17:30', '5:30 pm', '5 pm', '5.30 p.m.' -> datetime.time"""
    t = text.strip().lower().replace(".", ":").replace("p:m:", "pm").replace("a:m:", "am")
    t = t.replace("p:m", "pm").replace("a:m", "am").rstrip(":")
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$", t)
    if not m or (m.group(2) is None and m.group(3) is None):
        raise ValueError("Could not parse time")
    hh, mm, ampm = int(m.group(1)), int(m.group(2) or 0), m.group(3)
    if ampm == "pm" and hh != 12:
        hh += 12
    if ampm == "am" and hh == 12:
        hh = 0
    if hh > 23 or mm > 59:
        raise ValueError("Could not parse time")
    return datetime.strptime(f"{hh:02d}:{mm:02d}", "%H:%M").time()


def _parse_datetime(text):
    """Return 'YYYY-MM-DD HH:MM' or None. Accepts '2025-09-18 18:30', 'tomorrow at 5:30 pm', 'today 5 pm'."""
    if not text:
        return None
    text = text.strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M", "%Y-%m-%d %I:%M %p", "%d-%m-%Y %H:%M"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d %H:%M")
        except ValueError:
            pass
    m = re.search(r"\b(today|tomorrow|tonight)\b(?:\s+at)?\s+(.+)$", text, flags=re.I)
    if m:
        try:
            tm = _parse_time(m.group(2))
        except ValueError:
            return None
        base = datetime.now().date() + timedelta(days=1 if m.group(1).lower() == "tomorrow" else 0)
        return datetime.combine(base, tm).strftime("%Y-%m-%d %H:%M")
    return None


def _ask_text(prompt, max_retries=2, clean=None):
    for _ in range(max_retries + 1):
        resp = ask(prompt)
        if resp:
            return clean(resp) if clean else resp.strip()
    return None


# ---------------- ask_for_* (follow-up questions) ----------------
def ask_for_equation(prompt="What's the equation you'd like me to solve?"):
    return _ask_text(prompt)


def ask_for_city(prompt="Which city?"):
    return _ask_text(prompt)


def ask_for_query(prompt="What should I search for?"):
    return _ask_text(prompt, clean=lambda r: _strip_prefixes(r, _SEARCH_PREFIXES))


def ask_for_note(prompt="What should I note down?"):
    return _ask_text(prompt, clean=lambda r: _strip_prefixes(r, _NOTE_PREFIXES))


def ask_for_event(prompt="What is the event?"):
    return _ask_text(prompt)


def ask_for_datetime(prompt="When? Say something like 'tomorrow at 5:30 pm' or '2026-10-20 18:30'.", max_retries=2):
    for attempt in range(max_retries + 1):
        parsed = _parse_datetime(ask(prompt) or "")
        if parsed:
            return parsed
        prompt = "I didn't get that. Say it like 'tomorrow at 5:30 pm' or '2026-10-20 18:30'."
    return None


def _ask_date_iso():
    dt = ask_for_datetime("When is it? Say something like 'tomorrow at 5 pm'.")
    return dt[:10] if dt else None


def ask_for_task(prompt="What task should I add?"):
    return _ask_text(prompt)


def ask_for_time(prompt="What time? (like '5:30 pm', or say 'skip')", max_retries=2):
    for _ in range(max_retries + 1):
        resp = ask(prompt)
        if resp and resp.strip().lower() in ("skip", "none", "no", "no time"):
            return None
        if resp:
            try:
                return _parse_time(resp).strftime("%H:%M")
            except ValueError:
                prompt = "I couldn't read that time. Try '17:30' or '5:30 pm', or say 'skip'."
    return None


def ask_for_day(prompt="Which day? (e.g. Monday, today, tomorrow)"):
    resp = _ask_text(prompt)
    if not resp:
        return None
    r = resp.lower()
    if r == "today":
        return datetime.now().strftime("%A")
    if r == "tomorrow":
        return (datetime.now() + timedelta(days=1)).strftime("%A")
    for wd in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
        if wd in r:
            return wd.capitalize()
    return resp


def ask_for_activity(prompt="What activity should I add?"):
    return _ask_text(prompt)


def ask_for_priority(prompt="What priority? (low, normal, high)"):
    resp = (_ask_text(prompt) or "normal").lower()
    return next((p for p in ("low", "high", "normal") if p in resp), "normal")


def ask_for_deadline(prompt="What's the deadline? (or say 'skip')"):
    resp = _ask_text(prompt)
    return None if not resp or resp.lower() in ("skip", "none", "no") else resp


def ask_for_name(prompt="Whose birthday is this?"):
    return _ask_text(prompt)


def ask_for_date(prompt="What's the date? (like 'March 5')"):
    return _ask_text(prompt)


def ask_for_items(prompt="What items should I add to the shopping list?"):
    return _ask_text(prompt)


def ask_for_recipient(prompt="Who should I send it to? Say the email address."):
    return _ask_text(prompt)


def ask_for_subject(prompt="What is the subject?"):
    return _ask_text(prompt)


def ask_for_message(prompt="What message should I send?"):
    return _ask_text(prompt)


def ask_for_platform(prompt="Which platform? (Gmail, SMS, Discord)"):
    resp = _ask_text(prompt)
    return resp.lower() if resp else None


def ask_for_song(prompt="What song or artist should I play?"):
    return _ask_text(prompt)


_ONES = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve "
                                   "thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split())}
_TENS = {w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())}


def words_to_number(text):
    """'95', 'ninety five', 'one hundred' -> int, or None."""
    m = re.search(r"\d+", text)
    if m:
        return int(m.group())
    total, found = 0, False
    for w in re.findall(r"[a-z]+", text.lower()):
        if w in _ONES:
            total += _ONES[w]; found = True
        elif w in _TENS:
            total += _TENS[w]; found = True
        elif w == "hundred":
            total = max(total, 1) * 100; found = True
    return total if found else None


def ask_for_percentage(prompt="What volume percentage (1-100)?", max_retries=2):
    for _ in range(max_retries + 1):
        resp = ask(prompt)
        if resp:
            n = words_to_number(resp)
            if n is not None and 1 <= n <= 100:
                return n
            prompt = "Please say a number between 1 and 100."
    return None


def confirm(action):
    resp = ask(f"Are you sure you want to {action}? Say yes to confirm.")
    return bool(resp) and resp.strip().lower().startswith(("yes", "yeah", "yep", "sure", "confirm"))


def _confirmed(action, fn):
    return fn() if confirm(action) else f"Okay, I won't {action}."


# ------------------ Command matching ------------------#
_FILLERS = [
    r"\bplease\b", r"\bkindly\b", r"\bwould you\b", r"\bcould you\b", r"\bcan you\b", r"\bwill you\b",
    r"\bplz\b", r"\bpls\b", r"\bvermi\b", r"\bvermeil\b", r"\bhey\b", r"\bok\b", r"\bokay\b",
    r"\bjust\b", r"\bnow\b", r"\bfor me\b", r"\bthe\b", r"\ba\b", r"\bmy\b", r"\bthanks\b", r"\bthank you\b",
]

# Single words that also appear in normal chat ("I had a great time") only match fuzzily, never by keyword.
_CHATTY_KEYS = {"time", "date", "search", "volume", "shutdown", "restart", "log off"}


_SYNONYMS = {"show": "view", "list": "view", "check": "view", "display": "view", "read": "view",
             "delete": "remove", "erase": "remove", "notes": "note", "reminders": "reminder",
             "tasks": "task", "birthday": "birthdays", "shut": "shutdown"}


def _normalize(text):
    words = re.findall(r"[a-z']+", text.lower())
    return " ".join(_SYNONYMS.get(w, w) for w in words)


def clean_sentence_for_commands(sentence):
    cleaned = sentence.lower()
    for f in _FILLERS:
        cleaned = re.sub(f, " ", cleaned)
    return _normalize(cleaned)


def get_best_command_match(command_text, command_map, threshold=75):
    """Find which command a sentence means.
    1) all words of a command appear in the sentence ('can you add a note' -> 'add note');
    2) otherwise fuzzy match the whole cleaned sentence against the command names."""
    cleaned = clean_sentence_for_commands(command_text)
    if not cleaned:
        return None
    words = set(cleaned.split())
    keys = {_normalize(k): k for k in command_map}               # normalized name -> real name
    keyword_hits = [k for nk, k in keys.items() if k not in _CHATTY_KEYS and set(nk.split()) <= words]
    if keyword_hits:
        return max(keyword_hits, key=lambda k: len(k.split()))   # most specific wins
    best, score, _ = process.extractOne(cleaned, list(keys), scorer=fuzz.token_sort_ratio)
    return keys[best] if score >= threshold else None


def build_command_map():
    return {
        # Weather / time / search
        "weather": lambda: f1.get_weather(ask_for_city()),
        "time": f1.get_time_date,
        "date": f1.get_time_date,
        "search": lambda: f1.web_search(ask_for_query()),
        # Math
        "solve math": lambda: f1.solve_math(ask_for_equation()),
        # System (always asks for confirmation first)
        "shutdown": lambda: _confirmed("shut down the computer", lambda: f1.system_control("shutdown")),
        "restart": lambda: _confirmed("restart the computer", lambda: f1.system_control("restart")),
        "log off": lambda: _confirmed("log off", lambda: f1.system_control("log off")),
        # Notes
        "add note": lambda: f1.manage_notes("add", ask_for_note()),
        "clear notes": lambda: f1.manage_notes("clear"),
        "remove note": lambda: f1.manage_notes("remove", ask_for_note("Which note should I remove?")),
        "view note": lambda: f1.manage_notes("view"),
        # Reminders
        "add reminder": lambda: f1.add_reminder(ask_for_event(), ask_for_datetime()),
        "clear reminders": f1.clear_reminders,
        "remove reminder": lambda: f1.remove_reminder(ask_for_event("Which reminder should I remove?")),
        "view reminder": f1.get_reminders,
        # Tasks
        "add task": lambda: f1.add_task(ask_for_task(), ask_for_time(), ask_for_priority(), ask_for_deadline()),
        "clear tasks": f1.clear_tasks,
        "remove task": lambda: f1.remove_task(ask_for_task("Which task should I remove?")),
        "view task": f1.get_tasks,
        # Volume
        "set volume": lambda: f1.set_volume(ask_for_percentage()),
        "volume": lambda: f1.set_volume(ask_for_percentage()),
        # Schedule
        "add schedule": lambda: f1.add_schedule(ask_for_day(), ask_for_activity(), ask_for_time()),
        "clear schedule": f1.clear_schedule,
        "remove schedule": lambda: f1.remove_schedule(ask_for_day(), ask_for_activity("Which activity should I remove?")),
        "view schedule": f1.get_schedule,
        # Music
        "play music": lambda: f1.music_control("play", ask_for_song()),
        "stop music": lambda: f1.music_control("stop"),
        "skip music": lambda: f1.music_control("skip"),
        "shuffle music": lambda: f1.music_control("shuffle"),
        "queue music": lambda: f1.music_control("queue"),
        "clear queue": lambda: f1.music_control("clear queue"),
        "play playlist": lambda: f1.music_control("playlist"),
        "show playlist": lambda: f1.music_control("show playlist"),
        # Messages
        "send email": lambda: f1.send_email(ask_for_recipient(), ask_for_subject(), ask_for_message()),
        "send message": lambda: f1.send_message(ask_for_platform(), ask_for_recipient(), ask_for_message()),
        # Calendar / agenda / birthdays
        "calendar sync": f1.sync_calendar,
        "add event": lambda: f1.add_event(ask_for_event("What's the event?"), _ask_date_iso(), ask_for_time()),
        "view calendar": f1.view_calendar,
        "today agenda": f1.daily_agenda,
        "add birthday": lambda: f1.add_birthday(ask_for_name(), ask_for_date()),
        "view birthdays": f1.get_birthdays,
        # Camera / vision
        "camera on": f1.camera_on,
        "camera off": f1.camera_off,
        "vision mode": f1.camera_on,
        "vision mode off": f1.camera_off,
        # Shopping
        "add shopping": lambda: f1.add_shopping_items(ask_for_items()),
        "view shopping": f1.get_shopping_list,
        "clear shopping": f1.clear_shopping_list,
    }


def handle_input(user_input, memory, command_map, speaker=None):
    """The AI answers and uses tools by itself. If the AI can't be reached, fall back to the old keyword commands."""
    if quick_command:                       # instant commands (switch character, gym timer...) - no AI wait
        try:
            fast = quick_command(user_input)
        except Exception as e:
            print(f"[quick command] {e}")
            fast = None
        if fast:
            return clean_endearments(strip_emoji(fast))
    reply = get_vermeil_response(persona.get("memory_key", "user"), user_input, memory, none_on_error=True,
                                 on_text=speaker.feed if (speaker and stream_speech) else None)
    if reply is not None:
        return reply
    matched = get_best_command_match(user_input, command_map)
    if matched:
        print(f"[command: {matched}]")
        try:
            return command_map[matched]() or "Done."
        except Exception as e:
            return f"Oops, something went wrong with {matched}: {e}"
    return "Mmm, my mind went blank for a second. I can't reach my brain right now - check the internet or your API key."


# ------------------ Voice mode ------------------#
def _is_wake_word(text):
    words = re.findall(r"[a-z]+", text.lower())
    return any(w in WAKE_ALIASES or fuzz.ratio(w, WAKE_WORD) >= 80 for w in words)


noise_filter = True           # clean background noise before Whisper (Settings)
wake_sensitivity = 2          # trained wake word: 1 strict, 2 normal, 3 easy


on_wake = None                # app.py: called when the wake word is heard (switches back to Vermeil)


def _wake_up():
    global conversation_active
    if on_wake:
        try:
            on_wake()
        except Exception as e:
            print(f"[wake] {e}")
    conversation_active = True
    emit("listening", state="awake")
    speak("Yes?")
    return True


def listen_for_wake_word():
    """Wait until the wake word is heard (or the user switches to text mode)."""
    global conversation_active
    print("Listening for wake word...")
    try:
        import wakeword
        if wakeword.trained():                    # your own recorded "vermi": fast, offline, no Whisper
            if wakeword.listen(lambda: voice_mode, wake_sensitivity, MIC_INDEX):
                return _wake_up()
            return False
    except Exception as e:
        print(f"[wake word] {e} - using speech recognition instead")
    while voice_mode:
        text = listen_for_input(timeout=5, phrase_time_limit=6)
        if text and _is_wake_word(text):
            return _wake_up()
    return False


def listen_for_command(memory, command_map):
    """Keep talking until there are INACTIVITY_LIMIT seconds of silence."""
    global conversation_active
    print("Listening for commands...")
    last_heard = time.time()
    try:
        while conversation_active and voice_mode:
            user_input = listen_for_input(timeout=10, phrase_time_limit=30)
            if not user_input:
                if time.time() - last_heard > INACTIVITY_LIMIT:
                    print("No input for a while, going back to wake-word mode.")
                    conversation_active = False
                    emit("listening", state="waiting")
                continue
            last_heard = time.time()
            speaker = SpeechStream(on_text=lambda t: emit("partial", text=t)) if (stream_speech and tts_ready) else None
            reply = handle_input(user_input, memory, command_map, speaker=speaker)
            emit("reply", text=reply)
            if speaker:
                speaker.finish(reply)
            else:
                speak(reply)
            last_heard = time.time()
    finally:
        _unduck()                                 # other sounds only go quieter while she speaks a reply; never leave them down


# ------------------ Text mode ------------------#
def listen_for_text(memory, command_map):
    print("\n" + "=" * 50 + "\n⌨️ TEXT MODE  (press ` then Enter to go back to voice)\n" + "=" * 50)
    while not voice_mode:
        try:
            user_input = input("\nYou: ").strip()
        except EOFError:
            return
        if voice_mode:
            break
        if user_input:
            print(f"Vermeil: {handle_input(user_input, memory, command_map)}")


def toggle_input_mode():
    global voice_mode, conversation_active
    voice_mode = not voice_mode
    conversation_active = False
    if voice_mode:
        print("\n🎙️ VOICE MODE - press Enter once, then say 'vermi'.")
    else:
        print("\n⌨️ TEXT MODE ACTIVATED")


# ------------ Main -----------------#
def main():
    import keyboard
    start_tts()
    memory = load_memory()
    command_map = build_command_map()
    keyboard.add_hotkey("`", toggle_input_mode, suppress=True)

    print("\n" + "=" * 50 + "\n        VERMEIL IS READY\n" + "=" * 50)
    print("🎙️ Voice mode → say 'vermi'\n⌨️ Text mode  → press `\n" + "=" * 50)
    while True:
        try:
            if voice_mode:
                if listen_for_wake_word():
                    listen_for_command(memory, command_map)
            else:
                listen_for_text(memory, command_map)
        except KeyboardInterrupt:
            print("\n\nShutting down Vermeil...")
            f1.music_control("stop")
            break
        except Exception as e:
            print(f"\nMain loop error: {e}")
            time.sleep(1)


if __name__ == "__main__":
    main()
