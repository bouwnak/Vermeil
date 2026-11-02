"""Play on a Retro Game (skills/retroplay.py): the download button, opening what was downloaded, the emulator - no internet needed."""
import os, sys, tempfile, time, unittest, zipfile
from pathlib import Path
from unittest import mock
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import folders  # noqa
import sandbox  # noqa: E402,F401
import retrogames
import retroplay

GBA = "https://www.romsgames.net/gameboy-advance-rom-sonic-advance-3/"


def wait(job):
    for _ in range(200):
        st = retroplay.status(job)
        if st["done"]:
            return st
        time.sleep(0.01)
    raise AssertionError("still working")


class Buttons(unittest.TestCase):
    def test_the_sites_save_game_button_is_found(self):
        self.assertGreaterEqual(retroplay.score_button({"tag": "button", "text": "Save Game", "attrs": "bg-main"}, "game"), 32)

    def test_real_buttons_beat_ads_and_links(self):
        real = retroplay.score_button({"tag": "a", "href": "https://x/d/game.zip", "text": "Download now", "attrs": ""}, "game")
        self.assertGreater(real, retroplay.score_button({"tag": "a", "href": "https://x/about", "text": "About us", "attrs": ""}, "game"))
        for bad in ("Download emulator", "Get our VPN and download safely"):
            self.assertLess(retroplay.score_button({"tag": "a", "href": "https://x/y", "text": bad, "attrs": ""}, "game"), 32)

    def test_only_game_files_are_kept(self):
        b = retroplay.SiteBrowser()
        b.got = []
        b._on_download(mock.Mock(suggested_filename="installer.exe"))
        self.assertEqual(b.got, [])
        b._on_download(mock.Mock(suggested_filename="Game.zip"))
        self.assertEqual(len(b.got), 1)

    def test_it_never_opens_a_window_and_tries_twice(self):
        tries = []
        class Fake:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def download(self, url, title, folder):
                tries.append(url)
                if len(tries) == 1:
                    raise retroplay.SiteRefused("no file")
                return "got.zip"
        with mock.patch.object(retroplay, "SiteBrowser", Fake):
            self.assertEqual(retroplay.from_site(GBA, "Sonic", "folder", lambda t, p: None), "got.zip")
        self.assertEqual(len(tries), 2)
        import inspect
        self.assertNotIn("headless=False", inspect.getsource(retroplay))

    def test_the_browser_is_always_hidden(self):
        launched = []
        chromium = mock.Mock(launch=lambda **k: launched.append(k) or mock.Mock())
        b = retroplay.SiteBrowser()
        b._pw = mock.Mock(chromium=chromium)
        b._launch()
        self.assertTrue(launched[0]["headless"])

    def test_a_rar_is_a_game_file(self):
        b = retroplay.SiteBrowser()
        b.got = []
        b._on_download(mock.Mock(suggested_filename="Marvel vs. Capcom[01059].rar"))
        self.assertEqual(len(b.got), 1)


