"""Tests for the emotional voice (senses/voice_emotion.py and SpeechStream)."""
import os, sys, unittest
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

import voice_emotion as ve  # noqa: E402
import pinakamain as pm  # noqa: E402


class DetectTests(unittest.TestCase):
    def emo(self, text):
        return ve.detect(text, pm.analyzer)[0]

    def test_actions_and_emoji_win(self):
        self.assertEqual(self.emo("*giggles* You're silly."), "happy")
        self.assertEqual(self.emo("*sighs* Okay, fine."), "sad")
        self.assertEqual(self.emo("*gasps* You did it?"), "surprised")
        self.assertEqual(self.emo("*whispers* Come closer."), "soft")
        self.assertEqual(self.emo("That's mean 😠"), "angry")
        self.assertEqual(self.emo("I missed you 🥺"), "sad")

    def test_words_and_punctuation(self):
        self.assertEqual(self.emo("Wow, really?!"), "surprised")
        self.assertEqual(self.emo("I love it, this is amazing!!"), "excited")
        self.assertEqual(self.emo("That's wonderful, I'm so glad."), "happy")
        self.assertEqual(self.emo("I hate this, it's terrible!"), "angry")
        self.assertEqual(self.emo("I'm sorry, that's really sad."), "sad")
        self.assertEqual(self.emo("The meeting is at three."), "neutral")

    def test_prosody_scales_with_the_slider(self):
        self.assertEqual(ve.prosody("neutral"), (0, 0, 1.0, None))
        rate, pitch, vol, face = ve.prosody("sad", 1.0, 1.0)
        self.assertLess(rate, 0); self.assertLess(pitch, 0); self.assertLess(vol, 1); self.assertEqual(face, "sad")
        self.assertEqual(ve.prosody("excited", 1.0, 0.0), (0, 0, 1.0, None))          # 0% = flat voice
        self.assertGreater(ve.prosody("excited", 1.0, 1.5)[1], ve.prosody("excited", 1.0, 1.0)[1])


class StreamTests(unittest.TestCase):
    def test_each_sentence_gets_its_own_voice(self):
        calls = []
        pool = mock.Mock()
        pool.submit = lambda fn, text, voice, rate, pitch, fb, clone, style: calls.append((text, rate, pitch, style)) or mock.Mock()
        with mock.patch.object(pm, "tts_ready", True), mock.patch.object(pm.tts, "_pool", pool), \
                mock.patch.object(pm, "VOICE_EMOTION", 1.0), mock.patch.object(pm.SpeechStream, "_start"):
            ss = pm.SpeechStream(voice="piper:x", rate="+0%", pitch="+0Hz")
            ss._push("*giggles* That's so wonderful!")
            ss._push("*nods* The bus leaves at nine.")                             # still a bit happy (the mood lasts)
            ss._push("It has twelve seats.")
            ss._push("The bus leaves at nine.")
            items = [ss.q.get_nowait() for _ in range(4)]
        self.assertEqual(calls[0][0], "That's so wonderful!")                    # she talks plainly: no "Hehe!"
        self.assertEqual(calls[1][0], "The bus leaves at nine.")                  # other *actions* aren't read aloud
        self.assertNotEqual(calls[0][1], "+0%")
        self.assertEqual(calls[3][1:3], ("+0%", "+0Hz"))                         # the mood has faded
        self.assertEqual(items[0][3], "happy")
        self.assertIsNone(items[3][3])
        styles = [c[3] for c in calls]
        self.assertEqual(styles[0]["emotion"], "happy")
        self.assertEqual(styles[1]["emotion"], "happy")
        self.assertEqual(styles[3]["emotion"], "neutral")
        self.assertGreater(styles[0]["mean"], styles[3]["mean"] + 0.5)            # happy = a higher melody

    def test_sigh_alone_is_heard(self):
        pool = mock.Mock()
        pool.submit = mock.Mock(return_value=mock.Mock())
        with mock.patch.object(pm, "tts_ready", True), mock.patch.object(pm.tts, "_pool", pool), \
                mock.patch.object(pm, "VOICE_EMOTION", 1.0), mock.patch.object(pm.SpeechStream, "_start"):
            ss = pm.SpeechStream(voice="piper:x", rate="+0%", pitch="+0Hz")
            ss._push("*sighs*")
        import expressive
        self.assertIs(pool.submit.call_args[0][0], expressive.breath_only)

    def test_zero_emotion_is_flat(self):
        calls = []
        pool = mock.Mock()
        pool.submit = lambda fn, text, voice, rate, pitch, *a: calls.append((rate, pitch)) or mock.Mock()
        with mock.patch.object(pm, "tts_ready", True), mock.patch.object(pm.tts, "_pool", pool), \
                mock.patch.object(pm, "VOICE_EMOTION", 0), mock.patch.object(pm, "VOICE_NATURAL", False), \
                mock.patch.object(pm.SpeechStream, "_start"):
            ss = pm.SpeechStream(voice="piper:x", rate="+0%", pitch="+0Hz")
            ss._push("*sobs* This is the worst day ever.")
        self.assertEqual(calls, [("+0%", "+0Hz")])


if __name__ == "__main__":
    unittest.main()
