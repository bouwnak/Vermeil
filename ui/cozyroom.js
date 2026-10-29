// cozyroom.js - the customizable cozy room: a shell (walls, floor, window) plus furniture items
// that can be added, moved, turned and removed. The layout is plain JSON so it can be saved.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { DEN_CATALOG, DEN_LAYOUT } from "./denroom.js";
import { GYM_CATALOG } from "./gymroom.js";
import { DND_FURNITURE_CATALOG } from "./dnd_furniture.js";
import { PET_CATALOG } from "./pets.js";
import { House } from "./house.js";

const W = 5, BACK = -4, FRONT = 4.5, H = 3.2;     // room: x -5..5, z -4..4.5, height 3.2 m

// ---------- tiny helpers ----------
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const glow = (color, intensity = 2.5) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });

function box(w, h, d, mat, x = 0, y = 0, z = 0, r = 0) {
  const g = r ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rng(seed) {                       // repeatable randomness so the room looks the same every time
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

// ---------- textures ----------
const FLOORS = {
  "dark wood": { hue: 24, sat: 38, light: 22 },
  "light wood": { hue: 32, sat: 40, light: 52 },
  "cherry wood": { hue: 10, sat: 45, light: 30 },
  "grey wood": { hue: 260, sat: 8, light: 34 },
  "cream carpet": { carpet: true },
};
const woodTexture = (style = "dark wood") => canvasTexture(1024, 1024, (g, w, h) => {
  const { hue, sat, light } = FLOORS[style] || FLOORS["dark wood"];
  const r = rng(7);
  for (let y = 0; y < h; y += 64) {
    for (let x = -(y % 3) * 120; x < w; x += 360) {
      const l = light + r() * 10;
      g.fillStyle = `hsl(${hue}, ${sat}%, ${l}%)`;
      g.fillRect(x, y, 360, 64);
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.strokeRect(x + 0.5, y + 0.5, 360, 64);
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = `rgba(0,0,0,${0.06 + r() * 0.08})`;
        g.beginPath();
        g.moveTo(x, y + 8 + r() * 48);
        g.bezierCurveTo(x + 120, y + r() * 64, x + 240, y + r() * 64, x + 360, y + 8 + r() * 48);
        g.stroke();
      }
    }
  }
});

// ---------- time of day ----------
// Keyframes through a day (hour 0-24). Everything in between is blended, so the sky
// and the room light change smoothly in "Auto" and "Fast day cycle" modes.
const TIME_KEYS = [
  { h: 0,    top: "#0b0720", mid: "#24124a", bot: "#3e1f66", sun: "#8f86ff", sunI: 1.0, hemiS: "#4b3a78", hemiG: "#160d1e", hemiI: 0.8,  glow: "#9a86ff", exp: 1.1,  stars: 1,   lit: 0.45, town: 0 },
  { h: 5,    top: "#141033", mid: "#3a2a66", bot: "#7a4f8f", sun: "#9d8cff", sunI: 1.0, hemiS: "#5a4a88", hemiG: "#1d1424", hemiI: 0.9,  glow: "#a88cff", exp: 1.1,  stars: 0.6, lit: 0.35, town: 0.1 },
  { h: 6.3,  top: "#3b4a8c", mid: "#d98aa0", bot: "#ffc28a", sun: "#ffb27a", sunI: 1.5, hemiS: "#c9a3c0", hemiG: "#3a2a30", hemiI: 1.1,  glow: "#ffb08a", exp: 1.12, stars: 0.1, lit: 0.2,  town: 0.45 },
  { h: 8,    top: "#6fa6e0", mid: "#a9cdf0", bot: "#f5e2c8", sun: "#fff0d6", sunI: 1.7, hemiS: "#cfe2ff", hemiG: "#5a4a3c", hemiI: 1.25, glow: "#ffe8c8", exp: 0.88,  stars: 0,   lit: 0.05, town: 0.85 },
  { h: 12.5, top: "#4f93e0", mid: "#8cc0f0", bot: "#dbeeff", sun: "#ffffff", sunI: 1.9, hemiS: "#e2efff", hemiG: "#6a5a4a", hemiI: 1.4,  glow: "#f2f6ff", exp: 0.82, stars: 0,   lit: 0.03, town: 1 },
  { h: 16.5, top: "#5a8ad0", mid: "#e8b583", bot: "#ffd59a", sun: "#ffd29a", sunI: 2.0, hemiS: "#ffe0b8", hemiG: "#5a4030", hemiI: 1.5,  glow: "#ffd09a", exp: 0.95,  stars: 0,   lit: 0.1,  town: 0.8 },
  { h: 18.3, top: "#2a2a6b", mid: "#c0558f", bot: "#ffb36b", sun: "#ff9a6a", sunI: 1.9, hemiS: "#e0a0b0", hemiG: "#3a2430", hemiI: 1.5,  glow: "#ff9a6a", exp: 1.08, stars: 0.05, lit: 0.3, town: 0.45 },
  { h: 19.6, top: "#1a1440", mid: "#4a2a70", bot: "#a0507a", sun: "#b08cff", sunI: 1.2, hemiS: "#6a4f9a", hemiG: "#1d1424", hemiI: 1.0,  glow: "#b08cff", exp: 1.1,  stars: 0.5, lit: 0.45, town: 0.15 },
  { h: 21,   top: "#0b0720", mid: "#24124a", bot: "#3e1f66", sun: "#8f86ff", sunI: 1.0, hemiS: "#4b3a78", hemiG: "#160d1e", hemiI: 0.8,  glow: "#9a86ff", exp: 1.1,  stars: 1,   lit: 0.45, town: 0 },
  { h: 24,   top: "#0b0720", mid: "#24124a", bot: "#3e1f66", sun: "#8f86ff", sunI: 1.0, hemiS: "#4b3a78", hemiG: "#160d1e", hemiI: 0.8,  glow: "#9a86ff", exp: 1.1,  stars: 1,   lit: 0.45, town: 0 },
];

export const TIME_PRESETS = {
  auto: { label: "Auto (follows your clock)" },
  cycle: { label: "Fast day cycle (a day every 4 minutes)" },
  dawn: { label: "Dawn", hour: 6.3 },
  morning: { label: "Morning", hour: 8.5 },
  day: { label: "Midday", hour: 12.5 },
  golden: { label: "Golden hour", hour: 16.8 },
  sunset: { label: "Sunset", hour: 18.3 },
  dusk: { label: "Dusk", hour: 19.6 },
  night: { label: "Night", hour: 23 },
};

export function timeState(hour) {
  hour = ((hour % 24) + 24) % 24;
  let i = TIME_KEYS.findIndex((k) => k.h > hour);
  if (i <= 0) i = 1;
  const a = TIME_KEYS[i - 1], b = TIME_KEYS[i];
  const f = (hour - a.h) / (b.h - a.h);
  const out = { hour };
  const ca = new THREE.Color(), cb = new THREE.Color();
  for (const key of Object.keys(a)) {
    if (key === "h") continue;
    if (typeof a[key] === "string") out[key] = "#" + ca.set(a[key]).lerp(cb.set(b[key]), f).getHexString();
    else out[key] = a[key] + (b[key] - a[key]) * f;
  }
  return out;
}

function skyTexture(st) {
  return canvasTexture(1024, 768, (g, w, h) => {
    const r = rng(3);
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, st.top); sky.addColorStop(0.55, st.mid); sky.addColorStop(1, st.bot);
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.globalAlpha = st.stars;
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.8})`; g.fillRect(r() * w, r() * h * 0.55, 2, 2); }
    g.globalAlpha = 1;
    // sun from ~6:00 to ~19:00, moon otherwise; both travel across the window
    const day = st.hour >= 6 && st.hour <= 19;
    const p = day ? (st.hour - 6) / 13 : ((st.hour + 24 - 19) % 24) / 11;
    const cx = 120 + p * 780, cy = 560 - Math.sin(p * Math.PI) * 470;
    const size = day ? 70 : 85;
    const disc = g.createRadialGradient(cx, cy, 8, cx, cy, size * (day ? 2.2 : 1));
    if (day) {
      disc.addColorStop(0, "#fffbe8"); disc.addColorStop(0.25, "rgba(255,236,190,0.9)"); disc.addColorStop(1, "rgba(255,220,160,0)");
    } else {
      disc.addColorStop(0, "#fff7e0"); disc.addColorStop(0.45, "#ffe9b8"); disc.addColorStop(0.5, "rgba(255,230,170,0.35)"); disc.addColorStop(1, "rgba(255,230,170,0)");
    }
    g.fillStyle = disc; g.beginPath(); g.arc(cx, cy, size * (day ? 2.2 : 1), 0, Math.PI * 2); g.fill();
    // city skyline: dark silhouettes at night, soft blue-grey buildings by day
    const night = [[29, 18, 56], [22, 13, 44], [13, 8, 32]], noon = [[150, 170, 200], [125, 145, 178], [100, 118, 150]];
    for (let layer = 0; layer < 3; layer++) {
      const c = night[layer].map((v, k) => Math.round(v + (noon[layer][k] - v) * st.town));
      let x = 0;
      while (x < w) {
        const bw = 30 + r() * 70, bh = 120 + r() * (layer === 1 ? 420 : 280) - layer * 60;
        const top = h - bh;
        g.fillStyle = `rgb(${c})`;
        g.fillRect(x, top, bw, bh);
        if (layer === 1 && r() > 0.7) g.fillRect(x + bw / 2 - 2, top - 60, 4, 60);
        for (let wy = top + 10; wy < h - 6; wy += 14) {
          for (let wx = x + 5; wx < x + bw - 6; wx += 10) {
            const lit = r() < st.lit;
            const warm = r() > 0.2;
            if (lit) {
              g.fillStyle = warm ? "#ffd28a" : "#c58cff";
              g.globalAlpha = 0.6 + r() * 0.4; g.fillRect(wx, wy, 4, 6); g.globalAlpha = 1;
            }
          }
        }
        x += bw + 2 + r() * 8;
      }
    }
  });
}

const neonTexture = (lines) => canvasTexture(512, 1024, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.textAlign = "center";
  g.font = "italic 600 92px 'Segoe Script', 'Brush Script MT', cursive";
  lines.forEach((t, i) => {
    g.shadowColor = "#c98bff"; g.shadowBlur = 30; g.fillStyle = "#f3dcff";
    g.fillText(t, w / 2, 130 + i * 140);
  });
});

const posterTexture = (title, hue) => canvasTexture(512, 720, (g, w, h) => {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, `hsl(${hue}, 45%, 18%)`); bg.addColorStop(1, `hsl(${hue + 30}, 55%, 8%)`);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = `hsla(${hue}, 80%, 75%, 0.9)`;
  g.beginPath(); g.arc(w / 2, h * 0.38, 120, 0, Math.PI * 2); g.fill();
  g.fillStyle = `hsl(${hue + 30}, 55%, 8%)`;
  g.beginPath(); g.arc(w / 2 + 50, h * 0.34, 110, 0, Math.PI * 2); g.fill();
  g.font = "italic 600 64px 'Segoe Script', cursive"; g.textAlign = "center";
  g.fillStyle = `hsl(${hue}, 80%, 82%)`;
  title.split("\n").forEach((t, i) => g.fillText(t, w / 2, h * 0.68 + i * 72));
});

const monitorTexture = (name) => canvasTexture(1024, 600, (g, w, h) => {
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "#1b1030"); bg.addColorStop(1, "#4a2380");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = "#f2e6ff"; g.font = "700 64px Nunito, 'Segoe UI', sans-serif"; g.fillText(name, 60, 110);
  g.font = "32px Nunito, 'Segoe UI', sans-serif"; g.fillStyle = "#c9b3e6"; g.fillText("Your AI companion", 62, 160);
  ["Talk", "Help", "Create", "Explore", "Together"].forEach((t, i) => {
    g.strokeStyle = "#c9b3e6"; g.lineWidth = 3; g.beginPath(); g.arc(80, 240 + i * 62, 14, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#f2e6ff"; g.fillText(t, 112, 252 + i * 62);
  });
  const glowC = g.createRadialGradient(760, 330, 20, 760, 330, 260);
  glowC.addColorStop(0, "rgba(200,140,255,0.55)"); glowC.addColorStop(1, "rgba(200,140,255,0)");
  g.fillStyle = glowC; g.fillRect(480, 40, 540, 560);
});

// ---------- the room ----------

// ======================================================================
// Furniture catalog. Every item is built facing +z (towards you); the
// layout says where it goes and how it is turned.
//   floor items: { type, x, z, rot, y? }
//   wall items:  { type, wall: "back" | "left" | "right", u, y }
// ======================================================================
const r = rng(11);

function plantMesh(s = 1) {
  const g = new THREE.Group();
  g.add(box(0.22 * s, 0.24 * s, 0.22 * s, std(0xd7cbbf), 0, 0.12 * s, 0, 0.03 * s));
  const leaf = std(0x2f6b3a, { roughness: 0.9 });
  for (let i = 0; i < 7; i++) {
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12 * s, 0), leaf);
    l.position.set((r() - 0.5) * 0.25 * s, (0.32 + r() * 0.3) * s, (r() - 0.5) * 0.25 * s);
    l.castShadow = true;
    g.add(l);
  }
  return g;
}

function booksMesh(width) {
  const g = new THREE.Group();
  let bx = -width / 2;
  while (bx < width / 2 - 0.05) {
    const w = 0.04 + r() * 0.04, h = 0.18 + r() * 0.1;
    const b = box(w, h, 0.16, std(new THREE.Color().setHSL(0.7 + r() * 0.35, 0.35, 0.25 + r() * 0.25)), bx + w / 2, h / 2, 0);
    if (r() > 0.88) b.rotation.z = 0.25;
    g.add(b);
    bx += w + 0.005;
  }
  return g;
}

function candleMesh(ctx) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 16), std(0xf3e6d6));
  body.position.y = 0.045;
  g.add(body);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), glow(0xffb347, 6));
  flame.scale.y = 1.8; flame.position.y = 0.115; g.add(flame);
  const l = new THREE.PointLight(0xff9a3a, 1.2, 2, 2); l.position.y = 0.19; g.add(l);
  const seed = r() * 10;
  ctx.update = (t) => {
    const n = Math.sin(t * 13 + seed) * 0.5 + Math.sin(t * 7.3 + seed * 2) * 0.5;
    l.intensity = 1.2 * (0.85 + n * 0.15);
    flame.scale.y = 1.8 + n * 0.25;
  };
  return g;
}

function toggleLight(label, light, mat, onIntensity) {
  return {
    label,
    onClick: () => {
      light.visible = !light.visible;
      mat.emissiveIntensity = light.visible ? onIntensity : 0.05;
      return light.visible ? "on" : "off";
    },
  };
}

export const CATALOG = {
  bed: { label: "Bed", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(box(2.4, 0.3, 3.0, std(0x24192b), 0, 0.2, 0, 0.05));
    g.add(box(2.3, 0.25, 2.9, std(0xd9d0e0), 0, 0.45, 0, 0.08));
    g.add(box(2.36, 0.12, 2.0, std(0x5a2f78, { roughness: 1 }), 0, 0.6, 0.45, 0.06));
    g.add(box(2.5, 1.2, 0.15, std(0x24192b), 0, 0.75, -1.5, 0.05));
    [[-0.6, 0x6b5a7a], [0.6, 0x8a6a9a], [0, 0x4b2d63]].forEach(([x, c], i) => {
      const p = box(0.75, 0.22, 0.4, std(c, { roughness: 1 }), x, 0.72 + i * 0.03, -1.1 + i * 0.12, 0.1);
      p.rotation.x = -0.3; g.add(p);
    });
    const under = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.02, 3.1), glow(0xffa04a, 3));
    under.position.y = 0.06; g.add(under);
    const l = new THREE.PointLight(0xff9a4a, 2.5, 3, 2); l.position.set(0, 0.1, 0.8); g.add(l);
    return { group: g, interact: toggleLight("Bed light: switch on/off", l, under.material, 3) };
  } },

  desk: { label: "Desk + monitor", mount: "floor", build(ctx) {
    const g = new THREE.Group();
    g.add(box(2.2, 0.05, 1.0, std(0x2b2026), 0, 0.76, 0));
    g.add(box(0.5, 0.74, 0.95, std(0x231a20), 0.8, 0.37, 0));
    g.add(box(0.05, 0.74, 0.05, std(0x231a20), -1.0, 0.37, -0.4));
    const screenMat = new THREE.MeshBasicMaterial({ map: monitorTexture(ctx.name || "Vermeil"), toneMapped: false });
    const monitor = new THREE.Group();
    monitor.add(box(1.05, 0.62, 0.05, std(0x111111), 0, 0, 0));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.57), screenMat);
    screen.position.z = 0.03; monitor.add(screen);
    monitor.add(box(0.05, 0.2, 0.05, std(0x111111), 0, -0.38, -0.05));
    monitor.position.set(0.1, 1.25, -0.2);
    g.add(monitor);
    g.add(box(0.5, 0.02, 0.18, glow(0x9a5cff, 1.5), 0.1, 0.8, 0.15));
    const l = new THREE.PointLight(0x9a6bff, 4, 3, 2); l.position.set(0.1, 1.3, 0.4); g.add(l);
    ctx.setScreenName = (name) => { screenMat.map.dispose(); screenMat.map = monitorTexture(name); screenMat.needsUpdate = true; };
    return { group: g, interact: { label: "Monitor: turn on/off", onClick: () => {
      screen.visible = !screen.visible; l.visible = screen.visible; return screen.visible ? "on" : "off";
    } } };
  } },

  deskLamp: { label: "Desk lamp", mount: "floor", defaultY: 0.785, build() {
    const g = new THREE.Group();
    g.add(box(0.14, 0.03, 0.14, std(0x1a1a1a), 0, 0.015, 0));
    g.add(box(0.02, 0.4, 0.02, std(0x1a1a1a), 0, 0.2, 0));
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.12, 20, 1, true), std(0x1a1a1a, { side: THREE.DoubleSide }));
    shade.position.set(0, 0.42, 0.05); shade.rotation.x = 0.6; g.add(shade);
    const bulbMat = glow(0xffc27a, 3);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), bulbMat); bulb.position.set(0, 0.38, 0.07); g.add(bulb);
    const l = new THREE.PointLight(0xffb36b, 5, 3, 2); l.position.set(0, 0.35, 0.1); g.add(l);
    return { group: g, interact: toggleLight("Desk lamp: switch on/off", l, bulbMat, 3) };
  } },

  floorLamp: { label: "Floor lamp", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 24), std(0x1a1a1a)));
    g.add(box(0.03, 1.5, 0.03, std(0x1a1a1a), 0, 0.77, 0));
    const shadeMat = new THREE.MeshStandardMaterial({ color: 0xffe2bd, emissive: 0xffb36b, emissiveIntensity: 1.6, side: THREE.DoubleSide });
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.3, 24, 1, true), shadeMat);
    shade.position.y = 1.55; g.add(shade);
    const l = new THREE.PointLight(0xffb36b, 6, 4.5, 2); l.position.y = 1.45; g.add(l);
    return { group: g, interact: toggleLight("Floor lamp: switch on/off", l, shadeMat, 1.6) };
  } },

  chair: { label: "Gaming chair", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(box(0.55, 0.1, 0.55, std(0x2a2030), 0, 0.5, 0, 0.04));
    g.add(box(0.55, 0.8, 0.1, std(0x3a2a48), 0, 0.95, -0.25, 0.05));
    g.add(box(0.06, 0.45, 0.06, std(0x111111), 0, 0.25, 0));
    g.add(box(0.6, 0.04, 0.6, std(0x111111), 0, 0.03, 0, 0.02));
    return { group: g };
  } },

  sofa: { label: "Sofa", mount: "floor", build() {
    const g = new THREE.Group();
    const m = std(0x8d84a0, { roughness: 1 });
    g.add(box(2.4, 0.4, 0.9, m, 0, 0.3, 0, 0.08));
    g.add(box(2.4, 0.6, 0.25, m, 0, 0.7, -0.33, 0.08));
    for (const x of [-1.15, 1.15]) g.add(box(0.2, 0.55, 0.9, m, x, 0.42, 0, 0.08));
    [[-0.5, 0x4b2d63], [0.4, 0x6b4c8a]].forEach(([x, c]) => {
      const p = box(0.45, 0.4, 0.15, std(c, { roughness: 1 }), x, 0.68, -0.15, 0.08); p.rotation.x = -0.2; g.add(p);
    });
    g.add(box(0.6, 0.04, 0.7, std(0x3b2f4d, { roughness: 1 }), 0.6, 0.52, 0.05, 0.02));
    return { group: g };
  } },

  coffeeTable: { label: "Coffee table + candle", mount: "floor", build(ctx) {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 40), std(0x1c1418, { roughness: 0.4 }));
    top.position.y = 0.45; top.castShadow = true; g.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.012, 8, 40), std(0x111111));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; g.add(ring);
    for (let i = 0; i < 4; i++) g.add(box(0.02, 0.43, 0.02, std(0x111111), Math.cos(i * Math.PI / 2) * 0.44, 0.22, Math.sin(i * Math.PI / 2) * 0.44));
    g.add(box(0.3, 0.05, 0.22, std(0x5a3a6a), -0.15, 0.495, 0.1));
    const c = candleMesh(ctx); c.position.set(0.15, 0.47, -0.15); g.add(c);
    return { group: g };
  } },

  rug: { label: "Round rug", mount: "floor", flat: true, build() {
    const g = new THREE.Group();
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.9, 64), std(0x3a2442, { roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.y = 0.006; rug.receiveShadow = true;
    const edge = new THREE.Mesh(new THREE.RingGeometry(1.86, 1.9, 64), std(0x55345e));
    edge.rotation.x = -Math.PI / 2; edge.position.y = 0.008;
    g.add(rug, edge);
    return { group: g, walkable: true };
  } },

  bookshelf: { label: "Bookshelf", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(box(1.0, 2.4, 0.35, std(0x2a1d22), 0, 1.2, 0));
    for (let i = 0; i < 4; i++) {
      g.add(box(0.92, 0.03, 0.3, std(0x3d2b30), 0, 0.35 + i * 0.55, 0.02));
      if (i < 3) { const b = booksMesh(0.6); b.position.set(-0.05, 0.37 + i * 0.55, 0.04); g.add(b); }
    }
    const p = plantMesh(0.8); p.position.set(0.3, 2.0, 0.05); g.add(p);
    return { group: g };
  } },

  radio: { label: "Radio (plays your playlist)", mount: "floor", defaultY: 0, build(ctx) {
    const g = new THREE.Group();
    g.add(box(0.32, 0.2, 0.14, std(0x6b4a3a), 0, 0.1, 0, 0.03));
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), glow(0xffb36b, 1));
    dial.position.set(0.08, 0.1, 0.071); g.add(dial);
    g.add(box(0.12, 0.12, 0.005, std(0x2a1a14), -0.07, 0.1, 0.071));
    let on = false;
    ctx.update = (t) => { g.scale.setScalar(on ? 1 + Math.sin(t * 12) * 0.012 : 1); };
    return { group: g, interact: { label: "Radio: play your playlist", onClick: () => {
      on = !on; dial.material.emissiveIntensity = on ? 4 : 1; return on ? "on" : "off";
    } } };
  } },

  beanBag: { label: "Bean bag", mount: "floor", build() {
    const g = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16), std(0x1f1a24, { roughness: 1 }));
    bag.scale.set(1.1, 0.6, 1); bag.position.y = 0.3; bag.castShadow = true;
    g.add(bag);
    return { group: g };
  } },

  cat: { label: "Sleeping cat", mount: "floor", build(ctx) {
    const cat = new THREE.Group();
    const fur = std(0xf2ede6), dark = std(0x2d2a2e);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), fur); body.scale.set(1.3, 0.75, 1); body.position.y = 0.13; cat.add(body);
    const patch = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10), dark); patch.position.set(0.05, 0.19, 0); patch.scale.set(1.3, 0.6, 1); cat.add(patch);
    const head = new THREE.Group(); head.position.set(-0.2, 0.16, 0.05);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), dark));
    for (const z of [-0.05, 0.05]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 4), dark); ear.position.set(0, 0.09, z); head.add(ear); }
    cat.add(head);
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 20, Math.PI * 1.1), dark);
    tail.rotation.x = Math.PI / 2; tail.position.set(0.05, 0.08, 0); cat.add(tail);
    cat.traverse((o) => (o.castShadow = true));
    let petted = 0;
    ctx.update = (t, dt) => {
      body.scale.y = 0.75 + Math.sin(t * 2) * 0.02;
      if (petted > 0) {
        petted -= dt;
        head.rotation.z = Math.sin(t * 9) * 0.25; tail.rotation.z = Math.sin(t * 14) * 0.3;
      } else { head.rotation.z *= 0.9; tail.rotation.z *= 0.9; }
    };
    return { group: cat, interact: { label: "Cat: pet her", onClick: () => { petted = 1.5; return "petted"; } } };
  } },

  moonLamp: { label: "Cabinet + moon lamp", mount: "floor", build() {
    const g = new THREE.Group();
    g.add(box(0.4, 0.8, 0.6, std(0x2a1d22), 0, 0.4, 0));
    const b = booksMesh(0.3); b.position.set(0, 0.82, -0.1); g.add(b);
    const mat = glow(0xffd7a8, 2.2);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 24), mat); moon.position.set(0, 0.99, 0.12); g.add(moon);
    const l = new THREE.PointLight(0xffc48a, 4, 4, 2); l.position.set(0, 1.1, 0.3); g.add(l);
    return { group: g, interact: toggleLight("Moon lamp: switch on/off", l, mat, 2.2) };
  } },

  plant: { label: "Small plant", mount: "floor", build() { return { group: plantMesh(0.8) }; } },
  bigPlant: { label: "Big plant", mount: "floor", build() { return { group: plantMesh(1.4) }; } },
  candle: { label: "Candle", mount: "floor", build(ctx) { return { group: candleMesh(ctx) }; } },

  hexLights: { label: "Hexagon lights", mount: "wall", defaultY: 2.05, build() {
    const colors = [0xa66bff, 0xff5fb7, 0x47d7ff, 0xffb14a];
    let i = 0;
    const g = new THREE.Group();
    const mat = glow(colors[0], 3);
    [[0, 0], [0.42, 0.24], [0.42, -0.24], [0.84, 0], [0.84, 0.48]].forEach(([x, y]) => {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 6), mat);
      h.rotation.x = Math.PI / 2; h.rotation.y = Math.PI / 6; h.position.set(x - 0.42, y, 0.02);
      g.add(h);
    });
    const l = new THREE.PointLight(colors[0], 5, 4, 2); l.position.set(0, 0, 0.6); g.add(l);
    return { group: g, interact: { label: "Wall lights: change colour", onClick: () => {
      i = (i + 1) % colors.length; mat.color.set(colors[i]); mat.emissive.set(colors[i]); l.color.set(colors[i]);
      return ["purple", "pink", "cyan", "amber"][i];
    } } };
  } },

  neonSign: { label: "Neon sign", mount: "wall", defaultY: 1.95, build() {
    const g = new THREE.Group();
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.8),
      new THREE.MeshBasicMaterial({ map: neonTexture(["Good", "Food", "Good", "Mood", "Better", "Together ♡"]), transparent: true, toneMapped: false }));
    neon.position.z = 0.02; g.add(neon);
    const l = new THREE.PointLight(0xc98bff, 3, 3.5, 2); l.position.z = 0.5; g.add(l);
    return { group: g, interact: { label: "Neon sign: switch on/off", onClick: () => {
      neon.visible = !neon.visible; l.visible = neon.visible; return neon.visible ? "on" : "off";
    } } };
  } },

  poster: { label: "Poster", mount: "wall", defaultY: 2.0, build(ctx) {
    const titles = [["Better\nThings\nAhead", 275], ["Moon\nChild", 230], ["Stay\nCozy", 320], ["Dream\nBig", 200]];
    const [t, hue] = titles[(ctx.spec.variant || 0) % titles.length];
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.05), new THREE.MeshStandardMaterial({ map: posterTexture(t, hue), roughness: 0.9 }));
    p.position.z = 0.02;
    const g = new THREE.Group(); g.add(p);
    return { group: g };
  } },

  wallShelf: { label: "Wall shelf", mount: "wall", defaultY: 2.25, build() {
    const g = new THREE.Group();
    g.add(box(2.0, 0.03, 0.3, std(0x3d2b30), 0, 0, 0.16));
    const b = booksMesh(0.7); b.position.set(-0.5, 0.02, 0.18); g.add(b);
    const p = plantMesh(0.7); p.position.set(0.6, 0.02, 0.18); g.add(p);
    return { group: g };
  } },
};

export const DEFAULT_LAYOUT = {
  shell: { wall: "#2c2034", floor: "dark wood", sky: "auto" },
  items: [
    { type: "rug", x: 0.4, z: 0.7, rot: 0 },
    { type: "bed", x: -3.6, z: -2.4, rot: 0 },
    { type: "bookshelf", x: -1.0, z: -3.8, rot: 0 },
    { type: "radio", x: -1.2, z: -3.76, rot: 0, y: 1.5 },
    { type: "candle", x: -1.3, z: -3.76, rot: 0, y: 0.92 },
    { type: "desk", x: -4.45, z: 1.6, rot: Math.PI / 2 },
    { type: "deskLamp", x: -4.65, z: 0.65, rot: Math.PI / 2, y: 0.785 },
    { type: "candle", x: -4.6, z: 0.35, rot: 0, y: 0.785 },
    { type: "plant", x: -4.6, z: 2.45, rot: 0, y: 0.785 },
    { type: "chair", x: -3.8, z: 2.0, rot: -Math.PI / 2 },
    { type: "sofa", x: 4.45, z: 1.4, rot: -Math.PI / 2 },
    { type: "coffeeTable", x: 2.1, z: 1.5, rot: 0 },
    { type: "beanBag", x: 3.3, z: -2.7, rot: 0 },
    { type: "cat", x: 3.3, z: -2.7, rot: 0, y: 0.47 },
    { type: "moonLamp", x: 4.65, z: 3.4, rot: -Math.PI / 2 },
    { type: "bigPlant", x: 4.6, z: -0.2, rot: 0 },
    { type: "plant", x: 3.9, z: -3.85, rot: 0, y: 0.55 },
    { type: "plant", x: 0.6, z: -3.85, rot: 0, y: 0.55 },
    { type: "hexLights", wall: "back", u: -2.0, y: 2.05 },
    { type: "poster", wall: "back", u: -1.0, y: 2.0, variant: 0 },
    { type: "poster", wall: "left", u: 1.2, y: 2.05, variant: 1 },
    { type: "neonSign", wall: "right", u: -1.2, y: 1.95 },
    { type: "wallShelf", wall: "left", u: 1.6, y: 2.25 },
  ],
};


// ---------- cozy wooden loft pieces ----------
const WOOD = 0xc9a274, WOOD_DARK = 0xa9825a, LINEN = 0xe6dccb, CREAM = 0xf1e9dc, OAT = 0xd8c6a8;

function leafCluster(count, spread, s = 1, color = 0x4f7a3a) {
  const g = new THREE.Group();
  const mat = std(color, { roughness: 0.8 });
  for (let i = 0; i < count; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 8, 6), mat);
    l.scale.set(1.4, 0.5, 1);
    l.position.set((r() - 0.5) * spread, (r() - 0.5) * spread * 0.5, (r() - 0.5) * spread);
    l.rotation.set(r() * 3, r() * 3, r() * 3);
    l.castShadow = true;
    g.add(l);
  }
  return g;
}

function vineStrand(length, s = 1) {
  const g = new THREE.Group();
  const mat = std(0x5a8a3c, { roughness: 0.8 });
  let x = 0, y = 0;
  for (let i = 0; i < length * 14; i++) {
    y -= 0.07; x += (r() - 0.5) * 0.04;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.045 * s, 8, 6), mat);
    l.scale.set(1.3, 0.45, 1); l.position.set(x, y, (r() - 0.5) * 0.05); l.rotation.set(r(), r() * 3, r());
    g.add(l);
  }
  return g;
}

function knitTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = "#efe7d8"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      g.strokeStyle = "rgba(150,130,100,0.35)"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8, y + 14); g.lineTo(x + 16, y); g.stroke();
    }
  });
}

function carpetTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    const r2 = rng(5);
    g.fillStyle = "#e9e1d3"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = r2() > 0.5 ? "rgba(255,255,255,0.18)" : "rgba(120,100,80,0.08)";
      g.fillRect(r2() * w, r2() * h, 2, 2);
    }
  });
}

// ---------- more floors (patterns drawn on a canvas) ----------
// ---------- wallpapers ----------
// Drawn in light and dark greys on white: the wall colour you pick tints them, so every wallpaper works with every colour.
export const WALLPAPERS = {
  none: "Plain paint", stripes: "Stripes", pinstripe: "Pinstripes", dots: "Polka dots", damask: "Damask",
  floral: "Little flowers", brick: "Brick", panels: "Wood panels", checks: "Checks", stars: "Stars", hearts: "Hearts", waves: "Waves",
};
function wallpaperTexture(kind) {
  return canvasTexture(512, 512, (g, w, h) => {
    const r = rng(21);
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    const ink = (a) => `rgba(60,50,60,${a})`, hi = (a) => `rgba(255,255,255,${a})`;
    const shape = (x, y, s, draw) => { g.save(); g.translate(x, y); g.scale(s, s); g.beginPath(); draw(); g.fill(); g.restore(); };
    if (kind === "stripes") {
      for (let x = 0; x < w; x += 64) { g.fillStyle = ink(0.13); g.fillRect(x, 0, 32, h); }
    } else if (kind === "pinstripe") {
      for (let x = 0; x < w; x += 32) { g.fillStyle = ink(0.22); g.fillRect(x, 0, 3, h); }
    } else if (kind === "dots") {
      g.fillStyle = ink(0.2);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) shape(x * 64 + (y % 2) * 32 + 16, y * 64 + 32, 1, () => g.arc(0, 0, 9, 0, Math.PI * 2));
    } else if (kind === "damask") {
      g.fillStyle = ink(0.16);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) shape(x * 128 + (y % 2) * 64 + 32, y * 128 + 64, 1, () => {
        g.moveTo(0, -46); g.bezierCurveTo(30, -30, 26, 0, 0, 46); g.bezierCurveTo(-26, 0, -30, -30, 0, -46);
        for (const s of [-1, 1]) { g.moveTo(0, 6); g.bezierCurveTo(s * 34, -6, s * 42, 22, s * 20, 30); g.bezierCurveTo(s * 30, 14, s * 16, 8, 0, 6); }
      });
    } else if (kind === "floral") {
      for (let i = 0; i < 70; i++) {
        const x = r() * w, y = r() * h, s = 0.6 + r() * 0.5;
        g.fillStyle = ink(0.15);
        for (let k = 0; k < 5; k++) shape(x, y, s, () => { g.rotate((k * Math.PI * 2) / 5); g.ellipse(0, -9, 5, 9, 0, 0, Math.PI * 2); });
        g.fillStyle = ink(0.3); shape(x, y, s, () => g.arc(0, 0, 4, 0, Math.PI * 2));
      }
    } else if (kind === "brick") {
      g.fillStyle = ink(0.28); g.fillRect(0, 0, w, h);
      const bh = 32, bw = 96;
      for (let y = 0; y < h; y += bh) for (let x = -(y / bh % 2) * bw / 2; x < w; x += bw) {
        g.fillStyle = `rgba(255,255,255,${0.8 + r() * 0.2})`; g.fillRect(x + 3, y + 3, bw - 6, bh - 6);
      }
    } else if (kind === "panels") {
      for (let x = 0; x < w; x += 64) {
        g.fillStyle = `rgba(80,55,40,${0.08 + r() * 0.08})`; g.fillRect(x, 0, 64, h);
        g.fillStyle = ink(0.3); g.fillRect(x, 0, 3, h); g.fillStyle = hi(0.6); g.fillRect(x + 3, 0, 2, h);
        for (let i = 0; i < 5; i++) { g.fillStyle = ink(0.05); g.fillRect(x + 8 + r() * 50, r() * h, 1.5, 40 + r() * 120); }
      }
    } else if (kind === "checks") {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) { g.fillStyle = ink(0.12); g.fillRect(x * 64, y * 64, 64, 64); }
    } else if (kind === "stars") {
      g.fillStyle = ink(0.2);
      for (let i = 0; i < 40; i++) shape(r() * w, r() * h, 0.5 + r() * 0.7, () => {
        for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5 - Math.PI / 2, rr = k % 2 ? 6 : 15; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        g.closePath();
      });
    } else if (kind === "hearts") {
      g.fillStyle = ink(0.18);
      for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) shape(x * 86 + (y % 2) * 43 + 20, y * 86 + 40, 0.9, () => {
        g.moveTo(0, 10); g.bezierCurveTo(-24, -6, -10, -26, 0, -12); g.bezierCurveTo(10, -26, 24, -6, 0, 10);
      });
    } else if (kind === "waves") {
      g.strokeStyle = ink(0.18); g.lineWidth = 6;
      for (let y = 16; y < h + 32; y += 40) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin((x / w) * Math.PI * 8) * 9); g.stroke(); }
    }
  });
}

function patternTexture(kind, o = {}) {
  return canvasTexture(1024, 1024, (g, w, h) => {
    const r = rng(9);
    const speck = (n, a = 0.06) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${r() > 0.5 ? "255,255,255" : "0,0,0"},${a * r()})`; g.fillRect(r() * w, r() * h, 2, 2); } };
    if (kind === "stripes") {                           // wide soft bands (like the den rug)
      const cols = o.colors, n = cols.length * 3;
      for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(0, (i * h) / n, w, h / n + 1); }
      speck(6000, 0.05);
    } else if (kind === "checker") {
      const n = 8, s = w / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? o.a : o.b; g.fillRect(x * s, y * s, s, s); }
      g.strokeStyle = "rgba(0,0,0,0.15)"; g.lineWidth = 2;
      for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, h); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
      speck(5000, 0.04);
    } else if (kind === "tiles") {                      // square tiles with grout, each a slightly different shade
      const n = o.n || 6, s = w / n, gap = 6;
      g.fillStyle = o.grout; g.fillRect(0, 0, w, h);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const c = new THREE.Color(o.color).offsetHSL(0, 0, (r() - 0.5) * 0.06);
        g.fillStyle = `#${c.getHexString()}`; g.fillRect(x * s + gap / 2, y * s + gap / 2, s - gap, s - gap);
      }
      speck(7000, 0.05);
    } else if (kind === "herringbone") {
      const bw = 48, bl = 192;
      g.fillStyle = o.grout || "#6e4a2c"; g.fillRect(0, 0, w, h);
      for (let y = -bl; y < h + bl; y += bw * 2) for (let x = -bl; x < w + bl; x += bl) {
        for (const [dx, rot] of [[0, Math.PI / 4], [bl / 2, -Math.PI / 4]]) {
          g.save(); g.translate(x + dx, y); g.rotate(rot);
          const c = new THREE.Color().setHSL(o.hue / 360, o.sat / 100, (o.light + r() * 10) / 100);
          g.fillStyle = `#${c.getHexString()}`; g.fillRect(0, 0, bl - 3, bw - 3); g.restore();
        }
      }
      speck(5000, 0.05);
    } else if (kind === "concrete") {
      g.fillStyle = o.color; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40000; i++) { const v = r(); g.fillStyle = `rgba(${v > 0.5 ? "255,255,255" : "0,0,0"},${0.05 * r()})`; g.fillRect(r() * w, r() * h, 3, 3); }
      g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 3;
      for (const p of [0, w / 2]) { g.beginPath(); g.moveTo(p, 0); g.lineTo(p, h); g.moveTo(0, p); g.lineTo(w, p); g.stroke(); }
    } else if (kind === "carpet") {
      g.fillStyle = o.color; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 12000; i++) { g.fillStyle = r() > 0.5 ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.06)"; g.fillRect(r() * w, r() * h, 2, 2); }
    }
  });
}
Object.assign(FLOORS, {
  "white oak": { hue: 36, sat: 28, light: 66 },
  "honey wood": { hue: 30, sat: 62, light: 46 },
  "walnut": { hue: 20, sat: 42, light: 16 },
  "herringbone": { pattern: "herringbone", hue: 30, sat: 50, light: 48, repeat: 4 },
  "olive stripes": { pattern: "stripes", colors: ["#6f8f3a", "#86a548", "#7a9a40"], carpet: true, repeat: 2 },
  "sage carpet": { pattern: "carpet", color: "#9db08a", carpet: true },
  "pink carpet": { pattern: "carpet", color: "#e9b7c3", carpet: true },
  "blue carpet": { pattern: "carpet", color: "#7e9cc6", carpet: true },
  "checker tiles": { pattern: "checker", a: "#2f2b2e", b: "#efe8dc", repeat: 3 },
  "terracotta tiles": { pattern: "tiles", color: "#c46a43", grout: "#e6d6c3", n: 5, repeat: 4 },
  "mint tiles": { pattern: "tiles", color: "#a9d8c4", grout: "#f4f1ea", n: 8, repeat: 4 },
  "concrete": { pattern: "concrete", color: "#8d8b88", repeat: 2 },
});

