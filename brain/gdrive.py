"""
gdrive.py - download a file from a Google Drive share link (or any normal https link).

    download(url, dest, progress=None)     progress(fraction 0..1, text) while it downloads

Google Drive: share the file as "Anyone with the link", then paste the link - any of these work:
    https://drive.google.com/file/d/<ID>/view?usp=sharing
    https://drive.google.com/open?id=<ID>
    https://drive.google.com/uc?id=<ID>&export=download
Big files (over ~100 MB) normally show a "can't scan this file for viruses" page first; that page is skipped here.
Only http(s) links are allowed. A shared Drive FOLDER link can't be downloaded in one go, but
    list_folder(url)                       every file in it (and its sub-folders): [{"name", "id", "url", "path"}]
reads what's inside (the folder must be shared as "Anyone with the link").
"""
import os
import re
import urllib.parse
from html import unescape

import requests

DIRECT = "https://drive.usercontent.google.com/download"


def drive_id(url):
    """the file id in a Google Drive link, or None when it isn't one"""
    u = urllib.parse.urlparse((url or "").strip())
    if not u.hostname or not (u.hostname == "drive.google.com" or u.hostname.endswith(".google.com")
                              or u.hostname == "docs.google.com"):
        return None
    m = re.search(r"/file/d/([\w-]{10,})", u.path) or re.search(r"/d/([\w-]{10,})", u.path)
    if m:
        return m.group(1)
    q = urllib.parse.parse_qs(u.query).get("id")
    return q[0] if q and re.fullmatch(r"[\w-]{10,}", q[0]) else None


def hide_links(text):
    """the same message with every Google Drive link (and file id) taken out - the Vermeil folder link stays private"""
    return re.sub(r"https?://[\w.-]*google(usercontent)?\.com\S*", "(the Vermeil Drive folder)", str(text))


def is_folder_link(url):
    return "/drive/folders/" in (url or "") or "/folderview" in (url or "")


def folder_id(url):
    """the folder id in a Google Drive folder link, or None"""
    u = urllib.parse.urlparse((url or "").strip())
    if not u.hostname or not (u.hostname == "drive.google.com" or u.hostname.endswith(".google.com")):
        return None
    m = re.search(r"/folders/([\w-]{10,})", u.path)
    if m:
        return m.group(1)
    q = urllib.parse.parse_qs(u.query).get("id")
    return q[0] if is_folder_link(url) and q and re.fullmatch(r"[\w-]{10,}", q[0]) else None


LIST_PAGE = "https://drive.google.com/embeddedfolderview?id="     # Drive's plain list of a shared folder


def parse_folder_page(html):
    """the entries of an embeddedfolderview page: [(name, id, is_folder)]"""
    out = []
    for chunk in re.split(r'<div class="flip-entry"', html or "")[1:]:
        href = re.search(r'href="([^"]+)"', chunk)
        title = re.search(r'class="flip-entry-title"[^>]*>([^<]*)<', chunk)
        if not href or not title:
            continue
        link = href.group(1).replace("&amp;", "&")
        fid = folder_id(link) if is_folder_link(link) else drive_id(link)
        if fid:
            out.append((unescape(title.group(1)).strip(), fid, is_folder_link(link)))
    return out


def list_folder(url, depth=3, _path="", _get=None):
    """every file in a shared Drive folder and its sub-folders (up to depth levels down)"""
    fid = folder_id(url) if isinstance(url, str) and "/" in url else url
    if not fid:
        raise ValueError("Paste the link of a Google Drive folder (drive.google.com/drive/folders/...).")
    get = _get or (lambda i: requests.get(LIST_PAGE + i, timeout=30))
    r = get(fid)
    if r.status_code != 200 or "accounts.google.com" in (getattr(r, "url", "") or "") or "flip-" not in r.text:
        raise RuntimeError("Google Drive didn't show that folder. In Drive: right-click it → Share → General access → "
                           "\"Anyone with the link\", then try again.")
    files = []
    for name, eid, is_dir in parse_folder_page(r.text):
        here = f"{_path}{name}"
        if is_dir:
            if depth > 0:
                files += list_folder(eid, depth - 1, here + "/", get)
        else:
            files.append({"name": name, "id": eid, "path": here, "url": f"https://drive.google.com/file/d/{eid}/view"})
    return files


def direct_url(url):
    """a link that gives the file itself (Drive links are turned into their download address)"""
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.I):
        raise ValueError("Paste a full link that starts with https://")
    if is_folder_link(url):
        raise ValueError("That's a Google Drive folder. Open the folder, right-click the .zip inside → Share → "
                         "Copy link, and paste that link instead.")
    fid = drive_id(url)
    return f"{DIRECT}?id={fid}&export=download&confirm=t" if fid else url


def _filename(r, fallback):
    cd = r.headers.get("content-disposition") or ""
    m = re.search(r"filename\*=UTF-8''([^;]+)", cd) or re.search(r'filename="?([^";]+)"?', cd)
    name = urllib.parse.unquote(m.group(1)) if m else fallback
    return re.sub(r'[\\/:*?"<>|]+', "_", os.path.basename(name)).strip() or fallback


def download(url, dest, progress=None):
    """download url into dest (a file path, or a folder: then the file keeps its own name). Returns the file path."""
    say = progress or (lambda *_: None)
    link = direct_url(url)
    with requests.get(link, stream=True, timeout=60, allow_redirects=True) as r:
        r.raise_for_status()
        kind = r.headers.get("content-type", "")
        if "text/html" in kind and drive_id(url):
            # still a web page: the file is private, or Google wants a sign-in / the quota is used up
            raise RuntimeError("Google Drive didn't give the file. In Drive: right-click it → Share → General access → "
                               "\"Anyone with the link\", then try again.")
        if os.path.isdir(dest) or dest.endswith(("/", "\\")):
            dest = os.path.join(dest, _filename(r, "download.zip"))
        os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
        total, done = int(r.headers.get("content-length") or 0), 0
        with open(dest + ".part", "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                done += len(chunk)
                mb = f"{done / 1e6:.0f} MB" + (f" / {total / 1e6:.0f} MB" if total else "")
                say(done / total if total else 0.5, f"Downloading {os.path.basename(dest)} ({mb})")
    os.replace(dest + ".part", dest)
    say(1.0, "Downloaded")
    return dest
