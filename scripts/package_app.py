"""
package_app.py - packs Vermeil into ONE zip you can copy to another PC (USB stick, Google Drive...) and install there,
like downloading an app.

Run it from the project folder:
    python scripts/package_app.py                  -> dist/Vermeil-Installer-<date>.zip
    python scripts/package_app.py --with-my-data   -> also your chats/memory, characters, room, planner, gym, faces...
    python scripts/package_app.py --offline        -> also the Kokoro model + all your Piper voices (no downloads needed)
    python scripts/package_app.py --with-blender   -> also the blender/ folder (your .blend files)
    python scripts/package_app.py --with-library   -> also the dnd/ asset library (~7 GB, only needed to rebuild game assets)
    python scripts/package_app.py --with-ollama    -> also tools/ollama, the offline AI program (~3 GB; models download later)
    python scripts/package_app.py --drive          -> dist/Vermeil-Drive/: a folder per feature + your games, ready to
                                                      upload to Google Drive (install / uninstall each one from there)
    python scripts/package_app.py --drive --with-wheels  -> also each feature's Python packages inside its zip
                                                      (big: Voice clones' PyTorch is ~3 GB; same Python version only)

On the other PC: unzip it anywhere (e.g. Documents/Vermeil) and double-click INSTALL.bat.
The installer sets up Python packages, makes a desktop shortcut and opens Vermeil on Settings -> Plugins,
where you tick the features you want.

NEVER packed: your env file (API keys) and login tokens (Spotify, Google, YouTube cookies). The installer makes an
empty env for you to fill in. Big optional features go in plugin_packs/ (installed from Settings -> Plugins).
"""
import argparse
import datetime
import fnmatch
import functools
import os
import re
import shutil
import subprocess
import tempfile
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

ALWAYS_SKIP_DIRS = {"__pycache__", ".git", ".vscode", ".idea", "dist", "_archive", "node_modules", ".pytest_cache"}
# login tokens / secrets - never copied, sign in again on the new PC
SECRET_FILES = ["data/spotify_token.json", "data/google_token.json", "data/google_credentials.json", "data/cookies.txt"]
ALWAYS_SKIP_FILES = ["env", ".env", "*.pyc", "*.blend1", "*.tmp", "*.part", "*.log",
                     "data/plugins.json"] + SECRET_FILES          # (the installer writes a fresh plugins.json)
# made as their own zips in plugin_packs/ (Settings -> Plugins installs them)
PACKS = {"game_assets": ["ui/game/assets"], "ffmpeg": ["Packages/ffmpeg-8.0-full_build/bin/ffplay.exe"],
         "rvc_models": ["tools/rvc", "data/rvc_voices"], "unimate": ["tools/unimate"]}
# your personal saved things (only with --with-my-data)
MY_DATA = ["data/*.json", "data/*.txt", "data/game/**", "data/library/**", "data/meetings/**"]
NOT_MY_DATA = ["data/piper_catalog.json", "data/voices_cache.json"]     # downloadable caches: always fine to pack
DEFAULT_VOICE = "data/piper_voices/en_US-amy-medium.onnx*"


def rel(path):
    return os.path.relpath(path, ROOT).replace("\\", "/")


def matches(r, patterns):
    return any(fnmatch.fnmatch(r, p) or (p.endswith("/**") and r.startswith(p[:-3] + "/")) for p in patterns)


def wanted(r, a):
    """should this project file go into the main zip?"""
    parts = r.split("/")
    if any(p in ALWAYS_SKIP_DIRS for p in parts):
        return False
    if matches(r, ALWAYS_SKIP_FILES) or parts[-1] in ("env", ".env"):
        return False
    if any(r == d or r.startswith(d + "/") for paths in PACKS.values() for d in paths):
        return False                                          # goes into a plugin pack instead
    if r.startswith("Packages/"):
        return False                                          # ffmpeg build (only ffplay is packed) and other installers
    if r.startswith("plugin_packs/"):
        return False
    if r in code_files():
        return False                                          # a feature's own code: only in its zip on Drive                                          # zips this PC downloaded from Drive (each has its own Drive copy)
    if r.startswith("dnd/"):
        return a.with_library
    if r.startswith("blender/"):
        return a.with_blender
    if r.startswith("tools/kokoro/"):
        return a.offline
    if r.startswith("tools/ollama/models/"):
        return False                                          # AI models (GBs): Settings -> Plugins -> Offline AI downloads them
    if r.startswith("tools/ollama/"):
        return getattr(a, "with_ollama", False)               # ~3 GB; the Plugins tab can download it instead
    if r.startswith("data/games/"):
        return False                                          # your own games: their own zips (--drive), or the hub's ⇅ button
    if r.startswith("data/piper_voices/"):
        return a.offline or a.with_my_data or fnmatch.fnmatch(r, DEFAULT_VOICE)
    if r.startswith("data/models/"):
        return True                                           # face/object models (small, saves a download)
    if r.startswith("data/"):
        if matches(r, NOT_MY_DATA):
            return True
        return a.with_my_data and matches(r, MY_DATA)
    return True


