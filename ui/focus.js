// focus.js - Focus Session Director (work/break rounds, distraction log, summary) + Progress charts.
import { $, el, toast, setMd, busy } from "./util.js";
import { play, alarm } from "./fx.js";
import { drawWeek, drawGoals, drawHabits, drawTravel, drawScreen } from "./planlife.js";

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s % 60)).padStart(2, "0")}`;

export function initFocus(api) {
  const root = $("focusBody");
  let tab = "focus";
  // session state (lives in the window; Python keeps the log)
  const st = { on: false, phase: "work", round: 1, rounds: 4, work: 25, brk: 5, left: 0, focused: 0, task: "", id: null, paused: false };

  const tabs = el("div", { class: "tabs", role: "tablist" });
  const view = el("div");
  root.replaceChildren(tabs, view);
  const TABS = [["focus", "Focus session"], ["week", "📅 Week"], ["goals", "🌳 Goals"], ["habits", "🟩 Habits"], ["travel", "✈️ Travel"],
    ["screen", "⏱️ Screen time"], ["progress", "My progress"]];
  const drawTabs = () => tabs.replaceChildren(...TABS.map(([k, l]) =>
    el("button", { role: "tab", "aria-selected": String(k === tab), onclick: () => { tab = k; load(); } }, l)));

  // ---------------- timer ----------------
  function tick() {
    if (st.paused) return;
    st.left -= 1;
    if (st.phase === "work") st.focused += 1;
    if (st.left <= 0) nextPhase();
    if (tab === "focus" && !st.locking) drawTimer();          // not over the hard-lock sentence box
  }
  async function nextPhase() {
    if (st.phase === "work") {
      await api.focus_round();
      if (st.round >= st.rounds) return finish();
      st.phase = "break"; st.left = st.brk * 60;
      try { st.idea = (await api.focus_extras()).break; } catch { st.idea = null; }
      alarm({ bursts: 2 }); toast(`Round ${st.round} done — ${st.brk}-minute break. ${st.idea ? st.idea.icon + " " + st.idea.text : "Stand up, drink water."}`, 9000);
    } else {
      st.phase = "work"; st.round += 1; st.left = st.work * 60;
      alarm({ bursts: 3 }); toast(`Break's over — round ${st.round} of ${st.rounds}: ${st.task}`, 6000);
    }
  }
  async function begin(task, work, brk, rounds, alreadyStarted = false) {
    if (!alreadyStarted) await api.focus_start(task, work, brk, rounds);
    Object.assign(st, { on: true, phase: "work", round: 1, rounds, work, brk, left: work * 60, focused: 0, task, paused: false });
    try { st.hard = !!(await api.save_settings({})).focus_hard_lock; } catch { st.hard = false; }
    clearInterval(st.id); st.id = setInterval(tick, 1000);
    play("on");
    load();
  }
  async function finish() {
    clearInterval(st.id); st.on = false; st.locking = false;
    const r = await api.focus_finish(Math.round(st.focused / 60));
    play("success");
    view.replaceChildren(el("div", { class: "focus-done" }, el("h3", {}, "Session complete"), el("p", {}, r.summary || r.error || ""),
      r.tips ? (() => { const d = el("div", { class: "msg assistant" }); setMd(d, r.tips, api); return d; })() : null,
      el("button", { class: "primary", onclick: () => load() }, "New session")));
  }

  /** hard lock: stopping early means typing the give-up sentence exactly */
  async function tryEnd() {
    if (!st.hard || st.round >= st.rounds && st.phase === "break") return finish();
    st.locking = true;
    const x = await api.focus_extras();
    const typed = el("textarea", { rows: 3, "aria-label": "Type the sentence to stop", spellcheck: "false" });
    typed.addEventListener("paste", (e) => e.preventDefault());
    const box = el("form", { class: "hard-lock", onsubmit: async (e) => {
      e.preventDefault();
      if (!(await api.focus_unlock(typed.value)).ok) return toast("Not quite. Type it exactly, or keep going 💪");
      finish();
    } },
      el("h4", {}, "🔒 Hard lock is on"), el("p", {}, "To stop early, type this sentence exactly (no pasting):"),
      el("blockquote", {}, x.unlock_sentence), typed,
      el("div", { class: "row" }, el("button", { type: "button", class: "primary", onclick: () => { st.locking = false; drawTimer(); } }, "Keep focusing"),
        el("button", { class: "ghost danger" }, "Give up")));
    view.replaceChildren(box);
    typed.focus();
  }

  function drawTimer() {
    const total = (st.phase === "work" ? st.work : st.brk) * 60;
    const ring = el("div", { class: `focus-ring ${st.phase}` , style: `--p:${(1 - st.left / total) * 100}` },
      el("div", {}, el("b", {}, fmt(st.left)), el("small", {}, st.phase === "work" ? `Round ${st.round} of ${st.rounds}` : "Break")));
    const distract = el("input", { placeholder: "What distracted you? (optional)", "aria-label": "Distraction" });
    view.replaceChildren(
      el("p", { class: "focus-task" }, st.phase === "work" ? `Focusing on: ${st.task}` : "Break — rest your eyes"),
      ring,
      el("div", { class: "row center" },
        st.hard && st.phase === "work" ? null : el("button", { class: "ghost", onclick: () => { st.paused = !st.paused; drawTimer(); } }, st.paused ? "▶ Resume" : "❚❚ Pause"),
        st.hard && st.phase === "work" ? null : el("button", { class: "ghost", onclick: () => { st.left = 1; } }, st.phase === "work" ? "Skip to break" : "Skip break"),
        el("button", { class: "ghost", onclick: tryEnd }, st.hard ? "🔒 End session" : "End session")),
      st.phase === "break" && st.idea ? el("p", { class: "break-idea" }, `${st.idea.icon} ${st.idea.text}`) : null,
      el("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); const n = await api.focus_distraction(distract.value || "distracted");
        distract.value = ""; toast(`Noted (${n}). Back to it — you've got this.`); } },
        distract, el("button", { class: "ghost small" }, "I got distracted")),
      el("p", { class: "note" }, "She stays quiet while you focus. Turn on Settings → “Notice what I'm doing” and she'll also notice games, videos and chats."));
  }

  // ---------------- setup screen ----------------
  async function drawSetup() {
    const s = await api.focus_state();
    const plan = await api.get_planner();
    const tasks = plan.tasks.filter((t) => !t.done).map((t) => t.task);
    const task = el("input", { list: "focusTasks", placeholder: "What will you work on?", "aria-label": "Task" });
    const presets = [["25 / 5 × 4 (Pomodoro)", 25, 5, 4], ["50 / 10 × 2 (deep work)", 50, 10, 2], ["15 / 3 × 3 (quick start)", 15, 3, 3]];
    const preset = el("select", { "aria-label": "Rhythm" }, presets.map(([l], i) => el("option", { value: i }, l)));
    view.replaceChildren(
      el("datalist", { id: "focusTasks" }, tasks.map((t) => el("option", { value: t }))),
      el("form", { class: "jform", onsubmit: (e) => { e.preventDefault(); if (!task.value.trim()) return toast("Type what you'll work on.");
        const [, w, b, r] = presets[Number(preset.value)]; begin(task.value.trim(), w, b, r); } },
        task, preset, el("button", { class: "primary", type: "submit" }, "Start focusing")),
      el("p", { class: "note" }, `This week: ${s.week.sessions} sessions · ${s.week.minutes} focused minutes · ${s.week.distractions} distractions.`),
      await countdownBox(),
      browserBox(),
      await blockBox());
  }

  /** ⏳ deadlines and events, soonest first */
  async function countdownBox() {
    const x = await api.focus_extras();
    if (!x.countdowns.length) return null;
    const when = (d) => (d < 0 ? "yesterday" : d === 0 ? "today!" : d === 1 ? "tomorrow" : `in ${d} days`);
    return el("div", { class: "countdowns" }, el("h5", {}, "⏳ Coming up"),
      ...x.countdowns.map((c) => el("span", { class: `cd ${c.days <= 1 ? "soon" : c.days <= 7 ? "week" : ""}` },
        `${c.kind === "event" ? "📌" : "📝"} ${c.title} · `, el("b", {}, when(c.days)))));
  }

  /** 🌐 her own browser window ("search inside for ..." by voice does the same) */
  function browserBox() {
    const q = el("input", { placeholder: "Search or a link (opens in Vermeil's browser)", "aria-label": "Search inside" });
    return el("form", { class: "row", onsubmit: async (e) => {
      e.preventDefault();
      const r = await api.browse_inside(q.value);
      if (r.error) return toast(r.error);
      q.value = "";
    } }, q, el("button", { class: "ghost small" }, "🌐 Open inside"));
  }

  /** Focus mode: the PC is locked to Vermeil - every other window is minimized while you work */
  async function blockBox() {
    const set = await api.save_settings({});
    const on = el("input", { type: "checkbox", id: "focusBlockOn", checked: set.focus_block !== false });
    const words = el("input", { type: "text", "aria-label": "Apps that may stay open", placeholder: "nothing else (e.g. word, acrobat)" });
    words.value = set.focus_allow_words || "";
    const hard = el("input", { type: "checkbox", id: "focusHard", checked: !!set.focus_hard_lock });
    const sitesOn = el("input", { type: "checkbox", id: "focusSitesOn", checked: set.focus_sites !== false });
    const sites = el("input", { type: "text", "aria-label": "Websites to block", placeholder: "youtube, tiktok, facebook, reddit… (empty = the usual ones)" });
    sites.value = set.focus_sites_list || "";
    const mute = el("input", { type: "checkbox", id: "focusMute", checked: set.focus_mute !== false });
    const save = async () => { await api.save_settings({ focus_block: on.checked, focus_allow_words: words.value, focus_hard_lock: hard.checked,
      focus_sites: sitesOn.checked, focus_sites_list: sites.value, focus_mute: mute.checked }); toast("Saved."); };
    [on, words, hard, sitesOn, sites, mute].forEach((x) => x.addEventListener("change", save));
    return el("details", { class: "focus-block" }, el("summary", {}, "🔒 Lock to Vermeil"),
      el("label", { class: "check", for: "focusBlockOn" }, on, "While I work, lock the PC to Vermeil: every other window (browser, games, chat, other apps) gets minimized"),
      el("small", { class: "note" }, "Also allow (optional, words in the window title, separated by commas):"), words,
      el("small", { class: "note" }, "The taskbar still works. Breaks and the end of the session unlock everything."),
      el("label", { class: "check", for: "focusSitesOn" }, sitesOn, "Block distracting websites (closes the tab's window even in an allowed browser)"), sites,
      el("label", { class: "check", for: "focusMute" }, mute, "Mute all notifications while I work (Windows pop-ups and her reminders wait for the break)"),
      el("label", { class: "check", for: "focusHard" }, hard, "Hard lock: no pause or skip, and stopping early means typing a long sentence"));
  }

  // ---------------- progress ----------------
  function spark(values, { max = null, label, unit = "", color = "var(--blue)" }) {
    const vals = values.map((v) => (v == null ? null : Number(v)));
    const top = max ?? Math.max(1, ...vals.filter((v) => v != null));
    const w = 300, h = 60, n = vals.length;
    const pts = vals.map((v, i) => (v == null ? null : [i * (w / Math.max(1, n - 1)), h - (v / top) * (h - 6) - 3]));
    const bars = pts.map((p, i) => (p ? `<rect x="${p[0] - 3}" y="${p[1]}" width="6" height="${h - p[1]}" rx="2" fill="${color}" opacity="${i === n - 1 ? 1 : .55}"><title>${values[i]}${unit}</title></rect>` : "")).join("");
    const svg = el("div", { class: "spark" });
    svg.innerHTML = `<svg viewBox="-4 0 ${w + 8} ${h}" preserveAspectRatio="none" role="img" aria-label="${label}">${bars}</svg>`;
    return svg;
  }
  async function drawProgress() {
    const p = await api.progress(30);
    const t = p.totals;
    const q = p.quiz.filter((x) => x != null);
    view.replaceChildren(
      el("p", { class: "note" }, "The last 30 days. Each bar is one day."),
      el("div", { class: "prog" }, el("h4", {}, `Quiz scores${q.length ? ` · average ${Math.round(q.reduce((a, b) => a + b, 0) / q.length)}%` : ""}`), spark(p.quiz, { max: 100, label: "Quiz scores", unit: "%" })),
      el("div", { class: "prog" }, el("h4", {}, `Focus · ${t.focus_minutes} minutes`), spark(p.focus, { label: "Focus minutes", unit: " min" })),
      el("div", { class: "prog" }, el("h4", {}, `Gym · ${t.gym_sessions} days`), spark(p.gym, { label: "Gym volume", unit: " kg", color: "#9A7BFF" })),
      el("div", { class: "prog" }, el("h4", {}, `Language · ${t.language_days} days · streak ${t.language_streak}`), spark(p.language, { max: 1, label: "Language practice", color: "#3DDC97" })),
      el("h4", {}, "Topics to work on"),
      p.weak_topics.length ? el("ul", { class: "day-list" }, p.weak_topics.map((w) => el("li", {}, el("span", { class: "what" }, w.topic), el("b", {}, `${w.pct}%`))))
        : el("p", { class: "none" }, "No weak topics yet."));
  }

  async function load() {
    drawTabs();
    if (tab === "progress") return drawProgress();
    const extra = { week: drawWeek, goals: drawGoals, habits: drawHabits, travel: drawTravel, screen: drawScreen }[tab];
    if (extra) return extra(view, api);
    if (st.on) return drawTimer();
    return drawSetup();
  }

  return {
    load,
    startFromVoice: (e) => begin(e.task, e.work, e.brk, e.rounds, true),
    distracted: (e) => toast(`Looks like ${e.what} — want to get back to ${st.task}?`, 6000),
    status: () => (st.on ? { left: st.left, phase: st.phase, round: st.round, rounds: st.rounds, task: st.task, paused: st.paused } : null),
  };
}
