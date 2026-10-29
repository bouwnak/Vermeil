"""Find which cameras and microphones on this PC actually work.

Laptops differ: the webcam may be number 0 or 1, and the microphone number that
worked on one PC is often a speaker (or nothing) on another. These helpers test
each device so the app can pick a working one and show a list in Settings.
"""
import os
import threading
import time

_cache = {"cameras": None, "at": 0.0}
_lock = threading.Lock()


def _backends(cv2):
    # DirectShow first: on many laptops Media Foundation opens the camera but can't grab
    # frames (the "MSMF can't grab frame" warning).
    return [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY] if os.name == "nt" else [cv2.CAP_ANY]


def open_camera(index, warmup=15):
    """Open camera `index` with the first backend that really returns pictures.
    Some webcams send empty frames for the first few reads, so retry a little."""
    import cv2
    os.environ.setdefault("OPENCV_VIDEOIO_PRIORITY_OBSENSOR", "0")
    for backend in _backends(cv2):
        cap = cv2.VideoCapture(index, backend)
        if cap.isOpened():
            for _ in range(warmup):
                ok, frame = cap.read()
                if ok and frame is not None and frame.size:
                    return cap
                time.sleep(0.05)
        cap.release()
    return None


def list_cameras(max_index=5, fresh=False):
    """[{index, name, ok}] for every camera number that gives a picture."""
    with _lock:
        if not fresh and _cache["cameras"] is not None and time.time() - _cache["at"] < 60:
            return _cache["cameras"]
        found = []
        try:
            import cv2
            cv2.setLogLevel(0) if hasattr(cv2, "setLogLevel") else None
        except Exception:
            return []
        names = _camera_names()
        misses = 0
        for i in range(max_index):
            cap = open_camera(i, warmup=6)
            if cap is None:
                misses += 1
                if misses >= 2 and i >= 1:        # two empty numbers in a row: nothing more to find
                    break
                continue
            misses = 0
            cap.release()
            found.append({"index": i, "name": names[i] if i < len(names) else f"Camera {i + 1}", "ok": True})
        _cache.update(cameras=found, at=time.time())
        return found


def _camera_names():
    """Friendly webcam names from Windows (best effort, same order DirectShow uses)."""
    if os.name != "nt":
        return []
    try:
        import subprocess
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPClass -in 'Camera','Image' } | "
             "ForEach-Object { $_.Name }"],
            capture_output=True, text=True, timeout=6,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return [ln.strip() for ln in out.stdout.splitlines() if ln.strip()]
    except Exception:
        return []


def list_mics():
    """[{index, name, default}] input devices that can record (one entry per name)."""
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        default_in = sd.default.device[0] if isinstance(sd.default.device, (list, tuple)) else sd.default.device
    except Exception:
        return []
    out, seen = [], set()
    try:
        apis = sd.query_hostapis()
        mme = next((i for i, a in enumerate(apis) if "MME" in a["name"]), None)
    except Exception:
        mme = None
    for i, d in enumerate(devices):
        if d.get("max_input_channels", 0) < 1:
            continue
        if mme is not None and d.get("hostapi") != mme:      # MME numbers are the ones PyAudio/SpeechRecognition use
            continue
        name = d["name"].strip()
        if name in seen or "Sound Mapper" in name or "Primary Sound" in name:
            continue
        seen.add(name)
        out.append({"index": i, "name": name, "default": i == default_in})
    return out


def pick_mic(saved):
    """Saved choice if it still exists and records, otherwise the Windows default (None)."""
    if saved is None or saved == "" or int(saved) < 0:
        return None
    mics = list_mics()
    if not mics:
        return None
    return int(saved) if any(m["index"] == int(saved) for m in mics) else None


def pick_camera(saved):
    """Saved camera number if it works, otherwise the first working camera (or 0)."""
    try:
        saved = int(saved)
    except (TypeError, ValueError):
        saved = -1
    if saved >= 0:
        return saved
    cams = list_cameras()
    return cams[0]["index"] if cams else 0
