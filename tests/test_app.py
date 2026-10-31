"""
Tests for the new window app (app.py) and face recognition (presence.py).
Run:  python -m unittest discover -s tests -v
No camera, window or internet needed: those parts are replaced with fakes.
"""
import os
import sys
import json
import time
import shutil
import tempfile
import threading
import unittest
from unittest import mock

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
for _name in ("speech_recognition", "sounddevice", "soundfile", "keyboard", "groq", "webview"):
    try:
        __import__(_name)
    except Exception:
        sys.modules[_name] = mock.MagicMock()

import presence  # noqa: E402
import pinakamain as pm  # noqa: E402
import app  # noqa: E402
import tts  # noqa: E402


class FakeModels:
    """Stands in for OpenCV's YuNet + SFace. A 'frame' is a dict saying who is in it."""

    def __init__(self):
        self.det = mock.Mock()
        self.rec = mock.Mock()
        self.det.detect.side_effect = lambda frame: (None, frame["faces"])
        self.rec.alignCrop.side_effect = lambda frame, face: frame["person"]
        self.rec.feature.side_effect = lambda person: np.array(person, dtype=float)


def frame(person=None, x=100):
    """person: a 'face embedding'; None = empty frame."""
    faces = None if person is None else np.array([[x, 50, 80, 80] + [0] * 11], dtype=float)
    return {"faces": faces, "person": person, "shape": (480, 640, 3)}


class FrameDict(dict):
    @property
    def shape(self):
        return self["shape"]


ME = [1.0, 0.2, 0.0, 0.1]
ME_AGAIN = [0.95, 0.25, 0.05, 0.1]
STRANGER = [0.0, 0.1, 1.0, -0.5]


class PresenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p_owner = mock.patch.object(presence, "OWNER_FILE", os.path.join(self.tmp, "owner.json"))
        self.p_owner.start()
        self.events = []
        self.pr = presence.Presence(on_event=self.events.append)
        fm = FakeModels()
        self.pr._models = lambda w, h: (fm.det, fm.rec)

    def tearDown(self):
        self.p_owner.stop()
        shutil.rmtree(self.tmp)

    def run_frame(self, person, t, x=100):
        return self.pr.process_frame(FrameDict(frame(person, x)), t)

    def presence_events(self):
        return [(e["present"], e["who"]) for e in self.events if e["type"] == "presence"]

    def test_enroll_then_recognise_me_and_not_stranger(self):
        self.assertEqual(self.run_frame(ME, 0), "someone")           # nobody taught yet
        self.pr._enroll = {"name": "JP", "samples": [], "need": 3}
        t = 0
        for _ in range(6):
            t += 0.4
            self.run_frame(ME, t)
        self.assertEqual(self.pr.owner_name, "JP")
        with open(presence.OWNER_FILE) as f:
            self.assertEqual(json.load(f)["name"], "JP")
        self.assertEqual(self.run_frame(ME_AGAIN, t + 2), "owner")
        self.assertEqual(self.run_frame(STRANGER, t + 4), "someone")
        done = [e for e in self.events if e["type"] == "enroll" and e["status"] == "done"]
        self.assertEqual(done[0]["name"], "JP")

    def test_leaving_needs_a_few_seconds_without_a_face(self):
        self.run_frame(ME, 0)
        self.run_frame(None, 1)                                      # brief miss: still present
        self.assertTrue(self.pr.state["present"])
        self.run_frame(None, 0 + presence.ABSENT_AFTER + 0.5)
        self.assertFalse(self.pr.state["present"])
        self.assertEqual(self.presence_events(), [(True, "someone"), (False, None)])

    def test_head_tracking_positions_are_throttled(self):
        self.run_frame(ME, 0, x=100)
        for i in range(10):
            self.run_frame(ME, 0.05 * (i + 1), x=100 + i * 10)
        looks = [e for e in self.events if e["type"] == "look"]
        self.assertTrue(1 <= len(looks) <= 4)
        self.assertTrue(all(0 <= e["x"] <= 1 for e in looks))

    def test_camera_problems_are_reported_not_stuck(self):
        """Bug fix: the window used to stay on 'Opening…' forever when the webcam failed."""
        with mock.patch.object(presence, "ensure_models", return_value=True), \
                mock.patch.object(self.pr, "_open_camera", return_value=None):
            self.pr.running = True
            self.pr._loop()
        kinds = [(e["type"], e.get("status")) for e in self.events]
        self.assertIn(("camera", "error"), kinds)
        self.assertEqual(kinds[-1], ("camera", "off"))
        self.assertFalse(self.pr.running)

    def test_saved_owner_is_loaded_and_forgotten(self):
        with open(presence.OWNER_FILE, "w") as f:
            json.dump({"name": "JP", "features": [ME]}, f)
        pr = presence.Presence(on_event=lambda e: None)
        self.assertEqual(pr.owner_name, "JP")
        pr.forget_owner()
        self.assertIsNone(pr.owner_name)
        self.assertFalse(os.path.exists(presence.OWNER_FILE))


