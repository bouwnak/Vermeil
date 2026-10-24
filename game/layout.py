"""layout.py - turns a location (biome + seed) into a real, walkable 3D scene made of library models.

Pipeline (each step is checked):
  1. ground area + exits towards neighbouring places
  2. connected paths (centre -> every exit), plaza for settlements, river + bridge
  3. structures: buildings facing the plaza with a path to their door, walls/cliffs around enclosed places
  4. props, lamps along paths, landmarks, then trees/rocks/bushes (denser at the edges), decorative grass/flowers
     - nothing solid on a path, nothing solid overlapping something solid
  5. navigation grid (1 m cells) from the solid objects + water
  6. spawn points: player, party, NPC points of interest, enemies, treasure
  7. validation: every exit / POI / spawn must be reachable from the player's spawn. If not, objects in the way
     are removed (repair) and it is checked again. If it still fails, a simple safe fallback layout is used.
The same location + seed always gives the same layout.
"""
import math
import re

from .content import content
from .dice import stream

CELL = 1.0
VERSION = 8          # 7: floor tiles sit flush with the ground; new D&D set pieces. 8: flat models never blown up; no floor decals


class Grid:
    def __init__(self, size):
        self.n = int(size / CELL)
        self.half = size / 2
        self.block = bytearray(self.n * self.n)       # 0 walkable, 1 solid, 2 water
        self.path = bytearray(self.n * self.n)

    def idx(self, x, z):
        i, j = int((x + self.half) / CELL), int((z + self.half) / CELL)
        if 0 <= i < self.n and 0 <= j < self.n: return j * self.n + i
        return -1

    def cell_center(self, k):
        i, j = k % self.n, k // self.n
        return (i + 0.5) * CELL - self.half, (j + 0.5) * CELL - self.half

    def disc(self, x, z, r, val, arr=None):
        arr = self.block if arr is None else arr
        r2 = r * r
        for j in range(max(0, int((z - r + self.half) / CELL)), min(self.n, int((z + r + self.half) / CELL) + 1)):
            for i in range(max(0, int((x - r + self.half) / CELL)), min(self.n, int((x + r + self.half) / CELL) + 1)):
                cx, cz = (i + 0.5) * CELL - self.half, (j + 0.5) * CELL - self.half
                if (cx - x) ** 2 + (cz - z) ** 2 <= r2:
                    if arr is self.block and val == 0: arr[j * self.n + i] = 0
                    elif arr[j * self.n + i] == 0 or val > arr[j * self.n + i]: arr[j * self.n + i] = val

    def walkable(self, x, z):
        k = self.idx(x, z)
        return k >= 0 and self.block[k] == 0

    def reach(self, start):
        """set of reachable cell indexes from a point (4-neighbour flood fill)."""
        k0 = self.idx(*start)
        if k0 < 0 or self.block[k0]: return set()
        seen, todo, n = {k0}, [k0], self.n
        while todo:
            k = todo.pop()
            i, j = k % n, k // n
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ii, jj = i + di, j + dj
                if 0 <= ii < n and 0 <= jj < n:
                    kk = jj * n + ii
                    if kk not in seen and self.block[kk] == 0:
                        seen.add(kk); todo.append(kk)
        return seen

    def encode(self):
        """rows of '.', '#', '~' for the client's path finding."""
        ch = {0: ".", 1: "#", 2: "~"}
        return ["".join(ch[self.block[j * self.n + i]] for i in range(self.n)) for j in range(self.n)]


_SOFT = re.compile(r"bush|plant|grass|flower|fern|clover|weed|pebble|reed|vine|moss_patch|sapling|lilypad|carpet|rug|coin|leaves|petal", re.I)
_TREE = re.compile(r"tree|palm|pine|birch|oak|bamboo|willow|cactus", re.I)
_HARD = re.compile(r"rock|boulder|stone|cliff|pillar|column|stump|log|crystal|statue|wall|ruin|obelisk|gravestone|well|barrel|crate|cart|anvil|tent", re.I)


def _solidity(mid, h, solid):
    """how much of a model's footprint blocks walking. Bushes and plants are always walk-through (you brush past
    them); a pool or set-piece that says nothing gets a default from the model's name: trees block at the trunk,
    rocks, logs, stumps, walls and the like block most of their size."""
    if _SOFT.search(mid) and not _TREE.search(mid): return 0.0
    if solid is not None: return solid
    if h < 0.45: return 0.0                           # tiny things you step over
    if _TREE.search(mid): return 0.3
    if _HARD.search(mid): return 0.75
    return 0.0


def _size_of(mid):
    m = content().model(mid)
    s = (m or {}).get("size") or [1, 1, 1]
    return [max(0.05, abs(v)) for v in s]


def _min_of(mid):
    m = content().model(mid)
    return (m or {}).get("min") or [0, 0, 0]


