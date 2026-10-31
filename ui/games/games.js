// games.js - the Games hub: Adventure (the Dungeon RPG) and Retro Games (classic games from retrogames.cc).
// Inside Vermeil it talks to Python through window.pywebview.api.retro_*; in a normal browser (testing) add ?bridge.
import { startWaves, wireSounds, musicStart, musicStop, setMuted, isMuted } from "./hubfx.js";
const $ =(id) => document.getElementById(id);
const isTest = new URLSearchParams(location.search).has("bridge");
const keep = isTest ? "?bridge" : "";          // stay in test mode when moving between pages

function pywebview() {
  return new Promise((resolve) => {
    if (window.pywebview?.api) return resolve(window.pywebview.api);
    window.addEventListener("pywebviewready", () => resolve(window.pywebview.api), { once: true });
    setTimeout(() => resolve(window.pywebview?.api || null), 4000);
  });
}
let apiP = null;
async function call(name, ...args) {
  try {
    if (isTest) {
      const r = await fetch(`/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
      return r.ok ? r.json() : { error: `server error ${r.status}` };
    }
    apiP ||= pywebview();
    const api = await apiP;
    if (!api?.[name]) return { error: "Games need the Vermeil app (open them from the sidebar)." };
    return await api[name](...args);
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// ---------------- the same colours as Vermeil (app.js saves your theme before opening this page) ----------------
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (h, k) => { const [r, g, b] = hexRgb(h).map((v) => Math.round(Math.min(255, Math.max(0, v + (k > 0 ? (255 - v) * k : v * k))))); return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`; };
function applyTheme() {
  let t = null;
  try { t = JSON.parse(localStorage.getItem("vermeil_theme") || "null"); } catch { /* ignore */ }
  if (!t?.accent || !t?.bg || !t?.panel) return;               // the default (Midnight blue) is already in games.css
  const light = t.light || hexRgb(t.bg).reduce((a, b) => a + b, 0) > 384;
  const r = document.documentElement.style, [ar, ag, ab] = hexRgb(t.accent);
  r.setProperty("--blue", t.accent); r.setProperty("--accent-rgb", `${ar}, ${ag}, ${ab}`);
  r.setProperty("--blue-soft", `rgba(${ar},${ag},${ab},0.14)`); r.setProperty("--blue-glow", `rgba(${ar},${ag},${ab},0.45)`);
  r.setProperty("--black", t.bg); r.setProperty("--plum-2", mixHex(t.bg, light ? -0.06 : 0.08));
  r.setProperty("--paper", t.panel); r.setProperty("--raised", mixHex(t.panel, light ? -0.05 : 0.07));
  r.setProperty("--line", mixHex(t.panel, light ? -0.15 : 0.16)); r.setProperty("--line-2", mixHex(t.panel, light ? -0.25 : 0.26));
  r.setProperty("--ink", light ? "#1b1f27" : "#e6e9ee"); r.setProperty("--strong", light ? "#0d1117" : "#ffffff"); r.setProperty("--muted", light ? "#5b6472" : "#8b929d");
  r.colorScheme = light ? "light" : "dark";
}
applyTheme();
const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--blue").trim() || "#3e8eff";

// ---------------- loading screen ----------------
const loader = {
  show(title, sub = "Getting the game ready", image = "") {
    $("loadingTitle").textContent = title; $("loadingSub").textContent = sub;
    // the game's cover art as a faded background
    const art = $("loadingArt");
    art.classList.remove("on"); art.style.backgroundImage = "";
    if (image) {
      const safeUrl = `url("${image.replace(/"/g, "%22")}")`;
      art.style.backgroundImage = safeUrl;
      const pic = new Image();
      pic.referrerPolicy = "no-referrer";
      pic.onload = () => { if (!$("loading").hidden) { art.style.backgroundImage = safeUrl; art.classList.add("on"); } };
      pic.src = image;
      if (pic.complete) art.classList.add("on");
    }
    $("loadingFill").style.width = "8%";
    $("loading").classList.remove("out"); $("loading").hidden = false;
  },
  sub(text) { $("loadingSub").textContent = text; },
  progress(p) { $("loadingFill").style.width = `${Math.round(p * 100)}%`; },
  hide() {
    this.progress(1);
    $("loading").classList.add("out");
    setTimeout(() => { if ($("loading").classList.contains("out")) $("loading").hidden = true; }, 380);
  },
};

function show(view) {
  $("hub").hidden = view !== "hub"; $("retro").hidden = view !== "retro";
  window.scrollTo(0, 0);
}

function thumbImg(src, alt) {
  const img = document.createElement("img");
  img.alt = alt; img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
  if (src) img.src = src;
  return img;
}

// ---------------- the hub ----------------
startWaves();
wireSounds();
const paintMusic = () => { $("musicBtn").textContent = isMuted() ? "🔇" : "🎵"; $("musicBtn").setAttribute("aria-pressed", String(!isMuted())); };
$("musicBtn").onclick = () => { setMuted(!isMuted()); if (!isMuted()) musicStart(); paintMusic(); };
paintMusic();
$("backApp").onclick = () => { musicStop(0.3); location.href = "../index.html"; };
$("cardAdventure").onclick = () => { $("confirm").hidden = false; $("confirmYes").focus(); };
$("confirmNo").onclick = () => { $("confirm").hidden = true; $("cardAdventure").focus(); };
$("confirm").onclick = (e) => { if (e.target === $("confirm")) $("confirmNo").click(); };
$("confirmYes").onclick = () => {
  $("confirm").hidden = true;
  musicStop(0.3);                                  // the Adventure has its own music
  loader.show("Opening the Dungeon Adventure…", "Loading the world", "img/adventure.jpg");
  loader.progress(0.4);
  setTimeout(() => { location.href = `../game/index.html${keep}`; }, 350);
};
$("cardRetro").onclick = () => { show("retro"); if (!rg.loaded) loadGames(); };
$("cardNight").onclick = () => { musicStop(0.3); location.href = `night.html${keep}`; };

// the big picture on the right follows the game you point at
function preview(which) {
  for (const p of document.querySelectorAll(".pv")) p.classList.toggle("on", p.dataset.pv === which);
}
for (const c of document.querySelectorAll(".hub-card")) {
  c.addEventListener("mouseenter", () => preview(c.dataset.preview));
  c.addEventListener("focus", () => preview(c.dataset.preview));
}
preview("adventure");

// ---------------- your own games (skills/mygames.py): a card each, and the ⇅ button to add / remove them ----------------
const mine = { games: [], found: [], busy: false };
function gameCard(g) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "hub-card" + (g.ok ? "" : " broken"); b.dataset.preview = "mine"; b.dataset.sfx = "open";
  b.innerHTML = `<span class="hub-art art-mine" aria-hidden="true">🎮</span><span class="hub-text"><b></b><small></small></span><span class="hub-go" aria-hidden="true">›</span>`;
  b.querySelector("b").textContent = g.name;
  b.querySelector("small").textContent = g.ok ? `Your game · opens in its own window · ${g.mb} MB` : "Its files are missing - remove it and add it again (⇅)";
  const point = () => { $("pvMineName").textContent = g.name; preview("mine"); };
  b.addEventListener("mouseenter", point);
  b.addEventListener("focus", point);
  b.onclick = async () => {
    if (!g.ok) { openGames(); return; }
    loader.show(`Starting ${g.name}…`, "It opens in its own window");
    loader.progress(0.6);
    const r = await call("games_launch", g.id);
    setTimeout(() => loader.hide(), 1400);
    if (r?.error) { loader.hide(); toast(r.error); }
  };
  return b;
}
function renderMine(res) {
  if (res && !res.error && res.games) { mine.games = res.games; mine.found = res.found || []; }
  $("myGames").replaceChildren(...mine.games.map(gameCard));
  const list = $("gamesList");
  list.replaceChildren(...mine.games.map((g) => {
    const li = document.createElement("li");
    li.innerHTML = `<span><b></b> <small></small></span><button class="btn danger small" type="button">Remove</button>`;
    li.querySelector("b").textContent = g.name;
    li.querySelector("small").textContent = g.ok ? `${g.mb} MB · added ${g.added || ""}` : "files missing";
    const btn = li.querySelector("button");
    btn.onclick = async () => {
      if (!btn.classList.contains("sure")) { btn.classList.add("sure"); btn.textContent = "Sure? Remove"; return; }
      btn.disabled = true;
      const r = await call("games_remove", g.id);
      if (r?.error) toast(r.error); else toast(`Removed ${g.name}${r.freed_mb ? ` (${r.freed_mb} MB freed)` : ""}`);
      renderMine(r);
    };
    return li;
  }));
  $("gamesFound").replaceChildren(...mine.found.map((f) => {
    const row = document.createElement("div");
    row.style.display = "contents";
    row.innerHTML = `<span>Found your game <b></b> on this PC.</span><button class="btn primary small" type="button">Add it</button>`;
    row.querySelector("b").textContent = f.name;
    row.querySelector("button").onclick = () => addGame("games_add_file", f.path);
    return row;
  }));
}
function gameBar(e) {
  const bar = $("gamesBar");
  clearTimeout(bar._hide);
  bar.hidden = false;
  bar.classList.toggle("bad", !!e.error);
  const pct = e.error ? 1 : Math.max(0, Math.min(1, e.pct || 0));
  bar.querySelector("i").style.width = `${Math.round(pct * 100)}%`;
  bar.querySelector("span").textContent = e.error || e.text || "";
  bar.querySelector("b").textContent = e.error ? "" : `${Math.round(pct * 100)}%`;
  bar.setAttribute("aria-valuenow", Math.round(pct * 100));
  if (pct >= 1 && !e.error) bar._hide = setTimeout(() => { bar.hidden = true; }, 1500);
}
window.onPyEvent = (e) => { if (e?.type === "game_progress") gameBar(e); };   // Python reports the copy / download here
async function addGame(name, arg) {
  if (mine.busy) return;
  mine.busy = true;
  for (const id of ["gamesPick", "gamesGet"]) $(id).disabled = true;
  const r = await call(name, arg);
  mine.busy = false;
  for (const id of ["gamesPick", "gamesGet"]) $(id).disabled = false;
  if (!r) return;                                           // the file picker was closed
  if (r.error) gameBar({ error: r.error });
  else { const names = r.added?.join(", ") || r.game.name; gameBar({ pct: 1, text: `Added ${names}` }); toast(`${names} ${r.added?.length > 1 ? "are" : "is"} in your Games hub`); $("gamesLink").value = ""; }
  renderMine(r);
}
async function openGames() {
  $("gamesDlg").hidden = false;
  $("gamesPick").focus();
  renderMine(await call("games_list"));
}
$("gamesBtn").onclick = openGames;
$("gamesClose").onclick = () => { if (!mine.busy) $("gamesDlg").hidden = true; };
$("gamesDlg").onclick = (e) => { if (e.target === $("gamesDlg")) $("gamesClose").click(); };
$("gamesPick").onclick = () => addGame("games_add_file");
$("gamesLinkForm").onsubmit = (e) => {
  e.preventDefault();
  const url = $("gamesLink").value.trim();                   // empty = the games in the Vermeil Google Drive folder
  if (url && !/^https?:\/\//i.test(url)) { gameBar({ error: "Paste a full link that starts with https://" }); return; }
  addGame("games_add_url", url);
};
call("games_list").then(renderMine);

// the Retro picture: a collage of the games inside, with RETRO across the middle
async function buildCollage() {
  const res = await call("retro_games", "", 1, "");
  const imgs = (res?.games || []).map((g) => g.image).filter(Boolean);
  if (!imgs.length) return;
  const tiles = Array.from({ length: 24 }, (_, i) => imgs[(i * 7) % imgs.length]);
  $("collage").replaceChildren(...tiles.map((src, i) => {
    const img = thumbImg(src, "");
    img.style.animationDelay = `${(i % 6) * 0.06 + Math.floor(i / 6) * 0.05}s`;
    img.onerror = () => { img.style.visibility = "hidden"; };
    return img;
  }));
}
buildCollage();

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("confirm").hidden) $("confirmNo").click();
  else if (!$("gamesDlg").hidden) $("gamesClose").click();
  else if (!$("stage").hidden) poke();
});

