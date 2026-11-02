// terrain.js - a turtle: the land on its shell, and the animal under it. Any entry of ISLANDS in data.js becomes one.
import * as THREE from "three";

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function value(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), f = x - xi, g = z - zi, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g);
  return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
}
export const fbm = (x, z) => value(x, z) * 0.55 + value(x * 2.1, z * 2.1) * 0.3 + value(x * 4.3, z * 4.3) * 0.15;
const STEP = 6.5;                                         // the height of one level of land

const segDist = (x, z, r) => {                             // how far a point is from a road, and how far along it
  const [ax, az] = r.from, [bx, bz] = r.to, vx = bx - ax, vz = bz - az, u = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
  return [Math.hypot(x - ax - vx * u, z - az - vz * u), u];
};

export class Land {
  constructor(cfg) { this.cfg = cfg; }

  /** the shape of the land at a point in this turtle's own space; below 0 is under the sea */
  height(x, z) {
    const { a, b, seed, peaks, flats, roads = [] } = this.cfg;
    const wobble = (fbm(x * 0.012 + seed, z * 0.012 - seed) - 0.5) * 0.2;
    const r = Math.hypot(x / a, z / b) + wobble, edge = 1 - r;
    let y = 0;
    if (edge < 0) y = Math.max(-14, edge * 46);
    else {
      const raw = 3.2 + smooth(0.04, 0.62, edge) * (6 + fbm(x * 0.02 + seed, z * 0.02) * 15);
      const q = raw / STEP, f = q - Math.floor(q);
      let land = (Math.floor(q) + smooth(0.38, 0.62, f)) * STEP;    // levels with cliffs between them, not one smooth hill
      for (const [px, pz, h, w] of peaks) land += h * Math.exp(-((x - px) ** 2 + (z - pz) ** 2) / (w * w)) * (0.8 + fbm(x * 0.05, z * 0.05) * 0.4);
      for (const fl of flats) {
        if (fl.pier) continue;
        const d = Math.hypot(x - fl.x, z - fl.z) + (fbm(x * 0.06 + seed, z * 0.06) - 0.5) * fl.r * 0.16;
        land = fl.wall ? lerp(fl.h, land, smooth(fl.r * 0.97, fl.r * 1.06, d)) : lerp(fl.h, land, smooth(fl.r * 0.78, fl.r * 1.14, d));
      }
      for (const road of roads) {
        const [d, u] = segDist(x, z, road);
        if (d < road.w * 1.5) land = lerp(lerp(road.from[2], road.to[2], u), land, smooth(road.w * 0.75, road.w * 1.5, d));
      }
      y = lerp(edge * 46, land, smooth(0.015, 0.1, edge));
    }
    for (const fl of flats) if (fl.pier) y = lerp(fl.h, y, smooth(fl.r * 0.75, fl.r * 1.05, Math.hypot(x - fl.x, z - fl.z)));     // a headland: reaches past the shore
    for (const road of roads) if (road.pier) { const [d, u] = segDist(x, z, road); if (d < road.w * 1.5) y = lerp(lerp(road.from[2], road.to[2], u), y, smooth(road.w * 0.75, road.w * 1.5, d)); }
    return y;
  }

