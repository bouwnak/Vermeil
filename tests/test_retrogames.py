"""Retro Games (skills/retrogames.py): reading the website's game cards and finding a game's player - no internet needed."""
import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for d in ("", "skills", "brain", "senses"):
    sys.path.insert(0, os.path.join(ROOT, d))
import retrogames

CARD = '''<div class="post thumb-border"><div class="thumb">
<a href="https://www.retrogames.cc/genesis-games/sonic-classic-heroes.html"><img data-src="https://i.987967.xyz/screenshot/47/2020/11/27/42046_d54bf1.png" alt="Sonic Classic Heroes"></a>
<div class="thumb-stats pull-left"><h6>Genesis</h6></div>
<div class="thumb-stats pull-right"><i class="fa fa-heart"></i> <span>1,234</span></div></div>
<div class="post-des"><h6><a href="https://www.retrogames.cc/genesis-games/sonic-classic-heroes.html">Sonic Classic Heroes &amp; Friends</a></h6></div></div>'''
CARD2 = CARD.replace("sonic-classic-heroes", "streets-of-rage-2").replace("Sonic Classic Heroes &amp; Friends", "Streets of Rage 2").replace("1,234", "87")
PAGE = f"<html>{CARD}{CARD}{CARD2}<a href='/genesis-games/page/2.html'>2</a></html>"


