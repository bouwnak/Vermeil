"""Turtle Island: its save can't be lost, and its data files agree with each other and with the asset packs."""
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "skills"))
import folders  # noqa: E402,F401
import turtlesave  # noqa: E402

UI = os.path.join(ROOT, "ui")
with open(os.path.join(UI, "turtle", "data.js"), encoding="utf-8") as f:
    DATA = f.read()


class Save(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        p = os.path.join(self.dir, "t.json")
        for name, value in (("FILE", p), ("BACKUP", p + ".bak")):
            patch = mock.patch.object(turtlesave, name, value)
            patch.start()
            self.addCleanup(patch.stop)

    def test_saved_comes_back(self):
        self.assertTrue(turtlesave.save({"version": 1, "money": 5})["ok"])
        self.assertEqual(turtlesave.load()["money"], 5)

    def test_nothing_saved_yet(self):
        self.assertIsNone(turtlesave.load())

    def test_a_damaged_save_falls_back_to_the_last_good_one(self):
        turtlesave.save({"version": 1, "money": 1})
        turtlesave.save({"version": 1, "money": 2})
        with open(turtlesave.FILE, "w", encoding="utf-8") as f:
            f.write("{broken")
        self.assertEqual(turtlesave.load()["money"], 1)

    def test_a_damaged_file_never_replaces_the_backup(self):
        turtlesave.save({"version": 1, "money": 1})
        turtlesave.save({"version": 1, "money": 2})
        with open(turtlesave.FILE, "w", encoding="utf-8") as f:
            f.write("{broken")
        turtlesave.save({"version": 1, "money": 3})
        with open(turtlesave.BACKUP, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["money"], 1)

    def test_a_bad_state_is_refused(self):
        self.assertIn("error", turtlesave.save({"money": 1}))
        self.assertIn("error", turtlesave.save("nope"))

    def test_no_temporary_files_left(self):
        turtlesave.save({"version": 1})
        self.assertEqual([f for f in os.listdir(self.dir) if f.endswith(".tmp")], [])


class Content(unittest.TestCase):
    def test_every_model_the_game_names_exists(self):
        assets = os.path.join(UI, "game", "assets")
        named = re.findall(r'"([\w ]+/[\w ]+\.(?:glb|gltf))"', DATA)
        self.assertGreater(len(named), 2)
        for rel in named:
            self.assertTrue(os.path.exists(os.path.join(assets, rel)), rel)

    def test_every_crop_model_exists(self):
        foods = {"FOOD": "conv_ultimate_food_pack", "GROWN": "conv_ultimate_nature_pack"}
        found = re.findall(r"ripe: `\$\{(\w+)\}(\w+\.glb)`", DATA)
        self.assertGreater(len(found), 5)
        for pack, name in found:
            self.assertTrue(os.path.exists(os.path.join(UI, "game", "assets", foods[pack], name)), name)

    def test_only_the_chosen_packs_are_used(self):
        allowed = {"conv_ultimate_nature_pack", "conv_farm_buildings", "conv_farm_animals", "conv_simple_nature_pack", "ultimate_modular_men", "ultimate_modular_women",
                   "stylized_nature_megakit", "conv_textured_stylized_trees", "conv_ultimate_food_pack", "conv_cute_fish_pack"}
        packs = set(os.listdir(os.path.join(UI, "game", "assets")))
        folder = os.path.join(UI, "turtle")
        for name in os.listdir(folder):
            if name.endswith(".js"):
                with open(os.path.join(folder, name), encoding="utf-8") as f:
                    used = set(re.findall(r"(\w+)/", f.read())) & packs
                self.assertEqual(used - allowed, set(), name)

    def test_every_fish_and_rod_exists(self):
        pack = os.path.join(UI, "game", "assets", "conv_cute_fish_pack")
        fish = re.findall(r'\["\w+", "[^"]+", "(\w+)", \d', DATA)
        self.assertGreater(len(fish), 30)
        for model in fish + [f"FishingRod_Lvl{i}" for i in range(1, 6)] + [f"Lure_{i}" for i in range(1, 6)] + ["Dock_Long_NoRope", "Boat"]:
            self.assertTrue(os.path.exists(os.path.join(pack, f"{model}.glb")), model)

    def test_every_outfit_exists(self):
        men = re.search(r"male: \[(.*?)\],\n", DATA, re.S).group(1)
        women = re.search(r"female: \[(.*?)\],\n", DATA, re.S).group(1)
        for folder, text in (("ultimate_modular_men", men), ("ultimate_modular_women", women)):
            for skin in re.findall(r'\["(\w+)", "', text):
                self.assertTrue(os.path.exists(os.path.join(UI, "game", "assets", folder, f"{skin}.gltf")), skin)

    def test_every_placeable_exists(self):
        names = dict(GROWN="conv_ultimate_nature_pack", B="conv_farm_buildings", MEGA="stylized_nature_megakit", FOOD="conv_ultimate_food_pack")
        found = re.findall(r"model: `\$\{(GROWN|B|MEGA|FOOD)\}([\w.]+)`", DATA)
        self.assertGreater(len(found), 25)
        for pack, name in found:
            self.assertTrue(os.path.exists(os.path.join(UI, "game", "assets", names[pack], name)), name)
        packs = {"P1": "lowpoly_farm_01", "V": "farm_vehicles"}
        block = re.findall(r"\.\.\.pack\((P1|V), \[(.*?)\]\),\n", DATA, re.S)
        self.assertEqual(len(block), 2)
        for root, body in block:
            files = re.findall(r'\["\w+", "[^"]+", "\w+", "(\w+)", ', body)
            self.assertGreater(len(files), 15)
            for name in files:
                self.assertTrue(os.path.exists(os.path.join(UI, "games", "asset_packs", packs[root], f"{name}.gltf")), name)

    def test_every_line_has_three_forms(self):
        self.assertEqual(len(re.findall(r"forms: \[", DATA)), 10)
        for forms in re.findall(r"forms: \[(.*?)\]", DATA):
            self.assertEqual(forms.count('"') // 2, 3)
        for sizes in re.findall(r"sizes: \[(.*?)\]", DATA):
            values = [float(v) for v in sizes.split(",")]
            self.assertEqual(values, sorted(values))         # each form is bigger than the last

    def test_the_extracted_packs_are_all_there(self):
        for pack, least in (("lowpoly_farm_01", 170), ("lowpoly_farm_02", 230), ("farm_vehicles", 28), ("garden_tools", 15)):
            folder = os.path.join(UI, "games", "asset_packs", pack)
            self.assertGreaterEqual(len([f for f in os.listdir(folder) if f.endswith(".gltf")]), least, pack)

    def test_it_sits_between_adventure_and_retro(self):
        with open(os.path.join(UI, "games", "index.html"), encoding="utf-8") as f:
            page = f.read()
        self.assertLess(page.index('id="cardAdventure"'), page.index('id="cardTurtle"'))
        self.assertLess(page.index('id="cardTurtle"'), page.index('id="cardRetro"'))


if __name__ == "__main__":
    unittest.main()
