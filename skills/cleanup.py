"""cleanup.py - the clean-up wizard: finds big files, old downloads and duplicate files in your own folders.
Nothing is deleted on its own: you tick what to remove and it goes to the Recycle Bin (you can still restore it).
Only files found by the last scan can be removed. Skipped on purpose: Vermeil's own folder, any "dnd" folder,
voice-model folders (they hold .pth / .index files), program and system folders, and anything hidden."""
import hashlib
import os
import sys
import time

from paths import BASE_DIR

SKIP_NAMES = {".git", "node_modules", "__pycache__", "venv", ".venv", "site-packages", "appdata", "dnd", "$recycle.bin",
              "windows", "program files", "program files (x86)", "programdata", "onedrive temp"}
MODEL_EXT = (".pth", ".index")              # an RVC voice folder: never touched
MIN_DUP = 1024 * 1024                       # duplicates: only files from 1 MB (small ones aren't worth it)
MAX_FILES = 150_000
_last = {"files": {}}                       # id -> (path, size, mtime) from the last scan


def default_roots(home=None):
    home = home or os.path.expanduser("~")
    names = ("Downloads", "Desktop", "Documents", "Videos", "Pictures", "Music")
    found = []
    for n in names:                          # OneDrive moves Desktop / Documents / Pictures into its own folder
        for p in (os.path.join(home, n), os.path.join(home, "OneDrive", n)):
            if os.path.isdir(p) and p not in found:
                found.append(p)
    return found


def _protected_dir(path, names):
    low = os.path.basename(path).lower()
    if low in SKIP_NAMES or low.startswith("."):
        return True
    if os.path.normcase(os.path.abspath(path)) == os.path.normcase(os.path.abspath(BASE_DIR)):
        return True
    return any(n.lower().endswith(MODEL_EXT) for n in names)


def _walk(roots):
    seen = 0
    for root in roots:
        for dirpath, dirs, files in os.walk(root):
            if _protected_dir(dirpath, files):
                dirs[:] = []
                continue
            dirs[:] = [d for d in dirs if d.lower() not in SKIP_NAMES and not d.startswith(".")]
            for f in files:
                if f.startswith(".") or f.lower() in ("desktop.ini", "thumbs.db"):
                    continue
                p = os.path.join(dirpath, f)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                if os.path.islink(p):
                    continue
                seen += 1
                if seen > MAX_FILES:
                    return
                yield p, st.st_size, st.st_mtime


def _hash(path, limit=None):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        left = limit
        while True:
            chunk = f.read(1 << 20 if left is None else min(1 << 20, left))
            if not chunk:
                break
            h.update(chunk)
            if left is not None:
                left -= len(chunk)
                if left <= 0:
                    break
    return h.hexdigest()


def _row(p, size, mtime, now):
    fid = hashlib.sha1(f"{p}|{size}|{mtime}".encode("utf-8", "replace")).hexdigest()[:12]
    _last["files"][fid] = (p, size, mtime)
    return {"id": fid, "path": p, "name": os.path.basename(p), "folder": os.path.dirname(p), "mb": round(size / 1048576, 1),
            "days": int((now - mtime) // 86400)}


def scan(roots=None, big_mb=500, old_days=90, now=None, downloads=None):
    """-> {"big": [...], "old": [...], "dups": [{"keep": row, "extra": [rows]}], "total_mb", "files", "seconds"}"""
    t0 = time.time()
    now = now or time.time()
    roots = [r for r in (roots or default_roots()) if os.path.isdir(r)]
    downloads = os.path.normcase(os.path.abspath(downloads or os.path.join(os.path.expanduser("~"), "Downloads")))
    _last["files"] = {}
    big, old, by_size, n = [], [], {}, 0
    for p, size, mtime in _walk(roots):
        n += 1
        if size >= big_mb * 1048576:
            big.append((p, size, mtime))
        if os.path.normcase(os.path.abspath(p)).startswith(downloads + os.sep) and now - mtime > old_days * 86400:
            old.append((p, size, mtime))
        if size >= MIN_DUP:
            by_size.setdefault(size, []).append((p, size, mtime))
    dups = []
    for same in by_size.values():
        if len(same) < 2:
            continue
        groups = {}
        for x in same:                      # first 64 KB, then the whole file
            try:
                groups.setdefault(_hash(x[0], 65536), []).append(x)
            except OSError:
                pass
        for g in groups.values():
            full = {}
            for x in g if len(g) > 1 else []:
                try:
                    full.setdefault(_hash(x[0]), []).append(x)
                except OSError:
                    pass
            for copies in full.values():
                if len(copies) > 1:
                    copies.sort(key=lambda x: x[2])           # the oldest copy stays
                    dups.append({"keep": _row(*copies[0], now), "extra": [_row(*c, now) for c in copies[1:]]})
    big.sort(key=lambda x: -x[1])
    old.sort(key=lambda x: x[2])
    dups.sort(key=lambda g: -sum(e["mb"] for e in g["extra"]))
    out = {"big": [_row(*x, now) for x in big[:60]], "old": [_row(*x, now) for x in old[:200]], "dups": dups[:80],
           "files": n, "roots": roots, "seconds": round(time.time() - t0, 1), "big_mb": big_mb, "old_days": old_days}
    out["total_mb"] = round(sum(r["mb"] for r in out["big"]) + sum(r["mb"] for r in out["old"]) +
                            sum(e["mb"] for g in out["dups"] for e in g["extra"]), 1)
    return out


def _to_recycle_bin(path):
    try:
        from send2trash import send2trash
        send2trash(path)
        return
    except ImportError:
        pass
    if sys.platform != "win32":
        raise OSError("Moving to the trash needs:  python -m pip install send2trash")
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT), ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
                    ("fFlags", ctypes.c_uint16), ("fAnyOperationsAborted", wintypes.BOOL), ("hNameMappings", ctypes.c_void_p),
                    ("lpszProgressTitle", wintypes.LPCWSTR)]
    FO_DELETE, FOF_SILENT, FOF_NOCONFIRMATION, FOF_ALLOWUNDO, FOF_NOERRORUI = 3, 4, 16, 64, 1024
    op = SHFILEOPSTRUCTW(None, FO_DELETE, os.path.abspath(path) + "\0", None,
                         FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI, False, None, None)
    if ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op)) or op.fAnyOperationsAborted:
        raise OSError("Windows didn't move it to the Recycle Bin.")


def to_recycle_bin(ids, trash=None):
    """only files from the last scan, only if they haven't changed since -> {"moved", "mb", "failed": [...]}"""
    moved, mb, failed = 0, 0.0, []
    for fid in ids or []:
        x = _last["files"].get(fid)
        if not x:
            failed.append({"id": fid, "why": "Scan again first."})
            continue
        p, size, mtime = x
        try:
            st = os.stat(p)
            if st.st_size != size or abs(st.st_mtime - mtime) > 1:
                failed.append({"id": fid, "path": p, "why": "It changed since the scan, so I left it."})
                continue
            (trash or _to_recycle_bin)(p)
            _last["files"].pop(fid, None)
            moved += 1
            mb += size / 1048576
        except OSError as e:
            failed.append({"id": fid, "path": p, "why": str(e) or e.__class__.__name__})
    return {"moved": moved, "mb": round(mb, 1), "failed": failed}
