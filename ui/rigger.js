// Rigger: give an imported 3D model bones so it can move.
//  - a model that already has a rig: look at it, keep it, or delete it and rig it yourself
//  - auto rig (fits a skeleton to the model), presets (biped / quadruped / creature),
//    or place the bones yourself, one joint after another
//  - every joint can be dragged; mirror keeps the left and right side the same
//  - IK is set up by itself: drag a hand, foot or tail tip and the limb follows
//  - skin weights are worked out from how close each bit of the mesh is to each bone
//  - then UniMate (tools/unimate) can animate it from text (idle, walk, wave...)
// Bone names follow Blender's Rigify (spine, upper_arm.L, thigh.R...) so the room's own
// arm and leg IK, ears and fingers work on the rigged model straight away.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { inPlace } from "./inplace.js";
import { ViewAxis } from "./viewaxis.js";
import { makeTalkClip, talkBones } from "./talkanim.js";

// Presets, in "box" units: x and z from -0.5 to 0.5 of the model's width/depth, y from 0 (feet) to 1 (top).
// [name, parent, x, y, z]. Joints ending in .L are mirrored to .R automatically.
const BIPED = [
  ["spine", null, 0, 0.52, 0], ["spine.001", "spine", 0, 0.6, 0], ["spine.002", "spine.001", 0, 0.67, 0],
  ["spine.003", "spine.002", 0, 0.75, 0], ["spine.004", "spine.003", 0, 0.83, 0], ["head", "spine.004", 0, 0.87, 0.02],
  ["head_end", "head", 0, 1, 0.02],
  ["shoulder.L", "spine.003", 0.06, 0.8, 0], ["upper_arm.L", "shoulder.L", 0.17, 0.8, 0],
  ["forearm.L", "upper_arm.L", 0.3, 0.8, 0], ["hand.L", "forearm.L", 0.42, 0.8, 0], ["hand_end.L", "hand.L", 0.49, 0.8, 0],
  ["thigh.L", "spine", 0.1, 0.5, 0], ["shin.L", "thigh.L", 0.1, 0.27, 0.01], ["foot.L", "shin.L", 0.1, 0.05, 0],
  ["toe.L", "foot.L", 0.1, 0.01, 0.35],
];
const QUADRUPED = [   // facing +z: head at the front
  ["spine", null, 0, 0.62, -0.3], ["spine.001", "spine", 0, 0.64, -0.1], ["spine.002", "spine.001", 0, 0.65, 0.1],
  ["spine.003", "spine.002", 0, 0.66, 0.28], ["spine.004", "spine.003", 0, 0.78, 0.38], ["head", "spine.004", 0, 0.88, 0.44],
  ["head_end", "head", 0, 0.9, 0.5], ["ear.L", "head", 0.08, 0.95, 0.42], ["ear_end.L", "ear.L", 0.12, 1, 0.4],
  ["tail", "spine", 0, 0.66, -0.4], ["tail.001", "tail", 0, 0.68, -0.46], ["tail_end", "tail.001", 0, 0.7, -0.5],
  ["upper_arm.L", "spine.003", 0.2, 0.58, 0.3], ["forearm.L", "upper_arm.L", 0.2, 0.32, 0.31], ["hand.L", "forearm.L", 0.2, 0.05, 0.31], ["hand_end.L", "hand.L", 0.2, 0.01, 0.38],
  ["thigh.L", "spine", 0.2, 0.58, -0.3], ["shin.L", "thigh.L", 0.2, 0.32, -0.34], ["foot.L", "shin.L", 0.2, 0.05, -0.3], ["toe.L", "foot.L", 0.2, 0.01, -0.24],
];
const CREATURE = [    // short and round, big head, ears and a tail (think Riolu)
  ["spine", null, 0, 0.36, 0], ["spine.001", "spine", 0, 0.44, 0], ["spine.003", "spine.001", 0, 0.52, 0],
  ["spine.004", "spine.003", 0, 0.58, 0], ["head", "spine.004", 0, 0.64, 0.03], ["head_end", "head", 0, 0.86, 0.03],
  ["ear.L", "head", 0.14, 0.86, 0], ["ear_end.L", "ear.L", 0.24, 1, -0.02],
  ["upper_arm.L", "spine.003", 0.14, 0.53, 0], ["forearm.L", "upper_arm.L", 0.25, 0.47, 0.02], ["hand.L", "forearm.L", 0.34, 0.42, 0.04], ["hand_end.L", "hand.L", 0.4, 0.4, 0.05],
  ["thigh.L", "spine", 0.1, 0.33, 0], ["shin.L", "thigh.L", 0.11, 0.18, 0.02], ["foot.L", "shin.L", 0.11, 0.03, 0], ["toe.L", "foot.L", 0.11, 0.01, 0.3],
  ["tail", "spine", 0, 0.32, -0.3], ["tail.001", "tail", 0, 0.34, -0.42], ["tail_end", "tail.001", 0, 0.42, -0.5],
];
const PRESETS = { biped: BIPED, quadruped: QUADRUPED, creature: CREATURE };

// What UniMate is asked for, and the clip name the room plays it as
export const MOTIONS = [
  ["idle", "Standing (idle)", "An object stands in place and breathes calmly."],
  ["walk", "Walking", "An object walks forward."],
  ["wave", "Waving", "An object waves with its right hand."],
  ["talk", "Talking gestures", "An object talks and gestures with its hands."],
  ["happy", "Happy", "An object bounces happily in place."],
  ["dance", "Dancing", "An object dances in place."],
  ["cheer", "Cheering", "An object cheers with its arms raised."],
  ["jump", "Jumping", "An object jumps in place."],
  ["sad", "Sad", "An object hangs its head sadly."],
  ["sit", "Sitting", "An object sits down and stays seated."],
];

