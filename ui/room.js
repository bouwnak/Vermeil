// room.js - renders the cozy room and the character standing in it.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CozyRoom, CATALOG } from "./cozyroom.js";
import { inPlace } from "./inplace.js";
import { buildGymRoom, GYM_LAYOUT } from "./gymroom.js";

const INK = 0x2e2135;
const CHAR_HEIGHT = 1.6;            // every model is scaled to about this height (metres)
const WALK_SPEED = 1.1;             // metres per second
const HOME = new THREE.Vector3(0.4, 0, 0.7);   // middle of the rug
const MOUTH = /(jaw|mouth.?open|^aa$|v_aa|mouth_a\b|vrc\.v_aa)/i;
const _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1);
// How a character uses furniture (only models that have these animations do it):
//   clip = animation, seat = seat height (m), at = where the hips go [x, z] in the furniture's own space (its front is +z)
const FURNITURE = {
  chair: { clip: "sit", seat: 0.55, at: [0, 0.02] },
  woodChair: { clip: "sit", seat: 0.52, at: [0, 0.03] },
  sofa: { clip: "lounge", seat: 0.55, at: [0.55, 0.15] },
  dayBed: { clip: "lounge", seat: 0.56, at: [-0.4, 0.1] },
  beanBag: { clip: "lounge", seat: 0.42, at: [0, 0.12] },
  bed: { clip: "lie", seat: 0.57, at: [0.3, 0.25] },
  denBed: { clip: "lie", seat: 0.7, at: [0.25, 0.1] },
  denSofa: { clip: "lounge", seat: 0.62, at: [0.5, 0.12] },
  denArmchair: { clip: "sit", seat: 0.56, at: [0, 0.06] },
  denChair: { clip: "sit", seat: 0.52, at: [0, 0.03] },
  denBeanBag: { clip: "lounge", seat: 0.45, at: [0, 0.1] },
  denStool: { clip: "sit", seat: 0.5, at: [0, 0] },
};
const SEAT_IN_CLIP = 0.5;                  // the seat height the animations were made for
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const _earQ = new THREE.Quaternion(), _earQ2 = new THREE.Quaternion();

