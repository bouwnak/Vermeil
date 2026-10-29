// pets.js - the pets that roam the house. Pets have `pet: true`: they wander, come say hi to the character,
// and can be petted (click them).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const ROOM = { x0: -4.4, x1: 4.4, z0: -3.4, z1: 3.9 };     // where pets may walk (the main room)

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
function box(w, h, d, mat, x = 0, y = 0, z = 0, r = 0) {
  const m = new THREE.Mesh(r ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  return m;
}
function ball(r, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  return m;
}
function cone(r, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}


// ---------------- pets ----------------
// one builder for four-legged pets; legs are pivots so they can swing while walking
function quadruped(o) {
  const g = new THREE.Group(), body = new THREE.Group();
  const fur = std(o.fur, { roughness: 1 }), belly = std(o.belly ?? o.fur, { roughness: 1 }), dark = std(0x1b1b1b);
  const L = o.size;
  body.add(ball(0.5 * L, fur, 0, 0, 0, 0.75, 0.6, o.long ?? 1.1));
  body.add(ball(0.45 * L, belly, 0, -0.08 * L, 0.05 * L, 0.6, 0.45, 0.9));
  const head = new THREE.Group();
  head.add(ball(0.32 * L, fur, 0, 0, 0, 1, 0.95, 1));
  head.add(ball(0.16 * L, belly, 0, -0.08 * L, 0.24 * L, 1.1, 0.75, 1));          // snout
  head.add(ball(0.05 * L, dark, 0, -0.02 * L, 0.38 * L));                          // nose
  for (const s of [-1, 1]) {
    head.add(ball(0.05 * L, dark, s * 0.13 * L, 0.06 * L, 0.26 * L));               // eyes
    const ear = o.ears === "pointy" ? cone(0.1 * L, 0.24 * L, fur, s * 0.17 * L, 0.3 * L, 0, 4)
      : o.ears === "long" ? ball(0.09 * L, fur, s * 0.12 * L, 0.42 * L, -0.04 * L, 0.6, 2.2, 0.5)
      : o.ears === "gills" ? cone(0.06 * L, 0.3 * L, std(0xff5c8a), s * 0.3 * L, 0.05 * L, -0.05 * L, 6)
      : ball(0.11 * L, std(o.ear ?? o.fur), s * 0.27 * L, 0.06 * L, -0.02 * L, 0.5, 1.4, 0.8);
    if (o.ears === "gills") ear.rotation.z = -s * 1.2;
    ear.userData.ear = s; head.add(ear);
  }
  head.position.set(0, 0.32 * L, 0.55 * L * (o.long ?? 1.1));
  body.add(head);
  const tail = new THREE.Group();
  const t = o.tail === "fluffy" ? ball(0.16 * L, std(o.tailColor ?? o.fur), 0, 0.2 * L, -0.12 * L, 0.8, 1.6, 0.8)
    : o.tail === "puff" ? ball(0.12 * L, std(0xffffff), 0, 0, -0.04 * L)
    : cyl(0.04 * L, 0.06 * L, o.tail === "long" ? 0.6 * L : 0.35 * L, fur, 0, 0.15 * L, -0.12 * L, 8);
  if (o.tail !== "puff") t.rotation.x = -0.7;
  tail.add(t); tail.position.set(0, 0.12 * L, -0.5 * L * (o.long ?? 1.1)); body.add(tail);
  const legs = [];
  for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x * 0.2 * L, -0.12 * L, z * 0.32 * L * (o.long ?? 1.1));
    const leg = cyl(0.07 * L, 0.07 * L, o.legs * L, fur, 0, -o.legs * L / 2, 0, 8);
    pivot.add(leg, ball(0.08 * L, belly, 0, -o.legs * L, 0.02 * L, 1, 0.6, 1.2));
    legs.push(pivot); body.add(pivot);
  }
  body.position.y = (o.legs + 0.16) * L;
  g.add(body);
  return { group: g, body, head, tail, legs, hop: o.hop };
}

