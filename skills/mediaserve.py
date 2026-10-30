"""
mediaserve.py - plays your video lectures inside the app (Study -> "▶ watch where this was said").

The window can't open files from your drives directly, so a tiny server on this computer only (127.0.0.1)
streams a library video with seeking (HTTP Range). Each run has its own secret in the address.

  url(file_id, seconds=0)   -> "http://127.0.0.1:PORT/SECRET/FILE_ID#t=SECONDS" (starts the server the first time)
"""
import http.server
import mimetypes
import os
import re
import secrets
import threading

_server = None
_secret = secrets.token_urlsafe(16)
CHUNK = 1 << 20


class _Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        import academic
        m = re.fullmatch(r"/([\w-]+)/([0-9a-f]{6,32})", self.path.split("?")[0])
        if not m or not secrets.compare_digest(m.group(1), _secret):
            self.send_error(404)
            return
        path = academic.file_path(m.group(2))
        if not path or not os.path.isfile(path):
            self.send_error(404, "The video isn't there anymore (was it on a USB drive that's unplugged?)")
            return
        size = os.path.getsize(path)
        start, end = 0, size - 1
        rng = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if rng:
            if rng.group(1):
                start = int(rng.group(1))
                end = int(rng.group(2)) if rng.group(2) else end
            elif rng.group(2):
                start = max(0, size - int(rng.group(2)))
        end = min(end, size - 1)
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", mimetypes.guess_type(path)[0] or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            try:
                while left > 0:
                    chunk = f.read(min(CHUNK, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (ConnectionError, OSError):
                pass                                    # the player stopped or jumped somewhere else


def start():
    global _server
    if not _server:
        _server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        _server.daemon_threads = True
        threading.Thread(target=_server.serve_forever, daemon=True, name="media-server").start()
    return _server.server_address[1]


def url(file_id, seconds=0):
    port = start()
    return f"http://127.0.0.1:{port}/{_secret}/{file_id}" + (f"#t={int(seconds)}" if seconds else "")
