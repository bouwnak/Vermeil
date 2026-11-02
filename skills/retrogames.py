"""
retrogames.py - the "Retro Games" list of the Games hub: classic console games from www.romsgames.net.

How it works (beginner version):
- list_games() reads a page of the website (a console like SNES, or a search) and pulls out each game's name, picture
  and console - so the app can show them in its own style.
- Pressing Play is skills/retroplay.py: it downloads the game and opens it in the emulator.
- Pages are remembered for a few hours in data/retrogames_cache.json, so the hub opens fast and still works
  (with the last list) when the site is slow.
- Here too: which games are on this PC, your Recent / Favorites lists and the saves made on the phone.
"""
import base64
import hashlib
import html
import json
import os
import re
import shutil
import time
from urllib.parse import quote_plus, urlparse

import requests

from paths import data_file

SITE = "https://www.romsgames.net"
CACHE_FILE = data_file("retrogames_cache.json")
CACHE_HOURS = 6
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}

# the consoles the emulator can run: group -> [(the website's name for it, the name shown)]
PLATFORMS = {
    "Nintendo": [("nintendo", "NES"), ("super-nintendo", "SNES"), ("nintendo-64", "N64"), ("gameboy", "Game Boy"), ("gameboy-color", "Game Boy Color"),
                 ("gameboy-advance", "Game Boy Advance"), ("nintendo-ds", "Nintendo DS"), ("gamecube", "GameCube"), ("nintendo-wii", "Wii")],
    # Master System, Game Gear and 32X aren't here: every game tried on the site gave a "404 Not Found" page (14 of 14 each, Nov 2026)
    "Sega": [("sega-genesis", "Genesis"), ("dreamcast", "Dreamcast")],
    "PlayStation": [("playstation", "PlayStation"), ("playstation-2", "PlayStation 2"), ("playstation-portable", "PSP")],
    "Other": [("turbografx-16", "TurboGrafx-16"), ("atari-2600", "Atari 2600"), ("mame-037b11", "Arcade")],
}
PLATFORM_IDS = {p for group in PLATFORMS.values() for p, _ in group}
PLATFORM_NAMES = {p: name for group in PLATFORMS.values() for p, name in group}
# the site's home page has no game list, so "Most Popular" is the top of these
POPULAR = ("gameboy-advance", "super-nintendo", "nintendo-ds", "nintendo-64", "playstation", "sega-genesis")


# ---------------- reading the website ----------------
def _load_cache():
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cache(cache):
    try:
        keep = dict(sorted(cache.items(), key=lambda kv: kv[1].get("t", 0))[-200:])     # the 200 newest pages
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(keep, f)
    except Exception as e:
        print(f"[retro games] couldn't save the cache: {e}")


def _get(url, fresh=False):
    """the page's HTML (from the cache when it's recent; the old copy when the site can't be reached)"""
    cache = _load_cache()
    hit = cache.get(url)
    if hit and not fresh and time.time() - hit.get("t", 0) < CACHE_HOURS * 3600:
        return hit["html"]
    try:
        r = requests.get(url, headers=UA, timeout=15)
        r.raise_for_status()
    except Exception:
        if hit:
            return hit["html"]
        raise
    cache[url] = {"t": time.time(), "html": r.text}
    _save_cache(cache)
    return r.text


def platform_of(url):
    """the console in a game's address: /gameboy-advance-rom-sonic/ -> gameboy-advance"""
    m = re.fullmatch(r"/([a-z0-9\-]+?)-rom-[^/]+/?", urlparse(url or "").path)
    return m.group(1) if m else ""


def parse_cards(page):
    """every game card on a page -> [{title, url, image, platform, likes}]. Consoles the emulator can't run are left out."""
    out, seen = [], set()
    for path, image, title in re.findall(r'<a href="(/[a-z0-9\-]+-rom-[^"]+/)"[^>]*>\s*<img src="([^"]+)"[^>]*alt="([^"]*)"', page):
        plat = platform_of(path)
        if path in seen or plat not in PLATFORM_IDS:
            continue
        seen.add(path)
        out.append({"title": html.unescape(title).strip() or "Game", "url": SITE + path, "image": image, "platform": PLATFORM_NAMES[plat], "likes": 0})
    return out


# only English games are shown: (USA), (Europe), (World), (En,...), [En by ...] - or a name with no country at all
ENGLISH = {"usa", "us", "u", "europe", "eu", "e", "ue", "eur", "world", "w", "en", "english", "uk", "australia", "canada"}
FOREIGN = {"japan", "jp", "j", "korea", "kr", "k", "france", "fr", "f", "germany", "de", "g", "spain", "es", "s",
           "italy", "it", "i", "netherlands", "nl", "sweden", "sv", "brazil", "br", "b", "china", "ch", "c", "taiwan",
           "asia", "hong", "russia", "ru", "portugal", "pt", "denmark", "da", "norway", "no", "finland", "fi"}


