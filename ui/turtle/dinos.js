// dinos.js - your dinosaurs. Friendship levels them, friendship and time evolve them through three forms, and each form changes what they can do:
// on the farm (the work you assign, by priority) and out in the world (what they can carry you over, up or through).
import * as THREE from "three";
import { DINOS, DINO_ROOM, CATALOG, EVOLVE, ITEMS, LEVEL_XP, MAX_LEVEL, SKILLS, WILD, itemName } from "./data.js";
import { makeDinoModel } from "./made.js";
import { groundAt, nearest, pushOut, setGone } from "./world.js";
import { keyOf, ripe, spotOf } from "./farm.js";
import { popup } from "./ui.js";

export const levelOf = (r) => Math.min(MAX_LEVEL, 1 + Math.floor(r.xp / LEVEL_XP));
export const skillsOf = (r) => DINOS[r.species].skills[r.stage];
export const nameOf = (r) => r.name || DINOS[r.species].forms[r.stage];
/** what a dinosaur of this form can do out in the world */
export const can = (r, trait) => { const t = DINOS[r.species].traits[trait]; return t != null && r.stage >= t; };
export const canRide = (r) => r.stage >= DINOS[r.species].ride;
export const roomFor = (s) => DINO_ROOM + (s.placed || []).reduce((n, p) => n + (CATALOG[p.type]?.room || 0), 0);
export function readyToEvolve(s, r) {
  const need = EVOLVE[r.stage + 1];
  return !!need && levelOf(r) >= need.level && s.day - r.born >= need.days;
}
export const evolveNeeds = (s, r) => { const n = EVOLVE[r.stage + 1]; return n ? `Level ${levelOf(r)} of ${n.level}, ${Math.min(n.days, s.day - r.born)} of ${n.days} days together` : "Fully grown"; };
const stepTo = (o, tx, tz, speed, dt, stop = 0.4) => {
  const dx = tx - o.pos.x, dz = tz - o.pos.z, d = Math.hypot(dx, dz);
  if (d <= stop) return false;
  const v = Math.min(speed * dt, d);
  o.pos.x += dx / d * v; o.pos.z += dz / d * v;
  let a = Math.atan2(dx, dz) - o.heading;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  o.heading += a * Math.min(1, dt * 6);
  return true;
};
const PRIO = { high: 3, medium: 2, low: 1 };

