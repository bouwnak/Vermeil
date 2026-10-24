// anim.js - the shared animation system every character uses (player, Vermeil, allies, NPCs, monsters, bosses).
//
// 1. Each model's own clips are matched to common states (idle, walk, run, attack, cast, hit, death, ...)
//    by name patterns - so "TRex_Attack", "SwordSlash", "Bite_Front" all become "attack".
// 2. Anything a model is missing is filled in with procedural motion that works on any rig: bones are found by
//    name (pelvis, spine, chest, neck, head, shoulders, arms, forearms, hands, every finger, thighs, shins, feet,
//    tail, ears, jaw) and rotated in the character's own frame, so the same motion works on different skeletons.
//    Models with almost no bones (blobs, flyers) get squash / bounce / lunge motion instead.
// 3. On top of the clips sits a STYLE layer, different for every species: posture (an orc's forward hunch, an elf's
//    upright grace, a goblin's crouch...), breathing, weight shifts, walk swagger, talking gestures, idle habits
//    (stroking a beard, rubbing hands, sniffing the air...) and their own greeting / victory emotes. Legs keep the
//    feet planted with a small two-bone IK solver, so crouches and wide stances bend the knees naturally.
// 4. Clips never move the character on their own (root sideways motion is removed): the game moves characters,
//    and walk/run speed is matched to the movement speed so feet don't slide.
import * as THREE from "three";

const STATES = {
  idle: [/^idle$/, /^idle_?neutral$/, /^idle(_loop)?$/, /^standing$/, /^idle/, /flying/, /^stand/],
  walk: [/^walk(ing)?$/, /^walk_?loop$/, /^walk/, /flying/, /^run(ning)?$/],
  run: [/^run$/, /^running$/, /^run_?loop$/, /^run(?!_back|_left|_right|_shoot|_attack|_carry|_hold|_weapon|_tall)/, /^walk(ing)?$/, /flying/],
  combat_idle: [/idle_?(sword|attacking|weapon|attack|gun)$/, /^idle_?(sword|weapon|attacking)/, /^idle_shield_loop/, /^idle$/, /^idle/, /flying/],
  attack: [/sword_?(slash|attack)$|swordattack|^sword$|sword_regular_a$/, /^attack$/, /^attack(_1|1)?$/, /^attack/, /staff_attack/, /^weapon$/, /bite_front/, /bite/, /headbutt/, /punch(_right)?$/, /kick/, /melee/],
  attack_heavy: [/sword_heavy|heavy|sword_attack2|attack2|attack\.001|slam/, /sword_?(slash|attack)|swordattack|^sword$/, /^attack/, /^weapon$/, /bite/, /headbutt/, /punch/],
  attack_fast: [/sword_regular_b|punch_left|^attack$/, /sword_?(slash|attack)$|^sword$/, /^weapon$/, /^attack/, /bite/, /punch/],
  cast: [/spell1|^spell|cast|magic/, /staff_attack/, /shoot_onehanded/],
  cast_big: [/spell2|spell1|^spell|cast/, /staff_attack/],
  shoot: [/^shoot|gun_shoot|shoot_onehanded|shoot_small|^bow|idle_gun_shoot/],
  punch: [/punch_right|^punch|kick/],
  block: [/sword_block|^block|shield_oneshot|idle_shield/],
  dodge: [/^roll|dodge|duck|ninjajump/],
  hit: [/re(c|ce)ie?ve_?hit|hitreact|hit_?re(c|ce)ie?ve(_1)?|^hit$|_hit$|^hit_|knockback/],
  death: [/death|^die|dying/],
  victory: [/victory|cheer|^dance$|celebrat/],
  wave: [/wave|hello/],
  talk: [/talk|^yes$|^interact/],
  point: [/^point|interact/],
  jump: [/^jump$|jump_?start|^jump/],
  roar: [/roar|^no$|headbutt|attack2/],
  item: [/consume|pickup|pick_?up|interact/],
  spin: [/spin|sword_heavy_combo|run_swordattack|sword_regular_combo/],
  sit: [/sitting_idle|^sit/],
  yes: [/^yes$|nod/],
  no: [/^no$|shake/],
};
// states that fall back to another clip state before going procedural
const FALLBACK = { attack_heavy: "attack", attack_fast: "attack", spin: "attack_heavy", punch: "attack", bash: "attack", roar: "attack",
  cast_big: "cast", shoot: null, combat_idle: "idle", run: "walk", talk: "idle", throw: "attack_fast" };
const GESTURE = new Set(["wave", "point", "talk", "yes", "no", "item", "victory", "jump", "roar", "sit"]);
const ALIAS = { bash: "attack_heavy", throw: "attack_fast", buff: "cast", heal: "cast", flee: "run", run_away: "run", interact: "item" };

const clean = (n) => n.replace(/^.*\|/, "").replace(/^(female|male|trex|bat|dragon|skeleton|slime|spider|snake|frog|rat|wasp|apatosaurus|parasaurolophus|stegosaurus|triceratops|velociraptor|character|armature)_/i, "").toLowerCase();