class Builder:
    def __init__(self, camp, loc):
        C = content()
        self.C, self.camp, self.loc = C, camp, loc
        self.b = C.biomes[loc["biome"]]
        self.rng = stream(loc["seed"], "layout", VERSION)
        self.settle = bool(self.b.get("settlement"))
        self.enclosed = self.b.get("enclosed")
        self.size = 48 if self.enclosed else (70 if self.settle else 64)
        self.g = Grid(self.size)
        self.objects, self.solids, self.paths, self.water, self.bridges = [], [], [], [], []
        self.exits, self.pois, self.issues, self.repairs = [], [], [], 0
        self.scenes = []
        self.palettes = {}

    # ---------------- helpers
    def pool(self, name):
        """the pool's settings + this PLACE's palette: a few models picked (with the place's seed) from everything that
        matches, so each place has its own look and only loads what it shows. 'variety' = how many kinds (0 = all)."""
        p = self.b["pools"].get(name)
        if not p: return None, []
        if name not in self.palettes:
            ids = self.C.match(p["match"])
            k = p.get("variety", 4 if p.get("decor") else 6)
            if k and len(ids) > k:
                ids = sorted(self.rng.sample(ids, k))
            self.palettes[name] = ids
        return p, self.palettes[name]

    def size_roll(self, p):
        """height for one object: the pool's range, sometimes a giant (an old oak, a huge boulder)."""
        h = self.rng.uniform(*p["height"])
        g = p.get("giant")
        if g and self.rng.random() < g[0]: h *= g[1]
        return h

    def scale_for(self, mid, h, cap=True):
        """scale that makes the model h metres tall - but flat, wide things (rail tracks, pallets, rock groups,
        ships lying down) would become huge that way, so the footprint is capped too."""
        s = _size_of(mid)
        sc = h / s[1]
        if cap:
            foot = max(s[0], s[2]) * sc
            lim = min(16.0, max(2.5, 3.2 * h))
            if s[1] < 0.25 * max(s[0], s[2]) and sc > 1:    # a flat model (lying flower, papers, decal) blown up to plant height
                lim = min(lim, max(0.6, 1.5 * h))            # turns into a huge star on the floor - keep it small instead
            if foot > lim: sc *= lim / foot
        return sc

    def radius(self, mid, scale):
        s = _size_of(mid)
        return max(s[0], s[2]) * scale / 2

    def on_path(self, x, z, clear):
        for poly in self.paths:
            for (ax, az), (bx, bz) in zip(poly["pts"], poly["pts"][1:]):
                if seg_dist(x, z, ax, az, bx, bz) < poly["w"] / 2 + clear: return True
        return False

    def free(self, x, z, r):
        lim = self.size / 2 - 1
        if abs(x) > lim or abs(z) > lim: return False
        for (sx, sz, sr) in self.solids:
            if (sx - x) ** 2 + (sz - z) ** 2 < (sr + r) ** 2: return False
        for w in self.water:
            if in_water(w, x, z, r): return False
        return True

    def place(self, mid, x, z, h, kind, rot=None, solid=None, glow=False, tint=None, check=True, clear=1.0):
        sc = self.scale_for(mid, h)
        r = self.radius(mid, sc)
        cr = r * _solidity(mid, h, solid)
        if check and cr > 0:
            if not self.free(x, z, cr) or self.on_path(x, z, cr + clear): return None
        o = {"a": mid, "x": round(x, 2), "z": round(z, 2), "y": 0, "r": round(self.rng.uniform(0, 6.283) if rot is None else rot, 3),
             "s": round(sc, 4), "c": round(cr, 2), "k": kind}
        if glow: o["glow"] = True
        if tint: o["tint"] = tint
        self.objects.append(o)
        if cr > 0: self.solids.append((x, z, cr))
        return o

    def rand_point(self, edge_bias=0.0, margin=2):
        lim = self.size / 2 - margin
        if edge_bias and self.rng.random() < edge_bias / (edge_bias + 1):
            ang = self.rng.uniform(0, 6.283)
            r = lim * (0.72 + 0.28 * self.rng.random())
            x, z = math.cos(ang) * r * 1.4, math.sin(ang) * r * 1.4
            return max(-lim, min(lim, x)), max(-lim, min(lim, z))
        return self.rng.uniform(-lim, lim), self.rng.uniform(-lim, lim)

    # ---------------- 1-2: exits, paths, plaza, water
    def exits_and_paths(self, came_from):
        L = self.camp["locations"]
        lim = self.size / 2 - 2.5
        for nid in self.loc["links"]:
            n = L[nid]
            ang = math.atan2(n["y"] - self.loc["y"], n["x"] - self.loc["x"])
            dx, dz = math.cos(ang), math.sin(ang)
            t = lim / max(abs(dx), abs(dz))
            ex, ez = dx * t, dz * t
            # don't let two exits sit on top of each other
            for e in self.exits:
                if (e["x"] - ex) ** 2 + (e["z"] - ez) ** 2 < 64:
                    ang += 0.6; dx, dz = math.cos(ang), math.sin(ang); t = lim / max(abs(dx), abs(dz)); ex, ez = dx * t, dz * t
            self.exits.append({"to": nid, "name": n["name"] if n.get("discovered") else "Unknown path", "x": round(ex, 2), "z": round(ez, 2),
                               "dir": round(ang, 3)})
        if self.settle:
            self.plaza = 7.5
        else:
            self.plaza = 0
        cx, cz = (0.0, 0.0)
        for e in self.exits:
            pts = curve(self.rng, (cx, cz), (e["x"], e["z"]), bend=0.18 if not self.enclosed else 0.1)
            self.paths.append({"pts": pts, "w": 3.2 if self.settle else 2.6, "to": e["to"]})
        if not self.exits:                                   # a dead end still gets a little path
            self.paths.append({"pts": curve(self.rng, (0, 0), (0, lim * 0.6), 0.1), "w": 2.6})
        # player spawn: at the exit they came in from (or the centre-south for the start)
        ent = next((e for e in self.exits if e["to"] == came_from), None)
        if ent:
            k = 0.82
            self.spawn = (ent["x"] * k, ent["z"] * k)
            self.face = math.atan2(-ent["x"], -ent["z"])
        else:
            self.spawn = (0.0, 6.0 if self.settle else 3.0)
            self.face = math.pi
        # water
        wat = self.b.get("water")
        if self.loc.get("river") and not wat:
            self.river()
        if wat:
            if wat.get("side"):
                h = self.size / 2
                # the sea goes on the side with no exits (so every path stays on land)
                sides = {"e": (h - 13, h + 2, -h - 2, h + 2), "w": (-h - 2, -h + 13, -h - 2, h + 2),
                         "n": (-h - 2, h + 2, h - 13, h + 2), "s": (-h - 2, h + 2, -h - 2, -h + 13)}
                def busy(r):
                    return sum(1 for poly in self.paths for (x, z) in poly["pts"] if r[0] - 2 < x < r[1] + 2 and r[2] - 2 < z < r[3] + 2) + \
                        (1000 if r[0] - 3 < self.spawn[0] < r[1] + 3 and r[2] - 3 < self.spawn[1] < r[3] + 3 else 0)
                lim = self.size / 2 - 2.5
                def exits_on(k):
                    return sum(1 for e in self.exits if (k == "e" and e["x"] > lim - 1) or (k == "w" and e["x"] < -lim + 1)
                               or (k == "n" and e["z"] > lim - 1) or (k == "s" and e["z"] < -lim + 1))
                free_sides = [k for k in sorted(sides) if exits_on(k) == 0]
                key = min(free_sides, key=lambda k: busy(sides[k])) if free_sides else None
                if key and busy(sides[key]) < 1000:
                    # trim the sea back so no path runs into it
                    x0, x1, z0, z1 = sides[key]
                    for _ in range(12):
                        if busy((x0, x1, z0, z1)) == 0: break
                        if key == "e": x0 += 1
                        elif key == "w": x1 -= 1
                        elif key == "n": z0 += 1
                        else: z1 -= 1
                    sides[key] = (x0, x1, z0, z1)
                    x0, x1, z0, z1 = sides[key]
                    self.water.append({"type": "rect", "x0": x0, "x1": x1, "z0": z0, "z1": z1, "color": wat["color"], "sea": key})
            else:
                for _ in range(2 + self.rng.randrange(3)):
                    for _try in range(30):
                        x, z = self.rand_point(0.5, 6)
                        r = self.rng.uniform(3, 6)
                        if not self.on_path(x, z, r + 1) and (x - self.spawn[0]) ** 2 + (z - self.spawn[1]) ** 2 > (r + 6) ** 2 and abs(x) + abs(z) > r + 6:
                            self.water.append({"type": "circle", "x": round(x, 2), "z": round(z, 2), "r": round(r, 2),
                                               "color": wat["color"], "lava": bool(wat.get("lava"))})
                            break

    def river(self):
        """a river across the map with a wooden bridge where the main path crosses."""
        p = self.paths[0]
        (ax, az), (bx, bz) = p["pts"][0], p["pts"][-1]
        ang = math.atan2(bz - az, bx - ax)
        mx, mz = (ax * 0.45 + bx * 0.55), (az * 0.45 + bz * 0.55)
        # river runs perpendicular to the path through (mx, mz)
        nx, nz = -math.sin(ang), math.cos(ang)
        L = self.size
        w = 4.5
        self.water.append({"type": "strip", "x": round(mx, 2), "z": round(mz, 2), "dx": round(nx, 4), "dz": round(nz, 4), "len": L * 1.6,
                           "w": w, "color": "#4aa6d6", "river": True})
        # bridge on every path that crosses the river
        for poly in self.paths:
            for (ax, az), (bx, bz) in zip(poly["pts"], poly["pts"][1:]):
                d1 = (ax - mx) * math.cos(ang) + (az - mz) * math.sin(ang)
                d2 = (bx - mx) * math.cos(ang) + (bz - mz) * math.sin(ang)
                if d1 == d2 or (d1 > 0) == (d2 > 0): continue
                t = d1 / (d1 - d2)
                cx, cz = ax + (bx - ax) * t, az + (bz - az) * t
                pang = math.atan2(bz - az, bx - ax)
                self.bridges.append({"x": cx, "z": cz, "ang": pang, "len": 7.0, "w": 2.4})
                o = {"a": "made_bridge_wood", "x": round(cx, 2), "z": round(cz, 2), "y": 0, "r": round(-pang, 3),
                     "s": round(7.0 / _size_of("made_bridge_wood")[0], 4), "c": 0, "k": "bridge"}
                if self.C.has_model("made_bridge_wood"): self.objects.append(o)
                break

    # ---------------- 3: structures
    def settlement(self):
        p, ids = self.pool("landmark")
        if ids:
            mid = self.rng.choice(ids)
            h = self.rng.uniform(*p["height"])
            self.place(mid, 0, 0, h, "landmark", solid=p.get("solid", 1.0), check=False)
            self.pois.append({"kind": "plaza", "x": 0, "z": 2.8})
        p, ids = self.pool("building")
        if not ids: return
        n = self.rng.randrange(p["count"][0], p["count"][1] + 1)
        placed = 0
        for k in range(n * 6):
            if placed >= n: break
            ang = self.rng.uniform(0, 6.283)
            r = self.rng.uniform(15, self.size / 2 - 8)
            x, z = math.cos(ang) * r, math.sin(ang) * r
            mid = self.rng.choice(ids)
            h = self.rng.uniform(*p["height"])
            sc = self.scale_for(mid, h)
            rad = self.radius(mid, sc) * 0.85
            rot = math.atan2(-x, -z)                           # front faces the plaza
            if not self.free(x, z, rad + 1) or self.on_path(x, z, rad + 1.5): continue
            o = self.place(mid, x, z, h, "building", rot=rot, solid=0.85, check=False)
            if not o: continue
            placed += 1
            door = (x - math.cos(ang) * (rad + 1.2), z - math.sin(ang) * (rad + 1.2))
            self.paths.append({"pts": curve(self.rng, door, (math.cos(ang) * self.plaza, math.sin(ang) * self.plaza), 0.08), "w": 2.0, "door": True})
            self.pois.append({"kind": "door", "x": round(door[0], 2), "z": round(door[1], 2), "building": mid})

    def ring(self, pool_name):
        """walls or cliffs around the edge, with gaps where the exits are."""
        p, ids = self.pool(pool_name)
        if not ids: return
        lim = self.size / 2 - 1.5
        perim = []
        step = 3.2
        t = -lim
        while t < lim:
            perim += [(t, -lim), (lim, t), (-t, lim), (-lim, -t)]
            t += step
        for (x, z) in perim:
            if any((e["x"] - x) ** 2 + (e["z"] - z) ** 2 < 30 for e in self.exits): continue
            mid = self.rng.choice(ids)
            h = self.rng.uniform(*p["height"])
            rad = self.radius(mid, self.scale_for(mid, h)) * p.get("solid", 1.0)
            if any(math.hypot(e["x"] - x, e["z"] - z) < rad + 3.5 for e in self.exits): continue
            if self.on_path(x, z, rad * 0.8): continue
            rot = math.atan2(-x, -z) if pool_name == "wall" and self.enclosed == "wall" else None
            self.place(mid, x, z, h, pool_name, rot=rot, solid=p.get("solid", 1.0), check=False)
        for (x, z) in perim:                         # solid edge in the nav grid even between models
            if not any((e["x"] - x) ** 2 + (e["z"] - z) ** 2 < 30 for e in self.exits):
                self.solids.append((x, z, step * 0.75))

    def counted(self, name):
        p, ids = self.pool(name)
        if not ids or "count" not in p: return
        n = self.rng.randrange(p["count"][0], p["count"][1] + 1)
        if p.get("ring"): return
        made = 0
        for _ in range(n * 25):
            if made >= n: break
            mid = self.rng.choice(ids)
            h = self.rng.uniform(*p["height"])
            if p.get("along_path") and self.paths:
                poly = self.rng.choice(self.paths)
                i = self.rng.randrange(len(poly["pts"]))
                (x, z) = poly["pts"][i]
                j = min(len(poly["pts"]) - 1, i + 1)
                dx, dz = poly["pts"][j][0] - poly["pts"][max(0, j - 1)][0], poly["pts"][j][1] - poly["pts"][max(0, j - 1)][1]
                ln = math.hypot(dx, dz) or 1
                off = poly["w"] / 2 + 0.9
                sgn = self.rng.choice([-1, 1])
                x, z = x - dz / ln * off * sgn, z + dx / ln * off * sgn
                o = self.place(mid, x, z, h, name, solid=p.get("solid", 0.3), clear=-0.3 - poly["w"] / 2, glow=p.get("glow", False) or name == "light")
            elif p.get("rows"):
                x0, z0 = self.rng.uniform(-14, 6), self.rng.uniform(-14, 6)
                k = made
                x, z = x0 + (k % 5) * 2.6, z0 + (k // 5) * 3.2
                o = self.place(mid, x, z, h, name, rot=0.0 + self.rng.uniform(-0.1, 0.1), solid=p.get("solid", 0.8))
            else:
                x, z = self.rand_point(0.3, 4)
                o = self.place(mid, x, z, h, name, solid=p.get("solid", 0.7), glow=p.get("glow", False) or name == "light",
                               rot=0.0 if name == "fence" else None)
            if o:
                made += 1
                if name in ("landmark", "ruin"): self.pois.append({"kind": "landmark", "x": o["x"], "z": o["z"] + 2.5})
                if name == "fence" and self.settle:
                    # make it a short fence run
                    for s in range(1, 3):
                        self.place(mid, o["x"] + s * _size_of(mid)[0] * o["s"], o["z"], h, name, rot=0.0, solid=p.get("solid", 0.5))

    def scatter(self, name):
        p, ids = self.pool(name)
        if not ids or "density" not in p or p.get("ring"): return
        area = self.size * self.size
        n = int(p["density"] * area / 100)
        decor = p.get("decor", False)
        made = 0
        # "clusters": things grow in groves/patches around a few centres instead of evenly everywhere
        centres = [self.rand_point(p.get("edge", 0.0), 4) for _ in range(p.get("clusters", 0))]
        spread = p.get("spread", 5.0)
        for _ in range(n * 3):
            if made >= n: break
            if centres and self.rng.random() < p.get("clustered", 0.75):
                cx, cz = self.rng.choice(centres)
                lim = self.size / 2 - 1.5
                x = max(-lim, min(lim, cx + self.rng.gauss(0, spread)))
                z = max(-lim, min(lim, cz + self.rng.gauss(0, spread)))
            else:
                x, z = self.rand_point(p.get("edge", 0.0), 1.5)
            if self.settle and math.hypot(x, z) < self.plaza + 2 and not decor: continue
            if (x - self.spawn[0]) ** 2 + (z - self.spawn[1]) ** 2 < 9 and not decor: continue
            mid = self.rng.choice(ids)
            h = self.size_roll(p)
            if decor:
                if self.on_path(x, z, 0.2) or any(in_water(w, x, z, 0.3) for w in self.water): continue
                if any((sx - x) ** 2 + (sz - z) ** 2 < sr ** 2 for sx, sz, sr in self.solids): continue
                self.objects.append({"a": mid, "x": round(x, 2), "z": round(z, 2), "y": 0, "r": round(self.rng.uniform(0, 6.283), 3),
                                     "s": round(self.scale_for(mid, h), 4), "c": 0, "k": name, "d": 1})
                made += 1
            else:
                if self.place(mid, x, z, h, name, solid=p.get("solid"), glow=p.get("glow", False), tint=p.get("tint")):
                    made += 1

    # ---------------- set-pieces: little scenes (a camp, a farm plot, a fishing dock...) made of several models
    def setpieces(self):
        spec = self.b.get("setpieces")
        if not spec: return
        lo, hi = self.b.get("setpiece_count", [2, 4])
        n = self.rng.randrange(lo, hi + 1)
        names = [k for k, w in spec if k in self.C.setpieces]
        weights = [w for k, w in spec if k in self.C.setpieces]
        if not names: return
        made = 0
        for _ in range(n * 12):
            if made >= n: break
            name = self.rng.choices(names, weights)[0]
            if self.piece(name): made += 1

    def piece(self, name):
        sp = self.C.setpieces[name]
        R = sp.get("r", 4.0)
        near_water = sp.get("near_water")
        for _ in range(30):
            if near_water and self.water:
                w = self.rng.choice(self.water)
                x, z = self.shore_point(w, R * 0.6)
                if x is None: continue
            else:
                x, z = self.rand_point(sp.get("edge", 0.3), R + 2)
            if (x - self.spawn[0]) ** 2 + (z - self.spawn[1]) ** 2 < (R + 4) ** 2: continue
            if self.settle and math.hypot(x, z) < self.plaza + R + 1 and not sp.get("in_town"): continue
            if not self.free(x, z, R) or self.on_path(x, z, R * 0.7): continue
            break
        else:
            return False
        rot = self.rng.uniform(0, 6.283)
        if near_water and self.water:                 # face the water
            w = self.water[0]
            rot = math.atan2(w.get("x", 0) - x, w.get("z", 0) - z) if w.get("type") != "strip" else rot
        cs, sn = math.cos(rot), math.sin(rot)
        placed = 0
        for part in sp["parts"]:
            if self.rng.random() > part.get("p", 1.0): continue
            ids = self.C.match(part["m"])
            if not ids: continue
            spots = []
            if "ring" in part:
                rr, cnt = part["ring"]
                off = self.rng.uniform(0, 6.283)
                spots = [(math.cos(off + k * 6.283 / cnt) * rr, math.sin(off + k * 6.283 / cnt) * rr) for k in range(int(cnt))]
            elif "row" in part:                       # a line of things: crops, fence, stalls
                cnt, gap = part["row"]
                ox, oz = part.get("at", [0, 0])
                rows = part.get("rows", 1)
                spots = [(ox + (k - (cnt - 1) / 2) * gap, oz + (r - (rows - 1) / 2) * part.get("row_gap", gap)) for r in range(rows) for k in range(int(cnt))]
            elif "scatter" in part:
                rr, cnt = part["scatter"]
                spots = [(self.rng.uniform(-rr, rr), self.rng.uniform(-rr, rr)) for _ in range(int(cnt))]
            else:
                spots = [tuple(part.get("at", [0, 0]))]
            same = part.get("same", True)
            mid0 = self.rng.choice(ids)
            for (dx, dz) in spots:
                mid = mid0 if same else self.rng.choice(ids)
                px, pz = x + dx * cs + dz * sn, z - dx * sn + dz * cs
                h = self.rng.uniform(*part.get("h", [1, 1]))
                if part.get("face") == "centre": r = math.atan2(x - px, z - pz)
                elif part.get("face") == "out": r = math.atan2(px - x, pz - z)
                elif "yaw" in part: r = rot + part["yaw"]
                else: r = self.rng.uniform(0, 6.283)
                if any(in_water(w, px, pz, 0.2) for w in self.water) and not part.get("water_ok"): continue
                o = self.place(mid, px, pz, h, part.get("k", "prop"), rot=r, solid=part.get("solid"), glow=part.get("glow", False),
                               check=False)
                if o:
                    placed += 1
                    if part.get("y"): o["y"] = part["y"]
                    if part.get("decor"): o["d"] = 1
        if not placed: return False
        poi = {"kind": sp.get("poi", "scene"), "x": round(x + R * 0.9 * sn, 2), "z": round(z + R * 0.9 * cs, 2), "scene": name}
        if sp.get("activity"): poi["activity"] = sp["activity"]
        self.pois.append(poi)
        self.scenes.append({"name": name, "x": round(x, 2), "z": round(z, 2), "label": sp.get("label", name.replace("_", " "))})
        return True

    def shore_point(self, w, inset):
        """a point on dry land right next to a body of water."""
        for _ in range(20):
            if w.get("type") == "circle":
                a = self.rng.uniform(0, 6.283); r = w["r"] + 1.2 + inset
                x, z = w["x"] + math.cos(a) * r, w["z"] + math.sin(a) * r
            elif w.get("type") == "strip":
                t = self.rng.uniform(-0.4, 0.4) * w["len"]; side = self.rng.choice([-1, 1])
                off = w["w"] / 2 + 1.2 + inset
                x = w["x"] + w["dx"] * t + (-w["dz"]) * off * side
                z = w["z"] + w["dz"] * t + (w["dx"]) * off * side
            else:
                return None, None
            lim = self.size / 2 - inset - 2
            if abs(x) < lim and abs(z) < lim and not any(in_water(ww, x, z, inset * 0.6) for ww in self.water):
                return x, z
        return None, None

    def backdrop(self):
        """scenery OUTSIDE the walkable area (big trees, cliffs, mountains, city blocks...) so the horizon is never empty."""
        p, ids = self.pool("backdrop")
        if not ids: return
        lim = self.size / 2
        n = int(p.get("density", 1.0) * 4 * lim * 2 * 22 / 100)
        for _ in range(n):
            side = self.rng.randrange(4)
            t = self.rng.uniform(-lim - 20, lim + 20)
            d = lim + self.rng.uniform(1.5, 24)
            x, z = [(t, -d), (d, t), (t, d), (-d, t)][side]
            if any(math.hypot(e["x"] - x, e["z"] - z) < 9 for e in self.exits): continue
            mid = self.rng.choice(ids)
            h = self.rng.uniform(*p["height"]) * (1 + max(0, d - lim) / 30)          # further = bigger (it's a backdrop)
            self.objects.append({"a": mid, "x": round(x, 2), "z": round(z, 2), "y": 0,
                                 "r": round(self.rng.uniform(0, 6.283) if not p.get("face") else math.atan2(-x, -z), 3),
                                 "s": round(self.scale_for(mid, h, cap=False), 4), "c": 0, "k": "backdrop", "d": 1})

    def floor_tiles(self):
        pat = self.b.get("floor_tiles")
        ids = self.C.match(pat) if pat else []
        if not ids: return
        mid = ids[0]
        s = _size_of(mid)
        tile = max(s[0], s[2])
        lim = self.size / 2 - 1
        sc = 4.0 / tile
        # sink each tile so its TOP is at ground level: thick tiles (the dungeon floor is 0.37 m, x2) used to stand
        # 0.7 m above the ground and everyone's feet disappeared into the floor
        raw_h = abs(((content().model(mid) or {}).get("size") or [1, 1, 1])[1])      # (_size_of clamps thin tiles to 5 cm)
        top = (_min_of(mid)[1] + raw_h) * sc
        t = -lim
        while t < lim:
            u = -lim
            while u < lim:
                self.objects.append({"a": mid, "x": round(t + 2, 2), "z": round(u + 2, 2), "y": round(-top + 0.005, 3), "r": 0, "s": round(sc, 4), "c": 0, "k": "floor", "d": 1})
                u += 4
            t += 4

    # ---------------- 5-6: grid + spawns
    def build_grid(self):
        g = self.g
        for w in self.water:
            for k in range(g.n * g.n):
                x, z = g.cell_center(k)
                if in_water(w, x, z, 0): g.block[k] = 2
        for (x, z, r) in self.solids:
            g.disc(x, z, max(0.35, r), 1)
        for br in self.bridges:                       # bridges are walkable over water
            for t in range(-int(br["len"] / 2) - 1, int(br["len"] / 2) + 2):
                g.disc(br["x"] + math.cos(br["ang"]) * t, br["z"] + math.sin(br["ang"]) * t, br["w"] / 2, 0)
        for poly in self.paths:                       # paths are always clear (water only where bridged)
            for p in poly["pts"]:
                k = g.idx(*p)
                if k >= 0: g.path[k] = 1
        # outer border is solid
        n = g.n
        for i in range(n):
            for k in (i, (n - 1) * n + i, i * n, i * n + n - 1):
                if not any(abs(g.cell_center(k)[0] - e["x"]) + abs(g.cell_center(k)[1] - e["z"]) < 3.5 for e in self.exits):
                    g.block[k] = 1

    def nearest_walkable(self, x, z, maxr=8):
        g = self.g
        if g.walkable(x, z): return x, z
        for r in range(1, maxr + 1):
            for a in range(16):
                xx, zz = x + math.cos(a / 16 * 6.283) * r, z + math.sin(a / 16 * 6.283) * r
                if g.walkable(xx, zz): return round(xx, 2), round(zz, 2)
        return None

    def spawns(self):
        sp = self.nearest_walkable(*self.spawn) or (0, 0)
        self.spawn = sp
        party = []
        for i in range(3):
            a = self.face + math.pi + (i - 1) * 0.6
            p = self.nearest_walkable(sp[0] + math.sin(a) * 2.2, sp[1] + math.cos(a) * 2.2, 4) or sp
            party.append({"x": p[0], "z": p[1]})
        npcs = []
        for poi in self.pois:
            p = self.nearest_walkable(poi["x"], poi["z"], 5)
            if p: npcs.append({"kind": poi["kind"], "x": p[0], "z": p[1]})
        for _ in range(8):                             # wandering spots
            for _t in range(20):
                x, z = self.rand_point(0, 6)
                if self.g.walkable(x, z):
                    npcs.append({"kind": "wander", "x": round(x, 2), "z": round(z, 2)}); break
        enemy = []
        for _ in range(4):
            for _t in range(60):
                x, z = self.rand_point(0.2, 6)
                if self.g.walkable(x, z) and (x - sp[0]) ** 2 + (z - sp[1]) ** 2 > 160 and \
                        all((x - e["x"]) ** 2 + (z - e["z"]) ** 2 > 100 for e in enemy):
                    enemy.append({"x": round(x, 2), "z": round(z, 2)}); break
        treasure = []
        for t in self.loc.get("treasure", []):
            for _t in range(60):
                x, z = self.rand_point(0.6, 4)
                if self.g.walkable(x, z) and not self.on_path(x, z, 1):
                    treasure.append({"id": t["id"], "x": round(x, 2), "z": round(z, 2), "r": round(self.rng.uniform(0, 6.28), 2)})
                    self.solids.append((x, z, 0.5)); break
        self.sp = {"player": {"x": sp[0], "z": sp[1], "face": round(self.face, 3)}, "party": party, "npc": npcs, "enemy": enemy, "treasure": treasure}

    # ---------------- 7: validation + repair
    def targets(self):
        out = [("exit", (e["x"] * 0.9, e["z"] * 0.9)) for e in self.exits]
        out += [("npc", (p["x"], p["z"])) for p in self.sp["npc"]]
        out += [("enemy", (p["x"], p["z"])) for p in self.sp["enemy"]]
        out += [("treasure", (p["x"], p["z"])) for p in self.sp["treasure"]]
        return out

    def validate(self):
        g = self.g
        reach = g.reach((self.sp["player"]["x"], self.sp["player"]["z"]))
        bad = []
        for kind, (x, z) in self.targets():
            p = self.nearest_walkable(x, z, 3)
            k = g.idx(*p) if p else -1
            if k < 0 or k not in reach: bad.append((kind, x, z))
        return bad, len(reach)

    def repair(self, bad):
        """remove solid objects lying on the straight line from the spawn to each unreachable target."""
        sx, sz = self.sp["player"]["x"], self.sp["player"]["z"]
        removed = 0
        for kind, x, z in bad:
            keep = []
            for o in self.objects:
                if o["c"] > 0 and o["k"] not in ("wall", "cliff", "landmark") and seg_dist(o["x"], o["z"], sx, sz, x, z) < o["c"] + 1.2:
                    removed += 1
                    continue
                keep.append(o)
            self.objects = keep
        self.solids = [(o["x"], o["z"], o["c"]) for o in self.objects if o["c"] > 0]
        self.repairs += removed
        return removed

    def build(self, came_from=None):
        self.exits_and_paths(came_from)
        if self.settle: self.settlement()
        if self.enclosed: self.ring("wall")
        if "cliff" in self.b["pools"]: self.ring("cliff")
        self.floor_tiles()
        pools = self.b["pools"]
        first = ("column", "ruin", "grave", "landmark", "fence", "light", "building")
        for name in [n for n in first if n in pools] + [n for n in pools if n not in first]:
            if "count" in pools[name] and not pools[name].get("ring") and not (name in ("landmark", "building") and self.settle):
                self.counted(name)
        self.setpieces()
        # scattered things: big/solid ones first (they need room), then the decoration that fills the gaps
        order = ("prop", "crystal", "tree", "rock", "bush", "street")
        names = [n for n in order if n in pools] + [n for n in pools if n not in order and not pools[n].get("decor")]
        names += [n for n in pools if pools[n].get("decor") and n not in names]
        for name in names:
            if "density" in pools[name]: self.scatter(name)
        self.backdrop()
        if self.loc["kind"] == "start" and self.C.has_model("made_portal_base"):
            sc = self.scale_for("made_portal_base", 1.9)
            rad = self.radius("made_portal_base", sc) * 0.95
            for k in range(40):                     # the portal stands beside the arrival point, never on a path
                a = k * 0.7 + self.rng.uniform(0, 0.5)
                d = 5.5 + (k // 8) * 1.5
                px, pz = self.spawn[0] + math.cos(a) * d, self.spawn[1] + math.sin(a) * d
                if self.free(px, pz, rad + 0.5) and not self.on_path(px, pz, rad + 0.8):
                    self.place("made_portal_base", px, pz, 1.9, "portal", rot=0, solid=0.95, check=False)
                    self.portal = {"x": round(px, 2), "z": round(pz, 2)}
                    break
        self.build_grid()
        self.spawns()
        bad, n = self.validate()
        tries = 0
        while bad and tries < 3:
            self.issues.append(f"{len(bad)} unreachable point(s): {', '.join(sorted(set(b[0] for b in bad)))} - repairing")
            self.repair(bad)
            self.g = Grid(self.size)
            self.build_grid()
            self.spawns()
            bad, n = self.validate()
            tries += 1
        return bad

    def result(self, bad):
        C = self.C
        missing = sorted({o["a"] for o in self.objects if not C.has_model(o["a"])})
        overl = overlaps([o for o in self.objects if o["c"] > 0 and o["k"] not in ("wall", "cliff")])
        ok = not bad and not missing
        b = self.b
        return {
            "version": VERSION, "location": self.loc["id"], "biome": self.loc["biome"], "size": self.size, "cell": CELL,
            "ground": b["ground"], "path_color": b.get("path"), "sky": b["sky"], "fog": b["fog"], "sun": b.get("sun"),
            "ambient": b.get("ambient"), "time": b.get("time", "day"), "fx": b.get("ambient_fx", []), "music": b.get("music"),
            "enclosed": self.enclosed, "path_stones": b.get("path_stones"),
            "objects": [o for o in self.objects if C.has_model(o["a"])], "paths": self.paths, "water": self.water, "bridges": self.bridges,
            "exits": self.exits, "spawns": self.sp, "nav": self.g.encode(), "portal": getattr(self, "portal", None),
            "animals": b.get("animals"), "scenes": self.scenes, "life": b.get("life"),
            "validation": {"ok": ok, "unreachable": len(bad), "missing_assets": missing, "repairs": self.repairs,
                           "overlaps": overl, "objects": len(self.objects), "solid": len(self.solids), "notes": self.issues},
        }


def fallback(camp, loc):
    """a minimal, always-valid scene (flat clearing, a ring of trees, straight paths)."""
    B = Builder(camp, loc)
    B.exits_and_paths(None)
    for name in ("tree", "grass"):
        if name in B.b["pools"]: B.scatter(name)
    B.build_grid()
    B.spawns()
    bad, _ = B.validate()
    if bad:
        B.objects = [o for o in B.objects if o["c"] == 0]
        B.solids = []
        B.g = Grid(B.size); B.build_grid(); B.spawns()
        bad, _ = B.validate()
    r = B.result(bad)
    r["validation"]["fallback"] = True
    return r


def build(camp, loc, came_from=None):
    B = Builder(camp, loc)
    try:
        bad = B.build(came_from)
        res = B.result(bad)
        if bad or res["validation"]["missing_assets"]:
            fb = fallback(camp, loc)
            fb["validation"]["notes"] = res["validation"]["notes"] + ["used the fallback layout"]
            return fb
        return res
    except Exception as e:                  # a broken template must never trap the player in a broken place
        fb = fallback(camp, loc)
        fb["validation"]["notes"].append(f"builder error: {e}")
        return fb


# ------------------------------------------------------------------ geometry
def curve(rng, a, b, bend=0.15, step=1.0):
    ax, az = a; bx, bz = b
    dx, dz = bx - ax, bz - az
    L = math.hypot(dx, dz) or 1
    nx, nz = -dz / L, dx / L
    off = rng.uniform(-bend, bend) * L
    cx, cz = (ax + bx) / 2 + nx * off, (az + bz) / 2 + nz * off
    n = max(2, int(L / step))
    pts = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * bx
        z = (1 - t) ** 2 * az + 2 * (1 - t) * t * cz + t * t * bz
        pts.append((round(x, 2), round(z, 2)))
    return pts


def seg_dist(px, pz, ax, az, bx, bz):
    dx, dz = bx - ax, bz - az
    L2 = dx * dx + dz * dz
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / L2))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz))


def in_water(w, x, z, r):
    if w["type"] == "circle": return (x - w["x"]) ** 2 + (z - w["z"]) ** 2 < (w["r"] + r) ** 2
    if w["type"] == "rect": return w["x0"] - r < x < w["x1"] + r and w["z0"] - r < z < w["z1"] + r
    if w["type"] == "strip":
        # distance from the river's centre line
        d = abs((x - w["x"]) * (-w["dz"]) + (z - w["z"]) * w["dx"])
        return d < w["w"] / 2 + r
    return False


def overlaps(objs):
    n = 0
    for i, a in enumerate(objs):
        for b in objs[i + 1:]:
            if (a["x"] - b["x"]) ** 2 + (a["z"] - b["z"]) ** 2 < ((a["c"] + b["c"]) * 0.8) ** 2: n += 1
    return n
