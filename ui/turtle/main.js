// main.js - Turtle Island: wakes every system up, and holds the rules that join them (tools, what E does, fishing, the turn of the day, saving).
import * as THREE from "three";
import { BRIDGE, COMPANION, CROPS, DINOS, FISH, ISLANDS, ITEMS, NPCS, SECONDS_PER_MINUTE, TOOLS, TOOL_UP, TIERS, itemName } from "./data.js";
import { SHORE, buildWorld, groundAt, isWet, nearest, pickWeather, regrow, seasonOf, setGone, tickWorld } from "./world.js";
import { KEYS, makeInput, makePlayer, tickPlayer } from "./player.js";
import { keyOf, makeFarm, ripe, spotOf } from "./farm.js";
import { makeAnimals, makeCompanion, makeCourier, makePeople, makeSchool, makeTackle } from "./creatures.js";
import { canRide, makeDinos } from "./dinos.js";
import { makeBook, makeCreator, makeHud, makeShop, makeTalk, popup } from "./ui.js";
import { missing } from "./assets.js";
import { play, setLevels, setNight, setScene, startAudio } from "./audio.js";
import { makeVfx } from "./vfx.js";
import { makeBridge } from "./bridge.js";
import { makeBuild } from "./build.js";
import { makeCraft } from "./craft.js";
import { makeSail } from "./sail.js";
import { makeLore } from "./quests.js";

const $ = (id) => document.getElementById(id);
const fresh = () => ({ version: 2, name: "", body: "male", skin: "Farmer", day: 1, minute: 6.5 * 60, money: 120, weather: "sunny", pos: [18, 2], rod: 1, tools: {},
  inv: { carrot_seed: 8, lettuce_seed: 4 }, plots: {}, flags: {}, said: {}, seen: {}, fish: {}, met: {}, seenIsles: {}, opts: {}, bin: {}, cut: {}, turtles: {}, machines: {}, carved: {}, found: {}, orders: {},
  dinos: [{ uid: 1, species: "sprig", name: "Sprig", xp: 0, stage: 0, born: 1, pos: [12, 8], jobs: {}, skill: {}, energy: 100, hunger: 100, fedDay: 0, petDay: 0, stay: false }], partner: 1 });
/** an older save still works: its dinosaur comes along, the rest arrives */
function upgrade(raw) {
  const s = { ...fresh(), ...raw };
  if (raw.version < 2) {
    const d = raw.dino || {};
    s.dinos[0] = { ...s.dinos[0], name: d.name || "Sprig", xp: (d.friend || 0) * 2, pos: d.pos || [12, 8] };
    if (raw.flags?.fed) s.flags.fed = true;
    if (raw.flags?.smashed) { s.flags.boulder = true; s.carved.c1 = true; }
    delete s.dino;
    s.version = 2;
  }
  return s;
}
const storage = {
  async load() {
    let raw = null;
    try { const api = await pywebviewApi(); if (api?.turtle_load) raw = await api.turtle_load(); } catch (e) { console.warn(e); }
    try { raw ||= JSON.parse(localStorage.getItem("turtle.save") || "null"); } catch { /* not this time */ }
    return raw?.version ? upgrade(raw) : null;
  },
  async save(s) {
    try { localStorage.setItem("turtle.save", JSON.stringify(s)); } catch { /* the app's copy still works */ }
    try { const api = await pywebviewApi(); if (api?.turtle_save) return await api.turtle_save(s); } catch (e) { console.warn(e); }
    return { ok: true };
  },
};
function pywebviewApi() {
  return new Promise((done) => { if (window.pywebview?.api) return done(window.pywebview.api); addEventListener("pywebviewready", () => done(window.pywebview.api), { once: true }); setTimeout(() => done(null), 700); });
}

const G = { s: fresh(), paused: true, talking: false, cinema: true, tool: TOOLS[1], cheat: {} };
window.G = G;
G.add = (id, n) => { G.s.inv[id] = (G.s.inv[id] || 0) + n; if (G.s.inv[id] <= 0) delete G.s.inv[id]; if (n > 0) G.s.seen[id] = true; };
G.sfx = play;
G.save = async () => { const P = G.player; G.s.pos = [P.pos.x, P.pos.z]; if (P.ground?.on === "sea" || G.s.pos.some(Number.isNaN)) G.s.pos = [18, 2]; const r = await storage.save(G.s); if (r?.error) popup(r.error); return r; };
G.seedChoice = () => { const k = Object.keys(G.s.inv).filter((i) => ITEMS[i]?.seed); return k.includes(G.seedPick) ? G.seedPick : k[0]; };
G.pickTool = (i) => { G.tool = TOOLS[i]; };
G.fade = fade;
G.nearSolid = (x, z, pad) => !!nearest(G, x, z, pad, (r) => r.r && r.L.cfg.id === "home");

