// studyplay.js - Study -> Play: spaced flashcards with combos and XP, "watch where this was said" (video lectures),
// Ask my library (answers with file/page sources), the printable formula sheet and the 25-minute study timer.
import { el, toast, setMd, busy, loadingCard } from "./util.js";
import { play } from "./fx.js";

const VIDEO = /\.(mp4|mkv|webm|mov|avi|m4v|mp3|m4a|wav|ogg)\b/i;
export const isVideoSource = (s) => VIDEO.test(String(s || ""));

/** the video player over the window, starting at `seconds` */
export function openVideo(url, title, seconds = 0) {
  document.querySelector(".video-over")?.remove();
  const v = el("video", { src: url, controls: true, autoplay: true, preload: "auto" });
  v.addEventListener("loadedmetadata", () => { if (seconds && Math.abs(v.currentTime - seconds) > 1) v.currentTime = seconds; });
  v.addEventListener("error", () => toast("The video couldn't play (is it on a USB drive that's unplugged?).", 6000));
  const close = () => { v.pause(); box.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const box = el("div", { class: "video-over", role: "dialog", "aria-label": title || "Video lecture", onclick: (e) => { if (e.target === box) close(); } },
    el("div", { class: "video-card" },
      el("div", { class: "row" }, el("strong", {}, title || "Video lecture"), el("button", { class: "close", "aria-label": "Close video", onclick: close }, "×")),
      v));
  document.body.append(box);
  document.addEventListener("keydown", esc);
}

/** "▶ watch where this was said" for a reviewer source like "Beams.mp4, part 3" */
export function watchButton(api, source, text = "") {
  if (!isVideoSource(source)) return null;
  return el("button", { class: "ghost small watch-btn", title: "Play the lecture video at the moment this was said", onclick: async (e) => {
    busy(e.target, true, "Finding it…");
    try {
      const m = await api.study_moment(source, text);
      if (m.error) return toast(m.error, 6000);
      openVideo(m.url, `${m.name} · ${m.clock}`, m.seconds);
    } finally { busy(e.target, false); }
  } }, "▶ Watch where this was said");
}

export function initPlay(api, pane, selectedIds) {
  const area = el("div");
  const modes = [["cards", "🃏 Flashcards"], ["ask", "🔎 Ask my library"], ["formulas", "📐 Formula sheet"], ["timer", "⏱ Study timer"]];
  let mode = "cards";
  const bar = el("div", { class: "row play-modes" });
  const drawBar = () => bar.replaceChildren(...modes.map(([k, l]) => el("button", { class: k === mode ? "chip on" : "chip", onclick: () => { mode = k; load(); } }, l)));
  pane.append(bar, area);

  // ---------- flashcards: Leitner boxes, combo, XP ----------
  async function cards() {
    area.replaceChildren(loadingCard("Shuffling your cards…"));
    const d = await api.cards_deck(30);
    if (!d.cards.length) {
      area.replaceChildren(el("p", { class: "note" }, d.total ? "All caught up for today! 🎉 Missed cards come back tomorrow."
        : "No cards yet. Make a Flashcards review in the Review tab, or talk in Language practice to fill your word bank."));
      return;
    }
    let i = 0, combo = 0, best = 0, right = 0;
    const draw = () => {
      if (i >= d.cards.length) {
        play("success");
        area.replaceChildren(el("div", { class: "card-done" }, el("h3", {}, "Deck done!"),
          el("p", {}, `${right} / ${d.cards.length} right · best combo x${best}`),
          el("p", { class: "note" }, "Cards you missed come back tomorrow; the ones you knew come back later and later (1, 2, 4, 8, 16 days)."),
          el("button", { class: "primary", onclick: cards }, "Play again")));
        return;
      }
      const c = d.cards[i];
      const back = el("div", { class: "fc-back", hidden: true }, el("p", {}, c.back), c.source ? el("small", { class: "src" }, `Source: ${c.source}`) : null,
        watchButton(api, c.source, c.front + " " + c.back));
      const answer = async (knew) => {
        combo = knew ? combo + 1 : 0; best = Math.max(best, combo); right += knew ? 1 : 0;
        play(knew ? "on" : "off");
        await api.cards_answer(c.id, knew, combo);
        i += 1; draw();
      };
      const btns = el("div", { class: "row center", hidden: true },
        el("button", { class: "ghost", onclick: () => answer(false) }, "✗ Missed it"),
        el("button", { class: "primary", onclick: () => answer(true) }, "✓ Knew it"));
      const flip = el("button", { class: "primary", onclick: () => { back.hidden = false; btns.hidden = false; flip.hidden = true; } }, "Show answer");
      area.replaceChildren(
        el("div", { class: "row fc-top" }, el("small", {}, `${i + 1} / ${d.cards.length} · ${c.deck}`),
          el("span", { class: `combo ${combo > 1 ? "hot" : ""}` }, combo > 1 ? `🔥 Combo x${combo}` : ""),
          el("small", {}, c.box ? `Box ${c.box}` : "New")),
        el("div", { class: "flashcard" }, el("p", { class: "fc-front" }, c.front),
          c.say ? el("button", { class: "ghost small", onclick: async () => { const r = await api.sensei_say(c.say, c.lang); if (r.error) toast(r.error); } }, "🔊") : null,
          back),
        el("div", { class: "row center" }, flip), btns,
        el("p", { class: "note" }, `${d.due} due · ${d.new} new. Each right answer in a row gives more XP.`));
    };
    draw();
  }

  // ---------- ask my library ----------
  function ask() {
    const q = el("textarea", { rows: 3, placeholder: "e.g. When do we use the moment-area method?", "aria-label": "Question" });
    const only = el("input", { type: "checkbox", id: "askOnly" });
    const out = el("div", { class: "answer" });
    area.replaceChildren(
      el("p", { class: "note" }, "She answers only from your own files and tells you the file and page (or the second in a video)."),
      q, el("label", { class: "check", for: "askOnly" }, only, "Only the files ticked in Library"),
      el("button", { class: "primary", onclick: async (e) => {
        if (!q.value.trim()) return toast("Type a question first.");
        busy(e.target, true, "Searching your files…");
        out.replaceChildren(loadingCard("Reading your lectures… (~5-10 s)"));
        try {
          const ids = only.checked ? selectedIds() : null;
          const r = await api.study_ask(q.value, ids && ids.length ? ids : null);
          if (r.error) { out.replaceChildren(); return toast(r.error, 7000); }
          const text = el("div");
          setMd(text, r.answer, api);
          out.replaceChildren(text, r.sources.length ? el("div", { class: "ask-src" }, el("strong", {}, "From your files:"),
            el("ul", {}, r.sources.map((s) => el("li", {}, s.label,
              s.moment ? el("button", { class: "ghost small", onclick: () => openVideo(s.moment.url, `${s.moment.name} · ${s.moment.clock}`, s.moment.seconds) },
                `▶ ${s.moment.clock}`) : null)))) : null);
        } finally { busy(e.target, false); }
      } }, "Ask"),
      out);
  }

  // ---------- formula sheet ----------
  function formulas() {
    const out = el("div");
    area.replaceChildren(
      el("p", { class: "note" }, "Tick lecture files in the Library tab, then make one page with every formula in them — ready to print."),
      el("button", { class: "primary", onclick: async (e) => {
        const ids = selectedIds();
        if (!ids.length) return toast("Tick some files in the Library tab first.");
        busy(e.target, true, "Collecting formulas…");
        out.replaceChildren(loadingCard("Finding every formula… (~10-20 s)"));
        try {
          const r = await api.study_formulas(ids);
          if (r.error) { out.replaceChildren(); return toast(r.error, 7000); }
          const sheet = el("div", { class: "formula-sheet" }, el("h3", {}, r.title),
            r.topics.map((t) => el("section", {}, el("h4", {}, t.topic), el("table", {}, el("tbody", {}, t.formulas.map((f) =>
              el("tr", {}, el("td", {}, el("b", {}, f.name)), el("td", { class: "fx" }, f.formula),
                el("td", {}, el("small", {}, f.symbols), f.source ? el("small", { class: "src" }, ` · ${f.source}`) : null))))))));
          out.replaceChildren(el("div", { class: "row" }, el("span", { class: "note" }, `${r.count} formulas`),
            el("button", { class: "ghost", onclick: () => printSheet(sheet) }, "🖨 Print")), sheet);
        } finally { busy(e.target, false); }
      } }, "Make my formula sheet"),
      out);
  }
  function printSheet(sheet) {
    const w = window.open("", "_blank");
    if (!w) return toast("Couldn't open the print window.");
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Formula sheet</title><style>body{font:13px/1.4 Arial,sans-serif;margin:24px}
      h3{margin:0 0 8px}h4{margin:14px 0 4px;border-bottom:1px solid #999}table{border-collapse:collapse;width:100%}
      td{border-bottom:1px solid #ddd;padding:4px 6px;vertical-align:top}.fx{font-family:Consolas,monospace;font-size:14px}small{color:#444}</style>${sheet.outerHTML}`);
    w.document.close();
    w.focus();
    w.print();
  }

  // ---------- study timer ----------
  function timer() {
    const task = el("input", { placeholder: "What are you studying?", "aria-label": "What are you studying" });
    area.replaceChildren(
      el("p", { class: "note" }, "25 minutes of work, 5 minutes of break, 4 rounds. She stays quiet while you work, cheers you on at each break, and distracting sites/apps get minimized (Settings → Focus). Each block gives 30 XP."),
      task,
      el("button", { class: "primary", onclick: async () => {
        const t = task.value.trim() || "Studying";
        await api.focus_start(t, 25, 5, 4);
        window.onPyEvent?.({ type: "focus_started", task: t, work: 25, brk: 5, rounds: 4 });
        document.querySelector('[data-panel="focus"]')?.click();
      } }, "Start 25-minute blocks"));
  }

  function load() {
    drawBar();
    ({ cards, ask, formulas, timer })[mode]();
  }
  return { load };
}
