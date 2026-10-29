// fx.js - night-mode effects: sound effects (made in code, works offline), click ripples, sparks,
// panel glow, typing dots and the startup sequence.
// Settings (saved): sfx on/off, sfx volume, effects on/off. Reduced-motion users get no motion effects.

import * as psp from "./psp.js";      // the PSP-style menu sounds (shared with the Games hub)

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const opts = { sfx: true, volume: 0.5, fx: true };
let ctx = null, master = null;

export function configure(o = {}) {
  Object.assign(opts, Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)));
  if (master) master.gain.value = opts.volume * 0.6;
  psp.setSfxVolume(opts.sfx ? opts.volume : 0);
  document.body.classList.toggle("fx-off", !opts.fx || reduceMotion);
}
export const settings = () => ({ ...opts });

// ---------------------------------------------------------------- sound
function audio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = opts.volume * 0.6;
      master.connect(ctx.destination);
    } catch { return null; }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// one soft tone: freq (Hz) gliding to `to`, with a quick attack and smooth fade
function tone(freq, { to = freq, at = 0, dur = 0.12, type = "sine", gain = 0.35 } = {}) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// filtered noise "whoosh" for panels opening/closing
function whoosh(up = true, { dur = 0.22, gain = 0.18 } = {}) {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  src.buffer = buf;
  f.type = "bandpass"; f.Q.value = 1.4;
  f.frequency.setValueAtTime(up ? 500 : 2400, t);
  f.frequency.exponentialRampToValueAtTime(up ? 2600 : 450, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

let lastNotify = 0;
function playNotifyChime() {
  if (performance.now() - lastNotify < 280) return;
  lastNotify = performance.now();
  psp.sfx("notify");
  [587.33, 880, 1174.66, 1567.98].forEach((f, i) => tone(f, { dur: 0.24, gain: 0.18, at: i * 0.085, type: "triangle" }));
}

const SOUNDS = {
  hover: () => psp.sfx("hover"),
  tap: () => psp.sfx("click"),
  open: () => { whoosh(true, { gain: 0.08 }); psp.sfx("open"); },
  close: () => { whoosh(false, { dur: 0.16, gain: 0.06 }); psp.sfx("close"); },
  start: () => psp.sfx("start"),
  send: () => { tone(700, { dur: 0.06, gain: 0.16 }); tone(1050, { dur: 0.09, gain: 0.14, at: 0.06 }); },
  receive: () => { tone(660, { dur: 0.22, gain: 0.14, type: "triangle" }); tone(990, { dur: 0.3, gain: 0.1, type: "triangle", at: 0.09 }); },
  toast: () => tone(880, { to: 1320, dur: 0.08, gain: 0.12 }),
  alert: () => playNotifyChime(),
  notify: () => playNotifyChime(),
  success: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, { dur: 0.16, gain: 0.12, at: i * 0.06, type: "triangle" })),
  error: () => { tone(180, { to: 120, dur: 0.22, gain: 0.14, type: "square" }); },
  on: () => tone(600, { to: 1200, dur: 0.12, gain: 0.14 }),
  off: () => tone(1100, { to: 500, dur: 0.12, gain: 0.12 }),
  listen: () => { tone(880, { dur: 0.07, gain: 0.12 }); tone(1320, { dur: 0.1, gain: 0.12, at: 0.07 }); },
};

export function play(name) {
  if (!opts.sfx || !SOUNDS[name]) return;
  try { SOUNDS[name](); } catch { /* sound is optional */ }
}

// ---------------------------------------------------------------- visual effects
const motionOk = () => opts.fx && !reduceMotion;

export function ripple(el, x, y) {
  if (!motionOk() || !el) return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement("span");
  s.className = "fx-ripple";
  s.style.cssText = `width:${size}px;height:${size}px;left:${x - r.left - size / 2}px;top:${y - r.top - size / 2}px`;
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  el.classList.add("fx-host");
  el.append(s);
  s.addEventListener("animationend", () => s.remove());
}

export function sparks(x, y, n = 14) {
  if (!motionOk()) return;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("i");
    p.className = "fx-spark";
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = 28 + Math.random() * 34;
    p.style.cssText = `left:${x}px;top:${y}px;--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px;` +
      `animation-delay:${Math.random() * 40}ms`;
    document.body.append(p);
    p.addEventListener("animationend", () => p.remove());
  }
}

let typing = null;
export function thinking(on) {
  const log = document.getElementById("log");
  if (on && log && !typing) {
    typing = document.createElement("li");
    typing.className = "her fx-typing";
    typing.setAttribute("aria-label", "Thinking");
    typing.innerHTML = "<i></i><i></i><i></i>";
    log.append(typing);
    typing.scrollIntoView({ block: "end" });
  } else if (!on && typing) {
    typing.remove();
    typing = null;
  }
}

export function speaking(on) {
  document.body.classList.toggle("is-speaking", !!on);
}

