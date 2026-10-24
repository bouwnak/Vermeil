// vfx.js - every visual effect: magic of each element, weapon swings, impacts, projectiles, heals, buffs,
// level-up bursts, the ambient life of each biome (leaves, fireflies, snow, embers...) and the portal.
// Particles live in pooled systems with hard caps, and every effect removes itself when it's done.
import * as THREE from "three";

const COLORS = {
  fire: [0xffb347, 0xff5a1f], ice: [0xbff3ff, 0x5fc8ff], lightning: [0xfff7a8, 0x9fd8ff], light: [0xfff6d0, 0xffe27a],
  shadow: [0xb48cff, 0x3b1f6e], arcane: [0xd59bff, 0x6f7bff], poison: [0xb6ff7a, 0x3f9a2a], heal: [0xb8ffc6, 0x58e07a],
  water: [0x9fe6ff, 0x3a9fe0], earth: [0xd8b37a, 0x7a5a32], wind: [0xe8fff8, 0x9fe8d8], slash: [0xffffff, 0xcfe9ff],
  slash_red: [0xffb0b8, 0xe0475b], bite: [0xffffff, 0xff8080], impact: [0xfff0c0, 0xffb060], summon: [0x9ff0ff, 0x5fe3ff],
  buff_red: [0xffa0a0, 0xff4040], buff_gold: [0xfff0a0, 0xe9b949], shield: [0xa0e0ff, 0x4f8dff], mark: [0xffe080, 0xff6040],
  smoke: [0xd0d0d0, 0x606060], sparkle: [0xffffff, 0xffe080], potion: [0xff9ad0, 0xff5aa0], bullet: [0xfff0a0, 0xffa040],
  laser: [0xff6070, 0xff2040], meteor: [0xffa040, 0xff3010], storm: [0xd0f0ff, 0x8060ff], arrow: [0xe8e0c8, 0xa08060],
};
export const elemColor = (e) => COLORS[e] || COLORS.arcane;

const PVERT = `attribute float aSize; attribute float aLife; attribute vec3 aColor; varying float vLife; varying vec3 vColor;
  void main(){ vLife = aLife; vColor = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = aSize * (300.0 / -mv.z) * (0.4 + 0.6*clamp(aLife*2.0,0.0,1.0)); gl_Position = projectionMatrix * mv; }`;
const PFRAG = `varying float vLife; varying vec3 vColor; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
  if (d > 0.5) discard; float a = smoothstep(0.5, 0.0, d) * clamp(vLife*1.5, 0.0, 1.0); gl_FragColor = vec4(vColor * (1.0 + a), a); }`;

