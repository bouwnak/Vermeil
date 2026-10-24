"""
folders.py - tells Python where Vermeil's code lives. app.py (and the tests/scripts) import this first.

    brain/    thinking: the AI connection, chat, tools, memory, missions, coding helper
    senses/   hearing, speaking and seeing: speech recognition, voices, wake word, camera, objects
    skills/   things she does: planner + music player, gym, study, focus, web, PC control, browser, calendar
    scripts/  one-time helpers you run yourself (setup_local.py, cleanup_packages.py)
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# Prevent Windows console charmap / cp1252 crashes on emojis / Unicode output
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(errors="replace")
except Exception:
    pass

for _sub in ("scripts", "skills", "senses", "brain"):
    _p = os.path.join(ROOT, _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)
