"""Blender (headless): the classic D&D props the asset packs don't have, in the same low-poly style as blender_missing.py.

    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Blender\\blender.exe" -b --factory-startup --python game_tools\\blender_dnd_props.py

Makes into ui/game/assets/made/:
  Throne, Altar, Coffin, Sarcophagus, Statue_Knight, Tavern_Sign, Weapon_Rack, Treasure_Pile, Brazier,
  Rune_Obelisk, Bookshelf_Full, Market_Stall, Banner_Stand
Then run  python game_tools/build_game_assets.py catalog  so the game knows them.
Materials named "Glow" light up at night in the game (braziers, runes).
"""
import bpy, bmesh, math, os, random
from mathutils import Vector

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(PROJECT, "ui", "game", "assets", "made")
os.makedirs(OUT, exist_ok=True)
random.seed(7)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
SCENE = bpy.context.scene
_mats = {}


def mat(name, rgb, rough=0.8, metal=0.0, emit=None):
    if name in _mats: return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 3.0
    _mats[name] = m
    return m


def _obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    SCENE.collection.objects.link(o)
    me.materials.append(material)
    return o


def box(name, size, loc, material, rot=(0, 0, 0), bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect="EDGES")
    o = _obj(name, bm, material); o.location = loc; o.rotation_euler = rot
    return o


def cyl(name, r1, r2, h, loc, material, seg=8, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
    o = _obj(name, bm, material); o.location = loc; o.rotation_euler = rot
    return o


def ico(name, r, loc, material, sub=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    o = _obj(name, bm, material); o.location = loc
    return o


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    return o


def export(o, name):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", use_selection=True, export_apply=True, export_yup=True)


WOOD = mat("Wood", (0.42, 0.26, 0.14)); WOOD_D = mat("WoodDark", (0.25, 0.15, 0.08))
STONE = mat("Stone", (0.74, 0.73, 0.69), 0.9); STONE_D = mat("StoneDark", (0.45, 0.45, 0.43), 0.9)
GOLD = mat("Gold", (0.95, 0.72, 0.22), 0.35, 0.9); IRON = mat("Iron", (0.12, 0.12, 0.13), 0.5, 0.7)
RED = mat("Velvet", (0.55, 0.06, 0.1)); CLOTH = mat("Cloth", (0.8, 0.72, 0.55)); BLUE = mat("Banner", (0.14, 0.24, 0.6))
GLOW = mat("Glow", (1.0, 0.6, 0.2), 0.4, 0.0, emit=(1.0, 0.55, 0.15)); RUNE = mat("Glow", (1.0, 0.6, 0.2))
RUNEC = mat("GlowRune", (0.4, 0.9, 1.0), 0.4, 0.0, emit=(0.3, 0.85, 1.0))
BONE = mat("Bone", (0.88, 0.85, 0.74)); GEM = mat("Gem", (0.2, 0.75, 0.55), 0.2, 0.1)


def throne():
    p = [box("seat", (0.9, 0.8, 0.45), (0, 0, 0.45), STONE, bevel=0.03), box("cushion", (0.78, 0.68, 0.1), (0, 0.02, 0.72), RED, bevel=0.03),
         box("back", (0.95, 0.18, 1.6), (0, -0.36, 1.25), STONE, bevel=0.03), box("backc", (0.7, 0.05, 1.1), (0, -0.26, 1.2), RED)]
    for s in (-1, 1):
        p += [box("arm", (0.16, 0.8, 0.35), (s * 0.5, 0, 0.82), STONE_D, bevel=0.02), ico("knob", 0.1, (s * 0.5, 0.36, 1.03), GOLD)]
    p += [cyl("crown", 0.0, 0.14, 0.3, (0, -0.36, 2.2), GOLD, 4), ico("gem", 0.07, (0, -0.27, 1.85), GEM)]
    for s in (-1, 1): p.append(cyl("spire", 0.0, 0.1, 0.35, (s * 0.38, -0.36, 2.2), GOLD, 4))
    p.append(box("step", (1.4, 1.3, 0.12), (0, 0, 0.06), STONE_D, bevel=0.02))
    return join(p, "Throne")


def altar():
    p = [box("base", (1.6, 0.9, 0.2), (0, 0, 0.1), STONE_D, bevel=0.03), box("body", (1.3, 0.7, 0.75), (0, 0, 0.57), STONE, bevel=0.03),
         box("top", (1.5, 0.85, 0.12), (0, 0, 1.0), STONE_D, bevel=0.03), box("cloth", (0.5, 0.87, 0.02), (0, 0, 1.07), RED),
         box("runeband", (1.31, 0.71, 0.08), (0, 0, 0.75), RUNEC)]
    for s in (-1, 1):
        p += [cyl("candle", 0.05, 0.05, 0.25, (s * 0.55, 0.15, 1.18), CLOTH, 6), ico("flame", 0.045, (s * 0.55, 0.15, 1.34), GLOW)]
    p.append(box("book", (0.35, 0.25, 0.06), (0, -0.1, 1.1), RED))
    return join(p, "Altar")


def coffin():
    pts_lo, pts_hi = [], []
    shape = [(-0.25, -0.95), (0.25, -0.95), (0.38, 0.45), (0.3, 0.95), (-0.3, 0.95), (-0.38, 0.45)]
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, 0)) for x, y in shape]; hi = [bm.verts.new((x, y, 0.45)) for x, y in shape]
    bm.faces.new(lo[::-1]); bm.faces.new(hi)
    for i in range(len(shape)): bm.faces.new((lo[i], lo[(i + 1) % 6], hi[(i + 1) % 6], hi[i]))
    body = _obj("coffin", bm, WOOD_D)
    p = [body, box("lid", (0.62, 1.7, 0.06), (0, 0, 0.48), WOOD, bevel=0.02),
         box("cross_v", (0.08, 0.6, 0.03), (0, 0.2, 0.53), GOLD), box("cross_h", (0.36, 0.08, 0.03), (0, 0.33, 0.53), GOLD)]
    return join(p, "Coffin")


