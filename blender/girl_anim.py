# girl_anim.py - procedural animations for the anime girl (run after girl_lib.py)
TAU = 2 * math.pi
def s(x): return math.sin(x)
def c(x): return math.cos(x)
def ease(u): u = max(0.0, min(1.0, u)); return u * u * (3 - 2 * u)
def bump(u, a, b, fade=0.15):           # 0 -> 1 between a..b with soft edges
    return ease((u - a) / fade) * (1 - ease((u - (b - fade)) / fade))

FWD = Vector((0, -1, 0))
HIP = {1: BONES['thigh.L'].head_local.copy(), -1: BONES['thigh.R'].head_local.copy()}
ANK = {1: BONES['shin.L'].tail_local.copy(), -1: BONES['shin.R'].tail_local.copy()}
L1 = (BONES['thigh.L'].tail_local - BONES['thigh.L'].head_local).length
L2 = (BONES['shin.L'].tail_local - BONES['shin.L'].head_local).length

def legs(p, root, feet=None, pitch=None):
    """2-bone IK: hips moved by `root`, feet stay where `feet` says (default: rest spot on the floor)."""
    for sd in (1, -1):
        S = 'L' if sd > 0 else 'R'
        hip = HIP[sd] + root
        ank = (feet or {}).get(sd, ANK[sd])
        d = ank - hip; dist = min(d.length, (L1 + L2) * 0.985); dn = d.normalized()   # knees always a touch bent: no flicker when "straight"
        a = math.acos(max(-1, min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))))
        pole = (FWD - dn * FWD.dot(dn)).normalized()
        tdir = dn * math.cos(a) + pole * math.sin(a)
        knee = hip + tdir * L1
        p.aim('thigh.' + S, tdir)
        p.aim('shin.' + S, (hip + dn * dist) - knee)
        fd = rest_dir('foot.' + S)
        q = R(X, (pitch or {}).get(sd, 0))
        p.aim('foot.' + S, q @ fd)
    return p

def arm(p, sd, up, fore, hand=None, fingers=18, thumb=None, **finger_kw):
    S = 'L' if sd > 0 else 'R'
    p.aim('upper_arm.' + S, up); p.aim('forearm.' + S, fore); p.aim('hand.' + S, hand or fore)
    curl(p, sd, fingers, thumb, **finger_kw)

def relaxed_arm(p, sd, sway=0.0, swing=0.0):
    arm(p, sd, (sd * 0.2 + sway, -0.04 - swing, -1), (sd * 0.13 + sway, -0.16 - swing * 1.4, -1), (sd * 0.09, -0.15 - swing * 1.4, -1))

def spine(p, bend=0, side=0, twist=0, chest=0, neck=(0, 0, 0), head=(0, 0, 0)):
    p.rot('spine.001', R(X, bend * 0.4) @ R(Y, side * 0.5) @ R(Z, twist * 0.5))
    p.rot('spine.002', R(X, bend * 0.3 + chest * 0.5) @ R(Y, side * 0.3) @ R(Z, twist * 0.3))
    p.rot('spine.003', R(X, bend * 0.3 + chest) @ R(Y, side * 0.2) @ R(Z, twist * 0.2))
    p.rot('spine.004', R(X, neck[0]) @ R(Y, neck[1]) @ R(Z, neck[2]))
    p.rot('spine.005', R(Z, head[2]) @ R(X, head[0]) @ R(Y, head[1]))   # head: nod(X, + = down), tilt(Y), turn(Z)

# ---------- the actions: each returns (pose, root offset) for u in 0..1 ----------
def idle(u):
    p = Pose()
    br = s(TAU * u * 2)                       # two breaths per loop
    shift = s(TAU * u) * 0.014                 # weight moves from foot to foot
    root = Vector((shift, 0, -0.008 - 0.004 * (1 + br) * 0.5 - abs(shift) * 0.3))
    spine(p, bend=-0.5, side=-shift * 90, chest=-1.2 * br, head=(2 + 1.5 * s(TAU * u * 2 + 1), 3 * s(TAU * u + 2), 9 * s(TAU * u + 0.6) + 3 * s(TAU * u * 3)))
    for sd in (1, -1): relaxed_arm(p, sd, sway=-shift * 1.5, swing=0.03 * s(TAU * u + sd))
    legs(p, root)
    return p, root

