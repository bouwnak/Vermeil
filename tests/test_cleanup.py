"""Tests for cleanup_packages.py using a fake list of installed packages (nothing is really uninstalled)."""
import os
import sys
import shutil
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
import cleanup_packages as cp  # noqa: E402


class FakeDist:
    def __init__(self, name, version="1.0", requires=None):
        self.metadata = {"Name": name}
        self.version = version
        self.requires = requires or []


FAKE = {d.metadata["Name"].lower(): d for d in [
    FakeDist("groq", requires=["httpx>=0.23", "anyio"]), FakeDist("httpx", requires=["certifi"]), FakeDist("anyio"),
    FakeDist("certifi"), FakeDist("pywebview", requires=['pythonnet; sys_platform == "win32"', 'pyobjc; sys_platform == "darwin"']),
    FakeDist("pythonnet"), FakeDist("pyobjc"), FakeDist("pandas", "2.2.0"), FakeDist("tensorflow", "2.16.1"),
    FakeDist("pip"), FakeDist("pytest", requires=['coverage; extra == "cov"']), FakeDist("coverage")]}


def fake_distribution(name):
    if name.lower() not in FAKE:
        raise cp.metadata.PackageNotFoundError(name)
    return FAKE[name.lower()]


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        with open(os.path.join(self.tmp, "requirements.txt"), "w") as f:
            f.write("# comment\ngroq\npywebview   # window\n")
        self.patches = [mock.patch.object(cp, "HERE", self.tmp),
                        mock.patch.object(cp.metadata, "distribution", fake_distribution),
                        mock.patch.object(cp.metadata, "distributions", lambda: list(FAKE.values()))]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.tmp)

    def test_needed_includes_dependencies_for_this_system_only(self):
        needed = cp.needed_packages(["groq", "pywebview"])
        self.assertTrue({"groq", "httpx", "anyio", "certifi", "pywebview"} <= needed)
        if sys.platform == "win32":
            self.assertIn("pythonnet", needed)
        self.assertNotIn("pyobjc", needed) if sys.platform != "darwin" else None

    def test_dry_run_asks_and_removes_nothing_without_yes(self):
        with mock.patch("builtins.input", return_value="no"), mock.patch.object(cp.subprocess, "call") as call, \
                mock.patch.object(sys, "argv", ["x"]):
            cp.main()
        call.assert_not_called()

    def test_yes_removes_only_unused_and_keeps_backup(self):
        with mock.patch("builtins.input", return_value="YES"), mock.patch.object(cp.subprocess, "call") as call, \
                mock.patch.object(sys, "argv", ["x", "--keep", "Pandas"]):
            cp.main()
        removed = call.call_args.args[0][5:]
        self.assertIn("tensorflow", removed)
        self.assertIn("pytest", removed)
        for kept in ("pandas", "groq", "httpx", "anyio", "pip"):
            self.assertNotIn(kept, removed)
        with open(os.path.join(self.tmp, "data", "removed_packages.txt")) as f:
            self.assertIn("tensorflow==2.16.1", f.read())

    def test_refuses_when_requirements_missing(self):
        with open(os.path.join(self.tmp, "requirements.txt"), "a") as f:
            f.write("edge-tts\n")
        with mock.patch("builtins.input", return_value="YES"), mock.patch.object(cp.subprocess, "call") as call, \
                mock.patch.object(sys, "argv", ["x"]):
            cp.main()
        call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
