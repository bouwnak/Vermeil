// creatures.js - everyone else who's alive: your dinosaur, your companion, and the people of Willowmere with their daily routines.
import * as THREE from "three";
import { character, prop } from "./assets.js";
import { ANIMALS, BRIDGE, COMPANION, FISH_PACK, ISLANDS, NPCS, RODS } from "./data.js";
import { makeTool } from "./made.js";
import { addSolid, groundAt, pushOut } from "./world.js";

const stepTo = (obj, tx, tz, speed, dt, stop = 0.4) => {
  const dx = tx - obj.pos.x, dz = tz - obj.pos.z, d = Math.hypot(dx, dz);
  if (d <= stop) return false;
  const v = Math.min(speed * dt, d);
  obj.pos.x += dx / d * v; obj.pos.z += dz / d * v;
  const want = Math.atan2(dx, dz);
  let a = want - obj.heading;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  obj.heading += a * Math.min(1, dt * 6);
  return true;
};

export async function makeCompanion(G) {
  const c = await character(COMPANION.model, 1.6);
  if (!c) return null;
  c.root.traverse((o) => {                                 // she wears one outfit, as in the room
    const n = o.name || "";
    let m = /^body_([a-z]+)$/i.exec(n) || /^(mech|city|school)_\w+$/i.exec(n);
    if (m) o.visible = m[1].toLowerCase() === "mech";
    m = /^hair_(\w+)$/i.exec(n);
    if (m) o.visible = m[1].toLowerCase() === "original";
  });
  const v = { char: c, pos: G.player.pos.clone().add(new THREE.Vector3(2.5, 0, 2)), heading: 0 };
  let stuck = 0;
  G.scene.add(c.holder);
  v.tick = (dt) => {
    const P = G.player, dist = v.pos.distanceTo(P.pos);
    c.mixer.update(dt);
    c.holder.visible = !P.sailing && P.mode !== "fly" && P.mode !== "swim";               // on the water, she's along for the ride
    if (!c.holder.visible) { v.pos.copy(P.pos); return; }
    const beside = (k) => { for (let i = 0; i < 8; i++) { const a = i * 0.8 + 1, x = P.pos.x + Math.cos(a) * k, z = P.pos.z + Math.sin(a) * k; if (groundAt(G, x, z).on !== "sea") return [x, z]; } return null; };
    if (dist > 30 || stuck > 2) { const at = beside(2.4); if (at) { v.pos.x = at[0]; v.pos.z = at[1]; v.pos.y = groundAt(G, at[0], at[1]).y; stuck = 0; } }
    const fx = v.pos.x, fz = v.pos.z, moving = stepTo(v, P.pos.x + 1.4, P.pos.z + 1.4, dist > 10 ? 7.5 : 3.4, dt, 2.2);
    pushOut(G, v.pos, 0.4);
    const g = groundAt(G, v.pos.x, v.pos.z);
    if (g.on === "sea" || (g.y - groundAt(G, fx, fz).y) / Math.max(0.001, Math.hypot(v.pos.x - fx, v.pos.z - fz)) > 1.2) { v.pos.x = fx; v.pos.z = fz; if (moving) stuck += dt; }           // no wading, no walking up cliffs
    else if (moving) stuck = 0;
    v.pos.y = groundAt(G, v.pos.x, v.pos.z).y;
    if (G.talkingTo === "vermeil") { const a = Math.atan2(P.pos.x - v.pos.x, P.pos.z - v.pos.z); v.heading = a; }
    c.play(moving ? (dist > 10 ? "run" : "walk") : "idle");
    c.holder.position.copy(v.pos);
    c.holder.rotation.y = v.heading;
  };
  return v;
}

/** the place an NPC should be at this hour */
export function placeAt(schedule, hour) {
  let at = schedule[schedule.length - 1][1];
  for (const [h, place] of schedule) if (hour >= h) at = place;
  return at;
}

