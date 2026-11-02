// world.js - the place: every turtle and what grows on it, the ocean, and the clock, seasons and weather over all of it.
// A turtle is one entry of ISLANDS. Far ones are only land and shell until you come close; then their trees, town and people arrive.
import * as THREE from "three";
import { ISLANDS, SEASONS, DAYS_IN_SEASON, BRIDGE, WEATHER, FISH_PACK, A } from "./data.js";
import { makeBoat, madeProp } from "./made.js";
import { Land, makeTurtle, makeOcean, makeFoam, fbm } from "./terrain.js";
import { prop, forest, loadModel } from "./assets.js";

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed & 0xfffffff) / 0xfffffff; };
export const SHORE = 0.4;                                    // below this you're in the water
export const DOCK = { x: [-192, -140], z: [-3.2, 3.2], y: 2.3 };
const GROWN = "conv_ultimate_nature_pack/", MEGA = "stylized_nature_megakit/", SIMPLE = "conv_simple_nature_pack/";
const HOURS = [[0, 0x1b2c58], [5, 0x24406f], [6.5, 0xffc9a3], [9, 0x8fdcff], [16, 0x8fdcff], [18.5, 0xffb37a], [20, 0x35487f], [24, 0x1b2c58]];
function skyAt(h, out) {
  let i = 0;
  while (i < HOURS.length - 2 && h >= HOURS[i + 1][0]) i++;
  const [a, ca] = HOURS[i], [b, cb] = HOURS[i + 1];
  return out.set(ca).lerp(new THREE.Color(cb), (h - a) / (b - a));
}

// ---------------- who's where: solids and things you can gather live in a coarse grid on their turtle ----------------
const CELL = 16, cellKey = (x, z) => (Math.floor(x / CELL) + 512) * 4096 + Math.floor(z / CELL) + 512;
export function addSolid(L, rec) { rec.L = L; const k = cellKey(rec.x, rec.z); if (!L.cells.has(k)) L.cells.set(k, []); L.cells.get(k).push(rec); return rec; }
export function dropSolid(rec) { const list = rec.L?.cells.get(cellKey(rec.x, rec.z)); if (list) { const i = list.indexOf(rec); if (i >= 0) list.splice(i, 1); } }
function* around(L, x, z) {
  const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
  for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) { const c = L.cells.get((a + 512) * 4096 + b + 512); if (c) yield* c; }
}
/** the nearest thing around a world point that passes the test */
export function nearest(G, x, z, radius, test) {
  let best = null, bd = radius;
  for (const L of G.world.list) {
    if (!L.close(x, z)) continue;
    const [lx, lz] = L.local(x, z);
    for (const r of around(L, lx, lz)) { if (r.off || !test(r)) continue; const d = Math.hypot(r.x - lx, r.z - lz) - (r.r || 0); if (d < bd) { bd = d; best = r; } }
  }
  return best;
}
/** keep something out of trees, houses and rocks */
export function pushOut(G, p, radius = 0.5) {
  for (const L of G.world.list) {
    if (!L.close(p.x, p.z)) continue;
    let [x, z] = L.local(p.x, p.z), moved = false;
    for (const s of around(L, x, z)) {
      if (!s.r || s.off) continue;
      const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz), need = s.r + radius;
      if (d < need && d > 1e-4) { x += dx / d * (need - d); z += dz / d * (need - d); moved = true; }
    }
    if (moved) { const [wx, wz] = L.world(x, z); p.x = wx; p.z = wz; }
  }
}

