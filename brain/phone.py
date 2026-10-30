"""phone.py - use Vermeil from your phone: at home AND outside on mobile data.

How it works
  1. A small web server for the phone app (ui/phone/) runs on THIS computer, only reachable from this computer
     (127.0.0.1) - nobody on your Wi-Fi or the internet can open it directly.
  2. A secure tunnel gives it an https:// address your phone can open from anywhere:
       "quick"     - Cloudflare quick tunnel (free, no account). cloudflared is downloaded the first time.
                     The address changes every time it starts (scan the new QR code).
       "tailscale" - your own Tailscale network (free account, Tailscale app on the phone). The address never
                     changes, so it's the one to use for "Hey Siri" / home-screen shortcuts.
       "local"     - no tunnel: only this computer (for testing).
  3. Every request needs your private key (made on this PC, inside the QR code). Without it nothing answers.
     Too many wrong keys -> it stops answering for a minute.

PhoneServer(handlers).start() / .stop();   handlers = {"chat": fn(payload) -> dict, ...}
Tunnel(method, port).start(on_url) / .stop()
"""
import hmac
import http.server
import io
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.parse
import urllib.request
import wave

from paths import data_file

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PHONE_DIR = os.path.join(ROOT, "ui", "phone")
STATE_FILE = data_file("phone.json")
TOOLS_DIR = os.path.join(ROOT, "tools", "cloudflared")
PORT = int(os.environ.get("PHONE_PORT", "8790"))
MAX_JSON = 64 * 1024
MAX_AUDIO = 8 * 1024 * 1024
MAX_UPLOAD = 300 * 1024 * 1024        # a file sent to the Study library (lecture videos can be big)
STATIC = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
          ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json"}
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# ------------------------------------------------------------------ the private key
def state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            s = json.load(f)
        if isinstance(s, dict) and len(s.get("key") or "") >= 24:
            return s
    except (OSError, ValueError):
        pass
    s = {"key": secrets.token_urlsafe(24), "method": "quick"}
    save(s)
    return s


def save(s):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=1)
    os.replace(tmp, STATE_FILE)


def new_key():
    """forget every phone that was connected: they need the new QR code"""
    s = state()
    s["key"] = secrets.token_urlsafe(24)
    save(s)
    return s["key"]


def key_ok(given, key):
    return bool(given) and hmac.compare_digest(str(given).encode(), str(key).encode())


def wav_bytes(samples, sr):
    """float samples (-1..1) -> a .wav file in memory"""
    import numpy as np
    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


# ------------------------------------------------------------------ the server
class _Handler(http.server.BaseHTTPRequestHandler):
    server_version = "Vermeil"
    sys_version = ""

    def log_message(self, *a):
        pass

    def _send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self.path.split("?")[0].split("#")[0]
        if path in ("/", "/phone", "/phone/"):
            path = "/phone/index.html"
        if path == "/sw.js":                                   # the service worker must sit at the top to cover the app
            path = "/phone/sw.js"
        m = re.fullmatch(r"/phone/([a-z0-9_-]+\.[a-z]+)", path)
        ext = os.path.splitext(m.group(1))[1] if m else ""
        file = os.path.join(PHONE_DIR, m.group(1)) if m else ""
        if not m or ext not in STATIC or not os.path.isfile(file):
            return self._send(404, {"error": "not found"})
        with open(file, "rb") as f:
            data = f.read()
        extra = {"Service-Worker-Allowed": "/"} if m.group(1) == "sw.js" else None
        return self._send(200, data, STATIC[ext], extra)

    def do_POST(self):
        srv = self.server.owner
        name = self.path.split("?")[0].rstrip("/").rsplit("/api/", 1)[-1] if "/api/" in self.path else ""
        if srv.locked_until > time.time():
            return self._send(429, {"error": "Too many wrong keys. Wait a minute."})
        if not key_ok(self.headers.get("X-Vermeil-Key"), srv.key()):
            srv.failed()
            return self._send(401, {"error": "This phone isn't connected. Scan the QR code on your computer again."})
        fn = srv.handlers.get(name)
        if not fn:
            return self._send(404, {"error": f"no api {name}"})
        n = int(self.headers.get("Content-Length") or 0)
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        upload = name == "upload"
        audio = not upload and (ctype.startswith("audio/") or ctype == "application/octet-stream")
        if n > (MAX_UPLOAD if upload else MAX_AUDIO if audio else MAX_JSON):
            return self._send(413, {"error": "That file is too big (300 MB at most)." if upload else "too big"})
        raw = self.rfile.read(n) if n else b""
        if upload:
            payload = {"data": raw, "name": urllib.parse.unquote(self.headers.get("X-File-Name") or "")}
        elif audio:
            payload = {"audio": raw, "type": ctype}
        elif ctype == "text/plain":
            payload = {"text": raw.decode("utf-8", "replace")}
        else:
            try:
                payload = json.loads(raw or b"{}")
            except ValueError:
                return self._send(400, {"error": "bad request"})
            if not isinstance(payload, dict):
                return self._send(400, {"error": "bad request"})
        try:
            out = fn(payload)
        except Exception as e:
            print(f"[phone] {name}: {e}")
            return self._send(500, {"error": str(e)[:200]})
        if isinstance(out, tuple):                             # (bytes, content type): audio
            return self._send(200, out[0], out[1])
        if isinstance(out, str):                               # plain text (the Siri shortcut)
            return self._send(200, out, "text/plain; charset=utf-8")
        return self._send(200, out if out is not None else {})


