// ui.js - everything on top of the 3D view: party HUD, the left menu panels (backpack, equipment, character,
// skills, cards, quests, party, map, journal, log), subtitles with history, the action box and its turn state,
// toasts, dialogs, the card picker, shops, saves, settings and the campaign results screen.
import { escapeHtml as E } from "./world.js";

/** the companion's name: the character chosen in the assistant app (Vermeil, Pip, ...) */
export function companionName() {
  const g = window.__game;
  return g?.state?.party?.find((p) => p.uid === "vermeil")?.name || g?.look?.name || "Vermeil";
}

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
export { $, h };

/** "patk 8-14, hp 15-26" - an unappraised item's possible stats */
export const rangeText = (r) => Object.entries(r || {}).map(([k, [lo, hi]]) => `${k} ${lo}-${hi}`).join(", ");
const ICON = { weapon: "🗡", offhand: "🛡", armor: "🥋", accessory: "💍", consumable: "🧪", material: "💎", quest: "📜", currency: "🪙" };
const STAT_NAMES = { hp: "Max HP", mana: "Mana / Stamina", patk: "Physical attack", matk: "Magic attack", pdef: "Physical defence", mdef: "Magic defence",
  spd: "Speed", crit: "Critical %", acc: "Accuracy", eva: "Evasion" };
const RAR = { common: "#c9c9c9", uncommon: "#5fd36a", rare: "#4aa3ff", epic: "#b26bff", legendary: "#ffb02e", mythic: "#ff4fd8" };

