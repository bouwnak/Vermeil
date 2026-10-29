"""machine.py - looks at this computer and picks how hard Vermeil should work (the "performance mode").

  scan()                 what this computer has: system, processor cores, memory, graphics card, free disk, battery
  tier(info)             "low" | "normal" | "high" from a scan
  choose(setting, info)  the mode to use now. setting = "auto" (the scan decides, and a laptop on a low battery
                         drops to "low" by itself), or "low" / "normal" / "high" to force one.

LOW mode (old or small laptops): no voice clone (RVC), no Emotional voice (Chatterbox), the light offline voice
(Piper) instead of Kokoro, the small speech-recognition model, and a lighter 3D room (no shadows or glow).
Works on Windows, macOS and Linux; every check that fails just counts as "don't know".
"""
import os
import platform
import shutil
import subprocess
import sys

MODES = ("auto", "low", "normal", "high")
LOW_BATTERY = 20                 # % - on battery and at or under this, "auto" saves power
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def _run(cmd, timeout=4):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, creationflags=NO_WINDOW).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _gpu():
    """(name, memory in GB or None) of a graphics card worth using: NVIDIA (any system) or Apple Silicon."""
    if shutil.which("nvidia-smi"):
        out = _run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]).strip()
        if out:
            name, _, mem = out.splitlines()[0].partition(",")
            try:
                return name.strip(), round(float(mem) / 1024, 1)
            except ValueError:
                return name.strip(), None
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "Apple Silicon", None                  # shares the computer's memory, fast enough for everything
    return "", None                                  # built-in graphics: counts as "no separate graphics card"


def _strong_gpu(name, vram):
    n = (name or "").lower()
    if "apple" in n:
        return True
    if "nvidia" in n or "geforce" in n or "rtx" in n or "gtx" in n:
        return vram is None or vram >= 4
    if "radeon rx" in n or "arc a" in n:
        return True
    return False                                     # built-in (Intel UHD, Iris, Vega...) or unknown


def scan():
    info = {"system": {"win32": "Windows", "darwin": "macOS"}.get(sys.platform, platform.system() or sys.platform),
            "cores": os.cpu_count() or 0, "ram_gb": None, "disk_free_gb": None, "gpu": "", "vram_gb": None,
            "battery": None, "plugged": None}
    try:
        import psutil
        info["cores"] = psutil.cpu_count(logical=False) or info["cores"]
        info["ram_gb"] = round(psutil.virtual_memory().total / 1024 ** 3, 1)
        b = psutil.sensors_battery()
        if b is not None:
            info["battery"], info["plugged"] = int(b.percent), bool(b.power_plugged)
    except Exception:
        pass
    try:
        info["disk_free_gb"] = round(shutil.disk_usage(os.path.dirname(os.path.abspath(__file__))).free / 1024 ** 3, 1)
    except OSError:
        pass
    info["gpu"], info["vram_gb"] = _gpu()
    info["tier"] = tier(info)
    return info


def tier(info):
    ram, cores = info.get("ram_gb"), info.get("cores") or 0
    strong = _strong_gpu(info.get("gpu"), info.get("vram_gb"))
    if (ram is not None and ram < 6) or (cores and cores <= 2) or ((ram or 0) < 8 and cores <= 4 and not strong):
        return "low"
    if (ram or 0) >= 15 and cores >= 6 and strong:       # "16 GB" shows up as 15.7
        return "high"
    return "normal"


def on_low_battery(info):
    return info.get("battery") is not None and info.get("plugged") is False and info["battery"] <= LOW_BATTERY


def choose(setting, info):
    """The mode to use right now."""
    if setting in ("low", "normal", "high"):
        return setting
    if on_low_battery(info):
        return "low"
    return info.get("tier") or tier(info)


def why(setting, info):
    """One sentence for the Settings page."""
    mode = choose(setting, info)
    if setting != "auto":
        return f"You picked {mode}."
    if mode == "low" and on_low_battery(info):
        return f"Battery at {info['battery']}% and not charging, so she saves power until you plug in."
    bits = [f"{info.get('cores') or '?'} cores", f"{info.get('ram_gb') or '?'} GB memory",
            info.get("gpu") or "no separate graphics card"]
    return f"{', '.join(bits)}: {mode} fits this computer."


def summary(info):
    return {k: info.get(k) for k in ("system", "cores", "ram_gb", "disk_free_gb", "gpu", "vram_gb", "battery", "plugged", "tier")}


if __name__ == "__main__":                         # python brain/machine.py  -> what this computer has
    import json
    i = scan()
    print(json.dumps(summary(i), indent=2))
    print("auto ->", choose("auto", i), "|", why("auto", i))
