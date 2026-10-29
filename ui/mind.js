// mind.js - Journal (decisions, ideas, goals, stories), Think tools, and Search everything.
import { $, el, toast, setMd, busy, loadingCard } from "./util.js";

const KINDS = {
  decision: { label: "Decisions", one: "Decision", hint: "What did you decide, and why?", title: "e.g. Took the solar dryer thesis topic" },
  idea: { label: "Ideas", one: "Idea", hint: "Write the idea, even half-formed. Click “Grow it” later.", title: "e.g. App that reminds me to drink water" },
  goal: { label: "Goals", one: "Goal", hint: "One small step per line", title: "e.g. Finish thesis chapter 2" },
  story: { label: "Stories", one: "Story", hint: "A memory, lesson or story you want to keep.", title: "e.g. My first robotics competition" },
};
// [mode, name, what it does, example] grouped for the dropdown
const GROUPS = {
  "Big decisions": [
    ["council", "Council", "Several experts (researcher, planner, programmer, critic) answer, then she combines them.", "Should I learn React or Flutter for my capstone?"],
    ["what_if", "What if…", "See how a change could play out: best, likely and worst case.", "What if I study 2 hours every morning instead of at night?"],
    ["simulate", "Simulate my plan", "Test a schedule, study plan or budget and find where it breaks.", "Weekdays: class 8-5, gym 6pm, thesis 8-11pm. Budget ₱3000/week."],
    ["foresight", "Look ahead", "1, 3 and 5 years ahead: trends, risks and moves to make now.", "Being a civil engineer in the Philippines"],
    ["blindspot", "Find blind spots", "Hidden assumptions, missing requirements and risks in a plan.", "My plan to finish the thesis survey in 2 weeks"],
    ["feasibility", "Is this goal realistic?", "Time, money and effort needed, compared with what you already have on.", "Get a 100 kg bench press by March"],
  ],
  "Solve problems": [
    ["hypothesis", "Possible explanations", "Ranked explanations for a problem, each with a test.", "Why does my music keep skipping songs?"],
    ["causal", "Cause or coincidence?", "Separates real causes from things that just happen together.", "I sleep better on days I go to the gym"],
    ["evolve", "Evolve a solution", "Makes 3 solutions, scores them, improves the best one over rounds (slow).", "How to keep my room cool without aircon"],
    ["contradiction", "Find contradictions", "Checks your plans, notes, tasks and decisions for conflicts.", "Check my week"],
    ["reverse", "Break down a success", "Turn a success into steps you can copy.", "How did Duolingo make people study every day?"],
  ],
  "Ideas & making": [
    ["fusion", "Mix ideas", "Combine fields or ideas into new concepts.", "Penguins + solar energy + study apps"],
    ["grow", "Grow an idea", "Develops an idea: who it's for, risks, next steps.", "A study timer the room reacts to"],
    ["prototype", "Idea → prototype plan", "The smallest version worth building, and how to build and test it.", "A gym buddy app that counts reps with the camera"],
    ["modeling", "3D modeling coach", "Step-by-step Blender help, all the way to a model for Vermeil's room.", "Make a low-poly penguin with a scarf and rig it"],
  ],
  "Habits & growth": [
    ["procrastination", "Beat procrastination", "Turns a scary task into a 5-minute first step and small next steps.", "Write chapter 3 of my thesis"],
    ["habit", "Habit experiment", "A 1-2 week experiment to test a habit change.", "Stop using my phone in bed"],
    ["challenge", "Make me a challenge", "A daily or weekly challenge for your interests and level.", "Something for my gym and coding"],
    ["ritual", "Design a routine", "A realistic routine you can turn into reminders.", "A calm morning routine before 8am class"],
    ["drift", "Missed routines", "Finds routines you keep missing and suggests better times or smaller versions.", "Check my routines"],
    ["patterns", "Find my patterns", "Looks at your journal, tasks, reminders and chats for habits.", "Why do I keep missing deadlines?"],
  ],
};
const MODES = Object.values(GROUPS).flat();
const PRACTICE = {
  debate: { name: "Debate partner", hint: "A topic you have an opinion on. She argues the other side, then scores your reasoning.", ex: "AI will replace civil engineers" },
  rehearse: { name: "Confidence rehearsal", hint: "A situation to practise. She plays the other person; raise the level as you get better.", ex: "Thesis defense with a strict panel" },
  reflect: { name: "Reflection interview", hint: "Something big that happened. She asks questions one at a time, then saves the lessons to Stories.", ex: "My first gym competition" },
};