Object.assign(CATALOG, {
  loftBed: { label: "Loft bed + ladder", mount: "floor", build() {
    const g = new THREE.Group();
    const wood = std(WOOD, { roughness: 0.75 });
    for (const [x, z] of [[-1.2, -0.65], [1.2, -0.65], [-1.2, 0.65], [1.2, 0.65]]) g.add(box(0.1, 2.3, 0.1, wood, x, 1.15, z));
    g.add(box(2.5, 0.12, 1.4, wood, 0, 1.65, 0));                                   // platform
    g.add(box(2.4, 0.2, 1.3, std(LINEN, { roughness: 1 }), 0, 1.81, 0, 0.06));     // mattress
    [[-0.8, OAT], [-0.35, CREAM], [0.1, 0xcab79a]].forEach(([x, c], i) => {
      const p = box(0.5, 0.3, 0.16, std(c, { roughness: 1 }), x, 2.02, -0.5 + i * 0.02, 0.08); p.rotation.x = -0.2; g.add(p);
    });
    g.add(box(2.5, 0.08, 0.06, wood, 0, 2.1, 0.68));                                // guard rail
    for (let x = -1.1; x <= 1.1; x += 0.25) g.add(box(0.04, 0.38, 0.04, wood, x, 1.9, 0.68));
    const ladder = new THREE.Group();
    for (const x of [-0.25, 0.25]) ladder.add(box(0.07, 2.4, 0.07, wood, x, 1.2, 0));
    for (let y = 0.3; y < 2.3; y += 0.35) ladder.add(box(0.5, 0.05, 0.12, wood, 0, y, 0));
    ladder.position.set(0.85, 0, 1.05); ladder.rotation.x = -0.28;
    g.add(ladder);
    return { group: g };
  } },

  dayBed: { label: "Daybed with pillows", mount: "floor", build() {
    const g = new THREE.Group();
    const wood = std(WOOD, { roughness: 0.75 });
    g.add(box(2.1, 0.35, 1.0, wood, 0, 0.18, 0, 0.03));
    g.add(box(2.0, 0.22, 0.95, std(LINEN, { roughness: 1 }), 0, 0.46, 0, 0.08));
    [[-0.7, OAT], [-0.2, CREAM], [0.3, 0xcbb89c], [0.75, CREAM]].forEach(([x, c], i) => {
      const p = box(0.55, 0.42, 0.18, std(c, { roughness: 1 }), x, 0.78, -0.33 + (i % 2) * 0.05, 0.1);
      p.rotation.x = -0.25; g.add(p);
    });
    const throwMat = new THREE.MeshStandardMaterial({ map: knitTexture(), roughness: 1 });
    const blanket = box(0.9, 0.05, 1.05, throwMat, 0.45, 0.59, 0.05, 0.02);
    blanket.rotation.z = -0.05; g.add(blanket);
    const drape = box(0.9, 0.4, 0.04, throwMat, 0.45, 0.4, 0.55, 0.02); g.add(drape);
    return { group: g };
  } },

  woodDesk: { label: "Wooden desk", mount: "floor", build() {
    const g = new THREE.Group();
    const wood = std(WOOD, { roughness: 0.7 });
    g.add(box(1.4, 0.06, 0.65, wood, 0, 0.76, 0));
    g.add(box(0.06, 0.73, 0.6, wood, -0.66, 0.37, 0));
    g.add(box(0.45, 0.73, 0.6, wood, 0.47, 0.37, 0));
    const book = box(0.32, 0.03, 0.24, std(0xf6f1e6), -0.25, 0.8, 0.05); book.rotation.y = 0.2; g.add(book);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 16), std(0xe9e1d3)); mug.position.set(0.15, 0.84, -0.1); g.add(mug);
    const p = plantMesh(0.55); p.position.set(0.55, 0.79, -0.15); g.add(p);
    return { group: g };
  } },

  woodChair: { label: "Wooden chair", mount: "floor", build() {
    const g = new THREE.Group();
    const wood = std(WOOD_DARK, { roughness: 0.7 });
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 24), wood); seat.position.y = 0.48; seat.castShadow = true; g.add(seat);
    for (const [x, z] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
      const leg = box(0.035, 0.48, 0.035, wood, x, 0.24, z); leg.rotation.set(z * 0.5, 0, -x * 0.5); g.add(leg);
    }
    g.add(box(0.36, 0.06, 0.03, wood, 0, 0.85, -0.18));
    for (const x of [-0.15, 0.15]) g.add(box(0.03, 0.37, 0.03, wood, x, 0.67, -0.18));
    return { group: g };
  } },

  floatingShelves: { label: "Floating shelves", mount: "wall", defaultY: 1.25, build() {
    const g = new THREE.Group();
    const wood = std(WOOD, { roughness: 0.75 });
    for (let i = 0; i < 3; i++) {
      const y = i * 0.45;
      g.add(box(1.3, 0.04, 0.26, wood, 0, y, 0.14));
      const b = booksMesh(0.5 + r() * 0.3); b.position.set(-0.25 + (i % 2) * 0.3, y + 0.02, 0.15); g.add(b);
      if (i !== 1) { const p = plantMesh(0.5); p.position.set(0.45 - (i % 2) * 0.9, y + 0.02, 0.15); g.add(p); }
      else { const f = box(0.18, 0.24, 0.02, std(0x8a6a4a), 0.45, y + 0.14, 0.12); g.add(f); }
    }
    const trail = vineStrand(1.1, 0.9); trail.position.set(0.5, 0.95, 0.2); g.add(trail);
    return { group: g };
  } },

  hangingPlant: { label: "Hanging plant", mount: "floor", defaultY: 1.9, build() {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(0xe8dfd2));
    pot.rotation.x = Math.PI; pot.position.y = 0.12; g.add(pot);
    const rope = std(0xcdb48c);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const strand = box(0.01, 1.0, 0.01, rope, Math.cos(a) * 0.08, 0.62, Math.sin(a) * 0.08);
      strand.rotation.set(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15); g.add(strand);
    }
    const top = leafCluster(18, 0.35, 1.2); top.position.y = 0.2; g.add(top);
    for (let i = 0; i < 4; i++) { const v = vineStrand(0.6 + r() * 0.6); v.position.set((r() - 0.5) * 0.3, 0.15, (r() - 0.5) * 0.3); g.add(v); }
    return { group: g };
  } },

  vines: { label: "Trailing vines", mount: "wall", defaultY: 2.9, build() {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) { const v = vineStrand(0.5 + r() * 1.0, 1.1); v.position.set(-0.8 + i * 0.32, 0, 0.06); g.add(v); }
    const top = leafCluster(30, 1.8, 1.1); top.scale.set(1, 0.3, 0.2); top.position.z = 0.06; g.add(top);
    return { group: g };
  } },

  fairyLights: { label: "Fairy lights", mount: "wall", defaultY: 2.6, build(ctx) {
    const g = new THREE.Group();
    const bulbMat = glow(0xffd28a, 4);
    const wire = [];
    const bulbs = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, x = -1.4 + t * 2.8, y = -Math.sin(t * Math.PI) * 0.35;
      wire.push(new THREE.Vector3(x, y, 0.05));
      if (i % 2 === 0) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), bulbMat);
        b.position.set(x, y - 0.03, 0.06); g.add(b); bulbs.push(b);
      }
    }
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wire), new THREE.LineBasicMaterial({ color: 0x6a5a40 })));
    const l = new THREE.PointLight(0xffc27a, 3, 3.5, 2); l.position.set(0, -0.3, 0.4); g.add(l);
    ctx.update = (t) => { bulbMat.emissiveIntensity = 3.5 + Math.sin(t * 2) * 0.6; };
    return { group: g, interact: toggleLight("Fairy lights: switch on/off", l, bulbMat, 4) };
  } },

  leafPlant: { label: "Big leafy plant", mount: "floor", build() {
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.4, 24), std(0xf1ece4));
    pot.position.y = 0.2; pot.castShadow = true; g.add(pot);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6b33, roughness: 0.7, side: THREE.DoubleSide });
    for (let i = 0; i < 12; i++) {
      const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.17, 12), leafMat);
      leaf.scale.set(0.75, 1.25, 1);
      const a = r() * Math.PI * 2, hgt = 0.5 + r() * 0.9;
      leaf.position.set(Math.cos(a) * 0.22, hgt, Math.sin(a) * 0.22);
      leaf.rotation.set(-0.6 + r() * 0.4, a, r() * 0.5); leaf.castShadow = true;
      g.add(leaf);
    }
    g.add(box(0.03, 0.9, 0.03, std(0x5a4a30), 0, 0.85, 0));
    return { group: g };
  } },

  basket: { label: "Woven basket", mount: "floor", build() {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.3, 24, 1, true), std(0xb8925f, { roughness: 1, side: THREE.DoubleSide }));
    b.position.y = 0.15; b.castShadow = true; g.add(b);
    const blanket = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10), new THREE.MeshStandardMaterial({ map: knitTexture(), roughness: 1 }));
    blanket.scale.y = 0.5; blanket.position.y = 0.3; g.add(blanket);
    return { group: g };
  } },

  beam: { label: "Ceiling beam", mount: "floor", defaultY: 2.95, build() {
    const g = new THREE.Group();
    g.add(box(0.28, 0.3, 8.5, std(0x8a5a32, { roughness: 0.8 }), 0, 0.1, 0));
    return { group: g };
  } },

  fluffyRug: { label: "Cream rug", mount: "floor", flat: true, build() {
    const g = new THREE.Group();
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.y = 0.006; rug.receiveShadow = true;
    g.add(rug);
    return { group: g, walkable: true };
  } },
});

