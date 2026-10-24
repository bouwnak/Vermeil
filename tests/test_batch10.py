"""Round 10: play-now music, gym clear history, calling characters by name, the coding helper building projects."""
import os, sys, json, shutil, tempfile, unittest
from types import SimpleNamespace as NS
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

import f1, gym, coder, tools  # noqa: E402
import pinakamain as pm  # noqa: E402
import app  # noqa: E402


class PlayNowTests(unittest.TestCase):
    def setUp(self):
        f1._clear_queue()
        self.proc = mock.Mock(pid=1)
        self.proc.poll.return_value = None
        f1.current_process, f1.is_playing, f1.paused_at, f1.restart_at = self.proc, True, None, None
        self.p = [mock.patch.object(f1, "_ensure_player"), mock.patch.object(f1, "_save_queue"),
                  mock.patch.object(f1, "use_external", lambda: False)]          # the YouTube player, never Spotify
        for p in self.p: p.start()

    def tearDown(self):
        for p in self.p: p.stop()
        f1._clear_queue()
        f1.current_process, f1.is_playing = None, False

    def test_new_song_plays_right_away(self):
        f1.music_queue.put("Old queued song")
        self.assertEqual(f1.music_control("play", "Feel It Still"), "Playing 'Feel It Still' now.")
        self.proc.kill.assert_called_once()                                        # current song stopped
        self.assertEqual(list(f1.music_queue.queue), ["Feel It Still", "Old queued song"])   # jumped the queue

    def test_queue_when_asked_and_play_queued_now(self):
        self.assertIn("end of the queue", f1.music_control("play", "Song B", "later"))
        self.assertIn("will play next", f1.music_control("play", "Song A", "next"))
        self.assertEqual(list(f1.music_queue.queue), ["Song A", "Song B"])
        self.proc.kill.assert_not_called()
        self.assertEqual(f1.music_control("play queued now"), "Playing 'Song B' now.")     # the newest request
        self.assertEqual(list(f1.music_queue.queue), ["Song B", "Song A"])
        self.proc.kill.assert_called_once()

    def test_skip_wakes_a_paused_song_first(self):
        f1.paused_at = 123.0
        ps = mock.Mock()
        with mock.patch.dict(sys.modules, {"psutil": mock.Mock(Process=mock.Mock(return_value=ps))}):
            self.assertIn("Skipped", f1.music_control("skip"))
        ps.resume.assert_called_once()
        self.proc.kill.assert_called_once()

    def test_mood_playlist_starts_first_and_queues_rest(self):
        import music, llm
        calls = []
        with mock.patch.object(llm, "ask", return_value={"songs": ["A", "B", "C"]}), \
                mock.patch.object(f1, "music_control", side_effect=lambda *a: calls.append(a) or "ok"):
            music.play_mood("gym")
        self.assertEqual(calls, [("play", "A", "now"), ("play", "B", "later"), ("play", "C", "later")])


class GymClearTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(gym, "LOG_FILE", os.path.join(self.tmp, "log.json")),
                  mock.patch.object(gym, "BACKUP_FILE", os.path.join(self.tmp, "bak.json"))]
        for p in self.p: p.start()

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)

    def test_clear_and_undo(self):
        gym._write(gym.LOG_FILE, {"2026-10-19": {"sets": [1]}, "2026-10-20": {"sets": [2]}})
        self.assertEqual(gym.clear_history(), {"cleared": 2})
        self.assertEqual(gym._log(), {})
        gym._write(gym.LOG_FILE, {"2026-10-21": {"sets": [3]}})                 # trained again after clearing
        self.assertEqual(gym.undo_clear_history(), {"restored": 2})
        self.assertEqual(sorted(gym._log()), ["2026-10-19", "2026-10-20", "2026-10-21"])
        self.assertEqual(gym.undo_clear_history(), {"restored": 0})


