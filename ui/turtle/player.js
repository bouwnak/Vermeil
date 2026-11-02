// player.js - you: walking, running, jumping, riding, sailing, the camera that follows, and the keys (all in KEYS, so they can be changed).
// You can't walk on water or up a cliff. A dinosaur or a boat is how you get past those.
import * as THREE from "three";
import { character } from "./assets.js";
import { modelOf } from "./data.js";
import { groundAt, pushOut } from "./world.js";

export const KEYS = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", sprint: "ShiftLeft", jump: "Space", down: "KeyC", interact: "KeyE", ride: "KeyR", seed: "KeyQ", book: "KeyJ", map: "KeyM", bag: "KeyI", build: "KeyB" };
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
  P.act = (kind, fn, at = 0.34) => { P.busy = Math.max(P.busy, (P.char.once?.(kind) || 0.5) * 0.75); if (fn) setTimeout(fn, at * 1000); };
  return P;
}

const STEP = { dock: "stepwood", bridge: "stepwood" };
export function tickPlayer(G, dt) {
  const P = G.player, I = G.input, c = P.char, T = G.cheat || {}, mount = P.riding;
  c.mixer.update(dt);
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
    const speed = P.sailing ? SAIL * (sprint ? 1.4 : 1) : T.fly ? 34 * (sprint ? 2 : 1) : mount ? mount.data.speed[mount.r.stage] * (sprint ? 1.4 : 1) : sprint ? RUN : WALK;
    // each way is tried by itself, so a cliff or a shore slides you along it instead of stopping you dead
    for (const [ax, az] of [[move.x, 0], [0, move.z]]) {
      const nx = P.pos.x + ax * speed * dt, nz = P.pos.z + az * speed * dt, g = groundAt(G, nx, nz), len = Math.max(1e-4, Math.hypot(nx - P.pos.x, nz - P.pos.z));
      if (P.sailing ? g.on !== "sea" : !flies && g.on === "sea" && !swims) continue;
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
  const floor = P.sailing ? 0.42 : onSea ? -0.05 : g.y;
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
  c.holder.rotation.set(0, P.heading, 0, "YXZ");
  c.play(mount || P.sailing ? "idle" : moving ? (sprint ? "run" : "walk") : "idle");
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
