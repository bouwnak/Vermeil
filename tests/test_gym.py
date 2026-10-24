"""Tests for gym.py (uses a copy of the HYBRID.xlsx routine)."""
import os, sys, json, shutil, tempfile, unittest
from datetime import date, timedelta
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import gym  # noqa: E402
import tools  # noqa: E402

XLSX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "HYBRID.xlsx")


@unittest.skipUnless(os.path.exists(XLSX), "fixture missing")
class GymTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(gym, n, os.path.join(self.tmp, f))
                  for n, f in (("ROUTINE_FILE", "r.json"), ("LOG_FILE", "l.json"), ("STATS_FILE", "s.json"))]
        for p in self.p: p.start()
        self.assertIn("7 days", gym.import_xlsx(XLSX)["message"])

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)

    def test_import(self):
        days = gym.get_routine()["days"]
        self.assertEqual([d["title"] for d in days][:3], ["PUSH", "PULL", "LEG"])
        bench = days[0]["exercises"][0]
        self.assertEqual((bench["name"], bench["sets"], bench["target"], bench["kg"]), ("Incline Bench", 3, "6-12", 20.0))
        self.assertTrue(bench["link"].startswith("https://"))
        hold = days[3]["exercises"][0]
        self.assertTrue(hold["timed"])
        self.assertEqual(gym.get_stats()[0]["weight"], 87.2)
        self.assertEqual(gym.get_routine()["profile"]["name"], "Jecho Pantonal")

    def test_log_next_day_and_tips(self):
        y = (date.today() - timedelta(days=1)).isoformat()
        for n in (1, 2, 3):
            gym.log_set("Incline Bench", n, 20, "12", day=1, when=y)
        self.assertEqual(gym.next_day(), 2)
        plan = gym.day_plan(1)
        self.assertIn("22.5", plan["exercises"][0]["tip"])
        gym.log_set("Incline Bench", 2, 20, "9", day=1, when=y)          # replaces set 2
        self.assertIn("Beat your reps", gym.day_plan(1)["exercises"][0]["tip"])
        self.assertEqual(gym.streak(), 1)
        self.assertEqual(gym.history()[0]["volume"], 20 * 33)
        self.assertEqual(gym.exercise_progress("incline bench"), [{"date": y, "kg": 20.0}])
        gym.unlog_set("Incline Bench", 1, when=y)
        self.assertEqual(gym.history()[0]["sets"], 2)

    def test_stats_and_tools(self):
        self.assertIn("error", gym.add_stats({}))
        self.assertEqual(gym.add_stats({"weight": "86.5"})["weight"], 86.5)
        self.assertIn("Incline Bench", tools.run_tool("gym_plan", '{"day": 1}'))
        self.assertIn("Logged", tools.run_tool("gym_log_set", '{"exercise": "Lat Pulldown", "set_no": 1, "kg": 35, "reps": "12"}'))
        self.assertIn("1 sets done", tools.run_tool("gym_log_set", '{"exercise": "Lat Pulldown", "set_no": 1, "kg": 35, "reps": "12"}'))

    def test_best_per_set_updates_each_session(self):
        d1 = (date.today() - timedelta(days=7)).isoformat()
        d2 = (date.today() - timedelta(days=3)).isoformat()
        gym.log_set("Incline Bench", 1, 20, "10", day=1, when=d1)
        gym.log_set("Incline Bench", 2, 20, "9", day=1, when=d1)
        gym.log_set("Incline Bench", 1, 22.5, "12", day=1, when=d2)      # new best on set 1
        gym.log_set("Incline Bench", 2, 20, "8", day=1, when=d2)         # worse on set 2 - old best stays
        gym.log_set("Incline Bench", 1, 25, "15")                        # today - not counted yet
        best = gym.best_sets("Incline Bench")
        self.assertEqual((best[1]["reps"], best[1]["kg"], best[1]["date"]), ("12", 22.5, d2))
        self.assertEqual((best[2]["reps"], best[2]["date"]), ("9", d1))
        self.assertIn("1", gym.day_plan(1)["exercises"][0]["best"])
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        self.assertEqual(gym.best_sets("Incline Bench", before=tomorrow)[1]["reps"], "15")   # next session sees it

    def test_best_for_timed_holds(self):
        y = (date.today() - timedelta(days=1)).isoformat()
        gym.log_set("Plank", 1, None, "1min 10 secs", when=y)
        gym.log_set("Plank", 1, None, "50 sec", when=(date.today() - timedelta(days=2)).isoformat())
        self.assertEqual(gym.best_sets("Plank")[1]["reps"], "1min 10 secs")
        self.assertEqual(gym.rep_value("30 sec"), 30)

    def test_reps_text(self):
        from datetime import datetime
        self.assertEqual(gym._reps_text(datetime(2026, 6, 12)), "6-12")
        self.assertEqual(gym._rest_seconds("60-90 secs"), 90)
        self.assertEqual(gym._rest_seconds("2 mins"), 120)


if __name__ == "__main__":
    unittest.main()
