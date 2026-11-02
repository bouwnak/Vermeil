// sail.js - your boat: mended at the dock, sailed anywhere, tied up at any shore. Also the ferry bell, and the things that float by.
import * as THREE from "three";
import { BOAT, FERRY, FISH_PACK } from "./data.js";
import { prop } from "./assets.js";
import { DOCK, detail, groundAt } from "./world.js";
import { popup } from "./ui.js";

const AT_DOCK = [DOCK.x[0] + 18, 7.6];
export async function makeSail(G) {
  const s = G.s, holder = new THREE.Group(), S = { holder };
  await prop(`${FISH_PACK}Boat.glb`, holder, { height: 2.2, ry: Math.PI / 2 });
  G.scene.add(holder);
  s.boatAt ||= [...AT_DOCK];
  const crates = [];
  for (let i = 0; i < 7; i++) { const c = await prop(`${FISH_PACK}Boat.glb`, G.scene, { height: 0.01 }); if (c) G.scene.remove(c); const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 1.2), new THREE.MeshStandardMaterial({ color: 0xa8743e, flatShading: true })); m.castShadow = true; G.scene.add(m); crates.push({ m, x: 0, z: 0, got: true }); }
  S.scatter = () => { const day = s.day; crates.forEach((c, i) => { const a = (day * 2.3 + i * 1.9) % 6.28, r = 260 + (i * 97 + day * 31) % 520; c.x = Math.cos(a) * r; c.z = Math.sin(a) * r; c.got = groundAt(G, c.x, c.z).on !== "sea"; }); };
  S.scatter();
  S.near = () => Math.hypot(holder.position.x - G.player.pos.x, holder.position.z - G.player.pos.z) < 7.5;
  S.mend = () => {
    const c = BOAT.cost;
    if (s.money < c.money || (s.inv.plank || 0) < c.plank || (s.inv.rope || 0) < c.rope) return G.talk.say("Vermeil", [`The hull's sound. It wants ${c.plank} planks, ${c.rope} rope and ${c.money} shells. Planks and rope come from a workbench.`]);
    s.money -= c.money; G.add("plank", -c.plank); G.add("rope", -c.rope); s.flags.boat = true;
    G.sfx("fanfare"); G.vfx.burst("spark", holder.position.x, 2, holder.position.z, 2); popup("The boat is yours", "good"); G.moment("boat");
  };
  S.board = () => {
    const P = G.player;
    P.sailing = true; P.mode = "sail"; P.riding = null;
    P.pos.set(holder.position.x, 0.4, holder.position.z);
    G.sfx("splash"); G.vfx.burst("splash", P.pos.x, 0.2, P.pos.z);
    G.moment("sea");
  };
  /** where the land starts near here, if it does */
  S.shore = (radius = 9) => {
    const P = G.player;
    for (let r = 2; r <= radius; r += 1) for (let a = 0; a < 6.3; a += 0.4) {
      const x = P.pos.x + Math.cos(a) * r, z = P.pos.z + Math.sin(a) * r, g = groundAt(G, x, z);
      if (g.on !== "sea" && g.y < 7) return { x, z, y: g.y, land: g.land };
    }
    return null;
  };
  S.landAt = (at) => {
    const P = G.player;
    s.boatAt = [P.pos.x, P.pos.z];
    P.sailing = false; P.mode = "";
    P.pos.set(at.x, at.y + 0.2, at.z);
    G.sfx("splash"); G.vfx.burst("splash", at.x, 0.2, at.z);
    if (at.land) G.arrive(at.land);
  };
  /** the ferry bell: to any turtle you've stood on, for a few shells */
  S.ferry = async (L) => {
    if (s.money < FERRY) return popup(`The ferry costs ${FERRY} shells`);
    s.money -= FERRY;
    await detail(G, L);
    G.fade(() => {
      const P = G.player;
      for (let t = 0, found = false; t < 6.3 && !found; t += 0.2) for (let k = 1.3; k > 0.4 && !found; k -= 0.02) {
        const [x, z] = L.world(Math.cos(t) * L.cfg.a * k, Math.sin(t) * L.cfg.b * k), g = groundAt(G, x, z);
        if (g.on === L.cfg.id && g.y < 6) { found = true; P.pos.set(x, g.y, z); P.sailing = false; P.mode = ""; s.boatAt = [x + Math.cos(t) * 8, z - Math.sin(t) * 8]; G.arrive(L); }
      }
      G.sfx("horn");
    });
  };
  S.tick = (dt, t) => {
    const P = G.player;
    if (P.sailing) {
      holder.position.copy(P.pos).setY(0.05 + Math.sin(t * 1.6) * 0.1);
      holder.rotation.y = P.heading;
      holder.rotation.z = Math.sin(t * 1.1) * 0.03;
      s.boatAt = [P.pos.x, P.pos.z];
      if (P.movingNow && Math.random() < dt * 24) G.vfx.burst("wake", P.pos.x - P.front.x * 2.6, 0.2, P.pos.z - P.front.z * 2.6);
    } else {
      holder.position.set(s.boatAt[0], s.flags.boat ? 0.05 + Math.sin(t * 1.2) * 0.08 : -0.18, s.boatAt[1]);
      holder.rotation.z = s.flags.boat ? 0 : 0.1;
    }
    for (const c of crates) {
      c.m.visible = !c.got;
      if (c.got) continue;
      c.m.position.set(c.x, 0.1 + Math.sin(t + c.x) * 0.16, c.z); c.m.rotation.y = t * 0.2;
      if (P.mode && Math.hypot(P.pos.x - c.x, P.pos.z - c.z) < 5) {
        c.got = true;
        const got = [["wood", 6], ["rope", 3], ["pearl", 1], ["ore", 3]][Math.floor(Math.random() * 4)];
        G.add(got[0], got[1]); s.money += 40; G.sfx("pick"); G.vfx.burst("splash", c.x, 0.4, c.z); popup(`A floating crate: ${got[1]} ${got[0]} and 40 shells`, "good");
      }
    }
  };
  return S;
}
