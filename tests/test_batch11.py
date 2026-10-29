"""Batch 11: music ducking, the game companion = the app's character, gym exercise alternatives, plugins,
the installer package, and the Robotics & Electronics assistant."""
import os, sys, json, tempfile, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
for _name in ("speech_recognition", "sounddevice", "soundfile", "keyboard", "groq", "webview"):
    try:
        __import__(_name)
    except Exception:
        sys.modules[_name] = mock.MagicMock()

import ducking, gym, electronics, plugins, tools  # noqa: E402


class DuckingTests(unittest.TestCase):
    def setUp(self):
        ducking.release_all()
        ducking.enabled = True
        self.addCleanup(setattr, ducking, "enabled", False)

    def test_lowers_then_restores_other_apps(self):
        vol = mock.Mock()
        vol.GetMasterVolume.return_value = 0.8
        with mock.patch.object(ducking, "_sessions", return_value=[("spotify.exe:1", "spotify.exe", vol)]), mock.patch.object(ducking, "FADE", 0):
            ducking.duck("command")
            self.assertAlmostEqual(vol.SetMasterVolume.call_args[0][0], 0.16, places=3)
            vol.GetMasterVolume.return_value = 0.16
            ducking.release("command", delay=0)
            ducking._restore()
        self.assertAlmostEqual(vol.SetMasterVolume.call_args[0][0], 0.8, places=3)
        self.assertFalse(ducking.ducked())

    def test_volume_turned_up_by_user_is_kept(self):
        vol = mock.Mock()
        vol.GetMasterVolume.return_value = 0.5
        with mock.patch.object(ducking, "_sessions", return_value=[("chrome.exe:2", "chrome.exe", vol)]), mock.patch.object(ducking, "FADE", 0):
            ducking.duck("speak")
            vol.GetMasterVolume.return_value = 0.9          # moved the slider up while ducked
            n = vol.SetMasterVolume.call_count
            ducking.release("speak", delay=0); ducking._restore()
        self.assertEqual(vol.SetMasterVolume.call_count, n)

    def test_always_comes_back_even_if_nudged(self):
        vol = mock.Mock()
        vol.GetMasterVolume.return_value = 0.6
        with mock.patch.object(ducking, "_sessions", return_value=[("discord.exe:3", "discord.exe", vol)]), mock.patch.object(ducking, "FADE", 0):
            ducking.duck("speak")
            vol.GetMasterVolume.return_value = 0.17         # Discord nudged its own volume a little
            ducking.release("speak", delay=0); ducking._restore()
        self.assertAlmostEqual(vol.SetMasterVolume.call_args[0][0], 0.6, places=3)

    def test_quick_replies_dont_creep_quieter(self):
        vol = mock.Mock()
        vol.GetMasterVolume.return_value = 0.8
        with mock.patch.object(ducking, "_sessions", return_value=[("spotify.exe:1", "spotify.exe", vol)]), mock.patch.object(ducking, "FADE", 0):
            for _ in range(5):
                ducking.duck("command")
                vol.GetMasterVolume.return_value = 0.4      # next question while it was only half-way back up
            vol.GetMasterVolume.return_value = 0.16
            ducking.release("command", delay=0); ducking._restore()
        self.assertAlmostEqual(vol.SetMasterVolume.call_args[0][0], 0.8, places=3)

    def test_app_restarted_while_lowered_comes_back(self):
        old, new = mock.Mock(), mock.Mock()
        old.GetMasterVolume.return_value = 0.7
        new.GetMasterVolume.return_value = 0.14             # Windows gave the restarted app the lowered volume
        with mock.patch.object(ducking, "FADE", 0):
            with mock.patch.object(ducking, "_sessions", return_value=[("discord.exe:4", "discord.exe", old)]):
                ducking.duck("speak")
            with mock.patch.object(ducking, "_sessions", return_value=[("discord.exe:9", "discord.exe", new)]):
                ducking.release("speak", delay=0); ducking._restore()
        self.assertAlmostEqual(new.SetMasterVolume.call_args[0][0], 0.7, places=3)

    def test_off_does_nothing(self):
        ducking.enabled = False
        try:
            with mock.patch.object(ducking, "_sessions") as s:
                ducking.duck("command")
            s.assert_not_called()
        finally:
            ducking.enabled = False