def walk():
    for root, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in ALWAYS_SKIP_DIRS]
        for f in files:
            yield os.path.join(root, f)


def zip_paths(zpath, files, label):
    """files: paths inside the project (kept at their place), or (path, name in the zip) pairs"""
    n, size = 0, 0
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in files:
            f, r = f if isinstance(f, tuple) else (f, rel(f))
            store = r.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".glb", ".onnx", ".bin", ".zip", ".exe", ".ogg", ".mp3",
                                        ".whl", ".gz"))
            z.write(f, r, compress_type=zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED)
            n += 1
            size += os.path.getsize(f)
            if n % 500 == 0:
                print(f"   {label}: {n} files…")
    return n, size


UNINSTALL_BAT = r"""@echo off
rem Vermeil uninstaller - double-click me (it asks first, and can keep a backup of your saves).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall.ps1"
pause
"""

INSTALL_BAT = r"""@echo off
rem Vermeil installer - double-click me.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
pause
"""


def make_launcher(url=None):
    """dist/Get-Vermeil.bat: the small file you send to another PC. It downloads the zip from `url`, unzips it into
    Documents\\Vermeil and installs it. Without a url it asks for the link when it runs."""
    with open(os.path.join(ROOT, "scripts", "Get-Vermeil.bat"), encoding="utf-8") as f:
        text = f.read()
    if url:
        text = text.replace("__VERMEIL_URL__", url.replace('"', "").replace("`", "").replace("$", "`$"))
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "Get-Vermeil.bat")
    with open(out, "w", encoding="utf-8", newline="\r\n") as f:
        f.write(text)
    return out


def pack_files(name):
    files = []
    for p in PACKS[name]:
        full = os.path.join(ROOT, *p.split("/"))
        if os.path.isfile(full):
            files.append(full)
        elif os.path.isdir(full):
            files += [os.path.join(r, f) for r, ds, fs in os.walk(full) for f in fs if "__pycache__" not in r]
    return files


@functools.lru_cache(maxsize=1)
def code_files():
    """the code files of the features that can be uninstalled (Spotify, Cooking, Missions...): each goes in its own zip"""
    sys.path.insert(0, os.path.join(ROOT, "brain"))
    import plugins
    return {c for p in plugins.PLUGINS for c in p.get("code", [])}


def feature_files(p, a, tmp):
    """everything one feature (plugin) needs, for its own zip: its folders, its model files, the Ollama program,
    and with --with-wheels its Python packages (plugin_packs/wheels/<id>/, installed offline by Settings -> Plugins)"""
    files = pack_files(p["pack"]) if p.get("pack") in PACKS else []
    files += [os.path.join(ROOT, *c.split("/")) for c in p.get("code", []) if os.path.isfile(os.path.join(ROOT, *c.split("/")))]
    files += [os.path.join(ROOT, *f["path"].split("/")) for f in p.get("files", [])
              if os.path.isfile(os.path.join(ROOT, *f["path"].split("/")))]
    if p.get("ollama"):
        top = os.path.join(ROOT, "tools", "ollama")
        files += [os.path.join(r, f) for r, ds, fs in os.walk(top) for f in fs
                  if not rel(os.path.join(r, f)).startswith("tools/ollama/models/")]
    if getattr(a, "with_wheels", False) is True and p.get("pip"):        # only the real --with-wheels switch
        files += feature_wheels(p, tmp)
    return files


