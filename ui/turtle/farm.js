// farm.js - soil and crops. Plots are one small record each in a map, drawn as instances, so a huge farm costs little: nothing runs per plot each
// frame, and crops only grow when the day turns. A crop goes seed, sprout, young, mature, then ripe with a bubble over it.
import * as THREE from "three";
import { CATALOG, CROPS, ISLANDS, TOOL_UP, WEED, YOUNG } from "./data.js";
import { forest, loadModel } from "./assets.js";

const CELL = 2, MAX = 2400, FLAT = 0.2;                     // FLAT: how much the ground may rise across a plot
export const keyOf = (x, z) => `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
export const spotOf = (k) => k.split(",").map((n) => Number(n) * CELL);
const STAGE_HEIGHT = [0, 0.32, 0.6, 0.9];
/** 0 seed, 1 sprout, 2 young, 3 mature, 4 ripe */
export const stageOf = (p) => { const c = CROPS[p.crop]; return p.age >= c.days ? 4 : Math.min(3, Math.floor(p.age / c.days * 4)); };
export const ripe = (p) => !!p.crop && p.age >= CROPS[p.crop].days;

function bubbleTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#fffaf0"; g.strokeStyle = "#e0a640"; g.lineWidth = 10;
  g.beginPath(); g.arc(64, 64, 52, 0, 7); g.fill(); g.stroke();
  g.fillStyle = "#e4573d"; g.font = "900 84px Nunito, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("!", 64, 69);
  return new THREE.CanvasTexture(c);
}

export function makeFarm(G) {
  const soil = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 0.94, 0.16, CELL * 0.94), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), MAX);
  soil.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  soil.count = 0; soil.receiveShadow = true; soil.frustumCulled = false;
  const seed = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 5, 3), new THREE.MeshStandardMaterial({ color: 0x6d4a28, flatShading: true }), MAX);
  seed.count = 0; seed.frustumCulled = false;
  const crops = new THREE.Group(), marker = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new THREE.Vector3(x * CELL / 2, 0.14, z * CELL / 2))), new THREE.LineBasicMaterial({ color: 0xfff4c8 }));
  marker.visible = false;
  const bubbleGeo = new THREE.BufferGeometry(), bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({ map: bubbleTexture(), size: 1.05, transparent: true, alphaTest: 0.4, sizeAttenuation: true, depthWrite: false }));
  bubbleGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * 3), 3)); bubbleGeo.setDrawRange(0, 0); bubbles.frustumCulled = false;
  G.scene.add(soil, seed, crops, marker, bubbles);
  const F = { soil, crops, marker, bubbles, dirty: true, drawing: false };
  const home = () => G.world.lands.home, land = () => home().land;
  const groundY = (x, z) => land().ground(x, z);
  F.target = () => { const p = G.player; return { x: Math.round((p.pos.x + p.front.x * 1.7) / CELL) * CELL, z: Math.round((p.pos.z + p.front.z * 1.7) / CELL) * CELL }; };
  F.flat = (x, z) => land().rough(x, z, CELL * 0.5) <= FLAT;
  F.inGreenhouse = (x, z) => (G.s.placed || []).some((p) => { const c = CATALOG[p.type]; return c?.greenhouse && Math.abs(x - p.x) < c.greenhouse && Math.abs(z - p.z) < c.greenhouse; });
  /** can a plot go here? Only level ground: no slopes, no roads, nothing standing on it */
  F.why = (x, z) => {
    if (G.player.ground?.on !== "home") return "You can only farm on your own turtle";
    if (groundY(x, z) < 3.4) return "Too sandy to farm here";
    if (!F.flat(x, z)) return "Crops need flat ground";
    if (land().onRoad(x, z)) return "That's the road";
    if (G.nearSolid?.(x, z, 0.7)) return "Something's in the way";
    return null;
  };
  F.canTill = (x, z) => !F.why(x, z);

  async function drawCrops() {
    if (F.drawing) return;
    F.drawing = true; F.dirty = false;
    const groups = {}, m = new THREE.Matrix4(), B = bubbleGeo.attributes.position;
    let seeds = 0, ripeN = 0;
    for (const [k, p] of Object.entries(G.s.plots)) {
      const [x, z] = spotOf(k), y = groundY(x, z) + 0.13, at = { x, z, y, ry: (x * 7 + z * 3) % 6 };
      const put = (path, size, dy = 0) => (groups[path + size] ||= { path, size, spots: [] }).spots.push({ ...at, y: at.y + dy });
      if (p.weed) put(WEED, 0.5);
      if (!p.crop) continue;
      const c = CROPS[p.crop], stage = stageOf(p);
      if (c.tree) { put(c.tree, [0.6, 1.4, 2.8, 4.4, 5][stage]); if (stage === 4) { for (const [a, b] of [[0.7, 0.3], [-0.5, 0.6], [0.1, -0.7]]) (groups[c.ripe] ||= { path: c.ripe, size: c.ripeSize, spots: [] }).spots.push({ x: x + a, z: z + b, y: y + 3, ry: a }); } }
      else if (stage === 0) { seed.setMatrixAt(seeds++, m.makeScale(1.2, 0.5, 1.2).setPosition(x, y + 0.02, z)); }
      else if (stage < 4) put(YOUNG[stage - 1], STAGE_HEIGHT[stage]);
      else { put(YOUNG[2], 0.5); put(c.ripe, c.ripeSize, 0.04); }             // ripe: what you'll pick, sitting in its leaves
      if (stage === 4) { B.setXYZ(ripeN++, x, y + (c.tree ? 5.8 : 1.5), z); }
    }
    seed.count = seeds; seed.instanceMatrix.needsUpdate = true;
    bubbleGeo.setDrawRange(0, ripeN); B.needsUpdate = true;
    const made = new THREE.Group();
    await Promise.all(Object.values(groups).map(async (g) => {
      const mo = await loadModel(g.path);
      if (!mo) return;
      const h = new THREE.Box3().setFromObject(mo.scene).getSize(new THREE.Vector3()).y || 1;
      for (const sp of g.spots) sp.s = g.size / h;
      return forest(g.path, made, g.spots);
    }));
    crops.clear();
    crops.add(made);
    F.drawing = false;
  }

  F.draw = () => {
    const m = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    for (const [k, p] of Object.entries(G.s.plots)) {
      if (n >= MAX) break;
      const [x, z] = spotOf(k);
      soil.setMatrixAt(n, m.makeTranslation(x, groundY(x, z) + 0.05, z));
      soil.setColorAt(n, col.set(p.wet ? 0x5a3a22 : p.fert ? 0x7c5a3a : 0x8f6237));
      n++;
    }
    soil.count = n;
    soil.instanceMatrix.needsUpdate = true;
    if (soil.instanceColor) soil.instanceColor.needsUpdate = true;
    F.dirty = true;
  };

  /** the plots a tool of this tier reaches, around the one in front of you */
  F.reach = (tool) => {
    const t = F.target(), area = TOOL_UP[tool]?.area?.[G.s.tools?.[tool] || 0] || 1, out = [];
    const w = Math.round(Math.sqrt(area)), o = Math.floor(w / 2);
    if (area === 3) { const side = Math.abs(G.player.front.x) > Math.abs(G.player.front.z) ? [0, 1] : [1, 0]; for (const i of [-1, 0, 1]) out.push({ x: t.x + i * side[0] * CELL, z: t.z + i * side[1] * CELL }); return out; }
    if (area === 5) { for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) out.push({ x: t.x + a * CELL, z: t.z + b * CELL }); return out; }
    for (let a = -o; a <= o; a++) for (let b = -o; b <= o; b++) out.push({ x: t.x + a * CELL, z: t.z + b * CELL });
    return out;
  };

  F.tick = (t) => {
    if (F.dirty && !F.drawing) drawCrops();
    bubbles.position.y = Math.sin(t * 2.4) * 0.09;
    const held = G.tool?.id, show = ["hoe", "can", "seeds"].includes(held) && !G.paused && !G.player?.riding && G.player?.ground?.on === "home";
    marker.visible = !!show;
    if (marker.visible) { const c = F.target(); marker.position.set(c.x, groundY(c.x, c.z) + 0.05, c.z); marker.material.color.set(G.s.plots[keyOf(c.x, c.z)] || F.canTill(c.x, c.z) ? 0xfff4c8 : 0xe4573d); }
  };

  /** the turn of the day: what got water grows, weeds come up, and water dries */
  F.newDay = (rain, season) => {
    let grown = 0;
    for (const [k, p] of Object.entries(G.s.plots)) {
      const [x, z] = spotOf(k), under = F.inGreenhouse(x, z);
      if (p.crop) {
        const c = CROPS[p.crop];
        if ((p.wet || rain || under) && !p.weed) { p.age++; grown++; p.care = (p.care || 0) + 1; }
        if (!under && !c.seasons.includes(season) && p.age < c.days) { p.crop = null; p.age = 0; }     // out of season: it wilts, the plot stays
        if (!p.weed && Math.random() < 0.04) p.weed = true;
      } else if (!p.wet && Math.random() < 0.12) delete G.s.plots[k];                                   // left empty and dry: grass takes it back
      p.wet = !!rain || under;
    }
    const spray = (G.s.placed || []).filter((p) => CATALOG[p.type]?.sprinkle);
    for (const sp of spray) { const r = CATALOG[sp.type].sprinkle; for (const [k, p] of Object.entries(G.s.plots)) { const [x, z] = spotOf(k); if (Math.abs(x - sp.x) <= r && Math.abs(z - sp.z) <= r) p.wet = true; } }
    F.draw();
    return grown;
  };
  return F;
}
export { ISLANDS };
