"""
fbx2glb.py - turns an .fbx (or .dae) into a .glb. Run by skills/modelimport.py with UniMate's Python, which has Blender inside it (bpy).
    python fbx2glb.py model.fbx out.glb folder_with_textures [more folders]
Blender keeps the bones, the skin and the animations. An .fbx remembers its textures by the paths on the computer that made it, so
they're found again by file name under the folder. Prints {"textures": found, "missing": [names]} as its last line.
"""
import json
import os
import re
import sys

import bpy


def pictures_under(folders):
    """{lower-case file name: path}. Alternate colour sets lose to the normal ones"""
    out = {}
    for folder in folders:
        for d, _, files in os.walk(folder):
            for f in files:
                if f.lower().endswith((".png", ".jpg", ".jpeg", ".tga", ".bmp", ".webp")):
                    p = os.path.join(d, f)
                    if f.lower() not in out or "shiny" in out[f.lower()].lower():
                        out[f.lower()] = p
    return out


NOT_COLOUR = re.compile(r"lgt|light|msk|mask|normal|nrm|[_.]n$|spec|rough|metal|_ao$|occl|emiss|bump|height|shadow|shiny", re.I)
COLOUR = re.compile(r"dif|diffuse|albedo|base_?col|col(or|our)?$|tex", re.I)
OUTLINE = re.compile(r"^(line|outline|edge)", re.I)


def by_name(found):
    """Many downloads keep their pictures in a folder beside the model and the model never names them (Shibahu's materials are plain black).
    A material with no picture gets the colour picture whose name holds the material's own: Body_mt -> Shibahu_body_dif.png. -> how many"""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from texmatch import best_picture
    done = 0
    for mat in bpy.data.materials:
        if OUTLINE.match(mat.name):
            continue                                   # an outline shell is meant to be plain dark
        if not mat.use_nodes:
            mat.use_nodes = True
        nt = mat.node_tree
        pics = [n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image]
        if any(n.image.size[0] for n in pics):
            continue                                   # it has a picture that loaded
        lost = next((n for n in pics if any(l.to_socket.name == "Base Color" for l in n.outputs["Color"].links)), None)     # one it names but nobody could find
        path = best_picture(mat.name, found)
        if not path:
            continue
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        tex = lost or nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(path, check_existing=True)
        if not lost:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
        done += 1
    for img in [i for i in bpy.data.images if i.source == "FILE" and not i.size[0] and not i.users]:
        bpy.data.images.remove(img)                     # the lost ones it replaced
    return done


def main(src, dest, folders):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if src.lower().endswith(".dae"):
        bpy.ops.wm.collada_import(filepath=src)
    else:
        bpy.ops.import_scene.fbx(filepath=src, use_anim=True, ignore_leaf_bones=True)
    found = pictures_under(folders)
    done, missing = 0, []
    for img in bpy.data.images:
        name = os.path.basename(img.filepath.replace("\\", "/")).lower() or img.name.lower()
        if "shiny" not in img.filepath.lower() and img.size[0]:     # reading the size loads it
            done += 1
            continue
        path = found.get(name) or next((p for n, p in found.items() if os.path.splitext(n)[0] == os.path.splitext(name)[0]), None)
        if path:
            img.filepath = path
            img.reload()
            done += 1
        else:
            missing.append(name)
    done += by_name(found)
    missing = [m for m in missing if any(i.source == "FILE" and not i.size[0] and os.path.basename(i.filepath.replace("\\", "/")).lower() == m for i in bpy.data.images)]
    for img in bpy.data.images:                # the .glb keeps these names: the page tells eyes from mouths by them
        if img.filepath:
            img.name = os.path.splitext(os.path.basename(img.filepath.replace("\\", "/")))[0]
    bpy.ops.export_scene.gltf(filepath=dest, export_format="GLB", export_skins=True, export_animations=len(bpy.data.actions) > 0,
                              export_apply=False, export_yup=True)
    print(json.dumps({"textures": done, "missing": missing}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