@unittest.skipUnless(os.path.exists(presence.DETECT_MODEL), "face model files missing")
class RealModelTests(unittest.TestCase):
    def test_models_load_and_blank_image_has_no_face(self):
        events = []
        pr = presence.Presence(on_event=events.append)
        blank = np.full((480, 640, 3), 255, dtype=np.uint8)
        self.assertIsNone(pr.process_frame(blank, 0))


class AppTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.patches = [
            mock.patch.object(app, "CHARACTERS_FILE", os.path.join(self.tmp, "characters.json")),
            mock.patch.object(app, "SETTINGS_FILE", os.path.join(self.tmp, "settings.json")),
            mock.patch.object(app, "MODELS_DIR", os.path.join(self.tmp, "models")),
            mock.patch.object(app, "ROOM_FILE", os.path.join(self.tmp, "room.json")),
            mock.patch.object(pm, "MEMORY_FILE", os.path.join(self.tmp, "mem.json")),
            mock.patch.object(pm, "ARCHIVE_FILE", os.path.join(self.tmp, "archive.json")),
            mock.patch.object(presence, "OWNER_FILE", os.path.join(self.tmp, "owner.json")),
            mock.patch.object(pm, "speak", lambda text: None),
        ]
        for p in self.patches:
            p.start()
        self.api = app.Api()
        self.api._settings["speak_replies"] = False
        self.events = []
        self.api.emit = self.events.append
        pm.ui_emit = self.events.append

    def tearDown(self):
        for p in self.patches:
            p.stop()
        pm.ui_emit = None
        pm.ask_hook = None
        pm.persona = {"name": "Vermeil", "prompt": "", "memory_key": "user"}
        shutil.rmtree(self.tmp)

    def test_default_characters_and_persona(self):
        st = self.api.get_state()
        self.assertEqual([c["name"] for c in st["characters"]], ["Vermeil", "Pip", "Robo"])
        self.assertEqual(pm.persona["name"], "Vermeil")
        self.assertEqual(pm.persona["memory_key"], "user")     # keeps your old Vermeil chat history

    def test_switch_edit_delete_characters(self):
        self.api.set_active("robot")
        self.assertEqual(pm.persona["name"], "Robo")
        self.assertEqual((pm.VOICE, pm.VOICE_RATE), ("piper:en_US-ryan-medium", "+10%"))
        res = self.api.save_character({"id": None, "name": "Riolu", "prompt": "You are Riolu.",
                                       "voice": "ja-JP-NanamiNeural", "model": "riolu.glb", "flip": True,
                                       "rate": "15", "pitch": "-500"})
        new = next(c for c in res["state"]["characters"] if c["id"] == res["id"])
        self.assertEqual((new["model"], new["flip"], new["memory_key"]), ("riolu.glb", True, res["id"]))
        self.assertEqual((new["voice"], new["rate"], new["pitch"]), ("ja-JP-NanamiNeural", "+15%", "-50Hz"))
        with open(app.CHARACTERS_FILE) as f:
            self.assertEqual(len(json.load(f)["characters"]), 4)
        self.api.set_active(res["id"])
        self.assertEqual(pm.persona["name"], "Riolu")
        self.api.delete_character(res["id"])
        self.assertEqual(self.api.get_state()["active"], "vermeil")
        self.assertEqual(pm.persona["name"], "Vermeil")
        self.api.delete_character("robot")
        self.api.delete_character("pip")
        self.assertIn("error", self.api.delete_character("vermeil"))   # can't delete the last one

    def test_due_alerts_are_announced(self):
        with mock.patch.object(app.f1, "due_alerts", return_value=["Reminder: Call mom"]), \
                mock.patch("pc.notify") as notify, \
                mock.patch.object(pm, "quick_line", return_value="Darling, time to call your mom!"):
            self.api._settings["call_reminders"] = True     # the window rings like a phone call; Answer says it
            self.api.check_alerts()
            self.assertIn({"type": "alert", "text": "Reminder: Call mom"}, self.events)
            self.assertNotIn({"type": "reply", "text": "Darling, time to call your mom!"}, self.events)
            self.api._settings["call_reminders"] = False    # old way: she says it right away
            self.api.check_alerts()
        self.assertIn({"type": "reply", "text": "Darling, time to call your mom!"}, self.events)
        self.assertEqual(notify.call_count, 2)          # a real Windows pop-up during tests would be confusing

    def test_focus_holds_alerts_until_the_break(self):
        with mock.patch.object(app.f1, "due_alerts", side_effect=[["Reminder: Call mom"], []]), \
                mock.patch("pc.notify"), mock.patch.object(pm, "quick_line", return_value="Call mom!"):
            self.api._settings.update(focus_mute=True, call_reminders=True)
            with mock.patch.object(self.api, "_focus_working", return_value=True):
                self.api.check_alerts()
            self.assertNotIn({"type": "alert", "text": "Reminder: Call mom"}, self.events)
            with mock.patch.object(self.api, "_focus_working", return_value=False):
                self.api.check_alerts()                 # the break: it comes now
        self.assertIn({"type": "alert", "text": "Reminder: Call mom"}, self.events)

    def test_browse_inside(self):
        import webview, focus
        with mock.patch.object(webview, "create_window") as win, mock.patch.object(focus, "current", return_value=None):
            self.assertEqual(self.api.browse_inside("hydrology formulas")["url"], "https://duckduckgo.com/?q=hydrology+formulas")
            self.assertEqual(self.api.browse_inside("youtube.com")["url"], "https://youtube.com")
            self.assertIn("my browser", self.api._quick_command("search inside for steel beams"))
        self.assertEqual(win.call_count, 3)
        with mock.patch.object(webview, "create_window") as win, mock.patch.object(focus, "current", return_value={"task": "x"}):
            self.api._settings["focus_sites"] = True
            self.assertIn("blocked", self.api.browse_inside("youtube.com")["error"])
        win.assert_not_called()
        self.assertIn("error", self.api.browse_inside("  "))

    def test_study_round_wiring(self):
        import studylife, tempfile
        from datetime import date
        tmp = tempfile.mkdtemp(prefix="vermeil-sl-")
        self.addCleanup(lambda: __import__("shutil").rmtree(tmp, True))
        review = {"title": "Quiz", "files": ["f1"], "items": [{"statement": "Steel is brittle.", "answer": False}]}
        with mock.patch.object(studylife, "STATE_FILE", os.path.join(tmp, "s.json")), \
                mock.patch.object(app.academic, "save_score", return_value=0), \
                mock.patch.object(app.academic, "get_review", return_value=review), \
                mock.patch.object(app.academic, "list_files", return_value=[{"id": "f1", "name": "Steel.pdf", "subject": "Steel"}]):
            self.api.study_save_score("r1", 0, 1, [False])                     # wrong answers -> mistake notebook
            self.assertEqual(studylife.mistakes()[0]["subject"], "Steel")
            self.assertEqual(self.api.study_exam_report("r1", [False])["grade"], "F")
            studylife.exam_save({"on": True, "exams": [{"subject": "RCD", "date": date.today().isoformat()}]})
            self.api._apply_settings()
            self.assertIn(studylife.EXAM_CHAT_NOTE, pm._extra_notes("hi"))     # lighter chat in exam week
            with mock.patch.object(self.api, "study_files", return_value={}):
                seen = []
                with mock.patch.object(app.academic, "is_media", return_value=False), \
                        mock.patch.object(app.academic, "add_file", side_effect=lambda p, k, s: seen.append(s) or {}), \
                        mock.patch("os.path.isfile", return_value=True):
                    self.api.study_add_paths([r"E:\Hydrology\w9.pdf", r"E:\RCD flexure.pptx"], "lecture", "auto")
            self.assertEqual(seen, ["Hydrology", "RCD"])                     # USB files sorted by subject
        pm.exam_week = None

    def test_planner(self):
        with mock.patch.object(app.f1, "user_data", {"events": [{"title": "Old", "date": "2000-01-01"},
                                                                {"title": "Soon", "date": "2999-01-01"}],
                                                     "reminders": [{"event": "x", "alerted": True}, {"event": "y"}],
                                                     "tasks": [], "schedule": {}, "shopping": {}, "birthdays": []}), \
                mock.patch.object(app.f1, "manage_notes", return_value="No notes found."):
            plan = self.api.get_planner()
        self.assertEqual([e["title"] for e in plan["events"]], ["Soon"])      # past events hidden
        self.assertEqual([r["event"] for r in plan["reminders"]], ["y"])     # already-alerted hidden
        self.assertEqual(plan["notes"], [])

    def test_chat_goes_to_ai_with_active_persona(self):
        with mock.patch.object(pm, "get_vermeil_response", return_value="hi darling") as g:
            self.assertEqual(self.api.chat("hello"), "hi darling")
        self.assertEqual(g.call_args.args[0], "user")
        self.assertIsNone(self.api.chat("   "))

    def test_command_follow_up_question_is_asked_in_the_window(self):
        self.api._command_map = {"weather": lambda: f"weather in {pm.ask('Which city?')}"}
        p = mock.patch.object(pm, "get_vermeil_response", return_value=None)     # AI offline -> keyword command
        p.start(); self.addCleanup(p.stop)
        result = {}
        t = threading.Thread(target=lambda: result.setdefault("r", self.api.chat("what's the weather")))
        t.start()
        for _ in range(100):
            if any(e["type"] == "ask" for e in self.events):
                break
            time.sleep(0.02)
        self.assertEqual([e["text"] for e in self.events if e["type"] == "ask"], ["Which city?"])
        self.assertIsNone(self.api.chat("Manila"))               # answer goes to the waiting question
        t.join(2)
        self.assertEqual(result["r"], "weather in Manila")

    def test_greets_owner_first_time_and_after_long_break_only(self):
        greets = []
        self.api._greet = lambda name: greets.append(name)
        with mock.patch.object(app.threading, "Thread", lambda target, args, daemon: mock.Mock(start=lambda: target(*args))):
            seen = {"type": "presence", "present": True, "who": "owner", "name": "JP"}
            gone = {"type": "presence", "present": False, "who": None, "name": None}
            self.api._on_presence(seen)
            self.api._on_presence(gone)
            self.api._on_presence(seen)                              # came back quickly: no greeting
            self.api._on_presence(gone)
            self.api._owner_gone_since -= app.GREET_AFTER_AWAY + 1
            self.api._on_presence(seen)                              # back after a long break: greet
        self.assertEqual(greets, ["JP", "JP"])

    def test_old_kokoro_voices_are_upgraded(self):
        with open(app.CHARACTERS_FILE, "w") as f:
            json.dump({"active": "vermeil", "characters": [{"id": "vermeil", "name": "Vermeil", "prompt": "p",
                                                             "voice": "af_heart", "model": ""}]}, f)
        api = app.Api()
        self.assertEqual(api.get_state()["characters"][0]["voice"], tts.DEFAULT_VOICE)
        self.assertEqual(pm.VOICE, tts.DEFAULT_VOICE)

    def test_room_clicks(self):
        reacts = []
        self.api._react = reacts.append
        instant = lambda target, args, daemon: mock.Mock(start=lambda: target(*args))
        with mock.patch.object(app.threading, "Thread", instant), \
                mock.patch.object(app.f1, "music_control", return_value="Loaded 6 songs") as music:
            self.api.interact("Radio", "on")
            music.assert_called_with("playlist")
            self.api.interact("Cat", "petted")                 # within cooldown: no second comment
            self.assertEqual(len(reacts), 1)
            self.api._last_reaction -= app.REACTION_COOLDOWN + 1
            self.api.interact("Cat", "petted")
            self.api._last_reaction -= app.REACTION_COOLDOWN + 1
            self.api.interact("Radio", "off")
            music.assert_called_with("stop")
        self.assertIn("radio on", reacts[0])
        self.assertIn("petted the sleeping cat", reacts[1])
        self.assertTrue(any(e.get("text") == "Loaded 6 songs" for e in self.events))

    def test_room_layout_saved_and_loaded(self):
        self.assertIsNone(self.api.load_room())                     # nothing saved yet -> default room
        layout = {"shell": {"wall": "#22332b", "floor": "light wood", "sky": "sunset"},
                  "items": [{"type": "bed", "x": 1, "z": 2, "rot": 0.5}]}
        self.assertTrue(self.api.save_room(layout))
        self.assertEqual(self.api.load_room(), layout)
        self.assertFalse(self.api.save_room({"items": "not a list"}))
        self.assertEqual(self.api.load_room(), layout)

    def test_pip_added_to_old_saves(self):
        with open(app.CHARACTERS_FILE, "w") as f:
            json.dump({"active": "vermeil", "characters": [{"id": "vermeil", "name": "Vermeil", "prompt": "p",
                                                             "voice": "en-US-AriaNeural", "model": ""}]}, f)
        names = [c["name"] for c in app.Api().get_state()["characters"]]
        self.assertEqual(names, ["Vermeil", "Pip"])

    def test_window_preferences_survive_restart(self):
        self.api.save_ui({"collapsed": True, "view": {"pos": [1, 2, 3], "target": [0, 1, 0]}, "junk": 1})
        with mock.patch.object(self.api._presence, "start"):
            self.api.set_camera(True)                              # camera on/off is remembered too
        self.api.set_listening(False)
        again = app.Api()
        st = again.get_state()
        ui = {k: v for k, v in st["ui"].items() if k not in ("own_music_v1", "hidden_panels")}     # (one-time Vermeil Music switch)
        self.assertEqual(ui, {"collapsed": True, "view": {"pos": [1, 2, 3], "target": [0, 1, 0]}})
        self.assertNotIn("junk", st["ui"])
        self.assertTrue(st["settings"]["camera_on_start"])
        self.assertFalse(st["settings"]["listen_on_start"])
        with mock.patch.object(again._presence, "start") as start, mock.patch.object(app.threading, "Thread"):
            again.boot()
            start.assert_called_once()                             # camera comes back on by itself

    def test_chat_history_comes_back(self):
        self.api._memory["user"] = {"conversations": [{"role": "user", "content": "hi"},
                                                      {"role": "assistant", "content": "hello darling"}],
                                    "preferences": {}}
        self.assertEqual(self.api.get_state()["history"], [{"who": "you", "text": "hi", "i": 0}, {"who": "her", "text": "hello darling", "i": 1}])

    def test_learned_preferences_view_and_forget(self):
        with mock.patch.object(pm, "get_client") as gc:
            gc.return_value.chat.completions.create.return_value.choices = [mock.Mock(message=mock.Mock(content="Okay, JP!"))]
            self.api.chat("call me JP, I love matcha")
            system = gc.return_value.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("name: JP", system)
        self.assertIn("loves matcha", system)
        self.assertEqual(self.api.get_preferences(), {"name": "JP", "likes: matcha": "love"})
        self.assertEqual(self.api.forget_preference("name"), {"likes: matcha": "love"})
        self.assertEqual(self.api.forget_preference(None), {})
        self.assertEqual(pm.load_memory()["user"]["preferences"], {})

    def test_settings_saved(self):
        self.api.save_settings({"mirror_look": True, "unknown": True})
        with open(app.SETTINGS_FILE) as f:
            data = json.load(f)
        self.assertTrue(data["mirror_look"])
        self.assertNotIn("unknown", data)

    def test_models_listed(self):
        os.makedirs(app.MODELS_DIR)
        for n in ("a.glb", "b.vrm", "notes.txt"):
            open(os.path.join(app.MODELS_DIR, n), "w").close()
        self.assertEqual(self.api.list_models(), ["a.glb", "b.vrm"])


