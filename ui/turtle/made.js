// made.js - models no pack has, made here in the same faceted style: the dinosaur (original, not from any game) and the little sailing boats.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const paints = new Map();
const paint = (color) => { if (!paints.has(color)) paints.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 })); return paints.get(color); };

function lump(rx, ry, rz, mat, detail = 1) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, detail), mat);
  m.scale.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

const CONE = (r, h, mat, seg = 5) => { const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat); c.castShadow = true; return c; };

/** a faceted tube through rings of [z, y, half width, half height]: two-toned, darker above, paler below */
function tube(rings, top, under, sides = 7) {
  const pos = [], col = [], a = new THREE.Color(top), b = new THREE.Color(under), P = (r, i) => { const u = i / sides * Math.PI * 2; return [Math.sin(u) * r[2], r[1] + Math.cos(u) * r[3], r[0]]; };
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < sides; i++) {
    const A = P(rings[r], i), B = P(rings[r], i + 1), C = P(rings[r + 1], i), D = P(rings[r + 1], i + 1), low = Math.cos((i + 0.5) / sides * Math.PI * 2) < -0.2, c = low ? b : a;
    for (const v of [A, C, B, B, C, D]) { pos.push(...v); col.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, side: THREE.DoubleSide }));
  m.castShadow = true;
  return m;
}

/** one continuous skin along a chain of bones, so a neck or tail bends without gaps. rings: [z, y, half width, half height, [bone, next bone, how far toward it]] */
function skinTube(rings, bones, top, under, sides = 8) {
  const pos = [], col = [], si = [], sw = [], a = new THREE.Color(top), b = new THREE.Color(under), P = (r, i) => { const u = i / sides * Math.PI * 2; return [Math.sin(u) * r[2], r[1] + Math.cos(u) * r[3], r[0]]; };
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < sides; i++) {
    const low = Math.cos((i + 0.5) / sides * Math.PI * 2) < -0.25, c = low ? b : a;
    for (const [ring, k] of [[r, i], [r + 1, i], [r, i + 1], [r, i + 1], [r + 1, i], [r + 1, i + 1]]) {
      pos.push(...P(rings[ring], k)); col.push(c.r, c.g, c.b);
      const [from, to, t] = rings[ring][4];
      si.push(from, to, 0, 0); sw.push(1 - t, t, 0, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  g.computeVertexNormals();
  const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, side: THREE.DoubleSide }));
  m.castShadow = true; m.frustumCulled = false;
  bones[0].parent.add(m);
  bones[0].parent.updateMatrixWorld(true);
  m.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
  return m;
}

const ivory = () => paint(0xf4ecd6), gum = () => paint(0x5e2a32);
/** what fills a mouth: the dark inside, and teeth along each jaw. edge: stops along the jaw from the front, [{ z, up, low, w }]. Sharp: pointed and irregular, like a hunter's. Otherwise a flat cropping edge.
 *  -> { upper, lower }, to be fixed to the head and the jaw */
export function mouthParts(edge, len, sharp) {
  const parts = { up: [], low: [] }, inner = { up: [], low: [] }, tooth = (geo, x, y, z, flip) => { const g = geo.clone(); if (flip) g.rotateX(Math.PI); g.translate(x, y, z); return g; };
  const h = len * 0.17;
  edge.forEach((e, i) => {
    const k = 1 - i / edge.length * 0.5;
    for (const s of [-1, 1]) {
      if (sharp) {
        const c = new THREE.ConeGeometry(len * 0.034, h * k * (i % 2 ? 0.75 : 1), 4);
        parts.up.push(tooth(c, s * e.w, e.up - h * k * 0.32, e.z, true)); parts.low.push(tooth(c, s * e.w * 0.9, e.low + h * k * 0.3, e.z + len * 0.04, false));
      } else {                                            // a grazer: one low, even cropping edge along each jaw, more beak than teeth
        const c = new THREE.BoxGeometry(len * 0.035, len * 0.03, len * 0.09);
        parts.up.push(tooth(c, s * e.w * 0.92, e.up - len * 0.012, e.z, false)); parts.low.push(tooth(c, s * e.w * 0.92, e.low + len * 0.012, e.z, false));
      }
    }
    const lip = new THREE.BoxGeometry(e.w * 1.7, len * 0.008, len * 0.16);
    inner.up.push(tooth(lip, 0, e.up + len * 0.01, e.z, false)); inner.low.push(tooth(lip, 0, e.low - len * 0.01, e.z, false));
  });
  const clean = (list) => mergeGeometries(list.map((g) => { const c = g.index ? g.toNonIndexed() : g; c.deleteAttribute("uv"); return c; }));
  const build = (teeth, flesh) => { const g = new THREE.Group(), t = new THREE.Mesh(clean(teeth), ivory()), f = new THREE.Mesh(clean(flesh), gum()); t.castShadow = true; g.add(t, f); return g; };
  return { upper: build(parts.up, inner.up), lower: build(parts.low, inner.low) };
}

/** a riding saddle for a back `wide` across (half width) and `deep` from the spine to the belly: a blanket over the back, a leather seat sized for a person,
 *  a girth strap down each side and a stirrup at the end of it. Sits with the middle of its seat at the origin */
export function makeSaddle(wide, deep, color = 0xc8553d) {
  const g = new THREE.Group(), leather = paint(0x7a4a2a), dark = paint(0x4e2f1c), brass = paint(0xd9b25a), cloth = paint(color).clone(), w = Math.max(0.3, wide), long = Math.min(1.5, Math.max(0.7, w * 1.4));
  cloth.side = THREE.DoubleSide;
  const blanket = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.04, w * 1.04, long, 14, 1, true, Math.PI - 1.05, 2.1), cloth);
  blanket.rotation.x = Math.PI / 2; blanket.position.y = -w * 1.04 + 0.03; blanket.castShadow = true; g.add(blanket);
  const fringe = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.05, w * 1.05, long * 1.02, 14, 1, true, Math.PI - 1.08, 0.08), paint(0xf0d48a)); fringe.material.side = THREE.DoubleSide; fringe.rotation.x = Math.PI / 2; fringe.position.y = blanket.position.y; g.add(fringe);
  const fringe2 = fringe.clone(); fringe2.geometry = new THREE.CylinderGeometry(w * 1.05, w * 1.05, long * 1.02, 14, 1, true, Math.PI + 0.97, 0.08); g.add(fringe2);
  box(g, 0.5, 0.1, 0.62, leather, 0, 0.07, 0);                                   // the seat
  const cantle = box(g, 0.46, 0.2, 0.08, leather, 0, 0.18, -0.3); cantle.rotation.x = -0.25;     // the back of it
  box(g, 0.2, 0.18, 0.12, leather, 0, 0.17, 0.3); cyl(g, 0.05, 0.14, dark, 0, 0.3, 0.32, 6);     // the front, and a horn to hold
  for (const s of [-1, 1]) {
    const drop = Math.min(deep * 0.55, 1.1), side = new THREE.Group(); side.position.set(s * w * 0.92, -w * 0.5, 0.04); side.rotation.z = s * 0.1; g.add(side);
    box(side, 0.06, drop, 0.07, dark, 0, -drop / 2, 0);                           // the strap
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 5, 10), brass); ring.position.y = -drop - 0.06; ring.castShadow = true; side.add(ring);
    box(side, 0.04, 0.02, 0.12, brass, 0, -drop - 0.13, 0);                       // the step of the stirrup
  }
  for (const z of [-0.36, 0.36]) cyl(g, 0.035, 0.03, brass, 0, 0.1, z, 6);
  return g;
}

/** a rope or leather strap between two points, sagging under its own weight: set(a, b, sag) with a and b in its parent's space */
export function makeRope(color = 0x5b3520, r = 0.022, n = 12, sides = 5) {
  const pos = new Float32Array((n + 1) * sides * 3), idx = [], g = new THREE.BufferGeometry();
  for (let i = 0; i < n; i++) for (let k = 0; k < sides; k++) { const a = i * sides + k, b = i * sides + (k + 1) % sides, c = a + sides, d = b + sides; idx.push(a, c, b, b, c, d); }
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, paint(color)); m.castShadow = true; m.frustumCulled = false;
  const p = new THREE.Vector3(), t = new THREE.Vector3(), side = new THREE.Vector3(), up2 = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0);
  m.set = (a, b, sag) => {
    t.subVectors(b, a); const len = t.length() || 1e-3; t.divideScalar(len);
    side.crossVectors(t, UPV); if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize(); up2.crossVectors(side, t).normalize();
    for (let i = 0; i <= n; i++) {
      const u = i / n; p.lerpVectors(a, b, u); p.y -= sag * 4 * u * (1 - u);
      for (let k = 0; k < sides; k++) { const ang = k / sides * Math.PI * 2, o = (i * sides + k) * 3; pos[o] = p.x + (side.x * Math.cos(ang) + up2.x * Math.sin(ang)) * r; pos[o + 1] = p.y + (side.y * Math.cos(ang) + up2.y * Math.sin(ang)) * r; pos[o + 2] = p.z + (side.z * Math.cos(ang) + up2.z * Math.sin(ang)) * r; }
    }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
  };
  return m;
}

