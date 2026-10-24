// lab.js - the Circuit Lab page: parts palette, 2D editor / 3D view, properties, Arduino code, serial monitor,
// saving (data/electronics/ through Vermeil, or this browser when opened on its own), examples, and "Check my circuit"
// (Vermeil reads the parts, connections, code and simulator readings and explains what's wrong).
import { PARTS, BOARDS, CATEGORIES, LED_COLORS, pinsOf, resolvePin, fmtOhm, fmtF } from "./parts.js";
import { Simulator, Arduino, buildNets, translate } from "./sim.js";
import { View2D } from "./view2d.js";
import { setMd } from "../util.js";

const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else if (k === "class") n.className = v; else if (v != null && v !== false) n.setAttribute(k, v === true ? "" : v); }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
};
function toast(t, ms = 3000) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), ms); }

// ---------------- bridge to Vermeil (Python) ----------------
const apiP = new Promise((res) => {
  if (window.pywebview?.api) return res(window.pywebview.api);
  window.addEventListener("pywebviewready", () => res(window.pywebview.api), { once: true });
  setTimeout(() => res(window.pywebview?.api || null), window.pywebview ? 2500 : 600);
});
async function py(name, ...args) { const api = await apiP; if (!api?.[name]) return null; try { return await api[name](...args); } catch (e) { return { error: String(e?.message || e) }; } }

// ---------------- example sketches ----------------
const BLINK = `// Blink: the LED turns on for one second, then off for one second, forever.
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(1000);
  digitalWrite(13, LOW);
  delay(1000);
}
`;

function emptyProject(name = "My circuit") {
  return { version: 1, name, parts: [], wires: [], code: BLINK, mcu: null, nextId: 1 };
}

/** a circuit described only by parts + pin-to-pin wires (examples, the assistant's robots): lay it out neatly */
export function autoLayout(c, name = "From Vermeil") {
  const p = emptyProject(name);
  p.code = c.code || BLINK;
  const parts = (c.parts || []).filter((x) => PARTS[x.type]);
  const mcu = parts.find((x) => BOARDS[x.type]);
  let col = 0, rowY = 0;
  const startX = mcu ? PARTS[mcu.type].w + 10 : 0;
  for (const x of parts) {
    const def = PARTS[x.type];
    const part = { id: x.id || `${x.type}${p.nextId++}`, type: x.type, x: 0, y: 0, rot: 0, props: { ...(def.props || {}), ...(x.props || {}) } };
    if (x === mcu) { part.x = 0; part.y = 4; }
    else {
      const w = Math.max(4, ...pinsOf(x.type).map((q) => q.x)) + 5;
      if (col + w > 46) { col = 0; rowY += 14; }
      part.x = startX + col; part.y = 10 + rowY; col += w;
    }
    p.parts.push(part);
  }
  p.mcu = mcu ? (mcu.id || null) : null;
  const colorFor = (pin) => /^GND|^-$|^K$/.test(pin) ? "#111111" : /^5V|^VCC|^\+$|^V\+|^VS|^3V3|^VIN/.test(pin) ? "#d62c2c" : null;
  const palette = ["#2f8f3a", "#2c6bd6", "#e8a800", "#ff7a1a", "#8b2fc9", "#18a3a3"];
  let k = 0;
  for (const [a, b] of c.wires || []) {
    const [pa, ia] = String(a).split("."), [pb, ib] = String(b).split(".");
    const A = p.parts.find((x) => x.id === pa), B = p.parts.find((x) => x.id === pb);
    if (!A || !B) continue;
    const ra = resolvePin(A.type, ia), rb = resolvePin(B.type, ib);
    if (!ra || !rb) continue;
    p.wires.push({ a: { p: A.id, pin: ra }, b: { p: B.id, pin: rb }, color: colorFor(ra) || colorFor(rb) || palette[k++ % palette.length], pts: [] });
  }
  return p;
}