def sarcophagus():
    p = [box("base", (1.1, 2.3, 0.2), (0, 0, 0.1), STONE_D, bevel=0.03), box("body", (0.95, 2.1, 0.7), (0, 0, 0.55), STONE, bevel=0.03),
         box("lid", (1.05, 2.2, 0.16), (0, 0, 0.98), STONE_D, bevel=0.04), box("band", (0.96, 2.11, 0.08), (0, 0, 0.65), GOLD)]
    p += [ico("head", 0.2, (0, 0.75, 1.15), STONE), box("bodyrelief", (0.5, 1.2, 0.14), (0, -0.05, 1.12), STONE, bevel=0.05),
          box("sword", (0.06, 0.9, 0.04), (0, 0, 1.22), IRON), box("guard", (0.3, 0.05, 0.05), (0, 0.42, 1.22), GOLD)]
    return join(p, "Sarcophagus")


def statue_knight():
    p = [box("plinth", (0.9, 0.9, 0.5), (0, 0, 0.25), STONE_D, bevel=0.04), box("plinth2", (0.75, 0.75, 0.15), (0, 0, 0.57), STONE, bevel=0.02)]
    for s in (-1, 1):
        p += [box("leg", (0.17, 0.2, 0.7), (s * 0.13, 0, 1.0), STONE), box("foot", (0.2, 0.3, 0.1), (s * 0.13, 0.05, 0.69), STONE)]
    p += [box("torso", (0.5, 0.3, 0.7), (0, 0, 1.68), STONE, bevel=0.04), box("belt", (0.52, 0.32, 0.08), (0, 0, 1.38), STONE_D),
          ico("helm", 0.17, (0, 0, 2.2), STONE), box("visor", (0.2, 0.05, 0.06), (0, 0.15, 2.2), STONE_D),
          cyl("plume", 0.0, 0.06, 0.25, (0, -0.05, 2.45), STONE, 6)]
    for s in (-1, 1): p += [box("shoulder", (0.22, 0.3, 0.16), (s * 0.34, 0, 1.95), STONE_D, bevel=0.03), box("arm", (0.13, 0.15, 0.6), (s * 0.33, 0.08, 1.62), STONE)]
    p += [box("blade", (0.08, 0.03, 1.3), (0, 0.3, 1.25), STONE), box("cross", (0.4, 0.06, 0.07), (0, 0.3, 1.92), STONE_D), ico("pommel", 0.06, (0, 0.3, 2.08), STONE_D),
          box("moss", (0.92, 0.92, 0.03), (0, 0, 0.51), mat("Moss", (0.33, 0.55, 0.22), 0.9))]
    return join(p, "Statue_Knight")


