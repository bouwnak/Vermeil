"""Batch 8: streaming speech, noise filter, trained wake word, voices for more languages."""
import os, sys, json, shutil, tempfile, unittest
from types import SimpleNamespace
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
for _name in ("speech_recognition", "sounddevice", "soundfile", "keyboard", "groq", "webview"):
    try:
        __import__(_name)
    except Exception:
        sys.modules[_name] = mock.MagicMock()

import numpy as np  # noqa: E402
import llm, tts, denoise, wakeword  # noqa: E402
import pinakamain as pm  # noqa: E402

SR = 16000


class FakeResp:
    def __init__(self, lines, status=200):
        self.lines, self.status_code, self.ok, self.text, self.headers = lines, status, status < 400, "", {}

    def iter_lines(self):
        return iter(self.lines)


class StreamingTests(unittest.TestCase):
    def test_think_filter_across_pieces(self):
        got = []
        f = llm._ThinkFilter(got.append)
        for p in ["Hel", "lo <thi", "nk>secret plan</th", "ink> world", "! <"]:
            f.feed(p)
        f.flush()
        self.assertEqual("".join(got), "Hello world! <")

    def test_groq_stream_text_and_tool_calls(self):
        ev = lambda d: ("data: " + json.dumps(d)).encode()
        lines = [ev({"model": "m", "choices": [{"delta": {"content": "Let me "}}]}),
                 ev({"choices": [{"delta": {"content": "check."}}]}),
                 ev({"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c9", "function": {"name": "get_weather", "arguments": '{"ci'}}]}}]}),
                 ev({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": 'ty": "Manila"}'}}]}, "finish_reason": "tool_calls"}]}),
                 b"data: [DONE]"]
        heard = []
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": "k"}), \
                mock.patch.object(llm.requests, "post", return_value=FakeResp(lines)) as post:
            r = llm._groq_create(model="chat", messages=[{"role": "user", "content": "hi"}], on_text=heard.append)
        self.assertTrue(post.call_args.kwargs["json"]["stream"])
        self.assertEqual("".join(heard), "Let me check.")
        c = r.choices[0].message.tool_calls[0]
        self.assertEqual((c.id, c.function.name, json.loads(c.function.arguments)), ("c9", "get_weather", {"city": "Manila"}))

    def test_ollama_stream(self):
        lines = [json.dumps({"message": {"content": "Hi "}}).encode(), json.dumps({"message": {"content": "there."}}).encode(),
                 json.dumps({"message": {"content": ""}, "done": True, "done_reason": "stop", "model": "q"}).encode()]
        heard = []
        with mock.patch.object(llm.requests, "post", return_value=FakeResp(lines)), mock.patch.object(llm, "resolve", return_value="q"):
            r = llm._ollama_create(model="chat", messages=[{"role": "user", "content": "hi"}], on_text=heard.append)
        self.assertEqual("".join(heard), "Hi there.")
        self.assertEqual(r.choices[0].message.content, "Hi there.")

    def test_speech_stream_speaks_sentences_as_they_arrive(self):
        said = []
        fake_pool = SimpleNamespace(submit=lambda fn, text, *a: (said.append(text), SimpleNamespace(result=lambda timeout=None: (np.zeros(80, np.float32), SR)))[1])
        with mock.patch.object(pm, "tts_ready", True), mock.patch.object(tts, "_pool", fake_pool), \
                mock.patch.object(pm, "barge_in", False), mock.patch.object(pm, "emit"), \
                mock.patch.object(pm, "WHOLE_REPLY", False):        # sentence by sentence (not the default)
            ss = pm.SpeechStream(voice="piper:x")
            for piece in ["Good morning, darling! ", "Today you have ", "two classes and gym. Don't for", "get water."]:
                ss.feed(piece)
            self.assertEqual(said, ["Good morning!", "Today you have two classes and gym."])   # before the end
            ss.finish("ignored because text was streamed")
        self.assertEqual(said[-1], "Don't forget water.")
        said.clear()
        with mock.patch.object(pm, "tts_ready", True), mock.patch.object(tts, "_pool", fake_pool), mock.patch.object(pm, "emit"):
            pm.SpeechStream(voice="piper:x").finish("A quick command reply that was not streamed at all.")
        self.assertEqual(said, ["A quick command reply that was not streamed at all."])

    def test_speech_stream_cuts_long_sentences_at_commas(self):
        ss = pm.SpeechStream(voice="piper:x")
        text = "Oh, that's a great question about penguins, but we're amazing swimmers"
        self.assertEqual(text[:ss._cut(text)], "Oh, that's a great question about penguins, ")   # early: a short clause is enough
        self.assertIsNone(ss._cut("Good morning, darling"))                                 # too short to cut
        ss.pushed = ss.EARLY                                                                 # later: only long clauses
        self.assertIsNone(ss._cut("I flap them up and down, wiggle my tail"))
        self.assertEqual(ss._cut("A full sentence ends here. And more"), len("A full sentence ends here. "))

    def test_reply_streams_with_word_limit(self):
        def create(**kw):
            for w in ("word " * 80).split(" "):
                kw["on_text"](w + " ")
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="word " * 80, tool_calls=None))])
        fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
        out = []
        tmp = tempfile.mkdtemp()
        try:
            with mock.patch.object(pm, "get_client", return_value=fake), mock.patch.object(pm, "style", "assistant"), \
                    mock.patch.object(pm, "MEMORY_FILE", os.path.join(tmp, "m.json")), mock.patch.object(pm, "_extra_notes", return_value=""), \
                    mock.patch("relationship.touch", return_value=None):
                reply = pm.get_vermeil_response("user", "talk a lot", {}, on_text=out.append)
        finally:
            shutil.rmtree(tmp)
        self.assertLessEqual(len("".join(out).split()), 51)          # spoken part respects the 50-word limit
        self.assertLessEqual(len(reply.split()), 51)


