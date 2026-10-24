"""
fix_materials.py - repairs models that come out INVISIBLE in the game.

Why: when FBX models were converted to .glb in Blender, the FBX "transparency" value became an alpha of 0
(fully see-through) with alpha mode MASK, so three.js drew nothing (only their shadows showed). This script
opens every .glb/.gltf in ui/game/assets and, for materials whose alpha is ~0, sets it back to fully opaque.
Only the small JSON part of each file is changed; meshes and textures are untouched. Safe to run again.

Run:  python game_tools/fix_materials.py            (fix)
      python game_tools/fix_materials.py --check    (only report)
"""
import os
import sys
import json
import struct

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui", "game", "assets")


def fix_doc(doc):
    changed = 0
    for m in doc.get("materials", []) or []:
        pbr = m.setdefault("pbrMetallicRoughness", {})
        f = pbr.get("baseColorFactor")
        if f is not None and len(f) == 4 and f[3] < 0.05:
            f[3] = 1.0
            if "baseColorTexture" not in pbr and m.get("alphaMode") in ("MASK", "BLEND"):
                m.pop("alphaMode", None)
                m.pop("alphaCutoff", None)
            changed += 1
        elif f is None and m.get("alphaMode") == "MASK" and "baseColorTexture" not in pbr:
            m.pop("alphaMode", None)
            changed += 1
    return changed


def fix_glb(path, check):
    with open(path, "rb") as fh:                 # read only the small JSON part first (fast); the rest only if we fix it
        head = fh.read(20)
        if head[:4] != b"glTF":
            return 0
        jlen, jtype = struct.unpack("<II", head[12:20])
        if jtype != 0x4E4F534A:
            return 0
        doc = json.loads(fh.read(jlen))
    n = fix_doc(doc)
    if n and not check:
        with open(path, "rb") as fh:
            data = fh.read()
        js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
        js += b" " * ((4 - len(js) % 4) % 4)
        rest = data[20 + jlen:]
        out = data[:12] + struct.pack("<II", len(js), 0x4E4F534A) + js + rest
        out = out[:8] + struct.pack("<I", len(out)) + out[12:]
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(out)
        os.replace(tmp, path)
    return n


def fix_gltf(path, check):
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    n = fix_doc(doc)
    if n and not check:
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        os.replace(tmp, path)
    return n


def main():
    check = "--check" in sys.argv
    files = fixed = mats = 0
    for d, _, names in os.walk(ROOT):
        for name in names:
            p = os.path.join(d, name)
            try:
                n = fix_glb(p, check) if name.lower().endswith(".glb") else fix_gltf(p, check) if name.lower().endswith(".gltf") else None
            except Exception as e:
                print(f"skip {p}: {e}")
                continue
            if n is None:
                continue
            files += 1
            if n:
                fixed += 1
                mats += n
    print(f"{'Would fix' if check else 'Fixed'} {mats} invisible materials in {fixed} of {files} model files.")


if __name__ == "__main__":
    main()