// ---------- ready-made room styles ----------
export const THEMES = {
  neon: { label: "Neon night (purple, city view)", layout: DEFAULT_LAYOUT },
  loft: { label: "Cozy wooden loft (warm, bright)", layout: {
    shell: { wall: "#e9e1d4", floor: "cream carpet", sky: "auto" },
    items: [
      { type: "fluffyRug", x: 0.6, z: 0.9, rot: 0 },
      { type: "loftBed", x: -3.4, z: -3.05, rot: 0 },
      { type: "dayBed", x: -3.4, z: -3.0, rot: 0 },
      { type: "woodDesk", x: -4.55, z: 1.3, rot: Math.PI / 2 },
      { type: "woodChair", x: -3.9, z: 1.3, rot: -Math.PI / 2 },
      { type: "candle", x: -4.65, z: 0.8, rot: 0, y: 0.79 },
      { type: "floatingShelves", wall: "left", u: 1.3, y: 1.25 },
      { type: "floatingShelves", wall: "back", u: -0.6, y: 1.0 },
      { type: "hangingPlant", x: -1.6, z: -2.0, rot: 0, y: 1.9 },
      { type: "hangingPlant", x: 3.9, z: -2.8, rot: 0, y: 2.0 },
      { type: "vines", wall: "back", u: -3.0, y: 2.95 },
      { type: "fairyLights", wall: "back", u: 2.0, y: 3.1 },
      { type: "fairyLights", wall: "left", u: -1.5, y: 2.7 },
      { type: "leafPlant", x: -4.5, z: 2.7, rot: 0 },
      { type: "leafPlant", x: 4.4, z: 2.9, rot: 0 },
      { type: "bigPlant", x: 0.4, z: -3.6, rot: 0 },
      { type: "basket", x: -2.2, z: -1.7, rot: 0 },
      { type: "floorLamp", x: 4.4, z: -0.6, rot: 0 },
      { type: "sofa", x: 4.45, z: 1.4, rot: -Math.PI / 2 },
      { type: "coffeeTable", x: 2.4, z: 1.4, rot: 0 },
      { type: "cat", x: 4.35, z: 1.0, rot: -Math.PI / 2, y: 0.47 },
      { type: "beam", x: -2.0, z: 0.25, rot: 0, y: 2.95 },
      { type: "beam", x: 2.4, z: 0.25, rot: 0, y: 2.95 },
      { type: "poster", wall: "right", u: -1.6, y: 1.9, variant: 2 },
    ],
  } },
  den: { label: "Warm den (cosy diorama)", layout: DEN_LAYOUT },
  empty: { label: "Empty room", layout: { shell: { wall: "#e9e1d4", floor: "light wood", sky: "auto" }, items: [] } },
};

