// dice3d.js - the dice tray. Real 3D dice (made in Blender: D4, D6, D8, D10, D12, D20) tumble onto the felt and
// land showing EXACTLY the number the rules engine rolled: we work out the die's final orientation from
// dice_faces.json (which face shows which number) first, then animate the tumble so it ends there.
import * as THREE from "three";
import * as A from "./assets.js";

const UP = new THREE.Vector3(0, 1, 0);

export class DiceTray {
  constructor(el, canvas, labelEl, faces, audio) {
    this.el = el; this.canvas = canvas; this.labelEl = labelEl; this.faces = faces || {}; this.audio = audio;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 50);
    this.camera.position.set(0, 6.2, 1.6);
    this.camera.lookAt(0, 0, 0.2);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x335533, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 6, 3); this.scene.add(d);
    this.models = {};
    this.active = [];
    this.queue = Promise.resolve();
    this.hideTimer = null;
    this.clock = new THREE.Clock();
    const loop = () => { requestAnimationFrame(loop); this.tick(); };
    loop();
  }

  async model(sides) {
    const s = sides === 100 ? 10 : sides;
    if (!this.models[s]) {
      try {
        const g = await A.load(`made_dice_d${s}`);
        this.models[s] = g.scene;
      } catch {
        this.models[s] = null;
      }
    }
    const src = this.models[s];
    if (!src) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: 0xcc3344, flatShading: true }));
      return m;
    }
    const c = src.clone(true);
    return c;
  }

  /** orientation that puts the face showing `value` on top, with a random spin around the vertical */
  finalQuat(sides, value) {
    const list = this.faces[`d${sides === 100 ? 10 : sides}`];
    const f = list?.find((x) => x.value === (sides === 10 && value === 10 ? 0 : value));
    const q = new THREE.Quaternion();
    if (f) q.setFromUnitVectors(new THREE.Vector3(...f.normal).normalize(), UP);
    const yaw = new THREE.Quaternion().setFromAxisAngle(UP, Math.random() * Math.PI * 2);
    return yaw.multiply(q);
  }

  /** roll = {die, rolls:[..], mod, total, reason, vs?, natural?} - returns when the dice have settled */
  roll(r, { fast = false, who = "" } = {}) {
    this.queue = this.queue.then(() => this._roll(r, fast, who)).catch(() => {});
    return this.queue;
  }

  async _roll(r, fast, who) {
    clearTimeout(this.hideTimer);
    this.el.hidden = false;
    this.resize();
    for (const d of this.active) this.scene.remove(d.obj);
    this.active = [];
    const n = Math.min(3, r.rolls.length);
    const dur = fast ? 0.65 : 1.15;
    for (let i = 0; i < n; i++) {
      const obj = await this.model(r.die);
      obj.scale.setScalar(n > 1 ? 1.3 : (r.die === 20 || r.die === 12 ? 2.0 : 1.7));
      this.scene.add(obj);
      const end = new THREE.Vector3((i - (n - 1) / 2) * 1.5, 0.55, 0.2 + (Math.random() - 0.5) * 0.4);
      const start = new THREE.Vector3(end.x + (Math.random() - 0.5) * 3, 3.5, end.z - 2.5);
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      this.active.push({ obj, start, end, axis, spins: 3 + Math.random() * 3, q: this.finalQuat(r.die, r.rolls[i]), t: 0, dur });
    }
    this.label("", "");
    this.audio?.sfx("dice");
    await new Promise((res) => setTimeout(res, dur * 1000 + 40));
    for (const d of this.active) d.t = d.dur;          // on a slow computer: make sure they show the result
    this.tick(0);
    this.audio?.sfx("dice_land");
    // the result text: "d20: 14 +4 = 18 vs 13 - hit"
    const nat = r.natural ?? r.rolls[0];
    if (r.die === 20 && r.rolls.length === 1) {                 // the big moments get their own sound + a glow
      this.el.classList.remove("nat20", "nat1"); void this.el.offsetWidth;
      if (nat === 20) { this.audio?.sfx("nat20"); this.el.classList.add("nat20"); }
      else if (nat === 1) { this.audio?.sfx("nat1"); this.el.classList.add("nat1"); }
    }
    const rollsTxt = r.rolls.length > 1 ? `${r.rolls.join(" + ")}` : `${r.rolls[0]}`;
    const modTxt = r.mod ? ` ${r.mod > 0 ? "+" : "−"} ${Math.abs(r.mod)}` : "";
    let cls = "", verdict = "";
    if (r.vs != null) {
      const ok = r.success != null ? r.success : ((r.die === 20 && nat === 20) || (nat !== 1 && r.total >= r.vs));
      cls = r.die === 20 && nat === 20 ? "crit" : ok ? "hit" : "miss";
      verdict = r.die === 20 && nat === 20 ? "Natural 20!" : r.die === 20 && nat === 1 ? "Natural 1…" : ok ? `beats ${r.vs}` : `needs ${r.vs}`;
    }
    const what = { attack: "Attack roll", damage: "Damage", heal: "Healing", initiative: "Initiative", flee: "Escape", steal: "Steal" }[r.reason] || r.reason || "Roll";
    this.label(`${who ? who + " · " : ""}${what} (${r.rolls.length}d${r.die})`, `${rollsTxt}${modTxt}${r.rolls.length > 1 || r.mod ? " = " + r.total : ""}`, verdict, cls);
    this.hideTimer = setTimeout(() => { this.el.hidden = true; this.el.classList.remove("nat20", "nat1"); }, nat === 20 && r.die === 20 ? 3400 : 2600);
    await new Promise((res) => setTimeout(res, fast ? 350 : 650));
  }

  label(top, big, verdict = "", cls = "") {
    this.labelEl.className = `dice-label ${cls}`;
    this.labelEl.innerHTML = big ? `<span class="big">${big}</span>${top}${verdict ? " — " + verdict : ""}` : "";
  }

  resize() {
    const w = this.canvas.clientWidth || 230, h = this.canvas.clientHeight || 230;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  tick(force) {
    const dt = force === 0 ? 0 : Math.min(0.05, this.clock.getDelta());
    if (this.el.hidden) return;
    for (const d of this.active) {
      d.t = Math.min(d.dur, d.t + dt);
      const k = d.t / d.dur;
      // fall + two bounces
      const fall = Math.min(1, k / 0.55);
      const p = d.start.clone().lerp(d.end, 1 - Math.pow(1 - fall, 2));
      if (k < 0.55) p.y = d.start.y + (d.end.y - d.start.y) * (fall * fall);
      else { const b = (k - 0.55) / 0.45; p.y = d.end.y + Math.abs(Math.sin(b * Math.PI * 2)) * 0.6 * (1 - b) * (1 - b); }
      d.obj.position.copy(p);
      // tumble that always ends exactly on the final orientation
      const rest = Math.pow(1 - k, 2.2);
      const spin = new THREE.Quaternion().setFromAxisAngle(d.axis, rest * d.spins * Math.PI * 2);
      d.obj.quaternion.copy(spin).multiply(d.q);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
