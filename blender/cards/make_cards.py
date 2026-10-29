"""
Forest level-up cards: 18 Mythic cards (3 per animal hero) and 12 Legendary cards, plus the card back.

The card frame comes from the Quaternius 3D Card Kit in the dnd folder (read only, never changed). Each card is
its own scene in Cards.blend: a colored backdrop with a pattern, the animal hero in a pose from
blender/heroes/<Hero>.blend, forest plants from the Unity project, glowing effects, and the frame in front.
Mythic cards get a violet frame with emerald glyphs, a big emerald gem and vines; Legendary cards get a dark
bronze frame with gold glyphs, an amber gem and golden leaves.

The card list (names, rules text, what each picture shows) is cards.json next to this script; Unity reads the
same file. Run:
    blender -b --python make_cards.py              all cards
    blender -b --python make_cards.py -- m_fox_nine back   only these
Writes renders/<id>.png (500 x 700, see-through corners), renders/back.png, renders/AllCards.png and Cards.blend.
"""
import bpy, bmesh, json, math, os, random, sys
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
KIT = os.path.join(ROOT, 'dnd', '3D Card Kit - Fantasy [Standard]', '3D Card Kit - Fantasy [Standard]', 'glTF')
HEROES = os.path.join(ROOT, 'blender', 'heroes')
UNITY_ART = r'C:\Users\jpant\My project\Assets\Vermeil\Resources\Art'
OUT = os.path.join(HERE, 'renders')
W, H = 500, 700
DIST = 7.0                       # camera distance in front of the card
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
CARDS = json.load(open(os.path.join(HERE, 'cards.json'), encoding='utf-8'))['cards']

RARITY = {
    'mythic': dict(border='#22103a', glyph='#5dffb0', gem='#2bff9a', trim='#3fbf6a', glow=3.0),
    'legendary': dict(border='#3a2508', glyph='#ffcf4a', gem='#ffae2b', trim='#f0b53a', glow=2.2),
}


# ---------------------------------------------------------------- colors + materials
def lin(c):
    c = c / 255 if c > 1 else c
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(s):
    s = s.lstrip('#')
    return tuple(lin(int(s[i:i + 2], 16) / 255) for i in (0, 2, 4))


def mix(a, b, t): return tuple(x + (y - x) * t for x, y in zip(a, b))


def emit(name, rgb, strength=1.0):
    """flat glowing color (unlit, like the kit's card backgrounds)"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (*rgb, 1); e.inputs['Strength'].default_value = strength
    o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0], o.inputs[0])
    m.diffuse_color = (*rgb, 1)
    return m


def gradient(name, low, high):
    """unlit color that runs from `low` at the bottom of the object to `high` at the top"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*low, 1); ramp.color_ramp.elements[1].color = (*high, 1)
    ramp.color_ramp.elements[0].position = 0.1; ramp.color_ramp.elements[1].position = 0.85
    nt.links.new(sep.outputs['Z'], ramp.inputs[0])
    e = nt.nodes.new('ShaderNodeEmission'); nt.links.new(ramp.outputs[0], e.inputs[0])
    o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0], o.inputs[0])
    return m


def matte(name, rgb, rough=0.8, glow=None, glow_strength=2.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    if glow:
        b.inputs['Emission Color'].default_value = (*glow, 1)
        b.inputs['Emission Strength'].default_value = glow_strength
    m.diffuse_color = (*rgb, 1)
    return m


# ---------------------------------------------------------------- building blocks
class Card:
    """one card scene: everything made goes into its collection"""
    def __init__(self, name):
        self.sc = bpy.data.scenes.new(name)
        self.col = bpy.data.collections.new(name)
        self.sc.collection.children.link(self.col)

    def add(self, name, bm_or_me, mat=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
        if isinstance(bm_or_me, bmesh.types.BMesh):
            me = bpy.data.meshes.new(name); bm_or_me.to_mesh(me); bm_or_me.free()
        else:
            me = bm_or_me
        if mat: me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        ob.location, ob.rotation_euler, ob.scale = loc, rot, scale
        self.col.objects.link(ob)
        return ob

    def take(self, objs):
        """move objects that an importer put into the default scene into this card"""
        for o in objs:
            for c in list(o.users_collection): c.objects.unlink(o)
            self.col.objects.link(o)


def disc(r, seg=32):
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=seg, radius=r); return bm


def annulus(r0, r1, seg=48, a0=0.0, a1=math.tau):
    """a flat ring (or a piece of one) in the XY plane"""
    bm = bmesh.new()
    n = seg + 1
    inner, outer = [], []
    for i in range(n):
        a = a0 + (a1 - a0) * i / seg
        inner.append(bm.verts.new((math.cos(a) * r0, math.sin(a) * r0, 0)))
        outer.append(bm.verts.new((math.cos(a) * r1, math.sin(a) * r1, 0)))
    for i in range(seg):
        bm.faces.new((inner[i], outer[i], outer[i + 1], inner[i + 1]))
    return bm


def poly(points):
    bm = bmesh.new(); bm.faces.new([bm.verts.new((x, y, 0)) for x, y in points]); return bm


def ball(r, sub=2):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r); return bm