/** what she says at a moment of the game. Rare ones wait their turn; big ones only ever come once. */
G.moment = (key) => {
  const m = COMPANION.moments[key], s = G.s;
  if (!m || G.talking || G.cinema || G.building) return;
  const t = performance.now() / 1000;
  if (m.once && s.said[key]) return;
  if (m.cool && G.lastSaid?.[key] && t - G.lastSaid[key] < m.cool) return;
  (G.lastSaid ||= {})[key] = t;
  s.said[key] = true;
  G.companion?.char.once?.("wave");
  G.talk.say(COMPANION.name, m.lines);
};
/** can you, right now, get at something that needs this talent? */
G.canReach = (need) => !!(G.player.riding?.can(need) || G.dinos.list.some((d) => d.can(need) && d.pos.distanceTo(G.player.pos) < 14));

const spotY = (x, z) => G.world.lands.home.land.ground(x, z);
function spend(n) { if (!G.cheat.stamina) G.player.stamina = Math.max(0, G.player.stamina - n); }

G.plant = (k, plot, seed, quiet) => {
  const c = ITEMS[seed].seed, s = G.s, [x, z] = spotOf(k), under = G.farm.inGreenhouse(x, z);
  if (!CROPS[c].seasons.includes(seasonOf(s.day).index) && !under) { if (!quiet) popup(`${CROPS[c].name} won't grow this season`); return false; }
  plot.crop = c; plot.age = 0; plot.care = 0; G.add(seed, -1); s.flags.planted = true; G.farm.dirty = true;
  return true;
};
/** a crop comes in: yours by hand, or a dinosaur's work */
G.reap = (k, plot, quiet) => {
  const c = CROPS[plot.crop], s = G.s, id = plot.crop, [x, z] = spotOf(k), y = spotY(x, z);
  if (!ripe(plot)) return false;
  const lucky = !c.story && Math.random() < 0.02 + (plot.fert ? 0.05 : 0) + Math.min(0.08, (plot.care || 0) * 0.008), amount = c.yield + (plot.fert ? 1 : 0), got = lucky ? `${id}_gold` : id;
  G.add(got, amount); s.seen[id] = true; s.flags.harvested = true; (s.grown ||= {})[id] = (s.grown[id] || 0) + amount; s.flags.reaped = (s.flags.reaped || 0) + 1;
  if (id === "heartseed") s.flags.bloomed = true;
  G.vfx.burst(lucky ? "gold" : "leaf", x, y + 0.6, z); G.vfx.item(`+${amount} ${ITEMS[got].icon}`, x, y + 1.4, z);
  if (lucky) { play("rare"); popup(`A rare golden ${c.name}!`, "good"); G.moment("rare"); } else play("pick");
  if (c.regrow) { plot.age = c.days - c.regrow; } else { plot.crop = null; plot.age = 0; plot.fert = false; }
  G.farm.draw();
  if (!quiet) { popup(`+${amount} ${ITEMS[got].name}`, "good"); G.moment(id === "heartseed" ? "rare" : "first_harvest"); if (s.flags.reaped % 40 === 0) G.moment("big_harvest"); }
  return true;
};

