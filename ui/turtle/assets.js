// assets.js - loading the packs. A model that fails to load never stops the game: it's reported once and skipped.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import { A } from "./data.js";
import { analyzeRig, plainSurfaces, tidyProps } from "../rigparts.js";

const loader = new GLTFLoader(), cache = new Map(), HELD = /sword|knife|dagger|gun|pistol|rifle|smg|shotgun|sniper|weapon|lute|guitar|staff|shield|axe|spear|bow$|wand/i;
export const missing = new Set();
// the Stylized Tree Pack came through conversion without its pictures, so it's painted in the pack's own colours
const PAINT = { Tree_Leaves: 0x9fc95a, Birch_Leaves: 0xf0c93a, Pine_Leaves: 0x8a3b55, Bark: 0x6d5a45, Birch_Bark: 0xe9e4d8 };

export function loadModel(path) {
  const url = /^\.\.\//.test(path) ? path : A + path;
  if (!cache.has(url)) cache.set(url, loader.loadAsync(encodeURI(url)).then((g) => {
    // the packs often mark things as metal, which is near black without reflections to show
    g.scene.traverse((o) => { for (const m of [].concat(o.material || [])) {
      m.metalness = 0; m.roughness = Math.max(m.roughness ?? 0.8, 0.6);
      if (PAINT[m.name] && !m.map) m.color.set(PAINT[m.name]);
    } });
    return g;
  }).catch((e) => { missing.add(url); console.warn("[turtle] missing model", url, e?.message); return null; }));
  return cache.get(url);
}

/** moves laid on bones over the clips. A clip only writes a bone when its value changes, so a nudge left on a still bone builds up frame after frame
 *  (that's what spun the dinosaurs' heads): each one comes off again before the next update. turn() takes the model's own axes: x across, y up, z forward */
export function makeOverlay(root) {
  root.updateMatrixWorld(true);
  const held = new Map(), axes = new Map(), q = new THREE.Quaternion(), rest = new THREE.Quaternion(), WORLD = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  for (const key of Object.keys(WORLD)) axes.set(key, new Map());
  const O = {
    undo() { for (const [b, s] of held) if (s.on) { b.quaternion.copy(s.q); s.on = false; } },
    keep(b) { let s = held.get(b); if (!s) held.set(b, s = { q: new THREE.Quaternion(), on: false }); if (!s.on) { s.q.copy(b.quaternion); s.on = true; } return b; },
    turn(b, axis, angle) {
      if (!b || !angle) return;
      const list = axes.get(axis);
      let a = list.get(b);
      if (!a) list.set(b, a = WORLD[axis].clone().applyQuaternion(rest.copy(b.getWorldQuaternion(q)).invert()));
      O.keep(b).quaternion.multiply(q.setFromAxisAngle(a, angle));
    },
  };
  root.traverse((o) => { if (o.isBone) for (const [key, w] of Object.entries(WORLD)) axes.get(key).set(o, w.clone().applyQuaternion(o.getWorldQuaternion(q).invert()).normalize()); });
  return O;
}

/** where a model's skin really is right now, with its bones as they stand */
function standingBox(root) {
  const box = new THREE.Box3(), v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((m) => {
    if (!m.isMesh || !m.visible) return;
    const p = m.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 1500));
    if (m.isSkinnedMesh) m.skeleton.update();
    for (let i = 0; i < p.count; i += step) { if (m.isSkinnedMesh) m.getVertexPosition(i, v); else v.fromBufferAttribute(p, i); box.expandByPoint(v.applyMatrix4(m.matrixWorld)); }
  });
  return box;
}

