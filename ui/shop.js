// shop.js - the VCash furniture shop and the room's "living" things.
//   SHOP_CATALOG   themed furniture sets (a new season each month, skills/quest.py SEASONS) + weekly items, bought with VCash
//   LIVING_CATALOG photo frames (6 styles x 3 sizes), the Smart TV, the weather clock, the focus plant, the top-3 tasks board
//   buildDecor()   the seasonal decorations that turn on by themselves (not saved in your layout)
//   ambient        quiet room sounds made in the browser (no sound files), with a volume
// Everything is built from simple shapes, like rewards.js, so it needs no model files.
import * as THREE from "three";

export const roomHooks = { api: null, open: null };      // set by app.js: the Python API and a way to open a panel

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
const metal = (color) => std(color, { metalness: 0.9, roughness: 0.25 });
const glow = (color, i = 2.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i });
const glass = (color, opacity = 0.4) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.1 });

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
const cyl = (rt, rb, h, mat, x, y, z, seg = 24) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);
const ball = (r, mat, x, y, z) => mesh(new THREE.SphereGeometry(r, 24, 16), mat, x, y, z);
const cube = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
const torus = (r, t, mat, x, y, z) => mesh(new THREE.TorusGeometry(r, t, 10, 32), mat, x, y, z);
const group = (...kids) => { const g = new THREE.Group(); if (kids.length) g.add(...kids); return g; };
function lightOn(g, color, power = 3, y = 0.6) {
  const l = new THREE.PointLight(color, power, 3.5, 2);
  l.position.y = y; g.add(l);
  return l;
}
function canvasTex(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return { c, g: c.getContext("2d"), t };
}
// bob something up and down (the levitating pieces)
const floaty = (obj, amp = 0.06, speed = 1.6, base = obj.position.y) => (t) => { obj.position.y = base + Math.sin(t * speed) * amp; };

