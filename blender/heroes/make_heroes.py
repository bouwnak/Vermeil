# Builds the six animal heroes from the concept art (Frog Brawler, Platypus Mage, Armadillo Paladin, Fox Ranger,
# Gecko Rogue, Hawk Swordsman) as chunky chibi animals in a Megabonk-like low-poly 3D look: big heads and eyes,
# short thick legs, big paws, flat facets, real sun and shadows, rendered small so the pixels are big.
# Each hero has an IK rig, face bones (eyes, brows, jaw) and four actions: Idle (fighting stance + blink), Walk,
# Attack and Dodge, with face animation on Attack and Dodge.
#
# Run (about 3 minutes):
#   "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe" -b --python blender\heroes\make_heroes.py
# Only one hero:   ... --python make_heroes.py -- frog
# Only the lineup picture and AllHeroes.blend:   ... -- lineup
#
# The rig: root > hips > spine > chest > neck > head (> jaw, eye.L/R, brow.L/R), arms, legs, tail.
#   foot_ik.L/R, hand_ik.L/R - move these and the knees/elbows bend on their own; turning hand_ik turns the hand
#   (aim a sword, bow or shield). knee_pole / elbow_pole point the knees and elbows. tail_ik drags the tail.
#   Face: scale eye.L/R up and down to squint or widen, turn brow.L/R to look angry, turn jaw to open the mouth.
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Matrix, Vector, Euler, Quaternion

OUT = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def brighten(rgb):
    """lift dark colors so they don't go black in the sunlight"""
    k = 1 + 0.6 * max(0, (120 - max(rgb)) / 120)
    return tuple(min(255, c * k) for c in rgb)


def lin(c):
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

# ---------------------------------------------------------------- shape builder
def basis(d):
    """rotation whose Z axis points along d (X stays as close to world X as possible)"""
    z = d.normalized()
    ref = Vector((1, 0, 0)) if abs(z.x) < 0.9 else Vector((0, 1, 0))
    y = z.cross(ref).normalized()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed().to_4x4()


class Hero:
    POINTS = dict(ell=(0,), ball=(0,), limb=(0, 1), box=(0,))     # which arguments are points (mirrored by both())

    def __init__(self, name, colors):
        self.name, self.colors = name, colors       # name -> (r, g, b); names starting with '*' glow
        self.bm = bmesh.new()
        self.dl = self.bm.verts.layers.deform.verify()
        self.cl = self.bm.loops.layers.color.new('Col')
        self.slots, self.groups = [], []
        self.tail, self.face, self.n = None, {}, 0

    def _take(self, verts, col, bone):
        if col not in self.slots: self.slots.append(col)
        if bone not in self.groups: self.groups.append(bone)
        mi, gi = self.slots.index(col), self.groups.index(bone)
        vc = [lin(c) for c in brighten(self.colors[col.lstrip('*')])]
        for v in verts:
            v[self.dl][gi] = 1.0
        for f in sorted({f for v in verts for f in v.link_faces}, key=lambda f: f.index):
            f.material_index, f.smooth = mi, False
            self.n += 1     # every facet a little lighter or darker: the hand-painted low-poly look
            k = 0.86 + 0.2 * ((self.n * 7919) % 101) / 101
            for l in f.loops: l[self.cl] = (vc[0] * k, vc[1] * k, vc[2] * k, 1.0)

    def ell(self, c, s, col, bone, rot=(0, 0, 0), seg=(8, 6)):
        """ellipsoid: center, radii"""
        M = Matrix.Translation(c) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ Matrix.Diagonal((*map(abs, s), 1))
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=seg[0], v_segments=seg[1], radius=1, matrix=M)
        self._take(r['verts'], col, bone)

    def ball(self, c, r, col, bone):
        self.ell(c, (r, r, r), col, bone)

    def limb(self, p0, p1, r0, r1, col, bone, squash=(1, 1), seg=7):
        """tapered tube from p0 (radius r0) to p1 (radius r1); squash flattens it (x = sideways)"""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        M = Matrix.Translation((p0 + p1) / 2) @ basis(d) @ Matrix.Diagonal((squash[0], squash[1], d.length, 1))
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=r0, radius2=r1, depth=1, matrix=M)
        self._take(r['verts'], col, bone)

    def box(self, c, s, col, bone, rot=(0, 0, 0)):
        M = Matrix.Translation(c) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ Matrix.Diagonal((*s, 1))
        r = bmesh.ops.create_cube(self.bm, size=1, matrix=M)
        self._take(r['verts'], col, bone)

    def both(self, fn, *a, **k):
        """a shape on the hero's left (+x) and mirrored on the right; bone names end in .L"""
        fn(*a, **k)
        pts = self.POINTS[fn.__name__]
        def mir(i, v):
            if i in pts: return (-v[0], v[1], v[2])
            return v.replace('.L', '.R') if isinstance(v, str) else v
        k2 = {key: (v[0], -v[1], -v[2]) if key == 'rot' else mir(-1, v) for key, v in k.items()}
        fn(*[mir(i, v) for i, v in enumerate(a)], **k2)


# skeleton (meters). The hero faces -Y; +X is the hero's left. Chibi: short legs, big head.
HIP, KNEE, ANKLE = (0.1, 0.0, 0.5), (0.11, -0.035, 0.29), (0.11, 0.01, 0.09)
SHOULDER, ELBOW, WRIST, HAND_END = (0.2, 0.0, 0.86), (0.25, 0.04, 0.68), (0.27, 0.0, 0.52), (0.27, -0.01, 0.44)


def body(h, C, fat=1.0, arm_r=0.055, leg_r=0.085, hand_r=0.072, foot=(0.08, 0.12, 0.05), toes=3, claws=None):
    """the shared chunky body; C = dict of part colors"""
    f = fat
    h.ell((0, 0, 0.55), (0.17 * f, 0.14 * f, 0.12), C['pelvis'], 'hips')
    h.ell((0, -0.005, 0.66), (0.17 * f, 0.145 * f, 0.12), C['belly'], 'spine')
    h.ell((0, 0, 0.79), (0.19 * f, 0.14 * f, 0.12), C['chest'], 'chest')
    h.limb((0, 0, 0.86), (0, 0, 0.99), 0.09, 0.09, C['neck'], 'neck')
    h.both(h.limb, HIP, KNEE, leg_r, leg_r * 0.82, C['thigh'], 'thigh.L')
    h.both(h.ball, KNEE, leg_r * 0.8, C['thigh'], 'shin.L')
    h.both(h.limb, KNEE, ANKLE, leg_r * 0.78, leg_r * 0.62, C['shin'], 'shin.L')
    h.both(h.ell, (0.11, -0.04, 0.05), foot, C['foot'], 'foot.L')
    for i in range(toes):
        x = 0.11 + (i - (toes - 1) / 2) * foot[0] * 0.62
        y = -0.04 - foot[1] * 0.82
        h.both(h.ball, (x, y, 0.035), foot[0] * 0.36, C.get('toe', C['foot']), 'foot.L')
        if claws: h.both(h.limb, (x, y - 0.02, 0.035), (x, y - 0.065, 0.012), 0.016, 0.002, claws, 'foot.L', seg=4)
    h.both(h.ball, SHOULDER, arm_r * 1.25, C.get('shoulder', C['arm']), 'upper_arm.L')
    h.both(h.limb, SHOULDER, ELBOW, arm_r, arm_r * 0.9, C['arm'], 'upper_arm.L')
    h.both(h.ball, ELBOW, arm_r * 0.9, C['forearm'], 'forearm.L')
    h.both(h.limb, ELBOW, WRIST, arm_r * 0.9, arm_r * 0.85, C['forearm'], 'forearm.L')
    h.both(h.ell, (0.27, -0.01, 0.47), (hand_r, hand_r * 0.95, hand_r * 1.05), C['hand'], 'hand.L')


def ring(h, z0, z1, r, col, bone, sq=(1, 0.8), y=0.0):
    h.limb((0, y, z0), (0, y, z1), r, r, col, bone, squash=sq, seg=10)


def eyes(h, p, r, iris, pupil='dark', slit=False):
    """big glossy eyes (iris, pupil, white shine) on the eye bones; the bones squint/widen them"""
    x, y, z = p
    h.both(h.ell, p, (r, r * 0.75, r * 1.05), iris, 'eye.L')
    h.both(h.ell, (x, y - r * 0.5, z - r * 0.05), (r * (0.2 if slit else 0.55), r * 0.32, r * (0.8 if slit else 0.62)), pupil, 'eye.L')
    h.both(h.ball, (x + r * 0.25, y - r * 0.72, z + r * 0.36), r * 0.26, 'white', 'eye.L')
    h.face['eye'] = p


