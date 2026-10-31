// talkanim.js - an automatic "talk" animation for any rigged model, made right here (no UniMate needed).
// The room plays a clip named "talk" while she speaks. This one is a 4-second loop of small, natural moves
// on the rig's own bones: head nods and tilts, the jaw opening and closing (if the rig has a jaw), the chest
// leaning in, and the arms making little "explaining" gestures. Each move is added on top of the bone's rest
// pose. Which bone is the head, the jaw or an arm comes from ui/rigparts.js, so it works for any naming
// (Rigify's spine.006 / upper_arm.L, Mixamo, game rips like "head_08" / "L_arm_082", Pokémon "LArm"...).
import * as THREE from "three";
import { analyzeRig } from "./rigparts.js";

const LEN = 4;          // seconds, one loop
const FPS = 15;

// role -> rotation per axis as [amount (radians), waves per loop, phase]
const MOVES = {
  head: { x: [0.09, 5, 0], y: [0.07, 2, 1.1], z: [0.05, 3, 2.3] },
  neck: { x: [0.04, 5, 0.4], y: [0.03, 2, 1.4] },
  chest: { x: [0.03, 2, 0.8], y: [0.04, 1, 0] },
  jaw: { x: [0.16, 14, 0] },
  upperL: { x: [0.12, 2, 0], z: [0.10, 2, 0.7] },
  upperR: { x: [0.10, 2, 2.2], z: [-0.10, 2, 2.9] },
  lowerL: { x: [0.18, 4, 0.5] },
  lowerR: { x: [0.16, 4, 2.6] },
};

function roles(root, info = analyzeRig(root)) {
  const out = [];
  const add = (bone, role) => { if (bone && !out.some(([b]) => b === bone)) out.push([bone, role]); };
  add(info.head, "head"); add(info.neck, "neck"); add(info.chest, "chest"); add(info.jaw, "jaw");
  for (const s of ["L", "R"]) { add(info.arms[s]?.upper, `upper${s}`); add(info.arms[s]?.lower, `lower${s}`); }
  return out;
}

/** Which bones the talk clip would move (names), so the panel can say if the rig fits. */
export function talkBones(root, info) {
  return roles(root, info).map(([b]) => b.name);
}

/** Make the "talk" clip for root (a loaded glTF scene). Returns null when no head/neck/arm bones were found. */
export function makeTalkClip(root, info) {
  const tracks = [];
  const n = LEN * FPS + 1;
  const times = Float32Array.from({ length: n }, (_, i) => (i / FPS));
  for (const [bone, role] of roles(root, info)) {
    const move = MOVES[role];
    const rest = bone.quaternion.clone();
    const values = new Float32Array(n * 4);
    const e = new THREE.Euler(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * Math.PI * 2;                     // whole waves per loop, so the end meets the start
      const ang = (axis) => {
        const m = move[axis];
        if (!m) return 0;
        const [amp, waves, phase] = m;
        return amp * (Math.sin(t * waves + phase) * 0.7 + Math.sin(t * waves * 2 + phase * 1.7) * 0.3);
      };
      e.set(ang("x"), ang("y"), ang("z"));
      q.setFromEuler(e).premultiply(rest);
      q.toArray(values, i * 4);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values));
  }
  if (!tracks.length) return null;
  const clip = new THREE.AnimationClip("talk", LEN, tracks);
  clip.userData = { made: "app" };
  return clip;
}