def walk(u):
    p = Pose()
    stride = 0.28; lift = 0.075
    feet, pitch = {}, {}
    for sd, ph in ((1, 0.0), (-1, 0.5)):
        v = (u + ph) % 1.0
        base = ANK[sd].copy()
        if v < 0.5:                                      # stance: foot on the floor, sliding back
            k = v / 0.5; y = lerpd(-stride, stride, k); z = 0
            pt = -8 * ease((k - 0.75) / 0.25)            # heel lifts before toe-off
        else:                                            # swing: foot travels forward in an arc
            k = (v - 0.5) / 0.5; y = lerpd(stride, -stride, ease(k)); z = lift * math.sin(math.pi * k)
            pt = -14 * (1 - k) + 16 * ease((k - 0.6) / 0.4)
        feet[sd] = base + Vector((0, y, z + (0.025 if pt < -4 else 0) * abs(pt) / 14))
        pitch[sd] = pt
    bob = -0.035 - 0.018 * c(TAU * u * 2)
    sway = 0.018 * s(TAU * u)
    root = Vector((sway, 0, bob))
    spine(p, bend=3, side=-sway * 120, twist=7 * s(TAU * u), head=(-1, 0, -5 * s(TAU * u)))
    for sd, ph in ((1, 0.5), (-1, 0.0)):
        sw = 0.42 * s(TAU * (u + ph) - math.pi / 2) * -1
        arm(p, sd, (sd * 0.18, -sw, -1), (sd * 0.12, -sw * 1.5 - 0.25 - max(0, sw) * 0.6, -1), None, 22)
    legs(p, root, feet, pitch)
    return p, root

def wave(u):
    p, root = idle(u * 0.4)
    k = ease(u / 0.18) * (1 - ease((u - 0.82) / 0.18))
    w = s(TAU * 4 * max(0, (u - 0.15)) / 0.7)
    up = Vector((-0.2, -0.04, -1)).lerp(Vector((-0.85, -0.2, 0.45)), k)
    fore = Vector((-0.13, -0.16, -1)).lerp(Vector((-0.3 + 0.35 * w, -0.3, 1)), k)
    arm(p, -1, up, fore, fore, lerpd(18, 2, k), spread=9 * k, wiggle=1 + 2.5 * k)
    spine(p, side=4 * k, head=(-3 * k, -9 * k, 6 * k))
    legs(p, root)
    return p, root

def talk(u):
    p, root = idle(u)
    g1 = bump(u, 0.05, 0.45, 0.12); g2 = bump(u, 0.5, 0.95, 0.12)
    beat = s(TAU * u * 4) * 0.08
    arm(p, -1, (-0.2, -0.25 * g1 - 0.04, -1), Vector((-0.13, -0.16, -1)).lerp(Vector((-0.25, -1, 0.15 + beat)), g1), None, lerpd(18, 6, g1), spread=7 * g1, wiggle=1 + g1)
    arm(p, 1, (0.2, -0.22 * g2 - 0.04, -1), Vector((0.13, -0.16, -1)).lerp(Vector((0.3, -1, 0.05 - beat)), g2), None, lerpd(18, 6, g2), spread=7 * g2, wiggle=1 + g2)
    spine(p, bend=1.5 * (g1 + g2), side=3 * (g2 - g1), head=(3 * s(TAU * u * 4) * (0.5 + g1 + g2) * 0.6, 5 * (g1 - g2), 6 * (g2 - g1)))
    legs(p, root)
    return p, root

def happy(u):
    p = Pose()
    hop = abs(s(TAU * u * 2))
    root = Vector((0.01 * s(TAU * u), 0, -0.045 * (1 - hop) - 0.005))
    spine(p, bend=-2, side=6 * s(TAU * u), head=(-4, 10 * s(TAU * u), 4 * s(TAU * u)))
    for sd in (1, -1):
        arm(p, sd, (sd * 0.35, -0.55, -0.75), (-sd * 0.55, -0.6, 0.55 + 0.1 * hop), (-sd * 0.3, -0.3, 0.9), 50, 30)
    legs(p, root)
    return p, root

def sad(u):
    p = Pose()
    br = s(TAU * u)
    root = Vector((0, 0, -0.012))
    spine(p, bend=5 + 1.5 * br, chest=-2, neck=(3, 0, 0), head=(8 + 2 * br, 5, -6 + 3 * s(TAU * u * 2)))
    for sd in (1, -1):
        arm(p, sd, (sd * 0.05, -0.25, -1), (-sd * 0.35, -0.45, -0.85), (-sd * 0.5, -0.3, -0.8), 30)
    legs(p, root)
    return p, root

def surprised(u):
    p = Pose()
    tr = 0.6 * s(TAU * u * 6)
    root = Vector((0, 0.01, -0.01))
    spine(p, bend=-6, chest=-2, head=(-7, 2 * s(TAU * u), tr))
    for sd in (1, -1):
        arm(p, sd, (sd * 0.3, -0.55, -0.8), (sd * 0.15, -0.7, 0.75), (sd * 0.05, -0.5, 1), 4, 5, spread=12, wiggle=1.5)
    legs(p, root)
    return p, root

def angry(u):
    p = Pose()
    root = Vector((0.012, 0, -0.01))
    spine(p, bend=-2, side=-3, head=(5, -8 + 2 * s(TAU * u * 2), 7))
    for sd in (1, -1):
        arm(p, sd, (sd * 0.75, 0.25, -0.65), (-sd * 0.7, -0.2, -0.6), (-sd * 0.5, 0.1, -0.8), 60, 40)
    tap = max(0, s(TAU * u * 4)) * 22
    legs(p, root, pitch={1: -tap, -1: 0})
    return p, root