def cone(r1, r2, d, seg=12):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=d)
    return bm


def leaf_shape(length=0.3, width=0.12):
    return poly([(0, -length / 2), (width / 2, -length * 0.1), (width * 0.35, length * 0.25), (0, length / 2),
                 (-width * 0.35, length * 0.25), (-width / 2, -length * 0.1)])


UPRIGHT = (math.pi / 2, 0, 0)            # flat shapes are made in XY: stand them up to face the camera (-Y)


# ---------------------------------------------------------------- the frame from the kit
FRAME = {}


def load_frame():
    """import the kit's card front (border + corner glyphs) and window mask once; remember their size"""
    base = bpy.data.scenes[0]
    for f in ('0_Card_Front', '0_Card_Mask', '0_Card_Back'):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(KIT, f + '.gltf'))
        for o in set(bpy.data.objects) - before:
            if o.type == 'MESH': FRAME[o.name] = o
            for c in list(o.users_collection): c.objects.unlink(o)
    m = FRAME['Card_Mask']
    xs = [v.co.x for v in m.data.vertices]; zs = [v.co.z for v in m.data.vertices]
    FRAME['window'] = (min(xs), max(xs), min(zs), max(zs))
    b = FRAME['CardBorder']
    xs = [v.co.x for v in b.data.vertices]; zs = [v.co.z for v in b.data.vertices]
    FRAME['outer'] = (min(xs), max(xs), min(zs), max(zs))
    ys = [v.co.y for v in FRAME['Card_back'].data.vertices]
    FRAME['back_y'] = (min(ys), max(ys))
    print('[cards] window', [round(v, 3) for v in FRAME['window']], 'outer', [round(v, 3) for v in FRAME['outer']])


def frame(card, rarity):
    r = RARITY[rarity]
    for key, col, dy in (('CardBorder', r['border'], 0.0), ('Card_Details', r['glyph'], -0.004)):
        src = FRAME[key]
        ob = src.copy(); ob.data = src.data.copy()
        ob.data.materials.clear()
        ob.data.materials.append(emit(f'{card.sc.name}_{key}', hexc(col), 1.0 if key == 'CardBorder' else 1.6))
        ob.location.y += dy
        card.col.objects.link(ob)
    x0, x1, z0, z1 = FRAME['outer']
    # a gem set into the top of the frame
    gem = card.add('gem', ball(0.13, 1), matte('gem', hexc(r['gem']), 0.15, hexc(r['gem']), r['glow']),
                   loc=(0, -0.1, z1 - 0.2), scale=(1, 0.6, 1.25))
    card.add('gem_set', annulus(0.13, 0.18, 24), emit('gem_set', hexc(r['trim'])), loc=(0, -0.06, z1 - 0.2),
             rot=UPRIGHT, scale=(1, 1.25, 1))
    if rarity == 'mythic':
        vines(card, r)
    else:
        laurels(card, r)
    return gem


def vines(card, r):
    """thin vines climb both sides of the frame, with little leaves; a few glowing buds"""
    x0, x1, z0, z1 = FRAME['outer']
    vine = emit('vine', hexc('#2f8f4a'), 1.0); leaf = emit('vine_leaf', hexc('#5ee08a'), 1.1)
    bud = emit('bud', hexc(r['glyph']), 3.0)
    rng = random.Random(7)
    for side in (-1, 1):
        cu = bpy.data.curves.new('vine', 'CURVE'); cu.dimensions = '3D'
        cu.bevel_depth = 0.018; cu.bevel_resolution = 2
        sp = cu.splines.new('BEZIER')
        n = 9
        sp.bezier_points.add(n - 1)
        for i, p in enumerate(sp.bezier_points):
            t = i / (n - 1)
            z = z0 + 0.25 + t * (z1 - z0 - 0.75)
            x = side * (x1 - 0.045 + 0.035 * math.sin(t * 13 + side))
            p.co = (x, -0.03, z)
            p.handle_left_type = p.handle_right_type = 'AUTO'
        cu.materials.append(vine)
        ob = bpy.data.objects.new('vine', cu); card.col.objects.link(ob)
        for i in range(7):
            t = (i + 0.5) / 7
            z = z0 + 0.25 + t * (z1 - z0 - 0.75)
            x = side * (x1 - 0.045 + 0.035 * math.sin(t * 13 + side))
            ang = side * rng.uniform(0.6, 1.1) + (math.pi if i % 2 else 0)
            card.add('leaf', leaf_shape(0.2, 0.09), leaf, loc=(x, -0.05, z), rot=(math.pi / 2, ang, 0))
        for i in range(2):
            z = z0 + 0.6 + i * 1.3
            card.add('bud', ball(0.035, 1), bud, loc=(side * (x1 - 0.05), -0.07, z))


