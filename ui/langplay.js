// langplay.js - Study -> Language extras: role-play scenes, 🐢 slow speech, shadowing, word bank, the writing
// trainer (draw a character, she checks it), the weekly report, and the word-by-word accent score (green / red).
import { el, toast, busy, loadingCard } from "./util.js";
import { play } from "./fx.js";

/** the word-by-word result of a pronunciation check: green words were heard, red ones tap to hear */
export function accentWords(api, words, lang) {
  if (!words || !words.length) return null;
  return el("p", { class: "accent-words" }, words.map((w) => el("span", {
    class: w.ok ? "ok" : "bad", title: w.ok ? "Heard clearly" : "Not heard clearly — tap to hear it",
    onclick: w.ok ? null : async () => { const r = await api.sensei_say(w.text, lang); if (r.error) toast(r.error); } }, w.text)));
}

export function initLangExtras(api, { langSel, levelSel, topicIn, out }) {
  const lang = () => langSel.value;

  // ---------- role-play scenes (used by 🎙 Talk live) ----------
  const sceneSel = el("select", { "aria-label": "Role-play scene", title: "Talk live as a role-play: she plays the waiter, the receptionist, the interviewer…" },
    el("option", { value: "" }, "🎭 Free talk (no scene)"));
  api.sensei_scenes().then((list) => sceneSel.append(...list.map((s) => el("option", { value: s.id }, s.label)))).catch(() => {});

  // ---------- 🐢 slow / 🐇 normal speed for everything she says in the language ----------
  const speedBtn = el("button", { class: "ghost small", title: "How fast she speaks the language you learn" });
  const drawSpeed = (v) => { speedBtn.textContent = v === "slow" ? "🐢 Slow speech" : "🐇 Normal speed"; speedBtn.dataset.v = v; };
  speedBtn.addEventListener("click", async () => drawSpeed(await api.sensei_speed(speedBtn.dataset.v === "slow" ? "normal" : "slow")));
  api.sensei_speed().then(drawSpeed).catch(() => drawSpeed("normal"));

  const say = async (text) => { const r = await api.sensei_say(text, lang()); if (r.error) toast(r.error, 6000); };

  // ---------- shadowing: hear a line, say it right after her ----------
  async function shadowing(btn) {
    busy(btn, true, "Making lines…");
    out.replaceChildren(loadingCard("Writing short lines to repeat…"));
    try {
      const r = await api.sensei_shadow(lang(), topicIn.value);
      if (r.error) { out.replaceChildren(); return toast(r.error, 7000); }
      out.replaceChildren(el("h3", {}, "🗣 Shadowing"),
        el("p", { class: "note" }, "Press 🔊, then say the same line right after her, copying her rhythm. 🎙 checks each word."),
        el("ol", { class: "shadow-list" }, r.lines.map((l) => {
          const res = el("div");
          return el("li", {}, el("div", { class: "row" }, el("b", { class: "shadow-text" }, l.text),
            el("button", { class: "ghost small", onclick: () => say(l.text) }, "🔊"),
            el("button", { class: "primary small", onclick: async (e) => {
              await say(l.text);
              await new Promise((ok) => setTimeout(ok, 400 + 90 * l.text.length));
              busy(e.target, true, "🎙 Your turn…");
              try {
                const p = await api.sensei_pronounce(l.text, lang(), Math.min(9, 3 + Math.ceil(l.text.length / 12)));
                if (p.error) return toast(p.error, 7000);
                api.quest_award("shadow", 1);
                res.replaceChildren(el("small", { class: p.score >= 70 ? "good" : "low" }, `${p.score}% · ${p.verdict}`), accentWords(api, p.words, lang()));
              } finally { busy(e.target, false); }
            } }, "🎙 Shadow")),
            l.roman ? el("small", { class: "muted" }, l.roman) : null, el("small", {}, ` — ${l.meaning}`), res);
        })));
    } finally { busy(btn, false); }
  }

  // ---------- word bank ----------
  async function wordBank() {
    const words = await api.sensei_words(lang());
    const draw = (list) => out.replaceChildren(el("h3", {}, `📚 Word bank (${list.length})`),
      el("p", { class: "note" }, "New words from your live talks land here by themselves. They're quizzed in Study → Play → Flashcards."),
      list.length ? el("ul", { class: "word-bank" }, list.slice().reverse().map((w) => el("li", {},
        el("b", {}, w.word), w.reading ? el("small", { class: "muted" }, ` ${w.reading}`) : null, el("span", {}, ` — ${w.meaning}`),
        el("button", { class: "ghost small", "aria-label": `Hear ${w.word}`, onclick: () => say(w.word) }, "🔊"),
        el("button", { class: "x", "aria-label": `Remove ${w.word}`, onclick: async () => draw(await api.sensei_word_remove(w.lang, w.word)) }, "×"))))
        : el("p", { class: "none" }, "Empty for now — do a 🎙 Talk live and the useful words get saved here."));
    draw(words);
  }

  // ---------- writing trainer ----------
  async function drawing() {
    const sets = await api.sensei_draw_sets(lang());
    const names = Object.keys(sets);
    const setSel = el("select", { "aria-label": "Character set" }, names.map((n) => el("option", { value: n }, n)));
    const size = 260;
    const pad = el("canvas", { width: size, height: size, class: "draw-pad", "aria-label": "Draw the character here" });
    const ctx = pad.getContext("2d");
    const target = el("div", { class: "draw-target" });
    const result = el("p", { class: "draw-result" });
    const ghost = el("input", { type: "checkbox", id: "drawGhost", checked: true });
    let ch = "", drawing = false, last = null, inked = false;
    const font = (px) => `${px}px "Noto Sans JP", "Yu Gothic", "Malgun Gothic", "Microsoft YaHei", "Leelawadee UI", sans-serif`;
    function clear() {
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "#e3e6ea"; ctx.setLineDash([6, 6]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke(); ctx.setLineDash([]);
      if (ghost.checked && ch) { ctx.fillStyle = "#dfe7f3"; ctx.font = font(size * 0.78); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ch, size / 2, size / 2 + 6); }
      inked = false; result.textContent = "";
    }
    function pick() {
      const chars = [...sets[setSel.value]];
      ch = chars[Math.floor(Math.random() * chars.length)];
      target.replaceChildren(el("b", {}, ch), el("button", { class: "ghost small", onclick: () => say(ch) }, "🔊"));
      clear();
    }
    const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * size / r.width, (e.clientY - r.top) * size / r.height]; };
    pad.addEventListener("pointerdown", (e) => { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); });
    pad.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.strokeStyle = "#1d2330"; ctx.lineWidth = 11; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
      last = p; inked = true;
    });
    const up = () => { drawing = false; };
    pad.addEventListener("pointerup", up); pad.addEventListener("pointercancel", up);
    ghost.addEventListener("change", () => { if (!inked) clear(); });
    function check() {
      if (!inked) return toast("Draw the character first.");
      const score = shapeScore(ctx, ch, size, font);
      const ok = score >= 70;
      result.className = `draw-result ${ok ? "good" : "low"}`;
      result.textContent = ok ? `✓ ${score}% — nice! ${score >= 80 ? "Very clean." : "Close enough."}` : `✗ ${score}% — compare the shape and try again.`;
      play(ok ? "success" : "off");
      if (ok) api.quest_award("draw", 1);
    }
    setSel.addEventListener("change", pick);
    out.replaceChildren(el("h3", {}, "✍️ Writing trainer"),
      el("p", { class: "note" }, "Draw the character in the box (mouse, pen or finger). Untick the guide once you know it."),
      el("div", { class: "row" }, setSel, el("label", { class: "check", for: "drawGhost" }, ghost, "Show the guide")),
      el("div", { class: "draw-wrap" }, target, pad),
      el("div", { class: "row center" }, el("button", { class: "ghost", onclick: clear }, "Clear"),
        el("button", { class: "primary", onclick: check }, "Check"), el("button", { class: "ghost", onclick: pick }, "Next ➜")),
      result);
    pick();
  }

  // ---------- weekly report ----------
  async function report() {
    const r = await api.sensei_report(lang());
    const box = (n, l) => el("div", { class: "rep-box" }, el("b", {}, String(n ?? "—")), el("small", {}, l));
    out.replaceChildren(el("h3", {}, `📈 This week in ${r.name}`), el("p", { class: "note" }, `${r.from} → ${r.to}`),
      el("div", { class: "rep-grid" }, box(r.days, "days practised"), box(r.streak, "day streak"), box(r.talks, "live talks"),
        box(r.turns, "sentences said"), box(r.grammar_pct != null ? r.grammar_pct + "%" : null, "said right"), box(r.best_combo, "best combo"),
        box(r.words, "new words"), box(r.shadowed, "lines shadowed"), box(r.drawn, "characters drawn")),
      r.new_words.length ? el("p", {}, el("strong", {}, "New words: "), r.new_words.join(", ")) : null,
      el("p", { class: "note" }, r.days >= 5 ? "Amazing week — keep the streak alive! 🔥" : r.days ? "Good start. Try a little every day — even 5 minutes keeps the streak." : "No practice yet this week. A 5-minute talk is enough to start."));
  }

  const row = el("div", { class: "row lang-extras" },
    el("button", { class: "ghost", onclick: (e) => shadowing(e.target) }, "🗣 Shadowing"),
    el("button", { class: "ghost", onclick: wordBank }, "📚 Word bank"),
    el("button", { class: "ghost", onclick: drawing }, "✍️ Writing trainer"),
    el("button", { class: "ghost", onclick: report }, "📈 Weekly report"),
    el("button", { class: "ghost", title: "Your XP, streak and badges", onclick: () => document.querySelector('[data-panel="pass"]')?.click() }, "🏆 XP & badges"));
  return { sceneSel, speedBtn, row, scene: () => sceneSel.value };
}

