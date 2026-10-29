"""
setup_local.py - gets everything ready so Vermeil's AI runs on YOUR PC, offline.

Run once (with internet):      python scripts/setup_local.py
Pick model size yourself:      python scripts/setup_local.py --size small | medium | large
Only check what's installed:   python scripts/setup_local.py --check

What it does:
  1. Checks Ollama (the free app that runs AI models locally) is installed and running
  2. Looks at your graphics card + memory and picks models that will run smoothly
  3. Downloads the AI models (chat, smart, vision)          - a few GB, one time
  4. Downloads the speech recognition model (Whisper)       - ~250 MB
  5. Downloads offline voices (Piper)                       - ~60 MB each
  6. Downloads the files the window needs (font, VRM support, face models)
  7. Tests that the AI answers
After this, the AI, voice, listening and camera all work with no internet.
"""
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # the project folder (this file is in scripts/)
sys.path.insert(0, HERE)
import folders  # noqa: E402,F401  (lets Python find brain/, senses/, skills/)
from paths import data_file  # noqa: E402

UI_VENDOR = os.path.join(HERE, "ui", "vendor")

# size -> models. qwen3 = chat + tools, qwen2.5vl = sees pictures. All run through Ollama.
PLANS = {
    "tiny":   {"chat": "qwen3:1.7b", "smart": "qwen3:4b",  "vision": "qwen2.5vl:3b", "whisper": "base"},
    "small":  {"chat": "qwen3:4b",   "smart": "qwen3:4b",  "vision": "qwen2.5vl:3b", "whisper": "base"},
    "medium": {"chat": "qwen3:4b",   "smart": "qwen3:8b",  "vision": "qwen2.5vl:7b", "whisper": "small"},
    "large":  {"chat": "qwen3:8b",   "smart": "qwen3:14b", "vision": "qwen2.5vl:7b", "whisper": "small"},
}


def say(msg):
    print(f"\n=== {msg}")


# ------------------------------------------------------------------ hardware
def gpu_memory_gb():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10).stdout.strip().splitlines()
        if out:
            name, mb = out[0].rsplit(",", 1)
            return name.strip(), int(mb) / 1024
    except Exception:
        pass
    return None, 0


def ram_gb():
    try:
        if sys.platform == "win32":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MS()
            m.dwLength = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return m.ullTotalPhys / 1024 ** 3
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024 ** 3
    except Exception:
        return 8


def pick_size(vram, ram):
    if vram >= 14:
        return "large"
    if vram >= 7:
        return "medium"
    if vram >= 4 or ram >= 16:
        return "small"
    return "tiny"


# ------------------------------------------------------------------ ollama
def ollama_exe():
    import llm
    return llm.ollama_exe()            # tools/ollama/ollama.exe first, then a normal Ollama install


def ensure_ollama():
    import llm
    exe = ollama_exe()
    if not exe:
        print("Ollama isn't set up yet. Easiest: run scripts\\setup_ollama.bat (puts it in the tools\\ollama folder).")
        if sys.platform == "win32" and shutil.which("winget"):
            if input("Install it now with winget? (y/n): ").strip().lower().startswith("y"):
                subprocess.run(["winget", "install", "-e", "--id", "Ollama.Ollama", "--accept-source-agreements",
                                "--accept-package-agreements"])
                exe = ollama_exe()
        if not exe:
            print("Download it from https://ollama.com/download, install it, then run this script again.")
            sys.exit(1)
    if not llm.status()["running"]:
        print("Starting Ollama…")
        llm.start_ollama()
        for _ in range(30):
            if llm.status()["running"]:
                break
            time.sleep(1)
    if not llm.status()["running"]:
        print("Ollama didn't start. Open the Ollama app from the Start menu, then run this again.")
        sys.exit(1)
    print("✅ Ollama is running.")
    return exe


def pull(exe, model):
    print(f"Downloading {model} (only the first time - this can take a while)…")
    import llm
    if subprocess.run([exe, "pull", model], env=llm.ollama_env()).returncode != 0:
        print(f"⚠️ Couldn't download {model}.")
        return False
    return True


# ------------------------------------------------------------------ other downloads
def download(url, dest):
    import requests
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    try:
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        with open(dest, "wb") as f:
            f.write(r.content)
        print(f"  ✓ {os.path.relpath(dest, HERE)}")
        return True
    except Exception as e:
        print(f"  ⚠️ {url}: {e}")
        return False


