import re
import unittest

import folders  # noqa: F401
import plugins
import voice_commands as vc


class VoiceCommandTests(unittest.TestCase):
    """every sidebar feature opens by voice, and Settings -> Help lists what you can say"""
    def test_every_sidebar_feature_has_commands(self):
        with open(folders.ROOT + "/ui/index.html", encoding="utf-8") as f:
            panels = set(re.findall(r'data-panel="([a-z]+)"', f.read()))
        for p in panels | {"adventure", "voice", "camera"}:
            self.assertIn(p, vc.BY_ID, p)
            self.assertTrue(vc.BY_ID[p]["say"], p)
        for f in vc.FEATURES:                                  # the plugin ids are real
            self.assertTrue(f["plugin"] is None or f["plugin"] in plugins.BY_ID, f["id"])

    def test_open_a_feature(self):
        for said, fid in (("open the gym", "gym"), ("show me my journal", "mind"), ("go to settings", "settings"),
                          ("open cooking", "kitchen"), ("pull up spotify", "spotify"), ("open games", "adventure"),
                          ("take me to the electronics lab", "electronics"), ("open my planner", "planner")):
            self.assertEqual(vc.parse(said), ("open", vc.BY_ID[fid]), said)

    def test_other_sentences_are_left_to_the_ai(self):
        for said in ("open notepad", "show my schedule", "start music", "start a 25 minute focus session",
                     "play some music", "what's the weather"):
            self.assertIsNone(vc.parse(said), said)

    def test_help_mic_and_camera(self):
        self.assertEqual(vc.parse("what can I say?")[0], "help")
        self.assertEqual(vc.parse("voice commands")[0], "help")
        self.assertEqual(vc.parse("stop listening")[0], "mic_off")
        self.assertEqual(vc.parse("camera off")[0], "camera_off")
        self.assertEqual(vc.parse("turn on the camera")[0], "camera_on")
        self.assertEqual(vc.parse("open the camera")[0], "camera_on")

    def test_catalogue_marks_missing_features(self):
        cat = {f["id"]: f for f in vc.catalogue(lambda pid: pid != "gym")}
        self.assertFalse(cat["gym"]["installed"])
        self.assertTrue(cat["chat"]["installed"])
        self.assertTrue(all(c["say"] and c["does"] for f in cat.values() for c in f["say"]))


if __name__ == "__main__":
    unittest.main()
