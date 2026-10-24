// mymusic.js - "Vermeil Music": your own Spotify-style app. Songs come from YouTube and play in Vermeil's player;
// playlists, Liked Songs and analyses are yours (data/my_music.json). Python side: skills/mymusic.py via api.mm(...).
import { $, el, toast, busy } from "./util.js";

const fmt = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
const TABS = [["library", "Your Library"], ["search", "Search"], ["recent", "Recent"], ["import", "Import"], ["lab", "Playlist Lab"], ["spotify", "Spotify"]];
const STYLES = [["similar", "Similar (same + similar artists)"], ["discover", "Discover (only new artists)"], ["mix", "Mix (some favourites + new)"],
  ["chill", "Chill version"], ["hype", "Hype / gym version"]];

export function initMyMusic(api) {
  const body = $("musicBody");
  const mm = (action, ...args) => api.mm(action, ...args);
  let tab = "library", openPl = null, lib = { playlists: [], liked: 0 }, now = null, lastSearch = "", results = [], pollId = null;
  const player = el("div", { class: "mm-player" });
  const tabs = el("nav", { class: "tabs", role: "tablist" });
  const view = el("div", { class: "mm-view" });
  const spBody = $("spotifyBody");             // the Spotify feature's content: shown in the Spotify tab
  body.replaceChildren(player, tabs, view);

  // ---------------- now playing ----------------
  function drawPlayer() {
    const s = now?.song;
    const pos = now?.position || 0, len = now?.length || 0;
    const heart = el("button", { class: `ic heart${now?.liked ? " on" : ""}`, title: "Like", "aria-label": "Like this song", disabled: !s,
      onclick: async () => { await mm("like", s, !now.liked); refresh(); } }, now?.liked ? "♥" : "♡");
    const bar = el("div", { class: "mm-bar", role: "slider", "aria-label": "Song position", "aria-valuenow": pos, "aria-valuemax": len, tabindex: 0,
      onclick: (e) => { if (!len) return; const r = bar.getBoundingClientRect(); cmd("seek", String(Math.round(len * (e.clientX - r.left) / r.width))); } },
      el("i", { style: `width:${len ? (100 * pos / len) : 0}%` }));
    player.replaceChildren(
      s?.thumb ? el("img", { src: s.thumb, alt: "" }) : el("div", { class: "mm-ph" }, "♪"),
      el("div", { class: "mm-what" }, el("b", {}, s ? s.title : "Nothing playing"), el("small", {}, s ? s.artist : "Pick a song or a playlist"),
        el("div", { class: "row mm-time" }, el("small", {}, fmt(pos)), bar, el("small", {}, fmt(len)))),
      el("div", { class: "mm-ctrl" }, heart,
        el("button", { class: "ic", title: "From the start", "aria-label": "Replay", onclick: () => cmd("replay") }, "⏮"),
        el("button", { class: "ic big", "aria-label": now?.paused || !now?.playing ? "Play" : "Pause",
          onclick: () => cmd(now?.paused ? "resume" : now?.playing ? "pause" : "resume") }, now?.playing && !now?.paused ? "⏸" : "▶"),
        el("button", { class: "ic", title: "Next", "aria-label": "Next song", onclick: () => cmd("skip") }, "⏭"),
        el("button", { class: "ic", title: "Shuffle the queue", "aria-label": "Shuffle queue", onclick: () => cmd("shuffle") }, "🔀"),
        el("button", { class: "ic", title: "Stop and clear the queue", "aria-label": "Stop", onclick: () => cmd("stop") }, "⏹")),
      now?.queue?.length ? el("details", { class: "mm-queue" }, el("summary", {}, `Up next (${now.queue.length})`), el("ol", {}, now.queue.map((q) => el("li", {}, q)))) : null);
  }
  async function cmd(a, v) { const r = await mm("cmd", a, v); if (r?.message) toast(r.message, 2500); setTimeout(refresh, 600); }
  async function refresh() { now = await mm("now"); if (!now.error) drawPlayer(); }

  // ---------------- song rows ----------------
  function songRow(s, i, list, ctx = {}) {
    const addSel = el("select", { class: "mm-add", "aria-label": `Add ${s.title} to a playlist`, onchange: async () => {
      const v = addSel.value; addSel.value = "";
      if (v === "__new") { const name = prompt("Name of the new playlist:"); if (!name) return; await mm("create", name, "", [s]); lib = await mm("library"); return toast(`Made “${name}” with this song.`); }
      if (v) { const r = await mm("add", v, [s]); toast(r.added ? "Added." : "It's already there."); lib = await mm("library"); }
    } }, el("option", { value: "" }, "＋ Playlist"), lib.playlists.filter((p) => p.id !== ctx.pid).map((p) => el("option", { value: p.id }, p.name)), el("option", { value: "__new" }, "New playlist…"));
    return el("li", { class: "mm-row" },
      el("span", { class: "n" }, String(i + 1)),
      s.thumb ? el("img", { src: s.thumb, alt: "", loading: "lazy" }) : el("span", { class: "mm-ph sm" }, "♪"),
      el("div", { class: "what", ondblclick: () => play(list, i) }, el("b", {}, s.title), el("small", {}, `${s.artist}${s.played ? ` · ${s.played}` : ""}`)),
      el("small", { class: "dur" }, s.duration ? fmt(s.duration) : ""),
      el("button", { class: "ic", title: "Play", "aria-label": `Play ${s.title}`, onclick: () => play(list, i, ctx.pid) }, "▶"),
      el("span", { class: "acts" },
      el("button", { class: "ic", title: "Add to queue", "aria-label": `Queue ${s.title}`, onclick: async () => { const r = await mm("queue_song", s); toast(r.message || r.error); } }, "≡＋"),
      el("button", { class: "ic", title: "Like", "aria-label": `Like ${s.title}`, onclick: async () => { await mm("like", s, true); toast("♥ Added to Liked Songs."); lib = await mm("library"); } }, "♡"),
      addSel,
      ctx.pid ? el("span", { class: "mm-edit" },
        el("button", { class: "ic", "aria-label": "Move up", disabled: i === 0, onclick: async () => { openPl = await mm("move", ctx.pid, i, i - 1); drawPlaylist(); } }, "↑"),
        el("button", { class: "ic", "aria-label": "Move down", disabled: i === list.length - 1, onclick: async () => { openPl = await mm("move", ctx.pid, i, i + 1); drawPlaylist(); } }, "↓"),
        el("button", { class: "ic x", "aria-label": `Remove ${s.title}`, onclick: async () => { openPl = await mm("remove", ctx.pid, i); drawPlaylist(); lib = await mm("library"); } }, "×")) : null));
  }
  async function play(list, i, pid) {
    const r = pid ? await mm("play_playlist", pid, i, false) : await mm("play_songs", list, i, false);
    toast(r.message || r.error); setTimeout(refresh, 1500);
  }
  const mosaic = (p, cls = "mm-cover") => p.id === "liked" ? el("div", { class: `${cls} liked` }, "♥") :
    p.covers?.length >= 4 ? el("div", { class: `${cls} grid` }, p.covers.slice(0, 4).map((c) => el("img", { src: c, alt: "" }))) :
      p.covers?.length ? el("div", { class: cls }, el("img", { src: p.covers[0], alt: "" })) : el("div", { class: cls, style: `background:${p.color}` }, "♪");

  // ---------------- tabs ----------------
  function drawTabs() {
    tabs.replaceChildren(...TABS.map(([k, l]) => el("button", { role: "tab", "aria-selected": String(k === tab && !openPl), onclick: () => { tab = k; openPl = null; load(); } }, l)));
  }

  async function load() {
    drawTabs();
    lib = await mm("library");
    if (openPl) return drawPlaylist();
    if (tab === "search") return drawSearch();
    if (tab === "recent") return drawRecent();
    if (tab === "import") return drawImport();
    if (tab === "lab") return drawLab();
    if (tab === "spotify") return drawSpotify();
    drawLibrary();
  }

  // ---------------- Spotify lives inside Music now (the old Spotify panel, moved into this tab) ----------------
  function drawSpotify() {
    if (spBody) view.replaceChildren(spBody);
    window.__spotifyPanel?.load?.();
  }

  function drawLibrary() {
    const card = (p) => el("button", { class: "mm-card", onclick: async () => { openPl = await mm("playlist", p.id); drawTabs(); drawPlaylist(); } },
      mosaic(p), el("b", {}, p.name), el("small", {}, p.id === "liked" ? `${p.count} songs` : `${p.count} songs · ${p.minutes} min`));
    view.replaceChildren(
      el("div", { class: "mm-grid" }, card({ id: "liked", name: "Liked Songs", count: lib.liked }), ...lib.playlists.map(card),
        el("button", { class: "mm-card new", onclick: async () => {
          const name = prompt("Name of the new playlist:"); if (!name) return;
          openPl = await mm("create", name, "", []); drawTabs(); drawPlaylist();
        } }, el("div", { class: "mm-cover" }, "＋"), el("b", {}, "New playlist"), el("small", {}, "Add songs from Search"))),
      lib.playlists.length ? null : el("p", { class: "note" }, "Tip: Import a YouTube playlist, or search songs and press “＋ Playlist”."));
  }

  function drawPlaylist() {
    const p = openPl;
    if (!p || p.error) { openPl = null; return load(); }
    const editable = p.id !== "liked";
    view.replaceChildren(
      el("div", { class: "mm-head", style: `--c:${p.color || "#1db954"}` }, mosaic(p, "mm-cover big"),
        el("div", {}, el("small", {}, "Playlist"), el("h3", {}, p.name), p.description ? el("p", { class: "note" }, p.description) : null,
          el("small", {}, `${p.count} songs${p.minutes ? ` · ${p.minutes} min` : ""}`))),
      el("div", { class: "row mm-actions" },
        el("button", { class: "mm-play", "aria-label": "Play", onclick: async () => { const r = await mm("play_playlist", p.id, 0, false); toast(r.message || r.error); setTimeout(refresh, 1500); } }, "▶"),
        el("button", { class: "ghost", onclick: async () => { const r = await mm("play_playlist", p.id, 0, true); toast(r.message || r.error); setTimeout(refresh, 1500); } }, "🔀 Shuffle"),
        editable ? el("button", { class: "ghost small", onclick: async () => { const n = prompt("New name:", p.name); if (n) { openPl = await mm("update", p.id, n, null); drawPlaylist(); } } }, "✎ Rename") : null,
        editable ? el("button", { class: "ghost small", onclick: () => { tab = "lab"; labPick = p.id; openPl = null; load(); } }, "🧪 Analyse / make similar") : null,
        editable ? el("button", { class: "danger small", onclick: async () => { if (!confirm(`Delete “${p.name}”?`)) return; await mm("delete", p.id); openPl = null; load(); } }, "🗑 Delete") : null,
        el("button", { class: "ghost small", onclick: () => { openPl = null; load(); } }, "← Back")),
      p.songs.length ? el("ol", { class: "mm-list" }, p.songs.map((s, i) => songRow(s, i, p.songs, { pid: p.id })))
        : el("p", { class: "none" }, "No songs yet. Use Search and press “＋ Playlist” on a song."));
  }

  function drawSearch() {
    const q = el("input", { type: "search", placeholder: "Songs, artists…", value: lastSearch, "aria-label": "Search songs" });
    const res = el("ol", { class: "mm-list" });
    const go = async () => {
      lastSearch = q.value.trim(); if (!lastSearch) return;
      res.replaceChildren(el("li", { class: "note" }, "Searching YouTube…"));
      const r = await mm("search", lastSearch, 15);
      if (r.error) return res.replaceChildren(el("li", { class: "warn" }, r.error));
      results = r;
      res.replaceChildren(...(r.length ? r.map((s, i) => songRow(s, i, r)) : [el("li", { class: "none" }, "Nothing found.")]));
    };
    q.addEventListener("keydown", (e) => e.key === "Enter" && go());
    view.replaceChildren(el("div", { class: "row" }, q, el("button", { onclick: go }, "Search")), res);
    if (lastSearch && results.length) res.replaceChildren(...results.map((s, i) => songRow(s, i, results))); else q.focus();
  }

  async function drawRecent() {
    view.replaceChildren(el("p", { class: "note" }, "Loading…"));
    const r = await mm("recent", 40);
    view.replaceChildren(r.length ? el("ol", { class: "mm-list" }, r.map((s, i) => songRow(s, i, r))) : el("p", { class: "none" }, "Nothing played yet."));
  }

  function drawImport() {
    const url = el("input", { placeholder: "https://www.youtube.com/playlist?list=…  or a YouTube Music playlist link", "aria-label": "YouTube playlist link" });
    const name1 = el("input", { placeholder: "Name (optional)", "aria-label": "Playlist name" });
    const text = el("textarea", { rows: 7, placeholder: "One song per line, e.g.\nEminem - Lose Yourself\nStronger by Kanye West\n(you can copy a song list from anywhere)", "aria-label": "Song list" });
    const name2 = el("input", { placeholder: "Name", value: "Imported list", "aria-label": "Playlist name" });
    const out = el("div");
    const b1 = el("button", { onclick: async () => {
      busy(b1, true, "Importing…"); const r = await mm("import_youtube", url.value.trim(), name1.value.trim() || null); busy(b1, false);
      if (r.error) return out.replaceChildren(el("p", { class: "warn" }, r.error));
      toast(`Imported “${r.name}” (${r.count} songs).`); openPl = r; drawTabs(); drawPlaylist();
    } }, "Import");
    const b2 = el("button", { onclick: async () => {
      busy(b2, true, "Finding songs…"); out.replaceChildren(el("p", { class: "note" }, "Finding each song on YouTube… (~1 s per song)"));
      const r = await mm("import_text", text.value, name2.value.trim() || "Imported list"); busy(b2, false);
      if (r.error) return out.replaceChildren(el("p", { class: "warn" }, r.error));
      toast(`Made “${r.name}” with ${r.count} songs${r.not_found?.length ? ` (${r.not_found.length} not found)` : ""}.`, 5000); openPl = r; drawTabs(); drawPlaylist();
    } }, "Make playlist");
    const spBox = el("div", { class: "mm-sp" }, el("p", { class: "note" }, "Loading your Spotify playlists…"));
    view.replaceChildren(
      el("h4", {}, "From your Spotify"), spBox,
      el("h4", {}, "From a YouTube / YouTube Music playlist"), el("div", { class: "row" }, url, b1), name1,
      el("h4", {}, "From a list of songs"), text, el("div", { class: "row" }, name2, b2), out);
    mm("spotify_playlists").then((r) => {
      if (r.error) return spBox.replaceChildren(el("p", { class: "warn" }, r.error));
      if (!r.connected) return spBox.replaceChildren(el("p", { class: "note" }, "Connect Spotify once (in the Spotify tab) and all your playlists show up here to import."),
        el("button", { class: "ghost small", onclick: () => { tab = "spotify"; load(); } }, "Open the Spotify tab"));
      spBox.replaceChildren(el("p", { class: "note" }, "Each song is found on YouTube so it plays right here (~1 s per song)."),
        el("div", { class: "mm-sp-list" }, r.playlists.map((p) => {
          const b = el("button", { class: "small", onclick: async () => {
            busy(b, true, "Importing…");
            const x = await mm("import_spotify", p.id, null);
            busy(b, false);
            if (x.error) return toast(x.error, 6000);
            toast(`Imported “${x.name}” (${x.count} songs${x.not_found?.length ? `, ${x.not_found.length} not found` : ""}).`, 5000);
            openPl = x; drawTabs(); drawPlaylist();
          } }, "Import");
          return el("div", { class: "mm-sp-row" }, p.image ? el("img", { src: p.image, alt: "" }) : el("span", { class: "mm-ph sm" }, p.id === "liked" ? "♥" : "♪"),
            el("div", {}, el("b", {}, p.name), el("small", {}, p.count != null ? `${p.count} songs` : p.id === "liked" ? "your liked songs (latest 50)" : "")), b);
        })));
    });
  }

  // ---------------- Playlist Lab ----------------
  let labPick = null;
  async function drawLab() {
    const sel = el("select", { "aria-label": "Playlist to analyse" }, el("option", { value: "" }, "Pick one of your playlists…"),
      el("option", { value: "liked", selected: labPick === "liked" }, "♥ Liked Songs"),
      lib.playlists.map((p) => el("option", { value: p.id, selected: p.id === labPick }, `${p.name} (${p.count})`)));
    const out = el("div", { class: "pl-out" });
    const go = async (fresh) => {
      labPick = sel.value; if (!labPick) return;
      let a = fresh ? null : await mm("analysis", labPick);
      if (!a || !a.stats) { out.replaceChildren(el("p", { class: "note" }, "Analysing… (~10-30 s)")); a = await mm("analyse", labPick); }
      if (a.error) return out.replaceChildren(el("p", { class: "warn" }, a.error));
      showAnalysis(out, a);
    };
    sel.addEventListener("change", () => go(false));
    view.replaceChildren(el("p", { class: "note" }, "See what a playlist is made of, then let Vermeil make a new one in the same style."),
      el("div", { class: "row" }, sel, el("button", { class: "ghost small", onclick: () => go(true) }, "↻ Analyse again")), out);
    if (labPick) go(false);
  }

  function bars(rows) {
    return el("div", { class: "pl-bars" }, rows.map(([label, pct, extra]) => el("div", { class: "pl-bar" },
      el("span", {}, label), el("i", {}, el("b", { style: `width:${Math.max(2, Math.min(100, pct))}%` })), el("small", {}, extra ?? `${pct}%`))));
  }

  function showAnalysis(out, a) {
    const s = a.stats, ai = a.ai || {};
    const tile = (n, l) => el("div", { class: "pl-tile" }, el("b", {}, String(n ?? "–")), el("small", {}, l));
    const style = el("select", { "aria-label": "Style" }, STYLES.map(([v, l]) => el("option", { value: v }, l)));
    const size = el("input", { type: "number", min: 5, max: 60, value: 25, "aria-label": "Songs" });
    const name = el("input", { placeholder: (ai.name_ideas || [])[0] || "Name (optional)", "aria-label": "Name" });
    const extra = el("input", { placeholder: "Anything else? e.g. “more OPM”, “only 2010s”", "aria-label": "Extra wishes" });
    const result = el("div");
    const make = el("button", { class: "primary", onclick: async () => {
      busy(make, true, "Picking songs…"); result.replaceChildren(el("p", { class: "note" }, "Vermeil is picking songs and finding them on YouTube… (~20-40 s)"));
      const r = await mm("make", a.id, +size.value, style.value, name.value, extra.value); busy(make, false);
      if (r.error) return result.replaceChildren(el("p", { class: "warn" }, r.error));
      toast(r.message, 5000); openPl = r; drawTabs(); drawPlaylist();
    } }, "✨ Make the playlist");
    out.replaceChildren(...[
      el("h3", {}, a.name), el("small", { class: "note" }, `analysed ${a.analysed}`),
      el("div", { class: "pl-tiles" }, tile(s.songs, "songs"), tile(`${s.total_minutes}m`, "long"), tile(s.artists, "artists"),
        tile(`${s.variety}%`, "variety"), tile(ai.energy != null ? `${ai.energy}/10` : "–", "energy"), ai.tempo ? tile(ai.tempo, "tempo") : null),
      ai.error ? el("p", { class: "warn" }, ai.error) : null,
      ai.vibe ? el("p", { class: "pl-vibe" }, ai.vibe) : null,
      (ai.moods || []).length ? el("div", { class: "row chips" }, ai.moods.map((m) => el("span", { class: "chip" }, m))) : null,
      (ai.genres || []).length ? el("div", {}, el("h4", {}, "Genres"), bars(ai.genres.map((g) => [g.name, +g.pct || 0]))) : null,
      (ai.eras || []).length ? el("div", {}, el("h4", {}, "Eras (estimated)"), bars(ai.eras.map((e) => [e.decade, +e.pct || 0]))) : null,
      s.top_artists.length ? el("h4", {}, "Top artists") : null,
      s.top_artists.length ? bars(s.top_artists.slice(0, 6).map((x) => [x.name, Math.round(100 * x.songs / s.top_artists[0].songs), `${x.songs}`])) : null,
      (ai.best_for || []).length ? el("p", { class: "note" }, `Good for: ${ai.best_for.join(", ")}`) : null,
      (ai.similar_artists || []).length ? el("p", { class: "note" }, `Sounds like: ${ai.similar_artists.join(", ")}`) : null,
      el("h4", {}, "Make a new playlist from it"),
      el("div", { class: "pl-form" }, el("label", {}, "Style", style), el("label", {}, "Songs", size), el("label", { class: "wide" }, "Name", name),
        el("label", { class: "wide" }, "Extra wishes", extra)),
      el("div", { class: "row" }, make), result].filter(Boolean));
  }

  return {
    load() { load(); refresh(); clearInterval(pollId); pollId = setInterval(() => { if (!$("panel-music").hidden) refresh(); else clearInterval(pollId); }, 1500); },
    openTab(k) { tab = k; openPl = null; load(); },
  };
}
