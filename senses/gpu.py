"""gpu.py - run the voice models (Piper, Kokoro, RVC's ContentVec) on the graphics card when there is one.

Two ways, depending on which onnxruntime is installed (only one of them can be):
  onnxruntime-gpu         NVIDIA cards (CUDA). It only finds the CUDA files when they're loaded for it:
                          preload() does that once (they come with torch and the nvidia-* pip packages).
  onnxruntime-directml    ANY Windows graphics card: AMD, Intel or NVIDIA (DirectML). About as fast.
  onnxruntime             the normal one: CPU only.
Measured (long sentence, RTX 3050): Piper 0.54 s CPU -> 0.24 s DirectML / 0.28 s CUDA,
ContentVec 0.93 s CPU -> 0.18 s DirectML / 0.14 s CUDA.

VOICE_DEVICE=cpu in .env keeps the voices on the CPU (e.g. when another app needs all of the graphics card).
"""
import os
import threading

_lock = threading.Lock()
_state = {"cuda": None, "dml": None}
DML = ("DmlExecutionProvider", {"performance_preference": "high_performance"})   # the fast card, not the built-in one


def cuda():
    """True when onnxruntime can use an NVIDIA card (the CUDA files are loaded the first time this is asked)."""
    with _lock:
        if _state["cuda"] is None:
            _state["cuda"] = _preload()
        return _state["cuda"]


def directml():
    """True when onnxruntime-directml is installed (any Windows graphics card)."""
    if _state["dml"] is None:
        try:
            import onnxruntime as ort
            _state["dml"] = os.environ.get("VOICE_DEVICE", "").strip().lower() != "cpu" and \
                "DmlExecutionProvider" in ort.get_available_providers()
        except Exception:
            _state["dml"] = False
    return _state["dml"]


def kind():
    """"cuda", "directml" or None (CPU)"""
    return "cuda" if cuda() else "directml" if directml() else None


def _preload():
    if os.environ.get("VOICE_DEVICE", "").strip().lower() == "cpu":
        return False
    try:
        import onnxruntime as ort
        if "CUDAExecutionProvider" not in ort.get_available_providers():
            return False                            # the CPU or DirectML onnxruntime is installed
        try:
            import torch                            # its CUDA files load first, so both share them
            if not torch.cuda.is_available():
                return False
        except ImportError:
            pass
        if hasattr(ort, "preload_dlls"):
            ort.preload_dlls()
        return True
    except Exception as e:
        print(f"[voice] graphics card not used ({str(e)[:80]}) - the voices run on the CPU.")
        return False


def providers():
    """onnxruntime providers: the graphics card first (when it works), the CPU as the fallback"""
    k = kind()
    return (["CUDAExecutionProvider"] if k == "cuda" else [DML] if k == "directml" else []) + ["CPUExecutionProvider"]


_dml_lock = threading.Lock()


class _OneAtATime:
    """a DirectML session. Several sentences are voiced side by side, but two DirectML models running
    at the same moment crash Python (access violation), so they all take turns on one shared lock."""
    def __init__(self, sess):
        self._sess = sess

    def run(self, *a, **k):
        with _dml_lock:
            return self._sess.run(*a, **k)

    def __getattr__(self, name):
        return getattr(self._sess, name)


def session(path, options=None):
    """an onnxruntime session on the graphics card, or on the CPU if that doesn't work"""
    import onnxruntime as ort
    so = options or ort.SessionOptions()
    so.log_severity_level = 3                       # no wall of warnings when a CUDA file is missing
    dml = kind() == "directml"
    if dml:                                         # what DirectML needs
        so.enable_mem_pattern = False
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    try:
        sess = ort.InferenceSession(path, so, providers=providers())
        return _OneAtATime(sess) if dml and on_gpu(sess) else sess
    except Exception as e:
        print(f"[voice] graphics card didn't work for {os.path.basename(path)} ({str(e)[:80]}) - using the CPU.")
        return ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])


def on_gpu(sess):
    return sess.get_providers()[0] in ("CUDAExecutionProvider", "DmlExecutionProvider")
