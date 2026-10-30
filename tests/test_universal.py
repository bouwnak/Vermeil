"""Universal update: low-end PC mode, practice partner, sharing characters, the phone app, Mac/Linux bits."""
import io, json, os, sys, tempfile, threading, unittest, urllib.request, urllib.error, wave, zipfile
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import folders  # noqa: E402,F401  (finds brain/, senses/, skills/, scripts/)
import sandbox  # noqa: E402,F401  (keeps the tests away from your real logins, keys and installs)

import machine, partner, charshare, phone  # noqa: E402
import voice_commands as vc  # noqa: E402


class MachineTests(unittest.TestCase):
    def test_tiers(self):
        self.assertEqual(machine.tier({"ram_gb": 4, "cores": 4, "gpu": ""}), "low")
        self.assertEqual(machine.tier({"ram_gb": 8, "cores": 2, "gpu": ""}), "low")
        self.assertEqual(machine.tier({"ram_gb": 7.8, "cores": 4, "gpu": "Intel UHD"}), "low")
        self.assertEqual(machine.tier({"ram_gb": 7.8, "cores": 4, "gpu": "NVIDIA GeForce GTX 1650", "vram_gb": 4}), "normal")
        self.assertEqual(machine.tier({"ram_gb": 16, "cores": 8, "gpu": "Intel Iris"}), "normal")
        self.assertEqual(machine.tier({"ram_gb": 15.7, "cores": 6, "gpu": "NVIDIA GeForce RTX 3050 Laptop GPU", "vram_gb": 4}), "high")
        self.assertEqual(machine.tier({"ram_gb": 16, "cores": 8, "gpu": "Apple Silicon"}), "high")

    def test_battery_and_forced_modes(self):
        info = {"ram_gb": 16, "cores": 8, "gpu": "Apple Silicon", "tier": "high", "battery": 15, "plugged": False}
        self.assertEqual(machine.choose("auto", info), "low")
        self.assertIn("Battery at 15%", machine.why("auto", info))
        self.assertEqual(machine.choose("auto", {**info, "plugged": True}), "high")
        self.assertEqual(machine.choose("normal", info), "normal")

    def test_scan_never_crashes(self):
        info = machine.scan()
        self.assertIn(info["tier"], ("low", "normal", "high"))
        self.assertTrue(info["system"])


class PartnerTests(unittest.TestCase):
    def test_split_reply(self):
        fix, talk = partner.split_reply("✏️ **Corrections:** 私は → 私が (ga marks the subject)\n\nいいですね！週末は何をしましたか？")
        self.assertIn("私が", fix)
        self.assertTrue(talk.startswith("いいですね"))
        self.assertEqual(partner.split_reply("こんにちは！"), ("", "こんにちは！"))

    def test_spoken_correction_has_no_foreign_script(self):
        said = partner.spoken_correction("**watashi wa** (私は) → **watashi ga** (私が): ga marks the subject")
        self.assertNotIn("私", said)
        self.assertNotIn("*", said)
        self.assertIn("should be", said)

    def test_stop_words(self):
        for t in ("stop practice", "end the conversation", "i'm done", "bye"):
            self.assertTrue(partner.STOP.search(t), t)
        self.assertFalse(partner.STOP.search("I stop at the station before practice"))

    def test_voice_turns_and_quiet_end(self):
        said, emitted = [], []
        heard = iter(["konnichiwa", None, None, None, None])
        p = partner.Partner(emitted.append, lambda: next(heard, None), lambda t: said.append(("native", t)),
                            lambda t, lang: said.append((lang, t)))
        fake_mind = mock.MagicMock()
        fake_mind.practice_start.return_value = {"id": "s1", "messages": [{"role": "assistant", "content": "こんにちは！"}]}
        fake_mind.practice_reply.return_value = {"id": "s1", "messages": [{"role": "assistant",
                                                 "content": "✏️ Corrections: konnichiwa → こんにちは\n\nげんきですか？"}]}
        fake_mind.practice_finish.return_value = {"score": "7/10"}
        fake_sensei = mock.MagicMock(LANGS={"ja": "Japanese"})
        fake_sensei._state.return_value = {"language": "ja", "level": 2}
        with mock.patch.dict(sys.modules, {"mind": fake_mind, "sensei": fake_sensei}):
            out = p.start("ja", 2, "", by_voice=False)
            self.assertEqual(out["name"], "Japanese")
            p._loop("こんにちは！")
        self.assertFalse(p.active)
        self.assertIn(("ja", "こんにちは！"), said)
        self.assertIn(("ja", "げんきですか？"), said)
        self.assertTrue(any(w == "native" and "Small fix" in t for w, t in said))
        self.assertEqual([e["event"] for e in emitted if e.get("type") == "partner"], ["start", "turn", "stop"])


class ShareTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.models = os.path.join(self.tmp, "models")
        os.makedirs(self.models)
        with open(os.path.join(self.models, "Robo.glb"), "wb") as f:
            f.write(b"glTF" + b"\0" * 60)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_roundtrip(self):
        char = {"id": "x1", "name": "Robo", "prompt": "Beep.", "voice": "piper:en_US-amy-medium", "model": "Robo.glb",
                "memory_key": "secret-memory", "rvc": None}
        out = os.path.join(self.tmp, charshare.file_name(char))
        res = charshare.export_character(char, out, self.models)
        self.assertTrue(res["has_model"])
        with zipfile.ZipFile(out) as z:
            data = json.loads(z.read(charshare.MANIFEST))
        self.assertNotIn("memory_key", data["character"])        # her memories of you never leave this PC
        self.assertNotIn("id", data["character"])
        friend = os.path.join(self.tmp, "friend_models")
        got = charshare.import_character(out, friend)
        self.assertEqual(got["name"], "Robo")
        self.assertEqual(got["model"], "Robo.glb")
        self.assertTrue(os.path.isfile(os.path.join(friend, "Robo.glb")))
        self.assertEqual(got["notes"], ["3D model"])

    def test_rejects_fake_model_and_paths(self):
        bad = os.path.join(self.tmp, "bad.vermeil")
        with zipfile.ZipFile(bad, "w") as z:
            z.writestr(charshare.MANIFEST, json.dumps({"format": 1, "character": {"name": "Evil", "model": "../../evil.glb"}}))
            z.writestr("model/evil.glb", b"MZ not a model")
            z.writestr("../../escape.txt", b"x")
        with self.assertRaises(ValueError):
            charshare.import_character(bad, os.path.join(self.tmp, "m2"))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "..", "escape.txt")))
        with self.assertRaises(ValueError):
            charshare.import_character(os.path.join(self.models, "Robo.glb"), self.models)


class PhoneServerTests(unittest.TestCase):
    KEY = "k" * 32

    @classmethod
    def setUpClass(cls):
        cls.calls = []
        handlers = {"chat": lambda p: cls.calls.append(p) or {"reply": "hi " + p["text"]},
                    "shortcut": lambda p: "plain " + p["text"],
                    "speak": lambda p: (phone.wav_bytes([0.0, 0.5, -0.5], 16000), "audio/wav"),
                    "hear": lambda p: {"size": len(p["audio"]), "type": p["type"]}}
        cls.srv = phone.PhoneServer(handlers, port=0, key=cls.KEY)
        cls.port = cls.srv.start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()

    def req(self, path, body=b"", key=KEY, ctype="application/json", method="POST"):
        r = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=body if method == "POST" else None, method=method)
        if key:
            r.add_header("X-Vermeil-Key", key)
        r.add_header("Content-Type", ctype)
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, resp.headers.get("Content-Type"), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Content-Type"), e.read()

    def test_needs_the_key(self):
        self.assertEqual(self.req("/api/chat", b'{"text":"x"}', key=None)[0], 401)
        self.assertEqual(self.req("/api/chat", b'{"text":"x"}', key="wrong" * 8)[0], 401)
        self.srv._fails = []

    def test_chat_and_shortcut(self):
        code, _, body = self.req("/api/chat", json.dumps({"text": "there"}).encode())
        self.assertEqual((code, json.loads(body)["reply"]), (200, "hi there"))
        code, ctype, body = self.req("/api/shortcut", "what time is it".encode(), ctype="text/plain")
        self.assertEqual(body.decode(), "plain what time is it")
        self.assertTrue(ctype.startswith("text/plain"))

    def test_audio_both_ways(self):
        code, ctype, body = self.req("/api/speak", b"{}")
        self.assertEqual(ctype, "audio/wav")
        with wave.open(io.BytesIO(body)) as w:
            self.assertEqual((w.getframerate(), w.getnframes()), (16000, 3))
        code, _, body = self.req("/api/hear", b"\x1aE\xdf\xa3" * 10, ctype="audio/webm")
        self.assertEqual(json.loads(body), {"size": 40, "type": "audio/webm"})

    def test_limits_and_unknown(self):
        self.assertEqual(self.req("/api/nope", b"{}")[0], 404)
        self.assertEqual(self.req("/api/chat", b"[1,2]")[0], 400)
        self.assertEqual(self.req("/api/chat", b"x" * (phone.MAX_JSON + 1))[0], 413)

    def test_serves_only_the_phone_app(self):
        code, ctype, body = self.req("/phone/", method="GET", key=None)
        self.assertEqual(code, 200)
        self.assertIn(b"Connect to Vermeil", body)
        self.assertEqual(self.req("/sw.js", method="GET", key=None)[0], 200)
        for bad in ("/phone/../app.py", "/phone/%2e%2e/app.py", "/data/phone.json", "/phone/phone.py"):
            self.assertEqual(self.req(bad, method="GET", key=None)[0], 404, bad)

    def test_lockout_after_many_wrong_keys(self):
        srv = phone.PhoneServer({}, port=0, key=self.KEY)
        for _ in range(20):
            srv.failed()
        self.assertGreater(srv.locked_until, 0)

    def test_key_is_made_once_and_can_change(self):
        with mock.patch.object(phone, "STATE_FILE", os.path.join(tempfile.mkdtemp(), "phone.json")):
            k = phone.state()["key"]
            self.assertGreaterEqual(len(k), 24)
            self.assertEqual(phone.state()["key"], k)
            self.assertNotEqual(phone.new_key(), k)

    def test_tunnel_finds_the_address(self):
        line = "2026-10-30T01:02:03Z INF |  https://tall-blue-cats-sing.trycloudflare.com  |"
        self.assertEqual(phone.Tunnel.URL_RX.search(line).group(0), "https://tall-blue-cats-sing.trycloudflare.com")
        t = phone.Tunnel("local", 8790)
        got = []
        t.start(got.append)
        self.assertEqual(got, ["http://127.0.0.1:8790"])

    def test_cloudflared_download_name(self):
        asset, exe = phone._cloudflared_asset()
        self.assertTrue(asset.startswith("cloudflared-"))
        self.assertIn(exe, ("cloudflared.exe", "cloudflared"))


