"""
mygames.py - your own games in the Games hub (the ⇅ button next to the music button).

A game is a folder with a Windows .exe in it, like the Unity build (Vermeil.exe + Vermeil_Data + UnityPlayer.dll...).
Adding one COPIES the whole folder into data/games/<name>/, so the game moves with Vermeil to another PC
(scripts/package_app.py --with-my-data packs it too). Three ways in:
    add_path(path)   a game's .exe (its folder is copied) or a .zip of the game folder
    add_url(url)     a Google Drive share link (or any https link) to a .zip of the game folder
    remove(id)       deletes the copy again (only inside data/games)
launch(id) starts it in its own window; Vermeil keeps running. The list is saved in data/my_games.json.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

from paths import data_file

GAMES_DIR = data_file("games")
LIST_FILE = data_file("my_games.json")
SKIP_DIRS = re.compile(r"Do(n|No)tShip|BackUpThisFolder|^__pycache__$|^\.git$", re.I)     # Unity's debug files: not needed
NOT_THE_GAME = re.compile(r"^(UnityCrashHandler(32|64)?|unins\d*|vc_?redist.*|dxsetup|crashpad_handler)\.exe$", re.I)
MAX_GB = 20
# a Unity game made in this project: the hub offers to add it when it's on this PC
SUGGEST = [os.path.join(os.path.expanduser("~"), "My project", "Build", "Vermeil.exe")]


def _load():
    try:
        with open(LIST_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, list) else []
    except (OSError, ValueError):
        return []


def _save(games):
    os.makedirs(os.path.dirname(LIST_FILE), exist_ok=True)
    tmp = LIST_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(games, f, indent=1)
    os.replace(tmp, LIST_FILE)


def _inside(path, folder):
    path, folder = os.path.realpath(path), os.path.realpath(folder)
    return path.startswith(folder + os.sep)


def _exe_of(game):
    return os.path.join(GAMES_DIR, game["folder"], game["exe"])


def _folder_size(top):
    total = 0
    for root, dirs, files in os.walk(top):
        dirs[:] = [d for d in dirs if not SKIP_DIRS.search(d)]
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
            except OSError:
                pass
    return total


def find_exe(folder):
    """the game's .exe: the one at the top of the folder (or one folder down, as zips often have), never the helpers"""
    for depth in (0, 1):
        for root, dirs, files in os.walk(folder):
            rel = os.path.relpath(root, folder)
            level = 0 if rel == "." else rel.count(os.sep) + 1
            if level > depth:
                dirs[:] = []
                continue
            exes = sorted(f for f in files if f.lower().endswith(".exe") and not NOT_THE_GAME.match(f))
            if level == depth and exes:
                # a Unity game: <Name>.exe next to <Name>_Data
                exes.sort(key=lambda f: not os.path.isdir(os.path.join(root, f[:-4] + "_Data")))
                return os.path.relpath(os.path.join(root, exes[0]), folder)
    return None


def _free_folder(name):
    base = re.sub(r"[^\w .-]+", "_", name).strip(" .") or "game"
    folder, n = base, 2
    while os.path.exists(os.path.join(GAMES_DIR, folder)):
        folder, n = f"{base} {n}", n + 1
    return folder


def list_games():
    """the games in the hub (and a game found on this PC that isn't added yet)"""
    games = [dict(g, ok=os.path.isfile(_exe_of(g))) for g in _load()]
    have = {os.path.basename(g["exe"]).lower() for g in games}
    found = [{"path": p, "name": os.path.splitext(os.path.basename(p))[0]} for p in SUGGEST
             if os.path.isfile(p) and os.path.basename(p).lower() not in have]
    return {"games": games, "found": found}


def _register(folder, name, progress):
    exe = find_exe(os.path.join(GAMES_DIR, folder))
    if not exe:
        shutil.rmtree(os.path.join(GAMES_DIR, folder), ignore_errors=True)
        raise RuntimeError("No game .exe was found in it. Pick the game's .exe, or a .zip of the folder that has it.")
    games = _load()
    game = {"id": f"g{int(time.time() * 1000)}", "name": name, "folder": folder, "exe": exe.replace("\\", "/"),
            "mb": round(_folder_size(os.path.join(GAMES_DIR, folder)) / 1e6), "added": time.strftime("%Y-%m-%d")}
    games.append(game)
    _save(games)
    progress(1.0, "Added")
    return {"ok": True, "game": game}


def _copy_folder(src, dst, progress):
    files = []
    for root, dirs, names in os.walk(src):
        dirs[:] = [d for d in dirs if not SKIP_DIRS.search(d)]
        files += [os.path.join(root, n) for n in names]
    total = sum(os.path.getsize(f) for f in files) or 1
    if total > MAX_GB * 1e9:
        raise RuntimeError(f"That folder is over {MAX_GB} GB - pick the game's own folder, not a whole drive.")
    done = 0
    for f in files:
        out = os.path.join(dst, os.path.relpath(f, src))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        shutil.copy2(f, out)
        done += os.path.getsize(f)
        progress(0.05 + 0.9 * done / total, f"Copying the game ({done / 1e6:.0f} / {total / 1e6:.0f} MB)")


def _unzip(zpath, dst, progress):
    with zipfile.ZipFile(zpath) as z:
        items = [m for m in z.infolist() if not m.is_dir()]
        total = sum(m.file_size for m in items) or 1
        done = 0
        for m in items:
            target = os.path.join(dst, m.filename)
            if not _inside(target, dst):                 # never write outside the game's folder
                continue
            z.extract(m, dst)
            done += m.file_size
            progress(0.55 + 0.4 * done / total, f"Unpacking the game ({done / 1e6:.0f} / {total / 1e6:.0f} MB)")


