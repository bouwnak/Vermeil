// browser.js - 🌐 Browser panel (skills/vbrowser.py): Vermeil's own browser, a bit like Opera GX's side panel.
// A quick-sites strip on the left, the tabs, an address bar with back / forward / reload, and a Google-style
// start page (big search box, speed dial, recent pages). Each tab opens in a Vermeil browser window.
import { $, el, toast } from "./util.js";

const icon = (url) => `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(new URL(url).hostname)}`;

export function initBrowser(api) {
  const body = $("browserBody");
  let st = { tabs: [], dial: [], history: [] };
  let active = null;                                   // the tab the address bar drives (null = open a new tab)

  const addr = el("input", { class: "br-addr", placeholder: "Search Google or type a web address", "aria-label": "Address", spellcheck: "false" });
  const go = async (text, tab = active) => {
    if (!String(text || "").trim()) return;
    const r = await api.browse_inside(text, tab);
    if (r.error) return toast(r.error, 6000);
    active = r.id;
  };
  const nav = async (action, tab = active) => {
    if (tab == null) return toast("Open a tab first.");
    const r = await api.browser_nav(tab, action);
    if (r.error) toast(r.error);
  };
  const bar = el("form", { class: "br-bar", onsubmit: (e) => { e.preventDefault(); go(addr.value); } },
    el("button", { type: "button", class: "br-ic", title: "Back", "aria-label": "Back", onclick: () => nav("back") }, "◀"),
    el("button", { type: "button", class: "br-ic", title: "Forward", "aria-label": "Forward", onclick: () => nav("forward") }, "▶"),
    el("button", { type: "button", class: "br-ic", title: "Reload", "aria-label": "Reload", onclick: () => nav("reload") }, "⟳"),
    addr,
    el("button", { type: "submit", class: "primary small" }, "Go"));

  const tabsRow = el("div", { class: "br-tabs", role: "tablist", "aria-label": "Tabs" });
  const side = el("div", { class: "br-side", "aria-label": "Quick sites" });
  const start = el("div", { class: "br-start" });
  body.replaceChildren(el("div", { class: "br-wrap" }, side, el("div", { class: "br-main" }, tabsRow, bar, start)));

  function drawTabs() {
    tabsRow.replaceChildren(...st.tabs.map((t) => el("div", { class: `br-tab${t.id === active ? " on" : ""}`, role: "tab", "aria-selected": String(t.id === active),
      title: t.url, onclick: () => { active = t.id; addr.value = t.url; drawTabs(); nav("focus", t.id); } },
      el("img", { src: safeIcon(t.url), alt: "", onerror: (e) => e.target.remove() }),
      el("span", {}, t.title || t.host),
      el("button", { class: "br-x", "aria-label": `Close ${t.title}`, onclick: (e) => { e.stopPropagation(); nav("close", t.id); } }, "×"))),
    el("button", { class: "br-new", title: "New tab", "aria-label": "New tab", onclick: () => { active = null; addr.value = ""; drawTabs(); addr.focus(); } }, "+"));
  }

  function safeIcon(url) { try { return icon(url); } catch { return ""; } }

  function drawSide() {
    side.replaceChildren(...st.dial.slice(0, 8).map((d) => el("button", { class: "br-side-btn", title: d.name, "aria-label": d.name, onclick: () => go(d.url, null) },
      el("img", { src: safeIcon(d.url), alt: "", onerror: (e) => { e.target.replaceWith(d.name[0]); } }))));
  }

  function drawStart() {
    const q = el("input", { class: "br-search", placeholder: "Search Google or type a web address", "aria-label": "Search", spellcheck: "false" });
    const dialName = el("input", { placeholder: "Name", "aria-label": "Site name" });
    const dialUrl = el("input", { placeholder: "Address (e.g. canvas.com)", "aria-label": "Site address" });
    const addBox = el("form", { class: "br-dial-add", hidden: true, onsubmit: async (e) => {
      e.preventDefault();
      const r = await api.browser_dial("add", dialName.value, dialUrl.value);
      if (r.error) return toast(r.error);
      st = { ...st, ...r }; drawAll();
    } }, dialName, dialUrl, el("button", { class: "primary small" }, "Add"));
    start.replaceChildren(
      el("div", { class: "br-logo" }, el("b", {}, "Vermeil"), el("span", {}, " Search")),
      el("form", { class: "br-search-form", onsubmit: (e) => { e.preventDefault(); go(q.value, null); q.value = ""; } }, el("span", { "aria-hidden": "true" }, "🔍"), q),
      el("div", { class: "br-dial" }, ...st.dial.map((d) => el("div", { class: "br-dial-item", title: d.url },
        el("button", { class: "br-dial-go", onclick: () => go(d.url, null) },
          el("span", { class: "br-dial-ic" }, el("img", { src: safeIcon(d.url), alt: "", onerror: (e) => e.target.replaceWith(d.name[0]) })),
          el("small", {}, d.name)),
        el("button", { class: "br-x", "aria-label": `Remove ${d.name}`, onclick: async () => { st = { ...st, ...(await api.browser_dial("remove", "", d.url)) }; drawAll(); } }, "×"))),
        el("button", { class: "br-dial-go", onclick: () => { addBox.hidden = !addBox.hidden; dialUrl.focus(); } }, el("span", { class: "br-dial-ic" }, "+"), el("small", {}, "Add site"))),
      addBox,
      st.history.length ? el("div", { class: "br-hist" },
        el("div", { class: "row" }, el("h4", {}, "Recently visited"),
          el("button", { class: "ghost small", style: "margin-left:auto", onclick: async () => { st = { ...st, ...(await api.browser_dial("clear_history")) }; drawAll(); } }, "Clear")),
        el("ul", {}, st.history.slice(0, 10).map((h) => el("li", {}, el("button", { class: "br-hist-go", onclick: () => go(h.url, null) },
          el("img", { src: safeIcon(h.url), alt: "", onerror: (e) => e.target.remove() }), el("span", {}, h.title), el("small", {}, h.at))))))
        : null);
  }

  function drawAll() { drawTabs(); drawSide(); drawStart(); }

  window.addEventListener("browser", ({ detail }) => {
    st = { ...st, ...detail };
    if (active != null && !st.tabs.some((t) => t.id === active)) active = null;
    const cur = st.tabs.find((t) => t.id === active);
    if (cur && document.activeElement !== addr) addr.value = cur.url;
    drawAll();
  });

  return {
    async load() { try { st = await api.browser_state(); } catch { /* not in the app */ } drawAll(); },
  };
}
