"""Tests for the Dungeon Adventure game engine (game/). No AI and no graphics needed."""
import json, os, sys, tempfile, unittest
from unittest import mock
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "game_tools"))
import folders  # noqa
import sandbox  # noqa: E402,F401  (keeps the tests away from your real Spotify login, keys and installs)
from game import ai
ai.disable(True)
from game import campaign, combat, content, dm, layout, progression, world
from game.actors import make_enemy, stats
from game.campaign import Game, GameError
from game.dice import Dice, parse
from game.inventory import make_item, add, equip
import simulate

C = content.content()
campaign.SAVE_DIR = tempfile.mkdtemp()      # tests never touch your real saves


def new(seed=7, cls="warrior", species="human", **kw):
    return Game.new(name="Tester", species=species, cls_id=cls, seed=seed, use_ai=False, **kw)


class AssetTests(unittest.TestCase):
    def test_catalog_has_models_and_every_data_reference_exists(self):
        self.assertGreater(len(C.catalog), 500)
        missing = []
        for k, e in list(C.enemies.items()) + list(C.bosses.items()):
            if not C.available_models(e["models"]): missing.append(k)
        for k, c in C.classes.items():
            if not C.has_model(c["human_model"]): missing.append(k)
        for k, c in C.cards.items():
            if not C.has_model(c["art"]): missing.append("card " + k)
        for k, b in C.items.items():
            if b.get("model") and not C.has_model(b["model"]): missing.append("item " + k)
        self.assertEqual(missing, [])

    def test_every_biome_pool_finds_models(self):
        empty = [(b, p) for b, d in C.biomes.items() for p, pool in d["pools"].items() if not C.match(pool["match"])]
        self.assertEqual(empty, [])

    def test_npc_roles_have_models(self):
        self.assertEqual([r for r, d in C.world["npc_roles"].items() if not C.match(d["models"])], [])

    def test_dice_faces_cover_every_value(self):
        faces = json.loads(open(os.path.join(ROOT, "ui", "game", "assets", "made", "dice_faces.json")).read())
        for d in (4, 6, 8, 12, 20):
            self.assertEqual(sorted(f["value"] for f in faces[f"d{d}"]), list(range(1, d + 1)))
        self.assertEqual(sorted(f["value"] for f in faces["d10"]), list(range(0, 10)))


class DiceTests(unittest.TestCase):
    def test_parse_and_range(self):
        self.assertEqual(parse("2d6+3"), (2, 6, 3))
        with self.assertRaises(ValueError): parse("1d7")
        d = Dice(5)
        for _ in range(300):
            r = d.roll("1d20")
            self.assertTrue(1 <= r["total"] <= 20)

    def test_reproducible(self):
        a, b = Dice(42), Dice(42)
        self.assertEqual([a.roll("1d20")["total"] for _ in range(20)], [b.roll("1d20")["total"] for _ in range(20)])


class CreationTests(unittest.TestCase):
    def test_character_creation_stats(self):
        g = new(cls="mage")
        p = g.player()
        st = stats(p, g.camp)
        base = C.classes["mage"]["base"]
        self.assertGreaterEqual(st["matk"], base["matk"])
        self.assertEqual(p["hp"], st["hp"])
        self.assertIn("arcane_bolt", p["abilities"])

    def test_vermeil_keeps_her_model_unless_randomised(self):
        g = new()
        v = next(x for x in g.camp["party"] if x["uid"] == "vermeil")
        self.assertEqual(v["model"], "vermeil")
        g2 = new(seed=3, settings={"randomize_vermeil_look": True})
        v2 = next(x for x in g2.camp["party"] if x["uid"] == "vermeil")
        self.assertNotEqual(v2["model"], "vermeil")
        g3 = new(seed=3, settings={"randomize_vermeil_class": True})
        v3 = next(x for x in g3.camp["party"] if x["uid"] == "vermeil")
        self.assertEqual(v3["model"], "vermeil")

    def test_unavailable_species_refused(self):
        with mock.patch.object(C, "playable_species", lambda: [{"id": "human", "available": False}]):
            with self.assertRaises(GameError): new()


