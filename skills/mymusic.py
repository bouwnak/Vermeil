"""
mymusic.py - "Vermeil Music": your own Spotify-style music app inside Vermeil. No Spotify account: songs come from
YouTube and play in the built-in player (f1: yt-dlp + ffplay).

  search            YouTube search -> songs (title, artist, length, cover)
  playlists         make, rename, delete, add/remove/move songs, play (in order or shuffled)
  liked songs       ♥ any song, or the one playing now
  recently played   from the player's history
  import            a YouTube / YouTube Music playlist link, or a pasted list ("Artist - Title" per line)
  Playlist Lab      analyse one of your playlists (genres, moods, energy, eras, top artists) and make a NEW
                    playlist in its style - the AI picks the songs, each one is found on YouTube
Everything is saved in data/my_music.json.
"""
import collections
import json
import os
import random
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import f1
from paths import data_file

LIB_FILE = data_file("my_music.json")
COLORS = ["#1db954", "#e8115b", "#7358ff", "#f59b23", "#27856a", "#1e3264", "#e13300", "#8d67ab", "#477d95", "#ba5d07"]
_JUNK = re.compile(r"\s*[\(\[][^)\]]*(official|video|audio|lyrics?|lyric video|visualizer|mv|hd|4k|remaster(ed)?|live)[^)\]]*[\)\]]", re.I)


# ------------------------------------------------------------------ storage
def _load():
    try:
        with open(LIB_FILE, encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict):
            d.setdefault("playlists", []); d.setdefault("liked", []); d.setdefault("analyses", {})
            return d
    except (OSError, json.JSONDecodeError):
        pass
    return {"playlists": [], "liked": [], "analyses": {}}


def _save(d):
    tmp = LIB_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, LIB_FILE)


def _key(s):
    return (s.get("yt") or f"{s.get('artist', '')}|{s.get('title', '')}").lower()


def song(title, artist="", yt=None, duration=0, thumb=""):
    return {"title": str(title or "").strip()[:150], "artist": str(artist or "").strip()[:120], "yt": yt or None,
            "duration": int(duration or 0), "thumb": thumb or (f"https://i.ytimg.com/vi/{yt}/hqdefault.jpg" if yt else "")}


def play_query(s):
    """what the player is given: the exact YouTube video when known, else a search"""
    return f"https://www.youtube.com/watch?v={s['yt']}" if s.get("yt") else f"{s.get('artist', '')} - {s.get('title', '')}".strip(" -")


def split_title(video_title, channel=""):
    """'Eminem - Lose Yourself (Official Video)' -> ('Lose Yourself', 'Eminem')"""
    t = _JUNK.sub("", video_title or "").strip()
    t = re.sub(r"\s*\|.*$", "", t)
    m = re.match(r"^(.+?)\s+[-–—]\s+(.+)$", t)
    if m:
        return m.group(2).strip(' "'), m.group(1).strip()
    ch = re.sub(r"\s*(- Topic|VEVO|Official)$", "", channel or "", flags=re.I).strip()
    return t, ch


# ------------------------------------------------------------------ YouTube
def _ydl(flat=True):
    import yt_dlp
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": "in_playlist" if flat else False}
    if os.path.exists(f1.COOKIES_FILE):
        opts["cookiefile"] = f1.COOKIES_FILE
    return yt_dlp.YoutubeDL(opts)


def _from_entry(e):
    if not e or not e.get("id"):
        return None
    title, artist = split_title(e.get("title", ""), e.get("channel") or e.get("uploader") or "")
    thumbs = e.get("thumbnails") or []
    return song(title, artist, e["id"], e.get("duration"), thumbs[-1]["url"] if thumbs else "")


def _secs(text):
    try:
        n = 0
        for part in str(text).split(":"):
            n = n * 60 + int(part)
        return n
    except ValueError:
        return 0


def _walk(o, key):
    """every value stored under `key` anywhere inside YouTube's page data"""
    if isinstance(o, dict):
        for k, v in o.items():
            if k == key:
                yield v
            else:
                yield from _walk(v, key)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v, key)