// ---------------- Retro Games ----------------
// platform is a console id, or "recent" / "favorites" (your own lists)
const rg = { platform: "", page: 1, query: "", games: [], platforms: {}, more: false, loaded: false, busy: false, playing: null,
             lib: { recent: [], favorites: [] } };
const LISTS = { recent: "Recently Played", favorites: "Favorites", downloads: "Downloaded Games" };
const LIST_ICON = { recent: "⟲", favorites: "♥", downloads: "⬇" };
const LIST_SHORT = { recent: "Recent", favorites: "Favorites", downloads: "Downloaded" };
const platformName = (id) => LISTS[id] || Object.values(rg.platforms).flat().find(([p]) => p === id)?.[1] || id;
const isFav = (g) => rg.lib.favorites.some((f) => f.url === g.url);
const hasSave = (g) => rg.lib.recent.concat(rg.lib.favorites).some((f) => f.url === g.url && f.saved);

async function loadLibrary() {
  const lib = await call("retro_library");
  if (lib && !lib.error) rg.lib = { recent: lib.recent || [], favorites: lib.favorites || [] };
  return rg.lib;
}

function renderNav() {
  const mine = Object.entries(LISTS).map(([id, name]) => {
    const g = document.createElement("div");
    g.className = "rg-group mine";
    g.classList.toggle("on", rg.platform === id);
    const b = document.createElement("button");
    b.type = "button"; b.textContent = `${LIST_ICON[id]} ${LIST_SHORT[id]}`;
    b.onclick = () => pick(id);
    g.append(b);
    return g;
  });
  const consoles = Object.entries(rg.platforms).map(([group, list]) => {
    const g = document.createElement("div");
    g.className = "rg-group";
    g.classList.toggle("on", list.some(([p]) => p === rg.platform));
    const top = document.createElement("button");
    top.type = "button"; top.textContent = group;
    top.onclick = () => { if (list.length === 1) pick(list[0][0]); };
    const drop = document.createElement("div");
    drop.className = "rg-drop";
    drop.append(...list.map(([p, name]) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = name; b.classList.toggle("on", p === rg.platform);
      b.onclick = () => { b.blur(); pick(p); };
      return b;
    }));
    g.append(top, drop);
    return g;
  });
  $("rgNav").replaceChildren(...mine, ...consoles);
}