const SIDE = (name) => (/[._]L$/i.test(name) ? 1 : /[._]R$/i.test(name) ? -1 : 0);
const OTHER = (name) => name.replace(/([._])([LR])$/i, (m, d, s) => d + (s === "L" ? "R" : s === "l" ? "r" : s === "R" ? "L" : "l"));
const IS_TIP = /(_end|^toe|tail_end)/i;

let R = null;          // the one open rigger

/** move a geometry (and its shape keys) into world space */
function bake(geo, world) {
  geo.applyMatrix4(world);
  const lin = new THREE.Matrix4().copy(world).setPosition(0, 0, 0);
  const rot = new THREE.Matrix4().extractRotation(world);
  for (const [k, arr] of Object.entries(geo.morphAttributes || {})) {
    if (k !== "position" && k !== "normal") continue;
    for (const a of arr) a.applyMatrix4(k === "normal" ? rot : geo.morphTargetsRelative ? lin : world);
  }
  return geo;
}

/**
 * Open the rigger for a model in ui/models.
 * opts: { api, toast, fromImport (true right after importing), onSaved(name) }
 */
export async function openRigger(file, opts) {
  if (R) R.close();
  R = new Rigger(file, opts);
  await R.start();
}
export function rigEvent(e) { R?.onEvent(e); }

class Rigger {
  constructor(file, { api, toast, fromImport = false, onSaved = () => {} }) {
    Object.assign(this, { file, api, toast, fromImport, onSaved });
    this.joints = [];        // {name, parent (joint or null), pos (Vector3), mesh (the sphere)}
    this.mode = "look";      // look | edit | place | pose | animate
    this.mirror = true;
    this.selected = null;
    this.chainFrom = null;
    this._build();
  }

