// main.js - runs the game: title screen, character creation, the portal, exploring (moving, NPC life,
// talking, chests, exits), the turn-based battle director (plays the engine's events with animation, dice and
// effects in order), voices + subtitles, saving, and the campaign results.
import * as THREE from "three";
import { Engine } from "./engine3d.js";
import { Audio } from "./audio.js";
import { VFX } from "./vfx.js";
import { WorldScene } from "./world.js";
import { Actor, angDiff, WEAPON_ATTACK } from "./characters.js";
import { DiceTray } from "./dice3d.js";
import * as A from "./assets.js";
import { call, appCall, isTest } from "./bridge.js";
import { UI, $, h, companionName } from "./ui.js";
import { Portraits } from "./portraits.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** split a line into speakable pieces: the first sentence on its own (so the voice starts fast), then the rest in
    groups of whole sentences up to ~160 characters */
function splitSpeech(text) {
  const sents = (String(text).match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) || [text]).map((x) => x.trim()).filter(Boolean);
  if (!sents.length) return [String(text)];
  // the first piece is made before anything is heard, so keep it short: a long first sentence is cut at its first
  // comma / dash (the rest is made while that plays) - the voice starts in about a second
  const first = sents[0].length > 70 ? sents[0].match(/^(.{18,70}?[,;:—–])\s+(.+)$/) : null;
  if (first) sents.splice(0, 1, first[1], first[2]);
  const out = [sents[0]];
  for (const s of sents.slice(1)) {
    const i = out.length - 1;
    if (i > 0 && out[i].length + s.length < 160) out[i] += " " + s; else out.push(s);
  }
  return out;
}
const TIPS = [
  "Type anything you want to do in the action box — the Dungeon Master understands plain words.",
  "Every roll is real: the 3D dice always land on the number the rules rolled.",
  "Wandering traders sometimes camp in the wild. Their goods are rare — and pricey.",
  "Blacksmiths can reforge your gear up to +5. Innkeepers sell a safe night's sleep.",
  "Tonics from traders raise your stats for good. A Tome of Insight teaches a new upgrade card.",
  "Your companion fights on their own by default. Change how they act in Settings or the Party panel.",
  "Resting in the wild can wake monsters. Towns are safe.",
  "Click an enemy to target it, or just type “I attack the biggest one”.",
  "Hold Shift or press R to run. Drag with the right mouse button to turn the camera.",
  "Talk to people — some will join you, and some need help.",
  "Each species moves and greets differently. Try a goblin or an orc next time!",
  "Bosses change tactics when they get hurt. Keep a potion ready.",
  "Press Esc to pause, save, or change the volume of each voice.",
  "Upgrade cards stack. Check the Cards panel to see everything you've picked.",
];
const NAMES = { male: ["Aldric", "Bram", "Cael", "Doran", "Edric", "Finn", "Garrick", "Hale", "Ivo", "Jory", "Kael", "Lorne", "Marek", "Nolan", "Orin", "Perrin", "Quill", "Rowan", "Soren", "Tamsin", "Ulric", "Varo", "Wren", "Yorick"],
  female: ["Aria", "Brynn", "Cerys", "Dahlia", "Elowen", "Freya", "Gwen", "Hazel", "Isolde", "Juno", "Kira", "Lyra", "Maren", "Nia", "Oona", "Piper", "Rhea", "Selene", "Talia", "Una", "Vale", "Wynn", "Ysolde", "Zara"] };
const SURFACE = { snow: "snow", desert: "sand", beach: "sand", cave: "stone", dungeon: "stone", castle: "stone", city: "stone", ruins: "stone", scifi: "metal", space: "metal", swamp: "water", harbor: "wood", manor: "wood", outpost: "metal", blockland: "stone", crypt: "stone", mines: "stone", space_station: "metal", pirate_cove: "stone" };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// the title camp: where the fire burns, the log Vermeil sits on, and the camera that frames them with the portal behind
const TITLE_FIRE = { x: 3.4, z: 2.9 }, TITLE_SEAT = { x: 2.3, z: 1.9 };
const TITLE_SHOT = [V3(2.7, 1.9, 6.8), V3(1.5, 1.25, -0.4)];

class Game {
  constructor() {
    this.engine = new Engine($("world"));
    this.audio = new Audio();
    this.vfx = new VFX(this.engine, this.audio);
    this.world = new WorldScene(this.engine, this.vfx, this.audio);
    this.engine.cam.occluders = () => (this.world.root ? this.solidMeshes() : null);   // the follow camera keeps in front of these
    this.ui = new UI(this);
    this.state = null;
    this.party = new Map();      // uid -> Actor
    this.npcs = new Map();       // npc id -> Actor
    this.foes = new Map();       // enemy uid / encounter actor key -> Actor
    this.groups = [];            // [{enc, actors:[Actor]}]
    this.animals = [];
    this.mode = "title";
    this.busy = false;
    this.keys = {};
    this.voiceOn = true;
    this.raycaster = new THREE.Raycaster();
    window.__game = this;        // for tests
    this.engine.onUpdate((dt, t) => this.update(dt, t));
    this.portraits = new Portraits(this.engine);
    this.bindInput();
  }

  // ======================================================== boot & menus
  async boot() {
    const q = new URLSearchParams(location.search);
    this.loadScreen({ title: "Vermeil · Dungeon Adventure", text: "Opening the asset library…", p: 0.02 });
    try { await A.loadCatalog(); } catch (e) { this.loadScreen({ text: "Couldn't load the asset catalog (ui/game/assets/catalog.json).", p: 0 }); return; }
    const info = await call("info");
    if (info.error) { this.loadScreen({ text: info.error, p: 0 }); return; }
    this.info = info;
    this.dice = new DiceTray($("dicetray"), $("diceCanvas"), $("diceLabel"), info.dice_faces, this.audio);
    this.look = (await appCall("game_vermeil_look")) || {};
    document.querySelectorAll(".cn").forEach((e) => (e.textContent = companionName()));   // the app's chosen character
    // load every character, monster and item now (each place's scenery is loaded by that place's loading screen)
    if (!q.has("quickload")) {
      const pl = await call("preload_list");
      const list = pl.models || Object.keys(A.catalog);
      const t0 = performance.now();
      this.failedModels = await A.preloadAll(list, (n, total) => {
        const secs = (performance.now() - t0) / 1000, left = n > 8 ? Math.max(0, Math.round(secs / n * (total - n))) : null;
        this.loadScreen({ text: "Loading the 3D models…", p: 0.04 + 0.86 * (n / total), count: `${n} / ${total} models${left != null ? ` · about ${left}s left` : ""}` });
      });
      if (this.failedModels.length) console.warn("models that failed to load:", this.failedModels);
      for (const id of list) A.core.add(id);         // characters, monsters, items: never unloaded
    }
    this.loadScreen({ text: "Building the portal clearing…", p: 0.93, count: "" });
    $("btnContinue").hidden = !info.saves.some((s) => !s.empty && !s.damaged && s.status === "active");
    $("titleStatus").textContent = `${info.catalog_models} models in your library · ${info.voices.length} voices${this.failedModels?.length ? ` · ${this.failedModels.length} models couldn't load` : ""}`;
    await this.titleScene();
    this.engine.warmUp();
    this.menus();
    this.loadScreen({ text: "Ready!", p: 1 });
    await sleep(250);
    this.hideLoad();
    window.__ready = true;
    // music starts with the first click (browsers only allow sound after you interact)
    const startAudio = () => { this.audio.resume(); if (this.mode === "title" || this.mode === "create") this.audio.music("title"); };
    // inside Vermeil sound is allowed without a click: start the title music straight away
    try { this.audio.resume(); setTimeout(() => { if (this.audio.ctx?.state === "running" && this.mode === "title" && !this.audio.song) this.audio.music("title"); }, 400); } catch {}
    window.addEventListener("pointerdown", startAudio, { once: true });
    window.addEventListener("keydown", startAudio, { once: true });
  }

  // ---------------- the loading screen ----------------
  loadScreen({ title, text, p, count, soft = false, tip = true } = {}) {
    const el = $("loading");
    if (el.hidden || el.classList.contains("fading")) { el.hidden = false; el.classList.remove("fading"); el.classList.toggle("soft", soft); }
    if (title != null) $("loadingTitle").textContent = title;
    if (text != null) $("loadingText").textContent = text;
    if (p != null) $("loadingBar").style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    if (count != null) $("loadingCount").textContent = count;
    if (tip && !this._tipTimer) {
      const show = () => { const t = $("loadingTip"); t.textContent = "Tip: " + TIPS[Math.floor(Math.random() * TIPS.length)]; t.style.animation = "none"; void t.offsetWidth; t.style.animation = ""; };
      show(); this._tipTimer = setInterval(show, 5000);
    }
  }

  hideLoad() {
    const el = $("loading");
    clearInterval(this._tipTimer); this._tipTimer = null;
    el.classList.add("fading");
    setTimeout(() => { if (el.classList.contains("fading")) el.hidden = true; }, 650);
  }

  menus() {
    const click = () => { this.audio.resume(); this.audio.sfx("click"); };
    $("btnNew").onclick = () => { click(); this.showCreate(); };
    $("btnContinue").onclick = async () => { click(); const s = this.info.saves.find((x) => !x.empty && x.status === "active" && x.slot === "auto") || this.info.saves.find((x) => !x.empty && x.status === "active"); if (s) this.loadSlot(s.slot); };
    $("btnLoad").onclick = () => { click(); this.showSaves(); };
    $("btnSettings").onclick = () => { click(); this.showSettings(); };
    $("btnBack").onclick = () => this.backToAssistant();
    $("savesClose").onclick = () => ($("saves").hidden = true);
    $("settingsClose").onclick = () => ($("settingsScreen").hidden = true);
    $("btnPause").onclick = () => this.pause(true);
    $("pResume").onclick = () => this.pause(false);
    $("pSave").onclick = () => { this.pause(false); this.showSaves(); };
    $("pSettings").onclick = () => { this.pause(false); this.showSettings(); };
    $("pTitle").onclick = () => location.reload();
    $("pAssistant").onclick = () => this.backToAssistant();
    $("btnMute").onclick = () => this.setSetting({ voice: !this.state?.settings.voice });
    $("actForm").addEventListener("submit", (e) => { e.preventDefault(); this.submitText(); });
  }

  backToAssistant() {
    this.audio.stopScene();
    location.href = isTest ? "../games/index.html?bridge" : "../games/index.html";     // back to the Games hub
  }

  pause(on) {
    $("pause").hidden = !on;
    this.paused = on;
  }

  // ---------------- the title scene: a starry night camp by the portal stones, Vermeil sitting on a log by the fire ----------------
  async titleScene() {
    const fake = {
      name: "Portal Clearing",
      layout: { size: 40, cell: 1, nav: Array(40).fill(".".repeat(40)), objects: [], paths: [], water: [], bridges: [], exits: [], fx: ["fireflies"],
        ground: ["#2c4626", "#34502c", "#263d21"], sky: ["#0b1230", "#26305a"], fog: ["#141a35", 18, 60], sun: "#8f9fe6", ambient: "#4f5a9a", time: "night", path_color: "#5a4a36" },
      treasure: [],
    };
    const rx = /^(stylized_nature_megakit_(commontree_\d|pine_\d|bush_common|rock_medium_\d|grass_common_tall|flower_3_group)|ultimate_stylized_nature_mapletree_\d)$/;
    const ids = Object.keys(A.catalog).filter((i) => rx.test(i));
    let k = 0;
    for (let i = 0; i < 70 && ids.length; i++) {
      const a = (i / 70) * Math.PI * 2 + Math.sin(i) * 0.2, r = 9 + (i % 5) * 2.6;
      const id = ids[i % ids.length];
      const tall = /tree|pine/.test(id);
      const hgt = tall ? 6 + (i % 4) : /rock/.test(id) ? 1.2 : 0.8;
      const s = hgt / Math.max(0.1, A.catalog[id].size?.[1] || 1);
      fake.layout.objects.push({ a: id, x: Math.cos(a) * r, z: Math.sin(a) * r, r: i, s, c: 0, k: "t" });
      k++;
    }
    if (A.catalog.made_portal_base) fake.layout.objects.push({ a: "made_portal_base", x: 0, z: -2, r: 0, s: 1.9 / (A.catalog.made_portal_base.size?.[1] || 1.9), c: 0, k: "portal" });
    // the camp: a fire in a ring of stones, logs to sit on, a tent, packs and a pot of soup
    const F = TITLE_FIRE;
    const camp = [
      ["made_campfire_stones", F.x, F.z, 0, 1.0], ["conv_survival_pack_bonfire_fire", F.x, F.z, 0.4, 0.42, 1],
      ["conv_ultimate_nature_pack_woodlog_moss", TITLE_SEAT.x, TITLE_SEAT.z, 2.4, 0.82], ["conv_ultimate_nature_pack_woodlog_moss", 4.8, 1.8, 0.5, 0.78],
      ["conv_ultimate_nature_pack_treestump", 5.1, 3.6, 0.6, 0.7], ["conv_survival_pack_tent", 6.8, -2.0, -0.8, 0.18],
      ["conv_survival_pack_backpack", 1.5, 2.9, 0.5, 0.18], ["conv_ultimate_food_pack_cookingpot_soup", 4.3, 3.7, 0.3, 0.2],
      ["ultimate_fantasy_rts_logs", 3.6, 1.2, 1.1, 0.9], ["fantasy_props_megakit_bag", 5.5, 0.4, 0.4, 0.6],
      ["conv_survival_pack_woodentorch_fire", -2.7, -0.2, 0, 0.45, 1], ["conv_survival_pack_woodentorch_fire", 2.7, -0.6, 0, 0.45, 1],
    ];
    for (const [a, x, z, r, s, glow] of camp) if (A.catalog[a]) fake.layout.objects.push({ a, x, z, r, s, c: 0, k: "prop", ...(glow ? { glow: 1 } : {}) });
    await this.world.build(fake);
    this.portal = this.vfx.makePortal(1.9);
    this.portal.group.position.set(0, 2.4, -2);
    this.engine.scene.add(this.portal.group);
    this.portal.want = 0.15;
    // the fire's warm, flickering light and a few embers drifting up (the light goes away with the world)
    const fire = new THREE.PointLight(0xff9a48, 7, 13, 1.5);
    fire.position.set(F.x, 0.9, F.z);
    this.engine.scene.add(fire); this.world.lights.push(fire);
    this.campStop?.();
    this.campStop = this.engine.onUpdate((dt, t) => {
      if (!fire.parent) { this.campStop(); this.campStop = null; return; }
      fire.intensity = 6.4 + Math.sin(t * 13) * 0.7 + Math.sin(t * 7.7) * 0.6 + Math.random() * 0.6;
      if (Math.random() < dt * 9) this.vfx.p.spawn(V3(F.x + (Math.random() - 0.5) * 0.5, 0.7, F.z + (Math.random() - 0.5) * 0.5),
        V3((Math.random() - 0.5) * 0.25, 0.7 + Math.random() * 0.7, (Math.random() - 0.5) * 0.25), new THREE.Color(Math.random() < 0.5 ? 0xffa040 : 0xffd070), 0.09, 1.4 + Math.random(), -0.1, 0.3);
    });
    // Vermeil sits on the log, warming up by the fire
    this.titleV = await Actor.create(this.world, { uid: "vermeil", name: this.look.name || "Vermeil", model: this.look.model || "vermeil", body: this.look.body || "humanoid", size: this.look.size || undefined, team: "party", look: this.look });
    this.titleV.pos.set(TITLE_SEAT.x, 0, TITLE_SEAT.z);
    this.titleV.wantHeading = this.titleV.heading = Math.atan2(F.x - TITLE_SEAT.x, F.z - TITLE_SEAT.z);
    this.titleV.anim.sit(0.5);
    this.titleV.label.style.display = "none";
    this.engine.shot(...TITLE_SHOT);
  }

