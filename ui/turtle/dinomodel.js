// dinomodel.js - a dinosaur's body. The rigged pack dinosaurs (with the jaws added in Blender) keep their own colour zones (hide, belly, teeth, claws, mouth), painted per form:
// a baby is pale and big-eyed, each evolution deepens the colour, brings out its markings and grows new parts that sit on the surface of its back and head.
// Every one breathes, blinks, looks at you, sways its tail, keeps its feet in step with the ground, and reacts when you touch it.
import * as THREE from "three";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";
import { loadModel, makeOverlay } from "./assets.js";
import { makeLofted, makeRope, makeSaddle, mouthParts } from "./made.js";

const RIG = "../games/asset_packs/dinosaurs/";
const NECK = ["Shoulders", "Neck", "Head"], SPINE = ["Hips", "Back", "Torso", "Shoulders"], TAIL = ["Tail1", "Tail2", "Tail3", "Tail4", "Tail5"];
const LEGS = [["FrontUpLegL", 0], ["FrontUpLegR", 2], ["BackUpLegL", 3], ["BackUpLegR", 1]];
const clamp = THREE.MathUtils.clamp, ease = (x) => x * x * (3 - 2 * x);
const skin = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.74, side: THREE.DoubleSide });
const eyeBlack = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.25 }), glint = new THREE.MeshBasicMaterial({ color: 0xffffff });

/** which part of the animal a pack material is: its name, or failing that how light it is against the rest */
function zoneOf(mat) {
  const n = mat.name || "";
  if (/black/i.test(n)) return "dark";
  if (/yellow/i.test(n)) return "horn";
  if (/^red/i.test(n)) return mat.color.getHSL({}).s < 0.1 ? "horn" : "mouth";
  if (/^light|material/i.test(n)) return "belly";
  return "hide";
}

/** where each bone's flesh is, before any posing: its top, its width, its middle. Parts are set on this, so they sit on the skin whatever the animal's shape */
function surfaceOf(root) {
  const out = new Map(), v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const p = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    m.skeleton.update();
    for (let i = 0; i < p.count; i++) {
      let best = 0, w = 0;
      for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); best = si.getComponent(i, k); }
      const b = m.skeleton.bones[best];
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
      let s = out.get(b);
      if (!s) out.set(b, s = { top: v.clone(), low: v.y, wide: 0, min: v.clone(), max: v.clone() });
      if (v.y > s.top.y) s.top.copy(v);
      s.low = Math.min(s.low, v.y); s.wide = Math.max(s.wide, Math.abs(v.x)); s.min.min(v); s.max.max(v);
      if (b.name === "Head" && zoneOf(m.material) === "hide") (s.skull ||= []).push(v.clone());
      if (b.name === "Head" || b.name === "Jaw") (s.all ||= []).push(v.clone());
      if (b.name === "Jaw" && zoneOf(m.material) === "horn") out.jawTeeth = (out.jawTeeth || 0) + 1;      // its own teeth are on the jaw: a crest or a horn on the head isn't a mouth
      if (b.name === "Jaw") out.jawN = (out.jawN || 0) + 1; else if (b.name === "Head") out.headN = (out.headN || 0) + 1;
    }
  });
  out.teeth = (out.jawTeeth || 0) > 30;
  return out;
}

/** a thin plate from the outline [[along, up], ...], the colour running from its base to its tip */
function plate(outline, thick, base, tip) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))), ex = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 1 }), g = ex.index ? ex.toNonIndexed() : ex;
  g.translate(0, 0, -thick / 2); g.rotateY(Math.PI / 2);          // standing up along the body: its length on z, its height on y
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(), top = Math.max(...outline.map((p) => p[1]));
  for (let i = 0; i < pos.count; i++) { c.copy(base).lerp(tip, clamp(pos.getY(i) / top, 0, 1) ** 1.3); c.toArray(col, i * 3); }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, skin);
  m.castShadow = true;
  return m;
}
const LEAF = [[-0.5, -0.12], [-0.46, 0.36], [-0.1, 1], [0.34, 0.56], [0.5, -0.12]], SCUTE = [[-0.5, -0.2], [-0.34, 0.62], [0, 1], [0.34, 0.62], [0.5, -0.2]], FIN = [[-0.62, -0.25], [-0.5, 0.7], [-0.1, 1], [0.42, 0.74], [0.62, -0.25]], BLADE = [[-0.5, -0.1], [-0.18, 0.5], [0.5, 1], [0.1, 0.1], [0.2, -0.1]];

/** fix a part on a bone, placed and aimed as if in the world, so it works whichever way the bone happens to point */
function stick(root, bone, mesh, at, aim = new THREE.Quaternion()) {
  if (!bone) return;
  root.updateMatrixWorld(true);
  const q = bone.getWorldQuaternion(new THREE.Quaternion()).invert(), s = bone.getWorldScale(new THREE.Vector3()), p = at.clone();
  bone.worldToLocal(p);
  mesh.position.copy(p);
  mesh.quaternion.copy(q).multiply(aim);
  mesh.scale.multiplyScalar(1 / (s.y || 1));
  bone.add(mesh);
}

