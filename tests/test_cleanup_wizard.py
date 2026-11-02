"""The clean-up wizard (skills/cleanup.py): big files, old downloads and duplicates in temp folders. Nothing is really
moved to the Recycle Bin: the trash function is faked."""
import os, shutil, sys, tempfile, time, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import folders  # noqa: E402,F401
import sandbox  # noqa: E402,F401
import cleanup  # noqa: E402

MB = 1024 * 1024


class WizardTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="vermeil-clean-")
        self.addCleanup(shutil.rmtree, self.home, True)
        self.dl = os.path.join(self.home, "Downloads")
        self.docs = os.path.join(self.home, "Documents")
        for d in (self.dl, self.docs, os.path.join(self.docs, "dnd"), os.path.join(self.docs, "MyVoice")):
            os.makedirs(d)
        self.now = time.time()
        self.f("Downloads/big.bin", 3 * MB)
        self.f("Downloads/old.txt", 10, age=200)
        self.f("Downloads/new.txt", 10, age=5)
        self.f("Documents/song.mp3", 2 * MB, data=b"a", age=50)
        self.f("Downloads/song (1).mp3", 2 * MB, data=b"a", age=3)
        self.f("Documents/other.mp3", 2 * MB, data=b"b")
        self.f("Documents/dnd/map.png", 5 * MB)                          # the asset library: never looked at
        self.f("Documents/MyVoice/model.pth", 5 * MB)                    # a voice model folder: never looked at
        self.f("Documents/MyVoice/song (2).mp3", 2 * MB, data=b"a")

    def f(self, rel, size, data=b"x", age=0):
        p = os.path.join(self.home, *rel.split("/"))
        with open(p, "wb") as fh:
            fh.write(data * size)
        if age:
            t = self.now - age * 86400
            os.utime(p, (t, t))
        return p

    def scan(self):
        return cleanup.scan([self.dl, self.docs], big_mb=3, old_days=90, now=self.now, downloads=self.dl)

    def test_finds_big_old_and_duplicates(self):
        r = self.scan()
        self.assertEqual([x["name"] for x in r["big"]], ["big.bin"])
        self.assertEqual([x["name"] for x in r["old"]], ["old.txt"])
        self.assertEqual(len(r["dups"]), 1)
        self.assertEqual(r["dups"][0]["keep"]["name"], "song.mp3")               # the oldest copy stays
        self.assertEqual([x["name"] for x in r["dups"][0]["extra"]], ["song (1).mp3"])
        names = [x["name"] for x in r["big"] + r["old"]] + [x["name"] for g in r["dups"] for x in g["extra"]]
        self.assertNotIn("map.png", names)
        self.assertNotIn("song (2).mp3", names)

    def test_only_scanned_and_unchanged_files_go(self):
        r = self.scan()
        gone = []
        big, old = r["big"][0], r["old"][0]
        with open(old["path"], "ab") as fh:                                     # changed after the scan
            fh.write(b"more")
        out = cleanup.to_recycle_bin([big["id"], old["id"], "made-up"], trash=gone.append)
        self.assertEqual(gone, [big["path"]])
        self.assertEqual(out["moved"], 1)
        self.assertEqual({f["id"] for f in out["failed"]}, {old["id"], "made-up"})
        self.assertEqual(cleanup.to_recycle_bin([big["id"]], trash=gone.append)["moved"], 0)   # not twice

    def test_vermeils_folder_is_skipped(self):
        self.assertTrue(cleanup._protected_dir(cleanup.BASE_DIR, []))
        self.assertTrue(cleanup._protected_dir(os.path.join(self.home, "x"), ["voice.index"]))
        self.assertFalse(cleanup._protected_dir(self.dl, ["a.txt"]))

    # ---------- every drive ----------
    def scan_all(self, **k):
        return cleanup.scan([self.home], big_mb=k.pop("big_mb", 3), everything=True, unused_days=30, now=self.now, downloads=self.dl, **k)

    def test_finds_big_and_unused_files_anywhere(self):
        with __import__("unittest.mock").mock.patch.object(cleanup, "MIN_UNUSED_MB", 1):
            self.f("Documents/ancient.iso", 2 * MB, age=400)
            r = self.scan_all()
        self.assertIn("big.bin", [x["name"] for x in r["big"]])
        unused = {x["name"]: x for x in r["unused"]}
        self.assertEqual(unused["ancient.iso"]["unused_days"], 400)
        self.assertNotIn("big.bin", unused)                                     # used today

    def test_system_files_and_folders_are_never_listed(self):
        os.makedirs(os.path.join(self.home, "Windows"))
        self.f("Windows/huge.dat", 5 * MB)
        self.f("pagefile.sys", 5 * MB)
        names = [x["name"] for x in self.scan_all()["big"]]
        self.assertNotIn("huge.dat", names)
        self.assertNotIn("pagefile.sys", names)
        self.assertNotIn("map.png", names)                                      # the dnd folder
        self.assertNotIn("model.pth", names)                                    # a voice model

    def test_installed_apps_are_pointed_out_but_cant_be_removed(self):
        os.makedirs(os.path.join(self.home, "SteamLibrary", "steamapps", "common", "Game"))
        p = self.f("SteamLibrary/steamapps/common/Game/data.pak", 5 * MB)
        r = self.scan_all()
        self.assertNotIn("data.pak", [x["name"] for x in r["big"]])
        app = next(x for x in r["apps"] if x["name"] == "data.pak")
        gone = []
        out = cleanup.to_recycle_bin([app["id"]], trash=gone.append)            # not even if something asks for it
        self.assertEqual((gone, out["moved"]), ([], 0))
        self.assertTrue(os.path.exists(p))

    def test_app_data_only_its_throwaway_folders(self):
        self.assertTrue(cleanup.in_app(r"C:\Users\x\AppData\Roaming\App\save.dat"))
        self.assertFalse(cleanup.in_app(r"C:\Users\x\AppData\Local\Temp\junk.tmp"))
        self.assertFalse(cleanup.in_app(r"C:\Users\x\AppData\Local\App\Cache\blob"))
        self.assertTrue(cleanup.in_app(r"D:\Program Files\App\app.dat"))
        self.assertFalse(cleanup.in_app(r"D:\Movies\film.mkv"))

    def test_a_big_unused_folder_is_offered_whole(self):
        os.makedirs(os.path.join(self.home, "OldProject", "assets"))
        for i in range(3):
            self.f(f"OldProject/assets/part{i}.bin", 2 * MB, data=bytes([65 + i]), age=300)
        r = self.scan_all(big_mb=5)
        folder = next(x for x in r["folders"] if x["name"] == "OldProject")
        self.assertTrue(folder["is_folder"])
        self.assertEqual(folder["mb"], 6.0)
        self.assertNotIn("assets", [x["name"] for x in r["folders"]])           # only the top one
        gone = []
        self.assertEqual(cleanup.to_recycle_bin([folder["id"]], trash=gone.append)["moved"], 1)
        self.assertEqual(gone, [folder["path"]])

    def test_comparing_a_file_doesnt_count_as_using_it(self):
        p = self.f("Documents/keepdate.bin", 2 * MB, age=300)
        before = os.stat(p).st_atime_ns
        cleanup._hash(p)
        self.assertEqual(os.stat(p).st_atime_ns, before)

    def test_desktop_ini_doesnt_keep_a_folder_from_being_offered(self):
        os.makedirs(os.path.join(self.home, "OldStuff"))
        self.f("OldStuff/movie.mkv", 6 * MB, age=300)
        self.f("OldStuff/desktop.ini", 10)                                      # written today, by Windows
        self.assertIn("OldStuff", [x["name"] for x in self.scan_all(big_mb=5)["folders"]])

    def test_a_folder_in_use_isnt_offered(self):
        os.makedirs(os.path.join(self.home, "Active"))
        self.f("Active/old.bin", 6 * MB, age=300)
        self.f("Active/today.txt", 10)
        self.assertNotIn("Active", [x["name"] for x in self.scan_all(big_mb=5)["folders"]])

    def test_my_own_top_folders_are_never_offered_whole(self):
        os.makedirs(os.path.join(self.home, "Pictures"))
        self.f("Pictures/a.bin", 6 * MB, age=300)
        self.assertNotIn("Pictures", [x["name"] for x in self.scan_all(big_mb=5)["folders"]])

    def test_usb_files_say_they_go_for_good(self):
        drive = os.path.splitdrive(self.home)[0].upper()
        cleanup._usb.add(drive)
        self.addCleanup(cleanup._usb.clear)
        self.assertTrue(cleanup._row(os.path.join(self.home, "x"), 1, 1, 1)["for_good"])

    def test_it_can_be_stopped(self):
        import unittest.mock as um
        def progress(files, folder):
            cleanup.stop()
        with um.patch.object(cleanup._Scan, "walk", side_effect=lambda p: (cleanup.stop(), (0, 0.0, True))[1]):
            self.assertTrue(self.scan_all(progress=progress)["stopped"])

    def test_default_roots_include_onedrive(self):
        os.makedirs(os.path.join(self.home, "OneDrive", "Desktop"))
        roots = cleanup.default_roots(self.home)
        self.assertIn(self.dl, roots)
        self.assertIn(os.path.join(self.home, "OneDrive", "Desktop"), roots)


if __name__ == "__main__":
    unittest.main()
