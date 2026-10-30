"""
app.py - opens Vermeil's window: sidebar + white 3D room with your character.

Run:  python app.py
(The old terminal version still works:  python terminal.py)
"""
import io
import os
import json
import re
import time
import queue
import shutil
import sys
import threading
import uuid

import folders  # noqa: F401  - lets Python find brain/, senses/, skills/ (import this first)
import webview

# pywebview 5+ renamed the dialog constants (the old ones print a deprecation warning)
_FD = getattr(webview, "FileDialog", None)
_OPEN_DIALOG = _FD.OPEN if _FD else webview.OPEN_DIALOG
_FOLDER_DIALOG = _FD.FOLDER if _FD else webview.FOLDER_DIALOG
_SAVE_DIALOG = _FD.SAVE if _FD else webview.SAVE_DIALOG

import f1
import pinakamain as pm
import tts
from presence import Presence
import academic
import optional
import relationship
missions = optional.load("missions")          # Missions and the Coding helper can be uninstalled (Settings -> Plugins)
CodingAgent = optional.load("coder").CodingAgent
from Vprompt import VERMEIL_PROMPT

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
from paths import data_file, open_path  # saved files live in the data/ folder
UI_DIR = os.path.join(BASE_DIR, "ui")
MODELS_DIR = os.path.join(UI_DIR, "models")
CHARACTERS_FILE = data_file("characters.json")
ROOM_FILE = data_file("room_layout.json")
SETTINGS_FILE = data_file("app_settings.json")
MODEL_TYPES = (".glb", ".gltf", ".vrm")


TEXTURE_TYPES = (".png", ".jpg", ".jpeg", ".webp", ".bin", ".ktx2")


def copy_model_files(paths, dest):
    """Copy one model and the texture files that go with it into dest.
    - a .gltf keeps its textures in separate files: every buffer/image it names is copied too (same sub-folders)
    - extra pictures picked together with a .glb/.vrm go into <model>_face/ (where the room looks for
      eyes_*.png / mouth_*.png talking pictures); with a .gltf they go next to it
    Returns {"name": model file name, "textures": how many extra files} or {"error": ...}."""
    import json as _json
    paths = [p for p in paths if p]
    models = [p for p in paths if p.lower().endswith(MODEL_TYPES)]
    if not models:
        return {"error": "Pick a 3D model (.glb, .gltf or .vrm) too, not only pictures."}
    src = models[0]
    name = os.path.basename(src)
    os.makedirs(dest, exist_ok=True)
    shutil.copy2(src, os.path.join(dest, name))
    copied = set()

    def put(file, rel):
        rel = os.path.normpath(rel)
        if rel.startswith("..") or os.path.isabs(rel) or not os.path.isfile(file):
            return
        target = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(file, target)
        copied.add(os.path.normcase(os.path.abspath(file)))

    if name.lower().endswith(".gltf"):
        try:
            with open(src, encoding="utf-8") as f:
                doc = _json.load(f)
            from urllib.parse import unquote
            for item in doc.get("buffers", []) + doc.get("images", []):
                uri = item.get("uri") or ""
                if uri and not uri.startswith("data:"):
                    put(os.path.join(os.path.dirname(src), unquote(uri)), unquote(uri))
        except (OSError, ValueError) as e:
            print(f"[import] couldn't read the textures of {name}: {e}")
    face = os.path.splitext(name)[0] + "_face"
    for p in paths:
        if p is src or not p.lower().endswith(TEXTURE_TYPES):
            continue
        if os.path.normcase(os.path.abspath(p)) in copied:
            continue
        put(p, os.path.basename(p) if name.lower().endswith(".gltf") else os.path.join(face, os.path.basename(p)))
    return {"name": name, "textures": len(copied)}
GREET_AFTER_AWAY = 120          # seconds you must be gone before she greets you again

DEFAULT_CHARACTERS = {
    "active": "vermeil",
    "characters": [
        {"id": "vermeil", "name": "Vermeil", "prompt": VERMEIL_PROMPT.strip(), "voice": "en-US-AriaNeural",
         "rate": "+0%", "pitch": "+5Hz", "model": "anime_girl.glb", "outfit": "mech", "hair": "original", "memory_key": "user"},
        {"id": "pip", "name": "Pip", "voice": "en-US-AnaNeural", "rate": "+5%", "pitch": "+20Hz",
         "model": "builtin:penguin", "memory_key": "pip",
         "prompt": "You are Pip, a small, cheerful penguin who lives in the user's cozy room. You are curious, "
                   "a little clumsy and very affectionate. Say things like 'noot!' when excited. Keep replies under "
                   "40 words and speak only in dialogue, never actions."},
        {"id": "robot", "name": "Robo", "voice": "en-US-GuyNeural", "rate": "+10%", "pitch": "+0Hz",
         "model": "Robot.glb", "memory_key": "robot",
         "prompt": "You are Robo, a cheerful little robot helper. Speak simply and kindly, "
                   "keep replies under 40 words, and speak only in dialogue, never actions."},
    ],
}
NEW_CHARACTERS = []          # characters added by updates (Kit became Vermeil's model)
DEFAULT_SETTINGS = {"always_look": False, "speak_replies": True, "greet_on_sight": True, "camera_on_start": False,
                    "listen_on_start": False, "mirror_look": False,
                    "quiet_mode": False, "context_aware": False, "style": "companion",
                    "self_check": False, "humor": 2,
                    "hotkeys": True, "desktop_notifications": True,
                    "morning_briefing": True,
                    "voice_style": "normal", "barge_in": False,
                    "privacy_mode": False, "gesture_mode": False, "scene_transitions": True, "gym_room": True, "idle_activities": True,
                    "keep_screens": True, "stream_speech": True, "noise_filter": True, "wake_sensitivity": 2,
                    "watch_objects": True, "code_auto_write": True, "music_source": "youtube", "duck_audio": True,
                    "performance": "auto", "phone_access": False,
                    "focus_block": True, "focus_allow_words": ""}


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else json.loads(json.dumps(default))
    except (OSError, json.JSONDecodeError):
        return json.loads(json.dumps(default))


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def _percent(v):
    """Slider value -> Edge rate string, e.g. 15 -> '+15%'."""
    try:
        n = max(-50, min(100, int(float(str(v).rstrip("%")))))
    except (TypeError, ValueError):
        n = 0
    return f"{n:+d}%"


def _hertz(v):
    """Slider value -> Edge pitch string, e.g. -10 -> '-10Hz'."""
    try:
        n = max(-50, min(50, int(float(str(v).rstrip("Hz")))))
    except (TypeError, ValueError):
        n = 0
    return f"{n:+d}Hz"


def _rvc_settings(v):
    """A character's RVC voice clone settings, cleaned up ({} = no clone)."""
    if not isinstance(v, dict) or not str(v.get("model") or "").strip():
        return {}

    def num(key, lo, hi, default):
        try:
            return max(lo, min(hi, float(v.get(key, default))))
        except (TypeError, ValueError):
            return default
    return {"model": str(v["model"]).strip()[:40], "pitch": int(num("pitch", -24, 24, 0)),
            "index_rate": round(num("index_rate", 0, 1, 0.5), 2), "protect": round(num("protect", 0, 0.5, 0.33), 2),
            "base": v.get("base") if v.get("base") in RVC_BASES else "own"}


RVC_BASES = ("own", "female_high", "female", "female_low", "male_high", "male", "male_low")   # = rvc.BASE_CHOICES


REACTIONS = {
    "Window": "The user just changed the sky outside the window to {result}.",
    "Wall lights": "The user just changed the wall lights to {result}.",
    "Neon sign": "The user just switched the neon sign {result}.",
    "Monitor": "The user just switched the computer monitor {result}.",
    "Desk lamp": "The user just switched the desk lamp {result}.",
    "Moon lamp": "The user just switched the moon lamp {result}.",
    "Cat": "The user just petted the sleeping cat.",
    "Radio": "The user just switched the radio {result}.",
}
REACTION_COOLDOWN = 8       # seconds between comments, so she doesn't talk over every click


# how a reply should be written so the voice reads it like a real person (added to auto-written personalities)
SPOKEN_WRITING = ("write the way people talk out loud: short spoken sentences, commas and full stops for the pauses, "
                "\"...\" for a trailing-off pause, \"!\" or \"?\" to carry the feeling, numbers and symbols written "
                "as words, no emojis, no *actions*, no brackets, no filler sounds like hm, ahh or mmm, no ~.")