function renderSide() {
  const lists = Object.entries(LISTS).map(([id, name]) => [id, `${LIST_ICON[id]} ${name}`]);
  $("rgSide").replaceChildren(...lists.concat(Object.values(rg.platforms).flat()).map(([p, name]) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = name; b.classList.toggle("on", p === rg.platform);
    if (LISTS[p]) b.classList.add("mine");
    b.onclick = () => pick(p);
    return b;
  }));
}

function card(g) {
  const c = document.createElement("div");
  c.className = "rg-card"; c.tabIndex = 0; c.setAttribute("role", "button"); c.title = `Play ${g.title}`;
  const thumb = document.createElement("div");
  thumb.className = "rg-thumb";
  const img = thumbImg(g.image, g.title);
  img.onerror = () => { img.remove(); thumb.insertAdjacentHTML("afterbegin", '<span class="noimg">🎮</span>'); };
  const stats = document.createElement("div");
  stats.className = "rg-stats";
  const tag = document.createElement("span"); tag.className = "rg-tag"; tag.textContent = g.platform || "Game";
  const likes = document.createElement("span"); likes.className = "rg-likes"; likes.textContent = (g.likes || 0).toLocaleString();
  stats.append(tag, likes);
  const btn = document.createElement("span"); btn.className = "rg-play"; btn.textContent = "Play";
  const fav = document.createElement("button");
  fav.type = "button"; fav.className = "rg-fav";
  const paintFav = () => {
    const on = isFav(g);
    fav.classList.toggle("on", on); fav.textContent = on ? "♥" : "♡";
    fav.title = on ? "Remove from favorites" : "Add to favorites"; fav.setAttribute("aria-pressed", String(on));
  };
  paintFav();
  fav.onclick = async (e) => {
    e.stopPropagation();
    await toggleFav(g);
    paintFav();
    if (rg.platform === "favorites" && !isFav(g)) c.remove();
  };
  thumb.append(img, stats, btn, fav);
  if (hasSave(g)) {
    const s = document.createElement("span"); s.className = "rg-saved"; s.textContent = "Saved";
    s.title = "You have a save - it loads when you play";
    thumb.append(s);
  }
  const name = document.createElement("div"); name.className = "rg-name"; name.textContent = g.title;
  c.append(thumb, name);
  c.onclick = () => play(g, thumb);
  c.onkeydown = (e) => { if ((e.key === "Enter" || e.key === " ") && e.target === c) { e.preventDefault(); play(g, thumb); } };
  return c;
}

