"""
pc.py - controlling and watching your Windows PC.

Apps:      open_app, close_app (asks first), running_apps
Screen:    screenshot_b64 (for "what's on my screen?"), clipboard_text
System:    system_stats (CPU, RAM, GPU, disks, temperatures, battery), recent_crashes
Input:     media_key, type_text / press_keys / mouse_click (all ask first)
Files:     find_files, open_path, move_file / rename_file / make_folder (ask first)
Macros:    save_macro, run_macro, list_macros  (a list of tool steps you can repeat)
Alerts:    notify (Windows notification)
Safety:    emergency_stop() - stops speech, music, timers, macros and pending changes (Ctrl+Alt+Esc)
"""
import base64
import ctypes
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta

from paths import data_file

IS_WIN = sys.platform == "win32"
MACROS_FILE = data_file("macros.json")
HOME = os.path.expanduser("~")
stop_event = threading.Event()        # set by emergency_stop(); long jobs check it
on_emergency = []                     # app.py adds functions to run on emergency stop

KNOWN_APPS = {
    "notepad": "notepad", "calculator": "calc", "calc": "calc", "paint": "mspaint", "explorer": "explorer",
    "file explorer": "explorer", "files": "explorer", "task manager": "taskmgr", "cmd": "cmd", "command prompt": "cmd",
    "powershell": "powershell", "settings": "ms-settings:", "vscode": "code", "vs code": "code",
    "visual studio code": "code", "chrome": "chrome", "google chrome": "chrome", "edge": "msedge",
    "microsoft edge": "msedge", "firefox": "firefox", "word": "winword", "excel": "excel", "powerpoint": "powerpnt",
    "outlook": "outlook", "spotify": "spotify:", "discord": "discord:", "steam": "steam:", "camera": "microsoft.windows.camera:",
    "blender": "blender", "snipping tool": "snippingtool", "clock": "ms-clock:", "calendar": "outlookcal:",
}
PROCESS_NAMES = {"chrome": "chrome.exe", "google chrome": "chrome.exe", "edge": "msedge.exe", "microsoft edge": "msedge.exe",
                 "vscode": "Code.exe", "vs code": "Code.exe", "visual studio code": "Code.exe", "word": "WINWORD.EXE",
                 "excel": "EXCEL.EXE", "powerpoint": "POWERPNT.EXE", "spotify": "Spotify.exe", "discord": "Discord.exe",
                 "steam": "steam.exe", "notepad": "notepad.exe", "calculator": "CalculatorApp.exe", "blender": "blender.exe",
                 "firefox": "firefox.exe", "outlook": "OUTLOOK.EXE", "paint": "mspaint.exe", "roblox": "RobloxPlayerBeta.exe",
                 "roblox studio": "RobloxStudioBeta.exe", "obs": "obs64.exe", "zoom": "Zoom.exe", "teams": "ms-teams.exe"}
# never close these - closing them would break Windows or Vermeil
PROTECTED = {"explorer.exe", "python.exe", "pythonw.exe", "ollama.exe", "ollama app.exe", "msedgewebview2.exe",
             "csrss.exe", "winlogon.exe", "svchost.exe", "dwm.exe", "lsass.exe", "services.exe", "system"}


# ------------------------------------------------------------------ apps
def _start_menu_shortcuts():
    roots = [os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), r"Microsoft\Windows\Start Menu\Programs"),
             os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs"),
             os.path.join(HOME, "Desktop"), os.path.join(HOME, "OneDrive", "Desktop")]
    found = {}
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                if f.lower().endswith((".lnk", ".url", ".appref-ms")):
                    found.setdefault(os.path.splitext(f)[0].lower(), os.path.join(dirpath, f))
    return found


