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
import { inPlace } from "./inplace.js";

// "mixamorigLeftArm_09_27" -> "leftarm" (game rips stack several numbers on the end); spaces count as _ ("leg left knee adj 2")
const clean = (n) => String(n || "").replace(/^mixamorig:?/i, "").replace(/\s+/g, "_").replace(/([_.]?\d+)+$/, "").toLowerCase();
const HELPER = /drv|driver|twist|helper|corrective|roll\b|^bk[_]|_ex$|^ex_|[_]ex[_]|nub$|end$|^end|_end_|tip$|_top$|target|pole|ik[_]|[_]ik$|offset|socket|attach|weapon|prop|^unused|_adj(_|$)|_adj[lr]$|_sub$|_mesh|^lod|lod\d|skin$|^pointlight|_def$|_mnt|^c_|ctrl|control|_(ik|fk)[lrx]?$|^deform_|scale_fix/;     // the last ones: an animator's handles (Auto-Rig Pro, Unreal), not the body
const FACE = /brow|eye|lid|lash|lip|teeth|tooth|tongue|cheek|nose|forehead|face|mouth|chin|squint|smile|pupil/;
const JAW = /^jaw|lowerjaw|jaw$|lowerbeak/;
const FINGER = /finger|thumb|index|middle|(^|_|hand)ring|pinky|little|digit|claw|^f_|knuckle|handsub/;
const TRUNK = /spine|neck|waist|pelvis|hip|chest|torso/;     // "spine_middle" isn't a finger (Piccolo's whole body hung under it)
const HAND = /hand|wrist|palm|paw/;
// short words only count as whole words ("elbow" is not a bow, "forearm" has no ear)
const SOFT = /hair|capillary|turban|skirt|cloth|cape|cloak|dress|feeler|ribbon|tail|(^|[_ ])ears?([_ ]|[lr]?$)|coat|scarf|bust|breast|chain|string|(^|_)tie(_|$)|sleeve|hood|jiggle|phys|dyn|spring|accessor|(^|_)belt|(^|_)bag(_|$)|antenna|tentacle|(^|_)fin(_|$)|frill|(^|_)bow(_|$)|(^|_)lace(_|$)|braid|ponytail|(^|_)bangs?(_|$)|fringe|veil|wing|flap|apron|robe|gown|petal|leaf/;
const SPINE = /hip|pelvis|cog|waist|spine|chest|torso|abdomen|belly|root|neck|head|origin|center|centre|body|upperchest/;
const ARM = /shoulder|collar|clavicle|upperarm|upper_arm|arm(?!ature)|elbow|forearm|lowerarm/;      // "armature" isn't an arm
const LEG = /thigh|upleg|upperleg|leg|knee|shin|calf|lowerleg|ankle|foot|toe|heel/;

// body words that "hand.l" leaves behind once three.js drops the dot: "handl", "shoulderr", "toes_01l"
const LIMB_END = "(arm|hand|wrist|palm|leg|foot|toes?|thigh|shin|calf|knee|elbow|shoulder|clavicle|ankle|\\d)";
/** "L" / "R" / "": L_arm, LThigh, upper_armL (three.js drops the dot of upper_arm.L), LeftHand, hand_l, handl; game rips number them on top: wristL_440 */
function side(name) {
  const n = String(name || "").replace(/([_.]?\d+)+$/, "");
  for (const [s, w] of [["L", "left"], ["R", "right"]]) {
    if (new RegExp(`(^|[^a-zA-Z])${s}([^a-zA-Z]|$)`, "i").test(n) || new RegExp(`^${s}(?=[A-Z])`).test(n) ||
        new RegExp(`[a-z]${s}$`).test(n) || new RegExp(`${LIMB_END}${s.toLowerCase()}$`).test(n) || new RegExp(w, "i").test(n)) return s;
  }
  return "";
}

const NAME_WORDS = ["hips", "hip", "hair", "head", "hand", "neck", "arm", "leg", "left", "right", "spine", "foot", "toe", "shoulder", "chest", "thigh", "tail", "wing", "finger", "root"];
/** what most bone names start with, when that's a name rather than a body part: "NarutoLeftArm" -> "naruto" */
function namePrefix(names) {
  const first = names.filter(Boolean)[Math.floor(names.length / 2)] || "";
  for (let n = Math.min(first.length, 16); n >= 3; n--) {
    const pre = first.slice(0, n);
    if (names.filter((x) => x.startsWith(pre)).length < names.length * 0.85) continue;
    if (/^(left|right|spine|bone|joint|root|mixamo|bip|def|l_|r_)/.test(pre)) return "";
    // "narutoHips", "narutoHair": the letter they happen to share belongs to the body part
    for (const w of NAME_WORDS) for (let k = w.length - 1; k > 0; k--) {
      const cut = pre.slice(0, -k);
      if (pre.endsWith(w.slice(0, k)) && names.some((x) => x.startsWith(cut + w))) return cut;
    }
    return pre;
  }
  return "";
}

/** Sort the bones of a loaded glTF scene. */
export function analyzeRig(root) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  const kind = new Map();
  const prefix = namePrefix(bones.map((b) => clean(b.name)));
  const nameOf = (b) => { const n = clean(b.name); return prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n; };
  for (const b of bones) {
    const n = nameOf(b);
    let k = "other";
    if (HELPER.test(n)) k = "helper";
    else if (JAW.test(n)) k = "jaw";
    else if (FACE.test(n)) k = "face";
    else if (SOFT.test(n)) k = "soft";
    else if (FINGER.test(n) && !TRUNK.test(n)) k = "finger";
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
  const named = (re) => bones.filter((b) => re.test(nameOf(b)));
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
  const feet = bones.filter((b) => /foot|ankle|toe|heel/.test(nameOf(b)) && body.has(b));
  const jawBone = bones.find((b) => /lowerjaw|lower_jaw|lowerbeak/.test(nameOf(b))) || bones.find((b) => kind.get(b) === "jaw" && !/upper|root/.test(nameOf(b))) || bones.find((b) => kind.get(b) === "jaw") || null;
  // the head: called that, or what the jaw hangs from ("head_neck_upper" with "head_jaw" under it), or anything like it
  let aboveJaw = jawBone?.parent;
  while (aboveJaw?.isBone && !body.has(aboveJaw)) aboveJaw = aboveJaw.parent;
  // last of the spine: a chain with no name for its head ("spine.005"), the highest bone with nothing of the body above it
  const spineEnd = () => bones.filter((b) => kind.get(b) === "spine" && body.has(b) && !b.children.some((c) => c.isBone && kind.get(c) === "spine"))
    .sort((a, b) => b.getWorldPosition(new THREE.Vector3()).y - a.getWorldPosition(new THREE.Vector3()).y)[0] || null;
  const head = named(/^head\d*$|(^|_)head$|^head_?\d|spine\.?006/).find((b) => body.has(b)) || (aboveJaw?.isBone ? aboveJaw : null)
    || named(/head/).find((b) => body.has(b) && !/neck|jaw/.test(nameOf(b))) || spineEnd();
  const hipsRe = (re) => bones.find((b) => body.has(b) && re.test(nameOf(b)) && !side(b.name));
  const hips = hipsRe(/^hips?$|pelvis/) || hipsRe(/hip/) || hipsRe(/cog|waist/) || hipsRe(/root/) || bones.find((b) => body.has(b)) || null;
  const arms = {};
  for (const s of ["L", "R"]) {
    const list = bones.filter((b) => side(b.name) === s && body.has(b));
    const upper = list.find((b) => /upperarm|upper_arm|^arm$|^larm|^rarm|arm[lr]?$/.test(nameOf(b)) && !/fore|lower/.test(nameOf(b)));
    // the second arm bone can just be "arm_02": the arm bone under the upper arm
    const lower = list.find((b) => /forearm|lowerarm|elbow/.test(nameOf(b))) || upper?.children.find((c) => c.isBone && kind.get(c) === "arm") || null;
    // no bone called an arm at all ("arm_left_shoulder_2" > "arm_left_elbow"): what the elbow hangs from
    const above = !upper && lower?.parent?.isBone && kind.get(lower.parent) === "arm" ? lower.parent : null;
    if (upper || above) arms[s] = { upper: upper || above, lower, hand: hands[s]?.hand || null };
  }
  return { bones, kind, body, soft, hands, feet, head, hips, arms, jaw: jawBone, prefix,
    neck: named(/neck/).find((b) => body.has(b) && b !== head) || null,
    chest: named(/chest|spine2|spine\.?003|upperchest|spine_upper|spine_02/).find((b) => body.has(b)) || null };
}