def think(u):
    p, root = idle(u * 0.5)
    tap = s(TAU * u * 6) * 0.04
    arm(p, -1, (-0.25, -0.35, -0.9), (0.3, -0.45 + tap, 0.85), (0.2, -0.3, 0.9), 58, 10,
        over={"f_index": 6 + 22 * max(0, s(TAU * u * 6))}, wiggle=0.4)
    arm(p, 1, (0.15, -0.3, -0.95), (-0.9, -0.4, 0.1), None, 30)
    spine(p, bend=1, head=(4 + 2 * s(TAU * u), -12 + 3 * s(TAU * u), 10 * s(TAU * u * 0.5 + 1) * 0.5 + 6))
    legs(p, root)
    return p, root

def sleepy(u):
    p = Pose()
    nod = ease((u % 0.5) / 0.4) * (1 - ease(((u % 0.5) - 0.4) / 0.1))
    root = Vector((0.008 * s(TAU * u), 0, -0.012))
    spine(p, bend=3, side=3 * s(TAU * u), head=(4 + 9 * nod, 8 * s(TAU * u), 4))
    for sd in (1, -1): relaxed_arm(p, sd, sway=0.02 * s(TAU * u))
    legs(p, root)
    return p, root

def dance(u):
    p = Pose()
    beat = TAU * u * 4
    bounce = abs(s(beat / 2))
    sway = 0.04 * s(TAU * u * 2)
    root = Vector((sway, 0, -0.05 * (1 - bounce) - 0.01))
    spine(p, side=-sway * 160, twist=10 * s(TAU * u * 2), head=(-3, 12 * s(TAU * u * 2), 8 * s(TAU * u * 2 + 1)))
    hi = s(TAU * u * 2)
    for sd in (1, -1):
        up = max(0, hi * sd)
        arm(p, sd, Vector((sd * 0.5, -0.2, -0.85)).lerp(Vector((sd * 0.45, -0.1, 0.9)), up),
            Vector((-sd * 0.2, -0.8, 0.55)).lerp(Vector((sd * 0.1, 0, 1)), up), None, 40 * (1 - up) + 6, spread=10 * up, wiggle=1 + 2 * up)
    legs(p, root)
    return p, root

ACTIONS = {"idle": (idle, 180, True), "walk": (walk, 30, True), "wave": (wave, 72, False), "talk": (talk, 96, True),
           "happy": (happy, 60, True), "sad": (sad, 150, True), "surprised": (surprised, 60, True), "angry": (angry, 90, True),
           "think": (think, 150, True), "sleepy": (sleepy, 180, True), "dance": (dance, 64, True)}


# ---------- using the furniture (the app lines her up with the seat; seat top is at z = 0.534 here) ----------
SEAT_HIP = -0.14                                    # hips drop so she rests on a seat 0.5 m high in the room (rig units)
def seat_legs(p, root, fwd=0.40, spread=1.15, swing=(0, 0)):
    feet = {sd: Vector((ANK[sd].x * spread, -fwd + swing[0 if sd > 0 else 1], ANK[sd].z)) for sd in (1, -1)}
    return legs(p, root, feet)

def sit(u):
    p = Pose()
    br = s(TAU * u * 3)
    root = Vector((0, 0.02, SEAT_HIP))
    spine(p, bend=-2, chest=-1.2 * br, head=(3 + 2 * s(TAU * u * 2), 4 * s(TAU * u), 12 * s(TAU * u + 0.5)))
    for sd in (1, -1):
        arm(p, sd, (sd * 0.12, -0.3, -1), (sd * 0.02, -1, -0.22), (sd * 0.0, -1, -0.35), 25)
    kick = 0.05 * s(TAU * u * 3)
    seat_legs(p, root, swing=(kick, -kick))
    return p, root

def type_(u):
    p = Pose()
    root = Vector((0, 0.02, SEAT_HIP))
    spine(p, bend=9, head=(9 + 2 * s(TAU * u * 4), 3 * s(TAU * u), 4 * s(TAU * u * 0.5 + 1)))
    for sd in (1, -1):
        S = 'L' if sd > 0 else 'R'
        arm(p, sd, (sd * 0.25, -0.45, -0.86), (-sd * 0.18, -1, 0.02 + 0.02 * s(TAU * u * 12 + sd)), (-sd * 0.1, -1, -0.12), 0, 0)
        for i, f in enumerate(FINGERS):                 # fingers tapping the keys
            k = max(0, s(TAU * u * 6 + i * 1.7 + (0 if sd > 0 else 2.4)))
            for j in (1, 2, 3):
                n = f"{f}.0{j}.{S}"
                p.rot(n, local_axis_rot(p, n, 10 + 28 * k * (1.0 if j == 1 else 0.6)))
    seat_legs(p, root, fwd=0.36)
    return p, root