// ---------------------------------------------------------------- themed sets (one theme is "in season" each month)
const SETS = {
  space: {
    spMoonChair: ["Levitating moon chair", 900, () => {
      const seat = group(ball(0.5, std(0xdedbd2, { roughness: 1 }), 0, 0, 0), ...[[0.2, 0.25, 0.4], [-0.25, 0.1, 0.42], [0.05, -0.2, 0.45]]
        .map(([x, y, z]) => { const c = ball(0.09, std(0xb8b4aa, { roughness: 1 }), x, y, z); c.scale.z = 0.3; return c; }));
      seat.scale.set(1, 0.75, 1);
      const cushion = cube(0.6, 0.12, 0.5, std(0x6b5bd6), 0, 0.33, 0.1);
      const chair = group(seat, cushion); chair.position.y = 0.75;
      const g = group(chair, cyl(0.35, 0.4, 0.04, glow(0x8f86ff, 1.5), 0, 0.02, 0));
      lightOn(g, 0x8f86ff, 2, 0.2);
      const bob = floaty(chair, 0.08, 1.4);
      g.userData.tick = (dt, t) => { bob(t); chair.rotation.y = Math.sin(t * 0.3) * 0.2; };
      return g;
    }],
    spRocketLamp: ["Rocket lamp", 450, () => {
      const g = group(cyl(0.12, 0.15, 0.7, std(0xf0eee8), 0, 0.5, 0), mesh(new THREE.ConeGeometry(0.12, 0.3, 24), std(0xd83a3a), 0, 1.0, 0),
        ...[0, 2.1, 4.2].map((a) => { const f = cube(0.02, 0.25, 0.16, std(0xd83a3a), Math.sin(a) * 0.14, 0.25, Math.cos(a) * 0.14); f.rotation.y = a; return f; }),
        ball(0.05, glow(0x7fd3ff, 1.5), 0, 0.7, 0.12));
      const flame = mesh(new THREE.ConeGeometry(0.08, 0.22, 16), glow(0xff9a3d, 3), 0, 0.06, 0); flame.rotation.x = Math.PI; g.add(flame);
      lightOn(g, 0xffb46b, 2.5, 0.3);
      g.userData.tick = (dt, t) => { flame.scale.y = 0.8 + Math.sin(t * 20) * 0.2; };
      return g;
    }],
    spPlanetMobile: ["Planet mobile", 380, () => {
      const arm = group(), g = group(cyl(0.01, 0.01, 0.5, metal(0x999999), 0, 2.55, 0), arm);
      arm.position.y = 2.3;
      [[0.5, 0xe8a85f, 0.12], [-0.45, 0x6fa8ff, 0.1], [0, 0xd96b4a, 0.08]].forEach(([x, c, r], i) => {
        arm.add(cyl(0.004, 0.004, 0.3 + i * 0.1, metal(0x999999), x, -0.15 - i * 0.05, i ? 0.3 : 0));
        arm.add(ball(r, std(c), x, -0.35 - i * 0.1, i ? 0.3 : 0));
      });
      const ring = torus(0.18, 0.012, std(0xe8d0a0), 0.5, -0.35, 0); ring.rotation.x = 1.2; arm.add(ring);
      g.userData.tick = (dt) => { arm.rotation.y += dt * 0.25; };
      return g;
    }],
    spAstronaut: ["Astronaut plushie", 300, () => {
      const suit = std(0xf2f2f2, { roughness: 0.9 });
      const body = group(ball(0.17, suit, 0, 0.2, 0), ball(0.14, suit, 0, 0.45, 0), ball(0.09, glass(0x2a3a6a, 0.9), 0, 0.46, 0.08),
        cube(0.12, 0.16, 0.08, std(0xdddddd), 0, 0.22, -0.16), ...[-1, 1].map((s) => ball(0.06, suit, s * 0.17, 0.08, 0.08)));
      const g = group(body);
      g.userData.tick = (dt, t) => { body.rotation.z = Math.sin(t * 0.8) * 0.06; };
      return g;
    }],
    spStarRug: ["Galaxy rug", 250, () => {
      const rug = mesh(new THREE.CircleGeometry(1.1, 48), std(0x1b1840, { roughness: 1 }), 0, 0.01, 0); rug.rotation.x = -Math.PI / 2;
      const g = group(rug);
      for (let i = 0; i < 26; i++) { const s = ball(0.015, glow(0xffffff, 2), (Math.random() - 0.5) * 1.6, 0.02, (Math.random() - 0.5) * 1.6); s.scale.y = 0.2; g.add(s); }
      return g;
    }],
    spUfoLight: ["UFO ceiling light", 520, () => {
      const ufo = group(ball(0.35, metal(0xb8c0cc), 0, 0, 0), ball(0.16, glass(0x9fe8ff, 0.6), 0, 0.08, 0),
        mesh(new THREE.ConeGeometry(0.25, 0.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fffd0, transparent: true, opacity: 0.18, side: THREE.DoubleSide }), 0, -0.35, 0));
      ufo.children[0].scale.y = 0.25; ufo.position.y = 2.5;
      const g = group(ufo);
      lightOn(g, 0x9fffd0, 2.5, 2.2);
      const bob = floaty(ufo, 0.05, 1.1);
      g.userData.tick = (dt, t) => { bob(t); ufo.rotation.y += dt * 0.6; };
      return g;
    }],
  },
  ocean: {
    ocShellChair: ["Seashell chair", 850, () => {
      const shell = mesh(new THREE.SphereGeometry(0.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), std(0xf6c6c0, { side: THREE.DoubleSide }), 0, 0.45, -0.1);
      shell.rotation.x = -1.2;
      return group(cube(0.8, 0.4, 0.6, std(0xf0d6c8), 0, 0.2, 0.05), cube(0.75, 0.1, 0.55, std(0x5fc6c6), 0, 0.45, 0.05), shell,
        ...Array.from({ length: 7 }, (_, i) => { const r = cube(0.02, 0.6, 0.02, std(0xe0a8a0), -0.45 + i * 0.15, 0.75, -0.35); r.rotation.z = (i - 3) * 0.18; return r; }));
    }],
    ocJellyLamp: ["Floating jellyfish lamp", 500, () => {
      const bell = mesh(new THREE.SphereGeometry(0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff9fe0, emissive: 0xff7fd0, emissiveIntensity: 1.2, transparent: true, opacity: 0.75 }), 0, 0, 0);
      const jelly = group(bell, ...Array.from({ length: 8 }, (_, i) => cyl(0.006, 0.004, 0.45, glow(0xffb0f0, 1), Math.cos(i * 0.8) * 0.13, -0.22, Math.sin(i * 0.8) * 0.13)));
      jelly.position.y = 1.4;
      const g = group(jelly, cyl(0.15, 0.18, 0.04, std(0x2a4a6a), 0, 0.02, 0));
      lightOn(g, 0xff9fe0, 2.2, 1.3);
      const bob = floaty(jelly, 0.12, 0.9);
      g.userData.tick = (dt, t) => { bob(t); jelly.scale.y = 1 + Math.sin(t * 2.2) * 0.08; };
      return g;
    }],
    ocFishTank: ["Coral fish tank", 700, () => {
      const g = group(cube(1.1, 0.7, 0.45, std(0x203040), 0, 0.35, 0), cube(1.05, 0.6, 0.4, glass(0x4fb8ff, 0.3), 0, 1.0, 0),
        ...[[-0.3, 0xff6b6b], [0, 0xffa64d], [0.3, 0xc36bff]].map(([x, c]) => cyl(0.03, 0.05, 0.25, std(c), x, 0.85, 0)));
      const fish = [0xffd23d, 0x4dfff0, 0xff5fa0, 0xffffff].map((c, i) => { const f = ball(0.035, glow(c, 0.8), 0, 0.95 + i * 0.07, 0); f.scale.set(1.8, 1, 0.6); g.add(f); return f; });
      g.userData.tick = (dt, t) => fish.forEach((f, i) => { f.position.x = Math.sin(t * (0.5 + i * 0.1) + i * 2) * 0.42; f.position.z = Math.cos(t * 0.4 + i) * 0.1; f.rotation.y = Math.cos(t * (0.5 + i * 0.1) + i * 2) > 0 ? 0 : Math.PI; });
      lightOn(g, 0x4fb8ff, 1.8, 1.1);
      return g;
    }],
    ocWaveRug: ["Wave rug", 220, () => {
      const rug = mesh(new THREE.PlaneGeometry(2, 1.3), std(0x2f8fbf, { roughness: 1 }), 0, 0.01, 0); rug.rotation.x = -Math.PI / 2;
      const g = group(rug);
      for (let i = 0; i < 4; i++) { const w = torus(0.5, 0.02, std(0xe8f8ff), -0.5 + i * 0.35, 0.015, 0.2); w.rotation.x = -Math.PI / 2; w.scale.set(0.5, 1, 1); g.add(w); }
      return g;
    }],
    ocAnchorShelf: ["Anchor shelf", 350, () => group(cube(0.9, 0.05, 0.25, std(0x6b4a2e), 0, 0.2, 0), cube(0.9, 0.05, 0.25, std(0x6b4a2e), 0, -0.2, 0),
      cyl(0.02, 0.02, 0.4, metal(0x445566), 0, 0, 0.05), torus(0.1, 0.02, metal(0x445566), 0, -0.12, 0.05), ball(0.05, std(0xf6c6c0), 0.3, 0.27, 0), ball(0.04, std(0xffffff), -0.3, -0.15, 0)),
      { mount: "wall", defaultY: 1.6 }],
    ocBubbleColumn: ["Bubble column", 600, () => {
      const g = group(cyl(0.18, 0.18, 1.6, glass(0x4fd8ff, 0.3), 0, 0.85, 0), cyl(0.2, 0.22, 0.08, metal(0x99aabb), 0, 0.04, 0));
      const bubbles = Array.from({ length: 12 }, () => { const b = ball(0.025, glass(0xffffff, 0.7), (Math.random() - 0.5) * 0.2, Math.random() * 1.5, (Math.random() - 0.5) * 0.2); g.add(b); return b; });
      lightOn(g, 0x4fd8ff, 2, 0.8);
      g.userData.tick = (dt) => bubbles.forEach((b) => { b.position.y += dt * 0.4; if (b.position.y > 1.6) b.position.y = 0.1; });
      return g;
    }],
  },
  fantasy: {
    faCrystalThrone: ["Crystal throne", 950, () => {
      const crystal = (x, h, c) => mesh(new THREE.OctahedronGeometry(0.15), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 }), x, h, -0.3);
      const g = group(cube(0.8, 0.45, 0.7, std(0x3a2a5a), 0, 0.22, 0), cube(0.7, 0.1, 0.6, std(0x7b3fbf), 0, 0.5, 0), cube(0.8, 1.1, 0.12, std(0x3a2a5a), 0, 1.0, -0.3),
        crystal(-0.3, 1.6, 0x9f7fff), crystal(0, 1.75, 0x7fe0ff), crystal(0.3, 1.6, 0xff7fd0));
      lightOn(g, 0x9f7fff, 2.5, 1.5);
      return g;
    }],
    faCandles: ["Floating candles", 400, () => {
      const g = group();
      const cs = [[-0.3, 1.9], [0, 2.1], [0.3, 1.95], [0.15, 2.25], [-0.15, 2.2]].map(([x, y], i) => {
        const c = group(cyl(0.035, 0.035, 0.2, std(0xf4ecd8), 0, 0, 0), ball(0.025, glow(0xffb84d, 4), 0, 0.13, 0));
        c.position.set(x, y, (i % 2) * 0.2); g.add(c); return c;
      });
      lightOn(g, 0xffb84d, 2.5, 2.0);
      g.userData.tick = (dt, t) => cs.forEach((c, i) => { c.position.y = [1.9, 2.1, 1.95, 2.25, 2.2][i] + Math.sin(t * 1.2 + i) * 0.05; });
      return g;
    }],
    faPotionShelf: ["Potion shelf", 420, () => group(cube(1.0, 0.05, 0.25, std(0x4a2e1e), 0, 0, 0),
      ...[[-0.35, 0xff4d6b], [-0.12, 0x4dff9a], [0.12, 0x4db8ff], [0.35, 0xffd24d]].map(([x, c]) => group(ball(0.08, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, transparent: true, opacity: 0.8 }), x, 0.11, 0),
        cyl(0.025, 0.025, 0.1, glass(0xffffff, 0.5), x, 0.22, 0), cyl(0.03, 0.03, 0.03, std(0x8a5a3a), x, 0.28, 0)))), { mount: "wall", defaultY: 1.5 }],
    faDragonEgg: ["Dragon egg", 650, () => {
      const egg = ball(0.2, std(0x2f7a4a, { metalness: 0.4, roughness: 0.35 }), 0, 0.42, 0); egg.scale.y = 1.35;
      const g = group(cyl(0.22, 0.26, 0.15, std(0x5a5048), 0, 0.075, 0), egg);
      for (let i = 0; i < 8; i++) { const s = ball(0.05, std(0xc9a24a, { metalness: 0.7 }), Math.cos(i * 0.8) * 0.17, 0.3 + (i % 3) * 0.12, Math.sin(i * 0.8) * 0.17); s.scale.set(1, 0.4, 1); egg.parent.add(s); }
      lightOn(g, 0x7fff9a, 1.2, 0.4);
      g.userData.tick = (dt, t) => { egg.rotation.z = Math.sin(t * 7) * (Math.sin(t * 0.5) > 0.9 ? 0.08 : 0); };
      return g;
    }],
    faMagicMirror: ["Magic mirror", 550, () => {
      const face = mesh(new THREE.CircleGeometry(0.38, 40), new THREE.MeshStandardMaterial({ color: 0x5f3fbf, emissive: 0x3f2fa0, emissiveIntensity: 1, metalness: 0.8, roughness: 0.15 }), 0, 0, 0.03);
      face.scale.y = 1.35;
      const rim = torus(0.4, 0.04, metal(0xc9a24a), 0, 0, 0.03); rim.scale.y = 1.35;
      const g = group(face, rim);
      g.userData.tick = (dt, t) => { face.material.emissiveIntensity = 0.8 + Math.sin(t * 1.5) * 0.4; };
      return g;
    }, { mount: "wall", defaultY: 1.7 }],
    faFloatingBooks: ["Floating spellbooks", 480, () => {
      const g = group();
      const books = [0x8a2a2a, 0x2a4a8a, 0x2a7a4a].map((c, i) => { const b = group(cube(0.3, 0.06, 0.22, std(c), 0, 0, 0), cube(0.28, 0.05, 0.2, std(0xf4ecd8), 0.01, 0, 0)); b.position.set(-0.3 + i * 0.3, 1.5 + i * 0.15, 0); g.add(b); return b; });
      g.userData.tick = (dt, t) => books.forEach((b, i) => { b.position.y = 1.5 + i * 0.15 + Math.sin(t * 1.3 + i * 2) * 0.08; b.rotation.y = t * 0.3 + i; });
      return g;
    }],
  },
};

