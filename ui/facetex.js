// facetex.js - faces drawn in a model's textures, moved for real.
//
// Game rips (Pokémon and the like) keep their eyes and mouth as separate small meshes on a sprite sheet: a grid of frames (eyes
// open, half, shut; mouth closed to wide open) with the mesh's UVs on one cell. faceSheets() finds those meshes (they follow only
// the head), works out the grid from the picture itself, and slides the texture from frame to frame, so the model blinks and its
// mouth moves while it talks, and it shows moods the way Vermeil's picture face does (happy, sad, angry, surprised, thinking, sleepy): the sheet
// is sorted by how wide open each eye frame is, how open each mouth frame is, and which way a closed mouth curves. A separate iris layer goes
// away while the eyes are shut.
// A model with nothing like that stays as it is: no fake face is ever added.
import * as THREE from "three";

const GRIDS = [[2, 4], [2, 2], [4, 4], [4, 2], [1, 4], [4, 1], [2, 1], [1, 2], [8, 8], [4, 8], [8, 4], [2, 8]];
const SIZE = 16;                       // each cell is compared as a 16 x 16 thumbnail
// what the body doing something shows on the face
const MOOD = { roar: "angry", bite: "angry", claw: "angry", breathe_fire: "angry", charge: "angry", stomp: "angry", attack: "angry", hurt: "sad", faint: "asleep",
  sleepy: "sleepy", happy: "happy", sad: "sad", surprised: "surprised", angry: "angry", cheer: "happy", wave: "happy", dance: "happy", laugh: "happy", think: "thinking", thinking: "thinking" };
const EYE = /eye|iris|pupil/i, MOUTH = /mouth|lip|teeth/i, IRIS = /iris|pupil/i;

/** Does the mesh follow only the head? */
function onHead(m, group) {
  if (!m.isSkinnedMesh) { for (let p = m.parent; p; p = p.parent) if (group.has(p)) return true; return false; }
  const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
  if (!si || !sw) return false;
  let on = 0;
  for (let i = 0; i < si.count; i++) {
    let best = -1, bw = 0;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    if (group.has(m.skeleton.bones[best])) on++;
  }
  return on >= si.count * 0.9;
}

/** the texture as readable pixels, width x height. null if the browser won't give them */
function pixels(tex, width = 256, height = 256) {
  const img = tex?.image;
  if (!img?.width) return null;
  try {
    const cv = document.createElement("canvas");
    cv.width = width; cv.height = height;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, width, height);
    return { data: g.getImageData(0, 0, width, height).data, width, height };
  } catch { return null; }
}

/** a coordinate brought back into 0-1, the way the texture's wrap mode would */
function fold(x, wrap) {
  if (wrap === THREE.MirroredRepeatWrapping) { const f = ((x % 2) + 2) % 2; return f > 1 ? 2 - f : f; }
  return x - Math.floor(x);
}

/** the mesh's UVs folded into 0-1, and their box */
function uvBox(m) {
  const uv = m.geometry.attributes.uv, tex = m.material.map;
  if (!uv || !tex) return null;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const fu = [], fv = [];
  // one mesh sits inside one cell: the middle of its UVs decides which whole tile of the wrap that is
  const mean = (get) => { let s = 0; for (let i = 0; i < uv.count; i++) s += get(i); return s / uv.count; };
  const tu = Math.floor(mean((i) => uv.getX(i))), tv = Math.floor(mean((i) => uv.getY(i)));
  for (let i = 0; i < uv.count; i++) {
    const u = fold(uv.getX(i) - tu + (((tu % 2) + 2) % 2), tex.wrapS), v = fold(uv.getY(i) - tv + (((tv % 2) + 2) % 2), tex.wrapT);
    fu.push(u); fv.push(v);
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return { u0, u1, v0, v1, fu, fv };
}

function thumb(px, x, y, w, h) {
  const out = new Float32Array(SIZE * SIZE * 3);
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    const X = Math.min(px.width - 1, Math.floor(x + (i + 0.5) / SIZE * w)), Y = Math.min(px.height - 1, Math.floor(y + (j + 0.5) / SIZE * h));
    const o = (Y * px.width + X) * 4;
    out.set([px.data[o], px.data[o + 1], px.data[o + 2]], (j * SIZE + i) * 3);
  }
  return out;
}
/** the filler of an unused cell: all one colour */
function blank(t) {
  let s = 0;
  for (let i = 0; i < t.length; i += 3) s += Math.abs(t[i] - t[0]) + Math.abs(t[i + 1] - t[1]) + Math.abs(t[i + 2] - t[2]);
  return s / t.length * 3 < 6;
}
/** how alike two thumbnails are, 0-1: along their rim (ring), or inside it */
function alike(a, b, ring) {
  let s = 0, n = 0;
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    if ((i < 2 || j < 2 || i >= SIZE - 2 || j >= SIZE - 2) !== ring) continue;
    const o = (j * SIZE + i) * 3;
    s += Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
    n += 3;
  }
  return 1 - s / n / 255;
}