def tavern_sign():
    p = [cyl("post", 0.07, 0.07, 2.8, (0, 0, 1.4), WOOD_D, 6), box("arm", (1.1, 0.08, 0.08), (0.5, 0, 2.6), WOOD_D),
         box("brace", (0.6, 0.06, 0.06), (0.28, 0, 2.38), WOOD_D, rot=(0, math.radians(-40), 0)),
         box("board", (0.8, 0.06, 0.55), (0.65, 0, 2.15), WOOD, bevel=0.02), box("frame", (0.86, 0.04, 0.61), (0.65, -0.01, 2.15), WOOD_D),
         cyl("mug", 0.12, 0.11, 0.24, (0.65, 0.05, 2.15), GOLD, 8, rot=(math.radians(90), 0, 0)), box("handle", (0.05, 0.05, 0.14), (0.8, 0.05, 2.15), GOLD)]
    for x in (0.35, 0.95): p.append(cyl("chain", 0.015, 0.015, 0.3, (x, 0, 2.45), IRON, 4))
    return join(p, "Tavern_Sign")


def weapon_rack():
    p = [box("base", (1.4, 0.35, 0.1), (0, 0, 0.05), WOOD_D), box("top", (1.4, 0.12, 0.08), (0, 0, 1.3), WOOD_D)]
    for x in (-0.65, 0.65): p.append(box("side", (0.08, 0.12, 1.3), (x, 0, 0.65), WOOD_D))
    for i, x in enumerate((-0.45, -0.15, 0.15, 0.45)):
        if i % 2 == 0:
            p += [box("blade", (0.06, 0.02, 1.0), (x, 0.08, 0.75), IRON), box("guard", (0.22, 0.04, 0.04), (x, 0.08, 0.3), GOLD), box("grip", (0.04, 0.04, 0.2), (x, 0.08, 0.18), WOOD)]
        else:
            p += [cyl("shaft", 0.025, 0.025, 1.4, (x, 0.08, 0.75), WOOD, 6), cyl("head", 0.0, 0.06, 0.25, (x, 0.08, 1.55), IRON, 4)]
    p.append(cyl("shield", 0.32, 0.32, 0.05, (0, -0.12, 0.75), BLUE, 12, rot=(math.radians(90), 0, 0)))
    p.append(cyl("boss", 0.08, 0.06, 0.07, (0, -0.17, 0.75), GOLD, 8, rot=(math.radians(90), 0, 0)))
    return join(p, "Weapon_Rack")


def treasure_pile():
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.9, radius2=0.05, depth=0.55)
    pile = _obj("pile", bm, GOLD); pile.location = (0, 0, 0.27)
    p = [pile]
    for i in range(28):
        a, r = random.random() * 6.28, random.random() * 0.95
        p.append(cyl("coin", 0.08, 0.08, 0.02, (math.cos(a) * r, math.sin(a) * r, 0.03 + random.random() * 0.25 * (1 - r)), GOLD, 8, rot=(random.random(), random.random(), 0)))
    for i in range(6):
        a = random.random() * 6.28
        p.append(ico("gem", 0.07, (math.cos(a) * 0.5, math.sin(a) * 0.5, 0.2), random.choice([GEM, RED, BLUE])))
    p += [box("chest", (0.6, 0.4, 0.35), (0.55, -0.45, 0.2), WOOD, bevel=0.03), box("band", (0.62, 0.42, 0.06), (0.55, -0.45, 0.25), GOLD), cyl("goblet", 0.07, 0.05, 0.25, (-0.4, 0.3, 0.45), GOLD, 8)]
    return join(p, "Treasure_Pile")


def brazier():
    p = [cyl("bowl", 0.45, 0.25, 0.3, (0, 0, 1.05), IRON, 10), cyl("rim", 0.48, 0.48, 0.05, (0, 0, 1.2), IRON, 10)]
    for i in range(3):
        a = i * 2.094
        p.append(box("leg", (0.06, 0.06, 1.0), (math.cos(a) * 0.25, math.sin(a) * 0.25, 0.48), IRON, rot=(math.sin(a) * 0.25, -math.cos(a) * 0.25, 0)))
    for i in range(6):
        a = i * 1.05
        p.append(ico("coal", 0.12, (math.cos(a) * 0.2, math.sin(a) * 0.2, 1.22), GLOW))
    p.append(cyl("flame", 0.25, 0.0, 0.55, (0, 0, 1.5), GLOW, 6))
    return join(p, "Brazier")


