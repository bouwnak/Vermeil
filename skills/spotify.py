"""
spotify.py - Spotify for Vermeil: log in once, then she can play, pause, skip, search, queue, like songs,
play your playlists and show what's playing (with the album cover) in the Spotify panel.

WHERE YOUR KEYS GO
  The 'env' file in the project folder (next to app.py), the same file as GROQ_API_KEY:
      SPOTIFY_CLIENT_ID=your client id
      SPOTIFY_CLIENT_SECRET=your client secret
  (or paste them into Settings in the Spotify panel - it writes them into that file for you)

ONE-TIME SETUP (developer.spotify.com/dashboard)
  1. Create app -> any name/description.
  2. Redirect URI: exactly  http://127.0.0.1:8888/callback   (Spotify no longer accepts "localhost")
  3. Tick "Web API", save. Copy the Client ID and Client secret into the env file.
  4. In Vermeil: Spotify panel -> Connect. A Spotify page opens once to ask permission.

GOOD TO KNOW (Spotify's rules, not Vermeil's)
  - Spotify only lets Premium accounts create developer apps, and only Premium accounts can be controlled
    (play/pause/skip). Up to 5 people can use one app in "Development mode".
  - Something must be running Spotify (the PC app, phone...). If nothing is, she opens the Spotify app on your PC.
"""
import base64
import json
import os
import re
import secrets
import threading
import time
from urllib.parse import urlencode, urlparse, parse_qs

import requests

from paths import BASE_DIR, data_file

TOKEN_FILE = data_file("spotify_token.json")
API = "https://api.spotify.com/v1"
AUTH_URL = "https://accounts.spotify.com/authorize"
TOKEN_URL = "https://accounts.spotify.com/api/token"
DEFAULT_REDIRECT = "http://127.0.0.1:8888/callback"
SCOPES = ("user-read-playback-state user-modify-playback-state user-read-currently-playing "
          "playlist-read-private playlist-read-collaborative user-library-read user-library-modify "
          "user-read-recently-played user-top-read playlist-modify-private playlist-modify-public")


def can_make_playlists():
    """True when the login allows creating playlists (logins from before this feature need Connect once more)."""
    scope = (_token() or {}).get("scope")
    return scope is None or "playlist-modify" in scope


class SpotifyError(RuntimeError):
    pass


# ------------------------------------------------------------------ your keys (env file)
def client_id():
    return os.environ.get("SPOTIFY_CLIENT_ID", "").strip()


def client_secret():
    return os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()


def redirect_uri():
    return os.environ.get("SPOTIFY_REDIRECT_URI", "").strip() or DEFAULT_REDIRECT


def env_path():
    for name in (".env", "env"):
        p = os.path.join(BASE_DIR, name)
        if os.path.exists(p):
            return p
    return os.path.join(BASE_DIR, "env")


def save_credentials(cid, secret):
    """Write SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET into the env file (other lines are kept as they are)."""
    cid, secret = (cid or "").strip(), (secret or "").strip()
    if not re.fullmatch(r"[0-9a-fA-F]{32}", cid):
        raise ValueError("That Client ID doesn't look right (it's 32 letters/numbers from the Spotify dashboard).")
    if secret and not re.fullmatch(r"[0-9a-fA-F]{32}", secret):
        raise ValueError("That Client secret doesn't look right (32 letters/numbers - click 'View client secret').")
    path = env_path()
    lines = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    values = {"SPOTIFY_CLIENT_ID": cid, **({"SPOTIFY_CLIENT_SECRET": secret} if secret else {})}
    for key, val in values.items():
        for i, line in enumerate(lines):
            if re.match(rf"\s*{key}\s*=", line):
                lines[i] = f"{key}={val}"
                break
        else:
            lines.append(f"{key}={val}")
        os.environ[key] = val
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path


# ------------------------------------------------------------------ logging in
def _token():
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _save_token(tok):
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        json.dump(tok, f)


def status():
    tok = _token()
    return {"has_keys": bool(client_id() and client_secret()), "connected": bool(tok and tok.get("refresh_token")),
            "redirect_uri": redirect_uri(), "env_file": os.path.basename(env_path()),
            "client_id_hint": (client_id()[:4] + "…" + client_id()[-4:]) if client_id() else "",
            "user": (tok or {}).get("user")}


