// gymroom.js - the dark home-gym room that replaces the cozy room while a gym session is running.
// Mirror wall on the left, power rack, benches, dumbbell rack, bike, slatted wall with a warm LED strip,
// recessed ceiling lights and a TV that shows your workout time.
import * as THREE from "three";
import { Mirror } from "./mirror.js";

const W = 5, BACK = -4, FRONT = 4.5, H = 3.2;           // same size as the cozy room

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });
const M = {
  wall: mat(0x55565c, { roughness: 0.9 }),
  ceil: mat(0x2a2a2e, { roughness: 1 }),
  steel: mat(0x1b1c1f, { roughness: 0.35, metalness: 0.6 }),       // black powder-coated steel
  chrome: mat(0x9aa0a8, { roughness: 0.25, metalness: 1 }),
  rubber: mat(0x141416, { roughness: 0.85 }),
  pad: mat(0x1c1c1e, { roughness: 0.55 }),
  mat: mat(0x18181b, { roughness: 1 }),
  wood: mat(0x6b5440, { roughness: 0.7 }),
  glowWarm: new THREE.MeshBasicMaterial({ color: 0xffc58a, toneMapped: false }),
  glowWhite: new THREE.MeshBasicMaterial({ color: 0xfff6e8, toneMapped: false }),
};

function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true;
  return b;
}
function cyl(r, len, m, seg = 20) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
  c.castShadow = true; c.receiveShadow = true;
  return c;
}

