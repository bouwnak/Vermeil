"""world.py - builds a new campaign world from the seed: genre, premise, the map of locations,
the main quest chain to a final boss, NPCs (with looks, personalities and daily routines),
encounters, treasure and recruitable allies.

Everything comes from the campaign seed, so the same seed rebuilds the same world, and everything
generated is saved - loading never changes a place you've already seen.
"""
import math
from collections import Counter

from .content import content
from .dice import Dice, stream
from .actors import power

MODULAR_RIG_MODELS = r"^ultimate_modular_(men|women)_"


def pick(rng, seq):
    return seq[rng.randrange(len(seq))] if seq else None


def weighted(rng, d):
    tot = sum(d.values())
    x = rng.random() * tot
    for k, w in d.items():
        x -= w
        if x <= 0: return k
    return list(d)[-1]


# ------------------------------------------------------------------ the whole world
def generate(camp, genre=None, premise=None):
    """fill camp with world, locations, npcs, quest. genre/premise may come from the player or the DM."""
    C = content()
    rng = stream(camp["seed"], "world")
    G = C.world["genres"]
    if genre not in G:
        genre = weighted(rng, {k: g["weight"] for k, g in G.items()})
    mix = None
    if rng.random() < C.world.get("genre_mix_chance", 0.3):
        mix = pick(rng, [k for k in G if k != genre])
    g = G[genre]
    biomes = [b for b in g["biomes"] if b in C.biomes]
    if mix:
        biomes += [b for b in G[mix]["biomes"] if b in C.biomes and b not in biomes][:2]
    camp["world"] = {"genre": genre, "genre_name": g["name"], "mix": mix, "mix_name": G[mix]["name"] if mix else None,
                     "premise": premise or pick(rng, g["premises"]), "biomes": biomes, "facts": [], "seed": camp["seed"]}
    # ---- boss
    bosses = {k: b for k, b in C.bosses.items() if genre in b.get("genres", []) or (mix and mix in b.get("genres", []))}
    bosses = {k: b for k, b in bosses.items() if C.available_models(b["models"])} or \
             {k: b for k, b in C.bosses.items() if C.available_models(b["models"])}
    boss_id = pick(rng, sorted(bosses))
    boss = C.bosses[boss_id]
    lair_biomes = [b for b in boss["biomes"] if b in C.biomes and (b in biomes or True)]
    lair_biome = next((b for b in lair_biomes if b in biomes), lair_biomes[0])
    if lair_biome not in biomes: biomes.append(lair_biome)
    # ---- locations: ONE winding road from the start to the boss lair (about an hour of play). Now and then the road
    # forks into 2-3 places for one step and joins again - you pick a way, then continue. Towns sit on the road, and
    # you can always walk back (to a shop, the inn or a wandering trader).
    cols = 10 + rng.randrange(2)                      # 10-11 steps
    locs = []
    used_names = set()
    road = winding_road(rng)

    def new_loc(biome, col, kind, lane=0, lanes=1):
        names = C.world["location_names"].get(biome, ["Unnamed Place"])
        nm = next((n for n in [pick(rng, names) for _ in range(6)] if n not in used_names), None) or f"{pick(rng, names)} {len(locs) + 1}"
        used_names.add(nm)
        lid = f"L{len(locs) + 1}"
        x, y = road_point(road, col / (cols - 1), lane, lanes)
        loc = {"id": lid, "name": nm, "biome": biome, "kind": kind, "col": col, "x": x, "y": y, "links": [],
               "level": level_for(col, cols, rng), "seed": rng.randrange(1, 2 ** 31),
               "discovered": False, "visited": False, "river": False, "npcs": [], "encounters": [], "treasure": [],
               "safe": bool(C.biomes[biome].get("settlement")) or kind in ("hub", "town"), "quest_stage": None}
        locs.append(loc)
        return loc

    start = new_loc(pick(rng, [b for b in g["start"] if b in C.biomes]) or biomes[0], 0, "start")
    hub_b = g["hub"] if g["hub"] in C.biomes else "village"
    hub = new_loc(hub_b, 1, "hub")
    columns = {0: [start], 1: [hub]}
    wild = [b for b in biomes if not C.biomes[b].get("settlement")] or biomes
    towns = {round(cols * 0.45), round(cols * 0.72)}            # more towns along the road (shops, inns)
    # 2-3 forks per world, never two in a row
    eligible = [c for c in range(3, cols - 2) if c not in towns]
    rng.shuffle(eligible)
    forks = set()
    for c in eligible:
        if len(forks) >= 2 + (rng.random() < 0.4): break
        if all(abs(c - f) >= 2 for f in forks): forks.add(c)
    recent = []
    for col in range(2, cols - 1):
        if col in towns:
            columns[col] = [new_loc(hub_b, col, "town")]
            continue
        n = (2 + (rng.random() < 0.35)) if col in forks else 1
        for lane in range(n):
            choices = [b for b in wild if b not in recent[-2:]] or wild
            b = pick(rng, choices)
            recent.append(b)
            columns.setdefault(col, []).append(new_loc(b, col, "wild", lane, n))
    lair = new_loc(lair_biome, cols - 1, "boss")
    columns[cols - 1] = [lair]
    # every place links to every place of the next step (a fork splits from one place and joins into the next)
    for col in range(cols - 1):
        for a in columns.get(col, []):
            for b in columns.get(col + 1, []):
                link(a, b)
    # rivers: some outdoor places get a river crossing with a bridge
    for l in locs:
        if l["biome"] in ("forest", "meadow", "village", "jungle", "swamp", "farmland", "sakura", "blockland") and rng.random() < 0.35:
            l["river"] = True
    spread_out(locs)
    camp["locations"] = {l["id"]: l for l in locs}
    camp["road_map"] = True
    start["discovered"] = start["visited"] = True
    for x in start["links"]: camp["locations"][x]["discovered"] = True
    camp["location"] = start["id"]
    camp["last_safe"] = hub["id"]
    # ---- main quest chain: start -> stage places by column -> boss lair
    # quest steps sit on places every road goes through (never on one branch of a fork, so nobody can miss one),
    # spread evenly along the road
    single = [ls[0]["id"] for c, ls in sorted(columns.items()) if len(ls) == 1 and ls[0]["kind"] == "wild"]
    want = min(5, len(single))
    stage_locs = [single[round(i * (len(single) - 1) / max(1, want - 1))] for i in range(want)] if want > 1 else single
    stage_locs = list(dict.fromkeys(stage_locs))
    boss_level = 100 + int(50 * rng.random() ** 2)      # final bosses: level 100-150 (most near the low end)
    camp["quest"] = {"title": None, "premise": camp["world"]["premise"], "boss": {"template": boss_id, "name": boss["name"],
                     "location": lair["id"], "level": boss_level, "defeated": False}, "stages": [], "current": 0}
    kinds = ["explore", "slay", "fetch"]
    for i, lid in enumerate(stage_locs):
        l = camp["locations"][lid]
        k = kinds[i % 3]
        camp["quest"]["stages"].append({"id": f"s{i + 1}", "kind": k, "location": lid, "done": False,
                                        "objective": stage_text(k, l), "item": f"Relic of {l['name']}" if k == "fetch" else None})
        l["quest_stage"] = i
    camp["quest"]["stages"].append({"id": "final", "kind": "boss", "location": lair["id"], "done": False,
                                    "objective": f"Defeat {boss['name']} at {lair['name']}"})
    lair["quest_stage"] = len(camp["quest"]["stages"]) - 1
    camp["locations"][camp["quest"]["stages"][0]["location"]]["discovered"] = True     # you always know where to head first
    # ---- people, monsters, treasure
    camp["npcs"] = {}
    for l in locs:
        populate(camp, l, rng)
    return camp


