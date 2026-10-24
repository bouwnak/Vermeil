"""chatter.py - the "Emotional voice": Chatterbox Turbo (Resemble AI, MIT licence), runs on YOUR computer.

Why: Piper reads text evenly, so expressive.py has to bend the pitch afterwards. Chatterbox is a newer kind of
voice that already acts the line out: it laughs, chuckles and sighs for real when the text says [laugh], [chuckle]
or [sigh], and its tone follows the words.

How it fits in:
  - It copies the timbre of the character's normal voice. The first time a voice is used, the normal voice
    (Piper/Kokoro) reads a short text (~8 s); that clip is saved in data/chatterbox_refs/ and reused.
  - With an RVC voice clone, Chatterbox speaks first and RVC turns it into the clone, like with Piper.
  - English only. Other languages keep the normal voice.
  - Slower than Piper on a PC without a graphics card. Turn it on per character:
    Characters → "Emotional voice (Chatterbox)".

Setup (once): python -m pip install chatterbox-tts   (the model, ~3 GB, downloads the first time)
"""
import os
import re
import sys
import threading

import numpy as np

from paths import data_file

REPO = "ResembleAI/chatterbox-turbo"
FILES = ["t3_turbo_v1.safetensors", "s3gen_meanflow.safetensors", "ve.safetensors", "*.json", "*.txt", "conds.pt",
         "*.model"]
REFS_DIR = data_file("chatterbox_refs")
REF_TEXT = ("Hi there! It's so nice to finally talk with you. I was just thinking about what we could do today, "
            "and honestly, I have a few fun ideas. Tell me how your day is going, okay?")
TAGS = ("laugh", "chuckle", "sigh", "gasp", "cough", "clear throat", "sniff", "groan", "shush",       # sounds
        "happy", "angry", "fear", "surprised", "sarcastic", "crying", "dramatic", "whispering")       # how it's said
# her feeling in a sentence (voice_emotion.detect) -> the Chatterbox tag that says it that way
MOOD_TAG = {"happy": "happy", "excited": "happy", "angry": "angry", "scared": "fear", "surprised": "surprised",
            "sad": "crying", "soft": "whispering"}


def with_mood(text, emotion, strength):
    """'I missed you.' + sad (strong) -> '[crying] I missed you.' Only clear feelings get a tag; sad and soft need
    to be very clear, so she doesn't cry or whisper by accident."""
    tag = MOOD_TAG.get(emotion)
    need = 0.7 if emotion in ("sad", "soft") else 0.45
    if not tag or strength < need or re.match(r"\s*\[(%s)\]" % "|".join(TAGS[9:]), text or ""):
        return text
    return f"[{tag}] {text}"

_model = None
_conds = {}                      # base voice -> Chatterbox's copy of it
_lock = threading.Lock()         # one line at a time: it uses the whole processor
_status = None


def _no_torchvision():
    """transformers imports torchvision when it's installed, and a torchvision built for another torch version
    crashes that import. Chatterbox doesn't need it, so it's hidden from transformers."""
    try:
        import transformers.utils.import_utils as iu
        for name in ("is_torchvision_available", "is_torchvision_v2_available"):
            f = getattr(iu, name, None)
            if f is not None:
                if hasattr(f, "cache_clear"):
                    f.cache_clear()
                setattr(iu, name, lambda: False)
        import transformers.utils as tu
        for name in ("is_torchvision_available", "is_torchvision_v2_available"):
            if hasattr(tu, name):
                setattr(tu, name, lambda: False)
    except Exception:
        pass


def status():
    """{"ready": bool, "hint": str}: installed and is the model downloaded?"""
    global _status
    if _status is not None:
        return _status
    import importlib.util
    if importlib.util.find_spec("chatterbox") is None:
        _status = {"ready": False, "hint": "Not installed. Run:  python -m pip install chatterbox-tts"}
        return _status
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(REPO, allow_patterns=FILES, local_files_only=True)
        hint = "Ready."
    except Exception:
        hint = "The voice model (~3 GB) downloads the first time it's used."
    try:
        import torch
        gpu = torch.cuda.is_available()
    except Exception:
        gpu = False
    hint += (" Using your NVIDIA graphics card." if gpu else
             " On the processor it's slow (each line takes ~3x as long as it is to say). For real-time speech install "
             "the graphics-card version of torch (see HANDOVER.md).")
    _status = {"ready": True, "hint": hint, "gpu": gpu}
    return _status


class _Librosa32:
    """librosa for Chatterbox, but its audio always comes back as float32 (with numpy 2 it's float64, and
    Chatterbox's networks only take float32)."""
    def __getattr__(self, name):
        import librosa
        return getattr(librosa, name)

    def load(self, *a, **k):
        import librosa
        x, sr = librosa.load(*a, **k)
        return np.asarray(x, np.float32), sr

    def resample(self, *a, **k):
        import librosa
        return np.asarray(librosa.resample(*a, **k), np.float32)


