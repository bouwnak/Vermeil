// closeup.js - Vermeil up close on the right of Game Night: her 3D model (the same one as in the room), framed on
// her head and shoulders. She idles, blinks, talks while her line is shown, follows your mouse with her head,
// reacts to the game with her animations (cheer, clap, laugh, think…) and giggles when you click her.
// If the 3D view can't start (no WebGL, model missing) the panel shows a big 💜 instead and everything else works.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { inPlace } from "../inplace.js";

// clips that play once and then go back to idling
const ONCE = new Set(["cheer", "clap", "laugh", "bow", "nod", "shake", "shrug", "point", "surprised", "happy", "angry", "sad", "shy",
  "wave", "jump", "think", "look_around", "stretch", "yawn"]);
// faces made from the model's eye / mouth pictures (models/anime_girl_face/)
const FACES = { idle: ["eyes_open", "mouth_basic_normal"], happy: ["eyes_open", "mouth_smile_02"], laugh: ["eyes_closed", "mouth_open_smile_02"],
  cheer: ["eyes_closed", "mouth_open_smile_02"], clap: ["eyes_open", "mouth_open_smile_01"], sad: ["eyes_half", "mouth_basic_sad"],
  angry: ["eyes_angry", "mouth_angry"], surprised: ["eyes_open", "mouth_ooo"], think: ["eyes_half", "mouth_basic_neutral"],
  shy: ["eyes_half", "mouth_smile_01"], shrug: ["eyes_half", "mouth_eek"], smug: ["eyes_half", "mouth_smile_02"] };
const MODEL = "anime_girl.glb", HEIGHT = 1.6;

const stub = { react() {}, talk() {}, ready: Promise.resolve(false) };

