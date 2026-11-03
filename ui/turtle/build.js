// build.js - placing things on your turtle, the same way Edit room works in the app (without the paint): a bar of categories on top (press the open one to
// shut it), click a piece to add it, drag it about, round buttons follow what you've picked, R turns it, Delete removes it, Ctrl+Z undoes it.
import * as THREE from "three";
import { BUILD_CATS, CATALOG, ITEMS, LAYOUT, RECIPES } from "./data.js";
import { fillFountain, lampLight, madeProp } from "./made.js";
import { prop } from "./assets.js";
import { addSolid, dropSolid, groundAt, nearest } from "./world.js";
import { spotOf } from "./farm.js";
import { popup } from "./ui.js";

const $ = (id) => document.getElementById(id);
/** where a tower's barrel stands: just off its right side, turned the same way, so the pipe from the tank comes down into it */
export const barrelBy = (t) => ({ x: t.x + Math.cos(t.ry) * 3.3, z: t.z - Math.sin(t.ry) * 3.3, ry: t.ry });
const costText = (c) => Object.entries(c.cost || {}).filter(([, n]) => n).map(([k, n]) => (k === "money" ? `${n} 🐚` : `${n} ${ITEMS[k]?.icon || k}`)).join("  ") || "Free";

export function makeBuild(G) {
  const home = G.world.lands.home, land = home.land, things = new Map(), undo = [];
  const B = { active: false, sel: null, things, focus: new THREE.Vector3(), catalog: CATALOG };
  let nextId = (G.s.placed || []).reduce((n, p) => Math.max(n, p.id), 0), tab = "fences", shut = false, drag = null;
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();

  // ---------------- what stands where ----------------
  const solidsFor = (c, p) => {
    if (c.wall) { const ca = Math.cos(p.ry), sa = Math.sin(p.ry); return [-1.5, -0.5, 0.5, 1.5].map((u) => ({ x: p.x + ca * u, z: p.z - sa * u, r: 0.42 })); }
    if (c.use === "pen") { const out = [], R = 9; for (let i = -R; i <= R; i += 2) { out.push({ x: p.x + i, z: p.z - R, r: 0.5 }, { x: p.x - R, z: p.z + i, r: 0.5 }, { x: p.x + R, z: p.z + i, r: 0.5 }); if (Math.abs(i) >= 3) out.push({ x: p.x + i, z: p.z + R, r: 0.5 }); } return out; }
    return c.r ? [{ x: p.x, z: p.z, r: c.r }] : [];
  };
  async function dress(p) {
    const c = CATALOG[p.type], g = new THREE.Group();
    g.userData.itemId = p.id;
    const inner = new THREE.Group(); g.add(inner);
    if (c.made) { const made = madeProp(c.made); inner.add(made); g.userData.run = made.userData.run; }
    else {
      const m = await prop(c.model, inner, { height: c.height || 0 });
      if (m) {
        if (c.length || c.width) { const s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3()); m.scale.setScalar((c.length || c.width) / Math.max(s.x, s.z, 1e-3)); }
        m.updateMatrixWorld(true);
        const b = new THREE.Box3().setFromObject(m), mid = b.getCenter(new THREE.Vector3());     // standing on the ground, around its own middle
        m.position.set(m.position.x - mid.x, m.position.y - b.min.y, m.position.z - mid.z);
        if (c.light) { const top = lampLight(0.22, b.max.y - b.min.y - 0.35); inner.add(top); }      // a pack lamp lights up at night like the rest
        if (/fountain/i.test(c.model)) fillFountain(m);                                              // its basins hold water
      }
    }
    g.traverse((m) => {
      if (/_blades$/i.test(m.name)) (g.userData.sails ||= []).push({ m, axis: "z" });        // the farm pack's mills: already hung on their hub
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = !c.flat;
      if (/blades/i.test(m.name)) {                         // sails turn about their own middle, across their thinnest side
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox, mid = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
        if (!m.geometry.userData.centred) { m.geometry.translate(-mid.x, -mid.y, -mid.z); m.geometry.userData.centred = true; m.geometry.userData.size = size; m.geometry.userData.mid = mid; }
        const sz = m.geometry.userData.size, md = m.geometry.userData.mid.clone().multiply(m.scale).applyQuaternion(m.quaternion);
        m.position.add(md);
        const [thin, mid2, big] = [sz.x, sz.y, sz.z].sort((p, q) => p - q);
        if (thin < big * 0.3 && mid2 > big * 0.72) (g.userData.sails ||= []).push({ m, axis: sz.x < sz.y && sz.x < sz.z ? "x" : sz.y < sz.z ? "y" : "z" });     // a wheel of sails, not a railing
      }
    });
    return g;
  }
  const seat = (t) => {
    const { p, group } = t, c = CATALOG[p.type], r = Math.max(c.r || 0.4, c.greenhouse ? 2 : 0);
    let y = land.ground(p.x, p.z);
    if (r >= 1.2) for (const [a, b] of [[r, r], [-r, r], [r, -r], [-r, -r]]) y = Math.min(y, land.ground(p.x + a, p.z + b));     // sunk a little rather than overhanging
    group.position.set(p.x, y - (c.flat ? 0 : 0.04), p.z);
    group.rotation.y = p.ry;
  };
  const setSolids = (t) => { for (const r of t.solids || []) dropSolid(r); const c = CATALOG[t.p.type]; t.solids = solidsFor(c, t.p).map((r) => addSolid(home, { ...r, placed: t.p.id, use: null })); if (t.solids[0]) t.solids[0].thing = t; };
  async function make(p) {
    const group = await dress(p);
    const t = { p, group };
    things.set(p.id, t); home.group.add(group); seat(t); setSolids(t);
    return t;
  }
  B.load = async () => {
    await Promise.all(["lowpoly_farm_01", "lowpoly_farm_02", "farm_vehicles"].map(async (pack) => {            // nothing goes unused: every model of the packs can be placed
      const root = `../games/asset_packs/${pack}/`, list = await fetch(`${root}models.json`).then((r) => r.json()).catch(() => []), used = new Set(Object.values(CATALOG).map((c) => c.model));
      for (const m of list) {
        const model = `${root}${m.name}.gltf`;
        if (used.has(model)) continue;
        const wheels = /^(car|truck|tractor|farmwagon)/i.test(m.name), wide = Math.max(m.size[0], m.size[2]), r = m.size[1] < 0.3 ? 0 : Math.min(9, wide * 0.42);
        CATALOG[`${pack}_${m.name}`] = { label: m.name.replace(/[_\d]+/g, " ").trim().replace(/^./, (x) => x.toUpperCase()), cat: wheels ? "vehicles" : "more", model, r, flat: r === 0, cost: { money: Math.round(10 + wide * 30) } };
      }
    }));
    if (!G.s.placed) { G.s.placed = LAYOUT.map(([type, x, z, ry]) => ({ id: ++nextId, type, x, z, ry })); }
    // every water tower has its barrel beside it, piped in: a farm saved before there were barrels gets one too
    for (const t of G.s.placed.filter((p) => p.type === "watertower")) if (!G.s.placed.some((p) => p.type === "waterbarrel" && Math.hypot(p.x - t.x, p.z - t.z) < 6)) G.s.placed.push({ id: ++nextId, type: "waterbarrel", ...barrelBy(t) });
    await Promise.all(G.s.placed.map(make));
  };
  B.reseat = (t) => { seat(t); setSolids(t); };
  B.of = (type) => [...things.values()].filter((t) => t.p.type === type);
  B.useNear = (x, z, r = 3) => { const [lx, lz] = home.local(x, z); let best = null, bd = 1e9; for (const t of things.values()) { const c = CATALOG[t.p.type]; if (!c.use) continue; const d = Math.hypot(t.p.x - lx, t.p.z - lz) - (c.r || 0); if (d < r && d < bd) { bd = d; best = t; } } return best; };

  // ---------------- may it go here? ----------------
  const why = (type, x, z, self) => {
    const c = CATALOG[type], g = groundAt(G, x, z);
    if (g.on !== "home") return "Only on your own turtle's land";
    const big = (c.r || 0) >= 1 || c.greenhouse;
    if (big && land.rough(x, z, Math.min(4, (c.r || 1) * 0.8)) > 1.6) return "Too steep here";
    if (!c.flat) { const hit = nearest(G, x, z, big ? 0.6 + (c.r || 0) : 0.25, (r) => r.r && r.placed !== self && !(r.placed && c.wall)); if (hit) return "Something's in the way"; }
    if (!c.greenhouse) for (const k of Object.keys(G.s.plots)) { const [a, b] = spotOf(k); if (Math.hypot(a - x, b - z) < (c.r || 0.4) + 1.2) return "There's soil here"; }
    return null;
  };

  // ---------------- the bar ----------------
  const owned = (type) => G.s.owned?.[type] || 0;
  const afford = (c) => Object.entries(c.cost || {}).every(([k, n]) => (k === "money" ? G.s.money >= n : (G.s.inv[k] || 0) >= n));
  const pay = (c, sign) => { for (const [k, n] of Object.entries(c.cost || {})) { if (k === "money") G.s.money -= n * sign; else G.add(k, -n * sign); } };
  function drawBar() {
    $("buildTabs").replaceChildren(...BUILD_CATS.map(([k, label]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-selected", String(k === tab && !shut));
      b.onclick = () => { shut = k === tab && !shut; tab = k; drawBar(); G.sfx("open"); };
      return b;
    }));
    const list = $("buildList");
    list.hidden = shut;
    list.replaceChildren(...Object.entries(CATALOG).filter(([, c]) => c.cat === tab && (!c.unique || !B.of(Object.keys(CATALOG).find((k) => CATALOG[k] === c)).length)).map(([type, c]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "build-card"; b.disabled = !afford(c) && !c.free && !owned(type);
      const n = document.createElement("b"), m = document.createElement("small"); n.textContent = c.label; m.textContent = owned(type) ? `Owned × ${owned(type)}` : costText(c); b.append(n, m);
      b.onclick = () => add(type);
      return b;
    }));
    $("buildMoney").textContent = `${G.s.money} 🐚`;
    $("undoBuild").disabled = !undo.length;
  }
  const pushUndo = (fn) => { undo.push(fn); if (undo.length > 40) undo.shift(); };
  function spotAhead() {
    ray.setFromCamera(ptr.set(0, -0.1), G.camera);
    return hitGround() || B.focus;
  }
  /** where a ray through the pointer lands on the land: a walk down it, since the mesh is big */
  function hitGround() {
    const o = ray.ray.origin, d = ray.ray.direction, v = new THREE.Vector3();
    for (let t = 2; t < 420; t += 1) { v.copy(o).addScaledVector(d, t); if (v.y < land.ground(v.x, v.z)) return v.clone(); }
    return null;
  }
  const snapTo = (c, v) => { const n = c.snap || 1; return [Math.round(v / n) * n]; };
  async function add(type) {
    const c = CATALOG[type];
    const mine = owned(type) > 0;
    if (!mine && !afford(c)) return popup("Not enough for that yet");
    const at = spotAhead();
    let x = snapTo(c, at.x)[0], z = snapTo(c, at.z)[0];
    for (let i = 0; i < 24 && why(type, x, z); i++) { const a = i * 1.1, r = 1 + i * 0.9; const nx = at.x + Math.cos(a) * r, nz = at.z + Math.sin(a) * r; x = snapTo(c, nx)[0]; z = snapTo(c, nz)[0]; }
    if (why(type, x, z)) return (popup(why(type, x, z)), G.sfx("deny"));
    if (mine) G.s.owned[type]--; else pay(c, 1);
    const p = { id: ++nextId, type, x, z, ry: 0 };
    G.s.placed.push(p);
    const t = await make(p);
    pushUndo(() => remove(p.id, true));
    bounce(t); select(p.id); G.sfx("place"); G.vfx.burst("dust", x, land.ground(x, z) + 0.3, z);
    drawBar();
  }
  function remove(id, silent) {
    const t = things.get(id);
    if (!t) return;
    const c = CATALOG[t.p.type];
    if (c.unique && !silent) return popup(`Your ${c.label.toLowerCase()} can be moved, not removed`);
    home.group.remove(t.group);
    for (const r of t.solids || []) dropSolid(r);
    things.delete(id);
    G.s.placed = G.s.placed.filter((p) => p.id !== id);
    pay(c, -1);
    if (G.s.machines) delete G.s.machines[id];
    if (!silent) { const p = t.p; pushUndo(async () => { pay(c, 1); G.s.placed.push(p); bounce(await make(p)); }); G.sfx("remove"); G.vfx.burst("dust", p.x, land.ground(p.x, p.z) + 0.4, p.z, 2); }
    if (B.sel === id) select(null);
    drawBar();
  }
  function select(id) { B.sel = id; const t = things.get(id); box.visible = foot.visible = !!t; if (t) { update(t); } $("placeTools").hidden = !t; $("hoverLabel").hidden = true; }
  const bounce = (t) => { t.pop = 1; };
  const turn = (a) => {
    const t = things.get(B.sel);
    if (!t) return;
    const before = t.p.ry;
    t.p.ry = (t.p.ry + a) % (Math.PI * 2);
    seat(t); setSolids(t); update(t); bounce(t); G.sfx("place");
    pushUndo(() => { t.p.ry = before; seat(t); setSolids(t); });
    drawBar();
  };
  function update(t) {
    box.box.setFromObject(t.group);
    const c = CATALOG[t.p.type], w = c.greenhouse ? c.greenhouse * 2 : Math.max(1.4, (c.wall ? 4 : (c.r || 0.6) * 2.2));
    foot.scale.set(w, c.wall ? 1 : w, 1);
    foot.position.set(t.p.x, land.ground(t.p.x, t.p.z) + 0.16, t.p.z);
    foot.rotation.z = t.p.ry;
    foot.material.color.set(t.bad ? 0xe4573d : 0x7fe08a);
  }
  const box = new THREE.Box3Helper(new THREE.Box3(), 0xffe27a);
  const foot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
  foot.rotation.x = -Math.PI / 2; box.visible = foot.visible = false;
  const gridGeo = new THREE.BufferGeometry(), grid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 }));
  grid.frustumCulled = false; grid.visible = false;
  G.scene.add(box, foot, grid);
  let gridAt = new THREE.Vector3(1e9, 0, 0);
  function drawGrid() {
    if (B.focus.distanceTo(gridAt) < 6) return;
    gridAt.copy(B.focus);
    const out = [], n = 28, step = 2, cx = Math.round(B.focus.x / step) * step, cz = Math.round(B.focus.z / step) * step;
    for (let a = -n; a <= n; a++) for (let b = -n; b < n; b++) {
      for (const [x1, z1, x2, z2] of [[cx + a * step, cz + b * step, cx + a * step, cz + (b + 1) * step], [cx + b * step, cz + a * step, cx + (b + 1) * step, cz + a * step]]) {
        const y1 = land.ground(x1, z1), y2 = land.ground(x2, z2);
        if (y1 > 0.4 && y2 > 0.4) out.push(x1, y1 + 0.1, z1, x2, y2 + 0.1, z2);
      }
    }
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  }

  // ---------------- going in and out, and the mouse ----------------
  B.toggle = (on = !B.active) => {
    if (on && (G.player.ground?.on !== "home" && G.player.ground?.on !== "dock")) return popup("You can build on your own turtle");
    if (on && G.player.sailing) return;
    B.active = on; G.building = on; G.paused = on;
    document.body.classList.toggle("building", on);
    $("buildBar").hidden = !on;
    grid.visible = on;
    if (on) { B.focus.copy(G.player.pos); B.keep = { zoom: G.input.zoom, pitch: G.input.pitch }; G.input.zoom = 30; G.input.pitch = 0.8; gridAt.x = 1e9; drawBar(); G.sfx("open"); }
    else { select(null); $("hoverLabel").hidden = true; Object.assign(G.input, B.keep || {}); G.save(); }
  };
  const canvas = $("game");
  const aim = (e) => { const r = canvas.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, G.camera); };
  const pick = () => {
    const list = [...things.values()].map((t) => t.group), hit = ray.intersectObjects(list, true)[0];
    for (let o = hit?.object; o; o = o.parent) if (o.userData?.itemId != null) return o.userData.itemId;
    return null;
  };
  let down = null, last = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (!B.active) return;
    down = [e.clientX, e.clientY];
    aim(e);
    const id = pick();
    if (id == null) return;
    select(id);
    const t = things.get(id);
    drag = { t, moved: false, from: [t.p.x, t.p.z] };
    G.input.hold = true;
    canvas.setPointerCapture(e.pointerId);
  }, true);
  canvas.addEventListener("pointermove", (e) => {
    if (!B.active) return;
    if (!drag) {
      if (performance.now() - last < 60 || e.buttons) return;
      last = performance.now();
      aim(e);
      const id = pick(), l = $("hoverLabel");
      l.hidden = id == null || id === B.sel;
      if (!l.hidden) { l.textContent = `Drag to move: ${CATALOG[things.get(id).p.type].label}`; l.style.left = `${e.clientX + 14}px`; l.style.top = `${e.clientY + 10}px`; }
      canvas.style.cursor = id != null ? "pointer" : "grab";
      return;
    }
    aim(e);
    const at = hitGround();
    if (!at) return;
    const t = drag.t, c = CATALOG[t.p.type];
    t.p.x = snapTo(c, at.x)[0]; t.p.z = snapTo(c, at.z)[0];
    t.bad = why(t.p.type, t.p.x, t.p.z, t.p.id);
    seat(t); update(t); drag.moved = true;
  }, true);
  const lift = () => {
    if (!drag) return;
    const { t, moved, from } = drag;
    drag = null; G.input.hold = false; G.input.dragging = false;
    if (!moved) return;
    if (t.bad) { popup(t.bad); G.sfx("deny"); t.p.x = from[0]; t.p.z = from[1]; t.bad = null; seat(t); update(t); return; }
    setSolids(t);
    bounce(t); G.sfx("place"); G.vfx.burst("dust", t.p.x, land.ground(t.p.x, t.p.z) + 0.3, t.p.z);
    pushUndo(() => { t.p.x = from[0]; t.p.z = from[1]; seat(t); setSolids(t); update(t); });
    drawBar();
  };
  canvas.addEventListener("pointerup", (e) => { if (!B.active) return; if (!drag && down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) <= 4) select(null); lift(); });
  canvas.addEventListener("lostpointercapture", lift);
  addEventListener("keydown", (e) => {
    if (!B.active || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === "Delete" || e.key === "Backspace") remove(B.sel);
    else if ((e.key === "z" || e.key === "Z") && e.ctrlKey) doUndo();
    else if (e.key === "r" || e.key === "R") turn(-Math.PI / 4);
    else if (e.key === "q" || e.key === "Q") turn(Math.PI / 8);
    else if (e.key === "e" || e.key === "E") turn(-Math.PI / 8);
    else if (e.key === "Escape") { if (B.sel != null) select(null); else B.toggle(false); }
  });
  const doUndo = () => { const fn = undo.pop(); if (fn) { fn(); G.sfx("remove"); drawBar(); select(null); } };
  $("toolTurn").onclick = () => turn(-Math.PI / 4);
  $("toolRemove").onclick = () => remove(B.sel);
  $("undoBuild").onclick = doUndo;
  $("doneBuild").onclick = () => B.toggle(false);

  /** every frame while building: the view, and the things that follow what you've picked */
  B.tick = (dt) => {
    // the farm at work: sails turn with the wind, running machines shake and smoke, fountains play, fires burn, lamps come on at dusk
    const now = performance.now() / 1000, windy = G.s.weather === "wind" || G.s.weather === "storm" ? 2.4 : 1, P = G.player.pos, hour = G.s.minute / 60, dark = hour > 18.5 || hour < 6;
    for (const t of things.values()) {
      for (const s of t.group.userData.sails || []) s.m.rotation[s.axis] += dt * 0.9 * windy;
      const c = CATALOG[t.p.type], close = Math.hypot(t.p.x - P.x, t.p.z - P.z) < 70, y = t.group.position.y;
      t.fxIn = (t.fxIn || Math.random()) - dt;
      if (!close) continue;
      t.kick = Math.max(0, (t.kick || 0) - dt);                   // walking up to one and opening it gives it a turn, so you can see it work
      const running = c.machine && G.s.machines?.[t.p.id] && G.s.machines[t.p.id].at > G.s.day * 1440 + G.s.minute;
      const job = running ? RECIPES.find((r) => r.out === G.s.machines[t.p.id].out && r.machine === c.machine) : null;      // what's in it: a pot's broth and what floats in it
      if (c.use === "bin") { t.group.userData.run?.(now, !$("shop").hidden && /Shipping bin/.test($("shopTitle").textContent)); continue; }
      if (c.use === "barrel") { const w = G.water?.at(t); t.group.userData.run?.(now, !!w?.filling, { level: w ? w.level / w.cap : 0 }); continue; }
      t.group.userData.run?.(now, !!running || t.kick > 0 || !!c.sprinkle && hour > 6 && hour < 8, job);
      if (t.fxIn > 0) continue;
      if (running) { t.fxIn = 0.7; G.vfx.burst("smoke", t.p.x, y + 2, t.p.z, 0.3); }
      else if (t.p.type === "fountain") { t.fxIn = 0.14; G.vfx.burst("water", t.p.x, y + 3.6, t.p.z, 0.5); }
      else if (t.p.type === "bonfire") { t.fxIn = 0.2; G.vfx.burst("spark", t.p.x, y + 0.5, t.p.z, 0.25); if (Math.random() < 0.3) G.vfx.burst("smoke", t.p.x, y + 0.8, t.p.z, 0.2); }
      else if (c.sprinkle && hour > 6 && hour < 8) { t.fxIn = 0.2; G.vfx.burst("water", t.p.x, y + 1, t.p.z, 0.6); }
      else if (c.light && dark) { t.fxIn = 0.5; G.vfx.burst("spark", t.p.x, y + 3, t.p.z, 0.08); }
      else t.fxIn = 1;
    }
    for (const t of things.values()) if (t.pop) { t.pop = Math.max(0, t.pop - dt * 3); const k = 1 + Math.sin(t.pop * Math.PI) * 0.16; t.group.scale.set(k, 2 - k, k); if (!t.pop) t.group.scale.setScalar(1); }
    if (!B.active) return;
    const I = G.input, move = new THREE.Vector3();
    if (I.down.has("KeyW") || I.down.has("ArrowUp")) move.z -= 1;
    if (I.down.has("KeyS") || I.down.has("ArrowDown")) move.z += 1;
    if (I.down.has("KeyA") || I.down.has("ArrowLeft")) move.x -= 1;
    if (I.down.has("KeyD") || I.down.has("ArrowRight")) move.x += 1;
    if (move.lengthSq()) { B.focus.addScaledVector(move.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), I.yaw), dt * 26); const a = 175, b = 130; const k = Math.hypot(B.focus.x / a, B.focus.z / b); if (k > 1) { B.focus.x /= k; B.focus.z /= k; } }
    B.focus.y = THREE.MathUtils.lerp(B.focus.y, Math.max(2, land.ground(B.focus.x, B.focus.z)), Math.min(1, dt * 4));
    const cam = G.camera, r = I.zoom * 1.6;
    cam.position.lerp(new THREE.Vector3(Math.sin(I.yaw) * Math.cos(I.pitch), Math.sin(I.pitch), Math.cos(I.yaw) * Math.cos(I.pitch)).multiplyScalar(r).add(B.focus), Math.min(1, dt * 10));
    cam.lookAt(B.focus);
    drawGrid();
    const t = things.get(B.sel), tools = $("placeTools");
    if (t) {
      update(t);
      const p = new THREE.Vector3(t.p.x, t.group.position.y, t.p.z).project(cam);
      tools.style.left = `${Math.min(innerWidth - 90, Math.max(90, (p.x + 1) / 2 * innerWidth))}px`;
      tools.style.top = `${Math.min(innerHeight - 70, Math.max(150, (1 - p.y) / 2 * innerHeight + 18))}px`;
    }
  };
  B.test = { add, remove, turn, select, doUndo, why };
  return B;
}
