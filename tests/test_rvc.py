"""Tests for RVC voice clones (senses/rvc.py, Characters -> Voice clone) - no helper models needed."""
import os, sys, json, shutil, tempfile, unittest
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

import numpy as np  # noqa: E402
import torch  # noqa: E402
import rvc  # noqa: E402
import pinakamain as pm  # noqa: E402
import app  # noqa: E402

RICK = os.path.join(os.path.expanduser("~"), "Downloads", "Rick%20Sanchez", "model.pth")


def _fake_pth(folder, name="model.pth", sr="40k"):
    """A tiny file shaped like an RVC voice (only what read_model_info looks at)."""
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    torch.save({"weight": {"enc_p.emb_phone.weight": torch.zeros(2, 768)}, "config": [1025, 32, 192, sr],
                "version": "v2", "f0": 1}, path)
    return path


class NameTests(unittest.TestCase):
    def test_folder_names_become_nice_voice_names(self):
        self.assertEqual(rvc._clean_name("Rick%20Sanchez"), "Rick Sanchez")
        self.assertEqual(rvc._clean_name("Ash Ketchum (Pokémon Masters EX) - Weights Model"), "Ash Ketchum (Pokemon Masters EX)")
        self.assertEqual(rvc._clean_name("Bubbles_e300_s6600"), "Bubbles")
        self.assertEqual(rvc._clean_name("SatoruGojo_JP"), "SatoruGojo JP")
        self.assertEqual(rvc._clean_name("../../evil"), "evil")          # no climbing out of data\rvc_voices
        self.assertEqual(rvc._clean_name(""), "Voice")

    def test_language_from_the_writing(self):
        self.assertEqual(rvc.text_language("こんにちは"), "ja")
        self.assertEqual(rvc.text_language("안녕하세요"), "ko")
        self.assertIsNone(rvc.text_language("Kumusta ka?"))

    def test_base_voice_per_language(self):
        own = "en-US-AriaNeural"
        self.assertEqual(rvc.base_voice({"base": "own"}, "ja", own), own)
        self.assertEqual(rvc.base_voice({"base": "male"}, "ja", own), rvc.BASE_VOICES["ja"][1])
        self.assertEqual(rvc.base_voice({"base": "female"}, "tl", own), rvc.BASE_VOICES["fil"][0])
        self.assertEqual(rvc.base_voice({"base": "female"}, "ko", own), rvc.BASE_VOICES["ko"][0])
        self.assertEqual(rvc.base_voice({"base": "male"}, "xx", own), own)   # unknown language -> her own voice

    def test_high_and_low_voices(self):
        own = "en-US-AriaNeural"
        self.assertEqual(rvc.base_voice({"base": "male_low"}, "ja", own), rvc.BASE_VOICES["ja"][1])
        self.assertEqual(rvc.base_voice({"base": "female_high"}, "ko", own), rvc.BASE_VOICES["ko"][0])
        self.assertEqual([rvc.base_shift({"base": b}) for b in ("female_high", "female", "female_low", "male_low", "own")],
                         [4, 0, -4, -4, 0])
        import app
        self.assertEqual(app.RVC_BASES, rvc.BASE_CHOICES)
        self.assertEqual(app._rvc_settings({"model": "x", "base": "male_high"})["base"], "male_high")
        self.assertEqual(app._rvc_settings({"model": "x", "base": "weird"})["base"], "own")


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.voices = os.path.join(self.tmp, "voices")
        self.patch = mock.patch.object(rvc, "VOICES_DIR", self.voices)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_import_copies_and_lists_then_deletes(self):
        src = os.path.join(self.tmp, "Rick%20Sanchez")
        pth = _fake_pth(src)
        for f in ("trained_IVF.index", "added_IVF.index"):
            with open(os.path.join(src, f), "wb") as fh:
                fh.write(b"x")
        info = rvc.import_voice(pth)
        self.assertEqual(info["sr"], 40000)
        voices = rvc.list_voices()
        self.assertEqual([v["name"] for v in voices], ["Rick Sanchez"])     # "model.pth" -> the folder's name
        self.assertTrue(voices[0]["has_index"])
        self.assertTrue(os.path.exists(pth))                                # the original is left alone
        self.assertEqual(rvc.delete_voice("Rick Sanchez"), [])
        self.assertTrue(os.path.exists(pth))

    def test_rejects_files_that_arent_rvc_voices(self):
        bad = os.path.join(self.tmp, "x.pth")
        torch.save({"model": {}}, bad)
        with self.assertRaises(ValueError):
            rvc.import_voice(bad)
        with self.assertRaises(ValueError):
            rvc.import_voice(os.path.join(self.tmp, "nothing.pth"))


