"""RVC voice clones: make the assistant's voice sound like an RVC model (.pth + optional .index).

How it works: the normal voice (Piper / Kokoro / the online Microsoft voices) says the sentence first - that voice
gives the LANGUAGE, so English, Tagalog, Japanese and Korean all work - then RVC turns it into the cloned voice.

- Imported voices are copied into  data\\rvc_voices\\<name>\\  (model.pth, model.index, info.json). The files you
  picked are never changed.
- RVC needs two helper models, downloaded once by  scripts\\setup_rvc.bat  into  tools\\rvc\\ :
    vec-768-layer-12.onnx   (ContentVec - "what is being said")
    rmvpe.pt                (RMVPE - "what pitch is it sung at")
- The .index file (optional) makes the voice closer to the original. It needs:  python -m pip install faiss-cpu
- Runs on the CPU with torch + onnxruntime (no fairseq, no librosa).

Test from the project folder:  python senses\\rvc.py "Rick Sanchez" "Hello there!"
"""
import json
import os
import re
import shutil
import sys
import threading
import unicodedata
import urllib.parse
from math import gcd

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (_HERE, os.path.join(os.path.dirname(_HERE), "brain")):
    if _p not in sys.path:
        sys.path.append(_p)

from paths import data_file  # noqa: E402

PROJECT = os.path.dirname(_HERE)
VOICES_DIR = data_file("rvc_voices")
TOOLS_DIR = os.environ.get("RVC_TOOLS_DIR") or os.path.join(PROJECT, "tools", "rvc")
CONTENTVEC = {"v2": "vec-768-layer-12.onnx", "v1": "vec-256-layer-9.onnx"}
RMVPE = "rmvpe.pt"
SETUP_HINT = "RVC isn't set up yet - double-click scripts\\setup_rvc.bat once."
SR16 = 16000
HOP = 160                         # 10 ms frames at 16 kHz
PAD = SR16                        # 1 s of context added on both sides while converting
MARGIN = 10                       # frames (0.1 s) of that context the voice network also makes, so the edges are clean

_lock = threading.Lock()          # one conversion at a time (each one already uses every CPU core)
_cache = {"models": {}, "vec": {}, "rmvpe": None, "index": {}}


# ---------------- the voice library ----------------
def _clean_name(text):
    text = urllib.parse.unquote(str(text or ""))
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"\s*-\s*Weights Model$", "", text, flags=re.I)
    text = re.sub(r"(_e\d+_s\d+|_\d+e_\d+s)$", "", text, flags=re.I)         # Bubbles_e300_s6600 -> Bubbles
    text = re.sub(r"[^A-Za-z0-9 _().-]+", "", text).replace("_", " ").strip(" .")
    return re.sub(r"\s+", " ", text)[:40] or "Voice"


def _voice_dir(name):
    return os.path.join(VOICES_DIR, _clean_name(name))


def read_model_info(pth):
    """What kind of RVC model is this? Raises ValueError if it isn't one."""
    import torch
    try:
        cpt = torch.load(pth, map_location="cpu", weights_only=True)
    except Exception as e:
        raise ValueError(f"That file couldn't be opened as an RVC model ({e.__class__.__name__}).")
    if not isinstance(cpt, dict) or "weight" not in cpt or "config" not in cpt:
        raise ValueError("That .pth isn't an RVC voice model (it has no 'weight' and 'config'). "
                         "Pick the small .pth (about 50 MB) that came with the voice, not a training checkpoint.")
    weights = cpt["weight"]
    feat = weights.get("enc_p.emb_phone.weight")
    version = cpt.get("version") or ("v2" if feat is not None and feat.shape[1] == 768 else "v1")
    f0 = int(bool(cpt.get("f0", 1)))
    sr = cpt["config"][-1]
    sr = {"32k": 32000, "40k": 40000, "48k": 48000}.get(sr, sr)
    return {"version": version, "f0": f0, "sr": int(sr)}, cpt


def _find_index(pth):
    """The .index file next to the .pth (the 'added_' one if there are several)."""
    folder = os.path.dirname(pth)
    found = [f for f in os.listdir(folder) if f.lower().endswith(".index") and "trained_" not in f.lower()]
    found.sort(key=lambda f: (not f.lower().startswith("added"), -os.path.getsize(os.path.join(folder, f))))
    return os.path.join(folder, found[0]) if found else None


