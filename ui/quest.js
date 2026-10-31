// quest.js - XP, levels, daily quests, badges, the Battle Pass (room rewards) and the habit tracker.
// Python (skills/quest.py) keeps the score; every "quest" event shows "+N XP" and celebrates level-ups / rewards.
import { $, el, toast } from "./util.js";
import { play } from "./fx.js";

let last = null;                                     // the newest quest.state() (for passLock)

/** the Battle Pass tier that unlocks this room item / wallpaper, or 0 when you already have it (or it's not a reward) */
export function passLock(key) {
  if (!last) return 0;
  const r = last.pass.find((p) => p.key === key && p.kind !== "title");
  return r && !r.got ? r.tier : 0;
}

const bar = (have, need, cls = "") => el("div", { class: `xpbar ${cls}`, role: "progressbar", "aria-valuemin": "0",
  "aria-valuemax": String(need), "aria-valuenow": String(have) }, el("i", { style: `width:${Math.min(100, (100 * have) / Math.max(1, need))}%` }));

export function initQuest(api) {
  const root = $("passBody");
  const sub = $("passSub");
  let tab = "pass";

  async function refresh() {
    try { last = await api.quest_state(); } catch { return; }
    if (sub) sub.textContent = `Level ${last.level} · Tier ${last.tier}/${last.tiers}` + (last.streak ? ` · 🔥${last.streak}` : "");
    if (root && !root.closest(".panel").hidden) draw();
  }

  function head() {
    const s = last;
    return el("div", { class: "pass-head" },
      el("div", { class: "pass-level" }, el("b", {}, String(s.level)), el("small", {}, "LEVEL")),
      el("div", { class: "pass-info" },
        el("div", { class: "row" }, el("strong", {}, s.title || "Newcomer"),
          el("span", { class: "chip" }, `🔥 ${s.streak}-day streak`), el("span", { class: "chip" }, `+${s.today_xp} XP today`)),
        bar(s.level_xp, s.level_need), el("small", { class: "note" }, `${s.level_xp} / ${s.level_need} XP to level ${s.level + 1}`)));
  }

  function drawPass() {
    const s = last;
    const track = el("div", { class: "pass-track" }, s.pass.map((r) =>
      el("div", { class: `pass-tier ${r.got ? "got" : ""} ${r.tier === s.tier + 1 ? "next" : ""}`, title: `${r.name} (tier ${r.tier})` },
        el("small", {}, `Tier ${r.tier}`), el("div", { class: "pass-icon" }, r.got ? r.icon : "🔒"), el("span", {}, r.name),
        el("em", {}, r.kind === "item" ? "Room item" : r.kind === "wallpaper" ? "Wallpaper" : "Title"))));
    return [
      el("h3", {}, s.season),
      el("p", { class: "note" }, s.tier >= s.tiers ? "You finished the whole pass! 👑"
        : `Next tier in ${s.tier_need - s.tier_xp} XP. Rewards go into Room → Decorate → 🏆 Battle Pass.`),
      bar(s.tier_xp, s.tier_need, "tier"), track];
  }

  function drawQuests() {
    const s = last;
    return [
      el("h3", {}, "Today's quests"),
      el("ul", { class: "quest-list" }, s.quests.map((q) => el("li", { class: q.done ? "done" : "" },
        el("span", {}, (q.done ? "✅ " : "⬜ ") + q.text), bar(q.have, q.goal), el("small", {}, `${Math.min(q.have, q.goal)}/${q.goal} · +${q.xp} XP`)))),
      el("p", { class: "note" }, "New quests every day. Study, language practice, focus blocks, habits and workouts all give XP."),
      el("h3", {}, "Badges"),
      el("div", { class: "badges" }, s.badges.map((b) => el("span", { class: `badge ${b.got ? "got" : ""}`, title: b.got ? "Earned!" : "Not yet" }, b.name)))];
  }

  async function drawHabits() {
    const list = await api.habits_list();
    const name = el("input", { placeholder: "New habit, e.g. Stretch", maxlength: "40", "aria-label": "Habit name" });
    const icon = el("input", { value: "✅", maxlength: "4", class: "tiny", "aria-label": "Icon" });
    const goal = el("input", { type: "number", min: "1", max: "50", value: "1", class: "tiny", "aria-label": "Times a day" });
    const days = ["S", "M", "T", "W", "T", "F", "S"];
    return [
      el("ul", { class: "habit-list" }, list.map((h) => el("li", { class: h.done ? "done" : "" },
        el("span", { class: "habit-icon" }, h.icon),
        el("div", { class: "habit-main" },
          el("div", { class: "row" }, el("strong", {}, h.name), h.streak ? el("span", { class: "chip" }, `🔥 ${h.streak}`) : null),
          el("div", { class: "habit-week" }, h.week.map((d) => el("i", { class: d.count >= h.goal ? "full" : d.count ? "some" : "",
            title: `${d.day}: ${d.count}/${h.goal}` }, days[new Date(d.day + "T12:00").getDay()])))),
        el("div", { class: "habit-count" },
          el("button", { class: "ghost small", "aria-label": `One less ${h.name}`, onclick: async () => { await api.habit_tick(h.id, -1); draw(); } }, "−"),
          el("b", {}, `${h.today}/${h.goal}`),
          el("button", { class: "primary small", "aria-label": `One more ${h.name}`, onclick: async () => { await api.habit_tick(h.id, 1); draw(); } }, "+")),
        el("button", { class: "close small", title: "Remove this habit", "aria-label": `Remove ${h.name}`,
          onclick: async () => { if (confirm(`Remove "${h.name}" and its history?`)) { await api.habit_remove(h.id); draw(); } } }, "×")))),
      el("form", { class: "row", onsubmit: async (e) => { e.preventDefault(); const r = await api.habit_add(name.value, icon.value, goal.value);
        if (r.error) toast(r.error); else draw(); } }, icon, name, goal, el("button", { class: "ghost" }, "Add habit")),
      el("p", { class: "note" }, "You can also just say it: “I drank water”, “I slept 8 hours”. Each tick gives XP; reaching a day's goal gives more.")];
  }

  // ---------- "Your year with Vermeil" (skills/recap.py) ----------
  let recap = null;
  async function drawYear() {
    const playBtn = el("button", { class: "primary", onclick: () => recap && story(recap) }, "▶ Play my recap");
    const box = el("div", { class: "recap-grid" }, el("p", { class: "note" }, "Counting your year…"));
    (async () => {
      recap = recap || await api.recap_year();
      if (recap.error) { box.replaceChildren(el("p", { class: "note" }, recap.error)); return; }
      box.replaceChildren(...recap.slides.map(card), el("blockquote", { class: "recap-note" }, `💜 ${recap.note}`));
    })();
    return [el("div", { class: "row" }, el("h3", {}, "Your year with Vermeil"), playBtn,
      el("button", { class: "ghost small", title: "Count again", onclick: () => { recap = null; draw(); } }, "↻")),
      el("p", { class: "note" }, "Like a year-in-review: your XP, focus, workouts, studying, songs and games, counted from what you saved."), box];
  }
  const card = (c) => el("div", { class: "recap-card" }, el("div", { class: "recap-icon" }, c.icon), el("small", {}, c.title),
    el("b", {}, c.big), c.sub ? el("span", {}, c.sub) : null, c.list?.length ? el("ol", {}, c.list.map((x) => el("li", {}, x))) : null);

  function story(r) {
    const pages = [...r.slides, { icon: "💜", title: "From me", big: "", sub: r.note }];
    let i = 0;
    const page = el("div", { class: "recap-page" });
    const dots = el("div", { class: "recap-dots" });
    const shut = () => { clearInterval(timer); box.remove(); window.removeEventListener("keydown", key, true); };
    const go = (d) => { i += d; if (i >= pages.length) return shut(); i = Math.max(0, i); show(); };
    const key = (e) => { e.stopPropagation(); if (e.key === "Escape") shut(); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); };
    function show() {
      page.replaceChildren(card(pages[i]));
      page.firstChild.classList.add("in");
      dots.replaceChildren(...pages.map((_, k) => el("i", { class: k <= i ? "on" : "" })));
    }
    const box = el("div", { class: "recap-story", role: "dialog", "aria-label": "Your year recap", onclick: (e) => go(e.clientX < innerWidth / 3 ? -1 : 1) },
      dots, page, el("button", { class: "close", "aria-label": "Close", onclick: (e) => { e.stopPropagation(); shut(); } }, "×"));
    const timer = setInterval(() => go(1), 6000);
    window.addEventListener("keydown", key, true);           // first, so Escape closes only the story
    document.body.append(box);
    show();
  }

  // ---------- Vermeil's surprise gift after a hard week ----------
  async function giftCard() {
    let g;
    try { g = await api.gifts(); } catch { return null; }
    const w = g.waiting?.[0];
    if (!w) return null;
    return el("div", { class: "gift-card" }, el("span", { class: "gift-box" }, "🎁"),
      el("div", {}, el("strong", {}, "Vermeil left you a gift"), el("small", { class: "note" }, `Because: ${w.why.join(", ")}`)),
      el("button", { class: "primary", onclick: async () => {
        const r = await api.gift_open(w.id);
        if (r.error) return toast(r.error);
        celebrate(`+${r.gift.vcash} VCash`, [r.gift.note, `🎟 ${r.gift.treat}`], "🎁");
        refresh();
      } }, "Open it"));
  }

  async function draw() {
    if (!last) return;
    const tabs = el("div", { class: "tabs", role: "tablist" }, [["pass", "🏆 Battle Pass"], ["quests", "📜 Quests & badges"], ["habits", "💧 Habits"], ["year", "🎁 Your year"]]
      .map(([k, l]) => el("button", { role: "tab", "aria-selected": String(k === tab), onclick: () => { tab = k; draw(); } }, l)));
    const body = tab === "pass" ? drawPass() : tab === "quests" ? drawQuests() : tab === "year" ? await drawYear() : await drawHabits();
    root.replaceChildren(head(), await giftCard() || "", tabs, ...body);
  }

  // ---------- "+N XP", level up, rewards ----------
  function celebrate(title, lines, icon) {
    play("success");
    const box = el("div", { class: "quest-pop", role: "status" }, el("div", { class: "quest-pop-icon" }, icon),
      el("strong", {}, title), ...lines.map((l) => el("span", {}, l)));
    document.body.append(box);
    setTimeout(() => box.classList.add("out"), 3800);
    setTimeout(() => box.remove(), 4400);
  }

  window.addEventListener("quest", (ev) => {
    const e = ev.detail || {};
    if (!e.xp) return;
    const chip = el("div", { class: "xp-float" }, `+${e.xp} XP` + (e.why ? ` · ${e.why}` : ""));
    document.body.append(chip);
    setTimeout(() => chip.remove(), 2200);
    for (const q of e.quests_done || []) toast(`📜 Quest done: ${q.text} (+${q.xp} XP)`, 5000);
    if (e.rewards && e.rewards.length) {
      celebrate(`Tier ${e.tier} unlocked!`, e.rewards.map((r) => `${r.icon} ${r.name}` + (r.kind === "title" ? " (new title)" : " → Room → Decorate")), "🏆");
    } else if (e.level_up) {
      celebrate(`Level ${e.level}!`, ["Keep going — more rewards on the Battle Pass."], "⭐");
    }
    refresh();
  });

  window.addEventListener("gift", () => refresh());
  document.querySelector('[data-panel="pass"]')?.addEventListener("click", () => setTimeout(draw, 0));
  refresh();
  return { refresh };
}