const HAIR_NAME = /hair|bangs?(_|$)|fringe|braid|ponytail|sideburn|ahoge/;
const NOT_CLOTH = /tail|(^|[_ ])ears?([_ ]|[lr]?$)|bust|breast|antenna|tentacle|(^|_)fin(_|$)|wing|petal|leaf/;
/** The rigger's colours: bone -> "hands" / "hair" / "clothes". A hand and its fingers; soft bones by name, and a soft
 *  bone with a meaningless name ("bone_12") by where it hangs: from the head it's hair, from the body it's clothes.
 *  Tails, ears and the like aren't in the map. */
export function rigRegions(info) {
  const out = new Map();
  for (const h of Object.values(info.hands)) {
    h.hand.traverse((b) => { if (b.isBone && ["hand", "finger"].includes(info.kind.get(b))) out.set(b, "hands"); });
  }
  const ownName = (b) => {                       // a chain's own name is on its first bone too: "hair_1" > "bone_03"
    for (let x = b; x && x.isBone && info.kind.get(x) === "soft"; x = x.parent) {
      const n = clean(x.name);
      if (HAIR_NAME.test(n)) return "hair";
      if (NOT_CLOTH.test(n)) return "";
    }
    return null;
  };
  const underHead = (b) => { for (let p = b.parent; p && p.isBone; p = p.parent) if (p === info.head) return true; return false; };
  for (const b of info.soft) {
    const own = ownName(b);
    if (own === "") continue;
    out.set(b, own || (underHead(b) && !SOFT_CLOTHES.test(clean(b.name)) ? "hair" : "clothes"));
  }
  return out;
}
const SOFT_CLOTHES = /skirt|cloth|cape|cloak|dress|coat|scarf|sleeve|hood|ribbon|robe|gown|apron|veil|frill|lace|tie/;

/** Is the model standing in its rest pose (a T- or A-pose)? UniMate animates changes FROM the rest pose, so a model
 *  saved crouching or lying (a "vs" poster pose) gives crouched, broken clips. Returns "" if fine, else why not. */
export function restPoseProblem(info, root) {
  if (!info.head || !info.feet.length) return "";
  // measured on the mesh as it's drawn (a model's bones can say "T-pose" while its skin was bound crouching)
  root.updateMatrixWorld(true);
  const thigh = info.bones.find((b) => info.kind.get(b) === "leg" && info.kind.get(b.parent) !== "leg");
  const hipsBone = thigh?.parent || info.hips;
  const groups = { head: new Set(), hips: new Set(), feet: new Set(info.feet) };
  info.head.traverse((o) => { if (o.isBone && info.kind.get(o) !== "soft") groups.head.add(o); });
  if (hipsBone) groups.hips.add(hipsBone);
  const sum = { head: [0, 0], hips: [0, 0], feet: [0, 0] }, v = new THREE.Vector3(), all = new THREE.Vector3();
  const bodyXs = [];
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    m.skeleton.update();
    const step = Math.max(1, Math.floor(pos.count / 5000));
    for (let i = 0; i < pos.count; i += step) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const bone = m.skeleton.bones[best];
      if (!bone) continue;
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(groups)) if (groups[k].has(bone)) { sum[k][0] += v.y; sum[k][1]++; }
      bodyXs.push(v.y);
    }
  });
  if (!sum.head[1] || !sum.feet[1] || !sum.hips[1]) return "";
  const y = (k) => sum[k][0] / sum[k][1];
  const legs = y("hips") - y("feet"), torso = y("head") - y("hips");
  if (torso <= 0) return "its head is below its hips (it's upside down or lying down)";
  if (legs < torso * 0.45) return "its legs are folded up (it's crouching, kneeling or sitting)";
  return "";
}

/** How high the floor is under a standing model (world space): under its feet, even when a gown, coat or tail reaches
 *  lower than them (those settle on the floor). The soles count: when the lowest point is only a little under the skin
 *  of the feet, it's a shoe, not clothes. No feet or no skin: the model's lowest point, as before. */
export function floorUnder(root, info) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const feet = new Set(info.feet);
  if (!feet.size) return box.min.y;
  let low = Infinity;
  const v = new THREE.Vector3();
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    m.skeleton.update();
    for (let i = 0; i < pos.count; i++) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      if (!feet.has(m.skeleton.bones[best])) continue;
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
      if (v.y < low) low = v.y;
    }
  });
  const height = box.max.y - box.min.y;
  if (low === Infinity || low - box.min.y < height * 0.025) return box.min.y;
  return low;
}

/** names the analysis puts on the body (Python sends only these to UniMate too; see skills/slimrig.py) */
export function bodyNames(info) { return [...info.body].map((b) => b.name); }

// ---------------- clips ----------------
const ONCE = /^(sit|jump|lie|lounge|crouch|book_take|book_put|cheer|stretch|yawn|shrug|bow|nod|shake|point|pushup|plank|roar|claw|bite|slash|tail_swing|breathe_fire|hurt|faint|attack)$/i;
// the moves of Body type -> Monster (the keys of MONSTER_MOTIONS in rigger.js and PROMPTS in skills/animate.py)
export const MONSTER_NAMES = ["fly", "hover", "hover_go", "float", "glide", "roar", "stomp", "claw", "bite", "tail_swing", "wing_flap", "breathe_fire", "crawl", "prowl", "charge", "hurt", "faint"];
// in the air: not put back on the floor, and the room doesn't take their height out
export const FLOATING = /^(fly|hover|float|glide|levitate)/i;

