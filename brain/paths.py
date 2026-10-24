"""
paths.py - where Vermeil keeps things.

    (project folder)/        the app code
    (project folder)/data/   everything Vermeil saves: memory, characters, room, planner, notes...

Files from older versions that are still in the project folder are moved into data/ automatically.
"""
import os
import shutil

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # the project folder (paths.py is in brain/)
DATA_DIR = os.path.join(BASE_DIR, "data")

SAVED_FILES = [
    "data.json", "notes.txt", "playlist.txt", "cookies.txt",            # planner, notes, music
    "vermeil_memory_0.json", "vermeil_archive.json",                     # chat memory
    "characters.json", "app_settings.json", "room_layout.json",         # window app
    "voices_cache.json", "owner_face.json",                              # voice list, your face
]


def data_file(name):
    return os.path.join(DATA_DIR, name)


def migrate_old_files():
    """Move saved files from the project folder into data/. If both exist, the newer one is kept
    (an older version of the app may still have been running and saving to the old place)."""
    os.makedirs(DATA_DIR, exist_ok=True)
    for name in SAVED_FILES:
        old, new = os.path.join(BASE_DIR, name), data_file(name)
        if not os.path.exists(old):
            continue
        try:
            if not os.path.exists(new) or os.path.getmtime(old) > os.path.getmtime(new):
                shutil.move(old, new)                 # newer -> replaces the copy in data/
            else:
                os.replace(old, new + ".old")        # older leftover: keep it aside, don't overwrite
        except OSError as e:
            print(f"[paths] couldn't move {name} into data/: {e}")


migrate_old_files()