function useTool() {
  const P = G.player, F = G.farm, s = G.s, tool = G.tool.id;
  if (P.riding || P.sailing || P.busy) return;
  if (tool === "rod") return startFishing();
  if (tool === "axe") return hew("tree");
  if (tool === "pick") return hew("rock");
  const t = F.target(), k = keyOf(t.x, t.z), plot = s.plots[k];
  if (tool === "hand") { if (ripe(plot || {})) { P.act("use", () => G.reap(k, plot)); } else if (plot?.crop) { const c = CROPS[plot.crop], n = c.days - plot.age; popup(`${c.name}: ${n} more day${n > 1 ? "s" : ""}${plot.wet ? "" : ", and it needs water"}`); } return; }
  if (tool === "hoe") {
    const cells = F.reach("hoe").filter((c) => { const p = s.plots[keyOf(c.x, c.z)]; return p ? p.weed : F.canTill(c.x, c.z); });
    if (!cells.length) { if (!plot) { popup(F.why(t.x, t.z) || "Nothing to dig"); play("deny"); } return; }
    spend(0.6 * cells.length);
    P.act("swing", () => {
      for (const c of cells) {
        const q = keyOf(c.x, c.z);
        if (s.plots[q]) s.plots[q].weed = false; else s.plots[q] = { crop: null, age: 0, wet: isWet(s.weather) };
        G.vfx.burst("soil", c.x, spotY(c.x, c.z) + 0.2, c.z);
      }
      play("dig"); F.draw(); G.moment("first_till");
    });
  } else if (tool === "can") {
    const cells = F.reach("can").filter((c) => { const p = s.plots[keyOf(c.x, c.z)]; return p && !p.wet; });
    if (!cells.length) return;
    spend(0.4 * cells.length);
    P.act("use", () => { for (const c of cells) { s.plots[keyOf(c.x, c.z)].wet = true; G.vfx.burst("water", c.x, spotY(c.x, c.z) + 0.8, c.z); } play("water"); F.draw(); });
  } else if (tool === "seeds") {
    const seed = G.seedChoice();
    if (!plot) return popup("Turn the soil first");
    if (plot.crop) return;
    if (!seed) return popup("No seeds left");
    if (s.inv.fertilizer > 0 && !plot.fert && G.fertNext) { G.add("fertilizer", -1); plot.fert = true; }
    P.act("use", () => { if (G.plant(k, plot, seed)) { play("plant"); G.vfx.burst("soil", t.x, spotY(t.x, t.z) + 0.2, t.z); G.vfx.burst("spark", t.x, spotY(t.x, t.z) + 0.4, t.z, 0.4); G.vfx.item(`-1 ${ITEMS[seed].icon}`, t.x, spotY(t.x, t.z) + 1, t.z); } });
  }
}

/** trees and rocks take a few blows, fewer with a better tool */
function hew(node) {
  const P = G.player, s = G.s, tool = G.tool.id, at = P.pos.clone().addScaledVector(P.front, 1.4);
  const gate = nearest(G, at.x, at.z, 3, (r) => r.gate);
  if (gate && tool === "axe" && gate.gate.needs === "chop") return P.act("swing", () => G.lore.tryGate(gate));
  const rec = nearest(G, at.x, at.z, 1.7, (r) => r.node === node);
  P.act("swing", () => {
    if (!rec) return play("deny");
    const [x, z] = rec.L.world(rec.x, rec.z), y = groundAt(G, x, z).y, hits = TOOL_UP[tool].hits[s.tools?.[tool] || 0];
    rec.hit = (rec.hit || 0) + 1; spend(0.8);
    play(node === "tree" ? "chop" : "tink");
    G.vfx.burst(node === "tree" ? "wood" : "stone", x, y + 1.2, z, 0.6);
    if (rec.hit < hits) return;
    rec.hit = 0;
    const item = node === "tree" ? "wood" : rec.item, n = node === "tree" ? 3 : 2;
    setGone(G, rec, true); G.add(item, n);
    play(node === "tree" ? "fall" : "smash");
    G.vfx.burst(node === "tree" ? "leaf" : "stone", x, y + (node === "tree" ? 3 : 0.8), z, 2);
    G.vfx.item(`+${n} ${ITEMS[item].icon}`, x, y + 2, z);
  });
}