/** the animals the rigged pack doesn't have, built to match it: a flying reptile, a long-necked swimmer, an armoured one. Each form grows into its shape */
export function makeLofted(spec, stage, size) {
  const S = spec.shape, k = size / 3, baby = stage === 0, top = new THREE.Color(S.hide).lerp(new THREE.Color(0xffffff), [0.38, 0.1, 0][stage]).getHex(), low = S.belly, acc = paint(S.accent), holder = new THREE.Group(), body = new THREE.Group(), dark = paint(0x20242c);
  holder.add(body);
  const hs = baby ? 1.5 : 1, head = new THREE.Group(), jaw = new THREE.Group(), kind = S.kind, limbs = [], wings = [], chain = [];
  const trunk = kind === "ptero" ? [[-0.56, 0, 0.03, 0.03], [-0.3, 0, 0.14, 0.15], [0.05, 0.02, 0.21, 0.24], [0.36, 0.06, 0.19, 0.22], [0.62, 0.12, 0.09, 0.1]] : kind === "plesio" ? [[-1, 0, 0.42, 0.36], [-0.5, 0, 0.6, 0.46], [0.1, 0.02, 0.7, 0.52], [0.7, 0.02, 0.52, 0.42]] : [[-1, 0, 0.3, 0.26], [-0.5, 0, 0.74, 0.44], [0.2, 0.02, 0.84, 0.5], [0.8, 0, 0.56, 0.36], [1.1, -0.04, 0.26, 0.22]];
  const spine = new THREE.Bone(); body.add(spine);
  /** a leg from inside the body to the ground, `L` long: thigh, knee, shin and a three-toed foot. -> { hip, knee } to swing and bend */
  const leg = (parent, x, y, z, L, r, side, splay) => {
    const hip = new THREE.Group(), knee = new THREE.Group(), toe = paint(0x3a3430);
    hip.position.set(x, y, z); hip.rotation.z = side * splay; parent.add(hip);
    const thigh = tube([[0, 0, r, r * 1.1], [L * 0.52, 0, r * 0.78, r * 0.8]], top, low, 7); thigh.rotation.x = Math.PI / 2; hip.add(thigh);
    knee.position.y = -L * 0.5; hip.add(knee);
    const shin = tube([[-r * 0.3, 0, r * 0.8, r * 0.8], [L * 0.46, 0, r * 0.6, r * 0.6]], top, low, 7); shin.rotation.x = Math.PI / 2; knee.add(shin);
    const foot = lump(r * 1.05, L * 0.05, r * 1.35, paint(top), 1); foot.position.set(0, -L * 0.45, r * 0.3); knee.add(foot);
    for (const a of [-0.45, 0, 0.45]) { const t = new THREE.Mesh(new THREE.ConeGeometry(r * 0.22, r * 0.6, 4), toe); t.rotation.set(Math.PI / 2, 0, 0); t.position.set(Math.sin(a) * r * 0.75, -L * 0.47, r * 0.3 + Math.cos(a) * r * 1.3); t.castShadow = true; knee.add(t); }
    return { hip, knee };
  };
  // the neck is a chain, so it can sway
  let at = spine, seg = kind === "plesio" ? 3 + stage : kind === "ptero" ? 2 : 1, z0 = kind === "plesio" ? 1 : kind === "ptero" ? 0.55 : 1;
  const neck = [];
  for (let i = 0, nz = 0, ny = 0; i < seg; i++) {
    const n = new THREE.Bone(); n.position.set(0, (i ? (kind === "plesio" ? 0.05 : 0.1) : 0.04) * k, (i ? 0.34 : z0) * k); at.add(n);
    nz += n.position.z; ny += n.position.y;
    neck.push([nz, ny, kind === "plesio" ? Math.max(0.16, 0.36 - i * 0.05) * k : Math.max(0.09, 0.17 - i * 0.012) * k]);
    chain.push(n); at = n;
  }
  head.position.set(0, 0, 0.36 * k); head.scale.setScalar(hs); at.add(head);
  const lenH = kind === "ptero" ? 0.95 : kind === "plesio" ? 0.9 : 0.5;
  head.add(tube([[-0.1 * k, 0.03 * k, 0.1 * k, 0.1 * k], [0.14 * k, 0.05 * k, 0.17 * k, 0.15 * k], [lenH * 0.6 * k, 0.03 * k, 0.09 * k, 0.07 * k], [lenH * k, 0.02 * k, 0.015 * k, 0.015 * k]], top, low, 6));
  jaw.position.set(0, -0.05 * k, 0.1 * k); head.add(jaw);
  jaw.add(tube([[0, -0.02 * k, 0.1 * k, 0.04 * k], [(lenH - 0.14) * k, -0.02 * k, 0.012 * k, 0.012 * k]], low, low, 5));
  const eyes = [-1, 1].map((s) => { const e = lump(0.05 * k, 0.05 * k, 0.05 * k, dark, 1); e.position.set(s * 0.135 * k, 0.1 * k, 0.16 * k); head.add(e); return e; });
  if (kind === "ptero") { const n = (0.26 + stage * 0.3) * k, s = new THREE.Shape([new THREE.Vector2(0.14 * k, 0), new THREE.Vector2(-n, 0.2 * k + stage * 0.1 * k), new THREE.Vector2(-0.08 * k, -0.03 * k)]), c = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.022 * k, bevelEnabled: false, curveSegments: 1 }), acc); c.rotation.y = -Math.PI / 2; c.position.set(0.011 * k, 0.14 * k, 0.02 * k); c.castShadow = true; head.add(c); }
  const tail = [], tailAt = []; let tt = spine, tn = kind === "ptero" ? 1 : kind === "plesio" ? 5 : 3;
  for (let i = 0, tz = 0; i < tn; i++) { const q = new THREE.Bone(); q.position.z = (i ? -0.46 : kind === "plesio" ? -1.1 : -0.95) * k; tz += q.position.z; tt.add(q); tailAt.push([tz, (kind === "ptero" ? 0.04 : kind === "plesio" ? 0.3 - i * 0.05 : 0.26 - i * 0.06) * k]); tail.push(q); tt = q; }
  // all one skin, tail tip to neck, with half-way rings shared between bones so it bends smoothly
  const bones = [spine, ...chain, ...tail], nb = (n) => bones.indexOf(n), rings = [], ease = (a, b, t) => a + (b - a) * t;
  const last = tailAt.at(-1), tipZ = last[0] - 0.44 * k;
  rings.push([tipZ, 0, 0.01 * k, 0.01 * k, [nb(tail.at(-1)), nb(tail.at(-1)), 0]]);
  for (let i = tailAt.length - 1; i >= 0; i--) {
    const [z, r] = tailAt[i], hi = i ? tailAt[i - 1] : null;
    rings.push([z, 0, r, r, [nb(tail[i]), nb(tail[i]), 0]]);
    rings.push(hi ? [(z + hi[0]) / 2, 0, (r + hi[1]) / 2, (r + hi[1]) / 2, [nb(tail[i]), nb(tail[i - 1]), 0.5]] : [z * 0.86, 0, r * 1.15, r * 1.15, [nb(tail[0]), 0, 0.5]]);
  }
  for (const [z, y, w, h] of trunk) rings.push([z * k, y * k, w * k, h * k, [0, 0, 0]]);
  neck.forEach(([z, y, r], i) => {
    const up = i ? neck[i - 1] : null;
    if (up) rings.push([(z + up[0]) / 2, (y + up[1]) / 2, (r + up[2]) / 2, (r + up[2]) / 2, [nb(chain[i - 1]), nb(chain[i]), 0.5]]);
    else rings.push([z * 0.94, y, r * 1.05, r * 1.05, [0, nb(chain[0]), 0.5]]);
    rings.push([z, y, r, r, [nb(chain[i]), nb(chain[i]), 0]]);
  });
  const end = neck.at(-1);
  rings.push([end[0] + 0.3 * k, end[1], end[2] * 0.82, end[2] * 0.82, [nb(chain.at(-1)), nb(chain.at(-1)), 0]]);
  skinTube(rings.sort((p, q) => p[0] - q[0]), bones, top, low, 8);
  void ease;
  // the mouth: teeth for hunters, a flat edge for grazers
  { const L = lenH * k * hs, stops = [0.92, 0.8, 0.68, 0.56, 0.44, 0.32].map((u) => ({ z: lenH * k * u, up: 0.03 * k, low: -0.03 * k, w: (0.022 + (1 - u) * 0.09) * k })), { upper, lower } = mouthParts(stops, lenH * k * 0.72, spec.bite === "sharp"); void L; head.add(upper); lower.position.set(0, 0.05 * k, -0.1 * k); jaw.add(lower); }
  if (kind === "plesio") { const s = new THREE.Shape([new THREE.Vector2(0, 0.02), new THREE.Vector2(0.05, 0.42), new THREE.Vector2(-0.34, 0.5), new THREE.Vector2(-0.18, 0.02), new THREE.Vector2(-0.3, -0.26), new THREE.Vector2(0.04, -0.22)].map((p) => p.multiplyScalar(k))), f = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.03 * k, bevelEnabled: false, curveSegments: 1 }), paint(top)); f.rotation.y = Math.PI / 2 * -1 + Math.PI; f.rotation.y = Math.PI / 2; f.castShadow = true; tail.at(-1).add(f); }
  if (kind === "anky") {
    // rows of low rounded armour along the back, biggest down the middle
    for (const [x, y, z, n, r] of [[0, 0.5, 0.1, 5, 0.17], [0.3, 0.45, 0.1, 5, 0.13], [-0.3, 0.45, 0.1, 5, 0.13], [0.56, 0.3, 0.1, 4, 0.1], [-0.56, 0.3, 0.1, 4, 0.1]]) for (let i = 0; i < n + stage; i++) { const u = (i / (n + stage - 1) - 0.5) * 1.5, s = (baby ? 0.6 : 1) * (1 - Math.abs(u) * 0.3), c = lump(r * s * k, r * 0.5 * s * k, r * 1.2 * s * k, acc, 0); c.position.set(x * k, (y - u * u * 0.22) * k, (z + u) * k); body.add(c); }
    if (!baby) { const club = lump((0.2 + stage * 0.08) * k, (0.16 + stage * 0.06) * k, 0.26 * k, acc, 0); club.position.z = -0.5 * k; tt.add(club); }
    if (stage === 2) for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const c = CONE(0.07 * k, 0.22 * k, paint(S.belly), 5); c.position.set(s * 0.8 * k, 0.02 * k, (0.5 - i * 0.42) * k); c.rotation.set(-0.5, 0, -s * 1.15); body.add(c); }
  }
  if (kind === "ptero") {
    // real wings: a broad inner sail from the body to the wrist, and a long narrow hand that sweeps back to a point, with the arm as a ridge along the front edge
    const skinMat = paint(top).clone(), under = paint(S.belly).clone();
    skinMat.side = under.side = THREE.DoubleSide;
    const sail = (points, parent) => {
      const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z))), g = new THREE.ExtrudeGeometry(shape, { depth: 0.035 * k, bevelEnabled: false, curveSegments: 1 });
      g.rotateX(Math.PI / 2); g.scale(1, 1, -1); g.translate(0, 0.02 * k, 0);
      for (const a of ["position"]) g.attributes[a].needsUpdate = true;
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, skinMat); m.castShadow = true; parent.add(m); return m;
    };
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(s * 0.17 * k, 0.1 * k, 0.26 * k); body.add(pivot);
      const L = (0.9 + stage * 0.8) * k, tip = new THREE.Group(); tip.position.set(s * L * 0.46, 0, 0.12 * k); pivot.add(tip);
      sail([[0, 0.14 * k], [s * L * 0.46, 0.14 * k], [s * L * 0.46, -0.16 * k], [s * L * 0.3, -0.42 * k], [0, -0.72 * k]], pivot);
      sail([[0, 0.03 * k], [s * L * 0.26, 0.02 * k], [s * L * 0.62, -0.24 * k], [s * L * 0.3, -0.26 * k], [0, -0.28 * k]], tip);
      for (const [p, l] of [[pivot, L * 0.46], [tip, L * 0.6]]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * k, 0.04 * k, l, 5), acc); arm.rotation.z = Math.PI / 2; arm.position.set(s * l / 2, 0.03 * k, p === pivot ? 0.13 * k : -0.04 * k); arm.castShadow = true; p.add(arm); }
      wings.push({ pivot, tip, s });
    }
    // legs that reach the ground from inside the body, with a knee and a three-toed foot; tucked back in flight
    for (const s of [-1, 1]) limbs.push({ ...leg(body, s * 0.12 * k, -0.06 * k, -0.08 * k, 0.64 * k, 0.05 * k, s, 0.06), phase: s > 0 ? 0 : 3.14 });      // two legs only, under its middle so it balances
  } else for (const [x, z, ph] of [[0.62, 0.55, 0], [-0.62, 0.55, 3.14], [0.62, -0.55, 3.14], [-0.62, -0.55, 0]]) {
    if (kind === "plesio") { const hip = new THREE.Group(); hip.position.set(x * k, -0.2 * k, z * k); body.add(hip); const fin = tube([[0, 0, 0.1 * k, 0.03 * k], [(0.5 + stage * 0.28) * k, 0, 0.17 * k, 0.03 * k], [(1 + stage * 0.34) * k, 0, 0.02 * k, 0.01 * k]], top, low, 5); fin.rotation.y = Math.sign(x) * 1.2; hip.add(fin); limbs.push({ hip, phase: ph, fin: Math.sign(x) }); }
    else limbs.push({ ...leg(body, x * 0.7 * k, 0.04 * k, z * k, 0.8 * k, (z > 0 ? 0.2 : 0.24) * k, Math.sign(x), 0.05), phase: ph });          // from well inside the body, so seen from any side the leg grows out of it          // short, thick and splayed a little, like an armoured animal's
  }
  const HIGH = (kind === "ptero" ? 0.7 : kind === "plesio" ? 0.5 : 0.76) * k, LAY = kind === "ptero" || kind === "plesio" ? 0.3 : 1.45, WIDE = (kind === "ptero" ? 0.95 : kind === "plesio" ? 1 : 0.92) * k, E = { open: 0, want: 0, blink: 0, nextBlink: 2, nextYawn: 8, roll: 0, happy: 0, pet: 0, wag: 0 };
  let walk = 0, amt = 0;
  // the rider's place, on the body itself so it rides every step: [height of the back, half its width, depth, along]
  const [sy, sw, sd, sz] = kind === "ptero" ? [0.27, 0.21, 0.48, 0.05] : kind === "plesio" ? [0.55, 0.7, 1.04, 0.1] : [0.6, 0.84, 1, 0.2], saddle = new THREE.Object3D();
  saddle.position.set(0, sy * k, sz * k); body.add(saddle);
  return {
    holder, root: holder, actions: {}, mixer: { update() {} }, play() {}, seat: HIGH + 0.5 * k, top: HIGH + 0.9 * k, saddle, saddleWide: sw * k,
    addSaddle() {
      if (this.saddleMesh) return;
      this.saddleMesh = makeSaddle(sw * k, sd * k, S.accent); saddle.add(this.saddleMesh);
      // a halter round the snout and reins back to the saddle horn, or to the rider's hands
      const z = lenH * 0.5 * k, w = (0.022 + 0.5 * 0.09) * k * 1.5, leather = paint(0x5b3520), brass = paint(0xd9b25a);
      const band = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 5, 16), leather); band.scale.set(w, w * 0.8, w); band.position.set(0, 0, z); head.add(band);
      const rings = [-1, 1].map((s) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.03 * k, 0.008 * k, 5, 10), brass); r.position.set(s * w, 0, z); r.rotation.y = Math.PI / 2; head.add(r); return r; });
      const horn = new THREE.Object3D(); horn.position.set(0, 0.32, 0.34); this.saddleMesh.add(horn);
      const reins = rings.map(() => { const r = makeRope(0x5b3520, 0.012 * k + 0.008); holder.add(r); return r; }), a = new THREE.Vector3(), b2 = new THREE.Vector3();
      this.reinsTo = (hands) => { for (let i = 0; i < 2; i++) { rings[i].getWorldPosition(a); holder.worldToLocal(a); if (hands?.[i]) b2.copy(hands[i]); else horn.getWorldPosition(b2); holder.worldToLocal(b2); reins[i].set(a, b2, a.distanceTo(b2) * (hands ? 0.06 : 0.16)); } };
    },
    work() { E.want = 0.8; setTimeout(() => { E.want = 0; }, 450); }, once() { return 0.5; },
    held: () => E.roll > 0, drink() { E.pet = 2; E.want = 0.5; setTimeout(() => { E.want = 0; }, 2000); },
    react(kind2) { if (kind2 === "belly") E.roll = 3.6; if (kind2 === "pet") E.pet = 2.4; if (kind2 === "chin") { E.pet = 2; E.happy = 2; } E.wag = 2; if (kind2 === "play" || kind2 === "roar" || kind2 === "eat") { E.want = 0.9; setTimeout(() => { E.want = 0; }, 800); } },
    move(dt, t, moving, riding, mode = "") {
      amt += ((moving ? 1 : 0) - amt) * Math.min(1, dt * 7);
      walk += dt * (riding ? 13 : 8) * amt;
      const air = mode === "fly" || kind === "ptero" && moving && riding, sea = mode === "swim";
      for (const l of limbs) {
        l.hip.rotation.x = air ? 0.8 : Math.sin(walk + l.phase) * (l.fin ? 0.2 : 0.42) * amt;
        if (l.knee) l.knee.rotation.x = air ? 1.2 : Math.max(0, Math.sin(walk + l.phase + 1.4)) * 0.75 * amt;      // the foot lifts as it swings forward, flat on the ground as it pushes back
        if (l.arm) l.hip.visible = (E.open2 || 0) < 0.4;
        if (l.fin) l.hip.rotation.z = (sea ? Math.sin(t * 3 + l.phase) : Math.sin(walk + l.phase)) * 0.45 * (sea ? 1 : amt) * l.fin;
      }
      E.open2 = (E.open2 || 0) + ((air ? 1 : 0) - (E.open2 || 0)) * Math.min(1, dt * 5);
      for (const w of wings) {                               // folded back along the body on the ground, spread and beating in the air
        const o = E.open2, beat = Math.sin(t * 5.2);
        w.pivot.rotation.set(0, -w.s * (1 - o) * 1.05, w.s * (o * (beat * 0.5 + 0.08) + (1 - o) * 0.5));
        w.tip.rotation.set(0, w.s * (1 - o) * 2.5, w.s * o * (Math.sin(t * 5.2 - 0.9) * 0.34 - 0.08));
      }
      E.lay = (E.lay || 0) + ((E.roll > 0.5 ? 1 : 0) - (E.lay || 0)) * Math.min(1, dt * 5);
      body.position.y = THREE.MathUtils.lerp(HIGH, WIDE, E.lay) + (air || sea ? Math.sin(t * 2.4) * 0.08 * k : Math.abs(Math.sin(walk)) * 0.07 * k * amt + Math.sin(t * 2) * 0.012 * k);
      chain.forEach((n, i) => { n.rotation.y = Math.sin(t * 1.2 - i * 0.7) * 0.1; n.rotation.x = (kind === "plesio" ? (i < 2 ? -0.16 : 0.08) : 0) + Math.sin(t * 1.1 + i) * 0.03 + (E.pet > 0 ? Math.sin(t * 7) * 0.06 : 0); });
      tail.forEach((s, i) => { s.rotation.y = Math.sin(t * (E.wag > 0 ? 11 : 2.4) - i * 0.7 + walk) * (0.1 + i * 0.05); });
      if (t > E.nextBlink) { E.blink = 0.14; E.nextBlink = t + 1.6 + Math.random() * 3.6; }
      E.blink = Math.max(0, E.blink - dt); E.happy = Math.max(0, E.happy - dt); E.pet = Math.max(0, E.pet - dt); E.wag = Math.max(0, E.wag - dt);
      for (const e of eyes) e.scale.y = (E.blink > 0 || E.happy > 0 ? 0.08 : 1) * 0.05 * k;
      if (t > E.nextYawn && !moving) { E.nextYawn = t + 11 + Math.random() * 16; E.want = 0.8; setTimeout(() => { E.want = 0; }, 1200); }
      E.open += (E.want - E.open) * Math.min(1, dt * 9);
      jaw.rotation.x = E.open * 0.6;
      E.roll = Math.max(0, E.roll - dt);
      body.rotation.z = E.lay * LAY;
      if (E.lay > 0.2) for (const l of limbs) l.hip.rotation.x = Math.sin(t * 9 + l.phase) * 0.4;
    },
  };
}

