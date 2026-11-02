// monstermoves.js - a monster's moves, made from its own body the moment it loads.
//
// bodyPlan() (ui/rigparts.js) says what a body has; this builds the moves that body can do, as ordinary animation clips: wings make flying,
// hovering and gliding, a body with no legs floats, legs make prowling and charging, a tail swings, a jaw roars. Nothing is named after a
// model: every turn is measured from the rest pose around the way the model faces. A move UniMate made, or one the model came with, is kept.
import * as THREE from "three";
import { facing, FLOATING } from "./rigparts.js";

const TAU = Math.PI * 2;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

/** a bone and the first bones hanging from it */
function chain(bone, keep = () => true) {
  const out = [];
  for (let b = bone; b && b.isBone && keep(b); b = b.children.find((c) => c.isBone)) out.push(b);
  return out;
}

/** The bone that carries everything. "Hips" often doesn't: on many rigs it sits beside the spine, and raising it would only raise the legs. This is
 *  the lowest bone with the head and every leg under it. */
function carrier(info) {
  const under = (top, b) => { for (let p = b; p?.isBone; p = p.parent) if (p === top) return true; return false; };
  const parts = [info.head, info.hips, ...info.bones.filter((b) => info.kind.get(b) === "leg" && info.kind.get(b.parent) !== "leg")].filter(Boolean);
  for (let b = parts[0] || info.hips; b?.isBone; b = b.parent) if (parts.every((x) => under(b, x))) return b;
  return info.hips;
}

/** the parts a move can take hold of */
function bodyParts(info, plan) {
  const kind = (b) => info.kind.get(b);
  const tailRoot = info.bones.filter((b) => /tail/i.test(b.name) && !/tail/i.test(b.parent?.name || "") && !/end/i.test(b.name));
  const spine = info.bones.filter((b) => kind(b) === "spine" && b !== info.head && !/root|origin|waist$/i.test(b.name) && b.children.some((c) => c.isBone));
  const thighs = info.bones.filter((b) => kind(b) === "leg" && kind(b.parent) !== "leg" && b.children.some((c) => c.isBone));
  return { spine, thighs, shins: thighs.map((t) => t.children.find((c) => c.isBone && kind(c) === "leg")).filter(Boolean),
    tail: tailRoot.flatMap((t) => chain(t, (b) => !/end/i.test(b.name))), wings: plan.wings.map((w) => chain(w, (b) => !/end/i.test(b.name)).slice(0, 4)),
    arms: Object.values(info.arms).map((a) => a.upper).filter(Boolean), leftArm: info.arms.L?.upper || null, rightArm: info.arms.R?.upper || null };
}

/** Turns that bring a limb's bones to point the given ways, parent first, each counting what its parent already did:
 *  [{ bone, axis, angle }], axes in world space. links: [[bone, its next joint, the way it should point], ...] */
function aimLimb(links) {
  const out = [], before = new THREE.Quaternion(), turn = new THREE.Quaternion();
  for (const [bone, next, want] of links) {
    if (!bone || !next) continue;
    const a = bone.getWorldPosition(new THREE.Vector3()), b = next.getWorldPosition(new THREE.Vector3());
    const now = b.sub(a).normalize().applyQuaternion(before);
    const after = turn.setFromUnitVectors(now, want.clone().normalize()).clone().multiply(before);
    const own = before.clone().invert().multiply(after);       // what this bone adds on top of its parent
    const angle = 2 * Math.acos(Math.min(1, Math.abs(own.w))), s = Math.sqrt(Math.max(0, 1 - own.w * own.w));
    if (angle > 0.005 && s > 1e-5) out.push({ bone, axis: new THREE.Vector3(own.x, own.y, own.z).divideScalar(s).multiplyScalar(own.w < 0 ? -1 : 1), angle });
    before.copy(after);
  }
  return out;
}

/** The hover: upright and calm, like a superhero in the air. Legs hang straight down, the second knee a little bent, toes pointing down; arms loose
 *  at the sides, a little out. Measured from where each limb is at rest, so it fits any body. -> [{ bone, axis, angle }] */