/** the line along the top of the animal, from its shoulders to the end of its tail: [{ bone, at, wide }], evenly stepped */
function ridgeLine(b, flesh, names) {
  const pts = names.filter((n) => b[n] && flesh.get(b[n])).map((n) => ({ bone: b[n], at: flesh.get(b[n]).top.clone(), wide: flesh.get(b[n]).wide })).sort((p, q) => q.at.z - p.at.z);
  return pts.filter((p, i) => !i || pts[i - 1].at.distanceTo(p.at) > 1e-3);
}
/** evenly along the ridge from `from` to `to` (0 to 1 of its length): n stops, each on the bone nearest to it */
function along(line, n, from = 0, to = 1) {
  const seg = line.slice(1).map((p, i) => p.at.distanceTo(line[i].at)), total = seg.reduce((a, c) => a + c, 0), out = [];
  for (let i = 0; i < n; i++) {
    const u = from + (to - from) * (n > 1 ? i / (n - 1) : 0.5);
    let d = u * total, k = 0;
    while (k < seg.length - 1 && d > seg[k]) d -= seg[k++];
    const a = line[k], c = line[k + 1], s = clamp(d / (seg[k] || 1), 0, 1);
    out.push({ bone: s < 0.5 ? a.bone : c.bone, at: a.at.clone().lerp(c.at, s), u, down: c.at.clone().sub(a.at).normalize(), wide: THREE.MathUtils.lerp(a.wide, c.wide, s) });
  }
  return { list: out, total };
}

/** the parts a form has grown. `stage` 0 has only a hint of them. Nothing here is bigger than the part of the body it stands on */
function grow(root, b, spec, stage, flesh) {
  const S = spec.shape, P = spec.parts || [], hide = new THREE.Color(S.hide), accent = new THREE.Color(S.accent), horn = new THREE.Color(S.belly), line = ridgeLine(b, flesh, [...SPINE, ...TAIL]);
  const up = new THREE.Vector3(0, 1, 0), head = flesh.get(b.Head);
  if (line.length < 3) return;
  const length = along(line, 2).total, torso = flesh.get(b.Torso) || flesh.get(b.Back), body = Math.max(torso.top.y - torso.low, 1e-3) * 4, tilt = (d, lean) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), d).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean));
  // a row along the back: tallest over the hips, small at both ends
  const row = (outline, count, tall, long, thick, from, to, tip, lean = 0.14) => {
    const { list } = along(line, count, from, to), fall = (u) => Math.sin(clamp((u - from) / (to - from), 0, 1) * Math.PI) ** 0.75 * 0.78 + 0.22;
    for (const s of list) {
      const k = fall(s.u), m = plate(outline, thick, hide, tip);
      m.scale.set(1, tall * k, long * (0.7 + k * 0.3));
      stick(root, s.bone, m, s.at.clone().addScaledVector(up, -tall * k * 0.08), tilt(s.down, lean));
    }
  };
  if (P.includes("sail")) { const n = 9 + stage * 3; row(FIN, n, body * [0.03, 0.075, 0.115][stage], length * 0.68 / n * 1.5, body * 0.008, 0.02, 0.7, accent, 0.06); }
  if (P.includes("ridge")) { const n = 8 + stage * 3; row(SCUTE, n, body * [0.02, 0.035, 0.055][stage], length * 0.88 / n * 0.9, body * 0.012, 0.04, 0.92, accent); }
  if (P.includes("plates")) { const n = 7 + stage * 2; row(LEAF, n, body * [0.03, 0.07, 0.11][stage], length * 0.7 / n * 1.05, body * 0.012, 0.05, 0.74, accent); }
  if (P.includes("scutes") && stage) { const n = 8 + stage * 2; for (const s of [-1, 1]) { const { list } = along(line, n, 0.08, 0.72); list.forEach((q, i) => { const m = plate(SCUTE, body * 0.02, hide, horn), k = 0.7 + Math.sin(i / n * Math.PI) * 0.5; m.scale.set(1, body * 0.024 * stage * k, body * 0.05 * k); stick(root, q.bone, m, q.at.clone().add(new THREE.Vector3(s * q.wide * 0.34, -body * 0.008, 0)), tilt(q.down, 0.1).premultiply(new THREE.Quaternion().setFromAxisAngle(q.down, s * 0.5))); }); } }
  // on the head: swept back along the skull, the way a real crest lies
  const skull = head ? head.top : null, hl = head ? head.max.z - head.min.z : body * 0.2, hw = head ? head.wide : body * 0.05;
  if (P.includes("crest") && skull) for (let i = 0; i < 2 + stage; i++) {
    const m = plate(BLADE, hl * 0.04, hide, accent), k = 1 - i * 0.2;
    m.scale.set(1, hl * [0.2, 0.34, 0.46][stage] * k, hl * [0.3, 0.46, 0.6][stage] * k);
    stick(root, b.Head, m, skull.clone().add(new THREE.Vector3(0, -hl * 0.04, -hl * (0.12 + i * 0.17))), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.32 + i * 0.1));
  }
  if (P.includes("horns") && skull && stage) for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(hl * 0.05 * (1 + stage * 0.2), hl * (0.12 + stage * 0.12), 5), skin), n = m.geometry.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) horn.toArray(c, i * 3);
    m.geometry.setAttribute("color", new THREE.BufferAttribute(c, 3)); m.castShadow = true;
    stick(root, b.Head, m, skull.clone().add(new THREE.Vector3(s * hw * 0.6, -hl * 0.05, hl * 0.02)), new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(s * 0.45, 0.7, -0.55).normalize()));
  }
  if (P.includes("dome") && skull) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(hl * (0.16 + stage * 0.05), 1), skin), n = m.geometry.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) accent.toArray(c, i * 3); m.geometry.setAttribute("color", new THREE.BufferAttribute(c, 3)); m.scale.set(1, 0.72, 1.1); m.castShadow = true; stick(root, b.Head, m, skull.clone().add(new THREE.Vector3(0, -hl * 0.06, -hl * 0.06))); }
  if (P.includes("mane") && stage) { const { list } = along(ridgeLine(b, flesh, NECK), 3 + stage * 2, 0.15, 0.95); for (const q of list) { const m = plate(BLADE, body * 0.01, hide, accent); m.scale.set(1, body * 0.03 * (1 + stage * 0.3), body * 0.05); stick(root, q.bone, m, q.at, tilt(q.down, 0.3)); } }
}