def _torch_index():
    """the PyTorch download site from requirements-ai.txt (the CUDA build), for pins like torch==2.6.0+cu124"""
    try:
        for line in open(os.path.join(ROOT, "requirements-ai.txt"), encoding="utf-8"):
            if line.startswith("--extra-index-url"):
                return line.split()[1]
    except OSError:
        pass
    return "https://download.pytorch.org/whl/cu124"


def _wheel_dist(filename):
    """'faiss_cpu-1.9.0-cp313-...whl' / 'pkg-1.0.tar.gz' -> 'faiss-cpu'"""
    import plugins
    base = filename[:-4] if filename.endswith(".whl") else re.sub(r"\.(tar\.gz|zip)$", "", filename)
    return plugins._norm(base.split("-")[0] if filename.endswith(".whl") else base.rsplit("-", 1)[0])


def _pip_download(specs, wd, deps):
    """python -m pip download (wheels first, source only when there's no wheel); one by one if the group fails"""
    def run(group, binary):
        cmd = [sys.executable, "-m", "pip", "download", "-d", wd] + ([] if deps else ["--no-deps"]) + \
              (["--only-binary=:all:"] if binary else []) + \
              (["--extra-index-url", _torch_index()] if any("+cu" in s or "torch" in s for s in group) else []) + group
        return subprocess.run(cmd, capture_output=True, text=True).returncode == 0
    if not specs or run(specs, True) or run(specs, False):
        return []
    failed = [s for s in specs if not (run([s], True) or run([s], False))]
    return failed


def feature_wheels(p, tmp, names=None, arc=None):
    """a feature's Python packages + what they pull in (not the core's), pinned to the versions on this PC,
    as [(wheel file, plugin_packs/wheels/<id>/<file>)] - Install puts them in offline, Uninstall removes the same set"""
    import plugins
    dists = plugins._dists()
    keep = plugins._tree(plugins.keep_pip(), dists)
    shared = {plugins._norm(n) for s in p.get("shared", []) for n in plugins.SHARED[s]}
    top = names or p["pip"]
    own = sorted(plugins._tree(top, dists) - keep - (set() if names else shared))
    pins = [f"{dists[n].metadata['Name']}=={dists[n].version}" for n in own]
    loose = [x for x in top if plugins._norm(x) not in dists]          # not on this PC: the newest + what it needs
    wd = os.path.join(tmp, arc or p["id"])
    os.makedirs(wd, exist_ok=True)
    print(f"   {p['name'] if not arc else arc}: python -m pip download ({len(pins) + len(loose)} packages)…")
    failed = _pip_download(pins, wd, deps=False) + _pip_download(loose, wd, deps=True)
    if failed:
        print(f"   (these come from the internet when installing instead: {', '.join(failed)})")
    skip = keep | (set() if names else shared)
    return [(os.path.join(wd, f), f"plugin_packs/wheels/{arc or p['id']}/{f}") for f in sorted(os.listdir(wd))
            if _wheel_dist(f) not in skip]


def write_app_zip(out, a, packs=()):
    """the app itself (Vermeil/...) + INSTALL.bat / UNINSTALL.bat; stops if a secret file got in"""
    files = [f for f in walk() if wanted(rel(f), a)]
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for i, f in enumerate(files, 1):
            r = rel(f)
            store = r.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".glb", ".onnx", ".bin", ".zip", ".exe"))
            z.write(f, "Vermeil/" + r, compress_type=zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED)
            if i % 500 == 0:
                print(f"   {i}/{len(files)} files…")
        for zp in packs:
            z.write(zp, "Vermeil/plugin_packs/" + os.path.basename(zp), compress_type=zipfile.ZIP_STORED)
        z.writestr("Vermeil/INSTALL.bat", INSTALL_BAT.replace("\n", "\r\n"))
        z.writestr("Vermeil/UNINSTALL.bat", UNINSTALL_BAT.replace("\n", "\r\n"))
        z.writestr("Vermeil/data/plugins.json", '{"fresh": true, "installed": {}}\n')
        if "Vermeil/env.example" not in z.namelist():           # the project's own env.example wins
            z.writestr("Vermeil/env.example", "# Copy this file to 'env' (no extension) and put your keys after the = signs.\n"
                                              "GROQ_API_KEY=\nWEATHER_API_KEY=\nSPOTIFY_CLIENT_ID=\nSPOTIFY_CLIENT_SECRET=\n")
    with zipfile.ZipFile(out) as z:
        bad = [n for n in z.namelist() if n.split("/")[-1] in ("env", ".env") or matches(n[len("Vermeil/"):], SECRET_FILES)]
    if bad:
        os.remove(out)
        sys.exit(f"Stopped: these secret files were about to be packed: {bad}")