// ---------------- fishing: cast, wait for the bite, stop the marker in the green ----------------
const fishing = { on: false };
function startFishing() {
  const P = G.player;
  if (fishing.on) return;
  const spot = P.pos.clone().addScaledVector(P.front, 7);
  const under = groundAt(G, spot.x, spot.z), pond = nearest(G, spot.x, spot.z, 2, (r) => r.pond);
  if (under.on !== "sea" && !pond) return popup("Cast from the shore or the dock, toward the water");
  Object.assign(fishing, { on: true, phase: "wait", t: 1.5 + Math.random() * 4, spot });
  G.tackle.lure.position.set(spot.x, pond ? under.y + 0.2 : 0.1, spot.z);
  P.act("swing", () => { play("splash"); G.vfx.burst("splash", spot.x, pond ? under.y + 0.2 : 0.1, spot.z); });
  $("fishBar").hidden = true;
}
function tickFishing(dt, t) {
  if (!fishing.on) return;
  fishing.t -= dt;
  const base = fishing.spot ? groundAt(G, fishing.spot.x, fishing.spot.z).on === "sea" ? 0 : groundAt(G, fishing.spot.x, fishing.spot.z).y + 0.15 : 0;
  G.tackle.lure.position.y = base + 0.05 + Math.sin(t * 3) * 0.05;
  const P = G.player;
  if (fishing.phase === "wait") {
    if (fishing.t <= 0) { fishing.phase = "bite"; fishing.t = 1.1; play("bite"); popup("!", "bite"); G.tackle.lure.position.y = base - 0.2; G.vfx.burst("splash", fishing.spot.x, base + 0.1, fishing.spot.z, 0.5); }
  } else if (fishing.phase === "bite") {
    if (fishing.t <= 0) { popup("It got away"); endFishing(); }
  } else if (fishing.phase === "reel") {
    fishing.x = (Math.sin(t * fishing.speed) + 1) / 2;
    $("fishMark").style.left = `${fishing.x * 100}%`;
  }
  if (P.movingNow) endFishing();
}
function pressFishing() {
  if (fishing.phase === "bite") {
    const s = G.s, hour = (s.minute / 60), season = seasonOf(s.day).index, rain = isWet(s.weather);
    const hours = hour < 5 ? hour + 24 : hour;           // night fish keep biting past midnight
    const can = FISH.filter((f) => (!f.seasons || f.seasons.includes(season)) && (!f.rain || rain) && (!f.when || (hours >= f.when[0] && hours <= f.when[1])) && (!f.rod || (s.rod || 1) >= f.rod));
    const weights = can.map((f) => 1 / f.rarity ** 1.5);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0), fish = can[0];
    can.forEach((f, i) => { if (r >= 0) { r -= weights[i]; if (r < 0) fish = f; } });
    const width = (30 + (s.rod || 1) * 6) / fish.power, left = 10 + Math.random() * (80 - width);
    Object.assign(fishing, { phase: "reel", fish, left, width, speed: 2.4 + fish.power });
    const zone = $("fishZone"); zone.style.left = `${left}%`; zone.style.width = `${width}%`;
    $("fishBar").hidden = false;
  } else if (fishing.phase === "reel") {
    const x = fishing.x * 100, f = fishing.fish;
    if (x >= fishing.left && x <= fishing.left + fishing.width) {
      G.add(f.id, 1); G.s.fish[f.id] = (G.s.fish[f.id] || 0) + 1;
      const first = G.s.fish[f.id] === 1, P = G.player.pos;
      popup(first ? `New! ${f.name} added to your journal` : `Caught a ${f.name}!`, "good"); play(f.rarity >= 3 ? "rare" : "pick"); G.tackle.show(f); G.vfx.burst("splash", fishing.spot.x, 0.2, fishing.spot.z); G.vfx.burst("spark", P.x, P.y + 2.4, P.z);
      G.moment(f.rarity >= 4 ? "rare" : "fish");
    } else popup("It slipped off the hook");
    endFishing();
  }
}
function endFishing() { fishing.on = false; fishing.phase = ""; $("fishBar").hidden = true; }