class WorldTests(unittest.TestCase):
    def test_campaigns_differ(self):
        sig = set()
        for s in range(8):
            g = new(seed=s)
            sig.add((g.camp["world"]["genre"], g.camp["quest"]["boss"]["template"], tuple(l["biome"] for l in g.camp["locations"].values())))
        self.assertGreater(len(sig), 5)

    def test_same_seed_same_world(self):
        a, b = new(seed=11), new(seed=11)
        self.assertEqual([l["biome"] for l in a.camp["locations"].values()], [l["biome"] for l in b.camp["locations"].values()])
        la = layout.build(a.camp, a.loc(), None); lb = layout.build(b.camp, b.loc(), None)
        self.assertEqual(la["objects"], lb["objects"])

    def test_map_connected_and_layouts_valid(self):
        for s in range(6):
            g = new(seed=s)
            self.assertEqual(world.reachable(g.camp, g.camp["location"]), set(g.camp["locations"]))
            for l in g.camp["locations"].values():
                lay = layout.build(g.camp, l, None)
                v = lay["validation"]
                self.assertTrue(v["ok"], (s, l["biome"], v))
                self.assertEqual(v["missing_assets"], [])
                self.assertTrue(all(C.has_model(o["a"]) for o in lay["objects"]))
                self.assertEqual(len(lay["exits"]), len(l["links"]))

    def test_enemies_use_existing_models(self):
        g = new(seed=2)
        for l in g.camp["locations"].values():
            for e in l["encounters"]:
                for tid, lvl in e["enemies"]:
                    self.assertTrue(C.available_models(C.enemy(tid)["models"]))


class CombatTests(unittest.TestCase):
    def fight(self, g):
        enc = next(e for e in g.loc()["encounters"] if not e["done"])
        return g.engage(enc["id"])

    def test_turn_order_enforced_and_invalid_actions_rejected(self):
        for seed in range(4, 40):                       # find a fight that's still going when it's our turn
            g = new(seed=seed, settings={"vermeil_control": "direct"})
            self.fight(g)
            if g.in_combat(): break
        cb = g.camp["combat"]
        self.assertEqual(cb["phase"], "player_input")
        other = next(p["uid"] for p in g.camp["party"] if p["uid"] != cb["waiting_for"])
        with self.assertRaises(GameError): g.combat_act(other, {"type": "defend"})
        with self.assertRaises(GameError): g.combat_act(cb["waiting_for"], {"type": "ability", "ability": "meteor"})
        with self.assertRaises(GameError): g.combat_act(cb["waiting_for"], {"type": "ability", "ability": "basic_attack", "target": cb["waiting_for"]})
        self.assertEqual(g.camp["combat"]["phase"], "player_input")      # still your turn after a mistake

    def test_dice_match_damage(self):
        g = new(seed=9)
        ev = self.fight(g)
        for _ in range(30):
            if not g.in_combat(): break
            ev += g.combat_act(g.camp["combat"]["waiting_for"], {"type": "ability", "ability": "basic_attack"})
        dice = [e for e in ev if e["type"] == "dice"]
        self.assertTrue(dice)
        for e in dice:
            self.assertEqual(e["total"], sum(e["rolls"]) + e["mod"])
            for r in e["rolls"]: self.assertTrue(1 <= r <= e["die"])
        hits = [e for e in ev if e["type"] == "hit"]
        for h in hits: self.assertGreaterEqual(h["hp"], 0)

    def test_xp_awarded_once(self):
        g = new(seed=12)
        self.fight(g)
        while g.in_combat():
            g.combat_act(g.camp["combat"]["waiting_for"], {"type": "ability", "ability": "basic_attack"})
        xp = g.camp["stats"]["xp_earned"]
        cb = g.camp["combat"]
        if cb and cb["result"] == "victory":
            from game.combat import finish
            cb["phase"] = "player_input"; cb["rewards_paid"] = False
            finish(g.camp, "victory", g.dice, [])                       # a replayed victory pays nothing new
            self.assertEqual(g.camp["stats"]["xp_earned"], xp)

    def test_boss_can_be_defeated_and_campaign_finishes(self):
        r = simulate.autoplay(3, "paladin")
        self.assertEqual(r["status"], "complete")
        self.assertGreaterEqual(r["level"], 5)

    def test_hp_bars_data(self):
        g = new(seed=4)
        ev = self.fight(g)
        start = next(e for e in ev if e["type"] == "combat_start")
        for a in start["party"] + start["enemies"]:
            self.assertIn("hp", a); self.assertIn("max_hp", a); self.assertLessEqual(a["hp"], a["max_hp"])


