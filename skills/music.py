"""
music.py - extra music features on top of f1's YouTube player.

  pause / resume / seek("+30" / "-10" / "1:20") / replay
  favorites: favorite_current(), play_favorites()
  history:   every song played is remembered (data/music_history.json)
  play_mood("studying" / "gym" / "sad" ...)   a playlist made from your taste + the mood
  recommend(play=False)                         songs like the ones you play most
  find_song("that song that goes 'I'm on the edge of glory'")   from lyrics or a description
"""
import json
import re
import time
from collections import Counter
from datetime import datetime

from paths import data_file

import f1

HISTORY_FILE = data_file("music_history.json")
FAV_FILE = data_file("music_favorites.json")


def _read(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def _write(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ------------------------------------------------------------------ playback control
def _proc():
    p = f1.current_process
    return p if p and p.poll() is None else None


def position():
    if not _proc():
        return 0
    end = f1.paused_at or time.time()
    return max(0, int(end - f1.play_started))


def pause():
    p = _proc()
    if not p:
        return "Nothing is playing."
    if f1.paused_at:
        return "It's already paused."
    import psutil
    psutil.Process(p.pid).suspend()
    f1.paused_at = time.time()
    return f"Paused {f1.now_playing}."


def resume():
    p = _proc()
    if not p or not f1.paused_at:
        return "Nothing is paused."
    import psutil
    psutil.Process(p.pid).resume()
    f1.play_started += time.time() - f1.paused_at          # don't count the paused time
    f1.paused_at = None
    return f"Playing {f1.now_playing} again."


def _restart(at):
    p = _proc()
    if not p:
        return False
    if f1.paused_at:
        import psutil
        psutil.Process(p.pid).resume()
    f1.restart_at = max(0, int(at))
    p.kill()                                                # the player loop restarts the song at restart_at
    return True


def _seconds(text):
    t = str(text).strip()
    m = re.fullmatch(r"(\d+):(\d{1,2})", t)
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    m = re.search(r"(\d+)\s*(?:min|m\b)", t)
    if m:
        return int(m.group(1)) * 60 + int((re.search(r"(\d+)\s*s", t) or [0, 0])[1] or 0)
    return int(float(re.sub(r"[^\d.]", "", t) or 0))


def seek(to):
    """'+30' forward, '-10' back, '1:20' or '80' to a spot."""
    if f1.external_player and f1.use_external() and not _proc():
        import spotify
        try:
            t = str(to).strip().lower()
            cur = spotify.now_playing().get("progress", 0)
            target = cur + _seconds(t) if t.startswith(("+", "forward")) else cur - _seconds(t) if t.startswith(("-", "back")) else _seconds(t)
            return spotify.seek(max(0, target))
        except spotify.SpotifyError as e:
            return str(e)
    if not _proc():
        return "Nothing is playing."
    t = str(to).strip().lower()
    cur = position()
    if t.startswith(("+", "forward")):
        target = cur + _seconds(t)
    elif t.startswith(("-", "back")):
        target = cur - _seconds(t)
    else:
        target = _seconds(t)
    if f1.song_length:
        target = min(target, max(0, f1.song_length - 3))
    _restart(target)
    return f"Jumped to {target // 60}:{target % 60:02d}."


def replay():
    if _restart(0):
        return f"Playing {f1.now_playing} from the start."
    last = (_read(HISTORY_FILE, []) or [{}])[-1].get("query")
    if last:
        return f1.music_control("play", last)
    return "Nothing to replay."


# ------------------------------------------------------------------ history & favorites
def add_history(title, query):
    h = _read(HISTORY_FILE, [])
    h.append({"title": title, "query": query, "at": datetime.now().strftime("%Y-%m-%d %H:%M")})
    _write(HISTORY_FILE, h[-1000:])


def top_songs(n=15):
    h = _read(HISTORY_FILE, [])
    return [t for t, _ in Counter(x["title"] for x in h).most_common(n)]


def favorite_current():
    if not f1.now_playing:
        return "Nothing is playing to add."
    favs = _read(FAV_FILE, [])
    if f1.now_playing not in favs:
        favs.append(f1.now_playing)
        _write(FAV_FILE, favs)
    try:                                         # also ♥ in Vermeil Music's Liked Songs
        import mymusic
        s = mymusic.current_song()
        if s:
            mymusic.like(s, True)
    except Exception as e:
        print(f"[music] {e}")
    return f"Added {f1.now_playing} to your favorites."


def play_favorites(shuffle=True):
    favs = _read(FAV_FILE, [])
    if not favs:
        return "You don't have favorites yet. Say 'add this to my favorites' while a song plays."
    import random
    if shuffle:
        random.shuffle(favs)
    for i, s in enumerate(favs):
        f1.music_control("play", s, "now" if i == 0 else "later")
    return f"Playing your {len(favs)} favorites."


def favorites_text():
    favs = _read(FAV_FILE, [])
    return "\n".join(f"- {x}" for x in favs) or "No favorites yet."


# ------------------------------------------------------------------ mood playlists & recommendations
def _suggest(prompt, n):
    import llm
    data = llm.ask(prompt + f'\nReply as JSON: {{"songs": ["Artist - Title", ...]}} with exactly {n} real, well-known songs.',
                   model="chat", json_mode=True)
    return [str(s).strip() for s in data.get("songs", []) if str(s).strip()][:n]


def taste():
    return {"favorites": _read(FAV_FILE, [])[-20:], "most_played": top_songs(15)}


def play_mood(mood, n=8):
    songs = _suggest(f"Make a playlist for this mood/activity: {mood}. The listener's taste: {json.dumps(taste(), ensure_ascii=False)}. "
                     f"Mix songs they'd like with ones that fit the mood. No song they already played most.", n)
    if not songs:
        return "I couldn't think of songs for that right now."
    for i, s in enumerate(songs):
        f1.music_control("play", s, "now" if i == 0 else "later")
    return f"Made a {mood} playlist: " + "; ".join(songs)


def recommend(n=6, play=False):
    t = taste()
    if not t["favorites"] and not t["most_played"]:
        return "Play some music first so I learn what you like."
    songs = _suggest(f"Recommend songs this person will probably love but hasn't played. Their taste: {json.dumps(t, ensure_ascii=False)}.", n)
    if play:
        for i, s in enumerate(songs):
            f1.music_control("play", s, "now" if i == 0 else "later")
        return "Playing my picks for you: " + "; ".join(songs)
    return "You might like:\n" + "\n".join(f"- {s}" for s in songs)


def find_song(description, play=True):
    """Identify a song from lyrics or a description, then (optionally) play it."""
    import llm
    hints = ""
    try:
        import web
        res = web.search(f"{description} song lyrics", n=5)
        hints = "\n".join(f"- {r['title']}: {r['snippet']}" for r in res)
    except Exception:
        pass
    data = llm.ask(f"Which song is this? The user said: \"{description}\".\nWeb results:\n{hints or '(none)'}\n"
                   f'Reply as JSON: {{"song": "Artist - Title", "sure": true/false}}', model="chat", json_mode=True)
    song = str(data.get("song", "")).strip()
    if not song:
        return "I couldn't work out which song that is."
    if play:
        f1.music_control("play", song)
        return f"I think it's {song}" + ("" if data.get("sure") else " (not 100% sure)") + " - playing it."
    return f"I think it's {song}" + ("." if data.get("sure") else " (not 100% sure).")