// ---------------- E: whatever is nearest ----------------
const USE = {
  bed: (t) => ["Sleep until morning", sleep], bin: () => ["Open the shipping bin", G.craft.bin], craft: () => ["Use the workbench", G.craft.bench], stall: () => ["Set up your stall", G.craft.stall], machine: (t) => [`Use the ${itemName(t.p.type) === t.p.type ? "machine" : ""}`, () => G.craft.machine(t)],
  coop: () => (G.s.eggDay === G.s.day ? null : ["Collect eggs", () => { G.s.eggDay = G.s.day; G.add("egg", 2); play("pick"); popup("+2 Eggs", "good"); }]), trough: () => null,
};
function nearestThing() {
  const P = G.player, s = G.s, near = (p, r) => Math.hypot(p.x - P.pos.x, p.z - P.pos.z) < r, list = [];
  if (P.sailing) {
    const at = G.sail.shore();
    if (at) list.push([`Go ashore${at.land ? ` on ${at.land.cfg.name}` : ""}`, () => G.sail.landAt(at)]);
    for (const q of G.lore.sea) if (!q.done() && near(q, 12)) list.push([q.label, q.use]);
    return list[0] || null;
  }
  const B = G.world.bridge;
  if (!s.flags.bridgeFixed && near({ x: B.winch[0], z: B.winch[1] }, 6)) list.push(["Look at the winch", winch]);
  if (near({ x: G.sail.holder.position.x, z: G.sail.holder.position.z }, 8)) list.push(s.flags.boat ? ["Board your boat", G.sail.board] : ["Look at the old boat", G.sail.mend]);
  for (const n of G.people || []) if (n.here?.() !== false && near(n.world(), 3.4)) list.push([`Talk to ${n.data.name}`, () => talkTo(n)]);
  if (G.courier?.char.holder.visible && near(G.courier.pos, 3)) list.push(["Talk to Pip", () => talkTo(G.courier)]);
  for (const a of G.animals || []) if (a.gives && near(a.pos, 2.6) && (s.fedAnimal ||= {})[a.name + a.home[0]] !== s.day) list.push([`Pet the ${a.name.toLowerCase()}`, () => { s.fedAnimal[a.name + a.home[0]] = s.day; G.add(a.gives, 1); play("milk"); G.vfx.burst("heart", a.pos.x, a.pos.y + 1.5, a.pos.z, 0.6); popup(`+1 ${itemName(a.gives)}`, "good"); }]);
  if (G.dinos) {
    for (const d of G.dinos.list) if (P.riding !== d && d.char.holder.visible && near(d.pos, 3 + d.char.seat * 0.6)) { list.push([`${d.r.name || d.data.forms[d.r.stage]}`, () => G.dinos.menu(d)]); break; }
    for (const a of G.dinos.wild) if (near(a.pos, 4.6)) { const k = G.dinos.food(a); list.push([k ? `Offer ${itemName(k)} to the wild ${a.data.forms[0]}` : `A wild ${a.data.forms[0]}`, () => G.dinos.offer(a)]); }
  }
  if (G.companion && near(G.companion.pos, 3)) list.push(["Talk to Vermeil", () => { G.companion.char.once?.("wave"); G.talkingTo = "vermeil"; G.talk.say(COMPANION.name, [COMPANION.idle[Math.floor(Math.random() * COMPANION.idle.length)]]); }]);
  const used = nearest(G, P.pos.x, P.pos.z, 3.2, (r) => r.use);
  if (used) { const u = used.use(); if (u) list.push(u); }
  const forage = nearest(G, P.pos.x + P.front.x, P.pos.z + P.front.z, 1.8, (r) => r.node === "forage");
  if (forage) list.push([`Pick ${itemName(forage.item)}`, () => P.act("use", () => { setGone(G, forage, true); G.add(forage.item, 1); play("pick"); const [x, z] = forage.L.world(forage.x, forage.z); const y = groundAt(G, x, z).y; G.vfx.burst("leaf", x, y + 0.6, z, 0.6); G.vfx.item(`+1 ${ITEMS[forage.item].icon}`, x, y + 1.2, z); })]);
  const place = P.ground?.on === "home" ? G.build.useNear(P.pos.x, P.pos.z) : null;
  if (place) {
    const c = G.build.catalog[place.p.type], u = c.use === "machine" ? [`Use the ${c.label.toLowerCase()}`, () => G.craft.machine(place)] : USE[c.use]?.(place);
    if (u) list.push(u);
  }
  const t = G.farm.target(), plot = s.plots[keyOf(t.x, t.z)];
  if (plot && ripe(plot)) list.push([`Harvest ${CROPS[plot.crop].name}`, () => P.act("use", () => G.reap(keyOf(t.x, t.z), plot))]);
  return list[0] || null;
}
function winch() {
  const r = BRIDGE.repair, s = G.s;
  if (s.money < r.money || (s.inv.wood || 0) < r.wood || (s.inv.stone || 0) < r.stone) { G.moment("bridge_broke"); if (!G.talking) G.talk.say(COMPANION.name, [`The winch needs ${r.wood} wood, ${r.stone} stone and ${r.money} shells.`]); return; }
  G.talk.say(COMPANION.name, ["We've got what it needs. Shall we mend it?"], { choose: [["Mend the winch", () => {
    s.money -= r.money; G.add("wood", -r.wood); G.add("stone", -r.stone); s.flags.bridgeFixed = true;
    play("fanfare"); play("chain"); const b = G.world.bridge; G.vfx.burst("spark", b.winch[0], 8, b.winch[1], 2); popup("The drawbridge works again. It comes down when Willowmere moors", "good");
  }], ["Not yet", null]] });
}
G.setRide = (d) => {
  const P = G.player;
  if (!d) {
    if (P.ground?.on === "sea") return popup("Not out here!");
    if (P.riding) { P.riding = null; P.mode = ""; const y = groundAt(G, P.pos.x, P.pos.z).y; P.pos.y = y; }
    return;
  }
  if (d.data === DINOS.sprig && !G.s.flags.fed) return popup(`${d.r.name} doesn't trust you enough yet. Feed it a carrot first`);
  if (!canRide(d.r)) return popup(`${d.r.name || d.data.forms[d.r.stage]} is too small to carry you yet`);
  P.riding = d; endFishing();
  play(d.r.stage ? "roar" : "chirp");
};
function talkTo(n) {
  const s = G.s, name = n.data.name, sn = seasonOf(s.day);
  G.talkingTo = n;
  s.met[name] = (s.met[name] || 0) + 1;
  const tale = G.lore.tale(n.id);
  if (tale) return G.talk.say(name, tale);
  const mood = s.weather === "storm" ? "Quite a storm, isn't it?" : isWet(s.weather) && Math.random() < 0.4 ? "Wet one today." : sn.index === 3 && Math.random() < 0.25 ? "Stay warm out there." : s.met[name] > 12 && Math.random() < 0.3 ? `Good to see you, ${s.name}. You're practically a local now.` : null;
  const line = mood || n.data.talk[n.line++ % n.data.talk.length];
  const choose = n.data.shop ? [["Let's trade", () => G.shop.open(n.data, n.data.shop)], ["Bye", null]] : null;
  G.talk.say(name, [line], { choose });
}

