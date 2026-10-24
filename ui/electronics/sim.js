// sim.js - the Circuit Lab's simulator.
//  1. nets: which pins are connected (wires, breadboard strips, legs pushed into holes, parts' own links)
//  2. a DC/transient circuit solver (modified nodal analysis with Norton sources; diodes, transistors and the
//     motor driver are solved by repeating until they settle; capacitors charge over time)
//  3. an Arduino runner: a C++ sketch is translated into JavaScript (setup/loop, pinMode, digitalWrite/Read,
//     analogWrite/Read, delay, millis, Serial, Servo, tone, pulseIn, map...) and runs in real time.
import { PARTS, BOARDS, LED_COLORS, pinsOf, pinWorld } from "./parts.js";

// ====================================================================== nets
export function buildNets(project) {
  const parent = new Map();
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const add = (a) => { if (!parent.has(a)) parent.set(a, a); };
  const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const holes = new Map();                         // "x,y" -> breadboard pin key
  for (const part of project.parts) {
    const def = PARTS[part.type]; if (!def) continue;
    for (const p of pinsOf(part.type)) add(`${part.id}:${p.id}`);
    for (const g of def.groups?.() || []) for (let i = 1; i < g.length; i++) union(`${part.id}:${g[0]}`, `${part.id}:${g[i]}`);
    if (def.board && part.type.startsWith("breadboard")) for (const p of pinsOf(part.type)) holes.set(pinWorld(part, p).join(","), `${part.id}:${p.id}`);
  }
  for (const part of project.parts) {                // legs/pins sitting in a breadboard hole
    if (part.type.startsWith("breadboard") || !PARTS[part.type]) continue;
    for (const p of pinsOf(part.type)) {
      const h = holes.get(pinWorld(part, p).join(","));
      if (h) union(`${part.id}:${p.id}`, h);
    }
  }
  for (const w of project.wires) if (w.a && w.b) union(`${w.a.p}:${w.a.pin}`, `${w.b.p}:${w.b.pin}`);
  const netOf = new Map(), ids = new Map();
  for (const k of parent.keys()) { const r = find(k); if (!ids.has(r)) ids.set(r, ids.size); netOf.set(k, ids.get(r)); }
  return { netOf, count: ids.size, holes };
}

// ====================================================================== linear solver
function gauss(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let piv = c, best = Math.abs(A[c][c]);
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > best) { best = Math.abs(A[r][c]); piv = r; }
    if (best < 1e-18) continue;
    if (piv !== c) { [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]]; }
    const inv = 1 / A[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] * inv; if (!f) continue;
      const Ar = A[r], Ac = A[c];
      for (let k = c; k < n; k++) Ar[k] -= f * Ac[k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = Math.abs(A[r][r]) > 1e-18 ? s / A[r][r] : 0;
  }
  return x;
}

// ====================================================================== the simulator
export class Simulator {
  constructor(project, hooks = {}) {
    this.project = project;
    this.hooks = hooks;               // {serial(text), warn(text), sound(on, freq)}
    this.pins = {};                   // board pin states: "D13" -> {mode, level, pwm, tone}
    this.servo = {};                  // board pin -> angle
    this.pressed = new Set();         // part ids of buttons held down
    this.burnt = new Set();
    this.capV = {};                   // capacitor voltages (transient)
    this.diodeOn = {};
    this.st = {};                     // per part: what to show (bright, angle, reading...)
    this.V = [];
    this.motorAngle = {};
    this.warned = new Set();
    this.rebuild();
  }

  rebuild() {
    this.nets = buildNets(this.project);
    this.mcu = this.project.parts.find((p) => p.id === this.project.mcu) || this.project.parts.find((p) => BOARDS[p.type]);
    this.dirty = true;
  }

  warn(key, text) { if (!this.warned.has(key)) { this.warned.add(key); this.hooks.warn?.(text); } }
  net(part, pinId) { return this.nets.netOf.get(`${part.id}:${pinId}`); }
  pinState(part, id) { return part === this.mcu ? (this.pins[id] || { mode: "INPUT" }) : { mode: "INPUT" }; }

  /** voltage of a part's pin (after the last solve) */
  v(part, pinId) {
    if (!this.index) this.solve(0.001);
    const n = this.net(part, pinId); return n == null || n === this.ground ? 0 : this.V[this.index.get(n)] ?? 0;
  }

