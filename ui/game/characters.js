// characters.js - a character in the 3D world (player, Vermeil, allies, NPCs, monsters, bosses).
// Loads the model (or assembles a modular one), sizes it for its body type, gives it the shared Animator,
// moves it along paths on the navigation grid, attaches its weapon, shows its name/HP bar, and - for
// Vermeil - drives her picture face (blinking, moods, talking mouth).
import * as THREE from "three";
import * as A from "./assets.js";
import { Animator, styleFor } from "./anim.js";

const HEIGHT = { humanoid: 1.75, quadruped: 1.25, flyer: 1.3, blob: 1.0, serpent: 0.9 };
const PAINT_FACE = null;      // no model gets painted eyes any more (the warrior and ranger look better without them)

// what each class carries when nothing else is equipped (and what non-human species show in the creation preview)
export const CLASS_KIT = {
  warrior: { main: "conv_medieval_weapons_pack_sword_2" }, knight: { main: "conv_medieval_weapons_pack_sword", off: "conv_medieval_weapons_pack_shield_heater" },
  paladin: { main: "conv_medieval_weapons_pack_hammer_small", off: "conv_medieval_weapons_pack_shield_celtic_golden" },
  rogue: { main: "conv_medieval_weapons_pack_dagger", off: "conv_medieval_weapons_pack_dagger_2" }, ranger: { main: "conv_medieval_weapons_pack_bow_wooden" },
  mage: { main: "conv_rpg_asset_pack_staff" }, elementalist: { main: "conv_rpg_asset_pack_icestaff" }, summoner: { main: "conv_rpg_asset_pack_woodenstaff" },
  cleric: { main: "conv_ultimate_rpg_items_pack_hammer_double_golden", off: "conv_ultimate_rpg_items_pack_book1_closed" }, monk: {},
};

/** sword / dagger / bow / staff / shield / spear / hammer / axe (decides how it's held and how its owner attacks) */
export function weaponKind(id) {
  const s = String(id || "").toLowerCase();
  if (!s) return "fists";
  if (/shield/.test(s)) return "shield";
  if (/dagger|knife/.test(s)) return "dagger";
  if (/crossbow|bow/.test(s)) return "bow";
  if (/book|tome/.test(s)) return "book";
  if (/staff|wand/.test(s)) return "staff";
  if (/spear|lance|trident|halberd|scythe/.test(s)) return "spear";
  if (/hammer|mace|club/.test(s)) return "hammer";
  if (/axe/.test(s)) return "axe";
  return "sword";
}

/** where the fist is, in the forearm bone's own space: the far end of the skin that bone moves (bind pose).
    Monster rigs (orc, demon, dino, bunny, skeleton) stop at the forearm, so the hand is part of that bone. */
const GRIPS = new Map();
function gripPoint(root, bone, modelId) {
  const key = `${modelId}|${bone.name}`;
  if (GRIPS.has(key)) return GRIPS.get(key)?.clone() || null;
  const pts = [], v = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const bi = o.skeleton.bones.indexOf(bone);
    const g = o.geometry.attributes;
    if (bi < 0 || !g.skinIndex || !g.skinWeight) return;
    const inv = o.skeleton.boneInverses[bi];
    for (let k = 0; k < g.position.count; k++) {
      let w = 0;
      for (let j = 0; j < 4; j++) if (g.skinIndex.getComponent(k, j) === bi) w += g.skinWeight.getComponent(k, j);
      if (w < 0.5) continue;
      pts.push(v.fromBufferAttribute(g.position, k).applyMatrix4(o.bindMatrix).applyMatrix4(inv).clone());
    }
  });
  let out = null;
  if (pts.length >= 4) {
    pts.sort((a, b) => b.lengthSq() - a.lengthSq());
    const top = pts.slice(0, Math.max(3, Math.round(pts.length * 0.15)));
    out = top.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(top.length).multiplyScalar(0.85);
  }
  GRIPS.set(key, out);
  return out?.clone() || null;
}

/** a weapon model turned so its length runs along +Y (handle -> head), its width along +X, with the spot the hand
    holds at the origin. Weapons come lying every which way, so this reads the shape: the widest part is the
    crossguard (swords, daggers) or the head (axes, hammers, staffs, spears); bows, shields and books are held at the middle. */
