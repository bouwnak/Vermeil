// explore.js - the far turtles. No towns and no people: what the Shellwrights left behind (a city, caves, a flower ring, nests above the clouds)
// and the verse of the Waking Song each one keeps. A verse can only be reached with the right dinosaur: one that sniffs out the door under
// Pillarback's plaza, smashes Hollowshell's rockfall, lifts you into Fernhold's canopy, flies to Mistcrown's peak, dives Lagoonback's lagoon,
// slashes Thornwild's thorn wall, or digs through Glassflat's salt (VERSES in data.js).
import * as THREE from "three";
import { COMPANION, VERSES, versesOf } from "./data.js";
import { forest, prop } from "./assets.js";
import { madeProp } from "./made.js";
import { addSolid, dropSolid } from "./world.js";
import { popup } from "./ui.js";

const MEGA = "stylized_nature_megakit/", GROWN = "conv_ultimate_nature_pack/";
const mat = (color, more = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...more });
const STONE = mat(0xcfc4a8), DARK = mat(0x2a2620), WATER = mat(0x5fd8d0, { transparent: true, opacity: 0.82, roughness: 0.2 });
const GLOW = (c) => mat(c, { emissive: c, emissiveIntensity: 0.9 });
const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o; };
/** a little hash: the same layout every time a turtle is built */
const pick = (i, seed) => { const h = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453; return h - Math.floor(h); };

