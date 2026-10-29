"""Google Drive links (brain/gdrive.py), the Games hub's own games (skills/mygames.py), plugin download links
(brain/plugins.py), the Drive folders (scripts/package_app.py --drive) and Chatterbox's length cap - no internet needed."""
import json
import os
import shutil
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for d in ("", "skills", "brain", "senses", "scripts"):
    sys.path.insert(0, os.path.join(ROOT, d))
import gdrive
import mygames
import plugins

FID = "1AbCdEfGhIjKlMnOpQrStUv"


class DriveLinkTests(unittest.TestCase):
    def test_share_links_become_download_links(self):
        for url in (f"https://drive.google.com/file/d/{FID}/view?usp=sharing", f"https://drive.google.com/open?id={FID}",
                    f"https://drive.google.com/uc?id={FID}&export=download"):
            self.assertEqual(gdrive.drive_id(url), FID)
            self.assertIn(f"id={FID}", gdrive.direct_url(url))
            self.assertIn("confirm=t", gdrive.direct_url(url))

    def test_other_links(self):
        self.assertEqual(gdrive.direct_url("https://example.com/game.zip"), "https://example.com/game.zip")
        self.assertIsNone(gdrive.drive_id("https://evil.example/file/d/" + FID))
        for bad in ("ftp://x/y.zip", "file:///C:/x.zip", "drive.google.com/file/d/x", ""):
            with self.assertRaises(ValueError):
                gdrive.direct_url(bad)
        with self.assertRaises(ValueError):                     # a folder can't be downloaded in one go
            gdrive.direct_url("https://drive.google.com/drive/folders/" + FID)


class MyGamesTests(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)
        for name, val in (("GAMES_DIR", os.path.join(self.d, "games")), ("LIST_FILE", os.path.join(self.d, "list.json")),
                          ("SUGGEST", [])):
            p = mock.patch.object(mygames, name, val)
            p.start()
            self.addCleanup(p.stop)
        self.src = os.path.join(self.d, "src", "MyGame")
        os.makedirs(os.path.join(self.src, "MyGame_Data"))
        os.makedirs(os.path.join(self.src, "MyGame_BurstDebugInformation_DoNotShip"))
        for f in ("MyGame.exe", "UnityCrashHandler64.exe", "MyGame_Data/level0", "MyGame_BurstDebugInformation_DoNotShip/x.pdb"):
            with open(os.path.join(self.src, f), "wb") as fh:
                fh.write(b"x" * 10)

    def test_add_exe_copies_its_folder_without_debug_files(self):
        r = mygames.add_path(os.path.join(self.src, "MyGame.exe"))
        self.assertTrue(r.get("ok"), r)
        g = r["game"]
        self.assertEqual(g["exe"], "MyGame.exe")
        folder = os.path.join(mygames.GAMES_DIR, g["folder"])
        self.assertTrue(os.path.isfile(os.path.join(folder, "MyGame_Data", "level0")))
        self.assertFalse(os.path.exists(os.path.join(folder, "MyGame_BurstDebugInformation_DoNotShip")))
        self.assertEqual([x["name"] for x in mygames.list_games()["games"]], ["MyGame"])
        mygames.remove(g["id"])
        self.assertFalse(os.path.exists(folder))
        self.assertEqual(mygames.list_games()["games"], [])

    def test_add_zip_and_refuse_helpers(self):
        zp = os.path.join(self.d, "MyGame.zip")
        with zipfile.ZipFile(zp, "w") as z:
            z.writestr("MyGame/MyGame.exe", "x")
            z.writestr("MyGame/UnityCrashHandler64.exe", "x")
            z.writestr("../escape.txt", "never written outside")
        r = mygames.add_path(zp)
        self.assertTrue(r.get("ok"), r)
        self.assertTrue(r["game"]["exe"].endswith("MyGame.exe"))
        self.assertFalse(os.path.exists(os.path.join(self.d, "escape.txt")))
        self.assertIn("error", mygames.add_path(os.path.join(self.src, "UnityCrashHandler64.exe")))
        self.assertIn("error", mygames.add_path(os.path.join(self.d, "nothing.exe")))

    def test_launch_only_inside_games(self):
        self.assertIn("error", mygames.launch("nope"))


class PluginLinkTests(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        p = mock.patch.object(plugins, "LINKS_FILE", os.path.join(d, "links.json"))
        p.start()
        self.addCleanup(p.stop)

    def test_links_txt(self):
        text = (f"# a comment\nvoice_clone = https://drive.google.com/file/d/{FID}/view\nunimate = \n"
                f"no_such_thing = https://drive.google.com/file/d/{FID}/view\nvoice_clone_bad = ftp://x\n")
        self.assertEqual(plugins.import_links(text), 1)
        self.assertEqual(list(plugins.links()), ["voice_clone"])
        self.assertIn("error", plugins.set_link("voice_clone", "https://drive.google.com/drive/folders/" + FID))
        plugins.set_link("voice_clone", "")
        self.assertEqual(plugins.links(), {})


class DriveFoldersTests(unittest.TestCase):
    def test_a_folder_per_feature(self):
        import package_app as pa
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        a = mock.Mock(url=None)
        with mock.patch.object(pa, "DIST", d), mock.patch.object(pa, "write_app_zip", lambda out, a, packs=(): open(out, "wb").close()), \
                mock.patch.object(pa, "pack_files", lambda name: []), mock.patch.object(pa, "your_games", lambda: []):
            pa.make_drive(a)
        out = os.path.join(d, "Vermeil-Drive")
        self.assertTrue(os.path.isfile(os.path.join(out, "1 - Vermeil app", "Vermeil-App.zip")))
        self.assertTrue(os.path.isfile(os.path.join(out, "1 - Vermeil app", "Get-Vermeil.bat")))
        feats = os.listdir(os.path.join(out, "2 - Plugins"))
        self.assertEqual(len(feats), len(plugins.PLUGINS))
        for f in feats:
            self.assertTrue(os.path.isfile(os.path.join(out, "2 - Plugins", f, "README.txt")))
        self.assertTrue(os.path.isfile(os.path.join(out, "HOW TO INSTALL.txt")))
        self.assertTrue(os.path.isfile(os.path.join(out, "links.txt")))

    def test_app_zip_has_uninstall_and_skips_games(self):
        import package_app as pa
        self.assertIn("uninstall.ps1", pa.UNINSTALL_BAT)
        a = mock.Mock(with_library=False, with_blender=False, offline=False, with_my_data=True, with_ollama=False)
        self.assertFalse(pa.wanted("data/games/MyGame/MyGame.exe", a))
        self.assertFalse(pa.wanted("tools/rvc/hubert.pt", a))          # its own pack (2 - Plugins)
        self.assertFalse(pa.wanted("env", a))


class ChatterCapTests(unittest.TestCase):
    def test_cap_and_slow_guard(self):
        import chatter
        self.assertLess(chatter._max_tokens("Oh, I love that idea!"), 120)       # never 1000 steps (40 s) for a short line
        self.assertGreater(chatter._max_tokens("x" * 100), 100 / 14 * 25)       # but room for slow, careful speech
        with mock.patch.object(chatter, "_slow_until", [0.0]):
            self.assertTrue(chatter.fast_enough())
            chatter._slow_until[0] = 1e12
            self.assertFalse(chatter.fast_enough())


if __name__ == "__main__":
    unittest.main()
