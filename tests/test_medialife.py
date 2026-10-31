"""Music and media extras (skills/medialife.py): synced lyrics from LRCLIB / lyrics.ovh, "more like this" for Vermeil
Music and Spotify, the album cover maker, "what song is this?" and the movie/show watchlist. Web, AI and mic are faked;
plus the app's wiring (mm actions, Spotify like-this, clean-up, recap and gift doors)."""
import os, sys, tempfile, unittest
from datetime import datetime
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
for _name in ("speech_recognition", "sounddevice", "soundfile", "keyboard", "groq", "webview"):
    try:
        __import__(_name)
    except Exception:
        sys.modules[_name] = mock.MagicMock()
import medialife as ml  # noqa: E402

LRC = "[00:12.50] First line\n[00:15.00][01:10.00] Chorus\n[ar: someone]\nno stamp"


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="vermeil-media-")
        p = mock.patch.object(ml, "FILE", os.path.join(self.tmp, "medialife.json"))
        p.start()
        self.addCleanup(p.stop)


class LyricsTests(_Tmp):
    def test_parse_and_line_at(self):
        s = ml.parse_lrc(LRC)
        self.assertEqual([x["t"] for x in s], [12.5, 15.0, 70.0])
        self.assertEqual(s[2]["line"], "Chorus")
        self.assertEqual(ml.line_at(s, 5), -1)
        self.assertEqual(ml.line_at(s, 16), 1)

    def test_clean_titles(self):
        self.assertEqual(ml.clean("Lose Yourself (Official Video) feat. Someone", "Eminem")[0], "Lose Yourself")

    def test_lrclib_then_cached(self):
        calls = []
        def fetch(url, params=None):
            calls.append(url)
            return {"syncedLyrics": LRC, "plainLyrics": "First line\nChorus"}
        r = ml.lyrics("Song", "Artist", 200, fetch=fetch)
        self.assertEqual(len(r["synced"]), 3)
        self.assertIn("lrclib.net/api/get", calls[0])
        ml.lyrics("Song", "Artist", 200, fetch=fetch)
        self.assertEqual(len(calls), 1)                                       # from the cache

    def test_search_fallback_and_other_source(self):
        def fetch(url, params=None):
            return None if url.endswith("/get") else [{"plainLyrics": "words"}, {"syncedLyrics": LRC}]
        self.assertEqual(len(ml.lyrics("Song", "Artist", fetch=fetch)["synced"]), 3)
        r = ml.lyrics("Other", "Band", source="lyricsovh", fetch=lambda u, p=None: {"lyrics": "la la"})
        self.assertEqual((r["plain"], r["synced"]), ("la la", []))
        self.assertIn("error", ml.lyrics("Other", "", source="lyricsovh", fetch=lambda u, p=None: {}))
        self.assertIn("error", ml.lyrics("Nope", "X", fetch=lambda u, p=None: None if u.endswith("/get") else []))
        def boom(u, p=None): raise OSError("offline")
        self.assertIn("didn't answer", ml.lyrics("Song2", "A", fetch=boom)["error"])


class LikeThisTests(_Tmp):
    AI = staticmethod(lambda p: {"songs": [{"title": "A", "artist": "x"}, {"title": "a", "artist": "dup"}, {"title": "Song", "artist": "same"}, {"title": "B"}]})

    def test_youtube_queue(self):
        played = []
        r = ml.like_this_youtube({"title": "Song", "artist": "Me"}, ask=self.AI, find=lambda pairs: [{"title": t} for t, a in pairs],
                                 play=lambda songs: played.append(songs) or "Playing 2 songs.")
        self.assertEqual([s["title"] for s in played[0]], ["A", "B"])          # no repeats, not the song itself
        self.assertIn("Songs like Song", r["message"])
        with self.assertRaises(ValueError):
            ml.like_this_youtube({"title": "Song"}, ask=self.AI, find=lambda pairs: [None])

    def test_spotify(self):
        sp = mock.Mock()
        sp.now_playing.return_value = {"active": True, "track": {"title": "Song", "artist": "Me"}}
        sp.search.side_effect = lambda q, kind, n: {"tracks": [{"uri": f"spotify:track:{q[-1]}", "title": q, "artist": "x"}]}
        r = ml.like_this_spotify(ask=self.AI, sp=sp)
        self.assertEqual(len(sp.play_uris.call_args[0][0]), 2)
        self.assertIn("2 songs", r["message"])
        sp.now_playing.return_value = {"active": False}
        with self.assertRaises(ValueError):
            ml.like_this_spotify(ask=self.AI, sp=sp)


