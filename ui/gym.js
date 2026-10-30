// gym.js - Gym mode: today's workout, set logging, rest/hold timer, workout clock, history, body stats.
import { $, el, toast } from "./util.js";
import { sparks as fxSparks, play as fxPlay, alarm, stopAlarm } from "./fx.js";
import { muscleMap, muscleLegend } from "./muscles.js";

const STAT_LABELS = { weight: "Weight (kg)", biceps_r: "Biceps R (cm)", biceps_l: "Biceps L (cm)", thigh_r: "Thigh R (cm)",
  thigh_l: "Thigh L (cm)", chest: "Chest (cm)", waist: "Waist (cm)" };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;
// same rule as gym.py rep_value: "12" -> 12, "30 sec" -> 30, "1min 10 secs" -> 70
const repValue = (reps) => {
  const t = String(reps ?? "").toLowerCase();
  const m = t.match(/(\d+(?:\.\d+)?)\s*m(?:in)?/), s = t.match(/(\d+(?:\.\d+)?)\s*s(?:ec)?/);
  if (m || s) return (m ? m[1] * 60 : 0) + (s ? Number(s[1]) : 0);
  const n = t.match(/\d+(?:\.\d+)?/);
  return n ? Number(n[0]) : null;
};
const holdSeconds = (target) => {           // "30 sec" -> 30, "20-30 secs" -> 30, "10 mins" -> 600
  const nums = (target || "").match(/\d+/g)?.map(Number) || [];
  if (!nums.length) return 60;
  return Math.max(...nums) * (/min/i.test(target) ? 60 : 1);
};

// ---------------- sound ----------------
let audio;
function beep(freq = 880, ms = 150) {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.25, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  } catch { /* no sound available */ }
}