const EXAMPLES = {
  blink: () => {
    const p = emptyProject("Blink on a breadboard");
    p.parts.push({ id: "bb", type: "breadboard_half", x: 0, y: 0, rot: 0, props: {} },
      { id: "uno", type: "uno", x: 2, y: 25, rot: 0, props: {} },
      { id: "r1", type: "resistor", x: 10, y: 4, rot: 0, props: { ohms: 220 } },
      { id: "led1", type: "led", x: 13, y: 6, rot: 0, props: { color: "red" } });
    p.wires.push({ a: { p: "uno", pin: "D13" }, b: { p: "bb", pin: "a10" }, color: "#e8a800", pts: [] },
      { a: { p: "uno", pin: "GND.3" }, b: { p: "bb", pin: "tn2" }, color: "#111111", pts: [] },
      { a: { p: "bb", pin: "a13" }, b: { p: "bb", pin: "tn14" }, color: "#111111", pts: [] });
    p.mcu = "uno"; p.code = BLINK; return p;
  },
  button: () => {
    const p = EXAMPLES.blink(); p.name = "Button turns on the LED";
    p.parts.push({ id: "btn1", type: "button", x: 20, y: 7, rot: 0, props: {} }, { id: "r2", type: "resistor", x: 22, y: 13, rot: 90, props: { ohms: 10000 } });
    p.wires.push({ a: { p: "uno", pin: "5V" }, b: { p: "bb", pin: "tp4" }, color: "#d62c2c", pts: [] },
      { a: { p: "bb", pin: "tp20" }, b: { p: "bb", pin: "a20" }, color: "#d62c2c", pts: [] },
      { a: { p: "bb", pin: "j22" }, b: { p: "uno", pin: "D2" }, color: "#2c6bd6", pts: [] },
      { a: { p: "bb", pin: "bn26" }, b: { p: "bb", pin: "tn26" }, color: "#111111", pts: [[29, 17], [29, 0]] });
    p.code = `// Hold the button (click and hold it while simulating) to light the LED.
// The 10k resistor pulls pin 2 down to LOW when the button is not pressed.
const int buttonPin = 2;
const int ledPin = 13;

void setup() {
  pinMode(buttonPin, INPUT);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int pressed = digitalRead(buttonPin);
  digitalWrite(ledPin, pressed);
  if (pressed) Serial.println("Pressed!");
  delay(50);
}
`;
    return p;
  },
  traffic: () => autoLayout({ parts: [{ id: "uno", type: "uno" }, { id: "rR", type: "resistor", props: { ohms: 220 } }, { id: "red", type: "led", props: { color: "red" } },
    { id: "rY", type: "resistor", props: { ohms: 220 } }, { id: "yellow", type: "led", props: { color: "yellow" } }, { id: "rG", type: "resistor", props: { ohms: 220 } }, { id: "green", type: "led", props: { color: "green" } }],
  wires: [["uno.D12", "rR.1"], ["rR.2", "red.A"], ["red.K", "uno.GND"], ["uno.D11", "rY.1"], ["rY.2", "yellow.A"], ["yellow.K", "uno.GND"], ["uno.D10", "rG.1"], ["rG.2", "green.A"], ["green.K", "uno.GND"]],
  code: `// Traffic light: green 4 s, yellow 1 s, red 4 s.
int red = 12, yellow = 11, green = 10;

void setup() {
  pinMode(red, OUTPUT); pinMode(yellow, OUTPUT); pinMode(green, OUTPUT);
}

void light(int pin, int ms) {
  digitalWrite(red, LOW); digitalWrite(yellow, LOW); digitalWrite(green, LOW);
  digitalWrite(pin, HIGH);
  delay(ms);
}

void loop() {
  light(green, 4000);
  light(yellow, 1000);
  light(red, 4000);
}
` }, "Traffic light"),
  dimmer: () => autoLayout({ parts: [{ id: "uno", type: "uno" }, { id: "pot1", type: "pot", props: { ohms: 10000, pos: 0.3 } }, { id: "r1", type: "resistor", props: { ohms: 220 } }, { id: "led1", type: "led", props: { color: "blue" } }],
    wires: [["pot1.1", "uno.GND"], ["pot1.2", "uno.5V"], ["pot1.W", "uno.A0"], ["uno.D9", "r1.1"], ["r1.2", "led1.A"], ["led1.K", "uno.GND"]],
    code: `// Turn the potentiometer (slider in the Selected panel) to dim the LED.
void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int value = analogRead(A0);          // 0..1023
  int brightness = map(value, 0, 1023, 0, 255);
  analogWrite(9, brightness);          // PWM: pins with ~ only
  Serial.println(value);
  delay(100);
}
` }, "Potentiometer dimmer"),
  nightlight: () => autoLayout({ parts: [{ id: "uno", type: "uno" }, { id: "ldr1", type: "ldr", props: { light: 0.7 } }, { id: "r10k", type: "resistor", props: { ohms: 10000 } }, { id: "r1", type: "resistor", props: { ohms: 220 } }, { id: "led1", type: "led", props: { color: "white" } }],
    wires: [["ldr1.1", "uno.5V"], ["ldr1.2", "uno.A0"], ["r10k.1", "uno.A0"], ["r10k.2", "uno.GND"], ["uno.D7", "r1.1"], ["r1.2", "led1.A"], ["led1.K", "uno.GND"]],
    code: `// Night light: the LED turns on when it gets dark. Move the LDR's "light" slider.
void setup() {
  pinMode(7, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(A0);
  Serial.print("Light: ");
  Serial.println(light);
  if (light < 500) digitalWrite(7, HIGH);
  else digitalWrite(7, LOW);
  delay(200);
}
` }, "Night light (LDR)"),
  servo: () => autoLayout({ parts: [{ id: "uno", type: "uno" }, { id: "servo1", type: "servo" }, { id: "pot1", type: "pot", props: { ohms: 10000, pos: 0.5 } }],
    wires: [["servo1.GND", "uno.GND"], ["servo1.V+", "uno.5V"], ["servo1.SIG", "uno.D9"], ["pot1.1", "uno.GND"], ["pot1.2", "uno.5V"], ["pot1.W", "uno.A0"]],
    code: `#include <Servo.h>
// The servo follows the potentiometer.
Servo myServo;

void setup() {
  myServo.attach(9);
}

void loop() {
  int angle = map(analogRead(A0), 0, 1023, 0, 180);
  myServo.write(angle);
  delay(20);
}
` }, "Servo + potentiometer"),
  melody: () => autoLayout({ parts: [{ id: "uno", type: "uno" }, { id: "bz", type: "buzzer" }], wires: [["uno.D8", "bz.+"], ["bz.-", "uno.GND"]],
    code: `// A little melody on the piezo buzzer.
int notes[] = {262, 294, 330, 349, 392, 440, 494, 523};

void setup() {}

void loop() {
  for (int i = 0; i < 8; i++) {
    tone(8, notes[i], 250);
    delay(300);
  }
  noTone(8);
  delay(1000);
}
` }, "Buzzer melody"),
  thermo: () => autoLayout({ parts: [{ id: "uno", type: "uno" }, { id: "t1", type: "tmp36", props: { celsius: 31 } }, { id: "r1", type: "resistor", props: { ohms: 220 } }, { id: "fan", type: "led", props: { color: "red" } }],
    wires: [["t1.VS", "uno.5V"], ["t1.GND", "uno.GND"], ["t1.OUT", "uno.A0"], ["uno.D6", "r1.1"], ["r1.2", "fan.A"], ["fan.K", "uno.GND"]],
    code: `// Thermometer: reads the TMP36 and warns when it's hot (change "celsius" in the Selected panel).
void setup() {
  pinMode(6, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  float volts = analogRead(A0) * 5.0 / 1023.0;
  float celsius = (volts - 0.5) * 100.0;
  Serial.print(celsius);
  Serial.println(" C");
  digitalWrite(6, celsius > 30 ? HIGH : LOW);
  delay(500);
}
` }, "Thermometer (TMP36)"),
  robot: () => autoLayout({ parts: [{ id: "uno", type: "uno" }, { id: "drv", type: "l293d" }, { id: "motorL", type: "motor" }, { id: "motorR", type: "motor" },
    { id: "sonar", type: "hcsr04", props: { cm: 50 } }, { id: "bat", type: "aa4" }],
  wires: [["drv.VCC1", "uno.5V"], ["drv.EN1", "uno.5V"], ["drv.EN2", "uno.5V"], ["drv.GND", "uno.GND"], ["drv.VCC2", "bat.+"], ["bat.-", "uno.GND"],
    ["uno.D8", "drv.IN1"], ["uno.D9", "drv.IN2"], ["uno.D10", "drv.IN3"], ["uno.D11", "drv.IN4"],
    ["drv.OUT1", "motorL.+"], ["drv.OUT2", "motorL.-"], ["drv.OUT3", "motorR.+"], ["drv.OUT4", "motorR.-"],
    ["sonar.VCC", "uno.5V"], ["sonar.GND", "uno.GND"], ["sonar.TRIG", "uno.D6"], ["sonar.ECHO", "uno.D7"]],
  code: `// Obstacle-avoiding robot car: drives forward, turns when something is closer than 20 cm.
// Change the ultrasonic sensor's distance (Selected panel) to see it react.
const int IN1 = 8, IN2 = 9, IN3 = 10, IN4 = 11;
const int TRIG = 6, ECHO = 7;

void setup() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT); pinMode(IN3, OUTPUT); pinMode(IN4, OUTPUT);
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  Serial.begin(9600);
}

long distanceCm() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH);
  return us / 58;
}

void drive(int a, int b, int c, int d) {
  digitalWrite(IN1, a); digitalWrite(IN2, b); digitalWrite(IN3, c); digitalWrite(IN4, d);
}

void loop() {
  long cm = distanceCm();
  Serial.print("Distance: "); Serial.print(cm); Serial.println(" cm");
  if (cm > 0 && cm < 20) {
    drive(LOW, HIGH, HIGH, LOW);   // spin to turn away
    delay(400);
  } else {
    drive(HIGH, LOW, HIGH, LOW);   // forward
  }
  delay(60);
}
` }, "Robot car (avoids walls)"),
};
const EXAMPLE_NAMES = { blink: "Blink (breadboard)", button: "Button + LED (breadboard)", traffic: "Traffic light", dimmer: "Potentiometer dimmer",
  nightlight: "Night light (LDR)", servo: "Servo + potentiometer", melody: "Buzzer melody", thermo: "Thermometer (TMP36)", robot: "Robot car (avoids walls)" };

