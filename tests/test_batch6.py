"""Batch 6: vision (people she knows, attention, privacy, gestures, OCR) and the living character (emotes, group chat)."""
import os, sys, json, queue, shutil, subprocess, tempfile, unittest
from types import SimpleNamespace
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
for _name in ("speech_recognition", "sounddevice", "soundfile", "keyboard", "groq", "webview"):
    try:
        __import__(_name)
    except Exception:
        sys.modules[_name] = mock.MagicMock()

import numpy as np  # noqa: E402
import presence, academic, tools, llm  # noqa: E402
import pinakamain as pm  # noqa: E402
import app  # noqa: E402


def _reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class PeopleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(presence, "OWNER_FILE", os.path.join(self.tmp, "o.json")),
                  mock.patch.object(presence, "PEOPLE_FILE", os.path.join(self.tmp, "p.json"))]
        for p in self.p: p.start()
        self.events = []
        self.pr = presence.Presence(on_event=self.events.append)
        self.pr.start = lambda: None

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)

    def _teach(self, name, vec, owner):
        self.pr.start_enroll(name, samples=2, owner=owner, relation="" if owner else "sister")
        for _ in range(2):
            self.pr._add_enroll_sample(vec)

    def test_owner_and_known_people(self):
        me, mia, stranger = np.eye(8)[0], np.eye(8)[1], np.eye(8)[2]
        self._teach("JP", me, True)
        self._teach("Mia", mia, False)
        self.assertEqual(self.pr.owner["name"], "JP")
        self.assertEqual(self.pr.known_people(), [{"name": "Mia", "relation": "sister"}])
        self.assertEqual(self.pr.identify(me), "owner")
        self.assertEqual(self.pr.identify(mia), "known")
        self.assertEqual(self.pr._who_name, "Mia")
        self.assertEqual(self.pr.identify(stranger), "someone")
        done = [e for e in self.events if e.get("status") == "done"]
        self.assertEqual([d["owner"] for d in done], [True, False])
        # remembered after a restart, and can be forgotten
        again = presence.Presence(on_event=lambda e: None)
        self.assertEqual(again.identify(mia), "known")
        self.assertTrue(again.forget_person("Mia"))
        self.assertEqual(again.known_people(), [])

    def test_attention_from_face_points(self):
        # YuNet face: x, y, w, h, right eye (x,y), left eye (x,y), nose (x,y), ...
        straight = [100, 100, 100, 100, 125, 130, 175, 130, 150, 150, 0, 0, 0, 0, 0.9]
        turned = [100, 100, 100, 100, 125, 130, 150, 130, 160, 150, 0, 0, 0, 0, 0.9]
        self.pr._update_attention(straight, 0); self.pr._update_attention(straight, 2)
        self.assertTrue(self.pr.attention)
        self.pr._update_attention(turned, 3); self.pr._update_attention(turned, 3.5)
        self.assertTrue(self.pr.attention)                         # not yet: needs to last a moment
        self.pr._update_attention(turned, 5)
        self.assertFalse(self.pr.attention)
        self.assertEqual([e["looking"] for e in self.events if e["type"] == "attention"], [True, False])


class AppVisionTests(unittest.TestCase):
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
            mock.patch.object(presence, "PEOPLE_FILE", os.path.join(self.tmp, "people.json")),
            mock.patch.object(pm, "speak", lambda *a, **k: None),
        ]
        for p in self.patches: p.start()
        self.api = app.Api()
        self.api._settings["speak_replies"] = False
        self.events = []
        self.api.emit = self.events.append

    def tearDown(self):
        for p in self.patches: p.stop()
        pm.persona = {"name": "Vermeil", "prompt": "", "memory_key": "user"}
        shutil.rmtree(self.tmp)

    def test_privacy_mode_blocks_the_camera(self):
        self.api._presence.start = mock.Mock()
        self.api.save_settings({"privacy_mode": True})
        self.assertFalse(self.api.set_camera(True))
        self.api._presence.start.assert_not_called()
        self.assertFalse(self.api.enroll_face("Mia", False, "sister"))
        self.assertIsNone(pm.vision_source())                       # "what am I holding?" can't look either
        self.assertIn("camera", self.api.check_gesture()["error"].lower())
        self.api.save_settings({"privacy_mode": False})
        self.assertIsNot(pm.vision_source, None)

    def test_greets_known_people_once(self):
        self.api._settings.update(greet_on_sight=True, quiet_mode=False)
        with mock.patch.object(self.api, "_greet_other") as greet, mock.patch.object(app.threading, "Thread") as T:
            T.return_value.start = lambda: T.call_args.kwargs["target"](*T.call_args.kwargs["args"])
            for _ in range(2):
                self.api._on_presence({"type": "presence", "present": True, "who": "known", "name": "Mia"})
        greet.assert_called_once_with("Mia", "")

    def test_emote_and_expression_commands(self):
        self.assertIn("dance", self.api._quick_command("dance for me").lower())
        self.assertIn({"type": "emote", "name": "dance"}, self.events)
        self.api._quick_command("take a bow")
        self.assertIn({"type": "emote", "name": "bow"}, self.events)
        self.api._quick_command("look surprised")
        self.assertIn({"type": "expression", "name": "surprised", "seconds": 4}, self.events)
        self.assertIsNone(self.api._quick_command("what should I eat"))   # normal talk is not a command

    def test_character_action_tool(self):
        names = [t["function"]["name"] for t in tools.TOOLS]
        for n in ("character_action", "group_conversation", "check_gesture", "read_text_in_image"):
            self.assertIn(n, names)
        self.api._character_action("celebrate")
        self.api._character_action("sad")
        self.assertIn({"type": "emote", "name": "celebrate"}, self.events)
        self.assertIn({"type": "expression", "name": "sad", "seconds": 5}, self.events)

    def test_group_chat_takes_turns(self):
        chars = self.api._characters["characters"][:2]
        lines = iter(["Hi Pip!", f"{chars[1]['name']}: Hello yourself.", "Bye!"])
        with mock.patch.object(llm, "ask", side_effect=lambda *a, **k: next(lines)):
            self.api._run_group_chat("pizza", chars, 3)
        said = [(e["speaker"], e["text"]) for e in self.events if e["type"] == "group_line"]
        self.assertEqual(said, [(chars[0]["name"], "Hi Pip!"), (chars[1]["name"], "Hello yourself."), (chars[0]["name"], "Bye!")])
        self.assertEqual(self.events[-1], {"type": "group_done"})
        self.api._characters["characters"] = chars[:1]
        self.assertIn("at least two", self.api.group_chat("pizza")["error"])

    def test_gestures_answer_and_stop(self):
        self.api._waiting_for_answer = True
        self.api._answers = queue.Queue()
        self.api._react_to_gesture("thumbs_up")
        self.assertEqual(self.api._answers.get_nowait(), "yes")
        with mock.patch.object(pm, "stop_speaking") as stop:
            self.api._react_to_gesture("stop")
        stop.assert_called_once()
        self.api._presence.snapshot = lambda: "abc"
        fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **k: _reply('{"gesture": "wave"}'))))
        with mock.patch.object(llm, "get_client", return_value=fake):
            self.assertEqual(self.api.check_gesture(), {"gesture": "wave"})
        self.assertIn({"type": "emote", "name": "wave"}, self.events)


