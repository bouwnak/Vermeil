"""sandbox.py - keeps the tests away from YOUR real accounts and installs. Every test file imports it right after `folders`.

- Spotify: the tests never see your login (data/spotify_token.json) or your keys (env), so nothing can play, pause or
  queue music on your real Spotify. Tests that check Spotify fake its web requests themselves.
- edge-tts (online voices): counts as not installed, so results don't depend on what's installed on this PC.
  Tests about online voices switch it on with mock.patch.
- Music ducking stays off (no real app volumes are changed).
Patching happens once per test run (the modules are shared), and tests that patch these again still work.
"""
import atexit
import os
import shutil
import tempfile

import spotify
import tts

_tmp = tempfile.mkdtemp(prefix="vermeil-tests-")
atexit.register(shutil.rmtree, _tmp, True)

spotify.TOKEN_FILE = os.path.join(_tmp, "spotify_token.json")       # no login -> not connected
spotify.BASE_DIR = _tmp                                              # no env file -> no keys
for _k in ("SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"):
    os.environ.pop(_k, None)
spotify._playlist_cache.update({"at": 0.0, "items": []})

tts.edge_available = lambda: False

try:
    import ducking
    ducking.enabled = False
except ImportError:
    pass