/** ground under a point, in world space -> { y, on, land }: `on` is a turtle's id, bridge, dock or sea */
export function groundAt(G, x, z) {
  const W = G.world;
  let y = -14, on = "sea", land = null;
  for (const L of W.list) {
    if (!L.close(x, z)) continue;
    const [lx, lz] = L.local(x, z), h = L.land.ground(lx, lz);
    if (h > y) { y = h; if (h >= SHORE) { on = L.cfg.id; land = L; } else { on = "sea"; land = null; } }
  }
  if (x > DOCK.x[0] && x < DOCK.x[1] && z > DOCK.z[0] && z < DOCK.z[1] && y < DOCK.y) { y = DOCK.y; on = "dock"; land = W.lands.home; }
  const b = W.bridge;
  if (b?.open >= 1 && Math.abs(x - b.x) < b.half && z >= b.z0 - 0.5 && z <= b.z1 + 0.5) { y = Math.max(y, b.y + 0.12); on = "bridge"; land = W.lands.home; }
  return { y, on, land };
}
export const wet = (G, x, z) => groundAt(G, x, z).on === "sea";

// ---------------- what grows ----------------
function scatter(L, avoid, count, make, { low = 4.2, rough = 1.5 } = {}) {
  const { a, b } = L.cfg, land = L.land, out = [];
  for (let i = 0, n = 0; i < count * 6 && n < count; i++) {
    const t = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.96, x = Math.cos(t) * a * r, z = Math.sin(t) * b * r;
    if (avoid(x, z) || land.onRoad(x, z)) continue;
    const y = land.ground(x, z);
    if (y < low || land.rough(x, z, 1.6) > rough) continue;                     // never on a cliff, a road or the beach
    const m = make(x, y, z);
    if (m) { out.push(m); n++; }
  }
  return out;
}
const hide = (rec, gone) => {
  if (!rec.insts) return;
  const m = new THREE.Matrix4();
  for (const inst of rec.insts) {
    if (gone) { if (!rec.keep) rec.keep = []; inst.getMatrixAt(rec.i, m); rec.keep.push(m.clone()); inst.setMatrixAt(rec.i, m.makeScale(0, 0, 0)); }
    else if (rec.keep?.length) inst.setMatrixAt(rec.i, rec.keep[rec.insts.indexOf(inst)]);
    inst.instanceMatrix.needsUpdate = true;
  }
  if (!gone) rec.keep = null;
};
/** a tree, rock or plant is gone or back. s.cut remembers which day it went */
export function setGone(G, rec, gone) { rec.off = gone; hide(rec, gone); if (gone) (G.s.cut ||= {})[rec.key] = G.s.day; else delete G.s.cut?.[rec.key]; }
export function regrow(G) { for (const L of G.world.list) for (const list of L.cells.values()) for (const r of list) if (r.off && r.key && G.s.day - (G.s.cut?.[r.key] ?? 0) >= (r.back || 6)) setGone(G, r, false); }

const NODE_MODEL = { stone: `${GROWN}Rock_1.glb`, ore: `${GROWN}Rock_Moss_3.glb`, sandstone: `${GROWN}Rock_3.glb`, crystal: `${MEGA}Pebble_Square_2.gltf`, cinder: `${GROWN}Rock_4.glb`, relic: `${MEGA}Pebble_Square_4.gltf`, berry: `${GROWN}BushBerries_1.glb`, herb: `${MEGA}Fern_1.gltf`, wildcap: `${MEGA}Mushroom_Common.gltf`, fiber: `${MEGA}Grass_Wispy_Tall.gltf`, pearl: `${MEGA}Pebble_Round_2.gltf` };
const HARD = new Set(["stone", "ore", "sandstone", "crystal", "cinder", "relic"]);
function gather(G, L, jobs, parent, avoid, item, count, place = {}) {
  const spots = scatter(L, avoid, count, (x, y, z) => ({ x, y: y - 0.04, z, ry: rnd() * 6.3, s: place.s || (HARD.has(item) ? 1.1 : 1.1) }), { low: 3.6, ...place });
  for (const sp of spots) { sp.rec = addSolid(L, { x: sp.x, z: sp.z, r: HARD.has(item) ? 0.9 : 0, node: HARD.has(item) ? "rock" : "forage", item, key: `${L.cfg.id}:${item}:${sp.x | 0}:${sp.z | 0}`, back: 5 }); }
  jobs.push(forest(NODE_MODEL[item], parent, spots).then((insts) => spots.forEach((sp, i) => { sp.rec.insts = insts; sp.rec.i = i; if (G.s.day - (G.s.cut?.[sp.rec.key] ?? -99) < 5) { sp.rec.off = true; hide(sp.rec, true); } })));
}

