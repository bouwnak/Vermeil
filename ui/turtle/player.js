// player.js - you: walking, running, jumping, riding, sailing, the camera that follows, and the keys (all in KEYS, so they can be changed).
// You can't walk on water or up a cliff. A dinosaur or a boat is how you get past those.
import * as THREE from "three";
import { character } from "./assets.js";
import { modelOf, perkOf } from "./data.js";
import { groundAt, pushOut } from "./world.js";

export const KEYS = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", sprint: "ShiftLeft", jump: "Space", down: "KeyC", interact: "KeyE", ride: "KeyR", seed: "KeyQ", book: "KeyJ", map: "KeyM", bag: "KeyI", build: "KeyB", fill: "KeyF" };
const WALK = 3.6, RUN = 7.2, CLIFF = 1.05, SAIL = 15;

export function makeInput(el) {
  const I = { down: new Set(), pressed: new Set(), yaw: 0.7, pitch: 0.42, zoom: 11, click: false, dragging: false, moved: 0, hold: false };
  addEventListener("keydown", (e) => { if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return; if (!e.repeat) I.pressed.add(e.code); I.down.add(e.code); if (e.code === "Space") e.preventDefault(); });
  addEventListener("keyup", (e) => I.down.delete(e.code));
  addEventListener("blur", () => I.down.clear());
  el.addEventListener("pointerdown", (e) => { I.dragging = true; I.moved = 0; if (!I.hold) el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", (e) => {
    if (!I.dragging || I.hold) return;
    I.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    I.yaw -= e.movementX * 0.0052 * (I.sense || 1);
    I.pitch = Math.min(1.45, Math.max(0.08, I.pitch + e.movementY * 0.004 * (I.sense || 1)));
  });
  el.addEventListener("pointerup", () => { if (I.dragging && I.moved < 6) I.click = true; I.dragging = false; });
  el.addEventListener("wheel", (e) => { I.zoom = Math.min(60, Math.max(4.5, I.zoom * (e.deltaY > 0 ? 1.1 : 0.9))); e.preventDefault(); }, { passive: false });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  return I;
}

export async function makePlayer(G) {
  const s = G.s, c = await character(modelOf(s.body, s.skin), 1.75);
  const P = { char: c, pos: new THREE.Vector3(s.pos[0], 12, s.pos[1]), vy: 0, heading: 0, stamina: 100, mode: "", riding: null, sailing: false, front: new THREE.Vector3(), busy: 0, stepIn: 0 };
  G.scene.add(c.holder);
  P.ground = groundAt(G, P.pos.x, P.pos.z);
  if (P.ground.on === "sea") { P.pos.set(18, 12, 2); P.ground = groundAt(G, 18, 2); }
  P.pos.y = P.ground.y;
  P.swap = async (body, skin) => {
    const next = await character(modelOf(body, skin), 1.75);
    if (!next) return;
    G.scene.remove(P.char.holder);
    G.scene.add(next.holder);
    P.char = next;
  };
  /** a tool swing or a reach: you stop for its length, and what it does lands at the moment of contact */
  P.act = (kind, fn, at = 0.34, form = "", len = 0.9) => {
    if (kind === "swing") { P.swing = 0.0001; P.busy = Math.max(P.busy, SWING); if (fn) setTimeout(fn, at * 1000); return; }      // tools are swung by hand, below: up over the shoulder, and down
    if (form) { P.pose = form; P.poseFor = P.poseLen = len; }
    P.busy = Math.max(P.busy, form ? len - 0.1 : (P.char.once?.(kind) || 0.5) * 0.75);
    if (fn) setTimeout(fn, at * 1000);
  };
  return P;
}

