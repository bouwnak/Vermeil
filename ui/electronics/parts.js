// parts.js - every component the Circuit Lab knows: its pins (on the 0.1-inch / 2.54 mm grid, 1 unit = 1 hole),
// how it looks in 2D (SVG, units = holes), how it behaves electrically (model -> elements for the solver in sim.js),
// and what it shows while simulating (update2d). The 3D look is in view3d.js.
//
// Element types the solver understands:
//   {t:"R", a, b, r}                         resistor between pins a and b
//   {t:"V", p, n, v, r}                      voltage source v (p = +) with internal resistance r
//   {t:"D", a, k, vf, rs, id}                diode / LED (on when forward-biased above vf)
//   {t:"C", p, n, c, id}                     capacitor (transient)
//   {t:"SW", a, b, on}                       switch: ~0 Ω when on, open when off
//   {t:"NPN", b, c, e, id} / {t:"NMOS", g, d, s, id}

export const LED_COLORS = { red: ["#ff2a2a", 1.9], green: ["#2aff5a", 2.1], blue: ["#3a7bff", 3.1], yellow: ["#ffe12a", 2.0],
  white: ["#f4f6ff", 3.1], orange: ["#ff8a1a", 2.0] };
const BAND = ["#111", "#7a4a1a", "#e01b1b", "#ff8c00", "#ffd800", "#1c9e3a", "#1f5bd6", "#8b2fc9", "#888", "#f5f5f5"];
const GOLD = "#d4af37", SILVER = "#c0c0c0";

const pin = (id, x, y, label) => ({ id, x, y, label: label || id });
const row = (ids, x0, y, dx = 1) => ids.map((id, i) => id && pin(id, x0 + i * dx, y)).filter(Boolean);

export function resistorBands(ohms) {
  if (!(ohms >= 1)) return [BAND[0], BAND[0], SILVER, GOLD];
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let d = Math.round(ohms / 10 ** exp);
  if (d >= 100) { d = Math.round(d / 10); exp += 1; }
  const m = exp >= 0 ? BAND[exp] : exp === -1 ? GOLD : SILVER;
  return [BAND[Math.floor(d / 10)], BAND[d % 10], m, GOLD];
}
export function fmtOhm(r) { return r >= 1e6 ? `${+(r / 1e6).toFixed(2)} MΩ` : r >= 1e3 ? `${+(r / 1e3).toFixed(2)} kΩ` : `${+r.toFixed(1)} Ω`; }
export function fmtF(c) { return c >= 1e-3 ? `${+(c * 1e3).toFixed(2)} mF` : c >= 1e-6 ? `${+(c * 1e6).toFixed(2)} µF` : c >= 1e-9 ? `${+(c * 1e9).toFixed(1)} nF` : `${+(c * 1e12).toFixed(0)} pF`; }

// ------------------------------------------------------------------ breadboards
function breadboard(cols, name) {
  const main = "abcde".split("").map((r, i) => [r, 3 + i]).concat("fghij".split("").map((r, i) => [r, 10 + i]));
  const railCols = []; for (let c = 2; c <= cols - 1; c++) if ((c - 2) % 6 !== 5) railCols.push(c);
  return {
    name, cat: "Breadboards", w: cols + 2, h: 18, z: 0, board: true,
    pins() {
      const p = [];
      for (const c of railCols) { p.push(pin(`tn${c}`, c, 0, "− rail")); p.push(pin(`tp${c}`, c, 1, "+ rail")); p.push(pin(`bp${c}`, c, 16, "+ rail")); p.push(pin(`bn${c}`, c, 17, "− rail")); }
      for (let c = 1; c <= cols; c++) for (const [r, y] of main) p.push(pin(`${r}${c}`, c, y, `${r}${c}`));
      return p;
    },
    groups() {
      const g = [railCols.map((c) => `tn${c}`), railCols.map((c) => `tp${c}`), railCols.map((c) => `bp${c}`), railCols.map((c) => `bn${c}`)];
      for (let c = 1; c <= cols; c++) { g.push("abcde".split("").map((r) => `${r}${c}`)); g.push("fghij".split("").map((r) => `${r}${c}`)); }
      return g;
    },
    draw2d() {
      let s = `<rect x="-0.5" y="-1" width="${cols + 2}" height="19.2" rx="0.6" fill="#f3f1ea" stroke="#cfcac0" stroke-width="0.08"/>`;
      s += `<rect x="-0.3" y="8.2" width="${cols + 1.6}" height="0.6" fill="#e2ded3"/>`;
      for (const [y, col] of [[-0.45, "#2c6bd6"], [1.45, "#d62c2c"], [15.55, "#d62c2c"], [17.45, "#2c6bd6"]]) s += `<line x1="1" x2="${cols}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="0.12"/>`;
      s += `<text x="0.1" y="0.35" class="bbl" fill="#2c6bd6">−</text><text x="0.1" y="1.35" class="bbl" fill="#d62c2c">+</text>`;
      s += `<text x="0.1" y="16.35" class="bbl" fill="#d62c2c">+</text><text x="0.1" y="17.35" class="bbl" fill="#2c6bd6">−</text>`;
      for (const [r, y] of main) s += `<text x="${cols + 0.9}" y="${y + 0.3}" class="bbl">${r}</text>`;
      for (let c = 1; c <= cols; c += 5) s += `<text x="${c}" y="2.4" class="bbl" text-anchor="middle">${c}</text>`;
      return s;
    },
  };
}

