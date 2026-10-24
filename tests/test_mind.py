"""Tests for mind.py: journal, recall, activity detection, think tools (AI is faked)."""
import os, sys, json, shutil, tempfile, unittest
from datetime import date, timedelta
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import mind  # noqa: E402
import tools  # noqa: E402


class MindTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(mind, n, os.path.join(self.tmp, f))
                  for n, f in (("JOURNAL_FILE", "j.json"), ("ARCHIVE_FILE", "a.json"), ("MEMORY_FILE", "m.json"))]
        for p in self.p: p.start()
        with open(mind.MEMORY_FILE, "w") as f:
            json.dump({"user": {"conversations": [
                {"role": "user", "content": "my thesis adviser is Dr. Santos"}, {"role": "assistant", "content": "Noted~"},
                {"role": "user", "content": "I love matcha"}, {"role": "assistant", "content": "Cute."}]}}, f)

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)

    def test_journal_add_update_remove(self):
        g = mind.add_journal("goal", "Finish chapter 2", steps=["Outline", "Draft"])
        self.assertEqual(len(g["steps"]), 2)
        mind.update_journal(g["id"], toggle_step=0)
        e = mind.update_journal(g["id"], toggle_step=1)
        self.assertEqual(e["status"], "done")
        self.assertIn("error", mind.add_journal("nope", "x"))
        self.assertIn("error", mind.add_journal("idea", "  "))
        self.assertTrue(mind.remove_journal(g["id"]))
        self.assertEqual(mind.list_journal(), [])

    def test_decision_review_due(self):
        d = mind.add_journal("decision", "Pick topic", review_in_days=3)
        self.assertEqual(mind.decisions_to_review(), [])
        self.assertEqual(len(mind.decisions_to_review(date.today() + timedelta(days=3))), 1)
        mind.update_journal(d["id"], outcome="Went well")
        self.assertEqual(mind.decisions_to_review(date.today() + timedelta(days=9)), [])

    def test_recall_finds_old_chat_and_journal(self):
        mind.add_journal("story", "Robotics contest", "We won second place with a line follower")
        self.assertIn("Santos", mind.recall("who is my thesis adviser")[0]["text"])
        self.assertIn("line follower", mind.recall_text("robotics contest"))
        self.assertEqual(mind.recall_note("hello there"), "")
        self.assertIn("Santos", mind.recall_note("remember my adviser?"))

    def test_activity(self):
        self.assertEqual(mind.current_activity("pinakamain.py - Visual Studio Code"), "coding")
        self.assertEqual(mind.current_activity("Roblox"), "gaming")
        self.assertEqual(mind.current_activity("Calculator"), "")
        self.assertEqual(mind.activity_note("Notepad"), "")

    def test_styles(self):
        self.assertIn("tutor", mind.style_note("tutor"))
        self.assertEqual(mind.style_note("weird"), mind.STYLES["companion"])
        self.assertIn("911", mind.EMERGENCY_NOTE)

    def test_think_council_and_modes(self):
        with mock.patch.object(mind, "_ask", side_effect=lambda p: "answer") as ask:
            r = mind.think("council", "React or Flutter?")
            self.assertEqual(len(r["parts"]), len(mind.COUNCIL))
            self.assertEqual(ask.call_count, len(mind.COUNCIL) + 1)
            self.assertEqual(mind.think("what_if", "x")["answer"], "answer")
            self.assertIn("error", mind.think("what_if", ""))
            self.assertIn("error", mind.think("bad", "x"))
            mind.think("patterns", "")
            self.assertIn("matcha", ask.call_args.args[0])

    def test_tools_wired(self):
        names = {t["function"]["name"] for t in tools.TOOLS}
        for n in ("add_journal", "view_journal", "update_journal", "recall", "think"):
            self.assertIn(n, names)
            self.assertIn(n, tools._ACTIONS)
        out = tools.run_tool("add_journal", json.dumps({"kind": "idea", "title": "Water app"}))
        self.assertIn("Water app", out)
        self.assertIn("Water app", tools.run_tool("view_journal", "{}"))


if __name__ == "__main__":
    unittest.main()
