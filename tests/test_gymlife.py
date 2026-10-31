"""Gym & health round (skills/gymlife.py): next week's weights, the coach plan when days are missed, the records wall,
the weekly muscle map, the protein bar, groceries with store prices, sleep debt, supplements, GPS runs and demo moves
(the AI is faked)."""
import json, os, sys, tempfile, unittest
from datetime import date, datetime
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
import gym  # noqa: E402
import gymlife  # noqa: E402

TODAY = date(2026, 10, 29)          # a Thursday
DAYS = [{"day": 1, "title": "Push", "exercises": [{"name": "Bench press", "sets": 3, "target": "8-10", "kg": 60},
                                                  {"name": "Plank", "sets": 2, "target": "30 sec", "timed": True}]},
        {"day": 2, "title": "Pull", "exercises": [{"name": "Barbell row", "sets": 3, "target": "8-10"},
                                                  {"name": "Lat pulldown", "sets": 3, "target": "10-12"},
                                                  {"name": "Curl", "sets": 3, "target": "12"}]},
        {"day": 3, "title": "Legs", "exercises": [{"name": "Squat", "sets": 4, "target": "6-8"}]}]


def sets(name, reps, kg):
    return [{"exercise": name, "set": i + 1, "reps": str(r), "kg": kg} for i, r in enumerate(reps)]


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-gymlife-")
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, True))
        p = mock.patch.object(gymlife, "STATE_FILE", os.path.join(self.tmp, "gymlife.json"))
        p.start()
        self.addCleanup(p.stop)


class OverloadAndPlanTests(unittest.TestCase):
    def test_heavier_only_when_every_set_hits_top(self):
        last = {"Bench press": {"date": "2026-10-27", "sets": sets("Bench press", [10, 10, 10], 60)},
                "Barbell row": {"date": "2026-10-27", "sets": sets("Barbell row", [10, 10, 9], 50)},
                "Lat pulldown": {"date": "2026-10-27", "sets": sets("Lat pulldown", [12, 12], 40)},
                "Curl": {"date": "2026-10-27", "sets": sets("Curl", [12, 12, 12], 8)}}
        r = {x["name"]: x for x in gymlife.next_weights(DAYS, last.get)}
        self.assertEqual((r["Bench press"]["status"], r["Bench press"]["next"]), ("up", 62.5))
        self.assertEqual((r["Barbell row"]["status"], r["Barbell row"]["next"]), ("keep", 50))   # one set short of 10
        self.assertIn("set 3: 9/10", r["Barbell row"]["why"])
        self.assertEqual(r["Lat pulldown"]["status"], "keep")                                     # only 2 of 3 sets done
        self.assertEqual(r["Curl"]["next"], 9.25)                                                 # light: +1.25 kg
        self.assertEqual(r["Plank"]["status"], "skip")
        self.assertEqual(r["Squat"]["status"], "new")

    def test_missed_days_fold_lifts_into_today(self):
        log = {"2026-10-26": {"sets": sets("Bench press", [10], 60)}}               # Monday only, now Thursday
        c = gymlife.adjust_plan(log, DAYS, 2, TODAY, per_week=3)
        self.assertEqual((c["done"], c["left"], c["days_left"]), (1, 2, 4))
        self.assertEqual(c["extra"], [])                                            # still time this week
        c = gymlife.adjust_plan(log, DAYS, 2, date(2026, 11, 1), per_week=3)        # Sunday: 2 left, 1 day
        self.assertEqual([x["name"] for x in c["extra"]], ["Squat"])                # Day 3's main lift joins today
        self.assertIn("missed", c["message"])
        c = gymlife.adjust_plan(log, DAYS, 2, date(2026, 11, 12))
        self.assertTrue(c["deload"])                                                # long break -> comeback week


