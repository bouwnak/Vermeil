"""medialife.py - music and media extras: lyrics synced to the song (LRCLIB or lyrics.ovh, you choose), "play
something like this" (Vermeil Music or Spotify), an AI album cover for a playlist, "what song is this?" through the
mic (Shazam, needs shazamio) and a movie/show watchlist with where to watch and genre suggestions.
Saves to data/medialife.json. Every AI / web call takes ask= / fetch= so tests can fake it."""
import base64
import datetime
import io
import json
import os
import re
import uuid

from paths import data_file

FILE = data_file("medialife.json")
LYRICS_SOURCES = {"lrclib": "LRCLIB (synced to the song, free)", "lyricsovh": "lyrics.ovh (words only)"}
KINDS = ("movie", "show", "anime")
GENRES = ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Fantasy", "Horror", "Mystery",
          "Romance", "Sci-fi", "Thriller", "Slice of life", "Sports", "Musical", "K-drama", "Anime"]
_JUNK = re.compile(r"\s*[\(\[][^)\]]*(official|video|audio|lyrics?|visuali[sz]er|mv|hd|4k|remaster(ed)?|live|explicit)[^)\]]*[\)\]]", re.I)
_FEAT = re.compile(r"\s*[\(\[]?\s*(feat\.?|ft\.?|featuring)\s.*$", re.I)


def _load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        d = {}
    for k, v in (("lyrics", {}), ("watch", []), ("heard", []), ("suggest", {})):
        d.setdefault(k, v)
    return d


def _save(d):
    os.makedirs(os.path.dirname(FILE), exist_ok=True)
    tmp = FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, FILE)


def _ask_llm(prompt):
    import llm
    return llm.ask(prompt, model="smart", json_mode=True)


def _fetch(url, params=None):
    """GET -> parsed JSON, or None when the service doesn't have it (404)"""
    import requests
    r = requests.get(url, params=params, timeout=12, headers={"User-Agent": "Vermeil (https://github.com/bouwnak/Vermeil)"})
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def clean(title, artist=""):
    """'Easier (Official Video) ft. X' -> 'Easier'; 'Artist - Song' titles are split by the music player already"""
    t = _FEAT.sub("", _JUNK.sub("", str(title or ""))).strip(" -–")
    a = re.split(r"\s*(?:,|&| x | feat\.?| ft\.?)\s*", str(artist or ""), maxsplit=1)[0].strip()
    a = re.sub(r"\s*(-\s*topic|vevo|official)$", "", a, flags=re.I).strip()
    return t, a


# ------------------------------------------------------------------ lyrics
def parse_lrc(text):
    """'[01:02.50] line' -> [{"t": 62.5, "line": "line"}] sorted by time (a line can have several stamps)"""
    out = []
    for raw in str(text or "").splitlines():
        stamps = re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", raw)
        line = re.sub(r"\[[^\]]*\]", "", raw).strip()
        for m, s in stamps:
            out.append({"t": round(int(m) * 60 + float(s), 2), "line": line})
    return sorted(out, key=lambda x: x["t"])


def line_at(synced, pos):
    """index of the line being sung at pos seconds (-1 before the first line)"""
    i = -1
    for k, x in enumerate(synced or []):
        if x["t"] <= pos:
            i = k
        else:
            break
    return i


