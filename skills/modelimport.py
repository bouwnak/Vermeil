"""
modelimport.py - brings a 3D model into ui/models, from whatever it arrived in.

You can pick a .glb, .vrm or .fbx file, a whole folder, or a .zip (zips inside zips too, as model sites pack them). The folder is searched for the
model and its textures:
  - .glb / .vrm are copied
  - .fbx is converted to .glb by Blender (fbx2glb.py, run with UniMate's Python, which has Blender built in), its textures found by name anywhere
    in the folder. Blender can't read .fbx from before 2010 (version 7.1), which game rips often are; a .dae of the same model next to it is used.
Blender's guesses are corrected afterwards (fix_rip): nothing is left looking like black metal, and a body isn't left see-through by the mask
game textures keep in their alpha.
The textures then stay in the model; ui/facetex.js finds the eye and mouth sheets among them and moves them.
"""
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile

import slimrig

HERE = os.path.dirname(os.path.abspath(__file__))
FILES = (".glb", ".vrm", ".blend", ".fbx", ".dae")  # in this order: the first kind found is the best copy of a model
PICTURES = (".png", ".jpg", ".jpeg", ".webp", ".tga", ".bmp")
OLDEST_FBX = 7100
MAX_UNZIPPED = 4 * 1024 ** 3                        # a zip that unpacks to more than this isn't a model
FBX_TIME = 300
FACE_PICTURE = re.compile(r"eye|iris|pupil|mouth", re.I)
SKIP = re.compile(r"shiny|normal|nor[._]|id[._]|bump|rough|metal|spec|occlu|_ao\b|emiss|_mask", re.I)
OTHER_FORM = re.compile(r"mega|gmax|gigantamax|shiny|alt", re.I)
OUTLINE = re.compile(r"^(line|outline|edge)", re.I)
THIN = re.compile(r"iris|pupil|fire|flame|sten|glass|shadow|wing_?membrane|hair_?card", re.I)    # layers that are meant to be see-through


def safe_name(name):
    return re.sub(r'[\\/:*?"<>|]+', "_", name).strip(" .") or "model"


def free_name(folder, stem):
    """<stem>.glb, or <stem>-2.glb if a model has that name already: importing never replaces one"""
    n, name = 1, f"{stem}.glb"
    while os.path.exists(os.path.join(folder, name)):
        n += 1
        name = f"{stem}-{n}.glb"
    return name


def unzip(path, into):
    """Unpack a zip into a folder of its own, and any zip inside it. Names that would land outside the folder are skipped."""
    with zipfile.ZipFile(path) as z:
        members = z.infolist()
        if sum(m.file_size for m in members) > MAX_UNZIPPED:
            raise ValueError(f"{os.path.basename(path)} unpacks to more than 4 GB, which is too big to be a model.")
        root = os.path.realpath(into)
        for m in members:
            target = os.path.realpath(os.path.join(into, m.filename))
            if m.is_dir() or not target.startswith(root + os.sep):
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(m) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
    for folder, _, files in os.walk(into):
        for f in files:
            if f.lower().endswith(".zip"):
                inner = os.path.join(folder, f)
                try:
                    unzip(inner, inner + "_unzipped")
                except (zipfile.BadZipFile, OSError):
                    pass


def gather(paths, work):
    """Everything picked, as plain files: folders walked and zips unpacked into `work`. -> [file paths]"""
    found = []
    for i, p in enumerate(paths):
        if os.path.isdir(p):
            inside = [os.path.join(d, f) for d, _, fs in os.walk(p) for f in fs]
            zips = [f for f in inside if f.lower().endswith(".zip")]
            found += [f for f in inside if f not in zips]
            if zips:
                found += gather(zips, os.path.join(work, f"d{i}"))
        elif p.lower().endswith(".zip"):
            out = os.path.join(work, str(i))
            os.makedirs(out, exist_ok=True)
            unzip(p, out)
            found += [os.path.join(d, f) for d, _, fs in os.walk(out) for f in fs]
        else:
            found.append(p)
    return [f for f in found if not f.lower().endswith(".zip")]


def best_model(files):
    """the model among the files: the most ready-to-use kind, its base form before Mega and the like, then the shortest name"""
    for ext in FILES:
        hits = [f for f in files if f.lower().endswith(ext)]
        if hits:
            return min(hits, key=lambda f: (bool(OTHER_FORM.search(os.path.basename(f))), len(os.path.basename(f)), f))
    return None


