// planlife.js - the extra Focus tabs (skills/planlife.py on the Python side): a drag-and-drop 📅 week calendar,
// 🌳 goal tree, 🟩 habit heatmap, ✈️ travel planner and ⏱️ screen time. focus.js draws one of these into its view.
import { el, toast, busy } from "./util.js";

const peso = (n, cur = "PHP") => `${cur === "PHP" ? "₱" : cur === "USD" ? "$" : cur + " "}${Math.round(Number(n) || 0).toLocaleString()}`;

// ---------------- 📅 week calendar (drag a task onto another day to move its deadline) ----------------
export async function drawWeek(view, api, start = null) {
  const w = await api.week_view(start);
  const shift = (days) => { const d = new Date(w.start); d.setDate(d.getDate() + days); drawWeek(view, api, d.toISOString().slice(0, 10)); };
  const chip = (kind, item, date) => {
    const c = el("div", { class: `wk-chip ${kind} ${item.priority || ""} ${item.done ? "done" : ""}`, draggable: "true", tabindex: "0",
      title: kind === "task" ? "Drag to another day" : "Event" },
      kind === "event" ? `📌 ${item.time ? item.time + " " : ""}${item.title}` : `${item.priority === "high" ? "🔥 " : ""}${item.title}`);
    c.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", JSON.stringify({ kind, title: item.title, old: date })));
    return c;
  };
  const drop = (date) => ({
    ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add("over"); },
    ondragleave: (e) => e.currentTarget.classList.remove("over"),
    ondrop: async (e) => {
      e.preventDefault(); e.currentTarget.classList.remove("over");
      const m = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
      if (!m.title || m.old === date) return;
      const r = await api.week_move(m.kind, m.title, m.old, date);
      if (r.error || !r.ok) return toast(r.error || "Couldn't move it.");
      toast(date ? `Moved to ${date}.` : "No deadline now.");
      drawWeek(view, api, w.start);
    },
  });
  const today = new Date().toISOString().slice(0, 10);
  view.replaceChildren(
    el("div", { class: "row center" }, el("button", { class: "ghost small", onclick: () => shift(-7) }, "◀ Last week"),
      el("b", {}, `Week of ${w.start}`), el("button", { class: "ghost small", onclick: () => shift(7) }, "Next week ▶")),
    el("div", { class: "wk-grid" }, w.days.map((d) => el("div", { class: `wk-day ${d.date === today ? "today" : ""}`, ...drop(d.date) },
      el("h5", {}, `${d.weekday} ${d.date.slice(8)}`), ...d.events.map((x) => chip("event", x, d.date)), ...d.tasks.map((x) => chip("task", x, d.date))))),
    el("div", { class: "wk-undated", ...drop(null) }, el("h5", {}, "No deadline yet (drag onto a day)"), ...w.undated.map((x) => chip("task", x, null))),
    el("p", { class: "note" }, "Add tasks and events in Planner. Drag a task to a day to give it that deadline."));
}

// ---------------- 🌳 goal tree ----------------
export async function drawGoals(view, api) {
  const render = (goals) => {
    const node = (g) => el("li", { class: g.done ? "done" : "" },
      el("div", { class: "goal-row" },
        el("input", { type: "checkbox", checked: g.progress >= 1, "aria-label": `Done: ${g.title}`, onchange: async () => render((await api.goal_toggle(g.id)).goals) }),
        el("span", { class: "goal-title" }, g.title),
        el("span", { class: "goal-bar", style: `--p:${g.progress * 100}` }, el("i")), el("small", {}, `${Math.round(g.progress * 100)}%`),
        el("button", { class: "ghost small", onclick: () => ask(g) }, "+ step"),
        el("button", { class: "ghost small danger", "aria-label": `Remove ${g.title}`, onclick: async () => render((await api.goal_remove(g.id)).goals) }, "✕")),
      g.children.length ? el("ul", {}, g.children.map(node)) : null);
    const input = el("input", { placeholder: "A big goal (e.g. Pass the board exam)", "aria-label": "New goal" });
    view.replaceChildren(
      el("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); const r = await api.goal_add(input.value, null); if (r.error) return toast(r.error); render(r.goals); } },
        input, el("button", { class: "primary" }, "Add goal")),
      goals.length ? el("ul", { class: "goal-tree" }, goals.map(node)) : el("p", { class: "none" }, "No goals yet. Add a big one, then break it into sub-goals and small steps."));
  };
  const ask = async (g) => {
    const t = prompt(`A smaller step for “${g.title}”:`);
    if (!t) return;
    const r = await api.goal_add(t, g.id);
    if (r.error) return toast(r.error);
    render(r.goals);
  };
  render((await api.goal_tree()).goals);
}