export class Room {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.speaking = false;
    this.mirror = false;
    this.look = { x: 0, y: 0, tx: 0, ty: 0 };
    this.hop = 0;
    this.char = null;
    this.walkTarget = null;
    this.onInteract = null;      // (label, result) => void
    this.onHover = null;         // (label | null, x, y) => void
    this.onPoke = null;
    this.onSelect = null;        // (item info | null) => void   (edit mode)
    this.onLayoutChange = null;  // () => void, after something in the room changed
    this.editMode = false;
    this.selectedId = null;
    this._drag = null;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x150e1c);
    this.scene.fog = new THREE.Fog(0x150e1c, 9, 16);

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.05, 140);
    this.camera.position.set(0.2, 1.85, 6.3);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(-0.1, 1.15, -0.6);
    Object.assign(this.controls, {
      enableDamping: true, enablePan: false, minDistance: 1.8, maxDistance: 7.2,
      minPolarAngle: 0.9, maxPolarAngle: 1.62, minAzimuthAngle: -0.85, maxAzimuthAngle: 0.85,
    });

    this.controls.addEventListener("end", () => !this._dio && !this._roomIdx && this.onViewChange?.({   // the main room's view is the one kept
      pos: this.camera.position.toArray().map((v) => +v.toFixed(3)),
      target: this.controls.target.toArray().map((v) => +v.toFixed(3)),
    }));
    this.cozy = new CozyRoom(this.scene);
    this.cozy.onChange = () => this.onLayoutChange?.();
    this.cozy.onItemChanged = (id) => {
      if (this.selectedId === id) this.select(id);
    };
    this.cozy.onLighting = (st) => {
      if (this.gym) return;                     // the gym room keeps its own lighting
      r.toneMappingExposure = st.exp * 1.05 * this.cozy.brightness;
      if (this.bloom) {                         // less glow in daylight so white walls don't blur
        this.bloom.threshold = 0.82 + 0.14 * st.town;
        this.bloom.strength = 0.55 - 0.3 * st.town;
      }
    };
    this.cozy.load(null);
    this.cozy.charPos = () => this.char?.root.position;               // pets come to her
    this.cozy.onPetVisit = (pet, says) => {
      if (this.editMode || this.char?.seat) return;
      this.setExpression("happy", 3);
      this.onPetVisit?.(pet, says);
    };
    this.undoStack = [];
    this._pops = [];
    this.selectBox = new THREE.BoxHelper(undefined, 0xe0ae4a);
    this.selectBox.visible = false;
    this.scene.add(this.selectBox);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.cozy.applyHour(this.cozy.hour, true);   // apply exposure/glow now that bloom exists

    this._bindPointer();
    // speed: while you touch the room it runs at full speed for a moment (see _tick)
    for (const ev of ["pointerdown", "pointermove", "wheel", "keydown"]) canvas.addEventListener(ev, () => { this._userActive = performance.now() + 1500; }, { passive: true });
    this._prMax = r.getPixelRatio();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this._resize();
    r.setAnimationLoop(() => this._tick());
  }

  _resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas.parentElement;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio?.(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  setScreenName(name) { this.cozy.setScreenName(name); }

  /** Camera angle you left the room at (saved between sessions). */
  setView(view) {
    if (!view?.pos || !view?.target) return;
    this.camera.position.fromArray(view.pos);
    this.controls.target.fromArray(view.target);
    this.controls.update();
  }

  // ---------------- room editing ----------------
  loadLayout(layout) { if (this.editMode) this._remember(); this.select(null); this.cozy.load(layout); this._cutaway(!!this._dio); this._houseChanged(); }
  /** The gym's equipment layout (saved on its own). */
  gymLayout() { return this.gym ? { items: this.cozy.serialize().items } : null; }

  layout() {
    if (this.gym && this._homeLayout) return this._homeLayout;      // while in the gym, your home room is what gets saved
    const L = this.cozy.serialize();
    if (this._sceneBase) Object.assign(L, { sky: this._sceneBase.sky, brightness: this._sceneBase.brightness });   // never save a temporary scene
    return L;
  }

  /** Undo: a copy of the room is kept before every change (up to 40 steps back). */
  _remember() {
    if (this.gym) return;
    const snap = JSON.stringify(this.cozy.serialize());
    if (this.undoStack.at(-1) !== snap) this.undoStack.push(snap);
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.onUndoChange?.(this.undoStack.length);
  }
  undo() {
    const snap = this.undoStack.pop();
    this.onUndoChange?.(this.undoStack.length);
    if (!snap) return false;
    const keep = this.selectedId;
    this.cozy.load(JSON.parse(snap));
    this._cutaway(!!this._dio);
    this._houseChanged();
    this.select(this.cozy.items.has(keep) ? keep : null);
    this.onLayoutChange?.();
    return true;
  }

  /** a little "pop" when furniture lands: it grows in with a bounce and a puff of sparkles */
  _pop(item, k = 1) {
    if (!item) return;
    this._pops.push({ group: item.group, t: 0, k });
    const sp = (this._sparkGeo ??= new THREE.SphereGeometry(0.035, 6, 6));
    const box = new THREE.Box3().setFromObject(item.group);
    const c = box.isEmpty() ? item.group.position.clone() : box.getCenter(new THREE.Vector3());
    const y = box.isEmpty() ? item.group.position.y + 0.1 : box.min.y + 0.05;
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(sp, new THREE.MeshBasicMaterial({ color: [0xffe08a, 0xffffff, 0x9fd8ff][i % 3], transparent: true }));
      const a = (i / 14) * Math.PI * 2;
      m.position.set(c.x, y, c.z);
      m.userData.v = new THREE.Vector3(Math.cos(a) * 1.4, 1.2 + Math.random(), Math.sin(a) * 1.4);
      this.scene.add(m);
      this._pops.push({ spark: m, t: 0 });
    }
  }
  _updatePops(dt) {
    for (let i = this._pops.length - 1; i >= 0; i--) {
      const P = this._pops[i];
      P.t += dt;
      if (P.spark) {
        P.spark.position.addScaledVector(P.spark.userData.v, dt);
        P.spark.userData.v.y -= 4 * dt;
        P.spark.material.opacity = Math.max(0, 1 - P.t / 0.7);
        if (P.t > 0.7) { this.scene.remove(P.spark); P.spark.material.dispose(); this._pops.splice(i, 1); }
        continue;
      }
      const x = Math.min(1, P.t / 0.45);
      const e = 1 + Math.sin(x * Math.PI * 2.5) * (1 - x) * 0.35 * P.k;      // springy overshoot
      const s = P.k === 1 ? Math.min(1, x * 3) * e : e;
      P.group.scale.set(s, P.k === 1 ? s : 2 - e, s);
      if (x >= 1) { P.group.scale.set(1, 1, 1); this._pops.splice(i, 1); }
    }
  }

  /** The extra rooms (Edit room > Rooms). Furniture and she move inside if their place is gone. */
  setHouse(cfg) {
    if (performance.now() - (this._lastHouse || 0) > 700) this._remember();     // dragging a slider = one undo step
    this._lastHouse = performance.now();
    const H = this.cozy.setHouse(cfg);
    this._houseChanged();
    this.onLayoutChange?.();
    return H;
  }

  _houseChanged() {
    const c = this.char, cozy = this.cozy;
    if (c && !this.gym) {
      const p = c.root.position;
      if (!c.seat && !cozy.walkable(p.x, p.z)) {                     // a wall moved onto her
        const q = cozy.house.clampPoint(p.x, p.z, 0.6);
        p.x = q.x; p.z = q.z; this.walkTarget = null; this._path = [];
      }
    }
    if (this._dio) this._fitDiorama();                              // the camera fits the new size too
    else if (this._roomIdx > 0 && !this.editMode) this._aimAtRoom(this._roomIdx);   // she's in a room that changed
    if (this._dioBase) {                                             // the grass and slab fit the house
      const shown = !!this._dioBase.parent;
      this.scene.remove(this._dioBase);
      this._dioBase = this._buildDioramaBase();
      if (shown) this.scene.add(this._dioBase);
    }
  }

  setEditMode(on) {
    this.editMode = !!on;
    this.cozy.editing = this.editMode;
    if (!on) this.select(null);
    this._editGrid(this.editMode);
    this._diorama(this.editMode);
  }

  /** Edit mode view: the room seen from a high corner like a little diorama on the grass. */
  _diorama(on) {
    if (!!this._dio === on) return;
    const cam = this.camera, ctl = this.controls, cozy = this.cozy;
    const limits = ["minDistance", "maxDistance", "minPolarAngle", "maxPolarAngle", "minAzimuthAngle", "maxAzimuthAngle"];
    if (on) {
      this._dio = { pos: cam.position.clone(), target: ctl.target.clone(), fov: cam.fov, bg: this.scene.background, fog: this.scene.fog,
                    limits: Object.fromEntries(limits.map((k) => [k, ctl[k]])) };
      if (!this._dioBase) this._dioBase = this._buildDioramaBase();
      this.scene.add(this._dioBase);
      this.scene.background = new THREE.Color(0x5b8a4c);
      this.scene.fog = new THREE.Fog(0x5b8a4c, 34, 80);
      Object.assign(ctl, { minDistance: 9, minPolarAngle: 0.45, maxPolarAngle: 1.25, minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity });
      this._cutaway(true);
      this._fitDiorama(new THREE.Vector3(12.5, 11.5, 15.5).normalize());
    } else {
      const d = this._dio; this._dio = null;
      this.scene.remove(this._dioBase);
      this.scene.background = d.bg; this.scene.fog = d.fog;
      this._cutaway(false);
      Object.assign(ctl, d.limits);
      this._tweenCamera(d.pos, d.target, d.fov);
    }
  }

  /** Edit mode: the whole house in view, seen from `dir` (from the middle towards the camera; default: the
   *  direction it's looked from now, so adding a room or dragging its size zooms out/in without turning). */
  _fitDiorama(dir) {
    const b = this.cozy.house.bounds(), cx = (b.minX + b.maxX) / 2;
    const k = Math.max(1, (b.maxX - b.minX) / 10, (b.maxZ - b.minZ) / 8.5);    // 1 = just the main room (10 x 8.5 m)
    const target = new THREE.Vector3(cx, 0.5, 0.3);
    const T = this._camTween, from = T ? T.p1 : this.camera.position, at = T ? T.t1 : this.controls.target;
    dir = dir || from.clone().sub(at).normalize();
    this.controls.maxDistance = 34 * k + 6;
    this._tweenCamera(target.clone().addScaledVector(dir, 23 * k), target, 30);
  }

  /** Hide what would block the diorama view (the near walls, the ceilings and things hanging there). */
  _cutaway(on) { this.cozy.setCut(on); }

  _buildDioramaBase() {
    const g = new THREE.Group();
    const cv = document.createElement("canvas"); cv.width = cv.height = 512;
    const x = cv.getContext("2d");
    x.fillStyle = "#5e8d4e"; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 260; i++) {                                  // little grass tufts
      const px = Math.random() * 512, py = Math.random() * 512;
      x.fillStyle = Math.random() < 0.5 ? "#4f7a42" : "#6c9a58";
      for (let k = 0; k < 3; k++) { x.beginPath(); x.ellipse(px + k * 4 - 4, py - (k === 1 ? 4 : 0), 2.2, 6, 0, 0, Math.PI * 2); x.fill(); }
    }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(14, 14);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.62; ground.receiveShadow = true; g.add(ground);
    // the house's base: a thick slab like a cut-out piece of a house, one under each room so it follows their shape
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xb8692f, roughness: 0.9 }), lipMat = new THREE.MeshStandardMaterial({ color: 0x7b4a2a, roughness: 0.9 });
    for (const r of this.cozy.house.rects()) {
      const w = r.maxX - r.minX, d = r.maxZ - r.minZ, cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.6, d + 0.3), slabMat);
      slab.position.set(cx, -0.31, cz); slab.castShadow = true; slab.receiveShadow = true; slab.name = "slab"; g.add(slab);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.34, 0.06, d + 0.34), lipMat);
      lip.position.set(cx, -0.62 + 0.03, cz); g.add(lip);
    }
    const sun = new THREE.HemisphereLight(0xfff1d6, 0x4a6a3a, 0.6); g.add(sun);       // soft daylight on the grass
    return g;
  }

  /** Which room she's standing in: 0 = the main room, 1, 2.. = the extra rooms (in house.rects() order). */
  _roomAt(p) {
    const R = this.cozy.house.rects();
    for (let i = 1; i < R.length; i++) {
      const r = R[i], inL = r.side === "right" ? 0.35 : 0, inR = r.side === "left" ? 0.35 : 0;   // a little past the doorway
      if (p.x > r.minX + inL && p.x < r.maxX - inR) return i;
    }
    return 0;
  }

  /** The camera follows her from room to room: each room gets a view like the main room's, from its open front. */
  _followRoom() {
    const c = this.char;
    if (!c || this.gym || this._dio || this.editMode || this.cozy.shellHidden) return;
    const i = this._roomAt(c.root.position), from = this._roomIdx || 0;
    if (i === from) return;
    this._roomIdx = i;
    if (from === 0) {                                               // remember the main room's view to come back to
      const T = this._camTween;
      this._mainView = { pos: (T ? T.p1 : this.camera.position).clone(), target: (T ? T.t1 : this.controls.target).clone(), fov: T ? T.f1 : this.camera.fov };
    }
    if (i === 0) { const v = this._mainView; if (v) this._tweenCamera(v.pos, v.target, v.fov); return; }
    this._aimAtRoom(i);
  }

  /** the view of extra room i from its open front (wider rooms: a step further back so it all fits) */
  _aimAtRoom(i) {
    const r = this.cozy.house.rects()[i];
    if (!r) { this._roomIdx = 0; const v = this._mainView; if (v) this._tweenCamera(v.pos, v.target, v.fov); return; }
    const cx = (r.minX + r.maxX) / 2, d = r.maxZ - r.minZ, back = 1.8 + Math.max(0, (r.maxX - r.minX) - 5) * 0.6;
    this._tweenCamera(new THREE.Vector3(cx + 0.2, 1.85, r.maxZ + back), new THREE.Vector3(cx - 0.1, 1.15, r.minZ + d * 0.4), this.camera.fov);
  }

  _tweenCamera(pos, target, fov) {
    this._camTween = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), f0: this.camera.fov, p1: pos.clone(), t1: target.clone(), f1: fov, k: 0 };
    this.controls.enabled = false;
  }

  select(id) {
    this.selectedId = id ?? null;
    const item = id != null ? this.cozy.items.get(id) : null;
    this.selectBox.visible = !!item;
    if (item) { this.selectBox.setFromObject(item.group); }
    this.onSelect?.(item ? { id, type: item.spec.type, label: item.def.label, mount: item.def.mount } : null);
  }

  addItem(type) {
    const def = CATALOG[type];
    if (!def) return;
    this._remember();
    const r = Math.random;
    const spec = def.mount === "wall" ? { type, wall: "back", u: -3 + r() * 1.5 }
      : { type, x: 1.8 + r() * 0.8, z: 2.3 + r() * 0.6 };   // in view, beside the character
    if (type === "poster") spec.variant = Math.floor(r() * 4);
    const item = this.cozy.addItem(spec);
    this.setEditMode(true);
    this.select(item.id);
    this._pop(item);
    this.onLayoutChange?.();
  }

  rotateSelected(angle) {
    if (this.selectedId == null) return;
    this._remember();
    this.cozy.rotateItem(this.selectedId, angle);
    this.select(this.selectedId);
    this.onLayoutChange?.();
  }

  raiseSelected(dy) {
    if (this.selectedId == null) return;
    this._remember();
    this.cozy.raiseItem(this.selectedId, dy);
    this.select(this.selectedId);
    this.onLayoutChange?.();
  }

  removeSelected() {
    if (this.selectedId == null) return;
    this._remember();
    this.cozy.removeItem(this.selectedId);
    this.select(null);
    this.onLayoutChange?.();
  }

  setWallColor(hex) {
    if (performance.now() - (this._lastWall || 0) > 700) this._remember();
    this._lastWall = performance.now();
    this.cozy.setWallColor(hex); this.onLayoutChange?.();
  }
  setFloor(style) { this._remember(); this.cozy.setFloor(style); this.onLayoutChange?.(); }
  setWallpaper(kind) { this._remember(); this.cozy.setWallpaper(kind); this.onLayoutChange?.(); }
  setSky(mode) { this.cozy.setSky(mode); this.onLayoutChange?.(); }
  setBrightness(v) { this.cozy.setBrightness(v); this.onLayoutChange?.(); }

  /** Where the mouse ray meets the floor, or for wall items the nearest wall. */
  _dragPoint(e, mount) {
    const r = this.canvas.getBoundingClientRect();
    const ray = (this._ray ??= new THREE.Raycaster());
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    if (mount !== "wall") {
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? { point: p } : null;
    }
    const house = this.cozy.house, hb = this.gym ? { minX: -5, maxX: 5 } : house.bounds(), y0 = 0;
    const walls = [
      ["back", new THREE.Plane(new THREE.Vector3(0, 0, 1), 4)],
      ...(this.gym || !house.hasRoom("left") ? [["left", new THREE.Plane(new THREE.Vector3(1, 0, 0), 5)]] : []),    // an open side has no wall
      ...(this.gym || !house.hasRoom("right") ? [["right", new THREE.Plane(new THREE.Vector3(-1, 0, 0), 5)]] : []),
    ];
    let best = null;
    for (const [wall, plane] of walls) {
      const q = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, q)) continue;
      if (q.x < hb.minX - 0.01 || q.x > hb.maxX + 0.01 || (wall !== "back" && Math.abs(q.x) > 5.01) || q.z < -4.01 || q.z > 4.5 || q.y < y0 || q.y > y0 + 3.2) continue;
      const d = q.distanceTo(ray.ray.origin);
      if (!best || d < best.d) best = { wall, point: q, d };
    }
    return best;
  }

  // ---------------- characters ----------------
  async setModel(file, { flip = false, outfit = "", hair = "" } = {}) {
    this._clearCharacter();
    if (!file) { this._useCharacter(this._sketchFigure()); return; }
    if (file === "builtin:penguin") { this._useCharacter(this._penguin(), flip); return; }
    const loader = new GLTFLoader();
    let vrmMod = null;
    if (file.toLowerCase().endsWith(".vrm")) {
      vrmMod = await import("@pixiv/three-vrm");
      loader.register((parser) => new vrmMod.VRMLoaderPlugin(parser));
    }
    const gltf = await loader.loadAsync(`models/${encodeURIComponent(file)}`);
    const vrm = gltf.userData.vrm;
    if (vrm) {
      vrmMod.VRMUtils.rotateVRM0(vrm);
      this._useCharacter(this._prepareVrm(vrm), flip);
    } else {
      const c = this._prepareGltf(gltf, file);
      this._useCharacter(c, flip);
      if (c.looks) this.setLook({ outfit, hair });
    }
  }

  _clearCharacter() {
    this._pendingUse = null;
    if (!this.char) return;
    this.scene.remove(this.char.root);
    this.char.root.traverse((o) => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) m.dispose?.();
    });
    this.char = null;
    this.walkTarget = null;
  }

  _useCharacter(c, flip = false) {
    const { root } = c;
    root.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    root.scale.multiplyScalar(CHAR_HEIGHT / Math.max(size.y, 1e-6));
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    root.position.x -= centre.x;
    root.position.z -= centre.z;
    root.position.y -= box.min.y;
    const turn = new THREE.Group();               // fixes models that face the wall
    turn.add(root);
    if (flip) turn.rotation.y = Math.PI;
    const holder = new THREE.Group();             // moves & turns when walking
    holder.add(turn);
    holder.position.copy(HOME);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.userData.character = true; } });
    c.root = holder;
    this.scene.add(holder);
    this.char = c;
    if (this.outfit) this._dressUp();
  }

  _prepareGltf(gltf, file = "") {
    const root = gltf.scene;
    let head = null;
    const mouths = [];
    root.traverse((o) => {
      if (o.isBone && !head && /head/i.test(o.name) && !/(top|end|nub)/i.test(o.name)) head = o;
      if (o.morphTargetDictionary) {
        for (const [name, i] of Object.entries(o.morphTargetDictionary)) if (MOUTH.test(name)) mouths.push([o, i]);
      }
    });
    const ears = [];                                   // e.g. Riolu's "ear.L" / "ear.R" bones (three.js drops the dot)
    root.traverse((o) => {
      const m = o.isBone && /^ear[._]?([LR])$/i.exec(o.name);
      if (m) ears.push({ bone: o, side: m[1].toUpperCase() === "L" ? 1 : -1 });
    });
    if (!head) root.traverse((o) => { if (o.isBone && /^spine\.?005$/i.test(o.name)) head = o; });   // Rigify-style rigs
    // fingers the animations don't move: the app curls them a little by itself (relaxed hands, grip when holding a book)
    const animated = new Set(gltf.animations.flatMap((a) => a.tracks.map((tr) => tr.name.split(".")[0])));
    const fingers = [];
    root.traverse((o) => {
      if (!o.isBone || animated.has(o.name) || /(end|nub|tip|top)$/i.test(o.name)) return;
      if (!/(finger|thumb|index|middle|ring|pinky|^f_)/i.test(o.name)) return;
      fingers.push({ bone: o, base: o.quaternion.clone(), thumb: /thumb/i.test(o.name), k: Math.random() * 6 });
    });
    const c = { kind: "gltf", root, head, headBase: head?.rotation.clone(), mouths, mixer: null, actions: {}, ears, fingers };
    this._findLooks(c);
    this._findFace(c, file);
    if (gltf.animations.length) {
      inPlace(gltf.animations);                  // a walk that moves the hips would jump back at every loop
      c.mixer = new THREE.AnimationMixer(root);
      const find = (re) => gltf.animations.find((a) => re.test(a.name));
      const idle = find(/idle|breath|stand/i) || gltf.animations[0];
      const walk = find(/walk/i);
      const wave = find(/wave|hello|greet/i);
      c.actions.idle = c.mixer.clipAction(idle).play();
      c._pose = "idle";
      if (walk) c.actions.walk = c.mixer.clipAction(walk);
      if (wave) { c.actions.wave = c.mixer.clipAction(wave); c.actions.wave.setLoop(THREE.LoopOnce, 1); c.actions.wave.clampWhenFinished = false; }
      const talk = find(/talk|speak/i);
      if (talk) c.actions.talk = c.mixer.clipAction(talk);                 // gestures while she speaks
      for (const name of ["happy", "sad", "surprised", "angry", "think", "sleepy", "dance", "sit", "type", "lounge", "lie", "crouch", "lookout",
        "book_take", "book_read", "book_put", "dance_hiphop", "dance_idol", "dance_twirl", "dance_sway", "cheer", "jump", "stretch", "yawn", "laugh", "shy", "clap", "shrug", "bow", "nod", "shake", "point", "look_around"]) {   // moods + furniture + reading + extras (if the model has them)
        const clip = gltf.animations.find((a) => a.name.toLowerCase() === name);
        if (clip) c.actions[name] = c.mixer.clipAction(clip);
      }
      for (const n of ["book_take", "book_put", "cheer", "jump", "stretch", "yawn", "shrug", "bow", "nod", "shake", "point"]) if (c.actions[n]) { c.actions[n].setLoop(THREE.LoopOnce, 1); c.actions[n].clampWhenFinished = true; }
      root.traverse((o) => { if (o.isBone && /^hand\.?R$/i.test(o.name)) c.handR = o; if (o.isBone && /^hand\.?L$/i.test(o.name)) c.handL = o;
        if (o.isBone && /^thigh\.?[LR]$/i.test(o.name)) (c.thighs ||= []).push(o); if (o.isBone && /^shin\.?[LR]$/i.test(o.name)) (c.shins ||= []).push(o);
        if (o.isBone && /^spine$/i.test(o.name)) c.hips = o;
        const am = o.isBone && /^(upper_arm|forearm|hand)\.?([LR])$/i.exec(o.name);
        if (am) ((c.arms ||= {})[am[2].toUpperCase()] ||= {})[am[1].toLowerCase()] = o;
        if (o.isBone && /^spine\.?003$/i.test(o.name)) c.chest = o; });
    }
    return c;
  }

  _prepareVrm(vrm) {
    const h = vrm.humanoid;
    const bone = (n) => h.getNormalizedBoneNode(n);
    bone("leftUpperArm") && (bone("leftUpperArm").rotation.z = -1.15);
    bone("rightUpperArm") && (bone("rightUpperArm").rotation.z = 1.15);
    bone("leftLowerArm") && (bone("leftLowerArm").rotation.z = -0.15);
    bone("rightLowerArm") && (bone("rightLowerArm").rotation.z = 0.15);
    return { kind: "vrm", root: vrm.scene, vrm, head: bone("head"), spine: bone("spine"), blinkIn: 2 + Math.random() * 3 };
  }

  /** The default character: the drawing, in 3D, with ink outlines. */
  _sketchFigure() {
    const root = new THREE.Group();
    const paper = new THREE.MeshToonMaterial({ color: 0xffffff });
    const ink = new THREE.MeshBasicMaterial({ color: INK });
    const outline = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
    const withOutline = (geo, thick = 1.045) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, paper));
      const o = new THREE.Mesh(geo, outline);
      o.scale.setScalar(thick);
      g.add(o);
      return g;
    };
    const profile = [[0, 0], [0.42, 0], [0.4, 0.15], [0.3, 0.6], [0.2, 0.95], [0.13, 1.06], [0, 1.08]].map(([x, y]) => new THREE.Vector2(x, y));
    root.add(withOutline(new THREE.LatheGeometry(profile, 48), 1.035));
    const head = new THREE.Group();
    head.position.y = 1.3;
    head.add(withOutline(new THREE.SphereGeometry(0.27, 48, 32)));
    for (const x of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.07, 4, 8), ink);
      eye.position.set(x, 0.05, 0.262);
      head.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.011, 8, 24, Math.PI * 0.8), ink);
    smile.rotation.set(-0.25, 0, Math.PI * 1.1);
    smile.position.set(0, -0.04, 0.25);
    head.add(smile);
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), ink);
    mouth.position.set(0, -0.09, 0.245);
    mouth.scale.set(1, 0.001, 0.4);
    head.add(mouth);
    root.add(head);
    return { kind: "sketch", root, head, sketchMouth: mouth, smile };
  }

  /** Pip: an original clay-style penguin, built from simple shapes. */
  _penguin() {
    const clay = (color, rough = 0.55) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
    const navy = clay(0x23305c), cream = clay(0xfff4e2), sun = clay(0xffb43b, 0.45), scarfMat = clay(0x3fb6a8, 0.8);
    const root = new THREE.Group();
    const bodyPivot = new THREE.Group();            // rocks side to side when waddling
    root.add(bodyPivot);

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), navy);
    body.scale.set(1, 1.18, 0.92); body.position.y = 0.66;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.43, 48, 32), cream);
    belly.scale.set(0.95, 1.1, 0.75); belly.position.set(0, 0.6, 0.14);
    bodyPivot.add(body, belly);

    const head = new THREE.Group();
    head.position.y = 1.32;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 48, 32), navy);
    skull.scale.set(1.05, 0.95, 1);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.27, 48, 32), cream);
    face.scale.set(1.15, 0.85, 0.6); face.position.set(0, -0.04, 0.17);
    head.add(skull, face);
    const eyes = [];
    for (const x of [-0.11, 0.11]) {
      const eye = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 16), clay(0x15131c, 0.2));
      ball.scale.z = 0.55;
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      shine.position.set(0.025, 0.03, 0.04);
      eye.add(ball, shine);
      eye.position.set(x, 0.03, 0.3);
      head.add(eye); eyes.push(eye);
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10), clay(0xff8fa3, 0.9));
      cheek.scale.set(1.3, 0.7, 0.4); cheek.position.set(x * 1.75, -0.08, 0.27);
      head.add(cheek);
    }
    // small pointed beak in two halves, so it can open while talking
    const upper = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 20), sun);
    upper.rotation.x = Math.PI / 2; upper.scale.set(1.2, 1, 0.55); upper.position.set(0, -0.06, 0.37);
    const lower = new THREE.Group();
    const lowerBeak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 20), sun);
    lowerBeak.rotation.x = Math.PI / 2; lowerBeak.scale.set(1.1, 1, 0.4); lowerBeak.position.set(0, 0, 0.05);
    lower.add(lowerBeak); lower.position.set(0, -0.1, 0.33);
    head.add(upper, lower);
    // knitted scarf
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.06, 16, 40), scarfMat);
    scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.08;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.3, 0.05), scarfMat);
    tail.position.set(0.16, 0.92, 0.25); tail.rotation.z = 0.25;
    bodyPivot.add(scarf, tail);
    bodyPivot.add(head);

    const flippers = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.47, 0.9, 0);
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), navy);
      f.scale.set(0.3, 1.1, 0.6); f.position.set(side * 0.05, -0.2, 0);
      pivot.add(f);
      pivot.rotation.z = side * 0.25;
      bodyPivot.add(pivot); flippers.push(pivot);
    }
    const feet = [];
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 12), sun);
      foot.scale.set(1, 0.35, 1.5); foot.position.set(side * 0.18, 0.04, 0.12);
      root.add(foot); feet.push(foot);
    }
    root.traverse((o) => (o.castShadow = true));
    return { kind: "penguin", root, head, bodyPivot, flippers, feet, eyes, lower, blinkIn: 2 };
  }

  // ---------------- living character: expressions, emotes, music, outfits, scenes ----------------
  /** happy / sad / surprised / angry / thinking / sleepy / neutral, for `seconds` (0 = until changed). */
  setExpression(name, seconds = 0) {
    this.expr = { name: name || "neutral", until: seconds ? this.clock.elapsedTime + seconds : Infinity };
  }

  /** wave / dance / jump / spin / nod / shake / bow / think / celebrate */
  playEmote(name) {
    const a = this.char?.actions || {};
    const busy = this.char && (this.char.seat || this.char.activity);
    if (busy && !["nod", "shake", "think", "wave"].includes(name)) { this.setExpression("happy", 2.5); return true; }   // just a smile
    const dances = ["dance", "dance_hiphop", "dance_idol", "dance_twirl", "dance_sway"].filter((d) => a[d]);
    const clip = name === "dance" && dances.length > 1 ? dances[Math.floor(Math.random() * dances.length)]
      : ({ celebrate: "cheer", jump: "jump", nod: "nod", shake: "shake", bow: "bow", clap: "clap", laugh: "laugh", shrug: "shrug",
           stretch: "stretch", yawn: "yawn", shy: "shy", point: "point", "look around": "look_around" })[name] || (name.startsWith("dance_") ? name : null);
    if (clip && a[clip] && !this.char.seat) { this.testAnimation(clip, name.startsWith("dance") || clip === "clap" || clip === "laugh" || clip === "shy" ? 8 : 4); return true; }
    const dur = { wave: 2.2, dance: 4, jump: 1, spin: 1.2, nod: 1.2, shake: 1.2, bow: 1.8, think: 2.5, celebrate: 2.5 }[name];
    if (!dur) return false;
    if (name === "wave" && this.char?.actions?.wave) { this.wave(); return true; }
    this.emote = { name, t0: this.clock.elapsedTime, dur };
    if (name === "celebrate") this.setExpression("happy", 3);
    if (name === "think") this.setExpression("thinking", 3);
    return true;
  }

  setMusic(on) { this.music = !!on; }

  /** Accessories on the head: { hat: "none|beanie|party|crown|santa|witch|headband|headphones|cap", glasses: bool, color: "#hex" } */
  setOutfit(o = {}) {
    this.outfit = { hat: o.hat || "none", glasses: !!o.glasses, color: o.color || "#3e8eff" };
    this._dressUp();
  }

  _dressUp() {
    const c = this.char;
    if (!c?.head) return;
    if (c.outfitGroup) { c.outfitGroup.parent?.remove(c.outfitGroup); c.outfitGroup.traverse((x) => { x.geometry?.dispose(); x.material?.dispose?.(); }); }
    const o = this.outfit || { hat: "none" };
    const g = new THREE.Group();
    // head radius in the head's own units (built-ins are known; models are measured)
    let r = c.kind === "penguin" ? 0.34 : c.kind === "sketch" ? 0.27 : 0;
    if (!r) {
      const ws = c.head.getWorldScale(new THREE.Vector3()).y || 1;
      r = (CHAR_HEIGHT * 0.075) / ws;
    }
    const mat = (color, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const top = r * 0.92, col = new THREE.Color(o.color);
    const add = (mesh, y, z = 0) => { mesh.position.set(0, y, z); g.add(mesh); return mesh; };
    switch (o.hat) {
      case "beanie": {
        const b = add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(col, 0.9)), top * 0.25);
        b.scale.y = 0.85;
        add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 16, 12), mat(0xffffff, 0.95)), top * 1.12);
        add(new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, r * 0.11, 12, 40), mat(col.clone().multiplyScalar(0.8), 0.9)), top * 0.28).rotation.x = Math.PI / 2;
        break;
      }
      case "party": {
        const cone = add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, r * 1.2, 24), mat(col, 0.5)), top + r * 0.5);
        cone.rotation.z = 0.15;
        add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 12, 8), mat(0xffd34d, 0.4)), top + r * 1.1).position.x = -r * 0.09;
        break;
      }
      case "crown": {
        const ring = add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.6, r * 0.62, r * 0.32, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xf5c542, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide })), top + r * 0.1);
        for (let i = 0; i < 5; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.1, r * 0.25, 8), ring.material);
          const a = (i / 5) * Math.PI * 2;
          spike.position.set(Math.sin(a) * r * 0.6, top + r * 0.35, Math.cos(a) * r * 0.6);
          g.add(spike);
        }
        break;
      }
      case "santa": {
        const cone = add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.8, r * 1.3, 24), mat(0xd62839, 0.8)), top + r * 0.45);
        cone.rotation.z = 0.35;
        add(new THREE.Mesh(new THREE.TorusGeometry(r * 0.82, r * 0.14, 12, 32), mat(0xffffff, 0.95)), top * 0.85).rotation.x = Math.PI / 2;
        add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.16, 12, 8), mat(0xffffff, 0.95)), top + r * 0.95).position.x = r * 0.45;
        break;
      }
      case "witch": {
        add(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.35, r * 0.06, 32), mat(0x2b1d3d, 0.7)), top * 0.8);
        const cone = add(new THREE.Mesh(new THREE.ConeGeometry(r * 0.65, r * 1.6, 24), mat(0x2b1d3d, 0.7)), top + r * 0.6);
        cone.rotation.z = -0.2;
        add(new THREE.Mesh(new THREE.TorusGeometry(r * 0.64, r * 0.06, 8, 24), mat(0x9a7bff, 0.5)), top * 0.88).rotation.x = Math.PI / 2;
        break;
      }
      case "headband":
        add(new THREE.Mesh(new THREE.TorusGeometry(r * 1.0, r * 0.09, 10, 40), mat(col, 0.8)), r * 0.35).rotation.x = Math.PI / 2 - 0.15;
        break;
      case "headphones": {
        const band = add(new THREE.Mesh(new THREE.TorusGeometry(r * 1.05, r * 0.07, 10, 40, Math.PI), mat(0x22252b, 0.4)), 0);
        band.rotation.z = 0;
        for (const side of [-1, 1]) {
          const cup = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 0.18, 20), mat(col, 0.4));
          cup.rotation.z = Math.PI / 2; cup.position.set(side * r * 1.02, 0, 0); g.add(cup);
        }
        break;
      }
      case "cap": {
        const dome = add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(col, 0.7)), top * 0.2);
        dome.scale.y = 0.75;
        const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, r * 0.05, 24, 1, false, -Math.PI / 2, Math.PI), mat(col, 0.7)), top * 0.22, r * 0.75);
        brim.scale.z = 1.2;
        break;
      }
    }
    if (o.glasses) {
      const frame = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.3, metalness: 0.4 });
      for (const side of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.TorusGeometry(r * 0.2, r * 0.03, 8, 24), frame);
        lens.position.set(side * r * 0.32, r * 0.08, r * 0.98); g.add(lens);
      }
      const bridge = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.02, r * 0.02, r * 0.24, 6), frame);
      bridge.rotation.z = Math.PI / 2; bridge.position.set(0, r * 0.12, r * 1.0); g.add(bridge);
    }
    g.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.userData.character = true; } });
    if (c.kind === "gltf") {
      // the head bone of many rigs starts at the neck, so measure where the top of the head really is
      c.root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      const shown = (o) => { for (; o && o !== c.root; o = o.parent) if (!o.visible) return false; return true; };
      c.root.traverse((m) => { if (m.isMesh && shown(m) && !c.outfitGroup?.getObjectById(m.id)) box.expandByObject(m); });
      const hp = c.head.getWorldPosition(new THREE.Vector3());
      const ws = c.head.getWorldScale(new THREE.Vector3()).y || 1;
      if (isFinite(box.max.y)) g.position.y = (box.max.y - hp.y) / ws - top * 1.02;
    }
    c.head.add(g);
    c.outfitGroup = g;
  }

  /** Temporary lighting for what we're doing ("study", "focus", "party", "story", "morning", "sleep"); null = back to yours. */
  setScene(name) {
    const scenes = { study: ["day", 1.25], focus: ["golden", 0.85], party: ["dusk", 1.1], story: ["night", 0.7],
                     morning: ["morning", 1.1], sleep: ["night", 0.5] };
    if (!name || !scenes[name]) {
      if (this._sceneBase) { this.cozy.setSky(this._sceneBase.sky); this.cozy.setBrightness(this._sceneBase.brightness); this._sceneBase = null; }
      this.scene_ = null;
      return;
    }
    if (!this._sceneBase) this._sceneBase = { sky: this.cozy.sky, brightness: this.cozy.brightness ?? 1 };
    const [sky, bright] = scenes[name];
    this.cozy.setSky(sky);
    this.cozy.setBrightness(bright);
    this.scene_ = name;
  }

  /** Swap the cozy room for the gym room (true) and back (false). startedAt = workout start (ms) for the TV clock. */
  setGymRoom(on, startedAt = null, layout = null) {
    on = !!on;
    if (on && this.char && this._roomIdx) {                         // workouts happen in the main room
      const c = this.char;
      c.seat = null; c.baseY = 0; c.root.position.copy(HOME); this.walkTarget = null; this._path = [];
      this._roomIdx = 0;
      if (this._mainView) this._tweenCamera(this._mainView.pos, this._mainView.target, this._mainView.fov);
    }
    if (on === !!this.gym) { if (this.gym && startedAt) this.gym.startedAt = startedAt; return; }
    const r = this.renderer;
    if (on) {
      this.setEditMode(false);
      this._homeLayout = this.layout();                            // your room is kept exactly as it is
      this.gym = buildGymRoom();
      this.gym.startedAt = startedAt || Date.now();
      this.scene.add(this.gym.group);
      this.cozy.clear();
      this.cozy.setShellHidden(true);
      for (const spec of (layout?.items?.length ? layout : GYM_LAYOUT).items) this.cozy.addItem(spec);   // the gym's own equipment, editable
      r.toneMappingExposure = 1.1;
      if (this.bloom) { this.bloom.threshold = 0.97; this.bloom.strength = 0.35; }
    } else {
      this.setEditMode(false);
      this.scene.remove(this.gym.group);
      this.gym.dispose();
      this.gym = null;
      this.cozy.clear();
      this.cozy.setShellHidden(false);
      this.cozy.load(this._homeLayout);                    // back home, exactly as you left it
      this._homeLayout = null;
      this.cozy.applyHour(this.cozy.hour, true);          // puts the room's own exposure and glow back
    }
    if (this.char && this.walkTarget == null) this.walkTo(0.4, 0.7);
    this.onGymRoom?.(on);
  }

  /** Places she can wander to: [{label, x, z}] next to furniture (desk, books, sofa, bed, window...). */
  spots() {
    if (this.gym) {                                                 // she trains at whatever equipment is in the gym
      const out = [...this.gym.spots];
      for (const item of this.cozy.items.values()) {
        if (!/^gym/.test(item.spec.type) || item.def.flat) continue;
        const p = item.group.position, toCenter = new THREE.Vector3(-p.x, 0, -p.z).normalize().multiplyScalar(0.9);
        out.push({ kind: "gym", label: item.def.label, x: p.x + toCenter.x, z: p.z + toCenter.z });
      }
      return out;
    }
    const out = [];
    const acts = this.char?.actions || {};
    const items = [...(this.cozy.items || new Map()).values()];
    for (const item of items) {
      const label = item.def?.label || "", type = item.spec.type;
      const p = item.group.position;
      const use = FURNITURE[type];
      if (use && acts[use.clip]) {                            // furniture she can actually sit / lie on
        const nearDesk = /chair/i.test(type) && items.some((d) => /desk/i.test(d.spec.type) && d.group.position.distanceTo(p) < 1.5);
        const kind = nearDesk ? "desk" : use.clip === "lie" ? "bed" : "couch";
        if (type === "denOttoman") continue;                         // that's the dog's bed
        out.push({ kind, label, x: p.x, z: p.z, item: item.id, use: { ...use, clip: nearDesk && acts.type ? "type" : use.clip } });
        continue;
      }
      const kind = /desk|computer|pc/i.test(label) ? "desk" : /book|shelf/i.test(label) ? "books" : /sofa|couch|bean/i.test(label) ? "couch"
        : /bed/i.test(label) ? "bed" : /plant/i.test(label) ? "plant" : /radio|speaker|record|tv/i.test(label) ? "music" : /window/i.test(label) ? "window" : null;
      if (!kind || (kind === "window" && item.def.mount === "wall")) continue;           // wall windows are handled below
      if (kind === "desk" && out.some((o) => o.kind === "desk" && o.use)) continue;     // she'd rather sit at it
      const toCenter = new THREE.Vector3(-p.x, 0, -p.z).normalize().multiplyScalar(0.9);   // stand in front of it
      const spot = { kind, label, x: p.x + toCenter.x, z: p.z + toCenter.z };
      if (kind === "plant" && (item.spec.y || 0) < 0.3 && acts.crouch) spot.use = { clip: "crouch", face: Math.atan2(-toCenter.x, -toCenter.z) };
      if (kind === "books" && acts.book_take && acts.book_read && acts.book_put) {
        const near = p.clone().add(toCenter.clone().setLength(0.75));      // close enough to reach the shelf
        Object.assign(spot, { x: near.x, z: near.z, use: { clip: "read", face: Math.atan2(-toCenter.x, -toCenter.z) } });
      }
      out.push(spot);
    }
    if (acts.lookout) {                                            // go to the windows that are really in the room
      const NORMAL = { back: [0, 1], left: [1, 0], right: [-1, 0] };
      for (const item of items) {
        if (!/window/i.test(item.spec.type) || item.def.mount !== "wall" || !item.group.visible) continue;
        const [nx, nz] = NORMAL[item.spec.wall || "back"] || [0, 1];
        const p = item.group.position;
        out.push({ kind: "window", label: item.def.label, x: p.x + nx * 0.75, z: p.z + nz * 0.75, use: { clip: "lookout", face: Math.atan2(-nx, -nz) } });
      }
    }
    return out;
  }

  /** Walk to a spot and use it (sit on the chair, lie on the bed, crouch by the plant...). */
  useSpot(spot) {
    const c = this.char;
    if (!c || !spot?.use) { if (spot) this.walkTo(spot.x, spot.z); return; }
    const use = spot.use;
    if (use.seat == null) {                                         // standing activity (window, plant)
      this.walkTo(spot.x, spot.z);
      this._pendingUse = { use, yaw: use.face ?? c.root.rotation.y };
      return;
    }
    const item = this.cozy.items.get(spot.item);
    if (!item) return;
    item.group.updateMatrixWorld(true);
    const seatPos = item.group.localToWorld(new THREE.Vector3(use.at[0], 0, use.at[1]));
    const front = item.group.localToWorld(new THREE.Vector3(use.at[0], 0, use.at[1] + (use.clip === "lie" ? 1.0 : 0.7)));
    const yaw = item.group.rotation.y;
    this.walkTo(front.x, front.z);
    const m = this._measureSeat(item, use.at);                     // the furniture is solid: find its real seat
    const top = m?.top ?? use.seat + item.group.position.y;
    const drop = use.clip === "lie" ? 0.28 : 0;                    // lying: her back rests on the mattress, not her hips
    this._pendingUse = { use, yaw, seat: new THREE.Vector3(seatPos.x, top - SEAT_IN_CLIP - drop, seatPos.z), front: front.setY(this._groundY || 0),
                         item, top, edge: m?.edge ?? null, back: m?.back ?? null };
  }

  /** Look straight down onto a piece of furniture along its front-back line (in its own space) to find how high the
   *  seat / mattress is at the sitting spot and where its front edge is. */
  _measureSeat(item, at) {
    this._seatRay ??= new THREE.Raycaster();
    const ray = this._seatRay, down = new THREE.Vector3(0, -1, 0);
    const heightAt = (z) => {
      const p = item.group.localToWorld(new THREE.Vector3(at[0], 0, z)); p.y = item.group.position.y + 3;
      ray.set(p, down); ray.far = 3.2;
      const hit = ray.intersectObject(item.group, true).find((h) => h.object.visible !== false);
      return hit ? hit.point.y : 0;
    };
    const top = heightAt(at[1]);
    if (top < item.group.position.y + 0.2) return null;
    let edge = null;
    for (let z = at[1]; z < at[1] + 1.4; z += 0.02) if (heightAt(z) < top - 0.1) { edge = z; break; }
    // backrest: look backwards along the seat a bit above it; the first thing that rises clearly above the seat
    let back = null;
    for (let z = at[1]; z > at[1] - 1.0; z -= 0.02) if (heightAt(z) > top + 0.15) { back = z; break; }
    return { top, edge, back };
  }

  // ---------- arms: a small 2-bone solver so hands can be put exactly where they should be ----------
  _rotateWorld(bone, q) {
    const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    const wq = bone.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(pq.invert().multiply(q).multiply(wq));
    bone.updateMatrixWorld(true);
  }

  /** Move a hand to `target` (world), bending the elbow the way it already bends. k = 0..1 how much. */
  _armIK(arm, target, k = 1) {
    const { upper_arm: U, forearm: F, hand: H } = arm;
    if (!U || !F || !H || k <= 0) return;
    const S = U.getWorldPosition(new THREE.Vector3()), E = F.getWorldPosition(new THREE.Vector3()), W = H.getWorldPosition(new THREE.Vector3());
    const a = S.distanceTo(E), b = E.distanceTo(W);
    const T = W.clone().lerp(target, k);
    const d = T.clone().sub(S); let dl = d.length();
    if (dl < 1e-4) return;
    dl = Math.min(dl, (a + b) * 0.999); d.setLength(dl);
    const dn = d.clone().normalize();
    const x = (a * a - b * b + dl * dl) / (2 * dl), h = Math.sqrt(Math.max(0, a * a - x * x));
    let pole = E.clone().sub(S); pole.sub(dn.clone().multiplyScalar(pole.dot(dn)));
    if (pole.lengthSq() < 1e-8) pole.set(0, -1, 0);
    pole.normalize();
    const E2 = S.clone().add(dn.clone().multiplyScalar(x)).add(pole.multiplyScalar(h));
    const q1 = new THREE.Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), E2.clone().sub(S).normalize());
    this._rotateWorld(U, q1);
    const E3 = F.getWorldPosition(new THREE.Vector3()), W3 = H.getWorldPosition(new THREE.Vector3());
    const q2 = new THREE.Quaternion().setFromUnitVectors(W3.clone().sub(E3).normalize(), S.clone().add(d).sub(E3).normalize());
    this._rotateWorld(F, q2);
  }

  /** Typing: both hands rest ON the desk top in front of her (fingers still tap from the animation). */
  _handsOnDesk(c, t) {
    const S = c.seat, k = Math.min(1, S.t);
    if (!S.desk) {                                                 // find the desk she's sitting at, once
      const pos = c.root.position;
      let best = null;
      for (const item of this.cozy.items.values()) {
        if (!/desk/i.test(item.spec.type)) continue;
        const dd = item.group.position.distanceTo(pos);
        if (dd < 1.8 && (!best || dd < best[1])) best = [item, dd];
      }
      S.desk = best ? best[0] : false;
    }
    if (!S.desk) return;
    c.root.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(Math.sin(c.root.rotation.y), 0, Math.cos(c.root.rotation.y));
    // scoot the chair in so the desk is right in front of her (and put it back when she gets up)
    this._seatRay ??= new THREE.Raycaster();
    if (S.t < 1) return;                                           // wait until she has turned and sat down
    if (S.deskGap == null) {
      const hip = c.hips.getWorldPosition(new THREE.Vector3());
      S.deskGap = 0;
      for (let dd = 0.05; dd < 1.3; dd += 0.03) {
        const pt = hip.clone().add(fwd.clone().multiplyScalar(dd)); pt.y = 3;
        this._seatRay.set(pt, new THREE.Vector3(0, -1, 0)); this._seatRay.far = 3.2;
        const hit = this._seatRay.intersectObject(S.desk.group, true)[0];
        if (hit) { S.deskGap = dd; S.deskTop = hit.point.y; break; }
      }
      S.chairBase = S.item.group.position.clone();
    }
    let want = Math.max(0, Math.min(0.6, S.deskGap - 0.2));
    // legs are solid too: if a knee or ankle would be inside the desk (drawers, sides), stop pulling the chair in
    if (S.deskTop != null) {
      const pts = [];
      for (const sh of c.shins || []) { pts.push(sh.getWorldPosition(new THREE.Vector3())); const f = sh.children.find((x) => x.isBone); if (f) pts.push(f.getWorldPosition(new THREE.Vector3())); }
      const hitsDesk = pts.some((pt) => {
        this._seatRay.set(new THREE.Vector3(pt.x, S.deskTop - 0.08, pt.z), new THREE.Vector3(0, -1, 0)); this._seatRay.far = 2;
        const h = this._seatRay.intersectObject(S.desk.group, true)[0];
        return h && h.point.y > pt.y - 0.06;                        // something solid at that spot, above the leg
      });
      if (hitsDesk) S.scootMax = Math.max(0, (S.scoot || 0) - 0.03);
      if (S.scootMax != null) want = Math.min(want, S.scootMax);
    }
    S.scoot = (S.scoot || 0) + (want - (S.scoot || 0)) * Math.min(1, k * 0.08);
    S.item.group.position.copy(S.chairBase).add(fwd.clone().multiplyScalar(S.scoot));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const chest = (c.chest || c.hips).getWorldPosition(new THREE.Vector3());
    this._seatRay ??= new THREE.Raycaster();
    for (const [side, sgn] of [["L", 1], ["R", -1]]) {             // her left hand on her left (right vector points to her left)
      const shoulder = c.arms[side].upper_arm.getWorldPosition(new THREE.Vector3());
      const spot = chest.clone().setY(3).add(fwd.clone().multiplyScalar(0.36)).add(right.clone().multiplyScalar(sgn * 0.11));
      this._seatRay.set(spot, new THREE.Vector3(0, -1, 0)); this._seatRay.far = 3.2;
      const hit = this._seatRay.intersectObject(S.desk.group, true)[0];
      if (!hit) continue;
      const tap = Math.max(0, Math.sin(t * 9 + (sgn > 0 ? 0 : 2.1))) * 0.012;
      const target = hit.point.clone(); target.y += 0.045 + tap;     // wrist just above the desk, palm down on it
      if (target.distanceTo(shoulder) > 0.65) continue;
      this._armIK(c.arms[side], target, k);
    }
  }

  /** Hands never go inside the furniture she's sitting on: they rest on its surface instead. */
  _handsOutOfFurniture(c, item) {
    this._seatRay ??= new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    for (const arm of [c.arms.L, c.arms.R]) {
      const h = arm.hand.getWorldPosition(new THREE.Vector3());
      this._seatRay.set(new THREE.Vector3(h.x, h.y + 0.6, h.z), down); this._seatRay.far = 0.6;
      const hit = this._seatRay.intersectObject(item.group, true)[0];   // a surface of the furniture right above the hand?
      if (!hit || hit.point.y < h.y + 0.005) continue;
      const lift = hit.point.y + 0.03 - h.y;
      if (lift < 0.3) this._armIK(arm, h.clone().setY(h.y + lift));      // rest on top of it (cushion, armrest)
      else this._armIK(arm, h.clone().add(new THREE.Vector3(0, 0, 0.15).applyQuaternion(item.group.quaternion)));   // out in front
    }
  }

  /** The body is solid: hands never pass through each other, her head or her chest. */
  _solidBody(c) {
    c.root.updateMatrixWorld(true);
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const L = c.arms.L, R = c.arms.R;
    const scale = c.root.scale.y * (c.root.children[0]?.scale?.y || 1);
    // hands apart (palms may touch for a clap, but no overlap)
    const hl = wp(L.hand), hr = wp(R.hand), gap = hl.distanceTo(hr), minGap = 0.055;
    if (gap < minGap) {
      const away = hl.clone().sub(hr); if (away.lengthSq() < 1e-8) away.set(-1, 0, 0);
      away.setLength((minGap - gap) / 2 + 0.002);
      this._armIK(L, hl.clone().add(away)); this._armIK(R, hr.clone().sub(away));
    }
    // arms never cross through each other: her left hand stays on her left, her right hand on her right
    {
      const inv = new THREE.Matrix4().copy(c.root.matrixWorld).invert();
      const ll = wp(L.hand).applyMatrix4(inv), rl = wp(R.hand).applyMatrix4(inv);
      const s0 = c.root.scale.x || 1, minSide = 0.07 / s0;          // in her own space, +x is her left
      if (ll.x - rl.x < minSide) {
        const push = (minSide - (ll.x - rl.x)) / 2;
        const side = new THREE.Vector3(1, 0, 0).transformDirection(c.root.matrixWorld).setLength(push * s0);
        this._armIK(L, wp(L.hand).add(side)); this._armIK(R, wp(R.hand).sub(side));
      }
    }
    // hands outside the head (a ball around it) and the chest (a ball in front of the spine)
    const head = c.head ? wp(c.head).add(new THREE.Vector3(0, 0.1, 0)) : null;
    const chest = c.chest ? wp(c.chest) : null;
    for (const arm of [L, R]) {
      const h = wp(arm.hand);
      for (const [centre, r] of [[head, 0.13], [chest, 0.1]]) {
        if (!centre) continue;
        const v = h.clone().sub(centre), dist = v.length();
        if (dist < r) { if (dist < 1e-4) v.set(0, 0, 1); this._armIK(arm, centre.clone().add(v.setLength(r + 0.005))); }
      }
    }
  }

  /** Thighs lie along the seat (knees not lower than the cushion), shins hang straight down over the front edge. */
  _seatLegs(c) {
    const S = c.seat, k = Math.min(1, S.t);
    if (!c.thighs?.length || !c.shins?.length) return;
    c.root.updateMatrixWorld(true);
    const up = new THREE.Vector3(0, 1, 0), hip = new THREE.Vector3(), knee = new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion();
    const rotateWorld = (bone, axis, angle) => {                   // turn a bone around a world axis
      q.setFromAxisAngle(axis, angle);
      bone.parent.getWorldQuaternion(pq);
      const wq = bone.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(pq.clone().invert().multiply(q).multiply(wq));
      bone.updateMatrixWorld(true);
    };
    c.thighs.forEach((thigh, i) => {
      const shin = c.shins.find((b) => b.parent === thigh) || c.shins[i];
      thigh.getWorldPosition(hip); shin.getWorldPosition(knee);
      const d = knee.clone().sub(hip), L = d.length(), horiz = new THREE.Vector3(d.x, 0, d.z);
      if (L < 1e-4 || horiz.lengthSq() < 1e-6) return;
      const want = Math.asin(THREE.MathUtils.clamp((S.top + 0.035 - hip.y) / L, -1, 0.2));   // knee just above the cushion
      const now = Math.asin(THREE.MathUtils.clamp(d.y / L, -1, 1));
      const delta = (want - now) * k;
      if (delta <= 0.005) return;                                  // only ever lift the knee (never push it into the seat)
      const axis = horiz.normalize().cross(up).normalize();
      rotateWorld(thigh, axis, delta);
      rotateWorld(shin, axis, -delta);                             // shin keeps hanging down
    });
    // sit properly: lower legs hang down from the knees over the front edge (feet towards the floor)
    if (S.item) {
      const fwdI = new THREE.Vector3(0, 0, 1).applyQuaternion(S.item.group.quaternion);
      const hang = fwdI.clone().multiplyScalar(0.3).add(new THREE.Vector3(0, -0.95, 0)).normalize();
      c.shins.forEach((shin) => {
        const foot = shin.children.find((b) => b.isBone);
        if (!foot) return;
        const kn = shin.getWorldPosition(new THREE.Vector3()), an = foot.getWorldPosition(new THREE.Vector3());
        const cur = an.sub(kn).normalize();
        const qq = new THREE.Quaternion().setFromUnitVectors(cur, hang);
        this._rotateWorld(shin, new THREE.Quaternion().slerp(qq, k));
      });
    }
    // sofa / armchair: lean the upper body back a little, towards the backrest
    if (S.clip !== "lounge" || S.back == null || !S.item || !c.chest) return;
    const spine1 = c.hips.children.find((b) => b.isBone && /^spine\.?001$/i.test(b.name));
    if (!spine1) return;
    const chest = c.chest.getWorldPosition(new THREE.Vector3()), base = spine1.getWorldPosition(new THREE.Vector3());
    const cz = S.item.group.worldToLocal(chest.clone()).z, bz = S.item.group.worldToLocal(base.clone()).z;
    const target = S.back + 0.13;                                   // chest just touching the cushion
    if (cz <= target + 0.01) return;
    const hgt = Math.max(0.15, chest.y - base.y);
    const lean = Math.min(0.22, Math.atan2(cz - target, hgt)) * k;  // a gentle recline (max ~12 degrees)
    const sideAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(S.item.group.quaternion);    // the seat's left-right axis
    q.setFromAxisAngle(sideAxis, -lean);
    this._rotateWorld(spine1, q.clone());
    void bz;
  }

  /** While seated, keep her ON the furniture: hips resting on top, knees just past the front edge (never inside it). */
  _settle(c, S, dt) {
    if (!S.item || !c.hips) return;
    const k = Math.min(1, dt * 5), item = S.item, w = new THREE.Vector3();
    S.fix = S.fix || new THREE.Vector3();
    c.root.updateMatrixWorld(true);                                 // measured with her at the plain seat spot...
    let dy = 0, dz = 0;
    if (S.clip === "lie") {
      dy = S.top + 0.1 - (c.hips.getWorldPosition(w).y + S.fix.y);      // ...so add the correction we already use
    } else {
      const hipY = Math.min(...(c.thighs || []).map((b) => b.getWorldPosition(w).y));
      dy = S.top + 0.075 - (hipY + S.fix.y);
      if (S.edge != null && c.shins?.length) {
        const kneeZ = Math.min(...c.shins.map((b) => item.group.worldToLocal(b.getWorldPosition(w)).z));
        dz = S.edge + 0.04 - (kneeZ + S.fix.z);                     // knees still over the cushion -> slide forward
        if (dz < 0) dz = Math.max(dz, -0.02) * 0.2;                 // tiny drift back is fine, never jump back
      }
    }
    if (Math.abs(dy) > 0.004) S.fix.y += dy * k;
    if (Math.abs(dz) > 0.004 && Math.abs(S.fix.z + dz * k) < 0.7) S.fix.z += dz * k;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(item.group.quaternion);
    c.root.position.copy(S.to).add(fwd.multiplyScalar(S.fix.z + (S.scoot || 0))); c.root.position.y = S.to.y + S.fix.y;
  }

  /** Smooth sit-down / stand-up. Returns true while she is busy with furniture. */
  _furniture(c, dt) {
    const S = c.seat;
    if (!S) return false;
    S.t = Math.min(1, S.t + dt / S.dur);
    const k = S.t * S.t * (3 - 2 * S.t);
    c.root.position.lerpVectors(S.from, S.to, k);
    c.root.rotation.y = S.yaw0 + angleTo(S.yaw0, S.yaw1) * k;
    if (S.t >= 1 && !S.leaving) this._settle(c, S, dt);
    c.baseY = c.root.position.y;
    if (S.t >= 1 && S.leaving) {                                    // stood up: carry on walking
      c.seat = null; c.baseY = this._groundY || 0; c.root.position.y = c.baseY;
      if (S.then) this._planWalk(S.then);
      return false;
    }
    return true;
  }

  /** Fingers: relaxed and slightly curled, a little twitch while talking, a fist when holding a book. */
  _moveFingers(c, t, dt, talk) {
    const grip = c.book ? 1 : 0;
    c._grip = (c._grip ?? 0) + (grip - (c._grip ?? 0)) * Math.min(1, dt * 6);
    const q = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);
    for (const f of c.fingers) {
      const curl = 0.22 + Math.sin(t * 1.3 + f.k) * 0.04 + talk * Math.sin(t * 7 + f.k) * 0.08 + c._grip * 0.9;
      f.bone.quaternion.copy(f.base).multiply(q.setFromAxisAngle(X, curl * (f.thumb ? 0.5 : 1)));
    }
  }

  /** Floppy ears: the animation keeps them hanging down; on top of that they react to feelings and movement.
   *  lift > 0 raises them, sweep > 0 pins them back (degrees, in the bone's own space). */
  _moveEars(c, t, dt, moving, ex) {
    const E = c._ears || (c._ears = { lift: 0, sweep: 0, turn: 0, turnV: 0, flop: 0, flopV: 0, yaw: c.root.rotation.y, wasMoving: false });
    const bob = Math.sin(t * 6);
    const target = {
      happy: [16 + bob * 5, -4], surprised: [42, -12], angry: [8, 32], sad: [-14, 18],
      sleepy: [-12 + Math.sin(t * 1.2) * 3, 8], thinking: [0, 0], neutral: [0, 0],
    }[ex] || [0, 0];

    if (this.hop > 0) target[0] += Math.sin((1 - this.hop) * Math.PI) * 35;                     // poked: ears fly up
    const f = Math.min(1, dt * 7);
    E.lift += (target[0] - E.lift) * f;
    E.sweep += (target[1] - E.sweep) * f;
    // springs: the ears lag behind when she turns, and flop when she starts or stops walking
    const spring = (x, v, goal) => { v += ((goal - x) * 60 - v * 7) * dt; return [Math.max(-40, Math.min(40, x + v * dt)), v]; };
    const yaw = c.root.rotation.y;
    const yawVel = Math.atan2(Math.sin(yaw - E.yaw), Math.cos(yaw - E.yaw)) / Math.max(dt, 1e-3);
    E.yaw = yaw;
    [E.turn, E.turnV] = spring(E.turn, E.turnV, Math.max(-30, Math.min(30, -yawVel * 9)));
    if (moving !== E.wasMoving) { E.flopV += moving ? 160 : -120; E.wasMoving = moving; }
    [E.flop, E.flopV] = spring(E.flop, E.flopV, 0);
    const d = Math.PI / 180;
    for (const { bone, side } of c.ears) {
      const lift = E.lift + (ex === "thinking" && side > 0 ? 28 : 0) + Math.abs(E.flop) * 0.4;
      const sweep = (E.sweep + E.flop) * side + E.turn;      // sweep: back for both ears; turn: same way for both
      _earQ.setFromAxisAngle(_Z, sweep * d);
      _earQ2.setFromAxisAngle(_X, lift * d);
      bone.quaternion.multiply(_earQ.multiply(_earQ2));
    }
  }

  _applyLife(c, t, dt, moving) {
    // ----- expression
    const e = this.expr || { name: "neutral" };
    if (e.until < t) this.expr = { name: "neutral", until: Infinity };
    const ex = this.expr?.name || "neutral";
    const k = (target, cur, speed = 6) => cur + (target - cur) * Math.min(1, dt * speed);
    c._tilt = k(ex === "thinking" ? 0.22 : ex === "sad" ? -0.08 : 0, c._tilt || 0);
    c._droop = k(ex === "sad" ? 0.18 : ex === "sleepy" ? 0.12 : 0, c._droop || 0);
    if (c.head && c.kind !== "vrm") { c.head.rotation.z = c._tilt; c.head.rotation.x += c._droop; }
    if (c.kind === "penguin") {
      const eyeY = { happy: 0.45, sleepy: 0.18, surprised: 1.35, angry: 0.7, sad: 0.8 }[ex] ?? null;
      c.eyes.forEach((eye, i) => {
        if (eyeY != null && eye.scale.y > 0.2) eye.scale.y = eyeY;
        eye.scale.x = ex === "surprised" ? 1.3 : 1;
        eye.rotation.z = ex === "angry" ? (i ? 0.45 : -0.45) : ex === "sad" ? (i ? -0.35 : 0.35) : 0;
      });
      if (ex === "surprised") c.lower.rotation.x = Math.max(c.lower.rotation.x, 0.45);
    } else if (c.kind === "sketch") {
      c.smile.rotation.z = ex === "sad" || ex === "angry" ? 0.1 : Math.PI * 1.1;
      c.smile.position.y = ex === "sad" || ex === "angry" ? -0.11 : -0.04;
      if (ex === "surprised") c.sketchMouth.scale.y = Math.max(c.sketchMouth.scale.y, 0.9);
      c.smile.scale.setScalar(ex === "happy" ? 1.25 : 1);
    } else if (c.kind === "vrm" && c.vrm.expressionManager) {
      const map = { happy: "happy", sad: "sad", angry: "angry", surprised: "surprised", sleepy: "relaxed", thinking: "relaxed" };
      c._exw = c._exw || {};
      for (const name of ["happy", "sad", "angry", "surprised", "relaxed"]) {
        c._exw[name] = k(map[ex] === name ? 1 : 0, c._exw[name] || 0, 5);
        c.vrm.expressionManager.setValue(name, c._exw[name]);
      }
      if (c.head) c.head.rotation.z = c._tilt;
    }
    if (c.ears?.length) this._moveEars(c, t, dt, moving, ex);
    // ----- emote
    const turnGroup = c.root.children[0];
    turnGroup.rotation.x = 0; turnGroup.position.y = 0;
    const em = this.emote;
    if (em) {
      const u = (t - em.t0) / em.dur;
      if (u >= 1) { this.emote = null; turnGroup.rotation.z = 0; }
      else {
        const s = Math.sin(u * Math.PI);
        switch (em.name) {
          case "jump": turnGroup.position.y = Math.abs(Math.sin(u * Math.PI)) * 0.45; break;
          case "spin": turnGroup.rotation.y = (this.char === c && (turnGroup.userData.baseY ??= turnGroup.rotation.y)) + u * Math.PI * 2; break;
          case "nod": if (c.head) c.head.rotation.x += Math.sin(u * Math.PI * 4) * 0.25; break;
          case "shake": if (c.head) c.head.rotation.y += Math.sin(u * Math.PI * 4) * 0.35; break;
          case "bow": turnGroup.rotation.x = s * 0.45; break;
          case "dance": case "celebrate":
            if (c.actions?.[em.name === "dance" ? "dance" : "happy"]) break;      // the model has its own dance / cheer
            turnGroup.position.y = Math.abs(Math.sin(t * 7)) * 0.12;
            turnGroup.rotation.z = Math.sin(t * 3.5) * 0.15;
            if (c.flippers) { c.flippers[0].rotation.z = -0.25 - Math.abs(Math.sin(t * 7)) * 1.2; c.flippers[1].rotation.z = 0.25 + Math.abs(Math.sin(t * 7 + 1)) * 1.2; }
            break;
          case "wave":
            if (c.flippers) c.flippers[1].rotation.z = 0.25 + 2.2 + Math.sin(t * 12) * 0.35;
            else if (c.kind === "vrm") { const arm = c.vrm.humanoid.getNormalizedBoneNode("rightUpperArm"); arm && (arm.rotation.z = -1.1 + Math.sin(t * 10) * 0.25); }
            else turnGroup.rotation.z = Math.sin(t * 10) * 0.08;
            break;
          case "think": if (c.head) c.head.rotation.x -= 0.15; break;
        }
        if (em.name !== "spin" && turnGroup.userData.baseY != null) { turnGroup.rotation.y = turnGroup.userData.baseY; turnGroup.userData.baseY = null; }
      }
    } else {
      if (turnGroup.userData.baseY != null) { turnGroup.rotation.y = turnGroup.userData.baseY; turnGroup.userData.baseY = null; }
      if (c.kind === "vrm" && c._waved !== false) { const arm = c.vrm.humanoid.getNormalizedBoneNode("rightUpperArm"); arm && (arm.rotation.z = 1.15); }
      turnGroup.rotation.z *= 0.9;                                  // (no bouncing to music - she just smiles while it plays)
    }
  }

  // ---------------- behaviour ----------------
  setSpeaking(on) { this.speaking = !!on; }
  setMirror(on) { this.mirror = !!on; }

  lookAt(x, y) {
    if (x == null) { this.look.tx = 0; this.look.ty = 0; return; }
    const yaw = (0.5 - x) * 1.1 * (this.mirror ? -1 : 1);
    this.look.tx = THREE.MathUtils.clamp(yaw, -0.6, 0.6);
    this.look.ty = THREE.MathUtils.clamp((y - 0.45) * 0.7, -0.3, 0.3);
  }

  walkTo(x, z) {
    const c = this.char;
    if (!c) return;
    const b = this.cozy.walkBounds;
    const target = new THREE.Vector3(THREE.MathUtils.clamp(x, b.minX, b.maxX), 0, THREE.MathUtils.clamp(z, b.minZ, b.maxZ));
    this._pendingUse = null;
    this._afterWalk = null;
    if (c.seat && !c.seat.leaving) {                                // get up first, then walk
      const S = c.seat;
      if (S.chairBase && S.item) this.cozy.place(S.item);           // chair goes back where it belongs
      c.seat = { from: c.root.position.clone(), to: S.front ? S.front.clone() : c.root.position.clone().setY(this._groundY || 0), yaw0: c.root.rotation.y,   // from where she really sat
                 yaw1: S.front ? c.root.rotation.y : c.root.rotation.y, t: 0, dur: S.front ? 0.8 : 0.3, leaving: true, then: target };
      c.activity = null;
      return;
    }
    if (c.seat?.leaving) { c.seat.then = target; return; }
    if (c.activity) { this._dropBook(c); c.activity = null; }       // stop crouching / looking out / reading
    this._planWalk(target);
  }

  /** Furniture is solid: plan a path on a 0.2 m floor grid around everything standing on the floor. */
  _planWalk(target) {
    const c = this.char;
    const b = this.cozy.walkBounds, cell = 0.2, R = 0.32;          // R = how close she gets to furniture (her body is ~0.4 m wide)
    const y0 = 0;
    const nx = Math.ceil((b.maxX - b.minX) / cell) + 1, nz = Math.ceil((b.maxZ - b.minZ) / cell) + 1;
    const blocked = new Uint8Array(nx * nz);
    const boxes = [];
    for (const item of this.cozy.items.values()) {
      if (item.def.mount === "wall" || item.def.flat || (item.spec.y || 0) > 1.0) continue;
      let walkable = false; item.group.traverse((o) => { if (o.userData.floor) walkable = true; });
      if (walkable) continue;
      const box = new THREE.Box3().setFromObject(item.group);
      if (box.max.y - y0 < 0.08) continue;                         // flat things (rugs) don't block
      boxes.push(box);
    }
    const X = (i) => b.minX + i * cell, Z = (j) => b.minZ + j * cell;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = X(i), z = Z(j);
      if (!this.cozy.walkable(x, z)) { blocked[i * nz + j] = 1; continue; }           // walls between rooms
      for (const bx of boxes) if (x > bx.min.x - R && x < bx.max.x + R && z > bx.min.z - R && z < bx.max.z + R) { blocked[i * nz + j] = 1; break; }
    }
    const toCell = (v) => [Math.round((v.x - b.minX) / cell), Math.round((v.z - b.minZ) / cell)].map((n, k) => Math.max(0, Math.min(k ? nz - 1 : nx - 1, n)));
    const [si, sj] = toCell(c.root.position);
    let [gi, gj] = toCell(target);
    const free = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && !blocked[i * nz + j];
    if (!free(gi, gj)) {                                           // clicked inside furniture: go to the nearest free spot
      let best = null;
      for (let r = 1; r < 25 && !best; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++)
        if ((Math.abs(di) === r || Math.abs(dj) === r) && free(gi + di, gj + dj) && (!best || Math.hypot(di, dj) < best[2])) best = [gi + di, gj + dj, Math.hypot(di, dj)];
      if (best) { [gi, gj] = best; target = new THREE.Vector3(X(gi), 0, Z(gj)); }
    }
    // A* (8 directions)
    const N = nx * nz, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const open = [[0, si * nz + sj]]; g[si * nz + sj] = 0;
    const h = (i, j) => { const dx = Math.abs(i - gi), dz = Math.abs(j - gj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    let found = false;
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
      const [, cur] = open.splice(bi, 1)[0];
      if (closed[cur]) continue; closed[cur] = 1;
      const ci = Math.floor(cur / nz), cj = cur % nz;
      if (ci === gi && cj === gj) { found = true; break; }
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const id = ni * nz + nj;
        if (closed[id] || (blocked[id] && !(ni === si && nj === sj))) continue;
        if (di && dj && (blocked[ci * nz + nj] || blocked[ni * nz + cj])) continue;      // don't cut corners
        const ng = g[cur] + (di && dj ? 1.414 : 1);
        if (ng < g[id]) { g[id] = ng; from[id] = cur; open.push([ng + h(ni, nj), id]); }
      }
    }
    if (!found) { this._path = []; this.walkTarget = target; return; }   // no way around: just walk there
    const cells = []; for (let id = gi * nz + gj; id !== -1 && id !== si * nz + sj; id = from[id]) cells.unshift(id);
    const pts = cells.map((id) => new THREE.Vector3(X(Math.floor(id / nz)), 0, Z(id % nz)));
    if (pts.length) pts[pts.length - 1] = target.clone(); else pts.push(target.clone());
    // smooth: skip waypoints she can walk to in a straight line
    const clear = (a, p) => { const d = a.distanceTo(p), n = Math.ceil(d / 0.08); for (let k = 1; k < n; k++) { const q = a.clone().lerp(p, k / n); const [i, j] = toCell(q); if (blocked[i * nz + j] && !(i === si && j === sj)) return false; } return true; };
    const path = []; let a0 = c.root.position.clone().setY(0);
    for (let k = 0; k < pts.length; ) {
      let far = k; for (let m = pts.length - 1; m > k; m--) if (clear(a0, pts[m])) { far = m; break; }
      path.push(pts[far]); a0 = pts[far]; k = far + 1;
    }
    this._path = path;
    this.walkTarget = this._path.shift();
  }

  // ---------- outfits / hair (models with parts named body_<outfit>, <outfit>_*, hair_<style>) ----------
  _findLooks(c) {
    const parts = { outfit: {}, hair: {} };
    c.root.traverse((o) => {
      const n = o.name || "";
      let m = /^body_([a-z]+)$/i.exec(n) || /^(mech|city|school)_\w+$/i.exec(n);
      if (m) (parts.outfit[m[1].toLowerCase()] ||= []).push(o);
      m = /^hair_(\w+)$/i.exec(n);
      if (m) (parts.hair[m[1].toLowerCase()] ||= []).push(o);
    });
    if (Object.keys(parts.outfit).length > 1 || Object.keys(parts.hair).length > 1) c.looks = parts;
  }

  /** {outfit: "mech" | "city" | "school" | "base", hair: "original" | "cute_1" | ...} */
  setLook({ outfit = "", hair = "" } = {}) {
    const c = this.char, L = c?.looks;
    if (!L) return null;
    const outfits = Object.keys(L.outfit), hairs = Object.keys(L.hair);
    const o = outfits.includes(outfit) ? outfit : outfits.includes("mech") ? "mech" : outfits[0];
    const h = hairs.includes(hair) ? hair : hairs.includes("original") ? "original" : hairs[0];
    for (const [k, list] of Object.entries(L.outfit)) for (const m of list) m.visible = k === o;
    for (const [k, list] of Object.entries(L.hair)) for (const m of list) m.visible = k === h;
    c.look = { outfit: o, hair: h };
    if (this.outfit) this._dressUp();                               // hats sit on the new hair
    return { outfit: o, hair: h, outfits, hairs };
  }

  // ---------- picture faces: eyes / mouth are textures that get swapped (blink, talk, moods) ----------
  _findFace(c, file) {
    const mats = {};
    c.root.traverse((o) => { for (const m of [].concat(o.material || [])) if (/^(eyes|mouth)$/i.test(m.name)) mats[m.name.toLowerCase()] = m; });
    if (!mats.eyes || !mats.mouth || !file) return;
    const dir = `models/${encodeURIComponent(file.replace(/\.(glb|gltf)$/i, ""))}_face/`;
    const loader = new THREE.TextureLoader(), cache = {};
    const tex = (name) => cache[name] ||= loader.load(dir + name + ".png", (t) => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; }, undefined, () => { cache[name] = null; });
    for (const n of ["eyes_open", "eyes_closed", "eyes_half", "eyes_angry", "mouth_basic_normal", "mouth_basic_neutral", "mouth_basic_sad",
      "mouth_angry", "mouth_ooo", "mouth_eek", "mouth_open_smile_01", "mouth_open_smile_02", "mouth_smile_01", "mouth_smile_02"]) tex(n);   // load them all up front
    c.face = { mats, tex, cur: {}, blinkIn: 2.5, mouthT: 0, mouth: "", smileUntil: 0, nextSmile: 6 };
  }

  _setFace(c, part, name) {
    const F = c.face, m = F.mats[part];
    if (F.cur[part] === name) return;
    const t = F.tex(name);
    if (!t || !t.image) return;                                     // still loading (or missing): keep the old one
    F.cur[part] = name;
    m.map = t; if (m.emissiveMap) m.emissiveMap = t;
  }

  _faceLife(c, t, dt, ex, talk) {
    const F = c.face;
    // what the body is doing decides the face when she isn't showing a mood already
    const CLIP_FACE = { happy: "happy", sad: "sad", surprised: "surprised", angry: "angry", think: "thinking", sleepy: "sleepy",
      dance: "happy", dance_hiphop: "happy", dance_idol: "happy", dance_twirl: "happy", dance_sway: "dreamy", wave: "happy",
      cheer: "cheer", jump: "happy", clap: "happy", laugh: "laugh", shy: "shy", yawn: "yawn", stretch: "yawn", shrug: "unsure",
      bow: "bow", nod: "happy", shake: "unsure", point: "surprised", look_around: "curious", type: "focus", book_read: "reading",
      book_take: "curious", book_put: "neutral", lounge: "relaxed", sit: "relaxed", lie: "asleep", crouch: "happy", lookout: "dreamy" };
    const fromBody = CLIP_FACE[c._pose];
    if ((!ex || ex === "neutral") && fromBody) ex = fromBody;
    const FACE = {                                                  // extra faces built from the model's eye / mouth pictures
      cheer: ["eyes_closed", "mouth_open_smile_02"], laugh: ["eyes_closed", "mouth_open_smile_02"], shy: ["eyes_half", "mouth_smile_01"],
      yawn: ["eyes_closed", "mouth_ooo"], unsure: ["eyes_half", "mouth_eek"], bow: ["eyes_closed", "mouth_smile_01"],
      curious: ["eyes_open", "mouth_basic_neutral"], focus: ["eyes_half", "mouth_basic_neutral"], reading: ["eyes_half", "mouth_smile_01"],
      relaxed: ["eyes_open", "mouth_smile_01"], dreamy: ["eyes_half", "mouth_smile_02"], asleep: ["eyes_closed", "mouth_basic_neutral"],
    }[ex];
    if (FACE && !this.speaking) {
      F.blinkIn -= dt;
      if (F.blinkIn < -0.16) F.blinkIn = 2 + Math.random() * 3.5;
      const blink = F.blinkIn < 0 && FACE[0] !== "eyes_closed";
      this._setFace(c, "eyes", blink ? "eyes_closed" : FACE[0]);
      this._setFace(c, "mouth", FACE[1]);
      return;
    }
    if (FACE) ex = { cheer: "happy", laugh: "happy", shy: "happy", unsure: "neutral", curious: "neutral", focus: "thinking",
      reading: "neutral", relaxed: "happy", dreamy: "happy", asleep: "sleepy", yawn: "sleepy", bow: "happy" }[ex] || "neutral";
    // eyes: mood + blinking (a quick half -> closed -> half)
    const eyes = { angry: "eyes_angry", sad: "eyes_half", sleepy: "eyes_half", thinking: "eyes_half" }[ex] || "eyes_open";
    F.blinkIn -= dt;
    if (F.blinkIn < -0.16) F.blinkIn = (ex === "sleepy" ? 1.2 : 2) + Math.random() * 3.5 - (Math.random() < 0.2 ? 1.8 : 0);   // sometimes a double blink
    const b = F.blinkIn;
    let eye = eyes;
    if (b < 0) eye = b > -0.04 || b < -0.12 ? "eyes_half" : "eyes_closed";
    if (ex === "happy" && this.emote?.name === "celebrate") eye = "eyes_closed";                                       // ^^ while cheering
    if (c.seat && !c.seat.leaving && !this.speaking && (c.seat.clip === "lie" || ex === "sleepy")) eye = "eyes_closed";  // asleep
    this._setFace(c, "eyes", eye);
    // mouth: talking shapes, otherwise the mood
    let mood = { happy: "mouth_smile_02", sad: "mouth_basic_sad", angry: "mouth_angry", surprised: "mouth_ooo",
                 thinking: "mouth_basic_neutral", sleepy: "mouth_basic_neutral" }[ex] || "mouth_basic_normal";
    if (ex === "neutral" || !ex) {                                   // little smiles now and then, so she feels alive
      if (t > F.nextSmile) { F.smileUntil = t + 2 + Math.random() * 3; F.nextSmile = t + 8 + Math.random() * 14; }
      if (t < F.smileUntil) mood = "mouth_smile_01";
      if (this.music) mood = "mouth_smile_02";
    }
    if (this.speaking) {
      F.mouthT -= dt;
      if (F.mouthT <= 0) {                                           // a new mouth shape ~10 times a second
        F.mouthT = 0.07 + Math.random() * 0.06;
        const open = ex === "happy" ? "mouth_open_smile_02" : ex === "angry" ? "mouth_angry" : ex === "sad" ? "mouth_basic_sad" : "mouth_open_smile_01";
        F.mouth = talk < 0.18 ? mood : talk < 0.45 ? (Math.random() < 0.5 ? "mouth_eek" : "mouth_ooo") : open;
      }
      this._setFace(c, "mouth", F.mouth || mood);
    } else this._setFace(c, "mouth", mood);
  }

  // ---------- reading: take a book off the shelf -> read it (pages turn) -> put it back ----------
  /** A little book in a random colour and size. book.userData.open(0..1) opens it, .flip(0..1) turns a page. */
  _makeBook() {
    const rnd = (a, b) => a + Math.random() * (b - a);
    const w = rnd(0.11, 0.16), h = rnd(0.16, 0.23), t = rnd(0.018, 0.04);
    const cover = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), rnd(0.35, 0.75), rnd(0.35, 0.6)), roughness: 0.8 });
    const paper = new THREE.MeshStandardMaterial({ color: 0xf6efdf, roughness: 0.95 });
    const half = (side) => {                      // one cover + half of the pages, hinged at the spine (x = 0)
      const g = new THREE.Group();
      const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.004), cover); c.position.set(side * w / 2, 0, 0); g.add(c);
      const pg = new THREE.Mesh(new THREE.BoxGeometry(w - 0.008, h - 0.01, t / 2 - 0.004), paper); pg.position.set(side * (w / 2 - 0.002), 0, (t / 4)); g.add(pg);
      return g;
    };
    const book = new THREE.Group(), right = half(1), left = half(-1);
    book.add(right, left);
    const page = new THREE.Group();                  // the page that turns
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.01, h - 0.012), new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.95, side: THREE.DoubleSide }));
    sheet.position.x = (w - 0.01) / 2; page.add(sheet); page.position.z = t / 2; page.visible = false; book.add(page);
    let openK = 0;
    book.userData.open = (k) => {                   // 0 = closed (left half folded onto the right), 1 = flat open
      openK = k;
      left.rotation.y = Math.PI * (1 - k);
      left.position.z = (1 - k) * t * 0.5;
      right.rotation.y = 0;
    };
    book.userData.flip = (k) => {                   // the page lifts from the right and lands on the left
      page.visible = k > 0 && k < 1 && openK > 0.5;
      page.rotation.y = -Math.PI * k * 0.92;
      sheet.position.z = Math.sin(Math.PI * k) * 0.01;
    };
    book.userData.open(0);
    book.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return book;
  }

  _attachBook(c, bone, pos, rot) {
    const book = c.book;
    bone.updateMatrixWorld(true);
    const ws = bone.getWorldScale(new THREE.Vector3()).x || 1;
    bone.add(book);
    book.scale.setScalar(1 / ws);                  // keep its real size in metres
    book.position.copy(pos).multiplyScalar(1 / ws);
    book.rotation.copy(rot);
  }

  /** While reading: the book sits between her hands, tilted so the pages face her eyes. */
  _holdBook(c) {
    const L = c.handL?.getWorldPosition(new THREE.Vector3()), R = c.handR?.getWorldPosition(new THREE.Vector3());
    const head = c.head?.getWorldPosition(new THREE.Vector3());
    if (!L || !R || !head) return;
    const mid = L.add(R).multiplyScalar(0.5);
    mid.y += 0.015;                                 // held at its sides by her hands
    c.book.position.lerp(mid, c.book.userData.held ? 0.5 : 1);
    c.book.userData.held = true;
    head.y += 0.12;                                 // eyes are a bit above the head bone
    c.book.lookAt(head);
  }

  _dropBook(c) {
    if (c.book) { c.book.parent?.remove(c.book); c.book.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); c.book = null; }
  }

  _reading(c, dt) {
    const A = c.activity, a = c.actions;
    A.phase ||= "book_take"; A.t = (A.t || 0) + dt;
    const take = a.book_take, read = a.book_read, put = a.book_put;
    const D = (x) => x.getClip().duration;
    if (A.phase === "book_take") {
      const u = c._pose === "book_take" ? take.time / D(take) : 0;
      if (!c.book && u > 0.33 && c.handR) {        // fingers close on a book at the top of the reach
        c.book = this._makeBook();
        this._attachBook(c, c.handR, new THREE.Vector3(0, 0.09, 0.02), new THREE.Euler(0, 0, Math.PI / 2));
      }
      if (u >= 0.98) {                             // bring it up in both hands and open it
        A.phase = "book_read"; A.t = 0; A.readFor = 18 + Math.random() * 20;
        if (c.book) { this.scene.attach(c.book); c.book.scale.setScalar(1); }
      }
    } else if (A.phase === "book_read") {
      if (c.book) this._holdBook(c);
      if (c.book) {
        c.book.userData.open(Math.min(0.88, A.t / 0.6 * 0.88));
        const u = (read.time % D(read)) / D(read);
        c.book.userData.flip(THREE.MathUtils.clamp((u - 0.46) / 0.14, 0, 1));
      }
      if (A.t > A.readFor) { A.phase = "book_put"; A.t = 0; }
    } else if (A.phase === "book_put") {
      const u = c._pose === "book_put" ? put.time / D(put) : 0;
      if (c.book) {
        c.book.userData.flip(0);
        c.book.userData.open(Math.max(0, 0.88 - A.t / 0.4 * 0.88));      // close it first
        if (c.book.parent === this.scene) this._holdBook(c);
        if (A.t > 0.45 && c.book.parent === this.scene && c.handR) this._attachBook(c, c.handR, new THREE.Vector3(0, 0.09, 0.02), new THREE.Euler(0, 0, Math.PI / 2));
        if (u > 0.62) this._dropBook(c);            // let go of it on the shelf
      }
      if (u >= 0.98) { c.activity = null; }
    }
  }

  // ---------- edit mode helpers: floor grid, green footprint, floating buttons ----------
  _editGrid(on) {
    if (on && !this._grid) {
      const g = new THREE.Group();
      const grid = new THREE.GridHelper(10, 20, 0xffffff, 0xffffff);          // 0.5 m tiles
      grid.material.transparent = true; grid.material.opacity = 0.22; grid.material.depthWrite = false;
      grid.position.set(0, 0.012, 0.25); grid.scale.z = 0.85;
      g.add(grid);
      const foot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x3ddc5a, transparent: true, opacity: 0.45, depthWrite: false }));
      foot.rotation.x = -Math.PI / 2; foot.position.y = 0.016; foot.visible = false;
      g.add(foot);
      this._grid = g; this._foot = foot;
      this.scene.add(g);
    }
    if (this._grid) this._grid.visible = on;
  }

  _updateFootprint() {
    const item = this.editMode && this.selectedId != null ? this.cozy.items.get(this.selectedId) : null;
    if (!this._foot) return;
    if (!item || item.def.mount === "wall") { this._foot.visible = false; return; }
    const box = new THREE.Box3().setFromObject(item.group);
    const snap = (v, up) => (up ? Math.ceil(v * 2) : Math.floor(v * 2)) / 2;   // cover whole 0.5 m tiles
    const x0 = snap(box.min.x, false), x1 = snap(box.max.x, true), z0 = snap(box.min.z, false), z1 = snap(box.max.z, true);
    this._foot.scale.set(Math.max(0.5, x1 - x0), Math.max(0.5, z1 - z0), 1);
    this._foot.position.set((x0 + x1) / 2, 0.016, (z0 + z1) / 2);
    this._foot.visible = true;
  }

  /** Where to put the floating buttons: just below the selected piece, in screen pixels. */
  selectedScreenPosition() {
    const item = this.selectedId != null ? this.cozy.items.get(this.selectedId) : null;
    if (!item) return null;
    const box = new THREE.Box3().setFromObject(item.group);
    const p = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2).project(this.camera);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h };
  }

  recolorSelected(hex) {
    if (this.selectedId == null) return;
    if (performance.now() - (this._lastPaint || 0) > 700) this._remember();     // dragging the colour picker = one step
    this._lastPaint = performance.now();
    this.cozy.recolorItem(this.selectedId, hex);
    this.onLayoutChange?.();
  }

  /** Names of the animations the current model has (for the test buttons). */
  animationNames() { return Object.keys(this.char?.actions || {}); }

  /** Play one animation now (Settings > Test). One-shot clips play once; loops play for `seconds`. */
  testAnimation(name, seconds = 6) {
    const c = this.char, a = c?.actions?.[name];
    if (!a) return false;
    this.walkTarget = null; this._path = [];
    if (c.seat) { c.seat = null; c.baseY = this._groundY || 0; c.root.position.y = c.baseY; }
    this._dropBook(c); c.activity = null;
    const once = a.loop === THREE.LoopOnce;
    this._forced = { clip: name, until: this.clock.elapsedTime + (once ? a.getClip().duration + 0.2 : seconds) };
    if (c._pose === name) c._pose = null;                      // restart it even if it's already playing
    return true;
  }

  stopTest() { this._forced = null; }

  /** Smoothly switch the model to one of its animations. Only does work when the animation actually changes. */
  _setPose(c, name, dur = 0.3) {
    const to = c?.actions?.[name];
    if (!to || c._pose === name) return;
    for (const x of Object.values(c.actions)) if (x !== to && (x.isRunning() || (x.enabled && x.getEffectiveWeight() > 0))) x.fadeOut(dur);
    to.reset().setEffectiveWeight(1).play().fadeIn(dur);
    c._pose = name;
  }

  wave() {
    const c = this.char;
    if (c?.seat) { this.setExpression("happy", 2.5); return; }    // she waves from her seat with a smile instead
    if (c?.actions?.wave) this._setPose(c, "wave", 0.3);   // wave takes over fully; the tick hands back near the end
    else this.hop = 1;
  }

  headScreenPosition() {
    if (!this.char) return null;
    const box = new THREE.Box3().setFromObject(this.char.root);
    const p = new THREE.Vector3((box.min.x + box.max.x) / 2 + 0.25, box.max.y + 0.05, (box.min.z + box.max.z) / 2).project(this.camera);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    return { x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h };
  }

  _pick(e) {
    const r = this.canvas.getBoundingClientRect();
    this._ray ??= new THREE.Raycaster();
    this._ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = this._ray.intersectObjects(this.scene.children, true);
    const shown = (o) => { for (; o; o = o.parent) if (o.visible === false) return false; return true; };
    return hits.find((h) => shown(h.object) && (h.object.userData.interactive || h.object.userData.character || h.object.userData.floor || h.object.isMesh));
  }

  _bindPointer() {
    let down = null, last = 0;
    this.canvas.addEventListener("pointermove", (e) => {
      if (this._drag) {                                        // dragging furniture in edit mode
        const hit = this._dragPoint(e, this._drag.mount);
        if (hit) {
          this.cozy.moveItem(this._drag.id, hit.point, hit.wall);
          this.selectBox.setFromObject(this.cozy.items.get(this._drag.id).group);
          this._drag.moved = true;
        }
        return;
      }
      if (performance.now() - last < 60) return;            // check at most ~16 times a second
      last = performance.now();
      const hit = this._pick(e);
      const label = this.editMode
        ? (hit?.object.userData.itemId != null ? `Drag to move: ${this.cozy.items.get(hit.object.userData.itemId)?.def.label}` : null)
        : hit?.object.userData.interactive?.label || (hit?.object.userData.character ? "Poke" : null);
      this.canvas.style.cursor = label ? "pointer" : hit?.object.userData.floor ? "crosshair" : "grab";
      this.onHover?.(label, e.clientX, e.clientY);
    });
    this.canvas.addEventListener("pointerleave", () => this.onHover?.(null));
    this.canvas.addEventListener("pointerdown", (e) => {
      down = [e.clientX, e.clientY];
      if (!this.editMode) return;
      const hit = this._pick(e);
      let id = hit?.object?.userData?.itemId;
      if (id == null && hit?.object) {
        let cur = hit.object;
        while (cur && id == null) {
          if (cur.userData?.itemId != null) id = cur.userData.itemId;
          cur = cur.parent;
        }
      }
      if (id != null) {
        this.select(id);
        const it = this.cozy.items.get(id);
        this._drag = { id, mount: it.def.mount, moved: false, snap: JSON.stringify(this.cozy.serialize()) };
        this.controls.enabled = false;
        this.canvas.setPointerCapture(e.pointerId);
      }
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (this._drag) {
        const { moved, snap, id } = this._drag;
        this._drag = null;
        this.controls.enabled = true;
        if (moved) {
          if (!this.gym) { this.undoStack.push(snap); if (this.undoStack.length > 40) this.undoStack.shift(); this.onUndoChange?.(this.undoStack.length); }
          this._pop(this.cozy.items.get(id), 0.5);                   // a soft bounce where it lands
          this.onLayoutChange?.();
        }
        return;
      }
      if (this.editMode) {
        if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) <= 4) this.select(null);
        return;
      }
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const hit = this._pick(e);
      if (!hit) return;
      const ud = hit.object.userData;
      if (ud.interactive) {
        const result = ud.interactive.onClick();
        this.onInteract?.(ud.interactive.label.split(":")[0], result);
        this.onLayoutChange?.();
      } else if (ud.character) {
        this.hop = 1;
        this.onPoke?.();
      } else if (ud.floor) {
        this.walkTo(hit.point.x, hit.point.z);
      }
    });
  }

  /** draw a frame now? Nothing on screen when the window is hidden; 30 frames a second while the room is calm
      (she's standing, nobody's touching it) and the full 60 while something moves - half the work most of the time */
  _frameDue(now) {
    if (document.hidden) return false;
    const active = this._camTween || this.walkTarget || this.speaking || this.editMode || this.hop > 0 || this.emote
      || (this._userActive || 0) > now || this.char?.seat?.leaving || (this.char?.seat && this.char.seat.t < 1);
    const gap = now - (this._lastFrame || 0);
    if (!active && gap < 31) return false;
    // too slow while moving: draw a little less sharp (and back up when there's room again), at most every 2 s
    if (active && gap < 200) {
      this._ft = (this._ft ?? 16.7) * 0.92 + gap * 0.08;
      const r = this.renderer, pr = r.getPixelRatio();
      if (now - (this._prAt || 0) > 2000) {
        let next = pr;
        if (this._ft > 26 && pr > 1) next = Math.max(1, pr - 0.15);
        else if (this._ft < 18 && pr < this._prMax) next = Math.min(this._prMax, pr + 0.1);
        if (next !== pr) { this._prAt = now; r.setPixelRatio(next); this._resize(); }
      }
    }
    this._lastFrame = now;
    return true;
  }

  _tick() {
    if (!this._frameDue(performance.now())) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    if (this._camTween) {                                           // smooth camera glide (edit mode <-> normal view)
      const T = this._camTween;
      T.k = Math.min(1, T.k + dt / 1.1);
      const e = T.k < 0.5 ? 4 * T.k ** 3 : 1 - (-2 * T.k + 2) ** 3 / 2;
      this.camera.position.lerpVectors(T.p0, T.p1, e);
      this.controls.target.lerpVectors(T.t0, T.t1, e);
      this.camera.fov = T.f0 + (T.f1 - T.f0) * e; this.camera.updateProjectionMatrix();
      if (T.k >= 1) { this._camTween = null; this.controls.enabled = true; }
    }
    this.controls.update();
    this.cozy.update(t, dt);
    if (this._pops.length) this._updatePops(dt);
    if (this.editMode) { this._updateFootprint(); const sel = this.cozy.items.get(this.selectedId); if (sel) this.selectBox.setFromObject(sel.group); }
    if (this.gym) this.gym.setClock((Date.now() - this.gym.startedAt) / 1000);
    this._followRoom();
    const c = this.char;
    if (c) {
      const L = this.look;
      L.x += (L.tx - L.x) * Math.min(1, dt * 5);
      L.y += (L.ty - L.y) * Math.min(1, dt * 5);
      const talk = this.speaking ? (Math.sin(t * 18) * 0.5 + 0.5) * (0.6 + 0.4 * Math.sin(t * 7.3)) : 0;

      // walking
      let moving = false;
      const busy = this._furniture(c, dt);                     // sitting down / getting up / seated
      if (this.walkTarget && !busy) {
        const pos = c.root.position;
        const to = this.walkTarget.clone().sub(pos);
        to.y = 0;
        const dist = to.length();
        if (dist < 0.12 && this._path?.length) {                  // corner reached: on to the next waypoint
          this.walkTarget = this._path.shift();
          moving = true;
        } else if (dist < 0.05) {
          this.walkTarget = null;
          c.speed = 0;
          const P = this._pendingUse;
          this._pendingUse = null;
          const after = this._afterWalk;
          this._afterWalk = null;
          if (after) after();
          if (P?.seat) {                                          // turn around and sit down smoothly
            c.seat = { from: pos.clone(), to: P.seat.clone(), yaw0: c.root.rotation.y, yaw1: P.yaw, t: 0, dur: 0.9, front: P.front, clip: P.use.clip,
                       item: P.item, top: P.top, edge: P.edge, back: P.back };
          } else if (P) { this._dropBook(c); c.activity = { clip: P.use.clip, yaw: P.yaw }; }
        } else {
          moving = true;
          const face = Math.atan2(to.x, to.z);
          const turn = angleTo(c.root.rotation.y, face);
          c.root.rotation.y += turn * Math.min(1, dt * 7);
          // ease in at the start, slow down near the end, and slow while still turning
          let left = dist; for (let k = 0, p0 = this.walkTarget; k < (this._path?.length || 0); p0 = this._path[k++]) left += p0.distanceTo(this._path[k]);
          const want = Math.min(WALK_SPEED, left * 2.2 + 0.15) * (Math.abs(turn) > 1.2 ? 0.35 : 1);
          c.speed = (c.speed || 0) + (want - (c.speed || 0)) * Math.min(1, dt * 5);
          pos.addScaledVector(to.normalize(), Math.min(dist, c.speed * dt));
        }
      }
      if (c.activity) c.root.rotation.y += angleTo(c.root.rotation.y, c.activity.yaw) * Math.min(1, dt * 4);
      else if (!moving && !c.seat) {        // turn back towards you when standing still
        const face = Math.atan2(this.camera.position.x - c.root.position.x, this.camera.position.z - c.root.position.z);
        c.root.rotation.y += Math.atan2(Math.sin(face - c.root.rotation.y), Math.cos(face - c.root.rotation.y)) * Math.min(1, dt * 3);
      }
      if (c.mixer && c.actions.idle) {               // one animation at a time: walk, talk or idle (wave is started by wave())
        const a = c.actions;
        const ex = this.expr?.until > t ? this.expr.name : "neutral";
        const emoteClip = { dance: "dance", celebrate: "happy", think: "think" }[this.emote?.name];
        const moodClip = { happy: "happy", sad: "sad", surprised: "surprised", angry: "angry", thinking: "think", sleepy: "sleepy" }[ex];
        const seated = c.seat && !c.seat.leaving && a[c.seat.clip] ? c.seat.clip : null;
        if (c.activity?.clip === "read") this._reading(c, dt);
        const actClip = c.activity?.clip === "read" ? c.activity.phase : c.activity?.clip;
        const doing = !seated && actClip && a[actClip] && (!this.speaking || c.activity?.clip === "read") ? actClip : null;
        const reading = c.activity?.clip === "read" && doing;
        const F = this._forced;                                    // Settings > Test: play one animation on demand
        if (F && (t > F.until || !a[F.clip])) this._forced = null;
        const want = this._forced ? this._forced.clip : seated || (moving && a.walk ? "walk" : reading ? reading : emoteClip && a[emoteClip] ? emoteClip : doing || (this.speaking && a.talk ? "talk"
          : moodClip && a[moodClip] ? moodClip : "idle"));
        const waving = c._pose === "wave" && a.wave.time < a.wave.getClip().duration - 0.35;
        if (!waving || moving) this._setPose(c, want, seated || c.seat ? 0.7 : moving ? 0.25 : 0.45);
      }

      if (c.mixer) c.mixer.update(dt);
      if (c.seat && !c.seat.leaving && c.seat.top != null && c.seat.clip !== "lie") this._seatLegs(c);
      if (c.arms?.L?.hand && c.arms?.R?.hand) {
        if (c.seat && !c.seat.leaving && c.seat.clip === "type") this._handsOnDesk(c, t);
        if (c.seat && !c.seat.leaving && c.seat.item && c.seat.t >= 1) this._handsOutOfFurniture(c, c.seat.item);
        this._solidBody(c);
      }
      const lookX = moving ? 0 : L.x, lookY = moving ? 0 : L.y;
      if (c.kind === "vrm") {
        c.spine && (c.spine.rotation.x = Math.sin(t * 1.6) * 0.02);
        c.blinkIn -= dt;
        const blink = c.blinkIn < 0.12 ? 1 : 0;
        if (c.blinkIn < 0) c.blinkIn = 2 + Math.random() * 4;
        c.vrm.expressionManager?.setValue("blink", blink);
        c.vrm.expressionManager?.setValue("aa", talk * 0.8);
        if (c.head) { c.head.rotation.y = lookX; c.head.rotation.x = lookY; }
        c.vrm.update(dt);
      } else if (c.kind === "gltf") {
        if (c.head && !c.mixer) c.head.rotation.copy(c.headBase);
        if (c.head) { c.head.rotation.y += lookX; c.head.rotation.x += lookY; }
        for (const [mesh, i] of c.mouths) mesh.morphTargetInfluences[i] = talk;
        if (c.fingers.length) this._moveFingers(c, t, dt, talk);
        if (c.face) this._faceLife(c, t, dt, this.expr?.until > t ? this.expr.name : "neutral", talk);
        else if (!c.mouths.length && this.speaking && c.head) c.head.rotation.x += talk * 0.06;
      } else if (c.kind === "penguin") {
        c.head.rotation.y = lookX;
        c.head.rotation.x = lookY;
        c.lower.rotation.x = talk * 0.5;                                     // beak opens while talking
        c.blinkIn -= dt;
        const blink = c.blinkIn < 0.12;
        if (c.blinkIn < 0) c.blinkIn = 2 + Math.random() * 4;
        for (const e of c.eyes) e.scale.y = blink ? 0.12 : 1;
        const flap = this.speaking ? Math.sin(t * 9) * 0.35 : Math.sin(t * 1.8) * 0.05;
        c.flippers[0].rotation.z = -0.25 - flap;
        c.flippers[1].rotation.z = 0.25 + flap;
        if (moving) {                                                        // waddle
          c.bodyPivot.rotation.z = Math.sin(t * 9) * 0.14;
          c.feet[0].position.z = 0.12 + Math.sin(t * 9) * 0.08;
          c.feet[1].position.z = 0.12 - Math.sin(t * 9) * 0.08;
        } else {
          c.bodyPivot.rotation.z *= 0.85;
          c.bodyPivot.scale.y = 1 + Math.sin(t * 1.6) * 0.012;              // breathing
          for (const f of c.feet) f.position.z += (0.12 - f.position.z) * 0.2;
        }
      } else if (c.kind === "sketch") {
        c.head.rotation.y = lookX;
        c.head.rotation.x = lookY;
        c.head.position.y = 1.3 + Math.sin(t * 1.6) * 0.012;
        c.sketchMouth.scale.y = Math.max(0.001, talk);
        c.smile.visible = !this.speaking;
        c.root.children[0].position.y = moving ? Math.abs(Math.sin(t * 10)) * 0.05 : 0;
      }
      this._applyLife(c, t, dt, moving);
      if (this.hop > 0) {
        this.hop = Math.max(0, this.hop - dt * 2.2);
        c.root.position.y = (c.baseY || 0) + Math.sin((1 - this.hop) * Math.PI) * (c.seat ? 0.05 : 0.18);
      }
    }
    this.composer.render();
  }
}
