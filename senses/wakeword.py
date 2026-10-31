"""
wakeword.py - a wake word that learns YOUR voice saying "vermi".

Train once (Settings → Voice → Train my wake word): say "vermi" 4 times. After that, she listens for the
SOUND of your "vermi" directly - no speech recognition needed - so it's faster, works offline, and doesn't
wake up for words that only look similar on paper.

How it works (for the curious):
  1. every short burst of sound is turned into a "fingerprint" (MFCC: how the loudness of each pitch band
     changes over time - the same thing speech recognisers use)
  2. it's compared with your 4 recordings using DTW (dynamic time warping), which lines up the sounds even
     if you said it faster or slower this time
  3. close enough -> wake up
"""
import json
import time

import numpy as np

from paths import data_file

SR = 16000
FILE = data_file("wake_templates.json")
SENSITIVITY = {1: 1.0, 2: 1.18, 3: 1.4}            # 1 strict, 2 normal, 3 easy (wakes more, may false-trigger)


# ------------------------------------------------------------------ fingerprints
def _mel_filters(n_mels=26, n_fft=512, sr=SR, lo=60, hi=7600):
    mel = lambda f: 2595 * np.log10(1 + f / 700)
    inv = lambda m: 700 * (10 ** (m / 2595) - 1)
    pts = inv(np.linspace(mel(lo), mel(hi), n_mels + 2))
    bins = np.floor((n_fft + 1) * pts / sr).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1), np.float32)
    for i in range(n_mels):
        a, b, c = bins[i], bins[i + 1], bins[i + 2]
        if b > a:
            fb[i, a:b] = (np.arange(a, b) - a) / (b - a)
        if c > b:
            fb[i, b:c] = (c - np.arange(b, c)) / (c - b)
    return fb


_FB = _mel_filters()
_DCT = np.cos(np.pi / 26 * (np.arange(26)[None, :] + 0.5) * np.arange(13)[:, None]).astype(np.float32)


def features(audio):
    """Audio -> (frames x 13) MFCC fingerprint, normalised so loudness and mic don't matter."""
    x = np.asarray(audio, np.float32)
    if x.size < 400:
        x = np.pad(x, (0, 400 - x.size))
    x = np.append(x[0], x[1:] - 0.97 * x[:-1])
    n = 1 + (len(x) - 400) // 160
    frames = np.lib.stride_tricks.as_strided(x, shape=(n, 400), strides=(x.strides[0] * 160, x.strides[0])) * np.hamming(400)
    power = np.abs(np.fft.rfft(frames, 512, axis=1)) ** 2 / 512
    logmel = np.log(power @ _FB.T + 1e-8)
    mfcc = logmel @ _DCT.T
    mfcc = mfcc[:, 1:]                                   # drop overall loudness
    return (mfcc - mfcc.mean(axis=0)) / (mfcc.std(axis=0) + 1e-6)


def dtw(a, b):
    """Average distance between two fingerprints after lining them up in time (smaller = more alike)."""
    cost = np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).sum(-1))
    n, m = cost.shape
    acc = np.full((n + 1, m + 1), np.inf, np.float32)
    acc[0, 0] = 0
    for i in range(1, n + 1):
        row, prev, c = acc[i], acc[i - 1], cost[i - 1]
        for j in range(1, m + 1):
            row[j] = c[j - 1] + min(prev[j], row[j - 1], prev[j - 1])
    return float(acc[n, m] / (n + m))


def trim(audio, pad=0.08):
    """Cut the silence before and after the word."""
    x = np.asarray(audio, np.float32)
    if x.size < 800:
        return x
    rms = np.sqrt(np.convolve(x ** 2, np.ones(320) / 320, mode="same"))
    loud = np.where(rms > max(0.012, rms.max() * 0.12))[0]
    if not loud.size:
        return x[:0]
    p = int(pad * SR)
    return x[max(0, loud[0] - p):loud[-1] + p]


# ------------------------------------------------------------------ training
def _load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
        d["templates"] = [np.asarray(t, np.float32) for t in d.get("templates", [])]
        return d
    except (OSError, json.JSONDecodeError, ValueError):
        return {"templates": [], "spread": 0.0, "length": 0.0}


def trained():
    return len(_load()["templates"]) >= 3


def train(samples):
    """samples: 3-6 recordings of you saying the wake word. Returns a short report."""
    clips = [trim(s) for s in samples]
    clips = [c for c in clips if 0.2 * SR <= c.size <= 2.0 * SR]
    if len(clips) < 3:
        raise ValueError("I need at least 3 clear recordings (say it clearly, not too long).")
    feats = [features(c) for c in clips]
    pairs = [dtw(feats[i], feats[j]) for i in range(len(feats)) for j in range(i + 1, len(feats))]
    data = {"templates": [f.round(4).tolist() for f in feats], "spread": float(max(pairs)),
            "length": float(np.mean([c.size for c in clips]) / SR), "trained": time.strftime("%Y-%m-%d %H:%M")}
    with open(FILE, "w", encoding="utf-8") as f:
        json.dump(data, f)
    return {"samples": len(clips), "spread": round(data["spread"], 3), "length": round(data["length"], 2)}


