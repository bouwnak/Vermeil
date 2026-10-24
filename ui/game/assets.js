// assets.js - the model library: catalog lookup, loading (cached), cloning characters, instancing scenery,
// wind sway for plants, and "modular" characters assembled from parts of several models on the same skeleton.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const loader = new GLTFLoader();
const cache = new Map();     // url -> Promise<gltf>
// Many models share the same texture sheets (one megakit texture is used by ~60 models). THREE.Cache lets those
// image files be loaded and decoded ONCE; shareTextures() then makes every copy point at the same GPU upload.
THREE.Cache.enabled = true;
const IMG = /\.(png|jpe?g|webp|ktx2?)(\?|$)/i;
const sources = new Map();   // ImageBitmap/Image -> THREE.Source (one GPU texture per picture)
function shareTextures(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"]) {
      const t = m[k]; if (!t || !t.image) continue;
      const src = sources.get(t.image);
      if (src) t.source = src; else sources.set(t.image, t.source);
    }
  });
}
function trimCache() {           // keep decoded pictures, drop the big model text/binary files once parsed
  for (const k of Object.keys(THREE.Cache.files)) if (!IMG.test(k)) THREE.Cache.remove(k);
}
export const catalog = {};   // id -> catalog entry
const loaded = new Map();    // url -> gltf (finished loads, for unloading)
export const core = new Set();   // ids loaded on the first loading screen: never unloaded

/** free the memory of models no longer needed: everything except `keep` (ids) and the core set.
    (Geometry and textures are released; if something still shows them they're simply uploaded again.) */
export function release(keep) {
  const keepUrls = new Set([...keep, ...core].map(urlOf).filter(Boolean));
  let n = 0;
  for (const [url, g] of loaded) {
    if (keepUrls.has(url)) continue;
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      for (const m of [].concat(o.material)) {
        for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"]) m[k]?.dispose();
        m.dispose();
      }
    });
    loaded.delete(url); cache.delete(url); n++;
  }
  if (n) {                                   // forget decoded pictures nobody uses any more
    const still = new Set();
    for (const g of loaded.values()) g.scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.map?.image) still.add(m.map.image); });
    for (const [img] of sources) if (!still.has(img)) sources.delete(img);
    for (const [k, v] of Object.entries(THREE.Cache.files)) if (!still.has(v)) THREE.Cache.remove(k);
  }
  return n;
}
export const VERMEIL_URL = "../models/anime_girl.glb";

export async function loadCatalog() {
  const r = await fetch("assets/catalog.json");
  const d = await r.json();
  for (const m of d.models) catalog[m.id] = m;
  return catalog;
}

export function urlOf(id) {
  if (id === "vermeil") return VERMEIL_URL;
  if (typeof id === "string" && id.startsWith("app:")) return "../models/" + encodeURIComponent(id.slice(4));   // a character from the assistant app
  const m = catalog[id];
  return m ? "../" + m.url : null;
}

export function load(id) {
  const url = urlOf(id);
  if (!url) return Promise.reject(new Error(`unknown model ${id}`));
  if (!cache.has(url)) {
    cache.set(url, new Promise((res, rej) => loader.load(url, (g) => {
      trimCache();
      shareTextures(g.scene);
      loaded.set(url, g);
      g.parser = null;                 // the parsed file (with its embedded data) isn't needed any more
      g.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          // animated characters don't shade THEMSELVES: shadows are redrawn every other frame, so their own shadow
          // lags one pose behind and blinks dark/light on them (they still cast shadows on the ground)
          o.receiveShadow = !o.isSkinnedMesh;
          for (const m of [].concat(o.material)) {
            if (m.map) m.map.anisotropy = 4;
            // safety net: converted FBX models sometimes arrive fully see-through (alpha 0) - make them solid
            if (m.opacity < 0.05) { m.opacity = 1; m.transparent = false; if (!m.map) m.alphaTest = 0; }
            m.side = m.transparent ? THREE.DoubleSide : m.side;
          }
        }
      });
      res(g);
    }, undefined, (e) => { cache.delete(url); trimCache(); rej(e); })));
  }
  return cache.get(url);
}

/** a fresh, independent copy of a model (skinned models keep their own skeleton) */
export async function instance(id) {
  const g = await load(id);
  const root = SkeletonUtils.clone(g.scene);
  root.traverse((o) => { if (o.isMesh) { o.material = cloneMat(o.material); o.frustumCulled = !o.isSkinnedMesh; } });
  return { root, clips: g.animations, gltf: g };
}

function cloneMat(m) {
  return Array.isArray(m) ? m.map((x) => x.clone()) : m.clone();
}

/** scale so the model is `h` metres tall and stands on y=0 (returns the scale used) */
export function normalize(root, h) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 0.001 ? h / size.y : 1;
  root.scale.multiplyScalar(s);
  root.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(root, true);
  root.position.y -= b2.min.y;
  return { scale: s, size: size.multiplyScalar(s) };
}

// ---------------- wind: plants sway (shader patch shared by every copy) ----------------
const SWAY = /tree|pine|birch|maple|willow|bush|grass|clover|fern|flower|plant|petal|mushroom|wheat|corn|palm|cactus|vine/i;
export function isPlant(id) { return SWAY.test(id); }

