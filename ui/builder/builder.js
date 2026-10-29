// builder.js - the 3D Build Lab: turns a build spec (skills/builder.py) into a 3D robot or device made of real
// layers - exoskeleton/shell, frame, motors & servos, electronics, power, sensors and wiring - assembles it in
// front of you, lets you look at one layer at a time (servos only, wires only, x-ray, exploded...) and simulates it:
// legged robots walk with a real gait, wheeled ones drive, arms pick things up, drones hover, TVs switch on.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { AxisGizmo } from "../electronics/gizmo3d.js";

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (k === "class") e.className = v; else e.setAttribute(k, v === true ? "" : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ talking to Python (inside Vermeil or the dev server)
function pyApi() {
  return new Promise((res) => {
    if (window.pywebview?.api) return res(window.pywebview.api);
    window.addEventListener("pywebviewready", () => res(window.pywebview.api), { once: true });
    setTimeout(() => res(window.pywebview?.api || null), 2500);
  });
}
let apiP = null;
async function call(name, ...args) {
  apiP ||= pyApi();
  const api = await apiP;
  if (api?.[name]) { try { return await api[name](...args); } catch (e) { return { error: String(e?.message || e) }; } }
  try {                                                  // browser testing: game_tools/dev_server.py answers /api/<name>
    const r = await fetch(`/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
    return r.ok ? r.json() : { error: `server error ${r.status}` };
  } catch (e) { return { error: "Open the 3D Build Lab from Vermeil (Robotics & Electronics → 3D Builder)." }; }
}

// ------------------------------------------------------------------ scene
const stage = $("stage");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0e141c, 30, 80);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 300);
camera.position.set(7, 5, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.target.set(0, 1.2, 0);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x30261c, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(6, 12, 7); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 });
scene.add(sun);
const rim = new THREE.DirectionalLight(0x7ab8ff, 0.8); rim.position.set(-8, 5, -6); scene.add(rim);
// ground: a disc with a moving grid (the grid scrolls under walking/driving robots)
const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ color: 0x1a2330, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(80, 80, 0x3b4b60, 0x253242); grid.position.y = 0.002; scene.add(grid);
const water = new THREE.Mesh(new THREE.BoxGeometry(80, 8, 80), new THREE.MeshStandardMaterial({ color: 0x1c6fa8, transparent: true, opacity: 0.18, depthWrite: false }));
water.position.y = 4; water.visible = false; scene.add(water);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
}
addEventListener("resize", resize); resize();

// Blender-style 3D Axis Gizmo for moving parts
const gizmo = new AxisGizmo({
  scene,
  camera,
  domElement: renderer.domElement,
  controls,
  stage: $("stage"),
  onMove: (target) => {
    selBox?.update();
    labelsDirty = true;
  },
  onMoveEnd: (target) => {
    recordMove(target);
    selBox?.update();
    labelsDirty = true;
  },
  onDelete: () => {
    removeSelected();
  },
  isEnabled: () => manual,
});

// ------------------------------------------------------------------ materials per layer
const LAYER = {
  shell: { label: "Exoskeleton / shell", color: "#e9ecef" }, frame: { label: "Frame", color: "#b8c0c8" }, actuator: { label: "Motors & servos", color: "#2f6fd6" },
  electronics: { label: "Electronics", color: "#2fae6a" }, power: { label: "Power", color: "#f0b429" }, sensor: { label: "Sensors", color: "#9b6bff" },
  wiring: { label: "Wiring", color: "#ff7a1a" }, display: { label: "Display", color: "#5ad1ff" }, mechanical: { label: "Mechanical", color: "#9aa3ad" },
};
const VIEWS = [
  ["all", "🧩 Everything"], ["shell", "🛡 Exoskeleton"], ["frame", "🦴 Frame only"], ["actuator", "⚙ Motors / servos only"],
  ["electronics", "🔌 Electronics only"], ["wiring", "〰 Wires only"], ["power", "🔋 Power only"], ["sensor", "📡 Sensors only"],
  ["xray", "👁 X-ray"], ["exploded", "💥 Exploded"],
];
function mat(layer, color) {
  const c = new THREE.Color(color || LAYER[layer]?.color || "#999");
  switch (layer) {
    case "frame": return new THREE.MeshStandardMaterial({ color: c, metalness: 0.85, roughness: 0.32 });
    case "shell": return new THREE.MeshStandardMaterial({ color: c, metalness: 0.05, roughness: 0.45 });
    case "display": return new THREE.MeshStandardMaterial({ color: 0x06080c, metalness: 0.3, roughness: 0.15, emissive: c, emissiveIntensity: 0 });
    case "wiring": return new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 });
    case "mechanical": return new THREE.MeshStandardMaterial({ color: c, metalness: 0.4, roughness: 0.5 });
    default: return new THREE.MeshStandardMaterial({ color: c, metalness: 0.2, roughness: 0.55 });
  }
}
const ghostMat = new THREE.MeshStandardMaterial({ color: 0x7fa6d6, transparent: true, opacity: 0.06, depthWrite: false });

// ------------------------------------------------------------------ the build
let spec = null;
let B = null;           // { root, meshes:[], parts:[], joints:[], wheels:[], rotors:[], wires:[], screens:[], leds:[], update(t,dt), size }

function newBuild() {
  if (B?.root) { scene.remove(B.root); B.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); [].concat(o.material).forEach((m) => m !== ghostMat && m.dispose()); } }); }
  for (const l of document.querySelectorAll(".plabel")) l.remove();
  B = { root: new THREE.Group(), meshes: [], items: [], joints: [], wheels: [], rotors: [], wires: [], screens: [], leds: [], flows: [], anchors: {}, motion: null };
  scene.add(B.root);
  return B;
}

/** one part of the build: a mesh in a layer, linked to a parts-list entry (bom index) */
function mk(layer, geom, { color, pos, rot, parent, bom = -1, name = "", cast = true } = {}) {
  const m = new THREE.Mesh(geom, mat(layer, color));
  if (pos) m.position.copy(pos);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  m.castShadow = cast; m.receiveShadow = true;
  m.userData = { layer, bom, name, baseMat: m.material };
  (parent || B.root).add(m);
  B.meshes.push(m);
  return m;
}
function group(parent, pos, name = "") { const g = new THREE.Group(); g.name = name; if (pos) g.position.copy(pos); (parent || B.root).add(g); return g; }
const box = (x, y, z, r = 0) => (r > 0 ? new RoundedBoxGeometry(x, y, z, 3, Math.min(r, x / 2, y / 2, z / 2)) : new THREE.BoxGeometry(x, y, z));
const cyl = (r1, r2, h, s = 24) => new THREE.CylinderGeometry(r1, r2, h, s);

/** find the parts-list entry for something we're drawing */
function bomFor(layer, rx) {
  const P = spec.parts;
  let i = P.findIndex((p) => p.layer === layer && rx && rx.test(p.name + " " + p.spec + " " + p.mount));
  if (i < 0) i = P.findIndex((p) => p.layer === layer);
  return i;
}

// ---- building blocks: a hobby servo, a board, a battery, a motor, a wheel...
function servo(parent, pos, { s = 1, bom, axis = "x", name = "Servo" } = {}) {
  const g = group(parent, pos, name);
  const body = mk("actuator", box(0.42 * s, 0.22 * s, 0.4 * s, 0.03 * s), { parent: g, bom, name, color: "#1d3f86" });
  mk("actuator", box(0.56 * s, 0.03 * s, 0.4 * s), { parent: g, bom, name, color: "#183570", pos: V3(0, 0.06 * s, 0) });            // mounting tabs
  const horn = mk("mechanical", cyl(0.09 * s, 0.09 * s, 0.05 * s, 16), { parent: g, bom, name: name + " horn", color: "#f2f2f2", pos: V3(0.12 * s, 0.14 * s, 0) });
  if (axis === "x") { g.rotation.z = Math.PI / 2; }
  return { g, body, horn };
}
function board(parent, pos, w, d, { bom, name = "Board", color = "#1f7a4a", chips = 3 } = {}) {
  const g = group(parent, pos, name);
  mk("electronics", box(w, 0.04, d), { parent: g, bom, name, color });
  for (let i = 0; i < chips; i++) mk("electronics", box(w * 0.22, 0.05, d * 0.28), { parent: g, bom, name, color: "#16181c", pos: V3((i - (chips - 1) / 2) * w * 0.3, 0.045, (i % 2 ? 0.12 : -0.1) * d) });
  mk("electronics", box(w * 0.8, 0.06, 0.04), { parent: g, bom, name, color: "#222", pos: V3(0, 0.05, d / 2 - 0.04) });              // pin header
  const led = mk("electronics", box(0.04, 0.03, 0.04), { parent: g, bom, name: name + " LED", color: "#ff4040", pos: V3(w / 2 - 0.08, 0.04, -d / 2 + 0.08) });
  B.leds.push(led);
  return g;
}
function battery(parent, pos, w, h, d, { bom, name = "Battery" } = {}) {
  const g = group(parent, pos, name);
  mk("power", box(w, h, d, 0.02), { parent: g, bom, name, color: "#f0b429" });
  mk("power", box(w * 1.01, h * 1.02, d * 0.18), { parent: g, bom, name, color: "#22252a", pos: V3(0, 0, d * 0.25) });
  return g;
}
function motorCan(parent, pos, r, len, { bom, name = "Motor", color = "#c9ccd1", axis = "x" } = {}) {
  const g = group(parent, pos, name);
  const m = mk("actuator", cyl(r, r, len), { parent: g, bom, name, color });
  mk("actuator", cyl(r * 0.2, r * 0.2, len * 0.4, 10), { parent: g, bom, name: name + " shaft", color: "#ddd", pos: V3(0, len * 0.6, 0) });
  if (axis === "x") g.rotation.z = Math.PI / 2;
  return { g, m };
}
function bracket(parent, from, to, w, { bom, name = "Link" } = {}) {      // a metal link between two points (parent space)
  const d = to.clone().sub(from), len = d.length();
  const m = mk("frame", box(w, len, w * 0.35), { parent, bom, name, pos: from.clone().add(to).multiplyScalar(0.5) });
  m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
  return m;
}
function cover(parent, from, to, r, { bom, name = "Shell", color } = {}) {   // an exoskeleton cover around a link
  const d = to.clone().sub(from), len = d.length();
  const m = mk("shell", new THREE.CapsuleGeometry(r, Math.max(0.01, len - r), 6, 14), { parent, bom, name, color, pos: from.clone().add(to).multiplyScalar(0.5) });
  m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
  return m;
}

// ------------------------------------------------------------------ body plans
const T = {};

/** a leg: hip servo -> upper link -> knee servo -> lower link -> foot. Returns {hip, knee} groups to animate. */
function leg(parent, at, { up = 1, low = 1, s = 1, outward = 0, bomS, bomF, bomSh, color, name = "Leg" }) {
  const hip = group(parent, at, name + " hip");
  servo(hip, V3(0, 0, 0), { s: 0.8 * s, bom: bomS, name: name + " hip servo" });
  const kneeAt = V3(outward * up * 0.6, -up, 0);
  bracket(hip, V3(0, -0.1 * s, 0), kneeAt, 0.12 * s, { bom: bomF, name: name + " upper link" });
  cover(hip, V3(0, -0.12 * s, 0), kneeAt, 0.16 * s, { bom: bomSh, name: name + " thigh cover", color });
  const knee = group(hip, kneeAt, name + " knee");
  servo(knee, V3(0, 0, 0), { s: 0.7 * s, bom: bomS, name: name + " knee servo" });
  const foot = V3(outward * low * 0.2, -low, 0);
  bracket(knee, V3(0, -0.05, 0), foot, 0.1 * s, { bom: bomF, name: name + " lower link" });
  cover(knee, V3(0, -0.08, 0), foot.clone().multiplyScalar(0.92), 0.11 * s, { bom: bomSh, name: name + " shin cover", color });
  mk("mechanical", new THREE.SphereGeometry(0.13 * s, 14, 10), { parent: knee, name: name + " rubber foot", color: "#22252a", pos: foot });
  return { hip, knee };
}

function legged(P, { legs, tall = 1, bodyL = 3, bodyW = 1.5, bodyH = 0.8, head = "dog", tail = true, arms = false, upright = false }) {
  const s = P.scale, col = P.color;
  const bS = bomFor("actuator", /leg|hip|knee|mg996|servo/i), bF = bomFor("frame"), bSh = bomFor("shell");
  const up = (upright ? 1.4 : 1) * tall * s, low = (upright ? 1.4 : 1.05) * tall * s;
  const L = bodyL * s * P.length, W = bodyW * s, H = bodyH * s;
  const body = group(B.root, V3(0, up + low + 0.2 * s + (upright ? H * 0.5 : 0), 0), "Body");
  B.body = body; B.bodyY = body.position.y;
  // frame plates, then the shell around them
  const bw = upright ? W : W, bl = upright ? W * 0.7 : L;
  mk("frame", box(bw * 0.9, 0.06 * s, bl * 0.9), { parent: body, bom: bF, name: "Bottom plate", pos: V3(0, -H * 0.42, 0) });
  mk("frame", box(bw * 0.9, 0.06 * s, bl * 0.9), { parent: body, bom: bF, name: "Top plate", pos: V3(0, H * 0.42, 0) });
  for (const x of [-1, 1]) for (const z of [-1, 1]) mk("frame", cyl(0.04 * s, 0.04 * s, H * 0.84, 8), { parent: body, bom: bF, name: "Standoff", pos: V3(x * bw * 0.4, 0, z * bl * 0.4) });
  const shellH = upright ? H * 2.2 : H;
  mk("shell", box(bw * 1.04, shellH, bl * 1.04, 0.25 * s), { parent: body, bom: bSh, name: "Body shell", color: col, pos: V3(0, upright ? H * 0.6 : 0, 0) });
  B.anchors.body = { parent: body, at: V3(0, -H * 0.15, 0), w: bw * 0.8, d: bl * 0.8, slots: 0 };
  B.anchors.back = { parent: body, at: V3(0, H * 0.48 + (upright ? H * 1.2 : 0), upright ? -0.1 : -bl * 0.2), w: bw * 0.7, d: bl * 0.4, slots: 0, top: true };
  B.anchors.front = { parent: body, at: V3(0, 0, bl * 0.53), w: bw * 0.6, d: 0.2, slots: 0, face: true };
  // legs
  const n = legs, list = [];
  if (upright) {
    for (const side of [-1, 1]) list.push(leg(body, V3(side * W * 0.3, -H * 0.5, 0), { up, low, s, bomS: bS, bomF: bF, bomSh: bSh, color: col, name: side < 0 ? "Left leg" : "Right leg" }));
  } else if (n >= 6) {
    const per = n / 2;
    for (let i = 0; i < per; i++) for (const side of [-1, 1]) {
      const z = (i - (per - 1) / 2) * (bl * 0.8 / Math.max(1, per - 1));
      const lg = leg(body, V3(side * bw * 0.52, -H * 0.2, z), { up: up * 0.8, low: low * 1.05, s: s * 0.8, outward: side * 0.9, bomS: bS, bomF: bF, bomSh: bSh, color: col, name: `Leg ${list.length + 1}` });
      lg.side = side; lg.row = i; list.push(lg);
    }
  } else {
    for (const z of [1, -1]) for (const side of [-1, 1]) list.push(leg(body, V3(side * bw * 0.42, -H * 0.45, z * bl * 0.36), { up, low, s, bomS: bS, bomF: bF, bomSh: bSh, color: col, name: `${z > 0 ? "Front" : "Back"} ${side < 0 ? "left" : "right"} leg` }));
  }
  B.legs = list;
  for (const l of list) B.joints.push({ name: l.hip.name, obj: l.hip, axis: n >= 6 && !upright ? "y" : "x" }, { name: l.knee.name, obj: l.knee, axis: n >= 6 && !upright ? "z" : "x" });
  // head
  const bHead = bomFor("actuator", /head|neck|pan|sg90|micro/i);
  const headAt = upright ? V3(0, H * 1.75, 0) : V3(0, H * 0.45, bl * 0.55);
  const neck = group(body, headAt, "Neck");
  servo(neck, V3(0, 0, 0), { s: 0.55 * s, bom: bHead, name: "Neck servo", axis: "y" });
  B.joints.push({ name: "Neck", obj: neck, axis: "y" });
  B.neck = neck;
  const hs = (upright ? 0.9 : 0.8) * s;
  const headShell = mk("shell", box(hs * 1.1, hs * 0.9, hs * (head === "bird" ? 0.9 : 1.2), 0.25 * hs), { parent: neck, bom: bSh, name: "Head shell", color: col, pos: V3(0, hs * 0.55, upright ? 0 : hs * 0.35) });
  const face = upright ? V3(0, hs * 0.6, hs * 0.55) : V3(0, hs * 0.55, hs * 0.97);
  B.anchors.head = { parent: neck, at: face, w: hs * 0.8, d: 0.1, slots: 0, face: true };
  if (head === "dog") {
    for (const x of [-1, 1]) mk("shell", new THREE.ConeGeometry(hs * 0.18, hs * 0.45, 4), { parent: neck, bom: bSh, name: "Ear", color: P.accent, pos: V3(x * hs * 0.35, hs * 1.1, hs * 0.2), rot: [0, 0, x * -0.2] });
    mk("shell", box(hs * 0.6, hs * 0.4, hs * 0.5, 0.1 * hs), { parent: neck, bom: bSh, name: "Snout", color: col, pos: V3(0, hs * 0.35, hs * 1.05) });
    mk("mechanical", new THREE.SphereGeometry(hs * 0.09, 10, 8), { parent: neck, name: "Nose", color: "#111", pos: V3(0, hs * 0.48, hs * 1.3) });
  } else if (head === "bird") {
    mk("shell", new THREE.ConeGeometry(hs * 0.15, hs * 0.6, 8), { parent: neck, bom: bSh, name: "Beak", color: "#f0b429", pos: V3(0, hs * 0.5, hs * 0.85), rot: [Math.PI / 2, 0, 0] });
  }
  // eyes (animatronic: a sphere with an iris)
  for (const x of [-1, 1]) {
    const eye = mk("mechanical", new THREE.SphereGeometry(hs * 0.13, 16, 12), { parent: neck, name: "Animatronic eye", color: "#f4f4f4", pos: V3(x * hs * 0.25, face.y + hs * 0.08, face.z + 0.01) });
    mk("mechanical", new THREE.SphereGeometry(hs * 0.065, 12, 10), { parent: eye, name: "Iris", color: "#1b6bd6", pos: V3(0, 0, hs * 0.09) });
    B.leds.push(eye);
  }
  if (tail && !upright) {
    const t = group(body, V3(0, H * 0.3, -bl * 0.53), "Tail");
    servo(t, V3(0, 0, 0), { s: 0.45 * s, bom: bHead, name: "Tail servo", axis: "y" });
    cover(t, V3(0, 0.05, -0.1), V3(0, 0.5 * s, -0.9 * s), 0.08 * s, { bom: bSh, name: "Tail", color: P.accent });
    B.tail = t; B.joints.push({ name: "Tail", obj: t, axis: "y" });
  }
  if (arms) {
    B.arms = [];
    for (const side of [-1, 1]) {
      const sh = group(body, V3(side * (W * 0.62), H * 1.3, 0), side < 0 ? "Left shoulder" : "Right shoulder");
      servo(sh, V3(0, 0, 0), { s: 0.55 * s, bom: bomFor("actuator", /arm|shoulder|mg90/i), name: "Shoulder servo" });
      const el2 = V3(side * 0.1, -0.9 * s, 0);
      cover(sh, V3(0, -0.1, 0), el2, 0.13 * s, { bom: bSh, name: "Upper arm", color: col });
      const elbow = group(sh, el2, "Elbow");
      servo(elbow, V3(0, 0, 0), { s: 0.45 * s, bom: bomFor("actuator", /arm|elbow|mg90/i), name: "Elbow servo" });
      cover(elbow, V3(0, -0.05, 0), V3(0, -0.8 * s, 0.1), 0.11 * s, { bom: bSh, name: "Forearm", color: col });
      mk("mechanical", new THREE.SphereGeometry(0.13 * s, 12, 10), { parent: elbow, name: "Hand", color: P.accent, pos: V3(0, -0.9 * s, 0.12) });
      B.arms.push({ sh, elbow, side });
      B.joints.push({ name: sh.name, obj: sh, axis: "x" }, { name: (side < 0 ? "Left" : "Right") + " elbow", obj: elbow, axis: "x" });
    }
  }
  B.motion = "walk";
  B.gait = n >= 6 && !upright ? "tripod" : upright ? "biped" : "trot";
  B.size = Math.max(L, (up + low) * 1.8) + 1;
}

T.quadruped = (P) => legged(P, { legs: 4, head: /cat|horse|cow|lion|tiger/i.test(spec.name) ? "dog" : "dog", tail: true });
T.hexapod = (P) => legged(P, { legs: Math.max(6, P.legs % 2 ? P.legs + 1 : P.legs), bodyL: 2.6, bodyW: 1.6, bodyH: 0.5, head: "none", tail: false, tall: 0.8 });
T.biped = (P) => legged(P, { legs: 2, upright: true, bodyW: 1.4, bodyH: 0.7, head: /bird|chicken|ostrich|penguin/i.test(spec.name) ? "bird" : "none", tail: /dino|rex|raptor/i.test(spec.name), tall: 0.9 });
T.humanoid = (P) => legged(P, { legs: 2, upright: true, bodyW: 1.3, bodyH: 0.8, head: "human", tail: false, arms: true, tall: 1 });

T.wheeled = (P, tracked = false) => {
  const s = P.scale, L = 3 * s * P.length, W = 1.9 * s, col = P.color;
  const body = group(B.root, V3(0, 0.75 * s, 0), "Chassis"); B.body = body; B.bodyY = body.position.y;
  const bF = bomFor("frame"), bM = bomFor("actuator", /motor/i), bSh = bomFor("shell");
  mk("frame", box(W, 0.06 * s, L), { parent: body, bom: bF, name: "Lower deck", color: tracked ? "#5a6168" : "#e8f2ff" });
  mk("frame", box(W * 0.9, 0.06 * s, L * 0.85), { parent: body, bom: bF, name: "Upper deck", pos: V3(0, 0.55 * s, -0.1 * s), color: tracked ? "#5a6168" : "#e8f2ff" });
  for (const x of [-1, 1]) for (const z of [-1, 1]) mk("frame", cyl(0.04 * s, 0.04 * s, 0.5 * s, 8), { parent: body, bom: bF, name: "Standoff", pos: V3(x * W * 0.4, 0.28 * s, z * L * 0.38) });
  const shell = mk("shell", box(W * 1.02, 0.5 * s, L * 0.7, 0.2 * s), { parent: body, bom: bSh, name: "Top shell", color: col, pos: V3(0, 0.9 * s, -0.1 * s) });
  if (bSh < 0) shell.userData.layer = "shell";
  B.anchors.body = { parent: body, at: V3(0, 0.06 * s, 0), w: W * 0.75, d: L * 0.7, slots: 0 };
  B.anchors.back = { parent: body, at: V3(0, 0.6 * s, -L * 0.25), w: W * 0.6, d: L * 0.3, slots: 0, top: true };
  B.anchors.front = { parent: body, at: V3(0, 0.25 * s, L / 2 + 0.05), w: W * 0.7, d: 0.1, slots: 0, face: true };
  B.anchors.head = B.anchors.front;
  if (tracked) {
    for (const x of [-1, 1]) {
      const tr = group(body, V3(x * (W / 2 + 0.3 * s), -0.1 * s, 0), "Track");
      mk("mechanical", box(0.5 * s, 0.9 * s, L * 1.05, 0.42 * s), { parent: tr, bom: bomFor("mechanical", /track/i), name: "Rubber track", color: "#1b1d20" });
      for (let i = 0; i < 2; i++) { const sp = mk("mechanical", cyl(0.38 * s, 0.38 * s, 0.52 * s, 12), { parent: tr, name: "Sprocket", color: "#7c858f", pos: V3(0, 0, (i ? 1 : -1) * L * 0.42), rot: [0, 0, Math.PI / 2] }); B.wheels.push({ obj: sp, r: 0.38 * s, axis: "y" }); }
      const mo = motorCan(body, V3(x * W * 0.35, 0.15 * s, L * 0.35), 0.2 * s, 0.6 * s, { bom: bM, name: "Drive motor" });
      B.joints.push({ name: x < 0 ? "Left track motor" : "Right track motor", obj: mo.g, axis: "rpm" });
    }
  } else {
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const w = group(body, V3(x * (W / 2 + 0.2 * s), -0.1 * s, z * L * 0.32), "Wheel");
      const tyre = mk("mechanical", cyl(0.55 * s, 0.55 * s, 0.32 * s, 28), { parent: w, bom: bomFor("actuator", /wheel|motor/i), name: "Wheel + tyre", color: "#1b1d20", rot: [0, 0, Math.PI / 2] });
      mk("mechanical", cyl(0.3 * s, 0.3 * s, 0.34 * s, 6), { parent: tyre, name: "Hub", color: "#f0c22a" });
      B.wheels.push({ obj: tyre, r: 0.55 * s, axis: "y" });
      mk("actuator", box(0.45 * s, 0.32 * s, 0.75 * s, 0.04 * s), { parent: body, bom: bM, name: "Gear motor", color: "#f0c22a", pos: V3(x * W * 0.32, -0.12 * s, z * L * 0.32) });
    }
    B.joints.push({ name: "Left motors", obj: body, axis: "rpm" }, { name: "Right motors", obj: body, axis: "rpm" });
  }
  B.motion = "drive"; B.size = L + 2;
};
T.tracked = (P) => T.wheeled(P, true);

T.arm = (P) => {
  const s = P.scale, col = P.color, bF = bomFor("frame"), bBig = bomFor("actuator", /mg996|base|shoulder/i), bSm = bomFor("actuator", /mg90|wrist|grip/i);
  const base = group(B.root, V3(0, 0, 0), "Base"); B.body = base; B.bodyY = 0;
  mk("shell", cyl(1.1 * s, 1.25 * s, 0.4 * s, 32), { parent: base, bom: bomFor("shell"), name: "Base housing", color: col, pos: V3(0, 0.2 * s, 0) });
  B.anchors.base = { parent: base, at: V3(0, 0.02, 0.6 * s), w: 1.2 * s, d: 0.6 * s, slots: 0 };
  B.anchors.body = B.anchors.base;
  const turn = group(base, V3(0, 0.42 * s, 0), "Turntable");
  servo(turn, V3(0, -0.05 * s, 0), { s: 0.9 * s, bom: bBig, name: "Base servo", axis: "y" });
  mk("frame", cyl(0.75 * s, 0.75 * s, 0.1 * s, 32), { parent: turn, bom: bF, name: "Turntable plate", pos: V3(0, 0.12 * s, 0) });
  const shoulder = group(turn, V3(0, 0.45 * s, 0), "Shoulder");
  servo(shoulder, V3(0, 0, 0), { s: 0.9 * s, bom: bBig, name: "Shoulder servo" });
  bracket(shoulder, V3(0, 0, 0), V3(0, 2 * s, 0), 0.22 * s, { bom: bF, name: "Upper arm" });
  cover(shoulder, V3(0, 0.15, 0), V3(0, 1.9 * s, 0), 0.2 * s, { bom: bomFor("shell"), name: "Upper arm cover", color: col });
  const elbow = group(shoulder, V3(0, 2 * s, 0), "Elbow");
  servo(elbow, V3(0, 0, 0), { s: 0.8 * s, bom: bBig, name: "Elbow servo" });
  bracket(elbow, V3(0, 0, 0), V3(0, 1.6 * s, 0), 0.18 * s, { bom: bF, name: "Forearm" });
  const wrist = group(elbow, V3(0, 1.6 * s, 0), "Wrist");
  servo(wrist, V3(0, 0, 0), { s: 0.55 * s, bom: bSm, name: "Wrist servo" });
  const grip = group(wrist, V3(0, 0.35 * s, 0), "Gripper");
  servo(grip, V3(0, 0, 0), { s: 0.45 * s, bom: bSm, name: "Gripper servo", axis: "y" });
  const fingers = [];
  for (const x of [-1, 1]) { const f = group(grip, V3(x * 0.18 * s, 0.15 * s, 0), "Finger"); mk("frame", box(0.08 * s, 0.6 * s, 0.22 * s), { parent: f, bom: bF, name: "Finger", pos: V3(0, 0.3 * s, 0) }); fingers.push({ f, x }); }
  const cube = mk("mechanical", box(0.4 * s, 0.4 * s, 0.4 * s), { name: "Test block", color: P.accent, pos: V3(2.2 * s, 0.2 * s, 0.6 * s) });
  Object.assign(B, { turn, shoulder, elbow, wrist, grip, fingers, cube, motion: "arm", size: 6 * s });
  B.joints.push({ name: "Base", obj: turn, axis: "y" }, { name: "Shoulder", obj: shoulder, axis: "x" }, { name: "Elbow", obj: elbow, axis: "x" }, { name: "Wrist", obj: wrist, axis: "x" }, { name: "Gripper", obj: fingers[0].f, axis: "z" });
};

T.drone = (P) => {
  const s = P.scale, col = P.color, bF = bomFor("frame"), bM = bomFor("actuator", /motor/i);
  const body = group(B.root, V3(0, 0.6 * s, 0), "Body"); B.body = body; B.bodyY = body.position.y;
  mk("frame", box(1.1 * s, 0.05 * s, 1.5 * s), { parent: body, bom: bF, name: "Bottom plate", color: "#202327" });
  mk("frame", box(1.1 * s, 0.05 * s, 1.5 * s), { parent: body, bom: bF, name: "Top plate", color: "#202327", pos: V3(0, 0.45 * s, 0) });
  mk("shell", box(1.0 * s, 0.35 * s, 1.2 * s, 0.12 * s), { parent: body, bom: bomFor("shell"), name: "Canopy", color: col, pos: V3(0, 0.75 * s, 0.1 * s) });
  B.anchors.body = { parent: body, at: V3(0, 0.05 * s, 0), w: 0.8 * s, d: 1.1 * s, slots: 0 };
  B.anchors.back = { parent: body, at: V3(0, 0.95 * s, -0.2 * s), w: 0.8 * s, d: 0.8 * s, slots: 0, top: true };
  B.anchors.front = { parent: body, at: V3(0, 0.25 * s, 0.8 * s), w: 0.6, d: 0.1, slots: 0, face: true };
  B.anchors.head = B.anchors.front;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2, R = 2.1 * s;
    const end = V3(Math.cos(a) * R, 0.02, Math.sin(a) * R);
    bracket(body, V3(0, 0.02, 0), end, 0.22 * s, { bom: bF, name: "Carbon arm" }).rotation.z += 0;
    const mo = motorCan(body, end.clone().add(V3(0, 0.18 * s, 0)), 0.22 * s, 0.32 * s, { bom: bM, name: `Motor ${i + 1}`, axis: "y", color: "#d64545" });
    const prop = group(mo.g, V3(0, 0.3 * s, 0), "Propeller");
    for (let b = 0; b < 3; b++) { const bl = mk("mechanical", box(1.2 * s, 0.02 * s, 0.16 * s), { parent: prop, bom: bomFor("mechanical", /prop/i), name: "Propeller", color: i % 2 ? "#e9ecef" : P.accent, pos: V3(0.6 * s, 0, 0) }); bl.parent.remove(bl); const pv = group(prop); pv.rotation.y = b * Math.PI * 2 / 3; pv.add(bl); }
    B.rotors.push({ obj: prop, dir: i % 2 ? 1 : -1 });
    B.joints.push({ name: `Motor ${i + 1}`, obj: prop, axis: "rpm" });
  }
  B.motion = "fly"; B.size = 6 * s;
};

T.snake = (P) => {
  const s = P.scale, col = P.color, n = 9, seg = 0.8 * s;
  const head = group(B.root, V3(0, 0.35 * s, seg * n / 2), "Head"); B.body = head; B.bodyY = head.position.y;
  mk("shell", new THREE.SphereGeometry(0.42 * s, 18, 14), { parent: head, bom: bomFor("shell"), name: "Head shell", color: col, pos: V3(0, 0, 0.2 * s) });
  for (const x of [-1, 1]) mk("mechanical", new THREE.SphereGeometry(0.08 * s, 10, 8), { parent: head, name: "Eye", color: "#ffdd33", pos: V3(x * 0.22 * s, 0.2 * s, 0.5 * s) });
  B.anchors.head = { parent: head, at: V3(0, 0.05, 0), w: 0.5 * s, d: 0.4 * s, slots: 0 };
  B.anchors.body = B.anchors.head;
  let parent = head; B.segs = [];
  for (let i = 0; i < n; i++) {
    const j = group(parent, V3(0, 0, i === 0 ? -0.2 * s : -seg), `Joint ${i + 1}`);
    servo(j, V3(0, 0, 0), { s: 0.45 * s, bom: bomFor("actuator"), name: `Segment servo ${i + 1}`, axis: "y" });
    mk("shell", box(0.6 * s * (1 - i * 0.05), 0.42 * s * (1 - i * 0.04), seg * 0.9, 0.15 * s), { parent: j, bom: bomFor("shell"), name: "Segment shell", color: i % 2 ? col : P.accent, pos: V3(0, 0, -seg / 2) });
    B.segs.push(j); B.joints.push({ name: j.name, obj: j, axis: "y" });
    parent = j;
  }
  B.motion = "slither"; B.size = seg * n + 2;
};

T.fish = (P) => {
  const s = P.scale, col = P.color;
  const body = group(B.root, V3(0, 2.2 * s, 0), "Hull"); B.body = body; B.bodyY = body.position.y;
  const hull = mk("shell", new THREE.SphereGeometry(1, 28, 18), { parent: body, bom: bomFor("shell"), name: "Waterproof hull", color: col });
  hull.scale.set(0.8 * s, 0.9 * s, 1.8 * s);
  B.anchors.body = { parent: body, at: V3(0, -0.2 * s, 0), w: 0.7 * s, d: 1.6 * s, slots: 0 };
  for (const x of [-1, 1]) mk("mechanical", new THREE.SphereGeometry(0.12 * s, 10, 8), { parent: body, name: "Eye", color: "#111", pos: V3(x * 0.55 * s, 0.25 * s, 1.35 * s) });
  const t1 = group(body, V3(0, 0, -1.7 * s), "Tail joint 1");
  servo(t1, V3(0, 0, 0), { s: 0.6 * s, bom: bomFor("actuator", /tail/i), name: "Tail servo 1", axis: "y" });
  mk("shell", box(0.35 * s, 0.9 * s, 0.9 * s, 0.15 * s), { parent: t1, bom: bomFor("shell"), name: "Tail section", color: col, pos: V3(0, 0, -0.45 * s) });
  const t2 = group(t1, V3(0, 0, -0.9 * s), "Tail joint 2");
  servo(t2, V3(0, 0, 0), { s: 0.5 * s, bom: bomFor("actuator", /tail/i), name: "Tail servo 2", axis: "y" });
  const fin = mk("shell", new THREE.ConeGeometry(0.9 * s, 1.0 * s, 3), { parent: t2, bom: bomFor("shell"), name: "Tail fin", color: P.accent, pos: V3(0, 0, -0.5 * s), rot: [-Math.PI / 2, 0, 0] });
  fin.scale.x = 0.2;
  Object.assign(B, { tails: [t1, t2], motion: "swim", size: 6 * s });
  B.joints.push({ name: "Tail 1", obj: t1, axis: "y" }, { name: "Tail 2", obj: t2, axis: "y" });
  water.visible = true;
};

// ---- devices
function screenTexture() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 288;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return { c, ctx: c.getContext("2d"), tex };
}
function drawScreen(S, t, on, kind) {
  const { ctx, c } = S;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, c.width, c.height);
  if (!on) { S.tex.needsUpdate = true; return; }
  if (t < 1.4) {                                             // boot: logo
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, t)})`; ctx.font = "bold 46px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.fillText(spec.name.slice(0, 18), c.width / 2, c.height / 2 + 14);
  } else if (kind === "watch") {
    ctx.fillStyle = "#0b1a2a"; ctx.beginPath(); ctx.arc(256, 144, 140, 0, 7); ctx.fill();
    const d = new Date(); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "bold 70px Nunito, sans-serif";
    ctx.fillText(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`, 256, 160);
    ctx.fillStyle = "#ff5a6e"; ctx.font = "bold 28px Nunito, sans-serif"; ctx.fillText(`♥ ${70 + Math.round(Math.sin(t) * 6)} bpm`, 256, 210);
  } else {                                                   // a moving picture: sky, hills, sun
    const g = ctx.createLinearGradient(0, 0, 0, c.height); g.addColorStop(0, `hsl(${(t * 12) % 360},70%,55%)`); g.addColorStop(1, "#ffd28a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#fff6c0"; ctx.beginPath(); ctx.arc(380 + Math.sin(t * 0.3) * 40, 80, 32, 0, 7); ctx.fill();
    for (let k = 0; k < 3; k++) { ctx.fillStyle = ["#2f8f5a", "#257a4b", "#1c6440"][k]; ctx.beginPath(); ctx.moveTo(0, c.height);
      for (let x = 0; x <= c.width; x += 16) ctx.lineTo(x, 190 + k * 30 + Math.sin(x * 0.012 + t * (0.4 + k * 0.3) + k) * 22); ctx.lineTo(c.width, c.height); ctx.fill(); }
  }
  S.tex.needsUpdate = true;
}

function devicePanel(P) {
  const portrait = /phone|tablet|e-?reader|kiosk/i.test(spec.name + spec.prompt);
  const diag = clamp(P.screen_inches, 4, 100) * 0.0254 * (P.screen_inches < 15 ? 12 : 4.4);   // shown big enough to look at
  let w = diag * 0.8716, h = diag * 0.4903; if (portrait) [w, h] = [h * 0.9, w * 0.9];
  const depth = portrait ? 0.12 * diag : 0.06 * diag + 0.25;
  const tv = group(B.root, V3(0, h / 2 + (portrait ? 0.4 : 0.9), 0), "Device"); B.body = tv; B.bodyY = tv.position.y;
  const S = screenTexture();
  const screen = mk("display", box(w, h, 0.04), { parent: tv, bom: bomFor("display", /panel|screen|display|lcd|oled|amoled/i), name: "Display panel", pos: V3(0, 0, depth / 2) });
  screen.material = new THREE.MeshStandardMaterial({ map: S.tex, emissiveMap: S.tex, emissive: 0xffffff, emissiveIntensity: 0, color: 0x050608, roughness: 0.2 });
  screen.userData.baseMat = screen.material;
  B.screens.push({ mesh: screen, S, kind: "panel" });
  // backlight strips behind the panel
  const bl = bomFor("display", /backlight|led strip/i);
  for (let i = 0; i < 6; i++) { const strip = mk("display", box(w * 0.92, 0.03, 0.03), { parent: tv, bom: bl, name: "LED backlight strip", color: "#ffffff", pos: V3(0, -h * 0.42 + i * h * 0.168, depth / 2 - 0.08) }); B.leds.push(strip); }
  mk("frame", box(w * 0.96, h * 0.96, 0.03), { parent: tv, bom: bomFor("frame"), name: "Metal back frame", pos: V3(0, 0, -depth * 0.05) });
  mk("shell", box(w + 0.08, h + 0.08, depth, 0.05), { parent: tv, bom: bomFor("shell"), name: "Back cover + bezel", color: P.color, pos: V3(0, 0, -0.02) }).scale.z = 1;
  // stand
  if (!portrait) {
    mk("frame", box(0.25, 0.8, 0.12), { parent: tv, bom: bomFor("frame", /stand/i), name: "Stand neck", pos: V3(0, -h / 2 - 0.35, -0.05) });
    mk("frame", box(w * 0.4, 0.06, 0.9, 0.03), { parent: B.root, bom: bomFor("frame", /stand/i), name: "Stand foot", pos: V3(0, 0.03, -0.05) });
  }
  B.anchors.inside = { parent: tv, at: V3(0, 0, -depth * 0.25), w: w * 0.8, d: h * 0.8, slots: 0, wall: true };
  B.anchors.front = { parent: tv, at: V3(w * 0.35, -h / 2 - 0.02, depth / 2), w: 0.4, d: 0.05, slots: 0, face: true };
  B.anchors.base = B.anchors.front; B.anchors.screen = B.anchors.inside; B.anchors.body = B.anchors.inside;
  B.motion = "screen"; B.size = Math.max(w, h) + 2;
}
function deviceBox(P) {
  const w = 3.2 * P.scale, h = 1.4 * P.scale, d = 2.2 * P.scale;
  const g = group(B.root, V3(0, h / 2 + 0.02, 0), "Device"); B.body = g; B.bodyY = g.position.y;
  const sh = mk("shell", box(w, h, d, 0.12), { parent: g, bom: bomFor("shell"), name: "Enclosure", color: P.color });
  sh.material.transparent = true; sh.material.opacity = 0.96;
  mk("frame", box(w * 0.94, 0.04, d * 0.94), { parent: g, bom: bomFor("frame"), name: "Base plate", pos: V3(0, -h / 2 + 0.06, 0) });
  B.anchors.inside = { parent: g, at: V3(0, -h / 2 + 0.1, 0), w: w * 0.8, d: d * 0.8, slots: 0 };
  B.anchors.front = { parent: g, at: V3(0, 0, d / 2 + 0.01), w: w * 0.8, d: 0.05, slots: 0, face: true };
  B.anchors.body = B.anchors.inside; B.anchors.base = B.anchors.inside; B.anchors.screen = B.anchors.front;
  B.motion = "power"; B.size = w + 2;
}
function deviceCylinder(P) {
  const r = 0.9 * P.scale, h = 2.4 * P.scale;
  const g = group(B.root, V3(0, h / 2, 0), "Device"); B.body = g; B.bodyY = g.position.y;
  const sh = mk("shell", cyl(r, r * 1.05, h, 40), { parent: g, bom: bomFor("shell"), name: "Shell", color: P.color });
  sh.material.transparent = true; sh.material.opacity = 0.95;
  const ring = mk("display", new THREE.TorusGeometry(r * 0.85, 0.06, 10, 48), { parent: g, bom: bomFor("display", /ring|led/i), name: "LED ring", color: "#3fd0ff", pos: V3(0, h / 2 + 0.02, 0), rot: [Math.PI / 2, 0, 0] });
  B.leds.push(ring); B.ring = ring;
  B.anchors.inside = { parent: g, at: V3(0, -h / 2 + 0.1, 0), w: r * 1.1, d: r * 1.1, slots: 0, stack: true };
  B.anchors.body = B.anchors.inside; B.anchors.front = B.anchors.inside; B.anchors.base = B.anchors.inside; B.anchors.screen = B.anchors.inside;
  B.motion = "power"; B.size = 5;
}
function deviceFan(P) {
  const s = P.scale;
  const base = group(B.root, V3(0, 0, 0), "Fan"); B.body = base; B.bodyY = 0;
  mk("frame", cyl(1.1 * s, 1.2 * s, 0.25 * s, 32), { parent: base, bom: bomFor("frame", /stand|base/i), name: "Base", color: P.color, pos: V3(0, 0.12 * s, 0) });
  mk("frame", cyl(0.1 * s, 0.1 * s, 3.2 * s, 12), { parent: base, bom: bomFor("frame"), name: "Pole", pos: V3(0, 1.8 * s, 0) });
  const head = group(base, V3(0, 3.5 * s, 0), "Head");
  motorCan(head, V3(0, 0, -0.35 * s), 0.45 * s, 0.7 * s, { bom: bomFor("actuator"), name: "Fan motor", axis: "z", color: P.color }).g.rotation.x = Math.PI / 2;
  const blades = group(head, V3(0, 0, 0.25 * s), "Blades");
  for (let b = 0; b < 5; b++) { const pv = group(blades); pv.rotation.z = b * Math.PI * 2 / 5; const bl = mk("mechanical", box(0.5 * s, 1.2 * s, 0.03 * s, 0.01), { parent: pv, bom: bomFor("mechanical", /blade/i), name: "Blade", color: "#9fd3ff", pos: V3(0, 0.7 * s, 0), rot: [0, 0.4, 0] }); bl.material.transparent = true; bl.material.opacity = 0.85; }
  for (let i = 1; i <= 4; i++) mk("shell", new THREE.TorusGeometry(i * 0.42 * s, 0.015 * s, 6, 48), { parent: head, bom: bomFor("frame", /grille/i), name: "Safety grille", color: "#d0d4d9", pos: V3(0, 0, 0.5 * s) });
  B.rotors.push({ obj: blades, dir: 1, axis: "z" });
  B.joints.push({ name: "Fan motor", obj: blades, axis: "rpm" }, { name: "Oscillation", obj: head, axis: "y" });
  B.head = head;
  B.anchors.base = { parent: base, at: V3(0, 0.26 * s, 0), w: 1.2 * s, d: 1.2 * s, slots: 0, top: true };
  B.anchors.inside = { parent: head, at: V3(0, -0.4 * s, -0.4 * s), w: 0.5, d: 0.5, slots: 0 };
  B.anchors.body = B.anchors.base; B.anchors.front = B.anchors.base;
  B.motion = "spin"; B.size = 6 * s;
}
function deviceWatch(P) {
  const g = group(B.root, V3(0, 1.0, 0), "Watch"); B.body = g; B.bodyY = 1;
  g.rotation.x = -Math.PI / 2 + 0.5;
  const R = 1.2;
  mk("shell", cyl(R, R, 0.45, 48), { parent: g, bom: bomFor("shell"), name: "Case", color: P.color, rot: [Math.PI / 2, 0, 0] });
  const S = screenTexture();
  const scr = mk("display", new THREE.CircleGeometry(R * 0.9, 48), { parent: g, bom: bomFor("display"), name: "AMOLED screen", pos: V3(0, 0, 0.231) });
  scr.material = new THREE.MeshStandardMaterial({ map: S.tex, emissiveMap: S.tex, emissive: 0xffffff, emissiveIntensity: 0, color: 0x050608 }); scr.userData.baseMat = scr.material;
  S.tex.repeat.set(288 / 512, 1); S.tex.offset.set((1 - 288 / 512) / 2, 0);
  B.screens.push({ mesh: scr, S, kind: "watch" });
  for (const y of [-1, 1]) mk("shell", box(1.3, 2.4, 0.12, 0.05), { parent: g, bom: bomFor("shell", /strap/i), name: "Strap", color: P.accent, pos: V3(0, y * 2.2, -0.05) });
  B.anchors.inside = { parent: g, at: V3(0, 0, -0.05), w: R * 1.2, d: R * 1.2, slots: 0, wall: true };
  B.anchors.body = B.anchors.inside; B.anchors.front = B.anchors.inside; B.anchors.screen = B.anchors.inside; B.anchors.base = B.anchors.inside;
  B.motion = "screen"; B.size = 5;
}
T.panel = devicePanel; T.box = deviceBox; T.cylinder = deviceCylinder; T.fan = deviceFan; T.watch = deviceWatch;

// ------------------------------------------------------------------ any design: the AI's own 3D model (parts in mm)
const MM = 0.01;                                    // 1 scene unit = 10 cm
const DEG = THREE.MathUtils.degToRad;

/** one part's look, centred on its group: plain shapes or a real-looking servo / board / battery / motor / wheel / screen */
function partMesh(g, p) {
  const [sx, sy, sz] = p.size.map((v) => Math.max(0.005, v * MM));
  const o = { parent: g, bom: p.bom ?? -1, name: p.name, color: p.color || undefined };
  switch (p.shape) {
    case "servo": { const s = servo(g, V3(), { s: sx / 0.42, bom: o.bom, name: p.name, axis: "none" }); return s.g; }
    case "board": return board(g, V3(), sx, sz, { bom: o.bom, name: p.name, color: p.color || "#1f7a4a", chips: sx > 0.4 ? 3 : 1 });
    case "battery": return battery(g, V3(), sx, sy, sz, { bom: o.bom, name: p.name });
    case "motor": return motorCan(g, V3(), Math.max(sx, sz) / 2, sy, { bom: o.bom, name: p.name, axis: "none", color: p.color || "#c9ccd1" }).g;
    case "wheel": {
      const w = group(g, V3(), p.name);
      const tyre = mk(p.layer === "actuator" ? "actuator" : "mechanical", cyl(sy / 2, sy / 2, sx, 28), { ...o, parent: w, color: p.color || "#1b1d20", rot: [0, 0, Math.PI / 2] });
      mk("mechanical", cyl(sy / 3.6, sy / 3.6, sx * 1.04, 6), { parent: tyre, name: p.name + " hub", color: "#f0c22a" });
      return w;
    }
    case "propeller": {
      const pr = group(g, V3(), p.name);
      for (let b = 0; b < 3; b++) { const pv = group(pr); pv.rotation.y = b * Math.PI * 2 / 3; mk("mechanical", box(sx / 2, Math.max(0.01, sy), Math.max(0.02, sz / 6)), { ...o, parent: pv, pos: V3(sx / 4, 0, 0) }); }
      return pr;
    }
    case "screen": {
      const S = screenTexture();
      const m = mk("display", box(sx, sy, Math.max(0.01, sz)), o);
      m.material = new THREE.MeshStandardMaterial({ map: S.tex, emissiveMap: S.tex, emissive: 0xffffff, emissiveIntensity: 0, color: 0x050608, roughness: 0.2 });
      m.userData.baseMat = m.material;
      B.screens.push({ mesh: m, S, kind: "panel" });
      return m;
    }
    case "sphere": { const m = mk(p.layer, new THREE.SphereGeometry(0.5, 20, 14), o); m.scale.set(sx, sy, sz); return m; }
    case "capsule": return mk(p.layer, new THREE.CapsuleGeometry(Math.min(sx, sz) / 2, Math.max(0.005, sy - Math.min(sx, sz)), 6, 14), o);
    case "cylinder": { const m = mk(p.layer, cyl(0.5, 0.5, 1, 24), o); m.scale.set(sx, sy, sz); return m; }
    case "cone": { const m = mk(p.layer, new THREE.ConeGeometry(0.5, 1, 20), o); m.scale.set(sx, sy, sz); return m; }
    case "torus": return mk(p.layer, new THREE.TorusGeometry(sx / 2, Math.max(0.004, Math.min(sy, sz) / 2), 10, 32), o);
    case "rounded_box": return mk(p.layer, box(sx, sy, sz, Math.min(sx, sy, sz) * 0.25), o);
    default: return mk(p.layer, box(sx, sy, sz), o);
  }
}

T.custom = () => {
  const geo = spec.geometry;
  const byId = Object.fromEntries(geo.parts.map((p) => [p.id, p]));
  const root = group(B.root, V3(), "Model");
  B.body = root;
  const nodes = (B.nodes = {});
  const make = (p) => {
    if (nodes[p.id]) return nodes[p.id];
    const par = p.parent && byId[p.parent] ? make(byId[p.parent]) : root;
    const g = group(par, V3(...p.pos.map((v) => v * MM)), p.name);
    g.rotation.set(...p.rot.map(DEG));
    g.userData.partId = p.id;
    nodes[p.id] = g;
    partMesh(g, p);
    if (["electronics", "power", "sensor", "display"].includes(p.layer)) B.items.push({ obj: g, bom: p.bom ?? -1, layer: p.layer, name: p.name });
    return g;
  };
  geo.parts.forEach(make);
  // stand it on the ground
  B.root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root);
  root.position.y -= bb.min.y;
  B.bodyY = root.position.y;
  B.size = bb.getSize(V3()).length();
  // joints & spinning parts for the simulation
  B.custom = {
    joints: geo.motion.joints.map((j) => ({ ...j, node: nodes[j.id], part: byId[j.id], rest: nodes[j.id]?.rotation.clone() })).filter((j) => j.node && j.part?.joint),
    spins: geo.motion.spin.map((s) => ({ ...s, node: nodes[s.id], axis: byId[s.id].shape === "wheel" ? "x" : byId[s.id].joint?.axis || "y" })).filter((s) => s.node),
  };
  for (const j of B.custom.joints) B.joints.push({ name: j.part.name, obj: j.node, axis: j.part.joint.axis });
  for (const s of B.custom.spins) B.joints.push({ name: s.node.name + " (rpm)", obj: s.node, axis: "rpm" });
  B.motion = spec.motion;
};

/** joints swing with their amplitude and phase; wheels, rotors and fans spin; the floor moves under walkers/drivers */
function simulateCustom(t, dt, tele) {
  const C = B.custom, M = spec.geometry.motion;
  const f = M.speed_hz || 0.9;
  for (const j of C.joints) {
    const ax = j.part.joint.axis;
    let deg = j.offset + j.amp * Math.sin(2 * Math.PI * (f * t + j.phase));
    deg = clamp(deg, j.part.joint.min, j.part.joint.max);
    j.node.rotation[ax] = j.rest[ax] + DEG(deg);
    tele.push([j.part.name, 90 + deg]);
  }
  for (const s of C.spins) {
    const ramp = clamp(t / 1.5, 0, 1);
    s.node.rotation[s.axis] += (s.rpm / 60) * 2 * Math.PI * dt * speed() * ramp * (s.rpm > 3000 ? 0.02 : 1);   // very fast rotors are shown slowed down
    tele.push([`${s.node.name} (rpm)`, s.rpm * ramp, "rpm"]);
  }
  if (B.motion === "fly" && B.body) B.body.position.y = B.bodyY + clamp(t / 2, 0, 1) * (1.5 + Math.sin(t * 1.3) * 0.15);
  if (B.motion === "walk" && B.body) B.body.position.y = B.bodyY + Math.abs(Math.sin(t * f * Math.PI * 2)) * 0.03;
  return (M.forward_mm_s || (["walk", "drive", "slither", "swim"].includes(B.motion) ? 200 : 0)) * MM;
}

// ------------------------------------------------------------------ placing the rest of the parts list
const BUILT_BY_GEOMETRY = /legs|arms|wheels|rotors|joints|segments|tail/;
function placeParts() {
  spec.parts.forEach((p, i) => {
    if (p.layer === "actuator" && BUILT_BY_GEOMETRY.test(p.mount)) return;              // drawn as part of the body plan
    if (p.layer === "shell" || p.layer === "frame") return;                              // the body plan is the shell/frame
    if (p.layer === "mechanical" && /prop|blade|track|wheel|foot/i.test(p.name)) return;
    if (p.layer === "display" && /panel|screen|display|lcd|oled|amoled|backlight/i.test(p.name) && B.screens.length) return;
    if (p.layer === "display" && /ring/i.test(p.name) && B.ring) return;
    const A = B.anchors[p.mount] || B.anchors.body || B.anchors.inside;
    if (!A) return;
    const copies = Math.min(p.qty, /led|button|sensor|speaker/i.test(p.name) ? 3 : 2);
    for (let k = 0; k < copies; k++) placeOne(p, i, A);
  });
}
function slotPos(A) {
  const n = A.slots++;
  if (A.stack) return V3(0, n * 0.32, 0);
  if (A.face) return V3(((n % 4) - 1.5) * Math.min(0.35, A.w / 4), Math.floor(n / 4) * 0.25, 0);
  if (A.wall) return V3(((n % 3) - 1) * A.w * 0.32, (Math.floor(n / 3) % 3 - 1) * A.d * 0.3, 0);
  const cols = 3; return V3(((n % cols) - 1) * A.w * 0.33, A.top ? Math.floor(n / 6) * 0.2 : Math.floor(n / 6) * 0.25, ((Math.floor(n / cols) % 2) - 0.5) * A.d * 0.5);
}
function placeOne(p, i, A) {
  const at = A.at.clone().add(slotPos(A));
  const nm = p.name, sz = clamp((spec.params.scale || 1) * 0.9, 0.5, 2);
  let g;
  if (/battery|lipo|18650|aa\b|cell/i.test(nm)) g = battery(A.parent, at.add(V3(0, 0.12 * sz, 0)), 0.9 * sz, 0.25 * sz, 0.45 * sz, { bom: i, name: nm });
  else if (/speaker/i.test(nm)) { g = group(A.parent, at, nm); const cone = mk("electronics", new THREE.ConeGeometry(0.28 * sz, 0.22 * sz, 20, 1, true), { parent: g, bom: i, name: nm, color: "#2a2d33", rot: A.wall ? [-Math.PI / 2, 0, 0] : [Math.PI, 0, 0] }); mk("electronics", cyl(0.3 * sz, 0.3 * sz, 0.05, 20), { parent: g, bom: i, name: nm, color: "#555" }); B.speakers = (B.speakers || []).concat(cone); }
  else if (/ultrasonic|hc-sr04/i.test(nm)) { g = board(A.parent, at, 0.6 * sz, 0.28 * sz, { bom: i, name: nm, color: "#1b4fa8", chips: 1 }); if (A.face) g.rotation.x = Math.PI / 2; for (const x of [-1, 1]) mk("sensor", cyl(0.1 * sz, 0.1 * sz, 0.16 * sz, 16), { parent: g, bom: i, name: nm + " transducer", color: "#c8ccd2", pos: V3(x * 0.17 * sz, 0.1 * sz, 0) }); }
  else if (/switch|button|knob/i.test(nm)) g = mk(p.layer === "power" ? "power" : "sensor", /knob/i.test(nm) ? cyl(0.1 * sz, 0.1 * sz, 0.12 * sz, 16) : box(0.16 * sz, 0.1 * sz, 0.12 * sz, 0.02), { parent: A.parent, bom: i, name: nm, color: "#d64545", pos: at, rot: A.face ? [Math.PI / 2, 0, 0] : null });
  else if (/\bled|ir receiver|lamp/i.test(nm) && p.layer !== "electronics") { g = mk(p.layer, new THREE.SphereGeometry(0.06 * sz, 10, 8), { parent: A.parent, bom: i, name: nm, color: "#ff3b3b", pos: at }); B.leds.push(g); }
  else if (/camera|microphone|mic|imu|mpu|gyro|accel|heart|gps|compass|sensor|line/i.test(nm) || p.layer === "sensor") { g = board(A.parent, at, 0.35 * sz, 0.3 * sz, { bom: i, name: nm, color: "#5b2fae", chips: 1 }); mk("sensor", new THREE.SphereGeometry(0.07 * sz, 10, 8), { parent: g, bom: i, name: nm, color: "#111", pos: V3(0, 0.06, 0) }); }
  else if (/motor/i.test(nm)) g = motorCan(A.parent, at.add(V3(0, 0.2 * sz, 0)), 0.18 * sz, 0.5 * sz, { bom: i, name: nm }).g;
  else if (/regulator|buck|converter|supply|psu|driver|esc|charger/i.test(nm)) g = board(A.parent, at, 0.7 * sz, 0.45 * sz, { bom: i, name: nm, color: p.layer === "power" ? "#1d3d8c" : "#b23a3a", chips: 2 });
  else if (p.layer === "display") { g = mk("display", box(0.5 * sz, 0.3 * sz, 0.04), { parent: A.parent, bom: i, name: nm, color: "#5ad1ff", pos: at }); B.leds.push(g); }
  else {
    const big = /mega|main board|soc|flight|raspberry|pi\b|mainboard/i.test(nm) ? 1.35 : /nano|mini|esp|nrf|module|receiver/i.test(nm) ? 0.75 : 1;
    g = board(A.parent, at, 0.9 * sz * big, 0.55 * sz * big, { bom: i, name: nm, color: /esp|nodemcu/i.test(nm) ? "#1b1d24" : /arduino|uno|mega/i.test(nm) ? "#1d6fae" : "#1f7a4a" });
    if (A.wall) g.rotation.x = Math.PI / 2;
  }
  (g.isMesh ? [g] : []).forEach(() => {});
  B.items.push({ obj: g, bom: i, layer: p.layer, name: nm });
}

// ------------------------------------------------------------------ wiring (re-routed every frame, so wires follow moving joints)
function endpoint(obj) { return obj.getWorldPosition(V3()); }
function addWire(a, b, color, label, kind = "signal") {
  const w = { a, b, color, label, kind, mesh: null, dot: null, t: Math.random() };
  w.mesh = mk("wiring", new THREE.BufferGeometry(), { color, name: label, cast: false, bom: -1 });
  w.mesh.userData.wire = w;
  scene.attach(w.mesh); w.mesh.position.set(0, 0, 0); w.mesh.rotation.set(0, 0, 0); w.mesh.scale.set(1, 1, 1);
  B.root.attach(w.mesh);
  w.dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: kind === "power" ? 0xffe066 : kind === "ground" ? 0x88aaff : 0x9ff7ff }));
  w.dot.visible = false; B.root.add(w.dot);
  B.wires.push(w);
  routeWire(w);
  return w;
}
function routeWire(w) {
  const inv = B.root.matrixWorld.clone().invert();
  const pa = endpoint(w.a).applyMatrix4(inv), pb = endpoint(w.b).applyMatrix4(inv);
  const mid = pa.clone().add(pb).multiplyScalar(0.5); mid.y += 0.05 + pa.distanceTo(pb) * 0.05;
  w.curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
  w.mesh.geometry.dispose();
  w.mesh.geometry = new THREE.TubeGeometry(w.curve, 14, w.kind === "ribbon" ? 0.05 : 0.025, 5, false);
}
function wireUp() {
  const items = B.items;
  const find = (rx, layer) => items.find((x) => (!layer || x.layer === layer) && rx.test(x.name));
  const ctrl = find(/esp32|arduino|controller|main ?board|flight|nrf|soc|mainboard|raspberry/i, "electronics") || items.find((x) => x.layer === "electronics");
  const power = find(/battery|lipo|18650|supply|psu|adapter|usb-c|power board/i) || items.find((x) => x.layer === "power");
  const reg = find(/buck|regulator|converter/i);
  const sw = find(/switch/i, "power");
  const driver = find(/pca9685|driver|esc|l298|bts|t-con|amplifier/i, "electronics");
  if (power && sw) { addWire(power.obj, sw.obj, "#d62c2c", "Battery + → switch", "power"); }
  const from = sw || power;
  if (from && reg) addWire(from.obj, reg.obj, "#d62c2c", "Power → regulator", "power");
  const supply = reg || from;
  if (supply && ctrl) { addWire(supply.obj, ctrl.obj, "#d62c2c", "Power → controller", "power"); addWire(ctrl.obj, (power || supply).obj, "#111111", "Ground", "ground"); }
  if (supply && driver && driver !== ctrl) addWire(supply.obj, driver.obj, "#d62c2c", "Power → driver", "power");
  if (ctrl && driver && driver !== ctrl) addWire(ctrl.obj, driver.obj, "#2c6bd6", "I2C / control → driver", "signal");
  // every servo/motor gets its signal cable from the driver (or the controller)
  const hub = driver || ctrl;
  if (hub) {
    const acts = []; B.root.traverse((o) => { if (o.isMesh && o.userData.layer === "actuator" && /servo( \d+)?$|motor( \d+)?$|gear motor|drive motor|fan motor/i.test(o.userData.name)) acts.push(o); });
    const seen = new Set();
    for (const a of acts) { const key = a.parent.uuid; if (seen.has(key)) continue; seen.add(key); addWire(hub.obj, a, "#ff9a1a", `${a.userData.name} cable`, "signal"); if (seen.size >= 26) break; }
  }
  for (const s of items.filter((x) => x.layer === "sensor")) if (ctrl) addWire(ctrl.obj, s.obj, "#e8a800", `${s.name} → controller`, "signal");
  for (const d of items.filter((x) => x.layer === "display" || /speaker|wi-?fi|bluetooth|led driver|t-con/i.test(x.name))) if (ctrl && d !== ctrl && d !== driver) addWire(ctrl.obj, d.obj, d.layer === "display" ? "#c0c4ca" : "#8b2fc9", `${d.name} link`, /t-con/i.test(d.name) ? "ribbon" : "signal");
  for (const sc of B.screens) { const tcon = find(/t-con/i) || ctrl; if (tcon) addWire(tcon.obj, sc.mesh, "#c0c4ca", "LVDS ribbon → panel", "ribbon"); }
  for (const b of items.filter((x) => x.layer === "electronics" && x !== ctrl && x !== driver)) if (supply && !B.wires.some((w) => w.b === b.obj)) addWire(supply.obj, b.obj, "#d62c2c", `Power → ${b.name}`, "power");
}

// ------------------------------------------------------------------ manual mode: place, move, rotate, scale, delete parts
// Every change is stored as an "edit" in the build (saved with it) and replayed after the model is built, so a saved
// build looks exactly the way you left it.
const PALETTE = [
  ["servo", "⚙ Servo", "actuator", "MG996R servo"], ["motor", "🌀 DC motor", "actuator", "Gear motor"], ["wheel", "⭕ Wheel", "mechanical", "Wheel"],
  ["board", "🟩 Board", "electronics", "Controller board"], ["battery", "🔋 Battery", "power", "2S LiPo 2200 mAh"], ["sensor", "📡 Sensor", "sensor", "HC-SR04 ultrasonic sensor"],
  ["screen", "🖥 Screen", "display", "Display"], ["propeller", "✣ Propeller", "mechanical", "Propeller"], ["box", "⬛ Block", "frame", "Frame block"],
  ["cylinder", "⬤ Tube", "frame", "Frame tube"], ["sphere", "● Ball", "shell", "Shell piece"], ["plate", "▭ Plate", "shell", "Shell plate"],
];
let manual = false, selected = null, selBox = null, editSeq = 0;

function objPath(o) {
  if (o.userData.addId) return o.userData.addId;
  const idx = [];
  for (let c = o; c && c !== B.root; c = c.parent) { if (c.userData.addId) { idx.unshift(c.userData.addId); break; } idx.unshift(c.parent.children.indexOf(c)); }
  return idx.join("/");
}
function findPath(p) {
  const parts = String(p).split("/");
  let o = B.root;
  for (const k of parts) { o = /^add_/.test(k) ? (B.adds?.[k] || null) : o?.children[+k]; if (!o) return null; }
  return o;
}
/** the thing to grab when you click a mesh: the part's group (a servo, a leg link...) rather than one tiny piece of it */
function grabbable(m) {
  let o = m;
  while (o.parent && o.parent !== B.root && !o.userData.partId && !o.userData.addId && o.parent.type === "Group" && !o.name) o = o.parent;
  if (o.parent && o.parent !== B.root && o.parent.name && !o.userData.partId && !o.userData.addId && o.parent.children.length <= 6) o = o.parent;
  return o;
}
function newPart(kind, parent) {
  const P = PALETTE.find((x) => x[0] === kind) || PALETTE[8];
  const g = group(parent, V3(), P[3]);
  const bom = ensureBom(P[3], P[2]);
  const p = { name: P[3], layer: P[2], bom, color: null };
  const s = (v) => v * MM;
  switch (kind) {
    case "servo": servo(g, V3(), { s: s(40) / 0.42, bom, name: P[3], axis: "none" }); break;
    case "motor": motorCan(g, V3(), s(12), s(40), { bom, name: P[3], axis: "none" }); break;
    case "wheel": partMesh(g, { ...p, shape: "wheel", size: [26, 65, 65] }); break;
    case "board": board(g, V3(), s(55), s(28), { bom, name: P[3] }); break;
    case "battery": battery(g, V3(), s(75), s(25), s(35), { bom, name: P[3] }); break;
    case "sensor": { const b = board(g, V3(), s(45), s(20), { bom, name: P[3], color: "#1b4fa8", chips: 1 }); for (const x of [-1, 1]) mk("sensor", cyl(s(8), s(8), s(12), 16), { parent: b, bom, name: P[3], color: "#c8ccd2", pos: V3(x * s(13), s(8), 0) }); break; }
    case "screen": partMesh(g, { ...p, shape: "screen", size: [120, 70, 6] }); break;
    case "propeller": partMesh(g, { ...p, shape: "propeller", size: [127, 3, 18] }); break;
    case "cylinder": partMesh(g, { ...p, shape: "cylinder", size: [20, 120, 20] }); break;
    case "sphere": partMesh(g, { ...p, shape: "sphere", size: [80, 80, 80] }); break;
    case "plate": partMesh(g, { ...p, shape: "rounded_box", size: [120, 6, 80] }); break;
    default: partMesh(g, { ...p, shape: "box", size: [60, 30, 40] });
  }
  return g;
}
/** a part added by hand also appears on the parts list (and in the cost) */
function ensureBom(name, layer) {
  let i = spec.parts.findIndex((p) => p.name === name);
  if (i < 0) { spec.parts.push({ name, layer, spec: "added in manual mode", qty: 0, price: 0, mount: "body" }); i = spec.parts.length - 1; }
  spec.parts[i].qty++;
  spec.parts[i].added = (spec.parts[i].added || 0) + 1;      // remembered so a rebuild does not count it twice
  return i;
}
function recordMove(o) {
  const t = objPath(o);
  spec.edits = (spec.edits || []).filter((e) => !(e.op === "move" && e.target === t));
  spec.edits.push({ op: "move", target: t, pos: o.position.toArray(), rot: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray() });
}
function replayEdits(edits) {
  B.adds = {};
  for (const p of spec.parts) if (p.added) { p.qty -= p.added; p.added = 0; }
  for (const e of edits) {
    if (e.op === "add") {
      const parent = e.part?.parent ? findPath(e.part.parent) || B.root : B.root;
      const kind = e.part?.kind || "box";
      const g = newPart(kind, parent);
      g.userData.addId = e.target; B.adds[e.target] = g;
      editSeq = Math.max(editSeq, +String(e.target).split("_")[1] || 0);
      if (e.pos) g.position.fromArray(e.pos);
    } else {
      const o = findPath(e.target); if (!o) continue;
      if (e.op === "del") { o.visible = false; o.userData.deleted = true; o.traverse((x) => { if (x.isMesh) x.userData.deleted = true; }); }
      if (e.op === "move") { if (e.pos) o.position.fromArray(e.pos); if (e.rot) o.rotation.set(...e.rot); if (e.scale) o.scale.fromArray(e.scale); }
    }
  }
  B.root.updateMatrixWorld(true);
}
function select(o) {
  selected = o;
  if (selBox) { scene.remove(selBox); selBox = null; }
  if (o) { selBox = new THREE.BoxHelper(o, 0xffd36a); scene.add(selBox); }
  gizmo?.attach(o);
  drawEdit();
}
function nudge(axis, amt) { if (!selected) return; selected.position[axis] += amt; recordMove(selected); selBox?.update(); }
function turn(axis, deg) { if (!selected) return; selected.rotation[axis] += DEG(deg); recordMove(selected); selBox?.update(); }
function rescale(k) { if (!selected) return; selected.scale.multiplyScalar(k); recordMove(selected); selBox?.update(); }
function addPart(kind) {
  if (!B) return toast("Generate something first (or pick an idea), then add parts to it.");
  const parent = selected || B.body || B.root;
  const id = `add_${++editSeq}`;
  const g = newPart(kind, parent);
  g.userData.addId = id; B.adds[id] = g;
  const bb = new THREE.Box3().setFromObject(parent === B.root ? B.root : parent);
  const top = parent.worldToLocal(V3(0, bb.max.y + 0.15, 0));
  g.position.set(0, top.y, 0);
  spec.edits = [...(spec.edits || []), { op: "add", target: id, part: { kind, name: g.name, layer: PALETTE.find((x) => x[0] === kind)?.[2], parent: parent === B.root ? "" : objPath(parent) }, pos: g.position.toArray() }];
  B.root.updateMatrixWorld(true);
  labelsDirty = true; drawParts();
  select(g);
}
function removeSelected() {
  if (!selected) return;
  const t = objPath(selected);
  if (/^add_/.test(t)) { spec.edits = spec.edits.filter((e) => e.target !== t && !(e.part?.parent || "").startsWith(t)); selected.parent.remove(selected); delete B.adds[t]; }
  else { spec.edits = [...(spec.edits || []), { op: "del", target: t }]; selected.visible = false; selected.traverse((x) => { if (x.isMesh) x.userData.deleted = true; }); }
  select(null); labelsDirty = true;
}
function duplicateSelected() {
  if (!selected) return;
  const t = objPath(selected);
  const add = (spec.edits || []).find((e) => e.op === "add" && e.target === t);
  const kind = add?.part.kind || (/servo/i.test(selected.name) ? "servo" : /motor/i.test(selected.name) ? "motor" : /wheel/i.test(selected.name) ? "wheel" : "box");
  const was = selected;
  select(was.parent === B.root ? null : was.parent);
  addPart(kind);
  selected.position.copy(was.position).add(V3(0.3, 0, 0)); selected.rotation.copy(was.rotation); selected.scale.copy(was.scale);
  recordMove(selected); selBox?.update();
}
function drawEdit() {
  const box = $("pane-edit");
  if (!box) return;
  const btn = (label, fn, title) => el("button", { class: "ghost", style: "padding:4px 8px;font-size:12px", title: title || label, onclick: fn }, label);
  const step = 0.1;           // 1 cm
  box.replaceChildren(
    el("p", { class: "muted small" }, manual ? "Click a part to select it, drag it to move it, or use the buttons. New parts snap onto the selected part (or the body)." : "Turn on ✋ Manual mode (bottom bar) to place and edit parts yourself."),
    el("div", { class: "layer-h" }, "Add a part"),
    el("div", { class: "chips", style: "justify-content:flex-start" }, ...PALETTE.map(([k, label]) => el("button", { onclick: () => { if (!manual) setManual(true); addPart(k); } }, label))),
    el("div", { class: "layer-h" }, "Selected"),
    selected ? el("div", {}, el("b", {}, selected.name || "Part"), el("p", { class: "muted small" }, `${objPath(selected)}`),
      el("div", { class: "row", style: "display:flex;gap:4px;flex-wrap:wrap" }, btn("← X", () => nudge("x", -step)), btn("X →", () => nudge("x", step)), btn("↓ Y", () => nudge("y", -step)), btn("Y ↑", () => nudge("y", step)), btn("Z −", () => nudge("z", -step)), btn("Z +", () => nudge("z", step))),
      el("div", { class: "row", style: "display:flex;gap:4px;flex-wrap:wrap;margin-top:4px" }, btn("⟲ X", () => turn("x", 15)), btn("⟲ Y", () => turn("y", 15)), btn("⟲ Z", () => turn("z", 15)), btn("− size", () => rescale(0.9)), btn("+ size", () => rescale(1.1))),
      el("div", { class: "row", style: "display:flex;gap:4px;flex-wrap:wrap;margin-top:4px" }, btn("⧉ Duplicate", duplicateSelected), btn("🗑 Delete", removeSelected), btn("✕ Deselect", () => select(null))),
      el("p", { class: "muted small" }, "Keys: arrows / PgUp PgDn move · R rotate · +/− size · Del delete · Ctrl+D duplicate"))
      : el("p", { class: "muted small" }, "Nothing selected."),
    el("div", { class: "layer-h" }, "Your changes"),
    el("p", { class: "muted small" }, `${(spec?.edits || []).length} change(s) - press 💾 Save to keep them.`),
    (spec?.edits || []).length ? btn("↺ Undo all my changes", () => { spec.edits = []; build(spec); }) : null);
}
function setManual(on) {
  manual = on;
  $("btnManual").classList.toggle("on", on);
  if (on) { stopSim(); showTab("edit"); } else select(null);
  drawEdit();
}
// dragging the selected part across a plane at its height
let drag = null;
renderer.domElement.addEventListener("pointerdown", (ev) => {
  if (!manual || ev.button !== 0) return;
  const m = pickAt(ev);
  if (!m) return;
  const o = grabbable(m);
  if (o !== selected) select(o);
  const wp = o.getWorldPosition(V3());
  drag = { o, plane: new THREE.Plane(V3(0, 1, 0), -wp.y), start: wp, moved: false };
  controls.enabled = false;
});
addEventListener("pointermove", (ev) => {
  if (!drag) return;
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.ray.intersectPlane(drag.plane, V3());
  if (!hit) return;
  drag.o.position.copy(drag.o.parent.worldToLocal(hit));
  drag.moved = true; selBox?.update();
});
addEventListener("pointerup", () => { if (drag?.moved) recordMove(drag.o); drag = null; controls.enabled = true; });
addEventListener("keydown", (ev) => {
  if (!manual || !selected || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  const k = ev.key, s = ev.shiftKey ? 0.5 : 0.1;
  const map = { ArrowLeft: () => nudge("x", -s), ArrowRight: () => nudge("x", s), ArrowUp: () => nudge("z", -s), ArrowDown: () => nudge("z", s),
    PageUp: () => nudge("y", s), PageDown: () => nudge("y", -s), r: () => turn("y", 15), R: () => turn("x", 15), "+": () => rescale(1.1), "=": () => rescale(1.1), "-": () => rescale(0.9),
    Delete: removeSelected, Backspace: removeSelected, Escape: () => select(null) };
  if (ev.ctrlKey && k.toLowerCase() === "d") { ev.preventDefault(); duplicateSelected(); return; }
  if (map[k]) { ev.preventDefault(); map[k](); }
});

// ------------------------------------------------------------------ generating
function build(s) {
  spec = s;
  selected = null; if (selBox) { scene.remove(selBox); selBox = null; }
  editSeq = 0;
  newBuild();
  water.visible = false;
  const fn = T[spec.template] || T.box;
  fn(spec.params);
  B.root.updateMatrixWorld(true);
  if (spec.template !== "custom") placeParts();
  B.root.updateMatrixWorld(true);
  const W = spec.geometry?.wires || [];
  if (spec.template === "custom" && W.length) {
    const col = { power: "#d62c2c", ground: "#111111", signal: "#ff9a1a", data: "#2c6bd6" };
    for (const w of W) if (B.nodes[w.from] && B.nodes[w.to]) addWire(B.nodes[w.from], B.nodes[w.to], col[w.kind] || "#ff9a1a", w.label || `${w.from} → ${w.to}`, w.kind);
  } else wireUp();
  replayEdits(spec.edits || []);
  for (const m of B.meshes) { m.userData.base = m.position.clone(); }
  frame();
  setView("all");
  drawParts(); drawSteps(); drawCode(); drawLive(); drawEdit();
  $("empty").hidden = true;
  $("titleChip").hidden = false;
  $("buildName").textContent = spec.name;
  $("buildMeta").textContent = `${LAYER_NAMES[spec.template] || spec.template} · ${spec.parts.reduce((n, p) => n + p.qty, 0)} parts · about $${Math.round(spec.cost)} · ${spec.source === "ai" ? "designed by the AI" : "offline designer"}`;
  $("btnAssemble").disabled = $("btnSim").disabled = false;
  simOn = false; $("btnSim").textContent = "▶ Simulate"; $("btnSim").classList.remove("running");
  try { localStorage.setItem("builder_last", JSON.stringify(spec)); } catch { /* ignore */ }
}
const LAYER_NAMES = { custom: "AI-designed model", quadruped: "Four-legged walker", hexapod: "Six-legged walker", biped: "Two-legged walker", humanoid: "Humanoid", wheeled: "Wheeled robot",
  tracked: "Tracked robot", arm: "Robotic arm", drone: "Quadcopter", snake: "Snake robot", fish: "Robot fish", panel: "Screen device", box: "Electronic box", cylinder: "Round device", fan: "Fan", watch: "Wearable" };

function frame() {
  const bb = new THREE.Box3().setFromObject(B.root), c = bb.getCenter(V3()), sz = bb.getSize(V3());
  const r = Math.max(sz.x, sz.y, sz.z) * 0.5 + 0.5;
  controls.target.copy(c);
  const d = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.9;
  camera.position.copy(c).add(V3(0.75, 0.45, 1).normalize().multiplyScalar(d));
  controls.update();
}

// ------------------------------------------------------------------ views
let view = "all";
function setView(v) {
  view = v;
  for (const b of $("views").children) b.classList.toggle("on", b.dataset.v === v);
  const only = LAYER[v] ? v : null;
  for (const m of B?.meshes || []) {
    const L = m.userData.layer;
    m.visible = !m.userData.deleted;
    if (v === "all" || v === "exploded") m.material = m.userData.baseMat;
    else if (v === "xray") { m.material = L === "shell" || (L === "frame" && B.motion !== "walk") || (L === "display" && !/strip|led/i.test(m.userData.name)) ? ghostMat : m.userData.baseMat; }
    else if (only) {
      const match = L === only || (only === "actuator" && L === "mechanical" && /horn/i.test(m.userData.name)) || (only === "electronics" && L === "display" && /board|module/i.test(m.userData.name));
      m.material = match ? m.userData.baseMat : ghostMat;
      if (!match && (only === "wiring" || only === "actuator" || only === "sensor" || only === "power") && L === "shell") m.visible = false;
    }
  }
  for (const w of B?.wires || []) w.dot.visible = false;
  explode = v === "exploded" ? 1 : 0;
  labelsDirty = true;
}
let explode = 0, explodeK = 0;

// ------------------------------------------------------------------ assembly animation: frame -> motors -> electronics -> wires -> shell
let assembling = null;
const ORDER = [["frame", "🦴 Building the frame"], ["mechanical", "🔩 Adding the mechanical parts"], ["actuator", "⚙ Mounting the motors and servos"],
  ["electronics", "🔌 Fitting the electronics"], ["power", "🔋 Installing the power system"], ["sensor", "📡 Adding the sensors"], ["display", "🖥 Fitting the display"],
  ["wiring", "〰 Wiring everything up"], ["shell", "🛡 Closing the exoskeleton"]];
function assemble() {
  if (!B) return;
  setView("all"); stopSim();
  const groups = ORDER.map(([layer, text]) => ({ layer, text, meshes: B.meshes.filter((m) => m.userData.layer === layer) })).filter((g) => g.meshes.length);
  for (const m of B.meshes) { m.visible = false; m.userData.s0 ??= m.scale.x; m.userData.sy0 ??= m.scale.y; m.userData.sz0 ??= m.scale.z; }
  assembling = { groups, gi: 0, t: 0 };
  $("phase").hidden = false;
}
function stepAssembly(dt) {
  const A = assembling; if (!A) return;
  const G = A.groups[A.gi];
  if (!G) { assembling = null; $("phase").textContent = "✅ Built! Press ▶ Simulate"; setTimeout(() => ($("phase").hidden = true), 2200); for (const m of B.meshes) { m.visible = !m.userData.deleted; const s0 = m.userData.s0 ?? m.scale.x; m.scale.set(s0, m.userData.sy0 ?? m.scale.y, m.userData.sz0 ?? m.scale.z); } setView(view); highlightStep(-1); return; }
  if (A.t === 0) { $("phase").textContent = G.text; highlightStep(A.gi); for (const m of G.meshes) { m.userData.s0 ??= m.scale.x; } }
  A.t += dt * speed();
  const dur = 1.1, per = Math.min(0.08, 0.9 / G.meshes.length);
  G.meshes.forEach((m, k) => {
    const k0 = clamp((A.t - k * per) / 0.35, 0, 1);
    m.visible = k0 > 0;
    const e = 1 - Math.pow(1 - k0, 3);
    const s0 = m.userData.s0 ?? 1;
    if (m.userData.wire) m.scale.setScalar(1); else m.scale.set(m.scale.x && k0 > 0 ? s0 * (0.3 + 0.7 * e) : s0, m.scale.y, m.scale.z);
    if (!m.userData.wire) { const sy = m.userData.sy0 ??= m.scale.y, sz = m.userData.sz0 ??= m.scale.z; m.scale.set(s0 * (0.3 + 0.7 * e), sy * (0.3 + 0.7 * e), sz * (0.3 + 0.7 * e)); }
    if (m.userData.base && !m.userData.wire) m.position.copy(m.userData.base).add(V3(0, (1 - e) * 1.2, 0));
  });
  if (A.t > dur + G.meshes.length * per) { for (const m of G.meshes) { if (m.userData.base && !m.userData.wire) m.position.copy(m.userData.base); const s0 = m.userData.s0 ?? 1; m.scale.set(s0, m.userData.sy0 ?? s0, m.userData.sz0 ?? s0); } A.gi++; A.t = 0; }
}
/** jump to the end of the assembly animation (click Assemble again while it builds) */
function finishAssembly() {
  if (!assembling) return;
  for (const G of assembling.groups) for (const m of G.meshes) { if (m.userData.base && !m.userData.wire) m.position.copy(m.userData.base); const s0 = m.userData.s0 ?? m.scale.x; m.scale.set(s0, m.userData.sy0 ?? m.scale.y, m.userData.sz0 ?? m.scale.z); }
  assembling.gi = assembling.groups.length; assembling.t = 0;
  stepAssembly(0);
}
function highlightStep(i) { [...document.querySelectorAll("ol.steps li")].forEach((li, k) => li.classList.toggle("now", k === Math.min(i, document.querySelectorAll("ol.steps li").length - 1) && i >= 0)); }

// ------------------------------------------------------------------ simulation
let simOn = false, simT = 0;
const speed = () => +$("speed").value;
function startSim() { if (!B) return; simOn = true; simT = 0; $("btnSim").textContent = "⏸ Stop"; $("btnSim").classList.add("running"); $("phase").hidden = false; $("phase").textContent = { walk: "🚶 Walking", drive: "🚗 Driving", arm: "🦾 Pick and place", fly: "🚁 Hovering", slither: "🐍 Slithering", swim: "🐟 Swimming", screen: "⚡ Powered on", power: "⚡ Powered on", spin: "🌀 Running" }[B.motion] || "▶ Running"; setTabLive(); }
function stopSim() { simOn = false; $("btnSim").textContent = "▶ Simulate"; $("btnSim").classList.remove("running"); $("phase").hidden = true; if (B) resetPose(); for (const w of B?.wires || []) w.dot.visible = false; }
function resetPose() {
  for (const j of B.joints) if (j.obj && j.axis !== "rpm") { j.obj.rotation.x = j.obj.userData.rx0 ?? j.obj.rotation.x; }
  B.legs?.forEach((l) => { l.hip.rotation.set(0, 0, 0); l.knee.rotation.set(0, 0, 0); });
  B.arms?.forEach((a) => { a.sh.rotation.set(0, 0, 0); a.elbow.rotation.set(0, 0, 0); });
  B.custom?.joints.forEach((j) => j.node.rotation.copy(j.rest));
  if (B.body) { B.body.position.y = B.bodyY; B.body.rotation.set(0, 0, 0); }
  for (const sc of B.screens) { sc.mesh.userData.baseMat.emissiveIntensity = 0; drawScreen(sc.S, 0, false); }
  grid.position.set(0, 0.002, 0);
}

function simulate(dt) {
  simT += dt * speed();
  const t = simT, k = 2 * Math.PI * 0.9;            // gait frequency
  const tele = [];
  let forward = 0;
  if (B.custom) {
    forward = simulateCustom(t, dt, tele);
  } else if (B.motion === "walk") {
    const legs = B.legs || [];
    legs.forEach((l, i) => {
      let off;
      if (B.gait === "trot") off = [0, 0.5, 0.5, 0][i % 4];
      else if (B.gait === "tripod") off = ((l.row + (l.side > 0 ? 1 : 0)) % 2) * 0.5;
      else off = i % 2 ? 0.5 : 0;
      const ph = (t * k / (2 * Math.PI) + off) * 2 * Math.PI;
      if (B.gait === "tripod") {
        l.hip.rotation.y = Math.sin(ph) * 0.35;
        l.hip.rotation.z = -l.side * Math.max(0, Math.cos(ph)) * 0.35;
        l.knee.rotation.z = l.side * Math.max(0, Math.cos(ph)) * 0.2;
        tele.push([l.hip.name.replace(" hip", "") + " coxa", 90 + Math.sin(ph) * 20], [l.hip.name.replace(" hip", "") + " femur", 90 + Math.max(0, Math.cos(ph)) * 20]);
      } else {
        const A = B.gait === "biped" ? 0.45 : 0.4;
        l.hip.rotation.x = Math.sin(ph) * A;
        l.knee.rotation.x = -Math.max(0, Math.cos(ph)) * (B.gait === "biped" ? 0.9 : 0.75) - 0.05;
        tele.push([l.hip.name, 90 + THREE.MathUtils.radToDeg(l.hip.rotation.x)], [l.knee.name, 90 + THREE.MathUtils.radToDeg(l.knee.rotation.x)]);
      }
    });
    if (B.body) { B.body.position.y = B.bodyY + Math.abs(Math.sin(t * k)) * 0.05 * spec.params.scale; B.body.rotation.z = Math.sin(t * k) * (B.gait === "biped" ? 0.05 : 0.015); }
    B.arms?.forEach((a) => { a.sh.rotation.x = Math.sin(t * k + (a.side > 0 ? 0 : Math.PI)) * 0.4; a.elbow.rotation.x = -0.3 - Math.max(0, Math.sin(t * k)) * 0.2; });
    if (B.neck) B.neck.rotation.y = Math.sin(t * 0.7) * 0.35;
    if (B.tail) B.tail.rotation.y = Math.sin(t * 6) * 0.5;
    forward = 0.9 * spec.params.scale;
  } else if (B.motion === "drive") {
    const v = 1.6 * spec.params.scale;
    for (const w of B.wheels) w.obj.rotation.y -= (v * dt * speed()) / w.r;
    if (B.body) { B.body.rotation.y = Math.sin(t * 0.25) * 0.35; B.body.position.y = B.bodyY + Math.sin(t * 9) * 0.008; }
    forward = v;
    const rpm = (v / (2 * Math.PI * (B.wheels[0]?.r || 0.5))) * 60 * 3;
    tele.push(["Left motors (rpm)", rpm * (1 - Math.sin(t * 0.25) * 0.3), "rpm"], ["Right motors (rpm)", rpm * (1 + Math.sin(t * 0.25) * 0.3), "rpm"]);
  } else if (B.motion === "arm") {
    const cyc = (t * 0.25) % 1, e = (a, b, x) => a + (b - a) * (0.5 - Math.cos(clamp(x, 0, 1) * Math.PI) / 2);
    // 0-.2 reach down to block, .2-.3 close, .3-.5 lift & turn, .5-.6 lower, .6-.7 open, .7-1 return
    const reach = cyc < 0.2 ? e(0, 1, cyc / 0.2) : cyc < 0.3 ? 1 : cyc < 0.5 ? e(1, 0.2, (cyc - 0.3) / 0.2) : cyc < 0.6 ? e(0.2, 0.9, (cyc - 0.5) / 0.1) : cyc < 0.7 ? 0.9 : e(0.9, 0, (cyc - 0.7) / 0.3);
    const turn = cyc < 0.3 ? 0.25 : cyc < 0.5 ? e(0.25, -1.3, (cyc - 0.3) / 0.2) : cyc < 0.7 ? -1.3 : e(-1.3, 0.25, (cyc - 0.7) / 0.3);
    const grip = cyc < 0.2 ? 0 : cyc < 0.3 ? e(0, 1, (cyc - 0.2) / 0.1) : cyc < 0.6 ? 1 : cyc < 0.7 ? e(1, 0, (cyc - 0.6) / 0.1) : 0;
    B.turn.rotation.y = turn; B.shoulder.rotation.x = 0.2 + reach * 0.75; B.elbow.rotation.x = 0.3 + reach * 0.9; B.wrist.rotation.x = 0.5 + reach * 0.3;
    for (const f of B.fingers) f.f.rotation.z = f.x * (0.35 - grip * 0.33);
    // the block rides in the gripper while it's closed
    B.root.updateMatrixWorld(true);
    if (grip > 0.95 && B.cube.parent !== B.grip) B.grip.attach(B.cube);
    if (grip < 0.5 && B.cube.parent === B.grip) { B.root.attach(B.cube); B.cube.position.y = 0.2 * spec.params.scale; B.cube.rotation.set(0, B.cube.rotation.y, 0); }
    tele.push(["Base", 90 + THREE.MathUtils.radToDeg(turn)], ["Shoulder", 90 + THREE.MathUtils.radToDeg(B.shoulder.rotation.x)], ["Elbow", 90 + THREE.MathUtils.radToDeg(B.elbow.rotation.x)], ["Wrist", 90 + THREE.MathUtils.radToDeg(B.wrist.rotation.x)], ["Gripper", 90 - grip * 40]);
  } else if (B.motion === "fly") {
    const lift = clamp(t / 2, 0, 1);
    for (const r of B.rotors) r.obj.rotation.y += r.dir * dt * speed() * (20 + 40 * lift);
    if (B.body) { B.body.position.y = B.bodyY + lift * (2.2 + Math.sin(t * 1.3) * 0.25) * spec.params.scale; B.body.rotation.z = Math.sin(t * 0.8) * 0.06; B.body.rotation.x = Math.sin(t * 0.6) * 0.05; }
    B.rotors.forEach((r, i) => tele.push([`Motor ${i + 1} (rpm)`, (6000 + lift * 14000) * (1 + Math.sin(t * 2 + i) * 0.04), "rpm"]));
  } else if (B.motion === "slither") {
    B.segs.forEach((j, i) => { j.rotation.y = Math.sin(t * 3 - i * 0.7) * 0.45; if (i < 6) tele.push([j.name, 90 + THREE.MathUtils.radToDeg(j.rotation.y)]); });
    B.body.rotation.y = Math.sin(t * 3 + 0.7) * 0.25;
    forward = 0.7 * spec.params.scale;
  } else if (B.motion === "swim") {
    B.tails[0].rotation.y = Math.sin(t * 4) * 0.35; B.tails[1].rotation.y = Math.sin(t * 4 - 1) * 0.55;
    B.body.rotation.y = -Math.sin(t * 4) * 0.08; B.body.position.y = B.bodyY + Math.sin(t * 0.8) * 0.3;
    forward = 0.8;
    tele.push(["Tail 1", 90 + THREE.MathUtils.radToDeg(B.tails[0].rotation.y)], ["Tail 2", 90 + THREE.MathUtils.radToDeg(B.tails[1].rotation.y)]);
  } else if (B.motion === "spin") {
    const sp = clamp(t / 1.5, 0, 1);
    for (const r of B.rotors) r.obj.rotation.z += dt * speed() * 14 * sp;
    if (B.head) B.head.rotation.y = Math.sin(t * 0.4) * 0.6;
    tele.push(["Fan motor (rpm)", 1300 * sp, "rpm"], ["Oscillation", 90 + Math.sin(t * 0.4) * 34]);
  }
  // screens, LEDs, speakers: the device is ON
  for (const sc of B.screens) { sc.mesh.userData.baseMat.emissiveIntensity = clamp(t * 1.5, 0, 1) * 0.95; drawScreen(sc.S, t, true, sc.kind); }
  B.leds.forEach((l, i) => { const m = l.material; if (m && m !== ghostMat && m.emissive) { m.emissive.set(l.userData.name.includes("backlight") ? 0xffffff : l.userData.name.includes("ring") ? new THREE.Color().setHSL((t * 0.2 + i * 0.1) % 1, 0.8, 0.5) : (Math.sin(t * 4 + i) > 0 ? 0x33ff66 : 0x113311)); m.emissiveIntensity = l.userData.name.includes("backlight") ? clamp(t, 0, 1) * 0.6 : 1.2; } });
  B.speakers?.forEach((c, i) => c.scale.setScalar(1 + Math.max(0, Math.sin(t * 18 + i)) * 0.06));
  // the floor slides under walkers and drivers (so it really looks like it's moving forward)
  if (forward) { grid.position.z = (grid.position.z - forward * dt * speed()) % 1; }
  // current flowing through the wires
  if ($("chkFlow").checked) for (const w of B.wires) { w.t = (w.t + dt * speed() * (w.kind === "power" ? 0.6 : 1.1)) % 1; w.dot.position.copy(w.curve.getPoint(w.kind === "ground" ? 1 - w.t : w.t)); w.dot.visible = w.mesh.visible && w.mesh.material !== ghostMat; }
  else for (const w of B.wires) w.dot.visible = false;
  liveData = tele;
}

// ------------------------------------------------------------------ side panels
function drawParts() {
  const box = $("pane-parts"); box.replaceChildren();
  box.append(el("p", {}, spec.summary));
  for (const layer of Object.keys(LAYER)) {
    const list = spec.parts.map((p, i) => [p, i]).filter(([p]) => p.layer === layer);
    if (!list.length) continue;
    box.append(el("div", { class: "layer-h" }, el("span", { class: "dot", style: `background:${LAYER[layer].color}` }), LAYER[layer].label,
      el("button", { class: "ghost", style: "margin-left:auto;padding:1px 8px;font-size:11px", onclick: () => setView(layer) }, "show")));
    for (const [p, i] of list) box.append(el("div", { class: "part", "data-i": i, onclick: () => focusPart(i) },
      el("span", {}, p.name), el("span", { class: "q" }, `${p.qty}× $${p.price}`), el("small", {}, partFacts(p))));
  }
  box.append(el("div", { class: "total" }, el("span", {}, "Estimated total"), el("span", {}, `$${spec.cost.toFixed(2)}`)));
  box.append(el("p", { class: "muted small" }, "Prices are typical online prices and change often."));
}
/** "MG996R · 55 g · 6 V · peak 2.5 A · 11 kg·cm" */
function partFacts(p) {
  const f = [p.spec, p.mass_g ? `${p.mass_g >= 1000 ? (p.mass_g / 1000).toFixed(1) + " kg" : Math.round(p.mass_g) + " g"}` : "", p.voltage ? `${p.voltage} V` : "",
    p.current_ma?.[1] ? `peak ${p.current_ma[1] >= 1000 ? (p.current_ma[1] / 1000).toFixed(1) + " A" : p.current_ma[1] + " mA"}` : "", p.torque_kgcm ? `${p.torque_kgcm} kg·cm` : "", p.mah ? `${p.mah} mAh` : ""];
  return f.filter(Boolean).join(" · ");
}
function drawSteps() {
  $("pane-steps").replaceChildren(el("ol", { class: "steps" }, ...spec.steps.map((s) => el("li", {}, s))),
    el("button", { class: "primary", onclick: () => assemble() }, "🔧 Watch it being assembled"));
}
function drawCode() {
  const code = spec.code || defaultCode();
  $("pane-code").replaceChildren(el("p", { class: "muted small" }, "Real firmware generated from THIS build's parts list (its controller, servo count, sensors and pins). The first lines say which board and libraries to pick in the Arduino IDE."),
    el("button", { class: "ghost", onclick: () => { navigator.clipboard?.writeText(code); toast("Code copied"); } }, "📋 Copy"), el("pre", { class: "code" }, code));
}
function defaultCode() {
  const m = spec.motion;
  if (m === "walk") return `// ${spec.name} - gait test (ESP32 + PCA9685)\n#include <Wire.h>\n#include <Adafruit_PWMServoDriver.h>\nAdafruit_PWMServoDriver pwm;\nconst int LEGS = ${(B?.legs || []).length};\nvoid setAngle(int ch, float deg) { pwm.setPWM(ch, 0, map(deg, 0, 180, 110, 510)); }\nvoid setup() {\n  pwm.begin(); pwm.setPWMFreq(50);\n  for (int i = 0; i < LEGS * 2; i++) setAngle(i, 90);   // centre everything first\n  delay(1500);\n}\nvoid loop() {\n  float t = millis() / 1000.0;\n  for (int leg = 0; leg < LEGS; leg++) {\n    float ph = t * 5.6 + ((leg == 0 || leg == 3) ? 0 : PI);   // trot: diagonal pairs\n    setAngle(leg * 2,     90 + 23 * sin(ph));                  // hip\n    setAngle(leg * 2 + 1, 90 - 43 * max(0.0f, cos(ph)));       // knee lifts the foot\n  }\n  delay(20);\n}\n`;
  if (m === "drive") return `// ${spec.name} - drive + avoid walls (L298N + HC-SR04)\nconst int ENA=5, IN1=6, IN2=7, ENB=10, IN3=8, IN4=9, TRIG=11, ECHO=12;\nlong cm() { digitalWrite(TRIG, LOW); delayMicroseconds(2); digitalWrite(TRIG, HIGH); delayMicroseconds(10); digitalWrite(TRIG, LOW); return pulseIn(ECHO, HIGH, 25000) / 58; }\nvoid drive(int l, int r) { digitalWrite(IN1, l > 0); digitalWrite(IN2, l < 0); analogWrite(ENA, abs(l)); digitalWrite(IN3, r > 0); digitalWrite(IN4, r < 0); analogWrite(ENB, abs(r)); }\nvoid setup() { for (int p : {ENA,IN1,IN2,ENB,IN3,IN4,TRIG}) pinMode(p, OUTPUT); pinMode(ECHO, INPUT); }\nvoid loop() { long d = cm(); if (d > 0 && d < 20) { drive(-150, 150); delay(350); } else drive(180, 180); delay(30); }\n`;
  if (m === "arm") return `// ${spec.name} - pick and place\n#include <Servo.h>\nServo base, shoulder, elbow, wrist, grip;\nvoid move(Servo &s, int to) { int a = s.read(); while (a != to) { a += a < to ? 1 : -1; s.write(a); delay(12); } }\nvoid setup() { base.attach(3); shoulder.attach(5); elbow.attach(6); wrist.attach(9); grip.attach(10); }\nvoid loop() {\n  move(base, 105); move(shoulder, 130); move(elbow, 140); move(grip, 50);   // reach + grab\n  move(shoulder, 90); move(base, 15); move(shoulder, 125); move(grip, 90);   // carry + release\n  move(shoulder, 90); move(base, 90); delay(800);\n}\n`;
  if (m === "fly") return `# ${spec.name}: flight controllers run Betaflight / ArduPilot, not a sketch.\n# 1. Flash Betaflight with the Betaflight Configurator.\n# 2. Ports: enable Serial RX on the UART the ELRS receiver uses.\n# 3. Motors tab (PROPS OFF!): check order and direction of motors 1-4.\n# 4. Set the arm switch, calibrate the accelerometer, first hover outside.\n`;
  return `// ${spec.name} - power-on self test\nvoid setup() {\n  Serial.begin(115200);\n  pinMode(LED_BUILTIN, OUTPUT);\n  Serial.println("${spec.name}: boot OK");\n}\nvoid loop() {\n  digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));\n  Serial.printf("supply %.2f V\\n", analogRead(34) * 3.3 / 4095 * 2);\n  delay(500);\n}\n`;
}
let liveData = [];
function drawLive() {
  const box = $("pane-live");
  const A = spec.analysis || { rows: [], idle_ma: 0, typical_ma: 0, peak_ma: 0 };
  // live current: the boards' idle draw + the motors working harder while they swing (from datasheet numbers)
  const load = simOn ? 0.35 + 0.25 * Math.abs(Math.sin(simT * 3)) : 0;
  const nowMa = A.idle_ma + (A.peak_ma - A.idle_ma) * load * 0.6;
  const status = (s) => el("b", { style: `color:var(${s === "warn" ? "--warn" : "--ok"})` }, s === "warn" ? "⚠" : "✓");
  box.replaceChildren(...[
    el("div", { class: "layer-h" }, "Real numbers (from the parts' datasheets)"),
    ...A.rows.map(([label, value, s]) => el("div", { class: "live-row" }, el("span", {}, label), el("b", {}, value), status(s))),
    el("div", { class: "layer-h" }, simOn ? "Live" : "Live (press ▶ Simulate)"),
    el("div", { class: "live-row" }, el("span", {}, "Current right now"), el("b", {}, simOn ? `${(nowMa / 1000).toFixed(2)} A` : "–"), el("span", {})),
    ...(simOn ? liveData.slice(0, 24).map(([n, v, unit]) => el("div", { class: "live-row" }, el("span", {}, n), el("b", {}, unit === "rpm" ? `${Math.round(v)}` : `${Math.round(v)}°`),
      el("div", { class: "bar-in" }, el("i", { style: `width:${clamp(unit === "rpm" ? v / 200 : v / 1.8, 0, 100)}%` })))) : []),
  ]);
}function setTabLive() { showTab("live"); }
function showTab(k) { for (const b of $("sideTabs").children) b.setAttribute("aria-selected", String(b.dataset.tab === k)); for (const p of document.querySelectorAll(".pane")) p.hidden = p.id !== "pane-" + k; }
$("sideTabs").addEventListener("click", (e) => { const k = e.target.dataset?.tab; if (k) showTab(k); });

// ------------------------------------------------------------------ picking / hovering parts
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let hovered = null, selectedBom = -1;
function pickAt(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects((B?.meshes || []).filter((m) => m.visible && m.material !== ghostMat), false);
  return hits[0]?.object || null;
}
renderer.domElement.addEventListener("pointermove", (ev) => {
  const m = pickAt(ev), H = $("hover");
  if (hovered && hovered !== m && hovered.material.emissive && hovered.material !== ghostMat && !hovered.userData.layer.match(/display/)) hovered.material.emissiveIntensity = 0;
  hovered = m;
  if (!m) { H.hidden = true; return; }
  const p = spec.parts[m.userData.bom];
  if (m.material.emissive && m.userData.layer !== "display") { m.material.emissive.set(0x335577); m.material.emissiveIntensity = 0.8; }
  H.hidden = false;
  const r = stage.getBoundingClientRect();
  H.style.left = `${ev.clientX - r.left + 14}px`; H.style.top = `${ev.clientY - r.top + 10}px`;
  H.replaceChildren(el("b", {}, m.userData.name || p?.name || ""), el("span", { class: "muted" }, `${LAYER[m.userData.layer]?.label || ""}${p ? " · " + p.name : ""}`), p?.spec ? el("div", {}, p.spec) : null);
});
renderer.domElement.addEventListener("click", (ev) => { const m = pickAt(ev); if (m && m.userData.bom >= 0) focusPart(m.userData.bom, false); });
function focusPart(i, fly = true) {
  selectedBom = i;
  showTab("parts");
  for (const r of document.querySelectorAll(".part")) r.classList.toggle("sel", +r.dataset.i === i);
  document.querySelector(`.part[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  const ms = B.meshes.filter((m) => m.userData.bom === i);
  if (fly && ms.length) { const bb = new THREE.Box3(); ms.forEach((m) => bb.expandByObject(m)); controls.target.copy(bb.getCenter(V3())); }
  flashT = 1.6; flashList = ms;
}
let flashT = 0, flashList = [];

// labels for the main parts
let labelsDirty = true;
function updateLabels() {
  const on = $("chkLabels").checked;
  const box = $("labels");
  if (!on || !B) { box.replaceChildren(); return; }
  if (labelsDirty) {
    // one label per real part on the parts list, on top of the first piece of it (servos in the legs too)
    box.replaceChildren();
    B.labelled = [];
    const seen = new Set();
    for (const m of B.meshes) {
      const i = m.userData.bom; if (i < 0 || seen.has(i) || m.userData.wire) continue;
      seen.add(i);
      const p = spec.parts[i];
      const it = { obj: m, layer: p.layer, label: el("div", { class: "plabel" }, el("b", {}, p.name), p.qty > 1 ? ` ×${p.qty}` : "") };
      box.append(it.label); B.labelled.push(it);
    }
    labelsDirty = false;
  }
  const r = renderer.domElement.getBoundingClientRect();
  for (const it of B.labelled || []) {
    if (!it.label) continue;
    const p = it.obj.getWorldPosition(V3()).project(camera);
    const vis = p.z < 1 && it.obj.visible && !assembling && (view === "all" || view === "xray" || view === it.layer || view === "exploded");
    it.label.style.display = vis ? "" : "none";
    it.sx = r.left + (p.x * 0.5 + 0.5) * r.width; it.sy = r.top + (-p.y * 0.5 + 0.5) * r.height - 6; it.vis = vis;
  }
  // stack labels that would cover each other (closest to the top first)
  const placed = [];
  for (const it of (B.labelled || []).filter((x) => x.vis).sort((a, b) => a.sy - b.sy)) {
    const w = (it.w ||= it.label.offsetWidth || 90);
    let y = it.sy;
    for (let k = 0; k < 12 && placed.some((o) => Math.abs(o.x - it.sx) < (w + o.w) / 2 + 4 && Math.abs(o.y - y) < 19); k++) y -= 19;
    placed.push({ x: it.sx, y, w });
    it.label.style.left = `${it.sx}px`; it.label.style.top = `${y}px`;
  }
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let liveTick = 0, wireTick = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  if (B) {
    if (assembling) stepAssembly(dt);
    if (simOn) simulate(dt);
    // exploded view: every part slides away from the middle
    explodeK += ((explode ? 1 : 0) - explodeK) * Math.min(1, dt * 5);
    if (explodeK > 0.001 || explode) for (const m of B.meshes) {
      if (!m.userData.base || m.userData.wire || assembling) continue;
      const dir = m.userData.base.clone(); if (dir.lengthSq() < 1e-4) dir.set(0, 1, 0);
      m.position.copy(m.userData.base).add(dir.normalize().multiplyScalar(explodeK * 0.6 * (1 + m.userData.base.length() * 0.4)));
    }
    if (simOn || explodeK > 0.001 || (wireTick++ % 30 === 0)) { B.root.updateMatrixWorld(true); for (const w of B.wires) routeWire(w); }
    if (flashT > 0) { flashT -= dt; for (const m of flashList) if (m.material.emissive && m.material !== ghostMat) { m.material.emissive.set(0xffaa33); m.material.emissiveIntensity = Math.max(0, Math.sin(flashT * 8)) * 0.9; } }
    if (simOn && (liveTick += dt) > 0.25) { liveTick = 0; if (!$("pane-live").hidden) drawLive(); }
  }
  controls.update();
  gizmo?.update();
  renderer.render(scene, camera);
  updateLabels();
});

// ------------------------------------------------------------------ UI wiring
function toast(text, ms = 2600) { const t = $("toast"); t.textContent = text; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms); }
$("views").replaceChildren(...VIEWS.map(([k, label]) => el("button", { "data-v": k, onclick: () => setView(k) }, label)));
const IDEAS = ["create a robot dog", "a six-legged spider robot", "a humanoid animatronic butler", "a robot car that avoids walls", "a tank robot with tracks",
  "a 6-axis robotic arm that picks up blocks", "a camera drone", "a snake robot", "a robot fish", "build a 55 inch smart TV", "a smart speaker with an LED ring",
  "a smartwatch with heart-rate sensor", "a smart desk fan", "a retro game console", "a phone"];
$("examples").append(...IDEAS.map((i) => el("option", { value: i }, i)));
$("examples").onchange = () => { if ($("examples").value) { $("prompt").value = $("examples").value; generate(); } $("examples").value = ""; };
$("emptyIdeas").append(...IDEAS.slice(0, 8).map((i) => el("button", { onclick: () => { $("prompt").value = i; generate(); } }, i)));
$("genForm").addEventListener("submit", (e) => { e.preventDefault(); generate(); });
$("btnAssemble").onclick = () => (assembling ? finishAssembly() : assemble());
$("btnSim").onclick = () => (simOn ? stopSim() : startSim());
$("btnManual").onclick = () => setManual(!manual);
$("chkLabels").onchange = () => { labelsDirty = true; };
$("back").onclick = () => { location.href = "../index.html"; };
$("modalClose").onclick = () => ($("modal").hidden = true);
$("btnSave").onclick = async () => { if (!spec) return toast("Generate something first."); const out = structuredClone(spec);                       // hand-added parts are re-added from the edits on load
  out.parts = out.parts.map((p) => ({ ...p, qty: p.qty - (p.added || 0), added: 0 })).filter((p) => p.qty > 0);
  const r = await call("build_save", out); toast(r.error || `Saved as “${r.name}”`); };
$("btnOpen").onclick = async () => {
  const list = await call("build_projects");
  const items = Array.isArray(list) ? list : list?.projects || [];
  $("modalBody").replaceChildren(el("h3", {}, "Your builds"), items.length ? el("div", {}, ...items.map((p) => el("div", { class: "part", onclick: async () => { const r = await call("build_load", p.name); if (r.spec) { build(r.spec); $("modal").hidden = true; } else toast(r.error || "Couldn't open it"); } },
    el("span", {}, p.name), el("span", { class: "q" }, p.saved)))) : el("p", { class: "muted" }, "No saved builds yet."));
  $("modal").hidden = false;
};

async function generate() {
  const prompt = $("prompt").value.trim();
  if (!prompt) return toast("Type what to build first.");
  stopSim();
  $("busy").hidden = false; $("busyText").textContent = "Designing it… (the AI picks the parts, ~5-20 s)";
  $("genBtn").disabled = true;
  const r = await call("build_design", prompt);
  $("genBtn").disabled = false; $("busy").hidden = true;
  if (r?.error) return toast(r.error, 5000);
  build(r);
  assemble();                    // exoskeleton first, then motors, electronics, wires... then it's ready to simulate
  setTimeout(() => { if (!assembling && !simOn) startSim(); }, 100);
  const wait = setInterval(() => { if (!assembling) { clearInterval(wait); if (!simOn) startSim(); } }, 300);
}

// a build handed over from the Robotics panel, or the last one you had open
(async () => {
  const pend = await call("build_pending");
  if (pend && pend.prompt && !pend.template) { $("prompt").value = pend.prompt; generate(); return; }
  if (pend && pend.template) { build(pend); return; }
  const q = new URLSearchParams(location.search).get("prompt");
  if (q) { $("prompt").value = q; generate(); return; }
  try { const last = JSON.parse(localStorage.getItem("builder_last") || "null"); if (last?.template) build(last); } catch { /* ignore */ }
})();
window.__builder = { finishAssembly, setManual, addPart: (k) => addPart(k), get selected() { return selected; }, build: (s) => build(s), get B() { return B; }, get spec() { return spec; }, setView, startSim, stopSim, assemble, get assembling() { return assembling; } };
