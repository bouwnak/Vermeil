// talkanim.js - an automatic "talk" animation for any rigged model, made right here (no UniMate needed).
// The room plays a clip named "talk" while she speaks. This one is a 4-second loop of small, natural moves
// on the rig's own bones: head nods and tilts, the jaw opening and closing (if the rig has a jaw), the chest
// leaning in, and the arms making little "explaining" gestures. Each move is added on top of the bone's rest
// pose, so it works for Rigify-style rigs (spine.006, upper_arm.L) and for most other names (Head, Neck, Jaw).
import * as THREE from "three";

const LEN = 4;          // seconds, one loop
const FPS = 15;

// [which bones (name test), rotation per axis as [amount (radians), waves per loop, phase]]
const MOVES = [
  [/^(head|spine\.?006)$/i, { x: [0.09, 5, 0], y: [0.07, 2, 1.1], z: [0.05, 3, 2.3] }],
  [/^(neck|spine\.?004|spine\.?005)$/i, { x: [0.04, 5, 0.4], y: [0.03, 2, 1.4] }],
  [/^(chest|spine\.?003|spine\.?002|upperchest)$/i, { x: [0.03, 2, 0.8], y: [0.04, 1, 0] }],
  [/^(jaw|jaw_master|lowerjaw)$/i, { x: [0.16, 14, 0] }],
  [/^upper_?arm[._]?l$|^l(eft)?_?upper_?arm$|^upperarm_l$/i, { x: [0.12, 2, 0], z: [0.10, 2, 0.7] }],
  [/^upper_?arm[._]?r$|^r(ight)?_?upper_?arm$|^upperarm_r$/i, { x: [0.10, 2, 2.2], z: [-0.10, 2, 2.9] }],
  [/^fore_?arm[._]?l$|^lowerarm_l$|^l(eft)?_?fore_?arm$/i, { x: [0.18, 4, 0.5] }],
  [/^fore_?arm[._]?r$|^lowerarm_r$|^r(ight)?_?fore_?arm$/i, { x: [0.16, 4, 2.6] }],
];

/** Which bones the talk clip would move (names), so the panel can say if the rig fits. */
export function talkBones(root) {
  const found = [];
  root.traverse((o) => {
    if (o.isBone && MOVES.some(([re]) => re.test(o.name.replace(/^mixamorig:?/i, "")))) found.push(o.name);
  });
  return found;
}

/** Make the "talk" clip for root (a loaded glTF scene). Returns null when no head/neck/arm bones were found. */
export function makeTalkClip(root) {
  const tracks = [];
  const n = LEN * FPS + 1;
  const times = Float32Array.from({ length: n }, (_, i) => (i / FPS));
  root.traverse((o) => {
    if (!o.isBone) return;
    const move = MOVES.find(([re]) => re.test(o.name.replace(/^mixamorig:?/i, "")));
    if (!move) return;
    const rest = o.quaternion.clone();
    const values = new Float32Array(n * 4);
    const e = new THREE.Euler(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * Math.PI * 2;                     // whole waves per loop, so the end meets the start
      const ang = (axis) => {
        const m = move[1][axis];
        if (!m) return 0;
        const [amp, waves, phase] = m;
        return amp * (Math.sin(t * waves + phase) * 0.7 + Math.sin(t * waves * 2 + phase * 1.7) * 0.3);
      };
      e.set(ang("x"), ang("y"), ang("z"));
      q.setFromEuler(e).premultiply(rest);
      q.toArray(values, i * 4);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`, times, values));
  });
  return tracks.length ? new THREE.AnimationClip("talk", LEN, tracks) : null;
}
