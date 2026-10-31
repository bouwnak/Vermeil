// rigparts.js - understands any rig and makes UniMate's animations look natural on it.
//
// analyzeRig(root)   sorts every bone: BODY (hips, spine, neck, head, arms down to the wrist, legs), HANDS (the fingers
//                    of each hand, and how many: 5, 4, 3, 2, 1 or a paw/stub with none), SOFT (hair, skirt, dress,
//                    cape, tail, ears, ribbons... anything that should swing), FACE and HELPER bones (drivers, twist,
//                    corrective, end bones). Works from the names and the shape of the tree, so "LFeelerA1" (a dress),
//                    "BK_R_elbow_00" (a helper) and "R_ringfinger_A" (a finger) all land in the right place.
// cleanClips(...)    what UniMate made is only kept on BODY bones (it isn't trained for hair, cloth or fingers, which
//                    is where the twitching and the stiff floating skirts came from), the jitter is smoothed away,
//                    the feet are kept on the floor (no more floating), and looping clips end where they start.
// rigExtras(...)     runs every frame after the animation: SOFT bones become springs (hair and cloth swing, hang
//                    with gravity and settle) and the HANDS get real poses for their finger type (relaxed, fist,
//                    open, point) instead of whatever UniMate guessed.
import * as THREE from "three";

const clean = (n) => String(n || "").replace(/^mixamorig:?/i, "").replace(/[_.]?\d+$/, "").toLowerCase();
const HELPER = /drv|driver|twist|helper|corrective|roll\b|^bk[_]|_ex$|^ex_|[_]ex[_]|nub$|end$|^end|_end_|tip$|_top$|target|pole|ik[_]|[_]ik$|offset|socket|attach|weapon|prop/;
const FACE = /brow|eye|lid|lash|lip|teeth|tooth|tongue|cheek|nose|forehead|face|mouth|chin|squint|smile|pupil/;
const JAW = /^jaw|lowerjaw|jaw$/;
const FINGER = /finger|thumb|index|middle|(^|_)ring|pinky|little|digit|claw|^f_|knuckle|handsub/;
const HAND = /hand|wrist|palm|paw/;
// short words only count as whole words ("elbow" is not a bow, "forearm" has no ear)
const SOFT = /hair|skirt|cloth|cape|cloak|dress|feeler|ribbon|tail|(^|[_ ])ears?([_ ]|[lr]?$)|coat|scarf|bust|breast|chain|string|(^|_)tie(_|$)|sleeve|hood|jiggle|phys|dyn|spring|accessor|(^|_)belt|(^|_)bag(_|$)|antenna|tentacle|(^|_)fin(_|$)|frill|(^|_)bow(_|$)|(^|_)lace(_|$)|braid|ponytail|(^|_)bangs?(_|$)|fringe|veil|wing|flap|apron|robe|gown|petal|leaf/;
const SPINE = /hip|pelvis|cog|waist|spine|chest|torso|abdomen|belly|root|neck|head|origin|center|centre|body|upperchest/;
const ARM = /shoulder|collar|clavicle|upperarm|upper_arm|arm|elbow|forearm|lowerarm/;
const LEG = /thigh|upleg|upperleg|leg|knee|shin|calf|lowerleg|ankle|foot|toe|heel/;

/** "L" / "R" / "": L_arm, LThigh, upper_armL (three.js drops the dot of upper_arm.L), LeftHand, hand_l */
function side(name) {
  const n = String(name || "");
  for (const [s, w] of [["L", "left"], ["R", "right"]]) {
    if (new RegExp(`(^|[^a-zA-Z])${s}([^a-zA-Z]|$)`, "i").test(n) || new RegExp(`^${s}(?=[A-Z])`).test(n) ||
        new RegExp(`[a-z]${s}$`).test(n) || new RegExp(w, "i").test(n)) return s;
  }
  return "";
}