async function plant(G, L, avoid, season) {
  const parent = new THREE.Group(), cfg = L.cfg, density = cfg.density || 1, jobs = [], sfx = cfg.id === "home" || cfg.id === "willowmere" ? ["", "", "_Autumn", "_Snow"][season] : "";
  L.group.add(parent);
  for (const [path, kinds, count, size, solid] of cfg.flora(sfx)) {
    const mega = path.startsWith(MEGA);
    for (let k = 1; k <= kinds; k++) {
      const spots = scatter(L, (x, z) => avoid(x, z) || (cfg.id === "home" && /Pine/.test(path) ? L.land.ground(x, z) < 12 : false), count * density / kinds,
        (x, y, z) => ({ x, y: y - 0.2, z, ry: rnd() * 6.3, s: size * (0.8 + rnd() * 0.6) }));
      for (const sp of spots) sp.rec = addSolid(L, { x: sp.x, z: sp.z, r: solid, node: "tree", key: `${cfg.id}:t${sp.x | 0}:${sp.z | 0}`, back: 7 });
      jobs.push(forest(`${path}${k}.${mega || path.includes("stylized_nature") ? "gltf" : "glb"}`, parent, spots).then((insts) => spots.forEach((sp, i) => { sp.rec.insts = insts; sp.rec.i = i; if (G.s.day - (G.s.cut?.[sp.rec.key] ?? -99) < 7) { sp.rec.off = true; hide(sp.rec, true); } })));
    }
  }
  const stones = cfg.stones || `${GROWN}Rock${season === 3 ? "_Snow" : ""}_`;
  for (let k = 1; k <= 5; k++) {
    const spots = scatter(L, avoid, 16 * density, (x, y, z) => ({ x, y: y - 0.1, z, ry: rnd() * 6.3, s: 0.8 + rnd() * 0.8 }));
    for (const sp of spots) sp.rec = addSolid(L, { x: sp.x, z: sp.z, r: 0.9, node: "rock", item: "stone", key: `${cfg.id}:r${sp.x | 0}:${sp.z | 0}`, back: 5 });
    jobs.push(forest(`${stones}${k}.glb`, parent, spots).then((insts) => spots.forEach((sp, i) => { sp.rec.insts = insts; sp.rec.i = i; if (G.s.day - (G.s.cut?.[sp.rec.key] ?? -99) < 5) { sp.rec.off = true; hide(sp.rec, true); } })));
  }
  const free = (name, count, s = 1) => jobs.push(forest(name, parent, scatter(L, avoid, count * density, (x, y, z) => ({ x, y: y - 0.04, z, ry: rnd() * 6.3, s: s * (0.7 + rnd() * 0.6) }))));
  if (cfg.biome !== "Desert" && cfg.biome !== "Volcanic") {
    if (season !== 3 || sfx === "") for (const [n, c] of [["Fern_1", 60], ["Flower_3_Group", 40], ["Flower_4_Group", 40], ["Clover_1", 60], ["Grass_Wispy_Tall", 90], ["Mushroom_Common", 24]]) free(`${MEGA}${n}.gltf`, c);
    if (season !== 3 || sfx === "") { for (const n of ["Grass", "Grass_2", "Grass_Short"]) free(`${GROWN}${n}.glb`, 90, 1.1); free(`${GROWN}Flowers.glb`, 70, 1.1); for (const k of [1, 2, 3, 4, 5]) free(`${GROWN}Plant_${k}.glb`, 14, 1.1); }
    for (const k of [1, 2]) free(`${GROWN}Bush${season === 3 && sfx ? "_Snow" : ""}_${k}.glb`, 50, 1.2);
    for (const k of [1, 2, 3]) free(`${SIMPLE}Bush${k}.glb`, 12, 0.8);
  }
  if (cfg.flower) free(`${MEGA}${cfg.flower}.gltf`, 50, 1.4);
  for (const [item, count] of cfg.nodes || []) gather(G, L, jobs, parent, avoid, item, count);
  if (cfg.id === "home") {
    for (const [item, count] of [["berry", 26], ["fiber", 60], ["wildcap", 12]]) gather(G, L, jobs, parent, avoid, item, count);
    gather(G, L, jobs, parent, (x, z) => Math.hypot(x - 92, z + 46) > 20, "ore", 10);
  }
  await Promise.all(jobs);
}