  /** PWM (analogWrite) and tone() pins switch on/off very fast: solve once with them HIGH and once LOW and blend the
      results by the duty cycle - so a 30% PWM LED glows at 30% brightness, like a real one looks. */
  solve(dt = 0.016) {
    const pwm = Object.values(this.pins).filter((p) => p.mode === "OUTPUT" && ((p.pwm != null && p.pwm > 0 && p.pwm < 255) || p.tone));
    if (!pwm.length) { this.phase = null; return this.solveOnce(dt); }
    const duty = pwm.reduce((s, p) => s + (p.tone ? 0.5 : p.pwm / 255), 0) / pwm.length;
    this.phase = 0; this.solveOnce(dt / 2); const low = this.st;
    this.phase = 1; this.solveOnce(dt / 2); const high = this.st;
    const mix = (a, b) => typeof b === "number" ? (a ?? 0) * (1 - duty) + b * duty : typeof b === "boolean" ? (duty >= 0.5 ? b : a ?? b) :
      Array.isArray(b) ? b.map((x, i) => mix(a?.[i], x)) : b;
    const st = {};
    for (const id of new Set([...Object.keys(low), ...Object.keys(high)])) {
      st[id] = {};
      for (const k of new Set([...Object.keys(low[id] || {}), ...Object.keys(high[id] || {})])) st[id][k] = mix(low[id]?.[k], high[id]?.[k]);
      if (st[id].reading != null && high[id]?.reading != null) st[id].reading = (parseFloat(low[id]?.reading || 0) * (1 - duty) + parseFloat(high[id].reading) * duty).toFixed(2);
    }
    this.st = st;
  }

  elements() {
    const ctx = { pinState: (p, id) => this.pinState(p, id), pressed: (p) => this.pressed.has(p.id), burnt: (p) => this.burnt.has(p.id), phase: this.phase };
    const out = [];
    for (const part of this.project.parts) {
      const def = PARTS[part.type];
      if (!def?.model) continue;
      for (const e of def.model(part, ctx)) out.push({ ...e, part });
    }
    return out;
  }

