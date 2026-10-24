"""
retrogames.py - the "Retro Games" part of the Games hub: classic console games from www.retrogames.cc.

How it works (beginner version):
- list_games() reads a page of the website (the home page, a console like SNES, or a search) and pulls out each
  game's name, picture, console and likes - so the app can show them in its own style.
- play_url() opens one game's page and finds its "embed" player: the same small player the website gives you to
  put a game on your own page (just the game + its buttons, no ads around it).
- Pages are remembered for a few hours in data/retrogames_cache.json, so the hub opens fast and still works
  (with the last list) when the site is slow.
"""
import base64
import html
import json
import os
import re
import shutil
import threading
import time
import zipfile
from urllib.parse import quote_plus, urlparse

import requests

from paths import data_file

SITE = "https://www.retrogames.cc"
CACHE_FILE = data_file("retrogames_cache.json")
CACHE_HOURS = 6
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"}

# the website's own menu: group -> [(id, name)]
PLATFORMS = {
    "Nintendo": [("nes", "NES"), ("snes", "SNES"), ("n64", "N64"), ("gameboy", "Game Boy"), ("gameboycolor", "Game Boy Color"),
                 ("gameboyadvance", "Game Boy Advance"), ("nds", "Nintendo DS"), ("fds", "Famicom Disk")],
    "Sega": [("genesis", "Genesis"), ("mastersystem", "Master System"), ("gamegear", "Game Gear"), ("sega32x", "32X"), ("segacd", "Sega CD")],
    "NEC": [("turbografx16", "TurboGrafx-16"), ("turbografxcd", "TurboGrafx CD"), ("pcecd", "PC Engine CD")],
    "Atari": [("atari7800", "Atari 7800"), ("lynx", "Atari Lynx"), ("jaguar", "Atari Jaguar")],
    "PlayStation": [("psx", "PlayStation")],
    "Arcade": [("arcade", "Arcade")],
    "Other": [("wonderswan", "WonderSwan"), ("ngp", "Neo Geo Pocket"), ("msx1", "MSX"), ("msx2", "MSX 2")],
}
PLATFORM_IDS = {p for group in PLATFORMS.values() for p, _ in group}


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