/** the pier off your tail shore: the fish pack's dock, three lengths of it, deck at DOCK.y */
async function buildDock(parent) {
  const len = (DOCK.x[1] - DOCK.x[0]) / 3;
  const parts = await Promise.all([0, 1, 2].map(() => prop(`${FISH_PACK}Dock_Long_NoRope.glb`, parent, { ry: Math.PI / 2 })));
  parts.forEach((o, i) => {
    if (!o) return;
    const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3()), s = len / size.x;
    o.scale.setScalar(s);
    o.position.set(0, 0, 0);
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
    // the deck is where a ray coming down its middle first lands
    const hit = new THREE.Raycaster(new THREE.Vector3(c.x, b.max.y + 5, c.z), new THREE.Vector3(0, -1, 0)).intersectObject(o, true)[0];
    o.position.set(DOCK.x[1] - len * (i + 0.5) - c.x, DOCK.y - (hit?.point.y ?? b.max.y), -c.z);
  });
}

function pond(L, x, z, r, y) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 9), new THREE.MeshStandardMaterial({ color: 0x62d8d0, flatShading: true, roughness: 0.3, transparent: true, opacity: 0.9 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.08, z); L.group.add(m);
  const jobs = [];
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.3; jobs.push(prop(`${GROWN}Rock_${i % 5 + 1}.glb`, L.group, { x: x + Math.cos(a) * (r + 0.2), y: y - 0.1, z: z + Math.sin(a) * (r + 0.2), scale: 0.55 + (i % 3) * 0.14, ry: a })); }
  for (let i = 0; i < 4; i++) jobs.push(prop(`${GROWN}Lilypad.glb`, L.group, { x: x + Math.cos(i * 2) * r * 0.5, y: y + 0.1, z: z + Math.sin(i * 2) * r * 0.5, scale: 1.2, ry: i }));
  addSolid(L, { x, z, r: r + 0.2, pond: true });
  return Promise.all(jobs);
}

function tinted(o, color) { o?.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.color.lerp(new THREE.Color(color), 0.55); } }); }

/** come close, and a turtle fills in */
export async function detail(G, L) {
  if (L.detail) return L.detailed;
  L.detail = true;
  const cfg = L.cfg, season = G.world.season;
  L.detailed = (async () => {
    const town = cfg.flats[0], keep = cfg.clear ? cfg.clear.map((i) => cfg.flats[i]) : cfg.houses ? [town] : [];         // farmland, the plateau and town squares stay open
    const avoid = (x, z) => keep.some((f) => Math.hypot(x - f.x, z - f.z) < f.r * 1.02) || (cfg.ruins && Math.hypot(x, z - 20) < 30);
    if (cfg.houses) await Promise.all(cfg.houses.map(async ([path, x, z, h, ry]) => {
      const [wx, wz] = [town.x + x, town.z + z], o = await prop(path, L.group, { x: wx, y: L.land.ground(wx, wz) - 0.1, z: wz, height: h, ry });
      if (cfg.tint) tinted(o, cfg.tint);
      addSolid(L, { x: wx, z: wz, r: h < 3 ? 1.3 : h * 0.56 });
    }));
    if (cfg.ruins) {                                        // what's left of the Shellwrights
      const ring = [...Array(10)].map((_, i) => [Math.cos(i / 10 * 6.3) * 30, 20 + Math.sin(i / 10 * 6.3) * 30, i % 3 ? "pillar" : "arch", i / 10 * 6.3]);
      for (const [x, z, kind, a] of ring) { const o = madeProp(kind); o.position.set(x, L.land.ground(x, z) - 0.1, z); o.rotation.y = -a + Math.PI / 2; L.group.add(o); addSolid(L, { x, z, r: kind === "arch" ? 1.5 : 1.2 }); }
    }
    await plant(G, L, avoid, season);
    G.onDetail?.(L);
  })().catch((e) => console.warn("[turtle] detail", cfg.id, e));
  return L.detailed;
}

