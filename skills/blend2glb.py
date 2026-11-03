"""
blend2glb.py - turns a Blender .blend into a .glb. Run by skills/modelimport.py with UniMate's Python, which has Blender inside it (bpy).
    python blend2glb.py model.blend out.glb folder_with_textures [more folders]
What the author built is kept: the rig, its animations and the shape keys that drive the face. Scene things that aren't the model stay behind (cameras, lights,
a backdrop or a platform). A rig made of controls and helpers is baked down to what the deforming bones do. Textures are found again by file name under the folder.
Prints {"textures", "missing", "bones", "shapes", "clips", "dropped", "meshes"} as its last line.
"""
import json
import os
import re
import sys

import bpy

STAGE = re.compile(r"^(bg|back_?ground|back_?drop|platform|pedestal|plinth|stage|ground|floor|disc|disk|plane|shadow_?(plane|catcher)?)([._ \d]|$)", re.I)


def pictures_under(folders):
    out = {}
    for folder in folders:
        for d, _, files in os.walk(folder):
            for f in files:
                if f.lower().endswith((".png", ".jpg", ".jpeg", ".tga", ".bmp", ".webp", ".exr", ".tif", ".tiff")):
                    out[f.lower()] = os.path.join(d, f)
    return out


def relink(found):
    done, missing = 0, []
    for img in bpy.data.images:
        if img.source != "FILE" or img.packed_file:
            continue
        name = os.path.basename(img.filepath.replace("\\", "/")).lower() or img.name.lower()
        path = found.get(name) or next((p for n, p in found.items() if os.path.splitext(n)[0] == os.path.splitext(name)[0]), None)
        if path:
            img.filepath = path
            img.reload()
            done += 1
        elif img.size[0]:
            done += 1
        else:
            missing.append(name)
    return done, missing


def world_box(o):
    from mathutils import Vector
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]


def stage_objects(meshes):
    """a backdrop by its name, or by its shape: flat, under everything, and wider than the rest of the model put together"""
    out = [o for o in meshes if STAGE.match(o.name)]
    rest = [o for o in meshes if o not in out]
    if len(rest) < 2:
        return out if rest else []
    boxes = {o: world_box(o) for o in rest}
    low, high = min(b[0][2] for b in boxes.values()), max(b[1][2] for b in boxes.values())
    tall = max(high - low, 1e-6)
    for o, (a, b) in boxes.items():
        others = [v for k, v in boxes.items() if k is not o]
        wide = max(max(v[1][i] for v in others) - min(v[0][i] for v in others) for i in (0, 1))
        if b[2] - a[2] < tall * 0.08 and b[2] < low + tall * 0.12 and max(b[0] - a[0], b[1] - a[1]) > wide * 1.4:
            out.append(o)
    return out


def main(src, dest, folders):
    bpy.ops.wm.open_mainfile(filepath=src)
    found = pictures_under(folders)
    done, missing = relink(found)
    from fbx2glb import by_name                         # pictures left beside the file and never named in it
    done += by_name(found)
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]
    dropped = stage_objects(meshes)
    names = [o.name for o in dropped]
    for o in dropped:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    keep = meshes + arms
    bpy.ops.object.select_all(action="DESELECT")
    for o in keep:
        o.hide_viewport = False
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = (arms or meshes)[0]
    shapes = sorted({k.name for o in meshes if o.data.shape_keys for k in o.data.shape_keys.key_blocks[1:]})
    clips = [a.name for a in bpy.data.actions if any(c.data_path.startswith("pose.bones") for c in a.fcurves)] if arms else []
    # modifiers can only be applied to meshes without shape keys, and a face needs its keys
    bpy.ops.export_scene.gltf(filepath=dest, export_format="GLB", use_selection=True, export_skins=True, export_morph=True, export_animations=bool(clips),
                              export_apply=not shapes, export_yup=True, export_def_bones=bool(arms), export_image_format="AUTO")
    print(json.dumps({"textures": done, "missing": missing, "bones": sum(len(a.data.bones) for a in arms), "shapes": shapes[:120], "clips": clips[:60], "dropped": names, "meshes": len(meshes)}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
