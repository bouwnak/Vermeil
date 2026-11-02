// vfx.js - every little burst in the game: dust, soil, water, leaves, sparkles, hearts. One pool of points, so a hundred bursts cost one draw.
import * as THREE from "three";

const N = 1400;
// colour(s), how many, how fast outward, how fast up, gravity, size, life
const KINDS = {
  soil: [[0x7a5230, 0x9a6d3d], 12, 1.6, 2.6, 9, 0.2, 0.55], dust: [[0xe6d9b8, 0xcfbf98], 10, 1.4, 1.2, 1, 0.34, 0.8], water: [[0x8fdcff, 0xd8f5ff], 14, 1.2, 2.6, 12, 0.14, 0.6], splash: [[0xffffff, 0x9be8e0], 26, 2.6, 5.2, 14, 0.22, 0.8],
  leaf: [[0x8fd16b, 0xc3d36a], 14, 2, 2.6, 5, 0.22, 1.1], wood: [[0xb88a54, 0x8a6236], 12, 2.6, 3.4, 12, 0.2, 0.7], stone: [[0xb7b3a3, 0x8a8a84], 14, 3, 3.6, 13, 0.24, 0.7], spark: [[0xfff2a8, 0xffd25e], 20, 2, 2.6, 2, 0.2, 0.9],
  gold: [[0xffe27a, 0xffffff], 34, 2.6, 4, 3, 0.26, 1.2], heart: [[0xff8fa8, 0xffb8c8], 8, 0.8, 2.2, -0.4, 0.4, 1.1], smoke: [[0xd8d4cc, 0xb0aca4], 12, 0.7, 1.5, -0.6, 0.8, 1.6], zzz: [[0xdfe7ff, 0xffffff], 2, 0.2, 0.9, -0.3, 0.3, 1.6],
  wake: [[0xffffff, 0xcff5ee], 4, 0.7, 0.8, 4, 0.34, 0.8], chain: [[0xc5763a, 0x8d8d90], 6, 1.2, 2, 9, 0.14, 0.5], glow: [[0x7fe0d0, 0xe9e2ff], 60, 3.4, 6, 1, 0.34, 1.6],
};

export function makeVfx(G) {
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), vel = new Float32Array(N * 3), life = new Float32Array(N), full = new Float32Array(N), grav = new Float32Array(N);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
    vertexShader: "attribute float size; attribute vec3 color; varying vec3 c; void main(){ c = color; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * 720.0 / max(1.0, -p.z); gl_Position = projectionMatrix * p; }",
    fragmentShader: "varying vec3 c; void main(){ vec2 u = gl_PointCoord - 0.5; float d = dot(u, u); if (d > 0.25) discard; gl_FragColor = vec4(c, 1.0 - d * 2.0); }" });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  G.scene.add(pts);
  let at = 0, live = 0;
  const c = new THREE.Color(), V = {
    burst(kind, x, y, z, scale = 1) {
      const K = KINDS[kind];
      if (!K) return;
      const [cols, n, out, up, gr, sz, lf] = K;
      for (let i = 0; i < n * scale; i++) {
        const k = at; at = (at + 1) % N;
        const a = Math.random() * 6.3, o = out * (0.3 + Math.random());
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
        vel[k * 3] = Math.cos(a) * o; vel[k * 3 + 1] = up * (0.4 + Math.random()); vel[k * 3 + 2] = Math.sin(a) * o;
        c.set(cols[i % cols.length]); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
        life[k] = full[k] = lf * (0.7 + Math.random() * 0.6); size[k] = sz; grav[k] = gr;
      }
      live = 1;
      g.attributes.color.needsUpdate = true;
    },
    /** an icon rising from a spot in the world: what you just got */
    item(text, x, y, z) {
      const p = new THREE.Vector3(x, y, z).project(G.camera);
      if (p.z > 1) return;
      const e = document.createElement("div");
      e.className = "float"; e.textContent = text;
      e.style.left = `${(p.x + 1) / 2 * innerWidth}px`; e.style.top = `${(1 - p.y) / 2 * innerHeight}px`;
      document.body.append(e);
      setTimeout(() => e.remove(), 1300);
    },
    tick(dt) {
      if (!live) return;
      let any = 0;
      for (let k = 0; k < N; k++) {
        if (life[k] <= 0) continue;
        any = 1;
        life[k] -= dt;
        if (life[k] <= 0) { size[k] = 0; continue; }
        vel[k * 3 + 1] -= grav[k] * dt;
        pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      }
      live = any;
      g.attributes.position.needsUpdate = true; g.attributes.size.needsUpdate = true;
    },
  };
  return V;
}