  /** one solve at time step dt (seconds) */
  solveOnce(dt = 0.016) {
    const els = this.elements();
    const N = (part, pin) => this.net(part, pin);
    // ground: the board's GND, else a battery's minus, else the first net
    let ground = this.mcu ? N(this.mcu, "GND") : null;
    if (ground == null) { const b = els.find((e) => e.t === "V" && e.src); if (b) ground = N(b.part, b.n); }
    this.ground = ground ?? 0;
    // only nets that something is attached to
    const used = new Set();
    for (const e of els) for (const k of ["a", "b", "p", "n", "k", "c", "e", "g", "d", "s"]) if (typeof e[k] === "string") { const n = N(e.part, e[k]); if (n != null) used.add(n); }
    for (const e of els) if (e.t === "L293") for (const p of pinsOf("l293d")) used.add(N(e.part, p.id));
    used.delete(this.ground);
    const index = new Map(); [...used].forEach((n, i) => index.set(n, i));
    this.index = index;
    const size = index.size;
    const I = (part, pin) => { const n = N(part, pin); return n == null || n === this.ground ? -1 : index.get(n); };
    let V = this.V.length === size ? this.V : new Array(size).fill(0);
    const vAt = (i) => (i < 0 ? 0 : V[i]);
    const npnOn = {}, mosOn = {}, drv = {}, needsOn = {};
    for (let iter = 0; iter < 40; iter++) {
      const A = Array.from({ length: size }, () => new Float64Array(size)), rhs = new Float64Array(size);
      const G = (i, j, g) => { if (i >= 0) A[i][i] += g; if (j >= 0) A[j][j] += g; if (i >= 0 && j >= 0) { A[i][j] -= g; A[j][i] -= g; } };
      const J = (i, j, cur) => { if (i >= 0) rhs[i] += cur; if (j >= 0) rhs[j] -= cur; };        // current cur flowing INTO i, out of j
      for (let i = 0; i < size; i++) A[i][i] += 1e-9;                                                // gmin: keeps floating nets solvable
      for (const e of els) {
        const key = `${e.part.id}:${e.id || ""}`;
        if (e.t === "R") G(I(e.part, e.a), I(e.part, e.b), 1 / e.r);
        else if (e.t === "SW") { if (e.on) G(I(e.part, e.a), I(e.part, e.b), 100); }
        else if (e.t === "V") {
          if (e.needs && !needsOn[key]) continue;          // e.g. the TMP36 only outputs when it's powered
          const g = 1 / e.r; G(I(e.part, e.p), I(e.part, e.n), g); J(I(e.part, e.p), I(e.part, e.n), e.v * g);
        } else if (e.t === "D") {
          if (this.diodeOn[key]) { const g = 1 / e.rs; G(I(e.part, e.a), I(e.part, e.k), g); J(I(e.part, e.a), I(e.part, e.k), e.vf * g); }
          else G(I(e.part, e.a), I(e.part, e.k), 1e-9);
        } else if (e.t === "C") {
          const g = e.c / dt, v0 = this.capV[key] || 0;
          G(I(e.part, e.p), I(e.part, e.n), g); J(I(e.part, e.p), I(e.part, e.n), g * v0);
        } else if (e.t === "NPN") {
          const ib = npnOn[key]?.ib || 0;
          if (npnOn[key]) { G(I(e.part, e.b), I(e.part, e.e), 1 / 300); J(I(e.part, e.b), I(e.part, e.e), 0.65 / 300); }
          if (ib > 2e-5) G(I(e.part, e.c), I(e.part, e.e), Math.min(1 / 0.3, (ib * 150) / 0.2));
        } else if (e.t === "NMOS") {
          if (mosOn[key]) G(I(e.part, e.d), I(e.part, e.s), 1 / 0.05);
        } else if (e.t === "L293") {
          const d = drv[key] || {};
          for (const [out, on, level] of [["OUT1", d.en1, d.in1], ["OUT2", d.en1, d.in2], ["OUT3", d.en2, d.in3], ["OUT4", d.en2, d.in4]]) {
            if (!on) continue;
            const g = 1 / 1.5, vs = level ? d.vcc2 : 0;
            G(I(e.part, out), I(e.part, "GND"), g); J(I(e.part, out), I(e.part, "GND"), vs * g);
          }
        }
      }
      const x = gauss(A.map((r) => Array.from(r)), Array.from(rhs));
      V = x;
      // update the non-linear parts; stop when nothing changes
      let changed = false;
      for (const e of els) {
        const key = `${e.part.id}:${e.id || ""}`;
        if (e.t === "V" && e.needs) {
          const [a, b, min] = e.needs, on = vAt(I(e.part, a)) - vAt(I(e.part, b)) >= min;
          if (on !== !!needsOn[key]) { needsOn[key] = on; changed = true; }
        }
        if (e.t === "D") {
          const vd = vAt(I(e.part, e.a)) - vAt(I(e.part, e.k));
          const on = this.diodeOn[key] ? (vd - e.vf) / e.rs > -1e-6 : vd > e.vf;
          if (on !== !!this.diodeOn[key]) { this.diodeOn[key] = on; changed = true; }
        } else if (e.t === "NPN") {
          const vbe = vAt(I(e.part, e.b)) - vAt(I(e.part, e.e));
          const on = vbe > 0.64;
          const ib = on ? Math.max(0, (vbe - 0.65) / 300) : 0;
          if (on !== !!npnOn[key] || Math.abs((npnOn[key]?.ib || 0) - ib) > 1e-6) { npnOn[key] = on ? { ib } : null; changed = true; }
        } else if (e.t === "NMOS") {
          const on = vAt(I(e.part, e.g)) - vAt(I(e.part, e.s)) > 2.2;
          if (on !== !!mosOn[key]) { mosOn[key] = on; changed = true; }
        } else if (e.t === "L293") {
          const vg = (p) => vAt(I(e.part, p)) - vAt(I(e.part, "GND"));
          const d = { en1: vg("EN1") > 2.3, en2: vg("EN2") > 2.3, in1: vg("IN1") > 2.3, in2: vg("IN2") > 2.3, in3: vg("IN3") > 2.3, in4: vg("IN4") > 2.3,
            vcc2: vg("VCC2") > 1 ? vg("VCC2") : 0 };
          if (vg("VCC1") < 4) d.en1 = d.en2 = false;
          if (JSON.stringify(d) !== JSON.stringify(drv[key])) { drv[key] = d; changed = true; }
        }
      }
      if (!changed) break;
    }
    this.V = V;
    this.dirty = false;
    this.afterSolve(els, dt, I);
  }

