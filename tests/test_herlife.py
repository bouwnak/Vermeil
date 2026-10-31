"""Her little life: remembering small things to ask about, outfits by time/weather/season, the wardrobe, birthday,
the good-morning/good-night routines, holiday greetings (skills/herlife.py) and the double-clap wake (senses/wakeword.py)."""
import os, sys, tempfile, unittest
from datetime import date
from unittest import mock

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
import herlife, wakeword  # noqa: E402

FRI = date(2026, 10, 30)                          # a Friday


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-her-")
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, True))
        p = mock.patch.object(herlife, "STATE_FILE", os.path.join(self.tmp, "herlife.json"))
        p.start()
        self.addCleanup(p.stop)


class SmallThingsTests(_Tmp):
    def test_exam_tomorrow_is_asked_about_after_it(self):
        item = herlife.notice("I have an exam tomorrow, wish me luck", FRI)
        self.assertEqual(item["question"], "How did your exam go?")
        self.assertEqual(item["ask_on"], "2026-11-01")
        self.assertEqual(herlife.followups_due(FRI), [])
        due = herlife.followups_due(date(2026, 11, 1))
        self.assertEqual(len(due), 1)
        herlife.asked(due[0]["id"])
        self.assertEqual(herlife.followups_due(date(2026, 11, 1)), [])

    def test_weekday_sickness_and_noise(self):
        self.assertEqual(herlife.notice("my interview is on monday", FRI)["ask_on"], "2026-11-03")
        self.assertEqual(herlife.notice("I'm feeling sick", FRI)["question"], "Are you feeling better today?")
        self.assertIsNone(herlife.notice("play some music", FRI))
        self.assertTrue(herlife.notice("I have an exam tomorrow", FRI))
        self.assertIsNone(herlife.notice("my exam is tomorrow!", FRI))           # not asked yet: no duplicate
        self.assertIsNone(herlife.notice("I have an exam", FRI))                 # no "when": nothing to follow up


class OutfitTests(_Tmp):
    def test_outfit_by_day_weather_and_birthday(self):
        self.assertEqual(herlife.outfit_for(14, "clear", date(2026, 10, 31))["hat"], "witch")
        self.assertEqual(herlife.outfit_for(14, "clear", date(2026, 12, 24))["hat"], "santa")
        self.assertEqual(herlife.outfit_for(14, "snow", date(2026, 3, 3))["hat"], "beanie")
        self.assertEqual(herlife.outfit_for(12, "clear", date(2026, 6, 3))["hat"], "cap")
        self.assertEqual(herlife.outfit_for(23, "clear", date(2026, 6, 3))["hat"], "headphones")
        self.assertEqual(herlife.outfit_for(12, "clear", date(2026, 6, 3), birthday="06-03")["hat"], "party")
        self.assertTrue(herlife.is_birthday("2000-06-03", date(2026, 6, 3)))

    def test_wardrobe_pick_overrides_auto(self):
        self.assertIn("error", herlife.wardrobe_save({"name": ""}))
        herlife.wardrobe_save({"name": "Comfy", "hat": "beanie", "glasses": True, "color": "#ff0000"})
        herlife.wardrobe_wear("Comfy")
        self.assertEqual(herlife.current_outfit(12, "clear", date(2026, 6, 3))["hat"], "beanie")
        herlife.wardrobe_remove("Comfy")
        self.assertEqual(herlife.wardrobe()["wearing"], "auto")
        self.assertEqual(herlife.current_outfit(12, "clear", date(2026, 6, 3))["hat"], "cap")


class RoutineTests(_Tmp):
    def test_morning_night_and_holiday_once(self):
        m = herlife.morning({"weather": {"text": "Light rain", "temp_c": 27.4}, "tasks": ["Steel HW"], "sleep_hours": 5})
        self.assertIn("27°C", m)
        self.assertIn("Steel HW", m)
        self.assertIn("easy", m)
        n = herlife.night({"done": 1, "focus_minutes": 50, "tomorrow": ["Quiz"]})
        self.assertIn("1 task today", n)
        self.assertIn("Quiz", n)
        self.assertIn("Christmas", herlife.holiday_greeting(date(2026, 12, 25)))
        self.assertIsNone(herlife.holiday_greeting(date(2026, 12, 25)))          # once a year
        self.assertIsNone(herlife.holiday_greeting(date(2026, 3, 3)))


class ClapTests(unittest.TestCase):
    @staticmethod
    def _blocks(pattern):
        rng = np.random.default_rng(1)
        out = []
        for loud in pattern:
            b = rng.normal(0, 0.003, 1600).astype("float32")
            if loud:
                b[100:180] += np.hanning(80).astype("float32") * 0.8          # a short, sharp clap
            out.append(b)
        return out

    def test_double_clap_wakes_single_or_slow_does_not(self):
        det = wakeword.ClapDetector()
        self.assertTrue(any(det.feed(b) for b in self._blocks([0] * 10 + [1, 0, 0, 1] + [0] * 5)))
        det = wakeword.ClapDetector()
        self.assertFalse(any(det.feed(b) for b in self._blocks([0] * 10 + [1] + [0] * 20)))
        det = wakeword.ClapDetector()
        self.assertFalse(any(det.feed(b) for b in self._blocks([0] * 10 + [1] + [0] * 12 + [1] + [0] * 5)))   # 1.3 s apart
        speech = [np.sin(np.linspace(0, 400, 1600)).astype("float32") * 0.3 for _ in range(10)]
        det = wakeword.ClapDetector()
        self.assertFalse(any(det.feed(b) for b in speech))                        # steady loud sound isn't a clap


if __name__ == "__main__":
    unittest.main()