/** The grid of frames on the picture. Frames of a real sheet join the skin around them, so the edge of what the mesh shows is the same in
 *  each of them and only the inside changes; a head on a texture atlas never passes that. Of the grids where the mesh's UVs fit inside one
 *  cell, the one with the most such frames. -> { cols, rows, col, row, frames: [{col, row}] } or null when it isn't a sheet. */
function findGrid(px, box) {
  let best = null;
  for (const [cols, rows] of GRIDS) {
    const eps = 0.004, col = Math.floor((box.u0 + eps) * cols), row = Math.floor((box.v0 + eps) * rows);
    if (Math.floor((box.u1 - eps) * cols) !== col || Math.floor((box.v1 - eps) * rows) !== row) continue;
    const bw = (box.u1 - box.u0) * px.width, bh = (box.v1 - box.v0) * px.height;
    // a tiny corner of the cell isn't what it's for. Eyes are wide and thin, though (Rayquaza's fill a third of their frame's height), so one side may be small if the other isn't
    const fu = (box.u1 - box.u0) * cols, fv = (box.v1 - box.v0) * rows;
    if (Math.min(fu, fv) < 0.18 || Math.max(fu, fv) < 0.35) continue;
    const at = (c, r) => thumb(px, (box.u0 + (c - col) / cols) * px.width, (box.v0 + (r - row) / rows) * px.height, bw, bh);
    const base = at(col, row), frames = [];
    if (blank(base)) continue;
    let most = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const th = at(c, r);
      if (blank(th) || alike(base, th, true) < 0.9) continue;
      frames.push({ col: c, row: r });
      most = Math.max(most, 1 - alike(base, th, false));
    }
    // frames must differ somewhere inside: small eyes in a big dark lid (Rayquaza's) change only a few per cent of the picture between open and shut
    if (frames.length >= 3 && most > 0.015 && (!best || frames.length > best.frames.length)) best = { cols, rows, col, row, frames };
  }
  return best;
}

/** how much of a cell is: white of the eye / open mouth (pink, red) */
function measure(px, g, f, box) {
  const w = px.width / g.cols, h = px.height / g.rows;
  let white = 0, pink = 0, n = 0;
  const x0 = (box.u0 - g.col / g.cols + f.col / g.cols) * px.width, y0 = (box.v0 - g.row / g.rows + f.row / g.rows) * px.height;
  const bw = (box.u1 - box.u0) * px.width, bh = (box.v1 - box.v0) * px.height, dark = [[0, 0], [0, 0], [0, 0]];
  const colours = new Map(), seen = [];
  for (let y = Math.floor(f.row * h); y < (f.row + 1) * h - 1; y++) for (let x = Math.floor(f.col * w); x < (f.col + 1) * w - 1; x++) {
    const o = (y * px.width + x) * 4, r = px.data[o], gr = px.data[o + 1], b = px.data[o + 2];
    n++;
    if (r > 200 && gr > 200 && b > 195) white++;
    if (r > gr + 30 && r > b + 25) pink++;
    // the mouth's line, inside what the mesh shows: its middle against its ends says smile or frown
    if (x >= x0 && x < x0 + bw && y >= y0 && y < y0 + bh) {
      if (r + gr + b < 240) { const third = Math.min(2, Math.floor((x - x0) / bw * 3)); dark[third][0] += y; dark[third][1]++; }
      const key = (r >> 4) << 8 | (gr >> 4) << 4 | (b >> 4);
      colours.set(key, (colours.get(key) || 0) + 1);
      seen.push([r, gr, b]);
    }
  }
  // how much of it isn't skin: the commonest colour is the skin, of any animal; an open eye is a big patch of something else
  const skin = [...colours.entries()].sort((p1, p2) => p2[1] - p1[1])[0]?.[0] ?? 0;
  const sk = [(skin >> 8) * 16 + 8, ((skin >> 4) & 15) * 16 + 8, (skin & 15) * 16 + 8];
  const open = seen.filter((c) => Math.abs(c[0] - sk[0]) + Math.abs(c[1] - sk[1]) + Math.abs(c[2] - sk[2]) > 90).length / (seen.length || 1);
  const row = ([s, c]) => (c ? s / c : null), a = row(dark[0]), mid = row(dark[1]), c = row(dark[2]);
  return { white: white / (n || 1), pink: pink / (n || 1), open, bend: a == null || mid == null || c == null ? 0 : ((a + c) / 2 - mid) / (bh || 1) };
}

