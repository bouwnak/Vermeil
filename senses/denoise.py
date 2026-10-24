"""
denoise.py - cleans background noise (fan, aircon, PC hum, street) out of your voice before Whisper reads it.

How: it splits the sound into many small frequency bands, works out how loud the steady background is in each
band (from the quietest moments), and turns those bands down. Your voice is much louder than the hum, so it stays.
Pure numpy, runs offline, takes a few milliseconds.
"""
import numpy as np

N_FFT = 512
HOP = 128


def _stft(x):
    win = np.hanning(N_FFT).astype(np.float32)
    pad = np.concatenate([np.zeros(N_FFT // 2, np.float32), x, np.zeros(N_FFT, np.float32)])
    n = 1 + (len(pad) - N_FFT) // HOP
    frames = np.lib.stride_tricks.as_strided(pad, shape=(n, N_FFT), strides=(pad.strides[0] * HOP, pad.strides[0]))
    return np.fft.rfft(frames * win, axis=1), win


def _istft(spec, win, length):
    frames = np.fft.irfft(spec, n=N_FFT, axis=1) * win
    out = np.zeros(HOP * (len(frames) - 1) + N_FFT, np.float32)
    norm = np.zeros_like(out)
    for i, f in enumerate(frames):
        out[i * HOP:i * HOP + N_FFT] += f
        norm[i * HOP:i * HOP + N_FFT] += win ** 2
    out /= np.maximum(norm, 1e-6)
    return out[N_FFT // 2:N_FFT // 2 + length]


def noise_profile(audio):
    """How loud the background is in each frequency band (from a recording of just noise)."""
    spec, _ = _stft(np.asarray(audio, np.float32))
    return np.abs(spec).mean(axis=0)


def reduce_noise(audio, noise=None, strength=1.6, floor=0.1):
    """audio: float32 samples (-1..1, 16 kHz). Returns the cleaned audio, same length.
    noise: optional profile from noise_profile(); otherwise the quietest 15% of moments are used."""
    x = np.asarray(audio, np.float32)
    if x.size < N_FFT * 4:
        return x
    spec, win = _stft(x)
    mag = np.abs(spec)
    if noise is None:
        energy = mag.sum(axis=1)
        quiet = mag[energy <= np.percentile(energy, 15)]
        noise = quiet.mean(axis=0) if len(quiet) else np.percentile(mag, 10, axis=0)
    gain = np.clip(1 - strength * noise[None, :] / np.maximum(mag, 1e-9), floor, 1.0)
    k = np.ones(3, np.float32) / 3                       # smooth over time so it doesn't sound "watery"
    gain = np.apply_along_axis(lambda g: np.convolve(g, k, mode="same"), 0, gain)
    return _istft(spec * gain, win, len(x)).astype(np.float32)
