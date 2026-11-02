"""
launchers.py - the games installed on this PC, for the Games hub (the "Installed games" shelf under the big cards): Steam,
Epic Games, GOG Galaxy, Ubisoft Connect and Riot, then anything else that looks like a game: what Windows lists as installed
(Battle.net, EA, Roblox, Minecraft...) and folders called Games on any drive.

Nothing is copied or changed in the launchers: the libraries are only READ (Steam's appmanifest files, Epic's
manifests, GOG's and Ubisoft's registry keys). Each game's cover picture is copied once into ui/games/covers/ so the
hub can show it; when a launcher has no cover on this PC, Steam's online one (or a coloured tile) is used.
play(store, id) asks the launcher to start the game (steam://rungameid/..., com.epicgames.launcher://...),
exactly like pressing Play there.
"""
import base64
import glob
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COVER_DIR = os.path.join(ROOT, "ui", "games", "covers")
COVER_URL = "covers/"                                       # as seen from ui/games/index.html
STORES = {"steam": "Steam", "epic": "Epic Games", "gog": "GOG", "ubisoft": "Ubisoft", "riot": "Riot Games", "pc": "On this PC"}
# Steam "games" that aren't games
STEAM_SKIP = {"228980"}                                     # Steamworks Common Redistributables
STEAM_SKIP_NAME = re.compile(r"redistributable|^proton|steamvr|steam linux runtime|dedicated server|\bsdk\b", re.I)


def _reg(root, path, name=None):
    """a registry value (or the key's subkey names when name is None); None when missing / not Windows"""
    if sys.platform != "win32":
        return None
    import winreg
    try:
        with winreg.OpenKey(root, path) as k:
            if name is not None:
                return winreg.QueryValueEx(k, name)[0]
            out, i = [], 0
            while True:
                try:
                    out.append(winreg.EnumKey(k, i))
                except OSError:
                    return out
                i += 1
    except OSError:
        return None


def _cover(store, gid, src):
    """copy a local cover picture into ui/games/covers (once) and return its URL for the hub"""
    if not src or not os.path.isfile(src):
        return ""
    ext = os.path.splitext(src)[1].lower() or ".jpg"
    name = re.sub(r"[^\w.-]", "_", f"{store}_{gid}{ext}")
    dest = os.path.join(COVER_DIR, name)
    try:
        if not os.path.exists(dest) or os.path.getmtime(src) > os.path.getmtime(dest):
            os.makedirs(COVER_DIR, exist_ok=True)
            shutil.copy2(src, dest)
    except OSError:
        return ""
    return COVER_URL + name


# ---------------- Steam ----------------
def _vdf_values(text, key):
    return re.findall(rf'"{key}"\s+"((?:[^"\\]|\\.)*)"', text)


def _steam_root():
    if sys.platform != "win32":
        return None
    import winreg
    p = _reg(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath") or \
        _reg(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath")
    return os.path.normpath(p) if p and os.path.isdir(p) else None


def _steam_cover(root, appid):
    """the tall library cover from Steam's own cache (newer Steam keeps it in a hashed sub-folder)"""
    base = os.path.join(root, "appcache", "librarycache")
    for name in ("library_600x900.jpg", "library_capsule.jpg", "header.jpg", "library_header.jpg"):
        for p in (os.path.join(base, appid, name), os.path.join(base, f"{appid}_{name}")):
            if os.path.isfile(p):
                return p
        found = glob.glob(os.path.join(base, appid, "*", name))
        if found:
            return found[0]
    return None


