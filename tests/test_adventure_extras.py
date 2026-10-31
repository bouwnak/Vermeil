"""Adventure round (game/extras.py): the day/night clock and night monsters, taming pets and riding mounts, crafting with
appraisal (stats roll inside a low-high range), and one save slot per campaign. No AI and no graphics."""
import os, sys, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import folders  # noqa: F401
import sandbox  # noqa: F401
from game import ai
ai.disable(True)
from game import campaign, content, extras
from game.campaign import Game, GameError
from game.inventory import add, make_item

C = content.content()


def new(seed=11):
    return Game.new(name="Tester", species="human", cls_id="warrior", seed=seed, use_ai=False)


def wild(g):
    return next(l for l in g.camp["locations"].values() if not l["safe"] and l["kind"] not in ("boss", "start") and extras.outdoor(l))


class _Saves(unittest.TestCase):
    def setUp(self):
        self.old = campaign.SAVE_DIR
        campaign.SAVE_DIR = tempfile.mkdtemp(prefix="vermeil-adv-")
        self.addCleanup(lambda: setattr(campaign, "SAVE_DIR", self.old))


class ClockTests(_Saves):
    def test_phases_and_sky(self):
        self.assertEqual([extras.phase(h * 60) for h in (3, 5, 7, 18, 21)], ["night", "dawn", "day", "dusk", "night"])
        g = new()
        self.assertEqual(g.state()["clock"]["text"], "08:00")
        L = wild(g)
        self.assertEqual(extras.sky(g.camp, L, "day"), "day")
        g.camp["clock"] = 22 * 60
        self.assertEqual(extras.sky(g.camp, L, "day"), "night")
        self.assertEqual(extras.sky(g.camp, {"biome": "cave"}, "dark"), "dark")       # caves ignore the clock

    def test_night_monsters_come_and_go_at_sunrise(self):
        g = new()
        L = wild(g)
        g.camp["clock"] = 22 * 60
        enc = None
        for i in range(40):                                                         # 50% each half hour
            g.camp["clock"] = 22 * 60 + i * 30 % 300
            enc = extras.maybe_night_encounter(g, L)
            if enc: break
        self.assertTrue(enc and enc["night"])
        self.assertTrue(all(t in extras.NIGHT_MONSTERS for t, _ in enc["enemies"]))
        self.assertIsNone(extras.maybe_night_encounter(g, L))                      # one pack at a time
        g.camp["clock"] = 4 * 60 + 30
        ev = []
        extras.advance(g, 120, ev)                                                  # 04:30 -> 06:30
        self.assertFalse(any(e.get("night") for e in L["encounters"]))
        self.assertTrue(any("sun comes up" in (e.get("text") or "") for e in ev))

    def test_travel_rest_and_inn_move_the_clock(self):
        g = new()
        here = g.loc()
        dest = next(x for x in here["links"] if not g.blocked(x))
        g.travel(dest)
        self.assertEqual(g.camp["clock"], 8 * 60 + extras.TRAVEL_MINUTES)
        g.camp["clock"] = 21 * 60
        L = g.loc()
        L["encounters"] = [dict(e, done=True) for e in L["encounters"]]
        g.rest()
        self.assertEqual(g.camp["clock"], 21 * 60 + extras.REST_MINUTES)


class PetTests(_Saves):
    def offer(self, g, template="wild_wolf", level=1):
        e = {"template": template, "name": C.enemy(template)["name"], "level": level, "kind": "enemy", "model": "m", "body": C.enemy(template)["body"]}
        cb = {"defeated": ["e1"], "enemies": {"e1": e}, "encounter": "x"}
        for t in range(200):                                                        # 35% per win
            g.camp["turn"] = t
            if extras.tame_offer_roll(g, cb): return g.camp["tame_offer"]
        self.fail("never offered")

    def test_tame_ride_and_perks(self):
        g = new()
        o = self.offer(g)
        self.assertEqual(o["perk"], "ride")
        for _ in range(12):
            add(g.camp, make_item(g.camp, "heartfruit", qty=1))
        food = lambda: next(it for it in g.camp["inventory"] if it["base"] == "heartfruit")["uid"]
        while g.camp.get("tame_offer"):
            extras.tame(g, food())
        if not g.camp.get("pets"):                                                  # it ran off: try another
            self.offer(g)
            while g.camp.get("tame_offer"): extras.tame(g, food())
        pet = g.camp["pets"][0]
        self.assertEqual(g.camp["pet_active"], pet["id"])
        extras.pet_ride(g, True)
        self.assertTrue(extras.riding(g.camp))
        self.assertEqual(extras.roam_chance(g.camp), 0.25)
        here = g.loc()
        dest = next(x for x in here["links"] if not g.blocked(x))
        c0 = g.camp["clock"]
        g.travel(dest)
        self.assertEqual(g.camp["clock"] - c0, extras.RIDE_MINUTES)
        extras.pet_rename(g, pet["id"], "  Shadow  ")
        self.assertEqual(g.camp["pets"][0]["name"], "Shadow")
        extras.pet_release(g, pet["id"])
        self.assertFalse(extras.riding(g.camp))

    def test_cant_ride_a_slime_and_bosses_cant_be_tamed(self):
        g = new()
        self.assertFalse(extras.tameable({"kind": "enemy", "template": "goblin", "body": "humanoid"}))
        self.assertEqual(extras.perk_for("slime", "blob"), "heal")
        g.camp["pets"] = [{"id": "pet1", "perk": "heal", "name": "Gloop", "bond": 0, "level": 1}]
        g.camp["pet_active"] = "pet1"
        with self.assertRaises(GameError):
            extras.pet_ride(g, True)
        with self.assertRaises(GameError):
            extras.tame(g, None)                                                     # nothing waiting


