// The Games hub's look and sound, like a PSP menu: slow glowing waves behind everything (in your Vermeil theme
// colours), a soft ambient tune, and little clicks and chimes when you point at or press things.
// Everything here is made in the browser - no picture or music files.

const css = (name, fb) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
const rgb = (hex) => { const n = parseInt((hex || "#000000").replace("#", "").slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const busy = () => document.hidden || document.body.classList.contains("playing");     // a retro game is on screen

// ---------------- the waves ----------------
export function startWaves() {
  const cv = document.createElement("canvas");
  cv.className = "hub-waves"; cv.setAttribute("aria-hidden", "true");
  document.body.prepend(cv);
  const ctx = cv.getContext("2d");
  let W = 0, H = 0, colors = null, last = 0;
  const size = () => {
    const k = Math.min(1.5, window.devicePixelRatio || 1);          // a soft picture doesn't need the full screen resolution
    W = cv.width = Math.round(innerWidth * k); H = cv.height = Math.round(innerHeight * k);
  };
  const theme = () => {
    const bg = rgb(css("--black", "#0d1117")), ac = rgb(css("--blue", "#3e8eff"));
    const light = bg[0] + bg[1] + bg[2] > 384;
    colors = { bg, ac, light };
  };
  size(); theme();
  addEventListener("resize", size);
  // waves: [height on screen, size, speed, wavelength, how see-through]
  const waves = [[0.62, 0.10, 0.22, 1.6, 0.20], [0.66, 0.07, -0.16, 2.3, 0.16], [0.58, 0.12, 0.12, 1.1, 0.10], [0.70, 0.05, 0.3, 3.1, 0.22]];
  const frame = (now) => {
    requestAnimationFrame(frame);
    if (busy() || now - last < 33) return;               // ~30 frames a second is plenty for slow waves
    last = now;
    const t = now / 1000, { bg, ac, light } = colors;
    // the background: your theme colour, a little lighter toward the bottom right (like the PSP's gradient)
    const g = ctx.createLinearGradient(0, 0, W, H);
    const mix = (k) => bg.map((v, i) => Math.round(v + (ac[i] - v) * k));
    g.addColorStop(0, `rgb(${mix(0.02)})`); g.addColorStop(0.6, `rgb(${mix(0.10)})`); g.addColorStop(1, `rgb(${mix(0.22)})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = light ? "source-over" : "lighter";
    for (const [y0, amp, sp, len, alpha] of waves) {
      const yb = H * y0, A = H * amp, step = Math.max(8, W / 90);
      ctx.beginPath();
      for (let x = 0; x <= W + step; x += step) {
        const u = x / W;
        const y = yb + Math.sin(u * Math.PI * len + t * sp * 2.2) * A * 0.6 + Math.sin(u * Math.PI * len * 2.1 - t * sp * 1.4 + 1.3) * A * 0.4;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      const fill = ctx.createLinearGradient(0, yb - A, 0, H);
      fill.addColorStop(0, `rgba(${ac},${alpha})`); fill.addColorStop(0.35, `rgba(${ac},${alpha * 0.25})`); fill.addColorStop(1, `rgba(${ac},0)`);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${light ? 0.35 : alpha * 1.4})`; ctx.lineWidth = Math.max(1, H / 700);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  };
  requestAnimationFrame(frame);
}

// ---------------- sound (the engine is ../psp.js, shared with the main room) ----------------
import * as psp from "../psp.js";
export const { sfx, musicStop } = psp;
const MUTE_KEY = "vermeil_hub_mute";
try { psp.setMuted(localStorage.getItem(MUTE_KEY) === "1"); } catch { /* private window */ }

export const musicStart = () => psp.musicStart("hub");
export function setMuted(on) {
  psp.setMuted(on);
  try { localStorage.setItem(MUTE_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}
export const isMuted = psp.isMuted;

/** sounds for every button and card: a tick when you point at one, a click when you press it */
export function wireSounds(root = document) {
  let over = null;
  root.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("button, .hub-card, a, .rg-card, [role=button]");
    if (el && el !== over && !el.disabled && el.getAttribute("aria-disabled") !== "true") sfx("hover");
    over = el;
  });
  root.addEventListener("focusin", (e) => { if (e.target.matches?.(":focus-visible")) sfx("hover"); });
  root.addEventListener("click", (e) => {
    const el = e.target.closest?.("button, .hub-card, a, .rg-card, [role=button]");
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
    const k = el.dataset.sfx || (/back|cancel|confirmNo|stBack|stHub|rgBackHub/i.test(el.id) ? "back" : "click");
    sfx(k);
  }, true);
  // the music starts straight away (the Vermeil app allows that); in a normal browser it waits for your first click
  if (!busy()) musicStart();
  // a retro game has its own sound: the hub music rests while one is on screen, and while the window is hidden
  new MutationObserver(() => (busy() ? musicStop() : musicStart())).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", () => (busy() ? musicStop(0.2) : musicStart()));
}
