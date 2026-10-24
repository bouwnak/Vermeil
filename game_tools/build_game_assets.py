"""Build the game's asset folder from your dnd library (the originals are never changed).

  python game_tools/build_game_assets.py jobs     [dnd folder]   -> data/game/convert_jobs.json (FBX packs Blender converts)
  python game_tools/build_game_assets.py copy     [dnd folder]   -> copies every glTF model into ui/game/assets/
  (the dnd folder defaults to the 'dnd' folder inside this project)
  python game_tools/build_game_assets.py catalog                 -> ui/game/assets/catalog.json (what the game loads)
  python game_tools/build_game_assets.py size     <dnd folder>   -> how many MB the copy will be

Every model in the catalog gets: id, url, pack, role, tags, size (metres), animations, rig + body family.
"""
import hashlib, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import scan_assets as S  # noqa: E402

ASSETS = os.path.join(PROJECT, "ui", "game", "assets")
MANIFEST = os.path.join(PROJECT, "data", "game", "asset_manifest.json")

DND_DEFAULT = os.path.join(PROJECT, "dnd")          # the asset library now lives inside the app folder

# ---- EVERY pack in the library is used. glTF packs are copied, FBX-only packs are converted by Blender. ----
# Only a few things are left out: duplicates, number/letter tiles and the root-motion copy of the animation library.
SKIP = {   # pack -> regex of model names to leave out
    "Platformer Game Kit - Dec 2021": r"^Numbers_",
    "Universal Animation Library 2[Standard]": r"_RM$",
}
NOT_PACKS = {"Textures"}           # folders that hold no models of their own
# packs whose short folder name would clash with another pack's
FOLDER_OVERRIDE = {"Furniture Pack - Oct 2017": "furniture_pack_2017", "Buildings pack - Aug 2017": "buildings_pack_2017"}
# FBX packs where only some files are models (the rest are extras we don't need)
FBX_ONLY_NAMES = {"Survival Pack - Sept 2020": r".", "Animated Monster Pack by @Quaternius": r"^(Bat|Dragon|Skeleton|Slime)$"}

# kept for the code below (filled from the manifest by plan())
GLTF_PACKS, FBX_PACKS = {}, {}


def plan(man):
    """decide which packs are copied (glTF) and which are converted (FBX only) - every pack with models."""
    gl = {}
    for m in man["models"]:
        if "error" not in m: gl[m["pack"]] = gl.get(m["pack"], 0) + 1
    GLTF_PACKS.clear(); FBX_PACKS.clear()
    for pk in gl:
        if pk in NOT_PACKS: continue
        GLTF_PACKS[pk] = (r".", SKIP.get(pk))
    for pk, fm in man.get("other_formats", {}).items():
        if pk in NOT_PACKS or pk in GLTF_PACKS or not fm.get(".fbx"): continue
        FBX_PACKS[pk] = FBX_ONLY_NAMES.get(pk, r".")
    return GLTF_PACKS, FBX_PACKS


BODY = [  # body family for the shared animation system
    ("flyer", r"dragon|bat|bee|birb|pigeon|wasp|cthulhu|armabee|ghost|alpaking"),
    ("quadruped", r"cat|dog|wolf|sheep|horse|pig|cow|llama|fox|deer|raccoon|alpaca|trex|raptor|velociraptor|stego|tricera|apato|parasaur|rat|frog|spider|crab|hedgehog"),
    ("serpent", r"snake|fish|shark|eel|tentacle|slime|blob"),
]

TAGS = {  # extra search tags the world builder and DM use
    "forest": r"tree|pine|birch|maple|bush|fern|grass|flower|mushroom|plant|clover|petal|rock|pebble",
    "autumn": r"autumn|maple",
    "snow": r"snow",
    "desert": r"cactus|palm|dead",
    "dead": r"dead|twisted|skull|bone",
    "village": r"house|inn|mill|stable|blacksmith|market|well|bench|barrel|crate|cart|wagon|fence|bonfire|bell|hay|stall|lantern|sign|lamp",
    "dungeon": r"dungeon|column|torch|bars|bones|candel|chest|stonewall|modular(floor|stonewall)",
    "castle": r"tower|wall|castle|gate|barracks|keep",
    "scifi": r"sci|space|mech|cyber|robot|alien|laser|ship",
    "city": r"building|brick|street|road|car|bus|decal|sidewalk|zombie|hydrant",
    "pirate": r"pirate|ship|cannon|anne|henry|mako|sharky|palm|cliff",
}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def short_pack(p):
    if p in FOLDER_OVERRIDE: return FOLDER_OVERRIDE[p]
    return slug(re.sub(r"\[Standard\]|- \w+ \d{4}|by @Quaternius", "", p))[:28]


OTHER_NAMES = set()


