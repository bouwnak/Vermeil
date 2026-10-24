// missions.js - Mission Control: bigger goals she plans and works through in the background.
import { $, el, toast, busy } from "./util.js";

const EXAMPLES = [
  "Find 3 good laptops under ₱50,000 for engineering students and compare them",
  "Every morning for 3 days, check the weather in Manila and tell me the best day to go out",
  "Plan my thesis week: look at my calendar and tasks, then add study blocks and reminders",
  "Research the best beginner calisthenics routine and add it to my notes",
];
const ICON = { pending: "○", running: "◐", done: "✓", failed: "✕", skipped: "↷" };
const STATUS = { active: "Running", paused: "Paused", done: "Done", failed: "Needs you", cancelled: "Cancelled" };

const when = (ts) => {
  if (!ts) return "";
  const d = new Date(ts * 1000), now = Date.now();
  if (ts * 1000 <= now + 60000) return "now";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
};

export function initMissions(api) {
  const body = $("missionsBody");
  let items = [];

  function card(m) {
    const done = m.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
    const next = m.steps.find((s) => s.status === "pending");
    const act = (action) => async () => { items = (await api.mission_action(m.id, action)).missions || items; draw(); };
    const buttons = [];
    if (m.status === "active") buttons.push(["Pause", "pause"], ["Do next step now", "run_now"]);
    if (m.status === "paused") buttons.push(["Resume", "resume"]);
    if (m.status === "failed") buttons.push(["Try again", "resume"], ["Skip this step", "skip"]);
    if (["active", "paused", "failed"].includes(m.status)) buttons.push(["Cancel", "cancel"]);
    else buttons.push(["Delete", "delete"]);
    return el("article", { class: `mission ${m.status}` },
      el("header", {}, el("b", {}, m.title), el("span", { class: `badge ${m.status}` }, STATUS[m.status] || m.status)),
      el("div", { class: "bar", role: "progressbar", "aria-valuenow": done, "aria-valuemax": m.steps.length },
        el("span", { style: `width:${Math.round((done / m.steps.length) * 100)}%` })),
      el("small", { class: "muted" }, `${done}/${m.steps.length} steps${m.status !== "active" ? ""
        : m.steps.some((s) => s.status === "running") ? " · working on it now…"
        : next ? ` · next step: ${next.at ? when(next.at) : "after this one"}` : ""}`),
      el("ol", { class: "steps" }, m.steps.map((s) => el("li", { class: s.status },
        el("span", { class: "ic" }, ICON[s.status] || "○"),
        el("div", {}, el("span", {}, s.text), s.wait_hours ? el("small", { class: "muted" }, ` (waits ${s.wait_hours < 1 ? Math.round(s.wait_hours * 60) + " min" : s.wait_hours + " h"})`) : null,
          s.result ? el("p", { class: "result" }, s.result) : null)))),
      el("div", { class: "row" }, buttons.map(([label, action]) =>
        el("button", { class: action === "cancel" || action === "delete" ? "ghost" : "", onclick: act(action) }, label))));
  }

  function draw() {
    const input = el("textarea", { rows: 2, placeholder: "What should she get done? Big goals are fine — she'll plan the steps." });
    const go = el("button", { class: "primary" }, "Start mission");
    go.addEventListener("click", async () => {
      busy(go, true, "Planning…");
      const r = await api.mission_create(input.value);
      busy(go, false);
      if (r.error) return toast(r.error, 5000);
      items = await api.missions_list();
      draw();
      toast(`Mission started: ${r.mission.title}`);
    });
    const live = items.filter((m) => ["active", "paused", "failed"].includes(m.status));
    const old = items.filter((m) => !live.includes(m));
    body.replaceChildren(...[
      el("p", { class: "note" }, "She plans the steps, does them with her tools, and can wait hours or days between steps. Anything risky (sending email, typing, closing apps) still asks you first."),
      input,
      el("div", { class: "chips" }, EXAMPLES.map((x) => el("button", { class: "chip", onclick: () => { input.value = x; input.focus(); } }, x.length > 42 ? x.slice(0, 40) + "…" : x))),
      el("div", { class: "row" }, go),
      live.length ? el("h4", {}, "Running") : null, ...live.map(card),
      old.length ? el("h4", {}, "Finished") : null, ...old.slice(0, 10).map(card),
      !items.length ? el("p", { class: "none" }, "No missions yet. You can also just say: “start a mission to …”.") : null].filter(Boolean));
  }

  async function load() { items = await api.missions_list(); draw(); }

  return {
    load,
    update(m) {
      const i = items.findIndex((x) => x.id === m.id);
      if (i >= 0) items[i] = m; else items.unshift(m);
      if (!$("panel-missions").hidden) draw();
      if (m.status === "done") toast(`✅ Mission done: ${m.title}`, 6000);
      if (m.status === "failed") toast(`⚠️ Mission needs you: ${m.title}`, 6000);
    },
    status() {
      const run = items.filter((m) => m.status === "active");
      if (!run.length) return null;
      const m = run[0];
      const busyNow = m.steps.some((s) => s.status === "running");
      const done = m.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
      return { title: m.title, done, total: m.steps.length, busy: busyNow, count: run.length };
    },
  };
}
