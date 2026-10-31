// gymlife.js - the Gym & health round: Coach & PRs (next week's weights, muscles this week, records wall),
// Health (sleep goal + debt, supplements, grocery list with store prices), Runs (GPS like Strava),
// the protein bar and the "Demo" move she does next to you.
import { el, toast } from "./util.js";
import { muscleMapWeighted } from "./muscles.js";

// same rules as gymlife.py DEMOS: exercise name -> the move she shows
const DEMOS = [[/squat|leg press|goblet|hack/i, "squat"], [/lunge|split|step.?up|bulgarian/i, "lunge"],
  [/deadlift|rdl|romanian|hip thrust|good morning|hinge/i, "deadlift"], [/push.?up|press.?up|\bdips?\b/i, "pushup"], [/curl/i, "curl"],
  [/\brow(s|ing)?\b|pull.?up|chin.?up|\blats?\b|pulldown/i, "row"], [/press|bench|fly|raise|extension|tricep/i, "press"],
  [/plank|crunch|sit.?up|\babs?\b|\bcore\b|hollow/i, "plank"], [/jump|jack|burpee|cardio|\brun|skipping/i, "jumping_jacks"]];
export const demoKey = (name) => DEMOS.find(([rx]) => rx.test(name || ""))?.[1] || null;

// ---------------- protein bar (Calories → Today's meals) ----------------
export async function proteinBar(api) {
  const p = await api.gym_protein();
  return el("div", { class: "protein-bar" }, el("div", { class: "row" }, el("b", {}, "🥩 Protein today"), el("span", {}, p.text)),
    p.target ? el("progress", { max: 100, value: p.pct, "aria-label": "Protein goal" }) : null);
}

// ---------------- coach banner (top of Workout) ----------------
export async function coachBanner(api) {
  const c = await api.gym_coach_plan();
  if (!c.message) return el("span");
  return el("div", { class: `coach-banner${c.extra?.length || c.deload ? " warn" : ""}` },
    el("b", {}, c.deload ? "🔄 Comeback week" : c.extra?.length ? "🧭 Catch-up" : "🧭 Coach"), el("span", {}, c.message),
    c.extra?.length ? el("ul", {}, c.extra.map((x) => el("li", {}, `${x.name} · ${x.sets} × ${x.target || "—"} (from Day ${x.from_day})`))) : null);
}

// ---------------- Coach & PRs tab ----------------
export async function drawCoach(view, api) {
  const [next, muscles, prs] = await Promise.all([api.gym_next_weights(), api.gym_week_muscles(), api.gym_prs()]);
  const ups = next.filter((n) => n.status === "up");
  const nextBox = el("section", { class: "card-lite" }, el("h3", {}, "📈 Next week's weights"),
    el("p", { class: "note" }, "Heavier only when you did every set AND every set reached the top of the rep range. Otherwise keep the weight and beat your reps."),
    next.length ? el("ul", { class: "day-list next-weights" }, next.filter((n) => n.status !== "skip").map((n) => el("li", { class: n.status },
      el("span", { class: "what" }, `${n.status === "up" ? "⬆" : n.status === "new" ? "•" : "="} ${n.name}`),
      el("b", {}, n.next ? `${n.next} kg` : "—"), el("small", {}, n.why))))
      : el("p", { class: "none" }, "No routine yet."),
    ups.length ? el("button", { class: "primary", onclick: async () => {
      for (const u of ups) await api.gym_upgrade_weight(u.name, u.next);
      toast(`Saved ${ups.length} new weight${ups.length > 1 ? "s" : ""} to your routine.`);
      drawCoach(view, api);
    } }, `Save the ${ups.length} heavier weight${ups.length > 1 ? "s" : ""} to my routine`) : null);

  const names = Object.keys(muscles);
  const fresh = names.filter((m) => muscles[m] >= 0.7), fading = names.filter((m) => muscles[m] < 0.7);
  const mapBox = el("section", { class: "card-lite week-map" }, el("h3", {}, "🫀 Muscles this week"),
    el("div", { class: "row" }, muscleMapWeighted(muscles, { title: "Brighter = trained more recently" }),
      el("div", {}, el("p", {}, el("b", {}, "Fresh: "), fresh.join(", ") || "—"), el("p", {}, el("b", {}, "Fading: "), fading.join(", ") || "—"),
        el("p", { class: "note" }, "Colours fade over 7 days. Grey muscles haven't been trained this week."))));

  const wall = el("section", { class: "card-lite pr-wall" }, el("h3", {}, "🏆 Personal records"),
    prs.length ? el("div", { class: "pr-grid" }, prs.map((p) => el("div", { class: `pr${p.new ? " new" : ""}` },
      el("div", { class: "trophy" }, p.trophy || "🏅"), el("b", {}, p.name),
      p.e1rm ? el("span", {}, `~${p.e1rm} kg 1RM`) : null,
      el("small", {}, [p.e1rm_set, p.kg ? `heaviest ${p.kg} kg` : "", `most reps ${p.reps}`].filter(Boolean).join(" · ")),
      p.new ? el("small", { class: "new-tag" }, "NEW this week") : null)))
      : el("p", { class: "none" }, "Log some sets and your records show up here."));
  view.replaceChildren(nextBox, mapBox, wall);
}