const box = (g, w, h, d, mat, x = 0, y = h / 2, z = 0, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
const cyl = (g, r, h, mat, x = 0, y = h / 2, z = 0, seg = 8, top = r) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(top, r, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
/** a flat shape from an outline [[x, y], ...], `d` thick, centred on z */
const slab = (g, outline, d, mat, x = 0, y = 0, z = 0, ry = 0) => { const s = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b))), m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 1 }), mat); m.geometry.translate(0, 0, -d / 2); m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = true; g.add(m); return m; };
/** a barrel: staves round the middle and iron hoops */
const barrel = (g, r, h, wood, iron, x = 0, y = 0, z = 0) => { cyl(g, r * 0.86, h / 2, wood, x, y + h * 0.25, z, 12, r); cyl(g, r, h / 2, wood, x, y + h * 0.75, z, 12, r * 0.86); for (const u of [0.12, 0.38, 0.62, 0.88]) cyl(g, r * (u < 0.2 || u > 0.8 ? 0.91 : 1.01), 0.05, iron, x, y + h * u, z, 12); };

/** every lamp in the game shares one glass and one halo, so one call lights them all at dusk and puts them out at dawn */
const LAMP = { glass: new THREE.MeshBasicMaterial({ color: 0x8a7a5a }), halo: null, k: -1 };
function haloTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,236,180,1)"); r.addColorStop(0.35, "rgba(255,210,120,0.45)"); r.addColorStop(1, "rgba(255,190,90,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
/** the glass of a lamp and the glow round it, `size` across, at height y */
export function lampLight(size, y) {
  LAMP.halo ||= new THREE.SpriteMaterial({ map: haloTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
  const g = new THREE.Group(); g.position.y = y; g.userData.glow = null;
  const glass = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), LAMP.glass); glass.scale.set(size * 0.8, size, size * 0.8); g.add(glass);
  const halo = new THREE.Sprite(LAMP.halo); halo.scale.setScalar(size * 9); g.add(halo);
  return g;
}
/** k: 0 by day, 1 at night */
export function setLamps(k) {
  if (Math.abs(k - LAMP.k) < 0.01) return;
  LAMP.k = k;
  LAMP.glass.color.setRGB(0.54, 0.48, 0.35).lerp(new THREE.Color(1, 0.9, 0.62), k);
  if (LAMP.halo) LAMP.halo.opacity = k * 0.9;
}

/** a little fountain of soft dots that belongs to a prop: flames from an oven, smoke from a chimney. at: where they start, in the prop's own space.
 *  -> { tick(dt, rate) }: rate 0 lets the last ones fade out, 1 is full */
export function emitter(parent, at, { n = 40, colors = [0xffffff], up = 0.9, spread = 0.12, life = 1.6, size = 0.3, grow = 1.6, drift = 0.25, glow = false } = {}) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n), al = new Float32Array(n), vel = new Float32Array(n * 3), age = new Float32Array(n).fill(1e9), span = new Float32Array(n), c = new THREE.Color();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.setAttribute("size", new THREE.BufferAttribute(sz, 1)); geo.setAttribute("alpha", new THREE.BufferAttribute(al, 1));
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: "attribute float size; attribute float alpha; attribute vec3 color; varying vec3 c; varying float a; void main(){ c = color; a = alpha; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * 700.0 / max(1.0, -p.z); gl_Position = projectionMatrix * p; }",
    fragmentShader: "varying vec3 c; varying float a; void main(){ vec2 u = gl_PointCoord - 0.5; float d = dot(u, u); if (d > 0.25) discard; gl_FragColor = vec4(c, a * (1.0 - d * 4.0)); }" });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; parent.add(pts);
  let owed = 0;
  return {
    tick(dt, rate) {
      owed += rate * n / life * dt;
      for (let i = 0; i < n; i++) {
        if (age[i] >= span[i]) {
          if (owed < 1) { al[i] = 0; continue; }
          owed--; age[i] = 0; span[i] = life * (0.7 + Math.random() * 0.6);
          pos[i * 3] = at[0] + (Math.random() - 0.5) * spread; pos[i * 3 + 1] = at[1]; pos[i * 3 + 2] = at[2] + (Math.random() - 0.5) * spread;
          vel[i * 3] = (Math.random() - 0.5) * drift; vel[i * 3 + 1] = up * (0.7 + Math.random() * 0.6); vel[i * 3 + 2] = (Math.random() - 0.5) * drift;
          c.set(colors[i % colors.length]); c.toArray(col, i * 3);
        }
        age[i] += dt;
        const k = age[i] / span[i];
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        vel[i * 3] += Math.sin(age[i] * 3 + i) * drift * dt;            // a slow wander as it rises
        sz[i] = size * (1 + k * (grow - 1)); al[i] = Math.min(1, k * 6) * (1 - k);
      }
      owed = Math.min(owed, 2);
      for (const a of ["position", "color", "size", "alpha"]) geo.attributes[a].needsUpdate = true;
    },
  };
}
/** time between two calls of a prop's run(t), for what moves by itself */
export const stepper = () => { let last = null; return (t) => { const dt = last == null ? 0 : Math.min(0.1, Math.max(0, t - last)); last = t; return dt; }; };