/** paints one pack mesh by zone: the hide darker along the back with the species' markings, the belly its own colour, claws lighter as it grows up */
function paintZones(mesh, spec, stage, base, line) {
  const key = `${base}|${spec.line}|${stage}|${mesh.name}|${spec.look?.id || ""}`, done = paintZones.cache ||= new Map();
  if (done.has(key)) return (mesh.geometry = done.get(key));
  const jawAt = mesh.skeleton?.bones.findIndex((x) => x.name === "Jaw") ?? -1, headAt = mesh.skeleton?.bones.findIndex((x) => x.name === "Head") ?? -1;
  const zone = zoneOf(mesh.material), S = spec.shape, pale = [0.2, 0.06, 0][stage], g = line && jawAt >= 0 ? cutJaw(mesh.geometry.clone(), mesh, line, jawAt, headAt) : mesh.geometry.clone(), si = g.attributes.skinIndex, sw = g.attributes.skinWeight, p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
  const hide = new THREE.Color(S.hide).lerp(new THREE.Color(0xffffff), pale), dorsal = hide.clone().multiplyScalar(stage === 2 ? 0.72 : 0.82), belly = new THREE.Color(S.belly), accent = new THREE.Color(S.accent), ivory = new THREE.Color(0xf2e6c8);
  g.computeBoundingBox();
  const low = g.boundingBox.min.y, tall = Math.max(g.boundingBox.max.y - low, 1e-3), dark = new THREE.Color(0x24262c), mouth = new THREE.Color(0xc25a5e), mark = S.mark || "stripes";
  // a plant eater whose model came with pointed teeth (the crested one): they're pressed down into a low, even beak edge along the mouth, the colour of its lips
  const grazer = spec.bite !== "sharp" && zone === "horn" && line && (jawAt >= 0 || headAt >= 0), beak = belly.clone().multiplyScalar(0.82), w = new THREE.Vector3(), back = new THREE.Matrix4().copy(mesh.matrixWorld).invert(), len = line ? line.z1 - line.z0 : 1;
  const onMouth = (i) => { for (let k = 0; k < 4; k++) { const b = si?.getComponent(i, k); if ((b === jawAt || b === headAt) && sw.getComponent(i, k) > 0.5) return true; } return false; };
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const up = n.getY(i);
    if (grazer && onMouth(i)) {
      w.set(x, y, z).applyMatrix4(mesh.matrixWorld);
      if (w.z > line.z0 && Math.abs(w.y - line.y(w.z)) < len * 0.3) {
        w.y = THREE.MathUtils.lerp(w.y, line.y(w.z), 0.8); w.applyMatrix4(back); p.setXYZ(i, w.x, w.y, w.z); x = w.x; y = w.y; z = w.z;
        beak.toArray(col, i * 3); continue;
      }
    }
    if (zone === "dark") { if (stage === 2 && (y - low) / tall < 0.4) c.copy(ivory); else c.copy(dark); }
    else if (zone === "mouth") c.copy(mouth);
    else if (zone === "horn") c.copy(ivory);
    else if (zone === "belly") c.copy(belly);
    else {
      c.copy(hide).lerp(dorsal, clamp(up * 0.9, 0, 1));
      if (up < -0.35) c.lerp(belly, clamp(-up - 0.35, 0, 0.7));
      const m = markOf(mark, x / tall, y / tall, z / tall, up);                                          // its pattern, faint on a baby and bold on a grown one
      if (m) c.lerp(accent, m * [0.2, 0.32, 0.5][stage]);
      for (let k = 0; k < 4; k++) if (si && si.getComponent(i, k) === jawAt && sw.getComponent(i, k) > 0.5) c.lerp(belly, 0.55);       // a paler lower jaw: you can see where the mouth is, shut or open
    }
    c.toArray(col, i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  done.set(key, g);
  mesh.geometry = g;
  return g;
}

/** how strongly a pattern marks a point of the hide (0 to 1), in the body's own proportions */
function markOf(mark, x, y, z, up) {
  const hash = (a, b, c) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
  switch (String(mark).toLowerCase()) {
    case "plain": return 0;
    case "spots": case "spotted": return up > 0.1 && Math.sin(z * 18 + Math.sin(x * 40) * 2) > 0.8 ? 1 : 0;
    case "banded": return up > -0.2 && Math.sin(z * 7) > 0.35 ? 1 : 0;
    case "speckled": return up > -0.1 && hash(Math.round(x * 30), Math.round(y * 30), Math.round(z * 30)) > 0.84 ? 1 : 0;
    case "saddled": return up > 0.45 ? 1 : 0;
    case "mottled": return up > -0.3 && Math.sin(x * 22 + Math.sin(z * 13) * 2.5) * Math.sin(z * 17 + Math.sin(y * 11)) > 0.25 ? 0.8 : 0;
    default: return up > 0.15 && Math.sin(z * 18) > 0.62 ? 1 : 0;                                                    // stripes
  }
}

/** where the mouth runs: from the hinge of the jaw to the tip of the snout, on any head. -> { z0, y0, z1, y1, y(z) } */
function mouthLine(b, flesh) {
  const pts = [...(flesh.get(b.Head)?.all || []), ...(flesh.get(b.Jaw)?.all || [])];
  if (!b.Jaw || pts.length < 8) return null;
  const hinge = b.Jaw.getWorldPosition(new THREE.Vector3()), z1 = Math.max(...pts.map((p) => p.z)), tip = pts.filter((p) => p.z > z1 - (z1 - hinge.z) * 0.1), y1 = tip.reduce((a, p) => a + p.y, 0) / tip.length, z0 = hinge.z - (z1 - hinge.z) * 0.1;
  return { z0, z1, y0: hinge.y, y1, y: (z) => hinge.y + (y1 - hinge.y) * Math.min(1, Math.max(0, (z - hinge.z) / (z1 - hinge.z))) };
}
/** the pack's jaws are only a sliver of the chin. The head is cut along the mouth, so all of it below that line swings open as a real lower jaw */
function cutJaw(g, mesh, line, jawAt, headAt) {
  const out = g.index ? g.toNonIndexed() : g, idx = g.index, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, osi = out.attributes.skinIndex, osw = out.attributes.skinWeight, v = new THREE.Vector3(), n = osi.count / 3;
  const mine = (i) => { let best = 0, w = 0; for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); best = si.getComponent(i, k); } return best === jawAt || best === headAt; };
  for (let t = 0; t < n; t++) {
    let z = 0, y = 0, near = true;
    for (let k = 0; k < 3; k++) { const i = idx ? idx.getX(t * 3 + k) : t * 3 + k; if (!mine(i)) near = false; mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); z += v.z / 3; y += v.y / 3; }
    if (!near) continue;
    const lower = z > line.z0 && y < line.y(z);
    for (let k = 0; k < 3; k++) { osi.setXYZW(t * 3 + k, lower ? jawAt : headAt, 0, 0, 0); osw.setXYZW(t * 3 + k, 1, 0, 0, 0); }
  }
  return out;
}
/** the inside of the mouth, and what's in it: sharp teeth for hunters, a flat cropping edge for grazers, along the cut */
function makeMouth(root, b, spec, flesh, line) {
  const skull = flesh.get(b.Head)?.all;
  if (!line || !skull || flesh.teeth) return;                  // it has teeth of its own
  const len = line.z1 - line.z0, edge = [];
  for (let u = 0.05; u < 0.72; u += 0.085) {
    const z = line.z1 - len * u, near = skull.filter((p) => Math.abs(p.z - z) < len * 0.14 && Math.abs(p.y - line.y(z)) < len * 0.3);
    if (near.length < 2) continue;
    edge.push({ z, up: line.y(z), low: line.y(z), w: Math.max(...near.map((p) => Math.abs(p.x))) * 0.8 });
  }
  if (edge.length < 2) return;
  const { upper, lower } = mouthParts(edge, len, spec.bite === "sharp" && !flesh.teeth), o = new THREE.Vector3();
  stick(root, b.Head, upper, o); stick(root, b.Jaw, lower, o);
}