def lounge(u):
    p = Pose()
    br = s(TAU * u * 2)
    root = Vector((0, 0.06, SEAT_HIP - 0.04))
    spine(p, bend=-14, chest=-1.5 * br, neck=(4, 0, 0), head=(4, 8 + 3 * s(TAU * u), -10 + 8 * s(TAU * u + 1)))
    rest = 0.03 * br                                                              # hands rise and fall with her breath
    arm(p, 1, (0.16, -0.22, -1), (-0.08, -1, -0.3 + rest), (-0.05, -1, -0.45), 14, 10)      # left hand resting on her thigh
    arm(p, -1, (-0.12, -0.3, -1), (0.38, -1, -0.22 + rest), (0.3, -1, -0.4), 16, 12)       # right hand lightly over it
    bob = 0.04 * max(0, s(TAU * u * 2))
    feet = {1: Vector((ANK[1].x * 1.6, -0.62, ANK[1].z + bob)), -1: Vector((ANK[-1].x * 1.2, -0.58, ANK[-1].z))}
    legs(p, root, feet, {1: -10 - bob * 200, -1: 0})
    return p, root

def lie(u):
    p = Pose()
    br = s(TAU * u * 2)
    spine(p, bend=0, chest=-1.6 * br, head=(-4, 6, 10 + 2 * s(TAU * u)))
    arm(p, 1, (0.18, 0.05, -1), (0.1, 0.0, -1), None, 25)
    arm(p, -1, (-0.2, -0.3, -1), (0.95, -0.22, 0.2), (0.95, -0.1, 0.1), 30)       # hand on her tummy
    for sd in (1, -1):
        S = 'L' if sd > 0 else 'R'
        p.aim('thigh.' + S, (sd * 0.06, -0.12, -1)); p.aim('shin.' + S, (sd * 0.07, 0.12, -1))
    Q = R(X, -90)                                       # lie on her back (head goes behind her, to the bed's pillow)
    p.D = {n: Q @ q for n, q in p.D.items()}; p.D['spine'] = Q
    root = Vector((0, 0.0, 0.0))
    return p, root

def crouch(u):
    p = Pose()
    root = Vector((0, 0.04, -0.4 + 0.01 * s(TAU * u * 2)))
    spine(p, bend=22, head=(14, 10 * s(TAU * u), 8 * s(TAU * u + 1)))
    for sd in (1, -1): arm(p, sd, (sd * 0.2, -0.75, -0.65), (sd * 0.05, -0.55, -0.85), None, 25)
    legs(p, root, {sd: Vector((ANK[sd].x * 1.5, -0.08, ANK[sd].z)) for sd in (1, -1)})
    return p, root

def lookout(u):
    p, root = idle(u)
    for sd in (1, -1): arm(p, sd, (sd * 0.15, 0.4, -0.95), (-sd * 0.65, 0.45, -0.35), (-sd * 0.6, 0.3, -0.5), 30)
    spine(p, bend=-2, head=(-6 + 2 * s(TAU * u * 2), 4 * s(TAU * u), 14 * s(TAU * u + 0.3)))
    legs(p, root)
    return p, root

ACTIONS.update({"sit": (sit, 150, True), "type": (type_, 120, True), "lounge": (lounge, 180, True),
                "lie": (lie, 180, True), "crouch": (crouch, 120, True), "lookout": (lookout, 180, True)})



# ---------- more dances and little actions ----------
def _shoulders(p, lift_l=0.0, lift_r=0.0):
    p.rot('shoulder.L', R(Y, -lift_l)); p.rot('shoulder.R', R(Y, lift_r))

def dance_hiphop(u):                                  # bouncy groove: knees on every beat, alternating punches
    p = Pose()
    beat = TAU * u * 4
    down = 0.5 + 0.5 * c(beat)                        # 1 = deepest bounce
    root = Vector((0.02 * s(TAU * u * 2), 0, -0.02 - 0.06 * down))
    spine(p, bend=6 * down, twist=14 * s(TAU * u * 2), head=(8 * down - 3, 0, -10 * s(TAU * u * 2)))
    for sd, ph in ((1, 0), (-1, math.pi)):
        k = 0.5 + 0.5 * s(TAU * u * 2 + ph)          # 1 = punching forward
        arm(p, sd, Vector((sd * 0.35, -0.2, -0.9)).lerp(Vector((sd * 0.15, -0.9, -0.1)), k),
            Vector((-sd * 0.3, -0.9, 0.3)).lerp(Vector((sd * 0.02, -1, -0.05)), k), None, 70, 40, wiggle=0.3)
    _shoulders(p, 6 * down, 6 * down)
    step = {1: Vector((ANK[1].x * 1.4, 0.03 * s(TAU * u * 2), ANK[1].z)), -1: Vector((ANK[-1].x * 1.4, -0.03 * s(TAU * u * 2), ANK[-1].z))}
    legs(p, root, step)
    return p, root

