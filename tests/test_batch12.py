"""Batch 12 (23 Oct 2026): quest order + sealed paths, levels 1-100 / bosses 100-150, monster allies, party of 6,
floors flush with the ground, Kokoro as the online voice, Settings tabs, the 3D Build Lab designer + firmware,
the Generator, the coding brain and the electronics chat."""
import json
import os
import re
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [ROOT] + [os.path.join(ROOT, d) for d in ("brain", "senses", "skills")]

from game import ai, campaign, world, layout  # noqa: E402
from game.actors import LEVEL_CAP, power, make_monster_ally  # noqa: E402
from game.content import content  # noqa: E402
from game.progression import xp_to_next  # noqa: E402

ai.disable(True)


def new_game(seed=11, genre="fantasy"):
    campaign.SAVE_DIR = tempfile.mkdtemp(prefix="vda_t12_")
    return campaign.Game.new(name="T", species="human", cls_id="warrior", genre=genre, seed=seed, use_ai=False)


class QuestOrderTests(unittest.TestCase):
    def test_places_beyond_the_objective_are_sealed(self):
        g = new_game()
        q = g.camp["quest"]
        goal_col = g.loc(q["stages"][0]["location"])["col"]
        L = g.camp["locations"]
        beyond = [l for l in L.values() if l["col"] > goal_col]
        self.assertTrue(beyond)
        for l in beyond:
            self.assertTrue(g.blocked(l["id"]), l["name"])
        lair = next(l for l in L.values() if l["kind"] == "boss")
        self.assertIn("seals", g.blocked(lair["id"]))

    def test_travel_refuses_a_sealed_place(self):
        g = new_game()
        for l in g.camp["locations"].values():
            if g.blocked(l["id"]):
                g.camp["locations"][g.camp["location"]]["links"].append(l["id"])
                with self.assertRaises(campaign.GameError):
                    g.travel(l["id"])
                return
        self.fail("no sealed place found")

    def test_objective_is_always_on_the_map(self):
        for seed in (1, 2, 3, 77):
            g = new_game(seed)
            m = g.map_public()
            self.assertTrue(any(x["objective"] for x in m), seed)

    def test_explore_needs_a_search_not_just_arriving(self):
        g = new_game()
        st = g.camp["quest"]["stages"][0]
        self.assertEqual(st["kind"], "explore")
        g.camp["location"] = st["location"]
        for e in g.loc()["encounters"]:
            e["done"] = True
        g.loc()["visited"] = True
        g._quest_check()
        self.assertFalse(st["done"])              # standing there isn't enough
        st["explored"] = True
        g._quest_check()
        self.assertTrue(st["done"])

    def test_one_stage_at_a_time(self):
        g = new_game()
        q = g.camp["quest"]
        for st in q["stages"][:2]:
            g.loc(st["location"])["visited"] = True
            for e in g.loc(st["location"])["encounters"]: e["done"] = True
            st["explored"] = True
        g.camp["location"] = q["stages"][0]["location"]
        g._quest_check()
        self.assertEqual(q["current"], 1)          # stage 2 must be done AT stage 2's place, later


class LevelTests(unittest.TestCase):
    def test_level_cap_and_curve(self):
        self.assertEqual(LEVEL_CAP, 100)
        self.assertEqual(content().rules["max_level"], 100)
        self.assertAlmostEqual(power(1), 1)
        self.assertGreater(power(100), 20)
        self.assertGreater(power(150), power(100))
        self.assertLess(power(150) - power(100), 5)          # bosses are tough, not impossible
        self.assertGreater(xp_to_next(50), xp_to_next(10))

    def test_world_levels_and_boss_range(self):
        for seed in range(1, 9):
            g = new_game(seed)
            levels = [l["level"] for l in g.camp["locations"].values()]
            self.assertEqual(min(levels), 1)
            self.assertLessEqual(max(levels), 100)
            self.assertGreater(max(levels), 60)
            self.assertTrue(100 <= g.camp["quest"]["boss"]["level"] <= 150)
            self.assertLessEqual(len(g.camp["quest"]["stages"]), 6)

    def test_old_saves_keep_their_strength(self):
        g = new_game()
        camp = json.loads(json.dumps(g.camp))
        camp.pop("level_scale")
        for p in camp["party"]: p["level"] = 5
        camp["quest"]["boss"]["level"] = 8
        out = campaign.migrate({"save_version": 1, "campaign": camp})
        self.assertEqual(out["party"][0]["level"], 19)
        self.assertAlmostEqual(power(19), 5)
        self.assertEqual(out["level_scale"], 100)

    def test_party_of_six(self):
        self.assertEqual(content().rules["party_size"], 6)