def laurels(card, r):
    """golden leaves fan out from the bottom center of the frame"""
    x0, x1, z0, z1 = FRAME['outer']
    gold = emit('laurel', hexc(r['trim']), 1.2)
    for side in (-1, 1):
        for i in range(4):
            a = side * (0.35 + i * 0.32)
            x = side * (0.12 + i * 0.13); z = z0 + 0.07 + i * 0.035
            card.add('laurel', leaf_shape(0.2, 0.08), gold, loc=(x, -0.05, z), rot=(math.pi / 2, -a, 0))
    card.add('laurel_berry', ball(0.05, 1), matte('berry', hexc(r['gem']), 0.2, hexc(r['gem']), 2.0), loc=(0, -0.08, z0 + 0.06))


# ---------------------------------------------------------------- inside the card: backdrop + pattern
def backdrop(card, art):
    lo, hi = hexc(art['bg'][0]), hexc(art['bg'][1])
    card.add('backdrop', poly([(-3, -3.5), (3, -3.5), (3, 3.5), (-3, 3.5)]), gradient('bg', lo, hi), loc=(0, 2.2, 0), rot=UPRIGHT)
    light = mix(hi, (1, 1, 1), 0.35)
    soft = mix(lo, hi, 0.6)
    m = emit('motif', light, 1.0); m2 = emit('motif2', soft, 1.0)
    glow = hexc(art.get('glow', '#ffffff'))
    rng = random.Random(art['bg'][0])
    y = 2.0
    kind = art.get('motif', 'rays')
    if kind in ('rays', 'pillar'):
        n = 18
        for i in range(0, n, 2):
            a0, a1 = math.tau * i / n, math.tau * (i + 1) / n
            card.add('ray', poly([(0, 0), (math.cos(a0) * 5, math.sin(a0) * 5), (math.cos(a1) * 5, math.sin(a1) * 5)]),
                     m2, loc=(0, y, 0.2), rot=UPRIGHT)
        if kind == 'pillar':
            card.add('pillar', cone(0.55, 0.75, 6, 24), emit('pillar', mix(glow, (1, 1, 1), 0.4), 2.5), loc=(0, 1.2, 1.0))
    elif kind in ('rings', 'ripples', 'target'):
        for i in range(6):
            r0 = 0.35 + i * 0.42
            card.add('ring', annulus(r0, r0 + (0.12 if kind == 'ripples' else 0.2)), m2 if i % 2 else m, loc=(0, y, -0.1), rot=UPRIGHT,
                     scale=(1, 0.55 if kind == 'ripples' else 1, 1))
        if kind == 'target':
            for a in (0, math.pi / 2):
                card.add('cross', poly([(-3, -0.04), (3, -0.04), (3, 0.04), (-3, 0.04)]), m, loc=(0, y - 0.01, 0.1), rot=(math.pi / 2, a, 0))
    elif kind == 'swirl':
        pts_in, pts_out = [], []
        for i in range(160):
            t = i / 159; a = t * math.tau * 3; r = 0.1 + t * 2.4
            w = 0.05 + t * 0.22
            pts_in.append((math.cos(a) * r, math.sin(a) * r)); pts_out.append((math.cos(a) * (r + w), math.sin(a) * (r + w)))
        bm = bmesh.new()
        vi = [bm.verts.new((x, y2, 0)) for x, y2 in pts_in]; vo = [bm.verts.new((x, y2, 0)) for x, y2 in pts_out]
        for i in range(len(vi) - 1): bm.faces.new((vi[i], vo[i], vo[i + 1], vi[i + 1]))
        card.add('swirl', bm, m, loc=(0, y, 0.15), rot=UPRIGHT)
    elif kind in ('slashes', 'fan'):
        for i in range(5):
            a = rng.uniform(-0.6, 0.6)
            card.add('slash', annulus(1.4 + i * 0.25, 1.48 + i * 0.25 + 0.05 * i, 24, 0.3, 2.2), m, loc=(rng.uniform(-0.4, 0.4), y, rng.uniform(-0.5, 0.6)),
                     rot=(math.pi / 2, a, 0))
    elif kind == 'hex':
        for ix in range(-4, 5):
            for iz in range(-6, 7):
                cx = ix * 0.55 + (0.275 if iz % 2 else 0); cz = iz * 0.48
                pts = [(math.cos(a) * 0.25, math.sin(a) * 0.25) for a in [math.pi / 6 + k * math.pi / 3 for k in range(6)]]
                card.add('hex', poly(pts), m if (ix + iz) % 3 else m2, loc=(cx, y, cz), rot=UPRIGHT)
    elif kind == 'moon':
        card.add('moon', disc(0.75, 40), emit('moon', mix(light, (1, 1, 1), 0.6), 1.4), loc=(0.45, y, 1.0), rot=UPRIGHT)
        card.add('moon_bite', disc(0.68, 40), gradient('bite', lo, hi), loc=(0.75, y - 0.01, 1.15), rot=UPRIGHT)
    elif kind == 'thorns':
        for i in range(14):
            side = -1 if i % 2 else 1
            z = -1.6 + i * 0.24
            card.add('thorn', poly([(0, -0.12), (0.9, 0), (0, 0.12)]), m2, loc=(side * 1.25, y - 0.02, z), rot=(math.pi / 2, 0 if side < 0 else math.pi, 0))
    elif kind in ('leaves', 'feathers'):
        for i in range(26):
            card.add('leaf', leaf_shape(0.5, 0.18 if kind == 'leaves' else 0.12), m if i % 3 else m2,
                     loc=(rng.uniform(-1.4, 1.4), y - rng.uniform(0, 1.2), rng.uniform(-1.8, 1.8)), rot=(math.pi / 2, rng.uniform(0, math.tau), 0))
    elif kind == 'rain':
        for i in range(40):
            card.add('drop', poly([(-0.012, -0.25), (0.012, -0.25), (0.012, 0.25), (-0.012, 0.25)]), m,
                     loc=(rng.uniform(-1.5, 1.5), y - rng.uniform(0, 1.4), rng.uniform(-1.8, 1.8)), rot=(math.pi / 2, 0.25, 0))
    elif kind == 'drips':
        for i in range(12):
            x = rng.uniform(-1.2, 1.2); l = rng.uniform(0.4, 1.4)
            card.add('drip', poly([(-0.08, 0), (0.08, 0), (0.05, -l), (-0.05, -l)]), m2, loc=(x, y, 1.9), rot=UPRIGHT)
            card.add('drop', disc(0.1, 12), m2, loc=(x, y, 1.9 - l), rot=UPRIGHT)
    # sparkles float in front of every backdrop
    n = 40 if kind == 'sparks' else 14
    sp = emit('spark', mix(glow, (1, 1, 1), 0.3), 4.0)
    for i in range(n):
        card.add('spark', ball(rng.uniform(0.015, 0.04), 1), sp, loc=(rng.uniform(-1.0, 1.0), rng.uniform(0.0, 1.6), rng.uniform(-1.4, 1.4)))


