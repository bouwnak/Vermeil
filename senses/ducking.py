"""
ducking.py - only while she speaks a reply, every OTHER sound on the PC gets quieter:
YouTube music (ffplay), Spotify, Discord, the browser, games... Her own voice is not touched. When she's done
replying, the other sounds ALWAYS fade back to exactly where they were.

It uses Windows' per-app volume (the same sliders as the Volume Mixer), through pycaw.
Several things can hold the duck at once ("command", "speak"): the sound comes back only when all let go.
Each app's real volume is remembered from BEFORE it was lowered, so quick back-to-back replies never leave it a bit
quieter each time. If you turn an app UP yourself while it's lowered, your louder setting is kept.
"""
import os
import threading
import time

enabled = False         # app.py turns it on from Settings -> "Lower other sounds..." (on by default there; off for scripts/tests)
LEVEL = 0.2             # other apps play at 20% of their normal volume while ducked
FADE = 0.25             # seconds for the fade down / up
RELEASE_DELAY = 0.8     # wait a moment before the sound comes back (a follow-up sentence keeps it down)

_lock = threading.Lock()
_holders = set()
_orig = {}              # "app.exe:pid" -> its volume before we lowered it (kept until it's really been put back)
_gen = 0                # bumps on every duck, so a fade back up stops when she's needed again
_timer = None
_restoring = threading.Lock()  # one fade back up at a time (a second one just waits, then finds nothing left to do)


def _sessions():
    """[(key, app name, ISimpleAudioVolume)] for every app playing sound, except this program (her voice)."""
    from pycaw.pycaw import AudioUtilities
    me = os.getpid()
    out = []
    for s in AudioUtilities.GetAllSessions():
        try:
            if not s.Process or s.Process.pid == me:
                continue
            name = s.Process.name().lower()
            out.append((f"{name}:{s.Process.pid}", name, s.SimpleAudioVolume))
        except Exception:
            continue
    return out


def _fade(pairs, gen):
    """pairs = [(volume object, from, to)] - a quick smooth fade so it doesn't sound like a cut."""
    steps = 6
    for i in range(1, steps + 1):
        if gen != _gen:                          # a newer duck/restore took over
            return False
        for vol, a, b in pairs:
            try:
                vol.SetMasterVolume(max(0.0, min(1.0, a + (b - a) * i / steps)), None)
            except Exception:
                pass
        time.sleep(FADE / steps)
    return True


def _lower():
    global _gen
    with _lock:
        _gen += 1
        gen = _gen
    pairs = []
    for key, name, vol in _sessions():
        try:
            cur = vol.GetMasterVolume()
        except Exception:
            continue
        with _lock:
            # already lowered (or half-way back up), or the same app restarted while lowered: keep the REAL volume
            same = next((v for k, v in _orig.items() if k.rsplit(":", 1)[0] == name), cur)
            orig = _orig.setdefault(key, same)
        low = round(orig * LEVEL, 3)
        if cur > low + 0.005:
            pairs.append((vol, cur, low))
    _fade(pairs, gen)


def _restore():
    global _timer
    with _lock:
        if _timer and _timer is not threading.current_thread():
            _timer.cancel()                      # restoring now: the delayed one isn't needed
        _timer = None
    with _restoring:
        _restore_now()


def _restore_now():
    with _lock:
        if _holders or not _orig:
            return
        gen = _gen                               # only a NEW duck stops this fade (two restores just agree)
        orig = dict(_orig)
    pairs = []
    for key, name, vol in _sessions():
        # the same app - or the same program restarted / a new sound of it (Windows hands it the lowered volume)
        want = orig.get(key)
        if want is None:
            want = next((v for k, v in orig.items() if k.rsplit(":", 1)[0] == name), None)
        if want is None:
            continue
        try:
            now = vol.GetMasterVolume()
        except Exception:
            continue
        if now < want - 0.005:                   # turned up by you meanwhile? then keep yours
            pairs.append((vol, now, want))
    if _fade(pairs, gen):
        with _lock:
            if not _holders and gen == _gen:
                _orig.clear()                    # everything's back (apps that closed don't need it any more)


def duck(reason="speak"):
    """Lower other sounds (safe to call many times; does nothing if turned off or pycaw is missing)."""
    global _timer
    if not enabled:
        return
    with _lock:
        if _timer:
            _timer.cancel()
            _timer = None
        first = not _holders
        _holders.add(reason)
    if first or reason == "command":
        try:
            _lower()                            # (also catches an app that started playing since)
        except Exception as e:
            print(f"[ducking] {e}")


def release(reason="speak", delay=None):
    """Let go; when nobody holds the duck any more the other sounds fade back up."""
    global _timer
    with _lock:
        _holders.discard(reason)
        if _holders or not _orig:
            return
        if _timer:
            _timer.cancel()
        _timer = threading.Timer(RELEASE_DELAY if delay is None else delay, _safe_restore)
        _timer.daemon = True
        _timer.start()


def release_all():
    with _lock:
        _holders.clear()
    _safe_restore()


def _safe_restore():
    try:
        _restore()
    except Exception as e:
        print(f"[ducking] {e}")


def ducked():
    return bool(_holders)
