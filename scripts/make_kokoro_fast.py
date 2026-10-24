"""make_kokoro_fast.py - makes Kokoro (Vermeil's voice) speak 2-3x faster on a normal CPU.

It shrinks tools\\kokoro\\kokoro-v1.0.onnx (325 MB, 32-bit numbers) into kokoro-v1.0.int8.onnx (~90 MB, 8-bit numbers).
The voice sounds almost the same. On SOME CPUs it's 2-3x faster, on others slower - the script times both and keeps
the int8 model only when it really is faster (then put KOKORO_QUALITY=fast in your env file).

Run once (it takes about a minute):
    python -m pip install onnx
    python scripts\\make_kokoro_fast.py
"""
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "kokoro", "kokoro-v1.0.onnx")
OUT = os.path.join(ROOT, "tools", "kokoro", "kokoro-v1.0.int8.onnx")


def main():
    if not os.path.exists(SRC):
        sys.exit(f"Can't find {SRC} - set up Kokoro first (scripts\\setup_kokoro.bat).")
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic
    except ImportError:
        sys.exit("One small package is missing. Run this first:\n    python -m pip install onnx")
    print("Making the fast Kokoro model (about a minute)...")
    t = time.time()
    quantize_dynamic(SRC, OUT + ".tmp", weight_type=QuantType.QUInt8)
    os.replace(OUT + ".tmp", OUT)
    print(f"Done in {time.time() - t:.0f}s: {OUT} ({os.path.getsize(OUT) / 1e6:.0f} MB)")

    # quick check: is it really faster here?
    sys.path[:0] = [os.path.join(ROOT, "senses"), os.path.join(ROOT, "brain")]
    from kokoro_onnx import Kokoro
    line = "Somewhere in the dark, a heavy door creaks open and the torches flicker."
    took = {}
    for path in (SRC, OUT):
        k = Kokoro(path, os.path.join(ROOT, "tools", "kokoro", "voices-v1.0.bin"))
        k.create("Hi.", voice="af_heart", speed=1.0, lang="en-us")
        t = time.time()
        audio, sr = k.create(line, voice="af_heart", speed=1.0, lang="en-us")
        took[path] = time.time() - t
        print(f"{os.path.basename(path)}: {took[path]:.2f}s to make {len(audio) / sr:.1f}s of speech "
              f"({len(audio) / sr / took[path]:.1f}x real time)")
    if took[OUT] < took[SRC] * 0.85:
        print("The fast model IS faster on this PC. Put  KOKORO_QUALITY=fast  in your env file and restart Vermeil.")
    else:
        os.remove(OUT)
        print("The int8 model isn't faster on this CPU, so it was removed (Vermeil keeps the normal model).\n"
              "For a real speed-up use an NVIDIA graphics card - see the top of senses\\kokoro.py.")


if __name__ == "__main__":
    main()
