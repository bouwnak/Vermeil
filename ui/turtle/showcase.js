// showcase.js - a test floor: everything in the game stood out in rows with room between them, each going through its animations, so anything off is easy to spot.
// It's a place of its own: the world waits while you're here. WASD to move, drag to look, wheel to zoom, Esc to leave.
import * as THREE from "three";
import { character, prop } from "./assets.js";
import { ANIMALS, CATALOG, COMPANION, DINOS, DINO_PATTERNS, DINO_TIERS, FISH_PACK, FISH, NPCS, SKINS, modelOf, rollLook } from "./data.js";
import { dayRnd } from "./life.js";
import { makeDinoBody } from "./dinomodel.js";
import { madeProp, makeChicken } from "./made.js";
import { seatOf } from "./vehicles.js";
import { rigWheels, rollWheels } from "./wheels.js";

const label = (text, sub = "") => {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = 512; c.height = 96;
  g.fillStyle = "rgba(90,55,25,.92)"; g.fillRect(0, 0, 512, 96);
  g.fillStyle = "#fff4d4"; g.textAlign = "center"; g.font = "800 38px Nunito, sans-serif"; g.fillText(text.slice(0, 26), 256, 44);
  g.font = "600 24px Nunito, sans-serif"; g.fillText(sub.slice(0, 40), 256, 80);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false }));
  s.scale.set(4, 0.75, 1);
  return s;
};

