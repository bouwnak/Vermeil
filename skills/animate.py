"""UniMate (github.com/Friedrich-M/UniMate): text -> animation for any rigged model.

It lives in tools/unimate with its own conda environment ("unimate", Python 3.10),
because it needs different library versions than the app. scripts/setup_unimate.bat sets it up.

animate() runs UniMate's three steps on one rigged .glb:
  1. rig_preprocess  - reads the skeleton and turns it into an asset UniMate understands
  2. sample          - makes one motion per prompt ("An object walks forward.")
  3. animate_motion  - drives the model with each motion -> one animated .glb per motion
Step 3 is written for the Blender program; we don't use it. A small stand-in called "blender"
(tools/unimate_bin/blender, written by _blender_shim) runs the same script with the environment's own
Python and its bpy module (Blender as a Python library, installed with UniMate's libraries).
The app then merges those .glb files into one model with all the clips (ui/rigger.js).
The UniMate checkpoints are CC BY-NC: fine for personal use, not for selling.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNIMATE_DIR = os.path.join(ROOT, "tools", "unimate")
EXP = "outputs/unimate_uniml3d_f60_v3"
CHECKPOINT = os.path.join(UNIMATE_DIR, *EXP.split("/"), "checkpoints", "checkpoint_step_150000.pt")
ENV = "unimate"
WORK_DIR = os.path.join(ROOT, "ui", "models", "_unimate")      # inside ui/ so the page can load the results
SETUP_HINT = ("UniMate isn't set up yet. Double-click scripts\\setup_unimate.bat "
              "(it gets Miniconda and a small Git by itself; it downloads about 2 GB).")
# UniMate's scripts are bash scripts: without Git for Windows, the app downloads its portable copy here (no installer)
PORTABLE_GIT = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "Vermeil", "PortableGit")

PROMPTS = {
    "idle": "An object stands in place and breathes calmly.",
    "walk": "An object walks forward.",
    "wave": "An object waves with its right hand.",
    "talk": "An object talks and gestures with its hands.",
    "happy": "An object bounces happily in place.",
    "dance": "An object dances in place.",
    "cheer": "An object cheers with its arms raised.",
    "jump": "An object jumps in place.",
    "sad": "An object hangs its head sadly.",
    "sit": "An object sits down and stays seated.",
    # gym demos (Gym -> "Demo" makes her do the exercise next to you)
    "squat": "An object does bodyweight squats, bending the knees and standing back up.",
    "lunge": "An object does forward lunges, alternating legs.",
    "deadlift": "An object bends at the hips with a flat back and stands up tall, like a deadlift.",
    "pushup": "An object does push-ups on the floor.",
    "curl": "An object does bicep curls with both arms.",
    "row": "An object pulls both arms back to the chest, like a rowing exercise.",
    "press": "An object pushes both hands straight up overhead and lowers them, like a shoulder press.",
    "plank": "An object holds a plank on the floor.",
    "jumping_jacks": "An object does jumping jacks.",
}


def _conda():
    found = shutil.which("conda")
    if found:
        return found
    home = os.path.expanduser("~")
    for base in ("miniconda3", "anaconda3", "Miniconda3", "Anaconda3", os.path.join("AppData", "Local", "miniconda3")):
        for exe in (os.path.join(home, base, "Scripts", "conda.exe"), os.path.join(home, base, "condabin", "conda.bat")):
            if os.path.exists(exe):
                return exe
    return None


def _bash():
    for exe in (shutil.which("bash"), r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files (x86)\Git\bin\bash.exe",
                os.path.join(PORTABLE_GIT, "bin", "bash.exe")):
        if exe and os.path.exists(exe) and "system32" not in exe.lower():     # not WSL's bash
            return exe
    return None


def _git():
    for exe in (shutil.which("git"), r"C:\Program Files\Git\cmd\git.exe", os.path.join(PORTABLE_GIT, "cmd", "git.exe")):
        if exe and os.path.exists(exe):
            return exe
    return None


def env_python():
    """the unimate environment's own python.exe (None if the environment doesn't exist yet)"""
    conda = _conda()
    if not conda:
        return None
    base = os.path.dirname(os.path.dirname(conda))          # ...\miniconda3\Scripts\conda.exe -> ...\miniconda3
    exe = os.path.join(base, "envs", ENV, "python.exe")
    return exe if os.path.exists(exe) else None


# a few of UniMate's libraries that must be there (Quaternions.py comes from its git-only "Motion" library, the one a
# half-finished install misses). A run that hits "No module named ..." leaves LIBS_MISSING so the next press reinstalls.
KEY_LIBS = ("torch", "bpy", "loguru", "Quaternions.py", "Animation.py")
LIBS_MISSING = os.path.join(WORK_DIR, "libraries_missing.txt")


def libraries_installed():
    py = env_python()
    if not py or os.path.exists(LIBS_MISSING):
        return False
    site = os.path.join(os.path.dirname(py), "Lib", "site-packages")
    return all(os.path.exists(os.path.join(site, n)) for n in KEY_LIBS)


def libraries_fixed():
    """after the pip install: forget the missing-library note"""
    try:
        os.remove(LIBS_MISSING)
    except OSError:
        pass


def pip_commands():
    """the same install by hand - shown in the Animate box only when the automatic one failed"""
    py = env_python() or os.path.join("%USERPROFILE%", "miniconda3", "envs", ENV, "python.exe")
    return [f'"{py}" -m pip install "setuptools<81"',
            f'"{py}" -m pip install -r "{os.path.join(UNIMATE_DIR, "requirements.txt")}" --no-build-isolation']


def status():
    repo = os.path.isdir(os.path.join(UNIMATE_DIR, "unimate"))
    ckpt = os.path.exists(CHECKPOINT)
    conda, bash = _conda(), _bash()
    env, libs = bool(env_python()), libraries_installed()
    ready = repo and ckpt and bool(conda) and bool(bash) and env and libs
    missing = [n for n, ok in (("Miniconda", conda), ("Git (for its bash)", bash), ("the UniMate code", repo),
                               ("its Python 3.10", env), ("the checkpoint", ckpt)) if not ok]
    hint, commands = "", []
    if not ready:
        try:
            import autosetup
            auto = autosetup.status("unimate")
        except Exception:
            auto = {}
        if auto.get("status") == "working":
            hint = f"Getting UniMate ready ({auto.get('pct', 0)}%): {auto.get('text', '')}"
        elif missing:
            hint = "UniMate is still being got ready. Missing: " + ", ".join(missing) + "."
            if auto.get("status") == "failed":
                hint += " Last try failed: " + auto.get("text", "") + " (see data/auto_setup.log)"
        elif not libs and auto.get("status") == "failed":
            hint = ("UniMate's libraries didn't install by themselves (" + auto.get("text", "")[:120] + "). Press "
                    "Make the animations to try again, or paste these two lines into a Command Prompt:")
            commands = pip_commands()
        elif not libs:
            hint = ("Almost there: UniMate's libraries (about 2 GB) aren't installed yet. Press Make the animations "
                    "and Vermeil installs them in the background.")
    return {"ready": ready, "repo": repo, "checkpoint": ckpt, "conda": bool(conda), "bash": bool(bash),
            "env": env, "libraries": libs, "hint": hint, "commands": commands}


SHIM_DIR = os.path.join(ROOT, "tools", "unimate_bin")
SHIM = """#!/bin/bash
# Stand-in for the Blender program: UniMate's scripts call `blender -b --python-exit-code 1 -P script.py -- args`.
# This runs script.py with the unimate environment's Python + its bpy module instead. (Written by skills/animate.py.)
script=""
while [ $# -gt 0 ]; do
  case "$1" in
    -b|--background) shift ;;
    --python-exit-code) shift 2 ;;
    -P|--python) script="$2"; shift 2 ;;
    --) break ;;
    *) shift ;;
  esac