def is_english(title):
    """the words inside the name's (...) and [...] decide: "(Japan 990927, NO CD)" is Japanese, "(980123 USA)" is English"""
    words = []
    for tag in re.findall(r"[(\[]([^)\]]*)[)\]]", title or ""):
        ws = [w for w in re.split(r"[\s,/\-]+", tag.lower()) if w]
        codes = all(len(w) <= 3 for w in ws)          # "(J)", "(Fr,De)": short codes. "(Beta, no intro)": just words
        words += [w for w in ws if codes or len(w) > 3 or w in ("en", "usa")]
    if any(w in ENGLISH for w in words):
        return True
    return not any(w in FOREIGN for w in words)


def page_url(platform="", page=1, query=""):
    if query:
        return f"{SITE}/search/?q={quote_plus(query.strip())}"
    if platform not in PLATFORM_IDS:
        raise ValueError(f"unknown console {platform}")
    return f"{SITE}/roms/{platform}/" if page <= 1 else f"{SITE}/roms/{platform}/?page={int(page)}"


def _popular(fresh=False):
    """the most popular games of the big consoles, taking turns"""
    lists, last = [], None
    for plat in POPULAR:
        try:
            lists.append(parse_cards(_get(page_url(plat), fresh)))
        except Exception as e:
            last = e
    if not any(lists):
        raise last or RuntimeError("no games")
    return [g for row in zip(*[l[:8] for l in lists if l]) for g in row]


def list_games(platform="", page=1, query="", fresh=False):
    """{games: [...], platforms, platform, page, query, more} - or {error} when the site can't be reached"""
    page = max(1, int(page or 1))
    try:
        if not platform and not query:
            games, text = _popular(fresh), ""
        else:
            text = _get(page_url(platform, page, query), fresh)
            games = parse_cards(text)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Couldn't reach the games site ({type(e).__name__}). Check your internet and try again."}
    more = bool(platform and not query and re.search(rf'/roms/{re.escape(platform)}/\?page={page + 1}\b', text))
    return {"games": [g for g in games if is_english(g["title"])], "platforms": PLATFORMS, "platform": platform, "page": page, "query": query, "more": more}


def is_game_url(url):
    u = urlparse(url or "")
    return u.scheme == "https" and u.netloc in ("www.romsgames.net", "romsgames.net") and platform_of(url) in PLATFORM_IDS


def game_id(url):
    """a game's folder name on this PC: a number made from its address"""
    return str(int(hashlib.md5(urlparse(url).path.encode("utf-8")).hexdigest()[:12], 16))


# ---------------- the games on this PC (ui/games/roms/<game id>/) ----------------
ROM_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui", "games", "roms")
SAVE_DIR = data_file("retro_saves")
LIBRARY_FILE = data_file("retro_library.json")
ROM_CACHE_MB = 3000          # the downloaded games folder is kept under ~3 GB (the oldest-played go first)
downloading = set()          # game ids skills/retroplay.py is getting right now


def trim_cache(keep):
    """the downloaded games (one folder each) stay under ROM_CACHE_MB: the longest-unplayed go first"""
    size = _folder_size
    try:
        games = [os.path.join(ROM_DIR, d) for d in os.listdir(ROM_DIR) if d.isdigit() and d not in keep]
        games = [d for d in games if os.path.isdir(d)]
        games.sort(key=os.path.getmtime)
        sizes = {d: size(d) for d in games}
        total = sum(sizes.values())
        while games and total > ROM_CACHE_MB * 1024 * 1024:
            d = games.pop(0)
            total -= sizes[d]
            shutil.rmtree(d, ignore_errors=True)
    except OSError as e:
        print(f"[retro games] couldn't tidy the downloads: {e}")


def _folder_size(d):
    return sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(d) for f in fs)


