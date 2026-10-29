"""Flexible wording, no emojis, character languages + online voices, hearing language-practice text."""
import os, sys, unittest
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

import intent, sensei, tts, spotify  # noqa: E402
import pinakamain as pm  # noqa: E402
import app  # noqa: E402


class WordingTests(unittest.TestCase):
    CASES = {
        "can you put on a song": "play music", "Can you play a music?": "play music", "hey vermi can you blast some tunes": "play music",
        "can you make a note right now": "add note", "could you jot this down: buy eggs pls": "add note: buy eggs",
        "crank it up": "volume up", "turn it down a bit": "volume down a bit", "skip this one please": "skip", "next song": "skip",
        "what's on my plate tomorrow": "agenda tomorrow", "don't let me forget to call mom at 5": "remind me to call mom at 5",
        "add milk to my grocery list": "add to shopping list milk", "can you dance": "dance", "be quiet": "stop speaking",
        "can you look up toothless age": "search toothless age", "i want you to put on taylor swift": "play taylor swift",
        "can you play honey im good by andy grammer": "play honey im good by andy grammer",
    }

    def test_normalize(self):
        for said, plain in self.CASES.items():
            self.assertEqual(intent.normalize(said), plain, said)

    def test_instant_commands_accept_any_wording(self):
        api = app.Api.__new__(app.Api)
        api._characters = {"active": "v", "characters": [{"id": "v", "name": "Vermeil"}]}
        api.emit = lambda e: None
        api._settings = {"music_source": "youtube"}
        with mock.patch.object(app.f1, "manage_notes", side_effect=lambda a, n: f"note:{n}") as notes, \
                mock.patch.object(app.f1, "music_control", side_effect=lambda a, *x: f"music:{a}"), \
                mock.patch.object(api, "_play_something", return_value="playing something you like"), \
                mock.patch.object(api, "_set_volume", side_effect=lambda p=None, c=0: f"vol:{p}:{c}"):
            self.assertEqual(api._quick_command("can you put on a song"), "playing something you like")
            self.assertEqual(api._quick_command("could you jot this down: Buy eggs at SM pls"), "note:Buy eggs at SM")
            self.assertEqual(api._quick_command("crank it up"), "vol:None:15")
            self.assertEqual(api._quick_command("skip this one please"), "music:skip")
            self.assertIsNone(api._quick_command("can you make a note right now"))          # the AI asks what to write
        notes.assert_called_once()

    def test_tool_picking_understands_casual_words(self):
        import tools
        names = lambda q: [t["function"]["name"] for t in tools.pick(f"{q} {intent.normalize(q)}")]
        self.assertIn("add_shopping_items", names("add milk to my grocery list"))
        self.assertIn("play_mood_playlist", names("blast some tunes"))


class EmojiTests(unittest.TestCase):
    def test_emojis_go_other_languages_stay(self):
        self.assertEqual(pm.clean_text("Hehe~ Noot! 🎶 Enjoy! 🚀"), "Noot! Enjoy!")
        self.assertEqual(pm.clean_text("こんにちは！😊 안녕하세요 ✅"), "こんにちは！ 안녕하세요")
        self.assertEqual(pm.clean_text("Day 1 → Day 2"), "Day 1 → Day 2")


