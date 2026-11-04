// ridework.js - what a mount does with you on its back. A tiller turns a row of soil ahead of it, a waterer drinks at a pond or the sea and then
// waters every dry plot around it, a harvester or planter works the whole patch it stands in, a digger digs, a diver dives.
// The bigger the form, the more it does in one go; the kinds found on the far turtles do more again. Each go tires it a little.
import { FISH, ITEMS, itemName, perkOf } from "./data.js";
import { skillsOf } from "./dinos.js";
import { keyOf, ripe, spotOf } from "./farm.js";
import { groundAt, isWet, nearest, setGone, shoreNear } from "./world.js";
import { popup } from "./ui.js";

export function makeRideWork(G) {
  const W = {}, s = G.s;
  const reach = (d) => 3 + d.r.stage * 1.5 + (d.data.basic ? 0 : 1.5);            // how far round it works, in metres
  const plotsAround = (d, test) => { const P = G.player, r = reach(d); return Object.entries(s.plots).filter(([k, p]) => { const [x, z] = spotOf(k); return Math.hypot(x - P.pos.x, z - P.pos.z) <= r && test(p); }); };
  const tire = (d, n) => { d.r.energy = Math.max(0, d.r.energy - n * (1 - 0.3 * perkOf(d.data, "tireless"))); G.dinos.friend(d, 0.4); };
  const tired = (d) => d.r.energy < 5 && (popup(`${d.r.name || d.data.forms[d.r.stage]} is too tired. Let it rest till morning`), true);
  const y0 = (x, z) => groundAt(G, x, z).y;
  const dug = {};

  /** what this mount could do right here, as [label, fn] for E. Farm work first, since that's what you came for */
  W.actions = () => {
    const P = G.player, d = P.riding;
    if (!d || d.vehicle || P.sailing) return [];
    const sk = skillsOf(d.r), out = [], home = P.ground?.on === "home", name = d.r.name || d.data.forms[d.r.stage];
    if (home && sk.includes("till")) {
      const n = 3 + d.r.stage * 2 + (d.data.basic ? 0 : 2), cells = [];
      for (let i = 1; i <= n; i++) { const x = P.pos.x + P.front.x * i * 2, z = P.pos.z + P.front.z * i * 2, k = keyOf(x, z); if (!s.plots[k] && G.farm.canTill(x, z)) cells.push([k, x, z]); }
      if (cells.length) out.push([`${name}: till a row (${cells.length})`, () => {
        if (tired(d)) return;
        d.char.work(); d.say("dig"); G.sfx("dig");
        cells.forEach(([k, x, z], i) => setTimeout(() => {
          if (s.plots[k] || !G.farm.canTill(x, z)) return;
          s.plots[k] = { crop: null, age: 0, wet: isWet(s.weather) };
          const weed = nearest(G, x, z, 1.3, (r) => r.debris && r.node === "forage"); if (weed) { setGone(G, weed, true); G.add(weed.item, 1); }
          G.vfx.burst("soil", x, y0(x, z) + 0.2, z); G.farm.draw();
        }, i * 140));
        tire(d, cells.length * 0.6); s.flags.rideTilled = true; G.moment("first_till");
      }]);
    }
    if (sk.includes("water")) {
      const sea = shoreNear(G, P.pos.x, P.pos.z, 6), pond = nearest(G, P.pos.x + P.front.x * 2, P.pos.z + P.front.z * 2, 4, (r) => r.pond), cap = 9 + d.r.stage * 8 + (d.data.basic ? 0 : 8);
      if ((sea || pond) && (d.tank || 0) < cap) out.push([`${name}: drink up water to carry (${cap})`, () => { d.char.drink?.(2); d.say("happy"); G.sfx("water"); d.tank = cap; popup(`${name} is carrying water for ${cap} plots`, "good"); }]);
      const dry = home ? plotsAround(d, (p) => p.crop && !p.wet) : [];
      if (dry.length && d.tank > 0) out.push([`${name}: water the crops around (${Math.min(dry.length, d.tank)})`, () => {
        if (tired(d)) return;
        const some = dry.slice(0, d.tank); d.tank -= some.length;
        d.char.work(); G.sfx("water");
        for (const [k, p] of some) { p.wet = true; const g = perkOf(d.data, "green"); if (g) p.care = (p.care || 0) + g * 3; const [x, z] = spotOf(k); G.vfx.burst("water", x, y0(x, z) + 0.4, z, 0.6); }
        G.farm.draw(); tire(d, some.length * 0.3);
      }]);
    }
    if (home && sk.includes("harvest")) {
      const ready = plotsAround(d, (p) => ripe(p)).slice(0, 9 + d.r.stage * 8);
      if (ready.length) out.push([`${name}: harvest around (${ready.length})`, () => { if (tired(d)) return; d.char.work(); ready.forEach(([k, p], i) => setTimeout(() => G.reap(k, p, true), i * 90)); tire(d, ready.length * 0.4); popup(`${name} brought in ${ready.length} crops`, "good"); }]);
    }
    if (home && sk.includes("plant")) {
      const seed = G.seedChoice(), empty = seed ? plotsAround(d, (p) => !p.crop).slice(0, s.inv[seed] || 0) : [];
      if (empty.length) out.push([`${name}: sow ${itemName(seed)} around (${empty.length})`, () => { if (tired(d)) return; d.char.work(); let n = 0; for (const [k, p] of empty) if (s.inv[seed] > 0 && G.plant(k, p, seed, true)) { n++; const [x, z] = spotOf(k); G.vfx.burst("soil", x, y0(x, z) + 0.2, z, 0.5); } G.farm.draw(); tire(d, n * 0.3); }]);
    }
    // out in the world
    const g = groundAt(G, P.pos.x, P.pos.z), cell = `${g.on}:${Math.round(P.pos.x / 8)}:${Math.round(P.pos.z / 8)}:${s.day}`;
    if (sk.includes("dig") && g.on !== "sea" && !home && !dug[cell]) out.push([`${name}: dig here`, () => {
      if (tired(d)) return; dug[cell] = true; d.char.react?.("sniff"); d.say("dig");
      for (let i = 0; i < 5; i++) setTimeout(() => G.vfx.burst("soil", P.pos.x + P.front.x * 1.5, g.y + 0.2, P.pos.z + P.front.z * 1.5, 0.6), i * 240);
      setTimeout(() => { const r = Math.random(), got = r < 0.04 ? "relic" : r < 0.24 ? "ore" : r < 0.6 ? "stone" : "fiber", n = got === "relic" ? 1 : 2 + perkOf(d.data, "lucky"); G.add(got, n); G.vfx.item(`+${n} ${ITEMS[got].icon}`, P.pos.x, g.y + 2, P.pos.z); G.sfx("pick"); }, 1200);
      tire(d, 2);
    }]);
    if (sk.includes("dive") && g.on === "sea" && !(d.diveAt > performance.now())) out.push([`${name}: dive`, () => {
      d.diveAt = performance.now() + 15000; d.say("call"); G.sfx("splash"); G.vfx.burst("water", P.pos.x, 0.3, P.pos.z, 2);
      setTimeout(() => { const r = Math.random(), got = r < 0.06 ? "relic" : r < 0.3 + 0.08 * perkOf(d.data, "lucky") ? "pearl" : FISH[Math.floor(Math.random() * FISH.length)].id; G.add(got, 1); G.vfx.item(`+1 ${ITEMS[got].icon}`, P.pos.x, 2, P.pos.z); popup(`${name} came up with ${itemName(got)}`, "good"); G.sfx("pick"); }, 1600);
      tire(d, 2);
    }]);
    return out;
  };
  return W;
}