export const THEME_NAMES = { space: "🚀 Space", ocean: "🌊 Ocean", fantasy: "🐉 Fantasy" };
export const SHOP_SETS = Object.fromEntries(Object.entries(SETS).map(([theme, items]) => [theme, Object.keys(items)]));

const asItem = (label, make, o, extra) => ({
  label, mount: o.mount || "floor", defaultY: o.defaultY || 0, ...extra,
  build() {
    const g = make();
    const tick = g.userData.tick;
    return { group: g, update: tick && ((t, dt) => tick(dt || 0.016, t)) };
  },
});

export const SHOP_CATALOG = Object.fromEntries(Object.entries(SETS).flatMap(([theme, items]) =>
  Object.entries(items).map(([key, [label, price, make, o = {}]]) => [key, asItem(label, make, o, { category: "shop", shop: true, price, theme })])));

// ---------------------------------------------------------------- photo frames: 6 styles x 3 sizes
const FRAME_STYLES = {
  wood: ["Wooden", (w, h) => std(0x7a5232, { roughness: 0.8 })],
  gold: ["Gold ornate", () => metal(0xd4a640)],
  black: ["Black modern", () => std(0x151515, { roughness: 0.3 })],
  white: ["White gallery", () => std(0xf4f2ee, { roughness: 0.5 })],
  polaroid: ["Polaroid", () => std(0xfbfaf6, { roughness: 0.9 })],
  neon: ["Neon glow", () => glow(0xff5fb7, 1.6)],
};
const FRAME_SIZES = { s: ["small", 0.35, 0.45], m: ["medium", 0.6, 0.75], l: ["large", 1.0, 1.25] };

