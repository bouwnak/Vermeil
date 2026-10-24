"""
kokoro.py - Vermeil's "online" voice: Kokoro TTS running INSIDE this app (no Docker, no server, no waiting).

How it works (beginner version):
- The Kokoro voice model lives in this project, in  tools\\kokoro\\  (two files: kokoro-v1.0.onnx and voices-v1.0.bin).
- It runs with the small "kokoro-onnx" Python package (install once:  python -m pip install kokoro-onnx).
  It uses onnxruntime - the same engine your Piper voices already use.
- When the app starts, start() loads the model in the background (a few seconds), so the app never waits for it.
  Until it's loaded, Vermeil simply uses her normal (Piper) voice.
- When the AI is online (Groq), she speaks with her Kokoro voice. Offline (local Ollama), she uses Piper as before.

Settings in .env (all optional):
  KOKORO_MODEL_DIR=C:\\path\\to\\folder   where kokoro-v1.0.onnx and voices-v1.0.bin are (default: tools\\kokoro)
  KOKORO_AUTOSTART=0                     don't load Kokoro when the app starts
  KOKORO_QUALITY=fast                    use the int8 model from scripts\\make_kokoro_fast.py (only if it's faster here)

Much faster voice: an NVIDIA graphics card. Install the GPU engine once and Kokoro uses the card by itself:
    python -m pip uninstall -y onnxruntime
    python -m pip install "onnxruntime-gpu[cuda,cudnn]"
  KOKORO_URL=http://127.0.0.1:8880       advanced: use a Kokoro-FastAPI server you run yourself instead
"""
import io
import os
import re
import sys
import time
import threading

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, os.path.join(os.path.dirname(_HERE), "brain")):
    if _p not in sys.path:
        sys.path.append(_p)

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DIR = os.path.join(PROJECT, "tools", "kokoro")
# first one found is used. The int8 model (scripts\make_kokoro_fast.py) is only faster on SOME CPUs - on others
# (e.g. a laptop i5/Ryzen) it's slower - so it's used only with KOKORO_QUALITY=fast in .env.
MODEL_NAMES = ("kokoro-v1.0.onnx", "kokoro-v1.0.fp16.onnx", "kokoro-v1.0.int8.onnx")
if os.environ.get("KOKORO_QUALITY", "").lower() == "fast":
    MODEL_NAMES = ("kokoro-v1.0.int8.onnx", "kokoro-v1.0.onnx", "kokoro-v1.0.fp16.onnx")
VOICES_FILE = "voices-v1.0.bin"
DEFAULT_VOICE = "kokoro:af_heart"
SETUP_HINT = "Kokoro isn't set up yet - double-click scripts\\setup_kokoro.bat once."

# Voices that come with Kokoro v1.0. Letter 1 = accent/language, letter 2 = gender (f/m).
VOICES = ("af_heart af_alloy af_aoede af_bella af_jessica af_kore af_nicole af_nova af_river af_sarah af_sky "
          "am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa "
          "bf_alice bf_emma bf_isabella bf_lily bm_daniel bm_fable bm_george bm_lewis "
          "jf_alpha jf_gongitsune jf_nezumi jf_tebukuro jm_kumo zf_xiaobei zf_xiaoni zf_xiaoxiao zf_xiaoyi "
          "zm_yunjian zm_yunxi zm_yunxia zm_yunyang ef_dora em_alex em_santa ff_siwis hf_alpha hf_beta "
          "hm_omega hm_psi if_sara im_nicola pf_dora pm_alex pm_santa").split()
ACCENT = {"a": ("English (US)", "en-US", "en-us"), "b": ("English (UK)", "en-GB", "en-gb"), "j": ("Japanese", "ja-JP", "ja"),
          "z": ("Chinese", "zh-CN", "cmn"), "e": ("Spanish", "es-ES", "es"), "f": ("French", "fr-FR", "fr-fr"),
          "h": ("Hindi", "hi-IN", "hi"), "i": ("Italian", "it-IT", "it"), "p": ("Portuguese (BR)", "pt-BR", "pt-br")}

_state = {"engine": None, "ready": False, "starting": False, "error": "", "voices": None}
_lock = threading.Lock()        # one sentence at a time through the model
_load_lock = threading.Lock()


def folder():
    return os.environ.get("KOKORO_MODEL_DIR") or DEFAULT_DIR


def model_path():
    for name in MODEL_NAMES:
        p = os.path.join(folder(), name)
        if os.path.exists(p):
            return p
    return None


def files_ok():
    return bool(model_path()) and os.path.exists(os.path.join(folder(), VOICES_FILE))


def package_ok():
    try:
        import importlib.util
        return importlib.util.find_spec("kokoro_onnx") is not None
    except Exception:
        return False


def _server():
    return (os.environ.get("KOKORO_URL") or "").rstrip("/")


def installed():
    """Is Kokoro ready to be used on this PC (model files in tools\\kokoro + the kokoro-onnx package)?"""
    return bool(_server()) or (files_ok() and package_ok())


def is_voice(voice):
    return bool(voice) and str(voice).startswith("kokoro:")


def ready():
    """True once the model is loaded (cheap - call it as often as you like)."""
    if _server() and not _state["ready"]:
        _state["ready"] = _server_alive()
    return _state["ready"]


def status():
    return {"installed": installed(), "ready": _state["ready"], "starting": _state["starting"],
            "error": _state["error"], "folder": folder(), "files": files_ok(), "package": package_ok()}


def _missing():
    if not files_ok():
        return f"{SETUP_HINT} (the model files aren't in {folder()})"
    if not package_ok():
        return "Kokoro's Python package is missing - run:  python -m pip install kokoro-onnx"
    return ""


