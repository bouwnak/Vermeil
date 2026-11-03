// wheels.js - finds the wheels of any vehicle model and makes them roll, whatever the pack called its parts.
// A model is split into the pieces its mesh is really made of (parts that share no points). Round, flat pieces low down are wheels; pieces that sit
// inside a wheel (its spokes, hub, rim, tyre) are gathered onto it; each wheel then turns about its own middle, on its own axle.
import * as THREE from "three";

const KEY = (x, y, z) => `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`;

/** a geometry's triangles, split into the pieces that share no points. -> [[triangle index...]] */
function islands(geo) {
  const pos = geo.attributes.position, idx = geo.index, n = idx ? idx.count / 3 : pos.count / 3, up = new Int32Array(pos.count).map((_, i) => i), weld = new Map();
  const find = (a) => { while (up[a] !== a) { up[a] = up[up[a]]; a = up[a]; } return a; }, join = (a, b) => { a = find(a); b = find(b); if (a !== b) up[a] = b; };
  for (let i = 0; i < pos.count; i++) { const k = KEY(pos.getX(i), pos.getY(i), pos.getZ(i)); if (weld.has(k)) join(i, weld.get(k)); else weld.set(k, i); }
  const v = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < n; t++) { join(v(t, 0), v(t, 1)); join(v(t, 1), v(t, 2)); }
  const groups = new Map();
  for (let t = 0; t < n; t++) { const r = find(v(t, 0)); (groups.get(r) || groups.set(r, []).get(r)).push(t); }
  return [...groups.values()];
}

