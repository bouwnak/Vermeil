// made.js - models no pack has, made here in the same faceted style: the dinosaur (original, not from any game) and the little sailing boats.
import * as THREE from "three";

const paint = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 });

function lump(rx, ry, rz, mat, detail = 1) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, detail), mat);
  m.scale.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

const CONE = (r, h, mat, seg = 5) => { const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat); c.castShadow = true; return c; };

/** Any dinosaur of any line, all original: `spec.shape` says what it's made of, `stage` (0 to 2) how grown up it is.
 *  Babies are nearly all head; each form is longer, heavier and has more of what makes its line. Built facing +z, about `size` tall. */
export function makeDinoModel(spec, stage = 0, size = 3) {
  const S = spec.shape, k = size / (S.neck ? 3 + S.neck * 0.5 : 3), chibi = [1, 0.8, 0.66][stage], grow = [0.86, 1, 1.12][stage];
  const hide = paint(S.hide), belly = paint(S.belly), crest = paint(S.accent), dark = paint(0x2a2f38), white = paint(0xffffff), blush = paint(0xf7a9a0), toe = paint(S.belly);
  const holder = new THREE.Group(), body = new THREE.Group(), biped = S.legs === 2;
  holder.add(body);
  const trunk = lump(0.86 * k * grow, 0.76 * k * grow, (biped ? 0.8 : 0.92 + stage * 0.14) * k * grow, hide); body.add(trunk);
  const tummy = lump(0.66 * k * grow, 0.6 * k * grow, 0.5 * k * grow, belly); tummy.position.set(0, -0.12 * k, 0.5 * k * grow); body.add(tummy);
  if (biped) body.rotation.x = -0.32;
  // the neck, if this line has one, lifts the head away from the body
  let neckTop = new THREE.Vector3(0, (0.96 - (1 - chibi) * 0.3) * k * grow, 0.5 * k * grow);
  for (let n = 0; n < (S.neck || 0) + (S.neck ? stage : 0); n++) { const seg = lump(0.36 * k * (1 - n * 0.06), 0.44 * k, 0.36 * k, hide); seg.position.set(0, 0.5 * k + n * 0.55 * k, 0.6 * k + n * 0.2 * k); body.add(seg); neckTop.set(0, 0.5 * k + (n + 1) * 0.6 * k, 0.6 * k + (n + 1) * 0.22 * k); }
  // the head: the main thing about a chibi
  const head = new THREE.Group(); head.position.copy(neckTop); head.scale.setScalar(chibi); body.add(head);
  const skull = lump(0.94 * k, 0.82 * k, 0.86 * k, hide); head.add(skull);
  const muzzle = S.crest === "beak" ? CONE(0.36 * k, 0.9 * k, crest, 5) : lump(0.58 * k, 0.36 * k, 0.42 * k, belly);
  if (S.crest === "beak") { muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.14 * k, 1 * k); } else muzzle.position.set(0, -0.26 * k, 0.66 * k);
  head.add(muzzle);
  for (const s of [-1, 1]) {
    const eye = lump(0.2 * k, 0.26 * k, 0.1 * k, dark, 1); eye.position.set(s * 0.5 * k, 0.1 * k, 0.72 * k); eye.rotation.y = s * 0.55; head.add(eye);
    const shine = lump(0.08 * k, 0.09 * k, 0.04 * k, white, 0); shine.position.set(s * 0.46 * k, 0.2 * k, 0.83 * k); head.add(shine);
    const cheek = lump(0.15 * k, 0.09 * k, 0.05 * k, blush, 0); cheek.position.set(s * 0.72 * k, -0.2 * k, 0.56 * k); cheek.rotation.y = s * 0.8; head.add(cheek);
    if (S.crest !== "beak") { const dot = lump(0.04 * k, 0.04 * k, 0.03 * k, dark, 0); dot.position.set(s * 0.15 * k, -0.2 * k, 1.05 * k); head.add(dot); }
  }
  // what makes the line: it grows with every form
  if (S.crest === "fan") for (const [y, z, r, h, tilt] of [[0.8, -0.1, 0.34, 0.55, -0.5], [0.98, -0.5, 0.26, 0.5, -1], [1.02, -0.95, 0.17, 0.44, -1.5]]) { const c = CONE(r * k * (1 + stage * 0.25), h * k * (1 + stage * 0.45), crest); c.position.set(0, y * k, z * k); c.rotation.x = tilt; head.add(c); }
  if (S.crest === "frill") { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * k * (1 + stage * 0.3), 0.5 * k, 0.16 * k, 7, 1, false, -2.1, 4.2), crest); f.rotation.x = Math.PI / 2 - 0.4; f.position.set(0, 0.34 * k, -0.5 * k); f.castShadow = true; head.add(f); }
  if (S.crest === "feather") for (let n = 0; n <= stage + 1; n++) { const c = CONE(0.1 * k, 0.8 * k, crest, 4); c.position.set((n - (stage + 1) / 2) * 0.2 * k, 0.86 * k, -0.2 * k); c.rotation.x = -0.8; head.add(c); }
  if (S.crest === "dome") { const d = lump(0.74 * k, 0.5 * k + stage * 0.12 * k, 0.7 * k, crest); d.position.set(0, 0.56 * k, -0.08 * k); head.add(d); }
  if (S.crest === "fin") { const c = CONE(0.2 * k, 0.8 * k * (1 + stage * 0.3), crest, 4); c.position.set(0, 0.9 * k, -0.2 * k); c.rotation.x = -0.5; head.add(c); }
  if (S.horns) for (const s of [-1, 1]) for (let n = 0; n <= stage; n++) { const c = CONE(0.13 * k, 0.6 * k * (1 + stage * 0.3), belly, 5); c.position.set(s * (0.38 - n * 0.12) * k, 0.72 * k, 0.36 * k + n * 0.18 * k); c.rotation.set(0.6, 0, -s * 0.3); head.add(c); }
  const plates = S.crest === "plates" ? 3 + stage * 2 : S.armor ? 0 : 1 + stage;
  for (let n = 0; n < plates; n++) { const big = S.crest === "plates" ? 1.8 + stage * 0.3 : 1, c = CONE(0.16 * k * big, 0.32 * k * big, crest, 4); c.position.set(0, (0.74 + (S.crest === "plates" ? 0.1 : 0)) * k * grow, (0.3 - n * (1.3 / Math.max(plates, 2))) * k); body.add(c); }
  if (S.armor) for (let n = 0; n < 4 + stage * 3; n++) { const a = lump(0.26 * k, 0.16 * k, 0.26 * k, crest, 0); const u = n * 2.4; a.position.set(Math.sin(u) * 0.46 * k, 0.62 * k * grow, Math.cos(u) * 0.46 * k - 0.1 * k); a.rotation.y = u; body.add(a); }
  const tail = []; let at = body, last = null;
  const count = (S.tail || 2) + (stage > 0 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const seg = new THREE.Group(); seg.position.set(0, (i ? 0.05 : -0.08) * k, (i ? -0.42 : -0.8) * k * grow); at.add(seg);
    const r = Math.max(0.12, 0.42 - i * 0.1) * k * grow, m = CONE(r, 0.72 * k, hide, 6); m.rotation.x = -Math.PI / 2 - 0.15; m.position.z = -0.24 * k; seg.add(m);
    tail.push(seg); at = seg; last = seg;
  }
  if (S.club) { const c = lump(0.34 * k * grow, 0.3 * k * grow, 0.34 * k * grow, crest, 0); c.position.z = -0.7 * k; last.add(c); }
  // legs, or wings, or flippers. Legs start inside the body, so nothing floats
  const legs = [], wings = [];
  if (S.flippers) for (const [x, z, phase] of [[0.74, 0.3, 0], [-0.74, 0.3, Math.PI], [0.66, -0.5, Math.PI], [-0.66, -0.5, 0]]) {
    const hip = new THREE.Group(); hip.position.set(x * k * grow, -0.26 * k, z * k); body.add(hip);
    const f = lump(0.5 * k * grow, 0.1 * k, 0.26 * k, hide); f.position.x = Math.sign(x) * 0.42 * k * grow; f.rotation.z = -Math.sign(x) * 0.3; hip.add(f);
    legs.push({ hip, phase, fin: Math.sign(x) });
  } else for (const [x, z, phase] of biped ? [[0.42, -0.1, 0], [-0.42, -0.1, Math.PI]] : [[0.52, -0.34, 0], [-0.52, -0.34, Math.PI], [0.5, 0.42, Math.PI], [-0.5, 0.42, 0]]) {
    const hip = new THREE.Group(); hip.position.set(x * k * grow, -0.46 * k, z * k * grow); body.add(hip);
    if (biped) hip.rotation.x = 0.32;
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * k, 0.36 * k, 0.72 * k, 6), hide); stub.position.y = -0.26 * k; stub.castShadow = true; hip.add(stub);
    const foot = lump(0.36 * k, 0.16 * k, 0.44 * k, hide); foot.position.set(0, -0.6 * k, 0.1 * k); hip.add(foot);
    for (const s of [-1, 0, 1]) { const nail = lump(0.07 * k, 0.07 * k, 0.07 * k, toe, 0); nail.position.set(s * 0.17 * k, -0.6 * k, 0.5 * k); hip.add(nail); }
    legs.push({ hip, phase });
  }
  if (S.wings) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.6 * k, 0.4 * k * grow, 0); body.add(pivot);
    const span = (1 + stage * 0.75) * k * 1.6, g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.5 * k), new THREE.Vector3(s * span, 0.12 * k, -0.1 * k), new THREE.Vector3(0, 0, -0.7 * k), new THREE.Vector3(s * span * 0.6, 0, -0.9 * k)]);
    g.setIndex([0, 1, 2, 2, 1, 3]); g.computeVertexNormals();
    const mat = paint(S.accent); mat.side = THREE.DoubleSide; const w = new THREE.Mesh(g, mat); w.castShadow = true; pivot.add(w);
    wings.push({ pivot, s });
  }
  const HIGH = (S.flippers ? 0.92 : biped ? 1.24 : 1.26) * k, top = (S.neck ? neckTop.y : 0.8 * k) + HIGH;
  let walk = 0, amt = 0, nod = 0;
  return {
    holder, root: holder, actions: {}, mixer: { update() {} }, play() {}, seat: HIGH + 0.66 * k * grow, top,
    /** a bite, a dig, a spray: the head dips */
    work() { nod = 1; },
    move(dt, t, moving, riding, mode = "") {
      amt += ((moving ? 1 : 0) - amt) * Math.min(1, dt * 7);
      walk += dt * (riding ? 14 : 9) * amt;
      nod = Math.max(0, nod - dt * 2.2);
      const air = mode === "fly", sea = mode === "swim";
      for (const l of legs) { l.hip.rotation.x = (biped ? 0.32 : 0) + (air ? 0.7 : Math.sin(walk + l.phase) * 0.55 * amt); if (l.fin) l.hip.rotation.z = Math.sin(walk + l.phase) * 0.4 * amt * l.fin; }
      for (const w of wings) w.pivot.rotation.z = w.s * (air ? Math.sin(t * 7) * 0.6 + 0.1 : -0.75 + Math.sin(t * 1.4) * 0.05);
      body.position.y = HIGH + (air || sea ? Math.sin(t * 2.4) * 0.09 * k : Math.abs(Math.sin(walk)) * 0.1 * k * amt + Math.sin(t * 2) * 0.012 * k);
      body.rotation.z = Math.sin(walk) * 0.07 * amt;
      tail.forEach((s, i) => { s.rotation.y = Math.sin(t * 2.4 - i * 0.7 + walk) * (0.16 + i * 0.08); });
      head.rotation.x = Math.sin(t * 1.1) * 0.03 + amt * 0.05 + Math.sin(nod * Math.PI) * 0.8;
      head.rotation.y = amt ? 0 : Math.sin(t * 0.6) * 0.3;
      head.rotation.z = amt ? 0 : Math.sin(t * 0.4) * 0.05;
    },
  };
}