def lyrics(title, artist="", duration=0, source="lrclib", fetch=None):
    """-> {"synced": [...], "plain": "...", "source", "title", "artist"} or {"error"}"""
    if source not in LYRICS_SOURCES:
        source = "lrclib"
    t, a = clean(title, artist)
    if not t:
        return {"error": "Nothing is playing."}
    key = f"{source}|{_norm(t)}|{_norm(a)}"
    d = _load()
    if key in d["lyrics"]:
        return d["lyrics"][key]
    get = fetch or _fetch
    out = {"synced": [], "plain": "", "source": LYRICS_SOURCES[source], "title": t, "artist": a}
    try:
        if source == "lrclib":
            hit = None
            if a:
                p = {"track_name": t, "artist_name": a}
                if duration:
                    p["duration"] = int(duration)
                hit = get("https://lrclib.net/api/get", p)
            if not hit:
                found = get("https://lrclib.net/api/search", {"q": f"{t} {a}".strip()}) or []
                hit = next((x for x in found if x.get("syncedLyrics")), None) or (found[0] if found else None)
            if hit:
                out["synced"] = parse_lrc(hit.get("syncedLyrics"))
                out["plain"] = (hit.get("plainLyrics") or "").strip()
        else:
            if not a:
                return {"error": "lyrics.ovh needs the artist's name."}
            hit = get(f"https://api.lyrics.ovh/v1/{a}/{t}")
            out["plain"] = ((hit or {}).get("lyrics") or "").strip()
    except Exception as e:  # noqa: BLE001
        return {"error": f"The lyrics service didn't answer ({e.__class__.__name__}). Try again or pick the other one."}
    if not out["synced"] and not out["plain"]:
        return {"error": f"No lyrics found for {t}" + (f" by {a}" if a else "") + "."}
    d["lyrics"][key] = out
    for old in list(d["lyrics"])[:-200]:
        d["lyrics"].pop(old)
    _save(d)
    return out


# ------------------------------------------------------------------ play something like this
def similar_songs(title, artist="", n=12, ask=None):
    t, a = clean(title, artist)
    if not t:
        raise ValueError("Nothing is playing.")
    prompt = (f"Suggest {n} songs that sound like '{t}'" + (f" by {a}" if a else "") +
              " (similar mood, tempo and genre). Mix the same artist (at most 2) with similar artists. Real, well-known "
              "songs only, not this one. Reply as JSON: {\"songs\": [{\"title\": \"...\", \"artist\": \"...\"}]}")
    data = (ask or _ask_llm)(prompt) or {}
    seen, out = {_norm(t)}, []
    for s in data.get("songs") or []:
        if not isinstance(s, dict) or not s.get("title"):
            continue
        k = _norm(s["title"])
        if k in seen:
            continue
        seen.add(k)
        out.append({"title": str(s["title"])[:100], "artist": str(s.get("artist") or "")[:80]})
    if not out:
        raise ValueError("I couldn't think of similar songs right now. Try again in a moment.")
    return out[:n]


def like_this_youtube(song=None, n=12, ask=None, find=None, play=None):
    """the current song (or the one given) -> a queue of similar songs in Vermeil's player"""
    import mymusic
    song = song or mymusic.current_song()
    if not song:
        raise ValueError("Play a song first, then ask for more like it.")
    picks = similar_songs(song.get("title"), song.get("artist"), n, ask)
    found = [s for s in (find or mymusic.find_many)([(p["title"], p["artist"]) for p in picks]) if s]
    if not found:
        raise ValueError("I couldn't find those songs on YouTube.")
    msg = (play or mymusic.play_songs)(found)
    return {"message": f"Songs like {song.get('title')}: {msg}", "songs": found}


def like_this_spotify(n=12, ask=None, sp=None):
    import spotify as _sp
    sp = sp or _sp
    now = sp.now_playing()
    t = now.get("track") if now.get("active") else None
    if not t:
        raise ValueError("Nothing is playing on Spotify.")
    picks = similar_songs(t["title"], t["artist"], n, ask)
    uris, names = [], []
    for p in picks:
        hits = sp.search(f"track:{p['title']} artist:{p['artist']}" if p["artist"] else p["title"], "track", 1)["tracks"]
        if hits and hits[0]["uri"] not in uris:
            uris.append(hits[0]["uri"])
            names.append(f"{hits[0]['title']} — {hits[0]['artist']}")
    if not uris:
        raise ValueError("I couldn't find those songs on Spotify.")
    sp.play_uris(uris)
    return {"message": f"Playing {len(uris)} songs like {t['title']} on Spotify.", "songs": names}


# ------------------------------------------------------------------ album cover
COVER_STYLES = {"dreamy": "dreamy pastel, soft light", "neon": "neon city at night, synthwave", "anime": "anime illustration",
                "vinyl": "retro 70s vinyl record sleeve", "minimal": "minimal flat shapes, bold colours",
                "photo": "moody film photograph"}