/** everything that doesn't move in a prop is one mesh per material: a farm of machines stays cheap to draw */
function bake(g) {
  const lots = new Map();
  for (const m of [...g.children]) {
    if (!m.isMesh || m.userData.glow !== undefined) continue;
    m.updateMatrix();
    (lots.get(m.material) || lots.set(m.material, []).get(m.material)).push(m);
  }
  for (const [mat, list] of lots) {
    if (list.length < 2) continue;
    const parts = list.map((m) => { const c = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix); for (const k of Object.keys(c.attributes)) if (k !== "position" && k !== "normal") c.deleteAttribute(k); return c; }), one = new THREE.Mesh(mergeGeometries(parts), mat);
    one.castShadow = one.receiveShadow = true;
    g.remove(...list); g.add(one);
  }
  return g;
}

/** the things no pack has: machines, furniture and ruins, in the same flat facets. Each stands on y = 0.
 *  A machine's moving parts go in g.userData.run(t, on): `on` is true while it's working, and it comes to rest when it isn't */
export function madeProp(kind) {
  const g = new THREE.Group(), wood = paint(0xa8743e), pale = paint(0xc9975a), dark = paint(0x6d4a28), stone = paint(0xb5b1a4), stone2 = paint(0x98948a), iron = paint(0x6c7078), cloth = paint(0xf0e3c0), red = paint(0xd8634a), amber = paint(0xe0a34a), glass = new THREE.MeshStandardMaterial({ color: 0xbfeee6, transparent: true, opacity: 0.32, roughness: 0.2, side: THREE.DoubleSide }), water = paint(0x53c8d6), fire = new THREE.MeshBasicMaterial({ color: 0xffa04a });
  const rest = (x, want, dt = 0.08) => x + (want - x) * dt;
  const make = {
    greenhouse() {
      for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9], [0, -9], [0, 9], [-9, 0], [9, 0]]) box(g, 0.24, 3.2, 0.24, wood, x, 1.6, z);
      for (const s of [-1, 1]) { box(g, 18.2, 0.2, 0.2, wood, 0, 3.2, s * 9); box(g, 0.2, 0.2, 18.2, wood, s * 9, 3.2, 0); box(g, 18, 3, 0.05, glass, 0, 1.6, s * 9); if (s < 0) box(g, 0.05, 3, 18, glass, s * 9, 1.6, 0); else for (const z of [-5, 5]) box(g, 0.05, 3, 8, glass, 9, 1.6, z); }
      for (const s of [-1, 1]) { const r = box(g, 18.4, 0.05, 10.6, glass, 0, 4.6, s * 4.6); r.rotation.x = s * 0.5; }
      box(g, 18.4, 0.2, 0.2, wood, 0, 6.1, 0);
    },
    sprinkler() { cyl(g, 0.12, 0.8, iron); const h = new THREE.Group(); h.position.y = 0.84; g.add(h); cyl(h, 0.2, 0.1, iron, 0, 0, 0, 8); for (const s of [-1, 1]) box(h, 0.56, 0.05, 0.05, iron, s * 0.28, 0.04, 0); g.userData.run = (t, on) => { h.rotation.y += on ? 0.1 : 0.01; }; },
    trough() { box(g, 2.2, 0.16, 1, wood, 0, 0.5); for (const s of [-1, 1]) { box(g, 2.2, 0.4, 0.1, wood, 0, 0.7, s * 0.45); box(g, 0.1, 0.4, 1, wood, s * 1.05, 0.7); box(g, 0.16, 0.5, 0.8, dark, s * 0.9, 0.25); } box(g, 2, 0.1, 0.8, paint(0xe6c86a), 0, 0.72); },
    pen() {
      const R = 9;
      for (let i = -R; i <= R; i += 3) for (const [x, z] of [[i, -R], [i, R], [-R, i], [R, i]]) if (!(z === R && Math.abs(x) < 2)) box(g, 0.24, 1.3, 0.24, dark, x, 0.65, z);
      for (const y of [0.5, 1]) { box(g, 18, 0.1, 0.08, pale, 0, y, -R); box(g, 0.08, 0.1, 18, pale, -R, y, 0); box(g, 0.08, 0.1, 18, pale, R, y, 0); for (const s of [-1, 1]) box(g, 7, 0.1, 0.08, pale, s * 5.5, y, R); }
      box(g, 2.2, 0.16, 1, wood, -6, 0.5, -6.8); box(g, 2, 0.1, 0.8, paint(0xe6c86a), -6, 0.6, -6.8); for (const [x, z] of [[6, -6], [5.2, -6.6]]) cyl(g, 0.55, 0.7, paint(0xe6c86a), x, 0.35, z, 8);
    },
    bin() {
      // shut until you use it: the lid swings up on its back hinge, stays open while you're at it, and swings shut when you're done
      box(g, 1.8, 0.9, 1.3, wood, 0, 0.5); for (const y of [0.2, 0.8]) box(g, 1.86, 0.08, 1.36, dark, 0, y); for (const x of [-0.6, 0, 0.6]) box(g, 0.05, 0.9, 1.34, pale, x, 0.5);
      const hinge = new THREE.Group(); hinge.position.set(0, 1.0, -0.68); hinge.userData.glow = null; g.add(hinge);
      const lid = box(hinge, 1.86, 0.1, 1.36, dark, 0, 0.05, 0.68); lid.userData.glow = null; box(hinge, 0.3, 0.08, 0.1, pale, 0, 0.12, 1.3).userData.glow = null;     // the lid and its handle
      let o = 0, v = 0; const step = stepper();
      g.userData.run = (t, on) => { const dt = step(t); v += ((on ? 1 : 0) - o) * 60 * dt - v * 9 * dt; o = THREE.MathUtils.clamp(o + v * dt, -0.02, 1.05); hinge.rotation.x = -o * 1.75; };      // a little bounce as it lands
    },
    stall() { box(g, 3.4, 1, 1.2, wood, 0, 0.5); box(g, 3.5, 0.08, 1.3, pale, 0, 1.02); for (const [x, z] of [[-1.7, -0.6], [1.7, -0.6], [-1.7, 0.7], [1.7, 0.7]]) box(g, 0.14, 2.8, 0.14, dark, x, 1.4, z); for (let i = 0; i < 6; i++) { const c = box(g, 0.66, 0.08, 2, i % 2 ? cloth : red, -1.65 + i * 0.66, 2.86, 0); c.rotation.x = 0.16; c.userData.glow = null; } for (const [x, m] of [[-1, red], [-0.4, amber], [0.5, red], [1.1, amber]]) cyl(g, 0.18, 0.2, m, x, 1.14, 0.2, 7); },
    workbench() {
      box(g, 2.2, 0.14, 1, wood, 0, 0.92); box(g, 2.2, 0.06, 0.5, dark, 0, 0.42, 0);
      for (const [x, z] of [[-0.95, -0.38], [0.95, -0.38], [-0.95, 0.38], [0.95, 0.38]]) box(g, 0.14, 0.86, 0.14, dark, x, 0.43, z);
      box(g, 0.34, 0.18, 0.3, iron, -0.72, 1.08, 0.2); box(g, 0.06, 0.06, 0.34, iron, -0.72, 1.08, 0.5); cyl(g, 0.04, 0.26, dark, -0.72, 1.08, 0.66, 6).rotation.z = 1.57;       // a vice
      box(g, 0.9, 0.05, 0.28, pale, 0.3, 1.02, 0.14); box(g, 0.1, 0.06, 0.34, dark, 0.7, 1.05, -0.2); box(g, 0.16, 0.12, 0.08, iron, 0.7, 1.08, -0.04);    // a plank, a hammer
      slab(g, [[0, 0], [0.56, 0.06], [0.56, 0.14], [0, 0.14]], 0.02, iron, -0.36, 1, -0.3); box(g, 2.2, 0.8, 0.06, dark, 0, 1.4, -0.47); for (const x of [-0.7, -0.2, 0.3, 0.8]) box(g, 0.05, 0.42, 0.04, iron, x, 1.4, -0.42);       // the tool rack
    },
    keg() {
      // a screw press: the barrel below, the frame above, and a T-handle that drives the screw and plate down and lifts them up again
      barrel(g, 0.72, 1.3, wood, iron); cyl(g, 0.62, 0.06, paint(0x8e3d4a), 0, 1.22, 0, 12);
      for (const s of [-1, 1]) { box(g, 0.14, 2.5, 0.2, dark, s * 0.86, 1.25, 0); box(g, 0.5, 0.1, 0.34, dark, s * 0.86, 0.05, 0); }
      box(g, 1.96, 0.2, 0.26, dark, 0, 2.5, 0); cyl(g, 0.08, 0.1, red, 0.74, 0.52, 0.72, 6).rotation.x = 1.57;
      box(g, 0.1, 0.08, 0.34, wood, 0, 0.42, 0.82); const cup = cyl(g, 0.16, 0.2, iron, 0, 0.1, 0.98, 8, 0.2); cup.userData.glow = null;      // a spout and what it runs into
      const screw = new THREE.Group(); g.add(screw);
      cyl(screw, 0.06, 2.2, iron, 0, 1.14, 0, 6); for (let i = 0; i < 9; i++) cyl(screw, 0.085, 0.04, stone2, 0, 0.4 + i * 0.22, 0, 6);
      cyl(screw, 0.54, 0.1, pale, 0, 0.08, 0, 10); cyl(screw, 0.06, 1.1, iron, 0, 2.16, 0, 6).rotation.z = 1.57; for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), iron); b.position.set(s * 0.56, 2.16, 0); screw.add(b); }
      screw.position.y = 1.32;
      let k = 0;
      g.userData.run = (t, on) => { k = rest(k, on ? 1 : 0); const u = (Math.sin(t * 1.5) + 1) / 2; screw.position.y = 1.32 + (0.2 - u * 0.42) * k + 0.1 * (1 - k); screw.rotation.y = u * 6.3 * k; };
    },
    jars() {
      for (const y of [0.1, 0.9, 1.68]) box(g, 2, 0.1, 0.62, wood, 0, y); for (const s of [-1, 1]) box(g, 0.1, 1.8, 0.62, dark, s * 0.97, 0.9); box(g, 1.96, 1.7, 0.05, dark, 0, 0.9, -0.3);
      const lids = [];
      [[0.2, amber, 0.15], [0.5, amber, 0.15], [0.8, amber, 0.15], [0.2, red, 0.94], [0.5, red, 0.94], [0.8, red, 0.94]].forEach(([a, m, y]) => { const x = a * 2 - 1; cyl(g, 0.15, 0.36, m, x, y + 0.18, 0, 8, 0.13); box(g, 0.2, 0.12, 0.01, cloth, x, y + 0.18, 0.15); const l = new THREE.Group(); l.position.set(x, y + 0.38, 0); g.add(l); cyl(l, 0.15, 0.05, cloth, 0, 0, 0, 8); cyl(l, 0.08, 0.04, red, 0, 0.04, 0, 6); lids.push(l); });
      g.userData.run = (t, on) => lids.forEach((l, i) => { l.position.y += ((on ? Math.max(0, Math.sin(t * 9 + i * 1.7)) * 0.025 : 0) - (l.userData.up || 0)); l.userData.up = on ? Math.max(0, Math.sin(t * 9 + i * 1.7)) * 0.025 : 0; });
    },
    mill() {
      // a hand mill: the top stone turns, its crank going round with it
      cyl(g, 1, 0.34, wood, 0, 0.17, 0, 12); cyl(g, 1.06, 0.06, iron, 0, 0.3, 0, 12); cyl(g, 0.86, 0.34, stone, 0, 0.5, 0, 12); box(g, 0.34, 0.08, 0.5, stone2, 0.92, 0.42);      // the chute
      const top = new THREE.Group(); top.position.y = 0.67; g.add(top);
      cyl(top, 0.8, 0.3, stone2, 0, 0.15, 0, 12); cyl(top, 0.8, 0.03, stone, 0, 0.14, 0, 12); cyl(top, 0.22, 0.04, dark, 0, 0.32, 0, 8); box(top, 0.7, 0.08, 0.12, dark, 0.4, 0.34); cyl(top, 0.05, 0.56, pale, 0.72, 0.6, 0, 6);
      const sack = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), cloth); sack.scale.set(1, 1.2, 1); sack.position.set(1.3, 0.34, 0.5); sack.castShadow = true; g.add(sack);
      let s = 0;
      g.userData.run = (t, on) => { s = rest(s, on ? 1 : 0); top.rotation.y += s * 0.05; };
    },
    oven() {
      box(g, 2, 0.9, 1.7, stone, 0, 0.45);
      for (let i = 0; i < 3; i++) box(g, 2.04, 0.04, 1.74, stone2, 0, 0.2 + i * 0.3);
      const d = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 5, 0, 6.3, 0, 1.57), stone); d.scale.set(0.95, 0.8, 0.76); d.position.y = 0.9; d.castShadow = true; g.add(d);
      const arch = [[-0.42, 0], [-0.42, 0.34], [-0.2, 0.52], [0.2, 0.52], [0.42, 0.34], [0.42, 0]];
      slab(g, arch.map(([x, y]) => [x * 1.18, y * 1.14 - 0.03]), 0.1, stone2, 0, 0.92, 0.74); slab(g, arch, 0.08, paint(0x2a2320), 0, 0.92, 0.78);
      cyl(g, 0.18, 0.86, stone2, 0, 1.96, -0.3, 8); cyl(g, 0.22, 0.08, dark, 0, 2.4, -0.3, 8);
      for (const [x, y] of [[-1.3, 0.1], [-1.54, 0.1], [-1.42, 0.3]]) cyl(g, 0.11, 0.7, wood, x, y, 0.3, 6).rotation.x = 1.57;
      box(g, 0.9, 0.05, 0.5, dark, 0, 0.9, 1.02);          // the shelf for loaves
      const flame = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), fire); flame.position.set(0, 1.1, 0.8); flame.visible = false; flame.userData.glow = null; g.add(flame);
      const door = new THREE.Group(); door.position.set(-0.46, 0.92, 0.83); g.add(door);
      slab(door, arch.map(([x, y]) => [x + 0.44, y]), 0.05, dark); box(door, 0.04, 0.2, 0.08, iron, 0.74, 0.26, 0.05);
      // a fire always banked inside: flames and sparks out of the mouth, smoke from the chimney, all of it livelier while it's baking
      const flames = emitter(g, [0, 0.96, 0.8], { n: 50, colors: [0xffe36e, 0xffa23a, 0xff6a2a, 0xffc84a], up: 0.75, spread: 0.5, life: 0.75, size: 0.17, grow: 0.25, drift: 0.1 });
      const sparks = emitter(g, [0, 1.35, 0.9], { n: 22, colors: [0xffd060, 0xff8a2a], up: 1.5, spread: 0.3, life: 1.2, size: 0.05, grow: 0.6, drift: 0.6 });
      const smoke = emitter(g, [0, 2.46, -0.3], { n: 26, colors: [0xd8d4cc, 0xbab6ae], up: 0.7, spread: 0.12, life: 3, size: 0.36, grow: 3, drift: 0.3 });
      let o = 0; const step = stepper();
      g.userData.run = (t, on) => {
        const dt = step(t); o = rest(o, on ? 1 : 0);
        door.rotation.y = -o * 1.9; flame.visible = true; flame.scale.set(0.8, 0.6 + o * 0.25 + Math.sin(t * 13) * 0.08, 0.3).multiplyScalar(0.8 + Math.sin(t * 29) * 0.06);
        flames.tick(dt, 0.45 + o * 0.55); sparks.tick(dt, 0.2 + o * 0.8); smoke.tick(dt, 0.35 + o * 0.65);
      };
    },
    smoker() {
      box(g, 1.8, 1.9, 1.8, dark, 0, 0.95); for (let i = -2; i <= 2; i++) { box(g, 0.28, 1.9, 0.04, wood, i * 0.36, 0.95, 0.91); box(g, 0.28, 1.9, 0.04, wood, i * 0.36, 0.95, -0.91); box(g, 0.04, 1.9, 0.28, wood, 0.91, 0.95, i * 0.36); box(g, 0.04, 1.9, 0.28, wood, -0.91, 0.95, i * 0.36); }
      const r = CONE(1.6, 1, pale, 4); r.rotation.y = Math.PI / 4; r.position.y = 2.4; g.add(r);
      cyl(g, 0.16, 0.5, iron, 0, 3, 0, 6); box(g, 0.74, 1.24, 0.05, dark, 0, 0.62, 0.94);
      const cap = new THREE.Group(); cap.position.y = 3.28; g.add(cap); const c = CONE(0.28, 0.16, iron, 6); cap.add(c);
      const fish = []; for (const x of [-0.3, 0.3]) { const f = new THREE.Group(); f.position.set(x, 1.3, 0.97); g.add(f); const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), amber); b.scale.set(0.7, 1.7, 0.4); b.position.y = -0.24; f.add(b); fish.push(f); }
      // smoke curls out from under the cap all day; thick and fast while fish are curing
      const smoke = emitter(g, [0, 3.3, 0], { n: 40, colors: [0xcfcac0, 0xb3aea6, 0x9a958e], up: 0.8, spread: 0.2, life: 3.6, size: 0.42, grow: 3.4, drift: 0.35 });
      const leak = emitter(g, [0, 2.1, 0.92], { n: 12, colors: [0xc9c4ba], up: 0.4, spread: 0.6, life: 2.2, size: 0.26, grow: 2.2, drift: 0.2 });
      let s = 0; const step = stepper();
      g.userData.run = (t, on) => { const dt = step(t); s = rest(s, on ? 1 : 0); cap.position.y = 3.28 + s * (0.1 + Math.sin(t * 6) * 0.04); fish.forEach((f, i) => { f.rotation.z = Math.sin(t * 2 + i) * 0.14 * s; }); smoke.tick(dt, 0.4 + s * 0.6); leak.tick(dt, s * 0.8); };
    },
    cellar() {
      // a stone cellar house you could walk into: walls a little over head height, a door you'd fit through, and the cheese aging outside on its rack
      box(g, 4, 2.6, 3.4, stone, 0, 1.3); for (let i = 0; i < 4; i++) box(g, 4.06, 0.06, 3.46, stone2, 0, 0.35 + i * 0.6);
      for (const [x, z] of [[-2, -1.7], [2, -1.7], [-2, 1.7], [2, 1.7]]) box(g, 0.34, 2.7, 0.34, stone2, x, 1.35, z);
      const r = CONE(3.3, 1.5, dark, 4); r.rotation.y = Math.PI / 4; r.position.y = 3.35; g.add(r);
      box(g, 1.3, 2.25, 0.1, stone2, -0.4, 1.12, 1.71);                                // the door frame
      box(g, 0.7, 0.5, 0.08, paint(0x2a2320), 1.15, 1.7, 1.72); box(g, 0.8, 0.08, 0.16, wood, 1.15, 1.42, 1.76);      // a little window
      const door = new THREE.Group(); door.position.set(-0.9, 0, 1.78); g.add(door); box(door, 1, 2.05, 0.08, wood, 0.5, 1.05); for (const y of [0.4, 1.65]) box(door, 1.02, 0.08, 0.1, iron, 0.5, y); cyl(door, 0.05, 0.08, iron, 0.88, 1.05, 0.06, 6);
      barrel(g, 0.42, 1, wood, iron, 2.6, 0, 1.2); barrel(g, 0.42, 1, wood, iron, 2.75, 0, 0.2);
      box(g, 0.1, 1.5, 0.5, dark, 2.4, 0.75, -1.4); box(g, 0.1, 1.5, 0.5, dark, 3.4, 0.75, -1.4); for (const y of [0.5, 1.1]) box(g, 1.1, 0.06, 0.5, wood, 2.9, y, -1.4);     // the rack
      for (const [x, y] of [[2.65, 0.6], [3.12, 0.6], [2.7, 1.2], [3.1, 1.2]]) cyl(g, 0.22, 0.14, amber, x, y, -1.4, 10);
      let o = 0;
      g.userData.run = (t, on) => { o = rest(o, on ? 1 : 0); door.rotation.y = -o * (0.3 + Math.sin(t * 0.7) * 0.08); };
    },
    waterbarrel() {
      // the water tower's store: a big barrel by its leg, fed by a pipe from the tank. You see the water in it rise as it fills and fall when you draw from it, and a gauge on its side says how full
      barrel(g, 0.62, 1.25, wood, iron);
      const inside = new THREE.Mesh(new THREE.CircleGeometry(0.56, 16), new THREE.MeshStandardMaterial({ color: 0x53c8d6, roughness: 0.25, transparent: true, opacity: 0.9 })); inside.rotation.x = -Math.PI / 2; inside.userData.glow = null; g.add(inside);
      const pipe = paint(0x7c8288);
      cyl(g, 0.07, 5.3, pipe, -0.38, 3.85, 0, 8); cyl(g, 0.09, 0.12, pipe, -0.38, 1.24, 0, 8);
      const across = cyl(g, 0.07, 2.4, pipe, -1.55, 6.5, 0, 8); across.rotation.z = Math.PI / 2;
      const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), pipe); elbow.position.set(-0.38, 6.5, 0); g.add(elbow);
      const spout = cyl(g, 0.06, 0.3, pipe, -0.38, 1.38, 0, 8); spout.userData.glow = null;
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 5, 10), red); wheel.position.set(-0.38, 2.2, 0.1); g.add(wheel);         // the valve
      box(g, 0.08, 0.9, 0.04, dark, 0.64, 0.62, 0); const mark = box(g, 0.1, 0.06, 0.06, paint(0x53c8d6), 0.66, 0.2, 0); mark.userData.glow = null;      // the gauge
      const drip = emitter(g, [-0.38, 1.3, 0], { n: 20, colors: [0x9fe3ff, 0xd8f5ff], up: -1.6, spread: 0.04, life: 0.35, size: 0.06, grow: 0.8, drift: 0.02 });
      let lv = 0.5; const step = stepper();
      g.userData.run = (t, on, job) => {
        const dt = step(t); lv += ((job?.level ?? lv) - lv) * Math.min(1, dt * 3);
        inside.position.y = 0.08 + lv * 1.1; inside.visible = lv > 0.01;
        mark.position.y = 0.2 + lv * 0.84;
        drip.tick(dt, on ? 1 : 0);
      };
    },
    pot() {
      // a big iron pot on three legs over a little fire. A ladle stirs it by itself, the broth takes the colour of what's cooking, and what went in goes round and round with it
      const potIron = paint(0x3d3f44), rim = paint(0x55585e);
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2, l = box(g, 0.08, 1.05, 0.08, potIron, Math.cos(a) * 0.62, 0.48, Math.sin(a) * 0.62); l.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22); }
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58), potIron); body.material.side = THREE.DoubleSide; body.position.y = 0.92; body.castShadow = true; g.add(body);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 5, 16), rim); lip.rotation.x = Math.PI / 2; lip.position.y = 1.07; g.add(lip); for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 5, 10), rim); h.position.set(s * 0.66, 1.05, 0); h.rotation.y = Math.PI / 2; g.add(h); }
      for (const [x, z, ry] of [[0.18, 0.05, 0.4], [-0.15, -0.08, 1.9], [0.02, 0.2, 3.1]]) { const l = cyl(g, 0.06, 0.5, wood, x, 0.08, z, 6); l.rotation.set(Math.PI / 2, 0, ry); }
      const coals = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: 0xff7a2a })); coals.position.y = 0.16; coals.userData.glow = null; g.add(coals);
      const broth = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), new THREE.MeshStandardMaterial({ color: 0x8a7a62, roughness: 0.35, flatShading: true })); broth.rotation.x = -Math.PI / 2; broth.position.y = 0.98; broth.userData.glow = null; g.add(broth);
      const ladle = new THREE.Group(); ladle.userData.glow = null; g.add(ladle);
      const stick = cyl(ladle, 0.025, 1.1, wood, 0, 0.55, 0, 6); stick.userData.glow = null;
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), rim); cup.material.side = THREE.DoubleSide; cup.userData.glow = null; ladle.add(cup);
      const bits = new THREE.Group(); bits.userData.glow = null; g.add(bits);
      const steam = emitter(g, [0, 1.25, 0], { n: 14, colors: [0xf6f4ef, 0xe6e2da], up: 0.7, spread: 0.6, life: 1.8, size: 0.16, grow: 2.4, drift: 0.2 });
      const flick = emitter(g, [0, 0.2, 0], { n: 16, colors: [0xffd25e, 0xff8a3a], up: 0.5, spread: 0.3, life: 0.5, size: 0.12, grow: 0.4, drift: 0.1, glow: true });
      const DISH = { soup: 0xd8892e, dish: 0xc4472e, gourmet: 0xe2b84a }, want = new THREE.Color(), now = new THREE.Color(0x8a7a62);
      let o = 0, spin = 0, made = "", step = stepper();
      g.userData.run = (t, on, job) => {
        const dt = step(t); o = rest(o, on ? 1 : 0);
        const what = job?.out || (on ? "soup" : "");
        if (what !== made) {                               // something new in the pot: its ingredients, a few pieces of each
          made = what; bits.clear();
          const list = Object.entries(job?.in || (on ? { carrot: 2, turnip: 1, lettuce: 1 } : {}));
          list.forEach(([id, n], j) => { for (let i = 0; i < Math.min(4, n * 2); i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06 + (i % 2) * 0.02, 0), paint(GOOD[id.replace(/_gold$/, "")] ?? (/sauce/.test(id) ? 0xc8342e : /bread|flour/.test(id) ? 0xc98f4a : /smoked|fillet/.test(id) ? 0xd9a074 : 0xb8a070))); m.userData.r = 0.12 + ((i * 7 + j * 3) % 5) * 0.08; m.userData.a = (i + j * 1.7) * 1.3; bits.add(m); } });
        }
        want.set(DISH[made] ?? 0x8a7a62); now.lerp(want, Math.min(1, dt * 1.5)); broth.material.color.copy(now);
        broth.position.y = 0.98 + Math.sin(t * 2) * 0.006;
        spin += dt * (0.4 + o * 2.4);
        // the ladle: upright in the pot, its foot going round the inside, bobbing a little, as if a hand were on it
        const r = 0.28 * o + 0.05;
        ladle.position.set(Math.cos(spin) * r, 0.93 + Math.sin(t * 3) * 0.03 * o + (1 - o) * 0.06, Math.sin(spin) * r);
        ladle.rotation.set(Math.sin(spin) * 0.35 * o + 0.15, 0, -Math.cos(spin) * 0.35 * o + 0.1);
        for (const m of bits.children) { const a = m.userData.a + spin * (0.8 + m.userData.r); m.position.set(Math.cos(a) * m.userData.r, 1.0 + Math.sin(t * 4 + m.userData.a) * 0.025, Math.sin(a) * m.userData.r); m.rotation.y = a; m.visible = o > 0.05; }
        steam.tick(dt, 0.15 + o * 0.85); flick.tick(dt, 0.3 + o * 0.7);
      };
    },
    bench() { box(g, 2, 0.1, 0.6, wood, 0, 0.55); box(g, 2, 0.5, 0.08, wood, 0, 0.95, -0.28); for (const s of [-1, 1]) box(g, 0.1, 0.55, 0.5, dark, s * 0.86, 0.27); },
    lamp() { cyl(g, 0.08, 3, dark, 0, 1.5, 0, 6); g.add(lampLight(0.3, 3.1)); const c = CONE(0.36, 0.26, dark, 6); c.position.y = 3.5; g.add(c); },
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
  return bake(g);
}