  current(e, I) {               // current through a 2-terminal element (a/p -> b/n/k)
    const v = (i) => (i < 0 ? 0 : this.V[i]);
    const key = `${e.part.id}:${e.id || ""}`;
    if (e.t === "R") return (v(I(e.part, e.a)) - v(I(e.part, e.b))) / e.r;
    if (e.t === "D") return this.diodeOn[key] ? (v(I(e.part, e.a)) - v(I(e.part, e.k)) - e.vf) / e.rs : 0;
    if (e.t === "V") return (e.v - (v(I(e.part, e.p)) - v(I(e.part, e.n)))) / e.r;
    return 0;
  }

  afterSolve(els, dt, I) {
    const st = {};
    const S = (p) => (st[p.id] ||= {});
    for (const e of els) {
      const key = `${e.part.id}:${e.id || ""}`;
      const type = e.part.type;
      if (e.t === "C") {
        const v = (I(e.part, e.p) < 0 ? 0 : this.V[I(e.part, e.p)]) - (I(e.part, e.n) < 0 ? 0 : this.V[I(e.part, e.n)]);
        this.capV[key] = v;
        if (e.c >= 1e-6 && v < -0.5) this.warn(`rev:${key}`, `⚠ ${e.part.id}: the electrolytic capacitor is backwards (its − leg must go to the lower voltage). Real ones can pop!`);
      }
      if (e.t === "D") {
        const i = this.current(e, I);
        if (type === "led") {
          S(e.part).bright = Math.max(0, i / 0.018); S(e.part).i = i;
          if (i > 0.05) { this.burnt.add(e.part.id); this.warn(`burn:${e.part.id}`, `💥 ${e.part.id} burned out: ${Math.round(i * 1000)} mA is far too much for an LED. Add a resistor (220-330 Ω for 5 V).`); this.dirty = true; }
        } else if (type === "rgbled") ((S(e.part).rgb ||= [0, 0, 0])[{ r: 0, g: 1, b: 2 }[e.id]] = Math.max(0, i / 0.015));
      }
      if (e.t === "R") {
        const i = this.current(e, I);
        if (type === "resistor") { S(e.part).power = i * i * e.r; S(e.part).i = i; if (i * i * e.r > 0.5) this.warn(`hot:${e.part.id}`, `🔥 ${e.part.id} is getting very hot (${(i * i * e.r).toFixed(2)} W, a normal resistor handles 0.25 W).`); }
        if (type === "motor") { const s = S(e.part); s.speed = i * e.r; this.motorAngle[e.part.id] = ((this.motorAngle[e.part.id] || 0) + s.speed * 360 * dt * 2) % 360; s.angle = this.motorAngle[e.part.id]; }
        if (type === "buzzer") S(e.part).sound = i * e.r > 1.5;
        if (type === "multimeter") {
          const s = S(e.part);
          s.reading = e.part.props.mode === "A" ? `${(i * 1000).toFixed(1)}` : (i * e.r).toFixed(2);
        }
        if (type === "servo" && e.id === "s") {
          const powered = i * e.r > 4;
          const sig = this.net(e.part, "SIG");
          let ang = this.st[e.part.id]?.servo ?? 90;
          if (powered && this.mcu) for (const [pin, a] of Object.entries(this.servo)) if (this.net(this.mcu, pin) === sig) ang = a;
          S(e.part).servo = ang;
        }
      }
      if (e.t === "V" && e.pinOut) {
        const i = this.current(e, I);
        if (Math.abs(i) > 0.04) this.warn(`pin:${e.pinOut}`, `⚠ Pin ${e.pinOut} is giving ${Math.round(Math.abs(i) * 1000)} mA - an Arduino pin is only safe up to 20 mA (40 mA max). Use a resistor or a transistor/driver.`);
      }
      if (e.t === "V" && e.src) {
        const i = this.current(e, I);
        if (i > (e.id === "5V" ? 0.5 : 2)) this.warn(`short:${key}`, `⚡ Short circuit? ${e.part.id} ${e.id === "5V" ? "5V pin" : "battery"} is giving ${i.toFixed(1)} A. Check for a wire from + straight to −.`);
      }
    }
    for (const p of this.project.parts) if (PARTS[p.type]?.press) S(p).pressed = this.pressed.has(p.id);
    for (const id of this.burnt) S({ id }).burnt = true;
    if (this.mcu) S(this.mcu).led13 = (this.pins[BOARDS[this.mcu.type]?.esp ? "D2" : "D13"]?.level || 0) > 0 && this.pins[BOARDS[this.mcu.type]?.esp ? "D2" : "D13"]?.mode === "OUTPUT";
    // motors driven backwards spin backwards, buzzers play the tone() frequency of the pin feeding them
    let sound = null;
    for (const p of this.project.parts) {
      if (p.type === "buzzer" && st[p.id]?.sound) {
        sound = 2400;
        if (this.mcu) for (const [pin, s] of Object.entries(this.pins)) if (s.tone && this.net(this.mcu, pin) === this.net(p, "+")) sound = s.tone;
      }
    }
    this.hooks.sound?.(sound);
    this.st = st;
  }

