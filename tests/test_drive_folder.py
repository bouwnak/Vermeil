"""One Google Drive FOLDER link for everything: reading a shared folder (brain/gdrive.py), every feature finding its own
zip in it (brain/plugins.py), installing a feature from its zip (files + offline packages) and the Games hub adding
every game in it (skills/mygames.py) - no internet needed."""
import os
import shutil
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for d in ("", "skills", "brain", "scripts"):
    sys.path.insert(0, os.path.join(ROOT, d))
import gdrive
import mygames
import plugins

TOP = "1TopFolderAAAAAAAAAAAAAA"
SUB = "1SubFolderBBBBBBBBBBBBBB"


def entry(name, fid, folder=False):
    href = f"https://drive.google.com/drive/folders/{fid}" if folder else f"https://drive.google.com/file/d/{fid}/view?usp=drive_web"
    return (f'<div class="flip-entry" id="entry-{fid}" tabindex="0" role="link"><div class="flip-entry-info">'
            f'<a href="{href}" target="_blank"><div class="flip-entry-title">{name}</div></a></div></div>')


PAGES = {
    TOP: '<html><body class="flip-embedded"><div class="flip-entries">' + entry("2 - Plugins", SUB, True)
         + entry("HOW TO INSTALL.txt", "1HowToCCCCCCCCCCCCCCCCC") + "</div></body></html>",
    SUB: '<html><body class="flip-embedded"><div class="flip-entries">' + entry("rvc_models.zip", "1RvcDDDDDDDDDDDDDDDDDDD")
         + entry("kokoro.zip", "1KokoroEEEEEEEEEEEEEEEEE") + entry("Tom &amp; Jerry.zip", "1GameFFFFFFFFFFFFFFFFFFF") + "</div></body></html>",
}


def fake_get(fid):
    return mock.Mock(status_code=200, url="https://drive.google.com/embeddedfolderview?id=" + fid, text=PAGES[fid])


class FolderListTests(unittest.TestCase):
    def test_folder_ids(self):
        self.assertEqual(gdrive.folder_id(f"https://drive.google.com/drive/folders/{TOP}?usp=sharing"), TOP)
        self.assertIsNone(gdrive.folder_id(f"https://evil.example/drive/folders/{TOP}"))
        with self.assertRaises(ValueError):
            gdrive.list_folder("https://drive.google.com/file/d/1NotAFolderXXXXXXXXXX/view")

    def test_walks_sub_folders(self):
        files = gdrive.list_folder(f"https://drive.google.com/drive/folders/{TOP}", _get=fake_get)
        self.assertEqual([f["path"] for f in files],
                         ["2 - Plugins/rvc_models.zip", "2 - Plugins/kokoro.zip", "2 - Plugins/Tom & Jerry.zip", "HOW TO INSTALL.txt"])
        self.assertEqual(files[0]["url"], "https://drive.google.com/file/d/1RvcDDDDDDDDDDDDDDDDDDD/view")

    def test_private_folder(self):
        bad = lambda fid: mock.Mock(status_code=200, url="https://accounts.google.com/signin", text="<html>sign in</html>")
        with self.assertRaises(RuntimeError):
            gdrive.list_folder(f"https://drive.google.com/drive/folders/{TOP}", _get=bad)


