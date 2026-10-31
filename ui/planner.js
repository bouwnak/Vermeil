// planner.js - month calendar + "what's on this day" + add form.
import { $, el, toast } from "./util.js";
import * as fx from "./fx.js";

const KINDS = {
  event: { label: "Event", cls: "k-event" },
  task: { label: "Task", cls: "k-task" },
  reminder: { label: "Reminder", cls: "k-reminder" },
  birthday: { label: "Birthday", cls: "k-birthday" },
  weekly: { label: "Every week", cls: "k-weekly" },
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtTime = (hm) => {
  if (!hm) return "";
  const [h, m] = hm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

export function initPlanner(api) {
  let shown = new Date(); shown.setDate(1);
  let selected = iso(new Date());

  const body = $("plannerBody");
  body.replaceChildren(
    el("div", { class: "cal-head" },
      el("button", { class: "icon-btn", "aria-label": "Previous month", onclick: () => { shown.setMonth(shown.getMonth() - 1); render(); } }, "‹"),
      el("strong", { id: "calTitle" }),
      el("button", { class: "icon-btn", "aria-label": "Next month", onclick: () => { shown.setMonth(shown.getMonth() + 1); render(); } }, "›"),
      el("button", { class: "ghost small", onclick: () => { shown = new Date(); shown.setDate(1); selected = iso(new Date()); render(); } }, "Today"),
      el("button", { class: "ghost small", style: "margin-left:auto", title: "Records with your microphone, then writes a summary, decisions and action items",
        onclick: () => window.dispatchEvent(new CustomEvent("vermeil:meeting")) }, "🎙 Record meeting notes"),
      el("button", { class: "ghost small", title: "Play the planner notification sound",
        onclick: () => { fx.play("notify"); toast("🔔 Planner notification sound"); } }, "🔔"),
      el("button", { class: "ghost small", onclick: async () => {
        const r = await api.find_free_time_ui(selected); toast(r, 8000); } }, "Find free time")),
    el("div", { class: "cal-grid", id: "calGrid", role: "grid" }),
    el("div", { class: "cal-legend" }, Object.values(KINDS).map((k) => el("span", { class: `dot ${k.cls}` }, k.label))),
    el("h3", { id: "dayTitle" }),
    el("ul", { class: "day-list", id: "dayList" }),
    el("form", { class: "add-form", id: "planAdd" },
      el("select", { name: "kind", "aria-label": "Type" }, Object.entries(KINDS).map(([v, k]) => el("option", { value: v }, k.label))),
      el("input", { name: "title", placeholder: "What is it?", "aria-label": "Title", required: true }),
      el("input", { name: "date", type: "date", "aria-label": "Date" }),
      el("input", { name: "time", type: "time", "aria-label": "Time (optional)" }),
      el("select", { name: "repeat", "aria-label": "Repeat" },
        ["none", "daily", "weekdays", "weekly", "monthly", "yearly"].map((r) => el("option", { value: r }, r === "none" ? "Doesn't repeat" : `Repeats ${r}`))),
      el("select", { name: "priority", "aria-label": "Priority" },
        ["normal", "high", "low"].map((p) => el("option", { value: p }, `${p[0].toUpperCase() + p.slice(1)} priority`))),
      el("button", { class: "primary", type: "submit" }, "Add")),
    el("h3", {}, "Reminders for a situation"),
    el("p", { class: "note" }, "Not at a clock time: when you get back to the computer. You can also just say \"remind me to … when I get home\"."),
    el("ul", { class: "day-list", id: "smartList" }),
    el("form", { class: "add-form", id: "smartAdd" },
      el("input", { name: "event", placeholder: "e.g. take out the trash", "aria-label": "What to remind", required: true }),
      el("span", { class: "note" }, "when I get back"),
      el("button", { class: "primary", type: "submit" }, "Add")),
    el("h3", {}, "Tasks without a date"),
    el("ul", { class: "day-list", id: "anytimeList" }),
    el("h3", {}, "Shopping list"),
    el("ul", { class: "day-list", id: "shopList" }),
    el("h3", {}, "Notes"),
    el("ul", { class: "day-list", id: "noteList" }),
  );

  // ---------- situation reminders ----------
  const smart = $("smartAdd");
  const drawSmart = (items) => $("smartList").replaceChildren(...(items.length ? items.map((r) => el("li", {},
    el("span", { class: "what" }, r.event), el("small", {}, r.on === "home" ? "when you get back" : `${r.minutes} min before ${r.match || "your next event"}`),
    el("button", { class: "x", "aria-label": `Remove ${r.event}`, onclick: async () => drawSmart(await api.smart_reminder_remove(r.event)) }, "×")))
    : [el("li", { class: "none" }, "None.")]));
  smart.addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await api.smart_reminder_add(smart.event.value, "home", "", 0);
    toast(r.message, 5000);
    drawSmart(r.items);
    smart.event.value = "";
  });
  api.smart_reminders().then(drawSmart).catch(() => {});

  const form = $("planAdd");
  const syncForm = () => {
    const k = form.kind.value;
    form.repeat.hidden = k !== "reminder";
    form.priority.hidden = k !== "task";
    form.time.hidden = k === "birthday";
    form.title.placeholder = { event: "e.g. Thesis meeting", task: "e.g. Finish lab report", reminder: "e.g. Take vitamins",
      birthday: "Whose birthday?", weekly: "e.g. Gym" }[k];
  };
  form.kind.addEventListener("change", syncForm);
  syncForm();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const item = Object.fromEntries(new FormData(form));
    item.date ||= selected;
    const res = await api.planner_add(item);
    if (res.error) return toast(res.error);
    toast(res.message);
    form.title.value = ""; form.time.value = "";
    selected = item.date;
    render();
  });

  async function remove(kind, it) {
    const map = { event: "event", task: "task", reminder: "reminder", birthday: "birthday", weekly: "schedule" };
    await api.planner_remove(map[kind], it.key, kind === "weekly" ? it.day : kind === "event" ? selected : undefined);
    render();
  }

  function itemRow(it) {
    const kind = KINDS[it.kind] || KINDS.event;
    const row = el("li", { class: it.done ? "done" : "" },
      el("span", { class: `pill ${kind.cls}` }, kind.label),
      el("span", { class: "when" }, it.time ? fmtTime(it.time) : it.kind === "birthday" ? "All day" : ""),
      el("span", { class: "what" }, it.title, it.detail ? el("small", {}, it.detail) : null));
    if (it.kind === "task") {
      const box = el("input", { type: "checkbox", "aria-label": `Done: ${it.title}`, checked: !!it.done,
        onchange: async () => { await api.planner_toggle_task(it.title, box.checked); render(); } });
      row.prepend(box);
    }
    row.append(el("button", { class: "x", "aria-label": `Remove ${it.title}`, onclick: () => remove(it.kind, it) }, "×"));
    return row;
  }

  async function render() {
    const y = shown.getFullYear(), m = shown.getMonth();
    $("calTitle").textContent = shown.toLocaleDateString([], { month: "long", year: "numeric" });
    const [month, day, lists] = await Promise.all([api.planner_month(y, m + 1), api.planner_day(selected), api.get_planner()]);
    // grid
    const grid = $("calGrid");
    const cells = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => el("span", { class: "dow" }, d));
    const first = new Date(y, m, 1);
    for (let i = 0; i < first.getDay(); i++) cells.push(el("span", { class: "blank" }));
    const today = iso(new Date());
    for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
      const key = iso(new Date(y, m, d));
      const counts = month[key] || {};
      cells.push(el("button", {
        class: `day${key === today ? " today" : ""}${key === selected ? " sel" : ""}`,
        "aria-label": `${key}: ${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing"}`,
        onclick: () => { selected = key; form.date.value = key; render(); },
      }, el("span", { class: "num" }, String(d)),
        el("span", { class: "dots" }, Object.keys(counts).map((k) => el("i", { class: `dot ${KINDS[k]?.cls}` })))));
    }
    grid.replaceChildren(...cells);
    // selected day
    const sd = new Date(`${selected}T00:00`);
    $("dayTitle").textContent = selected === today ? `Today, ${sd.toLocaleDateString([], { month: "long", day: "numeric" })}`
      : sd.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    $("dayList").replaceChildren(...(day.length ? day.map(itemRow) : [el("li", { class: "none" }, "Nothing planned. Add something below, or just tell her.")]));
    if (!form.date.value) form.date.value = selected;
    // other lists
    const anytime = lists.tasks.filter((t) => !t.deadline);
    $("anytimeList").replaceChildren(...(anytime.length ? anytime.map((t) => itemRow({ kind: "task", title: t.task, time: t.time,
      detail: `priority ${t.priority || "normal"}`, done: t.done, key: t.task })) : [el("li", { class: "none" }, "None.")]));
    const shop = Object.values(lists.shopping).flat();
    $("shopList").replaceChildren(...(shop.length ? shop.map((s) => el("li", {}, el("span", { class: "what" }, s),
      el("button", { class: "x", "aria-label": `Remove ${s}`, onclick: async () => { await api.planner_remove("shopping", s); render(); } }, "×")))
      : [el("li", { class: "none" }, "Empty.")]));
    $("noteList").replaceChildren(...(lists.notes.length ? lists.notes.map((n) => el("li", {}, el("span", { class: "what" }, n),
      el("button", { class: "x", "aria-label": "Remove note", onclick: async () => { await api.planner_remove("note", n); render(); } }, "×")))
      : [el("li", { class: "none" }, "No notes.")]));
    const next = lists.events[0];
    $("plannerSub").textContent = next ? `Next: ${next.title}` : "Calendar, tasks, reminders";
  }

  const notified = new Set();
  async function checkDueClient() {
    try {
      const now = new Date();
      const today = iso(now);
      const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const items = await api.planner_day(today);
      for (const it of items || []) {
        if (!it.time || it.done) continue;
        const k = `${today}|${it.kind}|${it.title}|${it.time}`;
        if (it.time === hm && !notified.has(k)) {
          notified.add(k);
          fx.play("notify");
          toast(`⏰ ${it.kind === "reminder" ? "Reminder" : it.kind === "task" ? "Task due" : "Coming up"}: ${it.title}`, 10000);
        }
      }
    } catch { /* ignore */ }
  }
  setInterval(checkDueClient, 25000);

  return { render };
}