def dance_idol(u):                                    # cute idol routine: side steps, heart hands, point to the sky
    p = Pose()
    step = s(TAU * u * 2)
    root = Vector((0.06 * step, 0, -0.03 - 0.02 * abs(s(TAU * u * 4))))
    lift = {1: max(0, -step) * 0.06, -1: max(0, step) * 0.06}
    feet = {sd: ANK[sd] + Vector((0.06 * step * 0.6, 0, lift[sd])) for sd in (1, -1)}
    heart = bump(u, 0.0, 0.5, 0.12); point = bump(u, 0.5, 1.0, 0.12)
    spine(p, side=-step * 8, twist=6 * step, head=(-2, -10 * step, 8 * step))
    for sd in (1, -1):
        up = Vector((sd * 0.22, -0.55, -0.8)).lerp(Vector((sd * 0.5, -0.3, 0.55)), point * (1 if sd < 0 else 0))
        fore = Vector((-sd * 0.55, -0.6, 0.55))
        if point and sd < 0: fore = fore.lerp(Vector((-0.3, -0.3, 1)), point)
        arm(p, sd, up, fore, None, lerpd(50, 8, point if sd < 0 else 0) , 20, over={"f_index": 10} if point and sd < 0 else None, spread=4 * heart)
    legs(p, root, feet)
    return p, root

def dance_twirl(u):                                   # flowing: arms sweep out, big body twists, up on the toes
    p = Pose()
    tw = s(TAU * u * 2)
    root = Vector((0, 0, 0.0 - 0.03 * (1 - abs(tw))))
    spine(p, bend=-3, twist=32 * tw, side=6 * s(TAU * u * 4), head=(-6, 8 * tw, 20 * tw))
    for sd in (1, -1):
        k = 0.5 + 0.5 * s(TAU * u * 2 + (0 if sd > 0 else math.pi))
        arm(p, sd, Vector((sd * 1, -0.1, 0.1)).lerp(Vector((sd * 0.4, -0.2, 0.9)), k), Vector((sd * 1, 0.1, 0.25)).lerp(Vector((-sd * 0.2, 0, 1)), k),
            None, 6, 6, spread=10, wiggle=2.5)
    legs(p, root, None, {1: -14, -1: -14})
    return p, root

def dance_sway(u):                                    # slow, dreamy sway with arms up
    p = Pose()
    sw = s(TAU * u)
    root = Vector((0.05 * sw, 0, -0.02 - 0.015 * abs(s(TAU * u * 2))))
    spine(p, side=-sw * 10, twist=5 * sw, head=(-4, -14 * sw, 6 * sw))
    for sd in (1, -1):
        arm(p, sd, (sd * 0.3, 0.05, 0.95), (-sd * 0.35 + 0.1 * sw, 0.05, 1), None, 12, 10, spread=6, wiggle=2)
    legs(p, root)
    return p, root

def cheer(u):                                         # little jump with both fists up
    p = Pose()
    j = s(math.pi * min(1, max(0, (u - 0.25) / 0.45)))   # air time
    crouch = bump(u, 0.05, 0.3, 0.1) + bump(u, 0.68, 0.9, 0.1)
    root = Vector((0, 0, 0.16 * j - 0.1 * crouch))
    up = ease(u / 0.3)
    spine(p, bend=10 * crouch - 6 * j, head=(-10 * up, 0, 0))
    for sd in (1, -1):
        arm(p, sd, Vector((sd * 0.2, -0.04, -1)).lerp(Vector((sd * 0.35, -0.15, 1)), up), Vector((sd * 0.13, -0.16, -1)).lerp(Vector((sd * 0.25, -0.2, 1)), up), None, lerpd(18, 75, up), 50)
    feet = {sd: ANK[sd] + Vector((0, 0, root.z * 0.85 if j > 0 else 0)) for sd in (1, -1)} if j > 0 else None
    legs(p, root, feet, {1: -20 * j, -1: -20 * j})
    return p, root

def jump(u):
    p = Pose()
    j = s(math.pi * min(1, max(0, (u - 0.3) / 0.4)))
    crouch = bump(u, 0.05, 0.35, 0.12) + bump(u, 0.65, 0.95, 0.12)
    root = Vector((0, 0, 0.2 * j - 0.13 * crouch))
    spine(p, bend=14 * crouch - 4 * j, head=(-6 * j, 0, 0))
    for sd in (1, -1):
        sw = crouch * 0.6 - j * 0.9
        arm(p, sd, (sd * 0.25, -sw, -1 + max(0, -sw)), (sd * 0.2, -sw - 0.2, -1 + max(0, -sw)), None, 30)
    feet = {sd: ANK[sd] + Vector((0, 0, root.z * 0.85)) for sd in (1, -1)} if j > 0.05 else None
    legs(p, root, feet, {1: -25 * j, -1: -25 * j})
    return p, root

def stretch(u):                                       # arms up overhead, lean left and right
    p, root = idle(u * 0.3)
    up = bump(u, 0.05, 0.92, 0.18)
    lean = s(TAU * min(1, max(0, (u - 0.25) / 0.55))) * up
    spine(p, bend=-6 * up, side=14 * lean, chest=-4 * up, head=(-12 * up, 6 * lean, 0))
    for sd in (1, -1):
        arm(p, sd, Vector((sd * 0.2, -0.04, -1)).lerp(Vector((sd * 0.18, 0.05, 1)), up), Vector((sd * 0.13, -0.16, -1)).lerp(Vector((-sd * 0.4, 0.05, 1)), up),
            None, lerpd(18, 40, up), 30, spread=-3 * up)
    legs(p, root, None, {1: -18 * up, -1: -18 * up})
    return p, root