class Fetching(unittest.TestCase):
    """the file behind a started download: real numbers, carrying on after a drop, Cancel, and a limit for a dead link"""
    def setUp(self):
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        self.path = os.path.join(d.name, "game.rar")
        self.said = []

    def say(self, text, pct):
        self.said.append(text)

    class Resp:
        def __init__(self, data, status=200, total=None, fail_after=None):
            self.data, self.status_code, self.fail_after = data, status, fail_after
            self.headers = {"Content-Length": str(total if total is not None else len(data))}
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def raise_for_status(self):
            if self.status_code >= 400:
                raise retroplay.requests.HTTPError(str(self.status_code))
        def iter_content(self, n):
            yield self.data
            if self.fail_after:
                raise retroplay.requests.ConnectionError("dropped")

    def test_whole_file_with_numbers(self):
        with mock.patch.object(retroplay.requests, "get", return_value=self.Resp(b"x" * 2097152)):
            retroplay.fetch_game("u", self.path, {}, "r", self.say)
        self.assertEqual(os.path.getsize(self.path), 2097152)
        self.assertFalse(os.path.exists(self.path + ".part"))
        self.assertIn("2 of 2 MB", self.said[-1])
        self.assertIn("left", self.said[-1])

    def test_carries_on_after_a_drop(self):
        calls = []
        def get(url, headers=None, **k):
            calls.append(headers.get("Range"))
            if len(calls) == 1:
                return self.Resp(b"a" * 10, total=20, fail_after=True)
            return self.Resp(b"b" * 10, status=206, total=10)
        with mock.patch.object(retroplay.requests, "get", side_effect=get), mock.patch.object(retroplay.time, "sleep"):
            retroplay.fetch_game("u", self.path, {}, "r", self.say)
        self.assertEqual(calls, [None, "bytes=10-"])
        with open(self.path, "rb") as f:
            self.assertEqual(f.read(), b"a" * 10 + b"b" * 10)

    def test_carries_on_when_the_site_cuts_it_off_midway(self):
        class Cut(self.Resp):
            def iter_content(self, n):
                yield self.data
                raise retroplay.requests.exceptions.ChunkedEncodingError("IncompleteRead")
        calls = []
        def get(url, headers=None, **k):
            calls.append(headers.get("Range"))
            return Cut(b"a" * 10, total=20) if len(calls) == 1 else self.Resp(b"b" * 10, status=206, total=10)
        with mock.patch.object(retroplay.requests, "get", side_effect=get), mock.patch.object(retroplay.time, "sleep"):
            retroplay.fetch_game("u", self.path, {}, "r", self.say)
        self.assertEqual(os.path.getsize(self.path), 20)

    def test_starts_over_if_the_server_cant_carry_on(self):
        calls = []
        def get(url, headers=None, **k):
            calls.append(headers.get("Range"))
            return self.Resp(b"a" * 10, total=20, fail_after=True) if len(calls) == 1 else self.Resp(b"c" * 20)
        with mock.patch.object(retroplay.requests, "get", side_effect=get), mock.patch.object(retroplay.time, "sleep"):
            retroplay.fetch_game("u", self.path, {}, "r", self.say)
        with open(self.path, "rb") as f:
            self.assertEqual(f.read(), b"c" * 20)

    def test_a_404_page_isnt_a_game(self):
        page = b"<!DOCTYPE html><html><title>404 &mdash; Not Found</title></html>"
        with mock.patch.object(retroplay.requests, "get", return_value=self.Resp(page)):
            with self.assertRaises(retroplay.FileGone):
                retroplay.fetch_game("u", self.path, {}, "r", self.say)
        self.assertFalse(os.path.exists(self.path))

    def test_cancel(self):
        with mock.patch.object(retroplay.requests, "get", return_value=self.Resp(b"x" * 10)):
            with self.assertRaises(retroplay.Cancelled):
                retroplay.fetch_game("u", self.path, {}, "r", self.say, cancelled=lambda: True)
        self.assertFalse(os.path.exists(self.path))

    def test_a_dead_link_gives_up(self):
        with mock.patch.object(retroplay.requests, "get", side_effect=retroplay.requests.ConnectionError("no")), \
             mock.patch.object(retroplay, "STALL_LIMIT", -1), mock.patch.object(retroplay.time, "sleep"):
            with self.assertRaises(RuntimeError):
                retroplay.fetch_game("u", self.path, {}, "r", self.say)

    def test_cancel_reaches_the_job(self):
        retroplay._jobs["77"] = {"gid": "1", "phone": False}
        self.addCleanup(retroplay._jobs.pop, "77", None)
        retroplay.cancel("77")
        self.assertTrue(retroplay._jobs["77"]["cancel"])


