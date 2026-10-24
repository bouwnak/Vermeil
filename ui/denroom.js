// denroom.js - "warm den" furniture: chunky, rounded, warm wood + olive greens (a cosy diorama look).
// Every piece is built from simple rounded shapes so it stays light. Front of each piece = +z, back = -z.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const C = {
  wood: 0xd9843f, woodLight: 0xeaa560, woodDark: 0xb0602c, cream: 0xf4e3c2, creamDark: 0xe2c99b,
  olive: 0xa7b03c, oliveDark: 0x8a9530, green: 0x5f8a3e, leaf: 0x6f9a3c, leafDark: 0x4f7a2e,
  pot: 0xf1ece2, terracotta: 0xc8673a, yellow: 0xf2c24f, pink: 0xe58fa0, grey: 0x5d5560, black: 0x2b2730,
};
const mats = {};
const m = (color, o = {}) => (mats[color + JSON.stringify(o)] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...o }));
const glowMat = (color, i = 1.6) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i, roughness: 0.6 });

function rb(w, h, d, color, x = 0, y = 0, z = 0, r = 0.02) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.05, h / 2.05, d / 2.05)), typeof color === "number" ? m(color) : color);
  mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
function cyl(rt, rb_, h, color, x = 0, y = 0, z = 0, seg = 16) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb_, h, seg), typeof color === "number" ? m(color) : color);
  mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function books(g, w, y, z, maxH = 0.26) {
  const cols = [C.pink, C.cream, 0xd7d1e8, C.creamDark, 0xf08e6e, C.olive, 0x9ec1d9];
  let x = -w / 2 + 0.03;
  while (x < w / 2 - 0.06) {
    const bw = 0.03 + rnd() * 0.035, bh = maxH * (0.7 + rnd() * 0.3);
    if (rnd() < 0.15) { x += 0.05; continue; }
    g.add(rb(bw, bh, 0.17, cols[Math.floor(rnd() * cols.length)], x + bw / 2, y + bh / 2, z, 0.006));
    x += bw + 0.005;
  }
}

function leafyPlant(size = 1, potColor = C.pot) {
  const g = new THREE.Group();
  g.add(cyl(0.13 * size, 0.1 * size, 0.22 * size, potColor, 0, 0.11 * size, 0, 18));
  g.add(cyl(0.12 * size, 0.12 * size, 0.02, 0x5a3b26, 0, 0.215 * size, 0, 18));
  const leaf = new THREE.SphereGeometry(0.1 * size, 10, 6);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.4;
    const stem = cyl(0.008, 0.008, 0.3 * size, C.leafDark, Math.cos(a) * 0.05 * size, 0.33 * size, Math.sin(a) * 0.05 * size, 5);
    stem.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(stem);
    const l = new THREE.Mesh(leaf, m(i % 2 ? C.leaf : C.leafDark));
    l.scale.set(1.5, 0.35, 0.9); l.position.set(Math.cos(a) * 0.17 * size, (0.42 + rnd() * 0.12) * size, Math.sin(a) * 0.17 * size);
    l.rotation.set(rnd() * 0.6, -a, -0.5); l.castShadow = true; g.add(l);
  }
  return g;
}

function cactus(size = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.08 * size, 0.065 * size, 0.13 * size, C.terracotta, 0, 0.065 * size, 0, 16));
  const body = cyl(0.04 * size, 0.045 * size, 0.24 * size, C.leaf, 0, 0.25 * size, 0, 10); g.add(body);
  const arm = cyl(0.025 * size, 0.025 * size, 0.1 * size, C.leaf, 0.055 * size, 0.27 * size, 0, 8); arm.rotation.z = -0.6; g.add(arm);
  return g;
}

function lampLight(g, y, color = 0xffc77a, intensity = 4, dist = 4) {
  const l = new THREE.PointLight(color, intensity, dist, 2);
  l.position.y = y; g.add(l);
  return l;
}
function toggler(label, lights, shades) {
  let on = true;
  return { label: `${label}: switch on/off`, onClick: () => {
    on = !on;
    for (const l of lights) l.visible = on;
    for (const s of shades) s.material.emissiveIntensity = on ? 1.2 : 0.05;
    return on ? "on" : "off";
  } };
}