def yawn(u):                                          # hand to mouth, head back, eyes closed (face from the app)
    p, root = idle(u * 0.3)
    k = bump(u, 0.08, 0.85, 0.2)
    spine(p, bend=-5 * k, chest=-4 * k, head=(-16 * k, 4 * k, 0))
    arm(p, -1, Vector((-0.2, -0.04, -1)).lerp(Vector((-0.2, -0.45, -0.85)), k), Vector((-0.13, -0.16, -1)).lerp(Vector((0.4, -0.6, 0.75)), k),
        Vector((-0.13, -0.16, -1)).lerp(Vector((0.3, -0.4, 0.9)), k), lerpd(18, 30, k))
    arm(p, 1, Vector((0.2, -0.04, -1)).lerp(Vector((0.4, 0.1, 0.4)), k), Vector((0.13, -0.16, -1)).lerp(Vector((0.4, 0.1, 0.9)), k), None, 40)
    legs(p, root)
    return p, root

def laugh(u):                                         # bending forward, hands on her tummy, shaking
    p = Pose()
    sh = s(TAU * u * 10) * 0.6
    root = Vector((0, 0.01, -0.03))
    spine(p, bend=14 + 3 * sh, chest=2 * sh, head=(6 + 3 * sh, 0, 6 * s(TAU * u)))
    for sd in (1, -1):
        arm(p, sd, (sd * 0.15, -0.35, -0.95), (-sd * 0.6, -0.7, 0.1 + 0.05 * sh), None, 35, 20)
    _shoulders(p, 4 + 4 * sh, 4 + 4 * sh)
    legs(p, root)
    return p, root

def shy(u):                                           # hands behind her back, swaying, toe tapping
    p = Pose()
    sw = s(TAU * u)
    root = Vector((0.015 * sw, 0, -0.01))
    spine(p, bend=3, twist=12 * sw, head=(14, 10, -6 * sw))
    for sd in (1, -1): arm(p, sd, (sd * 0.15, 0.4, -0.95), (-sd * 0.65, 0.45, -0.35), (-sd * 0.6, 0.3, -0.5), 30)
    tap = max(0, s(TAU * u * 3)) * 25
    legs(p, root, {1: ANK[1] + Vector((0.03, -0.08, 0.0))}, {1: tap, -1: 0})
    return p, root

def clap(u):                                          # palms meet flat, fingers up (like a prayer), then open again
    p, root = idle(u * 0.25)
    k = 0.5 + 0.5 * c(TAU * u * 4)                  # 1 = hands apart, 0 = palms together
    k = k ** 1.6                                    # quick snap together, softer opening
    for sd in (1, -1):
        S = 'L' if sd > 0 else 'R'
        p.aim('upper_arm.' + S, Vector((sd * 0.2, -0.45, -0.87)).lerp(Vector((sd * 0.3, -0.5, -0.8)), k))
        p.aim('forearm.' + S, Vector((-sd * 0.5, -0.55, 0.68)).lerp(Vector((sd * 0.05, -0.75, 0.66)), k))
        p.aim('hand.' + S, Vector((-sd * 0.03, -0.12, 1)).lerp(Vector((sd * 0.25, -0.35, 0.9)), k))
        curl(p, sd, 2 + 6 * k, 4, spread=1.5 * k, wiggle=0.3)
    spine(p, bend=3, head=(-4, 6 * s(TAU * u), 0))
    legs(p, root)
    return p, root

def shrug(u):
    p, root = idle(u * 0.3)
    k = bump(u, 0.1, 0.9, 0.25)
    _shoulders(p, 14 * k, 14 * k)
    for sd in (1, -1):
        arm(p, sd, Vector((sd * 0.2, -0.04, -1)).lerp(Vector((sd * 0.3, -0.15, -0.95)), k), Vector((sd * 0.13, -0.16, -1)).lerp(Vector((sd * 0.75, -0.7, 0.15)), k),
            Vector((sd * 0.13, -0.16, -1)).lerp(Vector((sd * 0.9, -0.3, 0.3)), k), lerpd(18, 6, k), 10, spread=6 * k)
    spine(p, head=(-4 * k, 14 * k, 0))
    legs(p, root)
    return p, root

def bow(u):
    p = Pose()
    k = bump(u, 0.1, 0.85, 0.25)
    root = Vector((0, 0.03 * k, -0.01))
    spine(p, bend=38 * k, head=(14 * k, 0, 0))
    for sd in (1, -1): arm(p, sd, (sd * 0.08, -0.25 * k, -1), (-sd * 0.25 * k, -0.35 * k - 0.1, -1), None, 20)
    legs(p, root)
    return p, root

def nod(u):
    p, root = idle(0.1)
    spine(p, head=(14 * s(TAU * u * 2) * (1 - ease((u - 0.7) / 0.3)) + 4, 0, 0))
    legs(p, root)
    return p, root

