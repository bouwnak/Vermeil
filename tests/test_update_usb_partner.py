"""Settings -> Update (skills/updater.py), Study -> USB drives and video lectures (skills/academic.py),
the Talk live game's reply split (brain/partner.py) and UniMate's missing-library repair (skills/animate.py)"""
import io, os, shutil, sys, tempfile, unittest, zipfile
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401
import academic  # noqa: E402
import animate  # noqa: E402
import partner  # noqa: E402
import updater  # noqa: E402


def _zip(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            z.writestr("Vermeil-main/" + name, text)
    return buf.getvalue()


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.root, "data"))
        for rel, text in {"app.py": "old", "env": "MY KEYS", "data/settings.json": "mine", "notes.txt": "only here"}.items():
            with open(os.path.join(self.root, *rel.split("/")), "w", encoding="utf-8") as f:
                f.write(text)
        self.p = [mock.patch.object(updater, "ROOT", self.root),
                  mock.patch.object(updater, "VERSION_FILE", os.path.join(self.root, "data", "version.json"))]
        for p in self.p:
            p.start()

    def tearDown(self):
        for p in self.p:
            p.stop()
        shutil.rmtree(self.root, ignore_errors=True)

    def read(self, rel):
        with open(os.path.join(self.root, *rel.split("/")), encoding="utf-8") as f:
            return f.read()

    def test_new_files_in_your_things_kept(self):
        blob = _zip({"app.py": "new", "env": "THEIR KEYS", "data/settings.json": "default", "data/new.json": "{}",
                     "skills/x.py": "x", "dnd/art.png": "no"})
        changed = updater.install_zip(blob, "abc123")
        self.assertEqual(self.read("app.py"), "new")
        self.assertEqual(self.read("env"), "MY KEYS")                    # your keys
        self.assertEqual(self.read("data/settings.json"), "mine")        # your settings
        self.assertEqual(self.read("data/new.json"), "{}")               # new data files do come
        self.assertEqual(self.read("notes.txt"), "only here")            # nothing is deleted
        self.assertFalse(os.path.exists(os.path.join(self.root, "dnd")))  # the asset library is never touched
        self.assertEqual(changed, 3)
        with mock.patch.object(updater, "is_git", return_value=False):
            self.assertEqual(updater.current(), "abc123")
        self.assertEqual(updater.install_zip(blob), 0)                   # same again: nothing changes

    def test_branch_from_the_zip_folder_name(self):
        with mock.patch.object(updater, "is_git", return_value=False), \
                mock.patch.object(updater, "ROOT", os.path.join(self.root, "Vermeil-voice-gpu-and-setup-fix")):
            self.assertEqual(updater.branch(), "voice-gpu-and-setup-fix")
        with mock.patch.object(updater, "is_git", return_value=False):
            self.assertEqual(updater.branch(), updater.DEFAULT_BRANCH)

    def test_already_up_to_date(self):
        with mock.patch.object(updater, "latest", return_value=("abc", "msg")), \
                mock.patch.object(updater, "current", return_value="abc"):
            self.assertEqual(updater.update()["changed"], 0)

    def test_no_internet_is_an_error_not_a_crash(self):
        with mock.patch.object(updater, "latest", side_effect=OSError("offline")):
            self.assertIn("Couldn't reach GitHub", updater.update()["error"])


class StudyUsbTests(unittest.TestCase):
    def test_scan_finds_documents_and_videos(self):
        d = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(d, "Week 1"))
            os.makedirs(os.path.join(d, "System Volume Information"))
            for rel, size in {"Week 1/lecture.mp4": 10, "Week 1/slides.pdf": 10, "notes.docx": 10, "icon.png": 10,
                              "photo of board.jpg": 40_000, "song.exe": 10, "~$notes.docx": 10,
                              "System Volume Information/x.pdf": 10}.items():
                with open(os.path.join(d, *rel.split("/")), "wb") as f:
                    f.write(b"x" * size)
            found = {f["name"]: f for f in academic.scan_folder(d)}
            self.assertEqual(set(found), {"lecture.mp4", "slides.pdf", "notes.docx", "photo of board.jpg"})
            self.assertTrue(found["lecture.mp4"]["video"])
            self.assertFalse(found["slides.pdf"]["video"])
            self.assertEqual(found["slides.pdf"]["folder"], "Week 1")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_drives_listing_never_crashes(self):
        self.assertIsInstance(academic.removable_drives(), list)

    def test_video_lecture_is_written_down_with_times(self):
        seg = lambda a, b, t: mock.Mock(start=a, end=b, text=t)
        model = mock.Mock()
        model.transcribe.return_value = ([seg(0, 5, "Today: beams."), seg(310, 320, "Shear diagrams."), seg(330, 340, " ")], None)
        fake_stt = mock.Mock(load=mock.Mock(return_value=model))
        fake_fw = mock.Mock(decode_audio=mock.Mock(return_value=[0.0] * 16000 * 400))
        with mock.patch.dict(sys.modules, {"stt": fake_stt, "faster_whisper": fake_fw}):
            pages = academic.transcribe_media("lecture.mp4")
        self.assertEqual(pages, ["[0:00] Today: beams.", "[5:10] Shear diagrams."])
        self.assertTrue(academic.is_media("A.MP4"))
        self.assertFalse(academic.is_media("a.pdf"))


class TalkLiveTests(unittest.TestCase):
    def test_corrections_first_or_in_the_middle(self):
        self.assertEqual(partner.split_reply("✏️ Corrections: a → b\n\nいいね！"), ("a → b", "いいね！"))
        fix, talk = partner.split_reply("こんにちは！ ✏️ Corrections: 見ます → 見ました\n\n何を見ましたか？")
        self.assertEqual(fix, "見ます → 見ました")
        self.assertEqual(talk, "こんにちは！\n\n何を見ましたか？")
        self.assertEqual(partner.split_reply("いいね！"), ("", "いいね！"))


class UniMateLibraryTests(unittest.TestCase):
    def test_missing_module_means_reinstall(self):
        d = tempfile.mkdtemp()
        try:
            env = os.path.join(d, "env")
            site = os.path.join(env, "Lib", "site-packages")
            os.makedirs(site)
            py = os.path.join(env, "python.exe")
            with mock.patch.object(animate, "env_python", return_value=py), \
                    mock.patch.object(animate, "LIBS_MISSING", os.path.join(d, "missing.txt")):
                self.assertFalse(animate.libraries_installed())
                for n in animate.KEY_LIBS:
                    (os.makedirs if "." not in n else lambda p: open(p, "w").close())(os.path.join(site, n))
                self.assertTrue(animate.libraries_installed())
                with open(os.path.join(d, "missing.txt"), "w") as f:      # a run said "No module named ..."
                    f.write("Quaternions")
                self.assertFalse(animate.libraries_installed())
                animate.libraries_fixed()
                self.assertTrue(animate.libraries_installed())
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
