"""Retro Games (skills/retrogames.py): reading the website's game cards, your lists and saves - no internet needed."""
import os
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import folders  # noqa
import sandbox  # noqa: E402,F401
import retrogames

CARD = '''<a href="/sega-genesis-rom-sonic-the-hedgehog/" class="relative p-2">
  <img src="https://cache.example/static/abc/image.jpg" class="mb-3" alt="Sonic &amp; Friends">
  <div class="ml-2">Sonic &amp; Friends</div></a>'''
PAGE = CARD + CARD + CARD.replace("sonic-the-hedgehog", "streets-of-rage").replace("Sonic &amp; Friends", "Streets of Rage") + \
    '<a href="/sega-saturn-rom-nights/"><img src="x.jpg" alt="Nights"></a>' \
    '<a href="/super-nintendo-rom-super-mario-world/" class="rounded-full"><span>Super Mario World ROM</span></a>' \
    '<a href="/roms/sega-genesis/?page=2&amp;sort=popularity">2</a>'
GAME = {"title": "Sonic", "url": "https://www.romsgames.net/sega-genesis-rom-sonic-the-hedgehog/", "image": "https://cache.example/x.jpg", "platform": "Genesis"}


class RetroGamesTests(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        p = mock.patch.object(retrogames, "CACHE_FILE", os.path.join(d, "cache.json"))
        p.start()
        self.addCleanup(p.stop)

    def test_reads_cards_without_repeats(self):
        games = retrogames.parse_cards(PAGE)
        self.assertEqual([g["title"] for g in games], ["Sonic & Friends", "Streets of Rage"])     # no link-only "Mario", no Saturn
        self.assertEqual(games[0]["platform"], "Genesis")
        self.assertEqual(games[0]["url"], GAME["url"])
        self.assertEqual(games[0]["image"], "https://cache.example/static/abc/image.jpg")

    def test_page_addresses(self):
        self.assertEqual(retrogames.page_url("super-nintendo"), "https://www.romsgames.net/roms/super-nintendo/")
        self.assertEqual(retrogames.page_url("super-nintendo", 3), "https://www.romsgames.net/roms/super-nintendo/?page=3")
        self.assertIn("/search/?q=super+mario", retrogames.page_url(query=" super mario "))
        with self.assertRaises(ValueError):
            retrogames.page_url("../etc")

    def test_list_games_and_more_pages(self):
        with mock.patch.object(retrogames, "_get", return_value=PAGE):
            out = retrogames.list_games("sega-genesis")
            self.assertFalse(retrogames.list_games("sega-genesis", 2)["more"])
        self.assertEqual(len(out["games"]), 2)
        self.assertTrue(out["more"])
        self.assertIn("Nintendo", out["platforms"])

    def test_most_popular_takes_turns_between_consoles(self):
        def page(url, fresh=False):
            plat = url.rstrip("/").rsplit("/", 1)[-1]
            return f'<a href="/{plat}-rom-a/"><img src="a.jpg" alt="{plat} A"></a><a href="/{plat}-rom-b/"><img src="b.jpg" alt="{plat} B"></a>'
        with mock.patch.object(retrogames, "_get", side_effect=page):
            games = retrogames.list_games()["games"]
        self.assertEqual(games[0]["title"], f"{retrogames.POPULAR[0]} A")
        self.assertEqual(games[1]["title"], f"{retrogames.POPULAR[1]} A")
        self.assertEqual(len(games), 2 * len(retrogames.POPULAR))

    def test_no_internet_gives_a_friendly_error(self):
        with mock.patch.object(retrogames.requests, "get", side_effect=OSError("offline")):
            out = retrogames.list_games()
        self.assertIn("error", out)
        self.assertIn("internet", out["error"])

    def test_only_english_games_are_shown(self):
        for t in ("Aladdin (USA)", "Aero the Acro-Bat (Europe)", "Tintin (Europe) (En,Fr,De,Es)", "1941 - Counter Attack (World)",
                  "Alcahest (Japan) [En by FH v1.0Beta]", "Aladdin 2000", "Aladdin (USA) (Beta)", "Pokemon Emerald (U)",
                  "Marvel vs Capcom (980123 USA)", "Super Bomberman 4 (English - Translated)", "DragonBall Z (E)(Rising Sun)", "Some Game (Beta, no intro)"):
            self.assertTrue(retrogames.is_english(t), t)
        for t in ("Aladdin (Japan)", "Aladdin (France)", "Aladdin (Germany)", "Dragon Ball Z - Supersonic Warriors (K)(ProjectG)",
                  "Akumajou Dracula XX (Japan)", "Some Game (Fr,De)", "JoJo (Japan 990927, NO CD)"):
            self.assertFalse(retrogames.is_english(t), t)
        page = PAGE + CARD.replace("sonic-the-hedgehog", "aladdin-japan").replace("Sonic &amp; Friends", "Aladdin (Japan)")
        with mock.patch.object(retrogames, "_get", return_value=page):
            self.assertEqual(len(retrogames.list_games("sega-genesis")["games"]), 2)

    def test_only_the_sites_game_pages_count(self):
        self.assertTrue(retrogames.is_game_url(GAME["url"]))
        for bad in ("https://evil.example/sega-genesis-rom-x/", "http://www.romsgames.net/sega-genesis-rom-x/", "https://www.romsgames.net/sega-saturn-rom-x/",
                    "https://www.retrogames.cc/genesis-games/x.html", "https://www.romsgames.net/roms/sega-genesis/", "javascript:alert(1)", ""):
            self.assertFalse(retrogames.is_game_url(bad), bad)

    def test_game_id_is_a_steady_number(self):
        self.assertTrue(retrogames.game_id(GAME["url"]).isdigit())
        self.assertEqual(retrogames.game_id(GAME["url"]), retrogames.game_id(GAME["url"]))
        self.assertNotEqual(retrogames.game_id(GAME["url"]), retrogames.game_id(GAME["url"].replace("sonic", "tails")))


class YourGamesTests(unittest.TestCase):
    """what's on this PC, your saves, Recent + Favorites (all in a temp folder, no internet)"""
    def setUp(self):
        self.d = tempfile.mkdtemp()
        for name, val in (("CACHE_FILE", "cache.json"), ("ROM_DIR", "roms"), ("SAVE_DIR", "saves"), ("LIBRARY_FILE", "lib.json")):
            p = mock.patch.object(retrogames, name, os.path.join(self.d, val))
            p.start()
            self.addCleanup(p.stop)

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
            os.makedirs(os.path.join(self.d, "roms", gid, "rom"))           # the opened archive doesn't name the game
            with open(os.path.join(self.d, "roms", gid, "game.zip"), "wb") as f:
                f.write(data)
        os.makedirs(os.path.join(self.d, "roms", "bios"))
        retrogames.add_recent({**GAME, "id": "7651"})
        retrogames.save_data("7651", "state", "AAEC")
        out = retrogames.downloads()
        self.assertEqual(out["total"], 15)
        names = {g["id"]: g["title"] for g in out["games"]}
        self.assertEqual(names, {"7651": GAME["title"], "42046": "Game"})      # the BIOS folder isn't a game
        with mock.patch.object(retrogames, "downloading", {"7651"}):
            self.assertIn("error", retrogames.delete_download("7651"))
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

    def test_games_from_the_old_site_are_left_out(self):
        retrogames._write_library({"recent": [{"title": "Old", "url": "https://www.retrogames.cc/genesis-games/x.html"}, {**GAME, "id": "1"}], "favorites": []})
        self.assertEqual([g["title"] for g in retrogames.library()["recent"]], [GAME["title"]])


if __name__ == "__main__":
    unittest.main()