export function makeDinos(G) {
  const D = { list: [], wild: [] }, s = G.s;
  let uid = s.dinos.reduce((n, r) => Math.max(n, r.uid), 0);
  const scene = G.scene, taken = new Set();
  const spawn = (r) => {
    const data = DINOS[r.species], c = makeDinoModel(data, r.stage, data.sizes[r.stage]);
    const d = { r, data, char: c, pos: new THREE.Vector3(r.pos[0], 0, r.pos[1]), heading: 2, wander: 0, task: null, stuck: 0, working: 0 };
    d.pos.y = groundAt(G, d.pos.x, d.pos.z).y;
    d.can = (trait) => can(d.r, trait); d.has = (skill) => skillsOf(d.r).includes(skill);
    scene.add(c.holder);
    return d;
  };
  D.list = s.dinos.map(spawn);
  D.of = (uid2) => D.list.find((d) => d.r.uid === uid2);
  D.partner = () => D.of(s.partner);
  D.add = (species, name) => {
    const r = { uid: ++uid, species, name, xp: 0, stage: 0, born: s.day, pos: [G.player.pos.x + 2, G.player.pos.z + 2], jobs: {}, skill: {}, energy: 100, hunger: 100, fedDay: 0, petDay: 0, stay: false };
    s.dinos.push(r);
    (s.met ||= {});
    const d = spawn(r);
    D.list.push(d);
    return d;
  };
  D.friend = (d, amount) => {
    const before = levelOf(d.r);
    d.r.xp += amount;
    const now = levelOf(d.r);
    if (now > before) { popup(`${nameOf(d.r)} reached level ${now}`, "good"); G.sfx("chirp"); G.vfx.burst("heart", d.pos.x, d.pos.y + d.char.top, d.pos.z); }
    if (readyToEvolve(s, d.r) && !d.told) { d.told = true; popup(`${nameOf(d.r)} is ready to evolve!`, "good"); G.moment("evolve_ready"); }
  };

  /** the great moment: a pillar of light, and a new shape */
  D.evolve = (d) => {
    if (!readyToEvolve(s, d.r)) return false;
    const old = d.data.forms[d.r.stage], p = d.pos;
    G.paused = true; G.sfx("evolve");
    let n = 0;
    const flash = setInterval(() => { G.vfx.burst("glow", p.x, p.y + 1 + n * 0.3, p.z); d.char.holder.visible = n % 2 === 0; if (++n > 8) { clearInterval(flash); done(); } }, 170);
    const done = () => {
      scene.remove(d.char.holder);
      d.r.stage++; d.told = false;
      d.char = makeDinoModel(d.data, d.r.stage, d.data.sizes[d.r.stage]);
      scene.add(d.char.holder);
      G.paused = false;
      G.sfx("roar"); G.vfx.burst("gold", p.x, p.y + 2, p.z, 2);
      popup(`${old} evolved into ${d.data.forms[d.r.stage]}!`, "good");
      (s.seenDino ||= {})[`${d.r.species}${d.r.stage}`] = true;
      G.moment("evolve");
      const gained = skillsOf(d.r).filter((k) => !d.data.skills[d.r.stage - 1].includes(k));
      if (gained.length) popup(`New skill: ${gained.map((k) => SKILLS[k]).join(", ")}`, "good");
    };
    return true;
  };

  const food = (d) => {
    const want = d.data.food, bag = Object.keys(s.inv);
    if (want === "fish") return bag.find((k) => ITEMS[k]?.fish);
    if (want === "heartseed_any") return bag.find((k) => ITEMS[k]?.gold) || bag.find((k) => ITEMS[k]?.crop);
    if (s.inv[want]) return want;
    return s.inv.feed ? "feed" : null;
  };
  D.food = food;
  D.feed = (d) => {
    const k = food(d);
    if (!k) return popup(`${nameOf(d.r)} would like ${d.data.food === "fish" ? "a fish" : itemName(d.data.food)}`);
    if (d.r.fedDay === s.day) return popup(`${nameOf(d.r)} is full today`);
    G.add(k, -1); d.r.fedDay = s.day; d.r.hunger = 100; d.r.energy = Math.min(100, d.r.energy + 25); s.flags.fed = true;
    G.sfx("pick"); G.vfx.burst("heart", d.pos.x, d.pos.y + d.char.top, d.pos.z);
    D.friend(d, k === "feed" ? 6 : 14);
    popup(`${nameOf(d.r)} is delighted`, "good");
  };
  D.pet = (d) => {
    G.sfx(d.r.stage ? "grunt" : "chirp"); d.char.work(); G.vfx.burst("heart", d.pos.x, d.pos.y + d.char.top, d.pos.z);
    if (d.r.petDay !== s.day) { d.r.petDay = s.day; D.friend(d, 5); popup(`${nameOf(d.r)} loves that`, "good"); }
  };
  D.menu = (d) => {
    const r = d.r, name = nameOf(r), P = G.player, k = food(d);
    G.moment("dino");
    if (G.talking) return;
    G.sfx(r.stage ? "grunt" : "chirp");
    const opts = [["Pet", () => D.pet(d)], [k ? `Feed ${itemName(k)}` : "Feed (nothing it wants)", () => D.feed(d)]];
    if (readyToEvolve(s, r)) opts.unshift([`✨ Evolve into ${d.data.forms[r.stage + 1]}`, () => D.evolve(d)]);
    if (canRide(r)) opts.push(["Ride", () => G.setRide(d)]);
    opts.push([s.partner === r.uid ? "Stay and work here" : "Come with me", () => { if (s.partner === r.uid) { s.partner = 0; r.stay = true; popup(`${name} will stay here`); } else { s.partner = r.uid; r.stay = false; } }], ["Leave", null]);
    G.talk.say(name, [`Level ${levelOf(r)} ${d.data.forms[r.stage]}. ${r.stage < 2 ? evolveNeeds(s, r) : "Fully grown"}.`], { choose: opts });
  };

  // wild ones: they wander near where they live, and come round to you with a little food
  D.spawnWild = (L) => {
    for (const w of WILD) {
      if (w.land !== L.cfg.id || s.dinos.some((r) => r.species === w.species)) continue;
      const data = DINOS[w.species], c = makeDinoModel(data, 0, data.sizes[0]);
      const [x, z] = L.world(w.x, w.z), a = { w, L, data, char: c, pos: new THREE.Vector3(x, 0, z), heading: 1, wander: 0, trust: s.tamed?.[w.species] || 0, home: [w.x, w.z] };
      a.pos.y = groundAt(G, x, z).y;
      scene.add(c.holder);
      D.wild.push(a);
    }
  };
  D.offer = (a) => {
    const fake = { data: a.data }, k = food(fake);
    if (a.w.after && !s.flags[a.w.after]) return popup("It watches you, and keeps its distance");
    if (!k) return popup(`It sniffs at you. Maybe it would like ${a.data.food === "fish" ? "a fish" : itemName(a.data.food)}`);
    if (s.dinos.length >= roomFor(s)) return popup("No room for another. Build a barn first");
    G.add(k, -1); a.trust++; (s.tamed ||= {})[a.w.species] = a.trust;
    G.sfx("chirp"); G.vfx.burst("heart", a.pos.x, a.pos.y + a.char.top, a.pos.z);
    if (a.trust < a.w.tames) return popup(`It's warming to you (${a.trust} of ${a.w.tames})`);
    scene.remove(a.char.holder);
    D.wild.splice(D.wild.indexOf(a), 1);
    const d = D.add(a.w.species, "");
    d.pos.copy(a.pos); d.r.stay = true;
    G.sfx("fanfare"); G.vfx.burst("gold", a.pos.x, a.pos.y + 1.5, a.pos.z);
    popup(`${a.data.forms[0]} joined your farm!`, "good");
    G.moment("new_dino");
  };

  // ---------------- work: each dinosaur picks its next job by priority, distance and energy ----------------
  const plotsThat = (test) => Object.entries(s.plots).filter(([k, p]) => !taken.has(k) && test(p));
  const JOBS = {
    water: (d) => plotsThat((p) => p.crop && !p.wet && !ripe(p)).map(([k, p]) => plotJob(k, () => { p.wet = true; G.vfx.burst("water", ...spot(k)); G.sfx("water"); })),
    weed: (d) => plotsThat((p) => p.weed).map(([k, p]) => plotJob(k, () => { p.weed = false; G.vfx.burst("leaf", ...spot(k)); })),
    harvest: (d) => plotsThat((p) => ripe(p)).map(([k, p]) => plotJob(k, () => G.reap(k, p, true))),
    plant: (d) => { const seed = G.seedChoice(); if (!seed) return []; return plotsThat((p) => !p.crop).map(([k, p]) => plotJob(k, () => { if (s.inv[seed] > 0 && G.plant(k, p, seed, true)) G.vfx.burst("soil", ...spot(k)); })); },
    chop: (d) => nodeJob(d, "tree", (rec) => { G.add("wood", 2); G.sfx("chop"); G.vfx.burst("wood", ...world(rec)); setGone(G, rec, true); }),
    mine: (d) => nodeJob(d, "rock", (rec) => { G.add(rec.item, 1); G.sfx("tink"); G.vfx.burst("stone", ...world(rec)); setGone(G, rec, true); }),
    scout: (d) => nodeJob(d, "forage", (rec) => { G.add(rec.item, 1); G.vfx.burst("leaf", ...world(rec)); setGone(G, rec, true); }),
    dig: (d) => { const a = Math.random() * 6.3, x = d.pos.x + Math.cos(a) * 8, z = d.pos.z + Math.sin(a) * 8; return groundAt(G, x, z).on === "home" ? [{ x, z, key: `dig${Date.now()}`, run: () => { const got = Math.random() < 0.2 ? "ore" : Math.random() < 0.5 ? "stone" : "fiber"; G.add(got, 1); G.vfx.burst("soil", x, groundAt(G, x, z).y, z, 2); } }] : []; },
    carry: () => G.craft.waiting(),
  };
  const spot = (k) => { const [x, z] = spotOf(k); return [x, G.world.lands.home.land.ground(x, z) + 0.3, z]; };
  const world = (rec) => { const [x, z] = rec.L.world(rec.x, rec.z); return [x, groundAt(G, x, z).y + 1, z]; };
  const plotJob = (k, run) => { const [x, z] = spotOf(k); return { x, z, key: k, run }; };
  const nodeJob = (d, node, run) => {
    const rec = nearest(G, d.pos.x, d.pos.z, 46, (r) => r.node === node && r.L.cfg.id === "home");
    if (!rec) return [];
    const [x, z] = rec.L.world(rec.x, rec.z);
    return [{ x, z, key: rec.key, run: () => run(rec) }];
  };
  const choose = (d) => {
    const r = d.r;
    if (r.energy < 8) return null;
    let best = null, score = -1e9;
    for (const skill of skillsOf(r)) {
      const prio = PRIO[r.jobs[skill]];
      if (!prio) continue;
      for (const job of JOBS[skill](d)) {
        const v = prio * 40 - Math.hypot(job.x - d.pos.x, job.z - d.pos.z);
        if (v > score) { score = v; best = { ...job, skill }; }
      }
    }
    return best;
  };

  const place = (P, k = 3) => { for (let i = 0; i < 8; i++) { const a = i * 0.8 + 3, x = P.pos.x + Math.cos(a) * k, z = P.pos.z + Math.sin(a) * k; if (groundAt(G, x, z).on !== "sea") return [x, z]; } return null; };
  D.tick = (dt, t) => {
    const P = G.player, hour = s.minute / 60, night = hour > 21 || hour < 5.5;
    for (const d of D.list) {
      const r = d.r, rode = P.riding === d, follow = s.partner === r.uid && !rode, c = d.char;
      if (rode) { d.pos.copy(P.pos); d.heading = P.heading; c.move(dt, t, P.movingNow, true, P.mode); c.holder.position.copy(d.pos); c.holder.rotation.y = d.heading; continue; }
      c.holder.visible = !(P.sailing && follow);
      if (P.sailing && follow) continue;
      if (P.pos.distanceTo(d.pos) > 260 && !follow) { c.holder.visible = false; continue; }             // far off: no need to walk about
      c.holder.visible = true;
      let moving = false;
      const from = [d.pos.x, d.pos.z];
      if (follow) {
        const dist = d.pos.distanceTo(P.pos);
        if (dist > 40 || (dist > 14 && d.stuck > 2)) { const at = place(P); if (at) { d.pos.x = at[0]; d.pos.z = at[1]; d.stuck = 0; } }
        else moving = stepTo(d, P.pos.x, P.pos.z, dist > 14 ? r.stage ? 11 : 9 : 4.5, dt, 3 + r.stage);
      } else if (night) {
        if (t > d.wander) { d.wander = t + 4; G.vfx.burst("zzz", d.pos.x, d.pos.y + c.top, d.pos.z); }
        r.energy = Math.min(100, r.energy + dt * 2);
      } else if (d.task) {
        moving = stepTo(d, d.task.x, d.task.z, 3 + r.stage, dt, 1.2 + r.stage * 0.5);
        if (!moving) {
          d.working += dt;
          if (d.working === dt) c.work();
          if (d.working > 1.2) {
            d.task.run();
            taken.delete(d.task.key);
            const sk = r.skill[d.task.skill] = (r.skill[d.task.skill] || 0) + 1;
            r.energy -= Math.max(1.5, 4 - sk * 0.02);
            D.friend(d, 0.3);
            G.farm.dirty = true; G.farm.draw();
            d.task = null; d.working = 0; d.wander = t + 0.6;
          }
        } else if (t > (d.gaveUp || 1e12)) { taken.delete(d.task.key); d.task = null; }
      } else if (t > d.wander) {
        d.wander = t + 1.2 + Math.random();
        const job = choose(d);
        if (job) { d.task = job; taken.add(job.key); d.gaveUp = t + 40; d.goal = null; }
        else if (Math.random() < 0.4) d.goal = [d.pos.x + (Math.random() - 0.5) * 10, d.pos.z + (Math.random() - 0.5) * 10];
      } else if (d.goal) moving = stepTo(d, d.goal[0], d.goal[1], 2, dt);
      pushOut(G, d.pos, 0.7 + r.stage * 0.2);
      const g = groundAt(G, d.pos.x, d.pos.z);
      const swims = can(r, "swim"), rises = (g.y - groundAt(G, from[0], from[1]).y) / Math.max(0.001, Math.hypot(d.pos.x - from[0], d.pos.z - from[1]));
      if ((g.on === "sea" && !swims) || (rises > 1.2 && !can(r, "climb"))) { d.pos.x = from[0]; d.pos.z = from[1]; d.stuck += dt; d.goal = null; if (d.task && d.stuck > 3) { taken.delete(d.task.key); d.task = null; d.stuck = 0; } }
      else if (moving) d.stuck = 0;
      const now = groundAt(G, d.pos.x, d.pos.z);
      d.pos.y = THREE.MathUtils.lerp(d.pos.y, now.on === "sea" ? 0 : now.y, Math.min(1, dt * 8));
      r.pos = [d.pos.x, d.pos.z];
      c.move(dt, t, moving, false, now.on === "sea" ? "swim" : "");
      c.holder.position.copy(d.pos);
      c.holder.rotation.y = d.heading;
    }
    for (const a of D.wild) {
      const near = a.L.dist(P.pos.x, P.pos.z) < a.L.cfg.a + 200;
      a.char.holder.visible = near;
      if (!near) continue;
      if (t > a.wander) { a.wander = t + 3 + Math.random() * 5; const [x, z] = a.L.world(a.home[0] + (Math.random() - 0.5) * 10, a.home[1] + (Math.random() - 0.5) * 10); a.goal = [x, z]; }
      const moving = a.goal ? stepTo(a, a.goal[0], a.goal[1], 1.6, dt) : false;
      a.pos.y = groundAt(G, a.pos.x, a.pos.z).y;
      a.char.move(dt, t, moving, false);
      a.char.holder.position.copy(a.pos); a.char.holder.rotation.y = a.heading;
    }
  };
  /** the dawn of a new day */
  D.newDay = () => {
    const troughs = (s.placed || []).some((p) => CATALOG[p.type]?.use === "trough");
    for (const d of D.list) {
      d.r.energy = 100; d.r.hunger = Math.max(0, d.r.hunger - 20);
      if (troughs && s.inv.feed > 0 && d.r.fedDay !== s.day) { G.add("feed", -1); d.r.hunger = 100; D.friend(d, 3); }
      D.friend(d, 1.5);                                       // a day spent together always counts
    }
  };
  return D;
}
export { keyOf };