/** the body type picked when it was animated: kept on the model's top object, which the file saves as a node under the scene */
export function bodyOf(root) {
  return root.userData?.body || root.children?.find((c) => c.userData?.body)?.userData.body || "";
}

/** what the scan found, in a few words (the rigger shows it) */
export function scanSummary(info) {
  const count = (k) => info.bones.filter((b) => info.kind.get(b) === k).length;
  const wings = new Set(info.soft.filter((b) => /wing/.test(clean(b.name))).map((b) => side(b.name) || "x")).size;
  const tail = info.soft.some((b) => /tail/.test(clean(b.name)));
  const hands = Object.values(info.hands).map((h) => (h.count ? `${h.count}-finger hand` : "paw"));
  const parts = [info.head && "head", info.jaw && "jaw", Object.keys(info.arms).length && `${Object.keys(info.arms).length} arms`,
    hands.length && `${hands.length === 2 && hands[0] === hands[1] ? `2 × ${hands[0]}` : hands.join(", ")}`,
    info.feet.length && "legs and feet", tail && "tail", wings && `${wings} wing${wings > 1 ? "s" : ""}`].filter(Boolean);
  const rest = [["swinging", info.soft.length], ["face", count("face")], ["helper", count("helper")]].filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
  return `Found: ${parts.join(", ") || "no body parts"}${rest.length ? ` (${rest.join(", ")} bones)` : ""}.`;
}

/** how far a cloud of points spreads along its three main directions, biggest first */
function spreads(pts) {
  const n = pts.length, m = [0, 0, 0];
  for (const p of pts) for (let i = 0; i < 3; i++) m[i] += p[i] / n;
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += (p[i] - m[i]) * (p[j] - m[j]) / n;
  for (let sweep = 0; sweep < 12; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {     // Jacobi: turn until nothing's left off the diagonal
    if (Math.abs(c[p][q]) < 1e-12) continue;
    const th = 0.5 * Math.atan2(2 * c[p][q], c[q][q] - c[p][p]), s = Math.sin(th), co = Math.cos(th);
    for (let k = 0; k < 3; k++) { const a = c[k][p], b = c[k][q]; c[k][p] = co * a - s * b; c[k][q] = s * a + co * b; }
    for (let k = 0; k < 3; k++) { const a = c[p][k], b = c[q][k]; c[p][k] = co * a - s * b; c[q][k] = s * a + co * b; }
  }
  return [c[0][0], c[1][1], c[2][2]].map((v) => Math.sqrt(Math.max(v, 0))).sort((a, b) => b - a);
}

/** The mesh's points that move with each bone: bone -> [[x, y, z], ...], world space */
function pointsByBone(root) {
  const out = new Map(), v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    m.skeleton.update();
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const b = m.skeleton.bones[best];
      if (!b) continue;
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
      if (!out.has(b)) out.set(b, []);
      out.get(b).push([v.x, v.y, v.z]);
    }
  });
  return out;
}

/** What this body can do, from its shape; names can't tell (Charizard's wings are "LFeeler1", Lugia's are its arms and fingers).
 *  A wing is a limb on the body's side that's long, broad and flat. -> { wings: [first bones], legs, tail, travel } where travel is
 *  "walk" (legs), "both" (legs and wings), "fly" (wings, no legs) or "float" (neither). */
export function bodyPlan(root, info) {
  if (!info.bones.length) return { wings: [], legs: false, tail: false, travel: "still", seen: [] };      // no rig at all: it can't move until it has one
  const by = pointsByBone(root), all = [...by.values()].flat();
  if (!all.length) return { wings: [], legs: info.feet.length > 0, tail: false, travel: info.feet.length ? "walk" : "float", seen: [] };
  const height = Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1])) || 1;
  const midX = (info.hips || root).getWorldPosition(new THREE.Vector3()).x;
  const size = Math.max(height, Math.max(...all.map((p) => p[2])) - Math.min(...all.map((p) => p[2])));
  const wings = [], seen = [], spans = new Map();
  for (const b of info.bones) {
    const k = info.kind.get(b), up = info.kind.get(b.parent);
    if (!side(b.name) || !["soft", "arm"].includes(k) || !b.parent?.isBone || (up !== "spine" && !(k === "soft" && up === "arm"))) continue;
    const pts = [];
    b.traverse((o) => { if (o.isBone && by.has(o) && !["spine", "leg"].includes(info.kind.get(o))) pts.push(...by.get(o)); });
    if (pts.length < 12) continue;
    const [s1, s2, s3] = spreads(pts);
    const reach = Math.max(...pts.map((p) => Math.abs(p[0] - midX)));
    const named = /wing/.test(clean(b.name));
    const flat = s2 / (s3 || 1e-6), broad = s2 / (s1 || 1e-6);
    const isWing = named || (reach > size * 0.3 && broad > 0.28 && flat > 3 && !SOFT_CLOTHES.test(clean(b.name)));     // a cape is flat too
    seen.push([clean(b.name), +(reach / size).toFixed(2), +broad.toFixed(2), +flat.toFixed(2), isWing ? "WING" : ""]);
    if (isWing) { wings.push(b); spans.set(b, reach / size); }
  }
  // a limb inside a wing that's already counted isn't a second wing: both would beat at once
  for (const w of wings.slice()) { for (let p = w.parent; p?.isBone; p = p.parent) if (wings.includes(p)) { wings.splice(wings.indexOf(w), 1); break; } }
  const legs = info.bones.some((b) => info.kind.get(b) === "leg") && info.feet.length > 0;
  const tail = info.bones.some((b) => /tail/.test(clean(b.name)));
  const hasWings = wings.length > 0;
  // arms this long are wings all the way (Lugia's): they can't hang at the sides like an arm with a fin on it (Garchomp's)
  const bigWings = wings.filter((w) => spans.get(w) > 0.55);
  return { wings, bigWings, legs, tail, travel: legs ? (hasWings ? "both" : "walk") : hasWings ? "fly" : "float", seen };
}

/** wings, a tail or no legs: suggests Body type -> Monster */
export function looksLikeMonster(info) {
  return info.bones.length > 0 && (!info.feet.length || info.bones.some((b) => /wing|tail/.test(clean(b.name))));
}

/** A body drawn as see-through is seen through itself: without depth, its back shows over its front (some exports mark everything that
 *  way, for a mask in the texture's alpha). The big meshes of a model are drawn solid. Holes that are really holes (lace) stay holes. */
