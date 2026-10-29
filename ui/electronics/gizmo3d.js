// gizmo3d.js - Blender-style 3D Transform Axis Gizmo (RGB X/Y/Z arrows + planar handles + infinite axis lines + G/X/Y/Z shortcuts)
// and interactive top-right Corner Orientation Axes widget for the 3D builders (ui/builder/ and ui/electronics/).
import * as THREE from "three";

export const AXIS_COLORS = {
  x: { hex: 0xff3653, css: "#ff3653", hi: 0xff8fa0, label: "X" },
  y: { hex: 0x70dd00, css: "#70dd00", hi: 0xb8ff66, label: "Y" },
  z: { hex: 0x2c8fff, css: "#2c8fff", hi: 0x82c2ff, label: "Z" },
  xyz: { hex: 0xffffff, css: "#ffffff", hi: 0xffee77, label: "XYZ" },
};

const UNIT_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};

export class AxisGizmo {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {HTMLElement} opts.domElement - renderer.domElement
   * @param {any} opts.controls - OrbitControls
   * @param {HTMLElement} [opts.stage] - container element for corner orientation gizmo & status pill
   * @param {(target: THREE.Object3D, worldPos: THREE.Vector3, deltaWorld: THREE.Vector3, axis: string) => void} [opts.onMove]
   * @param {(target: THREE.Object3D, axis: string) => void} [opts.onMoveEnd]
   * @param {() => boolean} [opts.isEnabled]
   */
  constructor(opts) {
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.domElement = opts.domElement;
    this.controls = opts.controls;
    this.stage = opts.stage || opts.domElement.parentElement;
    this.onMove = opts.onMove || null;
    this.onMoveEnd = opts.onMoveEnd || null;
    this.onDelete = opts.onDelete || null;
    this.isEnabled = opts.isEnabled || (() => true);

    this.target = null;
    this.hoveredAxis = null;
    this.activeAxis = null;
    this.dragging = null; // { mode: "drag"|"grab", axis, startWorld, startLocal, plane, hitOffset, lastMouse }
    this.ray = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.lastPointer = new THREE.Vector2();

    this.root = new THREE.Group();
    this.root.name = "BlenderAxisGizmo";
    this.root.visible = false;
    this.root.renderOrder = 999;
    this.scene.add(this.root);

    this.pickables = [];
    this.visuals = { x: [], y: [], z: [], xy: [], xz: [], yz: [], xyz: [] };
    this._buildGizmoMeshes();
    this._buildGuideLines();
    this._buildCornerWidget();
    this._bindEvents();
  }

  _mat(color, opacity = 0.95) {
    return new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  }

  _hitMat() {
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
  }

  _buildGizmoMeshes() {
    const shaftLen = 0.52;
    const shaftR = 0.016;
    const headLen = 0.15;
    const headR = 0.055;

    const makeArrow = (axis, col, rot) => {
      const g = new THREE.Group();
      if (rot) g.rotation.set(rot[0], rot[1], rot[2]);

      const mat = this._mat(col);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 14), mat);
      shaft.position.y = shaftLen / 2 + 0.06;
      shaft.renderOrder = 999;

