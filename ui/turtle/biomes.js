// biomes.js - what makes each turtle its own place, and keeps it busy: Hoarshell's people shovel snow and ski down the mountain on its lift,
// Coralcrest's fish off the beach under umbrellas and torches, Emberback's mine the volcano's side for cinder and coal while it smokes, and the Elder
// stays empty but for its dinosaurs and the old stone dais at the heart of its ruins, where the way to Pell opens. Fireflies come out on some nights, and
// every lamp lights at dusk.
import * as THREE from "three";
import { character, prop } from "./assets.js";
import { SKINS, modelOf } from "./data.js";
import { emitter, lampLight, makeTool, setLamps } from "./made.js";
import { makeTurtle } from "./terrain.js";
import { addSolid } from "./world.js";
import { popup } from "./ui.js";

const FISH_PACK = "conv_cute_fish_pack/", P1 = "../games/asset_packs/lowpoly_farm_01/";
const OUT = [...SKINS.male.map(([s]) => ["male", s]), ...SKINS.female.map(([s]) => ["female", s])].filter(([, s]) => !/Swat|Spacesuit|SciFi|Soldier|King|Suit/.test(s));
const mat = (color, more = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...more });
const box = (w, h, d, m) => { const x = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); x.castShadow = true; return x; };
const cyl = (r, h, m, top = r, seg = 7) => { const x = new THREE.Mesh(new THREE.CylinderGeometry(top, r, h, seg), m); x.castShadow = true; return x; };

/** the right hand of a character, to hold something */
const handOf = (c) => { let h = null; c.root.traverse((o) => { if (!h && o.isBone && /^(wrist|hand)[_.]?r$|right_?hand/i.test(o.name)) h = o; }); return h; };
/** something held: put on the hand, its own size whatever the rig's scale, pointing out of the fist */
function hold(c, thing, turn = [Math.PI / 2, 0, 0]) {
  const h = handOf(c);
  if (!h) return null;
  c.root.updateMatrixWorld(true);
  const s = h.getWorldScale(new THREE.Vector3()).y || 1, g = new THREE.Group();
  g.add(thing); g.scale.setScalar(1 / s); g.rotation.set(...turn); h.add(g);
  return g;
}

