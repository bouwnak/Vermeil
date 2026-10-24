"""The 'copy a character' box under Personality: Rick Sanchez -> a Personality text that talks like Rick."""
import inspect
import unittest
from unittest import mock

import folders  # noqa: F401
import app
import llm

API = next(c for _, c in inspect.getmembers(app, inspect.isclass) if hasattr(c, "make_personality"))


class MakePersonality(unittest.TestCase):
    def test_writes_a_personality_like_the_character(self):
        fake = 'Here is the prompt:\n"**You are Rick Sanchez.** You burp mid-sentence. Keep replies under 40 words."'
        with mock.patch.object(llm, "ask", return_value=fake) as ask:
            r = API.make_personality(None, "  rick   sanchez ", "")
        self.assertEqual(r["name"], "Rick Sanchez")
        self.assertEqual(r["prompt"], "You are Rick Sanchez. You burp mid-sentence. Keep replies under 40 words.")
        self.assertIn("rick sanchez", ask.call_args[0][0])

    def test_keeps_her_own_name(self):
        with mock.patch.object(llm, "ask", return_value="You are Pip, talking exactly like Jake the Dog. Dude!") as ask:
            API.make_personality(None, "Jake the Dog", "Pip")
        self.assertIn('Start with "You are Pip, talking exactly like Jake the Dog"', ask.call_args[0][0])

    def test_empty_box_and_ai_errors(self):
        self.assertIn("error", API.make_personality(None, "   "))
        with mock.patch.object(llm, "ask", side_effect=RuntimeError("offline")):
            self.assertIn("offline", API.make_personality(None, "Jake")["error"])


if __name__ == "__main__":
    unittest.main()
