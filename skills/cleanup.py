"""cleanup.py - the clean-up wizard: finds big files, files you haven't used in a long time, hidden leftovers, big unused
folders and duplicates, in your own folders or on every hard drive and USB stick.
Nothing is deleted on its own: you tick what to remove and it goes to the Recycle Bin (you can still restore it).
USB sticks have no Recycle Bin, so what you remove from one is gone for good: the wizard marks those.
Only files found by the last scan can be removed.

Never listed: Windows and other system folders, the page file and friends, Vermeil's own folder, any "dnd" folder and
voice-model folders. Inside an installed app or game (Program Files, Steam...) files are only pointed out, with no
tick box: removing them would break it, so uninstall it instead.

"Last used" is the newest of a file's changed and opened dates. Windows doesn't always keep the opened date up to date,
so a file you did open can look unused: look before you tick."""
import hashlib
import os
import re
import stat
import sys
import time

from paths import BASE_DIR

# your own folders only: these are skipped
SKIP_NAMES = {".git", "node_modules", "__pycache__", "venv", ".venv", "site-packages", "appdata", "dnd", "$recycle.bin",
              "windows", "program files", "program files (x86)", "programdata", "onedrive temp"}
# every drive: never gone into, whatever the drive
SYSTEM_DIRS = {"windows", "$recycle.bin", "system volume information", "recovery", "$winreagent", "$windows.~bt", "$windows.~ws", "$sysreset",
               "boot", "efi", "perflogs", "config.msi", "msocache", "documents and settings", "dnd", ".git", ".ollama"}
SYSTEM_FILES = {"pagefile.sys", "hiberfil.sys", "swapfile.sys", "dumpstack.log", "dumpstack.log.tmp", "bootmgr", "desktop.ini", "thumbs.db", "ntuser.dat"}
# parts of a path that mean "this belongs to an installed app or game"
APP_DIR = re.compile(r"[\\/](program files( \(x86\))?|programdata|steamapps|steamlibrary|epic games|gog games|xboxgames|windowsapps|riot games|"
                     r"ubisoft game launcher)([\\/]|$)", re.I)
# ...and inside AppData, everything but its throw-away folders
APPDATA = re.compile(r"[\\/]appdata([\\/]|$)", re.I)
THROWAWAY = re.compile(r"[\\/](temp|tmp|cache|caches|cache2|code cache|gpucache|crashdumps|crashes|logs|d3dscache|inetcache|package cache)([\\/]|$)", re.I)
MY_FOLDERS = {"users", "documents", "downloads", "desktop", "pictures", "music", "videos", "onedrive", "appdata", "local", "roaming", "locallow"}
MODEL_EXT = (".pth", ".index")              # an RVC voice folder: never touched
MIN_DUP = 1024 * 1024                       # duplicates in your folders: only files from 1 MB (small ones aren't worth it)
MIN_DUP_ALL = 100 * 1024 * 1024             # on every drive: from 100 MB (comparing everything would take hours)
MAX_FULL_HASH = 8 * 1024 ** 3               # bigger than this isn't read all the way through to compare it
MIN_UNUSED_MB = 100                         # "not used for a long time" and "hidden": from this size
LIMITS = {"big": 300, "unused": 300, "hidden": 200, "folders": 150, "apps": 60}
FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM = 2, 4
CLOUD_ONLY = 0x1000 | 0x40000 | 0x400000    # offline / recall: a OneDrive file that isn't on this PC (it takes no space, reading it downloads it)
LINKS = (0xA0000003, 0xA000000C)            # junctions and symbolic links: they point somewhere else
_last = {"files": {}}                       # id -> (path, size or None for a folder, mtime) from the last scan
_stop = False


def default_roots(home=None):
    home = home or os.path.expanduser("~")
    names = ("Downloads", "Desktop", "Documents", "Videos", "Pictures", "Music")
    found = []
    for n in names:                          # OneDrive moves Desktop / Documents / Pictures into its own folder
        for p in (os.path.join(home, n), os.path.join(home, "OneDrive", n)):
            if os.path.isdir(p) and p not in found:
                found.append(p)
    return found


