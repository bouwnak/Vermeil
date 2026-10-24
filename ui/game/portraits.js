// portraits.js - live portraits of the party (and of everyone in a battle's turn order): the character's own 3D model,
// as it stands right now, drawn from the front at head height into a small picture. Refreshed every few seconds and
// whenever someone is hit or healed, so the circles always show the real character (and their current pose).
import * as THREE from "three";

const LAYER = 7;                        // a render layer only the portrait camera looks at
const SIZE = 112;

export class Portraits {
  constructor(engine) {
    this.engine = engine;
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    this.cam.layers.set(LAYER);
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, { colorSpace: THREE.SRGBColorSpace });
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = SIZE;
    this.px = new Uint8Array(SIZE * SIZE * 4);
    this.cache = new Map();             // uid -> dataURL
    this.light = new THREE.DirectionalLight(0xffffff, 2.2);
    this.fill = new THREE.HemisphereLight(0xfff3dd, 0x2a2240, 1.6);
    for (const l of [this.light, this.fill]) { l.layers.set(LAYER); engine.scene.add(l); }
    engine.scene.add(this.light.target);
  }

  /** draw one actor -> dataURL (or the cached one if it can't be drawn right now) */
  shoot(actor) {
    const uid = actor?.info?.uid;
    if (!actor?.group || !uid) return null;
    const E = this.engine, R = E.renderer;
    // the model's real height (a penguin or a slime is far shorter than the 1.7 m a human is assumed to be)
    const box = new THREE.Box3().setFromObject(actor.group);
    const real = box.isEmpty() ? 0 : box.max.y - box.min.y;
    const h = real > 0.15 && real < 12 ? real : actor.height || 1.7;
    const low = real > 0.15 && real < 12 ? box.min.y : actor.pos.y;
    const small = actor.body === "blob" || h < 1;                     // small bodies: show the whole creature, not just a head
    const head = new THREE.Vector3(actor.pos.x, low + h * (small ? 0.55 : actor.body === "quadruped" ? 0.7 : 0.86), actor.pos.z);
    const fwd = new THREE.Vector3(Math.sin(actor.heading || 0), 0, Math.cos(actor.heading || 0));
    const dist = small ? Math.max(0.5, h * 2.1) : Math.max(0.9, h * 0.62);
    this.cam.position.copy(head).addScaledVector(fwd, dist).add(new THREE.Vector3(0, h * 0.03, 0));
    this.cam.lookAt(head);
    this.light.position.copy(this.cam.position).add(new THREE.Vector3(1, 2, 0.5));
    this.light.target.position.copy(head);
    const touched = [];
    actor.group.traverse((o) => { if (!o.layers.isEnabled(LAYER)) { o.layers.enable(LAYER); touched.push(o); } });
    const prev = { target: R.getRenderTarget(), bg: E.scene.background, fog: E.scene.fog, auto: R.shadowMap.autoUpdate, alpha: R.getClearAlpha(), color: R.getClearColor(new THREE.Color()) };
    try {
      E.scene.background = null; E.scene.fog = null;
      R.shadowMap.autoUpdate = false;
      R.setRenderTarget(this.target);
      R.setClearColor(0x000000, 0); R.clear();
      R.render(E.scene, this.cam);
      R.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.px);
    } catch (e) { console.warn("portrait", e); return this.cache.get(uid) || null; }
    finally {
      R.setRenderTarget(prev.target); R.setClearColor(prev.color, prev.alpha);
      E.scene.background = prev.bg; E.scene.fog = prev.fog; R.shadowMap.autoUpdate = prev.auto;
      for (const o of touched) o.layers.disable(LAYER);
    }
    // the render target is upside down compared with a canvas
    const ctx = this.canvas.getContext("2d");
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) img.data.set(this.px.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.putImageData(img, 0, 0);
    const url = this.canvas.toDataURL("image/png");
    this.cache.set(uid, url);
    return url;
  }

  get(uid) { return this.cache.get(uid) || null; }
}
