"""
intent.py - understands casual wording, so you don't have to say commands a special way.

    "can you put on a song right now pls"  ->  "play music"
    "could you jot this down: buy eggs"    ->  "add note: buy eggs"
    "crank it up"                          ->  "volume up"
    "what's on my plate tomorrow"          ->  "agenda tomorrow"

normalize(text) is used before the instant commands are checked and when choosing which tools the AI gets.
The AI always sees what you actually said; this only helps matching.
"""
import re

# polite / filler words at the start or end that don't change the meaning
_LEAD = re.compile(
    r"^(?:(?:hey|hi|yo|ok(?:ay)?|so|um+|uh+|uhm|hmm+|well|oh|alright|vermi|vermeil|pip|babe|darling)[,\s]+)*"
    r"(?:(?:can|could|would|will|wanna) (?:you|u)(?: please| pls)?\s+|(?:pl(?:ea)?se?|plz|pls|kindly)\s+|"
    r"i (?:want|need|would like|'d like|wanna) (?:you )?to\s+|i want\s+|i need\s+|go ahead and\s+|let'?s\s+|"
    r"(?:do you mind|would you mind)\s+|help me\s+|try to\s+|just\s+)+")
_TAIL = re.compile(r"(?:[,\s]+(?:pl(?:ea)?se?|plz|pls|now|right now|real quick|quickly|asap|for me|thanks|thank you|"
                   r"if you can|ok(?:ay)?|darling|babe))+$")

# (pattern, replacement) - applied in order; whole words only
_SYNONYMS = [
    # music
    (r"\b(?:put on|throw on|blast|bump|spin|queue up|start playing|turn on|crank out|give me|let me hear|play me)\b"
     r"(?=\s+(?:a |an |some |the |my |any |that |this )?(?:song|songs|music|track|tracks|tune|tunes|jam|jams|beat|beats|"
     r"playlist|album|something|anything|[a-z]))", "play"),
    (r"\b(?:next (?:one|song|track)|skip (?:this|that|it)(?: one| song| track)?|change (?:the )?(?:song|track|music))\b", "skip"),
    (r"(?:\b(?:a|some|any|a few|good|nice|random)\s+)?\b(?:songs?|tunes?|tracks?|jams?|beats|bops?|something to listen to|"
     r"some music|music)\b(?=\s*$)", "music"),
    (r"\b(?:crank|pump|turn) (?:it|this|the music|the volume|that) up\b|\bmake it louder\b", "volume up"),
    (r"\b(?:turn|bring) (?:it|this|the music|the volume|that) down\b|\bmake it (?:quieter|softer)\b|\btoo loud\b", "volume down"),
    (r"\b(?:shut (?:it|the music) off|kill the music|stop the (?:song|track|tunes))\b", "stop the music"),
    # notes, reminders, tasks
    (r"\b(?:jot|write|scribble|put|take|make|save|add|create|note)\s+(?:this |that |it )?(?:down|a note|note|in my notes|"
     r"to my notes)\b", "add note"),
    (r"\b(?:don'?t let me forget(?: to)?|make sure i remember(?: to)?|ping me(?: to)?|nudge me(?: to)?|"
     r"set (?:a|an) (?:reminder|alarm)(?: for| to)?)\b", "remind me to"),
    (r"\b(?:add|put|throw|stick) (.+?) (?:on|to|in) (?:my )?(?:to-?do|todo|task)(?: list)?\b", r"add task \1"),
    (r"\b(?:add|put|throw|stick) (.+?) (?:on|to|in) (?:my |the )?(?:shopping|grocery|groceries)(?: list)?\b", r"add to shopping list \1"),
    # calendar
    (r"\b(?:what'?s|what is|whats) (?:on )?(?:my )?(?:plate|schedule|agenda|calendar|day)(?: look like)?\b|"
     r"\bwhat do i (?:have|got)(?: going on)?\b|\bam i (?:free|busy)\b", "agenda"),
    (r"\b(?:book|pencil in|schedule|block off|put)\s+(?:a |an )?(.+?)\s+(?:in|on|into) (?:my )?calendar\b", r"add event \1"),
    # misc
    (r"\b(?:look up|google|search up|find out|check online|search the web for|search for)\b", "search"),
    (r"\b(?:how'?s|what'?s) the weather(?: like)?\b|\bis it (?:going to|gonna) rain\b", "weather"),
    (r"\b(?:be quiet|shush|stop talking|hush)\b", "stop speaking"),
]
_SYN = [(re.compile(p, re.I), r) for p, r in _SYNONYMS]


def strip_polite(text):
    t = (text or "").lower().strip(" .!?~")
    for _ in range(3):
        new = _TAIL.sub("", _LEAD.sub("", t)).strip(" ,.!?~")
        if new == t:
            break
        t = new
    return t


def normalize(text):
    """Casual wording -> plain command words (for matching only)."""
    t = strip_polite(text)
    t = re.sub(r"\b(?:a music|some musics?)\b", "music", t)          # "play a music"
    for rx, rep in _SYN:
        t = rx.sub(rep, t)
    t = re.sub(r"\bplay (?:a |some |any |me |me a |me some |something|anything)?\s*music\b", "play music", t)
    t = re.sub(r"\badd note(?: right)?(?: now)?\b", "add note", t)
    return re.sub(r"\s{2,}", " ", t).strip(" ,.:")


GUIDE = ("The user talks casually. Map ANY wording to the right tool, e.g. 'put on a song' / 'blast some music' = play "
         "music (if no song is named, play something they like); 'jot this down' / 'make a note right now' = add a note "
         "(ask what to write only if they didn't say); 'don't let me forget' = reminder; 'what's on my plate' = agenda; "
         "'crank it up' = volume up. Never refuse because of the wording.")
