"""Spotify: keys in the env file, login, token refresh, playing/searching, no-device recovery, routing from voice/AI."""
import os, sys, json, time, shutil, socket, tempfile, threading, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import spotify, f1, tools  # noqa: E402

ID, SECRET = "a" * 32, "b" * 32


class Resp:
    def __init__(self, status=200, js=None, headers=None):
        self.status_code, self._js, self.headers = status, js, headers or {}
        self.content = b"" if js is None else json.dumps(js).encode()
        self.text = self.content.decode()

    def json(self):
        if self._js is None:
            raise ValueError
        return self._js


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(spotify, "BASE_DIR", self.tmp), mock.patch.object(spotify, "TOKEN_FILE", os.path.join(self.tmp, "tok.json")),
                  mock.patch.dict(os.environ, {"SPOTIFY_CLIENT_ID": ID, "SPOTIFY_CLIENT_SECRET": SECRET, "SPOTIFY_REDIRECT_URI": ""})]
        for p in self.p: p.start()
        spotify._playlist_cache.update({"at": 0.0, "items": []})      # nothing left over from another test

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.tmp)
        spotify._playlist_cache.update({"at": 0.0, "items": []})

    def login(self, expires_in=3600):
        spotify._save_token({"access_token": "A1", "refresh_token": "R1", "expires_at": time.time() + expires_in})


class KeysAndLoginTests(Base):
    def test_keys_go_into_the_env_file(self):
        with open(os.path.join(self.tmp, "env"), "w") as f:
            f.write("GROQ_API_KEY=keep-me\nSPOTIFY_CLIENT_ID=old\n")
        path = spotify.save_credentials("C" * 32, "D" * 32)
        with open(path) as f:
            text = f.read()
        self.assertIn("GROQ_API_KEY=keep-me", text)                     # other keys untouched
        self.assertIn("SPOTIFY_CLIENT_ID=" + "C" * 32, text)
        self.assertNotIn("=old", text)
        self.assertIn("SPOTIFY_CLIENT_SECRET=" + "D" * 32, text)
        with self.assertRaises(ValueError):
            spotify.save_credentials("not-an-id", "")

    def test_status_never_reveals_the_secret(self):
        st = spotify.status()
        self.assertEqual(st["redirect_uri"], "http://127.0.0.1:8888/callback")
        self.assertNotIn(SECRET, json.dumps(st))
        self.assertFalse(st["connected"])

    def test_browser_login_round_trip(self):
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
        os.environ["SPOTIFY_REDIRECT_URI"] = f"http://127.0.0.1:{port}/callback"
        done = threading.Event()
        res = {}
        with mock.patch.object(spotify, "finish_login", side_effect=lambda code: res.setdefault("code", code)):
            url = spotify.login(open_browser=False, timeout=10, on_done=lambda r: (res.update(r), done.set()))
            state = url.split("state=")[1].split("&")[0]
            import urllib.request
            time.sleep(0.2)
            page = urllib.request.urlopen(f"http://127.0.0.1:{port}/callback?code=XYZ&state={state}", timeout=5).read().decode()
            done.wait(5)
        self.assertEqual(res.get("code"), "XYZ")
        self.assertTrue(res.get("ok"))
        self.assertIn("connected", page)
        self.assertIn("redirect_uri=http%3A%2F%2F127.0.0.1", url)

    def test_expired_token_is_refreshed(self):
        self.login(expires_in=-10)
        with mock.patch.object(spotify.requests, "post", return_value=Resp(js={"access_token": "A2", "expires_in": 3600})) as post:
            self.assertEqual(spotify.access_token(), "A2")
        self.assertEqual(post.call_args.kwargs["data"]["refresh_token"], "R1")
        self.assertEqual(spotify._token()["refresh_token"], "R1")       # kept when Spotify doesn't send a new one


