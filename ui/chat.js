// chat.js - the Chat panel: your messages (edit / delete / search), Our story, For you (recommendations), Screenshots.
import { $, el, toast, busy } from "./util.js";

const TABS = [["messages", "Messages"], ["story", "Our story"], ["foryou", "For you"], ["screens", "Screenshots"]];
const CATS = [["anything", "Surprise me"], ["movies", "🎬 Movies"], ["shows", "📺 Shows"], ["anime", "🌸 Anime"], ["books", "📚 Books"],
  ["games", "🎮 Games"], ["music", "🎵 Music"], ["food", "🍜 Food"], ["recipes", "🍳 Recipes"], ["activities", "🏃 Activities"],
  ["places", "📍 Places"], ["youtube", "▶ YouTube"], ["podcasts", "🎧 Podcasts"]];

export function initChat(api, herName = () => "Her") {
  let tab = "messages";
  let category = "anything";
  const tabs = $("chatTabs"), log = $("log"), other = $("chatOther"), searchRow = $("chatSearchRow");

  function drawTabs() {
    tabs.replaceChildren(...TABS.map(([id, label]) => el("button", {
      role: "tab", "aria-selected": String(tab === id), onclick: () => load(id) }, label)));
    log.hidden = searchRow.hidden = tab !== "messages";
    other.hidden = tab === "messages";
  }

  // ---------- messages ----------
  function messageItem(m) {
    const li = el("li", { class: m.who });
    const text = el("span", { class: "msg-text" }, m.text);
    li.append(el("span", { class: "who" }, m.who === "you" ? "You" : (herName() || "Her")), text);
    if (m.i == null) return li;
    const edit = () => {
      const box = el("textarea", { rows: 3 }, m.text);
      const save = async () => {
        const h = await api.chat_edit(m.i, box.value);
        renderMessages(h);
        toast("Message changed — she'll remember it this way.");
      };
      li.replaceChildren(box, el("div", { class: "row" },
        el("button", { class: "primary", onclick: save }, "Save"),
        el("button", { class: "ghost", onclick: () => li.replaceWith(messageItem(m)) }, "Cancel")));
      box.focus();
    };
    const del = async () => {
      if (!confirm(m.who === "you" ? "Delete this message and her reply?" : "Delete this message?")) return;
      renderMessages(await api.chat_delete(m.i, true));
      toast("Deleted from her memory.");
    };
    li.append(el("span", { class: "msg-tools" },
      el("button", { "aria-label": "Edit message", title: "Edit", onclick: edit }, "✎"),
      el("button", { "aria-label": "Delete message", title: "Delete", onclick: del }, "×")));
    return li;
  }

  function renderMessages(history) {
    log.replaceChildren();
    if (!history?.length) { log.append(el("li", { class: "empty" }, "Nothing yet. Say hi!")); return; }
    for (const m of history) log.append(messageItem(m));
    log.lastElementChild?.scrollIntoView({ block: "end" });
  }

  $("chatSearch").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim();
    if (!q) { load("messages"); return; }
    const hits = await api.chat_search(q);
    log.replaceChildren(el("li", { class: "empty" }, `Results for “${q}” — chats, journal, notes, study files and screenshots:`),
      ...(hits.length ? hits.map((h) => el("li", { class: "her hit" }, el("small", {}, `${h.source}${h.date ? " · " + h.date : ""}`), el("span", {}, h.text)))
        : [el("li", { class: "empty" }, "Nothing found.")]),
      el("li", { class: "empty" }, el("button", { class: "ghost", onclick: () => { e.target.value = ""; load("messages"); } }, "Back to messages")));
  });

  // ---------- our story ----------
  async function drawStory() {
    const s = await api.our_story();
    const stat = (n, label) => el("div", { class: "story-stat" }, el("b", {}, String(n)), el("span", {}, label));
    const input = el("input", { placeholder: "Add a moment, e.g. We finished my thesis survey!", maxlength: 200 });
    const add = async () => { if (!input.value.trim()) return; await api.story_add(input.value.trim()); drawStory(); };
    input.addEventListener("keydown", (e) => e.key === "Enter" && add());
    other.replaceChildren(
      s.first_met ? el("p", { class: "note" }, `You first talked on ${new Date(s.first_met + "T00:00").toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}.`)
        : el("p", { class: "note" }, "Your story starts with your first chat."),
      el("div", { class: "story-stats" }, stat(s.days_known, "days known"), stat(s.days_talked, "days talked"), stat(s.messages, "messages"), stat(`${s.streak}🔥`, "day streak")),
      el("div", { class: "row" }, input, el("button", { onclick: add }, "Add")),
      el("ol", { class: "timeline" }, s.timeline.length ? s.timeline.map((t) => el("li", { class: t.type },
        el("span", { class: "when" }, t.date), el("span", { class: "what" }, `${t.type === "milestone" ? "★ " : "💛 "}${t.text}`),
        t.type === "moment" ? el("button", { class: "x", "aria-label": "Remove", onclick: async () => { await api.story_remove(t.text); drawStory(); } }, "×") : null))
        : el("li", { class: "none" }, "Milestones and moments will show up here.")));
  }

  // ---------- for you ----------
  function drawForYou(items) {
    const mood = el("input", { id: "recMood", placeholder: "Mood or occasion (optional), e.g. rainy night, date, after gym", maxlength: 80 });
    const go = el("button", { class: "primary" }, "Get picks");
    const list = el("ul", { class: "recs" });
    const fill = (its) => list.replaceChildren(...its.map((it) => {
      const li = el("li", {}, el("div", { class: "what" }, el("b", {}, it.title), el("small", {}, it.why)));
      const rate = (liked) => async () => { await api.rate_recommendation(it.title, liked); li.classList.add(liked ? "liked" : "disliked"); toast(liked ? "Noted — more like this." : "Got it, I'll skip things like that."); };
      li.append(el("button", { class: "x", title: "I like this", "aria-label": "Like", onclick: rate(true) }, "👍"),
        el("button", { class: "x", title: "Not for me", "aria-label": "Dislike", onclick: rate(false) }, "👎"));
      return li;
    }));
    go.addEventListener("click", async () => {
      busy(go, true, "Thinking…");
      const r = await api.recommend_ui(category, mood.value.trim());
      busy(go, false);
      if (r.error) return toast(r.error, 5000);
      fill(r.items);
    });
    other.replaceChildren(
      el("p", { class: "note" }, "Picks based on what she's learned you like. 👍 / 👎 teaches her."),
      el("div", { class: "chips" }, CATS.map(([id, label]) => el("button", { class: `chip${id === category ? " on" : ""}`,
        onclick: () => { category = id; drawForYou(); } }, label))),
      el("div", { class: "row" }, mood, go), list);
    if (items) fill(items);
  }

  // ---------- screenshots ----------
  async function drawScreens() {
    const items = await api.screens_list();
    const big = el("div", { class: "screen-big", hidden: true });
    other.replaceChildren(
      el("p", { class: "note" }, "Screens she looked at for you, so you can find them later (“the error I showed you last week”). Turn this off in Settings."),
      big,
      el("div", { class: "screens" }, items.length ? items.map((sc) => {
        const img = el("img", { alt: sc.question || "Screenshot", loading: "lazy" });
        api.screen_image(sc.file).then((b) => b && (img.src = `data:image/jpeg;base64,${b}`));
        const card = el("figure", {}, img, el("figcaption", {}, el("b", {}, sc.at), el("span", {}, sc.question || sc.text.slice(0, 80))),
          el("button", { class: "x", "aria-label": "Delete screenshot", onclick: async (e) => { e.stopPropagation(); await api.screen_delete(sc.file); drawScreens(); } }, "×"));
        card.addEventListener("click", () => {
          big.hidden = false;
          big.replaceChildren(el("img", { src: img.src, alt: "" }), el("p", {}, sc.text), el("button", { class: "ghost", onclick: () => (big.hidden = true) }, "Close"));
          big.scrollIntoView({ block: "start" });
        });
        return card;
      }) : el("p", { class: "none" }, "None yet. Ask “what's on my screen?” or press Ctrl+Alt+S.")));
  }

  async function load(t = tab) {
    tab = t;
    drawTabs();
    if (tab === "messages") return renderMessages(await api.chat_history());
    if (tab === "story") return drawStory();
    if (tab === "foryou") return drawForYou();
    if (tab === "screens") return drawScreens();
  }

  drawTabs();
  return { load, renderMessages, refreshStory: () => tab === "story" && !other.hidden && drawStory() };
}