/** remove sideways root motion so the game stays in charge of where characters are */
function sanitize(clip, root) {
  const tops = new Set();
  root.traverse((o) => { if (o.isBone && !(o.parent && o.parent.isBone)) tops.add(o.name); });
  for (const t of clip.tracks) {
    const [node, prop] = t.name.split(".");
    if (prop !== "position" || !tops.has(node)) continue;
    const v = t.values;
    for (let i = 3; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
  }
  return clip;
}

// ---------------- finding bones (three.js removes the dots from names: "UpperArm.R" -> "UpperArmR") ----------------
// each role: regexes in order of preference (the first regex that matches any bone wins)
const ROLE = {
  pelvis: [/^hips$/i, /^pelvis$/i],
  spine: [/^abdomen$/i, /^spine\.?0?01$/i, /^spine_?01$/i, /^spine1$/i, /^spine$/i, /^body1$/i],
  chest: [/^chest$/i, /^upperchest$/i, /^torso$/i, /^spine\.?00[23]$/i, /^spine_?0?[23]$/i],
  neck: [/^neck(_?0?1)?$/i, /^spine\.?004$/i],
  head: [/^head$/i, /^spine\.?006$/i, /^spine\.?005$/i],
  shoulderR: [/^(shoulder|clavicle)[._]?r$/i], shoulderL: [/^(shoulder|clavicle)[._]?l$/i],
  armR: [/^upper_?arm[._]?r$/i, /^arm[._]?r$/i], armL: [/^upper_?arm[._]?l$/i, /^arm[._]?l$/i],
  foreR: [/^(fore_?arm|lower_?arm)[._]?r$/i], foreL: [/^(fore_?arm|lower_?arm)[._]?l$/i],
  handR: [/^(hand|wrist)[._]?r$/i, /^fist[._]?r$/i], handL: [/^(hand|wrist)[._]?l$/i, /^fist[._]?l$/i],
  thighR: [/^(upper_?leg|thigh)[._]?r$/i, /^leg[._]?r$/i], thighL: [/^(upper_?leg|thigh)[._]?l$/i, /^leg[._]?l$/i],
  shinR: [/^(lower_?leg|shin|calf)[._]?r$/i], shinL: [/^(lower_?leg|shin|calf)[._]?l$/i],
  footR: [/^foot[._]?r$/i], footL: [/^foot[._]?l$/i],
  jaw: [/^jaw/i],
  wingL: [/^wing1?\.?l$/i], wingR: [/^wing1?\.?r$/i],
};
const FINGER = { R: /^((f_)?(index|middle|ring|pinky)\d+|fist\d+)[._]?r$/i, L: /^((f_)?(index|middle|ring|pinky)\d+|fist\d+)[._]?l$/i };
const THUMB = { R: /^thumb\d+[._]?r$/i, L: /^thumb\d+[._]?l$/i };
const CHAIN = { tail: /^tail\d*$/i, earL: /^ear\d*[._]?l$/i, earR: /^ear\d*[._]?r$/i };

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pw = new THREE.Quaternion(), _aq = new THREE.Quaternion(), _qa = new THREE.Quaternion();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const bell = (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ======================================================================================= procedural one-shots
// t = 0..1 progress. Return {bone: [[axis, angle], ...]} (character frame: x+ = lean/bow forward, arm x- = raise forward,
// arm z- = raise sideways, forearm x- = bend the elbow), fingersR/L (0 open .. 1 fist, <0 spread), pelvis {drop, z, x},
// and body {x,y,z,spin,fall} offsets of the whole model.
const PROC = {
  attack: { dur: 0.8, impact: 0.47, f: (t) => {
    const wind = ease(t / 0.36), swing = ease((t - 0.36) / 0.2), back = ease((t - 0.7) / 0.3), k = 1 - back;
    const a = wind * (1 - swing) * -2.1 + swing * k * 0.85;
    return { pelvis: { drop: 0.05 * bell(t), z: 0.1 * swing * k }, hips: [["y", (0.35 * wind - 0.6 * swing) * k]],
             chest: [["y", (wind - swing * 1.7) * 0.42 * k], ["x", swing * 0.25 * k]], neck: [["y", -0.2 * (wind - swing) * k]],
             shoulderR: [["z", -0.25 * wind * k]], armR: [["x", a], ["z", -0.4 * bell(t)]], foreR: [["x", -0.9 * wind * (1 - swing) - 0.15 * k]],
             handR: [["x", 0.5 * swing * k]], armL: [["x", 0.35 * swing * k], ["z", -0.3 * wind * k]], foreL: [["x", -0.6 * k * wind]],
             fingersR: 1, fingersL: 0.6 * k, body: { z: 0.28 * swing * k } };
  } },
  attack_heavy: { dur: 1.05, impact: 0.57, f: (t) => {
    const up = ease(t / 0.45), down = ease((t - 0.45) / 0.16), back = ease((t - 0.75) / 0.25), k = 1 - back;
    const a = up * (1 - down) * -2.8 + down * k * 0.75;
    return { pelvis: { drop: (0.04 * up + 0.12 * down) * k, z: 0.12 * down * k }, chest: [["x", (-0.3 * up + 0.6 * down) * k]], head: [["x", (-0.25 * up + 0.2 * down) * k]],
             shoulderR: [["z", -0.3 * up * k]], shoulderL: [["z", -0.3 * up * k]], armR: [["x", a]], armL: [["x", a * 0.9]],
             foreR: [["x", -0.6 * up * (1 - down)]], foreL: [["x", -0.6 * up * (1 - down)]], fingersR: 1, fingersL: 1, stance: 0.06 * k,
             body: { z: 0.35 * down * k, y: -0.06 * down * k } };
  } },
  cast: { dur: 1.0, impact: 0.6, f: (t) => {
    const gather = ease(t / 0.5), release = ease((t - 0.55) / 0.15), back = ease((t - 0.78) / 0.22), k = 1 - back;
    return { pelvis: { drop: 0.03 * gather * (1 - release) }, chest: [["x", (0.15 * gather - 0.3 * release) * k]], head: [["x", (0.2 * gather - 0.3 * release) * k]],
             armR: [["x", (-0.6 * gather - 0.9 * release) * k], ["z", 0.35 * gather * (1 - release) * k]], foreR: [["x", -1.1 * gather * (1 - release) * k]],
             armL: [["x", (-0.6 * gather - 0.7 * release) * k], ["z", 0.35 * gather * (1 - release) * k]], foreL: [["x", -1.1 * gather * (1 - release) * k]],
             handR: [["x", -0.5 * release * k]], handL: [["x", -0.5 * release * k]], fingersR: (0.5 * gather - 1.0 * release) * k, fingersL: (0.5 * gather - 1.0 * release) * k,
             body: { y: 0.04 * release * k } };
  } },
  cast_big: { dur: 1.35, impact: 0.7, f: (t) => {
    const rise = ease(t / 0.6), slam = ease((t - 0.62) / 0.12), back = ease((t - 0.8) / 0.2), k = 1 - back;
    return { chest: [["x", (-0.35 * rise + 0.5 * slam) * k]], head: [["x", (-0.45 * rise + 0.35 * slam) * k]], neck: [["x", -0.15 * rise * k]],
             shoulderR: [["z", -0.3 * rise * k]], shoulderL: [["z", -0.3 * rise * k]],
             armR: [["x", (-2.7 * rise + 1.6 * slam) * k], ["z", -0.35 * rise * k]], armL: [["x", (-2.7 * rise + 1.6 * slam) * k], ["z", -0.35 * rise * k]],
             foreR: [["x", -0.2 * rise * k]], foreL: [["x", -0.2 * rise * k]], fingersR: -1 * rise * (1 - slam) + slam, fingersL: -1 * rise * (1 - slam) + slam,
             pelvis: { drop: 0.1 * slam * k }, stance: 0.07 * k, body: { y: 0.12 * rise * (1 - slam) } };
  } },
  shoot: { dur: 0.95, impact: 0.64, f: (t) => {
    const aim = ease(t / 0.4), rel = ease((t - 0.62) / 0.08), back = ease((t - 0.8) / 0.2), k = 1 - back;
    return { hips: [["y", 0.5 * aim * k]], chest: [["y", 0.35 * aim * k]], head: [["y", -0.45 * aim * k]],
             armL: [["x", -1.55 * aim * k], ["y", 0.3 * aim * k]], foreL: [["x", -0.05 * k]], fingersL: 0.8 * k,
             armR: [["x", -1.45 * aim * k], ["y", 0.5 * aim * k]], foreR: [["y", 1.3 * aim * (1 - rel) * k]], fingersR: (1 - rel) * k - 0.4 * rel * k,
             stance: 0.08 * k };
  } },
  hit: { dur: 0.5, impact: 0.1, f: (t) => {
    const e = bell(Math.min(1, t * 1.6)) * (1 - t * 0.3);
    return { pelvis: { drop: 0.04 * e, z: -0.08 * e }, chest: [["x", -0.5 * e], ["y", 0.2 * e]], neck: [["x", -0.25 * e]], head: [["x", -0.35 * e], ["z", 0.15 * e]],
             shoulderR: [["z", -0.25 * e]], shoulderL: [["z", -0.25 * e]], armR: [["z", -0.4 * e], ["x", 0.2 * e]], armL: [["z", -0.4 * e], ["x", 0.2 * e]],
             foreR: [["x", -0.5 * e]], foreL: [["x", -0.5 * e]], fingersR: -0.6 * e, fingersL: -0.6 * e, body: { z: -0.32 * e } };
  } },
  block: { dur: 0.85, impact: 0.3, f: (t) => {
    const e = ease(t / 0.18) * (1 - ease((t - 0.75) / 0.25));
    return { pelvis: { drop: 0.07 * e }, chest: [["x", 0.2 * e]], head: [["x", 0.15 * e]], armR: [["x", -1.3 * e], ["z", 0.4 * e]], armL: [["x", -1.3 * e], ["z", 0.4 * e]],
             foreR: [["x", -1.3 * e]], foreL: [["x", -1.3 * e]], fingersR: e, fingersL: e, stance: 0.07 * e, body: { y: -0.05 * e } };
  } },
  dodge: { dur: 0.65, impact: 0.3, f: (t) => { const e = bell(t); return { pelvis: { drop: 0.12 * e }, chest: [["z", 0.5 * e], ["x", 0.2 * e]], head: [["z", -0.2 * e]], armR: [["z", -0.6 * e]], armL: [["z", -0.3 * e]], body: { x: -0.75 * e, y: -0.08 * e } }; } },
  death: { dur: 1.4, impact: 0.2, hold: true, f: (t) => {
    const e = ease(t / 0.9), buck = bell(Math.min(1, t * 3));
    return { chest: [["x", 0.3 * e - 0.3 * buck]], head: [["x", 0.45 * e], ["z", 0.3 * e]], armR: [["z", -0.7 * e]], armL: [["z", -0.6 * e]], foreR: [["x", -0.4 * e]],
             fingersR: -0.3 * e, fingersL: -0.3 * e, body: { fall: e, y: -0.05 * e } };
  } },
  victory: { dur: 1.4, impact: 0.5, f: (t) => {
    const e = bell(t), j = Math.max(0, Math.sin(t * Math.PI * 2)) * 0.3;
    return { armR: [["x", -2.8 * e]], armL: [["x", -2.8 * e]], foreR: [["x", -0.3 * e]], foreL: [["x", -0.3 * e]], head: [["x", -0.25 * e]], chest: [["x", -0.15 * e]],
             fingersR: e, fingersL: e, body: { y: j } };
  } },
  wave: { dur: 1.5, impact: 0.5, f: (t) => {
    const e = ease(t / 0.2) * (1 - ease((t - 0.8) / 0.2));
    return { armR: [["x", -0.3 * e], ["z", -2.3 * e]], foreR: [["x", -0.4 * e], ["z", Math.sin(t * 18) * 0.45 * e]], head: [["z", -0.12 * e]], chest: [["z", 0.06 * e]], fingersR: -0.5 * e };
  } },
  point: { dur: 1.0, impact: 0.4, f: (t) => { const e = bell(t); return { armR: [["x", -1.55 * e]], head: [["y", 0.1 * e]], chest: [["y", 0.15 * e]], fingersR: 0.9 * e }; } },
  jump: { dur: 0.8, impact: 0.5, f: (t) => ({ pelvis: { drop: 0.15 * bell(Math.min(1, t * 4)) * (t < 0.25 ? 1 : 0) }, body: { y: Math.max(0, Math.sin(Math.PI * (t - 0.1) / 0.8)) * 0.6 }, armR: [["x", -1.2 * bell(t)]], armL: [["x", -1.2 * bell(t)]] }) },
  roar: { dur: 1.2, impact: 0.45, f: (t) => { const e = bell(t), sh = Math.sin(t * 40) * 0.04 * e; return { chest: [["x", -0.45 * e]], neck: [["x", -0.2 * e]], head: [["x", -0.5 * e + sh]], jaw: [["x", 0.5 * e]], armR: [["z", -1.0 * e], ["x", -0.3 * e]], armL: [["z", -1.0 * e], ["x", -0.3 * e]], foreR: [["x", -0.9 * e]], foreL: [["x", -0.9 * e]], fingersR: -0.8 * e, fingersL: -0.8 * e, stance: 0.06 * e }; } },
  item: { dur: 0.95, impact: 0.55, f: (t) => { const e = bell(t); return { pelvis: { drop: 0.1 * e }, chest: [["x", 0.35 * e]], armR: [["x", -1.6 * e]], foreR: [["x", -1.4 * e]], head: [["x", 0.25 * e]], fingersR: 0.7 * e }; } },
  spin: { dur: 1.0, impact: 0.55, f: (t) => ({ body: { spin: ease(t) * Math.PI * 2 }, pelvis: { drop: 0.08 * bell(t) }, armR: [["z", -1.4 * bell(t)]], armL: [["z", -1.4 * bell(t)]], fingersR: 1 }) },
  punch: { dur: 0.6, impact: 0.42, f: (t) => { const wind = ease(t / 0.35), hit = ease((t - 0.35) / 0.12), back = ease((t - 0.6) / 0.4), k = 1 - back;
    return { hips: [["y", (0.3 * wind - 0.5 * hit) * k]], chest: [["y", (0.4 * wind - 0.7 * hit) * k]], armR: [["x", (-0.4 * wind - 1.1 * hit) * k]], foreR: [["x", (-1.6 * wind * (1 - hit) - 0.1) * k]],
             armL: [["x", -0.8 * k], ["z", 0.2 * k]], foreL: [["x", -1.6 * k]], fingersR: 1, fingersL: 1, body: { z: 0.22 * hit * k } }; } },
  yes: { dur: 0.9, impact: 0.5, f: (t) => ({ head: [["x", Math.sin(t * Math.PI * 4) * 0.25 * bell(t)]], neck: [["x", Math.sin(t * Math.PI * 4) * 0.08]] }) },
  no: { dur: 0.9, impact: 0.5, f: (t) => ({ head: [["y", Math.sin(t * Math.PI * 4) * 0.35 * bell(t)]] }) },
  talk: { dur: 2.0, impact: 0.5, f: (t) => ({ armR: [["x", -0.5 * bell(t)], ["z", -0.15 * Math.sin(t * 9)]], foreR: [["x", -0.8 * bell(t)]], head: [["y", Math.sin(t * 5) * 0.1]], fingersR: -0.3 * bell(t) }) },
};
PROC.attack_fast = { ...PROC.attack, dur: 0.58, impact: 0.42 };
PROC.bash = PROC.attack_heavy;
PROC.throw = PROC.attack_fast;

// ---- one attack per weapon, so a rogue, a ranger and a paladin don't all swing the same way
// dagger: two quick stabs, right then left, low and close
PROC.stab = { dur: 0.75, impact: 0.36, f: (t) => {
  const s1 = bell(Math.min(1, t / 0.4)), s2 = bell(Math.max(0, (t - 0.38) / 0.4)), crouch = bell(t);
  return { pelvis: { drop: 0.09 * crouch, z: 0.12 * (s1 + s2) }, chest: [["x", 0.35 * crouch], ["y", 0.35 * (s1 - s2)]],
           armR: [["x", -1.35 * s1 - 0.2], ["z", -0.15 * s1]], foreR: [["x", -1.3 * (1 - s1) - 0.1]], handR: [["x", 0.4 * s1]],
           armL: [["x", -1.35 * s2 - 0.2], ["z", 0.15 * s2]], foreL: [["x", -1.3 * (1 - s2) - 0.1]], handL: [["x", 0.4 * s2]],
           fingersR: 1, fingersL: 1, stance: 0.08 * crouch, body: { z: 0.3 * Math.max(s1, s2) } };
} };
// spear: step in and a long straight thrust
PROC.thrust = { dur: 0.85, impact: 0.5, f: (t) => {
  const pull = ease(t / 0.4), jab = ease((t - 0.4) / 0.12), back = ease((t - 0.65) / 0.35), k = 1 - back;
  return { hips: [["y", (0.4 * pull - 0.5 * jab) * k]], chest: [["y", (0.35 * pull - 0.5 * jab) * k], ["x", 0.2 * jab * k]],
           armR: [["x", (-0.6 * pull - 0.9 * jab) * k]], foreR: [["x", (-1.4 * pull * (1 - jab) - 0.1) * k]],
           armL: [["x", (-1.1 + 0.2 * pull) * k]], foreL: [["x", -0.6 * k]], fingersR: 1, fingersL: 1, stance: 0.1 * k, body: { z: 0.5 * jab * k } };
} };
// hammer / mace: lifted high over the head, smashed straight down
PROC.smash = { dur: 1.0, impact: 0.55, f: (t) => {
  const up = ease(t / 0.45), down = ease((t - 0.45) / 0.12), back = ease((t - 0.72) / 0.28), k = 1 - back;
  return { pelvis: { drop: (0.03 * up + 0.16 * down) * k }, chest: [["x", (-0.35 * up + 0.75 * down) * k]], head: [["x", (-0.3 * up + 0.25 * down) * k]],
           shoulderR: [["z", -0.35 * up * k]], armR: [["x", (-3.0 * up * (1 - down) + 0.4 * down) * k]], foreR: [["x", -0.5 * up * (1 - down) * k]],
           armL: [["x", -0.6 * k], ["z", 0.3 * up * k]], foreL: [["x", -1.2 * k]], fingersR: 1, fingersL: 0.8, stance: 0.08 * k, body: { z: 0.3 * down * k, y: -0.05 * down * k } };
} };
// axe: a big diagonal chop from over the shoulder
PROC.chop = { dur: 0.95, impact: 0.52, f: (t) => {
  const wind = ease(t / 0.42), cut = ease((t - 0.42) / 0.14), back = ease((t - 0.7) / 0.3), k = 1 - back;
  return { hips: [["y", (0.5 * wind - 0.8 * cut) * k]], chest: [["y", (0.55 * wind - 0.9 * cut) * k], ["x", (-0.15 * wind + 0.45 * cut) * k], ["z", 0.2 * cut * k]],
           shoulderR: [["z", -0.3 * wind * k]], armR: [["x", (-2.4 * wind * (1 - cut) + 0.3 * cut) * k], ["z", (-0.7 * wind + 0.5 * cut) * k]],
           foreR: [["x", -0.7 * wind * (1 - cut) * k]], armL: [["x", -0.5 * k]], fingersR: 1, stance: 0.07 * k, body: { z: 0.3 * cut * k } };
} };
// staff: held in both hands and swung in a wide arc (casters cast with "cast")
PROC.staff_strike = { dur: 1.0, impact: 0.55, f: (t) => {
  const wind = ease(t / 0.42), swing = ease((t - 0.42) / 0.18), back = ease((t - 0.72) / 0.28), k = 1 - back;
  const a = (-1.3 * wind * (1 - swing) - 0.4 * swing) * k;
  return { hips: [["y", (-0.45 * wind + 0.6 * swing) * k]], chest: [["y", (-0.6 * wind + 0.9 * swing) * k]],
           armR: [["x", a], ["z", -0.3 * wind * k]], armL: [["x", a * 0.9], ["z", 0.3 * swing * k]], foreR: [["x", -0.8 * k]], foreL: [["x", -1.0 * k]],
           fingersR: 1, fingersL: 1, stance: 0.06 * k, body: { z: 0.25 * swing * k } };
} };
// shield: a shove with the left arm, shoulder first
PROC.shield_bash = { dur: 0.8, impact: 0.45, f: (t) => {
  const brace = ease(t / 0.35), shove = ease((t - 0.35) / 0.12), back = ease((t - 0.6) / 0.4), k = 1 - back;
  return { pelvis: { drop: 0.08 * brace * k }, hips: [["y", (-0.4 * brace + 0.3 * shove) * k]], chest: [["y", (-0.5 * brace + 0.4 * shove) * k], ["x", 0.25 * shove * k]],
           armL: [["x", (-1.2 * brace - 0.3 * shove) * k], ["z", 0.3 * k]], foreL: [["x", -1.4 * brace * (1 - shove) * k - 0.3 * shove * k]],
           armR: [["x", -0.4 * k]], fingersR: 1, fingersL: 1, stance: 0.09 * k, body: { z: 0.45 * shove * k } };
} };

// bodies without a usable arm/leg rig: whole-body motion
const BLOB = {
  idle: (t) => ({ sy: 1 + Math.sin(t * 2.4) * 0.035, sx: 1 - Math.sin(t * 2.4) * 0.02, y: 0 }),
  walk: (t) => ({ sy: 1 + Math.abs(Math.sin(t * 9)) * 0.08, y: Math.abs(Math.sin(t * 9)) * 0.18, rz: Math.sin(t * 9) * 0.06 }),
  attack: (p) => ({ z: Math.sin(Math.PI * Math.min(1, p * 1.4)) * 0.9, sy: 1 - bell(p) * 0.15, sx: 1 + bell(p) * 0.1 }),
  hit: (p) => ({ z: -bell(p) * 0.4, sy: 1 - bell(p) * 0.2, rz: Math.sin(p * 30) * 0.08 * (1 - p) }),
  death: (p) => ({ fall: ease(p), sy: 1 - ease(p) * 0.4, y: 0 }),
  cast: (p) => ({ sy: 1 + bell(p) * 0.2, y: bell(p) * 0.3 }),
  victory: (p) => ({ y: Math.abs(Math.sin(p * Math.PI * 3)) * 0.5 }),
};

// ======================================================================================= emotes (keyframed)
// keys: [[time 0..1, pose], ...]; poses blend smoothly. A pose is the same shape as PROC poses.
const K = (dur, keys, impact = 0.5) => ({ dur, keys, impact });
// a hand placed by arm IK: at a body landmark (shoulder, head, brow, chin, chest, belly, pelvis) + offset
// [outward, up, forward] in shoulder-widths; pole = which way the elbow points [outward, up, forward]
const IK = (at, off, pole = [1, -0.6, -0.2], w = 1) => ({ at, x: off[0], y: off[1], z: off[2], px: pole[0], py: pole[1], pz: pole[2], w });
const EMOTE = {
  wave_friendly: K(1.8, [[0, {}], [0.18, { ikR: IK("shoulder", [0.55, 0.75, 0.15], [1, -0.6, -0.3]), head: [["z", -0.12]], fingersR: -0.7 }],
    ...[0.3, 0.42, 0.54, 0.66, 0.78].map((t, i) => [t, { ikR: IK("shoulder", [i % 2 ? 0.75 : 0.35, 0.75, 0.15], [1, -0.6, -0.3]), head: [["z", i % 2 ? -0.14 : -0.08]], chest: [["z", 0.04]], fingersR: -0.7 }]), [1, {}]]),
  bow_graceful: K(2.2, [[0, {}], [0.25, { ikR: IK("chest", [-0.05, 0.02, 0.15], [1, -0.6, 0.2]), fingersR: -0.4, armL: [["z", -0.45], ["x", 0.35]], fingersL: -0.4, head: [["x", 0.1]] }],
    [0.5, { pelvis: { drop: 0.03 }, spine: [["x", 0.25]], chest: [["x", 0.35]], head: [["x", 0.3]], ikR: IK("chest", [-0.05, 0.02, 0.15], [1, -0.6, 0.2]), fingersR: -0.4, armL: [["z", -0.6], ["x", 0.5]], fingersL: -0.4 }],
    [0.75, { spine: [["x", 0.25]], chest: [["x", 0.35]], head: [["x", 0.3]], ikR: IK("chest", [-0.05, 0.02, 0.15], [1, -0.6, 0.2]), armL: [["z", -0.6], ["x", 0.5]] }], [1, {}]]),
  salute_stout: K(2.0, [[0, {}], [0.2, { stance: 0.05, chest: [["x", -0.12]], head: [["x", -0.1]], ikR: IK("brow", [0.25, 0.0, 0.1], [1, 0.2, -0.2]), fingersR: -0.3 }],
    [0.55, { stance: 0.05, chest: [["x", -0.12]], head: [["x", -0.1]], ikR: IK("brow", [0.25, 0.0, 0.1], [1, 0.2, -0.2]), fingersR: -0.3 }],
    [0.68, { stance: 0.05, ikR: IK("chest", [-0.05, 0.05, 0.12], [1, -0.4, 0]), fingersR: 1, chest: [["x", 0.05]] }], [0.78, { stance: 0.05, ikR: IK("chest", [-0.05, 0.05, 0.08], [1, -0.4, 0]), fingersR: 1, chest: [["x", -0.06]] }], [1, {}]]),
  cackle_hop: K(1.6, [[0, {}], [0.15, { pelvis: { drop: 0.1 }, spine: [["x", 0.3]], armR: [["x", -0.9]], armL: [["x", -0.9]], foreR: [["x", -1.6]], foreL: [["x", -1.6]], fingersR: 0.6, fingersL: 0.6 }],
    [0.3, { body: { y: 0.18 }, spine: [["x", 0.1]], head: [["x", -0.3]], armR: [["x", -0.9], ["z", -0.5]], armL: [["x", -0.9], ["z", -0.5]], foreR: [["x", -1.2]], foreL: [["x", -1.2]], fingersR: -0.6, fingersL: -0.6 }],
    [0.45, { pelvis: { drop: 0.1 }, spine: [["x", 0.3]], head: [["x", -0.2], ["z", 0.2]], armR: [["x", -1.0]], armL: [["x", -1.0]], foreR: [["x", -1.7]], foreL: [["x", -1.7]], fingersR: 0.8, fingersL: 0.8 }],
    [0.6, { pelvis: { drop: 0.08 }, spine: [["x", 0.3]], head: [["x", -0.25], ["z", -0.2]], armR: [["x", -1.0]], armL: [["x", -1.0]], foreR: [["x", -1.7]], foreL: [["x", -1.7]], fingersR: 0.8, fingersL: 0.8 }], [1, {}]]),
  chest_beat: K(2.0, [[0, {}], [0.12, { stance: 0.07, chest: [["x", -0.25]], head: [["x", -0.25]], ikR: IK("chest", [0.25, 0.1, 0.45], [1, -0.5, -0.3]), ikL: IK("chest", [0.25, 0.1, 0.45], [1, -0.5, -0.3]), fingersR: 1, fingersL: 1 }],
    ...[0.22, 0.32, 0.42, 0.52].map((t, i) => [t, { stance: 0.07, chest: [["x", -0.3]], head: [["x", -0.3]], ikR: IK("chest", i % 2 ? [0.25, 0.1, 0.45] : [0.05, 0.05, 0.1], [1, -0.5, -0.3]), ikL: IK("chest", i % 2 ? [0.05, 0.05, 0.1] : [0.25, 0.1, 0.45], [1, -0.5, -0.3]), fingersR: 1, fingersL: 1 }]),
    [0.66, { stance: 0.08, pelvis: { drop: 0.03 }, chest: [["x", -0.45]], neck: [["x", -0.2]], head: [["x", -0.45]], jaw: [["x", 0.5]], armR: [["z", -1.1], ["x", -0.2]], foreR: [["x", -1.0]], armL: [["z", -1.1], ["x", -0.2]], foreL: [["x", -1.0]], fingersR: 1, fingersL: 1 }],
    [0.84, { stance: 0.08, chest: [["x", -0.4]], head: [["x", -0.4]], jaw: [["x", 0.45]], armR: [["z", -1.0]], foreR: [["x", -1.0]], armL: [["z", -1.0]], foreL: [["x", -1.0]], fingersR: 1, fingersL: 1 }], [1, {}]]),
  creepy_bow: K(2.2, [[0, {}], [0.2, { head: [["z", 0.6], ["x", 0.2]], neck: [["z", 0.2]] }], [0.35, { head: [["z", 0.65], ["x", 0.25]], neck: [["z", 0.25]], jaw: [["x", 0.35]] }],
    [0.6, { spine: [["x", 0.45]], chest: [["x", 0.3]], head: [["z", 0.3], ["x", 0.4]], armR: [["x", -0.4], ["z", -0.5]], armL: [["x", -0.4], ["z", -0.5]], foreR: [["x", -0.4]], foreL: [["x", -0.4]], fingersR: -0.9, fingersL: -0.9 }],
    [0.8, { spine: [["x", 0.45]], chest: [["x", 0.3]], head: [["z", -0.3], ["x", 0.4]], armR: [["x", -0.4], ["z", -0.5]], armL: [["x", -0.4], ["z", -0.5]], fingersR: -0.9, fingersL: -0.9 }], [1, {}]]),
  sniff_wave: K(2.0, [[0, {}], [0.12, { neck: [["x", -0.3]], head: [["x", -0.35], ["y", 0.3]], ears: [["x", -0.5]] }], [0.24, { neck: [["x", -0.3]], head: [["x", -0.4], ["y", -0.3]], ears: [["x", -0.6]] }],
    [0.36, { neck: [["x", -0.25]], head: [["x", -0.3], ["y", 0.1]], ears: [["x", -0.4]] }], [0.5, { head: [["z", -0.25]], tail: [["y", 0.8]], armR: [["x", -0.4], ["z", -2.2]], foreR: [["x", -0.5], ["z", 0.4]], fingersR: -0.6 }],
    [0.65, { head: [["z", -0.25]], tail: [["y", -0.8]], armR: [["x", -0.4], ["z", -2.2]], foreR: [["x", -0.5], ["z", -0.4]], fingersR: -0.6 }], [0.8, { head: [["z", -0.2]], tail: [["y", 0.8]], armR: [["x", -0.4], ["z", -2.2]], foreR: [["x", -0.5], ["z", 0.3]], fingersR: -0.6 }], [1, {}]]),
  proud_nod: K(1.8, [[0, {}], [0.25, { chest: [["x", -0.25]], neck: [["x", -0.15]], head: [["x", -0.3]], armR: [["z", -0.35]], armL: [["z", -0.35]], foreR: [["x", -0.6]], foreL: [["x", -0.6]], fingersR: -0.8, fingersL: -0.8, tail: [["y", 0.5]] }],
    [0.55, { chest: [["x", -0.2]], head: [["x", 0.25]], armR: [["z", -0.35]], armL: [["z", -0.35]], foreR: [["x", -0.7]], foreL: [["x", -0.7]], fingersR: 1, fingersL: 1, tail: [["y", -0.5]] }],
    [0.75, { chest: [["x", -0.2]], head: [["x", -0.1]], fingersR: 0.8, fingersL: 0.8 }], [1, {}]]),
  sinister_bow: K(2.2, [[0, {}], [0.3, { chest: [["x", 0.35]], head: [["x", 0.1], ["z", 0.25]], armR: [["x", -1.0], ["z", 0.6]], foreR: [["x", -1.3]], fingersR: -0.7, armL: [["x", 0.4], ["z", -0.6]], fingersL: -0.8 }],
    [0.6, { chest: [["x", 0.4]], head: [["x", -0.25], ["z", 0.3]], armR: [["x", -1.0], ["z", 0.6]], foreR: [["x", -1.3]], fingersR: 0.4, armL: [["x", 0.4], ["z", -0.6]], fingersL: 0.4 }],
    [0.8, { chest: [["x", 0.1]], head: [["x", -0.2], ["z", -0.15]], fingersR: 1, fingersL: 1 }], [1, {}]]),
  cute_wave: K(1.9, [[0, {}], [0.15, { head: [["z", 0.25]], chest: [["z", -0.08]], ikR: IK("shoulder", [0.5, 0.8, 0.2], [1, -0.5, -0.3]), fingersR: -0.8, ikL: IK("chest", [0.05, -0.05, 0.12], [1, -0.4, -0.3]), fingersL: 0.6, body: { y: 0.04 } }],
    ...[0.28, 0.41, 0.54, 0.67].map((t, i) => [t, { head: [["z", i % 2 ? 0.3 : 0.22]], chest: [["z", -0.08]], ikR: IK("shoulder", [i % 2 ? 0.7 : 0.32, 0.8, 0.2], [1, -0.5, -0.3]), fingersR: -0.8, ikL: IK("chest", [0.05, -0.05, 0.12], [1, -0.4, -0.3]), fingersL: 0.6, body: { y: i % 2 ? 0 : 0.04 } }]), [1, {}]]),
  look_around: K(3.2, [[0, {}], [0.2, { neck: [["y", 0.3]], head: [["y", 0.45]], chest: [["y", 0.12]] }], [0.45, { neck: [["y", 0.3]], head: [["y", 0.45], ["x", -0.1]] }],
    [0.65, { neck: [["y", -0.3]], head: [["y", -0.5]], chest: [["y", -0.12]] }], [0.85, { neck: [["y", -0.25]], head: [["y", -0.4]] }], [1, {}]]),
  shift_weight: K(3.0, [[0, {}], [0.3, { pelvis: { x: 0.06, drop: 0.015 }, hips: [["z", 0.08]], chest: [["z", -0.06]], head: [["z", 0.04]] }], [0.7, { pelvis: { x: 0.06, drop: 0.015 }, hips: [["z", 0.08]], chest: [["z", -0.06]] }], [1, {}]]),
  stretch: K(2.8, [[0, {}], [0.3, { chest: [["x", -0.3]], neck: [["x", -0.2]], head: [["x", -0.35]], armR: [["x", -2.9]], armL: [["x", -2.9]], foreR: [["x", -0.2]], foreL: [["x", -0.2]], fingersR: -0.9, fingersL: -0.9, body: { y: 0.03 } }],
    [0.55, { chest: [["x", -0.25], ["z", 0.15]], head: [["x", -0.3]], armR: [["x", -2.9]], armL: [["x", -2.9]], fingersR: -0.9, fingersL: -0.9 }], [0.7, { chest: [["x", -0.25], ["z", -0.15]], armR: [["x", -2.8]], armL: [["x", -2.8]] }], [1, {}]]),
  check_hands: K(2.4, [[0, {}], [0.3, { head: [["x", 0.45]], neck: [["x", 0.15]], ikR: IK("chest", [0.15, -0.35, 0.45], [1, -1, 0]), fingersR: -0.7, ikL: IK("chest", [0.15, -0.35, 0.45], [1, -1, 0]), fingersL: 0.2 }],
    [0.6, { head: [["x", 0.45], ["y", 0.1]], ikR: IK("chest", [0.15, -0.35, 0.45], [1, -1, 0]), fingersR: 0.9, ikL: IK("chest", [0.15, -0.35, 0.45], [1, -1, 0]), fingersL: -0.7 }], [1, {}]]),
  hair_touch: K(2.4, [[0, {}], [0.3, { head: [["z", -0.2], ["y", 0.15]], ikR: IK("head", [0.45, 0.15, 0.0], [1, -0.4, 0.1]), fingersR: -0.3, chest: [["z", 0.05]] }],
    [0.55, { head: [["z", -0.12], ["y", 0.25]], ikR: IK("head", [0.45, 0.0, -0.05], [1, -0.4, 0.1]), fingersR: 0.4 }], [1, {}]]),
  look_sky: K(3.0, [[0, {}], [0.35, { chest: [["x", -0.1]], neck: [["x", -0.3]], head: [["x", -0.45], ["y", 0.15]] }], [0.75, { chest: [["x", -0.1]], neck: [["x", -0.3]], head: [["x", -0.4], ["y", -0.1]] }], [1, {}]]),
  beard_stroke: K(3.0, [[0, {}], [0.25, { head: [["x", -0.1], ["y", 0.15]], ikR: IK("chin", [0.0, -0.05, 0.08], [1, -0.7, -0.2]), fingersR: 0.5, ikL: IK("belly", [0.0, 0.1, 0.25], [1, -0.6, 0]), fingersL: 1 }],
    [0.45, { head: [["x", -0.05], ["y", 0.2]], ikR: IK("chin", [0.0, -0.18, 0.08], [1, -0.7, -0.2]), fingersR: 0.8, ikL: IK("belly", [0.0, 0.1, 0.25], [1, -0.6, 0]), fingersL: 1 }],
    [0.65, { head: [["x", -0.1], ["y", 0.1]], ikR: IK("chin", [0.0, -0.05, 0.08], [1, -0.7, -0.2]), fingersR: 0.5, ikL: IK("belly", [0.0, 0.1, 0.25], [1, -0.6, 0]), fingersL: 1 }], [1, {}]]),
  hands_on_hips: K(3.2, [[0, {}], [0.2, { stance: 0.05, chest: [["x", -0.1]], head: [["x", -0.1]], ikR: IK("pelvis", [0.5, 0.1, 0.0], [1, 0, -0.5]), fingersR: 0.6, ikL: IK("pelvis", [0.5, 0.1, 0.0], [1, 0, -0.5]), fingersL: 0.6 }],
    [0.8, { stance: 0.05, chest: [["x", -0.12]], head: [["x", -0.1], ["y", 0.2]], ikR: IK("pelvis", [0.5, 0.1, 0.0], [1, 0, -0.5]), fingersR: 0.6, ikL: IK("pelvis", [0.5, 0.1, 0.0], [1, 0, -0.5]), fingersL: 0.6 }], [1, {}]]),
  crack_knuckles: K(2.0, [[0, {}], [0.25, { chest: [["x", 0.1]], head: [["x", 0.25]], ikR: IK("chest", [0.0, -0.2, 0.45], [1, -0.8, 0]), ikL: IK("chest", [0.0, -0.2, 0.45], [1, -0.8, 0]), fingersR: -0.5, fingersL: 1 }],
    [0.4, { chest: [["x", 0.1]], head: [["x", 0.25]], ikR: IK("chest", [0.0, -0.15, 0.5], [1, -0.8, 0]), ikL: IK("chest", [0.0, -0.15, 0.5], [1, -0.8, 0]), fingersR: 1, fingersL: -0.5 }],
    [0.6, { neck: [["z", 0.35]], head: [["z", 0.3]] }], [0.75, { neck: [["z", -0.35]], head: [["z", -0.3]] }], [1, {}]]),
  rub_hands: K(2.2, [[0, {}], [0.2, { pelvis: { drop: 0.03 }, chest: [["x", 0.15]], head: [["x", -0.15]], ikR: IK("chest", [0.0, -0.25, 0.45], [1, -0.8, 0]), ikL: IK("chest", [0.0, -0.25, 0.45], [1, -0.8, 0]), fingersR: 0.3, fingersL: 0.3 }],
    ...[0.32, 0.44, 0.56, 0.68].map((t, i) => [t, { pelvis: { drop: 0.03 }, chest: [["x", 0.15]], head: [["x", -0.15], ["z", i % 2 ? 0.1 : -0.1]], ikR: IK("chest", [0.0, -0.25 + (i % 2) * 0.12, 0.45], [1, -0.8, 0]), ikL: IK("chest", [0.0, -0.13 - (i % 2) * 0.12, 0.45], [1, -0.8, 0]), fingersR: 0.4, fingersL: 0.4 }]), [1, {}]]),
  scratch_head: K(2.2, [[0, {}], [0.25, { head: [["z", 0.2], ["x", 0.1]], ikR: IK("head", [0.15, 0.55, 0.0], [1, 0.3, 0]), fingersR: 0.4 }],
    ...[0.35, 0.45, 0.55, 0.65].map((t, i) => [t, { head: [["z", 0.2], ["x", 0.1]], ikR: IK("head", [0.15 + (i % 2) * 0.12, 0.55, 0.0], [1, 0.3, 0]), fingersR: 0.4 + (i % 2) * 0.4 }]), [1, {}]]),
  peek: K(2.4, [[0, {}], [0.3, { pelvis: { drop: 0.04, x: -0.05 }, chest: [["z", 0.25], ["y", 0.2]], neck: [["y", 0.3]], head: [["y", 0.4], ["z", -0.15]] }], [0.6, { pelvis: { drop: 0.04, x: 0.05 }, chest: [["z", -0.25], ["y", -0.2]], neck: [["y", -0.3]], head: [["y", -0.4], ["z", 0.15]] }], [1, {}]]),
  neck_crack: K(1.8, [[0, {}], [0.25, { neck: [["z", 0.4]], head: [["z", 0.35]], shoulderL: [["z", 0.15]] }], [0.35, { neck: [["z", 0.45]], head: [["z", 0.4]] }], [0.6, { neck: [["z", -0.4]], head: [["z", -0.35]], shoulderR: [["z", 0.15]] }], [0.7, { neck: [["z", -0.45]], head: [["z", -0.4]] }], [1, {}]]),
  flex: K(2.2, [[0, {}], [0.3, { stance: 0.06, chest: [["x", -0.2]], ikR: IK("shoulder", [0.55, 0.55, 0.05], [1, -0.9, -0.2]), fingersR: 1, ikL: IK("shoulder", [0.55, 0.55, 0.05], [1, -0.9, -0.2]), fingersL: 1, head: [["y", 0.35]] }],
    [0.62, { stance: 0.06, chest: [["x", -0.25]], ikR: IK("shoulder", [0.55, 0.62, 0.05], [1, -0.9, -0.2]), fingersR: 1, ikL: IK("shoulder", [0.55, 0.62, 0.05], [1, -0.9, -0.2]), fingersL: 1, head: [["y", -0.35]] }], [1, {}]]),
  head_creak: K(2.6, [[0, {}], [0.15, { head: [["z", 0.5]], neck: [["z", 0.15]], jaw: [["x", 0.2]] }], [0.2, { head: [["z", 0.45]] }], [0.45, { head: [["z", -0.5], ["y", 0.3]], neck: [["z", -0.15]] }], [0.5, { head: [["z", -0.45], ["y", 0.3]], jaw: [["x", 0.35]] }], [0.7, { head: [["y", 0.6]] }], [1, {}]]),
  rattle: K(1.4, [[0, {}], ...Array.from({ length: 9 }, (_, i) => [0.1 + i * 0.09, { chest: [["z", (i % 2 ? 1 : -1) * 0.12]], head: [["z", (i % 2 ? -1 : 1) * 0.15]], jaw: [["x", i % 2 ? 0.4 : 0]], armR: [["z", (i % 2 ? -1 : 1) * 0.1 - 0.2]], armL: [["z", (i % 2 ? 1 : -1) * 0.1 - 0.2]], fingersR: -0.5, fingersL: -0.5 }]), [1, {}]]),
  arm_twitch: K(1.6, [[0, {}], [0.1, { armR: [["x", -0.6], ["z", -0.3]], foreR: [["x", -0.8]], fingersR: -1 }], [0.15, { armR: [["x", -0.2]], foreR: [["x", -0.2]] }], [0.3, { armL: [["x", -0.5]], foreL: [["x", -0.9]], fingersL: -1 }], [0.36, {}], [1, {}]]),
  sniff: K(2.0, [[0, {}], ...[0.15, 0.25, 0.35, 0.45, 0.55].map((t, i) => [t, { neck: [["x", -0.25]], head: [["x", -0.3 - (i % 2) * 0.1], ["y", Math.sin(i * 1.7) * 0.35]], ears: [["x", -0.5]], tail: [["y", (i % 2 ? 1 : -1) * 0.6]] }]), [1, {}]]),
  scratch_ear: K(2.2, [[0, {}], [0.25, { head: [["z", -0.35]], ikL: IK("head", [0.45, 0.3, 0.0], [1, -0.2, 0]), fingersL: 0.6, ears: [["x", 0.4]] }],
    ...[0.35, 0.45, 0.55, 0.65].map((t, i) => [t, { head: [["z", -0.35]], ikL: IK("head", [0.45, 0.3 + (i % 2) * 0.12, 0.0], [1, -0.2, 0]), fingersL: 0.4 + (i % 2) * 0.5, ears: [["x", 0.4]], tail: [["y", (i % 2 ? 1 : -1) * 0.4]] }]), [1, {}]]),
  stretch_cat: K(2.8, [[0, {}], [0.35, { pelvis: { drop: 0.08 }, spine: [["x", 0.45]], chest: [["x", 0.3]], head: [["x", -0.45]], armR: [["x", -2.4]], armL: [["x", -2.4]], fingersR: -1, fingersL: -1, tail: [["x", -0.6]] }],
    [0.65, { pelvis: { drop: 0.08 }, spine: [["x", 0.45]], chest: [["x", 0.3]], head: [["x", -0.4]], armR: [["x", -2.4]], armL: [["x", -2.4]], fingersR: -1, fingersL: -1, tail: [["x", -0.7]], jaw: [["x", 0.5]] }], [1, {}]]),
  tail_wag: K(2.0, [[0, {}], ...Array.from({ length: 8 }, (_, i) => [0.1 + i * 0.1, { tail: [["y", (i % 2 ? 1 : -1) * 1.0]], hips: [["y", (i % 2 ? -1 : 1) * 0.06]], head: [["z", 0.15]] }]), [1, {}]]),
  claw_flex: K(2.2, [[0, {}], [0.25, { ikR: IK("chest", [0.2, 0.1, 0.55], [1, -0.7, 0]), fingersR: -1, head: [["x", 0.25]] }], [0.4, { ikR: IK("chest", [0.2, 0.1, 0.55], [1, -0.7, 0]), fingersR: 1, head: [["x", 0.25]] }],
    [0.55, { ikR: IK("chest", [0.2, 0.1, 0.55], [1, -0.7, 0]), fingersR: -1, head: [["x", 0.25]] }], [0.7, { ikR: IK("chest", [0.25, 0.1, 0.5], [1, -0.7, 0]), fingersR: 0.7, head: [["x", 0.2], ["y", -0.2]] }], [1, {}]]),
  head_sway: K(3.0, [[0, {}], [0.25, { neck: [["z", 0.25], ["y", 0.25]], head: [["z", -0.2]], tail: [["y", -0.6]] }], [0.5, { neck: [["z", -0.25], ["y", -0.25]], head: [["z", 0.2]], tail: [["y", 0.6]] }], [0.75, { neck: [["z", 0.2], ["y", 0.2]], head: [["z", -0.15]], tail: [["y", -0.5]] }], [1, {}]]),
  snort: K(1.5, [[0, {}], [0.2, { chest: [["x", -0.2]], head: [["x", -0.3]], jaw: [["x", 0.15]] }], [0.35, { chest: [["x", 0.1]], head: [["x", 0.15]], jaw: [["x", 0]] }], [0.5, { head: [["y", 0.2]] }], [1, {}]]),
  head_tilt: K(2.4, [[0, {}], [0.3, { neck: [["z", 0.3]], head: [["z", 0.45], ["x", 0.15]], chest: [["x", 0.08]] }], [0.75, { neck: [["z", 0.3]], head: [["z", 0.45], ["x", 0.15]] }], [1, {}]]),
  shrug_laugh: K(2.0, [[0, {}], [0.2, { shoulderR: [["z", 0.35]], shoulderL: [["z", 0.35]], armR: [["z", -0.3]], armL: [["z", -0.3]], foreR: [["x", -1.0]], foreL: [["x", -1.0]], fingersR: -0.8, fingersL: -0.8, head: [["z", 0.15]] }],
    ...[0.35, 0.45, 0.55, 0.65].map((t, i) => [t, { chest: [["x", (i % 2) * 0.12]], head: [["x", -0.25 + (i % 2) * 0.12]], shoulderR: [["z", 0.2]], shoulderL: [["z", 0.2]], jaw: [["x", 0.3 * (i % 2)]] }]), [1, {}]]),
  arms_cross: K(3.4, [[0, {}], [0.2, { chest: [["x", -0.08]], head: [["x", -0.1]], ikR: IK("chest", [-0.35, -0.12, 0.3], [1, -0.4, 0.1]), ikL: IK("chest", [-0.35, -0.06, 0.36], [1, -0.4, 0.1]), fingersR: 0.5, fingersL: 0.5 }],
    [0.8, { chest: [["x", -0.1]], head: [["x", -0.12], ["y", 0.25]], ikR: IK("chest", [-0.35, -0.12, 0.3], [1, -0.4, 0.1]), ikL: IK("chest", [-0.35, -0.06, 0.36], [1, -0.4, 0.1]), fingersR: 0.5, fingersL: 0.5 }], [1, {}]]),
  hands_behind: K(3.4, [[0, {}], [0.2, { chest: [["x", -0.08]], ikR: IK("pelvis", [0.08, 0.05, -0.45], [1, -0.4, -0.6]), ikL: IK("pelvis", [0.08, 0.05, -0.45], [1, -0.4, -0.6]), fingersR: 0.3, fingersL: 0.3 }],
    ...[0.4, 0.6].map((t, i) => [t, { chest: [["x", -0.08]], head: [["z", i ? -0.2 : 0.2]], body: { y: i ? 0 : 0.025 }, ikR: IK("pelvis", [0.08, 0.05, -0.45], [1, -0.4, -0.6]), ikL: IK("pelvis", [0.08, 0.05, -0.45], [1, -0.4, -0.6]) }]), [1, {}]]),
  fist_pump: K(1.6, [[0, {}], [0.2, { pelvis: { drop: 0.06 }, ikR: IK("chest", [0.3, -0.1, 0.35], [1, -0.7, -0.2]), fingersR: 1, chest: [["x", 0.15]] }], [0.4, { armR: [["x", -2.9]], foreR: [["x", -0.2]], fingersR: 1, chest: [["x", -0.2]], head: [["x", -0.3]], body: { y: 0.1 } }],
    [0.55, { pelvis: { drop: 0.05 }, ikR: IK("chest", [0.3, -0.1, 0.35], [1, -0.7, -0.2]), fingersR: 1, chest: [["x", 0.1]] }], [0.75, { armR: [["x", -2.9]], fingersR: 1, head: [["x", -0.3]], body: { y: 0.08 } }], [1, {}]]),
  graceful_victory: K(2.0, [[0, {}], [0.4, { chest: [["x", -0.15], ["y", 0.2]], head: [["x", -0.25]], armR: [["x", -1.6], ["z", -1.2]], foreR: [["x", -0.2]], fingersR: -0.6, armL: [["z", -0.8]], fingersL: -0.5 }],
    [0.75, { chest: [["x", -0.1], ["y", -0.15]], head: [["x", -0.15]], armR: [["x", -1.0], ["z", -1.4]], fingersR: -0.6, armL: [["z", -1.0]], fingersL: -0.5 }], [1, {}]]),
  hop_dance: K(1.8, [[0, {}], ...Array.from({ length: 6 }, (_, i) => [0.1 + i * 0.14, { body: { y: i % 2 ? 0.16 : 0 }, pelvis: { drop: i % 2 ? 0 : 0.08 }, spine: [["x", 0.2]], head: [["z", (i % 2 ? 1 : -1) * 0.3]], armR: [["x", -1.2], ["z", -0.6]], armL: [["x", -1.2], ["z", -0.6]], foreR: [["x", -1.2]], foreL: [["x", -1.2]], fingersR: i % 2 ? -0.6 : 1, fingersL: i % 2 ? 1 : -0.6 }]), [1, {}]]),
  roar_flex: K(2.0, [[0, {}], [0.25, { stance: 0.08, pelvis: { drop: 0.05 }, chest: [["x", 0.25]], armR: [["z", -1.4], ["tw", 1.4]], foreR: [["x", -2.1]], armL: [["z", -1.4], ["tw", 1.4]], foreL: [["x", -2.1]], fingersR: 1, fingersL: 1 }],
    [0.55, { stance: 0.08, chest: [["x", -0.4]], neck: [["x", -0.25]], head: [["x", -0.5]], jaw: [["x", 0.6]], armR: [["z", -1.5], ["tw", 1.5]], foreR: [["x", -2.2]], armL: [["z", -1.5], ["tw", 1.5]], foreL: [["x", -2.2]], fingersR: 1, fingersL: 1, tail: [["x", -0.5]] }],
    [0.8, { stance: 0.08, chest: [["x", -0.35]], head: [["x", -0.45]], jaw: [["x", 0.5]], armR: [["z", -1.45], ["tw", 1.45]], foreR: [["x", -2.1]], armL: [["z", -1.45], ["tw", 1.45]], foreL: [["x", -2.1]], fingersR: 1, fingersL: 1 }], [1, {}]]),
  menace_laugh: K(2.0, [[0, {}], [0.2, { chest: [["x", -0.25]], head: [["x", -0.4]], jaw: [["x", 0.4]], armR: [["z", -0.6]], armL: [["z", -0.6]], foreR: [["x", -1.3]], foreL: [["x", -1.3]], fingersR: -0.8, fingersL: -0.8 }],
    ...[0.35, 0.45, 0.55, 0.65, 0.75].map((t, i) => [t, { chest: [["x", -0.25 + (i % 2) * 0.12]], head: [["x", -0.4 + (i % 2) * 0.1]], jaw: [["x", i % 2 ? 0.1 : 0.45]], armR: [["z", -0.6]], armL: [["z", -0.6]], foreR: [["x", -1.3]], foreL: [["x", -1.3]], fingersR: 0.6, fingersL: 0.6 }]), [1, {}]]),
  jump_cheer: K(1.7, [[0, {}], [0.15, { pelvis: { drop: 0.1 }, armR: [["x", 0.3]], armL: [["x", 0.3]], fingersR: 1, fingersL: 1 }], [0.35, { body: { y: 0.3 }, armR: [["x", -2.8], ["z", -0.3]], armL: [["x", -2.8], ["z", -0.3]], fingersR: -0.8, fingersL: -0.8, head: [["x", -0.3]] }],
    [0.55, { pelvis: { drop: 0.06 }, armR: [["x", -2.6]], armL: [["x", -2.6]], fingersR: -0.8, fingersL: -0.8 }], [0.75, { body: { y: 0.15 }, armR: [["x", -2.7]], armL: [["x", -2.7]], head: [["z", 0.25]] }], [1, {}]]),
  rattle_victory: K(1.8, [[0, {}], ...Array.from({ length: 8 }, (_, i) => [0.1 + i * 0.1, { armR: [["x", -2.4 + (i % 2) * 0.4]], armL: [["x", -2.4 + ((i + 1) % 2) * 0.4]], jaw: [["x", i % 2 ? 0.5 : 0]], head: [["z", (i % 2 ? 1 : -1) * 0.25]], chest: [["z", (i % 2 ? -1 : 1) * 0.1]] }]), [1, {}]]),
  howl: K(2.2, [[0, {}], [0.3, { pelvis: { drop: 0.05 }, chest: [["x", -0.4]], neck: [["x", -0.35]], head: [["x", -0.6]], jaw: [["x", 0.5]], ears: [["x", 0.5]], tail: [["x", -0.6]], fingersR: -0.6, fingersL: -0.6 }],
    [0.8, { chest: [["x", -0.45]], neck: [["x", -0.4]], head: [["x", -0.65]], jaw: [["x", 0.55]], ears: [["x", 0.6]], tail: [["x", -0.7]] }], [1, {}]]),
  // talking gestures (looped while someone speaks)
  talk_open: K(2.4, [[0, {}], [0.2, { ikR: IK("chest", [0.35, -0.3, 0.5], [1, -1, 0]), fingersR: -0.6, head: [["y", 0.12]] }], [0.45, { ikR: IK("chest", [0.55, -0.2, 0.45], [1, -1, 0]), fingersR: -0.8, head: [["y", -0.05], ["x", 0.06]] }],
    [0.7, { ikL: IK("chest", [0.4, -0.3, 0.5], [1, -1, 0]), fingersL: -0.6, head: [["y", -0.12]] }], [1, {}]]),
  talk_point: K(2.0, [[0, {}], [0.25, { armR: [["x", -1.2]], foreR: [["x", -0.4]], fingersR: 0.8, chest: [["y", 0.12]], head: [["x", 0.05]] }], [0.55, { armR: [["x", -1.0], ["y", 0.2]], foreR: [["x", -0.5]], fingersR: 0.8, head: [["x", 0.12]] }], [1, {}]]),
  talk_shrug: K(1.8, [[0, {}], [0.35, { shoulderR: [["z", 0.3]], shoulderL: [["z", 0.3]], ikR: IK("pelvis", [1.0, 0.45, 0.4], [1, -1, -0.3]), ikL: IK("pelvis", [1.0, 0.45, 0.4], [1, -1, -0.3]), fingersR: -0.9, fingersL: -0.9, head: [["z", 0.18]] }],
    [0.6, { shoulderR: [["z", 0.3]], shoulderL: [["z", 0.3]], ikR: IK("pelvis", [1.0, 0.45, 0.4], [1, -1, -0.3]), ikL: IK("pelvis", [1.0, 0.45, 0.4], [1, -1, -0.3]), fingersR: -0.9, fingersL: -0.9 }], [1, {}]]),
  talk_fist: K(1.8, [[0, {}], [0.3, { ikR: IK("chest", [0.25, -0.15, 0.45], [1, -0.8, 0]), fingersR: 1, chest: [["x", 0.1]], head: [["x", 0.12]] }], [0.45, { ikR: IK("chest", [0.25, -0.3, 0.5], [1, -0.8, 0]), fingersR: 1, chest: [["x", 0.18]], head: [["x", 0.2]] }], [1, {}]]),
};

// ======================================================================================= species styles
// posture: a pose held all the time (fades out when knocked down); crouch/stance: legs (IK keeps feet planted);
// breathe: chest rise; walk: swagger while moving; idle: habits played now and then; greet/victory/talk: emotes.
const STYLES = {
  human: { posture: {}, crouch: 0, stance: 0, breathe: 1, jitter: 0, walk: { roll: 0.05, bob: 0.02, swing: 0.15 },
           idle: ["look_around", "shift_weight", "stretch", "check_hands", "arms_cross"], greet: "wave_friendly", victory: "fist_pump", talk: ["talk_open", "talk_point", "talk_shrug"] },
  elf: { posture: { chest: [["x", -0.07]], neck: [["x", -0.05]], head: [["x", -0.06]], shoulderR: [["z", -0.05]], shoulderL: [["z", -0.05]], fingersR: -0.15, fingersL: -0.15 },
         crouch: 0, stance: -0.01, breathe: 0.7, jitter: 0, walk: { roll: 0.02, bob: 0.01, swing: 0.05, hips: 0.12 },
         idle: ["hair_touch", "look_sky", "shift_weight", "hands_behind", "look_around"], greet: "bow_graceful", victory: "graceful_victory", talk: ["talk_open", "talk_shrug"] },
  dwarf: { posture: { chest: [["x", 0.06]], head: [["x", -0.08]], armR: [["z", -0.12]], armL: [["z", -0.12]], fingersR: 0.5, fingersL: 0.5 },
           crouch: 0.03, stance: 0.05, breathe: 1.3, jitter: 0, walk: { roll: 0.14, bob: 0.04, swing: 0.3 },
           idle: ["beard_stroke", "hands_on_hips", "crack_knuckles", "flex", "look_around"], greet: "salute_stout", victory: "chest_beat", talk: ["talk_fist", "talk_open"] },
  goblin: { posture: { spine: [["x", 0.22]], chest: [["x", 0.1]], neck: [["x", -0.18]], head: [["x", -0.15]], armR: [["x", -0.25], ["z", -0.1]], armL: [["x", -0.25], ["z", -0.1]], foreR: [["x", -0.5]], foreL: [["x", -0.5]], fingersR: 0.35, fingersL: 0.35 },
            crouch: 0.09, stance: 0.04, breathe: 1.2, jitter: 1, walk: { roll: 0.08, bob: 0.05, swing: 0.25 },
            idle: ["rub_hands", "scratch_head", "peek", "cackle_hop", "look_around"], greet: "cackle_hop", victory: "hop_dance", talk: ["talk_point", "talk_shrug"] },
  orc: { posture: { spine: [["x", 0.08]], chest: [["x", 0.14]], neck: [["x", -0.12]], head: [["x", -0.1]], shoulderR: [["z", 0.08]], shoulderL: [["z", 0.08]], armR: [["z", -0.25]], armL: [["z", -0.25]], foreR: [["x", -0.25]], foreL: [["x", -0.25]], fingersR: 0.8, fingersL: 0.8 },
         crouch: 0.04, stance: 0.07, breathe: 1.8, jitter: 0, walk: { roll: 0.18, bob: 0.05, swing: 0.35 },
         idle: ["chest_beat", "crack_knuckles", "neck_crack", "flex", "look_around"], greet: "chest_beat", victory: "roar_flex", talk: ["talk_fist", "talk_point"] },
  undead: { posture: { spine: [["x", 0.14]], chest: [["x", 0.06], ["z", 0.05]], head: [["z", 0.22], ["x", 0.08]], armR: [["x", -0.15]], foreR: [["x", -0.2]], armL: [["x", 0.05]], fingersR: -0.3, fingersL: 0.2 },
            crouch: 0.03, stance: 0.02, breathe: 0, jitter: 0, quantize: 0.12, walk: { roll: 0.12, bob: 0.03, swing: 0.1, limp: 1 },
            idle: ["head_creak", "rattle", "arm_twitch", "look_around"], greet: "creepy_bow", victory: "rattle_victory", talk: ["talk_point", "talk_open"] },
  beastfolk: { posture: { spine: [["x", 0.1]], chest: [["x", 0.06]], neck: [["x", -0.1]], armR: [["x", -0.2]], armL: [["x", -0.2]], foreR: [["x", -0.4]], foreL: [["x", -0.4]], fingersR: 0.4, fingersL: 0.4 },
               crouch: 0.06, stance: 0.03, breathe: 1.4, jitter: 0.5, tail: 1, ears: 1, walk: { roll: 0.06, bob: 0.06, swing: 0.2 },
               idle: ["sniff", "scratch_ear", "stretch_cat", "tail_wag", "look_around"], greet: "sniff_wave", victory: "howl", talk: ["talk_open", "talk_shrug"] },
  dragonkin: { posture: { chest: [["x", -0.1]], neck: [["x", -0.06]], head: [["x", -0.05]], armR: [["z", -0.18]], armL: [["z", -0.18]], foreR: [["x", -0.35]], foreL: [["x", -0.35]], fingersR: -0.4, fingersL: -0.4 },
               crouch: 0.02, stance: 0.05, breathe: 1.6, jitter: 0, tail: 1, walk: { roll: 0.1, bob: 0.03, swing: 0.2 },
               idle: ["claw_flex", "head_sway", "snort", "look_around"], greet: "proud_nod", victory: "roar_flex", talk: ["talk_fist", "talk_open"] },
  demonkin: { posture: { chest: [["x", 0.1]], neck: [["x", 0.05]], head: [["x", 0.12], ["z", 0.08]], shoulderR: [["z", 0.06]], shoulderL: [["z", 0.06]], armR: [["z", -0.12]], armL: [["z", -0.12]], foreR: [["x", -0.3]], foreL: [["x", -0.3]], fingersR: -0.5, fingersL: -0.5 },
              crouch: 0.03, stance: 0.04, breathe: 1.0, jitter: 0, tail: 1, walk: { roll: 0.06, bob: 0.015, swing: 0.08 },
              idle: ["claw_flex", "head_tilt", "shrug_laugh", "arms_cross"], greet: "sinister_bow", victory: "menace_laugh", talk: ["talk_point", "talk_shrug"] },
  vermeil: { posture: {}, crouch: 0, stance: 0, breathe: 0.8, jitter: 0, walk: { roll: 0.04, bob: 0.02, swing: 0.1, hips: 0.1 },
             idle: ["hands_behind", "hair_touch", "look_around", "stretch"], idleClips: ["look_around", "stretch", "happy", "think", "nod", "dance_sway", "yawn", "shy"],
             greet: "cute_wave", victory: "jump_cheer", talk: ["talk_open", "talk_point"], talkClips: ["talk"] },
  // non-playable humanoids (NPCs, enemies)
  npc: { posture: {}, crouch: 0, stance: 0, breathe: 1, jitter: 0, walk: { roll: 0.05, bob: 0.02, swing: 0.15 },
         idle: ["look_around", "shift_weight", "arms_cross", "check_hands", "hands_behind"], greet: "wave_friendly", victory: "fist_pump", talk: ["talk_open", "talk_point", "talk_shrug", "talk_fist"] },
  brute: { posture: { chest: [["x", 0.12]], head: [["x", -0.1]], armR: [["z", -0.2]], armL: [["z", -0.2]], fingersR: 0.8, fingersL: 0.8 }, crouch: 0.04, stance: 0.06, breathe: 1.6, jitter: 0,
           walk: { roll: 0.16, bob: 0.04, swing: 0.3 }, idle: ["neck_crack", "crack_knuckles", "look_around", "chest_beat"], greet: "chest_beat", victory: "roar_flex", talk: ["talk_fist"] },
  sneaky: { posture: { spine: [["x", 0.18]], neck: [["x", -0.15]], foreR: [["x", -0.4]], foreL: [["x", -0.4]], fingersR: 0.4, fingersL: 0.4 }, crouch: 0.08, stance: 0.04, breathe: 1.2, jitter: 1,
            walk: { roll: 0.06, bob: 0.04, swing: 0.2 }, idle: ["rub_hands", "peek", "scratch_head", "look_around"], greet: "cackle_hop", victory: "hop_dance", talk: ["talk_point"] },
  beast4: { posture: {}, breathe: 1.5, tail: 1, walk: { roll: 0.04, bob: 0.03, swing: 0 }, idle: ["sniff", "head_sway", "tail_wag", "look_around"], greet: "sniff", victory: "howl", talk: [] },
};
export function styleFor(info = {}) {
  const sp = info.species, m = String(info.model || ""), body = info.body || "humanoid";
  if (info.model === "vermeil") return "vermeil";
  if (sp && STYLES[sp]) return sp;
  if (body === "quadruped" || body === "serpent" || body === "flyer") return "beast4";
  if (/goblin|puglin|ninja/.test(m)) return "sneaky";
  if (/orc|yeti|cyclops|sharky|demon/.test(m)) return /demon/.test(m) ? "demonkin" : "brute";
  if (/skeleton|zombie|ghost/.test(m)) return "undead";
  if (/viking/.test(m)) return "dwarf";
  if (/elf/.test(m)) return "elf";
  if (/bunny|monkroose|tribal|dog|cat|fox/.test(m)) return "beastfolk";
  if (/dino|dragon/.test(m)) return "dragonkin";
  return info.team === "npc" ? "npc" : "human";
}
export const STYLE_NAMES = Object.keys(STYLES);

// pose helpers ----------------------------------------------------------------------------
function addPose(out, p, w = 1) {
  if (!p || w === 0) return out;
  for (const [k, v] of Object.entries(p)) {
    if (k === "ikR" || k === "ikL") { if (v && v.w * w > ((out[k] && out[k].w) || 0)) out[k] = { ...v, w: v.w * w }; continue; }
    if (Array.isArray(v)) { const list = out[k] ||= []; for (const [ax, a] of v) list.push([ax, a * w]); }
    else if (typeof v === "number") out[k] = (out[k] || 0) + v * w;
    else if (v && typeof v === "object") { const o = out[k] ||= {}; for (const [kk, vv] of Object.entries(v)) o[kk] = (o[kk] || 0) + vv * w; }
  }
  return out;
}
function flat(rots) { const o = { x: 0, y: 0, z: 0 }; for (const [ax, a] of rots || []) o[ax] += a; return o; }
function blendKeys(keys, t) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, a] = keys[i], [t1, b] = keys[Math.min(i + 1, keys.length - 1)];
  const k = t1 > t0 ? ease((t - t0) / (t1 - t0)) : 1;
  const out = {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[name], vb = b[name];
    if (name === "ikR" || name === "ikL") {        // hand targets: blend offsets; a missing side means 'let the body do its thing'
      const A = va || { ...vb, w: 0 }, B = vb || { ...va, w: 0 };
      const at = B.w >= A.w ? B.at : A.at;
      const o = { at }; for (const f of ["x", "y", "z", "px", "py", "pz", "w"]) o[f] = A[f] * (1 - k) + B[f] * k;
      if (A.at !== B.at) o.w = Math.min(o.w, Math.abs(k - 0.5) * 2 * Math.max(A.w, B.w) + Math.min(A.w, B.w));
      out[name] = o; continue;
    }
    if (typeof (va ?? vb) === "number") out[name] = (va || 0) * (1 - k) + (vb || 0) * k;
    else if (Array.isArray(va ?? vb)) { const fa = flat(va), fb = flat(vb); out[name] = [["x", fa.x * (1 - k) + fb.x * k], ["y", fa.y * (1 - k) + fb.y * k], ["z", fa.z * (1 - k) + fb.z * k]]; }
    else { const o = {}; for (const kk of new Set([...Object.keys(va || {}), ...Object.keys(vb || {})])) o[kk] = ((va || {})[kk] || 0) * (1 - k) + ((vb || {})[kk] || 0) * k; out[name] = o; }
  }
  return out;
}
const evalEmote = (E, t) => (E.keys ? blendKeys(E.keys, t) : E.f(t));

