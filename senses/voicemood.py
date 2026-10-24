"""
voicemood.py - guesses your mood from HOW you said something (not the words): loudness, speed and pitch.

It learns YOUR normal voice over time (data/voice_baseline.json), then compares each new sentence with it:
  excited  - louder, faster and/or higher than usual
  tired    - quieter, slower and lower than usual
  stressed - much faster than usual with a jumpy pitch
  calm     - close to your normal
It's a rough guess, used only as a hint for how she answers.
"""
import json

import numpy as np

from paths import data_file

BASE_FILE = data_file("voice_baseline.json")
SR = 16000


def _pitch_track(audio, frame=1024, hop=512):
    """Fundamental frequency (Hz) of each voiced frame, by autocorrelation (70-400 Hz)."""
    pitches = []
    lo, hi = SR // 400, SR // 70
    for start in range(0, len(audio) - frame, hop):
        x = audio[start:start + frame]
        if np.sqrt(np.mean(x ** 2)) < 0.01:              # silence
            continue
        x = x - x.mean()
        ac = np.correlate(x, x, mode="full")[frame - 1:]
        if ac[0] <= 0:
            continue
        seg = ac[lo:hi]
        lag = int(np.argmax(seg)) + lo
        if ac[lag] / ac[0] > 0.3:                         # clearly periodic = voiced
            pitches.append(SR / lag)
    return np.array(pitches)


def features(audio, text=""):
    audio = np.asarray(audio, dtype=np.float32)
    if audio.size < SR // 2:
        return None
    frames = audio[: len(audio) // 400 * 400].reshape(-1, 400)
    rms = np.sqrt((frames ** 2).mean(axis=1))
    voiced = rms > max(0.01, np.percentile(rms, 30))
    voiced_sec = max(voiced.sum() * 400 / SR, 0.3)
    loud = float(20 * np.log10(np.mean(rms[voiced]) + 1e-6)) if voiced.any() else -60.0
    p = _pitch_track(audio)
    words = len(text.split()) if text else 0
    return {"loudness_db": round(loud, 1), "pitch_hz": round(float(np.median(p)), 1) if p.size else None,
            "pitch_spread": round(float(np.std(p) / (np.median(p) + 1e-6)), 3) if p.size > 3 else None,
            "words_per_sec": round(words / voiced_sec, 2) if words else None}


def _base():
    try:
        with open(BASE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def _learn(f):
    """Slowly update 'your normal voice' (exponential average)."""
    b = _base()
    n = b.get("n", 0)
    a = 0.2 if n >= 5 else 1.0 / (n + 1)
    for k, v in f.items():
        if v is not None:
            b[k] = round(v if k not in b else (1 - a) * b[k] + a * v, 3)
    b["n"] = n + 1
    with open(BASE_FILE, "w", encoding="utf-8") as fh:
        json.dump(b, fh)
    return b


def mood(audio, text=""):
    """'excited' / 'tired' / 'stressed' / 'calm', or None while it's still learning your voice."""
    f = features(audio, text)
    if not f:
        return None
    b = _base()
    result = None
    if b.get("n", 0) >= 5:
        d_loud = f["loudness_db"] - b.get("loudness_db", f["loudness_db"])
        r_pitch = (f["pitch_hz"] / b["pitch_hz"]) if f["pitch_hz"] and b.get("pitch_hz") else 1.0
        r_rate = (f["words_per_sec"] / b["words_per_sec"]) if f["words_per_sec"] and b.get("words_per_sec") else 1.0
        spread = (f["pitch_spread"] or 0) / max(b.get("pitch_spread") or 0.1, 0.01)
        if r_rate > 1.3 and spread > 1.4:
            result = "stressed"
        elif (d_loud > 4 and (r_pitch > 1.1 or r_rate > 1.15)) or (r_pitch > 1.15 and r_rate > 1.1):
            result = "excited"
        elif d_loud < -4 and r_rate < 0.88 and r_pitch < 0.97:
            result = "tired"
        else:
            result = "calm"
    _learn(f)
    return result
