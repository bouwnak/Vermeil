"""
plugins.py - Settings -> Plugins: install only the features you want, uninstall the ones you don't (to free space).

Each plugin is one feature. Installing it can:
  - pip-install the Python packages it needs      (python -m pip install ...)
  - download its model files                      (Kokoro voice, face/object models...)
  - unpack its files from the installer package   (plugin_packs/<id>.zip, made by scripts/package_app.py)
  - pull local AI models                          (ollama pull ...)
  - show its menu entries again
Uninstalling does the opposite: removes its files, pip-uninstalls packages no other installed plugin needs, and hides its menu.
Files that can't be brought back (no download link and no installer pack) are only deleted when you confirm.

What's installed is saved in data/plugins.json. A fresh install (from the installer) starts with {"fresh": true}, so the app
opens Settings -> Plugins the first time. On a PC with no plugins.json, every feature whose files are present counts as installed.
"""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import threading
import zipfile

import requests

from paths import data_file

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = data_file("plugins.json")
PACKS = os.path.join(BASE, "plugin_packs")
OPENCV_ZOO = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
KOKORO = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"

# packages every install has (never uninstalled)
CORE_PIP = ["requests", "pywebview", "numpy", "rapidfuzz", "vaderSentiment", "keyboard", "psutil", "pillow", "winotify",
            "sounddevice", "soundfile", "piper-tts", "pycaw", "comtypes"]

# pip name -> import name (to check if it's installed)
IMPORT_NAME = {"faster-whisper": "faster_whisper", "SpeechRecognition": "speech_recognition", "PyAudio": "pyaudio",
               "kokoro-onnx": "kokoro_onnx", "edge-tts": "edge_tts", "opencv-python": "cv2", "pypdf": "pypdf",
               "python-docx": "docx", "python-pptx": "pptx", "openpyxl": "openpyxl", "yt-dlp": "yt_dlp",
               "google-api-python-client": "googleapiclient", "google-auth-oauthlib": "google_auth_oauthlib",
               "playwright": "playwright", "sympy": "sympy"}