def drives():
    """every hard drive and USB stick -> [{"path", "kind": "disk" or "usb", "total_gb", "free_gb"}]"""
    if sys.platform != "win32":
        return [{"path": os.path.expanduser("~"), "kind": "disk", "total_gb": 0, "free_gb": 0}]
    import ctypes
    import shutil
    out = []
    mask = ctypes.windll.kernel32.GetLogicalDrives()
    for i in range(26):
        if not mask & (1 << i):
            continue
        path = f"{chr(65 + i)}:\\"
        kind = ctypes.windll.kernel32.GetDriveTypeW(path)
        if kind not in (2, 3):                # 2 = USB and the like, 3 = a hard drive. CD drives and network shares are left out.
            continue
        try:
            u = shutil.disk_usage(path)
        except OSError:
            continue                           # no card in the reader
        out.append({"path": path, "kind": "usb" if kind == 2 else "disk", "total_gb": round(u.total / 1024 ** 3), "free_gb": round(u.free / 1024 ** 3)})
    return out


def _protected_dir(path, names):
    low = os.path.basename(path).lower()
    if low in SKIP_NAMES or low.startswith("."):
        return True
    if os.path.normcase(os.path.abspath(path)) == os.path.normcase(os.path.abspath(BASE_DIR)):
        return True
    return any(n.lower().endswith(MODEL_EXT) for n in names)


def _never(path):
    """a folder the wizard won't go into on any drive"""
    low = os.path.basename(path.rstrip("\\/")).lower()
    return low in SYSTEM_DIRS or os.path.normcase(os.path.abspath(path)) == os.path.normcase(os.path.abspath(BASE_DIR))


def in_app(path):
    """part of an installed app or game (or an app's own data): not for removing by hand"""
    if APP_DIR.search(path):
        return True
    return bool(APPDATA.search(path)) and not THROWAWAY.search(path)


def stop():
    global _stop
    _stop = True


def _hash(path, limit=None):
    h = hashlib.sha1()
    before = os.stat(path)
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
    try:
        os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns))   # comparing a file doesn't count as using it
    except OSError:
        pass
    return h.hexdigest()


class _Scan:
    def __init__(self, big, unused_s, downloads, old_s, now, everything, min_dup, progress):
        self.big_b, self.unused_s, self.downloads, self.old_s, self.now = big, unused_s, downloads, old_s, now
        self.everything, self.min_dup, self.progress = everything, min_dup, progress
        self.lists = {"big": [], "unused": [], "hidden": [], "folders": [], "apps": [], "old": []}
        self.by_size = {}
        self.n = 0
        self.tops = []                       # the folders a walk started from: never offered as "a big folder"

    def file(self, e, st):
        p, size = e.path, st.st_size
        attrs = getattr(st, "st_file_attributes", 0)
        name = e.name
        if name.lower() in ("desktop.ini", "thumbs.db"):
            return (0, 0.0)                      # Windows puts these in any folder: they don't make it "in use"
        if attrs & FILE_ATTRIBUTE_SYSTEM or name.lower() in SYSTEM_FILES:
            return None
        if not self.everything and (name.startswith(".") or attrs & FILE_ATTRIBUTE_HIDDEN):
            return None
        cloud = bool(attrs & CLOUD_ONLY)
        self.n += 1
        if self.progress and self.n % 5000 == 0:
            self.progress(self.n, os.path.dirname(p))
        used = max(st.st_mtime, st.st_atime)
        row = (p, size, st.st_mtime, used)
        if cloud:
            return (0, st.st_mtime)              # it isn't taking space here
        if self.everything and in_app(p):
            if size >= self.big_b:
                self.lists["apps"].append(row)
            return (size, used, True)
        unused = self.now - used > self.unused_s
        if size >= self.big_b:
            self.lists["big"].append(row)
        if unused and size >= MIN_UNUSED_MB * 1048576:
            self.lists["unused"].append(row)
        if (attrs & FILE_ATTRIBUTE_HIDDEN or name.startswith(".")) and unused and size >= MIN_UNUSED_MB * 1048576:
            self.lists["hidden"].append(row)
        if os.path.normcase(os.path.abspath(p)).startswith(self.downloads + os.sep) and self.now - st.st_mtime > self.old_s:
            self.lists["old"].append(row)
        if size >= self.min_dup:
            self.by_size.setdefault(size, []).append((p, size, st.st_mtime))
        return (size, used)

    def walk(self, path):
        """-> (total size, newest use, something inside mustn't go)"""
        total, newest, blocked = 0, 0.0, False
        if _stop:
            return total, newest, True
        if self.everything:
            if _never(path):
                return 0, 0.0, True
        try:
            entries = list(os.scandir(path))
        except OSError:
            return 0, 0.0, True                  # no permission: leave it out, and don't offer the folder above it either
        if not self.everything and _protected_dir(path, [e.name for e in entries]):
            return 0, 0.0, True
        if self.everything and any(e.name.lower().endswith(MODEL_EXT) for e in entries):
            return 0, 0.0, True                  # a voice model folder
        for e in entries:
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            if getattr(st, "st_reparse_tag", 0) in LINKS or stat.S_ISLNK(st.st_mode):
                blocked = True
                continue
            if stat.S_ISDIR(st.st_mode):
                if not self.everything and (e.name.lower() in SKIP_NAMES or e.name.startswith(".")):
                    blocked = True
                    continue
                size, used, stuck = self.walk(e.path)
                total += size
                newest = max(newest, used)
                blocked = blocked or stuck
            elif stat.S_ISREG(st.st_mode):
                r = self.file(e, st)
                if r is None:
                    blocked = True                # system or hidden file we don't list: its folder stays
                    continue
                total += r[0]
                newest = max(newest, r[1])
                blocked = blocked or len(r) > 2
        if (self.everything and not blocked and total >= self.big_b and newest and self.now - newest > self.unused_s
                and os.path.basename(path).lower() not in MY_FOLDERS and path not in self.tops and len(os.path.normpath(path).split(os.sep)) > 2):
            self.lists["folders"].append((path, total, newest, newest))
        return total, newest, blocked


