"""
retroplay.py - pressing Play on a Retro Game: everything happens behind the loading screen.

How it works (beginner version):
1. Is the game already on this PC? Then nothing is downloaded.
2. If not, a hidden browser (Playwright, using your Edge/Chrome) opens the game's page on the website, presses its
   download button. No window ever opens. The site counts down first, which can take over 30 seconds, and it can also
   refuse: then the loading screen says so. Once the site has started the download the app fetches that same link
   itself, so the loading screen shows real numbers. The site is often slow (a 200 MB game can take 20 minutes).
3. RetroArch (the emulator) and the "core" for that console are looked for. Whatever is missing is downloaded.
4. RetroArch opens with the game.

The phone can't run RetroArch: prepare() and progress() only get the file, and the phone's own player opens it.
"""
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import zipfile
from pathlib import Path

import requests

import retrogames
from paths import data_file

APP_ROOT = Path(__file__).resolve().parent.parent
HOME_EMULATORS = APP_ROOT / "tools" / "emulators"       # RetroArch goes here when it has to be downloaded
RETROARCH_VERSION = "1.19.1"
RETROARCH_URLS = [f"https://buildbot.libretro.com/stable/{RETROARCH_VERSION}/windows/x86_64/RetroArch.7z",
                  "https://buildbot.libretro.com/nightly/windows/x86_64/RetroArch.7z"]
CORE_URL = "https://buildbot.libretro.com/nightly/windows/x86_64/latest/{}.dll.zip"
UA = retrogames.UA["User-Agent"]

# system id -> (core file, the name shown while it downloads, the phone player's name for it or "")
CORES = {
    "nes": ("fceumm_libretro", "FCEUmm", "nes"), "snes": ("snes9x_libretro", "Snes9x", "snes"), "n64": ("mupen64plus_next_libretro", "Mupen64Plus-Next", "n64"),
    "gb": ("gambatte_libretro", "Gambatte", "gb"), "gbc": ("gambatte_libretro", "Gambatte", "gb"), "gba": ("mgba_libretro", "mGBA", "gba"),
    "nds": ("melonds_libretro", "melonDS", "nds"), "3ds": ("citra_libretro", "Citra", ""), "gc_wii": ("dolphin_libretro", "Dolphin", ""),
    "genesis": ("genesis_plus_gx_libretro", "Genesis Plus GX", "segaMD"), "sms": ("genesis_plus_gx_libretro", "Genesis Plus GX", "segaMS"),
    "gg": ("genesis_plus_gx_libretro", "Genesis Plus GX", "segaGG"), "sega32x": ("picodrive_libretro", "PicoDrive", "sega32x"),
    "dreamcast": ("flycast_libretro", "Flycast", ""), "psx": ("pcsx_rearmed_libretro", "PCSX ReARMed", "psx"), "ps2": ("pcsx2_libretro", "LRPS2", ""),
    "psp": ("ppsspp_libretro", "PPSSPP", ""), "pce": ("mednafen_pce_fast_libretro", "Beetle PCE Fast", "pce"), "atari2600": ("stella_libretro", "Stella", "atari2600"),
    "arcade": ("fbneo_libretro", "FinalBurn Neo", ""),
}
ARCADE_ALSO = ["mame2003_plus_libretro", "mame2000_libretro"]     # the site's arcade files come from many MAME versions
# the website's console -> system id
PLATFORM_SYSTEM = {"nintendo": "nes", "super-nintendo": "snes", "nintendo-64": "n64", "gameboy": "gb", "gameboy-color": "gbc", "gameboy-advance": "gba",
                   "nintendo-ds": "nds", "nintendo-3ds": "3ds", "gamecube": "gc_wii", "nintendo-wii": "gc_wii", "sega-genesis": "genesis",
                   "sega-master-system": "sms", "game-gear": "gg", "sega-32x": "sega32x", "dreamcast": "dreamcast", "playstation": "psx",
                   "playstation-2": "ps2", "playstation-portable": "psp", "turbografx-16": "pce", "atari-2600": "atari2600", "mame-037b11": "arcade"}
