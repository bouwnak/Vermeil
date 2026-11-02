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
FILES = (".glb", ".vrm", ".fbx", ".dae")            # in this order: the first kind found is the best copy of a model
PICTURES = (".png", ".jpg", ".jpeg", ".webp", ".tga", ".bmp")
OLDEST_FBX = 7100
MAX_UNZIPPED = 4 * 1024 ** 3                        # a zip that unpacks to more than this isn't a model
FBX_TIME = 300
FACE_PICTURE = re.compile(r"eye|iris|pupil|mouth", re.I)
SKIP = re.compile(r"shiny|normal|nor[._]|id[._]|bump|rough|metal|spec|occlu|_ao\b|emiss|_mask", re.I)
OTHER_FORM = re.compile(r"mega|gmax|gigantamax|shiny|alt", re.I)
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
    """an .fbx or .dae -> .glb with Blender. search: the folders its textures may be in. -> {textures, missing}"""
    import animate
    py = animate.env_python()
    if not py:
        raise ValueError("Converting .fbx needs Blender, which comes with UniMate. Set up UniMate first (Rig & animate), or import a .glb of this model.")
    p = subprocess.run([py, os.path.join(HERE, "fbx2glb.py"), src, dest, *search], capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=FBX_TIME, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if p.returncode != 0 or not os.path.exists(dest):
        why = (p.stdout + p.stderr).strip().splitlines()
        raise ValueError(f"Couldn't convert {os.path.basename(src)}: {(why[-1] if why else 'no output')[:200]}")
    try:
        return json.loads(p.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
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
    slimrig.write_glb(path, js, binary)


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
            return {"error": "No 3D model in there (looked for .glb, .vrm, .fbx and .dae)."}
        kind = os.path.splitext(src)[1].lower()
        try:
            if kind in (".glb", ".vrm"):
                res = copy_plain([src] + [f for f in paths if f != src and os.path.isfile(f)], models_dir)
                if res.get("error"):
                    return res
                return {"name": res["name"], "note": ""}
            name = free_name(models_dir, safe_name(os.path.splitext(os.path.basename(src))[0]))
            if kind == ".fbx" and 0 < fbx_version(src) < OLDEST_FBX:
                same = same_model(src, files)
                if not same:
                    return {"error": f"{os.path.basename(src)} is an old FBX (version {fbx_version(src) / 1000:.1f}) that Blender can't read. "
                                     "Export it again as FBX 2011 or newer, or import a .dae or .glb of this model."}
                src = same
            out = os.path.join(models_dir, name)
            info = convert(src, out, search_folders(files))
            fix_rip(out)
            note = describe(files)
            if info.get("missing"):
                note += f" Couldn't find {len(info['missing'])} of its textures."
            return {"name": name, "note": note}
        except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as e:
            return {"error": str(e) or f"Couldn't import {os.path.basename(src)}."}
    finally:
        shutil.rmtree(work, ignore_errors=True)