class MonsterAllyTests(unittest.TestCase):
    def _won_battle(self, g, alpha=False):
        e = campaign.make_enemy(g.camp, "goblin" if "goblin" in content().enemies else sorted(content().enemies)[0], 10)
        if alpha: e["alpha"] = True
        return {"defeated": [e["uid"]], "enemies": {e["uid"]: e}}

    def test_chances(self):
        self.assertLess(campaign.Game.ALPHA_JOIN_CHANCE, campaign.Game.MONSTER_JOIN_CHANCE)
        self.assertLessEqual(campaign.Game.MONSTER_JOIN_CHANCE, 0.1)

    def test_join_and_fight_for_you(self):
        g = new_game()
        with mock.patch.object(g.dice, "chance", return_value=True):
            ev = g._monster_join_roll(self._won_battle(g))
        self.assertEqual(ev[0]["type"], "monster_offer")
        ev = g.monster_recruit(True)
        ally = g.camp["party"][-1]
        self.assertEqual((ally["team"], ally["kind"], ally.get("monster")), ("party", "ally", True))
        self.assertTrue(any(e["type"] == "recruit" for e in ev))

    def test_full_party_gets_no_offer(self):
        g = new_game()
        while len(g.camp["party"]) < 6:
            g.camp["party"].append(make_monster_ally(g.camp, campaign.make_enemy(g.camp, sorted(content().enemies)[0], 3)))
        with mock.patch.object(g.dice, "chance", return_value=True):
            self.assertEqual(g._monster_join_roll(self._won_battle(g)), [])


class WorldLookTests(unittest.TestCase):
    def test_floor_tiles_flush_with_ground(self):
        g = new_game(5, "dark")
        for l in g.camp["locations"].values():
            lay = g.layout_for(l["id"])
            for o in lay["objects"]:
                if o.get("k") == "floor":
                    m = content().model(o["a"])
                    top = o["y"] + (m["min"][1] + m["size"][1]) * o["s"]
                    self.assertLess(abs(top), 0.05, (l["biome"], o["a"], top))
        self.assertGreaterEqual(layout.VERSION, 7)

    def test_new_props_and_monsters_exist(self):
        C = content()
        for n in ("throne", "altar", "coffin", "sarcophagus", "brazier", "treasure_pile", "market_stall"):
            self.assertTrue(C.model(f"made_{n}"), n)
        for k in ("troll", "ogre", "vampire", "werewolf", "kobold", "gargoyle", "death_knight"):
            self.assertIn(k, C.enemies)
            self.assertTrue(C.available_models(C.enemies[k]["models"]), k)


class VoiceTests(unittest.TestCase):
    def test_game_companion_without_kokoro_voice_still_uses_kokoro_online(self):
        from game import voices
        camp = {"voices": {"vermeil": {"voice": "piper:x", "online": ""}}, "companion": {"gender": "female"}}
        self.assertEqual(voices.online_voice(camp, "vermeil"), "kokoro:af_heart")
        self.assertEqual(voices.online_voice(camp, "dm"), voices.DM_ONLINE)


class SettingsTabsTests(unittest.TestCase):
    def test_plugins_is_a_normal_settings_tab(self):
        html = open(os.path.join(ROOT, "ui", "index.html"), encoding="utf-8").read()
        js = open(os.path.join(ROOT, "ui", "app.js"), encoding="utf-8").read()
        self.assertNotIn("data-stab", html)
        self.assertNotIn('id="setGeneral"', html)
        self.assertIn("<h3>Plugins</h3>", html)
        self.assertIn('["plugins", "Plugins", ["Plugins"]]', js)
        for tab in ('"general", "General"', '"her", "Her"', '"you", "You"', '"ai", "AI & online"', '"test", "Test"'):
            self.assertIn(tab, js)


