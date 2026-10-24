"""actors.py - characters in the game: the player, Vermeil, recruited allies, enemies, bosses and summons.

An actor is a plain dict (so it saves to JSON). stats(actor, camp) works out the final numbers:

    class/enemy base  +  growth x (level-1)  +  species bonus  +  equipment  +  upgrade cards  +  status effects

Enemy stats scale with level and the template's 'tier' (how tough that kind of monster is).
"""
import math

from .content import content
from .dice import stream

STATS = ["hp", "mana", "patk", "matk", "pdef", "mdef", "spd", "crit", "acc", "eva"]
VERMEIL_MODEL = "vermeil"     # the client loads ui/models/anime_girl.glb for this
LEVEL_CAP = 100               # heroes, allies and normal monsters; final bosses are level 100-150


def power(level):
    """Levels run 1-100 (bosses up to 150). Stats, abilities and item tiers grow with this smooth 'power' instead of
    the raw number, so level 100 is about 23x level 1's growth and every single level is a small, steady step."""
    level = max(1, level or 1)
    return 1 + (min(level, LEVEL_CAP) - 1) / 4.5 + max(0, level - LEVEL_CAP) / 12.5


def new_uid(camp, prefix):
    camp["uid_counter"] = camp.get("uid_counter", 0) + 1
    return f"{prefix}{camp['uid_counter']}"


# ------------------------------------------------------------------ party members
def make_hero(camp, name, species, cls, model=None, kind="player", gender=None):
    C = content()
    if species not in C.species: raise ValueError(f"unknown species {species}")
    if cls not in C.classes: raise ValueError(f"unknown class {cls}")
    sp, cl = C.species[species], C.classes[cls]
    if not model:
        if species == "human":
            model = cl.get("human_model")
        else:
            models = C.available_models(sp.get("models", []))
            model = models[0] if models else cl.get("human_model")
    abilities = [a for a, lvl in cl["abilities"] if lvl <= 1]
    if sp.get("extra_ability"): abilities.append(sp["extra_ability"])
    a = {
        "uid": new_uid(camp, "p"), "name": name, "kind": kind, "team": "party", "species": species, "cls": cls,
        "level": 1, "xp": 0, "model": model, "scale": sp.get("scale", [1, 1]), "body": "humanoid", "gender": gender,
        "abilities": abilities, "equipment": {"weapon": None, "offhand": None, "armor": None, "accessory": None},
        "cards": [], "statuses": [], "cooldowns": {}, "alive": True,
        "resist": list(sp.get("resist", [])), "weak": list(sp.get("weak", [])), "immune": list(sp.get("immune", [])),
        "ai": "player" if kind == "player" else "companion",
    }
    st = stats(a, camp)
    a["hp"], a["mana"] = st["hp"], st["mana"]
    return a


VERMEIL_PERSONA = {
    "name": "Vermeil",
    "traits": "confident, mischievous, clever, protective, playful, occasionally teasing; loyal to the player; has her own opinions",
}


def make_vermeil(camp, cls="rogue", species="human", model=None, name="Vermeil", body="humanoid", gender="female"):
    """The companion (uid 'vermeil' whoever it is). It keeps its own model unless the player turned on appearance
    randomisation. name/model/body come from the character chosen in the assistant app (Vermeil, Pip, Robo...)."""
    v = make_hero(camp, name or "Vermeil", species, cls, model=model or VERMEIL_MODEL, kind="companion", gender=gender)
    v["uid"] = "vermeil"
    v["body"] = body or "humanoid"
    v["abilities"] = list(dict.fromkeys(["v_rapier", "v_spark", "v_mend", "v_tease"] + v["abilities"]))
    own = (model or VERMEIL_MODEL) == VERMEIL_MODEL or str(model).startswith("app:") or (camp.get("companion") or {}).get("model") == model
    v["scale"] = [1, 1] if own else v["scale"]
    v["voice"] = "vermeil"
    st = stats(v, camp)
    v["hp"], v["mana"] = st["hp"], st["mana"]
    return v


