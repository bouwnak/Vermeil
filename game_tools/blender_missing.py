"""Blender: build the models the dnd packs don't have, in the same low-poly Quaternius style.

    exec(open(r"C:\\Users\\jpant\\OneDrive\\Desktop\\coding\\2025\\2025\\game_tools\\blender_missing.py").read())

Makes (into ui/game/assets/made/):
  LampPost, LampPost_Double     - iron street lamp with a glowing lantern (material "Glow" = light at night)
  SignPost                      - wooden signpost with arrow boards
  Dice_D4 ... Dice_D20          - numbered dice; dice_faces.json says which face shows which number
  Ruin_Arch, Ruin_Column        - broken stone arch like the forest reference picture
  Gravestone_1, Gravestone_Cross
  Fountain                      - stone fountain (material "Water" is animated by the game)
  Bridge_Wood                   - wooden bridge for river crossings (6 m long, 2 m wide)
  Campfire_Stones               - ring of stones with logs (the game adds the fire effect)
  Portal_Base                   - stone ring the portal opens above
Your open .blend is not saved or changed (everything is built in a temporary scene and removed).
"""
import bpy, bmesh, json, math, os
from mathutils import Vector, Matrix

PROJECT = r"C:\Users\jpant\OneDrive\Desktop\coding\2025\2025"
OUT = os.path.join(PROJECT, "ui", "game", "assets", "made")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- helpers
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


def obj_from_bm(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(material)
    for p in me.polygons: p.use_smooth = False
    return o


def box(name, size, loc, material, rot=(0, 0, 0), bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect="EDGES")
    o = obj_from_bm(name, bm, material)
    o.location = loc; o.rotation_euler = rot
    return o


def cyl(name, r1, r2, h, loc, material, seg=8, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
    o = obj_from_bm(name, bm, material)
    o.location = loc; o.rotation_euler = rot
    return o


def hull(name, pts, material):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts[:], edges=bm.edges[:])
    return obj_from_bm(name, bm, material)


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
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB",
                              use_selection=True, use_active_scene=True, export_apply=True, export_yup=True)


IRON = mat("Iron", (0.09, 0.09, 0.1), 0.5, 0.6)
GLOW = mat("Glow", (1.0, 0.78, 0.38), 0.4, 0.0, emit=(1.0, 0.72, 0.3))
WOOD = mat("Wood", (0.42, 0.26, 0.14))
WOOD_D = mat("WoodDark", (0.27, 0.16, 0.09))
STONE = mat("Stone", (0.78, 0.77, 0.72), 0.9)
STONE_D = mat("StoneDark", (0.55, 0.55, 0.52), 0.9)
MOSS = mat("Moss", (0.33, 0.55, 0.22), 0.9)
WATER = mat("Water", (0.25, 0.65, 0.85), 0.1)
ROPE = mat("Rope", (0.7, 0.58, 0.38))
EMBER = mat("Ember", (0.25, 0.12, 0.06), 0.9)


# ---------------------------------------------------------------- models
def lamp_post(double=False):
    parts = [cyl("base", 0.22, 0.18, 0.25, (0, 0, 0.125), STONE_D, 8),
             cyl("pole", 0.07, 0.05, 2.7, (0, 0, 1.6), IRON, 8),
             cyl("ring", 0.1, 0.1, 0.06, (0, 0, 0.45), IRON, 8),
             cyl("ring2", 0.08, 0.08, 0.05, (0, 0, 2.6), IRON, 8)]
    arms = [1, -1] if double else [1]
    for s in arms:
        x = 0.42 * s
        parts += [box("arm", (0.5, 0.05, 0.05), (x / 2 + 0.02 * s, 0, 2.85), IRON),
                  box("brace", (0.32, 0.04, 0.04), (0.18 * s, 0, 2.7), IRON, rot=(0, -0.6 * s, 0)),
                  cyl("hook", 0.015, 0.015, 0.14, (x, 0, 2.78), IRON, 6)]
        # lantern: cage + glowing glass + roof
        parts += [box("cage_top", (0.26, 0.26, 0.04), (x, 0, 2.7), IRON),
                  box("cage_bot", (0.22, 0.22, 0.04), (x, 0, 2.36), IRON),
                  box("glass", (0.19, 0.19, 0.3), (x, 0, 2.53), GLOW),
                  cyl("roof", 0.2, 0.02, 0.16, (x, 0, 2.8), IRON, 4, rot=(0, 0, math.pi / 4))]
        for dx in (-0.1, 0.1):
            for dy in (-0.1, 0.1):
                parts.append(box("bar", (0.025, 0.025, 0.34), (x + dx, dy, 2.53), IRON))
    if not double:
        parts.append(cyl("finial", 0.05, 0.0, 0.18, (0, 0, 3.05), IRON, 6))
    return join(parts, "LampPost_Double" if double else "LampPost")


