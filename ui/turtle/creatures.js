// creatures.js - everyone else who's alive: your dinosaur, your companion, and the people of Willowmere with their daily routines.
import * as THREE from "three";
import { character, prop } from "./assets.js";
import { ANIMALS, BRIDGE, CATALOG, COMPANION, FISH_PACK, ISLANDS, NPCS, RODS } from "./data.js";
import { makeChicken, makeTool } from "./made.js";
import { addSolid, groundAt, pushLocal, pushOut } from "./world.js";
import { keyOf, ripe, spotOf } from "./farm.js";

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

/** whoever is the active character in the app comes along; if the game is running by itself, the default */
async function activeModel() {
  try {
    const api = window.pywebview?.api || await new Promise((done) => { addEventListener("pywebviewready", () => done(window.pywebview.api), { once: true }); setTimeout(() => done(null), 900); });
    if (!api?.get_state) return null;
    const st = await api.get_state(), a = (st.characters || []).find((c) => c.id === st.active);
    if (!a) return null;
    // a character's model is a file in ui/models, named by itself. A built-in shape (Pip's penguin) has no file to load, so the default body stands in under its name
    const file = /\.(glb|gltf)$/i.test(a.model || "") ? `../models/${String(a.model).replace(/^\/+/, "").replace(/^models\//, "")}` : null;
    return { model: file, name: a.name, outfit: a.outfit, hair: a.hair, own: !!file };
  } catch (e) { console.warn("[turtle] active character", e); }
  return null;
}