def same_model(src, files):
    """the .dae of an .fbx: named after it (Charizard.FBX -> Charizard_ColladaMax.DAE)"""
    stem = os.path.splitext(os.path.basename(src))[0].lower()
    named = [f for f in files if f.lower().endswith(".dae") and os.path.basename(f).lower().startswith(stem) and not OTHER_FORM.search(os.path.basename(f)[len(stem):])]
    return min(named, key=lambda f: len(os.path.basename(f))) if named else None


def fbx_version(path):
    """7400 for an FBX 7.4 file; 0 if it can't tell"""
    with open(path, "rb") as f:
        head = f.read(4096)
    if head.startswith(b"Kaydara FBX Binary"):
        return struct.unpack_from("<I", head, 23)[0]
    m = re.search(rb"FBXVersion:\s*(\d+)", head)
    return int(m.group(1)) if m else 0


def search_folders(files):
    """the folders to look for textures in: one for each drive, since a folder on D: can hold a zip that was unpacked on C:"""
    drives = {}
    for f in files:
        drives.setdefault(os.path.splitdrive(os.path.abspath(f))[0].lower(), []).append(os.path.dirname(os.path.abspath(f)))
    return [os.path.commonpath(dirs) for dirs in drives.values()]


def convert(src, dest, search):
    """an .fbx, .dae or .blend -> .glb with Blender. search: the folders its textures may be in. -> {textures, missing, and for a .blend what it found}"""
    import animate
    py = animate.env_python()
    if not py:
        raise ValueError("Converting .fbx needs Blender, which comes with UniMate. Set up UniMate first (Rig & animate), or import a .glb of this model.")
    script = "blend2glb.py" if src.lower().endswith(".blend") else "fbx2glb.py"
    p = subprocess.run([py, os.path.join(HERE, script), src, dest, *search], capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=FBX_TIME, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if p.returncode != 0 or not os.path.exists(dest):
        why = (p.stdout + p.stderr).strip().splitlines()
        raise ValueError(f"Couldn't convert {os.path.basename(src)}: {(why[-1] if why else 'no output')[:200]}")
    try:
        return json.loads(next(x for x in reversed(p.stdout.strip().splitlines()) if x.startswith("{")))
    except (ValueError, IndexError, StopIteration):
        return {}


def fix_rip(path):
    """Blender's guesses put right: plain painted surfaces, and solid bodies"""
    js, binary = slimrig.read_glb(path)
    materials, textures = js.get("materials", []), js.get("textures", [])
    images = js.get("images", [])
    for m in materials:
        pbr = m.setdefault("pbrMetallicRoughness", {})
        pbr.update(metallicFactor=0, roughnessFactor=0.75)     # Blender's guess is often full metal, which is black without reflections
        if "baseColorTexture" in pbr:
            pbr.pop("baseColorFactor", None)
        pbr.pop("metallicRoughnessTexture", None)
        tex = (pbr.get("baseColorTexture") or {}).get("index")
        pic = images[textures[tex].get("source", 0)].get("name", "") if tex is not None else ""
        if m.get("alphaMode") == "BLEND" and not THIN.search(f"{m.get('name', '')} {pic}"):
            m["alphaMode"] = "OPAQUE"              # game textures keep a mask for shine in their alpha, not transparency
        if tex is not None and "emissiveTexture" not in m and sum(m.get("emissiveFactor", [0, 0, 0])) > 0:
            m.pop("emissiveFactor", None)          # a glow with no picture of its own over a painted surface is a converter's guess (an FBX "ambient"): it washes the whole surface out white
        if OUTLINE.match(m.get("name", "")) and tex is None and sum((pbr.get("baseColorFactor") or [1, 1, 1])[:3]) < 0.6:
            m["doubleSided"] = False               # an anime outline: a dark shell turned inside out, seen only round the edges. Drawn from both sides it covers the whole body in black
    slimrig.write_glb(path, js, binary)


STAGE_NAME = re.compile(r"^(bg|back_?ground|back_?drop|platform|pedestal|plinth|stage|ground|floor|disc|disk|plane|base(_?(mesh|plane|plate|disc|disk))?|turntable|shadow_?(plane|catcher|mesh)?)([._ \d]|$)", re.I)


def strip_stage(path, report=None):
    """takes away what a model was only displayed on: a backdrop by its name, or anything flat, under the body and much wider than it. -> how many parts went.
    Works part by part, from the sizes each part's file records, so nothing has to be loaded in 3D. A skinned model's parts are read in their rest pose"""
    js, binary = slimrig.read_glb(path)
    nodes, meshes, acc = js.get("nodes", []), js.get("meshes", []), js.get("accessors", [])

    def mat(n):
        if "matrix" in n:
            m = n["matrix"]
            return [m[0::4], m[1::4], m[2::4], m[3::4]]
        tx, ty, tz = n.get("translation", (0, 0, 0))
        qx, qy, qz, qw = n.get("rotation", (0, 0, 0, 1))
        sx, sy, sz = n.get("scale", (1, 1, 1))
        return [[(1 - 2 * (qy * qy + qz * qz)) * sx, (2 * (qx * qy - qz * qw)) * sy, (2 * (qx * qz + qy * qw)) * sz, tx],
                [(2 * (qx * qy + qz * qw)) * sx, (1 - 2 * (qx * qx + qz * qz)) * sy, (2 * (qy * qz - qx * qw)) * sz, ty],
                [(2 * (qx * qz - qy * qw)) * sx, (2 * (qy * qz + qx * qw)) * sy, (1 - 2 * (qx * qx + qy * qy)) * sz, tz], [0, 0, 0, 1]]

    def times(a, b):
        return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]

    parts = []                                             # (node, primitive index, box min, box max, name)

    # a skinned part doesn't go where its node is: its bones place it. At rest, any of its bones times that bone's inverse bind says where
    up = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    joints = {j for s in js.get("skins", []) for j in s.get("joints", [])}
    try:
        binds = slimrig._binds(js, binary, slimrig._worlds(nodes, up, joints))
    except (KeyError, ValueError, IndexError):
        binds = {}

    def walk(i, parent):
        n = nodes[i]
        m = times(parent, mat(n))
        if "skin" in n and binds.get(n["skin"]):
            m = next(iter(binds[n["skin"]].values())).tolist()
        if "mesh" in n:
            for k, prim in enumerate(meshes[n["mesh"]].get("primitives", [])):
                a = acc[prim["attributes"]["POSITION"]]
                if "min" not in a:
                    continue
                pts = [[sum(m[r][c] * p[c] for c in range(3)) + m[r][3] for r in range(3)] for p in ([x, y, z] for x in (a["min"][0], a["max"][0]) for y in (a["min"][1], a["max"][1]) for z in (a["min"][2], a["max"][2]))]
                parts.append((i, k, [min(p[r] for p in pts) for r in range(3)], [max(p[r] for p in pts) for r in range(3)], n.get("name") or meshes[n["mesh"]].get("name", "")))
        for c in n.get("children", []):
            walk(c, m)

    one = [[float(r == c) for c in range(4)] for r in range(4)]
    for s in js.get("scenes", []):
        for root in s.get("nodes", []):
            walk(root, one)
    if len(parts) < 2:
        return 0
    if report is not None:
        report.extend(parts)
    gone = [p for p in parts if STAGE_NAME.match(p[4] or "")]
    rest = [p for p in parts if p not in gone]
    low, high = min(p[2][1] for p in rest), max(p[3][1] for p in rest)
    tall = max(high - low, 1e-6)
    for p in list(rest):
        others = [q for q in rest if q is not p and q not in gone]
        if not others:
            break
        wide = max(max(q[3][r] for q in others) - min(q[2][r] for q in others) for r in (0, 2))
        span = max(max(q[3][r] for q in others) - min(q[2][r] for q in others) for r in range(3))
        size = [p[3][r] - p[2][r] for r in range(3)]
        flat_under = size[1] < tall * 0.08 and p[3][1] < low + tall * 0.12 and max(size[0], size[2]) > wide * 1.4
        # a sheet much bigger than the whole of the rest, lying any way at all: a floor, or a backdrop standing behind (Shibahu's base_mesh, 2.6 m square)
        sheet = min(size) < max(size) * 0.03 and max(size) > span * 1.4
        if flat_under or sheet:
            gone.append(p)
    if not gone or len(gone) == len(parts):
        return 0
    for i, k in sorted(((p[0], p[1]) for p in gone), key=lambda x: -x[1]):
        del meshes[nodes[i]["mesh"]]["primitives"][k]
    for n in nodes:
        if "mesh" in n and not meshes[n["mesh"]]["primitives"]:
            del n["mesh"]
            n.pop("skin", None)
    slimrig.write_glb(path, js, binary)
    return len(gone)