def rune_obelisk():
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.42, radius2=0.26, depth=3.0)
    ob = _obj("obelisk", bm, STONE_D); ob.location = (0, 0, 1.5); ob.rotation_euler = (0, 0, math.radians(45))
    p = [ob, cyl("tip", 0.26, 0.0, 0.5, (0, 0, 3.25), STONE_D, 4, rot=(0, 0, math.radians(45))), box("base", (1.1, 1.1, 0.25), (0, 0, 0.12), STONE, bevel=0.04)]
    for i in range(5):
        p.append(box("rune", (0.12, 0.03, 0.22), (random.uniform(-0.1, 0.1), 0.34 - i * 0.02, 0.6 + i * 0.48), RUNEC, rot=(0, random.uniform(-0.4, 0.4), 0)))
    return join(p, "Rune_Obelisk")


def bookshelf():
    p = [box("back", (1.4, 0.05, 2.0), (0, -0.2, 1.0), WOOD_D), box("top", (1.45, 0.45, 0.06), (0, 0, 2.0), WOOD)]
    for x in (-0.7, 0.7): p.append(box("side", (0.06, 0.45, 2.0), (x, 0, 1.0), WOOD))
    cols = [RED, BLUE, mat("BookG", (0.2, 0.45, 0.25)), mat("BookB", (0.45, 0.3, 0.15)), CLOTH]
    for shelf in range(4):
        z = 0.08 + shelf * 0.5
        p.append(box("shelf", (1.35, 0.42, 0.04), (0, 0, z), WOOD))
        x = -0.62
        while x < 0.6:
            w = random.uniform(0.05, 0.1); h = random.uniform(0.28, 0.42)
            tilt = random.random() < 0.1
            p.append(box("book", (w, 0.3, h), (x + w / 2, 0.02, z + h / 2 + 0.02), random.choice(cols), rot=(0, 0.25 if tilt else 0, 0)))
            x += w + 0.008
    return join(p, "Bookshelf_Full")


def market_stall():
    p = [box("counter", (2.2, 0.8, 0.9), (0, 0.3, 0.45), WOOD, bevel=0.02), box("top", (2.3, 0.9, 0.06), (0, 0.3, 0.92), WOOD_D)]
    for x in (-1.05, 1.05):
        for y in (-0.6, 0.65): p.append(cyl("pole", 0.05, 0.05, 2.4, (x, y, 1.2), WOOD_D, 6))
    for i in range(6):
        c = RED if i % 2 == 0 else CLOTH
        p.append(box("awning", (0.4, 1.6, 0.04), (-1.0 + i * 0.4, 0.0, 2.35), c, rot=(math.radians(-12), 0, 0)))
    for i in range(5):
        p.append(ico("fruit", 0.09, (-0.8 + i * 0.4, 0.35, 1.02), random.choice([RED, mat("Apple", (0.85, 0.65, 0.1)), mat("Lime", (0.4, 0.7, 0.2))])))
    p += [cyl("basket", 0.25, 0.2, 0.25, (0.7, 0.35, 1.07), mat("Wicker", (0.7, 0.55, 0.3)), 10), box("crate", (0.5, 0.5, 0.4), (1.5, 0.6, 0.2), WOOD, bevel=0.02)]
    return join(p, "Market_Stall")


def banner_stand():
    p = [cyl("pole", 0.04, 0.04, 3.2, (0, 0, 1.6), WOOD_D, 6), cyl("base", 0.3, 0.35, 0.15, (0, 0, 0.07), STONE_D, 8),
         box("bar", (1.0, 0.05, 0.05), (0, 0, 3.0), IRON), ico("finial", 0.08, (0, 0, 3.25), GOLD)]
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in [(-0.45, 0.03, 2.97), (0.45, 0.03, 2.97), (0.45, 0.03, 1.4), (0.0, 0.03, 1.15), (-0.45, 0.03, 1.4)]]
    bm.faces.new(vs)
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.02)
    p += [_obj("flag", bm, BLUE), box("emblem", (0.3, 0.02, 0.3), (0, 0.05, 2.3), GOLD, rot=(0, math.radians(45), 0))]
    return join(p, "Banner_Stand")


BUILD = [("Throne", throne), ("Altar", altar), ("Coffin", coffin), ("Sarcophagus", sarcophagus), ("Statue_Knight", statue_knight),
         ("Tavern_Sign", tavern_sign), ("Weapon_Rack", weapon_rack), ("Treasure_Pile", treasure_pile), ("Brazier", brazier),
         ("Rune_Obelisk", rune_obelisk), ("Bookshelf_Full", bookshelf), ("Market_Stall", market_stall), ("Banner_Stand", banner_stand)]
made = []
for name, fn in BUILD:
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    o = fn()
    export(o, name)
    made.append(name)
print("MADE:", ", ".join(made))