# file types that belong to one console, best first (an archive's game is the first of these it holds)
ROM_SYSTEM = {".nds": "nds", ".3ds": "3ds", ".cci": "3ds", ".cia": "3ds", ".gba": "gba", ".agb": "gba", ".gbc": "gbc", ".gb": "gb", ".sfc": "snes", ".smc": "snes",
              ".n64": "n64", ".z64": "n64", ".v64": "n64", ".nes": "nes", ".md": "genesis", ".gen": "genesis", ".smd": "genesis", ".sms": "sms", ".gg": "gg",
              ".32x": "sega32x", ".rvz": "gc_wii", ".gcm": "gc_wii", ".wbfs": "gc_wii", ".gcz": "gc_wii", ".gdi": "dreamcast", ".cdi": "dreamcast",
              ".pce": "pce", ".a26": "atari2600"}
# disc files any disc console can use: the game's console decides. A .cue or .gdi needs the track files next to it.
DISC_TYPES = [".cue", ".chd", ".pbp", ".cso", ".iso", ".img", ".mdf", ".bin"]
ARCHIVES = {".zip", ".7z", ".rar"}
DOWNLOAD_TYPES = set(ROM_SYSTEM) | set(DISC_TYPES) | ARCHIVES   # anything else a site tries to give us is ignored (ads, installers...)

COMMAND_PORT = 55355
STARTUP_WAIT = 6.0           # seconds a game must stay open to count as started
STALL_LIMIT = 120            # seconds with nothing arriving before a download counts as dead
LAUNCH_SETTINGS = {
    "input_toggle_fullscreen": "nul",            # F (and H, restart) are too easy to hit while playing: the bar has both
    "input_reset": "nul",
    "network_cmd_enable": "true",                # the bar's buttons (skills/retrobar.py)
    "network_cmd_port": COMMAND_PORT,
    "pause_nonactive": "false",                  # pressing the bar mustn't pause the game
    "config_save_on_exit": "false",              # these settings stay out of RetroArch's own file
    "core_info_cache_enable": "false",           # a half-written cache file makes RetroArch crash at the start
    "quit_press_twice": "false",                 # the bar's Back closes the game at once
    "confirm_quit": "false",
}

_jobs = {}
_jobs_lock = threading.Lock()


def same_console(a, b):
    """Game Boy and Game Boy Color files run on each other; any other console's file is the wrong game"""
    return a == b or {a, b} == {"gb", "gbc"}


# ---------------- the browser: press the game page's download button ----------------
BUTTONS_JS = r"""
() => {
  const selector = 'a[href], button, input[type="submit"], input[type="button"], [role="button"], [download], [class*="download" i], [id*="download" i], [data-url], [data-href], [onclick*="download" i]';
  const all = (root) => {
    const out = Array.from(root.querySelectorAll(selector));
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...all(el.shadowRoot));
    return out;
  };
  const results = [], seen = new Set();
  let n = 0;
  for (const el of all(document)) {
    if (seen.has(el)) continue;
    seen.add(el);
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) continue;
    const id = 'vermeil_dl_' + (++n);
    el.setAttribute('data-vermeil-dl', id);
    const form = el.closest('form');
    results.push({
      id, tag: el.tagName.toLowerCase(),
      href: el.href || el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('data-url') || (form ? form.action : '') || '',
      text: (el.innerText || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 300),
      title: (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim().slice(0, 200),
      attrs: [typeof el.className === 'string' ? el.className : '', el.id || '', el.getAttribute('onclick') || ''].join(' ').slice(0, 400).toLowerCase(),
      hasDownload: el.hasAttribute('download'),
    });
  }
  return results;
}
"""


