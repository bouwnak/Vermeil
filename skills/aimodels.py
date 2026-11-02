"""
aimodels.py - which local AI models suit this PC, and getting them.

recommend() looks at the graphics card and memory and says which Ollama models will run smoothly. install() downloads
the ones that are missing (with progress) and switches Vermeil to them. Used by Settings -> AI, by the one-click
installer (scripts/install.ps1) and by scripts/setup_local.py.
"""
import json
import os
import subprocess
import sys

import requests

import llm

# size -> models. qwen3 = chat + tools, qwen2.5vl = sees pictures. All run through Ollama.
PLANS = {
    "tiny":   {"chat": "qwen3:1.7b", "smart": "qwen3:4b",  "vision": "qwen2.5vl:3b", "whisper": "base"},
    "small":  {"chat": "qwen3:4b",   "smart": "qwen3:4b",  "vision": "qwen2.5vl:3b", "whisper": "base"},
    "medium": {"chat": "qwen3:4b",   "smart": "qwen3:8b",  "vision": "qwen2.5vl:7b", "whisper": "small"},
    "large":  {"chat": "qwen3:8b",   "smart": "qwen3:14b", "vision": "qwen2.5vl:7b", "whisper": "small"},
}
ROLES = ("chat", "smart", "vision")


def gpu_memory_gb():
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=10, creationflags=flags).stdout.strip().splitlines()
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


def recommend():
    """{gpu, vram, ram, size, plan, missing (not downloaded yet), active (Vermeil already uses them)}"""
    gpu, vram = gpu_memory_gb()
    ram = ram_gb()
    size = pick_size(vram, ram)
    plan = PLANS[size]
    st = llm.status()
    have = {m.removesuffix(":latest") for m in st["installed"]}
    wanted = list(dict.fromkeys(plan[r] for r in ROLES))
    return {"gpu": gpu, "vram": round(vram), "ram": round(ram), "size": size, "plan": {r: plan[r] for r in ROLES}, "models": wanted,
            "running": st["running"], "missing": [m for m in wanted if m not in have],
            "active": all(st["models"][r] == plan[r] for r in ROLES)}


def apply_plan(size):
    """Vermeil uses this plan from now on (the file's other settings stay)"""
    plan = PLANS[size]
    data = llm._saved()
    data.update({**plan, "size": size})
    with open(llm.MODELS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _pull(model, report, lo, hi):
    """download one model through Ollama, reporting progress"""
    with requests.post(f"{llm.OLLAMA_URL}/api/pull", json={"model": model, "stream": True}, stream=True, timeout=(10, 600)) as r:
        r.raise_for_status()
        for line in r.iter_lines():
            if not line:
                continue
            d = json.loads(line)
            if d.get("error"):
                raise RuntimeError(d["error"])
            if d.get("total"):
                part = d.get("completed", 0) / d["total"]
                report(lo + (hi - lo) * part, f"Downloading {model} · {d.get('completed', 0) / 1024 ** 3:.1f} of {d['total'] / 1024 ** 3:.1f} GB")


def _ensure_ollama(report):
    if not llm.ollama_exe() and sys.platform == "win32":
        report(0.02, "Getting Ollama (it runs the AI on this PC)…")
        script = os.path.join(llm.PROJECT, "scripts", "setup_ollama.ps1")
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], stdin=subprocess.DEVNULL,
                       capture_output=True, timeout=1800, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if not llm.ollama_exe():
        raise RuntimeError("Ollama isn't installed. Get it from ollama.com, then try again.")
    llm.start_ollama(wait=30)
    if not llm.status()["running"]:
        raise RuntimeError("Ollama didn't start. Restart the PC and try again.")


def install(report=lambda pct, text: None):
    """download what's missing and switch to the recommended models -> {ok, models, size}, raises on failure"""
    _ensure_ollama(report)
    rec = recommend()
    n = max(1, len(rec["missing"]))
    for i, model in enumerate(rec["missing"]):
        _pull(model, report, 0.05 + 0.9 * i / n, 0.05 + 0.9 * (i + 1) / n)
    apply_plan(rec["size"])
    report(1.0, "Ready")
    return {"ok": True, "models": rec["models"], "size": rec["size"]}