// the big window that shows the time of day (it used to be part of the walls; now you can move it or delete it)
CATALOG.bigWindow = { label: "Big window (time of day)", mount: "wall", defaultY: 1.75, withShell: true, build(ctx) {
  const room = ctx._room, g = new THREE.Group();
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.4), room.skyMat);
  sky.position.z = -0.02; sky.userData.keepLook = true;          // the shared sky picture: never recoloured or thrown away
  g.add(sky);
  const frame = std(0x15101a);
  for (const x of [-1.8, -0.6, 0.6, 1.8]) g.add(box(0.06, 2.5, 0.08, frame, x, 0, 0.01));
  for (const y of [-1.2, 1.2, 0]) g.add(box(3.7, 0.06, 0.08, frame, 0, y, 0.01));
  g.add(box(3.8, 0.06, 0.25, std(0x3a2a40), 0, -1.23, 0.1));
  for (const x of [-2.05, 2.05]) g.add(box(0.45, 2.9, 0.12, std(0x3b2050, { roughness: 1 }), x, -0.15, 0.12, 0.04));
  const glow = new THREE.PointLight(0xa88cff, 6, 6, 2);           // the sky's light coming in (follows the time of day)
  glow.position.set(0, 0.05, 0.77); g.add(glow);
  ctx.glow = glow; room._lightWindow(glow);
  return { group: g, interact: { label: "Window: next time of day", onClick: () => {
    const order = ["dawn", "morning", "day", "golden", "sunset", "dusk", "night"];
    const next = order[(order.indexOf(room.sky) + 1) % order.length];
    room.setSky(next); room.onChange?.();
    return TIME_PRESETS[next].label.toLowerCase();
  } } };
} };