def brows(h, p, s, col):
    h.both(h.ell, p, s, col, 'brow.L', rot=(0, -8, 0))
    h.face['brow'] = p


def sword(h, length, width, guard, fuller=None, tilt=40):
    """a sword in the right hand, tipped forward"""
    d = Vector((0, -math.sin(math.radians(tilt)), math.cos(math.radians(tilt))))
    g = Vector((-0.27, -0.04, 0.47))
    rot = (tilt, 0, 0)
    h.limb(tuple(g - d * 0.14), tuple(g), 0.017, 0.017, 'brown', 'hand.R')
    h.ball(tuple(g - d * 0.15), 0.024, 'gold', 'hand.R')
    h.box(tuple(g + d * 0.02), (guard, 0.03, 0.03), 'gold', 'hand.R', rot=rot)
    h.box(tuple(g + d * (length / 2 + 0.035)), (0.016, width, length), 'steel', 'hand.R', rot=rot)
    if fuller:
        h.box(tuple(g + d * (length / 2 + 0.03) + Vector((-0.009, 0, 0))), (0.004, width * 0.3, length * 0.85), fuller, 'hand.R', rot=rot)
    tip = g + d * (length + 0.035)
    h.limb(tuple(tip), tuple(tip + d * 0.08), width / 2, 0.002, 'steel', 'hand.R', squash=(0.24, 1), seg=4)

# ---------------------------------------------------------------- the six heroes
MOUTH = (96, 26, 36)


def frog():
    h = Hero('FrogBrawler', dict(teal=(64, 170, 150), teal_dk=(38, 118, 108), cream=(238, 226, 182), red=(206, 44, 50),
                                 red_dk=(140, 26, 36), navy=(56, 58, 94), tan=(210, 175, 115), brown=(112, 72, 42),
                                 orange=(246, 150, 40), dark=(44, 26, 20), white=(252, 252, 248), mouth=MOUTH))
    body(h, dict(pelvis='navy', belly='teal', chest='teal', neck='teal', thigh='navy', shin='navy', foot='teal',
                 arm='teal', forearm='teal', hand='red'), fat=1.12, leg_r=0.1, hand_r=0.09, foot=(0.1, 0.14, 0.04))
    h.ell((0, -0.08, 0.68), (0.13, 0.08, 0.14), 'cream', 'spine')                      # belly
    h.box((0, -0.15, 0.79), (0.38, 0.025, 0.045), 'brown', 'chest', rot=(0, 35, 0))   # strap
    ring(h, 0.57, 0.62, 0.19, 'red', 'hips')                                           # sash, rope, flap, pouch
    ring(h, 0.62, 0.645, 0.185, 'tan', 'spine')
    h.box((0.03, -0.155, 0.45), (0.11, 0.02, 0.17), 'red', 'hips', rot=(-6, 0, 0))
    h.box((0.03, -0.165, 0.43), (0.04, 0.02, 0.13), 'red_dk', 'hips', rot=(-6, 0, 0))
    h.box((0.18, -0.06, 0.55), (0.07, 0.07, 0.08), 'brown', 'hips')
    h.both(h.limb, (0.11, 0.0, 0.19), (0.11, 0.004, 0.12), 0.064, 0.06, 'tan', 'shin.L')   # rope on the ankles
    h.both(h.limb, (0.262, 0.03, 0.64), (0.27, 0.0, 0.55), 0.06, 0.058, 'tan', 'forearm.L')  # rope on the wraps
    ring(h, 0.85, 0.94, 0.13, 'red', 'neck', sq=(1, 0.9))                              # scarf
    h.limb((0.05, 0.1, 0.9), (0.13, 0.25, 0.72), 0.05, 0.02, 'red', 'chest', squash=(1, 0.3))
    # head: wide, round eyes on the sides, cream chin that drops open
    h.ell((0, -0.02, 1.15), (0.26, 0.22, 0.17), 'teal', 'head')
    h.ell((0, -0.06, 1.03), (0.22, 0.18, 0.07), 'cream', 'jaw')
    h.ell((0, -0.08, 1.07), (0.19, 0.12, 0.03), 'mouth', 'head')
    h.face['jaw'] = ((0, 0.06, 1.07), (0, -0.2, 1.07))
    eyes(h, (0.14, -0.15, 1.17), 0.075, 'orange')
    brows(h, (0.13, -0.155, 1.262), (0.06, 0.02, 0.014), 'teal_dk')
    ring(h, 1.27, 1.32, 0.15, 'red', 'head', sq=(1, 0.85), y=-0.02)                   # headband, knot, tails
    h.ball((0, 0.12, 1.3), 0.04, 'red', 'head')
    h.limb((0.02, 0.13, 1.3), (0.15, 0.33, 1.22), 0.04, 0.015, 'red', 'head', squash=(1, 0.3))
    h.limb((-0.02, 0.13, 1.29), (0.04, 0.3, 1.12), 0.035, 0.012, 'red_dk', 'head', squash=(1, 0.3))
    return h


def platypus():
    h = Hero('PlatypusMage', dict(brown=(146, 98, 62), brown_dk=(98, 64, 40), fur=(184, 134, 90), bill=(84, 78, 80),
                                  bill_dk=(56, 52, 56), blue=(58, 82, 170), navy=(44, 46, 100), lblue=(112, 160, 222),
                                  gold=(226, 180, 70), cyan=(120, 200, 250), wood=(122, 80, 46), leather=(112, 72, 42),
                                  dark=(40, 32, 36), iris=(128, 76, 40), white=(252, 252, 252), mouth=MOUTH))
    body(h, dict(pelvis='blue', belly='blue', chest='blue', neck='brown', thigh='brown', shin='brown', foot='dark',
                 arm='blue', forearm='blue', hand='brown'), hand_r=0.068, foot=(0.085, 0.12, 0.04))
    h.limb((0, 0, 0.8), (0, 0, 0.07), 0.2, 0.29, 'blue', 'hips', seg=8)                 # robe, panel, trims
    h.box((0, -0.25, 0.4), (0.13, 0.02, 0.64), 'lblue', 'hips', rot=(-7, 0, 0))
    ring(h, 0.06, 0.1, 0.295, 'gold', 'hips', sq=(1, 1))
    ring(h, 0.6, 0.64, 0.232, 'leather', 'spine', sq=(1, 1))
    h.box((0, -0.235, 0.62), (0.055, 0.02, 0.055), 'gold', 'spine', rot=(0, 45, 0))
    h.ball((0, -0.25, 0.62), 0.022, '*cyan', 'spine')
    h.box((-0.22, -0.04, 0.5), (0.06, 0.13, 0.12), 'leather', 'hips', rot=(0, 0, 10))   # satchel and book
    h.box((0.22, -0.07, 0.48), (0.05, 0.12, 0.15), 'brown_dk', 'hips')
    ring(h, 0.84, 0.93, 0.17, 'navy', 'neck', sq=(1, 0.9))                              # collar and short cape
    h.limb((0, 0.08, 0.9), (0, 0.15, 0.52), 0.16, 0.21, 'navy', 'chest', squash=(1, 0.3))
    h.both(h.limb, ELBOW, (0.275, 0.0, 0.5), 0.05, 0.1, 'blue', 'forearm.L')            # bell sleeves
    h.both(h.limb, (0.274, 0.0, 0.53), (0.275, 0.0, 0.5), 0.102, 0.102, 'gold', 'forearm.L')
    # head, bill (the lower bill opens), eyes
    h.ball((0, 0, 1.14), 0.2, 'brown', 'head')
    h.both(h.ell, (0.11, -0.1, 1.07), (0.09, 0.08, 0.07), 'fur', 'head')
    h.ell((0, -0.3, 1.1), (0.12, 0.15, 0.035), 'bill', 'head')
    h.ell((0, -0.27, 1.064), (0.105, 0.13, 0.022), 'bill_dk', 'jaw')
    h.ell((0, -0.24, 1.082), (0.09, 0.1, 0.016), 'mouth', 'head')
    h.face['jaw'] = ((0, -0.12, 1.08), (0, -0.4, 1.08))
    eyes(h, (0.09, -0.155, 1.18), 0.052, 'iris')
    brows(h, (0.09, -0.165, 1.245), (0.045, 0.016, 0.012), 'brown_dk')
    # wizard hat: wide brim, bent tip with a dangling gem, gold band
    h.ell((0, 0.02, 1.3), (0.36, 0.34, 0.025), 'navy', 'head')
    h.limb((0, 0.02, 1.3), (0, 0.12, 1.6), 0.19, 0.07, 'blue', 'head')
    h.limb((0, 0.12, 1.6), (0.13, 0.22, 1.56), 0.07, 0.02, 'blue', 'head')
    h.ball((0.14, 0.23, 1.5), 0.015, 'gold', 'head')
    h.ell((0.14, 0.23, 1.45), (0.022, 0.022, 0.038), '*cyan', 'head')
    ring(h, 1.31, 1.36, 0.185, 'gold', 'head', sq=(1, 1), y=0.025)
    h.box((0, -0.16, 1.335), (0.05, 0.02, 0.05), 'gold', 'head', rot=(0, 45, 0))
    h.ball((0, -0.175, 1.335), 0.02, '*cyan', 'head')
    # flat tail
    h.tail = [(0, 0.15, 0.45), (0, 0.31, 0.3), (0, 0.45, 0.2), (0, 0.57, 0.14)]
    for i in range(3):
        h.limb(h.tail[i], h.tail[i + 1], 0.085 - i * 0.008, 0.08 - i * 0.008, 'brown_dk', f'tail.{i + 1:03d}', squash=(1.7, 0.35))
    # staff with a ring and a glowing orb (right hand), floating water orb (left hand)
    h.limb((-0.27, -0.03, 0.02), (-0.27, -0.03, 1.27), 0.022, 0.022, 'wood', 'hand.R')
    ring_pts = [(-0.27 + 0.1 * math.cos(a), -0.03, 1.37 + 0.1 * math.sin(a)) for a in [i * math.tau / 7 - math.pi / 2 for i in range(8)]]
    for a, b in zip(ring_pts, ring_pts[1:]):
        h.limb(a, b, 0.022, 0.022, 'wood', 'hand.R', seg=5)
    h.ball((-0.27, -0.03, 1.37), 0.065, '*cyan', 'hand.R')
    h.ball((0.29, -0.14, 0.58), 0.06, '*cyan', 'hand.L')
    h.ball((0.36, -0.1, 0.64), 0.016, '*lblue', 'hand.L')
    h.ball((0.22, -0.17, 0.67), 0.013, '*lblue', 'hand.L')
    return h