def auth_url(state):
    return AUTH_URL + "?" + urlencode({"client_id": client_id(), "response_type": "code", "redirect_uri": redirect_uri(),
                                      "scope": SCOPES, "state": state, "show_dialog": "true"})


def _basic():
    return "Basic " + base64.b64encode(f"{client_id()}:{client_secret()}".encode()).decode()


def _exchange(data):
    r = requests.post(TOKEN_URL, data=data, headers={"Authorization": _basic()}, timeout=20)
    if r.status_code != 200:
        raise SpotifyError(f"Spotify login failed ({r.status_code}): {r.text[:200]}")
    tok = r.json()
    tok["expires_at"] = time.time() + int(tok.get("expires_in", 3600)) - 60
    return tok


def finish_login(code):
    tok = _exchange({"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri()})
    _save_token(tok)
    try:
        me = call("GET", "/me")
        tok["user"] = me.get("display_name") or me.get("id")
        _save_token(tok)
    except Exception:
        pass
    return tok


def login(open_browser=True, timeout=300, on_done=None):
    """Opens Spotify's permission page and waits for it to come back to http://127.0.0.1:8888/callback."""
    from http.server import BaseHTTPRequestHandler, HTTPServer
    if not (client_id() and client_secret()):
        raise SpotifyError("Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET first (env file, or the Spotify panel).")
    u = urlparse(redirect_uri())
    if u.hostname not in ("127.0.0.1", "localhost"):
        raise SpotifyError("The redirect URI must be http://127.0.0.1:<port>/callback for Vermeil.")
    state = secrets.token_urlsafe(16)
    result = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            q = parse_qs(urlparse(self.path).query)
            if urlparse(self.path).path != u.path:
                self.send_response(404); self.end_headers(); return
            ok = q.get("state", [""])[0] == state and "code" in q
            if ok:
                try:
                    finish_login(q["code"][0])
                    result["ok"] = True
                except Exception as e:
                    result["error"] = str(e)
            else:
                result["error"] = q.get("error", ["Login was cancelled or didn't match."])[0]
            msg = "Spotify is connected to Vermeil - you can close this tab." if result.get("ok") else f"Spotify login failed: {result.get('error')}"
            body = f"<html><body style='font-family:sans-serif;background:#111;color:#eee;padding:40px'><h2>{msg}</h2></body></html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body.encode())

        def log_message(self, *a):
            pass

    server = HTTPServer((u.hostname, u.port or 80), Handler)
    server.timeout = 1

    def serve():
        end = time.time() + timeout
        try:
            while not result and time.time() < end:
                server.handle_request()
        finally:
            server.server_close()
            if on_done:
                on_done(result or {"error": "Timed out waiting for the Spotify login."})
    threading.Thread(target=serve, daemon=True).start()
    if open_browser:
        import webbrowser
        webbrowser.open(auth_url(state))
    return auth_url(state)


def logout():
    try:
        os.remove(TOKEN_FILE)
    except OSError:
        pass
    return "Disconnected Spotify."


def access_token():
    tok = _token()
    if not tok:
        raise SpotifyError("Spotify isn't connected yet - open the Spotify panel and click Connect.")
    if time.time() >= tok.get("expires_at", 0):
        new = _exchange({"grant_type": "refresh_token", "refresh_token": tok["refresh_token"]})
        new.setdefault("refresh_token", tok["refresh_token"])       # Spotify only sometimes sends a new one
        new["user"] = tok.get("user")
        _save_token(new)
        tok = new
    return tok["access_token"]


# ------------------------------------------------------------------ talking to Spotify
def call(method, path, params=None, body=None, retry=True):
    r = requests.request(method, API + path, params=params, json=body, timeout=15,
                         headers={"Authorization": f"Bearer {access_token()}"})
    if r.status_code == 401 and retry:                 # token expired early
        tok = _token() or {}
        tok["expires_at"] = 0
        _save_token(tok)
        return call(method, path, params, body, retry=False)
    if r.status_code == 429:
        raise SpotifyError(f"Spotify says slow down - try again in {r.headers.get('Retry-After', 'a few')} seconds.")
    if r.status_code >= 400:
        try:
            err = r.json().get("error", {})
            reason, msg = err.get("reason", ""), err.get("message", "")
        except ValueError:
            reason, msg = "", r.text[:200]
        if reason == "PREMIUM_REQUIRED" or "premium" in msg.lower():
            raise SpotifyError("Spotify only allows controlling playback on Premium accounts.")
        if reason == "NO_ACTIVE_DEVICE" or r.status_code == 404 and path.startswith("/me/player"):
            raise NoDevice(msg or "No active Spotify device.")
        raise SpotifyError(f"Spotify error {r.status_code}: {msg or reason}")
    if r.status_code == 204 or not r.content:
        return {}
    try:
        return r.json()
    except ValueError:
        return {}


class NoDevice(SpotifyError):
    pass


def devices():
    return call("GET", "/me/player/devices").get("devices", [])


def _wake_device():
    """No Spotify is playing anywhere: use an open device, or start the Spotify app on this PC."""
    devs = devices()
    if not devs and os.name == "nt":
        try:
            os.startfile("spotify:")
        except OSError:
            pass
        for _ in range(16):                                    # up to ~8 s for the app to start
            time.sleep(0.5)
            devs = devices()
            if devs:
                break
    if not devs:
        raise SpotifyError("Spotify isn't open on any device. Open the Spotify app, then try again.")
    pick = next((d for d in devs if d.get("is_active")), None) or \
        next((d for d in devs if d.get("type") == "Computer"), None) or devs[0]
    call("PUT", "/me/player", body={"device_ids": [pick["id"]], "play": False})
    time.sleep(0.4)
    return pick


def _player(method, path, params=None, body=None):
    try:
        return call(method, path, params, body)
    except NoDevice:
        _wake_device()
        return call(method, path, params, body)


# ------------------------------------------------------------------ what's playing
def _track_info(item):
    if not item:
        return None
    imgs = (item.get("album") or {}).get("images") or item.get("images") or []
    return {"title": item.get("name", ""), "artist": ", ".join(a["name"] for a in item.get("artists", [])),
            "album": (item.get("album") or {}).get("name", ""), "uri": item.get("uri"), "id": item.get("id"),
            "image": imgs[0]["url"] if imgs else "", "small_image": imgs[-1]["url"] if imgs else "",
            "duration": int(item.get("duration_ms") or 0) // 1000}


def now_playing():
    st = call("GET", "/me/player")
    if not st:
        return {"active": False}
    t = _track_info(st.get("item"))
    dev = st.get("device") or {}
    return {"active": True, "playing": bool(st.get("is_playing")), "track": t,
            "progress": int(st.get("progress_ms") or 0) // 1000, "shuffle": bool(st.get("shuffle_state")),
            "repeat": st.get("repeat_state", "off"), "volume": dev.get("volume_percent"),
            "device": dev.get("name"), "device_id": dev.get("id")}


def now_text():
    try:
        n = now_playing()
    except SpotifyError as e:
        return str(e)
    if not n.get("active") or not n.get("track"):
        return "Nothing is playing on Spotify."
    t = n["track"]
    return f"{'Playing' if n['playing'] else 'Paused'}: {t['title']} by {t['artist']} ({n['progress'] // 60}:{n['progress'] % 60:02d}) on {n['device']}."


# ------------------------------------------------------------------ control
def pause():
    _player("PUT", "/me/player/pause")
    return "Paused Spotify."


def resume():
    _player("PUT", "/me/player/play")
    return "Playing again."


def next_track():
    _player("POST", "/me/player/next")
    return "Skipped."


def previous_track():
    _player("POST", "/me/player/previous")
    return "Back to the previous song."


def seek(seconds):
    _player("PUT", "/me/player/seek", {"position_ms": max(0, int(float(seconds) * 1000))})
    return f"Jumped to {int(seconds) // 60}:{int(seconds) % 60:02d}."


def set_volume(percent):
    p = max(0, min(100, int(percent)))
    _player("PUT", "/me/player/volume", {"volume_percent": p})
    return f"Spotify volume {p}%."


def shuffle(on=True):
    _player("PUT", "/me/player/shuffle", {"state": "true" if on else "false"})
    return f"Shuffle {'on' if on else 'off'}."


def repeat(mode="context"):
    mode = mode if mode in ("track", "context", "off") else "context"
    _player("PUT", "/me/player/repeat", {"state": mode})
    return {"track": "Repeating this song.", "context": "Repeating the playlist/album.", "off": "Repeat off."}[mode]


def transfer(device_id):
    call("PUT", "/me/player", body={"device_ids": [device_id], "play": True})
    return "Moved the music."


# ------------------------------------------------------------------ search & play
def search(query, kind="track,artist,album,playlist", limit=8):
    """Spotify now allows at most 10 results per type."""
    data = call("GET", "/search", {"q": query, "type": kind, "limit": max(1, min(10, limit))})
    out = {"tracks": [_track_info(t) for t in (data.get("tracks") or {}).get("items", []) if t]}
    out["artists"] = [{"name": a["name"], "uri": a["uri"], "image": (a.get("images") or [{}])[0].get("url", "")}
                      for a in (data.get("artists") or {}).get("items", []) if a]
    out["albums"] = [{"name": a["name"], "artist": ", ".join(x["name"] for x in a.get("artists", [])), "uri": a["uri"],
                      "image": (a.get("images") or [{}])[0].get("url", "")} for a in (data.get("albums") or {}).get("items", []) if a]
    out["playlists"] = [{"name": p["name"], "owner": (p.get("owner") or {}).get("display_name", ""), "uri": p["uri"],
                         "image": (p.get("images") or [{}])[0].get("url", "") if p.get("images") else ""}
                        for p in (data.get("playlists") or {}).get("items", []) if p]
    return out


def play_uri(uri):
    """Play a track, or start an album / artist / playlist."""
    if ":track:" in uri:
        _player("PUT", "/me/player/play", body={"uris": [uri]})
    else:
        _player("PUT", "/me/player/play", body={"context_uri": uri})
    return "Playing."


def play(query, kind=None):
    """'Sunrise Rex Orange County' -> best match. kind: track / artist / album / playlist (None = guess)."""
    q = (query or "").strip()
    if not q:
        return "What should I play?"
    if re.search(r"\bplaylist\b", q, re.I) and not kind:            # "my gym playlist" -> YOUR playlist, not a song
        return play_playlist(q)
    if not kind:                                                     # exactly one of your playlist names?
        try:
            own = next((p for p in playlists() if p["name"].lower() == q.lower()), None)
            if own:
                play_uri(own["uri"])
                return f"Playing your playlist {own['name']}."
        except SpotifyError:
            pass
    m = re.match(r"^(?:the\s+)?(album|playlist|artist)\s+(.+)$", q, re.I)
    if m and not kind:
        kind, q = m.group(1).lower(), m.group(2)
    if re.search(r"\b(songs? by|music by|some)\b", q, re.I) and not kind:
        kind, q = "artist", re.sub(r"^.*\b(?:songs? by|music by|some)\s+", "", q, flags=re.I)
    res = search(q, kind or "track", limit=5)
    if kind in (None, "track") and res["tracks"]:
        t = res["tracks"][0]
        play_uri(t["uri"])
        return f"Playing {t['title']} by {t['artist']} on Spotify."
    for key, label in (("artists", "artist"), ("albums", "album"), ("playlists", "playlist")):
        if res.get(key):
            x = res[key][0]
            play_uri(x["uri"])
            return f"Playing the {label} {x['name']} on Spotify."
    return f"I couldn't find '{query}' on Spotify."


def add_to_queue(query_or_uri):
    uri = query_or_uri if str(query_or_uri).startswith("spotify:track:") else None
    name = query_or_uri
    if not uri:
        tracks = search(query_or_uri, "track", 3)["tracks"]
        if not tracks:
            return f"I couldn't find '{query_or_uri}' on Spotify."
        uri, name = tracks[0]["uri"], f"{tracks[0]['title']} by {tracks[0]['artist']}"
    _player("POST", "/me/player/queue", {"uri": uri})
    return f"Added {name} to the Spotify queue."


def queue():
    data = call("GET", "/me/player/queue")
    return [_track_info(t) for t in data.get("queue", [])[:20] if t]


# ------------------------------------------------------------------ your library
_playlist_cache = {"at": 0.0, "items": []}


def playlists(limit=50, fresh=False):
    if not fresh and time.time() - _playlist_cache["at"] < 300 and _playlist_cache["items"]:
        return _playlist_cache["items"]
    data = call("GET", "/me/playlists", {"limit": limit})
    _playlist_cache["items"] = [{"name": p["name"], "uri": p["uri"], "id": p["id"], "owner": (p.get("owner") or {}).get("display_name", ""),
             "count": ((p.get("items") or p.get("tracks") or {}).get("total")),       # Feb 2026: 'tracks' -> 'items'
             "image": (p.get("images") or [{}])[0].get("url", "") if p.get("images") else ""}
            for p in data.get("items", []) if p]
    _playlist_cache["at"] = time.time()
    return _playlist_cache["items"]


def _norm_name(text):
    t = (text or "").lower()
    t = re.sub(r"\b(my|the|a|playlist|playlists|on spotify|spotify|please|pls|songs?)\b", " ", t)
    return re.sub(r"[^\w\s]", "", t).strip()


def find_playlist(name, lists=None):
    """Your playlist that best matches what you said: exact > starts with > contains > close spelling ('geym' -> 'Geym')."""
    import difflib
    lists = lists if lists is not None else playlists()
    want = _norm_name(name)
    if not want or not lists:
        return None
    names = {p["name"]: p for p in lists}
    norm = {_norm_name(n) or n.lower(): p for n, p in names.items()}
    if want in norm:
        return norm[want]
    for test in (lambda k: k.startswith(want), lambda k: want in k.split(), lambda k: want in k):
        hit = next((p for k, p in norm.items() if test(k)), None)
        if hit:
            return hit
    close = difflib.get_close_matches(want, list(norm), n=1, cutoff=0.6)
    return norm[close[0]] if close else None


def play_playlist(name=""):
    lists = playlists()
    if not lists:
        return "You don't have any playlists on Spotify yet."
    if not _norm_name(name) or _norm_name(name) in ("any", "random", "one", "a", "some"):
        import random
        hit = random.choice(lists)
    else:
        hit = find_playlist(name, lists)
    if not hit:
        return f"You don't have a playlist called '{name}'. You have: " + ", ".join(p["name"] for p in lists[:15])
    play_uri(hit["uri"])
    return f"Playing your playlist {hit['name']}."


def liked_songs(limit=50):
    data = call("GET", "/me/tracks", {"limit": limit})
    return [_track_info(x.get("track") or x.get("item")) for x in data.get("items", []) if (x.get("track") or x.get("item"))]


def play_liked(shuffle_on=True):
    songs = liked_songs()
    if not songs:
        return "You don't have liked songs yet."
    uris = [s["uri"] for s in songs]
    if shuffle_on:
        import random
        random.shuffle(uris)
    _player("PUT", "/me/player/play", body={"uris": uris})
    return f"Playing your liked songs ({len(uris)})."


def like_current(like=True):
    n = now_playing()
    if not n.get("track"):
        return "Nothing is playing to like."
    call("PUT" if like else "DELETE", "/me/library", body={"uris": [n["track"]["uri"]]})     # Feb 2026 library endpoint
    return f"{'Saved' if like else 'Removed'} {n['track']['title']} {'to' if like else 'from'} your Liked Songs."


def is_liked(uri):
    try:
        data = call("GET", "/me/library/contains", {"uris": uri})
        return bool(data[0]) if isinstance(data, list) and data else False
    except SpotifyError:
        return False


def recent(limit=20):
    data = call("GET", "/me/player/recently-played", {"limit": limit})
    return [_track_info(x.get("track")) for x in data.get("items", []) if x.get("track")]


def top_tracks(limit=20, time_range="short_term"):
    data = call("GET", "/me/top/tracks", {"limit": limit, "time_range": time_range})
    return [_track_info(t) for t in data.get("items", []) if t]


# ------------------------------------------------------------------ one switch for voice / AI commands
def control(action, query="", when="now"):
    """Same actions as the YouTube player (f1.music_control), done on Spotify."""
    try:
        if action == "play":
            if when in ("next", "later"):
                return add_to_queue(query)
            return play(query)
        if action in ("pause", "stop"):
            return pause()
        if action == "resume":
            return resume()
        if action in ("skip", "next", "play queued now"):
            return next_track()
        if action == "previous":
            return previous_track()
        if action == "replay":
            return seek(0)
        if action == "favorite":
            return like_current(True)
        if action == "shuffle":
            return shuffle(not now_playing().get("shuffle"))
        if action == "queue":
            q = queue()
            return "Up next on Spotify:\n" + "\n".join(f"{i + 1}. {t['title']} - {t['artist']}" for i, t in enumerate(q[:10])) if q else "The Spotify queue is empty."
        if action in ("playlist", "show playlist"):
            return "Your playlists: " + ", ".join(p["name"] for p in playlists()[:20])
        if action == "clear queue":
            return "Spotify doesn't let apps clear the queue - skip the songs instead."
        if action == "resume queue":
            return resume()
        return "I can't do that on Spotify."
    except SpotifyError as e:
        return str(e)