class ProgressionTests(unittest.TestCase):
    def test_level_up_and_cards_change_stats(self):
        g = new(seed=5)
        p = g.player()
        ev = []
        progression.award_xp(g.camp, "test", 500, g.dice, ev)
        self.assertGreater(p["level"], 2)
        self.assertTrue(any(e["type"] == "level_up" for e in ev))
        offer = g.camp["pending_cards"][0]
        before = stats(p, g.camp)
        cid = offer["cards"][0]
        g.choose_card(offer["id"], cid)
        self.assertIn(cid, p["cards"])
        self.assertEqual(g.camp["card_history"][-1]["card"], cid)
        with self.assertRaises(GameError): g.choose_card(offer["id"], cid)     # can't take it twice

    def test_card_stats_apply(self):
        g = new(seed=5)
        p = g.player()
        before = stats(p, g.camp)["hp"]
        p["cards"].append("vigor")
        self.assertEqual(stats(p, g.camp)["hp"], before + 12)


class InventoryTests(unittest.TestCase):
    def test_equipment_changes_combat_stats(self):
        g = new(seed=6)
        p = g.player()
        before = stats(p, g.camp)["patk"]
        it = add(g.camp, make_item(g.camp, "golden_sword", rarity="common"))
        g.equip(p["uid"], it["uid"])
        self.assertGreater(stats(p, g.camp)["patk"], before)

    def test_quest_items_cant_be_thrown_away(self):
        g = new(seed=6)
        it = add(g.camp, make_item(g.camp, "quest_item", name="Relic"))
        with self.assertRaises(GameError): g.discard(it["uid"])

    def test_treasure_once(self):
        g = new(seed=6)
        loc = g.loc()
        loc["treasure"].append({"id": "Tx", "item": "potion_small", "gold": 5, "found": False})
        g.open_treasure("Tx")
        with self.assertRaises(GameError): g.open_treasure("Tx")


class DMTests(unittest.TestCase):
    def test_rule_parser(self):
        g = new(seed=8)
        self.assertEqual(dm.interpret(g.camp, "I rest by the fire")["intent"], "rest")
        exit_name = g.loc(g.loc()["links"][0])["name"]
        self.assertEqual(dm.interpret(g.camp, f"go to {exit_name}")["intent"], "move")
        self.assertEqual(dm.interpret(g.camp, "I search the bushes")["intent"], "search")

    def test_bad_ai_output_rejected(self):
        g = new(seed=8)
        self.assertIsNone(dm.validate_intent(g.camp, {"intent": "win_game"}))
        v = dm.validate_intent(g.camp, {"intent": "attack", "target": "dragon_999", "check": {"stat": "dex", "dc": 99}, "ability": "meteor"})
        self.assertIsNone(v["target"]); self.assertIsNone(v["ability"]); self.assertEqual(v["check"]["dc"], 25)

    def test_ai_timeout_does_not_freeze(self):
        import time
        ai.disable(False)
        try:
            with mock.patch.object(ai, "_call", lambda *a, **k: time.sleep(5)):
                t = time.time()
                r = ai.ask("s", "u", timeout=0.3)
                self.assertIsNone(r)
                self.assertLess(time.time() - t, 2)
        finally:
            ai.disable(True)

    def test_facts_remembered(self):
        g = new(seed=8)
        g._fact("The bridge at Millbrook is cursed.")
        self.assertIn("The bridge at Millbrook is cursed.", dm.state_for_prompt(g.camp)["facts"])


class SaveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.p = mock.patch.object(campaign, "SAVE_DIR", self.tmp); self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_save_load_roundtrip(self):
        g = new(seed=10)
        g.travel(g.loc()["links"][0])
        g.save("1")
        g2 = Game.load("1")
        self.assertEqual(g2.camp["location"], g.camp["location"])
        self.assertEqual(g2.player()["hp"], g.player()["hp"])
        self.assertEqual(g2.dice.n, g.dice.n)
        self.assertEqual(layout.build(g2.camp, g2.loc(), None)["objects"], layout.build(g.camp, g.loc(), None)["objects"])

    def test_corrupt_save(self):
        open(os.path.join(self.tmp, "slot_2.json"), "w").write("{not json")
        with self.assertRaises(GameError): Game.load("2")
        open(os.path.join(self.tmp, "slot_3.json"), "w").write(json.dumps({"campaign": {"id": 1}}))
        with self.assertRaises(GameError): Game.load("3")

    def test_no_saving_mid_battle(self):
        g = new(seed=4)
        enc = next(e for e in g.loc()["encounters"] if not e["done"])
        g.engage(enc["id"])
        if g.in_combat():
            with self.assertRaises(GameError): g.save("1")


class ApiTests(unittest.TestCase):
    def test_api_errors_are_messages(self):
        from game.api import GameAPI
        a = GameAPI()
        self.assertIn("error", a.state())
        info = a.info()
        self.assertTrue(info["species"] and info["classes"])
        r = a.new({"name": "A", "species": "human", "cls": "rogue", "seed": 99})
        self.assertIn("state", r)
        self.assertIn("error", a.travel("nowhere"))