export function solidBodies(root) {
  const meshes = [];
  root.traverse((m) => { if (m.isMesh) meshes.push(m); });
  const total = meshes.reduce((s, m) => s + m.geometry.attributes.position.count, 0) || 1;
  let fixed = 0;
  for (const m of meshes) {
    for (const mat of [].concat(m.material)) {
      if (/sten|fire|flame/i.test(mat.map?.name || "")) {      // a game's flame: its black is nothing and its white is light, never a black and white stripe
        mat.transparent = true; mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; mat.color.set(0xff9a3c); mat.needsUpdate = true;
        continue;
      }
      if (!mat.transparent || mat.opacity < 0.99 || m.geometry.attributes.position.count < total * 0.15) continue;
      mat.transparent = false; mat.depthWrite = true; mat.alphaTest = alphaHoles(mat.map) ? 0.5 : 0; mat.needsUpdate = true;
      fixed++;
    }
  }
  return fixed;
}

/** does the picture have real holes: most of it solid and a good part fully clear? (A mask for shine has soft values all over.) */
function alphaHoles(tex) {
  const img = tex?.image;
  if (!img?.width) return false;
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 48;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, 48, 48);
    const d = g.getImageData(0, 0, 48, 48).data;
    let clear = 0, solid = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] < 16) clear++; else if (d[i] > 240) solid++; }
    return clear + solid > 48 * 48 * 0.9 && clear > 48 * 48 * 0.03;
  } catch { return false; }
}

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
const ARMS_FREE = /wave|cheer|jump|dance|stretch|press|jacks|clap|point|shrug|pushup|plank|row|curl|deadlift|swim|fly|hover|float|glide|roar|claw|stomp|slash|charge|attack|hug|yawn|book|type|sit|lie|lounge/i;

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

/** how far the feet move sideways in a clip, compared with the body's size (hips to head): ~0 standing, ~0.5 walking */
function footTravel(root, info, clip) {
  const feet = info.feet.filter((f) => /foot|ankle/.test(clean(f.name)));
  if (!feet.length || !info.head || !info.hips) return 0;
  root.updateMatrixWorld(true);
  const size = info.head.getWorldPosition(new THREE.Vector3()).distanceTo(info.hips.getWorldPosition(new THREE.Vector3())) || 1;
  const saved = info.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const mixer = new THREE.AnimationMixer(root);
  const act = mixer.clipAction(clip).play();
  const pts = feet.map(() => []);
  for (let i = 0; i <= 16; i++) {
    act.time = clip.duration * i / 16; mixer.update(0); root.updateMatrixWorld(true);
    feet.forEach((f, k) => pts[k].push(f.getWorldPosition(new THREE.Vector3())));
  }
  act.stop(); mixer.uncacheRoot(root);
  info.bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
  root.updateMatrixWorld(true);
  let most = 0;
  for (const p of pts) for (const a of p) for (const b of p) most = Math.max(most, Math.hypot(a.x - b.x, a.z - b.z));
  return most / size;
}

/** A calm standing idle made here: feet planted, slow breathing in the chest, the head drifting a little.
 *  (relaxArms then lowers the arms.) Used when UniMate's idle steps around. */
export function makeCalmIdle(root, info = analyzeRig(root), name = "idle") {
  const LEN = 6, FPS = 15, n = LEN * FPS + 1;
  const times = Float32Array.from({ length: n }, (_, i) => i / FPS);
  const moves = [[info.chest, { x: [0.025, 2, 0] }], [info.neck, { x: [0.015, 2, 0.6], y: [0.02, 1, 1.3] }],
    [info.head, { x: [0.02, 1, 2.1], y: [0.04, 1, 0.4], z: [0.015, 2, 1.7] }],
    [info.hips, { z: [0.01, 1, 0.9] }]].filter(([b]) => b);
  const tracks = [];
  for (const [bone, m] of moves) {
    const rest = bone.quaternion.clone(), vals = new Float32Array(n * 4), e = new THREE.Euler(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * Math.PI * 2;
      const ang = (k) => (m[k] ? m[k][0] * Math.sin(t * m[k][1] + m[k][2]) : 0);
      e.set(ang("x"), ang("y"), ang("z"));
      q.setFromEuler(e).premultiply(rest).toArray(vals, i * 4);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, vals));
  }
  return new THREE.AnimationClip(name, LEN, tracks);
}

/** A looping clip whose body travels far (a walk that goes forward, or one saved earlier with the travel squeezed back
 *  into its last frames): keep each moving bone's sideways/forward position at its average - walking in place, the
 *  room moves her itself. The up-and-down bob and the legs' stride stay. Returns true when it changed something. */
function pinTravel(root, info, clip) {
  if (!info.head || !info.hips) return false;
  root.updateMatrixWorld(true);
  const size = info.head.getWorldPosition(new THREE.Vector3()).distanceTo(info.hips.getWorldPosition(new THREE.Vector3())) || 1;
  let changed = false;
  for (const t of clip.tracks) {
    if (!t.name.endsWith(".position")) continue;
    const bone = info.bones.find((b) => b.name === t.name.split(".")[0]);
    if (!bone?.parent) continue;
    const q = bone.parent.getWorldQuaternion(new THREE.Quaternion()), qi = q.clone().invert();
    const s = bone.parent.getWorldScale(new THREE.Vector3()).y || 1;
    const n = t.times.length, w = [];
    for (let i = 0; i < n; i++) w.push(new THREE.Vector3().fromArray(t.values, i * 3).multiplyScalar(s).applyQuaternion(q));
    const mx = w.reduce((a, v) => a + v.x, 0) / n, mz = w.reduce((a, v) => a + v.z, 0) / n;
    const reach = Math.max(...w.map((v) => Math.hypot(v.x - mx, v.z - mz)));
    if (reach < size * 0.15) continue;                  // a little sway: leave it
    w.forEach((v, i) => { v.x = mx; v.z = mz; v.applyQuaternion(qi).divideScalar(s).toArray(t.values, i * 3); });
    changed = true;
  }
  return changed;
}

/** A clip the model came with moves its wings, tail, fingers or face too; what UniMate made (saved by _merge) moves only
 *  the body. Those made by an artist are never "cleaned": lowering Charizard's arms pushed them into his belly. */
export function isOwnClip(clip, info) {
  if (/^[a-z_]{1,20}$/.test(clip.name)) return false;       // "walk", "tail_swing": the names ours get. Theirs are like "pm0006_walk01_loop"
  const body = new Set([...info.body].map((b) => b.name));
  const moved = new Set(clip.tracks.map((t) => t.name.split(".")[0]));
  let other = 0;
  for (const n of moved) if (!body.has(n) && info.bones.some((b) => b.name === n)) other++;
  return moved.size > 0 && other / moved.size > 0.15;
}