Object.assign(CATALOG, DEN_CATALOG, GYM_CATALOG, DND_FURNITURE_CATALOG, PET_CATALOG);

// ======================================================================
// The room
// ======================================================================
export class CozyRoom {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();          // id -> { spec, group, ctx }
    this.nextId = 1;
    this.screenName = "Vermeil";
    this.brightness = 1;
    const before = new Set(scene.children);
    this._buildShell();
    this.shell = scene.children.filter((o) => !before.has(o));      // walls, window, lights (hidden in the gym room)
    this.hidden = false;
    this.cut = false;                                               // Edit room: near walls and ceilings cut away
    this.house = new House(scene, { wall: this.wallMat, ceiling: this.ceilMat });   // extra rooms on the left and right
  }

  /** Where she may walk: the whole house (only the main room while the gym room is showing). */
  get walkBounds() { return this.shellHidden ? { minX: -4.3, maxX: 4.3, minZ: -3.5, maxZ: 3.8 } : this.house.walkBounds(); }
  walkable(x, z) { return this.house.walkable(x, z, !!this.shellHidden); }

  /** Change the house (the extra rooms). Furniture in places that are gone moves inside. */
  setHouse(cfg) {
    const H = this.house.set(cfg);
    for (const item of this.items.values()) {
      if (item.def.mount !== "wall") { const p = this.house.clampPoint(item.spec.x, item.spec.z); item.spec.x = p.x; item.spec.z = p.z; }
      else if (item.spec.wall === "back") { const b = this.house.bounds(); item.spec.u = THREE.MathUtils.clamp(item.spec.u, b.minX + 0.4, b.maxX - 0.4); }
      this.place(item);
    }
    this._syncShell();
    return H;
  }

  /** Edit room view: hide the near (right) walls, the ceilings and things hanging from them. */
  setCut(on) { this.cut = !!on; this._syncShell(); }

  _syncShell() {
    const off = this.hidden || this.shellHidden;
    for (const o of this.shell) o.visible = !off;
    if (this.leftWall) this.leftWall.visible = !off && !this.house.hasRoom("left");
    if (this.rightWall) this.rightWall.visible = !off && !this.house.hasRoom("right") && !this.cut;
    if (this.ceiling) this.ceiling.visible = !off && !this.cut;
    this.house.group.visible = !off;
    this.house.setCut(this.cut);
    for (const item of this.items.values()) item.group.visible = this._shows(item);
  }

  /** Is this piece seen right now? Not on cut-away walls; the big window goes away with the walls (gym room). */
  _shows(item) {
    const high = item.def.mount !== "wall" && (item.spec.y || 0) > 2.2;
    return !this.hidden && !(item.def.withShell && this.shellHidden) && !(this.cut && (item.spec.wall === "right" || high));
  }

  /** Hide the whole cozy room (used while the gym room is showing). */
  /** Hide only the walls/window/lights (the gym room brings its own) - furniture stays usable. */
  setShellHidden(on) { this.shellHidden = !!on; this._syncShell(); }

  setHidden(on) { this.hidden = !!on; this._syncShell(); }

  // ---------- walls, floor, window, base lights ----------
  _buildShell() {
    const s = this.scene;
    const add = (o) => (s.add(o), o);
    this.floorMat = std(0xffffff, { roughness: 0.55 });
    const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(W * 2, FRONT - BACK), this.floorMat));
    floor.rotation.x = -Math.PI / 2; floor.position.z = (FRONT + BACK) / 2; floor.receiveShadow = true;
    floor.userData.floor = true;
    this.floor = floor;
    this.wallMat = std(0x2c2034);
    const back = add(new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), this.wallMat));
    back.position.set(0, H / 2, BACK); back.receiveShadow = true;
    for (const side of [-1, 1]) {
      const wall = add(new THREE.Mesh(new THREE.PlaneGeometry(FRONT - BACK, H), this.wallMat));
      wall.position.set(side * W, H / 2, (FRONT + BACK) / 2); wall.rotation.y = -side * Math.PI / 2; wall.receiveShadow = true;
      if (side > 0) this.rightWall = wall; else this.leftWall = wall;
    }
    this.ceilMat = std(0x1d1522);
    const ceil = this.ceiling = add(new THREE.Mesh(new THREE.PlaneGeometry(W * 2, FRONT - BACK), this.ceilMat));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, (FRONT + BACK) / 2);
    add(box(W * 2, 0.08, 0.04, std(0x1a1220), 0, 0.04, BACK + 0.02));

    this.hemi = new THREE.HemisphereLight(0x6a4f9a, 0x1a1020, 0.9);
    s.add(this.hemi);
    const moon = (this.moonlight = new THREE.DirectionalLight(0x9d8cff, 1.4));
    moon.position.set(2.5, 4, -7); moon.target.position.set(0, 0, 1);
    moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 20 });
    moon.shadow.bias = -0.0008;
    s.add(moon, moon.target);
    const key = new THREE.SpotLight(0xffc9a0, 18, 9, 0.6, 0.7, 1.6);
    key.position.set(0.5, 3.1, 3.6); key.target.position.set(0, 0.9, 0.4);
    s.add(key, key.target);
    this.keyLight = key;

    // the sky picture the big window shows (CATALOG.bigWindow)
    this.skyMat = new THREE.MeshBasicMaterial({ map: skyTexture(timeState(23)), toneMapped: false });
    this.sky = "night";
    this.hour = 23;
    this._skyHour = 23;
  }

  /** A window's glow takes the colour of the sky outside. */
  _lightWindow(glow) {
    const st = this._skyState || timeState(this.hour);
    glow.color.set(st.glow);
    glow.intensity = 6 + st.town * 6;
  }

  /** mode: "auto", "cycle", or a preset name like "morning" (old saves used "night"/"sunset"). */
  setSky(mode) {
    this.sky = TIME_PRESETS[mode] ? mode : "night";
    const preset = TIME_PRESETS[this.sky];
    if (preset.hour != null) this.applyHour(preset.hour, true);
    else if (this.sky === "auto") this.applyHour(this._clockHour(), true);
    else this.applyHour(this.hour, true);
  }

  _clockHour() { const d = new Date(); return d.getHours() + d.getMinutes() / 60; }

  /** Light the room for a time of day (0-24). */
  applyHour(hour, force = false) {
    this.hour = ((hour % 24) + 24) % 24;
    const st = timeState(this.hour);
    if (force || Math.abs(this.hour - this._skyHour) > 0.2) {      // redrawing the sky is slow, so not every frame
      this._skyHour = this.hour;
      this.skyMat.map.dispose(); this.skyMat.map = skyTexture(st); this.skyMat.needsUpdate = true;
    }
    this.moonlight.color.set(st.sun);
    this.moonlight.intensity = st.sunI;
    const day = this.hour >= 6 && this.hour <= 19;
    const p = day ? (this.hour - 6) / 13 : 0.5;
    this.moonlight.position.set(6 - p * 9, 3 + Math.sin(p * Math.PI) * 3, -7);
    this.hemi.color.set(st.hemiS); this.hemi.groundColor.set(st.hemiG); this.hemi.intensity = st.hemiI;
    this._skyState = st;
    for (const item of this.items.values()) if (item.ctx.glow) this._lightWindow(item.ctx.glow);
    this.exposure = st.exp;
    this.onLighting?.(st);
  }

  /** 0.3 (dim) .. 1.5 (bright); 1 = normal. */
  setBrightness(v) {
    this.brightness = THREE.MathUtils.clamp(Number(v) || 1, 0.3, 1.5);
    this.keyLight.intensity = 18 * this.brightness;
    this.applyHour(this.hour);
  }

  setWallColor(hex) {
    this.wallColor = hex;
    this.wallMat.color.set(hex);
    this.ceilMat.color.set(hex).multiplyScalar(0.8);     // ceiling a little darker than the walls
  }

  /** Wallpaper on all the walls (WALLPAPERS); "none" = plain paint. The wall colour tints it. */
  setWallpaper(kind) {
    this.wallpaper = WALLPAPERS[kind] ? kind : "none";
    this.wallMat.map?.dispose();
    this.wallMat.map = null;
    if (this.wallpaper !== "none") {
      const t = wallpaperTexture(this.wallpaper);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 2);           // ~1.6 m wide pattern tiles
      this.wallMat.map = t;
    }
    this.wallMat.needsUpdate = true;
  }

  setFloor(style) {
    this.floorStyle = FLOORS[style] ? style : "dark wood";
    const F = FLOORS[this.floorStyle];
    const t = F.pattern ? patternTexture(F.pattern, F) : F.carpet ? carpetTexture() : woodTexture(this.floorStyle);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(F.repeat || 3, F.repeat || 3);
    this.floorMat.map?.dispose(); this.floorMat.map = t; this.floorMat.needsUpdate = true;
    this.floorMat.roughness = FLOORS[this.floorStyle].carpet ? 1 : 0.55;
    this.house?.syncFloor(this.floorMat);
  }

  static floorStyles() { return Object.keys(FLOORS); }

  // ---------- items ----------
  addItem(spec) {
    const def = CATALOG[spec.type];
    if (!def) return null;
    const id = this.nextId++;
    spec = { ...spec };
    if (def.mount === "wall") {
      if (spec.u == null && spec.x != null) {           // was a floor piece in an older save (bathroom mirrors): onto the back wall
        spec.u = spec.x; spec.y = def.defaultY ?? 1.8; delete spec.x; delete spec.z; delete spec.rot;
      }
      spec.wall ??= "back"; spec.u ??= 0; spec.y ??= def.defaultY ?? 1.8;
    } else {
      spec.x ??= 0.4; spec.z ??= 0.7; spec.rot ??= 0; spec.y ??= def.defaultY ?? 0;
    }
    const ctx = { spec, name: this.screenName, _room: this, _itemId: id };
    const built = def.build(ctx);
    if (built.update && !ctx.update) ctx.update = built.update;
    const group = built.group;
    group.userData.itemId = id;
    group.traverse((o) => {
      if (o.isMesh) o.receiveShadow = true;
      o.userData.itemId = id;
      if (built.interact) o.userData.interactive = built.interact;
      if (built.walkable) o.userData.floor = true;
    });
    this.scene.add(group);
    const item = { id, spec, group, ctx, def };
    this.items.set(id, item);
    this.place(item);
    group.visible = this._shows(item);
    if (spec.color) this.recolorItem(id, spec.color);
    return item;
  }

  onGLBLoaded(id) {
    const item = this.items.get(id);
    if (!item) return;
    item.group.traverse((o) => {
      if (o.isMesh) {
        o.userData.itemId = id;
        o.receiveShadow = true;
      }
    });
    item.paint = null;
    if (item.spec.color) {
      this.recolorItem(id, item.spec.color);
    }
    this.onItemChanged?.(id);
  }

  /** Put an item where its spec says. */
  place(item) {
    const { spec, group, def } = item;
    if (def.mount === "wall") {
      const d = 0.03;
      if (spec.wall === "left") { group.position.set(-W + d, spec.y, spec.u); group.rotation.set(0, Math.PI / 2, 0); }
      else if (spec.wall === "right") { group.position.set(W - d, spec.y, spec.u); group.rotation.set(0, -Math.PI / 2, 0); }
      else { group.position.set(spec.u, spec.y, BACK + d); group.rotation.set(0, 0, 0); }
    } else {
      group.position.set(spec.x, spec.y || 0, spec.z);
      group.rotation.set(0, spec.rot || 0, 0);
    }
  }

  /** Move an item to a point the mouse is pointing at (floor point or wall point). */
  moveItem(id, point, wall) {
    const item = this.items.get(id);
    if (!item) return;
    const c = THREE.MathUtils.clamp;
    if (item.def.mount === "wall") {
      if (wall) item.spec.wall = wall;
      item.spec.y = c(point.y, 0.4, H - 0.3);
      const b = this.shellHidden ? { minX: -W, maxX: W } : this.house.bounds();       // the back wall runs along every room
      item.spec.u = item.spec.wall === "back" ? c(point.x, b.minX + 0.4, b.maxX - 0.4) : c(point.z, BACK + 0.4, FRONT - 0.4);
    } else {
      const p = this.house.clampPoint(point.x, point.z, 0.2, !!this.shellHidden);
      item.spec.x = p.x;
      item.spec.z = p.z;
    }
    this.place(item);
  }

  /** Paint a piece in one colour family: the main part becomes exactly `hex`, and every other part (sheets, pillows,
   *  cushions, frame...) gets a matching shade of it - lighter or darker like before. Leaves stay green, black/grey/metal
   *  and glowing parts stay as they are. null puts the original colours back. */
  recolorItem(id, hex) {
    const item = this.items.get(id);
    if (!item) return;
    if (!hex) {
      if (item.paint) {
        for (const [o, orig] of item.paint.parts) o.material = orig;
      }
      item.group.traverse((o) => {
        if (o.isMesh && o.userData._origMat) {
          o.material = o.userData._origMat;
        }
      });
      delete item.spec.color;
      return;
    }
    const col = new THREE.Color(hex);
    const isGLB = item.def.isGLB || item.group.userData.isGLB;
    if (isGLB) {
      // a colour theme like the built-in furniture: the main colour becomes `hex`, every other part a matching
      // lighter/darker shade of it; leaves stay green, and black / grey / white / metal parts stay as they are
      const parts = [], weight = new Map(), SRGB = THREE.SRGBColorSpace;
      item.group.traverse((o) => {
        if (!o.isMesh || !o.material || o.isMirror || o.userData.keepLook) return;   // mirror glass and the sky keep their look
        if (o.material === o.userData._origMat) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const origs = [].concat(o.userData._origMat || mats);
        const n = o.geometry?.attributes?.position?.count || 1;
        mats.forEach((m, i) => {
          if (!m.color) return;
          const oc = (origs[i] || m).color || m.color;
          parts.push([m, oc]);
          const h = oc.getHSL({}, SRGB);
          if (h.s >= 0.08 && h.l >= 0.12 && h.l <= 0.92) weight.set(oc.getHex(), (weight.get(oc.getHex()) || 0) + n);
        });
      });
      const mainHex = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const M = mainHex == null ? null : new THREE.Color(mainHex).getHSL({}, SRGB), T = col.getHSL({}, SRGB);
      const cl = (v, a, b) => Math.min(b, Math.max(a, v));
      for (const [m, oc] of parts) {
        const c = oc.getHSL({}, SRGB);
        const leaf = c.h > 0.22 && c.h < 0.45 && c.s > 0.25 && (!M || Math.abs(c.h - M.h) > 0.05);
        const neutral = c.s < 0.08 || c.l < 0.12 || c.l > 0.92 || (m.metalness || 0) > 0.6;
        if (leaf || (neutral && M)) m.color.copy(oc);
        else if (!M || oc.getHex() === mainHex) m.color.set(hex);
        else m.color.setHSL(T.h, cl(T.s * (0.35 + 0.65 * Math.min(1.3, (c.s + 0.05) / (M.s + 0.05))), 0, 1), cl(T.l + (c.l - M.l), 0.06, 0.96), SRGB);
        m.needsUpdate = true;
      }
      item.spec.color = hex;
      return;
    }
    if (!item.paint) {
      const vol = new Map(), parts = [];
      const size = new THREE.Vector3();
      item.group.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m?.color) continue;
          if (m.emissive?.getHex && m.emissive.getHex() && m.emissiveIntensity > 0.3) continue;
          parts.push([o, m]);
          const k = m.color.getHex();
          vol.set(k, (vol.get(k) || 0) + 1);
        }
      });
      const main = [...vol.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      item.paint = { parts, main: main == null ? null : new THREE.Color(main).getHSL({}), clones: new Map() };
    }
    const P = item.paint;
    if (P.main) {
      const T = col.getHSL({}), M = P.main;
      const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
      for (const [o, orig] of P.parts) {
        const c = orig.color.getHSL({});
        const leaf = c.h > 0.22 && c.h < 0.45 && c.s > 0.25 && Math.abs(c.h - M.h) > 0.05;
        const neutral = c.s < 0.08 || c.l < 0.12;
        if (leaf || neutral) { o.material = orig; continue; }
        let m = P.clones.get(orig);
        if (!m) { m = orig.clone(); P.clones.set(orig, m); }
        const isMain = orig.color.getHex() === new THREE.Color().setHSL(M.h, M.s, M.l).getHex();
        if (isMain) m.color.set(hex);
        else m.color.setHSL(T.h, clamp(T.s * (0.35 + 0.65 * Math.min(1.3, (c.s + 0.05) / (M.s + 0.05))), 0, 1), clamp(T.l + (c.l - M.l), 0.06, 0.96));
        m.needsUpdate = true;
        o.material = m;
      }
    } else {
      // GLB mesh recolor fallback: tint/clone all mesh materials
      item.group.traverse((o) => {
        if (!o.isMesh || !o.material || o.isMirror || o.userData.keepLook) return;   // mirror glass and the sky keep their look
        if (!o.userData._origMat) o.userData._origMat = o.material;
        if (Array.isArray(o.material)) {
          o.material = o.material.map((m) => {
            const clone = m.clone();
            if (clone.color) clone.color.copy(col);
            clone.needsUpdate = true;
            return clone;
          });
        } else {
          const clone = o.material.clone();
          if (clone.color) clone.color.copy(col);
          clone.needsUpdate = true;
          o.material = clone;
        }
      });
    }
    item.spec.color = hex;
  }

  rotateItem(id, angle) {
    const item = this.items.get(id);
    if (!item || item.def.mount === "wall") return;
    item.spec.rot = ((item.spec.rot || 0) + angle) % (Math.PI * 2);
    this.place(item);
  }

  raiseItem(id, dy) {
    const item = this.items.get(id);
    if (!item) return;
    item.spec.y = THREE.MathUtils.clamp((item.spec.y || 0) + dy, 0, H - 0.3);
    this.place(item);
  }

  removeItem(id) {
    const item = this.items.get(id);
    if (!item) return;
    this.scene.remove(item.group);
    item.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.userData.keepLook) return;                      // the sky picture is shared: it stays
      for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose?.(); }
    });
    this.items.delete(id);
  }

  clear() { for (const id of [...this.items.keys()]) this.removeItem(id); }

  /** Load a whole layout (walls, floor, sky and all items). */
  load(layout) {
    const L = layout && Array.isArray(layout.items) ? layout : DEFAULT_LAYOUT;
    this.clear();
    this.setWallColor(L.shell?.wall || DEFAULT_LAYOUT.shell.wall);
    this.setFloor(L.shell?.floor || DEFAULT_LAYOUT.shell.floor);
    this.setWallpaper(L.shell?.wallpaper || "none");
    this.brightness = L.shell?.brightness ?? 1;
    this.keyLight.intensity = 18 * this.brightness;
    this.setSky(L.shell?.sky || "night");
    this.house.set(L.shell?.house);
    for (const spec of L.items) this.addItem(spec);       // old back/front yard things aren't in the catalog any more: skipped
    // layouts from before the window was an item: it goes where it always was (unless it was removed, or a den window is there)
    if (!L.shell?.windowItem && L.shell?.window !== false && !L.items.some((i) => i.type === "bigWindow"
        || (i.type === "denWindow" && (i.wall || "back") === "back"))) this.addItem({ type: "bigWindow", wall: "back", u: 2, y: 1.75 });
    this._syncShell();
    this.setScreenName(this.screenName);
  }

  serialize() {
    const round = (v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v);
    return {
      shell: { wall: this.wallColor, floor: this.floorStyle, sky: this.sky, brightness: round(this.brightness), wallpaper: this.wallpaper || "none",
               windowItem: true, house: JSON.parse(JSON.stringify(this.house.cfg)) },
      items: [...this.items.values()].map(({ spec }) => Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, round(v)]))),
    };
  }

  setScreenName(name) {
    this.screenName = name;
    for (const item of this.items.values()) item.ctx.setScreenName?.(name);
  }

  update(t, dt) {
    if (this.sky === "cycle") this.applyHour(this.hour + dt * (24 / 240));          // a day every 4 minutes
    else if (this.sky === "auto" && (this._lastClock = (this._lastClock || 0) + dt) > 20) {
      this._lastClock = 0; this.applyHour(this._clockHour());
    }
    for (const item of this.items.values()) item.ctx.update?.(t, dt);
  }
}
