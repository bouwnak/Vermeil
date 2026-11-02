// closeup.js - your character up close, in her box over a game (buddy.html): the 3D model (the same one as in the room),
// framed so that the whole head shows, however big it is and whatever hangs off it. She idles, blinks, talks while her line is shown
// and reacts with her animations.
// If the 3D view can't start (no WebGL, model missing) the panel shows a big 💜 instead and everything else works.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { inPlace } from "./inplace.js";
import { analyzeRig, cleanClips, rigExtras, headBox, facing, useOwnClips, jawOpener, floorUnder, solidBodies, FLOATING } from "./rigparts.js";
import { faceSheets } from "./facetex.js";

// clips that play once and then go back to idling
const ONCE = new Set(["cheer", "clap", "laugh", "bow", "nod", "shake", "shrug", "point", "surprised", "happy", "angry", "sad", "shy",
  "wave", "jump", "think", "look_around", "stretch", "yawn"]);
// faces made from the model's eye / mouth pictures (models/anime_girl_face/)
const FACES = { idle: ["eyes_open", "mouth_basic_normal"], happy: ["eyes_open", "mouth_smile_02"], laugh: ["eyes_closed", "mouth_open_smile_02"],
  cheer: ["eyes_closed", "mouth_open_smile_02"], clap: ["eyes_open", "mouth_open_smile_01"], sad: ["eyes_half", "mouth_basic_sad"],
  angry: ["eyes_angry", "mouth_angry"], surprised: ["eyes_open", "mouth_ooo"], think: ["eyes_half", "mouth_basic_neutral"],
  shy: ["eyes_half", "mouth_smile_01"], shrug: ["eyes_half", "mouth_eek"], smug: ["eyes_half", "mouth_smile_02"] };
const MODEL = "anime_girl.glb", HEIGHT = 1.6, ROOM = 1.18;      // ROOM: the head takes up this much less than the whole view

const stub = { react() {}, talk() {}, pause() {}, ready: Promise.resolve(false) };

