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

On the other PC: unzip it anywhere (e.g. Documents/Vermeil) and double-click INSTALL.bat.
The installer sets up Python packages, makes a desktop shortcut and opens Vermeil on Settings -> Plugins,
where you tick the features you want.

NEVER packed: your env file (API keys) and login tokens (Spotify, Google, YouTube cookies). The installer makes an
empty env for you to fill in. Big optional features go in plugin_packs/ (installed from Settings -> Plugins).
"""
import argparse
import datetime
import fnmatch
import os
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
PACKS = {"game_assets": ["ui/game/assets"], "ffmpeg": ["Packages/ffmpeg-8.0-full_build/bin/ffplay.exe"]}
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
    n, size = 0, 0
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in files:
            r = rel(f)
            store = r.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".glb", ".onnx", ".bin", ".zip", ".exe", ".ogg", ".mp3"))
            z.write(f, r, compress_type=zipfile.ZIP_STORED if store else zipfile.ZIP_DEFLATED)
            n += 1
            size += os.path.getsize(f)
            if n % 500 == 0:
                print(f"   {label}: {n} files…")
    return n, size


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
    a = ap.parse_args()
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
        for name, paths in PACKS.items():
            files = []
            for p in paths:
                full = os.path.join(ROOT, *p.split("/"))
                if os.path.isfile(full):
                    files.append(full)
                elif os.path.isdir(full):
                    files += [os.path.join(r, f) for r, ds, fs in os.walk(full) for f in fs if "__pycache__" not in r]
            if not files:
                print(f"   {name}: nothing to pack (not on this PC) - skipped")
                continue
            zp = os.path.join(tmp_packs, f"{name}.zip")
            n, size = zip_paths(zp, files, name)
            packs.append(zp)
            print(f"   {name}.zip: {n} files, {size / 1e6:.0f} MB")

    print("2/3  The app…")
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
        z.writestr("Vermeil/data/plugins.json", '{"fresh": true, "installed": {}}\n')
        z.writestr("Vermeil/env.example", "# Copy this file to 'env' (no extension) and put your keys after the = signs.\n"
                                          "GROQ_API_KEY=\nWEATHER_API_KEY=\nSPOTIFY_CLIENT_ID=\nSPOTIFY_CLIENT_SECRET=\n")
    for zp in packs:
        os.remove(zp)
    try:
        os.rmdir(tmp_packs)
    except OSError:
        pass

    print("3/3  Checking that no secrets got in…")
    with zipfile.ZipFile(out) as z:
        bad = [n for n in z.namelist() if n.split("/")[-1] in ("env", ".env") or matches(n[len("Vermeil/"):], SECRET_FILES)]
    if bad:
        os.remove(out)
        sys.exit(f"Stopped: these secret files were about to be packed: {bad}")
    mb = os.path.getsize(out) / 1e6
    launcher = make_launcher(a.url)
    print(f"\nDone! {out}  ({mb:,.0f} MB)\n"
          f"Either copy it to the other PC, unzip it (e.g. into Documents), open the Vermeil folder and double-click INSTALL.bat,\n"
          f"or upload the zip (OneDrive/Google Drive, 'Anyone with the link') and send {launcher} - double-clicking it\n"
          f"downloads and installs everything." + ("" if a.url else "\n(Tip: add --url \"<link>\" so it doesn't have to ask for the link.)"))


if __name__ == "__main__":
    main()