/** a first landing is a moment */
G.arrive = (L) => {
  const s = G.s, id = L.cfg.id;
  if (id === "home") return G.moment("home_again");
  if (s.seenIsles[id]) return;
  s.seenIsles[id] = true;
  play("fanfare");
  const c = $("titleCard"); c.querySelector("h1").textContent = L.cfg.name; c.querySelector("p").textContent = L.cfg.biome ? `${L.cfg.biome} turtle` : ""; c.hidden = false;
  c.style.animation = "none"; void c.offsetWidth; c.style.animation = "";
  setTimeout(() => { c.hidden = true; }, 5000);
  popup(`Added to your map: ${L.cfg.name}`, "good");
  G.moment("new_isle");
};

function newDay(passedOut) {
  const s = G.s, before = seasonOf(s.day).index;
  G.craft.newDay();
  s.day++; s.minute = 6.5 * 60;
  const season = seasonOf(s.day).index;
  s.weather = pickWeather(s.day, season);
  G.farm.newDay(isWet(s.weather), season);
  G.dinos.newDay();
  regrow(G);
  G.sail.scatter();
  G.player.stamina = 100;
  const P = G.player; P.riding = null; P.mode = ""; P.sailing = false;
  const house = G.build.of("house")[0]?.p || { x: 30, z: -29 };
  const front = [house.x + Math.sin(house.ry) * 11, house.z + Math.cos(house.ry) * 11];
  P.pos.set(front[0], 0, front[1]); P.pos.y = groundAt(G, ...front).y; P.ground = groundAt(G, ...front);
  G.save();
  popup(passedOut ? "You nodded off. Vermeil got you home." : `${seasonOf(s.day).name}, day ${seasonOf(s.day).day}`);
  G.lore.newDay();
  if (s.weather === "storm") { play("thunder"); setTimeout(() => G.moment("storm"), 1200); }
  if (season !== before) setTimeout(() => location.reload(), 900);        // the whole world changes colour: rebuilt for the new season
}
function sleep() { fade(() => newDay(false)); }
function fade(fn) { const f = $("fade"); f.classList.add("on"); setTimeout(() => { fn(); f.classList.remove("on"); }, 450); }
G.nextDay = () => newDay(false);

G.test = { useTool, talkTo, startFishing, pressFishing, fishing, nearestThing, winch, hew };