function bird() {
  const g = new THREE.Group(), body = new THREE.Group();
  const blue = std(0x4aa3df), yellow = std(0xffc93c);
  body.add(ball(0.09, blue, 0, 0, 0, 0.9, 0.9, 1.25));
  body.add(ball(0.065, std(0xe8f4ff), 0, -0.02, 0.03, 0.9, 0.8, 1));
  const head = new THREE.Group();
  head.add(ball(0.06, blue), cone(0.02, 0.06, yellow, 0, -0.005, 0.07));
  head.children[1].rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) head.add(ball(0.013, std(0x111111), s * 0.035, 0.015, 0.04));
  head.position.set(0, 0.07, 0.08); body.add(head);
  const wings = [-1, 1].map((s) => {
    const p = new THREE.Group(); p.position.set(s * 0.07, 0.02, 0);
    const w = box(0.14, 0.015, 0.1, blue, s * 0.07, 0, 0); p.add(w); body.add(p); return p;
  });
  const tail = box(0.06, 0.01, 0.1, blue, 0, 0.01, -0.13); tail.rotation.x = 0.3; body.add(tail);
  for (const s of [-1, 1]) body.add(cyl(0.006, 0.006, 0.06, yellow, s * 0.03, -0.1, 0.01, 4));
  body.position.y = 0.13;
  g.add(body);
  return { group: g, body, head, tail: null, legs: [], wings, flies: true };
}

const PETS = {
  petDog: { label: "Dog", make: () => quadruped({ size: 0.42, fur: 0xc98a4b, belly: 0xf1d9b5, ear: 0x7a4b25, ears: "floppy", tail: "short", legs: 0.42 }), speed: 0.9, says: "woof" },
  petCat: { label: "Cat", make: () => quadruped({ size: 0.34, fur: 0x5b5b66, belly: 0xd8d8de, ears: "pointy", tail: "long", legs: 0.42, long: 1.25 }), speed: 0.7, says: "meow" },
  petBird: { label: "Bird", make: bird, speed: 1.2, says: "tweet" },
  petBunny: { label: "Bunny", make: () => quadruped({ size: 0.3, fur: 0xf3efe9, belly: 0xffffff, ears: "long", tail: "puff", legs: 0.22, long: 0.9, hop: true }), speed: 0.8, says: "*thump*" },
  petRedPanda: { label: "Red panda (exotic)", make: () => quadruped({ size: 0.36, fur: 0xc5532a, belly: 0x2a1a14, ear: 0xffffff, ears: "pointy", tail: "fluffy", tailColor: 0xd9763e, legs: 0.3, long: 1.2 }), speed: 0.6, says: "squeak" },
  petAxolotl: { label: "Axolotl (exotic)", make: () => quadruped({ size: 0.26, fur: 0xffb3c7, belly: 0xffd6e0, ears: "gills", tail: "long", legs: 0.12, long: 1.5 }), speed: 0.35, says: "blub" },
};