def steam_games():
    root = _steam_root()
    if not root:
        return []
    libs = [root]
    try:
        with open(os.path.join(root, "steamapps", "libraryfolders.vdf"), encoding="utf-8", errors="replace") as f:
            libs += [p.replace("\\\\", "\\") for p in _vdf_values(f.read(), "path")]
    except OSError:
        pass
    games, seen = [], set()
    for lib in dict.fromkeys(os.path.normcase(os.path.normpath(p)) for p in libs):
        for acf in glob.glob(os.path.join(lib, "steamapps", "appmanifest_*.acf")):
            try:
                with open(acf, encoding="utf-8", errors="replace") as f:
                    text = f.read()
            except OSError:
                continue
            appid = (_vdf_values(text, "appid") or [""])[0]
            name = (_vdf_values(text, "name") or [""])[0]
            if not appid or appid in seen or appid in STEAM_SKIP or STEAM_SKIP_NAME.search(name):
                continue
            seen.add(appid)
            state = int((_vdf_values(text, "StateFlags") or ["4"])[0] or 4)
            cover = _cover("steam", appid, _steam_cover(root, appid)) or \
                f"https://cdn.akamai.steamstatic.com/steam/apps/{appid}/library_600x900.jpg"
            games.append({"store": "steam", "id": appid, "name": name, "cover": cover,
                          "ready": bool(state & 4),                        # 4 = fully installed (6 = needs an update)
                          "size_gb": round(int((_vdf_values(text, "SizeOnDisk") or ["0"])[0] or 0) / 1e9, 1)})
    return games


# ---------------- Epic Games ----------------
EPIC_DATA = os.path.join(os.environ.get("PROGRAMDATA", r"C:\ProgramData"), "Epic", "EpicGamesLauncher", "Data")


def _epic_covers():
    """{catalog item id: tall cover URL} from the launcher's catalog cache (base64 JSON)"""
    try:
        with open(os.path.join(EPIC_DATA, "Catalog", "catcache.bin"), "rb") as f:
            items = json.loads(base64.b64decode(f.read()))
    except (OSError, ValueError):
        return {}
    out = {}
    for it in items if isinstance(items, list) else []:
        imgs = {i.get("type"): i.get("url") for i in it.get("keyImages") or []}
        url = imgs.get("DieselGameBoxTall") or imgs.get("OfferImageTall") or imgs.get("DieselGameBox") or imgs.get("Thumbnail")
        if url:
            out[it.get("id")] = url
    return out


def epic_games():
    files = glob.glob(os.path.join(EPIC_DATA, "Manifests", "*.item"))
    if not files:
        return []
    covers = _epic_covers()
    games = []
    for p in files:
        try:
            with open(p, encoding="utf-8") as f:
                m = json.load(f)
        except (OSError, ValueError):
            continue
        cats = m.get("AppCategories") or []
        if m.get("bIsIncompleteInstall") or (cats and "games" not in cats):       # Unreal Engine, plugins...
            continue
        launch = f"{m.get('CatalogNamespace')}:{m.get('CatalogItemId')}:{m.get('AppName')}"
        games.append({"store": "epic", "id": launch, "name": m.get("DisplayName") or m.get("AppName"),
                      "cover": covers.get(m.get("CatalogItemId"), ""), "ready": True,
                      "size_gb": round((m.get("InstallSize") or 0) / 1e9, 1)})
    return games


# ---------------- GOG Galaxy / Ubisoft Connect (registry) ----------------
def gog_games():
    if sys.platform != "win32":
        return []
    import winreg
    base = r"SOFTWARE\WOW6432Node\GOG.com\Games"
    games = []
    for gid in _reg(winreg.HKEY_LOCAL_MACHINE, base) or []:
        key = f"{base}\\{gid}"
        name, exe = _reg(winreg.HKEY_LOCAL_MACHINE, key, "gameName"), _reg(winreg.HKEY_LOCAL_MACHINE, key, "exe")
        if name and exe and os.path.isfile(exe):
            folder = os.path.dirname(exe)
            pic = next((p for p in glob.glob(os.path.join(folder, "*.ico")) + glob.glob(os.path.join(folder, "goggame-*.ico"))), None)
            games.append({"store": "gog", "id": gid, "name": name, "cover": _cover("gog", gid, pic) if pic else "", "ready": True,
                          "size_gb": 0})
    return games