async function toggleFav(g) {
  const res = await call("retro_favorite", g, !isFav(g));
  if (res && !res.error) rg.lib = { recent: res.recent || [], favorites: res.favorites || [] };
}

function skeletons(n = 12) {
  return Array.from({ length: n }, () => {
    const d = document.createElement("div");
    d.className = "rg-card skeleton";
    d.innerHTML = '<div class="rg-thumb"></div><div class="rg-name"></div>';
    return d;
  });
}

function heading() {
  if (rg.query) return `Search: “${rg.query}”`;
  if (LISTS[rg.platform]) return LISTS[rg.platform];
  if (rg.platform) return `${platformName(rg.platform)} Games`;
  return "Most Popular Games";
}

function showMsg(text, retry) {
  $("rgMsg").hidden = false;
  $("rgMsg").replaceChildren(document.createTextNode(text));
  if (retry) {
    const b = document.createElement("button");
    b.className = "btn"; b.type = "button"; b.textContent = "Try again"; b.onclick = retry;
    $("rgMsg").append(document.createElement("br"), b);
  }
}

// ---------------- Downloaded Games: what's on this PC, and deleting it ----------------
const size = (n) => n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : mb(n);

function downloadRow(g) {
  const row = document.createElement("div");
  row.className = "rg-dl";
  const noImg = () => Object.assign(document.createElement("span"), { className: "noimg", textContent: "🎮" });
  const img = g.image ? thumbImg(g.image, g.title) : noImg();
  img.onerror = () => img.replaceWith(noImg());
  const text = document.createElement("div");
  text.className = "rg-dl-text";
  const name = document.createElement("b"); name.textContent = g.title;
  const info = document.createElement("small"); info.textContent = `${g.platform || "Game"} · ${size(g.size)}`;
  text.append(name, info);
  const playB = document.createElement("button");
  playB.type = "button"; playB.className = "btn small"; playB.textContent = "Play";
  playB.disabled = !g.url;
  if (!g.url) playB.title = "Find this game in the list to play it";
  playB.onclick = () => play(g, row);
  const del = document.createElement("button");
  del.type = "button"; del.className = "btn ghost small danger"; del.textContent = "Delete";
  del.onclick = () => askThenDelete(del, g.id, "Delete");
  row.append(img, text, playB, del);
  return row;
}