def downloads():
    """the games downloaded to this PC -> {games: [{id, title, platform, image, url, size, when}], total}
    (the names come from your Recent / Favorites lists; a game missing from both is named after its file)"""
    known = {}
    lib = library()
    for g in lib["favorites"] + lib["recent"]:
        if g.get("id"):
            known[str(g["id"])] = g
    out = []
    try:
        names = os.listdir(ROM_DIR)
    except OSError:
        names = []
    for gid in names:
        d = os.path.join(ROM_DIR, gid)
        if not gid.isdigit() or not os.path.isdir(d):
            continue
        g = known.get(gid, {})
        files = [f for f in os.listdir(d) if not f.endswith(".part") and os.path.isfile(os.path.join(d, f))]
        guess = os.path.splitext(files[0])[0].replace("-", " ").replace("_", " ") if files else ""
        title = g.get("title") or (guess[:1].upper() + guess[1:]) or f"Game {gid}"
        out.append({"id": gid, "title": title, "platform": g.get("platform", ""), "image": g.get("image", ""),
                    "url": g.get("url", ""), "size": _folder_size(d), "when": os.path.getmtime(d)})
    out.sort(key=lambda g: -g["when"])
    return {"games": out, "total": sum(g["size"] for g in out)}


def delete_download(gid="all"):
    """remove a downloaded game (or "all" of them) from this PC. Your saves are kept, and the game can be
    downloaded again any time by playing it."""
    ids = [g["id"] for g in downloads()["games"]] if gid == "all" else [str(gid)]
    for one in ids:
        if not re.fullmatch(r"\d+", one):
            return {"error": "That isn't a downloaded game."}
        if one in downloading:
            return {"error": "That game is still downloading. Try again when it's done."}
        shutil.rmtree(os.path.join(ROM_DIR, one), ignore_errors=True)
    return downloads()


# ---------------- your saves from the phone (kept in data/retro_saves/<game id>/) ----------------
SAVE_KINDS = ("state", "sram")       # state = the Save button (exactly where you were); sram = the game's own save


def _save_path(gid, kind):
    if not re.fullmatch(r"\d+", str(gid)) or kind not in SAVE_KINDS:
        raise ValueError("bad save")
    return os.path.join(SAVE_DIR, str(gid), kind + ".bin")


def save_data(gid, kind, b64):
    """keep a save (base64 from the player); the one before it is kept as a backup"""
    try:
        path = _save_path(gid, kind)
        raw = base64.b64decode(b64 or "")
        if not raw:
            return {"error": "Nothing to save."}
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.exists(path):
            os.replace(path, path[:-4] + ".prev.bin")
        with open(path, "wb") as f:
            f.write(raw)
        return {"ok": True, "when": time.time()}
    except Exception as e:
        return {"error": f"Couldn't save ({type(e).__name__})."}


def load_data(gid, kind):
    """{data: base64 or None, when}"""
    try:
        path = _save_path(gid, kind)
        if not os.path.exists(path):
            return {"data": None}
        with open(path, "rb") as f:
            return {"data": base64.b64encode(f.read()).decode(), "when": os.path.getmtime(path)}
    except Exception as e:
        return {"data": None, "error": f"Couldn't read the save ({type(e).__name__})."}


# ---------------- recently played + favourites ----------------
def _game_entry(g):
    return {k: g.get(k) for k in ("title", "url", "image", "platform", "likes") if g.get(k) is not None}


def library():
    try:
        with open(LIBRARY_FILE, encoding="utf-8") as f:
            lib = json.load(f)
    except Exception:
        lib = {}
    saved = set(os.listdir(SAVE_DIR)) if os.path.isdir(SAVE_DIR) else set()
    for key in ("recent", "favorites"):             # games from a site the app no longer uses are left out
        lib[key] = [g for g in lib.get(key, []) if is_game_url(g.get("url"))]
        for g in lib[key]:
            g["saved"] = g.get("id") in saved
    return lib


def _write_library(lib):
    try:
        with open(LIBRARY_FILE, "w", encoding="utf-8") as f:
            json.dump({"recent": lib["recent"], "favorites": lib["favorites"]}, f, indent=1)
    except Exception as e:
        print(f"[retro games] couldn't save your list: {e}")


def add_recent(game):
    if not is_game_url(game.get("url")):
        return
    lib = library()
    entry = {**_game_entry(game), "id": game.get("id"), "played": time.time()}
    lib["recent"] = [entry] + [g for g in lib["recent"] if g.get("url") != game["url"]][:29]
    _write_library(lib)


def favorite(game, on=True):
    """add/remove a favourite -> the new lists"""
    if not isinstance(game, dict) or not is_game_url(game.get("url")):
        return {"error": "That game can't be added."}
    lib = library()
    lib["favorites"] = [g for g in lib["favorites"] if g.get("url") != game["url"]]
    if on:
        old = next((g for g in lib["recent"] if g.get("url") == game["url"]), {})
        lib["favorites"].insert(0, {**_game_entry(game), "id": game.get("id") or old.get("id")})
    _write_library(lib)
    return library()