def paladin():
    h = Hero('ArmadilloPaladin', dict(slate=(78, 104, 158), slate_dk=(52, 68, 108), shell=(112, 128, 168),
                                      shell_dk=(76, 88, 124), tan=(214, 170, 130), tan_dk=(170, 120, 90), gold=(226, 180, 62),
                                      red=(176, 36, 46), steel=(196, 204, 218), dark=(34, 34, 50), leather=(110, 70, 44),
                                      ear_in=(206, 132, 120), navy=(48, 52, 86), brown=(110, 70, 44), iris=(40, 46, 72),
                                      white=(252, 252, 252), mouth=MOUTH))
    body(h, dict(pelvis='slate_dk', belly='slate', chest='slate', neck='tan', thigh='slate_dk', shin='slate',
                 foot='leather', arm='slate', forearm='slate', hand='steel'), fat=1.12, leg_r=0.095, hand_r=0.075,
         foot=(0.09, 0.12, 0.05), claws='tan')
    h.both(h.ell, (0.21, 0.0, 0.88), (0.11, 0.11, 0.07), 'slate', 'upper_arm.L')          # pauldrons
    h.both(h.ell, (0.21, 0.0, 0.865), (0.114, 0.114, 0.035), 'gold', 'upper_arm.L')
    h.box((0, -0.162, 0.62), (0.18, 0.02, 0.3), 'red', 'spine')                          # tabard, belt, emblem
    ring(h, 0.6, 0.64, 0.2, 'leather', 'spine', sq=(1, 0.82))
    h.box((0, -0.172, 0.62), (0.05, 0.02, 0.04), 'gold', 'spine')
    h.ball((0.08, -0.15, 0.82), 0.03, 'gold', 'chest')
    h.both(h.ell, (0.11, -0.085, 0.29), (0.06, 0.03, 0.05), 'slate', 'shin.L')            # knee plates
    h.limb((0, 0.13, 0.88), (0, 0.2, 0.28), 0.2, 0.26, 'red', 'chest', squash=(1, 0.15))  # cape, scarf
    ring(h, 0.84, 0.93, 0.14, 'red', 'neck', sq=(1, 0.9))
    # head: tan face and snout (lower snout opens), banded shell helmet, tall ears
    h.ell((0, -0.02, 1.1), (0.18, 0.19, 0.17), 'tan', 'head')
    h.limb((0, -0.14, 1.07), (0, -0.33, 1.05), 0.075, 0.035, 'tan', 'head')
    h.ball((0, -0.34, 1.05), 0.026, 'dark', 'head')
    h.limb((0, -0.12, 1.02), (0, -0.28, 1.02), 0.05, 0.024, 'tan_dk', 'jaw')
    h.limb((0, -0.12, 1.04), (0, -0.27, 1.035), 0.045, 0.02, 'mouth', 'head')
    h.face['jaw'] = ((0, -0.05, 1.04), (0, -0.3, 1.03))
    h.ell((0, 0.05, 1.2), (0.2, 0.21, 0.14), 'shell', 'head')
    for y in (-0.06, 0.0, 0.06, 0.12):
        h.ell((0, y, 1.215), (0.205, 0.018, 0.142), 'shell_dk', 'head')
    h.both(h.limb, (0.1, 0.03, 1.27), (0.16, 0.06, 1.5), 0.07, 0.012, 'tan', 'head', squash=(1, 0.4))
    h.both(h.limb, (0.1, 0.018, 1.28), (0.155, 0.048, 1.47), 0.05, 0.01, 'ear_in', 'head', squash=(1, 0.4))
    eyes(h, (0.1, -0.15, 1.13), 0.055, 'iris')
    brows(h, (0.1, -0.16, 1.2), (0.045, 0.016, 0.012), 'tan_dk')
    # sword (right hand), kite shield (left hand; turn hand_ik.L to face it forward)
    sword(h, 0.42, 0.065, 0.13)
    h.limb((0.335, -0.02, 0.76), (0.335, -0.02, 0.26), 0.185, 0.02, 'gold', 'hand.L', squash=(0.1, 1), seg=8)
    h.limb((0.345, -0.02, 0.745), (0.345, -0.02, 0.28), 0.165, 0.015, 'navy', 'hand.L', squash=(0.1, 1), seg=8)
    h.box((0.365, -0.02, 0.56), (0.012, 0.035, 0.26), 'gold', 'hand.L')
    h.box((0.365, -0.02, 0.6), (0.012, 0.16, 0.035), 'gold', 'hand.L')
    return h