  /** a board pin's voltage relative to GND (for digitalRead / analogRead) */
  readPin(pinName) {
    if (this.dirty) this.solve(0.001);
    if (!this.mcu) return 0;
    return this.v(this.mcu, pinName) - this.v(this.mcu, "GND");
  }
}

// ====================================================================== Arduino runner
const TYPES = "(?:unsigned\\s+long|unsigned\\s+int|unsigned\\s+char|long\\s+long|int|long|float|double|byte|bool|boolean|char|short|String|size_t|word|uint8_t|uint16_t|uint32_t|uint64_t|int8_t|int16_t|int32_t|int64_t|auto)";

/** C++ sketch -> async JavaScript. Returns {js, functions} or throws with a friendly message. */
export function translate(src) {
  let s = "\n" + String(src || "").replace(/\r/g, "") + "\n";
  // strings and comments are kept as they are; everything else is rewritten
  s = s.replace(/^\s*#include.*$/gm, "");
  s = s.replace(/^\s*#define\s+(\w+)\s+(.+)$/gm, "const $1 = $2;");
  s = s.replace(/\bServo\s+(\w+)\s*;/g, "let $1 = new Servo();");
  s = s.replace(/\bF\(\s*("(?:[^"\\]|\\.)*")\s*\)/g, "$1");
  // functions: "void name(int a, float b) {" -> "async function name(a, b) {"
  const fns = [];
  s = s.replace(new RegExp(`(^|\\n)\\s*(?:static\\s+|inline\\s+)*(?:void|${TYPES})\\s*\\*?\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*\\{`, "g"), (m, nl, name, params) => {
    fns.push(name);
    const ps = params.split(",").map((x) => x.trim()).filter((x) => x && x !== "void").map((x) => x.replace(/=.*$/, "").trim().split(/[\s*&]+/).pop().replace(/\[\]$/, ""));
    return `${nl}async function ${name}(${ps.join(", ")}) {`;
  });
  // prototypes "int foo(int);" are not needed
  s = s.replace(new RegExp(`(^|\\n)\\s*(?:void|${TYPES})\\s+\\w+\\s*\\([^)]*\\)\\s*;`, "g"), "$1");
  // arrays: int a[] = {1,2}; / int a[3];
  s = s.replace(new RegExp(`(?:const\\s+)?${TYPES}\\s+(\\w+)\\s*\\[\\s*\\w*\\s*\\]\\s*=\\s*\\{([^}]*)\\}`, "g"), "let $1 = [$2]");
  s = s.replace(new RegExp(`(?:const\\s+)?${TYPES}\\s+(\\w+)\\s*\\[\\s*(\\w+)\\s*\\]\\s*;`, "g"), "let $1 = new Array($2).fill(0);");
  // variables: "const int x" -> "const x", "int x" -> "let x"
  s = s.replace(new RegExp(`\\bconst\\s+${TYPES}\\s+`, "g"), "const ");
  s = s.replace(new RegExp(`\\b(?:static\\s+|volatile\\s+)*${TYPES}\\s+(?=[A-Za-z_])`, "g"), "let ");
  // casts and C-only bits
  s = s.replace(new RegExp(`\\(\\s*${TYPES}\\s*\\)`, "g"), "");
  s = s.replace(/(\d)(UL|ul|L|l|U|u)\b/g, "$1");
  // waiting: delay / user functions are awaited; loops yield so the page never freezes
  s = s.replace(/\b(delay|delayMicroseconds|pulseIn)\s*\(/g, "await $1(");
  for (const f of fns) if (!["setup", "loop"].includes(f)) s = s.replace(new RegExp(`(?<!function\\s)\\b${f}\\s*\\(`, "g"), `await ${f}(`);
  s = s.replace(/\b(while|for)\s*\(([^;{]*?(?:;[^;{]*?;[^{]*?)?)\)\s*\{/g, "$1 ($2) { await __y();");
  s = s.replace(/\bdo\s*\{/g, "do { await __y();");
  if (!fns.includes("setup") || !fns.includes("loop")) throw new Error("A sketch needs both void setup() { … } and void loop() { … }.");
  return { js: s, functions: fns };
}

export class Arduino {
  constructor(sim, board, hooks = {}) {
    this.sim = sim; this.board = board; this.hooks = hooks;
    this.def = BOARDS[board.type];
    this.running = false;
    this.t0 = performance.now();
    this.serialIn = "";
  }

  pinName(n) {
    if (typeof n === "string") return /^A\d+$/.test(n) ? n : n.startsWith("D") ? n : `D${n}`;
    const d = this.def;
    if (!d.esp && n >= d.aBase && n < d.aBase + 16) return `A${n - d.aBase}`;
    return `D${n}`;
  }

  api() {
    const sim = this.sim, me = this, d = this.def;
    const vref = d.vlogic, adcMax = d.adcBits === 12 ? 4095 : 1023;
    const P = (n) => { const name = me.pinName(n); return (sim.pins[name] ||= { mode: "INPUT", level: 0 }); };
    const changed = () => { sim.dirty = true; };
    const A = {};
    for (let i = 0; i < 16; i++) A[`A${i}`] = d.esp ? `A${i}` : d.aBase + i;
    const serial = {
      begin() {}, end() {},
      print(x, base) { me.hooks.serial?.(base === 16 || base === "HEX" ? Number(x).toString(16).toUpperCase() : base === 2 || base === "BIN" ? Number(x).toString(2) : fmtNum(x)); },
      println(x = "", base) { serial.print(x, base); me.hooks.serial?.("\n"); },
      available() { return me.serialIn.length; },
      read() { if (!me.serialIn.length) return -1; const c = me.serialIn.charCodeAt(0); me.serialIn = me.serialIn.slice(1); return c; },
      readString() { const s = me.serialIn; me.serialIn = ""; return s; },
      readStringUntil(ch) { const i = me.serialIn.indexOf(ch); const s = i < 0 ? me.serialIn : me.serialIn.slice(0, i); me.serialIn = i < 0 ? "" : me.serialIn.slice(i + 1); return s; },
      parseInt() { const m = me.serialIn.match(/-?\d+/); if (!m) return 0; me.serialIn = me.serialIn.slice(m.index + m[0].length); return +m[0]; },
      write(x) { me.hooks.serial?.(typeof x === "number" ? String.fromCharCode(x) : String(x)); },
      flush() {},
    };
    function fmtNum(x) { return typeof x === "number" && !Number.isInteger(x) ? x.toFixed(2) : String(x); }
    class Servo {
      attach(pin) { this.pin = me.pinName(pin); P(pin).mode = "SERVO"; sim.servo[this.pin] ??= 90; changed(); }
      write(a) { if (this.pin) sim.servo[this.pin] = Math.max(0, Math.min(180, +a)); }
      writeMicroseconds(us) { this.write((us - 544) / (2400 - 544) * 180); }
      read() { return Math.round(sim.servo[this.pin] ?? 90); }
      attached() { return !!this.pin; }
      detach() { this.pin = null; }
    }
    let yields = 0;
    return {
      HIGH: 1, LOW: 0, INPUT: "INPUT", OUTPUT: "OUTPUT", INPUT_PULLUP: "INPUT_PULLUP", LED_BUILTIN: d.esp ? 2 : 13,
      HEX: 16, BIN: 2, DEC: 10, PI: Math.PI, ...A,
      pinMode(n, m) { P(n).mode = m; changed(); },
      digitalWrite(n, v) { const p = P(n); if (p.mode === "INPUT" && v) { p.mode = "INPUT_PULLUP"; } else { p.level = v ? 1 : 0; p.pwm = null; p.tone = 0; } changed(); },
      digitalRead(n) { const p = P(n); if (p.mode === "OUTPUT") return p.level; return sim.readPin(me.pinName(n)) > vref * 0.5 ? 1 : 0; },
      analogWrite(n, v) { const p = P(n); p.mode = "OUTPUT"; const pin = +String(me.pinName(n)).slice(1);
        if (!d.pwm.includes(pin) && !d.esp) me.hooks.warn?.(`analogWrite on pin ${n}: that pin has no PWM (~). Use one of ${d.pwm.join(", ")}.`);
        p.pwm = Math.max(0, Math.min(255, Math.round(v))); p.level = p.pwm > 127 ? 1 : 0; changed(); },
      analogRead(n) { const name = me.pinName(typeof n === "number" && !d.esp && n < d.aBase ? d.aBase + n : n); return Math.max(0, Math.min(adcMax, Math.round(sim.readPin(name) / vref * adcMax))); },
      tone(n, f, dur) { const p = P(n); p.mode = "OUTPUT"; p.tone = f; p.pwm = null; changed(); if (dur) setTimeout(() => { if (p.tone === f) { p.tone = 0; changed(); } }, dur); },
      noTone(n) { P(n).tone = 0; changed(); },
      async delay(ms) { await me.sleep(ms); },
      async delayMicroseconds(us) { await me.sleep(us / 1000); },
      millis: () => Math.floor(performance.now() - me.t0),
      micros: () => Math.floor((performance.now() - me.t0) * 1000),
      async pulseIn(n) {
        const name = me.pinName(n);
        if (sim.dirty) sim.solve(0.001);
        for (const p of sim.project.parts) if (p.type === "hcsr04" && sim.net(p, "ECHO") === sim.net(me.board, name) && sim.v(p, "VCC") - sim.v(p, "GND") > 4)
          return Math.round((+p.props.cm || 0) * 58);
        await me.sleep(1);
        return 0;
      },
      map: (x, a, b, c, dd) => Math.trunc((x - a) * (dd - c) / (b - a) + c),
      constrain: (x, a, b) => Math.min(b, Math.max(a, x)),
      min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow, sq: (x) => x * x, sin: Math.sin, cos: Math.cos, tan: Math.tan,
      floor: Math.floor, ceil: Math.ceil, round: Math.round,
      random(a, b) { if (b === undefined) { b = a; a = 0; } return Math.floor(a + Math.random() * (b - a)); },
      randomSeed() {}, bitRead: (x, n) => (x >> n) & 1, highByte: (x) => (x >> 8) & 255, lowByte: (x) => x & 255,
      String: (x) => String(x), Serial: serial, Servo,
      async __y() { if (++yields % 400 === 0) await me.sleep(0); if (!me.running) throw new StopSketch(); },
    };
  }

  sleep(ms) {
    return new Promise((res, rej) => {
      if (!this.running) return rej(new StopSketch());
      const t = setTimeout(() => { this.running ? res() : rej(new StopSketch()); }, Math.max(0, ms));
      this.timers.add(t);
    });
  }

  async start(code) {
    const { js } = translate(code);
    const api = this.api();
    const names = Object.keys(api);
    let fn;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function(...names, `"use strict";\n${js}\nreturn { setup, loop };`);
    } catch (e) {
      throw new Error(`Your code has a mistake the simulator can't read: ${e.message}`);
    }
    this.running = true; this.timers = new Set(); this.t0 = performance.now();
    const { setup, loop } = fn(...names.map((n) => api[n]));
    (async () => {
      try {
        await setup();
        while (this.running) {
          await loop();
          await this.sleep(0);                // let the page draw between loops
        }
      } catch (e) {
        if (!(e instanceof StopSketch)) { this.hooks.error?.(e); this.stop(); }
      }
    })();
  }

  stop() {
    this.running = false;
    for (const t of this.timers || []) clearTimeout(t);
  }
}

class StopSketch extends Error {}

export { LED_COLORS };