class CallByNameTests(unittest.TestCase):
    def setUp(self):
        self.api = app.Api.__new__(app.Api)
        self.api._characters = {"active": "p", "characters": [{"id": "v", "name": "Vermeil"}, {"id": "p", "name": "Pip"}, {"id": "r", "name": "Robo"}]}
        self.events = []
        self.api.emit = self.events.append
        self.api._settings = {}
        self.api.set_active = lambda cid: self.api._characters.__setitem__("active", cid)

    def test_saying_vermi_switches(self):
        self.assertIn("Vermeil here", self.api._quick_command("vermi"))
        self.assertEqual(self.api._characters["active"], "v")
        self.assertEqual(self.api._quick_command("Vermi!"), "Yes? I'm listening.")
        self.api._quick_command("hey pip")
        self.assertEqual(self.api._characters["active"], "p")

    def test_name_with_a_request(self):
        self.assertIsNone(self.api._quick_command("vermi what's the weather"))   # switches, then the AI answers
        self.assertEqual(self.api._characters["active"], "v")
        with mock.patch.object(app.f1, "music_control", return_value="Skipped.") as mc:
            self.assertEqual(self.api._quick_command("pip, skip this song"), "Skipped.")
        self.assertEqual((self.api._characters["active"], mc.call_args.args[0]), ("p", "skip"))

    def test_not_a_call(self):
        self.assertIsNone(self.api._quick_command("pip install numpy"))
        self.assertIsNone(self.api._quick_command("robo is cool"))
        self.assertEqual(self.api._characters["active"], "p")

    def test_wake_word_brings_vermeil_back(self):
        self.api._on_wake()
        self.assertEqual(self.api._characters["active"], "v")
        self.assertEqual(self.events[-1], {"type": "character", "id": "v"})


class CoderBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = mock.patch.object(coder, "PROJECTS_DIR", os.path.join(self.tmp, "Vermeil Projects"))
        self.p.start()

    def tearDown(self):
        self.p.stop()
        shutil.rmtree(self.tmp)

    def _client(self, steps):
        it = iter(steps)

        def create(**kw):
            name, args = next(it)
            if name is None:
                return NS(choices=[NS(message=NS(content=args, tool_calls=None))])
            return NS(choices=[NS(message=NS(content="", tool_calls=[NS(id="c", function=NS(name=name, arguments=json.dumps(args)))]))])
        return NS(chat=NS(completions=NS(create=create)))

    def test_builds_a_new_project_from_nothing(self):
        asked = []
        agent = coder.CodingAgent(approve=lambda kind, d: asked.append(kind) or True)
        steps = [("new_project", {"name": "Calculator"}),
                 ("write_files", {"files": [{"path": "main.py", "content": "print(2 + 3)\n"},
                                            {"path": "README.md", "content": "Run: python main.py\n"}]}),
                 ("run_command", {"command": f'"{sys.executable}" main.py'}),
                 (None, "Built a calculator. Run: python main.py")]
        with mock.patch.object(pm, "get_client", return_value=self._client(steps)):
            reply = agent.ask("make me a calculator")
        self.assertIn("Run: python main.py", reply)
        self.assertTrue(agent.is_own_project())
        self.assertTrue(os.path.exists(os.path.join(agent.workspace, "main.py")))
        self.assertEqual(asked, ["run"])                                     # files written freely, running asked

    def test_users_own_folder_always_asks(self):
        mine = os.path.join(self.tmp, "my_project")
        os.makedirs(mine)
        asked = []
        agent = coder.CodingAgent(workspace=mine, approve=lambda kind, d: asked.append(kind) or False)
        self.assertIn("rejected", agent.write_files([{"path": "a.py", "content": "x = 1"}]))
        self.assertEqual(asked, ["write"])
        self.assertFalse(os.path.exists(os.path.join(mine, "a.py")))

    def test_chat_tool_exists(self):
        self.assertIn("create_code", [t["function"]["name"] for t in tools.pick("make me a python calculator")])


if __name__ == "__main__":
    unittest.main()