/** how much the drawing looks like the character (0-100): both are cropped to their ink, scaled to 48x48,
 *  thickened a little (70+ counts as right), then compared both ways (did you cover the character / is your ink on the character) */
export function shapeScore(ctx, ch, size, font) {
  const N = 48;
  const grid = (data, w, h, dark) => {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dark(data, (y * w + x) * 4)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const g = new Uint8Array(N * N);
    if (x1 < 0) return g;
    const s = Math.max(x1 - x0, y1 - y0) + 1, ox = x0 - (s - (x1 - x0 + 1)) / 2, oy = y0 - (s - (y1 - y0 + 1)) / 2;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!dark(data, (y * w + x) * 4)) continue;
      const gx = Math.min(N - 1, Math.floor(((x - ox) / s) * N)), gy = Math.min(N - 1, Math.floor(((y - oy) / s) * N));
      g[gy * N + gx] = 1;
    }
    return g;
  };
  const grow = (g, r) => {
    const o = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g[y * N + x])
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < N && Y < N) o[Y * N + X] = 1; }
    return o;
  };
  const mine = grid(ctx.getImageData(0, 0, size, size).data, size, size, (d, i) => d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 110);
  const c = document.createElement("canvas"); c.width = c.height = size;
  const t = c.getContext("2d");
  t.fillStyle = "#fff"; t.fillRect(0, 0, size, size); t.fillStyle = "#000";
  t.font = font(size * 0.78); t.textAlign = "center"; t.textBaseline = "middle"; t.fillText(ch, size / 2, size / 2 + 6);
  const want = grid(t.getImageData(0, 0, size, size).data, size, size, (d, i) => d[i] < 128);
  const mineW = grow(mine, 2), wantW = grow(want, 2);
  let wantN = 0, wantHit = 0, mineN = 0, mineHit = 0;
  for (let i = 0; i < N * N; i++) {
    if (want[i]) { wantN++; if (mineW[i]) wantHit++; }
    if (mine[i]) { mineN++; if (wantW[i]) mineHit++; }
  }
  if (!wantN || !mineN) return 0;
  const recall = wantHit / wantN, precision = mineHit / mineN;
  return Math.round(100 * (2 * recall * precision) / Math.max(1e-6, recall + precision));
}