// what a model's own animations are called, for what the room plays. First match wins, base clips before variants.
const OWN_NAMES = [["idle", /(default)?wait\d*(_loop)?$|(^|[_|.\s])idle|breath|stand(ing)?(_|$)/i], ["walk", /walk/i], ["run", /(^|[_|.\s])run/i],
  ["roar", /roar/i], ["sleepy", /sleep/i], ["jump", /jump/i], ["happy", /glad|happy/i], ["sad", /hate|sad/i], ["surprised", /notice|surprise/i],
  ["attack", /attack/i], ["hurt", /damage|hurt/i], ["fly", /(^|_)fly/i], ["eat", /eat/i]];

/** Give a model's own clips the names the room plays ("pm0006_00_00_00030_walk01_loop" -> walk). What UniMate made under
 *  that name steps aside: an animation made for this very model is better. Returns the names it found. */
export function useOwnClips(clips, info) {
  const own = clips.filter((c) => isOwnClip(c, info));
  const found = [];
  for (const [name, re] of OWN_NAMES) {
    const hit = own.find((c) => c.name !== name && re.test(c.name) && !/_start|_end|turn|start$|end$/i.test(c.name)) || own.find((c) => c.name === name);
    if (!hit) continue;
    for (const c of clips) if (c !== hit && c.name.toLowerCase() === name) c.name = `${name}_unimate`;
    hit.userData = { ...hit.userData, ownName: hit.name };
    hit.name = name;
    found.push(name);
  }
  return found;
}

/** Feet with no toe bones: a foot's skin reaches further forward than back from the ankle. +1 / -1 / 0 as facing() */
function footShape(root, info) {
  const feet = new Set(info.feet), a = new THREE.Vector3(), v = new THREE.Vector3();
  let sum = 0, n = 0;
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    m.skeleton.update();
    for (let i = 0; i < pos.count; i++) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const bone = m.skeleton.bones[best];
      if (!feet.has(bone)) continue;
      bone.getWorldPosition(a); m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
      sum += v.z - a.z; n++;
    }
  });
  if (n < 8) return 0;
  const size = new THREE.Box3().setFromObject(root).getSize(a).y || 1;
  return Math.abs(sum / n) > size * 0.003 ? Math.sign(sum) : 0;
}

/** which way the model faces: where its toes point from its ankles at rest, or its feet's shape (+1 toward +z, -1 toward -z, 0 can't tell) */
export function facing(root, info) {
  root.updateMatrixWorld(true);
  let sum = 0, side = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (const f of info.feet) {
    for (const c of f.children) {
      if (!c.isBone || !info.feet.includes(c)) continue;
      f.getWorldPosition(a); c.getWorldPosition(b);
      sum += b.z - a.z; side += Math.abs(b.x - a.x);
    }
  }
  return Math.abs(sum) > side * 0.5 && sum !== 0 ? Math.sign(sum) : footShape(root, info);     // toes spread sideways say nothing
}

/** How a walk's feet travel while they're on the ground, along the way the model faces: negative is right (a foot on the floor
 *  goes BACK under the body), positive means the legs step backwards. 0 when it can't tell. */
export function walkDrift(root, info, clip) {
  const dir = facing(root, info);
  const feet = info.feet.filter((f) => !info.feet.includes(f.parent));
  if (!dir || !feet.length || !info.hips) return 0;
  const saved = info.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const mixer = new THREE.AnimationMixer(root);
  const act = mixer.clipAction(clip).play();
  const N = 40, track = feet.map(() => []);
  const p = new THREE.Vector3(), h = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    act.time = clip.duration * i / N; mixer.update(0); root.updateMatrixWorld(true);
    info.hips.getWorldPosition(h);
    feet.forEach((f, k) => { f.getWorldPosition(p); track[k].push([p.y, p.z - h.z]); });
  }
  act.stop(); mixer.uncacheRoot(root);
  info.bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
  root.updateMatrixWorld(true);
  let drift = 0;
  for (const rows of track) {
    const ys = rows.map((r) => r[0]), low = Math.min(...ys), high = Math.max(...ys), cut = low + (high - low) * 0.35;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (rows[i][0] <= cut && rows[j][0] <= cut) drift += (rows[j][1] - rows[i][1]) * dir;
    }
  }
  return drift;
}

/** Legs stepping backwards while the model goes forward: the clip is playing in reverse, whatever it was made from. Turn it round. */
function fixWalkDirection(root, info, clip) {
  if (!/^(walk|run|crawl|prowl|charge)/i.test(clip.name) || walkDrift(root, info, clip) <= 0) return false;
  for (const t of clip.tracks) {
    const size = t.getValueSize(), n = t.times.length, v = t.values, out = new v.constructor(v.length);
    for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) out[i * size + k] = v[(n - 1 - i) * size + k];
    t.values = out;
  }
  return true;
}

/** The arms mustn't go through the body. Measured on the model: how thick the trunk really is around its spine (a big belly
 *  counts), and for every frame the upper arm turns out just far enough for the elbow and hand to clear it. */
