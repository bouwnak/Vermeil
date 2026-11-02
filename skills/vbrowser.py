"""
vbrowser.py - Vermeil's own browser (the 🌐 Browser panel in the sidebar, like Opera GX's side panel).

The panel is the browser's "chrome": the tabs, the address bar, back / forward / reload, a Google-style start page
with speed dial and your recent pages. Most websites (Google, YouTube...) refuse to be shown inside another page, so
each tab is its own borderless web view that is put INSIDE Vermeil's window (Windows SetParent), exactly over the
panel's page area: it moves with the window and looks like part of the panel. The panel tells Python where that
area is (place()); only the active tab is shown. Speed dial and history are kept in data/browser.json.
"""
import ctypes
import json
import os
import re
import sys
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
# The floating player: the page's video fills its tab, on any site. The video can sit deep inside web components (their shadow DOM), and many can be
# on a page (TikTok's feed): the one playing wins, then the biggest. An embedded player from another site can't be reached, so its whole frame fills
# the tab instead. Everything is set on the elements themselves and written down, so MINI_OFF puts the page back exactly.
FIND = """const vm_all=(r,o=[])=>{for(const e of r.querySelectorAll('*')){if(e.tagName==='VIDEO')o.push(e);if(e.shadowRoot)vm_all(e.shadowRoot,o)}return o};
const vm_area=e=>{const r=e.getBoundingClientRect();return r.width*r.height};
const vm_videos=()=>vm_all(document).filter(v=>v.readyState>0||v.currentSrc||v.src||v.srcObject);
const vm_video=()=>vm_videos().sort((a,b)=>(!b.paused-!a.paused)||(vm_area(b)-vm_area(a)))[0];
const vm_frame=()=>[...document.querySelectorAll('iframe')].filter(f=>vm_area(f)>40000).sort((a,b)=>vm_area(b)-vm_area(a))[0];
const vm_target=()=>vm_video()||vm_frame();"""
IS_PLAYING = "(()=>{" + FIND + "const v=vm_video();return v?(!v.paused&&!v.ended)||v.currentTime>0:!!vm_frame()})()"
MINI_ON = "(()=>{" + FIND + r"""const t=vm_target();if(!t)return false;const saved=window.__vmSaved=[];
const put=(e,rules)=>{saved.push([e,e.getAttribute('style')]);for(const[k,v]of Object.entries(rules))e.style.setProperty(k,v,'important')};
const clear={transform:'none',filter:'none',contain:'none','clip-path':'none','will-change':'auto',overflow:'visible','z-index':'auto',visibility:'visible',opacity:'1',perspective:'none'};
let s=document.createElement('style');s.id='vermeil-mini';s.textContent='html,body{overflow:hidden!important}body *{visibility:hidden!important}';document.head.append(s);
for(let p=t.parentNode;p&&p!==document;p=p.parentNode||p.host){if(p.nodeType===11)continue;if(p===document.documentElement||p===document.body){put(p,{transform:'none',filter:'none'});continue}put(p,clear)}
put(t,{position:'fixed',left:'0',top:'0',width:'100vw',height:'100vh','max-width':'none','max-height':'none','min-width':'0','min-height':'0',margin:'0',padding:'0',border:'0','z-index':'2147483647','object-fit':'contain',background:'#000',transform:'none',visibility:'visible'});
return true})()"""
MINI_OFF = r"""(()=>{document.getElementById('vermeil-mini')?.remove();for(const[e,old]of(window.__vmSaved||[]).reverse()){if(old==null)e.removeAttribute('style');else e.setAttribute('style',old)}window.__vmSaved=[];return true})()"""
TOGGLE = "(()=>{" + FIND + "const v=vm_video();if(!v)return false;if(v.paused)v.play();else v.pause();return !v.paused})()"
PAUSE = "(()=>{" + FIND + "const v=vm_video();if(v)v.pause();return false})()"


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


# ---------- Windows: put a tab's window inside Vermeil's window ----------
GWL_STYLE, WS_CHILD, WS_POPUP, WS_CAPTION, WS_THICKFRAME = -16, 0x40000000, 0x80000000, 0x00C00000, 0x00040000
SW_HIDE, SW_SHOW, SWP_NOZORDER, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0, 5, 0x0004, 0x0010, 0x0040


def _user32():
    return ctypes.windll.user32 if sys.platform == "win32" else None


def find_window(title):
    """this program's top-level window with exactly this title (0 if none)"""
    u = _user32()
    if not u:
        return 0
    found = []
    pid = os.getpid()

    def each(h, _):
        n = u.GetWindowTextLengthW(h)
        if n:
            buf = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(h, buf, n + 1)
            owner = ctypes.c_ulong()
            u.GetWindowThreadProcessId(h, ctypes.byref(owner))
            if buf.value == title and owner.value == pid:
                found.append(h)
        return True
    u.EnumWindows(ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)(each), 0)
    return found[0] if found else 0


