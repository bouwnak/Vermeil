// dinos.js - your dinosaurs. Friendship levels them, friendship and time evolve them through three forms, and each form changes what they can do:
// on the farm (the work you assign, by priority) and out in the world (what they can carry you over, up or through).
import * as THREE from "three";
import { rollLook, DINOS, CATALOG, EVOLVE, FARM_SKILLS, ITEMS, JOB_SLOTS, LEVEL_XP, MAX_LEVEL, SKILLS, UNLOCK, UNLOCK_TEXT, WILD_TAME, itemName, perkOf } from "./data.js";
import { makeDinoBody } from "./dinomodel.js";
import { groundAt, isWet, nearest, pushOut, shoreNear } from "./world.js";
import { keyOf, ripe, spotOf } from "./farm.js";
import { popup } from "./ui.js";
import { dinoVoice } from "./audio.js";
import { sandy, seaKind, seaSpot } from "./life.js";

export const levelOf = (r) => Math.min(MAX_LEVEL, 1 + Math.floor(r.xp / LEVEL_XP));
export const skillsOf = (r) => DINOS[r.species].skills[r.stage];
export const nameOf = (r) => r.name || DINOS[r.species].forms[r.stage];
/** what a dinosaur of this form can do out in the world: a trait it has grown into, or a skill it has now */
export const can = (r, trait) => { const t = DINOS[r.species].traits[trait]; return (t != null && r.stage >= t) || skillsOf(r).includes(trait); };
export const canRide = (r) => r.stage >= DINOS[r.species].ride;
/** there's no limit to how many friends you keep. (Barns used to set one; they're still good shelter) */
export const roomFor = () => Infinity;
/** the dinosaurs working a farm job, in the order they were given it: only the first JOB_SLOTS of them actually do it */
export const crewOf = (s, skill) => (s.dinos || []).filter((r) => r.jobs?.[skill] && skillsOf(r).includes(skill)).slice(0, JOB_SLOTS);
export const onCrew = (s, r, skill) => crewOf(s, skill).includes(r);
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

/** [name, what it means for how it spends its time: how often it chats, digs, sniffs, naps] */
export const PERSONALITY = [["Cheerful", { chat: 2, dig: 1, sniff: 1, nap: 0.5 }], ["Shy", { chat: 0.4, dig: 0.6, sniff: 1.4, nap: 1 }], ["Lazy", { chat: 0.6, dig: 0.4, sniff: 0.6, nap: 2.5 }],
  ["Curious", { chat: 1, dig: 1.6, sniff: 2.4, nap: 0.5 }], ["Brave", { chat: 1.2, dig: 1, sniff: 1, nap: 0.6 }], ["Grumpy", { chat: 0.5, dig: 1.2, sniff: 0.8, nap: 1.4 }],
  ["Playful", { chat: 1.8, dig: 1.4, sniff: 1, nap: 0.4 }], ["Gentle", { chat: 1, dig: 0.8, sniff: 1.2, nap: 1 }]];
const habits = (r) => (PERSONALITY.find((p) => p[0] === r.personality) || PERSONALITY[0])[1];

