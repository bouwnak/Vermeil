// muscles.js - a small front + back body map that colours the muscles an exercise works:
// 1st (most targeted) green, 2nd yellow, 3rd light green, 4th blue. Everything else stays the body's dark grey.
const NS = "http://www.w3.org/2000/svg";
export const RANK_COLORS = ["#3ddc97", "#ffc83d", "#9be8a8", "#4ea1ff"];

// every drawable muscle: [view, shape, ...params]   (front figure centred at x=50, back figure at x=150)
const E = (cx, cy, rx, ry, rot = 0) => ({ t: "e", cx, cy, rx, ry, rot });
const P = (pts) => ({ t: "p", pts });
const mirror = (s, c) => s.t === "e" ? { ...s, cx: 2 * c - s.cx, rot: -s.rot } : { t: "p", pts: s.pts.map(([x, y]) => [2 * c - x, y]) };
const both = (c, s) => [s, mirror(s, c)];
const SHAPES = {
  "upper chest": both(50, E(42.5, 45.5, 7.5, 3.6, -8)),
  "lower chest": both(50, E(42.5, 52.5, 7.5, 4, 6)),
  "front delts": both(50, E(33, 43, 4.6, 6.2, 20)),
  "side delts": [...both(50, E(28.6, 45, 2.8, 6.5, 12)), ...both(150, E(128.6, 45, 2.8, 6.5, 12))],
  biceps: both(50, E(27.5, 62, 3.6, 8.5, 8)),
  forearms: [...both(50, E(24.5, 82, 3.2, 9.5, 10)), ...both(150, E(124.5, 82, 3.2, 9.5, 10))],
  abs: [P([[45, 57], [55, 57], [55.5, 86], [50, 89], [44.5, 86]])],
  obliques: both(50, E(40, 72, 3.4, 9, 6)),
  quads: both(50, E(43.5, 113, 5.8, 16, 4)),
  adductors: both(50, E(48.3, 106, 1.8, 9, -4)),
  calves: [...both(50, E(43.5, 150, 3.2, 11, 2)), ...both(150, E(143.5, 149, 4.6, 11, 2))],
  traps: [P([[42, 30], [58, 30], [55, 36], [45, 36]]), P([[140, 29], [160, 29], [157, 52], [150, 56], [143, 52]])],
  "rear delts": both(150, E(133, 43, 4.6, 6, -20)),
  "upper back": both(150, E(144.5, 50, 4, 6, 0)),
  lats: both(150, P([[137, 49], [143.5, 56], [145, 78], [141, 74], [136, 62]])),
  "lower back": [P([[145.5, 72], [154.5, 72], [154, 86], [146, 86]])],
  triceps: both(150, E(126.5, 61, 3.6, 8.5, -8)),
  glutes: both(150, E(144.5, 97, 6, 7, 0)),
  hamstrings: both(150, E(143.5, 120, 5.4, 14.5, 3)),
};
const ALIASES = { chest: ["upper chest", "lower chest"], core: ["abs", "obliques"], back: ["upper back", "lats"], shoulders: ["front delts", "side delts", "rear delts"],
  delts: ["front delts", "side delts", "rear delts"], legs: ["quads", "hamstrings"], arms: ["biceps", "triceps"], "middle back": ["upper back"], rhomboids: ["upper back"],
  "inner thighs": ["adductors"], hips: ["glutes"], "upper traps": ["traps"], "lats ": ["lats"] };

function silhouette(cx) {
  const s = (x) => cx - 50 + x;
  const path = [
    // head, neck, torso, arms, legs as soft rounded shapes
    `M${s(50)},8 a9,10 0 1,0 0.1,0 Z`,
    `M${s(46)},26 h8 v6 h-8 Z`,
    `M${s(36)},34 Q${s(50)},30 ${s(64)},34 L${s(68)},40 L${s(63)},88 Q${s(50)},94 ${s(37)},88 L${s(32)},40 Z`,
    `M${s(31)},38 Q${s(24)},40 ${s(23)},50 L${s(20)},92 L${s(25)},93 L${s(31)},58 Z`,
    `M${s(69)},38 Q${s(76)},40 ${s(77)},50 L${s(80)},92 L${s(75)},93 L${s(69)},58 Z`,
    `M${s(37)},88 L${s(49)},92 L${s(48)},170 L${s(40)},170 L${s(37)},128 Z`,
    `M${s(63)},88 L${s(51)},92 L${s(52)},170 L${s(60)},170 L${s(63)},128 Z`,
  ];
  return path.join(" ");
}

function shape(s) {
  if (s.t === "e") {
    const e = document.createElementNS(NS, "ellipse");
    e.setAttribute("cx", s.cx); e.setAttribute("cy", s.cy); e.setAttribute("rx", s.rx); e.setAttribute("ry", s.ry);
    if (s.rot) e.setAttribute("transform", `rotate(${s.rot} ${s.cx} ${s.cy})`);
    return e;
  }
  const p = document.createElementNS(NS, "polygon");
  p.setAttribute("points", s.pts.map((x) => x.join(",")).join(" "));
  return p;
}

/** muscles: ["upper chest", "front delts", "triceps"] (most targeted first) -> an <svg> body map */
export function muscleMap(muscles = [], { title = "" } = {}) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 200 176");
  svg.setAttribute("class", "muscle-map");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", muscles.length ? `Muscles worked: ${muscles.join(", ")}` : "Muscles worked: unknown");
  if (title) { const t = document.createElementNS(NS, "title"); t.textContent = title; svg.append(t); }
  for (const cx of [50, 150]) {
    const b = document.createElementNS(NS, "path");
    b.setAttribute("d", silhouette(cx)); b.setAttribute("class", "mm-body");
    svg.append(b);
  }
  const rank = {};
  muscles.slice(0, 4).forEach((m, i) => {
    const k = String(m).toLowerCase().trim();
    for (const name of ALIASES[k] || [k]) if (SHAPES[name] && rank[name] == null) rank[name] = i;
  });
  for (const [name, shapes] of Object.entries(SHAPES)) {
    for (const s of shapes) {
      const el = shape(s);
      el.setAttribute("class", "mm-muscle");
      if (rank[name] != null) { el.style.fill = RANK_COLORS[rank[name]]; el.classList.add("on"); }      // inline style beats the grey in style.css
      svg.append(el);
    }
  }
  for (const [x, label] of [[50, "front"], [150, "back"]]) {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", x); t.setAttribute("y", 175); t.setAttribute("class", "mm-label"); t.setAttribute("text-anchor", "middle");
    t.textContent = label; svg.append(t);
  }
  return svg;
}

/** a legend: coloured dots with the muscle names, in order */
export function muscleLegend(muscles = []) {
  const box = document.createElement("div");
  box.className = "muscle-legend";
  muscles.slice(0, 4).forEach((m, i) => {
    const s = document.createElement("span");
    s.innerHTML = `<i style="background:${RANK_COLORS[i]}"></i>`;
    s.append(document.createTextNode(m));
    box.append(s);
  });
  return box;
}