class CompanionTests(unittest.TestCase):
    def test_pip_becomes_the_companion(self):
        from game.campaign import Game
        from game import companion
        g = Game.new(name="T", species="human", cls_id="warrior", seed=3, use_ai=False,
                     companion_profile={"id": "pip", "name": "Pip", "persona": "You are Pip, a penguin.",
                                        "model": "cute_animated_monsters_penguin", "body": "blob", "size": 1.1,
                                        "voice": "piper:en_US-hfc_female-medium", "rate": "+5%", "pitch": "+20Hz", "voice_online": ""})
        v = next(p for p in g.camp["party"] if p["uid"] == "vermeil")
        self.assertEqual((v["name"], v["model"], v["body"], v["size"]), ("Pip", "cute_animated_monsters_penguin", "blob", 1.1))
        self.assertEqual(companion.name(g.camp), "Pip")
        self.assertIn("Pip", companion.system_prompt(g.camp))
        self.assertEqual(g.camp["voices"]["vermeil"]["voice"], "piper:en_US-hfc_female-medium")
        r = companion.react(g.camp, "arrive", force=True, use_ai=False)
        self.assertTrue(r["line"])

    def test_default_is_still_vermeil(self):
        from game.campaign import Game
        from game import companion
        g = Game.new(name="T", species="human", cls_id="warrior", seed=4, use_ai=False)
        self.assertEqual(companion.name(g.camp), "Vermeil")
        self.assertEqual(companion.system_prompt(g.camp), companion.VERMEIL_SYSTEM)


class AlternativesTests(unittest.TestCase):
    def test_exercise_finds_its_group_best_first(self):
        r = gym.find_alternatives("bench press", use_ai=False)
        self.assertEqual(r["match"]["name"], "Barbell Bench Press")
        stars = [a["stars"] for a in r["alternatives"]]
        self.assertEqual(stars, sorted(stars, reverse=True))
        self.assertIn(0, stars)                               # the worst alternative is shown too
        self.assertTrue(any("Jeff Nippard" in a["used_by"] for a in r["alternatives"]))

    def test_muscle_search(self):
        r = gym.find_alternatives("chest", use_ai=False)
        self.assertEqual(r["kind"], "muscle")
        self.assertGreater(len(r["alternatives"]), 8)

    def test_every_entry_is_valid(self):
        db = gym.exercise_db()
        for g in db["groups"]:
            for ex in g["exercises"]:
                self.assertTrue(0 <= ex["stars"] <= 5, ex["name"])
                for p in ex["used_by"]:
                    self.assertIn(p, db["people"], ex["name"])

    def test_tool(self):
        self.assertIn("Alternatives to", tools.run_tool("exercise_alternatives", {"exercise": "lat pulldown"}))


