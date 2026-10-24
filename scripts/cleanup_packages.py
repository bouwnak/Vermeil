"""
cleanup_packages.py - removes Python packages that Vermeil doesn't use.

How it works:
  1. Reads requirements.txt and finds everything those packages need (their dependencies).
  2. Lists every OTHER package installed in this Python.
  3. Asks you to type YES before uninstalling anything.
  4. Saves the removed list to data/removed_packages.txt so you can undo it:
         python -m pip install -r data/removed_packages.txt

Run it with the same Python you use for Vermeil:
    python scripts/cleanup_packages.py            (shows the list, then asks)
    python scripts/cleanup_packages.py --keep pandas numpy   (never remove these)

Warning: this Python is shared by ALL your projects. Packages used by other projects
(your thesis, games, etc.) will be removed too unless you --keep them.
"""
import os
import re
import sys
import subprocess
from importlib import metadata

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # the project folder (this file is in scripts/)
ALWAYS_KEEP = {"pip", "setuptools", "wheel"}


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def requirement_names(path):
    names = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.split("#", 1)[0].strip()
            if line:
                names.append(norm(re.split(r"[<>=!~\[; ]", line, maxsplit=1)[0]))
    return names


def needed_packages(roots):
    """The requirements plus everything they depend on (for this computer)."""
    try:
        from packaging.requirements import Requirement
    except ImportError:
        from pip._vendor.packaging.requirements import Requirement
    needed, todo = set(), list(roots)
    while todo:
        name = todo.pop()
        if name in needed:
            continue
        needed.add(name)
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        for req_text in dist.requires or []:
            req = Requirement(req_text)
            if req.marker and not req.marker.evaluate({"extra": ""}):
                continue                                    # only needed on other systems / optional extras
            todo.append(norm(req.name))
    return needed


def main():
    keep = {norm(k) for k in sys.argv[sys.argv.index("--keep") + 1:]} if "--keep" in sys.argv else set()
    req = os.path.join(HERE, "requirements.txt")
    roots = requirement_names(req)
    missing = [r for r in roots if not _installed(r)]
    needed = needed_packages(roots) | ALWAYS_KEEP | keep
    installed = {norm(d.metadata["Name"]): d.version for d in metadata.distributions() if d.metadata["Name"]}
    remove = sorted(n for n in installed if n not in needed)

    print(f"Python: {sys.executable}")
    print(f"Vermeil needs {len(needed & set(installed))} installed packages (from requirements.txt + their dependencies).")
    if missing:
        print(f"\nThese Vermeil packages aren't installed yet: {', '.join(missing)}")
        print("Install them first, so I can see what they depend on:  python -m pip install -r requirements.txt")
        print("Nothing was removed.")
        return
    if not remove:
        print("\nNothing to remove - this Python only has what Vermeil uses.")
        return
    print(f"\n{len(remove)} packages are NOT used by Vermeil:\n")
    for n in remove:
        print(f"  {n}=={installed[n]}")
    print("\nIf another project of yours needs some of these, stop now and run again with:")
    print("    python scripts/cleanup_packages.py --keep name1 name2")
    if input("\nType YES to uninstall all of the packages above: ").strip() != "YES":
        print("Cancelled. Nothing was removed.")
        return
    os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
    backup = os.path.join(HERE, "data", "removed_packages.txt")
    with open(backup, "w", encoding="utf-8") as f:
        f.write("\n".join(f"{n}=={installed[n]}" for n in remove) + "\n")
    print(f"\nSaved the list to {backup} (to undo: python -m pip install -r data/removed_packages.txt)\n")
    for i in range(0, len(remove), 40):                      # in batches so one bad package doesn't stop the rest
        subprocess.call([sys.executable, "-m", "pip", "uninstall", "-y", *remove[i:i + 40]])
    print("\nDone. Start Vermeil to check everything still works:  python app.py")


def _installed(name):
    try:
        metadata.distribution(name)
        return True
    except metadata.PackageNotFoundError:
        return False


if __name__ == "__main__":
    main()