/** what the clips don't cover is done by aiming the limbs at where they should be, so it works whatever way the bones happen to point: the arms to a tool, the legs for sitting and crouching */
const SWING = 0.66;
// where the hands go for each way of holding a tool, measured from your feet: x to your left, y up, z ahead. `hand` is the right hand, `shaft` the way the tool points from it; a two-handed tool takes the left hand further up the shaft
const HOLD = {
  carry: { hand: [-0.27, 0.98, 0.22], shaft: [0.02, 1, 0.34] },
  rod: { hand: [-0.25, 1.18, 0.4], shaft: [0, 0.74, 0.68] },
  can: { hand: [-0.3, 0.72, 0.1], shaft: [0, 1, 0] },
  pour: { hand: [-0.2, 1.1, 0.46], shaft: [0, 0.72, 0.7] },
  raise: { hand: [-0.2, 1.62, -0.06], shaft: [0.1, 0.5, -0.86], two: 1 },
  strike: { hand: [-0.05, 0.84, 0.5], shaft: [0.02, -0.34, 0.94], two: 1 },
};
const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const toWorld = (P, p, out) => out.fromArray(p).applyAxisAngle(UP, P.heading).add(P.char.holder.position);
/** turn a bone so that its child, at `tip`, moves onto `to` */
function aim(O, b, tip, to) {
  b.getWorldPosition(v0);
  q0.setFromUnitVectors(v1.subVectors(tip, v0).normalize(), v2.subVectors(to, v0).normalize());
  b.getWorldQuaternion(q1); b.parent.getWorldQuaternion(q2).invert();
  O.keep(b).quaternion.copy(q2.multiply(q0.multiply(q1)));
  b.updateWorldMatrix(false, true);
}
/** puts the end of a limb on `target`, bending the middle joint toward `bendTo` (in your own directions). `k` from 0 (leave it to the clip) to 1 */
function limb(P, upName, lowName, tipName, target, k, bendTo) {
  const c = P.char, get = (n) => c.limbs[n] ??= c.root.getObjectByName(n), up = get(upName), low = get(lowName), tip = get(tipName);
  if (!up || !low || !tip || k <= 0) return;
  const S = up.getWorldPosition(new THREE.Vector3()), E = low.getWorldPosition(new THREE.Vector3()), W = tip.getWorldPosition(new THREE.Vector3()), T = W.clone().lerp(target, k), a = S.distanceTo(E), b = E.distanceTo(W), d = Math.max(Math.abs(a - b) * 1.01, Math.min(S.distanceTo(T), (a + b) * 0.999)), dir = T.clone().sub(S).normalize();
  const along = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - along * along)), pole = v3.fromArray(bendTo).applyAxisAngle(UP, P.heading);
  pole.addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = S.clone().addScaledVector(dir, along).addScaledVector(pole, h), end = S.clone().addScaledVector(dir, d);
  aim(c.O, up, E, elbow);
  low.getWorldPosition(E); tip.getWorldPosition(W);
  aim(c.O, low, W, end);
}
const reach = (P, side, target, k) => limb(P, `UpperArm${side}`, `LowerArm${side}`, `Wrist${side}`, target, k, [side === "R" ? -1 : 1, -0.2, -0.5]);       // the elbow goes out and back: straight down is where the hand is, and the bend would flip
const step = (P, side, target, k) => limb(P, `UpperLeg${side}`, `LowerLeg${side}`, `Foot${side}`, target, k, [0, 0.3, 1]);
/** sitting in a seat, astride a mount, or crouching down to the ground: the body drops, the feet stay where they should be, and the knees bend forward */
function legs(P, dt) {
  const c = P.char, seated = !!(P.riding || P.sailing), astride = !!P.riding && !P.riding.vehicle;
  c.limbs ||= {};
  P.sitK = (P.sitK || 0) + ((seated ? 1 : 0) - (P.sitK || 0)) * Math.min(1, dt * 10);
  const crouch = P.pose === "kneel" && P.poseFor > 0 ? smooth(Math.min((P.poseLen || 0.9) - P.poseFor, P.poseFor) / 0.2) : 0;
  c.root.position.y = (c.y0 ??= c.root.position.y) - P.sitK * (astride ? 0.8 : 0.5) - crouch * 0.52;
  const k = Math.max(P.sitK, crouch);
  if (k < 0.01) return;
  c.root.updateWorldMatrix(true, true);
  const at = (p) => toWorld(P, p, new THREE.Vector3());
  if (crouch > 0.01) {
    c.O.turn(c.root.getObjectByName("Chest"), "x", crouch * 0.42); c.O.turn(c.root.getObjectByName("Abdomen"), "x", crouch * 0.34);
    c.root.updateWorldMatrix(true, true);
    step(P, "L", at([0.15, 0.04, 0.16]), crouch); step(P, "R", at([-0.15, 0.04, -0.1]), crouch);
    const tug = (P.poseLen || 0.9) > 1.2 ? Math.max(0, Math.sin(performance.now() / 110)) * 0.09 : 0;      // a long pull: the hands grip low and tug, again and again
    reach(P, "R", at([-0.12, 0.2 + tug, 0.56 - tug * 0.6]), crouch); reach(P, "L", at([0.14, 0.28 + tug, 0.44 - tug * 0.6]), crouch);
    return;
  }
  // astride: the feet hang down either side into the stirrups, a little forward. On a broad back the knees go out, but the feet still hang: they never stick out sideways
  const wide = astride ? THREE.MathUtils.clamp((P.riding.char.saddleWide || 0.3) * 0.6 + 0.12, 0.24, 0.5) : 0, low = astride ? -0.66 + Math.max(0, wide - 0.32) * 0.4 : 0;
  const foot = P.sailing ? [0.17, -0.12, 0.5] : [0.14, 0.04, 0.42];          // in the boat, on its floor below the thwart
  step(P, "L", at(astride ? [wide, low, 0.08] : foot), P.sitK);
  step(P, "R", at(astride ? [-wide, low, 0.08] : [-foot[0], foot[1], foot[2]]), P.sitK);
  if (P.sailing && P.oars) { reach(P, "L", P.oars.L, P.sitK); reach(P, "R", P.oars.R, P.sitK); }       // hands on the oars
  if (astride) {                                            // hands forward over the saddle horn, holding the reins
    reach(P, "R", at([-0.12, 0.5, 0.44]), P.sitK); reach(P, "L", at([0.12, 0.5, 0.44]), P.sitK);
    const w = (s) => (c.limbs[`Wrist${s}`] ??= c.root.getObjectByName(`Wrist${s}`));
    P.hands = [w("L"), w("R")].map((b) => b && b.getWorldPosition(new THREE.Vector3()));
  } else P.hands = null;
  if (P.riding?.vehicle) { reach(P, "R", at([-0.13, 0.74, 0.44]), P.sitK); reach(P, "L", at([0.13, 0.74, 0.44]), P.sitK); }      // hands on the wheel
}
const SHOULDER = [-0.14, 1.35, 0.09];
const smooth = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const mixV = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
/** the tool in your hands: where it is on the way between one hold and the next */
function holdNow(P, tool) {
  const rest = tool === "rod" ? HOLD.rod : tool === "can" ? (P.pose === "pour" && P.poseFor > 0 ? HOLD.pour : HOLD.can) : HOLD.carry;
  if (!P.swing) return rest;
  const u = P.swing, keys = [[0, rest], [0.42, HOLD.raise], [0.56, HOLD.strike], [0.7, HOLD.strike], [1, rest]];
  let i = 0; while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
  const [t0, A] = keys[i], [t1, B] = keys[i + 1], k = smooth((u - t0) / (t1 - t0));
  return { hand: mixV(A.hand, B.hand, k), shaft: mixV(A.shaft, B.shaft, k), two: (A.two || 0) + ((B.two || 0) - (A.two || 0)) * k };
}
/** after everything else has moved you: the hands go to the tool, and the tool is left where the hands are */
function arms(P, dt) {
  const c = P.char, tool = G0.tool, H = tool ? holdNow(P, tool) : null;
  P.gripK = Math.min(1, Math.max(0, (P.gripK || 0) + (tool && !P.riding && !P.sailing && !(P.pose === "kneel" && P.poseFor > 0) ? dt : -dt) * 6));
  P.grip = null;
  if (P.gripK <= 0 || !H) return;
  if (P.swing) {
    const lean = Math.sin(Math.min(1, P.swing / 0.56) * Math.PI) * -0.16 + smooth((P.swing - 0.42) / 0.14) * (1 - smooth((P.swing - 0.7) / 0.3)) * 0.34;
    c.O.turn(c.root.getObjectByName("Chest"), "x", lean);
  }
  const hand = toWorld(P, H.hand, new THREE.Vector3()), shaft = new THREE.Vector3().fromArray(H.shaft).normalize().applyAxisAngle(UP, P.heading);
  c.root.updateWorldMatrix(true, true);
  // held from the shoulder, so the tool rides along with a running stride and doesn't fight it
  const arm = c.limbs.UpperArmR ??= c.root.getObjectByName("UpperArmR");
  if (arm) hand.add(arm.getWorldPosition(new THREE.Vector3()).sub(toWorld(P, SHOULDER, new THREE.Vector3())));
  reach(P, "R", hand, P.gripK);
  if (H.two) reach(P, "L", hand.clone().addScaledVector(shaft, 0.34), H.two * P.gripK);
  P.grip = { hand, shaft };
}
function pose(P, dt) {
  P.poseFor = Math.max(0, (P.poseFor || 0) - dt);
  if (P.swing && (P.swing += dt / SWING) >= 1) P.swing = 0;
}
const G0 = { tool: "" };