export const DEN_CATALOG = {
  denBookcase: { label: "Tall wood bookcase", mount: "floor", build() {
    const g = new THREE.Group();
    const w = 0.6, h = 2.3, d = 0.32;
    g.add(rb(0.05, h, d, C.wood, -w / 2, h / 2, 0), rb(0.05, h, d, C.wood, w / 2, h / 2, 0));
    g.add(rb(w, h, 0.03, C.woodDark, 0, h / 2, -d / 2 + 0.015));
    for (let i = 0; i <= 6; i++) g.add(rb(w, 0.04, d, C.wood, 0, 0.04 + i * 0.37, 0, 0.01));
    for (let i = 0; i < 6; i++) if (i !== 2) books(g, w - 0.06, 0.06 + i * 0.37, 0.02);
    const car = rb(0.2, 0.08, 0.1, 0x7fae8a, 0.1, 0.06 + 2 * 0.37 + 0.04, 0.02, 0.03); g.add(car);
    return { group: g };
  } },

  denTv: { label: "TV stand + TV + speakers", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(rb(1.5, 0.05, 0.5, C.wood, 0, 0.55, 0), rb(1.5, 0.05, 0.5, C.wood, 0, 0.3, 0), rb(1.5, 0.04, 0.5, C.woodDark, 0, 0.1, 0));
    for (const x of [-0.72, 0.72]) g.add(rb(0.06, 0.55, 0.5, C.wood, x, 0.3, 0));
    for (const x of [-0.65, 0.65]) for (const z of [-0.18, 0.18]) g.add(cyl(0.02, 0.015, 0.08, C.black, x, 0.04, z, 8));
    g.add(rb(0.3, 0.06, 0.25, C.black, -0.3, 0.36, 0), rb(0.22, 0.05, 0.2, 0xd34a3a, 0.25, 0.155, 0));
    g.add(rb(0.35, 0.03, 0.15, C.black, 0, 0.59, 0));                                    // TV foot
    g.add(rb(0.06, 0.15, 0.05, C.black, 0, 0.67, 0));
    g.add(rb(1.25, 0.75, 0.06, C.grey, 0, 1.12, 0, 0.03));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.65), glowMat(0xf6f0ea, 0.08));
    screen.position.set(0, 1.12, 0.032); g.add(screen);
    for (const x of [-0.95, 0.95]) {                                                       // speakers
      g.add(rb(0.24, 0.85, 0.24, C.grey, x, 0.43, 0, 0.03));
      for (const y of [0.25, 0.55, 0.75]) { const c = cyl(0.07 - (y > 0.7 ? 0.03 : 0), 0.07 - (y > 0.7 ? 0.03 : 0), 0.02, C.black, x, y, 0.12, 18); c.rotation.x = Math.PI / 2; g.add(c); }
    }
    let on = false;
    return { group: g, interact: { label: "TV: switch on/off", onClick: () => {
      on = !on; screen.material.color.set(on ? 0x8fc4ff : 0xf6f0ea); screen.material.emissive.set(on ? 0x6fb0ff : 0xf6f0ea);
      screen.material.emissiveIntensity = on ? 1.4 : 0.08; return on ? "on" : "off";
    } } };
  } },

  denSofa: { label: "Olive sofa", mount: "floor", build() {
    const g = new THREE.Group();
    const w = 2.3;
    g.add(rb(w, 0.28, 0.9, C.olive, 0, 0.33, 0, 0.08));
    g.add(rb(w, 0.55, 0.26, C.olive, 0, 0.64, -0.33, 0.1));
    for (const x of [-w / 2 + 0.11, w / 2 - 0.11]) g.add(rb(0.24, 0.42, 0.9, C.olive, x, 0.5, 0, 0.1));
    for (const x of [-0.5, 0.5]) g.add(rb(1.0, 0.13, 0.62, C.olive, x, 0.53, 0.08, 0.06));    // seat cushions
    for (const x of [-0.5, 0.5]) g.add(rb(0.95, 0.42, 0.16, C.oliveDark, x, 0.78, -0.18, 0.08));   // back cushions
    for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) for (const z of [-0.35, 0.35]) g.add(cyl(0.03, 0.02, 0.2, C.creamDark, x, 0.1, z, 8));
    return { group: g };
  } },

  denOttoman: { label: "Round ottoman (dog bed)", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(rb(0.7, 0.3, 0.55, C.olive, 0, 0.27, 0, 0.12));
    for (const x of [-0.25, 0.25]) for (const z of [-0.18, 0.18]) g.add(cyl(0.03, 0.02, 0.12, C.woodDark, x, 0.06, z, 8));
    const dog = new THREE.Group();                                                          // sleepy shiba
    const fur = m(0xd98a46), white = m(0xf3e6d2);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 12), fur); body.scale.set(1.2, 0.6, 0.9); dog.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), fur); head.position.set(0.17, 0.02, 0.05); dog.add(head);
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), white); muzzle.position.set(0.24, -0.01, 0.07); dog.add(muzzle);
    for (const z of [-0.03, 0.06]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 8), fur); ear.position.set(0.17, 0.09, z + 0.03); dog.add(ear); }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.025, 8, 16, Math.PI * 1.4), fur); tail.position.set(-0.19, 0.04, 0); dog.add(tail);
    dog.traverse((o) => { o.castShadow = true; });
    dog.position.set(0, 0.48, 0); g.add(dog);
    return { group: g, update: (t) => { body.scale.y = 0.6 + Math.sin(t * 1.4) * 0.02; } };
  } },

  denCoffeeTable: { label: "Rounded coffee table", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(rb(1.0, 0.06, 0.6, C.woodLight, 0, 0.42, 0, 0.03));
    for (const x of [-0.4, 0.4]) for (const z of [-0.22, 0.22]) {
      const leg = cyl(0.025, 0.018, 0.4, C.wood, x, 0.2, z, 8); leg.rotation.set(z * 0.3, 0, -x * 0.25); g.add(leg);
    }
    g.add(rb(0.16, 0.012, 0.09, C.black, 0.25, 0.457, 0.1, 0.005), rb(0.05, 0.02, 0.16, C.grey, -0.15, 0.46, 0.15, 0.008));
    g.add(rb(0.22, 0.03, 0.16, C.cream, -0.3, 0.465, -0.1, 0.008));
    const p = leafyPlant(0.55); p.position.set(0.05, 0.45, -0.08); g.add(p);
    return { group: g };
  } },

  denFloorLamp: { label: "Yellow floor lamp", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(cyl(0.16, 0.18, 0.04, C.woodDark, 0, 0.02, 0, 20), cyl(0.02, 0.02, 1.45, C.woodDark, 0, 0.75, 0, 8));
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.24, 0.3, 24, 1, true), glowMat(C.yellow, 1.2));
    shade.material.side = THREE.DoubleSide; shade.position.y = 1.55; shade.castShadow = true; g.add(shade);
    const light = lampLight(g, 1.45, 0xffc77a, 6, 5);
    return { group: g, interact: toggler("Floor lamp", [light], [shade]) };
  } },

  denWallLamp: { label: "Wall lamp", mount: "wall", defaultY: 1.9, build() {
    const g = new THREE.Group();
    g.add(rb(0.08, 0.14, 0.04, C.woodDark, 0, 0, 0.02));
    const arm = cyl(0.015, 0.015, 0.25, C.woodDark, 0, 0.05, 0.13, 8); arm.rotation.x = Math.PI / 2; g.add(arm);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.17, 20, 1, true), glowMat(C.yellow, 1.2));
    shade.material.side = THREE.DoubleSide; shade.position.set(0, -0.02, 0.27); g.add(shade);
    const light = lampLight(g, -0.15, 0xffc77a, 3, 3.5); light.position.z = 0.3;
    return { group: g, interact: toggler("Wall lamp", [light], [shade]) };
  } },

  denCubeShelves: { label: "Cube wall shelves", mount: "wall", defaultY: 1.4, build() {
    const g = new THREE.Group();
    const cubes = [[-0.35, 0.0], [0.05, 0.25], [0.35, -0.2], [-0.2, 0.55], [0.45, 0.5]];
    for (const [x, y] of cubes) {
      const s = 0.36;
      g.add(rb(s, 0.04, 0.24, C.cream, x, y - s / 2, 0.12, 0.012), rb(s, 0.04, 0.24, C.cream, x, y + s / 2, 0.12, 0.012));
      g.add(rb(0.04, s, 0.24, C.cream, x - s / 2, y, 0.12, 0.012), rb(0.04, s, 0.24, C.cream, x + s / 2, y, 0.12, 0.012));
    }
    const vase = cyl(0.05, 0.06, 0.12, C.woodDark, -0.35, -0.12, 0.13, 12); g.add(vase);
    const cac = cactus(0.8); cac.position.set(0.35, -0.36, 0.12); g.add(cac);
    const frame = rb(0.18, 0.22, 0.03, C.wood, 0.05, 0.25, 0.08, 0.01); g.add(frame);
    books(g, 0.28, 0.4, 0.12, 0.2);
    return { group: g };
  } },

  denWindow: { label: "Tall wood window + curtains", mount: "wall", defaultY: 1.45, build() {
    const g = new THREE.Group();
    const w = 0.9, h = 1.9;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x8fbf6a, emissive: 0x6f9f4a, emissiveIntensity: 0.5, roughness: 0.4 }));
    glass.position.z = 0.02; g.add(glass);
    g.add(rb(w + 0.12, 0.08, 0.08, C.woodDark, 0, h / 2, 0.05), rb(w + 0.12, 0.08, 0.08, C.woodDark, 0, -h / 2, 0.05));
    for (const x of [-w / 2, 0, w / 2]) g.add(rb(0.06, h, 0.07, C.woodDark, x, 0, 0.05, 0.01));
    for (const y of [-0.45, 0.2]) g.add(rb(w, 0.05, 0.06, C.woodDark, 0, y, 0.05, 0.01));
    g.add(cyl(0.02, 0.02, w + 0.7, C.woodDark, 0, h / 2 + 0.12, 0.14, 8).rotateZ(Math.PI / 2));
    for (const s of [-1, 1]) {                                                              // soft curtains
      const cur = rb(0.32, h + 0.1, 0.08, C.cream, s * (w / 2 + 0.12), -0.02, 0.15, 0.04);
      cur.scale.x = 1; g.add(cur);
      for (let i = 0; i < 3; i++) g.add(rb(0.03, h + 0.05, 0.1, C.creamDark, s * (w / 2 + 0.02 + i * 0.1), -0.02, 0.16, 0.015));
    }
    return { group: g };
  } },

  denPanels: { label: "Wood wall panels (strip)", mount: "wall", defaultY: 2.75, build() {
    const g = new THREE.Group();
    const len = 3.0;
    g.add(rb(len, 0.62, 0.05, C.wood, 0, 0, 0.025, 0.01));
    for (let i = 0; i < 6; i++) {
      const x = -len / 2 + 0.25 + i * 0.5;
      g.add(rb(0.38, 0.4, 0.03, C.woodLight, x, 0.01, 0.06, 0.01), rb(0.3, 0.32, 0.02, C.yellow, x, 0.01, 0.075, 0.008));
    }
    g.add(rb(len, 0.05, 0.08, C.woodDark, 0, -0.33, 0.04, 0.01));
    return { group: g };
  } },

  denStripes: { label: "Striped wall boards", mount: "wall", defaultY: 1.2, build() {
    const g = new THREE.Group();
    for (let i = 0; i < 12; i++) g.add(rb(0.12, 2.4, 0.03, i % 2 ? C.cream : C.creamDark, -0.72 + i * 0.13, 0, 0.015, 0.01));
    return { group: g };
  } },

  denClock: { label: "Wall clock", mount: "wall", defaultY: 2.6, build() {
    const g = new THREE.Group();
    g.add(rb(0.36, 0.36, 0.06, C.woodLight, 0, 0, 0.03, 0.04), rb(0.29, 0.29, 0.02, C.cream, 0, 0, 0.065, 0.03));
    const hand = (len, w) => { const h = rb(w, len, 0.01, C.black, 0, len / 2, 0, 0.004); const p = new THREE.Group(); p.add(h); p.position.z = 0.08; g.add(p); return p; };
    const hr = hand(0.08, 0.018), mn = hand(0.12, 0.012);
    return { group: g, update: () => { const d = new Date(); mn.rotation.z = -(d.getMinutes() / 60) * Math.PI * 2; hr.rotation.z = -((d.getHours() % 12 + d.getMinutes() / 60) / 12) * Math.PI * 2; } };
  } },

  denFan: { label: "Ceiling fan", mount: "floor", defaultY: 2.55, build() {
    const g = new THREE.Group();
    g.add(cyl(0.02, 0.02, 0.5, C.woodDark, 0, 0.4, 0, 8), cyl(0.12, 0.1, 0.14, C.woodDark, 0, 0.12, 0, 16));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), glowMat(C.cream, 0.8)); bulb.position.y = 0.0; g.add(bulb);
    const blades = new THREE.Group(); blades.position.y = 0.14; g.add(blades);
    for (let i = 0; i < 4; i++) { const b = rb(0.62, 0.02, 0.14, C.wood, 0.4, 0, 0, 0.01); const p = new THREE.Group(); p.rotation.y = (i / 4) * Math.PI * 2; p.add(b); blades.add(p); }
    return { group: g, update: (t, dt) => { blades.rotation.y += dt * 2.2; } };
  } },

  denPlant: { label: "Leafy plant on a stand", mount: "floor", build() {
    const g = new THREE.Group();
    for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) g.add(cyl(0.015, 0.015, 0.22, C.woodDark, x, 0.11, z, 6));
    g.add(rb(0.34, 0.03, 0.34, C.woodDark, 0, 0.22, 0, 0.01));
    const p = leafyPlant(1.3); p.position.y = 0.23; g.add(p);
    return { group: g };
  } },

  denSideShelf: { label: "White side shelf + cactus", mount: "floor", build() {
    const g = new THREE.Group();
    const h = 1.1;
    g.add(rb(0.04, h, 0.36, C.cream, -0.2, h / 2, 0, 0.01), rb(0.04, h, 0.36, C.cream, 0.2, h / 2, 0, 0.01));
    for (let i = 0; i < 4; i++) g.add(rb(0.42, 0.035, 0.36, C.cream, 0, 0.02 + i * (h / 3), 0, 0.01));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), m(0xb07acb)); ball.position.set(-0.05, h / 3 + 0.12, 0); ball.castShadow = true; g.add(ball);
    g.add(rb(0.12, 0.2, 0.12, C.woodLight, 0.1, 0.13, 0, 0.02));
    const c = cactus(1); c.position.set(0, h + 0.02, 0); g.add(c);
    return { group: g };
  } },

  denSkateboard: { label: "Skateboard (leaning)", mount: "floor", build() {
    const g = new THREE.Group();
    const deck = rb(0.22, 0.8, 0.03, C.yellow, 0, 0.42, 0, 0.1); deck.rotation.x = -0.18; g.add(deck);
    for (const y of [0.2, 0.65]) for (const x of [-0.07, 0.07]) { const wh = cyl(0.03, 0.03, 0.03, C.cream, x, y, 0.06 - y * 0.18, 12); wh.rotation.z = Math.PI / 2; g.add(wh); }
    return { group: g };
  } },

  denBed: { label: "Wooden bed + olive blanket", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(rb(1.7, 0.28, 2.4, C.wood, 0, 0.2, 0, 0.04));
    for (const x of [-0.78, 0.78]) for (const z of [-1.12, 1.12]) g.add(rb(0.1, 0.1, 0.1, C.woodDark, x, 0.05, z, 0.02));
    g.add(rb(1.62, 0.2, 2.3, C.cream, 0, 0.44, 0.02, 0.07));                                // mattress
    g.add(rb(1.66, 0.08, 1.4, C.olive, 0, 0.56, 0.45, 0.04), rb(1.66, 0.35, 0.06, C.olive, 0, 0.4, 1.17, 0.03));  // blanket
    g.add(rb(1.66, 0.09, 0.3, C.cream, 0, 0.6, -0.2, 0.04));                                // folded sheet
    for (const x of [-0.42, 0.42]) g.add(rb(0.62, 0.16, 0.36, 0xfaf2e2, x, 0.62, -0.88, 0.08));
    g.add(rb(1.8, 1.0, 0.1, C.wood, 0, 0.55, -1.2, 0.04));
    for (let i = 0; i < 3; i++) g.add(rb(0.44, 0.5, 0.04, C.woodLight, -0.55 + i * 0.55, 0.7, -1.14, 0.02));
    return { group: g };
  } },

  denRug: { label: "Green striped rug", mount: "floor", flat: true, build() {
    const g = new THREE.Group();
    const cols = [C.green, 0x6f9446, C.green, 0x6f9446, C.green];
    cols.forEach((c, i) => { const s = rb(0.62, 0.012, 3.2, c, -1.24 + i * 0.62, 0.006, 0, 0.005); s.castShadow = false; g.add(s); });
    return { group: g, walkable: true };
  } },
};

