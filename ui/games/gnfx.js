// gnfx.js - Game Night's sounds and effects: little synth sounds (made in the browser, no files), confetti,
// floating emoji bursts, a screen shake and a flash. Sounds follow the Games hub's mute button.
import { isMuted } from "../psp.js";

let ac = null, out = null;
function audio() {
  if (isMuted()) return null;
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)();
    if (!out) { out = ac.createGain(); out.gain.value = 0.32; out.connect(ac.destination); }
    if (ac.state === "suspended") ac.resume();
    return ac;
  } catch { return null; }
}
function tone(f, at, len, { type = "triangle", vol = 0.5, slide = 0 } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, at);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, f * slide), at + len);
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(out); o.start(at); o.stop(at + len + 0.02);
}
function noise(at, len, { freq = 2000, q = 1, vol = 0.4, sweep = 0 } = {}) {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = buf; f.type = "bandpass"; f.frequency.setValueAtTime(freq, at); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, at + len);
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  s.connect(f).connect(g).connect(out); s.start(at);
}
const N = (m) => 440 * 2 ** ((m - 69) / 12);

/** play a sound: win, lose, draw, good, bad, move, capture, card, flip, tick, pop, poke, solve, start */
export function sound(kind) {
  if (!audio()) return;
  const t = ac.currentTime + 0.01;
  ({
    win: () => [72, 76, 79, 84].forEach((m, i) => { tone(N(m), t + i * 0.09, 0.32, { vol: 0.45 }); tone(N(m + 12), t + i * 0.09, 0.2, { type: "sine", vol: 0.15 }); }),
    solve: () => [79, 84, 88, 91].forEach((m, i) => tone(N(m), t + i * 0.07, 0.4, { type: "sine", vol: 0.4 })),
    lose: () => [67, 63, 58].forEach((m, i) => tone(N(m), t + i * 0.18, 0.34, { type: "sawtooth", vol: 0.16, slide: 0.94 })),
    draw: () => { tone(N(72), t, 0.25); tone(N(72), t + 0.18, 0.3, { vol: 0.35 }); },
    good: () => { tone(N(81), t, 0.12, { type: "sine" }); tone(N(88), t + 0.08, 0.22, { type: "sine" }); },
    bad: () => tone(N(45), t, 0.28, { type: "square", vol: 0.12, slide: 0.8 }),
    move: () => { noise(t, 0.06, { freq: 900, q: 3, vol: 0.5 }); tone(N(52), t, 0.08, { type: "sine", vol: 0.35 }); },
    capture: () => { noise(t, 0.1, { freq: 600, q: 2, vol: 0.6 }); tone(N(60), t, 0.12, { type: "square", vol: 0.12, slide: 0.6 }); },
    card: () => noise(t, 0.16, { freq: 1200, q: 0.8, vol: 0.35, sweep: 4 }),
    flip: () => noise(t, 0.08, { freq: 3000, q: 1.5, vol: 0.3, sweep: 0.5 }),
    tick: () => tone(N(96), t, 0.04, { type: "sine", vol: 0.2 }),
    pop: () => tone(N(84), t, 0.09, { type: "sine", vol: 0.18, slide: 1.4 }),
    poke: () => tone(N(64), t, 0.3, { type: "sine", vol: 0.4, slide: 2.2 }),
    start: () => [60, 67, 72].forEach((m, i) => tone(N(m), t + i * 0.06, 0.18, { vol: 0.3 })),
  })[kind]?.();
}

// ---------------- effects ----------------
let layer = null;
function canvasLayer() {
  if (layer) return layer;
  const cv = document.createElement("canvas");
  cv.className = "gn-fx"; cv.setAttribute("aria-hidden", "true");
  document.body.append(cv);
  layer = { cv, ctx: cv.getContext("2d"), parts: [], running: false };
  const size = () => { cv.width = innerWidth; cv.height = innerHeight; };
  size(); addEventListener("resize", size);
  return layer;
}
function run() {
  const L = layer;
  if (L.running) return;
  L.running = true;
  let last = performance.now();
  (function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    L.ctx.clearRect(0, 0, L.cv.width, L.cv.height);
    L.parts = L.parts.filter((p) => (p.life -= dt) > 0);
    for (const p of L.parts) {
      p.vy += 600 * dt * (p.g ?? 1); p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      L.ctx.save(); L.ctx.translate(p.x, p.y); L.ctx.rotate(p.r); L.ctx.globalAlpha = Math.min(1, p.life * 2);
      if (p.emoji) { L.ctx.font = `${p.size}px serif`; L.ctx.textAlign = "center"; L.ctx.fillText(p.emoji, 0, 0); }
      else { L.ctx.fillStyle = p.c; L.ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
      L.ctx.restore();
    }
    if (L.parts.length) requestAnimationFrame(frame); else { L.running = false; L.ctx.clearRect(0, 0, L.cv.width, L.cv.height); }
  })(last);
}
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--blue").trim() || "#3e8eff";

/** confetti from the top of the screen (a win) */
export function confetti(n = 140) {
  if (reduced()) return;
  const L = canvasLayer(), colors = [accent(), "#f5c542", "#ff6b81", "#4cc38a", "#c86bff", "#ffffff"];
  for (let i = 0; i < n; i++) {
    L.parts.push({ x: Math.random() * innerWidth, y: -20 - Math.random() * 200, vx: (Math.random() - 0.5) * 220, vy: Math.random() * 120,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 12, size: 8 + Math.random() * 8, c: colors[i % colors.length], life: 2.6 + Math.random() * 1.4, g: 0.35 });
  }
  run();
}
/** a few emoji jumping out of an element (or the middle of the screen) */
export function burst(emoji = "✨", from = null, n = 10) {
  if (reduced()) return;
  const L = canvasLayer(), r = from?.getBoundingClientRect?.() || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
  const list = [].concat(emoji);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 220 + Math.random() * 260;
    L.parts.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 0, vr: (Math.random() - 0.5) * 4,
      size: 20 + Math.random() * 14, emoji: list[i % list.length], life: 1 + Math.random() * 0.6, g: 0.9 });
  }
  run();
}
/** shake an element (a loss, a wrong answer) */
export function shake(el) {
  if (!el || reduced()) return;
  el.classList.remove("fx-shake"); void el.offsetWidth; el.classList.add("fx-shake");
}
/** a short coloured glow over the whole screen */
export function flash(color = accent()) {
  if (reduced()) return;
  const d = document.createElement("div");
  d.className = "gn-flash"; d.style.setProperty("--c", color);
  document.body.append(d);
  setTimeout(() => d.remove(), 700);
}
