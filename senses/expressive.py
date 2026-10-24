"""expressive.py - makes her sound like a person talking to you, not a voice reading text aloud.

What it adds to every sentence (works with Piper, Edge, Kokoro and RVC voice clones):
  - melody: the pitch rises and falls like real speech. Questions go up at the end, statements settle down,
    happy sentences bounce, sad ones sink, scared ones shake and surprised ones start high.
  - feeling in the sound: angry is louder with a bit of edge, soft and sad are darker and quieter, happy is brighter.
  - pauses: "..." and "—" become real pauses, and the gap after a sentence depends on how it ends (? ... ! .).
  - breathing: a quiet breath before she starts and before long sentences. *sighs* and *gasps* are heard.
  - laughs: *giggles* / *laughs* / *chuckles* are said out loud ("hehe", "haha", "heh").
  - pronunciations: words the voices get wrong are said the way they should sound (a built-in list, plus your own
    in data/pronunciations.json: Settings → Voice → Pronunciations).
  - no two sentences are exactly alike: small random changes in pitch and timing.

How the melody is made: the sentence is first stretched in time without changing its pitch (WSOLA), then played
back at a speed that changes along the sentence. Together that moves the pitch while the length stays the same.
With a voice clone this happens BEFORE RVC, so the clone says the melody in its own voice.
"""
import json
import os
import random
import re

import numpy as np

try:
    from paths import data_file
    PRONUNCIATIONS_FILE = data_file("pronunciations.json")
except Exception:                                                        # used on its own (tests, tools)
    PRONUNCIATIONS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data",
                                       "pronunciations.json")

# The melody of each feeling, in semitones (12 = an octave):
#   mean    how much higher/lower the whole sentence is        slope   how it moves from start to end (- = falls)
#   bounce  sing-song up and down                              tremble a shaky voice (fast wobble)
#   tone    + brighter / - darker and softer                   drive   a bit of edge (angry, excited)
STYLES = {
    "neutral":   dict(mean=0.0, slope=-1.2, bounce=0.0, tremble=0.0, tone=0.0, drive=0.0),
    "happy":     dict(mean=1.6, slope=-0.6, bounce=1.1, tremble=0.0, tone=0.25, drive=0.0),
    "excited":   dict(mean=3.0, slope=-0.3, bounce=1.7, tremble=0.0, tone=0.4, drive=0.2),
    "sad":       dict(mean=-2.0, slope=-2.2, bounce=0.0, tremble=0.3, tone=-0.45, drive=0.0),
    "angry":     dict(mean=-1.0, slope=-1.6, bounce=0.8, tremble=0.0, tone=0.3, drive=0.65),
    "surprised": dict(mean=3.2, slope=-3.2, bounce=0.4, tremble=0.0, tone=0.3, drive=0.0),
    "soft":      dict(mean=-0.6, slope=-0.8, bounce=0.0, tremble=0.0, tone=-0.6, drive=0.0),
    "scared":    dict(mean=2.0, slope=0.0, bounce=0.0, tremble=0.75, tone=0.0, drive=0.0),
}
MAX_SHIFT = 4.5                                       # never move the pitch more than this (semitones)
CTRL = 100                                            # the melody is planned 100 times a second


# ---------------- what she says out loud for an *action* ----------------
_SAY = [(r"laugh", "Haha!"), (r"giggl|tee.?hee", "Hehe!"), (r"chuckl|snicker|smirk", "Heh."),
        (r"\bthink|ponder|hmm|tilts? (her|his) head", "Hmm...")]
_BREATH = [(r"sigh|exhal|yawn", "sigh"), (r"gasp|inhal", "gasp")]


def vocalize(raw):
    """'*giggles* You're silly' -> ('Hehe! You're silly', None); '*sighs* Fine.' -> ('Fine.', 'sigh').
    Other *actions* are left for the text cleaner to remove."""
    sound = None

    def rep(m):
        nonlocal sound
        act = m.group(1).lower()
        for pattern, kind in _BREATH:
            if re.search(pattern, act):
                sound = sound or kind
                return " "
        for pattern, say in _SAY:
            if re.search(pattern, act):
                return f" {say} "
        return m.group(0)

    out = re.sub(r"\*([^*\n]{1,60})\*", rep, raw or "")
    return re.sub(r"\s{2,}", " ", out).strip(), sound


