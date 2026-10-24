"""Batch 1: thinking skills, practice conversations, self-check, adaptive humor."""
import os, sys, json, shutil, tempfile, unittest
from types import SimpleNamespace
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import mind, llm  # noqa: E402


def reply(text):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text, tool_calls=None))])


class Batch1Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(mind, n, os.path.join(self.tmp, f)) for n, f in
                  (("JOURNAL_FILE", "j.json"), ("ARCHIVE_FILE", "a.json"), ("MEMORY_FILE", "m.json"), ("PRACTICE_FILE", "p.json"))]
        for p in self.p: p.start()

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)

    def test_every_new_mode_runs(self):
        for mode in ("hypothesis", "causal", "blindspot", "modeling", "contradiction", "drift"):
            with mock.patch.object(mind, "_ask", return_value="ok") as ask:
                self.assertEqual(mind.think(mode, "x")["answer"], "ok")
            if mode in mind.NEEDS_DATA:
                self.assertIn("The user's data", ask.call_args.args[0])
        with mock.patch.object(mind, "_ask", return_value="ok"):
            self.assertIn("Routine facts", mind.drift_data())

    def test_step_modes_return_steps_for_a_goal(self):
        data = {"answer": "## Plan", "goal": "Write chapter 3", "steps": ["Open the doc", "Write 3 lines", ""]}
        with mock.patch.object(llm, "ask", return_value=data):
            r = mind.think("procrastination", "Write chapter 3")
        self.assertEqual((r["goal"], r["steps"]), ("Write chapter 3", ["Open the doc", "Write 3 lines"]))

    def test_evolve_keeps_the_best(self):
        answers = [{"criteria": ["cheap", "quiet"], "solutions": ["fan", "ice", "window"]},
                   {"scores": [{"solution": "fan", "total": 14, "weakness": "noisy"}, {"solution": "ice", "total": 9}]},
                   {"solutions": ["quiet fan", "fan + ice"]},
                   {"scores": [{"solution": "quiet fan", "total": 18, "weakness": "price"}]},
                   {"solutions": ["cheap quiet fan"]},
                   {"scores": [{"solution": "cheap quiet fan", "total": 19, "weakness": "-"}]}]
        with mock.patch.object(llm, "ask", side_effect=answers):
            r = mind.think("evolve", "keep room cool")
        self.assertIn("cheap quiet fan", r["answer"])
        self.assertEqual(len(r["parts"]), 3)

    def test_debate_and_reflection(self):
        with mock.patch.object(mind, "_chat", return_value="But consider the cost."):
            p = mind.practice_start("debate", "AI will replace engineers")
            self.assertIn("argue the other side", p["messages"][0]["content"])
            p = mind.practice_reply(p["id"], "It can't sign plans.")
            self.assertEqual([m["role"] for m in p["messages"]], ["assistant", "user", "assistant"])
        with mock.patch.object(mind, "_ask", return_value="Total 34/50"):
            p = mind.practice_finish(p["id"])
        self.assertEqual(p["score"], "Total 34/50")
        with mock.patch.object(mind, "_chat", return_value="What happened first?"):
            r = mind.practice_start("reflect", "My first competition")
        self.assertEqual(r["messages"][0]["content"], "What happened first?")      # hidden 'start now' prompt removed
        with mock.patch.object(mind, "_ask", return_value="You learned to pace yourself."):
            mind.practice_finish(r["id"])
        self.assertEqual(mind.list_journal("story")[0]["text"], "You learned to pace yourself.")
        self.assertIn("error", mind.practice_start("debate", " "))
        self.assertEqual(len(mind.practice_list()), 2)

    def test_rehearsal_level_in_prompt(self):
        with mock.patch.object(mind, "_chat", return_value="Tell me about yourself.") as chat:
            r = mind.practice_start("rehearse", "Job interview", level=9)
        self.assertEqual(r["level"], 5)
        self.assertIn("level 5/5", chat.call_args.args[0][0]["content"])

    def test_self_check_and_humor(self):
        with mock.patch.object(llm, "ask", return_value={"ok": False, "fixed": "2 + 2 = 4"}):
            self.assertEqual(mind.self_check("2+2?", "2 + 2 = 5"), "2 + 2 = 4")
        with mock.patch.object(llm, "ask", return_value={"ok": True}):
            self.assertEqual(mind.self_check("2+2?", "4"), "4")
        with mock.patch.object(llm, "ask", side_effect=RuntimeError("down")):
            self.assertEqual(mind.self_check("q", "a"), "a")
        self.assertIn("no sarcasm", mind.humor_note(3, "sad"))
        self.assertIn("sarcastic", mind.humor_note(3, "happy"))


if __name__ == "__main__":
    unittest.main()
