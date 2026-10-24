"""
tts.py - text to speech, running on YOUR computer with Piper (fast, offline).

- Voices are small files (~60 MB each) kept in data/piper_voices/. Each one is downloaded once
  (internet needed only then), and after that everything works offline.
- 100+ voices in ~40 languages (English, Spanish, French, German, Chinese, Russian, Hindi, Vietnamese...).
  Piper has no Japanese, Korean or Filipino voices yet.
- Speed / pitch from the character settings still work.

Optional: TTS_ENGINE=edge in .env uses the online Microsoft Edge voices instead (needs: pip install edge-tts).

Speed trick: replies are split into sentences that are made in parallel, so the first sentence plays
while the rest are still being made.
"""
import io
import os
import re
import json
import wave
import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests

from paths import data_file

VOICES_DIR = data_file("piper_voices")
CATALOG_FILE = data_file("piper_catalog.json")
CATALOG_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json"
FILE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/{path}"
DEFAULT_VOICE = "piper:en_US-amy-medium"
STARTER_VOICES = ["en_US-amy-medium", "en_US-ryan-medium", "en_US-hfc_female-medium", "en_GB-alba-medium"]

_pool = ThreadPoolExecutor(max_workers=3)
_loaded = {}
_load_lock = threading.Lock()
_catalog = None


def engine():
    return os.environ.get("TTS_ENGINE", "piper").strip().lower()


def available():
    if engine() == "edge":
        try:
            import edge_tts  # noqa: F401
            return True
        except ImportError:
            print("⚠️ edge-tts isn't installed. Run:  pip install edge-tts  (or remove TTS_ENGINE=edge from .env)")
            return False
    try:
        import piper  # noqa: F401
        return True
    except ImportError:
        print("⚠️ Piper isn't installed. Run:  python -m pip install piper-tts")
        return False


def is_edge_voice(name):
    return bool(name) and name.endswith("Neural")


def is_piper_voice(name):
    return bool(name) and name.startswith("piper:")


# Old Edge voice names in saved characters -> a similar offline voice
_EDGE_TO_PIPER = {"en-US-AriaNeural": "en_US-amy-medium", "en-US-AnaNeural": "en_US-hfc_female-medium",
                  "en-US-GuyNeural": "en_US-ryan-medium", "en-US-JennyNeural": "en_US-amy-medium"}


def to_local_voice(name):
    """Any saved voice id -> a Piper voice id."""
    if is_piper_voice(name):
        return name
    if name in globals().get("ONLINE_IDS", ()) and edge_available():
        return name                                   # Japanese / Korean / Filipino... online voices are kept
    if name in _EDGE_TO_PIPER:
        return "piper:" + _EDGE_TO_PIPER[name]
    if is_edge_voice(name):
        locale = "_".join(name.split("-")[:2])            # en-GB-SoniaNeural -> en_GB
        match = next((k for k in installed_voices() if k.startswith(locale)), None) or \
            next((k for k in catalog() if k.startswith(locale)), None)
        if match:
            return "piper:" + match
    return DEFAULT_VOICE


# ---------------- sentences ----------------
def split_sentences(text, min_len=25):
    parts = [p.strip() for p in re.split(r"(?<=[.!?~…])\s+", text.strip()) if p.strip()]
    out = []
    for p in parts:
        if out and len(out[-1]) < min_len:
            out[-1] = f"{out[-1]} {p}"
        else:
            out.append(p)
    return out or ([text.strip()] if text.strip() else [])


# ---------------- voice files ----------------
def catalog():
    """All Piper voices: {key: {...}} (downloaded once, then cached)."""
    global _catalog
    if _catalog is not None:
        return _catalog
    try:
        with open(CATALOG_FILE, encoding="utf-8") as f:
            _catalog = json.load(f)
            return _catalog
    except (OSError, json.JSONDecodeError):
        pass
    try:
        r = requests.get(CATALOG_URL, timeout=20)
        r.raise_for_status()
        _catalog = r.json()
        with open(CATALOG_FILE, "w", encoding="utf-8") as f:
            json.dump(_catalog, f)
    except Exception as e:
        print(f"[TTS] offline - can't get the full voice list ({e}). Showing installed voices only.")
        _catalog = {}
    return _catalog


def installed_voices():
    if not os.path.isdir(VOICES_DIR):
        return []
    return sorted(f[:-5] for f in os.listdir(VOICES_DIR) if f.endswith(".onnx") and os.path.exists(os.path.join(VOICES_DIR, f + ".json")))


def download_voice(key, progress=print):
    """Download one voice (model + config) into data/piper_voices."""
    os.makedirs(VOICES_DIR, exist_ok=True)
    onnx = os.path.join(VOICES_DIR, f"{key}.onnx")
    if os.path.exists(onnx) and os.path.exists(onnx + ".json"):
        return onnx
    info = catalog().get(key)
    if info:
        paths = [p for p in info["files"] if p.endswith((".onnx", ".onnx.json"))]
    else:                                               # build the path from the name: en_US-amy-medium
        lang, name, quality = key.split("-", 2)
        base = f"{lang.split('_')[0]}/{lang}/{name}/{quality}/{key}"
        paths = [base + ".onnx", base + ".onnx.json"]
    for path in paths:
        dest = os.path.join(VOICES_DIR, os.path.basename(path))
        progress(f"Downloading voice {os.path.basename(path)}…")
        with requests.get(FILE_URL.format(path=path), stream=True, timeout=60) as r:
            r.raise_for_status()
            tmp = dest + ".part"
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
            os.replace(tmp, dest)
    return onnx