class RecordsAndMusclesTests(unittest.TestCase):
    def test_pr_wall_trophies_and_new(self):
        log = {"2026-10-01": {"sets": sets("Squat", [8], 80) + sets("Bench press", [10], 60)},
               "2026-10-28": {"sets": sets("Squat", [5], 90) + sets("Curl", [15], 10) + sets("Plank", ["60 sec"], None)}}
        rows = gymlife.prs(log, gym.e1rm, gym.rep_value, TODAY)
        self.assertEqual([r["name"] for r in rows[:3]], ["Squat", "Bench press", "Curl"])
        self.assertEqual([r["trophy"] for r in rows[:3]], ["🥇", "🥈", "🥉"])
        sq = rows[0]
        self.assertEqual((sq["kg"], sq["reps"]), (90, 8))
        self.assertTrue(sq["new"])                                                  # heavier set this week
        self.assertFalse(rows[1]["new"])
        self.assertEqual(rows[-1]["trophy"], "")                                    # no weight -> no trophy

    def test_week_muscles_fade(self):
        log = {"2026-10-29": {"sets": sets("Squat", [8, 8], 80)}, "2026-10-24": {"sets": sets("Bench press", [8], 60)},
               "2026-10-10": {"sets": sets("Curl", [8], 10)}}
        m = gymlife.week_muscles(log, gym.muscles_for, TODAY)
        main_today, main_old = gym.muscles_for("Squat")[0], gym.muscles_for("Bench press")[0]
        self.assertGreater(m[main_today], m[main_old])
        self.assertNotIn(gym.muscles_for("Curl")[0], m)                             # older than a week

    def test_protein_bar(self):
        self.assertEqual(gymlife.protein_target({"weight": 75}), 150)
        b = gymlife.protein_bar({"protein": 90}, 150)
        self.assertEqual((b["pct"], b["left"]), (60, 60))
        self.assertIsNone(gymlife.protein_bar({}, None)["target"])

    def test_demo_for(self):
        self.assertEqual(gymlife.demo_for("Barbell Back Squat"), "squat")
        self.assertEqual(gymlife.demo_for("Romanian deadlift"), "deadlift")
        self.assertEqual(gymlife.demo_for("Incline Dumbbell Press"), "press")
        self.assertIsNone(gymlife.demo_for("Stretching"))
        self.assertEqual([gymlife.demo_for(n) for n in ("Lat pulldown", "Seated rows", "Abs crunch", "Dips")],
                         ["row", "row", "plank", "pushup"])
        self.assertIsNone(gymlife.demo_for("Calf raise on a platform") and None)


class GroceryTests(_Tmp):
    PLAN = {"meals": [{"items": [{"food": "Chicken breast", "grams": 200}, {"food": "Rice", "grams": 150}]},
                      {"items": [{"food": "Eggs", "grams": 150}, {"food": "Rice", "grams": 100}]}]}

    def test_list_and_country(self):
        items = {i["food"]: i for i in gymlife.grocery_list(self.PLAN)}
        self.assertEqual(items["Rice"]["grams"], 1750)
        self.assertEqual(items["Rice"]["qty"], "1.75 kg")
        self.assertEqual(items["Eggs"]["qty"], "21 eggs")
        self.assertEqual(gymlife.country_for("Quezon City, Philippines"), "PH")
        self.assertEqual(gymlife.country_for("Austin, Texas"), "US")

    def test_prices_from_store_and_cached(self):
        items = gymlife.grocery_list(self.PLAN)
        calls = []

        def ask(prompt):
            calls.append(prompt)
            return json.dumps({"items": [{"food": "Rice", "price": 95}, {"food": "Chicken breast", "price": 300}], "note": "ok"})
        r = gymlife.grocery_prices(items, "PH", ask=ask, today=TODAY)
        self.assertEqual((r["store"], r["currency"]), ("SM Supermarket", "₱"))
        self.assertIn("SM Supermarket", calls[0])
        self.assertEqual(r["total"], 395)
        self.assertIsNone(next(i for i in r["items"] if i["food"] == "Eggs")["price"])
        gymlife.grocery_prices(items, "PH", ask=ask, today=TODAY)
        self.assertNotIn("Rice", calls[1])                                           # cached for a week
        us = gymlife.grocery_prices(items, "US", ask=lambda p: '{"items": []}', today=TODAY)
        self.assertEqual(us["store"], "Walmart")
        self.assertIn("walmart.com", us["items"][0]["link"])