/** Put Vermeil in `box`. Returns { react(clip, face), talk(ms), ready } */
export function closeUp(box, { outfit = "mech", hair = "original", onPoke = () => {} } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    box.classList.add("vm-flat");
    return stub;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  box.prepend(renderer.domElement);
  renderer.domElement.className = "vm-canvas";

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--blue").trim() || "#3e8eff";
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404060, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, 2, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(accent), 3.2); rim.position.set(-2, 1.5, -2); scene.add(rim);

  let mixer = null, actions = {}, current = null, head = null, face = null, root = null;
  let faceName = "idle", faceUntil = 0, talkUntil = 0, blinkIn = 2.5, mouthT = 0, mouthOpen = false;
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const target = new THREE.Vector3(), headPos = new THREE.Vector3();

  function size() {
    const w = box.clientWidth || 300, h = box.querySelector(".vm-view")?.clientHeight || box.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(size).observe(box);

  function play(name, again = false) {
    const a = actions[name] || actions.idle;
    if (!a || (a === current && !again)) return;
    const prev = current;
    a.reset();
    a.setLoop(ONCE.has(name) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = true;
    a.play();
    if (prev && prev !== a) prev.crossFadeTo(a, 0.3, false);
    current = a;
  }

  function setFace(part, name) {
    if (!face || face.cur[part] === name) return;
    const t = face.tex(name);
    if (!t?.image) return;
    face.cur[part] = name;
    face.mats[part].map = t;
    if (face.mats[part].emissiveMap) face.mats[part].emissiveMap = t;
  }

  const ready = new GLTFLoader().loadAsync(`../models/${MODEL}`).then((gltf) => {
    root = gltf.scene;
    const s = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    root.scale.multiplyScalar(HEIGHT / Math.max(s.y, 1e-6));
    const b = new THREE.Box3().setFromObject(root);
    root.position.y -= b.min.y;
    const mats = {};
    root.traverse((o) => {
      const n = o.name || "";
      let m = /^body_([a-z]+)$/i.exec(n) || /^(mech|city|school)_\w+$/i.exec(n);
      if (m) o.visible = m[1].toLowerCase() === outfit;
      m = /^hair_(\w+)$/i.exec(n);
      if (m) o.visible = m[1].toLowerCase() === hair;
      if (o.isBone && !head && /head/i.test(n) && !/(top|end|nub)/i.test(n)) head = o;
      if (o.isMesh) o.frustumCulled = false;
      for (const mt of [].concat(o.material || [])) if (/^(eyes|mouth)$/i.test(mt.name)) mats[mt.name.toLowerCase()] = mt;
    });
    if (mats.eyes && mats.mouth) {
      const loader = new THREE.TextureLoader(), cache = {};
      const tex = (n) => cache[n] ||= loader.load(`../models/anime_girl_face/${n}.png`, (t) => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; }, undefined, () => { cache[n] = null; });
      for (const [e, m] of Object.values(FACES)) { tex(e); tex(m); }
      ["mouth_eek", "mouth_ooo", "mouth_open_smile_01"].forEach(tex);
      face = { mats, tex, cur: {} };
    }
    scene.add(root);
    if (gltf.animations.length) {
      inPlace(gltf.animations);
      mixer = new THREE.AnimationMixer(root);
      for (const clip of gltf.animations) actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
      mixer.addEventListener("finished", () => play("idle"));
      play("idle");
      mixer.update(0.01);
    }
    root.updateMatrixWorld(true);
    (head || root).getWorldPosition(headPos);
    if (!head) headPos.y = HEIGHT * 0.9;
    target.copy(headPos).add(new THREE.Vector3(0, -0.1, 0));
    box.classList.add("vm-ready");
    size();
    return true;
  }).catch((e) => {
    console.warn("[game night] Vermeil close-up:", e);
    box.classList.add("vm-flat");
    renderer.domElement.remove();
    return false;
  });

  // she follows the mouse with her head, and giggles when you click her
  addEventListener("pointermove", (e) => {
    const r = box.getBoundingClientRect();
    look.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (innerWidth / 2)));
    look.ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.3)) / (innerHeight / 2)));
  });
  renderer.domElement.addEventListener("click", () => onPoke());

  const clock = new THREE.Clock();
  (function frame() {
    requestAnimationFrame(frame);
    if (document.hidden || !root) return;
    const dt = Math.min(clock.getDelta(), 0.1), now = performance.now();
    mixer?.update(dt);
    look.x += (look.tx - look.x) * Math.min(1, dt * 4);
    look.y += (look.ty - look.y) * Math.min(1, dt * 4);
    const q0 = head?.quaternion.clone();                  // the look is added on top of the clip, then taken off again
    if (head) { head.rotation.y += look.x * 0.45; head.rotation.x += look.y * 0.25; }
    root.updateMatrixWorld(true);
    // the camera follows her head (a jump or a bow moves it)
    if (head) { head.getWorldPosition(headPos); target.lerp(headPos.clone().add(new THREE.Vector3(0, -0.07, 0)), Math.min(1, dt * 3)); }
    camera.position.set(target.x + look.x * 0.04, target.y + 0.02, target.z + 1.35);
    camera.lookAt(target);
    // face: blink, mood, and the mouth moving while her line is on screen
    if (face) {
      if (now > faceUntil) faceName = "idle";
      const [eyes, mouth] = FACES[faceName] || FACES.idle;
      blinkIn -= dt;
      if (blinkIn < -0.12) blinkIn = 2 + Math.random() * 3.5;
      setFace("eyes", blinkIn < 0 && eyes !== "eyes_closed" ? "eyes_closed" : eyes);
      if (now < talkUntil) {
        mouthT -= dt;
        if (mouthT < 0) { mouthOpen = !mouthOpen; mouthT = 0.07 + Math.random() * 0.1; }
        setFace("mouth", mouthOpen ? pick(["mouth_eek", "mouth_ooo", "mouth_open_smile_01"]) : mouth);
      } else setFace("mouth", mouth);
    }
    renderer.render(scene, camera);
    if (head) head.quaternion.copy(q0);
  })();

  return {
    ready,
    /** play one of her animations and show a face for a few seconds */
    react(clip = "", faceKey = "") {
      if (clip && actions[clip]) { play(clip, true); if (!ONCE.has(clip)) setTimeout(() => current === actions[clip] && play("idle"), 4000); }
      if (faceKey || FACES[clip]) { faceName = faceKey || clip; faceUntil = performance.now() + 3500; }
    },
    /** her mouth moves for `ms` (while her line types out) */
    talk(ms) { talkUntil = performance.now() + ms; },
  };
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