class VoiceCommandTests(unittest.TestCase):
    def test_new_commands(self):
        cases = {"let's practice japanese": "partner_start", "talk to me in korean": "partner_start",
                 "stop practice": "partner_stop", "low power mode": "power_low", "full power": "power_full",
                 "scan my pc": "scan", "turn on phone access": "phone_on", "turn off the phone": "phone_off",
                 "share this character": "share_character", "import a character": "import_character"}
        for said, want in cases.items():
            hit = vc.parse(said)
            self.assertIsNotNone(hit, said)
            self.assertEqual(hit[0], want, said)
        self.assertEqual(vc.language_in("let's practice japanese"), "ja")

    def test_help_lists_the_new_features(self):
        ids = {f["id"] for f in vc.catalogue(lambda _: True)}
        self.assertTrue({"phone", "performance"} <= ids)


class CrossPlatformTests(unittest.TestCase):
    def test_open_path_uses_the_system_opener(self):
        import paths
        with mock.patch.object(paths.sys, "platform", "darwin"), mock.patch.object(paths.subprocess, "Popen") as po:
            paths.open_path("/tmp/x")
        self.assertEqual(po.call_args[0][0], ["open", "/tmp/x"])
        with mock.patch.object(paths.sys, "platform", "linux"), mock.patch.object(paths.subprocess, "Popen") as po:
            paths.open_path("/tmp/x")
        self.assertEqual(po.call_args[0][0], ["xdg-open", "/tmp/x"])

    def test_installers_exist_with_unix_endings(self):
        for f in ("INSTALL Mac.command", "INSTALL Linux.sh", "scripts/install.sh"):
            with open(os.path.join(ROOT, f), "rb") as fh:
                data = fh.read()
            self.assertTrue(data.startswith(b"#!"), f)
            self.assertNotIn(b"\r\n", data, f)
        with open(os.path.join(ROOT, "scripts", "install.sh"), encoding="utf-8") as fh:
            sh = fh.read()
        for win_only in ("pycaw", "winotify", "comtypes"):
            self.assertNotIn(win_only, sh)

