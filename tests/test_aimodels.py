"""The local AI models that suit this PC (skills/aimodels.py) - no AI, no internet needed."""
import os, sys, tempfile, unittest
from unittest import mock
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import folders  # noqa
import sandbox  # noqa: E402,F401
import aimodels
import llm


class ModelsForThisPC(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        p = mock.patch.object(llm, "MODELS_FILE", os.path.join(d.name, "m.json")); p.start(); self.addCleanup(p.stop)

    def _status(self, installed, models=None):
        return {"running": True, "installed": installed, "missing": [], "models": models or dict(llm.DEFAULT_MODELS)}

    def test_sizes(self):
        self.assertEqual(aimodels.pick_size(6, 16), "small")          # a GTX 1660
        self.assertEqual(aimodels.pick_size(16, 32), "large")
        self.assertEqual(aimodels.pick_size(8, 16), "medium")
        self.assertEqual(aimodels.pick_size(0, 8), "tiny")

    def test_models_already_here_need_no_download(self):
        with mock.patch.object(aimodels, "gpu_memory_gb", return_value=("GTX 1660", 6)), mock.patch.object(aimodels, "ram_gb", return_value=16), \
             mock.patch.object(llm, "status", return_value=self._status(["qwen3:4b", "qwen2.5vl:3b"])):
            r = aimodels.recommend()
        self.assertEqual(r["models"], ["qwen3:4b", "qwen2.5vl:3b"])
        self.assertEqual(r["missing"], [])
        self.assertFalse(r["active"])

    def test_install_downloads_whats_missing_and_switches(self):
        rec = {"size": "small", "models": ["qwen3:4b", "qwen2.5vl:3b"], "missing": ["qwen2.5vl:3b"]}
        with mock.patch.object(aimodels, "_ensure_ollama"), mock.patch.object(aimodels, "recommend", return_value=rec), mock.patch.object(aimodels, "_pull") as pull:
            self.assertTrue(aimodels.install()["ok"])
        self.assertEqual(pull.call_args[0][0], "qwen2.5vl:3b")
        self.assertEqual(llm.models()["chat"], "qwen3:4b")
        self.assertEqual(llm.models()["vision"], "qwen2.5vl:3b")

    def test_switching_keeps_the_files_other_settings(self):
        llm.set_cpu_only(True)
        aimodels.apply_plan("small")
        self.assertTrue(llm.cpu_only())


if __name__ == "__main__":
    unittest.main()