def _voice(key):
    with _load_lock:
        if key not in _loaded:
            from piper import PiperVoice
            path = download_voice(key)
            _loaded[key] = PiperVoice.load(path)
        return _loaded[key]


# ---------------- making audio ----------------
def _percent(text):
    m = re.match(r"\s*([+-]?\d+(?:\.\d+)?)", str(text or "0"))
    return float(m.group(1)) if m else 0.0


def _piper_audio(text, key, rate, pitch):
    voice = _voice(key)
    speed = max(0.5, 1 + _percent(rate) / 100)            # "+20%" -> 1.2x faster
    pitch_factor = max(0.7, min(1.4, 1 + _percent(pitch) / 200))   # "+20Hz" -> ~10% higher
    length_scale = pitch_factor / speed                   # resampling below speeds it up again
    sample_rate = voice.config.sample_rate
    try:                                                  # piper-tts 1.3+
        from piper import SynthesisConfig
        chunks = voice.synthesize(text, syn_config=SynthesisConfig(length_scale=length_scale))
        audio = np.concatenate([c.audio_float_array if hasattr(c, "audio_float_array")
                                else c.audio_int16_array.astype(np.float32) / 32768.0 for c in chunks])
    except ImportError:                                   # piper-tts 1.2
        raw = b"".join(voice.synthesize_stream_raw(text, length_scale=length_scale))
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return audio.astype(np.float32), int(sample_rate * pitch_factor)   # play faster = higher pitch


async def _edge_bytes(text, voice, rate, pitch):
    import edge_tts
    audio = bytearray()
    async for chunk in edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    return bytes(audio)


# Languages Piper has no voice for -> an online Microsoft voice (needs internet + pip install edge-tts)
EDGE_FALLBACK = {"ja": "ja-JP-NanamiNeural", "ko": "ko-KR-SunHiNeural", "tl": "fil-PH-BlessicaNeural",
                 "fil": "fil-PH-BlessicaNeural", "th": "th-TH-PremwadeeNeural", "he": "he-IL-HilaNeural",
                 "bn": "bn-IN-TanishaaNeural", "ta": "ta-IN-PallaviNeural", "ur": "ur-PK-UzmaNeural",
                 "zh": "zh-CN-XiaoxiaoNeural", "yue": "zh-HK-HiuGaaiNeural", "ms": "ms-MY-YasminNeural",
                 "id": "id-ID-GadisNeural", "vi": "vi-VN-HoaiMyNeural", "hi": "hi-IN-SwaraNeural"}
_downloading = set()

# Online voices offered in the Characters panel for languages Piper has no voice for (need internet + edge-tts)
ONLINE_VOICES = [("ja-JP-NanamiNeural", "Nanami", "Female"), ("ja-JP-KeitaNeural", "Keita", "Male"),
                 ("ko-KR-SunHiNeural", "SunHi", "Female"), ("ko-KR-InJoonNeural", "InJoon", "Male"),
                 ("fil-PH-BlessicaNeural", "Blessica", "Female"), ("fil-PH-AngeloNeural", "Angelo", "Male"),
                 ("zh-CN-XiaoxiaoNeural", "Xiaoxiao", "Female"), ("zh-CN-YunxiNeural", "Yunxi", "Male"),
                 ("th-TH-PremwadeeNeural", "Premwadee", "Female"), ("th-TH-NiwatNeural", "Niwat", "Male"),
                 ("hi-IN-SwaraNeural", "Swara", "Female"), ("hi-IN-MadhurNeural", "Madhur", "Male"),
                 ("id-ID-GadisNeural", "Gadis", "Female"), ("id-ID-ArdiNeural", "Ardi", "Male"),
                 ("ms-MY-YasminNeural", "Yasmin", "Female"), ("ms-MY-OsmanNeural", "Osman", "Male"),
                 ("vi-VN-HoaiMyNeural", "HoaiMy", "Female"), ("vi-VN-NamMinhNeural", "NamMinh", "Male")]
ONLINE_IDS = {v[0] for v in ONLINE_VOICES} | set(EDGE_FALLBACK.values())
_ONLINE_LANG = {"ja": "Japanese", "ko": "Korean", "fil": "Filipino", "zh": "Chinese", "th": "Thai", "hi": "Hindi",
                "id": "Indonesian", "ms": "Malay", "vi": "Vietnamese"}


def is_online_voice(voice):
    return voice in ONLINE_IDS