/** everyone who lives on a turtle arrives with it. Near: they walk their day. Far: they're simply wherever they should be */
export function makePeople(G) {
  const list = [];
  G.peopleOf = async (L) => {
    const id = L.cfg.id;
    await Promise.all(Object.entries(NPCS).filter(([, n]) => (n.land || "willowmere") === id).map(async ([key, n]) => {
      const c = await character(n.model, 1.72);
      if (!c) return;
      const places = n.places || ISLANDS[id].places, at = () => places[placeAt(n.schedule, (G.s.minute / 60) % 24)] || Object.values(places)[0];
      const [x, z] = at(), p = { id: key, data: n, char: c, L, pos: new THREE.Vector3(x, L.land.ground(x, z), z), heading: 0, line: 0 };
      L.group.add(c.holder); c.holder.position.copy(p.pos);
      p.here = () => !n.visiting || G.s.day % 9 === 0;
      p.world = () => { const [a, b] = L.world(p.pos.x, p.pos.z); return new THREE.Vector3(a, p.pos.y, b); };
      p.tick = (dt, near) => {
        c.holder.visible = p.here();
        const [tx, tz] = at();
        if (!near) { p.pos.x = tx; p.pos.z = tz; p.pos.y = L.land.ground(tx, tz); c.holder.position.copy(p.pos); return; }
        c.mixer.update(dt);
        const talking = G.talkingTo === p, wet = G.s.weather === "storm" || G.s.weather === "heavy";     // a bad day keeps them moving indoors a little quicker
        const moving = !talking && stepTo(p, tx, tz, wet ? 3 : 2.1, dt);
        if (talking) { const P = G.player.pos, w = p.world(); p.heading = Math.atan2(P.x - w.x, P.z - w.z) - L.group.rotation.y; }
        p.pos.y = L.land.ground(p.pos.x, p.pos.z);
        c.play(moving ? "walk" : talking ? "act" : "idle");
        c.holder.position.copy(p.pos);
        c.holder.rotation.y = p.heading;
      };
      list.push(p);
    }));
  };
  return list;
}

/** Pip carries the post: over the bridge in the morning, around your farm, and home before it lifts */
export async function makeCourier(G) {
  const c = await character("ultimate_modular_men/Casual_2.gltf", 1.72);
  if (!c) return null;
  G.scene.add(c.holder);
  const way = () => { const t = G.world.lands.willowmere.group.position; return [[t.x + 8, t.z - 30], [t.x, t.z - 72], [36, 92], [36, 40], [24, 8]]; };
  const p = { char: c, pos: new THREE.Vector3(), heading: 0, i: 0, data: { name: "Pip", role: "Courier", talk: ["Post! Nothing for you. Nice to see you though.", "I walk this bridge twice a day. Never gets old.", "Mind the gap when it lifts."] }, line: 0 };
  p.world = () => p.pos;
  p.tick = (dt, near) => {
    const h = G.s.minute / 60, B = G.world.bridge, up = B.open >= 1 && h > BRIDGE.open + 0.5 && h < BRIDGE.close - 1.5;
    c.holder.visible = up;
    if (!up) { p.i = 0; const w = way()[0]; p.pos.set(w[0], 0, w[1]); return; }
    if (!near) return;
    c.mixer.update(dt);
    const W = way(), goal = W[Math.min(W.length - 1, h < 14.5 ? p.i : W.length - 1 - p.i)];
    const moving = !(G.talkingTo === p) && stepTo(p, goal[0], goal[1], 2.6, dt, 0.8);
    if (!moving && G.talkingTo !== p) p.i = h < 14.5 ? Math.min(W.length - 1, p.i + 1) : Math.min(W.length - 1, p.i + 1);
    if (Math.abs(h - 14.5) < 0.05) p.i = 0;
    p.pos.y = groundAt(G, p.pos.x, p.pos.z).y;
    c.play(moving ? "walk" : "idle");
    c.holder.position.copy(p.pos); c.holder.rotation.y = p.heading;
  };
  return p;
}

/** the farm's animals: they graze and amble about near where they live */
export async function makeAnimals(G) {
  const land = G.world.lands.home.land, list = [];
  await Promise.all(ANIMALS.map(async ([name, size, x, z, gives]) => {
    const c = await character(`conv_farm_animals/${name}.glb`, size);
    if (!c) return;
    const a = { char: c, name, gives, pos: new THREE.Vector3(x, land.ground(x, z), z), home: [x, z], heading: Math.random() * 6, next: Math.random() * 6, goal: null };
    G.scene.add(c.holder);
    a.tick = (dt, t) => {
      c.mixer.update(dt);
      if (t > a.next) { a.next = t + 5 + Math.random() * 9; a.goal = Math.random() < 0.6 ? [x + (Math.random() - 0.5) * 12, z + (Math.random() - 0.5) * 12] : null; }
      const moving = a.goal ? stepTo(a, a.goal[0], a.goal[1], 1, dt) : false;
      a.pos.y = land.ground(a.pos.x, a.pos.z);
      pushOut(G, a.pos, 0.5);
      c.play(moving ? "walk" : "idle");
      c.holder.position.copy(a.pos);
      c.holder.rotation.y = a.heading;
    };
    list.push(a);
  }));
  return list;
}