/** eyes: a dark bead with a glint, and a lid of its own skin to blink with, set on the sides of the head where the eye sockets are */
function makeEyes(root, b, spec, stage, flesh) {
  const skull = flesh.get(b.Head)?.skull;
  if (!skull?.length) return [];
  // an eye sits just above and ahead of the hinge of the jaw, whatever the skull carries behind it (a frill, a crest): measured from the snout back
  const zs = skull.map((p) => p.z), z0 = Math.min(...zs), z1 = Math.max(...zs), hinge = b.Jaw ? b.Jaw.getWorldPosition(new THREE.Vector3()).z : z0 + (z1 - z0) * 0.3;
  const snout = Math.max(z1 - hinge, (z1 - z0) * 0.3), hl = snout * 1.25, spot = Math.max(z0, z1 - snout * 0.86), side = skull.filter((p) => Math.abs(p.z - spot) < hl * 0.1);
  if (side.length < 4) return [];
  const ys = side.map((p) => p.y), yLow = Math.min(...ys), yTop = Math.max(...ys), y = yLow + (yTop - yLow) * 0.66;
  const near = side.filter((p) => Math.abs(p.y - y) < (yTop - yLow) * 0.18), wide = Math.max(...(near.length ? near : side).map((p) => Math.abs(p.x))), r = Math.min(hl * (stage ? 0.065 : 0.085), (yTop - yLow) * 0.2), hide = new THREE.Color(spec.shape.hide).lerp(new THREE.Color(0xffffff), [0.2, 0.06, 0][stage]);
  const lidMat = new THREE.MeshStandardMaterial({ color: hide, flatShading: true, roughness: 0.8 });
  return [-1, 1].map((s) => {
    const g = new THREE.Group(), ball = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), eyeBlack), light = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 6, 5), glint), lid = new THREE.Mesh(new THREE.SphereGeometry(r * 1.12, 9, 6, 0, Math.PI * 2, 0, Math.PI / 2), lidMat);
    light.position.set(s * r * 0.5, r * 0.5, r * 0.55); g.add(ball, light, lid);
    lid.rotation.x = -1.5;
    stick(root, b.Head, g, new THREE.Vector3(s * Math.max(wide - r * 0.45, wide * 0.7), y, spot));
    return lid;
  });
}