class Api:
    """Everything the window can ask Python to do (called from ui/app.js)."""

    def __init__(self):
        self._window = None
        f1.stop_leftover_player()                         # a song still playing from last time Vermeil was open
        self._memory = pm.load_memory()
        pm._memory_ref = self._memory
        self._command_map = pm.build_command_map()
        self._characters = _read_json(CHARACTERS_FILE, DEFAULT_CHARACTERS)
        self._add_new_characters()
        if not any(c["id"] == "pip" for c in self._characters["characters"]):   # add Pip to older saves
            self._characters["characters"].insert(1, json.loads(json.dumps(DEFAULT_CHARACTERS["characters"][1])))
        if tts.engine() != "edge":
            for c in self._characters["characters"]:      # old online (Edge) voice names -> offline Piper voices
                if not tts.is_online_voice(c.get("voice")):   # (Japanese/Korean/... online voices are kept)
                    c["voice"] = tts.to_local_voice(c.get("voice"))
        self._last_reaction = 0.0
        saved = _read_json(SETTINGS_FILE, {})
        self._ui = saved.pop("ui", {}) if isinstance(saved.get("ui"), dict) else {}
        self._settings = {**DEFAULT_SETTINGS, **{k: v for k, v in saved.items() if k in DEFAULT_SETTINGS}}
        if not self._ui.get("own_music_v1"):              # one time: Vermeil Music replaces the real Spotify
            self._ui["own_music_v1"] = True
            self._settings["music_source"] = "youtube"
            self._ui["hidden_panels"] = sorted(set(self._ui.get("hidden_panels") or []) | {"spotify"})
            _write_json(SETTINGS_FILE, {**self._settings, "ui": self._ui})
        old = set(self._ui.get("hidden_panels") or [])
        if old & {"baking", "cooking"}:                    # Cooking and Baking are one menu item ("kitchen") now
            self._ui["hidden_panels"] = sorted((old - {"baking", "cooking"}) | {"kitchen"})
        if self._ui.get("open_panel") in ("baking", "cooking"):
            self._ui["kitchen_tab"] = self._ui["open_panel"]
            self._ui["open_panel"] = "kitchen"
        self._presence = Presence(on_event=self._on_presence, camera_index=int(self._ui.get("camera_index", -1)))
        f1.presence = self._presence
        threading.Thread(target=self._apply_mic, daemon=True).start()
        self._listening = False
        self._voice_thread = None
        self._answers = queue.Queue()
        self._waiting_for_answer = False
        self._coder = CodingAgent(approve=self._approve_code, on_event=self.emit)
        if self._ui.get("code_workspace") and os.path.isdir(self._ui["code_workspace"]):
            self._coder.set_workspace(self._ui["code_workspace"])
        self._approvals = {}
        self._owner_here = False
        self._owner_gone_since = None
        self._greeted_once = False
        self._busy = threading.Lock()
        pm.ui_emit = self.emit
        pm.vision_source = self._presence.snapshot
        self._privacy_changed()
        pm.quick_command = self._quick_command
        pm.app_actions = {"switch_character": self._switch_character, "gym_command": self._gym_command,
                          "look_at_screen": self._look_at_screen,
                          "meeting_on": lambda title="": self.meeting(True, title)["message"],
                          "focus_start_ui": self._focus_from_voice,
                          "character_action": self._character_action,
                          "group_chat": lambda topic, chars=None, turns=6: self.group_chat(topic, chars, turns).get("message") or "Couldn't start.",
                          "check_gesture": lambda: json.dumps(self.check_gesture()),
                          "build_code": self.build_code,
                          "play_something": self._play_something,
                          "set_volume": lambda percent: self._set_volume(int(percent)),
                          "objects_in_view": lambda: (self._objects_seen() or "The camera is off (or object spotting is off in Settings)."),
                          "meeting_off": lambda: self.meeting(False)["message"]}
        pm.screen_source = self._screenshot
        pm.on_wake = self._on_wake
        missions.on_change = lambda m: self.emit({"type": "mission", "mission": m})
        import pc
        pc.on_emergency[:] = [self._emergency_stop_all]
        f1.on_music = self._on_music
        pm.camera_on = lambda: self._presence.running
        pm.objects_seen = self._objects_seen
        self._apply_settings()
        pm.ask_hook = self._ask_in_window
        pm.voice_mode = False
        self._apply_character()

    # ---------- Python -> window ----------
    def emit(self, event):
        if self._window:
            try:
                self._window.evaluate_js(f"window.onPyEvent && window.onPyEvent({json.dumps(event)})")
            except Exception as e:
                print(f"[ui emit] {e}")

    # ---------- startup ----------
    def get_state(self):
        return {
            "characters": self._characters["characters"],
            "active": self._characters["active"],
            "settings": self._settings,
            "models": self.list_models(),
            "owner": self._presence.owner_name,
            "camera": self._presence.running,
            "listening": self._listening,
            "tts": pm.tts_ready,
            "ui": self._ui,
            "history": self._history(),
            "plugins": self._plugins_brief(),
            "performance": self.performance_status(),
        }

    def _plugins_brief(self):
        """menu entries of uninstalled plugins (hidden) + whether this is the first start after installing"""
        try:
            import plugins
            owner = {k: {"id": p["id"], "name": p["name"]} for p in plugins.PLUGINS
                     if not plugins.is_installed(p["id"]) for k in p.get("panels", [])}
            return {"hidden_panels": plugins.hidden_panels(), "owner": owner, "fresh": bool(plugins._load().get("fresh"))}
        except Exception as e:
            print(f"[plugins] {e}")
            return {"hidden_panels": [], "owner": {}, "fresh": False}

    # ---------- reminders & events that are due ----------
    def _alert_loop(self):
        last = {"ical": 0.0, "prices": 0.0, "weather": 0.0, "moments": 0.0}
        briefed = False
        while True:
            try:
                self.check_alerts()
            except Exception as e:
                print(f"[alerts] {e}")
            now = time.time()
            try:
                import pc
                if not pc.stop_event.is_set():
                    missions.run_due(confirm=self._approve)
            except Exception as e:
                print(f"[missions] {e}")
            for job, every, fn in (("ical", 1800, self._sync_calendar), ("prices", 6 * 3600, self._check_prices),
                                   ("weather", 3600, self._weather_alerts), ("moments", 6 * 3600, self._scan_moments)):
                if now - last[job] >= every:
                    last[job] = now
                    threading.Thread(target=fn, daemon=True).start()
            if not briefed and self._settings["morning_briefing"]:
                briefed = True
                threading.Thread(target=self._maybe_brief, daemon=True).start()
            time.sleep(20)

    def _scan_moments(self):
        key = pm.persona.get("memory_key", "user")
        found = relationship.scan_moments(self._memory.get(key, {}).get("conversations", []))
        if found:
            self.emit({"type": "story"})

    # ---------- approvals (missions, anything running in the background) ----------
    def _approve(self, question):
        """Ask 'Can I ...?' with Yes/No buttons in the window; wait up to 15 minutes."""
        approval_id = uuid.uuid4().hex[:8]
        q = queue.Queue()
        self._approvals[approval_id] = q
        self.emit({"type": "approval", "id": approval_id, "text": f"Can I {question}?"})
        if self._settings["desktop_notifications"]:
            try:
                import pc
                pc.notify("Vermeil needs your OK", f"Can I {question}?")
            except Exception:
                pass
        try:
            return bool(q.get(timeout=900))
        except queue.Empty:
            return False
        finally:
            self._approvals.pop(approval_id, None)
            self.emit({"type": "approval_done", "id": approval_id})

    def approve(self, approval_id, yes):
        return self.code_decide(approval_id, yes)

    # ---------- missions ----------
    def missions_list(self):
        return missions.list_missions() or []

    def mission_create(self, goal):
        if not (goal or "").strip():
            return {"error": "Type what you want done."}
        try:
            return {"mission": missions.create(goal.strip())}
        except Exception as e:
            return {"error": str(e)}

    def mission_action(self, mission_id, action):
        fn = {"pause": missions.pause, "resume": missions.resume, "run_now": missions.run_now, "skip": missions.skip_step,
              "cancel": missions.cancel, "delete": missions.delete}.get(action)
        if not fn:
            return {"error": "Unknown action."}
        fn(mission_id)
        return {"missions": missions.list_missions() or []}

    # ---------- chat editing, our story, recommendations, screenshots ----------
    def _convo(self):
        key = pm.persona.get("memory_key", "user")
        return self._memory.setdefault(key, {"conversations": [], "preferences": {}})["conversations"]

    def chat_history(self):
        return self._history(60)

    def chat_edit(self, index, text):
        msgs = self._convo()
        i = int(index)
        if 0 <= i < len(msgs) and (text or "").strip():
            msgs[i]["content"] = text.strip()
            pm.save_memory(self._memory)
        return self._history()

    def chat_delete(self, index, with_reply=True):
        """Delete one message (and her reply to it, so the chat still makes sense)."""
        msgs = self._convo()
        i = int(index)
        if 0 <= i < len(msgs):
            n = 2 if with_reply and msgs[i]["role"] == "user" and i + 1 < len(msgs) and msgs[i + 1]["role"] == "assistant" else 1
            del msgs[i:i + n]
            pm.save_memory(self._memory)
        return self._history()

    def chat_search(self, query):
        import mind
        return mind.recall(query, k=10)

    def our_story(self):
        return relationship.story()

    def story_add(self, text):
        relationship.add_moment(text)
        return relationship.story()

    def story_remove(self, text):
        relationship.remove_moment(text)
        return relationship.story()

    def recommend_ui(self, category="anything", mood=""):
        import mind
        try:
            return {"items": mind.recommend(category or "anything", 6, mood or "", pm.shared_preferences())}
        except Exception as e:
            return {"error": str(e)}

    def rate_recommendation(self, title, liked):
        key = pm.persona.get("memory_key", "user")
        prefs = self._memory.setdefault(key, {"conversations": [], "preferences": {}}).setdefault("preferences", {})
        prefs.pop(f"likes: {title.lower()}", None)
        prefs.pop(f"dislikes: {title.lower()}", None)
        prefs[f"{'likes' if liked else 'dislikes'}: {title.lower()}"] = "like" if liked else "dislike"
        pm.save_memory(self._memory)
        return True

    def screens_list(self):
        import mind
        return list(reversed(mind.list_screens()))[:60]

    def screen_image(self, name):
        import base64, mind
        try:
            with open(mind.screen_path(name), "rb") as f:
                return base64.b64encode(f.read()).decode()
        except OSError:
            return None

    def screen_delete(self, name):
        import mind
        items = [x for x in mind.list_screens() if x["file"] != name]
        try:
            os.remove(mind.screen_path(name))
        except OSError:
            pass
        with open(mind.SCREENS_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=1, ensure_ascii=False)
        return self.screens_list()

    def _notify(self, title, text):
        self.emit({"type": "alert", "text": text})
        if self._settings["desktop_notifications"]:
            import pc
            pc.notify(title, text)

    def _sync_calendar(self):
        import productivity as prod
        if prod._state().get("ical_url"):
            try:
                print("[calendar]", prod.sync_ical())
                self.emit({"type": "tool", "name": "sync_google_calendar"})
            except Exception as e:
                print(f"[calendar] {e}")

    def _check_prices(self):
        import web
        try:
            for a in web.check_prices():
                self._notify("Price drop", a)
        except Exception as e:
            print(f"[prices] {e}")

    def _weather_alerts(self):
        import productivity as prod, web
        city = prod._state().get("home_city")
        if not city:
            return
        try:
            f = web.forecast(city, 1)
            if f.get("offline"):                       # no internet right now: say it once, not every hour
                if not getattr(self, "_weather_offline", False):
                    print("[weather] can't reach the weather services right now (will keep trying quietly)")
                self._weather_offline = True
                return
            self._weather_offline = False
            seen = prod._state().get("weather_alerts_seen", [])
            for a in f.get("alerts", []):
                if a["headline"] and a["headline"] not in seen:
                    self._notify("Weather alert", f"⚠️ {a['headline']}")
                    seen.append(a["headline"])
            st = prod._state(); st["weather_alerts_seen"] = seen[-20:]; prod._save_state(st)
        except Exception as e:
            print(f"[weather] {e}")

    def _maybe_brief(self):
        import productivity as prod
        time.sleep(8)                                   # let the window and AI start first
        if not prod.briefing_due():
            return
        try:
            facts = prod.morning_briefing()
            line = pm.quick_line(f"Give the user their morning briefing from these facts, warm and short (under 90 "
                                 f"words): {facts}") or facts
            self.emit({"type": "reply", "text": line})
            if self._settings["speak_replies"] and not self._settings["quiet_mode"]:
                pm.speak(line)
        except Exception as e:
            print(f"[briefing] {e}")

    def check_alerts(self):
        import smartremind
        idle = smartremind.idle_minutes()
        came_back = False
        if idle >= smartremind.AWAY_MINUTES:
            self._was_away = True
        elif getattr(self, "_was_away", True) and idle < 1:     # opening Vermeil counts as coming home too
            came_back, self._was_away = True, False
        for alert in f1.due_alerts() + smartremind.due(came_back=came_back):
            self.emit({"type": "alert", "text": alert})
            self._phone_note("Vermeil reminder", alert)
            if self._settings["desktop_notifications"]:
                import pc
                pc.notify("Vermeil reminder", alert)
            line = pm.quick_line(f"Tell the user this right now, warmly and briefly: {alert}") or alert
            self.emit({"type": "reply", "text": line})
            if self._settings["speak_replies"]:
                pm.speak(line)

    # ---------- planner (calendar, reminders, tasks, ...) ----------
    def get_planner(self):
        d = f1.user_data
        today = time.strftime("%Y-%m-%d")
        return {
            "events": [e for e in d["events"] if e["date"] >= today][:60],
            "reminders": [r for r in d["reminders"] if not r.get("alerted")],
            "tasks": d["tasks"],
            "schedule": d["schedule"],
            "shopping": d["shopping"],
            "birthdays": d["birthdays"],
            "notes": [n for n in f1.manage_notes("view").split("\n") if n and n != "No notes found."],
        }

    def planner_remove(self, kind, key, date=None):
        actions = {
            "event": lambda: f1.remove_event(key, date),
            "reminder": lambda: f1.remove_reminder(key),
            "task": lambda: f1.remove_task(key),
            "shopping": lambda: f1.remove_shopping_item(key),
            "note": lambda: f1.manage_notes("remove", key),
            "schedule": lambda: f1.remove_schedule(date, key),
            "birthday": lambda: self._remove_birthday(key),
        }
        if kind in actions:
            actions[kind]()
        return self.get_planner()

    # ---------- calendar planner ----------
    def planner_month(self, year, month):
        return f1.planner_month(year, month)

    def planner_day(self, date):
        return f1.planner_day(date)

    def planner_add(self, item):
        """Add something from the planner form. item: {kind, title, date, time, repeat, priority, notes}"""
        kind, title = item.get("kind"), (item.get("title") or "").strip()
        date, t = item.get("date"), item.get("time") or None
        if not title:
            return {"error": "Type a title first."}
        if kind == "event":
            msg = f1.add_event(title, date, t, None, item.get("notes", ""))
        elif kind == "task":
            msg = f1.add_task(title, t, item.get("priority") or "normal", date or None)
        elif kind == "reminder":
            msg = f1.add_reminder(title, f"{date} {t or '09:00'}", item.get("repeat") or "none")
        elif kind == "birthday":
            msg = f1.add_birthday(title, date)
        elif kind == "weekly":
            day = time.strftime("%A", time.strptime(date, "%Y-%m-%d")) if date else item.get("weekday")
            msg = f1.add_schedule(day, title, t)
        else:
            return {"error": "Unknown type."}
        return {"message": msg}

    def planner_toggle_task(self, title, done):
        return f1.complete_task(title, done)

    def _remove_birthday(self, name):
        f1.user_data["birthdays"] = [b for b in f1.user_data["birthdays"] if b["name"] != name]
        f1.save_data(f1.user_data)

    # ---------- study mode ----------
    def study_files(self):
        return {"files": academic.list_files(), "reviews": academic.list_reviews(),
                "review_types": academic.REVIEW_TYPES, "kinds": list(academic.KINDS)}

    def study_add_files(self, kind="lecture", subject=""):
        kinds = ";".join("*" + e for e in academic.SUPPORTED)
        paths = self._window.create_file_dialog(_OPEN_DIALOG, allow_multiple=True,
                                                file_types=(f"Study files and video lectures ({kinds})",))
        return self.study_add_paths(list(paths or []), kind, subject)

    def study_add_file_path(self, path, kind="lecture", subject=""):
        return self.study_add_paths([path] if path and os.path.exists(path) else [], kind, subject)

    def study_add_paths(self, paths, kind="lecture", subject=""):
        """documents are read now; video / audio lectures are written down in the background ({"type": "study_media"})"""
        added, errors, queued = [], [], []
        for p in paths or []:
            if not os.path.isfile(p):
                errors.append(f"{os.path.basename(p)}: not found (was the USB drive taken out?)")
            elif academic.is_media(p):
                queued.append(p)
            else:
                try:
                    added.append(academic.add_file(p, kind, subject))
                except Exception as e:
                    errors.append(f"{os.path.basename(p)}: {e}")
        if queued:
            self._study_media_queue(queued, kind, subject)
        return {"added": added, "errors": errors, "videos": [os.path.basename(p) for p in queued], **self.study_files()}

    def _study_media_queue(self, paths, kind, subject):
        if not hasattr(self, "_media_jobs"):
            import queue
            self._media_jobs = queue.Queue()

            def worker():
                while True:
                    path, k, subj = self._media_jobs.get()
                    name = os.path.basename(path)
                    left = self._media_jobs.qsize()
                    more = f" ({left} more after this)" if left else ""
                    try:
                        entry = academic.add_file(path, k, subj, lambda pct, text: self.emit(
                            {"type": "study_media", "name": name, "pct": pct, "text": text + more}))
                        self.emit({"type": "study_media", "name": name, "done": True, "entry": entry})
                    except Exception as e:  # noqa: BLE001 - shown to the user
                        self.emit({"type": "study_media", "name": name, "done": True, "error": f"{name}: {e}"})
            threading.Thread(target=worker, daemon=True).start()
        for p in paths:
            self._media_jobs.put((p, kind, subject))

    def study_drives(self):
        """USB drives plugged in right now (Study -> Library -> USB drive)"""
        return {"drives": academic.removable_drives()}

    def study_scan(self, path=""):
        """the study files on a drive or folder; no path = pick a folder"""
        if not path:
            picked = self._window.create_file_dialog(_FOLDER_DIALOG)
            path = (picked[0] if isinstance(picked, (list, tuple)) else picked) if picked else ""
            if not path:
                return {"files": [], "path": ""}
        if not os.path.isdir(path):
            return {"error": "That drive isn't there any more.", "files": [], "path": path}
        return {"files": academic.scan_folder(path), "path": path}

    def study_import_file_data(self, filename, base64_data, kind="lecture", subject=""):
        import base64
        added, errors = [], []
        if not filename or not base64_data:
            return {"added": [], "errors": ["Missing file or data."], **self.study_files()}
        try:
            if "," in base64_data:
                base64_data = base64_data.split(",", 1)[1]
            raw = base64.b64decode(base64_data)
            upload_dir = os.path.join(DATA_DIR, "study_uploads")
            os.makedirs(upload_dir, exist_ok=True)
            safe_name = os.path.basename(filename).replace(" ", "_")
            target_path = os.path.join(upload_dir, safe_name)
            with open(target_path, "wb") as f:
                f.write(raw)
            if academic.is_media(target_path):          # a dropped video: written down in the background
                return self.study_add_paths([target_path], kind, subject)
            added.append(academic.add_file(target_path, kind, subject))
        except Exception as e:
            errors.append(f"{filename}: {e}")
        return {"added": added, "errors": errors, **self.study_files()}

    def study_remove_file(self, file_id):
        academic.remove_file(file_id)
        return self.study_files()

    def study_update_file(self, file_id, kind=None, subject=None):
        academic.update_file(file_id, kind, subject)
        return self.study_files()

    def study_open_file(self, file_id):
        path = academic.file_path(file_id)
        if path and os.path.exists(path):
            open_path(path)
        return bool(path)

    def study_generate(self, file_ids, review_type, count=10, difficulty="medium", focus="", time_limit=0):
        try:
            return {"review": academic.generate_review(file_ids, review_type, count, difficulty, focus, time_limit)}
        except Exception as e:
            return {"error": str(e)}

    def study_progress(self):
        return {"due": academic.due_reviews(), "topics": academic.topic_stats()[:30], "weak": academic.weak_topics()}

    def study_weak_review(self, review_type="mcq", count=10):
        try:
            return {"review": academic.weak_topics_review(review_type, count)}
        except Exception as e:
            return {"error": str(e)}

    # ---------- language teacher ----------
    def sensei_settings(self):
        import sensei
        return sensei.settings() | {"streak": sensei.current_streak()}

    def sensei_set(self, language=None, level=None):
        import sensei
        return sensei.set_language(language, level)

    def sensei_lesson(self, topic, language=None, level=None):
        import sensei
        try:
            return sensei.lesson(language, topic, level)
        except Exception as e:
            return {"error": str(e)}

    def sensei_mistakes_lesson(self, language=None):
        import sensei
        try:
            return sensei.mistakes_lesson(language)
        except Exception as e:
            return {"error": str(e)}

    def sensei_quiz(self, topic, kind="flashcards", count=12, language=None, level=None):
        import sensei
        try:
            return {"review": sensei.make_quiz(language, topic, kind, count, level)}
        except Exception as e:
            return {"error": str(e)}

    def sensei_talk_start(self, topic, language=None, level=None):
        import mind, sensei
        try:
            return mind.practice_start("sensei", topic, level or sensei._state().get("level", 2), language)
        except Exception as e:
            return {"error": str(e)}

    def sensei_talks(self):
        import mind
        return mind.practice_list("sensei")

    def sensei_pronounce(self, expected, language=None, seconds=5):
        import sensei
        try:
            self.emit({"type": "toast", "text": f"🎙 Say it now… ({int(seconds)} s)"})
            res = sensei.pronunciation(expected, language, seconds)
            self._xp("pronounce", xp=int(2 + res.get("score", 0) / 15), why="Pronunciation practice")
            return res
        except Exception as e:
            return {"error": f"Couldn't use the microphone: {e}"}

    def sensei_say(self, text, language=None):
        """Read a phrase aloud in the language you're learning (only the parts in that language - no romaji or
        English translation). Uses an offline voice, downloads one the first time, or an online voice for
        Japanese / Korean / Filipino / Chinese / Thai."""
        import sensei
        language = language or sensei._state()["language"]
        say = sensei.speakable(text, language)
        if not say:
            return {"error": f"There's no {sensei.LANGS.get(language, language)} text there to read."}
        voice, error = self._language_voice(language)
        if error:
            return {"error": error}
        threading.Thread(target=self._say_in_language, args=(say, voice, language), daemon=True).start()
        return {"ok": True, "said": say}

    def _language_voice(self, language):
        """(voice, error) to speak `language`: an installed offline voice, else an online one; voice None = download
        an offline one first (_say_in_language does that)."""
        import sensei
        lang = {"tl": "fil"}.get(language, language)
        have = [k for k in tts.installed_voices() if k.split("_")[0] == language]
        voice = f"piper:{have[0]}" if have else None
        options = sorted((k for k in tts.catalog() if k.split("_")[0] == language), key=lambda k: (not k.endswith("-medium"), k))
        online = next((v for v, *_ in tts.ONLINE_VOICES if v.split("-")[0] == lang), None)
        if not voice and online and tts.edge_available():
            voice = online
        if not voice and not options:
            if online:
                return None, "This language needs the online voice: run  python -m pip install edge-tts  and restart Vermeil."
            return None, f"There's no voice for {sensei.LANGS.get(language, language)} yet."
        return voice, None

    def _say_in_language(self, say, voice, language):
        """speak `say` in `language` (a little slower, easier to follow); downloads a voice the first time"""
        import sensei
        v = voice
        if not v:
            options = sorted((k for k in tts.catalog() if k.split("_")[0] == language), key=lambda k: (not k.endswith("-medium"), k))
            if not options:
                return
            self.emit({"type": "toast", "text": f"Downloading a {sensei.LANGS.get(language, language)} voice (first time only)…"})
            tts.download_voice(options[0], lambda *_: None)
            v = f"piper:{options[0]}"
        old = pm.VOICE_STYLE
        pm.VOICE_STYLE = "normal"
        try:
            pm.speak(say, v, "-35%" if sensei.speed() == "slow" else "-10%")   # Study -> Language: 🐢 slow
        finally:
            pm.VOICE_STYLE = old

    # ---------- language practice partner: a spoken conversation in the language you learn (brain/partner.py) ----------
    def _partner_obj(self):
        if not getattr(self, "_partner", None):
            import partner
            self._partner = partner.Partner(self.emit, lambda: pm.listen_for_input(timeout=8, phrase_time_limit=25),
                                            pm.speak, self._partner_speak)
        return self._partner

    def _partner_speak(self, text, language):
        import sensei
        say = sensei.speakable(text, language) or text
        voice, error = self._language_voice(language)
        if error:
            pm.speak(say)
            return
        self._say_in_language(say, voice, language)

    def partner_start(self, language=None, level=None, topic="", by_voice=True, scene=""):
        import sensei
        topic = sensei.scene_topic(scene) or topic                # Study -> Language: role-play scenes
        if scene in sensei.SCENES:
            self._xp("roleplay", why=sensei.SCENES[scene][0])
        if by_voice:
            pm.conversation_active = False                  # the partner takes the microphone from the normal chat
        try:
            return self._partner_obj().start(language, level, topic, by_voice)
        except Exception as e:
            return {"error": str(e)}

    def partner_reply(self, text, speak=True):
        try:
            return self._partner_obj().respond(text, speak=speak)
        except Exception as e:
            return {"error": str(e)}

    def partner_stop(self):
        return self._partner_obj().stop()

    def partner_status(self):
        return self._partner_obj().status()

    # ---------- phone app: Vermeil on your phone, at home and on mobile data (brain/phone.py, ui/phone/) ----------
    def phone_set(self, on=True, method=None):
        """Turn phone access on/off. Returns at once; the tunnel's address arrives a few seconds later as a
        {"type": "phone"} event (and in phone_status())."""
        import phone
        on = bool(on)
        if method in ("quick", "tailscale", "local"):
            st = phone.state()
            st["method"] = method
            phone.save(st)
        self._settings["phone_access"] = on
        self._save_settings()
        self._phone_stop()
        if not on:
            self.emit({"type": "phone", **self.phone_status()})
            return self.phone_status()
        try:
            self._phone_server = phone.PhoneServer(self._phone_handlers())
            port = self._phone_server.start()
        except OSError as e:
            self._phone_server = None
            self._phone_error = f"Couldn't start the phone server (is port {phone.PORT} in use?): {e}"
            return self.phone_status()
        self._phone_error = None
        self._phone_progress = "Starting…"
        self._phone_tunnel = phone.Tunnel(phone.state().get("method", "quick"), port)

        def connect(tunnel=self._phone_tunnel):
            def progress(text):
                self._phone_progress = text
                self.emit({"type": "phone", **self.phone_status()})
            tunnel.start(progress=progress)
            if tunnel is self._phone_tunnel:
                self._phone_error, self._phone_progress = tunnel.error, None
                self.emit({"type": "phone", **self.phone_status()})
        threading.Thread(target=connect, daemon=True).start()
        return self.phone_status()

    def _phone_stop(self):
        for attr in ("_phone_tunnel", "_phone_server"):
            obj = getattr(self, attr, None)
            setattr(self, attr, None)
            if obj:
                try:
                    obj.stop()
                except Exception as e:
                    print(f"[phone] {e}")

    def phone_status(self):
        import phone
        st = phone.state()
        server, tunnel = getattr(self, "_phone_server", None), getattr(self, "_phone_tunnel", None)
        url = tunnel.url if tunnel else None
        return {"on": bool(self._settings.get("phone_access")), "running": bool(server and server.running),
                "method": st.get("method", "quick"), "url": url, "pair": f"{url}/#key={st['key']}" if url else None,
                "progress": getattr(self, "_phone_progress", None) if server else None,
                "error": getattr(self, "_phone_error", None), "has_cloudflared": bool(phone.cloudflared_path()),
                "has_tailscale": bool(phone.tailscale_path())}

    def phone_new_key(self):
        """every connected phone has to scan the QR code again"""
        import phone
        phone.new_key()
        return self.phone_status()

    def _phone_handlers(self):
        return {"hello": self._phone_hello, "chat": self._phone_chat, "shortcut": self._phone_shortcut,
                "speak": self._phone_speak, "speak_lang": self._phone_speak_lang, "switch": self._phone_switch,
                "hear": self._phone_hear, "partner_start": self._phone_partner_start,
                "partner_reply": self._phone_partner_reply, "partner_stop": lambda p: self.partner_stop(),
                "cards": self._phone_cards, "card_answers": self._phone_card_answers, "notices": self._phone_notices,
                "upload": self._phone_upload}

    # ---------- phone: offline flashcards, notifications, send a file to the Study library ----------
    def _phone_note(self, title, body):
        """a reminder the phone shows as a notification the next time it checks (every minute while it's open)"""
        notes = getattr(self, "_phone_notes", [])
        nid = (notes[-1]["id"] + 1) if notes else 1
        self._phone_notes = (notes + [{"id": nid, "title": title, "body": str(body)[:300], "at": time.time()}])[-30:]

    def _phone_notices(self, p):
        after = int((p or {}).get("after") or 0)
        cutoff = time.time() - 6 * 3600
        return {"notes": [n for n in getattr(self, "_phone_notes", []) if n["id"] > after and n["at"] > cutoff]}

    def _phone_cards(self, p):
        """the flashcards due today, so the phone can keep them and play them with no connection"""
        import studygame
        return studygame.deck(int((p or {}).get("limit") or 60))

    def _phone_card_answers(self, p):
        """answers given on the phone (maybe offline earlier): [{id, knew}] -> saved, XP given"""
        import studygame
        n = right = 0
        for a in ((p or {}).get("answers") or [])[:200]:
            if isinstance(a, dict) and a.get("id"):
                studygame.answer(str(a["id"]), bool(a.get("knew")))
                n += 1
                right += bool(a.get("knew"))
        if right:
            self._xp("card_right", right, why="Phone flashcards")
        if n - right:
            self._xp("card_wrong", n - right)
        return {"saved": n}

    def _phone_upload(self, p):
        """a file sent from the phone -> the Study library (lecture), like dropping it in the window"""
        import academic
        data, name = p.get("data") or b"", os.path.basename(str(p.get("name") or "")).strip()[:120]
        if not data or not name or not re.search(r"\.(pdf|pptx|docx|txt|md|png|jpe?g|mp4|m4a|mp3|wav)$", name, re.I):
            return {"error": "Send a PDF, PowerPoint, Word, text, photo, video or audio file."}
        folder = data_file("phone_uploads")
        os.makedirs(folder, exist_ok=True)
        dest = os.path.join(folder, f"{time.strftime('%Y%m%d-%H%M%S')}-{re.sub(r'[^\w. -]', '_', name)}")
        with open(dest, "wb") as f:
            f.write(data)
        def add():                                          # videos get transcribed, which can take minutes
            try:
                academic.add_file(dest, "lecture", "")
                self.emit({"type": "toast", "text": f"📱 Your phone sent {name} to the Study library."})
            except Exception as e:  # noqa: BLE001 - shown to the user
                self.emit({"type": "toast", "text": f"Couldn't add {name} from your phone: {e}"})
        threading.Thread(target=add, daemon=True).start()
        return {"message": f"Sent! {name} is going into your Study library."}

    def _phone_hello(self, p=None):
        import sensei
        c = self._active()
        return {"name": c["name"], "active": c["id"], "app": "Vermeil",
                "characters": [{"id": x["id"], "name": x["name"]} for x in self._characters["characters"]],
                "languages": sensei.LANGS, "language": sensei._state().get("language", "ja"),
                "level": sensei._state().get("level", 2), "partner": self.partner_status(),
                "performance": getattr(self, "_perf_mode", "normal")}

    def _phone_chat(self, p):
        text = str(p.get("text") or "").strip()[:2000]
        if not text:
            return {"error": "Say something first."}
        with self._busy:
            pm._ctx.source = "phone"
            try:
                reply = pm.handle_input(text, self._memory, self._command_map)
            finally:
                pm._ctx.source = None
        reply = reply or "Done."
        self.emit({"type": "phone_chat", "you": text, "reply": reply})
        return {"reply": reply, "name": self._active()["name"]}

    def _phone_shortcut(self, p):
        """"Hey Siri, Vermeil" (an iPhone Shortcut) / an Android shortcut: text in, her reply as plain text out"""
        out = self._phone_chat(p)
        return out.get("reply") or out.get("error") or "Done."

    @staticmethod
    def _phone_clean(text):
        text = re.sub(r"```.*?```", " ", str(text or ""), flags=re.S)
        text = re.sub(r"[*_`#>|]+|\[([^\]]*)\]\([^)]*\)", lambda m: m.group(1) or " ", text)
        return re.sub(r"\s+", " ", text).strip()[:800]

    def _phone_speak(self, p):
        """her reply as a .wav in the character's own voice (it plays on the phone, not on the PC)"""
        import phone
        text = self._phone_clean(p.get("text"))
        if not text or not pm.tts_ready:
            return {"error": "The voice isn't ready yet."}
        samples, sr = pm.synth_voice(text, pm.active_voice(), pm.VOICE_RATE, pm.VOICE_PITCH, pm.VOICE, pm.VOICE_RVC)
        return phone.wav_bytes(samples, sr), "audio/wav"

    def _phone_speak_lang(self, p):
        """a line in the language you're learning, in a voice for that language"""
        import phone, sensei
        language = p.get("language") or sensei._state().get("language", "ja")
        say = sensei.speakable(self._phone_clean(p.get("text")), language)
        if not say:
            return {"error": "Nothing to read in that language."}
        voice, error = self._language_voice(language)
        if error:
            return {"error": error}
        if not voice:
            options = sorted((k for k in tts.catalog() if k.split("_")[0] == language), key=lambda k: (not k.endswith("-medium"), k))
            tts.download_voice(options[0], lambda *_: None)
            voice = f"piper:{options[0]}"
        samples, sr = tts.synth(say, voice, "-10%", "+0Hz", pm.VOICE)
        return phone.wav_bytes(samples, sr), "audio/wav"

    def _phone_switch(self, p):
        self.set_active(str(p.get("id") or ""))
        self.emit({"type": "characters_changed"})
        return self._phone_hello()

    def _phone_hear(self, p):
        """a recording from the phone's mic (webm / mp4 / wav) -> text, with Whisper on this PC"""
        import stt
        from faster_whisper import decode_audio
        audio = decode_audio(io.BytesIO(p["audio"]), sampling_rate=16000)
        return {"text": (stt.transcribe(audio) or "").strip()}

    def _phone_partner_start(self, p):
        return self.partner_start(p.get("language"), p.get("level"), p.get("topic") or "", by_voice=False)

    def _phone_partner_reply(self, p):
        return self.partner_reply(p.get("text"), speak=False)

    # ---------- focus sessions & progress ----------
    def focus_start(self, task, work=25, brk=5, rounds=4):
        import focus
        self._focus_quiet = self._settings["quiet_mode"]
        self._settings["quiet_mode"] = True                 # no chatter while you focus
        cur = focus.start(task, work, brk, rounds)
        threading.Thread(target=self._focus_watch, daemon=True).start()
        if self._settings.get("focus_block"):
            threading.Thread(target=self._focus_block_loop, daemon=True).start()
        return cur

    # windows that are part of Windows itself (taskbar, desktop, Start menu, tray) are never minimized
    _FOCUS_SHELL = {"Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW", "Windows.UI.Core.CoreWindow",
                    "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland", "XamlExplorerHostIslandWindow",
                    "ForegroundStaging", "MultitaskingViewFrame", "TaskSwitcherWnd"}

    def _focus_other_window(self, hwnd, allow):
        """the title of a window that isn't Vermeil (or an app you allowed), or None if it may stay"""
        import ctypes
        u = ctypes.windll.user32
        if not hwnd or not u.IsWindowVisible(hwnd) or u.IsIconic(hwnd):
            return None
        pid = ctypes.c_ulong()
        u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value == os.getpid():
            return None
        cls = ctypes.create_unicode_buffer(256)
        u.GetClassNameW(hwnd, cls, 256)
        if cls.value in self._FOCUS_SHELL:
            return None
        n = u.GetWindowTextLengthW(hwnd)
        if not n:
            return None
        buf = ctypes.create_unicode_buffer(n + 1)
        u.GetWindowTextW(hwnd, buf, n + 1)
        title = buf.value.strip()
        low = title.lower()
        if not title or "vermeil" in low or any(w in low for w in allow):
            return None
        return title

    def _focus_block_loop(self):
        """Settings -> Focus: while a focus session runs the PC is locked to Vermeil - every other window
        (browser, games, chat...) is minimized, and anything you open gets minimized again. Apps you allow may stay."""
        import focus
        if sys.platform != "win32":
            return
        import ctypes
        u = ctypes.windll.user32
        allow = [w.strip() for w in self._settings.get("focus_allow_words", "").split(",") if w.strip()]
        try:                                                      # 1. hide everything else right away
            found = []
            each = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)(
                lambda h, _: (found.append(h) if self._focus_other_window(h, allow) else None) or True)
            u.EnumWindows(each, 0)
            for h in found:
                u.ShowWindow(h, 6)                                # SW_MINIMIZE
            if found:
                self.emit({"type": "toast", "text": f"🔒 Locked to Vermeil: {len(found)} other window{'s' if len(found) > 1 else ''} minimized until your focus session ends."})
        except Exception as e:  # noqa: BLE001
            print(f"[focus block] {e}")
        last = ""
        while (cur := focus.current()):                           # 2. anything that comes to the front goes away again
            try:
                from datetime import datetime
                mins = (datetime.now() - datetime.fromisoformat(cur["started"])).total_seconds() / 60
                if mins % max(1, cur["work"] + cur["break"]) >= cur["work"]:    # on a break: everything is free
                    time.sleep(5)
                    continue
                h = u.GetForegroundWindow()
                title = self._focus_other_window(h, allow)
                if title:
                    u.ShowWindow(h, 6)
                    if title != last:
                        focus.add_distraction(f"opened {title[:60]} (blocked)", auto=True)
                        self.emit({"type": "toast", "text": f"🔒 Only Vermeil until your focus session ends ({title[:40]} was minimized)."})
                    last = title
            except Exception as e:  # noqa: BLE001
                print(f"[focus block] {e}")
            time.sleep(1)

    def _focus_from_voice(self, task, work=25, brk=5, rounds=4):
        self.focus_start(task, work, brk, rounds)
        self.emit({"type": "focus_started", "task": task, "work": int(work), "brk": int(brk), "rounds": int(rounds)})
        return f"Focus session started: {task}, {work} min work / {brk} min break, {rounds} rounds. I'll stay quiet."

    def _focus_watch(self):
        """With 'Notice what I'm doing' on: log time spent in games/videos/chat as distractions."""
        import focus, mind
        last = ""
        while focus.current():
            if self._presence.running and self._presence.attention is False:
                away = getattr(self, "_away_checks", 0) + 1
                self._away_checks = away
                if away == 4:                                     # about a minute looking away
                    n = focus.add_distraction("looked away from the screen", auto=True)
                    self.emit({"type": "focus_distracted", "what": "you looking away", "count": n})
            else:
                self._away_checks = 0
            import objects
            seen = {o["label"] for o in self._presence.objects} & objects.DISTRACTING if self._presence.running else set()
            if seen:
                phone = getattr(self, "_phone_checks", 0) + 1
                self._phone_checks = phone
                if phone == 2:                                    # phone in view for ~30 s
                    what = sorted(seen)[0]
                    n = focus.add_distraction(f"{what} in hand", auto=True)
                    self.emit({"type": "focus_distracted", "what": f"your {what}", "count": n})
            else:
                self._phone_checks = 0
            if self._settings["context_aware"]:
                act = mind.current_activity()
                if act in focus.DISTRACTING and act != last:
                    n = focus.add_distraction(f"switched to {act}", auto=True)
                    self.emit({"type": "focus_distracted", "what": act, "count": n})
                last = act
            time.sleep(15)

    def focus_state(self):
        import focus
        return {"current": focus.current(), "week": focus.stats(7)}

    def focus_distraction(self, what):
        import focus
        return focus.add_distraction(what)

    def focus_round(self):
        """a work block finished: XP, and she cheers you on for the break (quiet mode only covers the work time)"""
        import focus
        cur = focus.round_done()
        self._xp("focus_block", why="Focus block done")
        if cur and self._settings["speak_replies"]:
            line = pm.quick_line(f"The user just finished a {cur.get('work', 25)}-minute focus block on "
                                 f"'{cur.get('task', 'studying')}' ({cur.get('done_rounds', 1)} of {cur.get('rounds', 4)}). "
                                 "Cheer them on in one short, warm sentence and tell them to rest, stretch or drink water "
                                 "for the break.") or "Nice work! Take a short break, stretch and drink some water."
            self.emit({"type": "reply", "text": line})
            threading.Thread(target=pm.speak, args=(line,), daemon=True).start()
        return cur

    def focus_finish(self, minutes=None):
        import focus
        self._settings["quiet_mode"] = getattr(self, "_focus_quiet", self._settings["quiet_mode"])
        return focus.finish(minutes)

    def progress(self, days=30):
        import focus
        return focus.progress(days)

    def study_review(self, review_id):
        return academic.get_review(review_id)

    def study_delete_review(self, review_id):
        academic.delete_review(review_id)
        return self.study_files()

    def study_check_blank(self, given, item):
        return academic.check_blank(given, item)

    def study_save_score(self, review_id, score, total, results=None):
        res = academic.save_score(review_id, score, total, results)
        try:
            pct = int(score) / max(1, int(total))
            self._xp("review", xp=int(10 + 20 * pct), why=f"Review finished: {score}/{total}")
        except (TypeError, ValueError):
            pass
        return res

    def study_research(self, question, fact_check=False):
        try:
            return academic.research(question, fact_check)
        except Exception as e:
            return {"error": str(e)}

    def compare_sources(self, text, as_claim=False):
        import web
        try:
            return web.compare_sources(text, claim=text if as_claim else None)
        except Exception as e:
            return {"error": str(e)}

    def study_assignment(self, question, mode="explain", my_answer="", file_ids=None):
        try:
            return academic.assignment_help(question, mode, my_answer, file_ids)
        except Exception as e:
            return {"error": str(e)}

    def study_paraphrase(self, text, style="standard", length="same"):
        try:
            return academic.paraphrase(text, style, length)
        except Exception as e:
            return {"error": str(e)}

    def study_grammar_check(self, text, tone="academic"):
        try:
            return academic.correct_grammar(text, tone)
        except Exception as e:
            return {"error": str(e)}

    def study_ai_detect(self, text):
        try:
            return academic.detect_ai(text)
        except Exception as e:
            return {"error": str(e)}

    def study_humanize(self, text, tone="academic"):
        try:
            return academic.humanize(text, tone)
        except Exception as e:
            return {"error": str(e)}

    def open_url(self, url):
        import webbrowser
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            webbrowser.open(url)
        return True

    # ---------- coding agent ----------
    def code_state(self):
        return {"workspace": self._coder.workspace,
                "history": [m for m in self._coder.history if m["role"] in ("user", "assistant")][-40:]}

    def code_choose_folder(self):
        import coder
        start = self._coder.workspace or (coder.PROJECTS_DIR if os.path.isdir(coder.PROJECTS_DIR) else os.path.expanduser("~"))
        folders = None
        try:
            res = []
            def _pick():
                try:
                    res.append(self._window.create_file_dialog(_FOLDER_DIALOG, directory=start))
                except Exception:
                    pass
            t = threading.Thread(target=_pick)
            t.daemon = True
            t.start()
            t.join()
            if res:
                folders = res[0]
        except Exception:
            pass
        if not folders:
            return self.code_state()
        folder = folders[0] if isinstance(folders, (list, tuple)) else folders
        return self.code_set_folder(folder)

    def code_set_folder(self, folder):
        """use a folder typed / pasted by the user (no dialog needed)"""
        folder = os.path.expandvars(os.path.expanduser(str(folder or "").strip().strip('"')))
        if not os.path.isdir(folder):
            return dict(self.code_state(), error="That folder doesn't exist.")
        self._coder.set_workspace(folder)
        self._ui["code_workspace"] = self._coder.workspace
        self._save_settings()
        return self.code_state()

    def code_ask(self, message):
        try:
            return {"reply": self._coder.ask(message)}
        except Exception as e:
            return {"error": str(e)}

    def code_open_editor(self):
        return self._coder.open_in_editor()

    def code_new_project(self, name):
        try:
            self._coder.new_project(name or "New project")
        except Exception as e:
            return {**self.code_state(), "error": str(e)}
        return self.code_state()

    def build_code(self, request):
        """From the normal chat: 'make me a Python calculator' - the coding helper builds it in the background."""
        if getattr(self, "_building", False):
            return "I'm still building the last thing - check the Code panel."
        self._building = True
        self.emit({"type": "open_panel", "panel": "code"})
        self.emit({"type": "code_user", "text": request})

        def go():
            try:
                reply = self._coder.ask(request if self._coder.is_own_project() or not self._coder.workspace
                                        else f"Build this as a NEW project (call new_project first): {request}")
                self.emit({"type": "code_reply", "text": reply})
                self.emit({"type": "toast", "text": "✅ The code is ready — see the Code panel."})
            except Exception as e:
                self.emit({"type": "code_reply", "text": f"Something went wrong: {e}"})
            finally:
                self._building = False
                self._ui["code_workspace"] = self._coder.workspace
                self._save_settings()
        threading.Thread(target=go, daemon=True).start()
        return "On it! I'm building that in the Code panel — you can watch each step there."

    def code_clear(self):
        self._coder.history = []
        return self.code_state()

    def _approve_code(self, kind, details):
        """The coding helper wants to change a file or run a command: ask in the window and wait."""
        approval_id = uuid.uuid4().hex[:8]
        q = queue.Queue()
        self._approvals[approval_id] = q
        self.emit({"type": "code_approve", "id": approval_id, "kind": kind, **details})
        try:
            return bool(q.get(timeout=600))
        except queue.Empty:
            return False
        finally:
            self._approvals.pop(approval_id, None)

    def code_decide(self, approval_id, yes):
        q = self._approvals.get(approval_id)
        if q:
            q.put(bool(yes))
        return bool(q)

    # ---------- remembered app preferences ----------
    def _history(self, limit=40):
        """Recent messages with the active character, so the chat panel isn't empty after a restart."""
        key = pm.persona.get("memory_key", "user")
        msgs = self._memory.get(key, {}).get("conversations", [])
        start = max(0, len(msgs) - limit)
        return [{"who": "you" if m["role"] == "user" else "her", "text": m["content"], "i": start + n}
                for n, m in enumerate(msgs[start:]) if isinstance(m.get("content"), str)]

    def save_ui(self, prefs):
        """Window preferences (hidden menu, camera angle...). Saved in app_settings.json."""
        if isinstance(prefs, dict):
            for k, v in prefs.items():
                if k in ("collapsed", "view", "open_panel", "study_tab", "kitchen_tab", "sfx", "sfx_volume", "bgm", "bgm_volume", "bgm_theme", "sfx_style", "sfx_pitch", "fx", "outfit", "alarm_volume", "den_v1", "hidden_panels", "theme") \
                        and len(json.dumps(v)) < 2000 or (k in ("room_before_den", "gym_layout") and len(json.dumps(v)) < 60000):
                    self._ui[k] = v
            self._save_settings()
        return self._ui

    def get_preferences(self):
        """What the active character has learned about you, e.g. {'name': 'JP', 'likes: matcha': 'love'}."""
        key = pm.persona.get("memory_key", "user")
        return dict(self._memory.get(key, {}).get("preferences", {}))

    def forget_preference(self, pref_key=None):
        """Forget one thing (or everything when pref_key is None)."""
        key = pm.persona.get("memory_key", "user")
        prefs = self._memory.setdefault(key, {"conversations": [], "preferences": {}}).setdefault("preferences", {})
        if pref_key is None:
            prefs.clear()
        else:
            prefs.pop(pref_key, None)
        pm.save_memory(self._memory)
        return dict(prefs)

    def _save_settings(self):
        _write_json(SETTINGS_FILE, {**self._settings, "ui": self._ui})

    def boot(self):
        """Called by the window once it has loaded."""
        threading.Thread(target=self._start_tts, daemon=True).start()
        threading.Thread(target=self._start_ai, daemon=True).start()
        import autosetup
        autosetup.start(self.emit)                          # UniMate's code and checkpoint download themselves the first time
        if self._settings["hotkeys"]:
            self._register_hotkeys()
        threading.Thread(target=self._alert_loop, daemon=True).start()
        threading.Thread(target=self._battery_loop, daemon=True).start()
        if self._settings["phone_access"]:
            threading.Thread(target=self.phone_set, args=(True,), daemon=True).start()
        if self._settings["camera_on_start"]:
            self.set_camera(True, remember=False)
        if self._settings["listen_on_start"]:
            self.set_listening(True, remember=False)
        return True

    def _start_tts(self):
        self.emit({"type": "tts", "status": "starting"})
        ok = pm.start_tts()
        self.emit({"type": "tts", "status": "ready" if ok else "off"})

    def _start_ai(self):
        """Groq is the main AI; Ollama (local) is the backup. Start Ollama and warm it up so a switch is quick."""
        import llm
        llm.on_switch = lambda text: self.emit({"type": "ai_switch", "text": text, **llm.which()})
        mode = llm.provider()
        if mode != "local" and not llm.groq_key():
            self.emit({"type": "toast", "text": "No GROQ_API_KEY in .env - using the local AI only."})
        if mode == "groq":
            return
        llm.start_ollama()
        st = {"running": False}
        for _ in range(20):
            st = llm.status()
            if st["running"]:
                break
            time.sleep(1)
        uses_local_now = mode == "local" or not llm.groq_available()
        if not st["running"]:
            if uses_local_now:
                self.emit({"type": "error", "text": "The local AI (Ollama) isn't set up. Run scripts\\setup_ollama.bat once "
                                                    "(it puts Ollama in the tools\\ollama folder), then python scripts/setup_local.py"})
            else:
                print("[AI] Backup AI (Ollama) isn't running - if Groq runs out, replies will fail.")
            return
        if st["missing"]:
            if uses_local_now:
                self.emit({"type": "error", "text": f"AI models not downloaded yet: {', '.join(st['missing'])}. "
                                                    f"Run: python scripts/setup_local.py"})
            return
        if uses_local_now:                       # only load the local model into memory if we're using it now
            try:
                llm._ollama_create(model="chat", messages=[{"role": "user", "content": "hi"}], max_tokens=1)
            except Exception as e:
                print(f"[AI warm-up] {e}")

    def ai_status(self):
        import llm
        st = llm.status()
        return {**st, "whisper": __import__("stt")._settings()[0], "voices": tts.installed_voices(),
                "provider": llm.provider(), "has_groq_key": bool(llm.groq_key()), "groq_models": llm.groq_models(),
                **{f"now_{k}": v for k, v in llm.which().items()}}

    def set_ai_provider(self, mode):
        import llm
        if not llm.set_provider(mode):
            return {"error": "Unknown mode."}
        return self.ai_status()

    # ---------- chat ----------
    def chat(self, text):
        """Typed message from the window. Returns her reply (or None if it answered a question)."""
        text = (text or "").strip()
        if not text:
            return None
        if self._waiting_for_answer:                # the user is answering a follow-up question
            self._answers.put(text)
            return None
        speaker = None
        if self._settings["speak_replies"] and pm.tts_ready and pm.stream_speech:
            speaker = pm.SpeechStream(on_text=lambda t: self.emit({"type": "partial", "text": t}))
        with self._busy:
            pm._ctx.source = "text"
            try:
                reply = pm.handle_input(text, self._memory, self._command_map, speaker=speaker)
            finally:
                pm._ctx.source = None
        if speaker:
            threading.Thread(target=speaker.finish, args=(reply,), daemon=True).start()
        elif self._settings["speak_replies"]:
            threading.Thread(target=pm.speak, args=(reply,), daemon=True).start()
        return reply

    def _ask_in_window(self, prompt):
        """A command needs more info (e.g. 'Which city?'): show the question and wait for the next message."""
        while not self._answers.empty():
            self._answers.get_nowait()
        self._waiting_for_answer = True
        self.emit({"type": "ask", "text": prompt})
        try:
            return self._answers.get(timeout=120)
        except queue.Empty:
            return None
        finally:
            self._waiting_for_answer = False

    # ---------- voice ----------
    def set_listening(self, on, remember=True):
        if remember and self._settings["listen_on_start"] != bool(on):
            self._settings["listen_on_start"] = bool(on)
            self._save_settings()
        self._listening = bool(on)
        pm.voice_mode = self._listening
        if not self._listening:
            pm.conversation_active = False
        if self._listening and not (self._voice_thread and self._voice_thread.is_alive()):
            self._voice_thread = threading.Thread(target=self._voice_loop, daemon=True)
            self._voice_thread.start()
        self.emit({"type": "listening", "state": "waiting" if self._listening else "off"})
        return self._listening

    def _voice_loop(self):
        while self._listening:
            try:
                if getattr(self, "_partner", None) and self._partner.active and self._partner.by_voice:
                    time.sleep(0.5)                         # the practice partner has the microphone right now
                    continue
                if pm.listen_for_wake_word():
                    pm.listen_for_command(self._memory, self._command_map)
            except Exception as e:
                print(f"[voice] {e}")
                self.emit({"type": "error", "text": f"Microphone problem: {e}"})
                time.sleep(2)

    def _objects_seen(self):
        import objects
        if not (self._presence.running and self._presence.watch_objects and self._presence.objects):
            return ""
        if time.time() - self._presence._objects_at > 10:
            return ""
        return objects.summary(self._presence.objects)

    def objects_now(self):
        return {"on": self._presence.watch_objects and self._presence.running, "items": self._presence.objects}

    # ---------- Spotify (only used for importing playlists into Vermeil Music) ----------
    def _use_spotify(self):
        src = getattr(self, "_settings", {}).get("music_source", "auto")
        if src == "youtube":
            return False
        import spotify
        return src == "spotify" or spotify.status()["connected"]

    def _sp(self, fn, *args):
        import spotify
        try:
            return fn(*args)
        except spotify.SpotifyError as e:
            return {"error": str(e)}
        except Exception as e:
            return {"error": f"Spotify problem: {e}"}

    # ---------- Vermeil Music: your own Spotify-style app (YouTube songs, your playlists) ----------
    def mm(self, action, *args):
        """one door for the Music panel: mm('search', 'eminem'), mm('play_playlist', id), ..."""
        import mymusic
        import music
        fns = {"library": mymusic.library, "playlist": mymusic.get_playlist, "search": mymusic.search,
               "create": mymusic.create_playlist, "update": mymusic.update_playlist, "delete": mymusic.delete_playlist,
               "add": lambda pid, songs: {"added": mymusic.add_songs(pid, songs)}, "remove": mymusic.remove_song,
               "move": mymusic.move_song, "like": lambda s, on=True: {"liked": mymusic.like(s, on)},
               "like_current": lambda: {"message": mymusic.like_current()}, "now": mymusic.now, "recent": mymusic.recent,
               "play_songs": lambda songs, start=0, shuffle=False: {"message": mymusic.play_songs(songs, start, shuffle)},
               "play_playlist": lambda pid, start=0, shuffle=False: {"message": mymusic.play_playlist(pid, start, shuffle)},
               "queue_song": lambda s: {"message": f1.music_control("play", mymusic.play_query(s), "later")},
               "cmd": lambda a, v=None: {"message": music.seek(v) if a == "seek" else f1.music_control(a)},
               "clear_queue": mymusic.clear_queue,
               "remove_from_queue": mymusic.remove_from_queue,
               "play_queued_index": mymusic.play_queued_index,
               "import_youtube": mymusic.import_youtube, "import_text": mymusic.import_text,
               "spotify_playlists": mymusic.spotify_playlists, "import_spotify": mymusic.import_spotify,
               "analyse": mymusic.analyse, "analysis": lambda pid: mymusic.analysis(pid) or {},
               "make": mymusic.make_from, "to_lyrics": mymusic.convert_to_lyrics}
        if action not in fns:
            return {"error": "Unknown music action."}
        try:
            return fns[action](*args)
        except (KeyError, ValueError) as e:
            return {"error": str(e).strip("'")}
        except Exception as e:
            print(f"[music] {action}: {e}")
            return {"error": f"Music problem: {e}"}

    # Spotify panel -> Playlist Lab: import + analyse a playlist, make a new one from it
    def playlab_list(self):
        import playlist_lab
        return self._sp(lambda: {"items": playlist_lab.analyses()})

    def playlab_analyse(self, ref):
        import playlist_lab
        return self._sp(playlist_lab.analyse, ref)

    def playlab_get(self, pid):
        import playlist_lab
        return playlist_lab.get_analysis(pid) or {"error": "Not found - analyse it again."}

    def playlab_make(self, pid, size=25, style="similar", name="", extra="", public=False, keep_original=0):
        import playlist_lab
        return self._sp(playlist_lab.make_playlist, pid, size, style, name, extra, public, keep_original)

    def playlab_youtube(self, pid, size=20, style="similar"):
        import playlist_lab
        return self._sp(lambda: {"message": playlist_lab.queue_on_youtube(pid, size, style)})

    def spotify_status(self):
        import spotify
        return {**spotify.status(), "source": self._settings["music_source"], "using": self._use_spotify()}

    def spotify_save_keys(self, client_id, client_secret):
        import spotify
        try:
            path = spotify.save_credentials(client_id, client_secret)
        except ValueError as e:
            return {**self.spotify_status(), "error": str(e)}
        return {**self.spotify_status(), "saved_to": path}

    def spotify_connect(self):
        import spotify

        def done(result):
            self.emit({"type": "spotify_login", **({"ok": True} if result.get("ok") else {"error": result.get("error")}),
                       "status": self.spotify_status()})
        try:
            spotify.login(on_done=done)
        except spotify.SpotifyError as e:
            return {"error": str(e)}
        except OSError as e:
            return {"error": f"Couldn't listen on {spotify.redirect_uri()} ({e}). Close other apps using port 8888 and try again."}
        return {"started": True}

    def spotify_logout(self):
        import spotify
        spotify.logout()
        return self.spotify_status()

    def spotify_now(self):
        import spotify
        return self._sp(spotify.now_playing)

    def spotify_cmd(self, action, value=None):
        import spotify
        fns = {"pause": spotify.pause, "resume": spotify.resume, "next": spotify.next_track, "previous": spotify.previous_track,
               "seek": lambda: spotify.seek(value), "volume": lambda: spotify.set_volume(value),
               "shuffle": lambda: spotify.shuffle(bool(value)), "repeat": lambda: spotify.repeat(value or "context"),
               "like": lambda: spotify.like_current(value is not False), "transfer": lambda: spotify.transfer(value),
               "play_uri": lambda: spotify.play_uri(value), "queue_uri": lambda: spotify.add_to_queue(value),
               "play_liked": spotify.play_liked}
        fn = fns.get(action)
        if not fn:
            return {"error": "Unknown action."}
        r = self._sp(fn)
        return r if isinstance(r, dict) else {"message": r}

    def spotify_search(self, query):
        import spotify
        return self._sp(spotify.search, query)

    def spotify_library(self, what):
        import spotify
        fn = {"playlists": spotify.playlists, "liked": spotify.liked_songs, "recent": spotify.recent,
              "top": spotify.top_tracks, "devices": spotify.devices, "queue": spotify.queue}.get(what)
        if not fn:
            return {"error": "Unknown list."}
        r = self._sp(fn)
        return r if isinstance(r, dict) else {"items": r}

    def spotify_is_liked(self, uri):
        import spotify
        return self._sp(spotify.is_liked, uri)

    # ---------- Google Calendar (adding events) ----------
    def gcal_status(self):
        import gcal
        return gcal.status()

    def gcal_choose_file(self):
        import gcal
        paths = self._window.create_file_dialog(_OPEN_DIALOG, file_types=("Google OAuth file (*.json)",))
        if not paths:
            return gcal.status()
        try:
            gcal.save_credentials(paths[0])
        except Exception as e:
            return {**gcal.status(), "error": str(e)}
        return gcal.status()

    def gcal_connect(self):
        """Opens Google's permission page in your browser; finishes in the background."""
        import gcal

        def go():
            try:
                self.emit({"type": "toast", "text": gcal.connect()})
            except Exception as e:
                self.emit({"type": "error", "text": f"Google Calendar: {e}"})
            self.emit({"type": "gcal", **gcal.status()})
        threading.Thread(target=go, daemon=True).start()
        return {"started": True}

    def gcal_disconnect(self):
        import gcal
        gcal.disconnect()
        return gcal.status()

    # ---------- your own wake word ----------
    def wake_status(self):
        import wakeword
        d = wakeword._load()
        return {"trained": wakeword.trained(), "samples": len(getattr(self, "_wake_clips", [])),
                "when": d.get("trained"), "sensitivity": self._settings["wake_sensitivity"]}

    def _mic_paused(self, fn):
        """Run fn with the normal listening paused (so two things don't fight over the mic)."""
        was = self._listening
        if was:
            self.set_listening(False, remember=False)
            time.sleep(0.6)
        try:
            return fn()
        finally:
            if was:
                self.set_listening(True, remember=False)

    def wake_record(self):
        """Record one 2-second sample of the user saying the wake word."""
        import numpy as np
        import wakeword
        try:
            clip = self._mic_paused(lambda: wakeword.record(2.0, pm.MIC_INDEX))
        except Exception as e:
            return {"error": f"Microphone problem: {e}"}
        word = wakeword.trim(clip)
        level = float(np.sqrt(np.mean(clip ** 2))) if clip.size else 0.0
        if word.size < 0.2 * wakeword.SR:
            return {"error": "I didn't hear anything — say “vermi” a bit louder, right after you click.", "level": level}
        self.__dict__.setdefault("_wake_clips", []).append(clip)
        return {"ok": True, "samples": len(self._wake_clips), "seconds": round(word.size / wakeword.SR, 2)}

    def wake_train(self):
        import wakeword
        try:
            r = wakeword.train(getattr(self, "_wake_clips", []))
        except Exception as e:
            return {"error": str(e)}
        self._wake_clips = []
        return {"ok": True, **r, **self.wake_status()}

    def wake_test(self):
        """Say it once more: did it match?"""
        import wakeword
        try:
            clip = self._mic_paused(lambda: wakeword.record(2.0, pm.MIC_INDEX))
        except Exception as e:
            return {"error": f"Microphone problem: {e}"}
        d = wakeword._load()
        sc, th = wakeword.score(clip, d), wakeword.threshold(self._settings["wake_sensitivity"], d)
        return {"match": sc <= th, "score": round(sc, 3) if sc != float("inf") else None, "threshold": round(th, 3)}

    def wake_clear(self):
        import wakeword
        wakeword.clear()
        self._wake_clips = []
        return self.wake_status()

    # ---------- camera / presence ----------
    def set_camera(self, on, remember=True):
        if on and self._settings["privacy_mode"]:
            self.emit({"type": "toast", "text": "🔒 Camera privacy mode is on — turn it off in Settings to use the camera."})
            self.emit({"type": "camera", "status": "off"})
            return False
        if remember and self._settings["camera_on_start"] != bool(on):
            self._settings["camera_on_start"] = bool(on)      # remembered: same state next time you open the app
            self._save_settings()
        if on:
            self._presence.start()
        else:
            self._presence.stop()
        return bool(on)

    # ---------- which camera / microphone ----------
    def list_devices(self, fresh=False):
        """Working cameras and microphones on this PC, plus the ones chosen in Settings (-1 = automatic)."""
        import devices
        cams = [] if self._presence.running and not fresh else devices.list_cameras(fresh=bool(fresh))
        if self._presence.running:          # the camera in use can't be opened twice, so list it as working
            idx = devices.pick_camera(self._ui.get("camera_index", -1))
            if not any(c["index"] == idx for c in cams):
                cams = [{"index": idx, "name": f"Camera {idx + 1} (in use)", "ok": True}] + cams
        return {"cameras": cams, "mics": devices.list_mics(),
                "camera": self._ui.get("camera_index", -1), "mic": self._ui.get("mic_index", -1)}

    def set_devices(self, camera=None, mic=None):
        if camera is not None:
            self._ui["camera_index"] = int(camera)
            self._presence.camera_index = int(camera)
            if self._presence.running:          # reopen on the new camera
                self._presence.stop()
                self._presence.start()
        if mic is not None:
            self._ui["mic_index"] = int(mic)
            self._apply_mic()
        _write_json(SETTINGS_FILE, {**self._settings, "ui": self._ui})
        return self.list_devices()

    def _apply_mic(self):
        import devices
        pm.MIC_INDEX = devices.pick_mic(self._ui.get("mic_index", -1)) if "MIC_INDEX" not in os.environ else pm.MIC_INDEX
        pm._recognizer = None                   # recalibrate on the new mic next time

    def set_preview(self, on):
        self._presence.preview = bool(on)
        return self._presence.preview

    def enroll_face(self, name, owner=True, relation=""):
        if self._settings["privacy_mode"]:
            return False
        self._presence.start_enroll(name or "you", owner=bool(owner), relation=relation or "")
        return True

    def known_people(self):
        return self._presence.known_people()

    def forget_person(self, name):
        return self._presence.forget_person(name)

    def forget_face(self):
        self._presence.forget_owner()
        return True

    def _on_presence(self, event):
        self.emit(event)
        if event["type"] != "presence":
            return
        now = time.time()
        if event.get("present") and event.get("who") == "known" and event.get("name"):
            name = event["name"]
            seen = self.__dict__.setdefault("_greeted_people", {})
            if self._settings["greet_on_sight"] and not self._settings["quiet_mode"] and now - seen.get(name, 0) > 1800:
                seen[name] = now
                rel = next((p["relation"] for p in self._presence.known_people() if p["name"] == name), "")
                threading.Thread(target=self._greet_other, args=(name, rel), daemon=True).start()
        if event.get("present") and event.get("who") == "owner":
            first_time = not self._greeted_once
            back_after_break = self._owner_gone_since is not None and now - self._owner_gone_since > GREET_AFTER_AWAY
            if self._settings["greet_on_sight"] and not self._settings["quiet_mode"] and (first_time or back_after_break):
                self._greeted_once = True
                threading.Thread(target=self._greet, args=(event.get("name"),), daemon=True).start()
            self._owner_here, self._owner_gone_since = True, None
        elif self._owner_here:                       # you left (or someone else is in front of the camera)
            self._owner_here, self._owner_gone_since = False, now

    def _greet_other(self, name, relation=""):
        who = f"{name} (the user's {relation})" if relation else name
        line = pm.quick_line(f"{who} is in front of the camera. "
                             f"Say a short, friendly hello to {name} by name.") or f"Oh, hi {name}!"
        self.emit({"type": "reply", "text": line})
        self.emit({"type": "emote", "name": "wave"})
        pm.speak(line)

    def _greet(self, name):
        line = pm.quick_line(f"{name or 'The user'} just sat down in front of you. Greet them by name.") \
            or (f"There you are, {name}." if name else "There you are.")
        self.emit({"type": "reply", "text": line})
        pm.speak(line)

    # ---------- gestures (camera + vision AI) ----------
    GESTURES = ("thumbs_up", "thumbs_down", "peace", "wave", "stop", "ok", "heart", "none")

    def check_gesture(self):
        """Look at the camera once and name the hand gesture."""
        img = None if self._settings["privacy_mode"] else self._presence.snapshot()
        if not img:
            return {"error": "Turn the camera on first."}
        import llm
        try:
            r = llm.get_client().chat.completions.create(model="vision", response_format={"type": "json_object"}, messages=[
                {"role": "user", "content": [
                    {"type": "text", "text": "Is the person making a hand gesture? Answer JSON {\"gesture\": one of "
                                             + ", ".join(self.GESTURES) + "}. 'stop' = open palm facing the camera."},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}"}}]}])
            g = json.loads(r.choices[0].message.content or "{}").get("gesture", "none")
        except Exception as e:
            return {"error": str(e)}
        g = g if g in self.GESTURES else "none"
        self._react_to_gesture(g)
        return {"gesture": g}

    def _react_to_gesture(self, g):
        if g == "none":
            return
        if g == "stop":
            pm.stop_speaking()
            if f1.is_playing:
                f1.music_control("pause")
        if g in ("thumbs_up", "ok") and self._waiting_for_answer:
            self._answers.put("yes")                       # 👍 answers a yes/no question
        if g == "thumbs_down" and self._waiting_for_answer:
            self._answers.put("no")
        emote = {"wave": "wave", "peace": "celebrate", "heart": "celebrate", "thumbs_up": "nod", "thumbs_down": "shake"}.get(g)
        if emote:
            self.emit({"type": "emote", "name": emote})
        self.emit({"type": "gesture", "gesture": g})

    def _gesture_loop(self):
        last = None
        while True:
            if not self._settings["gesture_mode"]:
                self._gesture_thread = None
                return
            if self._presence.running and self._presence.state.get("present"):
                r = self.check_gesture()
                g = r.get("gesture")
                if g and g != "none" and g != last:
                    print(f"[gesture] {g}")
                last = g
            time.sleep(4)

    # ---------- living character ----------
    def _character_action(self, action):
        if action in ("happy", "sad", "surprised", "angry", "sleepy", "thinking"):
            self.emit({"type": "expression", "name": action, "seconds": 5})
        else:
            self.emote(action)
        return f"(The character does: {action}.)"

    def emote(self, name):
        self.emit({"type": "emote", "name": name})
        return True

    def group_chat(self, topic, char_ids=None, turns=6):
        """Two or more characters talk about a topic; each line is shown and spoken in that character's voice."""
        chars = [c for c in self._characters["characters"] if not char_ids or c["id"] in char_ids or c["name"].lower() in
                 [str(x).lower() for x in char_ids]]
        if len(chars) < 2:
            chars = self._characters["characters"][:2]
        if len(chars) < 2:
            return {"error": "You need at least two characters (add one in the Characters panel)."}
        threading.Thread(target=self._run_group_chat, args=(topic, chars, max(2, min(int(turns or 6), 16))), daemon=True).start()
        return {"message": f"{' and '.join(c['name'] for c in chars)} are talking about {topic}."}

    def _run_group_chat(self, topic, chars, turns):
        import llm
        lines = []
        for i in range(turns):
            c = chars[i % len(chars)]
            others = ", ".join(x["name"] for x in chars if x is not c)
            convo = "\n".join(f"{n}: {t}" for n, t in lines[-8:]) or "(nobody has spoken yet)"
            prompt = (f"{c['prompt']}\n\nYou are {c['name']}, chatting with {others} in front of the user about: {topic}. "
                      f"Conversation so far:\n{convo}\n\nWrite {c['name']}'s next line only - 1-2 short spoken sentences, "
                      f"react to what was just said, stay in character, no name prefix, no actions."
                      + (" Wrap up the conversation naturally." if i == turns - 1 else ""))
            try:
                text = pm.clean_text(llm.ask(prompt, model="chat"))
            except Exception as e:
                self.emit({"type": "error", "text": f"Group chat stopped: {e}"})
                return
            text = re.sub(rf"^{re.escape(c['name'])}\s*:\s*", "", text).strip()
            lines.append((c["name"], text))
            self.emit({"type": "group_line", "speaker": c["name"], "id": c["id"], "text": text})
            if self._settings["speak_replies"]:
                old = (pm.VOICE_VOLUME,)
                pm.VOICE_VOLUME = (c.get("volume") or 100) / 100
                pm.speak(text, tts.resolve_voice(c.get("voice") or tts.DEFAULT_VOICE),
                         c.get("rate") or "+0%", c.get("pitch") or "+0Hz")
                pm.VOICE_VOLUME = old[0]
            else:
                time.sleep(min(6, 1 + len(text) / 18))
        self.emit({"type": "group_done"})

    # ---------- characters ----------
    def _active(self):
        chars = self._characters["characters"]
        return next((c for c in chars if c["id"] == self._characters["active"]), chars[0])

    def _apply_character(self):
        c = self._active()
        pm.persona = {"name": c["name"], "prompt": c["prompt"], "memory_key": c.get("memory_key", c["id"]),
                      "language": c.get("language") or "auto", "translate": bool(c.get("translate"))}
        pm.VOICE = tts.resolve_voice(c.get("voice") or tts.DEFAULT_VOICE)
        if pm.VOICE.startswith("kokoro:"):                  # the offline voice must work offline
            pm.VOICE = tts.DEFAULT_VOICE
        online = c.get("voice_online") or ""
        pm.VOICE_ONLINE = online if online.startswith("kokoro:") else None    # None -> a default Kokoro voice (online)
        pm.VOICE_GENDER = c.get("gender") or "female"
        pm.VOICE_RATE = c.get("rate") or "+0%"
        pm.VOICE_PITCH = c.get("pitch") or "+0Hz"
        pm.VOICE_VOLUME = (c.get("volume") or 100) / 100
        pm.VOICE_EMOTION = c.get("emotion", 100) / 100
        pm.VOICE_NATURAL = c.get("natural", True) is not False
        pm.VOICE_CHATTER = bool(c.get("emotional"))
        if pm.VOICE_CHATTER:
            pm.warm_chatter()
        clone = c.get("rvc") or {}
        pm.VOICE_RVC = clone if clone.get("model") else None
        if pm.VOICE_RVC:
            import rvc
            rvc.warm(clone["model"])
        pm.warm_voice()                                     # the first reply isn't slow (loads everything once)

    def set_active(self, char_id):
        if any(c["id"] == char_id for c in self._characters["characters"]):
            self._characters["active"] = char_id
            _write_json(CHARACTERS_FILE, self._characters)
            self._apply_character()
        return self.get_state()

    def _add_new_characters(self):
        """Characters that came with an update are added once (if you delete them they stay deleted)."""
        added = self._characters.setdefault("added", [])
        changed = False
        chars = self._characters["characters"]
        if "kit_is_vermeil" not in added:                  # one time: Vermeil uses the anime girl model, Kit is merged into her
            added.append("kit_is_vermeil"); added.append("kit")
            changed = True
            kit = next((c for c in chars if c.get("id") == "kit"), None)
            ver = next((c for c in chars if c.get("id") == "vermeil"), None)
            if ver and os.path.exists(os.path.join(UI_DIR, "models", "anime_girl.glb")):
                ver["model"] = "anime_girl.glb"
                ver["outfit"] = (kit or {}).get("outfit", "mech"); ver["hair"] = (kit or {}).get("hair", "original")
                if kit:
                    chars.remove(kit)
                    if self._characters.get("active") == "kit":
                        self._characters["active"] = "vermeil"
        if "vermeil_kokoro" not in added:                  # one time: Vermeil gets her Kokoro voice back (used when online)
            added.append("vermeil_kokoro")
            changed = True
            ver = next((c for c in chars if c.get("id") == "vermeil"), None)
            if ver and not ver.get("voice_online"):
                ver["voice_online"] = "kokoro:af_heart"
        for c in chars:                                    # no pet names in saved personalities
            p = c.get("prompt") or ""
            new = p.replace("use sweet names.", "never use pet names or endearments (no darling, love, babe).")
            new = re.sub(r",\s*darling\b|\b(?:Oh )?love,\s*", lambda m: "" if "darling" in m.group(0) else "", new)
            if new != p:
                c["prompt"] = new; changed = True
        for c in NEW_CHARACTERS:
            if c["id"] in added:
                continue
            added.append(c["id"])
            changed = True
            if os.path.exists(os.path.join(UI_DIR, "models", c["model"])) and \
                    not any(x.get("model") == c["model"] for x in self._characters["characters"]):
                self._characters["characters"].append(dict(c))
        if changed:
            _write_json(CHARACTERS_FILE, self._characters)

    def make_personality(self, who, name=""):
        """'Rick Sanchez' / 'Jake the Dog' -> a Personality text that makes her talk like that character"""
        import llm
        who = re.sub(r"\s+", " ", str(who or "")).strip()[:80]
        if not who:
            return {"error": "Type a character first, like Rick Sanchez."}
        name = re.sub(r"\s+", " ", str(name or "")).strip()[:40]
        me = f"You are {name}, talking exactly like {who}" if name and name.lower() != who.lower() else f"You are {who}"
        prompt = (f"Write a roleplay character prompt so an AI companion talks exactly like {who}. "
                  f"Start with \"{me}\". Then, in second person (\"You ...\"), describe in 5-8 short sentences: who they are, "
                  f"their attitude and mood, HOW they talk (word choice, slang, sentence length, verbal tics, stutters or "
                  f"burps if they have them), 3-5 of their real catchphrases or typical expressions in quotes, what they care "
                  f"about, and how they treat the user (as a friend they chat with). If {who} isn't a known character, invent "
                  f"a fitting personality from the name. Keep their personality exactly; then add 2 sentences on how to write "
                  f"so a text-to-speech voice says it naturally: {SPOKEN_WRITING} End with exactly: "
                  f"\"Keep replies under 40 words and speak only in dialogue, never actions.\" Reply with the prompt "
                  f"text only: no title, no quotes around it, no lists.")
        try:
            text = llm.ask(prompt, model="smart", temperature=0.8)
        except Exception as e:
            return {"error": f"Couldn't write the personality: {e}"}
        text = re.sub(r"^\s*(here'?s?|sure)[^\n]*:\s*\n", "", str(text or ""), flags=re.I)   # "Here's the prompt:" lines
        text = re.sub(r"[*#`]+", "", text).strip().strip('"').strip()
        if len(text) < 20:
            return {"error": "The AI didn't write anything. Try again."}
        return {"name": who.title() if who.islower() else who, "prompt": text[:1500]}

    def save_character(self, data):
        chars = self._characters["characters"]
        name = (data.get("name") or "").strip() or "New character"
        entry = next((c for c in chars if c["id"] == data.get("id")), None)
        if entry is None:
            entry = {"id": uuid.uuid4().hex[:8]}
            entry["memory_key"] = entry["id"]
            chars.append(entry)
        entry.update({"name": name, "prompt": (data.get("prompt") or "").strip() or f"You are {name}.",
                      "voice": (data.get("voice") or tts.DEFAULT_VOICE).strip(), "model": data.get("model") or "",
                      "voice_online": str(data.get("voice_online") or "").strip() if str(data.get("voice_online") or "").startswith("kokoro:") else "",
                      "rate": _percent(data.get("rate")), "pitch": _hertz(data.get("pitch")),
                      "volume": max(20, min(150, int(data.get("volume") or 100))),
                      "emotion": max(0, min(150, int(data["emotion"] if str(data.get("emotion", "")).lstrip("-").isdigit() else 100))),
                      "natural": data.get("natural") is not False,
                      "emotional": bool(data.get("emotional")),
                      "flip": bool(data.get("flip")),
                      "language": (data.get("language") or "auto").strip()[:8], "translate": bool(data.get("translate")),
                      "outfit": str(data.get("outfit") or "")[:20], "hair": str(data.get("hair") or "")[:20],
                      "rvc": _rvc_settings(data.get("rvc"))})
        _write_json(CHARACTERS_FILE, self._characters)
        if entry["id"] == self._characters["active"]:
            self._apply_character()
        return {"id": entry["id"], "state": self.get_state()}

    def delete_character(self, char_id):
        chars = self._characters["characters"]
        if len(chars) <= 1:
            return {"error": "You need at least one character.", "state": self.get_state()}
        self._characters["characters"] = [c for c in chars if c["id"] != char_id]
        if self._characters["active"] == char_id:
            self._characters["active"] = self._characters["characters"][0]["id"]
            self._apply_character()
        _write_json(CHARACTERS_FILE, self._characters)
        return {"state": self.get_state()}

    # ---------- share characters: one .vermeil file with the personality, voice and 3D model (brain/charshare.py) ----------
    def character_export(self, char_id=None, include_voice=True, path=None):
        import charshare
        char = next((c for c in self._characters["characters"] if c["id"] == (char_id or self._characters["active"])), None)
        if not char:
            return {"error": "That character wasn't found."}
        if not path:
            picked = self._window.create_file_dialog(_SAVE_DIALOG, save_filename=charshare.file_name(char),
                                                     file_types=("Vermeil character (*.vermeil)",))
            if not picked:
                return None
            path = picked[0] if isinstance(picked, (list, tuple)) else picked
        if not path.lower().endswith(charshare.EXT):
            path += charshare.EXT
        try:
            res = charshare.export_character(char, path, MODELS_DIR, include_voice)
        except Exception as e:
            return {"error": f"Couldn't save it: {e}"}
        extra = " + ".join(x for x, on in (("3D model", res["has_model"]), ("voice clone", res["has_voice"])) if on)
        res["message"] = (f"Saved {char['name']} ({round(res['size'] / 1048576, 1)} MB{', with ' + extra if extra else ''}). "
                          f"Send the file to a friend: they open Characters → Import a character.")
        return res

    def character_import(self, path=None):
        import charshare
        if not path:
            picked = self._window.create_file_dialog(_OPEN_DIALOG, file_types=("Vermeil character (*.vermeil)",))
            if not picked:
                return None
            path = picked[0] if isinstance(picked, (list, tuple)) else picked
        try:
            char = charshare.import_character(path, MODELS_DIR)
        except Exception as e:
            return {"error": str(e)}
        notes = char.pop("notes", [])
        res = self.save_character(char)
        res["message"] = f"Added {char['name']}{' with their ' + ' and '.join(notes) if notes else ''}."
        return res

    # ---------- 3D models ----------
    def list_models(self):
        os.makedirs(MODELS_DIR, exist_ok=True)  # (Pip the penguin is built in: model "builtin:penguin")
        return sorted(f for f in os.listdir(MODELS_DIR) if f.lower().endswith(MODEL_TYPES))

    def import_model(self):
        """Open a file picker and copy a .glb / .gltf / .vrm (plus its texture pictures) into ui/models."""
        paths = self._window.create_file_dialog(
            _OPEN_DIALOG, allow_multiple=True,
            file_types=("3D models and their textures (*.glb;*.gltf;*.vrm;*.bin;*.png;*.jpg;*.jpeg;*.webp)",))
        if not paths:
            return None
        res = copy_model_files(paths if isinstance(paths, (list, tuple)) else [paths], MODELS_DIR)
        if res.get("error"):
            self.emit({"type": "toast", "text": res["error"]})
            return None
        return res["name"]

    def save_rigged_model(self, name, data_b64):
        """The rigger (ui/rigger.js) sends the rigged .glb as base64; it's saved next to the original."""
        import base64
        name = re.sub(r'[\\/:*?"<>|]+', "_", os.path.basename(name or "")).strip() or "model-rigged.glb"
        if not name.lower().endswith(".glb"):
            name += ".glb"
        try:
            data = base64.b64decode(data_b64)
        except (ValueError, TypeError):
            return {"error": "The rigged model came through broken."}
        if data[:4] != b"glTF":
            return {"error": "That isn't a .glb file."}
        os.makedirs(MODELS_DIR, exist_ok=True)
        with open(os.path.join(MODELS_DIR, name), "wb") as f:
            f.write(data)
        return {"name": name}

    def unimate_status(self):
        import animate
        return animate.status()

    def unimate_setup(self):
        """the Animate box's button when UniMate isn't ready: get what it misses now, in the background"""
        import animate
        import autosetup
        st = animate.status()
        if st["ready"]:
            return {"ready": True}
        started = autosetup.retry("unimate", self.emit)
        return {"started": started, "hint": "Getting UniMate ready in the background (what's missing of Miniconda, its code, "
                "its own Python, the checkpoint and its libraries, up to 3 GB). The bar at the bottom shows how far it is; open this box again when it's done."
                if started else st["hint"] or "UniMate's setup is already running."}

    def unimate_animate(self, name, motions):
        """Runs UniMate in the background; progress comes as {"type": "animate_progress"} events."""
        import animate
        st = animate.status()
        if not st["ready"]:
            return {"error": st["hint"]}
        path = os.path.join(MODELS_DIR, os.path.basename(name or ""))
        if not os.path.exists(path):
            return {"error": f"Can't find {name}."}

        def work():
            began = time.time()

            def progress(pct, text):
                spent = time.time() - began                 # time left: from how long the steps so far took
                left = spent * (1 - pct) / pct if pct >= 0.15 and spent > 20 else None
                self.emit({"type": "animate_progress", "pct": pct, "text": text, "left": round(left) if left else None})
            try:
                out = animate.animate(path, list(motions or ["idle"]), progress)
                rel = lambda p: os.path.relpath(p, UI_DIR).replace(os.sep, "/")
                self.emit({"type": "animate_progress", "done": True,
                           "outputs": [{"clip": o["clip"], "url": rel(o["path"])} for o in out]})
            except animate.Cancelled:
                self.emit({"type": "animate_progress", "cancelled": True})
            except Exception as err:  # noqa: BLE001 - shown to the user
                log = os.path.join(animate.WORK_DIR, os.path.splitext(os.path.basename(path))[0], "unimate.log")
                self.emit({"type": "animate_progress", "error": str(err),
                           "log": os.path.relpath(log, BASE_DIR) if os.path.exists(log) else ""})
        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def unimate_cancel(self):
        import animate
        return animate.cancel()

    # ---------- Settings > General > Update (skills/updater.py) ----------
    def app_update_check(self):
        import updater
        return updater.check()

    def app_update(self):
        """downloads the newest Vermeil from GitHub in the background; the bar follows {"type": "app_update"} events"""
        import updater
        if getattr(self, "_updating", False):
            return {"started": False, "error": "An update is already running."}
        self._updating = True

        def work():
            try:
                res = updater.update(lambda pct, text: self.emit({"type": "app_update", "pct": pct, "text": text}))
            except Exception as err:  # noqa: BLE001 - shown to the user
                res = {"error": str(err)}
            finally:
                self._updating = False
            self.emit({"type": "app_update", "done": True, **res})
        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    # ---------- Settings > General > Backup: everything you saved in one .zip ----------
    def backup_make(self, big=False, path=None):
        import backup
        if not path:
            picked = self._window.create_file_dialog(_SAVE_DIALOG, save_filename=f"vermeil_backup_{time.strftime('%Y-%m-%d')}.zip",
                                                     file_types=("Vermeil backup (*.zip)",))
            if not picked:
                return None
            path = picked[0] if isinstance(picked, (list, tuple)) else picked
        if not path.lower().endswith(".zip"):
            path += ".zip"
        try:
            r = backup.make(path, bool(big))
        except Exception as e:  # noqa: BLE001 - shown to the user
            return {"error": f"Couldn't make the backup: {e}"}
        return {**r, "message": f"Backup saved: {os.path.basename(path)} ({r['files']} files, {r['mb']} MB)."}

    def backup_restore(self, path=None):
        import backup
        if not path:
            picked = self._window.create_file_dialog(_OPEN_DIALOG, file_types=("Vermeil backup (*.zip)",))
            if not picked:
                return None
            path = picked[0] if isinstance(picked, (list, tuple)) else picked
        try:
            r = backup.restore(path)
        except Exception as e:  # noqa: BLE001 - shown to the user
            return {"error": f"Couldn't restore it: {e}"}
        if r.get("error"):
            return r
        return {**r, "message": f"Restored {r['files']} files. Restart Vermeil to load them. "
                                f"(Your data from before is saved in backups/{os.path.basename(r['safety'])}.)"}

    def app_restart(self):
        import updater
        updater.restart()
        threading.Timer(0.5, lambda: self._window and self._window.destroy()).start()
        return {"ok": True}

    # ---------- XP, levels, daily quests, badges and the Battle Pass (skills/quest.py) ----------
    def _xp(self, kind, n=1, xp=None, why=""):
        """give XP for something you did; the window shows "+N XP", level-ups and new Battle Pass rewards"""
        try:
            import quest
            res = quest.award(kind, n, xp)
            self.emit({"type": "quest", **res, "why": why})
            for r in res.get("rewards", []):
                if self._settings["speak_replies"] and not self._settings["quiet_mode"]:
                    threading.Thread(target=pm.speak, args=(f"You unlocked {r['name']}!",), daemon=True).start()
                    break
            return res
        except Exception as e:  # noqa: BLE001 - XP never breaks the feature that gave it
            print(f"[quest] {e}")
            return {}

    def quest_state(self):
        import quest
        return quest.state()

    def quest_award(self, kind, n=1):
        """only small, self-reported things can be given from the window (a drawing, a shadowed line, a card)"""
        import quest
        if kind not in ("card_right", "card_wrong", "shadow", "draw", "meal"):
            return {"error": "Unknown XP kind."}
        return self._xp(kind, max(1, min(int(n), 20)))

    # ---------- habit tracker (skills/habits.py) ----------
    def habits_list(self):
        import habits
        return habits.habits()

    def habit_add(self, name, icon="✅", goal=1):
        import habits
        try:
            return habits.add(name, icon, goal)
        except ValueError as e:
            return {"error": str(e)}

    def habit_remove(self, hid):
        import habits
        return habits.remove(hid)

    def habit_tick(self, hid, n=1):
        import habits
        try:
            view, reached = habits.tick(hid, n)
        except ValueError as e:
            return {"error": str(e)}
        if int(n) > 0:
            self._xp("habit", xp=15 if reached else 2, why=f"{view['icon']} {view['name']}" + (" - goal reached!" if reached else ""))
        return view

    # ---------- Study -> Play: flashcards, video moments, ask the library, formula sheet ----------
    def cards_deck(self, limit=30):
        import studygame
        return studygame.deck(limit)

    def cards_answer(self, card_id, knew, combo=0):
        import studygame
        box = studygame.answer(card_id, bool(knew))
        xp = 5 + 2 * min(int(combo or 0), 5) if knew else 1
        return {"box": box, "xp": self._xp("card_right" if knew else "card_wrong", xp=xp,
                                         why=f"Combo x{combo}" if knew and combo and int(combo) > 1 else "")}

    def study_moment(self, source, text=""):
        """a reviewer question's source -> the video and the second it was said ({url} plays in the window)"""
        import studygame, mediaserve
        m = studygame.find_moment(source, text)
        if not m:
            return {"error": "That part isn't from a video lecture (or the video isn't in your library anymore)."}
        return {**m, "url": mediaserve.url(m["file_id"], m["seconds"])}

    def study_video_url(self, file_id, seconds=0):
        import mediaserve
        return {"url": mediaserve.url(file_id, seconds)}

    def study_ask(self, question, file_ids=None):
        import studygame, mediaserve
        try:
            res = studygame.ask_library(question, file_ids)
        except Exception as e:  # noqa: BLE001
            return {"error": str(e)}
        for s in res["sources"]:
            if s.get("moment"):
                s["moment"]["url"] = mediaserve.url(s["moment"]["file_id"], s["moment"]["seconds"])
        if res["sources"]:
            self._xp("ask_library", why="Asked your library")
        return res

    def study_formulas(self, file_ids):
        import studygame
        try:
            res = studygame.formula_sheet(file_ids or [])
        except Exception as e:  # noqa: BLE001
            return {"error": str(e)}
        self._xp("formula_sheet", why="Formula sheet made")
        return res

    # ---------- Study -> Language extras (skills/sensei.py) ----------
    def sensei_scenes(self):
        import sensei
        return [{"id": k, "label": v[0]} for k, v in sensei.SCENES.items()]

    def sensei_shadow(self, language=None, topic=""):
        import sensei
        try:
            return sensei.shadow_lines(language, None, topic)
        except Exception as e:  # noqa: BLE001
            return {"error": str(e)}

    def sensei_words(self, language=None):
        import sensei
        return sensei.word_bank(language)

    def sensei_word_remove(self, language, word):
        import sensei
        return sensei.remove_word(language, word)

    def sensei_report(self, language=None):
        import sensei
        return sensei.weekly_report(language)

    def sensei_speed(self, value=None):
        import sensei
        return sensei.set_speed(value) if value else sensei.speed()

    def sensei_draw_sets(self, language=None):
        import sensei
        return sensei.draw_sets(language)

    # ---------- smart reminders (skills/smartremind.py) ----------
    def smart_reminders(self):
        import smartremind
        return smartremind.list_all()

    def smart_reminder_add(self, event, on="home", match="", minutes=30):
        import smartremind
        return {"message": smartremind.add(event, on, match, minutes), "items": smartremind.list_all()}

    def smart_reminder_remove(self, text):
        import smartremind
        smartremind.remove(text)
        return smartremind.list_all()

    # ---------- screen helper ----------
    def screen_help(self, question=""):
        """Home -> "🖥 What's on my screen?": a screenshot behind the window, explained (errors: how to fix them)"""
        q = (question or "").strip() or "What is this? If there's an error, what does it mean and how do I fix it?"
        answer = self._look_at_screen(q)
        self.emit({"type": "reply", "text": answer})
        return {"answer": answer}

    # ---------- voices ----------
    def list_voices(self):
        return tts.list_voices()

    def list_online_voices(self):
        """Kokoro voices (Vermeil's online voice) + whether Kokoro is set up / running."""
        import kokoro
        return {"voices": kokoro.list_voices(), "status": kokoro.status(), "online": pm.online_now()}

    def kokoro_start(self):
        import kokoro
        threading.Thread(target=kokoro.start, daemon=True).start()
        return kokoro.status()

    # ---------- RVC voice clones ----------
    def rvc_list(self):
        import rvc
        return {"voices": rvc.list_voices(), "status": rvc.status()}

    def rvc_import(self):
        """Pick an RVC .pth (its .index next to it is found by itself) and copy it into data\\rvc_voices."""
        import rvc
        paths = self._window.create_file_dialog(_OPEN_DIALOG, allow_multiple=True,
                                               file_types=("RVC voice (*.pth;*.index)", "All files (*.*)"))
        if not paths:
            return None
        paths = list(paths) if isinstance(paths, (list, tuple)) else [paths]
        pth = next((p for p in paths if p.lower().endswith(".pth")), None)
        index = next((p for p in paths if p.lower().endswith(".index")), None)
        if not pth:
            return {"error": "Pick the voice's .pth file (you can pick its .index too).", **self.rvc_list()}
        def progress(pct, text):                      # the loading bar under "Import a voice"
            self.emit({"type": "rvc_progress", "pct": round(pct, 3), "text": text})
        progress(0.01, "Getting the voice ready…")
        try:
            info = rvc.import_voice(pth, index, progress=progress)
        except Exception as e:
            self.emit({"type": "rvc_progress", "error": str(e)})
            return {"error": str(e), **self.rvc_list()}
        return {"imported": info, **self.rvc_list()}

    def rvc_delete(self, name):
        import rvc
        rvc.delete_voice(name)
        return self.rvc_list()

    SAMPLE_LINES = {"ja": "こんにちは、{n}です。よろしくね。", "ko": "안녕하세요, 저는 {n}이에요. 반가워요.", "fil": "Kumusta! Ako si {n}. Ikinagagalak kitang makilala.",
                    "tl": "Kumusta! Ako si {n}.", "zh": "你好，我是{n}。很高兴认识你。", "es": "¡Hola! Soy {n}. Encantada de conocerte.",
                    "fr": "Bonjour, je suis {n}. Enchantée.", "de": "Hallo, ich bin {n}. Schön, dich kennenzulernen.",
                    "it": "Ciao, sono {n}. Piacere di conoscerti.", "pt": "Olá, eu sou {n}. Prazer em te conhecer.",
                    "ru": "Привет, я {n}. Рада познакомиться.", "th": "สวัสดีค่ะ ฉันชื่อ{n}", "vi": "Xin chào, mình là {n}.",
                    "id": "Halo, aku {n}. Senang bertemu denganmu.", "ms": "Hai, saya {n}. Gembira berkenalan.", "hi": "नमस्ते, मैं {n} हूँ।"}

    def get_pronunciations(self):
        """Settings → Pronunciations: 'word = how to say it' lines."""
        import expressive
        return expressive.pronunciations_text()

    def save_pronunciations(self, text):
        import expressive
        return len(expressive.save_pronunciations(str(text or "")[:20000]))

    def chatter_status(self):
        import chatter
        return chatter.status()

    def preview_voice(self, voice, rate=0, pitch=0, name="", volume=100, rvc=None, language="", emotional=False):
        v = str(voice or "")
        lang = (v[6:].split("_")[0] if v.startswith("piper:") else v.split("-")[0]).lower()
        if v.startswith("kokoro:"):
            lang = {"j": "ja", "z": "zh", "e": "es", "f": "fr", "h": "hi", "i": "it", "p": "pt"}.get(v[7:8], "en")
        clone = _rvc_settings(rvc) if rvc is not None else None
        if clone and clone.get("model") and language and language != "auto":
            lang = language                                  # the clone speaks the character's language
        line = self.SAMPLE_LINES.get(lang, "Hi, I'm {n}. This is how I sound.").format(n=name or "your companion")
        emotional = bool(emotional) and lang == "en"
        if emotional:
            line = f"Oh, hi! I'm {name or 'your companion'}. [chuckle] Honestly? I'm so happy you're here."
        voice = tts.resolve_voice(v) if v else voice
        if clone is not None and clone.get("model"):
            import rvc as _rvc
            if _rvc.base_gender(clone):
                voice = _rvc.base_voice(clone, lang, voice)
                # the base voice is picked already; keep its high / low pitch
                clone = {**clone, "base": "own", "pitch": clone.get("pitch", 0) + _rvc.base_shift(clone)}

        def say():
            old, old_chatter = pm.VOICE_VOLUME, pm.VOICE_CHATTER
            pm.VOICE_VOLUME = max(0.2, min(1.5, float(volume or 100) / 100))
            pm.VOICE_CHATTER = emotional
            try:
                pm.speak(line, voice, _percent(rate), _hertz(pitch), rvc=clone)
            finally:
                pm.VOICE_VOLUME, pm.VOICE_CHATTER = old, old_chatter
        threading.Thread(target=say, daemon=True).start()
        return True

    # ---------- room interactions ----------
    def interact(self, thing, result=None):
        """Something in the room was clicked. The radio plays music; the character may comment."""
        if thing == "Radio":
            reply = f1.music_control("playlist" if result == "on" else "stop")
            self.emit({"type": "toast", "text": reply})
        now = time.time()
        if thing in REACTIONS and now - self._last_reaction > REACTION_COOLDOWN:
            self._last_reaction = now
            threading.Thread(target=self._react, args=(REACTIONS[thing].format(result=result),), daemon=True).start()
        return True

    def _react(self, situation):
        line = pm.quick_line(f"{situation} React to it naturally.")
        if line:
            self.emit({"type": "reply", "text": line})
            if self._settings["speak_replies"]:
                pm.speak(line)

    # ---------- room layout ----------
    def load_room(self):
        """The saved furniture layout, or None for the default room."""
        data = _read_json(ROOM_FILE, {})
        return data if isinstance(data.get("items"), list) else None

    def save_room(self, layout):
        if isinstance(layout, dict) and isinstance(layout.get("items"), list) and len(layout["items"]) <= 500:
            _write_json(ROOM_FILE, layout)
            return True
        return False

    # ---------- settings ----------
    def _privacy_changed(self):
        if self._settings["privacy_mode"]:
            self._presence.stop()
            self._presence.preview = False
            self.emit({"type": "camera", "status": "off"})
        pm.vision_source = (lambda: None) if self._settings["privacy_mode"] else self._presence.snapshot
        self._presence.watch_objects = self._settings["watch_objects"] and not self._settings["privacy_mode"]
        if not self._presence.watch_objects:
            self._presence.objects = []

    def save_settings(self, data):
        import mind
        for k in DEFAULT_SETTINGS:
            if k in data:
                if k == "style":
                    if data[k] in mind.STYLES:
                        self._settings[k] = data[k]
                elif k == "humor":
                    self._settings[k] = max(0, min(3, int(data[k])))
                elif k == "music_source":
                    if data[k] in ("auto", "spotify", "youtube"):
                        self._settings[k] = data[k]
                elif k == "wake_sensitivity":
                    self._settings[k] = max(1, min(3, int(data[k])))
                elif k == "voice_style":
                    if data[k] in pm.VOICE_STYLES:
                        self._settings[k] = data[k]
                elif k == "performance":
                    import machine
                    if data[k] in machine.MODES:
                        self._settings[k] = data[k]
                elif k == "phone_access":
                    self.phone_set(bool(data[k]))
                elif k in ("focus_block_words", "focus_allow_words"):
                    self._settings[k] = ", ".join(w.strip().lower() for w in str(data[k]).split(",") if w.strip())[:600]
                else:
                    self._settings[k] = bool(data[k])
        self._apply_settings()
        self._save_settings()
        return self._settings

    def _apply_settings(self):
        pm.always_look = self._settings["always_look"]
        pm.style = self._settings["style"]
        pm.context_aware = self._settings["context_aware"]
        pm.self_check = self._settings["self_check"]
        pm.humor_level = self._settings["humor"]
        pm.VOICE_STYLE = self._settings["voice_style"]
        if hasattr(self, "_presence"):
            self._privacy_changed()
        if self._settings["gesture_mode"] and not getattr(self, "_gesture_thread", None):
            self._gesture_thread = threading.Thread(target=self._gesture_loop, daemon=True)
            self._gesture_thread.start()
        pm.barge_in = self._settings["barge_in"]
        pm.keep_screens = self._settings["keep_screens"] and not self._settings["privacy_mode"]
        pm.stream_speech = self._settings["stream_speech"]
        import spotify
        f1.external_player = spotify.control
        f1.use_external = self._use_spotify
        if hasattr(self, "_coder"):
            self._coder.auto_write_own = self._settings["code_auto_write"]
        pm.noise_filter = self._settings["noise_filter"]
        pm.wake_sensitivity = self._settings["wake_sensitivity"]
        import ducking
        ducking.enabled = self._settings["duck_audio"]
        if not ducking.enabled:
            ducking.release_all()
        self._apply_performance(announce=True)

    # ---------- performance mode: low-end PC mode, picked by scanning this computer (brain/machine.py) ----------
    def _apply_performance(self, announce=False):
        import machine
        if not getattr(self, "_machine", None):
            self._machine = machine.scan()
        mode = machine.choose(self._settings["performance"], self._machine)
        was = getattr(self, "_perf_mode", None)
        self._perf_mode = mode
        pm.LOW_POWER = mode == "low"
        if pm.LOW_POWER and not os.environ.get("WHISPER_MODEL"):
            import stt
            if stt._settings()[0] in ("small", "medium", "large-v3"):   # the small model hears you much faster
                os.environ["WHISPER_MODEL"] = "base"
                self._whisper_lowered = True
        elif not pm.LOW_POWER and getattr(self, "_whisper_lowered", False):
            os.environ.pop("WHISPER_MODEL", None)
            self._whisper_lowered = False
        if announce and was and was != mode:
            self.emit({"type": "performance", **self.performance_status()})
            self.emit({"type": "toast", "text": "🐢 Low-end PC mode is on: lighter voice and 3D so she stays fast." if pm.LOW_POWER
                       else f"⚡ Back to {mode} mode: full voices and 3D."})

    def performance_status(self):
        import machine
        info = getattr(self, "_machine", None) or {}
        return {"setting": self._settings["performance"], "mode": getattr(self, "_perf_mode", "normal"),
                "why": machine.why(self._settings["performance"], info) if info else "", "machine": machine.summary(info)}

    def performance_rescan(self):
        import machine
        self._machine = machine.scan()
        self._apply_performance(announce=True)
        return self.performance_status()

    def _battery_loop(self):
        """Auto mode: a laptop that runs low on battery switches to low-end mode, and back when it's plugged in."""
        while True:
            time.sleep(60)
            try:
                import psutil
                b = psutil.sensors_battery()
                if b is None:
                    return                                   # a desktop: nothing to watch
                self._machine["battery"], self._machine["plugged"] = int(b.percent), bool(b.power_plugged)
                if self._settings["performance"] == "auto":
                    self._apply_performance(announce=True)
            except Exception as e:
                print(f"[performance] {e}")
                return

    # ---------- baking & cooking (same tools, two recipe books: kind = "baking" or "cooking") ----------
    def baking_list(self, kind="baking"):
        import baking
        baking.ensure_sample(kind)
        return baking.list_recipes(kind)

    def baking_get(self, rid, kind="baking"):
        import baking
        return baking.get_recipe(rid, kind) or {"error": "Recipe not found."}

    def baking_save(self, recipe, kind="baking"):
        import baking
        return baking.save_recipe(recipe, kind)

    def baking_delete(self, rid, kind="baking"):
        import baking
        return baking.delete_recipe(rid, kind)

    def baking_find_image(self, rid, kind="baking"):
        import baking
        try:
            return baking.find_image(rid, kind)
        except Exception as e:
            return {"error": str(e)}

    def baking_star(self, rid, kind="baking"):
        import baking
        return baking.toggle_saved(rid, kind)

    def baking_import(self, url, kind="baking"):
        import baking
        url = (url or "").strip()
        if not re.match(r"https?://", url):
            return {"error": "Paste the full web address (starting with https://)."}
        try:
            return baking.import_url(url, kind)
        except Exception as e:
            return {"error": f"Couldn't read that page: {e}"}

    def baking_search(self, query, kind="baking"):
        import baking
        if not (query or "").strip():
            return []
        try:
            return baking.search_online(query.strip(), kind)
        except Exception as e:
            return {"error": f"Search didn't work right now: {e}"}

    def baking_convert(self, qty, unit, name):
        import baking
        return baking.convert(qty, unit, name)

    def baking_alternatives(self, name):
        import baking
        return baking.alternatives(name)

    def baking_parse(self, line):
        import baking
        return baking.ingredient(line)

    def baking_nutrition(self, rid, kind="baking"):
        import baking
        try:
            return baking.refresh_nutrition(rid, kind)
        except Exception as e:
            return {"error": f"Couldn't estimate nutrition right now: {e}"}

    # ---------- gym ----------
    def gym_state(self, day=None):
        import gym
        routine = gym.get_routine()
        day = int(day) if day else gym.next_day()
        return {"days": [{"day": d["day"], "title": d["title"]} for d in routine["days"]], "day": day,
                "plan": gym.day_plan(day) if day else None, "today": gym.today_log(), "streak": gym.streak(),
                "profile": routine.get("profile", {})}

    def gym_routine(self):
        import gym
        return gym.get_routine()

    def gym_save_routine(self, routine):
        import gym
        return gym.save_routine(routine)

    def gym_reset_day(self):
        import gym
        return gym.reset_day()

    def gym_import(self):
        import gym
        paths = self._window.create_file_dialog(_OPEN_DIALOG, file_types=("Excel files (*.xlsx)",))
        if not paths:
            return {"error": "No file chosen."}
        try:
            return gym.import_xlsx(paths[0])
        except Exception as e:
            return {"error": f"Couldn't read that file: {e}"}

    def gym_log_set(self, exercise, set_no, kg, reps, day):
        import gym
        return gym.log_set(exercise, set_no, kg, reps, day=day)

    def gym_unlog_set(self, exercise, set_no):
        import gym
        return gym.unlog_set(exercise, set_no)

    def gym_upgrade_weight(self, exercise, new_kg=None):
        import gym
        return gym.upgrade_weight(exercise, new_kg)

    def gym_finish(self, minutes, note=""):
        import gym
        out = gym.finish_workout(minutes, note)
        if out.get("saved"):
            self._xp("workout", why="Workout done")
        return out

    def gym_history(self):
        import gym
        return gym.history(90)

    def gym_clear_history(self):
        import gym
        return gym.clear_history()

    def gym_undo_clear(self):
        import gym
        return gym.undo_clear_history()

    def gym_progress(self, exercise):
        import gym
        return gym.exercise_progress(exercise)

    def gym_stats(self):
        import gym
        return {"stats": gym.get_stats(), "fields": gym.STAT_FIELDS}

    def gym_add_stats(self, values):
        import gym
        return gym.add_stats(values or {})

    def gym_body(self, profile=None):
        """BMI / calories. With a profile it's saved first; without, the saved one is used."""
        import gym
        if profile:
            return gym.save_profile(profile)
        p = gym.get_profile()
        res = gym.calories(p.get("height"), p.get("weight"), p.get("age"), p.get("gender"), p.get("activity", "moderate")) if p else {}
        return {"profile": p, "activity": gym.ACTIVITY, **({} if res.get("error") else res)}

    def gym_monthly(self):
        import gym
        return gym.monthly_progress()

    def gym_meals(self, goal="recomp", meals=4, dishes=None):
        import gym
        return gym.meal_plan(goal, meals=meals, dishes=dishes)

    def gym_alternatives(self, query):
        import gym
        return gym.find_alternatives(query)

    def gym_muscles(self, names):
        """{exercise name: [muscles, most targeted first]} for the muscle maps"""
        import gym
        return {n: gym.muscles_for(n) for n in (names or [])[:60]}

    # ---------- Gym -> Calories: meal log (photo estimate), rest-day + sleep tips ----------
    def gym_meal_photo(self, base64_data, mime="image/jpeg"):
        """a photo of your plate -> {name, kcal, protein, carbs, fat, note} (not saved until you tap Add)"""
        import gymcoach
        b64 = str(base64_data or "").split(",", 1)[-1]
        if not b64 or len(b64) > 12_000_000:
            return {"error": "Pick a photo under about 8 MB."}
        mime = mime if re.fullmatch(r"image/(jpeg|png|webp)", str(mime or "")) else "image/jpeg"
        try:
            r = pm.get_client().chat.completions.create(model=pm.VISION_MODEL, messages=[{"role": "user", "content": [
                {"type": "text", "text": gymcoach.PHOTO_PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}]}])
        except Exception as e:  # noqa: BLE001 - shown to the user
            return {"error": f"Couldn't look at the photo (are you online?): {e}"}
        est = gymcoach.parse_estimate(r.choices[0].message.content)
        return est if est["name"] else {"error": est["note"] or "I couldn't tell what's on the plate."}

    def gym_meal_today(self):
        import gymcoach
        return gymcoach.meals()

    def gym_meal_add(self, meal):
        import gymcoach
        out = gymcoach.add_meal(meal)
        if not out.get("error"):
            self._xp("meal", why="Meal logged")
        return out

    def gym_meal_remove(self, meal_id):
        import gymcoach
        return gymcoach.remove_meal(meal_id)

    def gym_sleep(self, hours):
        import gymcoach
        return gymcoach.log_sleep(hours)

    def gym_advice(self):
        import gym
        import gymcoach
        return gymcoach.advice(gym.history(14), gym.streak())

    # ---------- Robotics & Electronics (panel + Circuit Lab page ui/electronics/lab.html) ----------
    def elec_formulas(self):
        import electronics
        return electronics.formulas_list()

    def elec_calc(self, kind, values):
        import electronics
        return electronics.calc(kind, values or {})

    def elec_ask(self, mode, question, context=None):
        import electronics
        return electronics.ask(mode, question, context)

    def elec_chat(self, message):
        import electronics
        return electronics.chat(message)

    def elec_chat_state(self):
        import electronics
        return electronics.chat_state()

    def elec_chat_clear(self, keep_log=True):
        import electronics
        return electronics.chat_clear(keep_log)

    def elec_projects(self):
        import electronics
        return electronics.list_projects()

    def elec_save(self, name, data):
        import electronics
        return electronics.save_project(name, data)

    def elec_load(self, name):
        import electronics
        return electronics.load_project(name)

    def elec_delete(self, name):
        import electronics
        return electronics.delete_project(name)

    def elec_pending(self, circuit=None):
        """hand a circuit from the assistant panel to the Circuit Lab page (it opens and picks it up)"""
        if circuit is not None:
            self._elec_pending = circuit
            return True
        c, self._elec_pending = getattr(self, "_elec_pending", None), None
        return c

    # ---------- Generator: pictures, presentations, narrated videos from a topic or PDFs ----------
    def gen_start(self, kind, opts=None):
        try:
            import generator
        except ModuleNotFoundError:
            return {"error": "Generator isn't installed - install it in Settings → Plugins first."}
        generator.on_event = self.emit
        o = dict(opts or {})
        allowed = {"pictures": ("prompt", "count", "size", "style"), "presentation": ("topic", "pdfs", "slides", "theme", "pictures_on"),
                   "video": ("topic", "pdfs", "scenes", "theme")}.get(kind, ())
        return generator.start(kind, **{k: v for k, v in o.items() if k in allowed})

    def gen_pick_pdfs(self):
        paths = self._window.create_file_dialog(_OPEN_DIALOG, allow_multiple=True, file_types=("PDF files (*.pdf)",))
        return list(paths or [])

    def gen_recent(self):
        try:
            import generator
        except ModuleNotFoundError:
            return {"files": [], "folder": ""}
        return {"files": generator.recent(), "folder": generator.OUT_DIR}

    def _gen_path(self, path):
        import generator
        full = os.path.realpath(path or "")
        if not full.startswith(os.path.realpath(generator.OUT_DIR) + os.sep) or not os.path.isfile(full):
            raise ValueError("That file isn't one of your creations.")
        return full

    def gen_open(self, path=None):
        import generator
        try:
            open_path(self._gen_path(path) if path else generator.OUT_DIR)
            return {"ok": True}
        except (OSError, ValueError) as e:
            return {"error": str(e)}

    def gen_preview(self, path):
        """a small picture of a creation (png as-is, a thumbnail for videos) for the panel"""
        import base64
        try:
            full = self._gen_path(path)
            from PIL import Image
            if full.lower().endswith(".mp4"):
                import cv2
                cap = cv2.VideoCapture(full); cap.set(cv2.CAP_PROP_POS_FRAMES, 30); ok, fr = cap.read(); cap.release()
                if not ok: return {"error": "no frame"}
                img = Image.fromarray(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
            else:
                img = Image.open(full)
            img.thumbnail((480, 480))
            buf = io.BytesIO(); img.convert("RGB").save(buf, "JPEG", quality=82)
            return {"data": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}
        except Exception as e:
            return {"error": str(e)}

    # ---------- Games hub (ui/games/): Retro Games from RetroGames.cc ----------
    def retro_games(self, platform="", page=1, query=""):
        import retrogames
        return retrogames.list_games(platform, page, query)

    def retro_play(self, game_url, image=""):
        import retrogames
        return retrogames.play_url(game_url, image)

    def retro_prepare(self, game, fresh=False):
        import retrogames
        return retrogames.prepare(game, fresh)

    def retro_progress(self, gid, bios="", parent=""):
        import retrogames
        return retrogames.progress(gid, bios, parent)

    def retro_save(self, gid, kind, b64):
        import retrogames
        return retrogames.save_data(gid, kind, b64)

    def retro_load(self, gid, kind):
        import retrogames
        return retrogames.load_data(gid, kind)

    def retro_library(self):
        import retrogames
        return retrogames.library()

    def retro_favorite(self, game, on=True):
        import retrogames
        return retrogames.favorite(game, on)

    def retro_downloads(self):
        import retrogames
        return retrogames.downloads()

    def retro_delete(self, gid="all"):
        import retrogames
        return retrogames.delete_download(gid)

    def retro_fullscreen(self, on=True):
        """the whole screen for a retro game (and back to a normal window when you leave it)"""
        try:
            if bool(on) != getattr(self, "_retro_full", False):
                self._window.toggle_fullscreen()
                self._retro_full = bool(on)
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    # ---------- Games hub: your own games (the ⇅ button), e.g. the Unity game - see skills/mygames.py ----------
    def _game_progress(self):
        last = [0.0]
        def progress(pct, text):                      # the hub's loading bar; at most ~7 updates a second
            now = time.time()
            if pct >= 1 or now - last[0] > 0.15:
                last[0] = now
                self.emit({"type": "game_progress", "pct": round(pct, 3), "text": text})
        return progress

    def _game_done(self, res):
        if res.get("error"):
            self.emit({"type": "game_progress", "error": res["error"]})
        return {**res, **self.games_list()}

    def games_list(self):
        import mygames
        return mygames.list_games()

    def games_add_file(self, path=None):
        """add a game: its .exe (the folder is copied into Vermeil) or a .zip. No path = pick one."""
        import mygames
        if not path:
            paths = self._window.create_file_dialog(_OPEN_DIALOG, file_types=("Games (*.exe;*.zip)", "All files (*.*)"))
            if not paths:
                return None
            path = paths[0] if isinstance(paths, (list, tuple)) else paths
        return self._game_done(mygames.add_path(path, self._game_progress()))

    def games_add_url(self, url):
        import mygames
        return self._game_done(mygames.add_url(url, self._game_progress()))

    def games_launch(self, gid):
        import mygames
        return mygames.launch(gid)

    def games_remove(self, gid):
        import mygames
        return {**mygames.remove(gid), **self.games_list()}

    # ---------- 3D Build Lab (ui/builder/): prompt -> robot / device in 3D, assembled and simulated ----------
    def build_design(self, prompt):
        import builder
        return builder.design(prompt)

    def build_projects(self):
        import builder
        return builder.list_projects()

    def build_save(self, spec):
        import builder
        return builder.save_project(spec)

    def build_load(self, name):
        import builder
        return builder.load_project(name)

    def build_delete(self, name):
        import builder
        return builder.delete_project(name)

    def build_pending(self, item=None):
        """hand a prompt or a build from the Robotics panel to the Build Lab page (it opens and picks it up)"""
        if item is not None:
            self._build_pending = item
            return True
        b, self._build_pending = getattr(self, "_build_pending", None), None
        return b

    # ---------- Settings -> Plugins (install / uninstall features) ----------
    def plugins_status(self):
        import plugins
        plugins.on_event = self.emit
        plugins.warm_folder()                     # which features are in the Vermeil Google Drive folder
        return plugins.status()

    def plugin_install(self, pid):
        import plugins
        plugins.on_event = self.emit
        return plugins.install(pid)

    def plugins_install_many(self, ids):
        import plugins
        plugins.on_event = self.emit
        r = plugins.install_many(list(ids or []))
        return {**r, "status": plugins.status()}

    def plugin_uninstall(self, pid, force=False, remove_pack=False):
        import plugins
        plugins.on_event = self.emit
        return plugins.uninstall(pid, bool(force), bool(remove_pack))

    def plugin_set_link(self, pid, url):
        """the Google Drive link of a feature's pack (Settings -> Plugins)"""
        import plugins
        return plugins.set_link(pid, url)

    def plugins_import_links(self):
        """pick the links.txt from the Vermeil Google Drive folder: every feature's link in one go"""
        import plugins
        paths = self._window.create_file_dialog(_OPEN_DIALOG, file_types=("links.txt (*.txt)",))
        if not paths:
            return None
        path = paths[0] if isinstance(paths, (list, tuple)) else paths
        try:
            with open(path, encoding="utf-8-sig") as f:
                text = f.read(200_000)
        except OSError as e:
            return {"error": str(e)}
        return {"count": plugins.import_links(text)}

    def plugins_use_folder(self, url):
        """the Vermeil Google Drive folder link: finds every feature's .zip in it (Settings -> Plugins)"""
        import plugins
        return plugins.use_folder(url)

    def plugins_first_run_done(self):
        import plugins
        return plugins.finish_first_run()

    # ---------- instant voice/text commands ----------
    def _switch_character(self, name, quiet_fail=False):
        import difflib
        chars = self._characters["characters"]
        names = {c["name"].lower(): c for c in chars}
        match = difflib.get_close_matches((name or "").lower().strip(" .!?"), list(names), n=1, cutoff=0.5)
        if not match:
            if quiet_fail:
                return None              # e.g. "switch to dark mode" - not a character, let the AI handle it
            return f"I don't have a character called {name}. You have: {', '.join(c['name'] for c in chars)}."
        c = names[match[0]]
        self.set_active(c["id"])
        self.emit({"type": "character", "id": c["id"]})
        return f"Switched to {c['name']}."

    def _gym_command(self, action, seconds=None):
        import gym
        if action == "restart_workout":
            msg = gym.reset_day()["message"]
            self.emit({"type": "gym_cmd", "action": "restart_workout"})
            return msg
        if action == "start" and not seconds:
            seconds = gym.DEFAULT_REST
        self.emit({"type": "gym_cmd", "action": action, "seconds": int(seconds or 0)})
        if action == "start":
            return f"Timer started: {int(seconds) // 60}:{int(seconds) % 60:02d}."
        return {"pause": "Timer paused.",
                "resume": "Timer going again.", "restart": "Timer restarted.", "skip": "Skipped the rest."}.get(action, "OK.")

    _NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "ten": 10, "thirty": 30, "forty five": 45,
                  "forty-five": 45, "sixty": 60, "ninety": 90, "a": 1, "an": 1, "half a": 0.5}

    # ---------- calling a character by name ----------
    _GREET = r"(?:hey|hi|hello|yo|oi|ok|okay|uy|psst)"

    def _call_names(self):
        """Every way you can call each character: its name, plus vermi/vermie/bermi... for Vermeil."""
        out = {}
        for c in self._characters["characters"]:
            n = c["name"].lower().strip()
            out[n] = c
            out[n.split()[0]] = out.get(n.split()[0], c)
            if n.startswith("verm"):
                for a in pm.WAKE_ALIASES:
                    out.setdefault(a, c)
        return out

    def _called_character(self, t):
        """'vermi' / 'hey pip' / 'vermi, what's the weather' -> (character, the rest). 'pip install x' is NOT a call."""
        m = re.match(rf"^(?:{self._GREET}\s+)?([a-z]+)([\s,!.?~]*)(.*)$", t)
        if not m:
            return None, t
        word, sep, rest = m.group(1), m.group(2), m.group(3).strip()
        c = self._call_names().get(word)
        if not c:
            return None, t
        greeted = bool(re.match(rf"^{self._GREET}\s", t))
        if rest and not (greeted or "," in sep or len(word) >= 5):
            return None, t
        return c, rest

    _POLITE = re.compile(r"^(?:(?:hey|ok|okay|so|um+|uh+)\s+)?(?:(?:can|could|would|will) you\s+|(?:pl(?:ea)?se?|plz|pls)\s+|kindly\s+)+")

    def _music_quick(self, t):
        """Instant music commands that must never be misunderstood: playlists, liked songs, volume."""
        t = self._POLITE.sub("", t).strip()
        t = re.sub(r"\s+(?:pl(?:ea)?se?|plz|pls|now|for me)$", "", t).strip()
        # ---- volume: "volume to 50", "set the volume 30%", "turn it up", "louder", "mute"
        if re.search(r"\bvol(?:ume)?\b|\blouder\b|\bquieter\b|\bsofter\b|\bturn (?:it|the music|music) (?:up|down)\b|^mute\b|^unmute\b", t) \
                and len(t.split()) <= 9:
            m = re.search(r"(\d{1,3})\s*%?", t)
            if m:
                return self._set_volume(int(m.group(1)))
            if re.search(r"\bunmute\b", t):
                return self._set_volume(50)
            if re.search(r"\bmute\b", t):
                return self._set_volume(0)
            if re.search(r"\bup\b|louder|higher|increase|raise", t):
                return self._set_volume(None, +15)
            if re.search(r"\bdown\b|quieter|softer|lower|decrease|reduce", t):
                return self._set_volume(None, -15)
        if not self._use_spotify():
            return self._my_music_quick(t)
        import spotify
        try:
            # ---- "play my gym playlist", "play the geym playlist", "play playlist Be Limitless", "play any playlist"
            m = re.fullmatch(r"(?:play|put on|start|shuffle|open)\s+(?:(?:a|any|some|one of my|a random|random)\s+playlists?|"
                             r"(?:my|the|a)?\s*(.+?)\s+playlist|playlist\s+(.+))(?:\s+on spotify)?", t)
            if m:
                return spotify.play_playlist(m.group(1) or m.group(2) or "")
            if re.fullmatch(r"(?:play|shuffle|put on)\s+(?:my\s+)?(?:liked|saved|favou?rite)(?:\s+songs)?(?:\s+on spotify)?|play my likes", t):
                return spotify.play_liked()
            if re.fullmatch(r"(?:what(?:'s| is) (?:this|playing|this song|the song)|what song is this|now playing)(?: on spotify)?", t):
                return spotify.now_text()
            if re.fullmatch(r"(?:previous|last|go back(?: a song)?|back)(?: song| track)?", t):
                return spotify.previous_track()
        except spotify.SpotifyError as e:
            return str(e)
        return None

    def _my_music_quick(self, t):
        """Vermeil Music by voice: 'play my gym playlist', 'shuffle my study playlist', 'like this song',
        'add this song to my gym playlist'."""
        import mymusic
        m = re.fullmatch(r"(play|shuffle|put on|start)\s+(?:my\s+|the\s+)?(.+?)\s+playlist|(play|shuffle)\s+playlist\s+(.+)", t)
        if m:
            name = m.group(2) or m.group(4)
            if mymusic.find_playlist(name):
                return mymusic.play_by_name(name, shuffle=(m.group(1) or m.group(3)) == "shuffle")
            return None                                  # not one of yours: let the AI make a mood playlist instead
        if re.fullmatch(r"(?:play|shuffle)\s+my\s+(?:liked|saved|favou?rite)(?:\s+songs)?", t):
            return mymusic.play_playlist("liked", shuffle=True)
        if re.fullmatch(r"(?:like|heart|save)\s+(?:this|the|that)\s+song|i (?:really )?(?:like|love) this song", t):
            return mymusic.like_current()
        m = re.fullmatch(r"(?:add|save|put)\s+(?:this|the|that)\s+song\s+(?:to|in|into)\s+(?:my\s+)?(.+?)(?:\s+playlist)?", t)
        if m and not re.fullmatch(r"(?:favou?rites?|liked(?: songs)?|likes)", m.group(1)):   # favourites: the 'favorite' command below
            return mymusic.voice("add_current", m.group(1))
        return None

    def _play_something(self):
        """'Put on some music' with nothing named: resume, or your liked songs / favourites."""
        import music
        if self._use_spotify():
            import spotify
            try:
                n = spotify.now_playing()
                if n.get("active") and n.get("track") and not n.get("playing"):
                    return spotify.resume()
                return spotify.play_liked()
            except spotify.SpotifyError as e:
                return str(e)
        if f1.is_playing:
            return f"Already playing {f1.now_playing}."
        import mymusic
        if mymusic.library()["liked"]:                      # your Liked Songs in Vermeil Music
            return mymusic.play_playlist("liked", shuffle=True)
        r = music.play_favorites()
        return r if not r.startswith("You don't have favorites") else music.play_mood("chill favourites")

    def _set_volume(self, percent=None, change=0):
        """Spotify's volume while Spotify is playing, otherwise the PC volume."""
        import spotify
        try:
            if self._use_spotify():
                n = spotify.now_playing()
                if n.get("active") and n.get("playing"):
                    cur = n.get("volume") if n.get("volume") is not None else 50
                    return spotify.set_volume(percent if percent is not None else cur + change)
        except spotify.SpotifyError:
            pass
        if percent is None:
            try:
                cur = round(f1._volume_interface().GetMasterVolumeLevelScalar() * 100)
            except Exception:
                cur = 50
            percent = cur + change
        return f1.set_volume(max(0, min(100, int(percent))) or 1) if percent > 0 else self._mute()

    def _mute(self):
        try:
            f1._volume_interface().SetMute(1, None)
            return "Muted."
        except Exception as e:
            return f"Couldn't mute: {e}"

    def _on_wake(self):
        """The wake word 'vermi' always brings Vermeil back."""
        c = self._call_names().get(pm.WAKE_WORD)
        if c and c["id"] != self._characters["active"]:
            self.set_active(c["id"])
            self.emit({"type": "character", "id": c["id"]})

    def _quick_command(self, text):
        t = (text or "").lower().strip(" .!?")
        called, rest = self._called_character(t)
        if called:
            switched = called["id"] != self._characters["active"]
            if switched:
                self.set_active(called["id"])
                self.emit({"type": "character", "id": called["id"]})
            if not rest:
                return f"{called['name']} here! What's up?" if switched else "Yes? I'm listening."
            return self._quick_command(rest)               # "vermi, skip this song" still works instantly
        said = self._voice_command(t)                      # "open the gym", "camera off", "what can I say?"
        if said:
            return said
        import intent
        t = intent.normalize(t) or t                      # "can you put on a song right now" -> "play music"
        if re.fullmatch(r"stop speaking|stop", t):
            pm.stop_speaking()
            return "Okay."
        m = re.fullmatch(r"add note[:\s,-]+(?:that\s+)?(.{3,})", t)
        if m:                                             # "jot this down: buy eggs" - saved instantly, exactly as said
            note = m.group(1).strip()
            i = (text or "").lower().find(note)
            return f1.manage_notes("add", text[i:i + len(note)] if i >= 0 else note)     # keeps your capital letters
        if t == "play music":                             # no song named: play something they like
            return self._play_something()
        music = self._music_quick(t)
        if music:
            return music
        m = re.match(r"^(?:please\s+)?(?:switch|change|swap)\s+(?:to|into)\s+(?:the\s+)?(.+?)(?:\s+character)?$", t)
        if m:
            return self._switch_character(m.group(1), quiet_fail=True)
        if re.fullmatch(r"(emergency stop|stop everything|stop all|cancel everything)", t):
            return self.emergency_stop()
        emotes = {r"(wave|wave at me|say hi)": "wave", r"(dance|do a dance|dance for me|show me your moves)": "dance",
                  r"(jump|hop)": "jump", r"(spin|spin around|do a spin)": "spin", r"(nod|nod your head)": "nod",
                  r"(bow|take a bow)": "bow", r"(shake your head)": "shake", r"(celebrate|party|cheer)": "celebrate",
                  r"(clap|clap your hands)": "clap", r"(laugh)": "laugh", r"(shrug)": "shrug", r"(stretch)": "stretch",
                  r"(yawn)": "yawn", r"(be shy|act shy)": "shy", r"(point)": "point"}
        for pattern, em in emotes.items():
            if re.fullmatch(pattern, t):
                self.emote(em)
                return {"wave": "Hi!", "dance": "Let's dance!", "jump": "Hop!", "spin": "Wheee!", "nod": "Mm-hm.",
                        "bow": "At your service.", "shake": "Nope.", "celebrate": "Yay!", "clap": "Yay, clap clap!",
                        "laugh": "Haha!", "shrug": "Who knows?", "stretch": "That feels good.", "yawn": "*yawn*... sorry!",
                        "shy": "Um... hi.", "point": "Look over there!"}.get(em, "Okay!")
        m = re.fullmatch(r"(?:look|be|make a|show me a|show me your)\s+(happy|sad|surprised|angry|sleepy|thinking|thoughtful)(?: face)?", t)
        if m:
            ex = {"thoughtful": "thinking"}.get(m.group(1), m.group(1))
            self.emit({"type": "expression", "name": ex, "seconds": 4})
            return {"happy": "This is my happy face!", "sad": "Aww.", "surprised": "Oh!", "angry": "I'm angry now!", "sleepy": "So sleepy.", "thinking": "Let me think."}[ex]
        styles = {r"(whisper|whispering)( mode)?|talk (in a )?whisper|whisper to me": "whisper",
                  r"(storyteller|story|dramatic)( mode| voice)?|tell it dramatically": "storyteller",
                  r"(energetic|hype|excited)( mode| voice)?": "energetic", r"(calm|soothing|relaxing)( mode| voice)": "calm",
                  r"(cute)( mode| voice)": "cute", r"(normal|regular|usual) (voice|mode)|talk normally": "normal"}
        for pattern, st in styles.items():
            if re.fullmatch(pattern, t):
                self.save_settings({"voice_style": st})
                self.emit({"type": "settings", "settings": self._settings})
                return {"normal": "Back to my normal voice.", "whisper": "Okay… I'll whisper.",
                        "storyteller": "Gather round… storyteller mode.", "energetic": "Let's go! Energetic mode!",
                        "calm": "Alright. Calm and slow.", "cute": "Cute mode on~"}[st]
        music_cmds = {r"(pause|hold) (the )?(music|song)": "pause", r"(resume|continue|unpause) (the )?(music|song)": "resume",
                      r"(pl(ea)?se? )?(skip|next)( (this|the|that|current|the current))?( (one|song|track))?( (pl(ea)?se?|now))?|next song|"
                      r"change (the )?song": "skip", r"stop (the )?(music|song)": "stop",
                      r"(pl(ea)?se? )?(play|put) (it|that|that song|this|this song|the (new|next|queued) (one|song)) (on )?now( pl(ea)?se?)?|"
                      r"skip to (it|that|that one|that song)( pl(ea)?se?)?|play it already": "play queued now",
                      r"(play (it|that|the song) again|replay( (the|this) song)?|restart (the )?song)": "replay",
                      r"(add|save) (this|the) song to (my )?favou?rites|i love this song": "favorite"}
        for pattern, action in music_cmds.items():
            if re.fullmatch(pattern, t):
                return f1.music_control(action)
        if re.search(r"\b(restart|reset|start over)\b.*\b(workout|training|session|gym)\b", t):
            return self._gym_command("restart_workout")
        if re.search(r"\btimer\b", t) or re.search(r"\b(skip|start|pause|restart|stop|end)\b\s+(?:the\s+|my\s+)?rest\b", t):
            m = re.search(r"(\d+(?:\.\d+)?|one|two|three|four|five|ten|thirty|forty[- ]five|sixty|ninety|half a|an?)\s*"
                          r"(min(?:ute)?s?|sec(?:ond)?s?)", t)
            if m and re.search(r"\b(start|set|timer|give me|rest)\b", t):
                n = float(self._NUM_WORDS.get(m.group(1), m.group(1)) if not m.group(1)[0].isdigit() else m.group(1))
                return self._gym_command("start", round(n * (60 if m.group(2).startswith("min") else 1)))
            for words, action in ((r"\b(restart|reset|again)\b", "restart"), (r"\b(pause|stop|hold)\b", "pause"),
                                  (r"\b(resume|continue|unpause)\b", "resume"), (r"\b(skip|next set|done resting)\b", "skip"),
                                  (r"\b(start)\b", "start")):
                if re.search(words, t):
                    return self._gym_command(action)
        return None

    def _voice_command(self, t):
        """the instant commands of brain/voice_commands.py: open any sidebar feature, mic / camera, the Help list"""
        import plugins
        import voice_commands as vc
        hit = vc.parse(t)
        if not hit:
            return None
        what, f = hit
        if what == "partner_start":
            res = self.partner_start(vc.language_in(t), by_voice=pm.voice_mode)
            if res.get("error"):
                return f"I couldn't start the practice: {res['error']}"
            self.emit({"type": "open_panel", "panel": "study", "tab": "Language"})
            return f"Okay! Let's practice {res['name']}." + ("" if pm.voice_mode else " Answer her in Study, under Sensei.")
        if what == "partner_stop":
            return self.partner_stop()["message"]
        if what in ("power_low", "power_full", "power_auto", "scan"):
            if what == "scan":
                st = self.performance_rescan()
            else:
                self.save_settings({"performance": {"power_low": "low", "power_full": "normal", "power_auto": "auto"}[what]})
                st = self.performance_status()
            return {"low": "Low-end PC mode is on: lighter voice and 3D so everything stays quick.",
                    "normal": "Full power mode.", "high": "Full power mode."}[st["mode"]] + " " + st["why"]
        if what in ("phone_on", "phone_off", "phone_link"):
            st = self.phone_set(what != "phone_off") if what != "phone_link" else self.phone_status()
            self.emit({"type": "open_panel", "panel": "settings", "tab": "phone"})
            if what == "phone_off":
                return "Phone access is off."
            if st.get("error"):
                return st["error"]
            return "Phone access is on. Scan the QR code in Settings, under Phone, with your phone's camera." if st.get("url")                 else "Phone access is starting - the link shows in Settings, under Phone, in a few seconds."
        if what == "share_character":
            res = self.character_export()
            return (res or {}).get("message") or (res or {}).get("error") or "Okay, not saved."
        if what == "import_character":
            res = self.character_import()
            if res and res.get("state"):
                self.emit({"type": "characters_changed"})
            return (res or {}).get("message") or (res or {}).get("error") or "Okay, nothing imported."
        if what == "help":
            self.emit({"type": "open_panel", "panel": "settings", "tab": "help"})
            return "Here's everything you can say to me - it's in Settings, under Help."
        if what == "mic_off":
            self.set_listening(False)                       # (it tells the sidebar itself)
            return "Okay, I'll stop listening. Press Voice in the sidebar when you want me back."
        if what in ("camera_on", "camera_off"):
            on = what == "camera_on"
            if on and not self.set_camera(True):
                return "I can't turn the camera on while privacy mode is on."
            if not on:
                self.set_camera(False)
                self.emit({"type": "camera", "status": "off"})
            return "Camera on - I can see you now!" if on else "Camera off."
        if f["plugin"] and not plugins.is_installed(f["plugin"]):
            self.emit({"type": "open_panel", "panel": "settings", "tab": "plugins"})
            return f"{f['name']} isn't installed yet - you can add it in Settings, under Plugins."
        self.emit({"type": "open_panel", "panel": f["id"]})
        return f"Opening {f['name']}."

    def voice_commands(self):
        """Settings -> Help: what you can say, per sidebar feature"""
        import plugins
        import voice_commands as vc
        return {"features": vc.catalogue(plugins.is_installed)}

    def music(self, action):
        if action in ("skip", "stop", "pause", "resume", "replay", "favorite"):
            return f1.music_control(action)
        return None

    # ---------- screen, hotkeys, emergency stop ----------
    def _screenshot(self):
        """Screenshot of what's BEHIND Vermeil (her window is hidden for a moment)."""
        import pc
        hid = False
        try:
            if self._window and not self._settings.get("screen_include_vermeil"):
                self._window.minimize()
                hid = True
                time.sleep(0.45)
            return pc.screenshot_b64()
        except Exception as e:
            print(f"[screen] {e}")
            return None
        finally:
            if hid:
                try:
                    self._window.restore()
                except Exception:
                    pass

    def _look_at_screen(self, question):
        img = self._screenshot()
        if not img:
            return "I couldn't take a screenshot."
        try:
            r = pm.get_client().chat.completions.create(model=pm.VISION_MODEL, messages=[{"role": "user", "content": [
                {"type": "text", "text": f"This is a screenshot of the user's screen. {question} Be specific and practical. "
                                         f"If there's an error, explain it simply and how to fix it."},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img}"}}]}])
            answer = r.choices[0].message.content or "I couldn't make it out."
            if pm.keep_screens:
                try:
                    import mind
                    mind.archive_screen(img, question, answer)
                except Exception as e:
                    print(f"[screens] {e}")
            return answer
        except Exception as e:
            return f"I couldn't look at the screen: {e}"

    def _register_hotkeys(self):
        if sys.platform == "darwin":                        # macOS only allows global shortcuts for apps run as admin
            return
        try:
            import keyboard
        except Exception:                                   # Linux: needs root - just skip the shortcuts
            return
        keys = {
            "ctrl+alt+v": lambda: self.set_listening(not self._listening),
            "ctrl+alt+h": self._toggle_window,
            "ctrl+alt+space": self._focus_window,
            "ctrl+alt+s": lambda: threading.Thread(target=self._explain_screen, daemon=True).start(),
            "ctrl+alt+esc": self.emergency_stop,
        }
        for combo, fn in keys.items():
            try:
                keyboard.add_hotkey(combo, fn)
            except Exception as e:
                print(f"[hotkey] {combo}: {e}")
        print("[hotkeys] Ctrl+Alt+V voice · Ctrl+Alt+H show/hide · Ctrl+Alt+Space talk · Ctrl+Alt+S explain screen · Ctrl+Alt+Esc stop")

    def _toggle_window(self):
        if not self._window:
            return
        self._hidden = not getattr(self, "_hidden", False)
        (self._window.minimize if self._hidden else self._window.restore)()

    def _focus_window(self):
        if self._window:
            self._hidden = False
            self._window.restore()
            self.emit({"type": "focus_input"})

    def _explain_screen(self):
        answer = self._look_at_screen("Explain what's on the screen and anything the user might need help with. Keep it short.")
        self.emit({"type": "reply", "text": answer})
        if self._settings["speak_replies"]:
            pm.speak(pm.clean_text(answer)[:600])

    # ---------- internet & productivity settings ----------
    def productivity_settings(self):
        import productivity as prod, web
        st = prod._state()
        return {"home_city": st.get("home_city", ""), "ical_url": st.get("ical_url", ""),
                "ical_synced": st.get("ical_synced", ""), "news_topics": web.news_topics(),
                "meeting_recording": bool(prod.recorder.stream)}

    def save_productivity(self, data):
        import productivity as prod, web
        data = data or {}
        st = prod._state()
        if "home_city" in data:
            st["home_city"] = str(data["home_city"]).strip()
        if "ical_url" in data:
            st["ical_url"] = str(data["ical_url"]).strip()
        prod._save_state(st)
        if "news_topics" in data:
            web.set_news_topics(data["news_topics"])
        return self.productivity_settings()

    def find_free_time_ui(self, day=None, minutes=60):
        import productivity as prod
        return prod.free_slots_text(day, minutes)

    def calendar_sync_now(self):
        import productivity as prod
        try:
            return {"message": prod.sync_ical()}
        except Exception as e:
            return {"error": f"Couldn't sync: {e}"}

    def calendar_export(self):
        import productivity as prod
        return {"message": prod.export_ical()}

    def meeting(self, on, title=""):
        import productivity as prod
        if on:
            msg = prod.start_meeting(title)
            self.emit({"type": "meeting", "on": bool(prod.recorder.stream)})
            return {"message": msg}
        self.emit({"type": "meeting", "on": False, "busy": True})
        try:
            return {"message": prod.stop_meeting_text()}
        finally:
            self.emit({"type": "meeting", "on": False})

    def pc_overview(self):
        import pc
        out = {"macros": pc._macros()}
        try:
            out["stats"] = pc.system_stats()
        except Exception as e:
            out["stats_error"] = f"{e} (run: python -m pip install psutil)"
        return out

    def pc_delete_macro(self, name):
        import pc
        return pc.delete_macro(name)

    def pc_crashes(self):
        import pc
        return pc.recent_crashes()

    def emergency_stop(self):
        import pc
        return pc.emergency_stop()

    def _emergency_stop_all(self):
        pm.stop_speaking()
        try:
            f1.music_control("stop")
        except Exception:
            pass
        self.emit({"type": "gym_cmd", "action": "pause"})
        for q in list(self._approvals.values()):      # say "no" to any change waiting for approval
            try:
                q.put(False)
            except Exception:
                pass
        self.emit({"type": "toast", "text": "⛔ Stopped everything."})

    def _on_music(self, info):
        self.emit({"type": "music", **info, "paused": bool(f1.paused_at)})

    # ---------- journal & think ----------
    def journal_list(self, kind=None):
        import mind
        return {"items": mind.list_journal(kind or None), "review": [e["id"] for e in mind.decisions_to_review()]}

    def journal_add(self, item):
        import mind
        item = item or {}
        steps = [s for s in str(item.get("steps", "")).split("\n") if s.strip()]
        return mind.add_journal(item.get("kind", "idea"), item.get("title", ""), item.get("text", ""), steps,
                                item.get("review_in_days") or None)

    def journal_update(self, entry_id, changes):
        import mind
        allowed = {k: v for k, v in (changes or {}).items() if k in ("title", "text", "status", "outcome", "add_step", "toggle_step")}
        return mind.update_journal(entry_id, **allowed)

    def journal_remove(self, entry_id):
        import mind
        return mind.remove_journal(entry_id)

    def think(self, mode, question):
        import mind
        try:
            return mind.think(mode, question)
        except Exception as e:
            return {"error": str(e)}

    def practice_start(self, kind, topic, level=2):
        import mind
        try:
            return mind.practice_start(kind, topic, level)
        except Exception as e:
            return {"error": str(e)}

    def practice_reply(self, sid, text):
        import mind
        try:
            return mind.practice_reply(sid, text)
        except Exception as e:
            return {"error": str(e)}

    def practice_finish(self, sid):
        import mind
        try:
            return mind.practice_finish(sid)
        except Exception as e:
            return {"error": str(e)}

    def practice_list(self):
        import mind
        return mind.practice_list()

    def recall(self, query):
        import mind
        return mind.recall(query, k=10)

    def shutdown(self):
        try:
            import ducking
            ducking.release_all()      # never leave other apps quiet
        except Exception:
            pass
        try:
            import llm
            llm.stop_ollama()          # close the background local AI Vermeil started (frees its memory)
        except Exception:
            pass
        self._listening = False
        pm.voice_mode = False
        self._presence.stop()
        f1.music_control("stop")       # (camera/voice on-off was already remembered when you toggled them)


# ---------- Dungeon Adventure game mode (game/ package, page ui/game/index.html) ----------
GAME_METHODS = ("info", "new", "load", "save", "saves", "delete_save", "state", "action", "cancel", "combat_act", "engage", "travel",
                "talk", "open_treasure", "rest", "search", "use_item", "equip", "unequip", "discard", "compare", "choose_card", "shop",
                "buy", "sell", "reforge", "inn", "preload_list", "recruit", "monster_recruit", "dismiss", "settings", "test", "results", "export", "speak", "vermeil_say")


def _game_api(self):
    if getattr(self, "_game_api_obj", None) is None:
        from game.api import GameAPI
        v = next((c for c in self._characters["characters"] if c.get("id") == "vermeil"), {})
        self._game_api_obj = GameAPI(vermeil_voice=v.get("voice"), vermeil_voice_online=v.get("voice_online"),
                                     companion=lambda: _game_companion(self))
    return self._game_api_obj


GAME_BUILTIN = {"builtin:penguin": ("cute_animated_monsters_penguin", "blob", 1.1)}   # app built-ins -> a game model


def _game_companion(self):
    """the character chosen in the assistant becomes the adventure companion: name, personality, voice and model"""
    c = self._active()
    m = c.get("model") or ""
    size = None
    if m == "anime_girl.glb":
        model, body = "vermeil", "humanoid"
    elif m in GAME_BUILTIN:
        model, body, size = GAME_BUILTIN[m]
    elif m and os.path.exists(os.path.join(MODELS_DIR, m)):
        model, body = "app:" + m, "humanoid"            # the client loads ui/models/<file>
    else:
        model, body = None, "humanoid"                  # sketch figure: the class's own model
    voice = tts.resolve_voice(c.get("voice") or tts.DEFAULT_VOICE)
    if voice.startswith("kokoro:"):
        voice = tts.DEFAULT_VOICE
    return {"id": c["id"], "name": c.get("name") or "Vermeil", "persona": c.get("prompt") or "", "model": model, "body": body,
            "size": size, "gender": "female" if c["id"] in ("vermeil", "pip") else None, "voice": voice,
            "voice_online": c.get("voice_online") or "", "rate": c.get("rate") or "+0%", "pitch": c.get("pitch") or "+0Hz",
            "outfit": c.get("outfit", "mech"), "hair": c.get("hair", "original"),
            "rvc": c.get("rvc") if (c.get("rvc") or {}).get("model") else None}


def _make_game_method(name):
    def method(self, *args):
        return getattr(_game_api(self), name)(*args)
    method.__name__ = f"game_{name}"
    return method


for _n in GAME_METHODS:
    setattr(Api, f"game_{_n}", _make_game_method(_n))


def _game_vermeil_look(self):
    """who waits by the portal: the character chosen in the assistant (name, model) + the outfit/hair Vermeil wears"""
    v = next((c for c in self._characters["characters"] if c.get("id") == "vermeil"), {})
    p = _game_companion(self)
    return {"outfit": v.get("outfit", "mech"), "hair": v.get("hair", "original"), "name": p["name"], "model": p["model"],
            "body": p["body"], "size": p["size"]}


Api.game_vermeil_look = _game_vermeil_look


def main():
    # the game's music and sound effects are made live in the page (Web Audio). Edge's web view only lets a page make
    # sound after a click *inside that page*, and the game is a new page - so allow sound straight away (desktop app)
    flags = os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "")
    if "autoplay-policy" not in flags:
        os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = (flags + " --autoplay-policy=no-user-gesture-required").strip()
    api = Api()
    window = webview.create_window("Vermeil", os.path.join(UI_DIR, "index.html"), js_api=api,
                                   width=1280, height=760, min_size=(900, 560), background_color="#FFFFFF")
    api._window = window
    window.events.closed += api.shutdown
    webview.start(http_server=True, debug=os.environ.get("VERMEIL_DEBUG") == "1")


if __name__ == "__main__":
    main()
