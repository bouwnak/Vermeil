"""
plugins.py - Settings -> Plugins: install only the features you want, uninstall the ones you don't (to free space).

Each plugin is one feature. Installing it can:
  - pip-install the Python packages it needs      (python -m pip install ...)
  - download its model files                      (Kokoro voice, face/object models...)
  - unpack its files from its zip                 (plugin_packs/<zip_name>.zip, made by scripts/package_app.py)
    - or download that zip from Google Drive first: paste the Vermeil Drive FOLDER link once (Settings -> Plugins) and
      every feature finds its own zip in it (links kept in data/plugin_links.json). A zip can hold the feature's
      folders, its model files, the Ollama program and its Python packages (plugin_packs/wheels/<id>/, installed offline)
  - pull local AI models                          (ollama pull ...)
  - show its menu entries again
Uninstalling does the opposite: removes its files, pip-uninstalls packages no other installed plugin needs, and hides its menu.
Files that can't be brought back (no download link and no installer pack) are only deleted when you confirm.

What's installed is saved in data/plugins.json. A fresh install (from the installer) starts with {"fresh": true}, so the app
opens Settings -> Plugins the first time. On a PC with no plugins.json, every feature whose files are present counts as installed.
"""
import filecmp
import importlib.metadata
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import zipfile

import requests

from paths import data_file

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = data_file("plugins.json")
LINKS_FILE = data_file("plugin_links.json")      # plugin id -> Google Drive link of its pack (see scripts/package_app.py --drive)
# the Vermeil Google Drive folder (shared as "Anyone with the link"): every feature's zip is looked up here by itself.
# A folder pasted in Settings -> Plugins ("_folder" in plugin_links.json) is used instead.
DRIVE_FOLDER = "https://drive.google.com/drive/folders/1J3qV6WX3p_DCdKtG_b0H8rUB6LYcaZtk"
FOLDER_CACHE_S = 600                             # re-read the folder at most every 10 minutes
PACKS = os.path.join(BASE, "plugin_packs")
OPENCV_ZOO = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
KOKORO = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
RVC_HF = "https://huggingface.co/"

# packages every install has (never uninstalled)
CORE_PIP = ["requests", "pywebview", "numpy", "rapidfuzz", "vaderSentiment", "keyboard", "psutil", "pillow", "winotify",
            "sounddevice", "soundfile", "piper-tts", "pycaw", "comtypes"]

# pip name -> import name (to check if it's installed)
IMPORT_NAME = {"faster-whisper": "faster_whisper", "SpeechRecognition": "speech_recognition", "PyAudio": "pyaudio",
               "kokoro-onnx": "kokoro_onnx", "edge-tts": "edge_tts", "opencv-python": "cv2", "pypdf": "pypdf",
               "python-docx": "docx", "python-pptx": "pptx", "openpyxl": "openpyxl", "yt-dlp": "yt_dlp",
               "google-api-python-client": "googleapiclient", "google-auth-oauthlib": "google_auth_oauthlib",
               "playwright": "playwright", "sympy": "sympy", "moviepy": "moviepy",
               "faiss-cpu": "faiss", "chatterbox-tts": "chatterbox"}