// press once -> "Sure?", press again within 3 seconds -> deleted
async function askThenDelete(btn, gid, label) {
  if (!btn.classList.contains("sure")) {
    btn.classList.add("sure"); btn.textContent = "Sure? Press again";
    setTimeout(() => { if (btn.isConnected) { btn.classList.remove("sure"); btn.textContent = label; } }, 3000);
    return;
  }
  btn.disabled = true; btn.textContent = "Deleting…";
  const res = await call("retro_delete", gid);
  if (res?.error) { btn.disabled = false; btn.classList.remove("sure"); btn.textContent = label; return showMsg(res.error); }
  renderDownloads(res);
}

function renderDownloads(res) {
  const games = res.games || [];
  rg.games = games;
  $("rgGrid").classList.add("dl");
  $("rgGrid").replaceChildren(...games.map(downloadRow));
  $("rgCount").textContent = games.length ? `${games.length} games · ${size(res.total || 0)} on this PC` : "";
  $("rgDeleteAll").hidden = !games.length;
  $("rgMsg").hidden = true;
  if (!games.length) showMsg("No games downloaded yet. A game downloads the first time you play it. Your saves stay even if you delete a game.");
}
$("rgDeleteAll").onclick = () => askThenDelete($("rgDeleteAll"), "all", "Delete all");

