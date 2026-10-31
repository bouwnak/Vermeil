"""UniMate without Blender, whole-reply voice, downward dropdowns, rooms on both sides, sad lines, one Kitchen panel"""
import os, sys, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
for _name in ("speech_recognition", "sounddevice", "soundfile", "keyboard", "groq", "webview"):
    try:
        __import__(_name)
    except Exception:
        sys.modules[_name] = mock.MagicMock()
import animate  # noqa: E402
import plugins  # noqa: E402
import rvc  # noqa: E402
import voice_emotion as ve  # noqa: E402
import pinakamain as pm  # noqa: E402


def read(*p):
    with open(os.path.join(ROOT, *p), encoding="utf-8") as f:
        return f.read()


class UniMateShimTests(unittest.TestCase):
    def test_blender_stand_in(self):
        folder = animate._blender_shim()
        path = os.path.join(folder, "blender")
        with open(path, "rb") as f:
            text = f.read().decode("utf-8")
        self.assertNotIn("\r\n", text)                      # bash needs Unix line ends
        self.assertTrue(text.startswith("#!/bin/bash"))
        self.assertIn('exec "', text)
        self.assertNotIn("{py}", text)
        self.assertIn("_blender_shim()", read("skills", "animate.py").split("def animate(")[1])


class UniMateGitTests(unittest.TestCase):
    """no Git for Windows on the PC: UniMate uses the portable Git the app downloads"""
    def test_portable_git_is_found(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            for sub, exe in (("bin", "bash.exe"), ("cmd", "git.exe")):
                os.makedirs(os.path.join(d, sub))
                open(os.path.join(d, sub, exe), "w").close()
            with mock.patch.object(animate, "PORTABLE_GIT", d), mock.patch("shutil.which", return_value=None), \
                    mock.patch("os.path.exists", lambda p: p.startswith(d) and os.path.isfile(p)):
                self.assertEqual(animate._bash(), os.path.join(d, "bin", "bash.exe"))
                self.assertEqual(animate._git(), os.path.join(d, "cmd", "git.exe"))

    def test_damaged_download_is_refused(self):
        import autosetup
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            fake = lambda url, path: open(path, "wb").write(b"not git")
            with mock.patch.dict(os.environ, {"TEMP": d}), mock.patch.object(autosetup.urllib.request, "urlretrieve", fake), \
                    mock.patch.object(autosetup, "_run") as run:
                with self.assertRaises(RuntimeError):
                    autosetup._portable_git(os.path.join(d, "PortableGit"))
                run.assert_not_called()

    def test_old_git_failure_is_retried_now(self):
        import autosetup
        autosetup.state["unimate"] = {"status": "failed", "time": __import__("time").time(),
                                      "text": "Git for Windows is needed for UniMate. Get it from https://git-scm.com"}
        with mock.patch.object(autosetup, "_unimate", return_value="") as u, \
                mock.patch.object(autosetup, "_save"), mock.patch.object(autosetup, "_log"):
            autosetup._work(lambda e: None, "unimate")
        u.assert_called_once()
        self.assertEqual(autosetup.state["unimate"]["status"], "ready")


class UniMateOnceTests(unittest.TestCase):
    """UniMate's setup starts by itself only the first time the app opens"""
    def _open_app(self, running=False):
        import autosetup
        with mock.patch.object(autosetup, "_unimate", return_value="") as u, \
                mock.patch.object(autosetup, "_watch_unimate", return_value="") as w, \
                mock.patch.object(autosetup, "_builtins", return_value=""), \
                mock.patch.object(autosetup, "_earlier_pip_running", return_value=running), \
                mock.patch.object(autosetup, "_save"), mock.patch.object(autosetup, "_log"):
            autosetup._work(lambda e: None)
        return u, w

    def setUp(self):
        import autosetup
        autosetup.state.clear()

    def test_first_open_starts_it(self):
        u, w = self._open_app()
        u.assert_called_once()
        w.assert_not_called()

    def test_later_opens_do_not(self):
        self._open_app()
        u, w = self._open_app()
        u.assert_not_called()
        w.assert_not_called()

    def test_later_open_follows_a_running_install(self):
        self._open_app()
        u, w = self._open_app(running=True)
        u.assert_not_called()
        w.assert_called_once()

    def test_animate_box_can_still_start_it(self):
        import autosetup
        self._open_app()
        with mock.patch.object(autosetup, "_unimate", return_value="") as u, \
                mock.patch.object(autosetup, "_save"), mock.patch.object(autosetup, "_log"):
            autosetup._work(lambda e: None, "unimate")
        u.assert_called_once()


class VoiceTests(unittest.TestCase):
    def test_whole_reply_is_default(self):
        self.assertTrue(pm.WHOLE_REPLY)
        self.assertTrue(callable(pm.warm_voice))

    def test_rvc_picks_a_device(self):
        self.assertIn(rvc._device(), ("cpu", "cuda"))
        with mock.patch.dict(os.environ, {"RVC_DEVICE": "cpu"}):
            rvc._cache["device"] = None
            self.assertEqual(rvc._device(), "cpu")
        rvc._cache["device"] = None

    def test_sad_reply_is_sad(self):
        self.assertEqual(ve.detect("Oh no, I'm so sorry. I wish I could give you a hug.", pm.analyzer)[0], "sad")
        self.assertEqual(ve.detect("The meeting is at three.", pm.analyzer)[0], "neutral")


class UiTests(unittest.TestCase):
    def test_dropdowns_open_downward(self):
        self.assertIn("export function initDropdowns", read("ui", "dropdown.js"))
        self.assertIn("initDropdowns();", read("ui", "app.js"))

    def test_rooms_both_sides(self):
        app = read("ui", "app.js")
        self.assertIn("+ Room on the ${side}", app)
        self.assertIn('add("left")', app)
        self.assertIn('add("right")', app)

    def test_one_kitchen_panel(self):
        html = read("ui", "index.html")
        self.assertIn('data-panel="kitchen"', html)
        self.assertNotIn('data-panel="baking"', html)
        self.assertNotIn('data-panel="cooking"', html)
        self.assertIn('id="kitchenTabs"', html)
        self.assertIn('"kitchen"', read("ui", "app.js").split("const OPTIONAL_PANELS")[1].split("\n")[0])
        p = next(x for x in plugins.PLUGINS if x["id"] == "kitchen")
        self.assertEqual(p["panels"], ["kitchen"])
        self.assertIn('"kitchen_tab"', read("app.py"))


if __name__ == "__main__":
    unittest.main()


class UnimateSkipTests(unittest.TestCase):
    def _asset(self, reason):
        import json, shutil, tempfile
        d = tempfile.mkdtemp(prefix="vermeil-um-")
        self.addCleanup(shutil.rmtree, d, True)
        self._write(d, reason)
        return d

    @staticmethod
    def _write(d, reason):
        import json
        os.makedirs(os.path.join(d, "work", "features"), exist_ok=True)
        with open(os.path.join(d, "work", "features", "filtered_clips.json"), "w", encoding="utf-8") as f:
            json.dump({"m": [{"reason": reason}]}, f)

    def test_reason_is_read_and_explained(self):
        d = self._asset("128 joints outside [10, 100]")
        self.assertEqual(animate.skip_reason(d), "128 joints outside [10, 100]")
        self.assertIn("one character per .glb", animate.explain(animate.skip_reason(d)))
        self.assertIn("Rig it", animate.explain("5 joints outside [10, 100]"))
        self.assertEqual(animate.skip_reason(os.path.join(d, "nope")), "")

    def test_lying_model_is_stood_up_then_explained(self):
        d = self._asset("bad horizontal separation")
        calls = []
        def run(args, log):
            calls.append(args)
            self._write(d, "bad horizontal separation")
            raise RuntimeError("stage 4 produced no cond")
        with mock.patch.object(animate, "_run", side_effect=run):
            with self.assertRaises(RuntimeError):
                animate._read_skeleton("m.glb", d, print)
        self.assertEqual(len(calls), 1 + len(animate.TURNS))                     # the plain try, then each turn
        self.assertIn("--rest_rotation", calls[1])
        with mock.patch.object(animate, "_run", side_effect=RuntimeError("stage 4 produced no cond")), \
                mock.patch.object(animate, "skip_reason", return_value="3 joints outside [10, 100]"):
            with self.assertRaisesRegex(RuntimeError, "Rig it"):
                animate._read_skeleton("m.glb", d, print)
