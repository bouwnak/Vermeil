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

    def test_default_roots_include_onedrive(self):
        os.makedirs(os.path.join(self.home, "OneDrive", "Desktop"))
        roots = cleanup.default_roots(self.home)
        self.assertIn(self.dl, roots)
        self.assertIn(os.path.join(self.home, "OneDrive", "Desktop"), roots)


if __name__ == "__main__":
    unittest.main()
