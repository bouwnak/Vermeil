// generator.js - the Generator panel: pictures, presentations (.pptx) and narrated videos (.mp4) from a topic or
// your PDFs. The work happens in skills/generator.py in the background; progress comes back as {type: "gen"} events.
import { $, el, toast, busy } from "./util.js";

const KINDS = [
  ["pictures", "🖼 Pictures", "Describe the picture, e.g. “a cozy cabin in a snowy pine forest at dusk”"],
  ["video", "🎬 Video", "Topic, e.g. “How volcanoes work” - or add PDFs to turn them into a narrated video"],
];
const THEMES = [["midnight", "Midnight"], ["parchment", "Parchment"], ["ocean", "Ocean"], ["forest", "Forest"], ["clean", "Clean white"]];

export function initGenerator(api) {
  let kind = "pictures", pdfs = [];
  const jobs = new Map();                         // job id -> its card
  const root = $("genBody");
  const tabs = el("div", { class: "tabs", role: "tablist" });
  const form = el("div", { class: "gen-form" });
  const live = el("div", { class: "gen-jobs" });
  const gallery = el("div", { class: "gen-gallery" });
  root.replaceChildren(tabs, form, live, el("div", { class: "row" }, el("h3", { style: "flex:1" }, "Your creations"),
    el("button", { class: "ghost small", onclick: () => api.gen_open() }, "📂 Open folder"), el("button", { class: "ghost small", onclick: loadRecent }, "↻")), gallery);

  function drawTabs() {
    tabs.replaceChildren(...KINDS.map(([k, label]) => el("button", { role: "tab", "aria-selected": String(k === kind), onclick: () => { kind = k; draw(); } }, label)));
  }
  const select = (opts, val) => { const s = el("select", {}, opts.map(([v, l]) => el("option", { value: v }, l))); s.value = val; return s; };

  function draw() {
    drawTabs();
    const K = KINDS.find((x) => x[0] === kind);
    const text = el("textarea", { rows: 3, placeholder: K[2], "aria-label": "What to make" });
    const go = el("button", { class: "primary" }, kind === "pictures" ? "✨ Paint" : kind === "video" ? "🎬 Make the video" : "📊 Make the slides");
    const opts = {};
    const row = el("div", { class: "row wrap" });
    if (kind === "pictures") {
      opts.count = select([["1", "1 picture"], ["2", "2"], ["4", "4"], ["6", "6"]], "4");
      opts.size = select([["landscape", "Landscape 16:9"], ["portrait", "Portrait 9:16"], ["square", "Square"]], "landscape");
      opts.style = select([["", "Any style"], ["digital painting, highly detailed", "Digital painting"], ["photorealistic, 35mm photo", "Photo"],
        ["anime style, studio quality", "Anime"], ["watercolor illustration", "Watercolor"], ["low poly 3D render", "Low-poly 3D"], ["pixel art", "Pixel art"]], "");
      row.append(opts.count, opts.size, opts.style);
    } else {
      opts.n = select(kind === "video" ? [["3", "3 scenes (~30 s)"], ["5", "5 scenes"], ["8", "8 scenes (~1.5 min)"]] : [["5", "5 slides"], ["8", "8 slides"], ["12", "12 slides"], ["16", "16 slides"]], kind === "video" ? "5" : "8");
      opts.theme = select(THEMES, "midnight");
      row.append(opts.n, opts.theme);
      if (kind === "presentation") { opts.pics = el("input", { type: "checkbox", checked: true }); row.append(el("label", { class: "check" }, opts.pics, " pictures on slides")); }
      const pdfLine = el("span", { class: "note" }, pdfs.length ? `${pdfs.length} PDF${pdfs.length > 1 ? "s" : ""}: ${pdfs.map((p) => p.split(/[\\/]/).pop()).join(", ")}` : "No PDFs - it will use the topic.");
      row.append(el("button", { class: "ghost small", onclick: async () => { pdfs = await api.gen_pick_pdfs(); draw(); } }, "📄 Add PDFs…"),
        pdfs.length ? el("button", { class: "ghost small", onclick: () => { pdfs = []; draw(); } }, "Clear") : null, pdfLine);
    }
    go.onclick = async () => {
      const t = text.value.trim();
      if (!t && !pdfs.length) return toast("Type what to make first" + (kind === "pictures" ? "." : ", or add PDFs."));
      busy(go, true, "Starting…");
      const o = kind === "pictures" ? { prompt: t, count: +opts.count.value, size: opts.size.value, style: opts.style.value }
        : kind === "video" ? { topic: t, pdfs: kind === "pictures" ? [] : pdfs, scenes: +opts.n.value, theme: opts.theme.value }
          : { topic: t, pdfs, slides: +opts.n.value, theme: opts.theme.value, pictures_on: opts.pics.checked };
      const r = await api.gen_start(kind, o);
      busy(go, false);
      if (r.error) return toast(r.error, 5000);
      addJob(r.job, kind, t || pdfs.map((p) => p.split(/[\\/]/).pop()).join(", "));
    };
    text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) go.click(); });
    form.replaceChildren(text, row, el("div", { class: "row" }, go),
      el("p", { class: "note" }, kind === "pictures" ? "Online it paints with an image AI (free, no key). Offline it makes a simple painted card instead."
        : kind === "video" ? "Each scene gets a picture with a slow zoom, a caption and the narration - spoken with Kokoro when online. Videos take a minute or two."
          : "The AI plans the slides (title, bullet points, speaker notes, a picture each). Opens in PowerPoint, Google Slides or LibreOffice."));
  }

  function addJob(id, k, what) {
    const bar = el("i", { style: "width:2%" });
    const txt = el("span", { class: "note" }, "Starting…");
    const card = el("div", { class: "gen-job" }, el("b", {}, `${KINDS.find((x) => x[0] === k)[1]} · ${what.slice(0, 60)}`), el("div", { class: "progress" }, bar), txt);
    live.prepend(card);
    jobs.set(id, { card, bar, txt });
  }

  async function preview(f) {
    const box = el("div", { class: `gen-item ${f.kind}` });
    const thumb = el("div", { class: "thumb" }, f.kind === "pptx" ? "📊" : f.kind === "mp4" ? "🎬" : "🖼");
    box.append(thumb, el("div", { class: "meta" }, el("b", { title: f.name }, f.name), el("small", { class: "note" }, `${f.saved} · ${f.size_kb >= 1024 ? (f.size_kb / 1024).toFixed(1) + " MB" : f.size_kb + " KB"}`)),
      el("button", { class: "ghost small", onclick: () => api.gen_open(f.path) }, f.kind === "mp4" ? "▶ Play" : "Open"));
    if (f.kind !== "pptx") api.gen_preview(f.path).then((r) => { if (r.data) thumb.replaceChildren(el("img", { src: r.data, alt: f.name })); });
    return box;
  }

  async function loadRecent() {
    const r = await api.gen_recent();
    gallery.replaceChildren(...(r.files.length ? await Promise.all(r.files.slice(0, 24).map(preview)) : [el("p", { class: "none" }, "Nothing made yet. Pick a tab above and describe what you want.")]));
  }

  draw();
  return {
    load: loadRecent,
    onEvent(e) {
      const j = jobs.get(e.job); if (!j) return;
      if (e.progress != null) j.bar.style.width = `${Math.round(e.progress * 100)}%`;
      if (e.text) j.txt.textContent = e.text;
      if (e.state === "done") {
        j.card.classList.add("done");
        const files = e.result?.files || (e.result?.file ? [e.result.file] : []);
        j.txt.textContent = e.result?.slides ? `${e.result.slides.length + 1} slides ready${e.result.ai ? "" : " (offline outline)"}` : e.result?.seconds ? `${e.result.seconds} s video ready` : `${files.length} ready`;
        j.card.append(el("div", { class: "row" }, files.slice(0, 1).map((p) => el("button", { class: "primary small", onclick: () => api.gen_open(p) }, "Open"))));
        toast("Your creation is ready!", 3500);
        loadRecent();
      }
      if (e.state === "error") { j.card.classList.add("error"); toast(e.text, 6000); }
    },
  };
}