  // ======================================================== character creation
  showCreate() {
    $("title").hidden = true;
    $("create").hidden = false;
    this.mode = "create";
    const I = this.info;
    this.pick = this.pick || { species: "human", cls: "warrior" };
    const sp = $("cSpecies"), cl = $("cClass");
    const render = () => {
      sp.replaceChildren(...I.species.map((s) => h("button", { class: `choice ${s.id === this.pick.species ? "on" : ""} ${s.available ? "" : "off"}`, type: "button",
        title: s.available ? s.desc : s.reason, disabled: !s.available, onclick: () => { this.pick.species = s.id; render(); this.preview(); } }, h("b", {}, s.name), h("small", {}, s.available ? s.trait : "no model"))));
      cl.replaceChildren(...I.classes.map((c) => h("button", { class: `choice ${c.id === this.pick.cls ? "on" : ""}`, type: "button", title: c.desc,
        onclick: () => { this.pick.cls = c.id; render(); this.preview(); } }, h("b", {}, c.name), h("small", {}, c.role))));
    };
    render();
    const g = $("cGenre");
    if (g.options.length === 1) for (const [k, v] of Object.entries(I.genres)) g.append(h("option", { value: k }, v));
    const vc = $("cVClass");
    if (!vc.options.length) for (const c of I.classes) vc.append(h("option", { value: c.id, selected: c.id === "rogue" ? "" : null }, c.name));
    vc.value = "rogue";
    $("cBack").onclick = () => { this.audio.sfx("close"); $("create").hidden = true; $("title").hidden = false; this.mode = "title"; this.engine.shot(...TITLE_SHOT); };
    $("cStart").onclick = () => this.startNew();
    $("cRandom").onclick = () => {
      this.audio.resume(); this.audio.sfx("dice");
      const b = $("cRandom"); b.classList.remove("rolling"); void b.offsetWidth; b.classList.add("rolling");
      const sp = I.species.filter((x) => x.available), cls = I.classes;
      this.pick.species = sp[Math.floor(Math.random() * sp.length)].id;
      this.pick.cls = cls[Math.floor(Math.random() * cls.length)].id;
      const female = Math.random() < 0.5, list = NAMES[female ? "female" : "male"];
      $("cName").value = list[Math.floor(Math.random() * list.length)];
      const gopts = [...$("cGenre").options].map((o) => o.value);
      $("cGenre").value = Math.random() < 0.35 ? "" : gopts[1 + Math.floor(Math.random() * (gopts.length - 1))];
      render(); this.preview();
    };
    this.preview();
  }

  async preview() {
    const I = this.info, p = this.pick;
    const s = I.species.find((x) => x.id === p.species), c = I.classes.find((x) => x.id === p.cls);
    $("cPreviewName").textContent = `${s.name} ${c.name}`;
    $("cPreviewDesc").textContent = `${s.desc} ${c.desc}`;
    const model = p.species === "human" ? c.model : s.models[0];
    const key = `${model}|${p.species}|${p.cls}`;
    if (this.previewKey === key) return;
    this.previewKey = key;
    this.previewActor?.dispose();
    try {
      const a = await Actor.create(this.world, { uid: "preview", name: "", model, body: "humanoid", team: "party", scale: null, species: p.species, cls: p.cls });
      if (a.weaponKind && a.weaponKind !== "fists") setTimeout(() => this.previewActor === a && a.anim.play(WEAPON_ATTACK[a.weaponKind] || "attack"), 2300);   // show off the weapon
      if (this.previewKey !== key) { a.dispose(); return; }
      this.previewActor = a;
      a.pos.set(0.2, 0, 2.6);
      a.wantHeading = a.heading = 0.15;
      a.label.style.display = "none";
      setTimeout(() => a.anim.play("greet"), 350);          // every species greets in its own way
      this.audio.creature(a.soundProfile(), "victory", { vol: 0.7 });
    } catch (e) { console.warn(e); }
    this.engine.shot(V3(-2.6, 1.8, 7.6), V3(-1.7, 1.15, 2.2));
  }

  async startNew() {
    this.audio.resume();
    const opts = {
      name: $("cName").value.trim() || "Hero", species: this.pick.species, cls: this.pick.cls, genre: $("cGenre").value || null,
      premise: $("cPremise").value.trim() || null,
      settings: { vermeil_class: $("cVClass").value, randomize_vermeil_class: $("cVRandClass").checked, randomize_vermeil_look: $("cVRandLook").checked,
        vermeil_control: $("cVControl").value, skip_portal: new URLSearchParams(location.search).has("skipportal"),
        ...Object.fromEntries(Object.entries(this.audio.vol).filter(([k]) => k.endsWith("_volume"))) },
    };
    $("cStart").disabled = true;
    this.loading("The Dungeon Master is dreaming up your world…");
    const r = await call("new", opts);
    $("cStart").disabled = false;
    this.loading(null);
    if (r.error) { alert(r.error); return; }
    $("create").hidden = true;
    this.state = r.state;
    if (r.state.settings.skip_portal) return this.enterWorld(r.intro);
    await this.portalCinematic(r);
    await this.enterWorld(r.intro);
  }

  loading(text) {
    if (!text) return this.hideLoad();
    this.loadScreen({ title: "", text, p: null, count: "", soft: true });
  }

  // ======================================================== the portal opening
  async portalCinematic(r) {
    this.mode = "cutscene";
    const P = this.portal;
    const player = r.state.party.find((p) => p.kind === "player");
    this.previewActor?.dispose(); this.previewActor = null;
    const hero = this.cineHero = await Actor.create(this.world, { ...player, team: "party" });
    hero.label.style.display = "none";
    hero.pos.set(-1.6, 0, 4.4); hero.heading = hero.wantHeading = Math.PI;
    const v = this.titleV;
    v.anim.noFidget = true; hero.anim.noFidget = true;
    v.anim.sit(null);                     // she gets up from the log by the fire
    v.pos.set(TITLE_SEAT.x - 0.4, 0, TITLE_SEAT.z + 0.2); v.heading = v.wantHeading = Math.PI;
    this.engine.shot(V3(0, 2.4, 10.5), V3(0, 1.8, -1), 1.2);
    // 1. the clearing darkens and the portal stirs
    this.engine.setAtmosphere({ sky: ["#1b2448", "#4a3a6a"], fog: ["#2a2a4a", 20, 70], sun: "#9fb0ff", ambient: "#6a70b0", ground: "#3a5a2a", time: "night" });
    this.audio.stopMusic(2.5);
    this.audio.sfx("portal");
    this.audio.portalHum(true);
    P.want = 0.5;
    await this.gsleep(1400);
    // 2. they react
    window.__cine = "react";
    v.mood = "surprised"; v.anim.play("point"); hero.anim.play("jump");
    this.audio.creature("vermeil", "victory", { vol: 0.6 });
    this.subtitleOnly("vermeil", companionName(), "Whoa - is that... a door? To where?");
    P.want = 1.0;
    await this.gsleep(1500);
    // 3. she turns to you
    window.__cine = "invite";
    v.face(hero.pos.x, hero.pos.z); v.mood = "excited";
    v.anim.play("wave");
    this.subtitleOnly("vermeil", companionName(), "Come on - let's go together!");
    await this.gsleep(1400);
    // 4. they WALK up to it (the walk animation matches their pace)
    window.__cine = "walk";
    this.engine.shot(V3(1.9, 2.1, 7.8), V3(0, 1.6, -0.8), 1.2);
    hero.path = [[-0.55, -0.6]]; hero.maxSpeed = 1.5;
    v.path = [[0.55, -0.6]]; v.maxSpeed = 1.5;
    await this.waitUntil(() => !hero.path.length && !v.path.length, 7000);
    hero.face(-0.55, -4); v.face(0.55, -4);
    await this.gsleep(450);
    // 5. one after the other, they step through the swirl
    window.__cine = "enter";
    this.engine.shot(V3(0.6, 1.7, 3.6), V3(0, 1.5, -2), 1.0);
    this.stepThrough(v, P);
    await this.gsleep(900);
    this.stepThrough(hero, P);
    await this.waitUntil(() => !hero.group.visible && !v.group.visible, 6000);
    // 6. the camera follows them in
    window.__cine = "follow";
    this.audio.sfx("whoosh");
    const t0 = this.engine.time;
    this.engine.shot(V3(0, 2.4, -1.2), V3(0, 2.4, -3), 2.5);
    await new Promise((res) => {
      const stop = this.engine.onUpdate((dt, t) => {
        const k = Math.min(1, (t - t0) / 1.2);
        this.engine.camera.fov = 50 - k * 22; this.engine.camera.updateProjectionMatrix();
        P.group.rotation.z += dt * 3 * k;
        if (k >= 1) { stop(); res(); }
      });
    });
    this.engine.cam.shake = 0.5;
    $("fade").className = "white";
    await this.gsleep(800);
    this.audio.portalHum(false);
    this.engine.camera.fov = 50; this.engine.camera.updateProjectionMatrix();
    hero.dispose(); this.cineHero = null;
    this.titleV.dispose(); this.titleV = null;
    P.dispose(); this.portal = null;
    this.loadScreen({ title: "Crossing over…", text: "The portal spits you out somewhere new…", p: 0.05, count: "" });
  }

  /** walk a character into the portal: they shrink, lift and dissolve into light as they pass the ring */
  stepThrough(a, P) {
    this.audio.sfx("portal_enter");
    a.path = [[a.pos.x * 0.4, -3.4]]; a.maxSpeed = 1.3;
    const C = P.group.position.clone();
    let gone = false;
    const stop = this.engine.onUpdate(() => {
      const k = Math.max(0, Math.min(1, (-1.35 - a.pos.z) / 1.1));
      if (k > 0) {
        a.group.scale.setScalar(Math.max(0.02, 1 - k * 0.98));
        a.group.position.y += k * 1.6;
        a.group.rotation.z = Math.sin(k * 6) * 0.25 * k;
        for (let i = 0; i < 4; i++) {
          const from = a.group.position.clone().add(V3((Math.random() - 0.5) * 0.6, a.height * (1 - k) * Math.random(), (Math.random() - 0.5) * 0.6));
          this.vfx.p.spawn(from, C.clone().sub(from).multiplyScalar(1.6), new THREE.Color(Math.random() < 0.5 ? 0x9feeff : 0xffffff), 0.3, 0.6, 0, 0);
        }
      }
      if (k >= 1 && !gone) {
        gone = true; a.group.visible = false; a.path = []; stop();
        this.vfx.burst(C, "summon", 50, 3, 0.5, 0.8, 0);
        this.vfx.flash(C, 0x9feeff, 30, 8);
        this.audio.sfx("whoosh_small");
      }
    });
  }

  /** wait until fn() is true (or `ms` of game time passed - game time slows down with the frame rate, so a slow
      computer still sees the whole scene) */
  waitUntil(fn, ms = 5000) {
    return new Promise((res) => {
      const t0 = this.engine.time, w0 = performance.now();
      const stop = this.engine.onUpdate(() => { if (fn() || this.engine.time - t0 > ms / 1000 || performance.now() - w0 > ms * 6) { stop(); res(); } });
    });
  }

  gsleep(ms) { return this.waitUntil(() => false, ms); }

  subtitleOnly(speaker, name, text) { this.ui.subtitle(speaker, name, text, { keep: 5000 }); }

  // ======================================================== entering a location
  async enterWorld(intro) {
    $("title").hidden = true;
    this.titleV?.dispose(); this.titleV = null;
    this.previewActor?.dispose(); this.previewActor = null;
    this.portal?.dispose(); this.portal = null;
    $("hud").hidden = false;
    await this.buildLocation(this.state.location, { arriving: true });
    $("fade").className = "";
    this.mode = "explore";
    if (intro) {
      this.audio.sfx("arrive");
      this.banner(this.state.location.name, this.state.location.biome_name || "", "level");
      // the portal closes behind them
      const lay = this.state.location.layout;
      if (lay.portal) {
        const P = this.vfx.makePortal(1.6);
        P.group.position.set(lay.portal.x, 2.2, lay.portal.z);
        this.engine.scene.add(P.group);
        P.power = 1; P.want = 0;
        setTimeout(() => P.dispose(), 4000);
      }
      await this.speak("dm", "Dungeon Master", intro.intro);
      if (intro.hook) await this.speak("dm", "Dungeon Master", intro.hook);
      call("vermeil_say", "portal", "They just arrived through the portal.").then((r) => r.line && this.speak("vermeil", companionName(), r.line.line, r.line.mood));
    }
    this.afterState();
  }