export class UI {
  constructor(game) {
    this.g = game;
    this.open = null;
    this.subTimer = null;
    $("rail").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-p]");
      if (b) this.toggle(b.dataset.p);
    });
    $("drawerClose").onclick = () => this.toggle(null);
    $("btnHist").onclick = () => { $("history").hidden = !$("history").hidden; this.renderHistory(); };
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      const map = { b: "bag", e: null, c: "stats", k: "skills", q: "quests", p: "partyp", t: "pets", m: "map", j: "journal", l: "log" };
      const k = e.key.toLowerCase();
      if (map[k] !== undefined && map[k] && !$("hud").hidden) this.toggle(map[k]);
    });
  }

  get s() { return this.g.state; }

  // ---------------- HUD ----------------
  renderHud() {
    const s = this.s; if (!s) return;
    const cb = s.combat;
    $("party").replaceChildren(...s.party.map((p, i) => {
      const kind = p.kind === "player" ? "" : p.uid === "vermeil" ? "vermeil" : "ally";
      const pct = (a, b) => `${Math.max(0, Math.min(100, (a / Math.max(1, b)) * 100))}%`;
      const prev = (this._prevHp ||= {})[p.uid];
      this._prevHp[p.uid] = p.hp;
      const ghost = prev != null && prev > p.hp ? h("b", { class: "ghost", style: `width:${pct(prev, p.max_hp)}` }) : null;
      if (ghost) requestAnimationFrame(() => requestAnimationFrame(() => (ghost.style.width = pct(p.hp, p.max_hp))));
      return h("div", { class: `pc ${kind} ${i ? "small" : ""} ${!p.alive ? "down" : ""} ${cb?.waiting_for === p.uid ? "turn" : ""}`, "data-uid": p.uid, title: `${p.name} - ${p.cls_name || ""}` },
        this.face(p.uid, p.name),
        h("div", { class: "nm" }, p.name, h("small", {}, `Lv ${p.level} ${p.cls_name || ""}`)),
        h("div", { class: "bar hp" }, ghost, h("i", { style: `width:${pct(p.hp, p.max_hp)}` }), h("span", {}, `${p.hp}/${p.max_hp}`)),
        h("div", { class: "bar mp" }, h("i", { style: `width:${pct(p.mana, p.max_mana)}` }), h("span", {}, `${p.mana}/${p.max_mana}`)),
        i === 0 ? h("div", { class: "bar xp", title: `XP ${p.xp}/${p.xp_next}` }, h("i", { style: `width:${pct(p.xp, p.xp_next)}` })) : null,
        p.statuses.length ? h("div", { class: "st" }, ...p.statuses.map((x) => h("span", { title: `${x.name} (${x.turns})` }, x.icon))) : null,
      );
    }));
    if (this._gold != null && this._gold !== s.gold) { const g = $("gold"); g.classList.remove("bump"); void g.offsetWidth; g.classList.add("bump"); }
    this._gold = s.gold;
    $("gold").textContent = s.gold;
    const ck = s.clock;
    if (ck) { const c = $("clock"); c.textContent = `${ck.icon} ${ck.text}`; c.title = `Day ${ck.day} · ${ck.phase}${s.pets?.riding ? " · riding" : ""}`; c.classList.toggle("night", ck.phase === "night"); }
    $("locName").textContent = s.location?.name || "";
    const cur = s.quest.stages.find((x) => x.current);
    $("goal").textContent = cur ? cur.objective : "The adventure is complete";
    $("btnMute").textContent = s.settings.voice ? "🔊" : "🔇";
    // card notification dot
    const cardsBtn = $("rail").querySelector('[data-p="cards"]');
    cardsBtn.querySelector(".dot")?.remove();
    if (s.pending_cards.length) cardsBtn.append(h("span", { class: "dot" }));
    if (this.open) this.renderDrawer();
    this.renderInitiative();
  }

  renderInitiative() {
    const cb = this.s?.combat;
    const el = $("initiative");
    if (!cb) { el.hidden = true; return; }
    el.hidden = false;
    const byId = Object.fromEntries(cb.actors.map((a) => [a.uid, a]));
    el.replaceChildren(...cb.order.map((u) => {
      const a = byId[u]; if (!a) return null;
      const pic = this.g.portraits?.get(u);
      return h("div", { class: `ini ${a.team === "enemy" ? "enemy" : ""} ${u === (this.g.turnUid || cb.waiting_for) ? "now" : ""} ${a.alive ? "" : "dead"} ${pic ? "pic" : ""}`,
        title: a.name, "data-uid": u, style: pic ? `background-image:url(${pic})` : null }, pic ? "" : a.name[0]);
    }).filter(Boolean));
  }

  /** a party member's round portrait: their live 3D picture, or the first letter until it's ready */
  face(uid, name) {
    const pic = this.g.portraits?.get(uid);
    return h("div", { class: `face ${pic ? "pic" : ""}`, "data-uid": uid, style: pic ? `background-image:url(${pic})` : null }, pic ? "" : name[0]);
  }

  /** put fresh portraits into the circles that are already on screen (no full HUD redraw) */
  refreshFaces() {
    for (const el of document.querySelectorAll(".pc .face[data-uid], .ini[data-uid]")) {
      const pic = this.g.portraits?.get(el.dataset.uid);
      if (!pic) continue;
      if (!el.classList.contains("pic")) { el.classList.add("pic"); el.textContent = ""; }
      el.style.backgroundImage = `url(${pic})`;
    }
  }

  setTurn(text, kind = "") {
    const t = $("turnChip");
    t.textContent = text;
    t.className = `turn ${kind}`;
  }

  // quick action chips under the subtitles
  setQuick(list) {
    $("quick").replaceChildren(...list.map((q) => h("button", { class: `chip ${q.el ? "el-" + q.el : ""} ${q.off ? "off" : ""}`, title: q.title || "", disabled: q.off || false, onclick: q.fn, type: "button" }, q.label)));
  }

  // ---------------- subtitles ----------------
  /** a line of text. `hold: true` lines (someone speaking) stay until el.release(ms) is called - so a box never
      closes before its voice and its text have finished; other lines stay at least long enough to read. */
  subtitle(speaker, name, text, { mood, keep = 9000, hold = false } = {}) {
    const box = $("subs");
    const kind = speaker === "dm" ? "dm" : speaker === "vermeil" ? "vermeil" : speaker === "sys" ? "sys" : speaker === "player" ? "player" : "npc";
    const el = h("div", { class: `sub ${kind}` }, kind === "sys" ? null : h("span", { class: "who" }, name || speaker), h("div", { class: "say" }, text));
    box.append(el);
    let timers = [];
    const close = (ms) => {
      timers.forEach(clearTimeout);
      ms = Math.max(ms, (el._revealEnd || 0) - performance.now() + 1200);   // the last word must have appeared (and been read)
      timers = [setTimeout(() => el.classList.add("out"), Math.max(0, ms - 350)), setTimeout(() => el.remove(), ms)];
    };
    el.held = hold;
    el.release = (ms = 2500) => { el.held = false; close(ms); };
    if (!hold) close(Math.max(keep, 1500 + String(text || "").length * 45));
    // too many lines: drop the oldest one that isn't being spoken right now
    while (box.children.length > 4) {
      const old = [...box.children].find((c) => !c.held && c !== el);
      if (!old) break;
      old.remove();
    }
    if (!$("history").hidden) this.renderHistory();
    return el;
  }

  /** words appear in time with the voice */
  reveal(el, seconds) {
    const say = el?.querySelector(".say"); if (!say || say.dataset.rev) return;
    say.dataset.rev = "1";
    el._revealEnd = performance.now() + seconds * 1000;
    const words = say.textContent.split(/(\s+)/);
    const n = words.filter((w) => w.trim()).length || 1;
    let i = 0;
    say.replaceChildren(...words.map((w) => { if (!w.trim()) return document.createTextNode(w); const sp = h("span", { class: "w" }, w); sp.style.animationDelay = `${(i++ / n) * seconds * 0.92}s`; return sp; }));
  }

  /** shake / glow a party member's card when they're hurt or healed */
  flashMember(uid, kind) {
    const el = $("party").querySelector(`[data-uid="${uid}"]`); if (!el) return;
    el.classList.remove("hurt", "healed"); void el.offsetWidth; el.classList.add(kind);
  }

  renderHistory() {
    const hist = this.s?.history || [];
    const names = { dm: "Dungeon Master", vermeil: companionName() };
    $("history").replaceChildren(...hist.map((x) => h("div", { class: `hist-line ${x.who === "dm" ? "dm" : x.who === "vermeil" ? "vermeil" : x.who === "player" ? "player" : "npc"}` },
      h("span", { class: "who" }, x.name || names[x.who] || x.who), h("span", { class: "say" }, x.text))));
    $("history").scrollTop = 1e9;
  }

  toast(text, kind = "") {
    const el = h("div", { class: `toast ${kind}` }, text);
    $("toasts").append(el);
    while ($("toasts").children.length > 5) $("toasts").firstChild.remove();
    setTimeout(() => el.classList.add("out"), 3900);
    setTimeout(() => el.remove(), 4250);
  }

  // ---------------- drawer panels ----------------
  toggle(p) {
    this.g.audio?.sfx(this.open === p || !p ? "close" : "open");
    this.open = this.open === p ? null : p;
    $("drawer").hidden = !this.open;
    for (const b of $("rail").querySelectorAll("button")) b.classList.toggle("on", b.dataset.p === this.open);
    if (this.open) this.renderDrawer();
  }

  renderDrawer() {
    const s = this.s; if (!s) return;
    const titles = { bag: "Backpack", equip: "Equipment", stats: "Character", skills: "Skills & abilities", cards: "Upgrade cards", quests: "Quests",
      partyp: "Party", pets: "Pets & mounts", map: "Map", journal: "Journal", log: "Campaign log" };
    $("drawerTitle").textContent = titles[this.open];
    const body = $("drawerBody");
    const fn = { bag: () => this.bag(), equip: () => this.equipPanel(), stats: () => this.statsPanel(), skills: () => this.skills(), cards: () => this.cardsPanel(),
      quests: () => this.quests(), partyp: () => this.partyPanel(), pets: () => this.petsPanel(), map: () => this.mapPanel(), journal: () => this.journal(), log: () => this.logPanel() }[this.open];
    body.replaceChildren(...[].concat(fn()));
  }

  member() {
    const s = this.s;
    this._who = s.party.find((p) => p.uid === this._who?.uid) || s.party[0];
    return this._who;
  }

  memberTabs(onPick) {
    return h("div", { class: "tabs" }, ...this.s.party.map((p) => h("button", { class: p.uid === this.member().uid ? "on" : "", onclick: () => { this._who = p; onPick(); } }, p.name)));
  }

  itemRow(it, actions) {
    const bonus = it.appraised === false ? `? unappraised (${rangeText(it.ranges)})`
      : Object.entries(it.bonus || {}).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(", ");
    const sub = [it.dice ? `${it.dice} dmg` : null, bonus || null, it.grade ? `grade ${it.grade}` : null, it.element ? `${it.element}` : null, it.equipped_by ? `worn by ${it.equipped_by}` : null,
      it.use ? useText(it.use) : null].filter(Boolean).join(" · ");
    return h("div", { class: "item", style: `--rar:${RAR[it.rarity] || "#888"}`, title: `${it.name} (${it.rarity})` },
      h("div", { class: "ic" }, ICON[it.slot] || "•"),
      h("div", {}, h("div", { class: "nm" }, it.name + (it.qty > 1 ? ` ×${it.qty}` : "")), h("div", { class: "isub" }, sub || it.slot)),
      h("div", { class: "acts" }, ...actions));
  }

  bag() {
    const s = this.s, g = this.g;
    const inv = s.inventory || [];
    const groups = [["Equipment", (i) => ["weapon", "offhand", "armor", "accessory"].includes(i.slot)], ["Potions & consumables", (i) => i.slot === "consumable"],
      ["Quest items", (i) => i.slot === "quest"], ["Materials", (i) => i.slot === "material"]];
    const out = [h("p", { class: "muted" }, `${inv.length} kinds of items · ${s.gold} gold`)];
    for (const [title, f] of groups) {
      const list = inv.filter(f);
      if (!list.length) continue;
      out.push(h("div", { class: "sect" }, title));
      out.push(h("div", { class: "items" }, ...list.map((it) => this.itemRow(it, [
        it.slot === "consumable" && !it.use?.damage && !it.use?.flee_bonus ? h("button", { class: "small", onclick: () => g.useItem(it) }, "Use") : null,
        ["weapon", "offhand", "armor", "accessory"].includes(it.slot) ? h("button", { class: "small", onclick: () => g.pickWearer(it) }, it.equipped_by ? "Move" : "Equip") : null,
        !it.quest ? h("button", { class: "small danger", title: "Throw away", onclick: () => g.discard(it) }, "✕") : null,
      ]))));
    }
    if (!inv.length) out.push(h("p", { class: "muted" }, "Your backpack is empty. Defeated monsters and chests drop loot."));
    return out;
  }

  equipPanel() {
    const s = this.s, g = this.g, m = this.member();
    const inv = s.inventory || [];
    const out = [this.memberTabs(() => this.renderDrawer())];
    for (const slot of ["weapon", "offhand", "armor", "accessory"]) {
      const it = inv.find((i) => i.uid === m.equipment?.[slot]);
      out.push(h("div", { class: "sect" }, { weapon: "Weapon", offhand: "Off-hand", armor: "Armour", accessory: "Accessory" }[slot]));
      out.push(it ? this.itemRow(it, [h("button", { class: "small", onclick: () => g.unequip(m.uid, slot) }, "Take off")]) : h("p", { class: "muted" }, "Empty"));
      const options = inv.filter((i) => i.slot === slot && i.uid !== it?.uid);
      for (const o of options) out.push(this.itemRow(o, [h("button", { class: "small", onclick: () => g.equip(m.uid, o.uid) }, "Wear"),
        h("button", { class: "small", title: "Compare with what's worn", onclick: async (e) => { const d = await g.compare(m.uid, o.uid); e.target.textContent = Object.entries(d).map(([k, v]) => `${v > 0 ? "+" : ""}${v} ${k}`).join(" ") || "same"; } }, "Compare")]));
    }
    return out;
  }

  statsPanel() {
    const m = this.member();
    const out = [this.memberTabs(() => this.renderDrawer()),
      h("p", {}, h("b", {}, `${m.name}`), ` — level ${m.level} ${m.species_name || ""} ${m.cls_name || ""}`),
      h("div", { class: "bar xp", title: `XP` }, h("i", { style: `width:${Math.min(100, (m.xp / Math.max(1, m.xp_next)) * 100)}%` })),
      h("p", { class: "muted" }, `XP ${m.xp} / ${m.xp_next} to the next level`),
      h("div", { class: "statgrid" }, ...Object.entries(STAT_NAMES).map(([k, n]) => h("div", { title: statHelp(k) }, n, h("b", {}, k === "hp" ? `${m.hp}/${m.stats.hp}` : k === "mana" ? `${m.mana}/${m.stats.mana}` : m.stats[k])))),
      h("div", { class: "sect" }, "How the dice work"),
      h("p", { class: "muted" }, "To hit: d20 + accuracy must reach 10 + the target's evasion. A natural 20 is a critical hit (double damage), a natural 1 always misses. Damage = dice + attack − half the target's defence."),
    ];
    if (m.statuses.length) out.push(h("div", { class: "sect" }, "Effects"), ...m.statuses.map((x) => h("p", {}, `${x.icon} ${x.name} — ${x.turns} turn(s)`)));
    return out;
  }

  skills() {
    const m = this.member(), C = this.g.info;
    const cls = C.classes.find((c) => c.id === m.cls);
    return [this.memberTabs(() => this.renderDrawer()), h("p", { class: "muted" }, "In battle, click a skill below the subtitles or just type it — e.g. “cast fireball at the goblin”."),
      ...m.abilities.map((a) => { const ab = this.g.abilityInfo(a); return h("div", { class: "ability" }, h("b", {}, ab.name), ab.cost ? ` · ${ab.cost} ${m.resource}` : "", ab.element ? ` · ${ab.element}` : "", h("small", {}, ab.desc || "")); }),
      cls ? h("div", { class: "sect" }, "Learned later") : null,
      ...(this.g.classAbilities(m.cls) || []).filter(([a]) => !m.abilities.includes(a)).map(([a, lvl]) => { const ab = this.g.abilityInfo(a); return h("div", { class: "ability locked" }, h("b", {}, ab.name), ` · level ${lvl}`, h("small", {}, ab.desc || "")); }),
    ];
  }

  cardsPanel() {
    const s = this.s;
    const out = [];
    if (s.pending_cards.length) out.push(h("button", { class: "big", onclick: () => this.g.showCards() }, `Choose your upgrade (${s.pending_cards.length})`));
    out.push(h("div", { class: "sect" }, "Active cards"));
    for (const p of s.party) {
      if (!p.cards?.length) continue;
      const counts = {};
      p.cards.forEach((c) => (counts[c] = (counts[c] || 0) + 1));
      out.push(h("p", {}, h("b", {}, p.name)), ...Object.entries(counts).map(([c, n]) => { const card = this.g.cardInfo(c); return h("div", { class: "ability", style: `border-left:4px solid ${RAR[card.rarity]}` }, h("b", {}, card.name + (n > 1 ? ` ×${n}` : "")), h("small", {}, card.desc)); }));
    }
    out.push(h("div", { class: "sect" }, "Every card you've chosen, in order"));
    out.push(h("div", { class: "timeline" }, ...(s.card_history || []).map((c, i) => h("div", { style: `--rar:${RAR[c.rarity]}` }, `${i + 1}. ${c.name} → ${c.target}`, h("small", { class: "muted" }, `  (${c.reason})`)))));
    if (!(s.card_history || []).length) out.push(h("p", { class: "muted" }, "Level up, finish quest steps and beat bosses to earn upgrade cards."));
    return out;
  }

  quests() {
    const q = this.s.quest;
    return [h("p", {}, h("b", {}, q.title || "Your quest")), h("p", { class: "journal muted" }, q.premise),
      h("div", { class: "sect" }, "Main quest"),
      ...q.stages.map((st) => h("div", { class: `quest ${st.done ? "done" : ""} ${st.current ? "cur" : ""}` }, st.objective, h("small", { class: "muted" }, st.location !== "???" ? `  — ${st.location}` : ""))),
      h("div", { class: "sect" }, "Side quests"),
      ...(q.side.length ? q.side.map((sq) => h("div", { class: `quest ${sq.done ? "done" : ""}` }, sq.objective, h("small", { class: "muted" }, ` — from ${sq.giver_name}, reward ${sq.reward_gold} gold`))) : [h("p", { class: "muted" }, "Talk to people - some of them need help.")]),
    ];
  }

  /** pets you tamed: take one along (it helps after wins), ride the big ones, rename or let them go */
  petsPanel() {
    const g = this.g, P = this.s.pets || { pets: [] };
    if (!P.pets.length) return [h("p", { class: "muted" }, "No pets yet. After a fight, a tired beast sometimes stays behind. Feed it (trail rations, bones, slime gel, hides, or best of all heartfruit) and it may come with you."),
      h("p", { class: "muted" }, "Wolves, boars, raptors and dinos can be ridden: faster travel and fewer ambushes. Slimes heal, flyers find gold.")];
    return [h("p", { class: "muted" }, `${P.pets.length}/${P.max} pets. The one you take along helps after every win and grows closer to you.`),
      ...P.pets.map((p) => h("div", { class: `ability ${p.id === P.active ? "on" : ""}` },
        h("b", {}, `${p.id === P.active ? "🐾 " : ""}${p.name}`), ` — Lv ${p.level} · bond ${p.bond || 0}/100`,
        h("small", {}, (P.perks || {})[p.perk] || p.perk),
        h("div", { class: "btns" },
          p.id === P.active ? h("button", { class: "small", onclick: () => g.petCall("pet_set", null) }, "Leave at camp")
            : h("button", { class: "small", onclick: () => g.petCall("pet_set", p.id) }, "Take along"),
          p.id === P.active && p.perk === "ride" ? h("button", { class: "small", onclick: () => g.petCall("pet_ride", !P.riding) }, P.riding ? "Get off" : "Ride") : null,
          h("button", { class: "small", onclick: () => { const n = prompt("A new name?", p.name); if (n) g.petCall("pet_rename", p.id, n); } }, "Rename"),
          h("button", { class: "small danger", onclick: () => { if (confirm(`Let ${p.name} go? It won't come back.`)) g.petCall("pet_release", p.id); } }, "Let go")))),
    ];
  }

  partyPanel() {
    const s = this.s, g = this.g;
    return [h("p", { class: "muted" }, "Up to 4 can travel together. Allies you dismiss wait in the last town you visited."),
      ...s.party.map((p) => h("div", { class: "ability" }, h("b", {}, `${p.name}`), ` — Lv ${p.level} ${p.species_name || ""} ${p.cls_name || ""}`,
        h("small", {}, `HP ${p.hp}/${p.max_hp} · ${p.kind === "player" ? "you" : p.uid === "vermeil" ? "your companion" : "recruited ally"}`),
        p.kind === "ally" ? h("button", { class: "small danger", onclick: () => g.dismiss(p) }, "Part ways") : null)),
      h("div", { class: "sect" }, `${companionName()} in battle`),
      selectEl(["auto", "tactical", "advice", "direct"], s.settings.vermeil_control, { auto: "Fights on her own", tactical: "Fights + gives tactics", advice: "Only gives advice", direct: "You control her" }, (v) => g.setSetting({ vermeil_control: v })),
      h("div", { class: "sect" }, "Allies in battle"),
      selectEl(["auto", "direct"], s.settings.ally_control, { auto: "Fight on their own", direct: "You control them" }, (v) => g.setSetting({ ally_control: v })),
    ];
  }

  mapPanel() {
    const map = this.s.map, g = this.g;
    const box = h("div", { class: "mapbox" });
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    const byId = Object.fromEntries(map.map((m) => [m.id, m]));
    for (const m of map) for (const l of m.links) {
      const o = byId[l]; if (!o || l < m.id) continue;
      const line = document.createElementNS(ns, "line");
      Object.entries({ x1: m.x, y1: m.y, x2: o.x, y2: o.y, stroke: "#d8c8a0", "stroke-width": 0.6, "stroke-dasharray": m.visited && o.visited ? "" : "1.5 1.5", opacity: 0.7 }).forEach(([k, v]) => line.setAttribute(k, v));
      svg.append(line);
    }
    for (const m of map) {
      const c = document.createElementNS(ns, "circle");
      Object.entries({ cx: m.x, cy: m.y, r: m.here ? 3.2 : 2.4, fill: m.here ? "#e0475b" : m.locked ? "#3a3f4a" : m.safe ? "#7fd36b" : m.visited ? "#5fe3ff" : "#556", stroke: m.objective ? "#e9b949" : "#0c1f26", "stroke-width": m.objective ? 1 : 0.5 }).forEach(([k, v]) => c.setAttribute(k, v));
      const here = this.s.location_id;
      const near = map.find((x) => x.id === here)?.links.includes(m.id);
      if (near) { c.style.cursor = "pointer"; c.addEventListener("click", () => m.locked ? this.toast(m.locked, "bad") : g.travel(m.id)); }
      const t = document.createElementNS(ns, "title"); t.textContent = `${m.name}${m.level ? " (danger " + m.level + ")" : ""}${m.locked ? " - sealed: " + m.locked : near ? " - click to travel" : ""}`; c.append(t);
      svg.append(c);
      // little icons above the dot: quest, boss lair, shop, wandering trader, sealed
      const icons = [m.objective ? "❗" : null, m.boss ? "💀" : null, m.shop ? "🛒" : null, m.trader ? "🪙" : null, m.locked ? "🔒" : null].filter(Boolean);
      if (icons.length) {
        const ic = document.createElementNS(ns, "text");
        Object.entries({ x: m.x, y: m.y + 1.1, "text-anchor": "middle", "font-size": 2.6 }).forEach(([k, v]) => ic.setAttribute(k, v));
        ic.textContent = icons.join("");
        ic.setAttribute("transform", `translate(${(m.x > 50 ? -1 : 1) * (2.4 + icons.length * 1.6)} -4.2)`);
        svg.append(ic);
      }
      // names never sit on top of each other: if a neighbour is close and higher, this name goes underneath
      const crowded = map.some((o) => o !== m && Math.abs(o.x - m.x) < 22 && o.y < m.y && m.y - o.y < 9);
      const tx = document.createElementNS(ns, "text");
      Object.entries({ x: Math.max(8, Math.min(92, m.x)), y: crowded ? m.y + 6 : m.y - 4, "text-anchor": "middle", "font-size": 2.7, fill: m.locked ? "#9aa3ad" : "#f3ebd8", "font-weight": 800,
        stroke: "#0c1f26", "stroke-width": 0.5, "paint-order": "stroke" }).forEach(([k, v]) => tx.setAttribute(k, v));
      tx.textContent = m.name;
      svg.append(tx);
    }
    box.append(svg);
    return [box, h("p", { class: "muted" }, "Red: you · green: towns · gold ring ❗: your quest · 🛒 shop · 🪙 wandering trader · 💀 the final lair · 🔒 sealed until the quest is done. Follow the road; where it forks, pick a way. You can always walk back to a town."),
      ];
  }

  journal() {
    const hist = (this.s.history || []).filter((x) => x.who === "dm");
    return [h("div", { class: "journal" }, ...(this.s.world ? [h("p", {}, h("b", {}, `${this.s.world.genre_name}${this.s.world.mix_name ? " + " + this.s.world.mix_name : ""}`)), h("p", {}, this.s.world.premise)] : []),
      ...hist.slice(-30).map((x) => h("p", {}, x.text)))];
  }

  logPanel() {
    const hist = this.s.history || [];
    return hist.slice(-80).map((x) => h("div", { class: "log-line" }, h("b", {}, (x.name || x.who) + ": "), x.text));
  }

  // ---------------- modals ----------------
  dialog(title, body, buttons) {
    const box = $("dialogBox");
    box.replaceChildren(h("h2", {}, title), ...[].concat(body), h("div", { class: "modal-foot" }, ...buttons.map((b) => h("button", { class: b.primary ? "big" : "ghost", onclick: () => { if (!b.keep) $("dialog").hidden = true; b.fn?.(); } }, b.label))));
    $("dialog").hidden = false;
  }

  closeDialog() { $("dialog").hidden = true; }

  showCardPick(offer, onPick) {
    $("cardReason").textContent = offer.reason ? `${offer.reason}: choose an upgrade` : "Choose an upgrade";
    const who = this.s.party.find((p) => p.uid === offer.target);
    $("cardFor").textContent = who ? `For ${who.name}` : "";
    $("cardChoices").replaceChildren(...offer.cards.map((c) => {
      const art = h("div", { class: "art" });
      this.g.cardArt(c.art, art);
      return h("button", { class: c.rarity === "mythic" ? "card mythic" : "card", style: `--rar:${RAR[c.rarity]}`, onmouseenter: () => this.g.audio?.sfx("hover"), onclick: (ev) => { ev.currentTarget.classList.add("chosen"); this.g.audio?.sfx("levelup"); setTimeout(() => onPick(c.id), 450); } }, art, h("span", { class: "cn" }, c.name), h("span", { class: "cr" }, c.category && c.category !== c.rarity ? `${c.rarity} · ${c.category}` : c.rarity), h("span", { class: "cd" }, c.desc));
    }));
    $("cardPick").hidden = false;
  }

  renderResults(r, { onNew, onAssistant, onExport }) {
    const t = r.play_time_seconds;
    const stat = (n, l) => h("div", {}, h("b", {}, n), h("span", {}, l));
    $("resultsBody").replaceChildren(...[
      h("p", { class: "title-small" }, r.outcome),
      h("h1", {}, r.title || "The adventure"),
      h("p", { class: "muted" }, `${r.genre}${r.mix ? " + " + r.mix : ""} — ${r.premise}`),
      r.ending ? h("div", { class: "ending" }, h("p", {}, r.ending.text), r.ending.vermeil ? h("p", {}, `${companionName()}: “${r.ending.vermeil}”`) : null, r.ending.epilogue ? h("p", { class: "muted" }, r.ending.epilogue) : null) : null,
      h("div", { class: "res-grid" },
        stat(`${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`, "play time"), stat(`${r.start_level} → ${r.final_level}`, "level"),
        stat(r.monsters_defeated, "monsters defeated"), stat(r.bosses_defeated.length, "bosses defeated"), stat(r.quests_completed, "quest steps"),
        stat(r.side_quests_completed, "side quests"), stat(r.xp_earned, "XP earned"), stat(r.gold_earned, "gold earned"),
        stat(r.combat.battles_won, "battles won"), stat(r.combat.crits, "critical hits"), stat(r.combat.damage_dealt, "damage dealt"), stat(r.combat.treasures, "chests opened")),
      h("h2", {}, "Upgrade cards, first to last"),
      h("div", { class: "timeline" }, ...r.cards.map((c, i) => h("div", { style: `--rar:${RAR[c.rarity]}` }, `${i + 1}. ${c.name} (${c.rarity}) → ${c.target}`, h("span", { class: "muted" }, ` — ${c.reason}`)))),
      h("h2", {}, "Treasures"), h("p", {}, r.major_items.map((m) => m.name).join(", ") || "—"),
      h("h2", {}, "Abilities"), h("p", {}, r.abilities.join(", ")),
      h("h2", {}, "Choices that mattered"), h("div", { class: "timeline" }, ...r.choices.map((c) => h("div", {}, c))),
      h("h2", {}, "Final party"),
      h("p", {}, `${r.player.name} — ${r.player.species} ${r.player.class}: ${Object.entries(r.player.stats).map(([k, v]) => `${k} ${v}`).join(", ")}`),
      r.vermeil ? h("p", {}, `${r.vermeil.name || companionName()} — level ${r.vermeil.level} ${r.vermeil.class}: ${Object.entries(r.vermeil.stats).map(([k, v]) => `${k} ${v}`).join(", ")}`) : null,
      r.allies.length ? h("p", {}, `Allies: ${r.allies.map((a) => `${a.name} (Lv ${a.level})`).join(", ")}`) : null,
      h("div", { class: "row", style: "margin-top:24px; gap:10px; flex-wrap:wrap" },
        h("button", { class: "big", onclick: onNew }, "Start a new adventure"), h("button", { class: "ghost", onclick: () => onExport("text") }, "Export summary (text)"),
        h("button", { class: "ghost", onclick: () => onExport("json") }, "Export summary (JSON)"), h("button", { class: "ghost", onclick: onAssistant }, "Return to Vermeil"))].filter(Boolean));
    $("results").hidden = false;
  }
}

