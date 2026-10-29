// view2d.js - the Circuit Lab's 2D editor (SVG). 1 unit = 1 breadboard hole (0.1 inch).
// Drag parts to move them, click a pin or hole to start a wire and click another to finish it (click empty space to add
// a bend), R rotates, Delete removes, the mouse wheel zooms, dragging the background pans. While simulating you can
// press buttons by holding the mouse on them.
import { PARTS, pinsOf, pinWorld } from "./parts.js";

const NS = "http://www.w3.org/2000/svg";
const mk = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

export class View2D {
  constructor(host, lab) {
    this.lab = lab;                                   // {project, selection, simulating, select(), changed(), press()}
    this.svg = mk("svg", { class: "lab-svg", tabindex: "0" });
    this.svg.innerHTML = `<defs>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.6"/></filter>
      <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="0.04"/></pattern></defs>
      <rect class="bg" x="-5000" y="-5000" width="10000" height="10000" fill="url(#grid)"/>`;
    this.world = mk("g");
    this.partsLayer = mk("g"); this.wiresLayer = mk("g"); this.overlay = mk("g");
    this.world.append(this.partsLayer, this.wiresLayer, this.overlay);
    this.svg.append(this.world);
    host.append(this.svg);
    this.tip = Object.assign(document.createElement("div"), { className: "lab-tip", hidden: true });
    host.append(this.tip);
    this.view = { x: 40, y: 40, z: 14 };
    this.groups = new Map();
    this.wiring = null;          // {from: {p, pin}, pts: [[x,y]]}
    this.drag = null;
    this.bind();
  }

  // ---------------- coordinates ----------------
  toWorld(e) {
    const r = this.svg.getBoundingClientRect();
    return [(e.clientX - r.left - this.view.x) / this.view.z, (e.clientY - r.top - this.view.y) / this.view.z];
  }
  applyView() { this.world.setAttribute("transform", `translate(${this.view.x} ${this.view.y}) scale(${this.view.z})`); }
  fit() {
    const ps = this.lab.project.parts;
    if (!ps.length) { this.view = { x: 60, y: 60, z: 14 }; return this.applyView(); }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of ps) { const d = PARTS[p.type]; if (!d) continue; for (const q of pinsOf(p.type)) { const [x, y] = pinWorld(p, q); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
    const r = this.svg.getBoundingClientRect();
    const z = Math.max(4, Math.min(30, Math.min((r.width - 80) / (x1 - x0 + 12), (r.height - 80) / (y1 - y0 + 16))));
    this.view = { z, x: r.width / 2 - ((x0 + x1) / 2) * z, y: r.height / 2 - ((y0 + y1) / 2 - 3) * z };
    this.applyView();
  }

  // ---------------- pins under the mouse ----------------
  indexPins() {
    this.pinAt = new Map();
    for (const part of this.lab.project.parts) {
      if (!PARTS[part.type]) continue;
      for (const p of pinsOf(part.type)) {
        const k = pinWorld(part, p).join(",");
        const list = this.pinAt.get(k) || [];
        list.push({ part, pin: p });
        this.pinAt.set(k, list);
      }
    }
  }
  findPin(x, y) {
    const rx = Math.round(x), ry = Math.round(y);
    if (Math.hypot(x - rx, y - ry) > 0.45) return null;
    const list = this.pinAt.get(`${rx},${ry}`);
    if (!list) return null;
    return list.find((c) => !c.part.type.startsWith("breadboard")) || list[0];      // a leg in a hole wins
  }

  // ---------------- drawing ----------------
  render() {
    const { project } = this.lab;
    this.indexPins();
    this.partsLayer.replaceChildren(); this.groups.clear();
    const order = [...project.parts].sort((a, b) => (PARTS[a.type]?.z ?? 2) - (PARTS[b.type]?.z ?? 2));
    for (const part of order) {
      const def = PARTS[part.type]; if (!def) continue;
      const g = mk("g", { class: `part${this.lab.selection?.part === part.id ? " sel" : ""}`, "data-id": part.id,
        transform: `translate(${part.x} ${part.y}) rotate(${part.rot || 0})` });
      g.innerHTML = def.draw2d(part);
      const holes = mk("g", { class: def.board ? "holes" : "pins" });
      for (const p of pinsOf(part.type)) holes.append(mk("rect", { x: p.x - 0.22, y: p.y - 0.22, width: 0.44, height: 0.44, rx: 0.06, class: "pin" }));
      g.append(holes);
      if (!def.board && !def.mcu) {
        const t = mk("text", { x: 0, y: 1.3, class: "plabel" }); t.textContent = part.label || part.id; g.append(t);
      }
      this.partsLayer.append(g);
      this.groups.set(part.id, g);
    }
    this.renderWires();
    this.applyView();
  }

  wirePoints(w) {
    const P = (end) => { const part = this.lab.project.parts.find((p) => p.id === end.p); const pin = part && pinsOf(part.type).find((q) => q.id === end.pin); return part && pin ? pinWorld(part, pin) : null; };
    const a = P(w.a), b = P(w.b);
    if (!a || !b) return null;
    if (w.pts?.length) return [a, ...w.pts, b];
    // no bends: a soft L shape, like Tinkercad
    return Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01 ? [a, b] : [a, [b[0], a[1]], b];
  }

  renderWires() {
    this.wiresLayer.replaceChildren();
    this.lab.project.wires.forEach((w, i) => {
      const pts = this.wirePoints(w); if (!pts) return;
      const d = pts.map((p) => p.join(",")).join(" ");
      const sel = this.lab.selection?.wire === i;
      const g = mk("g", { class: `wire${sel ? " sel" : ""}`, "data-wire": i });
      g.append(mk("polyline", { points: d, class: "hit" }), mk("polyline", { points: d, stroke: w.color || "#2f8f3a", class: "line" }));
      for (const p of [pts[0], pts[pts.length - 1]]) g.append(mk("circle", { cx: p[0], cy: p[1], r: 0.28, fill: w.color || "#2f8f3a" }));
      this.wiresLayer.append(g);
    });
  }

  update(st) {                                     // every frame while simulating
    for (const part of this.lab.project.parts) {
      const def = PARTS[part.type], g = this.groups.get(part.id);
      if (def?.update2d && g) def.update2d(g, part, st[part.id] || {});
    }
  }

  drawRubber(to) {
    this.overlay.replaceChildren();
    if (!this.wiring) return;
    const pts = [this.wiring.start, ...this.wiring.pts, to];
    this.overlay.append(mk("polyline", { points: pts.map((p) => p.join(",")).join(" "), class: "rubber", stroke: this.lab.wireColor }));
  }

  // ---------------- input ----------------
  bind() {
    const svg = this.svg;
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const z = Math.max(3, Math.min(60, this.view.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      this.view.x = mx - (mx - this.view.x) * z / this.view.z; this.view.y = my - (my - this.view.y) * z / this.view.z; this.view.z = z;
      this.applyView();
    }, { passive: false });
    svg.addEventListener("contextmenu", (e) => { e.preventDefault(); this.cancelWire(); });
    svg.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    svg.addEventListener("drop", (e) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("part-type") || e.dataTransfer.getData("text/plain");
      if (!type || !PARTS[type]) return;
      const [x, y] = this.toWorld(e);
      this.lab.placing = type;
      this.lab.place(Math.round(x), Math.round(y));
    });
    svg.addEventListener("pointerdown", (e) => this.down(e));
    svg.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", (e) => this.up(e));
  }