const box = (g, w, h, d, mat, x = 0, y = h / 2, z = 0, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
const cyl = (g, r, h, mat, x = 0, y = h / 2, z = 0, seg = 8, top = r) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(top, r, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };

/** the things no pack has: machines, furniture and ruins, in the same flat facets. Each stands on y = 0 */
export function madeProp(kind) {
  const g = new THREE.Group(), wood = paint(0xa8743e), dark = paint(0x6d4a28), stone = paint(0xb5b1a4), iron = paint(0x6c7078), cloth = paint(0xf0e3c0), red = paint(0xd8634a), glass = new THREE.MeshStandardMaterial({ color: 0xbfeee6, transparent: true, opacity: 0.32, roughness: 0.2, side: THREE.DoubleSide }), water = paint(0x53c8d6);
  const make = {
    greenhouse() {
      for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9], [0, -9], [0, 9], [-9, 0], [9, 0]]) box(g, 0.24, 3.2, 0.24, wood, x, 1.6, z);
      for (const s of [-1, 1]) { box(g, 18.2, 0.2, 0.2, wood, 0, 3.2, s * 9); box(g, 0.2, 0.2, 18.2, wood, s * 9, 3.2, 0); box(g, 18, 3, 0.05, glass, 0, 1.6, s * 9); if (s < 0) box(g, 0.05, 3, 18, glass, s * 9, 1.6, 0); else for (const z of [-5, 5]) box(g, 0.05, 3, 8, glass, 9, 1.6, z); }
      for (const s of [-1, 1]) { const r = box(g, 18.4, 0.05, 10.6, glass, 0, 4.6, s * 4.6); r.rotation.x = s * 0.5; }
      box(g, 18.4, 0.2, 0.2, wood, 0, 6.1, 0);
    },
    sprinkler() { cyl(g, 0.12, 0.8, iron); cyl(g, 0.3, 0.14, iron, 0, 0.84); },
    trough() { box(g, 2.2, 0.16, 1, wood, 0, 0.5); for (const s of [-1, 1]) { box(g, 2.2, 0.4, 0.1, wood, 0, 0.7, s * 0.45); box(g, 0.1, 0.4, 1, wood, s * 1.05, 0.7); box(g, 0.16, 0.5, 0.8, dark, s * 0.9, 0.25); } box(g, 2, 0.1, 0.8, paint(0xe6c86a), 0, 0.72); },
    bin() { box(g, 1.8, 0.9, 1.3, wood, 0, 0.5); for (const y of [0.2, 0.8]) box(g, 1.86, 0.08, 1.36, dark, 0, y); const lid = box(g, 1.86, 0.1, 1.36, dark, 0, 1.06, -0.2); lid.rotation.x = -0.36; },
    stall() { box(g, 3.4, 1, 1.2, wood, 0, 0.5); for (const [x, z] of [[-1.7, -0.6], [1.7, -0.6], [-1.7, 0.7], [1.7, 0.7]]) box(g, 0.14, 2.8, 0.14, dark, x, 1.4, z); for (let i = 0; i < 6; i++) { const c = box(g, 0.66, 0.08, 2, i % 2 ? cloth : red, -1.65 + i * 0.66, 2.86, 0); c.rotation.x = 0.16; } },
    workbench() { box(g, 2.2, 0.14, 1, wood, 0, 0.92); for (const [x, z] of [[-0.95, -0.38], [0.95, -0.38], [-0.95, 0.38], [0.95, 0.38]]) box(g, 0.14, 0.86, 0.14, dark, x, 0.43, z); box(g, 0.5, 0.2, 0.3, iron, -0.5, 1.08); box(g, 0.1, 0.1, 0.7, dark, 0.4, 1.04); },
    keg() { cyl(g, 0.72, 1.4, wood, 0, 0.7, 0, 9, 0.6); for (const y of [0.3, 1.1]) cyl(g, 0.74, 0.08, iron, 0, y, 0, 9); box(g, 0.08, 0.7, 0.08, iron, 0, 1.7); box(g, 0.9, 0.08, 0.08, iron, 0, 2); },
    jars() { for (const y of [0.1, 0.9]) box(g, 2, 0.1, 0.6, wood, 0, y); for (const s of [-1, 1]) box(g, 0.1, 1.7, 0.6, dark, s * 0.95, 0.85); [0.2, 0.5, 0.8].forEach((a) => { cyl(g, 0.15, 0.4, paint(0xe0a34a), a * 2 - 1.1, 0.38); cyl(g, 0.15, 0.4, paint(0xd8634a), a * 2 - 1.1, 1.17); }); },
    mill() { cyl(g, 0.86, 0.34, stone, 0, 0.5, 0, 9); cyl(g, 0.8, 0.3, stone, 0, 0.84, 0, 9); box(g, 0.1, 0.7, 0.1, dark, 0.5, 1.2); cyl(g, 1, 0.34, wood, 0, 0.17, 0, 9); },
    oven() { box(g, 2, 1, 1.6, stone, 0, 0.5); const d = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 4, 0, 6.3, 0, 1.57), stone); d.scale.set(0.95, 0.8, 0.76); d.position.y = 1; d.castShadow = true; g.add(d); box(g, 0.8, 0.5, 0.06, dark, 0, 1.2, 0.76); cyl(g, 0.16, 0.7, stone, 0, 2, -0.3); },
    smoker() { box(g, 1.8, 1.9, 1.8, dark, 0, 0.95); const r = CONE(1.6, 1, wood, 4); r.rotation.y = Math.PI / 4; r.position.y = 2.4; g.add(r); box(g, 0.7, 1.2, 0.05, wood, 0, 0.6, 0.92); },
    cellar() { box(g, 2.4, 0.9, 1.8, stone, 0, 0.45); const r = CONE(1.9, 0.7, dark, 4); r.rotation.y = Math.PI / 4; r.position.y = 1.2; g.add(r); box(g, 0.9, 0.7, 0.06, wood, 0, 0.4, 0.92); },
    bench() { box(g, 2, 0.1, 0.6, wood, 0, 0.55); box(g, 2, 0.5, 0.08, wood, 0, 0.95, -0.28); for (const s of [-1, 1]) box(g, 0.1, 0.55, 0.5, dark, s * 0.86, 0.27); },
    lamp() { cyl(g, 0.08, 3, dark, 0, 1.5, 0, 6); const l = lump(0.24, 0.3, 0.24, new THREE.MeshBasicMaterial({ color: 0xffe2a0 })); l.position.y = 3.1; g.add(l); const c = CONE(0.36, 0.26, dark, 6); c.position.y = 3.5; g.add(c); g.userData.glow = l; },
    sign() { box(g, 0.14, 2, 0.14, dark, 0, 1); box(g, 1.4, 0.6, 0.08, wood, 0, 1.7); },
    statue() { box(g, 1.8, 0.5, 1.8, stone, 0, 0.25); const s = lump(0.9, 0.5, 1.1, stone); s.position.y = 1.1; g.add(s); const h = lump(0.3, 0.3, 0.34, stone); h.position.set(0, 1.2, 1.24); g.add(h); for (const [x, z] of [[1, 0.7], [-1, 0.7], [1, -0.7], [-1, -0.7]]) { const f = lump(0.34, 0.14, 0.26, stone, 0); f.position.set(x, 0.74, z); g.add(f); } },
    fountain() { cyl(g, 2, 0.6, stone, 0, 0.3, 0, 9); cyl(g, 1.7, 0.1, water, 0, 0.6, 0, 9); cyl(g, 0.3, 1.2, stone, 0, 1.1, 0, 7); cyl(g, 0.8, 0.2, stone, 0, 1.7, 0, 8); cyl(g, 0.66, 0.06, water, 0, 1.8, 0, 8); },
    crate() { box(g, 1.2, 1, 1.2, wood, 0, 0.5); for (const y of [0.06, 0.94]) box(g, 1.26, 0.1, 1.26, dark, 0, y); },
    pillar() { cyl(g, 1, 0.5, stone, 0, 0.25, 0, 7); cyl(g, 0.7, 7, stone, 0, 3.8, 0, 7, 0.6); box(g, 1.8, 0.5, 1.8, stone, 0, 7.5); },
    arch() { for (const s of [-1, 1]) { box(g, 1.6, 9, 1.6, stone, s * 4, 4.5); } box(g, 11, 1.6, 1.8, stone, 0, 9.6); },
    tablet() { box(g, 1.8, 0.3, 0.8, stone, 0, 0.15); const m = box(g, 1.5, 2.2, 0.3, stone, 0, 1.4); m.rotation.x = -0.08; for (let i = 0; i < 4; i++) box(g, 0.2 + i * 0.1, 0.1, 0.04, new THREE.MeshBasicMaterial({ color: 0x7fe0d0 }), -0.2 + (i % 2) * 0.3, 0.8 + i * 0.36, 0.18); },
    cairn() { for (let i = 0; i < 4; i++) { const s = lump(0.7 - i * 0.14, 0.28, 0.6 - i * 0.12, stone, 0); s.position.y = 0.22 + i * 0.42; s.rotation.y = i; g.add(s); } },
    board() { for (const s of [-1, 1]) box(g, 0.16, 2.6, 0.16, dark, s * 1.2, 1.3); box(g, 2.8, 1.5, 0.1, wood, 0, 1.8); for (const [x, y] of [[-0.8, 2], [0.1, 2.1], [0.7, 1.6], [-0.3, 1.5]]) box(g, 0.56, 0.42, 0.04, cloth, x, y, 0.07); },
    logjam() { for (const [x, y, ry] of [[0, 0.7, 0.4], [-0.4, 1.9, -0.3], [0.6, 2.6, 0.7], [-0.2, 0.8, 1.2], [0.2, 2.1, 1.5]]) { const c = cyl(g, 0.72, 12, wood, x, y, 0, 7); c.rotation.set(Math.PI / 2, 0, ry); } },
    wind() { },
  };
  (make[kind] || make.crate)();
  return g;
}

