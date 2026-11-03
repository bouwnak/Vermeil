// water.js - where the farm's water comes from. The water tower is the source: it slowly fills the barrel piped in beside it, faster in the rain.
// Sprinklers draw their morning water from the barrels, and the watering can is filled from one (or straight from the sea or a pond). Whatever you take, it gives back over time.
import { CATALOG, SECONDS_PER_MINUTE } from "./data.js";
import { popup } from "./ui.js";

const CAP = 120, CAN = 20, PER_HOUR = 10, SPRINKLER = 6;

export function makeWater(G) {
  const s = G.s, W = { CAP, CAN };
  s.water ||= {};
  s.can ??= CAN;
  const barrels = () => G.build.of("waterbarrel");
  const tower = (t) => G.build.of("watertower").find((w) => Math.hypot(w.p.x - t.p.x, w.p.z - t.p.z) < 6);
  const level = (t) => s.water[t.p.id] ?? CAP / 2;
  /** a barrel as it is now: { level, cap, filling } */
  W.at = (t) => ({ level: level(t), cap: CAP, filling: !!tower(t) && level(t) < CAP });
  W.total = () => barrels().reduce((n, t) => n + level(t), 0);
  /** take water from the barrels, fullest first. all: only if there's that much. -> how much came */
  W.draw = (n, all = false) => {
    if (all && W.total() < n) return 0;
    let got = 0;
    for (const t of barrels().sort((a, b) => level(b) - level(a))) { const take = Math.min(n - got, level(t)); s.water[t.p.id] = level(t) - take; got += take; if (got >= n) break; }
    return got;
  };
  /** the tower keeps topping its barrel up, by the hour of game time */
  W.tick = (dt) => {
    if (G.paused || G.cheat?.stopTime) return;
    const rate = PER_HOUR / 60 * (dt / SECONDS_PER_MINUTE) * (/rain|storm|heavy/.test(s.weather) ? 2 : 1);
    for (const t of barrels()) if (tower(t)) s.water[t.p.id] = Math.min(CAP, level(t) + rate);
  };
  /** fill the can from a barrel: it drains by what the can takes */
  W.fillCan = (t) => {
    const need = CAN - s.can;
    if (!need) return popup(`The can is full. The barrel is ${Math.round(level(t) / CAP * 100)}% full`);
    const take = Math.min(need, level(t));
    if (take < 1) return popup("The barrel is empty. The water tower is filling it");
    s.water[t.p.id] = level(t) - take; s.can += Math.floor(take);
    G.sfx("water"); G.vfx.burst("water", t.p.x, t.group.position.y + 1.3, t.p.z, 0.8);
    popup(`Filled the watering can (${s.can}/${CAN})`, "good");
  };
  /** at the shore or a pond the can fills for nothing */
  W.fillFree = () => { if (s.can >= CAN) return false; s.can = CAN; G.sfx("water"); popup(`Filled the watering can (${CAN}/${CAN})`, "good"); return true; };
  /** the sprinklers' morning: each one needs its share from the barrels, or it stays dry */
  W.sprinklers = () => {
    const spray = (s.placed || []).filter((p) => CATALOG[p.type]?.sprinkle), dry = [];
    for (const sp of spray) if (!W.draw(SPRINKLER, true)) dry.push(sp);
    if (dry.length && spray.length) popup(dry.length === spray.length ? "The sprinklers are dry: the water barrel is empty" : `${dry.length} sprinkler${dry.length > 1 ? "s" : ""} went dry: not enough in the barrel`);
    return spray.filter((sp) => !dry.includes(sp));
  };
  return W;
}
