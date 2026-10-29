"""autosetup.py - gets the big optional AI parts ready by itself, in the background, when the app opens.

  UniMate (Rig & animate):  installs Miniconda if it's missing, then the UniMate code, its own Python 3.10
                            environment and the checkpoint. Its libraries are installed by YOU with pip
                            (the Animate box shows the exact command) - pip never runs behind your back.

  Built-in parts:           voice commands, Kokoro, the Emotional voice (Chatterbox), voice clones (RVC), voices for
                            other languages, the camera, Google Calendar, the browser helper and the offline AI
                            (Ollama, only with 20 GB free) - plugins.setup_builtins() gets what they miss from the
                            Vermeil Drive folder (their zips carry their Python packages) or the internet.

Each part is checked first and skipped when it's already there, so after the first time this does nothing.
A part that failed isn't retried for a day (so a missing internet connection doesn't loop). What happened
is kept in data/auto_setup.json and the log in data/auto_setup.log.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

from paths import data_file

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = data_file("auto_setup.json")
LOG_FILE = data_file("auto_setup.log")
RETRY_AFTER = 24 * 3600
MINICONDA_URL = "https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe"
MINICONDA_DIR = os.path.join(os.path.expanduser("~"), "miniconda3")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_lock = threading.Lock()
state = {}                      # part -> {"status": "working"|"ready"|"failed", "pct", "text", "time"}


def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save():
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=1)
    except OSError:
        pass


def _log(text):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(time.strftime("[%Y-%m-%d %H:%M:%S] ") + text.rstrip() + "\n")
    except OSError:
        pass


def _run(cmd, cwd=None):
    """Run one command quietly; raises with the last lines of its output if it fails."""
    _log("$ " + " ".join(str(c) for c in cmd))
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       env={**os.environ, "PYTHONIOENCODING": "utf-8"}, creationflags=NO_WINDOW)
    out = (p.stdout or "") + (p.stderr or "")
    _log(out)
    if p.returncode != 0:
        raise RuntimeError("\n".join(out.strip().splitlines()[-4:]) or f"{cmd[0]} failed (exit {p.returncode})")
    return out


def status(part=None):
    return state.get(part, {}) if part else dict(state)


def start(emit=lambda e: None):
    """Called once when the app opens. Runs in its own thread, one part after the other."""
    state.update(_load())
    threading.Thread(target=_work, args=(emit,), daemon=True).start()


def _work(emit):
    if not _lock.acquire(blocking=False):
        return
    try:
        for part, fn in (("builtins", _builtins), ("unimate", _unimate)):
            old = state.get(part, {})
            if old.get("status") == "failed" and time.time() - old.get("time", 0) < RETRY_AFTER:
                continue

            def step(pct, text, part=part):
                state[part] = {"status": "working", "pct": pct, "text": text, "time": time.time()}
                emit({"type": "setup_progress", "part": part, "pct": pct, "text": text})

            try:
                did = fn(step)
                state[part] = {"status": "ready", "pct": 100, "text": "Ready", "time": time.time()}
                if did:
                    emit({"type": "setup_progress", "part": part, "pct": 100, "done": True, "text": did})
            except Exception as e:  # noqa: BLE001 - kept for the status and the log
                _log(f"{part} failed: {e}")
                state[part] = {"status": "failed", "pct": 0, "text": str(e)[:300], "time": time.time()}
                emit({"type": "setup_progress", "part": part, "error": str(e)[:300]})
            _save()
    finally:
        _lock.release()


# ---------------- the built-in parts (brain/plugins.py "builtin") ----------------
def _builtins(step):
    import plugins
    if not plugins.builtins_missing():
        return ""
    done = plugins.setup_builtins(step)
    return f"Set up {', '.join(done)} - restart Vermeil to use them." if done else ""


# ---------------- UniMate ----------------
def _unimate(step):
    """Everything except pip: Miniconda, the code, its own Python 3.10 and the checkpoint. The libraries are
    installed by you (the Animate box shows the exact pip command), so pip is never run behind your back."""
    import animate
    if animate.status()["ready"]:
        return ""
    did = ""
    conda = animate._conda()
    if not conda:
        step(3, "Installing Miniconda for UniMate (about 90 MB download)...")
        # outside OneDrive: Windows refused to run the installer from the synced project folder ("Permission denied")
        exe = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "vermeil_miniconda.exe")
        urllib.request.urlretrieve(MINICONDA_URL, exe)
        try:
            _run([exe, "/InstallationType=JustMe", "/RegisterPython=0", "/AddToPath=0", "/S", "/D=" + MINICONDA_DIR])
        except PermissionError:
            pass                                       # the installer can still have worked - checked below
        conda = animate._conda()
        if not conda:
            raise RuntimeError("Miniconda didn't install. Install it from https://docs.conda.io/en/latest/miniconda.html")
    git = shutil.which("git") or (r"C:\Program Files\Git\cmd\git.exe" if os.path.exists(r"C:\Program Files\Git\cmd\git.exe") else None)
    if not git:
        raise RuntimeError("Git for Windows is needed for UniMate. Get it from https://git-scm.com")
    code = animate.UNIMATE_DIR
    if not os.path.isdir(os.path.join(code, "unimate")):
        step(15, "Downloading the UniMate code...")
        _run([git, "clone", "--depth", "1", "https://github.com/Friedrich-M/UniMate", code])
    if not animate.env_python():
        step(30, "Making UniMate's own Python 3.10...")
        # conda-forge only: the default channel asks you to accept its terms first, which can't be done silently
        _run([conda, "create", "-n", animate.ENV, "python=3.10", "-y", "--override-channels", "-c", "conda-forge"])
    if not os.path.exists(animate.CHECKPOINT):
        step(60, "Downloading the UniMate checkpoint (about 1 GB)...")
        from huggingface_hub import snapshot_download
        snapshot_download("Linzhan/UniMate", local_dir=os.path.join(code, "outputs"),
                          allow_patterns=["unimate_uniml3d_f60_v3/*.json", "unimate_uniml3d_f60_v3/*.npy",
                                          "unimate_uniml3d_f60_v3/checkpoints/checkpoint_step_150000.pt"])
        did = "UniMate is downloaded - install its libraries with the command in the Animate box."
    return did