def open_app(name):
    """Open an app by name (also anything in the Start menu or on the desktop)."""
    key = (name or "").strip().lower()
    if not key:
        return "Which app?"
    if re.match(r"^https?://", key):
        import webbrowser
        webbrowser.open(name)
        return f"Opened {name}."
    if not IS_WIN:
        return "Opening apps only works on Windows."
    shortcuts = _start_menu_shortcuts()
    target = shortcuts.get(key)
    if not target:
        target = next((p for n, p in shortcuts.items() if key in n), None)       # "roblox" -> "roblox studio"
        if not target:
            import difflib                                                          # typos: "roblox studoi"
            match = difflib.get_close_matches(key, list(shortcuts), n=1, cutoff=0.75)
            target = shortcuts[match[0]] if match else None
    try:
        if target:
            os.startfile(target)
            return f"Opened {os.path.splitext(os.path.basename(target))[0]}."
        cmd = KNOWN_APPS.get(key)
        if cmd:
            if cmd.endswith(":"):
                os.startfile(cmd)
            else:
                subprocess.Popen(["cmd", "/c", "start", "", cmd], shell=False,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            return f"Opened {name}."
    except OSError as e:
        return f"Couldn't open {name}: {e}"
    return f"I couldn't find an app called {name} in the Start menu."


def _processes():
    import psutil
    return list(psutil.process_iter(["pid", "name"]))


def close_app(name):
    """Close every window of an app (asks first - see tools.py)."""
    key = (name or "").strip().lower()
    exe = PROCESS_NAMES.get(key, key if key.endswith(".exe") else f"{key}.exe").lower()
    if exe in PROTECTED:
        return f"I won't close {name} - Windows or Vermeil needs it."
    try:
        procs = [p for p in _processes() if (p.info.get("name") or "").lower() == exe]
    except ImportError:
        return "Closing apps needs psutil: python -m pip install psutil"
    if not procs:
        return f"{name} isn't running."
    for p in procs:
        try:
            p.terminate()
        except Exception:
            pass
    return f"Closed {name} ({len(procs)} process{'es' if len(procs) > 1 else ''})."


def running_apps():
    """Titles of the visible windows (what's open right now)."""
    if not IS_WIN:
        return []
    user32 = ctypes.windll.user32
    titles = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def each(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            n = user32.GetWindowTextLengthW(hwnd)
            if n:
                buf = ctypes.create_unicode_buffer(n + 1)
                user32.GetWindowTextW(hwnd, buf, n + 1)
                if buf.value.strip() and buf.value not in ("Program Manager", "Settings"):
                    titles.append(buf.value)
        return True
    user32.EnumWindows(each, 0)
    return titles


# ------------------------------------------------------------------ screen & clipboard
def screenshot_b64(max_width=1600):
    """Picture of the whole screen as a base64 JPEG (for the vision model)."""
    from PIL import ImageGrab
    img = ImageGrab.grab(all_screens=False).convert("RGB")
    if img.width > max_width:
        img = img.resize((max_width, int(img.height * max_width / img.width)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode()


def clipboard_text():
    if not IS_WIN:
        return ""
    CF_UNICODETEXT = 13
    user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
    user32.GetClipboardData.restype = ctypes.c_void_p
    kernel32.GlobalLock.restype = ctypes.c_void_p
    kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
    kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    if not user32.OpenClipboard(None):
        return ""
    try:
        handle = user32.GetClipboardData(CF_UNICODETEXT)
        if not handle:
            return ""
        ptr = kernel32.GlobalLock(handle)
        try:
            return ctypes.wstring_at(ptr) if ptr else ""
        finally:
            kernel32.GlobalUnlock(handle)
    finally:
        user32.CloseClipboard()


# ------------------------------------------------------------------ system
def _nvidia():
    try:
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                              "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout.strip()
        if out:
            name, util, used, total, temp = [x.strip() for x in out.splitlines()[0].split(",")]
            return {"name": name, "use_percent": float(util), "memory_used_gb": round(float(used) / 1024, 1),
                    "memory_total_gb": round(float(total) / 1024, 1), "temp_c": float(temp)}
    except Exception:
        pass
    return None


def _cpu_temp():
    try:
        import psutil
        temps = getattr(psutil, "sensors_temperatures", lambda: {})() or {}
        for entries in temps.values():
            if entries:
                return round(entries[0].current, 1)
    except Exception:
        pass
    if IS_WIN:   # works on many PCs (sometimes needs admin)
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-Command",
                                  "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature "
                                  "-ErrorAction Stop | Select-Object -First 1).CurrentTemperature"],
                                 capture_output=True, text=True, timeout=6,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout.strip()
            if out:
                return round(float(out) / 10 - 273.15, 1)
        except Exception:
            pass
    return None


def system_stats():
    import psutil
    vm = psutil.virtual_memory()
    disks = []
    for part in psutil.disk_partitions(all=False):
        try:
            u = psutil.disk_usage(part.mountpoint)
            disks.append({"drive": part.mountpoint, "used_percent": u.percent, "free_gb": round(u.free / 1024 ** 3, 1),
                          "total_gb": round(u.total / 1024 ** 3, 1)})
        except Exception:
            continue
    top = sorted(((p.info.get("memory_info").rss if p.info.get("memory_info") else 0, p.info.get("name"))
                  for p in psutil.process_iter(["name", "memory_info"])), reverse=True)[:5]
    battery = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
    return {"cpu_percent": psutil.cpu_percent(interval=0.5), "cpu_temp_c": _cpu_temp(),
            "ram_used_gb": round(vm.used / 1024 ** 3, 1), "ram_total_gb": round(vm.total / 1024 ** 3, 1),
            "ram_percent": vm.percent, "gpu": _nvidia(), "disks": disks,
            "battery": {"percent": battery.percent, "plugged_in": battery.power_plugged} if battery else None,
            "biggest_apps": [{"name": n, "ram_mb": round(b / 1024 ** 2)} for b, n in top if n]}


def stats_text():
    s = system_stats()
    gpu = s["gpu"]
    lines = [f"CPU {s['cpu_percent']:.0f}%" + (f", {s['cpu_temp_c']}°C" if s["cpu_temp_c"] else ""),
             f"RAM {s['ram_used_gb']}/{s['ram_total_gb']} GB ({s['ram_percent']:.0f}%)"]
    if gpu:
        lines.append(f"GPU {gpu['name']}: {gpu['use_percent']:.0f}%, {gpu['memory_used_gb']}/{gpu['memory_total_gb']} GB, {gpu['temp_c']:.0f}°C")
    lines += [f"Disk {d['drive']} {d['used_percent']:.0f}% used, {d['free_gb']} GB free" for d in s["disks"]]
    if s["battery"]:
        lines.append(f"Battery {s['battery']['percent']:.0f}%{' (charging)' if s['battery']['plugged_in'] else ''}")
    lines.append("Using the most RAM: " + ", ".join(f"{a['name']} ({a['ram_mb']} MB)" for a in s["biggest_apps"]))
    return "\n".join(lines)


def recent_crashes(hours=48):
    """App crashes and hangs from the Windows event log (Application Error / Hang)."""
    if not IS_WIN:
        return []
    since = (datetime.now() - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%S")
    ps = ("Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000,1002; StartTime='" + since + "'} "
          "-MaxEvents 20 -ErrorAction SilentlyContinue | Select-Object TimeCreated, Id, Message | ConvertTo-Json -Compress")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=20,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout.strip()
        data = json.loads(out) if out else []
    except Exception:
        return []
    data = data if isinstance(data, list) else [data]
    crashes = []
    for ev in data:
        msg = ev.get("Message") or ""
        app = re.search(r"(?:Faulting application name|The program)\s*:?\s*([^\s,]+\.exe)", msg, re.I)
        module = re.search(r"Faulting module name:\s*([^\s,]+)", msg, re.I)
        code = re.search(r"Exception code:\s*(0x[0-9a-fA-F]+)", msg)
        when = str(ev.get("TimeCreated", ""))
        m = re.search(r"/Date\((\d+)", when)
        when = datetime.fromtimestamp(int(m.group(1)) / 1000).strftime("%Y-%m-%d %H:%M") if m else when[:16]
        crashes.append({"when": when, "app": app.group(1) if app else "unknown", "kind": "hang" if ev.get("Id") == 1002 else "crash",
                        "module": module.group(1) if module else "", "code": code.group(1) if code else ""})
    return crashes


def crashes_text():
    c = recent_crashes()
    if not c:
        return "No app crashes in the last 2 days."
    return "\n".join(f"{x['when']}: {x['app']} {x['kind']}" + (f" in {x['module']}" if x["module"] else "")
                     + (f" (code {x['code']})" if x["code"] else "") for x in c) + \
        "\n(Suggest likely causes and fixes for the user in simple steps.)"


# ------------------------------------------------------------------ keyboard, mouse, media
MEDIA = {"play": "play/pause media", "pause": "play/pause media", "play/pause": "play/pause media",
         "next": "next track", "previous": "previous track", "mute": "volume mute"}


def media_key(action):
    """Control whatever is playing (Spotify, YouTube in the browser...)."""
    key = MEDIA.get((action or "").lower())
    if not key:
        return f"Unknown media action {action}."
    import keyboard
    keyboard.send(key)
    return f"Sent {action}."


def type_text(text):
    import keyboard
    if stop_event.is_set():
        return "Stopped."
    keyboard.write(text, delay=0.01)
    return f"Typed {len(text)} characters."


def press_keys(keys):
    import keyboard
    if stop_event.is_set():
        return "Stopped."
    keyboard.send(keys)
    return f"Pressed {keys}."


def mouse_click(x, y, button="left", double=False):
    if not IS_WIN:
        return "Mouse control only works on Windows."
    if stop_event.is_set():
        return "Stopped."
    user32 = ctypes.windll.user32
    user32.SetCursorPos(int(x), int(y))
    down, up = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010)}.get(button, (0x0002, 0x0004))
    for _ in range(2 if double else 1):
        user32.mouse_event(down, 0, 0, 0, 0)
        user32.mouse_event(up, 0, 0, 0, 0)
        time.sleep(0.05)
    return f"Clicked at {x}, {y}."


def screen_size():
    if not IS_WIN:
        return (1920, 1080)
    return ctypes.windll.user32.GetSystemMetrics(0), ctypes.windll.user32.GetSystemMetrics(1)


# ------------------------------------------------------------------ files
SEARCH_ROOTS = ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music",
                os.path.join("OneDrive", "Desktop"), os.path.join("OneDrive", "Documents")]
TYPE_EXT = {"pdf": [".pdf"], "word": [".docx", ".doc"], "document": [".docx", ".doc", ".pdf", ".txt", ".odt"],
            "excel": [".xlsx", ".xls", ".csv"], "spreadsheet": [".xlsx", ".xls", ".csv"], "powerpoint": [".pptx", ".ppt"],
            "slides": [".pptx", ".ppt"], "image": [".png", ".jpg", ".jpeg", ".gif", ".webp"], "photo": [".png", ".jpg", ".jpeg", ".heic"],
            "video": [".mp4", ".mov", ".mkv", ".avi"], "music": [".mp3", ".wav", ".flac", ".m4a"], "code": [".py", ".js", ".html", ".css", ".lua"],
            "zip": [".zip", ".rar", ".7z"], "3d": [".blend", ".glb", ".gltf", ".fbx", ".obj", ".vrm"]}


def find_files(words="", kind="", days=None, limit=25):
    """Search your usual folders by name words, file type and how recently it changed."""
    words = [w for w in re.findall(r"\w+", (words or "").lower()) if len(w) > 1]
    exts = TYPE_EXT.get((kind or "").lower().rstrip("s"), TYPE_EXT.get((kind or "").lower(), []))
    since = time.time() - float(days) * 86400 if days else None
    hits, seen = [], set()
    for rel in SEARCH_ROOTS:
        root = os.path.join(HOME, rel)
        if not os.path.isdir(root):
            continue
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if not d.startswith((".", "node_modules", "__pycache__", "venv", "AppData"))]
            if dirpath.count(os.sep) - root.count(os.sep) > 5:
                dirs[:] = []
            for f in files:
                low = f.lower()
                if exts and not low.endswith(tuple(exts)):
                    continue
                if words and not all(w in low for w in words):
                    continue
                path = os.path.join(dirpath, f)
                if path in seen:
                    continue
                try:
                    mtime = os.path.getmtime(path)
                except OSError:
                    continue
                if since and mtime < since:
                    continue
                seen.add(path)
                hits.append((mtime, path))
            if stop_event.is_set():
                break
    hits.sort(reverse=True)
    return [{"path": p, "name": os.path.basename(p), "modified": datetime.fromtimestamp(m).strftime("%Y-%m-%d %H:%M")}
            for m, p in hits[:limit]]


