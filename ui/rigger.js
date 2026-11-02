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
import { analyzeRig, cleanClips, retargetClip, rigRegions, scanSummary, looksLikeMonster, useOwnClips, bodyOf, FLOATING } from "./rigparts.js";
import { faceReport } from "./facetex.js";

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
  ["talk", "Talking (made right away, no UniMate)", ""],
  ["happy", "Happy", "An object bounces happily in place."],
  ["dance", "Dancing", "An object dances in place."],
  ["cheer", "Cheering", "An object cheers with its arms raised."],
  ["jump", "Jumping", "An object jumps in place."],
  ["sad", "Sad", "An object hangs its head sadly."],
  ["sit", "Sitting", "An object sits down and stays seated."],
];
// Gym → "Demo" plays these while you train (same keys as skills/animate.py PROMPTS and gymlife.py DEMOS)
export const GYM_MOTIONS = [
  ["squat", "Squats", "An object does bodyweight squats, bending the knees and standing back up."],
  ["lunge", "Lunges", "An object does forward lunges, alternating legs."],
  ["deadlift", "Deadlift (hip hinge)", "An object bends at the hips with a flat back and stands up tall, like a deadlift."],
  ["pushup", "Push-ups", "An object does push-ups on the floor."],
  ["curl", "Bicep curls", "An object does bicep curls with both arms."],
  ["row", "Rows / pulls", "An object pulls both arms back to the chest, like a rowing exercise."],
  ["press", "Overhead press", "An object pushes both hands straight up overhead and lowers them, like a shoulder press."],
  ["plank", "Plank", "An object holds a plank on the floor."],
  ["jumping_jacks", "Jumping jacks", "An object does jumping jacks."],
];

// Body type -> Monster (same keys as skills/animate.py PROMPTS and MONSTER_NAMES in ui/rigparts.js)
export const MONSTER_MOTIONS = [
  ["fly", "Flying"], ["hover", "Hovering"], ["float", "Floating"], ["glide", "Gliding"], ["roar", "Roaring"], ["stomp", "Stomping"],
  ["claw", "Claw swipe"], ["bite", "Biting"], ["tail_swing", "Tail swing"], ["wing_flap", "Wing flap"], ["breathe_fire", "Breathing fire"],
  ["crawl", "Crawling"], ["prowl", "Prowling"], ["charge", "Charging"], ["hurt", "Hurt"], ["faint", "Faint"],
];

// "hand.L", "hand_l", and "handL" (a rig loaded back from a .glb: three.js drops the dots)
const SIDE = (name) => (/[._]L$/i.test(name) || /[a-z0-9]L$/.test(name) ? 1 : /[._]R$/i.test(name) || /[a-z0-9]R$/.test(name) ? -1 : 0);
const OTHER = (name) => /[._][LR]$/i.test(name) ? name.replace(/([._])([LR])$/i, (m, d, s) => d + (s === "L" ? "R" : s === "l" ? "r" : s === "R" ? "L" : "l"))
  : /[a-z0-9][LR]$/.test(name) ? name.slice(0, -1) + (name.endsWith("L") ? "R" : "L")
  : name.replace(/Left|Right|left|right/, (w) => ({ Left: "Right", Right: "Left", left: "right", right: "left" })[w]);
