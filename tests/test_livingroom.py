"""Living room round: VCash and the furniture shop, seasons, saved room designs, photo frames, the weather widget,
the focus plant, the top-3 tasks board, seasonal decorations, holidays and room achievements (skills/roomlife.py)."""
import os, sys, tempfile, unittest
from datetime import date
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
import quest, roomlife  # noqa: E402


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-room-")
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, True))
        for mod, attr, name in ((quest, "STATE_FILE", "quest.json"), (roomlife, "PRESETS_FILE", "room_presets.json")):
            p = mock.patch.object(mod, attr, os.path.join(self.tmp, name))
            p.start()
            self.addCleanup(p.stop)


class VCashShopTests(_Tmp):
    def test_xp_gives_vcash_and_buying_spends_it_once(self):
        r = quest.award("review", n=10, today=date(2026, 3, 2))          # 200 XP -> 100 VCash
        self.assertEqual(r["vcash"], int(200 * quest.VCASH_PER_XP))
        self.assertIn("error", quest.buy("spMoonChair", 900, "Moon chair"))
        quest.give_vcash(1000)
        ok = quest.buy("spMoonChair", 900, "Moon chair")
        self.assertTrue(ok["ok"])
        self.assertEqual(ok["vcash"], 200)
        again = quest.buy("spMoonChair", 900, "Moon chair")              # owned already: not charged twice
        self.assertTrue(again["already"])
        self.assertEqual(again["vcash"], 200)
        self.assertIn("spMoonChair", quest.state()["owned"])

    def test_season_rotates_monthly_and_weekly_pick_is_stable(self):
        themes = {quest.season(date(2026, m, 1))["theme"] for m in range(1, 4)}
        self.assertEqual(themes, {"space", "ocean", "fantasy"})
        keys = [f"k{i}" for i in range(20)]
        a, b = quest.weekly_pick(keys, date(2026, 3, 2)), quest.weekly_pick(keys, date(2026, 3, 8))
        self.assertEqual(a, b)                                              # same ISO week
        self.assertEqual(len(a), quest.SHOP_WEEKLY)


class RoomLifeTests(_Tmp):
    def test_room_designs_save_load_delete(self):
        lay = {"shell": {}, "items": [{"type": "sofa"}]}
        self.assertIn("error", roomlife.save_preset("", lay))
        roomlife.save_preset("Cozy", lay)
        self.assertEqual(roomlife.presets()[0]["items"], 1)
        self.assertEqual(roomlife.load_preset("Cozy")["layout"], lay)
        roomlife.delete_preset("Cozy")
        self.assertIn("error", roomlife.load_preset("Cozy"))

    def test_photos_lists_pictures_newest_first(self):
        for i, n in enumerate(("a.jpg", "b.png", "notes.txt")):
            p = os.path.join(self.tmp, n)
            open(p, "wb").close()
            os.utime(p, (1000 + i, 1000 + i))
        names = [p["name"] for p in roomlife.photos(self.tmp)["photos"]]
        self.assertEqual(names, ["b.png", "a.jpg"])
        self.assertIn("error", roomlife.photo_data(os.path.join(self.tmp, "notes.txt")))

    def test_weather_kind_and_widget(self):
        self.assertEqual(roomlife.weather_kind("Patchy light rain"), "rain")
        self.assertEqual(roomlife.weather_kind("Thundery outbreaks"), "storm")
        self.assertEqual(roomlife.weather_kind("Light snow"), "snow")
        self.assertEqual(roomlife.weather_kind("Sunny"), "clear")
        roomlife._weather_cache.clear()
        fake = lambda c, d: {"place": "Manila", "now": {"temp_c": 30, "text": "Light rain"}, "days": [{"date": "x"}] * 7, "alerts": []}
        w = roomlife.weather_widget("Manila", fetch=fake)
        self.assertEqual((w["kind"], len(w["days"])), ("rain", 5))
        self.assertIn("error", roomlife.weather_widget(""))

    def test_focus_plant_grows_and_wilts(self):
        self.assertEqual(roomlife.plant([0] * 14)["stage"], 0)
        grown = roomlife.plant([60] * 14)
        self.assertEqual((grown["stage"], grown["wilt"]), (5, 0))
        wilted = roomlife.plant([60] * 10 + [0, 0, 0])
        self.assertEqual(wilted["wilt"], 1)
        self.assertEqual(roomlife.plant([60] * 8 + [0] * 6)["wilt"], 2)

    def test_top_tasks_by_priority_then_deadline(self):
        tasks = [{"task": "low", "priority": "low"}, {"task": "done", "priority": "high", "done": True},
                 {"task": "late", "priority": "high", "deadline": "2026-12-01"}, {"task": "soon", "priority": "high", "deadline": "2026-11-02"},
                 {"task": "mid", "priority": "normal"}]
        self.assertEqual([t["task"] for t in roomlife.top_tasks(tasks)], ["soon", "late", "mid"])

    def test_decorations_holidays_and_achievements(self):
        self.assertEqual(roomlife.decor(date(2026, 10, 31)), "halloween")
        self.assertEqual(roomlife.decor(date(2026, 12, 10)), "christmas")
        self.assertEqual(roomlife.decor(date(2026, 2, 10)), "valentine")
        self.assertEqual(roomlife.decor(date(2026, 7, 1)), "summer")
        self.assertEqual(roomlife.holiday(date(2026, 12, 25)), "Christmas")
        self.assertIsNone(roomlife.holiday(date(2026, 3, 3)))
        lay = {"items": [{"type": "spMoonChair"}, {"type": "spRocketLamp"}] + [{"type": "photoFrame_gold_m"}] * 3}
        got = {a["id"] for a in roomlife.achievements(lay, ["spMoonChair"], {"space": ["spMoonChair", "spRocketLamp"]}) if a["got"]}
        self.assertTrue({"gallery", "shopper", "themed"} <= got)
        self.assertNotIn("decorator", got)
        self.assertTrue(roomlife.tip())


if __name__ == "__main__":
    unittest.main()
