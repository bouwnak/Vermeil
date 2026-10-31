// studylife.js - Study -> "My study": today's list, mistakes, grades, handwritten notes, formula sheets by subject,
// video chapters, citations, essay coach, exam week and the curiosity corner (skills/studylife.py).
import { el, toast, busy } from "./util.js";

const PARTS = ["Today", "Mistakes", "Grades", "Notes", "Formulas", "Chapters", "Citations", "Essay", "Exam week"];

// pronunciation tips under a Sensei "Say it" result
export function coachTips(coach) {
  if (!coach?.tips?.length) return null;
  return el("div", { class: "pron-coach" }, el("b", {}, "How to say the tricky parts"),
    el("ul", {}, coach.tips.map((t) => el("li", {}, el("b", {}, t.word), t.syllables ? ` (${t.syllables})` : "", ": ", t.how,
      t.sounds_like ? el("span", { class: "muted" }, ` Sounds like “${t.sounds_like}”.`) : ""))),
    coach.encourage ? el("p", { class: "note" }, coach.encourage) : null);
}

// practice-exam score report under a timed review
export function examReport(rep) {
  if (!rep || rep.error) return null;
  return el("div", { class: "exam-report" },
    el("h4", {}, `Grade ${rep.grade} · ${rep.right}/${rep.total} (${rep.pct}%)`),
    el("table", {}, el("tr", {}, el("th", {}, "Part"), el("th", {}, "Score")),
      rep.parts.map((p) => el("tr", { class: p.pct < 70 ? "low" : "" }, el("td", {}, p.part), el("td", {}, `${p.right}/${p.total} (${p.pct}%)`)))),
    rep.redo.length ? el("p", { class: "note" }, `Study these again: ${rep.redo.join(", ")}. The ones you missed are in My study → Mistakes.`)
      : el("p", { class: "note" }, "Every part is 70% or better. 🎉"));
}