class BuilderTests(unittest.TestCase):
    def test_every_body_plan_gets_parts_and_real_firmware(self):
        import builder
        prompts = {"create a robot dog": "quadruped", "a six legged spider": "hexapod", "humanoid animatronic": "humanoid", "robot car": "wheeled",
                   "tank robot": "tracked", "robotic arm": "arm", "camera drone": "drone", "snake robot": "snake", "robot fish": "fish",
                   "build a smart tv": "panel", "smart speaker": "cylinder", "smartwatch": "watch", "desk fan": "fan", "game console": "box"}
        for p, t in prompts.items():
            s = builder.design(p, use_ai=False)
            self.assertEqual(s["template"], t, p)
            self.assertTrue(s["parts"] and s["steps"] and s["cost"] > 0, p)
            code = s["code"]
            self.assertTrue(code.strip(), p)
            if s["kind"] == "robot" and t not in ("drone",):
                self.assertRegex(code, r"void setup\(\)", p)
                self.assertRegex(code, r"void loop\(\)", p)
                self.assertEqual(code.count("{"), code.count("}"), p)       # balanced braces
                self.assertNotRegex(code, r"for \(int \w+ : \{", p)          # no initializer-list loops (AVR can't)

    def test_walker_firmware_matches_its_servos(self):
        import builder
        dog = builder.design("create a robot dog", use_ai=False)["code"]
        self.assertIn("const int LEGS = 4;", dog)
        self.assertIn("Adafruit_PWMServoDriver", dog)
        spider = builder.design("hexapod spider", use_ai=False)["code"]
        self.assertIn("pwmB", spider)                                     # 18 servos need 2 PCA9685 boards

    def test_ai_spec_is_clamped(self):
        import builder
        s = builder.validate({"template": "nope", "params": {"scale": 99, "color": "red"}, "parts": [{"name": "X", "layer": "weird", "qty": 900}]}, "robot dog")
        self.assertEqual(s["template"], "quadruped")
        self.assertEqual(s["params"]["scale"], 3)
        self.assertEqual(s["parts"][0]["layer"], "electronics")
        self.assertLessEqual(s["parts"][0]["qty"], 40)


class GeneratorTests(unittest.TestCase):
    def setUp(self):
        import generator
        self.G = generator
        self.old = generator.OUT_DIR
        generator.OUT_DIR = tempfile.mkdtemp(prefix="gen_t12_")
        self.p = mock.patch.object(generator, "picture", lambda prompt, w=1280, h=720, seed=None, theme="midnight", online=True, **kw:
                                   generator.placeholder(prompt, w, h, theme))
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.G.OUT_DIR = self.old

    def test_pictures_and_slides_offline(self):
        with mock.patch("llm.get_client", side_effect=RuntimeError("offline")):
            r = self.G.pictures("a castle", 2)
            self.assertEqual(len(r["files"]), 2)
            r = self.G.presentation("The water cycle", slides=4)
            self.assertTrue(r["file"].endswith(".pptx") and os.path.exists(r["file"]))
            from pptx import Presentation
            self.assertEqual(len(Presentation(r["file"]).slides), 5)

    def test_files_stay_in_the_creations_folder(self):
        import app
        api = app.Api.__new__(app.Api)
        with self.assertRaises(ValueError):
            api._gen_path(os.path.join(ROOT, "app.py"))


class CoderBrainTests(unittest.TestCase):
    def test_tools_and_memory(self):
        import coder
        with mock.patch.object(coder, "MEMORY_FILE", os.path.join(tempfile.mkdtemp(), "m.json")):
            d = tempfile.mkdtemp()
            open(os.path.join(d, "a.py"), "w").write("import b\ndef main():\n    b.f()\n")
            open(os.path.join(d, "b.py"), "w").write("def f():\n    pass\n")
            a = coder.CodingAgent(d, approve=lambda k, det: True)
            self.assertIn("used by: a.py", a.project_map())
            a.remember("failed", "tried caching the list")
            self.assertIn("FAILED", a.memory_text())
            self.assertIn("Deleted", a.delete_file("b.py"))
            self.assertTrue(os.path.exists(os.path.join(d, ".trash", "b.py")))
        self.assertIn("YOUR BRAIN", coder.SYSTEM)
        self.assertEqual(coder.pick_model("build me a snake game"), coder.CODE_MODEL)


class ElectronicsChatTests(unittest.TestCase):
    def test_memory_line_is_parsed_and_kept(self):
        import electronics
        reply = ("Check the 6 V rail first.\nMEMORY: {\"measured\": [\"servo rail 4.1 V under load\"], \"ruled_out\": [\"bad servo\"], "
                 "\"worked\": [], \"open\": \"servo jitter\"}\nBUILD: a robot dog with 8 MG996R servos")
        fake = mock.MagicMock()
        fake.chat.completions.create.return_value.choices = [mock.MagicMock(message=mock.MagicMock(content=reply))]
        with mock.patch.object(electronics, "CHAT_FILE", os.path.join(tempfile.mkdtemp(), "_chat.json")), mock.patch("llm.get_client", return_value=fake):
            r = electronics.chat("my servo jitters")
            self.assertNotIn("MEMORY:", r["reply"])
            self.assertEqual(r["build"], "a robot dog with 8 MG996R servos")
            self.assertIn("servo rail 4.1 V under load", r["log"]["measured"])
            sys_prompt = fake.chat.completions.create.call_args.kwargs["messages"][0]["content"]
            self.assertIn("Fault diagnosis", sys_prompt)
            electronics.chat("still jitters")
            sys2 = fake.chat.completions.create.call_args.kwargs["messages"][0]["content"]
            self.assertIn("bad servo", sys2)                                  # remembers what was ruled out