function keepArmsOut(root, info, clip) {
  const arms = Object.values(info.arms).filter((a) => a.upper && (a.lower || a.hand));
  const top = info.chest || info.neck || info.head;
  if (!arms.length || !info.hips || !top) return false;
  root.updateMatrixWorld(true);
  const a0 = info.hips.getWorldPosition(new THREE.Vector3()), b0 = top.getWorldPosition(new THREE.Vector3());
  const closest = (pt, a, b) => { const ab = b.clone().sub(a), t = THREE.MathUtils.clamp(pt.clone().sub(a).dot(ab) / (ab.lengthSq() || 1), 0, 1); return a.clone().addScaledVector(ab, t); };
  // the trunk's thickness: the skin that follows the spine, how far it is from the spine
  const trunk = new Set(info.bones.filter((b) => info.kind.get(b) === "spine"));
  const dists = [], v = new THREE.Vector3();
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    m.skeleton.update();
    const step = Math.max(1, Math.floor(pos.count / 3000));
    for (let i = 0; i < pos.count; i += step) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      if (!trunk.has(m.skeleton.bones[best])) continue;
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
      dists.push(v.distanceTo(closest(v, a0, b0)));
    }
  });
  if (dists.length < 20) return false;
  dists.sort((x, y) => x - y);
  const radius = dists[Math.floor(dists.length * 0.7)];
  const saved = info.bones.map((b) => [b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const mixer = new THREE.AnimationMixer(root);
  const act = mixer.clipAction(clip).play();
  let changed = false;
  for (const a of arms) {
    const name = `${a.upper.name}.quaternion`;
    const track = clip.tracks.find((t) => t.name === name);
    if (!track) continue;
    const ends = [a.lower, a.hand].filter(Boolean), n = track.times.length;
    const fix = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      act.time = track.times[i]; mixer.update(0); root.updateMatrixWorld(true);
      const s = a.upper.getWorldPosition(new THREE.Vector3());
      const ha = info.hips.getWorldPosition(new THREE.Vector3()), to = top.getWorldPosition(new THREE.Vector3());
      let worst = null, angle = 0;
      for (const e of ends) {
        const pt = e.getWorldPosition(new THREE.Vector3()), c = closest(pt, ha, to), d = pt.distanceTo(c), len = pt.distanceTo(s) || 1;
        if (d >= radius) continue;
        const need = Math.asin(Math.min(0.9, (radius - d) / len));
        if (need > angle) { angle = need; worst = { pt, c }; }
      }
      if (!worst) continue;
      const armDir = worst.pt.clone().sub(s).normalize();
      const away = s.clone().sub(closest(s, ha, to)).setY(0).normalize();           // toward the arm's own side
      const axis = armDir.clone().cross(away);
      if (axis.lengthSq() < 1e-6) continue;
      fix[i] = { axis: axis.normalize(), angle, pw: a.upper.parent.getWorldQuaternion(new THREE.Quaternion()) };
    }
    // softened over time, so the arm eases out instead of jumping
    const raw = fix.map((f) => f?.angle || 0);
    const eased = raw.map((_, i) => { let m = 0; for (let d = -3; d <= 3; d++) m = Math.max(m, raw[(i + d + n) % n] * (1 - Math.abs(d) / 4)); return m; });
    const last = fix.find(Boolean);
    if (!last) continue;
    for (let i = 0; i < n; i++) {
      if (!eased[i]) continue;
      const f = fix[i] || last;
      const turn = new THREE.Quaternion().setFromAxisAngle(f.axis, eased[i]);
      const pw = f.pw, q = new THREE.Quaternion().fromArray(track.values, i * 4);
      pw.clone().invert().multiply(turn).multiply(pw).multiply(q).normalize().toArray(track.values, i * 4);
    }
    changed = true;
  }
  act.stop(); mixer.uncacheRoot(root);
  info.bones.forEach((b, i) => { b.position.copy(saved[i][0]); b.quaternion.copy(saved[i][1]); b.scale.copy(saved[i][2]); });
  root.updateMatrixWorld(true);
  return changed;
}

/** Monster clips UniMate can't know about: wings beat, the tail swings, and a floating monster is off the ground. Bases everything on
 *  the rest pose, not on the clip's last height: a clip is cleaned again each time the model loads, and mustn't climb every time. */
function monsterExtras(root, info, clip) {
  const air = FLOATING.test(clip.name), flap = air || /^wing_flap/i.test(clip.name), tail = /^tail_swing/i.test(clip.name);
  if (!flap && !tail) return false;
  root.updateMatrixWorld(true);
  const dur = clip.duration || 2, n = 25, times = Float32Array.from({ length: n }, (_, i) => dur * i / (n - 1));
  const height = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y || 1;
  const wave = (i, speed) => Math.sin((i / (n - 1)) * Math.PI * 2 * speed);
  const swing = (bone, worldAxis, angle) => {
    const axis = worldAxis.clone().applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    const vals = new Float32Array(n * 4), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) q.setFromAxisAngle(axis, angle(i)).multiply(bone.quaternion).toArray(vals, i * 4);
    clip.tracks = clip.tracks.filter((t) => t.name !== `${bone.name}.quaternion`).concat(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, vals));
  };
  const first = (word) => info.soft.filter((b) => word.test(clean(b.name)) && !word.test(clean(b.parent?.name)));
  // the first bone of each wing, up and down around the body's front-back line
  if (flap) for (const w of first(/wing/)) {
    const out = Math.sign(w.getWorldPosition(new THREE.Vector3()).x - (info.hips || root).getWorldPosition(new THREE.Vector3()).x) || 1;
    swing(w, new THREE.Vector3(0, 0, 1), (i) => out * wave(i, 3) * 0.55);
  }
  if (tail) for (const t of first(/tail/)) swing(t, new THREE.Vector3(0, 1, 0), (i) => wave(i, 2) * 0.7);
  // off the ground, bobbing gently
  if (air && info.hips?.parent) {
    const name = `${info.hips.name}.position`, old = clip.tracks.find((t) => t.name === name);
    const up = new THREE.Vector3(0, 1, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(info.hips.parent.matrixWorld).invert());
    const unit = up.clone().normalize(), rest = info.hips.position, vals = new Float32Array(n * 3), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      p.copy(rest);
      if (old) p.fromArray(old.values, Math.round((old.times.length - 1) * i / (n - 1)) * 3);
      p.addScaledVector(unit, rest.dot(unit) - p.dot(unit)).addScaledVector(up, height * (0.28 + wave(i, 1) * 0.03)).toArray(vals, i * 3);
    }
    clip.tracks = clip.tracks.filter((t) => t !== old).concat(new THREE.VectorKeyframeTrack(name, times, vals));
  }
  return true;
}

/** the head as a box, in world space: everything on the model that moves with the head (hair and ears too), so a close-up can
 *  show all of it. null when the model has no head bone or no skin. */
export function headBox(root, info) {
  if (!info.head) return null;
  root.updateMatrixWorld(true);
  const group = new Set();
  info.head.traverse((o) => { if (o.isBone) group.add(o); });
  const box = new THREE.Box3(), v = new THREE.Vector3();
  root.traverse((m) => {
    if (!m.isSkinnedMesh || !m.visible) return;
    const pos = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    m.skeleton.update();
    for (let i = 0; i < pos.count; i++) {
      let best = -1, bw = 0;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      if (!group.has(m.skeleton.bones[best])) continue;
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); box.expandByPoint(v);
    }
  });
  return box.isEmpty() ? null : box;
}

/** the mouth rig: opens the jaw by amount (0-1) on top of whatever the animation did. Finds which way the jaw's tip has to
 *  turn to go down. null without a jaw bone. Call apply() after the animation each frame. */
export function jawOpener(info) {
  const jaw = info.jaw;
  if (!jaw?.parent) return null;
  jaw.updateWorldMatrix(true, true);
  const tipBone = jaw.children.find((c) => c.isBone);
  const p = jaw.getWorldPosition(new THREE.Vector3());
  const tip = tipBone ? tipBone.getWorldPosition(new THREE.Vector3()) : (info.head ? p.clone().add(p.clone().sub(info.head.getWorldPosition(new THREE.Vector3()))) : null);
  if (!tip || tip.distanceToSquared(p) < 1e-10) return null;
  const dir = tip.sub(p).normalize();
  const axis = dir.clone().cross(new THREE.Vector3(0, -1, 0));
  if (axis.lengthSq() < 1e-5) axis.set(1, 0, 0);
  axis.normalize().applyQuaternion(jaw.getWorldQuaternion(new THREE.Quaternion()).invert());   // in the jaw's own frame: it turns with the model
  const q = new THREE.Quaternion(), base = new THREE.Quaternion(), after = new THREE.Quaternion();
  let opened = false;
  return {
    bone: jaw,
    apply(amount) {
      // a clip that moves the jaw sets it fresh each frame; without one, last frame's opening has to come off first
      if (opened && jaw.quaternion.equals(after)) jaw.quaternion.copy(base);
      opened = amount > 0.001;
      if (!opened) return;
      base.copy(jaw.quaternion);
      jaw.quaternion.multiply(q.setFromAxisAngle(axis, Math.min(1, amount) * 0.42));
      after.copy(jaw.quaternion);
    },
  };
}

