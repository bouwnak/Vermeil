// view3d.js - the Circuit Lab's 3D view (three.js). It is built from the same project as the 2D editor
// (1 unit = 2.54 mm, x/y of the 2D view -> x/z here) and shows the simulation live: glowing LEDs, spinning motors,
// servo horns, pressed buttons, the multimeter's display. Orbit with the mouse; editing happens in 2D.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PARTS, BOARDS, LED_COLORS, pinsOf, pinWorld, resistorBands } from "./parts.js";

const BB_H = 3.4;            // breadboard height (units)

export class View3D {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#1a1f27");
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight("#dfe8ff", "#30343c", 1.1));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(30, 80, 40); sun.castShadow = true;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -80; sun.shadow.camera.right = sun.shadow.camera.top = 80; sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: "#3a3f48", roughness: 0.95 }));
    desk.rotation.x = -Math.PI / 2; desk.position.y = -0.01; desk.receiveShadow = true;
    this.scene.add(desk);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.live = [];               // (st) => void   per-frame updaters
    new ResizeObserver(() => this.resize()).observe(host);
    this.running = false;
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => { if (!this.running) return; this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(tick); };
    this.resize(); tick();
  }
  stop() { this.running = false; }

  // ---------------- building ----------------
  build(project, refocus = true) {
    for (const c of [...this.root.children]) { this.root.remove(c); c.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => { m.map?.dispose(); m.dispose(); }); }); }
    this.live = [];
    // where the breadboards' holes are (legs in a hole start on top of the board)
    this.holes = new Set();
    for (const p of project.parts) if (p.type.startsWith("breadboard")) for (const q of pinsOf(p.type)) this.holes.add(pinWorld(p, q).join(","));
    const box = new THREE.Box3();
    for (const part of project.parts) {
      const def = PARTS[part.type]; if (!def) continue;
      const g = new THREE.Group();
      const onBoard = !def.board && pinsOf(part.type).some((q) => this.holes.has(pinWorld(part, q).join(",")));
      this.make(part, def, g, onBoard ? BB_H : 0);
      g.position.set(part.x, 0, part.y);
      g.rotation.y = -THREE.MathUtils.degToRad(part.rot || 0);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.root.add(g);
      box.expandByObject(g);
    }
    for (const w of project.wires) this.wire(project, w);
    if (refocus && !box.isEmpty()) {
      const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const d = Math.max(s.x, s.z) * 1.1 + 20;
      this.controls.target.copy(c);
      this.camera.position.set(c.x - d * 0.15, d * 0.85, c.z + d * 0.75);
    }
  }

  update(st) { for (const f of this.live) f(st); }

  wire(project, w) {
    const P = (end) => { const part = project.parts.find((p) => p.id === end.p); const pin = part && pinsOf(part.type).find((q) => q.id === end.pin); return part && pin ? { xy: pinWorld(part, pin), part } : null; };
    const a = P(w.a), b = P(w.b); if (!a || !b) return;
    const yOf = (end) => {
      const def = PARTS[end.part.type];
      if (end.part.type.startsWith("breadboard")) return BB_H;
      if (BOARDS[end.part.type]) return def.h > 10 ? 3.8 : BB_H + 0.8;
      return this.holes.has(end.xy.join(",")) ? BB_H + 0.5 : 1;
    };
    const ya = yOf(a), yb = yOf(b);
    const pts = [new THREE.Vector3(a.xy[0], ya, a.xy[1]), new THREE.Vector3(a.xy[0], ya + 1.2, a.xy[1])];
    const bends = w.pts?.length ? w.pts : [];
    const len = Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1]);
    const lift = Math.max(ya, yb) + Math.min(8, 1.5 + len * 0.12);
    if (bends.length) for (const q of bends) pts.push(new THREE.Vector3(q[0], lift, q[1]));
    else pts.push(new THREE.Vector3((a.xy[0] + b.xy[0]) / 2, lift, (a.xy[1] + b.xy[1]) / 2));
    pts.push(new THREE.Vector3(b.xy[0], yb + 1.2, b.xy[1]), new THREE.Vector3(b.xy[0], yb, b.xy[1]));
    const curve = new THREE.CatmullRomCurve3(pts);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.22, 8, false), new THREE.MeshStandardMaterial({ color: w.color || "#2f8f3a", roughness: 0.5 }));
    m.castShadow = true;
    this.root.add(m);
  }

  // ---------------- one part ----------------
  make(part, def, g, base) {
    const M = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...extra });
    const box = (w, h, d, color, x = 0, y = 0, z = 0, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || M(color)); m.position.set(x, y + h / 2, z); g.add(m); return m; };
    const cyl = (r, h, color, x = 0, y = 0, z = 0, mat, seg = 20) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat || M(color)); m.position.set(x, y + h / 2, z); g.add(m); return m; };
    const leg = (x, z, h) => cyl(0.09, h, "#b8bec6", x, base, z, M("#b8bec6", { metalness: 0.8, roughness: 0.3 }), 6);
    const pins = pinsOf(part.type);
    const t = part.type;

    if (t.startsWith("breadboard")) {
      box(def.w, BB_H, 19.2, "#f2f0e9", def.w / 2 - 0.5, 0, 8.6);
      box(def.w - 0.4, 0.05, 0.6, "#dcd8cc", def.w / 2 - 0.5, BB_H, 8.5);
      const holes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), M("#2a2a2a"), pins.length);
      const mtx = new THREE.Matrix4();
      pins.forEach((p, i) => { mtx.makeTranslation(p.x, BB_H + 0.01, p.y); holes.setMatrixAt(i, mtx); });
      g.add(holes);
      for (const [z, c] of [[-0.45, "#2c6bd6"], [1.45, "#d62c2c"], [15.55, "#d62c2c"], [17.45, "#2c6bd6"]]) box(def.w - 3, 0.04, 0.12, c, def.w / 2 - 0.5, BB_H, z);
      return;
    }
    if (BOARDS[t]) {
      const big = def.h > 10;                                 // Uno/Mega/Leonardo sit on the desk; small boards plug into the breadboard
      const y0 = big ? 0.8 : BB_H + 0.9;
      if (big) for (const [x, z] of [[0, 0], [def.w, 0], [0, def.h], [def.w, def.h]]) cyl(0.5, 0.8, "#888", x - 0.2, 0, z - 0.2);
      box(def.w + 0.6, 0.6, def.h + 0.6, def.color || "#0e6f8a", def.w / 2 - 0.5, y0, def.h / 2 - 0.5);
      if (def.usb) box(def.usb[2], 1.6, def.usb[3], "#c9ccd1", def.usb[0] + def.usb[2] / 2, y0 + 0.6, def.usb[1] + def.usb[3] / 2, M("#c9ccd1", { metalness: 0.9, roughness: 0.25 }));
      if (def.chip) box(def.chip[2], 0.6, def.chip[3], "#1d1f22", def.chip[0] + def.chip[2] / 2, y0 + 0.6, def.chip[1] + def.chip[3] / 2);
      for (const p of pins) {
        if (big) box(0.95, 3, 0.95, "#141414", p.x, y0 + 0.6, p.y);
        else { cyl(0.12, y0 - BB_H + 0.2, "#d4af37", p.x, BB_H - 0.2, p.y, M("#d4af37", { metalness: 0.9, roughness: 0.3 }), 6); box(0.9, 0.9, 0.9, "#141414", p.x, y0 - 0.9, p.y); }
      }
      const led = cyl(0.35, 0.3, "#5a3a00", def.led13?.[0] ?? 3, y0 + 0.6, def.led13?.[1] ?? 4);
      const lbl = labelSprite(def.label || def.name, "#e9f4f7"); lbl.position.set(def.w / 2 - 0.5, y0 + 0.65, def.h / 2 + 2); lbl.rotation.x = -Math.PI / 2; g.add(lbl);
      this.live.push((st) => { const on = st[part.id]?.led13; led.material.emissive?.set(on ? "#ffaa00" : "#000"); led.material.emissiveIntensity = on ? 2 : 0; });
      return;
    }
    if (t === "led") {
      const [c] = LED_COLORS[part.props.color] || LED_COLORS.red;
      leg(0, 0, 3.2); leg(1, 0, 3.6);
      const mat = M(c, { transparent: true, opacity: 0.75, emissive: new THREE.Color(c), emissiveIntensity: 0 });
      cyl(1.1, 0.35, c, 0.5, base + 3, 0, mat);
      const body = cyl(0.95, 2.2, c, 0.5, base + 3.3, 0, mat);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat); dome.position.set(0.5, base + 5.5, 0); g.add(dome);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: c, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.set(8, 8, 1); glow.position.set(0.5, base + 5, 0); g.add(glow);
      this.live.push((st) => { const s = st[part.id] || {}; const b = s.burnt ? 0 : Math.min(1.4, s.bright || 0); mat.emissiveIntensity = b * 2.5; glow.material.opacity = Math.min(1, b); if (s.burnt) mat.color.set("#333"); });
      void body; return;
    }
    if (t === "rgbled") {
      for (const p of pins) leg(p.x, 0, p.id === "K" ? 3.8 : 3.4);
      const mat = M("#eef", { transparent: true, opacity: 0.7, emissive: new THREE.Color("#000") });
      cyl(1.1, 2.4, "#eef", 1.5, base + 3.4, 0, mat);
      this.live.push((st) => { const c = st[part.id]?.rgb || [0, 0, 0]; mat.emissive.setRGB(Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])); mat.emissiveIntensity = 2; });
      return;
    }
    if (t === "resistor") {
      leg(0, 0, 1.4); leg(4, 0, 1.4);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4, 6), M("#b8bec6", { metalness: 0.8 })); wire.rotation.z = Math.PI / 2; wire.position.set(2, base + 1.4, 0); g.add(wire);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.6, 6, 14), M("#e6cf9a")); body.rotation.z = Math.PI / 2; body.position.set(2, base + 1.4, 0); g.add(body);
      resistorBands(+part.props.ohms).forEach((c, i) => { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.18, 14), M(c)); b.rotation.z = Math.PI / 2; b.position.set(1.3 + i * 0.42 + (i === 3 ? 0.3 : 0), base + 1.4, 0); g.add(b); });
      return;
    }
    if (t === "button") {
      for (const p of pins) leg(p.x, p.y, 0.6);
      box(2.9, 1.4, 3.9, "#2b2d31", 1, base + 0.3, 1.5);
      const cap = cyl(0.95, 1, "#5c6068", 1, base + 1.7, 1.5);
      this.live.push((st) => { const on = st[part.id]?.pressed; cap.position.y = base + 1.7 + (on ? -0.45 : 0) + 0.5; cap.material.color.set(on ? "#c43" : "#5c6068"); });
      return;
    }
    if (t === "pot") {
      for (const p of pins) leg(p.x, p.y, 0.8);
      box(4.6, 2, 2.9, "#1f5bd6", 2, base + 0.8, -1.2);
      const knob = cyl(1.1, 1.6, "#e9e9e9", 2, base + 2.8, -1.2);
      const mark = box(0.25, 0.1, 1, "#333", 0, 1.6, -0.5); knob.remove(mark); mark.position.set(0, 0.85, -0.5); knob.add(mark);
      this.live.push(() => { knob.rotation.y = -THREE.MathUtils.degToRad(-135 + 270 * (+part.props.pos)); });
      return;
    }
    if (t === "motor" || t === "servo") {
      for (const p of pins) leg(p.x, p.y, 0.6);
      if (t === "motor") {
        box(4.5, 3, 6, "#f2c230", 1, base + 0.6, -5);
        const wheel = cyl(3, 1.2, "#eeeeee", 0, 0, 0); g.remove(wheel);
        const holder = new THREE.Group(); holder.position.set(3.9, base + 2.2, -5); holder.rotation.z = Math.PI / 2; holder.add(wheel); g.add(holder);
        const tread = new THREE.Mesh(new THREE.TorusGeometry(3, 0.5, 8, 24), M("#222")); tread.rotation.x = Math.PI / 2; tread.position.y = 0.6; wheel.add(tread);
        this.live.push((st) => { holder.rotation.x = THREE.MathUtils.degToRad(st[part.id]?.angle || 0); });
      } else {
        box(4, 4, 2.2, "#1f5bd6", 1, base + 0.6, -3);
        const horn = new THREE.Group(); horn.position.set(1, base + 4.8, -3.3); g.add(horn);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 4), M("#fafafa")); arm.position.z = -1.5; horn.add(arm);
        this.live.push((st) => { horn.rotation.y = THREE.MathUtils.degToRad((st[part.id]?.servo ?? 90) - 90); });
      }
      return;
    }
    // everything else: a simple box/cylinder in its colours, with legs
    for (const p of pins) leg(p.x, p.y, 1);
    const cx = pins.reduce((s, p) => s + p.x, 0) / pins.length;
    const look = { buzzer: ["cyl", "#1b1b1b", 1.8, 1.4], battery9v: ["box", "#222", 5, 8, 2.5], aa4: ["box", "#2a2a2a", 6, 7, 3], coincell: ["cyl", "#cfd3d8", 2, 0.4],
      hcsr04: ["box", "#1f6fbf", 9, 0.4, 4], tmp36: ["box", "#222", 2.4, 1.6, 1.2], npn: ["box", "#222", 2.4, 1.6, 1.2], nmos: ["box", "#222", 3.2, 3.4, 1.2],
      diode: ["box", "#1b1b1b", 2, 0.8, 0.8], capacitor: ["cyl", +part.props.farads >= 1e-6 ? "#1d3f8f" : "#e09a2c", 1.1, 2.2], ldr: ["cyl", "#e8a33d", 1, 0.4],
      switch: ["box", "#2b2d31", 3.2, 1.3, 1.2], slide_switch: ["box", "#44444a", 2.8, 1.4, 1.4], relay: ["box", "#0044aa", 3.2, 2.8, 2.8], seg7: ["box", "#1b1c20", 4.6, 1.8, 4.0], l293d: ["box", "#1b1b1b", 8, 1.2, 2.2], multimeter: ["box", "#f2c230", 6, 1.5, 8] }[t] || ["box", "#555", 2, 1, 1];
    const y = base + 1;
    if (look[0] === "cyl") cyl(look[2], look[3], look[1], cx, y, 0);
    else if (t === "l293d") box(look[2], look[3], look[4], look[1], 3.5, base + 0.4, 1.5);
    else if (t === "hcsr04") { box(9, 4, 0.4, "#1f6fbf", cx, y, -1); for (const dx of [-2.3, 2.3]) { const e = cyl(1.6, 1.4, "#c9ccd1", cx + dx, 0, 0); e.rotation.x = Math.PI / 2; e.position.set(cx + dx, y + 2, -1.6); } }
    else if (t === "multimeter") {
      box(6, 1.5, 8, "#f2c230", cx, 0, -6);
      const cv = document.createElement("canvas"); cv.width = 256; cv.height = 96;
      const tex = new THREE.CanvasTexture(cv);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.8), new THREE.MeshBasicMaterial({ map: tex })); scr.rotation.x = -Math.PI / 2; scr.position.set(cx, 1.52, -8); g.add(scr);
      let last = null;
      const draw = (text) => { const c = cv.getContext("2d"); c.fillStyle = "#cfe3c8"; c.fillRect(0, 0, 256, 96); c.fillStyle = "#111"; c.font = "bold 64px monospace"; c.textAlign = "center"; c.fillText(text, 128, 72); tex.needsUpdate = true; };
      draw("0.00");
      this.live.push((st) => { const r = `${st[part.id]?.reading ?? "0.00"}${part.props.mode === "A" ? "mA" : "V"}`; if (r !== last) { last = r; draw(r); } });
    } else box(look[2], look[3], look[4], look[1], cx, y, t === "battery9v" || t === "aa4" ? -look[4] / 2 - 1 : -0.5);
    if (t === "buzzer") this.live.push((st) => { g.children.at(-1).material.emissive?.set(st[part.id]?.sound ? "#224466" : "#000"); });
  }
}

let _glow = null;
function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(255,255,255,.5)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (_glow = new THREE.CanvasTexture(c));
}

function labelSprite(text, color) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 96;
  const x = c.getContext("2d"); x.fillStyle = color; x.font = "bold 64px Nunito, sans-serif"; x.textAlign = "center"; x.fillText(text, 256, 70);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  return m;
}