function makeLand(G, id, cfg, season) {
  cfg.id = id;
  const land = new Land(cfg), group = new THREE.Group(), body = makeTurtle(cfg), reach = Math.pow(cfg.a * 1.3, 2), L = { land, group, body, cfg, cells: new Map(), detail: false };
  group.add(land.mesh(id === "home" ? 2.8 : id === "willowmere" ? 3.2 : 4.4, season === 3 && (id === "home" || id === "willowmere")), makeFoam(cfg, land), body.group);
  L.local = (x, z) => { const dx = x - group.position.x, dz = z - group.position.z, a = group.rotation.y; if (!a) return [dx, dz]; const c = Math.cos(a), s = Math.sin(a); return [dx * c - dz * s, dx * s + dz * c]; };
  L.world = (x, z) => { const a = group.rotation.y; if (!a) return [x + group.position.x, z + group.position.z]; const c = Math.cos(a), s = Math.sin(a); return [x * c + z * s + group.position.x, -x * s + z * c + group.position.z]; };
  L.close = (x, z) => group.visible && (x - group.position.x) ** 2 + (z - group.position.z) ** 2 < reach;
  L.dist = (x, z) => Math.hypot(x - group.position.x, z - group.position.z);
  G.scene.add(group);
  return L;
}

/** after the story: one little drifting island a week, never quite the same */
function driftCfg(week) {
  const s = (n) => (fbm(week * 3.1 + n, n * 1.7) * 2) % 1, pal = [[0xf1d596, 0xcdb0e8], [0xeaf2f6, 0x8fe0c8], [0xfff0c8, 0xf0a0a8], [0xdfe8ee, 0x9fc0f0]][week % 4];
  return { name: ["Lantern Drift", "Pearl Drift", "Whisper Isle", "Mooncrumb", "Little Stray"][week % 5], biome: "Drifting", a: 56, b: 44, seed: 70 + week, deep: 14, route: { r: 2060, speed: 0.0012, phase: s(1) * 6.3 }, palette: { sand: pal[0], low: pal[1], mid: pal[1], high: 0xb7b3a3, snow: 0xffffff }, peaks: [[8, 4, 12, 14]], flats: [],
    flora: () => [[`${GROWN}Willow_`, 3, 14, 1.2, 0.6]], density: 1, nodes: [[["pearl", "relic", "crystal", "cinder"][week % 4], 8], ["berry", 6]], places: {} };
}