PLUGINS = [
    {"id": "voice_commands", "name": "Voice commands", "icon": "🎙", "group": "Voice",
     "desc": "Talk to her: wake word 'vermi', speech recognition (Whisper, offline), noise filter.",
     "pip": ["faster-whisper", "SpeechRecognition", "PyAudio"], "panels": [], "size": "~150 MB + Whisper model on first use"},
    {"id": "kokoro", "name": "Kokoro voice (online mode)", "icon": "🗣", "group": "Voice",
     "desc": "Her natural Kokoro voice while the AI is online (and the adventure's voices). Offline she uses Piper.",
     "pip": ["kokoro-onnx"], "files": [{"path": "tools/kokoro/kokoro-v1.0.onnx", "url": KOKORO + "kokoro-v1.0.onnx"},
                                       {"path": "tools/kokoro/voices-v1.0.bin", "url": KOKORO + "voices-v1.0.bin"}],
     "panels": [], "size": "~340 MB"},
    {"id": "online_voices", "name": "Voices for other languages", "icon": "🌏", "group": "Voice",
     "desc": "Japanese, Korean, Filipino, Thai... voices (Microsoft online voices).", "pip": ["edge-tts"], "panels": [], "size": "~1 MB"},
    {"id": "camera", "name": "Camera: faces and objects", "icon": "📷", "group": "Seeing",
     "desc": "Recognises your face and people you know, spots everyday objects, attention for Focus.",
     "pip": ["opencv-python"], "files": [
         {"path": "data/models/face_detection_yunet_2023mar.onnx", "url": OPENCV_ZOO + "face_detection_yunet/face_detection_yunet_2023mar.onnx"},
         {"path": "data/models/face_recognition_sface_2021dec.onnx", "url": OPENCV_ZOO + "face_recognition_sface/face_recognition_sface_2021dec.onnx"},
         {"path": "data/models/object_detection_nanodet_2022nov.onnx", "url": OPENCV_ZOO + "object_detection_nanodet/object_detection_nanodet_2022nov.onnx"}],
     "panels": [], "size": "~140 MB"},
    {"id": "local_ai", "name": "Offline AI (Ollama)", "icon": "🧠", "group": "AI",
     "desc": "She still answers without internet. Ollama is put inside the app's tools/ollama folder and started by Vermeil "
             "herself (hidden) - no separate app to open. Then the AI models are downloaded.",
     "ollama": True, "panels": [], "size": "~1-3 GB program + 5-11 GB models"},
    {"id": "music", "name": "Vermeil Music", "icon": "🎵", "group": "Music",
     "desc": "Your own Spotify-style music app: search, your playlists, Liked Songs, import, Playlist Lab. Songs from YouTube, played with ffplay.",
     "pip": ["yt-dlp"], "folders": ["Packages/ffmpeg-8.0-full_build"], "pack": "ffmpeg", "panels": ["music"], "size": "~20 MB (+190 MB ffplay)"},
    {"id": "spotify", "name": "Spotify", "icon": "🟢", "group": "Music", "desc": "Spotify panel and voice control.",
     "panels": ["spotify"], "size": "tiny"},
    {"id": "study", "name": "Study", "icon": "📚", "group": "Features", "desc": "Read your PDFs, Word and PowerPoint files; quizzes and research.",
     "pip": ["pypdf", "python-docx", "python-pptx", "sympy"], "panels": ["study"], "size": "~60 MB"},
    {"id": "gym", "name": "Gym", "icon": "🏋", "group": "Features", "desc": "Workout, timer, alternatives finder, Excel import.",
     "pip": ["openpyxl"], "panels": ["gym"], "size": "~10 MB"},
    {"id": "kitchen", "name": "Baking & Cooking", "icon": "🍰", "group": "Features", "desc": "Recipe books, converter, kitchen timer.",
     "panels": ["baking", "cooking"], "size": "tiny"},
    {"id": "electronics", "name": "Robotics & Electronics lab", "icon": "🤖", "group": "Features",
     "desc": "Repair and repurpose old electronics, formulas, robot plans and a 2D/3D circuit simulator.",
     "panels": ["electronics"], "size": "tiny"},
    {"id": "adventure", "name": "Games (Adventure + retro games)", "icon": "🐉", "group": "Fun",
     "desc": "The Games hub: the 3D RPG with your companion, plus classic retro games. Its 3D models are the big part.", "folders": ["ui/game/assets"], "pack": "game_assets",
     "panels": ["adventure"], "size": "~780 MB"},
    {"id": "calendar", "name": "Google Calendar (add events)", "icon": "📅", "group": "Planner", "desc": "Lets her add/remove events in Google Calendar.",
     "pip": ["google-api-python-client", "google-auth-oauthlib"], "panels": [], "size": "~40 MB"},
    {"id": "browser", "name": "Browser helper", "icon": "🌐", "group": "PC", "desc": "Her own browser window to read pages and fill forms.",
     "pip": ["playwright"], "panels": [], "size": "~45 MB"},
    {"id": "missions", "name": "Missions", "icon": "🎯", "group": "Features", "desc": "Bigger goals done step by step in the background.", "panels": ["missions"], "size": "tiny"},
    {"id": "focus", "name": "Focus & Progress", "icon": "⏱", "group": "Features", "desc": "Focus sessions and your trends.", "panels": ["focus"], "size": "tiny"},
    {"id": "mind", "name": "Journal & Think", "icon": "💭", "group": "Features", "desc": "Decisions, ideas, goals, thinking tools.", "panels": ["mind"], "size": "tiny"},
    {"id": "code", "name": "Coding helper", "icon": "💻", "group": "Features", "desc": "Writes and edits code in your project folders.", "panels": ["code"], "size": "tiny"},
]
BY_ID = {p["id"]: p for p in PLUGINS}

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
        return importlib.util.find_spec(IMPORT_NAME.get(pip_name, pip_name.replace("-", "_"))) is not None
    except (ImportError, ValueError):
        return False


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


