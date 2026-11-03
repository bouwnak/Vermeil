// craft.js - turning things into better things: the workbench and machines, the shipping bin, your market stall, and what the market will pay.
import { ANIMALS, CATALOG, CROPS, DEMAND, FESTIVALS, ITEMS, MACHINES, RECIPES, SHOPS, WEEK, itemName } from "./data.js";
import * as THREE from "three";
import { fbm } from "./terrain.js";
import { seasonOf } from "./world.js";
import { popup } from "./ui.js";
import { makeGoods } from "./made.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const nowOf = (s) => s.day * 1440 + s.minute;
const kindOf = (i) => (i?.fish ? "fish" : i?.crop ? "crop" : i?.made ? "made" : "mat");
export const festivalOf = (s) => { const n = seasonOf(s.day); return FESTIVALS.find((f) => f.season === n.index && f.day === n.day) || null; };
/** this week, this place wants some kinds of goods more than others: 0.75 to 1.5 */
export function demand(s, place, kind) {
  const week = Math.floor((s.day - 1) / WEEK), i = DEMAND.indexOf(kind);
  return 0.75 + fbm(week * 2.7 + place.length * 3.1, i * 4.3 + place.charCodeAt(0)) * 0.95;
}
/** what a place pays for something today */
export function priceOf(s, id, shop) {
  const it = ITEMS[id], S = SHOPS[shop];
  if (!it?.sell) return 0;
  const f = festivalOf(s), kind = kindOf(it), feast = f && (f.kind === kind || f.kind === "all") ? (f.kind === "fish" ? 2 : f.kind === "all" ? 1.2 : 1.5) : 1;
  return Math.max(1, Math.round(it.sell * (S ? (S.buys(it) ? S.pay : 0.6) : 1) * demand(s, shop || "bin", kind) * feast));
}