async function loadGames(append = false) {
  if (rg.busy) return;
  $("rgMsg").hidden = true; $("rgMore").hidden = true;
  $("rgHeading").textContent = heading();
  $("rgGrid").classList.remove("dl");
  $("rgDeleteAll").hidden = true;
  if (rg.platform === "downloads") {
    $("rgGrid").replaceChildren(...skeletons(3));
    const res = await call("retro_downloads");
    if (rg.platform !== "downloads") return;
    if (res?.error) { $("rgGrid").replaceChildren(); return showMsg(res.error, () => loadGames()); }
    renderDownloads(res);
    if (!Object.keys(rg.platforms).length) {   // opened straight here: still fill the menus
      const top = await call("retro_games", "", 1, "");
      if (top?.platforms) rg.platforms = top.platforms;
    }
    renderNav(); renderSide();
    return;
  }
  rg.busy = true;
  if (!append) { $("rgGrid").replaceChildren(...skeletons()); $("rgCount").textContent = ""; }
  else { $("rgMore").hidden = false; $("rgMore").disabled = true; $("rgMore").textContent = "Loading…"; }
  const mine = LISTS[rg.platform];
  const [res] = await Promise.all([
    mine ? loadLibrary().then((lib) => ({ games: lib[rg.platform], more: false })) : call("retro_games", rg.platform, rg.page, rg.query),
    rg.loaded ? null : loadLibrary(),
  ]);
  rg.busy = false;
  $("rgMore").disabled = false; $("rgMore").textContent = "Load more games";
  if (res?.error) {
    if (!append) $("rgGrid").replaceChildren();
    showMsg(res.error, () => loadGames(append));
    return;
  }
  rg.loaded = true;
  if (res.platforms && !Object.keys(rg.platforms).length) rg.platforms = res.platforms;
  rg.games = append ? rg.games.concat(res.games) : res.games;
  rg.more = res.more;
  if (append) $("rgGrid").append(...res.games.map(card));
  else $("rgGrid").replaceChildren(...res.games.map(card));
  $("rgCount").textContent = `${rg.games.length} games`;
  if (!rg.games.length) {
    showMsg(rg.platform === "recent" ? "Nothing played yet. Pick a game and it shows up here."
      : rg.platform === "favorites" ? "No favorites yet. Press ♡ on a game to keep it here."
      : "No games found. Try another name.");
  }
  $("rgMore").hidden = !rg.more;
  renderNav();
  renderSide();
}

