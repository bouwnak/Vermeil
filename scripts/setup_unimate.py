"""setup_unimate.py - gets UniMate (Rig & animate) fully ready in this window: Miniconda, a small Git, the UniMate
code, its own Python 3.10, the checkpoint and its libraries (about 3 GB in all). The Windows installer runs it, so
Vermeil opens with UniMate already installed. Running it again only fetches what is missing.

    python scripts/setup_unimate.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: F401,E402 - puts brain/, senses/, skills/ on the path


def main():
    if os.name != "nt":
        print("UniMate's automatic setup is for Windows only - skipped.")
        return 0
    import animate
    import autosetup
    if animate.status()["ready"]:
        print("UniMate is already installed.")
        return 0
    try:
        did = autosetup._unimate(lambda pct, text: print(f"   {pct:3d}%  {text}", flush=True))
    except Exception as e:  # noqa: BLE001 - shown to you, Vermeil tries again from the Animate box
        print(f"UniMate didn't finish: {e}\nVermeil can try again later from the Animate box (see data/auto_setup.log).")
        return 1
    autosetup.state.update(autosetup._load())
    autosetup.state.setdefault("_started", {})["unimate"] = 1          # the app won't start the setup again by itself
    autosetup.state["unimate"] = {"status": "ready", "pct": 100, "text": "Ready", "time": 0}
    autosetup._save()
    print(did or "UniMate is ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
