"""Importing models (skills/modelimport.py), simplifying any rig (skills/slimrig.py) and the monster moves (skills/animate.py)."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills"))
import animate  # noqa: E402
import modelimport  # noqa: E402
import slimrig  # noqa: E402


def rig_glb(path, head_scale=1.0):
    """two triangles' worth of skin on: root > body > tip. body can be bound 100 times too big, as game rips do; tip then evens it out."""
    pos = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], np.float32)
    joints = np.array([[2, 0, 0, 0]] * 3, np.uint16)
    weights = np.array([[1, 0, 0, 0]] * 3, np.float32)
    ibm = np.tile(np.eye(4, dtype=np.float32), (3, 1, 1))
    ibm[1] = np.diag([1 / head_scale, 1 / head_scale, 1 / head_scale, 1]) * 1.0 if head_scale == 1 else np.diag([head_scale] * 3 + [1])
    blob, views, accs = bytearray(), [], []

    def add(a, ctype, kind):
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": a.nbytes})
        blob.extend(a.tobytes())
        accs.append({"bufferView": len(views) - 1, "componentType": ctype, "count": len(a), "type": kind})
        return len(accs) - 1

    p, j, w, b = add(pos, 5126, "VEC3"), add(joints, 5123, "VEC4"), add(weights, 5126, "VEC4"), add(ibm.transpose(0, 2, 1), 5126, "MAT4")
    js = {"asset": {"version": "2.0"}, "nodes": [{"name": "root", "children": [1]}, {"name": "body", "children": [2]}, {"name": "body_twist"},
                                                 {"mesh": 0, "skin": 0}],
          "meshes": [{"primitives": [{"attributes": {"POSITION": p, "JOINTS_0": j, "WEIGHTS_0": w}}]}],
          "skins": [{"joints": [0, 1, 2], "inverseBindMatrices": b}], "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(blob)}]}
    slimrig.write_glb(path, js, blob)
    return path


class Temp(unittest.TestCase):
    def setUp(self):
        self.src, self.dest = tempfile.mkdtemp(), tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.src, True)
        self.addCleanup(shutil.rmtree, self.dest, True)


class Import(Temp):
    def touch(self, *rel, data=b"x"):
        p = os.path.join(self.src, *rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)
        return p

    def test_base_form_before_mega(self):
        a, b = self.touch("CharizardMegaX.FBX"), self.touch("Charizard.FBX")
        self.assertEqual(modelimport.best_model([a, b]), b)

    def test_old_fbx_finds_its_own_dae(self):
        fbx = self.touch("Charizard.FBX", data=b"Kaydara FBX Binary  \x00\x1a\x00" + (6100).to_bytes(4, "little"))
        same, other = self.touch("Charizard_ColladaMax.DAE"), self.touch("CharizardMegaX_ColladaMax.DAE")
        self.assertEqual(modelimport.fbx_version(fbx), 6100)
        self.assertEqual(modelimport.same_model(fbx, [other, same]), same)

    def test_zip_in_a_zip_is_searched(self):
        import zipfile
        inner = self.touch("inner.zip", data=b"")
        with zipfile.ZipFile(inner, "w") as z:
            z.writestr("Model.FBX", "x")
        outer = os.path.join(self.dest, "outer.zip")
        with zipfile.ZipFile(outer, "w") as z:
            z.write(inner, "source/inner.zip")
        work = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, work, True)
        self.assertEqual([os.path.basename(f) for f in modelimport.gather([outer], work)], ["Model.FBX"])

    def test_a_folder_on_one_drive_with_a_zip_unpacked_on_another(self):
        with mock.patch.object(modelimport.os.path, "splitdrive", side_effect=lambda p: (p[:2], p[2:])), \
                mock.patch.object(modelimport.os.path, "commonpath", side_effect=lambda ds: ds[0]), \
                mock.patch.object(modelimport.os.path, "abspath", side_effect=lambda p: p):
            self.assertEqual(sorted(modelimport.search_folders([r"D:\m\a.png", r"C:\t\b.png"])), [r"C:\t", r"D:\m"])

    def test_nothing_to_import_says_so(self):
        self.touch("notes.txt")
        self.assertIn("error", modelimport.import_paths([self.src], self.dest, None))

    def test_fix_rip_paints_it_solid_and_matt(self):
        p = rig_glb(os.path.join(self.src, "a.glb"))
        js, blob = slimrig.read_glb(p)
        js["images"] = [{"name": "BodyA1"}, {"name": "Iris1"}]
        js["textures"] = [{"source": 0}, {"source": 1}]
        js["materials"] = [{"alphaMode": "BLEND", "pbrMetallicRoughness": {"metallicFactor": 1, "baseColorTexture": {"index": 0}}},
                           {"alphaMode": "BLEND", "pbrMetallicRoughness": {"baseColorTexture": {"index": 1}}}]
        slimrig.write_glb(p, js, blob)
        modelimport.fix_rip(p)
        m = slimrig.read_glb(p)[0]["materials"]
        self.assertEqual((m[0]["alphaMode"], m[0]["pbrMetallicRoughness"]["metallicFactor"], m[1]["alphaMode"]), ("OPAQUE", 0, "BLEND"))