function pick(platform) {
  rg.platform = platform; rg.query = ""; rg.page = 1; $("rgQuery").value = "";
  window.scrollTo(0, 0);
  loadGames();
}
$("rgHome").onclick = () => pick("");
$("rgMore").onclick = () => { rg.page += 1; loadGames(true); };
$("rgSearch").onsubmit = (e) => {
  e.preventDefault();
  const q = $("rgQuery").value.trim();
  if (!q) return;
  rg.query = q; rg.platform = ""; rg.page = 1;
  loadGames();
};
$("rgBackHub").onclick = () => { show("hub"); $("cardRetro").focus({ preventScroll: true }); };

// zoom from the game's picture to the whole window, then the loading screen, then the game
function zoomFrom(el, image) {
  return new Promise((resolve) => {
    const r = el.getBoundingClientRect();
    const z = document.createElement("div");
    z.className = "zoomer";
    if (image) z.style.backgroundImage = `url("${image.replace(/"/g, "%22")}")`;
    Object.assign(z.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    document.body.append(z);
    z.getBoundingClientRect();                     // start from the card's spot...
    requestAnimationFrame(() => {
      z.classList.add("big");                      // ...and grow to fill the window
      Object.assign(z.style, { left: "0px", top: "0px", width: "100vw", height: "100vh" });
    });
    setTimeout(() => { resolve(); setTimeout(() => z.remove(), 120); }, 580);
  });
}

// ---------------- playing: our own player (no ads, starts by itself, full screen, saves kept by Python) ----------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
let playToken = 0;
let startWait = null;                              // resolves when the player says the game is running

// the player page (player.html, in the frame) calls these
window.retroHost = {
  call,
  accent,
  started(msg) { startWait?.(msg || ""); },
  saved() { if (rg.playing) markSaved(rg.playing); },
  failed(text) { startWait?.({ error: text }); },
  poke: (y) => poke(y),
};

function markSaved(g) {
  for (const f of rg.lib.recent.concat(rg.lib.favorites)) if (f.url === g.url) f.saved = true;
}

async function play(g, fromEl) {
  const token = ++playToken;
  const live = () => token === playToken;
  const cover = g.image || fromEl?.querySelector?.("img")?.src || "";
  await zoomFrom(fromEl, cover);
  loader.show(g.title, `${g.platform || "Retro"} · getting the game ready`, cover);
  let found = 0.08;                                // the website can take a few seconds to answer
  const finding = setInterval(() => { found = Math.min(0.14, found + 0.004); loader.progress(found); }, 400);
  loader.sub("Finding the game…");
  let info = await call("retro_prepare", g);
  clearInterval(finding);
  if (!live()) return;
  if (info?.error) return failPlay(info.error);

  // the game downloads to this PC first (only the first time you play it)
  for (let tries = 0, retried = false; ; tries++) {
    const p = await call("retro_progress", info.id, info.bios, info.parent || "");
    if (!live()) return;
    if (p?.error) {
      if (retried) return failPlay("Couldn't download the game. Check your internet and try again.");
      retried = true;
      info = await call("retro_prepare", g, true);
      if (!live()) return;
      if (info?.error) return failPlay(info.error);
      continue;
    }
    if (p?.done) break;
    const part = p?.total ? p.got / p.total : Math.min(0.9, tries * 0.02);
    loader.progress(0.15 + part * 0.6);
    loader.sub(p?.total ? `Downloading the game · ${mb(p.got)} of ${mb(p.total)}` : "Downloading the game…");
    await sleep(400);
  }

  loader.progress(0.8);
  loader.sub("Starting the game…");
  rg.playing = { ...g, id: info.id, image: cover, t0: Date.now() };
  try { sessionStorage.setItem("retro_cover", cover); } catch {}
  const q = new URLSearchParams({ core: info.core, rom: info.rom, bios: info.bios || "", parent: info.parent || "", id: info.id, name: g.title, image: cover });
  const frame = document.createElement("iframe");
  frame.title = g.title;
  frame.allow = "autoplay; fullscreen; gamepad";
  frame.allowFullscreen = true;
  frame.src = `player.html?${q}`;
  $("stTitle").textContent = g.title;
  paintStageFav();
  $("stMsg").hidden = true;
  $("stGame").replaceChildren(frame);
  $("stage").hidden = false;
  document.body.classList.add("playing");
  call("retro_fullscreen", true);

  // the emulator downloads its parts and starts; the loading screen stays until the game is really running
  let creep = 0.8;
  const tick = setInterval(() => { if (!live()) return clearInterval(tick); creep = Math.min(0.97, creep + 0.01); loader.progress(creep); }, 500);
  const res = await Promise.race([new Promise((r) => { startWait = r; }), sleep(90000).then(() => "")]);
  clearInterval(tick);
  startWait = null;
  if (!live()) return;
  if (res?.error) {
    $("stMsg").textContent = res.error; $("stMsg").hidden = false;
  }
  loader.hide();
  frame.focus({ preventScroll: true });
  poke();
  if (res && typeof res === "string") toast(res);
}

function failPlay(text) {
  loader.hide();
  showMsg(text);
  $("rgMsg").scrollIntoView({ block: "center", behavior: "smooth" });
}

function toast(text) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = text;
  if ($("stage").hidden) t.style.position = "fixed";          // on the hub (no game showing)
  ($("stage").hidden ? document.body : $("stage")).append(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3100);
}

