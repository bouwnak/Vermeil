"""31 Oct round: Steam/Epic games in the hub, the Browser panel, trips on the calendar, UniMate gets the body only,
UniMate's earlier clips found again (Fix my animations), the plain language voice"""
import json, os, sys, tempfile, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real logins, keys and installs)
for _name in ("speech_recognition", "sounddevice", "soundfile", "keyboard", "groq", "webview"):
    try:
        __import__(_name)
    except Exception:
        sys.modules[_name] = mock.MagicMock()
import launchers  # noqa: E402
import vbrowser  # noqa: E402
import slimrig  # noqa: E402


class LauncherTests(unittest.TestCase):
    """Games hub -> Installed games: a Steam library read from its files (nothing in Steam is changed)"""
    def test_steam_library(self):
        with tempfile.TemporaryDirectory() as d:
            steam, lib = os.path.join(d, "Steam"), os.path.join(d, "Games")
            for folder in (os.path.join(steam, "steamapps"), os.path.join(lib, "steamapps")):
                os.makedirs(folder)
            with open(os.path.join(steam, "steamapps", "libraryfolders.vdf"), "w") as f:
                f.write('"libraryfolders"\n{\n "0" { "path" "%s" }\n "1" { "path" "%s" }\n}' % (steam.replace("\\", "\\\\"), lib.replace("\\", "\\\\")))
            game = '"AppState"\n{\n "appid" "%s"\n "name" "%s"\n "StateFlags" "4"\n "SizeOnDisk" "2000000000"\n}'
            for folder, appid, name in ((steam, "291550", "Brawlhalla"), (lib, "228980", "Steamworks Common Redistributables")):
                with open(os.path.join(folder, "steamapps", f"appmanifest_{appid}.acf"), "w") as f:
                    f.write(game % (appid, name))
            os.makedirs(os.path.join(steam, "appcache", "librarycache", "291550", "abc"))
            with open(os.path.join(steam, "appcache", "librarycache", "291550", "abc", "library_600x900.jpg"), "wb") as f:
                f.write(b"jpg")
            with mock.patch.object(launchers, "_steam_root", return_value=steam), \
                    mock.patch.object(launchers, "COVER_DIR", os.path.join(d, "covers")):
                games = launchers.steam_games()
        self.assertEqual([g["name"] for g in games], ["Brawlhalla"])          # the redistributables aren't a game
        self.assertEqual(games[0]["cover"], "covers/steam_291550.jpg")
        self.assertTrue(games[0]["ready"])
        self.assertEqual(games[0]["size_gb"], 2.0)

    def test_play_uses_the_launcher(self):
        with mock.patch.object(launchers.os, "startfile", create=True) as start:
            self.assertTrue(launchers.play("steam", "291550")["ok"])
            start.assert_called_with("steam://rungameid/291550")
            self.assertTrue(launchers.play("epic", "ns:item:App")["ok"])
            self.assertIn("com.epicgames.launcher://apps/ns%3Aitem%3AApp", start.call_args[0][0])
        self.assertIn("error", launchers.play("steam", "1; del *"))