def _present(p):
    """are this plugin's files/packages here? (used when there's no saved state yet)"""
    if any(not has_module(x) for x in p.get("pip", [])):
        return False
    if any(not os.path.exists(_abs(f["path"])) for f in p.get("files", [])):
        return False
    if any(not os.path.isdir(_abs(d)) for d in p.get("folders", [])):
        return False
    return True


def _size(p):
    total = 0
    paths = [_abs(f["path"]) for f in p.get("files", [])] + [_abs(d) for d in p.get("folders", [])] + \
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


def _pack_path(p):
    return os.path.join(PACKS, p["pack"] + ".zip") if p.get("pack") else None


def is_installed(pid):
    st = _load().get("installed", {})
    if pid in st:
        return bool(st[pid])
    p = BY_ID.get(pid)
    return bool(p) and (_present(p) if (p.get("pip") or p.get("files") or p.get("folders")) else True)


def status():
    d = _load()
    out = []
    for p in PLUGINS:
        pack = _pack_path(p)
        missing_pip = [x for x in p.get("pip", []) if not has_module(x)]
        out.append({"id": p["id"], "name": p["name"], "icon": p["icon"], "group": p["group"], "desc": p["desc"], "size": p["size"],
                    "installed": is_installed(p["id"]), "used_mb": round(_size(p) / 1e6, 1), "missing_pip": missing_pip,
                    "pip_command": f"python -m pip install {' '.join(p['pip'])}" if p.get("pip") else "",
                    "pack": bool(pack and os.path.exists(pack)), "pack_mb": round(os.path.getsize(pack) / 1e6, 1) if pack and os.path.exists(pack) else 0,
                    "restorable": restorable(p), "needs_ollama": False,
                    "busy": _jobs.get(p["id"], {}).get("state") == "running", "log": _jobs.get(p["id"], {}).get("log", [])[-6:]})
    return {"plugins": out, "fresh": bool(d.get("fresh")), "hidden_panels": hidden_panels()}


def hidden_panels():
    """menu entries of plugins that aren't installed"""
    return sorted({k for p in PLUGINS if not is_installed(p["id"]) for k in p.get("panels", [])})


def restorable(p):
    """can its files be brought back after uninstalling? (download links or an installer pack)"""
    if p.get("folders") and not (p.get("pack") and os.path.exists(_pack_path(p))):
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
def _log(pid, text):
    j = _jobs.setdefault(pid, {"state": "running", "log": []})
    j["log"].append(text)
    print(f"[plugin {pid}] {text}")
    if on_event:
        try:
            on_event({"type": "plugin", "id": pid, "state": j["state"], "text": text})
        except Exception:
            pass


def _pip(args, pid):
    cmd = [sys.executable, "-m", "pip"] + args
    _log(pid, "Running: python -m pip " + " ".join(args))
    r = subprocess.run(cmd, capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "pip failed").strip().splitlines()[-1][:300])