def _load():
    """Load the model (a few seconds). Safe to call from several threads."""
    with _load_lock:
        if _state["ready"]:
            return True
        _state["starting"] = True
        _state["error"] = ""
        t0 = time.time()
        try:
            from kokoro_onnx import Kokoro
            _state["engine"] = Kokoro(model_path(), os.path.join(folder(), VOICES_FILE))
            _state["engine"].create("Hi.", voice="af_heart", speed=1.0, lang="en-us")    # warm-up: the 1st sentence is slow
            _state["ready"] = True
            print(f"[Kokoro] ready ({time.time() - t0:.1f}s, inside the app).")
        except Exception as e:
            _state["engine"] = None
            _state["error"] = f"Couldn't load Kokoro: {e}"
            print(f"[Kokoro] {_state['error']}")
        finally:
            _state["starting"] = False
        return _state["ready"]


def start(wait=False, max_wait=120):
    """Load Kokoro in the background (returns straight away unless wait=True). Returns True if it's ready."""
    if ready():
        return True
    if _server():
        return False
    if os.environ.get("KOKORO_AUTOSTART", "1") == "0" and not wait:
        return False
    problem = _missing()
    if problem:
        _state["error"] = problem
        return False
    if wait:
        return _load()
    if not _state["starting"]:
        _state["starting"] = True
        threading.Thread(target=_load, daemon=True, name="kokoro-load").start()
    return False


def stop():
    """Free the model's memory (it's loaded again by start())."""
    _state["engine"] = None
    if not _server():
        _state["ready"] = False


# ---------------- voices ----------------
def _label(v):
    lang, loc, _ = ACCENT.get(v[0], ("Other", "xx", "en-us"))
    name = v[3:].replace("_", " ").title()
    return {"id": f"kokoro:{v}", "name": f"{name} · Kokoro", "gender": "Female" if v[1:2] == "f" else "Male",
            "locale": loc, "language": lang, "installed": True, "kokoro": True}


def list_voices():
    names = None
    if _state["ready"] and _state["engine"] is not None:
        if _state["voices"] is None:
            try:
                _state["voices"] = list(_state["engine"].get_voices())
            except Exception:
                _state["voices"] = []
        names = [v for v in _state["voices"] if len(v) > 3 and v[2] == "_"]
    return [_label(v) for v in (names or VOICES)]


# ---------------- speaking ----------------
def _num(text):
    m = re.match(r"\s*([+-]?\d+(?:\.\d+)?)", str(text or "0"))
    return float(m.group(1)) if m else 0.0


def synth(text, voice=DEFAULT_VOICE, rate="+0%", pitch="+0Hz", timeout=60):
    """(samples float32, samplerate). Raises if Kokoro isn't loaded (the caller then uses Piper)."""
    name = str(voice or DEFAULT_VOICE).split(":", 1)[-1]
    pitch_factor = max(0.7, min(1.4, 1 + _num(pitch) / 200))
    speed = max(0.5, min(2.0, (1 + _num(rate) / 100) / pitch_factor))   # played faster below = higher pitch
    if _server():
        data, sr = _server_synth(text, name, speed, timeout)
    else:
        if not _state["ready"] and not start(wait=True):
            raise RuntimeError(_state["error"] or "Kokoro isn't loaded")
        lang = ACCENT.get(name[:1], ACCENT["a"])[2]
        with _lock:
            data, sr = _state["engine"].create(text, voice=name, speed=round(speed, 3), lang=lang)
        data = np.asarray(data, dtype=np.float32).reshape(-1)
    return data, int(sr * pitch_factor)


def wav_bytes(text, voice=DEFAULT_VOICE, rate="+0%", pitch="+0Hz"):
    """WAV file bytes (used by the adventure game)."""
    from tts import to_wav_bytes
    return to_wav_bytes(*synth(text, voice, rate, pitch))


# ---------------- advanced: a Kokoro-FastAPI server you run yourself (KOKORO_URL) ----------------
def _server_alive(timeout=1.5):
    try:
        import requests
        return requests.get(f"{_server()}/health", timeout=timeout).status_code == 200
    except Exception:
        return False


def _server_synth(text, name, speed, timeout):
    import requests
    r = requests.post(f"{_server()}/v1/audio/speech", timeout=timeout,
                      json={"model": "kokoro", "input": text, "voice": name, "response_format": "wav",
                            "speed": round(speed, 3), "stream": False})
    r.raise_for_status()
    return _read_wav(r.content)


def _read_wav(raw):
    """WAV bytes -> (float32 mono samples, sample rate), using only the standard library + numpy."""
    import wave
    with wave.open(io.BytesIO(raw), "rb") as w:
        sr, ch, width, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        frames = w.readframes(n)
    if width == 2:
        a = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        a = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        a = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128) / 128.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a.astype(np.float32), sr


if __name__ == "__main__":       # python senses/kokoro.py  -> load it, say something and play it
    print("Kokoro folder:", folder())
    print("Model files:", "OK" if files_ok() else "missing", "| kokoro-onnx package:", "OK" if package_ok() else "missing")
    if not start(wait=True):
        print("Not ready:", _state["error"])
        sys.exit(1)
    t = time.time()
    d, sr = synth("Hi! This is my Kokoro voice, running right inside the app.")
    print(f"OK - {len(d) / sr:.1f} s of audio made in {time.time() - t:.1f} s")
    try:
        import sounddevice as sd
        sd.play(d, sr)
        sd.wait()
    except Exception as e:
        print("(couldn't play it:", e, ")")