function hangPose(info, P, plan, dir) {
  const next = (b) => b?.children.find((c) => c.isBone && info.kind.get(c) === info.kind.get(b)) || b?.children.find((c) => c.isBone) || null;
  const down = (x, z) => new THREE.Vector3(x, -1, z * dir);
  const turns = [];
  const legs = P.thighs.slice().sort((a, b) => a.getWorldPosition(new THREE.Vector3()).x - b.getWorldPosition(new THREE.Vector3()).x);
  legs.forEach((thigh, i) => {
    const side = onSide(thigh, info.hips), shin = next(thigh), foot = shin && next(shin), toe = foot && next(foot);
    const bent = i % 2 === 1;                                  // one leg straight, the other easy at the knee: nobody hangs like a plank
    turns.push(...aimLimb([[thigh, shin, down(side * 0.05, bent ? 0.2 : 0.02)], [shin, foot, down(side * 0.02, bent ? -0.24 : -0.03)], [foot, toe, down(0, 0.8)]]));
  });
  for (const a of Object.values(info.arms)) {
    if (!a.upper || !a.lower || plan.bigWings?.some((w) => { for (let p = a.upper; p?.isBone; p = p.parent) if (p === w) return true; return false; })) continue;
    const side = onSide(a.upper, info.hips);
    turns.push(...aimLimb([[a.upper, a.lower, down(side * 0.2, 0.02)], [a.lower, a.hand || next(a.lower), down(side * 0.16, 0.1)]]));
  }
  return turns;
}

const onSide = (bone, hips) => Math.sign(bone.getWorldPosition(new THREE.Vector3()).x - hips.getWorldPosition(new THREE.Vector3()).x) || 1;

/** One clip: `pose(move, t)` says, for t from 0 to 1, how far each bone turns. lift(t) raises the body, in heights of the model. */
function makeClip(name, seconds, root, info, pose, lift) {
  const n = Math.max(2, Math.round(seconds * 24) + 1), times = Float32Array.from({ length: n }, (_, i) => seconds * i / (n - 1));
  const frames = new Map(), q = new THREE.Quaternion();
  const axes = new Map();
  const local = (bone, world) => {                         // a world direction, in the frame of the bone's parent
    const key = `${bone.uuid}|${world.x}|${world.y}|${world.z}`;
    if (!axes.has(key)) axes.set(key, world.clone().applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize());
    return axes.get(key);
  };
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pose((bone, axis, angle) => {
      if (!bone?.parent || !angle) return;
      if (!frames.has(bone)) frames.set(bone, Array.from({ length: n }, () => new THREE.Quaternion()));
      frames.get(bone)[i].premultiply(q.setFromAxisAngle(local(bone, axis), angle));
    }, t);
  }
  const tracks = [];
  for (const [bone, list] of frames) {
    const vals = new Float32Array(n * 4);
    list.forEach((f, i) => f.clone().multiply(bone.quaternion).toArray(vals, i * 4));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, vals));
  }
  if (lift && info.hips?.parent) {
    const height = new THREE.Box3().setFromObject(root, true).getSize(new THREE.Vector3()).y || 1;
    const up = Y.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(info.hips.parent.matrixWorld).invert());
    const vals = new Float32Array(n * 3), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) p.copy(info.hips.position).addScaledVector(up, height * lift(i / (n - 1))).toArray(vals, i * 3);
    tracks.push(new THREE.VectorKeyframeTrack(`${info.hips.name}.position`, times, vals));
  }
  const clip = new THREE.AnimationClip(name, seconds, tracks);
  clip.userData = { made: "app" };
  return clip;
}

/** a hump from 0 to 1 and back over a one-shot move */
const hump = (t, a = 0.15, b = 0.85) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return Math.sin(u * Math.PI); };
const ease = (t, a, b) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

