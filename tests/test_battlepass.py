"""Battle Pass round: XP/quests/rewards, habits, spaced flashcards, situation reminders, the lecture video server,
gym coach (meal photos, rest tips), backup/restore, phone extras (offline cards, uploads) and lip-sync levels."""
import io, json, os, sys, tempfile, unittest, urllib.request, zipfile
from datetime import date, datetime, timedelta
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

import numpy as np  # noqa: E402
import quest, habits, studygame, smartremind, mediaserve, gymcoach, backup, phone  # noqa: E402


class _Tmp(unittest.TestCase):
    """every test writes into its own temp folder, never your data/"""
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-bp-")
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, True))

    def file(self, mod, attr, name):
        p = mock.patch.object(mod, attr, os.path.join(self.tmp, name))
        p.start()
        self.addCleanup(p.stop)


class QuestTests(_Tmp):
    def setUp(self):
        super().setUp()
        self.file(quest, "STATE_FILE", "quest.json")

    def test_xp_levels_streak_and_tiers(self):
        d = date(2026, 3, 2)
        r = quest.award("review", today=d)
        self.assertEqual(r["xp"] >= quest.XP["review"], True)
        self.assertEqual(r["streak"], 1)
        r = quest.award("card_right", 3, today=d + timedelta(days=1))
        self.assertEqual(r["streak"], 2)
        r = quest.award("card_right", today=d + timedelta(days=3))       # a day missed -> the streak starts over
        self.assertEqual(r["streak"], 1)
        r = quest.award("workout", xp=quest.TIER_XP * 2, today=d + timedelta(days=3))
        self.assertGreaterEqual(r["tier"], 2)
        self.assertTrue(r["rewards"], "passing tiers hands out Battle Pass rewards")
        self.assertTrue(all(x["name"] for x in r["rewards"]))
        self.assertEqual(quest.level_of(0), (1, 0, 100))
        self.assertEqual(quest.level_of(100)[0], 2)

    def test_daily_quests_complete_and_state(self):
        d = date(2026, 3, 2)
        qs = quest.daily_quests(d)
        self.assertEqual(len(qs), 3)
        self.assertEqual(qs, quest.daily_quests(d), "the same day gives the same quests")
        q = qs[0]
        kind = next(k for k, g in {**{k: k for k in quest.XP}, **quest.QUEST_GROUP}.items() if g == q["kind"])
        r = quest.award(kind, q["goal"], today=d)
        self.assertIn(q["text"], r["quests_done"])
        s = quest.state(d)
        self.assertTrue(s["quests"][0]["done"])
        self.assertEqual(len(s["pass"]), len(quest.PASS))
        self.assertTrue(all("got" in b for b in s["badges"]))
        self.assertEqual(quest.award("card_right", 0)["xp"], 0)


class HabitTests(_Tmp):
    def setUp(self):
        super().setUp()
        self.file(habits, "STATE_FILE", "habits.json")

    def test_defaults_tick_streak_and_find(self):
        hs = habits.habits()
        self.assertTrue(any(h["name"] == "Water" for h in hs))
        water = next(h for h in hs if h["name"] == "Water")
        d = date(2026, 3, 5)
        for day in (d - timedelta(days=1), d):
            view, reached = habits.tick(water["id"], water["goal"], today=day)
            self.assertTrue(reached)
        self.assertEqual(view["streak"], 2)
        view, reached = habits.tick(water["id"], 1, today=d)
        self.assertFalse(reached, "only the tick that reaches the goal counts as reaching it")
        self.assertEqual(habits.find("I drank a glass of water"), water["id"])
        self.assertIsNone(habits.find("hello there"))
        habits.add("Stretch", "🧘", 2)
        self.assertTrue(any(h["name"] == "Stretch" and h["goal"] == 2 for h in habits.habits()))
        with self.assertRaises(ValueError):
            habits.add("  ")