# ---------------- pronunciations ----------------
# Built in, English only: chat words and symbols the voices read wrong. Your own list (Settings) wins over these.
BUILT_IN = {
    "AI": "A.I.", "UI": "U.I.", "API": "A.P.I.", "GPU": "G.P.U.", "CPU": "C.P.U.", "PC": "P.C.", "TTS": "T.T.S.",
    "idk": "I don't know", "btw": "by the way", "omg": "oh my gosh", "imo": "in my opinion", "tbh": "to be honest",
    "brb": "be right back", "ngl": "not gonna lie", "rn": "right now", "pls": "please", "plz": "please",
    "thx": "thanks", "ty": "thank you", "np": "no problem", "lol": "lol", "lmao": "lmao", "w/": "with",
    "e.g.": "for example", "i.e.": "that is", "etc.": "etcetera", "vs.": "versus", "vs": "versus",
    "mhm": "mm-hmm", "mmhm": "mm-hmm", "&": "and", "°C": " degrees Celsius", "°F": " degrees Fahrenheit",
    "km/h": " kilometers per hour",
}
_user_cache = {"mtime": None, "words": {}}


def load_pronunciations():
    """Your own pronunciations: {"word": "how to say it"}."""
    try:
        mtime = os.path.getmtime(PRONUNCIATIONS_FILE)
    except OSError:
        return {}
    if mtime != _user_cache["mtime"]:
        try:
            with open(PRONUNCIATIONS_FILE, encoding="utf-8") as f:
                data = json.load(f)
            _user_cache["words"] = {str(k).strip(): str(v).strip() for k, v in (data or {}).items()
                                    if str(k).strip() and str(v).strip()}
        except Exception as e:
            print(f"[pronunciations] {e}")
            _user_cache["words"] = {}
        _user_cache["mtime"] = mtime
    return dict(_user_cache["words"])


def parse_pronunciations(text):
    """'Vermeil = Ver-may' lines (or 'word: say it') -> dict. Blank lines and # notes are skipped."""
    words = {}
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"(.+?)\s*(?:=|->|:)\s*(.+)$", line)
        if m:
            words[m.group(1).strip()[:60]] = m.group(2).strip()[:120]
    return words


def save_pronunciations(words):
    """words: a dict, or the text from the Settings box. Returns the saved dict."""
    if isinstance(words, str):
        words = parse_pronunciations(words)
    words = {str(k)[:60]: str(v)[:120] for k, v in (words or {}).items() if str(k).strip() and str(v).strip()}
    os.makedirs(os.path.dirname(PRONUNCIATIONS_FILE), exist_ok=True)
    with open(PRONUNCIATIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False, indent=2)
    _user_cache["mtime"] = None
    return words


def pronunciations_text():
    return "\n".join(f"{k} = {v}" for k, v in load_pronunciations().items())


def _swap(text, word, say, case=False):
    pattern = r"(?<![\w])" + re.escape(word) + (r"(?![\w])" if word[-1].isalnum() else "")
    return re.sub(pattern, lambda m: say, text, flags=0 if case else re.I)


def pronounce(text, lang=None):
    """Spell words the way they should sound before the voice reads them."""
    if not text:
        return text
    user = load_pronunciations()
    if (lang or "auto") in ("auto", "en"):
        for word, say in BUILT_IN.items():
            if word.lower() not in (w.lower() for w in user):
                text = _swap(text, word, say, case=word.isupper() and len(word) <= 3)   # "AI" but not "ai"
        text = re.sub(r"([a-zA-Z])\1{2,}", r"\1\1", text)                             # "sooooo" -> "soo"
    for word, say in sorted(user.items(), key=lambda kv: -len(kv[0])):                   # longest first
        text = _swap(text, word, say)
    return re.sub(r"\s{2,}", " ", text).strip()