/** the chosen triangles of a geometry as a geometry of their own, moved by m */
function take(geo, tris, m) {
  const out = new THREE.BufferGeometry(), idx = geo.index;
  for (const [name, a] of Object.entries(geo.attributes)) {
    const arr = new Float32Array(tris.length * 3 * a.itemSize);
    tris.forEach((t, j) => { for (let k = 0; k < 3; k++) { const i = idx ? idx.getX(t * 3 + k) : t * 3 + k; for (let c = 0; c < a.itemSize; c++) arr[(j * 3 + k) * a.itemSize + c] = a.getComponent(i, c); } });
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  if (geo.groups.length > 1) {                       // several materials: each triangle keeps its own
    const which = (t) => geo.groups.findIndex((g) => t * 3 >= g.start && t * 3 < g.start + g.count);
    let start = 0;
    tris.forEach((t, j) => { const g = which(t); const last = out.groups[out.groups.length - 1]; if (last && last.materialIndex === geo.groups[g].materialIndex && last.start + last.count === j * 3) last.count += 3; else out.addGroup(j * 3, 3, geo.groups[g].materialIndex); start = j; });
    void start;
  }
  out.applyMatrix4(m);
  return out;
}

/** turns every wheel of `root` (a vehicle as loaded) into a turning hub. -> [{ pivot, axis, r }]; call once per vehicle */
export function rigWheels(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), all = new THREE.Box3(), pieces = [], meshes = [];
  root.traverse((m) => { if (m.isMesh && !m.isSkinnedMesh && m.geometry.attributes.position) meshes.push(m); });
  for (const m of meshes) {
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), geo = m.geometry, list = geo.attributes.position.count < 80000 ? islands(geo) : [null];
    for (const tris of list) {
      const g = tris ? take(geo, tris, rel) : geo.clone().applyMatrix4(rel);
      g.computeBoundingBox();
      pieces.push({ mesh: m, geo: g, box: g.boundingBox.clone(), named: /^wheel/i.test(m.name) });
      all.union(g.boundingBox);
    }
  }
  const H = all.max.y - all.min.y, L = Math.max(all.max.x - all.min.x, all.max.z - all.min.z);
  // round and flat, its middle in the lower half, big enough to be a wheel and not a bolt
  const round = (p) => {
    const s = p.box.getSize(new THREE.Vector3()), d = [["x", s.x], ["y", s.y], ["z", s.z]].sort((a, b) => a[1] - b[1]), [thin, a, b] = d;
    if (thin[0] === "y") return null;                                                  // lying flat: a lid, a plate
    const c = p.box.getCenter(new THREE.Vector3());
    return b[1] / Math.max(a[1], 1e-6) < 1.2 && thin[1] < a[1] * 0.75 && c.y < all.min.y + H * 0.55 && a[1] > L * 0.06 && c.y - a[1] / 2 < all.min.y + H * 0.12 ? { axis: thin[0], r: (a[1] + b[1]) / 4, c } : null;
  };
  const hubs = [];
  for (const p of pieces) {
    const w = round(p);
    if (!w) continue;
    const same = hubs.find((h) => h.axis === w.axis && Math.hypot(...["x", "y", "z"].filter((k) => k !== w.axis).map((k) => h.c[k] - w.c[k])) < Math.min(h.r, w.r) * 0.3 && Math.abs(h.c[w.axis] - w.c[w.axis]) < Math.max(h.r, w.r));
    if (same) { same.parts.push(p); if (w.r > same.r) { same.r = w.r; same.c.copy(w.c); } } else hubs.push({ ...w, c: w.c.clone(), parts: [p] });
  }
  if (!hubs.length) return [];
  // what sits inside a wheel turns with it: spokes, hub caps, the rim (never the body around it)
  for (const p of pieces) {
    if (hubs.some((h) => h.parts.includes(p))) continue;
    const c = p.box.getCenter(new THREE.Vector3()), s = p.box.getSize(new THREE.Vector3());
    const h = hubs.find((x) => { const plane = ["x", "y", "z"].filter((k) => k !== x.axis); return Math.hypot(...plane.map((k) => x.c[k] - c[k])) < x.r * 0.7 && Math.abs(x.c[x.axis] - c[x.axis]) < x.r * 0.6 && plane.every((k) => s[k] <= x.r * 2.1); });
    if (h) h.parts.push(p);
  }
  // the pieces are rebuilt: the wheels on their pivots, everything else stays as it was in its own mesh
  const moved = new Map();
  for (const h of hubs) for (const p of h.parts) (moved.get(p.mesh) || moved.set(p.mesh, new Set()).get(p.mesh)).add(p);
  for (const [m, gone] of moved) {
    const keep = pieces.filter((p) => p.mesh === m && !gone.has(p));
    if (keep.length) {
      const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), back = rel.clone().invert();
      const merged = mergeAll(keep.map((p) => p.geo.clone().applyMatrix4(back)));
      if (merged) m.geometry = merged; else m.visible = false;
    } else m.visible = false;
  }
  const out = [];
  for (const h of hubs) {
    const pivot = new THREE.Group();
    pivot.position.copy(h.c); root.add(pivot);
    for (const p of h.parts) {
      const g = p.geo.translate(-h.c.x, -h.c.y, -h.c.z), mm = new THREE.Mesh(g, p.mesh.material);
      mm.castShadow = mm.receiveShadow = true; pivot.add(mm);
    }
    out.push({ pivot, axis: h.axis, r: Math.max(h.r * root.getWorldScale(new THREE.Vector3()).y, 0.05) });
  }
  return out;
}

function mergeAll(list) {
  if (!list.length) return null;
  const names = Object.keys(list[0].attributes).filter((n) => list.every((g) => g.attributes[n]));
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = list[0].attributes[n].itemSize, arr = new Float32Array(list.reduce((s, g) => s + g.attributes[n].count * size, 0));
    let o = 0;
    for (const g of list) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  let start = 0;
  for (const g of list) { const n = g.attributes.position.count; if (g.groups.length) for (const gr of g.groups) out.addGroup(start + gr.start, gr.count, gr.materialIndex); else if (list.some((x) => x.groups.length)) out.addGroup(start, n, 0); start += n; }
  return out;
}

/** they roll as far as the vehicle has gone: a small wheel turns faster than a big one */
export function rollWheels(hubs, dist) { for (const h of hubs) h.pivot.rotation[h.axis] += (h.axis === "z" ? -1 : 1) * dist / h.r; }      // forward is +z: an axle across x turns one way, one along z the other