ROAD_SHAPES = ("arch", "zigzag", "straight", "s_curve", "switchback", "wander")


def winding_road(rng, shape=None):
    """the road's shape on the map (0-100 both ways, y down) - a different kind of path for every world, like a trail
    drawn on a treasure map: an arch over the top, a zigzag climbing up to the right, a nearly straight march,
    an S-curve, mountain switchbacks, or a free-wandering trail. Randomly mirrored / flipped as well."""
    shape = shape or rng.choice(ROAD_SHAPES)
    j = lambda v, a=3: v + rng.uniform(-a, a)
    if shape == "arch":
        pts = [(14, 90), (16, 66), (26, 44), (42, 28), (60, 22), (78, 30), (86, 50), (84, 72), (72, 88)]
    elif shape == "zigzag":                      # up-right in sharp turns: /\/\/ rising to the right
        n = rng.randint(5, 7)
        amp = rng.uniform(16, 22)
        pts = [(8 + 84 * i / (n - 1), 72 - 44 * i / (n - 1) + (amp if i % 2 else -amp)) for i in range(n)]
    elif shape == "straight":                    # a long, almost straight road corner to corner (gentle wobble)
        y0, y1 = rng.uniform(80, 90), rng.uniform(10, 20)
        pts = [(8 + 84 * i / 6, y0 + (y1 - y0) * i / 6 + rng.uniform(-4, 4)) for i in range(7)]
    elif shape == "s_curve":                     # one big S across the map
        pts = [(10 + 80 * i / 10, 50 + 32 * math.sin(math.pi * 2 * i / 10 + rng.uniform(-0.3, 0.3))) for i in range(11)]
    elif shape == "switchback":                  # back and forth while climbing (a mountain pass)
        rows = rng.randint(3, 4)
        pts = []
        for r in range(rows):
            y = 88 - 76 * r / (rows - 1)
            xs = (12, 88) if r % 2 == 0 else (88, 12)
            pts += [(xs[0], y), (xs[1], y)]
    else:                                        # wander: a random walk that keeps heading forward
        x, y, a = 10, rng.uniform(25, 75), rng.uniform(-0.6, 0.6)
        pts = [(x, y)]
        while x < 88:
            a = max(-1.2, min(1.2, a + rng.uniform(-0.9, 0.9)))
            if y < 15: a = abs(a) * 0.6
            if y > 85: a = -abs(a) * 0.6
            x, y = x + 11 * math.cos(a), y + 11 * math.sin(a)
            pts.append((x, y))
    pts = [(j(x), j(y)) for x, y in pts]
    if rng.random() < 0.5: pts = [(100 - x, y) for x, y in pts]
    if rng.random() < 0.35: pts = [(x, 100 - y) for x, y in pts]
    return [(min(94, max(6, x)), min(94, max(6, y))) for x, y in pts]