def _fast_search(q, n):
    """YouTube's own search page (well under a second; yt-dlp's search can take 30 s)"""
    import requests
    r = requests.get("https://www.youtube.com/results", params={"search_query": q, "sp": "EgIQAQ%3D%3D"}, timeout=10,
                     headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36",
                              "Accept-Language": "en-US,en;q=0.9"})
    m = re.search(r"var ytInitialData\s*=\s*(\{.*?\});\s*</script>", r.text, re.S)
    if not m:
        return None
    out = []
    for v in _walk(json.loads(m.group(1)), "videoRenderer"):
        vid = v.get("videoId")
        title = "".join(x.get("text", "") for x in (v.get("title") or {}).get("runs", []))
        if not vid or not title:
            continue
        ch = "".join(x.get("text", "") for x in (v.get("ownerText") or v.get("longBylineText") or {}).get("runs", []))
        t, a = split_title(title, ch)
        out.append(song(t, a, vid, _secs((v.get("lengthText") or {}).get("simpleText", "")), f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"))
        if len(out) >= n:
            break
    return out


def search(query, n=12):
    q = (query or "").strip()
    if not q:
        return []
    n = max(1, min(25, n))
    out = None
    try:
        out = _fast_search(q, n + 4)
    except Exception as e:
        print(f"[music search] {e} - using yt-dlp")
    if not out:
        with _ydl() as y:
            info = y.extract_info(f"ytsearch{n}:{q}", download=False)
        out = [s for s in (_from_entry(e) for e in info.get("entries", [])) if s]
    songs = [s for s in out if not s["duration"] or 60 <= s["duration"] <= 900]       # skip shorts and 1-hour mixes
    return (songs or out)[:n]


def find_one(title, artist=""):
    try:
        r = search(f"{artist} {title}".strip(), 3)
    except Exception as e:
        print(f"[music] {e}")
        return None
    a = (artist or "").lower().split(",")[0].strip()
    good = [s for s in r if a and (a in s["artist"].lower() or a in s["title"].lower())]
    hit = (good or r or [None])[0]
    if hit:                                         # keep the clean names the AI/user gave
        hit = {**hit, "title": title or hit["title"], "artist": artist or hit["artist"]}
    return hit


def find_many(pairs, workers=6):
    """[(title, artist)] -> [song or None], several searches at once"""
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(lambda p: find_one(*p), pairs))


# ------------------------------------------------------------------ playlists
def _pl(d, pid):
    p = next((x for x in d["playlists"] if x["id"] == pid), None)
    if not p:
        raise KeyError("That playlist doesn't exist any more.")
    return p


def _public(p, full=False):
    out = {k: p[k] for k in ("id", "name", "description", "color", "created")}
    out["count"] = len(p["songs"])
    out["minutes"] = round(sum(s.get("duration") or 0 for s in p["songs"]) / 60)
    out["covers"] = [s["thumb"] for s in p["songs"] if s.get("thumb")][:4]
    if full:
        out["songs"] = p["songs"]
    return out


def library():
    d = _load()
    return {"playlists": [_public(p) for p in d["playlists"]], "liked": len(d["liked"])}


def get_playlist(pid):
    d = _load()
    if pid == "liked":
        return {"id": "liked", "name": "Liked Songs", "description": "Songs you ♥", "color": "#5038a0", "created": "",
                "count": len(d["liked"]), "minutes": round(sum(s.get("duration") or 0 for s in d["liked"]) / 60),
                "covers": [], "songs": d["liked"]}
    return _public(_pl(d, pid), full=True)


def create_playlist(name, description="", songs=None):
    d = _load()
    p = {"id": uuid.uuid4().hex[:10], "name": (name or "My playlist").strip()[:80], "description": (description or "")[:300],
         "color": random.choice(COLORS), "created": time.strftime("%Y-%m-%d"), "songs": []}
    seen = set()
    for s in songs or []:
        if s and _key(s) not in seen:
            seen.add(_key(s)); p["songs"].append(s)
    d["playlists"].insert(0, p)
    _save(d)
    return _public(p, full=True)


def update_playlist(pid, name=None, description=None):
    d = _load()
    p = _pl(d, pid)
    if name is not None and name.strip():
        p["name"] = name.strip()[:80]
    if description is not None:
        p["description"] = description[:300]
    _save(d)
    return _public(p, full=True)


def delete_playlist(pid):
    d = _load()
    d["playlists"] = [p for p in d["playlists"] if p["id"] != pid]
    d["analyses"].pop(pid, None)
    _save(d)
    return library()


def add_songs(pid, songs):
    d = _load()
    p = d["liked"] if pid == "liked" else _pl(d, pid)["songs"]
    have = {_key(s) for s in p}
    n = 0
    for s in songs:
        if s and _key(s) not in have:
            have.add(_key(s)); p.append(s); n += 1
    _save(d)
    return n


def remove_song(pid, index):
    d = _load()
    p = d["liked"] if pid == "liked" else _pl(d, pid)["songs"]
    if 0 <= int(index) < len(p):
        p.pop(int(index))
    _save(d)
    return get_playlist(pid)


def move_song(pid, index, to):
    d = _load()
    p = d["liked"] if pid == "liked" else _pl(d, pid)["songs"]
    i, j = int(index), int(to)
    if 0 <= i < len(p) and 0 <= j < len(p):
        p.insert(j, p.pop(i))
    _save(d)
    return get_playlist(pid)


def like(s, on=True):
    d = _load()
    k = _key(s)
    d["liked"] = [x for x in d["liked"] if _key(x) != k]
    if on:
        d["liked"].insert(0, s)
    _save(d)
    return on


def is_liked(s):
    k = _key(s or {})
    return any(_key(x) == k for x in _load()["liked"])


def current_song():
    i = f1.now_info or {}
    if not i.get("title"):
        return None
    title, artist = split_title(i["title"], i.get("channel", ""))
    return song(title, artist, i.get("id"), i.get("duration"), i.get("thumb"))


def like_current():
    s = current_song()
    if not s:
        return "Nothing is playing to like."
    like(s, True)
    return f"♥ Saved {s['title']} to your Liked Songs."


# ------------------------------------------------------------------ playing
def play_songs(songs, start=0, shuffle=False):
    songs = [s for s in songs if s]
    if not songs:
        return "That playlist is empty."
    order = songs[start:] + songs[:start]
    if shuffle:
        first, rest = order[0] if start else None, order[1:] if start else order[:]
        random.shuffle(rest)
        order = ([first] if first else []) + rest
    f1.music_control("stop")
    for i, s in enumerate(order):
        f1.music_control("play", play_query(s), "now" if i == 0 else "later")
    return f"Playing {order[0]['title']}" + (f" + {len(order) - 1} more" if len(order) > 1 else "") + "."


def play_playlist(pid, start=0, shuffle=False):
    p = get_playlist(pid)
    return play_songs(p["songs"], start, shuffle).replace("Playing", f"Playing {p['name']}:", 1)


def find_playlist(name):
    import difflib
    d = _load()
    want = re.sub(r"\b(my|the|playlist|please|songs?)\b", " ", (name or "").lower()).strip()
    if re.fullmatch(r"liked|likes|favou?rites?|liked songs", want or ""):
        return {"id": "liked", "name": "Liked Songs"}
    names = {p["name"].lower(): p for p in d["playlists"]}
    if want in names:
        return names[want]
    hit = next((p for n, p in names.items() if want and (n.startswith(want) or want in n)), None)
    if hit:
        return hit
    close = difflib.get_close_matches(want, list(names), n=1, cutoff=0.6)
    return names[close[0]] if close else None


def play_by_name(name, shuffle=False):
    p = find_playlist(name)
    if not p:
        d = _load()
        return f"You don't have a playlist called '{name}'." + (f" You have: {', '.join(x['name'] for x in d['playlists'][:12])}." if d["playlists"] else
                                                                 " Make one in the Music panel.")
    return play_playlist(p["id"], shuffle=shuffle)


def now():
    import music
    i = f1.now_info or {}
    s = current_song()
    return {"playing": bool(f1.is_playing), "paused": bool(f1.paused_at), "song": s, "liked": is_liked(s) if s else False,
            "position": music.position() if f1.is_playing else 0, "length": int(f1.song_length or i.get("duration") or 0),
            "queue": [_queue_label(q) for q in list(f1.music_queue.queue) if q][:30]}


def _queue_label(q):
    m = re.search(r"watch\?v=([\w-]{11})", q)
    if m:
        for s in _all_known():
            if s.get("yt") == m.group(1):
                return f"{s['title']} — {s['artist']}"
        return "YouTube video " + m.group(1)
    return q


def _all_known():
    d = _load()
    for p in d["playlists"]:
        yield from p["songs"]
    yield from d["liked"]


def recent(n=30):
    import music
    h = music._read(music.HISTORY_FILE, [])
    out, seen = [], set()
    for x in reversed(h):
        title, artist = split_title(x.get("title", ""))
        k = (title + artist).lower()
        if k in seen:
            continue
        seen.add(k)
        m = re.search(r"watch\?v=([\w-]{11})", x.get("query", ""))
        out.append({**song(title, artist, m.group(1) if m else None), "played": x.get("at", "")})
        if len(out) >= n:
            break
    return out


# ------------------------------------------------------------------ import
def import_youtube(url, name=None):
    """a YouTube / YouTube Music playlist link -> a new playlist"""
    if not re.search(r"(youtube\.com|youtu\.be|music\.youtube)", url or ""):
        raise ValueError("Paste a YouTube or YouTube Music playlist link (Share -> Copy link).")
    with _ydl() as y:
        info = y.extract_info(url, download=False)
    entries = info.get("entries") or ([info] if info.get("id") else [])
    songs = [s for s in (_from_entry(e) for e in entries) if s and s["title"] not in ("[Private video]", "[Deleted video]")]
    if not songs:
        raise ValueError("That playlist is empty or private.")
    return create_playlist(name or info.get("title") or "Imported playlist", f"Imported from YouTube · {len(songs)} songs", songs)


def import_text(text, name="Imported list"):
    """pasted lines like 'Eminem - Lose Yourself' (or 'Lose Yourself by Eminem') -> found on YouTube -> a new playlist"""
    pairs = []
    for line in (text or "").splitlines():
        line = re.sub(r"^\s*\d+[.)]\s*", "", line).strip()
        if not line:
            continue
        m = re.match(r"^(.+?)\s+[-–—]\s+(.+)$", line) or None
        if m:
            pairs.append((m.group(2).strip(), m.group(1).strip()))
        else:
            m = re.match(r"^(.+?)\s+by\s+(.+)$", line, re.I)
            pairs.append((m.group(1), m.group(2)) if m else (line, ""))
    if not pairs:
        raise ValueError("Paste one song per line, like: Eminem - Lose Yourself")
    found = find_many(pairs[:150])
    songs = [s for s in found if s]
    return {**create_playlist(name, f"Imported list · {len(songs)} songs", songs), "not_found": [f"{t} - {a}" for (t, a), s in zip(pairs, found) if not s]}


def spotify_playlists():
    """your Spotify playlists (+ Liked Songs) for the Import tab. Needs Spotify connected (Music -> Spotify)."""
    import spotify
    if not spotify.status().get("connected"):
        return {"connected": False, "playlists": []}
    lists = spotify.playlists(fresh=True)
    return {"connected": True, "playlists": [{"id": "liked", "name": "Liked Songs", "count": None, "image": ""}] +
            [{"id": p["id"], "name": p["name"], "count": p.get("count"), "image": p.get("image", ""), "owner": p.get("owner", "")} for p in lists]}


def import_spotify(pid, name=None):
    """a Spotify playlist (or your Liked Songs) -> a Vermeil Music playlist: every song is found on YouTube so it plays
    here, with Spotify's cover art kept where YouTube has none"""
    import spotify
    import playlist_lab
    if pid == "liked":
        tracks = spotify.liked_songs(50)
        title = name or "Liked Songs (Spotify)"
        pairs = [(t["title"], t["artist"]) for t in tracks if t]
        covers = [t.get("small_image") or t.get("image") for t in tracks if t]
    else:
        pl = playlist_lab.import_playlist(pid)
        title = name or pl["name"]
        pairs = [(s["title"], s["artist"].split(",")[0]) for s in pl["songs"]]
        covers = [""] * len(pairs)
    if not pairs:
        raise ValueError("That Spotify playlist is empty.")
    found = find_many(pairs[:150])
    songs = []
    for s, cover in zip(found, covers):
        if s:
            if not s.get("thumb") and cover: s["thumb"] = cover
            songs.append(s)
    out = create_playlist(title, f"Imported from Spotify · {len(songs)} songs", songs)
    return {**out, "not_found": [f"{a} - {t}" for (t, a), s in zip(pairs, found) if not s]}


# ------------------------------------------------------------------ Playlist Lab
def stats(songs):
    n = len(songs)
    artists = collections.Counter(a.strip() for s in songs for a in re.split(r",|&| feat\.? | ft\.? | x ", s.get("artist") or "") if a.strip())
    dur = [s["duration"] for s in songs if s.get("duration")]
    return {"songs": n, "artists": len(artists), "top_artists": [{"name": a, "songs": c} for a, c in artists.most_common(10)],
            "total_minutes": round(sum(dur) / 60), "avg_length": round(sum(dur) / len(dur)) if dur else 0,
            "variety": round(100 * len(artists) / max(1, n))}


def _sample(songs, k=80):
    step = max(1, len(songs) // k)
    return [f"{s['title']} - {s['artist']}" for s in songs[::step][:k]]


def analyse(pid):
    p = get_playlist(pid)
    if not p["songs"]:
        raise ValueError("Add some songs to the playlist first.")
    st = stats(p["songs"])
    import llm
    try:
        ai = llm.ask(f"Analyse this playlist like a music curator.\nNAME: {p['name']}\nNUMBERS: {json.dumps(st)}\nSONGS:\n" +
                     "\n".join(_sample(p["songs"])) +
                     '\n\nReturn JSON: {"genres": [{"name": "...", "pct": 40}] (3-6, ~100 total), "eras": [{"decade": "2010s", "pct": 50}], '
                     '"moods": ["3-5 words"], "energy": 1-10, "tempo": "slow|mid|fast|mixed", "vibe": "<2 plain sentences>", '
                     '"best_for": ["3-4 activities"], "similar_artists": ["8 artists NOT in it"], "name_ideas": ["3 short names"]}',
                     model="smart", json_mode=True)
        ai = ai if isinstance(ai, dict) else {}
    except Exception as e:
        print(f"[music lab] {e}")
        ai = {"error": "The AI couldn't analyse it right now - the numbers still work."}
    a = {"id": pid, "name": p["name"], "stats": st, "ai": ai, "analysed": time.strftime("%Y-%m-%d %H:%M")}
    d = _load()
    d["analyses"][pid] = a
    _save(d)
    return a


STYLES = {"similar": "songs that sound like these, by the same artists AND similar artists (about half each)",
          "discover": "ONLY artists that are NOT in the playlist but fit its sound perfectly",
          "mix": "30% songs by the playlist's own artists, 70% new artists in the same style",
          "chill": "a calmer, softer version of this style", "hype": "a higher-energy, faster version of this style (gym)"}


def make_from(pid, size=25, style="similar", name="", extra=""):
    """the AI picks songs in the playlist's style, each is found on YouTube, saved as a new playlist"""
    import llm
    d = _load()
    a = d["analyses"].get(pid) or analyse(pid)
    src = get_playlist(pid)
    size = max(5, min(60, int(size or 25)))
    ai = a.get("ai") or {}
    pick = llm.ask(f"Make a new playlist based on '{src['name']}'.\nITS STYLE: genres {json.dumps(ai.get('genres', []))}; "
                   f"moods {ai.get('moods', [])}; energy {ai.get('energy')}; eras {json.dumps(ai.get('eras', []))}; "
                   f"top artists {[x['name'] for x in a['stats']['top_artists']]}; similar artists {ai.get('similar_artists', [])}\n"
                   "SOME OF ITS SONGS:\n" + "\n".join(_sample(src["songs"], 50)) +
                   f"\n\nPick {size + 6} REAL, existing songs: {STYLES.get(style, STYLES['similar'])}. {('Also: ' + extra) if extra else ''}\n"
                   "Don't repeat its songs. Max 2 songs per artist. "
                   'Return JSON: {"name": "<new playlist name>", "description": "<1 sentence>", "songs": [{"title": "...", "artist": "..."}]}',
                   model="smart", json_mode=True, temperature=0.9) or {}
    have = {(s["title"] + "|" + s["artist"]).lower() for s in src["songs"]}
    pairs = [(str(s["title"]), str(s["artist"])) for s in pick.get("songs", [])
             if isinstance(s, dict) and s.get("title") and s.get("artist") and f"{s['title']}|{s['artist']}".lower() not in have]
    found = find_many(pairs[:size + 6])
    songs, seen = [], set()
    for s in found:
        if s and _key(s) not in seen and len(songs) < size:
            seen.add(_key(s)); songs.append(s)
    if not songs:
        return {"error": "Couldn't find the picked songs on YouTube - check the internet and try again."}
    p = create_playlist(name.strip() or pick.get("name") or f"{src['name']} – Vermeil's mix",
                        (str(pick.get("description") or "") + f" · Made by Vermeil from {src['name']}").strip(" ·"), songs)
    return {**p, "not_found": [f"{t} - {a_}" for (t, a_), s in zip(pairs, found) if not s][:20],
            "message": f"Made '{p['name']}' with {len(songs)} songs."}


def analysis(pid):
    return _load()["analyses"].get(pid)


# ------------------------------------------------------------------ voice / chat
def voice(action, playlist="", style="similar", size=25, song_name=""):
    try:
        if action == "play":
            return play_by_name(playlist)
        if action == "shuffle":
            return play_by_name(playlist, shuffle=True)
        if action == "like":
            return like_current()
        if action == "add_current":
            p = find_playlist(playlist)
            s = current_song()
            if not p or not s:
                return "Nothing is playing." if not s else f"You don't have a playlist called '{playlist}'."
            add_songs(p["id"], [s])
            return f"Added {s['title']} to {p['name']}."
        if action == "create":
            return f"Made the playlist '{create_playlist(playlist)['name']}'."
        if action == "list":
            lib = library()
            return "Your playlists: " + (", ".join(f"{p['name']} ({p['count']})" for p in lib["playlists"]) or "none yet") + f". Liked songs: {lib['liked']}."
        p = find_playlist(playlist)
        if not p:
            return f"You don't have a playlist called '{playlist}'."
        if action == "analyse":
            a = analyse(p["id"])
            ai = a["ai"]
            return (f"{p['name']}: {a['stats']['songs']} songs, {', '.join(g.get('name', '') for g in ai.get('genres', [])[:3])}, energy "
                    f"{ai.get('energy', '?')}/10, {', '.join(ai.get('moods', [])[:3])}. {ai.get('vibe', '')}")
        if action == "make":
            r = make_from(p["id"], size, style)
            return r.get("error") or r["message"] + " It's in the Music panel."
        return "Unknown music action."
    except (KeyError, ValueError) as e:
        return str(e).strip("'")