  /** every new place gets a full loading screen that stays up until ALL its models are loaded, the place is built,
      everyone is standing in it and the first frames have been drawn. If anything fails it tries again, so the
      picture can never be left showing the previous place (the "Crystal Grotto that looked like the desert" bug). */
  async buildLocation(loc, opts = {}) {
    const prevMode = this.mode;
    this.mode = "loading";                       // nothing walks, talks or triggers exits while the place is swapped
    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try { await this._buildLocation(loc, opts); return true; }
        catch (e) {
          console.error(`building ${loc.name} failed (try ${attempt})`, e);
          this.loadScreen({ title: loc.name, text: attempt < 2 ? "Something went wrong - building the place again…" : "Couldn't build this place.", p: 0.05, count: "" });
          await sleep(400);
        }
      }
      this.hideLoad();
      this.ui.toast(`Couldn't build ${loc.name}. Try travelling again.`, "bad");
      return false;
    } finally {
      if (this.mode === "loading") this.mode = prevMode === "loading" || prevMode === "combat" ? "explore" : prevMode;
    }
  }

  async _buildLocation(loc, { arriving = false, from = null } = {}) {
    this.builtId = null;
    this.loadScreen({ title: loc.name, text: `${loc.biome_name || ""}${loc.level ? ` · danger level ${loc.level}` : ""}`, p: 0.03, count: "Preparing…", soft: false });
    this.player = null;
    for (const a of [...this.party.values(), ...this.npcs.values(), ...this.foes.values(), ...this.animals, ...this.groups.flatMap((g) => g.actors)]) a.dispose();
    for (const o of this.campProps || []) this.engine.scene.remove(o);
    this.party.clear(); this.npcs.clear(); this.foes.clear(); this.groups = []; this.animals = []; this.campProps = [];
    // every model this place needs - scenery, people, monsters, the party, chests (failed ones get a second try)
    const need = [...loc.layout.objects.map((o) => o.a), ...loc.npcs.map((n) => n.model), ...loc.npcs.flatMap((n) => Object.values(n.parts || {})),
      ...loc.encounters.flatMap((e) => e.enemies.map((x) => x.model)), ...this.state.party.map((p) => p.model), "fantasy_props_megakit_chest_wood"].filter(Boolean);
    let failed = await A.preloadAll(need, (n, t) => this.loadScreen({ p: 0.03 + 0.3 * (n / t), count: `Loading models ${n} / ${t}` }));
    if (failed.length) failed = await A.preloadAll(failed, (n, t) => this.loadScreen({ count: `Retrying ${n} / ${t} models…` }), 2);
    if (failed.length) console.warn(`${loc.name}: models that couldn't load`, failed);
    await this.world.build(loc, (k) => this.loadScreen({ p: 0.33 + 0.42 * k, count: `Building the place… ${Math.round(k * 100)}%` }));
    // keep this place's and the previous place's models; unload the rest (every place has its own look)
    A.release(new Set([...need, ...(this.prevNeed || [])]));
    this.prevNeed = need;
    const sp = loc.layout.spawns;
    this.loadScreen({ p: 0.78, count: "Gathering your party…" });
    // party
    let i = 0;
    for (const p of this.state.party) {
      const a = await Actor.create(this.world, { ...p, look: p.uid === "vermeil" ? this.look : null });
      const pt = i === 0 ? sp.player : sp.party[(i - 1) % sp.party.length];
      a.pos.set(pt.x, 0, pt.z);
      a.heading = a.wantHeading = sp.player.face || 0;
      if (!p.alive) a.anim.play("death");
      a.onStep = (x) => this.footstep(x);
      this.party.set(p.uid, a);
      i++;
    }
    this.player = this.party.get(this.state.party.find((p) => p.kind === "player").uid);
    this.engine.cam.yaw = (sp.player.face || 0) + Math.PI;
    this.engine.follow(this.player.pos);
    this.engine.shot(null);
    this.engine.snap();
    // people (all of them before the loading screen goes away - nobody pops in)
    this.loadScreen({ p: 0.85, count: "Waking up the locals…" });
    const pois = sp.npc;
    await Promise.all(loc.npcs.map((n, k) => {
      const pt = pois[k % Math.max(1, pois.length)] || { x: 4, z: 4, kind: "wander" };
      return Actor.create(this.world, { ...n, uid: n.id, team: "npc", body: "humanoid", scale: n.scale }).then((a) => {
        a.pos.set(pt.x + (Math.random() - 0.5) * 2, 0, pt.z + (Math.random() - 0.5) * 2);
        a.npc = { home: pt, routine: n.routine, next: Math.random() * 3, doing: "idle", seed: n.seed };
        a.maxSpeed = 1.6;
        if (n.trader) { a.label.querySelector(".n").innerHTML = `🪙 ${n.name} <span class="trader-tag">· trader</span>`; this.traderCamp(a); }
        else if (n.shop) a.label.querySelector(".n").textContent = `🛒 ${n.name}`;
        this.npcs.set(n.id, a);
      }).catch((e) => console.warn("npc", e));
    }));
    // monsters waiting around their spawn points
    this.loadScreen({ p: 0.92, count: "Monsters taking their places…" });
    await Promise.all(loc.encounters.map((enc) => this.spawnGroup(enc)));
    // animals in pastures and villages
    if (loc.layout.animals) {
      const rx = new RegExp(loc.layout.animals);
      const ids = Object.keys(A.catalog).filter((x) => rx.test(x));
      for (let k = 0; k < Math.min(4, ids.length ? 3 : 0); k++) {
        const pt = this.world.nav.randomPoint();
        if (!pt) continue;
        try {
          const a = await Actor.create(this.world, { uid: `animal${k}`, name: "", model: ids[k % ids.length], body: "quadruped", team: "npc", size: 1.1 });
          a.pos.set(pt[0], 0, pt[1]); a.label.style.display = "none"; a.maxSpeed = 1; a.animal = { next: 2 + Math.random() * 4 };
          this.animals.push(a);
        } catch (e) { console.warn(e); }
      }
    }
    this.audio.resume();
    this.surface = SURFACE[loc.biome] || "grass";
    this.audio.setScene(loc.biome, loc.layout.music, loc.layout.time, { kind: loc.kind, water: (loc.layout.water || []).length > 0 });
    this.audio.setVolumes(this.state.settings);
    // compile every shader and draw a few frames BEHIND the loading screen, so nothing pops in or stutters
    this.loadScreen({ p: 0.97, count: "Finishing touches…" });
    this.engine.warmUp();
    await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))), sleep(700)]);
    this.builtId = loc.id;
    this.loadScreen({ p: 1, count: "Ready" });
    await sleep(200);
    this.hideLoad();
    this.ui.renderHud();
    window.__validation = loc.layout.validation;
    window.__built = { id: loc.id, name: loc.name, biome: loc.biome, failed: failed.length };
  }

  /** the wandering trader's camp: a wagon and a pack horse next to them */
  async traderCamp(a) {
    const place = async (id, dx, dz, h, rot) => {
      if (!A.urlOf(id)) return null;
      try {
        const { root, clips } = await A.instance(id);
        A.normalize(root, h);
        const g = new THREE.Group(); g.add(root);
        g.position.set(a.pos.x + dx, this.world.ground ? this.world.ground(a.pos.x + dx, a.pos.z + dz) : 0, a.pos.z + dz);
        g.rotation.y = rot;
        this.engine.scene.add(g); this.campProps.push(g);
        if (clips?.length) { const mx = new THREE.AnimationMixer(root); const idle = clips.find((c) => /idle|eat/i.test(c.name)) || clips[0]; mx.clipAction(idle).play(); const stop = this.engine.onUpdate((dt) => { if (!g.parent) return stop(); mx.update(dt); }); }
        return g;
      } catch (e) { console.warn("trader prop", id, e); return null; }
    };
    a.npc && (a.npc.routine = ["stall"]);
    await place("medieval_village_megakit_prop_wagon", 1.8, -0.6, 1.8, 0.4) || await place("fantasy_props_megakit_stall_cart_empty", 1.8, -0.6, 2.2, 0.4);
    await place("conv_farm_animals_horse", 3.6, 0.8, 1.7, 1.9);
    for (const id of ["fantasy_props_megakit_barrel", "fantasy_props_megakit_crate_wooden"]) await place(id, -1.2 + Math.random(), 1.1 + Math.random() * 0.4, 0.8, Math.random() * 6);
  }

  footstep(a) {
    const P = this.player; if (!P) return;
    const d = a.pos.distanceTo(P.pos);
    if (d > 14) return;
    const s = this.engine.toScreen(a.pos);
    const pan = Math.max(-1, Math.min(1, s.x / innerWidth * 2 - 1));
    const vol = (a === P ? 1 : 0.55) * Math.max(0, 1 - d / 14);
    if (a.info.team === "enemy" || a.info.model === "vermeil" || a.info.species && a.info.species !== "human") {
      const prof = a.soundProfile();
      if (/mech|dino_big|stone|brute|dwarf|orc/.test(prof)) return this.audio.creature(prof, "step", { pan, vol });
    }
    this.audio.step(this.surface, { pan, vol });
  }

  /** where a character is, for left/right sound and loudness */
  hear(a, maxD = 22) {
    const s = this.engine.toScreen(a.pos.clone().setY(1));
    const ref = this.player ? this.player.pos : this.engine.cam.target;
    const d = a.pos.distanceTo(ref);
    return { pan: Math.max(-1, Math.min(1, (s.x / innerWidth) * 2 - 1)) * 0.8, vol: Math.max(0, 1 - d / maxD), d, size: a.height / 1.7 };
  }

  sound(a, event) {
    if (!a) return;
    const h = this.hear(a, 40);
    this.audio.creature(a.soundProfile(), event, { pan: h.pan, vol: 0.5 + 0.5 * h.vol, size: h.size });
  }

  async spawnGroup(enc) {
    const grp = { enc, actors: [] };
    this.groups.push(grp);
    for (let k = 0; k < enc.enemies.length; k++) {
      const e = enc.enemies[k];
      try {
        const a = await Actor.create(this.world, { uid: `${enc.id}_${k}`, name: e.name, model: e.model, body: e.body, size: e.size, team: "enemy",
          kind: enc.boss ? "boss" : "enemy", level: e.level, tint: e.tint });
        const ang = (k / enc.enemies.length) * Math.PI * 2;
        const p = this.world.nav.nearest(enc.x + Math.cos(ang) * 1.6, enc.z + Math.sin(ang) * 1.6, 4) || [enc.x, enc.z];
        a.pos.set(p[0], 0, p[1]);
        a.home = { x: p[0], z: p[1] };
        a.maxSpeed = 1.3;
        a.label.querySelector(".n").textContent = `${e.name} · Lv ${e.level}`;
        a.showHp(false);
        a.info.sound = e.sound;
        a.onStep = (x) => this.footstep(x);
        grp.actors.push(a);
      } catch (err) { console.warn("enemy model", err); }
    }
  }

  // ======================================================== input
  bindInput() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { if (!$("hud").hidden) this.pause(!this.paused); return; }
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === "Enter") { $("actInput").focus(); e.preventDefault(); }
      if (e.key.toLowerCase() === "e" && this.mode === "explore") this.interact();
      if (e.key.toLowerCase() === "r" && this.mode === "explore") this.player && (this.run = !this.run);
    });
    window.addEventListener("keyup", (e) => { this.keys[e.key.toLowerCase()] = false; });
    $("world").addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.shiftKey || this.mode === "title" || this.mode === "cutscene") return;
      const hit = this.pick3d(e);
      if (!hit) return;
      if (this.mode === "combat" && this.targeting) { if (hit.actor && hit.actor.info.team === "enemy") this.targeting(hit.actor); return; }
      if (this.mode !== "explore") return;
      if (hit.actor?.npc) { this.player.goTo(hit.actor.pos.x, hit.actor.pos.z, { near: 1.6 }); this.pendingTalk = hit.actor; return; }
      if (hit.actor?.info.team === "enemy") { this.player.goTo(hit.actor.pos.x, hit.actor.pos.z, { near: 3, run: true }); return; }
      if (hit.chest) { this.player.goTo(hit.chest.x, hit.chest.z, { near: 1.3 }); this.pendingChest = hit.chest; return; }
      if (hit.point) { this.player.goTo(hit.point.x, hit.point.z, { run: e.detail === 2 || this.run }); this.vfx.ring(hit.point, 0xffffff, 0.3, 0.4); }
    });
  }

  pick3d(e) {
    const m = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(m, this.engine.camera);
    const candidates = [...this.npcs.values(), ...this.groups.flatMap((g) => g.actors), ...this.foes.values()];
    let best = null, bd = 1e9;
    for (const a of candidates) {
      const c = a.pos.clone().add(V3(0, a.height * 0.5, 0));
      const d = this.raycaster.ray.distanceToPoint(c);
      const dist = this.raycaster.ray.origin.distanceTo(c);
      if (d < Math.max(0.7, a.radius) && dist < bd) { best = a; bd = dist; }
    }
    if (best) return { actor: best };
    for (const ch of this.world.chests) {
      if (ch.found) continue;
      if (this.raycaster.ray.distanceToPoint(V3(ch.x, 0.4, ch.z)) < 0.8) return { chest: ch };
    }
    const g = this.world.groundMesh;
    const hit = g && this.raycaster.intersectObject(g)[0];
    return hit ? { point: hit.point } : null;
  }

  // what's in reach for the E key
  nearby() {
    if (!this.player) return null;
    const P = this.player.pos;
    let best = null, bd = 3.2;
    // standing in a travel zone / teleport ring: the only thing to do here is travel (no "Talk to" for whoever wanders by)
    const zone = this.world.exits.find((ex) => Math.hypot(ex.x - P.x, ex.z - P.z) < 4.2);
    if (zone) return { kind: "exit", ex: zone, label: this.exitLock(zone) ? `🔒 ${zone.name} (sealed for now)` : `Travel to ${zone.name}` };
    for (const [id, a] of this.npcs) { const d = a.pos.distanceTo(P); if (d < bd) { bd = d; best = { kind: "npc", id, a, label: `Talk to ${a.info.name}` }; } }
    for (const ch of this.world.chests) { if (ch.found) continue; const d = Math.hypot(ch.x - P.x, ch.z - P.z); if (d < Math.min(bd, 2.2)) { bd = d; best = { kind: "chest", ch, label: ch.relic ? "Open the glowing chest" : "Open the chest" }; } }
    for (const ex of this.world.exits) { const d = Math.hypot(ex.x - P.x, ex.z - P.z); if (d < 2.6) best = { kind: "exit", ex, label: this.exitLock(ex) ? `🔒 ${ex.name} (sealed for now)` : `Travel to ${ex.name}` }; }
    return best;
  }

  /** why an exit is sealed right now (the story goes in order), or null */
  exitLock(ex) {
    const cur = (this.state?.location?.layout?.exits || []).find((x) => x.to === ex.to);
    const lock = cur ? cur.locked : ex.locked;
    if (ex.label) { ex.label.classList.toggle("locked", !!lock); ex.label.querySelector(".n").textContent = `${lock ? "🔒" : "➜"} ${ex.name}`; }
    return lock || null;
  }

  async interact() {
    const n = this.nearby();
    if (!n || this.busy) return;
    if (n.kind === "npc") return this.talkTo(n.id);
    if (n.kind === "chest") return this.openChest(n.ch);
    if (n.kind === "exit") { const lock = this.exitLock(n.ex); if (lock) return this.ui.toast(lock, "bad"); return this.travel(n.ex.to); }
  }

  // ======================================================== the frame update
  update(dt, t) {
    if (this.paused) return;
    // player movement with WASD / arrows (camera-relative), always on the nav grid
    if (this.player && this.mode === "explore" && document.activeElement !== $("actInput")) {
      const k = this.keys;
      let mx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0), mz = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0);
      if (mx || mz) {
        const yaw = this.engine.cam.yaw;
        const dx = mx * Math.cos(yaw) + mz * Math.sin(yaw), dz = -mx * Math.sin(yaw) + mz * Math.cos(yaw);
        const len = Math.hypot(dx, dz);
        const run = k.shift || this.run;
        const step = (run ? 5.6 : 3) * dt;
        const p = this.player;
        const [nx, nz] = this.world.collide(p.pos.x + (dx / len) * step, p.pos.z + (dz / len) * step);   // slide around rocks and trunks
        if (this.world.nav.walkable(nx, nz)) { p.pos.x = nx; p.pos.z = nz; }
        else if (this.world.nav.walkable(nx, p.pos.z)) p.pos.x = nx;
        else if (this.world.nav.walkable(p.pos.x, nz)) p.pos.z = nz;
        p.path = [];
        p.wantHeading = Math.atan2(dx, dz);
        p.speed = run ? 5.6 : 3;
        this.manual = true;
      } else if (this.manual) { this.player.speed = 0; this.manual = false; }
    }
    for (const a of this.party.values()) a.update(dt);
    this.titleV?.update(dt); this.previewActor?.update(dt); this.cineHero?.update(dt);
    for (const a of this.npcs.values()) { if (this.mode === "explore") this.npcLife(a, dt, t); this.lodUpdate(a, dt); }
    for (const a of this.animals) { this.animalLife(a, dt); this.lodUpdate(a, dt); }
    for (const g of this.groups) for (const a of g.actors) { if (this.mode === "explore") this.monsterLife(g, a, dt); this.lodUpdate(a, dt); }
    for (const a of this.foes.values()) a.update(dt);
    if (this.player && this.mode === "explore") {
      this.followers(dt);
      this.engine.follow(this.player.pos);
      this.checkTriggers();
    }
    this.creatureChatter(dt);
    this.updateTurnRing(dt, t);
    this.labels();
    this.portraitTick(dt);
  }

  /** live portraits: one character per few frames, everyone refreshed about every 2.5 s (plus right after a hit/heal) */
  portraitTick(dt) {
    if (this.mode === "loading" || this.mode === "title" || !this.party.size) return;
    this._ptT = (this._ptT || 0) - dt;
    if (this._ptT > 0) return;
    const list = [...this.party.values(), ...(this.mode === "combat" ? this.foes.values() : [])];
    if (!list.length) return;
    this._ptI = ((this._ptI || 0) + 1) % list.length;
    this.portraits.shoot(list[this._ptI]);
    this.ui.refreshFaces();
    this._ptT = 2.5 / list.length;
  }

  portraitNow(uid) {
    const a = this.actorOf(uid);
    if (a) { this.portraits.shoot(a); this.ui.refreshFaces(); }
  }

  /** far-away characters (40 m+, and not walking) animate 10 times a second instead of every frame - you can't see
      the difference that far out, but big towns and dungeons run much smoother */
  lodUpdate(a, dt) {
    const cam = this.engine.camera.position;
    const far = a.pos.distanceToSquared(cam) > 1600 && !a.path.length && this.mode !== "combat";
    if (!far) { if (a._lodAcc) { dt += a._lodAcc; a._lodAcc = 0; } a.update(dt); return; }
    a._lodAcc = (a._lodAcc || 0) + dt;
    if (a._lodAcc >= 0.1) { a.update(a._lodAcc); a._lodAcc = 0; }
  }

  /** monsters (and animals) nearby make their noises now and then: robots whirr, slimes squelch, wolves growl */
  creatureChatter(dt) {
    this._chat = (this._chat || 0) - dt;
    if (this._chat > 0 || !this.player) return;
    this._chat = 0.6;
    const now = performance.now();
    const list = [...this.groups.flatMap((g) => g.actors), ...this.foes.values(), ...this.animals];
    for (const a of list) {
      if (a.anim.dead || !a.group.visible) continue;
      const h = this.hear(a, 24);
      if (h.vol <= 0) continue;
      if ((a._nextIdle || 0) > now) continue;
      a._nextIdle = now + 4000 + Math.random() * 7000 * (this.mode === "combat" ? 0.6 : 1);
      if (Math.random() < 0.55) this.audio.creature(a.info.sound || a.soundProfile(), "idle", { pan: h.pan, vol: 0.35 + 0.65 * h.vol, size: h.size });
    }
  }

  /** a glowing ring under whoever's turn it is */
  updateTurnRing(dt, t) {
    const a = this.mode === "combat" && this.turnUid ? this.actorOf(this.turnUid) : null;
    if (!a) { if (this.turnRing) this.turnRing.visible = false; return; }
    if (!this.turnRing) {
      this.turnRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 48), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.turnRing.rotation.x = -Math.PI / 2;
      this.engine.scene.add(this.turnRing);
    }
    const R = this.turnRing;
    R.visible = true;
    R.material.color.set(a.info.team === "enemy" ? 0xff6070 : 0xffd36a);
    const s = Math.max(0.8, a.radius * 1.6) * (1 + Math.sin(t * 5) * 0.06);
    R.scale.set(s, s, s);
    R.position.set(a.pos.x, a.pos.y + 0.06, a.pos.z);
    R.rotation.z += dt * 1.5;
  }

  /** a big banner across the screen (BATTLE!, VICTORY!, a boss's name...) */
  banner(text, sub = "", kind = "") {
    const b = $("banner");
    $("bannerText").textContent = text;
    $("bannerSub").textContent = sub;
    b.className = `banner ${kind}`;
    b.hidden = false;
    for (const el of [$("bannerText"), $("bannerSub")]) { el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; }
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => (b.hidden = true), 1700);
  }

  followers(dt) {
    const P = this.player;
    let i = 0;
    for (const a of this.party.values()) {
      if (a === P || a.anim.dead) continue;
      const side = i % 2 ? -1 : 1, back = 0.7 + Math.floor(i / 2) * 1.4;
      i++;
      const tx = P.pos.x - Math.sin(P.heading) * back + Math.cos(P.heading) * side * 1.7;
      const tz = P.pos.z - Math.cos(P.heading) * back - Math.sin(P.heading) * side * 1.7;
      const d = Math.hypot(tx - a.pos.x, tz - a.pos.z);
      if (d > 2.2 && (!a.path.length || (a._repath = (a._repath || 0) - dt) < 0)) {
        a._repath = 0.6;
        a.goTo(tx, tz, { run: d > 5 || P.speed > 4 });
      }
      if (d > 25) { a.pos.set(tx, 0, tz); a.path = []; }          // fell far behind: catch up
      if (!a.path.length && d < 2.2 && P.speed < 0.2) a.face(P.pos.x + Math.sin(P.heading) * 4, P.pos.z + Math.cos(P.heading) * 4);
    }
  }

  // NPC daily life: wander, visit places, chat with each other, patrol, work, rest - and turn to the player
  npcLife(a, dt, t) {
    const N = a.npc; if (!N) return;
    if (a.talking > 0 || this.talkPartner === a) {        // someone in a conversation doesn't wander off
      a.stop();
      if (this.player) a.face(this.player.pos.x, this.player.pos.z);
      N.next = Math.max(N.next, 2);
      return;
    }
    const dP = this.player ? a.pos.distanceTo(this.player.pos) : 99;
    if (dP > 50) return;                                // far away: don't think (cheap)
    if (dP < 3 && !a.path.length) { a.face(this.player.pos.x, this.player.pos.z); if (!N.greeted) { N.greeted = true; a.anim.play("greet"); } return; }
    if (dP > 6) N.greeted = false;
    if (this.fleeFrom && a.pos.distanceTo(this.fleeFrom) < 14 && N.doing !== "flee") {
      N.doing = "flee";
      const away = a.pos.clone().sub(this.fleeFrom).setY(0).normalize().multiplyScalar(14).add(a.pos);
      const p = this.world.nav.nearest(away.x, away.z, 8); if (p) a.goTo(p[0], p[1], { run: true });
      return;
    }
    N.next -= dt;
    if (N.next > 0 || a.path.length) return;
    const R = N.routine, nav = this.world.nav, pois = this.state.location.layout.spawns.npc;
    const what = R[Math.floor(Math.random() * R.length)];
    N.doing = what;
    if (what === "wander" || what === "run_around") {
      const p = nav.randomPoint(Math.random, N.home.x, N.home.z, what === "run_around" ? 12 : 9);
      if (p) a.goTo(p[0], p[1], { run: what === "run_around" });
      N.next = 3 + Math.random() * 5;
    } else if (what === "visit" || what === "patrol") {
      const poi = pois[Math.floor(Math.random() * pois.length)];
      if (poi) a.goTo(poi.x, poi.z);
      N.next = 5 + Math.random() * 6;
    } else if (what === "chat") {
      const other = [...this.npcs.values()].find((o) => o !== a && o.pos.distanceTo(a.pos) < 15);
      if (other) { a.goTo(other.pos.x, other.pos.z, { near: 1.5 }); setTimeout(() => { a.face(other.pos.x, other.pos.z); a.anim.play("talk"); other.face(a.pos.x, a.pos.z); }, 2500); }
      N.next = 6 + Math.random() * 4;
    } else if (what === "work" || what === "stall") {
      a.anim.play(Math.random() < 0.5 ? "item" : "attack");
      N.next = 2.5 + Math.random() * 3;
    } else if (what === "guard") {
      a.face(a.pos.x + Math.sin(t) * 5, a.pos.z + Math.cos(t) * 5);
      N.next = 4 + Math.random() * 4;
    } else {                    // rest
      a.anim.play(Math.random() < 0.5 ? "yes" : "talk");
      N.next = 6 + Math.random() * 6;
    }
  }

  animalLife(a, dt) {
    a.animal.next -= dt;
    if (a.animal.next > 0 || a.path.length) return;
    a.animal.next = 4 + Math.random() * 6;
    const p = this.world.nav.randomPoint(Math.random, a.pos.x, a.pos.z, 6);
    if (p) a.goTo(p[0], p[1]);
  }

  monsterLife(g, a, dt) {
    if (!this.player || this.busy) return;
    const d = a.pos.distanceTo(this.player.pos);
    const aggro = g.enc.boss ? 11 : 7.5;
    if (d < aggro && !g.engaging && this.mode === "explore") { g.engaging = true; this.engage(g.enc.id); return; }
    if (d < aggro + 6) {
      if (!a._alerted) { a._alerted = true; this.sound(a, "alert"); a.anim.play(Math.random() < 0.5 ? "roar" : "jump"); }
      a.face(this.player.pos.x, this.player.pos.z); a.showHp(true); return;
    }
    if (d > aggro + 12) a._alerted = false;
    a._t = (a._t || Math.random() * 4) - dt;
    if (a._t < 0 && !a.path.length) {
      a._t = 3 + Math.random() * 4;
      const p = this.world.nav.randomPoint(Math.random, a.home.x, a.home.z, 3.5);
      if (p) a.goTo(p[0], p[1]);
    }
  }

  checkTriggers() {
    const n = this.nearby();
    const pr = $("prompt");
    if (n && !this.busy) { pr.hidden = false; pr.innerHTML = `<kbd>E</kbd>${n.label}`; } else pr.hidden = true;
    if (this.pendingTalk && !this.player.path.length) { const a = this.pendingTalk; this.pendingTalk = null; if (a.pos.distanceTo(this.player.pos) < 3.2) this.talkTo(a.info.uid); }
    if (this.pendingChest && !this.player.path.length) { const c = this.pendingChest; this.pendingChest = null; if (Math.hypot(c.x - this.player.pos.x, c.z - this.player.pos.z) < 2.4) this.openChest(c); }
    // walking into an exit ring
    for (const ex of this.world.exits) {
      if (Math.hypot(ex.x - this.player.pos.x, ex.z - this.player.pos.z) < 1.2 && !this.busy && !this._exitCooldown) {
        this._exitCooldown = true; setTimeout(() => (this._exitCooldown = false), 3000);
        const lock = this.exitLock(ex);
        if (lock) this.ui.toast(lock, "bad"); else this.travel(ex.to);
      }
    }
  }

  labels() {
    const all = [...this.party.values(), ...this.npcs.values(), ...this.groups.flatMap((g) => g.actors), ...this.foes.values()];
    const cam = this.engine.camera.position;
    for (const a of all) {
      if (!a.label) continue;
      const s = this.engine.toScreen(a.labelPos());
      const far = a.pos.distanceTo(cam) > 30;
      a.label.style.display = s.visible && !far && a.label.dataset.hide !== "1" ? "" : "none";
      a.label.style.left = `${s.x}px`; a.label.style.top = `${s.y}px`;
    }
    this.world.labels(this.engine);
  }

  // ======================================================== talking to the engine
  async submitText() {
    const inp = $("actInput");
    const text = inp.value.trim();
    if (!text || this.busy) return;
    if (this.mode === "combat" && !this.myTurn) { this.ui.toast("Wait for your turn.", "bad"); return; }
    inp.value = "";
    this.ui.subtitle("player", this.state.party[0].name, text, { keep: 5000 });
    await this.request(() => call("action", text, `a${Date.now()}`, `r${Date.now()}`), "The Dungeon Master is thinking…");
  }

  /** run an engine call, show a 'thinking' state, then play the events it returns */
  async request(fn, waitText = "…") {
    if (this.busy) return null;
    this.busy = true;
    $("actSend").disabled = true;
    const prevTurn = $("turnChip").textContent;
    this.ui.setTurn(waitText, "wait");
    let r;
    try { r = await fn(); } catch (e) { r = { error: String(e) }; }
    if (r?.error) {
      this.busy = false; $("actSend").disabled = false;
      this.ui.toast(r.error, "bad");
      this.ui.setTurn(prevTurn, this.myTurn ? "you" : "");
      return r;
    }
    try {
      if (r.events) await this.play(r.events, r.state);
      else if (r.state) this.state = { ...(this.state || {}), ...r.state };
    } catch (e) { console.error(e); }
    this.busy = false;
    $("actSend").disabled = false;
    this.afterState();
    return r;
  }

  afterState() {
    this.ui.renderHud();
    const s = this.state;
    if (!s) return;
    if (s.combat) return;           // the battle director sets the chips
    this.healScene();
    this.mode = this.mode === "combat" ? "explore" : this.mode;
    this.myTurn = false;
    this.ui.setTurn("Explore", "");
    const n = this.state.location?.npcs || [];
    this.ui.setQuick([
      { label: "🔍 Search", fn: () => this.request(() => call("action", "I search the area carefully"), "Searching…") },
      { label: "🛌 Rest", fn: () => this.request(() => call("rest"), "Resting…") },
      { label: "❗ What now?", fn: () => this.request(() => call("action", "What should we do next? Where is our objective?"), "…") },
      ...n.filter((x) => x.shop).slice(0, 2).map((x) => ({ label: `${x.trader ? "🪙" : "🛒"} ${x.trader ? "Trader" : "Shop"}: ${x.name.split(" ")[0]}`, fn: () => this.walkThen(x.id, () => this.openShop(x.id)) })),
      ...n.filter((x) => !x.shop).slice(0, 2).map((x) => ({ label: `💬 ${x.name.split(" ")[0]}`, fn: () => this.talkTo(x.id) })),
    ]);
    if (s.pending_cards.length && $("cardPick").hidden) this.showCards();
    if (s.status === "complete" && $("results").hidden) this.showResults();
  }

  // ======================================================== exploring actions
  async talkTo(id) {
    if (this.busy) return;
    const a = this.npcs.get(id);
    if (!a) return;
    const name = a.info.name;
    this.talkPartner = a;
    a.stop(); a.face(this.player.pos.x, this.player.pos.z); this.player.face(a.pos.x, a.pos.z);
    a.anim.play("greet");
    this.engine.shot(this.player.pos.clone().add(V3(Math.sin(this.player.heading + 2.2) * 3.5, 2, Math.cos(this.player.heading + 2.2) * 3.5)), a.pos.clone().add(V3(0, 1.4, 0)), 3);
    const shopBtn = a.info.shop ? { label: a.info.trader ? "🪙 See the trader's goods" : "🛒 Shop", fn: () => this.openShop(id) } : null;
    const said = await this.askText(`Talk to ${name}`, `What do you say to ${name}? (${a.info.personality} ${a.info.role})`, "Hello! What's happening around here?", shopBtn);
    if (said == null) { this.engine.shot(null); if (!this._shopOpen) this.talkPartner = null; return; }
    this.ui.subtitle("player", this.state.party[0].name, said, { keep: 5000 });
    await this.request(() => call("talk", id, said), `${name} is thinking…`);
    setTimeout(() => { this.engine.shot(null); if (this.talkPartner === a) this.talkPartner = null; }, 2500);
  }

  /** walk up to someone first, then do something (shop chips) */
  walkThen(id, fn) {
    const a = this.npcs.get(id);
    if (!a || !this.player) return fn();
    if (a.pos.distanceTo(this.player.pos) < 3.5) { this.player.face(a.pos.x, a.pos.z); return fn(); }
    this.talkPartner = a;
    this.player.goTo(a.pos.x, a.pos.z, { near: 1.8, run: true });
    this.waitUntil(() => !this.player.path.length, 8000).then(() => { this.player.face(a.pos.x, a.pos.z); fn(); });
  }

  async openShop(id) {
    this.talkPartner = this.npcs.get(id) || null;
    await this.request(() => call("shop", id), "…");
  }

  askText(title, label, placeholder, extra = null) {
    return new Promise((res) => {
      const inp = h("input", { class: "", placeholder, maxlength: 300, style: "width:100%;padding:10px 12px;border-radius:10px;border:2px solid rgba(150,230,240,.3);background:rgba(0,0,0,.3)" });
      this.ui.dialog(title, [h("p", { class: "muted" }, label), inp], [
        { label: "Never mind", fn: () => res(null) },
        ...(extra ? [{ label: extra.label, fn: () => { res(null); extra.fn(); } }] : []),
        { label: "Say it", primary: true, fn: () => res(inp.value.trim() || placeholder) },
      ]);
      setTimeout(() => inp.focus(), 50);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { $("dialog").hidden = true; res(inp.value.trim() || placeholder); } });
    });
  }

  async openChest(ch) {
    this.player.face(ch.x, ch.z);
    this.player.anim.play("item");
    await this.request(() => call("open_treasure", ch.id), "Opening…");
  }

  async travel(dest) {
    if (this.busy || this._travelling || this.mode !== "explore") return;
    this._travelling = true;                    // E key + walking into the ring + the map can't start two trips
    try {
      $("fade").className = "black";
      await sleep(500);
      await this.request(() => call("travel", dest), "Travelling…");
    } finally {
      this._travelling = false;
      if (this.mode !== "loading") $("fade").className = "";
    }
  }

  async engage(encId) {
    if (this.busy || this.mode !== "explore") return;
    this.player.stop();
    await this.request(() => call("engage", encId), "Battle!");
  }

  // ---------------- backpack actions (from the UI) ----------------
  async useItem(it) {
    const r = await this.request(() => call("use_item", it.uid, this.ui.member().uid), "Using…");
    if (!r?.error) this.ui.toast(`Used ${it.name}`, "good");
  }
  async equip(actor, item) { const r = await call("equip", actor, item); if (r.error) this.ui.toast(r.error, "bad"); else { this.state = r.state; this.ui.renderHud(); this.refreshWeapons(); } }
  async unequip(actor, slot) { const r = await call("unequip", actor, slot); if (r.error) this.ui.toast(r.error, "bad"); else { this.state = r.state; this.ui.renderHud(); } }
  async compare(actor, item) { const r = await call("compare", actor, item); return r.diff || {}; }
  async discard(it) { if (!confirm(`Throw away ${it.name}?`)) return; const r = await call("discard", it.uid); if (r.error) this.ui.toast(r.error, "bad"); else { this.state = r.state; this.ui.renderHud(); } }
  pickWearer(it) {
    this.ui.dialog(`Who wears ${it.name}?`, [h("p", { class: "muted" }, "Pick a party member.")],
      [...this.state.party.map((p) => ({ label: p.name, fn: () => this.equip(p.uid, it.uid) })), { label: "Cancel" }]);
  }
  async dismiss(p) {
    if (!confirm(`${p.name} will leave the party and wait in the last town. OK?`)) return;
    await this.request(() => call("dismiss", p.uid), "…");
    const a = this.party.get(p.uid); if (a) { a.dispose(); this.party.delete(p.uid); }
  }
  async setSetting(ch) {
    const r = await call("settings", ch);
    if (r.settings && this.state) { this.state.settings = r.settings; this.ui.renderHud(); }
  }
  refreshWeapons() { /* weapons update visually next time the place loads */ }

  abilityInfo(id) { return this.info.abilities?.[id] || { name: id }; }
  cardInfo(id) { return this.info.cards?.[id] || { name: id, desc: "", rarity: "common" }; }
  classAbilities(cls) { return this.info.class_abilities?.[cls] || []; }

  /** draw a card's art: the 3D Card Kit model rendered once to a small canvas */
  cardArt(id, el) {
    this._cardR ||= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    const R = this._cardR;
    R.setSize(176, 120, false);
    R.outputColorSpace = THREE.SRGBColorSpace;
    if (!id || !A.urlOf(id)) { el.textContent = "🃏"; return; }
    A.load(id).then((g) => {
      const sc = new THREE.Scene();
      sc.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
      const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(1, 2, 3); sc.add(d);
      const m = g.scene.clone(true);
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(V3()), c = box.getCenter(V3());
      m.position.sub(c);
      sc.add(m);
      const cam = new THREE.PerspectiveCamera(30, 176 / 120, 0.01, 100);
      cam.position.set(0, size.y * 0.15, Math.max(size.x, size.y) * 2.1);
      cam.lookAt(0, size.y * 0.15, 0);
      R.render(sc, cam);
      const img = new Image(); img.src = R.domElement.toDataURL(); el.replaceChildren(img);
    }).catch(() => (el.textContent = "🃏"));
  }

  showCards() {
    const offer = this.state.pending_cards[0];
    if (!offer) return;
    this.audio.sfx("levelup");
    this.ui.showCardPick(offer, async (cid) => {
      $("cardPick").hidden = true;
      const r = await call("choose_card", offer.id, cid);
      if (r.error) { this.ui.toast(r.error, "bad"); return; }
      this.state = r.state;
      this.ui.toast(`${r.result.card} → ${r.result.target}`, "good");
      this.vfx.levelUp(this.party.get(offer.target)?.pos || this.player.pos);
      this.afterState();
    });
  }

  async showResults() {
    const r = await call("results");
    if (r.error) return;
    this.audio.sfx("victory");
    this.ui.renderResults(r.results, {
      onNew: () => location.reload(),
      onAssistant: () => this.backToAssistant(),
      onExport: async (fmt) => { const x = await call("export", fmt); if (x.error) this.ui.toast(x.error, "bad"); else this.ui.toast(`Saved to ${x.path}`, "good"); },
    });
  }

  // ---------------- saves & settings ----------------
  async showSaves() {
    const r = await call("saves");
    const list = r.saves || [];
    const running = !!this.state && this.state.status === "active";
    $("saveList").replaceChildren(...list.map((s) => h("div", { class: "save" },
      h("div", {}, h("b", {}, s.slot === "auto" ? "Autosave" : `Slot ${s.slot}`), h("div", { class: "muted" }, s.empty ? "Empty" : s.damaged ? "Damaged save" :
        `${s.title || "Adventure"} · ${s.player} Lv ${s.level} ${s.cls} · ${s.location} · ${Math.round((s.play_seconds || 0) / 60)} min${s.status === "complete" ? " · finished" : ""}`)),
      h("div", { class: "btns" },
        running && s.slot !== "auto" ? h("button", { class: "small", onclick: async () => {
          if (!s.empty && !confirm("Overwrite this save?")) return;
          const x = await call("save", s.slot); if (x.error) this.ui.toast(x.error, "bad"); else { this.ui.toast("Saved.", "good"); this.showSaves(); } } }, "Save here") : null,
        !s.empty && !s.damaged ? h("button", { class: "small", onclick: () => this.loadSlot(s.slot) }, "Load") : null,
        !s.empty && s.slot !== "auto" ? h("button", { class: "small danger", onclick: async () => { if (confirm("Delete this save?")) { await call("delete_save", s.slot); this.showSaves(); } } }, "Delete") : null))));
    $("saves").hidden = false;
  }

  async loadSlot(slot) {
    $("saves").hidden = true;
    this.loading("Loading your adventure…");
    const r = await call("load", slot);
    this.loading(null);
    if (r.error) { alert(r.error); return; }
    this.state = r.state;
    this.titleV?.dispose(); this.titleV = null;
    this.portal?.dispose(); this.portal = null;
    $("title").hidden = true; $("create").hidden = true; $("results").hidden = true;
    await this.enterWorld(null);
    this.ui.subtitle("dm", "Dungeon Master", `Welcome back. You are at ${this.state.location.name}.`);
  }

  showSettings() {
    document.querySelectorAll(".cn").forEach((e) => (e.textContent = companionName()));
    const s ={ ...this.audio.vol, ...(this.state?.settings || {}), voice: this.state?.settings?.voice ?? true };
    for (const r of document.querySelectorAll("[data-vol]")) {
      const out = document.querySelector(`[data-out="${r.dataset.vol}"]`);
      r.value = s[r.dataset.vol] ?? this.audio.vol[r.dataset.vol] ?? 0.7;
      if (out) out.textContent = `${Math.round(r.value * 100)}%`;
      r.oninput = () => {
        if (out) out.textContent = `${Math.round(r.value * 100)}%`;
        this.audio.resume();
        this.audio.setVolumes({ [r.dataset.vol]: +r.value });
        clearTimeout(this._volT);
        this._volT = setTimeout(() => { if (this.state) this.setSetting({ [r.dataset.vol]: +r.value }); }, 250);
      };
    }
    $("testVoice").onclick = async () => {
      this.audio.resume();
      if (!this.state) { this.ui.toast("Start or load an adventure first - the voices belong to your campaign.", "bad"); return; }
      for (const [who, name, line] of [["dm", "Dungeon Master", "The wind shifts. Somewhere, a door creaks open."], ["vermeil", companionName(), "Can you hear me? Good. Let's go."]]) await this.speak(who, name, line);
    };
    $("setVoice").checked = s.voice !== false;
    $("setVoice").onchange = () => this.setSetting({ voice: $("setVoice").checked });
    $("setSkipPortal").checked = !!s.skip_portal;
    $("setSkipPortal").onchange = () => this.setSetting({ skip_portal: $("setSkipPortal").checked });
    $("setVControl").value = s.vermeil_control || "auto";
    $("setVControl").onchange = () => this.setSetting({ vermeil_control: $("setVControl").value });
    $("setAControl").value = s.ally_control || "auto";
    $("setAControl").onchange = () => this.setSetting({ ally_control: $("setAControl").value });
    $("setQuality").value = this.engine.quality;
    $("setQuality").onchange = () => { const q = $("setQuality").value; localStorage.setItem("vda_quality", q); this.engine.setQuality(q); this.ui.toast(`Graphics: ${q}`); };
    $("setPerf").value = this.engine.perf;
    $("setPerf").onchange = () => { const p = $("setPerf").value; localStorage.setItem("vda_perf", p); this.engine.setPerf(p); this.ui.toast(`Performance: ${$("setPerf").selectedOptions[0].text}`); };
    $("setTest").checked = !!s.test_mode;
    $("setTest").disabled = !this.state;
    $("setTest").onchange = async () => {
      await this.setSetting({ test_mode: $("setTest").checked });
      const r = await call("state");                  // the map shows every place's name in test mode
      if (r.state) this.state = { ...this.state, ...r.state };
      this.drawTestPanel();
    };
    this.drawTestPanel();
    $("settingsScreen").hidden = false;
  }

  // ---------------- 🧪 test mode: teleport, unlock, skip quest steps, change the party, level, gold, heal, win
  drawTestPanel() {
    const box = $("testPanel"), st = this.state;
    box.hidden = !st?.settings?.test_mode;
    if (box.hidden) return;
    const C = this.info;
    const run = async (cmd, arg, wait = "Test mode…") => {
      $("settingsScreen").hidden = true;
      if (cmd === "teleport" || cmd === "boss") { $("fade").className = "black"; await sleep(400); }
      await this.request(() => call("test", cmd, arg), wait);
      if (this.mode !== "loading") $("fade").className = "";
    };
    const sel = (id, opts) => h("select", { id }, opts.map(([v, t]) => h("option", { value: v }, t)));
    const places = [...(st.map || [])].sort((a, b) => a.col - b.col);
    const party = st.party.filter((p) => p.kind !== "player" && p.kind !== "summon");
    const btn = (label, fn) => h("button", { type: "button", class: "small", onclick: fn }, label);
    box.replaceChildren(
      h("p", { class: "muted" }, "Cheats for testing. They're saved with this adventure while test mode is on."),
      h("div", { class: "test-row" }, sel("tPlace", places.map((p) => [p.id, `${p.boss ? "💀 " : p.safe ? "🏠 " : ""}${p.name} · Lv ${p.level}${p.here ? " (here)" : ""}`])),
        btn("🌀 Teleport", () => run("teleport", $("tPlace").value, "Teleporting…"))),
      h("div", { class: "test-row" }, btn("💀 Go to the final boss", () => run("boss", null, "Teleporting…")),
        btn(st.test_unlock ? "🔒 Lock roads again" : "🔓 Unlock every road", () => run("unlock", !st.test_unlock)),
        btn("⏭ Finish this quest step", () => run("next_stage"))),
      h("div", { class: "test-row" }, sel("tSpecies", C.species.filter((s) => s.available).map((s) => [s.id, s.name])),
        sel("tClass", C.classes.map((c) => [c.id, c.name])),
        btn("➕ Add hero", () => run("add_member", { species: $("tSpecies").value, cls: $("tClass").value })),
        btn("➕ Add monster", () => run("add_member", { monster: true }))),
      h("div", { class: "test-row" }, sel("tMember", party.length ? party.map((p) => [p.uid, `${p.name} (Lv ${p.level})`]) : [["", "nobody to remove"]]),
        btn("➖ Remove", () => $("tMember").value && run("remove_member", $("tMember").value))),
      h("div", { class: "test-row" }, h("input", { id: "tLevel", type: "number", min: 1, max: 100, value: st.party[0]?.level || 1, style: "width:80px" }),
        btn("⬆ Set party level", () => run("level", +$("tLevel").value)),
        btn("💰 +1000 gold", () => run("gold", 1000)), btn("❤ Full heal", () => run("heal")),
        btn("🏆 Win this fight", () => run("win")), btn("🃏 Offer Mythic cards", () => run("mythic"))),
    );
  }

  // ======================================================== speech: subtitles + voice, in sync
  /** every line goes through ONE queue: a new line never cuts off the one being spoken */
  speak(speaker, name, text, mood) {
    if (!text) return Promise.resolve();
    // start making this line's first sentence NOW, while earlier lines are still being spoken - so there's no
    // silent gap between lines (at most 2 lines ahead, so the current line isn't slowed down)
    let pre = null;
    if (this.state?.settings.voice !== false && this.voiceOn && (this.speechAhead || 0) < 2) {
      this.speechAhead = (this.speechAhead || 0) + 1;
      pre = call("speak", speaker, splitSpeech(text)[0]);
      const done = () => { this.speechAhead--; };
      Promise.resolve(pre).then(done, done);
    }
    const run = () => this._speak(speaker, name, text, mood, pre);
    this.speechQ = (this.speechQ || Promise.resolve()).then(run, run);
    return this.speechQ;
  }

  async _speak(speaker, name, text, mood, pre = null) {
    // the line stays on screen until the voice has finished (however long it is), then fades a little later
    const el = this.ui.subtitle(speaker, name, text, { hold: true });
    const actor = speaker === "vermeil" ? this.party.get("vermeil") : this.npcs.get(speaker) || this.party.get(speaker);
    const readTime = Math.min(16000, 1600 + text.length * 55);          // reading time when there is no voice
    try {
      if (this.state?.settings.voice !== false && this.voiceOn) {
        // speak sentence by sentence: the first one starts as soon as it's ready, and the next one is being made
        // while this one plays - so a long narration starts in ~1-2 s instead of waiting for the whole thing
        const parts = splitSpeech(text);
        const group = speaker === "dm" ? "dm" : speaker === "vermeil" ? "vermeil" : "npc";
        el.classList.add("waiting");
        let next = pre || call("speak", speaker, parts[0]);
        let played = 0, revealed = false;
        for (let i = 0; i < parts.length; i++) {
          const r = await next;
          if (i === 0) el.classList.remove("waiting");
          next = i + 1 < parts.length ? call("speak", speaker, parts[i + 1]) : null;      // prefetch the next sentence
          if (!r?.audio) {
            if (r?.error && /no voice|not available/.test(r.error)) this.voiceOn = false;
            if (i === 0) break;              // no voice at all -> reading mode below
            continue;
          }
          if (!revealed) {                   // words appear over the estimated length of the whole line
            const est = r.seconds * text.length / Math.max(1, parts[0].length);
            actor?.say(est, mood);
            this.ui.reveal(el, est);
            revealed = true;
          }
          const t0 = performance.now();
          await this.audio.playVoice(r.audio, group);
          const left = Math.max(0, r.seconds * 1000 - (performance.now() - t0));
          if (left > 300) await sleep(left);
          played++;
        }
        if (played) {
          el.release(Math.max(2500, Math.min(7000, text.length * 25)));
          return;
        }
      }
      actor?.say(readTime / 1000, mood);
      this.ui.reveal(el, Math.min(readTime, 6000) / 1000);
      el.release(readTime + 2000);
      await sleep(Math.min(readTime, 3200));
    } catch (e) {
      el.release(readTime);
      throw e;
    }
  }

  // ======================================================== playing the engine's events in order
  async play(events, newState) {
    if (newState) this.state = { ...(this.state || {}), ...newState };     // talk replies send a smaller state
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      try {
        switch (e.type) {
          case "speech": await this.speak(e.speaker, e.name, e.text, e.mood); break;
          case "dice": if (!e.quiet) await this.dice.roll(e, { fast: this.mode === "combat", who: this.nameOf(e.who) }); break;
          case "check": this.ui.subtitle("sys", "", `${e.success ? "Success" : "Failure"} — ${e.stat.toUpperCase()} check ${e.total} vs ${e.dc}`); break;
          case "travel": await this.onTravel(e, newState); break;
          case "combat_start": await this.battleStart(e, newState); break;
          case "action": i = await this.playAction(events, i); break;
          case "turn": this.turnUid = e.uid; this.ui.renderInitiative(); this.highlightTurn(e.uid); break;
          case "round": this.ui.subtitle("sys", "", `Round ${e.round}`, { keep: 2500 }); break;
          case "your_turn": this.yourTurn(e); break;
          case "status": this.onStatus(e); break;
          case "log": this.ui.subtitle("sys", "", e.text, { keep: 5000 }); await sleep(500); break;
          case "enemy_flee": { const a = this.foes.get(e.uid); this.ui.subtitle("sys", "", e.text); if (a) { a.goTo(a.pos.x * 3, a.pos.z * 3, { run: true }); setTimeout(() => a.dispose(), 2500); this.foes.delete(e.uid); } break; }
          case "vanish": { const a = this.foes.get(e.uid) || this.party.get(e.uid); this.ui.subtitle("sys", "", e.text); if (a) { this.vfx.castAt("summon", a.pos); a.dispose(); this.foes.delete(e.uid); this.party.delete(e.uid); } break; }
          case "summon": await this.onSummon(e); break;
          case "boss_phase": { const a = this.foes.get(e.uid); if (a) { a.anim.play("roar"); this.vfx.castAt("buff_red", a.pos, a.height); this.engine.cam.shake = 1; } this.audio.sfx("impact_big"); await this.speak("dm", "Dungeon Master", e.line); break; }
          case "combat_end": await this.battleEnd(e); break;
          case "level_up": this.onLevelUp(e); await sleep(700); break;
          case "milestone": this.ui.toast(`Milestone: level ${e.level}!${e.unlock ? " New power unlocked." : ""}`, "good"); break;
          case "card_offer": break;   // shown after the events (afterState)
          case "loot": this.onLoot(e.items, e.text); break;
          case "chest": this.world.openChest(e.id); this.onLoot(e.items, e.gold ? `+${e.gold} gold` : ""); await sleep(600); break;
          case "reveal": { const ch = this.world.chests.find((c) => c.id === e.treasure); if (ch) { this.vfx.pillar(V3(ch.x, 0, ch.z), 0xffe080, 4, 2.5, 0.6); this.player.face(ch.x, ch.z); } break; }
          case "quest_update": this.ui.toast(e.next ? `Done: ${e.done}. Next: ${e.next}` : `Done: ${e.done}`, "good"); this.audio.sfx("levelup"); break;
          case "quest_new": this.ui.toast(e.text, ""); break;
          case "quest_done": this.ui.toast(e.text, "good"); break;
          case "recruit_offer": await this.recruitDialog(e); break;
          case "recruit_full": await this.recruitDialog(e, true); break;
          case "recruit": await this.onRecruit(e); break;
          case "monster_offer": await this.monsterOffer(e); break;
          case "dismiss": this.ui.toast(e.text); break;
          case "shop": this.shopDialog(e); break;
          case "trader": this.banner("A wandering trader!", e.name, "level"); this.audio.sfx("coin"); this.ui.toast(`${e.name} the trader has set up camp here. Rare goods!`, "good"); break;
          case "rest": for (const a of this.party.values()) { a.anim.revive(); this.vfx.castAt("heal", a.pos, a.height); } break;
          case "item_used": for (const a of this.party.values()) if (a.info.uid === e.target) this.vfx.castAt("potion", a.pos, a.height); break;
          case "heal": case "mana": this.applyHp(e); break;
          case "hit": case "miss": case "death": case "revive": await this.applyResult(e); break;
          case "map_update": this.ui.toast("A new path has opened on your map."); break;
          case "campaign_complete": await sleep(1500); this.showResults(); break;
          case "intent": break;
          default: break;
        }
      } catch (err) { console.error("event failed", e, err); }
    }
    this.ui.renderHud();
  }

  nameOf(uid) {
    if (!uid) return "";
    const p = this.state?.party.find((x) => x.uid === uid);
    if (p) return p.name;
    const c = this.state?.combat?.actors.find((x) => x.uid === uid);
    return c?.name || "";
  }

  actorOf(uid) { return this.party.get(uid) || this.foes.get(uid); }

  async onTravel(e, st) {
    try { this.endBattleVisuals(); } catch (err) { console.warn("battle cleanup", err); }
    if (e.defeat) { $("fade").className = "black"; await sleep(800); }
    this.state = st || this.state;
    try { await this.buildLocation(e.location || this.state.location, { from: e.from }); }
    finally { this.mode = "explore"; $("fade").className = ""; }
  }

  /** safety net: if what's on screen isn't the place the engine says we're in, rebuild it */
  healScene() {
    const loc = this.state?.location;
    if (!loc?.layout || !this.builtId || loc.id === this.builtId || this._healing || this.busy || this.mode === "combat" || this.mode === "loading") return;
    console.warn(`scene shows ${this.builtId} but we're in ${loc.id} - rebuilding`);
    this._healing = true;
    this.buildLocation(loc).finally(() => { this._healing = false; this.mode = "explore"; $("fade").className = ""; });
  }

  // ======================================================== battles
  async battleStart(e, st) {
    this.mode = "combat";
    this.world.inCombat = true;
    this.myTurn = false;
    this.talkPartner = null;
    this.audio.sfx("battle_start");
    this.audio.battle(true, e.boss);
    const boss = e.enemies.find((x) => x.kind === "boss");
    this.ui.setQuick([]); this.ui.setTurn("Battle!", "enemy");
    if (boss) this.banner(boss.name, "The final battle", "boss"); else this.banner("BATTLE!", e.enemies.map((x) => x.name).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(" · "), "battle");
    this.engine.cam.shake = 0.6;
    this.fleeFrom = this.player.pos.clone();
    // which waiting monster group is it? the closest one
    let grp = null, bd = 1e9;
    for (const g of this.groups) { const d = g.actors.length ? g.actors[0].pos.distanceTo(this.player.pos) : 1e9; if (d < bd) { bd = d; grp = g; } }
    // battle line: party on the player's side, enemies opposite
    const P = this.player.pos.clone();
    const E = grp?.actors[0]?.pos.clone() || P.clone().add(V3(0, 0, 6));
    const dir = E.clone().sub(P).setY(0); if (dir.lengthSq() < 0.1) dir.set(0, 0, 1); dir.normalize();
    const mid = P.clone().add(E).multiplyScalar(0.5);
    const right = V3(dir.z, 0, -dir.x);
    // big monsters need room: spacing and distance grow with the largest one (a house-sized boss stands well back)
    const bigE = Math.max(1.8, ...e.enemies.map((x) => x.size || (x.kind === "boss" ? 3.5 : 1.8)));
    const eGap = Math.max(2.4, bigE * 0.75), eBack = 3.4 + Math.max(0, bigE - 1.8) * 0.45;
    this.battleScale = Math.max(1, bigE / 2.2);
    const spot = (side, k, n) => { const off = (k - (n - 1) / 2) * (side > 0 ? eGap : 2.4); const p = mid.clone().add(dir.clone().multiplyScalar(side * (side > 0 ? eBack : 3.4))).add(right.clone().multiplyScalar(off));
      const q = this.world.nav.nearest(p.x, p.z, 4); return q ? V3(q[0], 0, q[1]) : p; };
    this.battle = { mid, dir, right, spots: {} };
    // party members (allies that weren't visible yet get created)
    const party = e.party;
    for (let k = 0; k < party.length; k++) {
      const p = party[k];
      let a = this.party.get(p.uid);
      if (!a) { a = await Actor.create(this.world, { ...p }); this.party.set(p.uid, a); a.pos.copy(P); }
      a.info = { ...a.info, ...p };
      const s = spot(-1, k, party.length);
      this.battle.spots[p.uid] = s;
      a.goTo(s.x, s.z, { run: true });
      a.combat = true;
      a.showHp(true);
      a.setHp(p.hp, p.max_hp);
    }
    // enemies: reuse the waiting group's models
    const used = new Set();
    for (let k = 0; k < e.enemies.length; k++) {
      const en = e.enemies[k];
      let a = grp?.actors.find((x, j) => !used.has(j) && x.info.name === en.name && (used.add(j), true));
      if (!a) { a = await Actor.create(this.world, { ...en }); a.pos.copy(E); }
      a.info = { ...a.info, ...en };
      a.label.querySelector(".n").textContent = `${en.name} · Lv ${en.level}`;
      a.label.className = `lbl enemy ${en.kind === "boss" ? "boss" : ""}`;
      a.info.sound = en.sound || a.info.sound;
      a.onStep = (x) => this.footstep(x);
      this.foes.set(en.uid, a);
      const s = spot(1, k, e.enemies.length);
      this.battle.spots[en.uid] = s;
      a.goTo(s.x, s.z, { run: true });
      a.combat = true;
      a.showHp(true);
      a.setHp(en.hp, en.max_hp);
    }
    if (grp) { for (const a of grp.actors) if (![...this.foes.values()].includes(a)) a.dispose(); this.groups = this.groups.filter((g) => g !== grp); }
    for (const a of this.npcs.values()) a.label.dataset.hide = "1";
    // camera: first a look at the enemies (they roar), then a side view of both lines (never from inside a tree)
    const E0 = [...this.foes.values()][0];
    const eAt = E0 ? E0.pos.clone().add(V3(0, E0.height * 0.6, 0)) : null;
    const eK = E0 ? Math.max(1, E0.height / 2.2) : 1;           // frame big monsters from further away
    const eFrom = E0 ? this.clearView([0, 0.6, -0.6, 1.2].map((a) => E0.pos.clone().add(dir.clone().multiplyScalar(-4.5 * eK).applyAxisAngle(V3(0, 1, 0), a)).add(V3(0, 2.4 * Math.sqrt(eK), 0))), eAt, [...this.foes.values()].map((f) => f.pos.clone().add(V3(0, f.height * 0.6, 0)))) : null;
    if (E0 && eFrom) {
      this.engine.shot(eFrom, eAt, 3);
      setTimeout(() => { for (const f of this.foes.values()) { f.anim.play("roar"); } this.sound(E0, "alert"); }, 350);
      await sleep(1100);
    }
    const K = this.battleScale;
    const wideAt = mid.clone().add(V3(0, 1 + (K - 1) * 1.2, 0)).add(dir.clone().multiplyScalar((K - 1) * 1.2));
    const wideOpts = [];
    // try spots all around the fight (low first, then higher - looking down over rocks), and take the first one that
    // sees every fighter; if none does, the one that hides the fewest
    for (const h of [6.5, 9, 12, 16]) for (const a of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
      const r = h > 12 ? 0.75 : 1;                              // the highest ones come in a little closer
      wideOpts.push(mid.clone().add(right.clone().multiplyScalar(-9 * K * r).add(dir.clone().multiplyScalar(-6 * K * r)).applyAxisAngle(V3(0, 1, 0), a)).add(V3(0, h * Math.sqrt(K), 0)));
    }
    this.battle.wide = { pos: this.clearView(wideOpts, wideAt, this.fighterPoints()) || wideOpts[0], at: wideAt };
    this.engine.shot(this.battle.wide.pos, this.battle.wide.at, 2);
    await sleep(900);
    for (const [uid, s] of Object.entries(this.battle.spots)) { const a = this.actorOf(uid); if (a) { a.pos.x = s.x; a.pos.z = s.z; a.path = []; a.face(mid.x + dir.x * (a.info.team === "enemy" ? -5 : 5), mid.z + dir.z * (a.info.team === "enemy" ? -5 : 5)); } }
    this.ui.renderHud();
  }

  highlightTurn(uid) {
    for (const a of [...this.party.values(), ...this.foes.values()]) a.label.classList.toggle("target", a.info.uid === uid);
    const a = this.actorOf(uid);
    if (!a) return;
    const isParty = a.info.team === "party";
    this.ui.setTurn(isParty ? `${a.info.name}'s turn` : `${a.info.name} acts`, isParty ? "" : "enemy");
    this.myTurn = false;
  }

  yourTurn(e) {
    this.myTurn = true;
    this.turnUid = e.uid;
    const who = this.actorOf(e.uid);
    this.audio.sfx("your_turn");
    this.banner(who && who !== this.player ? `${who.info.name}'s move` : "YOUR TURN", "", "turn");
    this.ui.setTurn(`Your turn${who && who !== this.player ? ` (${who.info.name})` : ""} — type an action or pick one`, "you");
    const o = e.options;
    const foes = o.enemies;
    const target = (fn) => {
      if (foes.length === 1) return fn(foes[0].uid);
      this.ui.toast("Click an enemy to target it.");
      this.targeting = (a) => { this.targeting = null; fn(a.info.uid); };
    };
    const quick = o.abilities.filter((a) => a.id !== "basic_shot" || o.abilities[0].id === "basic_shot").map((a) => ({
      label: a.name + (a.cost ? ` (${a.cost})` : ""), el: a.element, off: !a.ok, title: a.ok ? a.desc : a.why,
      fn: () => a.target === "enemy" ? target((t) => this.act(e.uid, { type: "ability", ability: a.id, target: t })) :
        a.target === "ally" ? this.pickAlly(e.uid, a.id) : this.act(e.uid, { type: "ability", ability: a.id }),
    }));
    quick.push({ label: "🛡 Defend", fn: () => this.act(e.uid, { type: "defend" }) });
    for (const it of o.items.slice(0, 3)) quick.push({ label: `🧪 ${it.name} ×${it.qty}`, fn: () => this.act(e.uid, { type: "item", item: it.uid, target: e.uid }) });
    if (o.can_flee) quick.push({ label: "🏃 Flee", fn: () => this.act(e.uid, { type: "flee" }) });
    this.ui.setQuick(quick);
    $("actInput").placeholder = "Your turn! e.g. “I slash the goblin” or “I throw sand in its eyes”";
    this.ui.renderHud();
  }

  pickAlly(uid, ability) {
    this.ui.dialog("Who?", [h("p", { class: "muted" }, "Choose an ally.")],
      [...this.state.party.filter((p) => p.alive).map((p) => ({ label: p.name, fn: () => this.act(uid, { type: "ability", ability, target: p.uid }) })), { label: "Cancel" }]);
  }

  async act(uid, action) {
    if (!this.myTurn || this.busy) return;
    this.myTurn = false;
    this.targeting = null;
    this.ui.setQuick([]);
    await this.request(() => call("combat_act", uid, action), "Resolving…");
  }

  /** an 'action' and its results (dice, hits, misses, statuses) up to the next action/turn */
  async playAction(events, i) {
    const e = events[i];
    let j = i + 1;
    const results = [];
    while (j < events.length && !["action", "turn", "round", "your_turn", "combat_end", "speech"].includes(events[j].type)) results.push(events[j++]);
    const a = this.actorOf(e.uid);
    const targets = (e.targets || []).map((u) => this.actorOf(u)).filter(Boolean);
    // party members attack with their weapon's own move (daggers stab, hammers smash, bows shoot from where they stand)
    if (a?.weaponKind && a.info.team === "party" && ["attack", "attack_heavy", "attack_fast", "punch"].includes(e.anim || "attack")) {
      e.anim = WEAPON_ATTACK[a.weaponKind] || e.anim;
      if (a.weaponKind === "bow") { e.ranged = true; e.vfx = e.vfx && e.vfx !== "slash" ? e.vfx : "arrow"; }
    }
    const melee = !e.ranged && ["attack", "attack_heavy", "attack_fast", "punch", "spin", "bash", "stab", "thrust", "smash", "chop", "staff_strike", "shield_bash"].includes(e.anim) && targets.length === 1 && a && targets[0] !== a && e.vfx !== "bite_ranged";
    this.ui.subtitle("sys", "", `${this.nameOf(e.uid)}: ${e.name}`, { keep: 3000 });
    // the attack roll first (so you see the dice decide)
    const pre = results.filter((r) => r.type === "dice" && (r.reason === "attack" || /check|steal|flee/.test(r.reason)));
    for (const r of pre) await this.dice.roll(r, { fast: true, who: this.nameOf(r.who) });
    let home = null;
    if (a && melee) {
      home = a.pos.clone();
      const t = targets[0];
      const to = t.pos.clone().sub(a.pos).setY(0); const d = to.length();
      const stopAt = Math.max(1.0, (t.radius || 0.5) + (a.radius || 0.5) + 0.3);
      const dest = a.pos.clone().add(to.normalize().multiplyScalar(Math.max(0, d - stopAt)));
      a.path = [[dest.x, dest.z]]; a.maxSpeed = 7;
      await sleep(Math.min(700, d * 110));
      a.path = []; a.face(t.pos.x, t.pos.z);
    } else if (a && targets[0] && targets[0] !== a) a.face(targets[0].pos.x, targets[0].pos.z);
    // the motion
    let impact = Promise.resolve();
    if (a) {
      const P = a.anim.play(e.anim || "attack");
      impact = P.impact;
      if (/attack|punch|spin|bash|shoot|cast|roar|stab|thrust|smash|chop|strike/.test(e.anim || "attack")) this.sound(a, "attack");
      // the camera leans toward whoever acts (and back to the wide shot after)
      if (this.battle?.wide) {
        const W = this.battle.wide, toward = a.pos.clone().sub(W.at).setY(0).multiplyScalar(0.25);
        this.engine.shot(W.pos.clone().add(toward).add(V3(0, -0.6, 0)), W.at.clone().add(toward.multiplyScalar(1.4)), 1.6);
      }
      this.audio.sfx(/cast|buff|heal/.test(e.anim) ? "arcane" : /shoot/.test(e.anim) ? "arrow" : "swing");
      if (/cast/.test(e.anim)) this.vfx.burst(a.pos.clone().add(V3(0, a.height * 0.9, 0)), e.element || e.vfx || "arcane", 20, 1.5, 0.35, 0.6, -1);
    }
    await Promise.race([impact, sleep(1500)]);
    // ranged things fly to their targets
    if (a && (e.ranged || /shoot|cast/.test(e.anim)) && targets.length && targets[0] !== a && !["heal", "buff_red", "buff_gold", "shield", "summon", "mark", "smoke"].includes(e.vfx)) {
      const from = a.pos.clone().add(V3(0, a.height * 0.7, 0));
      const kind = /arrow/.test(e.vfx) ? "arrow" : /bullet|laser/.test(e.vfx) ? "bullet" : "orb";
      await Promise.all(targets.map((t) => this.vfx.projectile(from, t.pos.clone().add(V3(0, t.height * 0.55, 0)), e.element || e.vfx, { kind })));
    } else if (a && melee) {
      this.vfx.slash(a.pos, V3(Math.sin(a.heading), 0, Math.cos(a.heading)), e.vfx === "slash_red" ? 0xff8a98 : 0xffffff, e.anim === "attack_heavy");
    }
    // area spells show on every target; buffs/heals on allies
    if (["fire", "ice", "lightning", "light", "shadow", "arcane", "poison", "earth", "wind", "heal", "buff_red", "buff_gold", "shield", "mark", "smoke", "summon", "meteor", "storm", "potion", "sparkle"].includes(e.vfx)) {
      for (const t of targets) this.vfx.castAt(e.vfx, t.pos, t.height);
      if (!targets.length && a) this.vfx.castAt(e.vfx, a.pos, a.height);
    }
    // results land now
    for (const r of results) {
      if (r.type === "dice" && pre.includes(r)) continue;
      if (r.type === "dice") { this.dice.roll(r, { fast: true, who: this.nameOf(r.who) }); continue; }
      if (["hit", "miss", "death", "revive", "heal", "mana"].includes(r.type)) await this.applyResult(r);
      else if (r.type === "status") this.onStatus(r);
      else if (r.type === "resist" || r.type === "log") this.ui.subtitle("sys", "", r.text, { keep: 4000 });
      else if (r.type === "summon") await this.onSummon(r);
      else if (r.type === "loot") this.onLoot(r.items, r.text);
    }
    await sleep(380);
    if (this.battle?.wide && this.mode === "combat") this.engine.shot(this.battle.wide.pos, this.battle.wide.at, 1.4);
    if (a && home) { a.path = [[home.x, home.z]]; a.maxSpeed = 5; await sleep(450); const s = this.battle?.spots[e.uid]; if (s) { a.pos.x = s.x; a.pos.z = s.z; } a.path = []; a.face(this.battle.mid.x, this.battle.mid.z); }
    return j - 1;
  }

  async applyResult(r) {
    const t = this.actorOf(r.target || r.uid);
    if (r.type === "hit") {
      if (!t) return;
      if (r.amount > 0 && !t.anim.dead) t.anim.play("hit");
      this.vfx.impact(t.pos.clone().add(V3(0, t.height * 0.6, 0)), r.element || "impact", r.crit);
      this.audio.sfx(r.crit ? "crit" : "hit");
      if (r.amount > 0) {
        const src = this.actorOf(r.source || r.src) || this.actorOf(this.turnUid);
        const frac = Math.min(1, r.amount / Math.max(1, r.max_hp || t.info.max_hp || 30));
        t.flash(r.crit ? 0xffe080 : 0xffffff, r.crit ? 1.6 : 1);
        t.knock(src ? src.pos : t.pos.clone().add(V3(0, 0, 1)), (r.crit ? 0.32 : 0.16) + frac * 0.3);
        this.engine.hitStop(r.crit ? 0.14 : 0.06 + frac * 0.08);
        this.engine.cam.shake = Math.max(this.engine.cam.shake, (r.crit ? 0.7 : 0.15) + frac * 0.8);
        this.sound(t, "hit");
        if (t.info.team === "party") this.ui.flashMember(t.info.uid, "hurt");
      }
      this.float(t, r.crit ? `${r.amount}!` : `${r.amount}`, r.crit ? "crit" : r.note?.includes("weak") ? "weak" : "dmg", r.note);
      t.setHp(r.hp, r.max_hp);
      setTimeout(() => this.portraitNow(t.info.uid), 180);            // the portrait shows the hit
      if (r.explain) this.ui.subtitle("sys", "", r.explain + ` = ${r.amount}${r.note ? " (" + r.note + ")" : ""}`, { keep: 4500 });
      if (t.info.uid === "vermeil") t.mood = "angry";
    } else if (r.type === "miss") {
      if (t) { t.anim.play("dodge"); this.float(t, "miss", "miss"); }
      this.audio.sfx("miss");
      this.ui.subtitle("sys", "", r.text, { keep: 3500 });
    } else if (r.type === "heal") {
      if (!t) return;
      if (r.amount > 0) { this.float(t, `+${r.amount}`, "heal", r.note); t.flash(0x80ff90, 0.8); if (t.info.team === "party") this.ui.flashMember(t.info.uid, "healed"); }
      t.setHp(r.hp, r.max_hp);
    } else if (r.type === "mana") {
      if (t) this.float(t, "+mana", "heal");
    } else if (r.type === "death") {
      const d = this.actorOf(r.uid);
      if (d) {
        d.anim.play("death"); d.setHp(0, d.info.max_hp); this.audio.sfx("death"); this.sound(d, "death");
        if (d.info.team === "enemy") setTimeout(() => { this.vfx.death(d.pos, d.height); this.sinkAway(d); }, 1100);
      }
      this.ui.subtitle("sys", "", `${r.name} falls!`, { keep: 3500 });
      await sleep(350);
    } else if (r.type === "revive") {
      if (t) { t.anim.revive(); this.vfx.castAt("light", t.pos, t.height); t.setHp(r.hp, t.info.max_hp); }
      this.ui.subtitle("sys", "", r.text);
    }
  }

  applyHp(r) { return this.applyResult(r); }

  /** the world's meshes that can hide someone from the camera (trees, rocks, walls - not grass, bushes or flowers).
      Made once per location. */
  solidMeshes() {
    const w = this.world;
    const key = `${w.gen}:${w.root?.children.length}`;              // models still arriving: look again
    if (w._solidsKey === key && w._solids) return w._solids;
    const soft = /grass|flower|clover|plant|fern|pebble|weed|bush|reed|lilypad|carpet|leaves/i;
    const solids = [];
    w.root?.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || !o.castShadow || (o.isInstancedMesh && o.count >= 400)) return;
      let p = o, asset = "";
      while (p && !asset) { asset = p.userData?.asset || ""; p = p.parent; }
      if (!soft.test(asset)) solids.push(o);
    });
    w._solids = solids; w._solidsKey = key;
    return solids;
  }

  /** the camera position (from `candidates`, best first) that sees `at` - and as many of the `also` points (the boss,
      the party) as it can - without a tree, rock or wall in the way. null when every one is blocked at `at`. */
  clearView(candidates, at, also = []) {
    const solids = this.solidMeshes();
    const rc = new THREE.Raycaster();
    const blocked = (c, p) => { const d = c.clone().sub(p), len = d.length(); rc.set(p, d.normalize()); rc.far = len; return rc.intersectObjects(solids, false).length > 0; };
    let best = null, bestHid = Infinity;
    for (const c of candidates) {
      if (blocked(c, at)) continue;
      let hid = 0;
      for (const p of also) if (blocked(c, p)) hid++;
      if (hid === 0) return c;
      if (hid < bestHid) { best = c; bestHid = hid; }
    }
    return best;
  }

  /** chest points of everyone in the fight (what the battle camera must keep in view) */
  fighterPoints() {
    const pts = [];
    const spots = this.battle?.spots || {};
    for (const [uid, s] of Object.entries(spots)) {          // where they will stand, not where they are walking now
      const a = this.actorOf(uid);
      pts.push(V3(s.x, this.world.ground(s.x, s.z) + (a?.height || 1.6) * 0.6, s.z));
    }
    if (!pts.length) for (const a of [...this.party.values(), ...this.foes.values()]) if (a?.pos) pts.push(a.pos.clone().add(V3(0, (a.height || 1.6) * 0.6, 0)));
    return pts;
  }

  /** a defeated monster sinks into the ground and fades out */
  sinkAway(a) {
    const t0 = this.engine.time;
    const stop = this.engine.onUpdate((dt, t) => {
      const k = Math.min(1, (t - t0) / 1.2);
      a.sink = (a.sink || 0) + dt * a.height * 0.6;
      a.group.scale.setScalar(Math.max(0.01, 1 - k * 0.3));
      if (k >= 1) { stop(); a.group.visible = false; }
    });
  }

  float(a, text, kind, note) {
    const s = this.engine.toScreen(a.labelPos());
    const el = h("div", { class: `float ${kind}`, style: `left:${s.x + (Math.random() - 0.5) * 30}px;top:${s.y + 20}px` }, text + (note && kind !== "miss" ? ` ${note}` : ""));
    document.getElementById("labels").append(el);
    setTimeout(() => el.remove(), 1300);
  }

  onStatus(e) {
    const a = this.actorOf(e.target);
    const st = this.state?.combat?.actors.find((x) => x.uid === e.target) || this.state?.party.find((x) => x.uid === e.target);
    if (a && st) a.setStatuses(st.statuses);
    if (e.on && a) { this.float(a, e.name || e.id, "miss"); }
  }

  async onSummon(e) {
    const owner = this.actorOf(e.owner);
    const a = await Actor.create(this.world, { ...e.actor });
    const base = owner ? owner.pos : this.battle.mid;
    const p = this.world.nav.nearest(base.x + (Math.random() - 0.5) * 3, base.z + (Math.random() - 0.5) * 3, 4) || [base.x, base.z];
    a.pos.set(p[0], 0, p[1]);
    a.combat = true; a.showHp(true); a.setHp(e.actor.hp, e.actor.max_hp);
    if (e.actor.team === "enemy") this.foes.set(e.actor.uid, a); else this.party.set(e.actor.uid, a);
    this.battle.spots[e.actor.uid] = a.pos.clone();
    this.vfx.castAt("summon", a.pos, a.height);
    this.ui.subtitle("sys", "", e.text);
    await sleep(500);
  }

  async battleEnd(e) {
    this.audio.battle(false);
    const won = e.result === "victory";
    if (won) {
      this.audio.sfx("victory");
      this.banner("VICTORY!", "", "victory");
      let k = 0;
      for (const a of this.party.values()) if (!a.anim.dead) { a.anim.play("victory"); a.mood = "happy"; setTimeout(() => this.sound(a, "victory"), 200 + 250 * k++); }
      const R = e.rewards;
      if (R.xp) this.ui.toast(`+${R.xp} XP`, "good");
      if (R.gold) this.ui.toast(`+${R.gold} gold`, "good");
      if (R.items.length) this.onLoot(R.items);
    } else if (e.result === "defeat") { this.audio.sfx("defeat"); this.banner("DEFEATED", "You wake up somewhere safe…", "battle"); }
    await sleep(won ? 1800 : 1000);
    for (const p of e.party) { const a = this.party.get(p.uid); if (a) { a.setHp(p.hp, p.max_hp); if (p.alive && a.anim.dead) a.anim.revive(); } }
    this.endBattleVisuals();
  }

  endBattleVisuals() {
    for (const a of this.foes.values()) { this.vfx.death(a.pos, a.height); a.dispose(); }
    this.foes.clear();
    for (const a of this.party.values()) { a.combat = false; a.showHp(false); }
    for (const a of this.npcs.values()) a.label.dataset.hide = "";
    for (const [uid, a] of [...this.party.entries()]) if (a.info.kind === "summon") { a.dispose(); this.party.delete(uid); }
    this.world.inCombat = false;
    this.engine.shot(null);
    this.mode = "explore";
    this.fleeFrom = null;
    this.myTurn = false;
    this.turnUid = null;
    if (this.battle) this.battle.wide = null;
    $("actInput").placeholder = "What do you do?  e.g. “I ask the merchant about the strange knight”";
    $("initiative").hidden = true;
  }

  onLevelUp(e) {
    const a = this.party.get(e.uid);
    if (a) { this.vfx.levelUp(a.pos); a.anim.play("victory"); }
    this.banner("LEVEL UP!", `${e.name} → level ${e.level}`, "level");
    this.audio.sfx("levelup");
    this.ui.toast(`${e.name} reached level ${e.level}!${e.new_abilities.length ? " Learned: " + e.new_abilities.join(", ") : ""}`, "good");
  }

  onLoot(items, text) {
    if (text) this.ui.toast(text, "good");
    for (const it of items || []) this.ui.toast(`${it.name}${it.qty > 1 ? " ×" + it.qty : ""} (${it.rarity})`, "good");
    if (items?.length) this.audio.sfx("loot");
  }

  recruitDialog(e, full = false) {
    return new Promise((res) => {
      const buttons = [{ label: "Not now", fn: async () => { await this.request(() => call("recruit", e.npc, false), "…"); res(); } }];
      if (full) for (const p of e.party) buttons.push({ label: `Replace ${p.name}`, fn: async () => { await this.request(() => call("recruit", e.npc, true, p.uid), "…"); res(); } });
      else buttons.push({ label: `Welcome ${e.name}!`, primary: true, fn: async () => { await this.request(() => call("recruit", e.npc, true), "…"); res(); } });
      this.busy = false;
      this.ui.dialog(full ? "Your party is full" : "A new ally?", [h("p", {}, e.text)], buttons);
    });
  }

  /** a beaten monster wants to join (rare - alphas almost never) */
  monsterOffer(e) {
    this.audio.sfx("levelup");
    this.banner(e.alpha ? "An Alpha bows to you!" : "A new friend?", `${e.name} · level ${e.level}`, "level");
    return new Promise((res) => {
      const answer = (yes) => async () => { this.busy = false; await this.request(() => call("monster_recruit", yes), "…"); res(); };
      this.busy = false;
      this.ui.dialog(e.alpha ? "An Alpha wants to join!" : "A monster wants to join!", [h("p", {}, e.text), h("p", { class: "muted" }, "Monster allies fight on their own and level up with you. Your party can hold up to 6.")],
        [{ label: "Not now", fn: answer(false) }, { label: `Welcome ${e.name}!`, primary: true, fn: answer(true) }]);
    });
  }

  async onRecruit(e) {
    const npcA = this.npcs.get(e.actor.npc_id) || [...this.npcs.values()].find((a) => a.info.name === e.actor.name);
    let a;
    if (npcA) { this.npcs.delete(npcA.info.uid); npcA.dispose(); }
    a = await Actor.create(this.world, { ...e.actor });
    a.pos.copy(npcA?.pos || this.player.pos);
    this.party.set(e.actor.uid, a);
    this.vfx.castAt("sparkle", a.pos, a.height);
    this.ui.toast(e.text, "good");
  }

  shopDialog(e) {
    this._shopOpen = true;
    const npc = this.npcs.get(e.npc);
    if (npc) { this.talkPartner = npc; npc.anim.play("greet"); }
    this.audio.sfx("open");
    let goods = e.goods, services = e.services || {}, tab = "buy";
    const trader = e.role === "wandering_trader";
    const refresh = (r) => { if (r.state) this.state = { ...this.state, ...r.state }; if (r.goods) goods = r.goods; if (r.services) services = r.services; this.ui.renderHud(); draw(); };
    const priceOf = (it) => Math.max(1, Math.floor(it.price));
    const tabs = () => h("div", { class: "tabs shop-tabs" }, ...[["buy", trader ? "Rare goods" : "Buy"], ["sell", "Sell"], services.reforge ? ["reforge", "Reforge gear"] : null, services.inn ? ["inn", "Rooms"] : null].filter(Boolean)
      .map(([k, l]) => h("button", { class: tab === k ? "on" : "", onclick: () => { tab = k; this.audio.sfx("click"); draw(); } }, l)));
    const buyList = () => goods.length ? h("div", { class: "shop-grid" }, ...goods.map((it) => this.ui.itemRow(it, [h("span", { class: "price" }, `${priceOf(it)}g`),
      h("button", { class: "small", disabled: this.state.gold < priceOf(it) ? "" : null, onclick: async () => {
        const r = await call("buy", e.npc, it.uid); if (r.error) { this.ui.toast(r.error, "bad"); return; }
        this.ui.toast(`Bought ${r.result.bought}`, "good"); this.audio.sfx("coin"); refresh(r); } }, "Buy")]))) : h("p", { class: "muted" }, "Sold out! Come back later.");
    const sellList = () => {
      const inv = (this.state.inventory || []).filter((i) => !i.quest && !i.equipped_by && i.slot !== "currency");
      return inv.length ? h("div", { class: "shop-grid" }, ...inv.slice(0, 30).map((it) => this.ui.itemRow(it, [h("span", { class: "price" }, `${Math.max(1, Math.floor(it.value / 2))}g`),
        h("button", { class: "small", onclick: async () => { const r = await call("sell", it.uid); if (r.error) { this.ui.toast(r.error, "bad"); return; } this.audio.sfx("coin"); refresh(r); } }, "Sell")]))) : h("p", { class: "muted" }, "Nothing to sell (worn gear and quest items can't be sold).");
    };
    const reforgeList = () => h("div", {}, h("p", { class: "muted" }, "The smith hammers your gear stronger: every bonus goes up, up to +5. Worn items can be reforged too."),
      h("div", { class: "shop-grid" }, ...(services.reforge || []).map((r) => {
        const it = (this.state.inventory || []).find((x) => x.uid === r.uid) || r;
        return this.ui.itemRow(it, [h("span", { class: "price" }, r.maxed ? "max" : `${r.cost}g`), h("button", { class: "small", disabled: r.maxed || this.state.gold < r.cost ? "" : null, onclick: async () => {
          const x = await call("reforge", e.npc, r.uid); if (x.error) { this.ui.toast(x.error, "bad"); return; }
          this.audio.voiceFx("clang"); this.audio.sfx("levelup"); this.ui.toast(`${x.result.item.name}!`, "good");
          if (npc) { npc.anim.play("attack"); this.vfx.burst(npc.pos.clone().add(V3(0, 1, 0)), "fire", 25, 2, 0.3, 0.5); }
          refresh(x); } }, r.maxed ? "Done" : "Reforge")]);
      })));
    const innPanel = () => h("div", {}, h("p", {}, services.inn.what), h("button", { class: "big", disabled: this.state.gold < services.inn.cost ? "" : null, onclick: async () => {
      this.ui.closeDialog(); this._shopOpen = false;
      const r = await this.request(() => call("inn", e.npc), "Resting at the inn…");
      if (!r?.error) { this.audio.sfx("heal"); $("fade").className = "black"; await sleep(900); $("fade").className = ""; }
    } }, `Rent rooms for ${services.inn.cost} gold`));
    const body = h("div", {});
    const draw = () => {
      body.replaceChildren(
        h("div", { class: "shop-head" }, trader ? h("span", { class: "trader-tag" }, "Wandering trader — rare goods, leaves when you do") : null, h("span", { class: "price" }, `You have ${this.state.gold} gold`)),
        tabs(), tab === "buy" ? buyList() : tab === "sell" ? sellList() : tab === "reforge" ? reforgeList() : innPanel());
    };
    draw();
    this.ui.dialog(`${e.name}${trader ? "'s cart" : "'s shop"}`, [body], [{ label: "Done", fn: () => { this._shopOpen = false; this.talkPartner = null; this.audio.sfx("close"); } }]);
  }
}

const game = new Game();
game.boot();