/** a small heap of something for sale: logs are logs, berries are berries, and all of it about the size of a hand */
const GOOD = { carrot: 0xe8862e, lettuce: 0x7fbf5a, tomato: 0xd8432e, corn: 0xf0cf4a, pumpkin: 0xe88a2e, turnip: 0xe6d8ee, wheat: 0xe6c86a, apple: 0xd8432e, pepper: 0xc8342e, wildcap: 0xd9c0a0, mushroom: 0xd9c0a0, egg: 0xf7efdd, wool: 0xf4f0e6, herb: 0x6fae5a, fiber: 0x9fbf6a, cheese: 0xf0cf6a, bread: 0xc98f4a, pearl: 0xf4f4f4, sandstone: 0xe0b878, crystal: 0xa8e0f0, cinder: 0xd8562e };
export function makeGoods(id, item = {}) {
  const g = new THREE.Group(), lumpy = (r, c, x, y, z, sy = 1, d = 1) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, d), paint(c)); m.scale.y = sy; m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  if (id === "wood" || id === "plank") { for (const [x, y, z] of [[-0.09, 0.05, 0], [0.09, 0.05, 0], [0, 0.14, 0]]) { const l = cyl(g, 0.055, 0.34, paint(0x9a6a3c), x, y, z, 7); l.rotation.x = Math.PI / 2; const e = cyl(g, 0.045, 0.345, paint(0xd9b27a), x, y, z, 7); e.rotation.x = Math.PI / 2; } }
  else if (/berry/.test(id)) { for (const [x, y, z] of [[0, 0.05, 0], [0.07, 0.05, 0.03], [-0.06, 0.05, 0.04], [0.02, 0.05, -0.07], [-0.05, 0.05, -0.05], [0.01, 0.11, 0]]) lumpy(0.045, 0x8e2f6a, x, y, z, 1, 0); }
  else if (item.fish || id === "fillet" || id === "smoked") { for (const s of [-0.07, 0.07]) { const f = lumpy(0.07, s < 0 ? 0x6fa6d8 : 0x8fb6d8, s, 0.05, 0, 0.5, 0); f.scale.z = 2.2; } }
  else if (id === "stone" || id === "ore" || id === "brick") { for (const [x, z, y] of [[-0.08, 0, 0.05], [0.08, 0.03, 0.05], [0, -0.05, 0.12]]) lumpy(0.075, id === "ore" ? 0x8a7a70 : 0xa8a49a, x, y, z, 0.8, 0); }
  else if (item.made && !GOOD[id]) { for (const x of [-0.08, 0.08]) { cyl(g, 0.055, 0.15, paint(id === "juice" ? 0xe0a34a : 0xd8634a), x, 0.08, 0, 8); cyl(g, 0.058, 0.03, paint(0xf0e3c0), x, 0.17, 0, 8); } }
  else { const c = GOOD[id.replace(/_gold$/, "")] ?? 0xc9a86a; for (const [x, y, z] of [[-0.07, 0.06, 0], [0.07, 0.06, 0.02], [0, 0.06, -0.08], [0, 0.14, 0]]) lumpy(0.065, c, x, y, z, 1, 0); }
  return g;
}