/** Sort the bones of a loaded glTF scene. */
export function analyzeRig(root) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  const kind = new Map();
  const has = (b, re) => re.test(clean(b.name));
  for (const b of bones) {
    const n = clean(b.name);
    let k = "other";
    if (HELPER.test(n)) k = "helper";
    else if (JAW.test(n)) k = "jaw";
    else if (FACE.test(n)) k = "face";
    else if (SOFT.test(n)) k = "soft";
    else if (FINGER.test(n)) k = "finger";
    else if (HAND.test(n)) k = "hand";
    else if (ARM.test(n)) k = "arm";
    else if (LEG.test(n)) k = "leg";
    else if (SPINE.test(n)) k = "spine";
    kind.set(b, k);
  }
  // bones under a hand that aren't helpers are fingers; bones under a soft bone are soft too (a skirt's chain)
  const under = (b, k) => { for (let p = b.parent; p && p.isBone; p = p.parent) if (kind.get(p) === k) return p; return null; };
  for (const b of bones) {
    const k = kind.get(b);
    if (["helper", "face", "jaw"].includes(k)) continue;
    if (under(b, "soft")) kind.set(b, "soft");
    else if (under(b, "hand") && !["hand"].includes(k)) kind.set(b, "finger");
    else if (under(b, "finger")) kind.set(b, "finger");
  }
  // "other": a bone between body bones (e.g. "jointroot") is body; a loose chain hanging off the body swings (soft)
  const bodyKinds = new Set(["spine", "arm", "leg", "hand"]);
  const hasBodyBelow = (b) => { let found = false; b.traverse((o) => { if (o !== b && o.isBone && bodyKinds.has(kind.get(o))) found = true; }); return found; };
  for (const b of bones) {
    if (kind.get(b) !== "other") continue;
    if (hasBodyBelow(b) || !b.parent?.isBone) kind.set(b, "spine");
    else if (under(b, "spine") || under(b, "arm") || under(b, "leg")) kind.set(b, b.children.some((c) => c.isBone) ? "soft" : "helper");
  }
  for (const b of bones) if (kind.get(b) === "other") kind.set(b, "helper");

  const body = new Set(bones.filter((b) => bodyKinds.has(kind.get(b)) || kind.get(b) === "jaw"));
  const soft = bones.filter((b) => kind.get(b) === "soft");
  const named = (re) => bones.filter((b) => re.test(clean(b.name)));
  const pick = (list, s) => list.find((b) => side(b.name) === s) || null;
  const hands = {};
  for (const s of ["L", "R"]) {
    const hand = pick(bones.filter((b) => kind.get(b) === "hand"), s);
    if (!hand) continue;
    // a finger = a chain starting right under the hand (helpers skipped). A bone with several fingers under it
    // ("fingerBase", a palm bone) isn't a finger itself: each branch under it is one.
    const isF = (c) => c.isBone && kind.get(c) === "finger";
    const chains = [];
    const start = (r) => {
      const chain = [];
      for (let x = r; x; ) {
        const kids = x.children.filter(isF);
        if (kids.length > 1) { if (chain.length) chains.push(chain.slice()); kids.forEach(start); return; }
        chain.push(x);
        x = kids[0];
      }
      if (chain.length) chains.push(chain);
    };
    const walk = (b) => { for (const c of b.children) { if (!c.isBone) continue; if (isF(c)) start(c); else if (kind.get(c) === "hand") walk(c); } };
    walk(hand);
    // a branch point's own bone ("fingerBase") was pushed as a 1-bone chain above the real fingers: drop those
    const fingers = chains.filter((c) => !(c.length === 1 && c[0].children.filter(isF).length > 1))
      .map((chain) => ({ chain, thumb: /thumb|pollex/i.test(chain[0].name) }));
    const count = fingers.length;
    hands[s] = { hand, fingers, count, type: count >= 5 ? "five" : count === 4 ? "four" : count === 3 ? "three" : count === 2 ? "two" : count === 1 ? "mitten" : "paw" };
  }
  const feet = bones.filter((b) => /foot|ankle|toe|heel/.test(clean(b.name)) && body.has(b));
  const head = named(/^head$|^head|spine\.?006/).find((b) => body.has(b)) || null;
  const hips = bones.find((b) => body.has(b) && /hip|pelvis|cog|waist|root/.test(clean(b.name)) && !side(b.name)) || bones.find((b) => body.has(b)) || null;
  const arms = {};
  for (const s of ["L", "R"]) {
    const list = bones.filter((b) => side(b.name) === s && body.has(b));
    const upper = list.find((b) => /upperarm|upper_arm|^arm$|^larm|^rarm|arm$/.test(clean(b.name)) && !/fore|lower/.test(clean(b.name)));
    const lower = list.find((b) => /forearm|lowerarm|elbow/.test(clean(b.name)));
    if (upper) arms[s] = { upper, lower, hand: hands[s]?.hand || null };
  }
  return { bones, kind, body, soft, hands, feet, head, hips, arms, jaw: bones.find((b) => kind.get(b) === "jaw") || null,
    neck: named(/neck/).find((b) => body.has(b)) || null, chest: named(/chest|spine2|spine\.?003|upperchest/).find((b) => body.has(b)) || null };
}

/** names the analysis puts on the body (Python sends only these to UniMate too; see skills/slimrig.py) */
export function bodyNames(info) { return [...info.body].map((b) => b.name); }