def attach_pictures(path, files):
    """A .glb whose materials have no pictures, with the pictures lying beside it in the download (Hilda's): each material gets the one its name matches,
    packed into the file. -> how many materials got one"""
    from texmatch import best_picture
    js, binary = slimrig.read_glb(path)
    pictures = {os.path.basename(f).lower(): f for f in files if f.lower().endswith((".png", ".jpg", ".jpeg"))}
    if not pictures:
        return 0
    binary, done, packed = bytearray(binary), 0, {}
    for m in js.get("materials", []):
        pbr = m.setdefault("pbrMetallicRoughness", {})
        if "baseColorTexture" in pbr:
            continue
        pic = best_picture(m.get("name", ""), pictures)
        if not pic:
            continue
        if pic not in packed:
            raw = open(pic, "rb").read()
            while len(binary) % 4:
                binary.append(0)
            js.setdefault("bufferViews", []).append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
            binary.extend(raw)
            js.setdefault("images", []).append({"name": os.path.splitext(os.path.basename(pic))[0].replace(".ktx", ""), "mimeType": "image/png" if pic.lower().endswith(".png") else "image/jpeg", "bufferView": len(js["bufferViews"]) - 1})
            js.setdefault("samplers", []).append({})
            js.setdefault("textures", []).append({"source": len(js["images"]) - 1, "sampler": len(js["samplers"]) - 1})
            packed[pic] = len(js["textures"]) - 1
        pbr["baseColorTexture"] = {"index": packed[pic]}
        pbr.pop("baseColorFactor", None)
        done += 1
    if done:
        js["buffers"][0]["byteLength"] = len(binary)
        slimrig.write_glb(path, js, bytes(binary))
    return done