export function initMind(api) {
  let tab = "decision";
  const root = $("mindBody");
  const tabs = el("div", { class: "tabs", role: "tablist" });
  const view = el("div");
  root.replaceChildren(tabs, view);

  const tabList = [...Object.entries(KINDS).map(([k, v]) => [k, v.label]), ["think", "Think"], ["practice", "Practice"], ["search", "Search everything"]];
  function drawTabs() {
    tabs.replaceChildren(...tabList.map(([k, label]) => el("button", { role: "tab", "aria-selected": String(k === tab),
      onclick: () => { tab = k; load(); } }, label)));
  }

  async function load() {
    drawTabs();
    if (tab === "think") return drawThink();
    if (tab === "practice") return drawPractice();
    if (tab === "search") return drawSearch();
    const { items, review } = await api.journal_list(tab);
    const k = KINDS[tab];
    const form = el("form", { class: "jform" },
      el("input", { name: "title", placeholder: k.title, "aria-label": "Title", required: true }),
      el("textarea", { name: tab === "goal" ? "steps" : "text", rows: 3, placeholder: k.hint, "aria-label": "Details" }),
      tab === "decision" ? el("label", {}, "Look back in ", el("input", { name: "review_in_days", type: "number", min: 1, value: 30, style: "width:5em" }), " days") : null,
      el("button", { class: "primary", type: "submit" }, `Save ${k.one.toLowerCase()}`));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await api.journal_add({ kind: tab, ...Object.fromEntries(new FormData(form)) });
      if (r.error) return toast(r.error);
      toast("Saved.");
      load();
    });
    const list = el("ul", { class: "journal" }, items.length ? items.map((e) => entry(e, review.includes(e.id)))
      : [el("li", { class: "none" }, "Nothing yet. Add one below, or just tell her in chat.")]);
    view.replaceChildren(list, el("h3", {}, `New ${k.one.toLowerCase()}`), form);
    const due = review.length;
    $("mindSub").textContent = due ? `${due} decision${due > 1 ? "s" : ""} to look back on` : "Decisions, ideas, goals";
  }

  function entry(e, due) {
    const li = el("li", { class: `jentry${e.status === "done" ? " done" : ""}` },
      el("div", { class: "row" }, el("strong", {}, e.title), el("small", {}, e.created.slice(0, 10)),
        el("button", { class: "x", "aria-label": `Delete ${e.title}`, onclick: async () => { await api.journal_remove(e.id); load(); } }, "×")),
      e.text ? el("p", {}, e.text) : null);
    if (e.kind === "decision") {
      if (due) li.append(el("p", { class: "note" }, "It's time to look back: how did this decision turn out?"));
      const out = el("input", { value: e.outcome, placeholder: "How did it turn out?", "aria-label": "Outcome" });
      li.append(el("div", { class: "row" }, out, el("button", { class: "ghost small", onclick: async () => {
        await api.journal_update(e.id, { outcome: out.value }); toast("Outcome saved."); load(); } }, "Save outcome")));
    }
    if (e.kind === "goal") {
      const done = e.steps.filter((s) => s.done).length;
      li.append(el("progress", { max: e.steps.length || 1, value: done, "aria-label": "Progress" }),
        el("ul", { class: "steps" }, e.steps.map((s, i) => el("li", {}, el("label", { class: "check" },
          el("input", { type: "checkbox", checked: s.done, onchange: async () => { await api.journal_update(e.id, { toggle_step: i }); load(); } }), s.text)))));
      const add = el("input", { placeholder: "Add a step", "aria-label": "New step" });
      li.append(el("form", { class: "row", onsubmit: async (ev) => { ev.preventDefault(); if (!add.value.trim()) return;
        await api.journal_update(e.id, { add_step: add.value }); load(); } }, add, el("button", { class: "ghost small" }, "Add")));
    }
    if (e.kind === "idea") {
      li.append(el("button", { class: "ghost small", onclick: () => { tab = "think"; load().then(() => runThink("grow", `${e.title}. ${e.text}`)); } }, "Grow it"));
    }
    return li;
  }

  let output;
  function drawThink() {
    const mode = el("select", { "aria-label": "Kind of thinking" }, Object.entries(GROUPS).map(([g, list]) =>
      el("optgroup", { label: g }, list.map(([v, label]) => el("option", { value: v }, label)))));
    const about = el("p", { class: "note" });
    const q = el("textarea", { rows: 3, "aria-label": "What to think about" });
    const go = el("button", { class: "primary", type: "submit" }, "Think");
    const sync = () => { const m = MODES.find((x) => x[0] === mode.value); about.textContent = m[2]; q.placeholder = `e.g. ${m[3]}`; };
    mode.addEventListener("change", sync); sync();
    output = el("div", { class: "think-out", "aria-live": "polite" });
    view.replaceChildren(el("form", { class: "jform", onsubmit: (e) => { e.preventDefault(); runThink(mode.value, q.value, go); } },
      mode, about, q, go), output);
  }

  async function runThink(mode, question, btn) {
    output.replaceChildren(loadingCard("Vermeil is thinking and exploring ideas… (~15-20 s)"));
    if (btn) busy(btn, true, "Thinking…");
    try {
      const r = await api.think(mode, question);
      if (r.error) return output.replaceChildren(el("p", {}, `Something went wrong: ${r.error}`));
      const main = el("div", { class: "msg assistant" }); setMd(main, r.answer, api);
      output.replaceChildren(main, ...(r.parts || []).map((p) => {
        const d = el("details", {}, el("summary", {}, `What the ${p.role} said`)); const b = el("div"); setMd(b, p.text, api); d.append(b); return d;
      }));
      if (r.steps?.length) output.append(el("button", { class: "ghost small", onclick: async (ev) => {
        const g = await api.journal_add({ kind: "goal", title: r.goal || question.slice(0, 80), steps: r.steps.join("\n") });
        if (g.error) return toast(g.error);
        ev.target.disabled = true; toast("Saved to Goals — tick the steps off as you go.");
      } }, `Save ${r.steps.length} steps as a goal`));
    } finally { if (btn) busy(btn, false); }
  }

  // ---------- Practice: debate, confidence rehearsal, reflection interview ----------
  let current = null;
  async function drawPractice() {
    if (current) return drawConversation();
    const kind = el("select", { "aria-label": "Kind of practice" }, Object.entries(PRACTICE).map(([k, v]) => el("option", { value: k }, v.name)));
    const about = el("p", { class: "note" });
    const topic = el("textarea", { rows: 2, "aria-label": "Topic or situation" });
    const level = el("input", { type: "range", min: 1, max: 5, value: 2, "aria-label": "Difficulty" });
    const levelOut = el("output", {}, "2");
    level.addEventListener("input", () => { levelOut.textContent = level.value; });
    const levelRow = el("label", {}, "Difficulty ", levelOut, " / 5", level);
    const sync = () => { const p = PRACTICE[kind.value]; about.textContent = p.hint; topic.placeholder = `e.g. ${p.ex}`; levelRow.hidden = kind.value !== "rehearse"; };
    kind.addEventListener("change", sync); sync();
    const go = el("button", { class: "primary", type: "submit" }, "Start");
    const past = await api.practice_list();
    view.replaceChildren(
      el("form", { class: "jform", onsubmit: async (e) => {
        e.preventDefault(); busy(go, true, "Starting…");
        try { const r = await api.practice_start(kind.value, topic.value, Number(level.value)); if (r.error) return toast(r.error); current = r; drawConversation(); }
        finally { busy(go, false); }
      } }, kind, about, topic, levelRow, go),
      past.length ? el("h3", {}, "Earlier practice") : null,
      el("ul", { class: "journal" }, past.map((p) => el("li", { class: "jentry", role: "button", tabindex: 0, onclick: () => { current = p; drawConversation(); } },
        el("div", { class: "row" }, el("strong", {}, `${PRACTICE[p.kind].name}: ${p.topic}`), el("small", {}, p.created.slice(0, 10))),
        p.score ? el("small", {}, "Has feedback") : el("small", {}, "Not finished")))));
  }

  function drawConversation() {
    const p = current, info = PRACTICE[p.kind];
    const log = el("div", { class: "code-log" });
    const draw = () => {
      log.replaceChildren(...p.messages.map((m) => { const b = el("div", { class: `msg ${m.role === "user" ? "user" : "assistant"}` });
        if (m.role === "user") b.textContent = m.content; else setMd(b, m.content, api); return b; }));
      if (p.score) { const s = el("div", { class: "msg assistant score-box" }); setMd(s, p.score, api); log.append(el("h3", {}, "Feedback"), s); }
    };
    draw();
    const input = el("textarea", { rows: 2, placeholder: p.kind === "debate" ? "Your argument…" : "Your answer…", "aria-label": "Your reply" });
    const send = el("button", { class: "primary" }, "Send");
    const finish = el("button", { class: "ghost" }, p.kind === "debate" ? "Score me" : p.kind === "reflect" ? "Finish & save to Stories" : "Get feedback");
    send.addEventListener("click", async () => {
      if (!input.value.trim()) return;
      p.messages.push({ role: "user", content: input.value }); const text = input.value; input.value = ""; draw();
      busy(send, true, "…");
      try { const r = await api.practice_reply(p.id, text); if (r.error) return toast(r.error); Object.assign(p, r); draw(); log.lastChild?.scrollIntoView({ block: "end" }); }
      finally { busy(send, false); }
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); } });
    finish.addEventListener("click", async () => {
      busy(finish, true, "Thinking…");
      try { const r = await api.practice_finish(p.id); if (r.error) return toast(r.error); Object.assign(p, r); draw();
        if (p.kind === "reflect") toast("Saved to Stories."); }
      finally { busy(finish, false); }
    });
    const harder = p.kind === "rehearse" && p.level < 5 ? el("button", { class: "ghost", onclick: async () => {
      const r = await api.practice_start("rehearse", p.topic, p.level + 1); if (r.error) return toast(r.error); current = r; drawConversation(); } },
      `Try level ${p.level + 1}`) : null;
    view.replaceChildren(
      el("div", { class: "row" }, el("button", { class: "ghost small", onclick: () => { current = null; drawPractice(); } }, "‹ All practice"),
        el("strong", {}, `${info.name}${p.kind === "rehearse" ? ` · level ${p.level}` : ""}: ${p.topic}`)),
      log, el("div", { class: "code-input" }, input, send), el("div", { class: "row" }, finish, harder));
  }

  function drawSearch() {
    const q = el("input", { placeholder: "e.g. thesis adviser, matcha, that bug in my music player", "aria-label": "Search" });
    const res = el("ul", { class: "journal" });
    view.replaceChildren(el("p", { class: "note" }, "Searches every past chat, your journal and your notes."),
      el("form", { class: "row", onsubmit: async (e) => { e.preventDefault();
        const hits = await api.recall(q.value);
        res.replaceChildren(...(hits.length ? hits.map((h) => el("li", { class: "jentry" }, el("small", {}, `${h.source} ${h.date}`), el("p", {}, h.text)))
          : [el("li", { class: "none" }, "Nothing found.")]));
      } }, q, el("button", { class: "primary" }, "Search")), res);
  }

  return { load };
}