// ---------------------------------------------------------------- wiring
export function init(settingsFromApp = {}) {
  configure(settingsFromApp);

  // every click on something pressable: tap sound + ripple
  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest("button, [role=button], .item, .choice, summary");
    if (!el || el.disabled) return;
    if (!el.matches(".tick, [data-panel], .close, #voiceBtn, #cameraBtn, #adventureBtn")) play("tap");
    ripple(el, e.clientX, e.clientY);
    if (el.matches(".tick:not(.on)")) {                 // finishing a gym set
      const r = el.getBoundingClientRect();
      sparks(r.left + r.width / 2, r.top + r.height / 2);
      play("success");
    }
  }, { passive: true });

  // a soft tick when the mouse moves onto a menu item or button (like moving through the PSP menu)
  let over = null;
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.(".item, button, [role=button], .choice, summary");
    if (el && el !== over && !el.disabled && !el.closest(".item-tools, .paint-pop")) play("hover");
    over = el;
  }, { passive: true });

  // panels opening / closing
  const panelObs = new MutationObserver((muts) => {
    let opened = false, closed = false;
    for (const m of muts) (m.target.hidden ? (closed = true) : (opened = true));
    if (opened) play("open"); else if (closed) play("close");
  });
  for (const p of document.querySelectorAll(".panel")) panelObs.observe(p, { attributes: true, attributeFilter: ["hidden"] });

  // pop-up messages
  const toastEl = document.getElementById("toast");
  if (toastEl) {
    new MutationObserver(() => {
      if (toastEl.hidden) return;
      const t = toastEl.textContent || "";
      play(/^⏰/.test(t) ? "alert" : /(couldn't|can't|error|isn't|failed|missing|not )/i.test(t) ? "error" : "toast");
      toastEl.classList.remove("fx-pop"); void toastEl.offsetWidth; toastEl.classList.add("fx-pop");
      if (/^(✓|♥|saved|added|done|installed|copied|made|switched|imported|created)|(saved|added|installed)/i.test(t) && opts.fx !== false) {
        requestAnimationFrame(() => { const r = toastEl.getBoundingClientRect(); if (r.width) sparks(r.left + r.width / 2, r.top, 10); });
      }
    }).observe(toastEl, { attributes: true, attributeFilter: ["hidden"], childList: true, characterData: true, subtree: true });
  }

  // chat log: your message vs her reply
  const log = document.getElementById("log");
  if (log) {
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (!(n instanceof HTMLElement) || n.classList.contains("fx-typing")) continue;
        if (n.classList.contains("you")) play("send");
        if (n.classList.contains("her")) { thinking(false); play("receive"); }
      }
    }).observe(log, { childList: true });
  }

  // voice + camera toggles
  for (const id of ["voiceBtn", "cameraBtn"]) {
    const b = document.getElementById(id);
    if (b) new MutationObserver(() => play(b.getAttribute("aria-pressed") === "true" ? "on" : "off"))
      .observe(b, { attributes: true, attributeFilter: ["aria-pressed"] });
  }

  // the one startup moment: the blue edge draws in, then the menu items arrive
  if (motionOk()) {
    document.body.classList.add("fx-intro");
    setTimeout(() => document.body.classList.remove("fx-intro"), 1600);
  }
}


// ---------------- alarm (timers): loud, repeating, plays even when the soft sound effects are off ----------------
let alarmStop = null;
export let alarmVolume = 0.9;
export function setAlarmVolume(v) { alarmVolume = Math.max(0, Math.min(1, Number(v) || 0)); }

/** Ring like an alarm clock: 4 bursts of "beep-beep-beep" over ~4 s. Returns a function that stops it early. */
export function alarm({ bursts = 4, volume = alarmVolume } = {}) {
  stopAlarm();
  const a = audio(); if (!a || volume <= 0) return () => {};
  const out = a.createGain();
  const comp = a.createDynamicsCompressor();          // makes it loud without crackling
  comp.threshold.value = -20; comp.ratio.value = 6;
  out.gain.value = volume;
  out.connect(comp); comp.connect(a.destination);
  const t0 = a.currentTime + 0.02;
  const nodes = [];
  for (let b = 0; b < bursts; b++) {
    for (let i = 0; i < 3; i++) {
      const t = t0 + b * 1.0 + i * 0.16;
      for (const [freq, type, g] of [[1046, "square", 0.32], [2093, "sine", 0.18]]) {
        const o = a.createOscillator(), env = a.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(g, t + 0.01);
        env.gain.setValueAtTime(g, t + 0.1);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        o.connect(env); env.connect(out);
        o.start(t); o.stop(t + 0.15);
        nodes.push(o);
      }
    }
  }
  const timer = setTimeout(() => { alarmStop = null; }, bursts * 1000 + 200);
  alarmStop = () => { clearTimeout(timer); for (const o of nodes) { try { o.stop(); } catch { /* already stopped */ } } out.disconnect(); alarmStop = null; };
  if (opts.fx) document.body.classList.add("alarm-flash"), setTimeout(() => document.body.classList.remove("alarm-flash"), bursts * 1000);
  return alarmStop;
}
export function stopAlarm() { if (alarmStop) alarmStop(); document.body.classList.remove("alarm-flash"); }