/** the snout, where a halter goes: half way from the hinge of the jaw to the tip, its width and its middle there. -> { z, y, w, h } or null */
function snoutOf(b, flesh) {
  const ml = mouthLine(b, flesh), pts = [...(flesh.get(b.Head)?.all || []), ...(flesh.get(b.Jaw)?.all || [])];
  if (!ml || pts.length < 8) return null;
  const z = ml.z0 + (ml.z1 - ml.z0) * 0.55, len = ml.z1 - ml.z0, near = pts.filter((p) => Math.abs(p.z - z) < len * 0.08);
  if (near.length < 4) return null;
  const ys = near.map((p) => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
  return { z, y: (lo + hi) / 2, w: Math.max(...near.map((p) => Math.abs(p.x))), h: hi - lo };
}
/** a tamed one's tack: a leather band round its snout with a ring each side, and two reins from the rings to whoever holds them (the rider's hands, or the saddle horn).
 *  c.reinsTo(hands): call each frame it's seen; hands are world points, or null for the horn */
function harness(c, root, head, sn, saddleMesh) {
  const band = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 5, 18), new THREE.MeshStandardMaterial({ color: 0x5b3520, flatShading: true, roughness: 0.8 }));
  band.scale.set(sn.w * 1.08, sn.h * 0.56, sn.w * 1.08); band.castShadow = true;
  stick(root, head, band, new THREE.Vector3(0, sn.y, sn.z));
  band.scale.set(sn.w * 1.08, sn.h * 0.56, sn.w * 1.08).multiplyScalar(1 / (head.getWorldScale(new THREE.Vector3()).y || 1));
  const rings = [-1, 1].map((s) => { const o = new THREE.Mesh(new THREE.TorusGeometry(Math.max(0.03, sn.h * 0.1), Math.max(0.008, sn.h * 0.02), 5, 10), new THREE.MeshStandardMaterial({ color: 0xd9b25a, roughness: 0.4 })); stick(root, head, o, new THREE.Vector3(s * sn.w * 1.1, sn.y, sn.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)); return o; });
  const horn = new THREE.Object3D(); horn.position.set(0, 0.32, 0.34); saddleMesh.add(horn);
  const reins = rings.map(() => { const r = makeRope(0x5b3520, Math.max(0.018, sn.h * 0.025)); c.holder.add(r); return r; });
  const a = new THREE.Vector3(), z = new THREE.Vector3();
  c.reinsTo = (hands) => {
    for (let i = 0; i < 2; i++) {
      rings[i].getWorldPosition(a); c.holder.worldToLocal(a);
      if (hands?.[i]) z.copy(hands[i]); else horn.getWorldPosition(z).add(new THREE.Vector3(0, 0, 0));
      c.holder.worldToLocal(z);
      reins[i].set(a, z, hands ? a.distanceTo(z) * 0.06 : a.distanceTo(z) * 0.16);          // taut in the hand, slack hanging to the horn
    }
  };
}

