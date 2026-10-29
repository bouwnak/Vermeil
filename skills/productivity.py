"""
productivity.py - email, meetings, calendar, scheduling, briefings and documents.

  inbox_summary()            read your newest Gmail emails (read-only) and summarise them
  start_meeting / stop_meeting   record a meeting with the mic -> transcript -> notes + action items
  free_slots(date, minutes)  find free time between your events, schedule and timed tasks
  schedule_task(title, minutes, date)   put a task into the first free slot
  morning_briefing()         weather + agenda + news + birthdays + goals, once a day
  sync_ical(url) / export_ical()  Google Calendar: read its "secret iCal address", write a .ics to import
  create_document(title, markdown, kind)  Word / text / markdown file in Documents\\Vermeil, then open it
"""
import email
import imaplib
import json
import os
from paths import open_path
import re
import shutil
import threading
import time
import wave
from datetime import date, datetime, timedelta
from email.header import decode_header

import requests

from paths import data_file

HOME = os.path.expanduser("~")
DOCS_DIR = os.path.join(HOME, "Documents", "Vermeil")
MEETINGS_DIR = data_file("meetings")
STATE_FILE = data_file("productivity.json")


def _state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}


def _save_state(s):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2)


def _ask(prompt, model="smart"):
    import llm
    return llm.ask(prompt, model=model)


# ------------------------------------------------------------------ email (read-only)
def _decode(value):
    out = []
    for part, enc in decode_header(value or ""):
        out.append(part.decode(enc or "utf-8", "replace") if isinstance(part, bytes) else part)
    return "".join(out)