class BuilderGeometryTests(unittest.TestCase):
    RAW = {"name": "Dog", "kind": "robot", "motion": {"type": "walk", "speed_hz": 1, "joints": [{"id": "fl_hip", "amp_deg": 20, "phase": 0}]},
           "parts": [{"id": "body", "shape": "rounded_box", "size_mm": [110, 70, 260], "pos_mm": [0, 190, 0], "layer": "shell", "name": "PLA body"},
                     {"id": "head", "shape": "box", "size_mm": [900, 900, 900], "pos_mm": [0, 60, 150], "parent": "body", "name": "Head shell", "layer": "shell"},
                     {"id": "fl_hip", "shape": "servo", "size_mm": [40, 20, 40], "pos_mm": [-60, -35, 90], "parent": "body", "joint": {"axis": "x"}, "name": "MG996R servo", "layer": "actuator"},
                     {"id": "fl_leg", "shape": "capsule", "size_mm": [25, 150, 25], "pos_mm": [0, -80, 0], "parent": "fl_hip", "name": "Leg", "layer": "frame"},
                     {"id": "esp", "shape": "board", "size_mm": [50, 8, 28], "pos_mm": [0, 40, 0], "parent": "body", "name": "ESP32 DevKit", "layer": "electronics"},
                     {"id": "bat", "shape": "battery", "size_mm": [70, 25, 35], "pos_mm": [0, -10, 0], "parent": "body", "name": "2S LiPo 2200 mAh", "layer": "power"},
                     {"id": "loop_a", "shape": "box", "size_mm": [5, 5, 5], "pos_mm": [0, 0, 0], "parent": "loop_b", "name": "a"},
                     {"id": "loop_b", "shape": "box", "size_mm": [5, 5, 5], "pos_mm": [0, 0, 0], "parent": "loop_a", "name": "b"}]}

    def test_validate_and_spec(self):
        import builder
        geo = builder.validate_geometry(self.RAW)
        self.assertIsNotNone(geo)
        byid = {p["id"]: p for p in geo["parts"]}
        self.assertLessEqual(max(byid["head"]["size"]), 260 * 0.55 + 0.01)            # proportion guard
        self.assertEqual(byid["fl_hip"]["torque_kgcm"], 11)                            # looked up from the parts database
        self.assertTrue(byid["loop_a"]["parent"] is None or byid["loop_b"]["parent"] is None)   # loops cut
        spec = builder.custom_spec(self.RAW, geo, "create me a robot dog")
        self.assertEqual(spec["template"], "custom")
        labels = [r[0] for r in spec["analysis"]["rows"]]
        self.assertIn("Total weight", labels)
        self.assertIn("Runtime (estimated)", labels)
        again = builder.validate(dict(spec, edits=[{"op": "add", "target": "add_1", "part": {"kind": "servo"}, "pos": [0, 1, 0]}, {"op": "evil"}]))
        self.assertEqual(again["template"], "custom")
        self.assertEqual(len(again["edits"]), 1)

    def test_cut_off_json_keeps_complete_parts(self):
        import builder
        full = json.dumps(self.RAW)
        cut = full[: full.find('"id": "esp"') + 20]
        d = builder._loads_tolerant(cut)
        self.assertGreaterEqual(len(d["parts"]), 4)
        self.assertEqual(d["motion"]["type"], "walk")

    def test_layout_problems_found(self):
        import builder
        raw = json.loads(json.dumps(self.RAW))
        raw["parts"][3]["pos_mm"] = [0, -900, 0]                         # leg floats far below its hip
        geo = builder.validate_geometry(raw)                             # validation snaps it back onto the hip
        self.assertFalse(any("floats" in p for p in builder.geometry_problems(geo)[0]))
        geo["parts"][3]["pos"] = [0, -900, 0]                            # and the checker still spots one that floats
        self.assertTrue(any("floats" in p for p in builder.geometry_problems(geo)[0]))

    def test_world_coordinates_converted(self):
        import builder
        raw = {"parts": [{"id": "body", "shape": "box", "size_mm": [100, 80, 150], "pos_mm": [0, 200, 0]}] +
                        [{"id": f"p{i}", "parent": "body", "shape": "box", "size_mm": [20, 20, 20], "pos_mm": [0, -50, 0]} for i in range(5)] +
                        [{"id": "board", "parent": "body", "shape": "board", "size_mm": [50, 10, 30], "pos_mm": [0, 245, 0]}]}   # world y by mistake
        geo = builder.validate_geometry(raw)
        self.assertEqual(next(p for p in geo["parts"] if p["id"] == "board")["pos"], [0, 45, 0])

if __name__ == "__main__":
    unittest.main()