PLUGINS = [
    {"id": "voice_commands", "builtin": True, "name": "Voice commands", "icon": "🎙", "group": "Voice",
     "desc": "Talk to her: wake word 'vermi', speech recognition (Whisper, offline), noise filter.",
     "pip": ["faster-whisper", "SpeechRecognition", "PyAudio"], "panels": [], "size": "~150 MB + Whisper model on first use"},
    {"id": "kokoro", "builtin": True, "name": "Kokoro voice (online mode)", "icon": "🗣", "group": "Voice",
     "desc": "Her natural Kokoro voice while the AI is online (and the adventure's voices). Offline she uses Piper.",
     "pip": ["kokoro-onnx"], "files": [{"path": "tools/kokoro/kokoro-v1.0.onnx", "url": KOKORO + "kokoro-v1.0.onnx"},
                                       {"path": "tools/kokoro/voices-v1.0.bin", "url": KOKORO + "voices-v1.0.bin"}],
     "panels": [], "size": "~340 MB"},
    {"id": "emotional_voice", "builtin": True, "name": "Emotional voice (Chatterbox)", "icon": "🎭", "group": "Voice",
     "desc": "She laughs, sighs and sounds happy, sad or scared (English). Fast with an NVIDIA graphics card. "
             "The voice model (~3 GB) downloads the first time it's used.",
     "pip": ["chatterbox-tts"], "shared": ["pytorch"], "panels": [], "size": "~3.5 GB (with the model)"},
    {"id": "voice_clone", "builtin": True, "name": "Voice clones (RVC)", "icon": "🧬", "group": "Voice",
     "desc": "Makes her sound like a character from an RVC voice model (.pth). Its helper models are in tools/rvc.",
     "pip": ["torch", "torchaudio", "scipy", "librosa", "faiss-cpu"], "shared": ["pytorch"], "pack": "rvc_models",
     # the helper models themselves (a copy from GitHub has the tools/rvc folder but not these) + the characters' voices
     "files": [{"path": "tools/rvc/vec-768-layer-12.onnx", "url": RVC_HF + "NaruseMioShirakana/MoeSS-SUBModel/resolve/main/vec-768-layer-12.onnx"},
               {"path": "tools/rvc/rmvpe.pt", "url": RVC_HF + "lj1995/VoiceConversionWebUI/resolve/main/rmvpe.pt"}],
     "folders": ["data/rvc_voices"],
     "panels": [], "size": "~3 GB (PyTorch) + 530 MB"},
    {"id": "unimate", "builtin": True, "name": "UniMate animations", "icon": "🎬", "group": "Fun",
     "desc": "Rig & animate: makes walk / wave / dance animations from words. After installing, double-click "
             "scripts\\setup_unimate.bat once (it makes UniMate's own Python, ~2 GB).",
     "folders": ["tools/unimate"], "pack": "unimate", "panels": [], "size": "~1.2 GB + 2 GB setup"},
    {"id": "online_voices", "builtin": True, "name": "Voices for other languages", "icon": "🌏", "group": "Voice",
     "desc": "Japanese, Korean, Filipino, Thai... voices (Microsoft online voices).", "pip": ["edge-tts"], "panels": [], "size": "~1 MB"},
    {"id": "camera", "builtin": True, "name": "Camera: faces and objects", "icon": "📷", "group": "Seeing",
     "desc": "Recognises your face and people you know, spots everyday objects, attention for Focus.",
     "pip": ["opencv-python"], "files": [
         {"path": "data/models/face_detection_yunet_2023mar.onnx", "url": OPENCV_ZOO + "face_detection_yunet/face_detection_yunet_2023mar.onnx"},
         {"path": "data/models/face_recognition_sface_2021dec.onnx", "url": OPENCV_ZOO + "face_recognition_sface/face_recognition_sface_2021dec.onnx"},
         {"path": "data/models/object_detection_nanodet_2022nov.onnx", "url": OPENCV_ZOO + "object_detection_nanodet/object_detection_nanodet_2022nov.onnx"}],
     "panels": [], "size": "~140 MB"},
    {"id": "local_ai", "builtin": True, "name": "Offline AI (Ollama)", "icon": "🧠", "group": "AI",
     "desc": "She still answers without internet. Ollama is put inside the app's tools/ollama folder and started by Vermeil "
             "herself (hidden) - no separate app to open. Then the AI models are downloaded.",
     "ollama": True, "panels": [], "size": "~1-3 GB program + 5-11 GB models"},
    {"id": "music", "name": "Vermeil Music", "icon": "🎵", "group": "Music",
     "desc": "Your own Spotify-style music app: search, your playlists, Liked Songs, import, Playlist Lab. Songs from YouTube, played with ffplay.",
     "pip": ["yt-dlp"], "folders": ["Packages/ffmpeg-8.0-full_build"], "pack": "ffmpeg", "panels": ["music"], "size": "~20 MB (+190 MB ffplay)"},
    {"id": "spotify", "name": "Spotify", "icon": "🟢", "group": "Music", "desc": "Spotify panel and voice control.",
     "code": ["ui/spotify.js"], "panels": ["spotify"], "size": "tiny"},
    {"id": "study", "name": "Study", "icon": "📚", "group": "Features", "desc": "Read your PDFs, Word and PowerPoint files; quizzes and research.",
     "pip": ["pypdf", "python-docx", "python-pptx", "sympy"], "panels": ["study"], "size": "~60 MB"},
    {"id": "gym", "name": "Gym", "icon": "🏋", "group": "Features", "desc": "Workout, timer, alternatives finder, Excel import.",
     "pip": ["openpyxl"], "panels": ["gym"], "size": "~10 MB"},
    {"id": "kitchen", "name": "Cooking & Baking", "icon": "🍳", "group": "Features", "desc": "Recipe books, converter, kitchen timer.",
     "code": ["skills/baking.py", "ui/baking.js"], "panels": ["kitchen"], "size": "tiny"},
    {"id": "electronics", "name": "Robotics & Electronics lab", "icon": "🤖", "group": "Features",
     "desc": "Repair and repurpose old electronics, formulas, robot plans and a 2D/3D circuit simulator.",
     "code": ["skills/electronics.py", "ui/electronics.js"] + [f"ui/electronics/{f}" for f in ("lab.html", "lab.js", "lab.css", "parts.js", "sim.js", "view2d.js", "view3d.js")], "panels": ["electronics"], "size": "tiny"},
    {"id": "adventure", "name": "Games (Adventure + retro games)", "icon": "🐉", "group": "Fun",
     "desc": "The Games hub: the 3D RPG with your companion, plus classic retro games. Its 3D models are the big part.", "folders": ["ui/game/assets"], "pack": "game_assets",
     "panels": ["adventure"], "size": "~780 MB"},
    {"id": "calendar", "builtin": True, "name": "Google Calendar (add events)", "icon": "📅", "group": "Planner", "desc": "Lets her add/remove events in Google Calendar.",
     "pip": ["google-api-python-client", "google-auth-oauthlib"], "panels": [], "size": "~40 MB"},
    {"id": "browser", "builtin": True, "name": "Browser helper", "icon": "🌐", "group": "PC", "desc": "Her own browser window to read pages and fill forms.",
     "pip": ["playwright"], "panels": [], "size": "~45 MB"},
    {"id": "missions", "name": "Missions", "icon": "🎯", "group": "Features", "desc": "Bigger goals done step by step in the background.", "code": ["brain/missions.py", "ui/missions.js"], "panels": ["missions"], "size": "tiny"},
    {"id": "focus", "name": "Focus & Progress", "icon": "⏱", "group": "Features", "desc": "Focus sessions and your trends.", "code": ["skills/focus.py", "ui/focus.js"], "panels": ["focus"], "size": "tiny"},
    {"id": "mind", "name": "Journal & Think", "icon": "💭", "group": "Features", "desc": "Decisions, ideas, goals, thinking tools.", "code": ["ui/mind.js"], "panels": ["mind"], "size": "tiny"},
    {"id": "code", "name": "Coding helper", "icon": "💻", "group": "Features", "desc": "Writes and edits code in your project folders.", "code": ["brain/coder.py", "ui/code.js"], "panels": ["code"], "size": "tiny"},
    {"id": "planner", "name": "Planner", "icon": "🗓", "group": "Features", "desc": "Your tasks, reminders and calendar on one page (reminders still work in the chat without it).",
     "code": ["ui/planner.js"], "panels": ["planner"], "size": "tiny"},
    {"id": "generator", "name": "Generator", "icon": "🎨", "group": "Features", "desc": "Pictures, presentations (.pptx) and narrated videos (.mp4) from a topic or your PDFs.",
     "pip": ["python-pptx", "moviepy"], "code": ["skills/generator.py", "ui/generator.js"], "panels": ["generator"], "size": "~45 MB"},
]
BY_ID = {p["id"]: p for p in PLUGINS}
# "builtin": parts of the app itself (voices, camera, offline AI...), not sidebar features: Settings -> Plugins doesn't
# list them, they can't be uninstalled, and setup_builtins() (run by skills/autosetup.py) gets whatever they miss
# from the Vermeil Drive folder by itself. Only the sidebar features are plugins.
FEATURES = [p for p in PLUGINS if not p.get("builtin")]