export function makeCraft(G) {
  const s = G.s, C = {}, box = $("shop"), rows = $("shopRows");
  s.machines ||= {};
  const has = (input) => Object.entries(input).every(([k, n]) => (s.inv[k] || 0) >= n);
  const list = (input) => Object.entries(input).map(([k, n]) => `${n} ${itemName(k)}`).join(", ");
  const open = (title) => { $("shopTitle").textContent = title; $("shopMoney").textContent = `${s.money} shells`; rows.replaceChildren(); box.hidden = false; G.paused = true; G.sfx("open"); };

  C.bench = () => {
    open("Workbench");
    for (const r of RECIPES.filter((x) => x.machine === "bench")) {
      const row = el("div", "row"), b = el("button", "cozy small", "Make");
      row.append(el("b", "", `${ITEMS[r.out].icon} ${itemName(r.out)}${r.n > 1 ? ` × ${r.n}` : ""}`), el("span", "muted", list(r.in)));
      b.disabled = !has(r.in);
      b.onclick = () => { for (const [k, n] of Object.entries(r.in)) G.add(k, -n); G.add(r.out, r.n || 1); (s.made ||= {})[r.out] = true; G.sfx("place"); const p = G.player.pos; G.vfx.burst("wood", p.x, p.y + 1, p.z); C.bench(); };
      row.append(b); rows.append(row);
    }
  };
  /** a machine: pick a recipe, and it works through the hours whether you're there or not */
  C.machine = (t) => {
    const id = t.p.id, kind = CATALOG[t.p.type].machine, m = s.machines[id];
    t.kick = 3;
    open(MACHINES[kind]);
    if (m) {
      const left = m.at - nowOf(s);
      if (left > 0) rows.append(el("p", "muted", `Making ${itemName(m.out)}: ${Math.ceil(left / 60)} more hour${left > 60 ? "s" : ""}`));
      else { const b = el("button", "cozy", `Collect ${itemName(m.out)}`); b.onclick = () => { C.collect(id); box.hidden = true; G.paused = false; }; rows.append(b); }
      return;
    }
    const seen = new Set();
    for (const r of RECIPES.filter((x) => x.machine === kind)) {
      const key = r.out + list(r.in);
      if (seen.has(key)) continue; seen.add(key);
      const row = el("div", "row"), b = el("button", "cozy small", "Start");
      row.append(el("b", "", `${ITEMS[r.out].icon} ${itemName(r.out)}`), el("span", "muted", `${list(r.in)} · ${r.hours}h`));
      b.disabled = !has(r.in);
      b.onclick = () => { for (const [k, n] of Object.entries(r.in)) G.add(k, -n); s.machines[id] = { out: r.out, at: nowOf(s) + r.hours * 60 }; G.sfx("place"); G.vfx.burst("smoke", t.p.x, t.group.position.y + 1.4, t.p.z); box.hidden = true; G.paused = false; };
      row.append(b); rows.append(row);
    }
  };
  C.collect = (id) => {
    const m = s.machines[id], t = G.build.things.get(id);
    if (!m || m.at > nowOf(s)) return false;
    G.add(m.out, 1); (s.made ||= {})[m.out] = true; delete s.machines[id];
    G.sfx("pick"); if (t) { G.vfx.burst("spark", t.p.x, t.group.position.y + 1.5, t.p.z); G.vfx.item(`+1 ${ITEMS[m.out].icon}`, t.p.x, t.group.position.y + 2, t.p.z); }
    return true;
  };
  /** finished goods waiting: a carrying dinosaur brings them to your bag */
  C.waiting = () => Object.entries(s.machines).filter(([, m]) => m.at <= nowOf(s)).map(([id]) => { const t = G.build.things.get(Number(id)); return t ? { x: t.p.x, z: t.p.z, key: `m${id}`, run: () => C.collect(Number(id)) } : null; }).filter(Boolean);

  C.bin = () => {
    open("Shipping bin");
    rows.append(el("p", "muted", "Tilly collects everything overnight and pays the going rate."));
    const stock = Object.entries(s.inv).filter(([k, n]) => n > 0 && ITEMS[k]?.sell);
    for (const [k, n] of stock) {
      const r = el("div", "row"), one = el("button", "cozy small", "Ship 1"), all = el("button", "cozy small ghost", "All");
      r.append(el("b", "", `${ITEMS[k].icon} ${ITEMS[k].name} × ${n}`), el("em", "", `${priceOf(s, k, "bin")}`));
      const ship = (c) => { G.add(k, -c); s.bin[k] = (s.bin[k] || 0) + c; s.flags.shipped = true; G.sfx("buy"); C.bin(); };
      one.onclick = () => ship(1); all.onclick = () => ship(n);
      r.append(one, all); rows.append(r);
    }
    const waiting = Object.entries(s.bin || {});
    if (waiting.length) rows.append(el("h3", "", `In the bin: worth ${waiting.reduce((a, [k, n]) => a + priceOf(s, k, "bin") * n, 0)} shells`));
    if (!stock.length && !waiting.length) rows.append(el("p", "muted", "Nothing to ship yet."));
  };

  // your own stall: you choose what's on it and what you ask, and customers decide
  C.stall = () => {
    const st = s.stall ||= { items: {}, revenue: 0, sold: {} };
    open("Your market stall");
    rows.append(el("p", "muted", `Earned so far: ${st.revenue} shells. Ask too much and fewer people buy. Customers come in the morning.`));
    for (const [k, o] of Object.entries(st.items)) {
      const r = el("div", "row"), take = el("button", "cozy small ghost", "Take back"), slider = el("input");
      slider.type = "range"; Object.assign(slider, { min: 0.6, max: 2, step: 0.1, value: o.mark }); slider.oninput = () => { o.mark = +slider.value; cost.textContent = `${Math.round(ITEMS[k].sell * o.mark)}`; };
      const cost = el("em", "", `${Math.round(ITEMS[k].sell * o.mark)}`);
      r.append(el("b", "", `${ITEMS[k].icon} ${ITEMS[k].name} × ${o.n}`), slider, cost);
      take.onclick = () => { G.add(k, o.n); delete st.items[k]; C.showGoods(); C.stall(); };
      r.append(take); rows.append(r);
    }
    if (Object.keys(st.items).length < 6) {
      rows.append(el("h3", "", "Put out"));
      for (const [k, n] of Object.entries(s.inv).filter(([i, c]) => c > 0 && ITEMS[i]?.sell && !st.items[i]).slice(0, 12)) {
        const r = el("div", "row"), b = el("button", "cozy small", "All");
        r.append(el("b", "", `${ITEMS[k].icon} ${ITEMS[k].name} × ${n}`));
        b.onclick = () => { st.items[k] = { n, mark: 1 }; G.add(k, -n); G.sfx("place"); C.showGoods(); C.stall(); };
        r.append(b); rows.append(r);
      }
    }
    const best = Object.entries(st.sold).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${itemName(k)} (${n})`);
    if (best.length) rows.append(el("p", "muted", `Best sellers: ${best.join(", ")}`));
  };
  /** what's on show: your goods, set out along the counter of every stall that's yours */
  const stalls = () => [...(G.lore?.stalls || []).filter((q) => s.rented?.[q.i]), ...G.build.of("stall").map((t) => ({ o: t.group, L: null, x: t.p.x, z: t.p.z, ry: t.p.ry }))];
  C.showGoods = () => {
    const list = Object.keys(s.stall?.items || {});
    for (const q of stalls()) {
      q.o.userData.goods?.parent?.remove(q.o.userData.goods);
      const row = new THREE.Group();
      list.forEach((k, i) => { const h = makeGoods(k, ITEMS[k]); h.position.set((i - (list.length - 1) / 2) * 0.48, 1.06, 0.12); row.add(h); });
      q.o.add(row); q.o.userData.goods = row;
    }
  };
  /** a stall of yours with something on it, in a town where people can walk to it */
  C.openStall = () => (Object.keys(s.stall?.items || {}).length ? stalls().find((q) => q.L) : null);
  /** someone has walked up to your stall: they look it over and buy, if the price suits them */
  C.buyAt = (q) => {
    const st = s.stall, keys = Object.keys(st?.items || {});
    if (!keys.length) return;
    const k = keys[Math.floor(Math.random() * keys.length)], o = st.items[k], price = Math.round(ITEMS[k].sell * o.mark);
    if (Math.random() * o.mark ** 2 > 1.4) return popup("A customer looked, but it was too dear for them");
    s.money += price; st.revenue += price; st.sold[k] = (st.sold[k] || 0) + 1;
    if (--o.n <= 0) delete st.items[k];
    G.sfx("buy"); popup(`Sold ${itemName(k)} for ${price} shells`, "good");
    C.showGoods();
  };

  /** the animal pen: who lives in it. They stay inside, and walk about in there */
  C.pen = (t) => {
    open("Animal pen");
    rows.append(el("p", "muted", "Whoever you put here stays inside and wanders about. Let them out to send them back to work."));
    const row = (name, isIn, go) => { const r = el("div", "row"), b = el("button", `cozy small${isIn ? " ghost" : ""}`, isIn ? "Let out" : "Put in"); r.append(el("b", "", name)); b.onclick = () => { go(!isIn); G.sfx("place"); C.pen(t); }; r.append(b); rows.append(r); };
    for (const d of G.dinos.list) row(`${d.data.icon} ${d.r.name || d.data.forms[d.r.stage]}`, d.r.pen === t.p.id, (on) => { d.r.pen = on ? t.p.id : 0; d.goal = null; d.task = null; if (on) { if (s.partner === d.r.uid) s.partner = 0; d.r.stay = true; d.pos.set(t.p.x + (Math.random() - 0.5) * 10, d.pos.y, t.p.z + (Math.random() - 0.5) * 10); } });
    for (const a of G.animals || []) row(a.name, (s.penned ||= {})[a.key] === t.p.id, (on) => { if (on) { s.penned[a.key] = t.p.id; a.pos.set(t.p.x + (Math.random() - 0.5) * 10, a.pos.y, t.p.z + (Math.random() - 0.5) * 10); } else delete s.penned[a.key]; a.goal = null; });
    void ANIMALS;
  };

  /** the morning's trade: the bin pays out, and customers visit the stall */
  C.newDay = () => {
    let paid = 0, n = 0;
    for (const [k, c] of Object.entries(s.bin || {})) { paid += priceOf(s, k, "bin") * c; n += c; }
    s.bin = {};
    if (paid) { s.money += paid; popup(`Tilly paid ${paid} shells for ${n} item${n > 1 ? "s" : ""}`, "good"); }
    const st = s.stall;
    const rented = Object.keys(s.rented || {}).length;
    if (st && (G.build.of("stall").length || rented)) {
      let sold = 0;
      for (const [k, o] of Object.entries(st.items)) {
        const want = Math.round((1.5 + Math.random() * 4) * (1 + rented * 0.6) * demand(s, "stall", kindOf(ITEMS[k])) / o.mark ** 2), c = Math.min(o.n, want);
        if (c <= 0) continue;
        const take = Math.round(ITEMS[k].sell * o.mark) * c;
        sold += take; o.n -= c; st.sold[k] = (st.sold[k] || 0) + c;
        if (!o.n) delete st.items[k];
      }
      if (sold) { s.money += sold; st.revenue += sold; popup(`Your stall sold ${sold} shells' worth`, "good"); C.showGoods(); }
    }
  };
  return C;
}
export { CROPS };