// ================================================================== the lab
const lab = {
  project: emptyProject(),
  selection: null,
  simulating: false,
  placing: null,
  wireColor: "#2f8f3a",
  history: [],
  sim: null, ard: null,

  select(sel) { this.selection = sel; v2d.render(); drawProps(); },
  changed(why) {
    if (this.snap) this.history.push(this.snap); if (this.history.length > 60) this.history.shift();
    this.snap = JSON.stringify(this.project);
    v2d.render(); drawProps(); if (!$("stage3d").hidden) v3d?.build(this.project, false);
    autosave();
    void why;
  },
  place(x, y) {
    const type = this.placing; this.placing = null; drawPalette();
    const def = PARTS[type];
    const base = type.replace(/^breadboard_half$/, "bb").replace(/^breadboard$/, "bb");
    let n = 1; while (this.project.parts.some((p) => p.id === `${base}${n}`)) n++;
    const part = { id: `${base}${n}`, type, x, y, rot: 0, props: { ...(def.props || {}) } };
    this.project.parts.push(part);
    if (BOARDS[type] && !this.project.mcu) this.project.mcu = part.id;
    this.selection = { part: part.id };
    this.changed("add");
  },
  press(id, down) { if (!this.sim) return; down ? this.sim.pressed.add(id) : this.sim.pressed.delete(id); this.sim.dirty = true; },
  voltageAt(part, pinId) {
    if (!this.sim) return null;
    const g = this.sim.mcu ? this.sim.v(this.sim.mcu, "GND") : 0;
    return this.sim.v(part, pinId) - g;
  },
};