def fox():
    h = Hero('FoxRanger', dict(orange=(232, 122, 42), orange_dk=(180, 86, 30), cream=(246, 236, 216), green=(84, 128, 60),
                               green_dk=(56, 90, 44), brown=(134, 88, 52), brown_dk=(86, 56, 36), dark=(40, 30, 28),
                               ear_dk=(60, 40, 36), iris=(130, 80, 40), red=(196, 50, 48), gold=(230, 186, 70),
                               white=(252, 252, 250), mouth=MOUTH))
    body(h, dict(pelvis='green_dk', belly='green', chest='green', neck='orange', thigh='orange', shin='brown_dk',
                 foot='brown_dk', arm='orange', forearm='brown', hand='orange'), leg_r=0.08, hand_r=0.065,
         foot=(0.075, 0.13, 0.05))
    h.limb((0, 0, 0.62), (0, 0, 0.42), 0.18, 0.22, 'green_dk', 'hips', seg=8)           # tunic, belt, pouches
    ring(h, 0.6, 0.635, 0.188, 'brown', 'spine')
    h.box((0, -0.16, 0.617), (0.04, 0.02, 0.035), 'gold', 'spine')
    h.box((0.15, -0.11, 0.56), (0.06, 0.05, 0.07), 'brown', 'hips')
    h.box((-0.16, -0.09, 0.56), (0.06, 0.05, 0.07), 'brown', 'hips')
    h.ell((0, 0.0, 0.89), (0.23, 0.17, 0.08), 'green', 'chest')                          # capelet and cloak
    h.limb((0, 0.1, 0.92), (0, 0.18, 0.4), 0.2, 0.25, 'green', 'chest', squash=(1, 0.18))
    h.limb((-0.1, 0.17, 0.55), (0.1, 0.2, 0.95), 0.05, 0.05, 'brown', 'chest')            # quiver and arrows
    for dx, col in ((0.07, 'cream'), (0.1, 'red'), (0.13, 'cream')):
        h.ell((dx, 0.2, 1.0), (0.012, 0.025, 0.04), col, 'chest')
    # head: muzzle (lower jaw opens), cheek fluff, huge ears, hood
    h.ball((0, 0, 1.13), 0.19, 'orange', 'head')
    h.both(h.ell, (0.13, -0.06, 1.06), (0.08, 0.08, 0.07), 'cream', 'head')
    h.limb((0, -0.13, 1.08), (0, -0.3, 1.06), 0.075, 0.025, 'cream', 'head')
    h.ball((0, -0.31, 1.065), 0.022, 'dark', 'head')
    h.limb((0, -0.12, 1.03), (0, -0.26, 1.03), 0.05, 0.02, 'cream', 'jaw')
    h.limb((0, -0.12, 1.05), (0, -0.26, 1.045), 0.04, 0.018, 'mouth', 'head')
    h.face['jaw'] = ((0, -0.04, 1.05), (0, -0.28, 1.04))
    eyes(h, (0.085, -0.15, 1.15), 0.05, 'iris')
    brows(h, (0.085, -0.16, 1.215), (0.045, 0.016, 0.012), 'orange_dk')
    h.both(h.limb, (0.09, 0.0, 1.26), (0.19, 0.02, 1.58), 0.09, 0.012, 'orange', 'head', squash=(1, 0.4))
    h.both(h.limb, (0.092, -0.014, 1.28), (0.18, 0.005, 1.53), 0.06, 0.008, 'cream', 'head', squash=(1, 0.4))
    h.both(h.limb, (0.17, 0.015, 1.5), (0.19, 0.02, 1.585), 0.03, 0.005, 'ear_dk', 'head', squash=(1, 0.4))
    h.ell((0, 0.05, 1.12), (0.23, 0.2, 0.22), 'green', 'head')
    # bushy tail with a white tip
    h.tail = [(0, 0.15, 0.5), (0, 0.3, 0.42), (0, 0.45, 0.5), (0, 0.55, 0.66)]
    for i, r in enumerate((0.07, 0.1, 0.09)):
        a, b = Vector(h.tail[i]), Vector(h.tail[i + 1])
        h.ell(tuple((a + b) / 2), (r, (b - a).length * 0.75, r), 'orange', f'tail.{i + 1:03d}',
              rot=(math.degrees(math.atan2(b.z - a.z, b.y - a.y)) - 90, 0, 0))
    h.ball(h.tail[3], 0.075, 'cream', 'tail.003')
    # bow in the left hand (belly forward, string behind)
    pts = [(0.31, -0.03 - 0.14 * (1 - ((z - 0.5) / 0.36) ** 2), z) for z in [0.14 + i * 0.06 for i in range(13)]]
    for a, b in zip(pts, pts[1:]):
        h.limb(a, b, 0.017, 0.017, 'brown', 'hand.L', seg=5)
    h.limb(pts[0], pts[-1], 0.004, 0.004, 'cream', 'hand.L', seg=4)
    h.limb((0.31, -0.17, 0.44), (0.31, -0.17, 0.56), 0.022, 0.022, 'dark', 'hand.L', seg=5)
    return h


def gecko():
    h = Hero('GeckoRogue', dict(purple=(134, 84, 176), purple_dk=(92, 52, 128), lilac=(204, 174, 228), spot=(190, 60, 120),
                                yellow=(246, 212, 60), dark=(60, 44, 72), hood=(68, 52, 86), red=(176, 40, 52),
                                steel=(200, 206, 220), leather=(96, 66, 58), gold=(226, 180, 64), black=(16, 14, 20),
                                white=(252, 252, 252), mouth=MOUTH))
    body(h, dict(pelvis='dark', belly='dark', chest='dark', neck='purple', thigh='dark', shin='dark', foot='purple',
                 arm='dark', forearm='purple', hand='purple'), fat=0.95, leg_r=0.08, hand_r=0.06,
         foot=(0.08, 0.13, 0.04), claws='black')
    h.ell((0, -0.1, 0.68), (0.1, 0.06, 0.12), 'lilac', 'spine')                           # belly, sash, belts
    ring(h, 0.56, 0.6, 0.168, 'red', 'hips')
    h.box((0.05, -0.145, 0.43), (0.09, 0.02, 0.16), 'red', 'hips', rot=(-6, 0, 0))
    ring(h, 0.62, 0.65, 0.162, 'leather', 'spine')
    h.box((0, -0.14, 0.76), (0.34, 0.025, 0.04), 'leather', 'chest', rot=(0, -35, 0))
    h.box((-0.15, -0.08, 0.55), (0.06, 0.05, 0.07), 'leather', 'hips')
    ring(h, 0.84, 0.94, 0.15, 'red', 'neck', sq=(1, 0.9))                                # cowl
    h.ell((0, 0.02, 0.87), (0.21, 0.16, 0.07), 'red', 'chest')
    h.limb((-0.05, 0.12, 0.9), (-0.13, 0.28, 0.7), 0.05, 0.02, 'red', 'chest', squash=(1, 0.3))
    # head: wide and flat, lilac lower jaw opens, huge yellow eyes with slit pupils, spots, pointed hood
    h.ell((0, -0.03, 1.11), (0.22, 0.23, 0.15), 'purple', 'head')
    h.ell((0, -0.08, 1.02), (0.19, 0.17, 0.06), 'lilac', 'jaw')
    h.ell((0, -0.1, 1.05), (0.17, 0.13, 0.025), 'mouth', 'head')
    h.face['jaw'] = ((0, 0.04, 1.05), (0, -0.22, 1.05))
    eyes(h, (0.12, -0.13, 1.17), 0.075, 'yellow', 'black', slit=True)
    brows(h, (0.11, -0.15, 1.252), (0.06, 0.02, 0.014), 'purple_dk')
    for p in ((0.05, -0.16, 1.22), (-0.06, -0.19, 1.18), (0.0, -0.22, 1.13), (0.15, -0.1, 1.1), (-0.16, -0.08, 1.12)):
        h.ell(p, (0.022, 0.022, 0.012), 'spot', 'head')
    h.ell((0, 0.09, 1.16), (0.25, 0.22, 0.21), 'hood', 'head')
    h.limb((0, 0.13, 1.32), (0, 0.24, 1.42), 0.07, 0.01, 'hood', 'head')
    # two daggers pointing forward
    h.both(h.box, (0.27, -0.05, 0.47), (0.03, 0.04, 0.05), 'leather', 'hand.L')
    h.both(h.box, (0.27, -0.08, 0.47), (0.06, 0.012, 0.025), 'gold', 'hand.L')
    h.both(h.limb, (0.27, -0.08, 0.47), (0.27, -0.3, 0.48), 0.026, 0.002, 'steel', 'hand.L', squash=(0.3, 1), seg=4)
    # long tail curling up, with spots
    h.tail = [(0, 0.14, 0.52), (0, 0.3, 0.38), (0, 0.48, 0.3), (0, 0.62, 0.38), (0, 0.66, 0.55)]
    for i in range(4):
        r = 0.065 - i * 0.012
        h.limb(h.tail[i], h.tail[i + 1], r, r - 0.012, 'purple', f'tail.{i + 1:03d}')
        h.ball(h.tail[i + 1], r - 0.012, 'purple', f'tail.{i + 1:03d}')
    h.ell((0, 0.24, 0.46), (0.03, 0.03, 0.02), 'spot', 'tail.001')
    h.ell((0, 0.4, 0.36), (0.025, 0.025, 0.018), 'spot', 'tail.002')
    h.ell((0, 0.57, 0.36), (0.02, 0.02, 0.016), 'spot', 'tail.003')
    return h


