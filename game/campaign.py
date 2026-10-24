"""campaign.py - one running adventure: creating it, the free-text action loop, travel, talking, searching,
treasure, recruiting, rest, quests, the final boss, saving/loading and the results screen.

The Game object holds the campaign dict (camp). Every change goes through these methods, which validate it,
so neither the AI nor the client can put the game into an impossible state.
"""
import copy
import json
import os
import re
import threading
import time
import uuid

from . import ai, combat, companion, dm, layout, voices, world
from .actors import LEVEL_CAP, level_up, make_enemy, make_hero, make_monster_ally, make_recruit, make_vermeil, power, public, stats, VERMEIL_MODEL
from .content import content
from .dice import Dice, stream
from .inventory import (EQUIP_SLOTS, REFORGE_MAX, add, compare, equip, make_item, reforge, reforge_cost, remove, roll_loot,
                        shop_stock, starting_gear, unequip)
from .progression import card_offer_public, choose_card, offer_cards, xp_to_next

SAVE_VERSION = 1
SAVE_DIR = os.environ.get("GAME_SAVE_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "game", "saves")
SLOTS = ("auto", "1", "2", "3")
DEFAULT_SETTINGS = {"vermeil_control": "auto", "ally_control": "auto", "vermeil_cards": True, "voice": True,
                    "randomize_vermeil_class": False, "randomize_vermeil_look": False, "skip_portal": False,
                    "music_volume": 0.5, "sfx_volume": 0.8, "ambient_volume": 0.6, "voice_volume": 1.0,
                    "voice_dm_volume": 1.0, "voice_vermeil_volume": 1.0, "voice_npc_volume": 1.0}


class GameError(ValueError):
    pass


class Game:
    def __init__(self, camp=None):
        self.camp = camp
        self.dice = Dice(camp["dice"]["seed"], camp["dice"]["n"]) if camp else None
        self.lock = threading.RLock()
        self.recent_actions = {}
        self.session_start = time.time()

    # ================================================================ creating a campaign
    @classmethod
    def new(cls, name="Hero", species="human", cls_id="warrior", genre=None, premise=None, seed=None, settings=None,
            vermeil_voice=None, use_ai=True, companion_profile=None):
        C = content()
        if cls_id not in C.classes: raise GameError("Unknown class.")
        sp = next((s for s in C.playable_species() if s["id"] == species), None)
        if not sp or not sp["available"]: raise GameError("That species has no model in your asset library - pick another.")
        seed = seed if seed is not None else int.from_bytes(os.urandom(4), "big")
        camp = {"save_version": SAVE_VERSION, "id": f"camp-{uuid.uuid4().hex[:10]}", "seed": seed, "created": time.time(),
                "play_seconds": 0.0, "settings": dict(DEFAULT_SETTINGS, **(settings or {})), "uid_counter": 0,
                "dice": {"seed": seed, "n": 0}, "party": [], "inventory": [], "gold": 40, "history": [], "choices": [],
                "awarded": [], "stats": {"monsters_defeated": 0, "bosses_defeated": [], "quests_completed": 0, "side_quests_completed": 0,
                                         "xp_earned": 0, "gold_earned": 0, "damage_dealt": 0, "damage_taken": 0, "crits": 0, "misses": 0,
                                         "major_items": [], "places_visited": 1, "treasures": 0, "recruits": []},
                "turn": 0, "status": "active", "pending_cards": [], "card_history": [], "combat": None, "layouts": {}, "shops": {},
                "side_quests": [], "vermeil_memory": [], "start_level": 1, "action_log": [], "level_scale": 100}
        cp = companion_profile or {}
        camp["companion"] = {k: cp.get(k) for k in ("id", "name", "persona", "model", "body", "gender")}
        camp["companion"]["name"] = (str(cp.get("name") or "").strip() or "Vermeil")[:24]
        g = cls(camp)
        if not use_ai: ai.disable(True)
        world.generate(camp, genre=genre, premise=premise)
        player = make_hero(camp, (name or "Hero").strip()[:24] or "Hero", species, cls_id, kind="player")
        camp["party"].append(player)
        starting_gear(camp, player, g.dice)
        # Vermeil: her own model by default; class/species randomised only when the settings say so
        st = camp["settings"]
        vcls = st.get("vermeil_class") or "rogue"
        if st.get("randomize_vermeil_class"):
            vcls = g.dice.pick(sorted(C.classes), "vermeil_class")
        vspecies, vmodel, vbody = "human", cp.get("model") or VERMEIL_MODEL, cp.get("body") or "humanoid"
        if st.get("randomize_vermeil_look"):
            ok = [s for s in C.playable_species() if s["available"] and s["models"]]
            if ok:
                s = g.dice.pick(ok, "vermeil_species")
                vspecies, vmodel, vbody = s["id"], g.dice.pick(s["models"], "vermeil_model"), "humanoid"
        v = make_vermeil(camp, vcls, vspecies, vmodel, name=camp["companion"]["name"], body=vbody, gender=cp.get("gender") or "female")
        if cp.get("size") and vmodel == cp.get("model"): v["size"] = cp["size"]
        camp["party"].append(v)
        world.unique_npc_models(camp)            # no NPC looks like you or your companion (only monsters repeat)
        camp["npc_looks"] = 1
        rap =add(camp, make_item(camp, "rapier", rarity="uncommon"))
        v["equipment"]["weapon"] = rap["uid"]
        arm = add(camp, make_item(camp, "leather_armor", rarity="common"))
        v["equipment"]["armor"] = arm["uid"]
        v["hp"], v["mana"] = stats(v, camp)["hp"], stats(v, camp)["mana"]
        # fetch-quest relics
        for s in camp["quest"]["stages"]:
            if s["kind"] == "fetch":
                loc = camp["locations"][s["location"]]
                loc["treasure"].append({"id": f"{loc['id']}R", "item": "quest_item", "gold": 0, "found": False, "relic": s["item"], "stage": s["id"]})
        voices.assign(camp, cp.get("voice") or vermeil_voice, cp)
        intro = dm.intro(camp)
        camp["quest"]["title"] = intro["title"]
        camp["world"]["facts"] += intro.get("facts", [])
        camp["intro"] = intro
        g.say("dm", intro["intro"])
        g.save_dice()
        return g

    # ================================================================ helpers
    def save_dice(self):
        self.camp["dice"] = self.dice.state()

    def say(self, who, text, name=None):
        if not text: return
        self.camp["history"].append({"who": who, "name": name, "text": text[:600], "turn": self.camp["turn"]})
        del self.camp["history"][:-120]

    def loc(self, lid=None):
        return self.camp["locations"][lid or self.camp["location"]]

    def player(self):
        return next(p for p in self.camp["party"] if p.get("kind") == "player")

    def in_combat(self):
        cb = self.camp.get("combat")
        return bool(cb and cb.get("phase") not in (None, "ended"))

    def tick(self):
        self.camp["turn"] += 1
        now = time.time()
        self.camp["play_seconds"] += min(600, now - getattr(self, "_last_tick", now))
        self._last_tick = now

    def vermeil(self, situation, detail="", force=False, events=None):
        if not any(p["uid"] == "vermeil" and p["alive"] for p in self.camp["party"]): return None
        r = companion.react(self.camp, situation, detail, force=force)
        if r:
            self.say("vermeil", r["line"], companion.name(self.camp))
            if events is not None: events.append({"type": "speech", "speaker": "vermeil", "name": companion.name(self.camp), "text": r["line"], "mood": r["mood"]})
        return r

    def narrate(self, events, text, kind="dm"):
        if not text: return
        self.say("dm", text)
        events.append({"type": "speech", "speaker": "dm", "name": "Dungeon Master", "text": text})

    # ================================================================ state for the client
    def layout_for(self, lid, came_from=None):
        lay = self.camp["layouts"].get(lid)
        if not lay or lay.get("version") != layout.VERSION or (came_from and lay.get("came_from") != came_from):
            lay = layout.build(self.camp, self.loc(lid), came_from)
            lay["came_from"] = came_from
            self.camp["layouts"][lid] = lay
        return lay

    def npc_public(self, n):
        return {"id": n["id"], "name": n["name"], "role": n["role"], "model": n["model"], "parts": n.get("parts"), "gender": n.get("gender"),
                "personality": n["personality"], "routine": n["routine"], "met": n.get("met"), "shop": n.get("shop"), "trader": n.get("role") == "wandering_trader",
                "recruitable": n.get("recruitable"), "scale": n.get("scale", 1), "seed": n.get("seed", 1), "relationship": n.get("relationship", 0)}

    def location_public(self, lid=None):
        C = content()
        l = self.loc(lid)
        lay = self.layout_for(l["id"], self.camp.get("came_from"))
        if lay.get("exits"):                          # sealed exits show a lock (the saved layout itself stays as it is)
            lay = dict(lay, exits=[dict(e, locked=self.blocked(e["to"]) if e.get("to") in self.camp["locations"] else None) for e in lay["exits"]])
        encs = []
        for i, e in enumerate(l["encounters"]):
            if e["done"]: continue
            pts = lay["spawns"]["enemy"]
            p = pts[i % len(pts)] if pts else {"x": 8, "z": 8}
            encs.append({"id": e["id"], "boss": e.get("boss", False), "x": p["x"], "z": p["z"],
                         "enemies": [{"template": t, "level": lv, "name": C.enemy(t)["name"],
                                      "model": C.available_models(C.enemy(t)["models"])[0], "body": C.enemy(t).get("body"),
                                      "size": C.enemy(t).get("size"), "sound": C.enemy(t).get("sound"), "tint": C.enemy(t).get("tint")} for t, lv in e["enemies"]]})
        tres = []
        for t in l["treasure"]:
            sp = next((s for s in lay["spawns"]["treasure"] if s["id"] == t["id"]), None)
            if not sp and t.get("relic"):
                sp = {"x": lay["spawns"]["enemy"][0]["x"] + 2 if lay["spawns"]["enemy"] else 6, "z": lay["spawns"]["enemy"][0]["z"] if lay["spawns"]["enemy"] else 6, "r": 0}
            if sp: tres.append({"id": t["id"], "x": sp["x"], "z": sp["z"], "r": sp.get("r", 0), "found": t["found"], "relic": bool(t.get("relic"))})
        return {"id": l["id"], "name": l["name"], "biome": l["biome"], "biome_name": C.biomes[l["biome"]]["name"], "safe": l["safe"],
                "kind": l["kind"], "level": l["level"], "layout": lay, "encounters": encs, "treasure": tres,
                "npcs": [self.npc_public(self.camp["npcs"][n]) for n in l["npcs"] if not self.camp["npcs"][n].get("joined") and self.camp["npcs"][n].get("alive")]}

    def map_public(self):
        L = self.camp["locations"]
        q = self.camp["quest"]
        cur_stage = q["stages"][q["current"]]["location"] if q["current"] < len(q["stages"]) else None
        N = self.camp.get("npcs", {})
        tr = (self.camp.get("trader") or {}).get("npc")
        trader_at = N.get(tr, {}).get("location") if tr and N.get(tr, {}).get("alive", True) else None
        shops = {lid for lid, l in L.items() if l["discovered"] and any(N.get(n, {}).get("shop") and N.get(n, {}).get("role") != "wandering_trader" for n in l["npcs"])}
        test = self.camp["settings"].get("test_mode")             # test mode sees every name (for teleporting)
        return [{"id": l["id"], "name": l["name"] if l["discovered"] or test else "???", "biome": l["biome"] if l["discovered"] or test else None,
                 "x": l["x"], "y": l["y"], "links": l["links"], "discovered": l["discovered"], "visited": l["visited"],
                 "here": l["id"] == self.camp["location"], "safe": l["safe"], "level": l["level"],
                 "objective": l["id"] == cur_stage, "cleared": all(e["done"] for e in l["encounters"]), "locked": self.blocked(l["id"]),
                 "shop": l["id"] in shops, "trader": l["id"] == trader_at and l["discovered"], "boss": l["kind"] == "boss", "col": l["col"]}
                for l in L.values()]                    # the whole road shows; places you haven't found yet are "???"

    def inventory_public(self):
        C = content()
        wearer = {}
        for p in self.camp["party"]:
            for s, u in (p.get("equipment") or {}).items():
                if u: wearer[u] = p["name"]
        out = []
        for it in self.camp.get("inventory", []):
            x = dict(it)
            x["equipped_by"] = wearer.get(it["uid"])
            x["color"] = C.rarities[it["rarity"]]["color"]
            out.append(x)
        return out

    def quest_public(self):
        q = self.camp["quest"]
        return {"title": q.get("title"), "premise": q["premise"], "current": q["current"],
                "stages": [{"objective": s["objective"], "done": s["done"], "location": self.camp["locations"][s["location"]]["name"]
                            if self.camp["locations"][s["location"]]["discovered"] else "???", "current": i == q["current"]}
                           for i, s in enumerate(q["stages"])],
                "side": self.camp.get("side_quests", []), "boss": q["boss"]["name"] if q["current"] >= len(q["stages"]) - 1 else "???"}

    def combat_public(self):
        if not self.in_combat(): return None
        cb = self.camp["combat"]
        acts = combat.actors(self.camp)
        cur = cb.get("waiting_for")
        return {"id": cb["id"], "round": cb["round"] + 1, "phase": cb["phase"], "waiting_for": cur, "order": cb["order"],
                "actors": [public(a, self.camp) for a in acts.values()], "boss": cb["boss"], "flee_allowed": cb["flee_allowed"],
                "options": combat.options(self.camp, acts[cur]) if cur and cur in acts else None}

    def state(self, full=True):
        camp = self.camp
        C = content()
        s = {"id": camp["id"], "status": camp["status"], "title": camp["quest"].get("title"), "turn": camp["turn"],
             "world": {k: camp["world"][k] for k in ("genre", "genre_name", "mix_name", "premise")},
             "party": [dict(public(p, camp), xp_next=xp_to_next(p["level"]), cards=p.get("cards", [])) for p in camp["party"]],
             "gold": camp.get("gold", 0), "quest": self.quest_public(), "combat": self.combat_public(),
             "pending_cards": [card_offer_public(o) for o in camp.get("pending_cards", [])],
             "settings": camp["settings"], "history": camp["history"][-40:], "play_seconds": int(camp["play_seconds"]),
             "location_id": camp["location"], "ending": camp.get("ending"), "seed": camp["seed"], "test_unlock": bool(camp.get("test_unlock"))}
        if full:
            s["location"] = self.location_public()
            s["map"] = self.map_public()
            s["inventory"] = self.inventory_public()
            s["card_history"] = camp.get("card_history", [])
            s["dice_faces"] = None
        return s

    # ================================================================ the main free-text action
    def action(self, text, action_id=None, req_id=None):
        """the player typed something. Returns {'events': [...], 'state': {...}}."""
        with self.lock:
            if action_id and action_id in self.recent_actions:      # double-submit protection
                return self.recent_actions[action_id]
            if self.camp["status"] != "active":
                raise GameError("This campaign is finished - start a new adventure or load a save.")
            if self.camp.get("pending_cards"):
                raise GameError("Choose an upgrade card first.")
            text = (text or "").strip()[:content().rules["max_action_length"]]
            if not text: raise GameError("Type what you want to do.")
            self.tick()
            self.say("player", text, self.player()["name"])
            events = []
            intent = dm.interpret(self.camp, text, req_id=req_id)
            events.append({"type": "intent", "intent": intent["intent"], "source": intent.get("source")})
            if intent.get("clarify") and intent["intent"] == "unclear":
                self.narrate(events, intent["clarify"])
            elif self.in_combat():
                events += self._combat_text(intent, text)
            else:
                events += self._explore(intent, text)
            if intent.get("fact"): self._fact(intent["fact"])
            self.save_dice()
            out = {"events": events, "state": self.state()}
            self.recent_actions[action_id or str(time.time())] = out
            while len(self.recent_actions) > 20: self.recent_actions.pop(next(iter(self.recent_actions)))
            self._autosave_if_needed(events)
            return out

    def _fact(self, f):
        facts = self.camp["world"].setdefault("facts", [])
        if f and f not in facts:
            facts.append(f)
            del facts[:-40]

    # ---------------------------------------------------------------- combat by text
    def _combat_text(self, intent, text):
        cb = self.camp["combat"]
        who = cb.get("waiting_for")
        if cb["phase"] != "player_input" or not who:
            raise GameError("Wait for your turn.")
        actor = combat.get(self.camp, who)
        i = intent["intent"]
        act = None
        if i == "ability" and intent.get("ability") in actor["abilities"]:
            act = {"type": "ability", "ability": intent["ability"], "target": intent.get("target")}
        elif i == "attack":
            basic = "basic_shot" if combat.weapon_dice(actor, self.camp)[2] else "basic_attack"
            act = {"type": "ability", "ability": basic, "target": intent.get("target")}
        elif i == "item" and intent.get("item"):
            act = {"type": "item", "item": intent["item"], "target": intent.get("target")}
        elif i == "defend":
            act = {"type": "defend"}
        elif i == "flee":
            act = {"type": "flee"}
        elif intent.get("check"):
            act = {"type": "maneuver", "stat": intent["check"]["stat"], "dc": intent["check"]["dc"], "effect": intent.get("effect") or "damage",
                   "name": intent.get("name") or "Clever Move", "on_success": intent.get("on_success"), "on_fail": intent.get("on_fail"),
                   "target": intent.get("target")}
            self.camp["choices"].append(f"In battle: {text[:80]}")
        if not act:
            basic = "basic_shot" if combat.weapon_dice(actor, self.camp)[2] else "basic_attack"
            act = {"type": "ability", "ability": basic, "target": intent.get("target")}
        events = []
        if intent.get("narration") and intent.get("source") == "ai":
            self.narrate(events, intent["narration"])
        events += self.combat_act(who, act, _locked=True)
        return events

    def combat_act(self, uid, act, _locked=False):
        """structured combat action (buttons / text both end here)."""
        lock = self.lock if not _locked else _Null()
        with lock:
            if not self.in_combat(): raise GameError("There's no battle going on.")
            try:
                events = combat.submit(self.camp, uid, act, self.dice)
            except combat.ActionError as e:
                raise GameError(str(e))
            events = self._after_combat_events(events)
            self.save_dice()
            return events

    def _after_combat_events(self, events):
        """reactions + what happens when a battle ends (quest progress, defeat, ending)."""
        cb = self.camp["combat"]
        player = self.player()
        for e in events:
            if e["type"] == "hit" and e["target"] == player["uid"] and player["alive"] and player["hp"] < stats(player, self.camp)["hp"] * 0.3:
                self.vermeil("player_hurt", events=None)
                break
        if self.in_combat() and self.camp["settings"].get("vermeil_control") in ("tactical", "advice") and cb.get("waiting_for") == player["uid"]:
            tip = companion.tactical_advice(self.camp)
            if tip:
                self.say("vermeil", tip, companion.name(self.camp))
                events.append({"type": "speech", "speaker": "vermeil", "name": companion.name(self.camp), "text": tip, "mood": "determined", "advice": True})
        if cb.get("phase") == "ended":
            events += self._combat_over()
        return events

    def _combat_over(self):
        cb = self.camp["combat"]
        loc = self.loc()
        ev = []
        res = cb["result"]
        if res == "victory":
            enc = next((e for e in loc["encounters"] if e["id"] == cb.get("encounter")), None)
            if enc: enc["done"] = True
            boss_down = any((cb["enemies"].get(u) or {}).get("kind") == "boss" for u in cb["defeated"])
            self.vermeil("victory", events=ev)
            ev += self._monster_join_roll(cb)
            ev += self._quest_check()
            if boss_down and self.camp["quest"]["boss"]["defeated"]:
                ev += self._finish_campaign()
            self.camp["choices"].append(f"Won a battle at {loc['name']}")
        elif res == "defeat":
            ev += self._defeat()
        elif res == "fled":
            self.narrate(ev, "You break away and catch your breath at a safe distance.")
        self.camp["combat"] = None if res != "victory" else dict(cb, phase="ended")
        return ev

    MONSTER_JOIN_CHANCE = 0.05          # a beaten monster sometimes wants to follow you...
    ALPHA_JOIN_CHANCE = 0.004           # ...an alpha almost never does

    def _monster_join_roll(self, cb):
        """after a win, maybe one defeated monster asks to join (bosses never). Party max = rules party_size."""
        C = content()
        if sum(1 for p in self.camp["party"] if p.get("kind") != "summon") >= C.rules["party_size"]:
            return []
        for uid in cb.get("defeated", []):
            e = cb["enemies"].get(uid)
            if not e or e.get("kind") != "enemy" or e.get("template") in C.bosses:
                continue
            if self.dice.chance(self.ALPHA_JOIN_CHANCE if e.get("alpha") else self.MONSTER_JOIN_CHANCE, "monster_join"):
                self.camp["monster_offer"] = {k: v for k, v in e.items() if k not in ("statuses", "cooldowns")}
                return [{"type": "monster_offer", "name": e["name"], "level": e["level"], "alpha": bool(e.get("alpha")), "model": e.get("model"),
                         "text": f"The defeated {e['name']} (level {e['level']}) doesn't run. It bows its head and looks at you... it wants to join your party!"}]
        return []

    def monster_recruit(self, accept):
        with self.lock:
            offer = self.camp.pop("monster_offer", None)
            if not offer:
                raise GameError("No monster is waiting to join.")
            ev = []
            if not accept:
                self.narrate(ev, f"The {offer['name']} watches you go, then slips away.")
                return ev
            if sum(1 for p in self.camp["party"] if p.get("kind") != "summon") >= content().rules["party_size"]:
                raise GameError("Your party is full (6).")
            a = make_monster_ally(self.camp, offer)
            self.camp["party"].append(a)
            self.camp["stats"].setdefault("recruits", []).append(a["name"])
            self.narrate(ev, f"{a['name']} joins your party!")
            ev.append({"type": "recruit", "actor": public(a, self.camp), "text": f"{a['name']} joined the party!"})
            self._autosave()
            return ev

    def _defeat(self):
        ev = []
        safe = self.camp.get("last_safe") or self.camp["location"]
        lost = int(self.camp.get("gold", 0) * 0.15)
        self.camp["gold"] = self.camp.get("gold", 0) - lost
        for p in self.camp["party"]:
            p["alive"] = True
            p["hp"] = max(1, stats(p, self.camp)["hp"] // 2)
            p["statuses"] = []
        enc = self.loc().get("encounters", [])
        self.camp["came_from"] = None
        self.camp["location"] = safe
        self.narrate(ev, f"Everything goes dark... You wake in {self.loc(safe)['name']}, bruised but alive. "
                         f"{'You lost ' + str(lost) + ' gold. ' if lost else ''}The enemies are still out there.")
        self.vermeil("defeat", force=True, events=ev)
        ev.append({"type": "travel", "to": safe, "location": self.location_public(), "defeat": True})
        return ev

    # ---------------------------------------------------------------- exploring by text
    def _explore(self, intent, text):
        i = intent["intent"]
        ev = []
        loc = self.loc()
        if intent.get("narration") and intent.get("source") == "ai" and i not in ("move", "talk"):
            self.narrate(ev, intent["narration"])
        if i == "move":
            dest = intent.get("destination")
            if not dest:
                self.narrate(ev, "Where to? The paths lead to: " + ", ".join(self.loc(x)["name"] if self.loc(x)["discovered"] else "an unexplored trail" for x in loc["links"]) + ".")
                return ev
            return ev + self.travel(dest, _locked=True)
        if i in ("talk", "shop", "recruit"):
            npc_id = intent.get("target") if intent.get("target") in loc["npcs"] else None
            if not npc_id:
                here = [n for n in loc["npcs"] if not self.camp["npcs"][n].get("joined")]
                if not here:
                    self.narrate(ev, "There's nobody here to talk to.")
                    return ev
                npc_id = here[0]
            if i == "shop":
                return ev + self.open_shop(npc_id, _locked=True)
            if i == "recruit":
                return ev + self.ask_recruit(npc_id, _locked=True)
            return ev + self.talk(npc_id, text, _locked=True)
        if i == "attack":
            enc = next((e for e in loc["encounters"] if not e["done"]), None)
            if enc: return ev + self.engage(enc["id"], _locked=True)
            if intent.get("target") in loc["npcs"]:
                n = self.camp["npcs"][intent["target"]]
                n["relationship"] = n.get("relationship", 0) - 2
                self.narrate(ev, f"{n['name']} jumps back, horrified. Nearby folk glare at you. Maybe don't attack the locals.")
                self.vermeil("reckless", "The player tried to attack a peaceful villager.", events=ev)
                return ev
            self.narrate(ev, "There's nothing here to fight... for now.")
            return ev
        if i in ("search", "inspect"):
            return ev + self.search(intent, _locked=True)
        if i == "interact":
            t = next((t for t in loc["treasure"] if not t["found"]), None)
            if t: return ev + self.open_treasure(t["id"], _locked=True)
            self.narrate(ev, "Nothing here to open.")
            return ev
        if i == "rest":
            return ev + self.rest(_locked=True)
        if i == "item" and intent.get("item"):
            return ev + self.use_item(intent["item"], intent.get("target") or self.player()["uid"], _locked=True)
        if i == "quest":
            q = dm.current_objective(self.camp)
            self.narrate(ev, f"Your goal: {q['objective']}.")
            return ev
        # creative actions out of combat: a skill check with a validated result
        chk = intent.get("check") or {"stat": "wis", "dc": 12}
        r = self._check(chk["stat"], chk["dc"], intent.get("name") or "Attempt")
        ev.append(r["event"])
        txt = intent.get("on_success") if r["ok"] else intent.get("on_fail")
        self.narrate(ev, txt or ("It works out." if r["ok"] else "It doesn't work out."))
        self.camp["choices"].append(text[:100])
        if r["ok"] and intent.get("effect") == "discover":
            ev += self._discover()
        if not r["ok"] and r["natural"] == 1:
            self.vermeil("reckless", f"The player tried: {text[:80]} and failed badly.", events=ev)
        return ev

    def _check(self, stat, dc, name):
        C = content()
        p = self.player()
        attrs = C.classes[p["cls"]]["attrs"]
        mod = (attrs.get(stat, 10) - 10) // 2 + C.species[p["species"]].get("check_bonus", 0) + int(power(p["level"])) // 3
        r = self.dice.d20(name, mod)
        ok = r["natural"] == 20 or (r["natural"] != 1 and r["total"] >= dc)
        return {"ok": ok, "natural": r["natural"], "event": {"type": "dice", "die": 20, "rolls": r["rolls"], "mod": r["mod"], "total": r["total"],
                "who": p["uid"], "reason": f"{stat.upper()} check", "vs": dc, "natural": r["natural"], "success": ok}}

    def _discover(self):
        """a successful search: reveal treasure / progress an 'explore' quest step."""
        ev = []
        loc = self.loc()
        q = self.camp["quest"]
        st = q["stages"][q["current"]] if q["current"] < len(q["stages"]) else None
        if st and st["kind"] == "explore" and st["location"] == loc["id"] and not st["done"]:
            st["explored"] = True
            ev += self._quest_check()
        hidden = [t for t in loc["treasure"] if not t["found"] and not t.get("revealed")]
        if hidden:
            hidden[0]["revealed"] = True
            ev.append({"type": "reveal", "treasure": hidden[0]["id"]})
            self.narrate(ev, "You spot something tucked away - a chest!")
            self.vermeil("discovery", events=ev)
        elif not ev:
            if self.dice.chance(0.35, "find"):
                it = add(self.camp, make_item(self.camp, self.dice.pick(["potion_small", "ether_small", "trail_ration", "antidote"], "find"), dice=self.dice))
                ev.append({"type": "loot", "items": [{"name": it["name"], "rarity": it["rarity"], "model": it.get("model")}]})
                self.narrate(ev, f"You find a {it['name']}.")
            else:
                self.narrate(ev, "You search carefully, but find nothing more.")
        return ev

    def search(self, intent=None, _locked=False):
        with (self.lock if not _locked else _Null()):
            chk = (intent or {}).get("check") or {"stat": "wis", "dc": 11}
            r = self._check(chk["stat"], chk["dc"], "Search")
            ev = [r["event"]]
            if r["ok"]:
                ev += self._discover()
            else:
                self.narrate(ev, (intent or {}).get("on_fail") or "You look around but nothing stands out.")
            return ev

    # ---------------------------------------------------------------- travel
    def blocked(self, lid):
        """why a place can't be entered yet (None = open). The story goes in order: places beyond your current
        objective stay sealed until you finish it, and the final lair opens only after every other step."""
        L = self.loc(lid)
        q = self.camp["quest"]
        if self.camp["settings"].get("test_mode") and self.camp.get("test_unlock"):
            return None
        if q["current"] >= len(q["stages"]) or L.get("visited") and L["kind"] != "boss":
            return None
        st = q["stages"][q["current"]]
        goal = self.loc(st["location"])
        if L["kind"] == "boss" and st["kind"] != "boss":
            return f"A dark power seals the way to {L['name']}. First: {st['objective']}."
        if L["col"] > goal["col"]:
            return f"The trail to {L['name']} is too dangerous for now. First: {st['objective']}."
        return None

    def travel(self, dest, _locked=False):
        with (self.lock if not _locked else _Null()):
            if self.in_combat(): raise GameError("You can't leave in the middle of a fight - try to flee first.")
            cur = self.loc()
            teleport = self.camp["settings"].get("test_mode") and self.camp.get("test_teleport")
            self.camp.pop("test_teleport", None)
            if dest not in self.camp["locations"] or dest not in cur["links"] and not teleport: raise GameError("You can't get there from here.")
            why = self.blocked(dest)
            if why: raise GameError(why)
            ev = []
            L = self.loc(dest)
            first = not L["visited"]
            self.camp["came_from"] = cur["id"]
            self.camp["location"] = dest
            L["visited"] = L["discovered"] = True
            for x in L["links"]: self.loc(x)["discovered"] = True
            if L["safe"]: self.camp["last_safe"] = dest
            if not first and self.dice.chance(0.45, "roaming"):
                enc = world.roaming(self.camp, L, stream(self.camp["seed"], "roam", self.camp["turn"]))
                if enc: self.camp["layouts"].pop(dest, None) if False else None
            if first: self.camp["stats"]["places_visited"] = self.camp["stats"].get("places_visited", 0) + 1
            trader = self._trader_moves(L)
            ev.append({"type": "travel", "from": cur["id"], "to": dest, "location": self.location_public()})
            txt, fact = dm.describe(self.camp, L, first)
            self.narrate(ev, txt)
            if fact: self._fact(fact)
            if first: self.vermeil("arrive", f"Arrived at {L['name']}.", events=ev)
            if trader:
                self.narrate(ev, f"A wandering trader, {trader['name']}, has stopped here with a loaded cart. "
                                 f"Their goods are rare - and priced like it.")
                ev.append({"type": "trader", "npc": trader["id"], "name": trader["name"]})
            ev += self._quest_check()
            q = self.camp["quest"]
            st = q["stages"][q["current"]] if q["current"] < len(q["stages"]) else None
            if st and st["location"] == dest and st["kind"] != "boss":
                self.narrate(ev, {"explore": "This is the place. Clear out whatever lurks here, then search carefully - something is hidden nearby.",
                                  "slay": "This is the place. Defeat every monster here to free it.",
                                  "fetch": "This is the place. The relic is somewhere here - find the glowing chest."}[st["kind"]])
            if st and st["location"] == dest and st["kind"] == "boss":
                self.narrate(ev, f"The air turns cold. {q['boss']['name']} is here.")
                self.vermeil("boss", force=True, events=ev)
            # new areas open up when the map runs out of unexplored places
            unvisited = [l for l in self.camp["locations"].values() if not l["visited"] and l["kind"] != "boss"]
            if not unvisited and len(self.camp["locations"]) < 18 and not L.get("generated_later"):
                nl = world.extend(self.camp, dest)
                voices.assign(self.camp)
                self.narrate(ev, f"A new trail leads off toward {nl['name']}.")
                ev.append({"type": "map_update"})
            self._autosave()
            return ev

    # ---------------------------------------------------------------- people
    def talk(self, npc_id, text, _locked=False, req_id=None):
        with (self.lock if not _locked else _Null()):
            loc = self.loc()
            if npc_id not in loc["npcs"]: raise GameError("They're not here.")
            n = self.camp["npcs"][npc_id]
            ev = []
            first = not n.get("met")
            n["met"] = True
            r = dm.npc_reply(self.camp, n, text, req_id=req_id)
            n["relationship"] = max(-3, min(3, n.get("relationship", 0) + r["relationship_change"]))
            n["memory"] = (n.get("memory", []) + [f"Player: {text[:120]}", f"Me: {r['reply'][:160]}"])[-12:]
            self.say(npc_id, r["reply"], n["name"])
            ev.append({"type": "speech", "speaker": npc_id, "name": n["name"], "text": r["reply"], "mood": r["mood"], "npc": npc_id})
            if r.get("fact"): self._fact(r["fact"])
            if r.get("offers_quest") and r.get("quest_hint"):
                ev += self._side_quest(n, r["quest_hint"])
            if n.get("shop") and re.search(r"\b(buy|sell|shop|trade|wares|goods)\b", text.lower()):
                ev += self.open_shop(npc_id, _locked=True)
            if r.get("wants_to_join") or re.search(r"\b(join|come with us|recruit)\b", text.lower()):
                ev += self.ask_recruit(npc_id, _locked=True)
            elif first and self.dice.chance(0.4, "npc_react"):
                self.vermeil("npc", f"Met {n['name']}, a {n['personality']} {n['role']}.", events=ev)
            self.save_dice()
            return ev

    def _side_quest(self, npc, hint):
        """turn an NPC's request into a real side quest the engine can track (slay or fetch nearby)."""
        sq = self.camp.setdefault("side_quests", [])
        if any(q["giver"] == npc["id"] and not q["done"] for q in sq) or len([q for q in sq if not q["done"]]) >= 3:
            return []
        here = self.loc()
        cands = [x for x in here["links"] if not self.loc(x)["safe"]] or [here["id"]]
        tgt = self.loc(self.dice.pick(sorted(cands), "side_target"))
        enc = world.make_encounter(self.camp, tgt, stream(self.camp["seed"], "side", len(sq)), f"{tgt['id']}S{len(sq)}")
        tgt["encounters"].append(enc)
        tgt["discovered"] = True
        q = {"id": f"q{len(sq) + 1}", "giver": npc["id"], "giver_name": npc["name"], "text": hint, "location": tgt["id"],
             "location_name": tgt["name"], "encounter": enc["id"], "done": False, "reward_gold": 30 + int(15 * power(tgt["level"])),
             "objective": f"{hint} (at {tgt['name']})"}
        sq.append(q)
        if tgt["id"] in self.camp["layouts"]: pass
        return [{"type": "quest_new", "quest": q, "text": f"New side quest: {q['objective']}"}]

    def ask_recruit(self, npc_id, _locked=False):
        with (self.lock if not _locked else _Null()):
            n = self.camp["npcs"][npc_id]
            ev = []
            if not n.get("recruitable"):
                self.say(npc_id, "Adventuring? Not for me.", n["name"])
                ev.append({"type": "speech", "speaker": npc_id, "name": n["name"], "text": "Adventuring? Not for me - my place is here.", "npc": npc_id})
                return ev
            r = world.recruit_roll(self.camp, n, self.dice)
            if r == "full":
                ev.append({"type": "recruit_full", "npc": npc_id, "name": n["name"],
                           "party": [{"uid": p["uid"], "name": p["name"]} for p in self.camp["party"] if p.get("kind") == "ally"],
                           "text": f"{n['name']} wants to join, but your party is full. Replace someone, or leave them here?"})
                n["wants_to_join"] = True
                return ev
            if r:
                n["wants_to_join"] = True
                ev.append({"type": "recruit_offer", "npc": npc_id, "name": n["name"],
                           "text": f"{n['name']} would like to join your party!"})
            else:
                line = {"shy": "I... I'm not brave enough. Not yet.", "greedy": "Maybe if there's more gold in it.",
                        "suspicious": "I don't know you well enough."}.get(n["personality"], "Not right now. Ask me again once you've proven yourselves.")
                self.say(npc_id, line, n["name"])
                ev.append({"type": "speech", "speaker": npc_id, "name": n["name"], "text": line, "npc": npc_id})
            self.save_dice()
            return ev

    def recruit_answer(self, npc_id, accept, replace_uid=None):
        with self.lock:
            n = self.camp["npcs"].get(npc_id)
            if not n or not n.get("wants_to_join") or n.get("joined"): raise GameError("They haven't offered to join.")
            ev = []
            if not accept:
                n["wants_to_join"] = False
                self.narrate(ev, f"You thank {n['name']}, but travel on without them.")
                return ev
            members = [p for p in self.camp["party"] if p.get("kind") != "summon"]
            if len(members) >= content().rules["party_size"]:
                if not replace_uid: raise GameError("Your party is full - choose who leaves.")
                self.dismiss(replace_uid, _locked=True)
            lvl = max(1, self.player()["level"] - 1)
            a = make_recruit(self.camp, n, lvl)
            self.camp["party"].append(a)
            n["joined"] = True
            self.camp["stats"].setdefault("recruits", []).append(n["name"])
            self.camp["choices"].append(f"Recruited {n['name']}")
            voices.assign(self.camp)
            self.camp["voices"][a["uid"]] = self.camp["voices"].get(npc_id)
            ev.append({"type": "recruit", "actor": public(a, self.camp), "text": f"{n['name']} joins the party!"})
            self.vermeil("recruit", f"{n['name']} joined.", events=ev)
            self._autosave()
            return ev

    def dismiss(self, uid, _locked=False):
        with (self.lock if not _locked else _Null()):
            a = next((p for p in self.camp["party"] if p["uid"] == uid), None)
            if not a or a.get("kind") != "ally": raise GameError("Only recruited allies can leave the party.")
            if self.in_combat(): raise GameError("Not in the middle of a fight!")
            for s in EQUIP_SLOTS: a["equipment"][s] = None
            self.camp["party"].remove(a)
            n = self.camp["npcs"].get(a.get("npc_id"))
            if n:                                # they wait in the nearest settlement - never silently deleted
                n["joined"] = False
                n["wants_to_join"] = False
                safe = self.camp.get("last_safe") or self.camp["location"]
                old = self.loc(n["location"])
                if n["id"] in old["npcs"]: old["npcs"].remove(n["id"])
                n["location"] = safe
                self.loc(safe)["npcs"].append(n["id"])
            return [{"type": "dismiss", "uid": uid, "text": f"{a['name']} leaves the party and will wait at {self.loc(self.camp.get('last_safe') or self.camp['location'])['name']}."}]

    # ---------------------------------------------------------------- shops
    RESTOCK_TURNS = 14

    def open_shop(self, npc_id, _locked=False):
        with (self.lock if not _locked else _Null()):
            n = self.camp["npcs"].get(npc_id)
            if not n or not n.get("shop"): raise GameError("They don't sell anything.")
            meta = self.camp.setdefault("shop_meta", {})
            stale = self.camp["turn"] - meta.get(npc_id, {}).get("turn", -10 ** 6) >= self.RESTOCK_TURNS
            if npc_id not in self.camp["shops"] or (stale and n["role"] != "wandering_trader"):
                self.camp["shops"][npc_id] = shop_stock(self.camp, self.loc(n["location"])["level"], self.dice, n["role"])
                meta[npc_id] = {"turn": self.camp["turn"]}
                self.save_dice()
            return [{"type": "shop", "npc": npc_id, "name": n["name"], "role": n["role"], "goods": self.camp["shops"][npc_id],
                     "services": self.services(npc_id)}]

    def services(self, npc_id):
        """extra things to spend gold on at this shop: reforging gear (blacksmith/engineer), a safe night at the inn."""
        n = self.camp["npcs"].get(npc_id) or {}
        out = {}
        if n.get("role") in ("blacksmith", "engineer"):
            gear = [it for it in self.camp.get("inventory", []) if it["slot"] in EQUIP_SLOTS]
            out["reforge"] = [{"uid": it["uid"], "name": it["name"], "rarity": it["rarity"], "slot": it["slot"], "plus": it.get("plus", 0),
                               "cost": reforge_cost(it), "maxed": it.get("plus", 0) >= REFORGE_MAX,
                               "worn_by": next((p["name"] for p in self.camp["party"] if it["uid"] in (p.get("equipment") or {}).values()), None)}
                              for it in gear]
        if n.get("role") in ("innkeeper", "priest") or (n.get("role") == "merchant" and self.loc(n.get("location")).get("safe")):
            out["inn"] = {"cost": self.inn_cost(), "what": "A hot meal and a safe bed: everyone fully healed, revived and refreshed."}
        return out

    def inn_cost(self):
        return 8 + int(4 * power(self.player()["level"]))

    def inn_rest(self, npc_id):
        with self.lock:
            if self.in_combat(): raise GameError("Not during a fight!")
            if "inn" not in self.services(npc_id): raise GameError("They don't have rooms.")
            cost = self.inn_cost()
            if self.camp.get("gold", 0) < cost: raise GameError(f"Not enough gold ({cost} needed).")
            self.camp["gold"] -= cost
            for p in self.camp["party"]:
                st = stats(p, self.camp)
                p["alive"] = True
                p["hp"], p["mana"] = st["hp"], st["mana"]
                p["statuses"] = []
            self.camp["stats"]["gold_spent"] = self.camp["stats"].get("gold_spent", 0) + cost
            ev = [{"type": "rest", "party": [public(p, self.camp) for p in self.camp["party"]]}]
            self.narrate(ev, f"You pay {cost} gold for a warm meal and soft beds. Everyone wakes up fully rested.")
            self.vermeil("rest", events=ev)
            return ev

    def reforge_item(self, npc_id, item_uid):
        with self.lock:
            if self.in_combat(): raise GameError("Not during a fight!")
            if "reforge" not in self.services(npc_id): raise GameError("Only a blacksmith can do that.")
            it = next((x for x in self.camp.get("inventory", []) if x["uid"] == item_uid), None)
            if not it or it["slot"] not in EQUIP_SLOTS: raise GameError("That can't be reforged.")
            cost = reforge_cost(it)
            if self.camp.get("gold", 0) < cost: raise GameError(f"Not enough gold ({cost} needed).")
            try:
                reforge(self.camp, it)
            except ValueError as e:
                raise GameError(str(e))
            self.camp["gold"] -= cost
            self.camp["stats"]["gold_spent"] = self.camp["stats"].get("gold_spent", 0) + cost
            for p in self.camp["party"]:                 # keep HP inside the (maybe higher) maximum
                p["hp"] = min(p["hp"], stats(p, self.camp)["hp"])
            return {"item": it, "cost": cost, "gold": self.camp["gold"]}

    def _trader_moves(self, L):
        """the wandering trader packs up when you leave and may turn up again somewhere wild. Returns the trader if here."""
        t = self.camp.setdefault("trader", {"npc": None, "last": -99, "misses": 0})
        n = self.camp["npcs"].get(t["npc"]) if t.get("npc") else None
        if n and n.get("location"):
            old = self.camp["locations"].get(n["location"])
            if old and n["id"] in old["npcs"]: old["npcs"].remove(n["id"])
            n["location"] = None
            self.camp["shops"].pop(n["id"], None)
        if L["safe"] or L["kind"] == "boss" or self.camp["turn"] - t["last"] < 2:
            return None
        if not self.dice.chance(min(0.75, 0.3 + 0.1 * t["misses"]), "trader"):
            t["misses"] += 1
            return None
        t["misses"] = 0
        t["last"] = self.camp["turn"]
        if n is None:
            n = world.make_npc(self.camp, L, "wandering_trader", stream(self.camp["seed"], "trader", 0))
            if not n: return None
            n["routine"] = ["stall"]
            n["personality"] = "shrewd but friendly"
            t["npc"] = n["id"]
        else:
            n["location"] = L["id"]
            L["npcs"].append(n["id"])
        self.camp["stats"]["traders_met"] = self.camp["stats"].get("traders_met", 0) + 1
        return n

    def _discount(self):
        from .actors import passive
        return passive(self.player(), self.camp, "discount")

    def buy(self, npc_id, item_uid):
        with self.lock:
            goods = self.camp["shops"].get(npc_id, [])
            it = next((g for g in goods if g["uid"] == item_uid), None)
            if not it: raise GameError("That's not for sale.")
            price = max(1, int(it["price"] * (1 - self._discount())))
            if self.camp.get("gold", 0) < price: raise GameError(f"Not enough gold ({price} needed).")
            self.camp["gold"] -= price
            self.camp["stats"]["gold_spent"] = self.camp["stats"].get("gold_spent", 0) + price
            one = copy.deepcopy(it)
            one["qty"] = 1
            one["uid"] = f"{it['uid']}b{self.camp['uid_counter']}"
            self.camp["uid_counter"] += 1
            one.pop("price", None)
            add(self.camp, one)
            it["qty"] -= 1
            if it["qty"] <= 0: goods.remove(it)
            return {"bought": one["name"], "price": price, "gold": self.camp["gold"]}

    def sell(self, item_uid):
        with self.lock:
            it = next((x for x in self.camp.get("inventory", []) if x["uid"] == item_uid), None)
            if not it: raise GameError("You don't have that.")
            if it.get("quest"): raise GameError("You can't sell quest items.")
            price = max(1, it["value"] // 2)
            remove(self.camp, item_uid)
            self.camp["gold"] = self.camp.get("gold", 0) + price
            return {"sold": it["name"], "price": price, "gold": self.camp["gold"]}

    # ---------------------------------------------------------------- treasure & rest
    def open_treasure(self, tid, _locked=False):
        with (self.lock if not _locked else _Null()):
            loc = self.loc()
            t = next((t for t in loc["treasure"] if t["id"] == tid), None)
            if not t: raise GameError("There's no chest there.")
            if t["found"]: raise GameError("Already opened.")
            key = f"treasure:{self.camp['id']}:{tid}"
            if key in self.camp["awarded"]: raise GameError("Already opened.")
            ev = []
            if t.get("relic") and any(not e["done"] for e in loc["encounters"]):
                self.narrate(ev, "Monsters guard the relic - you'll have to deal with them first.")
                return ev
            self.camp["awarded"].append(key)
            t["found"] = True
            items = []
            if t.get("relic"):
                it = add(self.camp, make_item(self.camp, "quest_item", name=t["relic"], quest_id=t.get("stage")))
                items.append(it)
                st = next((s for s in self.camp["quest"]["stages"] if s["id"] == t.get("stage")), None)
                if st: st["fetched"] = True
            else:
                if t.get("gold"): add(self.camp, make_item(self.camp, "gold", qty=t["gold"]))
                it = add(self.camp, make_item(self.camp, t["item"], dice=self.dice))
                items.append(it)
            self.camp["stats"]["treasures"] = self.camp["stats"].get("treasures", 0) + 1
            for it in items:
                if it["rarity"] in ("rare", "epic", "legendary") or it.get("quest"):
                    self.camp["stats"].setdefault("major_items", []).append({"name": it["name"], "rarity": it["rarity"]})
            ev.append({"type": "chest", "id": tid, "items": [{"name": i["name"], "rarity": i["rarity"], "model": i.get("model")} for i in items],
                       "gold": t.get("gold", 0)})
            self.vermeil("loot", f"Found {', '.join(i['name'] for i in items)}.", events=ev)
            ev += self._quest_check()
            self.save_dice()
            return ev

    def rest(self, _locked=False):
        with (self.lock if not _locked else _Null()):
            if self.in_combat(): raise GameError("You can't rest during a fight!")
            loc = self.loc()
            ev = []
            danger = [e for e in loc["encounters"] if not e["done"]]
            if danger and not loc["safe"] and self.dice.chance(0.5, "ambush"):
                self.narrate(ev, "You barely close your eyes before something attacks!")
                return ev + self.engage(danger[0]["id"], _locked=True, surprise="enemy")
            for p in self.camp["party"]:
                st = stats(p, self.camp)
                p["alive"] = True
                p["hp"], p["mana"] = st["hp"], st["mana"]
                p["statuses"] = []
            ev.append({"type": "rest", "party": [public(p, self.camp) for p in self.camp["party"]]})
            self.narrate(ev, "You rest. Wounds close, spirits lift." + (" The inn's stew helps." if loc["safe"] else ""))
            self.vermeil("rest", events=ev)
            return ev

    # ---------------------------------------------------------------- battles from exploration
    def engage(self, enc_id, _locked=False, surprise=None):
        with (self.lock if not _locked else _Null()):
            if self.in_combat(): raise GameError("Already fighting.")
            loc = self.loc()
            enc = next((e for e in loc["encounters"] if e["id"] == enc_id), None)
            if not enc or enc["done"]: raise GameError("Nothing to fight there.")
            C = content()
            enemies = []
            for tid, lvl in enc["enemies"]:
                if tid in C.bosses:
                    enemies.append(make_enemy(self.camp, tid, lvl, self.dice, boss=True))
                else:
                    enemies.append(make_enemy(self.camp, tid, lvl, self.dice))
            top = max((e["level"] for e in enemies if not e.get("alpha") and e["kind"] != "boss"), default=0)
            for e in enemies:                             # an alpha always outranks the pack it leads
                if e.get("alpha") and e["level"] <= top:
                    e["level"] = min(LEVEL_CAP, top + max(2, round(top * 0.15)))
                    st = stats(e, self.camp)
                    e["hp"], e["mana"] = st["hp"], st["mana"]
            ev = []
            boss = enc.get("boss", False)
            names = ", ".join(sorted({e["name"] for e in enemies}))
            line = dm.narrate_outcome(self.camp, f"A battle begins against: {names}{' (the final boss!)' if boss else ''}.", timeout=10)
            self.narrate(ev, line or (f"{enemies[0]['name']} blocks your path!" if boss else f"Enemies! {names} attack!"))
            self.vermeil("boss" if boss else "combat_start", f"Fighting {names}.", events=ev)
            ev += combat.start(self.camp, enemies, self.dice, encounter_id=enc_id, boss=boss, surprise=surprise)
            ev = self._after_combat_events(ev)
            self.save_dice()
            return ev

    # ---------------------------------------------------------------- items & equipment (validated)
    def use_item(self, item_uid, target_uid, _locked=False):
        with (self.lock if not _locked else _Null()):
            if self.in_combat():
                cb = self.camp["combat"]
                return self.combat_act(cb.get("waiting_for"), {"type": "item", "item": item_uid, "target": target_uid}, _locked=True)
            it = next((x for x in self.camp.get("inventory", []) if x["uid"] == item_uid), None)
            if not it or it["slot"] != "consumable": raise GameError("That can't be used.")
            u = it.get("use") or {}
            if u.get("damage") or u.get("flee_bonus"): raise GameError("Save that for a battle.")
            tg = next((p for p in self.camp["party"] if p["uid"] == target_uid), None)
            if not tg: raise GameError("Use it on whom?")
            ev = []
            if u.get("card"):
                from .progression import offer_cards
                if not offer_cards(self.camp, u["card"], self.dice, ev, reason=it["name"], target=tg["uid"]):
                    raise GameError(f"{tg['name']} already has every card it could teach.")
            elif u.get("revive_pct"):
                if tg["alive"]: raise GameError(f"{tg['name']} doesn't need that.")
                tg["alive"] = True; tg["hp"] = max(1, int(stats(tg, self.camp)["hp"] * u["revive_pct"]))
            else:
                combat.apply_consumable(self.camp, tg, u, self.dice, ev)
            remove(self.camp, item_uid)
            self.save_dice()
            return ev + [{"type": "item_used", "name": it["name"], "target": tg["uid"], "party": [public(p, self.camp) for p in self.camp["party"]]}]

    def equip(self, actor_uid, item_uid):
        with self.lock:
            if self.in_combat(): raise GameError("No changing gear mid-fight!")
            try:
                equip(self.camp, actor_uid, item_uid)
            except ValueError as e:
                raise GameError(str(e))
            return {"ok": True}

    def unequip(self, actor_uid, slot):
        with self.lock:
            if self.in_combat(): raise GameError("No changing gear mid-fight!")
            unequip(self.camp, actor_uid, slot)
            return {"ok": True}

    def discard(self, item_uid):
        with self.lock:
            try:
                remove(self.camp, item_uid, qty=10 ** 6)
            except ValueError as e:
                raise GameError(str(e))
            return {"ok": True}

    def compare(self, actor_uid, item_uid):
        return compare(self.camp, actor_uid, item_uid)

    def choose_card(self, offer_id, card_id):
        with self.lock:
            try:
                r = choose_card(self.camp, offer_id, card_id)
            except ValueError as e:
                raise GameError(str(e))
            self._autosave()
            return r

    # ---------------------------------------------------------------- quests
    def _quest_check(self):
        ev = []
        q = self.camp["quest"]
        while q["current"] < len(q["stages"]):
            st = q["stages"][q["current"]]
            loc = self.loc(st["location"])
            done = False
            here = self.camp["location"] == st["location"]
            if st["kind"] == "explore":
                # you have to be there, beat what guards it AND actually search (arriving is not enough)
                done = here and st.get("explored") and all(e["done"] for e in loc["encounters"])
            elif st["kind"] == "slay":
                done = here and loc["visited"] and all(e["done"] for e in loc["encounters"])
            elif st["kind"] == "fetch":
                done = st.get("fetched", False)
            elif st["kind"] == "boss":
                done = all(e["done"] for e in loc["encounters"] if e.get("boss"))
                if done: q["boss"]["defeated"] = True
            if not done: break
            st["done"] = True
            q["current"] += 1
            self.camp["stats"]["quests_completed"] = self.camp["stats"].get("quests_completed", 0) + 1
            self.camp["choices"].append(f"Completed: {st['objective']}")
            nxt = q["stages"][q["current"]] if q["current"] < len(q["stages"]) else None
            if nxt:
                nl = self.loc(nxt["location"])
                nl["discovered"] = True
                for x in self.loc(st["location"])["links"]: self.loc(x)["discovered"] = True
                line = dm.narrate_outcome(self.camp, f"Quest step done: {st['objective']}. Next: {nxt['objective']}.", timeout=10)
                ev.append({"type": "quest_update", "done": st["objective"], "next": nxt["objective"], "location": nl["name"]})
                self.narrate(ev, line or f"Well done. {nxt['objective']}.")
                if st["kind"] != "boss":
                    offer_cards(self.camp, "card_rare", self.dice, ev, reason="Quest step complete")
            else:
                ev.append({"type": "quest_update", "done": st["objective"], "next": None})
            break                                   # one step at a time: the next one needs its own effort
        # side quests
        for sq in self.camp.get("side_quests", []):
            if sq["done"]: continue
            loc = self.loc(sq["location"])
            enc = next((e for e in loc["encounters"] if e["id"] == sq["encounter"]), None)
            if enc and enc["done"]:
                sq["done"] = True
                key = f"side:{self.camp['id']}:{sq['id']}"
                if key not in self.camp["awarded"]:
                    self.camp["awarded"].append(key)
                    add(self.camp, make_item(self.camp, "gold", qty=sq["reward_gold"]))
                    from .progression import award_xp
                    award_xp(self.camp, key + ":xp", int(120 + 30 * power(loc["level"])), self.dice, ev, src_level=loc["level"])
                    giver = self.camp["npcs"].get(sq["giver"])
                    if giver: giver["relationship"] = min(3, giver.get("relationship", 0) + 2)
                self.camp["stats"]["side_quests_completed"] = self.camp["stats"].get("side_quests_completed", 0) + 1
                ev.append({"type": "quest_done", "quest": sq, "text": f"Side quest complete: {sq['objective']} (+{sq['reward_gold']} gold)"})
        return ev

    # ---------------------------------------------------------------- the end
    def _finish_campaign(self):
        ev = []
        self.camp["status"] = "complete"
        end = dm.ending(self.camp)
        v = companion.react(self.camp, "ending", "The final boss is defeated and the adventure is over.", force=True)
        self.camp["ending"] = {"text": end["ending"], "epilogue": end.get("epilogue"), "vermeil": v["line"] if v else None,
                               "finished_at": time.time()}
        self.narrate(ev, end["ending"])
        if v:
            self.say("vermeil", v["line"], companion.name(self.camp))
            ev.append({"type": "speech", "speaker": "vermeil", "name": companion.name(self.camp), "text": v["line"], "mood": "happy"})
        ev.append({"type": "campaign_complete", "results": self.results()})
        self.save("auto")
        return ev

    def results(self):
        C = content()
        camp = self.camp
        st = camp["stats"]
        p = self.player()
        v = next((x for x in camp["party"] if x["uid"] == "vermeil"), None)
        q = camp["quest"]
        def abil(a): return [C.abilities[x]["name"] for x in a.get("abilities", []) if x in C.abilities]
        return {
            "title": q.get("title"), "genre": camp["world"]["genre_name"], "mix": camp["world"].get("mix_name"), "premise": camp["world"]["premise"],
            "play_time_seconds": int(camp["play_seconds"]), "start_level": camp.get("start_level", 1), "final_level": p["level"],
            "monsters_defeated": st.get("monsters_defeated", 0), "kills_by_type": st.get("kills_by_type", {}),
            "bosses_defeated": st.get("bosses_defeated", []), "quests_completed": st.get("quests_completed", 0),
            "side_quests_completed": st.get("side_quests_completed", 0), "xp_earned": st.get("xp_earned", 0),
            "gold_earned": st.get("gold_earned", 0), "major_items": st.get("major_items", [])[-30:],
            "cards": camp.get("card_history", []), "abilities": abil(p), "choices": camp.get("choices", [])[-25:],
            "player": {"name": p["name"], "class": C.classes[p["cls"]]["name"], "species": C.species[p["species"]]["name"], "stats": stats(p, camp)},
            "vermeil": {"name": v["name"], "level": v["level"], "class": C.classes[v["cls"]]["name"], "stats": stats(v, camp), "abilities": abil(v)} if v else None,
            "allies": [{"name": a["name"], "level": a["level"]} for a in camp["party"] if a.get("kind") == "ally"],
            "recruits": st.get("recruits", []), "ending": camp.get("ending"),
            "combat": {"damage_dealt": st.get("damage_dealt", 0), "damage_taken": st.get("damage_taken", 0), "crits": st.get("crits", 0),
                       "misses": st.get("misses", 0), "battles_won": st.get("battles_won", 0), "defeats": st.get("defeats", 0),
                       "fled": st.get("fled", 0), "treasures": st.get("treasures", 0), "places": st.get("places_visited", 0)},
            "outcome": "Victory" if camp["status"] == "complete" else "In progress",
        }

    def export_report(self, fmt="json"):
        r = self.results()
        if fmt == "json":
            return json.dumps(r, indent=2, ensure_ascii=False)
        lines = [f"# {r['title']}", f"{r['genre']}{' + ' + r['mix'] if r['mix'] else ''} - {r['premise']}", "",
                 f"Outcome: {r['outcome']}", f"Play time: {r['play_time_seconds'] // 3600}h {(r['play_time_seconds'] % 3600) // 60}m",
                 f"Level: {r['start_level']} -> {r['final_level']}", f"Monsters defeated: {r['monsters_defeated']}",
                 f"Bosses: {', '.join(r['bosses_defeated']) or '-'}", f"Quests: {r['quests_completed']}  Side quests: {r['side_quests_completed']}",
                 f"XP earned: {r['xp_earned']}  Gold earned: {r['gold_earned']}", "", "## Upgrade cards (in order)"]
        lines += [f"{i + 1}. {c['name']} ({c['rarity']}) -> {c['target']}  [{c['reason']}]" for i, c in enumerate(r["cards"])] or ["-"]
        lines += ["", "## Major items"] + [f"- {m['name']} ({m['rarity']})" for m in r["major_items"]]
        lines += ["", "## Important choices"] + [f"- {c}" for c in r["choices"]]
        if r["ending"]: lines += ["", "## Ending", r["ending"]["text"], r["ending"].get("epilogue") or ""]
        return "\n".join(lines)

    # ================================================================ settings
    def set_settings(self, changes):
        with self.lock:
            allowed = {"vermeil_control": ("advice", "auto", "tactical", "direct"), "ally_control": ("auto", "direct"),
                       "voice": (True, False), "vermeil_cards": (True, False), "skip_portal": (True, False), "test_mode": (True, False)}
            for k, v in (changes or {}).items():
                if k in allowed and v in allowed[k]:
                    self.camp["settings"][k] = v
                elif k in DEFAULT_SETTINGS and k.endswith("_volume") and isinstance(v, (int, float)):
                    self.camp["settings"][k] = max(0.0, min(1.5 if k.startswith("voice") else 1.0, float(v)))
            return self.camp["settings"]

    # ================================================================ test mode (Settings -> Experimental)
    def test_tool(self, cmd, arg=None):
        """cheats for trying the game out: only work while test mode is switched on in the settings."""
        with self.lock:
            if not self.camp["settings"].get("test_mode"): raise GameError("Turn on test mode in the settings first.")
            C = content()
            L = self.camp["locations"]
            q = self.camp["quest"]
            ev = []
            if cmd in ("teleport", "boss"):
                if self.in_combat(): raise GameError("Finish or flee the fight first.")
                dest = q["boss"]["location"] if cmd == "boss" else arg
                if dest not in L: raise GameError("No such place.")
                if dest == self.camp["location"]: raise GameError("You're already there.")
                if cmd == "boss": self.camp["test_unlock"] = True        # the lair is sealed until the story reaches it
                self.camp["test_teleport"] = True
                return self.travel(dest, _locked=True)
            if cmd == "unlock":
                self.camp["test_unlock"] = bool(arg)
                for l in L.values(): l["discovered"] = l["discovered"] or bool(arg)
                ev.append({"type": "map_update"})
                self.narrate(ev, "Test mode: every road is open." if arg else "Test mode: the story's locks are back.", kind="system")
            elif cmd == "next_stage":
                if q["current"] >= len(q["stages"]): raise GameError("The main quest is already finished.")
                st = q["stages"][q["current"]]
                if st["kind"] == "boss": raise GameError("Only the final boss is left - teleport to it and fight!")
                st["done"] = True
                q["current"] += 1
                nxt = q["stages"][q["current"]]
                L[nxt["location"]]["discovered"] = True
                ev.append({"type": "quest_update", "done": st["objective"], "next": nxt["objective"], "location": L[nxt["location"]]["name"]})
                self.narrate(ev, f"Test mode: skipped ahead. Next: {nxt['objective']}.", kind="system")
            elif cmd == "add_member":
                a = arg or {}
                members = [p for p in self.camp["party"] if p.get("kind") != "summon"]
                if len(members) >= C.rules["party_size"]: raise GameError("The party is full (6) - remove someone first.")
                if a.get("monster"):
                    pool = sorted(k for k, e in C.enemies.items() if k not in C.bosses and C.available_models(e["models"]))
                    tid = a["monster"] if a["monster"] in pool else self.dice.pick(pool, "test_monster")
                    m = make_monster_ally(self.camp, make_enemy(self.camp, tid, self.player()["level"], self.dice))
                else:
                    sp = a.get("species") if a.get("species") in C.species else "human"
                    cl = a.get("cls") if a.get("cls") in C.classes else "warrior"
                    m = make_hero(self.camp, a.get("name") or f"Test {C.classes[cl]['name']}", sp, cl, kind="ally")
                    for _ in range(max(0, self.player()["level"] - 1)): level_up(m, self.camp, quiet=True)
                    st = stats(m, self.camp)
                    m["hp"], m["mana"] = st["hp"], st["mana"]
                self.camp["party"].append(m)
                voices.assign(self.camp)
                ev.append({"type": "recruit", "actor": public(m, self.camp), "text": f"Test mode: {m['name']} joins the party."})
            elif cmd == "remove_member":
                m = next((p for p in self.camp["party"] if p["uid"] == arg), None)
                if not m or m.get("kind") == "player": raise GameError("You can't remove the hero.")
                if self.in_combat(): raise GameError("Not in the middle of a fight!")
                for s in EQUIP_SLOTS:
                    if (m.get("equipment") or {}).get(s): m["equipment"][s] = None
                self.camp["party"].remove(m)
                ev.append({"type": "dismiss", "uid": m["uid"], "text": f"Test mode: {m['name']} left the party."})
            elif cmd == "level":
                lv = max(1, min(LEVEL_CAP, int(arg or 1)))
                for p in self.camp["party"]:
                    while p["level"] < lv: level_up(p, self.camp, quiet=True)
                    p["level"] = lv
                    st = stats(p, self.camp)
                    p["hp"], p["mana"] = st["hp"], st["mana"]
                self.narrate(ev, f"Test mode: the party is now level {lv}.", kind="system")
            elif cmd == "gold":
                add(self.camp, make_item(self.camp, "gold", qty=max(1, min(1_000_000, int(arg or 1000)))))
                self.narrate(ev, f"Test mode: +{int(arg or 1000)} gold.", kind="system")
            elif cmd == "mythic":
                from .progression import card_eligible
                me = self.player()
                ids = [cid for cid, c in content().cards.items() if c["rarity"] == "mythic" and card_eligible(self.camp, me, cid, c)]
                if not ids: raise GameError("You already have every Mythic card.")
                self.camp["offer_counter"] = self.camp.get("offer_counter", 0) + 1
                picks = []
                while ids and len(picks) < 3:
                    picks.append(self.dice.pick(sorted(ids), "test_mythic")); ids.remove(picks[-1])
                offer = {"id": f"o{self.camp['offer_counter']}", "target": me["uid"], "cards": picks,
                         "reason": "Test mode: Mythic cards", "kind": "boss"}
                self.camp.setdefault("pending_cards", []).append(offer)
                ev.append({"type": "card_offer", "offer": card_offer_public(offer)})
            elif cmd == "heal":
                for p in self.camp["party"]:
                    st = stats(p, self.camp)
                    p["hp"], p["mana"], p["alive"], p["statuses"] = st["hp"], st["mana"], True, []
                self.narrate(ev, "Test mode: everyone is fully healed.", kind="system")
            elif cmd == "win":
                cb = self.camp.get("combat")
                if not cb or cb.get("phase") == "ended": raise GameError("You're not in a fight.")
                for e in cb["enemies"].values():
                    e["hp"], e["alive"] = 0, False
                events = self._after_combat_events(combat.advance(self.camp, self.dice))   # the battle sees nobody is left
                self.save_dice()
                return events
            else:
                raise GameError(f"Unknown test command {cmd}.")
            self._autosave()
            return ev

    # ================================================================ saving
    def _autosave_if_needed(self, events):
        if any(e["type"] in ("combat_end", "travel", "quest_update", "recruit", "level_up") for e in events):
            self._autosave()

    def _autosave(self):
        try:
            if not self.in_combat(): self.save("auto")
        except Exception as e:
            print(f"[game] autosave failed: {e}")

    def save(self, slot="auto"):
        with self.lock:
            if slot not in SLOTS: raise GameError("Unknown save slot.")
            if self.in_combat(): raise GameError("You can't save in the middle of a battle.")
            os.makedirs(SAVE_DIR, exist_ok=True)
            self.save_dice()
            self.camp["saved_at"] = time.time()
            camp = {k: v for k, v in self.camp.items() if k != "layouts"}      # layouts are rebuilt from the seed
            camp["layout_versions"] = {k: v.get("version") for k, v in self.camp.get("layouts", {}).items()}
            data = {"save_version": SAVE_VERSION, "meta": self.meta(slot), "campaign": camp}
            path = os.path.join(SAVE_DIR, f"slot_{slot}.json")
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, separators=(",", ":"))
            os.replace(tmp, path)
            return data["meta"]

    def meta(self, slot):
        p = self.player()
        C = content()
        return {"slot": slot, "title": self.camp["quest"].get("title"), "player": p["name"], "level": p["level"],
                "cls": C.classes[p["cls"]]["name"], "location": self.loc()["name"], "play_seconds": int(self.camp["play_seconds"]),
                "saved_at": time.time(), "status": self.camp["status"], "genre": self.camp["world"]["genre_name"], "id": self.camp["id"]}

    @classmethod
    def load(cls, slot):
        if slot not in SLOTS: raise GameError("Unknown save slot.")
        path = os.path.join(SAVE_DIR, f"slot_{slot}.json")
        if not os.path.exists(path): raise GameError("That slot is empty.")
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            raise GameError("That save file is damaged and can't be loaded.")
        camp = migrate(data)
        g = cls(camp)
        return g


def migrate(data):
    """check a save and upgrade older versions. Raises GameError for anything unusable."""
    if not isinstance(data, dict) or "campaign" not in data: raise GameError("That save file isn't a Vermeil adventure.")
    v = data.get("save_version", 0)
    camp = data["campaign"]
    if v > SAVE_VERSION: raise GameError("That save is from a newer version of the game.")
    if v < 1:                                      # (future migrations go here, one version at a time)
        camp.setdefault("side_quests", [])
        camp.setdefault("card_history", [])
        camp["save_version"] = 1
    need = ("id", "seed", "party", "locations", "location", "quest", "world", "dice", "settings")
    missing = [k for k in need if k not in camp]
    if missing: raise GameError(f"That save is incomplete (missing {', '.join(missing)}).")
    if camp["location"] not in camp["locations"]: raise GameError("That save points to a place that doesn't exist.")
    if not any(p.get("kind") == "player" for p in camp["party"]): raise GameError("That save has no player character.")
    camp["settings"] = dict(DEFAULT_SETTINGS, **camp.get("settings", {}))
    camp.setdefault("layouts", {})
    camp.setdefault("shops", {})
    camp.setdefault("awarded", [])
    camp.setdefault("shop_meta", {})
    camp.setdefault("trader", {"npc": None, "last": -99, "misses": 0})
    if not camp.get("road_map"):                   # older worlds: the map becomes a road (same places and paths)
        camp["road_map"] = world.relayout_road(camp)
    for l in camp["locations"].values():          # older worlds: every town gets a shop
        if l.get("safe"):
            world.ensure_shop(camp, l, stream(camp["seed"], "shopfix", l["id"]))
    if not camp.get("npc_looks"):                  # older worlds: people you haven't met yet get their own look
        world.unique_npc_models(camp, only_unmet=True)
        camp["npc_looks"] = 1
    camp["combat"] = None if (camp.get("combat") or {}).get("phase") not in (None, "ended") else camp.get("combat")
    if camp.get("level_scale") != 100:            # saves from the 1-20 level days: same strength, 1-100 numbers
        up = lambda lv: min(100, max(1, round(1 + (int(lv or 1) - 1) * 4.5)))
        for p in camp["party"]:
            p["level"], p["xp"] = up(p.get("level", 1)), 0
        for l in camp["locations"].values():
            l["level"] = up(l.get("level", 1))
            for e in l.get("encounters", []):
                e["enemies"] = [[t, up(lv)] for t, lv in e.get("enemies", [])]
        q = camp.get("quest") or {}
        if q.get("boss"):                          # an old world's boss keeps its strength (new worlds: 100-150)
            q["boss"]["level"] = up(q["boss"].get("level", 1))
        camp["level_scale"] = 100
    return camp


def list_saves():
    out = []
    for s in SLOTS:
        path = os.path.join(SAVE_DIR, f"slot_{s}.json")
        if not os.path.exists(path):
            out.append({"slot": s, "empty": True}); continue
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
            out.append(dict(d.get("meta", {}), slot=s, empty=False))
        except Exception:
            out.append({"slot": s, "empty": False, "damaged": True})
    return out


class _Null:
    def __enter__(self): return self
    def __exit__(self, *a): return False