def chosen(manifest):
    plan(manifest)
    OTHER_NAMES.clear()
    OTHER_NAMES.update(m["name"] for m in manifest["models"] if m.get("pack") != "Exports")
    seen = set()
    for m in manifest["models"]:
        rule = GLTF_PACKS.get(m.get("pack"))
        if not rule or "error" in m: continue
        inc, exc = rule
        if not re.search(inc, m["name"]) or (exc and re.search(exc, m["name"])): continue
        key = (m["pack"], m["name"])
        if key in seen: continue
        # 'Exports' repeats models from the megakits: skip any name another pack already has
        if m["pack"] == "Exports" and m["name"] in OTHER_NAMES: continue
        seen.add(key)
        yield m


def gltf_deps(path):
    """files a .gltf needs next to it (.bin + textures)."""
    if path.lower().endswith(".glb"): return []
    g = S.read_gltf_json(path)
    out = [b.get("uri") for b in g.get("buffers", []) if b.get("uri") and not b["uri"].startswith("data:")]
    out += [i.get("uri") for i in g.get("images", []) if i.get("uri") and not i["uri"].startswith("data:")]
    return out


IMG_MAX = 1024          # textures bigger than this are made smaller while copying (stylized models look the same)


def _image_index(root):
    """file name -> path, for textures a model expects next to it but that live in another folder (e.g. 'Textures')."""
    idx = {}
    for d, _, files in os.walk(root):
        for f in files:
            if f.lower().endswith((".png", ".jpg", ".jpeg")): idx.setdefault(f.lower(), os.path.join(d, f))
    return idx


def _copy_image(s, d):
    try:
        from PIL import Image
        with Image.open(s) as im:
            if max(im.size) > IMG_MAX:
                k = IMG_MAX / max(im.size)
                small = im.resize((max(1, round(im.size[0] * k)), max(1, round(im.size[1] * k))), Image.LANCZOS)
                small.save(d, optimize=True) if d.lower().endswith(".png") else small.save(d, quality=90)
                return
    except ImportError:
        pass
    shutil.copyfile(s, d)


def cmd_copy(root, dry=False, limit=None):
    man = json.load(open(MANIFEST, encoding="utf-8"))
    total, n, done, idx = 0, 0, set(), None
    t0 = __import__("time").time()
    for m in chosen(man):
        src = os.path.join(root, m["file"])
        dst_dir = os.path.join(ASSETS, short_pack(m["pack"]))
        files = [os.path.basename(src)] + gltf_deps(src)
        for f in files:
            s = os.path.join(os.path.dirname(src), f.replace("/", os.sep))
            d = os.path.join(dst_dir, f.replace("/", os.sep))
            if d in done: continue
            done.add(d)
            if not os.path.exists(s):
                if idx is None: idx = _image_index(root)
                s = idx.get(os.path.basename(f).lower(), s)
                if not os.path.exists(s): print("missing", s); continue
            total += os.path.getsize(s)
            if dry or os.path.exists(d): continue
            os.makedirs(os.path.dirname(d), exist_ok=True)
            if s.lower().endswith((".png", ".jpg", ".jpeg")): _copy_image(s, d)
            else: shutil.copyfile(s, d)
        n += 1
        if limit and __import__("time").time() - t0 > limit:
            print(f"stopped after {n} models (time limit) - run again to continue"); return
    print(f"{n} models, {total / 1e6:.1f} MB", "(dry run)" if dry else "copied - all done")


def cmd_jobs(root):
    plan(json.load(open(MANIFEST, encoding="utf-8")))
    jobs, seen = [], set()
    for dirpath, dirs, files in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        pack = S.norm_pack(rel.split(os.sep)[0])
        if pack not in FBX_PACKS or "unity" in rel.lower() or "unreal" in rel.lower(): continue
        for fn in files:
            if not fn.lower().endswith(".fbx"): continue
            name = os.path.splitext(fn)[0]
            if not re.search(FBX_PACKS[pack], name) or (pack, name) in seen: continue
            seen.add((pack, name))
            jobs.append({"src": os.path.join(rel, fn).replace("/", "\\"), "out": f"conv_{short_pack(pack)}/{name}.glb", "pack": pack})
    out = os.path.join(PROJECT, "data", "game", "convert_jobs.json")
    json.dump({"jobs": jobs}, open(out, "w"), indent=1)
    print(len(jobs), "conversion jobs ->", out)


def body_of(name, role, rig_bones):
    low = name.lower()
    for fam, pat in BODY:
        if re.search(pat, low): return fam
    if role in ("character", "character_part"): return "humanoid"
    if rig_bones and any(re.search(r"upperarm|upper_arm|arm\.l|lowerarm|forearm|thigh|upperleg", b, re.I) for b in rig_bones):
        return "humanoid"
    return "blob" if rig_bones else None


CACHE = os.path.join(PROJECT, "data", "game", "catalog_cache.json")


