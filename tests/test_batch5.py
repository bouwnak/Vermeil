"""Batch 5: voice (styles, volume, language, tone mood) and music (pause/seek/replay, favorites, moods)."""
import os, sys, json, time, shutil, tempfile, unittest
from types import SimpleNamespace
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import numpy as np  # noqa: E402
import f1, music, voicemood, llm  # noqa: E402
import pinakamain as pm  # noqa: E402


class MusicTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(music, "HISTORY_FILE", os.path.join(self.tmp, "h.json")),
                  mock.patch.object(music, "FAV_FILE", os.path.join(self.tmp, "f.json")),
                  mock.patch.object(f1, "QUEUE_FILE", os.path.join(self.tmp, "q.json"))]
        for p in self.p: p.start()
        self.proc = mock.Mock(pid=123)
        self.proc.poll.return_value = None
        f1.current_process, f1.now_playing, f1.play_started, f1.paused_at, f1.restart_at = self.proc, "Song A", time.time() - 40, None, None
        f1.song_length = 200

    def tearDown(self):
        for p in self.p: p.stop()
        f1.current_process, f1.now_playing, f1.paused_at, f1.restart_at = None, "", None, None
        shutil.rmtree(self.tmp)

    def test_pause_resume_keeps_position(self):
        ps = mock.Mock()
        with mock.patch.dict(sys.modules, {"psutil": mock.Mock(Process=mock.Mock(return_value=ps))}):
            self.assertIn("Paused", music.pause())
            ps.suspend.assert_called_once()
            f1.paused_at -= 30; f1.play_started -= 30            # 30 s pass while paused
            self.assertIn("again", music.resume())
            ps.resume.assert_called_once()
        self.assertAlmostEqual(music.position(), 40, delta=2)   # the paused time doesn't count

    def test_seek_and_replay_restart_the_stream(self):
        self.assertIn("1:10", music.seek("+30"))
        self.assertEqual(f1.restart_at, 70)
        self.proc.kill.assert_called()
        music.seek("1:20"); self.assertEqual(f1.restart_at, 80)
        music.seek("-100"); self.assertEqual(f1.restart_at, 0)
        music.seek("9:99"); self.assertEqual(f1.restart_at, 197)        # not past the end
        self.assertIn("from the start", music.replay())

    def test_favorites_history_moods(self):
        self.assertIn("Added Song A", music.favorite_current())
        music.add_history("Song A", "song a"); music.add_history("Song A", "song a"); music.add_history("Song B", "b")
        self.assertEqual(music.top_songs()[0], "Song A")
        with mock.patch.object(f1, "music_control") as mc:
            self.assertIn("1 favorites", music.play_favorites())
            with mock.patch.object(llm, "ask", return_value={"songs": ["X - One", "Y - Two"]}) as ask:
                self.assertIn("gym playlist", music.play_mood("gym"))
                self.assertIn("Song A", ask.call_args.args[0])       # uses your taste
                self.assertIn("X - One", music.recommend(play=False))
            with mock.patch.object(llm, "ask", return_value={"song": "Lady Gaga - The Edge of Glory", "sure": True}), \
                    mock.patch("web.search", return_value=[]):
                self.assertIn("Edge of Glory", music.find_song("i'm on the edge of glory"))
        self.assertEqual(mc.call_args_list[-1].args, ("play", "Lady Gaga - The Edge of Glory"))

    def test_queue_saved_for_later(self):
        f1._clear_queue()
        f1.music_queue.put("song 1"); f1.music_queue.put("song 2")
        f1._save_queue()
        f1._clear_queue()
        with mock.patch.object(f1, "_ensure_player"):
            self.assertIn("2 songs", f1.resume_saved_queue())
        f1._clear_queue()


class VoiceTests(unittest.TestCase):
    def test_tone_mood_learns_your_normal_voice(self):
        tmp = tempfile.mkdtemp()
        t = np.arange(16000 * 2) / 16000
        normal = (0.1 * np.sin(2 * np.pi * 150 * t)).astype("float32")
        loud_high = (0.5 * np.sin(2 * np.pi * 230 * t)).astype("float32")
        with mock.patch.object(voicemood, "BASE_FILE", os.path.join(tmp, "b.json")):
            f = voicemood.features(normal, "this is how I usually talk ok")
            self.assertAlmostEqual(f["pitch_hz"], 150, delta=8)
            for _ in range(5):
                self.assertIsNone(voicemood.mood(normal, "this is how I usually talk ok") if _ < 5 else None)
            self.assertEqual(voicemood.mood(normal, "this is how I usually talk ok"), "calm")
            self.assertEqual(voicemood.mood(loud_high, "oh my gosh this is amazing wow yes"), "excited")
        shutil.rmtree(tmp)

    def test_style_shift_and_language_voice(self):
        self.assertEqual(pm._shift("+5%", -12, "%"), "-7%")
        self.assertEqual(pm._shift("+0Hz", 25, "Hz"), "+25Hz")
        with mock.patch.object(pm, "heard_language", ("es", time.time())), mock.patch.object(pm, "VOICE", "piper:en_US-amy-medium"), \
                mock.patch.object(pm.tts, "installed_voices", return_value=["en_US-amy-medium", "es_ES-davefx-medium"]):
            self.assertEqual(pm._voice_for_language(), "piper:es_ES-davefx-medium")
        with mock.patch.object(pm, "heard_language", ("en", time.time())):
            self.assertIsNone(pm._voice_for_language())

    def test_notes_include_tone_language_and_style(self):
        with mock.patch.object(pm, "voice_mood", ("tired", time.time())), mock.patch.object(pm, "heard_language", ("ja", time.time())), \
                mock.patch.object(pm, "VOICE_STYLE", "whisper"):
            notes = pm._extra_notes("hi")
        self.assertIn("sounds tired", notes)
        self.assertIn("reply in that language", notes)
        self.assertIn("whispering", notes)
        self.assertIn("no sarcasm", notes)                          # tired voice tones the humor down

    def test_stt_remembers_language(self):
        import stt
        model = mock.Mock()
        model.transcribe.return_value = ([SimpleNamespace(text=" hola amigo")], SimpleNamespace(language="es", language_probability=0.97))
        with mock.patch.object(stt, "load", return_value=model):
            self.assertEqual(stt.transcribe(np.zeros(16000, dtype="float32")), "hola amigo")
        self.assertEqual((stt.last_language, stt.last_language_prob), ("es", 0.97))


class VoiceCommandTests(unittest.TestCase):
    def test_style_and_music_commands(self):
        import app
        api = app.Api.__new__(app.Api)
        api._characters = {"active": "v", "characters": [{"id": "v", "name": "Vermeil"}]}
        api.emit = lambda e: None
        saved = []
        api.save_settings = lambda d: saved.append(d)
        api._settings = {}
        self.assertEqual(api._quick_command("whisper mode"), "Okay… I'll whisper.")
        self.assertEqual(saved[-1], {"voice_style": "whisper"})
        self.assertEqual(api._quick_command("talk normally"), "Back to my normal voice.")
        with mock.patch.object(app.f1, "music_control", return_value="ok") as mc:
            for said, action in (("pause the music", "pause"), ("next song", "skip"), ("play it again", "replay"),
                                 ("add this song to my favorites", "favorite")):
                api._quick_command(said)
                self.assertEqual(mc.call_args.args[0], action, said)


if __name__ == "__main__":
    unittest.main()
