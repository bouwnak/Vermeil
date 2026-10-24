"""
gcal.py - lets her ADD events to your real Google Calendar (the iCal link in productivity.py can only read).

One-time setup (about 5 minutes, free):
  1. Go to https://console.cloud.google.com/ -> create a project (any name, e.g. "Vermeil").
  2. APIs & Services -> Library -> search "Google Calendar API" -> Enable.
  3. APIs & Services -> OAuth consent screen -> External -> fill in the app name + your email -> add
     yourself as a Test user.
  4. APIs & Services -> Credentials -> Create credentials -> OAuth client ID -> "Desktop app" -> Download JSON.
  5. In Vermeil: Settings -> Google Calendar -> "Choose the file you downloaded", then "Connect".
     A Google page opens once to ask permission. After that she remembers it (data/google_token.json).

Install once:  pip install google-api-python-client google-auth-oauthlib
"""
import os
import shutil
from datetime import datetime, timedelta

from paths import data_file

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
CRED_FILE = data_file("google_credentials.json")
TOKEN_FILE = data_file("google_token.json")


def status():
    try:
        import googleapiclient  # noqa: F401
        import google_auth_oauthlib  # noqa: F401
        libs = True
    except ImportError:
        libs = False
    return {"libs": libs, "has_credentials": os.path.exists(CRED_FILE), "connected": os.path.exists(TOKEN_FILE)}


def connected():
    return os.path.exists(TOKEN_FILE)


def save_credentials(path):
    """Copy the OAuth client file you downloaded from Google Cloud into data/."""
    import json
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not ("installed" in data or "web" in data):
        raise ValueError("That isn't a Google OAuth client file (download it from Credentials -> OAuth client ID -> Desktop app).")
    os.makedirs(os.path.dirname(CRED_FILE), exist_ok=True)
    shutil.copyfile(path, CRED_FILE)
    return True


def _service(interactive=False):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES) if os.path.exists(TOKEN_FILE) else None
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    if not creds or not creds.valid:
        if not interactive:
            raise RuntimeError("Google Calendar isn't connected yet (Settings -> Google Calendar -> Connect).")
        from google_auth_oauthlib.flow import InstalledAppFlow
        if not os.path.exists(CRED_FILE):
            raise RuntimeError("First choose the OAuth file you downloaded from Google Cloud (see the steps in Settings).")
        creds = InstalledAppFlow.from_client_secrets_file(CRED_FILE, SCOPES).run_local_server(port=0, open_browser=True)
    with open(TOKEN_FILE, "w", encoding="utf-8") as f:
        f.write(creds.to_json())
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def connect():
    _service(interactive=True)
    return "Connected to Google Calendar."


def disconnect():
    try:
        os.remove(TOKEN_FILE)
    except OSError:
        pass
    return "Disconnected Google Calendar."


def _iso(date, hm):
    dt = datetime.strptime(f"{date} {hm}", "%Y-%m-%d %H:%M").astimezone()       # your PC's time zone
    return dt.isoformat()


def event_body(title, date, time=None, end_time=None, notes=""):
    body = {"summary": title, "description": notes or "Added by Vermeil"}
    if time:
        end = end_time or (datetime.strptime(time, "%H:%M") + timedelta(hours=1)).strftime("%H:%M")
        end_date = date if end > time else (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        body["start"], body["end"] = {"dateTime": _iso(date, time)}, {"dateTime": _iso(end_date, end)}
    else:
        nxt = (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        body["start"], body["end"] = {"date": date}, {"date": nxt}
    return body


def add_event(title, date, time=None, end_time=None, notes=""):
    ev = _service().events().insert(calendarId="primary", body=event_body(title, date, time, end_time, notes)).execute()
    return ev.get("id"), ev.get("htmlLink")


def delete_event(event_id):
    _service().events().delete(calendarId="primary", eventId=event_id).execute()
    return True


def upcoming(days=7):
    now = datetime.now().astimezone()
    res = _service().events().list(calendarId="primary", timeMin=now.isoformat(), timeMax=(now + timedelta(days=days)).isoformat(),
                                   singleEvents=True, orderBy="startTime", maxResults=50).execute()
    return [{"title": e.get("summary", "(no title)"), "start": e["start"].get("dateTime") or e["start"].get("date"), "id": e["id"]}
            for e in res.get("items", [])]
