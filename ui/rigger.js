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
import { analyzeRig, cleanClips, retargetClip, rigRegions, scanSummary, plainSurfaces, looksLikeMonster, useOwnClips, bodyOf, FLOATING, ITEM_NAME } from "./rigparts.js";
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
  ["front_thigh.L", "spine.003", 0.2, 0.58, 0.3], ["front_shin.L", "front_thigh.L", 0.2, 0.32, 0.31], ["front_foot.L", "front_shin.L", 0.2, 0.05, 0.31], ["front_toe_end.L", "front_foot.L", 0.2, 0.01, 0.38],      // four feet, no hands
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
// the dots: hands blue, feet teal, hair green, clothes red, so you can tell them apart (on any rig, made here or not)
const COLORS = { hands: 0x3d8bff, feet: 0x2fd3c4, ears: 0xc77dff, hair: 0x3ddc6b, clothes: 0xff3b3b, items: 0xff8c1a, face: 0xff9ecb, helper: 0x76808f };
const BODY_COLOR = 0xffc44d, TIP_COLOR = 0xfff1c9, SELECTED_COLOR = 0xff5cf0;
const dotColor = (name, region) => COLORS[region] ?? (IS_TIP.test(name) ? TIP_COLOR : BODY_COLOR);
// no IK handles for fingers, hair and cloth (the room moves those itself)
const NO_IK = /finger|thumb|index|middle|ring|pinky|little|^f_|hair|skirt|cape|cloth|dress|coat|^item/i;