_jobs = {}            # plugin id -> {"state": "running"|"done"|"error", "log": [...]}
on_event = None       # app.py: shows progress in the window


# ------------------------------------------------------------------ state
def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save(d):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2)
    os.replace(tmp, STATE_FILE)


def _abs(rel):
    return os.path.join(BASE, *rel.split("/"))


def has_module(pip_name):
    try:
        if importlib.util.find_spec(IMPORT_NAME.get(pip_name, pip_name.replace("-", "_"))) is not None:
            return True
    except (ImportError, ValueError):
        pass
    try:                                  # its import name differs from the pip name: ask pip's own records
        importlib.metadata.version(pip_name)
        return True
    except importlib.metadata.PackageNotFoundError:
        return False


# ------------------------------------------------------------------ a feature's own Python packages
# Uninstall removes a feature's packages AND what they pulled in (unless the core or another installed feature
# still needs it); its zip on Drive holds the same set as wheels (scripts/package_app.py --drive --with-wheels).
ALSO_KEEP = ["scipy", "huggingface_hub", "onnxruntime",   # the app's own code uses these (voice shaping, model downloads)
             "pip", "setuptools", "wheel"]               # Python's own install tools
SHARED = {"pytorch": ["torch", "torchaudio"]}             # big packages two features share: their own zip on Drive


def _norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


_dist_cache = {}      # the installed packages, read once (reading their metadata is slow); _pip() clears it


def _dists():
    if not _dist_cache:
        for d in importlib.metadata.distributions():
            meta = d.metadata
            if meta["Name"]:
                d.req_names = [_norm(m.group(1)) for r in meta.get_all("Requires-Dist") or []
                               if "extra ==" not in r for m in [re.match(r"\s*([A-Za-z0-9_.-]+)", r)] if m]
                _dist_cache[_norm(meta["Name"])] = d
    return dict(_dist_cache)


def _requires(d):
    return d.req_names


def _tree(names, dists):
    """these packages and everything they need (only the installed ones)"""
    seen, todo = set(), [_norm(n) for n in names]
    while todo:
        n = todo.pop()
        if n in seen or n not in dists:
            continue
        seen.add(n)
        todo += _requires(dists[n])
    return seen


def keep_pip():
    """packages the app itself needs: never removed with a feature"""
    feature = {_norm(x) for p in FEATURES for x in p.get("pip", [])}
    names = CORE_PIP + ALSO_KEEP + [x for p in PLUGINS if p.get("builtin") for x in p.get("pip", [])]
    try:
        with open(os.path.join(BASE, "requirements.txt"), encoding="utf-8") as f:
            for line in f:
                m = re.match(r"\s*([A-Za-z0-9_.-]+)", line)
                if m and not line.lstrip().startswith("#") and _norm(m.group(1)) not in feature:
                    names.append(m.group(1))
    except OSError:
        pass
    return names


def own_packages(p, dists=None, installed=None):
    """the installed packages only this feature uses (not the core's, not another installed feature's)"""
    dists = dists if dists is not None else _dists()
    installed = installed if installed is not None else {q["id"] for q in PLUGINS if is_installed(q["id"])}
    keep = _tree(keep_pip(), dists)
    keep |= _tree([x for q in PLUGINS if q["id"] != p["id"] and q["id"] in installed for x in q.get("pip", [])], dists)
    return sorted(_tree(p.get("pip", []), dists) - keep)


