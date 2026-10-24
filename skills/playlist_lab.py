"""
playlist_lab.py - Spotify panel -> "Playlist Lab": import a Spotify playlist, analyse it, then make a NEW playlist
based on it.

  1. import   - one of your playlists (by name) or ANY playlist link / spotify:playlist:… you paste
  2. analyse  - counted from the songs themselves: top artists, decades, explicit share, song length, artist variety;
                plus the AI's reading of the list: genres, moods, energy, tempo, vibe, similar artists
                (Spotify no longer gives new apps its "audio features" or "recommendations", so the AI does that part)
  3. make     - the AI picks new songs in the same style ("similar", "discover" = new artists, "mix" = both),
                each one is searched on Spotify, and a new playlist is created in your account
                (or, without Spotify, the songs can be queued in the YouTube player).
Analyses are kept in data/playlist_analyses.json so you can make more playlists from them later.
"""
import collections
import json
import os
import re
import time

import spotify
from paths import data_file

ANALYSES = data_file("playlist_analyses.json")
MAX_TRACKS = 300


# ------------------------------------------------------------------ 1. import
def playlist_id(ref):
    """link / URI / id / one of your playlist names -> playlist id"""
    ref = (ref or "").strip()
    m = re.search(r"playlist[/:]([A-Za-z0-9]{16,})", ref)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9]{22}", ref):
        return ref
    hit = spotify.find_playlist(ref)
    if not hit:
        raise spotify.SpotifyError(f"I couldn't find a playlist called '{ref}'. Paste its Spotify link instead "
                                   f"(Share -> Copy link to playlist).")
    return hit["id"]


def _get_items(pid):
    """the playlist's songs (Spotify renamed /tracks to /items in 2026 - both are tried)"""
    out, offset = [], 0
    path = f"/playlists/{pid}/items"
    while len(out) < MAX_TRACKS:
        try:
            data = spotify.call("GET", path, {"limit": 50, "offset": offset})
        except spotify.SpotifyError as e:
            if path.endswith("/items") and not out and ("404" in str(e) or "405" in str(e)):
                path = f"/playlists/{pid}/tracks"
                continue
            raise
        items = data.get("items", [])
        for x in items:
            t = (x or {}).get("track") or (x or {}).get("item")
            if t and t.get("type", "track") == "track" and t.get("name"):
                out.append(t)
        if not data.get("next") or not items:
            break
        offset += len(items)
    return out[:MAX_TRACKS]


