// quests.js - the story and the odd jobs: gates in the way, secrets to reach, carvings to find, tales people tell, orders on the board, festivals.
import * as THREE from "three";
import { BRIDGE, CARVINGS, COMPANION, CROPS, FISH, GATES, ITEMS, SECRETS, STORY, TALES, WEEK, itemName } from "./data.js";
import { fillFountain, madeProp } from "./made.js";
import { prop } from "./assets.js";
import { addSolid, dropSolid, groundAt } from "./world.js";
import { festivalOf } from "./craft.js";
import { popup } from "./ui.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function makeLore(G) {
  const s = G.s, Q = { sea: [], fountains: [] };
  s.carved ||= {}; s.found ||= {}; s.orders ||= {};
  const give = (o = {}) => { for (const [k, n] of Object.entries(o)) { if (k === "money") s.money += n; else G.add(k, n); } };
  const fanfare = (x, y, z) => { G.sfx("rare"); G.vfx.burst("gold", x, y, z); };

  // ---------------- what stands in the way ----------------
  const makeGate = async (L, g) => {
    if (s.flags[g.id]) return;
    const y = L.land.ground(g.x, g.z);
    const model = g.id === "logs" ? madeProp("logjam") : await prop("conv_ultimate_nature_pack/Rock_2.glb", L.group, { x: g.x, y: y - 0.3, z: g.z, height: 7.5 });
    if (g.id === "logs") { model.position.set(g.x, y, g.z); model.rotation.y = 0.5; L.group.add(model); }
    const rec = addSolid(L, { x: g.x, z: g.z, r: g.r, gate: g, model });
    rec.use = () => [`Look at the ${g.name.toLowerCase()}`, () => Q.tryGate(rec)];
  };
  Q.clearGate = (rec) => {
    const g = rec.gate, [x, z] = rec.L.world(g.x, g.z), y = groundAt(G, x, z).y;
    s.flags[g.id] = true; rec.L.group.remove(rec.model); dropSolid(rec);
    G.sfx(g.id === "logs" ? "fall" : "smash"); G.vfx.burst(g.id === "logs" ? "wood" : "stone", x, y + 2, z, 3); G.vfx.burst("dust", x, y + 1, z, 3);
    popup(`The way past the ${g.name.toLowerCase()} is open`, "good");
  };
  Q.tryGate = (rec) => {
    const g = rec.gate, P = G.player, mount = P.riding;
    if (g.needs === "smash" && mount && mount.can("smash")) { G.dinos.friend(mount, 4); return Q.clearGate(rec); }
    if (g.needs === "chop") {
      if (G.dinos.list.some((d) => d.pos.distanceTo(P.pos) < 18 && d.has("chop"))) return Q.clearGate(rec);
      if (G.tool?.id === "axe" && (s.tools?.axe || 0) >= g.tool[1]) return Q.clearGate(rec);
    }
    G.talk.say(COMPANION.name, [g.lines]);
  };

  // ---------------- what's waiting to be found ----------------
  const secret = (L, o) => {
    if (s.found[o.id]) return;
    const [wx, wz] = L ? [o.x, o.z] : [o.x, o.z], y = L ? L.land.ground(wx, wz) : 0, model = madeProp("cairn");
    model.position.set(wx, y, wz); (L ? L.group : G.scene).add(model);
    const use = () => {
      if (s.found[o.id]) return;
      if (o.needs && !G.canReach(o.needs)) return G.talk.say(COMPANION.name, ["Something's here, but we'd need a dinosaur with the right talent."]);
      s.found[o.id] = true; if (o.flag) s.flags[o.flag] = true;
      model.parent?.remove(model); give(o.gives);
      fanfare(G.player.pos.x, G.player.pos.y + 1.5, G.player.pos.z);
      popup(`Found: ${o.name}`, "good");
      G.talk.say(COMPANION.name, o.lines);
    };
    if (L) { const rec = addSolid(L, { x: wx, z: wz, r: 0 }); rec.use = () => (s.found[o.id] ? null : [o.name, use]); }
    else Q.sea.push({ x: wx, z: wz, label: o.name, use, done: () => s.found[o.id] });
  };
  const carving = (L, o) => {
    if (s.carved[o.id]) return;
    const y = L.land.ground(o.x, o.z), model = madeProp("tablet");
    model.position.set(o.x, y - 0.05, o.z); model.rotation.y = 0.6; model.scale.setScalar(1.3); L.group.add(model);
    const rec = addSolid(L, { x: o.x, z: o.z, r: 1.1 });
    rec.use = () => (s.carved[o.id] ? null : ["Read the old carving", () => {
      s.carved[o.id] = true; G.add("carving", 1);
      fanfare(G.player.pos.x, G.player.pos.y + 1.5, G.player.pos.z);
      popup("Old Carving added to your journal", "good");
      G.talk.say(COMPANION.name, [`"${o.text}"`, ...(o.id === "c1" ? COMPANION.moments.carving.lines : o.id === "c5" ? ["This is the one Old Moss needs to hear about."] : ["One more piece. My theory keeps changing."])]);
    }]);
  };
  /** the board in the square, and the Sky Shrine waiting for the Heartbloom */
  const special = (L) => {
    if (L.cfg.id === "willowmere") {
      const [x, z] = L.cfg.places.board, o = madeProp("board");
      o.position.set(x, L.land.ground(x, z), z); L.group.add(o);
      const rec = addSolid(L, { x, z, r: 0.8 }); rec.use = () => ["Read the order board", Q.board];
      Q.town(L);
    }
    else if (L.cfg.stalls) Q.town(L);                         // every town has its market
    if (L.cfg.id === "elder") { const rec = addSolid(L, { x: 0, z: -2, r: 0 }); rec.use = () => (s.flags.chest ? null : ["Open the last Shellwright chest", () => { s.flags.chest = true; give({ relic: 2, money: 800 }); fanfare(G.player.pos.x, G.player.pos.y + 1, G.player.pos.z); popup("Inside: relics, and something very old", "good"); }]); }
    if (L.cfg.id === "home" && !s.flags.finale) {
      const rec = addSolid(L, { x: -6, z: -90, r: 0 });
      rec.use = () => (s.inv.heartseed > 0 && !s.flags.finale ? ["Offer the Heartbloom to the shrine", Q.finale] : null);
    }
    if (L.cfg.id === "home") { const R = L.cfg; Q.home = R; }
  };
  /** the square: a fountain, lamps and benches, and the market stalls. The empty ones are for rent */
  Q.town = (L) => {
    const f = L.cfg.flats[0], put = (kind, x, z, ry = 0, s2 = 1) => { const o = madeProp(kind), wx = f.x + x, wz = f.z + z; o.position.set(wx, L.land.ground(wx, wz), wz); o.rotation.y = ry; o.scale.setScalar(s2); L.group.add(o); return [o, wx, wz]; };
    const fx = f.x, fz = f.z, own = L.cfg.id !== "willowmere";
    if (!own) {                                              // Willowmere's round square: the fountain, ringed with lamps and benches. The other towns keep their own shape
      prop("../games/asset_packs/town/Fountain.glb", L.group, { x: fx, y: L.land.ground(fx, fz) - 0.05, z: fz, scale: 1.7 }).then((o) => o && fillFountain(o)); addSolid(L, { x: fx, z: fz, r: 5.2 }); Q.fountains.push({ L, x: fx, z: fz, h: 6 });
      for (let i = 0; i < 8; i++) { const a = i / 8 * 6.3, [, x, z] = put(i % 2 ? "bench" : "lamp", Math.cos(a) * 8, Math.sin(a) * 8, -a + Math.PI / 2); addSolid(L, { x, z, r: 0.5 }); if (i % 2) for (const s of [-1, 1]) addSolid(L, { x: x + s * Math.cos(-a + Math.PI / 2) * 0.8, z: z - s * Math.sin(-a + Math.PI / 2) * 0.8, r: 0.5 }); }
    } else for (const [x, z, ry] of L.cfg.stalls) { const [, lx, lz] = put("lamp", x + Math.cos(ry) * 2.8, z - Math.sin(ry) * 2.8); addSolid(L, { x: lx, z: lz, r: 0.4 }); }       // a lamp at the end of each stall
    const FOOD2 = ["conv_ultimate_food_pack/Apple.glb", "conv_ultimate_food_pack/Pumpkin.glb", "conv_ultimate_food_pack/Bread.glb", "conv_ultimate_food_pack/Fish.glb", "conv_ultimate_food_pack/Carrot.glb", "conv_ultimate_food_pack/Tomato.glb"];
    L.cfg.stalls.forEach(([x, z, ry, who], i) => {
      const [o, wx, wz] = put("stall", x, z, ry, 1.2), rec = addSolid(L, { x: wx, z: wz, r: 1.2 });
      for (const k of [-1.5, 1.5]) addSolid(L, { x: wx + Math.cos(ry) * k, z: wz - Math.sin(ry) * k, r: 1.2 });       // a stall is long: the whole counter is in the way, not just its middle
      if (who !== "rent") { for (let n = 0; n < 5; n++) prop(FOOD2[(i + n) % FOOD2.length], o, { x: -1.2 + n * 0.6, y: 1.05, z: 0, height: 0.26, ry: n }); return; }
      const key = own ? `${L.cfg.id}:${i}` : i;               // Willowmere's are numbered as they always were, so a stall you rented there stays yours
      (Q.stalls ||= []).push({ L, o, i: key, x: wx, z: wz, ry });
      rec.use = () => (s.rented?.[key] ? ["Set up your rented stall", () => G.craft.stall()] : ["Rent this stall (300 shells)", () => {
        if (s.money < 300) return popup("A stall here is 300 shells");
        s.money -= 300; (s.rented ||= {})[key] = true; G.sfx("buy"); G.vfx.burst("gold", G.player.pos.x, G.player.pos.y + 2, G.player.pos.z); popup("This stall is yours! Put your goods out", "good"); G.craft.stall();
      }]);
    });
    G.craft.showGoods();
  };
  G.onDetail = (L) => {
    const id = L.cfg.id;
    for (const g of GATES) if (g.land === id) makeGate(L, g);
    for (const o of SECRETS) if (o.land === id) secret(L, o);
    for (const c of CARVINGS) if (c.land === id) carving(L, c);
    special(L);
    G.peopleOf?.(L);
    G.life?.herdOf(L); G.life?.folkOf(L);
    G.biomes?.onDetail(L);
    if (id === "elder") G.moment("ruins");
  };
  Q.start = () => {
    for (const L of G.world.list) if (L.detail) G.onDetail(L);
    for (const o of SECRETS) if (!o.land) secret(null, o);
  };

  Q.finale = () => {
    const P = G.player, W = G.world;
    G.add("heartseed", -1); s.flags.finale = true;
    G.sfx("evolve"); G.vfx.burst("glow", P.pos.x, P.pos.y + 1, P.pos.z, 3);
    setTimeout(() => G.sfx("horn"), 900); setTimeout(() => { G.sfx("horn"); W.lands.home.body.neck.rotation.z += 0.2; }, 1800);
    G.talk.say(COMPANION.name, ["It's going down through the shell. I can feel it in my feet.", "Listen. Oma's singing. Tarn too. I've never heard it this loud.", "There. Far out. Did you hear that? Something very small just sang back.", "Pell's awake. After all this time. I think I need a minute."], { then: () => { popup("Pell is coming home. The main story is complete, and the world goes on.", "good"); } });
  };

  // ---------------- people's tales, once each ----------------
  Q.tale = (npcId) => {
    for (const t of TALES) if (t.who === npcId && t.need(s)) {
      s.flags[t.set] = true; give(t.gives);
      if (t.set === "chart") { G.world.lands.elder.group.visible = true; popup("The Elder is marked on your map", "good"); G.sfx("rare"); }
      return t.lines;
    }
    return null;
  };

  // ---------------- the order board: new jobs every week, for ever ----------------
  const week = () => Math.floor((s.day - 1) / WEEK);
  Q.orders = () => {
    const w = week(), crops = Object.keys(CROPS).filter((k) => !CROPS[k].story && CROPS[k].seasons.includes(Math.floor((s.day - 1) / 14) % 4)), fish = FISH.filter((f) => f.rarity <= 2);
    const pick = (list, i) => list[Math.abs(Math.floor(Math.sin((w + 1) * (i + 3) * 12.9) * 9999)) % list.length];
    const c1 = pick(crops, 1), c2 = pick(crops, 2), f = pick(fish, 3);
    return [{ id: `${w}a`, want: { [c1]: 5 + w % 4 }, pay: (ITEMS[c1].sell || 20) * 10 }, { id: `${w}b`, want: { [c2]: 8 + w % 5 }, pay: (ITEMS[c2].sell || 20) * 14 }, { id: `${w}c`, want: { [f.id]: 2 }, pay: f.sell * 5 }, { id: `${w}d`, want: { plank: 10 + w % 8, brick: 6 }, pay: 260 }];
  };
  Q.board = () => {
    const rows = $("shopRows");
    $("shopTitle").textContent = "Order board"; $("shopMoney").textContent = `${s.money} shells`; rows.replaceChildren(); $("shop").hidden = false; G.paused = true; G.sfx("open");
    rows.append(el("p", "muted", "New orders are pinned up every week."));
    for (const o of Q.orders()) {
      const r = el("div", "row"), b = el("button", "cozy small", s.orders[o.id] ? "Done" : "Deliver"), ok = Object.entries(o.want).every(([k, n]) => (s.inv[k] || 0) >= n);
      r.append(el("b", "", Object.entries(o.want).map(([k, n]) => `${n} ${itemName(k)}`).join(" + ")), el("em", "", `${o.pay}`));
      b.disabled = !!s.orders[o.id] || !ok;
      b.onclick = () => { for (const [k, n] of Object.entries(o.want)) G.add(k, -n); s.money += o.pay; s.orders[o.id] = true; s.flags.order = (s.flags.order || 0) + 1; G.sfx("fanfare"); Q.board(); };
      r.append(b); rows.append(r);
    }
  };

  /** the morning: what's on today */
  Q.newDay = () => {
    const f = festivalOf(s);
    if (f) { G.sfx("fanfare"); setTimeout(() => { popup(`${f.name}! ${f.text}`, "good"); G.moment("festival"); }, 900); }
    if (s.day % 9 === 0) popup("A strange boat has tied up at your dock", "good");
    const P = G.world.lands.home;
    if (s.flags.after && s.day % 7 === 1) popup("Sailors report a little island adrift, far out", "good");
    return P;
  };
  Q.goal = () => STORY.find((q) => !q.done(s));
  return Q;
}
export { BRIDGE, THREE };
