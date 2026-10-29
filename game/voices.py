"""voices.py - which voice each character speaks with, using the voice models Vermeil already has
(Piper .onnx voices in data/piper_voices, plus the online voices when edge-tts is installed).
While the AI is online (Groq) and Kokoro is running on this PC, everyone speaks with Kokoro voices instead
(Vermeil uses her chosen Kokoro voice); offline the Piper voices are used as before.

- the Dungeon Master gets a narrator voice, Vermeil keeps her own voice, NPCs/allies get a voice that fits
  their gender and 'voice kind' (deep, bright, gruff...) with pitch/speed changes so they sound different
- at most MAX_LOADED Piper models stay in memory; older ones are unloaded
- if speech fails, the game carries on with subtitles only
- the voice clone (RVC) is only for your companion: when the companion's character has one (Settings -> character ->
  Voice clone), her lines go through it, like in the assistant. Everyone else (the narrator, NPCs, allies, monsters)
  uses the fast offline Piper voices, so their lines are ready almost at once.
"""
import base64
import hashlib
import threading

MAX_LOADED = 4
_lock = threading.Lock()
_recent = []

KNOWN = {  # Piper voices we know the gender of (anything else counts as neutral)
    "female": ["amy", "hfc_female", "lessac", "kristin", "kathleen", "ljspeech", "jenny", "alba", "cori", "southern_english_female",
               "siwis", "eva", "kerstin", "ramona", "natalia", "lili", "irina", "berta", "paola", "carla"],
    "male": ["ryan", "joe", "john", "alan", "danny", "kusal", "norman", "bryce", "arctic", "hfc_male", "sam", "northern_english_male",
             "thorsten", "karlsson", "gilles", "tom", "davefx", "dmitri", "riccardo", "pavoque", "edresson", "faber"],
}
KIND = {"deep": ("-6%", "-26Hz"), "warm": ("-2%", "-10Hz"), "gruff": ("-8%", "-18Hz"), "young": ("+6%", "+24Hz"),
        "bright": ("+4%", "+18Hz"), "soft": ("-4%", "+6Hz"), "husky": ("-3%", "-12Hz"), "narrator": ("-6%", "-8Hz")}
ONLINE = {"female": ["en-US-JennyNeural", "en-GB-SoniaNeural", "en-AU-NatashaNeural", "en-US-AriaNeural"],
          "male": ["en-US-GuyNeural", "en-GB-RyanNeural", "en-US-DavisNeural", "en-AU-WilliamNeural"]}


def _tts():
    try:
        import tts
        return tts
    except Exception:
        return None


def gender_of(key):
    k = key.lower()
    for g, names in KNOWN.items():
        if any(f"-{n}-" in k or k.startswith(n) for n in names): return g
    return "neutral"


def registry():
    """all voices the game can use, with what we know about them."""
    T = _tts()
    out = []
    if T is None: return out
    try:
        for key in T.installed_voices():
            lang = key.split("-")[0]
            if not lang.startswith("en"): continue
            out.append({"id": f"piper:{key}", "model": f"data/piper_voices/{key}.onnx", "runtime": "piper (offline)",
                        "language": lang, "gender": gender_of(key), "memory": "~60 MB when loaded", "loaded": key in getattr(T, "_loaded", {}),
                        "deps": "piper-tts"})
    except Exception:
        pass
    try:
        if T.engine() == "edge" or T.edge_available():
            for g, vs in ONLINE.items():
                for v in vs:
                    out.append({"id": v, "model": "online", "runtime": "edge-tts (online)", "language": v[:5], "gender": g,
                                "memory": "none", "loaded": True, "deps": "edge-tts + internet"})
    except Exception:
        pass
    return out


def assign(camp, vermeil_voice=None, profile=None):
    """give the DM, the companion, allies and NPCs voices (saved in camp['voices'] so they never change).
    profile = the companion's character from the assistant app (its rate/pitch and Kokoro voice are kept)."""
    profile = profile or {}
    reg = registry()
    v = camp.setdefault("voices", {})
    by = {"female": [r["id"] for r in reg if r["gender"] == "female"], "male": [r["id"] for r in reg if r["gender"] == "male"],
          "neutral": [r["id"] for r in reg if r["gender"] == "neutral"]}
    anyv = [r["id"] for r in reg]
    if "dm" not in v:
        dm = (by["male"] or anyv or [None])[0]
        v["dm"] = {"voice": dm, "rate": KIND["narrator"][0], "pitch": KIND["narrator"][1]}
    if "vermeil" not in v:
        v["vermeil"] = {"voice": vermeil_voice or (by["female"] or anyv or [None])[0], "rate": profile.get("rate") or "+0%",
                        "pitch": profile.get("pitch") or "+0Hz"}
        if profile.get("id"):                   # a character from the app: only its own Kokoro voice (none = Piper)
            v["vermeil"]["online"] = profile.get("voice_online") if str(profile.get("voice_online") or "").startswith("kokoro:") else ""
    for nid, n in camp.get("npcs", {}).items():
        if nid in v: continue
        pool = by.get(n.get("gender"), []) or by["neutral"] or anyv
        h = int(hashlib.md5(nid.encode()).hexdigest(), 16)
        voice = pool[h % len(pool)] if pool else None
        rate, pitch = KIND.get(n.get("voice_kind"), ("+0%", "+0Hz"))
        v[nid] = {"voice": voice, "rate": rate, "pitch": pitch}
    return v