class FolderPluginTests(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        self.d = d
        for p in (mock.patch.object(plugins, "LINKS_FILE", os.path.join(d, "links.json")),
                  mock.patch.object(plugins, "PACKS", os.path.join(d, "packs")),
                  mock.patch.object(plugins, "BASE", os.path.join(d, "app"))):
            p.start()
            self.addCleanup(p.stop)

    def test_every_feature_finds_its_zip(self):
        files = gdrive.list_folder(f"https://drive.google.com/drive/folders/{TOP}", _get=fake_get)
        r = plugins.use_folder(f"https://drive.google.com/drive/folders/{TOP}", _files=files)
        self.assertEqual(r["count"], 2)                                         # rvc_models.zip (a pack) and kokoro.zip (no pack)
        self.assertEqual(plugins.links()["kokoro"], "https://drive.google.com/file/d/1KokoroEEEEEEEEEEEEEEEEE/view")
        self.assertEqual(plugins.links()["_folder"], f"https://drive.google.com/drive/folders/{TOP}")
        self.assertIn("UniMate animations", r["missing"])
        self.assertNotIn("folder", plugins.status())                          # the link never goes to the screen

    def test_bad_folder_link(self):
        self.assertIn("error", plugins.use_folder("https://drive.google.com/file/d/1NotAFolderXXXXXXXXXX/view"))

    def test_install_from_its_zip(self):
        """the zip brings the model file and the packages (wheels); pip then installs those without the internet"""
        p = {"id": "demo", "name": "Demo", "pip": ["demo-pkg"], "files": [{"path": "tools/demo/model.onnx", "url": "https://x/never"}]}
        plugins.set_link("kokoro", "https://drive.google.com/file/d/1KokoroEEEEEEEEEEEEEEEEE/view")
        links = {"demo": "https://drive.google.com/file/d/1DemoGGGGGGGGGGGGGGGGG/view"}

        def fake_download(url, dest, progress=None):
            with zipfile.ZipFile(dest, "w") as z:
                z.writestr("tools/demo/model.onnx", "model")
                z.writestr("plugin_packs/wheels/demo/demo_pkg-1.0-py3-none-any.whl", "wheel")
                z.writestr("../outside.txt", "never")
            return dest

        calls = []
        with mock.patch.object(gdrive, "download", fake_download), mock.patch.object(plugins, "links", lambda: links), \
                mock.patch.object(plugins, "_log", lambda pid, text, *a, **k: plugins._jobs[pid]["log"].append(text)), \
                mock.patch.object(plugins, "_pip", lambda args, pid, *a, **k: calls.append(args)), \
                mock.patch.object(plugins, "has_module", lambda x: False), mock.patch.object(plugins, "_set", lambda *a: None), \
                mock.patch.object(plugins, "_download", lambda *a: self.fail("should not download from the internet")):
            plugins.PACKS = os.path.join(self.d, "app", "plugin_packs")       # the zip's wheels land in the app's plugin_packs
            plugins._jobs["demo"] = {"state": "running", "log": []}
            plugins._install_now(p)
        self.assertEqual(plugins._jobs["demo"]["state"], "done", plugins._jobs["demo"]["log"])
        self.assertTrue(os.path.isfile(os.path.join(self.d, "app", "tools", "demo", "model.onnx")))
        self.assertFalse(os.path.exists(os.path.join(self.d, "outside.txt")))
        self.assertEqual(calls[0][:3], ["install", "--no-index", "--find-links"])
        self.assertFalse(os.path.isdir(os.path.join(plugins.PACKS, "wheels", "demo")))   # cleaned up after installing


class BuiltInFolderTests(unittest.TestCase):
    """nobody pastes anything: the app's own Vermeil Drive folder (plugins.DRIVE_FOLDER) is where features come from"""
    def setUp(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        for p in (mock.patch.object(plugins, "LINKS_FILE", os.path.join(d, "links.json")),
                  mock.patch.object(plugins, "PACKS", os.path.join(d, "packs")),
                  mock.patch.object(plugins, "DRIVE_FOLDER", f"https://drive.google.com/drive/folders/{TOP}"),
                  mock.patch.object(plugins, "_folder_files", {"at": 0, "url": "", "files": None}),
                  mock.patch.object(gdrive, "requests", mock.Mock(get=lambda u, timeout=30: fake_get(u.split("id=")[1])))):
            p.start()
            self.addCleanup(p.stop)

    def test_the_app_knows_its_folder(self):
        self.assertTrue(plugins.DRIVE_FOLDER.startswith("https://drive.google.com/drive/folders/"))
        self.assertEqual(plugins.folder_link(), f"https://drive.google.com/drive/folders/{TOP}")

    def test_finds_its_zip_by_itself(self):
        kokoro = plugins.BY_ID["kokoro"]
        self.assertFalse(plugins._has_pack(kokoro))                      # the folder wasn't read yet: no internet in status()
        self.assertEqual(plugins._link_for(kokoro), "https://drive.google.com/file/d/1KokoroEEEEEEEEEEEEEEEEE/view")
        self.assertEqual(plugins.links()["kokoro"], "https://drive.google.com/file/d/1KokoroEEEEEEEEEEEEEEEEE/view")
        self.assertIsNone(plugins._link_for(plugins.BY_ID["gym"]))      # gym.zip isn't in this folder
        st = {p["id"]: p for p in plugins.status()["plugins"]}
        self.assertNotIn("voice_clone", st)                              # built in: not a plugin card
        self.assertTrue(plugins._has_pack(plugins.BY_ID["voice_clone"]))  # but rvc_models.zip is seen in the folder
        self.assertNotIn("drive.google", str(plugins.status()))           # yes/no only, never the link itself

    def test_links_hidden_in_messages(self):
        msg = gdrive.hide_links("404 Client Error for url: https://drive.usercontent.google.com/download?id=1AbC&confirm=t")
        self.assertNotIn("google", msg)
        self.assertNotIn("1AbC", msg)
        with mock.patch.object(plugins, "on_event", None), mock.patch("builtins.print"):
            plugins._log("kokoro", f"failed: {plugins.DRIVE_FOLDER}")
        self.assertNotIn("drive.google", plugins._jobs["kokoro"]["log"][-1])

    def test_unreadable_folder(self):
        with mock.patch.object(gdrive, "list_folder", mock.Mock(side_effect=RuntimeError("offline"))):
            self.assertEqual(plugins.folder_files(refresh=True), [])
            self.assertIsNone(plugins._link_for(plugins.BY_ID["kokoro"]))

    def test_games_from_it(self):
        with mock.patch.object(mygames, "add_folder", lambda url, say: {"url": url}):
            self.assertEqual(mygames.add_url("")["url"], f"https://drive.google.com/drive/folders/{TOP}")


class FolderGamesTests(unittest.TestCase):
    def test_adds_each_game(self):
        files = [{"name": "Vermeil.zip", "path": "3 - Games/Vermeil/Vermeil.zip", "url": "https://drive.google.com/file/d/1G1/view"},
                 {"name": "kokoro.zip", "path": "2 - Plugins/02 Kokoro/kokoro.zip", "url": "https://drive.google.com/file/d/1K/view"}]
        got = []
        with mock.patch.object(mygames, "_load", lambda: []), \
                mock.patch.object(mygames, "add_url", lambda url, say=None: got.append(url) or {"ok": True, "game": {"name": "Vermeil"}}):
            r = mygames.add_folder(f"https://drive.google.com/drive/folders/{TOP}", _files=files)
        self.assertEqual(got, ["https://drive.google.com/file/d/1G1/view"])
        self.assertEqual(r["added"], ["Vermeil"])

    def test_no_games(self):
        with mock.patch.object(mygames, "_load", lambda: []):
            self.assertIn("error", mygames.add_folder("x", _files=[]))


class EveryFeatureZipTests(unittest.TestCase):
    def test_feature_files(self):
        import package_app as pa
        a = mock.Mock(with_wheels=False)
        kokoro = plugins.BY_ID["kokoro"]
        files = pa.feature_files(kokoro, a, tempfile.gettempdir())
        on_pc = [f for f in kokoro["files"] if os.path.isfile(os.path.join(ROOT, *f["path"].split("/")))]
        self.assertEqual(len(files), len(on_pc))
        kitchen = pa.feature_files(plugins.BY_ID["kitchen"], a, tempfile.gettempdir())             # its own code
        self.assertEqual(sorted(pa.rel(f) for f in kitchen), ["skills/baking.py", "ui/baking.js"])
        self.assertFalse(pa.wanted("ui/baking.js", a))                    # ...so it isn't in the app zip
        self.assertFalse(pa.wanted("brain/missions.py", a))
        self.assertTrue(pa.wanted("ui/electronics/gizmo3d.js", a))        # shared with the Builder: stays in the app
        self.assertTrue(pa.wanted("brain/mind.py", a))                    # the chat uses it: stays in the app

    def test_wheel_names(self):
        import package_app as pa
        self.assertEqual(pa._wheel_dist("faiss_cpu-1.9.0-cp313-cp313-win_amd64.whl"), "faiss-cpu")
        self.assertEqual(pa._wheel_dist("et_xmlfile-2.0.0-py3-none-any.whl"), "et-xmlfile")
        self.assertEqual(pa._wheel_dist("antlr4-python3-runtime-4.9.3.tar.gz"), "antlr4-python3-runtime")


class CodeFeatureTests(unittest.TestCase):
    """a code-only feature (Cooking): Uninstall deletes its code, Install brings it back from its Drive zip"""
    def setUp(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        self.app = os.path.join(d, "app")
        for rel_path in plugins.BY_ID["kitchen"]["code"]:
            path = os.path.join(self.app, *rel_path.split("/"))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w") as f:
                f.write("current " + rel_path)
        for p in (mock.patch.object(plugins, "BASE", self.app), mock.patch.object(plugins, "PACKS", os.path.join(self.app, "plugin_packs")),
                  mock.patch.object(plugins, "STATE_FILE", os.path.join(d, "state.json")),
                  mock.patch.object(plugins, "links", lambda: {"kitchen": "https://drive.google.com/file/d/1KitchenKKKKKKKKKKKKKK/view"}),
                  mock.patch.object(plugins, "_dists", lambda: {}), mock.patch.object(plugins, "status", lambda: {}),
                  mock.patch.object(plugins, "on_event", None), mock.patch("builtins.print")):
            p.start()
            self.addCleanup(p.stop)

    def code(self, rel_path):
        path = os.path.join(self.app, *rel_path.split("/"))
        if not os.path.exists(path):
            return None
        with open(path) as f:
            return f.read()

    def drive_zip(self, url, dest, progress=None):
        with zipfile.ZipFile(dest, "w") as z:
            for rel_path in plugins.BY_ID["kitchen"]["code"]:
                z.writestr(rel_path, "drive " + rel_path)
        return dest

    def reinstall(self):
        plugins._jobs["kitchen"] = {"state": "running", "log": []}
        with mock.patch.object(gdrive, "download", self.drive_zip):
            plugins._install_now(plugins.BY_ID["kitchen"])
        self.assertEqual(plugins._jobs["kitchen"]["state"], "done", plugins._jobs["kitchen"]["log"])

    def test_friends_copy(self):
        self.assertTrue(plugins.is_installed("kitchen"))
        r = plugins.uninstall("kitchen")
        self.assertIn("uninstalled", r["message"])
        self.assertIsNone(self.code("skills/baking.py"))                  # really gone
        self.assertFalse(plugins.is_installed("kitchen"))
        self.reinstall()
        self.assertEqual(self.code("ui/baking.js"), "drive ui/baking.js")  # came back from Drive
        self.assertFalse(os.path.exists(plugins._pack_path(plugins.BY_ID["kitchen"])))   # no zip left on the PC

    def test_your_project_keeps_your_newer_code(self):
        os.makedirs(os.path.join(self.app, "_archive"))                   # the folder you build from
        plugins.uninstall("kitchen")
        self.assertIsNone(self.code("skills/baking.py"))
        self.reinstall()
        self.assertEqual(self.code("skills/baking.py"), "current skills/baking.py")
        self.assertFalse(os.path.isdir(plugins._backup_dir(plugins.BY_ID["kitchen"])))

    def test_missing_module_stand_in(self):
        import optional
        m = optional.load("no_such_feature_xyz")
        self.assertFalse(m)
        self.assertEqual(list(m.list_missions()), [])
        m.on_change = print                                                # ignored, no error
        self.assertFalse(m.CodingAgent(approve=None).set_workspace("x"))
        self.assertIs(optional.load("json").__name__, "json")

    def test_tool_says_install_it(self):
        import tools
        with mock.patch.dict(tools._ACTIONS, {"cook": (lambda: __import__("baking_gone_xyz"), None)}),                 mock.patch.dict(plugins.BY_ID["kitchen"], {"code": ["skills/baking_gone_xyz.py"]}):
            self.assertIn("Cooking & Baking isn't installed", tools.run_tool("cook", "{}"))


def fake_dist(name, version, requires=(), record=()):
    d = mock.Mock(version=version, metadata={"Name": name}, req_names=[plugins._norm(r) for r in requires])
    d.read_text = lambda f: "\n".join(f"{p},sha256=x,{s}" for p, s in record) + "\nx.dist-info/RECORD,,"
    return d


class RemoveCompletelyTests(unittest.TestCase):
    """Uninstall takes a feature's packages AND what they pulled in (not the core's, not another installed feature's)"""
    def setUp(self):
        self.dists = {
            "openpyxl": fake_dist("openpyxl", "3.1.5", ["et-xmlfile"], [("openpyxl/a.py", 8_000_000)]),
            "et-xmlfile": fake_dist("et_xmlfile", "2.0.0", [], [("et_xmlfile/b.py", 2_000_000)]),
            "requests": fake_dist("requests", "2.32", ["urllib3"]), "urllib3": fake_dist("urllib3", "2"),
            "pypdf": fake_dist("pypdf", "5", ["et-xmlfile"]),
        }
        for p in (mock.patch.object(plugins, "_dists", lambda: dict(self.dists)),
                  mock.patch.object(plugins, "keep_pip", lambda: ["requests"]),
                  mock.patch.object(plugins, "on_event", None), mock.patch("builtins.print"),
                  mock.patch.object(plugins, "_pkg_mb", {})):          # real sizes read by other tests don't leak in
            p.start()
            self.addCleanup(p.stop)

    def test_its_packages_and_what_they_pulled_in(self):
        gym = plugins.BY_ID["gym"]
        self.assertEqual(plugins.own_packages(gym, installed={"gym"}), ["et-xmlfile", "openpyxl"])
        self.assertEqual(plugins.own_packages(gym, installed={"gym", "study"}), ["openpyxl"])      # study's pypdf needs et-xmlfile
        self.assertEqual(plugins._pkgs_size(["openpyxl", "et-xmlfile"], self.dists), 10_000_000)

    def test_uninstall_frees_the_packages(self):
        ran = []
        with mock.patch.object(plugins, "_pip", lambda args, pid, *a, **k: ran.append(args)), \
                mock.patch.object(plugins, "is_installed", lambda pid: pid == "gym"), \
                mock.patch.object(plugins, "_set", lambda pid, on: None):
            r = plugins.uninstall("gym", force=True)
        self.assertEqual(ran, [["uninstall", "-y", "et-xmlfile", "openpyxl"]])
        self.assertIn("freed about 10 MB", r["message"])


class BuiltInPartTests(unittest.TestCase):
    """voices, Chatterbox, RVC, Kokoro, voice commands, UniMate, the camera and the AIs are part of Vermeil:
    never a plugin card, never uninstalled, set up by themselves on start"""
    def test_only_sidebar_features_are_plugins(self):
        ids = {p["id"] for p in plugins.status()["plugins"]}
        for b in ("voice_commands", "kokoro", "emotional_voice", "voice_clone", "unimate", "online_voices", "camera", "local_ai"):
            self.assertNotIn(b, ids)
            self.assertTrue(plugins.is_installed(b))
        self.assertIn("gym", ids)
        self.assertEqual(ids, {p["id"] for p in plugins.FEATURES})

    def test_installed_packages_with_other_import_names_count(self):
        # faiss-cpu imports as "faiss", chatterbox-tts as "chatterbox": they used to look missing, so the
        # setup bar ran on every start
        import importlib.metadata
        self.assertEqual(plugins.IMPORT_NAME["faiss-cpu"], "faiss")
        with mock.patch("importlib.util.find_spec", lambda n: None), \
                mock.patch.object(importlib.metadata, "version", lambda n: "1.0"):
            self.assertTrue(plugins.has_module("some-odd-package"))
        with mock.patch("importlib.util.find_spec", lambda n: None):
            self.assertFalse(plugins.has_module("surely-not-installed-xyz"))

    def test_a_normal_ollama_install_counts(self):
        with mock.patch.object(plugins, "_ollama", lambda: r"C:\Users\me\AppData\Local\Programs\Ollama\ollama.exe"):
            self.assertFalse(plugins._files_missing(plugins.BY_ID["local_ai"]))
        with mock.patch.object(plugins, "_ollama", lambda: None):
            self.assertTrue(plugins._files_missing(plugins.BY_ID["local_ai"]))

    def test_cant_uninstall_or_install_a_builtin(self):
        self.assertIn("error", plugins.uninstall("emotional_voice", force=True))
        r = plugins.install_many(["emotional_voice"])
        self.assertEqual(r["started"], 0)

    def test_builtin_packages_are_kept(self):
        keep = {plugins._norm(x) for x in plugins.keep_pip()}
        for x in plugins.BY_ID["emotional_voice"].get("pip", []):
            self.assertIn(plugins._norm(x), keep)

    def test_setup_builtins_installs_what_is_missing(self):
        done, steps = [], []
        chatter = plugins.BY_ID["emotional_voice"]
        with mock.patch.object(plugins, "builtins_missing", lambda: [chatter]),                 mock.patch.object(plugins, "_install_now", lambda p: (done.append(p["id"]), plugins._jobs[p["id"]].update(state="done"))), mock.patch("builtins.print"):
            names = plugins.setup_builtins(lambda *a, **k: steps.append(a))
        self.assertEqual(done, ["emotional_voice"])
        self.assertTrue(names)
        self.assertIsNone(plugins._progress_hook)                     # put back afterwards

    def test_setup_builtins_reports_failures(self):
        chatter = plugins.BY_ID["emotional_voice"]
        def boom(p):
            raise RuntimeError("no internet")
        with mock.patch.object(plugins, "builtins_missing", lambda: [chatter]),                 mock.patch.object(plugins, "_install_now", boom), mock.patch("builtins.print"):
            with self.assertRaises(RuntimeError):
                plugins.setup_builtins(lambda *a, **k: None)


if __name__ == "__main__":
    unittest.main()