class Simplify(Temp):
    def positions(self, path):
        js, blob = slimrig.read_glb(path)
        return slimrig._read(js, blob, js["meshes"][0]["primitives"][0]["attributes"]["POSITION"])

    def test_helpers_go_and_body_stays(self):
        src = rig_glb(os.path.join(self.src, "a.glb"))
        self.assertEqual(slimrig.simplify(src, os.path.join(self.dest, "b.glb")), (3, 2))

    def test_any_rig_is_capped_by_how_little_skin_a_bone_moves(self):
        names = {i: f"x{i}" for i in range(5)}
        self.assertEqual(slimrig.simplify_plan(names, {i: i - 1 if i else None for i in range(5)}), set())   # the names say nothing
        self.assertLessEqual(slimrig.SIMPLE_MAX, 100)

    def test_chain_of_a_character_named_rig_keeps_its_first_links(self):
        names = {i: f"Naruto{n}" for i, n in enumerate(["Hips", "Hair1", "Hair2", "Hair3", "Hair4"])}
        self.assertEqual(slimrig.simplify_plan(names, {i: i - 1 if i else None for i in range(5)}), {3, 4})

    def test_rig_whose_bones_disagree_keeps_its_shape(self):
        """Skin moved onto a bone bound 100 times bigger used to fly off. It's baked at rest first."""
        src = rig_glb(os.path.join(self.src, "a.glb"), head_scale=100.0)
        dest = os.path.join(self.dest, "b.glb")
        slimrig.simplify(src, dest)
        np.testing.assert_allclose(self.positions(dest), self.positions(src), atol=1e-5)
        js, blob = slimrig.read_glb(dest)
        ibm = slimrig._read(js, blob, js["skins"][0]["inverseBindMatrices"]).reshape(-1, 4, 4)
        np.testing.assert_allclose(ibm, np.tile(np.eye(4), (len(ibm), 1, 1)), atol=1e-5)

    def test_clean_rig_is_not_baked(self):
        js, blob = slimrig.read_glb(rig_glb(os.path.join(self.src, "a.glb")))
        world = slimrig._worlds(js["nodes"], {0: None, 1: 0, 2: 1}, [0, 1, 2])
        self.assertFalse(slimrig._needs_rebind(slimrig._binds(js, blob, world), {0, 1, 2}))


class Monster(unittest.TestCase):
    def test_every_monster_move_has_a_sentence(self):
        for key in ("fly", "hover", "float", "glide", "roar", "stomp", "claw", "bite", "tail_swing", "wing_flap", "breathe_fire", "crawl", "prowl", "charge", "hurt", "faint"):
            self.assertTrue(animate.PROMPTS[key].startswith("An object "), key)

    def test_monster_body_changes_how_it_walks(self):
        self.assertIn("monster", animate.prompt_for("walk", "monster"))
        self.assertNotEqual(animate.prompt_for("idle", "monster"), animate.prompt_for("idle"))

    def test_the_rig_page_and_python_agree_on_the_moves(self):
        with open(os.path.join(ROOT, "ui", "rigparts.js"), encoding="utf-8") as f:
            import re
            names = re.search(r"MONSTER_NAMES = \[(.*?)\]", f.read()).group(1)
        self.assertEqual({n for n in re.findall(r'"(\w+)"', names)} - set(animate.PROMPTS), {"hover_go"})     # made in the page, never by UniMate


if __name__ == "__main__":
    unittest.main()
