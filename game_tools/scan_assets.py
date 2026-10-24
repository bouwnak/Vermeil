"""Scan the dnd asset library and write an asset manifest.

Run:  python game_tools/scan_assets.py dnd data/game/asset_manifest.json   (the dnd folder inside this project)

It only READS the asset folder (never changes it). For every glTF/GLB model it records:
  - pack, file, format, size
  - meshes, skinned or not, skeleton bone names (joints)
  - animation clip names
  - bounding box size (metres) so the world builder knows how big things are
  - a guessed role (tree, rock, house, character, monster, weapon...) from the name
Other formats (.fbx/.blend/.obj) are counted per pack so we know which packs need a Blender conversion.
"""
import json, math, os, re, struct, sys
from collections import defaultdict

MODEL_EXT = {".gltf", ".glb"}
OTHER_EXT = {".fbx", ".blend", ".obj", ".dae"}
IMG_EXT = {".png", ".jpg", ".jpeg"}
SND_EXT = {".wav", ".ogg", ".mp3", ".flac"}
VOICE_EXT = {".onnx", ".pth", ".pt", ".ckpt", ".safetensors"}

ROLES = [  # first match wins - order matters
    ("card", r"card"),
    ("dice", r"\bdice|\bd(4|6|8|10|12|20)\b"),
    ("weapon", r"sword|axe|bow\b|arrow|dagger|spear|staff|wand|mace|hammer|shield|pistol|rifle|gun|shotgun|smg|sniper|revolver|blade|scythe"),
    ("tree", r"tree|pine|birch|maple|willow|palm|oak|bush_?tree"),
    ("bush", r"bush|shrub|hedge"),
    ("grass", r"grass|clover|fern"),
    ("flower", r"flower|tulip|lily|daisy|rose|petal|mushroom|plant"),
    ("rock", r"rock|stone|boulder|pebble|cliff"),
    ("path", r"path|road|street|sidewalk|pavement|tile_?floor|floor"),
    ("water", r"water|river|lake|waterfall"),
    ("bridge", r"bridge"),
    ("stairs", r"stair|step|ramp"),
    ("wall", r"wall|fence|gate|barrier|railing|door"),
    ("roof", r"roof"),
    ("building", r"house|home|building|tower|castle|tavern|inn|shop|church|mill|barn|hut|cabin|blacksmith|stable|temple|shack"),
    ("light", r"lamp|lantern|torch|candle|light"),
    ("prop", r"barrel|crate|box|chest|table|chair|bench|bed|cart|sign|well|pot|bag|sack|book|bottle|rope|ladder|log|bucket|anvil|wheel|banner|flag|statue|pillar|column|arch"),
    ("platform", r"platform|block|cube|ground|terrain|island|tile"),
    ("vehicle", r"car|bus|truck|train|tank|ship|boat|spaceship|plane"),
    ("food", r"food|apple|banana|bread|cheese|burger|pizza|sushi|cake|fish_?food|meat|carrot|tomato|corn|pumpkin|potato"),
    ("item", r"potion|coin|gem|key|ring|scroll|crystal|heart|star|chest"),
]
CHAR_PAT = r"knight|mage|wizard|witch|warrior|rogue|ranger|archer|cleric|monk|peasant|villager|man\b|woman|male|female|girl|boy|soldier|character|adventurer|viking|pirate|king|queen|princess|cowboy|ninja|zombie|skeleton|goblin|orc|elf|dwarf|mannequin|worker|chef|farmer|doctor|police|astronaut|suit|casual|punk"
MONSTER_PAT = r"monster|dragon|slime|bat|spider|demon|imp|puglin|ghost|golem|yeti|mushnub|cactoro|bunny|alien|blob|bee|wolf|bear|frog|crab|squid|orc|goblin|skeleton|zombie|dino|rex|trex|raptor|stego|tricera|velociraptor|parasaur|apatosaur|mech|robot|ghoul|cyclops|tribal|birb|chick|dog|cat|fish|shark|cow|pig|sheep|horse|llama|fox|deer|chicken"


def norm_pack(top):
    """'Cube World - Aug 2023-20261021T130055Z-1-001' and 'Cube World - Aug 2023' are the same pack."""
    return re.sub(r"-\d{8}T\d{6}Z-\d+-\d+$", "", top).strip()


def read_gltf_json(path):
    if path.lower().endswith(".glb"):
        with open(path, "rb") as f:
            magic, ver, length = struct.unpack("<4sII", f.read(12))
            if magic != b"glTF":
                return None
            clen, ctype = struct.unpack("<I4s", f.read(8))
            return json.loads(f.read(clen).decode("utf-8", "replace"))
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return json.load(f)


# ---- tiny matrix helpers (column-major like glTF) ----
def mat_mul(a, b):
    return [sum(a[r + 4 * k] * b[k + 4 * c] for k in range(4)) for c in range(4) for r in range(4)]


def node_matrix(n):
    if "matrix" in n:
        return list(n["matrix"])
    tx, ty, tz = n.get("translation", [0, 0, 0])
    qx, qy, qz, qw = n.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = n.get("scale", [1, 1, 1])
    r = [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0,
         2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0,
         2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0,
         0, 0, 0, 1]
    for i in range(3): r[i] *= sx
    for i in range(4, 7): r[i] *= sy
    for i in range(8, 11): r[i] *= sz
    r[12], r[13], r[14] = tx, ty, tz
    return r


