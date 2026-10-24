"""The Emotional voice (Chatterbox): *laughs* become [laugh], English only, and it falls back to the normal voice."""
import unittest
from unittest import mock

import numpy as np

import folders  # noqa: F401
import chatter
import pinakamain as pm


class Tags(unittest.TestCase):
    def test_actions_become_sounds(self):
        self.assertEqual(chatter.tagged("*giggles* You're silly!"), "[laugh] You're silly!")
        self.assertEqual(chatter.tagged("Well *sighs* fine."), "Well [sigh] fine.")
        self.assertEqual(chatter.tagged("Heh *chuckles* nice."), "Heh [chuckle] nice.")
        self.assertEqual(chatter.tagged("*waves* Hi!"), "Hi!")                     # other actions aren't read out

    def test_clear_feelings_get_a_tag(self):
        self.assertEqual(chatter.with_mood("Yay, you're back!", "excited", 0.8), "[happy] Yay, you're back!")
        self.assertEqual(chatter.with_mood("I missed you.", "sad", 0.5), "I missed you.")        # not clear enough
        self.assertEqual(chatter.with_mood("Okay.", "neutral", 1.0), "Okay.")
        self.assertEqual(chatter.with_mood("[angry] No!", "angry", 0.9), "[angry] No!")       # not twice

    def test_unknown_brackets_are_dropped(self):
        self.assertEqual(chatter.tagged("Oh [laugh] wow [smiles] ok"), "Oh [laugh] wow ok")


class WhenToUse(unittest.TestCase):
    def setUp(self):
        self.p = [mock.patch.object(pm, "VOICE_CHATTER", True), mock.patch.object(pm, "heard_language", None),
                  mock.patch.dict(pm.persona, {"language": "auto"})]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in self.p:
            p.stop()

    def test_english_only(self):
        self.assertTrue(pm._use_chatter("Hello there [laugh]"))
        self.assertFalse(pm._use_chatter("こんにちは、元気ですか"))
        with mock.patch.dict(pm.persona, {"language": "ja"}):
            self.assertFalse(pm._use_chatter("Hello"))
        with mock.patch.object(pm, "VOICE_CHATTER", False):
            self.assertFalse(pm._use_chatter("Hello"))

    def test_synth_uses_chatterbox_then_falls_back(self):
        wav = np.zeros(2400, np.float32)
        with mock.patch.object(chatter, "synth", return_value=(wav, 24000)) as cs, \
                mock.patch.object(pm.tts, "synth") as normal:
            s, sr = pm.synth_voice("Hi [laugh]", "piper:en_US-amy-medium", "+0%", "+0Hz", pm.tts.DEFAULT_VOICE)
        self.assertEqual(sr, 24000)
        self.assertEqual(cs.call_args[0][0], "Hi [laugh]")
        normal.assert_not_called()
        with mock.patch.object(chatter, "synth", side_effect=RuntimeError("no model")), \
                mock.patch.object(pm.tts, "synth", return_value=(wav, 22050)) as normal:
            s, sr = pm.synth_voice("Hi [laugh]", "piper:en_US-amy-medium", "+0%", "+0Hz", pm.tts.DEFAULT_VOICE)
        self.assertEqual(sr, 22050)
        self.assertEqual(normal.call_args[0][0], "Hi")                            # the tag isn't read out


if __name__ == "__main__":
    unittest.main()