const STEP = { dock: "stepwood", bridge: "stepwood" };
export function tickPlayer(G, dt) {
  const P = G.player, I = G.input, c = P.char, T = G.cheat || {}, mount = P.riding;
  G0.tool = ["hoe", "axe", "pick", "can", "rod"].includes(G.tool?.id) ? G.tool.id : "";
  c.O.undo();
  c.mixer.update(dt);
  pose(P, dt);
  let move = new THREE.Vector3();
  if (!G.paused && !P.busy) {
    if (I.down.has(KEYS.forward)) move.z -= 1;
    if (I.down.has(KEYS.back)) move.z += 1;
    if (I.down.has(KEYS.left)) move.x -= 1;
    if (I.down.has(KEYS.right)) move.x += 1;
  }
  P.busy = Math.max(0, P.busy - dt);
  const moving = move.lengthSq() > 0, sprint = I.down.has(KEYS.sprint) && (P.stamina > 3 || T.stamina);
  const flies = T.fly || (mount?.can("fly") && P.mode === "fly"), climbs = flies || T.ghost || mount?.can("climb"), swims = mount?.can("swim") || P.sailing || flies;
  const from = P.ground?.y ?? P.pos.y;
  if (moving) {
    move.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), I.yaw);
    const speed = P.sailing ? SAIL * (sprint ? 1.4 : 1) : T.fly ? 34 * (sprint ? 2 : 1) : mount ? mount.data.speed[mount.r.stage] * (sprint ? 1.4 : 1) * (1 + 0.12 * perkOf(mount.data, "swift")) : sprint ? RUN : WALK;
    // each way is tried by itself, so a cliff or a shore slides you along it instead of stopping you dead
    for (const [ax, az] of [[move.x, 0], [0, move.z]]) {
      const nx = P.pos.x + ax * speed * dt, nz = P.pos.z + az * speed * dt, g = groundAt(G, nx, nz), len = Math.max(1e-4, Math.hypot(nx - P.pos.x, nz - P.pos.z));
      if (P.sailing ? g.on !== "sea" : !flies && g.on === "sea" && !swims) continue;
      if (mount?.data?.shape?.kind === "plesio" && g.on !== "sea" && g.y > 3.6) continue;          // a swimmer carries you along the beach and over the sea, not up onto the grass
      if (!climbs && !P.sailing && (g.y - from) / len > CLIFF && P.pos.y < g.y) continue;      // only a jump already above it gets you over
      P.pos.x = nx; P.pos.z = nz;
    }
    const want = Math.atan2(move.x, move.z);
    let d = want - P.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    P.heading += d * Math.min(1, dt * 12);
    if (sprint && !T.stamina) P.stamina = Math.max(0, P.stamina - dt * 3);
  }
  P.stamina = Math.min(100, P.stamina + dt * (moving ? 0.6 : 2.4));
  if (!T.ghost && !flies && !P.sailing) pushOut(G, P.pos, mount ? 1.1 : 0.45);
  const g = groundAt(G, P.pos.x, P.pos.z);
  P.onTown = g.on === "willowmere";
  P.ground = g;
  const onSea = g.on === "sea";
  if (mount && !flies) P.mode = onSea ? "swim" : "";
  if (T.fly || mount?.can("fly")) {                         // wings: Space to climb, C to come down; settle on the ground to walk
    const up = I.down.has(KEYS.jump), dn = I.down.has(KEYS.down);
    if (!G.paused && up) { P.pos.y += dt * 11; if (mount) P.mode = "fly"; }
    if (!G.paused && dn) P.pos.y -= dt * 11;
  }
  const floor = P.sailing ? G.sail?.deck ?? 0.57 : onSea ? -0.05 : g.y;
  if (flies) { P.pos.y = Math.max(P.pos.y, floor + 0.2); P.pos.y = Math.min(P.pos.y, 260); if (mount && P.pos.y <= floor + 0.21 && !onSea) P.mode = ""; P.vy = 0; }
  else {
    if (I.pressed.has(KEYS.jump) && !G.paused && P.pos.y <= floor + 0.05 && !P.sailing) { P.vy = mount?.can("jump") ? 14 : mount ? 9 : 6.6; G.sfx?.("hop"); }
    P.vy -= 19 * dt;
    P.pos.y += P.vy * dt;
    if (P.pos.y <= floor) { P.pos.y = THREE.MathUtils.lerp(P.pos.y, floor, Math.min(1, dt * 16)); if (P.pos.y - floor < 0.05) { P.pos.y = floor; if (P.vy < -9) G.vfx?.burst("dust", P.pos.x, floor + 0.1, P.pos.z); P.vy = 0; } }
    else if (P.vy <= 0 && P.pos.y > floor) { /* falling */ }
    if (P.vy === 0 && P.pos.y > floor + 0.05) P.pos.y = Math.max(floor, P.pos.y - dt * 12);
  }
  if (moving && !flies && !P.sailing && P.vy === 0) {
    P.stepIn -= dt;
    if (P.stepIn <= 0) { P.stepIn = mount ? 0.42 : sprint ? 0.26 : 0.38; G.sfx?.(STEP[g.on] || (g.y < 3.4 ? "stepsand" : "step")); if (sprint || mount) G.vfx?.burst("dust", P.pos.x, P.pos.y + 0.1, P.pos.z, 0.3); }
  }
  P.front.set(Math.sin(P.heading), 0, Math.cos(P.heading));
  c.holder.visible = true;
  const seat = mount ? mount.char.seat + (P.mode === "fly" ? 0.1 : 0) : 0;
  c.holder.position.copy(P.pos); c.holder.position.y += seat;
  if (mount?.char.across != null) { const a = P.heading + (mount.char.face || 0), { across: x, along: z } = mount.char; c.holder.position.x += x * Math.cos(a) + z * Math.sin(a); c.holder.position.z += z * Math.cos(a) - x * Math.sin(a); }
  c.holder.rotation.set(0, P.heading, 0, "YXZ");
  if (mount?.char.saddle) {
    // in the saddle: wherever the back is this moment, as it rises and falls and leans with the animal under you
    const m = mount.char.holder, at = mount.char.saddle.getWorldPosition(v0).sub(m.position).applyAxisAngle(UP, P.heading - m.rotation.y);
    c.holder.position.copy(P.pos).add(at);
    mount.char.saddle.getWorldQuaternion(q0); m.getWorldQuaternion(q1).invert(); q0.premultiply(q1);           // the back's own lean
    c.holder.quaternion.setFromAxisAngle(UP, P.heading).multiply(q2.copy(q0).slerp(q1.identity(), 0.8));        // a rider sits up straight: only a little of the back's tilt
  }
  c.play(mount || P.sailing ? "idle" : moving ? (sprint ? "run" : "walk") : "idle");
  legs(P, dt);
  arms(P, dt);
  // the camera: behind you, never under the ground
  const cam = G.camera;
  if (G.cinema || G.building) return;
  const far = I.zoom * (mount ? 1.5 : P.sailing ? 2.2 : 1);
  const from3 = new THREE.Vector3(Math.sin(I.yaw) * Math.cos(I.pitch), Math.sin(I.pitch), Math.cos(I.yaw) * Math.cos(I.pitch)).multiplyScalar(far);
  const target = P.pos.clone().add(new THREE.Vector3(0, 1.5 + seat * 0.8, 0)), wanted = target.clone().add(from3);
  // the view is pulled in if land stands between it and you
  for (let u = 0.3; u <= 1; u += 0.14) { const x = target.x + from3.x * u, z = target.z + from3.z * u, y = target.y + from3.y * u; if (y < groundAt(G, x, z).y + 0.5) { wanted.lerpVectors(target, wanted, Math.max(0.2, u - 0.12)); break; } }
  const under = Math.max(groundAt(G, wanted.x, wanted.z).y, 0.2) + 0.7;
  if (wanted.y < under) wanted.y = under;
  cam.position.lerp(wanted, Math.min(1, dt * 10));
  cam.lookAt(target);
}