const rand = (a, b) => a + Math.random() * (b - a);
const angleTo = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** A roaming pet: it idles, wanders, and every so often goes to the character to say hi. */
function petItem(key, P) {
  return {
    label: P.label, mount: "floor", pet: true, category: "pets",
    build(ctx) {
      const rig = P.make();
      const g = rig.group;
      const pos = new THREE.Vector3(ctx.spec.x ?? 0, 0, ctx.spec.z ?? 0);
      const st = { mode: "idle", until: rand(1, 3), target: null, yaw: ctx.spec.rot || 0, happy: 0, fly: 0, phase: Math.random() * 9 };
      const hearts = [];
      const heartMat = new THREE.MeshBasicMaterial({ color: 0xff5c8a, transparent: true });
      const say = (n = 3) => {
        for (let i = 0; i < n; i++) { const h = ball(0.035, heartMat.clone()); h.userData.k = -i * 0.25; g.add(h); hearts.push(h); }
        st.happy = 1.4;
      };
      const room = ctx._room;
      const pick = () => new THREE.Vector3(rand(ROOM.x0, ROOM.x1), 0, rand(ROOM.z0, ROOM.z1));
      ctx.update = (t, dt) => {
        const editing = room?.editing;
        if (editing) { pos.set(ctx.spec.x, 0, ctx.spec.z); st.mode = "idle"; st.until = t + 2; }   // hold still to be dragged
        const near = room?.charPos?.();
        const char = near ? near.clone().setY(0) : null;
        if (!editing) {
          if (st.mode === "idle" && t > st.until) {
            if (char && Math.random() < 0.35) { st.mode = "visit"; st.target = char.clone(); }
            else { st.mode = "walk"; st.target = pick(); }
          }
          if (st.mode === "visit" && char) {                     // follow her a bit, stop just in front
            const off = new THREE.Vector3(Math.sin(st.phase) * 0.7, 0, Math.cos(st.phase) * 0.7);
            st.target = char.clone().add(off);
          }
          if (st.target) {
            const to = st.target.clone().sub(pos); to.y = 0;
            const d = to.length();
            if (d < 0.08) {
              if (st.mode === "visit") { room?.onPetVisit?.(P.label, P.says); say(); st.phase += 2.1; }
              st.mode = "idle"; st.target = null; st.until = t + rand(2, 6);
            } else {
              st.yaw += angleTo(st.yaw, Math.atan2(to.x, to.z)) * Math.min(1, dt * 5);
              pos.addScaledVector(to.normalize(), Math.min(d, P.speed * dt));
            }
          }
          if (st.mode === "idle" && char && pos.distanceTo(char) < 1.4) st.yaw += angleTo(st.yaw, Math.atan2(char.x - pos.x, char.z - pos.z)) * Math.min(1, dt * 3);
        }
        const moving = !!st.target;
        g.position.set(pos.x, ctx.spec.y || 0, pos.z);
        g.rotation.y = st.yaw;
        const sp = moving ? 10 : 0;
        rig.legs.forEach((l, i) => { l.rotation.x = moving ? Math.sin(t * sp + (i % 3 === 0 ? 0 : Math.PI)) * 0.6 : l.rotation.x * 0.8; });
        if (rig.tail) rig.tail.rotation.y = Math.sin(t * (st.happy > 0 ? 18 : 4)) * (st.happy > 0 ? 0.7 : 0.25);
        rig.head.rotation.x = moving ? 0 : Math.sin(t * 0.8 + st.phase) * 0.12;
        rig.head.rotation.y = moving ? 0 : Math.sin(t * 0.5 + st.phase) * 0.35;
        if (rig.flies) {                                          // birds flap up while travelling, land when idle
          st.fly += ((moving ? 1 : 0) - st.fly) * Math.min(1, dt * 2);
          rig.body.position.y = 0.13 + st.fly * (1.2 + Math.sin(t * 2) * 0.1);
          for (const [i, w] of rig.wings.entries()) w.rotation.z = (i ? -1 : 1) * (moving ? Math.sin(t * 28) * 0.9 : 0.1);
        } else if (rig.hop && moving) rig.body.position.y = rig.body.userData.y0 + Math.abs(Math.sin(t * 7)) * 0.12;
        else if (st.happy > 0) rig.body.position.y = rig.body.userData.y0 + Math.abs(Math.sin(t * 9)) * 0.06;
        else rig.body.position.y = rig.body.userData.y0;
        st.happy = Math.max(0, st.happy - dt);
        for (let i = hearts.length - 1; i >= 0; i--) {              // little hearts float up and fade
          const h = hearts[i]; h.userData.k += dt;
          const k = Math.max(0, h.userData.k);
          h.position.set(Math.sin(k * 6 + i) * 0.08, 0.6 + k * 0.6, 0); h.material.opacity = 1 - k;
          if (h.userData.k > 1) { g.remove(h); h.material.dispose(); hearts.splice(i, 1); }
        }
      };
      rig.body.userData.y0 = rig.body.position.y;
      return { group: g, interact: { label: `${P.label}: pet them`, onClick: () => { say(4); return P.says; } } };
    },
  };
}

export const PET_CATALOG = Object.fromEntries(Object.entries(PETS).map(([k, P]) => [k, petItem(k, P)]));
