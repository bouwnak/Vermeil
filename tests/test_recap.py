"""Yearly recap and Vermeil's surprise gift (skills/recap.py) and the whole-year XP totals in skills/quest.py."""
import datetime, os, sys, tempfile, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
import quest  # noqa: E402
import recap  # noqa: E402

DAY = datetime.date(2026, 10, 30)


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-recap-")
        for mod, attr, name in ((recap, "FILE", "recap.json"), (quest, "STATE_FILE", "quest.json")):
            p = mock.patch.object(mod, attr, os.path.join(self.tmp, name))
            p.start()
            self.addCleanup(p.stop)


class YearTests(_Tmp):
    def test_quest_keeps_year_totals(self):
        quest.award("focus_block", 2)
        quest.award("card_right", 5)
        y = quest._load()["years"][str(datetime.date.today().year)]
        self.assertEqual((y["focus_block"], y["card_right"]), (2, 5))
        self.assertGreater(y["xp"], 0)

    def test_slides_only_for_what_you_did(self):
        n = {"year": 2026, "quest": {"xp": 5000, "counts": {"card_right": 40, "habit": 9}, "level": 8, "best_streak": 12, "active_days": 30},
             "focus": {"minutes": 600, "sessions": 20, "top": ["Math"], "best_day": {"day": "2026-05-01", "minutes": 120}},
             "gym": {}, "music": {"plays": 300, "top_songs": ["A"], "top_artist": "Eminem"}, "games": {"hours": 0}}
        titles = [s["title"] for s in recap.slides(n)]
        self.assertEqual(titles, ["Your 2026 with Vermeil", "Time in focus", "Studying", "Habits", "Your music"])
        self.assertEqual(recap.slides(n)[1]["big"], "10.0 hours")

    def test_recap_note_from_ai_cached_and_fallback(self):
        calls = []
        with mock.patch.object(recap, "numbers", return_value={"year": 2026, "quest": {"xp": 100}}):
            r = recap.year_recap(2026, ask=lambda p: calls.append(p) or {"note": "Great year!"}, today=DAY)
            recap.year_recap(2026, ask=lambda p: calls.append(p) or {"note": "again"}, today=DAY)
            self.assertEqual((r["note"], len(calls)), ("Great year!", 1))
            def boom(p): raise RuntimeError("offline")
            r = recap.year_recap(2026, ask=boom, today=DAY + datetime.timedelta(days=1))
        self.assertIn("100 XP", r["note"])

    def test_numbers_never_crash(self):
        with mock.patch.object(recap, "_gym", side_effect=OSError("broken")):
            n = recap.numbers(2026)
        self.assertEqual(n["gym"], {})


class GiftTests(_Tmp):
    HARD = {"xp": 1200, "usual": 500, "focus": 100, "workouts": 1}

    def test_hard_week_rules(self):
        self.assertTrue(recap.hard_week(self.HARD))
        self.assertFalse(recap.hard_week({"xp": 800, "usual": 700, "focus": 0, "workouts": 0}))    # a normal week for you
        self.assertTrue(recap.hard_week({"xp": 0, "usual": 0, "focus": 640, "workouts": 0}))
        self.assertTrue(recap.hard_week({"xp": 0, "usual": 0, "focus": 0, "workouts": 5}))

    def test_one_gift_a_week_and_open_once(self):
        g = recap.gift_check(DAY, ask=lambda p: {"note": "Proud of you."}, week=self.HARD)
        self.assertEqual((g["vcash"], g["note"]), (160, "Proud of you."))
        self.assertIsNone(recap.gift_check(DAY + datetime.timedelta(days=1), week=self.HARD))      # same week
        self.assertEqual(len(recap.gifts()["waiting"]), 1)
        given = []
        r = recap.gift_open(g["id"], give=lambda n, why: given.append(n) or 999)
        self.assertEqual((given, r["vcash_total"], r["waiting"]), ([160], 999, []))
        with self.assertRaises(ValueError):
            recap.gift_open(g["id"], give=lambda n, why: 0)
        with self.assertRaises(KeyError):
            recap.gift_open("nope")

    def test_easy_week_no_gift_and_ai_fallback(self):
        self.assertIsNone(recap.gift_check(DAY, week={"xp": 50, "usual": 40, "focus": 0, "workouts": 0}))
        def boom(p): raise RuntimeError("offline")
        g = recap.gift_check(DAY + datetime.timedelta(days=7), ask=boom, week=self.HARD)
        self.assertIn("I noticed", g["note"])
        self.assertLessEqual(recap.gift_check(DAY + datetime.timedelta(days=14), ask=boom,
                                              week={"xp": 99999, "usual": 1, "focus": 0, "workouts": 0})["vcash"], 300)

    def test_week_numbers_from_quest_days(self):
        s = quest._fill({})
        for i in range(7):
            s["days"][(DAY - datetime.timedelta(days=i)).isoformat()] = {"xp": 200}
        s["days"][(DAY - datetime.timedelta(days=10)).isoformat()] = {"xp": 300}
        quest._save(s)
        with mock.patch("focus._read", return_value={"sessions": [{"date": DAY.isoformat(), "minutes": 50}]}), mock.patch("gym._log", return_value={}):
            w = recap._week_numbers(DAY)
        self.assertEqual((w["xp"], w["usual"], w["focus"], w["workouts"]), (1400, 100, 50, 0))


if __name__ == "__main__":
    unittest.main()