const IS_TIP = /(_end|^toe|tail_end)/i;
// finding joints by what they are, whatever the rig calls them (Rigify "hand.L", Mixamo "mixamorig:LeftHand"…)
const plain = (name) => String(name || "").replace(/^mixamorig\d*:?/i, "").toLowerCase();
const sideOf = (name) => SIDE(name) || (/left/i.test(name) ? 1 : /right/i.test(name) ? -1 : 0);
const IS_FINGER = /finger|thumb|index|middle|ring|pinky|little|^f_/;
const IS_HAND = (n) => /hand|wrist/.test(n) && !/end|finger|thumb|index|middle|ring|pinky|little|^f_/.test(n);
const IS_KNEE = (n) => /shin|knee|calf|lowerleg/.test(n) || (/leg$/.test(n) && !/up/.test(n));
const IS_UPPER_ARM = (n) => /upper_?arm|^(left|right)arm$/.test(n);
const isUnder = (j, top) => { for (let p = j.parent; p; p = p.parent) if (p === top) return true; return false; };
// hair and cloth chains sit right on the surface: they only take the vertices that are clearly theirs
const CLOTH_NAME = /hair|skirt|cape|cloth|dress|coat/i;
// the dots: hands blue, hair green, clothes red, so you can tell them apart (on any rig, made here or not)
const COLORS = { hands: 0x3d8bff, hair: 0x3ddc6b, clothes: 0xff3b3b, face: 0xff9ecb, helper: 0x76808f };
const BODY_COLOR = 0xffc44d, TIP_COLOR = 0xfff1c9, SELECTED_COLOR = 0xff5cf0;
const dotColor = (name, region) => COLORS[region] ?? (IS_TIP.test(name) ? TIP_COLOR : BODY_COLOR);
// no IK handles for fingers, hair and cloth (the room moves those itself)
const NO_IK = /finger|thumb|index|middle|ring|pinky|little|^f_|hair|skirt|cape|cloth|dress|coat/i;

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
  constructor(file, { api, toast, fromImport = false, onSaved = () => {}, show = false }) {
    Object.assign(this, { file, api, toast, fromImport, onSaved, showFirst: show });
    this.joints = [];        // {name, parent (joint or null), pos (Vector3), mesh (the sphere)}
    this.mode = "look";      // look | edit | place | pose | animate
    this.mirror = true;
    this.selected = null;
    this.chainFrom = null;
    this.snap = "";          // "" free, or the axis a dragged joint keeps to: "x", "y", "z"
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
      <div class="rig-legend" hidden></div>
      <div class="rig-ask" hidden><p></p><div class="rig-ask-btns"></div></div>
      <div class="rig-hint"></div>
      <div class="rig-busy" hidden><p></p><div class="clone-bar"><i></i><span></span></div><small class="rig-left"></small><button type="button" class="ghost small rig-cancel" hidden>Cancel</button></div>`;
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
      if (this.mode === "edit" && /^[xyz]$/i.test(e.key) && !e.ctrlKey) { this.setSnap(e.key.toLowerCase()); return; }
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

  busy(text, pct = null, left = null, cancel = null) {
    const b = this.$(".rig-busy");
    b.hidden = text == null;
    const c = b.querySelector(".rig-cancel");
    c.hidden = !cancel;
    c.onclick = cancel;
    b.querySelector(".rig-left").textContent = left == null ? "" : left < 90 ? "About a minute left" : `About ${Math.round(left / 60)} minutes left`;
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
    this.model.traverse((o) => { if (o.isMesh) { this.meshes.push(o); o.material = [].concat(o.material).map((m) => { const c = m.clone(); c.side = THREE.DoubleSide; Object.assign(c.userData, { side: m.side, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }); return c; }); if (o.material.length === 1) o.material = o.material[0]; } });

    const bones = [];
    this.model.traverse((o) => { if (o.isBone) bones.push(o); });
    if (bones.length) {
      const anims = this.gltf.animations.length;
      const info = analyzeRig(this.model);
      const scan = `${scanSummary(info)} ${faceReport(this.model, info)}`;
      if (!this.showFirst) {
        const go = await this.ask(`This model already has a rig inside it (${bones.length} bones${anims ? `, ${anims} animation${anims > 1 ? "s" : ""}` : ""}). ${scan} Do you want to see it, or is it okay as it is?`,
          [["view", "Show me the rig"], ["keep", "It's okay as it is"]]);
        if (go === "keep") return this.fromImport ? this.close() : this.existingMode();
      }
      this.showExisting(bones);
      const del = await this.ask(`This is the rig (${bones.length} bones; the dots are its joints). ${scan} Keep it, make it simpler, edit it (move, add or delete joints), or delete it and rig the model yourself?`,
        [["keep", "Keep this rig"], ["simplify", "✂ Simplify"], ["edit", "✏️ Edit this rig"], ["delete", "Delete it and rig it myself"]]);
      if (del === "keep") return this.existingMode();
      if (del === "simplify") return this.simplify();
      if (del === "edit") return this.editExisting();
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
    const info = analyzeRig(this.model), regions = rigRegions(info);
    const region = (b) => { const k = info.kind.get(b); return regions.get(b) || (k === "helper" ? "helper" : k === "face" || k === "jaw" ? "face" : undefined); };
    for (const b of bones) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(region(b) === "helper" ? r * 0.55 : r, 10, 8), new THREE.MeshBasicMaterial({ color: dotColor(b.name, region(b)), depthTest: false, transparent: true }));
      s.renderOrder = 10;
      s.position.copy(b.getWorldPosition(new THREE.Vector3()));
      this.jointsGroup.add(s);
    }
    this._legend(bones.map(region));
    this._ghost(true);
    this.hint("Drag to look around. Scroll to zoom.");
  }

  /** the colour key, with how many joints of each there are */
  _legend(regions) {
    const box = this.$(".rig-legend");
    const count = (k) => regions.filter((r) => r === k).length;
    const row = (hex, label, n) => `<span><i style="background:#${hex.toString(16).padStart(6, "0")}"></i>${label} <b>${n}</b></span>`;
    box.innerHTML = row(COLORS.hands, "Hands", count("hands")) + row(COLORS.hair, "Hair", count("hair")) + row(COLORS.clothes, "Clothes", count("clothes")) +
      (count("face") ? row(COLORS.face, "Face", count("face")) : "") + (count("helper") ? row(COLORS.helper, "Helpers", count("helper")) : "") +
      row(BODY_COLOR, "Body", regions.filter((r) => !COLORS[r]).length);
    box.hidden = false;
  }

  /** work out what every joint is, the same way a saved rig is read (ui/rigparts.js), and colour the dots */
  _recolor() {
    const root = new THREE.Group();
    const bones = new Map();
    const made = (j) => {
      if (bones.has(j)) return bones.get(j);
      const b = new THREE.Bone();
      b.name = j.name.replace(/[.:/[\]]/g, "");     // as three.js will read it back from the saved file
      (j.parent ? made(j.parent) : root).add(b);
      bones.set(j, b);
      return b;
    };
    this.joints.forEach(made);
    const regions = rigRegions(analyzeRig(root));
    for (const j of this.joints) {
      j.region = regions.get(bones.get(j));
      j.mesh.material.color.setHex(j === this.selected ? SELECTED_COLOR : dotColor(j.name, j.region));
    }
    this._legend(this.joints.map((j) => j.region));
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
      { label: "✂ Simplify", title: "a copy with only the bones that matter: helpers, unused bones and face detail go, the body, jaw, tail and wings stay", click: () => this.simplify() },
      { label: "✏️ Edit this rig", title: "turn its bones into dots you can move, add to or delete", click: () => this.editExisting() },
      { label: "✓ Done", click: () => this.close() },
    ]);
    this.hint("This rig stays as it is. You can have UniMate make animations for it.");
  }

  /** Too many bones (Piccolo has 587): a copy with the ones that matter. The skin of each removed bone goes to the bone it hung from,
   *  so the model looks the same and still moves; the new rig opens right away so you can see it. */
  async simplify() {
    this.busy("Taking the extra bones off…");
    const res = await this.api.simplify_rig(this.file);
    this.busy(null);
    if (res?.error) { this.toast(res.error); return this.existingMode(); }
    if (res.after >= res.before) { this.toast("This rig is as simple as it gets: nothing to take off."); return this.existingMode(); }
    this.toast(`Simplified: ${res.before} → ${res.after} bones. Saved as ${res.name}.`, 7000);
    this.onSaved(res.name);
    openRigger(res.name, { api: this.api, toast: this.toast, onSaved: this.onSaved, show: true });
  }

  /** the rig that's there becomes joints you can drag, rename, delete or add to (+ hair, clothes, hands).
   *  Saving skins the mesh again with the app's own weights; the old animations go (UniMate remakes them). */
  editExisting() {
    this.$(".rig-side").hidden = true;
    this.model.updateMatrixWorld(true);
    const bones = [];
    this.model.traverse((o) => { if (o.isBone) bones.push(o); });
    const at = new Map(bones.map((b) => [b, b.getWorldPosition(new THREE.Vector3())]));
    this.stripRig();
    this.clearJoints();
    const J = new Map();
    for (const b of bones) {                          // traverse order: a parent always comes before its children
      let p = b.parent;
      while (p && !p.isBone) p = p.parent;
      J.set(b, this.addJoint(b.name || `bone_${String(J.size).padStart(2, "0")}`, (p && J.get(p)) || null, at.get(b)));
    }
    this._afterRig();
    this.toast(`${bones.length} joints ready to edit. Save rig when you're done (the old animations are dropped; UniMate can make new ones).`, 8000);
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
    this._tris = null;                                  // the cross-section cache was of the old meshes
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
  /** the mesh's outline at height f (fraction of the model's height), from the triangles crossing it: reliable
   *  even on low-poly models, where a thin slice often holds no vertices at all */
  _section(f, filter) {
    if (!this._tris) {
      const list = [], p = new THREE.Vector3();
      for (const m of this.meshes) {
        const pos = m.geometry.attributes.position, idx = m.geometry.index, n = idx ? idx.count : pos.count;
        const step = Math.max(1, Math.floor(n / 3 / 150000)) * 3;
        for (let i = 0; i + 2 < n; i += step) for (let k = 0; k < 3; k++) {
          p.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
          list.push(p.x, p.y, p.z);
        }
      }
      this._tris = new Float32Array(list);
    }
    const T = this._tris, Y = this.box.min.y + f * this.size.y, out = [];
    for (let i = 0; i < T.length; i += 9) for (let k = 0; k < 3; k++) {
      const a = i + k * 3, b = i + ((k + 1) % 3) * 3;
      if ((T[a + 1] - Y) * (T[b + 1] - Y) >= 0) continue;
      const s = (Y - T[a + 1]) / (T[b + 1] - T[a + 1]);
      const q = new THREE.Vector3(T[a] + (T[b] - T[a]) * s, Y, T[a + 2] + (T[b + 2] - T[a + 2]) * s);
      if (!filter || filter(q)) out.push(q);
    }
    return out;
  }
  /** the middle of a cross-section's bounding box */
  _mid(pts) {
    if (pts.length < 3) return null;
    const b = new THREE.Box3().setFromPoints(pts);
    return b.getCenter(new THREE.Vector3());
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
    const H = this.size.y, y = (f) => this.box.min.y + f * H, cx = J.spine.pos.x;
    const near = (p) => Math.abs(p.x - cx) < H * 0.2;
    // the neck: going up from the chest, the narrowest slice before it widens again into the head
    // (so spiky hair or a hat on top don't fool it)
    let neck = null;
    if (J.head && J["spine.003"] && J["spine.004"]) {
      let best = null;
      for (let f = v(J["spine.003"]); f < 0.95; f += 0.005) {
        const pts = this._section(f, (p) => Math.abs(p.x - cx) < H * 0.15);
        if (pts.length < 4) continue;
        const w = this._spread(pts);
        if (!best || w < best.w) best = { f, w };
        else if (w > best.w * 1.4 && best.w < H * 0.12) { neck = best.f; break; }
      }
      if (neck && neck > v(J["spine.003"]) + 0.02) {
        J.head.pos.y = y(neck + 0.01);
        J["spine.004"].pos.y = (J["spine.003"].pos.y + J.head.pos.y) / 2;
        for (const s of ["L", "R"]) for (const n of [`shoulder.${s}`, `upper_arm.${s}`]) if (J[n]) J[n].pos.y = Math.min(J[n].pos.y, y(neck - 0.035));
      } else neck = null;
    }
    // the crotch: going down from the waist, the first height where there's a gap between the legs. Shorts or a
    // coat sewn shut at the middle have no gap until their hem, so the height has to make sense for a body
    // (the crotch is roughly 0.42-0.68 of the neck's height); if it doesn't, it's worked out from the neck.
    let crotch = null;
    for (let f = 0.6; f > 0.28; f -= 0.005) {
      const pts = this._section(f, near);
      if (pts.length < 4) continue;
      if (!pts.some((p) => Math.abs(p.x - cx) < H * 0.012)) { crotch = f + 0.005; break; }
    }
    if (neck && (!crotch || crotch < neck * 0.42 || crotch > neck * 0.68)) crotch = neck * 0.55;
    if (crotch) {
      const legs = [];
      for (const s of ["L", "R"]) legs.push(J[`thigh.${s}`], J[`shin.${s}`], J[`foot.${s}`]);
      if (legs.every(Boolean)) {
        J.spine.pos.y = y(crotch + 0.04);
        for (const s of ["L", "R"]) {
          const th = J[`thigh.${s}`], sh = J[`shin.${s}`], ft = J[`foot.${s}`];
          th.pos.y = y(crotch + 0.02);
          sh.pos.y = ft.pos.y + (th.pos.y - ft.pos.y) * 0.47;     // the knee: a little below half way down the leg
        }
      }
    }
    // the spine evenly from the hips to the chest
    const sp = ["spine", "spine.001", "spine.002", "spine.003"].map((n) => J[n]);
    if (sp.every(Boolean) && sp[3].pos.y > sp[0].pos.y) for (let i = 1; i < 3; i++) sp[i].pos.y = THREE.MathUtils.lerp(sp[0].pos.y, sp[3].pos.y, i / 3);
    for (const n of ["spine", "spine.001", "spine.002", "spine.003", "spine.004", "head"]) {
      const j = J[n]; if (!j) continue;
      const c = this._mid(this._section(v(j), (p) => Math.abs(p.x - j.pos.x) < Math.min(this.size.x * 0.15, H * 0.1)));
      if (c) { j.pos.x = c.x; j.pos.z = c.z; }
    }
    for (const s of ["L", "R"]) {
      const sign = s === "L" ? 1 : -1;
      for (const n of [`thigh.${s}`, `shin.${s}`, `foot.${s}`]) {
        const j = J[n]; if (!j) continue;
        const side = (p) => (p.x - J.spine.pos.x) * sign > this.size.x * 0.02 && Math.abs(p.x - J.spine.pos.x) < Math.min(this.size.x * 0.3, H * 0.2);
        // the middle of the leg's cross-section (feet: the ankle, a little above the sole)
        const c = this._mid(this._section(n.startsWith("foot") ? Math.max(v(j), 0.04) : v(j), side)) || this._centroid(this._slab(v(j), 0.025, side));
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

  clearJoints() { this.joints = []; this.jointsGroup.clear(); this.selected = this.chainFrom = null; this.$(".rig-legend").hidden = true; }

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
    this._colorsDirty = true;
    return j;
  }

  deleteJoint(j) {
    for (const c of this.joints) if (c.parent === j) c.parent = j.parent;
    this.joints = this.joints.filter((x) => x !== j);
    this.jointsGroup.remove(j.mesh);
    if (this.selected === j) this.select(null);
    if (this.chainFrom === j) this.chainFrom = j.parent;
    this._colorsDirty = true;
  }

  /** lines from each joint to its parent */
  _updateLines() {
    if (this._colorsDirty) { this._colorsDirty = false; this._recolor(); }
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
    if (this.selected) this.selected.mesh.material.color.setHex(dotColor(this.selected.name, this.selected.region));
    this.selected = j;
    if (j) j.mesh.material.color.setHex(SELECTED_COLOR);
    this._renderEditTools();
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "place") {
      this.chainFrom = this.selected;
      this.placing = null;
      this.hint("Click on the model to place a joint. Each click adds a bone from the last joint. Click an existing dot to branch from it. Press Exit (or Esc) when done.");
      this.tools([
        { label: "⏹ Exit placing", on: true, click: () => this.setMode("edit") },
        { label: "↶ Remove last", click: () => { const last = this.joints.at(-1); if (last) this.deleteJoint(last); } },
      ]);
    } else if (mode === "edit") {
      this.placing = null;
      if (!this.joints.length) return this.chooseRig();
      this._afterRig();
    }
  }

  /** place hair or clothes bones by hand: each click on the model adds a joint to the strand, and "New strand" starts
   *  another one. A strand is attached by itself to the head (hair) or to the nearest body bone (clothes). With Mirror
   *  on, a strand on one side is copied to the other side as you click. */
  placeChains(kind) {
    this.mode = "place";
    this.select(null);
    const label = kind === "hair" ? "Hair" : "Clothes";
    this.placing = { prefix: kind === "hair" ? "hair" : "cloth", strand: 0 };
    this._newStrand();
    this.hint(`Click along the ${label.toLowerCase()} from where it's attached down to its tip: each click adds a joint. Press New strand for the next one, and Done when you've finished.`);
    this.tools([
      { label: "⏹ Done", on: true, click: () => this.setMode("edit") },
      { label: "➕ New strand", click: () => this._newStrand() },
      { label: "↶ Remove last", click: () => this._removeLastPlaced() },
    ]);
  }

  _newStrand() {
    const p = this.placing;
    p.strand++;
    while (this.joints.some((j) => j.name.startsWith(`${p.prefix}_${p.strand}.`))) p.strand++;   // keep the ones already there
    p.count = 0;
    this.chainFrom = p.twinFrom = null;
    this.toast(`Strand ${p.strand}: click where it starts.`, 2500);
  }

  /** what a new strand hangs from */
  _anchorFor(pos) {
    if (this._colorsDirty) { this._colorsDirty = false; this._recolor(); }    // a strand never hangs from another strand
    if (this.placing.prefix === "hair") {
      const head = this._role((n) => /head/.test(n) && !/end|top|hair/.test(n));
      if (head) return head;
    }
    let best = null, d = Infinity;
    for (const j of this.joints) {
      const n = plain(j.name);
      if (j.region || IS_TIP.test(j.name) || /thigh|upleg|leg|knee|shin|calf|foot|toe/.test(n)) continue;
      const x = j.pos.distanceToSquared(pos);
      if (x < d) { d = x; best = j; }
    }
    return best;
  }

  /** one click while placing hair or clothes */
  _placeChainJoint(p) {
    const P = this.placing, cx = (this.box.min.x + this.box.max.x) / 2;
    const s = Math.abs(p.x - cx) > this.size.x * 0.03 ? (p.x > cx ? 1 : -1) : 0;
    if (!this.chainFrom) { this.chainFrom = this._anchorFor(p); P.side = s; P.twinFrom = this.chainFrom; }
    P.count++;
    const num = String(P.count).padStart(2, "0"), base = `${P.prefix}_${P.strand}.${num}`;
    const twin = this.mirror && P.side;                       // a strand on the middle line has no other side
    const j = this.addJoint(base + (twin ? (P.side === 1 ? ".L" : ".R") : ""), this.chainFrom, p);
    if (twin) P.twinFrom = this.addJoint(base + (P.side === 1 ? ".R" : ".L"), P.twinFrom, new THREE.Vector3(2 * cx - p.x, p.y, p.z));
    this.chainFrom = j;
    this.select(j);
  }

  _removeLastPlaced() {
    const P = this.placing;
    const last = this.joints.at(-1);
    if (!last || !last.name.startsWith(`${P.prefix}_`)) return;
    const mirrored = P.count && SIDE(last.name) ? this.joints.at(-2) : null;
    const stay = mirrored ? mirrored.parent : last.parent;
    this.deleteJoint(last);
    if (mirrored) { P.twinFrom = last.parent; this.deleteJoint(mirrored); }
    this.chainFrom = P.count > 1 ? stay : null;
    P.count = Math.max(0, P.count - 1);
    this.select(null);
  }

  _afterRig() {
    this.mode = "edit";
    this._ghost(true);
    this.hint("Drag a dot to move a joint. Click one to select it (rename or delete it). Then press Save rig.");
    this._renderEditTools();
  }

  /** the snap axis: pressing the one that's on turns it off */
  setSnap(axis) {
    this.snap = this.snap === axis ? "" : axis;
    this.toast(this.snap ? `Joints move along ${this.snap.toUpperCase()} only.` : "Joints move freely.", 2000);
    this._renderEditTools();
  }

  _renderEditTools() {
    if (this.mode !== "edit") return;
    const name = document.createElement("input");
    name.className = "rig-name"; name.placeholder = "click a joint"; name.disabled = !this.selected;
    name.value = this.selected?.name || "";
    name.addEventListener("change", () => { if (this.selected && name.value.trim()) { this.selected.name = name.value.trim(); this._colorsDirty = true; } });
    const mirror = document.createElement("label");
    mirror.className = "rig-check";
    mirror.innerHTML = `<input type="checkbox" ${this.mirror ? "checked" : ""}> Mirror left/right`;
    mirror.querySelector("input").addEventListener("change", (e) => { this.mirror = e.target.checked; });
    this.tools([
      { label: "✏️ Place bones", title: "add joints by clicking on the model", click: () => this.setMode("place") },
      { label: "🧍 Change preset", click: () => this.chooseRig() },
      { label: "✋ Hands", title: "add finger bones to both hands (5, 4 or 3 fingers) so hand poses work", click: () => this.addHands() },
      { label: "💇 Hair", title: "add hair strands that swing", click: () => this.addHair() },
      { label: "👗 Clothes", title: "add a skirt / dress or a cape that moves like cloth", click: () => this.addClothes() },
      name,
      { label: "🗑 Delete joint", click: () => this.selected && this.deleteJoint(this.selected) },
      mirror,
      ...["x", "y", "z"].map((a) => ({ label: `Snap ${a.toUpperCase()}`, on: this.snap === a, title: `drag joints along the ${a.toUpperCase()} axis only (or press ${a.toUpperCase()})`, click: () => this.setSnap(a) })),
      { label: "🦾 Test pose (IK)", title: "drag hands and feet to check the rig bends well", click: () => this.poseMode() },
      { label: "💾 Save rig", click: () => this.save() },
    ]);
  }

  // ---------- hands, hair, clothes: extra chains with the names ui/rigparts.js knows (fingers, soft bones) ----------
  /** the first joint whose plain name passes test, on side s (1 left, -1 right, 0 any) */
  _role(test, s = 0) {
    return this.joints.find((j) => test(plain(j.name)) && (!s || sideOf(j.name) === s)) || null;
  }
  /** delete the joints that pass test, and everything under them */
  _removeWhere(test) {
    const gone = (j) => { for (let x = j; x; x = x.parent) if (test(x)) return true; return false; };
    for (const j of this.joints.filter(gone)) { this.jointsGroup.remove(j.mesh); if (this.selected === j) this.selected = null; }
    this.joints = this.joints.filter((j) => !gone(j));
    this.chainFrom = null;
    this._colorsDirty = true;
  }
  /** a chain of joints through pts: name.01, name.02 … name_end (+ .L / .R) */
  _chain(prefix, sfx, parent, pts) {
    let p = parent;
    pts.forEach((pos, i) => { p = this.addJoint(i === pts.length - 1 ? `${prefix}_end${sfx}` : `${prefix}.${String(i + 1).padStart(2, "0")}${sfx}`, p, pos); });
  }
  /** mesh points (world space) within r of c */
  _near(c, r) {
    const out = [], p = new THREE.Vector3(), r2 = r * r;
    for (const m of this.meshes) {
      const pos = m.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 20000));
      for (let i = 0; i < pos.count; i += step) {
        p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (p.distanceToSquared(c) < r2) out.push(p.clone());
      }
    }
    return out;
  }

  /** finger chains on both hands, fitted to the mesh around each hand: the hand poses (relaxed, fist…) then work */
  async addHands() {
    const k = await this.ask("How many fingers on each hand? They're added to both hands; drag any dot that's off.",
      [["5", "5 fingers"], ["4", "4 (cartoon: 3 + thumb)"], ["3", "3 (2 + thumb)"], ["no", "Cancel"]]);
    if (k === "no") return;
    const n = +k, P = (sorted, f) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
    let done = 0;
    for (const s of [1, -1]) {
      const hand = this._role(IS_HAND, s);
      if (!hand) continue;
      const sfx = s === 1 ? ".L" : ".R";
      this._removeWhere((j) => j !== hand && IS_FINGER.test(plain(j.name)) && isUnder(j, hand));
      const kids = this.joints.filter((j) => j.parent === hand);
      const tip = kids.find((j) => /end/i.test(j.name)) || kids[0] || null;
      const d = tip ? tip.pos.clone().sub(hand.pos) : hand.parent ? hand.pos.clone().sub(hand.parent.pos) : new THREE.Vector3(s, 0, 0);
      const L = Math.max(tip ? d.length() : 0, this.size.y * 0.04);
      d.normalize();
      // across the palm = the world's front-back, square to the hand (the thumb is on the front side)
      const a = new THREE.Vector3(0, 0, 1).addScaledVector(d, -d.z);
      if (a.lengthSq() < 0.05) a.set(0, 1, 0).addScaledVector(d, -d.y);
      a.normalize();
      const pts = this._near(hand.pos, Math.max(L * 2.2, this.size.y * 0.09)).map((p) => p.sub(hand.pos))
        .filter((p) => p.dot(d) > 0 && p.clone().addScaledVector(d, -p.dot(d)).length() < L * 1.2);
      const along = pts.map((p) => p.dot(d)).sort((x, y) => x - y);
      const reach = THREE.MathUtils.clamp(along.length > 20 ? P(along, 0.97) : L * 1.6, L * 0.9, this.size.y * 0.14);
      const across = pts.filter((p) => p.dot(d) > reach * 0.55).map((p) => p.dot(a)).sort((x, y) => x - y);
      const lo = across.length > 10 ? P(across, 0.1) : -reach * 0.25, hi = across.length > 10 ? P(across, 0.9) : reach * 0.25;
      const w = THREE.MathUtils.clamp(hi - lo, reach * 0.25, reach * 0.7), mid = THREE.MathUtils.clamp((lo + hi) / 2, -reach * 0.2, reach * 0.2);
      const at = (t, off) => hand.pos.clone().addScaledVector(d, t).addScaledVector(a, off);
      const base = reach * 0.5, len = reach - base;
      const names = ["f_index", "f_middle", "f_ring", "f_pinky"].slice(0, n - 1);
      names.forEach((nm, i) => {                                    // the index finger is next to the thumb
        const off = mid + w * 0.9 * (0.5 - (i + 0.5) / names.length);
        this._chain(nm, sfx, hand, [0, 0.38, 0.7, 1].map((t) => at(base + len * t, off)));
      });
      const tb = at(reach * 0.12, mid + w * 0.45);
      const td = d.clone().multiplyScalar(0.55).addScaledVector(a, 0.85).normalize();
      this._chain("thumb", sfx, hand, [0, 0.38, 0.7, 1].map((t) => tb.clone().addScaledVector(td, reach * 0.5 * t)));
      // the hand's own bone now ends where the fingers start (its mesh is the palm, the fingers own theirs)
      if (tip && /end/i.test(tip.name)) { tip.pos.copy(at(base * 0.9, mid)); tip.mesh.position.copy(tip.pos); }
      done++;
    }
    this.select(null);
    this.toast(done ? `${n} fingers added to ${done === 2 ? "both hands" : "the hand"} ✓ Drag the dots onto the fingers, then Save rig.`
      : "Couldn't find the hands: select the wrist joints and name them hand.L and hand.R first.", 8000);
  }

  /** three hair strands from the back of the head (back, left, right), or placed by hand; they swing with springs */
  async addHair() {
    const k = await this.ask("How do you want to rig the hair?", [["preset", "✨ Use the preset"], ["place", "✏️ Place it myself"], ["no", "Cancel"]]);
    if (k === "no") return;
    if (k === "place") return this.placeChains("hair");
    const head = this._role((n) => /head/.test(n) && !/end|top|hair/.test(n));
    if (!head) return this.toast("Couldn't find the head: select the head joint and name it head first.");
    this._removeWhere((j) => /hair/i.test(j.name));
    const top = this.joints.find((j) => j.parent === head);
    const hh = Math.max(top ? top.pos.distanceTo(head.pos) : 0, this.size.y * 0.08);
    let back = head.pos.z;
    for (const p of this._near(head.pos.clone().add(new THREE.Vector3(0, hh * 0.4, 0)), hh * 0.7)) back = Math.min(back, p.z);
    back = Math.max(back, head.pos.z - hh * 0.9);
    const len = hh * 1.3, y0 = head.pos.y + hh * 0.2, z0 = back + hh * 0.12;
    const strand = (name, sfx, x) => this._chain(name, sfx, head, [0, 1 / 3, 2 / 3, 1].map((t) => new THREE.Vector3(x, y0 - len * t, z0 - hh * 0.15 * t)));
    strand("hair_back", "", head.pos.x);
    for (const s of [1, -1]) strand("hair_side", s === 1 ? ".L" : ".R", head.pos.x + s * hh * 0.42);
    this.select(null);
    this.toast("Hair added ✓ Drag the strands into the hair (longer hair: select the last dot, ✏️ Place bones, click further down).", 9000);
  }

  /** a skirt / dress (8 chains around the hips, down to the knees) or a cape (3 chains down the back) */
  async addClothes() {
    const k = await this.ask("How do you want to rig the clothes? Pick a preset or place the bones yourself.",
      [["skirt", "👗 Skirt / dress preset"], ["cape", "🦸 Cape / coat tail preset"], ["place", "✏️ Place it myself"], ["no", "Cancel"]]);
    if (k === "no") return;
    if (k === "place") return this.placeChains("clothes");
    const H = this.size.y, lerp = THREE.MathUtils.lerp;
    const hips = this._role((n) => /hips|pelvis/.test(n) || n === "spine") || this.joints.find((j) => !j.parent);
    if (!hips) return this.toast("Add a body rig first (Change preset → Biped).");
    const knee = this._role(IS_KNEE);
    const hemY = knee ? knee.pos.y : hips.pos.y - H * 0.25;
    const cx = hips.pos.x;
    const slab = (y, half) => this._slab((y - this.box.min.y) / H, 0.015, (q) => Math.abs(q.x - cx) < half);
    if (k === "skirt") {
      this._removeWhere((j) => /skirt/i.test(j.name));
      const ext = (y) => {
        const p = slab(y, H * 0.18);
        if (p.length < 8) return null;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
        return { rx: (x1 - x0) / 2, rz: (z1 - z0) / 2, cz: (z0 + z1) / 2 };
      };
      const w = ext(hips.pos.y - H * 0.02) || { rx: H * 0.09, rz: H * 0.07, cz: hips.pos.z };
      const h = ext(hemY + H * 0.02) || { rx: w.rx * 1.3, rz: w.rz * 1.3, cz: w.cz };
      const ring = [["skirt_front", 0, 0, 1], ["skirt_back", 0, 0, -1], ["skirt_side", 1, 1, 0], ["skirt_frontside", 1, 0.71, 0.71], ["skirt_backside", 1, 0.71, -0.71]];
      for (const [nm, mirrored, x, z] of ring) for (const s of mirrored ? [1, -1] : [0]) {
        this._chain(nm, s === 1 ? ".L" : s === -1 ? ".R" : "", hips, [0, 1 / 3, 2 / 3, 1].map((t) => new THREE.Vector3(
          cx + (s || 1) * x * lerp(w.rx, Math.max(h.rx, w.rx), t) * 0.92,
          lerp(hips.pos.y, hemY, t),
          lerp(w.cz, h.cz, t) + z * lerp(w.rz, Math.max(h.rz, w.rz), t) * 0.92)));
      }
      this.toast("Skirt added ✓ 8 chains from the waist to the knees: drag the bottom dots to the hem.", 8000);
    } else {
      this._removeWhere((j) => /cape/i.test(j.name));
      const arm = this._role(IS_UPPER_ARM);
      let chest = arm?.parent || null;
      while (chest && sideOf(chest.name)) chest = chest.parent;
      chest = chest || hips;
      const topY = arm ? arm.pos.y - H * 0.03 : hips.pos.y + H * 0.22;
      const backAt = (y) => { let z = hips.pos.z; for (const q of slab(y, H * 0.12)) z = Math.min(z, q.z); return z; };
      const zt = backAt(topY), zb = Math.min(backAt(hips.pos.y), zt);
      const half = arm ? Math.abs(arm.pos.x - cx) * 0.8 : H * 0.08;
      const strand = (sfx, x) => this._chain(sfx ? "cape" : "cape_mid", sfx, chest, [0, 1 / 3, 2 / 3, 1].map((t) => new THREE.Vector3(
        cx + x * lerp(1, 1.25, t), lerp(topY, hemY, t), lerp(zt, zb, Math.min(1, t * 1.5)) - H * (0.01 + 0.03 * t))));
      strand("", 0);
      strand(".L", half);
      strand(".R", -half);
      this.toast("Cape added ✓ 3 chains down the back: drag the bottom dots to where it ends.", 8000);
    }
    this.select(null);
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
      if (hit) {
        this.chainFrom = hit.userData.joint;
        if (this.placing) { this.placing.side = 0; this.placing.twinFrom = null; }    // a branch from one dot isn't copied
        this.select(this.chainFrom);
        return;
      }
      const p = this._pickInside(e);
      if (!p) return;
      if (this.placing) return this._placeChainJoint(p);
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
    if (this.snap) {                                     // only along that axis: the other two stay where they were when the drag began
      const from = this._drag.from ||= o.position.clone();
      for (const k of ["x", "y", "z"]) if (k !== this.snap) p[k] = from[k];
    }
    o.position.copy(p);
    const j = o.userData.joint;
    if (j) {
      j.pos.copy(p);
      if (this.mirror && sideOf(j.name)) {
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
      const cloth = CLOTH_NAME.test(j.name) ? 1.5 : 1;
      if (ch.length) for (const c of ch) segs.push({ bone: index.get(j), a: j.pos, b: c.pos, side: sideOf(j.name), cloth });
      else if (!j.parent) segs.push({ bone: index.get(j), a: j.pos, b: j.pos, side: sideOf(j.name), cloth });
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
        d *= s.cloth;
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
      const mats = [].concat(m.material).map((x) => { const c = x.clone(); c.side = x.userData.side ?? THREE.FrontSide; c.transparent = x.userData.transparent ?? false; c.opacity = x.userData.opacity ?? 1; c.depthWrite = x.userData.depthWrite ?? true; return c; });   // the see-through ones stay so (an iris saved solid is a black block)
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
      if (NO_IK.test(plain(eff.name))) continue;
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
    this.$(".rig-legend").hidden = true;
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
    this.$(".rig-legend").hidden = false;
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
      const name = await this._export(built.root, [], this.file.replace(/(-rigged|-animated)*\.(glb|gltf|vrm)$/i, "") + "-rigged.glb");
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
    this.$(".rig-legend").hidden = true;
    this.tools([{ label: "✓ Done", click: () => this.close() }]);
    const st = await this.api.unimate_status();
    const prev = await this.api.unimate_previous(name).catch(() => ({ outputs: [] }));
    const side = this.$(".rig-side");
    const bodyKey = `vermeil.body.${name.replace(/(-simple)?(-rigged)?(-animated)?\.(glb|gltf|vrm)$/i, "")}`;
    // what the model can already do: its own walk beats a made one, so those aren't ticked
    const scene = this.gltf?.scene, info = scene ? analyzeRig(scene) : null;
    const owned = info ? useOwnClips((this.gltf.animations || []).map((a) => ({ name: a.name, tracks: a.tracks })), info) : [];
    let body = (scene && bodyOf(scene)) || (info && looksLikeMonster(info) ? "monster" : "neutral");
    try { body = localStorage.getItem(bodyKey) || body; } catch {}
    side.hidden = false;
    side.innerHTML = `<h3>🎬 Animate</h3>
      ${prev.outputs?.length ? `<button type="button" class="primary rig-fix">✨ Fix my animations (${prev.outputs.map((o) => o.clip).join(", ")})</button>
      <p class="note">Puts the animations UniMate already made back on the model, cleaned: feet on the floor, arms hanging naturally, no jitter, fingers and hair/cloth handled by the app. No waiting for UniMate.</p>` : ""}
      <p class="note">${st.ready ? "Tick what she should learn to do. Talking is made right away; the others are made by UniMate in the background." : st.hint}</p>
      ${(st.commands || []).map((c) => `<pre class="rig-cmd" title="Click to copy">${c.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`).join("")}
      ${st.commands?.length ? `<p class="note">Then close and open this box again.</p>` : ""}
      ${owned.length ? `<p class="note">It came with its own animations, and they play as they are: ${owned.join(", ")}.</p>` : ""}
      <label class="rig-body">Body type
        <select>${[["neutral", "Neutral"], ["male", "Male"], ["female", "Female"], ["monster", "Monster"]].map(([k, l]) => `<option value="${k}" ${k === body ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      <p class="note">How they walk, stand and wave: a male walk is broader and heavier, a female one lighter with the hips swaying, a monster's low and lumbering.</p>
      <div class="rig-motions">${MOTIONS.map(([k, label], i) => `<label class="rig-check"><input type="checkbox" value="${k}" ${i < 3 && !owned.includes(k) ? "checked" : ""}> ${label}${owned.includes(k) ? " (has its own)" : ""}</label>`).join("")}</div>
      <button type="button" class="ghost rig-gym">🏋 Gym exercises</button>
      <div class="rig-motions rig-gym-list" hidden>${GYM_MOTIONS.map(([k, label]) => `<label class="rig-check"><input type="checkbox" value="${k}"> ${label}</label>`).join("")}</div>
      <p class="note rig-gym-note" hidden>In Gym, press 👯 Demo on an exercise and she does it next to you.</p>
      <button type="button" class="ghost rig-monster" ${body === "monster" ? "" : "hidden"}>🐉 Monster moves</button>
      <div class="rig-motions rig-monster-list" hidden>${MONSTER_MOTIONS.map(([k, label]) => `<label class="rig-check"><input type="checkbox" value="${k}" ${owned.includes(k) ? "disabled" : ""}> ${label}${owned.includes(k) ? " (has its own)" : ""}</label>`).join("")}</div>
      <p class="note rig-monster-note" hidden>Wings beat and flying moves leave the ground by themselves. Try them in Settings → Test.</p>
      <p class="note">UniMate only moves the body. Hands (their poses fit the finger count: 5, 4, 3 fingers or a paw), hair, clothes, tails and ears are moved by the app itself, so they swing naturally.</p>
      <button type="button" class="primary rig-make">Make the animations</button>`;
    // one press is enough: the button greys out at once and a second press while it works does nothing. It acts on
    // the pointer coming up over it (not only "click"): the button used to slide a little on hover, and a press that
    // ended a pixel off the moved button was no click at all - so it took two presses
    const once = (btn, fn) => {
      const run = async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        try { await fn(); } finally { btn.disabled = false; }
      };
      let down = false;
      btn.addEventListener("pointerdown", () => { down = true; });
      btn.addEventListener("pointerup", (e) => { if (down && e.button === 0) { down = false; run(); } });
      btn.addEventListener("pointerleave", () => { down = false; });
      btn.addEventListener("click", (e) => { if (e.detail === 0) run(); });        // keyboard (Enter / Space)
    };
    const fix = side.querySelector(".rig-fix");
    if (fix) once(fix, async () => {
      this.busy("Putting the animations back on the model, cleaned…", 0.5);
      try {
        const saved = await this._merge(prev.outputs, prev.model || name, false);
        this.busy(null);
        this.onSaved(saved, true);
        this.toast(`Fixed ✓ ${prev.outputs.length} animation${prev.outputs.length > 1 ? "s" : ""} cleaned (${this._lastReport || ""}). Try them in Settings → Test.`, 9000);
        this.close();
      } catch (err) {
        this.busy(null);
        this.toast(`Couldn't fix them: ${err.message || err}`);
      }
    });
    side.querySelector(".rig-gym").addEventListener("click", () => {       // show + tick every gym move
      side.querySelector(".rig-gym-list").hidden = false;
      side.querySelector(".rig-gym-note").hidden = false;
      side.querySelectorAll(".rig-gym-list input").forEach((x) => { x.checked = true; });
    });
    side.querySelector(".rig-monster").addEventListener("click", () => {   // show + tick every monster move
      side.querySelector(".rig-monster-list").hidden = false;
      side.querySelector(".rig-monster-note").hidden = false;
      side.querySelectorAll(".rig-monster-list input:not(:disabled)").forEach((x) => { x.checked = true; });
    });
    side.querySelector(".rig-body select").addEventListener("change", (e) => {
      const on = e.target.value === "monster";
      side.querySelector(".rig-monster").hidden = !on;
      if (!on) {
        side.querySelector(".rig-monster-list").hidden = side.querySelector(".rig-monster-note").hidden = true;
        side.querySelectorAll(".rig-monster-list input").forEach((x) => { x.checked = false; });
      }
    });
    side.querySelectorAll(".rig-cmd").forEach((pre) => pre.addEventListener("click", () => {
      navigator.clipboard?.writeText(pre.textContent).then(() => this.toast("Copied - paste it into a Command Prompt."), () => {});
    }));
    once(side.querySelector(".rig-make"), async () => {
      this.busy("Checking UniMate…", 0);
      const ready = (await this.api.unimate_status()).ready;
      this.busy(null);
      if (!ready) {          // not ready yet: say what's missing and get it now
        const r = await this.api.unimate_setup();
        if (r.ready) return this.animatePanel(name);
        return this.toast(r.hint || "Getting UniMate ready…", 9000);
      }
      const picked = [...side.querySelectorAll(".rig-motions input:checked")].map((x) => x.value);
      body = side.querySelector(".rig-body select").value;
      try { localStorage.setItem(bodyKey, body); } catch {}
      if (!picked.length) return this.toast("Tick at least one.");
      this._withTalk = picked.includes("talk");                   // made here, no UniMate needed
      const forUniMate = picked.filter((k) => k !== "talk");
      if (!forUniMate.length) return this.autoTalk(name);
      side.hidden = true;
      this.busy("Getting UniMate ready…", 0);
      const res = await this.api.unimate_animate(name, forUniMate, body);
      if (res?.error) { this.busy(null); this.toast(res.error); side.hidden = false; }
      this._animName = name;
      this._body = body;
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
    if (e.cancelled) {
      this.busy(null);
      this.toast("Stopped. Nothing was changed.");
      this.$(".rig-side").hidden = false;
      return;
    }
    if (!e.done) return this.busy(e.text, e.pct, e.left, async () => { this.busy("Stopping…", null); await this.api.unimate_cancel(); });
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

  /** UniMate gives one animated GLB per motion, made on its slimmed copy of the rig. The clips go back onto the
   *  ORIGINAL model (all its finger, hair and cloth bones kept) and are cleaned (ui/rigparts.js): body bones only,
   *  no jitter, feet on the floor, arms hanging naturally, seamless loops. + the talking clip when it was ticked. */
  async _merge(outputs, name, withTalk = this._withTalk) {
    const loader = new GLTFLoader();
    const base = await loader.loadAsync(`models/${encodeURIComponent(name)}`);
    const clips = [];
    for (const { clip, url } of outputs) {
      const g = await loader.loadAsync(url);
      const a = g.animations[0];
      if (!a) continue;
      const moved = retargetClip(a, g.scene, base.scene);
      moved.name = clip;
      clips.push(moved);
    }
    if (!clips.length) throw new Error("UniMate didn't make any animations");
    const info = analyzeRig(base.scene);
    if (this._body) base.scene.userData.body = this._body;  // the cleaning goes by it, here and each time the model loads
    const r = cleanClips(base.scene, clips.concat(base.animations.filter((a) => a.name !== "talk")), info);
    this._lastReport = `${r.dropped} shaky tracks removed, ${r.grounded} put back on the floor, ${r.arms} with relaxed arms`;
    inPlace(clips.filter((c) => !FLOATING.test(c.name)));   // the walk is saved in place, so it loops smoothly
    const keep = base.animations.filter((a) => !clips.some((c) => c.name === a.name) && (withTalk ? a.name !== "talk" : true));
    if (withTalk) { const talk = makeTalkClip(base.scene, info); if (talk) keep.push(talk); }
    const ik = this.gltf?.scene.userData?.ik;
    if (ik) base.scene.userData.ik = ik;
    return this._export(base.scene, keep.concat(clips), name.replace(/(-rigged)?(-animated)?\.glb$/i, "") + "-animated.glb");
  }
}