def cover_prompt(name, songs, style="dreamy", ask=None):
    names = ", ".join(f"{s.get('title')} by {s.get('artist')}" for s in (songs or [])[:15])
    look = COVER_STYLES.get(style, style or COVER_STYLES["dreamy"])
    try:
        data = (ask or _ask_llm)(f"Write a short image prompt (max 40 words) for a square album cover for a playlist "
                                 f"called '{name}' with these songs: {names or 'various'}. Show the mood as a scene; no text, "
                                 "no letters, no real people. Reply as JSON: {\"prompt\": \"...\"}") or {}
        scene = str(data.get("prompt") or "").strip()
    except Exception:  # noqa: BLE001
        scene = ""
    return f"{scene or f'album cover art for a playlist called {name}'}, {look}, album cover, square, no text"


def make_cover(pid, style="dreamy", title=True, ask=None, paint=None, save=None):
    """paints a 640x640 cover, writes the playlist's name on it (title=True) and saves it as the playlist's cover"""
    import mymusic
    p = mymusic.get_playlist(pid)
    if pid == "liked":
        raise ValueError("Liked Songs keeps its heart cover.")
    if paint is None:
        import generator
        paint = lambda pr: generator.picture(pr, 640, 640)  # noqa: E731
    img = paint(cover_prompt(p["name"], p.get("songs"), style, ask))
    if title:
        _write_title(img, p["name"])
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=86)
    uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    return (save or mymusic.update_playlist)(pid, None, None, uri)