def _row(p, size, mtime, now, used=None, folder=False):
    fid = hashlib.sha1(f"{p}|{size}|{mtime}".encode("utf-8", "replace")).hexdigest()[:12]
    _last["files"][fid] = (p, None if folder else size, mtime)
    return {"id": fid, "path": p, "name": os.path.basename(p), "folder": os.path.dirname(p), "mb": round(size / 1048576, 1),
            "days": int((now - mtime) // 86400), "unused_days": int((now - (used or mtime)) // 86400), "is_folder": folder, "for_good": _no_bin(p)}


_usb = set()


def _no_bin(path):
    """USB sticks have no Recycle Bin: removing from one is for good"""
    return os.path.splitdrive(path)[0].upper() in _usb


def _duplicates(by_size, now, everything):
    dups = []
    for same in by_size.values():
        if len(same) < 2 or _stop:
            continue
        groups = {}
        for x in same:                      # first 64 KB, then the whole file
            try:
                groups.setdefault(_hash(x[0], 65536), []).append(x)
            except OSError:
                pass
        for g in groups.values():
            full = {}
            for x in g if len(g) > 1 and x_small(g, everything) else []:
                try:
                    full.setdefault(_hash(x[0]), []).append(x)
                except OSError:
                    pass
            for copies in full.values():
                if len(copies) > 1:
                    copies.sort(key=lambda x: x[2])           # the oldest copy stays
                    dups.append({"keep": _row(*copies[0], now), "extra": [_row(*c, now) for c in copies[1:]]})
    dups.sort(key=lambda g: -sum(e["mb"] for e in g["extra"]))
    return dups


def x_small(group, everything):
    return not everything or group[0][1] <= MAX_FULL_HASH


def scan(roots=None, big_mb=500, old_days=90, now=None, downloads=None, everything=False, unused_days=30, progress=None):
    """-> {"big", "unused", "hidden", "folders", "apps", "old": [...], "dups": [{"keep": row, "extra": [rows]}],
    "drives", "total_mb", "files", "seconds", "stopped"}. everything: every drive instead of your own folders."""
    global _stop
    _stop = False
    t0 = time.time()
    now = now or time.time()
    found = drives() if everything and not roots else []
    _usb.clear()
    _usb.update(os.path.splitdrive(d["path"])[0].upper() for d in found if d["kind"] == "usb")
    if everything and not roots:
        roots = [d["path"] for d in found]
    roots = [r for r in (roots or default_roots()) if os.path.isdir(r)]
    downloads = os.path.normcase(os.path.abspath(downloads or os.path.join(os.path.expanduser("~"), "Downloads")))
    _last["files"] = {}
    s = _Scan(big_mb * 1048576, unused_days * 86400, downloads, old_days * 86400, now, everything, MIN_DUP_ALL if everything else MIN_DUP, progress)
    s.tops = list(roots)
    for r in roots:
        s.walk(r)
    L = s.lists
    # a folder that's offered whole: not its folders or files as well
    tops = sorted((x[0] for x in L["folders"]), key=len)
    keep = []
    for p in tops:
        if not any(p.startswith(k + os.sep) for k in keep):
            keep.append(p)
    inside = lambda p: any(p.startswith(k + os.sep) for k in keep)
    L["folders"] = [x for x in L["folders"] if x[0] in keep]
    for k in ("big", "unused", "hidden", "old"):
        L[k] = [x for x in L[k] if not inside(x[0])]
    by_size = {size: [x for x in same if not inside(x[0])] for size, same in s.by_size.items()}
    size_first = lambda x: -x[1]
    out = {"files": s.n, "roots": roots, "drives": found, "big_mb": big_mb, "old_days": old_days, "unused_days": unused_days, "everything": everything}
    for k, rows in (("big", sorted(L["big"], key=size_first)), ("unused", sorted(L["unused"], key=size_first)), ("hidden", sorted(L["hidden"], key=size_first)),
                    ("apps", sorted(L["apps"], key=size_first))):
        out[k] = [_row(x[0], x[1], x[2], now, x[3]) for x in rows[:LIMITS[k]]]
    out["folders"] = [_row(x[0], x[1], x[2], now, x[3], folder=True) for x in sorted(L["folders"], key=size_first)[:LIMITS["folders"]]]
    out["old"] = [_row(x[0], x[1], x[2], now, x[3]) for x in sorted(L["old"], key=lambda x: x[2])[:200]]
    out["dups"] = _duplicates(by_size, now, everything)[:80]
    for x in out["apps"]:                    # for looking only: there's nothing to tick
        _last["files"].pop(x["id"], None)
    seen, total = set(), 0.0
    for r in out["big"] + out["unused"] + out["hidden"] + out["folders"] + out["old"] + [e for g in out["dups"] for e in g["extra"]]:
        if r["id"] not in seen:
            seen.add(r["id"])
            total += r["mb"]
    out["total_mb"] = round(total, 1)
    out["seconds"] = round(time.time() - t0, 1)
    out["stopped"] = _stop
    return out


def _to_recycle_bin(path):
    if sys.platform != "win32":
        try:
            from send2trash import send2trash
        except ImportError:
            raise OSError("Moving to the trash needs:  python -m pip install send2trash")
        send2trash(path)
        return
    import ctypes
    from ctypes import wintypes

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", wintypes.UINT), ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
                    ("fFlags", ctypes.c_uint16), ("fAnyOperationsAborted", wintypes.BOOL), ("hNameMappings", ctypes.c_void_p),
                    ("lpszProgressTitle", wintypes.LPCWSTR)]
    # FOF_WANTNUKEWARNING: if something is too big for the Recycle Bin, Windows asks before it's deleted for good
    FO_DELETE, FOF_SILENT, FOF_NOCONFIRMATION, FOF_ALLOWUNDO, FOF_NOERRORUI, FOF_WANTNUKEWARNING = 3, 4, 16, 64, 1024, 0x4000
    op = SHFILEOPSTRUCTW(None, FO_DELETE, os.path.abspath(path) + "\0", None,
                         FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_WANTNUKEWARNING, False, None, None)
    if ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op)) or op.fAnyOperationsAborted:
        raise OSError("Windows didn't move it to the Recycle Bin.")


def to_recycle_bin(ids, trash=None):
    """only what the last scan found, only if it hasn't changed since -> {"moved", "mb", "failed": [...]}"""
    moved, mb, failed = 0, 0.0, []
    for fid in ids or []:
        x = _last["files"].get(fid)
        if not x:
            failed.append({"id": fid, "why": "Scan again first."})
            continue
        p, size, mtime = x
        try:
            st = os.stat(p)
            if size is not None and (st.st_size != size or abs(st.st_mtime - mtime) > 1):
                failed.append({"id": fid, "path": p, "why": "It changed since the scan, so I left it."})
                continue
            (trash or _to_recycle_bin)(p)
            _last["files"].pop(fid, None)
            moved += 1
            mb += (size if size is not None else 0) / 1048576
        except OSError as e:
            failed.append({"id": fid, "path": p, "why": str(e) or e.__class__.__name__})
    return {"moved": moved, "mb": round(mb, 1), "failed": failed}
