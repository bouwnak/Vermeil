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
import shutil
import subprocess

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


def libraries_installed():
    py = env_python()
    return bool(py) and os.path.isdir(os.path.join(os.path.dirname(py), "Lib", "site-packages", "torch"))


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


def _run(args, log, cwd=UNIMATE_DIR, env=None):
    """run a command inside the unimate conda environment; raises with the last lines of output if it fails"""
    cmd = [_conda(), "run", "--no-capture-output", "-n", ENV] + args
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       env={**os.environ, **(env or {}), "PYTHONIOENCODING": "utf-8"},
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    out = (p.stdout or "") + (p.stderr or "")
    with open(log, "a", encoding="utf-8") as f:
        f.write("$ " + " ".join(args) + "\n" + out + "\n")
    if p.returncode != 0:
        tail = "\n".join(out.strip().splitlines()[-6:])
        raise RuntimeError(tail or f"{args[0]} failed (exit {p.returncode})")
    return out


def animate(model_path, motions, progress=lambda pct, text: None):
    """Animate one rigged .glb. motions: keys of PROMPTS (or your own sentences).
    Returns [{"clip": "walk", "path": ".../walk.glb"}, ...]."""
    st = status()
    if not st["ready"]:
        raise RuntimeError(st["hint"])
    name = os.path.splitext(os.path.basename(model_path))[0]
    work = os.path.join(WORK_DIR, name)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    log = os.path.join(work, "unimate.log")
    asset = os.path.join(work, "asset")
    samples = os.path.join(work, "samples")
    animated = os.path.join(work, "animated")

    progress(0.05, "Reading the skeleton…")
    _run(["python", "-m", "data_process.rig_preprocess", "run", "--input", model_path,
          "--output_dir", asset, "--no_review"], log)

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
