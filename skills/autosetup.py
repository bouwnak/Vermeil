"""autosetup.py - gets the big optional AI parts ready by itself, in the background, when the app opens.

  UniMate (Rig & animate):  installs Miniconda if it's missing, then the UniMate code, its own Python 3.10
                            environment, the checkpoint and its libraries (pip, into that environment only).
                            It starts by itself only the FIRST time the app opens. After that, opening the app
                            only follows an install that is still running (data/unimate_pip.pid) and never starts
                            one; trying again is the Animate box's button.

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
PIP_PID_FILE = data_file("unimate_pip.pid")
RETRY_AFTER = 24 * 3600
ONCE = ("unimate",)             # starts by itself only the first time the app opens; after that from the Animate box
MINICONDA_URL = "https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe"
MINICONDA_DIR = os.path.join(os.path.expanduser("~"), "miniconda3")
PORTABLE_GIT_URL = ("https://github.com/git-for-windows/git/releases/download/v2.51.0.windows.1/"
                    "PortableGit-2.51.0-64-bit.7z.exe")
PORTABLE_GIT_SHA256 = "a09b275d51ed3e829128e04cf4168fb54896cf6234bb30fecb8dc96a2bd321fa"   # from that release page
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


def _run(cmd, cwd=None, path_first=None, pid_file=None):
    """Run one command quietly; raises with the last lines of its output if it fails.
    path_first: a folder put first on PATH (pip needs git there for UniMate's CLIP).
    pid_file: holds the command's process id while it runs, and its output goes straight into the log file,
    so closing the app doesn't break it (a pipe to a closed app would)."""
    _log("$ " + " ".join(str(c) for c in cmd))
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    if path_first:
        env["PATH"] = path_first + os.pathsep + env.get("PATH", "")
    if not pid_file:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           env=env, creationflags=NO_WINDOW)
        out = (p.stdout or "") + (p.stderr or "")
        _log(out)
    else:
        with open(LOG_FILE, "a", encoding="utf-8") as log:
            p = subprocess.Popen(cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, env=env, creationflags=NO_WINDOW)
            try:
                with open(pid_file, "w") as f:
                    f.write(str(p.pid))
            except OSError:
                pass
            try:
                p.wait()
            finally:
                try:
                    os.remove(pid_file)
                except OSError:
                    pass
        out = _log_tail()
    if p.returncode != 0:
        raise RuntimeError("\n".join(out.strip().splitlines()[-4:]) or f"{cmd[0]} failed (exit {p.returncode})")
    return out


def _log_tail(lines=4):
    try:
        with open(LOG_FILE, encoding="utf-8", errors="replace") as f:
            return "\n".join(f.read()[-20000:].strip().splitlines()[-lines:])
    except OSError:
        return ""


def _alive(pid, exe_part=None):
    """True while process `pid` is still running (Windows; elsewhere False).
    exe_part: its program path must contain this (Windows reuses the numbers of finished processes)."""
    if os.name != "nt":
        return False
    import ctypes
    k32 = ctypes.windll.kernel32
    h = k32.OpenProcess(0x1000, False, pid)            # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    try:
        code = ctypes.c_ulong()
        if not (k32.GetExitCodeProcess(h, ctypes.byref(code)) and code.value == 259):     # STILL_ACTIVE
            return False
        if not exe_part:
            return True
        buf, size = ctypes.create_unicode_buffer(1024), ctypes.c_ulong(1024)
        k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size))
        return exe_part.lower() in buf.value.lower()
    finally:
        k32.CloseHandle(h)


def _earlier_pip():
    try:
        with open(PIP_PID_FILE) as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def _earlier_pip_running():
    import animate
    pid = _earlier_pip()
    return bool(pid) and _alive(pid, os.path.join("envs", animate.ENV))


def _watch_unimate(step):
    """A reopened app: show the install started earlier until it ends, without starting anything."""
    import animate
    _wait_for_earlier_pip(step)
    if not animate.libraries_installed():
        raise RuntimeError("UniMate's libraries didn't install (see data/auto_setup.log). Try again from the Animate box.")
    return "UniMate is ready - press Animate it on a rigged character."