class ElectronicsTests(unittest.TestCase):
    def test_formulas(self):
        r = electronics.calc("led", {"Vs": 5, "Vf": 2, "I": 15, "n": 1})
        self.assertEqual(dict(r["results"])["Use this resistor"], "220 Ω")
        self.assertEqual(dict(electronics.calc("ohm", {"V": "5", "R": "220"})["results"])["Current"], "22.7 mA")
        self.assertEqual(dict(electronics.calc("colors", {"bands": "yellow violet red gold"})["results"])["Value"], "4.7 kΩ")
        self.assertIn("error", electronics.calc("ohm", {"V": "5"}))
        for k in electronics.FORMULAS:                          # every calculator works with its own example values
            vals = {f[0]: f[3] for f in electronics.FORMULAS[k]["fields"] if len(f) > 3}
            if vals:
                self.assertNotIn("error", electronics.calc(k, vals), k)

    def test_parse(self):
        self.assertEqual(electronics.parse("4.7k"), 4700)
        self.assertAlmostEqual(electronics.parse("100n"), 1e-7)
        self.assertAlmostEqual(electronics.parse("2.2u"), 2.2e-6)

    def test_projects(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(electronics, "PROJECTS", d):
            electronics.save_project("My robot!", {"parts": [], "wires": []})
            self.assertEqual(electronics.list_projects()[0]["name"], "My robot")
            self.assertEqual(electronics.load_project("My robot")["data"], {"parts": [], "wires": []})
            electronics.delete_project("My robot")
            self.assertEqual(electronics.list_projects(), [])

    def test_ask_pulls_out_the_lab_circuit(self):
        reply = "Here's your robot.\n```lab\n{\"parts\": [{\"id\": \"uno\", \"type\": \"uno\"}], \"wires\": []}\n```"
        client = mock.Mock()
        client.chat.completions.create.return_value = mock.Mock(choices=[mock.Mock(message=mock.Mock(content=reply))])
        with mock.patch("llm.get_client", return_value=client):
            r = electronics.ask("robot", "a robot that avoids walls")
        self.assertEqual(r["lab"]["parts"][0]["type"], "uno")
        self.assertNotIn("```lab", r["answer"])


class PluginTests(unittest.TestCase):
    def test_fresh_state_hides_uninstalled_menus(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(plugins, "STATE_FILE", os.path.join(d, "p.json")):
            plugins._save({"fresh": True, "installed": {"spotify": False, "gym": True}})
            self.assertIn("spotify", plugins.hidden_panels())
            self.assertNotIn("gym", plugins.hidden_panels())
            self.assertTrue(plugins.status()["fresh"])
            plugins.finish_first_run()
            self.assertFalse(plugins._load()["fresh"])

    def test_uninstall_asks_before_deleting_unrestorable_files(self):
        p = {"id": "x", "name": "X", "folders": ["nope/folder"], "pack": "nopack", "panels": []}
        with mock.patch.dict(plugins.BY_ID, {"x": p}):
            self.assertIn("confirm", plugins.uninstall("x"))

    def test_uninstall_keeps_packages_other_plugins_need(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(plugins, "STATE_FILE", os.path.join(d, "p.json")), \
                mock.patch.object(plugins, "_pip") as pip, mock.patch.object(plugins, "has_module", return_value=True):
            plugins._save({"installed": {p["id"]: True for p in plugins.PLUGINS}})
            plugins.uninstall("study")
            self.assertFalse(plugins._load()["installed"]["study"])
        args = pip.call_args[0][0]
        self.assertIn("pypdf", args)


class PlaylistLabTests(unittest.TestCase):
    """a fake Spotify: one playlist with 3 songs, search finds anything, creating a playlist is recorded"""
    def setUp(self):
        import playlist_lab, spotify
        self.pl, self.sp = playlist_lab, spotify
        self.tmp = tempfile.mkdtemp()
        self.calls = []
        tr = lambda n, a, y, e=False: {"type": "track", "name": n, "artists": [{"name": a}], "uri": f"spotify:track:{n}", "explicit": e,
                                       "duration_ms": 200000, "album": {"name": "X", "release_date": f"{y}-01-01"}}

        def call(method, path, params=None, body=None, retry=True):
            self.calls.append((method, path, body))
            if path == "/playlists/abcdefghijklmnopqrstuv":
                return {"name": "Gym Hype", "owner": {"display_name": "JP"}, "images": [], "external_urls": {}}
            if path.endswith("/items") and method == "GET":
                return {"items": [{"item": tr("Lose Yourself", "Eminem", 2002, True)}, {"item": tr("Stronger", "Kanye West", 2007)},
                                  {"item": tr("Till I Collapse", "Eminem", 2002, True)}], "next": None}
            if path == "/search":
                q = params["q"]
                return {"tracks": {"items": [tr(q.split('"')[1] if '"' in q else q, q.split('"')[3] if q.count('"') >= 4 else "Someone", 2010)]}}
            if path == "/me/playlists" and method == "POST":
                return {"id": "new1", "name": body["name"], "uri": "spotify:playlist:new1", "external_urls": {"spotify": "https://open.spotify.com/playlist/new1"}}
            return {}
        self.p = [mock.patch.object(spotify, "call", side_effect=call), mock.patch.object(playlist_lab, "ANALYSES", os.path.join(self.tmp, "a.json")),
                  mock.patch.object(spotify, "can_make_playlists", return_value=True)]
        for p in self.p: p.start()

    def tearDown(self):
        for p in self.p: p.stop()
        import shutil; shutil.rmtree(self.tmp)

    def fake_ai(self, prompt, **k):
        if "Analyse" in prompt:
            return {"genres": [{"name": "hip hop", "pct": 80}, {"name": "rap rock", "pct": 20}], "moods": ["intense"], "energy": 9,
                    "vibe": "Loud gym rap.", "similar_artists": ["DMX"], "name_ideas": ["Beast Mode"]}
        return {"name": "Beast Mode", "description": "More gym rap.", "songs": [{"title": "Lose Yourself", "artist": "Eminem"},
                {"title": "X Gon' Give It to Ya", "artist": "DMX"}, {"title": "Power", "artist": "Kanye West"}]}

    def test_analyse_counts_and_ai(self):
        with mock.patch("llm.ask", side_effect=self.fake_ai):
            a = self.pl.analyse("https://open.spotify.com/playlist/abcdefghijklmnopqrstuv?si=1")
        st = a["stats"]
        self.assertEqual((st["songs"], st["artists"], st["explicit_pct"]), (3, 2, 67))
        self.assertEqual(st["top_artists"][0], {"name": "Eminem", "songs": 2})
        self.assertEqual([d["decade"] for d in st["decades"]], ["2000s"])
        self.assertEqual(a["ai"]["energy"], 9)
        self.assertEqual(self.pl.analyses()[0]["name"], "Gym Hype")

    def test_make_skips_songs_already_in_it_and_creates_the_playlist(self):
        with mock.patch("llm.ask", side_effect=self.fake_ai):
            self.pl.analyse("abcdefghijklmnopqrstuv")
            r = self.pl.make_playlist("abcdefghijklmnopqrstuv", size=10, style="discover")
        self.assertEqual(r["name"], "Beast Mode")
        self.assertEqual([t["title"] for t in r["added"]], ["X Gon' Give It to Ya", "Power"])     # 'Lose Yourself' was already in it
        add = next(c for c in self.calls if c[0] == "POST" and c[1] == "/playlists/new1/items")
        self.assertEqual(len(add[2]["uris"]), 2)

    def test_needs_reconnect_for_old_logins(self):
        with mock.patch("llm.ask", side_effect=self.fake_ai):
            self.pl.analyse("abcdefghijklmnopqrstuv")
        with mock.patch.object(self.sp, "can_make_playlists", return_value=False):
            self.assertTrue(self.pl.make_playlist("abcdefghijklmnopqrstuv")["reconnect"])


class MyMusicTests(unittest.TestCase):
    """Vermeil Music: no Spotify, no internet - YouTube search and the player are faked"""
    def setUp(self):
        import mymusic, f1
        self.m, self.f1 = mymusic, f1
        self.tmp = tempfile.mkdtemp()
        self.played = []
        fake = lambda q, n=12: [mymusic.song(q.split(" ", 1)[-1] or q, q.split(" ", 1)[0], "id" + str(abs(hash(q)) % 10**6), 200)]
        self.p = [mock.patch.object(mymusic, "LIB_FILE", os.path.join(self.tmp, "m.json")), mock.patch.object(mymusic, "search", side_effect=fake),
                  mock.patch.object(f1, "music_control", side_effect=lambda *a: self.played.append(a) or "ok")]
        for p in self.p: p.start()

    def tearDown(self):
        for p in self.p: p.stop()
        import shutil; shutil.rmtree(self.tmp)

    def test_titles_are_cleaned(self):
        self.assertEqual(self.m.split_title("Eminem - Lose Yourself (Official Music Video)"), ("Lose Yourself", "Eminem"))
        self.assertEqual(self.m.split_title("Stronger", "KanyeWestVEVO"), ("Stronger", "KanyeWest"))

    def test_playlists_like_and_play(self):
        s1, s2 = self.m.song("Lose Yourself", "Eminem", "a1"), self.m.song("Stronger", "Kanye West", "b2")
        p = self.m.create_playlist("Gym Hype", "", [s1, s1, s2])               # duplicates are dropped
        self.assertEqual(p["count"], 2)
        self.assertEqual(self.m.add_songs(p["id"], [s2]), 0)
        self.m.move_song(p["id"], 1, 0)
        self.assertEqual(self.m.get_playlist(p["id"])["songs"][0]["title"], "Stronger")
        self.m.like(s1)
        self.assertTrue(self.m.is_liked(s1))
        self.assertEqual(self.m.library()["liked"], 1)
        self.m.play_by_name("gym")                                              # fuzzy name
        self.assertEqual(self.played[1], ("play", "https://www.youtube.com/watch?v=b2", "now"))
        self.assertEqual(self.played[2], ("play", "https://www.youtube.com/watch?v=a1", "later"))
        self.assertIn("don't have a playlist", self.m.play_by_name("jazz"))

    def test_import_text_and_lab(self):
        p = self.m.import_text("1. Eminem - Lose Yourself\nStronger by Kanye West\n", "Mine")
        self.assertEqual([s["artist"] for s in self.m.get_playlist(p["id"])["songs"]], ["Eminem", "Kanye West"])
        ai = lambda prompt, **k: ({"genres": [{"name": "hip hop", "pct": 100}], "energy": 9, "moods": ["hype"]} if "Analyse" in prompt else
                                  {"name": "Beast Mode", "songs": [{"title": "Power", "artist": "Kanye West"}, {"title": "Lose Yourself", "artist": "Eminem"}]})
        with mock.patch("llm.ask", side_effect=ai):
            a = self.m.analyse(p["id"])
            self.assertEqual(a["stats"]["songs"], 2)
            r = self.m.make_from(p["id"], 10, "discover")
        self.assertEqual(r["name"], "Beast Mode")
        self.assertEqual([s["title"] for s in r["songs"]], ["Power"])           # 'Lose Yourself' was already in it
        self.assertEqual(len(self.m.library()["playlists"]), 2)

    def test_lyric_videos_win(self):
        mv = {**self.m.song("Lose Yourself", "Eminem", "mv1", 326), "mv": True}
        lyr = {**self.m.song("Lose Yourself", "Eminem", "ly1", 320), "lyric": True}
        with mock.patch.object(self.m, "search", return_value=[mv, lyr]) as s:
            self.assertEqual(self.m.find_one("Lose Yourself", "Eminem")["yt"], "ly1")
            self.assertIn("lyrics", s.call_args.args[0])
            self.assertEqual(self.m.find_one("Lose Yourself", "Eminem", lyrics=False)["yt"], "mv1")
            p = self.m.create_playlist("Old", "", [self.m.song("Lose Yourself", "Eminem", "mv1", 326)])
            r = self.m.convert_to_lyrics(p["id"])
        self.assertEqual(r["changed"], 1)
        self.assertEqual(r["songs"][0]["yt"], "ly1")
        self.assertTrue(r["songs"][0]["lyric"])
        self.assertTrue(self.m.play_query({"title": "Stronger", "artist": "Kanye West"}).endswith("lyrics"))

    def test_voice_routing_uses_my_playlists(self):
        import app
        self.m.create_playlist("Gym Hype", "", [self.m.song("Power", "Kanye West", "c3")])
        api = app.Api.__new__(app.Api)
        api._settings = {"music_source": "youtube"}
        self.assertIn("Gym Hype", api._music_quick("play my gym hype playlist"))
        self.assertIsNone(api._music_quick("play my sleepy rainy playlist"))  # not one of mine -> the AI handles it


class PackageTests(unittest.TestCase):
    def test_secrets_are_never_packed(self):
        import package_app as pk
        a = mock.Mock(with_my_data=True, offline=True, with_blender=True, with_library=True)
        for secret in ("env", ".env", "data/spotify_token.json", "data/google_token.json", "data/cookies.txt"):
            self.assertFalse(pk.wanted(secret, a), secret)
        self.assertTrue(pk.wanted("app.py", a))
        self.assertFalse(pk.wanted("ui/game/assets/x.gltf", a))        # goes into plugin_packs/game_assets.zip
        b = mock.Mock(with_my_data=False, offline=False, with_blender=False, with_library=False)
        self.assertFalse(pk.wanted("data/vermeil_memory_0.json", b))
        self.assertTrue(pk.wanted("data/piper_voices/en_US-amy-medium.onnx", b))


if __name__ == "__main__":
    unittest.main()