class PlayerTests(Base):
    def setUp(self):
        super().setUp()
        self.login()
        self.calls = []

    def fake(self, routes):
        def request(method, url, params=None, json=None, **kw):
            path = url.replace(spotify.API, "")
            self.calls.append((method, path, params, json))
            for (m, p), r in routes.items():
                if m == method and path.startswith(p):
                    return r(params, json) if callable(r) else r
            return Resp(204)
        return mock.patch.object(spotify.requests, "request", side_effect=request)

    def test_play_finds_and_plays_a_song(self):
        track = {"name": "Sunrise", "artists": [{"name": "Rex Orange County"}], "uri": "spotify:track:sun", "album": {"name": "Pony", "images": []}}
        with self.fake({("GET", "/search"): Resp(js={"tracks": {"items": [track]}})}):
            self.assertEqual(spotify.play("sunrise rex orange county"), "Playing Sunrise by Rex Orange County on Spotify.")
        search = next(c for c in self.calls if c[1] == "/search")
        self.assertLessEqual(search[2]["limit"], 10)                     # Spotify's 2026 limit
        self.assertIn(("PUT", "/me/player/play", None, {"uris": ["spotify:track:sun"]}), self.calls)

    def test_no_device_opens_one_then_retries(self):
        tries = {"n": 0}

        def play(params, body):
            tries["n"] += 1
            return Resp(404, {"error": {"status": 404, "reason": "NO_ACTIVE_DEVICE", "message": "No active device"}}) if tries["n"] == 1 else Resp(204)
        with self.fake({("PUT", "/me/player/play"): play,
                        ("GET", "/me/player/devices"): Resp(js={"devices": [{"id": "pc1", "type": "Computer", "name": "JP-PC", "is_active": False}]})}), \
                mock.patch.object(spotify.time, "sleep"):
            spotify.resume()
        self.assertIn(("PUT", "/me/player", None, {"device_ids": ["pc1"], "play": False}), self.calls)
        self.assertEqual(tries["n"], 2)

    def test_friendly_errors_and_new_library_endpoint(self):
        with self.fake({("PUT", "/me/player/pause"): Resp(403, {"error": {"status": 403, "message": "Player command failed: Premium required", "reason": "PREMIUM_REQUIRED"}})}):
            self.assertIn("Premium", spotify.control("pause"))
        now = {"is_playing": True, "progress_ms": 5000, "item": {"name": "Feel It Still", "artists": [{"name": "Portugal. The Man"}], "uri": "spotify:track:fis", "duration_ms": 160000, "album": {"name": "W", "images": [{"url": "big"}, {"url": "small"}]}},
               "device": {"name": "JP-PC", "volume_percent": 60}}
        with self.fake({("GET", "/me/player"): Resp(js=now)}):
            self.assertIn("Saved Feel It Still", spotify.like_current())
            self.assertEqual(spotify.now_playing()["track"]["image"], "big")
        self.assertIn(("PUT", "/me/library", None, {"uris": ["spotify:track:fis"]}), self.calls)

    def test_playlist_by_name(self):
        lists = {"items": [{"name": "Gym Hype", "uri": "spotify:playlist:g", "id": "g", "owner": {"display_name": "JP"}, "items": {"total": 40}, "images": []}]}
        with self.fake({("GET", "/me/playlists"): Resp(js=lists)}):
            self.assertEqual(spotify.play_playlist("gym"), "Playing your playlist Gym Hype.")
            self.assertEqual(spotify.playlists()[0]["count"], 40)
        self.assertIn(("PUT", "/me/player/play", None, {"context_uri": "spotify:playlist:g"}), self.calls)


class RoutingTests(unittest.TestCase):
    def tearDown(self):
        f1.external_player, f1.use_external, f1.is_playing = None, (lambda: False), False

    def test_voice_and_ai_music_go_to_spotify(self):
        sp = mock.Mock(return_value="Playing on Spotify.")
        f1.external_player, f1.use_external = sp, (lambda: True)
        self.assertEqual(tools.run_tool("play_music", '{"song": "Sunrise"}'), "Playing on Spotify.")
        self.assertEqual(sp.call_args.args, ("play", "Sunrise", "now"))
        f1.music_control("skip")
        self.assertEqual(sp.call_args.args[0], "skip")
        f1.is_playing = True                                            # a YouTube song is playing: stop that one
        with mock.patch.object(f1, "_stop_current_song", return_value=True):
            self.assertIn("Skipped", f1.music_control("skip"))
        self.assertEqual(sp.call_count, 2)

    def test_spotify_tool(self):
        with mock.patch.object(spotify, "play_playlist", return_value="Playing your playlist Gym Hype.") as pp:
            self.assertIn("Gym Hype", tools.run_tool("spotify", '{"action": "play_playlist", "name": "gym"}'))
        pp.assert_called_once_with("gym")
        self.assertIn("spotify", [t["function"]["name"] for t in tools.pick("play my gym playlist on spotify")])


