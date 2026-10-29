"""
test_avatar_creator.py - Unit tests for the PS1 Anime Avatar Creator feature.
"""
import io
import json
import os
import sys
import unittest
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import folders  # noqa: F401
import sandbox  # keeps test data isolated
import avatar_creator
import app


class TestAvatarCreator(unittest.TestCase):
    def setUp(self):
        self.api = app.Api()

    def test_presets_exist(self):
        presets = self.api.avatar_presets()
        self.assertIsInstance(presets, dict)
        self.assertIn("y2k_grunge_shaman", presets)
        self.assertIn("y2k_cyber_fairy", presets)
        self.assertIn("grunge_fairycore", presets)
        self.assertIn("dark_fairy", presets)
        self.assertIn("pastel_dream", presets)
        self.assertIn("retro_anime_protagonist", presets)

        # Verify picture-matched preset structure
        shaman = presets["y2k_grunge_shaman"]
        self.assertEqual(shaman["hair_style"], "cat_wolf_cut")
        self.assertEqual(shaman["eye_style"], "sleepy_grunge")
        self.assertEqual(shaman["top"], "asym_bell_sleeve")
        self.assertEqual(shaman["bottom"], "baggy_skater_pants")
        self.assertIn("golden_spear", shaman.get("accessories", []))

        # Verify cyber fairy structure
        p = presets["y2k_cyber_fairy"]
        self.assertIn("hair_style", p)
        self.assertIn("top", p)
        self.assertIn("bottom", p)
        self.assertIn("shoes", p)
        self.assertIn("skin_tone", p)

    def test_image_validation_invalid(self):
        # Empty string
        res = avatar_creator.process_reference_image("")
        self.assertFalse(res["ok"])
        self.assertIn("error", res)

        # Invalid base64 / non-image
        res = avatar_creator.process_reference_image("not-an-image")
        self.assertFalse(res["ok"])

    def test_procedural_fallback_analysis(self):
        # Create a test synthetic face-like RGB image
        im = Image.new("RGB", (128, 128), color=(245, 210, 195))
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        import base64
        b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

        res = self.api.avatar_analyze(b64, "grunge_fairycore")
        self.assertTrue(res["ok"])
        self.assertIn(res["source"], ("procedural_fallback", "ai_vision"))
        attrs = res["attributes"]
        self.assertIn("skin_tone", attrs)
        self.assertIn("hair_color", attrs)
        self.assertIn("hair_style", attrs)

    def test_preset_crud(self):
        test_id = "test_fairy_preset"
        test_data = {
            "name": "Custom Test Fairy",
            "hair_style": "twin_buns",
            "hair_color": "#ff0077",
            "top": "corset_cami",
            "bottom": "tulle_skirt",
            "wings": True,
        }

        # Save
        saved = self.api.avatar_save_preset(test_id, test_data)
        self.assertIn(test_id, saved)
        self.assertEqual(saved[test_id]["name"], "Custom Test Fairy")

        # Delete
        cleaned = self.api.avatar_delete_preset(test_id)
        self.assertNotIn(test_id, cleaned)

    def test_apply_as_character(self):
        # Test saving and applying avatar as active Vermeil character
        fake_glb_bytes = b"glTF\x02\x00\x00\x00\x14\x00\x00\x00JSON\x00\x00{}"
        import base64
        glb_b64 = base64.b64encode(fake_glb_bytes).decode("ascii")

        orig_active = self.api.get_state().get("active")
        res = self.api.avatar_apply_as_character("Neko Shaman Test", glb_b64, "Test prompt")
        self.assertTrue(res.get("ok"))
        self.assertTrue(res.get("model", "").endswith(".glb"))
        self.assertIn("avatar_", res.get("id", ""))
        self.assertIn("state", res)

        # Check character in state
        active_char = next((c for c in res["state"]["characters"] if c["id"] == res["id"]), None)
        self.assertIsNotNone(active_char)
        self.assertEqual(active_char["name"], "Neko Shaman Test")
        self.assertEqual(res["state"]["active"], res["id"])

        # Clean up
        if orig_active:
            self.api.set_active(orig_active)
        self.api.delete_character(res["id"])
        for base in (avatar_creator.BASE_DIR, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))):
            p = os.path.join(base, "ui", "models", res["model"])
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass


if __name__ == "__main__":
    unittest.main()
