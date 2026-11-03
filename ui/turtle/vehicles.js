// vehicles.js - anything with wheels can be driven, and the working ones work the field as you drive over it: tractors till, seed drills plant, tankers water, combines harvest.
import * as THREE from "three";
import { CATALOG, ITEMS, SEATS } from "./data.js";
import { groundAt } from "./world.js";
import { keyOf, ripe, spotOf } from "./farm.js";
import { popup } from "./ui.js";
import { rigWheels, rollWheels } from "./wheels.js";

/** where the driver's feet go, from the middle of the vehicle on the ground, however it has been scaled or placed. -> { x, y, z } */
export function seatOf(group, c) {
  const ry = group.rotation.y, at = group.position.clone();
  group.rotation.y = 0; group.position.set(0, 0, 0); group.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(group), size = b.getSize(new THREE.Vector3()), mid = b.getCenter(new THREE.Vector3()), f = SEATS[(c.model || "").replace(/^.*\/|\.\w+$/g, "")] || [0, 0.3, 0];
  const seat = { x: mid.x + f[0] * size.x, y: b.min.y + f[1] * size.y, z: mid.z + f[2] * size.z };
  group.rotation.y = ry; group.position.copy(at); group.updateMatrixWorld(true);
  return seat;
}

/** the wheels of a vehicle (the pack names every round moving part wheel_N: wheels, hubs, track rollers, a combine's reel): each turns about its own thinnest side */
export function wheelsOf(group) {
  const out = [], s = new THREE.Vector3(), ws = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((m) => {
    if (!m.isMesh || !/^wheel/i.test(m.name)) return;
    m.geometry.computeBoundingBox(); m.geometry.boundingBox.getSize(s); m.getWorldScale(ws);
    const axis = s.x < s.y && s.x < s.z ? "x" : s.y < s.z ? "y" : "z", r = Math.max(s.x, s.y, s.z) / 2 * ws.y;
    out.push({ m, axis, r: Math.max(r, 0.05) });
  });
  return out;
}
/** they roll as far as the vehicle has gone: a small wheel spins faster than a big one */
export function roll(wheels, dist) { for (const w of wheels) w.m.rotation[w.axis] += dist / w.r; }

export function makeVehicles(G) {
  const V = { now: null };
  const spinners = (t) => (t.wheels ||= rigWheels(t.group.children[0] || t.group));
  /** get in: it becomes what carries you */
  V.enter = (t) => {
    const P = G.player, c = CATALOG[t.p.type], seat = seatOf(t.group, c);
    for (const r of t.solids || []) r.off = true;
    const ride = { vehicle: t, label: c.label.replace(/ \(.*/, "").toLowerCase(), data: { speed: [c.work ? 7 : 12] }, r: { stage: 0 }, can: () => false, char: { seat: seat.y, across: seat.x, along: seat.z, face: c.face || 0 } };
    P.riding = ride; P.mode = ""; P.pos.set(t.p.x, P.pos.y, t.p.z); P.heading = t.p.ry; V.now = ride;
    G.sfx("engine"); popup(c.work ? `${c.label}: drive over your field. E or R to get out` : `${c.label}: E or R to get out`);
  };
  V.exit = () => {
    const P = G.player, ride = V.now;
    if (!ride) return;
    const t = ride.vehicle;
    t.p.x = P.pos.x; t.p.z = P.pos.z; t.p.ry = P.heading;
    G.build.reseat(t);
    for (const r of t.solids || []) r.off = false;
    P.riding = null; V.now = null;
    // out of whichever door has ground beside it
    const r = (CATALOG[t.p.type].r || 2) + 1.2, sideX = Math.cos(P.heading), sideZ = -Math.sin(P.heading);
    for (const [a, b] of [[sideX, sideZ], [-sideX, -sideZ], [-P.front.x, -P.front.z], [P.front.x, P.front.z]]) { const x = P.pos.x + a * r, z = P.pos.z + b * r, g = groundAt(G, x, z); if (g.on !== "sea" && !G.nearSolid(x, z, 0.6)) { P.pos.x = x; P.pos.z = z; P.pos.y = g.y; break; } }
    G.sfx("place");
  };
  let smoke = 0, sound = 0, did = 0;
  const work = (kind, x, z) => {
    const s = G.s, k = keyOf(x, z), p = s.plots[k], y = groundAt(G, x, z).y + 0.3, [cx, cz] = spotOf(k);
    if (kind === "till" && !p && G.farm.canTill(cx, cz)) { s.plots[k] = { crop: null, age: 0, wet: false }; G.vfx.burst("soil", cx, y, cz); G.sfx("dig"); G.farm.draw(); }
    else if (kind === "water" && p && !p.wet) { p.wet = true; G.vfx.burst("water", cx, y + 0.8, cz); G.farm.draw(); }
    else if (kind === "harvest" && p && ripe(p)) G.reap(k, p, true);
    else if (kind === "weed" && p?.weed) { p.weed = false; G.vfx.burst("leaf", cx, y, cz); G.farm.draw(); }
    else if (kind === "plant" && p && !p.crop) { const seed = G.seedChoice(); if (seed && s.inv[seed] > 0 && G.plant(k, p, seed, true)) { G.vfx.burst("soil", cx, y, cz); G.farm.draw(); } }
  };
  V.tick = (dt, t) => {
    const ride = V.now, P = G.player;
    if (!ride) return;
    const v = ride.vehicle, c = CATALOG[v.p.type], g = v.group, moving = P.movingNow;
    g.position.set(P.pos.x, P.pos.y - 0.04 + (moving ? Math.abs(Math.sin(t * 15)) * 0.04 : Math.sin(t * 30) * 0.008), P.pos.z);
    g.rotation.set(moving ? Math.sin(t * 9) * 0.012 : 0, P.heading + (c.face || 0), 0);
    const went = ride.last ? (P.pos.x - ride.last.x) * P.front.x + (P.pos.z - ride.last.z) * P.front.z : 0;          // forward is forward, backing up turns them back
    ride.last = P.pos.clone();
    rollWheels(spinners(v), went);
    smoke -= dt;
    if (smoke <= 0) { smoke = moving ? 0.16 : 0.5; G.vfx.burst("smoke", P.pos.x - P.front.x, P.pos.y + 2.2, P.pos.z - P.front.z, 0.12); if (moving) G.vfx.burst("dust", P.pos.x - P.front.x * 2.4, P.pos.y + 0.2, P.pos.z - P.front.z * 2.4, 0.2); }
    sound -= dt;
    if (sound <= 0) { sound = moving ? 0.34 : 0.7; G.sfx(moving ? "engine" : "idlee"); }
    did -= dt;
    if (c.work && moving && did <= 0 && P.ground?.on === "home") { did = 0.1; const rx = P.pos.x - P.front.x * 2.6, rz = P.pos.z - P.front.z * 2.6; for (const o of [-1, 0, 1]) work(c.work, rx + P.front.z * o * 2, rz - P.front.x * o * 2); }
  };
  return V;
}
export { ITEMS };