if __name__ == "__main__":
    unittest.main()


class ShopAndTraderTests(unittest.TestCase):
    """gold sinks: town shops, the wandering trader, reforging, the inn, tonics and tomes."""
    def setUp(self):
        self.p = mock.patch.object(campaign, "SAVE_DIR", tempfile.mkdtemp()); self.p.start()

    def tearDown(self):
        self.p.stop()

    def test_every_safe_place_has_a_shop(self):
        for seed in (1, 2, 3, 4):
            g = new(seed=seed)
            for l in g.camp["locations"].values():
                if l["safe"]:
                    self.assertTrue(any(g.camp["npcs"][n].get("shop") for n in l["npcs"]), f"seed {seed} {l['name']}")

    def test_trader_appears_in_the_wild_with_good_goods_and_leaves(self):
        g = new(seed=11)
        g.camp["gold"] = 5000
        seen = None
        for _ in range(40):                       # walk around until the trader shows up
            cur = g.loc()
            dest = sorted(cur["links"])[g.camp["turn"] % len(cur["links"])]
            ev = g.travel(dest)
            g.camp["turn"] += 3
            tr = [e for e in ev if e["type"] == "trader"]
            if tr: seen = tr[0]; break
        self.assertIsNotNone(seen, "the wandering trader never appeared")
        self.assertFalse(g.loc()["safe"])
        self.assertIn(seen["npc"], g.loc()["npcs"])
        self.assertTrue(any(n["trader"] for n in g.location_public()["npcs"]))
        shop = g.open_shop(seen["npc"])[0]
        gear = [it for it in shop["goods"] if it["slot"] in ("weapon", "armor", "offhand", "accessory")]
        self.assertTrue(gear and all(it["rarity"] in ("rare", "epic", "legendary") for it in gear))
        self.assertTrue(any(content.content().items[it["base"]].get("trader_only") for it in shop["goods"]))
        # leaving: the trader packs up
        g.travel(sorted(g.loc()["links"])[0])
        self.assertNotIn(seen["npc"], g.camp["locations"][seen and g.camp["came_from"]]["npcs"])

    def test_trader_only_items_never_drop_or_sell_in_towns(self):
        from game.inventory import shop_stock
        g = new(seed=5)
        for role in ("merchant", "blacksmith", "innkeeper"):
            for lvl in (1, 6, 12):
                goods = shop_stock(g.camp, lvl, g.dice, role)
                self.assertFalse([it for it in goods if content.content().items[it["base"]].get("trader_only")])

    def test_reforge_costs_gold_and_improves_the_item(self):
        g = new(seed=3)
        smith = next((n for n in g.camp["npcs"].values() if n["role"] == "blacksmith"), None)
        if smith is None:
            smith = world.make_npc(g.camp, g.loc(), "blacksmith", __import__("random").Random(1))
        p = g.player()
        wid = p["equipment"]["weapon"]
        it = next(x for x in g.camp["inventory"] if x["uid"] == wid)
        before = stats(p, g.camp)["patk"]
        g.camp["gold"] = 0
        with self.assertRaises(GameError):
            g.reforge_item(smith["id"], wid)
        g.camp["gold"] = 10000
        r = g.reforge_item(smith["id"], wid)
        self.assertEqual(it["plus"], 1)
        self.assertTrue(it["name"].endswith("+1"))
        self.assertEqual(g.camp["gold"], 10000 - r["cost"])
        self.assertGreater(stats(p, g.camp)["patk"], before)
        for _ in range(4): g.reforge_item(smith["id"], wid)
        with self.assertRaises(GameError):
            g.reforge_item(smith["id"], wid)          # +5 is the maximum

    def test_inn_heals_everyone_for_gold(self):
        g = new(seed=3)
        inn = next(n for n in g.camp["npcs"].values() if "inn" in g.services(n["id"]))
        for p in g.camp["party"]: p["hp"] = 1
        g.camp["party"][1]["alive"] = False
        g.camp["gold"] = 500
        g.inn_rest(inn["id"])
        self.assertEqual(g.camp["gold"], 500 - g.inn_cost())
        for p in g.camp["party"]:
            self.assertTrue(p["alive"]); self.assertEqual(p["hp"], stats(p, g.camp)["hp"])

    def test_tonic_is_permanent_and_tome_offers_a_card(self):
        g = new(seed=3)
        p = g.player()
        hp0 = stats(p, g.camp)["hp"]
        tonic = add(g.camp, make_item(g.camp, "heartfruit"))
        g.use_item(tonic["uid"], p["uid"])
        self.assertEqual(stats(p, g.camp)["hp"], hp0 + 10)
        with mock.patch.object(campaign, "SAVE_DIR", tempfile.mkdtemp()):
            g.save("2")
            self.assertEqual(stats(Game.load("2").player(), g.camp)["hp"], hp0 + 10)
        tome = add(g.camp, make_item(g.camp, "tome_insight"))
        n = len(g.camp["pending_cards"])
        g.use_item(tome["uid"], p["uid"])
        self.assertEqual(len(g.camp["pending_cards"]), n + 1)