def import_voice(pth, index=None, name=None):
    """Copy an RVC voice into data\\rvc_voices. Returns its info dict. The original files are not touched."""
    if not pth or not os.path.isfile(pth) or not pth.lower().endswith(".pth"):
        raise ValueError("Pick the voice's .pth file.")
    info, _ = read_model_info(pth)
    index = index or _find_index(pth)
    stem = os.path.splitext(os.path.basename(pth))[0]
    if not name:
        name = os.path.basename(os.path.dirname(pth)) if stem.lower() in ("model", "g", "weights") else stem
    name = _clean_name(name)
    folder = _voice_dir(name)
    os.makedirs(folder, exist_ok=True)
    shutil.copy2(pth, os.path.join(folder, "model.pth"))
    if index and os.path.isfile(index):
        shutil.copy2(index, os.path.join(folder, "model.index"))
    info.update({"name": name, "has_index": os.path.exists(os.path.join(folder, "model.index")),
                 "source": os.path.basename(pth)})
    with open(os.path.join(folder, "info.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, indent=1)
    _cache["models"].pop(name, None)
    _cache["index"].pop(name, None)
    return info


def list_voices():
    out = []
    if not os.path.isdir(VOICES_DIR):
        return out
    for d in sorted(os.listdir(VOICES_DIR), key=str.lower):
        try:
            with open(os.path.join(VOICES_DIR, d, "info.json"), encoding="utf-8") as f:
                info = json.load(f)
            if os.path.exists(os.path.join(VOICES_DIR, d, "model.pth")):
                info["name"] = d
                info["has_index"] = os.path.exists(os.path.join(VOICES_DIR, d, "model.index"))
                out.append(info)
        except (OSError, ValueError):
            continue
    return out


def delete_voice(name):
    folder = _voice_dir(name)
    if os.path.isdir(folder) and os.path.dirname(folder) == VOICES_DIR:
        shutil.rmtree(folder)
    _cache["models"].pop(_clean_name(name), None)
    _cache["index"].pop(_clean_name(name), None)
    return list_voices()


# ---------------- is it set up? ----------------
def _has(module):
    try:
        __import__(module)
        return True
    except Exception:
        return False


def status():
    missing = [f for f in (CONTENTVEC["v2"], RMVPE) if not os.path.exists(os.path.join(TOOLS_DIR, f))]
    packages = [p for p in ("torch", "onnxruntime", "scipy") if not _has(p)]
    ok = not missing and not packages
    return {"ready": ok, "missing_files": missing, "missing_packages": packages, "faiss": _has("faiss"),
            "hint": "" if ok else (SETUP_HINT if missing else
                                   "Run:  python -m pip install " + " ".join(packages))}


def ready():
    return status()["ready"]


# ---------------- loading ----------------
def _fold_weight_norm(state):
    """weight_g + weight_v (how weight-norm layers are saved) -> one plain weight."""
    import torch
    out = {}
    for k, v in state.items():
        if k.endswith(".weight_v") or k.endswith(".parametrizations.weight.original1"):
            continue
        if k.endswith(".weight_g") or k.endswith(".parametrizations.weight.original0"):
            base = k[:-len(".weight_g")] if k.endswith(".weight_g") else k[:-len(".parametrizations.weight.original0")]
            vv = state[base + (".weight_v" if k.endswith(".weight_g") else ".parametrizations.weight.original1")]
            dims = tuple(range(1, vv.dim()))
            out[base + ".weight"] = v * vv / torch.linalg.vector_norm(vv.float(), dim=dims, keepdim=True).to(vv.dtype)
        else:
            out[k] = v
    return out


def _load_model(name):
    if name in _cache["models"]:
        return _cache["models"][name]
    import torch
    from rvc_models import Synthesizer
    pth = os.path.join(_voice_dir(name), "model.pth")
    if not os.path.exists(pth):
        raise FileNotFoundError(f"The RVC voice '{name}' isn't imported.")
    info, cpt = read_model_info(pth)
    config = list(cpt["config"])
    config[-3] = cpt["weight"]["emb_g.weight"].shape[0]                    # number of speakers
    net = Synthesizer(*config, feat_dim=768 if info["version"] == "v2" else 256, f0=bool(info["f0"]))
    state = {k: v for k, v in _fold_weight_norm(cpt["weight"]).items() if not k.startswith("enc_q.")}
    missing, _unused = net.load_state_dict({k: v.float() for k, v in state.items()}, strict=False)
    if missing:
        raise ValueError(f"The RVC model '{name}' is missing parts: {', '.join(missing[:4])}")
    net.eval()
    _cache["models"][name] = (net, info)
    return net, info


def _contentvec(version):
    if version not in _cache["vec"]:
        import onnxruntime as ort
        path = os.path.join(TOOLS_DIR, CONTENTVEC.get(version, CONTENTVEC["v2"]))
        if not os.path.exists(path):
            raise FileNotFoundError(SETUP_HINT if version == "v2" else
                                    f"This is an old (v1) RVC model - it also needs tools\\rvc\\{CONTENTVEC['v1']}.")
        _cache["vec"][version] = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    return _cache["vec"][version]


def _rmvpe():
    if _cache["rmvpe"] is None:
        import torch
        from rvc_models import E2E
        path = os.path.join(TOOLS_DIR, RMVPE)
        if not os.path.exists(path):
            raise FileNotFoundError(SETUP_HINT)
        net = E2E(4, 1, (2, 2))
        net.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
        net.eval()
        _cache["rmvpe"] = net
    return _cache["rmvpe"]


def _index(name):
    """(faiss index, its vectors) or None - when there's no .index or faiss isn't installed."""
    if name not in _cache["index"]:
        path = os.path.join(_voice_dir(name), "model.index")
        found = None
        if os.path.exists(path) and _has("faiss"):
            try:
                import faiss
                idx = faiss.read_index(path)
                found = (idx, idx.reconstruct_n(0, idx.ntotal))
            except Exception as e:
                print(f"[RVC] couldn't read the .index ({e}) - converting without it.")
        _cache["index"][name] = found
    return _cache["index"][name]


def warm(name):
    """Load a voice (and the helper models) in the background so the first sentence isn't slow."""
    def go():
        try:
            with _lock:
                net, info = _load_model(name)
                _contentvec(info["version"])
                if info["f0"]:
                    _rmvpe()
                _index(name)
        except Exception as e:
            print(f"[RVC] {e}")
    if name and ready():
        threading.Thread(target=go, daemon=True).start()


# ---------------- audio helpers ----------------
def _resample(x, sr_from, sr_to):
    if sr_from == sr_to:
        return np.asarray(x, dtype=np.float32)
    from scipy.signal import resample_poly
    g = gcd(int(sr_from), int(sr_to))
    return resample_poly(x, sr_to // g, sr_from // g).astype(np.float32)


_MEL = {}


def _mel_basis(sr=SR16, n_fft=1024, n_mels=128, fmin=30, fmax=8000):
    """Same numbers as librosa.filters.mel(htk=True) (slaney-normalised), without needing librosa."""
    key = (sr, n_fft, n_mels, fmin, fmax)
    if key not in _MEL:
        fft_freqs = np.linspace(0, sr / 2, 1 + n_fft // 2)
        to_mel = lambda f: 2595.0 * np.log10(1.0 + np.asarray(f) / 700.0)    # noqa: E731
        mel_f = 700.0 * (10.0 ** (np.linspace(to_mel(fmin), to_mel(fmax), n_mels + 2) / 2595.0) - 1.0)
        fdiff = np.diff(mel_f)
        ramps = mel_f[:, None] - fft_freqs[None, :]
        lower = -ramps[:-2] / fdiff[:-1, None]
        upper = ramps[2:] / fdiff[1:, None]
        weights = np.maximum(0, np.minimum(lower, upper))
        weights *= (2.0 / (mel_f[2:n_mels + 2] - mel_f[:n_mels]))[:, None]
        _MEL[key] = weights.astype(np.float32)
    return _MEL[key]


def pitch_track(audio16):
    """f0 in Hz for every 10 ms frame (0 = no voice), with RMVPE."""
    import torch
    net = _rmvpe()
    x = torch.from_numpy(np.asarray(audio16, dtype=np.float32)).unsqueeze(0)
    spec = torch.stft(x, n_fft=1024, hop_length=HOP, win_length=1024, window=torch.hann_window(1024),
                      center=True, return_complex=True).abs()
    mel = torch.log(torch.clamp(torch.from_numpy(_mel_basis()) @ spec, min=1e-5))
    n_frames = mel.shape[-1]
    mel = torch.nn.functional.pad(mel, (0, 32 * ((n_frames - 1) // 32 + 1) - n_frames))
    with torch.no_grad():
        salience = net(mel)[0, :n_frames].numpy()
    # the weighted average of the 9 bins around the strongest one -> cents -> Hz
    cents_map = np.pad(20 * np.arange(360) + 1997.3794084376191, (4, 4))
    center = np.argmax(salience, axis=1) + 4
    padded = np.pad(salience, ((0, 0), (4, 4)))
    idx = center[:, None] + np.arange(-4, 5)[None, :]
    sal = np.take_along_axis(padded, idx, axis=1)
    cents = (sal * cents_map[idx]).sum(1) / np.maximum(sal.sum(1), 1e-9)
    cents[padded.max(axis=1) <= 0.03] = 0
    f0 = 10 * (2 ** (cents / 1200))
    f0[f0 == 10] = 0
    return f0.astype(np.float32)


def _coarse(f0):
    mel_min, mel_max = 1127 * np.log(1 + 50 / 700), 1127 * np.log(1 + 1100 / 700)
    m = 1127 * np.log(1 + f0 / 700)
    m[m > 0] = (m[m > 0] - mel_min) * 254 / (mel_max - mel_min) + 1
    return np.rint(np.clip(m, 1, 255)).astype(np.int64)


def _features(audio16, version):
    sess = _contentvec(version)
    inp = sess.get_inputs()[0]
    x = np.asarray(audio16, dtype=np.float32)
    x = x[None, None, :] if len(inp.shape) == 3 else x[None, :]
    out = sess.run(None, {inp.name: x})[0]
    if out.ndim == 3 and out.shape[1] in (256, 768) and out.shape[2] not in (256, 768):
        out = out.transpose(0, 2, 1)                                         # (1, dim, T) -> (1, T, dim)
    return out[0].astype(np.float32)                                         # (T, dim), one row per 20 ms


# ---------------- converting ----------------
def convert(samples, sr, cfg):
    """Turn speech (samples at sr) into the RVC voice. cfg: {"model", "pitch" (semitones), "index_rate", "protect"}.
    Returns (samples, samplerate)."""
    import torch
    from scipy import signal
    name = cfg.get("model")
    transpose = float(cfg.get("pitch") or 0) + base_shift(cfg)
    index_rate = max(0.0, min(1.0, float(cfg.get("index_rate", 0.5))))
    protect = max(0.0, min(0.5, float(cfg.get("protect", 0.33))))
    audio = _resample(np.asarray(samples, dtype=np.float32).reshape(-1), sr, SR16)
    if len(audio) < HOP * 4:
        return np.asarray(samples, dtype=np.float32), sr
    with _lock:                    # only the loading waits its turn: several sentences convert at the same time
        net, info = _load_model(name)
        _contentvec(info["version"])
        if info["f0"]:
            _rmvpe()
        if index_rate > 0:
            _index(name)
    tgt_sr = info["sr"]
    b, a = signal.butter(N=5, Wn=48, btype="high", fs=SR16)
    audio = signal.filtfilt(b, a, audio).astype(np.float32)
    audio_pad = np.pad(audio, (PAD, PAD), mode="reflect" if len(audio) > PAD else "constant")
    p_len = len(audio_pad) // HOP

    feats = _features(audio_pad, info["version"])
    feats0 = feats.copy()
    found = _index(name) if index_rate > 0 else None
    if found:
        idx, vectors = found
        score, ix = idx.search(feats, k=8)
        weight = np.square(1 / np.maximum(score, 1e-9))
        weight /= weight.sum(axis=1, keepdims=True)
        feats = index_rate * np.sum(vectors[ix] * weight[:, :, None], axis=1) + (1 - index_rate) * feats
    feats = np.repeat(feats, 2, axis=0)                                  # 20 ms -> 10 ms frames
    feats0 = np.repeat(feats0, 2, axis=0)
    p_len = min(p_len, len(feats))
    feats, feats0 = feats[:p_len], feats0[:p_len]

    pitch = pitchf = None
    if info["f0"]:
        f0 = pitch_track(audio_pad)[:p_len]
        if len(f0) < p_len:
            f0 = np.pad(f0, (0, p_len - len(f0)))
        f0 = f0 * 2 ** (transpose / 12)
        if protect < 0.5:                                                # keep breaths / s-sounds clear
            keep = np.where(f0 > 0, 1.0, protect)[:, None]
            feats = feats * keep + feats0 * (1 - keep)
    else:
        f0 = None
    # the padding was only there so the content/pitch models hear some context: the voice network (the slow part)
    # only makes the real speech plus a short margin, which is trimmed off again
    cut = max(0, PAD // HOP - MARGIN)
    lo, hi = cut, max(cut + 1, p_len - cut)
    feats, n = feats[lo:hi], hi - lo
    if info["f0"]:
        f0 = f0[lo:hi]
        pitch = torch.from_numpy(_coarse(f0)).unsqueeze(0)
        pitchf = torch.from_numpy(f0.astype(np.float32)).unsqueeze(0)
    with torch.inference_mode():
        out = net.infer(torch.from_numpy(np.ascontiguousarray(feats, dtype=np.float32)).unsqueeze(0),
                        torch.tensor([n]), pitch, pitchf, torch.tensor([0]))[0, 0].numpy()
    trim = (PAD // HOP - cut) * HOP * tgt_sr // SR16
    out = out[trim:len(out) - trim] if len(out) > 2 * trim else out
    peak = np.abs(out).max() if len(out) else 0
    if peak > 0.99:
        out = out * (0.99 / peak)
    return out.astype(np.float32), tgt_sr


# ---------------- which normal voice speaks first (that voice gives the language) ----------------
BASE_VOICES = {"ja": ("ja-JP-NanamiNeural", "ja-JP-KeitaNeural"), "ko": ("ko-KR-SunHiNeural", "ko-KR-InJoonNeural"),
               "tl": ("fil-PH-BlessicaNeural", "fil-PH-AngeloNeural"),
               "fil": ("fil-PH-BlessicaNeural", "fil-PH-AngeloNeural"),
               "en": ("piper:en_US-amy-medium", "piper:en_US-ryan-medium")}


def text_language(text):
    """ja / ko from the writing itself (kana, hangul) - else None."""
    if re.search(r"[぀-ヿ]", text or ""):
        return "ja"
    if re.search(r"[가-힯ᄀ-ᇿ]", text or ""):
        return "ko"
    return None


# "Speak with" choices: own voice, or a female / male voice in her language, each high, normal or low
BASE_CHOICES = ("own", "female_high", "female", "female_low", "male_high", "male", "male_low")
BASE_SHIFT = {"high": 4, "low": -4}                   # semitones on top of the clone's own pitch slider


def base_gender(cfg):
    """'female' / 'male' for a "Speak with" choice, or None for the character's own voice."""
    base = str((cfg or {}).get("base") or "own")
    g = base.split("_")[0]
    return g if g in ("female", "male") else None


def base_shift(cfg):
    """High / low choices move the pitch (semitones)."""
    base = str((cfg or {}).get("base") or "own")
    return BASE_SHIFT.get(base.split("_")[-1], 0) if base_gender(cfg) else 0


def base_voice(cfg, lang, own_voice):
    """The voice that speaks before RVC. base 'own' = the character's normal voice (it already follows the language
    setting); 'female' / 'male' (+ '_high' / '_low') = a clear voice for that language (male suits male RVC
    models best). High / low only change the pitch, in convert()."""
    base = base_gender(cfg)
    if base is None:
        return own_voice
    lang = (lang or "en").lower()
    lang = "fil" if lang == "tl" else lang
    if lang not in BASE_VOICES:
        return own_voice
    female, male = BASE_VOICES[lang]
    if lang == "en":
        try:
            import kokoro
            if kokoro.ready():
                return "kokoro:af_heart" if base == "female" else "kokoro:am_michael"
        except Exception:
            pass
    return female if base == "female" else male


if __name__ == "__main__":
    st = status()
    print("RVC ready." if st["ready"] else st["hint"], "| faiss (.index):", "yes" if st["faiss"] else "no")
    voices = list_voices()
    print("Voices:", ", ".join(v["name"] for v in voices) or "(none imported yet)")
    if st["ready"] and len(sys.argv) > 1:
        import time
        import soundfile as sf
        import tts
        text = sys.argv[2] if len(sys.argv) > 2 else "Hi! This is my new voice."
        samples, sr = tts.synth(text, "piper:en_US-amy-medium")
        t = time.time()
        out, osr = convert(samples, sr, {"model": sys.argv[1], "pitch": float(sys.argv[3]) if len(sys.argv) > 3 else 0})
        sf.write(os.path.join(PROJECT, "rvc_test.wav"), out, osr)
        print(f"Converted {len(out) / osr:.1f} s in {time.time() - t:.1f} s -> rvc_test.wav")