class OcrTests(unittest.TestCase):
    def test_photo_of_notes_goes_into_the_library(self):
        tmp = tempfile.mkdtemp()
        try:
            img = os.path.join(tmp, "notes.png")
            try:
                from PIL import Image
                Image.new("RGB", (40, 30), "white").save(img)
            except ImportError:
                open(img, "wb").write(b"\x89PNG fake")
            fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
                create=mock.Mock(return_value=_reply("Mitochondria\n- powerhouse of the cell")))))
            with mock.patch.object(academic, "_client", return_value=fake):
                self.assertEqual(academic.extract_pages(img), ["Mitochondria\n- powerhouse of the cell"])
                msg = fake.chat.completions.create.call_args.kwargs["messages"][0]["content"]
                self.assertTrue(msg[1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
                with mock.patch("pc._safe_path", side_effect=lambda p: p):
                    self.assertIn("Mitochondria", tools.run_tool("read_text_in_image", json.dumps({"path": img})))
        finally:
            shutil.rmtree(tmp)


class ArchivistTests(unittest.TestCase):
    def test_recall_searches_study_files(self):
        import mind
        with mock.patch.object(academic, "list_files", return_value=[{"id": "a1", "name": "bio.pdf", "added": "2026-10-01 09:00"}]), \
                mock.patch.object(academic, "file_pages", return_value=["Photosynthesis happens in the chloroplast."]):
            hits = mind.recall("where does photosynthesis happen")
        self.assertTrue(any(h["source"] == "file bio.pdf p.1" for h in hits))


@unittest.skipUnless(shutil.which("node"), "node not installed")
class LifeJsTests(unittest.TestCase):
    def test_faces_outfits_scenes(self):
        ui = os.path.join(os.path.dirname(HERE), "ui", "life.js")
        script = f"""
        import {{ moodOf, autoOutfit, sceneFor, idlePlan }} from {json.dumps("file://" + ui)};
        const out = {{
          moods: ["That's amazing!", "I'm so sorry.", "Hmm, let me think.", "Whoa, really?!", "Is it Tuesday?", "Okay."].map(moodOf),
          dec: autoOutfit({{ date: new Date(2026, 11, 10) }}).hat,
          bday: autoOutfit({{ date: new Date(2026, 5, 1), birthday: true }}).hat,
          gym: autoOutfit({{ date: new Date(2026, 5, 1), gym: true }}).hat,
          study: autoOutfit({{ date: new Date(2026, 5, 1), study: true }}).glasses,
          music: autoOutfit({{ date: new Date(2026, 5, 1), music: true }}).hat,
          halloween: autoOutfit({{ date: new Date(2026, 9, 30) }}).hat,
          scenes: [sceneFor({{ focus: true }}), sceneFor({{ study: true }}), sceneFor({{ voiceStyle: "storyteller" }}), sceneFor({{}})],
          night: idlePlan(2)[0][0], day: idlePlan(14).map((p) => p[0]),
        }};
        console.log(JSON.stringify(out));
        """
        r = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertEqual(out["moods"], ["happy", "sad", "thinking", "surprised", "thinking", "neutral"])
        self.assertEqual((out["dec"], out["bday"], out["gym"], out["music"], out["halloween"]), ("santa", "party", "headband", "headphones", "witch"))
        self.assertTrue(out["study"])
        self.assertEqual(out["scenes"], ["focus", "study", "story", None])
        self.assertEqual(out["night"], "bed")
        self.assertIn("desk", out["day"])


if __name__ == "__main__":
    unittest.main()