class WeightNormTests(unittest.TestCase):
    def test_folds_both_ways_of_saving(self):
        v = torch.randn(4, 3, 5)
        g = torch.rand(4, 1, 1) + 0.5
        want = g * v / v.norm(dim=(1, 2), keepdim=True)
        for gk, vk in (("weight_g", "weight_v"), ("parametrizations.weight.original0", "parametrizations.weight.original1")):
            out = rvc._fold_weight_norm({f"conv.{gk}": g, f"conv.{vk}": v, "conv.bias": torch.zeros(4)})
            self.assertEqual(sorted(out), ["conv.bias", "conv.weight"])
            self.assertTrue(torch.allclose(out["conv.weight"], want, atol=1e-5))


class SettingsTests(unittest.TestCase):
    def test_rvc_settings_are_cleaned(self):
        self.assertEqual(app._rvc_settings(None), {})
        self.assertEqual(app._rvc_settings({"model": " "}), {})
        s = app._rvc_settings({"model": "Rick Sanchez", "pitch": "99", "index_rate": 3, "protect": -1, "base": "robot"})
        self.assertEqual(s, {"model": "Rick Sanchez", "pitch": 24, "index_rate": 1.0, "protect": 0.0, "base": "own"})


class SpeakTests(unittest.TestCase):
    def test_no_clone_uses_the_normal_voice(self):
        with mock.patch.object(pm.tts, "synth", return_value=("A", 24000)) as synth:
            self.assertEqual(pm.synth_voice("Hi.", "v", "+0%", "+0Hz", "fb", None), ("A", 24000))
        synth.assert_called_once()

    def test_clone_converts_and_falls_back_if_it_fails(self):
        cfg = {"model": "Rick Sanchez", "base": "male"}
        with mock.patch.object(pm.tts, "synth", return_value=("A", 24000)) as synth, \
                mock.patch.object(rvc, "convert", return_value=("B", 40000)):
            self.assertEqual(pm.synth_voice("こんにちは", "v", "+0%", "+0Hz", "fb", cfg), ("B", 40000))
        self.assertEqual(synth.call_args.args[1], rvc.BASE_VOICES["ja"][1])   # a Japanese male voice speaks first
        with mock.patch.object(pm.tts, "synth", return_value=("A", 24000)), \
                mock.patch.object(rvc, "convert", side_effect=RuntimeError("no models")):
            self.assertEqual(pm.synth_voice("Hello.", "v", "+0%", "+0Hz", "fb", cfg), ("A", 24000))


@unittest.skipUnless(os.path.exists(RICK), "the Rick Sanchez reference voice isn't in Downloads")
class RealModelTests(unittest.TestCase):
    def test_a_real_voice_loads_and_makes_sound(self):
        tmp = tempfile.mkdtemp()
        try:
            with mock.patch.object(rvc, "VOICES_DIR", tmp), mock.patch.dict(rvc._cache["models"], clear=True):
                rvc.import_voice(RICK, name="Rick")
                net, info = rvc._load_model("Rick")
                frames = 100
                with torch.no_grad():
                    out = net.infer(torch.randn(1, frames, 768), torch.LongTensor([frames]),
                                    torch.randint(1, 255, (1, frames)), torch.full((1, frames), 200.0), torch.LongTensor([0]))
                self.assertEqual(out.shape[-1], frames * info["sr"] // 100)
                self.assertTrue(np.isfinite(out.numpy()).all())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
