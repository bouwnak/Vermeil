"""Importing a model copies its texture pictures too (a .gltf's own textures, or mouth pictures for a .glb)."""
import json
import os
import tempfile
import unittest

import folders  # noqa: F401
import app


def touch(path, data=b"x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return path


class CopyModelFiles(unittest.TestCase):
    def setUp(self):
        self.src = tempfile.mkdtemp()
        self.dest = tempfile.mkdtemp()

    def test_gltf_brings_its_textures(self):
        gltf = os.path.join(self.src, "frog.gltf")
        with open(gltf, "w", encoding="utf-8") as f:
            json.dump({"buffers": [{"uri": "frog.bin"}], "images": [{"uri": "tex/skin%20base.png"}, {"uri": "data:image/png;base64,AA"}]}, f)
        touch(os.path.join(self.src, "frog.bin"))
        touch(os.path.join(self.src, "tex", "skin base.png"))
        r = app.copy_model_files([gltf], self.dest)
        self.assertEqual(r, {"name": "frog.gltf", "textures": 2})
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "tex", "skin base.png")))
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "frog.bin")))

    def test_pictures_with_a_glb_become_its_face(self):
        glb = touch(os.path.join(self.src, "pip.glb"), b"glTF")
        mouth = touch(os.path.join(self.src, "mouth_ooo.png"))
        r = app.copy_model_files([mouth, glb], self.dest)
        self.assertEqual(r["name"], "pip.glb")
        self.assertTrue(os.path.isfile(os.path.join(self.dest, "pip_face", "mouth_ooo.png")))

    def test_pictures_alone_and_paths_outside(self):
        self.assertIn("error", app.copy_model_files([touch(os.path.join(self.src, "a.png"))], self.dest))
        gltf = os.path.join(self.src, "bad.gltf")
        with open(gltf, "w", encoding="utf-8") as f:
            json.dump({"images": [{"uri": "../../secret.png"}]}, f)
        r = app.copy_model_files([gltf], self.dest)
        self.assertEqual(r["textures"], 0)                       # never writes outside the models folder


if __name__ == "__main__":
    unittest.main()