/** which way is up in the picture for this mesh: +1 when the top of the mesh is the top of the picture */
function pictureUp(m, box) {
  const ys = [], p = new THREE.Vector3();
  for (let i = 0; i < box.fv.length; i++) { m.getVertexPosition(i, p); ys.push(p.applyMatrix4(m.matrixWorld).y); }
  const my = ys.reduce((a, b) => a + b, 0) / ys.length, mv = box.fv.reduce((a, b) => a + b, 0) / box.fv.length;
  return ys.reduce((s, y, i) => s + (y - my) * (box.fv[i] - mv), 0) <= 0 ? 1 : -1;
}

/** a sheet mesh: its UVs moved onto the first cell, and a texture of its own, so it can slide from frame to frame */
function setUp(m, box, grid) {
  const g = m.geometry = m.geometry.clone();
  const uv = g.attributes.uv, cw = 1 / grid.cols, ch = 1 / grid.rows;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, box.fu[i] - grid.col * cw, box.fv[i] - grid.row * ch);
  uv.needsUpdate = true;
  const mat = m.material = m.material.clone(), tex = mat.map.clone();
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  mat.map = tex;
  return (f) => tex.offset.set(f.col * cw, f.row * ch);
}

/** a layer drawn with see-through parts must stay see-through (rigging once saved Riolu's iris as a black block) */
function repairAlpha(m) {
  const mat = m.material, px = pixels(mat.map, 32, 32);
  if (!px || mat.transparent || mat.alphaTest > 0) return false;
  let clear = 0;
  for (let i = 3; i < px.data.length; i += 4) if (px.data[i] < 128) clear++;
  if (clear < 32 * 32 * 0.1) return false;
  mat.transparent = true; mat.depthWrite = false; mat.needsUpdate = true;
  return true;
}

/** In words, for the rigger: what its face can do. Only looks: the model isn't changed. */
export function faceReport(root, info) {
  const morphs = []; const group = new Set(); let sheets = 0;
  root.traverse((o) => { if (o.morphTargetDictionary) morphs.push(...Object.keys(o.morphTargetDictionary)); });
  info.head?.traverse((o) => { if (o.isBone) group.add(o); });
  root.updateMatrixWorld(true);
  root.traverse((m) => {
    if (!info.head || !m.isMesh || !m.material?.map || Array.isArray(m.material) || !onHead(m, group)) return;
    const px = pixels(m.material.map), box = px && uvBox(m);
    if (box && findGrid(px, box)) sheets++;
  });
  const mouth = morphs.some((n) => /jaw|mouth|^aa$|v_aa/i.test(n)) ? "its shape keys" : info.jaw ? "its jaw bone" : sheets ? "its mouth pictures" : "";
  return `${sheets ? "Face pictures found in its textures, so it can blink. " : ""}${mouth ? `It talks with ${mouth}.` : "No face rig or face pictures: it nods as it talks."}`;
}