def apply(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])


def bbox(g):
    nodes, meshes, acc = g.get("nodes", []), g.get("meshes", []), g.get("accessors", [])
    lo, hi = [1e9] * 3, [-1e9] * 3
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []): parent[c] = i
    cache = {}

    def world(i):
        if i in cache: return cache[i]
        m = node_matrix(nodes[i])
        if i in parent: m = mat_mul(world(parent[i]), m)
        cache[i] = m
        return m

    for i, n in enumerate(nodes):
        if "mesh" not in n: continue
        skinned = "skin" in n
        m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] if skinned else world(i)
        if skinned:  # skinned meshes are placed by the armature; use the armature root scale
            p = i
            while p in parent: p = parent[p]
            m = world(p) if p != i else m
        for prim in meshes[n["mesh"]].get("primitives", []):
            a = prim.get("attributes", {}).get("POSITION")
            if a is None or "min" not in acc[a]: continue
            mn, mx = acc[a]["min"], acc[a]["max"]
            for cx in (mn[0], mx[0]):
                for cy in (mn[1], mx[1]):
                    for cz in (mn[2], mx[2]):
                        w = apply(m, (cx, cy, cz))
                        for k in range(3):
                            lo[k] = min(lo[k], w[k]); hi[k] = max(hi[k], w[k])
    if lo[0] > hi[0]: return None
    return {"min": [round(v, 3) for v in lo], "max": [round(v, 3) for v in hi], "size": [round(hi[k] - lo[k], 3) for k in range(3)]}


def guess_role(name, info, pack):
    low = (name + " " + pack).lower()
    nm = name.lower()
    if info["skinned"] and info["animations"]:
        if re.search(MONSTER_PAT, nm): return "monster"
        if re.search(CHAR_PAT, nm) or "character" in low: return "character"
        return "creature"
    if info["skinned"]:
        return "character_part" if re.search(r"modular|outfit|parts?", low) else "character"
    for role, pat in ROLES:
        if re.search(pat, nm): return role
    return "misc"


def main(root, out):
    models, others, images, sounds, voices = [], defaultdict(lambda: defaultdict(int)), [], [], []
    seen = set()
    for dirpath, dirs, files in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        top = rel.split(os.sep)[0]
        pack = norm_pack(top)
        for fn in files:
            ext = os.path.splitext(fn)[1].lower()
            full = os.path.join(dirpath, fn)
            relf = os.path.relpath(full, root).replace("\\", "/")
            key = (pack, "/".join(relf.split("/")[1:]).replace(top, pack))
            if key in seen: continue  # the same pack was extracted twice - keep one copy
            seen.add(key)
            if ext in MODEL_EXT:
                try:
                    g = read_gltf_json(full)
                except Exception as e:
                    models.append({"file": relf, "pack": pack, "error": str(e)[:120]}); continue
                if not g: continue
                skins = g.get("skins", [])
                joints = []
                if skins:
                    joints = [g["nodes"][j].get("name", "") for j in skins[0].get("joints", [])]
                info = {
                    "id": re.sub(r"[^a-z0-9]+", "_", (pack + "_" + os.path.splitext(fn)[0]).lower()).strip("_"),
                    "name": os.path.splitext(fn)[0], "pack": pack, "file": relf, "format": ext[1:],
                    "bytes": os.path.getsize(full),
                    "meshes": len(g.get("meshes", [])), "skinned": bool(skins), "bones": len(joints),
                    "joints": joints, "animations": [a.get("name", "") for a in g.get("animations", [])],
                    "images": [i.get("uri", "") for i in g.get("images", []) if i.get("uri")],
                    "bbox": bbox(g),
                }
                info["role"] = guess_role(info["name"], info, pack)
                models.append(info)
            elif ext in OTHER_EXT:
                others[pack][ext] += 1
            elif ext in IMG_EXT:
                images.append({"pack": pack, "file": relf})
            elif ext in SND_EXT:
                sounds.append({"pack": pack, "file": relf})
            elif ext in VOICE_EXT:
                voices.append({"pack": pack, "file": relf})
    # rig families: group skinned models by their bone-name set
    fams = {}
    for m in models:
        if not m.get("skinned"): continue
        sig = "|".join(sorted(m["joints"]))
        fams.setdefault(sig, []).append(m["id"])
    rigs = []
    for i, (sig, ids) in enumerate(sorted(fams.items(), key=lambda kv: -len(kv[1]))):
        rigs.append({"rig": f"rig{i}", "bones": sig.split("|")[:200], "count": len(ids), "models": ids})
        for m in models:
            if m.get("id") in ids: m["rig"] = f"rig{i}"
    for m in models: m.pop("joints", None)
    data = {"root": root, "models": models, "rigs": rigs, "other_formats": {k: dict(v) for k, v in others.items()},
            "images": len(images), "sounds": sounds, "voice_models": voices,
            "card_images": [i for i in images if "card" in i["file"].lower()]}
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    roles = defaultdict(int)
    for m in models: roles[m.get("role", "?")] += 1
    print(len(models), "models;", len(rigs), "rig families;", len(sounds), "sounds;", len(voices), "voice files")
    print(dict(roles))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