export async function buildWorld(G) {
  const { scene, s: save } = G;
  const season = Math.floor((save.day - 1) / DAYS_IN_SEASON) % 4;
  G.world = { season, lands: {}, list: [], bridge: { open: 0 } };
  const W = G.world;
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6), hemi = new THREE.HemisphereLight(0xffffff, 0xc8d8c0, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 420 });
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target, hemi);
  W.sun = sun; W.hemi = hemi;
  scene.fog = new THREE.Fog(0x8fdcff, 300, 1250);
  scene.background = new THREE.Color(0x8fdcff);
  W.ocean = makeOcean();
  scene.add(W.ocean);

  const cfgs = { ...ISLANDS };
  if (save.flags.after) cfgs.drift = driftCfg(Math.floor(save.day / 7));
  for (const [id, cfg] of Object.entries(cfgs)) { const L = W.lands[id] = makeLand(G, id, cfg, season); W.list.push(L); if (cfg.hidden && !save.flags.chart) L.group.visible = false; }

  await buildDock(W.lands.home.group);
  await pond(W.lands.home, -74, -8, 8, W.lands.home.land.ground(-74, -8));
  await Promise.all([detail(G, W.lands.home), detail(G, W.lands.willowmere)]);

  // life on the water
  W.boats = [];
  for (let i = 0; i < 6; i++) { const b = new THREE.Group(); scene.add(b); b.add(makeBoat(0.7 + rnd() * 0.5)); b.userData = { r: 240 + i * 90 + rnd() * 30, a: rnd() * 6.3, v: 0.012 + rnd() * 0.02 }; W.boats.push(b); }
  W.clouds = [];
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.94 });
  for (let i = 0; i < 26; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(14 + rnd() * 14, 1), cloudMat); b.position.set(k * 22 - 30, rnd() * 6, rnd() * 18); b.scale.y = 0.55; c.add(b); }
    c.position.set((rnd() - 0.5) * 1500, 110 + rnd() * 70, (rnd() - 0.5) * 1500);
    scene.add(c); W.clouds.push(c);
  }
  const birds = new Float32Array(90);
  for (let i = 0; i < 90; i++) birds[i] = (rnd() - 0.5) * (i % 3 === 1 ? 20 : 160) + (i % 3 === 1 ? 62 : 0);
  const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.BufferAttribute(birds, 3));
  W.birds = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0x4a5560, size: 1.3 })); scene.add(W.birds);
  const drops = new Float32Array(2400);
  for (let i = 0; i < 2400; i++) drops[i] = (rnd() - 0.5) * 80;
  const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(drops, 3));
  W.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: 0xbfe0ff, size: 0.22, transparent: true, opacity: 0.8 })); W.rain.visible = false; scene.add(W.rain);
}