def safe_name(name):
    return re.sub(r'[\\/:*?"<>|]+', "_", name).strip(" .") or "item"


def your_games():
    """(name, folder) of every game to put on Drive: the hub's own games, and the Unity build if it's on this PC"""
    sys.path.insert(0, os.path.join(ROOT, "skills"))
    import mygames
    out = [(g["name"], os.path.join(mygames.GAMES_DIR, g["folder"])) for g in mygames.list_games()["games"] if g.get("ok")]
    have = {n.lower() for n, _ in out}
    for p in mygames.SUGGEST:
        name = os.path.splitext(os.path.basename(p))[0]
        if os.path.isfile(p) and name.lower() not in have:
            out.append((name, os.path.dirname(p)))
    return out


DRIVE_HOWTO = """HOW TO INSTALL VERMEIL FROM GOOGLE DRIVE
========================================

Upload this whole Vermeil-Drive folder to Google Drive. On drive.google.com select everything in it,
right-click -> Share -> General access -> "Anyone with the link" -> Done.

ON THE OTHER PC
1. "1 - Vermeil app": download Vermeil-App.zip, right-click it -> Extract All... -> into Documents.
   Open the Vermeil folder and double-click INSTALL.bat (it installs Python if it's missing, then the app).
   (Or: put the zip's Drive link in Get-Vermeil.bat and just double-click that - it downloads and installs.)
2. Vermeil opens on Settings -> Plugins. Tick the features you want and press "Install selected": each one
   downloads its .zip from the Vermeil Google Drive folder by itself (its link is built into the app:
   DRIVE_FOLDER in brain/plugins.py). Features without a zip there get their packages from the internet.
   (The link is never shown in the app. A different folder? Change DRIVE_FOLDER in brain/plugins.py.)
3. Games: Games hub -> the up/down arrows button next to the music button -> leave the link box empty ->
   Download: every game in "3 - Games" is added. (Or download a game's .zip and use "Add from this PC".)

(Old way, still works: links.txt - paste each .zip's own share link after its = sign, then "Load links.txt".)

UNINSTALL
- One feature: Settings -> Plugins -> Uninstall (frees its space; Install brings it back from its Drive link).
- One game: Games hub -> up/down arrows button -> Remove.
- The whole app: double-click UNINSTALL.bat in the Vermeil folder (it can keep a backup of your saves and keys).

Your env file (API keys) and sign-in tokens are never in these folders: type the keys again on the new PC.
"""