def mound(card, art):
    """a mossy little hill the subject stands on"""
    lo, hi = hexc(art['bg'][0]), hexc(art['bg'][1])
    bm = ball(1.0, 3)
    for v in bm.verts:
        v.co.z = min(v.co.z, 0.25) * 0.5
    card.add('mound', bm, matte('moss', mix(mix(lo, hexc('#3c8a2e'), 0.6), (0, 0, 0), 0.15), 0.9), loc=(0, 0.9, -1.55), scale=(1.6, 0.9, 1.0))
    grass = matte('grass', mix(hexc('#4fae3a'), hi, 0.2), 0.9)
    rng = random.Random(len(art['bg'][1]))
    for i in range(22):
        a = rng.uniform(-1, 1)
        card.add('blade', poly([(-0.03, 0), (0.03, 0), (0, rng.uniform(0.15, 0.3))]), grass,
                 loc=(a * 1.3, 0.4 + rng.uniform(0, 0.8), -1.47 + (1 - abs(a)) * 0.05), rot=(math.pi / 2, rng.uniform(-0.4, 0.4), 0))


# ---------------------------------------------------------------- what stands in the card
HERO_TURN = dict(Attack=35, Dodge=-30, Idle=12, Walk=25)


def hero(card, art, ghost=None, at=(0, 0.75, -1.38), size=1.32, turn=None):
    name = art['hero']
    path = os.path.join(HEROES, name + '.blend')
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = [name, name + '_Rig']
        dst.actions = ['Attack', 'Dodge', 'Idle', 'Walk']
    mesh, rig = dst.objects
    card.col.objects.link(mesh); card.col.objects.link(rig)
    acts = {a.name.split('.')[0]: a for a in dst.actions}
    act = acts[art.get('pose', 'Idle')]
    # the pose is put straight on the bones (frames don't play in a scene that isn't the active one)
    if rig.animation_data: rig.animation_data.action = None
    rig.pose.apply_pose_from_action(act, evaluation_time=art.get('frame', 1))
    rig.location = at
    rig.scale = (size, size, size)
    rig.rotation_euler.z = math.radians(turn if turn is not None else HERO_TURN.get(art.get('pose', 'Idle'), 0))
    if ghost:
        g = emit('ghost', ghost, 1.6)
        mesh.data = mesh.data.copy()
        for i in range(len(mesh.data.materials)): mesh.data.materials[i] = g
    # a soft halo behind the hero
    glow = hexc(art.get('glow', '#ffffff'))
    if not ghost:
        card.add('halo', disc(0.95, 40), emit('halo', mix(glow, (1, 1, 1), 0.2), 1.0), loc=(at[0], 1.6, at[2] + 1.15), rot=UPRIGHT)
        card.add('halo2', annulus(1.05, 1.15, 48), emit('halo2', glow, 2.0), loc=(at[0], 1.59, at[2] + 1.15), rot=UPRIGHT)
    return rig