def make_recruit(camp, npc, level):
    """turn an NPC into a party member (uses a class that fits their role)."""
    role_cls = {"hunter": "ranger", "traveler": "warrior", "druid": "cleric", "witch": "mage", "treasure_hunter": "rogue",
                "nomad": "monk", "sailor": "warrior", "pirate": "rogue", "survivor": "ranger", "soldier": "knight",
                "pilot": "ranger", "astronaut": "elementalist", "explorer": "ranger", "prisoner": "warrior", "guard": "knight"}
    cls = npc.get("cls") or role_cls.get(npc.get("role"), "warrior")
    a = make_hero(camp, npc["name"], "human", cls, model=npc["model"], kind="ally", gender=npc.get("gender"))
    a["npc_id"] = npc["id"]
    a["personality"] = npc.get("personality")
    a["voice"] = npc.get("voice")
    a["parts"] = npc.get("parts")
    for _ in range(max(0, level - 1)): level_up(a, camp, quiet=True)
    a["hp"], a["mana"] = stats(a, camp)["hp"], stats(a, camp)["mana"]
    return a


def level_up(a, camp, quiet=False):
    """raise level by one, unlock abilities. Returns list of newly unlocked ability ids."""
    C = content()
    a["level"] += 1
    new = []
    cl = C.classes.get(a.get("cls"))
    if cl:
        for aid, lvl in cl["abilities"]:
            if lvl <= power(a["level"]) and aid not in a["abilities"]:
                a["abilities"].append(aid)
                new.append(aid)
    st = stats(a, camp)
    if not quiet:   # a level up fully heals - a classic reward
        a["hp"], a["mana"] = st["hp"], st["mana"]
    return new


# ------------------------------------------------------------------ enemies
def enemy_base(t, level):
    tier = t.get("tier", 1.0)
    return {
        "hp": (16 + 8.5 * level) * tier, "mana": 20 + 2 * level,
        "patk": (3 + 1.55 * level) * tier ** (0.4 if t.get("ai") == "boss" else 0.55),
        "matk": (3 + 1.5 * level) * tier ** (0.4 if t.get("ai") == "boss" else 0.55),
        "pdef": (1.5 + 0.9 * level) * math.sqrt(tier), "mdef": (1.5 + 0.8 * level) * math.sqrt(tier),
        "spd": 3 + 0.35 * level + (2 if t.get("ai") == "skirmisher" else 0), "crit": 5,
        "acc": 2 + 0.5 * level, "eva": 1 + 0.25 * level + (1.5 if t.get("body") == "flyer" else 0),
    }