def shake(u):
    p, root = idle(0.1)
    spine(p, head=(3, 0, 18 * s(TAU * u * 2.5) * (1 - ease((u - 0.7) / 0.3))))
    legs(p, root)
    return p, root

def point(u):                                         # points forward ("look at that!")
    p, root = idle(u * 0.3)
    k = bump(u, 0.08, 0.9, 0.2)
    arm(p, -1, Vector((-0.2, -0.04, -1)).lerp(Vector((-0.25, -1, 0.15)), k), Vector((-0.13, -0.16, -1)).lerp(Vector((-0.2, -1, 0.18)), k), None,
        lerpd(18, 75, k), 40, over={"f_index": lerpd(18, 0, k)})
    spine(p, twist=-8 * k, head=(-3 * k, 0, -6 * k))
    legs(p, root)
    return p, root

def look_around(u):                                   # curious: turns her head and body left and right
    p, root = idle(u)
    turn = s(TAU * u) * 35
    spine(p, twist=turn * 0.3, head=(-2 + 4 * s(TAU * u * 2), 4 * s(TAU * u * 2), turn))
    legs(p, root)
    return p, root

ACTIONS.update({
    "dance_hiphop": (dance_hiphop, 64, True), "dance_idol": (dance_idol, 96, True), "dance_twirl": (dance_twirl, 90, True),
    "dance_sway": (dance_sway, 120, True), "cheer": (cheer, 54, False), "jump": (jump, 40, False), "stretch": (stretch, 120, False),
    "yawn": (yawn, 100, False), "laugh": (laugh, 60, True), "shy": (shy, 120, True), "clap": (clap, 48, True), "shrug": (shrug, 50, False),
    "bow": (bow, 66, False), "nod": (nod, 40, False), "shake": (shake, 44, False), "point": (point, 60, False), "look_around": (look_around, 150, True),
})

# ---------- reading a book: take it from the shelf -> read (turning pages) -> put it back ----------
def _reading_arms(p, k=1.0, turn=0.0):
    """k: 0 = arms relaxed .. 1 = holding an open book in front of the chest. turn: 0..1 right hand sweeps a page over."""
    for sd in (1, -1):
        rel_up, rel_fore = Vector((sd * 0.2, -0.04, -1)), Vector((sd * 0.13, -0.16, -1))
        up = rel_up.lerp(Vector((sd * 0.16, -0.32, -0.95)), k)
        fore = rel_fore.lerp(Vector((-sd * 0.22, -1, 0.42)), k)
        hand = rel_fore.lerp(Vector((-sd * 0.02, -1, 0.2)), k)
        if sd < 0 and turn:
            fore = fore.lerp(Vector((0.55, -1, 0.5)), turn); hand = hand.lerp(Vector((0.7, -0.8, 0.3)), turn)
        arm(p, sd, up, fore, hand, lerpd(18, 30, k), lerpd(9, 4, k), spread=3 * k, wiggle=lerpd(1, 0.4, k))

def book_take(u):
    p, root = idle(u * 0.2)
    reach = bump(u, 0.05, 0.55, 0.2)                     # right arm up to the shelf and back down
    hold = ease((u - 0.5) / 0.4)
    _reading_arms(p, hold)
    if reach > 0.01:
        up = Vector((-0.2, -0.04, -1)).lerp(Vector((-0.15, -0.7, 0.7)), reach)
        fore = Vector((-0.13, -0.16, -1)).lerp(Vector((-0.05, -0.75, 0.65)), reach)
        arm(p, -1, up, fore, fore, 8 + 45 * ease((u - 0.3) / 0.08))     # fingers close on the book at the top
    spine(p, bend=-3 * reach + 8 * hold, head=(-14 * reach + 16 * hold, 0, -5 * reach))
    legs(p, root)
    return p, root

def book_read(u):
    p, root = idle(u * 0.5)
    turn = bump(u, 0.42, 0.62, 0.08)                     # one page turn per loop
    _reading_arms(p, 1.0, turn)
    scan = s(TAU * u * 3) * 4                             # eyes/head follow the lines
    spine(p, bend=8, head=(16 + 1.5 * s(TAU * u * 6), 3 * turn, scan * (1 - turn) - 6 * turn))
    legs(p, root)
    return p, root

def book_put(u):
    p, root = idle(0.2 + u * 0.2)
    hold = 1 - ease(u / 0.35)
    reach = bump(u, 0.3, 0.85, 0.2)
    _reading_arms(p, hold)
    if reach > 0.01:
        up = Vector((-0.2, -0.04, -1)).lerp(Vector((-0.15, -0.7, 0.7)), reach)
        fore = Vector((-0.13, -0.16, -1)).lerp(Vector((-0.05, -0.75, 0.65)), reach)
        arm(p, -1, up, fore, fore, 50 - 42 * ease((u - 0.55) / 0.08))   # lets go at the top
    spine(p, bend=8 * hold - 3 * reach, head=(16 * hold - 14 * reach, 0, -5 * reach))
    legs(p, root)
    return p, root

ACTIONS.update({"book_take": (book_take, 90, False), "book_read": (book_read, 180, True), "book_put": (book_put, 90, False)})