// ---------------- clips ----------------
const ONCE = /^(sit|jump|lie|lounge|crouch|book_take|book_put|cheer|stretch|yawn|shrug|bow|nod|shake|point|pushup|plank)$/i;

function smoothTrack(t, loop, radius) {
  const n = t.times.length, size = t.getValueSize();
  if (n < 5) return;
  const v = t.values, out = new Float32Array(v.length);
  const isQ = size === 4;
  for (let i = 0; i < n; i++) {
    const acc = new Float64Array(size);
    let wsum = 0;
    for (let d = -radius; d <= radius; d++) {
      let j = i + d;
      if (loop) j = ((j % (n - 1)) + (n - 1)) % (n - 1);           // the last key equals the first one
      else j = Math.max(0, Math.min(n - 1, j));
      const w = radius + 1 - Math.abs(d);
      let sign = 1;
      if (isQ) {                                                      // keep quaternions on the same side
        let dot = 0; for (let k = 0; k < 4; k++) dot += v[j * 4 + k] * v[i * 4 + k];
        sign = dot < 0 ? -1 : 1;
      }
      for (let k = 0; k < size; k++) acc[k] += v[j * size + k] * w * sign;
      wsum += w;
    }
    for (let k = 0; k < size; k++) out[i * size + k] = acc[k] / wsum;
    if (isQ) { const q = new THREE.Quaternion().fromArray(out, i * 4).normalize(); q.toArray(out, i * 4); }
  }
  if (loop) for (let k = 0; k < size; k++) out[(n - 1) * size + k] = out[k];
  v.set(out);
}

/** a looping clip: the last quarter second blends into the first frame, so it never pops when it starts again */
function closeLoop(t) {
  const n = t.times.length, size = t.getValueSize();
  if (n < 6) return;
  const span = Math.min(Math.max(3, Math.round(n * 0.12)), n - 2);
  const v = t.values;
  const q0 = size === 4 ? new THREE.Quaternion().fromArray(v, 0) : null;
  for (let i = n - span; i < n; i++) {
    const f = (i - (n - span) + 1) / span;
    if (q0) { const q = new THREE.Quaternion().fromArray(v, i * 4); if (q.dot(q0) < 0) q0.set(-q0.x, -q0.y, -q0.z, -q0.w); q.slerp(q0, f).toArray(v, i * 4); }
    else for (let k = 0; k < size; k++) v[i * size + k] += (v[k] - v[i * size + k]) * f;
  }
}

/** keep the lowest foot on the floor in every frame of a clip (UniMate's motions often hover or sink) */
function groundClip(root, info, clip) {
  if (!info.hips || !info.feet.length || ONCE.test(clip.name)) return false;
  const track = clip.tracks.find((t) => t.name === `${info.hips.name}.position`);
  const parent = info.hips.parent;
  root.updateMatrixWorld(true);
  const restLow = Math.min(...info.feet.map((f) => f.getWorldPosition(new THREE.Vector3()).y));
  const saved = info.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const mixer = new THREE.AnimationMixer(root);
  const act = mixer.clipAction(clip).play();
  const times = track ? Array.from(track.times) : Array.from({ length: Math.max(2, Math.round(clip.duration * 30) + 1) }, (_, i) => i / 30);
  const lift = times.map((time) => {
    act.time = time; mixer.update(0); root.updateMatrixWorld(true);
    return restLow - Math.min(...info.feet.map((f) => f.getWorldPosition(new THREE.Vector3()).y));
  });
  act.stop(); mixer.uncacheRoot(root);
  info.bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
  root.updateMatrixWorld(true);
  if (Math.max(...lift.map(Math.abs)) < 0.003 * (new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y || 1)) return false;
  // world "up by lift" -> the hips' parent space
  const toLocal = new THREE.Matrix3().setFromMatrix4(parent?.matrixWorld || new THREE.Matrix4()).invert();
  const vals = new Float32Array(times.length * 3);
  times.forEach((time, i) => {
    const base = track ? new THREE.Vector3().fromArray(track.values, i * 3) : info.hips.position.clone();
    base.add(new THREE.Vector3(0, lift[i], 0).applyMatrix3(toLocal));
    base.toArray(vals, i * 3);
  });
  const t = new THREE.VectorKeyframeTrack(`${info.hips.name}.position`, times, vals);
  smoothTrack(t, !ONCE.test(clip.name), 2);
  clip.tracks = clip.tracks.filter((x) => x !== track).concat(t);
  return true;
}

// clips where the arms are meant to go up or out: left as they are
const ARMS_FREE = /wave|cheer|jump|dance|stretch|press|jacks|clap|point|shrug|pushup|plank|row|curl|deadlift|swim|fly|hug|yawn|book|type|sit|lie|lounge/i;