const WEAPON_SHAPE = new Map();
function placeWeapon(root, id, kind, size) {
  root.updateMatrixWorld(true);
  let S = WEAPON_SHAPE.get(id);
  if (!S) {
    const pts = [], v = new THREE.Vector3(), inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const step = Math.max(1, Math.floor(pos.count / 3000));
      for (let k = 0; k < pos.count; k += step) pts.push(v.fromBufferAttribute(pos, k).applyMatrix4(m).clone());
    });
    const box = new THREE.Box3().setFromPoints(pts), dim = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const axes = ["x", "y", "z"].sort((a, b) => dim[b] - dim[a]);          // longest, middle, thinnest
    const [L, M, T] = axes;
    // how wide the weapon is along its length (12 slices)
    const N = 12, wide = new Array(N).fill(0);
    for (const p of pts) {
      const i = Math.min(N - 1, Math.max(0, Math.floor(((p[L] - box.min[L]) / Math.max(1e-6, dim[L])) * N)));
      wide[i] = Math.max(wide[i], Math.abs(p[M] - c[M]), Math.abs(p[T] - c[T]) * 0.6);
    }
    const top = wide.indexOf(Math.max(...wide)), atLow = top < N / 2;
    let flip, t;            // flip: the handle is at the high end; t: how far along from the handle end the hand goes
    if (kind === "sword" || kind === "dagger") {
      const guardish = Math.min(top, N - 1 - top) <= 3;
      flip = guardish ? !atLow : false;
      const guard = (Math.min(top, N - 1 - top) + 0.5) / N;
      t = guardish ? Math.max(0.05, guard * 0.5) : 0.1;
    } else if (kind === "axe" || kind === "hammer" || kind === "staff" || kind === "spear") {
      flip = atLow;                                        // the head is the wide end: the handle is the other one
      t = { axe: 0.2, hammer: 0.2, staff: 0.42, spear: 0.38 }[kind];
    } else { flip = false; t = 0.5; }
    S = { L, M, T, dim, c, min: box.min.clone(), flip, t };
    WEAPON_SHAPE.set(id, S);
  }
  const unit = (a) => new THREE.Vector3(a === "x" ? 1 : 0, a === "y" ? 1 : 0, a === "z" ? 1 : 0);
  const along = unit(S.L).multiplyScalar(S.flip ? -1 : 1), across = unit(S.M), third = new THREE.Vector3().crossVectors(across, along);
  // model axes -> holder axes (along -> +Y, across -> +X)
  const basis = new THREE.Matrix4().makeBasis(across, along, third);
  const scale = size / Math.max(1e-6, S.dim[S.L]);
  const gripModel = S.c.clone();
  gripModel[S.L] = S.flip ? S.min[S.L] + S.dim[S.L] * (1 - S.t) : S.min[S.L] + S.dim[S.L] * S.t;
  const wrap = new THREE.Group();
  root.quaternion.setFromRotationMatrix(basis).invert();
  root.scale.setScalar(scale);
  root.position.copy(gripModel.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(), root.quaternion, new THREE.Vector3(scale, scale, scale))).negate());
  wrap.add(root);
  return wrap;
}

export { placeWeapon as __placeWeapon };          // for the weapon check page / tests

/** the attack animation for each weapon (everyone fights in their own way) */
export const WEAPON_ATTACK = { sword: "attack", dagger: "stab", bow: "shoot", staff: "staff_strike", spear: "thrust", hammer: "smash", axe: "chop", fists: "punch", shield: "shield_bash" };

export class Actor {
  static async create(world, info) {
    const a = new Actor(world, info);
    await a.load();
    return a;
  }

  constructor(world, info) {
    this.world = world;
    this.info = info;                 // {uid, name, model, parts, body, size, scale, team, kind, hp, max_hp ...}
    this.group = new THREE.Group();
    this.group.name = info.uid || info.id || info.name;
    this.pos = this.group.position;
    this.heading = 0;
    this.wantHeading = 0;
    this.path = [];
    this.speed = 0;
    this.maxSpeed = 3.2;
    this.combat = false;
    this.talking = 0;
    this.mood = "neutral";
  }