def sign_post():
    parts = [box("post", (0.14, 0.14, 2.3), (0, 0, 1.15), WOOD_D, bevel=0.02),
             cyl("cap", 0.12, 0.0, 0.16, (0, 0, 2.38), WOOD_D, 4, rot=(0, 0, math.pi / 4))]
    for i, (z, ang, ln) in enumerate([(1.95, 0.3, 0.9), (1.6, 2.6, 0.8), (1.25, -1.2, 0.7)]):
        bm = bmesh.new()
        pts = [(0, -0.12), (ln - 0.18, -0.12), (ln, 0), (ln - 0.18, 0.12), (0, 0.12)]   # arrow board
        top = [bm.verts.new((x, -0.025, y)) for x, y in pts]
        bot = [bm.verts.new((x, 0.025, y)) for x, y in pts]
        bm.faces.new(top); bm.faces.new(list(reversed(bot)))
        for k in range(len(pts)):
            a, b = k, (k + 1) % len(pts)
            bm.faces.new([top[a], top[b], bot[b], bot[a]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        o = obj_from_bm("board", bm, WOOD)
        o.location = (0, 0, z); o.rotation_euler = (0, 0, ang)
        parts.append(o)
    return join(parts, "SignPost")


def ruin_column(h=2.6, broken=True):
    parts = [box("plinth", (0.7, 0.7, 0.25), (0, 0, 0.125), STONE, bevel=0.03),
             cyl("shaft", 0.26, 0.24, h, (0, 0, 0.25 + h / 2), STONE, 10)]
    if broken:  # jagged top
        parts.append(hull("chunk", [(0.24, 0, 0.25 + h), (-0.2, 0.15, 0.25 + h), (0, -0.24, 0.25 + h),
                                    (0.1, 0.05, 0.25 + h + 0.35), (-0.05, -0.1, 0.25 + h + 0.2)], STONE))
    else:
        parts.append(box("capital", (0.62, 0.62, 0.22), (0, 0, 0.36 + h), STONE, bevel=0.03))
    return parts


def ruin_arch():
    span, h = 2.4, 2.6
    parts = []
    for side in (-1, 1):
        for o in ruin_column(h, broken=False):
            o.location.x += side * span / 2
            parts.append(o)
    top = 0.25 + h + 0.47
    n = 9
    for i in range(n):
        if i in (6,): continue           # a missing stone - it's a ruin
        a0 = math.pi * i / n; a1 = math.pi * (i + 1) / n; a = (a0 + a1) / 2
        r = span / 2
        o = box("voussoir", (0.34, 0.46, 0.42), (math.cos(a) * r, 0, top + math.sin(a) * r * 0.85), STONE, rot=(0, -(a - math.pi / 2), 0), bevel=0.02)
        parts.append(o)
    for x, y in ((-0.6, 0.5), (0.9, -0.4), (0.3, 0.7)):   # fallen stones + moss
        parts.append(box("rubble", (0.35, 0.28, 0.22), (x, y, 0.11), STONE_D, rot=(0.2, 0.1, x), bevel=0.03))
    parts.append(box("moss", (0.66, 0.66, 0.05), (-span / 2, 0, 0.27), MOSS))
    return join(parts, "Ruin_Arch")


def gravestone(cross=False):
    if cross:
        parts = [box("v", (0.16, 0.12, 1.0), (0, 0, 0.5), STONE_D, bevel=0.02),
                 box("h", (0.6, 0.12, 0.16), (0, 0, 0.72), STONE_D, bevel=0.02)]
    else:
        parts = [box("slab", (0.6, 0.14, 0.7), (0, 0, 0.35), STONE_D, bevel=0.02),
                 cyl("top", 0.3, 0.3, 0.14, (0, 0, 0.7), STONE_D, 12, rot=(math.pi / 2, 0, 0))]
    parts.append(box("mound", (0.7, 1.1, 0.12), (0, 0.6, 0.06), MOSS, bevel=0.04))
    return join(parts, "Gravestone_Cross" if cross else "Gravestone_1")


def fountain():
    parts = [cyl("basin_out", 1.6, 1.6, 0.55, (0, 0, 0.275), STONE, 8),
             cyl("water", 1.42, 1.42, 0.05, (0, 0, 0.5), WATER, 8),
             cyl("pillar", 0.22, 0.18, 1.2, (0, 0, 1.0), STONE, 8),
             cyl("bowl", 0.2, 0.7, 0.3, (0, 0, 1.6), STONE, 8),
             cyl("water2", 0.62, 0.62, 0.04, (0, 0, 1.74), WATER, 8),
             cyl("spout", 0.08, 0.04, 0.4, (0, 0, 1.95), STONE, 6)]
    return join(parts, "Fountain")


def bridge():
    parts = []
    L, W = 6.0, 2.0
    for i in range(16):
        x = -L / 2 + (i + 0.5) * L / 16
        z = 0.35 + 0.35 * math.cos(x / (L / 2) * math.pi / 2)   # gentle arch
        parts.append(box("plank", (L / 16 - 0.03, W, 0.08), (x, 0, z), WOOD if i % 2 else WOOD_D, rot=(0, -0.25 * x / (L / 2), 0)))
    for y in (-W / 2, W / 2):
        for i in range(5):
            x = -L / 2 + i * L / 4
            z = 0.35 + 0.35 * math.cos(x / (L / 2) * math.pi / 2)
            parts.append(box("post", (0.12, 0.12, 0.9), (x, y, z + 0.35), WOOD_D))
        for i in range(4):
            x0 = -L / 2 + i * L / 4; x1 = x0 + L / 4
            z0 = 0.35 + 0.35 * math.cos(x0 / (L / 2) * math.pi / 2); z1 = 0.35 + 0.35 * math.cos(x1 / (L / 2) * math.pi / 2)
            ang = math.atan2(z1 - z0, x1 - x0)
            parts.append(box("rail", (math.hypot(x1 - x0, z1 - z0) + 0.1, 0.08, 0.08), ((x0 + x1) / 2, y, (z0 + z1) / 2 + 0.75), WOOD, rot=(0, -ang, 0)))
    for x in (-L / 2 + 0.2, L / 2 - 0.2):
        parts.append(box("beam", (0.3, W + 0.3, 0.3), (x, 0, 0.15), WOOD_D))
    return join(parts, "Bridge_Wood")


def campfire():
    parts = []
    for i in range(9):
        a = i / 9 * math.tau
        parts.append(box("stone", (0.26, 0.2, 0.18), (math.cos(a) * 0.55, math.sin(a) * 0.55, 0.09), STONE_D, rot=(0, 0, a), bevel=0.03))
    for i in range(4):
        a = i / 4 * math.tau + 0.4
        parts.append(cyl("log", 0.07, 0.07, 0.8, (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.2), WOOD_D, 6, rot=(0.9, 0, a)))
    parts.append(cyl("embers", 0.32, 0.32, 0.04, (0, 0, 0.03), EMBER, 8))
    return join(parts, "Campfire_Stones")


def portal_base():
    parts = []
    for i in range(16):
        a = i / 16 * math.tau
        parts.append(box("ring", (0.62, 0.5, 0.25 + 0.06 * (i % 3)), (math.cos(a) * 2.1, math.sin(a) * 2.1, 0.12), STONE, rot=(0, 0, a), bevel=0.03))
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        parts.append(cyl("pylon", 0.22, 0.12, 1.6, (math.cos(a) * 2.6, math.sin(a) * 2.6, 0.8), STONE_D, 6))
        parts.append(box("crystal", (0.16, 0.16, 0.34), (math.cos(a) * 2.6, math.sin(a) * 2.6, 1.8), mat("Crystal", (0.55, 0.9, 1.0), 0.2, 0, emit=(0.35, 0.85, 1.0)), rot=(0.4, 0.4, a)))
    return join(parts, "Portal_Base")


# ---------------------------------------------------------------- dice
def poly_points(kind):
    phi = (1 + 5 ** 0.5) / 2
    if kind == 4:
        return [(1, 1, 1), (1, -1, -1), (-1, 1, -1), (-1, -1, 1)]
    if kind == 6:
        return [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    if kind == 8:
        return [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    if kind == 20:
        p = []
        for a in (-1, 1):
            for b in (-phi, phi):
                p += [(0, a, b), (a, b, 0), (b, 0, a)]
        return p
    if kind == 12:
        p = [(x, y, z) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
        for a in (-1, 1):
            for b in (-phi, phi):
                p += [(0, a / phi, b), (a / phi, b, 0), (b, 0, a / phi)]
        return p
    if kind == 10:  # pentagonal trapezohedron: find ring height so each kite is flat
        H = 1.1

        def off(h):
            P = Vector((0, 0, H)); A = Vector((1, 0, h)); C = Vector((math.cos(math.radians(72)), math.sin(math.radians(72)), h))
            B = Vector((math.cos(math.radians(36)), math.sin(math.radians(36)), -h))
            n = (A - P).cross(C - P)
            return n.dot(B - P)
        lo, hi = 0.0, 1.0
        for _ in range(60):
            mid = (lo + hi) / 2
            if off(lo) * off(mid) <= 0: hi = mid
            else: lo = mid
        h = (lo + hi) / 2
        pts = [(0, 0, H), (0, 0, -H)]
        for k in range(10):
            a = math.radians(36 * k)
            pts.append((math.cos(a), math.sin(a), h if k % 2 == 0 else -h))
        return pts


DIE_COLOR = {4: (0.75, 0.2, 0.25), 6: (0.2, 0.45, 0.8), 8: (0.3, 0.65, 0.35), 10: (0.75, 0.5, 0.15), 12: (0.5, 0.3, 0.75), 20: (0.85, 0.15, 0.2)}


def die(kind, faces_out):
    body_m = mat(f"Die{kind}", DIE_COLOR[kind], 0.35)
    ink = mat("DieInk", (0.97, 0.95, 0.88), 0.5)
    pts = [Vector(p) for p in poly_points(kind)]
    rad = max(p.length for p in pts)
    pts = [p / rad * 0.5 for p in pts]                       # about 1 unit across
    body = hull(f"D{kind}", pts, body_m)
    me = body.data
    parts = [body]
    faces = sorted(me.polygons, key=lambda f: (-round(f.normal.z, 3), round(math.atan2(f.normal.y, f.normal.x), 3)))
    mapping = []
    for i, f in enumerate(faces):
        num = i + 1 if kind != 10 else i                     # d10 shows 0-9
        c = f.center.copy(); n = f.normal.copy()
        cu = bpy.data.curves.new(f"n{num}", "FONT")
        cu.body = str(num) + ("." if num in (6, 9) and kind >= 8 else "")
        cu.align_x = "CENTER"; cu.align_y = "CENTER"
        cu.size = {4: 0.22, 6: 0.42, 8: 0.26, 10: 0.22, 12: 0.2, 20: 0.17}[kind]
        cu.extrude = 0.012
        t = bpy.data.objects.new(f"n{num}", cu)
        bpy.context.scene.collection.objects.link(t)
        up = Vector((0, 0, 1)) if abs(n.z) < 0.95 else Vector((0, 1, 0))
        z = n; x = up.cross(z).normalized(); y = z.cross(x)
        t.matrix_world = Matrix.Translation(c + n * 0.008) @ Matrix((x, y, z)).transposed().to_4x4()
        bpy.context.view_layer.objects.active = t
        bpy.ops.object.select_all(action="DESELECT"); t.select_set(True)
        bpy.ops.object.convert(target="MESH")
        t = bpy.context.view_layer.objects.active
        t.data.materials.clear(); t.data.materials.append(ink)
        parts.append(t)
        # glTF is Y-up: Blender (x, y, z) -> glTF (x, z, -y)
        mapping.append({"value": num, "normal": [round(n.x, 4), round(n.z, 4), round(-n.y, 4)]})
    o = join(parts, f"Dice_D{kind}")
    faces_out[f"d{kind}"] = mapping
    return o


# ---------------------------------------------------------------- run
def run():
    old = bpy.context.window.scene
    scene = bpy.data.scenes.new("game_make")
    bpy.context.window.scene = scene
    made, faces = [], {}
    try:
        builders = [("LampPost", lambda: lamp_post(False)), ("LampPost_Double", lambda: lamp_post(True)),
                    ("SignPost", sign_post), ("Ruin_Arch", ruin_arch),
                    ("Ruin_Column", lambda: join(ruin_column(2.2, True), "Ruin_Column")),
                    ("Gravestone_1", lambda: gravestone(False)), ("Gravestone_Cross", lambda: gravestone(True)),
                    ("Fountain", fountain), ("Bridge_Wood", bridge), ("Campfire_Stones", campfire), ("Portal_Base", portal_base)]
        for k in (4, 6, 8, 10, 12, 20):
            builders.append((f"Dice_D{k}", lambda k=k: die(k, faces)))
        for name, fn in builders:
            o = fn()
            export(o, name)
            made.append(name)
        json.dump(faces, open(os.path.join(OUT, "dice_faces.json"), "w"), indent=1)
        # preview sheet for checking
        objs = list(scene.objects)
        x = 0
        for o in objs:
            o.location.x = x; x += max(o.dimensions.x, 1.2) + 0.6
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam)
        cam.data.type = "ORTHO"; cam.data.ortho_scale = x + 1
        cam.location = (x / 2 - 0.6, -30, 7); cam.rotation_euler = (math.radians(78), 0, 0)
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); scene.collection.objects.link(sun)
        sun.rotation_euler = (0.8, 0.2, 0.6); sun.data.energy = 3
        scene.camera = cam
        scene.world = bpy.data.worlds.new("w"); scene.world.color = (0.6, 0.7, 0.8)
        scene.render.engine = "BLENDER_EEVEE"
        scene.render.resolution_x, scene.render.resolution_y = 2400, 500
        scene.render.filepath = os.path.join(PROJECT, "data", "game", "made_preview.png")
        bpy.ops.render.render(write_still=True)
    finally:
        bpy.context.window.scene = old
        for o in list(scene.objects): bpy.data.objects.remove(o)
        bpy.data.scenes.remove(scene)
    return {"made": made, "dice": {k: len(v) for k, v in faces.items()}}


result = run()