/** What the textures of this model can do. null when they have nothing to move. update(dt, talk): blink, and the mouth follows talk (0-1). */
export function faceSheets(root, info) {
  if (!info.head) return null;
  const group = new Set();
  info.head.traverse((o) => { if (o.isBone) group.add(o); });
  const found = [];
  root.traverse((m) => { if (m.isMesh && m.material?.map && !Array.isArray(m.material) && onHead(m, group)) found.push(m); });
  if (!found.length) return null;
  const out = { eyes: null, mouth: null, iris: [] };
  const layers = [];
  let sheets = 0, eyeMesh = null;
  const nameOf = (m) => `${m.name} ${m.material.name} ${m.material.map.name || ""}`;
  const named = (re) => found.some((m) => re.test(nameOf(m)) && !IRIS.test(nameOf(m)));
  for (const m of found) {
    const name = nameOf(m);
    repairAlpha(m);
    if (IRIS.test(name)) { out.iris.push(m); continue; }
    const px = pixels(m.material.map), box = px && uvBox(m), grid = box && findGrid(px, box);
    if (!grid) {
      if (m.material.transparent && !EYE.test(name) && !MOUTH.test(name)) layers.push(m);
      continue;
    }
    const cells = grid.frames.map((f) => ({ ...f, ...measure(px, grid, f, box) }));
    const up = pictureUp(m, box);
    const sum = (k) => cells.reduce((s, c) => s + c[k], 0);
    const isEyes = EYE.test(name) || (!MOUTH.test(name) && sum("white") > sum("pink"));
    // a texture named for it beats a guess: Pikachu's cheeks are a small sheet on the head too
    if (!EYE.test(name) && !MOUTH.test(name) && named(isEyes ? EYE : MOUTH)) continue;
    const show = setUp(m, box, grid);
    sheets++;
    if (isEyes && !out.eyes) {
      const sorted = cells.slice().sort((a, b) => b.open - a.open);        // the most showing that isn't skin: wide open
      out.eyes = { n: 3, show(i) { show(sorted[Math.round((sorted.length - 1) * i / 2)]); } };     // 0 wide open, 1 half, 2 shut
      out.eyes.show(0);
      eyeMesh = m;
    } else if (!isEyes && !out.mouth) {
      const sorted = cells.slice().sort((a, b) => a.pink - b.pink);        // the less of the inside showing, the more closed
      const shut = sorted.filter((c) => c.pink < 0.02);
      const curved = (sign) => shut.slice().sort((a, b) => sign * up * (a.bend - b.bend))[0];      // in the picture, a smile's ends sit higher than its middle
      out.mouth = { n: sorted.length, show(i) { show(sorted[Math.min(i, sorted.length - 1)]); },
        rest: { sad: curved(1), angry: curved(1) }, plain: show };
      out.mouth.show(0);
    }
  }
  // no name, but a see-through layer lying on the eyes: that's the iris
  if (eyeMesh) {
    const around = new THREE.Box3().setFromObject(eyeMesh, true).expandByScalar(0.001);
    for (const m of layers) if (around.containsPoint(new THREE.Box3().setFromObject(m, true).getCenter(new THREE.Vector3()))) out.iris.push(m);
  }
  if (!sheets) return null;
  let blink = 1.5 + Math.random() * 3, shape = -1, next = 0, shown = -1, wore = "";
  out.update = (dt, talk = 0, moodName = "neutral") => {
    const mood = MOOD[moodName] || moodName;
    blink -= dt;
    if (blink < -0.16) blink = 2 + Math.random() * 3.5;
    const held = { sad: 1, angry: 1, thinking: 1, sleepy: 1 }[mood] || 0;
    const eye = mood === "asleep" ? 2 : blink >= 0 ? held : blink > -0.04 || blink < -0.12 ? 1 : 2;
    if (eye !== shown) { shown = eye; out.eyes?.show(eye); for (const m of out.iris) m.visible = eye !== 2; }
    if (!out.mouth) return;
    next -= dt;
    if (next > 0 && mood === wore) return;
    next = 0.07 + Math.random() * 0.06;                                // a new shape ~10 times a second, as wide as the voice is loud
    wore = mood;
    const n = out.mouth.n - 1;
    const want = talk >= 0.06 ? Math.max(1, Math.round(talk * n * (0.6 + Math.random() * 0.6))) : mood === "surprised" ? n : mood === "happy" ? Math.round(n * 0.6) : 0;
    const rest = want === 0 && out.mouth.rest[mood];
    if (rest) { shape = -1; out.mouth.plain(rest); } else if (want !== shape) { shape = want; out.mouth.show(want); }
  };
  return out;
}
