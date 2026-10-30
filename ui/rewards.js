// rewards.js - room items you unlock in the Battle Pass (skills/quest.py PASS). Built from simple shapes,
// so they need no model files. Locked ones show with a 🔒 in the furniture picker (app.js renderCatalog).
import * as THREE from "three";

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
const metal = (color) => std(color, { metalness: 0.9, roughness: 0.25 });
const glow = (color, i = 2.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i });

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
const cyl = (rt, rb, h, mat, x, y, z, seg = 24) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
const ball = (r, mat, x, y, z) => mesh(new THREE.SphereGeometry(r, 24, 16), mat, x, y, z);
const cube = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
const group = (...kids) => { const g = new THREE.Group(); g.add(...kids); return g; };

function trophy(color) {
  const m = metal(color);
  return group(cube(0.3, 0.1, 0.3, std(0x2a2026), 0, 0.05, 0), cyl(0.04, 0.06, 0.25, m, 0, 0.22, 0),
    cyl(0.17, 0.07, 0.25, m, 0, 0.47, 0), ...[-1, 1].map((s) => mesh(new THREE.TorusGeometry(0.07, 0.015, 8, 16), m, s * 0.18, 0.5, 0)));
}

function lightOn(g, color, power = 3, y = 0.6) {
  const l = new THREE.PointLight(color, power, 3.5, 2);
  l.position.y = y;
  g.add(l);
  return l;
}

