"""updater.py - Settings -> General -> Update: gets the newest Vermeil from GitHub (github.com/bouwnak/Vermeil).

  check()            {"current", "latest", "branch", "new"} - is there a newer version on GitHub?
  update(progress)   downloads it and puts the new files in place; progress(pct 0..1, text) shows the bar

A folder made with `git clone` updates with `git pull`. A folder from "Download ZIP" (no .git) downloads the branch's
zip and copies its files over the old ones. Your own things are never touched: `env` (your keys), what's already in
`data/` (settings, memories, progress), the `dnd` asset library, and files that aren't in the download stay as they are.
If requirements.txt changed, the new packages are installed too. Restart Vermeil afterwards to use the new version.
"""
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

from paths import data_file

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = "bouwnak/Vermeil"
DEFAULT_BRANCH = "voice-gpu-and-setup-fix"       # the branch the app is developed on
VERSION_FILE = data_file("version.json")
KEEP_FILES = {"env", ".env"}
KEEP_DIRS = {".git", "dnd", "__pycache__"}
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _git(*args):
    p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       creationflags=NO_WINDOW)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip().splitlines()[-1] if (p.stderr or p.stdout).strip() else "git failed")
    return p.stdout.strip()


def is_git():
    return os.path.isdir(os.path.join(ROOT, ".git")) and shutil.which("git") is not None


def branch():
    """which branch to follow: the clone's own branch, the "Vermeil-<branch>" name a GitHub zip gets, or the default"""
    if is_git():
        try:
            return _git("rev-parse", "--abbrev-ref", "HEAD")
        except RuntimeError:
            pass
    m = re.match(r"^Vermeil-(.+)$", os.path.basename(ROOT), re.I)
    return m.group(1) if m else DEFAULT_BRANCH


def current():
    """the commit this folder has (None when unknown, e.g. a zip that was never updated)"""
    if is_git():
        try:
            return _git("rev-parse", "HEAD")
        except RuntimeError:
            return None
    try:
        with open(VERSION_FILE, encoding="utf-8") as f:
            return json.load(f).get("commit")
    except (OSError, ValueError):
        return None


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "Vermeil-updater", "Accept": "application/vnd.github+json"})
    return urllib.request.urlopen(req, timeout=timeout)


def latest(name=None):
    with _get(f"https://api.github.com/repos/{REPO}/commits/{name or branch()}") as r:
        info = json.load(r)
    return info["sha"], (info.get("commit", {}).get("message") or "").splitlines()[0]


def check():
    name = branch()
    try:
        sha, msg = latest(name)
    except Exception as e:
        return {"error": f"Couldn't reach GitHub: {e}", "branch": name}
    have = current()
    return {"branch": name, "current": have, "latest": sha, "message": msg, "new": have != sha}


def _wanted(rel):
    parts = rel.replace("\\", "/").split("/")
    if parts[-1] in KEEP_FILES or any(p in KEEP_DIRS for p in parts[:-1]):
        return False
    if parts[0] == "data" and os.path.exists(os.path.join(ROOT, *parts)):
        return False                                  # your settings, memories and progress stay yours
    return True


def install_zip(blob, sha=None):
    """copy a GitHub branch zip (bytes) over this folder; returns how many files changed"""
    changed = 0
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        top = names[0].split("/")[0] + "/" if names else ""
        for n in names:
            rel = n[len(top):] if n.startswith(top) else n
            if not rel or not _wanted(rel):
                continue
            dest = os.path.join(ROOT, *rel.split("/"))
            data = z.read(n)
            try:
                with open(dest, "rb") as f:
                    if f.read() == data:
                        continue
            except OSError:
                pass
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
            changed += 1
    if sha:
        os.makedirs(os.path.dirname(VERSION_FILE), exist_ok=True)
        with open(VERSION_FILE, "w", encoding="utf-8") as f:
            json.dump({"commit": sha}, f)
    return changed


def _download(url, progress, lo, hi):
    with _get(url, timeout=60) as r:
        total = int(r.headers.get("Content-Length") or 0)
        buf, got = io.BytesIO(), 0
        while True:
            chunk = r.read(256 * 1024)
            if not chunk:
                break
            buf.write(chunk)
            got += len(chunk)
            mb = got / 1e6
            if total:
                progress(lo + (hi - lo) * got / total, f"Downloading the new version… {mb:.0f} of {total / 1e6:.0f} MB")
            else:                                     # GitHub doesn't always say the size: creep forward
                progress(min(hi - 0.01, lo + (hi - lo) * (1 - 1 / (1 + mb / 25))), f"Downloading the new version… {mb:.0f} MB")
    return buf.getvalue()


def _requirements(progress, before):
    req = os.path.join(ROOT, "requirements.txt")
    try:
        with open(req, encoding="utf-8") as f:
            if f.read() == before:
                return
    except OSError:
        return
    progress(0.92, "Installing the new Python packages…")
    py = sys.executable
    if os.path.basename(py).lower() == "pythonw.exe":
        py = os.path.join(os.path.dirname(py), "python.exe")
    subprocess.run([py, "-m", "pip", "install", "-q", "-r", req], cwd=ROOT, creationflags=NO_WINDOW)


def update(progress=lambda pct, text: None):
    """returns {"ok", "message", "changed"} or {"error"}"""
    progress(0.02, "Checking GitHub for the newest version…")
    name = branch()
    try:
        sha, msg = latest(name)
    except Exception as e:
        return {"error": f"Couldn't reach GitHub: {e}"}
    if current() == sha:
        progress(1.0, "Already up to date.")
        return {"ok": True, "changed": 0, "message": "Vermeil is already up to date."}
    try:
        with open(os.path.join(ROOT, "requirements.txt"), encoding="utf-8") as f:
            before = f.read()
    except OSError:
        before = ""
    if is_git():
        progress(0.2, "Getting the changes with git…")
        try:
            _git("pull", "--ff-only", "origin", name)
        except RuntimeError as e:
            return {"error": f"git couldn't update this folder ({e}). Save or undo your own changes to the code first."}
        changed = None
    else:
        blob = _download(f"https://codeload.github.com/{REPO}/zip/refs/heads/{name}", progress, 0.05, 0.8)
        progress(0.82, "Putting the new files in place…")
        changed = install_zip(blob, sha)
    _requirements(progress, before)
    progress(1.0, "Updated. Restart Vermeil to use the new version.")
    what = f" ({changed} file{'s' if changed != 1 else ''} changed)" if changed is not None else ""
    return {"ok": True, "changed": changed, "message": f"Updated to the newest version{what}: {msg}. Restart Vermeil to use it."}


def restart():
    """start a fresh Vermeil; the caller closes this one"""
    py = sys.executable
    subprocess.Popen([py, os.path.join(ROOT, "app.py")], cwd=ROOT, close_fds=True,
                     creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))


if __name__ == "__main__":
    print(check())
