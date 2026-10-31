"""extras.py - the Adventure round: a day/night clock (other monsters come out at night), pets you tame and mounts you
ride, crafting at the blacksmith with appraisal (stats roll inside a low-high range), and one save slot per campaign.

Everything here works on a running Game (campaign.py calls in at travel, rest, the inn, search and after a win).
Random rolls use their own streams (dice.stream), so the main dice - and every old seed-based test - stay the same.
"""
import math
import re

from .actors import public, stats
from .content import content
from .dice import stream
from .inventory import EQUIP_SLOTS, add, make_item, remove

START_CLOCK = 8 * 60                  # a new adventure starts at 08:00
DAY_MINUTES = 24 * 60
TRAVEL_MINUTES, RIDE_MINUTES = 45, 20
REST_MINUTES, SEARCH_MINUTES, FIGHT_MINUTES = 240, 15, 15


def _err(msg):
    from .campaign import GameError
    return GameError(msg)


# ================================================================== day and night
def phase(clock):
    """'day' 06-18, 'dusk' 18-20, 'night' 20-05, 'dawn' 05-06"""
    h = (int(clock) % DAY_MINUTES) // 60
    return "day" if 6 <= h < 18 else "dusk" if 18 <= h < 20 else "dawn" if h == 5 else "night"


def clock_text(clock):
    m = int(clock) % DAY_MINUTES
    return f"{m // 60:02d}:{m % 60:02d}"


def clock_public(camp):
    c = camp.setdefault("clock", START_CLOCK)
    p = phase(c)
    return {"minutes": c % DAY_MINUTES, "day": c // DAY_MINUTES + 1, "text": clock_text(c), "phase": p,
            "icon": {"day": "☀️", "dusk": "🌇", "dawn": "🌅", "night": "🌙"}[p]}


def outdoor(l):
    """places under the open sky follow the clock (caves, crypts and dungeons stay as dark as they are)"""
    t = content().biomes.get(l["biome"], {}).get("time", "day")
    return t in ("day", "dusk")


def sky(camp, l, base):
    """the light a place shows right now"""
    if not outdoor(l):
        return base
    p = phase(camp.get("clock", START_CLOCK))
    if p == "night": return "night"
    if p in ("dusk", "dawn"): return "dusk"
    return base


# monsters that only come out after dark (any that fit the world; the place's own pool is tried first)
NIGHT_MONSTERS = ("bat", "ghost", "skeleton", "zombie", "wild_wolf", "spider", "skull_beast", "cultist", "werewolf",
                  "block_zombie", "block_skeleton", "alien_horror")
NIGHT_CHANCE = 0.5


def night_pool(camp, l):
    from .world import enemy_pool
    C = content()
    pool = [t for t in enemy_pool(camp, l["biome"]) if t in NIGHT_MONSTERS]
    if not pool:
        genres = {camp["world"]["genre"], camp["world"].get("mix")}
        pool = [t for t in NIGHT_MONSTERS if t in C.enemies and C.available_models(C.enemies[t]["models"])
                and genres & set(C.enemies[t].get("genres", []))]
    if not pool:
        pool = [t for t in NIGHT_MONSTERS if t in C.enemies and C.available_models(C.enemies[t]["models"])]
    return pool


def advance(g, minutes, events=None):
    """time passes. At sunrise the night monsters that are still around slip away."""
    camp = g.camp
    before = camp.setdefault("clock", START_CLOCK)
    camp["clock"] = before + int(minutes)
    was, now = phase(before), phase(camp["clock"])
    if was != now and events is not None:
        events.append({"type": "clock", **clock_public(camp)})
    if now in ("day", "dawn") and (was in ("night", "dusk") or minutes >= DAY_MINUTES):
        gone = 0
        for l in camp["locations"].values():
            keep = [e for e in l["encounters"] if not (e.get("night") and not e["done"])]
            gone += len(l["encounters"]) - len(keep)
            l["encounters"] = keep
        if gone and events is not None:
            g.narrate(events, "The sun comes up. The creatures of the night slink back into the dark.")
    elif now == "night" and was != "night" and events is not None:
        g.narrate(events, "Night falls. Strange shapes start to move out there - stay close to the fire.")
    return camp["clock"]