export async function runShowcase(G, kind) {
  if (G.show) return;
  const scene = new THREE.Scene(), I = G.input, cam = G.camera, leave = document.getElementById("showExit"), hud = document.getElementById("hud");
  scene.background = new THREE.Color(0xdfe9e4);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b8a8, 1.9));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.2); sun.position.set(30, 60, 30); scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: 0xf1ede2 })); floor.rotation.x = -Math.PI / 2; scene.add(floor);
  scene.add(new THREE.GridHelper(2000, 500, 0xcfc8b6, 0xdfd9c8));
  const live = [], S = G.show = { scene, live, tick: () => {} }, keep = { pitch: I.pitch, zoom: I.zoom, yaw: I.yaw };
  G.paused = true; hud.hidden = true; leave.hidden = false;
  const note = (t) => { leave.textContent = t; };
  /** one row of the floor: each thing gets its own width, so big ones don't crowd small ones */
  let z = 0;
  const row = async (title, list) => {
    (S.rows ||= {})[title] = z;
    const head = label(title); head.scale.set(9, 1.7, 1); head.position.set(-12, 2, z); scene.add(head);
    let x = 0, deep = 6;
    for (const [i, [name, make]] of list.entries()) {
      note(`Setting out ${title}: ${i + 1} of ${list.length}`);
      let o = null;
      try { o = await make(); } catch (e) { console.warn("[showcase]", name, e); }
      const obj = o?.holder || o;
      if (!obj) { const miss = label(name, "couldn't load"); miss.position.set(x, 1.6, z); scene.add(miss); x += 6; continue; }
      if (o.move) obj.rotation.y = 1.1;                      // side on, so a body's shape can be seen
      scene.add(obj);
      obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(obj), w = Math.max(b.max.x - b.min.x, 2.5), d = b.max.z - b.min.z, c = b.getCenter(new THREE.Vector3());
      obj.position.x = x + w / 2 - c.x; obj.position.z = z - c.z;
      const tag = label(name); tag.position.set(x + w / 2, (b.max.y - b.min.y) + 1, z); scene.add(tag);
      if (o.move || o.mixer || o.tickIt) live.push(o);
      x += w + 3.5; deep = Math.max(deep, d);
      S.max = Math.max(S.max || 0, x);
    }
    z += deep + 8;
  };
  if (kind === "alive") {
    await row("Farm animals", [...[...new Map(ANIMALS.map((a) => [a[0], a])).values()].map(([name, size]) => [name, () => character(`conv_farm_animals/${name}.glb`, size)]), ["Chicken", () => makeChicken()], ["Brown hen", () => makeChicken(0xc98a4a)]]);
    // yours first, as they are now: their own names and forms, saddled
    if (G.dinos?.list.length) await row("Your dinosaurs", G.dinos.list.map((d) => [`${d.r.name || d.data.forms[d.r.stage]} (${d.r.look ? `${d.r.look.tier} ${d.r.look.pattern}, ` : ""}${d.r.personality || "?"})`, async () => { const c = await makeDinoBody(d.data, d.r.stage, d.data.sizes[d.r.stage], d.r.look); c.addSaddle?.(); return c; }]));
    // every tier and every pattern, on one kind and then across all of them, so each can be checked by eye
    const tierLook = (sp, tier, pattern, i) => { let l; for (let n = 0; n < 4000; n++) { l = rollLook(sp, dayRnd(n + i * 977, sp)); if (l.tier === tier && (!pattern || l.pattern === pattern)) return l; } return l; };
    await row("Tiers", DINO_TIERS.map(([tier], i) => [`${tier} Crestback`, () => makeDinoBody(DINOS.sprig, 1, DINOS.sprig.sizes[1], tierLook("sprig", tier, "", i))]));
    await row("Patterns", DINO_PATTERNS.map((p, i) => [`${p} Sawback`, () => makeDinoBody(DINOS.nib, 1, DINOS.nib.sizes[1], tierLook("nib", "Rare", p, i))]));
    // every kind, born at each tier in turn: the colours and patterns a wild one can roll, Common to Mythic
    await row("Every kind, every tier", Object.entries(DINOS).map(([k, D], i) => { const tier = DINO_TIERS[i % DINO_TIERS.length][0]; return [`${tier} ${D.forms[1]}`, () => makeDinoBody(D, 1, D.sizes[1], tierLook(k, tier, "", i + 50))]; }));
    for (const [k, D] of Object.entries(DINOS)) await row(D.line, D.forms.map((f, st) => [f, () => makeDinoBody(D, st, D.sizes[st])]));
    await row("Companion", [[COMPANION.name, () => G.companion ? character(G.companion.path || COMPANION.model, 1.6, true) : null]]);
    await row("Named people", Object.values(NPCS).map((n) => [n.name, () => character(n.model, 1.72)]));
    await row("Outfits (men)", SKINS.male.map(([s, l]) => [l, () => character(modelOf("male", s), 1.72)]));
    await row("Outfits (women)", SKINS.female.map(([s, l]) => [l, () => character(modelOf("female", s), 1.72)]));
    await row("Fish", [...new Map(FISH.map((f) => [f.model, f])).values()].map((f) => [f.name, () => character(`${FISH_PACK}${f.model}.glb`, 0.9)]));
  } else {
    const made = (c) => { const m = madeProp(c.made), run = m.userData.run; if (run) m.tickIt = run; return m; };
    const item = (type, c) => async () => {
      if (c.made) return made(c);
      const g = new THREE.Group(); await prop(c.model, g, { height: c.height || 0 });
      const m = g.children[0];
      if (m && (c.length || c.width)) { const s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()); m.scale.setScalar((c.length || c.width) / Math.max(s.x, s.z, 1e-3)); }
      if (m) { const b = new THREE.Box3().setFromObject(m); m.position.y -= b.min.y; }
      if (S.seats && c.cat === "vehicles") { const q = seatOf(g, c), d = new THREE.Mesh(new THREE.SphereGeometry(0.22), new THREE.MeshBasicMaterial({ color: 0xff2266 })); d.position.set(q.x, q.y + 0.45, q.z); g.add(d); }
      if (c.cat === "vehicles" && m) {                       // each one drives up and back a little way, its wheels rolling as it goes
        const wheels = rigWheels(m), z0 = m.position.z, y0 = m.position.y;
        let was = 0;
        g.tickIt = (t) => { const z = Math.sin(t * 0.7) * 1.6; m.position.z = z0 + z; m.position.y = y0 + Math.abs(Math.sin(t * 9)) * 0.015; rollWheels(wheels, z - was); was = z; };
        g.userData.wheels = wheels.length;
      }
      return g;
    };
    S.seats = /seats/.test(location.search);
    for (const [cat, title] of [["machines", "Machines"], ["vehicles", "Vehicles"]]) await row(title, Object.entries(CATALOG).filter(([, c]) => c.cat === cat).map(([type, c]) => [c.label, item(type, c)]));
  }
  note("Leave the floor (Esc)");
  const f = S.focus = new THREE.Vector3(10, 1.5, 0);
  I.pitch = 0.5; I.zoom = 20; I.yaw = 0;
  let t = 0, turnIn = 0, step = 0;
  S.tick = (dt) => {
    t += dt;
    const v = new THREE.Vector3();
    if (I.down.has("KeyW")) v.z -= 1; if (I.down.has("KeyS")) v.z += 1; if (I.down.has("KeyA")) v.x -= 1; if (I.down.has("KeyD")) v.x += 1;
    if (v.lengthSq()) f.addScaledVector(v.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), I.yaw), dt * (I.down.has("ShiftLeft") ? 40 : 18));
    cam.position.set(Math.sin(I.yaw) * Math.cos(I.pitch), Math.sin(I.pitch), Math.cos(I.yaw) * Math.cos(I.pitch)).multiplyScalar(I.zoom * 1.6).add(f);
    cam.lookAt(f);
    // everything goes through what it can do, in step, so you can compare them
    if ((turnIn -= dt) <= 0) { turnIn = 3.5; step++; }
    for (const o of live) {
      if (o.tickIt) { o.tickIt(t, true); continue; }
      if (o.move) { o.lookAt = null; if (step !== o.seen) { o.seen = step; if (step % 3 === 2) o.react?.("roar"); } o.move(dt, t, step % 3 === 1, step % 6 === 4); continue; }
      const names = Object.keys(o.actions), name = names[step % names.length];
      if (name) o.play(name);
      o.mixer.update(dt);
    }
    if (I.pressed.has("Escape")) S.close();
  };
  S.close = () => { G.show = null; Object.assign(I, keep); leave.hidden = true; hud.hidden = false; G.paused = false; };
  leave.onclick = () => S.close();
}