def ui_files():
    download("https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.1.0/lib/three-vrm.module.min.js",
             os.path.join(UI_VENDOR, "three-vrm", "three-vrm.module.min.js"))
    css = []
    for w in (400, 600, 700, 800):
        name = f"nunito-latin-{w}-normal.woff2"
        if download(f"https://cdn.jsdelivr.net/fontsource/fonts/nunito@latest/latin-{w}-normal.woff2",
                    os.path.join(UI_VENDOR, "fonts", name)):
            css.append(f"@font-face {{ font-family: 'Nunito'; font-style: normal; font-weight: {w}; "
                       f"font-display: swap; src: url('{name}') format('woff2'); }}")
    if css:
        with open(os.path.join(UI_VENDOR, "fonts", "nunito.css"), "w", encoding="utf-8") as f:
            f.write("\n".join(css) + "\n")


def voices():
    import tts
    wanted = list(tts.STARTER_VOICES)
    try:
        with open(data_file("characters.json"), encoding="utf-8") as f:
            for c in json.load(f).get("characters", []):
                v = tts.to_local_voice(c.get("voice"))[6:]
                if v not in wanted:
                    wanted.append(v)
    except (OSError, json.JSONDecodeError):
        pass
    tts.catalog()                                          # saves the full voice list for offline use
    for key in wanted:
        try:
            tts.download_voice(key)
            print(f"  ✓ voice {key}")
        except Exception as e:
            print(f"  ⚠️ voice {key}: {e}")


def whisper(size):
    try:
        import stt
        os.environ["WHISPER_MODEL"] = size
        stt.load()
        print(f"  ✓ Whisper '{size}' ready")
    except ImportError:
        print("  ⚠️ faster-whisper isn't installed: python -m pip install -r requirements.txt")
    except Exception as e:
        print(f"  ⚠️ Whisper: {e}")


# ------------------------------------------------------------------ main
def main():
    import llm
    args = sys.argv[1:]
    if "--gpu" in args:                                    # after updating the NVIDIA driver
        llm.set_cpu_only(False)
        print("OK - I'll try the graphics card again. Testing…")
        try:
            print("AI says:", llm._ollama_create(model="chat", messages=[{"role": "user", "content": "Say hi in five words."}]).choices[0].message.content)
            print("✅ Graphics card works." if not llm.cpu_only() else "⚠️ Still crashing on the graphics card - back to CPU.")
        except Exception as e:
            print(f"⚠️ {e}")
        return
    if "--check" in args:
        st = llm.status()
        print(json.dumps(st, indent=2))
        print("Voices installed:", __import__("tts").installed_voices())
        return
    say("1/7 Ollama (runs the AI on your PC)")
    exe = ensure_ollama()

    say("2/7 Checking your PC")
    gpu, vram = gpu_memory_gb()
    ram = ram_gb()
    size = args[args.index("--size") + 1] if "--size" in args else pick_size(vram, ram)
    if size not in PLANS:
        sys.exit(f"--size must be one of: {', '.join(PLANS)}")
    plan = PLANS[size]
    print(f"Graphics card: {gpu or 'none found (AI will use the CPU - slower)'}{f' ({vram:.0f} GB)' if gpu else ''}")
    print(f"Memory: {ram:.0f} GB  →  using the '{size}' setup: {plan}")

    say("3/7 AI models")
    for role in ("chat", "smart", "vision"):
        if plan[role] not in [m.removesuffix(":latest") for m in llm.status()["installed"]]:
            pull(exe, plan[role])
    keep = {"cpu_only": True} if llm.cpu_only() else {}
    with open(llm.MODELS_FILE, "w", encoding="utf-8") as f:
        json.dump({**plan, "size": size, **keep}, f, indent=2)
    print(f"Saved your model choice to {os.path.relpath(llm.MODELS_FILE, HERE)}")

    say("4/7 Speech recognition (Whisper)")
    whisper(plan["whisper"])

    say("5/7 Offline voices (Piper)")
    voices()

    say("6/7 Window files (font, VRM support, face recognition models)")
    ui_files()
    try:
        import presence
        presence.ensure_models()
        print("  ✓ face models")
    except Exception as e:
        print(f"  ⚠️ face models: {e}")

    say("7/7 Testing the AI")
    try:
        t = time.time()
        print("AI says:", llm._ollama_create(model="chat", messages=[{"role": "user", "content": "Say hi in five words."}]).choices[0].message.content)
        print(f"✅ Everything works ({time.time() - t:.0f}s for the first answer; later answers are faster).")
        if llm.cpu_only():
            print("ℹ️ Running on the CPU because the graphics card crashed Ollama. Update your NVIDIA driver\n"
                  "   (NVIDIA app / GeForce Experience, or nvidia.com/drivers), restart the PC, then run:\n"
                  "   python scripts/setup_local.py --gpu")
    except Exception as e:
        print(f"⚠️ {e}")
    print("\nDone! Start Vermeil with:  python app.py")


if __name__ == "__main__":
    main()