def add_path(path, progress=None):
    """add a game from this PC: its .exe (the folder it's in is copied) or a .zip of the game folder"""
    say = progress or (lambda *_: None)
    path = os.path.abspath(path or "")
    low = path.lower()
    if not os.path.isfile(path) or not low.endswith((".exe", ".zip")):
        return {"error": "Pick the game's .exe file, or a .zip of the game folder."}
    if NOT_THE_GAME.match(os.path.basename(path)):
        return {"error": "That's a helper program, not the game. Pick the game's own .exe."}
    src = os.path.dirname(path)
    if low.endswith(".exe") and os.path.splitdrive(src)[1] in ("", "\\", "/"):
        return {"error": "Put the game in its own folder first (it can't be copied from the top of a drive)."}
    if low.endswith(".exe") and _inside(path, GAMES_DIR):
        return {"error": "That game is already in Vermeil."}
    name = os.path.splitext(os.path.basename(path))[0]
    folder = _free_folder(name)
    dst = os.path.join(GAMES_DIR, folder)
    try:
        os.makedirs(dst)
        say(0.03, "Getting the game ready…")
        if low.endswith(".exe"):
            _copy_folder(src, dst, say)
            exe = os.path.relpath(path, src)
            res = _register(folder, name, say)
            if res["game"]["exe"] != exe.replace("\\", "/"):       # keep the .exe that was picked
                games = _load()
                games[-1]["exe"] = exe.replace("\\", "/")
                _save(games)
                res["game"]["exe"] = games[-1]["exe"]
            return res
        _unzip(path, dst, lambda f, t: say(0.05 + (f - 0.55) * 2.2, t))
        return _register(folder, name, say)
    except Exception as e:
        shutil.rmtree(dst, ignore_errors=True)
        return {"error": f"Couldn't add the game: {e}"}


def add_url(url, progress=None):
    """add a game from a Google Drive share link (or any https link) to a .zip of the game folder.
    A Drive FOLDER link (e.g. the whole Vermeil folder) adds every game .zip in its "3 - Games" part."""
    import gdrive
    say = progress or (lambda *_: None)
    if not (url or "").strip():                 # no link: the games in the Vermeil Google Drive folder
        import plugins
        url = plugins.folder_link()
    if gdrive.is_folder_link(url):
        return add_folder(url, say)
    tmp = tempfile.mkdtemp(prefix="vermeil_game_")
    try:
        say(0.01, "Connecting…")
        zpath = gdrive.download(url, tmp + os.sep, lambda f, t: say(0.02 + 0.5 * f, t))
        if not zipfile.is_zipfile(zpath):
            return {"error": "The link didn't give a .zip. Zip the game folder (right-click → Send to → "
                             "Compressed (zipped) folder), upload that, and share its link."}
        name = os.path.splitext(os.path.basename(zpath))[0]
        name = re.sub(r"[-_ ]*(windows|win64|build|game)$", "", name, flags=re.I) or name
        folder = _free_folder(name)
        dst = os.path.join(GAMES_DIR, folder)
        os.makedirs(dst)
        try:
            _unzip(zpath, dst, say)
            return _register(folder, name, say)
        except Exception:
            shutil.rmtree(dst, ignore_errors=True)
            raise
    except Exception as e:
        return {"error": gdrive.hide_links(f"Couldn't download the game: {e}")}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def add_folder(url, progress=None, _files=None):
    """every game .zip in a shared Drive folder (the ones under a "Games" folder; or all zips if there is none)"""
    import gdrive
    say = progress or (lambda *_: None)
    try:
        say(0.01, "Reading the Drive folder…")
        files = _files if _files is not None else gdrive.list_folder(url)
    except Exception as e:
        return {"error": gdrive.hide_links(f"Couldn't read the folder: {e}")}
    zips = [f for f in files if f["name"].lower().endswith(".zip")]
    games = [f for f in zips if "games" in f["path"].lower()] or [f for f in zips if "/" not in f["path"]]
    if not games:
        return {"error": "No game .zip in that folder. Put each game's .zip in it (or in its \"3 - Games\" folder)."}
    have = {g["name"].lower() for g in _load()}
    added, last = [], {}
    for f in games:
        name = os.path.splitext(f["name"])[0]
        if name.lower() in have:
            continue
        last = add_url(f["url"], say)
        if last.get("error"):
            return last
        added.append(name)
    if not added:
        return {"error": "Those games are already in your hub."}
    return {**last, "added": added}


def launch(gid):
    g = next((g for g in _load() if g["id"] == gid), None)
    if not g:
        return {"error": "That game isn't in the list any more."}
    exe = _exe_of(g)
    if not os.path.isfile(exe) or not _inside(exe, GAMES_DIR):
        return {"error": f"{g['name']}'s files are missing. Remove it and add it again."}
    if sys.platform != "win32":
        return {"error": f"{g['name']} is a Windows game."}
    subprocess.Popen([exe], cwd=os.path.dirname(exe), close_fds=True)
    return {"ok": True, "name": g["name"]}


def remove(gid):
    games = _load()
    g = next((g for g in games if g["id"] == gid), None)
    if not g:
        return {"ok": True}
    folder = os.path.join(GAMES_DIR, g["folder"])
    if _inside(folder, GAMES_DIR):
        shutil.rmtree(folder, ignore_errors=True)
    _save([x for x in games if x["id"] != gid])
    return {"ok": True, "freed_mb": g.get("mb", 0)}