def score_button(item, title):
    """how much an element on a game's page looks like its real download button (under 32 = it doesn't)"""
    from rapidfuzz import fuzz
    href, words = item.get("href", ""), f"{item.get('text', '')} {item.get('title', '')}".lower()
    attrs = item.get("attrs", "")
    path = urllib.parse.unquote(urllib.parse.urlparse(href).path) if href else ""
    name, ext = os.path.basename(path).lower(), os.path.splitext(path)[1].lower()
    score = 0.0
    if ext in DOWNLOAD_TYPES:
        score += 70 + (fuzz.WRatio(title.lower(), name) * 0.35 if name else 0)
    if item.get("hasDownload"):
        score += 50
    if re.search(r"\b(direct\s+download|download\s+now|download\s+rom|download\s+game|save\s+game|start\s+download|click\s+here\s+to\s+download|get\s+rom|download)\b", words):
        score += 60
    elif "click here" in words and ("download" in attrs or "download" in href.lower() or ext in DOWNLOAD_TYPES):
        score += 62
    elif any(w in words for w in ("download", "get file", ".zip", ".7z", "mirror", "click here")):
        score += 38
    if "download" in attrs or "/download" in path.lower():
        score += 28
    if item.get("tag") in ("a", "button", "input"):
        score += 12
    if href.startswith("magnet:") or ext == ".torrent" or "torrent" in words:
        score -= 60
    if any(bad in words for bad in ("login", "register", "sign up", "sponsor", "ad ", "patreon", "emulator", "vpn")):
        score -= 65
    return score


class SiteRefused(RuntimeError):
    """the page was fine, but no file came"""


class FileGone(RuntimeError):
    """the site gave a "404 Not Found" page in place of the game: it has lost the file"""


class BadFile(RuntimeError):
    """the file arrived, but no game can be opened from it"""


class Cancelled(RuntimeError):
    """you pressed Cancel on the loading screen"""


def _left(seconds):
    return "under a minute left" if seconds < 60 else f"about {round(seconds / 60)} min left"


def fetch_game(url, path, cookies, referer, say, cancelled=lambda: False):
    """the file behind a started download -> path. Shows MB and time left, carries on if the connection drops,
    and only gives up when nothing has arrived for STALL_LIMIT seconds."""
    part = path + ".part"
    got, total, last_data, started, start_got = 0, 0, time.time(), time.time(), 0
    while True:
        if os.path.exists(part):
            got = os.path.getsize(part)
        headers = {"User-Agent": UA, "Referer": referer, **({"Range": f"bytes={got}-"} if got else {})}
        try:
            with requests.get(url, headers=headers, cookies=cookies, stream=True, timeout=(20, STALL_LIMIT)) as r:
                if r.status_code == 416:            # we already have all of it
                    break
                r.raise_for_status()
                if got and r.status_code != 206:    # this server can't carry on from the middle
                    got = 0
                if not total:
                    total = got + int(r.headers.get("Content-Length") or 0)
                with open(part, "ab" if got else "wb") as f:
                    for chunk in r.iter_content(256 * 1024):
                        if cancelled():
                            raise Cancelled("Cancelled.")
                        if not got and chunk[:64].lstrip()[:5].lower() in (b"<!doc", b"<html"):
                            raise FileGone("The games site has lost this game's file. Try another game, or another version of it.")
                        f.write(chunk)
                        got += len(chunk)
                        last_data = time.time()
                        speed = (got - start_got) / max(time.time() - started, 1)
                        if total:
                            left = (total - got) / max(speed, 1)
                            say(f"Downloading the game · {got / 1048576:.0f} of {total / 1048576:.0f} MB · {_left(left)}", 0.1 + 0.33 * got / total)
                        else:
                            say(f"Downloading the game · {got / 1048576:.0f} MB", 0.2)
            if not total or got >= total:
                break
        except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError) as e:
            print(f"[retro play] connection dropped at {got / 1048576:.0f} MB: {type(e).__name__}")
        if cancelled():
            raise Cancelled("Cancelled.")
        if time.time() - last_data > STALL_LIMIT:
            raise RuntimeError("The games site stopped sending the file.")
        time.sleep(2)
    os.replace(part, path)
    return path