class CoverTests(_Tmp):
    def test_cover_saved_on_playlist(self):
        from PIL import Image
        saved = {}
        pl = {"id": "p1", "name": "Gym Hype", "songs": [{"title": "Power", "artist": "Kanye"}]}
        with mock.patch("mymusic.get_playlist", return_value=pl):
            ml.make_cover("p1", "neon", ask=lambda p: {"prompt": "a gym at night"}, paint=lambda pr: saved.setdefault("prompt", pr) and Image.new("RGB", (64, 64)),
                          save=lambda pid, n, d, cover: saved.update(pid=pid, cover=cover) or {"id": pid})
        self.assertIn("neon city", saved["prompt"])
        self.assertTrue(saved["cover"].startswith("data:image/jpeg;base64,"))
        with mock.patch("mymusic.get_playlist", return_value=pl), self.assertRaises(ValueError):
            ml.make_cover("liked", paint=lambda pr: Image.new("RGB", (8, 8)))


class SongIdTests(_Tmp):
    def test_identify_and_heard(self):
        shazam = lambda wav: {"track": {"title": "Blinding Lights", "subtitle": "The Weeknd", "images": {"coverart": "c.jpg"}}}
        r = ml.identify(rec=lambda s: b"wav", recognize=shazam, now=datetime(2026, 10, 31, 20, 0))
        self.assertEqual((r["title"], r["artist"], r["cover"]), ("Blinding Lights", "The Weeknd", "c.jpg"))
        ml.identify(rec=lambda s: b"wav", recognize=shazam)
        self.assertEqual(len(ml.heard()), 1)                                  # the same song once
        self.assertIn("couldn't tell", ml.identify(rec=lambda s: b"", recognize=lambda w: {})["error"])
        def no_pkg(w): raise RuntimeError("python -m pip install shazamio")
        self.assertIn("pip install shazamio", ml.identify(rec=lambda s: b"", recognize=no_pkg)["error"])
        def no_mic(s): raise OSError("no device")
        self.assertIn("microphone", ml.identify(rec=no_mic)["error"])


class WatchlistTests(_Tmp):
    AI = staticmethod(lambda p: {"year": "2001", "genres": ["Animation"], "where": ["Netflix"], "about": "Spirits."})

    def test_add_where_watch_rate_remove(self):
        with mock.patch.object(ml, "_country", return_value="the Philippines"):
            w = ml.watch_add("Spirited Away", "movie", ask=self.AI)
            it = w["items"][0]
            self.assertEqual((it["year"], it["where"], it["country"]), ("2001", ["Netflix"], "the Philippines"))
            with self.assertRaises(ValueError):
                ml.watch_add("spirited away", ask=self.AI)
            ml.watch_where(it["id"], ask=lambda p: {"where": ["Max"]})
        self.assertEqual(ml.watch_list()["items"][0]["where"], ["Max"])
        it = ml.watch_toggle(it["id"], 5)["items"][0]
        self.assertTrue(it["watched"])
        self.assertEqual(it["rating"], 5)
        self.assertEqual(ml.watch_remove(it["id"])["items"], [])
        with self.assertRaises(KeyError):
            ml.watch_remove("nope")

    def test_add_works_without_ai(self):
        def boom(p): raise RuntimeError("offline")
        with mock.patch.object(ml, "_country", return_value="the United States"):
            it = ml.watch_add("Arcane", "show", ask=boom)["items"][0]
        self.assertEqual((it["kind"], it["where"]), ("show", []))

    def test_suggest_skips_what_you_have(self):
        with mock.patch.object(ml, "_country", return_value="the United States"):
            ml.watch_add("Your Name", ask=self.AI)
            ml.watch_toggle(ml.watch_list()["items"][0]["id"], 5)
            seen = []
            r = ml.watch_suggest(["Romance"], "movie", ask=lambda p: seen.append(p) or {"picks": [{"title": "Your Name"}, {"title": "Weathering With You", "where": ["Netflix"]}]})
        self.assertEqual([p["title"] for p in r["picks"]], ["Weathering With You"])
        self.assertIn("Romance", seen[0])
        self.assertIn("Your Name", seen[0])                                   # liked titles steer the picks


class AppWiringTests(unittest.TestCase):
    def setUp(self):
        import app
        self.api = app.Api.__new__(app.Api)
        self.events = []
        self.api.emit = self.events.append

    def test_music_doors_and_errors(self):
        with mock.patch.object(ml, "watch_add", side_effect=ValueError("Type a title.")):
            self.assertEqual(self.api.mm("watch_add", ""), {"error": "Type a title."})
        self.assertIn("lrclib", self.api.mm("lyrics_sources"))
        with mock.patch.object(ml, "identify", return_value={"title": "x"}) as idf:
            self.api.mm("listen", 99)
        idf.assert_called_with(15)                                            # never listens for long

    def test_other_doors_exist(self):
        for name in ("spotify_like_this", "cleanup_scan", "cleanup_trash", "recap_year", "gifts", "gift_open", "_gift_check"):
            self.assertTrue(callable(getattr(self.api, name)), name)


if __name__ == "__main__":
    unittest.main()