def blend_note(info):
    """what a .blend turned out to hold, in words"""
    bits = []
    if info.get("bones"):
        bits.append(f"Its own rig came with it ({info['bones']} bones)")
    else:
        bits.append("It has no rig inside, so press Rig it to give it one")
    if info.get("shapes"):
        bits.append(f"{len(info['shapes'])} face shapes kept")
    if info.get("clips"):
        bits.append(f"{len(info['clips'])} animations kept")
    if info.get("dropped"):
        bits.append(f"left out {', '.join(info['dropped'])}")
    return ". ".join(bits) + "."


def describe(files):
    names = sorted({os.path.basename(f) for f in files if f.lower().endswith(PICTURES) and FACE_PICTURE.search(os.path.basename(f)) and not SKIP.search(f[-80:])})
    if not names:
        return "No face pictures in there, so it comes in as the plain model."
    return f"Found its face pictures ({', '.join(names[:4])}{'…' if len(names) > 4 else ''})."


def import_paths(paths, models_dir, copy_plain):
    """paths: files, folders or zips. copy_plain(paths, dest): how a .glb / .vrm and pictures picked with it are copied.
    -> {"name": the model in models_dir, "note": what was found} or {"error": ...}"""
    paths = [p for p in paths if p]
    os.makedirs(models_dir, exist_ok=True)
    work = tempfile.mkdtemp(prefix="vermeil_import_")
    try:
        try:
            files = gather(paths, work)
        except (zipfile.BadZipFile, OSError, ValueError) as e:
            return {"error": f"Couldn't open that: {e}"}
        src = best_model(files)
        if not src:
            return {"error": "No 3D model in there (looked for .glb, .vrm, .blend, .fbx and .dae)."}
        kind = os.path.splitext(src)[1].lower()
        try:
            if kind in (".glb", ".vrm"):
                res = copy_plain([src] + [f for f in paths if f != src and os.path.isfile(f)], models_dir)
                if res.get("error"):
                    return res
                dest = os.path.join(models_dir, res["name"])
                gone = strip_stage(dest)
                found = attach_pictures(dest, files)
                if found:
                    fix_rip(dest)
                note = (f"Took away the platform it stood on ({gone} part{'s' if gone > 1 else ''}). " if gone else "") + (f"Found the pictures for {found} of its materials beside it." if found else "")
                return {"name": res["name"], "note": note.strip()}
            name = free_name(models_dir, safe_name(os.path.splitext(os.path.basename(src))[0]))
            if kind == ".fbx" and 0 < fbx_version(src) < OLDEST_FBX:
                same = same_model(src, files)
                if not same:
                    return {"error": f"{os.path.basename(src)} is an old FBX (version {fbx_version(src) / 1000:.1f}) that Blender can't read. "
                                     "Export it again as FBX 2011 or newer, or import a .dae or .glb of this model."}
                src = same
            out = os.path.join(models_dir, name)
            info = convert(src, out, search_folders(files))
            attach_pictures(out, files)                     # anything Blender couldn't place, matched by name
            fix_rip(out)
            gone = strip_stage(out)
            note = describe(files)
            if kind == ".blend":
                note = blend_note(info) + " " + note
            elif gone:
                note = f"Took away the platform it stood on. {note}"
            if info.get("missing"):
                note += f" Couldn't find {len(info['missing'])} of its textures."
            return {"name": name, "note": note}
        except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as e:
            return {"error": str(e) or f"Couldn't import {os.path.basename(src)}."}
    finally:
        shutil.rmtree(work, ignore_errors=True)