  /** the ground you actually see: the faceted mesh itself, so nothing floats or sinks into it */
  ground(x, z) {
    const g = this.grid;
    if (!g) return this.height(x, z);
    const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((z - g.z0) / g.cell);
    if (i < 1 || j < 1 || i > g.nx - 3 || j > g.nz - 3) return -14;
    const n = g.nx, { jx, jz, hh } = g;
    for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) {
      const A = a + b * n, B = a + 1 + b * n, C = a + 1 + (b + 1) * n, D = a + (b + 1) * n;
      for (const [p, q, r] of [[A, D, B], [B, D, C]]) {
        const d = (jz[q] - jz[r]) * (jx[p] - jx[r]) + (jx[r] - jx[q]) * (jz[p] - jz[r]);
        const u = ((jz[q] - jz[r]) * (x - jx[r]) + (jx[r] - jx[q]) * (z - jz[r])) / d, v = ((jz[r] - jz[p]) * (x - jx[r]) + (jx[p] - jx[r]) * (z - jz[r])) / d;
        if (u >= -1e-4 && v >= -1e-4 && u + v <= 1.0001) return u * hh[p] + v * hh[q] + (1 - u - v) * hh[r];
      }
    }
    return this.height(x, z);
  }

  /** how much the ground rises and falls over a square of half-size d */
  rough(x, z, d = 1) {
    let lo = 1e9, hi = -1e9;
    for (const [p, q] of [[0, 0], [d, d], [-d, d], [d, -d], [-d, -d], [d, 0], [-d, 0], [0, d], [0, -d]]) { const h = this.ground(x + p, z + q); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return hi - lo;
  }

  /** on one of the roads? */
  onRoad(x, z) { return (this.cfg.roads || []).some((r) => segDist(x, z, r)[0] < r.w); }

  colour(h, slope, x, z, out, winter) {
    const p = this.cfg.palette, c = new THREE.Color();
    const n = fbm(x * 0.08, z * 0.08);
    if (h < 3.4) c.setHex(p.sand);
    else if (slope > 0.95) c.setHex(p.high).offsetHSL(0, 0, (n - 0.5) * 0.12);
    else if (this.onRoad(x, z)) c.setHex(winter ? 0xd9d2c4 : p.path ?? 0xd8b98a).offsetHSL(0, 0, (n - 0.5) * 0.05);
    else if (h > 34) c.setHex(p.snow);
    else if (winter) c.setHex(p.snow).offsetHSL(0, 0, -n * 0.05);
    else c.setHex(h > 16 ? p.mid : p.low).offsetHSL((n - 0.5) * 0.04, 0, (n - 0.5) * 0.08);
    out.push(c.r, c.g, c.b);
  }

  /** the land as a faceted mesh; its corners are kept, so the ground under your feet is exactly what's drawn */
  mesh(cell = 3, winter = false) {
    const { a, b } = this.cfg, pos = [], col = [], x0 = -a * 1.2, z0 = -b * 1.2, nx = Math.ceil(a * 2.4 / cell) + 2, nz = Math.ceil(b * 2.4 / cell) + 2;
    const jx = new Float32Array(nx * nz), jz = new Float32Array(nx * nz), hh = new Float32Array(nx * nz);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const p = x0 + i * cell, q = z0 + j * cell, k = i + j * nx;                                     // no visible grid
      jx[k] = p + (hash(p, q) - 0.5) * cell * 0.5; jz[k] = q + (hash(q, p) - 0.5) * cell * 0.5;
      hh[k] = this.height(jx[k], jz[k]);
    }
    this.grid = { x0, z0, cell, nx, nz, jx, jz, hh };
    for (let i = 0; i < nx - 1; i++) for (let j = 0; j < nz - 1; j++) {
      if (Math.hypot((x0 + (i + 0.5) * cell) / a, (z0 + (j + 0.5) * cell) / b) > 1.22) continue;
      const A = i + j * nx, B = i + 1 + j * nx, C = i + 1 + (j + 1) * nx, D = i + (j + 1) * nx;
      for (const tri of [[A, D, B], [B, D, C]]) {
        const ys = tri.map((k) => hh[k]), top = Math.max(...ys);
        if (top < -3) continue;
        const slope = (top - Math.min(...ys)) / cell, mid = (ys[0] + ys[1] + ys[2]) / 3, face = [];
        this.colour(mid, slope, jx[tri[0]], jz[tri[0]], face, winter);
        tri.forEach((k) => { pos.push(jx[k], hh[k], jz[k]); col.push(...face); });
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

function blob(rx, ry, rz, color, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = 1 + (hash(p.getX(i) * 9, p.getY(i) * 9 + p.getZ(i) * 5) - 0.5) * 0.08;
    p.setXYZ(i, p.getX(i) * rx * n, p.getY(i) * ry * n, p.getZ(i) * rz * n);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 }));
  m.castShadow = true;
  return m;
}