def _parts_needed(name):
    """"Game.7z.001": the site gives only the first of several parts, so it can't be opened"""
    return bool(re.search(r"\.\d{3}$", name or ""))


class SiteBrowser:
    """one hidden browser for one game: it never opens a window"""
    say = staticmethod(lambda text, pct: None)
    cancelled = staticmethod(lambda: False)

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        try:
            self.browser = self._launch()
            self.context = self.browser.new_context(accept_downloads=True, viewport={"width": 1280, "height": 820}, user_agent=UA)
            self.got = []
            self.context.on("page", lambda p: p.on("download", self._on_download))
            self.page = self.context.new_page()
        except Exception:
            self._pw.stop()
            raise
        return self

    def __exit__(self, *_):
        try:
            self.context.close()
            self.browser.close()
        except Exception:
            pass
        self._pw.stop()

    def _launch(self):
        for channel in ("chrome", "msedge", None):
            try:
                return self._pw.chromium.launch(channel=channel, headless=True)
            except Exception:
                continue
        raise RuntimeError("no Chrome or Edge to download with")

    def _on_download(self, download):
        ext = os.path.splitext(download.suggested_filename or "")[1].lower()
        if ext in DOWNLOAD_TYPES or _parts_needed(download.suggested_filename):
            self.got.append(download)
        else:                                       # an ad or an installer: never kept, never opened
            print(f"[retro play] ignored a download that isn't a game: {download.suggested_filename}")

    def _settle(self, ms=1500):
        try:
            self.page.wait_for_load_state("networkidle", timeout=min(ms + 1500, 4000))
        except Exception:
            pass
        self.page.wait_for_timeout(ms)

    def _press_download(self, title, pressed):
        found = []
        for frame in self.page.frames:
            try:
                items = frame.evaluate(BUTTONS_JS)
            except Exception:
                continue
            found += [(score_button(i, title), frame, i) for i in items]
        found = sorted((f for f in found if f[0] >= 32), key=lambda f: -f[0])
        for _, frame, item in found[:4]:
            sig = f"{item['tag']}::{item['text']}::{item['href']}"
            if sig in pressed:
                continue
            pressed.add(sig)
            try:
                loc = frame.locator(f'[data-vermeil-dl="{item["id"]}"]').first
                if loc.count() and loc.is_visible():
                    loc.scroll_into_view_if_needed(timeout=2500)
                    loc.click(timeout=5000)
                    for _ in range(8):
                        if self.got:
                            return True
                        self.page.wait_for_timeout(400)
                    return True
            except Exception as e:
                if self.got or "Download is starting" in str(e):
                    return True
        return False

    def download(self, item_url, title, folder, wait_seconds=75):
        """open a game's page, press its download button, wait for the file -> its path"""
        self.got.clear()
        try:
            self.page.goto(item_url, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            if not self.got and "Download is starting" not in str(e):
                raise
        self._settle(1500)
        pressed = set()
        if not self.got:
            self._press_download(title, pressed)
        # many sites count down 5-8 seconds first; after that, look for a "click here" link on the page it went to
        deadline = time.time() + wait_seconds
        tick = 0
        while not self.got and time.time() < deadline and self.context.pages:
            self.page.wait_for_timeout(500)
            tick += 1
            if tick in (18, 40, 80):
                self.page = self.context.pages[-1]
                self._press_download(title, pressed)
        if not self.got:
            raise SiteRefused("the site didn't give the file")
        download = self.got[0]
        if _parts_needed(download.suggested_filename):
            download.cancel()
            raise FileGone("This game only comes in several parts on the games site, so it can't be opened. Try another version of it.")
        path = os.path.join(folder, re.sub(r'[<>:"/\\|?*]', "_", download.suggested_filename))
        link = download.url
        cookies = {c["name"]: c["value"] for c in self.context.cookies(link)}
        download.cancel()                           # the app takes it from here, with real numbers
        return fetch_game(link, path, cookies, item_url, self.say, self.cancelled)


def from_site(url, title, folder, say, cancelled=lambda: False):
    """the game's file from its page -> its path. Two tries, both hidden."""
    say("Downloading the game…", 0.15)
    for tries_left in (1, 0):
        try:
            with SiteBrowser() as b:
                b.say, b.cancelled = say, cancelled
                return b.download(url, title, folder)
        except SiteRefused:
            if not tries_left:
                raise
            print("[retro play] no file yet, trying once more")


# ---------------- finding the game inside what was downloaded ----------------
def archive_kind(path):
    """what a file really is, from its first bytes: the site's ".zip" and ".rar" files are often 7-Zip. None = not an archive."""
    with open(path, "rb") as f:
        head = f.read(6)
    return "zip" if head[:2] == b"PK" else "7z" if head[:4] == b"7z\xbc\xaf" else "rar" if head[:4] == b"Rar!" else None


def _extract_archive(archive, target):
    """.7z and .rar"""
    os.makedirs(target, exist_ok=True)
    for tool in (shutil.which("7z"), shutil.which("7za"), r"C:\Program Files\7-Zip\7z.exe", r"C:\Program Files (x86)\7-Zip\7z.exe"):
        if tool and os.path.isfile(tool):
            subprocess.run([tool, "x", archive, f"-o{target}", "-y"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            return
    with open(archive, "rb") as f:
        is_7z = f.read(4) == b"7z\xbc\xaf"          # the site's ".rar" files are often really 7-Zip: the file's first bytes tell
    if is_7z:
        py7zr = _py7zr()
        if py7zr:
            with py7zr.SevenZipFile(archive, mode="r") as z:
                z.extractall(path=target)
            return
    tar = shutil.which("tar")                       # Windows 10 and 11 have this one built in: fine for real .rar files
    if not tar:
        raise RuntimeError("7-Zip is needed to open this game")
    r = subprocess.run([tar, "-xf", archive, "-C", target], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode:
        print(f"[retro play] tar: {r.stderr.decode('utf-8', 'replace')[:300]}")
        raise subprocess.CalledProcessError(r.returncode, "tar")


def _py7zr():
    """the 7-Zip reader, installed the first time it's needed. None if that didn't work."""
    try:
        import py7zr
        return py7zr
    except ImportError:
        pass
    subprocess.run([sys.executable, "-m", "pip", "install", "py7zr"], capture_output=True, timeout=300,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        import importlib
        importlib.invalidate_caches()
        import py7zr
        return py7zr
    except ImportError:
        return None


def _extract_zip(archive, target):
    """every file by its own name: nothing can land outside the folder"""
    os.makedirs(target, exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for m in z.namelist():
            if m.endswith("/"):
                continue
            out = os.path.join(target, os.path.basename(m))
            if not os.path.exists(out):
                with z.open(m) as src, open(out + ".part", "wb") as f:
                    shutil.copyfileobj(src, f)
                os.replace(out + ".part", out)


def find_rom(path, system):
    """-> (the file for the emulator, its system id). An archive is opened into a rom/ folder next to it, only the first
    time. Arcade games stay zipped: the emulator wants them that way. Raises ValueError for another console's game."""
    kind = archive_kind(path)
    if system == "arcade" and kind == "zip":
        return path, system
    rom = path
    if kind:
        target = os.path.join(os.path.dirname(path), "rom")
        if not os.path.isdir(target) or not os.listdir(target):
            (_extract_zip if kind == "zip" else _extract_archive)(path, target)
        rank = list(ROM_SYSTEM) + DISC_TYPES
        files = [os.path.join(dp, f) for dp, _, fs in os.walk(target) for f in fs if os.path.splitext(f)[1].lower() in rank]
        if not files:                               # some releases pack an archive inside the archive
            for dp, _, fs in list(os.walk(target)):
                for f in fs:
                    inner = os.path.join(dp, f)
                    k = archive_kind(inner)
                    if k:
                        (_extract_zip if k == "zip" else _extract_archive)(inner, dp)
            files = [os.path.join(dp, f) for dp, _, fs in os.walk(target) for f in fs if os.path.splitext(f)[1].lower() in rank]
        if not files:
            raise ValueError(f"no game inside {os.path.basename(path)}")
        rom = min(files, key=lambda f: rank.index(os.path.splitext(f)[1].lower()))
    found = ROM_SYSTEM.get(os.path.splitext(rom)[1].lower())
    if found and not same_console(found, system):
        raise ValueError(f"{os.path.basename(rom)} is a {found} game")
    return rom, found or system


def _have_game(folder):
    try:
        names = [n for n in os.listdir(folder) if os.path.isfile(os.path.join(folder, n)) and not n.endswith(".part")]
    except OSError:
        return None
    games = [n for n in names if os.path.splitext(n)[1].lower() in DOWNLOAD_TYPES]
    return os.path.join(folder, games[0]) if games else None


# ---------------- the emulator ----------------
def _emulator_folders():
    """where RetroArch may already be: this app's tools folder, then your emulator app's folder"""
    home = Path.home()
    return [HOME_EMULATORS, home / "OneDrive" / "Desktop" / "emulator" / "emulators", home / "Desktop" / "emulator" / "emulators",
            Path("E:/emulatorss ETO/emulators")]


def find_retroarch():
    for folder in _emulator_folders():
        if folder.is_dir():
            for exe in folder.rglob("retroarch.exe"):
                return exe
    for exe in (Path(os.environ.get("APPDATA", "")) / "RetroArch" / "retroarch.exe", Path("C:/RetroArch-Win64/retroarch.exe"), Path("C:/RetroArch/retroarch.exe")):
        if exe.is_file():
            return exe
    return None


def missing_bios(exe, system):
    """a sentence saying what's missing, or "". PlayStation 2 can't run at all without the console's own BIOS file, which
    can't be shared, so it's asked for before a big download rather than failing after it."""
    if system != "ps2":
        return ""
    folder = exe.parent / "system" / "pcsx2" / "bios"
    if folder.is_dir() and any(n.lower().endswith((".bin", ".rom0")) for n in os.listdir(folder)):
        return ""
    return f"PlayStation 2 games need the console's BIOS file. Put your own in {folder} and press Play again."


def launch(exe, rom, system, say=lambda *a: None, fullscreen=True, **popen):
    """open the game -> the running process. A core that can't run the game closes RetroArch within seconds: then the next
    one is tried (arcade has several), and if none can, the loading screen says so."""
    for core in [CORES[system][0]] + (ARCADE_ALSO if system == "arcade" else []):
        dll = ensure_core(exe, system, say, core=core)
        proc = subprocess.Popen([str(exe)] + (["-f"] if fullscreen else []) + ["--appendconfig", launch_config(), "-L", str(dll), os.path.abspath(rom)], cwd=str(exe.parent), **popen)
        waited = 0.0
        while proc.poll() is None and waited < STARTUP_WAIT:
            time.sleep(0.5)
            waited += 0.5
        if proc.poll() is None:
            return proc
        print(f"[retro play] {core} closed straight away ({proc.returncode})")
    raise RuntimeError("The emulator couldn't run this game. Try another game, or another version of it.")


def launch_config():
    """the settings only Vermeil's games use, added on top of RetroArch's own (and never saved over them)"""
    path = data_file("retroarch_vermeil.cfg")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(f'{k} = "{v}"' for k, v in LAUNCH_SETTINGS.items()) + "\n")
    return path


def send_command(name):
    """one of RetroArch's own commands (PAUSE_TOGGLE, RESET, SAVE_STATE...) to the running game"""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.sendto(name.encode("ascii"), ("127.0.0.1", COMMAND_PORT))


def _fetch(url, dest, label, say, lo, hi):
    with requests.get(url, headers={"User-Agent": UA}, timeout=60, stream=True) as r:
        r.raise_for_status()
        total, got = int(r.headers.get("Content-Length") or 0), 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(256 * 1024):
                f.write(chunk)
                got += len(chunk)
                if total:
                    say(f"{label} · {got / 1048576:.0f} of {total / 1048576:.0f} MB", lo + (hi - lo) * got / total)


def install_retroarch(say):
    HOME_EMULATORS.mkdir(parents=True, exist_ok=True)
    archive = str(HOME_EMULATORS / "RetroArch.7z")
    last = None
    for url in RETROARCH_URLS:
        try:
            _fetch(url, archive, "Downloading the emulator", say, 0.45, 0.8)
            break
        except Exception as e:
            last = e
    else:
        raise RuntimeError(f"Couldn't download the emulator ({type(last).__name__}). Check your internet and try again.")
    say("Unpacking the emulator…", 0.82)
    _extract_archive(archive, str(HOME_EMULATORS / "RetroArch"))
    try:
        os.remove(archive)
    except OSError:
        pass
    exe = find_retroarch()
    if not exe:
        raise RuntimeError("The emulator was downloaded, but retroarch.exe isn't in it.")
    return exe


def ensure_core(exe, system, say, core=None):
    default, label, _ = CORES[system]
    core = core or default
    cores = exe.parent / "cores"
    cores.mkdir(parents=True, exist_ok=True)
    dll = cores / f"{core}.dll"
    if dll.is_file():
        return dll
    fd, tmp = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        for tries_left in (2, 1, 0):
            try:
                _fetch(CORE_URL.format(core), tmp, f"Downloading the {label} core", say, 0.82, 0.94)
                break
            except requests.RequestException:
                if not tries_left:
                    raise
                time.sleep(3)
        with zipfile.ZipFile(tmp) as z:
            z.extract(f"{core}.dll", cores)
    except Exception as e:
        raise RuntimeError(f"Couldn't download the {label} core ({type(e).__name__}). Check your internet and try again.")
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    return dll


# ---------------- one press of Play ----------------
def _system_for(game):
    return PLATFORM_SYSTEM.get(retrogames.platform_of((game or {}).get("url", "")))


def _get_game(game, gid, system, say, cancelled=lambda: False):
    """the game's file on this PC: already here, or from its page"""
    folder = os.path.join(retrogames.ROM_DIR, gid)
    have = _have_game(folder)
    if have:
        return have
    os.makedirs(folder, exist_ok=True)
    retrogames.downloading.add(gid)
    try:
        path = from_site(game["url"], game.get("title", ""), folder, say, cancelled)
        say("Opening the game…", 0.44)
        try:
            find_rom(path, system)                  # another console's game, or a broken archive? Then it can't be used
        except Exception as e:
            raise BadFile(f"{type(e).__name__}: {e}")
        return path
    except Exception as e:
        print(f"[retro play] {game['url']}: {type(e).__name__}: {e}")
        shutil.rmtree(folder, ignore_errors=True)
        if isinstance(e, (Cancelled, FileGone)):
            raise
        if isinstance(e, SiteRefused):
            raise RuntimeError("The games site didn't give the file this time. Try again in a moment.")
        if isinstance(e, BadFile):
            raise RuntimeError("That download isn't a game this emulator can open. Try another version of it.")
        raise RuntimeError("Couldn't download the game. Check your internet and try again.")
    finally:
        retrogames.downloading.discard(gid)


def _run(job, game, gid, system, phone):
    st = _jobs[job]
    def say(text, pct):
        st.update(text=text, pct=pct)
    try:
        path = _get_game(game, gid, system, say, lambda: st.get("cancel"))
        retrogames.add_recent({**game, "id": gid})
        retrogames.trim_cache(keep={gid})
        os.utime(os.path.dirname(path))             # just played: kept longest when tidying
        if phone:
            st.update(path=path, done=True, pct=1.0)
            return
        say("Getting the emulator ready…", 0.45)
        rom, rom_system = find_rom(path, system)
        exe = find_retroarch() or install_retroarch(say)
        needs = missing_bios(exe, rom_system)
        if needs:
            raise RuntimeError(needs)
        say("Starting the game…", 0.97)
        try:
            import gamebuddy
            gamebuddy.retro_title = game.get("title", "")
        except Exception:  # noqa: BLE001 - it only names the game for her box
            pass
        proc = launch(exe, rom, rom_system, say)
        st.update(running=True, done=True, pct=1.0)
        try:
            import retrobar
            retrobar.attach(proc, game.get("title", ""))
        except Exception as e:  # noqa: BLE001 - the game still plays without the bar
            print(f"[retro play] bar: {type(e).__name__}: {e}")
        proc.wait()
        st.update(running=False)
    except Exception as e:
        print(f"[retro play] {type(e).__name__}: {e}")
        st.update(error=str(e) if isinstance(e, RuntimeError) else "Couldn't start the game. Try again in a moment.", done=True, running=False)


def _begin(game, gid, system, phone=False):
    with _jobs_lock:
        for job, st in _jobs.items():
            if st["gid"] == gid and st["phone"] == phone and (st["running"] or not st["done"]):
                return job                          # already on its way (or already open)
        job = str(len(_jobs) + 1)
        _jobs[job] = {"gid": gid, "phone": phone, "text": "Getting the game ready…", "pct": 0.05, "done": False, "running": False, "error": None}
    threading.Thread(target=_run, args=(job, game, gid, system, phone), daemon=True).start()
    return job


def start(game):
    """Play was pressed -> {job, id} (ask status(job) how it's going), or {error}"""
    game = game if isinstance(game, dict) else {"url": game}
    system = _system_for(game)
    if not retrogames.is_game_url(game.get("url")) or not system:
        return {"error": "That game can't be played here."}
    if sys.platform != "win32":
        return {"error": "The emulator is only set up for Windows for now."}
    exe = find_retroarch()
    needs = missing_bios(exe, system) if exe else ""
    if needs:
        return {"error": needs}                     # before a big download, not after it
    gid = retrogames.game_id(game["url"])
    return {"job": _begin(game, gid, system), "id": gid}


def cancel(job):
    """the loading screen's Cancel: whatever was downloaded so far is thrown away"""
    st = _jobs.get(str(job))
    if st:
        st["cancel"] = True
    return {"ok": True}


def status(job):
    """{text, pct, done, running, error}"""
    st = _jobs.get(str(job))
    if not st:
        return {"error": "That game isn't starting.", "done": True, "running": False}
    return {k: st.get(k) for k in ("text", "pct", "done", "running", "error")}


# ---------------- the phone's player: only the file, no RetroArch ----------------
def prepare(game, fresh=False):
    """{id, core, rom, bios, parent} for the phone's player. The file downloads on this PC; ask progress(id)."""
    game = game if isinstance(game, dict) else {"url": game}
    system = _system_for(game)
    if not retrogames.is_game_url(game.get("url")) or not system:
        return {"error": "That game can't be played here."}
    core = CORES[system][2]
    if not core:
        return {"error": "This console only plays on the computer."}
    gid = retrogames.game_id(game["url"])
    job = _begin(game, gid, system, phone=True)
    return {"id": gid, "job": job, "core": core, "bios": "", "parent": ""}


def progress(gid, bios="", parent=""):
    """{done, got, total, error, rom} for the phone's download"""
    st = next((s for s in reversed(list(_jobs.values())) if s["gid"] == str(gid) and s["phone"]), None)
    if not st:
        return {"done": False, "got": 0, "total": 0, "error": "not started"}
    out = {"done": st["done"], "got": round(st["pct"] * 100), "total": 100, "error": st["error"]}
    if st.get("path"):
        out["rom"] = "roms/" + os.path.relpath(st["path"], retrogames.ROM_DIR).replace(os.sep, "/")
    return out