def embed(child, parent):
    """make `child` a borderless child window of `parent` (it then moves with it)"""
    u = _user32()
    if not (u and child and parent):
        return False
    get = getattr(u, "GetWindowLongPtrW", u.GetWindowLongW)
    put = getattr(u, "SetWindowLongPtrW", u.SetWindowLongW)
    style = get(child, GWL_STYLE)
    # as a signed 32-bit number: skills/overlaywin.py sets how these two calls read their numbers, and a large one is refused
    put(child, GWL_STYLE, ctypes.c_long(((style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME)) | WS_CHILD) & 0xFFFFFFFF).value)
    u.SetParent(child, parent)
    return True


class Browser:
    def __init__(self, emit, main_title="Vermeil"):
        self.emit = emit                         # emit({"type": "browser", ...}) -> the panel redraws
        self.tabs = {}                           # id -> {"win", "url", "title", "hwnd"}
        self.next_id = 1
        self.lock = threading.Lock()
        self.main_title = main_title
        self.active = None                       # the tab shown in the panel
        self.rect = None                         # the panel's page area in Vermeil's window (pixels), or None = hidden

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
        return {"tabs": tabs, "dial": d["dial"], "history": d["history"][:20], "active": self.active}

    # ---------- where the tab shows: inside the panel ----------
    def place(self, rect):
        """rect: {x, y, w, h} in Vermeil's window pixels (the panel's page area), or None to hide every tab"""
        self.rect = {k: int(round(float(rect[k]))) for k in ("x", "y", "w", "h")} if rect else None
        self._layout()
        return True

    def _layout(self):
        u = _user32()
        if not u:
            return
        for tid, t in list(self.tabs.items()):
            h = t.get("hwnd")
            if not h:
                continue
            if tid == self.active and self.rect and self.rect["w"] > 20 and self.rect["h"] > 20:
                r = self.rect
                u.ShowWindow(h, SW_SHOW)
                # through pywebview (WinForms), so the web view inside resizes and repaints too; as a child window the
                # position is inside Vermeil's window
                try:
                    t["win"].resize(r["w"], r["h"])
                    t["win"].move(r["x"], r["y"])
                except Exception:  # noqa: BLE001
                    u.SetWindowPos(h, 0, r["x"], r["y"], r["w"], r["h"], SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW)
            else:
                u.ShowWindow(h, SW_HIDE)

    def _embed(self, tid):
        """the tab's window exists now: put it inside Vermeil's window (else it stays a normal window)"""
        t = self.tabs.get(tid)
        if not t:
            return
        child = find_window(f"VermeilTab-{tid}")
        parent = find_window(self.main_title)
        if child and parent and embed(child, parent):
            t["hwnd"] = child
            self._layout()

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
            self.active = tab
            self._layout()
            self._changed()
            return {"ok": True, "id": tab, "url": url}
        import webview
        with self.lock:
            tid = self.next_id
            self.next_id += 1
        # borderless and parked off-screen until it's put inside Vermeil's window (_embed, when it's shown)
        win = webview.create_window(f"VermeilTab-{tid}", url, frameless=True, easy_drag=False, x=-32000, y=-32000,
                                    width=900, height=600)
        self.tabs[tid] = {"win": win, "url": url, "title": "", "hwnd": 0}
        self.active = tid
        win.events.shown += lambda: self._embed(tid)
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
        except Exception:  # noqa: BLE001
            pass
        if not t.get("hwnd"):                      # "shown" can come before the window is really there: try again
            self._embed(tid)
        self._remember(t["url"], t["title"])
        self._changed()

    def _closed(self, tid):
        with self.lock:
            self.tabs.pop(tid, None)
            if self.active == tid:
                self.active = next(reversed(self.tabs), None)
        self._layout()
        self._changed()

    def video(self, tid, action="playing"):
        """the tab's video, for the floating player: playing / mini_on / mini_off / toggle / pause. -> True or False"""
        t = self.tabs.get(tid)
        if not t:
            return False
        js = {"playing": IS_PLAYING, "mini_on": MINI_ON, "mini_off": MINI_OFF, "toggle": TOGGLE, "pause": PAUSE}.get(action)
        try:
            return bool(js and t["win"].evaluate_js(js))
        except Exception:  # noqa: BLE001 - the page is gone or still loading
            return False

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
            elif action == "focus":                    # this tab is the one shown in the panel now
                self.active = tid
                self._layout()
                self._changed()
            elif action == "close":
                w.destroy()
            else:
                return {"error": "Unknown action."}
        except Exception as e:  # noqa: BLE001
            return {"error": str(e)}
        return {"ok": True}