export function makeExplore(G) {
  const E = {}, s = G.s;
  s.verses ||= {};
  const at = (L, x, z) => L.land.ground(x, z);
  const put = (L, o, x, z, ry = 0, dy = 0) => { o.position.set(x, at(L, x, z) + dy, z); o.rotation.y = ry; L.group.add(o); return o; };
  const ring = (n, r, cx = 0, cz = 0) => [...Array(n)].map((_, i) => { const a = i / n * Math.PI * 2; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r, a]; });
  const spots = (L, list, s0 = 1) => list.map(([x, z, k = 1], i) => ({ x, y: at(L, x, z) - 0.05, z, ry: pick(i, x + z) * 6.3, s: s0 * k }));

  // ---------------- what each kind of far turtle is ----------------
  const BUILD = {
    /** Pillarback: an empty Shellwright city. A plaza ringed with pillars, straight streets lined with columns, roofless houses in blocks */
    async city(L) {
      L.keep = [[0, 0, 64]];
      for (const [x, z, a] of ring(10, 14)) { put(L, madeProp("pillar"), x, z, -a); addSolid(L, { x, z, r: 1.1 }); }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let k = 22; k <= 54; k += 8) for (const side of [-1, 1]) { const x = dx * k + dz * side * 6, z = dz * k + dx * side * 6; if (pick(k, dx + dz * 3 + side) < 0.2) continue; const p = put(L, madeProp("pillar"), x, z); if (pick(k, side) < 0.3) { p.scale.y = 0.4 + pick(k, 7) * 0.4; } addSolid(L, { x, z, r: 1.1 }); }       // some have fallen to stumps
        const ax = dx * 58, az = dz * 58; put(L, madeProp("arch"), ax, az, dx ? Math.PI / 2 : 0); addSolid(L, { x: ax + dz * 4, z: az + dx * 4, r: 1.4 }); addSolid(L, { x: ax - dz * 4, z: az - dx * 4, r: 1.4 });
      }
      // houses: four low walls each, some broken down, in the blocks between the streets
      for (const [bx, bz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (let i = 0; i < 4; i++) {
        const x = bx * (20 + (i % 2) * 16), z = bz * (20 + Math.floor(i / 2) * 16), w = 7 + pick(i, bx) * 3, d = 6 + pick(i, bz) * 3, g = new THREE.Group();
        for (const [px, pz, sx, sz] of [[0, -d / 2, w, 0.6], [0, d / 2, w * (pick(i, 3) < 0.4 ? 0.5 : 1), 0.6], [-w / 2, 0, 0.6, d], [w / 2, 0, 0.6, d * (pick(i, 5) < 0.4 ? 0.4 : 1)]]) {
          const h = 1.2 + pick(px + pz, i) * 2.6; g.add(mesh(new THREE.BoxGeometry(sx, h, sz), STONE, px - (sx < w && sz === 0.6 && px === 0 ? w * 0.25 : 0), h / 2, pz));
        }
        put(L, g, x, z, pick(i, 9) * 0.2);
        addSolid(L, { x, z, r: Math.min(w, d) * 0.45 });
      }
      for (const [x, z] of [[8, 30], [-30, -8], [30, -30]]) put(L, madeProp("statue"), x, z, pick(x, z) * 6);
      // two paved streets crossing at the plaza
      const paving = []; for (let k = -54; k <= 54; k += 2.4) { if (Math.abs(k) < 16) continue; for (const w of [-2.4, 0, 2.4]) paving.push([k, w], [w, k]); }
      await forest(`${MEGA}RockPath_Square_Wide.gltf`, L.group, spots(L, paving, 1.5));
    },
    /** Hollowshell: cave mouths at the feet of its mountains, dark inside, crystals glowing in the rock */
    async caves(L) {
      const mouths = [[-10, 22, 0], [40, 26, -0.6], [-44, 20, 0.6], [56, -26, -1.8], [-56, -24, 1.8]];
      for (const [x, z, ry] of mouths) {
        const g = new THREE.Group();
        g.add(mesh(new THREE.SphereGeometry(4.2, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), DARK, 0, -0.3, -2.2));
        for (let i = 0; i < 9; i++) { const a = i / 8 * Math.PI; const r = mesh(new THREE.DodecahedronGeometry(1.7 + pick(i, x) * 0.8, 0), mat(0x6e7466), Math.cos(a) * 4.6, Math.sin(a) * 4.6 * 0.95, -0.4); r.scale.set(1, 1.2, 1.4); g.add(r); }
        for (let i = 0; i < 5; i++) { const c = mesh(new THREE.ConeGeometry(0.35, 1.6 + pick(i, z) * 1.4, 5), GLOW([0x7fe8ff, 0xc89aff, 0x9affc8][i % 3]), -2.4 + i * 1.2, 0.7, -3 - pick(i, 2) * 1.2); c.rotation.z = (pick(i, 4) - 0.5) * 0.6; g.add(c); }
        put(L, g, x, z, ry, -0.2);
        for (const side of [-1, 1]) addSolid(L, { x: x + Math.cos(ry) * side * 4.6, z: z - Math.sin(ry) * side * 4.6, r: 1.6 });
      }
      // stalagmites and crystal clusters out in the open too
      for (let i = 0; i < 26; i++) { const a = pick(i, 1) * 6.3, d = 30 + pick(i, 2) * 80, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.8; if (at(L, x, z) < 4) continue; const c = mesh(new THREE.ConeGeometry(0.5 + pick(i, 3) * 0.6, 2 + pick(i, 4) * 3, 6), i % 3 ? mat(0x8a8478) : GLOW(0x7fe8ff)); put(L, c, x, z, 0, 1 + pick(i, 4) * 1.4); }
    },
    /** Fernhold: ferns as tall as houses, broad-leaved giants, and a platform high in the canopy */
    async forest(L) {
      L.keep = [[10, -10, 8]];
      const big = [...Array(70)].map((_, i) => { const a = pick(i, 11) * 6.3, d = 14 + pick(i, 12) * 140; return [Math.cos(a) * d, Math.sin(a) * d * 0.76, 0.8 + pick(i, 13) * 0.6]; }).filter(([x, z]) => at(L, x, z) > 4);
      await Promise.all([forest(`${MEGA}Fern_1.gltf`, L.group, spots(L, big, 7)), forest(`${MEGA}Plant_1_Big.gltf`, L.group, spots(L, big.filter((_, i) => i % 3 === 0).map(([x, z, k]) => [x + 4, z - 3, k]), 3.2)), forest(`${MEGA}Plant_7_Big.gltf`, L.group, spots(L, big.filter((_, i) => i % 4 === 1).map(([x, z, k]) => [x - 3, z + 4, k]), 3))]);
      for (const [x, z] of big.filter((_, i) => i % 5 === 0)) addSolid(L, { x, z, r: 1 });
      // the canopy platform: a great trunk, a deck at the top, the verse stone up on it
      const [vx, vz] = [10, -10], g = new THREE.Group(), bark = mat(0x6a4a2a), leaf = mat(0x3f9a46);
      g.add(mesh(new THREE.CylinderGeometry(1.4, 2.2, 9, 8), bark, 0, 4.5, 0), mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.4, 9), mat(0x8a6a3a), 0, 9, 0));
      for (let i = 0; i < 6; i++) { const l = mesh(new THREE.IcosahedronGeometry(3.4, 0), leaf, Math.cos(i) * 4, 11 + (i % 2), Math.sin(i) * 4); l.scale.y = 0.5; g.add(l); }
      put(L, g, vx + 3, vz); addSolid(L, { x: vx + 3, z: vz, r: 2.2 });
    },
    /** Bloomdrift: nothing but flowers, grass and birch, and a ring of flowers around a stone */
    async meadow(L) {
      L.keep = [[-10, 30, 7]];
      const field = [...Array(220)].map((_, i) => { const a = pick(i, 21) * 6.3, d = 8 + pick(i, 22) * 110; return [Math.cos(a) * d, Math.sin(a) * d * 0.78, 0.9 + pick(i, 23) * 0.6]; }).filter(([x, z]) => at(L, x, z) > 4);
      await Promise.all([forest(`${MEGA}Flower_3_Group.gltf`, L.group, spots(L, field.filter((_, i) => i % 2), 1.4)), forest(`${MEGA}Flower_4_Group.gltf`, L.group, spots(L, field.filter((_, i) => !(i % 2)), 1.4)),
        forest(`${MEGA}Flower_4_Group.gltf`, L.group, spots(L, ring(18, 5.5, -10, 30).map(([x, z]) => [x, z, 1.2]), 1.6)), forest(`${GROWN}Flowers.glb`, L.group, spots(L, field.map(([x, z]) => [x + 2, z + 2, 1]), 1.2))]);
      for (const [x, z] of [[-30, -20], [20, 40], [50, 10]]) put(L, madeProp("cairn"), x, z);
    },
    /** Mistcrown: stick nests with eggs on the high slopes, and clouds caught around the peaks */
    async peaks(L) {
      const twig = mat(0x8a6a44), egg = mat(0xf4ecd8);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * 6.3, x = 10 + Math.cos(a) * (22 + pick(i, 1) * 14), z = -10 + Math.sin(a) * (22 + pick(i, 2) * 14), g = new THREE.Group();
        for (let k = 0; k < 10; k++) { const t = mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 4), twig, Math.cos(k) * 0.9, 0.3, Math.sin(k) * 0.9); t.rotation.set(Math.PI / 2, 0, k * 0.63); g.add(t); }
        for (let k = 0; k < 2 + (i % 2); k++) { const e = mesh(new THREE.SphereGeometry(0.28, 7, 5), egg, (k - 1) * 0.36, 0.4, 0); e.scale.y = 1.3; g.add(e); }
        put(L, g, x, z);
      }
      const cloud = mat(0xffffff, { transparent: true, opacity: 0.9 });
      for (let i = 0; i < 14; i++) { const a = pick(i, 5) * 6.3, d = 20 + pick(i, 6) * 40, c = mesh(new THREE.IcosahedronGeometry(6 + pick(i, 7) * 6, 1), cloud); c.scale.y = 0.45; c.castShadow = false; c.position.set(10 + Math.cos(a) * d, 34 + pick(i, 8) * 30, -10 + Math.sin(a) * d); L.group.add(c); }
      const shrine = new THREE.Group(); for (const [x, z, a] of ring(4, 3)) { const p = madeProp("pillar"); p.scale.setScalar(0.5); p.position.set(x, 0, z); p.rotation.y = a; shrine.add(p); }
      put(L, shrine, 10, -10, 0, -0.2);
    },
    /** Lagoonback: a clear lagoon in its shell, coral growing in it, the verse stone on its floor */
    async lagoon(L) {
      L.keep = [[-30, -50, 9]];
      const [x, z] = [-30, -50], y = at(L, x, z), pool = mesh(new THREE.CircleGeometry(8, 12), WATER); pool.rotation.x = -Math.PI / 2; pool.position.set(x, y + 0.25, z); pool.castShadow = false; L.group.add(pool);
      for (let i = 0; i < 16; i++) { const a = i / 16 * 6.3, r = 2 + pick(i, 1) * 5, c = mesh(i % 3 ? new THREE.ConeGeometry(0.3, 1 + pick(i, 2), 5) : new THREE.IcosahedronGeometry(0.5, 0), mat([0xff8aa0, 0xffb060, 0xb88aff, 0x6ae0c0][i % 4])); c.position.set(x + Math.cos(a) * r, y - 0.2, z + Math.sin(a) * r); L.group.add(c); }
      for (const [rx, rz] of ring(12, 8.6, x, z)) prop(`${GROWN}Rock_${Math.floor(pick(rx, rz) * 5) + 1}.glb`, L.group, { x: rx, y: at(L, rx, rz) - 0.2, z: rz, scale: 0.7 });
    },
    /** Thornwild: a jungle; at its heart, a wall of thorns grown round the verse stone */
    async jungle(L) {
      L.keep = [[0, 20, 8]];
      const vine = mat(0x2f6a34), thorn = mat(0x8a5a3a);
      const wall = new THREE.Group();
      for (const [x, z] of ring(22, 5.4)) { const b = mesh(new THREE.IcosahedronGeometry(1.3 + pick(x, z) * 0.6, 0), vine, x, 1.1, z); b.scale.y = 1.4; wall.add(b); for (let k = 0; k < 4; k++) { const t = mesh(new THREE.ConeGeometry(0.1, 0.7, 4), thorn, x + Math.cos(k * 1.6) * 1.2, 1.2 + (k % 2) * 0.6, z + Math.sin(k * 1.6) * 1.2); t.rotation.set(Math.cos(k), 0, Math.sin(k) + 1.5); wall.add(t); } }
      put(L, wall, 0, 20);
      E.blockers.v7 = { L, o: wall, solids: ring(10, 5.4, 0, 20).map(([x, z]) => addSolid(L, { x, z, r: 1.4 })) };
      const ferns = [...Array(80)].map((_, i) => { const a = pick(i, 31) * 6.3, d = 12 + pick(i, 32) * 120; return [Math.cos(a) * d, Math.sin(a) * d * 0.77, 0.8 + pick(i, 33) * 0.5]; }).filter(([x, z]) => at(L, x, z) > 4);
      await Promise.all([forest(`${MEGA}Fern_1.gltf`, L.group, spots(L, ferns, 3)), forest(`${MEGA}Plant_7_Big.gltf`, L.group, spots(L, ferns.filter((_, i) => i % 3 === 0), 2))]);
    },
    /** Glassflat: white crust in plates, crystal clusters standing out of it, and a salt mound over the verse */
    async saltflat(L) {
      L.keep = [[0, 10, 5]];
      const crust = mat(0xf8f6f0), glass = mat(0xd8f4ff, { transparent: true, opacity: 0.8, roughness: 0.1 });
      for (let i = 0; i < 70; i++) { const a = pick(i, 41) * 6.3, d = pick(i, 42) * 70, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.75, p = mesh(new THREE.CylinderGeometry(2 + pick(i, 43) * 2, 2.2 + pick(i, 43) * 2, 0.16, 6), crust); put(L, p, x, z, pick(i, 44), 0.04); }
      for (let i = 0; i < 18; i++) { const a = pick(i, 51) * 6.3, d = 20 + pick(i, 52) * 90, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.75, g = new THREE.Group(); for (let k = 0; k < 5; k++) { const c = mesh(new THREE.ConeGeometry(0.4, 2 + pick(k, i) * 2.4, 5), glass, (pick(k, 1) - 0.5) * 1.6, 1, (pick(k, 2) - 0.5) * 1.6); c.rotation.set((pick(k, 3) - 0.5) * 0.7, 0, (pick(k, 4) - 0.5) * 0.7); g.add(c); } put(L, g, x, z); addSolid(L, { x, z, r: 1.2 }); }
      const mound = mesh(new THREE.SphereGeometry(2.6, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), crust); put(L, mound, 0, 10, 0, -0.2);
      E.blockers.v8 = { L, o: mound, solids: [] };
    },
  };

  // ---------------- the verse stones ----------------
  E.blockers = {};
  const verseStone = (L, v) => {
    const raised = v.land === "fernwood" ? 9.2 : 0, sunk = !s.verses[v.id] && ["pillar", "reef", "salt"].includes(v.land);
    const o = madeProp("tablet"); o.scale.setScalar(1.5);
    o.position.set(v.x + (raised ? 3 : 0), at(L, v.x, v.z) + raised + (sunk ? -3.6 : 0) - (v.land === "reef" ? 0.8 : 0), v.z); o.rotation.y = 0.5; L.group.add(o);
    // a soft glow while it's still unread
    const halo = mesh(new THREE.CircleGeometry(1.8, 16), new THREE.MeshBasicMaterial({ color: 0x9ff3e6, transparent: true, opacity: 0.35, depthWrite: false }), 0, 0.06, 0); halo.rotation.x = -Math.PI / 2; halo.castShadow = false; o.add(halo); halo.visible = !s.verses[v.id];
    if (v.land === "hollow" && !s.verses[v.id]) {                // a rockfall in front of its cave
      const pile = new THREE.Group(); for (let i = 0; i < 7; i++) pile.add(mesh(new THREE.DodecahedronGeometry(0.9 + pick(i, 9) * 0.7, 0), mat(0x7a7468), (i - 3) * 0.9, 0.6 + (i % 2) * 0.9, 0));
      put(L, pile, v.x, v.z + 3); E.blockers.v3 = { L, o: pile, solids: [addSolid(L, { x: v.x, z: v.z + 3, r: 2.4 })] };
    }
    if (s.verses[v.id]) for (const b of [E.blockers[v.id]]) if (b) { b.L.group.remove(b.o); b.solids.forEach(dropSolid); }
    const rec = addSolid(L, { x: v.x, z: v.z + (v.land === "hollow" ? 5 : 0), r: 0 });
    rec.use = () => (s.verses[v.id] ? null : [v.needs ? `The stone ${v.where}` : "Read the verse stone", () => E.read(v, o, halo)]);
  };
  E.read = (v, o, halo) => {
    const P = G.player;
    if (v.needs && !v.needs.some((n) => G.canReach(n))) return G.talk.say(COMPANION.name, [v.hint]);
    s.verses[v.id] = true;
    const b = E.blockers[v.id];
    if (b) { b.L.group.remove(b.o); b.solids.forEach(dropSolid); G.vfx.burst(v.land === "thorn" ? "leaf" : v.land === "salt" ? "dust" : "stone", P.pos.x, P.pos.y + 1, P.pos.z, 3); G.sfx(v.land === "thorn" ? "rustle" : "stonebreak"); }
    if (o.position.y < at(G.world.lands[v.land], v.x, v.z) - 1) { const from = o.position.y, to = from + 3.6; let k = 0; const up = setInterval(() => { k = Math.min(1, k + 0.05); o.position.y = from + (to - from) * k; if (k >= 1) clearInterval(up); }, 40); }      // a sunk stone rises out of the ground
    halo.visible = false;
    P.riding?.char.react?.("roar"); P.riding?.say?.("happy");
    G.sfx("rare"); G.vfx.burst("glow", P.pos.x, P.pos.y + 1.5, P.pos.z, 2);
    popup(`Verse ${versesOf(s)} of ${VERSES.length} of the Waking Song`, "good");
    G.talk.say(COMPANION.name, [`"${v.text.replace(" / ", " ")}"`, ...(versesOf(s) === 1 ? ["A verse... carved by the Shellwrights, I think. It sounds like a lullaby. Old Moss would want to hear this."] : versesOf(s) >= VERSES.length ? ["That's all eight. We have the whole song. Let's take it to Old Moss."] : [`${VERSES.length - versesOf(s)} still out there.`])]);
  };

  E.build = async (L) => {
    const f = BUILD[L.cfg.feature];
    try { if (f) await f(L); } catch (e) { console.warn("[turtle] explore", L.cfg.id, e); }
    for (const v of VERSES) if (v.land === L.cfg.id) verseStone(L, v);
  };
  return E;
}