class Downloads(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        self.dir = d.name

    def _zip(self, members, name="game.zip"):
        path = os.path.join(self.dir, name)
        with zipfile.ZipFile(path, "w") as z:
            for m, data in members.items():
                z.writestr(m, data)
        return path

    def test_rom_comes_out_of_the_zip(self):
        rom, system = retroplay.find_rom(self._zip({"readme.txt": b"x", "sub/Game (USA).gba": b"rom"}), "gba")
        self.assertEqual((os.path.basename(rom), system), ("Game (USA).gba", "gba"))
        with open(rom, "rb") as f:
            self.assertEqual(f.read(), b"rom")

    def test_a_zip_cant_write_outside_its_folder(self):
        rom, _ = retroplay.find_rom(self._zip({"../../evil.gba": b"rom"}), "gba")
        self.assertEqual(os.path.dirname(rom), os.path.join(self.dir, "rom"))

    def test_a_7z_opens_too(self):
        src = os.path.join(self.dir, "src"); os.makedirs(src)
        with open(os.path.join(src, "game.sfc"), "wb") as f:
            f.write(b"rom")
        arc = os.path.join(self.dir, "game.7z")
        import subprocess
        tar = retroplay.shutil.which("tar")
        if not tar or subprocess.run([tar, "-a", "-cf", arc, "-C", src, "game.sfc"], capture_output=True).returncode:
            self.skipTest("no tar that makes .7z")
        self.assertEqual(os.path.basename(retroplay.find_rom(arc, "snes")[0]), "game.sfc")

    def test_a_7z_named_rar_opens(self):
        py7zr = retroplay._py7zr()
        if not py7zr:
            self.skipTest("py7zr isn't available")
        src = os.path.join(self.dir, "game.cue")
        with open(src, "wb") as f:
            f.write(b"cue")
        arc = os.path.join(self.dir, "Game[01059].rar")                 # what the site really gives
        with py7zr.SevenZipFile(arc, "w") as z:
            z.write(src, "game.cue")
        os.remove(src)
        rom, system = retroplay.find_rom(arc, "psx")
        self.assertEqual((os.path.basename(rom), system), ("game.cue", "psx"))

    def test_a_7z_named_zip_opens(self):
        py7zr = retroplay._py7zr()
        if not py7zr:
            self.skipTest("py7zr isn't available")
        src = os.path.join(self.dir, "game.cue")
        with open(src, "wb") as f:
            f.write(b"cue")
        arc = os.path.join(self.dir, "Tekken 3.zip")                    # what the site really gives for PlayStation
        with py7zr.SevenZipFile(arc, "w") as z:
            z.write(src, "Tekken 3 (USA)/game.cue")
        os.remove(src)
        self.assertEqual(os.path.basename(retroplay.find_rom(arc, "psx")[0]), "game.cue")

    def test_an_archive_inside_an_archive(self):
        inner = self._zip({"game.3ds": b"rom"}, "inner.zip")
        with open(inner, "rb") as f:
            data = f.read()
        os.remove(inner)
        rom, system = retroplay.find_rom(self._zip({"inner.zip": data, "release.nfo": b"x"}), "3ds")
        self.assertEqual((os.path.basename(rom), system), ("game.3ds", "3ds"))

    def test_a_disc_keeps_its_tracks_and_the_cue_is_opened(self):
        rom, system = retroplay.find_rom(self._zip({"game.bin": b"data", "game.cue": b"cue"}), "psx")
        self.assertEqual((os.path.basename(rom), system), ("game.cue", "psx"))
        self.assertTrue(os.path.exists(os.path.join(self.dir, "rom", "game.bin")))

    def test_arcade_games_stay_zipped(self):
        path = self._zip({"a.bin": b"x"})
        self.assertEqual(retroplay.find_rom(path, "arcade"), (path, "arcade"))

    def test_wrong_console_is_refused(self):
        with self.assertRaises(ValueError):
            retroplay.find_rom(self._zip({"game.nes": b"rom"}), "gba")
        with self.assertRaises(ValueError):
            retroplay.find_rom(self._zip({"game.txt": b"nothing"}, "empty.zip"), "gba")

    def test_gb_game_is_fine_for_gbc(self):
        self.assertEqual(retroplay.find_rom(self._zip({"game.gb": b"rom"}), "gbc")[1], "gb")

    def test_a_game_already_here_isnt_downloaded_again(self):
        os.makedirs(os.path.join(self.dir, "5"))
        with open(os.path.join(self.dir, "5", "game.zip"), "wb") as f:
            f.write(b"x")
        with mock.patch.object(retrogames, "ROM_DIR", self.dir), mock.patch.object(retroplay, "from_site") as site:
            path = retroplay._get_game({"title": "Game", "url": GBA}, "5", "gba", lambda *a: None)
        self.assertEqual(os.path.basename(path), "game.zip")
        site.assert_not_called()

    def test_a_failed_download_leaves_nothing_and_says_so(self):
        with mock.patch.object(retrogames, "ROM_DIR", self.dir), mock.patch.object(retroplay, "from_site", side_effect=OSError("blocked")):
            with self.assertRaises(RuntimeError):
                retroplay._get_game({"title": "G", "url": GBA}, "7", "gba", lambda *a: None)
        self.assertFalse(os.path.exists(os.path.join(self.dir, "7")))
        self.assertNotIn("7", retrogames.downloading)


class Playing(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        self.dir = d.name
        for name, val in (("ROM_DIR", "roms"), ("LIBRARY_FILE", "lib.json"), ("SAVE_DIR", "saves")):
            p = mock.patch.object(retrogames, name, os.path.join(self.dir, val)); p.start(); self.addCleanup(p.stop)
        retroplay._jobs.clear()

    def _have(self, url=GBA, name="game.gba"):
        folder = os.path.join(retrogames.ROM_DIR, retrogames.game_id(url))
        os.makedirs(folder)
        with open(os.path.join(folder, name), "wb") as f:
            f.write(b"rom")

    def test_every_console_on_offer_can_be_played(self):
        for plat in retrogames.PLATFORM_IDS:
            self.assertIn(retroplay.PLATFORM_SYSTEM[plat], retroplay.CORES, plat)

    def test_other_sites_are_refused(self):
        for url in ("https://www.retrogames.cc/genesis-games/x.html", "https://evil.example/gameboy-advance-rom-x/", ""):
            self.assertIn("error", retroplay.start({"url": url}))
            self.assertIn("error", retroplay.prepare({"url": url}))

    @unittest.skipUnless(sys.platform == "win32", "RetroArch is only set up for Windows")
    def test_play_opens_retroarch_with_the_game(self):
        self._have()
        exe = Path(self.dir) / "retroarch.exe"
        proc = mock.Mock()
        proc.poll.return_value = None
        with mock.patch.object(retroplay, "find_retroarch", return_value=exe), mock.patch.object(retroplay, "ensure_core", return_value=Path("core.dll")), \
             mock.patch.object(retroplay, "STARTUP_WAIT", 0), mock.patch.object(retroplay.subprocess, "Popen", return_value=proc) as popen:
            job = retroplay.start({"url": GBA, "title": "Sonic"})["job"]
            st = wait(job)
            for _ in range(200):
                if not retroplay.status(job)["running"] and proc.wait.called:
                    break
                time.sleep(0.01)
        self.assertIsNone(st["error"])
        cmd = popen.call_args[0][0]
        self.assertEqual(cmd[0:2], [str(exe), "--appendconfig"])        # no -f: it plays inside Vermeil's window
        self.assertEqual(cmd[-3:-1], ["-L", "core.dll"])
        self.assertTrue(cmd[-1].endswith("game.gba"))
        self.assertEqual(retrogames.library()["recent"][0]["title"], "Sonic")

    @unittest.skipUnless(sys.platform == "win32", "RetroArch is only set up for Windows")
    def test_a_failure_reaches_the_loading_screen(self):
        with mock.patch.object(retroplay, "_get_game", side_effect=RuntimeError("Couldn't download the game.")):
            st = wait(retroplay.start({"url": GBA, "title": "X"})["job"])
        self.assertEqual(st["error"], "Couldn't download the game.")
        self.assertFalse(st["running"])

    def test_a_core_that_closes_at_once_is_reported(self):
        dead = mock.Mock(returncode=1)
        dead.poll.return_value = 1
        with mock.patch.object(retroplay, "ensure_core", return_value=Path("core.dll")), mock.patch.object(retroplay.subprocess, "Popen", return_value=dead):
            with self.assertRaises(RuntimeError) as e:
                retroplay.launch(Path("r.exe"), "g.gba", "gba")
        self.assertIn("couldn't run", str(e.exception))

    def test_arcade_tries_its_other_cores(self):
        dead, alive = mock.Mock(returncode=1), mock.Mock()
        dead.poll.return_value = 1
        alive.poll.return_value = None
        cores = []
        def ensure(exe, system, say, core=None):
            cores.append(core)
            return Path(core + ".dll")
        with mock.patch.object(retroplay, "ensure_core", side_effect=ensure), mock.patch.object(retroplay, "STARTUP_WAIT", 0), \
             mock.patch.object(retroplay.subprocess, "Popen", side_effect=[dead, alive]):
            self.assertIs(retroplay.launch(Path("r.exe"), "g.zip", "arcade"), alive)
        self.assertEqual(cores, ["fbneo_libretro", "mame2003_plus_libretro"])

    def test_ps2_asks_for_its_bios_first(self):
        exe = Path(self.dir) / "retroarch.exe"
        self.assertIn("BIOS", retroplay.missing_bios(exe, "ps2"))
        self.assertEqual(retroplay.missing_bios(exe, "gba"), "")
        bios = exe.parent / "system" / "pcsx2" / "bios"
        bios.mkdir(parents=True)
        (bios / "scph.bin").write_bytes(b"x")
        self.assertEqual(retroplay.missing_bios(exe, "ps2"), "")

    def test_a_broken_archive_says_so_clearly(self):
        os.makedirs(os.path.join(self.dir, "roms"), exist_ok=True)
        with mock.patch.object(retroplay, "from_site", return_value="x.7z"), mock.patch.object(retroplay, "find_rom", side_effect=OSError("next header")):
            with self.assertRaises(RuntimeError) as e:
                retroplay._get_game({"title": "G", "url": GBA}, "9", "gba", lambda *a: None)
        self.assertIn("isn't a game", str(e.exception))

    def test_ps2_asks_before_downloading(self):
        exe = Path(self.dir) / "retroarch.exe"
        with mock.patch.object(retroplay, "find_retroarch", return_value=exe), mock.patch.object(retroplay, "_begin") as begin, mock.patch.object(retroplay.sys, "platform", "win32"):
            r = retroplay.start({"url": "https://www.romsgames.net/playstation-2-rom-x/", "title": "X"})
        self.assertIn("BIOS", r["error"])
        begin.assert_not_called()

    def test_launch_settings(self):
        path = os.path.join(self.dir, "ra.cfg")
        with mock.patch.object(retroplay, "data_file", return_value=path):
            with open(retroplay.launch_config(), encoding="utf-8") as f:
                cfg = f.read()
        self.assertIn('input_toggle_fullscreen = "nul"', cfg)             # no more F by accident
        self.assertIn('network_cmd_enable = "true"', cfg)                 # the bar's buttons
        self.assertNotIn("network_remote", cfg)                           # nothing else plays
        self.assertIn('core_info_cache_enable = "false"', cfg)            # a broken cache can't crash a launch
        self.assertIn('config_save_on_exit = "false"', cfg)               # RetroArch's own settings stay as they are

    def test_commands_go_to_retroarch(self):
        with mock.patch.object(retroplay.socket, "socket") as sock:
            retroplay.send_command("PAUSE_TOGGLE")
        sock.return_value.__enter__.return_value.sendto.assert_called_once_with(b"PAUSE_TOGGLE", ("127.0.0.1", 55355))

    def test_unknown_job(self):
        self.assertTrue(retroplay.status("nope")["error"])

    def test_the_phone_gets_the_file_without_retroarch(self):
        self._have()
        with mock.patch.object(retroplay.subprocess, "Popen") as popen:
            info = retroplay.prepare({"url": GBA, "title": "Sonic"})
            self.assertEqual(info["core"], "gba")
            wait(info["job"])
            p = retroplay.progress(info["id"])
        popen.assert_not_called()
        self.assertTrue(p["done"])
        self.assertEqual(p["rom"], f"roms/{info['id']}/game.gba")

    def test_the_phone_says_when_a_console_is_computer_only(self):
        self.assertIn("computer", retroplay.prepare({"url": "https://www.romsgames.net/playstation-2-rom-x/"})["error"])

    def test_finds_retroarch_in_a_listed_folder(self):
        exe = Path(self.dir) / "RetroArch" / "RetroArch-Win64" / "retroarch.exe"
        exe.parent.mkdir(parents=True); exe.write_bytes(b"x")
        with mock.patch.object(retroplay, "_emulator_folders", return_value=[Path(self.dir)]):
            self.assertEqual(retroplay.find_retroarch(), exe)


if __name__ == "__main__":
    unittest.main()
