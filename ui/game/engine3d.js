// engine3d.js - renderer, scene, lights, sky, third-person camera and the frame loop.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.quality = localStorage.getItem("vda_quality") || "high";
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality !== "low", powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === "high" ? 1.75 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;               // setQuality() below turns them on
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.timeScale = 1;            // < 1 for a split second when a big hit lands ("hit-stop")
    this.updaters = new Set();
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

    // lights: warm sun + sky fill (the forest reference is bright and soft)
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a7a3a, 1.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d0, 2.4);
    this.sun.position.set(30, 50, 20);
    const sz = 28;                 // shadows near the action only (far ones fade into the fog anyway) - much cheaper
    Object.assign(this.sun.shadow.camera, { left: -sz, right: sz, top: sz, bottom: -sz, near: 1, far: 140 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(0xcfe9d0, 30, 100);
    this.sky = this.makeSky();
    this.scene.add(this.sky);

    // post: soft bloom for magic, lanterns and the portal (made on demand - Low quality doesn't use it)
    this.composer = null;
    this.perf = localStorage.getItem("vda_perf") || "balanced";

    // third-person camera
    this.cam = { target: new THREE.Vector3(), yaw: Math.PI, pitch: 0.5, dist: 11, want: new THREE.Vector3(), mode: "follow",
                 shot: null, minDist: 4, maxDist: 26, shake: 0 };
    this._drag = null;
    canvas.addEventListener("pointerdown", (e) => { if (e.button === 2 || e.button === 1 || e.shiftKey) this._drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener("pointermove", (e) => {
      if (!this._drag) return;
      this.cam.yaw -= (e.clientX - this._drag.x) * 0.006;
      this.cam.pitch = Math.max(0.12, Math.min(1.25, this.cam.pitch + (e.clientY - this._drag.y) * 0.004));
      this._drag = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("pointerup", () => (this._drag = null));
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => { this.cam.dist = Math.max(this.cam.minDist, Math.min(this.cam.maxDist, this.cam.dist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
    window.addEventListener("resize", () => this.resize());
    this.setQuality(this.quality);
    this.resize();
    this.loop = this.loop.bind(this);
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  makeSky() {
    const g = new THREE.SphereGeometry(300, 24, 12);
    this.skyU = { top: { value: new THREE.Color(0x8fd3ff) }, bottom: { value: new THREE.Color(0xeaf6ff) }, uTime: this.uniforms.uTime, stars: { value: 0 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float stars; uniform float uTime; varying vec3 vP;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
        void main(){ float t = smoothstep(-0.15, 0.6, vP.y); vec3 c = mix(bottom, top, t);
          // soft clouds
          float cl = smoothstep(0.55, 0.9, sin(vP.x*6.0+uTime*0.01)*sin(vP.z*5.0)*0.5+0.5) * smoothstep(0.05, 0.35, vP.y) * (1.0-stars);
          c = mix(c, vec3(1.0), cl*0.35);
          if (stars > 0.0) { vec3 q = floor(vP*220.0); float s = step(0.996, h(q)) * smoothstep(0.0,0.3,vP.y); c += s*stars*(0.6+0.4*sin(uTime*2.0+h(q)*20.0)); }
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = -1;
    return mesh;
  }

  setAtmosphere({ sky = ["#8fd3ff", "#eaf6ff"], fog = ["#cfe9d0", 30, 95], sun = "#fff2cc", ambient = "#b9d7ff", ground = "#6fae3f", time = "day" } = {}) {
    this.skyU.top.value.set(sky[0]);
    this.skyU.bottom.value.set(sky[1]);
    this.skyU.stars.value = time === "night" ? 1 : time === "dark" ? 0.4 : 0;
    this.scene.fog.color.set(fog[0]);
    this.scene.fog.near = fog[1];
    this.scene.fog.far = fog[2];
    this.sun.color.set(sun);
    this.sun.intensity = { day: 2.5, dusk: 1.6, night: 0.7, dark: 0.45 }[time] ?? 2.4;
    this.hemi.color.set(ambient);
    this.hemi.groundColor.set(ground);
    this.hemi.intensity = { day: 1.25, dusk: 1.0, night: 0.75, dark: 0.7 }[time] ?? 1.2;
    this.renderer.toneMappingExposure = { day: 1.05, dusk: 1.0, night: 1.05, dark: 1.15 }[time] ?? 1.05;
    if (this.bloom) this.bloom.strength = time === "day" ? 0.4 : 0.75;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      this.bloom?.setSize(Math.round(w * 0.5), Math.round(h * 0.5));          // the glow doesn't need full resolution
    }
  }

  onUpdate(fn) { this.updaters.add(fn); return () => this.updaters.delete(fn); }

  /** freeze the action for a moment so a hit feels heavy */
  hitStop(seconds = 0.08, scale = 0.06) {
    this.timeScale = scale;
    clearTimeout(this._hs);
    this._hs = setTimeout(() => (this.timeScale = 1), seconds * 1000);
  }

  /** compile every shader now (during a loading screen) so the first frames don't stutter */
  warmUp() { try { this.renderer.compile(this.scene, this.camera); } catch (e) { console.warn(e); } }

  /** smoothly move the camera to look at `at` from `from` (for combat and cinematics); null = back to follow */
  shot(from, at, speed = 2.5) {
    this.cam.shot = from ? { from: from.clone(), at: at.clone(), speed } : null;
  }

  follow(target) { this.cam.target.copy(target); }

  /** jump the follow camera straight into place (after travelling) */
  snap() {
    const c = this.cam;
    const off = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist);
    this.camera.position.copy(c.target).add(off);
    c._look = c.target.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.camera.lookAt(c._look);
  }

  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const raw = Math.min(0.5, this.clock.getDelta());
    const dt = Math.min(0.05, raw) * this.timeScale;
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    for (const fn of this.updaters) {
      try { fn(dt, this.time); } catch (e) { console.error(e); this.updaters.delete(fn); }
    }
    this.updateCamera(raw);
    // keep the sun's shadow box around the camera target
    // ...moved in whole shadow-pixel steps, so shadows don't shimmer while the camera glides
    const off = this._sunOff ||= new THREE.Vector3(30, 50, 20);
    const rot = this._sunRot ||= new THREE.Matrix4().lookAt(off, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const inv = this._sunInv ||= rot.clone().invert();
    const texel = (2 * 28) / this.sun.shadow.mapSize.x;
    const p = (this._sunP ||= new THREE.Vector3()).copy(this.cam.target).applyMatrix4(inv);
    p.set(Math.round(p.x / texel) * texel, Math.round(p.y / texel) * texel, p.z).applyMatrix4(rot);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).add(off);
    this.sky.position.copy(this.camera.position);
    // shadows are redrawn every other frame (they move slowly; the shadow pass redraws every tree, so this is a big saving)
    if (this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.autoUpdate = false;
      this._sf = (this._sf || 0) + 1;
      if (this._sf % 2 === 0 || this.cam.shake > 0.05) this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.composer && this.useComposer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.adapt(raw);
  }

  /** Graphics quality, applied right away (no restart):
      low = no shadows, no glow, sharpness 1x, short draw distance · medium = soft shadows + glow · high = sharp shadows, 1.75x */
  setQuality(q) {
    q = ["low", "medium", "high"].includes(q) ? q : "high";
    this.quality = q;
    const shadows = q !== "low";
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    }
    this.sun.castShadow = shadows;
    const size = q === "high" ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (q !== "low" && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.6, 0.86);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.useComposer = q !== "low";
    const maxPr = Math.min(window.devicePixelRatio || 1, { low: 1, medium: 1.25, high: 1.75 }[q]);
    this.renderer.setPixelRatio(maxPr);
    this.drawBase = { low: 0.6, medium: 0.85, high: 1 }[q];
    this._ad = null;                                   // adaptive resolution starts over from the new maximum
    this.resize();
  }

  /** Performance mode: fast = keep 60 fps no matter what · balanced = smooth with good looks · graphics = looks first */
  setPerf(mode) {
    this.perf = ["fast", "balanced", "graphics"].includes(mode) ? mode : "balanced";
    this._ad = null;
  }

  /** adaptive resolution: if frames get slow (big battles, many models) render a little smaller, and go back up
      when there's room - the game stays smooth instead of stuttering. Changes at most every 2 seconds. */
  adapt(raw) {
    if (document.hidden || raw <= 0 || raw > 0.25) return;
    const P = { fast: { slow: 1 / 55, min: 0.5 }, balanced: { slow: 1 / 40, min: 0.6 }, graphics: { slow: 1 / 26, min: 0.85 } }[this.perf || "balanced"];
    const A = this._ad ||= { avg: 1 / 60, last: 0, max: this.renderer.getPixelRatio(), min: Math.min(P.min, this.renderer.getPixelRatio()), slow: P.slow };
    A.avg += (raw - A.avg) * 0.05;
    if (this.time - A.last < 2) return;
    const pr = this.renderer.getPixelRatio();
    let next = pr;
    if (A.avg > A.slow && pr > A.min) next = Math.max(A.min, pr - 0.15);              // too slow for this mode: lighter
    else if (A.avg < 1 / 58 && pr < A.max) next = Math.min(A.max, pr + 0.1);       // steady 60: sharper again
    if (next !== pr) {
      A.last = this.time;
      this.renderer.setPixelRatio(next);
      this.resize();
    }
  }

  updateCamera(dt) {
    const c = this.cam, cam = this.camera;
    const k = 1 - Math.exp(-dt * 5);
    if (c.shot) {
      const s = c.shot, kk = 1 - Math.exp(-dt * s.speed);
      cam.position.lerp(s.from, kk);
      c._look = (c._look || s.at.clone()).lerp(s.at, kk);
      cam.lookAt(c._look);
    } else {
      const look = c.target.clone().add(new THREE.Vector3(0, 1.2, 0));
      const dirOf = (yaw, pitch) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      // a tree or rock between the camera and the hero (checked a few times a second): come in closer, in front of
      // it - and if that would be too close, swing up or to the side to a spot that can see the hero
      c._occT = (c._occT || 0) - dt;
      if (c._occT <= 0 && c.occluders) {
        c._occT = 0.12;
        const list = c.occluders();
        const rc = (this._rc ||= new THREE.Raycaster());
        const freeAlong = (d) => {
          if (!list?.length) return c.dist;
          rc.set(look, d); rc.far = c.dist + 0.4;
          const hit = rc.intersectObjects(list, false)[0];
          return hit ? hit.distance - 0.45 : c.dist;
        };
        let best = { dy: 0, dp: 0, free: freeAlong(dirOf(c.yaw, c.pitch)) };
        if (best.free < Math.min(4, c.dist * 0.5))
          for (const [dy, dp] of [[0, 0.35], [0, 0.7], [0.5, 0.2], [-0.5, 0.2], [0.9, 0.35], [-0.9, 0.35], [0, 1.0], [1.5, 0.3], [-1.5, 0.3]]) {
            const f = freeAlong(dirOf(c.yaw + dy, Math.min(1.35, c.pitch + dp)));
            if (f > best.free + 0.5) best = { dy, dp, free: f };
            if (f >= c.dist - 0.01) break;
          }
        best.free = Math.max(1.6, best.free);
        c._sw = best;
      }
      const sw = c._sw || { dy: 0, dp: 0, free: c.dist };
      const ks = 1 - Math.exp(-dt * 4);
      c._dy = (c._dy || 0) + (sw.dy - (c._dy || 0)) * ks; c._dp = (c._dp || 0) + (sw.dp - (c._dp || 0)) * ks;
      const dir = dirOf(c.yaw + c._dy, Math.min(1.35, c.pitch + c._dp));
      const want = Math.min(c.dist, sw.free);
      c._d = c._d == null ? want : c._d + (want - c._d) * (want < c._d ? 1 - Math.exp(-dt * 14) : 1 - Math.exp(-dt * 2.5));   // in fast, out slowly
      c.want.copy(look).addScaledVector(dir, c._d).sub(new THREE.Vector3(0, 1.2, 0));
      cam.position.lerp(c.want, c._d < c.dist - 0.2 ? Math.max(k, 1 - Math.exp(-dt * 12)) : k);
      c._look = (c._look || look.clone()).lerp(look, k);
      cam.lookAt(c._look);
    }
    if (c.shake > 0) {
      c.shake = Math.max(0, c.shake - dt * 2.5);
      cam.position.x += (Math.random() - 0.5) * c.shake * 0.4;
      cam.position.y += (Math.random() - 0.5) * c.shake * 0.4;
    }
  }

  /** world -> screen pixels (for labels) */
  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, visible: p.z < 1 && p.z > -1 };
  }
}