def find_files_text(words="", kind="", days=None):
    hits = find_files(words, kind, days)
    if not hits:
        return "No matching files in Desktop, Documents, Downloads, Pictures, Videos or Music."
    return "\n".join(f"{h['name']} - {h['path']} (changed {h['modified']})" for h in hits)


def _safe_path(path):
    path = os.path.abspath(os.path.expanduser(path or ""))
    if not path.lower().startswith(HOME.lower()):
        raise ValueError("I only manage files inside your user folder.")
    return path


def open_path(path):
    path = _safe_path(path)
    if not os.path.exists(path):
        return f"{path} doesn't exist."
    if IS_WIN:
        os.startfile(path)
    return f"Opened {os.path.basename(path)}."


def make_folder(path):
    path = _safe_path(path)
    os.makedirs(path, exist_ok=True)
    return f"Made the folder {path}."


def move_file(path, to_folder):
    src, dest = _safe_path(path), _safe_path(to_folder)
    if not os.path.exists(src):
        return f"{src} doesn't exist."
    os.makedirs(dest, exist_ok=True)
    final = shutil.move(src, os.path.join(dest, os.path.basename(src)))
    return f"Moved to {final}."


def rename_file(path, new_name):
    src = _safe_path(path)
    if not os.path.exists(src) or os.sep in new_name or "/" in new_name:
        return "Can't rename that."
    dest = os.path.join(os.path.dirname(src), new_name)
    if os.path.exists(dest):
        return f"{new_name} already exists."
    os.rename(src, dest)
    return f"Renamed to {new_name}."