# ---------------- planning one sentence ----------------
def plan(raw, emotion="neutral", strength=0.0, amount=1.0, natural=True, first=False, sound=None, seed=None):
    """How to say one sentence. raw = the sentence as the AI wrote it. amount = the Emotion slider (0..1.5),
    natural = melody, pauses and breaths even when she isn't feeling anything special. Returns a plain dict."""
    rng = random.Random(seed)
    k = max(0.0, min(1.0, float(strength or 0))) * max(0.0, min(1.5, float(amount or 0)))
    nat = 1.0 if natural else 0.0
    s, n = STYLES.get(emotion, STYLES["neutral"]), STYLES["neutral"]
    text = re.sub(r"\*[^*]*\*", "", raw or "").strip()
    end = text.rstrip(" \"')]~*")
    words = len(re.findall(r"\w+", text))
    yes_no = end.endswith("?") and not re.match(r"\W*(what|why|how|where|when|who|which|whose)\b", text, re.I)
    p = {
        "emotion": emotion, "k": round(k, 3), "seed": rng.randrange(1 << 30),
        "mean": s["mean"] * k + rng.uniform(-0.4, 0.4) * nat,
        "slope": n["slope"] * nat + (s["slope"] - n["slope"]) * k,
        "rise": (2.6 if yes_no else 1.0 if end.endswith("?") else 0.0) * nat,     # questions go up at the end
        "peak": (1.0 if end.endswith("!") else 0.0) * nat,                       # "!" lifts near the end
        "bounce": s["bounce"] * k + 0.35 * nat, "bounce_hz": rng.uniform(1.1, 1.8),
        "tremble": s["tremble"] * k,
        "tone": s["tone"] * min(1.0, k), "drive": s["drive"] * min(1.0, k),
        "breath": None, "pause": 0.0,
    }
    if re.search(r"[,;:—–\-]$", end):            # cut at a comma: the voice stays up ("to be continued"), not a full stop
        p["slope"] *= 0.35
    if natural:
        if end.endswith(("...", "…")):
            p["pause"] = rng.uniform(0.4, 0.6)
        elif end.endswith("?"):
            p["pause"] = rng.uniform(0.2, 0.3)
        elif end.endswith("!"):
            p["pause"] = rng.uniform(0.12, 0.2)
        elif end.endswith((".", "~")):
            p["pause"] = rng.uniform(0.1, 0.2)
        else:                                                                  # cut at a comma
            p["pause"] = rng.uniform(0.02, 0.06)
        if first and rng.random() < 0.7:
            p["breath"] = "in"                                                 # people breathe in before they start
        elif words >= 12 and rng.random() < 0.5:
            p["breath"] = "in"
    if sound and amount:
        p["breath"] = sound                                                    # *sighs* / *gasps*
    return p


def split_pauses(text):
    """'Well... I guess so.' -> [('Well...', 0.45), ('I guess so.', 0)]. Real pauses at ... and dashes."""
    parts, last = [], 0
    for m in re.finditer(r"(\.\.\.|…)(?=\s+\w)|\s+[—–-]{1,2}\s+|—(?=\w)", text):
        piece = text[last:m.end()].strip() if "." in m.group() or "…" in m.group() else text[last:m.start()].strip()
        if len(re.findall(r"\w", piece)) >= 2:
            gap = random.uniform(0.35, 0.55) if ("." in m.group() or "…" in m.group()) else random.uniform(0.22, 0.32)
            parts.append([piece.strip(" —–-"), gap])
            last = m.end()
    rest = text[last:].strip()
    if rest:
        parts.append([rest, 0.0])
    elif parts:
        parts[-1][1] = 0.0
    while len(parts) > 4:                                                      # not too many separate voice calls
        a, b = parts.pop(-2), parts.pop(-1)
        parts.append([a[0] + " " + b[0], b[1]])
    return [tuple(x) for x in parts] or [(text, 0.0)]


# ---------------- the melody ----------------
def _bounds(x, sr):
    """Where the speech starts and ends (the voices leave a little silence around it)."""
    env = np.abs(x)
    th = max(1e-4, env.max() * 0.04)
    loud = np.nonzero(env > th)[0]
    return (int(loud[0]), int(loud[-1])) if len(loud) else (0, len(x) - 1)