function selectEl(values, cur, labels, onChange) {
  const s = h("select", { onchange: (e) => onChange(e.target.value) }, ...values.map((v) => h("option", { value: v, selected: v === cur ? "" : null }, labels[v])));
  s.value = cur;
  return s;
}

function useText(u) {
  if (u.heal) return `heals ${u.heal}`;
  if (u.mana) return `restores ${u.mana} mana`;
  if (u.heal_pct) return "full heal";
  if (u.revive_pct) return "revives a fallen ally";
  if (u.damage) return `${u.damage} ${u.element || ""} damage to all enemies`;
  if (u.cleanse) return "cures poison & bad effects";
  if (u.flee_bonus) return "helps you escape a fight";
  if (u.perm) return "permanently " + Object.entries(u.perm).map(([k, v]) => `+${v} ${k}`).join(", ");
  if (u.card) return "teaches a new upgrade card";
  return "";
}

function statHelp(k) {
  return { hp: "How much damage you can take", mana: "Spent on abilities", patk: "Adds to weapon damage", matk: "Adds to spells and healing", pdef: "Half of it is taken off physical hits",
    mdef: "Half of it is taken off spells", spd: "Who acts first (initiative) and escaping", crit: "Chance a hit is critical", acc: "Added to your d20 to hit", eva: "Makes you harder to hit" }[k];
}
