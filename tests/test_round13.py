"""Round 13: alpha monster levels, random road shapes, balanced gold, Mythic cards and the test-mode tools."""
import math, os, random, sys, tempfile, unittest
from unittest import mock
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "game_tools"))
import folders  # noqa
import sandbox  # noqa: E402,F401
from game import ai
ai.disable(True)
from game import campaign, inventory, world  # noqa: E402
from game.actors import make_enemy, passive, power, stats  # noqa: E402
from game.campaign import Game, GameError  # noqa: E402
from game.content import content  # noqa: E402
from game.dice import Dice  # noqa: E402

C = content()


def new(seed=7, cls="warrior"):
    return Game.new(name="Tester", species="human", cls_id=cls, seed=seed, use_ai=False)


class RoadTests(unittest.TestCase):
    def test_every_road_shape_keeps_places_apart(self):
        for shape in world.ROAD_SHAPES:
            for seed in range(40):
                road = world.winding_road(random.Random(seed), shape)
                L = []
                for c in range(10):
                    n = 1 if c in (0, 9) else (2 if c % 3 else 1)
                    for lane in range(n):
                        x, y = world.road_point(road, c / 9, lane, n)
                        L.append({"x": x, "y": y})
                world.spread_out(L)
                gap = min(math.dist((a["x"], a["y"]), (b["x"], b["y"])) for i, a in enumerate(L) for b in L[i + 1:])
                self.assertGreater(gap, 8, f"{shape} seed {seed}")
                self.assertTrue(all(4 <= p["x"] <= 96 and 4 <= p["y"] <= 96 for p in L))

    def test_worlds_use_different_shapes(self):
        shapes = set()
        for seed in range(30):
            rng = random.Random(seed)
            shape = rng.choice(world.ROAD_SHAPES)
            shapes.add(shape)
        self.assertGreaterEqual(len(shapes), 4)


class AlphaTests(unittest.TestCase):
    def test_alpha_is_higher_level(self):
        g = new()
        tid = next(k for k, t in C.enemies.items() if not t.get("boss") and C.enemies[k].get("models"))
        for lv in (1, 11, 40):
            made = [make_enemy(g.camp, tid, lv, Dice(1)) for _ in range(120)]
            alphas = [a for a in made if a.get("alpha")]
            self.assertTrue(alphas, "no alpha in 120 monsters")
            self.assertTrue(all(a["level"] > lv for a in alphas))
            self.assertTrue(all(a["level"] == lv for a in made if not a.get("alpha")))


class GoldTests(unittest.TestCase):
    def test_monster_gold_grows_with_level(self):
        self.assertEqual(inventory.gold_scale(1), 1)
        self.assertGreater(inventory.gold_scale(50), 3)

    def test_rare_gear_costs_about_ten_fights_all_game(self):
        avg = sum(sum(t.get("gold", [1, 5])) / 2 for t in C.enemies.values()) / len(C.enemies)
        for lv in (10, 50, 100):
            fight = 3 * avg * inventory.gold_scale(lv)
            p = power(lv)
            vals = [b["value"] for b in C.items.values() if b["slot"] in inventory.EQUIP_SLOTS and abs(b.get("level", 1) - p) <= 3] \
                or [max(b.get("value", 0) for b in C.items.values())]
            rare = sorted(vals)[len(vals) // 2] * C.rarities["rare"]["value"] * inventory.SHOP_MARKUP
            self.assertLess(rare / fight, 20, f"level {lv}")


class MythicTests(unittest.TestCase):
    def test_mythic_cards_exist_with_art(self):
        myth = {k: c for k, c in C.cards.items() if c["rarity"] == "mythic"}
        self.assertGreaterEqual(len(myth), 5)
        for k, c in myth.items():
            self.assertTrue(C.has_model(c["art"]), k)
        self.assertGreater(C.card_weights["boss"]["mythic"], 0)
        self.assertEqual(C.card_weights["card"]["mythic"], 0)

    def test_mythic_card_gives_several_powers(self):
        g = new()
        me = g.player()
        me.setdefault("cards", []).append("eye_of_the_void")
        self.assertAlmostEqual(passive(me, g.camp, "lifesteal"), 0.25)
        self.assertAlmostEqual(passive(me, g.camp, "poison_on_hit"), 0.3)


class TestModeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = mock.patch.object(campaign, "SAVE_DIR", self.tmp); self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_needs_test_mode(self):
        g = new()
        with self.assertRaises(GameError):
            g.test_tool("gold", 100)

    def test_tools(self):
        g = new()
        g.set_settings({"test_mode": True})
        gold = g.camp["gold"]
        g.test_tool("gold", 500)
        self.assertEqual(g.camp["gold"], gold + 500)
        g.test_tool("level", 20)
        self.assertTrue(all(p["level"] == 20 for p in g.camp["party"]))
        g.test_tool("boss")
        self.assertEqual(g.camp["location"], g.camp["quest"]["boss"]["location"])
        g.test_tool("mythic")
        offer = g.camp["pending_cards"][-1]
        self.assertTrue(offer["cards"])
        self.assertTrue(all(C.cards[c]["rarity"] == "mythic" for c in offer["cards"]))
        n = len(g.camp["party"])
        try:
            g.test_tool("add_member", {"species": "human", "cls": "cleric"})
        except GameError:
            return                      # party already full in this world
        self.assertEqual(len(g.camp["party"]), n + 1)
        g.test_tool("remove_member", g.camp["party"][-1]["uid"])
        self.assertEqual(len(g.camp["party"]), n)


class NpcLookTests(unittest.TestCase):
    def test_npcs_dont_share_models_while_new_ones_are_left(self):
        for seed in range(6):
            g = new(seed=seed, cls="cleric")
            party = {p["model"] for p in g.camp["party"]}
            models = [n["model"] for n in g.camp["npcs"].values()]
            self.assertFalse(party & set(models), f"seed {seed}")
            self.assertEqual(len(models), len(set(models)), f"seed {seed}: {models}")

    def test_old_save_changes_only_people_you_havent_met(self):
        g = new(seed=3, cls="cleric")
        npcs = list(g.camp["npcs"].values())
        hero = g.camp["party"][0]["model"]
        npcs[0]["model"] = npcs[1]["model"] = npcs[2]["model"] = hero
        npcs[0]["met"] = True
        genders = [n.get("gender") for n in npcs]
        del g.camp["npc_looks"]
        camp = campaign.migrate({"save_version": 1, "campaign": g.camp})
        self.assertEqual(npcs[0]["model"], hero)                       # you've met this one: unchanged
        models = [n["model"] for n in npcs[1:]]
        self.assertNotIn(hero, models)
        self.assertEqual(len(models), len(set(models)))
        self.assertEqual(genders, [n.get("gender") for n in npcs])     # same voices
        self.assertEqual(camp["npc_looks"], 1)


class LauncherTests(unittest.TestCase):
    def test_launcher_gets_the_link(self):
        sys.path.insert(0, os.path.join(ROOT, "scripts"))
        import package_app
        with mock.patch.object(package_app, "DIST", tempfile.mkdtemp()):
            out = package_app.make_launcher("https://example.com/Vermeil.zip?a=1&b=$x")
            text = open(out, encoding="utf-8").read()
        self.assertIn('$url = "https://example.com/Vermeil.zip?a=1&b=`$x"', text)
        self.assertTrue(text.startswith("<# :"))
        self.assertNotIn("GROQ_API_KEY", text)


if __name__ == "__main__":
    unittest.main()