// ---------------- Health tab: sleep, supplements, groceries ----------------
export async function drawHealth(view, api) {
  const sleepBox = el("section", { class: "card-lite" }), suppBox = el("section", { class: "card-lite" }), shopBox = el("section", { class: "card-lite" });
  view.replaceChildren(sleepBox, suppBox, shopBox);
  drawSleep(sleepBox, api, await api.gym_sleep_report());
  drawSupps(suppBox, api, await api.gym_supplements());
  drawShop(shopBox, api);
}

export function sleepBars(r) {
  return el("div", { class: "sleep-bars", role: "img", "aria-label": `Sleep, last 7 nights: ${r.summary}` },
    r.nights.map((n) => el("div", { class: `sb${n.met ? " met" : n.hours == null ? " none" : ""}`, title: `${n.date}: ${n.hours ?? "not logged"} h` },
      el("i", { style: `height:${Math.min(100, ((n.hours || 0) / Math.max(r.need, 1)) * 80)}%` }),
      el("small", {}, new Date(n.date + "T12:00").toLocaleDateString(undefined, { weekday: "narrow" })))));
}

function drawSleep(box, api, r) {
  const need = el("input", { type: "number", min: 4, max: 12, step: 0.5, value: r.need, "aria-label": "Hours of sleep I need" });
  const bed = el("input", { type: "time", value: r.bedtime, "aria-label": "Bedtime" });
  const wind = el("input", { type: "number", min: 10, max: 120, step: 5, value: r.wind_down, "aria-label": "Wind-down reminder minutes" });
  const hours = el("input", { type: "number", min: 0, max: 16, step: 0.5, placeholder: "e.g. 7.5", "aria-label": "Hours slept last night" });
  box.replaceChildren(el("h3", {}, "🛌 Sleep"),
    el("p", {}, el("b", {}, r.summary), r.avg != null ? ` · average ${r.avg} h` : "", r.streak ? ` · ${r.streak}-night streak` : ""),
    sleepBars(r),
    el("ul", { class: "tips" }, r.tips.map((t) => el("li", {}, t))),
    el("div", { class: "row" }, el("label", {}, "Last night ", hours, " h"),
      el("button", { class: "primary", onclick: async () => {
        const o = await api.gym_sleep(hours.value);
        if (o.error) return toast(o.error);
        drawSleep(box, api, await api.gym_sleep_report());
      } }, "Save")),
    el("div", { class: "row" }, el("label", {}, "I need ", need, " h"), el("label", {}, "Bedtime ", bed),
      el("label", {}, "Wind-down reminder ", wind, " min before"),
      el("button", { class: "ghost", onclick: async () => {
        const o = await api.gym_sleep_save(need.value, bed.value, wind.value);
        if (o.error) return toast(o.error);
        toast("Sleep goal saved."); drawSleep(box, api, o);
      } }, "Save goal")),
    el("p", { class: "note" }, "Your sleep goal also shows in Focus → My progress."));
}