  async load() {
    const i = this.info;
    let body = i.body || "humanoid";
    let inst;
    try {
      inst = i.parts ? await A.modular(i.model, i.parts) : await A.instance(i.model || "vermeil");
    } catch (e) {
      console.warn("model failed, using a stand-in", i.model, e);
      inst = { root: standIn(), clips: [] };
      body = "blob";
    }
    this.model = inst.root;
    if (i.tint) A.tint(this.model, i.tint, 0.5);      // monster variants made from another rigged model (troll, vampire...)
    this.holder = new THREE.Group();          // the Animator offsets this (lunges, falls) - the group stays put
    this.holder.add(this.model);
    this.group.add(this.holder);
    let h = i.size || HEIGHT[body] || 1.6;
    if (i.model === "vermeil") h = 1.62;
    if (i.kind === "boss" && !i.size) h *= 2;
    if (i.scale && Array.isArray(i.scale)) h *= i.scale[0];
    else if (typeof i.scale === "number") h *= i.scale;
    const n = A.normalize(this.model, h);
    if (Array.isArray(i.scale) && i.scale[1] && i.scale[1] !== i.scale[0]) { this.model.scale.x *= i.scale[1] / i.scale[0]; this.model.scale.z *= i.scale[1] / i.scale[0]; }
    this.height = h;
    this.radius = Math.max(0.35, Math.min(2.5, Math.max(n.size.x, n.size.z) * 0.35));
    // flyers hover
    if (body === "flyer") this.model.position.y += h * 0.35;
    this.anim = new Animator(this.holder, inst.clips, { body, name: i.name, style: styleFor({ ...i, body }) });
    this.anim.height = h;
    this.body = body;
    this.findFace();
    if (PAINT_FACE?.test(i.model || "")) this.paintFace();
    // RPG / modular characters already hold their weapon in the model; everyone else (elves, orcs, demonkin...) gets
    // their equipped weapon - or their class's usual kit - in hand: rogue daggers, ranger bow, paladin sword + shield...
    // (a normal human with a class gets NO extra item - it would float next to the one in the model)
    const ownWeapon = /^(rpg_characters_|ultimate_modular_|pirate_kit_|zombie_apocalypse_kit_characters)/.test(i.model || "");
    if (!ownWeapon && (i.team === "party" || i.cls)) {
      const kit = CLASS_KIT[i.cls] || {};
      const main = i.weapon_model || kit.main, off = i.offhand_model || kit.off;
      if (main) this.attachWeapon(main);
      if (off) this.attachWeapon(off, "left");
      this.weaponKind = weaponKind(main);
    } else if (ownWeapon) this.weaponKind = weaponKind(i.weapon_model || (CLASS_KIT[i.cls] || {}).main);
    else if (i.weapon_model) { this.attachWeapon(i.weapon_model); this.weaponKind = weaponKind(i.weapon_model); }
    if (this.weaponKind === "bow" && this.body === "humanoid") this.addQuiver();       // archers carry their arrows on the back
    this.world.scene.add(this.group);
    this.makeLabel();
    if (i.model === "vermeil" && i.look) this.setLook(i.look);
    return this;
  }

