"""Batch 4: spaced repetition, weak topics, adaptive difficulty, Sensei, focus sessions, progress."""
import os, sys, json, shutil, tempfile, unittest
from datetime import date, timedelta
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import academic, sensei, focus, mind, llm  # noqa: E402


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        lib = os.path.join(self.tmp, "library")
        self.p = [mock.patch.object(academic, "LIB_DIR", lib), mock.patch.object(academic, "REVIEWS_DIR", os.path.join(lib, "reviews")),
                  mock.patch.object(academic, "FILES_DIR", os.path.join(lib, "files")), mock.patch.object(academic, "TEXT_DIR", os.path.join(lib, "text")),
                  mock.patch.object(academic, "INDEX_FILE", os.path.join(lib, "index.json"))]
        for p in self.p: p.start()
        academic._dirs()

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)

    def _review(self, rid="r1", items=None):
        r = {"id": rid, "type": "mcq", "title": "Quiz", "files": [], "subject": "Statics", "created": "2026-10-20 10:00",
             "difficulty": "medium", "srs": {"interval": 0, "due": date.today().isoformat()},
             "items": items or [{"question": "q1", "choices": ["a", "b"], "answer_index": 0, "topic": "Shear diagrams"},
                                {"question": "q2", "choices": ["a", "b"], "answer_index": 1, "topic": "Moments"}]}
        academic._write_json(os.path.join(academic.REVIEWS_DIR, f"{rid}.json"), r)
        return r

    def test_spaced_repetition_intervals(self):
        t = date(2026, 10, 21)
        s = academic.next_review(None, 95, t)
        self.assertEqual((s["interval"], s["due"]), (3, "2026-10-24"))
        s = academic.next_review(s, 95, t)
        self.assertEqual(s["interval"], 8)                       # 3 * 2.5
        self.assertEqual(academic.next_review(s, 50, t)["interval"], 1)      # struggled -> tomorrow
        self.assertEqual(academic.next_review({"interval": 0}, 75, t)["interval"], 2)

    def test_due_and_topics_and_weak(self):
        self._review()
        self.assertEqual([r["id"] for r in academic.due_reviews()], ["r1"])
        academic.save_score("r1", 1, 2, [True, False])
        academic.save_score("r1", 1, 2, [True, False])
        self.assertEqual(academic.due_reviews(), [])             # pushed to tomorrow
        weak = academic.weak_topics()
        self.assertEqual([w["topic"] for w in weak], ["Statics · moments"])
        self.assertEqual(weak[0]["pct"], 0)

    def test_auto_difficulty(self):
        self.assertEqual(academic.auto_difficulty(), "medium")
        self._review()
        for _ in range(3):
            academic.save_score("r1", 2, 2)
        self.assertEqual(academic.auto_difficulty(), "hard")
        for _ in range(6):
            academic.save_score("r1", 0, 2)
        self.assertEqual(academic.auto_difficulty(), "easy")

    def test_weak_review_needs_data(self):
        with self.assertRaisesRegex(ValueError, "No weak topics"):
            academic.weak_topics_review()

    def test_sensei_quiz_is_a_review_with_srs(self):
        data = {"items": [{"front": "ねこ (neko)", "back": "cat", "topic": "animals", "source": "Sensei"}] * 3}
        with mock.patch.object(sensei, "STATE_FILE", os.path.join(self.tmp, "s.json")), mock.patch.object(llm, "ask", return_value=data):
            r = sensei.make_quiz("ja", "animals", "flashcards", 3)
        self.assertEqual(r["subject"], "Japanese")
        self.assertEqual(academic.due_reviews()[0]["id"], r["id"])


class SenseiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(sensei, "STATE_FILE", os.path.join(self.tmp, "s.json")),
                  mock.patch.object(mind, "PRACTICE_FILE", os.path.join(self.tmp, "p.json"))]
        for p in self.p: p.start()

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)

    def test_streak(self):
        d = date(2026, 10, 20)
        self.assertEqual(sensei.mark_practice(d), 1)
        self.assertEqual(sensei.mark_practice(d), 1)                       # same day
        self.assertEqual(sensei.mark_practice(d + timedelta(days=1)), 2)
        self.assertEqual(sensei.mark_practice(d + timedelta(days=3)), 1)   # missed a day
        self.assertEqual(sensei.current_streak(d + timedelta(days=10)), 0)

    def test_pronunciation_compare(self):
        self.assertEqual(sensei.compare("はじめまして", "はじめまして。", "ja")["score"], 100)
        r = sensei.compare("Me llamo Juan", "me llamo", "es")
        self.assertEqual(r["missed"], ["juan"])
        self.assertLess(r["score"], 100)
        with mock.patch.object(sensei, "record", return_value=[0.0] * 16000), \
                mock.patch("stt.transcribe", return_value="はじめまして") as tr:
            out = sensei.pronunciation("はじめまして", "ja", 1)
        self.assertEqual(out["score"], 100)
        self.assertEqual(tr.call_args.kwargs["language"], "ja")

    def test_lesson_and_conversation_with_corrections(self):
        with mock.patch.object(llm, "ask", return_value="## Hiragana"):
            r = sensei.lesson("ja", "hiragana", 1)
        self.assertEqual((r["lesson"], r["streak"]), ("## Hiragana", 1))
        with mock.patch.object(mind, "_chat", return_value="こんにちは！") as chat:
            p = mind.practice_start("sensei", "ordering ramen", 2, "ja")
        self.assertIn("Corrections", chat.call_args.args[0][0]["content"])
        self.assertIn("honorifics", chat.call_args.args[0][0]["content"])
        with mock.patch.object(mind, "_ask", return_value="- watashi wa ramen ga tabetai → ramen wo tabetai (object takes を)"):
            mind.practice_finish(p["id"])
        self.assertEqual(len(sensei._state()["mistakes"]), 1)
        self.assertEqual(mind.practice_list(), [])                         # sensei talks live in their own list
        self.assertEqual(len(mind.practice_list("sensei")), 1)


class FocusTests(unittest.TestCase):
    def test_session_and_progress(self):
        tmp = tempfile.mkdtemp()
        with mock.patch.object(focus, "LOG_FILE", os.path.join(tmp, "f.json")), \
                mock.patch.object(llm, "ask", return_value="- Phone away."):
            focus.start("Thesis", 25, 5, 4)
            focus.add_distraction("phone")
            focus.add_distraction("switched to gaming", auto=True)
            focus.round_done(); focus.round_done()
            r = focus.finish()
            self.assertIn("Focused 50 min", r["summary"])
            self.assertIn("2 distractions", r["summary"])
            self.assertIsNone(focus.current())
            self.assertEqual(focus.stats(7)["minutes"], 50)
            p = focus.progress(7)
            self.assertEqual(p["focus"][-1], 50)
            self.assertIn("50 focus minutes", focus.progress_text())
            self.assertIn("error", focus.finish())
        shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