def road_point(road, t, lane=0, lanes=1):
    """a point on the road at t (0..1); lanes spread sideways across the road for forks"""
    seg = [math.dist(road[i], road[i + 1]) for i in range(len(road) - 1)]
    total = sum(seg)

    def at(d):
        d = max(0.0, min(total, d))
        for i, s in enumerate(seg):
            if d <= s or i == len(seg) - 1:
                k = d / s if s else 0
                (x0, y0), (x1, y1) = road[i], road[i + 1]
                return x0 + (x1 - x0) * k, y0 + (y1 - y0) * k
            d -= s
        return road[-1]

    want = max(0.0, min(1.0, t)) * total
    x, y = at(want)
    (ax, ay), (bx, by) = at(want - 12), at(want + 12)        # direction over a stretch, so sharp corners don't flip it
    s = math.hypot(bx - ax, by - ay) or 1
    nx, ny = -(by - ay) / s, (bx - ax) / s                    # sideways
    off = (lane - (lanes - 1) / 2) * 13
    return round(min(96, max(4, x + nx * off)), 1), round(min(96, max(4, y + ny * off)), 1)


def relayout_road(camp):
    """older worlds were drawn as a web: put the same places (same paths, same progress) along a winding road,
    in order of how far along the adventure they are, side by side where the road forks."""
    L = camp["locations"]
    if not L or any(not isinstance(l.get("col"), int) for l in L.values()):
        return False
    cols = max(l["col"] for l in L.values()) + 1
    road = winding_road(stream(camp["seed"], "road"))
    for col in range(cols):
        here = sorted((l for l in L.values() if l["col"] == col), key=lambda l: (l.get("y", 0), l["id"]))
        for lane, l in enumerate(here):
            l["x"], l["y"] = road_point(road, col / max(1, cols - 1), lane, len(here))
    spread_out(list(L.values()))
    return True


