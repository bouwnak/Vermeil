"""Web search: several engines, blocked engines skipped, deeper search when results are weak."""
import os, sys, unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import web, llm  # noqa: E402

DDG_BLOCKED = '<html><div class="anomaly-modal">Unusual traffic</div></html>'
BING = '''<ol id="b_results"><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&&p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9yZW5l&ntb=1">Rene Baterbonia - Engineer</a></h2>
<div class="b_caption"><p>Rene Baterbonia is a civil engineer from Manila.</p></div></li>
<li class="b_algo"><h2><a href="https://howtotrain.fandom.com/wiki/Hiccup">Hiccup | How to Train Your Dragon Wiki</a></h2><p>Hiccup is 15 in the first film.</p></li></ol>'''


class FakeResp:
    def __init__(self, text="", status=200, js=None):
        self.text, self.status_code, self._js = text, status, js

    def json(self):
        return self._js


class SearchTests(unittest.TestCase):
    def test_blocked_engine_is_skipped_and_links_unwrapped(self):
        with mock.patch.object(web.requests, "post", return_value=FakeResp(DDG_BLOCKED)), \
                mock.patch.object(web.requests, "get", return_value=FakeResp(BING)), \
                mock.patch.dict(os.environ, {"BRAVE_SEARCH_API_KEY": ""}):
            res = web.search("who is rene baterbonia", n=2)
        self.assertEqual(res[0]["url"], "https://example.com/rene")           # Bing redirect decoded
        self.assertIn("civil engineer", res[0]["snippet"])
        self.assertTrue(any(l.startswith("duckduckgo: 0") for l in web.last_search_log))

    def test_wikipedia_and_brave(self):
        wiki = {"query": {"search": [{"title": "Hiccup Horrendous Haddock III", "snippet": "fictional <b>character</b>"}]}}
        brave = {"web": {"results": [{"title": "Toothless", "url": "https://x.org/toothless", "description": "Night Fury"}]}}

        def get(url, **kw):
            if "brave" in url:
                return FakeResp(js=brave)
            if "wikipedia" in url:
                return FakeResp(js=wiki)
            return FakeResp("", 403)
        with mock.patch.object(web.requests, "post", return_value=FakeResp("", 403)), mock.patch.object(web.requests, "get", side_effect=get), \
                mock.patch.dict(os.environ, {"BRAVE_SEARCH_API_KEY": "k"}):
            res = web.search("hiccup toothless age", n=2)
        self.assertEqual(res[0]["url"], "https://x.org/toothless")
        self.assertIn("wikipedia.org/wiki/Hiccup", res[1]["url"])
        self.assertEqual(res[1]["snippet"], "fictional character")

    def test_weak_results_trigger_a_deeper_search(self):
        calls = []

        def fake_search(q, n=6, want=None):
            calls.append(q)
            if "Baterbonia" in q and '"' in q:
                return [{"title": "Rene Baterbonia | LinkedIn", "url": "https://linkedin.com/in/rb", "snippet": "Rene Baterbonia engineer"}]
            return [{"title": "Unrelated", "url": "https://a.com", "snippet": "nothing"}]
        with mock.patch.object(web, "search", side_effect=fake_search), \
                mock.patch.object(llm, "ask", side_effect=lambda p, **k: {"queries": ['"Rene Baterbonia"', "Rene Baterbonia Philippines"]} if k.get("json_mode") else "He is an engineer [1]."), \
                mock.patch.object(web, "page_text", return_value=("Rene Baterbonia", "Rene Baterbonia is an engineer. " * 30)):
            r = web.web_answer("who is rene baterbonia")
        self.assertEqual(calls[1:], ['"Rene Baterbonia"', "Rene Baterbonia Philippines"])
        self.assertEqual(r["sources"][0]["url"], "https://linkedin.com/in/rb")       # most relevant read first
        self.assertEqual(r["tried"][0], "who is rene baterbonia")

    def test_nothing_at_all_says_what_was_tried(self):
        with mock.patch.object(web, "search", return_value=[]), mock.patch.object(llm, "ask", return_value={"queries": ["x y"]}):
            r = web.web_answer("zzqx unknown thing", deep=True)
        self.assertIn("zzqx unknown thing", r["answer"])
        self.assertIn("x y", r["answer"])


if __name__ == "__main__":
    unittest.main()