class CardTests(_Tmp):
    def setUp(self):
        super().setUp()
        self.file(studygame, "CARDS_FILE", "cards.json")
        cards = [{"id": f"r:{i}", "front": f"Q{i}", "back": f"A{i}", "source": "", "deck": "D"} for i in range(5)]
        p = mock.patch.object(studygame, "all_cards", return_value=cards)
        p.start()
        self.addCleanup(p.stop)

    def test_leitner_boxes(self):
        d = date(2026, 4, 1)
        self.assertEqual(studygame.deck(today=d)["new"], 5)
        self.assertEqual(studygame.answer("r:0", True, today=d), {"box": 1, "due": (d + timedelta(days=1)).isoformat()})
        self.assertEqual(studygame.answer("r:0", True, today=d + timedelta(days=1))["box"], 2)
        self.assertEqual(studygame.answer("r:1", False, today=d)["box"], 1)
        deck = studygame.deck(today=d + timedelta(days=1))
        self.assertEqual([c["id"] for c in deck["cards"][:1]], ["r:1"], "the missed card comes back first")
        self.assertNotIn("r:0", [c["id"] for c in deck["cards"]], "a known card waits longer")


class SmartReminderTests(_Tmp):
    def setUp(self):
        super().setUp()
        self.file(smartremind, "STATE_FILE", "smart.json")

    def test_home_and_before_class(self):
        self.assertIn("when you get back", smartremind.add("take out the trash", "home"))
        smartremind.add("print my notes", "before", "2 pm class", 30)
        now = datetime(2026, 5, 4, 13, 0)
        with mock.patch.object(smartremind, "_today_items", return_value=[("14:00", "Physics class"), ("16:00", "Gym")]):
            self.assertEqual(smartremind.due(now), [], "too early and not back home yet")
            fired = smartremind.due(now.replace(minute=35), came_back=True)
        self.assertEqual(len(fired), 2)
        self.assertTrue(any("Physics class starts at 14:00" in f for f in fired))
        self.assertEqual(smartremind.list_all(), [], "each one goes off once")


class MediaServerTests(_Tmp):
    def test_streams_with_range_and_secret(self):
        video = os.path.join(self.tmp, "lec.mp4")
        with open(video, "wb") as f:
            f.write(bytes(range(256)) * 40)
        with mock.patch("academic.file_path", return_value=video):
            u = mediaserve.url("abc123", 75)
            self.assertTrue(u.endswith("#t=75"))
            base = u.split("#")[0]
            req = urllib.request.Request(base, headers={"Range": "bytes=10-19"})
            with urllib.request.urlopen(req, timeout=5) as r:
                self.assertEqual(r.status, 206)
                self.assertEqual(r.read(), bytes(range(10, 20)))
            bad = base.replace(base.split("/")[3], "wrongsecret")
            with self.assertRaises(urllib.error.HTTPError):
                urllib.request.urlopen(bad, timeout=5)


class GymCoachTests(_Tmp):
    def setUp(self):
        super().setUp()
        self.file(gymcoach, "STATE_FILE", "meals.json")

    def test_photo_estimate_and_meal_log(self):
        est = gymcoach.parse_estimate('Sure! {"name": "Adobo rice", "kcal": "650", "protein": 38.4, "carbs": 70, "fat": 22, "note": "fairly sure"}')
        self.assertEqual((est["name"], est["kcal"], est["protein"]), ("Adobo rice", 650, 38))
        self.assertEqual(gymcoach.parse_estimate("no json here")["name"], "")
        d = gymcoach.add_meal({**est, "photo": True})
        gymcoach.add_meal({"name": "Banana", "kcal": 100, "carbs": 25})
        self.assertEqual(d["total"]["kcal"], 650)
        day = gymcoach.meals()
        self.assertEqual(day["total"]["kcal"], 750)
        self.assertEqual(gymcoach.remove_meal(day["meals"][0]["id"])["total"]["kcal"], 100)
        self.assertIn("error", gymcoach.add_meal({"name": ""}))

    def test_rest_and_sleep_advice(self):
        today = date.today()
        hist = [{"date": (today - timedelta(days=i)).isoformat(), "volume": 5000} for i in range(5)]
        a = gymcoach.advice(hist, streak=5, today=today)
        self.assertTrue(a["rest"])
        self.assertIn("5 days in a row", a["tips"][0])
        gymcoach.log_sleep(5)
        a = gymcoach.advice(hist[:1], streak=1, today=today)
        self.assertTrue(any("5 h of sleep" in t for t in a["tips"]))
        self.assertIn("error", gymcoach.log_sleep("lots"))
        self.assertFalse(gymcoach.advice([], 0, today)["rest"])


