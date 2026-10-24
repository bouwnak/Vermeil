import bpy, math
from mathutils import Quaternion, Vector, Matrix
ARM = bpy.data.objects['metarig']
BONES = ARM.data.bones
REST = {b.name: b.matrix_local.to_quaternion() for b in BONES}
ORDER = []
def _walk(b):
    ORDER.append(b.name)
    for c in b.children: _walk(c)
for b in BONES:
    if b.parent is None: _walk(b)
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
def R(axis, deg): return Quaternion(axis, math.radians(deg))
def rest_dir(n): return BONES[n].matrix_local.col[1].to_3d().normalized()
def mirror_axis(v, side):  # mirror an armature-space axis for the right side (x flips)
    return Vector((v.x, -v.y, -v.z)) if side < 0 else v

class Pose:
    """D[name] = armature-space rotation applied to the bone (relative to its rest), inherited by children."""
    def __init__(self): self.D = {}
    def parentD(self, n):
        p = BONES[n].parent
        while p is not None:
            if p.name in self.D: return self.D[p.name]
            p = p.parent
        return Quaternion()
    def get(self, n): return self.D.get(n) or self.parentD(n)
    def rot(self, n, q):            # extra rotation on top of what the parent gives
        self.D[n] = q @ self.parentD(n); return self
    def aim(self, n, d, twist=0):   # point the bone along direction d (armature space)
        P = self.parentD(n); cur = P @ rest_dir(n)
        E = cur.rotation_difference(Vector(d).normalized())
        q = E @ P
        if twist: q = Quaternion(Vector(d).normalized(), math.radians(twist)) @ q
        self.D[n] = q; return self
    def basis(self):
        out = {}
        for n in ORDER:
            D = self.D.get(n)
            if D is None: continue
            Dp = self.parentD(n); Cr = REST[n]
            out[n] = Cr.inverted() @ Dp.inverted() @ D @ Cr
        return out

def apply(pose, loc=None):
    for pb in ARM.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    for n, q in pose.basis().items(): ARM.pose.bones[n].rotation_quaternion = q
    if loc: ARM.pose.bones['spine'].location = loc

def lerpd(a, b, t): return a + (b - a) * t
def sph(*v): return Vector(v).normalized()

FINGERS = ['f_index', 'f_middle', 'f_ring', 'f_pinky']
LIFE = {'u': 0.0, 'cycles': 1}          # set by bake(): where we are in the clip, so fingers can move with it

def curl(p, side, amt, thumb=None, over=None, spread=0.0, wiggle=1.0):
    """Fingers: amt = how curled (deg). Each finger moves a little on its own (wiggle), the pinky rests more curled,
    spread fans them out, over = {"f_index": deg} gives one finger its own curl (pointing, tapping...)."""
    s = 'L' if side > 0 else 'R'
    u, cyc = LIFE['u'], LIFE['cycles']
    if amt < 35: amt = amt * 0.55                    # relaxed hands are open and soft, not gripping
    for i, f in enumerate(FINGERS):
        base = (over or {}).get(f, amt + i * 4)       # index straightest, pinky most curled - like a real hand
        live = wiggle * 4 * math.sin(2 * math.pi * u * cyc + i * 1.1 + (0 if side > 0 else 2.0))
        fan = (i - 1.5) * spread
        for j, k in ((1, 0.7), (2, 1.0), (3, 0.65)):
            n = f"{f}.0{j}.{s}"
            q = local_axis_rot(p, n, (base + live) * k)
            if j == 1 and fan: q = local_axis_rot(p, n, fan, axis=2) @ q
            p.rot(n, q)
    th = amt * 0.5 if thumb is None else thumb
    th += wiggle * 3 * math.sin(2 * math.pi * u * cyc + 4.0)
    for i in (1, 2, 3): p.rot(f"thumb.0{i}.{s}", local_axis_rot(p, f"thumb.0{i}.{s}", th * 0.6))
    return p

def local_axis_rot(p, n, deg, axis=0):
    """rotate around one of the bone's own axes (X = the usual finger-bend axis, Z = fan out), in armature space."""
    P = p.parentD(n)
    ax = (P @ REST[n]) @ Vector([1 if i == axis else 0 for i in range(3)])
    return Quaternion(ax, math.radians(deg))

def arms_relaxed(p, out=0.22, fwd=0.05, bend=0.12):
    for s in (1, -1):
        S = 'L' if s > 0 else 'R'
        p.aim('upper_arm.' + S, (s * out, -fwd, -1))
        p.aim('forearm.' + S, (s * out * 0.6, -fwd - bend, -1))
        p.aim('hand.' + S, (s * out * 0.4, -fwd - bend * 0.8, -1))
        curl(p, s, 18)
    return p

def shot(path, side=False, z=0.86, dist=4.2, w=360, h=560):
    sc = bpy.context.scene; cam = bpy.data.objects['GirlCam']
    sc.render.resolution_percentage = 100; sc.render.resolution_x = w; sc.render.resolution_y = h
    c = Vector((0, 0, z)); cam.location = (dist, 0, z + 0.1) if side else (0, -dist, z + 0.1)
    cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)