export function initGym(api) {
  let tab = "workout", state = null;
  const root = $("gymBody");

  // ---------------- timer (shared by rest + holds) ----------------
  const timer = { left: 0, total: 0, running: false, label: "", onDone: null, id: null };
  const tDisplay = el("div", { class: "t-time", "aria-live": "off" }, "0:00");
  const tLabel = el("div", { class: "t-label" }, "Rest timer");
  const tBar = el("div", { class: "t-bar" }, el("i"));
  const pauseBtn = el("button", { class: "ghost small", onclick: () => { timer.running ? stop() : timer.left > 0 && tick(true); } }, "Pause");
  const timerBox = el("div", { class: "gym-timer", role: "timer" },
    el("div", {}, tLabel, tDisplay), tBar,
    el("div", { class: "row" },
      ...[60, 90, 120, 180].map((s) => el("button", { class: "ghost small", onclick: () => startTimer(s, "Rest") }, mmss(s))),
      el("button", { class: "ghost small", "aria-label": "15 seconds less", onclick: () => adjust(-15) }, "−15"),
      el("button", { class: "ghost small", "aria-label": "15 seconds more", onclick: () => adjust(15) }, "+15"),
      pauseBtn,
      el("button", { class: "ghost small", onclick: () => finishTimer(true) }, "Skip")));

  function draw() {
    tDisplay.textContent = mmss(Math.ceil(timer.left));
    tLabel.textContent = timer.label || "Rest timer";
    tBar.firstChild.style.width = timer.total ? `${100 * (1 - timer.left / timer.total)}%` : "0";
    timerBox.classList.toggle("on", timer.running);
    timerBox.classList.toggle("ending", timer.running && timer.left <= 5);
    pauseBtn.textContent = timer.running ? "Pause" : "Resume";
    $("gymSub").textContent = timer.running ? `${timer.label}: ${mmss(Math.ceil(timer.left))}` : "Workout & timer";
  }
  function tick(resume) {
    if (resume) timer.running = true;
    clearInterval(timer.id);
    let last = performance.now();
    timer.id = setInterval(() => {
      const now = performance.now();
      const before = Math.ceil(timer.left);
      timer.left -= (now - last) / 1000; last = now;
      const after = Math.ceil(timer.left);
      if (after !== before && after <= 3 && after > 0) beep(660, 120);
      if (timer.left <= 0) return finishTimer(false);
      draw();
    }, 200);
    draw();
  }
  function stop() { timer.running = false; clearInterval(timer.id); draw(); }
  function startTimer(seconds, label, onDone = null) {
    stopAlarm();
    Object.assign(timer, { left: seconds, total: seconds, running: true, label, onDone });
    tick();
  }
  function adjust(d) { timer.left = Math.max(1, timer.left + d); timer.total = Math.max(timer.total, timer.left); draw(); }
  function finishTimer(skipped) {
    clearInterval(timer.id);
    const done = timer.onDone;
    Object.assign(timer, { left: 0, running: false, onDone: null });
    draw();
    if (!skipped) { alarm(); toast(`⏰ ${timer.label} done — next set! (tap anywhere to stop the alarm)`, 5000); }
    done?.(skipped);
  }

  // ---------------- workout clock ----------------
  let started = null, clockId = null;
  const clock = el("span", { class: "gym-clock" }, "");
  const startBtn = el("button", { class: "primary small", onclick: () => started ? finishWorkout() : startWorkout() }, "Start workout");
  const gymRoom = (on) => window.dispatchEvent(new CustomEvent("gym-session", { detail: { on, startedAt: started } }));
  function startWorkout() {
    started = Date.now();
    try { localStorage.setItem("gymStarted", String(started)); } catch { /* ignore */ }
    runClock();
    gymRoom(true);
  }
  function runClock() {
    startBtn.textContent = "Finish workout";
    clearInterval(clockId);
    clockId = setInterval(() => { clock.textContent = `⏱ ${mmss((Date.now() - started) / 1000)}`; }, 1000);
  }
  async function finishWorkout() {
    const minutes = started ? (Date.now() - started) / 60000 : 0;
    const r = await api.gym_finish(minutes, "");
    clearInterval(clockId); started = null; clock.textContent = "";
    try { localStorage.removeItem("gymStarted"); } catch { /* ignore */ }
    startBtn.textContent = "Start workout";
    gymRoom(false);
    clearInterval(timer.id); Object.assign(timer, { left: 0, total: 0, running: false, onDone: null, label: "" }); draw();
    toast(r.message, 6000);
    if (r.saved) { state = null; load(); }          // the next session starts empty (and may be the next day)
  }
  try { const s = Number(localStorage.getItem("gymStarted")); if (s && Date.now() - s < 5 * 3600e3) { started = s; runClock(); setTimeout(() => gymRoom(true), 0); } } catch { /* ignore */ }

  // ---------------- layout ----------------
  const tabs = el("div", { class: "tabs", role: "tablist" });
  const view = el("div");
  root.replaceChildren(timerBox, tabs, view);
  function drawTabs() {
    tabs.replaceChildren(...[["workout", "Workout"], ["alts", "Alternatives"], ["history", "History"], ["progress", "Progress"], ["stats", "Body stats"], ["calories", "Calories"]].map(([k, l]) =>
      el("button", { role: "tab", "aria-selected": String(k === tab), onclick: () => { tab = k; load(); } }, l)));
  }

  async function load(day) {
    drawTabs();
    if (tab === "edit") return drawEditor();
    if (tab === "alts") return drawAlternatives();
    if (tab === "history") return drawHistory();
    if (tab === "stats") return drawStats();
    if (tab === "calories") return drawCalories();
    if (tab === "progress") return drawProgress();
    state = await api.gym_state(day || state?.day || null);
    drawWorkout();
  }

  function drawWorkout() {
    if (!state.days.length) {
      view.replaceChildren(el("p", {}, "No routine yet. Import your workout Excel file (like HYBRID.xlsx)."),
        el("button", { class: "primary", onclick: importFile }, "Import Excel routine…"));
      return;
    }
    const pick = el("select", { "aria-label": "Workout day", onchange: () => load(Number(pick.value)) },
      state.days.map((d) => el("option", { value: d.day, selected: d.day === state.day }, `Day ${d.day}: ${d.title}`)));
    const done = new Map(state.today.sets.map((s) => [`${s.exercise}#${s.set}`, s]));
    const plan = state.plan;
    const total = plan.exercises.reduce((n, e) => n + e.sets, 0);
    const doneCount = plan.exercises.reduce((n, e) => n + [...Array(e.sets)].filter((_, i) => done.has(`${e.name}#${i + 1}`)).length, 0);
    view.replaceChildren(
      el("div", { class: "row gym-head" }, pick, startBtn, clock,
        el("span", { class: "streak" }, state.streak ? `🔥 ${state.streak}-day streak` : ""),
        restartBtn(),
        el("button", { class: "ghost small", onclick: () => openEditor(state.day) }, "✎ Edit routine"),
        el("button", { class: "ghost small", onclick: importFile }, "Re-import Excel")),
      el("progress", { class: "gym-progress", max: total || 1, value: doneCount, "aria-label": "Sets done" }),
      el("p", { class: "note" }, `${doneCount} of ${total} sets done. Tick ✓ after each set — the rest timer starts by itself.`),
      ...plan.exercises.map((ex) => exerciseCard(ex, done)));
  }

  function exerciseCard(ex, done) {
    const lastKg = ex.last?.sets?.length ? Math.max(...ex.last.sets.map((s) => s.kg || 0)) || "" : "";
    const kgInputs = [];
    const rows = [...Array(ex.sets)].map((_, i) => {
      const n = i + 1, key = `${ex.name}#${n}`, logged = done.get(key);
      const prev = ex.last?.sets?.find((s) => s.set === n);
      // planned weight from the routine (raised by "+2.5 kg"), or last session's if that was heavier
      const startKg = Math.max(Number(ex.kg) || 0, Number(prev?.kg) || 0, prev ? 0 : Number(lastKg) || 0) || "";
      const kg = el("input", { type: "number", step: "0.25", min: 0, inputmode: "decimal", "aria-label": `Set ${n} kg`,
        value: logged?.kg ?? startKg, placeholder: ex.kg_text || "kg", disabled: ex.timed });
      kgInputs.push({ input: kg, logged: !!logged });
      const reps = el("input", { "aria-label": `Set ${n} ${ex.timed ? "time" : "reps"}`, value: logged?.reps ?? "",
        placeholder: prev?.reps ? `last ${prev.reps}` : ex.target || "reps", inputmode: ex.timed ? "text" : "numeric" });
      const check = el("button", { class: `tick${logged ? " on" : ""}`, "aria-label": logged ? `Undo set ${n}` : `Done set ${n}`,
        "aria-pressed": String(!!logged), onclick: async () => {
          if (logged) { await api.gym_unlog_set(ex.name, n); return load(); }
          await api.gym_log_set(ex.name, n, kg.value || null, reps.value || (ex.timed ? ex.target : ""), state.day);
          if (!started) startWorkout();
          if (ex.rest) startTimer(ex.rest, `Rest after ${ex.name}`);
          load();
        } }, "✓");
      // personal best for this set number (from earlier sessions) - left of the ✓
      const pb = ex.best?.[String(n)];
      const bestBox = el("div", { class: "best", title: pb ? `Your best on set ${n}: ${pb.reps}${pb.kg ? ` at ${pb.kg} kg` : ""} (${pb.date})` : "No record yet for this set" },
        el("small", {}, "Best"), el("b", {}, pb ? String(pb.reps) : "—"), pb?.kg ? el("small", {}, `${pb.kg} kg`) : null);
      const markBest = () => {
        const has = reps.value.trim() !== "" || !!logged;
        const v = repValue(reps.value || logged?.reps);
        const beat = has && v != null && (!pb || v > pb.value || (v === pb.value && Number(kg.value) > (pb.kg || 0)));
        bestBox.classList.toggle("beat", beat);
        const [label, num] = bestBox.children;
        let kgLine = bestBox.children[2];
        label.textContent = beat ? (logged ? "New best!" : "Beat it!") : "Best";
        const showKg = beat && logged ? logged.kg : pb?.kg;          // after ✓ show the NEW record, not the old one
        num.textContent = beat && logged ? String(logged.reps) : pb ? String(pb.reps) : "—";
        if (showKg) { if (!kgLine) { kgLine = el("small", {}); bestBox.append(kgLine); } kgLine.textContent = `${showKg} kg`; }
        else kgLine?.remove();
      };
      reps.addEventListener("input", markBest);
      kg.addEventListener("input", markBest);
      markBest();
      const row = el("div", { class: `set-row${logged ? " done" : ""}` }, el("span", { class: "set-n" }, `Set ${n}`), kg, reps, bestBox, check);
      if (ex.timed) {
        row.insertBefore(el("button", { class: "ghost small", onclick: () => startTimer(holdSeconds(ex.target), `${ex.name} — set ${n}`,
          (skipped) => { if (!skipped) { reps.value = ex.target; check.click(); } }) }, "▶ Start"), bestBox);
      }
      return row;
    });
    return el("article", { class: "ex-card with-map" }, musclePanel(ex.name), el("div", { class: "ex-main" },
      el("div", { class: "row" }, el("strong", {}, ex.name),
        el("span", { class: "pill" }, `${ex.sets} × ${ex.target || "—"}${ex.rest ? ` · rest ${mmss(ex.rest)}` : ""}`),
        !ex.timed ? el("button", { class: "ghost small upgrade", title: "Add 2.5 kg to the sets you haven't done and save it for next time",
          onclick: async (e) => {
            const open = kgInputs.filter((k) => !k.logged);
            const current = Math.max(0, ...open.map((k) => Number(k.input.value) || 0), Number(ex.kg) || 0);
            const next = current + 2.5;
            for (const k of open) k.input.value = next;
            const r = await api.gym_upgrade_weight(ex.name, next);
            if (r.error) return toast(r.error);
            ex.kg = r.kg;
            toast(r.message);
            fxPlay("success");
            const b = e.target.getBoundingClientRect();
            fxSparks?.(b.left + b.width / 2, b.top + b.height / 2);
          } }, "⬆ +2.5 kg") : null,
        ex.link ? el("button", { class: "ghost small", onclick: () => api.open_url(ex.link) }, "▶ How to") : null,
        el("button", { class: "ghost small", title: "Find exercises that can replace this one", onclick: () => openAlternatives(ex.name, state.day) }, "⇄ Alternatives")),
      ex.notes ? el("p", { class: "note" }, ex.notes) : null,
      ex.tip ? el("p", { class: "tip-line" }, `💡 ${ex.tip}`) : null,
      ...rows));
  }

  // ---------------- muscle maps (left of every exercise) ----------------
  const muscleCache = new Map();
  function musclePanel(name, known) {
    const box = el("div", { class: "ex-muscles" });
    const draw = (ms) => box.replaceChildren(muscleMap(ms, { title: name }), muscleLegend(ms));
    if (known?.length) { draw(known); return box; }
    if (muscleCache.has(name)) { draw(muscleCache.get(name)); return box; }
    draw([]);
    api.gym_muscles([name]).then((r) => { const ms = (r && r[name]) || []; muscleCache.set(name, ms); draw(ms); }).catch(() => {});
    return box;
  }

  // ---------------- restart today's training ----------------
  function restartBtn() {
    let armed = false, t;
    const b = el("button", { class: "ghost small", title: "Clears the ticks of this session only - finished sessions stay in History" }, "↺ Restart training");
    b.addEventListener("click", async () => {
      if (!armed) { armed = true; b.textContent = "Tap again to clear this session"; b.classList.add("warn-btn"); t = setTimeout(() => { armed = false; b.textContent = "↺ Restart training"; b.classList.remove("warn-btn"); }, 3000); return; }
      clearTimeout(t);
      const r = await api.gym_reset_day();
      resetLocal();
      toast(r.message);
      load();
    });
    return b;
  }
  function resetLocal() {
    clearInterval(timer.id); Object.assign(timer, { left: 0, total: 0, running: false, onDone: null, label: "" }); draw();
    clearInterval(clockId); started = null; clock.textContent = ""; startBtn.textContent = "Start workout";
    try { localStorage.removeItem("gymStarted"); } catch { /* ignore */ }
  }

  // ---------------- routine editor ----------------
  let draft = null, editDay = 0;
  async function openEditor(dayNum) {
    draft = structuredClone(await api.gym_routine());
    editDay = Math.max(0, draft.days.findIndex((d) => d.day === dayNum));
    tab = "edit"; drawTabs(); drawEditor();
  }
  function drawEditor() {
    if (!draft.days.length) draft.days.push({ title: "Day 1", exercises: [] });
    const day = draft.days[editDay];
    const dayTabs = el("div", { class: "row day-chips" }, draft.days.map((d, i) =>
      el("button", { class: `chip${i === editDay ? " on" : ""}`, onclick: () => { editDay = i; drawEditor(); } }, `${i + 1}. ${d.title || "Untitled"}`)),
      el("button", { class: "chip", onclick: () => { draft.days.push({ title: "New day", exercises: [] }); editDay = draft.days.length - 1; drawEditor(); } }, "+ Day"));
    const title = el("input", { value: day.title, "aria-label": "Day name", oninput: () => { day.title = title.value; } });
    const field = (ex, key, attrs) => {
      const input = el("input", { ...attrs, value: ex[key] ?? "", oninput: () => { ex[key] = attrs.type === "number" ? (input.value === "" ? null : Number(input.value)) : input.value; } });
      return el("label", { class: `f-${key}` }, attrs["data-label"], input);
    };
    const move = (i, d) => { const a = day.exercises; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; drawEditor(); };
    const rows = day.exercises.map((ex, i) => el("div", { class: "ex-edit" },
      el("div", { class: "row" },
        field(ex, "name", { "data-label": "Exercise", placeholder: "e.g. Incline Bench" }),
        el("button", { class: "icon-btn", "aria-label": "Move up", onclick: () => move(i, -1) }, "↑"),
        el("button", { class: "icon-btn", "aria-label": "Move down", onclick: () => move(i, 1) }, "↓"),
        el("button", { class: "x", "aria-label": `Delete ${ex.name}`, onclick: () => { day.exercises.splice(i, 1); drawEditor(); } }, "×")),
      el("div", { class: "edit-grid" },
        field(ex, "sets", { "data-label": "Sets", type: "number", min: 1, max: 20 }),
        field(ex, "target", { "data-label": "Reps / time", placeholder: "8-12 or 30 sec" }),
        field(ex, "kg", { "data-label": "Weight (kg)", type: "number", step: "0.25", min: 0 }),
        field(ex, "rest", { "data-label": "Rest (seconds)", type: "number", min: 0, max: 900, step: 5 }),
        el("label", { class: "check" }, el("input", { type: "checkbox", checked: !!ex.timed, onchange: (e) => { ex.timed = e.target.checked; } }), "Timed (hold/plank)")),
      field(ex, "notes", { "data-label": "Notes", placeholder: "e.g. controlled negatives" }),
      field(ex, "link", { "data-label": "Video link", placeholder: "https://…" })));
    const restAll = el("input", { type: "number", min: 0, max: 900, step: 5, value: 90, "aria-label": "Rest seconds for all" });
    view.replaceChildren(
      el("p", { class: "note" }, "Change anything: exercises, sets, reps, weight, rest time. Changes are saved when you press Save."),
      dayTabs,
      el("div", { class: "row edit-day" }, el("label", {}, "Day name ", title),
        el("button", { class: "ghost small", onclick: () => { if (draft.days.length > 1) { draft.days.splice(editDay, 1); editDay = 0; drawEditor(); } else toast("Keep at least one day."); } }, "Delete this day")),
      el("div", { class: "row" }, el("span", {}, "Set every rest time on this day to "), restAll, el("span", {}, "seconds"),
        el("button", { class: "ghost small", onclick: () => { day.exercises.forEach((ex) => { ex.rest = Number(restAll.value) || 0; }); drawEditor(); } }, "Apply")),
      ...rows,
      el("button", { class: "ghost", onclick: () => { day.exercises.push({ name: "", sets: 3, target: "8-12", kg: null, rest: 90, notes: "", link: "", timed: false }); drawEditor(); } }, "+ Add exercise"),
      el("div", { class: "row save-bar" },
        el("button", { class: "primary", onclick: async () => {
          const r = await api.gym_save_routine(draft);
          toast(r.error || r.message);
          if (!r.error) { tab = "workout"; load(editDay + 1); }
        } }, "Save routine"),
        el("button", { class: "ghost", onclick: () => { tab = "workout"; load(); } }, "Cancel")));
  }

  // ---------------- exercise alternatives ----------------
  let altQuery = "", altSwap = null;          // altSwap = {name, day}: opened from a routine card, so "Use instead" can swap it
  function openAlternatives(name, day) {
    altQuery = name; altSwap = { name, day };
    tab = "alts"; drawTabs(); drawAlternatives();
  }
  const starRow = (n) => el("span", { class: "stars", title: `${n} of 5 stars`, "aria-label": `${n} of 5 stars` }, "★".repeat(n) + "☆".repeat(5 - n));
  async function drawAlternatives() {
    const input = el("input", { type: "search", value: altQuery, placeholder: "Exercise (bench press, RDL…) or muscle (chest, lats…)", "aria-label": "Search exercise" });
    const results = el("div", { class: "alt-results" });
    const form = el("form", { class: "row alt-search", onsubmit: (e) => { e.preventDefault(); altQuery = input.value.trim(); if (altSwap && altQuery !== altSwap.name) altSwap = null; search(); } },
      input, el("button", { class: "primary small", type: "submit" }, "Search"));
    view.replaceChildren(
      el("p", { class: "note" }, "Find exercises that train the same muscles. ★★★★★ = the best swap · ☆☆☆☆☆ = the weakest alternative. The body map shows the muscles: green = most worked, then yellow, light green, blue."),
      form, results);
    const card = (a, main = false) => el("article", { class: `ex-card alt-card with-map${main ? " main" : ""}` }, musclePanel(a.name),
      el("div", { class: "ex-main" },
        el("div", { class: "row" }, el("strong", {}, a.name), starRow(a.stars), a.source === "ai" ? el("span", { class: "pill" }, "AI suggestion") : null,
          altSwap && !main ? el("button", { class: "ghost small", title: `Replace ${altSwap.name} in your routine (sets, reps and rest stay)`, onclick: () => swapInto(a.name) }, "Use instead") : null),
        el("p", { class: "note" }, `${a.equipment ? `🏋 ${a.equipment} · ` : ""}${a.why || ""}`)));
    let people = {};
    async function search() {
      if (!altQuery) { results.replaceChildren(el("p", { class: "none" }, "Type an exercise or a muscle, or press ⇄ Alternatives on an exercise in your workout.")); return; }
      results.replaceChildren(el("p", { class: "note" }, "Searching…"));
      const r = await api.gym_alternatives(altQuery);
      if (r.error) { results.replaceChildren(el("p", { class: "none" }, r.error)); return; }
      people = r.people || {};
      results.replaceChildren(
        el("h3", {}, r.title),
        r.match ? el("div", {}, el("small", { class: "note" }, "You searched:"), card(r.match, true), el("small", { class: "note" }, "Swap it for one of these (best first):")) : null,
        ...(r.alternatives.length ? r.alternatives.map((a) => card(a)) :
          [el("p", { class: "none" }, `Nothing found.${r.suggest?.length ? ` Did you mean: ${r.suggest.join(", ")}?` : ""}`)]));
    }
    search();
  }
  async function swapInto(newName) {
    const routine = structuredClone(await api.gym_routine());
    const d = routine.days.find((x) => x.day === altSwap.day) || routine.days[Math.max(0, (altSwap.day || 1) - 1)];
    const ex = d?.exercises.find((x) => x.name === altSwap.name);
    if (!ex) return toast(`Couldn't find ${altSwap.name} in your routine.`);
    ex.name = newName; ex.kg = null; ex.link = "";
    const r = await api.gym_save_routine(routine);
    if (r.error) return toast(r.error);
    toast(`Swapped ${altSwap.name} → ${newName}. Sets, reps and rest stayed the same; set a new weight on your first set.`, 6000);
    fxPlay("success");
    altSwap = null; tab = "workout"; load(d.day);
  }

  async function importFile() {
    const r = await api.gym_import();
    toast(r.error || r.message);
    if (!r.error) load();
  }

  async function drawHistory() {
    const h = await api.gym_history();
    view.replaceChildren(h.length ? el("ul", { class: "journal" }, h.map((w) => el("li", { class: "jentry" },
      el("div", { class: "row" }, el("strong", {}, `${w.date} · ${w.title || `Day ${w.day}`}${w.sessions_that_day > 1 ? ` · session ${w.session}` : ""}${w.current ? " (now)" : ""}`),
        el("small", {}, `${w.exercises} exercises · ${w.sets} sets · ${w.volume} kg volume${w.minutes ? ` · ${w.minutes} min` : ""}`)),
      el("details", {}, el("summary", {}, "Sets"), el("ul", {}, w.detail.map((s) =>
        el("li", {}, `${s.exercise} — set ${s.set}: ${s.kg ?? "-"} kg × ${s.reps || "-"}`)))))))
      : el("p", { class: "none" }, "No workouts logged yet. Tick a set in the Workout tab to start."));
    if (h.length) view.append(el("div", { class: "row history-tools" },
      el("button", { class: "danger small", onclick: async () => {
        if (!confirm(`Clear all ${h.length} workouts from History?\n\nYour routine, weights and body stats stay. You can undo right after.`)) return;
        const r = await api.gym_clear_history();
        await drawHistory();
        view.append(el("div", { class: "row undo-bar" }, el("span", {}, `Cleared ${r.cleared} day${r.cleared === 1 ? "" : "s"}.`),
          el("button", { class: "small", onclick: async () => { const u = await api.gym_undo_clear(); toast(`Brought back ${u.restored} day${u.restored === 1 ? "" : "s"}.`); drawHistory(); } }, "Undo")));
      } }, "🗑 Clear history")));
  }

  async function drawStats() {
    const { stats, fields } = await api.gym_stats();
    const form = el("form", { class: "jform stats-form" }, fields.map((f) =>
      el("label", {}, STAT_LABELS[f] || f, el("input", { name: f, type: "number", step: "0.1", inputmode: "decimal" }))),
      el("button", { class: "primary", type: "submit" }, "Save today's numbers"));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await api.gym_add_stats(Object.fromEntries(new FormData(form)));
      toast(r.error || "Saved."); if (!r.error) drawStats();
    });
    const table = el("table", { class: "stats" },
      el("thead", {}, el("tr", {}, el("th", {}, "Date"), fields.map((f) => el("th", {}, STAT_LABELS[f].split(" (")[0])))),
      el("tbody", {}, stats.slice().reverse().map((s) => el("tr", {}, el("td", {}, s.date), fields.map((f) => el("td", {}, s[f] ?? "–"))))));
    view.replaceChildren(el("div", { class: "table-wrap" }, table), el("h3", {}, "Add measurements"), form);
  }

  // ---------------- calories: BMI, maintenance, deficit / bulk and how fast the weight changes ----------------
  async function drawCalories() {
    const saved = await api.gym_body();
    const p = saved.profile || {};
    const field = (name, label, attrs) => el("label", {}, label, el("input", { name, value: p[name] ?? "", inputmode: "decimal", ...attrs }));
    const gender = el("select", { name: "gender" }, ["male", "female"].map((g) => el("option", { value: g, selected: p.gender === g }, g[0].toUpperCase() + g.slice(1))));
    const act = el("select", { name: "activity" }, (saved.activity || []).map(([k, label]) => el("option", { value: k, selected: (p.activity || "moderate") === k }, label)));
    const form = el("form", { class: "jform cal-form" },
      field("height", "Height (cm)", { type: "number", step: "0.5", min: 80, max: 250, required: true }),
      field("weight", "Weight (kg)", { type: "number", step: "0.1", min: 25, max: 300, required: true }),
      field("age", "Age", { type: "number", step: "1", min: 10, max: 100, required: true }),
      el("label", {}, "Gender", gender),
      el("label", { class: "wide" }, "How much you train each week", act),
      el("button", { class: "primary", type: "submit" }, "Work it out"));
    const out = el("div", { class: "cal-out" });
    const show = (r) => {
      if (r.error) return out.replaceChildren(el("p", { class: "note" }, r.error));
      const pos = Math.max(0, Math.min(100, ((r.bmi - 15) / 20) * 100));
      const sign = (v) => (v > 0 ? "+" : "") + v;
      out.replaceChildren(
        el("div", { class: "cal-top" },
          el("div", { class: "cal-big" }, el("small", {}, "BMI"), el("b", {}, String(r.bmi)), el("span", {}, r.category)),
          el("div", { class: "cal-big" }, el("small", {}, "Maintenance"), el("b", {}, String(r.maintenance)), el("span", {}, "kcal a day")),
          el("div", { class: "cal-big" }, el("small", {}, "Resting (BMR)"), el("b", {}, String(r.bmr)), el("span", {}, "kcal a day"))),
        el("div", { class: "bmi-bar", title: "BMI 15 to 35" }, el("i", { style: `left:${pos}%` })),
        el("p", { class: "note" }, `Healthy weight for your height: ${r.healthy_weight[0]}–${r.healthy_weight[1]} kg. Protein: ${r.protein_g[0]}–${r.protein_g[1]} g a day.`),
        el("div", { class: "cal-plans" }, r.plans.map((x, i) => el("div", { class: `cal-plan ${x.key}`, style: `animation-delay:${i * 60}ms` },
          el("strong", {}, x.label),
          el("b", {}, `${x.kcal} kcal`),
          el("span", {}, x.kg_week === 0 ? "weight stays the same" : `${sign(x.kg_week)} kg a week · ${sign(x.kg_month)} kg a month`),
          el("small", {}, `in 3 months: about ${x.weight_in_3_months} kg`)))),
        el("p", { class: "note" }, "Estimates (Mifflin-St Jeor). Real change varies: weigh yourself weekly and adjust by 100–200 kcal if it's off."));
    };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await api.gym_body(Object.fromEntries(new FormData(form)));
      show(r);
      if (!r.error) { toast("Saved. Your weight went into Body stats too."); drawMeals(); }
    });
    view.replaceChildren(restBox, logBox, form, out, mealBox);
    if (saved.bmi) show(saved);
    drawMeals();
    drawRest();
    drawLog();
  }

  // ---------------- rest-day + sleep tips (from your history and the sleep you log) ----------------
  const restBox = el("div", { class: "rest-box" });
  async function drawRest() {
    const r = await api.gym_advice();
    const hours = el("input", { type: "number", step: "0.5", min: 0, max: 16, placeholder: "e.g. 7.5", "aria-label": "Hours slept last night", value: r.last_sleep ?? "" });
    restBox.className = `rest-box ${r.rest ? "rest" : "go"}`;
    restBox.replaceChildren(
      el("h3", {}, r.rest ? "😴 " + r.title : "💪 " + r.title),
      el("ul", {}, r.tips.map((t) => el("li", {}, t))),
      el("form", { class: "row sleep-row", onsubmit: async (e) => { e.preventDefault(); const x = await api.gym_sleep(hours.value);
        if (x.error) return toast(x.error); toast("Sleep saved."); drawRest(); } },
        el("label", {}, "I slept ", hours, " hours last night"), el("button", { class: "ghost small", type: "submit" }, "Save")));
  }

  // ---------------- meal log: snap your plate -> calories and protein ----------------
  const logBox = el("div", { class: "meal-log" });
  async function drawLog(d) {
    d = d || await api.gym_meal_today();
    const pic = el("input", { type: "file", accept: "image/*", capture: "environment", hidden: true });
    const result = el("div");
    const addForm = (m = {}) => {
      const f = (k, label, attrs = {}) => el("label", {}, label, el("input", { name: k, value: m[k] ?? "", ...attrs }));
      const form = el("form", { class: "jform meal-add" },
        f("name", "Meal", { required: true, placeholder: "e.g. chicken adobo + rice" }),
        f("kcal", "kcal", { type: "number", min: 0 }), f("protein", "Protein g", { type: "number", min: 0 }),
        f("carbs", "Carbs g", { type: "number", min: 0 }), f("fat", "Fat g", { type: "number", min: 0 }),
        el("button", { class: "primary", type: "submit" }, "Add to today"));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const x = await api.gym_meal_add({ ...Object.fromEntries(new FormData(form)), photo: !!m.photo });
        if (x.error) return toast(x.error);
        drawLog(x);
      });
      return form;
    };
    pic.addEventListener("change", async () => {
      const file = pic.files[0];
      if (!file) return;
      result.replaceChildren(el("p", { class: "note" }, "Looking at your plate… (~5 s)"));
      const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); });
      const m = await api.gym_meal_photo(b64, file.type);
      if (m.error) { result.replaceChildren(); return toast(m.error, 6000); }
      result.replaceChildren(el("p", { class: "note" }, `${m.note} Fix anything that looks off, then add it.`), addForm({ ...m, photo: true }));
    });
    const t = d.total;
    logBox.replaceChildren(
      el("h3", {}, "📷 Today's meals"),
      el("div", { class: "row" },
        el("button", { class: "primary", onclick: () => pic.click() }, "📷 Snap or pick a meal photo"),
        el("button", { class: "ghost", onclick: () => result.replaceChildren(addForm()) }, "Type it in"), pic),
      result,
      d.meals.length ? el("ul", { class: "day-list" }, d.meals.map((m) => el("li", {},
        el("span", { class: "what" }, (m.photo ? "📷 " : "") + m.name), el("small", {}, `${m.kcal} kcal · ${m.protein} g protein`),
        el("button", { class: "x", "aria-label": `Remove ${m.name}`, onclick: async () => drawLog(await api.gym_meal_remove(m.id)) }, "×"))))
        : el("p", { class: "none" }, "Nothing logged today."),
      el("p", { class: "note" }, `Today: ${t.kcal} kcal · ${t.protein} g protein · ${t.carbs} g carbs · ${t.fat} g fat. Photo numbers are estimates (±20%).`));
  }

  // ---------------- meal planner: a day of meals for bulk / cut / recomp from the numbers above ----------------
  let mealGoal = "recomp", mealCount = 4, mealDishes = [];
  try { mealCount = +localStorage.getItem("mealCount") || 4; } catch {}
  const mealBox = el("div", { class: "meal-box" });
  async function drawMeals() {
    const r = await api.gym_meals(mealGoal, mealCount, mealDishes);
    if (r.error) return mealBox.replaceChildren(el("h3", {}, "🍽 Meal planner"), el("p", { class: "note" }, r.error));
    mealDishes = r.meals.map((m) => m.pick);
    const goals = el("div", { class: "seg" }, r.goals.map(([k, l]) => el("button", { type: "button", class: k === mealGoal ? "on" : "",
      onclick: () => { mealGoal = k; drawMeals(); } }, l)));
    const count = el("div", { class: "seg meal-count", title: "How many meals a day" }, el("span", {}, "Meals a day"),
      (r.meal_options || [2, 3, 4, 5, 6]).map((n) => el("button", { type: "button", class: n === r.meal_count ? "on" : "",
        onclick: () => { mealCount = n; mealDishes = []; try { localStorage.setItem("mealCount", n); } catch {} drawMeals(); } }, String(n))));
    const macro = (label, v, unit, cls) => el("div", { class: `cal-big ${cls}` }, el("small", {}, label), el("b", {}, String(v)), el("span", {}, unit));
    mealBox.replaceChildren(
      el("h3", {}, "🍽 Meal planner"), goals, count,
      el("p", { class: "note" }, r.note),
      el("div", { class: "cal-top macros" }, macro("Calories", r.kcal, "kcal a day", ""), macro("Protein", r.protein, "g a day", "p"),
        macro("Fats", r.fat, "g a day", "f"), macro("Carbs", r.carbs, "g a day", "c")),
      el("div", { class: "meal-grid" }, r.meals.map((m, i) => el("div", { class: "meal", style: `animation-delay:${i * 70}ms` },
        el("div", { class: "lift-head" }, el("strong", {}, m.name), el("span", {}, `${m.kcal} kcal`)),
        el("div", { class: "dish" }, el("b", {}, m.dish),
          el("button", { type: "button", class: "dish-swap", title: "Show another dish for this meal",
            onclick: () => { mealDishes[i] = (m.pick + 1) % m.choices; drawMeals(); } }, "🔀 Other dish")),
        el("p", { class: "how" }, m.how),
        el("ul", {}, m.items.map((x) => el("li", {}, el("span", {}, x.food), el("b", {}, `${x.grams} g`)))),
        el("small", {}, `Protein ${m.protein} g · Fats ${m.fat} g · Carbs ${m.carbs} g`)))),
      el("p", { class: "note" }, `Whole day: ${r.totals.kcal} kcal · protein ${r.totals.protein} g · fats ${r.totals.fat} g · carbs ${r.totals.carbs} g. `
        + "Estimates from typical food values (cooked weights). Swap foods for ones with similar numbers."));
  }

  // ---------------- progress: weight and reps per lift (monthly), then your Body stats ----------------
  function niceLabel(r) {
    const m = r.month || r.label || "";
    if (/^\d{4}-\d\d-\d\d/.test(m)) return new Date(`${m.slice(0, 10)}T00:00`).toLocaleString(undefined, { month: "short", day: "numeric" });
    if (/^\d{4}-\d\d$/.test(m)) return new Date(`${m}-01T00:00`).toLocaleString(undefined, { month: "short" }) + (m.endsWith("-01") ? ` ${m.slice(2, 4)}` : "");
    return m;                                                 // "Week 1" and other labels from your Excel stay as they are
  }
  function lineChart(rows, key, unit = "") {
    rows = rows.filter((r) => r[key] != null && r[key] !== "");
    if (!rows.length) return "";
    const W = 320, H = 130, P = 26;
    const vals = rows.map((r) => Number(r[key]) || 0);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || Math.max(1, hi * 0.1);
    const x = (i) => P + (rows.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (rows.length - 1));
    const y = (v) => H - P + 6 - ((v - lo + span * 0.1) / (span * 1.2)) * (H - P - 10);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const area = `${x(0)},${H - P + 6} ${pts} ${x(vals.length - 1)},${H - P + 6}`;
    return `<svg viewBox="0 0 ${W} ${H}" class="lift-chart" role="img" aria-label="${key}">
      <polygon points="${area}" class="area"/><polyline points="${pts}" class="line" pathLength="1"/>
      ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" class="dot" style="animation-delay:${300 + i * 60}ms"><title>${niceLabel(rows[i])}: ${v}${unit}</title></circle>
        <text x="${x(i)}" y="${y(v) - 8}" class="val">${v}</text>
        <text x="${x(i)}" y="${H - 4}" class="mon">${niceLabel(rows[i])}</text>`).join("")}
    </svg>`;
  }
  function change(rows, key) {
    rows = rows.filter((r) => r[key]);
    if (rows.length < 2) return null;
    const d = Math.round((rows.at(-1)[key] - rows[0][key]) * 10) / 10;
    return el("span", { class: d >= 0 ? "up" : "down" }, `${d >= 0 ? "▲ +" : "▼ "}${d}`);
  }
  function chartCard(title, rows, key, unit, i, cls = "") {
    const c = el("div", { class: `lift-card ${cls}`, style: `animation-delay:${Math.min(i, 10) * 50}ms` },
      el("div", { class: "lift-head" }, el("strong", {}, title), change(rows, key)));
    c.insertAdjacentHTML("beforeend", lineChart(rows, key, unit));
    return c;
  }
  async function drawProgress() {
    const { exercises, stats = [], stat_fields = [] } = await api.gym_monthly();
    const names = Object.keys(exercises);
    const cards = names.map((n, i) => {
      const rows = exercises[n];
      const c = el("div", { class: "lift-card two", style: `animation-delay:${Math.min(i, 10) * 50}ms` },
        el("div", { class: "lift-head" }, el("strong", {}, n)));
      const part = (label, key, unit) => {
        const box = el("div", { class: "mini" }, el("small", {}, label, " ", change(rows, key)));
        box.insertAdjacentHTML("beforeend", lineChart(rows, key, unit));
        return box;
      };
      c.append(part("Weight (kg)", "best", " kg"), part("Reps", "reps", " reps"));
      return c;
    });
    const statCards = stat_fields.filter((f) => stats.some((s) => s[f] != null))
      .map((f, i) => chartCard(STAT_LABELS[f] || f, stats, f, f === "weight" ? " kg" : " cm", i, "body"));
    view.replaceChildren(
      el("h3", {}, "🏋️ Lifts: weight and reps"),
      names.length ? el("div", { class: "lift-grid" }, cards)
        : el("p", { class: "none" }, "No lifts logged yet. Tick sets in the Workout tab and your monthly graphs show up here."),
      el("h3", { class: "stats-head" }, "📏 My stats"),
      statCards.length ? el("div", { class: "lift-grid" }, statCards)
        : el("p", { class: "none" }, "No body stats yet. Add them in the Body stats tab."));
  }

  function command(action, seconds) {
    if (action === "start") startTimer(seconds || 90, "Rest");
    else if (action === "pause") stop();
    else if (action === "resume") { if (timer.left > 0) tick(true); }
    else if (action === "restart") startTimer(timer.total || seconds || 90, timer.label || "Rest");
    else if (action === "skip") { if (timer.left > 0) finishTimer(true); }
    else if (action === "restart_workout") { resetLocal(); if (tab === "workout") load(); }
  }

  return {
    load: () => load(),
    command,
    status: () => ({ timer: timer.left > 0 ? { left: Math.ceil(timer.left), label: timer.label, running: timer.running } : null,
      workout: started ? Math.floor((Date.now() - started) / 1000) : null }),
  };
}