def import_playlist(ref):
    pid = playlist_id(ref)
    try:
        meta = spotify.call("GET", f"/playlists/{pid}", {"fields": "name,owner(display_name),images,uri,description,external_urls"})
    except spotify.SpotifyError as e:
        if "404" in str(e):
            raise spotify.SpotifyError("Spotify won't share that playlist with apps (it's private, or one of Spotify's own "
                                       "editorial/algorithm playlists like Discover Weekly). Copy its songs into a playlist of yours first.")
        raise
    tracks = _get_items(pid)
    if not tracks:
        raise spotify.SpotifyError("That playlist is empty (or has only podcasts/local files).")
    songs = []
    for t in tracks:
        alb = t.get("album") or {}
        year = (alb.get("release_date") or "")[:4]
        songs.append({"title": t.get("name", ""), "artist": ", ".join(a.get("name", "") for a in t.get("artists", [])),
                      "artists": [a.get("name", "") for a in t.get("artists", [])], "album": alb.get("name", ""),
                      "year": int(year) if year.isdigit() else None, "uri": t.get("uri"), "explicit": bool(t.get("explicit")),
                      "duration": int(t.get("duration_ms") or 0) // 1000, "popularity": t.get("popularity")})
    return {"id": pid, "name": meta.get("name") or "Playlist", "owner": (meta.get("owner") or {}).get("display_name", ""),
            "image": ((meta.get("images") or [{}])[0] or {}).get("url", "") if meta.get("images") else "",
            "url": (meta.get("external_urls") or {}).get("spotify", ""), "songs": songs}


# ------------------------------------------------------------------ 2. analyse
def stats(songs):
    """numbers straight from the songs (no AI needed)"""
    n = len(songs)
    artists = collections.Counter(a for s in songs for a in s["artists"] if a)
    years = [s["year"] for s in songs if s["year"]]
    decades = collections.Counter(f"{y // 10 * 10}s" for y in years)
    pops = [s["popularity"] for s in songs if isinstance(s.get("popularity"), int)]
    dur = [s["duration"] for s in songs if s["duration"]]
    return {"songs": n, "artists": len(artists),
            "top_artists": [{"name": a, "songs": c} for a, c in artists.most_common(10)],
            "decades": [{"decade": d, "songs": c, "pct": round(100 * c / max(1, len(years)))} for d, c in sorted(decades.items())],
            "oldest": min(years) if years else None, "newest": max(years) if years else None,
            "median_year": sorted(years)[len(years) // 2] if years else None,
            "explicit_pct": round(100 * sum(s["explicit"] for s in songs) / max(1, n)),
            "avg_length": round(sum(dur) / len(dur)) if dur else 0,
            "total_minutes": round(sum(dur) / 60),
            "popularity": round(sum(pops) / len(pops)) if pops else None,
            "variety": round(100 * len(artists) / max(1, n))}           # % unique artists per song: high = many different artists


def _sample(songs, k=80):
    step = max(1, len(songs) // k)
    return [f"{s['title']} - {s['artist']}" + (f" ({s['year']})" if s["year"] else "") for s in songs[::step][:k]]


def ai_analysis(pl, st):
    import llm
    prompt = (f"Analyse this Spotify playlist like a music curator.\nNAME: {pl['name']}\nNUMBERS: {json.dumps(st)}\n"
              f"SONGS (sample):\n" + "\n".join(_sample(pl["songs"])) +
              '\n\nReturn JSON: {"genres": [{"name": "...", "pct": 40}] (3-6, adds to ~100), "moods": ["3-5 words"], '
              '"energy": 1-10, "tempo": "slow|mid|fast|mixed", "vibe": "<2 sentences in plain words>", '
              '"best_for": ["3-4 activities"], "similar_artists": ["8 artists NOT in the playlist"], '
              '"name_ideas": ["3 short names for a new playlist in this style"]}')
    try:
        d = llm.ask(prompt, model="smart", json_mode=True)
        return d if isinstance(d, dict) else {}
    except Exception as e:
        print(f"[playlist lab] {e}")
        return {"error": "The AI couldn't analyse it right now - the numbers below still work."}


def _load():
    try:
        with open(ANALYSES, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save(d):
    tmp = ANALYSES + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)
    os.replace(tmp, ANALYSES)


def analyse(ref):
    """import + analyse a playlist; the result is saved and returned"""
    pl = import_playlist(ref)
    st = stats(pl["songs"])
    ai = ai_analysis(pl, st)
    a = {"id": pl["id"], "name": pl["name"], "owner": pl["owner"], "image": pl["image"], "url": pl["url"],
         "stats": st, "ai": ai, "songs": pl["songs"], "analysed": time.strftime("%Y-%m-%d %H:%M")}
    d = _load()
    d[pl["id"]] = a
    if len(d) > 30:                                        # keep the newest 30
        for k in sorted(d, key=lambda k: d[k].get("analysed", ""))[:len(d) - 30]:
            d.pop(k)
    _save(d)
    return a


def analyses():
    return sorted(({"id": k, "name": v["name"], "image": v.get("image", ""), "songs": v["stats"]["songs"], "analysed": v.get("analysed", "")}
                   for k, v in _load().items()), key=lambda x: x["analysed"], reverse=True)


def get_analysis(pid):
    return _load().get(pid)


def text_summary(a):
    st, ai = a["stats"], a.get("ai") or {}
    g = ", ".join(f"{x.get('name')} {x.get('pct', '')}%" for x in ai.get("genres", [])[:4]) or "unknown genres"
    top = ", ".join(x["name"] for x in st["top_artists"][:4])
    era = f"mostly {max(st['decades'], key=lambda x: x['songs'])['decade']}" if st["decades"] else ""
    return (f"'{a['name']}': {st['songs']} songs, {st['total_minutes']} min. {g}. Top artists: {top}. {era}. "
            f"Energy {ai.get('energy', '?')}/10, {', '.join(ai.get('moods', [])[:3])}. {ai.get('vibe', '')}").strip()


# ------------------------------------------------------------------ 3. make a new playlist
STYLES = {"similar": "songs that sound like these, by the same artists AND similar artists (about half each)",
          "discover": "ONLY artists that are NOT in the playlist but fit its sound perfectly - help the user discover new music",
          "mix": "a mix: 30% favourites from the playlist's own artists, 70% new artists in the same style",
          "chill": "a calmer, softer version of this playlist's style",
          "hype": "a higher-energy, faster version of this playlist's style (good for the gym)"}


def suggest(a, size=25, style="similar", extra=""):
    """the AI's song picks (not yet checked on Spotify)"""
    import llm
    have = {f"{s['title']}|{s['artist']}".lower() for s in a["songs"]}
    ai = a.get("ai") or {}
    prompt = (f"Make a new playlist based on the playlist '{a['name']}'.\n"
              f"ITS STYLE: genres {json.dumps(ai.get('genres', []))}; moods {ai.get('moods', [])}; energy {ai.get('energy')}; "
              f"eras {json.dumps(a['stats']['decades'])}; top artists {[x['name'] for x in a['stats']['top_artists']]}; "
              f"similar artists {ai.get('similar_artists', [])}\nSOME OF ITS SONGS:\n" + "\n".join(_sample(a["songs"], 50)) +
              f"\n\nPick {int(size) + 8} REAL, existing songs: {STYLES.get(style, STYLES['similar'])}. "
              f"{('Also: ' + extra) if extra else ''}\nDon't repeat songs from the original playlist. Max 2 songs per artist. "
              'Return JSON: {"name": "<new playlist name>", "description": "<1 sentence>", "songs": [{"title": "...", "artist": "..."}]}')
    d = llm.ask(prompt, model="smart", json_mode=True, temperature=0.9)
    songs = []
    for s in (d or {}).get("songs", []):
        if isinstance(s, dict) and s.get("title") and s.get("artist") and f"{s['title']}|{s['artist']}".lower() not in have:
            songs.append({"title": str(s["title"])[:120], "artist": str(s["artist"])[:120]})
    return {"name": str((d or {}).get("name") or f"{a['name']} – Vermeil's mix")[:90],
            "description": str((d or {}).get("description") or "")[:250], "songs": songs}


def _find_on_spotify(title, artist):
    q = f'track:"{title}" artist:"{artist}"'
    try:
        tracks = spotify.search(q, "track", 3)["tracks"] or spotify.search(f"{title} {artist}", "track", 3)["tracks"]
    except spotify.SpotifyError:
        return None
    a0 = artist.lower().split(",")[0].strip()
    good = [t for t in tracks if a0 and a0 in t["artist"].lower()]
    return (good or tracks or [None])[0]


def _create(name, description, public=False):
    body = {"name": name, "description": description, "public": bool(public)}
    try:
        return spotify.call("POST", "/me/playlists", body=body)
    except spotify.SpotifyError as e:
        if "404" not in str(e) and "405" not in str(e):
            raise
        me = spotify.call("GET", "/me")
        return spotify.call("POST", f"/users/{me['id']}/playlists", body=body)


def _add(pid, uris):
    for i in range(0, len(uris), 100):
        chunk = uris[i:i + 100]
        try:
            spotify.call("POST", f"/playlists/{pid}/items", body={"uris": chunk})
        except spotify.SpotifyError as e:
            if "404" not in str(e) and "405" not in str(e):
                raise
            spotify.call("POST", f"/playlists/{pid}/tracks", body={"uris": chunk})


def make_playlist(pid, size=25, style="similar", name="", extra="", public=False, keep_original=0):
    """-> {'name', 'url', 'uri', 'added': [...], 'not_found': [...]}"""
    a = get_analysis(pid)
    if not a:
        return {"error": "Analyse the playlist first."}
    if not spotify.can_make_playlists():
        return {"error": "To create playlists Spotify needs one more permission: press Disconnect, then Connect again "
                         "in the Spotify panel (it only asks once).", "reconnect": True}
    size = max(5, min(100, int(size or 25)))
    pick = suggest(a, size, style, extra)
    added, missing, seen = [], [], set()
    for s in pick["songs"]:
        if len(added) >= size:
            break
        t = _find_on_spotify(s["title"], s["artist"])
        if not t or t["uri"] in seen:
            missing.append(f"{s['title']} - {s['artist']}")
            continue
        seen.add(t["uri"])
        added.append(t)
    if keep_original:                                        # optionally carry over some favourites from the original
        import random
        orig = [s for s in a["songs"] if s["uri"] and s["uri"] not in seen]
        for s in random.sample(orig, min(int(keep_original), len(orig))):
            added.insert(random.randrange(len(added) + 1), {"uri": s["uri"], "title": s["title"], "artist": s["artist"]})
    if not added:
        return {"error": "None of the picked songs were found on Spotify - try again or another style.", "not_found": missing}
    pl = _create(name.strip()[:90] or pick["name"], (pick["description"] + " · Made by Vermeil from " + a["name"]).strip(" ·"), public)
    _add(pl["id"], [t["uri"] for t in added])
    spotify._playlist_cache["at"] = 0                         # show it in Playlists right away
    return {"name": pl.get("name"), "url": (pl.get("external_urls") or {}).get("spotify", ""), "uri": pl.get("uri"), "id": pl.get("id"),
            "added": [{"title": t["title"], "artist": t["artist"], "uri": t["uri"]} for t in added], "not_found": missing,
            "message": f"Made '{pl.get('name')}' with {len(added)} songs in your Spotify."}


def queue_on_youtube(pid, size=20, style="similar"):
    """no Spotify needed: the picked songs go into the YouTube player's queue"""
    a = get_analysis(pid)
    if not a:
        return "Analyse the playlist first."
    import f1
    pick = suggest(a, size, style)
    songs = pick["songs"][:size]
    for i, s in enumerate(songs):
        f1.music_control("play", f"{s['title']} {s['artist']}", "now" if i == 0 else "later")
    return f"Playing '{pick['name']}' on YouTube: {len(songs)} songs queued."


# ------------------------------------------------------------------ for voice / chat
def voice(action, playlist="", style="similar", size=25):
    try:
        if action == "analyse":
            return text_summary(analyse(playlist))
        pid = playlist_id(playlist)
        if not get_analysis(pid):
            analyse(playlist)
        r = make_playlist(pid, size, style)
        return r.get("error") or r["message"] + (f" ({len(r['not_found'])} picks weren't on Spotify.)" if r["not_found"] else "")
    except spotify.SpotifyError as e:
        return str(e)
