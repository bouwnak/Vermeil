"""voice_emotion.py - lets her voice show feelings, one sentence at a time.

Every sentence she says is read for its feeling: *actions* like *giggles* or *sighs* (never read aloud), emoji,
punctuation (!!, ?!, ...) and the words themselves (VADER sentiment). That gives one emotion, and the voice changes
to match:

  happy      a bit faster and higher            excited    faster, higher, louder
  sad        slower, lower, quieter             angry      a bit faster, lower, louder
  surprised  much higher                        soft       slower and quiet (shy, tender, whispering)
  scared     faster, higher, a little quieter

It works with every voice (Piper, Edge, Kokoro) and with RVC voice clones, because the clone follows the pitch of
the voice underneath it. Her 3D face changes too while she says that sentence.
"""
import re

# rate %, pitch Hz, volume x, face in the room (None = keep the face)
EMOTIONS = {
    "neutral": (0, 0, 1.0, None),
    "happy": (6, 10, 1.05, "happy"),
    "excited": (12, 18, 1.15, "happy"),
    "sad": (-12, -12, 0.82, "sad"),
    "angry": (8, -6, 1.2, "angry"),
    "surprised": (6, 22, 1.1, "surprised"),
    "soft": (-9, 3, 0.72, None),
    "scared": (10, 14, 0.9, "surprised"),
}

# words inside *actions* (and a few spoken words) that name a feeling
_ACTION = [
    ("excited", r"squeal|bounc|jump|cheer|clap|beam|excit|yay"),
    ("happy", r"giggl|laugh|smil|grin|chuckl|hum|wink|happ|hehe|haha"),
    ("sad", r"sigh|sniff|sob|cr(y|ies)|tear|frown|pout|sad|sulk|droop"),
    ("angry", r"growl|huff|glare|scowl|fum|angr|annoy|grumbl|stomp|cross(es)? (her|his) arms"),
    ("surprised", r"gasp|blink|wide.?eye|jaw drop|surpris|shock|startl"),
    ("soft", r"whisper|blush|shy|fidget|murmur|softly|gentl|lean(s)? close|hug|nuzzl|yawn"),
    ("scared", r"shiver|trembl|gulp|flinch|scared|nervous|panic"),
]
_EMOJI = [
    ("excited", "🎉🥳🤩✨🔥💃"), ("happy", "😊😄😁😆🙂😀☺😃😸💕💖❤🥰😍😘"),
    ("sad", "😢😭😞😔🥺💔😿☹🙁"), ("angry", "😠😡🤬💢😤"), ("surprised", "😮😲😯😱🤯❗"),
    ("soft", "😳🙈🫣😌🤭"), ("scared", "😨😰😧"),
]
_SURPRISE_WORDS = re.compile(r"\b(wow|whoa|woah|oh my|no way|really\?|what\?!|seriously\?|omg|eh\?|huh\?!)", re.I)
_SCARED_WORDS = re.compile(r"\b(scary|scared|afraid|terrif|creepy|eek)", re.I)


def detect(raw, analyzer=None):
    """(emotion, strength 0..1) for one sentence as the AI wrote it (with its *actions* and emoji still in)."""
    raw = raw or ""
    actions = " ".join(re.findall(r"\*([^*]{1,60})\*", raw)).lower()
    if actions:
        for emo, pattern in _ACTION:
            if re.search(pattern, actions):
                return emo, 1.0
    for emo, chars in _EMOJI:
        if any(c in raw for c in chars):
            return emo, 0.9
    text = re.sub(r"\*[^*]*\*", "", raw)
    if "?!" in text or "!?" in text or _SURPRISE_WORDS.search(text):
        return "surprised", 0.8
    if _SCARED_WORDS.search(text):
        return "scared", 0.6
    if re.search(r"\b(ha){2,}|\b(he){2,}|\bhihi", text, re.I):
        return "happy", 0.8                                       # she laughs while she talks
    compound = analyzer.polarity_scores(text)["compound"] if analyzer and text.strip() else 0.0
    bangs = text.count("!")
    if compound >= 0.3:
        return ("excited", 0.9) if bangs >= 2 or (bangs and compound >= 0.7) else ("happy", min(1.0, compound + 0.25))
    if text.rstrip().endswith("~"):
        return "happy", 0.6                                       # playful "okay~"
    if compound <= -0.3:
        if bangs:
            return "angry", min(1.0, -compound + 0.1)
        return "sad", min(1.0, -compound + 0.2)
    if bangs >= 2:
        return "excited", 0.6
    if re.search(r"(\.\.\.|…)\s*$", text.strip()) and compound < 0:
        return "sad", 0.5
    return "neutral", 0.0


def prosody(emotion, strength=1.0, amount=1.0):
    """How much to change the voice: (rate %, pitch Hz, volume x, face). amount = the character's slider (0..1.5)."""
    rate, pitch, vol, face = EMOTIONS.get(emotion, EMOTIONS["neutral"])
    k = max(0.0, min(1.0, strength)) * max(0.0, min(1.5, amount))
    return round(rate * k), round(pitch * k), 1 + (vol - 1) * k, face if k >= 0.3 else None