  // ---------------- looks ----------------
  setLook({ outfit, hair } = {}) {
    // anime_girl.glb has several outfits/hairstyles as separate meshes: show one of each
    const parts = { outfit: {}, hair: {} };
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      let m = o.name.match(/^outfit[_-]?(\w+?)(?:[_.]\d+)?$/i); if (m) (parts.outfit[m[1].toLowerCase()] ||= []).push(o);
      m = o.name.match(/^hair[_-]?(\w+?)(?:[_.]\d+)?$/i); if (m) (parts.hair[m[1].toLowerCase()] ||= []).push(o);
    });
    const pick = (group, want, fb) => { const ks = Object.keys(group); if (!ks.length) return; const k = ks.includes(want) ? want : ks.includes(fb) ? fb : ks[0];
      for (const [kk, list] of Object.entries(group)) for (const m of list) m.visible = kk === k; };
    pick(parts.outfit, outfit, "mech"); pick(parts.hair, hair, "original");
  }

  /** put a weapon in a hand. Every rig's bones point different ways, so the grip is worked out from the body in its
      standing pose (where the arm points, which way the thumb and palm face) instead of trusting the bone's axes:
      the handle goes through the fist, swords/axes point out past the thumb, staffs and spears are held at the
      middle and stand upright, bows stand upright in the left hand, shields lie on the back of the hand facing out. */
  attachWeapon(id, side = "right") {
    const kind = weaponKind(id);
    const left = side === "left" || kind === "bow";
    const s = left ? "L" : "R";
    const B = this.anim.bones;
    const hand = B["hand" + s] || B["fore" + s];
    if (!hand || !A.urlOf(id)) return;
    const fist = B["hand" + s] ? null : gripPoint(this.model, hand, this.info.model);      // rigs without hand bones: the fist is the forearm's far end
    A.instance(id).then(async ({ root }) => {
      // measure in the standing (idle) pose, not the T-pose: monster rigs keep their arms out, people let them hang,
      // so "upright" and "forward" have to be judged where the arm really is
      for (let i = 0; i < 60 && (this.anim.frames || 0) < 8 && !this.disposed; i++) await new Promise((r) => setTimeout(r, 50));
      if (this.disposed) return;
      const size = { dagger: 0.45, bow: 1.15, staff: 1.55, shield: 0.7, spear: 1.7, hammer: 0.85, axe: 0.85, sword: 0.95, book: 0.32 }[kind] || 0.9;
      const holder = new THREE.Group();
      holder.add(placeWeapon(root, id, kind, size));
      {
        this.group.updateMatrixWorld(true);
        const H = this.height || 1.7, W = new THREE.Vector3(), hq = new THREE.Quaternion();
        const bodyQ = this.holder.getWorldQuaternion(new THREE.Quaternion());
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyQ), up = new THREE.Vector3(0, 1, 0).applyQuaternion(bodyQ);
        // the wrist and the arm's direction (elbow -> wrist)
        const fore = B["fore" + s] || hand.parent;
        const wrist = fist ? hand.localToWorld(fist.clone()) : hand.getWorldPosition(new THREE.Vector3());
        const elbow = fore === hand ? hand.getWorldPosition(new THREE.Vector3()) : fore.getWorldPosition(new THREE.Vector3());
        const arm = wrist.clone().sub(elbow);
        if (arm.lengthSq() < 1e-8) arm.set(left ? 1 : -1, 0, 0).applyQuaternion(bodyQ);
        arm.normalize();
        // thumb: forward, square to the arm (palms face down in a T-pose). palm: the side the fingers close on
        let thumb = fwd.clone().addScaledVector(arm, -fwd.dot(arm));
        if (thumb.lengthSq() < 1e-4) thumb = up.clone().addScaledVector(arm, -up.dot(arm));
        thumb.normalize();
        const palm = new THREE.Vector3().crossVectors(arm, thumb).multiplyScalar(left ? 1 : -1).normalize();
        // the middle of the fist: past the wrist, a little toward the palm
        const P = fist ? wrist.clone() : wrist.clone().addScaledVector(arm, 0.045 * H).addScaledVector(palm, 0.018 * H);
        // which way the weapon's length points, and which way its flat side faces
        let along, across;
        if (kind === "shield") {          // upright on the outside of the forearm, facing out to the side
          along = up.clone(); across = fwd.clone().multiplyScalar(left ? -1 : 1);
          P.addScaledVector(palm, -0.05 * H).addScaledVector(arm, -0.06 * H);
        }
        else if (kind === "staff" || kind === "spear" || kind === "bow") {
          // stood upright beside the body (leaning a touch forward), whatever the arm is doing
          along = up.clone().addScaledVector(fwd, kind === "bow" ? 0.25 : 0.12).normalize();
          across = fwd.clone().addScaledVector(along, -fwd.dot(along)).normalize();      // a bow's string faces the archer
        }
        else { along = thumb.clone().addScaledVector(up, 0.55).normalize(); across = arm.clone().addScaledVector(along, -arm.dot(along)).normalize(); }
        const third = new THREE.Vector3().crossVectors(across, along);
        const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, along, third));
        hand.updateMatrixWorld(true);
        hand.getWorldQuaternion(hq); hand.getWorldScale(W);
        holder.quaternion.copy(hq.invert().multiply(want));
        holder.position.copy(hand.worldToLocal(P));
        holder.scale.setScalar(1 / Math.max(1e-4, W.x));
      }
      hand.add(holder);
      if (left) this.offhand = holder; else this.weapon = holder;
    }).catch((e) => console.warn("weapon", id, e));
  }

  /** a ranger's quiver full of arrows on the back (made here - the packs have no quiver) */
  addQuiver() {
    const B = this.anim.bones, back = B.chest || B.spine;
    if (!back || this.quiver) return;
    const H = this.height || 1.7, k = H / 1.75;
    const q = new THREE.Group();
    const leather = new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.85, flatShading: true });
    const strap = new THREE.MeshStandardMaterial({ color: 0x3d2414, roughness: 0.9 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.8 });
    const tip = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.4, flatShading: true });
    const feather = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.9, side: THREE.DoubleSide });
    const red = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.9, side: THREE.DoubleSide });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.5, 10, 1, true), leather);
    tube.material.side = THREE.DoubleSide;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.06, 10), leather); bottom.rotation.x = Math.PI / 2; bottom.position.y = -0.25;
    for (const y of [-0.2, 0.2]) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.073, 0.01, 4, 12), strap); b.rotation.x = Math.PI / 2; b.position.y = y; q.add(b); }
    q.add(tube, bottom);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, r = i ? 0.035 : 0, len = 0.62 + (i % 3) * 0.03;
      const ar = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 4), wood); shaft.position.y = len / 2 - 0.22; ar.add(shaft);
      for (let f = 0; f < 3; f++) {
        const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.09), i % 2 ? red : feather);
        fl.position.set(Math.cos(f * 2.1) * 0.012, len - 0.27, Math.sin(f * 2.1) * 0.012); fl.rotation.y = f * 2.1; ar.add(fl);
      }
      const nock = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 4), tip); nock.position.y = len - 0.215; nock.rotation.x = Math.PI; ar.add(nock);
      ar.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); ar.rotation.set((Math.random() - 0.5) * 0.12, 0, (Math.random() - 0.5) * 0.12);
      q.add(ar);
    }
    q.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    q.scale.setScalar(k);
    // across the back: find the back's surface by casting a ray at the chest from behind
    this.anim.atRest(() => {
      const bodyQ = this.holder.getWorldQuaternion(new THREE.Quaternion());
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(bodyQ);
      const c = back.getWorldPosition(new THREE.Vector3());
      const meshes = []; this.model.traverse((o) => { if (o.isMesh) meshes.push(o); });
      const rc = new THREE.Raycaster(c.clone().addScaledVector(fwd, -H), fwd.clone(), 0, H);
      const hit = rc.intersectObjects(meshes, false)[0];
      const P = hit ? hit.point.addScaledVector(fwd, -0.06 * k) : c.addScaledVector(fwd, -0.14 * k);
      P.y -= 0.02 * H;
      const t = new THREE.Object3D();
      t.position.copy(P);
      t.quaternion.copy(bodyQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, 0, -0.5)));   // tilted over the right shoulder
      t.scale.setScalar(k);
      this.model.parent.add(t); t.updateMatrixWorld(true);
      back.attach(t);                         // the same spot, now in the bone's own space
      q.position.copy(t.position); q.quaternion.copy(t.quaternion); q.scale.copy(t.scale);
      back.remove(t);
    });
    back.add(q);
    this.quiver = q;
  }

  // ---------------- picture face (Vermeil) ----------------
  findFace() {
    const mats = {};
    this.model.traverse((o) => { for (const m of [].concat(o.material || [])) if (/^(eyes|mouth)$/i.test(m?.name || "")) mats[m.name.toLowerCase()] = m; });
    if (!mats.eyes || !mats.mouth) return;
    const loader = new THREE.TextureLoader(), cache = {};
    const tex = (n) => cache[n] ||= loader.load(`../models/anime_girl_face/${n}.png`, (t) => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; });
    ["eyes_open", "eyes_closed", "eyes_half", "eyes_angry", "mouth_basic_normal", "mouth_basic_sad", "mouth_angry", "mouth_ooo", "mouth_eek",
     "mouth_open_smile_01", "mouth_open_smile_02", "mouth_smile_01", "mouth_smile_02"].forEach(tex);
    this.faceData = { mats, tex, cur: {}, blink: 2, mouthT: 0 };
  }

  setFace(part, name) {
    const F = this.faceData; if (!F) return;
    if (F.cur[part] === name) return;
    const t = F.tex(name); if (!t?.image) return;
    F.cur[part] = name;
    F.mats[part].map = t;
    if (F.mats[part].emissiveMap) F.mats[part].emissiveMap = t;
  }

  faceLife(dt) {
    if (this.painted) {
      const P = this.painted;
      P.blink -= dt; if (P.blink < -0.14) P.blink = 2 + Math.random() * 3.5;
      this.drawFace(this.anim.dead || P.blink < 0 ? "closed" : this.talking > 0 && Math.sin(performance.now() / 70) > 0 ? "talk" : "open");
    }
    if (this.talking > 0) this.talking = Math.max(0, this.talking - dt);
    this.anim.talking = this.talking > 0;
    const F = this.faceData; if (!F) return;
    const mood = this.anim.dead ? "dead" : this.mood;
    F.blink -= dt;
    if (F.blink < -0.15) F.blink = 2 + Math.random() * 3;
    const eyes = mood === "dead" ? "eyes_closed" : mood === "angry" || mood === "determined" ? "eyes_angry" : mood === "worried" || mood === "sad" ? "eyes_half" :
      mood === "happy" || mood === "smug" ? (F.blink < 0 ? "eyes_closed" : "eyes_open") : (F.blink < 0 ? "eyes_closed" : "eyes_open");
    this.setFace("eyes", F.blink < 0 && mood !== "dead" ? "eyes_closed" : eyes);
    let mouth = { happy: "mouth_smile_02", smug: "mouth_smile_01", excited: "mouth_open_smile_02", worried: "mouth_basic_sad", sad: "mouth_basic_sad",
      angry: "mouth_angry", determined: "mouth_basic_normal", curious: "mouth_ooo", annoyed: "mouth_basic_sad", dead: "mouth_basic_normal" }[mood] || "mouth_basic_normal";
    if (this.talking > 0) {
      F.mouthT -= dt;
      if (F.mouthT <= 0) { F.mouthT = 0.08 + Math.random() * 0.06; F.talkShape = ["mouth_open_smile_01", "mouth_ooo", "mouth_eek", mouth][Math.floor(Math.random() * 4)]; }
      mouth = F.talkShape || mouth;
    }
    this.setFace("mouth", mouth);
  }

  say(seconds, mood) {
    this.talking = seconds;              // the animator plays this species' talking gestures while > 0
    if (mood) this.mood = mood;
    this.path = [];                      // someone who is speaking stands still (and faces whoever they talk to)
  }

  // ---------------- painted face (models whose texture has no eyes or mouth) ----------------
  paintFace() {
    const head = this.anim.bones.head; if (!head) return;
    this.model.updateMatrixWorld(true);
    const meshes = []; this.model.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const rc = new THREE.Raycaster();
    const hp = head.getWorldPosition(new THREE.Vector3());
    const H = this.height;
    // top of the head: cast down from above
    rc.set(hp.clone().add(new THREE.Vector3(0, H, 0)), new THREE.Vector3(0, -1, 0));
    const top = rc.intersectObjects(meshes, false).find((x) => x.point.y > hp.y);
    const topY = top ? top.point.y : hp.y + H * 0.14;
    const eyeY = hp.y + (topY - hp.y) * 0.5;
    rc.set(new THREE.Vector3(hp.x, eyeY, hp.z + H), new THREE.Vector3(0, 0, -1));
    const front = rc.intersectObjects(meshes, false)[0];
    if (!front) return;
    const w = Math.max(0.05, (topY - hp.y) * 0.95);
    const geo = new THREE.PlaneGeometry(w, w, 8, 1);
    const pos = geo.attributes.position, r = w * 0.75;        // bend around the head
    for (let k = 0; k < pos.count; k++) { const x = pos.getX(k); pos.setZ(k, -(x * x) / (2 * r)); }
    geo.computeVertexNormals();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.8 });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(front.point).add(new THREE.Vector3(0, -w * 0.08, w * 0.02));
    m.renderOrder = 2;
    this.model.parent.attach(m);
    head.attach(m);
    this.painted = { canvas, tex, ctx: canvas.getContext("2d"), blink: 2 + Math.random() * 3, state: "" };
    this.drawFace("open");
  }

  drawFace(state) {
    const P = this.painted; if (!P || P.state === state) return;
    P.state = state;
    const c = P.ctx; c.clearRect(0, 0, 256, 256);
    c.lineCap = "round";
    for (const sx of [-1, 1]) {
      const x = 128 + sx * 46, y = 118;
      c.strokeStyle = "rgba(60,35,25,.9)"; c.lineWidth = 9;                     // brows
      c.beginPath(); c.moveTo(x - 22, y - 38 + (this.mood === "angry" ? sx * -8 : 0)); c.lineTo(x + 20, y - 42 - (this.mood === "angry" ? sx * -8 : 0)); c.stroke();
      if (state === "closed") { c.strokeStyle = "#2a1a14"; c.lineWidth = 7; c.beginPath(); c.moveTo(x - 16, y + 2); c.quadraticCurveTo(x, y + 10, x + 16, y + 2); c.stroke(); continue; }
      c.fillStyle = "#fbfbf8"; c.beginPath(); c.ellipse(x, y, 19, 22, 0, 0, Math.PI * 2); c.fill();     // eye white
      c.fillStyle = "#3b2a1e"; c.beginPath(); c.ellipse(x + 1, y + 3, 12, 15, 0, 0, Math.PI * 2); c.fill();  // iris
      c.fillStyle = "#0d0907"; c.beginPath(); c.ellipse(x + 1, y + 4, 6, 8, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(x + 6, y - 4, 4, 0, Math.PI * 2); c.fill();          // shine
    }
    c.strokeStyle = "rgba(110,45,40,.85)"; c.lineWidth = 6;                     // mouth
    c.beginPath();
    if (state === "talk") { c.fillStyle = "rgba(90,30,30,.9)"; c.ellipse(128, 196, 13, 9, 0, 0, Math.PI * 2); c.fill(); }
    else if (this.mood === "happy" || this.mood === "excited") { c.moveTo(108, 190); c.quadraticCurveTo(128, 206, 148, 190); c.stroke(); }
    else { c.moveTo(114, 196); c.lineTo(142, 196); c.stroke(); }
    P.tex.needsUpdate = true;
  }

  // ---------------- hit feedback: a bright flash and a shove ----------------
  flash(color = 0xffffff, power = 1) {
    if (!this._mats) {
      this._mats = [];
      this.model.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.emissive) this._mats.push([m, m.emissive.clone(), m.emissiveIntensity]); });
    }
    this._flashC = new THREE.Color(color);
    this._flash = power;
  }

  knock(fromPos, amount = 0.35) {
    const d = this.pos.clone().sub(fromPos).setY(0);
    if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
    this._knock = { dir: d.normalize(), v: amount };
  }

  /** which creature sounds this character makes (see audio.js CREATURE) */
  soundProfile() {
    const i = this.info;
    if (i.sound) return i.sound;
    if (i.model === "vermeil") return "vermeil";
    const m = String(i.model || "");
    for (const [rx, prof] of [[/cow|bull/, "cow"], [/horse|donkey|pony/, "horse"], [/sheep|lamb/, "sheep"], [/pig/, "pig"], [/chicken|hen\b|rooster/, "chicken"], [/duck/, "duck"]]) if (rx.test(m)) return prof;
    if (i.species && i.species !== "human") return i.species;
    const female = i.gender === "female" || /female|women|witch|_anne|_lis/.test(i.model || "");
    if (i.team === "enemy") return { quadruped: "beast", flyer: "bat", blob: "slime", serpent: "reptile" }[this.body] || "humanoid";
    return female ? "human_f" : "human";
  }

  // ---------------- label ----------------
  makeLabel() {
    const el = document.createElement("div");
    const i = this.info;
    el.className = `lbl ${i.team === "enemy" ? "enemy" : i.team === "party" ? "ally" : "npc"} ${i.kind === "boss" ? "boss" : ""}`;
    el.innerHTML = `<div class="stt"></div><div class="n"></div><div class="hpb"><i></i></div>`;
    el.querySelector(".n").textContent = i.name || "";
    document.getElementById("labels").appendChild(el);
    this.label = el;
    this.showHp(i.team === "enemy" || this.world.inCombat);
    this.setHp(i.hp, i.max_hp);
  }

  showHp(on) { this.label.querySelector(".hpb").style.display = on && this.info.max_hp ? "" : "none"; }

  setHp(hp, max) {
    if (max == null) return;
    this.info.hp = hp; this.info.max_hp = max;
    this.label.querySelector(".hpb i").style.width = `${Math.max(0, Math.min(100, (hp / max) * 100))}%`;
    this.label.querySelector(".hpb").title = `${hp} / ${max}`;
  }

  setStatuses(list) { this.label.querySelector(".stt").textContent = (list || []).map((s) => s.icon).join(""); }

  // ---------------- moving ----------------
  goTo(x, z, { run = false, near = 0 } = {}) {
    const path = this.world.nav ? this.world.nav.find(this.pos.x, this.pos.z, x, z, near) : [[x, z]];
    this.path = path || [];
    this.maxSpeed = run ? 5.6 : 2.6;
    return this.path.length > 0;
  }

  stop() { this.path = []; }

  face(x, z) { this.wantHeading = Math.atan2(x - this.pos.x, z - this.pos.z); }

  update(dt) {
    // follow the path
    let moving = false;
    if (this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) this.path.shift();
      else {
        moving = true;
        this.wantHeading = Math.atan2(dx, dz);
        const turnFirst = Math.abs(angDiff(this.heading, this.wantHeading)) > 1.6;
        this.speed = Math.min(this.maxSpeed, this.speed + dt * 8) * (turnFirst ? 0.4 : 1);
        const step = Math.min(d, this.speed * dt);
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
      }
    }
    if (!moving) this.speed = Math.max(0, this.speed - dt * 10);
    // turn smoothly toward where we want to face
    this.heading += angDiff(this.heading, this.wantHeading) * Math.min(1, dt * 8);
    this.group.rotation.y = this.heading;
    if (this.world.ground) this.pos.y = this.world.ground(this.pos.x, this.pos.z) + (this.rideLift || 0);
    this.anim.combat = this.combat;
    if (!this.anim.dead) this.anim.setMove(this.speed, this.combat);
    this.anim.update(dt, this.group.quaternion);
    if (this.sink) this.holder.position.y -= this.sink;
    if (this._knock && this._knock.v > 0.002) {         // shoved back, then spring home
      this.holder.position.addScaledVector(this._knock.dir, this._knock.v);
      this._knock.v *= Math.max(0, 1 - dt * 9);
    }
    if (this._flash > 0 && this._mats) {
      this._flash = Math.max(0, this._flash - dt * 5);
      for (const [m, e0, i0] of this._mats) { m.emissive.copy(e0).lerp(this._flashC, Math.min(1, this._flash)); m.emissiveIntensity = i0 + this._flash * 1.5; }
    }
    // footsteps
    if (this.speed > 0.4 && this.onStep) {
      this._stepAcc = (this._stepAcc || 0) + this.speed * dt;
      const stride = (this.body === "humanoid" ? 0.75 : 1.1) * Math.max(0.6, this.height / 1.75);
      if (this._stepAcc > stride) { this._stepAcc = 0; this.onStep(this); }
    }
    this.faceLife(dt);
  }

  labelPos() { return this.pos.clone().add(new THREE.Vector3(0, this.height * (this.body === "flyer" ? 1.45 : 1.12) + 0.25, 0)); }

  dispose() {
    this.disposed = true;
    this.world.scene.remove(this.group);
    this.label?.remove();
    this.anim?.mixer.stopAllAction();
  }
}

export function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function standIn() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 8), new THREE.MeshStandardMaterial({ color: 0x8899aa, flatShading: true }));
  m.position.y = 0.8;
  g.add(m);
  return g;
}