class BrowserTests(unittest.TestCase):
    def test_typed_text_becomes_an_address(self):
        self.assertEqual(vbrowser.to_url("youtube.com"), "https://youtube.com")
        self.assertEqual(vbrowser.to_url("https://a.b/c"), "https://a.b/c")
        self.assertEqual(vbrowser.to_url("steel beams"), "https://www.google.com/search?q=steel+beams")
        self.assertEqual(vbrowser.to_url("  "), "")

    def test_speed_dial_and_history(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(vbrowser, "FILE", os.path.join(d, "b.json")):
            b = vbrowser.Browser(lambda e: None)
            st = b.dial_add("Canvas", "canvas.com")
            self.assertIn({"name": "Canvas", "url": "https://canvas.com"}, st["dial"])
            self.assertNotIn("https://canvas.com", [x["url"] for x in b.dial_remove("https://canvas.com")["dial"]])
            b._remember("https://a.com", "A")
            b._remember("https://a.com", "A again")                       # once, newest first
            self.assertEqual([h["title"] for h in b.state()["history"]], ["A again"])


class SlimTests(unittest.TestCase):
    """UniMate gets the body only: no fingers, hair, dress, face or helper bones"""
    def test_names(self):
        body = ["L_arm_082", "R_elbow_0117", "calf_l_00", "LThigh_025", "Hips_04", "head_08", "upper_arm.L", "spine.003"]
        not_body = ["L_indexfinger_A_088", "BK_R_elbow_00_0142", "LFeelerA1_05", "LHair1_077", "jaw_A_01", "R_wrist_EX_0141",
                    "thumb_01_l_023", "skirt_back_02", "L_weapon_0200"]
        for n in body:
            self.assertFalse(slimrig.NOT_BODY.search(slimrig.body_name(n)), n)
        for n in not_body:
            self.assertTrue(slimrig.NOT_BODY.search(slimrig.body_name(n)), n)

    def test_real_model(self):
        src = os.path.join(ROOT, "ui", "models", "gardevoir.glb")
        if not os.path.exists(src):
            self.skipTest("no gardevoir.glb")
        with tempfile.TemporaryDirectory() as d:
            before, after = slimrig.slim(src, os.path.join(d, "g.glb"), body_only=True)
            js, _ = slimrig.read_glb(os.path.join(d, "g.glb"))
        names = [slimrig.body_name(js["nodes"][j].get("name", "")) for s in js["skins"] for j in s["joints"]]
        self.assertLess(after, before)
        self.assertIn("lthigh", names)
        self.assertFalse([n for n in names if "feeler" in n])               # her dress is moved by the app


class AppTests(unittest.TestCase):
    def setUp(self):
        import app
        self.app = app
        self.api = app.Api.__new__(app.Api)
        self.api.emit = lambda e: None

    def test_trip_goes_on_the_calendar(self):
        added = []
        plan = {"request": {"place": "Tokyo", "days": 2}, "days": [
            {"day": 1, "title": "Shibuya", "stops": [{"time": "09:00", "kind": "spot", "name": "Hachiko"}, {"kind": "food", "name": "Ramen"}]},
            {"day": 2, "stops": []}]}
        with mock.patch.object(self.app.f1, "add_event", side_effect=lambda *a: added.append(a)):
            r = self.api.travel_to_calendar(plan, "2026-11-20")
        self.assertTrue(r["ok"])
        self.assertEqual([(a[0], a[1]) for a in added], [("✈️ Tokyo · Day 1: Shibuya", "2026-11-20"), ("✈️ Tokyo · Day 2", "2026-11-21")])
        self.assertIn("Hachiko", added[0][4])                                 # the day's itinerary is its notes
        self.assertIn("error", self.api.travel_to_calendar(plan, ""))

    def test_previous_unimate_clips(self):
        import animate
        with tempfile.TemporaryDirectory() as d, mock.patch.object(animate, "WORK_DIR", os.path.join(d, "_unimate")), \
                mock.patch.object(self.app, "UI_DIR", d):
            work = os.path.join(d, "_unimate", "hero")
            os.makedirs(work)
            with open(os.path.join(work, "walk.glb"), "wb") as f:
                f.write(b"glTF")
            with open(os.path.join(work, "result.json"), "w") as f:
                json.dump([{"clip": "walk", "path": "X:/an/old/folder/walk.glb"}, {"clip": "idle", "path": "gone.glb"}], f)
            r = self.api.unimate_previous("hero-animated.glb")
        self.assertEqual(r["outputs"], [{"clip": "walk", "url": "_unimate/hero/walk.glb"}])   # found even after the folder moved
        self.assertEqual(r["model"], "hero.glb")


if __name__ == "__main__":
    unittest.main()