class CraftTests(_Saves):
    def give(self, g, base, qty):
        add(g.camp, make_item(g.camp, base, qty=qty))

    def test_craft_needs_materials_and_makes_unappraised_gear(self):
        g = new()
        sword = add(g.camp, make_item(g.camp, "iron_sword", rarity="common"))
        g.camp["gold"] = 1000
        with self.assertRaises(GameError):
            extras.craft(g, sword["uid"])                                           # no materials yet
        self.give(g, "scrap_metal", 1)
        self.give(g, "crystal", 1)
        r = extras.craft(g, sword["uid"])
        it = r["item"]
        self.assertEqual((it["rarity"], it["appraised"], it["bonus"]), ("uncommon", False, {}))
        self.assertIn("patk", it["ranges"])
        lo, hi = it["ranges"]["patk"]
        self.assertLess(lo, hi)
        self.assertFalse(any(x["base"] in ("scrap_metal", "crystal") for x in g.camp["inventory"]))
        with self.assertRaises(GameError):                                          # can't wear it blind
            g.equip("player", it["uid"]) if False else g.equip(g.player()["uid"], it["uid"])

    def test_appraisal_rolls_inside_the_range_and_reroll_can_go_either_way(self):
        g = new()
        g.camp["gold"] = 100000
        seen = set()
        for i in range(30):
            it = add(g.camp, make_item(g.camp, "steel_sword", rarity="rare"))
            r = extras.appraise(g, it["uid"])["roll"]
            for k, v in r["bonus"].items():
                lo, hi = it["ranges"][k]
                self.assertTrue(lo <= v <= hi, (k, v, lo, hi))
            seen.add(r["bonus"].get("patk"))
            self.assertIn(r["grade"], "SABCD")
        self.assertGreater(len(seen), 2)                                            # not a fixed number
        it = add(g.camp, make_item(g.camp, "steel_sword", rarity="rare"))
        extras.appraise(g, it["uid"])
        first = dict(it["bonus"])
        extras.appraise(g, it["uid"])
        self.assertIn("reroll", it)
        with self.assertRaises(GameError):
            extras.appraise(g, it["uid"])                                           # choose first
        extras.appraise_choose(g, it["uid"], take=False)
        self.assertEqual(it["bonus"], first)

    def test_blacksmith_services_list_crafting(self):
        g = new()
        smith = next((n for n in g.camp["npcs"].values() if n.get("role") in ("blacksmith", "engineer")), None)
        if not smith:
            self.skipTest("no blacksmith in this world")
        s = g.services(smith["id"])
        self.assertIn("craft", s)
        self.assertIn("appraise", s)


class SlotTests(_Saves):
    def test_three_campaigns_each_keep_their_slot(self):
        from game.api import GameAPI
        a = GameAPI()
        for i in range(3):
            r = a.new({"name": f"H{i}", "species": "human", "cls": "warrior", "seed": 40 + i})
            self.assertIn("state", r)
            self.assertEqual(r["state"]["slot"], str(i + 1))
        c = a.campaigns()
        self.assertEqual([s["player"] for s in c["slots"]], ["H0", "H1", "H2"])
        self.assertIsNone(c["free"])
        self.assertIn("error", a.new({"name": "H3", "seed": 9}))                  # all three in use
        r = a.new({"name": "H3", "seed": 9, "slot": "2"})                           # replace slot 2 on purpose
        self.assertEqual(r["state"]["slot"], "2")
        self.assertEqual(a.load("1")["state"]["party"][0]["name"], "H0")


if __name__ == "__main__":
    unittest.main()