/** UniMate keeps the T/A-pose arms of the rest pose in calm clips (they stick out stiffly): turn the upper arms so
 *  they hang at the sides, keeping the swing the clip already has. */
function relaxArms(root, info, clip) {
  if (ARMS_FREE.test(clip.name)) return false;
  const arms = Object.entries(info.arms).filter(([, a]) => a.upper && (a.lower || a.hand));
  if (!arms.length) return false;
  root.updateMatrixWorld(true);
  const saved = info.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const restore = () => { info.bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); }); root.updateMatrixWorld(true); };
  const center = (info.hips || root).getWorldPosition(new THREE.Vector3());
  const mixer = new THREE.AnimationMixer(root);
  const act = mixer.clipAction(clip).play();
  let changed = false;
  for (const [, a] of arms) {
    const name = `${a.upper.name}.quaternion`;
    let track = clip.tracks.find((t) => t.name === name);
    const times = track ? Array.from(track.times) : [0, clip.duration];
    const end = a.lower || a.hand;
    const dirs = [], parents = [], locals = [];
    for (const time of times) {
      act.time = time; mixer.update(0); root.updateMatrixWorld(true);
      const p0 = a.upper.getWorldPosition(new THREE.Vector3()), p1 = end.getWorldPosition(new THREE.Vector3());
      dirs.push(p1.sub(p0).normalize());
      parents.push(a.upper.parent.getWorldQuaternion(new THREE.Quaternion()));
      locals.push(a.upper.quaternion.clone());
    }
    const avg = dirs.reduce((s, d) => s.add(d), new THREE.Vector3()).normalize();
    // hanging: down, a little away from the body and a little forward
    const shoulder = a.upper.getWorldPosition(new THREE.Vector3());
    const out = shoulder.clone().sub(center).setY(0).normalize();
    const target = new THREE.Vector3(0, -1, 0).addScaledVector(out, 0.2).add(new THREE.Vector3(0, 0, 0.06)).normalize();
    if (avg.angleTo(target) < 0.3) continue;                    // already hangs (under ~17°)
    const turn = new THREE.Quaternion().setFromUnitVectors(avg, target);
    const vals = new Float32Array(times.length * 4);
    times.forEach((_, i) => {
      // local' = parent⁻¹ · turn · parent · local  (the same turn in world space, whatever the shoulder does)
      const pw = parents[i];
      const q = pw.clone().invert().multiply(turn).multiply(pw).multiply(locals[i]).normalize();
      q.toArray(vals, i * 4);
    });
    const t = new THREE.QuaternionKeyframeTrack(name, times, vals);
    clip.tracks = clip.tracks.filter((x) => x !== track).concat(t);
    changed = true;
  }
  act.stop(); mixer.uncacheRoot(root);
  restore();
  return changed;
}

/** Make UniMate's clips behave: body bones only, smooth, feet on the floor, seamless loops. Returns a short report. */
export function cleanClips(root, clips, info = analyzeRig(root)) {
  const bodyNames = new Set([...info.body].map((b) => b.name));
  const report = { dropped: 0, smoothed: 0, grounded: 0, arms: 0 };
  for (const clip of clips || []) {
    if (/^talk$/i.test(clip.name) && clip.userData?.made === "app") continue;
    const loop = !ONCE.test(clip.name);
    const before = clip.tracks.length;
    clip.tracks = clip.tracks.filter((t) => bodyNames.has(t.name.split(".")[0]) && !t.name.endsWith(".scale"));
    report.dropped += before - clip.tracks.length;
    for (const t of clip.tracks) {
      smoothTrack(t, loop, t.name.endsWith(".position") ? 2 : 1);
      if (loop) closeLoop(t);
      report.smoothed++;
    }
    if (relaxArms(root, info, clip)) report.arms++;
    if (groundClip(root, info, clip)) report.grounded++;
  }
  return report;
}

/** Put a clip made on UniMate's copy of the rig (fewer bones, other units, the top bone turned) onto the ORIGINAL rig,
 *  so the original's fingers, hair and cloth bones stay (they get the app's hands and springs instead).
 *  For each bone K = (its rest in `from`)⁻¹ · (its rest in `to`), in world space; then q_to = K_parent⁻¹ · q_from · K. */