const v2d = new View2D($("stage2d"), lab);
let v3d = null;

// ---------------- palette ----------------
function icon(type) {
  const def = PARTS[type];
  const pins = pinsOf(type);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pins) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const pad = def.board || def.mcu ? 2 : 4;
  const vb = def.board ? `-1 -1 ${def.w + 1} 20` : def.mcu ? `-1 -1 ${def.w + 1} ${def.h + 2}` : `${x0 - 2} ${y0 - pad - 4} ${x1 - x0 + 4} ${y1 - y0 + pad + 6}`;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", vb);
  s.innerHTML = def.draw2d({ props: def.props || {} });
  return s;
}
function drawPalette() {
  const q = $("partSearch").value.trim().toLowerCase();
  const list = $("partList"); list.replaceChildren();
  for (const cat of CATEGORIES) {
    const items = Object.entries(PARTS).filter(([k, d]) => d.cat === cat && (!q || d.name.toLowerCase().includes(q) || k.includes(q)));
    if (!items.length) continue;
    list.append(h("h4", {}, cat));
    for (const [k, d] of items) list.append(h("button", { class: `pitem${lab.placing === k ? " on" : ""}`, title: `Add ${d.name}`,
      onclick: () => { if (lab.simulating) return toast("Stop the simulation to change the circuit."); lab.placing = lab.placing === k ? null : k; drawPalette(); if (lab.placing) toast(`Click on the canvas to place the ${d.name}.`); } }, icon(k), d.name));
  }
}
$("partSearch").addEventListener("input", drawPalette);