def spread_out(locs, gap=9.0, rounds=60):
    """gently push places apart where the road bends back on itself, so no two map pins sit on top of each other"""
    for _ in range(rounds):
        moved = False
        for i, a in enumerate(locs):
            for b in locs[i + 1:]:
                dx, dy = b["x"] - a["x"], b["y"] - a["y"]
                d = math.hypot(dx, dy)
                if d >= gap:
                    continue
                if d < 0.01:
                    dx, dy, d = 1.0, 0.5, 1.118
                push = (gap - d) / 2 / d
                for p, sgn in ((a, -1), (b, 1)):
                    p["x"] = round(min(96, max(4, p["x"] + sgn * dx * push)), 1)
                    p["y"] = round(min(96, max(4, p["y"] + sgn * dy * push)), 1)
                moved = True
        if not moved:
            break


def level_for(col, cols, rng):
    """danger level of a place: 1 at the start, rising to about 92 next to the lair (levels go to 100)."""
    if col == 0:
        return 1                                   # every adventure starts at level 1
    k = col / max(1, cols - 1)
    return max(1, min(100, round(1 + 91 * k ** 2.0 + rng.uniform(-1.5, 1.5))))      # gentle start, steep end


def link(a, b):
    if b["id"] not in a["links"]: a["links"].append(b["id"])
    if a["id"] not in b["links"]: b["links"].append(a["id"])


def stage_text(kind, l):
    return {"explore": f"Find what's hidden in {l['name']}",
            "slay": f"Defeat the monsters terrorising {l['name']}",
            "fetch": f"Recover the relic from {l['name']}"}[kind]


def main_path(camp, a, b):
    """shortest route between two places (BFS on the location graph)."""
    L = camp["locations"]
    prev, todo = {a: None}, [a]
    while todo:
        cur = todo.pop(0)
        if cur == b: break
        for n in sorted(L[cur]["links"], key=lambda x: L[x]["col"]):
            if n not in prev:
                prev[n] = cur; todo.append(n)
    out, cur = [], b
    while cur:
        out.append(cur); cur = prev.get(cur)
    return list(reversed(out))


def reachable(camp, a):
    L = camp["locations"]
    seen, todo = {a}, [a]
    while todo:
        for n in L[todo.pop()]["links"]:
            if n not in seen: seen.add(n); todo.append(n)
    return seen


# ------------------------------------------------------------------ populating a place
def enemy_pool(camp, biome):
    C = content()
    w = camp["world"]
    genres = {w["genre"], w.get("mix")}
    pool = [k for k, e in C.enemies.items() if biome in e.get("biomes", []) and genres & set(e.get("genres", []))
            and C.available_models(e["models"])]
    if not pool:
        pool = [k for k, e in C.enemies.items() if biome in e.get("biomes", []) and C.available_models(e["models"])]
    if not pool:
        pool = [k for k, e in C.enemies.items() if genres & set(e.get("genres", [])) and C.available_models(e["models"])]
    return sorted(pool)


def make_encounter(camp, l, rng, eid, count=None, boss=False, small=False):
    """a group of monsters that fits the place's level: a 'tier budget' keeps early fights fair."""
    C = content()
    if boss:
        q = camp["quest"]["boss"]
        return {"id": eid, "enemies": [[q["template"], q["level"]]], "done": False, "boss": True, "name": q["name"]}
    pool = enemy_pool(camp, l["biome"])
    budget = 1.0 + 0.32 * l["level"] if not small else 0.9 + 0.15 * l["level"]
    n_max = count or (1 + rng.randrange(3 if l["level"] > 2 else 2))
    main = pick(rng, pool)
    group, spent = [], 0.0
    for i in range(n_max):
        tid = main if i == 0 or rng.random() < 0.6 else pick(rng, pool)
        tier = C.enemy(tid).get("tier", 1.0)
        if i > 0 and spent + tier > budget: break
        spread = C.rules["encounter_level_spread"]
        lvl = min(100, max(1, l["level"] + rng.randrange(-1, 1 if l["level"] < 4 else 2) * spread))
        group.append([tid, lvl])
        spent += tier
    return {"id": eid, "enemies": group, "done": False, "boss": False}