// ---------------- 🟩 habit heatmap ----------------
export async function drawHabits(view, api) {
  const h = await api.habit_heatmap(84);
  if (!h.habits.length) return view.replaceChildren(el("p", { class: "none" }, "No habits yet. Add them in Life → Habits."));
  view.replaceChildren(el("p", { class: "note" }, "The last 12 weeks. Darker = more of your goal done that day."),
    ...h.habits.map((r) => el("div", { class: "heat" }, el("h5", {}, `${r.icon} ${r.name}`),
      el("div", { class: "heat-grid", role: "img", "aria-label": `${r.name}: done on ${r.cells.filter((c) => c >= 1).length} of ${r.cells.length} days` },
        r.cells.map((c, i) => el("i", { style: `--a:${c}`, title: `${h.days[i]}: ${Math.round(c * 100)}%` }))))));
}

// ---------------- ⏱️ screen time ----------------
export async function drawScreen(view, api) {
  const x = await api.focus_extras();
  const s = x.screen, wk = x.screen_week;
  const top = Math.max(1, ...s.apps.map((a) => a.minutes));
  const wtop = Math.max(1, ...wk.map((d) => d.minutes));
  const hm = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
  view.replaceChildren(
    el("h4", {}, `Today · ${hm(s.total)}`),
    s.apps.length ? el("ul", { class: "st-list" }, s.apps.map((a) => el("li", {}, el("span", {}, a.app), el("i", { style: `--p:${a.minutes / top * 100}` }), el("b", {}, hm(a.minutes)))))
      : el("p", { class: "none" }, "Nothing yet today. She counts the app in front every 30 seconds (not while you're away)."),
    el("h4", {}, "This week"),
    el("div", { class: "st-week" }, wk.map((d) => el("div", { title: `${d.date}: ${hm(d.minutes)}` }, el("i", { style: `--p:${d.minutes / wtop * 100}` }), el("small", {}, d.date.slice(8))))),
    el("p", { class: "note" }, "Turn it off in Settings → Her little life (Count my screen time). It stays on this PC."));
}

// ---------------- ✈️ travel planner ----------------
export async function drawTravel(view, api, onCalendar = null) {
  const f = {
    place: el("input", { placeholder: "Where? (e.g. Cebu, Tokyo)", "aria-label": "Place", required: true }),
    days: el("input", { type: "number", min: 1, max: 14, placeholder: "Days", "aria-label": "Number of days", required: true }),
    origin: el("input", { placeholder: "Flying from (optional)", "aria-label": "Flying from" }),
    start: el("input", { type: "date", "aria-label": "Start date" }),
    people: el("input", { type: "number", min: 1, max: 12, value: 1, "aria-label": "People" }),
    budget: el("input", { placeholder: "Budget (optional)", "aria-label": "Budget" }),
    currency: el("select", { "aria-label": "Currency" }, ["PHP", "USD", "JPY", "KRW", "EUR", "SGD"].map((c) => el("option", { value: c }, c))),
    stars: el("input", { type: "range", min: 1, max: 5, value: 3, "aria-label": "Price level" }),
  };
  const words = ["", "Super cheap", "Cheap", "Average", "Comfortable", "Expensive"];
  const starLabel = el("b", {}, "★★★ Average");
  f.stars.addEventListener("input", () => { starLabel.textContent = `${"★".repeat(f.stars.value)} ${words[f.stars.value]}`; });
  const out = el("div");
  const go = el("button", { class: "primary" }, "✈️ Plan my trip");
  const req = () => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value]));
  view.replaceChildren(
    el("form", { class: "travel-form", onsubmit: async (e) => {
      e.preventDefault();
      if (!f.place.value.trim() || !f.days.value) return toast("Type the place and how many days first.");
      busy(go, true, "Planning…");
      const p = await api.travel_plan(req());
      busy(go, false);
      if (p.error) return toast(p.error);
      showPlan(out, api, p, onCalendar);
    } },
      f.place, f.days, f.origin, f.start, f.people, f.budget, f.currency,
      el("label", { class: "inline" }, "Price ", f.stars, starLabel), go),
    out);
  const saved = await api.travel_saved();
  if (saved.length) out.replaceChildren(el("h5", {}, "Saved plans"), ...saved.map((p) =>
    el("button", { class: "ghost small", onclick: () => showPlan(out, api, p, onCalendar) }, `${p.request.place} · ${p.request.days} days`)));
}

