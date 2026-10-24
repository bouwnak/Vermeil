"""Tests: voice quick commands, APA research parsing, gym routine editing + restart."""
import os, sys, json, shutil, tempfile, unittest
from types import SimpleNamespace
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import gym, academic  # noqa: E402


class GymEditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(gym, n, os.path.join(self.tmp, f))
                  for n, f in (("ROUTINE_FILE", "r.json"), ("LOG_FILE", "l.json"), ("STATS_FILE", "s.json"))]
        for p in self.p: p.start()

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)

    def test_save_cleans_and_renumbers(self):
        r = gym.save_routine({"days": [{"title": "Arms", "exercises": [
            {"name": "Curl", "sets": "4", "target": "8-10", "kg": "12.5", "rest": "75", "link": "not a link"},
            {"name": "Plank", "sets": 0, "target": "45 sec", "rest": 9999}]}, {"title": "", "exercises": []}]})
        self.assertEqual(r["days"], 2)
        d = gym.get_routine()["days"]
        self.assertEqual([x["day"] for x in d], [1, 2])
        self.assertEqual(d[1]["title"], "Day 2")
        curl, plank = d[0]["exercises"]
        self.assertEqual((curl["sets"], curl["kg"], curl["rest"], curl["link"], curl["timed"]), (4, 12.5, 75, "", False))
        self.assertEqual((plank["sets"], plank["rest"], plank["timed"]), (1, 900, True))
        self.assertIn("error", gym.save_routine({"days": "x"}))

    def test_finish_saves_then_new_session_then_finish_again(self):
        gym.log_set("Curl", 1, 10, "10", day=1)
        gym.log_set("Curl", 2, 10, "9", day=1)
        r = gym.finish_workout(42)
        self.assertTrue(r["saved"])
        self.assertEqual(gym.today_log()["sets"], [])                     # next session starts empty
        self.assertEqual(gym.best_sets("Curl")[1]["reps"], "10")          # finished session counts right away
        gym.log_set("Curl", 1, 12.5, "11", day=1)                         # session 2
        r2 = gym.finish_workout(30)
        self.assertEqual((r2["saved"], r2["sets"]), (True, 1))
        h = gym.history()
        self.assertEqual([(x["session"], x["sets"], x["minutes"]) for x in h], [(2, 1, 30), (1, 2, 42)])
        self.assertEqual(gym.best_sets("Curl")[1]["reps"], "11")
        self.assertFalse(gym.finish_workout(5)["saved"])                  # nothing ticked -> nothing saved

    def test_restart_clears_only_the_current_session(self):
        gym.log_set("Curl", 1, 10, "10", day=1)
        gym.finish_workout(20)                                            # finished session 1
        gym.log_set("Curl", 1, 10, "6", day=1)                            # session 2, then restart
        gym.log_set("Curl", 2, 10, "6", day=1)
        r = gym.reset_day()
        self.assertEqual(r["cleared"], 2)
        self.assertEqual(gym.today_log()["sets"], [])
        h = gym.history()
        self.assertEqual([(x["session"], x["sets"]) for x in h], [(1, 1)])   # finished session untouched
        self.assertEqual(gym.reset_day()["cleared"], 0)

    def test_upgrade_weight(self):
        gym.save_routine({"days": [{"title": "Push", "exercises": [{"name": "Bench", "kg": 20}]},
                                   {"title": "Push 2", "exercises": [{"name": "bench", "kg": 20}]}]})
        self.assertEqual(gym.upgrade_weight("Bench")["kg"], 22.5)
        self.assertEqual([d["exercises"][0]["kg"] for d in gym.get_routine()["days"]], [22.5, 22.5])
        self.assertEqual(gym.upgrade_weight("Bench", 30)["kg"], 30)
        self.assertIn("error", gym.upgrade_weight("Squat"))

    def test_next_day_after_finishing(self):
        gym.save_routine({"days": [{"title": "Push", "exercises": []}, {"title": "Pull", "exercises": []}]})
        gym.log_set("Bench", 1, 20, "10", day=1)
        self.assertEqual(gym.next_day(), 1)                               # mid-session: stay on Push
        gym.finish_workout(30)
        self.assertEqual(gym.next_day(), 2)                               # finished Push -> suggest Pull


class QuickCommandTests(unittest.TestCase):
    def setUp(self):
        import app
        global app_mod
        app_mod = app
        self.api = app.Api.__new__(app.Api)
        self.api._characters = {"active": "vermeil", "characters": [{"id": "vermeil", "name": "Vermeil"}, {"id": "pip", "name": "Pip"}]}
        self.events, self.switched = [], []
        self.api.emit = self.events.append
        self.api.set_active = self.switched.append

    def test_switch_character(self):
        self.assertEqual(self.api._quick_command("Switch to Pip"), "Switched to Pip.")
        self.assertEqual(self.switched, ["pip"])
        self.assertIsNone(self.api._quick_command("switch to dark mode"))

    def test_gym_voice(self):
        q = self.api._quick_command
        self.assertEqual(q("restart the timer"), "Timer restarted.")
        self.assertEqual(q("pause the timer"), "Timer paused.")
        self.assertEqual(q("skip rest"), "Skipped the rest.")
        self.assertIn("2:00", q("start a 2 minute timer"))
        self.assertIn("0:45", q("set a timer for 45 seconds"))
        self.assertEqual(self.events[-1], {"type": "gym_cmd", "action": "start", "seconds": 45})
        with mock.patch.object(gym, "reset_day", return_value={"message": "Fresh start"}):
            self.assertEqual(q("restart my workout"), "Fresh start")
        self.assertIsNone(q("tell me the rest of the story"))
        with mock.patch.object(app_mod.f1, "music_control", return_value="Stopped music.") as mc:
            self.assertEqual(q("stop the music"), "Stopped music.")       # instant music command, not the gym timer
        mc.assert_called_with("stop")


if __name__ == "__main__":
    unittest.main()