/** a tool in the hand, along +y from the fist */
export function makeTool(id) {
  const g = new THREE.Group(), wood = paint(0x9a6a3c), iron = paint(0x9aa0a8), blue = paint(0x5aa9d6);
  if (id === "can") { cyl(g, 0.15, 0.3, blue, 0, 0.0, 0.2, 7); const s = cyl(g, 0.03, 0.34, blue, 0, 0.06, 0.46, 5); s.rotation.x = 1; box(g, 0.03, 0.03, 0.26, blue, 0, 0.2, 0.2); return g; }
  cyl(g, 0.03, 1.15, wood, 0, 0.42, 0, 5);
  if (id === "hoe") box(g, 0.05, 0.16, 0.34, iron, 0, 0.98, 0.14);
  if (id === "axe") { box(g, 0.05, 0.3, 0.26, iron, 0, 0.9, 0.12); box(g, 0.05, 0.38, 0.06, iron, 0, 0.9, 0.26); }
  if (id === "pick") box(g, 0.05, 0.07, 0.8, iron, 0, 0.98, 0);
  return g;
}

/** a small sailing boat for the horizon */
export function makeBoat(scale = 1) {
  const g = new THREE.Group(), wood = paint(0xa8743e), sail = paint(0xfbf3dc);
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.7, 1, 6), wood); hull.scale.set(1, 1, 3); hull.position.y = 0.3; hull.castShadow = true; g.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 5), wood); mast.position.y = 3.4; g.add(mast);
  const cloth = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 6, 0.1), new THREE.Vector3(0, 1.3, 0.1), new THREE.Vector3(0, 1.3, -2.8)]), sail);
  cloth.geometry.computeVertexNormals(); cloth.material.side = THREE.DoubleSide; g.add(cloth);
  g.scale.setScalar(scale);
  return g;
}