def prop(card, name, loc, size, turn=0.0):
    """low-poly forest plants made here (the Unity packs' fbx files keep their colors in Unity-only textures)"""
    x, y, z = loc
    rng = random.Random(name + str(round(x, 2)))
    if name == 'Lilypad':
        bm = annulus(0.0, 1.0, 20, 0.35, math.tau)
        card.add('lilypad', bm, matte('lilypad', hexc('#3f9a3a'), 0.7), loc=(x, y, z + 0.01), scale=(size * 3, size * 1.6, 1))
        card.add('lotus', ball(0.06, 1), matte('lotus', hexc('#ff9ad5'), 0.5, hexc('#ff9ad5'), 0.4), loc=(x + 0.05, y, z + 0.06))
    elif name.startswith('Mushroom'):
        cap_col = '#e0402f' if name == 'Mushroom_Common' else '#f2a33a'
        card.add('stem', cone(0.09 * size, 0.07 * size, 0.5 * size, 10), matte('stem', hexc('#f3e6cf'), 0.8), loc=(x, y, z + 0.25 * size))
        cap = ball(0.3 * size, 2)
        for v in cap.verts: v.co.z = max(v.co.z, -0.05 * size)
        card.add('cap', cap, matte('cap', hexc(cap_col), 0.6), loc=(x, y, z + 0.5 * size), scale=(1, 1, 0.75))
        for i in range(5):
            a = rng.uniform(0, math.tau)
            card.add('dot', ball(0.045 * size, 1), matte('dot', hexc('#fff6e8'), 0.6),
                     loc=(x + math.cos(a) * 0.2 * size, y + math.sin(a) * 0.2 * size - 0.05, z + 0.62 * size))
    elif name.startswith(('Common', 'Dead', 'Twisted', 'Pine')):
        bark = matte('bark', hexc('#5a3b22' if not name.startswith('Dead') else '#4a3a30'), 0.9)
        card.add('trunk', cone(0.16 * size / 2.6, 0.08 * size / 2.6, size * 0.6, 8), bark, loc=(x, y, z + size * 0.3), rot=(0, 0.08 if name.startswith('Twisted') else 0, 0))
        if name.startswith('Dead'):
            for i in range(4):
                card.add('branch', cone(0.05, 0.01, 0.6, 6), bark, loc=(x, y, z + size * (0.35 + i * 0.08)), rot=(0, rng.choice((-1, 1)) * rng.uniform(0.6, 1.1), 0))
        elif name.startswith('Pine'):
            for i in range(3):
                card.add('needles', cone(0.55 - i * 0.13, 0.0, 0.7, 8), matte('pine', hexc('#2f6b3a'), 0.9), loc=(x, y, z + size * (0.45 + i * 0.17)))
        else:
            leaf = matte('canopy', hexc('#3f8f3a' if not name.startswith('Twisted') else '#5a7d3a'), 0.9)
            for i in range(4):
                card.add('canopy', ball(rng.uniform(0.35, 0.5), 1), leaf, loc=(x + rng.uniform(-0.35, 0.35), y + rng.uniform(-0.1, 0.2), z + size * rng.uniform(0.62, 0.85)))
    elif name.startswith('Rock'):
        card.add('rock', ball(size * 0.5, 1), matte('rock', hexc('#8a8a86'), 0.9), loc=(x, y, z + size * 0.2), scale=(1.3, 1, 0.7))
    elif name.startswith('Fern'):
        for i in range(7):
            a = -1.1 + i * 0.37
            card.add('frond', leaf_shape(size * 0.8, size * 0.18), matte('fern', hexc('#4fa83f'), 0.8), loc=(x + math.sin(a) * size * 0.3, y, z + size * 0.3), rot=(math.pi / 2, a, 0))
    elif name.startswith('Flower'):
        for i in range(5):
            fx, fz = x + rng.uniform(-0.4, 0.4) * size, z + rng.uniform(0.35, 0.7) * size
            card.add('fstem', cone(0.012, 0.012, fz - z, 5), matte('fstem', hexc('#3f8a3a'), 0.9), loc=(fx, y, (fz + z) / 2))
            for k in range(5):
                a = k * math.tau / 5
                card.add('petal', ball(0.06 * size, 1), matte('petal', hexc('#dfe6ff'), 0.5, hexc('#c8d4ff'), 0.6), loc=(fx + math.cos(a) * 0.07 * size, y - 0.02, fz + math.sin(a) * 0.07 * size))
            card.add('fheart', ball(0.04 * size, 1), matte('fheart', hexc('#ffd84a'), 0.5), loc=(fx, y - 0.05, fz))
    else:
        print('[cards] no prop', name)


def egg(card, loc, art):
    glow = hexc(art.get('glow', '#ffffff'))
    card.add('egg', ball(0.16, 3), matte('egg', hexc('#e8f4ff'), 0.4), loc=loc, scale=(1, 1, 1.3))
    rng = random.Random(int(loc[0] * 100))
    for i in range(5):
        a = rng.uniform(0, math.tau); z = rng.uniform(-0.12, 0.12)
        card.add('egg_spot', ball(0.03, 1), emit('spot', glow, 3), loc=(loc[0] + math.cos(a) * 0.15, loc[1] - abs(math.sin(a)) * 0.15, loc[2] + z * 1.3))