// ---------------- properties ----------------
function drawProps() {
  const box = $("props");
  const sel = lab.selection;
  if (sel?.wire != null) {
    const w = lab.project.wires[sel.wire]; if (!w) { box.replaceChildren(); return; }
    const col = h("select", { onchange: () => { w.color = col.value; lab.changed("wire"); } }, [...$("wireColor").options].map((o) => h("option", { value: o.value, selected: o.value === w.color }, o.textContent)));
    box.replaceChildren(h("p", {}, h("b", {}, "Wire "), `${w.a.p}.${w.a.pin} → ${w.b.p}.${w.b.pin}`), h("label", {}, "Colour", col),
      h("div", { class: "row" }, h("button", { class: "ghost small", onclick: () => { w.pts = []; lab.changed("wire"); } }, "Straighten"),
        h("button", { class: "ghost small", onclick: delSel }, "🗑 Delete")));
    return;
  }
  const part = sel?.part && lab.project.parts.find((p) => p.id === sel.part);
  if (!part) { box.replaceChildren(h("p", { class: "muted" }, "Nothing selected. Click a part or wire.")); return; }
  const def = PARTS[part.type];
  const live = () => { if (lab.sim) lab.sim.dirty = true; v2d.update(lab.sim?.st || {}); };
  const field = [];
  const P = part.props;
  const range = (label, key, min, max, step, fmt) => {
    const out = h("output", {}, fmt(P[key]));
    const r = h("input", { type: "range", min, max, step, value: P[key], oninput: () => { P[key] = +r.value; out.textContent = fmt(P[key]); live(); if (part.type === "pot") v2d.render(); }, onchange: () => autosave() });
    return h("label", {}, h("span", {}, `${label}: `, out), r);
  };
  if (part.type === "resistor") {
    const i = h("input", { value: fmtOhm(+P.ohms).replace(" ", "").replace("Ω", ""), onchange: () => { const v = parseVal(i.value); if (v > 0) { P.ohms = v; lab.changed("prop"); } else toast("Type a value like 220, 4.7k or 1M."); } });
    field.push(h("label", {}, "Resistance (Ω) - e.g. 220, 4.7k, 1M", i),
      h("div", { class: "row" }, [220, 330, 1000, 4700, 10000, 100000].map((v) => h("button", { class: "ghost small", onclick: () => { P.ohms = v; lab.changed("prop"); } }, fmtOhm(v)))));
  }
  if (part.type === "led") field.push(h("label", {}, "Colour", h("select", { onchange: (e) => { P.color = e.target.value; lab.changed("prop"); } }, Object.keys(LED_COLORS).map((c) => h("option", { value: c, selected: c === P.color }, c)))));
  if (part.type === "pot") { field.push(range("Knob", "pos", 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`)); field.push(h("label", {}, "Total resistance", h("input", { value: fmtOhm(+P.ohms), onchange: (e) => { const v = parseVal(e.target.value); if (v > 0) { P.ohms = v; lab.changed("prop"); } } }))); }
  if (part.type === "ldr") field.push(range("Light", "light", 0, 1, 0.01, (v) => v < 0.2 ? "dark" : v > 0.8 ? "bright" : `${Math.round(v * 100)}%`));
  if (part.type === "tmp36") field.push(range("Temperature", "celsius", -40, 125, 1, (v) => `${v} °C`));
  if (part.type === "hcsr04") field.push(range("Distance to obstacle", "cm", 2, 400, 1, (v) => `${v} cm`));
  if (part.type === "switch") field.push(h("button", { class: "ghost small", onclick: () => { P.pos = P.pos === "A" ? "B" : "A"; live(); v2d.render(); } }, `Slide to ${P.pos === "A" ? "B" : "A"}`));
  if (part.type === "capacitor") field.push(h("label", {}, "Capacitance (e.g. 100u, 10n)", h("input", { value: fmtF(+P.farads).replace(" ", "").replace("F", "").replace("µ", "u"), onchange: (e) => { const v = parseVal(e.target.value); if (v > 0) { P.farads = v; lab.changed("prop"); } } })));
  if (["battery9v", "aa4", "coincell"].includes(part.type)) field.push(range("Voltage", "volts", 1, 24, 0.1, (v) => `${v} V`));
  if (part.type === "multimeter") field.push(h("label", {}, "Measure", h("select", { onchange: (e) => { P.mode = e.target.value; lab.changed("prop"); } },
    h("option", { value: "V", selected: P.mode !== "A" }, "Voltage (V) - probes across a part"), h("option", { value: "A", selected: P.mode === "A" }, "Current (mA) - in series"))));
  if (part.type === "button") field.push(h("p", { class: "muted small" }, "While simulating, click and hold the button to press it."));
  if (BOARDS[part.type]) field.push(h("p", { class: "muted small" }, lab.project.mcu === part.id ? "✅ The code runs on this board." : ""),
    lab.project.mcu !== part.id ? h("button", { class: "ghost small", onclick: () => { lab.project.mcu = part.id; drawProps(); updateCodeBoard(); } }, "Run the code on this board") : null);
  const name = h("input", { value: part.id, onchange: () => renamePart(part, name.value) });
  box.replaceChildren(h("p", {}, h("b", {}, def.name)), h("label", {}, "Name", name), ...field,
    h("div", { class: "row" }, h("button", { class: "ghost small", onclick: rotSel }, "⟳ Rotate (R)"), h("button", { class: "ghost small", onclick: delSel }, "🗑 Delete")));
}
function parseVal(s) {
  const m = String(s).trim().replace(/[ΩFf]$/, "").match(/^([\d.]+)\s*([pnuµmkKM]?)$/);
  if (!m) return NaN;
  return +m[1] * ({ p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, "": 1 })[m[2]];
}
function renamePart(part, id) {
  id = id.trim().replace(/[^\w]/g, "");
  if (!id || lab.project.parts.some((p) => p.id === id && p !== part)) return toast("That name is taken or empty.");
  for (const w of lab.project.wires) for (const e of [w.a, w.b]) if (e.p === part.id) e.p = id;
  if (lab.project.mcu === part.id) lab.project.mcu = id;
  part.id = id; lab.selection = { part: id }; lab.changed("rename");
}
function rotSel() {
  if (lab.simulating) return;
  const part = lab.selection?.part && lab.project.parts.find((p) => p.id === lab.selection.part);
  if (part) { part.rot = ((part.rot || 0) + 90) % 360; lab.changed("rotate"); }
}
function delSel() {
  if (lab.simulating) return toast("Stop the simulation first.");
  const s = lab.selection; if (!s) return;
  if (s.wire != null) lab.project.wires.splice(s.wire, 1);
  else if (s.part) {
    lab.project.parts = lab.project.parts.filter((p) => p.id !== s.part);
    lab.project.wires = lab.project.wires.filter((w) => w.a.p !== s.part && w.b.p !== s.part);
    if (lab.project.mcu === s.part) lab.project.mcu = lab.project.parts.find((p) => BOARDS[p.type])?.id || null;
  }
  lab.selection = null; lab.changed("delete");
}
function undo() {
  const prev = lab.history.pop(); if (!prev || lab.simulating) return;
  lab.project = JSON.parse(prev); lab.snap = prev; lab.selection = null; v2d.render(); drawProps(); loadCode(); if (!$("stage3d").hidden) v3d?.build(lab.project, false);
}

document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === "Escape") { v2d.cancelWire(); lab.placing = null; drawPalette(); }
  if (typing) return;
  if (e.key === "r" || e.key === "R") rotSel();
  if (e.key === "Delete" || e.key === "Backspace") delSel();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
});

// ---------------- code editor ----------------
const code = $("code");
function loadCode() { code.value = lab.project.code || ""; lines(); updateCodeBoard(); }
function lines() { $("lineNos").textContent = Array.from({ length: code.value.split("\n").length }, (_, i) => i + 1).join("\n"); }
function updateCodeBoard() { const b = lab.project.parts.find((p) => p.id === lab.project.mcu); $("codeBoard").textContent = b ? `runs on ${b.id} (${PARTS[b.type].name})` : "add an Arduino to run code"; }
code.addEventListener("input", () => { lab.project.code = code.value; lines(); autosave(); });
code.addEventListener("scroll", () => { $("lineNos").scrollTop = code.scrollTop; });
code.addEventListener("keydown", (e) => {
  if (e.key === "Tab") { e.preventDefault(); const s = code.selectionStart; code.setRangeText("  ", s, code.selectionEnd, "end"); code.dispatchEvent(new Event("input")); }
});
$("codeHelp").addEventListener("click", () => modal(h("div", {}, h("h3", {}, "What the simulator understands"),
  h("p", {}, "Arduino C++ basics: setup() and loop(), variables, if/else, for/while, your own functions, arrays, #define."),
  h("p", {}, "pinMode, digitalWrite, digitalRead, analogWrite (PWM ~ pins), analogRead, delay, delayMicroseconds, millis, micros, map, constrain, random, ",
    "Serial.begin/print/println/available/read/parseInt, tone/noTone, pulseIn (HC-SR04), and the Servo library (attach, write, read)."),
  h("p", { class: "muted" }, "It isn't a real compiler: integer maths isn't truncated, and libraries other than Servo aren't available. For real boards, use the Arduino IDE."))));

// ---------------- serial ----------------
let serialText = "";
function serialOut(t) { serialText = (serialText + t).slice(-6000); const el = $("serial"); el.textContent = serialText; el.scrollTop = el.scrollHeight; }
$("serialClear").addEventListener("click", () => { serialText = ""; $("serial").textContent = ""; });
$("serialForm").addEventListener("submit", (e) => { e.preventDefault(); if (lab.ard) lab.ard.serialIn += $("serialIn").value + "\n"; $("serialIn").value = ""; });

// ---------------- warnings + sound ----------------
const warnings = [];
function warn(t) { warnings.push(t); const box = $("warnings"); const d = h("div", {}, t); box.append(d); setTimeout(() => d.remove(), 9000); }
let audio = null, osc = null;
function sound(freq) {
  try {
    if (!freq) { if (osc) { osc.stop(); osc = null; } return; }
    audio ||= new AudioContext();
    if (!osc) { osc = audio.createOscillator(); const g = audio.createGain(); g.gain.value = 0.05; osc.type = "square"; osc.connect(g); g.connect(audio.destination); osc.start(); }
    osc.frequency.value = freq;
  } catch { /* no sound */ }
}

// ---------------- simulation ----------------
let raf = 0, last = 0;
async function startSim() {
  if (lab.simulating) return stopSim();
  v2d.cancelWire(); lab.placing = null;
  warnings.length = 0; $("warnings").replaceChildren();
  lab.sim = new Simulator(lab.project, { warn, sound });
  const board = lab.sim.mcu;
  lab.simulating = true;
  $("btnSim").textContent = "■ Stop simulation"; $("btnSim").classList.add("on"); $("simBadge").hidden = false;
  if (board && lab.project.code.trim()) {
    lab.ard = new Arduino(lab.sim, board, { serial: serialOut, warn, error: (e) => { warn(`Code error: ${e.message}`); } });
    try { await lab.ard.start(lab.project.code); }
    catch (e) { warn(e.message); lab.ard = null; }
  }
  last = performance.now();
  const frame = (t) => {
    if (!lab.simulating) return;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    lab.sim.solve(dt || 0.016);
    v2d.update(lab.sim.st);
    if (!$("stage3d").hidden) v3d?.update(lab.sim.st);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  // if the window isn't drawing (minimised / hidden), keep the circuit running anyway
  clearInterval(lab.watchdog);
  lab.watchdog = setInterval(() => { if (lab.simulating && performance.now() - last > 150) frame(performance.now()); }, 150);
}
function stopSim() {
  lab.simulating = false; cancelAnimationFrame(raf); clearInterval(lab.watchdog);
  lab.ard?.stop(); lab.ard = null; lab.sim = null; sound(null);
  $("btnSim").textContent = "▶ Start simulation"; $("btnSim").classList.remove("on"); $("simBadge").hidden = true;
  v2d.render(); if (!$("stage3d").hidden) { v3d.build(lab.project, false); v3d.update({}); }
}
$("btnSim").addEventListener("click", startSim);

// ---------------- 2D / 3D ----------------
async function show3d(on) {
  $("v2d").classList.toggle("on", !on); $("v3d").classList.toggle("on", on);
  $("stage2d").hidden = on; $("stage3d").hidden = !on;
  if (on) {
    if (!v3d) { const { View3D } = await import("./view3d.js"); v3d = new View3D($("stage3d")); }
    v3d.build(lab.project); v3d.start(); if (lab.sim) v3d.update(lab.sim.st);
  } else v3d?.stop();
}
$("v2d").addEventListener("click", () => show3d(false));
$("v3d").addEventListener("click", () => show3d(true));
$("wireColor").addEventListener("change", (e) => { lab.wireColor = e.target.value; });

// ---------------- saving ----------------
let saveTimer = 0;
function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem("circuitLab.autosave", JSON.stringify(lab.project)); } catch { /* full */ } }, 600); }
async function save() {
  lab.project.name = $("projName").value.trim() || "My circuit";
  const r = await py("elec_save", lab.project.name, lab.project);
  if (r?.error) return toast(r.error);
  if (!r) { try { const all = JSON.parse(localStorage.getItem("circuitLab.projects") || "{}"); all[lab.project.name] = lab.project; localStorage.setItem("circuitLab.projects", JSON.stringify(all)); } catch { /* ignore */ } }
  toast(`Saved “${lab.project.name}”.`);
}
async function openDialog() {
  let list = await py("elec_projects");
  const local = !list;
  if (local) { try { list = Object.keys(JSON.parse(localStorage.getItem("circuitLab.projects") || "{}")).map((name) => ({ name, saved: "" })); } catch { list = []; } }
  modal(h("div", {}, h("h3", {}, "Open a project"), list.length ? h("ul", {}, list.map((p) => h("li", {}, h("span", {}, p.name, " ", h("small", { class: "muted" }, p.saved)),
    h("button", { class: "small", onclick: async () => { closeModal(); await openProject(p.name, local); } }, "Open")))) : h("p", { class: "muted" }, "No saved projects yet.")));
}
async function openProject(name, local = false) {
  let data = null;
  if (!local) { const r = await py("elec_load", name); if (r?.error) return toast(r.error); data = r?.data; }
  if (!data) { try { data = JSON.parse(localStorage.getItem("circuitLab.projects") || "{}")[name]; } catch { /* ignore */ } }
  if (data) setProject(data);
}
function setProject(p) {
  if (lab.simulating) stopSim();
  lab.project = { ...emptyProject(), ...p, parts: (p.parts || []).filter((x) => PARTS[x.type]), wires: p.wires || [] };
  lab.selection = null; lab.history = []; lab.snap = JSON.stringify(lab.project);
  $("projName").value = lab.project.name || "My circuit";
  loadCode(); v2d.render(); requestAnimationFrame(() => v2d.fit()); drawProps();
  if (!$("stage3d").hidden) v3d?.build(lab.project);
  autosave();
}
$("btnSave").addEventListener("click", save);
$("btnOpen").addEventListener("click", openDialog);
$("btnNew").addEventListener("click", () => { if (confirm("Start a new empty circuit? (Save first if you want to keep this one.)")) setProject(emptyProject()); });
for (const [k, n] of Object.entries(EXAMPLE_NAMES)) $("examples").append(h("option", { value: k }, n));
$("examples").addEventListener("change", (e) => { const k = e.target.value; e.target.value = ""; if (k) setProject(EXAMPLES[k]()); });
$("back").addEventListener("click", () => { stopSim(); location.href = "../index.html"; });

function modal(content) { $("modalBody").replaceChildren(content); $("modal").hidden = false; }
function closeModal() { $("modal").hidden = true; }
$("modalClose").addEventListener("click", closeModal);

// ---------------- "Check my circuit" (Vermeil) ----------------
function describe() {
  const P = lab.project;
  const nets = buildNets(P);
  const groups = new Map();
  for (const [key, n] of nets.netOf) {
    const [pid, pin] = key.split(":");
    const part = P.parts.find((x) => x.id === pid);
    if (!part || part.type.startsWith("breadboard")) continue;
    (groups.get(n) || groups.set(n, []).get(n)).push(`${pid}.${pin}`);
  }
  const connections = [...groups.values()].filter((g) => g.length > 1);
  const unconnected = [...groups.values()].filter((g) => g.length === 1).map((g) => g[0]);
  const readings = {};
  if (lab.sim) for (const [id, s] of Object.entries(lab.sim.st)) readings[id] = Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v !== "object").map(([k, v]) => [k, typeof v === "number" ? +v.toFixed(4) : v]));
  return { parts: P.parts.filter((x) => !x.type.startsWith("breadboard")).map((x) => ({ id: x.id, type: PARTS[x.type].name, props: x.props })),
    connections, unconnected_pins: unconnected.slice(0, 60), code_runs_on: P.mcu, code: P.code, simulating: lab.simulating,
    readings, warnings: warnings.slice(-10), serial_output: serialText.slice(-800) };
}
$("btnAsk").addEventListener("click", () => { $("drawer").hidden = !$("drawer").hidden; });
$("drawerClose").addEventListener("click", () => { $("drawer").hidden = true; });
$("askGo").addEventListener("click", async () => {
  const out = $("askOut");
  try { translate(lab.project.code); } catch (e) { /* the AI will see it too */ void e; }
  out.textContent = "Vermeil is looking at your circuit…";
  const r = await py("elec_ask", "circuit", $("askQ").value, describe());
  if (!r) { out.textContent = "Open the Circuit Lab from Vermeil to use this (it needs her AI)."; return; }
  if (r.error) { out.textContent = r.error; return; }
  setMd(out, r.answer, null);
  if (r.lab) out.append(h("button", { onclick: () => setProject(autoLayout(r.lab, "Fixed by Vermeil")) }, "Load her fixed circuit"));
});

// ---------------- start ----------------
(async () => {
  drawPalette();
  let start = null;
  const pending = await py("elec_pending");
  if (pending?.project) { await openProject(pending.project); start = "done"; }
  else if (pending?.parts) { setProject(autoLayout(pending, pending.name || "From Vermeil")); start = "done"; toast("Here's the circuit from the assistant. Press ▶ Start simulation."); }
  if (!start) {
    let saved = null; try { saved = JSON.parse(localStorage.getItem("circuitLab.autosave") || "null"); } catch { /* ignore */ }
    setProject(saved?.parts?.length ? saved : EXAMPLES.blink());
  }
})();
window.__lab = lab;      // for testing