function rubberTexture() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 512;
  const g = cv.getContext("2d");
  g.fillStyle = "#33353a"; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {                       // the little flecks in gym rubber flooring
    const v = 40 + Math.random() * 50;
    g.fillStyle = `rgba(${v},${v},${v + 4},${0.35 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1.6, 1.6);
  }
  g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = 2;   // tile seams
  for (const p of [0, 256]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.moveTo(0, p); g.lineTo(512, p); g.stroke(); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 4.25);
  t.anisotropy = 8;
  return t;
}

// ---------- equipment ----------
function dumbbell(len, r) {                               // lies along Z
  const g = new THREE.Group();
  const h = cyl(0.018, len, M.chrome, 10); h.rotation.x = Math.PI / 2; g.add(h);
  for (const s of [-1, 1]) { const head = cyl(r, 0.09 + r * 0.4, M.rubber, 6); head.rotation.x = Math.PI / 2; head.position.z = s * (len / 2 - 0.02); g.add(head); }
  return g;
}

function powerRack() {
  const g = new THREE.Group();
  const [x0, x1, z0, z1, top] = [-0.6, 0.6, -0.65, 0.65, 2.35];
  for (const x of [x0, x1]) for (const z of [z0, z1]) g.add(box(0.075, top, 0.075, M.steel, x, top / 2, z));
  for (const x of [x0, x1]) g.add(box(0.075, 0.075, z1 - z0 + 0.075, M.steel, x, top, 0));
  for (const z of [z0, z1]) { g.add(box(x1 - x0, 0.075, 0.075, M.steel, 0, top, z)); g.add(box(x1 - x0 + 0.3, 0.06, 0.12, M.steel, 0, 0.03, z)); }
  const pull = cyl(0.02, x1 - x0 + 0.2, M.chrome, 10); pull.rotation.z = Math.PI / 2; pull.position.set(0, top - 0.12, z1 + 0.02); g.add(pull);
  for (const z of [z0, z1]) for (const y of [0.9, 1.3]) g.add(box(0.06, 0.07, 0.1, M.steel, x1 - 0.02, y, z));   // J-hooks / safeties
  // loaded barbell on the hooks
  const bar = new THREE.Group();
  const shaft = cyl(0.016, 2.2, M.chrome, 12); shaft.rotation.x = Math.PI / 2; bar.add(shaft);
  for (const s of [-1, 1]) {
    for (const [r, off] of [[0.225, 0.82], [0.225, 0.87], [0.16, 0.92]]) {
      const plate = cyl(r, 0.04, M.rubber, 32); plate.rotation.x = Math.PI / 2; plate.position.z = s * off; bar.add(plate);
    }
    const collar = cyl(0.03, 0.04, M.chrome, 12); collar.rotation.x = Math.PI / 2; collar.position.z = s * 0.96; bar.add(collar);
  }
  bar.position.set(x1 - 0.02, 1.36, 0);
  g.add(bar);
  // plate storage pegs on the back with a few plates
  for (const z of [z0, z1]) {
    const peg = cyl(0.025, 0.25, M.steel, 10); peg.rotation.z = Math.PI / 2; peg.position.set(x0 - 0.12, 0.45, z); g.add(peg);
    for (let i = 0; i < 3; i++) { const p = cyl(0.225 - i * 0.03, 0.04, M.rubber, 28); p.rotation.z = Math.PI / 2; p.position.set(x0 - 0.06 - i * 0.045, 0.45, z); g.add(p); }
  }
  return g;
}

function bench({ incline = 0 } = {}) {                     // along X
  const g = new THREE.Group();
  g.add(box(1.15, 0.06, 0.06, M.steel, 0, 0.18, 0));
  for (const x of [-0.5, 0.5]) { g.add(box(0.06, 0.18, 0.06, M.steel, x, 0.09, 0)); g.add(box(0.07, 0.04, 0.42, M.steel, x, 0.02, 0)); }
  g.add(box(0.06, 0.24, 0.06, M.steel, 0.1, 0.3, 0));
  const seat = box(0.42, 0.09, 0.3, M.pad, -0.32, 0.46, 0); g.add(seat);
  const back = box(0.72, 0.09, 0.3, M.pad, 0.27, 0.46, 0);
  if (incline) { back.rotation.z = incline; back.position.set(0.24, 0.46 + Math.sin(incline) * 0.33, 0); }
  g.add(back);
  return g;
}

function dumbbellRack() {                                  // along X, against the back wall
  const g = new THREE.Group();
  const len = 2.6;
  for (const x of [-len / 2, 0, len / 2]) {
    g.add(box(0.06, 0.85, 0.06, M.steel, x, 0.425, 0.05)); g.add(box(0.06, 0.06, 0.55, M.steel, x, 0.03, 0));
  }
  for (const [y, z] of [[0.42, 0.08], [0.78, -0.06]]) {
    for (const zz of [z - 0.09, z + 0.09]) g.add(box(len + 0.06, 0.03, 0.03, M.steel, 0, y, zz));
  }
  const tiers = [[0.42, 0.08, [0.08, 0.085, 0.09, 0.095, 0.1, 0.105, 0.11, 0.115]], [0.78, -0.06, [0.06, 0.062, 0.066, 0.07, 0.072, 0.075, 0.078, 0.08]]];
  for (const [y, z, sizes] of tiers) {
    sizes.forEach((r, i) => {
      const d = dumbbell(0.34, r);
      d.position.set(-len / 2 + 0.17 + i * ((len - 0.34) / (sizes.length - 1)), y + r + 0.012, z);
      g.add(d);
    });
  }
  return g;
}

function bike() {                                          // faces -X
  const g = new THREE.Group();
  g.add(box(1.1, 0.05, 0.1, M.steel, 0, 0.05, 0));
  for (const x of [-0.5, 0.5]) g.add(box(0.08, 0.05, 0.55, M.steel, x, 0.03, 0));
  const fly = cyl(0.27, 0.06, M.steel, 36); fly.rotation.x = Math.PI / 2; fly.position.set(-0.32, 0.38, 0); g.add(fly);
  const flyRim = cyl(0.23, 0.065, M.chrome, 36); flyRim.rotation.x = Math.PI / 2; flyRim.position.copy(fly.position); g.add(flyRim);
  const post = box(0.07, 0.75, 0.07, M.steel, 0.1, 0.45, 0); post.rotation.z = -0.35; g.add(post);
  g.add(box(0.07, 0.6, 0.07, M.steel, 0.32, 0.6, 0).rotateZ(0.12));
  g.add(box(0.32, 0.07, 0.2, M.pad, 0.36, 0.93, 0));                     // seat
  const stem = box(0.07, 0.7, 0.07, M.steel, -0.38, 0.85, 0); stem.rotation.z = 0.3; g.add(stem);
  g.add(box(0.07, 0.05, 0.48, M.steel, -0.5, 1.18, 0));                  // handlebar
  const screen = box(0.03, 0.18, 0.26, M.steel, -0.47, 1.33, 0); screen.rotation.z = 0.35; g.add(screen);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.13), new THREE.MeshBasicMaterial({ color: 0x46b3ff, toneMapped: false }));
  glow.position.set(-0.49, 1.33, 0); glow.rotation.set(0, -Math.PI / 2, 0.35); g.add(glow);
  for (const s of [-1, 1]) { const crank = box(0.04, 0.18, 0.03, M.chrome, -0.05, 0.36, s * 0.1); crank.rotation.z = s * 0.8; g.add(crank); }
  return g;
}

function kettlebell(r) {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), M.rubber); ball.position.y = r; ball.castShadow = true; g.add(ball);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(r * 0.62, r * 0.13, 10, 24, Math.PI), M.steel);
  handle.position.y = r * 1.75; handle.castShadow = true; g.add(handle);
  return g;
}

function tvTexture() {
  const cv = document.createElement("canvas"); cv.width = 512; cv.height = 288;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = (big, small) => {
    const g = cv.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 512, 288); grad.addColorStop(0, "#0b0c10"); grad.addColorStop(1, "#141821");
    g.fillStyle = grad; g.fillRect(0, 0, 512, 288);
    g.fillStyle = "#e9eef5"; g.textAlign = "center";
    g.font = "bold 96px system-ui, sans-serif"; g.fillText(big, 256, 160);
    g.fillStyle = "#7f8ea3"; g.font = "600 28px system-ui, sans-serif"; g.fillText(small, 256, 220);
    g.fillStyle = "#3d8bff"; g.fillRect(156, 246, 200, 4);
    tex.needsUpdate = true;
  };
  draw("GYM", "let's get it");
  return { tex, draw };
}

// ---------- the room ----------
export function buildGymRoom() {
  const g = new THREE.Group();
  g.name = "gymRoom";
  const add = (o) => (g.add(o), o);

  // shell
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(W * 2, FRONT - BACK), mat(0xffffff, { map: rubberTexture(), roughness: 0.92 })));
  floor.rotation.x = -Math.PI / 2; floor.position.z = (FRONT + BACK) / 2; floor.receiveShadow = true; floor.userData.floor = true;
  const back = add(new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), M.wall)); back.position.set(0, H / 2, BACK); back.receiveShadow = true;
  for (const side of [-1, 1]) {
    const wall = add(new THREE.Mesh(new THREE.PlaneGeometry(FRONT - BACK, H), M.wall));
    wall.position.set(side * W, H / 2, (FRONT + BACK) / 2); wall.rotation.y = -side * Math.PI / 2; wall.receiveShadow = true;
  }
  const ceil = add(new THREE.Mesh(new THREE.PlaneGeometry(W * 2, FRONT - BACK), M.ceil));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, (FRONT + BACK) / 2);
  add(box(W * 2, 0.08, 0.03, M.steel, 0, 0.04, BACK + 0.015));                       // skirting

  // mirror wall (left), with a thin black frame and a warm light strip above it
  const mz0 = BACK + 0.25, mz1 = 2.6, my0 = 0.12, my1 = 2.62;
  const mirror = new Mirror(new THREE.PlaneGeometry(mz1 - mz0, my1 - my0), { tint: 0xe2e6ec, resolution: 1024 });
  mirror.position.set(-W + 0.03, (my0 + my1) / 2, (mz0 + mz1) / 2); mirror.rotation.y = Math.PI / 2;
  add(mirror);
  for (const y of [my0 - 0.02, my1 + 0.02]) add(box(0.04, 0.04, mz1 - mz0 + 0.08, M.steel, -W + 0.03, y, (mz0 + mz1) / 2));
  for (const z of [mz0 - 0.02, mz1 + 0.02]) add(box(0.04, my1 - my0 + 0.08, 0.04, M.steel, -W + 0.03, (my0 + my1) / 2, z));
  for (let z = mz0 + 1.2; z < mz1 - 0.2; z += 1.2) add(box(0.02, my1 - my0, 0.012, M.steel, -W + 0.035, (my0 + my1) / 2, z));   // panel seams
  add(box(0.06, 0.03, mz1 - mz0, M.glowWarm, -W + 0.05, H - 0.04, (mz0 + mz1) / 2));

  // slatted wood wall (back right) with LED cove
  const sx0 = 1.2, sx1 = W - 0.05;
  add(box(sx1 - sx0, H - 0.1, 0.02, mat(0x101012), (sx0 + sx1) / 2, (H - 0.1) / 2, BACK + 0.012));
  for (let x = sx0 + 0.04; x < sx1; x += 0.11) add(box(0.06, H - 0.16, 0.05, M.wood, x, (H - 0.16) / 2 + 0.02, BACK + 0.045));
  add(box(sx1 - sx0, 0.025, 0.05, M.glowWarm, (sx0 + sx1) / 2, H - 0.05, BACK + 0.09));

  // TV on the back wall
  const tv = tvTexture();
  add(box(1.5, 0.86, 0.06, M.steel, -0.55, 1.75, BACK + 0.05));
  const screen = add(new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.8), new THREE.MeshBasicMaterial({ map: tv.tex, toneMapped: false })));
  screen.position.set(-0.55, 1.75, BACK + 0.085);

  // recessed ceiling downlights (the glowing dots) + the real lights
  for (const x of [-3.2, -1.1, 1.1, 3.2]) for (const z of [-2.6, -0.4, 1.8, 3.8]) {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20), M.steel); ring.rotation.x = Math.PI / 2; ring.position.set(x, H - 0.004, z); g.add(ring);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.055, 20), M.glowWhite); dot.rotation.x = Math.PI / 2; dot.position.set(x, H - 0.006, z); g.add(dot);
  }
  const lights = [];
  const hemi = new THREE.HemisphereLight(0xc3c9d4, 0x3a3a40, 2.0); g.add(hemi); lights.push(hemi);
  for (const [x, z] of [[-3.2, -1.5], [-1.1, 1.8], [1.1, -0.4], [3.2, -2.6], [3.2, 1.8], [-1.1, -2.6]]) {
    const s = new THREE.SpotLight(0xfff1de, 38, 8, 0.8, 0.85, 1.4);
    s.position.set(x, H - 0.05, z); s.target.position.set(x, 0, z + 0.2);
    g.add(s, s.target); lights.push(s);
  }
  const key = new THREE.SpotLight(0xfff4e6, 14, 10, 0.75, 0.9, 1.3);     // the one that casts the character's shadow
  key.position.set(0.8, H - 0.05, 2.6); key.target.position.set(0.3, 0, 0.8);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0006;
  g.add(key, key.target); lights.push(key);
  const cove = new THREE.PointLight(0xffb070, 9, 6, 1.6); cove.position.set(3, H - 0.3, BACK + 0.5); g.add(cove);
  const cove2 = new THREE.PointLight(0xffb070, 6, 5, 1.6); cove2.position.set(-W + 0.4, H - 0.3, -0.5); g.add(cove2);

  const spots = [{ kind: "gym", label: "the mirror", x: -3.9, z: 0.6 }];      // the equipment adds its own spots

  let shown = "";
  return {
    group: g, mirror, spots,
    /** Shows the session clock on the TV (seconds since start). */
    setClock(sec) {
      const s = Math.max(0, Math.floor(sec)), txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (txt !== shown) { shown = txt; tv.draw(txt, "workout time"); }
    },
    dispose() {
      g.traverse((o) => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) { if (!Object.values(M).includes(m)) { m.map?.dispose(); m.dispose?.(); } } });
      mirror.dispose(); tv.tex.dispose();
    },
  };
}

// ---------- the equipment: normal room items, so the gym can be edited like the cozy room ----------
const wrap = (obj, y = 0) => { const g = new THREE.Group(); obj.position.y += y; g.add(obj); return g; };
export const GYM_CATALOG = {
  gymRack: { label: "Squat rack + barbell", category: "gym", mount: "floor", build() { return { group: wrap(powerRack()) }; } },
  gymFlatBench: { label: "Flat bench", category: "gym", mount: "floor", build() { return { group: wrap(bench()) }; } },
  gymInclineBench: { label: "Adjustable bench", category: "gym", mount: "floor", build() { return { group: wrap(bench({ incline: 0.42 })) }; } },
  gymDumbbellRack: { label: "Dumbbell rack", category: "gym", mount: "floor", build() { return { group: wrap(dumbbellRack()) }; } },
  gymBike: { label: "Exercise bike", category: "gym", mount: "floor", build() { return { group: wrap(bike(), 0.015) }; } },
  gymDumbbells: { label: "Pair of dumbbells", category: "gym", mount: "floor", build() {
    const g = new THREE.Group();
    for (const x of [-0.13, 0.13]) { const d = dumbbell(0.34, 0.1); d.position.set(x, 0.1, 0); g.add(d); }
    return { group: g };
  } },
  gymKettlebells: { label: "Kettlebells", category: "gym", mount: "floor", build() {
    const g = new THREE.Group();
    [[-0.32, 0.13], [0, 0.11], [0.28, 0.1]].forEach(([x, r]) => { const k = kettlebell(r); k.position.x = x; g.add(k); });
    return { group: g };
  } },
  gymMedBalls: { label: "Medicine balls", category: "gym", mount: "floor", build() {
    const g = new THREE.Group();
    for (const [x, z, r] of [[-0.2, 0, 0.2], [0.18, -0.12, 0.17], [0.1, 0.25, 0.18]]) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), M.rubber); ball.position.set(x, r, z); ball.castShadow = true; g.add(ball);
    }
    return { group: g };
  } },
  gymMat: { label: "Rubber floor mat", category: "gym", mount: "floor", flat: true, build() {
    const g = new THREE.Group(); const m = box(2.0, 0.015, 2.6, M.mat, 0, 0.008, 0); m.castShadow = false; g.add(m);
    return { group: g, walkable: true };
  } },
};

/** The gym the first time you open it (you can change everything in Edit room). */
export const GYM_LAYOUT = { items: [
  { type: "gymMat", x: 2.1, z: 1.0, rot: 0 }, { type: "gymMat", x: 3.6, z: -2.5, rot: Math.PI / 2 }, { type: "gymMat", x: -3.6, z: -1.5, rot: 0 },
  { type: "gymRack", x: -3.6, z: -1.5, rot: 0 }, { type: "gymFlatBench", x: -2.0, z: -1.5, rot: 0 },
  { type: "gymInclineBench", x: 2.1, z: 0.8, rot: -0.35 }, { type: "gymDumbbells", x: 1.7, z: 2.0, rot: 0.4 },
  { type: "gymDumbbellRack", x: -0.55, z: -3.6, rot: 0 }, { type: "gymBike", x: 3.6, z: -2.5, rot: 0 },
  { type: "gymMedBalls", x: -4.3, z: 1.5, rot: 0 }, { type: "gymKettlebells", x: 2.35, z: -3.55, rot: 0 },
] };