if __name__ == "__main__":
    unittest.main()


class PlaylistAndVolumeCommandTests(unittest.TestCase):
    LISTS = [{"name": n, "uri": "u:" + n, "id": n, "owner": "J", "count": 1, "image": ""}
             for n in ["Be LIMITLESS", "Sing To Heal", "Love that's bright", "MIXPL", "Geym", "spm", "Gym"]]

    def setUp(self):
        for _name in ("speech_recognition", "sounddevice", "soundfile", "keyboard", "groq", "webview"):
            try:
                __import__(_name)
            except Exception:
                sys.modules[_name] = mock.MagicMock()
        import app
        self.app = app
        self.api = app.Api.__new__(app.Api)
        self.api._characters = {"active": "v", "characters": [{"id": "v", "name": "Vermeil"}]}
        self.api.emit = lambda e: None
        self.api._settings = {"music_source": "auto"}
        self.p = [mock.patch.object(spotify, "status", return_value={"connected": True}),
                  mock.patch.object(spotify, "playlists", return_value=self.LISTS)]
        for p in self.p: p.start()

    def tearDown(self):
        for p in self.p: p.stop()

    def test_find_playlist_fuzzy(self):
        self.assertEqual(spotify.find_playlist("my gym playlist", self.LISTS)["name"], "Gym")
        self.assertEqual(spotify.find_playlist("geym", self.LISTS)["name"], "Geym")
        self.assertEqual(spotify.find_playlist("limitless", self.LISTS)["name"], "Be LIMITLESS")
        self.assertEqual(spotify.find_playlist("sing to heel", self.LISTS)["name"], "Sing To Heal")
        self.assertIsNone(spotify.find_playlist("jazz classics", self.LISTS))

    def test_spoken_requests_play_your_playlists(self):
        with mock.patch.object(spotify, "play_uri") as pu:
            for said, uri in (("can you play my gym playlist", "u:Gym"), ("can you play the geym playlist", "u:Geym"),
                              ("pls play playlist mixpl", "u:MIXPL")):
                self.assertIn("Playing your playlist", self.api._quick_command(said))
                self.assertEqual(pu.call_args.args[0], uri, said)
            self.assertIn("Playing your playlist", self.api._quick_command("can you play any playlist"))
            self.assertIn("Playing your playlist Gym", spotify.play("gym playlist"))     # AI path too
        self.assertIsNone(self.api._quick_command("play honey im good by andy grammer"))  # a song -> the AI / search

    def test_volume(self):
        with mock.patch.object(spotify, "now_playing", return_value={"active": True, "playing": True, "volume": 70}), \
                mock.patch.object(spotify, "set_volume", side_effect=lambda p: f"Spotify volume {p}%.") as sv:
            self.assertEqual(self.api._quick_command("can you adjut th volume to 50"), "Spotify volume 50%.")
            self.assertEqual(self.api._quick_command("turn it up"), "Spotify volume 85%.")
            self.assertEqual(self.api._quick_command("volume down please"), "Spotify volume 55%.")
        with mock.patch.object(spotify, "now_playing", return_value={"active": False}), \
                mock.patch.object(self.app.f1, "set_volume", return_value="Volume set to 30%.") as pcv:
            self.assertEqual(self.api._quick_command("set the volume to 30%"), "Volume set to 30%.")   # PC volume when Spotify is idle
        pcv.assert_called_once_with(30)
        self.assertIn("set_volume", [t["function"]["name"] for t in tools.pick("can you adjut th volume to 50")])
