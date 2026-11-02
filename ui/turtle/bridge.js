// bridge.js - the great drawbridge. Each turtle has one leaf, standing up on its hinge with a chain from the tip back to a winch wheel.
// When the turtles moor, the winches pay out and both leaves come down until they meet. It stays rusted shut until you mend it.
import * as THREE from "three";
import { BRIDGE } from "./data.js";

const X = 36, HOME_Z = 104, TOWN_LOCAL_Z = -77, Y = 6, HALF = 3.4, UP = 1.28;    // UP: how far a leaf stands up, in radians
const paint = (color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 });

function makeLeaf(length) {
  const wood = paint(0xa8743e), dark = paint(0x6d4a28), iron = paint(0x7c8088), g = new THREE.Group(), pivot = new THREE.Group();
  g.add(pivot);
  const n = Math.round(length / 0.9), plank = new THREE.InstancedMesh(new THREE.BoxGeometry(HALF * 2, 0.22, 0.8), wood, n), m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) plank.setMatrixAt(i, m.makeRotationZ((i % 3 - 1) * 0.012).setPosition(0, 0, i * (length / n) + 0.45));
  plank.castShadow = plank.receiveShadow = true;
  pivot.add(plank);
  for (const s of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, length), dark); beam.position.set(s * HALF, -0.1, length / 2); beam.castShadow = true; pivot.add(beam);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, length), dark); rail.position.set(s * HALF, 1.05, length / 2); pivot.add(rail);
    for (let z = 0; z <= length; z += 3) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 0.2), dark); post.position.set(s * HALF, 0.5, z); pivot.add(post); }
    // the tower the hinge hangs in, and the winch wheel behind it
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.7, 5, 0.7), dark); tower.position.set(s * (HALF + 0.8), 2, -0.2); tower.castShadow = true; g.add(tower);
  }
  const cross = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 2.2, 0.5, 0.7), dark); cross.position.set(0, 4.6, -0.2); cross.castShadow = true; g.add(cross);
  const wheels = [], chains = [];
  for (const s of [-1, 1]) {
    const wheel = new THREE.Group(); wheel.position.set(s * (HALF + 0.8), 1.2, -8);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.2, 5, 10), wood); ring.rotation.y = Math.PI / 2; wheel.add(ring);
    for (let i = 0; i < 3; i++) { const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.14), dark); spoke.rotation.x = i * Math.PI / 3; wheel.add(spoke); }
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.8, 0.34), dark); post.position.set(s * 0.5, -0.3, 0); wheel.add(post);
    g.add(wheel); wheels.push(wheel);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 4), iron); chain.castShadow = true; g.add(chain); chains.push({ chain, s });
  }
  const tip = new THREE.Vector3(), from = new THREE.Vector3(), mid = new THREE.Vector3(), Yv = new THREE.Vector3(0, 1, 0);
  return { group: g, pivot, wheels, chains, set(angle, spin) {
    pivot.rotation.x = -angle;
    for (const w of wheels) w.rotation.x = spin;
    for (const { chain, s } of chains) {
      tip.set(s * HALF, Math.sin(angle) * length, Math.cos(angle) * length);
      from.set(s * (HALF + 0.8), 1.2, -8);
      mid.copy(tip).sub(from);
      chain.scale.y = mid.length();
      chain.position.copy(from).addScaledVector(mid, 0.5);
      chain.quaternion.setFromUnitVectors(Yv, mid.normalize());
    }
  } };
}

export function makeBridge(G) {
  const W = G.world, home = W.lands.home, town = W.lands.willowmere, gap = town.cfg.dock.off[1] + TOWN_LOCAL_Z - HOME_Z, length = gap / 2 + 0.2;
  const a = makeLeaf(length), b = makeLeaf(length);
  a.group.position.set(X, Y, HOME_Z);
  home.group.add(a.group);
  b.group.position.set(0, Y, TOWN_LOCAL_Z);
  b.group.rotation.y = Math.PI;
  town.group.add(b.group);
  const B = W.bridge = { open: 0, x: X, half: HALF, y: Y, z0: HOME_Z, z1: HOME_Z + gap, a, b, winch: [X + 5, HOME_Z - 6] };
  let moving = false, last = 0;
  B.tick = (dt, t) => {
    const hour = G.s.minute / 60, on = G.player?.ground?.on, standing = on === "bridge";
    const ready = G.s.flags.bridgeFixed && W.townHere > 0.995 && W.townK < 0.01;
    const want = (ready && hour >= BRIDGE.open - 0.4 && hour < BRIDGE.close + 0.5) || standing || (on === "willowmere" && W.townK < 0.01 && G.s.flags.bridgeFixed) ? 1 : 0;
    if (want && !B.open) G.moment?.("bridge");
    const step = Math.sign(want - B.open) * Math.min(Math.abs(want - B.open), dt / 6);
    B.open += step;
    const go = step !== 0;
    if (go && t - last > 0.9) { last = t; G.sfx?.("chain"); for (const w of a.wheels) { const p = w.getWorldPosition(new THREE.Vector3()); G.vfx?.burst("chain", p.x, p.y, p.z); } }
    if (moving && !go && B.open >= 1) { G.sfx?.("thud"); G.vfx?.burst("dust", X, Y + 0.4, HOME_Z + gap / 2, 3); G.vfx?.burst("dust", X + 2, Y + 0.4, HOME_Z + gap / 2, 2); }
    moving = go;
    const e = B.open * B.open * (3 - 2 * B.open), angle = UP * (1 - e), spin = B.open * 12;
    a.set(angle, spin); b.set(angle, spin);
  };
  B.tick(0, 0);
  return B;
}