function placeholderTex(label) {
  const { g, t } = canvasTex(256, 320);
  const grd = g.createLinearGradient(0, 0, 256, 320); grd.addColorStop(0, "#ffc6dd"); grd.addColorStop(1, "#9fb8ff");
  g.fillStyle = grd; g.fillRect(0, 0, 256, 320);
  g.fillStyle = "#fff"; g.font = "bold 22px sans-serif"; g.textAlign = "center";
  g.fillText("📷", 128, 150); g.font = "16px sans-serif"; g.fillText(label, 128, 190);
  t.needsUpdate = true;
  return t;
}

function photoFrame(style, size) {
  const [styleName, matFor] = FRAME_STYLES[style], [sizeName, W, H] = FRAME_SIZES[size];
  return {
    label: `Photo frame · ${styleName} · ${sizeName}`, mount: "wall", defaultY: 1.6, category: "frames",
    build(ctx) {
      const g = new THREE.Group(), b = 0.05 + W * 0.04, m = matFor();
      const polaroid = style === "polaroid";
      const pic = new THREE.MeshBasicMaterial({ map: placeholderTex("click to pick"), toneMapped: false });
      const picH = polaroid ? H * 0.75 : H;
      const photo = new THREE.Mesh(new THREE.PlaneGeometry(W, picH), pic);
      photo.position.set(0, polaroid ? H * 0.08 : 0, 0.035);
      g.add(cube(W + b * 2, H + b * 2 + (polaroid ? H * 0.12 : 0), 0.05, m, 0, polaroid ? -H * 0.04 : 0, 0), photo);
      if (style === "gold") for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(ball(b * 0.9, m, x * (W / 2 + b * 0.6), y * (H / 2 + b * 0.6), 0.04));
      if (style === "neon") lightOn(g, 0xff5fb7, 1.5, 0).position.z = 0.4;
      const load = async (path) => {
        const d = path && await roomHooks.api?.photo_data(path);
        if (!d?.url) return;
        new THREE.TextureLoader().load(d.url, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          const a = d.w / d.h, frameA = W / picH;           // crop the picture to fill the frame
          if (a > frameA) { tex.repeat.set(frameA / a, 1); tex.offset.set((1 - frameA / a) / 2, 0); }
          else { tex.repeat.set(1, a / frameA); tex.offset.set(0, (1 - a / frameA) / 2); }
          pic.map?.dispose(); pic.map = tex; pic.needsUpdate = true;
        });
      };
      load(ctx.spec.photo);
      return { group: g, interact: { label: "Photo frame: next picture", onClick: () => {
        (async () => {
          let list = await roomHooks.api?.photo_list();
          if (!list?.photos?.length) list = await roomHooks.api?.photo_folder_pick();
          const ps = list?.photos || [];
          if (!ps.length) return;
          const i = (ps.findIndex((p) => p.path === ctx.spec.photo) + 1) % ps.length;
          ctx.spec.photo = ps[i].path;
          await load(ctx.spec.photo);
          ctx._room.onChange?.();
        })();
        return "next photo";
      } } };
    },
  };
}