export async function makeCompanion(G) {
  const me = await activeModel();
  if (me?.name) COMPANION.name = me.name;
  const c = (me?.model && await character(me.model, 1.6, true)) || await character(COMPANION.model, 1.6);
  if (!c) return null;
  c.root.traverse((o) => {                                 // she wears one outfit, as in the room
    const n = o.name || "";
    let m = /^body_([a-z]+)$/i.exec(n) || /^(mech|city|school)_\w+$/i.exec(n);
    if (m) o.visible = m[1].toLowerCase() === (me?.outfit || "mech").toLowerCase();
    m = /^hair_(\w+)$/i.exec(n);
    if (m) o.visible = m[1].toLowerCase() === (me?.hair || "original").toLowerCase();
  });
  const v = { char: c, pos: G.player.pos.clone().add(new THREE.Vector3(2.5, 0, 2)), heading: 0 };
  let stuck = 0, job = null, busy = 0, rest = 0;
  /** looking after the farm: nearest thing that wants doing, ripe crops first, then weeds, then water. With nothing to do, a walk round the field */
  const tend = (dt) => {
    const s = G.s, P = G.player;
    c.holder.visible = true;
    if (!job || !s.plots[job.k]) {
      job = null;
      let best = 1e9;
      for (const [k, p] of Object.entries(s.plots)) {
        const need = ripe(p) ? 0 : p.weed ? 1 : p.crop && !p.wet ? 2 : -1;
        if (need < 0) continue;
        const [x, z] = spotOf(k), d = Math.hypot(x - v.pos.x, z - v.pos.z) + need * 30;
        if (d < best) { best = d; job = { k, x, z, need }; }
      }
      if (!job && (rest -= dt) < 0) { rest = 6 + Math.random() * 8; const house = G.build.of("house")[0]?.p || { x: 30, z: -29 }, a = Math.random() * 6.3; v.idle = [house.x + Math.cos(a) * 14, house.z + 12 + Math.sin(a) * 8]; }
    }
    const to = job ? [job.x, job.z] : v.idle, moving = to ? stepTo(v, to[0], to[1], 3.8, dt, job ? 1.2 : 1) : false;
    pushOut(G, v.pos, 0.4);
    v.pos.y = groundAt(G, v.pos.x, v.pos.z).y;
    if (job && !moving && (busy += dt) > 1) {
      busy = 0; c.once?.("wave");
      const p = s.plots[job.k], y = v.pos.y + 0.6;
      if (job.need === 0 && ripe(p)) G.reap(job.k, p, true);
      else if (job.need === 1) { p.weed = false; G.vfx.burst("leaf", job.x, y, job.z); G.farm.draw(); }
      else if (job.need === 2) { p.wet = true; G.vfx.burst("water", job.x, y + 0.2, job.z); G.farm.draw(); }
      job = null;
    }
    if (G.talkingTo === "vermeil") v.heading = Math.atan2(P.pos.x - v.pos.x, P.pos.z - v.pos.z);
    c.play(moving ? "walk" : "idle");
    c.holder.position.copy(v.pos); c.holder.rotation.y = v.heading;
  };
  G.scene.add(c.holder);
  v.tick = (dt) => {
    const P = G.player, dist = v.pos.distanceTo(P.pos);
    c.mixer.update(dt);
    if (G.s.helper === "farm") return tend(dt);
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
        if (moving) pushLocal(L, p.pos, 0.45);
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
  await Promise.all(ANIMALS.map(async ([name, size, x, z, gives], num) => {
    const c = await character(`conv_farm_animals/${name}.glb`, size);
    if (!c) return;
    const key = `${name}${num}`, [hx0, hz0] = G.s.animalHome?.[key] || [x, z];          // wherever you last set it down
    const a = { key, char: c, name, gives, pos: new THREE.Vector3(hx0, land.ground(hx0, hz0), hz0), home: [hx0, hz0], heading: Math.random() * 6, next: Math.random() * 6, goal: null };
    G.scene.add(c.holder);
    a.small = size < 1.25;
    a.tick = (dt, t) => {
      c.O.undo();
      c.mixer.update(dt);
      const P = G.player;
      if (a.held) {                                         // in your arms (a small one), or walking at your side on a lead (a big one)
        if (a.small) { c.holder.position.copy(P.pos).addScaledVector(P.front, 0.45).add(new THREE.Vector3(0, 0.75, 0)); c.holder.rotation.y = P.heading + Math.PI / 2; c.play("idle"); return; }
        const want = P.pos.clone().addScaledVector(new THREE.Vector3(Math.cos(P.heading), 0, -Math.sin(P.heading)), 2.2).addScaledVector(P.front, -1);
        const moving = stepTo(a, want.x, want.z, 5, dt, 0.4);
        a.pos.y = land.ground(a.pos.x, a.pos.z); c.play(moving ? "walk" : "idle"); c.holder.position.copy(a.pos); c.holder.rotation.y = a.heading; return;
      }
      const pen = G.s.penned?.[a.key] && G.build.things.get(G.s.penned[a.key]), hx = pen ? pen.p.x : a.home[0], hz = pen ? pen.p.z : a.home[1], far = pen ? 13 : 12;
      if (t > a.next) { a.next = t + 5 + Math.random() * 9; a.goal = Math.random() < 0.6 ? [hx + (Math.random() - 0.5) * far, hz + (Math.random() - 0.5) * far] : null; }
      const moving = a.goal ? stepTo(a, a.goal[0], a.goal[1], 1, dt) : false;
      a.pos.y = land.ground(a.pos.x, a.pos.z);
      pushOut(G, a.pos, 0.5);
      c.play(moving ? "walk" : "idle");
      a.gait = (a.gait || 0) + ((moving ? 1 : 0) - (a.gait || 0)) * Math.min(1, dt * 6);
      if (!c.actions.walk && a.gait > 0.01) {               // the pack gave these no walk: a calm four-beat walk on the same bones, the feet swinging from the hip with the knee following. No bounce
        a.step = (a.step || 0) + dt * 6.5;
        for (const [n, p] of [["FrontUpLegL", 0], ["BackUpLegR", 1.57], ["FrontUpLegR", 3.14], ["BackUpLegL", 4.71]]) {
          const g = (u) => { const b = (a.b ||= {})[u] ??= c.root.getObjectByName(u); return b; }, swing = Math.sin(a.step + p);
          c.O.turn(g(n), "x", swing * 0.42 * a.gait); c.O.turn(g(n.replace("Up", "Low")), "x", Math.max(0, -Math.cos(a.step + p)) * 0.5 * a.gait);
        }
        c.O.turn(a.b.Head ??= c.root.getObjectByName("Head"), "x", Math.sin(a.step * 2) * 0.03 * a.gait);
      }
      const head = (a.b ||= {}).Head ??= c.root.getObjectByName("Head");
      if (head && !moving) c.O.keep(head).rotation.x += Math.max(0, Math.sin(t * 0.4 + x)) * 0.5;      // heads down to graze
      c.holder.position.copy(a.pos);
      c.holder.rotation.y = a.heading;
    };
    list.push(a);
  }));
  return list;
}

/** hens live in the coop: in the day they come out of its door one by one, scratch and peck about nearby, and go back in. At night they're all inside */
export function makeChickens(G) {
  const land = G.world.lands.home.land, flock = new Map(), H = {}, COLORS = [0xf6f1e6, 0xf6f1e6, 0xc98a4a, 0x8a5a3a, 0xe8dcc8];
  let lookIn = 0;
  const door = (t) => { const c = CATALOG[t.p.type], d = (c.r || 1.9) + 0.7; return [t.p.x + Math.sin(t.p.ry) * d, t.p.z + Math.cos(t.p.ry) * d]; };
  H.tick = (dt, t) => {
    if ((lookIn -= dt) <= 0) {                                 // coops come and go as you build: each one has its hens
      lookIn = 2;
      const coops = [...G.build.things.values()].filter((x) => CATALOG[x.p.type]?.use === "coop");
      for (const c of coops) if (!flock.has(c.p.id)) flock.set(c.p.id, [...Array(4)].map((_, i) => { const h = makeChicken(COLORS[(c.p.id + i) % COLORS.length]); h.holder.visible = false; G.scene.add(h.holder); return { h, coop: c, state: "in", until: t + 2 + i * 4 + Math.random() * 8, pos: new THREE.Vector3(), heading: 0, goal: null, peck: 0 }; }));
      for (const [id, list] of flock) if (!coops.some((c) => c.p.id === id)) { for (const k of list) G.scene.remove(k.h.holder); flock.delete(id); }
    }
    const hour = G.s.minute / 60, day = hour > 6.5 && hour < 19, P = G.player.pos;
    for (const list of flock.values()) for (const k of list) {
      const [dx, dz] = door(k.coop);
      if (k.state === "in") {
        k.h.holder.visible = false;
        if (day && t > k.until) { k.state = "out"; k.until = t + 30 + Math.random() * 60; k.pos.set(dx, land.ground(dx, dz), dz); k.heading = k.coop.p.ry; k.goal = null; }
        continue;
      }
      k.h.holder.visible = Math.hypot(k.pos.x - P.x, k.pos.z - P.z) < 120;
      if (k.state === "out" && (t > k.until || !day)) { k.state = "home"; k.goal = [dx, dz]; }
      if (k.state === "out" && !k.goal && t > (k.next || 0)) {
        k.next = t + 2 + Math.random() * 5;
        if (Math.random() < 0.6) { const a = Math.random() * 6.3, r = 1.5 + Math.random() * 7; k.goal = [dx + Math.sin(k.coop.p.ry) * 3 + Math.cos(a) * r, dz + Math.cos(k.coop.p.ry) * 3 + Math.sin(a) * r]; k.peck = 0; }
        else k.peck = 1.5 + Math.random() * 2;              // a scratch and a peck at the ground
      }
      const moving = k.goal ? stepTo(k, k.goal[0], k.goal[1], k.state === "home" ? 1.6 : 1.1, dt, 0.25) : false;
      if (k.goal && !moving) { if (k.state === "home") { k.state = "in"; k.until = t + 20 + Math.random() * 50; continue; } k.goal = null; }
      if (k.state === "out") pushOut(G, k.pos, 0.2);
      k.pos.y = land.ground(k.pos.x, k.pos.z);
      k.peck = Math.max(0, k.peck - dt);
      k.h.move(dt, t, moving, k.peck > 0);
      k.h.holder.position.copy(k.pos); k.h.holder.rotation.y = k.heading;
    }
  };
  H.count = () => [...flock.values()].reduce((n, l) => n + l.length, 0);
  return H;
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
  tools.can.scale.setScalar(0.72); tools.can.position.set(0, -0.2, -0.1);
  G.scene.add(lure, hold);
  const left = new THREE.Vector3(), shaft = new THREE.Vector3(), edge = new THREE.Vector3(), basis = new THREE.Matrix4();
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
    }
    if (shown !== (G.s.rod || 1)) T.refresh();
    const held = G.tool?.id;
    hold.visible = !!hand && !P.riding && !P.sailing;
    if (hold.visible) {                                      // the tool goes where your hands have gone
      const grip = P.grip;
      if (!grip) hold.visible = false;
      else {
        shaft.copy(grip.shaft);
        left.set(Math.cos(P.heading), 0, -Math.sin(P.heading)).addScaledVector(shaft, -left.dot(shaft)).normalize();
        edge.crossVectors(left, shaft);
        hold.quaternion.setFromRotationMatrix(basis.makeBasis(left, shaft, edge));
        hold.position.copy(grip.hand).addScaledVector(shaft, 0.02);
      }
    }
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