/** "Put it on your calendar?" - every trip day becomes a calendar event with that day's itinerary */
function calendarAsk(api, plan, onCalendar) {
  const start = el("input", { type: "date", "aria-label": "First day of the trip", value: plan.request.start || "" });
  const box = el("div", { class: "edit-card trip-cal" },
    el("b", {}, "📅 Add this trip to your calendar?"),
    el("p", { class: "note" }, "Each day of the trip goes on the calendar, with that day's itinerary."),
    el("div", { class: "row" }, el("label", { class: "inline" }, "First day ", start),
      el("button", { class: "primary small", onclick: async (e) => {
        if (!start.value) return toast("Pick the first day of the trip.");
        busy(e.currentTarget, true, "Adding…");
        const r = await api.travel_to_calendar(plan, start.value);
        if (r.error) { busy(e.currentTarget, false); return toast(r.error); }
        toast(r.message, 7000);
        box.replaceChildren(el("b", {}, "✅ On your calendar"), el("p", { class: "note" }, r.message));
        onCalendar?.(r.start);
      } }, "Yes, add it"),
      el("button", { class: "ghost small", onclick: () => box.remove() }, "Not now")));
  return box;
}

function showPlan(out, api, plan, onCalendar = null) {
  const cur = plan.request.currency;
  const redraw = (p) => { if (p.error) return toast(p.error); plan = p; showPlan(out, api, p, onCalendar); };
  const a = plan.airfare || {};
  const links = plan.links || {};
  out.replaceChildren(
    el("h4", {}, `${plan.request.place} · ${plan.request.days} days · ${"★".repeat(plan.request.stars)}`),
    calendarAsk(api, plan, onCalendar),
    plan.summary ? el("p", {}, plan.summary) : null,
    el("p", { class: "note" }, `Estimated total: ${peso(plan.estimate, cur)} per person (prices are estimates; check the links).`),
    a.route ? el("div", { class: "edit-card" }, el("b", {}, "✈️ Airfare "), `${a.route}: ${peso(a.low, cur)} – ${peso(a.high, cur)} ${a.airlines ? "· " + a.airlines : ""}`, a.tip ? el("small", { class: "note" }, ` ${a.tip}`) : null) : null,
    el("h5", {}, "🏨 Where to stay"),
    el("div", { class: "stay-list" }, (plan.stays || []).map((s) => el("div", { class: "stay" },
      el("div", { class: "stay-top" }, el("b", {}, s.name), el("span", { class: "stay-price" }, `${peso(s.per_night, cur)}/night`)),
      el("small", { class: "note" }, [s.type, s.area].filter(Boolean).join(" · ")),
      s.why ? el("p", {}, s.why) : null))),
    el("div", { class: "row" }, ...[["flights", "Google Flights"], ["skyscanner", "Skyscanner"], ["hotels", "Booking.com"], ["airbnb", "Airbnb"], ["maps", "Map"]]
      .filter(([k]) => links[k]).map(([k, l]) => el("button", { class: "ghost small", onclick: () => api.browse_inside(links[k]) }, `🔗 ${l}`))),
    ...(plan.days || []).map((d) => el("div", { class: "trip-day" },
      el("h5", {}, `Day ${d.day}: ${d.title || ""} · ${peso(d.total, cur)}`),
      el("ol", {}, d.stops.map((s, i) => el("li", { class: `stop ${s.kind}` },
        el("span", {}, `${s.time || ""} ${s.kind === "commute" ? "🚌" : s.kind === "food" ? "🍽️" : s.kind === "hotel" ? "🏨" : "📍"} `),
        el("b", {}, s.name), s.area ? ` · ${s.area}` : "", ` · ${peso(s.cost, cur)}`, s.note ? el("small", { class: "note" }, ` ${s.note}`) : null,
        el("button", { class: "ghost small", title: "Suggest a different place", onclick: async (e) => {
          const why = prompt("Why change it? (optional, e.g. too far, I've been there)") ?? "";
          busy(e.currentTarget, true, "…");
          redraw(await api.travel_swap(plan, d.day, i, why));
        } }, "🔄"),
        el("button", { class: "ghost small", title: "Type your own", onclick: async () => {
          const name = prompt("Your place:", s.name);
          if (!name) return;
          const cost = prompt("Cost:", s.cost);
          redraw(await api.travel_edit(plan, d.day, i, { ...s, name, cost }));
        } }, "✏️"))),
        el("li", {}, el("button", { class: "ghost small", onclick: async () => {
          const name = prompt("Add a place to this day:");
          if (!name) return;
          redraw(await api.travel_edit(plan, d.day, d.stops.length, { name, kind: "spot", cost: 0 }));
        } }, "+ Add a place"))))),
    plan.tips?.length ? el("ul", { class: "note" }, plan.tips.map((t) => el("li", {}, t))) : null);
}