class LanguageTests(unittest.TestCase):
    def test_speakable_parts_only(self):
        ja = "こんにちは！はじめまして。\nKonnichiwa! Hajimemashite. (Hello! Nice to meet you.)\nレストランで何を注文したいですか？"
        self.assertEqual(sensei.speakable(ja, "ja"), "こんにちは！はじめまして。 レストランで何を注文したいですか？")
        self.assertEqual(sensei.speakable("**Hola** (Hello) - this is how you greet someone.\n¿Cómo estás? (How are you?)", "es"), "Hola ¿Cómo estás?")
        self.assertEqual(sensei.speakable("This lesson is about greetings.", "fr"), "")

    def test_online_voices_for_languages_piper_lacks(self):
        with mock.patch.object(tts, "installed_voices", return_value=[]), mock.patch.object(tts, "catalog", return_value={}):
            voices = tts.list_voices()
        ja = [v for v in voices if v["locale"] == "ja-JP"]
        self.assertTrue(ja and all(v["online"] for v in ja))
        with mock.patch.object(tts, "edge_available", return_value=True):
            self.assertEqual(tts.resolve_voice("ja-JP-NanamiNeural"), "ja-JP-NanamiNeural")
            self.assertEqual(tts.to_local_voice("ko-KR-SunHiNeural"), "ko-KR-SunHiNeural")     # kept at start-up
        with mock.patch.object(tts, "edge_available", return_value=False), mock.patch.object(tts, "installed_voices", return_value=[]), \
                mock.patch.object(tts, "catalog", return_value={}):
            self.assertTrue(tts.resolve_voice("ja-JP-NanamiNeural").startswith("piper:"))      # falls back offline

    def test_character_speaks_its_language(self):
        old = dict(pm.persona)
        try:
            pm.persona.update(language="ja", translate=True)
            with mock.patch("mind.recall_note", return_value=""), mock.patch("relationship.note", return_value=""):
                notes = pm._extra_notes("hello")
            self.assertIn("ALWAYS reply in natural, simple Japanese", notes)
            self.assertIn("square brackets", notes)
            said = []
            with mock.patch.object(pm, "tts_ready", True), mock.patch.object(tts._pool, "submit", side_effect=lambda fn, t, *a: said.append(t)):
                ss = pm.SpeechStream(voice="ja-JP-NanamiNeural")
                ss._push("こんにちは！元気ですか？ [Hello! How are you?]")
                ss.finish()                                   # let the player thread end (it holds the speaking lock)
            self.assertEqual(said, ["こんにちは！元気ですか？"])
        finally:
            pm.persona.clear(); pm.persona.update(old)

    def test_hear_it_picks_a_voice(self):
        api = app.Api.__new__(app.Api)
        api.emit = lambda e: None
        spoken = []
        with mock.patch.object(tts, "installed_voices", return_value=[]), mock.patch.object(tts, "catalog", return_value={}), \
                mock.patch.object(tts, "edge_available", return_value=True), mock.patch.object(app.threading, "Thread") as T, \
                mock.patch.object(pm, "speak", side_effect=lambda t, v, *a: spoken.append((t, v))):
            T.return_value.start = lambda: T.call_args.kwargs["target"]()
            r = api.sensei_say("こんにちは (Hello)", "ja")
        self.assertEqual(r["said"], "こんにちは")
        self.assertEqual(spoken[0][1], "ja-JP-NanamiNeural")
        with mock.patch.object(tts, "installed_voices", return_value=[]), mock.patch.object(tts, "catalog", return_value={}), \
                mock.patch.object(tts, "edge_available", return_value=False):
            self.assertIn("edge-tts", api.sensei_say("こんにちは", "ja")["error"])

    def test_preview_in_the_voices_language(self):
        api = app.Api.__new__(app.Api)
        with mock.patch.object(app.threading, "Thread") as T, mock.patch.object(pm, "speak") as speak, \
                mock.patch.object(tts, "edge_available", return_value=True):
            T.return_value.start = lambda: T.call_args.kwargs["target"]()
            api.preview_voice("ja-JP-NanamiNeural", name="Vermeil")
        self.assertIn("こんにちは、Vermeilです", speak.call_args.args[0])


if __name__ == "__main__":
    unittest.main()


class EndearmentAndJapaneseSpeechTests(unittest.TestCase):
    def test_no_pet_names(self):
        import pinakamain as pm
        self.assertEqual(pm.clean_endearments("Yes, darling?"), "Yes?")
        self.assertEqual(pm.clean_endearments("Good morning, my love! Ready?"), "Good morning! Ready?")
        self.assertEqual(pm.clean_endearments("I love pizza."), "I love pizza.")

    def test_japanese_english_not_spoken(self):
        import pinakamain as pm
        from unittest import mock
        old = dict(pm.persona); pm.persona.update({"language": "ja", "translate": True})
        try:
            ss = pm.SpeechStream(); said = []
            with mock.patch.object(pm, "tts_ready", True), mock.patch.object(ss, "_start"), \
                    mock.patch.object(pm.tts._pool, "submit", side_effect=lambda f, s, *a: said.append(s)):
                ss._push("こんにちは！[Hello!"); ss._push("How are you?]"); ss._push("元気ですか？")
            self.assertEqual(said, ["こんにちは！", "元気ですか？"])
        finally:
            pm.persona.clear(); pm.persona.update(old)