// ---------------------------------------------------------------- the living things
function drawClock(g, w, h, wx) {
  const now = new Date();
  g.fillStyle = "#1d1726"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffe2ef"; g.textAlign = "center";
  g.font = "bold 110px sans-serif"; g.fillText(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), w / 2, 130);
  g.font = "34px sans-serif"; g.fillStyle = "#c9b8ff"; g.fillText(now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }), w / 2, 180);
  const icon = { rain: "🌧️", snow: "❄️", storm: "⛈️", fog: "🌫️", cloudy: "☁️", clear: now.getHours() >= 6 && now.getHours() < 18 ? "☀️" : "🌙" }[wx?.kind || "clear"];
  g.font = "64px sans-serif"; g.fillText(icon, w / 2 - 120, 270);
  g.font = "bold 56px sans-serif"; g.fillStyle = "#fff";
  g.fillText(wx?.temp_c != null ? `${Math.round(wx.temp_c)}°C` : "--°", w / 2 + 60, 265);
  g.font = "24px sans-serif"; g.fillStyle = "#a99bc2"; g.fillText((wx?.text || "click for the forecast").slice(0, 30), w / 2, 305);
}

function drawBoard(g, w, h, tasks) {
  g.fillStyle = "#b58a5a"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#c99c68"; g.fillRect(14, 14, w - 28, h - 28);
  g.fillStyle = "#3a2618"; g.font = "bold 40px sans-serif"; g.textAlign = "center"; g.fillText("Today's top 3", w / 2, 62);
  const colors = ["#ffe98a", "#ffc6dd", "#bfe8ff"];
  (tasks.length ? tasks : [{ task: "No tasks. Enjoy your day! 🌸" }]).slice(0, 3).forEach((t, i) => {
    const y = 90 + i * 120;
    g.fillStyle = colors[i]; g.fillRect(40, y, w - 80, 100);
    g.fillStyle = "#d33"; g.beginPath(); g.arc(w / 2, y + 8, 9, 0, 7); g.fill();
    g.fillStyle = "#2a2020"; g.textAlign = "left"; g.font = "bold 30px sans-serif";
    g.fillText(`${i + 1}. ${t.task}`.slice(0, 32), 60, y + 50);
    if (t.deadline) { g.font = "22px sans-serif"; g.fillText(`due ${t.deadline}`, 60, y + 82); }
  });
}

