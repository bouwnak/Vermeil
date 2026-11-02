"""
turtlesave.py - the save of Turtle Island (ui/turtle). A save is never written over in place: it goes to a new file that replaces the old one in a
single step, and the last good save is kept beside it, so a crash or a full disk can't lose your farm.
"""
import json
import os
import tempfile

from paths import data_file

FILE = data_file("turtle_island.json")
BACKUP = FILE + ".bak"


def _read(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) and data.get("version") else None
    except (OSError, ValueError):
        return None


def load():
    """the saved game, or None. A damaged file falls back to the copy before it."""
    return _read(FILE) or _read(BACKUP)


def save(state):
    if not isinstance(state, dict) or not state.get("version"):
        return {"error": "That save looks wrong, so it wasn't written."}
    folder = os.path.dirname(FILE)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=folder, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f)
            f.flush()
            os.fsync(f.fileno())
        if _read(FILE) is not None:                # only a good save may become the backup
            os.replace(FILE, BACKUP)
        os.replace(tmp, FILE)
    except OSError as e:
        try:
            os.remove(tmp)
        except OSError:
            pass
        return {"error": f"Couldn't save: {e}"}
    return {"ok": True}