class SoundAndModelTests(unittest.TestCase):
    def test_every_enemy_has_a_creature_sound(self):
        for sec in (C.enemies, C.bosses, C.summons):
            for k, e in sec.items():
                self.assertTrue(e.get("sound"), k)

    def test_preload_list_covers_what_the_game_uses(self):
        used = set(C.used_models())
        self.assertTrue(used <= set(C.catalog))
        for k, e in C.enemies.items():
            self.assertTrue(set(C.available_models(e["models"])) <= used, k)
        for c in C.classes.values():
            self.assertIn(c["human_model"], used)

    def test_boot_list_is_small_and_scenery_is_per_place(self):
        core, everything = set(C.used_models()), set(C.used_models(scenery=True))
        self.assertLess(len(core), 700)                    # fits in memory on the first loading screen
        self.assertGreater(len(everything), 1500)          # the worlds use most of the library
        self.assertTrue(core <= everything)

    def test_every_biome_pool_and_set_piece_finds_models(self):
        import re
        ids = list(C.catalog)
        for b, d in C.biomes.items():
            if b.startswith("_"): continue
            for name, p in d["pools"].items():
                self.assertTrue(any(re.search(p["match"], i) for i in ids), f"{b}.{name}")
            for sp, _w in d.get("setpieces", []):
                self.assertIn(sp, C.setpieces, f"{b} -> {sp}")
        for k, sp in C.setpieces.items():
            if k.startswith("_"): continue
            for part in sp["parts"]:
                self.assertTrue(any(re.search(part["m"], i) for i in ids), f"{k}: {part['m']}")

    def test_every_biome_builds_a_full_valid_place(self):
        from game import layout
        for b in [k for k in C.biomes if not k.startswith("_")]:
            loc = {"id": "L0", "biome": b, "seed": 4242, "kind": "wild", "river": False, "treasure": [{"id": "t1"}], "npcs": [],
                   "name": "x", "x": 50, "y": 50, "links": ["L1", "L2"]}
            camp = {"seed": 1, "locations": {"L0": loc, "L1": {"x": 70, "y": 40}, "L2": {"x": 30, "y": 60}}}
            r = layout.build(camp, loc)
            self.assertTrue(r["validation"]["ok"] and not r["validation"].get("fallback"), (b, r["validation"]["notes"]))
            self.assertGreater(len(r["objects"]), 120, b)
            self.assertLess(len({o["a"] for o in r["objects"]}), 110, b)      # a place loads a limited palette
            for o in r["objects"]:                                              # nothing absurdly big (flat models)
                m = C.model(o["a"])
                if o["k"] != "backdrop" and m and m.get("size"):
                    self.assertLess(max(m["size"][0], m["size"][2]) * o["s"], 26, (b, o["a"]))

    def test_monsters_have_real_sizes_and_bosses_are_house_sized(self):
        for k, e in C.enemies.items():
            self.assertTrue(e.get("size"), k)
        for k, b in C.bosses.items():
            self.assertGreaterEqual(b.get("size", 0), 4, k)
        from game.actors import make_enemy
        g = new(seed=5)
        sizes = [make_enemy(g.camp, "goblin", 3)["size"] for _ in range(60)]
        self.assertGreater(max(sizes) / min(sizes), 1.3)                       # variety, sometimes an alpha
        boss = make_enemy(g.camp, "orc_warlord", 8, boss=True)
        self.assertGreaterEqual(boss["size"], 5.5)

    def test_no_model_is_see_through(self):
        import fix_materials
        bad = []
        for d, _, names in os.walk(os.path.join(ROOT, "ui", "game", "assets")):
            for n in names:
                if n.endswith((".glb", ".gltf")):
                    path = os.path.join(d, n)
                    if (fix_materials.fix_glb(path, True) if n.endswith(".glb") else fix_materials.fix_gltf(path, True)):
                        bad.append(n)
        self.assertEqual(bad, [])