/** Make UniMate's clips behave: body bones only, smooth, feet on the floor, seamless loops. Returns a short report.
 *  The model's own animations are left exactly as they are. */
export function cleanClips(root, clips, info = analyzeRig(root)) {
  const bodyNames = new Set([...info.body].map((b) => b.name));
  const report = { dropped: 0, smoothed: 0, grounded: 0, arms: 0, calmed: 0, reversed: 0, own: 0 };
  const monster = bodyOf(root) === "monster" || info.soft.some((b) => /wing/.test(clean(b.name)));
  for (const clip of clips || []) {
    if (/^talk$/i.test(clip.name) && clip.userData?.made === "app") continue;
    if (isOwnClip(clip, info)) { report.own++; continue; }
    // standing clips that step around (UniMate sometimes walks on the spot): a calm idle instead
    if (/^(idle|sad)$/i.test(clip.name) && footTravel(root, info, clip) > 0.15) {
      const calm = makeCalmIdle(root, info, clip.name);
      clip.tracks = calm.tracks; clip.duration = calm.duration; clip.resetDuration?.();
      report.calmed++;
    }
    const loop = !ONCE.test(clip.name);
    const before = clip.tracks.length;
    clip.tracks = clip.tracks.filter((t) => bodyNames.has(t.name.split(".")[0]) && !t.name.endsWith(".scale"));
    report.dropped += before - clip.tracks.length;
    // a walk that travels forward: take the travel out FIRST. Blending the end into the start (closeLoop) before
    // that squeezed the whole walk back into the last few frames - he snapped back to the start, then walked again
    if (loop) { inPlace([clip]); if (pinTravel(root, info, clip)) report.pinned = (report.pinned || 0) + 1; }
    for (const t of clip.tracks) {
      smoothTrack(t, loop, t.name.endsWith(".position") ? 2 : 1);
      if (loop) closeLoop(t);
      report.smoothed++;
    }
    if (!monster && relaxArms(root, info, clip)) report.arms++;  // a monster's arms aren't meant to hang at its sides
    if (keepArmsOut(root, info, clip)) report.armsOut = (report.armsOut || 0) + 1;
    if (fixWalkDirection(root, info, clip)) report.reversed++;
    monsterExtras(root, info, clip);
    if (!FLOATING.test(clip.name) && groundClip(root, info, clip)) report.grounded++;
  }
  return report;
}

/** Put a clip made on UniMate's copy of the rig (fewer bones, other units, the top bone turned) onto the ORIGINAL rig,
 *  so the original's fingers, hair and cloth bones stay (they get the app's hands and springs instead).
 *  Done in world space, frame by frame: the clip plays on UniMate's copy, each bone's world rotation is read, and the
 *  original is posed to match, top bone first (W_to = W_from · K, K = the two rests' difference). Copying local
 *  rotations instead broke rigs where UniMate's copy has fewer bones in between (Source/Valve rigs' helper bones:
 *  a bone's parent isn't the same bone in both, and Omniman came out crouched on the floor). */