class BackupTests(_Tmp):
    def test_backup_skips_secrets_and_big_folders_then_restores(self):
        data = os.path.join(self.tmp, "data")
        os.makedirs(os.path.join(data, "rvc_voices"))
        os.makedirs(os.path.join(data, "game"))
        for rel, text in {"characters.json": "[1]", "spotify_token.json": "SECRET", "game/save.json": "{}",
                          "rvc_voices/big.pth": "x" * 100}.items():
            with open(os.path.join(data, *rel.split("/")), "w") as f:
                f.write(text)
        with mock.patch.object(backup, "DATA_DIR", data):
            out = backup.make(os.path.join(self.tmp, "b.zip"))
            names = zipfile.ZipFile(out["path"]).namelist()
            self.assertIn("data/characters.json", names)
            self.assertIn("data/game/save.json", names)
            self.assertNotIn("data/spotify_token.json", names)
            self.assertNotIn("data/rvc_voices/big.pth", names)
            self.assertIn("data/rvc_voices/big.pth", zipfile.ZipFile(backup.make(os.path.join(self.tmp, "big.zip"), big=True)["path"]).namelist())
            with open(os.path.join(data, "characters.json"), "w") as f:
                f.write("[2]")
            r = backup.restore(out["path"])
            with open(os.path.join(data, "characters.json")) as f:
                self.assertEqual(f.read(), "[1]")
            self.assertTrue(os.path.isfile(r["safety"]), "a safety copy is made first")
            evil = os.path.join(self.tmp, "evil.zip")
            with zipfile.ZipFile(evil, "w") as z:
                z.writestr(backup.MARK, "{}")
                z.writestr("data/../../escape.txt", "no")
            self.assertIn("error", backup.restore(evil))
            plain = os.path.join(self.tmp, "plain.zip")
            with zipfile.ZipFile(plain, "w") as z:
                z.writestr("data/x.json", "{}")
            self.assertIn("error", backup.restore(plain))


class PhoneExtrasTests(unittest.TestCase):
    def test_upload_gets_its_own_bigger_limit(self):
        got = {}
        srv = phone.PhoneServer({"upload": lambda p: got.update(p) or {"message": "ok"}, "chat": lambda p: {}}, port=0, key="k" * 30)
        port = srv.start()
        self.addCleanup(srv.stop)
        body = b"%PDF" + b"0" * (9 * 1024 * 1024)                  # bigger than the audio limit
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/upload", data=body, method="POST",
                                     headers={"X-Vermeil-Key": "k" * 30, "Content-Type": "application/octet-stream",
                                              "X-File-Name": "Week%201%20notes.pdf"})
        with urllib.request.urlopen(req, timeout=10) as r:
            self.assertEqual(json.loads(r.read())["message"], "ok")
        self.assertEqual(got["name"], "Week 1 notes.pdf")
        self.assertEqual(len(got["data"]), len(body))
        req = urllib.request.Request(f"http://127.0.0.1:{port}/api/chat", data=b"x" * (100 * 1024), method="POST",
                                     headers={"X-Vermeil-Key": "k" * 30, "Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(e.exception.code, 413, "other calls keep the small limit")


class LipSyncTests(unittest.TestCase):
    def test_levels_follow_the_voice(self):
        import pinakamain
        sr = 22050
        d = np.concatenate([np.zeros(sr // 10), np.sin(np.arange(sr) / 5) * 0.5, np.zeros(sr // 5)])
        lv = pinakamain._lip_levels(d, sr)
        self.assertEqual(len(lv), int(len(d) / (sr * 0.05)))
        self.assertEqual(lv[:2], [0, 0])
        self.assertEqual(max(lv), 9)
        self.assertEqual(lv[-1], 0)
        self.assertEqual(pinakamain._lip_levels(np.zeros(10), sr), [])


class AnimateCancelTests(unittest.TestCase):
    def test_cancel_stops_the_next_step(self):
        import animate
        self.addCleanup(animate._cancel.clear)
        self.assertTrue(animate.cancel())
        with self.assertRaises(animate.Cancelled):
            animate._run(["python", "-c", "print(1)"], os.devnull)


if __name__ == "__main__":
    unittest.main()
