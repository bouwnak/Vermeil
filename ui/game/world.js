// world.js - turns a validated layout from the Python builder into the 3D place:
// ground with gentle hills at the edges, dirt paths, animated water/lava, every model (instanced for speed),
// swaying plants, lamps that glow at night, exit markers, chests, the portal ring, ambient particles.
import * as THREE from "three";
import * as A from "./assets.js";
import { Nav } from "./nav.js";

const rnd = (s) => { let x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };

export class WorldScene {
  constructor(engine, vfx, audio) {
    this.engine = engine;
    this.vfx = vfx;
    this.audio = audio;
    this.scene = engine.scene;
    this.root = null;
    this.nav = null;
    this.exits = [];
    this.chests = [];
    this.lights = [];
    this.inCombat = false;
    this.mixers = [];
    this.chunks = [];
    engine.onUpdate((dt, t) => {
      for (const e of this.exits) e.beam.material.opacity = 0.1 + Math.sin(t * 2) * 0.04;
      for (const m of this.mixers) m.update(dt);
      if ((this._cf = (this._cf || 0) + 1) % 8 === 0) {               // draw distance, checked a few times a second
        const c = engine.camera.position;
        // a slow PC: once the resolution can't go lower, the draw distance shrinks too (and grows back when fast)
        const A = engine._ad, ds = (this.drawScale ||= 1);
        if (A && engine.perf !== "graphics" && engine.renderer.getPixelRatio() <= A.min + 0.01 && A.avg > A.slow) this.drawScale = Math.max(0.45, ds - 0.004);
        else if (A && A.avg < 1 / 55) this.drawScale = Math.min(1, ds + 0.004);
        const reach = this.drawScale * (engine.drawBase || 1);
        for (const k of this.chunks) k.obj.visible = Math.hypot(k.x - c.x, k.z - c.z) < k.far * reach;
      }
    });
  }

  clear() {
    if (this.root) {
      this.scene.remove(this.root);
      this.root.traverse((o) => { if (o.isMesh && o.userData.own) { o.geometry.dispose(); [].concat(o.material).forEach((m) => m.dispose()); } });
    }
    for (const l of this.lights) this.scene.remove(l);
    this.lights = [];
    for (const e of this.exits) e.label?.remove();
    this.exits = []; this.chests = []; this.mixers = []; this.chunks = [];
    this.root = null;
  }

  /** push a walker (a circle of radius r at x,z) out of any solid thing it overlaps. returns [x, z] */
  collide(x, z, r = 0.35) {
    for (const [bx, bz, br] of this.blockers || []) {
      const dx = x - bx, dz = z - bz, m = br + r;
      if (Math.abs(dx) >= m || Math.abs(dz) >= m) continue;
      const d = Math.hypot(dx, dz);
      if (d < m) { if (d < 1e-4) { x += m; continue; } x = bx + dx / d * m; z = bz + dz / d * m; }
    }
    return [x, z];
  }

  ground(x, z) {
    const h = this.half || 30;
    const d = Math.max(Math.abs(x), Math.abs(z)) - h;
    if (d <= 0) return 0;
    return Math.min(10, d * d * 0.05) * (0.7 + 0.3 * Math.sin(x * 0.2) * Math.cos(z * 0.17));
  }

