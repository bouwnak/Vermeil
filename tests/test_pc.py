"""Batch 2: computer control (Windows parts are simulated)."""
import os, sys, json, time, shutil, tempfile, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import pc, tools  # noqa: E402


class FilesTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.home, "Documents", "thesis"))
        os.makedirs(os.path.join(self.home, "Downloads"))
        for rel in ("Documents/thesis/Chapter 3 draft.docx", "Documents/thesis/survey results.xlsx",
                    "Downloads/old chapter 3.pdf", "Downloads/song.mp3"):
            open(os.path.join(self.home, rel), "w").close()
        old = os.path.join(self.home, "Downloads/old chapter 3.pdf")
        os.utime(old, (time.time() - 90 * 86400,) * 2)
        self.p = mock.patch.object(pc, "HOME", self.home)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        shutil.rmtree(self.home)

    def test_find_by_words_type_and_age(self):
        self.assertEqual({h["name"] for h in pc.find_files("chapter 3")}, {"Chapter 3 draft.docx", "old chapter 3.pdf"})
        self.assertEqual([h["name"] for h in pc.find_files("chapter", "word")], ["Chapter 3 draft.docx"])
        self.assertEqual([h["name"] for h in pc.find_files("chapter", days=30)], ["Chapter 3 draft.docx"])
        self.assertIn("song.mp3", pc.find_files_text(kind="music"))

    def test_move_rename_folder_only_inside_home(self):
        src = os.path.join(self.home, "Downloads/song.mp3")
        self.assertIn("Moved", pc.move_file(src, os.path.join(self.home, "Music")))
        self.assertTrue(os.path.exists(os.path.join(self.home, "Music/song.mp3")))
        self.assertIn("Renamed", pc.rename_file(os.path.join(self.home, "Music/song.mp3"), "fav.mp3"))
        with self.assertRaises(ValueError):
            pc.move_file(os.path.join(self.home, "Music/fav.mp3"), "/etc")
        self.assertEqual(pc.rename_file(os.path.join(self.home, "Music/fav.mp3"), "../x.mp3"), "Can't rename that.")


class AppsAndSafetyTests(unittest.TestCase):
    def test_open_app_from_start_menu_with_typos(self):
        with mock.patch.object(pc, "IS_WIN", True), mock.patch.object(pc, "_start_menu_shortcuts",
                return_value={"roblox studio": "C:/x/Roblox Studio.lnk", "spotify": "C:/x/Spotify.lnk"}), \
                mock.patch.object(pc.os, "startfile", create=True) as start:
            self.assertEqual(pc.open_app("roblox studoi"), "Opened Roblox Studio.")
            start.assert_called_with("C:/x/Roblox Studio.lnk")

    def test_close_app_refuses_protected_and_terminates(self):
        self.assertIn("won't close", pc.close_app("explorer"))
        proc = mock.Mock(info={"name": "Discord.exe"})
        with mock.patch.object(pc, "_processes", return_value=[proc]):
            self.assertIn("Closed discord", pc.close_app("discord"))
        proc.terminate.assert_called_once()

    def test_risky_tools_ask_first(self):
        for name, args in (("close_app", {"name": "discord"}), ("type_text", {"text": "hi"}),
                           ("press_keys", {"keys": "ctrl+s"}), ("mouse_click", {"x": 1, "y": 2}),
                           ("move_file", {"path": "a", "to_folder": "b"})):
            asked = []
            out = tools.run_tool(name, json.dumps(args), confirm=lambda q: asked.append(q) or False)
            self.assertEqual(out, "The user said no, so nothing was done.", name)
            self.assertTrue(asked, name)

    def test_macros_save_run_and_stop(self):
        tmp = tempfile.mkdtemp()
        with mock.patch.object(pc, "MACROS_FILE", os.path.join(tmp, "m.json")):
            self.assertIn("Unknown steps", pc.save_macro("x", [{"tool": "format_disk"}]))
            self.assertIn("Saved", pc.save_macro("Study Mode", [{"tool": "open_app", "args": {"name": "notepad"}},
                                                                 {"tool": "set_volume", "args": {"percent": 30}, "wait": 0}]))
            self.assertIn("study mode", pc.list_macros())
            calls = []
            with mock.patch.object(tools, "run_tool", side_effect=lambda n, a, confirm=None: calls.append(n) or "ok"):
                out = pc.run_macro("study mode")
            self.assertEqual(calls, ["open_app", "set_volume"])
            self.assertIn("2. set_volume: ok", out)
            pc.stop_event.set()
            with mock.patch.object(tools, "run_tool", return_value="ok"):
                pass
            pc.stop_event.clear()
            self.assertEqual(pc.delete_macro("study mode"), "Deleted.")
        shutil.rmtree(tmp)

    def test_emergency_stop_runs_hooks(self):
        hit = []
        with mock.patch.object(pc, "on_emergency", [lambda: hit.append(1)]):
            self.assertEqual(pc.emergency_stop(), "Stopped everything.")
        self.assertEqual(hit, [1])
        self.assertTrue(pc.stop_event.is_set())
        pc.stop_event.clear()

    def test_system_stats_shape(self):
        s = pc.system_stats()
        self.assertIn("cpu_percent", s)
        self.assertIn("RAM", pc.stats_text())


class ScreenWordsTests(unittest.TestCase):
    def test_screen_questions_use_a_screenshot(self):
        import pinakamain as pm
        for t in ("what's on my screen?", "explain this error", "can you read my screen", "look at this page"):
            self.assertTrue(pm._SCREEN.search(t), t)
        self.assertFalse(pm._SCREEN.search("what am I holding?"))


if __name__ == "__main__":
    unittest.main()
