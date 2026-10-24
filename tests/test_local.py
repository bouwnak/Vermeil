"""Tests for the local (offline) AI pieces: llm.py, scholar.py, research, stt.py."""
import os, sys, json, unittest
from types import SimpleNamespace
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import numpy as np  # noqa: E402
import llm, scholar, academic  # noqa: E402


class FakeResp:
    def __init__(self, data, status=200):
        self._d, self.status_code, self.ok, self.text = data, status, status < 400, json.dumps(data)

    def json(self):
        return self._d

    def raise_for_status(self):
        if not self.ok:
            raise RuntimeError(self.status_code)


class LLMTests(unittest.TestCase):
    def setUp(self):                                     # these tests are about the local AI (Ollama) part
        self._env = mock.patch.dict(os.environ, {"AI_PROVIDER": "local"})
        self._env.start()

    def tearDown(self):
        self._env.stop()

    def test_messages_become_ollama_format(self):
        msgs = [{"role": "system", "content": "be nice"},
                {"role": "user", "content": [{"type": "text", "text": "what is this?"},
                                             {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,AAAA"}}]},
                {"role": "assistant", "content": "", "tool_calls": [{"id": "1", "type": "function",
                    "function": {"name": "add_task", "arguments": '{"task": "x"}'}}]},
                {"role": "tool", "tool_call_id": "1", "content": "done"}]
        out = llm._to_ollama(msgs)
        self.assertEqual(out[1], {"role": "user", "content": "what is this?", "images": ["AAAA"]})
        self.assertEqual(out[2]["tool_calls"][0]["function"], {"name": "add_task", "arguments": {"task": "x"}})

    def test_response_and_tool_calls(self):
        data = {"model": "qwen3:8b", "message": {"role": "assistant", "content": "<think>hmm</think>Hi!",
                "tool_calls": [{"function": {"name": "get_tasks", "arguments": {}}}]}, "done_reason": "stop"}
        with mock.patch.object(llm.requests, "post", return_value=FakeResp(data)) as post:
            r = llm.get_client().chat.completions.create(model="chat", messages=[{"role": "user", "content": "hi"}],
                                                         tools=[{"type": "function", "function": {"name": "get_tasks"}}],
                                                         response_format={"type": "json_object"}, reasoning_effort="low")
        body = post.call_args.kwargs["json"]
        self.assertEqual(body["model"], llm.models()["chat"])
        self.assertEqual(body["format"], "json")
        self.assertFalse(body["think"])
        m = r.choices[0].message
        self.assertEqual(m.content, "Hi!")
        self.assertEqual(m.tool_calls[0].function.name, "get_tasks")
        self.assertEqual(json.loads(m.tool_calls[0].function.arguments), {})

    def test_friendly_errors(self):
        with mock.patch.object(llm.requests, "post", side_effect=llm.requests.ConnectionError()), \
                mock.patch.object(llm, "start_ollama", return_value=False) as start:      # (it tries to start it once)
            with self.assertRaisesRegex(llm.LocalAIError, "Ollama"):
                llm.ask("hi")
        start.assert_called_once()
        with mock.patch.object(llm.requests, "post", return_value=FakeResp({"error": "model not found"}, 404)):
            with self.assertRaisesRegex(llm.LocalAIError, "setup_local"):
                llm.ask("hi")

    def test_retries_without_tools_when_model_cant(self):
        ok = FakeResp({"message": {"content": "fine"}})
        with mock.patch.object(llm.requests, "post", side_effect=[FakeResp({"error": "does not support tools"}, 400), ok]) as post:
            r = llm.get_client().chat.completions.create(model="vision", messages=[{"role": "user", "content": "x"}],
                                                         tools=[{"type": "function", "function": {"name": "a"}}])
        self.assertEqual(r.choices[0].message.content, "fine")
        self.assertNotIn("tools", post.call_args.kwargs["json"])

    def test_gpu_crash_falls_back_to_cpu(self):
        crash = FakeResp({"error": "llama-server process has terminated: exit status 0xc0000409: CUDA error"}, 500)
        with mock.patch.object(llm, "MODELS_FILE", os.path.join(os.path.dirname(__file__), "_tmp_models.json")):
            try:
                with mock.patch.object(llm.requests, "post", side_effect=[crash, FakeResp({"message": {"content": "hi"}})]) as post:
                    self.assertEqual(llm.ask("x", model="chat"), "hi")
                self.assertEqual(post.call_args.kwargs["json"]["options"]["num_gpu"], 0)
                self.assertTrue(llm.cpu_only())
                with mock.patch.object(llm.requests, "post", return_value=FakeResp({"message": {"content": "ok"}})) as post:
                    llm.ask("y")
                self.assertEqual(post.call_args.kwargs["json"]["options"]["num_gpu"], 0)     # remembered
            finally:
                os.remove(llm.MODELS_FILE)

    def test_other_settings_are_not_models(self):
        path = os.path.join(os.path.dirname(__file__), "_tmp_models2.json")
        with open(path, "w") as f:
            json.dump({"chat": "qwen3:1.7b", "smart": "qwen3:4b", "vision": "qwen2.5vl:3b", "whisper": "base", "size": "tiny"}, f)
        tags = FakeResp({"models": [{"name": "qwen3:1.7b"}, {"name": "qwen3:4b"}, {"name": "qwen2.5vl:3b"}]})
        try:
            with mock.patch.object(llm, "MODELS_FILE", path), mock.patch.object(llm.requests, "get", return_value=tags):
                st = llm.status()
            self.assertEqual(st["missing"], [])
            self.assertEqual(set(st["models"]), {"chat", "smart", "vision"})
        finally:
            os.remove(path)

    def test_status_offline(self):
        with mock.patch.object(llm.requests, "get", side_effect=Exception("down")):
            self.assertFalse(llm.status()["running"])


OPENALEX_ITEM = {
    "display_name": "Effect of temperature and aging on the mechanical properties of concrete: Part I",
    "publication_year": 2002, "doi": "https://doi.org/10.1016/S0008-8846(02)00744-9", "type": "article",
    "authorships": [{"author": {"display_name": "Jin-Keun Kim"}}, {"author": {"display_name": "Sang Hun Han"}},
                    {"author": {"display_name": "Young Chul Song"}}],
    "primary_location": {"source": {"display_name": "Cement and Concrete Research"}},
    "biblio": {"volume": "32", "issue": "7", "first_page": "1087", "last_page": "1094"},
    "abstract_inverted_index": {"Concrete": [0], "gains": [1], "strength": [2]}, "cited_by_count": 500}


class ScholarTests(unittest.TestCase):
    def test_names(self):
        self.assertEqual(scholar.split_name("Jin-Keun Kim"), ("Kim", "J.-K."))
        self.assertEqual(scholar.split_name("Ludwig van Beethoven"), ("van Beethoven", "L."))
        self.assertEqual(scholar.split_name("Santos, Maria A."), ("Santos", "M. A."))

    def test_apa_journal_article(self):
        w = scholar._from_openalex(OPENALEX_ITEM)
        self.assertEqual(w["abstract"], "Concrete gains strength")
        [w] = scholar.with_citations([w])
        self.assertEqual(w["cite"], "(Kim et al., 2002)")
        self.assertEqual(w["apa"], "Kim, J.-K., Han, S. H., & Song, Y. C. (2002). Effect of temperature and aging on the "
                                   "mechanical properties of concrete: Part I. Cement and Concrete Research, 32(7), 1087-1094. "
                                   "https://doi.org/10.1016/S0008-8846(02)00744-9")
        self.assertIn("*Cement and Concrete Research, 32*(7)", w["apa_md"])

    def test_in_text_and_same_author_year(self):
        self.assertEqual(scholar.in_text([("Cruz", "J.")], 2020), "(Cruz, 2020)")
        self.assertEqual(scholar.in_text([("Cruz", "J."), ("Reyes", "A.")], None), "(Cruz & Reyes, n.d.)")
        a = {"title": "Alpha study", "authors": [("Cruz", "J.")], "year": 2020, "doi": "", "url": "", "type": "article"}
        b = {**a, "title": "Beta study"}
        cites = sorted(w["cite"] for w in scholar.with_citations([a, b]))
        self.assertEqual(cites, ["(Cruz, 2020a)", "(Cruz, 2020b)"])

    def test_sentence_case_keeps_acronyms(self):
        self.assertEqual(scholar.sentence_case("Using AI For COVID-19 Forecasting: A Review In The Philippines"),
                         "Using AI for COVID-19 forecasting: A review in the philippines")
        self.assertEqual(scholar.sentence_case("Flood risk in Metro Manila: a case study"),
                         "Flood risk in Metro Manila: a case study")

    def test_find_papers_falls_back_and_dedupes(self):
        w = scholar._from_openalex(OPENALEX_ITEM)
        with mock.patch.object(scholar, "search_openalex", side_effect=[[], [w]]), \
                mock.patch.object(scholar, "search_crossref", return_value=[dict(w)]):
            got = scholar.find_papers(["q1", "q2"])
        self.assertEqual(len(got), 1)
        with mock.patch.object(scholar, "search_openalex", side_effect=OSError("offline")), \
                mock.patch.object(scholar, "search_crossref", side_effect=OSError("offline")):
            with self.assertRaises(ConnectionError):
                scholar.find_papers(["x"])


class ResearchTests(unittest.TestCase):
    def test_answers_only_from_found_papers(self):
        w = scholar._from_openalex(OPENALEX_ITEM)
        replies = [json.dumps({"queries": ["concrete curing temperature"]}),
                   "Heat speeds early strength (Kim et al., 2002) but (Smith, 2019) disagrees.\n\nReferences:\nfake"]
        client = mock.MagicMock()
        client.chat.completions.create.side_effect = [SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=t))]) for t in replies]
        with mock.patch.object(academic, "_client", return_value=client), \
                mock.patch.object(scholar, "find_papers", return_value=[w]) as fp:
            r = academic.research("Does temperature affect concrete strength?")
        fp.assert_called_once_with(["concrete curing temperature"], 8)
        self.assertNotIn("References", r["answer"])
        self.assertEqual(len(r["sources"]), 1)
        self.assertTrue(r["sources"][0]["url"].startswith("https://doi.org/"))
        self.assertEqual(r["unverified"], ["Smith, 2019"])
        prompt = client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("ONLY the papers", prompt)
        self.assertIn("(Kim et al., 2002)", prompt)