export function retargetClip(clip, fromRoot, toRoot) {
  fromRoot.updateMatrixWorld(true); toRoot.updateMatrixWorld(true);
  const toBones = new Map();
  toRoot.traverse((o) => { if (o.isBone && !toBones.has(o.name)) toBones.set(o.name, o); });
  const fromBones = new Map();
  fromRoot.traverse((o) => { if (o.isBone && !fromBones.has(o.name)) fromBones.set(o.name, o); });
  const K = new Map(), parentK = new Map();
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  const ratios = [];
  for (const [name, f] of fromBones) {
    const t = toBones.get(name);
    if (!t) continue;
    K.set(name, wq(f).invert().multiply(wq(t)));
    parentK.set(name, wq(f.parent).invert().multiply(wq(t.parent)));
    const a = f.position.length(), b = t.position.length();
    if (a > 1e-6 && b > 1e-6) ratios.push(b / a);
  }
  // the two copies use different units (UniMate's Blender export vs the original): the bone lengths say how much
  ratios.sort((x, y) => x - y);
  const unit = ratios.length ? ratios[ratios.length >> 1] : 1;
  const tracks = [];
  for (const tr of clip.tracks) {
    const [name, prop] = tr.name.split(".");
    if (!K.has(name)) continue;
    const vals = tr.values.slice();
    const kp = parentK.get(name), kpi = kp.clone().invert(), k = K.get(name);
    if (prop === "quaternion") {
      const q = new THREE.Quaternion();
      for (let i = 0; i < vals.length; i += 4) q.fromArray(vals, i).premultiply(kpi).multiply(k).normalize().toArray(vals, i);
      tracks.push(new THREE.QuaternionKeyframeTrack(tr.name, tr.times, vals));
    } else if (prop === "position") {
      const v = new THREE.Vector3(), s = unit;
      for (let i = 0; i < vals.length; i += 3) v.fromArray(vals, i).multiplyScalar(s).applyQuaternion(kpi).toArray(vals, i);
      tracks.push(new THREE.VectorKeyframeTrack(tr.name, tr.times, vals));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// ---------------- hands ----------------
// how much each joint bends (radians) for each pose; [fingers, thumb]
const POSES = { relaxed: [0.32, 0.18], fist: [1.25, 0.7], open: [0.04, 0.02], point: [1.2, 0.6], grip: [1.0, 0.55], wave: [0.06, 0.04] };

/** The world axis fingers curl around. Fingers are almost always modelled a little bent, so the way each finger
 *  already bends (joint to joint) shows it; failing that, the knuckle row, turned toward the body. */
function curlAxis(h, info) {
  const pos = (b) => b.getWorldPosition(new THREE.Vector3());
  const tipOf = (chain) => { const last = chain[chain.length - 1]; const c = last.children.find((x) => x.isBone); return c ? pos(c) : null; };
  const sum = new THREE.Vector3();
  let first = null;
  for (const f of h.fingers) {
    if (f.thumb) continue;
    const pts = f.chain.map(pos);
    const tip = tipOf(f.chain);
    if (tip) pts.push(tip);
    for (let i = 0; i + 2 < pts.length; i++) {
      const v1 = pts[i + 1].clone().sub(pts[i]), v2 = pts[i + 2].clone().sub(pts[i + 1]);
      const a = v1.clone().cross(v2);
      if (a.length() < 1e-4 * v1.length() * v2.length() * 10) continue;    // straight: no hint
      a.normalize();
      if (!first) first = a.clone();
      sum.addScaledVector(a, a.dot(first) < 0 ? -1 : 1);
    }
  }
  const across = (() => {                                              // index knuckle -> little knuckle
    const ks = h.fingers.filter((f) => !f.thumb).map((f) => pos(f.chain[0]));
    return ks.length >= 2 ? ks[ks.length - 1].clone().sub(ks[0]).normalize() : null;
  })();
  if (sum.lengthSq() > 1e-8) {
    const a = sum.normalize();
    // the bend axis lies along the knuckle row; snap toward it when they mostly agree (removes a sideways tilt)
    if (across && Math.abs(a.dot(across)) > 0.6) return across.clone().multiplyScalar(Math.sign(a.dot(across)));
    return a;
  }
  if (across) {
    // straight fingers: curl so the tips go toward the body's front/inside
    const hand = pos(h.hand), center = (info.hips ? pos(info.hips) : new THREE.Vector3());
    const fingerDir = h.fingers.filter((f) => !f.thumb).map((f) => (tipOf(f.chain) || pos(f.chain[f.chain.length - 1])).sub(pos(f.chain[0]))).reduce((s, v) => s.add(v), new THREE.Vector3()).normalize();
    const palm = center.sub(hand).setY(0).normalize().add(new THREE.Vector3(0, -1, 0)).normalize();
    return across.clone().multiplyScalar(Math.sign(fingerDir.clone().cross(palm).dot(across)) || 1);
  }
  return null;
}

function curlSetup(h, info, root) {
  root.updateMatrixWorld(true);
  const pos = (b) => b.getWorldPosition(new THREE.Vector3());
  const fingerAxis = curlAxis(h, info) || new THREE.Vector3(1, 0, 0);
  // the thumb folds across the palm: around the fingers' direction, toward the middle of the palm
  const others = h.fingers.filter((f) => !f.thumb);
  const palmMid = others.length ? others.map((f) => pos(f.chain[0])).reduce((s, v) => s.add(v), new THREE.Vector3()).divideScalar(others.length).lerp(pos(h.hand), 0.3) : pos(h.hand);
  const along = others.length ? others.map((f) => pos(f.chain[f.chain.length - 1]).sub(pos(f.chain[0]))).reduce((s, v) => s.add(v), new THREE.Vector3()).normalize()
    : fingerAxis.clone();
  for (const f of h.fingers) {
    let world = fingerAxis;
    if (f.thumb && others.length) {
      const base = pos(f.chain[0]), tip = pos(f.chain[f.chain.length - 1]);
      const dir = tip.clone().sub(base).normalize();
      const toward = palmMid.clone().sub(tip);
      world = along.clone().multiplyScalar(Math.sign(along.clone().cross(dir).dot(toward)) || 1);
    }
    f.joints = f.chain.map((b) => {
      const wq = b.getWorldQuaternion(new THREE.Quaternion());
      const child = b.children.find((c) => c.isBone);
      const d = (child ? child.position.clone() : b.position.clone()).applyQuaternion(wq).normalize();
      // the same axis for every joint, kept square to this bone so the finger closes straight
      const a = world.clone().addScaledVector(d, -world.dot(d));
      if (a.lengthSq() < 1e-6) a.copy(world);
      const axis = a.normalize().applyQuaternion(wq.clone().invert()).normalize();
      return { bone: b, rest: b.quaternion.clone(), axis };
    });
  }
}

function makeHands(info, root) {
  const list = Object.entries(info.hands).filter(([, h]) => h.fingers.length);
  for (const [, h] of list) curlSetup(h, info, root);
  const state = { pose: { L: "relaxed", R: "relaxed" }, amt: { L: POSES.relaxed.slice(), R: POSES.relaxed.slice() }, k: Math.random() * 6 };
  const q = new THREE.Quaternion();
  return {
    types: Object.fromEntries(Object.entries(info.hands).map(([s, h]) => [s, h.type])),
    set(pose, which = "both") { for (const s of which === "both" ? ["L", "R"] : [which]) if (POSES[pose]) state.pose[s] = pose; },
    update(dt, t, talk = 0) {
      for (const [s, h] of list) {
        const goal = POSES[state.pose[s]] || POSES.relaxed;
        const a = state.amt[s];
        for (let i = 0; i < 2; i++) a[i] += (goal[i] - a[i]) * Math.min(1, dt * 8);
        h.fingers.forEach((f, fi) => {
          const life = Math.sin(t * 1.3 + state.k + fi) * 0.035 + talk * Math.sin(t * 6 + fi * 1.7) * 0.06;
          const pointing = state.pose[s] === "point" && fi === (f.thumb ? -1 : h.fingers.findIndex((x) => !x.thumb));
          const amt = pointing ? 0.05 : (f.thumb ? a[1] : a[0]) + life;
          f.joints.forEach((j, ji) => {
            const k = ji === 0 ? 0.8 : ji === 1 ? 1 : 0.75;        // the middle joint bends most
            j.bone.quaternion.copy(j.rest).multiply(q.setFromAxisAngle(j.axis, amt * k));
          });
        });
      }
    },
  };
}

// ---------------- body colliders: hair and cloth never go through a leg, an arm or the body ----------------
/** A capsule for each body bone (its head to its child), as thick as the skin around it: for every skinned vertex
 *  that mostly follows a body bone, how far it sits from that bone; the capsule radius is a high percentile of that. */
function makeColliders(info, root) {
  root.updateMatrixWorld(true);
  // bone -> the next bone of the SAME chain (spine -> spine, arm -> arm/hand, leg -> leg). The hips' first child is
  // often a thigh: a capsule from the hips to one thigh would push one side of a skirt out.
  const family = (b) => { const k = info.kind.get(b); return k === "hand" ? "arm" : k; };
  const segs = new Map();
  for (const b of info.body) {
    const fam = family(b);
    if (!["spine", "arm", "leg"].includes(fam) || /root|origin/.test(clean(b.name))) continue;
    const same = b.children.filter((c) => c.isBone && info.body.has(c) && family(c) === fam && (fam !== "spine" || !side(c.name)));
    if (same.length === 1) segs.set(b, same[0]);
  }
  const dists = new Map([...segs.keys()].map((b) => [b, []]));
  const a = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3();
  const closest = (pt, s, e, out) => { const d = e.clone().sub(s); const t = Math.max(0, Math.min(1, pt.clone().sub(s).dot(d) / (d.lengthSq() || 1))); return out.copy(s).addScaledVector(d, t); };
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    const step = Math.max(1, Math.floor(pos.count / 4000));         // a sample is enough
    for (let i = 0; i < pos.count; i += step) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const bone = m.skeleton.bones[best];
      if (!bone || !dists.has(bone)) continue;                       // cloth / hair vertices don't make the body thicker
      p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      bone.getWorldPosition(a); segs.get(bone).getWorldPosition(c);
      dists.get(bone).push(p.distanceTo(closest(p, a, c, q)));
    }
  });
  const caps = [];
  for (const [b, e] of segs) {
    const d = dists.get(b).sort((x, y) => x - y);
    const len = b.getWorldPosition(a).distanceTo(e.getWorldPosition(c));
    const r = d.length > 8 ? d[Math.floor(d.length * 0.8)] : len * 0.18;    // no skin found: a guess from the bone length
    if (r > 0) caps.push({ a: b, b: e, r: Math.min(r, len * 0.9) });
  }
  const s = new THREE.Vector3(), t2 = new THREE.Vector3(), near = new THREE.Vector3();
  return {
    count: caps.length,
    caps,
    /** how close `pt` may come to each capsule's middle line: its radius (+ pad), but never more than 90% of how far
     *  it is at rest. Cloth bones sit INSIDE the cloth (the surface is further out), often closer to a leg than the
     *  leg is thick: they must not cross the leg, but pushing them a full leg-width away would balloon the skirt. */
    limits(pt, pad = 0) {
      return caps.map((cap) => { cap.a.getWorldPosition(s); cap.b.getWorldPosition(t2); return Math.min(cap.r + pad, pt.distanceTo(closest(pt, s, t2, near)) * 0.9); });
    },
    /** move `pt` out to each capsule's limit; returns true when it had to move */
    push(pt, limits) {
      let moved = false;
      for (let i = 0; i < caps.length; i++) {
        const cap = caps[i];
        cap.a.getWorldPosition(s); cap.b.getWorldPosition(t2);
        closest(pt, s, t2, near);
        const out = pt.clone().sub(near), dist = out.length(), need = limits[i];
        if (dist < need) {
          if (dist < 1e-6) out.set(0, 0, 1); else out.divideScalar(dist);
          pt.copy(near).addScaledVector(out, need);
          moved = true;
        }
      }
      return moved;
    },
  };
}