def _write_title(img, name):
    from PIL import ImageDraw, ImageFont
    W, H = img.size
    d = ImageDraw.Draw(img, "RGBA")
    try:
        import generator
        font = generator._font(max(28, W // 14), bold=True)
    except Exception:  # noqa: BLE001
        font = ImageFont.load_default()
    text = str(name)[:28]
    box = d.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.rectangle([0, H - h - 56, W, H], fill=(0, 0, 0, 120))
    d.text(((W - w) / 2, H - h - 32), text, font=font, fill=(255, 255, 255, 240))


# ------------------------------------------------------------------ what song is this?
def record(seconds=8, rate=44100):
    """the mic -> WAV bytes"""
    import wave
    import numpy as np
    import sounddevice as sd
    data = sd.rec(int(seconds * rate), samplerate=rate, channels=1, dtype="int16")
    sd.wait()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.asarray(data).tobytes())
    return buf.getvalue()


def _shazam(wav):
    try:
        from shazamio import Shazam
    except ImportError:
        raise RuntimeError("Song finder needs one package. In a terminal run:  python -m pip install shazamio")
    import asyncio
    return asyncio.run(Shazam().recognize(wav))


def identify(seconds=8, rec=None, recognize=None, now=None):
    """listen through the mic and name the song -> {title, artist, cover, link} or {error}"""
    try:
        wav = (rec or record)(seconds)
    except Exception as e:  # noqa: BLE001
        return {"error": f"I couldn't use the microphone ({e.__class__.__name__})."}
    try:
        r = (recognize or _shazam)(wav) or {}
    except RuntimeError as e:
        return {"error": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"error": f"The song finder didn't answer ({e.__class__.__name__}). Check the internet."}
    t = r.get("track") or {}
    if not t.get("title"):
        return {"error": "I couldn't tell which song that is. Hold the phone or speaker closer and try again."}
    hit = {"title": t["title"], "artist": t.get("subtitle", ""), "cover": (t.get("images") or {}).get("coverart", ""),
           "link": t.get("url", ""), "at": (now or datetime.datetime.now()).strftime("%Y-%m-%d %H:%M")}
    d = _load()
    d["heard"] = ([hit] + [x for x in d["heard"] if _norm(x["title"]) != _norm(hit["title"])])[:30]
    _save(d)
    return hit


def heard():
    return _load()["heard"]


# ------------------------------------------------------------------ watchlist
def _country():
    try:
        import productivity
        import gymlife
        city = productivity._state().get("home_city") or os.environ.get("HOME_CITY", "")
        return "the Philippines" if gymlife.country_for(city) == "PH" else "the United States"
    except Exception:  # noqa: BLE001
        return "the United States"


def _where(title, kind, year="", country=None, ask=None):
    country = country or _country()
    data = (ask or _ask_llm)(
        f"Where can someone in {country} watch the {kind} '{title}'" + (f" ({year})" if year else "") + " right now? "
        "List streaming services (Netflix, Prime Video, Disney+, Max, Apple TV+, Crunchyroll, Viu, YouTube, cinemas...) "
        "and say rent/buy if it isn't included. Also give its year and up to 3 genres. Reply as JSON: "
        "{\"year\": \"2019\", \"genres\": [\"...\"], \"where\": [\"Netflix\", \"Rent on Apple TV\"], \"about\": \"one line\"}") or {}
    return {"year": str(data.get("year") or year or "")[:4], "genres": [str(g)[:20] for g in (data.get("genres") or [])][:3],
            "where": [str(w)[:40] for w in (data.get("where") or [])][:6], "about": str(data.get("about") or "")[:160],
            "country": country, "checked": datetime.date.today().isoformat()}


def watch_list():
    d = _load()
    items = sorted(d["watch"], key=lambda x: (x.get("watched", False), x.get("added", "")), reverse=False)
    return {"items": items, "genres": GENRES, "kinds": list(KINDS)}


def watch_add(title, kind="movie", ask=None):
    title = str(title or "").strip()[:100]
    if not title:
        raise ValueError("Type a title.")
    kind = kind if kind in KINDS else "movie"
    d = _load()
    if any(_norm(x["title"]) == _norm(title) for x in d["watch"]):
        raise ValueError("It's already on your list.")
    item = {"id": uuid.uuid4().hex[:8], "title": title, "kind": kind, "added": datetime.date.today().isoformat(),
            "watched": False, "year": "", "genres": [], "where": [], "about": ""}
    try:
        item.update(_where(title, kind, ask=ask))
    except Exception as e:  # noqa: BLE001
        print(f"[watchlist] {e}")
    d["watch"].append(item)
    _save(d)
    return watch_list()


def _item(d, wid):
    it = next((x for x in d["watch"] if x["id"] == wid), None)
    if not it:
        raise KeyError("That one isn't on your list any more.")
    return it


def watch_where(wid, ask=None):
    d = _load()
    it = _item(d, wid)
    it.update(_where(it["title"], it["kind"], it.get("year", ""), ask=ask))
    _save(d)
    return watch_list()


def watch_toggle(wid, rating=None):
    d = _load()
    it = _item(d, wid)
    it["watched"] = not it.get("watched")
    if rating is not None:
        it["rating"] = max(0, min(5, int(rating)))
    _save(d)
    return watch_list()


def watch_remove(wid):
    d = _load()
    _item(d, wid)
    d["watch"] = [x for x in d["watch"] if x["id"] != wid]
    _save(d)
    return watch_list()


def watch_suggest(genres=(), kind="movie", n=6, ask=None):
    """picks in your genres, using what you watched and liked as taste; skips what's on your list"""
    genres = [g for g in genres or [] if g][:5]
    kind = kind if kind in KINDS else "movie"
    d = _load()
    have = {_norm(x["title"]) for x in d["watch"]}
    liked = [x["title"] for x in d["watch"] if x.get("watched") and x.get("rating", 4) >= 4][-10:]
    data = (ask or _ask_llm)(
        f"Suggest {n + 4} {kind}s" + (f" in these genres: {', '.join(genres)}" if genres else "") +
        (f". The person liked: {', '.join(liked)}" if liked else "") +
        f". Say where to watch each in {_country()}. Reply as JSON: {{\"picks\": [{{\"title\": \"...\", \"year\": \"...\", "
        "\"genres\": [\"...\"], \"why\": \"one short line\", \"where\": [\"Netflix\"]}]}") or {}
    out = []
    for p in data.get("picks") or []:
        if isinstance(p, dict) and p.get("title") and _norm(p["title"]) not in have:
            have.add(_norm(p["title"]))
            out.append({"title": str(p["title"])[:100], "year": str(p.get("year") or "")[:4], "kind": kind,
                        "genres": [str(g)[:20] for g in (p.get("genres") or [])][:3], "why": str(p.get("why") or "")[:140],
                        "where": [str(w)[:40] for w in (p.get("where") or [])][:4]})
    if not out:
        raise ValueError("I couldn't think of new picks right now. Try other genres.")
    return {"picks": out[:n]}