export function swayMaterial(mat, uniforms, amount) {
  if (mat.userData.sway) return mat;
  mat.userData.sway = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uWind = uniforms.uWind;
    sh.uniforms.uSway = { value: amount };
    sh.vertexShader = "uniform float uTime; uniform float uWind; uniform float uSway;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 swayOrg = instanceMatrix[3].xyz;
      #else
        vec3 swayOrg = modelMatrix[3].xyz;
      #endif
      float swayPh = swayOrg.x * 0.37 + swayOrg.z * 0.23;
      float swayH = max(transformed.y, 0.0) * uSway * uWind;
      transformed.x += (sin(uTime * 1.6 + swayPh) + 0.4 * sin(uTime * 3.7 + swayPh * 2.0)) * swayH;
      transformed.z += cos(uTime * 1.2 + swayPh) * swayH * 0.6;`);
  };
  mat.customProgramCacheKey = () => "sway" + amount.toFixed(3);
  return mat;
}

/** many copies of the same static model -> one InstancedMesh per part (fast). items: [{matrix}] */
export async function instanced(id, matrices, { uniforms, shadows = true, sway = false } = {}) {
  const g = await load(id);
  const group = new THREE.Group();
  g.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g.scene);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const parts = [];
  g.scene.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) parts.push(o); });
  for (const p of parts) {
    let mat = p.material;
    if (sway && uniforms) mat = Array.isArray(mat) ? mat.map((m) => swayMaterial(m.clone(), uniforms, 0.07 / h)) : swayMaterial(mat.clone(), uniforms, 0.07 / h);
    if (p.matrixWorld.determinant() < 0) {          // mirrored parts (common in converted FBX) would be culled inside-out
      mat = Array.isArray(mat) ? mat.map((m) => { const c = m.clone(); c.side = THREE.DoubleSide; return c; }) : Object.assign(mat.clone(), { side: THREE.DoubleSide });
    }
    const im = new THREE.InstancedMesh(p.geometry, mat, matrices.length);
    const local = p.matrixWorld;
    const tmp = new THREE.Matrix4();
    matrices.forEach((m, i) => im.setMatrixAt(i, tmp.multiplyMatrices(m, local)));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  return group;
}

// ---------------- modular characters (Ultimate Modular Men/Women share one skeleton) ----------------
const SLOT_RX = { Head: /head/i, Body: /body/i, Legs: /legs/i, Feet: /feet/i };

/** build a character from parts: {Head: modelId, Body: modelId, Legs:..., Feet:...}. Falls back to the base model. */
export async function modular(baseId, parts) {
  const base = await instance(parts?.Body || baseId);
  if (!parts) return base;
  const skel = [];
  base.root.traverse((o) => { if (o.isSkinnedMesh) skel.push(o); });
  if (!skel.length) return base;
  const bones = {};
  skel[0].skeleton.bones.forEach((b) => (bones[b.name] = b));
  for (const [slot, id] of Object.entries(parts)) {
    if (slot === "Body" || !id || !catalog[id]) continue;
    try {
      const src = await load(id);
      let piece = null;
      src.scene.traverse((o) => { if (!piece && o.isSkinnedMesh && SLOT_RX[slot].test(o.name)) piece = o; });
      if (!piece) continue;
      // hide the base model's own part in that slot
      base.root.traverse((o) => { if (o.isSkinnedMesh && SLOT_RX[slot].test(o.name)) o.visible = false; });
      const mapped = piece.skeleton.bones.map((b) => bones[b.name]);
      if (mapped.some((b) => !b)) continue;                 // different skeleton: don't force it
      const mesh = new THREE.SkinnedMesh(piece.geometry, cloneMat(piece.material));
      mesh.name = piece.name;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      skel[0].parent.add(mesh);
      mesh.bind(new THREE.Skeleton(mapped, piece.skeleton.boneInverses.map((m) => m.clone())), skel[0].bindMatrix);
    } catch (e) { console.warn("modular part failed", id, e); }
  }
  return base;
}

/** tint a model's materials toward a colour (used for variety and for 'tint' in biome pools) */
export function tint(root, color, amount = 0.35) {
  const c = new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) if (m.color) m.color.lerp(c, amount);
  });
}

/** load many models a few at a time, reporting progress: onProgress(done, total, id). Returns the ids that failed. */
export async function preloadAll(ids, onProgress, conc = 6) {
  const list = [...new Set(ids)].filter((i) => urlOf(i));
  const failed = [];
  let next = 0, done = 0;
  const pending = (window.__pendingModels ||= new Set());
  const worker = async () => {
    while (next < list.length) {
      const id = list[next++];
      pending.add(id);
      try { await withTimeout(load(id), 60000, id); } catch (e) { failed.push(id); console.warn("model failed to load", id, String(e)); }
      pending.delete(id);
      done++;
      onProgress?.(done, list.length, id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, list.length) }, worker));
  return failed;
}

function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out loading ${what}`)), ms))]);
}

export function preload(ids) {
  return Promise.allSettled([...new Set(ids)].filter((i) => urlOf(i)).map((i) => load(i)));
}