// ---------------- the first look ----------------
function cinematic(done) {
  G.cinema = true;
  const t0 = performance.now(), cam = G.camera, D = 9500;
  const step = () => {
    const u = G.skipIntro ? 1 : Math.min(1, (performance.now() - t0) / D), a = -2.3 + u * 3.3, r = 430 - u * 200, y = 170 - u * 90;
    cam.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    cam.lookAt(0, 10, 0);
    if (u < 1) return requestAnimationFrame(step);
    G.cinema = false; $("titleCard").hidden = true; done();
  };
  step();
  $("hud").hidden = true;
  $("titleCard").hidden = false;
  addEventListener("keydown", () => { G.skipIntro = true; }, { once: true });
  addEventListener("pointerdown", () => { G.skipIntro = true; }, { once: true });
  setTimeout(() => { $("titleCard").hidden = true; }, D - 1500);
}

async function boot() {
  const canvas = $("game");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.LinearToneMapping;        // bright pastels: filmic tone mapping would darken them
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(46, 1, 0.3, 3200);
  const size = () => { renderer.setSize(innerWidth, innerHeight, false); G.camera.aspect = innerWidth / innerHeight; G.camera.updateProjectionMatrix(); };
  addEventListener("resize", size); size();
  const saved = await storage.load();
  if (saved) G.s = saved;
  const say = (t, p) => { $("loadText").textContent = t; $("loadBar").style.width = `${p}%`; };
  say("Waking the turtle…", 12);
  G.vfx = makeVfx(G);
  await buildWorld(G);
  say("Planting the fields…", 62);
  G.input = makeInput(canvas);
  G.player = await makePlayer(G);
  G.farm = makeFarm(G);
  for (const k of Object.keys(G.s.plots)) { const [x, z] = spotOf(k); if (!G.farm.flat(x, z)) delete G.s.plots[k]; }     // a farm saved on ground that's since changed shape
  G.farm.draw();
  G.talk = makeTalk(G); G.hud = makeHud(G); G.book = makeBook(G); G.shop = makeShop(G);
  makeBridge(G);
  G.craft = makeCraft(G);
  G.build = makeBuild(G);
  await G.build.load();
  G.lore = makeLore(G);
  say("Calling everyone in…", 82);
  G.dinos = makeDinos(G);
  G.people = makePeople(G);
  G.sail = await makeSail(G);
  [G.companion, G.animals, G.school, G.courier] = await Promise.all([makeCompanion(G), makeAnimals(G), makeSchool(G), makeCourier(G)]);
  G.lore.start();
  G.tackle = makeTackle(G);
  await G.tackle.refresh();
  const o = G.s.opts;
  setLevels(o.music ?? 0.5, o.sfx ?? 0.8);
  if (o.sense) G.input.sense = o.sense;
  if (o.talk) G.talk.setSpeed(o.talk);
  if (o.text) document.documentElement.style.setProperty("--text", o.text);
  if (missing.size) console.warn("[turtle] models missing:", [...missing]);
  say("", 100);
  $("loading").hidden = true;
  addEventListener("pointerdown", startAudio, { once: true });
  addEventListener("keydown", startAudio, { once: true });

  const go = () => { G.paused = false; $("hud").hidden = false; setTimeout(() => G.moment("start"), 600); };
  if (saved?.name) { G.cinema = false; go(); }
  else {
    // the character maker: you on the turf, the camera close
    G.paused = true; G.cinema = true;
    const P = G.player, c = G.camera;
    c.position.set(P.pos.x + 2.6, P.pos.y + 1.5, P.pos.z + 4.6);
    c.lookAt(P.pos.x - 0.9, P.pos.y + 1, P.pos.z);
    makeCreator(G, (pick) => {
      Object.assign(G.s, pick);
      G.save();
      cinematic(go);
    }).show();
  }

  const clock = G.clock = new THREE.Clock();
  let saveIn = 90, sceneIn = 0;
  const frame = () => { requestAnimationFrame(frame); turn(Math.min(clock.getDelta(), 0.05)); };
  let simT = 0;
  G.draw = () => renderer.render(G.scene, G.camera);
  /** run the game forward by hand, whether or not the window is being drawn */
  G.run = (seconds, step = 1 / 30) => { for (let i = 0; i < seconds / step; i++) { simT += step; turn(step, simT + clock.elapsedTime); } };
  const turn = (dt, at) => {
    const t = at ?? clock.elapsedTime + simT, s = G.s, P = G.player, I = G.input;
    if (!G.paused && !G.talking && !G.cinema) {
      if (!G.cheat.stopTime) s.minute += dt / SECONDS_PER_MINUTE;
      if (s.minute >= 26 * 60) fade(() => newDay(true));
      saveIn -= dt;
      if (saveIn < 0) { saveIn = 90; G.save(); }
    }
    P.movingNow = !G.paused && !G.talking && [KEYS.forward, KEYS.back, KEYS.left, KEYS.right].some((k) => I.down.has(k));
    const locked = G.paused || G.talking || G.cinema;
    tickPlayer(G, dt);
    G.dinos.tick(dt, t); G.companion?.tick(dt);
    for (const a of G.animals || []) a.tick(dt, t);
    for (const n of G.people) n.tick(dt, n.L.dist(P.pos.x, P.pos.z) < n.L.cfg.a + 130);
    G.courier?.tick(dt, P.pos.distanceTo(G.world.lands.home.group.position) < 420);
    tickWorld(G, dt, t);
    G.world.bridge.tick(dt, t);
    G.farm.tick(t);
    G.sail.tick(dt, t);
    G.build.tick(dt);
    G.vfx.tick(dt);
    tickFishing(dt, t);
    G.tackle.tick(dt, t, fishing);
    { const near = P.pos.x < -90; for (const f of G.school || []) f.tick(dt, near); }
    setNight(s.minute / 60 > 20 || s.minute / 60 < 5);
    sceneIn -= dt;
    if (sceneIn < 0) { sceneIn = 2; const on = P.ground?.on, c = G.world.lands[on]?.cfg; setScene({ weather: s.weather, place: P.sailing || P.mode === "swim" ? "sea" : on === "elder" ? "ruins" : c?.houses ? "town" : P.pos.z < -40 && on === "home" ? "forest" : "home" }); }
    if (P.ground?.on === "willowmere" && !s.flags.town) { s.flags.town = true; G.arrive(G.world.lands.willowmere); }
    else if (P.ground?.land && P.ground.on !== "home" && P.ground.on !== "bridge" && !s.seenIsles[P.ground.on] && G.world.lands[P.ground.on]) G.arrive(P.ground.land);
    if (isWet(s.weather) && !locked && Math.random() < dt * 0.01) G.moment("rain");
    if (s.minute / 60 > 22.5 && !locked) G.moment("night");
    if (!G.cinema) G.hud.tick();
    const near = locked ? null : nearestThing();
    G.hud.prompt(near && !fishing.on ? `E  ${near[0]}` : "");
    for (const code of I.pressed) {
      if (G.building) continue;
      if (G.talking) { if (code === KEYS.interact || code === "Space" || code === "Enter") G.talk.next(); continue; }
      if (code === KEYS.book || code === "Tab") { if (!G.cinema && G.shop) G.book.toggle(); continue; }
      if (code === KEYS.map) { G.book.toggle(true, "map"); continue; }
      if (code === KEYS.bag) { G.book.toggle(true, "bag"); continue; }
      if (code === "Escape") { if (G.book.active()) G.book.toggle(false); else if (!$("shop").hidden) $("shopClose").click(); else G.book.toggle(true, "settings"); continue; }
      if (locked) continue;
      if (code === KEYS.build) G.build.toggle();
      else if (code === KEYS.interact) near?.[1]();
      else if (code === KEYS.ride) {
        if (P.riding) G.setRide(null);
        else { const d = G.dinos.list.filter((x) => canRide(x.r) && x.pos.distanceTo(P.pos) < 7).sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos))[0]; if (d) G.setRide(d); }
      } else if (code === KEYS.seed) { const k = Object.keys(s.inv).filter((i) => ITEMS[i]?.seed); if (k.length) { G.seedPick = k[(k.indexOf(G.seedChoice()) + 1) % k.length]; G.pickTool(3); } }
      else if (/^Digit[1-7]$/.test(code)) G.pickTool(Number(code.slice(5)) - 1);
    }
    I.pressed.clear();
    if (I.click) { I.click = false; if (G.building) { /* the build tool has its own mouse */ } else if (G.talking) G.talk.next(); else if (fishing.phase === "bite" || fishing.phase === "reel") pressFishing(); else if (!locked) useTool(); }
    if (at == null) renderer.render(G.scene, G.camera);
  };
  frame();
}

boot().catch((e) => { console.error(e); $("loadText").textContent = `Turtle Island couldn't start: ${e.message}`; });
export { ISLANDS, NPCS, TIERS, SHORE };