export function initStudyLife(api, pane, opts = {}) {
  const fact = el("div", { class: "fact-card", hidden: true });
  const bar = el("div", { class: "chips" });
  const body = el("div", { class: "studylife" });
  pane.append(fact, bar, body);
  let part = "Today";
  const draw = { Today: today, Mistakes: mistakes, Grades: grades, Notes: notes, Formulas: formulas,
    Chapters: chapters, Citations: citations, Essay: essay, "Exam week": examWeek };
  function pick(p) {
    part = p;
    bar.replaceChildren(...PARTS.map((x) => el("button", { class: x === p ? "chip on" : "chip", onclick: () => pick(x) }, x)));
    body.replaceChildren(el("p", { class: "note" }, "Loading…"));
    draw[p]().catch((e) => body.replaceChildren(el("p", { class: "warn" }, String(e))));
  }

  async function loadFact() {
    const f = await api.study_fact();
    if (!f?.fact) return;
    fact.hidden = false;
    fact.replaceChildren(el("b", {}, `💡 Curiosity corner · ${f.subject}`), el("p", {}, f.fact));
  }

  // ---- 62 today
  async function today() {
    const r = await api.study_today();
    const go = { review: (i) => opts.openReview?.(i.id), cards: () => opts.showTab?.("Play"), mistakes: () => pick("Mistakes"),
      weak: () => opts.showTab?.("Review"), exam: () => pick("Exam week") };
    body.replaceChildren(
      el("h3", {}, r.items.length ? `Today: about ${r.minutes} minutes` : "Nothing due today 🎉"),
      r.items.length ? el("ol", { class: "today-list" }, r.items.map((i) => el("li", {},
        el("span", {}, `${i.icon} ${i.text}`), i.minutes ? el("small", { class: "muted" }, ` ${i.minutes} min`) : "",
        el("button", { class: "ghost small", onclick: () => go[i.action]?.(i) }, "Start"))))
        : el("p", { class: "note" }, "No reviews are due. Make a new one in Review, or play flashcards."));
  }

  // ---- 72 mistakes
  async function mistakes() {
    const list = await api.study_mistakes();
    const card = (m) => {
      const ans = el("div", { class: "mistake-answer", hidden: true }, el("p", {}, el("b", {}, "Answer: "), m.right),
        m.why ? el("p", { class: "muted" }, m.why) : null);
      return el("li", { class: "mistake" }, el("p", {}, m.q),
        el("small", { class: "muted" }, [m.subject, m.source, m.added].filter(Boolean).join(" · ")),
        el("div", { class: "row" },
          el("button", { class: "ghost small", onclick: (e) => { ans.hidden = !ans.hidden; e.target.textContent = ans.hidden ? "Show answer" : "Hide"; } }, "Show answer"),
          el("button", { class: "ghost small", title: "I know it now", onclick: async () => { await api.study_mistake_done(m.id); toast("Nice, crossed off. +3 XP"); mistakes(); } }, "✓ Got it now")),
        ans);
    };
    body.replaceChildren(el("h3", {}, `📕 Mistake notebook (${list.length})`),
      el("p", { class: "note" }, "Every wrong answer from your reviews lands here with the right answer. Cross it off once you know it."),
      list.length ? el("ol", { class: "mistakes" }, list.map(card)) : el("p", {}, "No mistakes saved yet."));
  }

  // ---- 73 grades
  async function grades() {
    const list = await api.study_grades();
    const form = (c = { name: "", target: 75, parts: [{ name: "Quizzes", weight: 20 }, { name: "Midterm", weight: 30 }, { name: "Final exam", weight: 50 }] }) => {
      const name = el("input", { value: c.name, placeholder: "Subject, e.g. Hydrology", "aria-label": "Subject" });
      const target = el("input", { type: "number", value: c.target, min: 0, max: 100, "aria-label": "Target grade", class: "num" });
      const rows = el("div", { class: "grade-parts" });
      const addRow = (p = {}) => rows.append(el("div", { class: "row" },
        el("input", { value: p.name || "", placeholder: "Part", "aria-label": "Part" }),
        el("input", { type: "number", value: p.weight ?? "", placeholder: "Weight %", class: "num", "aria-label": "Weight %" }),
        el("input", { type: "number", value: p.score ?? "", placeholder: "Score % (blank = not yet)", class: "num", "aria-label": "Score %" }),
        el("button", { class: "x", "aria-label": "Remove part", onclick: (e) => e.target.parentElement.remove() }, "×")));
      c.parts.forEach(addRow);
      return el("div", { class: "grade-form" }, el("div", { class: "row" }, name, el("label", {}, "Target ", target, "%")), rows,
        el("div", { class: "row" }, el("button", { class: "ghost small", onclick: () => addRow() }, "+ Part"),
          el("button", { class: "primary", onclick: async () => {
            const parts = [...rows.children].map((r) => { const [n, w, s] = r.querySelectorAll("input"); return { name: n.value, weight: w.value, score: s.value }; });
            const res = await api.study_grade_save({ id: c.id, name: name.value, target: target.value, parts });
            if (res.error) return toast(res.error, 6000);
            grades();
          } }, "Save")));
    };
    body.replaceChildren(el("h3", {}, "🎓 Grades"),
      el("p", { class: "note" }, "Put in each part's weight and the scores you have. Leave the final blank to see what you need on it."),
      ...list.map((c) => el("div", { class: "grade-card" },
        el("div", { class: "row" }, el("b", {}, c.name), c.current != null ? el("span", {}, ` now ${c.current}%`) : "",
          el("button", { class: "ghost small", onclick: (e) => e.target.closest(".grade-card").replaceWith(form(c)) }, "Edit"),
          el("button", { class: "x", "aria-label": `Remove ${c.name}`, onclick: async () => { await api.study_grade_remove(c.id); grades(); } }, "×")),
        el("p", { class: c.needed > 100 ? "warn" : "note" }, c.message))),
      el("h4", {}, "Add a subject"), form());
  }

  // ---- 67 notes from photos
  async function notes() {
    const list = await api.study_notebook();
    const subj = el("input", { placeholder: "Subject (optional)", "aria-label": "Subject" });
    body.replaceChildren(el("h3", {}, "📸 Handwritten notes"),
      el("p", { class: "note" }, "Pick photos of your notes. She reads them, cleans them up, and joins notes on the same topic into one."),
      el("div", { class: "row" }, subj,
        el("button", { class: "primary", onclick: async (e) => {
          busy(e.target, true, "Reading your handwriting…");
          try {
            const r = await api.study_photo_notes(subj.value);
            r.errors.forEach((x) => toast(x, 7000));
            r.done.forEach((d) => toast(d.merged ? `Added to your “${d.topic}” note.` : `New note: ${d.topic}`));
            notes();
          } finally { busy(e.target, false); }
        } }, "📷 Photos…"),
        el("button", { class: "ghost", title: "Join notes about the same topic", onclick: async () => {
          const r = await api.study_merge_notes(); toast(r.merged ? `Merged ${r.merged} duplicate note${r.merged > 1 ? "s" : ""}.` : "No duplicates found."); notes();
        } }, "🔗 Merge duplicates")),
      list.length ? el("div", { class: "notebook" }, list.map((n) => el("details", { class: "note-card" },
        el("summary", {}, el("b", {}, n.topic), n.subject ? el("small", { class: "muted" }, ` · ${n.subject}`) : "",
          el("small", { class: "muted" }, ` · ${n.sources.length} photo${n.sources.length === 1 ? "" : "s"}`)),
        el("pre", { class: "note-text" }, n.text),
        n.formulas.length ? el("p", {}, el("b", {}, "Formulas: "), n.formulas.join(" · ")) : null,
        el("button", { class: "ghost small", onclick: async () => { await api.study_note_remove(n.id); notes(); } }, "Delete"))))
        : el("p", {}, "No notes yet."));
  }

  // ---- 65 formula sheet per subject
  async function formulas() {
    const { subjects, sheets } = await api.study_subjects();
    const out = el("div", {});
    const showSheet = (s) => out.replaceChildren(el("h4", {}, `${s.title} (${s.count})`),
      ...s.topics.map((t) => el("section", { class: "formula-topic" }, el("h5", {}, t.topic),
        el("ul", {}, t.formulas.map((f) => el("li", {}, f.name ? el("b", {}, `${f.name}: `) : "", el("code", {}, f.formula),
          f.symbols ? el("small", { class: "muted" }, ` (${f.symbols})`) : ""))))));
    body.replaceChildren(el("h3", {}, "📐 Formula sheets by subject"),
      el("p", { class: "note" }, "Uses the library files with that subject plus formulas from your handwritten notes. Set a file's subject in Library."),
      el("div", { class: "row" }, subjects.map((s) => el("button", { class: sheets[s] ? "ghost" : "primary", onclick: async (e) => {
        if (sheets[s] && !e.shiftKey) return showSheet(sheets[s]);
        busy(e.target, true, `Making ${s}…`);
        try { const r = await api.study_subject_formulas(s); if (r.error) return toast(r.error, 7000); sheets[s] = r; showSheet(r); }
        finally { busy(e.target, false); }
      } }, sheets[s] ? `📄 ${s}` : `+ ${s}`))),
      Object.keys(sheets).length ? el("small", { class: "muted" }, "Shift-click a saved sheet to make it again.") : null, out);
  }

  // ---- 70 video chapters
  async function chapters() {
    const vids = (opts.files?.() || []).filter((f) => /\.(mp4|mkv|mov|avi|webm|mp3|m4a|wav)$/i.test(f.name));
    const out = el("div", {});
    body.replaceChildren(el("h3", {}, "🎬 Lecture chapters"),
      el("p", { class: "note" }, "Splits a video lecture into chapters. To jump to where they explain something, use Play → Ask my library."),
      vids.length ? el("div", { class: "row" }, vids.map((v) => el("button", { class: "ghost", onclick: async (e) => {
        busy(e.target, true, "Finding chapters…");
        try {
          const r = await api.study_chapters(v.id);
          if (r.error) return toast(r.error, 7000);
          out.replaceChildren(el("h4", {}, v.name), el("ol", { class: "chapters" }, r.chapters.map((c) =>
            el("li", {}, el("a", { href: c.url, target: "_blank", rel: "noopener" }, c.time), ` ${c.title}`))));
        } finally { busy(e.target, false); }
      } }, `▶ ${v.name}`))) : el("p", {}, "No video or audio lectures in your library yet."), out);
  }

  // ---- 76 citations
  async function citations() {
    const q = el("input", { placeholder: "Paste a link, or type a book title (and author)", "aria-label": "Link or book title" });
    const out = el("div", {});
    const copy = (label, text) => el("div", { class: "cite" }, el("b", {}, label), el("p", {}, text),
      el("button", { class: "ghost small", onclick: () => { navigator.clipboard?.writeText(text.replace(/\*/g, "")); toast("Copied."); } }, "Copy"));
    body.replaceChildren(el("h3", {}, "📚 Citation helper"),
      el("p", { class: "note" }, "APA 7 and MLA 9. Check the details: italics are shown as *stars*."),
      el("div", { class: "row" }, q, el("button", { class: "primary", onclick: async (e) => {
        busy(e.target, true, "Looking it up…");
        try {
          const r = await api.study_cite(q.value);
          if (r.error) return toast(r.error, 7000);
          out.replaceChildren(copy("APA 7", r.apa), copy("MLA 9", r.mla));
        } finally { busy(e.target, false); }
      } }, "Cite")), out);
  }

  // ---- 77 essay coach
  async function essay() {
    let outline = null;
    const topic = el("input", { placeholder: "Essay topic or question", "aria-label": "Essay topic" });
    const kind = el("select", { "aria-label": "Essay type" }, ["argumentative", "expository", "compare and contrast", "reflective"].map((k) => el("option", { value: k }, k)));
    const outBox = el("div", {});
    const draft = el("textarea", { rows: 10, placeholder: "Paste your draft here when you've written it…", "aria-label": "Your draft" });
    const fb = el("div", {});
    body.replaceChildren(el("h3", {}, "✍️ Essay coach"),
      el("p", { class: "note" }, "1) Get an outline: thesis, points, evidence. 2) Write it yourself. 3) Paste your draft for feedback."),
      el("div", { class: "row" }, topic, kind, el("button", { class: "primary", onclick: async (e) => {
        busy(e.target, true, "Outlining…");
        try {
          const r = await api.study_essay_outline(topic.value, kind.value);
          if (r.error) return toast(r.error, 7000);
          outline = r;
          outBox.replaceChildren(el("div", { class: "outline" }, el("p", {}, el("b", {}, "Thesis: "), r.thesis),
            el("ol", {}, r.points.map((p) => el("li", {}, p.point, el("ul", {}, (p.evidence || []).map((x) => el("li", { class: "muted" }, x)))))),
            r.counter ? el("p", {}, el("b", {}, "Counter-argument: "), r.counter.argument, el("br"), el("b", {}, "Your reply: "), r.counter.reply) : null,
            el("p", {}, el("b", {}, "Conclusion: "), r.conclusion)));
        } finally { busy(e.target, false); }
      } }, "Outline")),
      outBox, draft,
      el("button", { class: "primary", onclick: async (e) => {
        busy(e.target, true, "Reading your draft…");
        try {
          const r = await api.study_essay_feedback(outline || { topic: topic.value }, draft.value);
          if (r.error) return toast(r.error, 7000);
          fb.replaceChildren(el("div", { class: "essay-fb" }, el("h4", {}, `${r.score}/10${r.thesis_clear ? "" : " · the thesis isn't clear yet"}`),
            el("p", {}, el("b", {}, "What works: "), (r.strengths || []).join(" ")),
            el("ol", {}, (r.fixes || []).map((f) => el("li", {}, el("q", {}, f.quote), el("p", { class: "muted" }, f.why), el("p", {}, "Try: ", el("i", {}, f.better))))),
            r.next_step ? el("p", { class: "note" }, `Next: ${r.next_step}`) : null));
        } finally { busy(e.target, false); }
      } }, "Check my draft"), fb);
  }

  // ---- 79 exam week
  async function examWeek() {
    const ex = await api.study_exam();
    const on = el("input", { type: "checkbox", checked: ex.on });
    const sleep = el("input", { type: "time", value: ex.sleep, "aria-label": "Bedtime" });
    const rows = el("div", {});
    const addRow = (e = {}) => rows.append(el("div", { class: "row" },
      el("input", { value: e.subject || "", placeholder: "Subject", "aria-label": "Exam subject" }),
      el("input", { type: "date", value: e.date || "", "aria-label": "Exam date" }),
      el("button", { class: "x", "aria-label": "Remove exam", onclick: (ev) => ev.target.parentElement.remove() }, "×")));
    (ex.exams.length ? ex.exams : [{}]).forEach(addRow);
    body.replaceChildren(el("h3", {}, "🎯 Exam week"),
      el("p", { class: "note" }, "A daily plan up to your last exam, a bedtime reminder, and shorter, calmer chat with Vermeil."),
      el("label", { class: "switch-row" }, on, " Exam-week mode"), rows,
      el("div", { class: "row" }, el("button", { class: "ghost small", onclick: () => addRow() }, "+ Exam"),
        el("label", {}, "Bed by ", sleep),
        el("button", { class: "primary", onclick: async () => {
          const exams = [...rows.children].map((r) => { const [s, d] = r.querySelectorAll("input"); return { subject: s.value, date: d.value }; });
          await api.study_exam_save({ on: on.checked, exams, sleep: sleep.value });
          toast("Saved."); examWeek();
        } }, "Save")),
      ex.active ? el("p", { class: "note" }, "Exam-week mode is on: Vermeil keeps chat short and reminds you to sleep.") : null,
      ...ex.plan.map((d) => el("div", { class: "exam-day" }, el("b", {}, `${d.weekday} ${d.date.slice(5)}: ${d.focus}`),
        el("ul", {}, d.blocks.map((b) => el("li", {}, b))))));
  }

  return { load() { pick(part); loadFact().catch(() => {}); } };
}