export const LIVING_CATALOG = {
  ...Object.fromEntries(Object.keys(FRAME_STYLES).flatMap((st) => Object.keys(FRAME_SIZES).map((sz) => [`photoFrame_${st}_${sz}`, photoFrame(st, sz)]))),

  smartTv: { label: "Smart TV (YouTube / videos)", mount: "wall", defaultY: 1.5, category: "tech", build(ctx) {
    const { c, g: d, t } = canvasTex(512, 288);
    const draw = (playing) => {
      const grd = d.createLinearGradient(0, 0, 512, 288); grd.addColorStop(0, "#2b1d4a"); grd.addColorStop(1, "#7a2b5a");
      d.fillStyle = grd; d.fillRect(0, 0, 512, 288);
      d.fillStyle = "#fff"; d.font = "bold 34px sans-serif"; d.textAlign = "center";
      d.fillText(playing ? "▶ Now playing" : "▶ Click to play a video", 256, 140);
      d.font = "20px sans-serif"; d.fillText(playing ? (ctx.spec.video || "").slice(0, 44) : "YouTube link or music video", 256, 180);
      t.needsUpdate = true;
    };
    draw(false);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    screen.position.z = 0.035;
    const g = group(cube(1.7, 1.0, 0.05, std(0x0d0d10, { roughness: 0.25 }), 0, 0, 0), screen);
    void c;
    return { group: g, interact: { label: "Smart TV: play a video", onClick: () => {
      roomHooks.open?.("tv", { last: ctx.spec.video, save: (url) => { ctx.spec.video = url; draw(!!url); ctx._room.onChange?.(); } });
      return "tv";
    } } };
  } },

  weatherClock: { label: "Weather clock (click for the forecast)", mount: "wall", defaultY: 1.9, category: "walls", build() {
    const { g: d, t } = canvasTex(512, 330);
    let wx = null, since = 99, fetched = 999;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.52), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    screen.position.z = 0.03;
    const g = group(cube(0.88, 0.6, 0.04, std(0x2a2232), 0, 0, 0), screen);
    const refresh = async () => { wx = await roomHooks.api?.room_weather().catch(() => null); drawClock(d, 512, 330, wx); t.needsUpdate = true; };
    drawClock(d, 512, 330, null); t.needsUpdate = true;
    return { group: g, update: (time, dt) => {
      since += dt || 0.016; fetched += dt || 0.016;
      if (fetched > 1800) { fetched = 0; since = 0; refresh(); }
      else if (since > 20) { since = 0; drawClock(d, 512, 330, wx); t.needsUpdate = true; }
    }, interact: { label: "Weather clock: 5-day forecast", onClick: () => { roomHooks.open?.("forecast", wx); return "forecast"; } } };
  } },

  focusPlant: { label: "Focus plant (grows when you focus)", mount: "floor", category: "plants", build() {
    const g = group(cyl(0.18, 0.14, 0.28, std(0xd9805a), 0, 0.14, 0), cyl(0.17, 0.17, 0.02, std(0x4a3020), 0, 0.27, 0));
    const plant = new THREE.Group(); plant.position.y = 0.28; g.add(plant);
    let info = null, since = 999;
    const grow = (st) => {
      plant.clear();
      const leaf = std(st.wilt ? (st.wilt > 1 ? 0x8a7a3a : 0x7a9a3a) : 0x3fa84a);
      const h = 0.05 + st.stage * 0.14;
      if (st.stage === 0) { plant.add(ball(0.04, std(0x6b4a2a), 0, 0.02, 0)); return; }
      plant.add(cyl(0.012, 0.016, h, std(0x3f7a2e), 0, h / 2, 0));
      for (let i = 0; i < st.stage * 3; i++) {
        const l = ball(0.06 + st.stage * 0.008, leaf, Math.cos(i * 2.3) * 0.09, 0.06 + (i / (st.stage * 3)) * h, Math.sin(i * 2.3) * 0.09);
        l.scale.set(1, 0.35, 1.6); l.rotation.y = i * 2.3; l.rotation.z = st.wilt ? 0.6 * st.wilt : -0.2; plant.add(l);
      }
      if (st.stage >= 4 && !st.wilt) for (let i = 0; i < st.stage - 2; i++) plant.add(ball(0.035, glow(0xff8fc0, 0.6), Math.cos(i * 2) * 0.08, h + 0.02, Math.sin(i * 2) * 0.08));
      plant.rotation.z = st.wilt ? 0.15 * st.wilt : 0;
    };
    grow({ stage: 1, wilt: 0 });
    return { group: g, update: (t, dt) => {
      since += dt || 0.016;
      if (since > 600) { since = 0; roomHooks.api?.room_plant().then((s) => { if (s) { info = s; grow(s); } }).catch(() => {}); }
      plant.rotation.y = Math.sin(t * 0.5) * 0.05;
    }, interact: { label: "Focus plant: how is it?", onClick: () => info?.message || "growing" } };
  } },

  topTasksBoard: { label: "Top-3 tasks board (optional)", mount: "wall", defaultY: 1.6, category: "walls", build() {
    const { g: d, t } = canvasTex(512, 460);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.81), new THREE.MeshBasicMaterial({ map: t }));
    face.position.z = 0.03;
    const g = group(cube(0.96, 0.87, 0.04, std(0x6b4a2e), 0, 0, 0), face);
    let since = 999;
    const refresh = () => roomHooks.api?.room_tasks().then((r) => { drawBoard(d, 512, 460, r?.tasks || []); t.needsUpdate = true; }).catch(() => {});
    drawBoard(d, 512, 460, []); t.needsUpdate = true;
    return { group: g, update: (time, dt) => { since += dt || 0.016; if (since > 120) { since = 0; refresh(); } },
      interact: { label: "Top-3 tasks: open the planner", onClick: () => { roomHooks.open?.("planner"); since = 999; return "planner"; } } };
  } },
};