      const head = new THREE.Mesh(new THREE.ConeGeometry(headR, headLen, 18), mat);
      head.position.y = shaftLen + 0.06 + headLen / 2;
      head.renderOrder = 999;

      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, shaftLen + headLen + 0.12, 10), this._hitMat());
      hit.position.y = (shaftLen + headLen) / 2 + 0.05;
      hit.userData.gizmoAxis = axis;
      hit.renderOrder = 1000;

      g.add(shaft, head, hit);
      this.root.add(g);
      this.pickables.push(hit);
      this.visuals[axis].push({ mesh: shaft, baseColor: col, baseOpacity: 0.96 }, { mesh: head, baseColor: col, baseOpacity: 0.96 });
    };

    makeArrow("x", AXIS_COLORS.x.hex, [0, 0, -Math.PI / 2]);
    makeArrow("y", AXIS_COLORS.y.hex, [0, 0, 0]);
    makeArrow("z", AXIS_COLORS.z.hex, [Math.PI / 2, 0, 0]);

    // Planar handles (XY, XZ, YZ) like Blender
    const makePlane = (axis, col, pos, rot) => {
      const mat = this._mat(col, 0.45);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), mat);
      m.position.set(pos[0], pos[1], pos[2]);
      m.rotation.set(rot[0], rot[1], rot[2]);
      m.renderOrder = 998;
      m.userData.gizmoAxis = axis;
      this.root.add(m);
      this.pickables.push(m);
      this.visuals[axis].push({ mesh: m, baseColor: col, baseOpacity: 0.45 });
    };
    makePlane("xy", AXIS_COLORS.z.hex, [0.20, 0.20, 0], [0, 0, 0]);
    makePlane("xz", AXIS_COLORS.y.hex, [0.20, 0, 0.20], [Math.PI / 2, 0, 0]);
    makePlane("yz", AXIS_COLORS.x.hex, [0, 0.20, 0.20], [0, Math.PI / 2, 0]);

    // Center white sphere/ring for free camera-plane translation
    const cMat = this._mat(AXIS_COLORS.xyz.hex, 0.9);
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), cMat);
    center.renderOrder = 1001;
    center.userData.gizmoAxis = "xyz";
    this.root.add(center);
    this.pickables.push(center);
    this.visuals.xyz.push({ mesh: center, baseColor: AXIS_COLORS.xyz.hex, baseOpacity: 0.9 });
  }

  _buildGuideLines() {
    this.guideGroup = new THREE.Group();
    this.guideGroup.renderOrder = 995;
    this.scene.add(this.guideGroup);
    this.guideLines = {};
    for (const [ax, info] of Object.entries(AXIS_COLORS)) {
      if (!UNIT_AXES[ax]) continue;
      const dir = UNIT_AXES[ax];
      const pts = [dir.clone().multiplyScalar(-1000), dir.clone().multiplyScalar(1000)];
      const geom = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({
          color: info.hex,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.85,
          toneMapped: false,
        })
      );
      line.visible = false;
      line.renderOrder = 995;
      this.guideGroup.add(line);
      this.guideLines[ax] = line;
    }
  }

  _showGuides(axis) {
    for (const [k, line] of Object.entries(this.guideLines)) {
      line.visible = axis === k || (axis && axis.length === 2 && axis.includes(k));
    }
    if (this.target) {
      this.target.getWorldPosition(this.guideGroup.position);
    }
  }

  _highlightAxis(axis) {
    if (this.hoveredAxis === axis) return;
    this.hoveredAxis = axis;
    for (const [k, list] of Object.entries(this.visuals)) {
      const on = k === axis || (axis && axis.length === 2 && axis.includes(k));
      for (const item of list) {
        item.mesh.material.color.setHex(on ? 0xffff66 : item.baseColor);
        item.mesh.material.opacity = on ? 1.0 : item.baseOpacity;
      }
    }
  }

  attach(object) {
    if (this.dragging?.mode === "grab") this._cancelGrab();
    this.target = object || null;
    this.root.visible = !!this.target;
    this._showGuides(null);
    this.update();
    this._updateHud();
  }

  detach() {
    this.attach(null);
  }

  update() {
    if (this.target && this.root.visible) {
      this.target.updateMatrixWorld(true);
      const wp = this.target.getWorldPosition(new THREE.Vector3());
      this.root.position.copy(wp);
      if (this.dragging) this.guideGroup.position.copy(wp);
      const dist = Math.max(0.5, this.camera.position.distanceTo(wp));
      const scale = dist * 0.075;
      this.root.scale.setScalar(scale);
    }
    this._drawCornerWidget();
  }

  // ---------------- Raycasting & Pointer Dragging ----------------
  _setMouse(ev) {
    const r = this.domElement.getBoundingClientRect();
    this.mouse.set(((ev.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, -((ev.clientY - r.top) / Math.max(1, r.height)) * 2 + 1);
    this.lastPointer.set(ev.clientX, ev.clientY);
  }

  _pickGizmo(ev) {
    if (!this.target || !this.root.visible || !this.isEnabled()) return null;
    this._setMouse(ev);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects(this.pickables, false);
    return hits[0]?.object?.userData?.gizmoAxis || null;
  }

  _makeDragPlane(axis, origin) {
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    let normal = camDir.clone().negate();
    if (axis === "x" || axis === "y" || axis === "z") {
      const ax = UNIT_AXES[axis];
      const side = new THREE.Vector3().crossVectors(ax, camDir);
      if (side.lengthSq() > 1e-6) normal.crossVectors(ax, side).normalize();
    } else if (axis === "xy") normal.set(0, 0, 1);
    else if (axis === "xz") normal.set(0, 1, 0);
    else if (axis === "yz") normal.set(1, 0, 0);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  }

  _constrainDelta(delta, axis) {
    const out = new THREE.Vector3();
    if (axis === "x") out.x = delta.x;
    else if (axis === "y") out.y = delta.y;
    else if (axis === "z") out.z = delta.z;
    else if (axis === "xy") { out.x = delta.x; out.y = delta.y; }
    else if (axis === "xz") { out.x = delta.x; out.z = delta.z; }
    else if (axis === "yz") { out.y = delta.y; out.z = delta.z; }
    else out.copy(delta);
    return out;
  }

  _applyWorldPosition(newWorldPos, axis) {
    if (!this.target) return;
    const deltaWorld = newWorldPos.clone().sub(this.dragging.startWorld);
    if (this.target.parent) {
      const local = this.target.parent.worldToLocal(newWorldPos.clone());
      this.target.position.copy(local);
    } else {
      this.target.position.copy(newWorldPos);
    }
    this.target.updateMatrixWorld(true);
    if (this.onMove) {
      this.onMove(this.target, newWorldPos, deltaWorld, axis);
    }
    this.update();
    this._updateHud(deltaWorld, axis);
  }

  _startAxisDrag(axis, ev, mode = "drag") {
    if (!this.target) return;
    this.target.updateMatrixWorld(true);
    const startWorld = this.target.getWorldPosition(new THREE.Vector3());
    const startLocal = this.target.position.clone();
    const plane = this._makeDragPlane(axis, startWorld);
    this._setMouse(ev);
    this.ray.setFromCamera(this.mouse, this.camera);
    const hitPoint = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, hitPoint)) hitPoint.copy(startWorld);
    this.dragging = {
      mode,
      axis,
      startWorld,
      startLocal,
      plane,
      startHit: hitPoint.clone(),
    };
    this.activeAxis = axis;
    this._highlightAxis(axis);
    this._showGuides(axis);
    if (this.controls) this.controls.enabled = false;
    this._updateHud(new THREE.Vector3(), axis);
  }

  _cancelGrab() {
    if (!this.dragging || !this.target) return;
    const { startWorld, startLocal, axis } = this.dragging;
    if (this.onMove) {
      this.onMove(this.target, startWorld.clone(), new THREE.Vector3(), axis);
    } else {
      this.target.position.copy(startLocal);
    }
    this.dragging = null;
    this.activeAxis = null;
    this._highlightAxis(null);
    this._showGuides(null);
    if (this.controls) this.controls.enabled = true;
    this.update();
    this._updateHud();
  }

  _finishDrag() {
    if (!this.dragging) return;
    const { axis } = this.dragging;
    this.dragging = null;
    this.activeAxis = null;
    this._showGuides(null);
    if (this.controls) this.controls.enabled = true;
    if (this.target && this.onMoveEnd) this.onMoveEnd(this.target, axis);
    this.update();
    this._updateHud();
  }

  _bindEvents() {
    // Capture pointerdown on domElement so gizmo arrows take priority over normal scene picking
    this.domElement.addEventListener(
      "pointerdown",
      (ev) => {
        if (!this.isEnabled() || !this.target || !this.root.visible) return;
        if (this.dragging?.mode === "grab") {
          ev.stopImmediatePropagation();
          ev.preventDefault();
          if (ev.button === 2) this._cancelGrab();
          else this._finishDrag();
          return;
        }
        if (ev.button !== 0) return;
        const axis = this._pickGizmo(ev);
        if (!axis) return;
        ev.stopImmediatePropagation();
        ev.preventDefault();
        this._startAxisDrag(axis, ev, "drag");
      },
      true
    );

    window.addEventListener(
      "pointermove",
      (ev) => {
        this.lastPointer.set(ev.clientX, ev.clientY);
        if (this.dragging && this.target) {
          this._setMouse(ev);
          this.ray.setFromCamera(this.mouse, this.camera);
          const hit = new THREE.Vector3();
          if (this.ray.ray.intersectPlane(this.dragging.plane, hit)) {
            const rawDelta = hit.sub(this.dragging.startHit);
            const delta = this._constrainDelta(rawDelta, this.dragging.axis);
            const newWorld = this.dragging.startWorld.clone().add(delta);
            this._applyWorldPosition(newWorld, this.dragging.axis);
          }
          return;
        }
        if (!this.target || !this.root.visible || !this.isEnabled()) return;
        const axis = this._pickGizmo(ev);
        this._highlightAxis(axis);
        if (axis) this.domElement.style.cursor = "grab";
        else if (this.domElement.style.cursor === "grab") this.domElement.style.cursor = "";
      },
      true
    );

    window.addEventListener(
      "pointerup",
      () => {
        if (this.dragging?.mode === "drag") {
          this._finishDrag();
        }
      },
      true
    );

    // Blender-style keyboard shortcuts: G (grab), X / Y / Z (constrain to axis), Enter (confirm), Escape (cancel)
    window.addEventListener("keydown", (ev) => {
      if (!this.isEnabled() || !this.target || !this.root.visible) return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
      const k = ev.key.toLowerCase();

      if (k === "g" && !ev.ctrlKey && !ev.metaKey) {
        ev.preventDefault();
        if (this.dragging?.mode === "grab") return;
        const fakeEv = { clientX: this.lastPointer.x || window.innerWidth / 2, clientY: this.lastPointer.y || window.innerHeight / 2 };
        this._startAxisDrag("xyz", fakeEv, "grab");
        return;
      }

      if ((k === "x" || k === "y" || k === "z") && !ev.ctrlKey && !ev.metaKey) {
        if (this.dragging) {
          ev.preventDefault();
          // Switch active drag/grab constraint to X, Y, or Z (or Shift+X/Y/Z for planar YZ/XZ/XY like Blender!)
          const newAxis = ev.shiftKey ? { x: "yz", y: "xz", z: "xy" }[k] : k;
          this.dragging.axis = this.dragging.axis === newAxis ? "xyz" : newAxis;
          this.dragging.plane = this._makeDragPlane(this.dragging.axis, this.dragging.startWorld);
          this.ray.setFromCamera(this.mouse, this.camera);
          this.ray.ray.intersectPlane(this.dragging.plane, this.dragging.startHit);
          this._highlightAxis(this.dragging.axis);
          this._showGuides(this.dragging.axis);
          this._applyWorldPosition(this.dragging.startWorld, this.dragging.axis);
        }
        return;
      }

      if (this.dragging?.mode === "grab") {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          this._cancelGrab();
        } else if (ev.key === "Enter") {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          this._finishDrag();
        }
      }
    });
  }

  // ---------------- Blender-style Top-Right Corner Orientation Axes + HUD ----------------
  _buildCornerWidget() {
    if (!this.stage) return;
    const wrap = document.createElement("div");
    wrap.className = "blender-gizmo-ui";
    Object.assign(wrap.style, {
      position: "absolute",
      right: "12px",
      top: "12px",
      zIndex: "8",
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: "6px",
      pointerEvents: "none",
      userSelect: "none",
    });

    const cv = document.createElement("canvas");
    cv.width = 104;
    cv.height = 104;
    cv.title = "Blender View Axes: click X (red), Y (green) or Z (blue) to snap camera view";
    Object.assign(cv.style, {
      width: "92px",
      height: "92px",
      pointerEvents: "auto",
      cursor: "pointer",
      borderRadius: "50%",
      background: "radial-gradient(circle, rgba(25,32,44,0.68) 0%, rgba(15,20,28,0.25) 70%, transparent 72%)",
    });

    const hud = document.createElement("div");
    hud.className = "blender-gizmo-hud";
    Object.assign(hud.style, {
      background: "rgba(13, 18, 26, 0.88)",
      border: "1px solid rgba(255, 255, 255, 0.14)",
      borderRadius: "8px",
      padding: "4px 9px",
      fontSize: "11.5px",
      fontWeight: "700",
      color: "#dfe6f0",
      whiteSpace: "nowrap",
      backdropFilter: "blur(4px)",
    });
    hud.hidden = true;

    wrap.append(cv, hud);
    this.stage.append(wrap);
    this.cornerCanvas = cv;
    this.hudEl = hud;
    this.cornerNodes = [];

    cv.addEventListener("click", (ev) => {
      const r = cv.getBoundingClientRect();
      const mx = ((ev.clientX - r.left) / r.width) * cv.width;
      const my = ((ev.clientY - r.top) / r.height) * cv.height;
      for (let i = this.cornerNodes.length - 1; i >= 0; i--) {
        const n = this.cornerNodes[i];
        if (Math.hypot(mx - n.sx, my - n.sy) <= n.rad + 4) {
          this._snapCameraToAxis(n.dir);
          break;
        }
      }
    });
  }

  _snapCameraToAxis(dir) {
    if (!this.controls) return;
    const target = this.controls.target.clone();
    const dist = Math.max(2, this.camera.position.distanceTo(target));
    const offset = dir.clone().multiplyScalar(dist);
    // Avoid exact gimbal lock on +/-Y by adding a tiny Z offset
    if (Math.abs(dir.y) > 0.99) offset.z += 0.001 * dist;
    this.camera.position.copy(target).add(offset);
    this.controls.update();
  }

  _drawCornerWidget() {
    const cv = this.cornerCanvas;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, len = 36;
    ctx.clearRect(0, 0, W, H);

    const q = this.camera.quaternion.clone().invert();
    const dirs = [
      { key: "+x", label: "X", dir: new THREE.Vector3(1, 0, 0), color: AXIS_COLORS.x.css, pos: true },
      { key: "-x", label: "", dir: new THREE.Vector3(-1, 0, 0), color: AXIS_COLORS.x.css, pos: false },
      { key: "+y", label: "Y", dir: new THREE.Vector3(0, 1, 0), color: AXIS_COLORS.y.css, pos: true },
      { key: "-y", label: "", dir: new THREE.Vector3(0, -1, 0), color: AXIS_COLORS.y.css, pos: false },
      { key: "+z", label: "Z", dir: new THREE.Vector3(0, 0, 1), color: AXIS_COLORS.z.css, pos: true },
      { key: "-z", label: "", dir: new THREE.Vector3(0, 0, -1), color: AXIS_COLORS.z.css, pos: false },
    ];

    const nodes = dirs.map((d) => {
      const v = d.dir.clone().applyQuaternion(q);
      return {
        ...d,
        sx: cx + v.x * len,
        sy: cy - v.y * len,
        z: v.z,
        rad: d.pos ? 9.5 : 6.5,
      };
    });
    // Painter's algorithm: back-to-front
    nodes.sort((a, b) => a.z - b.z);
    this.cornerNodes = nodes;

    for (const n of nodes) {
      if (n.pos) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(n.sx, n.sy);
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 2.4;
        ctx.globalAlpha = n.z < 0 ? 0.55 : 0.95;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, n.rad, 0, Math.PI * 2);
      ctx.globalAlpha = n.z < 0 ? 0.65 : 1.0;
      if (n.pos) {
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.fillStyle = "#0b0f16";
        ctx.font = "bold 11px Nunito, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.label, n.sx, n.sy + 0.5);
      } else {
        ctx.fillStyle = "#18202c";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = n.color;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1.0;
  }

  _updateHud(delta, axis) {
    if (!this.hudEl) return;
    if (!this.target || !this.root.visible) {
      this.hudEl.hidden = true;
      return;
    }
    this.hudEl.hidden = false;
    const delHtml = this.onDelete
      ? `<button id="btnGizmoDelete" type="button" style="pointer-events:auto;margin-left:8px;background:#e53e3e;color:#fff;border:none;border-radius:4px;padding:3px 9px;font-size:11px;font-weight:700;cursor:pointer;line-height:1;transition:background 0.15s;" onmouseover="this.style.background='#c53030'" onmouseout="this.style.background='#e53e3e'">🗑 Delete</button>`
      : "";
    if (this.dragging && delta) {
      const axName = (axis || "xyz").toUpperCase();
      this.hudEl.innerHTML = `<span style="color:${AXIS_COLORS[axis]?.css || "#ffe066"}">Axis ${axName}</span> · ΔX ${delta.x.toFixed(2)} · ΔY ${delta.y.toFixed(2)} · ΔZ ${delta.z.toFixed(2)}${delHtml}`;
    } else {
      const p = this.target.position;
      this.hudEl.innerHTML = `<span style="color:#ff3653">X</span> ${p.x.toFixed(2)} · <span style="color:#70dd00">Y</span> ${p.y.toFixed(2)} · <span style="color:#2c8fff">Z</span> ${p.z.toFixed(2)} <span style="opacity:.7;font-weight:600">(Drag arrows or G / X / Y / Z)</span>${delHtml}`;
    }
    const btn = this.hudEl.querySelector("#btnGizmoDelete");
    if (btn) {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (this.target && this.onDelete) this.onDelete(this.target);
      };
    }
  }
}
