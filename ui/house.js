// house.js - the rest of the house around the main room: extra rooms beside it, on the left and on the right.
// Saved in the room layout as shell.house = { rooms: [{ side: "left" | "right", w, d }] }.
import * as THREE from "three";

const H = 3.2, W = 5, BACK = -4, FRONT = 4.5;             // the main room (the same numbers as cozyroom.js)
const DOOR_W = 1.2, DOOR_H = 2.25, INSET = 0.55;
export const MAX_ROOMS = 4;
const MAIN = { minX: -W, maxX: W, minZ: BACK, maxZ: FRONT, main: true };
const MAIN_WALK = { minX: -4.3, maxX: 4.3, minZ: -3.5, maxZ: 3.8 };    // where she can stand in the main room

const num = (v, lo, hi, d) => { const n = Number(v); return v === null || v === "" || !Number.isFinite(n) ? d : Math.min(hi, Math.max(lo, n)); };
const r2 = (v) => Math.round(v * 100) / 100;

/** Any saved (or half-typed) house settings -> a complete, safe set. */
export function normalizeHouse(h) {
  const rooms = (Array.isArray(h?.rooms) ? h.rooms : []).slice(0, MAX_ROOMS)
    .map((r) => ({ side: r?.side === "right" ? "right" : "left", w: r2(num(r?.w, 3, 8, 5)), d: r2(num(r?.d, 3, FRONT - BACK, 6)) }));
  return { rooms };
}

function rectShape(r) {                                   // a floor outline (shape y = -z, see _floorMesh)
  const s = new THREE.Shape();
  s.moveTo(r.minX, -r.maxZ); s.lineTo(r.maxX, -r.maxZ); s.lineTo(r.maxX, -r.minZ); s.lineTo(r.minX, -r.minZ); s.closePath();
  return s;
}

export class House {
  /** mats: { wall, ceiling } - the main room's own materials, so the whole house follows its wall colour */
  constructor(scene, mats) {
    this.mats = mats;
    this.group = new THREE.Group();
    this.group.name = "house";
    scene.add(this.group);
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
    this.cut = false;
    this._own = [];
    this.set(null);
  }

  set(cfg) { this.cfg = normalizeHouse(cfg); this._build(); return this.cfg; }
  hasRoom(side) { return this.cfg.rooms.some((r) => r.side === side); }

  /** The main room and the extra rooms as rectangles. Extra rooms line up with the back wall. */
  rects() {
    const out = [MAIN], edge = { left: -W, right: W };
    for (const r of this.cfg.rooms) {
      const x0 = edge[r.side], x1 = r.side === "left" ? x0 - r.w : x0 + r.w;
      out.push({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: BACK, maxZ: BACK + r.d, side: r.side });
      edge[r.side] = x1;
    }
    return out;
  }

  bounds() {
    const R = this.rects();
    return { minX: Math.min(...R.map((r) => r.minX)), maxX: Math.max(...R.map((r) => r.maxX)), minZ: BACK, maxZ: FRONT };
  }

  /** Doorways between neighbouring rooms: the wall's x, how far the wall runs (z0..z1) and the door's middle (zc). */
  doors() {
    const out = [], prev = { left: MAIN, right: MAIN };
    for (const r of this.rects().slice(1)) {
      const a = prev[r.side];
      out.push({ x: r.side === "left" ? r.maxX : r.minX, side: r.side, z0: BACK, z1: Math.max(a.maxZ, r.maxZ),
                 zc: BACK + (Math.min(a.maxZ, r.maxZ) - BACK) / 2, first: !!a.main });
      prev[r.side] = r;
    }
    return out;
  }

  walkBounds() {
    const b = this.bounds();
    return { minX: b.minX + INSET, maxX: b.maxX - INSET, minZ: MAIN_WALK.minZ, maxZ: MAIN_WALK.maxZ };
  }