# ---- online voices: Kokoro (running on this PC, see senses/kokoro.py), used while the AI is online ----
VERMEIL_ONLINE = None          # set by GameAPI from Vermeil's character settings ("kokoro:af_heart")
KOKORO_EN = {"female": ["af_bella", "af_nicole", "af_sarah", "bf_emma", "af_aoede", "bf_isabella", "af_kore", "bf_alice",
                        "af_nova", "bf_lily", "af_sky", "af_river", "af_jessica", "af_alloy"],
             "male": ["am_michael", "bm_lewis", "am_fenrir", "bm_daniel", "am_puck", "am_eric", "am_liam", "bm_fable",
                      "am_onyx", "am_echo", "am_adam"]}
DM_ONLINE = "kokoro:bm_george"
COMPANION_CLONE = None         # set by GameAPI: the companion's RVC clone {"model", "pitch", "index_rate", "base"} or None


def clone_for(speaker):
    """the RVC clone to use for this speaker - only the companion ever gets one"""
    c = COMPANION_CLONE
    return c if speaker == "vermeil" and isinstance(c, dict) and c.get("model") else None


def online_ready():
    """True when the AI is online (Groq) - then Kokoro is the voice for everyone. If Kokoro is still loading,
    wait for it rather than falling back to the offline voices."""
    try:
        import llm
        if llm.which()["now"] != "groq":
            return False
        import kokoro
        return kokoro.ready() or (kokoro.installed() and kokoro.start(wait=True, max_wait=45))
    except Exception:
        return False


def online_voice(camp, speaker):
    """The Kokoro voice for a speaker (the same one every time). Everyone has one - Kokoro is the online default."""
    if speaker == "vermeil":
        own = (camp.get("voices") or {}).get("vermeil", {}).get("online")
        if own and str(own).startswith("kokoro:"):
            return own
        if str(VERMEIL_ONLINE or "").startswith("kokoro:"):
            return VERMEIL_ONLINE
        g = ((camp.get("companion") or {}).get("gender") or "female").lower()
        return "kokoro:am_michael" if g.startswith("m") else "kokoro:af_heart"
    if speaker == "dm":
        return DM_ONLINE
    npc = (camp.get("npcs") or {}).get(speaker) or {}
    gender = npc.get("gender") if npc.get("gender") in KOKORO_EN else ("female" if int(hashlib.md5(speaker.encode()).hexdigest(), 16) % 2 else "male")
    pool = KOKORO_EN[gender]
    return "kokoro:" + pool[int(hashlib.md5(speaker.encode()).hexdigest(), 16) % len(pool)]


def _unload_extra(key):
    T = _tts()
    if T is None or not key.startswith("piper:"): return
    k = key[6:]
    with _lock:
        if k in _recent: _recent.remove(k)
        _recent.append(k)
        loaded = getattr(T, "_loaded", {})
        while len(_recent) > MAX_LOADED:
            old = _recent.pop(0)
            loaded.pop(old, None)


def _cloned(text, voice, rate, pitch, clone):
    """the companion's line: a normal voice says it (the clone's "Speak with" voice), then RVC turns it into the
    clone. If RVC fails, the normal voice is used."""
    T = _tts()
    try:
        import rvc
        base = rvc.base_voice(clone, rvc.text_language(text), voice)
    except Exception:
        rvc, base = None, voice
    samples, sr = T.synth(text, base, rate, pitch, voice)
    if rvc is not None:
        try:
            samples, sr = rvc.convert(samples, sr, clone)
        except Exception as e:
            print(f"[game voice] RVC: {e} - using the normal voice.")
    return samples, sr


_cache = {}                     # (voice, rate, pitch, clone, text) -> result: repeated lines (greetings, tests) play instantly


def speak(camp, speaker, text):
    """-> {'audio': base64 wav, 'seconds': float} or {'error': ...}. speaker = 'dm', 'vermeil' or an npc/ally id.
    The client sends one sentence (or a few) at a time, so the voice starts quickly and the next part is made
    while this one plays."""
    T = _tts()
    if T is None: return {"error": "speech is not available"}
    if not text or not text.strip(): return {"error": "nothing to say"}
    v = camp.get("voices", {}).get(speaker) or camp.get("voices", {}).get("dm")
    if not v or not v.get("voice"): return {"error": "no voice installed"}
    voice, rate_s, pitch_s = v["voice"], v.get("rate", "+0%"), v.get("pitch", "+0Hz")
    clone = clone_for(speaker)
    # only the companion may use Kokoro (her own online voice); everyone else stays on the fast offline voices
    online = online_voice(camp, speaker) if speaker == "vermeil" and not clone and online_ready() else None
    if online:                                   # Kokoro voices already differ a lot: keep only small tweaks
        voice = online
        if voice == VERMEIL_ONLINE:
            rate_s, pitch_s = "+0%", "+0Hz"
    key = (voice, rate_s, pitch_s, (clone or {}).get("model"), text[:3000])
    if key in _cache:
        return _cache[key]
    try:
        _unload_extra(voice)
        if clone:
            samples, rate = _cloned(text[:3000], voice, rate_s, pitch_s, clone)
        else:
            samples, rate = T.synth(text[:3000], voice, rate_s, pitch_s, v["voice"]) if online else T.synth(text[:3000], voice, rate_s, pitch_s)
        wav = T.to_wav_bytes(samples, rate)
        out = {"audio": base64.b64encode(wav).decode("ascii"), "seconds": round(len(samples) / float(rate), 2), "voice": voice}
        _cache[key] = out
        while len(_cache) > 60:
            _cache.pop(next(iter(_cache)))
        return out
    except Exception as e:
        return {"error": f"{type(e).__name__}: {str(e)[:120]}"}
