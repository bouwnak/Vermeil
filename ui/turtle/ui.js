// ui.js - what you read and press: talking, the HUD, the journal, shops and the character maker. Talking has no recorded or generated voice:
// letters appear one at a time with a blip each, and you click (or press E) to go on, with a little row of dots saying there's more.
import { ARCS, BRIDGE, CATALOG, CROPS, DINOS, EVOLVE, FERRY, FESTIVALS, FISH, ITEMS, MACHINES, NPCS, RECIPES, RODS, SEASONS, SHOPS, SKILLS, SKINS, STORY, TIERS, TOOLS, TOOL_COST, TOOL_UP, WEATHER, itemName } from "./data.js";
import { blip, play, levels, setLevels } from "./audio.js";
import { clockText, groundAt, seasonOf } from "./world.js";
import { evolveNeeds, levelOf, nameOf, readyToEvolve, roomFor, skillsOf } from "./dinos.js";
import { demand, festivalOf, priceOf } from "./craft.js";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const VOICE = { Vermeil: 1.25, Wren: 1.12, Bram: 0.72, "Old Moss": 0.92, Sprig: 1.5 };

// ---------------- talking ----------------
export function makeTalk(G) {
  const box = $("talk"), name = $("talkName"), text = $("talkText"), dots = $("talkDots"), opts = $("talkOptions");
  let lines = [], full = "", shown = 0, timer = 0, speed = 1, done = null, options = null, who = "";
  const typing = () => shown < full.length;
  const next = () => {
    if (typing()) { shown = full.length; text.textContent = full; finish(); return; }
    if (options && !lines.length) return;
    if (!lines.length) { box.hidden = true; G.talking = false; G.talkingTo = null; const d = done; done = null; d?.(); return; }
    full = lines.shift(); shown = 0; text.textContent = ""; dots.hidden = true; opts.hidden = true; opts.replaceChildren();
    clearInterval(timer);
    timer = setInterval(() => {
      if (shown >= full.length) return finish();
      const c = full[shown++];
      text.textContent = full.slice(0, shown);
      if (shown % 2) blip(c, VOICE[who] || 1);
    }, 34 / speed);
  };
  function finish() {
    clearInterval(timer);
    if (options && !lines.length) {
      opts.replaceChildren(...options.map(([label, fn]) => { const b = el("button", "t-opt", label); b.onclick = (e) => { e.stopPropagation(); opts.hidden = true; const go = fn; options = null; box.hidden = true; G.talking = false; go?.(); if (box.hidden) G.talkingTo = null; }; return b; }));
      opts.hidden = false;
    } else dots.hidden = false;
  }
  box.onclick = next;
  return {
    say(speaker, list, { then = null, choose = null } = {}) {
      who = speaker; name.textContent = speaker; lines = [].concat(list); done = then; options = choose; G.talking = true; box.hidden = false; full = ""; shown = 0; next();
    },
    next, setSpeed(v) { speed = v; }, active: () => !box.hidden,
  };
}

// ---------------- HUD ----------------
export function makeHud(G) {
  const bar = $("toolbar");
  TOOLS.forEach((t, i) => {
    const b = el("button", "tool"); b.title = `${t.name}: ${t.hint}`;
    b.append(el("span", "tool-ic", t.icon), el("small", "tool-n", String(i + 1)));
    b.onclick = () => G.pickTool(i);
    bar.append(b);
  });
  return {
    tick() {
      const s = G.s, sn = seasonOf(s.day);
      $("clock").textContent = clockText(s.minute);
      $("dayInfo").textContent = `${sn.name} ${sn.day}`;
      $("weatherIc").textContent = WEATHER[s.weather]?.icon || "☀";
      $("money").textContent = s.money;
      $("stamina").style.width = `${G.player.stamina}%`;
      const goal = STORY.find((q) => !q.done(s)), P = G.player;
      $("goal").textContent = goal?.text || "";
      $("mode").hidden = !P.mode && !P.sailing;
      $("mode").textContent = P.sailing ? "⛵ Sailing · E go ashore near land" : P.mode === "fly" ? "Flying · Space up · C down" : P.mode === "swim" ? "Swimming" : "";
      [...bar.children].forEach((b, i) => b.classList.toggle("on", TOOLS[i] === G.tool));
      const seed = G.tool?.id === "seeds" ? (G.seedChoice() ? `${ITEMS[G.seedChoice()].name} × ${s.inv[G.seedChoice()]}` : "No seeds: buy some in Willowmere") : "";
      $("toolInfo").textContent = seed || G.tool?.name || "";
    },
    prompt(text) { const p = $("prompt"); p.hidden = !text; if (text) p.textContent = text; },
  };
}