// ------------------------------------------------------------------ microcontroller boards
// vlogic: output HIGH voltage; aBase: what A0 is as a pin number; pwm: pins with analogWrite
function board(def) {
  return {
    cat: "Microcontrollers", z: 1, mcu: true, ...def,
    groups() {                                   // all GND pins are one, RST pins are one
      const ids = this.pins().map((p) => p.id);
      return [ids.filter((i) => /^GND/.test(i)), ids.filter((i) => /^RST/.test(i))].filter((g) => g.length > 1);
    },
    model(part, ctx) {
      const els = [], vl = def.vlogic, gnd = "GND";
      els.push({ t: "V", p: "5V", n: gnd, v: def.vlogic === 3.3 ? 5 : 5, r: 0.05, id: "5V", src: true });
      if (this.pins().some((p) => p.id === "3V3")) els.push({ t: "V", p: "3V3", n: gnd, v: 3.3, r: 0.5, id: "3V3", src: true });
      for (const p of this.pins()) {
        if (!/^D\d+$|^A\d+$/.test(p.id)) continue;
        const st = ctx.pinState(part, p.id);
        if (st.mode === "OUTPUT") {
          // PWM / tone: the simulator solves with the pin HIGH (phase 1) and LOW (phase 0) and blends by the duty cycle
          const fast = st.tone || (st.pwm != null && st.pwm > 0 && st.pwm < 255);
          const level = fast ? (ctx.phase ?? (st.tone ? 0.5 : st.pwm / 255)) : st.pwm != null ? (st.pwm >= 255 ? 1 : 0) : st.level ? 1 : 0;
          els.push({ t: "V", p: p.id, n: gnd, v: level * vl, r: 25, id: `out:${p.id}`, pinOut: p.id });
        } else if (st.mode === "INPUT_PULLUP") els.push({ t: "V", p: p.id, n: gnd, v: vl, r: 35000 });
        else els.push({ t: "R", a: p.id, b: gnd, r: 1e8 });
      }
      return els;
    },
    draw2d() {
      const c = def.color || "#0e6f8a";
      let s = `<rect x="-0.8" y="-0.8" width="${def.w + 0.6}" height="${def.h + 0.6}" rx="0.7" fill="${c}" stroke="#063846" stroke-width="0.1"/>`;
      if (def.usb) s += `<rect x="${def.usb[0]}" y="${def.usb[1]}" width="${def.usb[2]}" height="${def.usb[3]}" fill="#c9ccd1" stroke="#888" stroke-width="0.08"/>`;
      if (def.chip) s += `<rect x="${def.chip[0]}" y="${def.chip[1]}" width="${def.chip[2]}" height="${def.chip[3]}" rx="0.2" fill="#1d1f22"/>`;
      s += `<text x="${def.w / 2 - 0.4}" y="${def.h / 2 + 0.4}" class="mcu-label" text-anchor="middle">${def.label || def.name}</text>`;
      for (const p of this.pins()) s += `<rect x="${p.x - 0.42}" y="${p.y - 0.42}" width="0.84" height="0.84" fill="#151515"/>` +
        `<text x="${p.x}" y="${p.y + (p.y < def.h / 2 ? 1.25 : -0.75)}" class="pinlbl" text-anchor="middle">${p.label.replace(/^D(\d+)$/, "$1").replace(/\.\d$/, "")}</text>`;
      s += `<circle class="led13" cx="${def.led13?.[0] ?? 3}" cy="${def.led13?.[1] ?? 4}" r="0.45" fill="#5a3a00"/><circle class="pwr" cx="${(def.led13?.[0] ?? 3)}" cy="${(def.led13?.[1] ?? 4) + 1.4}" r="0.45" fill="#0a3"/>`;
      return s;
    },
    update2d(g, part, st) {
      const l = g.querySelector(".led13");
      if (l) l.setAttribute("fill", st.led13 ? "#ffb000" : "#5a3a00");
    },
  };
}