def hawk():
    h = Hero('HawkSwordsman', dict(white=(244, 244, 238), cream=(226, 214, 190), navy=(44, 50, 92), navy_lt=(72, 88, 140),
                                   purple=(78, 64, 116), red=(190, 40, 46), grey=(140, 148, 166), grey_dk=(96, 104, 124),
                                   yellow=(242, 190, 52), orange=(240, 120, 30), brown=(122, 80, 50), dark=(30, 28, 40),
                                   steel=(204, 210, 222), gold=(232, 186, 62), mouth=MOUTH))
    body(h, dict(pelvis='grey_dk', belly='grey_dk', chest='grey', neck='white', thigh='grey_dk', shin='brown',
                 foot='yellow', arm='navy', forearm='brown', hand='grey_dk'), fat=1.05, leg_r=0.085, hand_r=0.066,
         foot=(0.075, 0.12, 0.04), claws='dark')
    h.ell((0, -0.1, 0.73), (0.11, 0.06, 0.13), 'cream', 'spine')                          # chest feathers
    h.both(h.ell, (0.21, 0.0, 0.875), (0.1, 0.1, 0.07), 'grey', 'upper_arm.L')            # pauldrons, belt
    ring(h, 0.6, 0.64, 0.19, 'brown', 'spine', sq=(1, 0.82))
    h.box((0, -0.162, 0.62), (0.05, 0.02, 0.04), 'gold', 'spine')
    h.box((0, -0.145, 0.8), (0.36, 0.025, 0.04), 'brown', 'chest', rot=(0, 35, 0))
    ring(h, 0.84, 0.95, 0.16, 'red', 'neck', sq=(1, 0.9))                                 # big red scarf
    h.limb((0.05, 0.12, 0.92), (0.14, 0.3, 0.68), 0.06, 0.025, 'red', 'chest', squash=(1, 0.3))
    h.both(h.limb, (0.25, 0.06, 0.86), (0.28, 0.13, 0.56), 0.09, 0.06, 'navy', 'upper_arm.L', squash=(0.25, 1))   # wings
    h.both(h.limb, (0.28, 0.1, 0.62), (0.3, 0.16, 0.36), 0.07, 0.02, 'navy_lt', 'forearm.L', squash=(0.25, 1))
    h.limb((0, 0.12, 0.55), (0, 0.3, 0.3), 0.08, 0.03, 'navy', 'hips', squash=(1.5, 0.3))   # tail feathers
    h.ell((0, 0.3, 0.3), (0.05, 0.03, 0.03), 'white', 'hips')
    # head: white face, navy cap and spiky crest, eye stripes, hooked beak (lower beak opens)
    h.ball((0, 0, 1.13), 0.19, 'white', 'head')
    h.ell((0, 0.05, 1.2), (0.19, 0.17, 0.13), 'navy', 'head')
    for p0, p1, col in (((0, 0.0, 1.29), (0, 0.08, 1.5), 'navy'), ((0.07, 0.04, 1.27), (0.15, 0.15, 1.44), 'purple'),
                        ((-0.07, 0.04, 1.27), (-0.15, 0.15, 1.44), 'purple'), ((0, 0.1, 1.25), (0, 0.29, 1.36), 'navy'),
                        ((0.03, 0.02, 1.28), (0.06, 0.1, 1.46), 'red'), ((-0.04, 0.07, 1.27), (-0.08, 0.2, 1.42), 'red')):
        h.limb(p0, p1, 0.05, 0.005, col, 'head', seg=5)
    h.both(h.ell, (0.13, -0.05, 1.15), (0.05, 0.1, 0.03), 'navy', 'head')
    h.limb((0, -0.15, 1.12), (0, -0.29, 1.09), 0.06, 0.02, 'yellow', 'head')
    h.limb((0, -0.28, 1.1), (0, -0.31, 1.05), 0.025, 0.004, 'yellow', 'head', seg=5)
    h.limb((0, -0.14, 1.06), (0, -0.25, 1.055), 0.04, 0.012, 'orange', 'jaw')
    h.limb((0, -0.14, 1.08), (0, -0.24, 1.075), 0.035, 0.012, 'mouth', 'head')
    h.face['jaw'] = ((0, -0.08, 1.07), (0, -0.28, 1.06))
    eyes(h, (0.09, -0.15, 1.15), 0.055, 'orange')
    brows(h, (0.09, -0.16, 1.217), (0.05, 0.018, 0.013), 'navy')
    sword(h, 0.6, 0.085, 0.16, fuller='grey')
    return h


HEROES = dict(frog=frog, platypus=platypus, paladin=paladin, fox=fox, gecko=gecko, hawk=hawk)