// ---------------------------------------------------------------- seasonal decorations (turn on by themselves)
export function buildDecor(kind) {
  const g = new THREE.Group();
  g.userData.decor = kind;
  const at = (obj, x, y, z) => { obj.position.set(x, y, z); g.add(obj); return obj; };
  if (kind === "halloween") {
    for (const [x, z, s] of [[-3.2, 1.6, 1], [-2.8, 2.0, 0.7], [3.4, 1.8, 0.85]]) {
      const p = group(ball(0.22 * s, std(0xff7a1a), 0, 0.2 * s, 0), cyl(0.02, 0.03, 0.08, std(0x3f7a2e), 0, 0.42 * s, 0),
        ...[-0.07, 0.07].map((ex) => ball(0.03 * s, glow(0xffd24d, 3), ex * s, 0.25 * s, 0.19 * s)));
      p.children[0].scale.y = 0.8; at(p, x, 0, z);
    }
    const bats = [];
    for (let i = 0; i < 5; i++) { const b = group(ball(0.04, std(0x1a1020), 0, 0, 0), ...[-1, 1].map((s) => { const w = cube(0.12, 0.01, 0.06, std(0x1a1020), s * 0.08, 0, 0); w.rotation.z = s * 0.3; return w; })); bats.push(at(b, -2 + i, 2.6, -1 + (i % 2))); }
    g.userData.tick = (t) => bats.forEach((b, i) => { b.position.y = 2.5 + Math.sin(t * 2 + i) * 0.15; b.position.x = -2 + i + Math.sin(t * 0.5 + i) * 0.4; b.children[1].rotation.z = Math.sin(t * 15) * 0.6; b.children[2].rotation.z = -Math.sin(t * 15) * 0.6; });
    lightOn(g, 0xff7a1a, 2, 0.5).position.set(-3, 0.5, 1.8);
  } else if (kind === "christmas") {
    const tree = group(cyl(0.06, 0.08, 0.3, std(0x5a3a26), 0, 0.15, 0),
      ...[0, 1, 2].map((i) => mesh(new THREE.ConeGeometry(0.7 - i * 0.18, 0.7, 24), std(0x1f6b3a), 0, 0.6 + i * 0.4, 0)),
      mesh(new THREE.OctahedronGeometry(0.1), glow(0xffd24d, 3), 0, 1.75, 0));
    const bulbs = [];
    for (let i = 0; i < 18; i++) { const a = i * 1.7, y = 0.5 + (i / 18) * 1.1, r = 0.6 * (1 - (y - 0.4) / 1.4); bulbs.push(ball(0.035, glow([0xff3b3b, 0xffd24d, 0x4dc8ff, 0x7fff7f][i % 4], 2), Math.cos(a) * r, y, Math.sin(a) * r)); }
    tree.add(...bulbs);
    at(tree, -3.3, 0, 1.6);
    at(group(cube(0.25, 0.2, 0.25, std(0xd83a3a), 0, 0.1, 0), cube(0.27, 0.04, 0.05, std(0xffd24d), 0, 0.2, 0)), -2.8, 0, 2.1);
    lightOn(g, 0xffc070, 2.5, 1).position.set(-3.3, 1.2, 1.6);
    g.userData.tick = (t) => bulbs.forEach((b, i) => { b.material.emissiveIntensity = 1 + Math.max(0, Math.sin(t * 3 + i)) * 2; });
  } else if (kind === "valentine") {
    const hearts = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Shape(); s.moveTo(0, -0.1); s.bezierCurveTo(-0.18, 0.02, -0.08, 0.14, 0, 0.06); s.bezierCurveTo(0.08, 0.14, 0.18, 0.02, 0, -0.1);
      hearts.push(at(mesh(new THREE.ShapeGeometry(s), glow(0xff5f8f, 1.2)), -2.5 + i * 0.7, 2.3, -1.5 + (i % 3) * 0.5));
    }
    g.userData.tick = (t) => hearts.forEach((h, i) => { h.position.y = 2.2 + Math.sin(t + i) * 0.12; h.rotation.y = t * 0.5 + i; });
  } else if (kind === "spring" || kind === "summer" || kind === "autumn") {
    const c = { spring: [0xff9fc8, 0xfff07f], summer: [0xffd24d, 0x4dc8ff], autumn: [0xd8742a, 0xa83a2a] }[kind];
    at(group(cyl(0.12, 0.1, 0.25, std(0xe6e0d6), 0, 0.12, 0), ...Array.from({ length: 7 }, (_, i) => group(cyl(0.008, 0.008, 0.35, std(0x3f7a2e), Math.cos(i) * 0.05, 0.4, Math.sin(i) * 0.05),
      ball(0.05, std(c[i % 2]), Math.cos(i) * 0.08, 0.6 + (i % 3) * 0.04, Math.sin(i) * 0.08)))), -3.3, 0, 1.8);
  }
  return g;
}