/** fish you can see from the shore: a few circle under the surface around your tail and the dock */
export async function makeSchool(G) {
  const list = [], pick = ["Clownfish", "Koi", "Tang", "YellowTang", "Goldfish", "Puffer", "ParrotFish", "BlueTang"];
  await Promise.all(pick.map(async (model, i) => {
    const c = await character(`${FISH_PACK}${model}.glb`, 0.7);
    if (!c) return;
    c.play("swim");
    const f = { char: c, a: i * 0.8, r: 12 + (i % 4) * 7, cx: -176 + (i % 3) * 14, cz: i % 2 ? 16 : -16, v: 0.16 + (i % 3) * 0.05 };
    G.scene.add(c.holder);
    f.tick = (dt, near) => {
      c.holder.visible = near;
      if (!near) return;
      c.mixer.update(dt);
      f.a += f.v * dt;
      c.holder.position.set(f.cx + Math.cos(f.a) * f.r, -0.9 - (i % 3) * 0.3, f.cz + Math.sin(f.a) * f.r);
      c.holder.rotation.y = -f.a;
    };
    list.push(f);
  }));
  return list;
}

/** the rod in your hand, its lure and its line, and the fish you just landed */
export function makeTackle(G) {
  // (holding the rod or any other tool)
  const hold = new THREE.Group(), lure = new THREE.Group(), tools = {};
  for (const id of ["hoe", "can", "axe", "pick"]) { tools[id] = makeTool(id); tools[id].visible = false; hold.add(tools[id]); }
  G.scene.add(lure);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  line.frustumCulled = false; line.visible = false; G.scene.add(line);
  let hand = null, owner = null, shown = 0, trophy = null, until = 0;
  const T = { hold, lure, line };
  const fit = async (o, parent, height) => { parent.clear(); const made = await prop(`${FISH_PACK}${o}.glb`, parent, { height }); return made; };
  T.refresh = async () => {
    const r = RODS[(G.s.rod || 1) - 1];
    T.rod?.parent?.remove(T.rod);
    T.rod = await prop(`${FISH_PACK}${r.model}.glb`, hold, { height: 1.7 });
    await fit(r.lure, lure, 0.2);
    T.rod?.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    shown = r.level;
  };
  T.tick = (dt, t, fishing) => {
    const P = G.player;
    if (owner !== P.char) {                                // a new outfit is a new skeleton
      owner = P.char; hand = null;
      owner.root.traverse((o) => { if (!hand && o.isBone && /^(wrist|hand)[_.]?r$|^right_?hand$/i.test(o.name)) hand = o; });
      if (hand) { hand.add(hold); const s = new THREE.Vector3(); hand.getWorldScale(s); hold.scale.setScalar(1 / (s.y || 1)); hold.rotation.set(1.3, 0, 0); }
    }
    if (shown !== (G.s.rod || 1)) T.refresh();
    const held = G.tool?.id;
    hold.visible = !!hand && !P.riding && !P.sailing;
    if (T.rod) T.rod.visible = held === "rod";
    for (const [id, m] of Object.entries(tools)) m.visible = held === id;
    lure.visible = line.visible = !!fishing.on;
    if (fishing.on) {
      const p = line.geometry.attributes.position, tip = new THREE.Vector3(0, 1.7, 0);
      T.rod ? hold.localToWorld(tip) : tip.copy(P.pos).add(new THREE.Vector3(0, 2, 0));
      p.setXYZ(0, tip.x, tip.y, tip.z); p.setXYZ(1, lure.position.x, lure.position.y, lure.position.z); p.needsUpdate = true;
    }
    if (trophy) {
      trophy.mixer.update(dt);
      trophy.holder.position.copy(P.pos).add(new THREE.Vector3(0, 2.7 + Math.sin(t * 5) * 0.06, 0));
      trophy.holder.rotation.y += dt * 2.2;
      if (t > until) { G.scene.remove(trophy.holder); trophy = null; }
    }
  };
  /** you land a fish: it flops in the air over your head for a moment */
  T.show = async (fish) => {
    const c = await character(`${FISH_PACK}${fish.model}.glb`, 0.95);
    if (!c) return;
    if (trophy) G.scene.remove(trophy.holder);
    c.play("flop");
    G.scene.add(c.holder);
    trophy = c;
    until = G.clock.elapsedTime + 2.4;
  };
  return T;
}
export { addSolid };