/** a copy of a model with bones, scaled to `height` metres, feet at 0 */
export async function character(path, height, whole = false) {
  let g = await loadModel(path);
  if (!g) return null;
  const root = cloneRig(g.scene);
  const box = new THREE.Box3().setFromObject(root), s = height / Math.max(box.getSize(new THREE.Vector3()).y, 1e-3);
  root.scale.setScalar(s);
  root.position.y = -box.min.y * s;
  // what a pack's character happens to be holding isn't part of a farmer: swords, guns, a lute. Never the body itself, whatever it's called (a swordfish)
  const verts = (o) => { let n = 0; o.traverse((m) => { if (m.isMesh) n += m.geometry.attributes.position.count; }); return n; }, all = verts(root);
  root.traverse((o) => { if (!whole && HELD.test(o.name || "") && verts(o) < all * 0.4) o.visible = false; if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  if (whole) { plainSurfaces(root); const clips = g.animations.map((c) => c.clone()); tidyProps(root, analyzeRig(root), clips); g = { ...g, animations: clips }; }       // an imported character's spare staff or fan goes in its hand
  const holder = new THREE.Group();
  holder.add(root);
  const mixer = new THREE.AnimationMixer(root), find = (re) => g.animations.find((a) => re.test(a.name));
  const actions = {};
  for (const [k, re] of Object.entries({ idle: /(^|_)idle(_neutral)?$/i, walk: /(^|_)walk(ing)?$/i, run: /(^|_)run(ning)?$/i, act: /interact|attack|pickup/i, swim: /swimming_normal|swim/i, flop: /out_of_water/i, sit: /sit/i, jump: /jump/i })) {
    const c = find(re);
    if (c) actions[k] = mixer.clipAction(c);
  }
  if (!actions.idle && g.animations[0]) actions.idle = mixer.clipAction(g.animations[0]);
  let now = null;
  const play = (k, fade = 0.2) => {
    const a = actions[k] || actions.idle;
    if (!a || a === now) return;
    a.reset().fadeIn(fade).play();
    now?.fadeOut(fade);
    now = a;
  };
  play("idle", 0);
  // what the file says its size is can't be trusted on an imported character: a clip may scale the rig (a rig saved in centimetres stands 100 times taller once it plays),
  // so it's measured standing in its idle pose, and brought to `height`. That's the one size for anything imported, now and later
  // and, like the room, never longer than about two people lying end to end: a serpent is sized by its length
  if (whole) { mixer.update(0.01); const first = standingBox(root), big = first.max.y - first.min.y, long = Math.max(first.max.x - first.min.x, first.max.z - first.min.z); if (big > 1e-6) { root.scale.multiplyScalar(Math.min(height / big, height * 1.9 / Math.max(long, 1e-6))); const b2 = standingBox(root); root.position.y -= b2.min.y; } }
  // a move that plays once, then back to what you were doing: a swing, a pick, a wave
  const swing = find(/sword_slash/i), use = find(/^interact/i), wave = find(/^wave/i), moves = { swing, use, wave };
  const once = (k) => { const c = moves[k]; if (!c) return 0.5; const a = mixer.clipAction(c); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.reset().setEffectiveTimeScale(1.3).fadeIn(0.08).play(); setTimeout(() => a.fadeOut(0.15), c.duration / 1.3 * 800); return c.duration / 1.3; };
  return { holder, root, mixer, actions, play, once, O: makeOverlay(root) };
}

/** one static copy */
export async function prop(path, parent, { x = 0, y = 0, z = 0, ry = 0, height = 0, scale = 1 } = {}) {
  const g = await loadModel(path);
  if (!g) return null;
  const o = g.scene.clone(true);
  let s = scale;
  if (height) s = height / Math.max(new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y, 1e-3);
  o.scale.setScalar(s);
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  parent.add(o);
  return o;
}

/** many copies, drawn as one: trees, rocks, grass, crops. spots: [{ x, y, z, ry, s }]. Returns the InstancedMeshes.
 *  Big scatters are split into patches of the map, so what's behind the camera or out of reach isn't drawn at all. Each spot learns its own meshes and slot: spot.insts, spot.slot */
const PATCH = 64;
export async function forest(path, parent, spots) {
  const g = await loadModel(path);
  if (!g || !spots.length) return [];
  g.scene.updateMatrixWorld(true);
  const out = [], m = new THREE.Matrix4(), place = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), patches = new Map();
  for (const p of spots) { const key = spots.length < 12 ? "all" : `${Math.floor(p.x / PATCH)},${Math.floor(p.z / PATCH)}`; (patches.get(key) || patches.set(key, []).get(key)).push(p); }
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const list of patches.values()) {
      const inst = new THREE.InstancedMesh(o.geometry, o.material, list.length);
      list.forEach((p, i) => {
        place.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(Y, p.ry || 0), new THREE.Vector3(p.s || 1, p.s || 1, p.s || 1));
        inst.setMatrixAt(i, m.multiplyMatrices(place, o.matrixWorld));
        (p.insts ||= []).push(inst); p.slot = i;
      });
      inst.castShadow = inst.receiveShadow = true;
      inst.computeBoundingSphere();
      inst.boundingSphere.radius += 2;                     // a felled tree's slot moves, and swaying grass pokes out a little
      parent.add(inst);
      out.push(inst);
    }
  });
  return out;
}