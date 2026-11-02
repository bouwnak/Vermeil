// assets.js - loading the packs. A model that fails to load never stops the game: it's reported once and skipped.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import { A } from "./data.js";

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

/** a copy of a model with bones, scaled to `height` metres, feet at 0 */
export async function character(path, height) {
  const g = await loadModel(path);
  if (!g) return null;
  const root = cloneRig(g.scene);
  const box = new THREE.Box3().setFromObject(root), s = height / Math.max(box.getSize(new THREE.Vector3()).y, 1e-3);
  root.scale.setScalar(s);
  root.position.y = -box.min.y * s;
  // what a pack's character happens to be holding isn't part of a farmer: swords, guns, a lute
  root.traverse((o) => { if (HELD.test(o.name || "")) o.visible = false; if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
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
  // a move that plays once, then back to what you were doing: a swing, a pick, a wave
  const swing = find(/sword_slash/i), use = find(/^interact/i), wave = find(/^wave/i), moves = { swing, use, wave };
  const once = (k) => { const c = moves[k]; if (!c) return 0.5; const a = mixer.clipAction(c); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.reset().setEffectiveTimeScale(1.3).fadeIn(0.08).play(); setTimeout(() => a.fadeOut(0.15), c.duration / 1.3 * 800); return c.duration / 1.3; };
  return { holder, root, mixer, actions, play, once };
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

/** many copies, drawn as one: trees, rocks, grass, crops. spots: [{ x, y, z, ry, s }]. Returns the InstancedMeshes. */
export async function forest(path, parent, spots) {
  const g = await loadModel(path);
  if (!g || !spots.length) return [];
  g.scene.updateMatrixWorld(true);
  const out = [], m = new THREE.Matrix4(), place = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const inst = new THREE.InstancedMesh(o.geometry, o.material, spots.length);
    spots.forEach((p, i) => {
      place.compose(new THREE.Vector3(p.x, p.y, p.z), q.setFromAxisAngle(Y, p.ry || 0), new THREE.Vector3(p.s || 1, p.s || 1, p.s || 1));
      inst.setMatrixAt(i, m.multiplyMatrices(place, o.matrixWorld));
    });
    inst.castShadow = inst.receiveShadow = true;
    inst.frustumCulled = false;
    parent.add(inst);
    out.push(inst);
  });
  return out;
}
