"""The Unity adventure's voice server: only the companion uses the voice clone, everyone else the fast offline voices."""
import json, os, sys, tempfile, unittest
from unittest import mock
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "game_tools"))
import folders  # noqa
import sandbox  # noqa: E402,F401
from game import voices  # noqa: E402

CLONE = {"model": "Vermeil.pth", "pitch": 0}


class FakeTTS:
    """records which voice said what, makes 0.1 s of silence"""
    def __init__(self): self.calls = []
    def synth(self, text, voice, rate, pitch, *rest):
        self.calls.append(voice)
        return [0.0] * 2205, 22050
    def to_wav_bytes(self, samples, rate): return b"RIFF"


class CloneOnlyForCompanion(unittest.TestCase):
    def setUp(self):
        self.old = voices.COMPANION_CLONE
        voices.COMPANION_CLONE = CLONE
        voices._cache.clear()

    def tearDown(self):
        voices.COMPANION_CLONE = self.old
        voices._cache.clear()

    def test_clone_for_picks_only_the_companion(self):
        self.assertEqual(voices.clone_for("vermeil"), CLONE)
        for who in ("dm", "smith", "trader", "ally", "elder"):
            self.assertIsNone(voices.clone_for(who))

    def test_no_clone_without_a_model(self):
        voices.COMPANION_CLONE = {"model": ""}
        self.assertIsNone(voices.clone_for("vermeil"))
        voices.COMPANION_CLONE = None
        self.assertIsNone(voices.clone_for("vermeil"))

    def test_npcs_never_go_through_rvc(self):
        camp = {"voices": {"dm": {"voice": "piper:a"}, "smith": {"voice": "piper:b"}, "vermeil": {"voice": "piper:c"}}}
        fake = FakeTTS()
        with mock.patch.object(voices, "_tts", return_value=fake), \
             mock.patch.object(voices, "online_ready", return_value=False), \
             mock.patch.object(voices, "_cloned", return_value=([0.0] * 100, 22050)) as cloned:
            self.assertIn("audio", voices.speak(camp, "smith", "Fine steel today."))
            self.assertIn("audio", voices.speak(camp, "dm", "The road bends north."))
            cloned.assert_not_called()
            self.assertEqual(fake.calls, ["piper:b", "piper:a"])
            self.assertIn("audio", voices.speak(camp, "vermeil", "Let's go!"))
            cloned.assert_called_once()


class ServerCompanion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import unity_voice_server
        cls.srv = unity_voice_server

    def write(self, data):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "characters.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return p

    def test_reads_the_active_character_and_its_clone(self):
        p = self.write({"active": "b", "characters": [{"id": "a", "name": "Ann"},
                                                       {"id": "b", "name": "Bea", "rvc": {"model": "bea.pth"}}]})
        with mock.patch.object(self.srv, "data_file", return_value=p):
            c = self.srv.companion()
        self.assertEqual(c["name"], "Bea")
        self.assertEqual(c["rvc"], {"model": "bea.pth"})

    def test_no_clone_when_the_character_has_none(self):
        p = self.write({"active": "a", "characters": [{"id": "a", "name": "Ann", "rvc": {"model": ""}}]})
        with mock.patch.object(self.srv, "data_file", return_value=p):
            c = self.srv.companion()
        self.assertIsNone(c["rvc"])
        self.assertFalse(c["voice"].startswith("kokoro:"))     # the game stays offline-fast

    def test_broken_file_falls_back_to_vermeil(self):
        with mock.patch.object(self.srv, "data_file", return_value=os.path.join(tempfile.mkdtemp(), "missing.json")):
            c = self.srv.companion()
        self.assertEqual(c["name"], "Vermeil")
        self.assertIsNone(c["rvc"])

    def test_every_village_person_has_a_voice(self):
        for who in self.srv.NPCS:
            self.assertIn(who, self.srv.CAMP["voices"])
        self.assertIn("vermeil", self.srv.CAMP["voices"])

    def test_unknown_speaker_uses_the_narrator(self):
        with mock.patch.object(self.srv.voices, "speak", return_value={"audio": ""}) as sp:
            self.srv.say("nobody", "hi")
        self.assertEqual(sp.call_args[0][1], "dm")


if __name__ == "__main__":
    unittest.main()
