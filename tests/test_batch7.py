"""Batch 7: missions, chat editing, our story, recommendations, screenshot archive."""
import os, sys, json, base64, shutil, tempfile, time, unittest
from datetime import date
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

import llm, missions, relationship, mind, tools  # noqa: E402
import pinakamain as pm  # noqa: E402
import presence  # noqa: E402
import app  # noqa: E402


def msg(content="", calls=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=calls))])


def call(name, args, cid="c1"):
    return SimpleNamespace(id=cid, function=SimpleNamespace(name=name, arguments=json.dumps(args)))


class Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(missions, "FILE", os.path.join(self.tmp, "m.json")),
                  mock.patch.object(relationship, "FILE", os.path.join(self.tmp, "r.json")),
                  mock.patch.object(mind, "SCREENS_DIR", os.path.join(self.tmp, "screens")),
                  mock.patch.object(mind, "SCREENS_FILE", os.path.join(self.tmp, "screens.json")),
                  mock.patch.object(mind, "MEMORY_FILE", os.path.join(self.tmp, "mem.json")),
                  mock.patch.object(mind, "ARCHIVE_FILE", os.path.join(self.tmp, "arch.json"))]
        for p in self.p: p.start()
        missions.on_change = None

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)


class MissionTests(Tmp):
    PLAN = {"title": "Laptop hunt", "steps": [{"do": "Search for laptops", "wait_hours": 0},
                                              {"do": "Check prices again", "wait_hours": 2},
                                              {"do": "Tell the user the best pick", "wait_hours": 0}]}

    def _client(self, replies):
        it = iter(replies)
        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **k: next(it))))

    def test_plan_run_wait_and_finish(self):
        with mock.patch.object(llm, "ask", return_value=self.PLAN):
            m = missions.create("find me a laptop under 50k")
        self.assertEqual([s["text"] for s in m["steps"]], ["Search for laptops", "Check prices again", "Tell the user the best pick"])
        self.assertEqual(missions.due(), [m["id"]])
        # step 1 uses a tool, then reports
        client = self._client([msg("", [call("web_search", {"query": "laptops"})]), msg("Found 3 laptops: A, B, C.")])
        with mock.patch.object(llm, "get_client", return_value=client), \
                mock.patch.object(tools, "run_tool", return_value="results...") as rt:
            m = missions.run_step(m["id"])
        rt.assert_called_once()
        self.assertEqual(m["steps"][0]["status"], "done")
        self.assertIn("Found 3", m["steps"][0]["result"])
        self.assertEqual(missions.due(), [])                                 # step 2 waits 2 hours
        self.assertEqual(missions.due(now=time.time() + 2 * 3600 + 5), [m["id"]])
        missions.run_now(m["id"])                                            # ...unless you say "do it now"
        for _ in range(2):
            with mock.patch.object(llm, "get_client", return_value=self._client([msg("Done that.")])):
                m = missions.run_step(m["id"])
        self.assertEqual(m["status"], "done")
        self.assertIn("Laptop hunt", missions.status_text() + m["title"])

    def test_failure_pause_resume_skip(self):
        with mock.patch.object(llm, "ask", return_value=self.PLAN):
            m = missions.create("x")
        with mock.patch.object(llm, "get_client", return_value=self._client([msg("FAILED: the site was down")])):
            m = missions.run_step(m["id"])
        self.assertEqual((m["status"], m["steps"][0]["status"]), ("failed", "failed"))
        m = missions.skip_step(m["id"])
        self.assertEqual((m["status"], m["steps"][0]["status"]), ("active", "skipped"))
        missions.pause(m["id"])
        self.assertEqual(missions.due(now=time.time() + 99999), [])
        missions.resume(m["id"])
        self.assertEqual(missions.find("laptop")["id"], m["id"])
        self.assertTrue(missions.delete(m["id"]))
        self.assertEqual(missions.list_missions(), [])

    def test_risky_tools_still_ask(self):
        with mock.patch.object(llm, "ask", return_value=self.PLAN):
            m = missions.create("x")
        asked = []
        client = self._client([msg("", [call("close_app", {"name": "chrome"})]), msg("Okay.")])
        with mock.patch.object(llm, "get_client", return_value=client):
            missions.run_step(m["id"], confirm=lambda q: asked.append(q) or False)
        self.assertTrue(asked and "chrome" in asked[0].lower())

    def test_tool_entry_points(self):
        names = [t["function"]["name"] for t in tools.TOOLS]
        for n in ("start_mission", "mission_status", "control_mission", "our_story", "remember_moment", "recommend", "find_screenshot"):
            self.assertIn(n, names)
        with mock.patch.object(llm, "ask", return_value=self.PLAN):
            self.assertIn("3 steps", tools.run_tool("start_mission", '{"goal": "laptops"}'))
        self.assertIn("Pause", tools.run_tool("control_mission", '{"mission": "laptop", "action": "pause"}'))
        self.assertEqual(pm.MAX_TOOL_ROUNDS, 8)


