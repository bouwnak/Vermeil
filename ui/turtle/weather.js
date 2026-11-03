// weather.js - weather you can see. Rain falls in streaks from grey clouds that gather overhead; a storm (heavy rain is a storm) brings dark clouds
// lit from inside, and lightning that forks down to the sea and the hills with a flash and, a moment later, thunder; snow drifts down in soft flakes;
// wind sends long wisps across the ground and bends the grass of the air. Everything follows you, so it's always where you are.
import * as THREE from "three";

const RAIN = 1800, SNOW = 1400, WISPS = 46;

export function makeWeather(G) {
  const scene = G.scene, W = {};
  // rain: short streaks, slanted by the wind
  const rp = new Float32Array(RAIN * 6), rv = new Float32Array(RAIN);
  const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaec4dc, transparent: true, opacity: 0.85, depthWrite: false })); rain.frustumCulled = false; scene.add(rain);
  const drop = new Float32Array(RAIN * 3).map((_, i) => (i % 3 === 1 ? Math.random() * 40 : (Math.random() - 0.5) * 70));
  for (let i = 0; i < RAIN; i++) rv[i] = 0.8 + Math.random() * 0.4;
  // snow: soft round flakes that wander as they fall
  const flake = (() => { const c = document.createElement("canvas"); c.width = c.height = 32; const g = c.getContext("2d"), r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const sp = new Float32Array(SNOW * 3).map((_, i) => (i % 3 === 1 ? Math.random() * 24 : (Math.random() - 0.5) * 40)), sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  const snow = new THREE.Points(sg, new THREE.PointsMaterial({ map: flake, size: 0.6, transparent: true, depthWrite: false, opacity: 0.95 })); snow.frustumCulled = false; scene.add(snow);
  // the clouds the rain comes from: a low grey deck that thickens and darkens with the weather
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0x8d949c, flatShading: true, transparent: true, opacity: 0, depthWrite: false });
  const deck = new THREE.Group(); scene.add(deck);
  for (let i = 0; i < 26; i++) { const c = new THREE.Group(); for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(10 + Math.random() * 10, 1), cloudMat); b.position.set(k * 14 - 20, Math.random() * 4, Math.random() * 12); b.scale.y = 0.5; c.add(b); } const a = Math.random() * 6.3, r = 20 + Math.random() * 160; c.position.set(Math.cos(a) * r, 52 + Math.random() * 14, Math.sin(a) * r); deck.add(c); }
  // lightning: a forked bolt of light from the cloud deck to the ground, and the whole sky flashing
  const boltMat = new THREE.LineBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0 }), bolts = [];
  const flash = new THREE.PointLight(0xdfe8ff, 0, 600, 0); scene.add(flash);
  function bolt(from, to, depth = 0) {
    const pts = [from.clone()], n = 14, dir = to.clone().sub(from);
    for (let i = 1; i < n; i++) { const p = from.clone().addScaledVector(dir, i / n); p.x += (Math.random() - 0.5) * 9 * (1 - i / n * 0.5); p.z += (Math.random() - 0.5) * 9 * (1 - i / n * 0.5); pts.push(p); if (depth < 2 && Math.random() < 0.22) bolt(p, p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 30, -20 - Math.random() * 20, (Math.random() - 0.5) * 30)), depth + 1); }
    pts.push(to.clone());
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), boltMat); l.frustumCulled = false; scene.add(l); bolts.push(l);
  }
  let nextStrike = 4, strike = 0;
  // wind: long pale wisps blowing across, close to the ground
  const wisps = [...Array(WISPS)].map(() => { const g = new THREE.BufferGeometry().setFromPoints([...Array(8)].map(() => new THREE.Vector3())); const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 })); l.frustumCulled = false; scene.add(l); return { l, t: Math.random() * 3, x: 0, y: 0, z: 0, len: 4 + Math.random() * 5 }; });
  let wet = 0, white = 0, gloom = 0, blow = 0;

  W.tick = (dt, t) => {
    const s = G.s, w = s.weather, P = G.player?.pos || new THREE.Vector3(), cam = G.camera.position;
    const wantRain = w === "rain" ? 0.55 : w === "heavy" || w === "storm" ? 1 : 0, wantSnow = w === "snow" ? 1 : 0, wantGloom = w === "storm" || w === "heavy" ? 1 : w === "rain" ? 0.6 : w === "snow" ? 0.45 : w === "cloudy" ? 0.35 : 0, wantBlow = w === "wind" ? 1 : w === "storm" || w === "heavy" ? 0.6 : 0;
    const k = Math.min(1, dt * 0.6);
    wet += (wantRain - wet) * k; white += (wantSnow - white) * k; gloom += (wantGloom - gloom) * k; blow += (wantBlow - blow) * k;
    const windX = 4 + blow * 10;
    // rain round the camera: as many streaks as the rain is heavy
    rain.visible = wet > 0.02;
    if (rain.visible) {
      const n = Math.floor(RAIN * Math.min(1, wet * 1.3)), fall = 26 + wet * 14;
      for (let i = 0; i < RAIN; i++) {
        const o = i * 3;
        drop[o + 1] -= fall * rv[i] * dt; drop[o] += windX * 0.2 * dt;
        if (drop[o + 1] < -2) { drop[o + 1] = 34 + Math.random() * 6; drop[o] = (Math.random() - 0.5) * 70; drop[o + 2] = (Math.random() - 0.5) * 70; }
        const x = cam.x + drop[o], y = P.y + drop[o + 1], z = cam.z + drop[o + 2], q = i * 6, on = i < n;
        rp[q] = x; rp[q + 1] = on ? y : -999; rp[q + 2] = z; rp[q + 3] = x - windX * 0.03; rp[q + 4] = on ? y + 1.1 + wet * 0.5 : -999; rp[q + 5] = z;
      }
      rg.attributes.position.needsUpdate = true;
    }
    snow.visible = white > 0.02;
    if (snow.visible) {
      for (let i = 0; i < SNOW; i++) { const o = i * 3; sp[o + 1] -= (1.1 + (i % 5) * 0.15) * dt; sp[o] += Math.sin(t * 0.8 + i) * 0.6 * dt + blow * 2 * dt; sp[o + 2] += Math.cos(t * 0.6 + i * 1.3) * 0.5 * dt; if (sp[o + 1] < -1) { sp[o + 1] = 22; sp[o] = (Math.random() - 0.5) * 40; sp[o + 2] = (Math.random() - 0.5) * 40; } }
      snow.position.set(cam.x, P.y, cam.z); snow.material.opacity = white; sg.attributes.position.needsUpdate = true;
    }
    // the cloud deck: overhead, drifting with the wind, darker in a storm
    cloudMat.opacity = Math.min(0.92, gloom * 0.95); deck.visible = gloom > 0.02;
    cloudMat.color.setRGB(0.55, 0.58, 0.62).lerp(new THREE.Color(0.22, 0.23, 0.27), w === "storm" || w === "heavy" ? gloom : 0);
    deck.position.set(P.x + ((t * windX) % 120) - 60, 0, P.z);
    // a storm: now and then a strike somewhere out there, a flash, and the thunder a moment after
    const storm = (w === "storm" || w === "heavy") && gloom > 0.6;
    if (storm && (nextStrike -= dt) <= 0) {
      nextStrike = 3 + Math.random() * 8; strike = 0.35;
      const a = Math.random() * 6.3, r = 40 + Math.random() * 140, gx = P.x + Math.cos(a) * r, gz = P.z + Math.sin(a) * r;
      bolt(new THREE.Vector3(gx + (Math.random() - 0.5) * 20, 60, gz + (Math.random() - 0.5) * 20), new THREE.Vector3(gx, 0, gz));
      flash.position.set(gx, 50, gz);
      setTimeout(() => G.sfx("thunder"), 400 + r * 6);
    }
    if (strike > 0) {
      strike -= dt;
      const f = strike > 0.25 || (strike > 0.1 && strike < 0.17) ? 1 : 0.15;     // a flicker: on, off, on again
      boltMat.opacity = strike > 0 ? f : 0; flash.intensity = strike > 0 ? f * 6 : 0;
      if (strike <= 0) { for (const b of bolts) { scene.remove(b); b.geometry.dispose(); } bolts.length = 0; }
    }
    // wind: wisps streaming past, rising and curling a little as they go
    for (const p of wisps) {
      p.t += dt * (0.6 + blow);
      if (p.t > 2.6) { p.t = 0; const a = Math.random() * 6.3, r = 4 + Math.random() * 26; p.x = P.x + Math.cos(a) * r - 12; p.z = P.z + Math.sin(a) * r; p.y = P.y + 0.6 + Math.random() * 5; }
      const pos = p.l.geometry.attributes.position, fade = Math.sin(Math.min(1, p.t / 2.6) * Math.PI);
      for (let i = 0; i < 8; i++) { const u = i / 7, x = p.x + p.t * windX * 1.6 + u * p.len; pos.setXYZ(i, x, p.y + Math.sin(u * 3 + p.t * 3) * 0.25, p.z + Math.cos(u * 2 + p.t) * 0.3); }
      pos.needsUpdate = true; p.l.material.opacity = blow * fade * 0.55; p.l.visible = blow > 0.05;
    }
  };
  return W;
}