  // ---------- page ----------
  _build() {
    const el = (this.el = document.createElement("div"));
    el.className = "rigger";
    el.innerHTML = `
      <canvas class="rig-canvas"></canvas>
      <div class="rig-top">
        <strong class="rig-title">🦴 Rig <span></span></strong>
        <div class="rig-tools"></div>
        <button type="button" class="rig-close" title="Close (Esc)">✕</button>
      </div>
      <div class="rig-side" hidden></div>
      <div class="rig-ask" hidden><p></p><div class="rig-ask-btns"></div></div>
      <div class="rig-hint"></div>
      <div class="rig-busy" hidden><p></p><div class="clone-bar"><i></i><span></span></div></div>`;
    document.body.appendChild(el);
    el.querySelector(".rig-title span").textContent = this.file;
    el.querySelector(".rig-close").addEventListener("click", () => this.close());
    this.$ = (s) => el.querySelector(s);

    const canvas = this.$(".rig-canvas");
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 500);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);
    this.jointsGroup = new THREE.Group();
    this.scene.add(this.jointsGroup);
    this.axis = new ViewAxis(el, this.camera, this.controls, () => this._frame());   // Blender-style axis, top right
    this.ray = new THREE.Raycaster();

    this._onKey = (e) => {
      if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (e.key === "Escape") { if (this.mode === "place") this.setMode("edit"); else if (this.$(".rig-ask").hidden) this.close(); }
      if ((e.key === "Delete" || e.key === "Backspace") && this.mode === "edit" && this.selected) this.deleteJoint(this.selected);
    };
    addEventListener("keydown", this._onKey);
    this._onResize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / Math.max(h, 1);
      this.camera.updateProjectionMatrix();
    };
    addEventListener("resize", this._onResize);
    canvas.addEventListener("pointerdown", (e) => this._down(e));
    canvas.addEventListener("pointermove", (e) => this._move(e));
    canvas.addEventListener("pointerup", (e) => this._up(e));
    requestAnimationFrame(() => el.classList.add("open"));
    this._onResize();
    const loop = () => {
      if (!this.el) return;
      this._raf = requestAnimationFrame(loop);
      this.controls.update();
      if (this.mode === "pose") this._solveIK();
      this._updateLines();
      this.renderer.render(this.scene, this.camera);
      this.axis.update();
    };
    loop();
  }

  close() {
    if (!this.el) return;
    cancelAnimationFrame(this._raf);
    removeEventListener("keydown", this._onKey);
    removeEventListener("resize", this._onResize);
    this.axis.dispose();
    this.el.classList.remove("open");
    const el = this.el;
    this.el = null;
    setTimeout(() => { el.remove(); this.renderer.dispose(); }, 250);
    if (R === this) R = null;
  }

  hint(text) { this.$(".rig-hint").textContent = text || ""; }

  /** a question card at the bottom; resolves with the key of the button pressed */
  ask(text, buttons) {
    const box = this.$(".rig-ask");
    box.querySelector("p").textContent = text;
    return new Promise((done) => {
      box.querySelector(".rig-ask-btns").replaceChildren(...buttons.map(([key, label], i) => {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = label; b.className = i === 0 ? "primary" : "ghost";
        b.addEventListener("click", () => { box.hidden = true; done(key); });
        return b;
      }));
      box.hidden = false;
      box.classList.remove("pop"); void box.offsetWidth; box.classList.add("pop");
    });
  }

  busy(text, pct = null) {
    const b = this.$(".rig-busy");
    b.hidden = text == null;
    if (text == null) return;
    b.querySelector("p").textContent = text;
    b.querySelector("i").style.width = pct == null ? "100%" : `${Math.round(pct * 100)}%`;
    b.querySelector(".clone-bar").classList.toggle("indeterminate", pct == null);
    b.querySelector("span").textContent = pct == null ? "" : `${Math.round(pct * 100)}%`;
  }

  tools(list) {
    this.$(".rig-tools").replaceChildren(...list.map((t) => {
      if (t.label == null) return t;          // already an element
      const b = document.createElement("button");
      b.type = "button"; b.textContent = t.label; b.title = t.title || "";
      if (t.on) b.classList.add("on");
      b.addEventListener("click", t.click);
      return b;
    }));
  }

  // ---------- start: load, look for an existing rig, ask ----------
  async start() {
    this.busy("Loading the model…");
    try {
      this.gltf = await new GLTFLoader().loadAsync(`models/${encodeURIComponent(this.file)}`);
    } catch (err) {
      this.busy(null);
      this.toast(`Couldn't open ${this.file}: ${err.message || err}`);
      return this.close();
    }
    this.busy(null);
    this.model = this.gltf.scene;
    this.scene.add(this.model);
    this.model.updateMatrixWorld(true);
    this.box = new THREE.Box3().setFromObject(this.model);
    this.size = this.box.getSize(new THREE.Vector3());
    this.unit = Math.max(this.size.x, this.size.y, this.size.z);
    this._frame();
    this.meshes = [];
    this.model.traverse((o) => { if (o.isMesh) { this.meshes.push(o); o.material = [].concat(o.material).map((m) => { const c = m.clone(); c.side = THREE.DoubleSide; c.userData.side = m.side; return c; }); if (o.material.length === 1) o.material = o.material[0]; } });

    const bones = [];
    this.model.traverse((o) => { if (o.isBone) bones.push(o); });
    if (bones.length) {
      const anims = this.gltf.animations.length;
      const go = await this.ask(`This model already has a rig inside it (${bones.length} bones${anims ? `, ${anims} animation${anims > 1 ? "s" : ""}` : ""}). Do you want to see it, or is it okay as it is?`,
        [["view", "Show me the rig"], ["keep", "It's okay as it is"]]);
      if (go === "keep") return this.fromImport ? this.close() : this.existingMode();
      this.showExisting(bones);
      const del = await this.ask("This is the rig (the dots are its joints). Delete it and rig the model yourself?",
        [["keep", "Keep this rig"], ["delete", "Delete it and rig it myself"]]);
      if (del === "keep") return this.existingMode();
      this.stripRig();
      this.chooseRig();
    } else {
      const go = await this.ask("This model has no rig yet, so it can't move. Rig it now? (It only takes a minute.)",
        [["rig", "Rig it"], ["later", "Not now"]]);
      if (go === "later") return this.close();
      this.chooseRig();
    }
  }

  _frame() {
    const c = this.box.getCenter(new THREE.Vector3());
    const d = this.unit * 1.9;
    this.camera.near = this.unit / 200; this.camera.far = this.unit * 60;
    this.camera.position.set(c.x + d * 0.35, c.y + d * 0.15, c.z + d);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
  }

  // ---------- an existing rig ----------
  showExisting(bones) {
    this.helper = new THREE.SkeletonHelper(this.model);
    this.helper.material.depthTest = false;
    this.scene.add(this.helper);
    const r = this.unit * 0.012;
    for (const b of bones) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc44d, depthTest: false }));
      s.renderOrder = 10;
      s.position.copy(b.getWorldPosition(new THREE.Vector3()));
      this.jointsGroup.add(s);
    }
    this._ghost(true);
    this.hint("Drag to look around. Scroll to zoom.");
  }

  _ghost(on) {
    for (const m of this.meshes) for (const mat of [].concat(m.material)) { mat.transparent = on; mat.opacity = on ? 0.45 : 1; mat.depthWrite = !on; }
  }

  /** a rig we're keeping: test it with IK, or animate it */
  existingMode() {
    this.mode = "look";
    this.$(".rig-ask").hidden = true;
    this.tools([
      { label: "🎬 Animate (talking, UniMate)", click: () => this.animatePanel(this.file) },
      { label: "✓ Done", click: () => this.close() },
    ]);
    this.hint("This rig stays as it is. You can have UniMate make animations for it.");
  }

  /** take the old rig out: skinned meshes become plain meshes, in the pose they're shown in */
  stripRig() {
    if (this.helper) { this.scene.remove(this.helper); this.helper = null; }
    this.jointsGroup.clear();
    this.model.updateMatrixWorld(true);
    const root = new THREE.Group();
    root.name = this.model.name || "model";
    const v = new THREE.Vector3();
    this.meshes = this.meshes.map((m) => {
      const geo = m.geometry.clone();
      if (m.isSkinnedMesh) {
        const p = geo.attributes.position;
        for (let i = 0; i < p.count; i++) { m.getVertexPosition(i, v); p.setXYZ(i, v.x, v.y, v.z); }
        geo.deleteAttribute("skinIndex"); geo.deleteAttribute("skinWeight");
      }
      bake(geo, m.matrixWorld);
      const plain = new THREE.Mesh(geo, m.material);
      plain.name = m.name;
      if (m.morphTargetDictionary) { plain.morphTargetDictionary = m.morphTargetDictionary; plain.morphTargetInfluences = m.morphTargetInfluences.slice(); }
      root.add(plain);
      return plain;
    });
    this.scene.remove(this.model);
    this.model = root;
    this.scene.add(root);
    this.gltf.animations = [];
  }

  // ---------- making a rig ----------
  chooseRig() {
    this.mode = "edit";
    this._ghost(true);
    const side = this.$(".rig-side");
    side.hidden = false;
    side.innerHTML = `
      <h3>How do you want to rig it?</h3>
      <button type="button" data-k="auto" class="primary">✨ Auto rig <small>fits a skeleton for you; drag any joint to fix it</small></button>
      <button type="button" data-k="biped">🧍 Biped <small>two legs: people, robots</small></button>
      <button type="button" data-k="quadruped">🐕 Quadruped <small>four legs: dogs, cats, horses</small></button>
      <button type="button" data-k="creature">🐾 Creature <small>small and round, ears and a tail</small></button>
      <button type="button" data-k="place">✏️ Place bones myself <small>click joint after joint</small></button>`;
    for (const b of side.querySelectorAll("button")) b.addEventListener("click", () => {
      const k = b.dataset.k;
      if (k === "place") { this.clearJoints(); this.setMode("place"); }
      else this.preset(k === "auto" ? this._guessKind() : k, k === "auto");
      side.hidden = true;
    });
    this.tools([]);
    this.hint("Pick one. You can still move every joint afterwards.");
  }

  _guessKind() {
    const { x, y, z } = this.size;
    if (z > y * 1.1 && z > x) return "quadruped";            // longer front-to-back than tall: four legs
    const wide = (v) => { const p = this._slab(v, 0.05); return p.length ? this._spread(p) / x : 0; };
    if (wide(0.78) > 0.8) return "biped";                       // arms straight out (T-pose)
    return y < Math.max(x, z) * 1.6 && wide(0.75) > 0.5 ? "creature" : "biped";   // big head, short body
  }

  /** vertices (world space) between two heights, as fractions of the model's height */
  _slab(v, half, filter) {
    const out = [], y0 = this.box.min.y + (v - half) * this.size.y, y1 = this.box.min.y + (v + half) * this.size.y;
    const p = new THREE.Vector3();
    for (const m of this.meshes) {
      const pos = m.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 6000));
      for (let i = 0; i < pos.count; i += step) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (p.y >= y0 && p.y <= y1 && (!filter || filter(p))) out.push(p.clone());
      }
    }
    return out;
  }
  _spread(pts) { let a = Infinity, b = -Infinity; for (const p of pts) { a = Math.min(a, p.x); b = Math.max(b, p.x); } return b - a; }
  _centroid(pts) { const c = new THREE.Vector3(); for (const p of pts) c.add(p); return pts.length ? c.divideScalar(pts.length) : null; }

  preset(kind, fit) {
    this.clearJoints();
    const B = this.box, S = this.size, cx = (B.min.x + B.max.x) / 2, cz = (B.min.z + B.max.z) / 2;
    const at = (x, y, z) => new THREE.Vector3(cx + x * S.x, B.min.y + y * S.y, cz + z * S.z);
    const byName = {};
    for (const [name, parent, x, y, z] of PRESETS[kind]) {
      byName[name] = this.addJoint(name, byName[parent] || null, at(x, y, z));
      if (SIDE(name)) {
        const pr = byName[OTHER(parent || "")] || byName[parent] || null;
        byName[OTHER(name)] = this.addJoint(OTHER(name), pr, at(-x, y, z));
      }
    }
    if (fit && kind !== "quadruped") this._fitBiped(byName);
    this._afterRig();
    this.toast(fit ? `Auto rig: looks like a ${kind}. Drag any dot that's in the wrong place.` : `${kind[0].toUpperCase() + kind.slice(1)} rig added. Drag the dots to fit the model.`);
  }

  /** nudge the preset onto the actual mesh: spine down the middle, legs into the legs, hands at the ends of the arms */
  _fitBiped(J) {
    const v = (j) => (j.pos.y - this.box.min.y) / this.size.y;
    for (const n of ["spine", "spine.001", "spine.002", "spine.003", "spine.004", "head"]) {
      const j = J[n]; if (!j) continue;
      const c = this._centroid(this._slab(v(j), 0.02, (p) => Math.abs(p.x - j.pos.x) < this.size.x * 0.15));
      if (c) { j.pos.x = c.x; j.pos.z = c.z; }
    }
    for (const s of ["L", "R"]) {
      const sign = s === "L" ? 1 : -1;
      for (const n of [`thigh.${s}`, `shin.${s}`, `foot.${s}`]) {
        const j = J[n]; if (!j) continue;
        const pts = this._slab(v(j), 0.025, (p) => (p.x - J.spine.pos.x) * sign > this.size.x * 0.02 && Math.abs(p.x - J.spine.pos.x) < this.size.x * 0.3);
        const c = this._centroid(pts);
        if (c) { j.pos.x = c.x; j.pos.z = c.z; }
      }
      const toe = J[`toe.${s}`], foot = J[`foot.${s}`];
      if (toe && foot) { toe.pos.x = foot.pos.x; toe.pos.z = foot.pos.z + this.size.z * 0.3; }
      // arms: the furthest point out at shoulder height is the hand
      const ua = J[`upper_arm.${s}`], hand = J[`hand.${s}`], fa = J[`forearm.${s}`], end = J[`hand_end.${s}`];
      if (!ua || !hand) continue;
      const pts = this._slab(v(ua), 0.08, (p) => (p.x - J.spine.pos.x) * sign > 0);
      let far = null;
      for (const p of pts) if (!far || (p.x - far.x) * sign > 0) far = p;
      if (far && Math.abs(far.x - J.spine.pos.x) > this.size.x * 0.25) {
        end.pos.copy(far);
        hand.pos.lerpVectors(ua.pos, far, 0.85);
        fa.pos.lerpVectors(ua.pos, far, 0.48);
        const sh = J[`shoulder.${s}`];
        if (sh) sh.pos.lerpVectors(J["spine.003"].pos, ua.pos, 0.4);
      } else {                                // arms hang down (A-pose / at the sides): bend the chain downwards
        const down = this._slab(v(ua) - 0.18, 0.06, (p) => (p.x - J.spine.pos.x) * sign > this.size.x * 0.2);
        const c = this._centroid(down);
        if (c) { fa.pos.copy(c); hand.pos.set(c.x + (c.x - ua.pos.x) * 0.8, c.y - (ua.pos.y - c.y) * 0.9, c.z); end.pos.copy(hand.pos).add(new THREE.Vector3(0, -this.size.y * 0.06, 0)); }
      }
    }
    for (const j of this.joints) j.mesh.position.copy(j.pos);
  }

  clearJoints() { this.joints = []; this.jointsGroup.clear(); this.selected = this.chainFrom = null; }

  addJoint(name, parent, pos) {
    const tip = IS_TIP.test(name);
    const r = this.unit * (tip ? 0.011 : 0.016);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), new THREE.MeshBasicMaterial({ color: tip ? 0x9fd8ff : 0xffc44d, depthTest: false, transparent: true }));
    mesh.renderOrder = 10;
    mesh.position.copy(pos);
    const j = { name, parent, pos: pos.clone(), mesh };
    mesh.userData.joint = j;
    this.jointsGroup.add(mesh);
    this.joints.push(j);
    mesh.scale.setScalar(0.01);                      // pops in
    j.popT = 0;
    return j;
  }

  deleteJoint(j) {
    for (const c of this.joints) if (c.parent === j) c.parent = j.parent;
    this.joints = this.joints.filter((x) => x !== j);
    this.jointsGroup.remove(j.mesh);
    if (this.selected === j) this.select(null);
    if (this.chainFrom === j) this.chainFrom = j.parent;
  }

  /** lines from each joint to its parent */
  _updateLines() {
    if (!this.lines) {
      this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85 }));
      this.lines.renderOrder = 9;
      this.scene.add(this.lines);
    }
    const pts = [];
    for (const j of this.joints) {
      if (j.popT != null) { j.popT += 1 / 60; const x = Math.min(1, j.popT / 0.35); j.mesh.scale.setScalar(x >= 1 ? 1 : x + Math.sin(x * Math.PI) * 0.4); if (x >= 1) j.popT = null; }
      if (j.parent) pts.push(j.parent.mesh.position, j.mesh.position);
    }
    this.lines.geometry.setFromPoints(pts);
    this.lines.visible = (this.mode === "edit" || this.mode === "place") && !!pts.length;
  }

  select(j) {
    if (this.selected) this.selected.mesh.material.color.setHex(IS_TIP.test(this.selected.name) ? 0x9fd8ff : 0xffc44d);
    this.selected = j;
    if (j) j.mesh.material.color.setHex(0xff6b9a);
    this._renderEditTools();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "place") {
      this.chainFrom = this.selected;
      this.hint("Click on the model to place a joint. Each click adds a bone from the last joint. Click an existing dot to branch from it. Press Exit (or Esc) when done.");
      this.tools([
        { label: "⏹ Exit placing", on: true, click: () => this.setMode("edit") },
        { label: "↶ Remove last", click: () => { const last = this.joints.at(-1); if (last) this.deleteJoint(last); } },
      ]);
    } else if (mode === "edit") {
      if (!this.joints.length) return this.chooseRig();
      this._afterRig();
    }
  }

  _afterRig() {
    this.mode = "edit";
    this._ghost(true);
    this.hint("Drag a dot to move a joint. Click one to select it (rename or delete it). Then press Save rig.");
    this._renderEditTools();
  }

  _renderEditTools() {
    if (this.mode !== "edit") return;
    const name = document.createElement("input");
    name.className = "rig-name"; name.placeholder = "click a joint"; name.disabled = !this.selected;
    name.value = this.selected?.name || "";
    name.addEventListener("change", () => { if (this.selected && name.value.trim()) this.selected.name = name.value.trim(); });
    const mirror = document.createElement("label");
    mirror.className = "rig-check";
    mirror.innerHTML = `<input type="checkbox" ${this.mirror ? "checked" : ""}> Mirror left/right`;
    mirror.querySelector("input").addEventListener("change", (e) => { this.mirror = e.target.checked; });
    this.tools([
      { label: "✏️ Place bones", title: "add joints by clicking on the model", click: () => this.setMode("place") },
      { label: "🧍 Change preset", click: () => this.chooseRig() },
      name,
      { label: "🗑 Delete joint", click: () => this.selected && this.deleteJoint(this.selected) },
      mirror,
      { label: "🦾 Test pose (IK)", title: "drag hands and feet to check the rig bends well", click: () => this.poseMode() },
      { label: "💾 Save rig", click: () => this.save() },
    ]);
  }

  // ---------- mouse ----------
  _ndc(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  _pickJoint(e, list = this.jointsGroup.children) {
    this.ray.setFromCamera(this._ndc(e), this.camera);
    return this.ray.intersectObjects(list, false)[0]?.object || null;
  }
  /** where a click lands *inside* the model: halfway between where the ray goes in and comes out */
  _pickInside(e) {
    this.ray.setFromCamera(this._ndc(e), this.camera);
    const hits = this.ray.intersectObjects(this.meshes, false);
    if (!hits.length) return null;
    const a = hits[0].point;
    const b = hits.find((h) => h.distance > hits[0].distance + this.unit * 0.004)?.point;
    return b ? a.clone().lerp(b, 0.5) : a.clone();
  }

  _down(e) {
    if (e.button !== 0) return;
    if (this.mode === "place") {
      const hit = this._pickJoint(e);
      if (hit) { this.chainFrom = hit.userData.joint; this.select(this.chainFrom); return; }
      const p = this._pickInside(e);
      if (!p) return;
      const n = this.joints.length;
      const side = Math.abs(p.x - (this.box.min.x + this.box.max.x) / 2) > this.size.x * 0.04 ? (p.x > (this.box.min.x + this.box.max.x) / 2 ? ".L" : ".R") : "";
      const j = this.addJoint(`bone_${String(n).padStart(2, "0")}${side}`, this.chainFrom, p);
      this.chainFrom = j;
      this.select(j);
      return;
    }
    const list = this.mode === "pose" ? this.ikTargets.map((t) => t.handle) : this.mode === "edit" ? this.jointsGroup.children : [];
    const hit = this._pickJoint(e, list);
    if (!hit) return;
    if (this.mode === "edit") this.select(hit.userData.joint);
    const n = this.camera.getWorldDirection(new THREE.Vector3());
    this._drag = { obj: hit, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, hit.position) };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  }
  _move(e) {
    if (!this._drag) return;
    this.ray.setFromCamera(this._ndc(e), this.camera);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this._drag.plane, p)) return;
    const o = this._drag.obj;
    o.position.copy(p);
    const j = o.userData.joint;
    if (j) {
      j.pos.copy(p);
      if (this.mirror && SIDE(j.name)) {
        const twin = this.joints.find((x) => x.name === OTHER(j.name));
        if (twin) { const cx = (this.box.min.x + this.box.max.x) / 2; twin.pos.set(2 * cx - p.x, p.y, p.z); twin.mesh.position.copy(twin.pos); }
      }
    }
  }
  _up() { this._drag = null; this.controls.enabled = true; }

  // ---------- bones, skin, IK ----------
  /** turn the joints into real bones (each bone's +Y points at its first child, like Blender) */
  _makeBones() {
    const Y = new THREE.Vector3(0, 1, 0);
    const kids = new Map(this.joints.map((j) => [j, this.joints.filter((c) => c.parent === j)]));
    const worldQ = new Map();
    for (const j of this.joints) {
      const c = kids.get(j)[0];
      const dir = c ? c.pos.clone().sub(j.pos) : j.parent ? j.pos.clone().sub(j.parent.pos) : Y.clone();
      worldQ.set(j, dir.lengthSq() > 1e-12 ? new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize()) : new THREE.Quaternion());
    }
    const bones = new Map();
    const order = [];
    const visit = (j) => { order.push(j); for (const c of kids.get(j)) visit(c); };
    for (const j of this.joints) if (!j.parent) visit(j);
    for (const j of order) {
      const b = new THREE.Bone();
      b.name = j.name;
      if (j.parent) {
        const pq = worldQ.get(j.parent).clone().invert();
        b.position.copy(j.pos).sub(j.parent.pos).applyQuaternion(pq);
        b.quaternion.copy(pq.multiply(worldQ.get(j)));
        bones.get(j.parent).add(b);
      } else {
        b.position.copy(j.pos);
        b.quaternion.copy(worldQ.get(j));
      }
      bones.set(j, b);
    }
    return { bones, order, kids };
  }

  /** skin weights: each vertex follows the (up to 4) closest bones; left bones don't grab the right side */
  _weights(geo, order, kids, index) {
    const segs = [];
    for (const j of order) {
      const ch = kids.get(j);
      if (ch.length) for (const c of ch) segs.push({ bone: index.get(j), a: j.pos, b: c.pos, side: SIDE(j.name) });
      else if (!j.parent) segs.push({ bone: index.get(j), a: j.pos, b: j.pos, side: SIDE(j.name) });
    }
    const pos = geo.attributes.position, n = pos.count;
    const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
    const cx = (this.box.min.x + this.box.max.x) / 2, mid = this.size.x * 0.03;
    const p = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
    const best = new Float32Array(order.length);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      best.fill(Infinity);
      const vs = p.x - cx > mid ? 1 : p.x - cx < -mid ? -1 : 0;
      for (const s of segs) {
        ab.subVectors(s.b, s.a); ap.subVectors(p, s.a);
        const L = ab.lengthSq();
        const t = L > 0 ? Math.max(0, Math.min(1, ap.dot(ab) / L)) : 0;
        let d = ap.addScaledVector(ab, -t).length();
        if (s.side && vs && s.side !== vs) d *= 4;
        if (d < best[s.bone]) best[s.bone] = d;
      }
      const top = [...best.keys()].sort((a, b) => best[a] - best[b]).slice(0, 4);
      const d0 = Math.max(best[top[0]], this.unit * 0.002);
      let sum = 0;
      const w = top.map((k) => { const x = d0 / Math.max(best[k], 1e-9); const v = x ** 4; sum += v; return v; });
      top.forEach((k, m) => { skinIndex[i * 4 + m] = k; skinWeight[i * 4 + m] = w[m] / sum; });
    }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
  }

  /** build the skinned model from the joints */
  _buildRig() {
    if (this.joints.length < 2) throw new Error("place at least two joints first");
    const { bones, order, kids } = this._makeBones();
    const index = new Map(order.map((j, i) => [j, i]));
    const list = order.map((j) => bones.get(j));
    const root = new THREE.Group();
    root.name = "Rigged";
    const armature = new THREE.Group();
    armature.name = "Armature";
    root.add(armature);
    for (const j of order) if (!j.parent) armature.add(bones.get(j));
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(list);
    this.model.updateMatrixWorld(true);
    for (const m of this.meshes) {
      const geo = bake(m.geometry.clone(), m.matrixWorld);
      this._weights(geo, order, kids, index);
      const mats = [].concat(m.material).map((x) => { const c = x.clone(); c.side = x.userData.side ?? THREE.FrontSide; c.transparent = false; c.opacity = 1; c.depthWrite = true; return c; });
      const sm = new THREE.SkinnedMesh(geo, mats.length === 1 ? mats[0] : mats);
      sm.name = m.name || "mesh";
      if (m.morphTargetDictionary) { sm.morphTargetDictionary = { ...m.morphTargetDictionary }; sm.morphTargetInfluences = m.morphTargetInfluences.map(() => 0); }
      root.add(sm);
      sm.bind(skeleton, new THREE.Matrix4());
    }
    // IK chains for the ends of the limbs: saved with the model so the app knows them too
    const ik = [];
    for (const j of order) {
      if (kids.get(j).length || !j.parent) continue;
      const eff = /hand_end|toe|tail_end|ear_end/i.test(j.name) ? j.parent : j;      // the hand, foot, tail tip
      const links = [];
      let p = eff.parent;
      const want = /tail|ear/i.test(eff.name) ? 3 : 2;
      while (p && links.length < want) { links.push(p.name); p = p.parent; }
      if (links.length >= 1) ik.push({ effector: eff.name, links });
    }
    root.userData.ik = ik;
    root.userData.rigger = { version: 1, joints: order.length };
    return { root, skeleton, ik };
  }

  /** drag hands/feet and the chain bends to follow (CCD IK) */
  poseMode() {
    let built;
    try { built = this._buildRig(); } catch (err) { return this.toast(err.message); }
    this.mode = "pose";
    this.scene.remove(this.model);
    this.jointsGroup.visible = false;
    this.preview = built;
    this.scene.add(built.root);
    built.root.updateMatrixWorld(true);
    const byName = (n) => built.skeleton.bones.find((b) => b.name === n);
    this.ikTargets = built.ik.map(({ effector, links }) => {
      const eff = byName(effector);
      const handle = new THREE.Mesh(new THREE.OctahedronGeometry(this.unit * 0.025), new THREE.MeshBasicMaterial({ color: 0x59e0a0, depthTest: false }));
      handle.renderOrder = 11;
      handle.position.copy(eff.getWorldPosition(new THREE.Vector3()));
      this.scene.add(handle);
      return { eff, links: links.map(byName).filter(Boolean), handle };
    });
    this.rest = built.skeleton.bones.map((b) => b.quaternion.clone());
    this.tools([
      { label: "↺ Reset pose", click: () => { built.skeleton.bones.forEach((b, i) => b.quaternion.copy(this.rest[i])); built.root.updateMatrixWorld(true); for (const t of this.ikTargets) t.handle.position.copy(t.eff.getWorldPosition(new THREE.Vector3())); } },
      { label: "← Back to joints", click: () => this._leavePose() },
      { label: "💾 Save rig", click: () => { this._leavePose(); this.save(); } },
    ]);
    this.hint("IK is on: drag the green handles (hands, feet, tail) and the arm, leg or tail bends to follow. If the mesh tears, go back and move the joints.");
  }
  _leavePose() {
    if (this.preview) this.scene.remove(this.preview.root);
    for (const t of this.ikTargets || []) this.scene.remove(t.handle);
    this.preview = null; this.ikTargets = [];
    this.scene.add(this.model);
    this.jointsGroup.visible = true;
    this._afterRig();
  }
  _solveIK() {
    const q = new THREE.Quaternion(), inv = new THREE.Matrix4(), e = new THREE.Vector3(), t = new THREE.Vector3();
    for (const T of this.ikTargets) {
      for (let it = 0; it < 8; it++) {
        for (const link of T.links) {
          inv.copy(link.matrixWorld).invert();
          T.eff.getWorldPosition(e).applyMatrix4(inv);
          t.copy(T.handle.position).applyMatrix4(inv);
          if (e.lengthSq() < 1e-12 || t.lengthSq() < 1e-12) continue;
          q.setFromUnitVectors(e.normalize(), t.normalize());
          link.quaternion.multiply(q);
          link.updateMatrixWorld(true);
        }
      }
    }
  }

  // ---------- saving ----------
  async save() {
    let built;
    try { built = this._buildRig(); } catch (err) { return this.toast(err.message); }
    this.busy("Saving the rigged model…");
    try {
      const name = await this._export(built.root, [], this.file.replace(/\.(glb|gltf|vrm)$/i, "") + "-rigged.glb");
      this.busy(null);
      this.onSaved(name);
      this.file = name;
      this.$(".rig-title span").textContent = name;
      const next = await this.ask(`Saved as ${name} ✓ It can move now. Do you want UniMate to make its animations (standing, walking, waving…)?`,
        [["anim", "🎬 Animate it"], ["done", "Not now"]]);
      if (next === "anim") this.animatePanel(name); else this.close();
    } catch (err) {
      this.busy(null);
      this.toast(`Couldn't save: ${err.message || err}`);
    }
  }

  async _export(root, animations, name) {
    const buf = await new GLTFExporter().parseAsync(root, { binary: true, animations, onlyVisible: false });
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const res = await this.api.save_rigged_model(name, btoa(s));
    if (res?.error) throw new Error(res.error);
    return res.name;
  }

  // ---------- UniMate ----------
  async animatePanel(name) {
    this.mode = "animate";
    this.tools([{ label: "✓ Done", click: () => this.close() }]);
    const st = await this.api.unimate_status();
    const side = this.$(".rig-side");
    side.hidden = false;
    side.innerHTML = `<h3>🎬 Animate</h3>
      <button type="button" class="primary rig-talk">🗣 Automatic talking animation</button>
      <p class="note">Made right away, no UniMate needed: while she speaks her head nods and tilts, the jaw moves (if the rig has one) and her hands gesture. Her textures stay as they are.</p>
      <h3>With UniMate</h3>
      <p class="note">${st.ready ? "Tick what it should learn to do. Each one takes a little while; it runs in the background." : st.hint}</p>
      ${(st.commands || []).map((c) => `<pre class="rig-cmd" title="Click to copy">${c.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`).join("")}
      ${st.commands?.length ? `<p class="note">Then close and open this box again.</p>` : ""}
      <div class="rig-motions">${MOTIONS.map(([k, label], i) => `<label class="rig-check"><input type="checkbox" value="${k}" ${i < 3 ? "checked" : ""}> ${label}</label>`).join("")}</div>
      <p class="note">Ears and fingers are moved by the app itself, so you don't need animations for those.</p>
      <button type="button" class="primary rig-make">Make the animations</button>`;
    side.querySelector(".rig-talk").addEventListener("click", () => this.autoTalk(name));
    side.querySelectorAll(".rig-cmd").forEach((pre) => pre.addEventListener("click", () => {
      navigator.clipboard?.writeText(pre.textContent).then(() => this.toast("Copied - paste it into a Command Prompt."), () => {});
    }));
    side.querySelector(".rig-make").addEventListener("click", async () => {
      if (!(await this.api.unimate_status()).ready) {          // not ready yet: say what's missing and get it now
        const r = await this.api.unimate_setup();
        if (r.ready) return this.animatePanel(name);
        if (r.commands?.length) return this.toast("Almost there: run the two commands shown above in a Command Prompt, then open this box again.");
        return this.toast(r.hint || "Getting UniMate ready…", 9000);
      }
      const picked = [...side.querySelectorAll("input:checked")].map((x) => x.value);
      if (!picked.length) return this.toast("Tick at least one.");
      side.hidden = true;
      this.busy("Getting UniMate ready…", 0);
      const res = await this.api.unimate_animate(name, picked);
      if (res?.error) { this.busy(null); this.toast(res.error); side.hidden = false; }
      this._animName = name;
    });
  }

  /** the automatic talk clip (ui/talkanim.js): added to the model's own animations and saved as <name>-animated.glb */
  async autoTalk(name) {
    this.busy("Making the talking animation…", 0.5);
    try {
      const g = await new GLTFLoader().loadAsync(`models/${encodeURIComponent(name)}`);
      const clip = makeTalkClip(g.scene);
      if (!clip) throw new Error("this rig has no head, neck or arm bones to move");
      const clips = g.animations.filter((a) => a.name.toLowerCase() !== "talk").concat(clip);
      const ik = this.gltf?.scene.userData?.ik;
      if (ik) g.scene.userData.ik = ik;
      const out = /-animated\.glb$/i.test(name) ? name : name.replace(/(-rigged)?\.(glb|gltf)$/i, "") + "-animated.glb";
      const saved = await this._export(g.scene, clips, out);
      this.busy(null);
      this.onSaved(saved, true);                                  // the character switches to it and is saved
      this.toast(`Talking animation added ✓ (${talkBones(g.scene).length} bones move while she speaks).`);
      this.close();
    } catch (err) {
      this.busy(null);
      this.toast(`Couldn't make the talking animation: ${err.message || err}`);
    }
  }

  /** events from Python while UniMate works */
  async onEvent(e) {
    if (e.type !== "animate_progress" || this.mode !== "animate") return;
    if (e.error) {
      this.busy(null);
      this.toast(`UniMate didn't finish: ${e.error}${e.log ? `
(The whole story is in ${e.log})` : ""}`, 12000);
      this.$(".rig-side").hidden = false;
      return;
    }
    if (!e.done) return this.busy(e.text, e.pct);
    this.busy("Putting the animations into the model…", 0.97);
    try {
      const name = await this._merge(e.outputs, this._animName);
      this.busy(null);
      this.onSaved(name, true);                                   // true: the character switches to it and is saved
      this.toast(`Animated ✓ ${e.outputs.length} animation${e.outputs.length > 1 ? "s" : ""} added (${e.outputs.map((o) => o.clip).join(", ")}). Try them in Test animations.`);
      this.close();
    } catch (err) {
      this.busy(null);
      this.toast(`Couldn't add the animations: ${err.message || err}`);
    }
  }

  /** UniMate gives one animated GLB per motion, all on the same rig: keep the first, add the other clips to it */
  async _merge(outputs, name) {
    const loader = new GLTFLoader();
    let base = null;
    const clips = [];
    for (const { clip, url } of outputs) {
      const g = await loader.loadAsync(url);
      if (!base) base = g;
      const a = g.animations[0];
      if (!a) continue;
      a.name = clip;
      clips.push(a);
    }
    if (!base) throw new Error("UniMate didn't make any animations");
    inPlace(clips);                                   // the walk is saved in place, so it loops smoothly
    const ik = this.gltf.scene.userData?.ik;
    if (ik) base.scene.userData.ik = ik;
    return this._export(base.scene, clips, name.replace(/(-rigged)?\.glb$/i, "") + "-animated.glb");
  }
}
