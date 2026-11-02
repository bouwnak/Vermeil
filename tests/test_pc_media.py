"""Photo frames take any picture, Installed games finds what isn't in a launcher, the emulator unpacks, the floating player's page code."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "skills"))
import folders  # noqa: E402,F401
import launchers  # noqa: E402
import retroplay  # noqa: E402
import roomlife  # noqa: E402
import vbrowser  # noqa: E402
from PIL import Image  # noqa: E402


class Temp(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)


class Photos(Temp):
    def test_every_common_type_opens(self):
        im = Image.new("RGB", (40, 30), "red")
        for ext, fmt in (("jpg", None), ("jfif", "JPEG"), ("jpe", "JPEG"), ("png", None), ("bmp", None), ("tiff", None), ("gif", None), ("webp", None), ("tga", None), ("ico", None)):
            p = os.path.join(self.dir, f"a.{ext}")
            im.save(p, fmt)
            self.assertTrue(roomlife.photo_data(p).get("url"), ext)

    def test_folder_lists_them_and_leaves_the_rest(self):
        for n in ("a.psd", "b.jfif", "c.gif", "notes.txt"):
            Path(self.dir, n).touch()
        self.assertEqual(sorted(p["name"] for p in roomlife.photos(self.dir)["photos"]), ["a.psd", "b.jfif", "c.gif"])

    def test_a_gif_keeps_moving(self):
        p = os.path.join(self.dir, "m.gif")
        Image.new("RGB", (40, 30), "red").save(p, save_all=True, append_images=[Image.new("RGB", (40, 30), "blue")], duration=120, loop=0)
        d = roomlife.photo_data(p)
        self.assertEqual((len(d["frames"]), d["delays"]), (2, [120, 120]))

    def test_see_through_goes_on_white(self):
        p = os.path.join(self.dir, "t.png")
        Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(p)
        import base64, io
        d = roomlife.photo_data(p)
        px = Image.open(io.BytesIO(base64.b64decode(d["url"].split(",")[1]))).getpixel((5, 5))
        self.assertGreater(min(px), 240)


    def test_an_svg_opens_too(self):
        p = os.path.join(self.dir, "a.svg")
        Path(p).write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
        self.assertTrue(roomlife.photo_data(p)["url"].startswith("data:image/svg"))

    def test_the_picker_filter_is_one_the_window_accepts(self):
        from webview.util import parse_file_type
        parse_file_type("Pictures (" + ";".join(f"*{e}" for e in roomlife.PHOTO_TYPES) + ")")
        parse_file_type("All files (*.*)")
        parse_file_type("3D models and their textures (*.glb;*.fbx;*.dae;*.vrm;*.zip;*.png;*.jpg;*.jpeg;*.webp)")


class Games(Temp):
    def entry(self, name, publisher="", folder="", **more):
        return {"name": name, "publisher": publisher, "folder": folder, "icon": "", "command": "", "kb": 0, **more}

    def game_folder(self, name="Game"):
        d = os.path.join(self.dir, name)
        os.makedirs(d)
        with open(os.path.join(d, "Game.exe"), "wb") as f:
            f.write(b"MZ" * 500)
        Path(d, "unins000.exe").touch()
        return d

    def scan(self, entries):
        with mock.patch.object(launchers, "uninstall_entries", return_value=entries), mock.patch.object(launchers, "game_dirs", return_value={}), \
                mock.patch.object(launchers, "_game_folders", return_value={}):
            return launchers.pc_games()

    def test_a_game_maker_counts_and_a_tool_does_not(self):
        d, tool = self.game_folder("A"), self.game_folder("B")
        got = self.scan({"a": self.entry("Some Shooter", "Blizzard Entertainment", d), "b": self.entry("Photo Editor", "Acme", tool)})
        self.assertEqual([g["name"] for g in got], ["Some Shooter"])

    def test_launchers_and_steam_keys_stay_out(self):
        d = self.game_folder()
        got = self.scan({"Steam App 1": self.entry("Dota", "Valve", d), "x": self.entry("Riot Vanguard", "Riot Games", d), "y": self.entry("Battle.net", "Blizzard", d)})
        self.assertEqual(got, [])

    def test_main_exe_skips_the_uninstaller(self):
        self.assertTrue(launchers._main_exe(self.game_folder()).endswith("Game.exe"))

    def test_riot_games_come_from_their_keys(self):
        d = self.game_folder("LoL")
        e = {"Riot Game league_of_legends.live": self.entry("League of Legends", "Riot Games, Inc", d), "Riot Game Riot_Client.": self.entry("Riot Client", "Riot", d)}
        with mock.patch.object(launchers, "uninstall_entries", return_value=e):
            self.assertEqual([g["id"] for g in launchers.riot_games()], ["league_of_legends.live"])

    def test_play_only_starts_what_the_scan_found(self):
        with mock.patch.object(launchers, "pc_games", return_value=[]):
            self.assertIn("error", launchers.play("pc", "whatever"))
        self.assertIn("error", launchers.play("riot", "bad id;calc"))


class Unpack(Temp):
    def test_a_tool_that_fails_passes_to_the_next(self):
        good = os.path.join(self.dir, "a.7z")
        Path(good).write_bytes(b"not one")
        calls = []

        def run(cmd, **k):
            calls.append(cmd[0])
            if cmd[0] == "first":
                raise subprocess.CalledProcessError(2, "first")
            return subprocess.CompletedProcess(cmd, 0)
        with mock.patch.object(retroplay, "_seven_zips", return_value=["first"]), mock.patch.object(retroplay, "_bsdtars", return_value=["tar2"]), \
                mock.patch.object(retroplay, "_py7zr", return_value=None), mock.patch.object(retroplay.subprocess, "run", run):
            retroplay._extract_archive(good, os.path.join(self.dir, "out"))
        self.assertEqual(calls, ["first", "tar2"])

    def test_nothing_can_open_it_says_what_to_do(self):
        a = os.path.join(self.dir, "a.7z")
        Path(a).write_bytes(b"not one")
        with mock.patch.object(retroplay, "_seven_zips", return_value=[]), mock.patch.object(retroplay, "_bsdtars", return_value=[]), \
                mock.patch.object(retroplay.shutil, "which", return_value=None), mock.patch.object(retroplay, "_py7zr", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "7-Zip"):
                retroplay._extract_archive(a, os.path.join(self.dir, "out"))


class Player(unittest.TestCase):
    def test_a_closed_tab_is_just_no_video(self):
        b = vbrowser.Browser(lambda e: None)
        self.assertFalse(b.video(5))

    def test_unknown_action_runs_nothing(self):
        b = vbrowser.Browser(lambda e: None)
        win = mock.Mock()
        b.tabs[1] = {"win": win}
        self.assertFalse(b.video(1, "alert(1)"))
        win.evaluate_js.assert_not_called()

    def test_the_page_code_undoes_itself(self):
        self.assertIn("__vmSaved", vbrowser.MINI_ON)
        self.assertIn("__vmSaved", vbrowser.MINI_OFF)

    def test_it_reaches_any_site(self):
        for need in ("shadowRoot", "iframe", "paused"):            # web components, embedded players, and the one playing in a feed
            self.assertIn(need, vbrowser.FIND)


if __name__ == "__main__":
    unittest.main()