  down(e) {
    if (e.button === 1 || e.button === 2) { this.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y }; return; }
    this.svg.focus();
    const [x, y] = this.toWorld(e);
    const lab = this.lab;
    if (lab.placing) { lab.place(Math.round(x), Math.round(y)); return; }
    const partG = e.target.closest?.(".part"), wireG = e.target.closest?.(".wire");
    const part = partG && lab.project.parts.find((p) => p.id === partG.dataset.id);
    if (lab.simulating) {                          // simulating: buttons can be pressed, nothing is edited
      if (part && PARTS[part.type].press) { this.pressing = part.id; lab.press(part.id, true); }
      else if (part) lab.select({ part: part.id });
      else this.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
      return;
    }
    const hit = this.findPin(x, y);
    if (this.wiring) {
      if (hit) return this.finishWire(hit);
      this.wiring.pts.push([Math.round(x * 2) / 2, Math.round(y * 2) / 2]);
      return;
    }
    if (hit && !(part && !part.type.startsWith("breadboard") && !PARTS[part.type].board && e.shiftKey)) {
      this.wiring = { from: { p: hit.part.id, pin: hit.pin.id }, start: pinWorld(hit.part, hit.pin), pts: [] };
      this.drawRubber([x, y]);
      return;
    }
    if (wireG) { lab.select({ wire: +wireG.dataset.wire }); return; }
    if (part) {
      lab.select({ part: part.id });
      this.drag = { part, ox: x - part.x, oy: y - part.y, moved: false };
      svg.setPointerCapture?.(e.pointerId);
      return;
    }
    lab.select(null);
    this.drag = { pan: true, sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
  }

  move(e) {
    const [x, y] = this.toWorld(e);
    if (this.wiring) this.drawRubber([x, y]);
    if (this.lab.placing) this.lab.ghost?.(Math.round(x), Math.round(y));
    if (this.drag?.pan) {
      this.view.x = this.drag.vx + e.clientX - this.drag.sx; this.view.y = this.drag.vy + e.clientY - this.drag.sy; this.applyView();
    } else if (this.drag?.part) {
      const nx = Math.round(x - this.drag.ox), ny = Math.round(y - this.drag.oy);
      if (nx !== this.drag.part.x || ny !== this.drag.part.y) {
        this.drag.part.x = nx; this.drag.part.y = ny; this.drag.moved = true;
        this.groups.get(this.drag.part.id)?.setAttribute("transform", `translate(${nx} ${ny}) rotate(${this.drag.part.rot || 0})`);
        this.indexPins(); this.renderWires();
      }
    }
    this.hover(e, x, y);
  }

  up() {
    if (this.pressing) { this.lab.press(this.pressing, false); this.pressing = null; }
    if (this.drag?.part && this.drag.moved) this.lab.changed("move");
    this.drag = null;
  }

  hover(e, x, y) {
    const hit = this.findPin(x, y);
    if (!hit) { this.tip.hidden = true; return; }
    const v = this.lab.voltageAt?.(hit.part, hit.pin.id);
    const name = PARTS[hit.part.type].board && hit.part.type.startsWith("breadboard") ? `hole ${hit.pin.label}` : `${hit.part.label || hit.part.id} · ${hit.pin.label}`;
    this.tip.textContent = v == null ? name : `${name} · ${v.toFixed(2)} V`;
    const r = this.svg.getBoundingClientRect();
    Object.assign(this.tip.style, { left: `${e.clientX - r.left + 14}px`, top: `${e.clientY - r.top + 10}px` });
    this.tip.hidden = false;
  }

  finishWire(hit) {
    const w = this.wiring; this.wiring = null; this.overlay.replaceChildren();
    if (w.from.p === hit.part.id && w.from.pin === hit.pin.id) return;
    this.lab.project.wires.push({ a: w.from, b: { p: hit.part.id, pin: hit.pin.id }, color: this.lab.wireColor, pts: w.pts });
    this.lab.changed("wire");
  }
  cancelWire() { this.wiring = null; this.overlay.replaceChildren(); }
}