def semitones(p, x, sr):
    """The pitch change (semitones) for every 10 ms of the sentence x."""
    n = len(x)
    m = max(2, int(np.ceil(n / sr * CTRL)) + 1)
    t = np.arange(m) / CTRL
    a, b = _bounds(x, sr)
    u = np.clip((t * sr - a) / max(1, b - a), 0, 1)                            # 0..1 through the spoken part
    rng = np.random.default_rng(p.get("seed", 0))
    phase = rng.uniform(0, 2 * np.pi)
    smooth = lambda v: v * v * (3 - 2 * v)                                    # noqa: E731
    s = p["mean"] + p["slope"] * (u - 0.5)
    s = s + p["rise"] * smooth(np.clip((u - 0.72) / 0.28, 0, 1))
    s = s + p["peak"] * np.exp(-((u - 0.7) / 0.12) ** 2)
    s = s + p["bounce"] * np.sin(2 * np.pi * p["bounce_hz"] * t + phase) * np.sin(np.pi * u) ** 0.5
    if p["tremble"]:
        s = s + p["tremble"] * np.sin(2 * np.pi * rng.uniform(5.5, 7.0) * t)
    return np.clip(s, -MAX_SHIFT, MAX_SHIFT)


def _wsola(x, sr, rate):
    """Stretch x in time without changing its pitch. rate[i] (one per 10 ms of x) = how fast to move through x
    there (2 = twice as fast / half as long). Returns (y, src): src[j] = where in x the sample y[j] came from."""
    N = int(sr * 0.03) // 2 * 2
    H, tol = N // 2, int(sr * 0.008)
    win = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N)).astype(np.float32)
    pad = N + tol
    xp = np.concatenate([np.zeros(pad, np.float32), x, np.zeros(pad + N, np.float32)])
    chosen, pos, prev = [], 0.0, None
    while pos < len(x):
        ideal = int(round(pad + pos))
        if prev is None:
            c = ideal
        else:                                                                  # the best-fitting piece nearby
            ref = xp[prev + H:prev + H + N]
            region = xp[ideal - tol:ideal + tol + N]
            c = ideal - tol + int(np.argmax(np.correlate(region, ref, "valid")))
        chosen.append(c)
        prev = c
        r = rate[min(len(rate) - 1, int((pos + H) / sr * CTRL))]
        pos += H * max(0.25, float(r))
    y = np.zeros(len(chosen) * H + N, np.float32)
    for i, c in enumerate(chosen):
        y[i * H:i * H + N] += xp[c:c + N] * win
    centers = np.arange(len(chosen)) * H + H
    src = np.interp(np.arange(len(y)), centers, np.array(chosen, np.float64) - pad + H)
    keep = int(np.searchsorted(src, len(x)))
    return y[:max(1, keep)], src[:max(1, keep)]


def shape(samples, sr, p):
    """Give one sentence its melody (pitch moves, length stays the same). Before RVC."""
    from scipy.signal import resample_poly
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if not p or len(x) < sr * 0.2:
        return x
    semis = semitones(p, x, sr)
    if np.abs(semis).max() < 0.05:
        return x
    r = 2 ** (semis / 12)
    y, src = _wsola(x, sr, 1 / r)                       # higher pitch here -> make it longer here first...
    ry = np.interp(src / sr * CTRL, np.arange(len(r)), r)
    pos = np.concatenate([[0.0], np.cumsum(ry[:-1])])   # ...then play it faster there, so the length comes back
    pos = pos[pos <= len(y) - 1]
    up = resample_poly(y, 2, 1).astype(np.float32)      # 2x first, so the playback stays clean
    return np.interp(pos * 2, np.arange(len(up)), up).astype(np.float32)


# ---------------- the sound of the feeling, breaths and pauses ----------------
def _rms(x):
    loud = x[np.abs(x) > 0.01]
    return float(np.sqrt(np.mean(loud ** 2))) if len(loud) else 0.05