export function popup(text, kind = "") {
  if ([...$("pops").children].some((c) => c.textContent === text)) return;
  const p = el("div", `pop ${kind}`, text);
  $("pops").append(p);
  setTimeout(() => p.remove(), 2600);
}

// ---------------- the journal ----------------
const TABS = [["today", "☀", "Today"], ["story", "📜", "Story"], ["bag", "🎒", "Bag"], ["dinos", "🦕", "Dinos"], ["crops", "🌾", "Crops"], ["fish", "🐟", "Fish"], ["recipes", "🍲", "Recipes"], ["people", "🧑‍🌾", "People"], ["map", "🗺", "Map"], ["settings", "⚙", "Settings"]];
export function makeBook(G) {
  const book = $("book"), tabs = $("bookTabs"), page = $("bookPage");
  let open = "today";
  const list = (rows) => { const u = el("div", "rows"); for (const [a, b, c] of rows) { const r = el("div", "row"); r.append(el("b", "", a), el("span", "muted", b || "")); if (c != null) r.append(el("em", "", String(c))); u.append(r); } return u; };
  const heading = (h) => el("h2", "", h);
  const button = (label, fn, cls = "cozy small") => { const b = el("button", cls, label); b.onclick = fn; return b; };
  const pages = {
    today() {
      const s = G.s, sn = seasonOf(s.day), plots = Object.values(s.plots), f = festivalOf(s), tips = STORY.filter((q) => !q.done(s)).slice(0, 2);
      page.append(heading(`${sn.name}, day ${sn.day}`), list([["Time", clockText(s.minute)], ["Weather", s.weather], ["Shells", "", s.money], ["Plots", `${plots.filter((p) => p.crop).length} planted, ${plots.filter((p) => p.crop && !p.wet).length} need water`], ["Willowmere", !s.flags.bridgeFixed ? "Its drawbridge needs mending first" : s.minute / 60 >= BRIDGE.open && s.minute / 60 < BRIDGE.close ? "Moored by your bridge" : "Out at sea, back around 9:00"]]));
      if (f) page.append(el("h3", "", `Today: ${f.name}`), el("p", "muted", f.text));
      const next = FESTIVALS.map((x) => ({ ...x, at: x.season * 14 + x.day })).filter((x) => x.at > sn.index * 14 + sn.day)[0];
      if (next) page.append(el("p", "muted", `Next festival: ${next.name}, ${SEASONS[next.season]} ${next.day}`));
      page.append(el("h3", "", "What's next"), list(tips.map((q) => [q.text])));
    },
    story() {
      const s = G.s, cur = STORY.find((q) => !q.done(s));
      page.append(heading("The story so far"));
      ARCS.forEach((a, i) => {
        const steps = STORY.filter((q) => q.arc === i && q.id !== "free"), done = steps.filter((q) => q.done(s));
        if (cur && i > cur.arc) return;
        page.append(el("h3", "", `${i + 1}. ${a}`), list(steps.filter((q) => q.done(s) || q === cur).map((q) => [(q.done(s) ? "✓ " : "") + q.text])));
        void done;
      });
      const c = Object.keys(s.carved || {}).length;
      page.append(el("p", "muted", `Carvings found: ${c} of 5`));
    },
    bag() {
      const rows = Object.entries(G.s.inv).filter(([, n]) => n > 0).map(([k, n]) => [`${ITEMS[k]?.icon || ""} ${ITEMS[k]?.name || k}`, ITEMS[k]?.mat ? "Material" : ITEMS[k]?.seed ? "Seed" : "", n]);
      page.append(heading("Bag"), rows.length ? list(rows) : el("p", "muted", "Nothing yet."));
      const t = G.s.tools || {};
      page.append(el("h3", "", "Tools"), list(Object.keys(TOOL_UP).map((k) => [TOOLS.find((x) => x.id === k).name, TIERS[t[k] || 0]])));
    },
    dinos() {
      const s = G.s;
      page.append(heading(`Dinosaurs: ${s.dinos.length} of ${roomFor(s)}`), el("p", "muted", "Pick how much each one should care about each job. They choose by that, by distance and by how tired they are. Tell one to stay on the farm and it gets to work."));
      for (const d of G.dinos.list) {
        const r = d.r, D = d.data, card = el("div", "dino-card"), lv = levelOf(r), need = EVOLVE[r.stage + 1], bar = el("div", "meter"), fill = el("i");
        fill.style.width = `${need ? Math.min(100, lv / need.level * 100) : 100}%`; bar.append(fill);
        card.append(el("h3", "", `${D.icon} ${nameOf(r)}`), el("p", "muted", `${D.forms[r.stage]} (form ${r.stage + 1} of 3) · Level ${lv} · ${r.stage < 2 ? evolveNeeds(s, r) : "Fully grown"}`), bar);
        card.append(el("p", "muted", D.blurb));
        const line = el("div", "dino-row");
        card.append(el("p", "muted", D.forms.map((f, i) => (i === r.stage ? `[${f}]` : f)).join(" → ")));
        for (const k of skillsOf(r)) {
          const sel = el("select");
          for (const [v, lab] of [["", "Off"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]) { const o = el("option", "", lab); o.value = v; o.selected = (r.jobs[k] || "") === v; sel.append(o); }
          sel.onchange = () => { if (sel.value) r.jobs[k] = sel.value; else delete r.jobs[k]; };
          const lab = el("label", "job"); lab.append(el("span", "", `${SKILLS[k]} ${(r.skill[k] || 0) >= 20 ? "★" : ""}`), sel); line.append(lab);
        }
        card.append(line);
        if (readyToEvolve(s, r)) card.append(button(`✨ Evolve into ${D.forms[r.stage + 1]}`, () => { toggle(false); G.dinos.evolve(d); }));
        page.append(card);
      }
      const seen = s.dinos.map((r) => r.species);
      page.append(el("h3", "", "Still out there"), list(Object.values(DINOS).filter((D) => !seen.includes(Object.keys(DINOS).find((k) => DINOS[k] === D))).map((D) => [s.seen[D.line] ? D.line : "???", D.rare ? "Rare" : ""])));
    },
    crops() { page.append(heading("Crops"), list(Object.entries(CROPS).filter(([, c]) => !c.story).map(([k, c]) => [G.s.seen[k] ? `${c.icon} ${c.name}` : "???", c.seasons.map((i) => SEASONS[i]).join(", "), G.s.seen[k] ? `${c.days} days` : ""]))); },
    fish() {
      const got = FISH.filter((f) => G.s.fish[f.id]).length;
      page.append(heading(`Fish: ${got} of ${FISH.length}`), el("p", "muted", `Your rod: ${RODS[(G.s.rod || 1) - 1].name}`), list(FISH.map((f) => [G.s.fish[f.id] ? f.name : "???", "★".repeat(f.rarity), G.s.fish[f.id] ? `× ${G.s.fish[f.id]}` : ""])));
    },
    recipes() {
      page.append(heading("Recipes"), el("p", "muted", "Build machines with B, then press E beside them."));
      for (const [k, name] of Object.entries(MACHINES)) {
        const seen = new Set(), rows = [];
        for (const r of RECIPES.filter((x) => x.machine === k)) { if (seen.has(r.out)) continue; seen.add(r.out); rows.push([(G.s.made?.[r.out] ? "✓ " : "") + itemName(r.out), Object.entries(r.in).map(([a, n]) => `${n} ${itemName(a)}`).join(", "), r.hours ? `${r.hours}h` : ""]); }
        page.append(el("h3", "", name), list(rows));
      }
    },
    people() { page.append(heading("People"), list(Object.values(NPCS).filter((n) => G.s.met[n.name] || !n.visiting).map((n) => [n.name, n.role, G.s.met[n.name] ? "♥".repeat(Math.min(5, 1 + Math.floor(G.s.met[n.name] / 5))) : "not met"]))); },
    map() {
      const s = G.s;
      page.append(heading("The ocean"));
      const c = el("canvas", "map"); c.width = 620; c.height = 620; page.append(c);
      const g = c.getContext("2d"), k = 0.135, o = 310;
      g.fillStyle = "#bfeee6"; g.fillRect(0, 0, 620, 620);
      g.strokeStyle = "rgba(90,140,140,.35)"; g.setLineDash([5, 6]);
      for (const L of G.world.list) { const f = L.cfg.route; if (f && L.group.visible) { g.beginPath(); g.arc(o, o, f.r * k, 0, 7); g.stroke(); } }
      g.setLineDash([]);
      for (const L of G.world.list) {
        if (!L.group.visible) continue;
        const id = L.cfg.id, p = L.group.position, known = id === "home" || s.seenIsles[id];
        g.fillStyle = id === "home" ? "#7fbf6a" : known ? "#d9b873" : "#a9c9c4";
        g.beginPath(); g.ellipse(o + p.x * k, o + p.z * k, Math.max(6, L.cfg.a * k), Math.max(5, L.cfg.b * k), -L.group.rotation.y, 0, 7); g.fill();
        g.fillStyle = "#4f3f28"; g.font = "700 12px Nunito, sans-serif"; g.textAlign = "center";
        g.fillText(known ? L.cfg.name : "?", o + p.x * k, o + p.z * k + (id === "home" ? 4 : -Math.max(8, L.cfg.b * k) - 3));
      }
      const P = G.player.pos; g.fillStyle = "#e4573d"; g.beginPath(); g.arc(o + P.x * k, o + P.z * k, 4, 0, 7); g.fill();
      const known = G.world.list.filter((L) => L.cfg.id !== "willowmere" && L.group.visible && (L.cfg.id === "home" || s.seenIsles[L.cfg.id]) && L.cfg.id !== G.player.ground?.on);
      if (known.length) { page.append(el("h3", "", `The ferry bell: ${FERRY} shells a trip`)); const r = el("div", "ferry"); for (const L of known) r.append(button(L.cfg.name, () => { toggle(false); G.sail.ferry(L); })); page.append(r); }
    },
    settings() {
      page.append(heading("Settings"));
      const slider = (label, value, fn, min = 0, max = 1, step = 0.05) => { const r = el("label", "set", label), i = el("input"); i.type = "range"; Object.assign(i, { min, max, step, value }); i.oninput = () => fn(+i.value); r.append(i); page.append(r); };
      slider("Music", levels.music, (v) => { setLevels(v, levels.sfx); G.s.opts.music = v; });
      slider("Sounds and talking", levels.sfx, (v) => { setLevels(levels.music, v); G.s.opts.sfx = v; });
      slider("Camera speed", G.input.sense || 1, (v) => { G.input.sense = v; G.s.opts.sense = v; }, 0.3, 2);
      slider("Talking speed", G.s.opts.talk || 1, (v) => { G.talk.setSpeed(v); G.s.opts.talk = v; }, 0.5, 3, 0.25);
      slider("Text size", G.s.opts.text || 1, (v) => { document.documentElement.style.setProperty("--text", v); G.s.opts.text = v; }, 0.85, 1.5);
      const save = el("button", "cozy", "Save now"); save.onclick = async () => { await G.save(); popup("Saved"); };
      const quit = el("button", "cozy ghost", "Save and leave"); quit.onclick = async () => { await G.save(); location.href = "../games/index.html"; };
      page.append(el("p", "muted keys", "WASD move · Shift run · Space jump · E use · R ride · B build · 1 to 7 tools · Q change seed · J journal · M map · I bag · drag to look · wheel to zoom"), save, quit);
      testTools();
    },
  };
  /** for trying things out quickly. It's your save: everything here really happens */
  function testTools() {
    const s = G.s, C = G.cheat, box = el("details", "testbox"), wrap = el("div", "test-row");
    box.append(el("summary", "", "🧪 Test tools"));
    box.open = !!book.dataset.test;
    box.ontoggle = () => { book.dataset.test = box.open ? "1" : ""; };
    const toggleBtn = (label, key) => { const b = el("button", `cozy small${C[key] ? "" : " ghost"}`, `${label}: ${C[key] ? "on" : "off"}`); b.onclick = () => { C[key] = !C[key]; show("settings"); }; wrap.append(b); };
    const act = (label, fn) => { const b = button(label, () => { fn(); play("pick"); show("settings"); }); wrap.append(b); };
    toggleBtn("Fly (Space up, C down)", "fly"); toggleBtn("Walk through anything", "ghost"); toggleBtn("Endless energy", "stamina"); toggleBtn("Stop the clock", "stopTime");
    act("+1,000 shells", () => { s.money += 1000; }); act("+50 of every material", () => { for (const [k, i] of Object.entries(ITEMS)) if (i.mat) G.add(k, 50); });
    act("All seeds ×10", () => { for (const [k, i] of Object.entries(ITEMS)) if (i.seed && k !== "heartseed_seed") G.add(k, 10); });
    act("Grow all crops now", () => { for (const p of Object.values(s.plots)) if (p.crop) p.age = CROPS[p.crop].days; G.farm.draw(); });
    act("Water everything", () => { for (const p of Object.values(s.plots)) p.wet = true; G.farm.draw(); });
    act("Fill the field in front", () => { const c = G.farm.target(); for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) { const x = c.x + a * 2, z = c.z + b * 2; if (G.farm.canTill(x, z)) { const k = `${Math.round(x / 2)},${Math.round(z / 2)}`; s.plots[k] ||= { crop: null, age: 0, wet: true }; } } G.farm.draw(); });
    act("Next day", () => { toggle(false); G.nextDay(); });
    act("Next season", () => { s.day += 14 - (s.day - 1) % 14 - 1; toggle(false); G.nextDay(); });
    act("Morning", () => { s.minute = 8 * 60; }); act("Noon", () => { s.minute = 12 * 60; }); act("Dusk", () => { s.minute = 18.5 * 60; }); act("Night", () => { s.minute = 22 * 60; });
    for (const w of Object.keys(WEATHER)) act(`${WEATHER[w].icon} ${w}`, () => { s.weather = w; });
    act("Mend the bridge", () => { s.flags.bridgeFixed = true; }); act("Mend the boat", () => { s.flags.boat = true; });
    act("All dinosaurs", () => { for (const k of Object.keys(DINOS)) if (!s.dinos.some((r) => r.species === k)) G.dinos.add(k, ""); });
    act("Max friendship", () => { for (const d of G.dinos.list) { d.r.xp = 400; d.r.born = Math.min(d.r.born, s.day - 30); } });
    act("Evolve the nearest", () => { const d = [...G.dinos.list].sort((a, b) => a.pos.distanceTo(G.player.pos) - b.pos.distanceTo(G.player.pos))[0]; if (d) { d.r.xp = Math.max(d.r.xp, 400); d.r.born = Math.min(d.r.born, s.day - 30); toggle(false); G.dinos.evolve(d); } });
    act("Open all gates", () => { for (const L of G.world.list) for (const c of L.cells.values()) for (const r of [...c]) if (r.gate) G.lore.clearGate(r); });
    act("Reveal the map", () => { for (const L of G.world.list) { L.group.visible = true; s.seenIsles[L.cfg.id] = true; } s.flags.chart = true; });
    act("Finish this story step", () => { const q = STORY.find((x) => !x.done(s)); if (!q || q.id === "free") return; ({ plant: () => { s.flags.planted = true; }, harvest: () => { s.flags.harvested = true; }, ship: () => { s.flags.shipped = true; }, friend: () => { s.flags.fed = true; }, bridge: () => { s.flags.bridgeFixed = true; }, town: () => { s.flags.town = true; }, moss: () => { s.met["Old Moss"] = 1; }, boulder: () => { s.flags.boulder = true; }, c1: () => { s.carved.c1 = true; }, show: () => { s.flags.moss = true; }, boat: () => { s.flags.boat = true; }, dune: () => { s.seenIsles.dune = true; }, c2: () => { s.carved.c2 = true; }, c3: () => { s.carved.c3 = true; }, c4: () => { s.carved.c4 = true; }, chart: () => { s.flags.chart = true; G.world.lands.elder.group.visible = true; }, elder: () => { s.seenIsles.elder = true; }, c5: () => { s.carved.c5 = true; }, truth: () => { s.flags.truth = true; G.add("heartseed_seed", 1); }, grow: () => { s.flags.bloomed = true; G.add("heartseed", 1); }, shrine: () => { s.flags.finale = true; s.flags.after = true; } }[q.id] || (() => {}))(); });
    box.append(wrap);
    const go = el("div", "test-row");
    for (const L of G.world.list) if (L.group.visible) go.append(button(`Go to ${L.cfg.name}`, () => { toggle(false); s.money += FERRY; G.sail.ferry(L); }, "cozy small ghost"));
    box.append(el("p", "muted", "Teleport:"), go);
    page.append(box);
  }
  TABS.forEach(([id, ic, label]) => { const b = el("button", "tab"); b.title = label; b.textContent = ic; b.dataset.id = id; b.onclick = () => show(id); tabs.append(b); });
  function show(id) {
    open = id; page.replaceChildren();
    try { pages[id](); } catch (e) { console.warn("[turtle] book", e); page.append(el("p", "muted", "This page couldn't be drawn.")); }
    [...tabs.children].forEach((b) => b.classList.toggle("on", b.dataset.id === id));
  }
  $("bookClose").onclick = () => toggle(false);
  function toggle(on = book.hidden, tab = open) { book.hidden = !on; G.paused = on; if (on) { show(tab); play("open"); } }
  return { toggle, active: () => !book.hidden };
}