def ubisoft_games():
    if sys.platform != "win32":
        return []
    import winreg
    base = r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs"
    games = []
    for gid in _reg(winreg.HKEY_LOCAL_MACHINE, base) or []:
        folder = _reg(winreg.HKEY_LOCAL_MACHINE, f"{base}\\{gid}", "InstallDir")
        if folder and os.path.isdir(folder):
            games.append({"store": "ubisoft", "id": gid, "name": os.path.basename(os.path.normpath(folder)), "cover": "",
                          "ready": True, "size_gb": 0})
    return games


# ---------------- what Windows lists as installed ----------------
UNINSTALL = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
UNINSTALL_ROOTS = [("HKLM", UNINSTALL), ("HKLM", r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"), ("HKCU", UNINSTALL)]
RIOT_DATA = os.path.join(os.environ.get("PROGRAMDATA", r"C:\ProgramData"), "Riot Games")
# who makes games: the name alone says nothing about "Fortnite" or "Genshin Impact"
GAME_MAKERS = re.compile(r"blizzard|electronic arts|\bea\b|rockstar|mojang|roblox|hoyoverse|mihoyo|cognosphere|garena|krafton|activision|bethesda|cd projekt|"
                         r"capcom|\bsega\b|square enix|bandai|nexon|wargaming|gameloft|supercell|innersloth|tencent games|digital extremes|grinding gear|"
                         r"respawn|bungie|2k games|ubisoft|smilegate|pearl abyss|gaijin|hi-rez|kuro games|game science|games?\b", re.I)
NOT_GAMES = re.compile(r"\bstudio\b|launcher$(?<!revived launcher)|redist|runtime|\bsdk\b|vanguard|anti-?cheat|easyanticheat|battleye|riot client|^steam$|"
                       r"epic games launcher|ubisoft connect|^ea app$|^origin$|battle\.net$|gog galaxy|driver|companion|overlay|geforce|update|tool|editor", re.I)
SKIP_KEYS = re.compile(r"^(steam app \d+|riot game )", re.I)
BAD_EXE = re.compile(r"unins|setup|install|crash|report|update|redist|helper|launcher_?helper|vc_|dxsetup|ue4prereq", re.I)
SKIP_DIRS = {"windows", "program files", "program files (x86)", "programdata", "users", "$recycle.bin", "system volume information", "node_modules", "steamapps"}


def uninstall_entries():
    """{key: {name, publisher, folder, icon, command, kb}} of everything Windows lists as installed. Empty when not Windows."""
    if sys.platform != "win32":
        return {}
    import winreg
    out = {}
    for hive, path in UNINSTALL_ROOTS:
        root = getattr(winreg, "HKEY_LOCAL_MACHINE" if hive == "HKLM" else "HKEY_CURRENT_USER")
        for key in _reg(root, path) or []:
            sub = f"{path}\\{key}"
            read = lambda n: _reg(root, sub, n) or ""
            name = str(read("DisplayName")).strip()
            if name and not read("SystemComponent"):
                out[key] = {"name": name, "publisher": str(read("Publisher")), "folder": os.path.normpath(str(read("InstallLocation"))) if read("InstallLocation") else "",
                            "icon": str(read("DisplayIcon")).split(",")[0].strip('"'), "command": str(read("UninstallString")), "kb": read("EstimatedSize") or 0}
    return out


def _main_exe(folder):
    """the program that starts what's in a folder: the biggest .exe near its top that isn't an installer or a helper"""
    best, size = None, 0
    base = folder.rstrip("\\/").count(os.sep)
    for d, subs, files in os.walk(folder):
        if d.count(os.sep) - base >= 2:
            subs[:] = []
        for f in files:
            if f.lower().endswith(".exe") and not BAD_EXE.search(f):
                p = os.path.join(d, f)
                try:
                    s = os.path.getsize(p)
                except OSError:
                    continue
                if s > size:
                    best, size = p, s
    return best


def _size_gb(folder, limit=30000):
    total, n = 0, 0
    for d, _, files in os.walk(folder):
        for f in files:
            n += 1
            try:
                total += os.path.getsize(os.path.join(d, f))
            except OSError:
                pass
        if n > limit:
            break
    return round(total / 1e9, 1)


def riot_games():
    """League of Legends, Valorant, TFT...: Riot's installer lists each as "Riot Game <product>.<patchline>" """
    games = []
    for key, e in uninstall_entries().items():
        m = re.match(r"Riot Game ([\w]+)\.(\w+)$", key)
        if not m or m.group(1) == "Riot_Client" or not e["folder"] or not os.path.isdir(e["folder"]):
            continue
        gid = f"{m.group(1)}.{m.group(2)}"
        pic = os.path.join(RIOT_DATA, "Metadata", gid, f"{gid}.ico")
        games.append({"store": "riot", "id": gid, "name": e["name"], "cover": _cover("riot", gid, pic), "ready": True, "size_gb": _size_gb(e["folder"])})
    return games


def _riot_client():
    try:
        with open(os.path.join(RIOT_DATA, "RiotClientInstalls.json"), encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    for k in ("rc_default", "rc_live"):
        if d.get(k) and os.path.isfile(d[k]):
            return d[k]
    return None


def _game_folders():
    """folders called Games (or "... Games") near the top of each drive, skipping Windows' own: {game folder: its name}"""
    out = {}
    if sys.platform != "win32":
        return out
    import string
    for letter in string.ascii_uppercase:
        drive = f"{letter}:\\"
        if not os.path.exists(drive):
            continue
        stack, seen = [(drive, 0)], 0
        while stack and seen < 4000:
            folder, depth = stack.pop()
            seen += 1
            try:
                subs = [e for e in os.scandir(folder) if e.is_dir(follow_symlinks=False) and e.name.lower() not in SKIP_DIRS and not e.name.startswith(("$", "."))]
            except OSError:
                continue
            if re.search(r"(^|\s)games$", os.path.basename(folder.rstrip("\\")), re.I) and "riot games" not in folder.lower():
                out.update({e.path: e.name for e in subs})
            elif depth < 3:
                stack += [(e.path, depth + 1) for e in subs]
    return out


def pc_games():
    """Games with no launcher of their own to read, from what Windows lists and from Games folders. Their id is a hash of the folder,
    so play() only ever starts what this scan found."""
    import hashlib
    taken = {os.path.normcase(os.path.normpath(p)) for p in game_dirs()}
    found = {}
    for key, e in uninstall_entries().items():
        if SKIP_KEYS.search(key) or NOT_GAMES.search(e["name"]):
            continue
        if GAME_MAKERS.search(e["publisher"]) or GAME_MAKERS.search(e["name"]) or "game" in e["folder"].lower():
            folder = e["folder"] or (os.path.dirname(e["icon"]) if e["icon"].lower().endswith(".exe") else "")
            if folder and os.path.isdir(folder):
                found[folder] = {"name": re.sub(r" for \w+$", "", e["name"]), "exe": e["icon"] if e["icon"].lower().endswith(".exe") and not BAD_EXE.search(os.path.basename(e["icon"])) else None,
                                 "size_gb": round(float(e["kb"] or 0) / 1e6, 1)}
    for folder, name in _game_folders().items():
        found.setdefault(folder, {"name": name, "exe": None, "size_gb": 0})
    games = []
    for folder, g in found.items():
        if os.path.normcase(os.path.normpath(folder)) in taken:
            continue
        exe = g["exe"] if g["exe"] and os.path.isfile(g["exe"]) else _main_exe(folder)
        if exe:
            games.append({"store": "pc", "id": hashlib.md5(os.path.normcase(folder).encode("utf-8")).hexdigest()[:16], "name": g["name"], "cover": "", "ready": True,
                          "size_gb": g["size_gb"] or _size_gb(folder), "exe": exe})
    return games


def installed():
    """every game on this PC, A-Z: [{store, store_name, id, name, cover, ready, size_gb}]"""
    games = []
    for fn in (steam_games, epic_games, gog_games, ubisoft_games, riot_games, pc_games):
        try:
            games += fn()
        except Exception as e:  # noqa: BLE001 - one broken launcher shouldn't hide the others
            print(f"[launchers] {fn.__name__}: {e}")
    for g in games:
        g["store_name"] = STORES[g["store"]]
        g.pop("exe", None)
    return sorted(games, key=lambda g: g["name"].lower())


def game_dirs():
    """{folder (lower case): game name} of the Epic, GOG and Ubisoft games. (Steam games are known by their steamapps path.)"""
    out = {}
    for p in glob.glob(os.path.join(EPIC_DATA, "Manifests", "*.item")):
        try:
            with open(p, encoding="utf-8") as f:
                m = json.load(f)
            if m.get("InstallLocation"):
                out[os.path.normcase(os.path.normpath(m["InstallLocation"]))] = m.get("DisplayName") or m.get("AppName") or "this game"
        except (OSError, ValueError):
            continue
    if sys.platform == "win32":
        import winreg
        gog = r"SOFTWARE\WOW6432Node\GOG.com\Games"
        for gid in _reg(winreg.HKEY_LOCAL_MACHINE, gog) or []:
            exe = _reg(winreg.HKEY_LOCAL_MACHINE, f"{gog}\\{gid}", "exe")
            if exe:
                out[os.path.normcase(os.path.dirname(exe))] = _reg(winreg.HKEY_LOCAL_MACHINE, f"{gog}\\{gid}", "gameName") or "this game"
        ubi = r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs"
        for gid in _reg(winreg.HKEY_LOCAL_MACHINE, ubi) or []:
            folder = _reg(winreg.HKEY_LOCAL_MACHINE, f"{ubi}\\{gid}", "InstallDir")
            if folder:
                folder = os.path.normpath(folder)
                out[os.path.normcase(folder)] = os.path.basename(folder)
    return out


def play(store, gid):
    """start the game through its launcher (like pressing Play there)"""
    gid = str(gid)
    if store == "riot" and re.fullmatch(r"\w+\.\w+", gid):
        client = _riot_client()
        if not client:
            return {"error": "The Riot Client isn't installed any more."}
        product, patchline = gid.split(".")
        subprocess.Popen([client, f"--launch-product={product}", f"--launch-patchline={patchline}"], cwd=os.path.dirname(client))
        return {"ok": True}
    if store == "pc":
        g = next((x for x in pc_games() if x["id"] == gid), None)
        if not g:
            return {"error": "That game isn't there any more."}
        try:
            subprocess.Popen([g["exe"]], cwd=os.path.dirname(g["exe"]))
        except OSError as e:
            return {"error": f"Couldn't start {g['name']}: {e}"}
        return {"ok": True}
    if store == "steam" and gid.isdigit():
        url = f"steam://rungameid/{gid}"
    elif store == "epic" and re.fullmatch(r"[\w.-]+:[\w.-]+:[\w.-]+", gid):
        url = f"com.epicgames.launcher://apps/{gid.replace(':', '%3A')}?action=launch&silent=true"
    elif store == "ubisoft" and gid.isdigit():
        url = f"uplay://launch/{gid}/0"
    elif store == "gog" and gid.isdigit():
        g = next((x for x in gog_games() if x["id"] == gid), None)
        if not g:
            return {"error": "That GOG game isn't installed any more."}
        import winreg
        exe = _reg(winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\WOW6432Node\GOG.com\Games\{gid}", "exe")
        subprocess.Popen([exe], cwd=os.path.dirname(exe))
        return {"ok": True}
    else:
        return {"error": "Unknown game."}
    try:
        os.startfile(url)                              # noqa: S606 - the launcher's own link
    except OSError as e:
        return {"error": f"Couldn't open {STORES.get(store, store)}: {e}"}
    return {"ok": True}