/** a tool in the hand: the fist at the origin, the shaft along +y, the working end facing +z */
export function makeTool(id) {
  const g = new THREE.Group(), wood = paint(0x9a6a3c), grip = paint(0x5c3a22), iron = paint(0x9aa0a8), edge = paint(0xd6dade), blue = paint(0x5aa9d6), blue2 = paint(0x3f7fae);
  if (id === "can") {
    cyl(g, 0.15, 0.3, blue, 0, 0.0, 0.2, 9, 0.13); cyl(g, 0.155, 0.03, blue2, 0, 0.12, 0.2, 9); cyl(g, 0.155, 0.03, blue2, 0, -0.12, 0.2, 9);
    const s = cyl(g, 0.035, 0.42, blue2, 0, 0.1, 0.5, 6, 0.02); s.rotation.x = 1; const r = cyl(g, 0.03, 0.05, blue, 0, 0.21, 0.66, 8, 0.08); r.rotation.x = 1;
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.014, 5, 10, Math.PI), blue2); h.rotation.y = Math.PI / 2; h.position.set(0, 0.15, 0.2); g.add(h);
    return g;
  }
  if (["hoe", "axe", "pick"].includes(id)) {
    cyl(g, 0.034, 1.25, wood, 0, 0.36, 0, 6, 0.028); cyl(g, 0.04, 0.22, grip, 0, 0, 0, 6);          // the shaft, and a binding where the hand holds it
    cyl(g, 0.044, 0.1, iron, 0, 0.93, 0, 6);
  }
  if (id === "hoe") { box(g, 0.05, 0.05, 0.2, iron, 0, 0.98, 0.09); const b = slab(g, [[-0.09, 0], [0.09, 0], [0.12, -0.22], [-0.12, -0.22]], 0.03, iron, 0, 0.98, 0.2); slab(g, [[-0.12, -0.17], [0.12, -0.17], [0.12, -0.22], [-0.12, -0.22]], 0.034, edge, 0, 0.98, 0.2); void b; }
  if (id === "axe") { const o = [[0, 0.08], [0.14, 0.09], [0.32, 0.22], [0.34, -0.2], [0.14, -0.08], [0, -0.08]], a = slab(g, o, 0.06, iron, 0, 0.9, 0, -Math.PI / 2), e = slab(g, [[0.29, 0.19], [0.34, 0.22], [0.36, -0.2], [0.3, -0.16]], 0.03, edge, 0, 0.9, 0, -Math.PI / 2); box(g, 0.07, 0.14, 0.1, iron, 0, 0.9, -0.06); void a; void e; }
  if (id === "pick") { const o = [[-0.46, -0.1], [-0.2, 0.03], [0, 0.07], [0.2, 0.03], [0.46, -0.1], [0.2, -0.03], [0, -0.04], [-0.2, -0.03]]; slab(g, o, 0.06, iron, 0, 0.96, 0, -Math.PI / 2); cyl(g, 0.05, 0.14, dark0(), 0, 0.96, 0, 6); }
  return g;
}
const dark0 = () => paint(0x6d4a28);