export const DEN_LAYOUT = {
  shell: { wall: "#d98a4b", floor: "light wood", sky: "auto", brightness: 1.15 },
  items: [
    { type: "denRug", x: 0.3, z: 0.6, rot: Math.PI / 2 },
    { type: "denTv", x: -1.2, z: -3.65, rot: 0 },
    { type: "denBookcase", x: -3.4, z: -3.7, rot: 0 },
    { type: "denBookcase", x: 4.6, z: -1.6, rot: -Math.PI / 2 },
    { type: "denPlant", x: -2.55, z: -3.3, rot: 0 },
    { type: "denPlant", x: 1.0, z: -3.4, rot: 0.6 },
    { type: "denSkateboard", x: 1.7, z: -3.8, rot: 0 },
    { type: "denSofa", x: 3.9, z: 1.0, rot: -Math.PI / 2 },
    { type: "denOttoman", x: 2.8, z: -1.6, rot: 0.3 },
    { type: "denCoffeeTable", x: 1.9, z: 0.9, rot: Math.PI / 2 },
    { type: "denFloorLamp", x: 4.3, z: -0.4, rot: 0 },
    { type: "denSideShelf", x: 2.3, z: 2.9, rot: Math.PI },
    { type: "denFan", x: 0.6, z: 0.2, rot: 0, y: 2.55 },
    { type: "woodChair", x: -3.75, z: 2.0, rot: -Math.PI / 2 },
    { type: "woodDesk", x: -4.55, z: 2.0, rot: Math.PI / 2 },
    { type: "denBed", x: -3.75, z: -1.1, rot: Math.PI / 2 },
    { type: "denPanels", wall: "back", u: -2.6, y: 2.8 },
    { type: "denPanels", wall: "back", u: 0.4, y: 2.8 },
    { type: "denPanels", wall: "back", u: 3.4, y: 2.8 },
    { type: "denPanels", wall: "left", u: -2.5, y: 2.8 },
    { type: "denPanels", wall: "left", u: 0.5, y: 2.8 },
    { type: "denPanels", wall: "left", u: 3.5, y: 2.8 },
    { type: "denCubeShelves", wall: "back", u: -2.2, y: 1.55 },
    { type: "denClock", wall: "back", u: -1.2, y: 2.15 },
    { type: "denWallLamp", wall: "back", u: -4.3, y: 1.95 },
    { type: "denWindow", wall: "back", u: 3.1, y: 1.4 },
    { type: "denStripes", wall: "left", u: 3.8, y: 1.2 },
    { type: "denWindow", wall: "right", u: 2.6, y: 1.4 },
  ],
};