// ======================================================================================= the Animator
export class Animator {
  /** root: the model container to animate; options: body (humanoid/quadruped/...), style (species), name */
  constructor(root, clips = [], { body = "humanoid", name = "?", style = null } = {}) {
    this.root = root;
    this.body = body;
    this.name = name;
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = {};
    this.map = {};
    this.report = {};
    for (const c of clips) this.clips[clean(c.name)] = sanitize(c.clone(), root);
    // bones: by role (first matching pattern wins), plus finger / tail / ear chains
    const all = [];
    root.traverse((o) => { if (o.isBone) all.push(o); });
    this.allBones = all;
    this.bones = {};
    for (const [role, list] of Object.entries(ROLE)) {
      for (const rx of list) { const b = all.find((o) => rx.test(o.name)); if (b) { this.bones[role] = b; break; } }
    }
    if (this.bones.spine && this.bones.spine === this.bones.pelvis) delete this.bones.spine;
    if (!this.bones.pelvis && this.bones.thighR?.parent?.isBone) this.bones.pelvis = this.bones.thighR.parent;   // rigify: 'spine' holds the legs
    if (this.bones.spine === this.bones.pelvis) delete this.bones.spine;
    if (this.bones.head && this.bones.neck === this.bones.head) delete this.bones.neck;
    const depth = (b) => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d; };
    this.fingers = { R: all.filter((b) => FINGER.R.test(b.name)), L: all.filter((b) => FINGER.L.test(b.name)) };
    this.thumbs = { R: all.filter((b) => THUMB.R.test(b.name)), L: all.filter((b) => THUMB.L.test(b.name)) };
    this.chains = {};
    for (const [k, rx] of Object.entries(CHAIN)) this.chains[k] = all.filter((b) => rx.test(b.name)).sort((a, b) => depth(a) - depth(b));
    this.rigged = !!(this.bones.armR && this.bones.armL && (this.bones.spine || this.bones.chest));
    // rest pose: every frame starts from it, so procedural layers never pile up on bones that clips don't move
    root.updateMatrixWorld(true);
    this.rest = all.map((b) => [b, b.quaternion.clone(), b.position.clone()]);
    this.setupLegs();
    this.setupArms();
    this.calibrate();
    // resolve every state to a clip (or procedural)
    for (const s of Object.keys(STATES)) this.map[s] = this.resolve(s);
    for (const s of Object.keys(PROC)) if (!this.map[s]) this.map[s] = null;
    for (const s of new Set([...Object.keys(STATES), ...Object.keys(PROC)])) {
      const procMove = ["idle", "walk", "run", "combat_idle"].includes(s);
      this.report[s] = this.map[s] ? `clip:${this.map[s]}` : (procMove || PROC[s] || BLOB[s] || BLOB[ALIAS[s]]) ? "procedural" : "missing";
    }
    this.cur = null;            // current looping clip action
    this.curState = null;
    this.once = null;           // one-shot {state, t, dur, proc, action ...}
    this.layer = null;          // emote overlay {E, t, res}
    this.moveSpeed = 0;
    this.t = Math.random() * 10;
    this.holder = root;
    this.base = { y: root.position.y, z: root.position.z, x: root.position.x, sx: root.scale.x, sy: root.scale.y, sz: root.scale.z, rx: root.rotation.x, rz: root.rotation.z, ry: root.rotation.y };
    this.dead = false;
    this.talking = false;
    this.postureW = 1;
    this.idleTimer = 2 + Math.random() * 5;
    this.setStyle(style || "human");
    this.loopState("idle");
  }

  setStyle(name) { this.styleName = STYLES[name] ? name : "human"; this.style = STYLES[this.styleName]; }

  /** run fn with the body in its rest pose (for measuring: where hands, back, palms are), then put the pose back */
  atRest(fn) {
    const saved = this.rest.map(([b]) => [b.quaternion.clone(), b.position.clone()]);
    const r = this.root, rp = r.position.clone(), rq = r.quaternion.clone(), rs = r.scale.clone();
    for (const [b, q, p] of this.rest) { b.quaternion.copy(q); b.position.copy(p); }
    this.resetBody();
    r.updateMatrixWorld(true);
    try { fn(); } finally {
      this.rest.forEach(([b], i) => { b.quaternion.copy(saved[i][0]); b.position.copy(saved[i][1]); });
      r.position.copy(rp); r.quaternion.copy(rq); r.scale.copy(rs);
      r.updateMatrixWorld(true);
    }
  }

  /** sit down on something `h` metres high (a log, a bench) - null to stand up again */
  sit(h) { this.seat = h == null ? null : { h, w: this.seat?.w || 0 }; }

  /** the sitting pose: hips lowered onto the seat, thighs forward, shins down, feet flat, hands resting on the knees */
  applySeat(dt, actorQuat) {
    const S = this.seat;
    S.w = Math.min(1, S.w + dt * 2.5);
    const w = ease(S.w), B = this.bones, pel = B.pelvis;
    if (!pel || this.legs.length !== 2) return;
    const h = this.height || 1.7;
    const fwd = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
    if (actorQuat) fwd.applyQuaternion(actorQuat);
    this.root.updateMatrixWorld(true);
    const ground = this.root.parent.getWorldPosition(new THREE.Vector3()).y;
    // the hips go down to the seat (and back a little, so the knees end up over the feet)
    const hip = pel.getWorldPosition(new THREE.Vector3());
    const footY = Math.min(...this.legs.map((L) => L.shin.localToWorld(L.endLocal.clone()).y)) - ground;
    const drop = Math.max(0, hip.y - ground - (S.h + 0.06 * h));
    const want = hip.clone().addScaledVector(up, -drop * w).addScaledVector(fwd, -0.05 * h * w);
    pel.position.copy(pel.parent.worldToLocal(want));
    pel.updateMatrixWorld(true);
    // feet planted in front of the seat, knees bent up and forward
    for (const L of this.legs) {
      const A = L.thigh.getWorldPosition(new THREE.Vector3());
      const lenA = A.distanceTo(L.shin.getWorldPosition(new THREE.Vector3()));
      const C = L.shin.localToWorld(L.endLocal.clone());
      const T = A.clone().addScaledVector(fwd, lenA * 0.95);
      T.y = ground + Math.max(0.02 * h, footY);
      this.solveLeg(L, C.lerp(T, w), fwd.clone().addScaledVector(up, 0.3).normalize());
    }
    // lean in a little and rest the hands on the knees
    const pose = { chest: [["x", 0.18 * w]], head: [["x", -0.1 * w]], armR: [["x", -0.55 * w], ["z", 0.25 * w]], armL: [["x", -0.55 * w], ["z", 0.25 * w]],
                   foreR: [["x", -0.5 * w]], foreL: [["x", -0.5 * w]], fingersR: 0.3 * w, fingersL: 0.3 * w };
    for (const [k, bone] of [["chest", B.chest || B.spine], ["head", B.head]]) if (bone) this.rotateBone(bone, pose[k], actorQuat);
    for (const s of ["R", "L"]) {
      if (B["arm" + s]) this.rotateBone(B["arm" + s], pose["arm" + s], actorQuat, s === "L");
      if (B["fore" + s]) { B["fore" + s].quaternion.multiply(_q.setFromAxisAngle(AX.x, 0.5 * w * this.flexSign[s])); B["fore" + s].updateMatrixWorld(true); }
      this.curl(this.fingers[s], pose["fingers" + s], s);
    }
  }

  // ---------------- legs: two-bone IK so crouches / wide stances bend the knees and keep feet planted ----------------
  setupLegs() {
    this.legs = [];
    for (const s of ["R", "L"]) {
      const thigh = this.bones["thigh" + s], shin = this.bones["shin" + s], foot = this.bones["foot" + s];
      if (!thigh || !shin || shin.parent !== thigh) continue;
      const ankleW = foot ? foot.getWorldPosition(new THREE.Vector3()) : null;
      let endLocal;
      if (foot && foot.parent === shin) endLocal = foot.position.clone();
      else if (ankleW) endLocal = shin.worldToLocal(ankleW.clone());
      else continue;
      const footIsChild = !!foot && foot.parent === shin;
      const lenA = thigh.getWorldPosition(_v1).distanceTo(shin.getWorldPosition(_v2));
      const lenB = shin.localToWorld(endLocal.clone()).distanceTo(_v2);
      if (lenA < 1e-5 || lenB < 1e-5) continue;
      this.legs.push({ s, thigh, shin, foot, endLocal, footIsChild, side: s === "R" ? -1 : 1 });
    }
  }

  setupArms() {
    this.arms = {};
    const B = this.bones;
    for (const s of ["R", "L"]) {
      const up = B["arm" + s], lo = B["fore" + s];
      if (!up || !lo || lo.parent !== up) continue;
      const hand = B["hand" + s] && B["hand" + s].parent === lo ? B["hand" + s] : lo.children.find((c) => c.isBone);
      if (!hand) continue;
      this.arms[s] = { s, thigh: up, shin: lo, endLocal: hand.position.clone(), side: s === "R" ? -1 : 1 };
    }
    // body measures for placing hands: shoulder width and head size
    this.sw = B.armR && B.armL ? B.armR.getWorldPosition(_v1).distanceTo(B.armL.getWorldPosition(_v2)) : 0.3;
    if (B.head) {
      const box = new THREE.Box3().setFromObject(this.root, true);
      const hy = B.head.getWorldPosition(_v1).y;
      const H = this.root.getWorldScale(_v2).y > 0 ? box.max.y - box.min.y : 1.7;
      this.headH = clamp(box.max.y - hy, 0.08 * H, 0.4 * H);
    } else this.headH = 0.25;
  }

  /** a body landmark in world space (for hand IK targets) */
  landmark(at, s, actorQuat) {
    const B = this.bones, up = _v4.set(0, 1, 0), fwd = _v5.set(0, 0, 1);
    if (actorQuat) fwd.applyQuaternion(actorQuat);
    const p = new THREE.Vector3();
    const headTop = () => B.head.getWorldPosition(p);
    switch (at) {
      case "shoulder": return (B["arm" + s] || B.chest || B.spine).getWorldPosition(p);
      case "head": if (!B.head) break; return headTop().addScaledVector(up, 0.45 * this.headH);
      case "brow": if (!B.head) break; return headTop().addScaledVector(up, 0.62 * this.headH).addScaledVector(fwd, 0.42 * this.headH);
      case "chin": if (!B.head) break; return headTop().addScaledVector(up, 0.15 * this.headH).addScaledVector(fwd, 0.45 * this.headH);
      case "chest": return (B.chest || B.spine || B.pelvis).getWorldPosition(p).addScaledVector(fwd, 0.25 * this.sw);
      case "belly": return (B.spine || B.pelvis || B.chest).getWorldPosition(p).addScaledVector(fwd, 0.3 * this.sw);
      case "pelvis": return (B.pelvis || B.spine).getWorldPosition(p);
    }
    return (B.chest || B.spine || B.pelvis).getWorldPosition(p);
  }

  /** find, on this rig, which way elbows bend, which way an upper-arm twist turns, and which way fingers curl
      (rigs differ), by trying small rotations on the rest pose and seeing where the hand / fingertip moves */
  calibrate() {
    this.flexSign = { R: 1, L: 1 }; this.twistSign = { R: 1, L: 1 }; this.curlSignS = { R: 1, L: 1 };
    const R = this.root; R.updateMatrixWorld(true);
    const rq = R.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rq), up = new THREE.Vector3(0, 1, 0).applyQuaternion(rq);
    const end = (b) => { const c = b.children.find((x) => x.isBone); return (c || b).getWorldPosition(new THREE.Vector3()); };
    const tryRot = (bone, axis, ang, probe) => {
      const q0 = bone.quaternion.clone();
      const a = probe();
      bone.quaternion.multiply(_q.setFromAxisAngle(axis, ang)); bone.updateMatrixWorld(true);
      const b = probe();
      bone.quaternion.copy(q0); bone.updateMatrixWorld(true);
      return b.sub(a);
    };
    for (const s of ["R", "L"]) {
      const arm = this.bones["arm" + s], fore = this.bones["fore" + s], hand = this.bones["hand" + s];
      if (fore) {
        const probe = () => (hand ? end(hand) : end(fore));
        this.flexSign[s] = tryRot(fore, AX.x, 0.4, probe).dot(fwd) >= 0 ? 1 : -1;
        if (arm) {
          const out = new THREE.Vector3(s === "R" ? -1 : 1, 0, 0).applyQuaternion(rq).add(up).normalize();
          const q0 = fore.quaternion.clone();
          fore.quaternion.multiply(_q.setFromAxisAngle(AX.x, 1.2 * this.flexSign[s])); fore.updateMatrixWorld(true);
          this.twistSign[s] = tryRot(arm, AX.y, 0.5, probe).dot(out) >= 0 ? 1 : -1;
          fore.quaternion.copy(q0); fore.updateMatrixWorld(true);
        }
      }
      const f = this.fingers[s][0];
      if (f) this.curlSignS[s] = tryRot(f, AX.x, 0.4, () => end(f)).dot(up) <= 0 ? 1 : -1;
    }
  }

  resolve(state, seen = new Set()) {
    if (seen.has(state)) return null;
    seen.add(state);
    const names = Object.keys(this.clips);
    for (const rx of STATES[state] || []) {
      const hit = names.find((n) => rx.test(n));
      if (hit) return hit;
    }
    const fb = FALLBACK[state];
    if (fb && !(this.rigged && PROC[state])) return this.resolve(fb, seen);
    return null;
  }

  action(name) { return this.mixer.clipAction(this.clips[name]); }

  loopState(state, timeScale = 1) {
    // (no walk clip = procedural steps / bounce, never an idle clip sliding along the ground)
    const clip = this.map[state] || (state === "run" ? this.map.walk : null) || (state === "combat_idle" ? this.map.idle : null);
    if (this.curState === state && (this.cur || !clip)) { if (this.cur) this.cur.timeScale = timeScale; return; }
    this.curState = state;
    if (!clip) { this.cur && this.cur.fadeOut(0.25); this.cur = null; return; }
    const a = this.action(clip);
    a.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(0.25).play();
    a.timeScale = timeScale;
    if (this.cur && this.cur !== a) this.cur.fadeOut(0.25);
    this.cur = a;
  }

  /** walking speed in m/s: picks idle / walk / run and matches the playback speed (no foot sliding) */
  setMove(speed, combat = false) {
    this.moveSpeed = speed;
    if (speed > 0.15 && this.layer && !this.layer.keepMoving) this.stopEmote();
    // walking cancels a gesture (wave, point, stretch...) so nobody glides along in a pose
    if (speed > 0.15 && this.once && !this.once.hold && (this.once.idleClip || GESTURE.has(this.once.state))) this.finishOnce();
    if (this.dead || (this.once && !this.once.overlay)) return;
    if (speed < 0.15) return this.loopState(combat ? "combat_idle" : "idle");
    if (speed < 3.2) return this.loopState("walk", Math.max(0.5, Math.min(1.8, speed / 1.6)));
    const hasRun = !!this.map.run && this.map.run !== this.map.walk;
    this.loopState(hasRun ? "run" : "walk", hasRun ? Math.max(0.7, speed / 5) : Math.min(2.2, speed / 1.8));
  }

  /** play a one-shot state. Resolves {impact} when the hit should land, {done} at the end. */
  play(state, { speed = 1, hold = false } = {}) {
    if (state === "wave" || state === "greet") return this.emote(this.style.greet || "wave_friendly");
    if (state === "victory" && this.rigged && this.style.victory && (this.styleName !== "human" || !this.map.victory)) return this.emote(this.style.victory);
    state = ALIAS[state] && !this.map[state] ? ALIAS[state] : state;
    if (this.dead && state !== "death") return { impact: Promise.resolve(), done: Promise.resolve() };
    if (this.once) this.finishOnce();
    this.stopEmote();
    let resImpact, resDone;
    const impact = new Promise((r) => (resImpact = r)), done = new Promise((r) => (resDone = r));
    const clip = this.map[state];
    const o = { state, t: 0, resImpact, resDone, impacted: false, hold: hold || state === "death" };
    if (clip) {
      const a = this.action(clip);
      a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.12).play();
      a.clampWhenFinished = o.hold;
      a.timeScale = speed;
      if (this.cur && this.cur !== a) this.cur.fadeOut(0.15);
      o.action = a;
      o.dur = this.clips[clip].duration / speed;
      o.impactAt = o.dur * ({ hit: 0.1, death: 0.5, cast: 0.55, cast_big: 0.6 }[state] ?? 0.45);
      // a little procedural flavour on top of short combat clips: grip the weapon, lean into it
      if (/attack|punch|spin|bash/.test(state)) o.extra = (p) => ({ fingersR: 1, fingersL: 0.5, chest: [["x", 0.12 * bell(p)]] });
      if (/cast/.test(state)) o.extra = (p) => ({ fingersR: -bell(p), fingersL: -bell(p) });
      if (state === "hit") o.extra = (p) => ({ fingersR: -0.7 * bell(p), fingersL: -0.7 * bell(p) });
    } else {
      const P = PROC[state] || PROC[ALIAS[state]] || PROC.attack;
      o.proc = P;
      o.dur = P.dur / speed;
      o.impactAt = P.impact * o.dur;
      if (!this.rigged) o.blob = BLOB[state] || BLOB[ALIAS[state]] || (/attack|punch|bash|spin|roar|bite/.test(state) ? BLOB.attack : /cast|shoot|heal|buff/.test(state) ? BLOB.cast : BLOB.attack);
    }
    if (state === "death") this.dead = true;
    this.once = o;
    return { impact, done };
  }

  /** a keyframed emote layered on top of whatever the body is doing (or a matching clip for Vermeil) */
  emote(name, { loop = false } = {}) {
    const E = EMOTE[name];
    if (!E || this.dead) return { impact: Promise.resolve(), done: Promise.resolve() };
    if (!this.rigged) {             // blobs: a bounce instead
      return this.play(name.includes("victory") || name.includes("cheer") ? "victory" : "jump");
    }
    this.stopEmote();
    let resImpact, resDone;
    const impact = new Promise((r) => (resImpact = r)), done = new Promise((r) => (resDone = r));
    this.layer = { E, name, t: 0, loop, resImpact, resDone, impacted: false };
    return { impact, done };
  }

  stopEmote() {
    const L = this.layer; if (!L) return;
    this.layer = null;
    if (!L.impacted) L.resImpact();
    L.resDone();
  }

  /** play one of a model's own clips by name (Vermeil has many: stretch, think, shy...) */
  playClip(name) {
    if (!this.clips[name] || this.once || this.dead) return false;
    const a = this.action(name);
    a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.3).play();
    a.clampWhenFinished = false;
    if (this.cur && this.cur !== a) this.cur.fadeOut(0.3);
    const o = { state: name, t: 0, action: a, dur: this.clips[name].duration, impactAt: 0, impacted: true, resImpact() {}, resDone() {}, idleClip: true };
    this.once = o;
    return true;
  }

  finishOnce() {
    const o = this.once;
    if (!o) return;
    if (!o.impacted) { o.impacted = true; o.resImpact(); }
    o.resDone();
    if (!o.hold) {
      if (o.action) o.action.fadeOut(o.idleClip ? 0.4 : 0.2);
      this.once = null;
      this.curState = null;
      this.setMove(this.moveSpeed, this.combat);
    }
  }

  revive() {
    this.dead = false;
    if (this.once?.action) this.once.action.stop();
    this.once = null;
    this.curState = null;
    this.resetBody();
    this.setMove(0, this.combat);
  }

  resetBody() {
    const r = this.root, b = this.base;
    r.position.set(b.x, b.y, b.z);
    r.scale.set(b.sx, b.sy, b.sz);
    r.rotation.set(b.rx, b.ry, b.rz);
  }

  // ---------------- every frame ----------------
  update(dt, actorQuat) {
    this.t += dt;
    this.frames = (this.frames || 0) + 1;
    for (const [b, q, p] of this.rest) { b.quaternion.copy(q); b.position.copy(p); }
    this.mixer.update(dt);
    // three.js only writes a bone when its value differs from last frame - but we just put every bone back to rest,
    // so a held pose (arms down in an idle that barely moves) would snap to the T-pose. Write them all again.
    const M = this.mixer, ai = M._accuIndex, pms = M._bindings;
    if (pms) for (let i = 0, n = M._nActiveBindings; i < n; i++) { const pm = pms[i]; pm.binding.setValue(pm.buffer, ai * pm.valueSize + pm.valueSize); }
    const o = this.once, S = this.style;
    let pose = null, blob = null;
    if (o) {
      o.t += dt;
      const p = Math.min(1, o.t / o.dur);
      if (!o.impacted && o.t >= o.impactAt) { o.impacted = true; o.resImpact(); }
      if (o.proc && this.rigged) pose = o.proc.f(p);
      else if (o.extra && this.rigged) pose = o.extra(p);
      if (o.blob) blob = o.blob(p);
      if (o.action && !this.rigged && o.state === "death") blob = BLOB.death(p);
      if (o.proc && o.state === "death") pose = PROC.death.f(p);
      if (p >= 1 && !o.done) { o.done = true; o.resDone(); if (!o.hold) this.finishOnce(); }
    }
    // rigs without clips still breathe / walk
    const moving = this.moveSpeed > 0.15;
    if (!o && !this.cur) {
      blob = moving ? BLOB.walk(this.t * Math.min(1.6, 0.5 + this.moveSpeed / 3)) : (this.rigged ? null : BLOB.idle(this.t));
      if (this.rigged && moving) pose = addPose(pose || {}, walkPose(this.t * (2 + this.moveSpeed)));
    }
    if (this.rigged && !this.map.idle && !this.cur) pose = addPose(pose || {}, REST);
    // ---- the species style layer ----
    if (this.rigged || this.chains.tail.length) {
      pose = pose || {};
      const wantPosture = this.dead ? 0 : (o && !o.idleClip ? 0.35 : 1);
      this.postureW += (wantPosture - this.postureW) * Math.min(1, dt * 4);
      const w = this.postureW;
      let tt = this.t;
      if (S.quantize) tt = Math.floor(tt / S.quantize) * S.quantize;     // the undead move in creaky steps
      addPose(pose, S.posture, w);
      if (S.crouch) addPose(pose, { pelvis: { drop: S.crouch } }, w);
      if (S.stance) addPose(pose, { stance: S.stance }, w);
      // breathing: chest rises, shoulders lift, head bobs a little
      const br = Math.sin(tt * (this.combat ? 3.2 : 2.0));
      if (S.breathe && !this.dead) addPose(pose, { chest: [["x", -0.025 * br * S.breathe]], shoulderR: [["z", 0.02 * br * S.breathe]], shoulderL: [["z", 0.02 * br * S.breathe]], head: [["x", 0.012 * br * S.breathe]] }, w);
      if (S.jitter && !this.dead && !moving) addPose(pose, { head: [["y", Math.sin(tt * 7.3) * Math.sin(tt * 1.3) * 0.08 * S.jitter], ["x", Math.sin(tt * 5.1) * 0.03 * S.jitter]] }, w);
      if ((S.tail || this.chains.tail.length) && !this.dead) addPose(pose, { tail: [["y", Math.sin(tt * (moving ? 6 : 1.6)) * (moving ? 0.35 : 0.25)], ["x", Math.sin(tt * 1.1) * 0.08]] }, 1);
      if (this.chains.earL.length && !this.dead) { const tw = Math.max(0, Math.sin(tt * 0.9) * 8 - 7); addPose(pose, { ears: [["x", -0.25 * tw + Math.sin(tt * 1.4) * 0.05]] }, 1); }
      // walking swagger
      if (moving && !this.dead && S.walk) {
        const ph = this.t * (2.2 + this.moveSpeed * 1.4), Wk = S.walk;
        const limp = Wk.limp ? Math.max(0, Math.sin(ph)) * 0.08 : 0;
        addPose(pose, { chest: [["z", Math.sin(ph) * Wk.roll], ["y", Math.sin(ph) * Wk.roll * 0.7]], hips: [["y", -Math.sin(ph) * (Wk.hips || 0)], ["z", Math.sin(ph) * (Wk.hips || 0) * 0.4]],
          head: [["z", -Math.sin(ph) * Wk.roll * 0.5]], armR: [["x", Math.sin(ph) * Wk.swing]], armL: [["x", -Math.sin(ph) * Wk.swing]], pelvis: { drop: limp },
          body: { y: Math.abs(Math.cos(ph)) * Wk.bob } }, w);
      }
      // talking: gestures while speaking (one after another)
      if (this.talking && !moving && !o && !this.dead && !this.layer && S.talk?.length) {
        if (this.styleName === "vermeil" && S.talkClips && this.clips.talk && Math.random() < 0.5) this.playClip("talk");
        else this.emote(S.talk[Math.floor(Math.random() * S.talk.length)]);
      }
      // idle habits now and then
      if (!moving && !o && !this.layer && !this.dead && !this.talking && !this.noFidget && !this.seat) {
        this.idleTimer -= dt;
        if (this.idleTimer <= 0) {
          this.idleTimer = (this.combat ? 7 : 5) + Math.random() * 7;
          if (S.idleClips && Math.random() < 0.55) {
            const c = S.idleClips.filter((n) => this.clips[n]);
            if (c.length) this.playClip(c[Math.floor(Math.random() * c.length)]);
          } else if (S.idle?.length && (!this.combat || Math.random() < 0.4)) this.emote(S.idle[Math.floor(Math.random() * S.idle.length)]);
        }
      }
      // emote overlay
      const L = this.layer;
      if (L) {
        L.t += dt;
        const p = L.t / L.E.dur;
        if (!L.impacted && p >= (L.E.impact ?? 0.5)) { L.impacted = true; L.resImpact(); }
        addPose(pose, evalEmote(L.E, Math.min(1, p)), 1);
        if (p >= 1) { if (L.loop) L.t = 0; else this.stopEmote(); }
      }
    }
    this.applyBody(pose?.body, blob);
    if (pose && this.rigged) this.applyPose(pose, actorQuat);
    else if (pose) {               // animals / monsters without arms: only the head, jaw, tail and ears join in
      const sub = {};
      for (const k of ["neck", "head", "jaw", "tail", "ears"]) if (pose[k]) sub[k] = pose[k];
      this.applyPose(sub, actorQuat);
    }
    if (this.seat && this.rigged && !this.dead) this.applySeat(dt, actorQuat);
  }

  applyBody(b, blob) {
    const r = this.root, base = this.base;
    let x = base.x, y = base.y, z = base.z, rx = base.rx, rz = base.rz, ry = base.ry, sx = base.sx, sy = base.sy, sz = base.sz;
    const h = this.height || 1.7;
    if (b) {
      x += (b.x || 0) * h * 0.5; y += (b.y || 0) * h * 0.5; z += (b.z || 0) * h * 0.5;
      if (b.fall) { rx += -b.fall * Math.PI / 2 * 0.98; y += b.fall * 0.15; }
      if (b.spin) ry += b.spin;
    }
    if (blob) {
      y += (blob.y || 0) * h * 0.5; z += (blob.z || 0) * h * 0.6;
      sx *= blob.sx || 1; sy *= blob.sy || 1; sz *= blob.sx || 1;
      rz += blob.rz || 0;
      if (blob.fall) { rz += blob.fall * Math.PI / 2; y += blob.fall * 0.1 * h; }
    }
    r.position.set(x, y, z);
    r.rotation.set(rx, ry, rz);
    r.scale.set(sx, sy, sz);
  }

  /** rotate one bone by a delta given in the character's frame (mirrored for left-side bones) */
  rotateBone(bone, rots, actorQuat, mirror = false) {
    _q.identity();
    for (const [ax, ang] of rots) {
      if (!ang) continue;
      _q2.setFromAxisAngle(AX[ax], (mirror && ax !== "x") ? -ang : ang);
      _q.multiply(_q2);
    }
    if (actorQuat) _q.premultiply(actorQuat).multiply(_aq.copy(actorQuat).invert());
    bone.parent.getWorldQuaternion(_pw);
    const inv = _q2.copy(_pw).invert();
    bone.quaternion.premultiply(_pw).premultiply(_q).premultiply(inv);     // local' = parentW^-1 * delta * parentW * local
    bone.updateMatrixWorld(true);
  }

  applyPose(pose, actorQuat) {
    this.root.updateMatrixWorld(true);
    // 1. where the feet are now (from the clip), before we bend the body
    const legsOn = this.legs.length === 2 && (pose.pelvis || pose.stance || pose.hips);
    const targets = [];
    if (legsOn) for (const L of this.legs) {
      const T = L.shin.localToWorld(_v1.copy(L.endLocal)).clone();
      targets.push({ L, T, footQ: L.foot ? L.foot.getWorldQuaternion(new THREE.Quaternion()) : null });
    }
    // 2. pelvis: drop / shift (in the character frame, scaled by height), then rotations
    const pel = this.bones.pelvis;
    if (pel && pose.pelvis) {
      const h = this.height || 1.7, P = pose.pelvis;
      const off = _v2.set((P.x || 0) * h, -(P.drop || 0) * h, (P.z || 0) * h);
      if (actorQuat) off.applyQuaternion(actorQuat);
      const wp = pel.getWorldPosition(_v3).add(off);
      pel.position.copy(pel.parent.worldToLocal(wp));
      pel.updateMatrixWorld(true);
    }
    const order = [["hips", this.bones.pelvis], ["spine", this.bones.spine], ["chest", this.bones.chest || this.bones.spine], ["neck", this.bones.neck], ["head", this.bones.head],
      ["shoulderR", this.bones.shoulderR], ["shoulderL", this.bones.shoulderL], ["armR", this.bones.armR], ["armL", this.bones.armL], ["foreR", this.bones.foreR], ["foreL", this.bones.foreL],
      ["handR", this.bones.handR], ["handL", this.bones.handL], ["jaw", this.bones.jaw], ["wingR", this.bones.wingR], ["wingL", this.bones.wingL]];
    const seen = new Set();
    let armsDone = false;
    for (const [k, bone] of order) {
      if (!armsDone && (k === "armR" || k === "armL")) { armsDone = true; this.armIK(pose, actorQuat); }
      let rots = pose[k];
      if (!rots || !bone || (seen.has(bone) && k !== "chest")) continue;
      seen.add(bone);
      const side = k.endsWith("L") ? "L" : "R";
      const ik = (k === "armR" || k === "armL" || k === "foreR" || k === "foreL") ? pose["ik" + side] : null;
      if (ik && ik.w > 0.01 && this.arms[side]) continue;     // that arm is placed by IK below
      if (k === "armR" || k === "armL") {                 // 'tw' = twist the upper arm around itself
        const tw = rots.filter((r) => r[0] === "tw").reduce((a, r) => a + r[1], 0);
        rots = rots.filter((r) => r[0] !== "tw");
        this.rotateBone(bone, rots, actorQuat, side === "L");
        if (tw) { bone.quaternion.multiply(_q.setFromAxisAngle(AX.y, tw * this.twistSign[side])); bone.updateMatrixWorld(true); }
        continue;
      }
      if (k === "foreR" || k === "foreL") {               // x = bend the elbow (the rig's own hinge); y/z in the character frame
        const flex = rots.filter((r) => r[0] === "x").reduce((a, r) => a + r[1], 0);
        const other = rots.filter((r) => r[0] !== "x");
        if (other.length) this.rotateBone(bone, other, actorQuat, side === "L");
        if (flex) { bone.quaternion.multiply(_q.setFromAxisAngle(AX.x, -flex * this.flexSign[side])); bone.updateMatrixWorld(true); }
        continue;
      }
      this.rotateBone(bone, rots, actorQuat, side === "L" && k !== "chest" && k !== "neck" && k !== "head" && k !== "hips" && k !== "spine" && k !== "jaw");
    }
    // legs that have no IK still get their own rotations
    if (!legsOn) for (const k of ["thighR", "thighL"]) if (pose[k] && this.bones[k]) this.rotateBone(this.bones[k], pose[k], actorQuat, k.endsWith("L"));
    // 3. legs: plant the feet back where they were (wider for a stance), knees bend forward
    if (legsOn) {
      const h = this.height || 1.7;
      const fwd = _v4.set(0, 0, 1); if (actorQuat) fwd.applyQuaternion(actorQuat);
      const side = _v5.set(1, 0, 0); if (actorQuat) side.applyQuaternion(actorQuat);
      for (const { L, T, footQ } of targets) {
        if (pose.stance) T.addScaledVector(side, -L.side * pose.stance * h);
        if (!L.footIsChild && L.foot && pose.stance) {
          const lp = L.foot.parent.worldToLocal(T.clone()); L.foot.position.copy(lp); L.foot.updateMatrixWorld(true);
        }
        this.solveLeg(L, T, fwd);
        if (L.footIsChild && footQ) {           // keep the foot's angle on the ground
          L.shin.getWorldQuaternion(_qa);
          L.foot.quaternion.copy(_qa.invert().multiply(footQ));
          L.foot.updateMatrixWorld(true);
        }
      }
    }
    // 4. fingers and thumbs curl (bone-local axis), tails and ears sway
    for (const s of ["R", "L"]) {
      const c = pose["fingers" + s];
      if (c) this.curl(this.fingers[s], c, s);
      if (c && this.thumbs[s].length) this.curl(this.thumbs[s], c * 0.5, s);
    }
    this.applyChains(pose, actorQuat);
  }

  applyChains(pose, actorQuat) {
    if (pose.tail && this.chains.tail.length) {
      const f = flat(pose.tail), n = this.chains.tail.length;
      this.chains.tail.forEach((b, i) => this.rotateBone(b, [["y", f.y * (0.5 + i / n) / n * 1.6], ["x", f.x * 0.6 / n]], actorQuat));
    }
    if (pose.ears) for (const s of ["earL", "earR"]) {
      const f = flat(pose.ears), ch = this.chains[s];
      ch.forEach((b) => this.rotateBone(b, [["x", f.x / ch.length]], actorQuat, s === "earL"));
    }
  }

  /** curl: 1 = fist, 0 = relaxed, negative = spread open. Rotates each finger segment around its own X axis. */
  curl(list, amount, side) {
    const a = clamp(amount, -1, 1);
    for (const b of list) {
      const seg = /1[lr]?$|01[lr]$|^fist[lr]?$/i.test(b.name) ? 0.8 : 1.0;
      const ang = a > 0 ? a * 1.25 * seg : a * 0.25;
      _q.setFromAxisAngle(AX.x, ang * (this.curlSign || 1) * (this.curlSignS?.[side] || 1));
      b.quaternion.multiply(_q);
      b.updateMatrixWorld(true);
    }
  }

  /** hands to their IK targets (blended with where the clip had them by the target's weight) */
  armIK(pose, actorQuat) {
    for (const s of ["R", "L"]) {
      const ik = pose["ik" + s], A = this.arms[s];
      if (!ik || !A || ik.w <= 0.01) continue;
      const out = s === "R" ? -1 : 1;
      const off = new THREE.Vector3(ik.x * out, ik.y, ik.z).multiplyScalar(this.sw);
      const pole = new THREE.Vector3(ik.px * out, ik.py, ik.pz);
      if (actorQuat) { off.applyQuaternion(actorQuat); pole.applyQuaternion(actorQuat); }
      const T = this.landmark(ik.at, s, actorQuat).add(off);
      const C = A.shin.localToWorld(A.endLocal.clone());
      this.solveLeg(A, C.lerp(T, clamp(ik.w, 0, 1)), pole.normalize());
    }
  }

  /** analytic two-bone IK: thigh+shin so the ankle reaches T, knee pointing toward `pole` */
  solveLeg(L, T, pole) {
    const A = L.thigh.getWorldPosition(new THREE.Vector3());
    const B = L.shin.getWorldPosition(new THREE.Vector3());
    const C = L.shin.localToWorld(L.endLocal.clone());
    const la = A.distanceTo(B), lb = B.distanceTo(C);
    const toT = T.clone().sub(A);
    const d = clamp(toT.length(), Math.abs(la - lb) + 1e-4, la + lb - 1e-4);
    const dir = toT.normalize();
    const cosA = clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const K = A.clone().addScaledVector(dir, cosA * la).addScaledVector(p, sinA * la);
    this.aimBone(L.thigh, B.clone().sub(A), K.clone().sub(A));
    const B2 = L.shin.getWorldPosition(new THREE.Vector3());
    const C2 = L.shin.localToWorld(L.endLocal.clone());
    this.aimBone(L.shin, C2.sub(B2), T.clone().sub(B2));
  }

  aimBone(bone, from, to) {
    if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
    _q.setFromUnitVectors(from.normalize(), to.normalize());
    bone.parent.getWorldQuaternion(_pw);
    const inv = _q2.copy(_pw).invert();
    bone.quaternion.premultiply(_pw).premultiply(_q).premultiply(inv);
    bone.updateMatrixWorld(true);
  }
}

const REST = { armR: [["z", 1.25]], armL: [["z", 1.25]], foreR: [["x", -0.25]], foreL: [["x", -0.25]] };

function walkPose(t) {
  const s = Math.sin(t);
  return { armR: [["x", s * 0.5]], armL: [["x", -s * 0.5]], thighR: [["x", -s * 0.5]], thighL: [["x", s * 0.5]], body: { y: Math.abs(Math.cos(t)) * 0.04 } };
}

export function describeReport(report) {
  const c = { clip: 0, procedural: 0, missing: 0 };
  for (const v of Object.values(report)) c[v.startsWith("clip") ? "clip" : v] += 1;
  return c;
}
export const EMOTES = Object.keys(EMOTE);
export function stylesInfo() { return Object.fromEntries(Object.entries(STYLES).map(([k, v]) => [k, { greet: v.greet, victory: v.victory, idle: v.idle }])); }