def make_enemy(camp, tid, level, dice=None, model=None, boss=False, name=None):
    C = content()
    t = C.enemy(tid)
    if not t: raise ValueError(f"unknown enemy {tid}")
    models = C.available_models(t["models"])
    if not models: raise ValueError(f"no model for enemy {tid}")
    if not model:
        model = dice.pick(models, "enemy_model") if dice else models[0]
    elif model not in models:
        raise ValueError(f"model {model} not allowed for {tid}")
    is_boss = boss or tid in C.bosses
    a = {
        "uid": new_uid(camp, "e"), "name": name or t["name"], "kind": "boss" if is_boss else "enemy", "team": "enemy",
        "template": tid, "level": level, "model": model, "body": t.get("body", "humanoid"),
        "size": t.get("size"), "abilities": list(t.get("abilities", ["e_slam"])), "statuses": [], "cooldowns": {},
        "alive": True, "resist": list(t.get("resist", [])), "weak": list(t.get("weak", [])),
        "immune": list(t.get("immune", [])), "ai": t.get("ai", "brute"), "xp_value": int(t.get("xp", 20) * 9 * (1 + 0.22 * (power(level) - 1))),
        "gold": t.get("gold", [1, 5]), "loot": t.get("loot", []), "equipment": {}, "cards": [], "tint": t.get("tint"),
    }
    if is_boss:
        a["phases"] = t.get("phases", [])
        a["phase"] = 0
    # every monster is a little different in size; about 1 in 12 normal ones is a big "alpha" (tougher, more xp)
    if a["size"]:
        r = stream(camp.get("seed", 0), "size", a["uid"])
        f = r.uniform(0.9, 1.12)
        if not is_boss and r.random() < 1 / 12:
            f = r.uniform(1.4, 1.75)
            a["alpha"] = True
            a["name"] = f"Alpha {a['name']}" if not name else a["name"]
            a["level"] = level = min(LEVEL_CAP, level + max(3, round(level * 0.2)))     # the pack leader is always stronger
            a["perm"] = {"hp": round(0.35 * 10 * (1 + power(level))), "patk": 1 + int(power(level)) // 3}
            a["xp_value"] = int(a["xp_value"] * 1.6)
        a["size"] = round(a["size"] * f, 2)
    st = stats(a, camp)
    a["hp"], a["mana"] = st["hp"], st["mana"]
    return a


def make_monster_ally(camp, enemy):
    """a defeated monster that decided to join you: it keeps its kind, model, abilities and level."""
    a = {k: v for k, v in enemy.items() if k not in ("phases", "phase", "xp_value", "gold", "loot")}
    a.update({"uid": new_uid(camp, "m"), "team": "party", "kind": "ally", "ai": "companion", "xp": 0, "monster": True,
              "statuses": [], "cooldowns": {}, "alive": True, "equipment": {}, "cards": [], "voice": None,
              "level": min(LEVEL_CAP, enemy.get("level", 1))})
    a["name"] = enemy["name"]
    st = stats(a, camp)
    a["hp"], a["mana"] = st["hp"], st["mana"]
    return a


def make_summon(camp, sid, owner, level):
    C = content()
    t = C.summons.get(sid) or C.enemy(sid)
    a = make_enemy(camp, sid, level) if sid not in C.summons else None
    if a is None:
        models = C.available_models(t["models"])
        a = {"uid": new_uid(camp, "s"), "name": t["name"], "kind": "summon", "team": owner["team"], "template": sid,
             "level": level, "model": models[0] if models else None, "body": t.get("body", "blob"),
             "abilities": list(t["abilities"]), "statuses": [], "cooldowns": {}, "alive": True,
             "resist": [], "weak": [], "immune": [], "ai": t.get("ai", "brute"), "owner": owner["uid"],
             "lasts": t.get("lasts", 4), "equipment": {}, "cards": [], "taunts": t.get("taunts", False)}
        st = stats(a, camp)
        a["hp"], a["mana"] = st["hp"], st["mana"]
    else:   # an enemy calling minions: they fight for the enemy team
        a["kind"] = "summon"; a["owner"] = owner["uid"]; a["lasts"] = 99; a["xp_value"] //= 2
    return a


# ------------------------------------------------------------------ stats
def item_of(camp, uid):
    for it in camp.get("inventory", []):
        if it["uid"] == uid: return it
    return None


def card_effects(actor, camp):
    """all card effects that apply to this actor (its own cards + party cards + vermeil-targeted extras)."""
    C = content()
    out = []
    for cid in actor.get("cards", []):
        c = C.cards.get(cid)
        if c:
            out.append(c["effect"])
            # mythic cards carry several powers at once: "passives": {"lifesteal": 0.2, "damage_bonus": 0.3}
            out += [{"passive": n, "value": v} for n, v in (c["effect"].get("passives") or {}).items()]
    if actor.get("uid") == "vermeil":   # 'Partners in Crime' gives Vermeil stats too
        for p in camp.get("party", []):
            if p.get("kind") == "player":
                for cid in p.get("cards", []):
                    c = C.cards.get(cid)
                    if c and c["effect"].get("vermeil_stats"):
                        out.append({"stats": c["effect"]["vermeil_stats"]})
    return out


def passive(actor, camp, name):
    """total value of a passive card effect (e.g. 'lifesteal' -> 0.15)."""
    return sum(e.get("value", 0) for e in card_effects(actor, camp) if e.get("passive") == name)


def stats(a, camp):
    """the final stats of an actor right now."""
    C = content()
    if a["team"] == "party" and a.get("cls") in C.classes and a.get("kind") != "summon":
        cl = C.classes[a["cls"]]
        s = {k: cl["base"].get(k, 0) + cl["growth"].get(k, 0) * (power(a["level"]) - 1) for k in STATS}
        for k, v in C.species.get(a.get("species"), {}).get("bonus", {}).items():
            s[k] = s.get(k, 0) + v
    else:
        t = C.enemy(a.get("template")) or {}
        s = enemy_base(t, power(a["level"]))
        if a.get("kind") == "boss":
            s["hp"] *= C.rules["boss_hp_multiplier"]
            s["patk"] *= 1.1; s["matk"] *= 1.1
    # equipment
    for slot, uid in (a.get("equipment") or {}).items():
        it = item_of(camp, uid) if uid else None
        if it:
            for k, v in it.get("bonus", {}).items():
                s[k] = s.get(k, 0) + v
    # permanent boosts (tonics, heartfruit...)
    for k, v in (a.get("perm") or {}).items():
        s[k] = s.get(k, 0) + v
    # cards
    for e in card_effects(a, camp):
        for k, v in e.get("stats", {}).items():
            s[k] = s.get(k, 0) + v
    # status effects
    for st in a.get("statuses", []):
        d = C.status.get(st["id"], {})
        if d.get("stat"):
            for k in [d["stat"]] + ([d["also"]] if d.get("also") else []):
                s[k] = s.get(k, 0) + d.get("sign", 1) * st.get("value", 0)
    out = {k: (max(1, int(round(v))) if k in ("hp",) else int(round(v))) for k, v in s.items()}
    out["mana"] = max(0, out["mana"])
    for k in ("patk", "matk", "pdef", "mdef", "spd"):
        out[k] = max(0, out[k])
    out["crit"] = max(0, min(75, out["crit"]))
    return out


def weapon_dice(a, camp):
    w = item_of(camp, (a.get("equipment") or {}).get("weapon")) if a.get("equipment") else None
    if w: return w.get("dice", "1d4"), w.get("element"), bool(w.get("ranged"))
    if a["team"] == "enemy" or a.get("kind") == "summon":
        lvl = power(a["level"])
        return ("1d6" if lvl < 4 else "1d8" if lvl < 8 else "1d10" if lvl < 16 else "1d12"), None, False
    return "1d4", None, False      # bare hands


def public(a, camp):
    """what the client needs to show an actor (HP bar, name, model...)."""
    st = stats(a, camp)
    C = content()
    return {
        "uid": a["uid"], "name": a["name"], "kind": a["kind"], "team": a["team"], "level": a["level"],
        "hp": a["hp"], "max_hp": st["hp"], "mana": a.get("mana", 0), "max_mana": st["mana"], "alive": a["alive"],
        "model": a.get("model"), "scale": a.get("scale"), "body": a.get("body"), "size": a.get("size"),
        "parts": a.get("parts"), "cls": a.get("cls"), "species": a.get("species"),
        "cls_name": C.classes.get(a.get("cls"), {}).get("name"), "species_name": C.species.get(a.get("species"), {}).get("name"),
        "statuses": [{"id": s["id"], "turns": s["turns"], "icon": C.status.get(s["id"], {}).get("icon", "?"),
                      "name": C.status.get(s["id"], {}).get("name", s["id"])} for s in a.get("statuses", [])],
        "xp": a.get("xp"), "stats": st, "abilities": a.get("abilities", []), "equipment": a.get("equipment"),
        "weapon_model": (item_of(camp, (a.get("equipment") or {}).get("weapon")) or {}).get("model") if a.get("equipment") else None,
        "offhand_model": (item_of(camp, (a.get("equipment") or {}).get("offhand")) or {}).get("model") if a.get("equipment") else None,
        "resource": C.classes.get(a.get("cls"), {}).get("resource", "mana"),
        "sound": (C.enemy(a.get("template")) or {}).get("sound") if a.get("template") else None,
        "gender": a.get("gender"), "tint": a.get("tint"),
    }