LOOSE = ("hand.", "f_", "thumb.", "foot.", "toe.", "spine.005")    # parts that trail behind a little (follow-through)

MICRO = [("shoulder.L", 0, 1.2, 0.0), ("shoulder.R", 0, 1.2, 1.7), ("hand.L", 0, 3.0, 0.6), ("hand.R", 0, 3.0, 2.3),
         ("hand.L", 2, 2.0, 1.1), ("hand.R", 2, 2.0, 2.9), ("foot.L", 0, 1.5, 0.4), ("foot.R", 0, 1.5, 2.0),
         ("toe.L", 0, 3.0, 1.3), ("toe.R", 0, 3.0, 0.2), ("thumb.01.L", 2, 3.0, 0.9), ("thumb.01.R", 2, 3.0, 2.6),
         ("spine.004", 1, 1.0, 0.7), ("forearm.L", 1, 2.0, 1.9), ("forearm.R", 1, 2.0, 0.5), ("shin.L", 0, 0.8, 2.2), ("shin.R", 0, 0.8, 1.0)]

def micro(b, u, n):
    """Tiny living movement on every joint (wrists, shoulders, ankles, toes, thumbs, neck, elbows, knees): small loop-safe
    sways on top of the main animation, each joint on its own rhythm, so nothing is ever perfectly still."""
    cyc = 1 if n < 60 else 2 if n < 120 else 3
    for bn, ax, deg, ph in MICRO:
        if bn not in REST: continue
        axis = Vector([1 if i == ax else 0 for i in range(3)])
        q = Quaternion(axis, math.radians(deg * math.sin(TAU * u * cyc + ph)))
        b[bn] = (b.get(bn) or Quaternion()) @ q

def polish(data, n, loop, lag=3, drag=0.35):
    """Make every joint smoother: a soft 5-frame average on all bones, then wrists/fingers/ankles/head trail
    slightly behind the rest of the body. Loops wrap around so the first and last frames still match."""
    N = len(next(iter(data.values())))
    idx = (lambda i: i % n) if loop else (lambda i: max(0, min(N - 1, i)))
    W = (1, 2, 3, 2, 1)
    for bn, qs in data.items():
        if bn == '_loc':
            data[bn] = [sum((qs[idx(f + k - 2)] * w for k, w in enumerate(W)), Vector()) / 9 for f in range(N)]
            continue
        sm = []
        for f in range(N):
            ref = qs[idx(f)]; acc = Quaternion((0, 0, 0, 0))
            for k, w in enumerate(W):
                q = qs[idx(f + k - 2)]
                q = -q if ref.dot(q) < 0 else q
                acc = Quaternion([a + w * b for a, b in zip(acc, q)])
            acc.normalize(); sm.append(acc)
        if bn.startswith(LOOSE):
            sm = [sm[idx(f)].slerp(sm[idx(f - lag)], drag) for f in range(N)]
        for f in range(1, N):
            if sm[f - 1].dot(sm[f]) < 0: sm[f] = -sm[f]
        if loop: sm[N - 1] = sm[0].copy()
        data[bn] = sm
    if loop: data['_loc'][N - 1] = data['_loc'][0].copy()

def bake(name):
    fn, n, loop = ACTIONS[name]
    old = bpy.data.actions.get(name)
    if old: bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name); act.use_fake_user = True
    ARM.animation_data_create(); ARM.animation_data.action = act
    frames = list(range(1, n + 2))
    data = {}
    sp_rest = REST['spine'].inverted()
    for f in frames:
        u = (f - 1) / n
        LIFE['u'] = u; LIFE['cycles'] = 2 if n <= 72 else 3
        p, root = fn(u if loop else min(u, 1.0))
        b = p.basis()
        micro(b, u, n)
        for bn in ORDER:
            q = b.get(bn, Quaternion())
            prev = data.get(bn, [None])[-1] if bn in data else None
            if prev is not None and prev.dot(q) < 0: q = -q
            data.setdefault(bn, []).append(q)
        data.setdefault('_loc', []).append(sp_rest @ root)
    polish(data, n, loop)
    for bn in ORDER:
        path = f'pose.bones["{bn}"].rotation_quaternion'
        for i in range(4):
            fc = act.fcurve_ensure_for_datablock(ARM, path, index=i, group_name=bn)
            fc.keyframe_points.add(len(frames))
            co = []
            for f, q in zip(frames, data[bn]): co += [f, q[i]]
            fc.keyframe_points.foreach_set('co', co)
            for k in fc.keyframe_points: k.interpolation = 'LINEAR'
            fc.update()
    for i in range(3):
        fc = act.fcurve_ensure_for_datablock(ARM, 'pose.bones["spine"].location', index=i, group_name='spine')
        fc.keyframe_points.add(len(frames))
        co = []
        for f, v in zip(frames, data['_loc']): co += [f, v[i]]
        fc.keyframe_points.foreach_set('co', co)
        for k in fc.keyframe_points: k.interpolation = 'LINEAR'
        fc.update()
    return act
