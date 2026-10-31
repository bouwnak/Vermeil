"""slimrig: game rigs with too many bones are cut down for UniMate (helpers first, weights go to the parent)"""
import os, shutil, sys, tempfile, unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import slimrig  # noqa: E402


def make_glb(path):
    """a spine of 4 bones; the top one has 2 helper bones and a hand with 2 fingers. 4 vertices."""
    names = ["root", "spine", "chest", "arm", "upperarm_drv", "lip_upper", "hand", "finger1", "finger2"]
    parents = [None, 0, 1, 2, 3, 2, 3, 6, 6]
    nodes = [{"name": n} for n in names]
    for i, p in enumerate(parents):
        if p is not None:
            nodes[p].setdefault("children", []).append(i)
    nodes.append({"name": "body", "mesh": 0, "skin": 0})
    js = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": [0, 9]}], "nodes": nodes,
          "skins": [{"joints": list(range(9))}], "meshes": [{"primitives": [{"attributes": {}}]}]}
    binary = bytearray()
    ibm = np.tile(np.eye(4, dtype=np.float32).ravel(), (9, 1))
    ibm[:, 12] = np.arange(9)                                       # tell the matrices apart
    js["skins"][0]["inverseBindMatrices"] = slimrig._add(js, binary, ibm, 5126, "MAT4")
    pos = slimrig._add(js, binary, np.zeros((4, 3)), 5126, "VEC3")
    j = slimrig._add(js, binary, [[4, 3, 0, 0], [5, 2, 0, 0], [7, 8, 6, 0], [1, 0, 0, 0]], 5121, "VEC4")
    w = slimrig._add(js, binary, [[0.6, 0.4, 0, 0], [0.5, 0.5, 0, 0], [0.3, 0.3, 0.4, 0], [1, 0, 0, 0]], 5126, "VEC4")
    js["meshes"][0]["primitives"][0]["attributes"] = {"POSITION": pos, "JOINTS_0": j, "WEIGHTS_0": w}
    js["buffers"] = [{"byteLength": len(binary)}]
    slimrig.write_glb(path, js, binary)


class SlimTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-slim-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.src, self.dest = os.path.join(self.tmp, "a.glb"), os.path.join(self.tmp, "b.glb")
        make_glb(self.src)

    def test_helpers_go_first_and_weights_move_to_the_parent(self):
        self.assertEqual(slimrig.bone_count(self.src), 9)
        self.assertEqual(slimrig.slim(self.src, self.dest, max_bones=7), (9, 7))
        js, binary = slimrig.read_glb(self.dest)
        names = [js["nodes"][i]["name"] for i in js["skins"][0]["joints"]]
        self.assertNotIn("upperarm_drv", names)                     # helpers before real bones
        self.assertNotIn("lip_upper", names)
        self.assertIn("finger1", names)
        attrs = js["meshes"][0]["primitives"][0]["attributes"]
        jj = slimrig._read(js, binary, attrs["JOINTS_0"])
        ww = slimrig._read(js, binary, attrs["WEIGHTS_0"])
        arm = names.index("arm")
        self.assertEqual((int(jj[0][0]), round(float(ww[0][0]), 3)), (arm, 1.0))   # drv 0.6 + arm 0.4 -> all arm
        np.testing.assert_allclose(ww.sum(1), 1, atol=1e-6)
        ibm = slimrig._read(js, binary, js["skins"][0]["inverseBindMatrices"])
        old = ["root", "spine", "chest", "arm", "upperarm_drv", "lip_upper", "hand", "finger1", "finger2"]
        self.assertEqual([int(r[12]) for r in ibm], [old.index(n) for n in names])   # each bone keeps its own matrix
        self.assertNotIn(4, js["nodes"][3].get("children", []))      # gone from the tree too
        self.assertEqual(slimrig.bone_count(self.dest), 7)

    def test_real_bones_with_least_skin_go_when_helpers_are_not_enough(self):
        self.assertEqual(slimrig.slim(self.src, self.dest, max_bones=5)[1], 5)
        js, _ = slimrig.read_glb(self.dest)
        names = {js["nodes"][i]["name"] for i in js["skins"][0]["joints"]}
        self.assertEqual(names, {"root", "spine", "chest", "arm", "hand"})   # fingers folded into the hand

    def test_small_rigs_are_copied_as_they_are(self):
        self.assertEqual(slimrig.slim(self.src, self.dest, max_bones=70), (9, 9))
        self.assertEqual(slimrig.bone_count(os.path.join(self.tmp, "missing.glb")), 0)


if __name__ == "__main__":
    unittest.main()