def _text(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def parse_cards(page):
    """every game card on a page -> [{title, url, image, platform, likes}]"""
    out, seen = [], set()
    for block in page.split('class="post thumb-border"')[1:]:
        url = re.search(r'href="(https://www\.retrogames\.cc/[a-z0-9]+-games/[^"]+\.html)"', block)
        if not url or url.group(1) in seen:
            continue
        seen.add(url.group(1))
        img = re.search(r'data-(?:src|poster)="([^"]+)"', block)
        title = re.search(r'<div class="post-des">.*?<a[^>]*>(.*?)</a>', block, re.S) or re.search(r'alt="([^"]*)"', block)
        plat = re.search(r'<div class="thumb-stats[^"]*">\s*<h6>(.*?)</h6>', block, re.S)
        likes = re.search(r'fa-heart"></i>\s*<span>([\d,]+)</span>', block)
        out.append({"title": _text(title.group(1)) if title else "Game", "url": url.group(1), "image": img.group(1) if img else "",
                    "platform": _text(plat.group(1)) if plat else "", "likes": int(likes.group(1).replace(",", "")) if likes else 0})
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
        return f"{SITE}/search?q={quote_plus(query.strip())}"
    if platform:
        if platform not in PLATFORM_IDS:
            raise ValueError(f"unknown console {platform}")
        return f"{SITE}/{platform}-games" if page <= 1 else f"{SITE}/{platform}-games/page/{int(page)}.html"
    return SITE + "/"


def list_games(platform="", page=1, query="", fresh=False):
    """{games: [...], platforms, platform, page, query, more} - or {error} when the site can't be reached"""
    page = max(1, int(page or 1))
    try:
        url = page_url(platform, page, query)
        text = _get(url, fresh)
    except ValueError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": f"Couldn't reach RetroGames.cc ({type(e).__name__}). Check your internet and try again."}
    games = [g for g in parse_cards(text) if is_english(g["title"])]
    more = bool(platform and not query and re.search(rf'/{platform}-games/page/{page + 1}\.html', text))
    return {"games": games, "platforms": PLATFORMS, "platform": platform, "page": page, "query": query, "more": more}


def _is_game_url(url):
    u = urlparse(url or "")
    return u.scheme == "https" and u.netloc in ("www.retrogames.cc", "retrogames.cc") and re.fullmatch(r"/[a-z0-9]+-games/[^/]+\.html", u.path)


def play_url(game_url, image=""):
    """the game's embed player address ({url}) - or {error}"""
    if not _is_game_url(game_url):
        return {"error": "That isn't a RetroGames.cc game."}
    try:
        page = _get(game_url)
        m = re.search(r'src="((?:https:)?//www\.retrogames\.cc/embed/[^"]+\.html)"', page)
        if m:
            src = m.group(1)
            return {"url": "https:" + src if src.startswith("//") else src}
        gid = re.search(r"game_id\s*[:=]\s*(\d+)", page)
    except Exception:
        gid = None
    # backup: the number in the game's picture + the name in its address = the embed player
    gid = gid.group(1) if gid else (re.search(r"/(\d+)_[0-9a-f]+\.", image or "") or [None, None])[1]
    if not gid:
        return {"error": "Couldn't open that game right now. Try again in a moment."}
    slug = urlparse(game_url).path.rsplit("/", 1)[-1]
    return {"url": f"{SITE}/embed/{gid}-{slug}"}


# ---------------- our own player (no ads, starts right away, saves kept on this PC) ----------------
# The website only lets its own pages download its game files, so Python downloads each game ONCE into
# ui/games/roms/ (the app's own folder, so the player page can open it). The player is EmulatorJS - the same
# free emulator the website uses - loaded without the ad and "PLAY NOW" screens.
ROM_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui", "games", "roms")
SAVE_DIR = data_file("retro_saves")
LIBRARY_FILE = data_file("retro_library.json")
ROM_CACHE_MB = 3000          # the downloaded games folder is kept under ~3 GB (the oldest-played go first)
CORES = {"mupen64plus2": "n64", "beetle-pce": "pce", "mame": "arcade", "fba": "arcade"}   # the website's name -> EmulatorJS's
_downloads = {}              # game id -> {"got", "total", "done", "error"}
_dl_lock = threading.Lock()


def parse_embed(page):
    """the game file, emulator and BIOS named in an embed player page"""
    vals = dict(re.findall(r"(EJS_\w+)\s*=\s*'([^']*)'", page))
    if not vals.get("EJS_gameUrl") or not vals.get("EJS_core"):
        return None
    bios = vals.get("EJS_biosUrl", "")
    if bios.startswith("/"):
        bios = SITE + bios
    core = vals["EJS_core"]
    # some arcade games are a small "clone" file that needs its main ("parent") game file too
    return {"game_url": vals["EJS_gameUrl"], "core": CORES.get(core, core), "bios_url": bios,
            "parent_url": vals.get("EJS_gameParentUrl", "")}


def _ext(url):
    m = re.search(r"\.(7z|zip|bin|iso|cue|chd|pbp|nes|sfc|smc|gba|gbc|gb|nds|z64|n64|md|gen|pce|bios|gg|rom)$", urlparse(url).path, re.I)
    return m.group(1).lower() if m else "bin"


def _game_id(embed_url):
    m = re.search(r"/embed/(\d+)-", embed_url)
    return m.group(1) if m else None


def _wrap(path):
    """put a file inside a zip of its own. The player unpacks a game's extra files - but an arcade game's parent
    has to stay a .zip, so it goes in another one (the same way the website's arcade BIOS pack holds .zip files)."""
    part = path + ".part"
    with zipfile.ZipFile(part, "w", zipfile.ZIP_STORED) as z:
        z.write(path[:-len(".wrap.zip")], os.path.basename(path[:-len(".wrap.zip")]))
    os.replace(part, path)


def _download(url, path, key):
    """download url -> path in the background, with progress in _downloads[key] (a .wrap.zip path: see _wrap)"""
    st = _downloads[key]
    wrap = path.endswith(".wrap.zip")
    file = path[:-len(".wrap.zip")] if wrap else path
    try:
        if not os.path.exists(file):
            with requests.get(url, headers={**UA, "Referer": SITE + "/"}, timeout=30, stream=True) as r:
                r.raise_for_status()
                st["total"] = int(r.headers.get("Content-Length") or 0)
                part = file + ".part"
                with open(part, "wb") as f:
                    for chunk in r.iter_content(256 * 1024):
                        f.write(chunk)
                        st["got"] += len(chunk)
            os.replace(part, file)
        if wrap:
            _wrap(path)
        st["done"] = True
    except Exception as e:
        st["error"] = f"Couldn't download the game ({type(e).__name__}). Check your internet and try again."
        for p in (file + ".part", path + ".part"):
            try:
                os.remove(p)
            except OSError:
                pass


def _trim_cache(keep):
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
        files = [f for f in os.listdir(d) if not f.endswith(".part")]
        guess = re.sub(r"^\d+_", "", os.path.splitext(files[0])[0]).replace("-", " ").replace("_", " ") if files else ""
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
        with _dl_lock:
            st = _downloads.get(one)
            if st and not st["done"] and not st["error"]:
                return {"error": "That game is still downloading. Try again when it's done."}
            _downloads.pop(one, None)
            _downloads.pop("parent:" + one, None)
        shutil.rmtree(os.path.join(ROM_DIR, one), ignore_errors=True)
    return downloads()


def _start(key, url, path):
    with _dl_lock:
        st = _downloads.get(key)
        if os.path.exists(path):
            _downloads[key] = {"got": 1, "total": 1, "done": True, "error": None}
            return
        if st and not st["done"] and not st["error"]:
            return                                     # already downloading
        _downloads[key] = {"got": 0, "total": 0, "done": False, "error": None}
    threading.Thread(target=_download, args=(url, path, key), daemon=True).start()


def prepare(game, fresh=False):
    """get a game ready for the player: {id, core, rom, bios} (paths the player page can open) - or {error}.
    The download runs in the background; ask progress(id) how it's going."""
    game = game if isinstance(game, dict) else {"url": game}
    r = play_url(game.get("url", ""), game.get("image", ""))
    if r.get("error"):
        return r
    gid = _game_id(r["url"])
    try:
        info = parse_embed(_get(r["url"], fresh))
    except Exception:
        info = None
    if not gid or not info:
        return {"error": "Couldn't open that game right now. Try again in a moment."}
    os.makedirs(os.path.join(ROM_DIR, "bios"), exist_ok=True)
    # the file keeps its own name (arcade games are recognised by it), in a folder for this game
    def name(url):
        return re.sub(r"[^\w.\-]", "_", os.path.basename(urlparse(url).path)) or f"game.{_ext(url)}"
    os.makedirs(os.path.join(ROM_DIR, gid), exist_ok=True)
    rom = f"{gid}/{name(info['game_url'])}"
    parent = f"{gid}/{name(info['parent_url'])}.wrap.zip" if info["parent_url"] else ""
    st = _downloads.get(gid)
    if st and st["error"] and not fresh:               # the website's download link may have expired: get a new one
        return prepare(game, fresh=True)
    _start(gid, info["game_url"], os.path.join(ROM_DIR, rom))
    if parent:
        _start("parent:" + gid, info["parent_url"], os.path.join(ROM_DIR, parent))
    bios = ""
    if info["bios_url"]:
        bios = "bios/" + os.path.basename(urlparse(info["bios_url"]).path)
        _start("bios:" + bios, info["bios_url"], os.path.join(ROM_DIR, bios))
    try:
        os.utime(os.path.join(ROM_DIR, gid))           # just played: keep it when tidying
    except OSError:
        pass
    _trim_cache(keep={gid})
    add_recent({**game, "id": gid})
    return {"id": gid, "core": info["core"], "rom": "roms/" + rom, "bios": ("roms/" + bios) if bios else "",
            "parent": ("roms/" + parent) if parent else ""}


def progress(gid, bios="", parent=""):
    """{done, got, total, error} for a game's download (and its BIOS / parent file, if it needs them)"""
    keys = [str(gid)] + (["bios:" + bios.split("roms/", 1)[-1]] if bios else []) + ([f"parent:{gid}"] if parent else [])
    sts = [_downloads.get(k) or {"got": 0, "total": 0, "done": False, "error": "not started"} for k in keys]
    err = next((s["error"] for s in sts if s["error"]), None)
    return {"done": all(s["done"] for s in sts), "got": sum(s["got"] for s in sts),
            "total": sum(s["total"] for s in sts), "error": err}


# ---------------- your saves (kept in data/retro_saves/<game id>/) ----------------
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
    lib.setdefault("recent", []); lib.setdefault("favorites", [])
    saved = set(os.listdir(SAVE_DIR)) if os.path.isdir(SAVE_DIR) else set()
    for g in lib["recent"] + lib["favorites"]:
        g["saved"] = g.get("id") in saved
    return lib


def _write_library(lib):
    try:
        with open(LIBRARY_FILE, "w", encoding="utf-8") as f:
            json.dump({"recent": lib["recent"], "favorites": lib["favorites"]}, f, indent=1)
    except Exception as e:
        print(f"[retro games] couldn't save your list: {e}")


def add_recent(game):
    if not _is_game_url(game.get("url")):
        return
    lib = library()
    entry = {**_game_entry(game), "id": game.get("id"), "played": time.time()}
    lib["recent"] = [entry] + [g for g in lib["recent"] if g.get("url") != game["url"]][:29]
    _write_library(lib)


def favorite(game, on=True):
    """add/remove a favourite -> the new lists"""
    if not isinstance(game, dict) or not _is_game_url(game.get("url")):
        return {"error": "That isn't a RetroGames.cc game."}
    lib = library()
    lib["favorites"] = [g for g in lib["favorites"] if g.get("url") != game["url"]]
    if on:
        old = next((g for g in lib["recent"] if g.get("url") == game["url"]), {})
        lib["favorites"].insert(0, {**_game_entry(game), "id": game.get("id") or old.get("id")})
    _write_library(lib)
    return library()