def _download(url, dest, pid):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    _log(pid, f"Downloading {os.path.basename(dest)}…")
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        total, done, last = int(r.headers.get("content-length") or 0), 0, 0
        with open(dest + ".part", "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total and done * 100 // total >= last + 20:
                    last = done * 100 // total
                    _log(pid, f"  {os.path.basename(dest)}: {last}%")
    os.replace(dest + ".part", dest)


def _unpack(p, pid):
    pack = _pack_path(p)
    _log(pid, f"Unpacking {os.path.basename(pack)}…")
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
    if _jobs.get(pid, {}).get("state") == "running":
        return {"message": f"{p['name']} is already installing."}
    if p.get("folders") and not _present(p) and not (p.get("pack") and os.path.exists(_pack_path(p))):
        return {"error": f"{p['name']} needs its files from the installer package (plugin_packs/{p['pack']}.zip). "
                         f"Copy that file into the plugin_packs folder, then press Install again."}
    _jobs[pid] = {"state": "running", "log": []}
    threading.Thread(target=_install, args=(p,), daemon=True).start()
    return {"message": f"Installing {p['name']}…", "started": True}


_install_lock = threading.Lock()      # one install at a time (two pips at once can break each other)


def _install(p):
    pid = p["id"]
    _log(pid, "Waiting for the other installs…" if _install_lock.locked() else "Starting…")
    with _install_lock:
        _install_now(p)


def _install_now(p):
    pid = p["id"]
    try:
        need = [x for x in p.get("pip", []) if not has_module(x)]
        if need:
            _pip(["install", "--upgrade"] + need, pid)
            importlib.invalidate_caches()
        for f in p.get("files", []):
            dest = _abs(f["path"])
            if not os.path.exists(dest):
                _download(f["url"], dest, pid)
        if p.get("folders") and not _present(p):
            _unpack(p, pid)
        if p.get("ollama"):
            import llm
            if not _ollama():                    # put Ollama inside the app folder (tools/ollama), no installer
                zp = os.path.join(BASE, "tools", "ollama.zip")
                _download(OLLAMA_ZIP, zp, pid)
                _log(pid, "Unpacking Ollama into tools/ollama…")
                with zipfile.ZipFile(zp) as z:
                    z.extractall(os.path.join(BASE, "tools", "ollama"))
                os.remove(zp)
            llm.start_ollama(wait=30)
            for m in _ollama_models():
                _log(pid, f"ollama pull {m} (big download, can take a while)…")
                r = subprocess.run([_ollama(), "pull", m], capture_output=True, text=True, env=llm.ollama_env(),
                                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                if r.returncode != 0:
                    raise RuntimeError(f"ollama pull {m} failed: {(r.stderr or '').strip()[-200:]}")
        _set(pid, True)
        _jobs[pid]["state"] = "done"
        _log(pid, f"✅ {p['name']} installed." + (" Restart Vermeil to use it." if need else ""))
    except Exception as e:
        _jobs[pid]["state"] = "error"
        _log(pid, f"❌ {type(e).__name__}: {e}" + (f"\nYou can also run it yourself: python -m pip install {' '.join(p['pip'])}" if p.get("pip") else ""))


def uninstall(pid, force=False, remove_pack=False):
    """removes the plugin's files (and packages no other installed plugin needs) and hides its menu."""
    p = BY_ID.get(pid)
    if not p:
        return {"error": "Unknown plugin."}
    if _jobs.get(pid, {}).get("state") == "running":
        return {"error": f"{p['name']} is busy - wait a moment."}
    if not restorable(p) and not force:
        return {"confirm": f"{p['name']}'s files ({round(_size(p) / 1e6)} MB) have no installer pack on this PC, so they can't be "
                           f"installed again later without one. Delete them anyway?"}
    _jobs[pid] = {"state": "running", "log": []}
    freed = _size(p)
    try:
        for f in p.get("files", []):
            if os.path.exists(_abs(f["path"])):
                os.remove(_abs(f["path"]))
        for d in p.get("folders", []):
            if os.path.isdir(_abs(d)):
                _log(pid, f"Deleting {d}…")
                shutil.rmtree(_abs(d), ignore_errors=True)
        if remove_pack and p.get("pack") and os.path.exists(_pack_path(p)):
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
        still_needed = set(CORE_PIP) | {x for q in PLUGINS if q["id"] != pid and is_installed(q["id"]) for x in q.get("pip", [])}
        drop = [x for x in p.get("pip", []) if x not in still_needed and has_module(x)]
        if drop:
            try:
                _pip(["uninstall", "-y"] + drop, pid)
            except Exception as e:
                _log(pid, f"(packages stay installed: {e})")
        _set(pid, False)
        _jobs[pid]["state"] = "done"
        _log(pid, f"🗑 {p['name']} uninstalled - freed about {round(freed / 1e6)} MB.")
        return {"message": f"{p['name']} uninstalled - freed about {round(freed / 1e6)} MB.", "status": status()}
    except Exception as e:
        _jobs[pid]["state"] = "error"
        _log(pid, f"❌ {e}")
        return {"error": str(e), "status": status()}


def install_many(ids):
    started = [install(i) for i in ids if i in BY_ID and not is_installed(i)]
    return {"started": len([s for s in started if s.get("started")]), "errors": [s["error"] for s in started if s.get("error")]}