def resolve_voice(voice):
    """The voice to really use: online voices stay online (when edge-tts is installed), Kokoro voices stay Kokoro,
    everything else -> Piper."""
    if str(voice or "").startswith("kokoro:"):
        return voice
    if is_online_voice(voice) and (edge_available() or engine() == "edge"):
        return voice
    if is_online_voice(voice):
        return to_local_voice(voice)
    return voice if is_piper_voice(voice) or engine() == "edge" else to_local_voice(voice)


def edge_available():
    try:
        import edge_tts  # noqa: F401
        return True
    except ImportError:
        return False


def voice_for_language(lang, female=True):
    """Best voice for a language Whisper heard: an installed Piper voice, else a Piper voice that's being
    downloaded in the background (used next time), else an online voice, else None (keep the normal voice)."""
    lang = (lang or "").lower()
    have = [k for k in installed_voices() if k.split("_")[0] == lang]
    if have:
        return "piper:" + have[0]
    options = sorted((k for k in catalog() if k.split("_")[0] == lang),
                     key=lambda k: (not k.endswith("-medium"), k))
    if options and options[0] not in _downloading:
        _downloading.add(options[0])
        _pool.submit(download_voice, options[0], lambda *_: None)      # ready for next time
    if lang in EDGE_FALLBACK and edge_available():
        return EDGE_FALLBACK[lang]
    return None


def synth(text, voice=DEFAULT_VOICE, rate="+0%", pitch="+0Hz", fallback=DEFAULT_VOICE):
    """Return (samples, samplerate) for one piece of text."""
    if str(voice or "").startswith("kokoro:"):                       # Kokoro (local server, see kokoro.py)
        try:
            import kokoro
            return kokoro.synth(text, voice, rate, pitch)
        except Exception as e:
            print(f"[TTS] Kokoro voice failed ({e.__class__.__name__}) - using the offline voice.")
            voice = fallback if not str(fallback or "").startswith("kokoro:") else DEFAULT_VOICE
    if is_edge_voice(voice) and (engine() == "edge" or voice in ONLINE_IDS) and edge_available():
        import soundfile as sf
        return sf.read(io.BytesIO(asyncio.run(_edge_bytes(text, voice, rate, pitch))), dtype="float32")
    return _piper_audio(text, to_local_voice(voice)[6:], rate, pitch)


def synth_sentences(text, voice, rate="+0%", pitch="+0Hz", fallback=DEFAULT_VOICE):
    return [_pool.submit(synth, s, voice, rate, pitch, fallback) for s in split_sentences(text)]


def to_wav_bytes(samples, rate):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype(np.int16).tobytes())
    return buf.getvalue()


# ---------------- voice list for the Characters panel ----------------
_LANG = {"en": "English", "es": "Spanish", "fr": "French", "de": "German", "it": "Italian", "pt": "Portuguese",
         "ru": "Russian", "zh": "Chinese", "ar": "Arabic", "hi": "Hindi", "vi": "Vietnamese", "nl": "Dutch",
         "tr": "Turkish", "pl": "Polish", "sv": "Swedish", "uk": "Ukrainian", "el": "Greek", "id": "Indonesian",
         "ms": "Malay", "ne": "Nepali", "fa": "Persian", "fi": "Finnish", "da": "Danish", "no": "Norwegian",
         "cs": "Czech", "hu": "Hungarian", "ro": "Romanian", "sk": "Slovak", "sr": "Serbian", "ca": "Catalan",
         "ka": "Georgian", "kk": "Kazakh", "lb": "Luxembourgish", "sw": "Swahili", "is": "Icelandic", "cy": "Welsh",
         "lv": "Latvian", "sl": "Slovenian", "te": "Telugu", "ml": "Malayalam"}


def _lang_name(code):                                   # en_US -> English (US)
    lang, _, region = code.partition("_")
    return f"{_LANG.get(lang, lang)} ({region})" if region else _LANG.get(lang, lang)


def list_voices():
    """[{id, name, gender, locale, language, installed}] - installed voices first."""
    have = set(installed_voices())
    keys = set(catalog()) | have | set(STARTER_VOICES)
    out = []
    for k in keys:
        try:
            lang, name, quality = k.split("-", 2)
        except ValueError:
            continue
        if quality == "x_low":
            continue
        info = catalog().get(k, {})
        speakers = info.get("num_speakers", 1)
        out.append({"id": f"piper:{k}", "name": f"{name.replace('_', ' ').title()} ({quality})"
                    + (f" · {speakers} speakers" if speakers > 1 else "") + ("" if k in have else " ⤓"),
                    "gender": "", "locale": lang.replace("_", "-"), "language": _lang_name(lang), "installed": k in have})
    for vid, name, gender in ONLINE_VOICES:                      # languages Piper can't speak
        loc = "-".join(vid.split("-")[:2])
        lang = loc.split("-")[0]
        out.append({"id": vid, "name": f"{name} (online)", "gender": gender, "locale": loc,
                    "language": f"{_ONLINE_LANG.get(lang, lang)} ({loc.split('-')[1]})", "installed": True, "online": True})
    out.sort(key=lambda v: (v["language"], not v["installed"], v["name"]))
    return out