// ---------------------------------------------------------------- ambient sounds (made in the browser, no files)
const SOUNDS = { off: "Off", rain: "🌧️ Rain", fire: "🔥 Fireplace", cafe: "☕ Café hum", forest: "🌲 Forest wind", ocean: "🌊 Ocean waves", gym: "🏋️ Gym hum" };
export const AMBIENT_SOUNDS = SOUNDS;
export const ambient = {
  ctx: null, nodes: [], kind: "off", volume: 0.4,
  play(kind = this.kind, volume = this.volume) {
    this.stop();
    this.kind = kind; this.volume = volume;
    if (kind === "off" || !SOUNDS[kind]) return;
    const ac = this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    ac.resume?.();
    const len = ac.sampleRate * 4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {                                 // brown-ish noise; crackle pops for the fire
      const w = Math.random() * 2 - 1;
      last = kind === "rain" || kind === "cafe" ? w * 0.5 : (last + 0.02 * w) / 1.02;
      d[i] = last * (kind === "rain" ? 1 : 3.5) + (kind === "fire" && Math.random() < 0.0004 ? (Math.random() - 0.5) * 2 : 0);
    }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const filt = ac.createBiquadFilter();
    filt.type = kind === "rain" ? "highpass" : "lowpass";
    filt.frequency.value = { rain: 900, fire: 700, cafe: 500, forest: 400, ocean: 600, gym: 220 }[kind];
    const gain = ac.createGain(); gain.gain.value = volume;
    src.connect(filt).connect(gain).connect(ac.destination);
    if (kind === "ocean" || kind === "forest") {                   // slow swell, like waves or gusts
      const lfo = ac.createOscillator(), depth = ac.createGain();
      lfo.frequency.value = kind === "ocean" ? 0.12 : 0.07; depth.gain.value = volume * 0.6;
      lfo.connect(depth).connect(gain.gain); lfo.start(); this.nodes.push(lfo);
    }
    src.start();
    this.nodes.push(src); this.gain = gain;
  },
  setVolume(v) { this.volume = v; if (this.gain) this.gain.gain.value = v; },
  stop() { for (const n of this.nodes) try { n.stop(); } catch { /* already stopped */ } this.nodes = []; this.gain = null; },
};
