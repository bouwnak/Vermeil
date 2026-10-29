import os
import unittest
from unittest import mock

import folders  # noqa: F401
import gpu


class GpuTests(unittest.TestCase):
    """the voices use the graphics card when they can, and the CPU when they can't - never an error"""
    def setUp(self):
        p = mock.patch.dict(gpu._state, {"cuda": None, "dml": None})
        p.start()
        self.addCleanup(p.stop)

    def test_voice_device_cpu_keeps_the_cpu(self):
        with mock.patch.dict(os.environ, {"VOICE_DEVICE": "cpu"}):
            self.assertFalse(gpu.cuda())
            self.assertEqual(gpu.providers(), ["CPUExecutionProvider"])

    def test_cpu_only_onnxruntime(self):
        import onnxruntime as ort
        with mock.patch.dict(os.environ, {"VOICE_DEVICE": ""}), \
                mock.patch.object(ort, "get_available_providers", lambda: ["CPUExecutionProvider"]):
            self.assertFalse(gpu.cuda())

    def test_preload_failing_means_cpu(self):
        import onnxruntime as ort
        def boom(*a, **k):
            raise OSError("cudnn64_9.dll not found")
        with mock.patch.dict(os.environ, {"VOICE_DEVICE": ""}), \
                mock.patch.object(ort, "get_available_providers", lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"]), \
                mock.patch.object(ort, "preload_dlls", boom, create=True), mock.patch("builtins.print"):
            self.assertFalse(gpu.cuda())

    def test_session_falls_back_to_the_cpu(self):
        import onnxruntime as ort
        made = []
        def fake(path, so, providers):
            if "CUDAExecutionProvider" in providers:
                raise RuntimeError("CUDA out of memory")
            made.append(providers)
            return mock.Mock(get_providers=lambda: providers)
        gpu._state["cuda"] = True
        with mock.patch.object(ort, "InferenceSession", fake), mock.patch("builtins.print"):
            s = gpu.session("voice.onnx")
        self.assertEqual(made, [["CPUExecutionProvider"]])
        self.assertFalse(gpu.on_gpu(s))

    def test_directml_for_any_card(self):
        import onnxruntime as ort
        with mock.patch.dict(os.environ, {"VOICE_DEVICE": ""}),                 mock.patch.object(ort, "get_available_providers", lambda: ["DmlExecutionProvider", "CPUExecutionProvider"]):
            self.assertEqual(gpu.kind(), "directml")
            self.assertEqual(gpu.providers(), [gpu.DML, "CPUExecutionProvider"])


if __name__ == "__main__":
    unittest.main()