def breath(kind, sr, level=0.08, seed=0):
    """A breath made of shaped noise: 'in' (a soft inhale), 'sigh' (a long exhale) or 'gasp' (a quick inhale)."""
    from scipy.signal import butter, sosfilt
    rng = np.random.default_rng(seed)
    dur = {"in": rng.uniform(0.26, 0.4), "sigh": rng.uniform(0.75, 1.0), "gasp": rng.uniform(0.15, 0.22)}[kind]
    lo, hi = {"in": (450, 2600), "sigh": (220, 1700), "gasp": (700, 4200)}[kind]
    n = int(dur * sr)
    t = np.linspace(0, 1, n)
    b = sosfilt(butter(2, [lo, min(hi, sr * 0.45)], "bandpass", fs=sr, output="sos"), rng.standard_normal(n))
    b /= max(1e-6, np.sqrt(np.mean(b ** 2)))
    if kind == "in":
        env = np.sin(np.pi * t ** 0.75) ** 2
    elif kind == "sigh":
        env = (1 - np.exp(-t * 10)) * np.exp(-t * 2.2)
    else:
        env = np.sin(np.pi * t) ** 0.6
    gain = {"in": 1.0, "sigh": 2.4, "gasp": 2.0}[kind] * level
    gap = np.zeros(int(sr * rng.uniform(0.07, 0.14)), np.float32)
    return np.concatenate([(b * env * gain).astype(np.float32), gap])


def finish(samples, sr, p):
    """After RVC: brighter/darker, a bit of edge, the breath before and the pause after."""
    x = np.asarray(samples, dtype=np.float32).reshape(-1)
    if not p:
        return x
    from scipy.signal import butter, sosfilt
    if len(x) > sr * 0.05:
        rms = _rms(x)
        if p.get("tone", 0) > 0.01:                                          # brighter: more "presence"
            x = x + p["tone"] * 0.7 * sosfilt(butter(2, 2500, "highpass", fs=sr, output="sos"), x).astype(np.float32)
        elif p.get("tone", 0) < -0.01:                                       # darker and softer
            dark = sosfilt(butter(2, 2200, "lowpass", fs=sr, output="sos"), x).astype(np.float32)
            x = x * (1 + p["tone"]) + dark * (-p["tone"])
        if p.get("drive", 0) > 0.01:                                         # a bit of edge in the voice
            d = 1 + 3 * p["drive"]
            peak = max(1e-6, float(np.abs(x).max()))
            x = (np.tanh(x / peak * d) / np.tanh(d) * peak).astype(np.float32)
        x = x * (rms / max(1e-6, _rms(x)))                                   # same loudness as before
        fade = min(len(x) // 4, int(sr * 0.006))
        if fade:
            x[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
            x[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
    else:
        rms = 0.05
    parts = []
    if p.get("breath"):
        parts.append(breath(p["breath"], sr, level=min(0.035, rms * 0.3), seed=p.get("seed", 0)))
    parts.append(x.astype(np.float32))
    if p.get("pause"):
        parts.append(np.zeros(int(sr * p["pause"]), np.float32))
    return np.concatenate(parts).astype(np.float32)


def _fit(x, sr, target):
    if sr == target:
        return np.asarray(x, np.float32).reshape(-1)
    from math import gcd
    from scipy.signal import resample_poly
    g = gcd(int(sr), int(target))
    return resample_poly(np.asarray(x, np.float32).reshape(-1), int(target) // g, int(sr) // g).astype(np.float32)


def speak_parts(text, p, synth):
    """Make one sentence with synth(text) -> (samples, sr): real pauses at ... and dashes, and the melody on each
    piece. Returns (samples, sr), ready for RVC and then finish()."""
    pieces, sr = [], None
    for i, (part, gap) in enumerate(split_pauses(text)):
        s, r = synth(part)
        if sr is None:
            sr = int(r)
        q = dict(p, seed=p.get("seed", 0) + i)
        if i:                                                                  # a new breath group: a little reset
            q["mean"] = p["mean"] * 0.8
        pieces.append(shape(_fit(s, r, sr), sr, q))
        if gap:
            pieces.append(np.zeros(int(sr * gap), np.float32))
    return np.concatenate(pieces).astype(np.float32), sr


def breath_only(p, sr=24000):
    """For a line that is only *sighs*: just the sigh."""
    return breath(p.get("breath") or "sigh", sr, level=0.05, seed=p.get("seed", 0)), sr
