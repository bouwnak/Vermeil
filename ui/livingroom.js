// livingroom.js - the home screen's living parts (skills/roomlife.py on the Python side):
// the 🛒 VCash shop tab, saved room designs, ambient sounds, seasonal decorations, real weather on the window,
// room achievements, the Smart TV player and the weather clock's forecast. app.js calls initLivingRoom().
import { roomHooks, SHOP_SETS, THEME_NAMES, AMBIENT_SOUNDS, ambient } from "./shop.js";

const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const btn = (text, click, props = {}) => { const b = el("button", { type: "button", textContent: text, ...props }); b.addEventListener("click", click); return b; };

export const TIPS = [
  "Tip: press ✏️ Edit room, then 🛒 Shop to spend your VCash on furniture.",
  "Tip: every XP you earn also gives you half as much VCash.",
  "Tip: the focus plant grows every day you focus.",
  "Tip: click the weather clock on the wall for the 5-day forecast.",
  "Vermeil: \"Ready when you are!\"",
];

// turn a YouTube/video link into something the TV can play inside the app
export function videoEmbed(url) {
  const u = (url || "").trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { kind: "iframe", src: `https://www.youtube.com/embed/${yt[1]}?autoplay=1` };
  const list = u.match(/[?&]list=([\w-]+)/);
  if (list) return { kind: "iframe", src: `https://www.youtube.com/embed/videoseries?list=${list[1]}&autoplay=1` };
  if (/^https?:\/\/.+\.(mp4|webm|ogg)(\?|$)/i.test(u)) return { kind: "video", src: u };
  if (/^https?:\/\//i.test(u)) return { kind: "iframe", src: u };
  return null;
}

export function initLivingRoom({ api, room, toast, openPanel, rerender }) {
  const live = { vcash: 0, owned: [], season: null, weekly: [], achievements: [], decor: "none" };
  roomHooks.api = api;
  roomHooks.open = (kind, data) => {
    if (kind === "tv") return openTv(data);
    if (kind === "forecast") return openForecast(data);
    if (kind === "planner") return openPanel("planner");
  };

  // ---------- popups ----------
  const pop = el("div", { className: "live-pop", hidden: true });
  pop.setAttribute("role", "dialog");
  document.body.append(pop);
  const closePop = () => { pop.hidden = true; pop.replaceChildren(); };
  const showPop = (title, ...kids) => { pop.replaceChildren(el("div", { className: "live-pop-card" }, [el("div", { className: "live-pop-head" }, [el("strong", { textContent: title }), btn("✕", closePop, { className: "ghost", ariaLabel: "Close" })]), ...kids])); pop.hidden = false; };
  pop.addEventListener("click", (e) => { if (e.target === pop) closePop(); });

  function openTv({ last, save }) {
    const input = el("input", { type: "url", placeholder: "Paste a YouTube link or a video link", value: last || "" });
    const screen = el("div", { className: "tv-screen" });
    const play = () => {
      const v = videoEmbed(input.value);
      if (!v) return toast("Paste a YouTube or video link first.");
      screen.replaceChildren(v.kind === "video" ? el("video", { src: v.src, controls: true, autoplay: true })
        : el("iframe", { src: v.src, allow: "autoplay; encrypted-media; picture-in-picture", allowFullscreen: true }));
      save(input.value.trim());
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") play(); });
    showPop("📺 Smart TV", el("div", { className: "live-row" }, [input, btn("▶ Play", play, { className: "primary" }), btn("■ Stop", () => { screen.replaceChildren(); save(""); })]), screen);
    if (last) play();
  }

  function openForecast(wx) {
    if (!wx || wx.error) return showPop("🌦️ Forecast", el("p", { className: "note", textContent: wx?.error || "Loading the weather… try again in a moment." }));
    const icon = (t) => ({ rain: "🌧️", snow: "❄️", storm: "⛈️", fog: "🌫️", cloudy: "☁️", clear: "☀️" }[kindOf(t)]);
    showPop(`🌦️ ${wx.place}`, el("p", { textContent: `Now: ${Math.round(wx.temp_c)}°C, ${wx.text}` }),
      el("div", { className: "forecast" }, wx.days.map((d) => el("div", { className: "fc-day" }, [
        el("b", { textContent: new Date(d.date + "T12:00").toLocaleDateString([], { weekday: "short" }) }),
        el("span", { className: "fc-icon", textContent: icon(d.text) }), el("span", { textContent: `${Math.round(d.max_c)}° / ${Math.round(d.min_c)}°` }),
        el("small", { textContent: `${d.rain_chance}% rain` })]))),
      ...(wx.alerts || []).map((a) => el("p", { className: "note warn", textContent: `⚠ ${a.headline}` })));
  }
  const kindOf = (t) => { t = (t || "").toLowerCase(); return /thunder|storm/.test(t) ? "storm" : /snow|sleet|ice/.test(t) ? "snow" : /rain|drizzle|shower/.test(t) ? "rain" : /fog|mist|haze/.test(t) ? "fog" : /cloud|overcast/.test(t) ? "cloudy" : "clear"; };

  // ---------- what changes by itself: decorations, weather, VCash ----------
  async function refresh() {
    try {
      const x = await api.room_extras(SHOP_SETS);
      Object.assign(live, x);
      live.weekly = weeklyPick();
      if (!room.gym) room.cozy.setDecor(x.decor);
    } catch (e) { console.warn("room extras", e); }
  }
  async function weather() {
    try { const w = await api.room_weather(); room.cozy.setWeather(w?.error ? "clear" : w.kind); } catch { /* offline: clear skies */ }
  }
  refresh(); weather();
  setInterval(weather, 30 * 60 * 1000);
  setInterval(() => { if (room.cozy.decor) room.cozy.decor.visible = !room.gym; }, 1500);

  // this week's shop: the season's whole set + 6 others (same pick all week, like skills/quest.py weekly_pick)
  function weeklyPick() {
    const theme = live.season?.theme;
    const others = Object.entries(SHOP_SETS).filter(([t]) => t !== theme).flatMap(([, keys]) => keys).sort();
    const d = new Date(), wk = Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 6048e5);
    let seed = d.getFullYear() * 100 + wk;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    return [...(SHOP_SETS[theme] || []), ...others.map((k) => [rnd(), k]).sort((a, b) => a[0] - b[0]).slice(0, 6).map(([, k]) => k)];
  }

  // ---------- the 🛒 shop tab (renderCatalog calls these) ----------
  function shopHeader() {
    const got = live.achievements.filter((a) => a.got).length;
    return el("div", { className: "shop-head" }, [
      el("span", { className: "vcash", textContent: `💎 ${live.vcash} VCash` }),
      el("span", { textContent: live.season ? `${live.season.name}: its set is on sale all month` : "" }),
      el("details", { className: "achv" }, [el("summary", { textContent: `🏅 Room achievements ${got}/${live.achievements.length}` }),
        ...live.achievements.map((a) => el("div", { textContent: `${a.got ? "✅" : "⬜"} ${a.name}` }))])]);
  }
  function shopCard(type, def, b) {
    const owned = live.owned.includes(type), onSale = live.weekly.includes(type);
    if (owned) { b.textContent = `${def.label} ✓`; return null; }
    b.classList.add("locked");
    b.textContent = `${THEME_NAMES[def.theme]?.split(" ")[0] || ""} ${def.label} · 💎 ${def.price}${onSale ? "" : " (not this week)"}`;
    b.disabled = !onSale;
    b.addEventListener("click", async (e) => {
      e.stopImmediatePropagation();
      if (!confirm(`Buy ${def.label} for ${def.price} VCash?`)) return;
      const r = await api.quest_buy(type, def.price, def.label);
      if (r.error) return toast(r.error);
      live.vcash = r.vcash; live.owned = r.owned;
      room.addItem(type);
      toast(`${def.label} is yours! 💎 ${r.vcash} VCash left.`);
      refresh().then(rerender);
    }, { capture: true });
    return b;
  }
  const shopOrder = (a, b) => (live.weekly.includes(b.type) - live.weekly.includes(a.type)) || (a.def.theme === live.season?.theme ? -1 : 0) || a.def.price - b.def.price;

  // ---------- 💾 Designs: several saved room designs ----------
  async function renderDesigns(pane) {
    const list = await api.room_presets();
    const name = el("input", { placeholder: "Name this design", maxLength: 40 });
    pane.replaceChildren(el("div", { className: "live-row" }, [name, btn("💾 Save this room", async () => {
      const r = await api.room_preset_save(name.value || `Design ${list.length + 1}`, room.layout());
      if (r.error) return toast(r.error);
      toast("Saved the room design."); renderDesigns(pane);
    }, { className: "primary" })]),
    ...list.map((p) => el("div", { className: "edit-card design" }, [el("b", { textContent: p.name }), el("small", { textContent: ` ${p.items} things · ${p.saved} ` }),
      btn("Load", async () => { const r = await api.room_preset_load(p.name); if (r.layout) { room.loadLayout(r.layout); room.onLayoutChange?.(); toast(`Loaded ${p.name}.`); } }),
      btn("✕", async () => { if (confirm(`Delete the design "${p.name}"?`)) { await api.room_preset_delete(p.name); renderDesigns(pane); } }, { className: "danger" })])),
    list.length ? "" : el("p", { className: "note", textContent: "No saved designs yet. Save this room, change it, then switch between them here." }));
  }

  // ---------- 🔊 Sounds: ambient sounds per room with a volume ----------
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("ambient") || "{}"); } catch { /* ignore */ }
  const pick = () => (room.gym ? saved.gym : saved.home) || "off";
  let playing = null;
  setInterval(() => { const k = pick(); if (k !== playing) { playing = k; ambient.play(k, saved.volume ?? 0.4); } }, 1500);
  function renderSounds(pane) {
    const sel = el("select", {}, Object.entries(AMBIENT_SOUNDS).map(([k, label]) => el("option", { value: k, textContent: label, selected: k === pick() })));
    sel.setAttribute("aria-label", "Ambient sound for this room");
    sel.addEventListener("change", () => { saved[room.gym ? "gym" : "home"] = sel.value; store(); playing = null; });
    const vol = el("input", { type: "range", min: 0, max: 100, value: Math.round((saved.volume ?? 0.4) * 100) });
    vol.setAttribute("aria-label", "Ambient volume");
    vol.addEventListener("input", () => { saved.volume = vol.value / 100; ambient.setVolume(saved.volume); store(); });
    pane.replaceChildren(el("label", { className: "inline" }, [`${room.gym ? "🏋 Gym" : "🏠 Room"} sound `, sel]), el("label", { className: "inline" }, ["Volume ", vol]),
      el("p", { className: "note", textContent: "Each room keeps its own sound. Made on your computer, no internet needed." }));
  }
  const store = () => { try { localStorage.setItem("ambient", JSON.stringify(saved)); } catch { /* ignore */ } };

  return { live, refresh, shopHeader, shopCard, shopOrder, renderDesigns, renderSounds };
}
