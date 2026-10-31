"""
launchers.py - the games you installed with Steam, Epic Games, GOG Galaxy and Ubisoft Connect, for the Games hub
(the "Installed games" shelf under the big cards).

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
STORES = {"steam": "Steam", "epic": "Epic Games", "gog": "GOG", "ubisoft": "Ubisoft"}
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


def installed():
    """every installed launcher game, A-Z: [{store, store_name, id, name, cover, ready, size_gb}]"""
    games = []
    for fn in (steam_games, epic_games, gog_games, ubisoft_games):
        try:
            games += fn()
        except Exception as e:  # noqa: BLE001 - one broken launcher shouldn't hide the others
            print(f"[launchers] {fn.__name__}: {e}")
    for g in games:
        g["store_name"] = STORES[g["store"]]
    return sorted(games, key=lambda g: g["name"].lower())


def play(store, gid):
    """start the game through its launcher (like pressing Play there)"""
    gid = str(gid)
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
