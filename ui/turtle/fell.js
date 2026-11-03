// fell.js - what happens to a tree, a stump or a rock as you work at it. Each blow shakes it (a tree sways and absorbs the axe, a rock jolts and
// cracks a little more, chips flying). On the last blow a tree tips over and falls with gravity, a stump or log splits into pieces, a rock breaks
// apart, and then it all goes up in a puff of dust: only then do you get what it gives.
import * as THREE from "three";

const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4(), q = new THREE.Quaternion(), pivot = new THREE.Vector3(), sc = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

export function makeFell(G) {
  const F = { live: [] };
  /** the instance's own matrices, the first time anything is done to it */
  const base = (rec) => rec.base ||= rec.insts.map((inst) => { inst.getMatrixAt(rec.i, m0); return m0.clone(); });
  /** sets every part of the instance to its rest matrix turned by `rot` about its foot, and scaled */
  const pose = (rec, rot, s = 1, lift = 0) => {
    const b = base(rec);
    rec.insts.forEach((inst, k) => {
      pivot.set(rec.x, rec.L.land.ground(rec.x, rec.z), rec.z);                  // its foot, in its turtle's own space (where the instances live)
      m1.compose(pivot.clone().add(new THREE.Vector3(0, lift, 0)), rot, sc.set(s, s, s)).multiply(m0.makeTranslation(-pivot.x, -pivot.y, -pivot.z)).multiply(b[k]);
      inst.setMatrixAt(rec.i, m1); inst.instanceMatrix.needsUpdate = true;
    });
  };
  const world = (rec) => { const [x, z] = rec.L.world(rec.x, rec.z); return new THREE.Vector3(x, rec.L.land.ground(rec.x, rec.z), z); };

  /** one blow: the tree sways away from you and back, a rock jolts and settles a little lower, cracked */
  F.hit = (rec, from) => {
    const at = world(rec), away = at.clone().sub(from).setY(0).normalize(), axis = new THREE.Vector3(away.z, 0, -away.x);
    rec.cracks = (rec.cracks || 0) + 1;
    F.live.push({ rec, t: 0, len: rec.node === "tree" && !/stump|log/.test(rec.key) ? 0.9 : 0.35, kind: "wobble", axis, big: rec.node === "tree" && !/stump|log/.test(rec.key) });
    if (rec.node === "rock") { G.vfx.burst("stone", at.x, at.y + 0.6, at.z, 0.7); G.vfx.burst("dust", at.x, at.y + 0.3, at.z, 0.3); }
    else G.vfx.burst("wood", at.x, at.y + 1, at.z, 0.6);
  };
  /** the last blow. done() is called when it has gone, to hand over what it gives */
  F.finish = (rec, from, done) => {
    const at = world(rec), away = at.clone().sub(from).setY(0).normalize(), tree = rec.node === "tree" && !/stump|log/.test(rec.key);
    if (tree) { F.live.push({ rec, t: 0, kind: "fall", axis: new THREE.Vector3(away.z, 0, -away.x), a: 0, v: 0.25, at, away, done }); return; }
    // a stump, a log or a rock: it breaks into pieces that fly apart and tumble, then vanish in a puff
    pose(rec, q.identity(), 0.0001);
    const wood = rec.node === "tree", n = wood ? 5 : 6, mat = new THREE.MeshStandardMaterial({ color: wood ? 0x8a5a32 : 0x9a968c, flatShading: true, roughness: 0.9 }), end = new THREE.MeshStandardMaterial({ color: 0xd9b27a, flatShading: true });
    const bits = [...Array(n)].map((_, i) => {
      const g = wood ? new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 6), [mat, end, end]) : new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + Math.random() * 0.1, 0), mat);
      const a = i / n * Math.PI * 2 + Math.random() * 0.5;
      g.position.copy(at).add(new THREE.Vector3(Math.cos(a) * 0.2, 0.5, Math.sin(a) * 0.2)); g.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); g.castShadow = true;
      G.scene.add(g);
      return { g, v: new THREE.Vector3(Math.cos(a) * (1.5 + Math.random()), 3 + Math.random() * 2, Math.sin(a) * (1.5 + Math.random())), spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) };
    });
    G.vfx.burst(wood ? "wood" : "stone", at.x, at.y + 0.6, at.z, 1.5);
    F.live.push({ rec, t: 0, kind: "pieces", bits, at, done });
  };
  /** pulling something up by hand: it shrinks into the ground over `len` seconds */
  F.pull = (rec, len, done) => F.live.push({ rec, t: 0, len, kind: "pull", done });

  F.tick = (dt) => {
    for (const a of [...F.live]) {
      a.t += dt;
      if (a.kind === "wobble") {
        const k = Math.max(0, 1 - a.t / a.len);
        if (a.big) pose(a.rec, q.setFromAxisAngle(a.axis, Math.sin(a.t * 14) * 0.12 * k));                       // a tree takes the blow and sways
        else pose(a.rec, q.setFromAxisAngle(Y, Math.sin(a.t * 40) * 0.05 * k), 1 - Math.min(4, a.rec.cracks) * 0.04, 0);   // a rock jolts, each crack a little smaller
        if (a.t >= a.len) F.live.splice(F.live.indexOf(a), 1);
      } else if (a.kind === "fall") {
        a.v += dt * 2.6; a.a = Math.min(Math.PI / 2, a.a + a.v * dt);           // over it goes, faster and faster
        pose(a.rec, q.setFromAxisAngle(a.axis, a.a));
        if (a.a >= Math.PI / 2 && !a.landed) {
          a.landed = a.t; G.sfx("thud");
          const tip = a.at.clone().addScaledVector(a.away, 3);
          G.vfx.burst("leaf", tip.x, tip.y + 0.5, tip.z, 2); G.vfx.burst("dust", tip.x, tip.y + 0.2, tip.z, 1.5);
        }
        if (a.landed && a.t - a.landed > 0.5) { const mid = a.at.clone().addScaledVector(a.away, 2.5); G.vfx.burst("cloud", mid.x, mid.y + 0.6, mid.z, 1.6); G.sfx("poof"); pose(a.rec, q.identity()); a.rec.base = null; a.done(); F.live.splice(F.live.indexOf(a), 1); }
      } else if (a.kind === "pieces") {
        for (const b of a.bits) { b.v.y -= 12 * dt; b.g.position.addScaledVector(b.v, dt); if (b.g.position.y < a.at.y + 0.12) { b.g.position.y = a.at.y + 0.12; b.v.multiplyScalar(0.4); b.v.y = Math.abs(b.v.y) * 0.3; } b.g.rotation.x += b.spin.x * dt * (b.v.lengthSq() > 0.3 ? 1 : 0); b.g.rotation.z += b.spin.z * dt * (b.v.lengthSq() > 0.3 ? 1 : 0); }
        if (a.t > 1.1) {
          for (const b of a.bits) { G.vfx.burst("cloud", b.g.position.x, b.g.position.y + 0.2, b.g.position.z, 0.4); G.scene.remove(b.g); b.g.geometry.dispose(); }
          G.sfx("poof"); pose(a.rec, q.identity()); a.rec.base = null; a.done(); F.live.splice(F.live.indexOf(a), 1);
        }
      } else if (a.kind === "pull") {
        const k = Math.min(1, a.t / a.len);
        pose(a.rec, q.setFromAxisAngle(Y, Math.sin(a.t * 18) * 0.2 * (1 - k)), Math.max(0.0001, 1 - k * k), Math.sin(a.t * 9) * 0.03);
        if (a.t >= a.len) { pose(a.rec, q.identity()); a.rec.base = null; a.done(); F.live.splice(F.live.indexOf(a), 1); }
      }
    }
  };
  return F;
}