def maybe_night_encounter(g, l, events=None):
    """after dark, wild places can get a pack of night monsters (a little stronger than usual)"""
    camp = g.camp
    if phase(camp.get("clock", START_CLOCK)) != "night" or l["safe"] or l["kind"] == "boss" or not outdoor(l):
        return None
    if any(e.get("night") and not e["done"] for e in l["encounters"]):
        return None
    rng = stream(camp["seed"], "night", l["id"], camp["clock"] // 30)
    chance = NIGHT_CHANCE * (0.5 if riding(camp) else 1.0)
    if rng.random() >= chance:
        return None
    pool = night_pool(camp, l)
    if not pool:
        return None
    n = 1 + rng.randrange(2 if l["level"] < 4 else 3)
    lvl = min(100, l["level"] + 2)
    main = rng.choice(sorted(pool))
    group = [[main if i == 0 or rng.random() < 0.6 else rng.choice(sorted(pool)), lvl] for i in range(n)]
    eid = f"{l['id']}N{sum(1 for e in l['encounters'] if e.get('night'))}"
    enc = {"id": eid, "enemies": group, "done": False, "boss": False, "night": True}
    l["encounters"].append(enc)
    if events is not None:
        g.narrate(events, f"🌙 Something prowls here in the dark: {content().enemy(main)['name']}.")
    return enc


# ================================================================== pets and mounts
MOUNTS = ("raptor", "triceratops", "wild_wolf", "block_wolf", "wild_boar", "crest_dino", "trex")
FOODS = {"trail_ration": 0.15, "bone": 0.2, "slime_gel": 0.1, "monster_hide": 0.1, "heartfruit": 0.35}
TAME_OFFER_CHANCE = 0.35
MAX_PETS = 6
PERKS = {"gold": "+gold after every win", "heal": "heals the party a little after every win", "ride": "you can ride it: faster travel, fewer ambushes"}


def tameable(e):
    C = content()
    return (e.get("kind") == "enemy" and e.get("template") not in C.bosses and not e.get("alpha")
            and (e.get("body") or C.enemy(e.get("template")).get("body")) in ("quadruped", "blob", "flyer", "serpent"))


def perk_for(template, body):
    if template in MOUNTS: return "ride"
    return "heal" if body in ("blob", "serpent") else "gold"


def pets_public(camp):
    return {"pets": camp.get("pets", []), "active": camp.get("pet_active"), "riding": riding(camp), "offer": camp.get("tame_offer"),
            "foods": [{"uid": it["uid"], "name": it["name"], "qty": it["qty"], "bonus": int(FOODS[it["base"]] * 100)}
                      for it in camp.get("inventory", []) if it["base"] in FOODS],
            "perks": PERKS, "max": MAX_PETS}


def active_pet(camp):
    return next((p for p in camp.get("pets", []) if p["id"] == camp.get("pet_active")), None)


def riding(camp):
    p = active_pet(camp)
    return bool(camp.get("riding") and p and p["perk"] == "ride")


def tame_offer_roll(g, cb):
    """after a win: maybe one beaten beast stays behind and could be tamed with food"""
    camp = g.camp
    if len(camp.get("pets", [])) >= MAX_PETS:
        return []
    rng = stream(camp["seed"], "tame_offer", camp["turn"], cb.get("encounter"))
    beasts = [cb["enemies"][u] for u in cb.get("defeated", []) if u in cb["enemies"] and tameable(cb["enemies"][u])]
    if not beasts or rng.random() >= TAME_OFFER_CHANCE:
        return []
    e = beasts[rng.randrange(len(beasts))]
    C = content()
    body = e.get("body") or C.enemy(e["template"]).get("body")
    camp["tame_offer"] = {"template": e["template"], "name": e["name"], "level": e["level"], "body": body,
                          "model": e.get("model") or (C.available_models(C.enemy(e["template"]).get("models") or []) or [None])[0],
                          "size": C.enemy(e["template"]).get("size"), "perk": perk_for(e["template"], body), "tries": 0}
    return [{"type": "tame_offer", **camp["tame_offer"],
             "text": f"The {e['name']} is too tired to run. Offer it some food and it might come with you."}]


def tame(g, food_uid=None):
    """feed the waiting beast (food_uid) or leave it (None). Better food = better chance."""
    camp = g.camp
    offer = camp.get("tame_offer")
    if not offer: raise _err("No animal is waiting to be tamed.")
    ev = []
    if not food_uid:
        camp.pop("tame_offer", None)
        g.narrate(ev, f"You leave the {offer['name']} be. It limps off into the brush.")
        return ev
    food = next((it for it in camp.get("inventory", []) if it["uid"] == food_uid and it["base"] in FOODS), None)
    if not food: raise _err("That isn't food it would eat.")
    if len(camp.get("pets", [])) >= MAX_PETS: raise _err(f"You already have {MAX_PETS} pets - let one go first.")
    remove(camp, food_uid, 1)
    lvl = g.player()["level"]
    chance = max(0.1, min(0.9, 0.3 + FOODS[food["base"]] + 0.01 * (lvl - offer["level"])))
    rng = stream(camp["seed"], "tame", camp["turn"], offer["template"], offer["tries"])
    offer["tries"] += 1
    if rng.random() < chance:
        camp.pop("tame_offer", None)
        pet = {"id": f"pet{camp.setdefault('pet_counter', 0) + 1}", "template": offer["template"], "name": offer["name"],
               "level": offer["level"], "model": offer["model"], "body": offer["body"], "size": offer["size"],
               "perk": offer["perk"], "bond": 0}
        camp["pet_counter"] += 1
        camp.setdefault("pets", []).append(pet)
        if not camp.get("pet_active"):
            camp["pet_active"] = pet["id"]
        g.narrate(ev, f"The {offer['name']} eats from your hand... and nuzzles you. It's yours now!"
                      + (" You can ride it." if pet["perk"] == "ride" else ""))
        ev.append({"type": "tamed", "pet": pet, "chance": round(chance * 100)})
        g.vermeil("recruit", f"We tamed a {offer['name']}.", events=ev)
    elif rng.random() < 0.4:
        camp.pop("tame_offer", None)
        g.narrate(ev, f"The {offer['name']} snatches the {food['name']} and bolts. Gone.")
        ev.append({"type": "tame_failed", "gone": True, "chance": round(chance * 100)})
    else:
        g.narrate(ev, f"The {offer['name']} sniffs the {food['name']} but won't come closer. Try again?")
        ev.append({"type": "tame_failed", "gone": False, "chance": round(chance * 100)})
    return ev


def pet_set(g, pet_id):
    camp = g.camp
    if pet_id and not any(p["id"] == pet_id for p in camp.get("pets", [])): raise _err("No such pet.")
    camp["pet_active"] = pet_id or None
    if not riding(camp): camp["riding"] = False
    return pets_public(camp)


def pet_ride(g, on=True):
    camp = g.camp
    p = active_pet(camp)
    if on and (not p or p["perk"] != "ride"): raise _err("Pick a pet you can ride first (a wolf, boar, raptor or dino).")
    if g.in_combat(): raise _err("Not in the middle of a fight!")
    camp["riding"] = bool(on)
    return pets_public(camp)


def pet_release(g, pet_id):
    camp = g.camp
    pets = camp.get("pets", [])
    if not any(p["id"] == pet_id for p in pets): raise _err("No such pet.")
    camp["pets"] = [p for p in pets if p["id"] != pet_id]
    if camp.get("pet_active") == pet_id:
        camp["pet_active"], camp["riding"] = None, False
    return pets_public(camp)


def pet_rename(g, pet_id, name):
    p = next((x for x in g.camp.get("pets", []) if x["id"] == pet_id), None)
    if not p: raise _err("No such pet.")
    name = re.sub(r"\s+", " ", str(name or "")).strip()[:20]
    if not name: raise _err("Give it a name.")
    p["name"] = name
    return pets_public(g.camp)


def pet_after_win(g, cb, events):
    """the pet that came along helps: a little gold or a little healing, and your bond grows"""
    camp = g.camp
    p = active_pet(camp)
    if not p:
        return
    p["bond"] = min(100, p.get("bond", 0) + 2)
    if p["bond"] % 20 == 0:
        p["level"] = min(100, p["level"] + 1)
    if p["perk"] == "gold":
        from .inventory import gold_scale
        n = max(1, len(cb.get("defeated", [])))
        gold = int((2 + p["bond"] // 20) * n * gold_scale(max(1, g.player()["level"])))
        camp["gold"] = camp.get("gold", 0) + gold
        events.append({"type": "pet_help", "pet": p["name"], "text": f"{p['name']} digs up {gold} gold."})
    elif p["perk"] == "heal":
        for a in camp["party"]:
            if a["alive"]:
                a["hp"] = min(stats(a, camp)["hp"], a["hp"] + max(1, int(stats(a, camp)["hp"] * 0.08)))
        events.append({"type": "pet_help", "pet": p["name"], "text": f"{p['name']} licks everyone's wounds (+8% HP)."})


def roam_chance(camp):
    return 0.25 if riding(camp) else 0.45


# ================================================================== crafting and appraisal
MATERIALS = {"scrap_metal": 1, "monster_hide": 1, "bone": 1, "slime_gel": 1, "dino_tooth": 1, "crystal": 2, "gem": 2, "gold_ingot": 3}
RARITY_ORDER = ("common", "uncommon", "rare", "epic", "legendary")
LOW, HIGH = 0.75, 1.3                  # an appraised stat lands anywhere from 75% to 130% of the item's base value
BOOST_TOP = 0.2                        # the top 20% of a range is a "boosted" roll


def next_rarity(r):
    i = RARITY_ORDER.index(r) if r in RARITY_ORDER else 0
    return RARITY_ORDER[min(i + 1, len(RARITY_ORDER) - 1)]


def craft_need(it):
    """material points for the next rarity: common->uncommon 2, ->rare 3, ->epic 4, ->legendary 5"""
    return RARITY_ORDER.index(next_rarity(it["rarity"])) + 1


def craft_cost(it):
    return int(25 + it.get("value", 10) * 0.6 * (RARITY_ORDER.index(next_rarity(it["rarity"])) + 1))


def appraise_cost(it):
    return int(12 + it.get("value", 10) * 0.25) * (2 if it.get("appraisals", 0) else 1)


def stat_ranges(base_bonus):
    out = {}
    for k, v in (base_bonus or {}).items():
        if not isinstance(v, (int, float)) or v == 0:
            continue
        lo, hi = math.floor(v * LOW), math.ceil(v * HIGH)
        if v > 0:
            lo, hi = max(1, lo), max(max(1, lo) + 1, hi)
        out[k] = [lo, hi]
    return out


def worn_by(camp, uid):
    return next((p["name"] for p in camp["party"] if uid in (p.get("equipment") or {}).values()), None)


def materials(camp):
    return [{"uid": it["uid"], "base": it["base"], "name": it["name"], "qty": it["qty"], "points": MATERIALS[it["base"]]}
            for it in camp.get("inventory", []) if it["base"] in MATERIALS]


def craft_services(camp):
    gear = [it for it in camp.get("inventory", []) if it["slot"] in EQUIP_SLOTS]
    pts = sum(m["qty"] * m["points"] for m in materials(camp))
    return {"materials": materials(camp), "points": pts,
            "craft": [{"uid": it["uid"], "name": it["name"], "rarity": it["rarity"], "to": next_rarity(it["rarity"]),
                       "need": craft_need(it), "cost": craft_cost(it), "maxed": it["rarity"] == "legendary",
                       "worn_by": worn_by(camp, it["uid"])} for it in gear],
            "appraise": [{"uid": it["uid"], "name": it["name"], "rarity": it["rarity"], "appraised": it.get("appraised", True) is not False,
                          "ranges": it.get("ranges") or stat_ranges(it.get("base_bonus") or it.get("bonus")),
                          "bonus": it.get("bonus") if it.get("appraised", True) is not False else None,
                          "grade": it.get("grade"), "cost": appraise_cost(it), "reroll": it.get("reroll"),
                          "worn_by": worn_by(camp, it["uid"])} for it in gear]}


def craft(g, item_uid, use=None):
    """combine an item with materials into the next rarity. The result is unappraised: its stats are a mystery
    (shown as a low-high range) until the blacksmith appraises it."""
    camp = g.camp
    it = next((x for x in camp.get("inventory", []) if x["uid"] == item_uid), None)
    if not it or it["slot"] not in EQUIP_SLOTS: raise _err("Only weapons, armour, shields and accessories can be crafted.")
    if it["rarity"] == "legendary": raise _err(f"{it['name']} is already legendary.")
    if worn_by(camp, it["uid"]): raise _err(f"Take {it['name']} off first ({worn_by(camp, it['uid'])} is wearing it).")
    need, cost = craft_need(it), craft_cost(it)
    if camp.get("gold", 0) < cost: raise _err(f"Not enough gold ({cost} needed).")
    mats = materials(camp)
    if use:                                       # the materials you picked first, then any others
        mats.sort(key=lambda m: (m["uid"] not in use, -m["points"]))
    else:                                         # cheapest materials first
        mats.sort(key=lambda m: m["points"])
    if sum(m["qty"] * m["points"] for m in mats) < need:
        raise _err(f"Not enough materials: this needs {need} points (scrap, hide, bone, gel and teeth are 1, crystals and gems 2, gold ingots 3).")
    spent, left = [], need
    for m in mats:
        while left > 0 and m["qty"] > 0:
            remove(camp, m["uid"], 1)
            m["qty"] -= 1
            left -= m["points"]
            spent.append(m["name"])
        if left <= 0:
            break
    camp["gold"] -= cost
    camp.setdefault("stats", {})["gold_spent"] = camp["stats"].get("gold_spent", 0) + cost
    remove(camp, it["uid"], 10 ** 6, force=True)
    from .dice import Dice
    new = make_item(camp, it["base"], dice=Dice(f"{camp['seed']}|craft|{it['uid']}|{camp['turn']}"), rarity=next_rarity(it["rarity"]))
    if it.get("plus"):
        new["plus"] = it["plus"]
    new["base_bonus"] = dict(new.get("bonus") or {})
    new["ranges"] = stat_ranges(new["base_bonus"])
    new["bonus"], new["appraised"], new["crafted"] = {}, False, True
    new["name"] = new["name"] + (f" +{it['plus']}" if it.get("plus") else "")
    stored = add(camp, new)
    camp["stats"]["crafted"] = camp["stats"].get("crafted", 0) + 1
    ev = []
    g.narrate(ev, f"The blacksmith hammers {it['name']} together with {', '.join(spent)}. "
                  f"Out comes an unappraised {new['rarity']} {new['name']} - get it appraised to see what it really is.")
    return {"item": stored, "spent": spent, "cost": cost, "events": ev}


def _roll(camp, it, salt):
    rng = stream(camp["seed"], "appraise", it["uid"], salt)
    rolled, score, n = {}, 0.0, 0
    for k, (lo, hi) in (it.get("ranges") or {}).items():
        v = rng.randint(lo, hi)
        rolled[k] = v
        if hi > lo:
            score += (v - lo) / (hi - lo)
            n += 1
    q = score / n if n else 0.5
    grade = "S" if q >= 0.9 else "A" if q >= 0.7 else "B" if q >= 0.45 else "C" if q >= 0.2 else "D"
    boosted = [k for k, (lo, hi) in (it.get("ranges") or {}).items() if hi > lo and rolled[k] >= hi - (hi - lo) * BOOST_TOP]
    return {"bonus": rolled, "grade": grade, "quality": round(q * 100), "boosted": boosted}


def appraise(g, item_uid):
    """roll the item's stats inside their range. First time: the roll is the item. Again: you see the new roll and
    choose to keep the old one or take the new one (it can come out higher OR lower)."""
    camp = g.camp
    it = next((x for x in camp.get("inventory", []) if x["uid"] == item_uid), None)
    if not it or it["slot"] not in EQUIP_SLOTS: raise _err("That can't be appraised.")
    if it.get("reroll"): raise _err("Choose first: keep the old stats or take the new roll.")
    if not it.get("ranges"):
        it["base_bonus"] = dict(it.get("base_bonus") or it.get("bonus") or {})
        it["ranges"] = stat_ranges(it["base_bonus"])
    if not it["ranges"]: raise _err(f"{it['name']} has no stats to appraise.")
    cost = appraise_cost(it)
    if camp.get("gold", 0) < cost: raise _err(f"Not enough gold ({cost} needed).")
    camp["gold"] -= cost
    it["appraisals"] = it.get("appraisals", 0) + 1
    r = _roll(camp, it, it["appraisals"])
    first = it.get("appraised") is False or "grade" not in it
    if first:
        it.update(bonus=r["bonus"], grade=r["grade"], quality=r["quality"], boosted=r["boosted"], appraised=True)
        _fit_hp(camp)
    else:
        it["reroll"] = r
    return {"item": it, "roll": r, "first": first, "cost": cost, "gold": camp["gold"]}


def appraise_choose(g, item_uid, take):
    camp = g.camp
    it = next((x for x in camp.get("inventory", []) if x["uid"] == item_uid), None)
    if not it or not it.get("reroll"): raise _err("There's no new roll to choose.")
    r = it.pop("reroll")
    if take:
        it.update(bonus=r["bonus"], grade=r["grade"], quality=r["quality"], boosted=r["boosted"])
        _fit_hp(camp)
    return {"item": it}


def _fit_hp(camp):
    for p in camp["party"]:
        p["hp"] = min(p["hp"], stats(p, camp)["hp"])


# ================================================================== one save slot per campaign
CAMPAIGN_SLOTS = ("1", "2", "3")


def pick_slot(saves, wanted=None):
    """the campaign's own slot: the one you chose, else the first empty one, else None (all three are in use)"""
    if wanted in CAMPAIGN_SLOTS:
        return wanted
    return next((s["slot"] for s in saves if s["slot"] in CAMPAIGN_SLOTS and s.get("empty")), None)


def extras_public(g):
    camp = g.camp
    return {"clock": clock_public(camp), "pets": pets_public(camp), "slot": camp.get("slot")}


def party_line(camp):
    return [public(p, camp) for p in camp["party"]]
