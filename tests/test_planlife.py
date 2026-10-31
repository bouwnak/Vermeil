"""Focus & planning round (skills/planlife.py): hard-lock sentence, website blocking, breaks, the week calendar,
countdowns, habit heatmap, goal tree, screen time and the travel planner (the AI is faked)."""
import os, sys, tempfile, unittest
from datetime import date
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
import planlife  # noqa: E402

TODAY = date(2026, 10, 31)


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-plan-")
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, True))
        for name in ("GOALS_FILE", "SCREEN_FILE", "TRAVEL_FILE"):
            p = mock.patch.object(planlife, name, os.path.join(self.tmp, name.lower() + ".json"))
            p.start()
            self.addCleanup(p.stop)


class LockAndBlockTests(unittest.TestCase):
    def test_unlock_needs_the_whole_sentence(self):
        self.assertTrue(planlife.unlock_ok("  i am choosing to give up on this focus session, even though I promised "
                                           "myself I would finish it. "))
        self.assertFalse(planlife.unlock_ok("I give up"))

    def test_blocked_site_only_in_a_browser(self):
        self.assertEqual(planlife.site_blocked("Funny cats - YouTube - Google Chrome"), "youtube")
        self.assertIsNone(planlife.site_blocked("YouTube notes.docx - Word"))
        self.assertIsNone(planlife.site_blocked("Hydrology lecture - Google Chrome"))
        self.assertEqual(planlife.site_blocked("Home / X.com - Microsoft Edge", ["x.com"]), "x.com")

    def test_breaks_rotate_and_skip_squats_at_night(self):
        self.assertNotEqual(planlife.break_idea(0, 10), planlife.break_idea(1, 10))
        night = [planlife.break_idea(i, 23)["icon"] for i in range(10)]
        self.assertNotIn("🤸", night)


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.data = {"tasks": [{"task": "RCD beam", "deadline": "2026-11-03", "priority": "high"},
                               {"task": "Clean desk"}, {"task": "Old", "deadline": "2026-10-01", "done": True}],
                     "events": [{"title": "Gym", "date": "2026-11-01", "time": "17:00"}]}

    def test_week_groups_by_day(self):
        w = planlife.week(self.data["tasks"], self.data["events"], "2026-10-26")
        self.assertEqual(len(w["days"]), 7)
        sun = next(d for d in w["days"] if d["date"] == "2026-11-01")
        self.assertEqual(sun["events"][0]["title"], "Gym")
        self.assertEqual([u["title"] for u in w["undated"]], ["Clean desk"])

    def test_drag_moves_deadline(self):
        self.assertTrue(planlife.move_item(self.data, "task", "Clean desk", None, "2026-11-02"))
        self.assertEqual(self.data["tasks"][1]["deadline"], "2026-11-02")
        self.assertTrue(planlife.move_item(self.data, "event", "Gym", "2026-11-01", "2026-11-04"))
        with self.assertRaises(ValueError):
            planlife.move_item(self.data, "task", "RCD beam", "2026-11-03", "not a date")

    def test_countdowns_soonest_first_and_skip_done(self):
        c = planlife.countdowns(self.data["tasks"], self.data["events"], TODAY)
        self.assertEqual([(x["title"], x["days"]) for x in c], [("Gym", 1), ("RCD beam", 3)])

    def test_heatmap(self):
        h = planlife.heatmap([{"name": "Water", "goal": 8, "log": {"2026-10-31": 4, "2026-10-30": 9}}], 7, TODAY)
        self.assertEqual(h["days"][-1], "2026-10-31")
        self.assertEqual(h["habits"][0]["cells"][-2:], [1.0, 0.5])


class GoalAndScreenTests(_Tmp):
    def test_goal_tree_progress_and_cascade(self):
        top = planlife.goal_add("Pass the board exam")["goals"][0]
        planlife.goal_add("Hydrology", top["id"])
        g = planlife.goal_add("Steel", top["id"])["goals"][0]
        planlife.goal_toggle(g["children"][0]["id"])
        self.assertEqual(planlife.goals()[0]["progress"], 0.5)
        self.assertIn("error", planlife.goal_add("", None))
        self.assertEqual(planlife.goal_remove(top["id"])["goals"], [])

    def test_screen_time(self):
        for _ in range(4):
            planlife.screen_sample(planlife.app_name(r"C:\x\chrome.exe"), 30, "2026-10-31")
        planlife.screen_sample("VS Code", 60, "2026-10-31")
        t = planlife.screen_today("2026-10-31")
        self.assertEqual(t["total"], 3)
        self.assertEqual(t["apps"][0]["app"], "Chrome")
        self.assertEqual(planlife.screen_week(TODAY)[-1]["minutes"], 3)


PLAN = {"summary": "Cebu", "airfare": {"route": "MNL-CEB", "low": 2000, "high": 3500},
        "stays": [{"name": "Inn", "per_night": 1500}, {"name": "Hostel", "per_night": 700}],
        "days": [{"day": 1, "stops": [{"name": "Jeep", "kind": "commute", "cost": 15}, {"name": "Fort", "kind": "spot", "cost": 30}]},
                 {"day": 2, "stops": [{"name": "Lechon", "kind": "food", "cost": 300}]}]}


class TravelTests(_Tmp):
    def test_needs_place_and_days(self):
        self.assertIn("error", planlife.travel_plan({"place": "Cebu"}, ask=lambda p: PLAN))
        self.assertIn("error", planlife.travel_plan({"days": 2}, ask=lambda p: PLAN))

    def test_plan_totals_links_and_price_level(self):
        seen = []
        p = planlife.travel_plan({"place": "Cebu", "days": 2, "stars": 1, "origin": "Manila", "start": "2026-12-01"},
                                 ask=lambda q: seen.append(q) or __import__("copy").deepcopy(PLAN))
        self.assertIn("super cheap", seen[0])
        self.assertEqual(p["days"][0]["total"], 45)
        self.assertEqual(p["estimate"], 45 + 300 + 700 + 2000)       # cheapest stay x 1 night + low airfare
        self.assertIn("checkin=2026-12-01", p["links"]["hotels"])
        self.assertEqual(planlife.travel_saved()[0]["request"]["place"], "Cebu")

    def test_swap_avoids_the_old_place_and_edit(self):
        p = planlife.travel_plan({"place": "Cebu", "days": 2}, ask=lambda q: __import__("copy").deepcopy(PLAN))
        seen = []
        p = planlife.travel_swap(p, 1, 1, "too far", ask=lambda q: seen.append(q) or {"stop": {"name": "Temple", "kind": "spot", "cost": 50}})
        self.assertIn("Fort", seen[0])
        self.assertIn("too far", seen[0])
        self.assertEqual(p["days"][0]["stops"][1]["name"], "Temple")
        self.assertIn("Fort", p["request"]["avoid"])
        p = planlife.travel_edit(p, 2, 1, {"name": "My own cafe", "cost": "120"})
        self.assertEqual(p["days"][1]["total"], 420)
        self.assertIn("error", planlife.travel_edit(p, 2, 0, {"name": ""}))