export function makeBiomes(G) {
  const B = { busy: [] }, s = G.s;
  const person = async (L, i, height = 1.7) => { const [body, skin] = OUT[(i * 5 + L.cfg.seed) % OUT.length]; const c = await character(modelOf(body, skin), height); if (c) L.group.add(c.holder); return c; };
  const at = (L, x, z) => new THREE.Vector3(x, L.land.ground(x, z), z);
  const faceTo = (o, x, z, tx, tz) => { o.rotation.y = Math.atan2(tx - x, tz - z); };
  /** the shore of a turtle in some direction: the last dry ground walking out from the middle. -> [x, z, which way the sea is] */
  const shore = (L, a) => { let k = 0.4; for (; k < 1.4; k += 0.01) if (L.land.height(Math.cos(a) * L.cfg.a * k, Math.sin(a) * L.cfg.b * k) < 0.9) break; k -= 0.025; return [Math.cos(a) * L.cfg.a * k, Math.sin(a) * L.cfg.b * k, a]; };

  // ---------------- Hoarshell: shovelling snow, and a ski run down the mountain with its lift ----------------
  async function frost(L) {
    const f = L.cfg.flats[0], snow = mat(0xf6fbff), wood = mat(0x8a5a32), iron = mat(0x6c7078);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + 0.4, x = f.x + Math.cos(a) * 9, z = f.z + Math.sin(a) * 9, c = await person(L, i);
      if (!c) continue;
      const pile = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), snow); pile.scale.set(1.1, 0.6, 1.1); pile.position.copy(at(L, x + 1.4, z)); pile.castShadow = pile.receiveShadow = true; L.group.add(pile);
      c.holder.position.copy(at(L, x, z)); faceTo(c.holder, x, z, x + 1.4, z);
      const shovel = new THREE.Group(); shovel.add(cyl(0.025, 1.1, wood).translateY(0.35)); const blade = box(0.26, 0.02, 0.3, iron); blade.position.set(0, 0.92, 0.1); blade.rotation.x = 0.4; shovel.add(blade);
      hold(c, shovel);
      B.busy.push({ L, c, kind: "shovel", next: Math.random() * 2, pile, x: x + 1.4, z });
    }
    // the run: from high on the peak, down to the edge of the village, and a chair lift beside it back up
    const [px, pz] = L.cfg.peaks[0], top = [px + 6, pz + 6], foot = [f.x - f.r * 0.55, f.z - f.r * 0.45], run = [top, [(top[0] + foot[0]) / 2 + 5, (top[1] + foot[1]) / 2 - 3], foot];
    const posts = 6, cable = [];
    for (let i = 0; i <= posts; i++) {
      const u = i / posts, x = THREE.MathUtils.lerp(foot[0], top[0], u) - 6, z = THREE.MathUtils.lerp(foot[1], top[1], u) + 3, y = L.land.ground(x, z);
      const post = cyl(0.18, 6, iron); post.position.set(x, y + 3, z); L.group.add(post);
      const arm = box(1.6, 0.15, 0.15, iron); arm.position.set(x, y + 6, z); L.group.add(arm);
      cable.push(new THREE.Vector3(x, y + 5.9, z));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(cable), new THREE.LineBasicMaterial({ color: 0x33363c })); L.group.add(line);
    const chairs = [...Array(5)].map((_, i) => { const ch = new THREE.Group(); ch.add(box(0.05, 1.2, 0.05, iron).translateY(-0.6), box(0.9, 0.08, 0.5, mat(0xd8392e)).translateY(-1.2)); L.group.add(ch); return { ch, u: i / 5 }; });
    B.busy.push({ L, kind: "lift", cable, chairs });
    for (let i = 0; i < 3; i++) {
      const c = await person(L, 10 + i);
      if (!c) continue;
      for (const sd of [-1, 1]) { const ski = box(0.1, 0.03, 1.5, mat(i % 2 ? 0x3d8bff : 0xff8c1a)); ski.position.set(sd * 0.13, 0.02, 0.15); c.holder.add(ski); }
      B.busy.push({ L, c, kind: "ski", run, u: i / 3, speed: 0.06 + i * 0.012 });
    }
  }

  // ---------------- Coralcrest: a beach with umbrellas, loungers and torches, and people fishing off it ----------------
  async function palm(L) {
    const f = L.cfg.flats[0], toward = Math.atan2(f.z, f.x) + Math.PI, colours = [0xff5d73, 0xffd23f, 0x3dc1d3, 0x9b5de5], wood = mat(0x8a5a32);
    for (let i = 0; i < 4; i++) {
      const [x, z, a] = shore(L, toward + (i - 1.5) * 0.3), c = await person(L, i), inland = [x - Math.cos(a) * 1.2, z - Math.sin(a) * 1.2];
      if (!c) continue;
      c.holder.position.copy(at(L, ...inland)); faceTo(c.holder, inland[0], inland[1], x + Math.cos(a) * 10, z + Math.sin(a) * 10);
      const rod = new THREE.Group(); hold(c, rod, [Math.PI / 2 - 0.6, 0, 0]);
      prop(`${FISH_PACK}FishingRod_Lvl${1 + i % 3}.glb`, rod, { height: 1.8 });
      const bob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), mat(0xff3b3b)); bob.position.set(x + Math.cos(a) * 7, 0.15, z + Math.sin(a) * 7); L.group.add(bob);
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff })); ln.frustumCulled = false; L.group.add(ln);
      B.busy.push({ L, c, kind: "fish", bob, ln, rod, bite: 6 + Math.random() * 12, base: bob.position.clone() });
    }
    for (let i = 0; i < 6; i++) {                              // umbrellas and loungers along the sand, a tiki torch between each pair
      const [x, z, a] = shore(L, toward + 0.9 + i * 0.22), ix = x - Math.cos(a) * 3.5, iz = z - Math.sin(a) * 3.5, y = L.land.ground(ix, iz);
      const pole = cyl(0.05, 2.4, mat(0xf2e6c8)); pole.position.set(ix, y + 1.2, iz); L.group.add(pole);
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.6, 8, 1, true), mat(colours[i % 4], { side: THREE.DoubleSide })); top.position.set(ix, y + 2.5, iz); top.castShadow = true; L.group.add(top);
      const chair = box(0.6, 0.12, 1.6, mat(0xffffff)); chair.position.set(ix + Math.sin(a) * 1.2, y + 0.3, iz - Math.cos(a) * 1.2); chair.rotation.y = -a + Math.PI / 2; L.group.add(chair);
      if (i % 2) {
        const tx = ix - Math.sin(a) * 2, tz = iz + Math.cos(a) * 2, ty = L.land.ground(tx, tz), torch = new THREE.Group();
        torch.add(cyl(0.06, 1.8, wood).translateY(0.9), cyl(0.12, 0.25, mat(0x5b3520), 0.16).translateY(1.85));
        torch.position.set(tx, ty, tz); L.group.add(torch);
        B.busy.push({ L, kind: "torch", fire: emitter(torch, [0, 2.0, 0], { n: 18, colors: [0xffd25e, 0xff8a3a], up: 0.8, spread: 0.12, life: 0.6, size: 0.14, grow: 0.4, drift: 0.1 }) });
      }
      if (i === 2) { const board = box(0.5, 2, 0.08, mat(0x3dc1d3)); board.position.set(ix + 1.5, y + 0.9, iz); board.rotation.z = 0.2; L.group.add(board); }
    }
  }

  // ---------------- Emberback: miners on the volcano's flank, a cart on rails, and the mountain smoking ----------------
  async function ember(L) {
    const [px, pz, ph, pw] = L.cfg.peaks[0], f = L.cfg.flats[0], dir = Math.atan2(f.z - pz, f.x - px), site = [px + Math.cos(dir) * pw * 0.75, pz + Math.sin(dir) * pw * 0.75];
    const rock = mat(0x3a3236), coal = mat(0x1c1b1e), ember2 = mat(0xff6a2a, { emissive: 0xff4a1a, emissiveIntensity: 0.6 }), timber = mat(0x6d4a28);
    // the mine's mouth in the hillside: a timber frame round a dark hole
    const sy = L.land.ground(...site), mouth = new THREE.Group(); mouth.position.set(site[0], sy, site[1]); faceTo(mouth, site[0], site[1], f.x, f.z); L.group.add(mouth);
    mouth.add(box(3, 3, 0.4, mat(0x0c0b0c)).translateY(1.5).translateZ(-0.3));
    for (const sd of [-1, 1]) mouth.add(box(0.3, 3.2, 0.3, timber).translateX(sd * 1.6).translateY(1.6));
    mouth.add(box(3.6, 0.35, 0.4, timber).translateY(3.2));
    addSolid(L, { x: site[0], z: site[1], r: 1.8 });
    for (let i = 0; i < 4; i++) {
      const a = dir + Math.PI / 2 + (i - 1.5) * 0.35, x = site[0] + Math.cos(a) * 6 + Math.cos(dir) * 3, z = site[1] + Math.sin(a) * 6 + Math.sin(dir) * 3, c = await person(L, i);
      const seam = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), rock); seam.position.copy(at(L, x - Math.cos(dir) * 1.3, z - Math.sin(dir) * 1.3)).add(new THREE.Vector3(0, 0.5, 0)); seam.castShadow = true; L.group.add(seam);
      for (let k = 0; k < 4; k++) { const bit = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), k % 2 ? coal : ember2); bit.position.copy(seam.position).add(new THREE.Vector3((k - 1.5) * 0.3, 0.55, 0.25)); L.group.add(bit); }
      if (!c) continue;
      c.holder.position.copy(at(L, x, z)); faceTo(c.holder, x, z, seam.position.x, seam.position.z);
      hold(c, makeTool("pick"));
      B.busy.push({ L, c, kind: "mine", next: Math.random() * 2, at: seam.position.clone() });
    }
    // a cart of coal on rails, out of the mine and down to the yard and back
    const from = [site[0] + Math.cos(dir) * 2, site[1] + Math.sin(dir) * 2], to = [site[0] + Math.cos(dir) * 16, site[1] + Math.sin(dir) * 16];
    for (let i = 0; i <= 14; i++) { const u = i / 14, x = THREE.MathUtils.lerp(from[0], to[0], u), z = THREE.MathUtils.lerp(from[1], to[1], u), tie = box(1.4, 0.08, 0.25, timber); tie.position.copy(at(L, x, z)).add(new THREE.Vector3(0, 0.05, 0)); tie.rotation.y = -dir; L.group.add(tie); }
    const cart = new THREE.Group(); cart.add(box(1, 0.6, 1.4, mat(0x55585e)).translateY(0.55)); for (let k = 0; k < 6; k++) cart.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), coal).translateX((k % 3 - 1) * 0.28).translateY(0.95).translateZ((k > 2 ? 0.3 : -0.3)));
    L.group.add(cart);
    B.busy.push({ L, kind: "cart", cart, from, to, dir });
    // the volcano: a plume from its top, and a red glow in the crater
    const topY = L.land.ground(px, pz) + 1;
    const vent = new THREE.Group(); vent.position.set(px, topY, pz); L.group.add(vent);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(4, 10), new THREE.MeshBasicMaterial({ color: 0xff5a1a })); glow.rotation.x = -Math.PI / 2; glow.position.y = -0.6; vent.add(glow);
    B.busy.push({ L, kind: "vent", smoke: emitter(vent, [0, 0, 0], { n: 60, colors: [0x5a5254, 0x403a3c, 0x7a7072], up: 2.4, spread: 3, life: 6, size: 2.2, grow: 3, drift: 1 }), sparks: emitter(vent, [0, 0, 0], { n: 24, colors: [0xffb04a, 0xff6a2a], up: 4, spread: 2, life: 1.4, size: 0.25, grow: 0.5, drift: 1.5 }) });
  }

  // ---------------- the Elder: empty and old. In the middle of the ruins, a dais where the way to Pell opens ----------------
  function elder(L) {
    const cx = 0, cz = 20, y = L.land.ground(cx, cz), stone = mat(0x9a968c), dark = mat(0x7a766e), rune = new THREE.MeshBasicMaterial({ color: 0x3a6a66 });
    const dais = new THREE.Group(); dais.position.set(cx, y, cz); L.group.add(dais);
    [[5.2, 0.4], [4.2, 0.8], [3.2, 1.2]].forEach(([r, h], i) => { const step = cyl(r, 0.4, i % 2 ? dark : stone, r, 12); step.position.y = h - 0.2; step.receiveShadow = true; dais.add(step); });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.1, 6, 40), rune); ring.rotation.x = -Math.PI / 2; ring.position.y = 1.22; dais.add(ring);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, mark = box(0.5, 0.04, 0.16, rune); mark.position.set(Math.cos(a) * 1.7, 1.22, Math.sin(a) * 1.7); mark.rotation.y = -a; dais.add(mark); }
    const portal = new THREE.Group(); portal.position.y = 4.2; portal.visible = false; dais.add(portal);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.22, 8, 48), new THREE.MeshBasicMaterial({ color: 0x9ff3e6 })); portal.add(rim);
    const veil = new THREE.Mesh(new THREE.CircleGeometry(2.7, 48), new THREE.MeshBasicMaterial({ color: 0x2a7a8a, transparent: true, opacity: 0.55, side: THREE.DoubleSide })); portal.add(veil);
    const pell = makeTurtle({ a: 1.3, b: 1, deep: 0.55 }); pell.group.scale.setScalar(0.8); pell.group.position.z = -0.5; portal.add(pell.group);         // the lost child, asleep on the far side
    const motes = emitter(portal, [0, -2.2, 0], { n: 50, colors: [0x9ff3e6, 0xe9e2ff, 0x7fe0d0], up: 1.2, spread: 5, life: 2.4, size: 0.12, grow: 0.5, drift: 0.6 });
    const rec = addSolid(L, { x: cx, z: cz, r: 0 });
    rec.use = () => {
      if (!s.flags.truth) return ["Look at the stone dais", () => popup("Old rings cut into the stone. They're cold. Someone would have to know what this is for")];
      if (!s.flags.portal) return ["Stand on the dais and open the way", open];
      return ["Look through the way to Pell", () => G.talk.say("Vermeil", ["Still asleep. Still safe.", "The song has to reach this far. That's what the Heartbloom is for."])];
    };
    function open() {
      s.flags.portal = true; G.sfx("evolve"); portal.visible = true; portal.scale.setScalar(0.01);
      const [wx, wz] = L.world(cx, cz); G.vfx.burst("glow", wx, y + 4, wz, 3);
      G.talk.say("Vermeil", ["Look... through there. A little turtle, curled up under a great old shell.", "That's Pell. Asleep all these years, and safe.", "It can't hear its mother from so far. But a song can travel where we can't. Moss gave us a seed for that."]);
      G.moment?.("evolve");
    }
    B.busy.push({ L, kind: "portal", portal, rim, veil, pell, motes, ring, rune });
    if (s.flags.portal) portal.visible = true;
  }

  B.onDetail = async (L) => {
    if (L.biome) return;
    L.biome = true;
    const id = L.cfg.id;
    try { if (id === "frost") await frost(L); else if (id === "palm") await palm(L); else if (id === "ember") await ember(L); else if (id === "elder") elder(L); }
    catch (e) { console.warn("[biomes]", id, e); }
  };

  // ---------------- fireflies: some nights, round wherever you are, more over the marsh and the beach ----------------
  const N = 70, fpos = new Float32Array(N * 3), fa = new Float32Array(N), seeds = new Float32Array(N * 4).map(() => Math.random());
  const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.BufferAttribute(fpos, 3)); fg.setAttribute("alpha", new THREE.BufferAttribute(fa, 1));
  const flies = new THREE.Points(fg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: "attribute float alpha; varying float a; void main(){ a = alpha; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 90.0 / max(1.0, -p.z); gl_Position = projectionMatrix * p; }",
    fragmentShader: "varying float a; void main(){ vec2 u = gl_PointCoord - 0.5; float d = dot(u, u); if (d > 0.25) discard; gl_FragColor = vec4(1.0, 0.95, 0.5, a * (1.0 - d * 4.0)); }" }));
  flies.frustumCulled = false; G.scene.add(flies);
  let flyK = 0, lampIn = 0;

  B.tick = (dt, t) => {
    const P = G.player.pos, hour = s.minute / 60, dark = Math.min(1, hour > 12 ? THREE.MathUtils.smoothstep(hour, 18.3, 19.5) : 1 - THREE.MathUtils.smoothstep(hour, 5.2, 6.4));
    if ((lampIn -= dt) <= 0) { lampIn = 0.25; setLamps(dark); }
    // fireflies on about two nights in three, never in the rain or the snow; thicker in a marsh or by the sea
    const on = dark > 0.5 && !/rain|storm|heavy|snow/.test(s.weather) && (Math.sin(s.day * 12.9898) * 43758.5453 % 1 + 1) % 1 < 0.68, where = G.player.ground?.on;
    flyK += ((on ? (where === "mire" || where === "palm" ? 1 : 0.6) : 0) - flyK) * Math.min(1, dt * 0.5);
    flies.visible = flyK > 0.01;
    if (flies.visible) {
      for (let i = 0; i < N; i++) {
        const a = seeds[i * 4] * 6.3 + t * (0.05 + seeds[i * 4 + 1] * 0.1), r = 4 + seeds[i * 4 + 2] * 22;
        fpos[i * 3] = P.x + Math.cos(a) * r + Math.sin(t * 0.7 + i) * 0.8; fpos[i * 3 + 2] = P.z + Math.sin(a) * r + Math.cos(t * 0.6 + i) * 0.8;
        fpos[i * 3 + 1] = P.y + 0.5 + seeds[i * 4 + 3] * 2.5 + Math.sin(t * 1.3 + i * 2) * 0.3;
        fa[i] = (i / N < flyK ? 1 : 0) * Math.max(0, Math.sin(t * (1.5 + seeds[i * 4 + 1] * 2) + i * 7)) ** 3;
      }
      fg.attributes.position.needsUpdate = true; fg.attributes.alpha.needsUpdate = true;
    }
    for (const b of B.busy) {
      if (!b.L.group.visible || b.L.dist(P.x, P.z) > b.L.cfg.a + 160) continue;
      if (b.c) b.c.mixer.update(dt);
      if (b.kind === "shovel" || b.kind === "mine") {
        if ((b.next -= dt) <= 0) {
          b.next = 1.3 + Math.random() * 0.8; b.c.once?.("swing");
          const p = b.kind === "mine" ? b.at : new THREE.Vector3(b.x, b.L.land.ground(b.x, b.z) + 0.5, b.z), [wx, wz] = b.L.world(p.x, p.z);
          setTimeout(() => G.vfx.burst(b.kind === "mine" ? "spark" : "splash", wx, p.y + 0.3, wz, 0.5), 450);
          if (b.kind === "mine" && Math.random() < 0.4) setTimeout(() => G.vfx.burst("stone", wx, p.y + 0.3, wz, 0.4), 480);
          if (b.pile) { b.pile.scale.y = Math.max(0.15, b.pile.scale.y - 0.04); if (b.pile.scale.y <= 0.16) b.pile.scale.y = 0.6; }      // shovelled down, and the snow keeps coming
        }
      } else if (b.kind === "lift") {
        for (const ch of b.chairs) {
          ch.u = (ch.u + dt * 0.02) % 1;
          const f = ch.u * (b.cable.length - 1), i = Math.min(b.cable.length - 2, Math.floor(f)), p = b.cable[i].clone().lerp(b.cable[i + 1], f - i);
          ch.ch.position.copy(p);
        }
      } else if (b.kind === "ski") {
        b.u += dt * b.speed;
        if (b.u > 1) b.u = 0;                                // down at the bottom: back up on the lift (out of sight) and away again
        const r = b.run, k = b.u * 2, i = Math.min(1, Math.floor(k)), f = k - i, wig = Math.sin(b.u * 40) * 2.2;
        const x = THREE.MathUtils.lerp(r[i][0], r[i + 1][0], f), z = THREE.MathUtils.lerp(r[i][1], r[i + 1][1], f), dx = r[i + 1][0] - r[i][0], dz = r[i + 1][1] - r[i][1], L2 = Math.hypot(dx, dz) || 1;
        const sx = x + (-dz / L2) * wig, sz = z + (dx / L2) * wig;
        b.c.holder.position.set(sx, b.L.land.ground(sx, sz) + 0.05, sz); b.c.holder.rotation.set(0.25, Math.atan2(dx, dz) + Math.cos(b.u * 40) * 0.5, Math.cos(b.u * 40) * 0.15, "YXZ");
        b.c.play("idle");
        if (Math.random() < dt * 8) { const [wx, wz] = b.L.world(sx, sz); G.vfx.burst("splash", wx, b.c.holder.position.y + 0.2, wz, 0.25); }
      } else if (b.kind === "fish") {
        b.bite -= dt;
        b.bob.position.y = b.base.y + Math.sin(t * 2 + b.base.x) * 0.05 - (b.bite < 0 && b.bite > -1 ? 0.25 : 0);
        if (b.bite < -1) { b.bite = 8 + Math.random() * 14; b.c.once?.("swing"); const [wx, wz] = b.L.world(b.bob.position.x, b.bob.position.z); G.vfx.burst("splash", wx, 0.3, wz, 0.8); }
        const tip = new THREE.Vector3(0, 1.75, 0); b.rod.localToWorld(tip); b.L.group.worldToLocal(tip);
        b.ln.geometry.attributes.position.setXYZ(0, tip.x, tip.y, tip.z); b.ln.geometry.attributes.position.setXYZ(1, b.bob.position.x, b.bob.position.y, b.bob.position.z); b.ln.geometry.attributes.position.needsUpdate = true;
      } else if (b.kind === "torch") b.fire.tick(dt, 0.4 + dark * 0.6);
      else if (b.kind === "cart") {
        const u = (Math.sin(t * 0.25) + 1) / 2, x = THREE.MathUtils.lerp(b.from[0], b.to[0], u), z = THREE.MathUtils.lerp(b.from[1], b.to[1], u);
        b.cart.position.set(x, b.L.land.ground(x, z) + 0.1, z); b.cart.rotation.y = -b.dir + Math.PI / 2;
      } else if (b.kind === "vent") { b.smoke.tick(dt, 1); b.sparks.tick(dt, 0.5 + Math.max(0, Math.sin(t * 0.3)) * 0.5); }
      else if (b.kind === "portal" && b.portal.visible) {
        b.portal.scale.setScalar(Math.min(1, b.portal.scale.x + dt * 0.5));
        b.rim.rotation.z += dt * 0.6; b.veil.material.opacity = 0.45 + Math.sin(t * 2) * 0.1; b.pell.group.position.y = Math.sin(t * 0.8) * 0.15;
        b.pell.update(t, { asleep: !s.flags.finale, moored: true }); b.motes.tick(dt, 1);
        b.rune.color.setHex(0x9ff3e6);
      }
    }
  };
  return B;
}