class StoryTests(Tmp):
    def test_milestones_streak_moments(self):
        self.assertIn("first talked", relationship.touch("hi", "hello", today=date(2026, 10, 1)))
        for d in range(2, 8):
            new = relationship.touch("hi", "hey", today=date(2026, 10, d))
        self.assertIn("7 days", new)
        s = relationship.story(today=date(2026, 10, 7))
        self.assertEqual((s["days_known"], s["days_talked"], s["streak"]), (7, 7, 7))
        self.assertEqual(relationship.streak(["2026-10-01", "2026-10-03"], date(2026, 10, 4)), 1)
        relationship.add_moment("You passed your thesis defense!")
        self.assertIn("thesis defense", relationship.note())
        relationship.remove_moment("You passed your thesis defense!")
        self.assertNotIn("thesis", relationship.note())

    def test_scan_moments_once_a_day(self):
        convo = [{"role": "user", "content": f"msg {i}"} for i in range(10)]
        with mock.patch.object(llm, "ask", return_value={"moments": ["You got your first internship offer!"]}) as ask:
            self.assertEqual(relationship.scan_moments(convo), ["You got your first internship offer!"])
            self.assertEqual(relationship.scan_moments(convo), [])
        ask.assert_called_once()
        self.assertTrue(any(t["text"].startswith("You got") for t in relationship.story()["timeline"]))


class RecommendAndScreensTests(Tmp):
    def test_recommend_uses_likes(self):
        with mock.patch.object(llm, "ask", return_value={"items": [{"title": "Your Name", "why": "you like anime"}]}) as ask:
            items = mind.recommend("anime", prefs={"likes: matcha": "love"})
        self.assertEqual(items[0]["title"], "Your Name")
        self.assertIn("matcha", ask.call_args.args[0])

    def test_screens_are_saved_and_searchable(self):
        jpg = base64.b64encode(b"\xff\xd8fakejpeg").decode()
        name = mind.archive_screen(jpg, "why is this error happening", "ModuleNotFoundError: no module named psutil")
        self.assertTrue(os.path.exists(mind.screen_path(name)))
        hits = mind.find_screens("psutil error")
        self.assertEqual(hits[0]["file"], name)
        with mock.patch.object(mind, "MAX_SCREENS", 2):
            for i in range(3):
                mind.archive_screen(jpg, f"q{i}", "t")
        self.assertEqual(len(mind.list_screens()), 2)
        self.assertEqual(len(os.listdir(mind.SCREENS_DIR)), 2)        # old files deleted too


class ChatEditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.patches = [mock.patch.object(app, n, os.path.join(self.tmp, f)) for n, f in
                        (("CHARACTERS_FILE", "c.json"), ("SETTINGS_FILE", "s.json"), ("MODELS_DIR", "models"), ("ROOM_FILE", "r.json"))]
        self.patches += [mock.patch.object(pm, "MEMORY_FILE", os.path.join(self.tmp, "mem.json")),
                         mock.patch.object(pm, "ARCHIVE_FILE", os.path.join(self.tmp, "a.json")),
                         mock.patch.object(presence, "OWNER_FILE", os.path.join(self.tmp, "o.json")),
                         mock.patch.object(presence, "PEOPLE_FILE", os.path.join(self.tmp, "p.json"))]
        for p in self.patches: p.start()
        self.api = app.Api()
        self.api.emit = lambda e: None

    def tearDown(self):
        for p in self.patches: p.stop()
        pm.persona = {"name": "Vermeil", "prompt": "", "memory_key": "user"}
        shutil.rmtree(self.tmp)

    def test_edit_and_delete_messages(self):
        convo = self.api._convo()
        convo[:] = [{"role": "user", "content": "I hate tomatoes"}, {"role": "assistant", "content": "Noted!"},
                    {"role": "user", "content": "hi"}, {"role": "assistant", "content": "hey"}]
        h = self.api.chat_edit(0, "I love tomatoes")
        self.assertEqual(h[0], {"who": "you", "text": "I love tomatoes", "i": 0})
        h = self.api.chat_delete(0)                       # takes her reply with it
        self.assertEqual([m["text"] for m in h], ["hi", "hey"])
        self.assertEqual([m["i"] for m in h], [0, 1])
        with open(pm.MEMORY_FILE, encoding="utf-8") as f:
            saved = json.load(f)
        self.assertEqual(len(saved["user"]["conversations"]), 2)

    def test_approval_waits_for_the_window(self):
        import threading
        out = []
        t = threading.Thread(target=lambda: out.append(self.api._approve("send an email to Mia")))
        self.api._settings["desktop_notifications"] = False
        events = []
        self.api.emit = events.append
        t.start()
        for _ in range(50):
            if events:
                break
            time.sleep(0.02)
        self.assertEqual(events[0]["type"], "approval")
        self.assertIn("send an email", events[0]["text"])
        self.api.approve(events[0]["id"], True)
        t.join(2)
        self.assertEqual(out, [True])


if __name__ == "__main__":
    unittest.main()