  async build(loc, onProgress = () => {}) {
    this.clear();
    const gen = this.gen = (this.gen || 0) + 1;          // a newer build makes this one's late arrivals drop out
    const live = () => gen === this.gen;
    this.live = live;
    const L = loc.layout;
    this.layout = L;
    this.half = L.size / 2;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.nav = new Nav(L.nav, L.size, L.cell);
    // the solid things (rocks, trunks, walls...) as circles, so a walker's body - not just its centre - stays out of them
    this.blockers = L.objects.filter((o) => o.c > 0.15).map((o) => [o.x, o.z, o.c]);
    const night = L.time === "night" || L.time === "dark" || L.time === "dusk";
    this.engine.setAtmosphere({ sky: L.sky, fog: L.fog, sun: L.sun, ambient: L.ambient, ground: L.ground[0], time: L.time });
    this.makeGround(L);
    this.makePaths(L);
    this.makeWater(L);
    onProgress(0.15);
    // ---- models, grouped by asset so each kind is one instanced draw
    const byAsset = new Map();
    for (const o of L.objects) {
      if (!byAsset.has(o.a)) byAsset.set(o.a, []);
      byAsset.get(o.a).push(o);
    }
    const ids = [...byAsset.keys()];
    let done = 0;
    await Promise.all(ids.map(async (id) => {
      const list = byAsset.get(id);
      try {
        const g = await A.load(id);
        const toMat = (o) => {
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.r);
          m.compose(new THREE.Vector3(o.x, this.ground(o.x, o.z) + (o.y || 0), o.z), q, new THREE.Vector3(o.s, o.s, o.s));
          return m;
        };
        const plant = A.isPlant(id) && !/dead|stump|log/i.test(id);
        const decor = list[0].d === 1;
        const opts = { uniforms: this.engine.uniforms, shadows: !decor || /tree/i.test(id), sway: plant };
        // heavy models (lots of triangles in total) are split into 32 m chunks, so what's off-screen - or outside
        // the shadow box - isn't drawn at all. Light ones stay one batch (fewer draw calls).
        let tris = 0;
        g.scene.traverse((x) => { if (x.isMesh && x.geometry) tris += (x.geometry.index ? x.geometry.index.count : x.geometry.attributes.position.count) / 3; });
        const chunks = new Map();
        if (tris * list.length > 4000 && list.length > 3 && list[0].k !== "floor") {
          for (const o of list) { const k = `${Math.floor(o.x / 24)},${Math.floor(o.z / 24)}`; if (!chunks.has(k)) chunks.set(k, []); chunks.get(k).push(o); }
        } else chunks.set("all", list);
        const grp = new THREE.Group();
        const small = decor || /grass|flower|clover|mushroom|plant|fern|pebble|weed|bush/i.test(id);
        for (const part of chunks.values()) {
          const cg = await A.instanced(id, part.map(toMat), opts);
          if (chunks.size > 1) {                         // draw distance: the chunk hides when it's far from the camera
            const cx = part.reduce((s, o) => s + o.x, 0) / part.length, cz = part.reduce((s, o) => s + o.z, 0) / part.length;
            this.chunks.push({ obj: cg, x: cx, z: cz, far: small ? 42 : 88 });
          }
          grp.add(cg);
        }
        if (!live()) return;
        if (list[0].tint) grp.traverse((x) => { if (x.isMesh) { x.material = [].concat(x.material).map((mm) => { const c = mm.clone(); c.color?.lerp(new THREE.Color(list[0].tint), 0.5); return c; }); if (x.material.length === 1) x.material = x.material[0]; } });
        grp.userData.asset = id;
        // glowing things: brighten emissive parts, and give lamps a real light at night
        if (list[0].glow || /lamp|torch|candel|crystal|lantern|light_/i.test(id)) {
          grp.traverse((x) => {
            if (!x.isMesh) return;
            for (const mm of [].concat(x.material)) {
              if (/glow|emiss|light|fire|flame|crystal|glass|lamp/i.test(mm.name || "") || mm.emissiveMap || (mm.emissive && mm.emissive.getHex() > 0)) {
                mm.emissive = mm.emissive || new THREE.Color();
                if (mm.emissive.getHex() === 0) mm.emissive.copy(mm.color || new THREE.Color(0xffc070));
                mm.emissiveIntensity = night ? 2.2 : 0.8;
              }
            }
          });
          if (night) for (const o of list) {
            if (this.lights.length >= 10) break;
            const pl = new THREE.PointLight(/crystal/i.test(id) ? 0x7ad8ff : 0xffb560, 3.2, 11, 1.8);
            const h = (A.catalog[id]?.size?.[1] || 3) * o.s;
            pl.position.set(o.x, h * 0.8, o.z);
            this.scene.add(pl); this.lights.push(pl);
          }
        }
        this.root.add(grp);
      } catch (e) {
        console.warn("couldn't place", id, e);
      }
      onProgress(0.15 + 0.8 * (++done / ids.length));
    }));
    if (!live()) throw new Error("superseded by a newer build");
    this.makeExits(L, loc);
    await this.makeChests(loc);
    if (!live()) throw new Error("superseded by a newer build");
    this.builtFor = loc.id;
    this.vfx.setAmbient(L.fx, Math.min(60, L.size), () => this.engine.cam.target.clone());
    onProgress(1);
  }

  makeGround(L) {
    const S = L.size + 90, seg = 90;
    const g = new THREE.PlaneGeometry(S, S, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, cols = [];
    const C = (L.ground || ["#6fae3f"]).map((c) => new THREE.Color(c));
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // under water/lava the ground dips down, so wave troughs never show sand poking through (that flickered)
      const e = this.waterEdge(x, z, L);
      pos.setY(i, e > 0 ? -1.2 * Math.min(1, e / 2) : this.ground(x, z));
      const n = Math.min(0.999, Math.max(0, (Math.sin(x * 0.21) * Math.cos(z * 0.17) + Math.sin(x * 0.07 + z * 0.11)) * 0.25 + 0.5));
      const k = Math.floor(n * C.length) % C.length;
      tmp.copy(C[k]).lerp(C[(k + 1) % C.length], n % 1);
      tmp.offsetHSL(0, 0, (rnd(i) - 0.5) * 0.04);
      cols.push(tmp.r, tmp.g, tmp.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
    m.receiveShadow = true;
    m.userData.own = true;
    m.name = "ground";
    this.root.add(m);
    this.groundMesh = m;
  }

  /** how far (x, z) is inside the nearest water area, in metres (negative = that far outside it) */
  waterEdge(x, z, L) {
    let best = -99;
    for (const w of L.water || []) {
      let e;
      if (w.type === "circle") e = w.r - Math.hypot(x - w.x, z - w.z);
      else if (w.type === "rect") {
        const lx = x - (w.x0 + w.x1) / 2, lz = z - (w.z0 + w.z1) / 2;
        e = Math.min((w.z1 - w.z0) / 2 - Math.abs(lz), (w.x1 - w.x0 + 40) / 2 - Math.abs(lx));
      } else {
        const t = -Math.atan2(w.dz, w.dx), dx = x - w.x, dz = z - w.z;
        const lx = dx * Math.cos(t) - dz * Math.sin(t), lz = dx * Math.sin(t) + dz * Math.cos(t);
        e = Math.min(w.w / 2 - Math.abs(lz), w.len / 2 - Math.abs(lx));
      }
      best = Math.max(best, e);
    }
    return best;
  }

  makePaths(L) {
    const color = new THREE.Color(L.path_color || "#a88a5c");
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, transparent: true, opacity: 0.92 });
    for (const p of L.paths) {
      const pts = p.pts;
      if (pts.length < 2) continue;
      const verts = [], idx = [];
      for (let i = 0; i < pts.length; i++) {
        const [x, z] = pts[i];
        const [x2, z2] = pts[Math.min(pts.length - 1, i + 1)], [x0, z0] = pts[Math.max(0, i - 1)];
        let dx = x2 - x0, dz = z2 - z0; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
        const w = p.w / 2 * (0.85 + 0.25 * Math.sin(i * 1.7));
        verts.push(x - dz * w, 0.03, z + dx * w, x + dz * w, 0.03, z - dx * w);
        if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.userData.own = true;
      this.root.add(m);
    }
    // stepping stones along forest paths (from the nature kit)
    if (L.path_stones) {
      const rx = new RegExp(L.path_stones);
      const ids = Object.keys(A.catalog).filter((i) => rx.test(i));
      if (ids.length) {
        const per = new Map();
        L.paths.forEach((p, pi) => p.pts.forEach(([x, z], i) => {
          if (i % 3 || rnd(pi * 100 + i) < 0.35) return;
          const id = ids[Math.floor(rnd(pi * 7 + i) * ids.length)];
          const m = new THREE.Matrix4().compose(new THREE.Vector3(x + (rnd(i) - 0.5) * 0.8, 0.0, z + (rnd(i + 3) - 0.5) * 0.8),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(i) * 6), new THREE.Vector3(1, 1, 1).multiplyScalar(0.9 / Math.max(0.2, A.catalog[id]?.size?.[0] || 1)));
          if (!per.has(id)) per.set(id, []);
          per.get(id).push(m);
        }));
        const live = this.live;
        for (const [id, ms] of per) A.instanced(id, ms, { shadows: false }).then((g) => { if (!live || live()) this.root?.add(g); }).catch(() => {});
      }
    }
  }

  /** a low-poly water surface: irregular triangles (not a grid), so with flat shading and moving waves every
      facet catches the light differently - like faceted, stylized water */
  lowPolyWater(w) {
    let W, D, disc = 0;
    if (w.type === "circle") { W = D = w.r * 2; disc = w.r; }
    else if (w.type === "rect") { W = w.x1 - w.x0 + 40; D = w.z1 - w.z0; }
    else { W = w.len; D = w.w; }
    const cell = 1.1;
    const nx = Math.max(2, Math.round(W / cell)), nz = Math.max(2, Math.round(D / cell));
    const g = new THREE.PlaneGeometry(W, D, nx, nz);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    let seed = Math.abs(Math.round((w.x || w.x0 || 1) * 97 + (w.z || w.z0 || 1) * 31)) + 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    for (let i = 0; i < pos.count; i++) {                 // jitter the inside points -> uneven triangles
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(Math.abs(x) - W / 2) < 1e-3 || Math.abs(Math.abs(z) - D / 2) < 1e-3) continue;
      pos.setX(i, x + rnd() * cell * 0.7); pos.setZ(i, z + rnd() * cell * 0.7); pos.setY(i, rnd() * 0.16);
    }
    let geo = g.toNonIndexed();
    if (disc) {                                            // cut a pond out of the square
      const p = geo.attributes.position.array, keep = [];
      for (let i = 0; i < p.length; i += 9) {
        const cx = (p[i] + p[i + 3] + p[i + 6]) / 3, cz = (p[i + 2] + p[i + 5] + p[i + 8]) / 3;
        if (cx * cx + cz * cz <= disc * disc) keep.push(...p.slice(i, i + 9));
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
    }
    geo.computeVertexNormals();
    return { geo, W, D };
  }

  makeWater(L) {
    for (const w of L.water) {
      const lava = !!w.lava;
      const { geo, W, D } = this.lowPolyWater(w);
      const base = new THREE.Color(w.color || 0x3fb6c8);
      const deep = lava ? new THREE.Color(0x5a1404) : base.clone().lerp(new THREE.Color(0x0e5f6e), 0.55);
      const shallow = lava ? new THREE.Color(0xffa030) : base.clone().lerp(new THREE.Color(0x7fe8d8), 0.45);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: lava ? 0.7 : 0.22, metalness: 0.05,
        transparent: !lava, opacity: 0.92, emissive: lava ? new THREE.Color(w.color) : new THREE.Color(0x000000), emissiveIntensity: lava ? 1.1 : 0 });
      const u = this.engine.uniforms;
      const amp = lava ? 0.12 : (w.type === "rect" ? 0.34 : w.type === "circle" ? 0.16 : 0.24);   // the sea rolls the most
      const half = new THREE.Vector2(w.type === "circle" ? w.r : W / 2, w.type === "circle" ? w.r : D / 2);
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = u.uTime;
        sh.uniforms.uDeep = { value: deep }; sh.uniforms.uShallow = { value: shallow }; sh.uniforms.uHalf = { value: half };
        sh.vertexShader = "uniform float uTime; uniform vec2 uHalf; varying float vH; varying vec3 vWp; varying vec2 vLoc;\n" + sh.vertexShader.replace("#include <begin_vertex>",
          `#include <begin_vertex>
           vec4 wp0 = modelMatrix * vec4(position, 1.0);
           float h = sin(wp0.x * 0.55 + uTime * 1.25) * 0.55 + sin(wp0.z * 0.72 - uTime * 1.05 + wp0.x * 0.21) * 0.45
                   + sin((wp0.x + wp0.z) * 1.35 + uTime * 2.1) * 0.3 + sin(wp0.x * 2.3 - wp0.z * 1.7 + uTime * 2.9) * 0.18;
           h *= ${amp.toFixed(3)};
           // calm at the shore: the waterline stays put instead of washing over the sand and things on it
           float shore = ${w.type === "circle" ? "uHalf.x - length(position.xz)" : "uHalf.y - abs(position.z)"};
           h *= smoothstep(0.0, 2.5, shore);
           transformed.y += h;
           vH = (h + position.y) / ${amp.toFixed(3)};
           vLoc = position.xz;
           vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
        sh.fragmentShader = "uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec2 uHalf; varying float vH; varying vec3 vWp; varying vec2 vLoc;\n" + sh.fragmentShader.replace("#include <color_fragment>",
          `#include <color_fragment>
           // every triangle gets ONE colour from its own tilt -> the faceted, gem-like low-poly look
           vec3 fn = normalize(cross(dFdx(vWp), dFdy(vWp))); if (fn.y < 0.0) fn = -fn;
           vec3 Ld = normalize(vec3(0.35, 0.8, 0.45));
           vec3 Vd = normalize(cameraPosition - vWp);
           float lam = dot(fn, Ld);
           vec3 col = mix(uDeep, uShallow, smoothstep(-1.0, 1.2, vH));
           col *= 0.62 + 0.75 * clamp(lam, 0.0, 1.0) + 0.9 * (fn.x * 0.6 + fn.z * 0.4);
           float glint = pow(max(dot(reflect(-Ld, fn), Vd), 0.0), 18.0);
           col += ${lava ? "vec3(1.0,0.55,0.1)" : "vec3(0.85,1.0,0.98)"} * glint * 0.55;
           // foam along the shore
           float edge = ${w.type === "circle" ? "uHalf.x - length(vLoc)" : w.type === "rect" ? "uHalf.y - abs(vLoc.y)" : "uHalf.y - abs(vLoc.y)"};
           float foam = 1.0 - smoothstep(0.05, 0.38 + 0.14 * sin(vWp.x * 2.1 + uTime * 1.7), edge);
           col = mix(col, ${lava ? "vec3(1.0,0.85,0.35)" : "vec3(0.9,0.98,1.0)"}, foam * 0.55);
           diffuseColor.rgb = col;`);
      };
      mat.customProgramCacheKey = () => `lpwater${amp}${lava}`;
      const m = new THREE.Mesh(geo, mat);
      m.userData.own = true;
      m.receiveShadow = true;
      if (w.type === "circle") m.position.set(w.x, 0.06, w.z);
      else if (w.type === "rect") m.position.set((w.x0 + w.x1) / 2, 0.06, (w.z0 + w.z1) / 2);
      else { m.position.set(w.x, 0.06, w.z); m.rotation.y = -Math.atan2(w.dz, w.dx); }
      this.root.add(m);
      // a dark bed below so the water reads as deep
      const bedGeo = w.type === "circle" ? new THREE.CircleGeometry(w.r, 32) : new THREE.PlaneGeometry(W, D);
      bedGeo.rotateX(-Math.PI / 2);
      const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ color: lava ? 0x3a1004 : deep.clone().multiplyScalar(0.45), roughness: 1 }));
      bed.userData.own = true;
      bed.position.copy(m.position); bed.position.y = -1.1; bed.rotation.copy(m.rotation);
      this.root.add(bed);
    }
  }

  makeExits(L, loc) {
    for (const e of L.exits) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.4, 40), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.5, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe080, transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      beam.position.y = 1.75;
      g.add(ring, beam);
      ring.userData.own = beam.userData.own = true;
      g.position.set(e.x, 0, e.z);
      this.root.add(g);
      const label = document.createElement("div");
      label.className = "lbl exit";
      label.innerHTML = `<div class="n">➜ ${escapeHtml(e.name)}</div>`;
      document.getElementById("labels").appendChild(label);
      this.exits.push({ ...e, obj: g, label, beam });
    }
  }

  async makeChests(loc) {
    for (const t of loc.treasure || []) {
      if (t.found) continue;
      const id = t.relic ? "fantasy_props_megakit_chest_wood" : "fantasy_props_megakit_chest_wood";
      try {
        const { root, clips } = await A.instance(id);
        if (this.live && !this.live()) return;
        A.normalize(root, 0.75);
        root.position.set(t.x, 0, t.z);
        root.rotation.y = t.r || 0;
        this.root.add(root);
        const mixer = clips.length ? new THREE.AnimationMixer(root) : null;
        const ch = { ...t, obj: root, mixer, clips };
        if (t.relic) {
          const glow = new THREE.PointLight(0x7aeaff, 4, 6, 2); glow.position.set(t.x, 1.2, t.z); this.root.add(glow);
        }
        if (mixer) this.mixers.push(mixer);
        this.chests.push(ch);
        this.nav.dyn[this.nav.idx(t.x, t.z)] = 1;
      } catch (e) { console.warn("chest", e); }
    }
  }

  openChest(id) {
    const ch = this.chests.find((c) => c.id === id);
    if (!ch) return;
    const clip = ch.clips.find((c) => /open$/i.test(c.name)) || ch.clips.find((c) => /open/i.test(c.name));
    if (ch.mixer && clip) { const a = ch.mixer.clipAction(clip); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.reset().play(); }
    this.vfx.burst(ch.obj.position.clone().add(new THREE.Vector3(0, 0.8, 0)), "sparkle", 40, 2.5, 0.4, 1.0, -1);
    this.audio.sfx("chest");
    ch.found = true;
  }

  labels(engine) {
    for (const e of this.exits) {
      const s = engine.toScreen(new THREE.Vector3(e.x, 3.9, e.z));
      e.label.style.display = s.visible ? "" : "none";
      e.label.style.left = `${s.x}px`; e.label.style.top = `${s.y}px`;
    }
  }
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