def catalog_entry(full, dirpath, fn):
    g = S.read_gltf_json(full)
    name = os.path.splitext(fn)[0]
    rel = os.path.relpath(full, os.path.join(PROJECT, "ui")).replace("\\", "/")
    folder = os.path.relpath(dirpath, ASSETS).replace("\\", "/")
    skins = g.get("skins", [])
    bones = [g["nodes"][j].get("name", "") for j in skins[0]["joints"]] if skins else []
    anims = [re.sub(r"^.*\|", "", a.get("name", "")) for a in g.get("animations", [])]
    info = {"name": name, "skinned": bool(skins), "animations": anims}
    role = S.guess_role(name, info, folder)
    if folder.startswith("made"):
        role = {"lamp": "light", "sign": "prop", "dice": "dice", "arch": "ruin", "grave": "prop", "fount": "prop", "statue": "prop", "well": "prop"}.get(
            next((k for k in ("lamp", "sign", "dice", "arch", "grave", "fount", "statue", "well") if k in name.lower()), ""), role)
    if folder.startswith("conv_ultimate_rpg_items") or folder.startswith("conv_medieval_weapons"):
        role = "weapon" if re.search(S.ROLES[2][1], name.lower()) else "item"
    if "card_kit" in folder: role = "card"
    bb = S.bbox(g)
    tags = sorted(t for t, pat in TAGS.items() if re.search(pat, (name + " " + folder).lower()))
    return {
        "id": slug(folder + "_" + name), "name": name, "url": rel, "pack": folder, "role": role, "tags": tags,
        "size": bb["size"] if bb else None, "min": bb["min"] if bb else None,
        "animations": anims, "bones": len(bones), "skinned": bool(skins),
        "body": body_of(name, role, bones) if skins or role in ("character", "monster", "creature") else None,
        "rig": hashlib.md5("|".join(sorted(bones)).encode()).hexdigest()[:8] if bones else None,
        "meshes": [m.get("name", "") for m in g.get("meshes", [])][:40],
    }


def cmd_catalog():
    """Scan ui/game/assets (copied + converted + made-in-Blender) and write catalog.json.
    Resumable: finished files are remembered in data/game/catalog_cache.json, so on a slow (synced) folder you can
    stop it any time (or give it a time limit: CATALOG_BUDGET=150) and run it again - it continues where it stopped."""
    import time
    import fix_materials
    budget = float(os.environ.get("CATALOG_BUDGET", "0")) or None
    t0 = time.time()
    try:
        cache = json.load(open(CACHE, encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    files = []
    for dirpath, dirs, names in os.walk(ASSETS):
        dirs.sort()
        for fn in sorted(names):
            if fn.lower().endswith((".gltf", ".glb")): files.append((dirpath, fn))
    todo = done_now = fixed = 0
    seen = set()
    for dirpath, fn in files:
        full = os.path.join(dirpath, fn)
        key = os.path.relpath(full, ASSETS).replace("\\", "/")
        seen.add(key)
        try:
            st = os.stat(full)
        except OSError:
            continue
        sig = [st.st_size, int(st.st_mtime)]
        c = cache.get(key)
        if c and c.get("sig") == sig:
            continue
        if budget and time.time() - t0 > budget:
            todo += 1
            continue
        try:                                     # make sure a converted model isn't see-through, then read it
            fixed += bool(fix_materials.fix_glb(full, False) if fn.lower().endswith(".glb") else fix_materials.fix_gltf(full, False))
            st = os.stat(full)
            cache[key] = {"sig": [st.st_size, int(st.st_mtime)], "entry": catalog_entry(full, dirpath, fn)}
        except Exception as e:
            print("bad", key, e)
            cache[key] = {"sig": sig, "entry": None}
        done_now += 1
        if done_now % 100 == 0:
            json.dump(cache, open(CACHE, "w", encoding="utf-8"), separators=(",", ":"))
            print(f"  ...{done_now} read", flush=True)
    for k in [k for k in cache if k not in seen]: del cache[k]          # deleted files
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), separators=(",", ":"))
    if todo:
        print(f"Read {done_now} models ({fixed} see-through fixed). {todo} left - run the same command again to continue.")
        return False
    items = [c["entry"] for c in cache.values() if c.get("entry")]
    items.sort(key=lambda i: i["url"])
    out = os.path.join(ASSETS, "catalog.json")
    json.dump({"version": 2, "models": items}, open(out, "w", encoding="utf-8"), separators=(",", ":"))
    roles = {}
    for i in items: roles[i["role"]] = roles.get(i["role"], 0) + 1
    print(len(items), "models in catalog ->", out, f"({fixed} see-through fixed this run)")
    print(roles)
    return True


if __name__ == "__main__":
    cmd = sys.argv[1]
    root = sys.argv[2] if len(sys.argv) > 2 else DND_DEFAULT
    if cmd == "copy": cmd_copy(root, limit=float(os.environ.get("COPY_LIMIT", "0")) or None)
    elif cmd == "size": cmd_copy(root, dry=True)
    elif cmd == "jobs": cmd_jobs(root)
    elif cmd == "catalog": cmd_catalog()