def _body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(part.get("Content-Disposition")):
                return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                import web
                return web.html_to_text(part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace"))[1]
        return ""
    payload = msg.get_payload(decode=True) or b""
    return payload.decode(msg.get_content_charset() or "utf-8", "replace")


def fetch_emails(n=10, unread_only=True):
    user, pw = os.environ.get("EMAIL_ADDRESS"), os.environ.get("EMAIL_APP_PASSWORD")
    if not user or not pw:
        raise RuntimeError("Email isn't set up: add EMAIL_ADDRESS and EMAIL_APP_PASSWORD to the .env file.")
    box = imaplib.IMAP4_SSL("imap.gmail.com", timeout=20)
    try:
        box.login(user, pw)
        box.select("INBOX", readonly=True)                  # read-only: nothing gets marked as read
        _, data = box.search(None, "UNSEEN" if unread_only else "ALL")
        ids = data[0].split()[-n:]
        out = []
        for i in reversed(ids):
            _, msg_data = box.fetch(i, "(BODY.PEEK[])")
            msg = email.message_from_bytes(msg_data[0][1])
            out.append({"from": _decode(msg.get("From")), "subject": _decode(msg.get("Subject")),
                        "date": msg.get("Date", ""), "text": re.sub(r"\s+", " ", _body(msg))[:1200]})
        return out
    finally:
        try:
            box.logout()
        except Exception:
            pass


def inbox_summary(n=10, unread_only=True):
    try:
        mails = fetch_emails(n, unread_only)
    except Exception as e:
        return str(e)
    if not mails:
        return "No unread emails." if unread_only else "Your inbox is empty."
    listing = "\n\n".join(f"FROM: {m['from']}\nSUBJECT: {m['subject']}\nDATE: {m['date']}\n{m['text']}" for m in mails)
    return _ask("Summarise these emails for the user. Group them: needs action (with what to do and any deadline), "
                "worth reading, and can ignore (promos/notifications). One line each. Never invent details.\n\n" + listing,
                model="chat")


# ------------------------------------------------------------------ meeting notes
class _Recorder:
    def __init__(self):
        self.stream, self.frames, self.started, self.title = None, [], None, ""
        self.lock = threading.Lock()

    def start(self, title=""):
        import sounddevice as sd
        if self.stream:
            return False
        self.frames, self.started, self.title = [], time.time(), title or "Meeting"

        def cb(indata, _frames, _t, _status):
            with self.lock:
                self.frames.append(indata.copy())
        self.stream = sd.InputStream(samplerate=16000, channels=1, dtype="int16", callback=cb)
        self.stream.start()
        return True

    def stop(self):
        import numpy as np
        if not self.stream:
            return None
        self.stream.stop()
        self.stream.close()
        self.stream = None
        with self.lock:
            audio = np.concatenate(self.frames) if self.frames else np.zeros((0, 1), dtype="int16")
            self.frames = []
        return audio


recorder = _Recorder()


def start_meeting(title=""):
    if recorder.stream:
        return "Already recording a meeting. Say 'stop the meeting notes' when it ends."
    try:
        recorder.start(title)
    except Exception as e:
        return f"I couldn't use the microphone: {e}"
    return f"Recording '{recorder.title}'. Say 'stop the meeting notes' when it's over."


def stop_meeting(make_tasks=True):
    title, started = recorder.title, recorder.started
    audio = recorder.stop()
    if audio is None:
        return {"error": "No meeting is being recorded."}
    os.makedirs(MEETINGS_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    wav_path = os.path.join(MEETINGS_DIR, f"{stamp}.wav")
    with wave.open(wav_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(audio.tobytes())
    minutes = round((time.time() - (started or time.time())) / 60)
    import stt
    transcript = stt.transcribe(audio.reshape(-1).astype("float32") / 32768.0, keep_all=True)
    if not transcript.strip():
        return {"error": "I didn't catch any speech in the recording.", "audio": wav_path}
    import llm
    data = llm.ask("Make meeting notes from this transcript. Reply as JSON: {\"summary\": \"3-5 sentences\", "
                   "\"decisions\": [\"...\"], \"action_items\": [{\"task\": \"...\", \"who\": \"...\", \"due\": \"YYYY-MM-DD or empty\"}]}"
                   f"\nToday is {date.today().isoformat()}.\n\nTRANSCRIPT:\n{transcript[:20000]}", model="smart", json_mode=True)
    notes_md = (f"# {title} - {datetime.now().strftime('%b %d, %Y %I:%M %p')} ({minutes} min)\n\n## Summary\n{data.get('summary', '')}\n\n"
                "## Decisions\n" + "\n".join(f"- {d}" for d in data.get("decisions", [])) +
                "\n\n## Action items\n" + "\n".join(f"- [ ] {a.get('task')}" + (f" ({a.get('who')})" if a.get("who") else "")
                                                     + (f" - due {a.get('due')}" if a.get("due") else "") for a in data.get("action_items", [])) +
                f"\n\n## Transcript\n{transcript}")
    md_path = os.path.join(MEETINGS_DIR, f"{stamp}.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(notes_md)
    added = 0
    if make_tasks:
        import f1
        for a in data.get("action_items", []):
            if a.get("task") and (not a.get("who") or a.get("who", "").lower() in ("me", "i", "you", "user", "")):
                f1.add_task(a["task"], None, "normal", a.get("due") or None)
                added += 1
    return {"title": title, "minutes": minutes, "summary": data.get("summary", ""), "decisions": data.get("decisions", []),
            "action_items": data.get("action_items", []), "notes_file": md_path, "tasks_added": added}


def stop_meeting_text():
    r = stop_meeting()
    if "error" in r:
        return r["error"]
    return (f"Meeting notes saved ({r['minutes']} min) to {r['notes_file']}.\nSummary: {r['summary']}\n"
            f"Action items: {'; '.join(a.get('task', '') for a in r['action_items']) or 'none'}. "
            f"I added {r['tasks_added']} of them to your tasks.")


# ------------------------------------------------------------------ smart scheduling
def _hm(s):
    try:
        h, m = map(int, str(s).split(":")[:2])
        return h * 60 + m
    except (ValueError, TypeError):
        return None


def busy_blocks(day):
    """[(start_min, end_min, what)] for one date, from events, weekly schedule, timed tasks and reminders."""
    import f1
    d = f1.user_data
    iso, weekday = day.isoformat(), day.strftime("%A")
    blocks = []
    for e in d.get("events", []):
        if e.get("date") == iso and _hm(e.get("time")) is not None:
            start = _hm(e["time"])
            end = _hm(e.get("end_time")) or start + 60
            blocks.append((start, max(end, start + 15), e["title"]))
    for key, acts in d.get("schedule", {}).items():
        if key.lower() in (weekday.lower(), iso):
            for a in acts:
                if _hm(a.get("time")) is not None:
                    blocks.append((_hm(a["time"]), _hm(a["time"]) + 60, a.get("activity", "schedule")))
    for t in d.get("tasks", []):
        if not t.get("done") and _hm(t.get("time")) is not None and (t.get("deadline") in (None, "", iso)):
            blocks.append((_hm(t["time"]), _hm(t["time"]) + 30, t["task"]))
    return sorted(blocks)


def free_slots(day=None, minutes=60, start="08:00", end="22:00"):
    day = date.fromisoformat(day) if isinstance(day, str) and day else (day or date.today())
    lo, hi = _hm(start), _hm(end)
    if day == date.today():
        now = datetime.now()
        lo = max(lo, now.hour * 60 + now.minute + 10)
    slots, cur = [], lo
    for s, e, _ in busy_blocks(day):
        if s - cur >= minutes:
            slots.append((cur, s))
        cur = max(cur, e)
    if hi - cur >= minutes:
        slots.append((cur, hi))
    fmt = lambda m: f"{m // 60:02d}:{m % 60:02d}"
    return [{"start": fmt(a), "end": fmt(b), "minutes": b - a} for a, b in slots]


def free_slots_text(day=None, minutes=60):
    day_s = day or date.today().isoformat()
    slots = free_slots(day_s, int(minutes or 60))
    if not slots:
        return f"No free {minutes}-minute gaps on {day_s} between 8 AM and 10 PM."
    return f"Free on {day_s}: " + ", ".join(f"{s['start']}-{s['end']}" for s in slots)


def schedule_task(title, minutes=60, day=None, earliest="08:00"):
    """Put a task into the first free gap (today, then the next 6 days)."""
    import f1
    start_day = date.fromisoformat(day) if day else date.today()
    for i in range(7):
        d = start_day + timedelta(days=i)
        slots = free_slots(d, int(minutes or 60), start=earliest)
        if slots:
            s = slots[0]["start"]
            e_min = _hm(s) + int(minutes or 60)
            f1.add_event(title, d.isoformat(), s, f"{e_min // 60:02d}:{e_min % 60:02d}", "Scheduled by Vermeil")
            return f"Scheduled '{title}' on {d.strftime('%A %b %d')} at {s} for {minutes} minutes."
    return "I couldn't find a free slot in the next week."


# ------------------------------------------------------------------ morning briefing
def morning_briefing(city=None):
    import f1
    parts = [f"Today is {datetime.now().strftime('%A, %B %d')}."]
    city = city or _state().get("home_city") or os.environ.get("HOME_CITY", "")
    if city:
        try:
            import web
            parts.append("Weather: " + web.forecast_text(city, 1))
        except Exception:
            pass
    parts.append("Agenda:\n" + f1.daily_agenda())
    try:
        import web
        heads = web.news()[:5]
        if heads:
            parts.append("Headlines: " + "; ".join(h["title"] for h in heads))
    except Exception:
        pass
    try:
        import mind
        goals = [e["title"] for e in mind.list_journal("goal") if e["status"] != "done"][:3]
        if goals:
            parts.append("Goals in progress: " + ", ".join(goals))
        review = mind.decisions_to_review()
        if review:
            parts.append("Decisions to look back on: " + ", ".join(e["title"] for e in review))
    except Exception:
        pass
    try:
        import academic
        due = academic.due_reviews()
        if due:
            parts.append(f"Study: {len(due)} review{'s' if len(due) > 1 else ''} due today ({', '.join(r['title'] for r in due[:3])}).")
        import sensei
        if sensei._state().get("streak") and not sensei.current_streak() == 0:
            parts.append(f"Language streak: {sensei.current_streak()} days - practise today to keep it.")
    except Exception:
        pass
    try:
        import gym
        p = gym.day_plan()
        if p:
            parts.append(f"Gym: next is Day {p['day']} ({p['title']}).")
    except Exception:
        pass
    return "\n".join(parts) + "\n(Give this as a warm, short spoken morning briefing.)"


def briefing_due(now=None):
    """True once per day, after 5 AM."""
    now = now or datetime.now()
    st = _state()
    if now.hour < 5 or st.get("last_briefing") == now.date().isoformat():
        return False
    st["last_briefing"] = now.date().isoformat()
    _save_state(st)
    return True


def set_home_city(city):
    st = _state()
    st["home_city"] = city.strip()
    _save_state(st)
    return f"Home city set to {city}."


# ------------------------------------------------------------------ Google Calendar (iCal)
def _ics_lines(text):
    out = []
    for line in text.replace("\r\n", "\n").split("\n"):
        if line.startswith((" ", "\t")) and out:
            out[-1] += line[1:]
        else:
            out.append(line)
    return out


def _ics_time(prop, value):
    """-> (date, 'HH:MM' or None) in local time."""
    if "VALUE=DATE" in prop or re.fullmatch(r"\d{8}", value):
        return datetime.strptime(value[:8], "%Y%m%d").date(), None
    utc = value.endswith("Z")
    dt = datetime.strptime(value.rstrip("Z")[:15], "%Y%m%dT%H%M%S")
    if utc:
        from datetime import timezone
        dt = dt.replace(tzinfo=timezone.utc).astimezone().replace(tzinfo=None)
    return dt.date(), dt.strftime("%H:%M")


def parse_ics(text, days_ahead=90):
    """Events from an .ics file for today .. +days_ahead (simple repeats: daily/weekly/monthly/yearly)."""
    events, cur = [], None
    today, last = date.today(), date.today() + timedelta(days=days_ahead)
    for line in _ics_lines(text):
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT" and cur is not None:
            if "start" in cur:
                events.extend(_expand(cur, today, last))
            cur = None
        elif cur is not None and ":" in line:
            prop, value = line.split(":", 1)
            name = prop.split(";")[0]
            if name == "SUMMARY":
                cur["title"] = value.replace("\\,", ",").replace("\\n", " ")
            elif name == "DTSTART":
                cur["start"] = _ics_time(prop, value)
            elif name == "DTEND":
                cur["end"] = _ics_time(prop, value)
            elif name == "RRULE":
                cur["rrule"] = dict(kv.split("=", 1) for kv in value.split(";") if "=" in kv)
            elif name == "LOCATION":
                cur["location"] = value.replace("\\,", ",")
    return sorted(events, key=lambda e: (e["date"], e["time"] or ""))


def _expand(ev, first, last):
    d0, t0 = ev["start"]
    t1 = ev.get("end", (None, None))[1]
    rule = ev.get("rrule")
    make = lambda d: {"title": ev.get("title", "(no title)"), "date": d.isoformat(), "time": t0, "end_time": t1,
                      "notes": ev.get("location", "")}
    if not rule:
        return [make(d0)] if first <= d0 <= last else []
    freq, count = rule.get("FREQ"), int(rule.get("COUNT", 0) or 0)
    until = datetime.strptime(rule["UNTIL"][:8], "%Y%m%d").date() if rule.get("UNTIL") else last
    step = {"DAILY": 1, "WEEKLY": 7}.get(freq)
    out, d, n = [], d0, 0
    while d <= min(until, last) and (not count or n < count) and n < 1000:
        if d >= first:
            out.append(make(d))
        n += 1
        if step:
            d += timedelta(days=step * int(rule.get("INTERVAL", 1)))
        elif freq == "MONTHLY":
            m = d.month + int(rule.get("INTERVAL", 1))
            y, m = d.year + (m - 1) // 12, (m - 1) % 12 + 1
            try:
                d = d.replace(year=y, month=m)
            except ValueError:
                break
        elif freq == "YEARLY":
            try:
                d = d.replace(year=d.year + 1)
            except ValueError:
                break
        else:
            break
    return out


def sync_ical(url=None):
    """Copy Google Calendar events (via its secret iCal address) into the planner. Read-only."""
    import f1
    st = _state()
    url = (url or st.get("ical_url") or "").strip()
    if not url:
        return ("To connect Google Calendar: open calendar.google.com → Settings → your calendar → "
                "'Secret address in iCal format', copy it, and paste it into Settings → Google Calendar.")
    text = requests.get(url, timeout=20).text
    if "BEGIN:VCALENDAR" not in text:
        return "That link didn't return a calendar. Make sure it's the 'Secret address in iCal format'."
    events = parse_ics(text)
    f1.user_data["events"] = [e for e in f1.user_data["events"] if e.get("source") != "google"]
    mine = {(e["title"].strip().lower(), e["date"], e.get("time") or None) for e in f1.user_data["events"]}
    events = [e for e in events if (e["title"].strip().lower(), e["date"], e.get("time") or None) not in mine]   # ones she added herself
    for e in events:
        f1.user_data["events"].append({**e, "source": "google", "added": datetime.now().strftime("%Y-%m-%d %H:%M")})
    f1.user_data["events"].sort(key=lambda e: (e["date"], e.get("time") or "00:00"))
    f1.save_data(f1.user_data)
    st["ical_url"], st["ical_synced"] = url, datetime.now().strftime("%Y-%m-%d %H:%M")
    _save_state(st)
    return f"Synced {len(events)} Google Calendar events (next 90 days)."


def export_ical(path=None):
    """Write your planner events to a .ics file you can import into Google Calendar."""
    import f1
    path = path or os.path.join(DOCS_DIR, "vermeil_calendar.ics")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vermeil//EN"]
    for i, e in enumerate(x for x in f1.user_data["events"] if x.get("source") != "google"):
        d = e["date"].replace("-", "")
        lines += ["BEGIN:VEVENT", f"UID:vermeil-{d}-{i}@local", f"SUMMARY:{e['title']}"]
        if e.get("time"):
            lines.append(f"DTSTART:{d}T{e['time'].replace(':', '')}00")
            end = e.get("end_time") or f"{(_hm(e['time']) + 60) // 60 % 24:02d}:{_hm(e['time']) % 60:02d}"
            lines.append(f"DTEND:{d}T{end.replace(':', '')}00")
        else:
            lines.append(f"DTSTART;VALUE=DATE:{d}")
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    with open(path, "w", encoding="utf-8", newline="\r\n") as f:
        f.write("\n".join(lines) + "\n")
    return f"Saved {path}. In Google Calendar: Settings → Import & export → Import, and pick this file."


# ------------------------------------------------------------------ documents
def create_document(title, content, kind="docx", open_it=True):
    """Write a document from markdown-ish text: '# Heading', '- bullet', '1. item', '**bold**'."""
    safe = re.sub(r'[<>:"/\\|?*]+', "", title).strip()[:80] or "Document"
    os.makedirs(DOCS_DIR, exist_ok=True)
    kind = (kind or "docx").lower().lstrip(".")
    path = os.path.join(DOCS_DIR, f"{safe}.{kind}")
    n = 2
    while os.path.exists(path):
        path = os.path.join(DOCS_DIR, f"{safe} ({n}).{kind}")
        n += 1
    if kind in ("txt", "md"):
        with open(path, "w", encoding="utf-8") as f:
            f.write(content if kind == "md" else re.sub(r"[*#`]", "", content))
    else:
        from docx import Document
        doc = Document()
        doc.add_heading(title, 0)
        for line in content.splitlines():
            s = line.rstrip()
            if not s.strip():
                continue
            m = re.match(r"^(#{1,3})\s+(.*)", s)
            if m:
                doc.add_heading(m.group(2), len(m.group(1)))
                continue
            if re.match(r"^\s*[-*•]\s+", s):
                p, s = doc.add_paragraph(style="List Bullet"), re.sub(r"^\s*[-*•]\s+", "", s)
            elif re.match(r"^\s*\d+[.)]\s+", s):
                p, s = doc.add_paragraph(style="List Number"), re.sub(r"^\s*\d+[.)]\s+", "", s)
            else:
                p = doc.add_paragraph()
            for i, chunk in enumerate(re.split(r"\*\*", s)):
                run = p.add_run(chunk)
                run.bold = i % 2 == 1
        doc.save(path)
    if open_it and os.name == "nt":
        try:
            open_path(path)
        except OSError:
            pass
    return f"Created {path}" + (" and opened it." if open_it else ".")


# ------------------------------------------------------------------ editing your existing documents
def _find_doc(path_or_name):
    """Full path, or just a name like 'thesis chapter 3' -> searches Documents, Desktop, Downloads."""
    import pc
    p = os.path.expanduser(str(path_or_name or "").strip().strip('"'))
    if os.path.isabs(p):
        return pc._safe_path(p)
    base = os.path.splitext(p)[0]
    hits = [h["path"] for h in pc.find_files(base, limit=40) if h["path"].lower().endswith((".docx", ".txt", ".md"))
            and "(before Vermeil edit)" not in h["path"]]
    if hits:
        return pc._safe_path(hits[0])
    cand = os.path.join(DOCS_DIR, p)
    for ext in ("", ".docx", ".txt", ".md"):
        if os.path.exists(cand + ext):
            return cand + ext
    raise FileNotFoundError(f"I couldn't find a document called '{path_or_name}'. Give me the full path.")


def read_document(path_or_name, limit=12000):
    path = _find_doc(path_or_name)
    if path.lower().endswith(".docx"):
        from docx import Document
        paras = [p.text for p in Document(path).paragraphs]
        text = "\n".join(f"[{i}] {t}" for i, t in enumerate(paras) if t.strip())
    else:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = "\n".join(f"[{i}] {t}" for i, t in enumerate(f.read().splitlines()) if t.strip())
    return path, text[:limit]


def _backup(path):
    root, ext = os.path.splitext(path)
    bak = f"{root} (before Vermeil edit){ext}"
    shutil.copy2(path, bak)
    return bak


def _set_text(par, text):
    """Change a Word paragraph's text but keep the formatting of its first piece (font, bold...)."""
    runs = par.runs
    if not runs:
        par.add_run(text)
        return
    runs[0].text = text
    for r in runs[1:]:
        r.text = ""


def apply_edits(path, edits):
    """edits: [{"op": "replace", "find": "old words", "with": "new words"},
               {"op": "rewrite", "paragraph": 4, "text": "..."}, {"op": "delete", "paragraph": 7},
               {"op": "insert_after", "paragraph": 3, "text": "...", "style": "normal|heading|bullet"},
               {"op": "append", "text": "...", "style": "normal|heading|bullet"}]
    A backup copy is saved first. Returns a short report."""
    bak = _backup(path)
    done = []
    if path.lower().endswith(".docx"):
        from docx import Document
        doc = Document(path)
        paras = list(doc.paragraphs)
        styles = {"heading": "Heading 2", "bullet": "List Bullet", "normal": None}

        def style_of(e):
            st = styles.get(e.get("style") or "normal")
            return st if st in [s.name for s in doc.styles] else None
        deleted = set()
        for e in edits:
            op = e.get("op")
            if op == "replace" and e.get("find"):
                n = 0
                for p in paras:
                    if e["find"] in p.text:
                        hit = next((r for r in p.runs if e["find"] in r.text), None)
                        if hit:                                   # keeps formatting when the words sit in one piece
                            hit.text = hit.text.replace(e["find"], e.get("with", ""))
                        else:
                            _set_text(p, p.text.replace(e["find"], e.get("with", "")))
                        n += 1
                done.append(f"replaced '{e['find'][:40]}' ({n}x)")
            elif op == "rewrite" and 0 <= int(e.get("paragraph", -1)) < len(paras):
                _set_text(paras[int(e["paragraph"])], e.get("text", ""))
                done.append(f"rewrote paragraph {e['paragraph']}")
            elif op == "delete" and 0 <= int(e.get("paragraph", -1)) < len(paras):
                deleted.add(int(e["paragraph"]))
                done.append(f"deleted paragraph {e['paragraph']}")
            elif op == "insert_after" and 0 <= int(e.get("paragraph", -1)) < len(paras):
                from docx.oxml import OxmlElement
                from docx.text.paragraph import Paragraph
                anchor = paras[int(e["paragraph"])]
                new = OxmlElement("w:p")
                anchor._p.addnext(new)
                p = Paragraph(new, anchor._parent)
                p.add_run(e.get("text", ""))
                if style_of(e):
                    p.style = doc.styles[style_of(e)]
                done.append(f"added a paragraph after {e['paragraph']}")
            elif op == "append":
                doc.add_paragraph(e.get("text", ""), style=style_of(e))
                done.append("added text at the end")
        for i in sorted(deleted, reverse=True):
            el = paras[i]._p
            el.getparent().remove(el)
        doc.save(path)
    else:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
        deleted, inserts = set(), {}
        for e in edits:
            op, i = e.get("op"), int(e.get("paragraph", -1)) if str(e.get("paragraph", "")).lstrip("-").isdigit() else -1
            if op == "replace" and e.get("find"):
                lines = [ln.replace(e["find"], e.get("with", "")) for ln in lines]
                done.append(f"replaced '{e['find'][:40]}'")
            elif op == "rewrite" and 0 <= i < len(lines):
                lines[i] = e.get("text", "")
                done.append(f"rewrote line {i}")
            elif op == "delete" and 0 <= i < len(lines):
                deleted.add(i)
                done.append(f"deleted line {i}")
            elif op == "insert_after" and 0 <= i < len(lines):
                inserts.setdefault(i, []).append(e.get("text", ""))
                done.append(f"added text after line {i}")
            elif op == "append":
                inserts.setdefault(len(lines) - 1, []).append(e.get("text", ""))
                done.append("added text at the end")
        out = []
        for i, ln in enumerate(lines):
            if i not in deleted:
                out.append(ln)
            out += inserts.get(i, [])
        if not lines:
            out += inserts.get(-1, [])
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(out) + "\n")
    return (f"Edited {os.path.basename(path)}: " + "; ".join(done) if done else "No changes were made.") + \
        f" (Backup of the old version: {os.path.basename(bak)})"


def edit_document(path_or_name, instruction):
    """'Fix the grammar in my thesis intro', 'add a conclusion', 'change Engr. Santos to Engr. Marcos'..."""
    import llm
    path, text = read_document(path_or_name)
    if not text.strip():
        return "That document looks empty."
    plan = llm.ask(
        f"The user wants this change to their document: \"{instruction}\".\n"
        f"Document '{os.path.basename(path)}', each paragraph numbered:\n{text}\n\n"
        f"Reply as JSON with the smallest set of edits: {{\"edits\": [...]}} using ops: "
        f"replace (find, with - exact words from the text), rewrite (paragraph, text), delete (paragraph), "
        f"insert_after (paragraph, text, style normal/heading/bullet), append (text, style). Keep their voice and facts.",
        model="smart", json_mode=True)
    edits = [e for e in (plan.get("edits") or []) if isinstance(e, dict)][:60]
    if not edits:
        return "I didn't find anything to change for that."
    return apply_edits(path, edits)