def make_drive(a):
    """dist/Vermeil-Drive/: 1 - the app, 2 - a folder per feature (plugin), 3 - your games, + links.txt + HOW TO INSTALL"""
    sys.path.insert(0, os.path.join(ROOT, "brain"))
    import plugins
    out = os.path.join(DIST, "Vermeil-Drive")
    only = {x.strip() for x in (a.only if isinstance(getattr(a, "only", None), str) else "").split(",") if x.strip()}      # --only app,kitchen: just remake those
    if os.path.isdir(out) and not only:
        shutil.rmtree(out)                                    # made by this script only (inside dist/)
    app_dir, plug_dir, game_dir = (os.path.join(out, d) for d in ("1 - Vermeil app", "2 - Plugins", "3 - Games"))
    for d in (app_dir, plug_dir, game_dir):
        os.makedirs(d, exist_ok=True)

    if not only or "app" in only:
        print("1/3  The app (the big features go in their own folders)…")
        write_app_zip(os.path.join(app_dir, "Vermeil-App.zip"), a)
        shutil.copy2(make_launcher(a.url), os.path.join(app_dir, "Get-Vermeil.bat"))
        print(f"   Vermeil-App.zip: {os.path.getsize(os.path.join(app_dir, 'Vermeil-App.zip')) / 1e6:,.0f} MB")

    print("2/3  A folder per feature…")
    links = ["# Paste each feature's Google Drive link after its = sign (Share -> Anyone with the link -> Copy link).",
             "# Then in Vermeil: Settings -> Plugins -> Load links.txt.", ""]
    tmp = tempfile.mkdtemp(prefix="vermeil_wheels_")
    for i, p in enumerate(plugins.PLUGINS, 1):
        if only and p["id"] not in only:
            continue
        folder = os.path.join(plug_dir, f"{i:02d} {safe_name(p['name'])}")
        if only and os.path.isdir(folder):
            shutil.rmtree(folder)
        os.makedirs(folder)
        how = [p["name"], "=" * len(p["name"]), p["desc"], "", f"Size: {p['size']}", ""]
        pack = p.get("pack")
        name = plugins.zip_name(p)
        files = feature_files(p, a, tmp)
        if files:
            n, size = zip_paths(os.path.join(folder, f"{name}.zip"), files, name)
            print(f"   {p['name']}: {name}.zip ({n} files, {size / 1e6:,.0f} MB)")
            how.append(f"Its files: {name}.zip (this folder). Vermeil finds it by itself from the Drive folder link.")
            links.append(f"{p['id']} = ")
        elif pack:
            how.append(f"Its files ({pack}.zip) aren't on this PC, so there's no zip here.")
        if p.get("pip"):
            how += [("Its Python packages are inside the zip (installed offline; if they don't fit that PC's Python, "
                     "Install gets them from the internet): " if getattr(a, "with_wheels", False) is True else
                     "Install downloads these Python packages by itself: ") + " ".join(p["pip"]),
                    "(or run it yourself:  python -m pip install " + " ".join(p["pip"]) + ")"]
        if p.get("shared"):
            how.append("PyTorch comes from pytorch.zip (00 PyTorch) - Install downloads it by itself when it's needed.")
        if p.get("code"):
            how.append("Its own code is in the zip: Uninstall deletes it, Install downloads it again from here.")
        if p.get("files"):
            how.append("Install downloads its model files from the internet by itself.")
        if p.get("ollama"):
            how.append("Install puts Ollama inside the app (tools/ollama) and downloads the AI models.")
        if not (pack or p.get("pip") or p.get("files") or p.get("ollama") or p.get("code")):
            how.append("Built into the app (nothing to download): Install just shows it in the menu again.")
        how += ["", "Install / uninstall: Vermeil -> Settings -> Plugins."]
        with open(os.path.join(folder, "README.txt"), "w", encoding="utf-8", newline="\r\n") as f:
            f.write("\n".join(how) + "\n")

    if getattr(a, "with_wheels", False) is True:              # big packages two features share: once, in their own zip
        for name, pkgs in plugins.SHARED.items():
            if only and name not in only:
                continue
            users = [p for p in plugins.PLUGINS if name in p.get("shared", [])]
            files = feature_wheels(users[0], tmp, names=pkgs, arc=name) if users else []
            if files:
                folder = os.path.join(plug_dir, f"00 {name} (shared)")
                shutil.rmtree(folder, ignore_errors=True)
                os.makedirs(folder)
                n, size = zip_paths(os.path.join(folder, f"{name}.zip"), files, name)
                print(f"   {name} (shared by {', '.join(u['name'] for u in users)}): {name}.zip ({n} files, {size / 1e6:,.0f} MB)")
                with open(os.path.join(folder, "README.txt"), "w", encoding="utf-8", newline="\r\n") as f:
                    f.write(f"{name}.zip: {', '.join(pkgs)} for {', '.join(u['name'] for u in users)}.\n"
                            "Install downloads it by itself when one of those features needs it.\n")

    shutil.rmtree(tmp, ignore_errors=True)
    print("3/3  Your games…")
    games = your_games() if not only or "games" in only else []
    for name, src in games:
        folder = os.path.join(game_dir, safe_name(name))
        os.makedirs(folder)
        zp = os.path.join(folder, f"{safe_name(name)}.zip")
        with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for r, ds, fs in os.walk(src):
                ds[:] = [d for d in ds if not re.search(r"Do(n|No)tShip|BackUpThisFolder", d, re.I)]
                for f in fs:
                    full = os.path.join(r, f)
                    z.write(full, os.path.join(safe_name(name), os.path.relpath(full, src)))
        print(f"   {name}: {os.path.getsize(zp) / 1e6:,.0f} MB")
    if not games and not only:
        print("   (no games added yet - Games hub -> the up/down arrows button)")
    with open(os.path.join(out, "links.txt"), "w", encoding="utf-8", newline="\r\n") as f:
        f.write("\n".join(links) + "\n")
    with open(os.path.join(out, "HOW TO INSTALL.txt"), "w", encoding="utf-8", newline="\r\n") as f:
        f.write(DRIVE_HOWTO)
    total = sum(os.path.getsize(os.path.join(r, f)) for r, ds, fs in os.walk(out) for f in fs)
    print(f"\nDone! {out}  ({total / 1e6:,.0f} MB)\nUpload that whole folder to Google Drive, then read HOW TO INSTALL.txt in it.")