class PhoneServer:
    def __init__(self, handlers, port=PORT, key=None):
        self.handlers = handlers
        self.port = port
        self._key = key
        self._httpd = None
        self._fails = []
        self.locked_until = 0.0

    def key(self):
        return self._key or state()["key"]

    def failed(self):
        now = time.time()
        self._fails = [t for t in self._fails if now - t < 60] + [now]
        if len(self._fails) >= 20:
            self.locked_until = now + 60
            self._fails = []

    @property
    def running(self):
        return self._httpd is not None

    def start(self):
        if self._httpd:
            return self.port
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", self.port), _Handler)
        httpd.daemon_threads = True
        httpd.owner = self
        self._httpd = httpd
        self.port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True, name="phone-server").start()
        return self.port

    def stop(self):
        if self._httpd:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None


# ------------------------------------------------------------------ the tunnel (outside the house)
def _cloudflared_asset():
    arch = platform.machine().lower()
    arm = arch in ("arm64", "aarch64")
    if sys.platform == "win32":
        return "cloudflared-windows-amd64.exe", "cloudflared.exe"
    if sys.platform == "darwin":
        return f"cloudflared-darwin-{'arm64' if arm else 'amd64'}.tgz", "cloudflared"
    return f"cloudflared-linux-{'arm64' if arm else 'amd64'}", "cloudflared"


def cloudflared_path():
    _, exe = _cloudflared_asset()
    local = os.path.join(TOOLS_DIR, exe)
    if os.path.isfile(local):
        return local
    return shutil.which("cloudflared")


def get_cloudflared(progress=lambda text: None):
    """download Cloudflare's tunnel program (about 20-40 MB, once) from its official GitHub releases"""
    have = cloudflared_path()
    if have:
        return have
    asset, exe = _cloudflared_asset()
    url = f"https://github.com/cloudflare/cloudflared/releases/latest/download/{asset}"
    os.makedirs(TOOLS_DIR, exist_ok=True)
    progress("Downloading the secure tunnel (first time only)…")
    tmp = os.path.join(TOOLS_DIR, asset + ".part")
    urllib.request.urlretrieve(url, tmp)
    dest = os.path.join(TOOLS_DIR, exe)
    if asset.endswith(".tgz"):
        with tarfile.open(tmp) as t:
            member = next((m for m in t.getmembers() if os.path.basename(m.name) == "cloudflared" and m.isfile()), None)
            if not member:
                raise RuntimeError("The tunnel download looks wrong.")
            with t.extractfile(member) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)
        os.remove(tmp)
    else:
        os.replace(tmp, dest)
    if sys.platform != "win32":
        os.chmod(dest, 0o755)
    return dest


def tailscale_path():
    found = shutil.which("tailscale")
    if found:
        return found
    for p in (r"C:\Program Files\Tailscale\tailscale.exe", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"):
        if os.path.isfile(p):
            return p
    return None


class Tunnel:
    URL_RX = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")

    def __init__(self, method, port):
        self.method, self.port = method, port
        self.url = None
        self.error = None
        self._proc = None

    def start(self, on_url=lambda url: None, progress=lambda text: None):
        """runs until it has an address (or fails); on_url(url) is told the address"""
        try:
            if self.method == "local":
                self.url = f"http://127.0.0.1:{self.port}"
            elif self.method == "tailscale":
                self.url = self._tailscale()
            else:
                self.url = self._cloudflare(progress)
            on_url(self.url)
        except Exception as e:
            self.error = str(e)
            on_url(None)
        return self.url

    def _cloudflare(self, progress):
        exe = get_cloudflared(progress)
        progress("Opening the secure tunnel…")
        self._proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{self.port}"],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
                                      encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
        found = [None]

        def read():
            for line in self._proc.stderr:
                m = self.URL_RX.search(line)
                if m and not found[0]:
                    found[0] = m.group(0)
        threading.Thread(target=read, daemon=True).start()
        t = time.time()
        while time.time() - t < 45:
            if found[0]:
                return found[0]
            if self._proc.poll() is not None:
                raise RuntimeError("The tunnel stopped. Check the internet connection and try again.")
            time.sleep(0.2)
        raise RuntimeError("The tunnel didn't give an address in time. Check the internet connection.")

    def _tailscale(self):
        exe = tailscale_path()
        if not exe:
            raise RuntimeError("Tailscale isn't installed on this computer. Get it free from tailscale.com, sign in, "
                               "and install the Tailscale app on your phone with the same account.")
        out = subprocess.run([exe, "serve", "--bg", str(self.port)], capture_output=True, text=True, timeout=30,
                             creationflags=NO_WINDOW)
        if out.returncode != 0:
            raise RuntimeError("Tailscale couldn't share Vermeil: " + (out.stderr or out.stdout).strip()[:200])
        st = json.loads(subprocess.run([exe, "status", "--json"], capture_output=True, text=True, timeout=15,
                                       creationflags=NO_WINDOW).stdout or "{}")
        name = ((st.get("Self") or {}).get("DNSName") or "").rstrip(".")
        if not name:
            raise RuntimeError("Tailscale is installed but not signed in. Open Tailscale and sign in first.")
        return f"https://{name}"

    def stop(self):
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        self._proc = None
        if self.method == "tailscale" and tailscale_path():
            subprocess.run([tailscale_path(), "serve", "--bg", "--https=443", "off"], capture_output=True, timeout=15,
                           creationflags=NO_WINDOW)
        self.url = None