function drawSupps(box, api, d) {
  const name = el("input", { placeholder: "Creatine, Vitamin D…", "aria-label": "Supplement or medicine" });
  const dose = el("input", { placeholder: "5 g", "aria-label": "Dose", size: 8 });
  const times = el("input", { placeholder: "08:00, 20:00", "aria-label": "Times (comma separated)", size: 14 });
  const redraw = (x) => (x.error ? toast(x.error) : drawSupps(box, api, x));
  box.replaceChildren(el("h3", {}, "💊 Supplements & medicine"),
    d.items.length ? el("ul", { class: "day-list supps" }, d.items.map((x) => el("li", {},
      el("span", { class: "what" }, x.name, x.dose ? el("small", {}, ` · ${x.dose}`) : null),
      ...x.slots.map((s) => el("button", { class: `ghost small slot${s.taken ? " on" : s.due ? " due" : ""}`, "aria-pressed": String(s.taken),
        title: s.taken ? "Taken. Click to undo" : "Mark as taken",
        onclick: async () => redraw(await api.gym_supp_take(x.id, s.time, s.taken)) }, `${s.taken ? "✓" : s.due ? "⏰" : "○"} ${s.time}`)),
      el("button", { class: "x", "aria-label": `Remove ${x.name}`, onclick: async () => redraw(await api.gym_supp_remove(x.id)) }, "×"))))
      : el("p", { class: "none" }, "Nothing yet. You get a reminder at each time until you tap it."),
    d.items.length ? el("p", { class: "note" }, "This week: " + d.week.map((w) => `${w.taken}/${w.want}`).join(" · ")) : null,
    el("div", { class: "row" }, name, dose, times, el("button", { class: "primary", onclick: async () =>
      redraw(await api.gym_supp_save({ name: name.value, dose: dose.value, times: times.value.split(/[,\s]+/).filter(Boolean) })) }, "Add")));
}

function drawShop(box, api) {
  let country = "";
  try { country = localStorage.getItem("groceryCountry") || ""; } catch { /* ignore */ }
  const pick = el("select", { "aria-label": "Store", onchange: () => { try { localStorage.setItem("groceryCountry", pick.value); } catch { /* ignore */ } } },
    [["", "Nearest (from my city)"], ["PH", "SM Supermarket (PH, ₱)"], ["US", "Walmart (US, $)"]].map(([v, l]) => el("option", { value: v, selected: v === country }, l)));
  const out = el("div");
  const go = el("button", { class: "primary", onclick: async () => {
    go.disabled = true; go.textContent = "Pricing…";
    const r = await api.gym_grocery(pick.value, localStorage.getItem("mealGoal") || "recomp", Number(localStorage.getItem("mealCount")) || 4);
    go.disabled = false; go.textContent = "🛒 Make my grocery list";
    if (r.error) return out.replaceChildren(el("p", { class: "note" }, r.error));
    out.replaceChildren(
      el("p", {}, el("b", {}, `${r.store}`), ` · about ${r.currency}${r.total.toLocaleString()} for a week`),
      el("ul", { class: "day-list grocery" }, r.items.map((i) => el("li", {},
        el("label", { class: "check" }, el("input", { type: "checkbox" }), el("span", { class: "what" }, `${i.food}`)),
        el("small", {}, i.qty), el("b", {}, i.price != null ? `${r.currency}${i.price.toLocaleString()}` : "?"),
        el("button", { class: "ghost small", onclick: () => api.open_url(i.link) }, "Find")))),
      el("p", { class: "note" }, r.note));
  } }, "🛒 Make my grocery list");
  box.replaceChildren(el("h3", {}, "🛒 Grocery list"),
    el("p", { class: "note" }, "A week of food from your meal plan (Calories tab), with prices from the nearest big store."),
    el("div", { class: "row" }, pick, go), out);
}