export function retargetClip(clip, fromRoot, toRoot) {
  fromRoot.updateMatrixWorld(true); toRoot.updateMatrixWorld(true);
  const toBones = new Map();
  toRoot.traverse((o) => { if (o.isBone && !toBones.has(o.name)) toBones.set(o.name, o); });
  const fromBones = new Map();
  fromRoot.traverse((o) => { if (o.isBone && !fromBones.has(o.name)) fromBones.set(o.name, o); });
  const animated = new Set(clip.tracks.map((t) => t.name.split(".")[0]));
  const pairs = [];                                   // [from, to, K], parents before children (the to-rig's order)
  toRoot.traverse((t) => {
    const f = t.isBone && fromBones.get(t.name);
    if (f && toBones.get(t.name) === t && animated.has(t.name))
      pairs.push([f, t, f.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(t.getWorldQuaternion(new THREE.Quaternion()))]);
  });
  if (!pairs.length) return new THREE.AnimationClip(clip.name, clip.duration, []);
  // the top moving bone also moves (hips bob, a jump): its world offset from rest, in the original's size
  const top = pairs[0];
  const fromRest = top[0].getWorldPosition(new THREE.Vector3()), toRest = top[1].getWorldPosition(new THREE.Vector3());
  // the size difference: how tall the matching skeletons are (UniMate's copy can sit at the origin with odd meshes,
  // so the models' boxes don't say it)
  const span = (k) => { const ys = pairs.map((p) => p[k].getWorldPosition(new THREE.Vector3()).y); return Math.max(1e-6, Math.max(...ys) - Math.min(...ys)); };
  const scale = span(1) / span(0);
  const savedTo = pairs.map(([, t]) => [t.position.clone(), t.quaternion.clone()]);
  const fps = 30, n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = Float32Array.from({ length: n }, (_, i) => Math.min(clip.duration, i / fps));
  const q = pairs.map(() => new Float32Array(n * 4)), pos = new Float32Array(n * 3);
  const mixer = new THREE.AnimationMixer(fromRoot), act = mixer.clipAction(clip).play();
  const W = new THREE.Quaternion(), P = new THREE.Quaternion(), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    act.time = times[i]; mixer.update(0); fromRoot.updateMatrixWorld(true);
    pairs.forEach(([f, t, K], k) => {
      W.copy(f.getWorldQuaternion(new THREE.Quaternion())).multiply(K);           // where this bone points, in the original
      t.parent.updateWorldMatrix(true, false);
      t.parent.getWorldQuaternion(P);
      t.quaternion.copy(P.invert().multiply(W)).normalize();
      t.updateMatrixWorld(true);
      t.quaternion.toArray(q[k], i * 4);
    });
    v.copy(top[0].getWorldPosition(new THREE.Vector3())).sub(fromRest).multiplyScalar(scale).add(toRest);
    top[1].parent.worldToLocal(v).toArray(pos, i * 3);
  }
  act.stop(); mixer.uncacheRoot(fromRoot);
  pairs.forEach(([, t], k) => { t.position.copy(savedTo[k][0]); t.quaternion.copy(savedTo[k][1]); });
  toRoot.updateMatrixWorld(true);
  const tracks = pairs.map(([, t], k) => new THREE.QuaternionKeyframeTrack(`${t.name}.quaternion`, times, q[k]));
  tracks.push(new THREE.VectorKeyframeTrack(`${top[1].name}.position`, times, pos));
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
    // feet and toes are left out: a long hem or a train sweeps right past them on the floor and got hooked on them
    if (!["spine", "arm", "leg"].includes(fam) || /root|origin|foot|toe|ankle|heel|ball/.test(clean(b.name))) continue;
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
    if (r > 0) caps.push({ a: b, b: e, r: Math.min(r, len * 0.9), leg: family(b) === "leg" });
  }
  const s = new THREE.Vector3(), t2 = new THREE.Vector3(), near = new THREE.Vector3();
  return {
    count: caps.length,
    caps,
    /** how close `pt` may come to each capsule's middle line: its radius (+ pad), but never more than 90% of how far
     *  it is at rest. Cloth bones sit INSIDE the cloth (the surface is further out), often closer to a leg than the
     *  leg is thick: they must not cross the leg, but pushing them a full leg-width away would balloon the skirt. */
    limits(pt, pad = 0, noLegs = false) {
      return caps.map((cap) => {
        if (noLegs && cap.leg) return 0;          // a skirt the legs carry along: pushing it off them opened it
        cap.a.getWorldPosition(s); cap.b.getWorldPosition(t2);
        return Math.min(cap.r + pad, pt.distanceTo(closest(pt, s, t2, near)) * 0.75);
      });
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
  // skirts and capes near a leg turn partly WITH that thigh (like in games), so a stride carries the cloth along
  // instead of the leg going through it. Weight: up to 0.75 when the panel hangs right by the thigh, 0 far away.
  root.updateMatrixWorld(true);
  // the upper leg = the first leg bone under the body ("LThigh", "L_leg", "upperleg"...), whatever it's called
  const thighs = info.bones.filter((b) => info.kind.get(b) === "leg" && info.kind.get(b.parent) !== "leg"
    && b.children.some((c) => c.isBone && info.kind.get(c) === "leg"));
  const wpos = (o) => o.getWorldPosition(new THREE.Vector3()), wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());
  for (const s of springs) {
    if (s.kind !== "cloth" || s.depth > 1 || !thighs.length) continue;
    const child = s.bone.children.find((c) => c.isBone);
    const tip = child ? wpos(child) : wpos(s.bone);
    let best = null, bd = Infinity;
    for (const th of thighs) {
      const knee = th.children.find((c) => c.isBone && info.body.has(c));
      const a = wpos(th), b = wpos(knee), d = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, tip.clone().sub(a).dot(d) / (d.lengthSq() || 1)));
      const dist = tip.distanceTo(a.clone().addScaledVector(d, t)) / (d.length() || 1);
      if (dist < bd) { bd = dist; best = th; }
    }
    const w = Math.max(0, Math.min(0.75, 1 - bd / 0.8)) * (s.depth ? 0.5 : 1);
    // every thigh may push it: whichever leg pushes this panel OUT the most wins (the front follows the leg that steps
    // forward, the back the one behind) - one panel per leg made the skirt split open and show the legs
    if (w > 0.02) s.legs = { w, list: thighs.filter((th) => th.parent).map((th) => ({ thigh: th, hips: th.parent, rest: wquat(th.parent).invert().multiply(wquat(th)) })) };
  }
  const legQ = new THREE.Quaternion(), hipQ = new THREE.Quaternion(), ID = new THREE.Quaternion();
  // the floor, in the model's own space (under its feet at rest): cloth settles on it instead of sinking through.
  // Kept in local space so it follows when the room scales and places the model afterwards.
  root.updateMatrixWorld(true);
  const floorLocal = springs.length ? root.worldToLocal(new THREE.Vector3(0, floorUnder(root, info), 0)).y : 0;
  const floorPt = new THREE.Vector3();
  const head = new THREE.Vector3(), want = new THREE.Vector3(), cur = new THREE.Vector3(), next = new THREE.Vector3();
  const wq = new THREE.Quaternion(), pq = new THREE.Quaternion(), rot = new THREE.Quaternion();
  const side = new THREE.Vector3(), radial = new THREE.Vector3(), center = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const scaleOf = (o) => o.getWorldScale(new THREE.Vector3()).y || 1;
  return {
    count: springs.length,
    list: springs,
    colliders: colliders?.count || 0,
    capsules: colliders?.caps || [],
    reset() { for (const s of springs) s.tip = null; },
    update(dt, t = 0) {
      if (!springs.length) return;
      dt = Math.min(dt, 1 / 20);
      const f = dt * 60;                                                 // the same feel at any frame rate
      root.updateMatrixWorld(true);                                      // the body as the animation left it this frame
      (info.hips || root).getWorldPosition(center);
      const floor = root.localToWorld(floorPt.set(0, floorLocal, 0)).y;
      for (const s of springs) {
        const b = s.bone;
        b.quaternion.copy(s.rest);                                      // where the bone would point by itself
        b.updateMatrixWorld(true);
        b.getWorldPosition(head);
        b.getWorldQuaternion(wq);
        want.copy(s.local).multiplyScalar(scaleOf(b)).applyQuaternion(wq).add(head);
        s.len = want.distanceTo(head);
        if (s.legs) {                                                    // carried by the legs' swing (in the hips' frame)
          const dir = want.clone().sub(head);
          const out = head.clone().sub(center).setY(0).normalize();    // which way is "out" for this panel
          let bestDir = dir, bestOut = -Infinity;
          for (const L of s.legs.list) {
            L.hips.getWorldQuaternion(hipQ); L.thigh.getWorldQuaternion(legQ);
            const rel = hipQ.clone().invert().multiply(legQ).multiply(L.rest.clone().invert());
            const swing = hipQ.clone().multiply(rel).multiply(hipQ.clone().invert());
            const d = dir.clone().applyQuaternion(ID.clone().slerp(swing, s.legs.w));
            const o = d.dot(out);
            if (o > bestOut) { bestOut = o; bestDir = d; }
          }
          if (bestOut > dir.dot(out)) want.copy(head).add(bestDir);    // only ever pushed out, never pulled in
        }
        if (!s.tip) {
          s.tip = want.clone(); s.prev = want.clone();
          // how close it may come to each body part (a skirt panel the legs carry, or one under it, skips the legs)
          s.limits = colliders.limits(want, s.len * 0.05, !!s.legs || (s.depth > 0 && s.kind === "cloth"));
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
        // the floor: cloth that reaches it spreads out flat along it (same length, outward) - pushing the tip straight
        // up instead folded a hem into hooks
        const ground = floor + s.len * 0.02;
        if (next.y < ground) {
          const dy = ground - head.y;
          if (Math.abs(dy) < s.len) {
            side.set(next.x - head.x, 0, next.z - head.z);
            if (side.lengthSq() < 1e-10) side.set(want.x - head.x, 0, want.z - head.z);
            side.setLength(Math.sqrt(s.len * s.len - dy * dy));
            next.set(head.x + side.x, ground, head.z + side.z);
          } else next.y = ground;
          cur.copy(next).sub(head);
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
