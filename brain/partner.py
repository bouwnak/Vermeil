"""partner.py - Language practice partner: a real spoken conversation in the language you're learning.

She talks in that language at your level, you answer out loud, she answers back - like a call with a native
speaker. When you make a mistake she says the fix first (in your character's normal voice), then carries on
in the language (in a native voice for it). Everything also shows in Study -> Sensei, and the phone app can use it.

  Partner(emit, listen, speak_native, speak_language)
  .start(language, level, topic)   begins (her opening line is said out loud)
  .respond(text)                   one turn from typed / phone text -> her reply (dict)
  .stop()                          ends it; you get your score and the mistakes are kept for later lessons
Say "stop practice" (or just stay quiet for a while) to end it by voice.
"""
import re
import threading

STOP = re.compile(r"^(?:stop|end|finish|quit|cancel)\b.*\b(?:practi[cs]e|practi[cs]ing|lesson|talking|conversation|partner)\b|"
                  r"^(?:stop|tama na|that'?s enough|goodbye|bye bye|bye|i'?m done)$", re.I)
QUIET_TURNS = 4                       # this many silent listens in a row -> she ends the practice
_SCRIPT = re.compile(r"[぀-ヿ㐀-鿿가-힯ᄀ-ᇿ฀-๿Ѐ-ӿｦ-ﾟ]")


def split_reply(reply):
    """(correction, conversation): the "✏️ Corrections:" part (if any) and the rest."""
    text = (reply or "").strip()
    m = re.match(r"^\W{0,3}\s*\**corrections?\**\s*:?\**\s*", text, re.I)
    if not m:
        return "", text
    body = text[m.end():]
    parts = re.split(r"\n\s*\n", body, maxsplit=1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    lines = body.splitlines()
    return (lines[0].strip(), "\n".join(lines[1:]).strip()) if len(lines) > 1 else (body.strip(), "")


def spoken_correction(correction):
    """the correction as your character can say it: no markdown, no foreign script (the native voice says that)"""
    t = re.sub(r"[*_`#>|]", " ", correction or "")
    t = re.sub(r"\([^)]*\)", lambda m: m.group(0) if not _SCRIPT.search(m.group(0)) else " ", t)
    t = _SCRIPT.sub(" ", t).replace("→", ", should be ").replace("->", ", should be ")
    t = re.sub(r"\s*([,.;:])(?:\s*[,.;:])+", r"\1", re.sub(r"\s{2,}", " ", t)).strip(" ,.;:-")
    return t


class Partner:
    def __init__(self, emit, listen, speak_native, speak_language):
        self.emit = emit                       # emit({"type": "partner", ...}) -> the window / phone
        self.listen = listen                   # listen() -> heard text or None
        self.speak_native = speak_native       # speak_native(text): the character's own voice
        self.speak_language = speak_language   # speak_language(text, language): a voice for that language
        self.active = False
        self.session = None
        self.language = None
        self.by_voice = False
        self._lock = threading.Lock()

    def status(self):
        return {"active": self.active, "language": self.language, "session": self.session}

    def start(self, language=None, level=None, topic="", by_voice=True):
        import mind
        import sensei
        if self.active:
            self.stop(quiet=True)
        st = sensei._state()
        language = language if language in sensei.LANGS else st.get("language", "ja")
        level = int(level or st.get("level", 2))
        topic = (topic or "").strip() or "everyday life: say hello, ask about my day, then keep chatting"
        p = mind.practice_start("sensei", topic, level, language)
        if p.get("error"):
            return p
        self.session, self.language, self.active, self.by_voice = p, language, True, by_voice
        self.emit({"type": "partner", "event": "start", "language": language, "name": sensei.LANGS[language], "session": p})
        if by_voice:
            threading.Thread(target=self._loop, args=(p["messages"][-1]["content"] if p["messages"] else "",), daemon=True).start()
        return {"ok": True, "language": language, "name": sensei.LANGS[language], "session": p}

    def say(self, reply):
        correction, talk = split_reply(reply)
        fix = spoken_correction(correction)
        if fix:
            self.speak_native("Small fix: " + fix)
        if talk:
            self.speak_language(talk, self.language)

    def respond(self, text, speak=False):
        """one turn: your line -> her answer (dict with "reply", "correction", "talk")"""
        import mind
        text = (text or "").strip()
        if not self.active or not self.session:
            return {"error": "Start a practice first."}
        if not text:
            return {"error": "Say something first."}
        if STOP.search(text):
            return self.stop()
        with self._lock:
            p = mind.practice_reply(self.session["id"], text)
        if p.get("error"):
            return p
        self.session = p
        reply = p["messages"][-1]["content"]
        correction, talk = split_reply(reply)
        self.emit({"type": "partner", "event": "turn", "you": text, "reply": reply, "correction": correction})
        if speak:
            self.say(reply)
        return {"reply": reply, "correction": correction, "talk": talk, "language": self.language}

    def stop(self, quiet=False):
        import mind
        if not self.active:
            return {"ok": True, "message": "No practice is running."}
        self.active = False
        sid = self.session["id"] if self.session else None
        result = {}
        if sid:
            try:
                result = mind.practice_finish(sid)
            except Exception as e:
                result = {"error": str(e)}
        self.emit({"type": "partner", "event": "stop", "score": result.get("score", ""), "session": result})
        if not quiet and self.by_voice:
            self.speak_native("Great practice! Your score and the mistakes to review are in Study, under Sensei.")
        return {"ok": True, "score": result.get("score", ""), "message": "Practice finished. Your score is in Study → Sensei."}

    def _loop(self, opening):
        try:
            if opening:
                self.say(opening)
            quiet = 0
            while self.active:
                heard = self.listen()
                if not self.active:
                    break
                if not heard:
                    quiet += 1
                    if quiet >= QUIET_TURNS:
                        self.stop()
                    continue
                quiet = 0
                out = self.respond(heard)
                if not self.active or out.get("error"):
                    continue
                self.say(out["reply"])
        except Exception as e:
            print(f"[partner] {e}")
            self.active = False
            self.emit({"type": "partner", "event": "stop", "error": str(e)})