def clear():
    try:
        import os
        os.remove(FILE)
    except OSError:
        pass


def threshold(sensitivity=2, data=None):
    data = data or _load()
    return max(0.55, data["spread"]) * SENSITIVITY.get(int(sensitivity), 1.18)


def score(audio, data=None):
    """Smallest distance between this sound and your recordings."""
    data = data or _load()
    clip = trim(audio)
    if clip.size < 0.15 * SR or not data["templates"]:
        return float("inf")
    clip = clip[:int((data["length"] or 1.0) * 1.4 * SR)]     # "vermi, what's the time" -> just the "vermi" part
    f = features(clip)
    return min(dtw(f, t) for t in data["templates"])


def matches(audio, sensitivity=2, data=None):
    data = data or _load()
    return score(audio, data) <= threshold(sensitivity, data)


# ------------------------------------------------------------------ microphone
def record(seconds=2.0, device=None):
    import sounddevice as sd
    try:
        audio = sd.rec(int(seconds * SR), samplerate=SR, channels=1, dtype="float32", device=device)
    except Exception:
        audio = sd.rec(int(seconds * SR), samplerate=SR, channels=1, dtype="float32")
    sd.wait()
    return audio[:, 0]


class ClapDetector:
    """Two sharp claps 0.15-0.8 s apart = wake up. Feed it 0.1 s blocks of the microphone."""
    def __init__(self, block_s=0.1):
        self.block_s, self.floor, self.t, self.loud, self.claps = block_s, 0.01, 0.0, False, []

    def feed(self, b):
        self.t += self.block_s
        peak = float(np.max(np.abs(b))) if b.size else 0.0
        rms = float(np.sqrt(np.mean(b ** 2))) if b.size else 0.0
        sharp = peak > max(0.25, self.floor * 12) and peak / max(rms, 1e-6) > 4.0   # a clap: loud, short and spiky
        if not sharp and not self.loud:
            self.floor = 0.95 * self.floor + 0.05 * rms
        onset, self.loud = sharp and not self.loud, sharp
        if not onset:
            return False
        self.claps = [c for c in self.claps if self.t - c <= 0.8] + [self.t]
        if len(self.claps) >= 2 and self.t - self.claps[-2] >= 0.15:
            self.claps = []
            return True
        return False


def listen_claps(keep_going, device=None):
    """Block until a double clap (True) or keep_going() becomes False."""
    import queue
    import sounddevice as sd
    blocks, det = queue.Queue(), ClapDetector()
    cb = lambda indata, *_: blocks.put(indata[:, 0].copy())
    try:
        stream = sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=1600, device=device, callback=cb)
    except Exception:
        stream = sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=1600, callback=cb)
    with stream:
        while keep_going():
            try:
                if det.feed(blocks.get(timeout=0.5)):
                    return True
            except queue.Empty:
                continue
    return False


def listen(keep_going, sensitivity=2, device=None, on_level=None, claps=False):
    """Block until your wake word (or a double clap, with claps=True) is heard (True) or keep_going() becomes False."""
    import queue
    import sounddevice as sd
    data = _load()
    blocks = queue.Queue()
    cb = lambda indata, *_: blocks.put(indata[:, 0].copy())
    try:
        stream = sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=1600, device=device, callback=cb)
    except Exception:
        stream = sd.InputStream(samplerate=SR, channels=1, dtype="float32", blocksize=1600, callback=cb)
    floor, seg, quiet = 0.01, [], 0
    det = ClapDetector() if claps else None
    with stream:
        while keep_going():
            try:
                b = blocks.get(timeout=0.5)
            except queue.Empty:
                continue
            level = float(np.sqrt(np.mean(b ** 2)))
            if on_level:
                on_level(level)
            if det and det.feed(b):
                return True
            voiced = level > max(0.012, floor * 3)
            if not seg:
                floor = 0.95 * floor + 0.05 * level if not voiced else floor
            if voiced:
                seg.append(b)
                quiet = 0
            elif seg:
                seg.append(b)
                quiet += 1
                if quiet >= 3:                                  # 0.3 s of quiet = the burst ended
                    sound = np.concatenate(seg)
                    seg, quiet = [], 0
                    if 0.25 * SR <= sound.size <= 4 * SR and matches(sound, sensitivity, data):
                        return True
            if len(seg) > 40:                                   # 4 s of non-stop sound: start over
                seg, quiet = [], 0
    return False
