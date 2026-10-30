"""
backup.py - Settings -> General -> Backup: everything Vermeil saved (data/) in ONE .zip, and back again.

  make(dest, big=False)   -> {"path", "files", "mb"}   big=True also packs voices, 3D models and the Study library
  restore(zip_path)       -> {"files", "safety"}       your current data is zipped first (safety copy), then replaced

Never inside a backup: keys and sign-ins (the project's env file is not in data/ at all; Spotify's sign-in
token is skipped, so you sign in again after a restore), temporary files and caches that download again.
"""
import json
import os
import time
import zipfile

from paths import DATA_DIR

MARK = "vermeil_backup.json"                         # tells a Vermeil backup apart from any other zip
SKIP_FILES = {"spotify_token.json", "env", ".env"}
SKIP_DIRS = {"music_cache", "__pycache__"}
BIG_DIRS = {"rvc_voices", "piper_voices", "models", "library", "character_references"}


def _files(big):
    for folder, dirs, names in os.walk(DATA_DIR):
        rel_dir = os.path.relpath(folder, DATA_DIR)
        top = rel_dir.replace("\\", "/").split("/")[0]
        if top in SKIP_DIRS or (not big and top in BIG_DIRS):
            dirs[:] = []
            continue
        for n in names:
            if n in SKIP_FILES or n.endswith((".tmp", ".part", ".lock")):
                continue
            yield os.path.join(folder, n), os.path.normpath(os.path.join(rel_dir, n)).replace("\\", "/")


def make(dest, big=False):
    count = 0
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    tmp = dest + ".part"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
        for full, rel in _files(big):
            try:
                z.write(full, "data/" + rel)
                count += 1
            except OSError:
                pass                                     # a file in use: skip it
        z.writestr(MARK, json.dumps({"made": time.strftime("%Y-%m-%d %H:%M"), "files": count, "big": bool(big)}))
    os.replace(tmp, dest)
    return {"path": dest, "files": count, "mb": round(os.path.getsize(dest) / 1048576, 1)}


def restore(zip_path):
    if not zipfile.is_zipfile(zip_path):
        return {"error": "That isn't a .zip file."}
    with zipfile.ZipFile(zip_path) as z:
        if MARK not in z.namelist():
            return {"error": "That zip isn't a Vermeil backup."}
        members = [m for m in z.infolist() if m.filename.startswith("data/") and not m.is_dir()]
        root = os.path.realpath(DATA_DIR)
        for m in members:                                 # nothing may land outside data/
            target = os.path.realpath(os.path.join(DATA_DIR, m.filename[5:]))
            if not target.startswith(root + os.sep) or os.path.basename(target) in SKIP_FILES:
                return {"error": "That backup has a file in the wrong place, so it wasn't used."}
        safety = os.path.join(DATA_DIR, "..", "backups", f"before-restore-{time.strftime('%Y%m%d-%H%M%S')}.zip")
        safety = make(os.path.normpath(safety))["path"]
        for m in members:
            target = os.path.join(DATA_DIR, *m.filename[5:].split("/"))
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(m) as src, open(target + ".tmp", "wb") as out:
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
            os.replace(target + ".tmp", target)
    return {"files": len(members), "safety": safety}