if __name__ == "__main__":
    unittest.main()


class PathsTests(unittest.TestCase):
    def test_old_files_move_into_data_folder(self):
        import paths
        tmp = tempfile.mkdtemp()
        try:
            with mock.patch.object(paths, "BASE_DIR", tmp), mock.patch.object(paths, "DATA_DIR", os.path.join(tmp, "data")):
                with open(os.path.join(tmp, "characters.json"), "w") as f:
                    f.write("{}")
                os.makedirs(os.path.join(tmp, "data"))
                with open(os.path.join(tmp, "data", "notes.txt"), "w") as f:
                    f.write("new")
                with open(os.path.join(tmp, "notes.txt"), "w") as f:
                    f.write("old")                                  # older than data/notes.txt: kept aside
                os.utime(os.path.join(tmp, "notes.txt"), (1, 1))
                with open(os.path.join(tmp, "data", "room_layout.json"), "w") as f:
                    f.write("stale")
                os.utime(os.path.join(tmp, "data", "room_layout.json"), (1, 1))
                with open(os.path.join(tmp, "room_layout.json"), "w") as f:
                    f.write("fresh")                                # newer than data/: replaces it
                paths.migrate_old_files()
                with open(os.path.join(tmp, "data", "room_layout.json")) as f:
                    self.assertEqual(f.read(), "fresh")
                self.assertTrue(os.path.exists(os.path.join(tmp, "data", "notes.txt.old")))
                self.assertTrue(os.path.exists(os.path.join(tmp, "data", "characters.json")))
                self.assertFalse(os.path.exists(os.path.join(tmp, "characters.json")))
                with open(os.path.join(tmp, "data", "notes.txt")) as f:
                    self.assertEqual(f.read(), "new")
        finally:
            shutil.rmtree(tmp)
