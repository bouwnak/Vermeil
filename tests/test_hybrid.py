"""Groq first, Ollama when Groq's tokens run out (the automatic switch in llm.py)."""
import os, sys, json, time, tempfile, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import llm  # noqa: E402


class R:
    def __init__(self, status, data, headers=None):
        self.status_code, self._d, self.headers = status, data, headers or {}
        self.ok, self.text = status < 400, json.dumps(data)

    def json(self):
        return self._d


GROQ_OK = R(200, {"model": "openai/gpt-oss-20b", "choices": [{"message": {"content": "from groq", "tool_calls": [
    {"id": "c1", "type": "function", "function": {"name": "get_tasks", "arguments": "{}"}}]}, "finish_reason": "tool_calls"}]})
GROQ_LIMIT = R(429, {"error": {"message": "Rate limit reached for model `openai/gpt-oss-120b` ... tokens per day (TPD): "
                                          "Limit 200000, Used 199805, Requested 2084. Please try again in 13m36.048s."}})
OLLAMA_OK = R(200, {"message": {"content": "from ollama"}})


class HybridTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = [mock.patch.object(llm, "MODELS_FILE", os.path.join(self.tmp, "m.json")),
                  mock.patch.dict(os.environ, {"GROQ_API_KEY": "test-key"}, clear=False)]
        for p in self.p: p.start()
        os.environ.pop("AI_PROVIDER", None)
        llm._state.update(groq_blocked_until=0.0, last="", reason="", bad_key=False)
        self.switches = []
        llm.on_switch = self.switches.append

    def tearDown(self):
        for p in self.p: p.stop()
        llm.on_switch = None

    def post(self, *responses):
        return mock.patch.object(llm.requests, "post", side_effect=list(responses))

    def ask(self):
        return llm.get_client().chat.completions.create(model="chat", messages=[{"role": "user", "content": "hi"}],
                                                        tools=[{"type": "function", "function": {"name": "get_tasks"}}])

    def test_groq_is_used_first(self):
        with self.post(GROQ_OK) as p:
            r = self.ask()
        self.assertEqual(r.choices[0].message.content, "from groq")
        self.assertEqual(r.choices[0].message.tool_calls[0].function.name, "get_tasks")
        url, kw = p.call_args.args[0], p.call_args.kwargs
        self.assertEqual(url, llm.GROQ_URL)
        self.assertEqual(kw["json"]["model"], "openai/gpt-oss-20b")
        self.assertEqual(kw["headers"]["Authorization"], "Bearer test-key")

    def test_tokens_out_switches_to_ollama_and_waits(self):
        with self.post(GROQ_OK):
            self.ask()
        with self.post(GROQ_LIMIT, OLLAMA_OK) as p:
            r = self.ask()
        self.assertEqual(r.choices[0].message.content, "from ollama")
        self.assertIn("/api/chat", p.call_args.args[0])
        self.assertTrue(any("tokens ran out" in s for s in self.switches))
        wait = llm._state["groq_blocked_until"] - time.time()
        self.assertTrue(13 * 60 < wait < 14 * 60, wait)
        with self.post(OLLAMA_OK) as p:                 # while blocked, Groq isn't even tried
            self.ask()
        self.assertEqual(p.call_count, 1)
        self.assertIn("/api/chat", p.call_args.args[0])
        self.assertEqual(llm.which()["now"], "local")
        llm._state["groq_blocked_until"] = time.time() - 1      # time's up -> back to Groq
        with self.post(GROQ_OK):
            self.assertEqual(self.ask().choices[0].message.content, "from groq")
        self.assertTrue(any("back to Groq" in s for s in self.switches))

    def test_offline_or_error_falls_back_for_that_message(self):
        with self.post(llm.requests.ConnectionError(), OLLAMA_OK):
            self.assertEqual(self.ask().choices[0].message.content, "from ollama")
        self.assertEqual(llm._state["groq_blocked_until"], 0.0)       # not blocked: try Groq again next time
        with self.post(R(500, {"error": "oops"}), OLLAMA_OK):
            self.assertEqual(self.ask().choices[0].message.content, "from ollama")

    def test_bad_key_stops_trying_groq(self):
        with self.post(R(401, {"error": "invalid key"}), OLLAMA_OK):
            self.ask()
        self.assertIn("rejected", llm.which()["reason"])
        with self.post(OLLAMA_OK) as p:
            self.ask()
        self.assertEqual(p.call_count, 1)

    def test_modes(self):
        llm.set_provider("local")
        with self.post(OLLAMA_OK) as p:
            self.ask()
        self.assertIn("/api/chat", p.call_args.args[0])
        llm.set_provider("groq")
        with self.post(GROQ_LIMIT):
            with self.assertRaisesRegex(llm.GroqError, "tokens ran out"):
                self.ask()
        self.assertFalse(llm.set_provider("nonsense"))
        llm.set_provider("auto")
        self.assertEqual(llm._state["groq_blocked_until"], 0.0)

    def test_no_key_means_local(self):
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": ""}):
            with self.post(OLLAMA_OK) as p:
                self.ask()
            self.assertEqual(p.call_count, 1)
            self.assertIn("GROQ_API_KEY", llm.which()["reason"])

    def test_wait_parsing(self):
        self.assertAlmostEqual(llm._wait_seconds("Please try again in 13m36.048s.", {}), 816.048, places=2)
        self.assertEqual(llm._wait_seconds("try again in 1h2m", {}), 3720)
        self.assertEqual(llm._wait_seconds("try again in 2.5s", {}), 2.5)
        self.assertEqual(llm._wait_seconds("slow down", {"retry-after": "30"}), 30)


if __name__ == "__main__":
    unittest.main()