class SleepTests(_Tmp):
    def test_debt_tips_and_streak(self):
        sleep = {"2026-10-27": 6, "2026-10-28": 8, "2026-10-29": 8.5, "2026-10-25": 5}
        r = gymlife.sleep_report(sleep, 8, "23:00", TODAY)
        self.assertEqual((r["debt"], r["met"], r["streak"]), (5.0, 2, 2))
        self.assertIn("earlier", r["tips"][0])
        self.assertIn("nap", r["tips"][1])
        self.assertIn("2/7", r["summary"])
        self.assertEqual(gymlife.sleep_report({}, 8, "23:00", TODAY)["avg"], None)

    def test_settings_and_wind_down(self):
        self.assertIn("error", gymlife.sleep_save(need=2))
        self.assertIn("error", gymlife.sleep_save(bedtime="25:00"))
        s = gymlife.sleep_save(need=7.5, bedtime="22:30", wind_down=30)
        self.assertEqual((s["need"], s["bedtime"], s["wind_down"]), (7.5, "22:30", 30))
        self.assertTrue(gymlife.wind_down_due(datetime(2026, 10, 29, 22, 10), "22:30", 30))
        self.assertFalse(gymlife.wind_down_due(datetime(2026, 10, 29, 21, 0), "22:30", 30))


class SupplementTests(_Tmp):
    def test_take_and_reminders(self):
        self.assertIn("error", gymlife.supp_save({"name": "Creatine"}))
        d = gymlife.supp_save({"name": "Creatine", "dose": "5 g", "times": ["08:00", "20:00", "bad"]})
        sid = d["items"][0]["id"]
        now = datetime(2026, 10, 29, 9, 0)
        due = gymlife.supp_due(now)
        self.assertEqual(len(due), 1)
        self.assertIn("Creatine (5 g)", due[0][1])
        self.assertEqual(gymlife.supp_due(now, {due[0][0]}), [])                     # told once
        gymlife.supp_take(sid, "08:00", "2026-10-29")
        lst = gymlife.supp_list(now)
        self.assertTrue(lst["items"][0]["slots"][0]["taken"])
        self.assertEqual(lst["week"][-1], {"date": "2026-10-29", "taken": 1, "want": 2})
        self.assertEqual(gymlife.supp_due(now), [])
        gymlife.supp_take(sid, "08:00", "2026-10-29", undo=True)
        self.assertFalse(gymlife.supp_list(now)["items"][0]["slots"][0]["taken"])
        self.assertEqual(gymlife.supp_remove(sid)["items"], [])


class RunTests(_Tmp):
    def test_stats_skip_glitches(self):
        pts = [[14.6 + i * 0.0009, 121.0, i * 30000, 5] for i in range(11)]         # ~100 m per 30 s
        pts.insert(5, [15.6, 121.0, 4 * 30000 + 1000, 5])                             # a 100 km jump: skipped
        pts.append([14.61, 121.0, 11 * 30000, 400])                                   # a bad fix: skipped
        s = gymlife.run_stats(pts)
        self.assertAlmostEqual(s["km"], 1.0, delta=0.02)
        self.assertEqual(s["seconds"], 300)
        self.assertEqual(s["pace_text"], "5:00 /km")
        self.assertAlmostEqual(s["steps"], 1282, delta=30)

    def test_save_list_remove(self):
        self.assertIn("error", gymlife.run_save([[14.6, 121.0, 0]]))
        pts = [[14.6 + i * 0.0009, 121.0, i * 30000] for i in range(11)]
        r = gymlife.run_save(pts, kind="walk", when=datetime(2026, 10, 29, 6, 0))
        self.assertEqual(r["runs"][0]["kind"], "walk")
        self.assertEqual(gymlife.runs(TODAY)["week_count"], 1)
        self.assertEqual(gymlife.run_remove(r["runs"][0]["id"])["runs"], [])


if __name__ == "__main__":
    unittest.main()