class NoiseTests(unittest.TestCase):
    def test_hum_is_reduced_voice_kept(self):
        t = np.arange(SR * 2) / SR
        voice = np.where((t > 0.6) & (t < 1.4), 0.4 * np.sin(2 * np.pi * 220 * t) * np.sin(2 * np.pi * 3 * t) ** 2, 0)
        rng = np.random.default_rng(1)
        noise = 0.05 * rng.standard_normal(t.size)
        clean = denoise.reduce_noise((voice + noise).astype(np.float32))
        self.assertEqual(clean.size, t.size)
        quiet = slice(0, int(0.5 * SR))
        self.assertLess(np.sqrt(np.mean(clean[quiet] ** 2)), 0.5 * np.sqrt(np.mean(noise[quiet] ** 2)))   # noise much lower
        loud = slice(int(0.9 * SR), int(1.1 * SR))
        self.assertGreater(np.corrcoef(clean[loud], voice[loud])[0, 1], 0.9)                               # voice intact


def word(kind, speed=1.0, seed=0):
    """A fake spoken word: a pitch sweep with 'vowels', so different words really sound different."""
    n = int(0.6 * SR / speed)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    if kind == "vermi":
        f = 300 + 900 * (t * speed / 0.6)                        # rising
        sig = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.5 * np.sin(2 * np.pi * 2.5 * np.cumsum(f) / SR)
    else:
        f = 1400 - 1000 * (t * speed / 0.6)                      # falling, different colour
        sig = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * 0.6
    sig = 0.3 * sig * np.hanning(n) + 0.004 * rng.standard_normal(n)
    pad = np.zeros(int(0.3 * SR))
    return np.concatenate([pad, sig, pad]).astype(np.float32)


class WakeWordTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = mock.patch.object(wakeword, "FILE", os.path.join(self.tmp, "w.json"))
        self.p.start()

    def tearDown(self):
        self.p.stop()
        shutil.rmtree(self.tmp)

    def test_learns_your_word(self):
        self.assertFalse(wakeword.trained())
        r = wakeword.train([word("vermi", s, i) for i, s in enumerate((0.92, 1.0, 1.08, 1.0))])
        self.assertEqual(r["samples"], 4)
        self.assertTrue(wakeword.trained())
        self.assertTrue(wakeword.matches(word("vermi", 0.96, 9)))            # said a bit slower, still you
        self.assertFalse(wakeword.matches(word("other", 1.0, 5)))            # a different word
        self.assertFalse(wakeword.matches(np.zeros(SR, np.float32)))         # silence
        wakeword.clear()
        self.assertFalse(wakeword.trained())

    def test_needs_three_clear_samples(self):
        with self.assertRaises(ValueError):
            wakeword.train([word("vermi"), np.zeros(SR, np.float32)])


class LanguageVoiceTests(unittest.TestCase):
    def test_picks_installed_then_online(self):
        with mock.patch.object(tts, "installed_voices", return_value=["es_ES-davefx-medium"]), \
                mock.patch.object(tts, "catalog", return_value={"es_ES-davefx-medium": {}}):
            self.assertEqual(tts.voice_for_language("es"), "piper:es_ES-davefx-medium")
        sub = mock.Mock()
        with mock.patch.object(tts, "installed_voices", return_value=[]), mock.patch.object(tts, "catalog", return_value={}), \
                mock.patch.object(tts, "edge_available", return_value=True), mock.patch.object(tts._pool, "submit", sub):
            self.assertEqual(tts.voice_for_language("ja"), "ja-JP-NanamiNeural")
            self.assertEqual(tts.voice_for_language("tl"), "fil-PH-BlessicaNeural")
        with mock.patch.object(tts, "installed_voices", return_value=[]), mock.patch.object(tts, "catalog", return_value={"de_DE-thorsten-medium": {}}), \
                mock.patch.object(tts, "edge_available", return_value=False), mock.patch.object(tts._pool, "submit", sub):
            self.assertIsNone(tts.voice_for_language("de"))                  # downloads it for next time
        self.assertEqual(sub.call_args.args[1], "de_DE-thorsten-medium")


if __name__ == "__main__":
    unittest.main()