done
exec "{py}" "$script" "$@"
"""


def _blender_shim():
    """write the "blender" stand-in (tools/unimate_bin/blender) and return its folder, to put first on PATH"""
    os.makedirs(SHIM_DIR, exist_ok=True)
    py = (env_python() or "python").replace("\\", "/")
    with open(os.path.join(SHIM_DIR, "blender"), "w", encoding="utf-8", newline="\n") as f:
        f.write(SHIM.replace("{py}", py))
    return SHIM_DIR


_proc = None                     # the UniMate step that's running now (Cancel stops it)
_cancel = threading.Event()


class Cancelled(RuntimeError):
    pass


def cancel():
    """Characters -> Make the animations -> Cancel: stop the running step and everything it started"""
    _cancel.set()
    p = _proc
    if p and p.poll() is None:
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            else:
                p.kill()
        except OSError:
            pass
    return True


def _run(args, log, cwd=UNIMATE_DIR, env=None):
    """run a command inside the unimate conda environment; raises with the last lines of output if it fails"""
    cmd = [_conda(), "run", "--no-capture-output", "-n", ENV] + args
    global _proc
    if _cancel.is_set():
        raise Cancelled("Stopped.")
    p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                         errors="replace", env={**os.environ, **(env or {}), "PYTHONIOENCODING": "utf-8"},
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    _proc = p
    try:
        out, _ = p.communicate()
    finally:
        _proc = None
    out = out or ""
    if _cancel.is_set():
        raise Cancelled("Stopped.")
    with open(log, "a", encoding="utf-8") as f:
        f.write("$ " + " ".join(args) + "\n" + out + "\n")
    if p.returncode != 0:
        lost = re.search(r"No module named '([^']+)'", out)
        if lost:                                           # a half-finished library install: the next press redoes it
            os.makedirs(WORK_DIR, exist_ok=True)
            with open(LIBS_MISSING, "w", encoding="utf-8") as f:
                f.write(lost.group(1))
            raise RuntimeError(f"one of UniMate's libraries ({lost.group(1)}) is missing. Press Make the animations "
                               "again: Vermeil installs the missing ones in the background first.")
        tail ="\n".join(out.strip().splitlines()[-6:])
        raise RuntimeError(tail or f"{args[0]} failed (exit {p.returncode})")
    return out


# models drawn lying down or on their side: UniMate can't tell which way they face, so these turns stand them up
TURNS = ["z90", "z-90", "x90", "x-90", "x180"]


def skip_reason(asset):
    """why UniMate's feature step dropped the model (from asset/work/features/filtered_clips.json), or ''"""
    try:
        with open(os.path.join(asset, "work", "features", "filtered_clips.json"), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return ""
    for clips in (data.values() if isinstance(data, dict) else []):
        for c in clips or []:
            if isinstance(c, dict) and c.get("reason"):
                return str(c["reason"])
    try:                                                    # "<name>\t<error>" lines, the last one is this run's
        with open(os.path.join(asset, "work", "features", "extract_errors.log"), encoding="utf-8", errors="replace") as f:
            lines = [ln.strip() for ln in f if ln.strip()]
        return "processing failed: " + lines[-1].split("\t", 1)[-1] if lines else ""
    except OSError:
        return ""


def has_skeleton(model_path):
    """False for a .glb with no skin (bones) in it; anything else is left to UniMate"""
    if not model_path.lower().endswith(".glb"):
        return True
    try:
        with open(model_path, "rb") as f:
            head = f.read(20)
            n = int.from_bytes(head[12:16], "little")
            return bool(json.loads(f.read(n)).get("skins"))
    except (OSError, ValueError):
        return True


def explain(reason):
    """UniMate's reason in plain words, with what to do"""
    r = reason or ""
    m = re.search(r"(\d+) joints outside \[(\d+), (\d+)\]", r)
    if m:
        n, lo, hi = (int(x) for x in m.groups())
        if n < lo:
            return (f"this model has only {n} bones; UniMate needs at least {lo}. "
                    "Press Rig it first, then Make the animations again.")
        return (f"this model has {n} bones; UniMate takes at most {hi}. If the file holds two characters, "
                "save each one on its own (one character per .glb), or use a model with a simpler skeleton.")
    if "no motion NPZ" in r or "No armature found" in r:
        return "UniMate found no skeleton in this model. Press Rig it first, then Make the animations again."
    if "zero-length bones" in r or "degenerate skeleton" in r:
        return ("the skeleton has bones of zero length, so UniMate can't measure it. "
                "Rig the model again (Rig it), then Make the animations again.")
    if "horizontal separation" in r:
        return ("UniMate couldn't tell which way the model faces, even after standing it up. "
                "Try a model standing upright in a T-pose or A-pose.")
    return f"UniMate skipped this model ({r})." if r else ""


def _read_skeleton(model_path, asset, log, progress=lambda pct, text: None):
    """step 1 (rig_preprocess). A model drawn lying down is tried again stood up; other skips get a plain message."""
    if not has_skeleton(model_path):
        raise RuntimeError(explain("No armature found"))
    base = ["python", "-m", "data_process.rig_preprocess", "run", "--input", model_path,
            "--output_dir", asset, "--no_review"]
    for turn in [None] + TURNS:
        try:
            return _run(base + (["--rest_rotation", turn] if turn else []), log)
        except RuntimeError as e:
            if "No armature found" in str(e):
                raise RuntimeError(explain("No armature found")) from None
            if "produced no cond" not in str(e):
                raise
            reason = skip_reason(asset)
            if "horizontal separation" not in reason or turn == TURNS[-1]:
                raise RuntimeError(explain(reason) or str(e)) from None
            progress(0.08, "The model seems to lie down; standing it up and trying again…")
            shutil.rmtree(asset, ignore_errors=True)


def animate(model_path, motions, progress=lambda pct, text: None):
    """Animate one rigged .glb. motions: keys of PROMPTS (or your own sentences).
    Returns [{"clip": "walk", "path": ".../walk.glb"}, ...]."""
    st = status()
    if not st["ready"]:
        raise RuntimeError(st["hint"])
    _cancel.clear()
    name = os.path.splitext(os.path.basename(model_path))[0]
    work = os.path.join(WORK_DIR, name)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    log = os.path.join(work, "unimate.log")
    asset = os.path.join(work, "asset")
    samples = os.path.join(work, "samples")
    animated = os.path.join(work, "animated")

    progress(0.05, "Reading the skeleton…")
    _read_skeleton(model_path, asset, log, progress)

    clips = [(m, PROMPTS.get(m, m)) for m in motions]
    for i, (clip, prompt) in enumerate(clips):
        progress(0.15 + 0.6 * i / len(clips), f"Making the motion: {clip} ({i + 1} of {len(clips)})…")
        _run(["python", "-m", "unimate.inference.sample", "--exp_dir", EXP, "--asset", asset,
              "--prompt", prompt, "--num_repetitions", "1", "--output_dir", os.path.join(samples, clip)], log)

    out = []
    for i, (clip, _) in enumerate(clips):
        progress(0.75 + 0.2 * i / len(clips), f"Moving the model: {clip}…")
        dest = os.path.join(animated, clip)
        _run([_bash(), "scripts/run_animate_motion.sh", os.path.join(samples, clip), dest], log,
             env={"SKIP_INVALID": "1", "PYTHONPATH": UNIMATE_DIR,
                  "PATH": _blender_shim() + os.pathsep + os.environ.get("PATH", "")})
        made = sorted(glob.glob(os.path.join(dest, "*.glb")))
        if made:
            final = os.path.join(work, f"{clip}.glb")
            shutil.copy2(made[0], final)
            out.append({"clip": clip, "path": final})
    if not out:
        raise RuntimeError("UniMate finished but made no animations. See " + log)
    with open(os.path.join(work, "result.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    progress(0.96, "Done.")
    return out