_pkg_mb = {}          # (name, version) -> bytes, from its RECORD list (reading it is fast; checking each file isn't)


def _pkgs_size(names, dists):
    total = 0
    for n in names:
        key = (n, dists[n].version)
        if key not in _pkg_mb:
            size = 0
            for line in (dists[n].read_text("RECORD") or "").splitlines():
                last = line.rsplit(",", 1)[-1]
                size += int(last) if last.isdigit() else 0
            _pkg_mb[key] = size
        total += _pkg_mb[key]
    return total


OLLAMA_ZIP = "https://github.com/ollama/ollama/releases/latest/download/ollama-windows-amd64.zip"


def _ollama():
    import llm
    return llm.ollama_exe()            # tools/ollama/ollama.exe first, then a normal Ollama install


def _ollama_models():
    try:
        import llm
        return sorted(set(llm.models().values()))
    except Exception:
        return ["qwen3:8b", "qwen2.5vl:7b"]


# a feature's own code files ("code": Spotify, Cooking, Missions...) live only in its zip on Drive, like big folders.
# In the project folder you build from (it has _archive/), Uninstall first copies them to _archive/plugin_code/<id>/,
# and Install keeps that copy when it differs from the Drive one - so your newest code is never lost.


def _code(p):
    return [_abs(c) for c in p.get("code", [])]


def _needs_zip(p):
    """does it have files that only come from its zip? (big folders, or its own code)"""
    return bool(p.get("folders") or p.get("code"))


def _backup_dir(p):
    return os.path.join(BASE, "_archive", "plugin_code", p["id"])