  /** Can she stand here? Inside a room (not too close to a wall) or in a doorway. */
  walkable(x, z, mainOnly = false) {
    const inRect = (b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
    if (mainOnly) return inRect(MAIN_WALK);
    if (inRect(MAIN_WALK)) return true;
    for (const r of this.rects().slice(1)) if (inRect({ minX: r.minX + INSET, maxX: r.maxX - INSET, minZ: MAIN_WALK.minZ, maxZ: r.maxZ - 0.7 })) return true;
    for (const d of this.doors()) if (Math.abs(x - d.x) < INSET + 0.75 && Math.abs(z - d.zc) < DOOR_W / 2 - 0.25) return true;
    return false;
  }

  /** The nearest point inside one of the rooms, m away from the walls (for furniture). */
  clampPoint(x, z, m = 0.2, mainOnly = false) {
    let best = null;
    for (const r of mainOnly ? [MAIN] : this.rects()) {
      const px = Math.min(r.maxX - m, Math.max(r.minX + m, x)), pz = Math.min(r.maxZ - m, Math.max(r.minZ + m, z));
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (!best || d < best.d) best = { x: px, z: pz, d };
    }
    return best;
  }

  /** Edit room: the near walls and the ceilings are cut away. */
  setCut(cut) { this.cut = !!cut; for (const m of this.cuts) m.visible = !this.cut; }

  /** The extra rooms use the main room's floor pattern (their floors measure in metres). */
  syncFloor(src) {
    const m = this.floorMat;
    m.map?.dispose();
    m.map = src.map ? src.map.clone() : null;
    if (m.map) { m.map.repeat.set(src.map.repeat.x / 10, src.map.repeat.y / 10); m.map.needsUpdate = true; }
    m.color.copy(src.color); m.roughness = src.roughness; m.needsUpdate = true;
  }

  // ---------------- building it ----------------
  _mat(o) { const m = new THREE.MeshStandardMaterial(o); this._own.push(m); return m; }

  _build() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((m) => m.geometry?.dispose()); }
    for (const m of this._own) m.dispose();
    this._own = []; this.cuts = [];
    const rects = this.rects(), doors = this.doors(), g = this.group;
    const trim = this._mat({ color: 0x4a3426, roughness: 0.8 });
    const outer = {};
    for (const r of rects.slice(1)) outer[r.side] = r;
    const add = (m, cut = false) => { if (!m) return; if (cut) this.cuts.push(m); g.add(m); };
    for (const r of rects.slice(1)) g.add(this._floorMesh(rectShape(r), 0.002));   // the main room's floor is cozyroom.js's
    // walls (the near right-hand ones are cut away in Edit room, like the main room's right wall)
    const wallZ = (x, z0, z1, n, door, both, cut) => {
      for (const k of both ? [n, -n] : [n]) {
        if (door == null) add(this._sideWall(x, z0, z1, 0, H, k), cut);
        else {
          add(this._sideWall(x, z0, door - DOOR_W / 2, 0, H, k), cut);
          add(this._sideWall(x, door + DOOR_W / 2, z1, 0, H, k), cut);
          add(this._sideWall(x, door - DOOR_W / 2, door + DOOR_W / 2, DOOR_H, H, k), cut);
        }
      }
      if (door != null) {                                                  // a wooden door frame
        for (const s of [-1, 1]) add(this._box(0.16, DOOR_H, 0.08, trim, x, DOOR_H / 2, door + s * (DOOR_W / 2 + 0.04)), cut);
        add(this._box(0.16, 0.08, DOOR_W + 0.16, trim, x, DOOR_H + 0.04, door), cut);
      }
    };
    for (const sd of ["left", "right"]) {
      const d = doors.find((o) => o.first && o.side === sd);
      if (d) wallZ(sd === "left" ? -W : W, BACK, FRONT, sd === "left" ? 1 : -1, d.zc, true, sd === "right");
    }
    for (const d of doors.filter((o) => !o.first)) wallZ(d.x, d.z0, d.z1, 1, d.zc, true, d.side === "right");
    for (const r of rects.slice(1)) add(this._backWall(r.minX, r.maxX));
    if (outer.left) wallZ(outer.left.minX, BACK, outer.left.maxZ, 1, null, false, false);
    if (outer.right) wallZ(outer.right.maxX, BACK, outer.right.maxZ, -1, null, false, true);
    for (const r of rects.slice(1)) {                                     // the extra rooms' ceilings (cozyroom.js has the main one)
      const c = new THREE.Mesh(new THREE.PlaneGeometry(r.maxX - r.minX, r.maxZ - r.minZ), this.mats.ceiling);
      c.rotation.x = Math.PI / 2; c.position.set((r.minX + r.maxX) / 2, H, (r.minZ + r.maxZ) / 2);
      add(c, true);
    }
    this.setCut(this.cut);
  }

  _floorMesh(shape, y) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.floorMat);
    m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true;    // shape (x, y) -> world (x, -z)
    m.userData.floor = true;
    return m;
  }

  _box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
    return m;
  }

  /** One piece of a wall that runs front-to-back at x, facing +x (n = 1) or -x (n = -1). */
  _sideWall(x, za, zb, ya, yb, n) {
    const len = zb - za, h = yb - ya;
    if (len < 0.01 || h < 0.01) return null;
    const geo = new THREE.PlaneGeometry(len, h), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (za - BACK + uv.getX(i) * len) / 10, (ya + uv.getY(i) * h) / H);   // wallpaper keeps its size
    const m = new THREE.Mesh(geo, this.mats.wall);
    m.position.set(x + n * 0.004, (ya + yb) / 2, (za + zb) / 2);
    m.rotation.y = n > 0 ? Math.PI / 2 : -Math.PI / 2;
    m.receiveShadow = true;
    return m;
  }

  _backWall(xa, xb) {
    const len = xb - xa, geo = new THREE.PlaneGeometry(len, H), uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (xa + W + uv.getX(i) * len) / 10, uv.getY(i));
    const m = new THREE.Mesh(geo, this.mats.wall);
    m.position.set((xa + xb) / 2, H / 2, BACK); m.receiveShadow = true;
    return m;
  }
}