def icon(card, kind, art):
    """the big thing in the middle of a Legendary card"""
    glow = hexc(art.get('glow', '#ffffff'))
    c = (0, 0.6, -0.2)
    if kind == 'heart':
        red = matte('heart', hexc('#e8344a'), 0.35, hexc('#ff3355'), 0.8)
        for s in (-1, 1): card.add('lobe', ball(0.42, 3), red, loc=(c[0] + s * 0.3, c[1], c[2] + 0.25))
        card.add('tip', cone(0.62, 0.0, 0.9, 24), red, loc=(c[0], c[1], c[2] - 0.25), rot=(math.pi, 0, 0), scale=(1, 0.65, 1))
    elif kind == 'lantern':
        dark = matte('iron', hexc('#2b2b33'), 0.5)
        card.add('flame', ball(0.3, 3), emit('flame', glow, 6.0), loc=c)
        for z in (-0.42, 0.42): card.add('cap', cone(0.42, 0.3, 0.1, 16), dark, loc=(c[0], c[1], c[2] + z))
        for a in range(4):
            ang = a * math.pi / 2 + 0.4
            card.add('bar', cone(0.025, 0.025, 0.85, 6), dark, loc=(c[0] + math.cos(ang) * 0.36, c[1] + math.sin(ang) * 0.36, c[2]))
        card.add('handle', annulus(0.16, 0.2, 24, 0, math.pi), dark, loc=(c[0], c[1], c[2] + 0.47), rot=UPRIGHT)
    elif kind == 'acorn':
        card.add('nut', ball(0.5, 3), matte('nut', hexc('#c9862f'), 0.45), loc=c, scale=(1, 1, 1.25))
        cap = ball(0.55, 3)
        for v in cap.verts: v.co.z = max(v.co.z, 0.05)
        card.add('cap', cap, matte('cap', hexc('#6b4520'), 0.95), loc=(c[0], c[1], c[2] + 0.28), scale=(1.05, 1.05, 0.8))
        card.add('stem', cone(0.06, 0.04, 0.3, 8), matte('stem', hexc('#4a2f14'), 0.9), loc=(c[0], c[1], c[2] + 0.85), rot=(0, 0.3, 0))
    elif kind == 'antlers':
        gold = matte('gold', hexc('#f2c14e'), 0.25, hexc('#ffcc55'), 0.4)
        card.add('band', annulus(0.42, 0.55, 40), gold, loc=(c[0], c[1], c[2] - 0.4), rot=(1.25, 0, 0))
        for s in (-1, 1):
            for i, (dx, dz, ang, l) in enumerate(((0.35, 0.25, 0.5, 0.9), (0.62, 0.62, 1.1, 0.55), (0.48, 0.8, 0.2, 0.5), (0.75, 1.05, 0.7, 0.4))):
                card.add('tine', cone(0.07, 0.025, l, 8), gold, loc=(c[0] + s * dx, c[1], c[2] - 0.4 + dz), rot=(0, s * ang, 0))
        card.add('jewel', ball(0.12, 2), matte('jewel', hexc('#e8344a'), 0.1, hexc('#ff4466'), 1.5), loc=(c[0], c[1] - 0.55, c[2] - 0.35))
    elif kind == 'honey':
        card.add('pot', ball(0.55, 3), matte('pot', hexc('#c47a2c'), 0.6), loc=c, scale=(1, 1, 0.85))
        card.add('rim', annulus(0.3, 0.42, 32), matte('rim', hexc('#8a4f1c'), 0.6), loc=(c[0], c[1], c[2] + 0.45), rot=(1.2, 0, 0))
        card.add('honey', ball(0.32, 2), emit('honey', glow, 1.6), loc=(c[0], c[1], c[2] + 0.42), scale=(1, 1, 0.35))
        for x in (-0.25, 0.1, 0.3):
            card.add('drip', ball(0.08, 2), emit('honey', glow, 1.6), loc=(c[0] + x, c[1] - 0.45, c[2] + 0.2 - abs(x)), scale=(1, 1, 1.6))
    elif kind == 'shield':
        card.add('shield', ball(0.75, 3), matte('barkshield', hexc('#7a4e2a'), 0.95), loc=c, scale=(0.85, 0.25, 1.05))
        card.add('boss', ball(0.18, 2), matte('amber', hexc('#f0a030'), 0.2, hexc('#ffb040'), 1.2), loc=(c[0], c[1] - 0.2, c[2]))
        for i in range(10):
            a = i * math.tau / 10
            card.add('spike', cone(0.08, 0.0, 0.35, 6), matte('thorn', hexc('#d8c08a'), 0.6),
                     loc=(c[0] + math.cos(a) * 0.68, c[1] - 0.05, c[2] + math.sin(a) * 0.86), rot=(0, math.pi / 2 - a, 0))
    elif kind == 'gust':
        gl = emit('gust', mix(glow, (1, 1, 1), 0.2), 1.5)
        for i in range(3):
            card.add('gust', annulus(0.35 + i * 0.25, 0.42 + i * 0.25, 32, 0.4 + i, 4.2 + i), gl, loc=(c[0], c[1], c[2] + 0.1 * i), rot=UPRIGHT)
        rng = random.Random(3)
        for i in range(9):
            a = i * 0.7
            card.add('gleaf', leaf_shape(0.32, 0.13), matte('gleaf', hexc(['#5ec46a', '#e0b040', '#d06a3a'][i % 3]), 0.7),
                     loc=(c[0] + math.cos(a) * (0.4 + i * 0.07), c[1] - 0.1, c[2] + math.sin(a) * (0.4 + i * 0.07)), rot=(math.pi / 2, a, 0))
    elif kind == 'roots':
        root = matte('root', hexc('#6b4a2a'), 0.9)
        for i in range(7):
            a = -0.9 + i * 0.3
            card.add('root', cone(0.09, 0.015, 1.5, 6), root, loc=(c[0] + math.sin(a) * 0.6, c[1], c[2] - 0.3 + math.cos(a) * 0.5), rot=(0, a, 0))
        card.add('rglow', annulus(0.5, 0.58, 32), emit('rglow', glow, 2.5), loc=(c[0], c[1] - 0.05, c[2] + 0.2), rot=UPRIGHT)
    elif kind == 'eyes':
        for s in (-1, 1):
            card.add('eye', disc(0.3, 32), emit('owl_eye', glow, 3.0), loc=(c[0] + s * 0.38, c[1], c[2] + 0.6), rot=UPRIGHT)
            card.add('pupil', disc(0.14, 24), emit('pupil', (0.01, 0.01, 0.02), 1), loc=(c[0] + s * 0.38, c[1] - 0.01, c[2] + 0.6), rot=UPRIGHT)
        card.add('beak', cone(0.1, 0, 0.25, 8), matte('beak', hexc('#e0a040'), 0.5), loc=(c[0], c[1] - 0.05, c[2] + 0.32), rot=(math.pi, 0, 0))