// ---------------- shops: each sells its own things, and pays best for what it wants ----------------
export function makeShop(G) {
  const box = $("shop"), rows = $("shopRows");
  const buyRow = (label, note, price, enabled, fn) => { const r = el("div", "row"), b = el("button", "cozy small", "Buy"); r.append(el("b", "", label), el("span", "muted", note), el("em", "", `${price}`)); b.disabled = !enabled; b.onclick = fn; r.append(b); rows.append(r); };
  const draw = (who, mode) => {
    const S = SHOPS[mode], s = G.s;
    $("shopTitle").textContent = S.title;
    $("shopMoney").textContent = `${s.money} shells`;
    rows.replaceChildren();
    const season = seasonOf(s.day).index, redo = () => { play("buy"); draw(who, mode); };
    if (S.seeds) for (const [k, c] of Object.entries(CROPS)) {
      if (c.from !== mode) continue;
      buyRow(`${c.icon} ${ITEMS[`${k}_seed`].name}`, c.seasons.includes(season) ? `${c.days} days` : "out of season", c.seed, s.money >= c.seed, () => { s.money -= c.seed; G.add(`${k}_seed`, 1); redo(); });
    }
    for (const k of S.rareSeeds || []) { const c = CROPS[ITEMS[k].seed]; buyRow(`${c.icon} ${ITEMS[k].name}`, "rare", c.seed * 2, s.money >= c.seed * 2, () => { s.money -= c.seed * 2; G.add(k, 1); redo(); }); }
    for (const k of S.sells) { const p = S.prices[k]; buyRow(`${ITEMS[k].icon} ${ITEMS[k].name}`, "", p, s.money >= p, () => { s.money -= p; G.add(k, 1); redo(); }); }
    if (S.rods) for (const r of RODS) {
      if (r.level <= (s.rod || 1)) continue;
      buyRow(r.name, "easier to land, and reaches rarer fish", r.price, s.money >= r.price && r.level === (s.rod || 1) + 1, () => { s.money -= r.price; s.rod = r.level; redo(); });
    }
    for (const k of S.upgrades || []) {
      const tier = (s.tools ||= {})[k] || 0, cost = TOOL_COST[tier + 1];
      if (!cost) continue;
      const note = Object.entries(cost).filter(([i]) => i !== "money").map(([i, n]) => `${n} ${itemName(i)}`).join(", "), ok = s.money >= cost.money && Object.entries(cost).every(([i, n]) => i === "money" || (s.inv[i] || 0) >= n);
      buyRow(`${TIERS[tier + 1]} ${TOOLS.find((t) => t.id === k).name}`, note, cost.money, ok, () => { s.money -= cost.money; for (const [i, n] of Object.entries(cost)) if (i !== "money") G.add(i, -n); s.tools[k] = tier + 1; redo(); });
    }
    const sells = Object.entries(s.inv).filter(([k, n]) => n > 0 && ITEMS[k]?.sell);
    if (sells.length) rows.append(el("h3", "", `Sell${festivalOf(s) ? ` (${festivalOf(s).name}!)` : ""}`));
    for (const [k, n] of sells) {
      const price = priceOf(s, k, mode), r = el("div", "row"), hot = S.buys(ITEMS[k]);
      r.append(el("b", "", `${ITEMS[k].icon} ${ITEMS[k].name} × ${n}`), el("span", "muted", hot ? (demand(s, mode, ITEMS[k].fish ? "fish" : ITEMS[k].crop ? "crop" : ITEMS[k].made ? "made" : "mat") > 1.15 ? "in demand" : "") : "not what they want"), el("em", "", `${price}`));
      const b = el("button", "cozy small", "Sell"); b.onclick = () => { s.money += price; G.add(k, -1); redo(); };
      const all = el("button", "cozy small ghost", "All"); all.onclick = () => { s.money += price * n; G.add(k, -n); redo(); };
      r.append(b, all); rows.append(r);
    }
    if (!rows.children.length) rows.append(el("p", "muted", "Nothing to trade right now."));
  };
  $("shopClose").onclick = () => { box.hidden = true; G.paused = false; };
  return { open(who, mode) { box.hidden = false; G.paused = true; draw(who, mode); play("open"); } };
}

// ---------------- making your character ----------------
export function makeCreator(G, done) {
  const box = $("creator"), skins = $("skinRow"), name = $("playerName");
  let body = "male", skin = "Farmer";
  const fill = () => {
    skins.replaceChildren(...SKINS[body].map(([id, label]) => { const b = el("button", `skin${id === skin ? " on" : ""}`, label); b.onclick = () => { skin = id; fill(); G.player.swap(body, skin); play("open"); }; return b; }));
    for (const b of document.querySelectorAll("[data-body]")) b.classList.toggle("on", b.dataset.body === body);
  };
  for (const b of document.querySelectorAll("[data-body]")) b.onclick = () => { body = b.dataset.body; skin = SKINS[body][0][0]; fill(); G.player.swap(body, skin); play("open"); };
  $("startGame").onclick = () => {
    const n = name.value.trim();
    if (!n) { name.focus(); name.classList.add("want"); return; }
    box.hidden = true; done({ name: n.slice(0, 16), body, skin });
  };
  return { show() { box.hidden = false; fill(); name.focus(); } };
}

export { CATALOG, groundAt };