/** a hen, in the same flat facets as the farm pack's animals: round body, tail up, red comb, orange legs. About 45 cm tall.
 *  move(dt, t, walking, pecking): legs in step, the head bobbing back and forth as hens do, a peck at the ground, now and then a flap */
export function makeChicken(color = 0xf6f1e6) {
  const holder = new THREE.Group(), body = new THREE.Group(), feather = paint(color), dark = paint(new THREE.Color(color).multiplyScalar(0.82).getHex()), red = paint(0xd8392e), orange = paint(0xf0a030), eye = paint(0x1b1d22);
  holder.add(body); body.position.y = 0.2;
  const trunk = lump(0.15, 0.13, 0.19, feather, 1); body.add(trunk);
  const tail = lump(0.07, 0.12, 0.08, dark, 0); tail.position.set(0, 0.1, -0.16); tail.rotation.x = -0.5; body.add(tail);
  const neck = new THREE.Group(); neck.position.set(0, 0.06, 0.12); body.add(neck);
  const throat = lump(0.065, 0.1, 0.07, feather, 1); throat.position.set(0, 0.04, 0.01); throat.rotation.x = 0.3; neck.add(throat);     // the neck, joining head to body
  const head = lump(0.075, 0.08, 0.08, feather, 1); head.position.set(0, 0.12, 0.03); neck.add(head);
  const beak = CONE(0.025, 0.06, orange, 4); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.11, 0.12); neck.add(beak);
  for (const [z, y, r] of [[0.0, 0.2, 0.03], [0.035, 0.205, 0.028], [-0.03, 0.19, 0.025]]) { const c = lump(0.012, r, r, red, 0); c.position.set(0, y, z + 0.03); neck.add(c); }
  const wattle = lump(0.015, 0.025, 0.018, red, 0); wattle.position.set(0, 0.07, 0.1); neck.add(wattle);
  for (const s of [-1, 1]) { const e = lump(0.012, 0.012, 0.012, eye, 0); e.position.set(s * 0.06, 0.135, 0.07); neck.add(e); }
  const wings = [-1, 1].map((s) => { const p = new THREE.Group(); p.position.set(s * 0.13, 0.04, 0); body.add(p); const w = lump(0.03, 0.09, 0.14, dark, 0); w.position.set(s * 0.01, -0.02, -0.02); p.add(w); return { p, s }; });
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group(); hip.position.set(s * 0.06, -0.08, 0.01); body.add(hip);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 5), orange); shin.position.y = -0.065; hip.add(shin);
    for (const a of [-0.5, 0, 0.5]) { const toe = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.008, 0.06), orange); toe.position.set(Math.sin(a) * 0.025, -0.128, Math.cos(a) * 0.025); toe.rotation.y = a; hip.add(toe); }
    return { hip, s };
  });
  holder.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  let step = 0, amt = 0, peck = 0, flap = 0, nextFlap = 4 + Math.random() * 10;
  return {
    holder,
    move(dt, t, walking, pecking) {
      amt += ((walking ? 1 : 0) - amt) * Math.min(1, dt * 8);
      step += dt * 13 * amt;
      for (const l of legs) l.hip.rotation.x = Math.sin(step + (l.s > 0 ? 0 : Math.PI)) * 0.55 * amt;
      body.position.y = 0.2 + Math.abs(Math.sin(step)) * 0.015 * amt;
      body.rotation.z = Math.sin(step) * 0.05 * amt;
      peck += ((pecking ? 1 : 0) - peck) * Math.min(1, dt * 6);
      const jab = pecking ? Math.max(0, Math.sin(t * 9)) : 0;
      neck.position.z = 0.13 + Math.sin(step * 2) * 0.03 * amt;                   // the head stays still while the body walks under it
      neck.rotation.x = peck * (0.9 + jab * 0.5);
      body.rotation.x = peck * 0.35;
      if (t > nextFlap) { flap = 0.6; nextFlap = t + 6 + Math.random() * 14; }
      flap = Math.max(0, flap - dt);
      for (const w of wings) w.p.rotation.z = w.s * (flap > 0 ? 0.3 + Math.abs(Math.sin(t * 30)) * 0.9 : 0.05);
    },
  };
}