const ITEMS = {
  rwPlushie: ["Teddy plushie", () => {
    const fur = std(0xb07a4a, { roughness: 0.95 });
    return group(ball(0.2, fur, 0, 0.2, 0), ball(0.14, fur, 0, 0.48, 0), ball(0.05, fur, -0.1, 0.6, 0), ball(0.05, fur, 0.1, 0.6, 0),
      ball(0.05, std(0xe8cfae), 0, 0.45, 0.12), ...[-1, 1].map((s) => ball(0.07, fur, s * 0.17, 0.08, 0.1)));
  }],
  rwLavaLamp: ["Lava lamp", () => {
    const g = group(cyl(0.1, 0.13, 0.15, metal(0x888899), 0, 0.075, 0), cyl(0.07, 0.11, 0.45, new THREE.MeshStandardMaterial({ color: 0xff6aa8, transparent: true, opacity: 0.55 }), 0, 0.37, 0),
      ball(0.04, glow(0xffb02e), 0, 0.3, 0), ball(0.03, glow(0xffb02e), 0.02, 0.45, 0), cyl(0.04, 0.07, 0.1, metal(0x888899), 0, 0.65, 0));
    lightOn(g, 0xff6aa8, 2, 0.4);
    return g;
  }],
  rwGlobe: ["Desk globe", () => group(cyl(0.12, 0.15, 0.05, std(0x5a3a26), 0, 0.025, 0), cyl(0.015, 0.015, 0.2, metal(0xc9a24a), 0, 0.13, 0),
    ball(0.17, std(0x3f87c9), 0, 0.38, 0), mesh(new THREE.TorusGeometry(0.19, 0.01, 6, 32), metal(0xc9a24a), 0, 0.38, 0))],
  rwTrophyBronze: ["Bronze trophy", () => trophy(0xcd7f32)],
  rwTrophySilver: ["Silver trophy", () => trophy(0xd7dbe0)],
  rwTrophyGold: ["Gold trophy", () => trophy(0xffc93c)],
  rwBeanPlant: ["Lucky bean plant", () => group(cyl(0.14, 0.11, 0.2, std(0xe6e0d6), 0, 0.1, 0), cyl(0.012, 0.012, 0.3, std(0x3f7a2e), 0, 0.35, 0),
    ...[0, 1, 2, 3].map((i) => { const l = ball(0.08, std(0x5cbf4a), Math.cos(i * 1.6) * 0.1, 0.42 + i * 0.05, Math.sin(i * 1.6) * 0.1); l.scale.set(1, 0.4, 1.4); return l; }))],
  rwAquarium: ["Aquarium", () => {
    const g = group(cube(1.0, 0.6, 0.4, std(0x2a2026), 0, 0.3, 0),
      cube(0.95, 0.5, 0.35, new THREE.MeshStandardMaterial({ color: 0x5fc6ff, transparent: true, opacity: 0.35 }), 0, 0.85, 0),
      cube(0.95, 0.05, 0.35, std(0xd9c79a), 0, 0.63, 0));
    const fish = [0xff8a3d, 0xffd23d, 0xff5fa0].map((c, i) => { const f = ball(0.04, glow(c, 0.8), -0.3 + i * 0.3, 0.8 + i * 0.05, 0); f.scale.set(1.8, 1, 0.6); g.add(f); return f; });
    let t = 0;
    g.userData.tick = (dt) => { t += dt; fish.forEach((f, i) => { f.position.x = Math.sin(t * 0.6 + i * 2) * 0.38; f.rotation.y = Math.cos(t * 0.6 + i * 2) > 0 ? 0 : Math.PI; }); };
    lightOn(g, 0x5fc6ff, 1.5, 1.0);
    return g;
  }],
  rwTelescope: ["Telescope", () => {
    const tube = cyl(0.06, 0.08, 0.8, std(0xe8e4dc), 0, 1.1, 0);
    tube.rotation.z = -0.8;
    return group(...[0, 2.1, 4.2].map((a) => { const leg = cyl(0.015, 0.015, 1.0, metal(0x444), Math.sin(a) * 0.18, 0.45, Math.cos(a) * 0.18); leg.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35); return leg; }), tube);
  }],
  rwArcade: ["Arcade cabinet", () => {
    const g = group(cube(0.7, 1.7, 0.6, std(0x3b1f6b), 0, 0.85, 0), cube(0.55, 0.42, 0.02, glow(0x47d7ff, 1.2), 0, 1.3, 0.31),
      cube(0.6, 0.06, 0.3, std(0x241433), 0, 0.98, 0.35), ball(0.03, glow(0xff3b6b), -0.12, 1.03, 0.4), ball(0.03, glow(0xffd23d), 0.1, 1.03, 0.4),
      cube(0.6, 0.12, 0.02, glow(0xff5fb7, 1.5), 0, 1.62, 0.31));
    lightOn(g, 0x47d7ff, 2, 1.3);
    return g;
  }],
  rwNeonHeart: ["Neon heart", () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.25); s.bezierCurveTo(-0.45, 0.05, -0.2, 0.35, 0, 0.15); s.bezierCurveTo(0.2, 0.35, 0.45, 0.05, 0, -0.25);
    const g = group(mesh(new THREE.ShapeGeometry(s), glow(0xc46bff, 3), 0, 0, 0.02));
    lightOn(g, 0xc46bff, 3, 0).position.z = 0.5;
    return g;
  }, { mount: "wall", defaultY: 1.9 }],
  rwCrystalLamp: ["Crystal lamp", () => {
    const g = group(cyl(0.1, 0.12, 0.08, metal(0xc0c0d0), 0, 0.04, 0), mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshStandardMaterial({ color: 0xa8e6ff, emissive: 0x6fd0ff, emissiveIntensity: 1.2, transparent: true, opacity: 0.8 }), 0, 0.28, 0));
    lightOn(g, 0x9fe2ff, 2.5, 0.35);
    return g;
  }],
  rwStarProjector: ["Star projector", () => {
    const g = group(cyl(0.12, 0.14, 0.08, std(0x2a2050), 0, 0.04, 0), ball(0.12, glow(0x8f86ff, 1.5), 0, 0.14, 0));
    const stars = new THREE.Group();
    for (let i = 0; i < 40; i++) stars.add(ball(0.012, glow(0xffffff, 3), (Math.random() - 0.5) * 3, 2.6 + Math.random() * 0.4, (Math.random() - 0.5) * 3));
    g.add(stars);
    g.userData.tick = (dt) => { stars.rotation.y += dt * 0.05; };
    lightOn(g, 0x8f86ff, 2, 0.3);
    return g;
  }],
  rwMedalFrame: ["Medal frame", () => group(cube(0.6, 0.45, 0.04, std(0x3d2b30), 0, 0, 0.02), cube(0.52, 0.37, 0.01, std(0x1f3b5a), 0, 0, 0.045),
    ...[-0.15, 0, 0.15].map((x, i) => cyl(0.05, 0.05, 0.01, metal([0xcd7f32, 0xffc93c, 0xd7dbe0][i]), x, -0.03, 0.055)).map((m) => { m.rotation.x = Math.PI / 2; return m; })),
  { mount: "wall", defaultY: 1.7 }],
  rwBonsai: ["Bonsai tree", () => group(cube(0.4, 0.1, 0.25, std(0x2e5a7a), 0, 0.05, 0), cyl(0.03, 0.05, 0.25, std(0x5a3a26), 0, 0.22, 0),
    ...[[-0.1, 0.36], [0.1, 0.4], [0, 0.46]].map(([x, y]) => { const l = ball(0.12, std(0x3f8a3a), x, y, 0); l.scale.y = 0.55; return l; }))],
  rwPiano: ["Piano", () => group(cube(1.4, 1.1, 0.5, std(0x111015, { roughness: 0.2 }), 0, 0.55, -0.1), cube(1.3, 0.04, 0.25, std(0xf4f1ea), 0, 0.75, 0.25),
    ...Array.from({ length: 18 }, (_, i) => cube(0.03, 0.03, 0.14, std(0x111015), -0.6 + i * 0.07, 0.78, 0.2)), cube(0.9, 0.45, 0.35, std(0x111015), 0, 0.22, 0.8))],
  rwHammock: ["Hammock", () => {
    const net = mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.8, 24, 1, true, Math.PI * 0.65, Math.PI * 0.7), std(0xf0d9a8, { side: THREE.DoubleSide, roughness: 1 }), 0, 0.9, 0);
    net.rotation.z = Math.PI / 2;
    return group(cyl(0.05, 0.05, 1.6, std(0x6b4a2e), -1.0, 0.8, 0), cyl(0.05, 0.05, 1.6, std(0x6b4a2e), 1.0, 0.8, 0), net);
  }],
  rwThrone: ["Golden throne", () => group(cube(0.8, 0.45, 0.7, metal(0xffc93c), 0, 0.22, 0), cube(0.7, 0.1, 0.6, std(0xb01e3c), 0, 0.5, 0),
    cube(0.8, 1.2, 0.12, metal(0xffc93c), 0, 1.0, -0.3), cube(0.12, 0.3, 0.6, metal(0xffc93c), -0.4, 0.6, 0), cube(0.12, 0.3, 0.6, metal(0xffc93c), 0.4, 0.6, 0),
    ...[-0.3, 0, 0.3].map((x) => ball(0.06, glow(0xff3b6b, 0.8), x, 1.65, -0.3)))],
};

export const REWARD_CATALOG = Object.fromEntries(Object.entries(ITEMS).map(([key, [label, make, o = {}]]) => [key, {
  label: `${label} 🏆`, mount: o.mount || "floor", defaultY: o.defaultY || 0, category: "rewards", reward: true,
  build() {
    const g = make();
    const tick = g.userData.tick;
    return { group: g, update: tick && ((t, dt) => tick(dt || 0.016)) };
  },
}]));