/** one big particle pool (additive, soft). spawn() writes into a ring buffer. */
class Particles {
  constructor(scene, max = 3000, additive = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aLife", new THREE.BufferAttribute(new Float32Array(max), 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({ vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.i = 0;
  }
  spawn(p, v, color, size, life, grav = 0, drag = 0) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3);
    const c = color.isColor ? color : new THREE.Color(color);
    this.col.set([c.r, c.g, c.b], i * 3);
    this.size[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    const L = this.geo.attributes.aLife.array;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { L[i] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = i * 3, d = 1 - this.drag[i] * dt;
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      L[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sph = (r) => { const t = Math.random() * Math.PI * 2, u = rnd(-1, 1), s = Math.sqrt(1 - u * u); return V(Math.cos(t) * s * r, u * r, Math.sin(t) * s * r); };

export class VFX {
  constructor(engine, audio) {
    this.engine = engine;
    this.scene = engine.scene;
    this.audio = audio;
    this.p = new Particles(this.scene, engine.quality === "low" ? 1500 : 4000, true);
    this.pSoft = new Particles(this.scene, 1500, false);   // smoke, leaves, snow (not glowing)
    this.live = [];                 // timed mesh effects
    this.ambient = null;
    this.lights = [];               // pooled flash lights
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffffff, 0, 8, 2); this.scene.add(l); this.lights.push(l); }
    engine.onUpdate((dt, t) => this.update(dt, t));
  }

  update(dt, t) {
    this.p.update(dt); this.pSoft.update(dt);
    for (const e of [...this.live]) {
      e.t += dt;
      const k = e.t / e.dur;
      e.tick?.(Math.min(1, k), dt);
      if (k >= 1) { this.scene.remove(e.obj); e.obj.traverse?.((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); this.live.splice(this.live.indexOf(e), 1); }
    }
    for (const l of this.lights) if (l.intensity > 0) l.intensity = Math.max(0, l.intensity - dt * l.userData.fade);
    if (this.ambient) this.ambient(dt, t);
  }

  flash(pos, color, power = 12, fade = 30) {
    const l = this.lights.reduce((a, b) => (a.intensity < b.intensity ? a : b));
    l.position.copy(pos); l.color.set(color); l.intensity = power; l.userData.fade = fade;
  }

  timed(obj, dur, tick) { this.scene.add(obj); this.live.push({ obj, dur, t: 0, tick }); }

  burst(pos, element, n = 40, speed = 3, size = 0.35, life = 0.7, grav = 0) {
    const [a, b] = elemColor(element);
    const ca = new THREE.Color(a), cb = new THREE.Color(b);
    for (let i = 0; i < n; i++) this.p.spawn(pos.clone().add(sph(0.2)), sph(rnd(0.3, 1) * speed), ca.clone().lerp(cb, Math.random()), size * rnd(0.6, 1.3), life * rnd(0.6, 1.2), grav, 1.5);
  }

  ring(pos, color, r1 = 2.5, dur = 0.6, y = 0.05) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.35, 48), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y += y;
    this.timed(m, dur, (k) => { const s = 0.3 + k * r1 * 3; m.scale.set(s, s, s); m.material.opacity = 1 - k; });
  }

  pillar(pos, color, h = 6, dur = 0.9, r = 0.7) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.4, h, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.copy(pos); m.position.y += h / 2;
    this.timed(m, dur, (k) => { m.material.opacity = Math.sin(Math.PI * k) * 0.7; m.scale.x = m.scale.z = 1 + k * 0.4; });
  }

  /** a sword arc in front of the attacker */
  slash(from, dir, color = 0xffffff, heavy = false) {
    const g = new THREE.RingGeometry(0.9, heavy ? 1.6 : 1.35, 32, 1, -0.9, 1.8);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(from).add(V(0, 1.1, 0)).add(dir.clone().multiplyScalar(0.6));
    m.lookAt(m.position.clone().add(V(0, 1, 0)));
    m.rotateZ(Math.atan2(dir.x, dir.z) + Math.PI / 2);
    m.rotateX(heavy ? 0.9 : 0.35);
    this.timed(m, 0.28, (k) => { m.material.opacity = 1 - k; m.rotateZ(0.12); });
  }

  /** a projectile from a to b; resolves when it arrives */
  projectile(a, b, element, { speed = 18, size = 0.5, arc = 0.8, kind = "orb" } = {}) {
    return new Promise((res) => {
      const [c1, c2] = elemColor(element);
      const start = a.clone(), end = b.clone();
      const d = start.distanceTo(end);
      const dur = Math.max(0.18, d / speed);
      let mesh;
      if (kind === "arrow" || kind === "bullet") {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, kind === "arrow" ? 0.9 : 0.3, 6), new THREE.MeshBasicMaterial({ color: c1 }));
      } else {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(size * 0.45, 12, 8), new THREE.MeshBasicMaterial({ color: c1, transparent: true, blending: THREE.AdditiveBlending }));
      }
      const prev = start.clone();
      this.timed(mesh, dur, (k) => {
        const p = start.clone().lerp(end, k);
        p.y += Math.sin(Math.PI * k) * arc * (kind === "bullet" ? 0 : 1);
        mesh.position.copy(p);
        const dirv = p.clone().sub(prev);
        if (dirv.lengthSq() > 1e-6) { mesh.lookAt(p.clone().add(dirv)); mesh.rotateX(Math.PI / 2); }
        prev.copy(p);
        if (kind !== "bullet") for (let i = 0; i < 3; i++) this.p.spawn(p.clone().add(sph(0.1)), sph(0.4), new THREE.Color(Math.random() < 0.5 ? c1 : c2), size * (kind === "arrow" ? 0.25 : 0.9), 0.35, 0, 2);
        if (k >= 1) res();
      });
      setTimeout(res, dur * 1000 + 300);
    });
  }

  lightning(a, b, color = 0xd8f0ff) {
    const pts = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, i / n);
      if (i > 0 && i < n) p.add(sph(0.45));
      pts.push(p);
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending }));
    this.timed(line, 0.35, (k) => { line.material.opacity = (1 - k) * (Math.random() < 0.7 ? 1 : 0.2); });
    this.flash(b, color, 20);
  }

  /** shield bubble / aura around someone */
  aura(pos, element, h = 1.8, dur = 1.0) {
    const [c1] = elemColor(element);
    const m = new THREE.Mesh(new THREE.SphereGeometry(h * 0.6, 24, 16), new THREE.MeshBasicMaterial({ color: c1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: element === "shield" }));
    m.position.copy(pos).add(V(0, h * 0.55, 0));
    this.timed(m, dur, (k) => { m.material.opacity = Math.sin(Math.PI * k) * 0.35; const s = 0.8 + k * 0.3; m.scale.set(s, s, s); });
    for (let i = 0; i < 24; i++) this.p.spawn(pos.clone().add(V(rnd(-0.6, 0.6), rnd(0, 0.3), rnd(-0.6, 0.6))), V(0, rnd(1, 2.5), 0), new THREE.Color(c1), 0.3, rnd(0.6, 1.1), -0.5, 0.5);
  }

  /** the effect that matches what happened (called by the battle director) */
  castAt(kind, pos, h = 1.6) {
    const top = pos.clone().add(V(0, h * 0.6, 0));
    switch (kind) {
      case "fire": this.burst(top, "fire", 60, 4, 0.55, 0.8, -1); this.flash(top, 0xff7a30, 16); this.ring(pos, 0xff7a30); break;
      case "meteor": this.pillar(pos, 0xff7a30, 9, 0.8, 1.2); this.burst(top, "fire", 120, 7, 0.7, 1.0, 2); this.flash(top, 0xff5010, 30); this.ring(pos, 0xff5010, 4); this.engine.cam.shake = 1; break;
      case "ice": this.burst(top, "ice", 50, 3, 0.45, 0.9, 1.5); this.ring(pos, 0x9fe6ff, 2); this.flash(top, 0x9fe6ff, 10); break;
      case "lightning": this.lightning(top.clone().add(V(rnd(-1, 1), 8, rnd(-1, 1))), top); this.burst(top, "lightning", 40, 5, 0.35, 0.4); break;
      case "storm": this.lightning(top.clone().add(V(0, 8, 0)), top); this.burst(top, "storm", 80, 5, 0.5, 0.8); this.ring(pos, 0x9f80ff, 3); break;
      case "light": this.pillar(pos, 0xfff0a0, 7, 0.9, 0.6); this.burst(top, "light", 40, 2, 0.5, 0.9, -1); this.flash(top, 0xfff0a0, 16); break;
      case "shadow": this.burst(top, "shadow", 60, 2.5, 0.6, 1.0, -0.6); this.ring(pos, 0x7a50ff, 2); break;
      case "arcane": this.burst(top, "arcane", 45, 3, 0.45, 0.7); this.flash(top, 0xb070ff, 10); break;
      case "poison": this.burst(top, "poison", 40, 1.5, 0.5, 1.0, -0.4); break;
      case "earth": this.burst(pos.clone().add(V(0, 0.2, 0)), "earth", 50, 4, 0.5, 0.9, 6); this.ring(pos, 0xc0905a, 3); this.engine.cam.shake = 0.6; break;
      case "wind": this.burst(top, "wind", 40, 4, 0.4, 0.6); this.ring(pos, 0xd0fff0, 2.5); break;
      case "heal": this.aura(pos, "heal", h); this.flash(top, 0x8fff9f, 8); break;
      case "buff_red": case "buff_gold": case "shield": this.aura(pos, kind, h); break;
      case "mark": this.ring(pos, 0xffc040, 1.2, 0.8, 0.1); this.burst(top.clone().add(V(0, h * 0.5, 0)), "mark", 15, 1, 0.4, 0.8); break;
      case "smoke": for (let i = 0; i < 40; i++) this.pSoft.spawn(pos.clone().add(V(rnd(-1, 1), rnd(0, 1), rnd(-1, 1))), V(rnd(-0.5, 0.5), rnd(0.3, 1), rnd(-0.5, 0.5)), new THREE.Color(0xcfcfcf), rnd(1.2, 2), rnd(1, 1.8), -0.2, 0.8); break;
      case "summon": this.ring(pos, 0x5fe3ff, 2.5, 0.9); this.pillar(pos, 0x5fe3ff, 5, 1.0, 0.8); this.burst(top, "summon", 60, 3, 0.5, 1.0, -1); break;
      case "sparkle": this.burst(top, "sparkle", 30, 2, 0.35, 0.8, -1); break;
      case "potion": this.aura(pos, "potion", h, 0.8); break;
      default: this.burst(top, kind, 30, 3, 0.4, 0.6);
    }
    this.audio?.sfx(kind);
  }

  impact(pos, element = "impact", crit = false) {
    const p = pos.clone();
    this.burst(p, element || "impact", crit ? 45 : 22, crit ? 6 : 4, crit ? 0.5 : 0.35, 0.4, 3);
    this.flash(p, elemColor(element || "impact")[0], crit ? 18 : 8, 40);
    if (crit) { this.ring(p.clone().setY(0), 0xffe080, 2, 0.4); this.engine.cam.shake = 0.6; }
  }

  levelUp(pos) {
    this.pillar(pos, 0xffe080, 8, 1.6, 0.8);
    this.ring(pos, 0xffe080, 3, 1.2);
    for (let i = 0; i < 90; i++) this.p.spawn(pos.clone().add(V(rnd(-0.8, 0.8), rnd(0, 0.5), rnd(-0.8, 0.8))), V(rnd(-0.4, 0.4), rnd(2, 5), rnd(-0.4, 0.4)), new THREE.Color(Math.random() < 0.5 ? 0xffe080 : 0xffffff), rnd(0.25, 0.5), rnd(1, 2), 0.3, 0.6);
    this.flash(pos.clone().add(V(0, 2, 0)), 0xffe080, 25, 10);
  }

  death(pos, h = 1.5) {
    for (let i = 0; i < 30; i++) this.pSoft.spawn(pos.clone().add(V(rnd(-0.5, 0.5), rnd(0, h), rnd(-0.5, 0.5))), V(rnd(-0.3, 0.3), rnd(0.5, 1.5), rnd(-0.3, 0.3)), new THREE.Color(0x9a9aa8), rnd(0.8, 1.4), rnd(0.8, 1.4), -0.3, 1);
  }

  // ---------------- ambient life for each biome ----------------
  setAmbient(kinds, size = 60, center = () => V()) {
    const list = new Set(kinds || []);
    let acc = 0;
    const rate = { leaves: 6, fireflies: 10, pollen: 14, butterflies: 2, snowfall: 60, embers: 22, mist: 5, dust: 8, stars: 0, wisps: 3, sparks: 6,
                   drips: 4, crystal_glow: 6, smoke: 2, god_rays: 0, waves: 0, seagulls: 0, heat: 0, wind: 4, clouds: 0, banners: 0, birds: 0, torch_flicker: 0, petals: 9, sparkles: 5 };
    this.ambient = (dt, t) => {
      acc += dt;
      if (acc < 0.05) return;
      const step = acc; acc = 0;
      const c = center();
      for (const k of list) {
        const n = (rate[k] || 0) * step;
        for (let i = 0; i < n + (Math.random() < n % 1 ? 1 : 0); i++) {
          const p = c.clone().add(V(rnd(-size / 2, size / 2), 0, rnd(-size / 2, size / 2)));
          if (k === "leaves") { p.y = rnd(5, 10); this.pSoft.spawn(p, V(rnd(0.3, 1), -rnd(0.4, 0.9), rnd(-0.3, 0.3)), new THREE.Color().setHSL(rnd(0.0, 0.12), 0.75, 0.5), 0.25, 9, 0, 0); }
          else if (k === "fireflies" || k === "wisps") { p.y = rnd(0.4, 2.5); this.p.spawn(p, V(rnd(-0.2, 0.2), rnd(-0.1, 0.2), rnd(-0.2, 0.2)), new THREE.Color(k === "wisps" ? 0x9fe0ff : 0xe8ff80), 0.22, rnd(2, 4), 0, 0); }
          else if (k === "pollen" || k === "dust") { p.y = rnd(0.3, 4); this.p.spawn(p, V(rnd(-0.2, 0.2), rnd(-0.05, 0.1), rnd(-0.2, 0.2)), new THREE.Color(k === "dust" ? 0xa09a90 : 0xfff6c0), 0.09, rnd(3, 6), 0, 0); }
          else if (k === "butterflies") { p.y = rnd(0.5, 2); this.pSoft.spawn(p, V(rnd(-0.8, 0.8), rnd(-0.2, 0.4), rnd(-0.8, 0.8)), new THREE.Color().setHSL(Math.random(), 0.8, 0.65), 0.35, rnd(3, 5), 0, 0); }
          else if (k === "snowfall") { p.y = rnd(6, 14); this.pSoft.spawn(p, V(rnd(-0.2, 0.3), -rnd(0.8, 1.4), rnd(-0.2, 0.2)), new THREE.Color(0xffffff), 0.16, 12, 0, 0); }
          else if (k === "embers" || k === "sparks") { p.y = rnd(0, 1); this.p.spawn(p, V(rnd(-0.3, 0.3), rnd(0.8, 2.2), rnd(-0.3, 0.3)), new THREE.Color(k === "sparks" ? 0x9fd8ff : 0xff7a30), 0.14, rnd(2, 4), 0, 0); }
          else if (k === "mist") { p.y = rnd(0.2, 1.2); this.pSoft.spawn(p, V(rnd(-0.2, 0.2), 0, rnd(-0.2, 0.2)), new THREE.Color(0xe0e8ea), rnd(4, 7), rnd(5, 8), 0, 0); }
          else if (k === "drips") { p.y = rnd(5, 8); this.p.spawn(p, V(0, -6, 0), new THREE.Color(0x9fd8ff), 0.08, 1.2, 0, 0); }
          else if (k === "crystal_glow") { p.y = rnd(0.3, 2); this.p.spawn(p, V(0, rnd(0.1, 0.4), 0), new THREE.Color(0x8fe8ff), 0.18, rnd(2, 3), 0, 0); }
          else if (k === "wind") { p.y = rnd(0.5, 3); this.p.spawn(p, V(rnd(3, 6), 0, rnd(-0.5, 0.5)), new THREE.Color(0xffffff), 0.06, 1.5, 0, 0); }
          else if (k === "petals") { p.y = rnd(4, 9); this.pSoft.spawn(p, V(rnd(0.2, 0.8), -rnd(0.3, 0.7), rnd(-0.4, 0.4)), new THREE.Color().setHSL(rnd(0.92, 0.98), 0.75, rnd(0.78, 0.88)), 0.2, 11, 0, 0); }
          else if (k === "sparkles") { p.y = rnd(0.5, 4); this.p.spawn(p, V(0, rnd(0.05, 0.3), 0), new THREE.Color().setHSL(rnd(0.1, 0.18), 1, 0.75), 0.16, rnd(1.5, 3), 0, 0); }
          else if (k === "smoke") { p.y = rnd(3, 6); this.pSoft.spawn(p, V(0.2, 0.6, 0), new THREE.Color(0xbdbdbd), rnd(1.5, 2.5), 5, -0.05, 0.1); }
        }
      }
    };
  }

  // ---------------- the portal (cyan-white swirl around a dark centre) ----------------
  makePortal(radius = 2.2) {
    const group = new THREE.Group();
    const u = { uTime: this.engine.uniforms.uTime, uPower: { value: 0 } };
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 1.25, 96), new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform float uTime; uniform float uPower; varying vec2 vUv;
        float n(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(n(i),n(i+vec2(1,0)),f.x), mix(n(i+vec2(0,1)),n(i+vec2(1,1)),f.x), f.y); }
        void main(){ vec2 c = vUv - .5; float r = length(c) * 2.0; float a = atan(c.y, c.x);
          float sw = a + r * 6.0 - uTime * 2.4;
          float bands = noise(vec2(sw * 2.0, r * 8.0 - uTime)) * 0.6 + noise(vec2(sw * 5.0, r * 20.0 + uTime*1.5)) * 0.4;
          float ring = smoothstep(0.35, 0.62, r) * (1.0 - smoothstep(0.78, 1.0, r));
          float streak = pow(max(0., sin(sw * 3.0 + bands * 4.0)), 6.0);
          vec3 col = mix(vec3(0.25, 0.75, 1.0), vec3(0.95, 1.0, 1.0), bands + streak * 0.8);
          float core = 1.0 - smoothstep(0.0, 0.45, r);
          float alpha = (ring * (0.55 + 0.45 * bands) + streak * ring) * uPower;
          vec3 outc = col * (1.0 + streak * 1.5);
          outc = mix(outc, vec3(0.02, 0.03, 0.06), core * uPower);
          alpha = max(alpha, core * uPower * 0.95);
          gl_FragColor = vec4(outc, alpha); }`,
    }));
    group.add(disc);
    // a few rotating energy rings
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(radius * (0.95 + i * 0.12), 0.04 + i * 0.015, 8, 96), new THREE.MeshBasicMaterial({ color: i === 1 ? 0xffffff : 0x7aeaff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      group.add(m); rings.push(m);
    }
    const light = new THREE.PointLight(0x7aeaff, 0, 16, 1.6);
    group.add(light);
    const P = { group, u, rings, light, power: 0, want: 0, radius };
    const stop = this.engine.onUpdate((dt, t) => {
      P.power += (P.want - P.power) * Math.min(1, dt * 1.5);
      u.uPower.value = P.power;
      rings.forEach((r, i) => { r.rotation.z += dt * (1.2 + i * 0.7) * (i % 2 ? -1 : 1); r.material.opacity = P.power * (0.5 + 0.5 * Math.sin(t * 3 + i)); r.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.03 * P.power); });
      light.intensity = P.power * 14;
      // particles spiralling inward
      if (P.power > 0.05) for (let i = 0; i < 3 * P.power; i++) {
        const a = Math.random() * Math.PI * 2, r = radius * rnd(1.1, 1.6);
        const pos = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0).applyMatrix4(group.matrixWorld);
        const to = group.getWorldPosition(new THREE.Vector3()).sub(pos).multiplyScalar(rnd(0.8, 1.4));
        this.p.spawn(pos, to, new THREE.Color(Math.random() < 0.5 ? 0x7aeaff : 0xffffff), rnd(0.15, 0.35), 1.0, 0, 0);
      }
    });
    P.dispose = () => { stop(); group.parent?.remove(group); };
    return P;
  }
}