export async function makeDinos(G) {
  const D = { list: [], wild: [] }, s = G.s;
  let uid = s.dinos.reduce((n, r) => Math.max(n, r.uid), 0);
  const scene = G.scene, taken = new Set();
  const spawn = async (r) => {
    const data = DINOS[r.species], c = await makeDinoBody(data, r.stage, data.sizes[r.stage], r.look);
    const d = { r, data, char: c, pos: new THREE.Vector3(r.pos[0], 0, r.pos[1]), heading: 2, wander: 0, task: null, stuck: 0, working: 0 };
    d.sea = seaKind(data);
    if (d.sea && !sandy(groundAt(G, d.pos.x, d.pos.z))) { const at = shoreNear(G, d.pos.x, d.pos.z, 300); if (at) { d.pos.x = at[0]; d.pos.z = at[1]; } }      // a sea creature lives on the beach and in the water
    d.pos.y = groundAt(G, d.pos.x, d.pos.z).y;
    d.can = (trait) => can(d.r, trait); d.has = (skill) => skillsOf(d.r).includes(skill);
    c.addSaddle?.();                                             // yours: it wears your saddle
    // every one is its own animal: a personality of its own, picked once, and a voice of its own pitch
    r.personality ||= PERSONALITY[(r.uid * 7 + Math.floor(Math.random() * 100)) % PERSONALITY.length][0];
    d.voice = 0.85 + ((r.uid * 37) % 30) / 100;
    d.say = (mood) => dinoVoice(data.sizes[r.stage], mood, d.voice);
    scene.add(c.holder);
    return d;
  };
  D.list = await Promise.all(s.dinos.map(spawn));
  D.of = (uid2) => D.list.find((d) => d.r.uid === uid2);
  D.partner = () => D.of(s.partner);
  D.add = async (species, name, look = null) => {
    const r = { uid: ++uid, species, name, xp: 0, stage: 0, born: s.day, pos: [G.player.pos.x + 2, G.player.pos.z + 2], jobs: {}, skill: {}, energy: 100, hunger: 100, fedDay: 0, petDay: 0, stay: false, look: look || rollLook(species) };      // it keeps the look it was born with
    s.dinos.push(r);
    (s.met ||= {});
    const d = await spawn(r);
    D.list.push(d);
    return d;
  };
  D.friend = (d, amount) => {
    const before = levelOf(d.r);
    d.r.xp += amount * (1 + 0.4 * perkOf(d.data, "gentle"));
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
    const done = async () => {
      scene.remove(d.char.holder);
      d.r.stage++; d.told = false;
      d.char = await makeDinoBody(d.data, d.r.stage, d.data.sizes[d.r.stage], d.r.look); d.char.addSaddle?.();
      scene.add(d.char.holder);
      G.paused = false;
      G.sfx("roar"); G.vfx.burst("gold", p.x, p.y + 2, p.z, 2); d.char.react("roar");
      popup(`${old} evolved into ${d.data.forms[d.r.stage]}!`, "good");
      (s.seenDino ||= {})[`${d.r.species}${d.r.stage}`] = true;
      G.moment("evolve");
      const gained = skillsOf(d.r).filter((k) => !d.data.skills[d.r.stage - 1].includes(k));
      if (gained.length) popup(`New skill: ${gained.map((k) => SKILLS[k]).join(", ")}`, "good");
    };
    return true;
  };

  /** the test button: straight to the next form, with no waiting */
  D.levelNext = async () => { for (const d of D.list) { if (d.r.stage >= 2) continue; const n = EVOLVE[d.r.stage + 1]; d.r.xp = Math.max(d.r.xp, (n.level - 1) * LEVEL_XP); d.r.born = Math.min(d.r.born, s.day - n.days); scene.remove(d.char.holder); d.r.stage++; d.char = await makeDinoBody(d.data, d.r.stage, d.data.sizes[d.r.stage], d.r.look); d.char.addSaddle?.(); scene.add(d.char.holder); G.vfx.burst("glow", d.pos.x, d.pos.y + 1, d.pos.z); } G.sfx("evolve"); };
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
    G.add(k, -1); d.r.fedDay = s.day; d.say("happy"); d.r.hunger = 100; d.r.energy = Math.min(100, d.r.energy + 25); s.flags.fed = true;
    G.sfx("pick"); G.vfx.burst("heart", d.pos.x, d.pos.y + d.char.top, d.pos.z); d.char.react("eat"); G.player.act("use");
    D.friend(d, k === "feed" ? 6 : 14);
    popup(`${nameOf(d.r)} is delighted`, "good");
  };
  // touching: each is its own moment, for you and for it. Friendship counts once a day each
  const TOUCH = { pet: ["pet", "loves that"], chin: ["chin", "closes its eyes"], belly: ["belly", "rolls over, feet in the air"], play: ["play", "bounces around you"] };
  D.touch = (d, kind) => {
    const [act, line] = TOUCH[kind], r = d.r, y = d.pos.y + (kind === "belly" ? 0.8 : d.char.top * 0.8);
    G.player.act(kind === "play" ? "wave" : "use");
    d.char.react(act);
    d.say("happy"); G.vfx.burst("heart", d.pos.x, y, d.pos.z, kind === "belly" ? 2 : 1);
    if ((r.touched ||= {})[kind] !== s.day) { r.touched[kind] = s.day; D.friend(d, kind === "belly" ? 4 : 3); popup(`${nameOf(r)} ${line}`, "good"); }
  };
  D.pet = (d) => D.touch(d, "pet");
  D.menu = (d) => {
    const r = d.r, name = nameOf(r), P = G.player, k = food(d);
    G.moment("dino");
    if (G.talking) return;
    d.say("call");
    const opts = [["Pet", () => D.touch(d, "pet")], ["Chin scratch", () => D.touch(d, "chin")], ["Belly rub", () => D.touch(d, "belly")], ["Play", () => D.touch(d, "play")], [k ? `Feed ${itemName(k)}` : "Feed (nothing it wants)", () => D.feed(d)]];
    if (s.inv.thornberry > 0) opts.push(["Give a Thornheart Berry 💗", () => { G.add("thornberry", -1); d.say("happy"); d.char.react("eat"); G.sfx("rare"); G.vfx.burst("heart", d.pos.x, d.pos.y + d.char.top, d.pos.z, 3); D.friend(d, 42); d.r.energy = 100; popup(`${name} adores it`, "good"); }]);
    if (readyToEvolve(s, r)) opts.unshift([`✨ Evolve into ${d.data.forms[r.stage + 1]}`, () => D.evolve(d)]);
    if (canRide(r)) opts.push(["Ride", () => G.setRide(d)]);
    opts.push([s.partner === r.uid ? "Stay and work here" : "Come with me", () => { if (s.partner === r.uid) { s.partner = 0; r.stay = true; popup(`${name} will stay here`); } else { s.partner = r.uid; r.stay = false; } }], ["Leave", null]);
    G.talkingTo = d;
    G.talk.say(name, [`Level ${levelOf(r)} ${r.look ? `${r.look.tier} ${r.look.pattern.toLowerCase()} ` : ""}${d.data.forms[r.stage]}, ${r.personality.toLowerCase()} by nature. ${r.stage < 2 ? evolveNeeds(s, r) : "Fully grown"}.`], { choose: opts });
  };

  // wild ones roam every turtle. Once their kind is unlocked, a little food brings one round, and it goes straight to your own island
  D.offer = async (w) => {
    const need = UNLOCK[w.species];
    if (need && !s.flags[need]) return popup(`It watches you warily. It might trust you ${UNLOCK_TEXT[need]}`);
    const k = food({ data: w.data });
    if (!k) return popup(`It sniffs at you. Maybe it would like ${w.data.food === "fish" ? "a fish" : itemName(w.data.food)}`);
    G.add(k, -1); w.trust++;
    G.sfx("chirp"); G.vfx.burst("heart", w.pos.x, w.pos.y + w.char.top, w.pos.z); w.char.react("eat"); G.player.act("use");
    if (w.trust < WILD_TAME) return popup(`It's warming to you (${w.trust} of ${WILD_TAME})`);
    scene.remove(w.char.holder);
    G.life.herd.splice(G.life.herd.indexOf(w), 1);
    G.vfx.burst("glow", w.pos.x, w.pos.y + 1, w.pos.z);
    const d = await D.add(w.species, "", w.look), barn = (G.build.of("barn")[0] || G.build.of("house")[0])?.p || { x: 40, z: 0 }, a = Math.random() * 6.3, x = barn.x + Math.cos(a) * 16, z = barn.z + Math.sin(a) * 16;
    d.r.stage = 0; d.r.stay = true; d.pos.set(x, groundAt(G, x, z).y, z); d.r.pos = [x, z];                // tamed: it's on your turtle now
    G.sfx("fanfare");
    popup(`${w.data.forms[0]} joined you, and has gone to your island!`, "good");
    G.moment(w.data.travel ? "travel" : "new_dino");
  };

  // ---------------- work: each dinosaur picks its next job by priority, distance and energy ----------------
  // only farm work, and only for the three on that job's crew. Chopping, smashing, digging and sniffing happen with you riding (ridework.js, rare.js)
  const plotsThat = (test) => Object.entries(s.plots).filter(([k, p]) => !taken.has(k) && test(p));
  const tend = (d, p) => { const g = perkOf(d.data, "green"); if (g) p.care = (p.care || 0) + g * 3; };          // a green thumb: what it tends is likelier to come up golden
  /** fresh soil beside the field: a tiller keeps a few empty plots ready, never more */
  const tillSpots = () => {
    const empty = Object.values(s.plots).filter((p) => !p.crop).length;
    if (empty >= 6) return [];
    const out = [];
    for (const k of Object.keys(s.plots)) { const [x, z] = spotOf(k); for (const [a, b] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const q = keyOf(x + a, z + b); if (!s.plots[q] && !taken.has(q) && G.farm.canTill(x + a, z + b)) out.push(q); } if (out.length > 12) break; }
    return out;
  };
  const JOBS = {
    water: (d) => plotsThat((p) => p.crop && !p.wet && !ripe(p)).map(([k, p]) => plotJob(k, () => { p.wet = true; tend(d, p); G.vfx.burst("water", ...spot(k)); G.sfx("water"); })),
    weed: (d) => plotsThat((p) => p.weed).map(([k, p]) => plotJob(k, () => { p.weed = false; tend(d, p); G.vfx.burst("leaf", ...spot(k)); })),
    harvest: (d) => plotsThat((p) => ripe(p)).map(([k, p]) => plotJob(k, () => G.reap(k, p, true))),
    plant: (d) => { const seed = G.seedChoice(); if (!seed) return []; return plotsThat((p) => !p.crop).map(([k, p]) => plotJob(k, () => { if (s.inv[seed] > 0 && G.plant(k, p, seed, true)) { tend(d, p); G.vfx.burst("soil", ...spot(k)); } })); },
    till: (d) => tillSpots().map((k) => plotJob(k, () => { const [x, z] = spotOf(k); if (!s.plots[k] && G.farm.canTill(x, z)) { s.plots[k] = { crop: null, age: 0, wet: isWet(s.weather) }; G.vfx.burst("soil", ...spot(k)); G.sfx("dig"); } })),
    carry: () => G.craft.waiting(),
  };
  const spot = (k) => { const [x, z] = spotOf(k); return [x, G.world.lands.home.land.ground(x, z) + 0.3, z]; };
  const plotJob = (k, run) => { const [x, z] = spotOf(k); return { x, z, key: k, run }; };
  const choose = (d) => {
    const r = d.r;
    if (r.energy < 8) return null;
    let best = null, score = -1e9;
    for (const skill of skillsOf(r)) {
      const prio = PRIO[r.jobs[skill]];
      if (!prio || !JOBS[skill] || !FARM_SKILLS.includes(skill) || !onCrew(s, r, skill)) continue;
      if (r.personality === "Lazy" && Math.random() < 0.15) continue;           // a lazy one sometimes just... doesn't
      for (const job of JOBS[skill](d)) {
        const v = prio * 40 - Math.hypot(job.x - d.pos.x, job.z - d.pos.z);
        if (v > score) { score = v; best = { ...job, skill }; }
      }
    }
    return best;
  };

  /** nothing to do: a dinosaur wanders, goes down to the sea for a drink, or rests. One given a pen stays in it */
  const idle = (d, t) => {
    const pen = d.r.pen && G.build.things.get(d.r.pen), roll = Math.random();
    d.then = null; d.goalBy = t + 18;
    if (pen) { d.goal = [pen.p.x + (Math.random() - 0.5) * 13, pen.p.z + (Math.random() - 0.5) * 13]; return; }
    if (d.r.pen) d.r.pen = 0;
    if (d.sea) { d.goal = seaSpot(G, d.pos.x, d.pos.z, 30); if (!d.goal) d.wander = t + 3; return; }
    // its own habits, by its nature: a dig for something buried, a long sniff along the ground, a nap, or just a chatter to itself
    const h = habits(d.r), pick = Math.random() * 6;
    if (pick < h.dig * 0.5) { d.wander = t + 3.2; d.char.react("eat"); d.say("dig"); for (let i = 0; i < 6; i++) setTimeout(() => G.vfx.burst("soil", d.pos.x + Math.sin(d.heading) * d.char.seat * 0.6, d.pos.y + 0.2, d.pos.z + Math.cos(d.heading) * d.char.seat * 0.6, 0.5), i * 420); return; }
    if (pick < (h.dig + h.sniff) * 0.5) { d.wander = t + 2.5; d.char.react("sniff"); d.say("sniff"); return; }
    if (pick < (h.dig + h.sniff + h.nap) * 0.5) { d.wander = t + 6; d.say("yawn"); G.vfx.burst("zzz", d.pos.x, d.pos.y + d.char.top, d.pos.z); return; }
    if (pick < (h.dig + h.sniff + h.nap + h.chat) * 0.5) d.say(Math.random() < 0.5 ? "happy" : "call");
    if (roll < 0.24) { const sea = shoreNear(G, d.pos.x, d.pos.z); if (sea) { d.goal = sea; d.then = "drink"; d.faces = sea[2]; d.goalBy = t + 40; return; } }
    if (roll < 0.82) {                                         // never far from home for long: each stroll leans back toward the farm
      const barn = (G.build.of("barn")[0] || G.build.of("house")[0])?.p || { x: 40, z: 0 }, off = Math.hypot(d.pos.x - barn.x, d.pos.z - barn.z), a = off > 60 ? Math.atan2(barn.z - d.pos.z, barn.x - d.pos.x) + (Math.random() - 0.5) : Math.random() * 6.3, k = 7 + Math.random() * 20;
      d.goal = [d.pos.x + Math.cos(a) * k, d.pos.z + Math.sin(a) * k]; return;
    }
    d.wander = t + 3 + Math.random() * 6;
  };
  const place = (P, k = 3) => { for (let i = 0; i < 8; i++) { const a = i * 0.8 + 3, x = P.pos.x + Math.cos(a) * k, z = P.pos.z + Math.sin(a) * k; const g = groundAt(G, x, z); if (P.sea ? sandy(g) : g.on !== "sea") return [x, z]; } return null; };
  D.tick = (dt, t) => {
    const P = G.player, hour = s.minute / 60, night = hour > 21 || hour < 5.5;
    for (const d of D.list) {
      const r = d.r, rode = P.riding === d, follow = s.partner === r.uid && !rode, c = d.char;
      if (rode) { d.pos.copy(P.pos); d.heading = P.heading; c.lookAt = null; c.move(dt, t, P.movingNow, true, P.mode); c.holder.position.copy(d.pos); c.holder.rotation.y = d.heading; c.holder.updateMatrixWorld(true); c.reinsTo?.(P.hands); continue; }
      c.holder.visible = !(P.sailing && follow);
      if (P.sailing && follow) continue;
      if (P.pos.distanceTo(d.pos) > 260 && !follow) { c.holder.visible = false; continue; }             // far off: no need to walk about
      c.holder.visible = true;
      c.lookAt = P.pos.distanceTo(d.pos) < 12 ? P.pos : null;
      if (c.held?.() || G.talkingTo === d) { if (G.talkingTo === d) { let a = Math.atan2(P.pos.x - d.pos.x, P.pos.z - d.pos.z) - d.heading; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; d.heading += a * Math.min(1, dt * 5); } c.move(dt, t, false, false, ""); c.holder.position.copy(d.pos); c.holder.rotation.y = d.heading; c.holder.updateMatrixWorld(true); c.reinsTo?.(null); continue; }       // it stays put while you're with it
      let moving = false;
      const from = [d.pos.x, d.pos.z];
      if (follow) {
        const dist = d.pos.distanceTo(P.pos);
        if (dist > 40 || (dist > 14 && d.stuck > 2)) { const at = place(d.sea ? { pos: P.pos, sea: true } : P); if (at) { d.pos.x = at[0]; d.pos.z = at[1]; d.stuck = 0; } }
        else moving = stepTo(d, P.pos.x, P.pos.z, dist > 14 ? r.stage ? 11 : 9 : 4.5, dt, 3 + r.stage);
      } else if (night) {
        if (t > d.wander) { d.wander = t + 4; G.vfx.burst("zzz", d.pos.x, d.pos.y + c.top, d.pos.z); }
        r.energy = Math.min(100, r.energy + dt * 2);
      } else if (d.task) {
        moving = stepTo(d, d.task.x, d.task.z, 3 + r.stage, dt, 1.2 + r.stage * 0.5);
        if (!moving) {
          d.working += dt;
          if (d.working === dt) c.work();
          if (d.working > 1.2 * (1 - 0.25 * perkOf(d.data, "quick"))) {
            d.task.run();
            taken.delete(d.task.key);
            const sk = r.skill[d.task.skill] = (r.skill[d.task.skill] || 0) + 1;
            r.energy -= Math.max(1.5, 4 - sk * 0.02) * (1 - 0.3 * perkOf(d.data, "tireless"));
            D.friend(d, 0.3);
            G.farm.dirty = true; G.farm.draw();
            d.task = null; d.working = 0; d.wander = t + 0.6;
          }
        } else if (t > (d.gaveUp || 1e12)) { taken.delete(d.task.key); d.task = null; }
      } else if (d.goal) {
        moving = stepTo(d, d.goal[0], d.goal[1], 2.4 + r.stage * 0.5, dt, 0.8);
        if (!moving || t > d.goalBy) {
          if (!moving && d.then === "drink") { d.heading = d.faces; c.drink?.(5); d.wander = t + 5.2; }
          else d.wander = t + 0.8 + Math.random() * 2;
          d.goal = null; d.then = null;
        }
      } else if (t > d.wander) {
        d.wander = t + 1.2 + Math.random();
        const job = choose(d);
        if (job) { d.task = job; taken.add(job.key); d.gaveUp = t + 40; d.goal = null; }
        else idle(d, t);
      }
      pushOut(G, d.pos, 0.7 + r.stage * 0.2);
      const g = groundAt(G, d.pos.x, d.pos.z);
      const swims = can(r, "swim"), rises = (g.y - groundAt(G, from[0], from[1]).y) / Math.max(0.001, Math.hypot(d.pos.x - from[0], d.pos.z - from[1]));
      if ((g.on === "sea" && !swims) || (d.sea && !sandy(g)) || (rises > 1.2 && !can(r, "climb") && g.on !== "sea")) { d.pos.x = from[0]; d.pos.z = from[1]; d.stuck += dt; d.goal = null; d.then = null; if (d.task && d.stuck > 3) { taken.delete(d.task.key); d.task = null; d.stuck = 0; } }
      else if (moving) d.stuck = 0;
      const now = groundAt(G, d.pos.x, d.pos.z);
      d.pos.y = THREE.MathUtils.lerp(d.pos.y, now.on === "sea" ? 0 : now.y, Math.min(1, dt * 8));
      r.pos = [d.pos.x, d.pos.z];
      c.move(dt, t, moving, false, now.on === "sea" ? "swim" : "");
      c.holder.position.copy(d.pos);
      c.holder.rotation.y = d.heading;
      if (c.reinsTo && P.pos.distanceTo(d.pos) < 60) { c.holder.updateMatrixWorld(true); c.reinsTo(null); }        // reins looped over the saddle horn
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
