// study.js - Study mode: library of your files, review materials, research, assignment help.
import { $, el, toast, setMd, busy } from "./util.js";

const KIND_LABEL = { lecture: "Lecture", problems: "Problems", solutions: "Solutions", other: "Other" };

export function initStudy(api) {
  let data = { files: [], reviews: [], review_types: {}, kinds: [] };
  const selectedFiles = new Set();
  const root = $("studyBody");

  // ---------- layout: tabs ----------
  const tabs = ["Library", "Review", "Language", "Research", "Assignment"];
  const tabBar = el("div", { class: "tabs", role: "tablist" }, tabs.map((t) =>
    el("button", { role: "tab", id: `tab-${t}`, "aria-controls": `pane-${t}`, onclick: () => show(t) }, t)));
  const panes = Object.fromEntries(tabs.map((t) => [t, el("div", { class: "pane", id: `pane-${t}`, role: "tabpanel", hidden: true })]));
  root.replaceChildren(tabBar, ...Object.values(panes));
  function show(t) {
    for (const x of tabs) { panes[x].hidden = x !== t; $(`tab-${x}`).setAttribute("aria-selected", x === t); }
    api.save_ui({ study_tab: t });
    if (t === "Review") renderReviewPane();
    if (t === "Language") renderLanguage();
  }

  // ---------- Library ----------
  const kindSel = el("select", { "aria-label": "File type" }, Object.entries(KIND_LABEL).map(([v, l]) => el("option", { value: v }, l)));
  const subjectIn = el("input", { placeholder: "Subject (e.g. Structural Analysis)", "aria-label": "Subject" });
  const fileList = el("div", { class: "files" });
  panes.Library.append(
    el("p", { class: "note" }, "Add your lecture slides, problem sets and solutions (PDF, Word, PowerPoint or text). Tick files to use them for reviews and assignments."),
    el("div", { class: "row" }, kindSel, subjectIn,
      el("button", { class: "primary", onclick: async (e) => {
        busy(e.target, true, "Reading files…");
        try {
          const r = await api.study_add_files(kindSel.value, subjectIn.value);
          data = r;
          if (r.added.length) toast(`Added ${r.added.length} file${r.added.length > 1 ? "s" : ""}.`);
          r.errors.forEach((er) => toast(er, 7000));
          r.added.forEach((f) => selectedFiles.add(f.id));
          renderFiles();
        } finally { busy(e.target, false); }
      } }, "Add files…")),
    fileList);

  function renderFiles() {
    if (!data.files.length) { fileList.replaceChildren(el("p", { class: "none" }, "No files yet.")); return; }
    const bySubject = {};
    for (const f of data.files) (bySubject[f.subject || "No subject"] ||= []).push(f);
    fileList.replaceChildren(...Object.entries(bySubject).map(([subject, files]) => el("section", {},
      el("h3", {}, subject),
      el("ul", { class: "day-list" }, files.map((f) => {
        const box = el("input", { type: "checkbox", checked: selectedFiles.has(f.id), "aria-label": `Use ${f.name}`,
          onchange: () => (box.checked ? selectedFiles.add(f.id) : selectedFiles.delete(f.id)) });
        const kind = el("select", { class: "mini", "aria-label": "Type", onchange: async () => { data = await api.study_update_file(f.id, kind.value, null); } },
          Object.entries(KIND_LABEL).map(([v, l]) => el("option", { value: v, selected: v === f.kind }, l)));
        return el("li", {}, box,
          el("span", { class: "what" }, el("a", { href: "#", onclick: (e) => { e.preventDefault(); api.study_open_file(f.id); } }, f.name),
            el("small", {}, `${f.pages} page${f.pages === 1 ? "" : "s"} · added ${f.added}`),
            f.scanned ? el("small", { class: "warn" }, "Little readable text: this may be a scan. Reviews from it will be weak.") : null),
          kind,
          el("button", { class: "x", "aria-label": `Remove ${f.name}`, onclick: async () => {
            if (!confirm(`Remove ${f.name} from your library?`)) return;
            selectedFiles.delete(f.id); data = await api.study_remove_file(f.id); renderFiles();
          } }, "×"));
      })))));
  }

  // ---------- Review ----------
  const typeSel = el("select", { "aria-label": "Review type" });
  const countIn = el("input", { type: "number", min: 3, max: 30, value: 10, "aria-label": "How many" });
  const diffSel = el("select", { "aria-label": "Difficulty" }, [["auto", "Auto (adapts to your scores)"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]]
    .map(([d, l]) => el("option", { value: d }, l)));
  const timeIn = el("input", { type: "number", min: 0, max: 240, value: 0, "aria-label": "Time limit in minutes (0 = none)", title: "Minutes. 0 = no timer. Set a time to make it a mock exam." });
  const focusIn = el("input", { placeholder: "Focus on (optional), e.g. shear and moment diagrams", "aria-label": "Focus" });
  const usingNote = el("p", { class: "note" });
  const reviewList = el("ul", { class: "day-list" });
  const dueList = el("ul", { class: "day-list" });
  const weakBox = el("div");
  const viewer = el("div", { class: "review" });
  panes.Review.append(
    usingNote,
    el("div", { class: "row" }, typeSel, countIn, diffSel, el("label", { class: "inline" }, "Timer ", timeIn, " min")),
    focusIn,
    el("button", { class: "primary", onclick: async (e) => {
      if (!selectedFiles.size) return toast("Tick at least one file in the Library tab first.");
      busy(e.target, true, "Making your review… (up to a minute)");
      try {
        const r = await api.study_generate([...selectedFiles], typeSel.value, Number(countIn.value), diffSel.value, focusIn.value, Number(timeIn.value) || 0);
        if (r.error) return toast(r.error, 7000);
        data = await api.study_files();
        renderReviewPane();
        openReview(r.review);
      } finally { busy(e.target, false); }
    } }, "Make review"),
    viewer,
    el("h3", {}, "Due today"),
    el("p", { class: "note" }, "Spaced repetition: do well and a review comes back later; struggle and it comes back tomorrow."),
    dueList,
    el("h3", {}, "Weak topics"),
    weakBox,
    el("h3", {}, "Saved reviews"),
    reviewList);

  async function renderProgress() {
    const p = await api.study_progress();
    dueList.replaceChildren(...(p.due.length ? p.due.map((r) => el("li", {},
      el("span", { class: "what" }, el("a", { href: "#", onclick: async (e) => { e.preventDefault(); openReview(await api.study_review(r.id)); } }, r.title),
        el("small", {}, r.best != null ? `best ${r.best}%` : "not tried yet")))) : [el("li", { class: "none" }, "Nothing due. 🎉")]));
    const weak = p.weak;
    weakBox.replaceChildren(
      weak.length ? el("ul", { class: "day-list" }, weak.slice(0, 8).map((t) => el("li", {},
        el("span", { class: "what" }, t.topic, el("small", {}, `${t.right}/${t.total} right`)),
        el("span", { class: `meter${t.pct < 50 ? " hot" : ""}`, style: "width:110px" }, el("i", { style: `width:${t.pct}%` })),
        el("b", {}, `${t.pct}%`)))) : el("p", { class: "none" }, "None yet — do a few quizzes and I'll spot the topics you miss."),
      weak.length ? el("button", { class: "primary", onclick: async (e) => {
        busy(e.target, true, "Making a review of your weak topics…");
        try { const r = await api.study_weak_review("mcq", 10); if (r.error) return toast(r.error, 7000); data = await api.study_files(); renderReviewPane(); openReview(r.review); }
        finally { busy(e.target, false); }
      } }, "Practise my weak topics") : null);
  }

  function renderReviewPane() {
    renderProgress();
    typeSel.replaceChildren(...Object.entries(data.review_types).map(([v, l]) => el("option", { value: v }, l)));
    const names = data.files.filter((f) => selectedFiles.has(f.id)).map((f) => f.name);
    usingNote.textContent = names.length ? `Using: ${names.join(", ")}` : "Tick files in the Library tab to choose what to review.";
    reviewList.replaceChildren(...(data.reviews.length ? data.reviews.map((r) => el("li", {},
      el("span", { class: "what" }, el("a", { href: "#", onclick: async (e) => { e.preventDefault(); openReview(await api.study_review(r.id)); } }, r.title),
        el("small", {}, `${r.count} items · ${r.difficulty} · ${r.created}${r.best != null ? ` · best ${r.best}%` : ""}${r.due ? ` · next review ${r.due}` : ""}`)),
      el("button", { class: "x", "aria-label": "Delete review", onclick: async () => { data = await api.study_delete_review(r.id); renderReviewPane(); } }, "×")))
      : [el("li", { class: "none" }, "None yet.")]));
  }

  function openReview(r) {
    if (!r) return;
    const src = (s) => (s ? el("small", { class: "src" }, `Source: ${s}`) : null);
    const score = el("p", { class: "score", hidden: true });
    let check = null, results = null;
    const items = r.items || [];
    let body;
    if (r.type === "fill_blanks") {
      const inputs = items.map((it) => el("input", { class: "blank", "aria-label": "Your answer", size: Math.max(8, String(it.answer).length + 2) }));
      body = el("ol", {}, items.map((it, i) => {
        const [a, b] = it.sentence.split("____");
        return el("li", {}, a, inputs[i], b ?? "", el("span", { class: "fb" }), src(it.source));
      }));
      check = async () => {
        let right = 0;
        results = [];
        for (let i = 0; i < items.length; i++) {
          const ok = await api.study_check_blank(inputs[i].value, items[i]);
          right += ok; results.push(!!ok);
          inputs[i].classList.toggle("right", ok); inputs[i].classList.toggle("wrong", !ok);
          inputs[i].parentElement.querySelector(".fb").textContent = ok ? " ✓" : ` ✗ ${items[i].answer}`;
        }
        return right;
      };
    } else if (r.type === "mcq" || r.type === "true_false") {
      const picks = new Array(items.length).fill(null);
      body = el("ol", {}, items.map((it, i) => {
        const choices = r.type === "mcq" ? it.choices : ["True", "False"];
        const correct = r.type === "mcq" ? it.answer_index : (it.answer ? 0 : 1);
        const btns = choices.map((c, j) => el("button", { class: "choice", onclick: () => {
          picks[i] = j; btns.forEach((b, k) => b.classList.toggle("picked", k === j));
        } }, c));
        const expl = el("small", { class: "expl", hidden: true }, it.explanation || "");
        it._correct = correct; it._btns = btns; it._expl = expl;
        return el("li", {}, el("p", {}, r.type === "mcq" ? it.question : it.statement), el("div", { class: "choices" }, btns), expl, src(it.source));
      }));
      check = async () => {
        let right = 0;
        results = [];
        items.forEach((it, i) => {
          it._btns.forEach((b, k) => { b.classList.toggle("right", k === it._correct); b.classList.toggle("wrong", k === picks[i] && k !== it._correct); });
          it._expl.hidden = !it._expl.textContent;
          right += picks[i] === it._correct; results.push(picks[i] === it._correct);
        });
        return right;
      };
    } else if (r.type === "flashcards") {
      let i = 0, flipped = false;
      const knew = new Array(items.length).fill(null);
      const card = el("button", { class: "card", "aria-live": "polite" });
      const counter = el("span");
      const draw = () => { const it = items[i]; card.textContent = flipped ? it.back : it.front; card.classList.toggle("back", flipped);
        counter.textContent = `${i + 1} / ${items.length} · ${knew.filter((k) => k !== null).length} rated`; };
      card.addEventListener("click", () => { flipped = !flipped; draw(); });
      const rate = async (ok) => {
        knew[i] = ok;
        if (knew.every((k) => k !== null)) {
          const right = knew.filter(Boolean).length;
          score.hidden = false;
          score.textContent = `You knew ${right} of ${items.length}. ${right === items.length ? "Perfect!" : "The ones you missed will come back sooner."}`;
          await api.study_save_score(r.id, right, items.length, knew);
          data = await api.study_files(); renderReviewPane();
        } else { i = knew.findIndex((k, j) => k === null && j > i) >= 0 ? knew.findIndex((k, j) => k === null && j > i) : knew.indexOf(null); flipped = false; draw(); }
      };
      body = el("div", {}, card, el("div", { class: "row" },
        el("button", { class: "ghost", onclick: () => { i = (i - 1 + items.length) % items.length; flipped = false; draw(); } }, "Previous"),
        counter,
        el("button", { class: "ghost", onclick: () => { i = (i + 1) % items.length; flipped = false; draw(); } }, "Next")),
        el("div", { class: "row" }, el("button", { class: "ghost", onclick: () => rate(false) }, "✗ Didn't know"),
          el("button", { class: "primary", onclick: () => rate(true) }, "✓ Knew it"),
          r.subject && !r.files?.length ? el("button", { class: "ghost small", title: "Hear it",
            onclick: async () => { const x = await api.sensei_say(items[i].front); if (x.error) toast(x.error); } }, "🔊") : null),
        el("p", { class: "note" }, "Click the card to flip it, then say whether you knew it."));
      draw();
    } else if (r.type === "problems") {
      body = el("ol", {}, items.map((it) => {
        const steps = el("div", { class: "steps", hidden: true },
          it.given?.length ? el("p", {}, el("strong", {}, "Given: "), it.given.join("; ")) : null,
          el("ol", {}, (it.steps || []).map((s) => el("li", {}, s))),
          el("p", {}, el("strong", {}, "Answer: "), it.answer), src(it.source));
        return el("li", {}, el("p", {}, it.problem), el("textarea", { rows: 3, placeholder: "Work it out here first…", "aria-label": "Your working" }),
          el("button", { class: "ghost small", onclick: (e) => { steps.hidden = !steps.hidden; e.target.textContent = steps.hidden ? "Show solution" : "Hide solution"; } }, "Show solution"),
          steps);
      }));
    } else if (r.type === "summary") {
      body = el("div", {}, (r.sections || []).map((s) => el("section", {}, el("h4", {}, s.heading),
        el("ul", {}, s.points.map((p) => el("li", {}, p))), src(s.source))));
    }
    const actions = check ? el("div", { class: "row" }, el("button", { class: "primary", onclick: async () => {
      const right = await check();
      score.hidden = false;
      const pct = Math.round(100 * right / items.length);
      score.textContent = `Score: ${right} / ${items.length} (${pct}%)${pct === 100 ? " Perfect!" : pct >= 75 ? " Nice work." : " Review the ones you missed and try again."}`;
      clearInterval(timerId);
      await api.study_save_score(r.id, right, items.length, results);
      data = await api.study_files(); renderReviewPane();
    } }, "Check my answers")) : null;
    // timed mock exam: countdown, then answers are checked automatically
    let timerId = null;
    const timerEl = r.time_limit && check ? el("p", { class: "exam-timer" }) : null;
    if (timerEl) {
      const end = Date.now() + r.time_limit * 60000;
      const tickT = () => {
        const left = Math.max(0, Math.round((end - Date.now()) / 1000));
        timerEl.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`;
        timerEl.classList.toggle("ending", left <= 60);
        if (!left) { clearInterval(timerId); toast("Time's up — checking your answers."); actions.firstChild.click(); }
      };
      timerId = setInterval(tickT, 1000); tickT();
    }
    viewer.replaceChildren(el("div", { class: "review-head" }, el("h3", {}, r.title), el("button", { class: "x", "aria-label": "Close review",
      onclick: () => { clearInterval(timerId); viewer.replaceChildren(); } }, "×")),
      timerEl, body, actions, score);
    if (r.subject && !r.files?.length) { show("Review"); }
    viewer.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Language (Multilingual Sensei) ----------
  const langSel = el("select", { "aria-label": "Language" });
  const levelSel = el("select", { "aria-label": "Level" });
  const streakEl = el("span", { class: "streak" });
  const langOut = el("div", { class: "answer" });
  const talkList = el("ul", { class: "day-list" });
  const topicIn = el("input", { placeholder: "Topic, e.g. hiragana あ row · ordering food · past tense · anime greetings", "aria-label": "Topic" });
  const sayIn = el("input", { placeholder: "A phrase to practise saying, e.g. はじめまして", "aria-label": "Phrase to pronounce" });
  let langLoaded = false;
  const saveLang = async () => { const s = await api.sensei_set(langSel.value, Number(levelSel.value)); streakEl.textContent = s.streak ? `🔥 ${s.streak}-day streak` : ""; };
  langSel.addEventListener("change", saveLang); levelSel.addEventListener("change", saveLang);
  const quizKind = el("select", { "aria-label": "Quiz type" }, [["flashcards", "Flashcards"], ["mcq", "Multiple choice"], ["fill_blanks", "Fill in the blanks"]].map(([v, l]) => el("option", { value: v }, l)));
  panes.Language.append(
    el("p", { class: "note" }, "Your language teacher. Lessons, quizzes that come back with spaced repetition, conversation practice with corrections, and pronunciation checks with your mic."),
    el("div", { class: "row" }, langSel, levelSel, streakEl),
    topicIn,
    el("div", { class: "row" },
      el("button", { class: "primary", onclick: async (e) => {
        busy(e.target, true, "Writing your lesson…");
        try { const r = await api.sensei_lesson(topicIn.value, langSel.value, Number(levelSel.value)); if (r.error) return toast(r.error);
          setMd(langOut, r.lesson, api); addListen(langOut, langSel.value); streakEl.textContent = r.streak ? `🔥 ${r.streak}-day streak` : ""; }
        finally { busy(e.target, false); }
      } }, "Teach me"),
      quizKind,
      el("button", { class: "ghost", onclick: async (e) => {
        busy(e.target, true, "Making a quiz…");
        try { const r = await api.sensei_quiz(topicIn.value, quizKind.value, 12, langSel.value, Number(levelSel.value)); if (r.error) return toast(r.error, 7000);
          data = await api.study_files(); toast("Saved to Review — it will come back for spaced repetition."); openReview(r.review); }
        finally { busy(e.target, false); }
      } }, "Make a quiz"),
      el("button", { class: "ghost", onclick: async (e) => {
        busy(e.target, true, "Starting…");
        try { const r = await api.sensei_talk_start(topicIn.value || "everyday small talk", langSel.value, Number(levelSel.value)); if (r.error) return toast(r.error); openTalk(r); }
        finally { busy(e.target, false); }
      } }, "Conversation practice"),
      el("button", { class: "ghost", title: "A lesson built from the mistakes she corrected in your conversations", onclick: async (e) => {
        busy(e.target, true, "Looking at your mistakes…");
        try { const r = await api.sensei_mistakes_lesson(langSel.value); if (r.error) return toast(r.error, 7000); setMd(langOut, r.lesson, api); addListen(langOut, langSel.value); }
        finally { busy(e.target, false); }
      } }, "Lesson from my mistakes")),
    el("h3", {}, "Pronunciation"),
    el("div", { class: "row" }, sayIn,
      el("button", { class: "ghost small", onclick: async () => { const r = await api.sensei_say(sayIn.value, langSel.value); if (r.error) toast(r.error, 6000); } }, "🔊 Hear it"),
      el("button", { class: "primary", onclick: async (e) => {
        if (!sayIn.value.trim()) return toast("Type the phrase you want to practise first.");
        busy(e.target, true, "🎙 Listening (5 s)…");
        try {
          const r = await api.sensei_pronounce(sayIn.value, langSel.value, 5);
          if (r.error) return toast(r.error, 7000);
          langOut.replaceChildren(el("div", { class: `pron ${r.score >= 90 ? "good" : r.score >= 70 ? "ok" : "low"}` },
            el("b", {}, `${r.score}% — ${r.verdict}`), el("p", {}, `You said: ${r.heard}`), el("p", {}, `Target: ${r.expected}`),
            r.tip ? el("p", { class: "note" }, r.tip) : null));
        } finally { busy(e.target, false); }
      } }, "🎙 Say it")),
    langOut,
    el("h3", {}, "Earlier conversations"),
    talkList);

  // 🔊 next to everything in the language you're learning, so you can hear how it sounds
  const SCRIPT = { ja: /[\u3040-\u30ff\u3400-\u9fff]/, zh: /[\u3400-\u9fff]/, ko: /[\uac00-\ud7af]/, th: /[\u0e00-\u0e7f]/, ru: /[\u0400-\u04ff]/ };
  const EN = new Set("the and is are you your to of in it this that for with means say use when how what a an be can or example word words".split(" "));
  const asMarkdown = (node) => { const c = node.cloneNode(true); c.querySelectorAll("strong, b").forEach((b) => b.replaceWith(`**${b.textContent}**`)); c.querySelectorAll(".listen").forEach((x) => x.remove()); return c.textContent; };
  function worthHearing(node, lang) {
    const text = node.textContent;
    if (SCRIPT[lang]) return SCRIPT[lang].test(text);
    const words = text.toLowerCase().match(/[\p{L}]+/gu) || [];
    return node.querySelector("strong, b") || (words.length && words.filter((w) => EN.has(w)).length / words.length < 0.3);
  }
  function listenButton(getText, lang) {
    return el("button", { class: "listen", title: "Hear it", "aria-label": "Hear it", onclick: async (e) => {
      e.stopPropagation();
      const r = await api.sensei_say(getText(), lang);
      if (r.error) toast(r.error, 6000);
    } }, "🔊");
  }
  function addListen(container, lang) {
    for (const node of container.querySelectorAll("p, li, td, h4")) {
      if (node.querySelector("p, li") || !worthHearing(node, lang)) continue;
      node.append(" ", listenButton(() => asMarkdown(node), lang));
    }
  }

  function openTalk(p) {
    const log = el("div", { class: "code-log" });
    const draw = () => {
      log.replaceChildren(...p.messages.map((m) => { const b = el("div", { class: `msg ${m.role === "user" ? "user" : "assistant"}` });
        if (m.role === "user") b.textContent = m.content;
        else { setMd(b, m.content, api); b.append(listenButton(() => m.content, langSel.value)); }
        return b; }));
      if (p.score) { const s = el("div", { class: "msg assistant score-box" }); setMd(s, p.score, api); log.append(el("h3", {}, "Teacher's feedback"), s); }
    };
    draw();
    const input = el("textarea", { rows: 2, placeholder: "Reply in the language you're learning (mistakes are fine!)", "aria-label": "Your reply" });
    const send = el("button", { class: "primary" }, "Send");
    send.addEventListener("click", async () => {
      if (!input.value.trim()) return;
      const text = input.value; input.value = ""; p.messages.push({ role: "user", content: text }); draw();
      busy(send, true, "…");
      try { const r = await api.practice_reply(p.id, text); if (r.error) return toast(r.error); Object.assign(p, r); draw(); log.lastChild?.scrollIntoView({ block: "end" }); }
      finally { busy(send, false); }
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); } });
    langOut.replaceChildren(el("div", { class: "row" }, el("strong", {}, `Conversation: ${p.topic}`)), log,
      el("div", { class: "code-input" }, input, send),
      el("button", { class: "ghost", onclick: async (e) => {
        busy(e.target, true, "Checking your mistakes…");
        try { const r = await api.practice_finish(p.id); if (r.error) return toast(r.error); Object.assign(p, r); draw(); renderLanguage(); }
        finally { busy(e.target, false); }
      } }, "Finish & get feedback"));
    input.focus();
  }

  async function renderLanguage() {
    const s = await api.sensei_settings();
    if (!langLoaded) {
      langSel.replaceChildren(...Object.entries(s.languages).map(([v, l]) => el("option", { value: v }, l)));
      levelSel.replaceChildren(...Object.entries(s.levels).map(([v, l]) => el("option", { value: v }, l[0].toUpperCase() + l.slice(1))));
      langLoaded = true;
    }
    langSel.value = s.language; levelSel.value = String(s.level);
    streakEl.textContent = s.streak ? `🔥 ${s.streak}-day streak` : "Practise today to start a streak";
    const talks = await api.sensei_talks();
    talkList.replaceChildren(...(talks.length ? talks.map((p) => el("li", {}, el("span", { class: "what" },
      el("a", { href: "#", onclick: (e) => { e.preventDefault(); openTalk(p); } }, p.topic), el("small", {}, `${p.created.slice(0, 10)}${p.score ? " · has feedback" : ""}`))))
      : [el("li", { class: "none" }, "None yet.")]));
  }

  // ---------- Research ----------
  const rq = el("textarea", { rows: 4, placeholder: "Ask a research question, or paste text to fact-check…", "aria-label": "Research question" });
  const factBox = el("input", { type: "checkbox", id: "factCheck" });
  const rOut = el("div", { class: "answer" });
  panes.Research.append(
    el("p", { class: "note" }, "Finds real journal papers (OpenAlex + Crossref: ScienceDirect, Springer, IEEE, Wiley, PubMed journals… — never Wikipedia). Your own AI answers from them and cites in APA 7th edition. Fact-check mode checks each claim in pasted text."),
    rq, el("label", { class: "check", for: "factCheck" }, factBox, "Fact-check this text instead"),
    el("button", { class: "primary", onclick: async (e) => {
      busy(e.target, true, "Finding papers…");
      try {
        const r = await api.study_research(rq.value, factBox.checked);
        if (r.error) return toast(r.error, 7000);
        rOut.replaceChildren();
        const ans = el("div", {}); setMd(ans, r.answer, api);
        rOut.append(ans);
        if (r.sources.length) {
          const copy = el("button", { class: "ghost small", onclick: async () => {
            const htmlList = r.sources.map((s) => `<p style="margin-left:.5in;text-indent:-.5in">${(s.apa_md || s.apa)
              .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\*([^*]+)\*/g, "<i>$1</i>")}</p>`).join("");
            try {
              await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([htmlList], { type: "text/html" }),
                "text/plain": new Blob([r.sources.map((s) => s.apa).join("\n")], { type: "text/plain" }) })]);
              toast("References copied — paste into Word and the italics stay.");
            } catch {
              try { await navigator.clipboard.writeText(r.sources.map((s) => s.apa).join("\n")); toast("References copied."); }
              catch { toast("Couldn't copy — select the text instead."); }
            } } }, "Copy references");
          rOut.append(el("div", { class: "row ref-head" }, el("h4", {}, "References"), el("small", {}, "APA 7th edition"), copy),
            el("ul", { class: "apa" }, r.sources.map((s) => {
              const li = el("li", {});
              setMd(li, (s.apa_md || s.apa).replace(s.url, "").trim(), api);
              if (s.url) li.append(" ", el("a", { href: "#", onclick: (ev) => { ev.preventDefault(); api.open_url(s.url); } }, s.url));
              if (s.cited_by) li.append(el("span", { class: "badge", title: "How many other papers cite this one" }, `cited ${s.cited_by}×`));
              return li;
            })));
          if (r.unverified?.length) rOut.append(el("p", { class: "warn" }, `Check these citations — they aren't in the paper list: ${r.unverified.join("; ")}`));
          if (r.dropped) rOut.append(el("p", { class: "note" }, `Left out ${r.dropped} non-academic source${r.dropped > 1 ? "s" : ""} (like Wikipedia).`));
          if (r.sources.some((s) => !s.url)) rOut.append(el("p", { class: "note" }, "Some references have no link — search their title on Google Scholar to check them."));
        } else rOut.append(el("p", { class: "warn" }, "No academic sources came back, so double-check this answer before using it."));
      } finally { busy(e.target, false); }
    } }, "Search"),
    el("button", { class: "ghost", title: "Reads 4-5 websites and shows where they agree and where they conflict", onclick: async (e) => {
      if (!rq.value.trim()) return toast("Type a question or a claim first.");
      busy(e.target, true, "Reading websites…");
      try {
        const r = await api.compare_sources(rq.value, factBox.checked);
        if (r.error) return toast(r.error, 7000);
        const rel = Object.fromEntries((r.reliability || []).map((x) => [x.source, x]));
        rOut.replaceChildren(
          el("div", { class: "verdict" }, el("b", {}, factBox.checked ? "Verdict: " : "Answer: "), r.verdict),
          r.agree.length ? el("div", {}, el("h4", {}, "✓ They agree on"), el("ul", {}, r.agree.map((a) => el("li", {}, a)))) : null,
          el("h4", {}, r.conflicts.length ? "⚠ Where they conflict" : "No real conflicts between these sources"),
          ...r.conflicts.map((c) => el("div", { class: "conflict" }, el("b", {}, c.topic || ""), el("ul", {}, (c.sides || []).map((x) => el("li", {}, x))),
            c.likely_right ? el("p", { class: "note" }, `Most likely right: ${c.likely_right}`) : null)),
          el("h4", {}, "Sources"),
          el("ol", { class: "srcs" }, r.sources.map((s) => el("li", {},
            el("a", { href: "#", onclick: (ev) => { ev.preventDefault(); api.open_url(s.url); } }, s.title),
            el("small", {}, ` ${s.site}`), rel[s.n] ? el("span", { class: `badge rel-${rel[s.n].rating}`, title: rel[s.n].why || "" }, `${rel[s.n].rating} reliability`) : null))));
      } finally { busy(e.target, false); }
    } }, "Compare web sources"),
    rOut);

  // ---------- Assignment ----------
  const aq = el("textarea", { rows: 6, placeholder: "Paste the assignment question…", "aria-label": "Assignment question" });
  const modeSel = el("select", { "aria-label": "How to help" }, [
    ["explain", "Explain and guide me step by step"], ["hints", "Just give me hints"],
    ["check", "Check my answer"], ["solve", "Show the full worked solution"]].map(([v, l]) => el("option", { value: v }, l)));
  const myAns = el("textarea", { rows: 5, placeholder: "Paste your answer or working…", "aria-label": "My answer", hidden: true });
  const useFiles = el("input", { type: "checkbox", id: "useFiles", checked: true });
  const aOut = el("div", { class: "answer" });
  modeSel.addEventListener("change", () => (myAns.hidden = modeSel.value !== "check"));
  panes.Assignment.append(
    el("p", { class: "note" }, "She uses your own lecture files, so methods and notation match your class."),
    aq, modeSel, myAns, el("label", { class: "check", for: "useFiles" }, useFiles, "Only use the files ticked in Library (otherwise all files)"),
    el("button", { class: "primary", onclick: async (e) => {
      busy(e.target, true, "Thinking…");
      try {
        const ids = useFiles.checked && selectedFiles.size ? [...selectedFiles] : null;
        const r = await api.study_assignment(aq.value, modeSel.value, myAns.value, ids);
        if (r.error) return toast(r.error, 7000);
        setMd(aOut, r.answer + (r.used.length ? `\n\n*From your files: ${r.used.join("; ")}*` : ""), api);
      } finally { busy(e.target, false); }
    } }, "Help me"),
    aOut);

  async function load(tab) {
    data = await api.study_files();
    renderFiles();
    renderReviewPane();
    show(tab || "Library");
  }
  return { load };
}
