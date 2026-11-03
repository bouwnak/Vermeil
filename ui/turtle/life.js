// life.js - everything that makes the world busy: wild herds on every turtle, birds and pterosaurs crossing the sea and settling in trees, and crowds in the towns.
import * as THREE from "three";
import { DINOS, HERDS, ISLANDS, SKINS, modelOf, rollLook } from "./data.js";
import { makeDinoBody } from "./dinomodel.js";
import { makeLofted } from "./made.js";
import { character } from "./assets.js";
import { clearAt, groundAt, nearest, pushLocal, shoreNear } from "./world.js";

const OUTFITS = [...SKINS.male.map(([s]) => ["male", s]), ...SKINS.female.map(([s]) => ["female", s])].filter(([, s]) => !/Swat|Spacesuit|SciFi|Soldier|King/.test(s));
/** a sea creature keeps to the water and the beach: never up onto the grass */
export const SAND = 3.6;
export const seaKind = (data) => data.shape?.kind === "plesio";
export const sandy = (g) => g.on === "sea" || g.y < SAND;
/** somewhere a sea creature can go from here: along the beach or out into the water */
export function seaSpot(G, x, z, reach = 24) {
  for (let i = 0; i < 12; i++) { const a = Math.random() * 6.3, r = 6 + Math.random() * reach, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (sandy(groundAt(G, px, pz))) return [px, pz]; }
  return null;
}
/** a random number that's the same for one day and one name: today's herd looks the same whoever loads it */
export const dayRnd = (day, name) => { let h = 2166136261; for (const ch of `${day}:${name}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; };
const turn = (o, want, dt, rate = 6) => { let a = want - o.heading; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; o.heading += a * Math.min(1, dt * rate); };

export function makeLife(G) {
  const L = { herd: [], flyers: [], folk: [] };
  /** wild herds arrive with their turtle; any of them can be tamed once its kind is unlocked */
  L.herdOf = async (land) => {
    for (const [species, count, x, z, spread] of HERDS[land.cfg.id] || []) for (let i = 0; i < count; i++) {
      const data = DINOS[species], stage = i === 0 && count > 1 ? 2 : i % 2, look = rollLook(species, dayRnd(G.s.day, `${land.cfg.id}${species}${i}`)), c = await makeDinoBody(data, stage, data.sizes[stage], look);
      const a = i * 2.4, lx = x + Math.cos(a) * spread * 0.5, lz = z + Math.sin(a) * spread * 0.5, [wx, wz] = land.world(lx, lz);
      const w = { species, stage, land, data, look, char: c, pos: new THREE.Vector3(wx, 0, wz), heading: a, wander: Math.random() * 6, home: [x, z], spread, goal: null, trust: 0, sea: seaKind(data), slot: `${land.cfg.id}${species}${i}` };
      if (w.sea && !sandy(groundAt(G, wx, wz))) { const s = shoreNear(G, wx, wz, 260); if (s) { w.pos.x = s[0] + Math.sin(s[2]) * 4; w.pos.z = s[1] + Math.cos(s[2]) * 4; } }     // it lives where the land meets the sea
      w.pos.y = sandy(groundAt(G, w.pos.x, w.pos.z)) && groundAt(G, w.pos.x, w.pos.z).on === "sea" ? 0 : groundAt(G, w.pos.x, w.pos.z).y;
      G.scene.add(c.holder);
      L.herd.push(w);
    }
  };
  /** a new morning, a new herd: each wild one is born again with a fresh look (the same all day, whoever looks), so a rare one can turn up any day */
  L.respawn = async () => {
    for (const w of L.herd) {
      const look = rollLook(w.species, dayRnd(G.s.day, w.slot || w.species)), c = await makeDinoBody(w.data, w.stage, w.data.sizes[w.stage], look);
      G.scene.remove(w.char.holder); w.char = c; w.look = look; w.trust = 0; G.scene.add(c.holder);
    }
  };
  // ---------------- things in the air ----------------
  const makeBird = (color) => {
    const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color, flatShading: true, side: THREE.DoubleSide }), body = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.46, 4), mat);
    body.rotation.x = Math.PI / 2; g.add(body);
    const wings = [-1, 1].map((s) => { const p = new THREE.Group(), w = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.1), new THREE.Vector3(s * 0.56, 0, -0.06), new THREE.Vector3(0, 0, -0.14)]), mat); w.geometry.computeVertexNormals(); p.add(w); g.add(p); return { p, s }; });
    return { holder: g, move(dt, t, flying, speed) { for (const w of wings) w.p.rotation.z = flying ? w.s * Math.sin(t * speed) * 0.8 : -w.s * 1.3; } };
  };
  const pickRest = (f) => {
    const land = G.world.list[Math.floor(Math.random() * G.world.list.length)];
    if (!land.group.visible) return null;
    const [wx, wz] = land.world((Math.random() - 0.5) * land.cfg.a * 1.4, (Math.random() - 0.5) * land.cfg.b * 1.4);
    const tree = f.big ? null : nearest(G, wx, wz, 30, (r) => r.node === "tree" && !r.off && !r.debris);     // a real tree: never a stump or a log on the ground
    if (tree) { const [x, z] = tree.L.world(tree.x, tree.z); return { x, z, y: groundAt(G, x, z).y + 4.6 + Math.random() * 1.5, tree }; }
    const g = groundAt(G, wx, wz);
    return g.on === "sea" ? null : { x: wx, z: wz, y: g.y + (f.big ? 0.1 : 0.05) };
  };
  L.start = async () => {
    const colors = [0xffffff, 0x4a5560, 0xe0a24a, 0xd8634a, 0x6fa6d8];
    for (let i = 0; i < 26; i++) { const c = makeBird(colors[i % colors.length]); G.scene.add(c.holder); L.flyers.push({ c, pos: new THREE.Vector3(Math.cos(i) * 150, 30 + i, Math.sin(i) * 120), heading: i, state: "fly", at: null, wait: 0, speed: 14 + i % 8, big: false }); }
    for (let i = 0; i < 9; i++) { const stage = 1 + i % 2, spec = DINOS.feather, c = makeLofted(spec, stage, spec.sizes[stage]); G.scene.add(c.holder); L.flyers.push({ c, pos: new THREE.Vector3(Math.cos(i * 2) * 260, 60 + i * 4, Math.sin(i * 2) * 260), heading: i, state: "fly", at: null, wait: 0, speed: 18 + i, big: true }); }
  };
  // ---------------- people ----------------
  L.folkOf = async (land) => {
    const cfg = land.cfg, n = cfg.id === "willowmere" ? 30 : cfg.folk || 0, f = cfg.flats?.[0];
    if (!n || !f) return;
    await Promise.all([...Array(n)].map(async (_, i) => {
      const [body, skin] = OUTFITS[(i * 7 + cfg.seed) % OUTFITS.length], c = await character(modelOf(body, skin), 1.62 + (i % 4) * 0.05);
      if (!c) return;
      const spot = () => { for (let k = 0; k < 12; k++) { const a = Math.random() * 6.3, r = 6 + Math.random() * (f.r * 0.62), x2 = f.x + Math.cos(a) * r, z2 = f.z + Math.sin(a) * r; if (clearAt(land, x2, z2, 0.9)) return [x2, z2]; } return [f.x + 7, f.z + 7]; }, [x, z] = spot();
      const p = { char: c, land, pos: new THREE.Vector3(x, land.land.ground(x, z), z), heading: i, goal: spot(), wait: Math.random() * 5, spot };
      land.group.add(c.holder); c.holder.position.copy(p.pos);
      L.folk.push(p);
    }));
  };
  const step = (o, tx, tz, speed, dt, stop = 0.5) => { const dx = tx - o.pos.x, dz = tz - o.pos.z, d = Math.hypot(dx, dz); if (d <= stop) return false; const v = Math.min(speed * dt, d); o.pos.x += dx / d * v; o.pos.z += dz / d * v; turn(o, Math.atan2(dx, dz), dt); return true; };

  /** across the drawbridge: to its near end, over, and on to somewhere open on the other turtle. -> the stops, in the world */
  const crossing = (w) => {
    const B = G.world.bridge, W = G.world, home = W.lands.home, town = W.lands.willowmere, toTown = w.land === home, there = toTown ? town : home;
    const near = toTown ? B.z0 : B.z1, far = toTown ? B.z1 : B.z0, out = toTown ? 1 : -1;
    const f = there.cfg.flats[0], a = Math.random() * 6.3, r = Math.random() * f.r * 0.6, [x, z] = there.world(f.x + Math.cos(a) * r, f.z + Math.sin(a) * r);
    return { to: there, stops: [[B.x, near - out * 6], [B.x, near + out * 1], [B.x, far - out * 1], [B.x, far + out * 7], [x, z]] };
  };
  L.tick = (dt, t) => {
    const P = G.player.pos, frameDt = dt, W = G.world, B = W.bridge, town = W.lands.willowmere;
    // what stands on Willowmere goes where Willowmere goes: when it drifts in or out, its herds go with it
    const tp = town.group.position, moved = L.townAt ? [tp.x - L.townAt.x, tp.z - L.townAt.z] : [0, 0];
    L.townAt = tp.clone();
    const hour = G.s.minute / 60, bridgeUp = B?.open >= 1 && W.townK < 0.01;
    for (const w of L.herd) {
      dt = frameDt;
      if (w.land === town && !w.trip) { w.pos.x += moved[0]; w.pos.z += moved[1]; }
      // now and then, while the bridge is down, one wanders over to the other turtle, and back before it lifts
      if (bridgeUp && !w.sea && !w.trip && (w.land === town || w.land === W.lands.home) && t > (w.wander || 0) && (w.away ? hour > 18 || Math.random() < 0.02 : hour < 17 && Math.random() < 0.006)) {
        const c = crossing(w); w.trip = c.stops; w.tripTo = c.to; w.away = !w.away; w.goal = null; w.then = false;
      }
      if (w.trip && !bridgeUp && w.trip.length > 3) { w.trip = null; w.away = !w.away; }       // the bridge lifted before it set off: it stays where it is
      const near = w.land.dist(P.x, P.z) < w.land.cfg.a + 180, close = near && w.pos.distanceTo(P) < 130;
      w.char.holder.visible = near;
      if (!close) continue;
      const dist = w.pos.distanceTo(P);
      w.char.lookAt = dist < 10 ? P : null;
      w.due = (w.due || 0) + dt;                             // far ones are moved in larger, rarer steps: nobody can see their feet from there
      if (dist > 50 && (w.tock = ((w.tock || 0) + 1) % 3)) continue;
      dt = w.due; w.due = 0;
      if (w.drinking > t) { w.char.move(dt, t, false, false, ""); continue; }
      if (w.goal && w.then && !w.goal.moved && Math.hypot(w.pos.x - w.goal[0], w.pos.z - w.goal[1]) < 1.2) { w.then = false; w.goal = null; w.drinking = t + 5; w.char.drink?.(5); continue; }
      if (w.trip) {                                           // on its way over: one stop after the next, then it lives over there for a while
        w.goal = w.trip[0];
        if (Math.hypot(w.pos.x - w.goal[0], w.pos.z - w.goal[1]) < 1.5) { w.trip.shift(); if (!w.trip.length) { w.trip = null; w.goal = null; w.land = w.tripTo; w.home = w.land.local(w.pos.x, w.pos.z); w.spread = 14; w.wander = t + 2; } }
      } else if (t > w.wander) {
        w.wander = t + 3 + Math.random() * 8;
        const sea = !w.sea && Math.random() < 0.14 ? shoreNear(G, w.pos.x, w.pos.z, 50) : null;
        if (w.sea) { w.goal = Math.random() < 0.7 ? seaSpot(G, w.pos.x, w.pos.z) : null; if (!w.goal && Math.random() < 0.3) w.char.react?.("play"); }
        else if (sea) { w.goal = sea; w.then = true; w.wander = t + 20; }
        else {
        const r = Math.random() < 0.65, [gx, gz] = w.land.world(w.home[0] + (Math.random() - 0.5) * w.spread * 2, w.home[1] + (Math.random() - 0.5) * w.spread * 2);
        w.goal = r ? [gx, gz] : null;
        if (!r && Math.random() < 0.3) w.char.react?.(Math.random() < 0.5 ? "roar" : "play");
        }
      }
      const fx = w.pos.x, fz = w.pos.z, moving = w.goal ? step(w, w.goal[0], w.goal[1], 1.8 + w.stage * 0.6, dt, 0.9) : false;
      const g = groundAt(G, w.pos.x, w.pos.z), rise = moving ? (g.y - w.pos.y) / Math.max(1e-3, Math.hypot(w.pos.x - fx, w.pos.z - fz)) : 0;
      if (w.trip) { if (g.on === "sea") { w.pos.x = fx; w.pos.z = fz; w.trip = null; w.away = !w.away; } }          // the way over is the bridge: it never wades in
      else if (w.sea ? !sandy(g) : g.on === "sea" || rise > 1.2) { w.pos.x = fx; w.pos.z = fz; w.goal = null; }
      const gy = (q) => (q.on === "sea" ? 0 : q.y);           // at sea, on the surface
      if (!moving && !w.goal) w.pos.y += (gy(groundAt(G, w.pos.x, w.pos.z)) - w.pos.y) * Math.min(1, dt * 6); else w.pos.y = gy(g);
      w.char.move(dt, t, moving, false, g.on === "sea" ? "swim" : "");
      if (/Legendary|Mythic/.test(w.look?.tier) && Math.random() < dt * 1.5) G.vfx.burst(w.look.tier === "Mythic" ? "glow" : "gold", w.pos.x, w.pos.y + w.char.top * 0.7, w.pos.z, 0.12);      // you can tell a rare one from across a field
      w.char.holder.position.copy(w.pos); w.char.holder.rotation.y = w.heading;
    }
    dt = frameDt;
    // shoppers: while your goods are out in the daytime, people nearby walk over and buy
    if ((L.shopIn = (L.shopIn || 8) - dt) <= 0) {
      L.shopIn = 10 + Math.random() * 14;
      const stall = G.craft.openStall?.(), h = G.s.minute / 60;
      if (stall && h > 7 && h < 19) {
        const near = L.folk.filter((p) => p.land === stall.L && !p.errand).sort((a, b) => Math.hypot(a.pos.x - stall.x, a.pos.z - stall.z) - Math.hypot(b.pos.x - stall.x, b.pos.z - stall.z))[Math.floor(Math.random() * 4)];
        if (near) { near.errand = stall; near.wait = 0; near.goal = [stall.x + Math.sin(stall.ry) * 3, stall.z + Math.cos(stall.ry) * 3]; }
      }
    }
    for (const f of L.flyers) {
      if (f.state === "rest") {
        f.wait -= dt;
        if (f.big) f.c.move(dt, t, false, false, ""); else f.c.move(dt, t, false, 0);
        if (f.wait <= 0 || f.at?.tree?.off) { f.state = "fly"; f.at = null; }          // the tree it sat in came down: off it goes
      } else {
        if (!f.at) { f.at = pickRest(f); f.far = Math.random() < 0.6; }
        if (f.at) {
          const dx = f.at.x - f.pos.x, dz = f.at.z - f.pos.z, d = Math.hypot(dx, dz), cruise = Math.max(f.at.y + 8, 42 + (f.big ? 14 : 0));
          const wantY = d < 40 ? f.at.y + (d / 40) * (cruise - f.at.y) : cruise;
          f.pos.y += (wantY - f.pos.y) * Math.min(1, dt * 1.4);
          turn(f, Math.atan2(dx, dz), dt, 2.2);
          f.pos.x += Math.sin(f.heading) * f.speed * dt; f.pos.z += Math.cos(f.heading) * f.speed * dt;
          if (d < 2.5) { f.pos.y = f.at.y; f.state = "rest"; f.wait = 8 + Math.random() * 24; }
        }
        if (f.big) f.c.move(dt, t, true, true, "fly"); else f.c.move(dt, t, true, 13);
      }
      f.c.holder.position.copy(f.pos); f.c.holder.rotation.y = f.heading;
    }
    for (const p of L.folk) {
      const near = p.land.dist(P.x, P.z) < p.land.cfg.a + 70;
      p.char.holder.visible = p.land.group.visible && near;
      if (!near) continue;
      p.due = (p.due || 0) + dt;
      if (p.pos.distanceTo(P) > 60 && (p.tock = ((p.tock || 0) + 1) % 4)) continue;
      dt = p.due; p.due = 0;
      p.char.mixer.update(dt);
      p.wait -= dt;
      const was = [p.pos.x, p.pos.z], moving = p.wait <= 0 && step(p, p.goal[0], p.goal[1], p.errand ? 2.6 : 1.9, dt);
      if (moving) {                                          // round what's in the way, not through it; if it can't be got round, somewhere else will do
        pushLocal(p.land, p.pos, 0.45);
        p.held = Math.hypot(p.pos.x - was[0], p.pos.z - was[1]) < dt * 0.5 ? (p.held || 0) + dt : 0;
        if (p.held > 2) { p.held = 0; if (p.errand) p.errand = null; p.goal = p.spot(); }
      }
      if (p.wait <= 0 && !moving) {
        if (p.errand) { G.craft.buyAt(p.errand); p.errand = null; p.wait = 2; p.goal = p.spot(); }
        else { p.wait = 2 + Math.random() * 8; p.goal = p.spot(); }
      }
      p.pos.y = p.land.land.ground(p.pos.x, p.pos.z);
      p.char.play(moving ? "walk" : "idle");
      p.char.holder.position.copy(p.pos); p.char.holder.rotation.y = p.heading;
      dt = frameDt;
    }
  };
  return L;
}
export { ISLANDS };