// parts of a body, whatever the rig calls them (Rigify, Mixamo, game rips)
const PART = {
  upperArm: (n) => IS_UPPER_ARM(n) || /upper_?arm|^arm[._]?[lr]?$|(^|_)arm(_|$)/.test(n) && !/fore|lower/.test(n), forearm: (n) => /fore_?arm|lower_?arm/.test(n),
  thigh: (n) => /thigh|up_?leg|upper_?leg/.test(n) && !/front/.test(n), shin: (n) => (IS_KNEE(n) || /calf/.test(n)) && !/front/.test(n),
  frontThigh: (n) => /front_?thigh|front_?up|frontup/.test(n), frontShin: (n) => /front_?shin|front_?low|frontlow/.test(n),
  hips: (n) => /^spine$|^hips?$|pelvis|^root$/.test(n), chest: (n) => /spine\.?00[23]|chest|upper_?chest/.test(n), neck: (n) => /neck|spine\.?004/.test(n), head: (n) => /^head$|head[._]?$/.test(n) && !/end|top/.test(n),
  tail: (n) => /tail/.test(n) && !/end/.test(n), wing: (n) => /wing/.test(n), jaw: (n) => /jaw/.test(n),
};
// test poses: [part, side (1 left, -1 right, "both" mirrored, 0 any), world axis, degrees]. Sideways turns are mirrored for the right side
const POSES = {
  biped: {
    "Wave": [["upperArm", -1, "z", -150], ["forearm", -1, "z", -30], ["head", 0, "z", 8]],
    "Cheer": [["upperArm", "both", "z", 150], ["forearm", "both", "z", 20], ["head", 0, "x", -15]],
    "Sit": [["thigh", "both", "x", -90], ["shin", "both", "x", 90], ["upperArm", "both", "z", -70]],
    "Run": [["thigh", 1, "x", -55], ["shin", 1, "x", 70], ["thigh", -1, "x", 30], ["shin", -1, "x", 40], ["upperArm", 1, "x", 40], ["upperArm", -1, "x", -40], ["upperArm", "both", "z", -70], ["chest", 0, "x", 12]],
    "Think": [["upperArm", -1, "z", -60], ["upperArm", -1, "x", -40], ["forearm", -1, "x", -120], ["upperArm", 1, "z", -75], ["head", 0, "z", -12], ["head", 0, "x", 8]],
  },
  quadruped: {
    "Sit": [["hips", 0, "x", -35], ["thigh", "both", "x", -40], ["shin", "both", "x", 70], ["frontThigh", "both", "x", 35], ["head", 0, "x", -10]],
    "Lie down": [["frontThigh", "both", "x", -80], ["frontShin", "both", "x", 70], ["thigh", "both", "x", 80], ["shin", "both", "x", -60]],
    "Play bow": [["chest", 0, "x", 25], ["frontThigh", "both", "x", -60], ["head", 0, "x", -25], ["tail", 0, "x", -20]],
    "Rear up": [["hips", 0, "x", -50], ["frontThigh", "both", "x", -70], ["frontShin", "both", "x", 80], ["head", 0, "x", 20]],
    "Paw lift": [["frontThigh", 1, "x", -60], ["frontShin", 1, "x", 80], ["head", 0, "z", 15]],
  },
  monster: {
    "Roar": [["neck", 0, "x", -25], ["head", 0, "x", -30], ["jaw", 0, "x", 35], ["upperArm", "both", "z", 40], ["wing", "both", "z", 40]],
    "Crouch": [["hips", 0, "x", 20], ["thigh", "both", "x", -60], ["shin", "both", "x", 80], ["head", 0, "x", -10]],
    "Wings spread": [["wing", "both", "z", 55], ["upperArm", "both", "z", 60], ["head", 0, "x", -15]],
    "Tail whip": [["tail", 0, "y", 25], ["chest", 0, "y", -15], ["head", 0, "y", -20]],
    "Pounce": [["hips", 0, "x", -25], ["upperArm", "both", "x", -70], ["thigh", "both", "x", 30], ["jaw", 0, "x", 25]],
  },
};

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
    this.linkFrom = null;    // while linking: the joint the next click hangs from
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !/TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); this.undo(); return; }      // Ctrl+Z: one step back, in any mode
      if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (this.mode === "edit" && /^[xyz]$/i.test(e.key) && !e.ctrlKey) { this.setSnap(e.key.toLowerCase()); return; }
      if (e.key === "Escape") { if (this.mode === "place" || this.mode === "link") this.setMode("edit"); else if (this.$(".rig-ask").hidden) this.close(); }
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
      this._updateArrows();
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
    plainSurfaces(this.model);
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
    box.innerHTML = (count("hands") ? row(COLORS.hands, "Hands", count("hands")) : "") + (count("feet") ? row(COLORS.feet, "Feet", count("feet")) : "") + (count("ears") ? row(COLORS.ears, "Ears", count("ears")) : "") + row(COLORS.hair, "Hair", count("hair")) + row(COLORS.clothes, "Clothes", count("clothes")) + (count("items") ? row(COLORS.items, "Items", count("items")) : "") +
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
      b.position.copy(j.pos); if (j.parent) b.position.sub(j.parent.pos);
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
    this._tris = null; this._scanned = null;            // the cross-section cache was of the old meshes
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
    if (this._feet().length >= 4) return "quadruped";        // four separate things on the ground, however tall its ears or long its ribbons
    if (z > y * 1.1 && z > x) return "quadruped";            // longer front-to-back than tall: four legs
    const wide = (v) => { const p = this._slab(v, 0.05); return p.length ? this._spread(p) / x : 0; };
    if (wide(0.78) > 0.8) return "biped";                       // arms straight out (T-pose)
    return y < Math.max(x, z) * 1.6 && wide(0.75) > 0.5 ? "creature" : "biped";   // big head, short body
  }

  /** vertices (world space) between two heights, as fractions of the model's height */
  _slab(v, half, filter) {
    const out = [], y0 = this.box.min.y + (v - half) * this.size.y, y1 = this.box.min.y + (v + half) * this.size.y;
    const p = new THREE.Vector3(), skip = this._scan().loose;
    for (const m of this.meshes) {
      const pos = m.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 6000));
      for (let i = 0; i < pos.count; i += step) {
        if (skip.has(`${m.uuid}:${i}`)) continue;
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
      const list = [], p = new THREE.Vector3(), skip = this._scan().loose;
      for (const m of this.meshes) {
        const pos = m.geometry.attributes.position, idx = m.geometry.index, n = idx ? idx.count : pos.count;
        const step = Math.max(1, Math.floor(n / 3 / 150000)) * 3;
        for (let i = 0; i + 2 < n; i += step) {
          if (skip.has(`${m.uuid}:${idx ? idx.getX(i) : i}`)) continue;
          for (let k = 0; k < 3; k++) { p.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld); list.push(p.x, p.y, p.z); }
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
  /** reading a model that has no rig: it's split into the pieces that are really separate (its surfaces share no points). The biggest is the body. Hair, bows, ribbons and floating ornaments are
   *  whatever else stands out past the body or is called that: the skeleton is fitted to the body alone, then those get chains of their own. -> { loose: first vertices to leave out, extras: [{ name, pts, box }] } */
  _scan() {
    if (this._scanned) return this._scanned;
    const islands = [], KEY = (p) => `${Math.round(p.x * 2000)},${Math.round(p.y * 2000)},${Math.round(p.z * 2000)}`, v = new THREE.Vector3();
    for (const m of this.meshes) {
      const pos = m.geometry.attributes.position, idx = m.geometry.index, n = idx ? idx.count : pos.count, up = new Int32Array(pos.count).map((_, i) => i), weld = new Map();
      const find = (a) => { while (up[a] !== a) { up[a] = up[up[a]]; a = up[a]; } return a; }, join = (a, b) => { up[find(a)] = find(b); };
      for (let i = 0; i < pos.count; i++) { const k = KEY(v.fromBufferAttribute(pos, i)); if (weld.has(k)) join(i, weld.get(k)); else weld.set(k, i); }
      for (let i = 0; i + 2 < n; i += 3) { const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2; join(a, b); join(b, c); }
      const groups = new Map();
      for (let i = 0; i < pos.count; i++) { const r = find(i); let g = groups.get(r); if (!g) groups.set(r, g = { mesh: m, verts: [], pts: [], box: new THREE.Box3(), name: m.name || "" }); g.verts.push(i); v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); g.box.expandByPoint(v); if (g.verts.length % 3 === 1) g.pts.push(v.clone()); }
      islands.push(...groups.values());
    }
    const named = (g) => /hair|bow|ribbon|cape|cloak|scarf|tail|wing|flower|ornament|acces/i.test(g.name), bodyLike = (g) => /body|skin|torso/i.test(g.name), main = islands.filter((g) => !named(g)).sort((a, b) => (bodyLike(b) - bodyLike(a)) || b.verts.length - a.verts.length)[0] || islands[0];
    const wide = main.box.max.x - main.box.min.x, loose = new Set(), extras = [], total = islands.reduce((n, g) => n + g.verts.length, 0);
    for (const g of islands) {
      if (g === main) continue;
      const past = Math.max(main.box.min.x - g.box.min.x, g.box.max.x - main.box.max.x) > wide * 0.2;
      if (!named(g) && !past) continue;
      for (const i of g.verts) loose.add(`${g.mesh.uuid}:${i}`);         // left out when the body is measured: hair over the shoulders or a ribbon past the hand no longer moves the spine or the arms

      // many little pieces of one mesh (a ribbon's leaves) count as one thing
      let e = extras.find((x) => x.mesh === g.mesh);
      if (!e) extras.push(e = { mesh: g.mesh, name: g.name, pts: [], box: new THREE.Box3(), verts: 0, keys: new Set() });
      e.pts.push(...g.pts); e.box.union(g.box); e.verts += g.verts.length;
    }
    // the body's own size: everything but the loose pieces. A tall hat or long ears no longer make the shoulders land on the face
    const body = new THREE.Box3();
    for (const g of islands) if (!loose.has(`${g.mesh.uuid}:${g.verts[0]}`)) body.union(g.box);
    return (this._scanned = { main, loose, body, extras: extras.filter((e) => e.verts > total * 0.004 && e.pts.length > 3) });
  }

  /** after the body's skeleton: each loose piece gets what it needs. Hair strands from the head, and a chain from where it meets the body out to its far end for ribbons, tails and the like */
  _fitExtras() {
    const { extras } = this._scan(), head = this.joints.find((j) => /^head$/.test(j.name)), body = this.joints.filter((j) => !IS_TIP.test(j.name)), made = { hair: 0, ribbon: 0, item: 0 };
    if (!head) return made;
    const before = new Set(this.joints);
    const own = (g) => { for (const j of this.joints) if (!before.has(j)) { j.owner = g; before.add(j); } };       // what's skinned to these bones: this piece, and nothing else
    for (const g of extras.slice(0, 12)) {
      const hair = /hair/i.test(g.name), mid = g.box.getCenter(new THREE.Vector3()), size = g.box.getSize(new THREE.Vector3());
      if (hair) continue;
      // something stiff that's worn or carried (a hat brim, a staff, a bag, a bow): one bone of its own on the nearest part of the body, so it moves whole and never bends.
      // Ribbons, tails, capes and anything long and thin hang in a chain instead
      const dims = [size.x, size.y, size.z].sort((a, b) => b - a), flowing = /ribbon|cape|cloak|scarf|tail|skirt|sash|streamer|wing|tentacle|sleeve/i.test(g.name), long = dims[0] > dims[1] * 2.6 && dims[0] > this.size.y * 0.25;
      if (!flowing && (ITEM_NAME.test(g.name.toLowerCase()) || !long)) {
        const c = this._centroid(g.pts) || mid, root = body.reduce((a, j) => (j.pos.distanceToSquared(c) < a.pos.distanceToSquared(c) ? j : a), body[0]);
        const j = this.addJoint(`item_${++made.item}`, root, c);
        j.owner = g; before.add(j);
        continue;
      }
      // two sides of one ribbon are one piece: each arm of it is a chain of its own
      const span = size.x > size.y && size.x > size.z * 1.2 && size.x > this.size.x * 0.3, sides = span ? [[(p) => p.x >= mid.x, 1], [(p) => p.x < mid.x, -1]] : [[() => true, 0]];
      for (const [keep, s] of sides) {
        const pts = g.pts.filter(keep);
        if (pts.length < 4) continue;
        const near = pts.reduce((a, p) => { const d = Math.min(...body.map((j) => j.pos.distanceToSquared(p))); return d < a.d ? { d, p } : a; }, { d: Infinity, p: null }).p, far = pts.reduce((a, p) => (p.distanceToSquared(near) > a.distanceToSquared(near) ? p : a), near);
        const root = body.reduce((a, j) => (j.pos.distanceToSquared(near) < a.pos.distanceToSquared(near) ? j : a), body[0]), sfx = s ? (s > 0 ? ".L" : ".R") : "", n = ++made.ribbon;
        const stops = [0.05, 0.35, 0.65, 1].map((t) => { const at = near.clone().lerp(far, t), by = pts.filter((p) => p.distanceTo(at) < near.distanceTo(far) * 0.25); return this._centroid(by.length > 2 ? by : [at]); });
        this._chain(`ribbon_${n}`, sfx, root, stops);
        own(g);
      }
    }
    const hairs = extras.filter((g) => /hair/i.test(g.name));
    if (hairs.length) { this._hairStrands(head); made.hair = 3; own({ keys: new Set(hairs.flatMap((g) => [...g.keys])), hair: true }); }
    return made;
  }

  /** what touches the ground: the mesh cut just above the floor, in separate pieces. -> the middle of each piece, biggest first */
  _feet() {
    const pts = this._section(0.06), cell = Math.max(this.size.x, this.size.z) * 0.045, groups = [];
    for (const p of pts) {
      const near = groups.filter((g) => g.pts.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < cell));
      if (!near.length) { groups.push({ pts: [p] }); continue; }
      near[0].pts.push(p);
      for (const g of near.slice(1)) { near[0].pts.push(...g.pts); groups.splice(groups.indexOf(g), 1); }
    }
    return groups.filter((g) => g.pts.length >= 3).sort((a, b) => b.pts.length - a.pts.length).map((g) => this._mid(g.pts) || g.pts[0]);
  }
  /** the middle of a cross-section's bounding box */
  _mid(pts) {
    if (pts.length < 3) return null;
    const b = new THREE.Box3().setFromPoints(pts);
    return b.getCenter(new THREE.Vector3());
  }
  _spread(pts) { let a = Infinity, b = -Infinity; for (const p of pts) { a = Math.min(a, p.x); b = Math.max(b, p.x); } return b - a; }
  _centroid(pts) { const c = new THREE.Vector3(); for (const p of pts) c.add(p); return pts.length ? c.divideScalar(pts.length) : null; }
  /** the body's skin as a graph: its welded points and which touch which along the triangles' edges. An arm held tight against the side is
   *  only joined to the body at the armpit, however close it hangs */
  _surface() {
    if (this._surf) return this._surf;
    const m = this._scan().main, mesh = m.mesh, pos = mesh.geometry.attributes.position, idx = mesh.geometry.index, n = idx ? idx.count : pos.count, v = new THREE.Vector3();
    const KEY = (p) => `${Math.round(p.x * 2000)},${Math.round(p.y * 2000)},${Math.round(p.z * 2000)}`, weld = new Map(), id = new Int32Array(pos.count).fill(-1), P = [];
    for (const i of m.verts) { v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); const k = KEY(v); let w = weld.get(k); if (w == null) { w = P.length; weld.set(k, w); P.push(v.clone()); } id[i] = w; }
    const adj = P.map(() => new Set());
    for (let t = 0; t + 2 < n; t += 3) { const a = id[idx ? idx.getX(t) : t], b = id[idx ? idx.getX(t + 1) : t + 1], c = id[idx ? idx.getX(t + 2) : t + 2]; if (a < 0 || b < 0 || c < 0) continue; adj[a].add(b).add(c); adj[b].add(a).add(c); adj[c].add(a).add(b); }
    return (this._surf = { P, adj: adj.map((x) => [...x]) });
  }
  /** an arm followed over the skin from the outside of the shoulder: rings at a growing distance along the surface, each ring split into the pieces that touch.
   *  The piece furthest out to the side that carries on from the last is the arm. It stops where the ring suddenly widens (a sleeve, ribbon or the body) or turns back.
   *  sign: +1 for the left side (+x), -1 for the right. -> path of middles with .tip, or null */
  _traceArmSurface(shoulderY, cx, sign, maxLen, outTo = Infinity) {
    const { P, adj } = this._surface(), H = this.size.y, step = H * 0.03;
    if (P.length < 50) return null;
    let seed = -1;
    for (let i = 0; i < P.length; i++) if (Math.abs(P[i].y - shoulderY) < H * 0.03 && (P[i].x - cx) * sign <= outTo && (seed < 0 || (P[i].x - cx) * sign > (P[seed].x - cx) * sign)) seed = i;
    if (seed < 0 || (P[seed].x - cx) * sign <= 0) return null;
    // distances over the skin (Dijkstra with a small heap)
    const dist = new Float32Array(P.length).fill(Infinity), heap = [[0, seed]], push = (e) => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } }, pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    dist[seed] = 0;
    while (heap.length) { const [d, i] = pop(); if (d > dist[i] || d > maxLen * 1.3) continue; for (const j of adj[i]) { const nd = d + P[i].distanceTo(P[j]); if (nd < dist[j]) { dist[j] = nd; push([nd, j]); } } }
    const path = [P[seed].clone()], widths = [];
    let tip = null, prev = P[seed];
    for (let k = 1; k * step < maxLen * 1.3; k++) {
      const ring = new Set(); for (let i = 0; i < P.length; i++) if (dist[i] >= (k - 1) * step && dist[i] < k * step) ring.add(i);
      if (ring.size < 3) break;
      const parts = [];
      for (const i of ring) { if (!ring.size) break; if (!ring.has(i)) continue; const part = [i]; ring.delete(i); for (let q = 0; q < part.length; q++) for (const j of adj[part[q]]) if (ring.has(j)) { ring.delete(j); part.push(j); } if (part.length >= 3) parts.push(part); }
      if (!parts.length) break;
      const score = (part) => { const c = this._centroid(part.map((i) => P[i])); return (c.x - cx) * sign - c.distanceTo(prev) * 0.5; };
      const best = parts.reduce((a, b) => (score(b) > score(a) ? b : a)), pts = best.map((i) => P[i]), c = this._centroid(pts), w = new THREE.Box3().setFromPoints(pts).getSize(new THREE.Vector3()).length();
      const usual = widths.length >= 3 ? [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)] : null;
      if (usual && w > usual * 2.2) break;
      if ((c.x - cx) * sign < 0) break;                          // crossed over to the other side: that was the chest, not an arm
      path.push(c); widths.push(w); prev = c;
      tip = best.reduce((a, i) => (dist[i] > dist[a] ? i : a), best[0]);
      if (k * step > maxLen) break;
    }
    if (path.length < 5) return null;
    path.tip = P[tip].clone();
    return path;
  }
  /** a limb followed along the surface itself, from its root outwards: rings of points at a growing distance over the skin, each ring's middle a step along the limb.
   *  Where the ring splits (a ribbon or sleeve hanging off it) it keeps to the branch that carries straight on; where the ring suddenly gets much wider (the limb
   *  has run into a ribbon, a wing or the body) it stops. -> the path of middles, root first, or null if there's too little to follow */
  _traceLimb(pts, from, maxLen) {
    const H = this.size.y, r = H * 0.022, step = H * 0.03, cell = (p) => `${Math.floor(p.x / r)},${Math.floor(p.y / r)},${Math.floor(p.z / r)}`, grid = new Map();
    pts.forEach((p, i) => { const k = cell(p); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
    const near = (p) => { const out = [], cx = Math.floor(p.x / r), cy = Math.floor(p.y / r), cz = Math.floor(p.z / r); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const i of grid.get(`${cx + a},${cy + b},${cz + c}`) || []) if (pts[i].distanceToSquared(p) < r * r * 2.2) out.push(i); return out; };
    // how far over the skin each point is from the root (a breadth-first walk is close enough at this spacing)
    const dist = new Float32Array(pts.length).fill(Infinity), queue = [];
    let seeds = pts.map((p, i) => i).filter((i) => pts[i].distanceTo(from) < r * 2);
    if (!seeds.length) { let best = 0; pts.forEach((p, i) => { if (p.distanceToSquared(from) < pts[best].distanceToSquared(from)) best = i; }); seeds = [best]; }
    for (const i of seeds) { dist[i] = pts[i].distanceTo(from); queue.push(i); }
    for (let q = 0; q < queue.length; q++) { const i = queue[q]; for (const j of near(pts[i])) { const d = dist[i] + pts[i].distanceTo(pts[j]); if (d < dist[j] - 1e-6 && d < maxLen * 1.3) { dist[j] = d; queue.push(j); } } }
    // rings, outwards. Each ring is split into the pieces that touch; the one that carries on in the same direction is the limb
    const path = [from.clone()], widths = [];
    let dir = null, tip = null;
    for (let k = 1; k * step < maxLen * 1.3; k++) {
      const ring = []; for (let i = 0; i < pts.length; i++) if (dist[i] >= (k - 1) * step && dist[i] < k * step) ring.push(i);
      if (ring.length < 3) break;
      const left = new Set(ring), parts = [];
      for (const i of ring) { if (!left.has(i)) continue; const part = [i]; left.delete(i); for (let q = 0; q < part.length; q++) for (const j of near(pts[part[q]])) if (left.has(j)) { left.delete(j); part.push(j); } if (part.length >= 3) parts.push(part.map((n) => pts[n])); }
      if (!parts.length) break;
      const prev = path[path.length - 1], score = (part) => { const c = this._centroid(part), d = c.clone().sub(prev); const len = d.length() || 1; return (dir ? d.dot(dir) / len : 1) * 2 - c.distanceTo(prev) / step * 0.3 + Math.min(part.length, 40) / 400; };
      const best = parts.reduce((a, b) => (score(b) > score(a) ? b : a)), c = this._centroid(best), box = new THREE.Box3().setFromPoints(best), w = box.getSize(new THREE.Vector3()).length();
      const usual = widths.length >= 3 ? [...widths].sort((a, b) => a - b)[Math.floor(widths.length / 2)] : null;
      if (usual && w > usual * 2.2) break;                       // it ran into something much bigger than itself
      const d = c.clone().sub(prev);
      if (dir && d.lengthSq() > 1e-12 && d.clone().normalize().dot(dir) < -0.2) break;      // doubling back: that's the other side of whatever it joined
      if (d.lengthSq() > 1e-12) dir = dir ? dir.multiplyScalar(0.6).add(d.normalize().multiplyScalar(0.4)).normalize() : d.normalize();
      path.push(c); widths.push(w);
      tip = best.reduce((a, p) => (p.distanceToSquared(from) > a.distanceToSquared(from) ? p : a), best[0]);
      if (path.length * step > maxLen) break;
    }
    if (path.length < 4) return null;
    path.tip = tip;
    return path;
  }

  preset(kind, fit) {
    if (this.joints.length) this.remember();
    this.clearJoints();
    // auto: fitted to the body alone (worn and loose pieces left out), when that's a real part of the model
    const whole = { box: this.box, size: this.size, tris: this._tris }, body = fit ? this._scan().body : null;
    if (body && !body.isEmpty() && body.getSize(new THREE.Vector3()).y > this.size.y * 0.5) { this.box = body.clone(); this.size = body.getSize(new THREE.Vector3()); }
    try { this._preset(kind, fit); } finally { this.box = whole.box; this.size = whole.size; }
  }
  _preset(kind, fit) {
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
    if (fit && kind === "quadruped") this._fitQuadruped(byName);
    else if (fit) this._fitBiped(byName);
    const extra = fit ? this._fitExtras() : null;
    for (const j of this.joints) j.mesh.position.copy(j.pos);
    this._afterRig();
    this.toast(fit ? `Auto rig: read it as a ${kind}${extra.hair ? ", with hair" : ""}${extra.ribbon ? `, ${extra.ribbon} ribbon${extra.ribbon > 1 ? "s" : ""}` : ""}${extra.item ? ` and ${extra.item} item${extra.item > 1 ? "s" : ""} it wears or holds (orange: each moves whole)` : ""}. Drag any dot that's in the wrong place.` : `${kind[0].toUpperCase() + kind.slice(1)} rig added. Drag the dots to fit the model.`);
  }

  /** the same for four legs: each leg over the foot found on the ground, the back along the body's middle, the head and tail where the mesh really reaches */
  _fitQuadruped(J) {
    const feet = this._feet().slice(0, 4), B = this.box, H = this.size.y, y = (f) => B.min.y + f * H, cx = (B.min.x + B.max.x) / 2;
    if (feet.length < 4) return;
    feet.sort((a, b) => b.z - a.z);
    const front = feet.slice(0, 2), back = feet.slice(2), zF = (front[0].z + front[1].z) / 2, zB = (back[0].z + back[1].z) / 2, top = this._section(0.9), facing = (this._centroid(top)?.z ?? zF) >= (zF + zB) / 2 ? 1 : -1;
    const [nearF, nearB] = facing > 0 ? [front, back] : [back, front], zFront = facing > 0 ? zF : zB, zBack = facing > 0 ? zB : zF;
    // the belly: the first height, coming up, where the cut joins front and back into one long body
    const deep = (f) => { const p = this._section(f, (q) => Math.abs(q.x - cx) < this.size.x * 0.3); if (p.length < 3) return 0; const b = new THREE.Box3().setFromPoints(p); return b.max.z - b.min.z; };
    const span = Math.abs(zFront - zBack);
    let belly = 0.3, roof = 0.7;
    for (let f = 0.1; f < 0.9; f += 0.03) if (deep(f) > span * 0.85) { belly = f; break; }
    for (let f = belly + 0.05; f < 0.96; f += 0.03) if (deep(f) < span * 0.6) { roof = f; break; }
    const back0 = y(belly + (roof - belly) * 0.6), put = (j, x, Y, z) => { if (j) j.pos.set(x, Y, z); };
    const leg = (hip, knee, ankle, toe, [a, c]) => { for (const [f, s] of [[a, 1], [c, -1]]) { const left = f.x >= cx ? 1 : -1, tag = left > 0 ? ".L" : ".R"; put(J[hip + tag], f.x, back0 - H * 0.03, f.z); put(J[knee + tag], f.x, y(belly * 0.55), f.z + facing * H * 0.01); put(J[ankle + tag], f.x, y(0.05), f.z); put(J[toe + tag], f.x, B.min.y + H * 0.01, f.z + facing * H * 0.05); void s; } };
    leg("front_thigh", "front_shin", "front_foot", "front_toe_end", nearF);
    leg("thigh", "shin", "foot", "toe", nearB);
    ["spine", "spine.001", "spine.002", "spine.003"].forEach((n, i) => put(J[n], cx, back0 + H * 0.005 * i, THREE.MathUtils.lerp(zBack, zFront, i / 3)));
    const headCut = this._section(Math.min(0.93, roof + 0.08), (q) => (q.z - (zFront + zBack) / 2) * facing > -span * 0.2), head = this._centroid(headCut) || J.head.pos.clone();
    put(J["spine.004"], cx, (back0 + head.y) / 2, (zFront + head.z) / 2); put(J.head, cx, head.y, head.z); put(J.head_end, cx, head.y + H * 0.04, head.z + facing * H * 0.12);
    for (const s of [".L", ".R"]) if (J[`ear${s}`]) { const sign = s === ".L" ? 1 : -1; put(J[`ear${s}`], cx + sign * this.size.x * 0.05, head.y + H * 0.06, head.z); put(J[`ear_end${s}`], cx + sign * this.size.x * 0.08, B.max.y - H * 0.02, head.z); }
    const rear = this._section(belly + (roof - belly) * 0.5, (q) => (q.z - zBack) * facing < 0), tail = rear.reduce((a, q) => (q.z * facing < a * facing ? q.z : a), zBack - facing * H * 0.1);
    put(J.tail, cx, back0, zBack - facing * H * 0.04); put(J["tail.001"], cx, back0, (zBack + tail) / 2); put(J.tail_end, cx, back0, tail);
    for (const j of this.joints) j.mesh.position.copy(j.pos);
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
    const traced = {};
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
      if (toe && foot) {
        const sole = this._centroid(this._section(0.015, (p) => Math.abs(p.x - foot.pos.x) < this.size.x * 0.12)), way = sole && Math.abs(sole.z - foot.pos.z) > H * 0.004 ? Math.sign(sole.z - foot.pos.z) : 1;    // whichever way the feet point
        toe.pos.x = foot.pos.x; toe.pos.z = foot.pos.z + way * Math.min(this.size.z * 0.3, H * 0.09);
      }
      // arms: the furthest point out at shoulder height is the hand
      const ua = J[`upper_arm.${s}`], hand = J[`hand.${s}`], fa = J[`forearm.${s}`], end = J[`hand_end.${s}`];
      if (!ua || !hand) continue;
      const along = (path, t) => { let total = 0; const seg = path.slice(1).map((p, i) => { const l = p.distanceTo(path[i]); total += l; return l; }); let want = total * t, i = 0; while (i < seg.length - 1 && want > seg[i]) want -= seg[i++]; return path[i].clone().lerp(path[i + 1], seg[i] ? want / seg[i] : 0); };
      // first, over the skin from the outside of the shoulder: that finds an arm in any pose, even one hanging tight against the side or the dress,
      // and stops at the hand rather than running on into a ribbon or sleeve. The shoulder is no further out than the chest just under the armpit
      const chest = this._section(Math.max(0.05, v(ua) - 0.06), (p) => Math.abs(p.x - cx) < H * 0.2), shoulderOut = (chest.length > 3 ? Math.max(...chest.map((p) => (p.x - cx) * sign)) : H * 0.12) + H * 0.02;
      const skin = this._traceArmSurface(ua.pos.y, J.spine.pos.x, sign, (neck || 0.85) * H * 0.55, shoulderOut);
      // a real arm gets well away from the shoulder and never climbs above it; a walk that wanders over the chest or up the neck (the arm is a separate piece) doesn't count
      if (skin && skin.tip.distanceTo(skin[0]) > H * 0.18 && Math.max(...skin.map((p) => p.y)) < ua.pos.y + H * 0.05 && Math.abs(skin.tip.x - cx) > Math.abs(skin[0].x - cx) * 0.6) {
        ua.pos.set(skin[0].x - sign * H * 0.03, ua.pos.y, skin[Math.min(2, skin.length - 1)].z);
        fa.pos.copy(along(skin, 0.5)); hand.pos.copy(along(skin, 0.86)); end.pos.copy(skin.tip);
        const sh = J[`shoulder.${s}`];
        if (sh) sh.pos.lerpVectors(J["spine.003"].pos, ua.pos, 0.45);
        traced[s] = true;
        continue;
      }
      // arms in any pose: the body's own surface, out past the sides of the waist and above the hips, is the arm. Its far end is the hand
      const waist = this._section(v(J["spine.001"] || J.spine), (p) => Math.abs(p.x - cx) < H * 0.2), half = (waist.length > 3 ? this._spread(waist) / 2 : H * 0.08) * 1.12;
      const arm = this._scan().main.pts.filter((p) => (p.x - J.spine.pos.x) * sign > half && p.y > J.spine.pos.y - H * 0.08 && p.y < ua.pos.y + H * 0.06);
      if (arm.length > 8) {
        ua.pos.x = J.spine.pos.x + sign * half * 0.95;
        ua.pos.z = this._centroid(arm.filter((p) => p.y > ua.pos.y - H * 0.05))?.z ?? ua.pos.z;
        // no arm is longer than about half the body up to the neck: past that it's a sleeve, a ribbon or a wing joined on (Kindred's ribbons), not the hand
        const reach = (neck || 0.85) * H * 0.5, armPts = arm.filter((p) => p.distanceTo(ua.pos) < reach), use = armPts.length > 8 ? armPts : arm;
        // walked along the skin first: that follows the arm itself and stops before a ribbon or sleeve hanging off it. The straight-line reach is what's left if it can't
        const path = this._traceLimb(use, ua.pos, reach);
        if (path) {
          fa.pos.copy(along(path, 0.5)); hand.pos.copy(along(path, 0.86)); end.pos.copy(path.tip || path[path.length - 1]);
        } else {
          const tip = use.reduce((a, p) => (p.distanceToSquared(ua.pos) > a.distanceToSquared(ua.pos) ? p : a), use[0]), L = tip.distanceTo(ua.pos), bend = use.filter((p) => Math.abs(p.distanceTo(ua.pos) - L * 0.5) < L * 0.14), wrist = use.filter((p) => Math.abs(p.distanceTo(ua.pos) - L * 0.8) < L * 0.12);
          fa.pos.copy(this._centroid(bend.length > 2 ? bend : [ua.pos.clone().lerp(tip, 0.5)]));
          hand.pos.copy(this._centroid(wrist.length > 2 ? wrist : [ua.pos.clone().lerp(tip, 0.82)]));
          end.pos.copy(tip);
        }
        const sh = J[`shoulder.${s}`];
        if (sh) sh.pos.lerpVectors(J["spine.003"].pos, ua.pos, 0.45);
        traced[s] = true;
        continue;
      }
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
    if (traced.L !== traced.R) {                               // one arm hidden in a pose or against the body: it follows the one that was found
      const [from, to] = traced.L ? ["L", "R"] : ["R", "L"];
      for (const n of ["upper_arm", "forearm", "hand", "hand_end", "shoulder"]) { const a = J[`${n}.${from}`], b = J[`${n}.${to}`]; if (a && b) b.pos.set(2 * J.spine.pos.x - a.pos.x, a.pos.y, a.pos.z); }
    }
    for (const j of this.joints) j.mesh.position.copy(j.pos);
  }

  clearJoints() { this.joints = []; this.jointsGroup.clear(); this.selected = this.chainFrom = null; this.$(".rig-legend").hidden = true; }

  // ---------- undo: every change to the joints (or to a test pose) can be taken back with Ctrl+Z ----------
  /** keep how things are now, before a change */
  remember() {
    if (this.mode === "pose" && this.preview) { (this._poseHistory ||= []).push(this.preview.skeleton.bones.map((b) => b.quaternion.clone())); return; }
    const at = new Map(this.joints.map((j, i) => [j, i]));
    (this._history ||= []).push(this.joints.map((j) => ({ name: j.name, parent: j.parent ? at.get(j.parent) : -1, pos: j.pos.clone(), owner: j.owner })));
    if (this._history.length > 80) this._history.shift();
  }
  undo() {
    if (this.mode === "pose" && this.preview) {
      const was = this._poseHistory?.pop();
      if (!was) return this.toast("Nothing to undo in this pose", 1500);
      this.preview.skeleton.bones.forEach((b, i) => b.quaternion.copy(was[i])); this.preview.root.updateMatrixWorld(true);
      for (const t of this.ikTargets) t.handle.position.copy(t.eff.getWorldPosition(new THREE.Vector3()));
      return;
    }
    const was = this._history?.pop();
    if (!was) return this.toast("Nothing to undo", 1500);
    this.jointsGroup.clear(); this.joints = []; this.selected = this.chainFrom = this.linkFrom = null;
    const made = was.map((w) => { const j = this.addJoint(w.name, null, w.pos); j.owner = w.owner; j.popT = null; j.mesh.scale.setScalar(this.dotScale || 1); return j; });
    was.forEach((w, i) => { if (w.parent >= 0) made[i].parent = made[w.parent]; });
    this._colorsDirty = true; this._renderEditTools();
    this.toast("Undone", 900);
  }
  /** what a joint is for, picked from a list: it's renamed so it reads as that everywhere (its colour here, and how the room and UniMate move it), with what hangs from it */
  setRole(j, role) {
    if (!j) return;
    this.remember();
    const pre = { body: "bone", hands: "hand", feet: "foot", hair: "hair", clothes: "cloth", items: "item", ears: "ear", tail: "tail", face: "face" }[role] || "bone";
    const chain = [j, ...this.joints.filter((x) => isUnder(x, j))];
    chain.forEach((x, i) => { const sfx = (/[._][LR]$/.exec(x.name) || [""])[0], n = this.joints.filter((y) => y !== x && y.name.startsWith(pre)).length + 1; x.name = `${pre}_${String(n + i).padStart(2, "0")}${i === chain.length - 1 && chain.length > 1 ? "_end" : ""}${sfx}`; });
    this._colorsDirty = true; this._renderEditTools();
  }

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
    this.remember();
    for (const c of this.joints) if (c.parent === j) c.parent = j.parent;
    this.joints = this.joints.filter((x) => x !== j);
    this.jointsGroup.remove(j.mesh);
    if (this.selected === j) this.select(null);
    if (this.chainFrom === j) this.chainFrom = j.parent;
    if (this.linkFrom === j) this.linkFrom = null;
    this._colorsDirty = true;
  }

  /** the other side's joint, while Mirror is on */
  _twin(j) { return this.mirror && sideOf(j.name) ? this.joints.find((x) => x.name === OTHER(j.name)) || null : null; }

  /** hang `child` from `parent` (a bone goes from the parent to the child). With Mirror on, the other side is linked the same way */
  link(parent, child) {
    if (parent === child) return false;
    if (isUnder(parent, child)) { this.toast("That would make a loop: this joint already hangs from the other one."); return false; }
    this.remember();
    child.parent = parent;
    const twin = this._twin(child), other = this._twin(parent) || parent;
    if (twin && twin !== parent && !isUnder(other, twin)) twin.parent = other;
    this._colorsDirty = true;
    return true;
  }
  /** cut a joint loose from what it hangs from */
  unlink(j) {
    if (!j?.parent) return;
    this.remember();
    j.parent = null;
    const twin = this._twin(j);
    if (twin) twin.parent = null;
    this._colorsDirty = true;
    this.toast(`${j.name} is on its own now. Press Link to hang it from another joint.`, 3000);
  }

  // ---------- the arrows on the selected joint: drag one to move along that axis only ----------
  _makeArrows() {
    const g = this.arrows = new THREE.Group();
    this.arrowHits = [];
    for (const [axis, color, dir] of [["x", 0xff4d5e, new THREE.Vector3(1, 0, 0)], ["y", 0x5ee05e, new THREE.Vector3(0, 1, 0)], ["z", 0x4d9dff, new THREE.Vector3(0, 0, 1)]]) {
      const a = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }), stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.8, 8), mat), tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 12), mat);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 6), new THREE.MeshBasicMaterial({ visible: false }));
      stem.position.y = 0.4; tip.position.y = 0.9; hit.position.y = 0.55;
      stem.renderOrder = tip.renderOrder = 12;
      hit.userData = { axis, dir };
      a.add(stem, tip, hit);
      a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      a.userData = { axis, mat };
      g.add(a);
      this.arrowHits.push(hit);
    }
    g.visible = false;
    this.scene.add(g);
  }
  _updateArrows() {
    if (!this.arrows) this._makeArrows();
    const j = this.selected, on = this.mode === "edit" && !!j;
    this.arrows.visible = on;
    if (!on) return;
    this.arrows.position.copy(j.mesh.position);
    this.arrows.scale.setScalar(this.camera.position.distanceTo(j.mesh.position) * 0.13);
    for (const a of this.arrows.children) a.userData.mat.opacity = !this.snap || this.snap === a.userData.axis ? 1 : 0.16;   // with Snap on, the arrow it keeps to stands out
  }
  /** how far along the line (from, dir) the mouse ray comes closest */
  _alongAxis(from, dir) {
    const r = this.ray.ray.direction, w = from.clone().sub(this.ray.ray.origin), b = dir.dot(r), den = 1 - b * b;
    if (Math.abs(den) < 1e-4) return null;              // looking straight down the arrow
    return (b * w.dot(r) - w.dot(dir)) / den;
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
      if (j.popT != null) { j.popT += 1 / 60; const x = Math.min(1, j.popT / 0.35); j.mesh.scale.setScalar((x >= 1 ? 1 : x + Math.sin(x * Math.PI) * 0.4) * (this.dotScale || 1)); if (x >= 1) j.popT = null; }
      if (j.parent) pts.push(j.parent.mesh.position, j.mesh.position);
    }
    if (this.mode === "link" && this.linkFrom && this.linkTip) pts.push(this.linkFrom.mesh.position, this.linkTip);      // the link you're about to make
    this.lines.geometry.setFromPoints(pts);
    this.lines.visible = (this.mode === "edit" || this.mode === "place" || this.mode === "link") && !!pts.length;
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
      this.chainFrom = null;
      this.placing = null;
      this.hint("Click on the model to place a joint: each one stands alone until you link it. Press Link to join them into bones. Press Exit (or Esc) when done.");
      this.tools([
        { label: "⏹ Exit placing", on: true, click: () => this.setMode("edit") },
        { label: "🔗 Link", title: "join joints into bones", click: () => this.setMode("link") },
        { label: "↶ Remove last", click: () => { const last = this.joints.at(-1); if (last) this.deleteJoint(last); } },
      ]);
    } else if (mode === "link") {
      this.linkFrom = this.selected;
      this.linkTip = null;
      this.select(this.selected);
      this.hint("Click the joint a bone starts from, then the joint it goes to. Keep clicking to carry the chain on; click empty space to start a new one. Press Exit (or Esc) when done.");
      this.tools([
        { label: "⏹ Exit linking", on: true, click: () => this.setMode("edit") },
        { label: "✂ Unlink", title: "cut the selected joint loose", click: () => this.unlink(this.selected) },
      ]);
    } else if (mode === "edit") {
      this.placing = null; this.linkFrom = null;
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
    this.toast(this.snap ? `Joints move along the ${this.snap.toUpperCase()} arrow only.` : "Joints move freely: drag a dot, or one of its arrows.", 2000);
    this._renderEditTools();
  }

  _renderEditTools() {
    if (this.mode !== "edit") return;
    const name = document.createElement("input");
    name.className = "rig-name"; name.placeholder = "click a joint"; name.disabled = !this.selected;
    name.value = this.selected?.name || "";
    name.addEventListener("change", () => { if (this.selected && name.value.trim()) { this.remember(); this.selected.name = name.value.trim(); this._colorsDirty = true; } });
    // what the selected joint is: pick from the list and it (and what hangs from it) takes that part's name and colour
    const role = document.createElement("select");
    role.className = "rig-name"; role.disabled = !this.selected; role.title = "what this joint is: its colour, and how it moves";
    for (const [k, label] of [["", "Joint is…"], ["body", "Body"], ["hands", "Hand"], ["feet", "Foot"], ["hair", "Hair"], ["clothes", "Clothes"], ["items", "Item (stiff)"], ["ears", "Ear"], ["tail", "Tail"], ["face", "Face"]]) role.append(new Option(label, k));
    role.value = this.selected?.region && ["hands", "feet", "hair", "clothes", "items", "ears", "face"].includes(this.selected.region) ? this.selected.region : "";
    role.addEventListener("change", () => { if (role.value) this.setRole(this.selected, role.value); });
    // how big the dots are drawn: smaller to place them finely on a detailed model
    const size = document.createElement("label");
    size.className = "rig-check"; size.title = "dot size";
    size.innerHTML = `⚬ <input type="range" min="0.25" max="2.5" step="0.05" value="${this.dotScale || 1}" style="width:80px">`;
    size.querySelector("input").addEventListener("input", (e) => { this.dotScale = +e.target.value; for (const j of this.joints) if (j.popT == null) j.mesh.scale.setScalar(this.dotScale); });
    const mirror = document.createElement("label");
    mirror.className = "rig-check";
    mirror.innerHTML = `<input type="checkbox" ${this.mirror ? "checked" : ""}> Mirror left/right`;
    mirror.querySelector("input").addEventListener("change", (e) => { this.mirror = e.target.checked; });
    this.tools([
      { label: "✏️ Place bones", title: "add joints by clicking on the model", click: () => this.setMode("place") },
      { label: "🔗 Link", title: "join joints into bones: click the joint a bone starts from, then the one it goes to", click: () => this.setMode("link") },
      { label: "✂ Unlink", title: "cut the selected joint loose from what it hangs from", click: () => this.unlink(this.selected) },
      { label: "🧍 Change preset", click: () => this.chooseRig() },
      { label: "✋ Hands", title: "add finger bones to both hands (5, 4 or 3 fingers) so hand poses work", click: () => this.addHands() },
      { label: "💇 Hair", title: "add hair strands that swing", click: () => this.addHair() },
      { label: "👗 Clothes", title: "add a skirt / dress or a cape that moves like cloth", click: () => this.addClothes() },
      name,
      role,
      { label: "🗑 Delete joint", click: () => this.selected && this.deleteJoint(this.selected) },
      { label: "↶ Undo", title: "take back the last change (Ctrl+Z)", click: () => this.undo() },
      size,
      mirror,
      ...["x", "y", "z"].map((a) => ({ label: `Snap ${a.toUpperCase()}`, on: this.snap === a, title: `keep joints on the ${a.toUpperCase()} arrow, whichever way you drag (or press ${a.toUpperCase()})`, click: () => this.setSnap(a) })),
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
    this.remember();
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
    this._hairStrands(head);
    this.select(null);
    this.toast("Hair added ✓ Drag the strands into the hair (longer hair: select the last dot, ✏️ Place bones, click further down).", 9000);
  }
  /** three strands down the back of the head */
  _hairStrands(head) {
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
        if (this.placing) { this.chainFrom = hit.userData.joint; this.placing.side = 0; this.placing.twinFrom = null; }    // a strand's branch from one dot isn't copied
        this.select(hit.userData.joint);
        return;
      }
      const p = this._pickInside(e);
      if (!p) return;
      if (this.placing) return this._placeChainJoint(p);
      this.remember();
      const n = this.joints.length, cx = (this.box.min.x + this.box.max.x) / 2;
      const side = Math.abs(p.x - cx) > this.size.x * 0.04 ? (p.x > cx ? ".L" : ".R") : "";
      const j = this.addJoint(`bone_${String(n).padStart(2, "0")}${side}`, null, p);     // on its own: bones are made with Link
      if (side && this.mirror) this.addJoint(OTHER(j.name), null, new THREE.Vector3(2 * cx - p.x, p.y, p.z));
      this.select(j);
      return;
    }
    if (this.mode === "link") {
      const hit = this._pickJoint(e);
      if (!hit) { this.linkFrom = null; this.linkTip = null; this.select(null); return; }
      const j = hit.userData.joint;
      if (this.linkFrom) this.link(this.linkFrom, j);
      this.linkFrom = j;
      this.select(j);
      return;
    }
    if (this.mode === "edit" && this.selected) {                 // an arrow first: it sits on top of the dot it belongs to
      this.ray.setFromCamera(this._ndc(e), this.camera);
      const arrow = this.ray.intersectObjects(this.arrowHits, false)[0]?.object;
      if (arrow) return this._grab(e, this.selected.mesh, arrow.userData.axis);
    }
    const list = this.mode === "pose" ? this.ikTargets.map((t) => t.handle) : this.mode === "edit" ? this.jointsGroup.children : [];
    const hit = this._pickJoint(e, list);
    if (!hit) return;
    if (this.mode === "edit") this.select(hit.userData.joint);
    this._grab(e, hit, this.mode === "edit" ? this.snap : "");
  }
  /** start dragging: freely on a plane facing the camera, or along one axis */
  _grab(e, obj, axis) {
    this.remember();                                         // a drag can be taken back
    const n = this.camera.getWorldDirection(new THREE.Vector3());
    this._drag = { obj, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, obj.position), axis };
    if (axis) {
      const d = this._drag;
      d.dir = new THREE.Vector3(+(axis === "x"), +(axis === "y"), +(axis === "z"));
      d.from = obj.position.clone();
      this.ray.setFromCamera(this._ndc(e), this.camera);
      d.grab = this._alongAxis(d.from, d.dir) ?? 0;
    }
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  }
  _move(e) {
    if (this.mode === "link" && this.linkFrom) {               // the line to the mouse, at the depth of the joint it comes from
      this.ray.setFromCamera(this._ndc(e), this.camera);
      const at = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), this.linkFrom.mesh.position), at)) this.linkTip = at;
    }
    if (!this._drag) return;
    this.ray.setFromCamera(this._ndc(e), this.camera);
    const p = new THREE.Vector3(), o = this._drag.obj, d = this._drag;
    if (d.axis) {
      const t = this._alongAxis(d.from, d.dir);
      if (t == null) return;
      p.copy(d.from).addScaledVector(d.dir, t - d.grab);
    } else if (!this.ray.ray.intersectPlane(d.plane, p)) return;
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
  _weights(geo, order, kids, index, mesh = null) {
    const segs = [];
    for (const j of order) {
      const ch = kids.get(j);
      const cloth = CLOTH_NAME.test(j.name) ? 1.5 : 1;
      if (ch.length) for (const c of ch) segs.push({ bone: index.get(j), a: j.pos, b: c.pos, side: sideOf(j.name), cloth, owner: j.owner });
      else if (!j.parent || j.owner) segs.push({ bone: index.get(j), a: j.pos, b: j.pos, side: sideOf(j.name), cloth, owner: j.owner });     // a stiff item is one point
    }
    // a separate piece (a hat, a ribbon, the hair) is skinned only to the bones made for it, and the body never to those: nothing tears or drags along
    const whose = new Map(), bodySegs = segs.filter((s) => !s.owner), mine = new Map();
    if (mesh) for (const j of order) if (j.owner?.keys) for (const k of j.owner.keys) if (k.startsWith(mesh.uuid)) whose.set(+k.slice(mesh.uuid.length + 1), j.owner);
    const segsOf = (o) => {
      if (!mine.has(o)) {
        const list = segs.filter((s) => s.owner === o), base = order.find((j) => j.owner === o)?.parent;
        if (list.length > 1 && base && !base.owner) list.push(...bodySegs.filter((s) => s.bone === index.get(base)));    // a chain blends into what it hangs from; a stiff item doesn't
        mine.set(o, list.length ? list : bodySegs);
      }
      return mine.get(o);
    };
    const anyOwned = segs.some((s) => s.owner);
    const pos = geo.attributes.position, n = pos.count;
    const skinIndex = new Uint16Array(n * 4), skinWeight = new Float32Array(n * 4);
    const cx = (this.box.min.x + this.box.max.x) / 2, mid = this.size.x * 0.03;
    const p = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
    const best = new Float32Array(order.length);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      best.fill(Infinity);
      const vs = p.x - cx > mid ? 1 : p.x - cx < -mid ? -1 : 0, o = whose.get(i);
      for (const s of o ? segsOf(o) : anyOwned ? bodySegs : segs) {
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
      this._weights(geo, order, kids, index, m);
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
    // ready-made poses to try the rig with: five for each kind of body, the model's own kind first
    const kind = built.skeleton.bones.some((b) => /front_?(thigh|shin)|frontup/i.test(b.name)) ? "quadruped" : built.skeleton.bones.some((b) => /wing/i.test(b.name)) || !built.skeleton.bones.some((b) => IS_UPPER_ARM(plain(b.name))) ? "monster" : "biped";
    const poses = document.createElement("select");
    poses.className = "rig-name"; poses.title = "try a ready-made pose";
    poses.append(new Option("Try a pose…", ""));
    for (const k of [kind, ...Object.keys(POSES).filter((x) => x !== kind)]) { const g = document.createElement("optgroup"); g.label = { biped: "Two legs", quadruped: "Four legs", monster: "Monster" }[k]; for (const name of Object.keys(POSES[k])) g.append(new Option(name, `${k}|${name}`)); poses.append(g); }
    poses.addEventListener("change", () => { if (!poses.value) return; const [k, n] = poses.value.split("|"); this.remember(); this.applyPose(POSES[k][n]); });
    this.tools([
      poses,
      { label: "↶ Undo", title: "Ctrl+Z", click: () => this.undo() },
      { label: "↺ Reset pose", click: () => { this.remember(); built.skeleton.bones.forEach((b, i) => b.quaternion.copy(this.rest[i])); built.root.updateMatrixWorld(true); for (const t of this.ikTargets) t.handle.position.copy(t.eff.getWorldPosition(new THREE.Vector3())); } },
      { label: "← Back to joints", click: () => this._leavePose() },
      { label: "💾 Save rig", click: () => { this._leavePose(); this.save(); } },
    ]);
    this.hint("IK is on: drag the green handles (hands, feet, tail) and the arm, leg or tail bends to follow. If the mesh tears, go back and move the joints.");
  }
  /** a ready-made pose: from the rest pose, each part turned about a world axis (x across, y up, z forward), whatever its bones are called */
  applyPose(list) {
    const P = this.preview;
    if (!P) return;
    P.skeleton.bones.forEach((b, i) => b.quaternion.copy(this.rest[i]));
    P.root.updateMatrixWorld(true);
    const q = new THREE.Quaternion(), w = new THREE.Quaternion(), pw = new THREE.Quaternion(), AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    for (const [part, side, axis, deg] of list) {
      for (const b of P.skeleton.bones.filter((x) => PART[part]?.(plain(x.name)) && (!side || sideOf(x.name) === side || (side === "both" && sideOf(x.name))))) {
        const s = side === "both" ? sideOf(b.name) : 1, ang = THREE.MathUtils.degToRad(deg) * (axis === "z" || axis === "y" ? s : 1);
        b.getWorldQuaternion(w); (b.parent ? b.parent.getWorldQuaternion(pw) : pw.identity()).invert();
        b.quaternion.copy(pw.multiply(q.setFromAxisAngle(AX[axis], ang).multiply(w)));
        b.updateMatrixWorld(true);
      }
    }
    for (const t of this.ikTargets) t.handle.position.copy(t.eff.getWorldPosition(new THREE.Vector3()));
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
    const roots = this.joints.filter((j) => !j.parent);
    if (roots.length > 1) {                                    // a rig is one tree: anything left loose wouldn't move with the body
      const k = await this.ask(`${roots.length - 1} joint${roots.length > 2 ? "s are" : " is"} not linked to the rest. Link ${roots.length > 2 ? "them" : "it"} to the nearest joint, or go back and do it yourself?`, [["auto", "🔗 Link to the nearest"], ["back", "Go back"]]);
      if (k !== "auto") return;
      const main = roots.reduce((a, r) => (this.joints.filter((j) => j === r || isUnder(j, r)).length > this.joints.filter((j) => j === a || isUnder(j, a)).length ? r : a));
      for (const r of roots) {
        if (r === main) continue;
        const near = this.joints.filter((j) => j !== r && !isUnder(j, r)).sort((a, b) => a.pos.distanceToSquared(r.pos) - b.pos.distanceToSquared(r.pos))[0];
        if (near) r.parent = near;
      }
      this._colorsDirty = true;
    }
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