# ------------------------------------------------------------------ macros (repeat a list of steps)
def _macros():
    try:
        with open(MACROS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_macro(name, steps):
    """steps: [{"tool": "open_app", "args": {"name": "spotify"}}, {"tool": "set_volume", "args": {"percent": 30}}]"""
    name = (name or "").strip().lower()
    if not name or not isinstance(steps, list) or not steps:
        return "A macro needs a name and at least one step."
    import tools
    bad = [s.get("tool") for s in steps if not isinstance(s, dict) or s.get("tool") not in tools._ACTIONS
           or s.get("tool") in ("run_macro", "save_macro")]
    if bad:
        return f"Unknown steps: {bad}"
    data = _macros()
    data[name] = {"steps": steps, "created": datetime.now().strftime("%Y-%m-%d %H:%M")}
    with open(MACROS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return f"Saved the macro '{name}' with {len(steps)} steps. Say 'run {name}' to use it."


def list_macros():
    data = _macros()
    if not data:
        return "No macros yet."
    return "\n".join(f"{n}: " + " → ".join(s["tool"] for s in m["steps"]) for n, m in data.items())


def delete_macro(name):
    data = _macros()
    if data.pop((name or "").strip().lower(), None) is None:
        return "No macro with that name."
    with open(MACROS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return "Deleted."


def run_macro(name, confirm=None):
    import tools
    m = _macros().get((name or "").strip().lower())
    if not m:
        return f"No macro called {name}. You have: {', '.join(_macros()) or 'none'}."
    stop_event.clear()
    out = []
    for i, step in enumerate(m["steps"], 1):
        if stop_event.is_set():
            out.append("Stopped by emergency stop.")
            break
        result = tools.run_tool(step["tool"], step.get("args", {}), confirm=confirm)
        out.append(f"{i}. {step['tool']}: {result[:120]}")
        time.sleep(float(step.get("wait", 0.4)))
    return "\n".join(out)


# ------------------------------------------------------------------ notifications & emergency stop
def notify(title, message):
    """Windows notification (bottom-right). Uses winotify if installed, else PowerShell."""
    if not IS_WIN:
        return False
    try:
        from winotify import Notification
        Notification(app_id="Vermeil", title=title, msg=message[:250]).show()
        return True
    except ImportError:
        pass
    except Exception as e:
        print(f"[notify] {e}")
    esc = lambda t: t.replace("'", "''")
    ps = ("[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
          "$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
          f"$x = $t.GetElementsByTagName('text'); $x.Item(0).AppendChild($t.CreateTextNode('{esc(title)}')) > $null;"
          f"$x.Item(1).AppendChild($t.CreateTextNode('{esc(message[:250])}')) > $null;"
          "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Vermeil').Show([Windows.UI.Notifications.ToastNotification]::new($t))")
    try:
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return True
    except Exception:
        return False


def emergency_stop():
    """Stop everything that's running right now."""
    stop_event.set()
    done = []
    for fn in list(on_emergency):
        try:
            fn()
            done.append(getattr(fn, "__name__", "stopped"))
        except Exception as e:
            print(f"[emergency] {e}")
    threading.Timer(2.0, stop_event.clear).start()      # ready for new commands after a moment
    return "Stopped everything."
