// rare.js - every turtle hides one rare thing, and only one kind of dinosaur can smell it (RARE_FINDS in data.js). Ride that one on that turtle
// and it catches the scent: it stops to sniff, you're told warmer or colder, a glint shows when you're close, and E digs it up.
// Three spots a turtle, new ones each week; each is found once.
import { DINOS, ISLANDS, ITEMS, RARE_FINDS, perkOf } from "./data.js";
import { groundAt } from "./world.js";
import { popup } from "./ui.js";

const PER_WEEK = 3;
const hash = (a, b) => { const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return h - Math.floor(h); };

export function makeRare(G) {
  const R = {}, s = G.s;
  s.rare ||= {}; s.sniffed ||= {};
  const week = () => Math.floor((s.day - 1) / 7);
  /** this week's hiding places on a turtle, in its own space: dry, fairly flat ground */
  const spotsOf = (L) => {
    const out = [], id = L.cfg.id, seed = (L.cfg.seed || 1) * 31 + week() * 7;
    for (let i = 0; out.length < PER_WEEK && i < 200; i++) {
      const a = hash(seed, i) * Math.PI * 2, d = 0.15 + Math.sqrt(hash(i, seed)) * 0.75, x = Math.cos(a) * L.cfg.a * d, z = Math.sin(a) * L.cfg.b * d;
      if (L.land.ground(x, z) < 4.5 || L.land.rough(x, z, 1.4) > 1.2) continue;
      out.push({ x, z, key: `${id}:${week()}:${out.length}` });
    }
    return out;
  };
  /** the hunt right now: the mount, its turtle, and the nearest spot not yet found, in world space. null if this mount can't smell anything here */
  const hunt = () => {
    const P = G.player, d = P.riding;
    if (!d || d.vehicle) return null;
    const id = P.ground?.on, find = RARE_FINDS[id], L = G.world.lands[id];
    if (!find || !L || d.r.species !== find.by) return null;
    let best = null;
    for (const sp of spotsOf(L)) {
      if (s.sniffed[sp.key]) continue;
      const [x, z] = L.world(sp.x, sp.z), dist = Math.hypot(x - P.pos.x, z - P.pos.z);
      if (!best || dist < best.dist) best = { ...sp, wx: x, wz: z, dist };
    }
    return best && { d, L, id, find, spot: best };
  };
  let next = 0, glint = 0, told = "";
  R.tick = (dt, t) => {
    const h = hunt();
    if (!h) { told = ""; return; }
    const { d, spot } = h, reach = 45 * (1 + 0.5 * perkOf(d.data, "keen"));
    if (spot.dist > reach) return;
    if (t > next) {                                          // it stops to sniff the air, and tells you how close
      next = t + 4 + spot.dist / 20;
      d.char.react?.("sniff"); d.say?.("sniff");
      const word = spot.dist < 6 ? "It's right here! Press E" : spot.dist < 15 ? "Very warm..." : spot.dist < 28 ? "Warmer" : "It's caught a scent";
      if (word !== told) { told = word; popup(`${d.r.name || d.data.forms[d.r.stage]}: ${word}`); }
      if (spot.dist > 20) G.moment("scent");
    }
    if (spot.dist < 14 && t > glint) { glint = t + 1.2; const y = groundAt(G, spot.wx, spot.wz).y; G.vfx.burst("glow", spot.wx, y + 0.3, spot.wz, 0.35); }
  };
  /** E, close enough: dig it up */
  R.action = () => {
    const h = hunt();
    if (!h || h.spot.dist > 6) return null;
    const { d, id, find, spot } = h, name = d.r.name || d.data.forms[d.r.stage];
    return [`${name}: dig up what it smells`, () => {
      s.sniffed[spot.key] = true;
      d.char.react?.("sniff"); d.char.work?.(); d.say?.("dig");
      const y = groundAt(G, spot.wx, spot.wz).y;
      for (let i = 0; i < 5; i++) setTimeout(() => G.vfx.burst("soil", spot.wx, y + 0.2, spot.wz, 0.6), i * 260);
      setTimeout(() => {
        const n = 1 + (Math.random() < 0.25 * perkOf(d.data, "lucky") ? 1 : 0);
        G.add(find.item, n); s.rare[id] = (s.rare[id] || 0) + n;
        G.sfx("rare"); G.vfx.burst("gold", spot.wx, y + 1, spot.wz, 1.5); G.vfx.item(`+${n} ${ITEMS[find.item].icon}`, spot.wx, y + 1.6, spot.wz);
        G.dinos.friend(d, 3);
        popup(`Found ${n > 1 ? `${n} ` : ""}${ITEMS[find.item].name}! Only a ${DINOS[find.by].line} could smell that out on ${ISLANDS[id].name}`, "good");
        G.moment("rare_find");
      }, 1300);
    }];
  };
  R.spotsOf = spotsOf;
  return R;
}