def subject(card, art):
    if art.get('hero'):
        hero(card, art)
        if art.get('twin'):
            hero(card, art, ghost=hexc(art['glow']), at=(0.62, 1.15, -1.2), size=1.0, turn=40)
        for i, p in enumerate(art.get('props', [])):
            side = -1 if i % 2 == 0 else 1
            if p == 'egg':
                egg(card, (side * 0.75 if i < 2 else 0.0, 0.35 if i < 2 else 0.1, -1.25 if i < 2 else -1.38), art)
            elif p == 'Lilypad':
                prop(card, p, (side * (0.7 + 0.2 * (i // 2)), 0.4 + 0.3 * (i // 2), -1.42), 0.12, i)
            else:
                prop(card, p, (side * 1.05, 1.3, -1.45), 2.6, i)
    else:
        props = art.get('props', [])
        if art.get('ring'):
            for i, p in enumerate(props):                       # a fairy ring of mushrooms
                a = math.tau * i / len(props)
                prop(card, p, (math.cos(a) * 0.95, 0.9 + math.sin(a) * 0.45, -1.42), 0.95, a)
            card.add('ring_glow', annulus(0.9, 1.02, 48), emit('fairy', hexc(art['glow']), 3), loc=(0, 0.9, -1.4), scale=(1, 0.5, 1))
        else:
            for i, p in enumerate(props):
                big = p.startswith(('Common', 'Dead', 'Twisted', 'Pine'))
                prop(card, p, (0.85 if big else 0.0, 1.35 if big else 0.6, -1.45), 2.8 if big else (1.3 if not art.get('icon') else 0.7), i)
        if art.get('icon'):
            icon(card, art['icon'], art)
        glow = hexc(art.get('glow', '#ffffff'))
        card.add('halo', disc(1.0, 40), emit('halo', mix(glow, (1, 1, 1), 0.2), 0.9), loc=(0, 1.6, -0.1), rot=UPRIGHT)


# ---------------------------------------------------------------- scene setup + rendering
def setup(card, hi):
    sc = card.sc
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try: sc.render.engine = eng; break
        except TypeError: pass
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
    sc.render.film_transparent = True
    sc.eevee.taa_render_samples = 24
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new(sc.name); sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (*mix(hi, (1, 1, 1), 0.4), 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new(sc.name + '_sun', 'SUN'))
    sun.data.energy = 3.2; sun.data.color = (1.0, 0.95, 0.85)
    sun.rotation_euler = Vector((-0.6, -1.0, 1.1)).to_track_quat('Z', 'Y').to_euler()
    card.col.objects.link(sun)
    rim = bpy.data.objects.new('Rim', bpy.data.lights.new(sc.name + '_rim', 'POINT'))
    rim.data.energy = 120; rim.data.color = mix(hi, (1, 1, 1), 0.5); rim.location = (0.0, 2.0, 0.8)
    card.col.objects.link(rim)
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new(sc.name + '_cam'))
    x0, x1, z0, z1 = FRAME['outer']
    cam.location = ((x0 + x1) / 2, -DIST, (z0 + z1) / 2)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle_y = 2 * math.atan((z1 - z0) / 2 / DIST)
    card.col.objects.link(cam); sc.camera = cam


TMP = os.path.join(OUT, '_frame.png')


def render(sc):
    sc.render.filepath = TMP
    bpy.ops.render.render(write_still=True, scene=sc.name)
    img = bpy.data.images.load(TMP)
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32); img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(H, W, 4)


def save_png(arr, path):
    hgt, w = arr.shape[:2]
    img = bpy.data.images.new('out', w, hgt, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)


OUTSIDE = None


def outside_mask():
    """the rounded corners outside the frame: render the bare frame, then flood in from the edges over
    everything see-through (the window in the middle is walled in by the frame, so it stays inside)"""
    global OUTSIDE
    card = Card('_mask')
    frame(card, 'legendary')
    setup(card, (1, 1, 1))
    a = render(card.sc)[..., 3] > 0.5
    out = np.zeros_like(a)
    out[0, :] = ~a[0, :]; out[-1, :] = ~a[-1, :]; out[:, 0] = ~a[:, 0]; out[:, -1] = ~a[:, -1]
    for _ in range(400):
        grow = out.copy()
        grow[1:] |= out[:-1]; grow[:-1] |= out[1:]; grow[:, 1:] |= out[:, :-1]; grow[:, :-1] |= out[:, 1:]
        grow &= ~a
        if (grow == out).all(): break
        out = grow
    OUTSIDE = out
    bpy.data.scenes.remove(card.sc)
    print('[cards] corner pixels outside the frame:', int(out.sum()))


def make(c):
    art = c['art']
    card = Card(c['id'])
    backdrop(card, art)
    mound(card, art)
    subject(card, art)
    frame(card, c['rarity'])
    setup(card, hexc(art['bg'][1]))
    px = render(card.sc)
    px[OUTSIDE] = 0
    save_png(px, os.path.join(OUT, c['id'] + '.png'))
    print(f"[cards] {c['rarity']:9s} {c['name']}")
    return px


def make_back():
    """the card back: the kit's carved back, its red and gold turned into forest green and gold"""
    card = Card('back')
    src = FRAME['Card_back']
    ob = src.copy(); ob.data = src.data.copy(); card.col.objects.link(ob)
    m = ob.data.materials[0].copy(); ob.data.materials[0] = m
    nt = m.node_tree
    tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE')
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    hue = nt.nodes.new('ShaderNodeHueSaturation')
    hue.inputs['Hue'].default_value = 0.83            # red -> green (gold stays warm enough)
    hue.inputs['Saturation'].default_value = 0.9
    nt.links.new(tex.outputs['Color'], hue.inputs['Color'])
    nt.links.new(hue.outputs['Color'], bsdf.inputs['Base Color'])
    setup(card, hexc('#9be36b'))
    # the back's carved face points at -Y like the front (checked in the first test render)
    px = render(card.sc)
    px[OUTSIDE] = 0
    save_png(px, os.path.join(OUT, 'back.png'))
    print('[cards] back')
    return px


def sheet(images, path, per_row=6, scale=0.5):
    """all cards on one picture (half size)"""
    step = int(1 / scale)
    small = [im[::step, ::step] for im in images]
    h, w = small[0].shape[:2]
    rows = (len(small) + per_row - 1) // per_row
    pad = 10
    out = np.zeros((rows * (h + pad) + pad, per_row * (w + pad) + pad, 4), np.float32)
    out[...] = (0.08, 0.1, 0.07, 1)
    for i, im in enumerate(small):
        r, c = divmod(i, per_row)
        r = rows - 1 - r                                  # image rows go bottom-up: first card at the top
        y, x = pad + r * (h + pad), pad + c * (w + pad)
        a = im[..., 3:4]
        out[y:y + h, x:x + w, :3] = out[y:y + h, x:x + w, :3] * (1 - a) + im[..., :3] * a
    save_png(out, path)


def main():
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    load_frame()
    outside_mask()
    want = [c for c in CARDS if not ARGS or c['id'] in ARGS]
    images = [make(c) for c in want]
    if not ARGS or 'back' in ARGS:
        images.append(make_back())
    if not ARGS:
        sheet(images, os.path.join(OUT, 'AllCards.png'))
    if os.path.exists(TMP): os.remove(TMP)
    first = bpy.data.scenes[0]
    if first.name == 'Scene' and len(bpy.data.scenes) > 1: bpy.data.scenes.remove(first)
    if not ARGS:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'Cards.blend'))
    print(f'[cards] done: {len(images)} pictures')


main()