/** every move this body can do: [{ name, clip }]. have: the names it already has; those stay. */
export function monsterClips(root, rigInfo, plan, have = new Set(), only = null) {
  if (!rigInfo.hips) return [];
  root.updateMatrixWorld(true);
  const info = { ...rigInfo, hips: carrier(rigInfo) };     // from here on the "hips" a move lifts and turns are what carries the whole body
  const P = bodyParts(info, plan), dir = facing(root, info) || 1;
  const front = Z.clone().multiplyScalar(dir), pitch = X.clone().multiplyScalar(dir), { head, neck, jaw, chest, hips } = info;
  const upper = [chest, neck, head].filter(Boolean);
  const sideOf = (b) => onSide(b, hips);
  const beat = (turn, speed, size, lag = 0.1) => {         // wings: up and down around the body's front-back line, the far end following late
    for (const wing of P.wings) wing.forEach((b, i) => turn(b, front, sideOf(wing[0]) * dir * -Math.sin(lag * i * TAU + speed) * size * (i ? 0.45 : 1)));
  };
  const sway = (turn, t, cycles, size, axis = Y) => P.tail.forEach((b, i) => turn(b, axis, Math.sin(t * TAU * cycles - i * 0.5) * size * (0.4 + i * 0.1)));
  const steps = (turn, t, cycles, size) => {               // legs in turn, and the arms against them
    const phase = t * TAU * cycles;
    P.thighs.forEach((b) => turn(b, pitch, Math.sin(phase) * size * sideOf(b)));
    P.shins.forEach((b) => turn(b, pitch, (Math.sin(phase + 1.2) + 1) * size * 0.35 * dir));
    P.arms.forEach((b) => turn(b, pitch, -Math.sin(phase) * size * 0.6 * sideOf(b)));
  };
  const tuck = (turn, size) => P.thighs.forEach((b) => turn(b, pitch, -size));
  // the hover holds still but for its breath: one slow bob, the head easy, and big wings just keeping it up
  const hang = hangPose(info, P, plan, dir);
  const hovering = (turn, t, lean = 0) => {
    for (const h of hang) turn(h.bone, h.axis, h.angle);
    if (lean) turn(hips, pitch, lean);
    upper.forEach((b, i) => turn(b, pitch, Math.sin(t * TAU) * 0.012 * (i + 1) - (i === upper.length - 1 ? lean * 0.8 : 0)));
    P.thighs.forEach((b, i) => turn(b, pitch, Math.sin(t * TAU + i * 2) * 0.016));
    P.arms.forEach((b, i) => turn(b, front, Math.sin(t * TAU + i) * 0.014));
    for (const wing of P.wings) wing.forEach((b, i) => { if (plan.bigWings?.includes(wing[0])) turn(b, front, sideOf(wing[0]) * dir * Math.sin(t * TAU - i * 0.5) * 0.09); });
    sway(turn, t, 1, 0.05);
  };
  // how high: however it hangs, four legs or two, its lowest point is this far clear of the floor. Measured on the pose itself.
  const hoverHeight = (() => {
    const before = new THREE.Box3().setFromObject(root, true), height = before.getSize(new THREE.Vector3()).y || 1;
    const saved = info.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
    const mixer = new THREE.AnimationMixer(root), act = mixer.clipAction(makeClip("hang", 1, root, info, (turn) => hovering(turn, 0))).play();
    mixer.update(0); root.updateMatrixWorld(true);
    root.traverse((o) => o.skeleton?.update());
    const low = new THREE.Box3().setFromObject(root, true).min.y;
    act.stop(); mixer.uncacheRoot(root);
    info.bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
    root.updateMatrixWorld(true);
    root.traverse((o) => o.skeleton?.update());
    return 0.16 + (before.min.y - low) / height;
  })();
  const moves = {
    idle: [3, (turn, t) => { upper.forEach((b, i) => turn(b, pitch, Math.sin(t * TAU) * 0.018 * (i + 1))); sway(turn, t, 1, 0.1); }],
    walk: plan.legs && [1.1, (turn, t) => { steps(turn, t, 1, 0.42); upper.forEach((b) => turn(b, Y, Math.sin(t * TAU) * 0.03)); sway(turn, t, 1, 0.14); }, (t) => Math.abs(Math.sin(t * TAU)) * 0.012],
    fly: plan.wings.length && [1.2, (turn, t) => { beat(turn, t * TAU * 3, 0.62); turn(hips, pitch, 0.32); tuck(turn, 0.5); sway(turn, t, 1, 0.16); }, (t) => 0.3 + Math.sin(t * TAU * 3) * 0.015],
    hover: [4, (turn, t) => hovering(turn, t), (t) => hoverHeight + Math.sin(t * TAU) * 0.012],
    hover_go: [4, (turn, t) => hovering(turn, t, 0.3), (t) => hoverHeight + Math.sin(t * TAU) * 0.012],     // going somewhere: leaning into it
    glide: plan.wings.length && [4, (turn, t) => { beat(turn, Math.PI / 2 + Math.sin(t * TAU) * 0.3, 0.14, 0); turn(hips, pitch, 0.36); turn(hips, Z, Math.sin(t * TAU) * 0.14); tuck(turn, 0.7); }, (t) => 0.32 + Math.sin(t * TAU) * 0.02],
    wing_flap: plan.wings.length && [1.2, (turn, t) => { beat(turn, t * TAU * 2, 0.6); upper.forEach((b) => turn(b, pitch, Math.sin(t * TAU * 2) * 0.05)); }],
    float: !plan.legs && [4.5, (turn, t) => {
      const line = [...P.spine, ...P.tail];                // a body with no legs moves as one long wave
      line.forEach((b, i) => turn(b, Y, Math.sin(t * TAU - i * 0.45) * 0.07));
      turn(head, Z, Math.sin(t * TAU) * 0.05);
    }, (t) => 0.16 + Math.sin(t * TAU) * 0.03],
    roar: head && [2.2, (turn, t) => {
      const h = hump(t, 0.12, 0.92);
      upper.forEach((b, i) => turn(b, pitch, -h * (0.14 + i * 0.1)));
      turn(jaw, X, h * 0.55 * dir);
      turn(head, Y, Math.sin(t * TAU * 5) * 0.05 * h);
      P.arms.forEach((b) => turn(b, front, sideOf(b) * dir * h * 0.4));
      beat(turn, Math.PI / 2, 0.35 * h, 0);
      sway(turn, t, 2, 0.2 * h, X);
    }],
    breathe_fire: head && [2.4, (turn, t) => {
      const back = hump(t, 0, 0.32), out = ease(t, 0.28, 0.4) * (1 - ease(t, 0.86, 1));
      upper.forEach((b, i) => turn(b, pitch, (out * 0.2 - back * 0.3) * (1 + i * 0.3)));
      turn(jaw, X, out * 0.6 * dir);
      turn(head, Y, Math.sin(t * TAU * 2) * 0.16 * out);
    }],
    bite: head && [1, (turn, t) => {
      const h = hump(t, 0.1, 0.8), snap = 1 - ease(t, 0.42, 0.52);
      upper.forEach((b, i) => turn(b, pitch, h * (0.14 + i * 0.1)));
      turn(hips, pitch, h * 0.12);
      turn(jaw, X, Math.min(h, snap) * 0.6 * dir);
    }],
    claw: (P.rightArm || P.leftArm) && [1, (turn, t) => {
      const arm = P.rightArm || P.leftArm, up = hump(t, 0, 0.42), down = hump(t, 0.34, 0.95);
      turn(arm, pitch, (up * -1 + down * 1.2) * sideOf(arm) * (sideOf(arm) < 0 ? -1 : 1));
      if (chest) turn(chest, Y, (down - up) * 0.28 * dir);
    }],
    tail_swing: P.tail.length && [1.6, (turn, t) => {
      const h = hump(t, 0, 1), s = Math.sin(t * TAU);
      turn(hips, Y, s * 0.55 * h);
      sway(turn, t, 1, 0.65 * h);
    }],
    stomp: plan.legs && [1.2, (turn, t) => {
      const lift = Math.max(0, Math.sin(t * TAU));
      P.thighs.forEach((b, i) => turn(b, pitch, -(i ? Math.max(0, -Math.sin(t * TAU)) : lift) * 0.6));
      turn(hips, Z, Math.sin(t * TAU) * 0.07);
    }, (t) => Math.abs(Math.sin(t * TAU)) * 0.02],
    prowl: plan.legs && [1.8, (turn, t) => { steps(turn, t, 1, 0.3); turn(hips, pitch, 0.16); if (head) turn(head, pitch, -0.14); sway(turn, t, 1, 0.1); }, () => -0.04],
    crawl: plan.legs && [2, (turn, t) => { steps(turn, t, 1, 0.24); turn(hips, pitch, 0.34); if (head) turn(head, pitch, -0.3); }, () => -0.1],
    charge: plan.legs && [0.7, (turn, t) => { steps(turn, t, 1, 0.75); turn(hips, pitch, 0.34); if (head) turn(head, pitch, 0.12); sway(turn, t, 1, 0.1, X); }, (t) => Math.abs(Math.sin(t * TAU)) * 0.03],
    hurt: [0.9, (turn, t) => {
      const h = hump(t, 0, 0.7);
      turn(hips, pitch, -h * 0.26);
      upper.forEach((b) => turn(b, pitch, -h * 0.14));
      if (jaw) turn(jaw, X, h * 0.3 * dir);
    }],
    faint: [1.8, (turn, t) => {
      const d = ease(t, 0.1, 0.8);
      turn(hips, Z, d * 1.35 * dir);
      upper.forEach((b) => turn(b, pitch, d * 0.2));
      beat(turn, -Math.PI / 2, 0.5 * d, 0);
    }, (t) => -ease(t, 0.1, 0.8) * 0.2],
  };
  const out = [];
  for (const [name, m] of Object.entries(moves)) {
    if (!m || have.has(name) || (only && !only.includes(name))) continue;
    const clip = makeClip(name, m[0], root, info, m[1], m[2]);
    if (clip.tracks.length) out.push(clip);
  }
  return out;
}

export { FLOATING };
