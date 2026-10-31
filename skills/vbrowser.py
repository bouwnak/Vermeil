"""
vbrowser.py - Vermeil's own browser (the 🌐 Browser panel in the sidebar, like Opera GX's side panel).

The panel is the browser's "chrome": the tabs, the address bar, back / forward / reload, a Google-style start page
with speed dial and your recent pages. Each tab is a Vermeil browser window (a pywebview window), because most
websites (Google, YouTube...) refuse to be shown inside another page. Speed dial and history are kept in
data/browser.json.
"""
import json
import re
import threading
import time
from urllib.parse import quote_plus, urlparse

from paths import data_file

FILE = data_file("browser.json")
SEARCH = "https://www.google.com/search?q={q}"
DIAL = [{"name": "Google", "url": "https://www.google.com"}, {"name": "YouTube", "url": "https://www.youtube.com"},
        {"name": "Gmail", "url": "https://mail.google.com"}, {"name": "Wikipedia", "url": "https://en.wikipedia.org"},
        {"name": "GitHub", "url": "https://github.com"}, {"name": "Reddit", "url": "https://www.reddit.com"},
        {"name": "Twitch", "url": "https://www.twitch.tv"}, {"name": "Discord", "url": "https://discord.com/app"}]
MAX_HISTORY = 60


def to_url(text):
    """what you typed -> a web address: a link stays a link, "youtube.com" gets https://, anything else is searched"""
    t = str(text or "").strip()
    if not t:
        return ""
    if re.match(r"(?i)https?://", t):
        return t
    if re.fullmatch(r"[\w-]+(\.[\w-]+)+(:\d+)?(/\S*)?", t):
        return f"https://{t}"
    return SEARCH.format(q=quote_plus(t))


def host(url):
    return re.sub(r"^www\.", "", urlparse(url).netloc.lower())


class Browser:
    def __init__(self, emit):
        self.emit = emit                         # emit({"type": "browser", ...}) -> the panel redraws
        self.tabs = {}                           # id -> {"win", "url", "title"}
        self.next_id = 1
        self.lock = threading.Lock()

    # ---------- saved: speed dial + history ----------
    def _load(self):
        try:
            with open(FILE, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            d = {}
        return {"dial": d.get("dial") if isinstance(d.get("dial"), list) else list(DIAL), "history": d.get("history") or []}

    def _save(self, d):
        try:
            with open(FILE, "w", encoding="utf-8") as f:
                json.dump(d, f, indent=1)
        except OSError:
            pass

    def _remember(self, url, title):
        if not url or url.startswith(("about:", "data:")):
            return
        d = self._load()
        d["history"] = [{"url": url, "title": title or host(url), "at": time.strftime("%Y-%m-%d %H:%M")}] + \
                       [h for h in d["history"] if h.get("url") != url]
        d["history"] = d["history"][:MAX_HISTORY]
        self._save(d)

    def dial_add(self, name, url):
        url = to_url(url)
        if not url:
            return {"error": "Type the site's address."}
        d = self._load()
        d["dial"] = [x for x in d["dial"] if x["url"] != url] + [{"name": (name or host(url)).strip()[:30], "url": url}]
        self._save(d)
        return self.state()

    def dial_remove(self, url):
        d = self._load()
        d["dial"] = [x for x in d["dial"] if x["url"] != url]
        self._save(d)
        return self.state()

    def history_clear(self):
        d = self._load()
        d["history"] = []
        self._save(d)
        return self.state()

    # ---------- tabs ----------
    def state(self):
        d = self._load()
        with self.lock:
            tabs = [{"id": i, "url": t["url"], "title": t["title"] or host(t["url"]), "host": host(t["url"])}
                    for i, t in self.tabs.items()]
        return {"tabs": tabs, "dial": d["dial"], "history": d["history"][:20]}

    def _changed(self):
        self.emit({"type": "browser", **self.state()})

    def open(self, text, tab=None):
        """open what you typed in tab `tab` (None = a new tab)"""
        url = to_url(text)
        if not url:
            return {"error": "Type what to search or a link."}
        with self.lock:
            t = self.tabs.get(tab) if tab else None
        if t:
            t["url"] = url
            t["win"].load_url(url)
            try:
                t["win"].restore()
            except Exception:  # noqa: BLE001 - not every backend has restore()
                pass
            self._changed()
            return {"ok": True, "id": tab, "url": url}
        import webview
        with self.lock:
            tid = self.next_id
            self.next_id += 1
        win = webview.create_window(f"Vermeil Browser - {host(url) or url[:40]}", url, width=1180, height=780)
        self.tabs[tid] = {"win": win, "url": url, "title": ""}
        win.events.loaded += lambda: self._loaded(tid)
        win.events.closed += lambda: self._closed(tid)
        self._changed()
        return {"ok": True, "id": tid, "url": url}

    def _loaded(self, tid):
        t = self.tabs.get(tid)
        if not t:
            return
        try:
            t["url"] = t["win"].get_current_url() or t["url"]
            t["title"] = (t["win"].evaluate_js("document.title") or "").strip()[:120]
            t["win"].title = f"{t['title'] or host(t['url'])} - Vermeil Browser"
        except Exception:  # noqa: BLE001
            pass
        self._remember(t["url"], t["title"])
        self._changed()

    def _closed(self, tid):
        with self.lock:
            self.tabs.pop(tid, None)
        self._changed()

    def nav(self, tid, action):
        """back / forward / reload / focus / close one tab"""
        t = self.tabs.get(tid)
        if not t:
            return {"error": "That tab is closed."}
        w = t["win"]
        try:
            if action == "back":
                w.evaluate_js("history.back()")
            elif action == "forward":
                w.evaluate_js("history.forward()")
            elif action == "reload":
                w.evaluate_js("location.reload()")
            elif action == "focus":
                w.restore()
                w.show()
            elif action == "close":
                w.destroy()
            else:
                return {"error": "Unknown action."}
        except Exception as e:  # noqa: BLE001
            return {"error": str(e)}
        return {"ok": True}