def _load():
    global _model
    if _model is None:
        _no_torchvision()
        from huggingface_hub import snapshot_download
        try:
            path = snapshot_download(REPO, allow_patterns=FILES, local_files_only=True)
        except Exception:
            print("[Chatterbox] downloading the voice model (~3 GB, only once)…")
            path = snapshot_download(REPO, allow_patterns=FILES)
        import torch
        import perth
        if perth.PerthImplicitWatermarker is None:      # its hidden "made by AI" mark needs pkg_resources (old setuptools)
            print('[Chatterbox] no audio watermark (to add it: python -m pip install "setuptools<81")')
            perth.PerthImplicitWatermarker = perth.DummyWatermarker
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        _model = None
        if torch.cuda.is_available():                  # an NVIDIA graphics card: about 10x faster than the processor
            try:
                _model = ChatterboxTurboTTS.from_local(path, "cuda")
            except Exception as e:                     # e.g. not enough graphics memory
                print(f"[Chatterbox] graphics card failed ({e.__class__.__name__}) - using the processor.")
                _model = None
                torch.cuda.empty_cache()
        if _model is None:
            # more processor threads only on the processor: changing it slows RVC down (it stays on the processor)
            torch.set_num_threads(max(1, min(8, os.cpu_count() or 4)))
            _model = ChatterboxTurboTTS.from_local(path, "cpu")
        import chatterbox.tts_turbo as turbo
        turbo.librosa = _Librosa32()
    return _model


def _ref_file(base):
    name = re.sub(r"[^\w.-]+", "_", str(base or "default"))[:80]
    return os.path.join(REFS_DIR, name + ".wav")


def _use_voice(model, base, make_ref):
    """Copy the timbre of `base` (made once with make_ref(text) -> (samples, sr), then saved)."""
    if base in _conds:
        model.conds = _conds[base]
        return
    path = _ref_file(base)
    if not os.path.exists(path):
        import soundfile as sf
        samples, sr = make_ref(REF_TEXT)
        x = np.asarray(samples, np.float32).reshape(-1)
        while len(x) < sr * 6:                                    # Chatterbox needs more than 5 seconds
            x = np.concatenate([x, np.zeros(int(sr * 0.3), np.float32), x])
        os.makedirs(REFS_DIR, exist_ok=True)
        sf.write(path, x, int(sr))
    model.prepare_conditionals(path)
    _conds[base] = model.conds


def tagged(text):
    """*laughs* -> [laugh], *sighs* -> [sigh] ... (what Chatterbox acts out). Other *actions* are dropped."""
    def rep(m):
        act = m.group(1).lower()
        for pattern, tag in ((r"laugh|giggl|haha|tee.?hee", "laugh"), (r"chuckl|snicker|smirk|heh", "chuckle"),
                             (r"sigh|exhal", "sigh"), (r"gasp|inhal", "gasp"), (r"cough", "cough"),
                             (r"sniff|sob|cr(y|ies)", "sniff"), (r"groan|ugh", "groan"), (r"clears? (her|his|my) throat", "clear throat")):
            if re.search(pattern, act):
                return f" [{tag}] "
        return " "
    out = re.sub(r"\*([^*\n]{1,60})\*", rep, text or "")
    out = re.sub(r"\[(?!(?:%s)\])[^\]\n]{0,40}\]" % "|".join(TAGS), " ", out)   # unknown [tags] aren't read out
    return re.sub(r"\s{2,}", " ", out).strip()


def synth(text, base, make_ref):
    """One line -> (samples, 24000). `base` is the normal voice it copies; make_ref(text) says text with it."""
    text = tagged(text)
    if not re.search(r"\w", re.sub(r"\[[^\]]*\]", "", text)) and "[" not in text:
        return np.zeros(2400, np.float32), 24000
    with _lock:
        model = _load()
        _use_voice(model, base, make_ref)
        import torch
        with torch.inference_mode():
            wav = model.generate(text, temperature=0.8, top_p=0.95, repetition_penalty=1.2)
    x = wav.squeeze(0).cpu().numpy().astype(np.float32)
    return x, int(model.sr)


def warm(base, make_ref):
    """Load the model and the voice in the background, so her first line isn't slow."""
    def go():
        try:
            synth("Okay.", base, make_ref)
        except Exception as e:
            print(f"[Chatterbox] {e}")
    threading.Thread(target=go, daemon=True).start()


if __name__ == "__main__" and len(sys.argv) > 1:                 # python chatter.py "Hello [laugh] there"
    import tts
    s, r = synth(sys.argv[1], tts.DEFAULT_VOICE, lambda t: tts.synth(t, tts.DEFAULT_VOICE))
    import sounddevice as sd
    sd.play(s, r)
    sd.wait()
