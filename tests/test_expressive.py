"""Tests for the human-sounding voice (senses/expressive.py): melody, pauses, breaths, laughs, pronunciations."""
import os, sys, tempfile, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
import numpy as np  # noqa: E402
import expressive as ex  # noqa: E402

SR = 22050


def voice(seconds=2.0, f0=200.0):
    """A fake voice: a buzzy tone with silence around it."""
    t = np.arange(int(SR * seconds)) / SR
    x = 0.3 * np.sign(np.sin(2 * np.pi * f0 * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t) ** 2)
    pad = np.zeros(int(SR * 0.1))
    return np.concatenate([pad, x, pad]).astype(np.float32)


def pitch(x):
    """Rough f0 from zero crossings."""
    s = np.sign(x[np.abs(x) > 0.01])
    return np.count_nonzero(np.diff(s) > 0) / (len(s) / SR)


class MelodyTests(unittest.TestCase):
    def test_length_stays_the_same_and_pitch_moves(self):
        x = voice()
        up = dict(ex.plan("Yay.", "excited", 1.0, 1.0, natural=False, seed=1), bounce=0, slope=0)
        y = ex.shape(x, SR, up)
        self.assertAlmostEqual(len(y) / len(x), 1.0, delta=0.06)
        self.assertGreater(pitch(y), pitch(x) * 1.12)                  # about +3 semitones
        down = dict(ex.plan("Oh.", "sad", 1.0, 1.0, natural=False, seed=1), slope=0, tremble=0)
        self.assertLess(pitch(ex.shape(x, SR, down)), pitch(x) * 0.93)
        self.assertTrue(np.isfinite(y).all())

    def test_questions_rise_and_flat_does_nothing(self):
        p = ex.plan("Are you coming?", "neutral", 0, 1.0, seed=3)
        s = ex.semitones(p, voice(), SR)
        self.assertGreater(s[-15] - s[len(s) // 2], 1.0)
        flat = ex.plan("Okay.", "happy", 1.0, 0.0, natural=False)
        x = voice(1.0)
        np.testing.assert_array_equal(ex.shape(x, SR, flat), x)

    def test_slider_scales_the_feeling(self):
        a = ex.plan("Great!", "happy", 1.0, 0.5, natural=False, seed=0)["mean"]
        b = ex.plan("Great!", "happy", 1.0, 1.5, natural=False, seed=0)["mean"]
        self.assertGreater(b, a * 2.5)


class SoundTests(unittest.TestCase):
    def test_vocalize(self):
        self.assertEqual(ex.vocalize("*giggles* You're silly"), ("Hehe! You're silly", None))
        self.assertEqual(ex.vocalize("*sighs* Fine."), ("Fine.", "sigh"))
        self.assertEqual(ex.vocalize("*gasps* No way!"), ("No way!", "gasp"))
        self.assertEqual(ex.vocalize("*waves* Hi!"), ("*waves* Hi!", None))     # left for the cleaner

    def test_breaths_and_pauses(self):
        p = ex.plan("This is a rather long sentence that goes on for quite a few words, really...", "neutral", 0, 1,
                    first=True, seed=2)
        self.assertGreaterEqual(p["pause"], 0.4)
        x = voice(1.0)
        y = ex.finish(x, SR, dict(p, breath="in"))
        self.assertGreater(len(y), len(x) + SR * 0.5)
        self.assertLess(np.abs(y[:int(SR * 0.3)]).max(), 0.15)             # the breath is quiet
        self.assertGreater(np.abs(y[:int(SR * 0.3)]).max(), 0.001)
        for kind in ("in", "sigh", "gasp"):
            self.assertTrue(np.isfinite(ex.breath(kind, SR)).all())
        self.assertEqual(ex.plan("Hi.", "neutral", 0, 0, natural=False)["pause"], 0)

    def test_split_pauses(self):
        parts = ex.split_pauses("Well... I guess so. Maybe — no, fine.")
        self.assertEqual([p for p, _ in parts], ["Well...", "I guess so. Maybe", "no, fine."])
        self.assertGreater(parts[0][1], 0.3)
        self.assertEqual(parts[-1][1], 0)
        self.assertEqual(ex.split_pauses("No pauses here."), [("No pauses here.", 0.0)])
        self.assertEqual(ex.split_pauses("Wait..."), [("Wait...", 0.0)])

    def test_speak_parts_joins_with_silence(self):
        synth = lambda t: (voice(0.5), SR)                                    # noqa: E731
        y, sr = ex.speak_parts("Hmm... okay then.", ex.plan("Hmm... okay then.", "neutral", 0, 1, seed=1), synth)
        self.assertEqual(sr, SR)
        self.assertGreater(len(y), 2 * len(voice(0.5)) + SR * 0.3)


class PronounceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = mock.patch.object(ex, "PRONUNCIATIONS_FILE", os.path.join(self.tmp, "p.json"))
        self.p.start()
        ex._user_cache["mtime"] = None

    def tearDown(self):
        self.p.stop()
        ex._user_cache["mtime"] = None

    def test_built_in_and_own_words(self):
        self.assertEqual(ex.pronounce("idk, btw the AI said hi"), "I don't know, by the way the A.I. said hi")
        self.assertEqual(ex.pronounce("I said ai"), "I said ai")                  # only the capital "AI"
        self.assertEqual(ex.pronounce("sooooo good"), "soo good")
        n = ex.save_pronunciations("Vermeil = Ver-may\n# a note\nbtw: between\nbad line")
        self.assertEqual(n, {"Vermeil": "Ver-may", "btw": "between"})
        self.assertEqual(ex.pronounce("Hi Vermeil, btw"), "Hi Ver-may, between")    # yours win
        self.assertIn("Vermeil = Ver-may", ex.pronunciations_text())
        self.assertEqual(ex.pronounce("idk", "ja"), "idk")                          # built-ins are English only


if __name__ == "__main__":
    unittest.main()