# ---------------------------------------------------------------- materials and mesh
def lit(name, rgb, glow=False):
    """plain matte material lit by a real sun; color comes from the facet-shaded vertex colors"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    base = Vector([lin(c) for c in brighten(rgb)])
    mat.diffuse_color = (*base, 1)
    bsdf = nt.nodes['Principled BSDF']
    att = nt.nodes.new('ShaderNodeVertexColor'); att.layer_name = 'Col'
    nt.links.new(att.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    bsdf.inputs['Specular IOR Level'].default_value = 0.15
    if glow:
        bsdf.inputs['Emission Color'].default_value = (*base, 1)
        bsdf.inputs['Emission Strength'].default_value = 2.5
    return mat


def build_mesh(h):
    me = bpy.data.meshes.new(h.name)
    h.bm.to_mesh(me)
    nf = len(h.bm.faces)
    h.bm.free()
    for col in h.slots:
        me.materials.append(lit(h.name + '_' + col.lstrip('*'), h.colors[col.lstrip('*')], glow=col.startswith('*')))
    ob = bpy.data.objects.new(h.name, me)
    bpy.context.collection.objects.link(ob)
    for g in h.groups:
        ob.vertex_groups.new(name=g)
    return ob, nf

# ---------------------------------------------------------------- rig
def widget(name, kind):
    if name in bpy.data.objects: return bpy.data.objects[name]
    vs, es = [], []
    if kind in ('ring_xy', 'ring_xz'):
        for i in range(24):
            a = i / 24 * math.tau
            vs.append((math.cos(a), math.sin(a), 0) if kind == 'ring_xy' else (math.cos(a), 0, math.sin(a)))
            es.append((i, (i + 1) % 24))
    else:   # diamond
        vs = [(0.5, 0, 0), (-0.5, 0, 0), (0, 0.5, 0), (0, -0.5, 0), (0, 0, 0.5), (0, 0, -0.5)]
        es = [(a, b) for a in range(2) for b in range(2, 6)] + [(2, 4), (4, 3), (3, 5), (5, 2)]
    me = bpy.data.meshes.new(name); me.from_pydata(vs, es, [])
    ob = bpy.data.objects.new(name, me)
    col = bpy.data.collections.get('WGT') or bpy.data.collections.new('WGT')
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    col.objects.link(ob)
    col.hide_viewport = col.hide_render = True
    return ob


def build_rig(h, mesh):
    arm = bpy.data.armatures.new(h.name + '_Rig')
    rig = bpy.data.objects.new(h.name + '_Rig', arm)
    bpy.context.collection.objects.link(rig)
    rig.show_in_front = True
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones

    def bone(name, head, tail, parent=None, deform=True, connect=False):
        b = eb.new(name); b.head, b.tail = head, tail
        b.use_deform = deform
        if parent: b.parent = eb[parent]; b.use_connect = connect

    def X(p, x): return (p[0] * x, p[1], p[2])
    bone('root', (0, 0, 0), (0, 0.3, 0), deform=False)
    bone('hips', (0, 0, 0.48), (0, 0, 0.6), 'root')
    bone('spine', (0, 0, 0.6), (0, 0, 0.72), 'hips', connect=True)
    bone('chest', (0, 0, 0.72), (0, 0, 0.9), 'spine', connect=True)
    bone('neck', (0, 0, 0.9), (0, 0, 0.99), 'chest', connect=True)
    bone('head', (0, 0, 0.99), (0, 0, 1.45), 'neck', connect=True)
    jp, jt = h.face['jaw']
    bone('jaw', jp, jt, 'head')
    for s, x in (('L', 1), ('R', -1)):
        for part in ('eye', 'brow'):
            p = X(h.face[part], x)
            bone(f'{part}.{s}', p, (p[0], p[1] - 0.05, p[2]), 'head')
        bone(f'thigh.{s}', X(HIP, x), X(KNEE, x), 'hips')
        bone(f'shin.{s}', X(KNEE, x), X(ANKLE, x), f'thigh.{s}', connect=True)
        bone(f'foot.{s}', X(ANKLE, x), (0.11 * x, -0.16, 0.04), f'shin.{s}', connect=True)
        bone(f'foot_ik.{s}', X(ANKLE, x), (0.11 * x, -0.16, 0.09), 'root', deform=False)
        bone(f'knee_pole.{s}', (0.11 * x, -0.6, 0.29), (0.11 * x, -0.66, 0.29), 'root', deform=False)
        bone(f'upper_arm.{s}', X(SHOULDER, x), X(ELBOW, x), 'chest')
        bone(f'forearm.{s}', X(ELBOW, x), X(WRIST, x), f'upper_arm.{s}', connect=True)
        bone(f'hand.{s}', X(WRIST, x), X(HAND_END, x), f'forearm.{s}', connect=True)
        bone(f'hand_ik.{s}', X(WRIST, x), X(HAND_END, x), 'root', deform=False)
        bone(f'elbow_pole.{s}', (0.25 * x, 0.6, 0.68), (0.25 * x, 0.66, 0.68), 'root', deform=False)
    tb = [f'tail.{i + 1:03d}' for i in range(len(h.tail) - 1)] if h.tail else []
    for i, name in enumerate(tb):
        bone(name, h.tail[i], h.tail[i + 1], 'hips' if i == 0 else tb[i - 1], connect=i > 0)
    if tb:
        a, b = Vector(h.tail[-1]), Vector(h.tail[-1]) + (Vector(h.tail[-1]) - Vector(h.tail[-2])).normalized() * 0.08
        bone('tail_ik', a, b, 'hips', deform=False)
    bpy.ops.object.mode_set(mode='OBJECT')

    deform = arm.collections.new('Deform'); ctrl = arm.collections.new('IK Controls'); face = arm.collections.new('Face')
    for b in arm.bones:
        (face if b.name.split('.')[0] in ('eye', 'brow', 'jaw') else deform if b.use_deform else ctrl).assign(b)
        pb = rig.pose.bones[b.name]
        pb.color.palette = 'THEME04' if b.name.endswith('.L') else 'THEME01' if b.name.endswith('.R') else 'THEME09'
    shapes = {'root': ('ring_xy', 1.4), 'tail_ik': ('ring_xy', 1.0)}
    for s in 'LR':
        shapes[f'foot_ik.{s}'] = ('ring_xy', 0.8)
        shapes[f'hand_ik.{s}'] = ('ring_xz', 0.7)
        shapes[f'knee_pole.{s}'] = ('diamond', 1.2)
        shapes[f'elbow_pole.{s}'] = ('diamond', 1.2)
    for n, (kind, sc) in shapes.items():
        if n in rig.pose.bones:
            pb = rig.pose.bones[n]
            pb.custom_shape = widget('WGT_' + kind, kind)
            pb.custom_shape_scale_xyz = (sc, sc, sc)

    iks = []
    for s in 'LR':
        for chain, target, pole, end in ((f'shin.{s}', f'foot_ik.{s}', f'knee_pole.{s}', f'foot.{s}'),
                                         (f'forearm.{s}', f'hand_ik.{s}', f'elbow_pole.{s}', f'hand.{s}')):
            c = rig.pose.bones[chain].constraints.new('IK')
            c.target, c.subtarget = rig, target
            c.pole_target, c.pole_subtarget = rig, pole
            c.chain_count = 2
            iks.append((chain, c))
            r = rig.pose.bones[end].constraints.new('COPY_ROTATION')
            r.target, r.subtarget = rig, target
            if end.startswith('hand'):     # the hand keeps the control's turn: turn hand_ik to aim a weapon
                r.mix_mode = 'REPLACE'; r.target_space = r.owner_space = 'WORLD'
            else:
                r.mix_mode = 'BEFORE'; r.target_space = r.owner_space = 'LOCAL'
    if tb:
        c = rig.pose.bones[tb[-1]].constraints.new('IK')
        c.target, c.subtarget = rig, 'tail_ik'
        c.chain_count = len(tb)
    for chain, c in iks:             # pole angle that keeps the modelled pose exactly
        parent = rig.pose.bones[chain].parent
        rest = parent.bone.tail_local.copy()
        best = None
        for ang in (-90, 90, 0, 180):
            c.pole_angle = math.radians(ang)
            bpy.context.view_layer.update()
            d = (parent.tail - rest).length
            if best is None or d < best[0]: best = (d, ang)
        c.pole_angle = math.radians(best[1])
    bpy.context.view_layer.update()

    mesh.parent = rig
    mod = mesh.modifiers.new('Armature', 'ARMATURE'); mod.object = rig
    return rig

# ---------------------------------------------------------------- poses and animations
CONTROLS = ('hips', 'hand_ik.L', 'hand_ik.R', 'foot_ik.L', 'foot_ik.R', 'tail_ik')
FACE0 = dict(jaw=0.0, eye=1.0, brow=0.0, lift=0.0)        # jaw open (deg), eye height (x), angry brows (deg), brow raise (m)
ANGRY = dict(eye=0.55, brow=24, lift=-0.006)
SHOUT = dict(eye=0.4, brow=30, lift=-0.008, jaw=34)
GRIN = dict(eye=0.6, brow=16, jaw=8)
WIDE = dict(eye=1.3, brow=-14, lift=0.02, jaw=26)
BLINK = dict(eye=0.08)


def mir(p): return (-p[0], p[1], p[2])


REST = {'hand_ik.L': WRIST, 'hand_ik.R': mir(WRIST), 'foot_ik.L': ANKLE, 'foot_ik.R': mir(ANKLE)}
NAMES = dict(hL='hand_ik.L', hR='hand_ik.R', fL='foot_ik.L', fR='foot_ik.R', hips='hips', tail='tail_ik')


def P(face=None, **kw):
    """a pose: hands/feet as world targets (point or (point, turn)), hips/tail as offsets; turns in degrees"""
    out = {}
    for k, v in kw.items():
        n = NAMES[k]
        p, turn = v if len(v) == 2 else (v, (0, 0, 0))
        if n in REST: p = tuple(a - b for a, b in zip(p, REST[n]))
        out[n] = (tuple(p), tuple(turn))
    if face: out['face'] = face
    return out


def stance(**kw):
    s = {n: ((0, 0, 0), (0, 0, 0)) for n in CONTROLS}
    s.update(P(**kw))
    return s


def shift(base, dy=0.0, dz=0.0, dz_feet=0.0, lean=0.0, face=None):
    """the base pose moved back (dy) / up (dz), feet lifted, body leaned back (deg)"""
    out = {}
    for n, (o, r) in base.items():
        z = dz_feet if n.startswith('foot') else dz
        out[n] = ((o[0], o[1] + dy, o[2] + z), (r[0] + (lean if n == 'hips' else 0), r[1], r[2]))
    if face: out['face'] = face
    return out


def posed(keys, base):
    """keys: [(t, pose)] -> fn(t) easing from pose to pose; controls missing from a pose stay in the base stance"""
    def fn(t):
        for (t0, a), (t1, b) in zip(keys, keys[1:]):
            if t <= t1: break
        u = min(1, max(0, (t - t0) / (t1 - t0))); u = u * u * (3 - 2 * u)
        out = {}
        for n in CONTROLS:
            (ao, ar), (bo, br) = a.get(n, base[n]), b.get(n, base[n])
            out[n] = (tuple(x + (y - x) * u for x, y in zip(ao, bo)), tuple(x + (y - x) * u for x, y in zip(ar, br)))
        fa, fb = {**FACE0, **a.get('face', {})}, {**FACE0, **b.get('face', {})}
        out['face'] = {k: fa[k] + (fb[k] - fa[k]) * u for k in FACE0}
        return out
    return fn


FEET = dict(fL=(0.15, -0.09, 0.09), fR=(-0.14, 0.11, 0.09))
STANCES = dict(       # fighting stance: knees bent, left side forward, guard up
    frog=stance(hL=(0.16, -0.24, 0.84), hR=(-0.13, -0.17, 0.8), hips=((0, 0, -0.08), (0, 0, -18)),
                fL=(0.17, -0.1, 0.09), fR=(-0.16, 0.12, 0.09)),
    platypus=stance(hL=(0.25, -0.24, 0.68), hR=(-0.27, -0.12, 0.58), hips=((0, 0, -0.05), (0, 0, -12)), **FEET),
    paladin=stance(hL=((0.2, -0.22, 0.66), (0, 0, -70)), hR=((-0.24, -0.16, 0.58), (10, 0, 0)),
                   hips=((0, 0, -0.07), (0, 0, -15)), **FEET),
    fox=stance(hL=(0.2, -0.22, 0.6), hR=(-0.22, -0.06, 0.6), hips=((0, 0, -0.06), (0, 0, -30)),
               fL=(0.14, -0.1, 0.09), fR=(-0.12, 0.12, 0.09)),
    gecko=stance(hL=(0.24, -0.2, 0.58), hR=(-0.22, -0.14, 0.52), hips=((0, 0, -0.11), (0, 0, -15)),
                 fL=(0.18, -0.1, 0.09), fR=(-0.17, 0.13, 0.09)),
    hawk=stance(hL=(0.2, -0.12, 0.6), hR=((-0.22, -0.2, 0.6), (15, 0, 0)), hips=((0, 0, -0.07), (0, 0, -20)), **FEET),
)


def swing(base, hL, hips_turn=(-25, 15), step=(-0.14, -0.02, 0.09), up=-85, down=(75, 90)):
    """overhead sword chop: wind up beside the head, chop down forward with a step, follow through"""
    return posed([(0, {}),
                  (0.3, P(hR=((-0.3, 0.14, 1.0), (up, 0, 0)), hL=hL[0], hips=((0, 0.02, -0.08), (0, 0, hips_turn[0])), face=ANGRY)),
                  (0.5, P(hR=((-0.12, -0.36, 0.66), (down[0], 0, 0)), hL=hL[1], hips=((0, -0.06, -0.1), (0, 0, hips_turn[1])),
                          fR=step, face=SHOUT)),
                  (0.72, P(hR=((-0.1, -0.3, 0.56), (down[1], 0, 0)), hL=hL[1], hips=((0, -0.06, -0.1), (0, 0, hips_turn[1] - 3)),
                           fR=step, face=GRIN)),
                  (1, {})], base)


def attacks(key):
    b = STANCES[key]
    return dict(
        frog=lambda: posed([(0, {}),        # right straight punch with a step
                            (0.25, P(hR=(-0.17, 0.02, 0.8), hL=(0.15, -0.22, 0.86), hips=((0, 0.03, -0.09), (0, 0, -28)), face=ANGRY)),
                            (0.45, P(hR=(-0.06, -0.4, 0.84), hL=(0.17, -0.15, 0.82), hips=((0, -0.06, -0.09), (0, 0, 18)),
                                     fL=(0.17, -0.2, 0.09), face=SHOUT)),
                            (0.7, P(hR=(-0.08, -0.34, 0.83), hL=(0.17, -0.16, 0.82), hips=((0, -0.05, -0.09), (0, 0, 15)),
                                    fL=(0.17, -0.2, 0.09), face=GRIN)),
                            (1, {})], b),
        platypus=lambda: posed([(0, {}),    # gathers the orb, then throws the spell forward
                                (0.3, P(hL=(0.18, -0.08, 0.82), hR=(-0.27, -0.1, 0.66), hips=((0, 0.02, -0.05), (0, 0, 8)), face=ANGRY)),
                                (0.5, P(hL=(0.14, -0.4, 0.8), hR=(-0.26, -0.18, 0.66), hips=((0, -0.04, -0.06), (0, 0, -20)), face=SHOUT)),
                                (0.75, P(hL=(0.14, -0.38, 0.79), hR=(-0.26, -0.16, 0.64), hips=((0, -0.04, -0.06), (0, 0, -18)), face=GRIN)),
                                (1, {})], b),
        paladin=lambda: swing(b, (((0.2, -0.24, 0.7), (0, 0, -70)), ((0.2, -0.24, 0.66), (0, 0, -70)))),
        fox=lambda: posed([(0, {}),         # raise the bow, draw, let go
                           (0.25, P(hL=(0.12, -0.36, 0.84), hR=(0.05, -0.3, 0.84), hips=((0, 0, -0.06), (0, 0, -38)),
                                    face=dict(eye=0.6, brow=15))),
                           (0.5, P(hL=(0.12, -0.36, 0.84), hR=(-0.1, 0.04, 0.88), hips=((0, 0, -0.06), (0, 0, -38)),
                                   face=dict(eye=0.45, brow=22, lift=-0.006))),
                           (0.62, P(hL=(0.12, -0.38, 0.86), hR=(-0.16, 0.1, 0.92), hips=((0, 0, -0.06), (0, 0, -38)),
                                    face=dict(eye=0.7, brow=10, jaw=12))),
                           (0.8, P(hL=(0.12, -0.36, 0.84), hR=(-0.15, 0.08, 0.88), hips=((0, 0, -0.06), (0, 0, -36)), face=GRIN)),
                           (1, {})], b),
        gecko=lambda: posed([(0, {}),       # quick double dagger stab, right then left
                             (0.2, P(hL=(0.22, 0.0, 0.62), hR=(-0.22, 0.02, 0.62), hips=((0, 0.03, -0.13), (0, 0, 0)), face=ANGRY)),
                             (0.4, P(hR=(-0.08, -0.4, 0.66), hL=(0.22, -0.02, 0.6), hips=((0, -0.06, -0.12), (0, 0, 15)), face=SHOUT)),
                             (0.6, P(hL=(0.08, -0.4, 0.66), hR=(-0.22, 0.0, 0.6), hips=((0, -0.06, -0.12), (0, 0, -15)), face=SHOUT)),
                             (0.8, P(hL=(0.2, -0.2, 0.6), hR=(-0.2, -0.16, 0.56), hips=((0, -0.02, -0.11), (0, 0, -8)), face=GRIN)),
                             (1, {})], b),
        hawk=lambda: swing(b, ((0.18, -0.18, 0.64), (0.2, 0.0, 0.6)), hips_turn=(-30, 22), up=-95, down=(80, 95)),
    )[key]()


def dodge(key):
    """a quick hop backwards with wide eyes and an open mouth, then back into the stance"""
    b = STANCES[key]
    return posed([(0, {}), (0.18, shift(b, dz=-0.07, face=WIDE)),
                  (0.42, shift(b, dy=0.3, dz=0.05, dz_feet=0.12, lean=-14, face=WIDE)),
                  (0.7, shift(b, dy=0.32, dz=-0.08, lean=-5, face=dict(eye=1.1, brow=-6, jaw=6))), (1, {})], b)


def idle(key):
    """the fighting stance, breathing, with one blink"""
    b = STANCES[key]
    return posed([(0, {}), (0.5, shift(b, dz=-0.015)), (0.625, shift(b, dz=-0.015, face=BLINK)),
                  (0.75, shift(b, dz=-0.012)), (1, {})], b)


def walk(key):
    """in-place walk with the guard up"""
    g = STANCES[key]
    def fn(t):
        S = 0.12
        o = {n: g[n] if n.startswith('hand') else ((0, 0, 0), (0, 0, 0)) for n in CONTROLS}
        o['hips'] = ((0, 0, -0.04 - 0.02 * abs(math.cos(t * math.tau))), (0, 0, 0))
        for s, ph in (('L', 0.0), ('R', 0.5)):
            p = (t + ph) % 1
            if p < 0.5:       # foot on the ground, sliding back
                y, z = -S * math.cos(p * math.tau), 0.0
            else:             # foot lifting and swinging forward
                q = (p - 0.5) / 0.5
                y, z = S * math.cos(q * math.pi), 0.06 * math.sin(q * math.pi)
            o[f'foot_ik.{s}'] = ((0, y, z), (0, 0, 0))
            (ho, hr) = o[f'hand_ik.{s}']
            o[f'hand_ik.{s}'] = ((ho[0], ho[1] - y * 0.3, ho[2]), hr)
        o['tail_ik'] = ((0.03 * math.sin(t * math.tau), 0, 0.015 * math.sin(2 * t * math.tau)), (0, 0, 0))
        o['face'] = dict(FACE0)
        return o
    return fn


def key_face(P, face, frame):
    """eyes squash/stretch up and down, brows turn (inner end down = angry) and rise, jaw turns open"""
    for s, sg in (('L', 1), ('R', -1)):
        e = P.get('eye.' + s)
        M = e.bone.matrix_local.to_3x3()
        i = max(range(3), key=lambda k: abs(M.col[k].z))
        sc = [1.0, 1.0, 1.0]; sc[i] = face['eye']
        e.scale = sc
        e.keyframe_insert('scale', frame=frame)
        b = P.get('brow.' + s)
        M = b.bone.matrix_local.to_3x3()
        b.rotation_quaternion = Quaternion(M.inverted() @ Vector((0, 1, 0)), math.radians(-sg * face['brow']))
        b.location = M.inverted() @ Vector((0, 0, face['lift']))
        b.keyframe_insert('rotation_quaternion', frame=frame); b.keyframe_insert('location', frame=frame)
    j = P.get('jaw')
    M = j.bone.matrix_local.to_3x3()
    j.rotation_quaternion = Quaternion(M.inverted() @ Vector((1, 0, 0)), math.radians(face['jaw']))
    j.keyframe_insert('rotation_quaternion', frame=frame)


def key_controls(rig, name, frames, fn):
    """fn(t) -> {control: ((dx, dy, dz), (rx, ry, rz) degrees), 'face': {...}}; turns are in world axes around the
    control. Keys the IK controls and the face bones into an action."""
    P = rig.pose.bones
    rig.animation_data_create()
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data.action = act
    for f in range(frames + 1):
        offs = fn(f / frames)
        key_face(P, offs.pop('face'), f + 1)
        for n, (off, rot) in offs.items():
            if n not in P: continue
            pb = P[n]
            pb.location, pb.rotation_quaternion = (0, 0, 0), (1, 0, 0, 0)
            hd = pb.bone.head_local
            R = Euler([math.radians(a) for a in rot]).to_matrix().to_4x4()
            pb.matrix = Matrix.Translation(Vector(off) + hd) @ R @ Matrix.Translation(-hd) @ pb.bone.matrix_local
            pb.keyframe_insert('location', frame=f + 1)
            pb.keyframe_insert('rotation_quaternion', frame=f + 1)
    return act

# ---------------------------------------------------------------- stage, renders, export
def stage(res=(170, 170), dist=2.9, aim_z=0.7, ground=4.0):
    """perspective camera from the front and a bit above, warm sun with hard shadows, blue sky light, a low-poly
    grass patch; renders small with no smoothing, then the image is enlarged (chunky pixels)"""
    sc = bpy.context.scene
    for eng in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try: sc.render.engine = eng; break
        except TypeError: pass
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.filter_size = 0.0
    sc.eevee.taa_render_samples = 1
    sc.view_settings.view_transform = 'Standard'
    sc.render.fps = 10
    world = bpy.data.worlds.new('World'); sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.38, 0.56, 0.85, 1); bg.inputs['Strength'].default_value = 1.1
    col = bpy.data.collections.new('Stage'); sc.collection.children.link(col)
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 4.0; sun.data.color = (1.0, 0.93, 0.8); sun.data.angle = math.radians(2)
    sun.rotation_euler = Vector((-0.5, -0.7, 1.0)).to_track_quat('Z', 'Y').to_euler()
    col.objects.link(sun)
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=10, radius=ground)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    cl = bm.loops.layers.color.new('Col')
    for i, f in enumerate(bm.faces):
        k = 0.8 + 0.3 * ((i * 7919) % 97) / 97
        for l in f.loops: l[cl] = (0.09 * k, 0.3 * k, 0.05 * k, 1)
    me = bpy.data.meshes.new('Ground'); bm.to_mesh(me); bm.free()
    me.materials.append(lit('Grass', (60, 140, 50)))
    col.objects.link(bpy.data.objects.new('Ground', me))
    aim = bpy.data.objects.new('CameraAim', None); aim.location = (0, 0, aim_z)
    col.objects.link(aim)
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.location = Vector((0.45, -1.0, 0.42)).normalized() * dist + aim.location
    cam.data.lens = 50
    t = cam.constraints.new('TRACK_TO'); t.target = aim
    col.objects.link(cam); sc.camera = cam
    return sc


TMP = os.path.join(OUT, 'previews', '_frame.png')


def grab():
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(TMP)
    w, hgt = img.size
    a = np.empty(w * hgt * 4, np.float32); img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(hgt, w, 4)


def save_png(arr, path, scale=1):
    if scale > 1: arr = arr.repeat(scale, 0).repeat(scale, 1)          # nearest-neighbour: chunky pixels
    hgt, w = arr.shape[:2]
    img = bpy.data.images.new('out', w, hgt, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(arr, np.float32).ravel())
    img.filepath_raw = path; img.file_format = 'PNG'; img.save()
    bpy.data.images.remove(img)


def view(sc, where):
    """camera spots: front (default), side (attacks read better), face (close-up of the head)"""
    cam, aim = sc.camera, bpy.data.objects['CameraAim']
    d, dist, z, res = dict(front=((0.45, -1.0, 0.42), 2.9, 0.7, 170), side=((1.0, -0.45, 0.3), 2.9, 0.7, 170),
                           face=((0.35, -1.0, 0.12), 1.0, 1.08, 110))[where]
    aim.location = (0, 0, z)
    cam.location = Vector(d).normalized() * dist + aim.location
    sc.render.resolution_x = sc.render.resolution_y = res


def make(key):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    h = HEROES[key]()
    mesh, nfaces = build_mesh(h)
    rig = build_rig(h, mesh)
    sc = stage()
    os.makedirs(os.path.join(OUT, 'previews'), exist_ok=True)
    sc.render.filepath = TMP
    acts = {}
    for name, fn in (('Attack', attacks(key)), ('Dodge', dodge(key)), ('Walk', walk(key)), ('Idle', idle(key))):
        acts[name] = key_controls(rig, name, 8, fn)
    sheets = {}
    for name, where in (('Idle', 'front'), ('Walk', 'front'), ('Attack', 'side'), ('Dodge', 'side')):
        view(sc, where)
        rig.animation_data.action = acts[name]
        frames = []
        for f in range(1, 9):
            sc.frame_set(f)
            frames.append(grab())
        sheets[name] = np.concatenate(frames, 1)
        save_png(sheets[name], os.path.join(OUT, 'previews', f'{h.name}_{name.lower()}.png'), scale=2)
    save_png(sheets['Idle'][:, :170], os.path.join(OUT, 'previews', f'{h.name}.png'), scale=4)
    # face close-ups: attack wind-up, strike, follow-through; dodge start, jump, landing
    view(sc, 'face')
    frames = []
    for name, f in (('Idle', 1), ('Idle', 6), ('Attack', 3), ('Attack', 5), ('Attack', 6), ('Dodge', 3), ('Dodge', 4), ('Dodge', 6)):
        rig.animation_data.action = acts[name]
        sc.frame_set(f)
        frames.append(grab())
    save_png(np.concatenate(frames, 1), os.path.join(OUT, 'previews', f'{h.name}_face.png'), scale=3)
    view(sc, 'front')
    # IK check: put the controls somewhere new and see the hands/feet land on them
    rig.animation_data.action = None
    P = rig.pose.bones
    for pb in P:
        pb.location, pb.rotation_quaternion, pb.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)
    for n, off in (('foot_ik.L', (0, -0.1, 0.12)), ('hand_ik.R', (0, -0.15, 0.3)), ('hips', (0, 0, -0.05))):
        P[n].matrix = Matrix.Translation(off) @ P[n].bone.matrix_local
        bpy.context.view_layer.update()
    errs = [(P['shin.' + s].tail - P['foot_ik.' + s].head).length for s in 'LR'] + \
           [(P['forearm.' + s].tail - P['hand_ik.' + s].head).length for s in 'LR']
    for pb in P:
        pb.location, pb.rotation_quaternion = (0, 0, 0), (1, 0, 0, 0)
    rig.animation_data.action = acts['Idle']
    sc.frame_start, sc.frame_end = 1, 8
    sc.frame_set(1)
    # FBX for Unity: skin + face bones, the four clips, vertex colors
    for o in bpy.context.selected_objects: o.select_set(False)
    mesh.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, h.name + '.fbx'), use_selection=True,
                             object_types={'ARMATURE', 'MESH'}, add_leaf_bones=False, use_mesh_modifiers=False,
                             use_armature_deform_only=True, bake_anim=True, bake_anim_use_all_actions=True,
                             bake_anim_use_nla_strips=False, colors_type='SRGB', axis_forward='-Z', axis_up='Y')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, h.name + '.blend'))
    print(f'[hero] {h.name}: {nfaces} faces, {len(rig.data.bones)} bones, IK reach error {max(errs) * 1000:.2f} mm')


def make_all():
    """AllHeroes.blend: the six heroes side by side in their fighting stance, each in its own collection"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    names = [HEROES[k]().name for k in HEROES]
    for i, name in enumerate(names):
        path = os.path.join(OUT, name + '.blend')
        if not os.path.exists(path): continue
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = [n for n in src.objects if n in (name, name + '_Rig')]
        col = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(col)
        for ob in dst.objects:
            col.objects.link(ob)
            if ob.type == 'ARMATURE': ob.location.x = (i - (len(names) - 1) / 2) * 0.95
    sc = stage(res=(320, 150), dist=8.6, aim_z=0.6, ground=8)
    sc.render.filepath = TMP
    sc.frame_start, sc.frame_end = 1, 8
    sc.frame_set(1)
    save_png(grab(), os.path.join(OUT, 'previews', 'AllHeroes_lineup.png'), scale=4)
    os.remove(TMP)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'AllHeroes.blend'))
    print('[hero] AllHeroes.blend saved')


for k in [k for k in (ARGS or list(HEROES)) if k != 'lineup']:
    make(k)
if not ARGS or 'lineup' in ARGS:
    make_all()
print('[hero] done')