def populate(camp, l, rng):
    C = content()
    b = C.biomes[l["biome"]]
    # encounters
    if l["kind"] == "boss":
        l["encounters"].append(make_encounter(camp, l, rng, f"{l['id']}E0", boss=True))
        l["encounters"].append(make_encounter(camp, l, rng, f"{l['id']}E1", count=2))
    elif not l["safe"] and l["kind"] != "start":
        for i in range(2 + rng.randrange(2)):
            l["encounters"].append(make_encounter(camp, l, rng, f"{l['id']}E{i}"))
    elif l["kind"] == "start":
        l["encounters"].append(make_encounter(camp, l, rng, f"{l['id']}E0", count=1 + rng.randrange(2)))
    # treasure
    if not l["safe"]:
        for i in range(rng.randrange(3)):
            base = pick(rng, sorted(k for k, it in C.items.items() if it["slot"] in ("consumable", "weapon", "armor", "accessory", "offhand")
                                    and it.get("level", 1) <= l["level"] + 2 and k != "rapier" and not it.get("trader_only")))
            l["treasure"].append({"id": f"{l['id']}T{i}", "item": base, "gold": rng.randrange(10, 30 + int(16 * power(l["level"]))), "found": False})
    # people
    lo, hi = b.get("npc_count", [0, 1])
    roles = b.get("npc_roles", [])
    count = lo + rng.randrange(hi - lo + 1) if hi >= lo and roles else 0
    if l["kind"] == "hub": count = max(count, 5)
    for i in range(count):
        role = roles[i] if l["kind"] == "hub" and i < len(roles) else pick(rng, roles)
        make_npc(camp, l, role, rng)
    ensure_shop(camp, l, rng)


def ensure_shop(camp, l, rng):
    """towns and other safe places always have somewhere to spend gold."""
    if not l.get("safe"): return None
    if any(camp["npcs"][n].get("shop") for n in l["npcs"] if n in camp["npcs"]): return None
    return make_npc(camp, l, "merchant", rng)


def is_female(model):
    return "female" in model or "women" in model or "witch" in model or model.endswith(("_anne", "_lis"))


def fresh_model(camp, models, rng, skip=None, female=None):
    """a model no other NPC or party member wears yet (the least-used one if the role has run out) - only monsters
    repeat their looks. female=True/False keeps the same gender (so an NPC keeps its voice)."""
    used = Counter(n.get("model") for n in camp["npcs"].values() if n is not skip)
    used.update(p.get("model") for p in camp.get("party", []))
    same = lambda ms: [m for m in ms if female is None or is_female(m) == female]
    models = same(models) or models
    if all(used[m] for m in models):            # this role ran out of looks: borrow an unused one from any other role
        C = content()
        every = sorted({m for R in C.world["npc_roles"].values() for m in C.match(R["models"])})
        models = same([m for m in every if not used[m] and not m.startswith("ultimate_modular_")]) or models
    low = min(used[m] for m in models)
    return pick(rng, [m for m in models if used[m] == low])


def unique_npc_models(camp, only_unmet=False):
    """give any NPC wearing a party member's model (or another NPC's) a new one. A new world is made before the
    party, so this runs once the party exists; older saves run it for the NPCs you haven't met yet."""
    C = content()
    rng = stream(camp["seed"], "unique_npcs")
    keep = lambda n: n.get("joined") or (only_unmet and n.get("met"))
    seen = {p.get("model") for p in camp.get("party", [])} | {n.get("model") for n in camp["npcs"].values() if keep(n)}
    for npc in camp["npcs"].values():
        R = C.world["npc_roles"].get(npc.get("role")) or {}
        if keep(npc): continue
        if npc.get("model") not in seen or not R.get("models"):
            seen.add(npc.get("model"))
            continue
        npc["model"] = fresh_model(camp, C.match(R["models"]) or [npc["model"]], rng, skip=npc,
                                   female=npc.get("gender") == "female" if npc.get("gender") else None)
        if npc.get("parts"): npc["parts"]["Head"] = npc["model"]
        seen.add(npc["model"])


