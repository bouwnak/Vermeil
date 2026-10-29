"""The voice of the Unity adventure (C:\\Users\\jpant\\My project).
    python game_tools/unity_voice_server.py            (the game also starts it by itself when it can)
Listens on http://127.0.0.1:8790 (only this computer):
  GET /ping                         -> {"ok": true, "companion": "Vermeil", "clone": true}
  GET /say?speaker=vermeil&text=Hi  -> a .wav of the line
Only the companion (speaker "vermeil") uses the voice clone (RVC) of the character chosen in the app.
Everyone else (smith, trader, narrator...) uses the fast offline Piper voices.
The clone is loaded once at start ("warming up"), so her first line in the game doesn't wait for it."""
import base64, http.server, json, os, sys, threading, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
for d in ("brain", "senses", "skills"):
    sys.path.insert(0, os.path.join(ROOT, d))
from game import voices
import tts
from paths import data_file

PORT = 8790
# the village people of the Unity game: they get their own (offline) voices
NPCS = {"smith": ("male", "gruff"), "trader": ("male", "warm"), "tailor": ("female", "young"),
        "bellkeeper": ("female", "deep"), "elder": ("male", "deep"), "ally": ("neutral", "young")}


def companion():
    """the character chosen in the Vermeil app: its name, offline voice and voice clone"""
    try:
        with open(data_file("characters.json"), encoding="utf-8") as f:
            d = json.load(f)
        c = next((c for c in d["characters"] if c["id"] == d.get("active")), d["characters"][0])
    except Exception:
        c = {"id": "vermeil", "name": "Vermeil"}
    voice = tts.resolve_voice(c.get("voice") or tts.DEFAULT_VOICE)
    if voice.startswith("kokoro:"):
        voice = tts.DEFAULT_VOICE
    return {"id": c.get("id"), "name": c.get("name") or "Vermeil", "voice": voice, "rate": c.get("rate") or "+0%",
            "pitch": c.get("pitch") or "+0Hz", "rvc": c.get("rvc") if (c.get("rvc") or {}).get("model") else None}


PROFILE = companion()
CAMP = {"settings": {"voice": True}, "npcs": {k: {"gender": g, "voice_kind": kind} for k, (g, kind) in NPCS.items()}}
voices.assign(CAMP, PROFILE["voice"], PROFILE)
voices.COMPANION_CLONE = PROFILE["rvc"]
LOCK = threading.Lock()                      # one line at a time (the voice models aren't thread safe)


def say(speaker, text):
    with LOCK:
        return voices.speak(CAMP, speaker if speaker in CAMP["voices"] else "dm", text)


def warm_up():
    """load the clone + the offline voice now, so the first real line is quick"""
    for who in ("vermeil", "smith"):
        r = say(who, "Ready.")
        print(f"[voice] {who}: {'ready' if r.get('audio') else r.get('error')}", flush=True)


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, kind):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        if url.path == "/ping":
            return self.send(200, json.dumps({"ok": True, "companion": PROFILE["name"], "clone": bool(PROFILE["rvc"])}).encode(), "application/json")
        if url.path == "/say":
            r = say(q.get("speaker", "dm"), q.get("text", "")[:600])
            if r.get("audio"):
                return self.send(200, base64.b64decode(r["audio"]), "audio/wav")
            return self.send(503, json.dumps(r).encode(), "application/json")
        self.send(404, b"{}", "application/json")


if __name__ == "__main__":
    threading.Thread(target=warm_up, daemon=True).start()
    print(f"[voice] Unity voice server on http://127.0.0.1:{PORT} - companion: {PROFILE['name']}"
          f" ({'voice clone' if PROFILE['rvc'] else 'offline voice'})", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