export async function makeDinoBody(spec0, stage, size, look = null) {
  // its own look: the colours and pattern it was born with, painted over its kind's
  const spec = look ? { ...spec0, look, shape: { ...spec0.shape, hide: look.hide, accent: look.accent, mark: look.pattern } } : spec0;
  const base = [].concat(spec.base || [])[stage] ?? [].concat(spec.base || [])[0];
  if (!base) return makeLofted(spec, stage, size);
  const g = await loadModel(`${RIG}${base}.glb`);
  if (!g) return makeLofted(spec, stage, size);
  const root = cloneRig(g.scene), box = new THREE.Box3().setFromObject(root), s = size / Math.max(box.getSize(new THREE.Vector3()).y, 1e-3);
  root.scale.setScalar(s);
  root.position.y = -box.min.y * s;
  root.updateMatrixWorld(true);
  const b = {}, flesh = surfaceOf(root);
  root.traverse((o) => { if (o.isBone) b[o.name] = o; });
  // a head whose own jaw is a real lower jaw already opens. Most pack jaws are only a sliver inside the chin (teeth and all, on the crested one): those heads are cut along the mouth
  const line = flesh.teeth && flesh.jawN > flesh.headN * 0.5 ? null : mouthLine(b, flesh);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.frustumCulled = false;
    paintZones(o, spec, stage, base, line);
    o.material = skin;
  });
  grow(root, b, spec, stage, flesh);
  const lids = makeEyes(root, b, spec, stage, flesh);
  makeMouth(root, b, spec, flesh, line);
  const snout = snoutOf(b, flesh);
  const holder = new THREE.Group(), body = new THREE.Group();
  body.add(root); holder.add(body);
  const O = makeOverlay(root), mixer = new THREE.AnimationMixer(root), find = (re) => g.animations.find((a) => re.test(a.name)), actions = {};
  for (const [name, re] of Object.entries({ idle: /_idle$/i, walk: /_walk$/i, run: /_run$/i, attack: /_attack$/i, jump: /_jump$/i })) { const c = find(re); if (c) actions[name] = mixer.clipAction(c); }
  // how fast each clip's feet really travel, so they can be kept in step with the ground
  const stride = {};
  for (const name of ["walk", "run"]) {
    const c = actions[name]?.getClip(), t = c?.tracks.find((x) => /^BackFootL\.position$/.test(x.name));
    if (!t) continue;
    let lo = Infinity, hi = -Infinity;
    for (let i = 2; i < t.values.length; i += 3) { lo = Math.min(lo, t.values[i]); hi = Math.max(hi, t.values[i]); }
    stride[name] = Math.max(1e-3, (hi - lo) * 2 * s / c.duration);
  }
  let now = null;
  const play = (name, fade = 0.3) => { const a = actions[name] || actions.idle; if (!a || a === now) return; a.reset().fadeIn(fade).play(); now?.fadeOut(fade); now = a; };
  play("idle", 0);
  const once = (name) => { const c = actions[name]; if (!c) return 0.6; c.reset().setLoop(THREE.LoopOnce, 1); c.clampWhenFinished = false; c.fadeIn(0.12).play(); const len = c.getClip().duration; setTimeout(() => c.fadeOut(0.25), len * 800); return len; };
  // proportions of the form, reapplied after the clips each frame. Small changes: the bones carry the skin, and a big one balloons it
  const form = [{ Head: 1.24, Neck: 0.92, Tail2: 0.92, Tail3: 0.9 }, { Head: 1.06 }, { Head: 0.98, Torso: 1.06, Shoulders: 1.05, Neck: 1.04 }][stage];
  const raise = spec.shape.neck ? [0.35, 0.75, 0.9][stage] : 0;
  const jaw = b.Jaw, E = { reach: raise, drink: 0, open: 0, want: 0, blink: 0, nextBlink: 2, nextYawn: 6 + Math.random() * 14, roll: 0, wag: 0, pet: 0, chin: 0, happy: 0, eat: 0, bounce: 0, sniff: 0, nextSniff: 8 + Math.random() * 12, lookX: 0, lookY: 0, lean: 0, tilt: 0, y: null, pace: 0 };
  const lidBase = lids.map((l) => l.rotation.x), jaw0 = jaw ? jaw.quaternion.clone() : null, last = new THREE.Vector3(), target = new THREE.Vector3(), rollSide = Math.random() < 0.5 ? 1 : -1;
  const backTop = flesh.get(b.Torso)?.top.y ?? flesh.get(b.Back)?.top.y ?? size * 0.7;
  // where a rider sits: the middle of the back, on the bone that carries it, so whoever's up there rises and falls with every step
  const spine = ridgeLine(b, flesh, SPINE), mid = spine.length > 1 ? along(spine, 1, 0.5, 0.5).list[0] : null;      // half way from the shoulders to the hips
  const backBone = mid?.bone || (flesh.get(b.Torso) ? b.Torso : b.Back), back = flesh.get(backBone), saddle = new THREE.Object3D();
  const seatAt = mid ? new THREE.Vector3(0, mid.at.y, mid.at.z) : back ? new THREE.Vector3(0, back.top.y, (back.min.z + back.max.z) / 2) : new THREE.Vector3(0, backTop, 0);
  stick(root, backBone, saddle, seatAt);
  const c = {
    holder, root, mixer, actions, play, once, seat: backTop, top: size * 0.95, lookAt: null, saddle, saddleWide: back ? back.wide : size * 0.15,
    /** a tamed one wears a saddle */
    addSaddle() {
      if (c.saddleMesh || !back) return;
      c.saddleMesh = makeSaddle(back.wide, back.top.y - back.low, spec.shape.accent); stick(root, backBone, c.saddleMesh, seatAt);
      if (snout) harness(c, root, b.Head, snout, c.saddleMesh);           // a halter round the snout, and reins back to the saddle
    },
    work() { once("attack"); E.want = 0.6; E.sniff = 0.9; setTimeout(() => { E.want = 0; }, 450); },
    /** a touch: pet, chin, belly, play, eat. Each one is its own reaction */
    react(kind) {
      if (kind === "belly") E.roll = 4.2;
      else if (kind === "pet") { E.pet = 2.4; E.happy = 1.6; }
      else if (kind === "chin") { E.chin = 2.2; E.happy = 2.2; }
      else if (kind === "play") { once("jump"); E.wag = 2.5; E.bounce = 1.4; E.want = 0.7; setTimeout(() => { E.want = 0; }, 900); }
      else if (kind === "eat") { E.eat = 1.8; let n = 0; const bite = setInterval(() => { E.want = n % 2 ? 0.05 : 0.5; if (++n > 7) { clearInterval(bite); E.want = 0; } }, 200); }
      else if (kind === "roar") { once("attack"); E.want = 1; setTimeout(() => { E.want = 0; }, 900); }
      else if (kind === "sniff") { E.sniff = 2; }
      E.wag = Math.max(E.wag, 2);
    },
    /** head down for a long drink */
    drink(s) { E.drink = s; },
    /** lying down for a belly rub: it stays where it is until it gets up */
    held: () => E.roll > 0,
    move(dt, t, moving, riding, mode = "") {
      const v = Math.min(40, holder.position.distanceTo(last) / Math.max(dt, 1e-3));
      const climbed = holder.position.y - last.y;
      last.copy(holder.position);
      E.pace += (v - E.pace) * Math.min(1, dt * 8);
      const fast = riding && moving || v > (stride.walk || 3) * 1.7, gait = moving ? (fast ? "run" : "walk") : "idle";
      O.undo();
      play(gait);
      if (moving && actions[gait] && stride[gait] && E.pace > 0.2) actions[gait].setEffectiveTimeScale(clamp(E.pace / stride[gait], 0.6, 2.4));   // feet in step with the ground
      mixer.update(dt);
      for (const [n, k] of Object.entries(form)) b[n]?.scale.setScalar(k);
      // blinking; happy eyes stay shut
      if (t > E.nextBlink) { E.blink = 0.14; E.nextBlink = t + 1.6 + Math.random() * 3.6; }
      E.blink = Math.max(0, E.blink - dt);
      const shut = E.blink > 0 || E.happy > 0 || E.roll > 0.6;
      lids.forEach((l, i) => { l.rotation.x = lidBase[i] + (shut ? 1.42 : 0); });
      if (t > E.nextYawn && !moving) { E.nextYawn = t + 10 + Math.random() * 18; E.want = 0.85; setTimeout(() => { E.want = 0; }, 1300); }
      E.open += (E.want + (moving ? 0.04 : 0) - E.open) * Math.min(1, dt * 9);
      if (jaw) { O.keep(jaw); jaw.quaternion.copy(jaw0); O.turn(jaw, "x", E.open * 0.72); }
      for (const k of ["happy", "pet", "wag", "chin", "eat", "bounce", "sniff", "drink"]) E[k] = Math.max(0, E[k] - dt);
      // the tail is never quite still: slow when resting, against the stride when walking, fast when pleased
      const wag = Math.min(1, E.wag), rate = wag ? 11 : moving ? 5 : 1.1, swing = wag ? 0.16 : moving ? 0.07 : 0.045;
      TAIL.forEach((n, i) => O.turn(b[n], "y", Math.sin(t * rate - i * 0.8) * swing * (0.6 + i * 0.25)));
      // breathing
      O.turn(b.Torso, "x", Math.sin(t * 1.5) * 0.012); O.turn(b.Neck, "x", Math.sin(t * 1.5 - 0.5) * 0.016);
      // looking at you, if you're near; otherwise about
      let wantY = moving ? 0 : Math.sin(t * 0.5 + size) * 0.3, wantX = moving ? Math.sin(t * 7) * 0.02 : 0;
      if (c.lookAt && !E.roll) {
        holder.worldToLocal(target.copy(c.lookAt));
        const a = Math.atan2(target.x, target.z);
        if (Math.abs(a) < 2.1) { wantY = clamp(a, -0.85, 0.85); wantX = clamp(-Math.atan2(target.y - size * 0.7, Math.hypot(target.x, target.z)), -0.3, 0.3); }
      }
      if (!moving && t > E.nextSniff) { E.nextSniff = t + 9 + Math.random() * 16; E.sniff = 2; }
      if (E.sniff > 0) wantX += ease(Math.min(1, E.sniff, 2 - E.sniff + 0.001 > 1 ? 1 : 2 - E.sniff)) * 0.55;       // a sniff at the ground
      if (E.eat > 0) wantX += 0.55;
      if (E.drink > 0) { wantX += 0.95; wantY = 0; E.want = Math.max(0, Math.sin(t * 9)) * 0.3; if (E.drink < 0.1) E.want = 0; }
      if (E.chin > 0) { wantX -= 0.42; wantY = 0; }
      E.lookY += (wantY - E.lookY) * Math.min(1, dt * 4); E.lookX += (wantX - E.lookX) * Math.min(1, dt * 4);
      // a long-necked one carries its neck high, like a giraffe: up into the trees as it grows, down when it drinks or sniffs at something
      if (raise) { E.reach += ((E.drink > 0 || E.eat > 0 || E.roll > 0 ? 0 : raise) - E.reach) * Math.min(1, dt * 2); O.turn(b.Shoulders, "x", -E.reach * 0.22); O.turn(b.Neck, "x", -E.reach * 0.78); O.turn(b.Head, "x", E.reach * 0.92); }
      O.turn(b.Neck, "y", E.lookY * 0.45); O.turn(b.Head, "y", E.lookY * 0.55);
      O.turn(b.Neck, "x", E.lookX * 0.5); O.turn(b.Head, "x", E.lookX * 0.5);
      if (E.pet > 0) { O.turn(b.Neck, "z", Math.sin(t * 5) * 0.09); O.turn(b.Head, "z", Math.sin(t * 5 - 0.6) * 0.1); }
      if (E.chin > 0) O.turn(b.Head, "z", Math.sin(t * 7) * 0.07);
      // a belly rub: down it goes onto its side, a slow lean, then kicking its feet
      E.roll = Math.max(0, E.roll - dt);
      const lay = E.roll > 0 ? ease(clamp(Math.min(E.roll, 4.2 - E.roll) / 0.7, 0, 1)) : 0, a = rollSide * lay * 1.42, sin = Math.sin(a), cos = Math.cos(a);
      if (lay) {
        for (const [n, p] of LEGS) { O.turn(b[n], "x", Math.sin(t * 9 + p) * 0.34 * lay); O.turn(b[n.replace("Up", "Low")], "x", Math.sin(t * 9 + p + 0.7) * 0.22 * lay); }
        O.turn(b.Neck, "z", rollSide * 0.2 * lay); O.turn(b.Tail1, "y", rollSide * 0.14 * lay);
      }
      // leaning into a slope, and into a turn
      const rise = moving && v > 0.1 ? clamp(climbed / Math.max(dt * v, 1e-3), -0.5, 0.5) : 0;
      E.tilt += (-rise * 0.6 - E.tilt) * Math.min(1, dt * 5);
      body.rotation.set(E.tilt * (1 - lay), 0, a);
      body.position.set(lay ? backTop * 0.45 * sin : 0, E.bounce > 0 ? Math.abs(Math.sin(E.bounce * 6)) * size * 0.05 : 0, 0);
      if (lay) {                                               // resting on whatever part of it is lowest right now: never through the ground
        holder.updateWorldMatrix(true, true);
        let lowest = Infinity;
        for (const n of Object.values(b)) { n.getWorldPosition(target); lowest = Math.min(lowest, target.y); }
        body.position.y = holder.position.y - lowest + size * 0.09;
      }
      void mode;
    },
  };
  return c;
}