/** a fountain model's basins, filled: where a ray coming straight down lands inside each basin, a still pool a hand above it */
export function fillFountain(o) {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o), c = box.getCenter(new THREE.Vector3()), R = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2, ray = new THREE.Raycaster(), water = new THREE.MeshStandardMaterial({ color: 0x59cfe0, roughness: 0.15, transparent: true, opacity: 0.82 }), seen = [];
  const inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), ws = o.getWorldScale(new THREE.Vector3()).y || 1;
  for (const f of [0.82, 0.62, 0.42, 0.26]) {
    ray.set(new THREE.Vector3(c.x + R * f, box.max.y + 1, c.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(o, true).find((h) => h.object.isMesh && h.face && h.face.normal.y > 0.5);
    if (!hit || hit.point.y > box.max.y - 0.2 || seen.some((y) => Math.abs(y - hit.point.y) < R * 0.08)) continue;
    seen.push(hit.point.y);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(R * f * 1.04, 28), water); pool.rotation.x = -Math.PI / 2;
    const p = new THREE.Vector3(c.x, hit.point.y + R * 0.05, c.z).applyMatrix4(inv); pool.position.copy(p); pool.scale.setScalar(1 / ws);
    o.add(pool);
  }
  return seen.length;
}

/** a small sailing boat for the horizon */
export function makeBoat(scale = 1) {
  const g = new THREE.Group(), wood = paint(0xa8743e), sail = paint(0xfbf3dc);
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 0.7, 1, 6), wood); hull.scale.set(1, 1, 3); hull.position.y = 0.3; hull.castShadow = true; g.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 5), wood); mast.position.y = 3.4; g.add(mast);
  const cloth = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 6, 0.1), new THREE.Vector3(0, 1.3, 0.1), new THREE.Vector3(0, 1.3, -2.8)]), sail.clone());
  cloth.geometry.computeVertexNormals(); cloth.material.side = THREE.DoubleSide; g.add(cloth);
  g.scale.setScalar(scale);
  return g;
}