export const clockText = (m) => { const h = Math.floor(m / 60) % 24, mm = Math.floor(m % 60 / 10) * 10; return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
export const seasonOf = (day) => ({ index: Math.floor((day - 1) / DAYS_IN_SEASON) % 4, name: SEASONS[Math.floor((day - 1) / DAYS_IN_SEASON) % 4], day: (day - 1) % DAYS_IN_SEASON + 1 });
export function pickWeather(day, season) {
  const r = fbm(day * 7.3, 2.1) * 2 - 0.35, u = fbm(day * 3.9, 8.7) * 2 - 0.5;
  if (season === 3) return u > 0.9 ? "aurora" : r > 0.7 ? "snow" : r > 0.48 ? "cloudy" : u > 0.65 ? "fog" : "sunny";
  if (season === 1 && u > 0.72) return "heat";
  if (season === 2 && u > 0.72) return "fog";
  if (u < -0.1 && r < 0.5) return "wind";
  return r > 0.88 ? "storm" : r > 0.8 ? "heavy" : r > 0.68 ? "rain" : r > 0.52 ? "cloudy" : "sunny";
}
export const isWet = (w) => !!WEATHER[w]?.wet;

/** one frame of the living world */
export function tickWorld(G, dt, t) {
  const W = G.world, s = G.s, hour = s.minute / 60, P = G.player, focus = P?.pos || new THREE.Vector3();
  const sky = skyAt(hour % 24, new THREE.Color()), We = WEATHER[s.weather] || WEATHER.sunny, wetDay = !!We.wet, dull = We.dull;
  sky.lerp(new THREE.Color(0x8f9aa8), Math.max(0, 1 - dull));
  if (s.weather === "heat") sky.lerp(new THREE.Color(0xffe0a8), 0.3);
  const dark = hour < 5 || hour > 20;
  if (s.weather === "aurora" && dark) sky.lerp(new THREE.Color(0x3fd0a8), 0.32 + Math.sin(t * 0.4) * 0.1);
  G.scene.background.copy(sky);
  G.scene.fog.color.copy(sky);
  G.scene.fog.near = We.fog ? 60 : 300; G.scene.fog.far = We.fog ? 420 : 1250;
  const day = smooth(5.5, 8, hour) * (1 - smooth(17.5, 20, hour));
  W.sun.intensity = (0.2 + day * 1.5) * dull;
  W.hemi.intensity = 0.7 + day * 1.5;
  W.sun.color.set(day > 0.7 ? 0xfff0d8 : 0xffb080);
  const ang = (hour - 6) / 12 * Math.PI;
  W.sun.target.position.copy(focus);
  W.sun.position.set(focus.x - Math.cos(ang) * 150, focus.y + 40 + Math.max(0.15, Math.sin(ang)) * 170, focus.z + 70);
  W.ocean.userData.tick(t);
  W.ocean.position.set(Math.round(focus.x / 24) * 24, -0.2, Math.round(focus.z / 24) * 24);
  W.lands.home.body.group.position.y = Math.sin(t * 0.5) * 0.12;
  const mood = { asleep: hour > 21.5 || hour < 5.5, rain: wetDay, moored: true };
  W.lands.home.body.update(t, mood);
  // Willowmere comes in the morning, moors for the day, and drifts off at night, unless you're still over there
  const town = W.lands.willowmere, off = town.cfg.dock.off, on = P?.ground?.on === "willowmere";
  const here = smooth(BRIDGE.arrive - 2, BRIDGE.open - 0.4, hour) * (1 - (on ? 0 : smooth(BRIDGE.close + 0.6, BRIDGE.close + 3, hour)));
  const k = on ? W.townK ?? 1 - here : 1 - here;
  W.townK = k;
  town.group.position.set(off[0] + k * 60, Math.sin(t * 0.4 + 2) * 0.1, off[1] + k * 110);
  town.body.update(t, { ...mood, moored: k < 0.01 });
  W.townHere = here;
  // the rest go their own way, and wait for you once you've tied up alongside
  for (const L of W.list) {
    const f = L.cfg.route;
    if (!f) continue;
    if (!L.group.visible) continue;
    const held = L.dist(focus.x, focus.z) < L.cfg.a + 120;
    if (!(s.turtles ||= {})[L.cfg.id]) s.turtles[L.cfg.id] = f.phase;
    if (!held) s.turtles[L.cfg.id] += f.speed * dt;
    const a = s.turtles[L.cfg.id];
    L.group.position.set(Math.cos(a) * f.r, 0, Math.sin(a) * f.r);
    L.group.rotation.y = -a;
    if (L.dist(focus.x, focus.z) < 900) L.body.update(t, { ...mood, moored: held });
    if (!L.detail && L.dist(focus.x, focus.z) < L.cfg.a + 340) detail(G, L);
  }
  for (const b2 of W.boats) { const u = b2.userData; u.a += u.v * dt; b2.position.set(Math.cos(u.a) * u.r, 0.2 + Math.sin(t + u.a) * 0.25, Math.sin(u.a) * u.r); b2.rotation.y = -u.a; }
  for (const c of W.clouds) { c.position.x += dt * (s.weather === "wind" || s.weather === "storm" ? 5 : 1.6); if (c.position.x > 800) c.position.x = -800; }
  W.birds.position.set(focus.x + Math.sin(t * 0.05) * 70, 0, focus.z + Math.cos(t * 0.05) * 70);
  W.rain.visible = wetDay || s.weather === "snow";
  if (W.rain.visible) {
    W.rain.position.set(focus.x, 0, focus.z);
    const p = W.rain.geometry.attributes.position, fall = s.weather === "snow" ? 3 : s.weather === "storm" ? 48 : 34;
    for (let i = 1; i < p.array.length; i += 3) { p.array[i] -= fall * dt; if (p.array[i] < -2 + focus.y) p.array[i] = focus.y + 38; }
    p.needsUpdate = true;
  }
}

export { A, loadModel };