// the bar over the game hides by itself; Esc or the mouse near the top shows it again
let barTimer = 0;
function poke(y) {
  if ($("stage").hidden || (y !== undefined && y > 90)) return;
  $("stageBar").classList.add("show");
  clearTimeout(barTimer);
  barTimer = setTimeout(() => { if (!$("stageBar").matches(":hover, :focus-within")) $("stageBar").classList.remove("show"); }, 2500);
}
$("stageBar").addEventListener("mouseleave", () => poke());
$("stage").addEventListener("mousemove", (e) => poke(e.clientY));

function paintStageFav() {
  const on = rg.playing && isFav(rg.playing);
  $("stFav").textContent = on ? "♥ Favorite" : "♡ Favorite";
  $("stFav").classList.toggle("on", !!on);
  $("stFav").setAttribute("aria-pressed", String(!!on));
}
$("stFav").onclick = async () => { if (rg.playing) { await toggleFav(rg.playing); paintStageFav(); } };

async function leaveGame(to = "retro") {
  playToken++;
  startWait = null;
  if (!$("loading").hidden) loader.hide();
  const frame = $("stGame").querySelector("iframe");
  if (frame) {
    // keep the game's own save before closing it (the Save button's saves are already kept)
    try { await Promise.race([frame.contentWindow.backupSram?.(), sleep(1500)]); } catch { /* the game never started */ }
  }
  $("stGame").replaceChildren();                   // removing the game stops its sound
  $("stage").hidden = true;
  document.body.classList.remove("playing");
  $("stageBar").classList.remove("show");
  call("retro_fullscreen", false);
  if (rg.playing?.t0) call("gn_record", "retro", Math.round((Date.now() - rg.playing.t0) / 1000));   // hours in the Game Night library
  rg.playing = null;
  await loadLibrary();
  if (to === "hub") { show("hub"); $("cardRetro").focus({ preventScroll: true }); return; }
  if (LISTS[rg.platform]) loadGames();             // your Recent / Favorites lists may have changed
  else if (rg.games.length) $("rgGrid").replaceChildren(...rg.games.map(card));   // same cards, fresh hearts + "Saved"
}
$("stBack").onclick = () => leaveGame("retro");
$("stHub").onclick = () => leaveGame("hub");

// opened as games/index.html?retro -> straight to Retro Games
if (new URLSearchParams(location.search).has("retro")) $("cardRetro").click();
