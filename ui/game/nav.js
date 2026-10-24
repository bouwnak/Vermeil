// nav.js - path finding on the location's navigation grid (made and validated by the Python layout builder).
// '.' walkable, '#' solid, '~' water. A* with diagonal moves (no corner cutting), then the path is smoothed.
export class Nav {
  constructor(rows, size, cell = 1) {
    this.n = rows.length;
    this.size = size;
    this.cell = cell;
    this.half = size / 2;
    this.g = new Uint8Array(this.n * this.n);
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) this.g[j * this.n + i] = r[i] === "." ? 0 : r[i] === "~" ? 2 : 1; });
    this.dyn = new Uint8Array(this.n * this.n);       // temporary blockers (e.g. a chest)
  }

  idx(x, z) {
    const i = Math.floor((x + this.half) / this.cell), j = Math.floor((z + this.half) / this.cell);
    return i >= 0 && j >= 0 && i < this.n && j < this.n ? j * this.n + i : -1;
  }

  center(k) { return [(k % this.n + 0.5) * this.cell - this.half, (Math.floor(k / this.n) + 0.5) * this.cell - this.half]; }

  ok(k) { return k >= 0 && this.g[k] === 0 && !this.dyn[k]; }

  walkable(x, z) { return this.ok(this.idx(x, z)); }

  nearest(x, z, maxR = 8) {
    if (this.walkable(x, z)) return [x, z];
    for (let r = 1; r <= maxR; r++)
      for (let a = 0; a < 16; a++) {
        const xx = x + Math.cos(a / 16 * Math.PI * 2) * r, zz = z + Math.sin(a / 16 * Math.PI * 2) * r;
        if (this.walkable(xx, zz)) return [xx, zz];
      }
    return null;
  }

  /** waypoints [[x,z],...] from a to b (stops `near` metres short). null if unreachable. */
  find(ax, az, bx, bz, near = 0) {
    const goalP = this.nearest(bx, bz, 6);
    if (!goalP) return null;
    let s = this.idx(ax, az);
    if (!this.ok(s)) { const p = this.nearest(ax, az, 3); if (!p) return null; s = this.idx(p[0], p[1]); }
    const t = this.idx(goalP[0], goalP[1]);
    if (s === t) return [[bx, bz]];
    const n = this.n, N = n * n;
    const gS = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const open = new Heap();
    const [tx, tz] = [t % n, Math.floor(t / n)];
    const h = (k) => { const dx = Math.abs(k % n - tx), dz = Math.abs(Math.floor(k / n) - tz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    gS[s] = 0; open.push(s, h(s));
    let found = false, iter = 0;
    while (open.size && iter++ < 20000) {
      const k = open.pop();
      if (closed[k]) continue;
      if (k === t) { found = true; break; }
      closed[k] = 1;
      const i = k % n, j = Math.floor(k / n);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const kk = jj * n + ii;
        if (!this.ok(kk) || closed[kk]) continue;
        if (di && dj && (!this.ok(j * n + ii) || !this.ok(jj * n + i))) continue;   // no corner cutting
        const g = gS[k] + (di && dj ? 1.414 : 1);
        if (g < gS[kk]) { gS[kk] = g; from[kk] = k; open.push(kk, g + h(kk)); }
      }
    }
    if (!found) return null;
    let cells = [];
    for (let k = t; k !== -1; k = from[k]) cells.push(k);
    cells.reverse();
    // string-pulling: keep only the points where the straight line would be blocked
    const pts = cells.map((k) => this.center(k));
    const out = [];
    let a = [ax, az];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.line(a[0], a[1], pts[j][0], pts[j][1])) j--;
      out.push(pts[j]);
      a = pts[j];
      i = j;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    out[out.length - 1] = this.walkable(bx, bz) ? [bx, bz] : out[out.length - 1];
    if (near > 0) {                                   // stop short (e.g. to talk to someone)
      const last = out[out.length - 1], prev = out.length > 1 ? out[out.length - 2] : [ax, az];
      const dx = last[0] - prev[0], dz = last[1] - prev[1], d = Math.hypot(dx, dz);
      if (d > near) out[out.length - 1] = [last[0] - dx / d * near, last[1] - dz / d * near];
      else if (out.length > 1) out.pop();
      else return [];
    }
    return out;
  }

  line(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), steps = Math.ceil(d / (this.cell * 0.35));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      if (!this.walkable(x, z) || !this.walkable(x + 0.3, z) || !this.walkable(x - 0.3, z) || !this.walkable(x, z + 0.3) || !this.walkable(x, z - 0.3)) return false;
    }
    return true;
  }

  randomPoint(rng = Math.random, cx = 0, cz = 0, r = 999) {
    for (let k = 0; k < 60; k++) {
      const x = cx + (rng() * 2 - 1) * Math.min(r, this.half), z = cz + (rng() * 2 - 1) * Math.min(r, this.half);
      if (this.walkable(x, z)) return [x, z];
    }
    return null;
  }
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    this.k.push(k); this.p.push(p);
    let i = this.k.length - 1;
    while (i > 0) { const q = (i - 1) >> 1; if (this.p[q] <= this.p[i]) break; this.swap(i, q); i = q; }
  }
  pop() {
    const top = this.k[0], lk = this.k.pop(), lp = this.p.pop();
    if (this.k.length) {
      this.k[0] = lk; this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.p[l] < this.p[m]) m = l;
        if (r < this.k.length && this.p[r] < this.p[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  }
  swap(a, b) { [this.k[a], this.k[b]] = [this.k[b], this.k[a]]; [this.p[a], this.p[b]] = [this.p[b], this.p[a]]; }
}