def main():
    ap = argparse.ArgumentParser(description="Pack Vermeil into one installer zip.")
    ap.add_argument("--with-my-data", action="store_true", help="include your chats, memory, characters, room, planner, gym...")
    ap.add_argument("--offline", action="store_true", help="include the Kokoro model and all Piper voices")
    ap.add_argument("--with-blender", action="store_true", help="include the blender/ folder")
    ap.add_argument("--with-library", action="store_true", help="include the dnd/ asset library (~7 GB)")
    ap.add_argument("--with-ollama", action="store_true", help="include tools/ollama, the offline AI program (~3 GB, no models)")
    ap.add_argument("--no-packs", action="store_true", help="skip plugin_packs (smaller; the Adventure game can't be installed)")
    ap.add_argument("--list", action="store_true", help="only show what would be packed and how big it is")
    ap.add_argument("--url", help="share link of the uploaded zip: makes dist/Get-Vermeil.bat download it by itself")
    ap.add_argument("--launcher-only", action="store_true", help="only (re)make dist/Get-Vermeil.bat (use with --url)")
    ap.add_argument("--drive", action="store_true", help="make dist/Vermeil-Drive: a folder per feature + your games, for Google Drive")
    ap.add_argument("--with-wheels", action="store_true", help="with --drive: put each feature's Python packages in its zip")
    ap.add_argument("--only", help="with --drive: remake only these (comma list of feature ids, 'app' = the app zip), keep the rest")
    a = ap.parse_args()
    if a.drive:
        make_drive(a)
        return
    if a.launcher_only:
        print(f"Launcher: {make_launcher(a.url)}")
        return
    if a.list:
        files = [f for f in walk() if wanted(rel(f), a)]
        tops = {}
        for f in files:
            top = rel(f).split("/")[0]
            tops[top] = tops.get(top, 0) + os.path.getsize(f)
        for k, v in sorted(tops.items(), key=lambda x: -x[1]):
            print(f"   {k:<22} {v / 1e6:9.1f} MB")
        print(f"   {len(files)} files, {sum(tops.values()) / 1e6:,.0f} MB (+ plugin packs)")
        return

    stamp = datetime.date.today().isoformat()
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f"Vermeil-Installer-{stamp}.zip")
    tmp_packs = os.path.join(DIST, "plugin_packs")
    os.makedirs(tmp_packs, exist_ok=True)

    print("1/3  Plugin packs (big optional features)…")
    packs = []
    if not a.no_packs:
        for name in PACKS:
            files = pack_files(name)
            if not files:
                print(f"   {name}: nothing to pack (not on this PC) - skipped")
                continue
            zp = os.path.join(tmp_packs, f"{name}.zip")
            n, size = zip_paths(zp, files, name)
            packs.append(zp)
            print(f"   {name}.zip: {n} files, {size / 1e6:.0f} MB")

    print("2/3  The app…")
    write_app_zip(out, a, packs)
    for zp in packs:
        os.remove(zp)
    try:
        os.rmdir(tmp_packs)
    except OSError:
        pass
    print("3/3  Checked: no secrets got in.")
    mb = os.path.getsize(out) / 1e6
    launcher = make_launcher(a.url)
    print(f"\nDone! {out}  ({mb:,.0f} MB)\n"
          f"Either copy it to the other PC, unzip it (e.g. into Documents), open the Vermeil folder and double-click INSTALL.bat,\n"
          f"or upload the zip (OneDrive/Google Drive, 'Anyone with the link') and send {launcher} - double-clicking it\n"
          f"downloads and installs everything." + ("" if a.url else "\n(Tip: add --url \"<link>\" so it doesn't have to ask for the link.)"))


if __name__ == "__main__":
    main()
