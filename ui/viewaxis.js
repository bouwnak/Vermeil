// viewaxis.js - the little X / Y / Z axis in the top right corner, like Blender's.
//  - it turns with the camera, so you always see which way is which
//  - click a ball to snap the camera to that side: X = right, -X = left, Y = top, -Y = bottom,
//    Z = front, -Z = back (models face +Z)
//  - click the middle to go back to the normal angled view
//  - keys like Blender's numpad: 1 front, 3 right, 7 top (Ctrl + the key for the opposite side), 5 angled view
import * as THREE from "three";

const AXES = [
  { dir: [1, 0, 0], color: "#ff3653", label: "X", name: "Right" },
  { dir: [0, 1, 0], color: "#8adb00", label: "Y", name: "Top" },
  { dir: [0, 0, 1], color: "#2c8fff", label: "Z", name: "Front" },
  { dir: [-1, 0, 0], color: "#ff3653", label: "", name: "Left" },
  { dir: [0, -1, 0], color: "#8adb00", label: "", name: "Bottom" },
  { dir: [0, 0, -1], color: "#2c8fff", label: "", name: "Back" },
];
const SIZE = 112;        // css pixels
const R = 40;            // how far the balls sit from the middle
const BALL = 10;

export class ViewAxis {
  /** parent: the element to put it in; camera + controls (OrbitControls); home(): the normal angled view */
  constructor(parent, camera, controls, home) {
    Object.assign(this, { camera, controls, home });
    const c = (this.canvas = document.createElement("canvas"));
    c.className = "view-axis";
    c.width = c.height = SIZE * Math.min(devicePixelRatio || 1, 2);
    c.title = "Click a ball to look from that side. Middle: angled view.";
    parent.appendChild(c);
    this.ctx = c.getContext("2d");
    this._spots = [];
    this._hover = null;
    c.addEventListener("pointermove", (e) => { this._hover = this._hit(e); c.style.cursor = this._hover ? "pointer" : "default"; });
    c.addEventListener("pointerleave", () => { this._hover = null; });
    c.addEventListener("click", (e) => {
      const h = this._hit(e);
      if (h === "home") this.goHome();
      else if (h) this.snap(h.dir);
    });
    this._onKey = (e) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      const k = e.code.replace(/^(Digit|Numpad)/, "");
      const side = { 1: [0, 0, 1], 3: [1, 0, 0], 7: [0, 1, 0] }[k];
      if (side) { e.preventDefault(); this.snap(e.ctrlKey ? side.map((v) => -v) : side); }
      else if (k === "5") { e.preventDefault(); this.goHome(); }
    };
    addEventListener("keydown", this._onKey);
  }

  dispose() {
    removeEventListener("keydown", this._onKey);
    this.canvas.remove();
  }

  _hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    for (const s of [...this._spots].reverse()) if (Math.hypot(x - s.x, y - s.y) <= BALL + 3) return s.axis;  // front-most first
    return Math.hypot(x - SIZE / 2, y - SIZE / 2) < 12 ? "home" : null;
  }

  /** look along -dir from the dir side, keeping the same distance; animated */
  snap(dir) {
    const t = this.controls.target;
    const dist = this.camera.position.distanceTo(t);
    const d = new THREE.Vector3(...dir).normalize();
    if (Math.abs(d.y) > 0.99) d.z += 0.0001;            // straight up/down: a hair off so the camera keeps its "up"
    this._fly(t.clone().addScaledVector(d.normalize(), dist));
  }

  goHome() {
    const from = this.camera.position.clone(), target = this.controls.target.clone();
    this.home();                                         // sets the camera to the angled view
    const to = this.camera.position.clone();
    this.camera.position.copy(from);
    this.controls.target.copy(target);
    this._fly(to, this.controls.target.clone());
  }

  _fly(to, newTarget = null) {
    const t = this.controls.target.clone();
    const end = newTarget || t;
    const a = this.camera.position.clone().sub(t), b = to.clone().sub(end);
    const la = a.length(), lb = b.length();
    const qa = new THREE.Quaternion(), q = new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / 260);
      const e = 1 - Math.pow(1 - k, 3);
      const target = t.clone().lerp(end, e);
      const dir = a.clone().normalize().applyQuaternion(qa.clone().slerp(q, e));
      this.camera.position.copy(target).addScaledVector(dir, la + (lb - la) * e);
      this.controls.target.copy(target);
      this.camera.lookAt(target);
      if (k < 1) this._anim = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this._anim);
    step();
  }

  /** call once per frame */
  update() {
    const ctx = this.ctx, s = this.canvas.width / SIZE;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    const mid = SIZE / 2;
    ctx.beginPath();
    ctx.arc(mid, mid, R + BALL + 4, 0, Math.PI * 2);
    ctx.fillStyle = this._hover ? "rgba(255,255,255,.10)" : "rgba(255,255,255,.05)";
    ctx.fill();
    const inv = this.camera.quaternion.clone().invert();
    this._spots = AXES.map((axis) => {
      const v = new THREE.Vector3(...axis.dir).applyQuaternion(inv);    // the axis as the camera sees it
      return { axis, x: mid + v.x * R, y: mid - v.y * R, z: v.z };
    }).sort((p, q) => p.z - q.z);                                          // far ones first, near ones on top
    for (const p of this._spots) {
      const pos = !!p.axis.label;
      if (pos) {
        ctx.beginPath(); ctx.moveTo(mid, mid); ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = p.axis.color; ctx.lineWidth = 2.5; ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, pos ? BALL : BALL - 2, 0, Math.PI * 2);
      ctx.globalAlpha = pos ? 1 : 0.45;
      ctx.fillStyle = p.axis.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (this._hover === p.axis) { ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke(); }
      if (pos) {
        ctx.fillStyle = "#101318"; ctx.font = "bold 11px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.axis.label, p.x, p.y + 0.5);
      }
    }
    this.canvas.title = this._hover && this._hover !== "home" ? `${this._hover.name} view` : "Click a ball to look from that side. Middle: angled view.";
  }
}