class IPhoneAppTests(unittest.TestCase):
    """phone-ios/ can only be built on a Mac (GitHub builds it: .github/workflows/ios.yml) - here the parts that must match"""
    IOS = os.path.join(ROOT, "phone-ios")

    def read(self, *parts, base=None):
        with open(os.path.join(base or self.IOS, *parts), encoding="utf-8") as f:
            return f.read()

    def test_background_mic_and_pair_link(self):
        project = self.read("project.yml")
        self.assertIn("UIBackgroundModes: [audio]", project)          # keeps listening with the phone locked
        self.assertIn("CFBundleURLSchemes: [vermeil]", project)       # vermeil://pair?u=...&k=...
        for usage in ("NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"):
            self.assertIn(usage, project)
        js = self.read("ui", "phone", "phone.js", base=ROOT)
        self.assertIn("vermeil://pair?u=${encodeURIComponent(location.origin)}&k=${encodeURIComponent(KEY)}", js)
        pairing = self.read("Vermeil", "Pairing.swift")
        self.assertIn('$0.name == "u"', pairing)
        self.assertIn('$0.name == "k"', pairing)

    def test_same_api_and_wake_words_as_the_web_app(self):
        api = self.read("Vermeil", "VermeilAPI.swift")
        self.assertIn('"X-Vermeil-Key"', api)
        self.assertIn('"X-Vermeil-Key"', self.read("brain", "phone.py", base=ROOT))
        app_py = self.read("app.py", base=ROOT)
        for name in ("hello", "chat", "speak"):
            self.assertIn(f'"{name}": self._phone_', app_py)
            self.assertIn(f'"{name}"', self.read("Vermeil", "AppModel.swift"))
        js = self.read("ui", "phone", "phone.js", base=ROOT)
        swift = self.read("Vermeil", "WakeWord.swift")
        js_list = js.split("vermeil: [", 1)[1].split("]", 1)[0]
        swift_list = swift.split('"vermeil": [', 1)[1].split("]", 1)[0]
        self.assertEqual(js_list, swift_list)

    def test_every_swift_file_is_in_the_app(self):
        files = os.listdir(os.path.join(self.IOS, "Vermeil"))
        for needed in ("VermeilApp.swift", "Listener.swift", "SiriIntents.swift", "AppModel.swift", "Views.swift"):
            self.assertIn(needed, files)
        self.assertTrue(os.path.exists(os.path.join(self.IOS, "Vermeil", "Assets.xcassets", "AppIcon.appiconset", "icon-1024.png")))


if __name__ == "__main__":
    unittest.main()

class AndroidAppTests(unittest.TestCase):
    """android/ is built by GitHub (.github/workflows/android.yml) - here the parts that must match the web app"""
    APP = os.path.join(ROOT, "android", "app", "src")

    def read(self, *parts, base=None):
        with open(os.path.join(base or self.APP, *parts), encoding="utf-8") as f:
            return f.read()

    def kt(self, name):
        return self.read("main", "java", "com", "vermeil", "phone", name)

    def test_listens_in_the_background_and_opens_pair_links(self):
        manifest = self.read("main", "AndroidManifest.xml")
        for needed in ('android:foregroundServiceType="microphone"', "FOREGROUND_SERVICE_MICROPHONE", "RECORD_AUDIO",
                       'android:scheme="vermeil" android:host="pair"', "android.intent.action.ASSIST",
                       "android.speech.RecognitionService"):
            self.assertIn(needed, manifest)
        pairing = self.kt("Pairing.kt")
        self.assertIn('query["u"]', pairing)
        self.assertIn('query["k"]', pairing)
        self.assertIn("Android", self.read("ui", "phone", "phone.js", base=ROOT).split('$("nativeCard").hidden', 1)[1][:80])

    def test_same_api_and_wake_words_as_the_web_app(self):
        self.assertIn('"X-Vermeil-Key"', self.kt("VermeilApi.kt"))
        hub = self.kt("Hub.kt")
        for name in ("hello", "chat", "speak"):
            self.assertIn(f'"{name}"', hub)
        js = self.read("ui", "phone", "phone.js", base=ROOT)
        js_list = js.split("vermeil: [", 1)[1].split("]", 1)[0]
        kt_list = self.kt("WakeWord.kt").split('"vermeil" to listOf(', 1)[1].split(")", 1)[0]
        self.assertEqual(js_list, kt_list)

    def test_built_and_published_by_github(self):
        ci = self.read(".github", "workflows", "android.yml", base=ROOT)
        self.assertIn("assembleDebug", ci)
        self.assertIn("testDebugUnitTest", ci)
        self.assertIn("releases/tag/android-app", self.read("android", "README.md", base=ROOT))
        for d in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
            self.assertTrue(os.path.exists(os.path.join(self.APP, "main", "res", f"mipmap-{d}", "ic_launcher.png")))