def make_npc(camp, l, role, rng):
    C = content()
    R = C.world["npc_roles"].get(role)
    if not R: return None
    models = C.match(R["models"])
    if not models: return None
    genre = camp["world"]["genre"]
    names = C.world["names"].get({"dark": "fantasy", "wild": "fantasy"}.get(genre, genre), C.world["names"]["fantasy"])
    model = fresh_model(camp, models, rng)
    female = is_female(model)
    parts = None
    if rng.random() < 0.55 and model.startswith("ultimate_modular_"):   # mix and match modular body parts
        family = C.match(MODULAR_RIG_MODELS)
        parts = {slot: pick(rng, family) for slot in ("Head", "Body", "Legs", "Feet")}
        parts["Head"] = model if rng.random() < 0.6 else parts["Head"]
    nid = f"N{len(camp['npcs']) + 1}"
    npc = {"id": nid, "name": f"{pick(rng, names['first'])} {pick(rng, names['last'])}", "role": role, "location": l["id"],
           "model": model, "parts": parts, "gender": "female" if female else "male", "scale": R.get("scale", 1),
           "personality": pick(rng, C.world["personalities"]), "routine": list(R["routine"]),
           "voice_kind": pick(rng, C.world["voice_kinds"]["female" if female else "male"]),
           "recruitable": bool(R.get("recruitable")), "shop": bool(R.get("shop")), "met": False, "alive": True,
           "relationship": 0, "memory": [], "joined": False, "seed": rng.randrange(1, 2 ** 31)}
    camp["npcs"][nid] = npc
    l["npcs"].append(nid)
    return npc


def extend(camp, from_lid, biome=None, kind="wild"):
    """add a new place next to an existing one (when the DM opens a new area). Returns the new location."""
    C = content()
    L = camp["locations"]
    base = L[from_lid]
    rng = stream(camp["seed"], "extend", len(L))
    biomes = camp["world"]["biomes"]
    if biome not in C.biomes: biome = pick(rng, [b for b in biomes if not C.biomes[b].get("settlement")] or biomes)
    names = C.world["location_names"].get(biome, ["New Lands"])
    taken = {l["name"] for l in L.values()}
    nm = next((n for n in names if n not in taken), f"{pick(rng, names)} {len(L) + 1}")
    lid = f"L{len(L) + 1}"
    loc = {"id": lid, "name": nm, "biome": biome, "kind": kind, "col": base["col"], "x": min(98, max(2, base["x"] + rng.uniform(-8, 8))),
           "y": min(98, max(2, base["y"] + rng.choice([-1, 1]) * rng.uniform(12, 20))), "links": [],
           "level": min(100, max(1, base["level"] + rng.randrange(0, 6))), "seed": rng.randrange(1, 2 ** 31), "discovered": True,
           "visited": False, "river": False, "npcs": [], "encounters": [], "treasure": [], "safe": bool(C.biomes[biome].get("settlement")),
           "quest_stage": None, "generated_later": True}
    L[lid] = loc
    link(base, loc)
    populate(camp, loc, rng)
    return loc


def recruit_roll(camp, npc, dice):
    """is this NPC willing to join? Probabilistic with a 'pity' bonus so it does happen eventually."""
    C = content()
    R = C.rules["recruit"]
    if not npc.get("recruitable") or npc.get("joined"): return False
    if sum(1 for p in camp["party"] if p.get("kind") != "summon") >= C.rules["party_size"]:
        return "full"
    misses = camp.get("recruit_misses", 0)
    p = R["base_chance"] + (max(0, misses - R["pity_after"]) * R["pity_step"]) + npc.get("relationship", 0) * 0.08
    p = min(R["max_chance"], p)
    ok = dice.chance(p, "recruit")
    camp["recruit_misses"] = 0 if ok else misses + 1
    return ok


def roaming(camp, l, rng):
    """monsters wander back into a cleared wild place you revisit (lets you train before a hard area)."""
    if l["safe"] or l["kind"] == "boss" or any(not e["done"] for e in l["encounters"]):
        return None
    eid = f"{l['id']}W{sum(1 for e in l['encounters'] if 'W' in e['id'])}"
    enc = make_encounter(camp, l, rng, eid, small=True)
    enc["roaming"] = True
    l["encounters"].append(enc)
    return enc
