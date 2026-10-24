"""Tests for the local Kokoro voice (senses/kokoro.py) - no real Kokoro model needed."""
import io
import os
import sys
import wave
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import folders  # noqa: F401,E402
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import numpy as np  # noqa: E402
import kokoro  # noqa: E402


def _wav(seconds=0.5, sr=24000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.sin(np.linspace(0, 300, int(sr * seconds))) * 8000).astype(np.int16).tobytes())
    return buf.getvalue()


class KokoroTests(unittest.TestCase):
    def test_synth_runs_inside_the_app(self):
        eng = mock.Mock()
        eng.create.return_value = (np.zeros(12000, dtype=np.float32), 24000)
        with mock.patch.dict(kokoro._state, {"engine": eng, "ready": True}), mock.patch.dict(os.environ, {"KOKORO_URL": ""}):
            data, sr = kokoro.synth("Hello there.", "kokoro:bf_emma", "+10%", "+0Hz")
        self.assertEqual(sr, 24000)
        self.assertAlmostEqual(len(data) / sr, 0.5, places=2)
        kw = eng.create.call_args.kwargs
        self.assertEqual(kw["voice"], "bf_emma")
        self.assertEqual(kw["lang"], "en-gb")              # the accent comes from the voice name
        self.assertAlmostEqual(kw["speed"], 1.1, places=2)

    def test_server_mode_when_kokoro_url_is_set(self):
        resp = mock.Mock(status_code=200, content=_wav())
        resp.raise_for_status = lambda: None
        import requests
        with mock.patch.object(requests, "post", return_value=resp) as post, mock.patch.dict(os.environ, {"KOKORO_URL": "http://127.0.0.1:8880"}):
            data, sr = kokoro.synth("Hi.", "kokoro:af_bella")
        self.assertEqual(sr, 24000)
        self.assertEqual(post.call_args.kwargs["json"]["voice"], "af_bella")

    def test_voice_list_works_before_the_server_is_up(self):
        with mock.patch.object(kokoro, "ready", return_value=False):
            vs = kokoro.list_voices()
        ids = [v["id"] for v in vs]
        self.assertIn("kokoro:af_heart", ids)
        heart = next(v for v in vs if v["id"] == "kokoro:af_heart")
        self.assertEqual(heart["gender"], "Female")
        self.assertEqual(heart["language"], "English (US)")

    def test_start_explains_what_is_missing(self):
        with mock.patch.dict(os.environ, {"KOKORO_URL": "", "KOKORO_MODEL_DIR": "/nonexistent/kokoro"}), \
                mock.patch.dict(kokoro._state, {"ready": False, "starting": False}):
            self.assertFalse(kokoro.start())
            self.assertIn("setup_kokoro", kokoro.status()["error"])

    def test_start_loads_in_the_background_without_docker(self):
        with mock.patch.dict(os.environ, {"KOKORO_URL": ""}), mock.patch.object(kokoro, "_missing", return_value=""), \
                mock.patch.dict(kokoro._state, {"ready": False, "starting": False}), \
                mock.patch.object(kokoro.threading, "Thread") as th:
            self.assertFalse(kokoro.start())                 # returns straight away
        th.assert_called_once()
        self.assertIs(th.call_args.kwargs["target"], kokoro._load)
        self.assertNotIn("subprocess", open(kokoro.__file__, encoding="utf-8").read())   # no server, no Docker

    def test_game_uses_kokoro_only_when_online(self):
        from game import voices
        camp = {"voices": {"vermeil": {"voice": "piper:en_US-amy-medium", "rate": "+0%", "pitch": "+0Hz"}}, "npcs": {}}
        voices.VERMEIL_ONLINE = "kokoro:af_heart"
        calls = []
        fake_tts = mock.Mock(synth=lambda text, v, r, p, *fb: calls.append(v) or (np.zeros(2400, dtype=np.float32), 24000),
                             to_wav_bytes=lambda s, r: b"RIFF")
        with mock.patch.object(voices, "_tts", return_value=fake_tts):
            with mock.patch.object(voices, "online_ready", return_value=True):
                voices.speak(camp, "vermeil", "Hi")
            with mock.patch.object(voices, "online_ready", return_value=False):
                voices.speak(camp, "vermeil", "Hi")
        self.assertEqual(calls, ["kokoro:af_heart", "piper:en_US-amy-medium"])
        self.assertTrue(voices.online_voice(camp, "dm").startswith("kokoro:"))
        self.assertEqual(voices.online_voice(camp, "N7"), voices.online_voice(camp, "N7"))   # an NPC keeps the same voice


if __name__ == "__main__":
    unittest.main()