/** The animal: it lives under the land, its head at +x. update(t, state) breathes, swims and looks around. */
export function makeTurtle(cfg) {
  const { a, b, deep } = cfg, g = new THREE.Group(), skin = 0x5f9e7c, belly = 0xcfd8a8;
  const shell = blob(a * 1.04, deep, b * 1.04, 0x3f7a66, 3); shell.position.y = -deep * 0.72; g.add(shell);
  const under = blob(a * 0.98, deep * 0.7, b * 0.98, belly, 2); under.position.y = -deep * 1.02; g.add(under);
  const neck = new THREE.Group(); neck.position.set(a * 0.98, -deep * 0.62, 0); g.add(neck);
  const n = blob(a * 0.2, deep * 0.3, b * 0.16, skin); n.position.x = a * 0.12; neck.add(n);
  const head = new THREE.Group(); head.position.x = a * 0.3; neck.add(head);
  const skull = blob(a * 0.15, deep * 0.32, b * 0.16, skin, 3); head.add(skull);
  for (const s of [-1, 1]) {
    const eye = blob(a * 0.03, a * 0.03, a * 0.03, 0x1f2a30, 2); eye.position.set(a * 0.06, deep * 0.12, s * b * 0.135); head.add(eye);
    const shine = blob(a * 0.01, a * 0.01, a * 0.01, 0xffffff, 1); shine.position.set(a * 0.082, deep * 0.14, s * b * 0.15); head.add(shine);
  }
  const flippers = [];
  for (const [x, z] of [[0.55, 1], [0.55, -1], [-0.6, 1], [-0.6, -1]]) {
    const pivot = new THREE.Group(); pivot.position.set(a * x, -deep * 0.72, z * b * 0.92); g.add(pivot);
    const f = blob(a * 0.26, deep * 0.1, b * 0.42, skin); f.position.z = z * b * 0.38; pivot.add(f);
    flippers.push({ pivot, side: z, front: x > 0 });
  }
  const tail = new THREE.Group(); tail.position.set(-a * 1.0, -deep * 0.7, 0); g.add(tail);
  const tip = blob(a * 0.13, deep * 0.12, b * 0.08, skin); tip.position.x = -a * 0.1; tail.add(tip);
  return { group: g, head, neck, update(t, mood = {}) {
    const swim = Math.sin(t * 0.32) * (mood.moored ? 0.35 : 1);
    flippers.forEach((f, i) => { f.pivot.rotation.x = f.side * (f.front ? swim : -swim) * 0.3; f.pivot.rotation.y = f.side * Math.cos(t * 0.32 + i) * 0.14; });
    neck.rotation.z = Math.sin(t * 0.13) * 0.05 + (mood.asleep ? -0.22 : mood.rain ? 0.14 : 0);
    head.rotation.y = mood.asleep ? 0 : Math.sin(t * 0.07) * 0.32;
    head.rotation.z = Math.sin(t * 0.11 + 1) * 0.08 + (mood.asleep ? -0.12 : mood.rain ? 0.12 : Math.max(0, Math.sin(t * 0.021)) ** 8 * Math.sin(t * 2.4) * 0.05);
    tail.rotation.y = Math.sin(t * 0.3) * 0.2;
  } };
}

/** The sea: a soft low-poly swell. Slightly see-through, so the great shape of the turtle shows under it. */
export function makeOcean() {
  const g = new THREE.PlaneGeometry(2600, 2600, 110, 110).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x53d6c6, transparent: true, opacity: 0.8, roughness: 0.35, metalness: 0.05, flatShading: true });
  const uniforms = { uT: { value: 0 } };
  mat.onBeforeCompile = (s) => {
    s.uniforms.uT = uniforms.uT;
    s.vertexShader = s.vertexShader.replace("#include <common>", "#include <common>\nuniform float uT;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(position, 1.0);
        transformed.y += sin(wp.x * .035 + uT * .9) * .42 + cos(wp.z * .05 + uT * .7) * .34 + sin((wp.x + wp.z) * .11 + uT * 1.3) * .12;`);
  };
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  m.userData.tick = (t) => { uniforms.uT.value = t; };
  return m;
}

/** the white collar of foam where the land meets the sea */
export function makeFoam(cfg, land) {
  const { a, b } = cfg, pts = [], outer = [], N = 120;
  for (let i = 0; i <= N; i++) {
    const t = (i % N) / N * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    let k = 1.3;
    while (k > 0.5 && land.height(c * a * k, s * b * k) < 0.42) k -= 0.004;
    pts.push([c * a * k, s * b * k]);
    const w = 1.012 + hash(i % N, 3) * 0.03;
    outer.push([c * a * k * w, s * b * k * w]);
  }
  const pos = [];
  for (let i = 0; i < N; i++) {
    const [p, q, r, u] = [pts[i], pts[i + 1], outer[i], outer[i + 1]];
    pos.push(p[0], 0.46, p[1], q[0], 0.46, q[1], r[0], 0.46, r[1], q[0], 0.46, q[1], u[0], 0.46, u[1], r[0], 0.46, r[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
}