def _wait_for_earlier_pip(step):
    """An install started before the app was last closed keeps running: wait for it instead of starting another."""
    pid = _earlier_pip()
    if not pid:
        return
    import animate
    while _alive(pid, os.path.join("envs", animate.ENV)):
        step(75, "Installing UniMate's libraries (about 2 GB, the long part)...")
        time.sleep(10)
    try:
        os.remove(PIP_PID_FILE)
    except OSError:
        pass


def status(part=None):
    return state.get(part, {}) if part else dict(state)


def start(emit=lambda e: None):
    """Called once when the app opens. Runs in its own thread, one part after the other."""
    state.update(_load())
    threading.Thread(target=_work, args=(emit,), daemon=True).start()


def retry(part, emit=lambda e: None):
    """Settings / the Animate box: try one part again now (also right after a failure, without the day's wait).
    False when the setup is already running."""
    if _lock.locked():
        return False
    state.pop(part, None)
    threading.Thread(target=_work, args=(emit, part), daemon=True).start()
    return True


def _work(emit, only=None):
    if not _lock.acquire(blocking=False):
        return
    try:
        for part, fn in (("builtins", _builtins), ("unimate", _unimate)):
            if only and part != only:
                continue
            if not only and part in ONCE:
                started = state.setdefault("_started", {})
                if part in started:                    # set up by itself once already: from now on only the
                    if not _earlier_pip_running():     # Animate box starts it; just follow an install still running
                        continue
                    fn = _watch_unimate
                else:
                    started[part] = time.time()
                    _save()
            old = state.get(part, {})
            old_git = old.get("text", "").startswith("Git for Windows is needed")    # the app gets Git itself now
            if old.get("status") == "failed" and not old_git and time.time() - old.get("time", 0) < RETRY_AFTER:
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
def _portable_git(dest):
    """Git for Windows' portable copy (no installer, no admin): UniMate needs its bash and git.
    The download is checked against the checksum on the official release page before it's unpacked."""
    import hashlib
    exe = os.path.join(os.environ.get("TEMP", os.path.expanduser("~")), "vermeil_portablegit.7z.exe")   # outside OneDrive
    urllib.request.urlretrieve(PORTABLE_GIT_URL, exe)
    with open(exe, "rb") as f:
        ok = hashlib.sha256(f.read()).hexdigest() == PORTABLE_GIT_SHA256
    if not ok:
        os.remove(exe)
        raise RuntimeError("The Git download was damaged - it will try again tomorrow")
    shutil.rmtree(dest, ignore_errors=True)                     # a half-unpacked copy from an earlier try
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    _run([exe, "-o" + dest, "-y"])                              # it unpacks itself (7-Zip), no window
    try:
        os.remove(exe)
    except OSError:
        pass


def _unimate(step):
    """Everything: Miniconda, the code, its own Python 3.10, the checkpoint and its libraries (about 2 GB, into
    the "unimate" environment only - the app's own Python isn't touched)."""
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
    if not (animate._git() and animate._bash()):
        step(10, "Getting a small Git for UniMate (about 60 MB download)...")
        _portable_git(animate.PORTABLE_GIT)
    git = animate._git()
    if not (git and animate._bash()):
        raise RuntimeError("Git didn't unpack. Install Git for Windows from https://git-scm.com, then open Vermeil again")
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
        did = "UniMate is downloaded."
    if not animate.libraries_installed():
        _wait_for_earlier_pip(step)
    if not animate.libraries_installed():
        step(75, "Installing UniMate's libraries (about 2 GB, the long part)...")
        py = animate.env_python()
        _run([py, "-m", "pip", "install", "setuptools<81"])
        _run([py, "-m", "pip", "install", "-r", os.path.join(code, "requirements.txt"), "--no-build-isolation"],
             cwd=code, path_first=os.path.dirname(git), pid_file=PIP_PID_FILE)
        animate.libraries_fixed()
        did = "UniMate is ready - press Animate it on a rigged character."
    return did