def _backup_code(p):
    if not p.get("code") or not os.path.isdir(os.path.join(BASE, "_archive")):
        return
    for rel_path, path in zip(p["code"], _code(p)):
        if os.path.isfile(path):
            dest = os.path.join(_backup_dir(p), *rel_path.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(path, dest)


def _restore_code(p, pid):
    """after Install: a backed-up copy of its code that differs from what came from Drive wins (it's your newer code)"""
    b = _backup_dir(p)
    if not os.path.isdir(b):
        return
    kept = []
    for rel_path, path in zip(p["code"], _code(p)):
        src = os.path.join(b, *rel_path.split("/"))
        if os.path.isfile(src) and (not os.path.isfile(path) or not filecmp.cmp(src, path, shallow=False)):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            shutil.copy2(src, path)
            kept.append(rel_path)
    if kept:
        _log(pid, "Kept your own newer copy of: " + ", ".join(kept))
    shutil.rmtree(b, ignore_errors=True)


def _present(p):
    """are this plugin's files/packages here? (used when there's no saved state yet)"""
    if any(not has_module(x) for x in p.get("pip", [])):
        return False
    if any(not os.path.exists(c) for c in _code(p)):
        return False
    if any(not os.path.exists(_abs(f["path"])) for f in p.get("files", [])):
        return False
    if any(not os.path.isdir(_abs(d)) for d in p.get("folders", [])):
        return False
    return True


def _size(p):
    total = 0
    paths = [_abs(f["path"]) for f in p.get("files", [])] + [_abs(d) for d in p.get("folders", [])] + _code(p) + \
            ([_abs("tools/ollama")] if p.get("ollama") else [])
    for path in paths:
        if os.path.isfile(path):
            total += os.path.getsize(path)
        elif os.path.isdir(path):
            for root, _dirs, files in os.walk(path):
                for f in files:
                    try:
                        total += os.path.getsize(os.path.join(root, f))
                    except OSError:
                        pass
    return total


def zip_name(p):
    """the name of a feature's zip in plugin_packs/ and on Google Drive (without .zip)"""
    return p.get("pack") or p["id"]


def _pack_path(p):
    return os.path.join(PACKS, zip_name(p) + ".zip")


def _wheels(pid):
    return os.path.join(PACKS, "wheels", pid)


def links():
    try:
        with open(LINKS_FILE, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def set_link(pid, url):
    """remember the Google Drive link of a plugin's pack (empty = forget it)"""
    if pid not in BY_ID:
        return {"error": "Unknown feature."}
    url = (url or "").strip()
    if url:
        import gdrive
        try:
            gdrive.direct_url(url)
        except ValueError as e:
            return {"error": str(e)}
    d = links()
    if url:
        d[pid] = url
    else:
        d.pop(pid, None)
    os.makedirs(os.path.dirname(LINKS_FILE), exist_ok=True)
    with open(LINKS_FILE, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=1)
    return {"ok": True}


def import_links(text):
    """links.txt from the Drive folder ('voice_clone = https://drive...' per line) -> saved links. Returns how many."""
    n = 0
    for line in (text or "").splitlines():
        m = line.split("=", 1)
        if len(m) == 2 and m[0].strip() in BY_ID and m[1].strip().lower().startswith("http"):
            if set_link(m[0].strip(), m[1].strip()).get("ok"):
                n += 1
    return n


_folder_files = {"at": 0, "url": "", "files": None}
_folder_lock = threading.Lock()


def folder_link():
    return links().get("_folder") or DRIVE_FOLDER


def folder_files(refresh=False):
    """what's in the Vermeil Drive folder (read at most every 10 minutes; [] when it can't be read)"""
    import time
    import gdrive
    url = folder_link()
    with _folder_lock:
        c = _folder_files
        if not refresh and c["files"] is not None and c["url"] == url and time.time() - c["at"] < FOLDER_CACHE_S:
            return c["files"]
        try:
            files = gdrive.list_folder(url)
        except Exception as e:
            print(f"[plugins] couldn't read the Drive folder: {e}")
            files = c["files"] if c["url"] == url and c["files"] is not None else []
        c.update(at=time.time(), url=url, files=files)
        return files


def _cached_zip(p):
    """its zip in the last read of the Drive folder (no internet), or None"""
    files = _folder_files["files"] if _folder_files["url"] == folder_link() else None
    want = zip_name(p).lower() + ".zip"
    return next((f for f in files or [] if f["name"].lower() == want), None)


def _link_for(p):
    """the Drive link of a feature's zip: saved, or found in the Vermeil Drive folder (and then saved)"""
    url = links().get(p["id"])
    if url:
        return url
    folder_files()
    f = _cached_zip(p)
    if f and set_link(p["id"], f["url"]).get("ok"):
        return f["url"]
    return None


def warm_folder():
    """read the Drive folder in the background (so Settings -> Plugins knows which features are on Drive);
    the window is told to redraw when it's done"""
    if _folder_files["files"] is not None and _folder_files["url"] == folder_link() or _folder_lock.locked():
        return
    def run():
        folder_files()
        if on_event:
            try:
                on_event({"type": "plugin", "id": "_folder", "state": "running", "text": "Read the Vermeil Drive folder."})
            except Exception:
                pass
    threading.Thread(target=run, daemon=True).start()


def use_folder(url, _files=None):
    """the whole Vermeil Google Drive folder (shared as 'Anyone with the link'): finds each feature's <pack>.zip inside
    it and saves its link. Returns {count, found: [names], missing: [names], games: [zip names]} or {error}."""
    import gdrive
    try:
        files = _files if _files is not None else gdrive.list_folder(url)
    except (ValueError, RuntimeError, requests.RequestException) as e:
        return {"error": str(e)}
    by_name = {}
    for f in files:
        by_name.setdefault(f["name"].lower(), f)
    found, missing = [], []
    for p in PLUGINS:
        f = by_name.get(zip_name(p).lower() + ".zip")
        if f and set_link(p["id"], f["url"]).get("ok"):
            found.append(p["name"])
        elif _needs_zip(p) and not os.path.exists(_pack_path(p)):
            missing.append(p["name"])
    d = links()
    d["_folder"] = url.strip()
    with open(LINKS_FILE, "w", encoding="utf-8") as fh:
        json.dump(d, fh, indent=1)
    games = [f["name"] for f in files if "games" in f["path"].lower() and f["name"].lower().endswith(".zip")]
    return {"count": len(found), "found": found, "missing": missing, "games": games}


def _has_pack(p):
    return os.path.exists(_pack_path(p)) or bool(links().get(p["id"])) or bool(_cached_zip(p))


def is_installed(pid):
    if BY_ID.get(pid, {}).get("builtin"):
        return True                                      # part of the app (setup_builtins() gets what it misses)
    st = _load().get("installed", {})
    if pid in st:
        return bool(st[pid])
    p = BY_ID.get(pid)
    return bool(p) and (_present(p) if (p.get("pip") or p.get("files") or _needs_zip(p)) else True)


def status():
    d = _load()
    dists = _dists()
    installed = {p["id"] for p in PLUGINS if is_installed(p["id"])}
    out = []
    for p in FEATURES:
        pack = _pack_path(p)
        missing_pip = [x for x in p.get("pip", []) if not has_module(x)]
        used = _size(p) + (_pkgs_size(own_packages(p, dists, installed), dists) if p.get("pip") else 0)
        out.append({"id": p["id"], "name": p["name"], "icon": p["icon"], "group": p["group"], "desc": p["desc"], "size": p["size"],
                    "installed": is_installed(p["id"]), "used_mb": round(used / 1e6, 1), "missing_pip": missing_pip,
                    "pip_command": f"python -m pip install {' '.join(p['pip'])}" if p.get("pip") else "",
                    "pack": bool(pack and os.path.exists(pack)), "pack_mb": round(os.path.getsize(pack) / 1e6, 1) if pack and os.path.exists(pack) else 0,
                    "restorable": restorable(p), "needs_ollama": False, "zip": zip_name(p),
                    "on_drive": bool(links().get(p["id"]) or _cached_zip(p)),      # yes/no only: the link itself stays private
                    "needs_pack": bool(_needs_zip(p) and not _present(p) and not (pack and os.path.exists(pack))),
                    "busy": _jobs.get(p["id"], {}).get("state") == "running", "log": _jobs.get(p["id"], {}).get("log", [])[-6:],
                    "pct": _jobs.get(p["id"], {}).get("pct", 0), "step": _jobs.get(p["id"], {}).get("step", ""),
                    "error": _jobs.get(p["id"], {}).get("error", "")})
    return {"plugins": out, "fresh": bool(d.get("fresh")), "hidden_panels": hidden_panels()}


def hidden_panels():
    """menu entries of plugins that aren't installed"""
    return sorted({k for p in PLUGINS if not is_installed(p["id"]) for k in p.get("panels", [])})


def restorable(p):
    """can its files be brought back after uninstalling? (download links or an installer pack)"""
    if _needs_zip(p) and not _has_pack(p) and not os.path.isdir(_backup_dir(p)):
        return False
    return True


def finish_first_run():
    d = _load()
    d["fresh"] = False
    for p in PLUGINS:
        d.setdefault("installed", {}).setdefault(p["id"], is_installed(p["id"]))
    _save(d)
    return status()


# ------------------------------------------------------------------ install / uninstall
def _log(pid, text, pct=None, step=None):
    """one line of a feature's install log; pct (0-100) + step (short words) drive its progress bar"""
    import gdrive
    text = gdrive.hide_links(text)                       # the Drive folder link never shows on screen
    j = _jobs.setdefault(pid, {"state": "running", "log": []})
    j["log"].append(text)
    if pct is not None:
        j["pct"] = max(0, min(100, int(pct)))
    if step is not None or pct is not None:
        j["step"] = step or text.strip()
    if text.startswith("❌"):
        j["error"] = text[1:].strip()
    print(f"[plugin {pid}] {text}")
    if _progress_hook:
        _progress_hook(pid, j.get("pct", 0), j.get("step", ""))
    if on_event:
        try:
            on_event({"type": "plugin", "id": pid, "state": j["state"], "text": text, "pct": j.get("pct", 0), "step": j.get("step", "")})
        except Exception:
            pass


_progress_hook = None          # setup_builtins(): forwards each step to the automatic setup's progress


def _pip(args, pid, pct=None):
    cmd = [sys.executable, "-m", "pip"] + args
    _log(pid, "Running: python -m pip " + " ".join(args), pct,
         "Removing its Python packages…" if args[0] == "uninstall" else "Installing its Python packages…")
    r = subprocess.run(cmd, capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    _dist_cache.clear()                                  # the installed packages changed
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "pip failed").strip().splitlines()[-1][:300])


def _download(url, dest, pid, pct=(80, 95)):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    _log(pid, f"Downloading {os.path.basename(dest)}…", pct[0])
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        total, done, last = int(r.headers.get("content-length") or 0), 0, 0
        with open(dest + ".part", "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total and done * 100 // total >= last + 20:
                    last = done * 100 // total
                    _log(pid, f"  {os.path.basename(dest)}: {last}%", pct[0] + (pct[1] - pct[0]) * last / 100,
                         f"Downloading {os.path.basename(dest)}… {last}%")
    os.replace(dest + ".part", dest)


def _unpack(p, pid):
    pack = _pack_path(p)
    _log(pid, f"Unpacking {os.path.basename(pack)}…", 62)
    with zipfile.ZipFile(pack) as z:
        for m in z.infolist():
            target = os.path.realpath(os.path.join(BASE, m.filename))
            if not target.startswith(os.path.realpath(BASE) + os.sep):      # never write outside the app folder
                continue
            z.extract(m, BASE)


def _set(pid, on):
    d = _load()
    d.setdefault("installed", {})[pid] = bool(on)
    _save(d)


def install(pid):
    """starts installing in the background; progress arrives as {'type': 'plugin'} events."""
    p = BY_ID.get(pid)
    if not p:
        return {"error": "Unknown plugin."}
    if p.get("builtin"):
        return {"message": f"{p['name']} is part of Vermeil: it sets itself up by itself."}
    if _jobs.get(pid, {}).get("state") == "running":
        return {"message": f"{p['name']} is already installing."}
    if _needs_zip(p) and not _present(p) and not os.path.exists(_pack_path(p)):
        _link_for(p)                                     # look in the Vermeil Drive folder first
    if _needs_zip(p) and not _present(p) and not _has_pack(p) and not os.path.isdir(_backup_dir(p)):
        return {"error": f"{p['name']} needs its files: paste your Vermeil Google Drive folder link (or the link of "
                         f"{zip_name(p)}.zip under it) in Settings → Plugins, "
                         f"or copy that file into the plugin_packs folder, then press Install again."}
    _jobs[pid] = {"state": "running", "log": []}
    threading.Thread(target=_install, args=(p,), daemon=True).start()
    return {"message": f"Installing {p['name']}…", "started": True}


_install_lock = threading.Lock()      # one install at a time (two pips at once can break each other)


def _install(p):
    pid = p["id"]
    _log(pid, "Waiting for the other installs…" if _install_lock.locked() else "Starting…", 1)
    with _install_lock:
        _install_now(p)


def _fetch_pack(p, pid):
    """download the feature's zip from its Google Drive link into plugin_packs/"""
    import gdrive
    _log(pid, f"Downloading {zip_name(p)}.zip from Google Drive…", 3)
    last = [0]
    def said(f, text):
        if f >= last[0] + 0.05:
            last[0] = f
            _log(pid, "  " + text, 3 + 57 * f, f"Downloading {zip_name(p)}.zip… {round(f * 100)}%")
    os.makedirs(PACKS, exist_ok=True)
    gdrive.download(_link_for(p), _pack_path(p), said)
    if not zipfile.is_zipfile(_pack_path(p)):
        os.remove(_pack_path(p))
        raise RuntimeError("the Google Drive link didn't give a .zip - check the link (Share → Anyone with the link)")


def _fetch_shared(name, pid):
    """a shared zip (e.g. pytorch.zip: PyTorch for the two voice features) from the Drive folder -> its wheels folder"""
    import gdrive
    folder_files()
    f = next((x for x in _folder_files["files"] or [] if x["name"].lower() == name + ".zip"), None)
    if not f:
        return None
    zp = os.path.join(PACKS, name + ".zip")
    _log(pid, f"Downloading {name}.zip from Google Drive…", 64, f"Downloading {name}.zip (PyTorch, big)…")
    os.makedirs(PACKS, exist_ok=True)
    gdrive.download(f["url"], zp, lambda fr, text: None)
    try:
        _unpack({"pack": name, "id": name}, pid)
    finally:
        os.remove(zp)
    return _wheels(name)


def _files_missing(p):
    return (any(not os.path.exists(_abs(f["path"])) for f in p.get("files", []))
            or any(not os.path.isdir(_abs(d)) for d in p.get("folders", []))
            or any(not os.path.exists(c) for c in _code(p))
            or bool(p.get("ollama")) and not _ollama())       # in tools/ollama or a normal Ollama install


def _install_now(p):
    pid = p["id"]
    try:
        need = [x for x in p.get("pip", []) if not has_module(x)]
        if (need or _files_missing(p)) and not os.path.exists(_pack_path(p)):
            _link_for(p)                                 # its zip in the Vermeil Drive folder, if it's there
        # 1. its zip (from plugin_packs/, or downloaded from your Google Drive folder): folders, models, packages
        from_drive = False
        if (need or _files_missing(p)) and _has_pack(p):
            if not os.path.exists(_pack_path(p)):
                _fetch_pack(p, pid)
                from_drive = True
            _unpack(p, pid)
        # 2. Python packages: from the zip's wheels (+ a shared zip like pytorch.zip) if it had them, else the internet
        if need:
            wheels = [w for w in [_wheels(pid)] if os.path.isdir(w)]
            for s in p.get("shared", []):
                if wheels and any(not has_module(x) for x in SHARED[s]):
                    w = _fetch_shared(s, pid)
                    wheels += [w] if w and os.path.isdir(w) else []
            if wheels:
                try:
                    _pip(["install", "--no-index"] + [a for w in wheels for a in ("--find-links", w)] + need, pid, 70)
                except RuntimeError as e:
                    _log(pid, f"(the packages in the zip didn't fit this PC: {e} - getting them from the internet)")
                    _pip(["install", "--upgrade"] + need, pid, 70)
            else:
                _pip(["install", "--upgrade"] + need, pid, 70)
            for w in wheels:
                shutil.rmtree(w, ignore_errors=True)
            importlib.invalidate_caches()
        if from_drive and os.path.exists(_pack_path(p)):
            os.remove(_pack_path(p))                     # it's on Drive: no second copy on this PC
        if p.get("code"):
            _restore_code(p, pid)                        # (project folder only) your newer code wins over Drive's
            if any(not os.path.exists(c) for c in _code(p)):
                raise RuntimeError(f"{zip_name(p)}.zip didn't have all of {p['name']}'s files")
            importlib.invalidate_caches()
        # 3. anything still missing comes from the internet
        for f in p.get("files", []):
            dest = _abs(f["path"])
            if not os.path.exists(dest):
                _download(f["url"], dest, pid)
        if p.get("ollama"):
            import llm
            if not _ollama():                    # put Ollama inside the app folder (tools/ollama), no installer
                zp = os.path.join(BASE, "tools", "ollama.zip")
                _download(OLLAMA_ZIP, zp, pid)
                _log(pid, "Unpacking Ollama into tools/ollama…", 82)
                with zipfile.ZipFile(zp) as z:
                    z.extractall(os.path.join(BASE, "tools", "ollama"))
                os.remove(zp)
            llm.start_ollama(wait=30)
            for m in _ollama_models():
                _log(pid, f"ollama pull {m} (big download, can take a while)…", 88, f"Downloading the AI model {m}…")
                r = subprocess.run([_ollama(), "pull", m], capture_output=True, text=True, env=llm.ollama_env(),
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if r.returncode != 0:
                    raise RuntimeError(f"ollama pull {m} failed: {(r.stderr or '').strip()[-200:]}")
        for d in p.get("folders", []):                   # (no zip had it: an empty one, so it isn't retried on every start)
            os.makedirs(_abs(d), exist_ok=True)
        _set(pid, True)
        _jobs[pid]["state"] = "done"
        _log(pid, f"✅ {p['name']} installed." + (" Restart Vermeil to use it." if need or p.get("code") else ""), 100, "Installed")
    except Exception as e:
        _jobs[pid]["state"] = "error"
        _log(pid, f"❌ {type(e).__name__}: {e}" + (f"\nYou can also run it yourself: python -m pip install {' '.join(p['pip'])}" if p.get("pip") else ""))


def uninstall(pid, force=False, remove_pack=False):
    """removes the plugin's files (and packages no other installed plugin needs) and hides its menu."""
    p = BY_ID.get(pid)
    if not p:
        return {"error": "Unknown plugin."}
    if p.get("builtin"):
        return {"error": f"{p['name']} is part of Vermeil itself, so it can't be uninstalled."}
    if _jobs.get(pid, {}).get("state") == "running":
        return {"error": f"{p['name']} is busy - wait a moment."}
    if not restorable(p) and not force:
        return {"confirm": f"{p['name']}'s files ({round(_size(p) / 1e6)} MB) have no installer pack on this PC, so they can't be "
                           f"installed again later without one. Delete them anyway?"}
    _jobs[pid] = {"state": "running", "log": []}
    _log(pid, "Uninstalling…", 5, "Uninstalling…")
    dists = _dists()
    drop = own_packages(p, dists)                        # its packages + what they pulled in (nothing others need)
    freed = _size(p) + _pkgs_size(drop, dists)
    if _has_pack(p) and (links().get(p["id"]) or _cached_zip(p)):
        remove_pack = True                               # its zip is on Drive: Install downloads it again
    try:
        for f in p.get("files", []):
            if os.path.exists(_abs(f["path"])):
                os.remove(_abs(f["path"]))
        for d in p.get("folders", []):
            if os.path.isdir(_abs(d)):
                _log(pid, f"Deleting {d}…", 25, "Deleting its files…")
                shutil.rmtree(_abs(d), ignore_errors=True)
        _backup_code(p)                                  # (project folder only)
        for c in _code(p):
            if os.path.isfile(c):
                os.remove(c)
        if remove_pack and os.path.exists(_pack_path(p)):
            freed += os.path.getsize(_pack_path(p))
            os.remove(_pack_path(p))
        if p.get("ollama") and _ollama():
            import llm
            llm.start_ollama(wait=15)
            for m in _ollama_models():
                subprocess.run([_ollama(), "rm", m], capture_output=True, env=llm.ollama_env(),
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            llm.stop_ollama()
            if os.path.isdir(os.path.dirname(llm.BUNDLED_OLLAMA)):        # the copy inside the app folder (downloadable again)
                freed += _size({"folders": ["tools/ollama"]})
                shutil.rmtree(os.path.dirname(llm.BUNDLED_OLLAMA), ignore_errors=True)
        shutil.rmtree(_wheels(pid), ignore_errors=True)
        if drop:
            try:
                _pip(["uninstall", "-y"] + drop, pid, 55)
            except Exception as e:
                freed -= _pkgs_size([n for n in drop if n in _dists()], dists)
                _log(pid, f"(some packages stay installed - close Vermeil and press Uninstall again if they're in use: {e})")
        _set(pid, False)
        _jobs[pid]["state"] = "done"
        msg = f"{p['name']} uninstalled - freed about {_amount(freed)}."
        _log(pid, "🗑 " + msg, 100, "Uninstalled")
        return {"message": msg, "status": status()}
    except Exception as e:
        _jobs[pid]["state"] = "error"
        _log(pid, f"❌ {e}")
        return {"error": str(e), "status": status()}


def _amount(n):
    """bytes -> '12 MB' / '1.4 GB' / '56 KB' (small features are only a few KB of code)"""
    return f"{n / 1e9:.1f} GB" if n >= 1e9 else f"{round(n / 1e6)} MB" if n >= 1e6 else f"{max(1, round(n / 1e3))} KB"


def builtins_missing():
    """the built-in parts that still miss something (packages, model files, folders, Ollama)"""
    return [p for p in PLUGINS if p.get("builtin") and p["id"] != "unimate"           # UniMate: autosetup._unimate
            and (any(not has_module(x) for x in p.get("pip", [])) or _files_missing(p))]


OLLAMA_MIN_FREE = 20e9          # the offline AI needs ~15 GB: only set it up by itself when there's room


def setup_builtins(step):
    """skills/autosetup.py: get every built-in part ready, one after the other, from the Vermeil Drive folder
    (offline packages inside the zips) or the internet. step(pct, text) shows the overall progress.
    Returns what got installed (they need a restart) and raises with what failed."""
    global _progress_hook
    todo = builtins_missing()
    if "local_ai" in [p["id"] for p in todo] and shutil.disk_usage(BASE).free < OLLAMA_MIN_FREE:
        todo = [p for p in todo if p["id"] != "local_ai"]
        print("[plugins] not enough free space for the offline AI (Ollama) - skipped")
    done, failed = [], []
    for i, p in enumerate(todo):
        base, share = 100 * i / len(todo), 100 / len(todo)
        _progress_hook = lambda pid, pct, text, p=p, base=base, share=share: step(int(base + share * pct / 100), f"{p['name']}: {text}")
        try:
            _jobs[p["id"]] = {"state": "running", "log": []}
            with _install_lock:
                _install_now(p)
            (done if _jobs[p["id"]]["state"] == "done" else failed).append(p["name"])
        except Exception as e:                    # one part failing doesn't stop the others
            import gdrive
            print(f"[plugins] {p['name']}: {gdrive.hide_links(str(e))}")
            failed.append(p["name"])
        finally:
            _progress_hook = None
    if failed:
        raise RuntimeError("couldn't set up " + ", ".join(failed) + (f" (ready: {', '.join(done)})" if done else ""))
    return done


def install_many(ids):
    started = [install(i) for i in ids if i in BY_ID and not BY_ID[i].get("builtin") and not is_installed(i)]
    return {"started": len([s for s in started if s.get("started")]), "errors": [s["error"] for s in started if s.get("error")]}