/** Put the character in `box` (model: a file in ui/models, default Vermeil). Returns { react(clip, face), talk(ms), ready } */
export function closeUp(box, { model = MODEL, outfit = "mech", hair = "original", onPoke = () => {}, maxFps = 60 } = {}) {
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

  let mixer = null, actions = {}, current = null, head = null, jaw = null, face = null, sheet = null, root = null, extras = null, mouths = [];
  let frame_ = null;                                        // the head's box around the head bone: { offset, w, h, d }
  let faceName = "idle", faceUntil = 0, talkUntil = 0, blinkIn = 2.5, mouthT = 0, mouthOpen = false;
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const target = new THREE.Vector3(), headPos = new THREE.Vector3();

  function size() {
    const w = box.clientWidth || 300, h = box.querySelector(".vm-view")?.clientHeight || box.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fit();
  }
  /** how far back the camera stands so that the whole head fits, in a wide box or a tall one */
  let distance = 1.35;
  function fit() {
    if (!frame_) return;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    distance = Math.max(frame_.h / (2 * tan), frame_.w / (2 * tan * camera.aspect)) * ROOM + frame_.d / 2;
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

  const ready = new GLTFLoader().loadAsync(`models/${model || MODEL}`).then((gltf) => {
    root = gltf.scene;
    const s = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    root.scale.multiplyScalar(HEIGHT / Math.max(s.y, 1e-6));
    const info = analyzeRig(root);
    root.position.y -= floorUnder(root, info);
    if (facing(root, info) < 0) root.rotation.y += Math.PI;      // built facing away: it's the face you want to see
    const mats = {};
    root.traverse((o) => {
      const n = o.name || "";
      let m = /^body_([a-z]+)$/i.exec(n) || /^(mech|city|school)_\w+$/i.exec(n);
      if (m) o.visible = m[1].toLowerCase() === outfit;
      m = /^hair_(\w+)$/i.exec(n);
      if (m) o.visible = m[1].toLowerCase() === hair;
      if (o.isMesh) o.frustumCulled = false;
      if (o.morphTargetDictionary) for (const [k, i] of Object.entries(o.morphTargetDictionary)) if (/(jaw|mouth.?open|^aa$|v_aa|vrc\.v_aa)/i.test(k)) mouths.push([o, i]);
      for (const mt of [].concat(o.material || [])) if (/^(eyes|mouth)$/i.test(mt.name)) mats[mt.name.toLowerCase()] = mt;
    });
    head = info.head;
    if (mats.eyes && mats.mouth) {
      const dir = `models/${encodeURIComponent((model || MODEL).replace(/\.(glb|gltf)$/i, ""))}_face/`;
      const loader = new THREE.TextureLoader(), cache = {};
      const tex = (n) => cache[n] ||= loader.load(`${dir}${n}.png`, (t) => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; }, undefined, () => { cache[n] = null; });
      for (const [e, m] of Object.values(FACES)) { tex(e); tex(m); }
      ["mouth_eek", "mouth_ooo", "mouth_open_smile_01"].forEach(tex);
      face = { mats, tex, cur: {} };
    }
    scene.add(root);
    // the head as it stands, before any clip moves it: everything that follows it, hair and ears too. A model without a head bone: its top
    root.updateMatrixWorld(true);
    const whole = new THREE.Box3().setFromObject(root), hb = headBox(root, info) || whole.clone().setFromCenterAndSize(
      new THREE.Vector3(0, whole.max.y - HEIGHT * 0.09, (whole.min.z + whole.max.z) / 2), new THREE.Vector3(HEIGHT * 0.2, HEIGHT * 0.18, HEIGHT * 0.2));
    const anchor = (head || root).getWorldPosition(new THREE.Vector3());
    const dims = hb.getSize(new THREE.Vector3());
    frame_ = { offset: hb.getCenter(new THREE.Vector3()).sub(anchor), w: dims.x, h: dims.y, d: dims.z };
    solidBodies(root);
    if (!face) sheet = faceSheets(root, info);
    if (sheet?.mouth) mouths = [];
    else if (!mouths.length) jaw = jawOpener(info);
    // UniMate clips cleaned, hands posed, hair/cloth swinging
    if (/-animated\.glb$/i.test(model || "")) try { cleanClips(root, gltf.animations, info); } catch (e) { console.warn(e); }
    extras = rigExtras(root, info, { skip: new Set(gltf.animations.flatMap((a) => a.tracks.map((t) => t.name.split(".")[0]))) });
    if (gltf.animations.length) {
      useOwnClips(gltf.animations, info);
      inPlace(gltf.animations.filter((a) => !FLOATING.test(a.name)));
      mixer = new THREE.AnimationMixer(root);
      for (const clip of gltf.animations) actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
      mixer.addEventListener("finished", () => play("idle"));
      play("idle");
      mixer.update(0.01);
    }
    root.updateMatrixWorld(true);
    (head || root).getWorldPosition(headPos);
    target.copy(headPos).add(frame_.offset);
    box.classList.add("vm-ready");
    size();
    return true;
  }).catch((e) => {
    console.warn("[close-up]", e);
    try { window.pywebview?.api?.log_ui_error?.(`close-up (${model})`, String(e?.stack || e)); } catch { /* not in the app */ }
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
  let paused = false, lastFrame = 0;
  (function frame() {
    requestAnimationFrame(frame);
    if (document.hidden || paused || !root) return;
    const now = performance.now();
    if (now - lastFrame < 1000 / maxFps - 1) return;              // over a game she only takes what she needs
    lastFrame = now;
    const dt = Math.min(clock.getDelta(), 0.1);
    mixer?.update(dt);
    extras?.update(dt, now / 1000, now < talkUntil ? 1 : 0);
    look.x += (look.tx - look.x) * Math.min(1, dt * 4);
    look.y += (look.ty - look.y) * Math.min(1, dt * 4);
    const q0 = head?.quaternion.clone();                  // the look is added on top of the clip, then taken off again
    const talking = now < talkUntil;
    const open = talking ? 0.5 + 0.5 * Math.sin(now / 70) : 0;
    if (head) {
      head.rotation.y += look.x * 0.45; head.rotation.x += look.y * 0.25;
      if (talking && !face && !sheet?.mouth && !jaw && !mouths.length) { head.rotation.x += Math.sin(now / 160) * 0.035; head.rotation.z += Math.sin(now / 410) * 0.025; }   // nothing to talk with: it nods
    }
    for (const [mesh, i] of mouths) mesh.morphTargetInfluences[i] = open;
    jaw?.apply(open);
    sheet?.update(dt, open, now < faceUntil ? faceName : "neutral");
    root.updateMatrixWorld(true);
    // the camera follows her head (a jump or a bow moves it)
    if (head) { head.getWorldPosition(headPos); target.lerp(headPos.clone().add(frame_.offset), Math.min(1, dt * 3)); }
    camera.position.set(target.x + look.x * 0.04, target.y + 0.02, target.z + distance);
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
    /** stop drawing while nobody can see her */
    pause(on) { paused = !!on; clock.getDelta(); },
  };
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