class STTTests(unittest.TestCase):
    def test_silence_and_hallucinations_ignored(self):
        import stt
        self.assertEqual(stt.transcribe(b"RIFF" + b"\0" * 100), "")
        fake = mock.Mock()
        fake.transcribe.return_value = ([SimpleNamespace(text=" Thank you.")], None)
        with mock.patch.object(stt, "load", return_value=fake):
            self.assertEqual(stt.transcribe(np.zeros(16000, dtype=np.float32)), "")
            fake.transcribe.return_value = ([SimpleNamespace(text=" switch to Pip")], None)
            self.assertEqual(stt.transcribe(np.zeros(16000, dtype=np.float32)), "switch to Pip")


if __name__ == "__main__":
    unittest.main()


class STTGpuFallbackTests(unittest.TestCase):
    def test_missing_cublas_switches_to_cpu(self):
        import stt
        broken = mock.Mock()
        broken.transcribe.side_effect = RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")
        cpu = mock.Mock()
        cpu.transcribe.return_value = ([SimpleNamespace(text=" hello")], None)
        with mock.patch.object(stt, "_model", broken), mock.patch.object(stt, "_cpu_model", return_value=cpu):
            self.assertEqual(stt.transcribe(np.zeros(16000, dtype=np.float32)), "hello")
            self.assertIs(stt._model, cpu)

    def test_load_tests_gpu_and_falls_back(self):
        import stt, types
        gpu = mock.Mock()
        gpu.transcribe.side_effect = RuntimeError("Library cublas64_12.dll is not found")
        fw = types.SimpleNamespace(WhisperModel=mock.Mock(return_value=gpu))
        cpu = object()
        with mock.patch.dict(sys.modules, {"faster_whisper": fw}), mock.patch.object(stt, "_model", None), \
                mock.patch.object(stt, "_cpu_model", return_value=cpu), mock.patch.object(llm, "cpu_only", return_value=False):
            self.assertIs(stt.load(), cpu)
