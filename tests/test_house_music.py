"""meal planner (meals per day + dishes), UniMate pip commands, a song left playing after Vermeil closed"""
import os, sys, tempfile, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import gym  # noqa: E402
import animate  # noqa: E402
import f1  # noqa: E402

ME = {"height": "175", "weight": "75", "age": "28", "gender": "male", "activity": "moderate"}


class MealPlannerTests(unittest.TestCase):
    def test_meals_per_day(self):
        for n in (2, 3, 4, 5, 6):
            p = gym.meal_plan("recomp", profile=ME, meals=n)
            self.assertEqual(len(p["meals"]), n)
            self.assertEqual(p["meal_count"], n)
            self.assertLess(abs(p["totals"]["kcal"] - p["kcal"]), p["kcal"] * 0.15)   # still adds up to the day
        self.assertEqual(gym.meal_plan("recomp", profile=ME, meals=10)["meal_count"], 6)    # 2-6 only
        self.assertEqual(gym.meal_plan("recomp", profile=ME, meals="x")["meal_count"], 4)

    def test_other_dish(self):
        first = gym.meal_plan("bulk", profile=ME, meals=3)
        m = first["meals"][0]
        self.assertGreater(m["choices"], 1)
        other = gym.meal_plan("bulk", profile=ME, meals=3, dishes=[m["pick"] + 1, 0, 0])
        self.assertNotEqual(other["meals"][0]["dish"], m["dish"])
        self.assertEqual(other["meals"][1]["dish"], gym.meal_plan("bulk", profile=ME, meals=3, dishes=[0, 0, 0])["meals"][1]["dish"])


class UniMateCommandTests(unittest.TestCase):
    def test_pip_commands(self):
        cmds = animate.pip_commands()
        self.assertEqual(len(cmds), 2)
        self.assertIn('-m pip install "setuptools<81"', cmds[0])
        self.assertIn("--no-build-isolation", cmds[1])


class LeftoverMusicTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.pidfile = os.path.join(self.tmp, "music_player.pid")
        self.p = mock.patch.object(f1, "PLAYER_PID_FILE", self.pidfile)
        self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_nothing_left_over(self):
        self.assertFalse(f1.stop_leftover_player())

    def test_never_kills_another_program(self):
        with open(self.pidfile, "w") as f:
            f.write(str(os.getpid()))              # this test, not ffplay
        self.assertFalse(f1.stop_leftover_player())
        self.assertFalse(os.path.exists(self.pidfile))

    def test_remembers_the_player(self):
        f1._remember_player(mock.Mock(pid=4321))
        with open(self.pidfile) as f:
            self.assertEqual(f.read(), "4321")


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


class RoomsAndVoiceTests(unittest.TestCase):
    """the house is rooms only (no floors/stairs), the window is furniture, and the voice is RVC again (no Qwen3-TTS)"""
    def test_no_floors_or_stairs(self):
        house = _read("ui", "house.js")
        for gone in ("stairs", "MAX_FLOORS", "climbPath", "cfg.floors"):
            self.assertNotIn(gone, house)
        self.assertNotIn("goToFloor", _read("ui", "room.js"))
        self.assertNotIn("floorBar", _read("ui", "index.html"))

    def test_window_is_furniture(self):
        cozy = _read("ui", "cozyroom.js")
        self.assertIn("CATALOG.bigWindow", cozy)
        self.assertIn("windowItem: true", cozy)                 # a deleted window stays deleted
        self.assertNotIn("setShowWindow", _read("ui", "app.js"))

    def test_camera_follows_her_between_rooms(self):
        room = _read("ui", "room.js")
        self.assertIn("_followRoom()", room)
        self.assertIn("_roomAt(", room)

    def test_rvc_import_is_back(self):
        html = _read("ui", "index.html")
        for part in ('id="rvcBox"', 'id="rvcSelect"', 'id="rvcBase"'):
            self.assertIn(part, html)
        self.assertNotIn("qwen", html.lower())
        self.assertFalse(os.path.exists(os.path.join(ROOT, "senses", "qwenvoice.py")))


if __name__ == "__main__":
    unittest.main()