class RetroGamesTests(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        p = mock.patch.object(retrogames, "CACHE_FILE", os.path.join(d, "cache.json"))
        p.start()
        self.addCleanup(p.stop)

    def test_reads_cards_without_repeats(self):
        games = retrogames.parse_cards(PAGE)
        self.assertEqual(len(games), 2)
        g = games[0]
        self.assertEqual(g["title"], "Sonic Classic Heroes & Friends")
        self.assertEqual(g["platform"], "Genesis")
        self.assertEqual(g["likes"], 1234)
        self.assertTrue(g["image"].endswith("42046_d54bf1.png"))

    def test_page_addresses(self):
        self.assertEqual(retrogames.page_url(), "https://www.retrogames.cc/")
        self.assertEqual(retrogames.page_url("snes"), "https://www.retrogames.cc/snes-games")
        self.assertEqual(retrogames.page_url("snes", 3), "https://www.retrogames.cc/snes-games/page/3.html")
        self.assertIn("search?q=super+mario", retrogames.page_url(query=" super mario "))
        with self.assertRaises(ValueError):
            retrogames.page_url("../etc")

    def test_list_games_and_more_pages(self):
        with mock.patch.object(retrogames, "_get", return_value=PAGE):
            out = retrogames.list_games("genesis")
        self.assertEqual(len(out["games"]), 2)
        self.assertTrue(out["more"])
        self.assertIn("Nintendo", out["platforms"])

    def test_no_internet_gives_a_friendly_error(self):
        with mock.patch.object(retrogames.requests, "get", side_effect=OSError("offline")):
            out = retrogames.list_games()
        self.assertIn("error", out)
        self.assertIn("internet", out["error"])

    def test_play_url_reads_the_embed_player(self):
        page = '<iframe id="gameFrame" src="//www.retrogames.cc/embed/42046-sonic-classic-heroes.html"></iframe>'
        with mock.patch.object(retrogames, "_get", return_value=page):
            out = retrogames.play_url("https://www.retrogames.cc/genesis-games/sonic-classic-heroes.html")
        self.assertEqual(out, {"url": "https://www.retrogames.cc/embed/42046-sonic-classic-heroes.html"})

    def test_play_url_backup_from_the_picture(self):
        with mock.patch.object(retrogames, "_get", side_effect=OSError("offline")):
            out = retrogames.play_url("https://www.retrogames.cc/genesis-games/sonic-classic-heroes.html",
                                      "https://i.987967.xyz/screenshot/47/2020/11/27/42046_d54bf1.png")
        self.assertEqual(out["url"], "https://www.retrogames.cc/embed/42046-sonic-classic-heroes.html")

    def test_only_english_games_are_shown(self):
        for t in ("Aladdin (USA)", "Aero the Acro-Bat (Europe)", "Tintin (Europe) (En,Fr,De,Es)", "1941 - Counter Attack (World)",
                  "Alcahest (Japan) [En by FH v1.0Beta]", "Aladdin 2000", "Aladdin (USA) (Beta)", "Pokemon Emerald (U)",
                  "Marvel vs Capcom (980123 USA)", "Super Bomberman 4 (English - Translated)", "DragonBall Z (E)(Rising Sun)", "Some Game (Beta, no intro)"):
            self.assertTrue(retrogames.is_english(t), t)
        for t in ("Aladdin (Japan)", "Aladdin (France)", "Aladdin (Germany)", "Dragon Ball Z - Supersonic Warriors (K)(ProjectG)",
                  "Akumajou Dracula XX (Japan)", "Some Game (Fr,De)", "JoJo (Japan 990927, NO CD)"):
            self.assertFalse(retrogames.is_english(t), t)
        page = PAGE + CARD.replace("sonic-classic-heroes", "aladdin-japan").replace("Sonic Classic Heroes &amp; Friends", "Aladdin (Japan)")
        with mock.patch.object(retrogames, "_get", return_value=page):
            self.assertEqual(len(retrogames.list_games("genesis")["games"]), 2)

    def test_only_retrogames_pages_can_be_played(self):
        for bad in ("https://evil.example/genesis-games/x.html", "http://www.retrogames.cc/genesis-games/x.html",
                    "https://www.retrogames.cc/../../x", "javascript:alert(1)", ""):
            self.assertIn("error", retrogames.play_url(bad), bad)


EMBED = """<script>EJS_player = '#game';
EJS_gameUrl = 'https://filesus3.retrogames.cc/rom/19/new/1941r1.zip';
EJS_gameParentUrl = 'https://filesus3.retrogames.cc/rom/19/new/1941.zip';
EJS_core = 'arcade';
EJS_biosUrl = '/bios/arcade.7z';</script>"""
GAME = {"title": "1941 - Counter Attack (World)", "url": "https://www.retrogames.cc/arcade-games/1941-counter-attack-world.html",
        "image": "https://i.987967.xyz/screenshot/19/7651_ab.png", "platform": "Arcade"}


class RetroPlayerTests(unittest.TestCase):
    """our own player: the game files, your saves, Recent + Favorites (all in a temp folder, no internet)"""
    def setUp(self):
        self.d = tempfile.mkdtemp()
        for name, val in (("CACHE_FILE", "cache.json"), ("ROM_DIR", "roms"), ("SAVE_DIR", "saves"), ("LIBRARY_FILE", "lib.json")):
            p = mock.patch.object(retrogames, name, os.path.join(self.d, val))
            p.start()
            self.addCleanup(p.stop)
        retrogames._downloads.clear()

    def test_reads_the_embed_player(self):
        info = retrogames.parse_embed(EMBED)
        self.assertEqual(info["core"], "arcade")
        self.assertTrue(info["game_url"].endswith("/1941r1.zip"))
        self.assertTrue(info["parent_url"].endswith("/1941.zip"))
        self.assertEqual(info["bios_url"], "https://www.retrogames.cc/bios/arcade.7z")
        self.assertEqual(retrogames.parse_embed(EMBED.replace("'arcade'", "'mupen64plus2'"))["core"], "n64")
        self.assertIsNone(retrogames.parse_embed("<html>no player</html>"))

    def test_prepare_keeps_the_file_names_and_wraps_the_parent(self):
        import zipfile

        class Resp:
            def __init__(self, url):
                self.headers = {"Content-Length": "4"}
                self.url = url
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def raise_for_status(self): pass
            def iter_content(self, n): yield b"DATA"

        pages = {GAME["url"]: '<iframe src="//www.retrogames.cc/embed/7651-1941-counter-attack-world.html">', }
        with mock.patch.object(retrogames, "_get", side_effect=lambda u, fresh=False: pages.get(u, EMBED)), \
             mock.patch.object(retrogames.requests, "get", side_effect=lambda url, **k: Resp(url)), \
             mock.patch.object(retrogames.threading, "Thread", side_effect=lambda target, args, daemon: mock.Mock(start=lambda: target(*args))):
            out = retrogames.prepare(GAME)
        self.assertEqual(out, {"id": "7651", "core": "arcade", "rom": "roms/7651/1941r1.zip", "bios": "roms/bios/arcade.7z",
                               "parent": "roms/7651/1941.zip.wrap.zip"})
        self.assertTrue(retrogames.progress("7651", out["bios"], out["parent"])["done"])
        with zipfile.ZipFile(os.path.join(self.d, "roms", "7651", "1941.zip.wrap.zip")) as z:
            self.assertEqual(z.namelist(), ["1941.zip"])           # the player unpacks it back to 1941.zip
        self.assertEqual(retrogames.library()["recent"][0]["id"], "7651")

    def test_saves_are_kept_with_a_backup(self):
        self.assertIsNone(retrogames.load_data("7651", "state")["data"])
        self.assertTrue(retrogames.save_data("7651", "state", "AAEC")["ok"])
        self.assertTrue(retrogames.save_data("7651", "state", "AwQF")["ok"])
        self.assertEqual(retrogames.load_data("7651", "state")["data"], "AwQF")
        self.assertTrue(os.path.exists(os.path.join(self.d, "saves", "7651", "state.prev.bin")))
        self.assertIn("error", retrogames.save_data("7651", "state", ""))
        for gid, kind in (("../x", "state"), ("7651", "../../evil"), ("7651", "other")):
            self.assertIn("error", retrogames.save_data(gid, kind, "AAEC"))

    def test_downloaded_games_can_be_deleted(self):
        for gid, data in (("7651", b"x" * 10), ("42046", b"y" * 5)):
            os.makedirs(os.path.join(self.d, "roms", gid))
            with open(os.path.join(self.d, "roms", gid, "game.zip"), "wb") as f:
                f.write(data)
        os.makedirs(os.path.join(self.d, "roms", "bios"))
        retrogames.add_recent({**GAME, "id": "7651"})
        retrogames.save_data("7651", "state", "AAEC")
        out = retrogames.downloads()
        self.assertEqual(out["total"], 15)
        names = {g["id"]: g["title"] for g in out["games"]}
        self.assertEqual(names, {"7651": GAME["title"], "42046": "Game"})      # the BIOS folder isn't a game
        out = retrogames.delete_download("7651")
        self.assertEqual([g["id"] for g in out["games"]], ["42046"])
        self.assertIsNotNone(retrogames.load_data("7651", "state")["data"])     # the save is kept
        self.assertIn("error", retrogames.delete_download("../bios"))
        self.assertEqual(retrogames.delete_download("all")["games"], [])
        self.assertTrue(os.path.isdir(os.path.join(self.d, "roms", "bios")))

    def test_recent_and_favorites(self):
        retrogames.add_recent({**GAME, "id": "7651"})
        retrogames.add_recent({**GAME, "id": "7651"})                 # played again: still one entry
        retrogames.save_data("7651", "sram", "AAEC")
        lib = retrogames.library()
        self.assertEqual(len(lib["recent"]), 1)
        self.assertTrue(lib["recent"][0]["saved"])
        lib = retrogames.favorite(GAME, True)
        self.assertEqual([g["title"] for g in lib["favorites"]], [GAME["title"]])
        self.assertEqual(lib["favorites"][0]["id"], "7651")
        self.assertEqual(retrogames.favorite(GAME, False)["favorites"], [])
        self.assertIn("error", retrogames.favorite({"url": "https://evil.example/x.html"}))


if __name__ == "__main__":
    unittest.main()
