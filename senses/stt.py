"""
stt.py - speech to text on YOUR computer (faster-whisper). No internet needed after the first download.

Model size is set with WHISPER_MODEL in .env (or data/local_models.json "whisper"):
  tiny / base  - fastest, ok accuracy        small - good balance (default)
  medium       - better, needs a good PC     large-v3 - best, needs a strong GPU
It understands many languages and detects the language by itself (WHISPER_LANGUAGE=en to force English).
"""
import json
import os
import re

import numpy as np

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")      # harmless Windows warning when downloading

from paths import data_file

_model = None
last_language = None          # language Whisper heard in the last transcription (e.g. "ja")
last_language_prob = 0.0


def _settings():
    try:
        with open(data_file("local_models.json"), encoding="utf-8") as f:
            saved = json.load(f)
    except (OSError, json.JSONDecodeError):
        saved = {}
    return (os.environ.get("WHISPER_MODEL") or saved.get("whisper") or "small",
            os.environ.get("WHISPER_LANGUAGE") or saved.get("whisper_language") or None)


def _cpu_model(size):
    from faster_whisper import WhisperModel
    return WhisperModel(size, device="cpu", compute_type="int8")


def load(force_cpu=False):
    """Load the model once (first time: downloads it). Uses the NVIDIA card only if it really works."""
    global _model
    if _model is None or force_cpu:
        size, _ = _settings()
        import llm
        if force_cpu or llm.cpu_only() or os.environ.get("WHISPER_DEVICE", "").lower() == "cpu":
            _model = _cpu_model(size)
            return _model
        from faster_whisper import WhisperModel
        try:
            gpu = WhisperModel(size, device="cuda", compute_type="float16")
            # the CUDA libraries (cublas, cudnn) only load when it first transcribes - test that now
            list(gpu.transcribe(np.zeros(16000, dtype=np.float32), beam_size=1)[0])
            _model = gpu
        except Exception as e:                              # no NVIDIA card, or CUDA files missing -> CPU
            print(f"[voice] Graphics card not usable for speech recognition ({str(e)[:80]}) - using the CPU.")
            _model = _cpu_model(size)
    return _model


def transcribe(wav_bytes_or_array, keep_all=False, language=None):
    """16 kHz mono WAV bytes (or a float32 numpy array) -> text."""
    if isinstance(wav_bytes_or_array, (bytes, bytearray)):
        data = bytes(wav_bytes_or_array)
        if data[:4] == b"RIFF":
            data = data[44:]                               # skip the WAV header
        audio = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
    else:
        audio = np.asarray(wav_bytes_or_array, dtype=np.float32)
    if audio.size < 1600:                                  # under 0.1 s
        return ""
    language = language or _settings()[1]
    def run(model):
        global last_language, last_language_prob
        segments, info = model.transcribe(audio, language=language, beam_size=1, vad_filter=True,
                                          condition_on_previous_text=False)
        text = " ".join(s.text.strip() for s in segments).strip()
        last_language = getattr(info, "language", None)
        last_language_prob = float(getattr(info, "language_probability", 0) or 0)
        return text
    try:
        text = run(load())
    except Exception as e:
        if not re.search(r"cuda|cublas|cudnn|\.dll|gpu", str(e), re.I):
            raise
        print(f"[voice] {e} - switching speech recognition to the CPU.")
        text = run(load(force_cpu=True))
    # Whisper sometimes "hears" these in silence
    if not keep_all and text.lower().strip(" .!") in ("", "you", "thank you", "thanks for watching", "bye"):
        return ""
    return text
