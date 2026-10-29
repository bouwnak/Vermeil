"""Tests for tts.py (voice engine). No internet or speakers needed."""
import os
import sys
import json
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
for _name in ("sounddevice", "soundfile", "speech_recognition", "keyboard", "groq"):
    try:
        __import__(_name)
    except Exception:
        sys.modules[_name] = mock.MagicMock()

import tts  # noqa: E402
import pinakamain as pm  # noqa: E402


class SentenceTests(unittest.TestCase):
    def test_split_and_join_short(self):
        self.assertEqual(tts.split_sentences("Hi! Oh? This is a longer sentence here. And another long one, darling~ Bye."),
                         ["Hi! Oh? This is a longer sentence here.", "And another long one, darling~", "Bye."])
        self.assertEqual(tts.split_sentences(""), [])
        self.assertEqual(tts.split_sentences("No punctuation at all"), ["No punctuation at all"])


class VoiceNameTests(unittest.TestCase):
    def test_edge_names(self):
        self.assertTrue(tts.is_edge_voice("fil-PH-BlessicaNeural"))
        self.assertFalse(tts.is_edge_voice("af_heart"))
        self.assertFalse(tts.is_edge_voice(None))


class ListVoicesTests(unittest.TestCase):
    def test_offline_lists_installed_and_starter_voices(self):
        with mock.patch.object(tts, "_catalog", {}), mock.patch.object(tts, "installed_voices", return_value=["de_DE-thorsten-medium"]):
            voices = tts.list_voices()
        ids = [v["id"] for v in voices]
        self.assertIn("piper:de_DE-thorsten-medium", ids)
        self.assertIn(tts.DEFAULT_VOICE, ids)
        self.assertTrue(next(v for v in voices if v["id"] == "piper:de_DE-thorsten-medium")["installed"])
        self.assertEqual(next(v for v in voices if v["locale"] == "de-DE")["language"], "German (DE)")

    def test_old_edge_names_become_local(self):
        with mock.patch.object(tts, "_catalog", {"en_GB-alba-medium": {}}), mock.patch.object(tts, "installed_voices", return_value=[]):
            self.assertEqual(tts.to_local_voice("en-US-GuyNeural"), "piper:en_US-ryan-medium")
            self.assertEqual(tts.to_local_voice("en-GB-SoniaNeural"), "piper:en_GB-alba-medium")
            self.assertEqual(tts.to_local_voice("ja-JP-NanamiNeural"), tts.DEFAULT_VOICE)
            self.assertEqual(tts.to_local_voice("piper:x"), "piper:x")


class SpeakTests(unittest.TestCase):
    def test_plays_sentences_in_order_and_signals_ui(self):
        played, events, asked = [], [], []
        sd = mock.MagicMock()
        sd.play.side_effect = lambda data, sr: played.append(data)

        def submit(fn, text, voice, *a):
            asked.append((text, voice))
            f = mock.Mock()
            f.result.return_value = ([float(len(asked) - 1)] * 10, 1000)
            return f
        with mock.patch.dict(sys.modules, {"sounddevice": sd}), mock.patch.object(pm, "tts_ready", True), \
                mock.patch.object(pm.tts._pool, "submit", side_effect=submit), \
                mock.patch.object(pm, "ui_emit", events.append), mock.patch.object(pm, "WHOLE_REPLY", False):
            pm.speak("One sentence that is long enough. Two sentences that are long enough. Three is the last one here.",
                     voice="ja-JP-NanamiNeural")
        self.assertEqual([p[0] for p in played], [0.0, 1.0, 2.0])
        self.assertEqual({v for _, v in asked}, {"ja-JP-NanamiNeural"})
        self.assertEqual([e["on"] for e in events if e["type"] == "speaking"], [True, False])

    def test_tts_failure_does_not_crash(self):
        bad = mock.Mock()
        bad.result.side_effect = RuntimeError("offline")
        with mock.patch.dict(sys.modules, {"sounddevice": mock.MagicMock()}), mock.patch.object(pm, "tts_ready", True), \
                mock.patch.object(pm.tts._pool, "submit", return_value=bad):
            pm.speak("hello")


if __name__ == "__main__":
    unittest.main()