const UNO_TOP = [["D0", 25], ["D1", 24], ["D2", 23], ["D3", 22], ["D4", 21], ["D5", 20], ["D6", 19], ["D7", 18], ["D8", 16], ["D9", 15], ["D10", 14], ["D11", 13], ["D12", 12], ["D13", 11], ["GND.3", 10], ["AREF", 9]];
const UNO_BOTTOM = [["IOREF", 8], ["RST", 9], ["3V3", 10], ["5V", 11], ["GND", 12], ["GND.2", 13], ["VIN", 14], ["A0", 16], ["A1", 17], ["A2", 18], ["A3", 19], ["A4", 20], ["A5", 21]];
const unoPins = () => UNO_TOP.map(([id, x]) => pin(id, x, 0)).concat(UNO_BOTTOM.map(([id, x]) => pin(id, x, 20)));
const nanoTop = ["D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "GND", "RST", "D0", "D1"];
const nanoBottom = ["D13", "3V3", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST.2", "GND.2", "VIN"];

export const BOARDS = {
  uno: board({ name: "Arduino Uno R3", label: "UNO", w: 27, h: 20, vlogic: 5, aBase: 14, pwm: [3, 5, 6, 9, 10, 11], digital: 20,
    usb: [-1.2, 2, 4, 4.5], chip: [11, 10, 12, 3], led13: [12.5, 3], pins: unoPins }),
  leonardo: board({ name: "Arduino Leonardo", label: "LEONARDO", w: 27, h: 20, vlogic: 5, aBase: 18, pwm: [3, 5, 6, 9, 10, 11, 13], digital: 24,
    usb: [-1.2, 3, 3, 3], chip: [12, 8, 7, 7], led13: [12.5, 3], pins: () => unoPins() }),
  mega: board({ name: "Arduino Mega 2560", label: "MEGA 2560", w: 40, h: 20, vlogic: 5, aBase: 54, pwm: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46], digital: 70,
    usb: [-1.2, 2, 4, 4.5], chip: [17, 8, 8, 8], led13: [20, 3], color: "#0d6680",
    pins() {
      const p = [];
      for (let i = 0; i <= 7; i++) p.push(pin(`D${i}`, 35 - i, 0));
      ["D8", "D9", "D10", "D11", "D12", "D13", "GND.3", "AREF"].forEach((id, i) => p.push(pin(id, 26 - i, 0)));
      for (let i = 14; i <= 21; i++) p.push(pin(`D${i}`, 17 - (i - 14), 0));
      for (let k = 0; k < 16; k++) { p.push(pin(`D${22 + k * 2}`, 38, 2 + k)); p.push(pin(`D${23 + k * 2}`, 39, 2 + k)); }
      ["IOREF", "RST", "3V3", "5V", "GND", "GND.2", "VIN"].forEach((id, i) => p.push(pin(id, 6 + i, 20)));
      for (let i = 0; i < 8; i++) p.push(pin(`A${i}`, 14 + i, 20));
      for (let i = 8; i < 16; i++) p.push(pin(`A${i}`, 23 + (i - 8), 20));
      return p;
    } }),
  nano: board({ name: "Arduino Nano", label: "NANO", w: 14, h: 6, vlogic: 5, aBase: 14, pwm: [3, 5, 6, 9, 10, 11], digital: 22,
    usb: [-1.6, 2, 2, 2], chip: [6, 2, 2.4, 2.4], led13: [10, 2.2], color: "#1d5f9e",
    pins: () => row(nanoTop, 0, 0).concat(row(nanoBottom, 0, 6)) }),
  micro: board({ name: "Arduino Micro", label: "MICRO", w: 16, h: 6, vlogic: 5, aBase: 18, pwm: [3, 5, 6, 9, 10, 11, 13], digital: 24,
    usb: [-1.6, 2, 2, 2], chip: [7, 2, 2.4, 2.4], led13: [12, 2.2], color: "#1a1a1a",
    pins: () => row(["D1", "D0", "RST", "GND", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "D14"], 0, 0)
      .concat(row(["VIN", "GND.2", "RST.2", "5V", "NC", "NC.2", "A5", "A4", "A3", "A2", "A1", "A0", "AREF", "3V3", "D15", "D16", "D17"], 0, 6)) }),
  promini: board({ name: "Arduino Pro Mini (5V)", label: "PRO MINI", w: 11, h: 6, vlogic: 5, aBase: 14, pwm: [3, 5, 6, 9, 10, 11], digital: 20,
    chip: [4, 2, 2.4, 2.4], led13: [8.5, 2.2], color: "#7a1d2a",
    pins: () => row(["D1", "D0", "RST", "GND", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"], 0, 0)
      .concat(row(["VIN", "GND.2", "RST.2", "5V", "A3", "A2", "A1", "A0", "D13", "D12", "D11", "D10"], 0, 6)) }),
  esp32: board({ name: "ESP32 DevKit", label: "ESP32", w: 14, h: 9, vlogic: 3.3, aBase: 0, adcBits: 12, esp: true, digital: 40,
    pwm: [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33], usb: [-1.6, 3, 2, 3], chip: [4, 2, 6, 5], led13: [12, 4], color: "#24272b",
    pins: () => row(["3V3", "GND", "D15", "D2", "D4", "D16", "D17", "D5", "D18", "D19", "D21", "D3", "D1", "D22", "D23"], 0, 0)
      .concat(row(["5V", "GND.2", "D13", "D12", "D14", "D27", "D26", "D25", "D33", "D32", "D35", "D34", "D39", "D36", "EN"], 0, 9)) }),
};

// ------------------------------------------------------------------ the parts
const legs = (pts, col = "#9aa0a6") => pts.map(([x1, y1, x2, y2]) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="0.16" stroke-linecap="round"/>`).join("");

export const PARTS = {
  breadboard: breadboard(63, "Breadboard (full)"),
  breadboard_half: breadboard(30, "Breadboard (half)"),
  ...BOARDS,

  resistor: {
    name: "Resistor", cat: "Basic", props: { ohms: 220 },
    pins: () => [pin("1", 0, 0), pin("2", 4, 0)],
    model: (p) => [{ t: "R", a: "1", b: "2", r: Math.max(0.01, +p.props.ohms || 220), id: "r" }],
    draw2d(p) {
      const b = resistorBands(+p.props.ohms);
      return legs([[0, 0, 0.9, 0], [3.1, 0, 4, 0]]) + `<rect x="0.8" y="-0.42" width="2.4" height="0.84" rx="0.35" fill="#e6cf9a" stroke="#b39b62" stroke-width="0.06"/>` +
        b.map((c, i) => `<rect x="${1.1 + i * 0.42 + (i === 3 ? 0.35 : 0)}" y="-0.42" width="0.2" height="0.84" fill="${c}"/>`).join("") +
        `<rect class="heat" x="0.8" y="-0.42" width="2.4" height="0.84" rx="0.35" fill="#ff3b00" opacity="0"/>`;
    },
    update2d(g, p, st) { g.querySelector(".heat").setAttribute("opacity", Math.min(0.8, Math.max(0, (st.power || 0) / 0.5 - 0.3))); },
  },

  led: {
    name: "LED", cat: "Basic", props: { color: "red" },
    pins: () => [pin("A", 1, 0, "anode +"), pin("K", 0, 0, "cathode −")],
    model: (p, ctx) => ctx.burnt(p) ? [] : [{ t: "D", a: "A", k: "K", vf: LED_COLORS[p.props.color]?.[1] || 2, rs: 12, id: "d" }],
    draw2d(p) {
      const c = LED_COLORS[p.props.color]?.[0] || "#f22";
      return legs([[0, 0, 0, -1.1], [1, 0, 1, -0.9], [1, -0.9, 0.8, -1.1]]) +
        `<circle class="glow" cx="0.5" cy="-1.9" r="1.6" fill="${c}" opacity="0" filter="url(#glow)"/>` +
        `<path d="M -0.4 -1.1 L -0.4 -2.1 A 0.9 0.9 0 0 1 1.4 -2.1 L 1.4 -1.1 Z" fill="${c}" fill-opacity="0.55" stroke="${c}" stroke-width="0.08"/>` +
        `<rect x="-0.55" y="-1.2" width="2.1" height="0.25" fill="${c}" opacity="0.7"/><text class="smoke" x="0.5" y="-2.6" text-anchor="middle" opacity="0">💥</text>`;
    },
    update2d(g, p, st) { g.querySelector(".glow").setAttribute("opacity", st.burnt ? 0 : Math.min(1, st.bright || 0)); g.querySelector(".smoke").setAttribute("opacity", st.burnt ? 1 : 0); },
  },

  rgbled: {
    name: "RGB LED (common cathode)", cat: "Basic", props: {},
    pins: () => [pin("R", 0, 0, "red"), pin("K", 1, 0, "common −"), pin("G", 2, 0, "green"), pin("B", 3, 0, "blue")],
    model: () => [{ t: "D", a: "R", k: "K", vf: 1.9, rs: 15, id: "r" }, { t: "D", a: "G", k: "K", vf: 2.9, rs: 15, id: "g" }, { t: "D", a: "B", k: "K", vf: 2.9, rs: 15, id: "b" }],
    draw2d() {
      return legs([[0, 0, 0.6, -1], [1, 0, 1.2, -1], [2, 0, 1.8, -1], [3, 0, 2.4, -1]]) +
        `<circle class="glow" cx="1.5" cy="-2" r="1.8" fill="#fff" opacity="0" filter="url(#glow)"/>` +
        `<path d="M 0.4 -1 L 0.4 -2.2 A 1.1 1.1 0 0 1 2.6 -2.2 L 2.6 -1 Z" fill="#eef" fill-opacity="0.5" stroke="#ccd" stroke-width="0.08"/>`;
    },
    update2d(g, p, st) {
      const c = st.rgb || [0, 0, 0], m = Math.max(...c);
      const glow = g.querySelector(".glow");
      glow.setAttribute("opacity", Math.min(1, m)); glow.setAttribute("fill", `rgb(${c.map((x) => Math.round(255 * Math.min(1, x / Math.max(m, 1e-6)))).join(",")})`);
    },
  },

  button: {
    name: "Pushbutton", cat: "Input", props: {}, press: true,
    pins: () => [pin("1a", 0, 0), pin("2a", 2, 0), pin("1b", 0, 3), pin("2b", 2, 3)],
    groups: () => [["1a", "1b"], ["2a", "2b"]],
    alias: { 1: "1a", 2: "2a" },
    model: (p, ctx) => [{ t: "SW", a: "1a", b: "2a", on: ctx.pressed(p) }],
    draw2d: () => `<rect x="-0.45" y="-0.45" width="2.9" height="3.9" rx="0.3" fill="#2b2d31" stroke="#111" stroke-width="0.08"/>` +
      `<circle class="cap" cx="1" cy="1.5" r="1" fill="#5c6068" stroke="#222" stroke-width="0.08"/>`,
    update2d(g, p, st) { g.querySelector(".cap").setAttribute("fill", st.pressed ? "#c43" : "#5c6068"); },
  },

  switch: {
    name: "Slide switch", cat: "Input", props: { pos: "A" },
    pins: () => [pin("A", 0, 0), pin("COM", 1, 0), pin("B", 2, 0)],
    model: (p) => [{ t: "SW", a: "COM", b: "A", on: p.props.pos === "A" }, { t: "SW", a: "COM", b: "B", on: p.props.pos !== "A" }],
    draw2d: (p) => `<rect x="-0.6" y="-1.6" width="3.2" height="1.3" rx="0.2" fill="#2b2d31"/><rect class="knob" x="${p.props.pos === "A" ? -0.3 : 1.1}" y="-2.2" width="1.2" height="1" fill="#ddd"/>`,
    update2d(g, p) { g.querySelector(".knob").setAttribute("x", p.props.pos === "A" ? -0.3 : 1.1); },
  },

  pot: {
    name: "Potentiometer", cat: "Input", props: { ohms: 10000, pos: 0.5 },
    pins: () => [pin("1", 0, 0), pin("W", 2, 0, "wiper"), pin("2", 4, 0)],
    model: (p) => {
      const R = +p.props.ohms || 10000, k = Math.min(1, Math.max(0, +p.props.pos));
      return [{ t: "R", a: "1", b: "W", r: Math.max(1, R * k) }, { t: "R", a: "W", b: "2", r: Math.max(1, R * (1 - k)) }];
    },
    draw2d: () => legs([[0, 0, 0.4, -1], [2, 0, 2, -1], [4, 0, 3.6, -1]]) + `<rect x="-0.3" y="-3.8" width="4.6" height="2.9" rx="0.4" fill="#1f5bd6"/>` +
      `<circle cx="2" cy="-2.35" r="1.15" fill="#e9e9e9" stroke="#999" stroke-width="0.08"/><line class="knob" x1="2" y1="-2.35" x2="2" y2="-3.4" stroke="#333" stroke-width="0.2"/>`,
    update2d(g, p) { const a = -135 + 270 * (+p.props.pos); g.querySelector(".knob").setAttribute("transform", `rotate(${a} 2 -2.35)`); },
  },

  ldr: {
    name: "Photoresistor (LDR)", cat: "Input", props: { light: 0.5 },
    pins: () => [pin("1", 0, 0), pin("2", 2, 0)],
    model: (p) => [{ t: "R", a: "1", b: "2", r: Math.round(1e6 * Math.pow(500 / 1e6, Math.min(1, Math.max(0, +p.props.light)))) }],
    draw2d: () => legs([[0, 0, 0.5, -0.9], [2, 0, 1.5, -0.9]]) + `<circle cx="1" cy="-1.7" r="1" fill="#e8a33d" stroke="#a66" stroke-width="0.08"/>` +
      `<path d="M 0.3 -1.9 Q 0.7 -1.3 1 -1.9 T 1.7 -1.9" stroke="#8a2b1a" stroke-width="0.12" fill="none"/>`,
  },

  capacitor: {
    name: "Capacitor", cat: "Basic", props: { farads: 100e-6 },
    pins: () => [pin("+", 0, 0), pin("-", 1, 0, "−")],
    model: (p) => [{ t: "C", p: "+", n: "-", c: Math.max(1e-12, +p.props.farads || 1e-6), id: "c" }],
    draw2d(p) {
      const big = +p.props.farads >= 1e-6;
      return legs([[0, 0, 0, -0.9], [1, 0, 1, -0.9]]) + (big
        ? `<rect x="-0.6" y="-3.2" width="2.2" height="2.4" rx="0.5" fill="#1d3f8f"/><rect x="0.85" y="-3.2" width="0.5" height="2.4" fill="#ccd"/>`
        : `<ellipse cx="0.5" cy="-1.6" rx="1" ry="0.8" fill="#e09a2c"/>`);
    },
  },

  diode: {
    name: "Diode (1N4007)", cat: "Basic", props: {},
    pins: () => [pin("A", 0, 0, "anode"), pin("K", 4, 0, "cathode")],
    model: () => [{ t: "D", a: "A", k: "K", vf: 0.7, rs: 0.5, id: "d" }],
    draw2d: () => legs([[0, 0, 1, 0], [3, 0, 4, 0]]) + `<rect x="1" y="-0.4" width="2" height="0.8" rx="0.15" fill="#1b1b1b"/><rect x="2.55" y="-0.4" width="0.25" height="0.8" fill="#ccc"/>`,
  },

  npn: {
    name: "NPN transistor (2N2222)", cat: "Basic", props: {},
    pins: () => [pin("E", 0, 0, "emitter"), pin("B", 1, 0, "base"), pin("C", 2, 0, "collector")],
    model: () => [{ t: "NPN", b: "B", c: "C", e: "E", id: "q" }],
    draw2d: () => legs([[0, 0, 0.3, -0.9], [1, 0, 1, -0.9], [2, 0, 1.7, -0.9]]) + `<path d="M -0.3 -0.9 L 2.3 -0.9 L 2.3 -2.2 A 1.3 1 0 0 0 -0.3 -2.2 Z" fill="#222"/><text x="1" y="-1.4" class="tiny" text-anchor="middle">NPN</text>`,
  },

  nmos: {
    name: "N-MOSFET (IRLZ44N)", cat: "Basic", props: {},
    pins: () => [pin("G", 0, 0, "gate"), pin("D", 1, 0, "drain"), pin("S", 2, 0, "source")],
    model: () => [{ t: "NMOS", g: "G", d: "D", s: "S", id: "m" }],
    draw2d: () => legs([[0, 0, 0, -1], [1, 0, 1, -1], [2, 0, 2, -1]]) + `<rect x="-0.6" y="-3.4" width="3.2" height="2.4" fill="#222"/><rect x="-0.6" y="-4.6" width="3.2" height="1.3" fill="#bbb"/><text x="1" y="-1.9" class="tiny" text-anchor="middle">MOSFET</text>`,
  },

  motor: {
    name: "DC motor", cat: "Output", props: {},
    pins: () => [pin("+", 0, 0), pin("-", 2, 0, "−")],
    model: () => [{ t: "R", a: "+", b: "-", r: 8, id: "m" }],
    draw2d: () => legs([[0, 0, 0.4, -1], [2, 0, 1.6, -1]], "#c33") + `<circle cx="1" cy="-3" r="2.1" fill="#f2c230" stroke="#a8861a" stroke-width="0.1"/>` +
      `<g class="rotor"><line x1="1" y1="-4.6" x2="1" y2="-1.4" stroke="#333" stroke-width="0.35"/><line x1="-0.6" y1="-3" x2="2.6" y2="-3" stroke="#333" stroke-width="0.35"/></g>`,
    update2d(g, p, st) { g.querySelector(".rotor").setAttribute("transform", `rotate(${st.angle || 0} 1 -3)`); },
  },

  servo: {
    name: "Servo (SG90)", cat: "Output", props: {},
    pins: () => [pin("GND", 0, 0), pin("V+", 1, 0), pin("SIG", 2, 0, "signal")],
    model: () => [{ t: "R", a: "V+", b: "GND", r: 500, id: "s" }, { t: "R", a: "SIG", b: "GND", r: 1e6 }],
    draw2d: () => legs([[0, 0, 0, -1], [1, 0, 1, -1], [2, 0, 2, -1]], "#777") + `<rect x="-1" y="-5" width="4" height="4" rx="0.3" fill="#1f5bd6"/><circle cx="1" cy="-4" r="0.6" fill="#eee"/>` +
      `<g class="horn"><rect x="0.7" y="-6.6" width="0.6" height="3" rx="0.3" fill="#fafafa" stroke="#999" stroke-width="0.06"/></g>`,
    update2d(g, p, st) { g.querySelector(".horn").setAttribute("transform", `rotate(${(st.servo ?? 90) - 90} 1 -4)`); },
  },

  buzzer: {
    name: "Piezo buzzer", cat: "Output", props: {},
    pins: () => [pin("+", 0, 0), pin("-", 2, 0, "−")],
    model: () => [{ t: "R", a: "+", b: "-", r: 300, id: "b" }],
    draw2d: () => legs([[0, 0, 0, -0.8], [2, 0, 2, -0.8]]) + `<circle cx="1" cy="-2.3" r="1.8" fill="#1b1b1b"/><circle cx="1" cy="-2.3" r="0.35" fill="#444"/><circle class="wave" cx="1" cy="-2.3" r="2.4" fill="none" stroke="#7cf" stroke-width="0.12" opacity="0"/>`,
    update2d(g, p, st) { g.querySelector(".wave").setAttribute("opacity", st.sound ? 0.9 : 0); },
  },

  battery9v: {
    name: "9V battery", cat: "Power", props: { volts: 9 },
    pins: () => [pin("+", 0, 0), pin("-", 2, 0, "−")],
    model: (p) => [{ t: "V", p: "+", n: "-", v: +p.props.volts || 9, r: 1.5, id: "bat", src: true }],
    draw2d: () => `<rect x="-1.5" y="-9" width="5" height="8" rx="0.4" fill="#222"/><rect x="-1.5" y="-9" width="5" height="2.4" fill="#d4a017"/><text x="1" y="-3.6" class="mcu-label" text-anchor="middle">9V</text>` + legs([[0, 0, 0, -1], [2, 0, 2, -1]], "#c33"),
  },
  aa4: {
    name: "4×AA battery pack (6V)", cat: "Power", props: { volts: 6 },
    pins: () => [pin("+", 0, 0), pin("-", 2, 0, "−")],
    model: (p) => [{ t: "V", p: "+", n: "-", v: +p.props.volts || 6, r: 0.4, id: "bat", src: true }],
    draw2d: () => `<rect x="-2" y="-8" width="6" height="7" rx="0.3" fill="#2a2a2a"/>` + [0, 1, 2, 3].map((i) => `<rect x="${-1.6 + i * 1.4}" y="-7.6" width="1.2" height="6.2" rx="0.5" fill="#b9b9b9"/>`).join("") + legs([[0, 0, 0, -1], [2, 0, 2, -1]], "#c33"),
  },
  coincell: {
    name: "Coin cell (CR2032, 3V)", cat: "Power", props: { volts: 3 },
    pins: () => [pin("+", 0, 0), pin("-", 2, 0, "−")],
    model: (p) => [{ t: "V", p: "+", n: "-", v: +p.props.volts || 3, r: 15, id: "bat", src: true }],
    draw2d: () => `<circle cx="1" cy="-2.4" r="2" fill="#cfd3d8" stroke="#888" stroke-width="0.08"/><text x="1" y="-2" class="tiny" text-anchor="middle">3V</text>` + legs([[0, 0, 0.4, -0.8], [2, 0, 1.6, -0.8]]),
  },

  hcsr04: {
    name: "Ultrasonic sensor (HC-SR04)", cat: "Input", props: { cm: 30 },
    pins: () => [pin("VCC", 0, 0), pin("TRIG", 1, 0), pin("ECHO", 2, 0), pin("GND", 3, 0)],
    model: () => [{ t: "R", a: "VCC", b: "GND", r: 330, id: "p" }, { t: "R", a: "TRIG", b: "GND", r: 1e6 }],
    draw2d: () => legs([[0, 0, 0, -1], [1, 0, 1, -1], [2, 0, 2, -1], [3, 0, 3, -1]]) + `<rect x="-3" y="-5" width="9" height="4" rx="0.3" fill="#1f6fbf"/>` +
      `<circle cx="-0.8" cy="-3" r="1.6" fill="#c9ccd1" stroke="#777" stroke-width="0.1"/><circle cx="3.8" cy="-3" r="1.6" fill="#c9ccd1" stroke="#777" stroke-width="0.1"/>`,
  },
  tmp36: {
    name: "Temperature sensor (TMP36)", cat: "Input", props: { celsius: 25 },
    pins: () => [pin("VS", 0, 0, "+Vs"), pin("OUT", 1, 0, "Vout"), pin("GND", 2, 0)],
    model: (p) => [{ t: "R", a: "VS", b: "GND", r: 100000 }, { t: "V", p: "OUT", n: "GND", v: 0.5 + 0.01 * (+p.props.celsius || 0), r: 200, needs: ["VS", "GND", 2.7] }],
    draw2d: () => legs([[0, 0, 0.3, -0.9], [1, 0, 1, -0.9], [2, 0, 1.7, -0.9]]) + `<path d="M -0.3 -0.9 L 2.3 -0.9 L 2.3 -2.2 A 1.3 1 0 0 0 -0.3 -2.2 Z" fill="#222"/><text x="1" y="-1.4" class="tiny" text-anchor="middle">TMP</text>`,
  },
  l293d: {
    name: "Motor driver (L293D)", cat: "Output", props: {},
    pins: () => [...["EN1", "IN1", "OUT1", "GND", "GND.2", "OUT2", "IN2", "VCC2"].map((id, i) => pin(id, i, 3)),
      ...["VCC1", "IN4", "OUT4", "GND.3", "GND.4", "OUT3", "IN3", "EN2"].map((id, i) => pin(id, i, 0))],
    groups: () => [["GND", "GND.2", "GND.3", "GND.4"]],
    model: () => [{ t: "R", a: "VCC1", b: "GND", r: 200 }, { t: "L293", id: "drv" }],
    draw2d: () => `<rect x="-0.5" y="0.4" width="8" height="2.2" rx="0.2" fill="#1b1b1b"/><circle cx="-0.1" cy="1.5" r="0.3" fill="#444"/><text x="3.5" y="1.8" class="tiny" text-anchor="middle" fill="#ddd">L293D</text>`,
  },
  multimeter: {
    name: "Multimeter", cat: "Tools", props: { mode: "V" },
    pins: () => [pin("COM", 0, 0, "COM (black)"), pin("V", 3, 0, "V/A (red)")],
    model: (p) => p.props.mode === "A" ? [{ t: "R", a: "V", b: "COM", r: 0.01, id: "m" }] : [{ t: "R", a: "V", b: "COM", r: 1e9, id: "m" }],
    draw2d: () => `<rect x="-1.5" y="-9" width="6" height="8.2" rx="0.6" fill="#f2c230" stroke="#a8861a" stroke-width="0.1"/><rect x="-0.9" y="-8.3" width="4.8" height="2.4" fill="#cfe3c8"/>` +
      `<text class="reading" x="1.5" y="-6.6" text-anchor="middle" font-size="1.3" font-family="monospace" fill="#111">0.00</text>` +
      `<text class="mode" x="1.5" y="-3.6" text-anchor="middle" class="tiny" font-size="1">V</text>` + legs([[0, 0, 0, -0.8]], "#111") + legs([[3, 0, 3, -0.8]], "#d22"),
    update2d(g, p, st) { g.querySelector(".reading").textContent = st.reading ?? "0.00"; g.querySelector(".mode").textContent = p.props.mode === "A" ? "A (mA)" : "V DC"; },
  },
};

export const CATEGORIES = ["Breadboards", "Microcontrollers", "Basic", "Input", "Output", "Power", "Tools"];

/** pin list of a placed part (cached per type unless it depends on props) */
const pinCache = new Map();
export function pinsOf(type) {
  if (!pinCache.has(type)) pinCache.set(type, PARTS[type].pins());
  return pinCache.get(type);
}

/** where a part's pin is on the canvas (rotation in 90° steps around the part origin) */
export function pinWorld(part, p) {
  const r = ((part.rot || 0) % 360 + 360) % 360;
  const [x, y] = r === 90 ? [-p.y, p.x] : r === 180 ? [-p.x, -p.y] : r === 270 ? [p.y, -p.x] : [p.x, p.y];
  return [part.x + x, part.y + y];
}

export function resolvePin(type, id) {
  const def = PARTS[type]; if (!def) return null;
  if (def.alias?.[id]) id = def.alias[id];
  const pins = pinsOf(type);
  if (pins.some((p) => p.id === id)) return id;
  const up = String(id).toUpperCase().replace(/^PIN\s*/, "");
  const m = pins.find((p) => p.id.toUpperCase() === up) || pins.find((p) => p.id.toUpperCase() === `D${up}`) ||
    pins.find((p) => up === "+" && /^\+|^VCC|^VS|^V\+/.test(p.id)) || pins.find((p) => (up === "-" || up === "GND") && /^-$|^GND/.test(p.id)) ||
    pins.find((p) => up === "3.3V" && p.id === "3V3") || pins.find((p) => up === "VCC" && p.id === "5V");
  return m ? m.id : null;
}