// ---------------- springs (hair, cloth, tails) ----------------
function makeSprings(info, root) {
  const springs = [];
  const softSet = new Set(info.soft);
  // parents before children, so a whole chain swings together
  const ordered = [];
  root.traverse((o) => { if (softSet.has(o)) ordered.push(o); });
  for (const b of ordered) {
    const child = b.children.find((c) => c.isBone);
    const local = child ? child.position.clone() : null;
    if (!local || local.lengthSq() < 1e-10) continue;
    const n = b.name.toLowerCase();
    const kind = /tail/.test(n) ? "tail" : /ear/.test(n) ? "ear" : /hair|bang|fringe|braid|ponytail/.test(n) ? "hair" : "cloth";
    const depth = (() => { let d = 0; for (let p = b.parent; p && softSet.has(p); p = p.parent) d++; return d; })();
    // per 1/60 s: how hard it's pulled back (stiff), how much speed it keeps (keep), gravity. Damping is set near
    // critical (keep ≈ 1 - 1.7·√stiff): it follows the body a little late and settles WITHOUT bouncing back and forth -
    // a springy, under-damped setting is exactly what looks like jelly. Tails and ears may bounce a little.
    const P = { cloth: [0.08, 0.52, 0.005], hair: [0.1, 0.5, 0.04], tail: [0.12, 0.62, 0.01], ear: [0.2, 0.6, 0.01] }[kind];
    springs.push({ bone: b, rest: b.quaternion.clone(), local, len: 0, tip: null, prev: null, kind, depth, phase: (springs.length % 7) * 0.45,
      stiff: P[0] * Math.pow(0.95, depth), keep: P[1], grav: P[2], limits: null });
  }
  const colliders = springs.length ? makeColliders(info, root) : null;
  const head = new THREE.Vector3(), want = new THREE.Vector3(), cur = new THREE.Vector3(), next = new THREE.Vector3();
  const wq = new THREE.Quaternion(), pq = new THREE.Quaternion(), rot = new THREE.Quaternion();
  const side = new THREE.Vector3(), radial = new THREE.Vector3(), center = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const scaleOf = (o) => o.getWorldScale(new THREE.Vector3()).y || 1;
  return {
    count: springs.length,
    colliders: colliders?.count || 0,
    capsules: colliders?.caps || [],
    reset() { for (const s of springs) s.tip = null; },
    update(dt, t = 0) {
      if (!springs.length) return;
      dt = Math.min(dt, 1 / 20);
      const f = dt * 60;                                                 // the same feel at any frame rate
      root.updateMatrixWorld(true);                                      // the body as the animation left it this frame
      (info.hips || root).getWorldPosition(center);
      for (const s of springs) {
        const b = s.bone;
        b.quaternion.copy(s.rest);                                      // where the bone would point by itself
        b.updateMatrixWorld(true);
        b.getWorldPosition(head);
        b.getWorldQuaternion(wq);
        want.copy(s.local).multiplyScalar(scaleOf(b)).applyQuaternion(wq).add(head);
        s.len = want.distanceTo(head);
        if (!s.tip) {
          s.tip = want.clone(); s.prev = want.clone();
          s.limits = colliders.limits(want, s.len * 0.05);                 // how close it may come to each body part
          continue;
        }
        // cloth and hair: a slow wave runs down the chain (air moving through it), stronger toward the hem. It moves
        // around the body and a little in/out from it (the bone's own direction is useless here: a skirt points down)
        if (s.kind === "cloth" || s.kind === "hair") {
          radial.copy(head).sub(center).setY(0);
          if (radial.lengthSq() > 1e-10) {
            radial.normalize();
            side.crossVectors(UP, radial);
            const amp = s.len * (s.kind === "cloth" ? 0.025 : 0.018) * Math.min(1.5, 0.6 + 0.15 * s.depth);
            const ph = t * 1.2 - s.depth * 0.8 + s.phase;
            want.addScaledVector(side, Math.sin(ph) * amp).addScaledVector(radial, Math.sin(ph * 0.7 + 1) * amp * 0.4);
          }
        }
        // verlet: keep some of its speed, pulled gently back toward its natural place, with a little gravity
        next.copy(s.tip).sub(s.prev).multiplyScalar(Math.pow(s.keep, f)).add(s.tip)
          .add(cur.copy(want).sub(s.tip).multiplyScalar(1 - Math.pow(1 - s.stiff, f)))
          .add(cur.set(0, -s.grav * s.len * 9.8 * dt * dt * 60, 0));
        // limbs and body are solid: the tip can't be inside a leg, an arm or the torso
        colliders.push(next, s.limits);
        cur.copy(next).sub(head);
        if (cur.lengthSq() < 1e-12) cur.copy(want).sub(head);
        cur.setLength(s.len);
        const nat = want.clone().sub(head).normalize();
        const ang = cur.clone().normalize().angleTo(nat);                  // never more than 70° from its natural place
        if (ang > 1.2) cur.copy(nat.clone().lerp(cur.clone().normalize(), 1.2 / ang).setLength(s.len));
        next.copy(head).add(cur);
        if (colliders.push(next, s.limits)) {                              // keeping the length can pull it back in
          cur.copy(next).sub(head).setLength(s.len);
          next.copy(head).add(cur);
        }
        s.prev.copy(s.tip); s.tip.copy(next);
        // turn the bone toward the new tip
        rot.setFromUnitVectors(nat, cur.clone().normalize());
        b.parent.getWorldQuaternion(pq);
        b.quaternion.copy(pq.clone().invert().multiply(rot).multiply(wq));
        b.updateMatrixWorld(true);
      }
    },
  };
}

/** Everything that runs each frame after the animation: springs + hands. Call update(dt, t, talk) after mixer.update.
 *  skip: bone names something else already moves (a clip that animates the fingers, the room's own ears). */
export function rigExtras(root, info = analyzeRig(root), { skip = new Set() } = {}) {
  if (skip.size) {
    info = { ...info, soft: info.soft.filter((b) => !skip.has(b.name)),
      hands: Object.fromEntries(Object.entries(info.hands).map(([s, h]) => [s, { ...h, fingers: h.fingers.filter((f) => !f.chain.some((b) => skip.has(b.name))) }])) };
  }
  const hands = makeHands(info, root);
  const springs = makeSprings(info, root);
  return {
    info, hands, springs,
    update(dt, t, talk = 0) { hands.update(dt, t, talk); springs.update(dt, t); },
    summary() {
      const h = Object.entries(info.hands).map(([s, x]) => `${s}: ${x.count} finger${x.count === 1 ? "" : "s"} (${x.type})`).join(", ") || "no hands";
      return `${info.body.size} body bones, ${info.soft.length} swinging (hair/cloth)${springs.colliders ? ` that can't go through ${springs.colliders} body parts` : ""}, ${h}`;
    },
  };
}