// ---------- more warm den pieces ----------
Object.assign(DEN_CATALOG, {
  denArmchair: { label: "Olive armchair", category: "seating", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(rb(0.95, 0.26, 0.85, C.olive, 0, 0.32, 0, 0.08));
    g.add(rb(0.95, 0.55, 0.22, C.olive, 0, 0.62, -0.32, 0.1));
    for (const x of [-0.42, 0.42]) g.add(rb(0.2, 0.38, 0.85, C.olive, x, 0.5, 0, 0.09));
    g.add(rb(0.62, 0.12, 0.6, C.olive, 0, 0.5, 0.06, 0.05), rb(0.6, 0.38, 0.14, C.oliveDark, 0, 0.74, -0.18, 0.07));
    for (const x of [-0.38, 0.38]) for (const z of [-0.32, 0.32]) g.add(cyl(0.028, 0.02, 0.2, C.creamDark, x, 0.1, z, 8));
    return { group: g };
  } },

  denDesk: { label: "Wooden desk + laptop", category: "tables", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(rb(1.3, 0.06, 0.62, C.wood, 0, 0.75, 0, 0.02));
    g.add(rb(0.42, 0.7, 0.56, C.woodDark, 0.42, 0.36, 0, 0.03));
    for (let i = 0; i < 2; i++) g.add(rb(0.36, 0.26, 0.02, C.woodLight, 0.42, 0.52 - i * 0.3, 0.285, 0.01), cyl(0.012, 0.012, 0.03, C.cream, 0.42, 0.55 - i * 0.3, 0.3, 6));
    for (const x of [-0.6]) for (const z of [-0.26, 0.26]) g.add(rb(0.05, 0.72, 0.05, C.woodDark, x, 0.36, z, 0.01));
    g.add(rb(0.36, 0.015, 0.24, C.grey, -0.1, 0.787, 0.06, 0.006));                           // laptop base
    const screen = rb(0.36, 0.23, 0.012, C.grey, -0.1, 0.9, -0.07, 0.006); screen.rotation.x = -0.25; g.add(screen);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.19), glowMat(0x9fd3ff, 0.9));
    glow.position.set(-0.1, 0.9, -0.062); glow.rotation.x = -0.25; g.add(glow);
    g.add(cyl(0.035, 0.03, 0.08, C.cream, 0.3, 0.82, 0.12, 12));                               // mug
    const p = cactus(0.8); p.position.set(0.48, 0.78, -0.15); g.add(p);
    return { group: g };
  } },

  denChair: { label: "Wooden chair + cushion", category: "seating", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(rb(0.46, 0.05, 0.44, C.wood, 0, 0.44, 0, 0.02), rb(0.4, 0.06, 0.38, C.olive, 0, 0.49, 0.01, 0.03));
    for (const x of [-0.19, 0.19]) for (const z of [-0.18, 0.18]) g.add(rb(0.045, 0.44, 0.045, C.woodDark, x, 0.22, z, 0.01));
    for (const x of [-0.19, 0.19]) g.add(rb(0.045, 0.5, 0.045, C.woodDark, x, 0.7, -0.18, 0.01));
    g.add(rb(0.42, 0.14, 0.035, C.woodLight, 0, 0.88, -0.18, 0.015), rb(0.42, 0.06, 0.03, C.woodLight, 0, 0.66, -0.18, 0.01));
    return { group: g };
  } },

  denBeanBag: { label: "Olive bean bag", category: "seating", mount: "floor", build() {
    const g = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 16), m(C.olive)); bag.scale.set(1.05, 0.6, 1); bag.position.y = 0.28; bag.castShadow = true; g.add(bag);
    const back = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 12), m(C.oliveDark)); back.scale.set(1.2, 0.9, 0.6); back.position.set(0, 0.5, -0.3); back.castShadow = true; g.add(back);
    return { group: g };
  } },

  denStool: { label: "Round wood stool", category: "seating", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(cyl(0.2, 0.2, 0.06, C.woodLight, 0, 0.47, 0, 24));
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; const leg = cyl(0.022, 0.018, 0.47, C.woodDark, Math.cos(a) * 0.12, 0.23, Math.sin(a) * 0.12, 8); leg.rotation.set(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15); g.add(leg); }
    return { group: g };
  } },

  denSideTable: { label: "Round side table + lamp", category: "lights", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(cyl(0.26, 0.26, 0.04, C.woodLight, 0, 0.55, 0, 28), cyl(0.03, 0.03, 0.53, C.woodDark, 0, 0.27, 0, 10), cyl(0.16, 0.18, 0.03, C.woodDark, 0, 0.015, 0, 20));
    g.add(cyl(0.05, 0.07, 0.16, C.cream, 0.05, 0.65, 0, 14));
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.15, 20, 1, true), glowMat(C.yellow, 1.2));
    shade.material.side = THREE.DoubleSide; shade.position.set(0.05, 0.8, 0); g.add(shade);
    g.add(rb(0.14, 0.03, 0.1, C.pink, -0.12, 0.585, 0.06, 0.008));
    const light = lampLight(g, 0.78, 0xffc77a, 3, 3);
    return { group: g, interact: toggler("Table lamp", [light], [shade]) };
  } },

  denRecordPlayer: { label: "Record player cabinet", category: "tech", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(rb(0.9, 0.55, 0.45, C.wood, 0, 0.3, 0, 0.04));
    for (const x of [-0.22, 0.22]) g.add(rb(0.4, 0.42, 0.02, C.woodLight, x, 0.3, 0.225, 0.015));
    for (let i = 0; i < 6; i++) g.add(rb(0.02, 0.3, 0.28, [C.pink, C.olive, C.black, C.yellow, C.cream, 0x9ec1d9][i], -0.36 + i * 0.03, 0.3, 0, 0.004));
    g.add(rb(0.5, 0.08, 0.38, C.woodDark, 0, 0.62, 0, 0.02));
    const disc = cyl(0.15, 0.15, 0.01, C.black, -0.05, 0.67, 0, 32); g.add(disc);
    g.add(cyl(0.05, 0.05, 0.012, C.terracotta, -0.05, 0.676, 0, 16));
    const arm = rb(0.02, 0.015, 0.2, C.cream, 0.15, 0.68, 0.02, 0.005); arm.rotation.y = 0.5; g.add(arm);
    return { group: g, update: (t) => { disc.rotation.y = t * 3.5; } };
  } },

  denGuitar: { label: "Acoustic guitar (leaning)", category: "decor", mount: "floor", build() {
    const g = new THREE.Group();
    const wood = m(0xe0a35a), dark = m(C.woodDark);
    const body = new THREE.Group();
    const low = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 28), wood); low.rotation.x = Math.PI / 2; body.add(low);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.09, 28), wood); up.rotation.x = Math.PI / 2; up.position.y = 0.24; body.add(up);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), m(C.black)); hole.position.set(0, 0.16, 0.047); body.add(hole);
    body.add(rb(0.05, 0.55, 0.03, dark, 0, 0.6, 0.02, 0.01), rb(0.08, 0.13, 0.03, dark, 0, 0.92, 0.02, 0.012));
    body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    body.position.set(0, 0.22, 0); body.rotation.x = -0.25; g.add(body);
    return { group: g };
  } },

  denTree: { label: "Big potted tree", category: "plants", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(cyl(0.22, 0.17, 0.4, C.pot, 0, 0.2, 0, 20), cyl(0.2, 0.2, 0.02, 0x5a3b26, 0, 0.39, 0, 20));
    g.add(cyl(0.025, 0.035, 1.0, C.woodDark, 0, 0.88, 0, 8));
    const leaf = new THREE.SphereGeometry(0.13, 10, 6);
    for (let i = 0; i < 22; i++) {
      const a = rnd() * Math.PI * 2, y = 0.9 + rnd() * 0.85, rr = 0.1 + rnd() * 0.25 * (1.3 - (y - 0.9));
      const l = new THREE.Mesh(leaf, m(i % 3 ? C.leaf : C.leafDark));
      l.scale.set(1.2, 0.5, 0.9); l.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr); l.rotation.set(rnd(), -a, -0.6); l.castShadow = true; g.add(l);
    }
    return { group: g };
  } },

  denCactusTrio: { label: "Three little cacti", category: "plants", mount: "floor", build() {
    const g = new THREE.Group();
    [[-0.14, 0.9], [0, 1.2], [0.14, 0.75]].forEach(([x, s]) => { const c = cactus(s); c.position.x = x; g.add(c); });
    return { group: g };
  } },

  denHangingPlant: { label: "Hanging plant basket", category: "plants", mount: "floor", defaultY: 2.2, build() {
    const g = new THREE.Group();
    g.add(cyl(0.004, 0.004, 0.9, C.creamDark, 0, 0.62, 0, 4));
    g.add(cyl(0.16, 0.1, 0.14, C.creamDark, 0, 0.07, 0, 16));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, len = 0.25 + rnd() * 0.35;
      const vine = cyl(0.006, 0.006, len, C.leafDark, Math.cos(a) * 0.14, 0.1 - len / 2, Math.sin(a) * 0.14, 4); g.add(vine);
      for (let k = 0; k < 4; k++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), m(k % 2 ? C.leaf : C.leafDark)); l.scale.set(1.3, 0.5, 1); l.position.set(Math.cos(a) * 0.15, 0.08 - (k / 4) * len, Math.sin(a) * 0.15); g.add(l); }
    }
    return { group: g };
  } },

  denDresser: { label: "Wooden dresser", category: "shelves", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(rb(1.1, 0.85, 0.5, C.wood, 0, 0.47, 0, 0.04));
    for (let i = 0; i < 3; i++) { g.add(rb(1.0, 0.22, 0.02, C.woodLight, 0, 0.2 + i * 0.26, 0.25, 0.012)); for (const x of [-0.25, 0.25]) g.add(cyl(0.018, 0.018, 0.03, C.cream, x, 0.2 + i * 0.26, 0.27, 8)); }
    for (const x of [-0.48, 0.48]) for (const z of [-0.2, 0.2]) g.add(cyl(0.025, 0.02, 0.06, C.woodDark, x, 0.03, z, 8));
    const p = leafyPlant(0.6); p.position.set(-0.32, 0.9, 0); g.add(p);
    const frame = rb(0.22, 0.28, 0.03, C.cream, 0.25, 1.04, -0.05, 0.01); frame.rotation.x = -0.15; g.add(frame);
    g.add(rb(0.17, 0.22, 0.01, C.green, 0.25, 1.045, -0.03, 0.004).rotateX(-0.15));
    return { group: g };
  } },

  denBasket: { label: "Basket + blanket", category: "decor", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(cyl(0.22, 0.18, 0.36, C.creamDark, 0, 0.18, 0, 20));
    for (let i = 0; i < 5; i++) g.add(cyl(0.225, 0.225, 0.012, C.woodLight, 0, 0.05 + i * 0.07, 0, 20));
    const bl = rb(0.36, 0.14, 0.3, C.pink, 0, 0.38, 0, 0.06); bl.rotation.z = 0.2; g.add(bl);
    return { group: g };
  } },

  denFrames: { label: "Picture frame wall", category: "decor", mount: "wall", defaultY: 1.7, build() {
    const g = new THREE.Group();
    const art = [C.olive, C.pink, 0x9ec1d9, C.yellow, C.terracotta];
    [[-0.35, 0.12, 0.3, 0.4], [0.05, 0.2, 0.36, 0.26], [0.05, -0.12, 0.26, 0.3], [0.38, 0.05, 0.24, 0.32], [-0.38, -0.28, 0.22, 0.18]].forEach(([x, y, w, h], i) => {
      g.add(rb(w, h, 0.03, C.woodDark, x, y, 0.015, 0.01));
      g.add(rb(w - 0.06, h - 0.06, 0.01, C.cream, x, y, 0.033, 0.003));
      g.add(rb(w - 0.12, h - 0.12, 0.01, art[i], x, y, 0.04, 0.003));
    });
    return { group: g };
  } },

  denPlantShelf: { label: "Wall shelf + trailing plants", category: "shelves", mount: "wall", defaultY: 1.8, build() {
    const g = new THREE.Group();
    g.add(rb(1.0, 0.04, 0.22, C.woodLight, 0, 0, 0.11, 0.012));
    for (const x of [-0.4, 0.4]) g.add(rb(0.03, 0.12, 0.18, C.woodDark, x, -0.07, 0.09, 0.008));
    [[-0.3, 0.6], [0.05, 0.5], [0.33, 0.55]].forEach(([x, s]) => {
      const p = leafyPlant(s); p.position.set(x, 0.02, 0.1); g.add(p);
      for (let k = 0; k < 3; k++) { const vine = cyl(0.005, 0.005, 0.3 + k * 0.08, C.leafDark, x + (k - 1) * 0.04, -0.15 - k * 0.04, 0.2, 4); g.add(vine); }
    });
    books(g, 0.25, 0.02, 0.1, 0.18);
    return { group: g };
  } },
});
