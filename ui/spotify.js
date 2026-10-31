// spotify.js - the Spotify panel: connect, now playing (cover, progress, controls), search, playlists, liked, recent, top.
import { $, el, toast, busy } from "./util.js";

const fmt = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
const TABS = [["search", "Search"], ["playlists", "Playlists"], ["lab", "Playlist Lab"], ["liked", "Liked"], ["recent", "Recent"], ["top", "Your top"]];
const STYLES = [["similar", "Similar (same + similar artists)"], ["discover", "Discover (only new artists)"], ["mix", "Mix (some favourites + new)"],
  ["chill", "Chill version"], ["hype", "Hype / gym version"]];

export function initSpotify(api, { onState = () => {} } = {}) {
  const body = $("spotifyBody");
  let st = null;            // connection status
  let now = null;           // what's playing
  let fetchedAt = 0;
  let tab = "search";
  let liked = false;
  let lastSearch = "";
  let pollTimer = null;

  // ---------- connect screen ----------
  function drawSetup() {
    const id = el("input", { placeholder: "Client ID (32 letters/numbers)", autocomplete: "off", spellcheck: "false" });
    const secret = el("input", { type: "password", placeholder: "Client secret", autocomplete: "off" });
    const uri = el("code", { class: "copy" }, st.redirect_uri);
    const save = el("button", { class: "ghost" }, "Save keys to my env file");
    save.addEventListener("click", async () => {
      const r = await api.spotify_save_keys(id.value, secret.value);
      if (r.error) return toast(r.error, 6000);
      st = r; toast(`Saved in your ${r.env_file} file.`); draw();
    });
    const connect = el("button", { class: "primary sp", disabled: !st.has_keys }, "Connect Spotify");
    connect.addEventListener("click", async () => {
      busy(connect, true, "Waiting for Spotify…");
      const r = await api.spotify_connect();
      if (r.error) { busy(connect, false); toast(r.error, 7000); }
      else toast("Finish in the Spotify page that opened in your browser.", 6000);
    });
    body.replaceChildren(...[
      el("div", { class: "sp-hero" }, el("div", { class: "sp-logo", "aria-hidden": "true" }, "♫"),
        el("div", {}, el("h3", {}, "Connect your Spotify"), el("p", { class: "note" }, "One-time setup, about 3 minutes. Needs Spotify Premium (Spotify's rule for apps)."))),
      el("ol", { class: "sp-steps" },
        el("li", {}, "Open the ", el("a", { href: "#", onclick: (e) => { e.preventDefault(); api.open_url("https://developer.spotify.com/dashboard"); } }, "Spotify Developer Dashboard"), " and log in → ", el("b", {}, "Create app"), "."),
        el("li", {}, "Any name and description. Under ", el("b", {}, "Redirect URIs"), " add exactly: ", uri,
          el("button", { class: "ghost small", onclick: async () => { try { await navigator.clipboard.writeText(st.redirect_uri); toast("Copied."); } catch { toast("Select it and copy."); } } }, "Copy")),
        el("li", {}, "Tick ", el("b", {}, "Web API"), ", agree, ", el("b", {}, "Save"), ". Open the app's ", el("b", {}, "Settings"), " → copy the ", el("b", {}, "Client ID"), " and click ", el("b", {}, "View client secret"), "."),
        el("li", {}, "Paste both below and click Save keys — they go into your ", el("code", {}, st.env_file), " file next to app.py (you can also type them there yourself: ",
          el("code", {}, "SPOTIFY_CLIENT_ID=…"), " and ", el("code", {}, "SPOTIFY_CLIENT_SECRET=…"), ")."),
        el("li", {}, "Click ", el("b", {}, "Connect Spotify"), " and allow it in the page that opens.")),
      st.has_keys ? el("p", { class: "note" }, `✅ Keys found (Client ID ${st.client_id_hint}). Paste new ones only to replace them.`) : null,
      el("div", { class: "sp-keys" }, el("label", {}, "Client ID", id), el("label", {}, "Client secret", secret), save),
      connect].filter(Boolean));
  }

  // ---------- now playing ----------
  function nowCard() {
    const t = now?.track;
    if (!now?.active || !t) {
      return el("div", { class: "sp-now empty" },
        el("p", {}, "Nothing playing. Search below, pick a playlist, or say “play … on Spotify”."),
        el("button", { class: "small", onclick: () => cmd("play_liked") }, "▶ Play my Liked Songs"));
    }
    const pos = Math.min(t.duration, now.progress + (now.playing ? (Date.now() - fetchedAt) / 1000 : 0));
    const bar = el("div", { class: "sp-bar", role: "slider", "aria-label": "Song position", "aria-valuemin": 0, "aria-valuemax": t.duration, "aria-valuenow": Math.round(pos), tabindex: 0 },
      el("span", { style: `width:${t.duration ? (pos / t.duration) * 100 : 0}%` }));
    bar.addEventListener("click", (e) => { const r = bar.getBoundingClientRect(); cmd("seek", Math.round(((e.clientX - r.left) / r.width) * t.duration)); });
    const vol = el("input", { type: "range", min: 0, max: 100, value: now.volume ?? 50, "aria-label": "Spotify volume" });
    vol.addEventListener("change", () => cmd("volume", Number(vol.value)));
    return el("div", { class: "sp-now" },
      t.image ? el("img", { class: "sp-cover", src: t.image, alt: `${t.album} cover` }) : el("div", { class: "sp-cover" }),
      el("div", { class: "sp-meta" },
        el("strong", {}, t.title), el("span", {}, t.artist), el("small", {}, `${t.album}${now.device ? ` · on ${now.device}` : ""}`),
        el("div", { class: "sp-time" }, el("small", { "data-sp": "pos" }, fmt(pos)), bar, el("small", {}, fmt(t.duration))),
        el("div", { class: "sp-controls" },
          el("button", { class: `ic${now.shuffle ? " on" : ""}`, title: "Shuffle", "aria-pressed": String(now.shuffle), onclick: () => cmd("shuffle", !now.shuffle) }, "⤮"),
          el("button", { class: "ic", title: "Previous", onclick: () => cmd("previous") }, "⏮"),
          el("button", { class: "ic big", title: now.playing ? "Pause" : "Play", onclick: () => cmd(now.playing ? "pause" : "resume") }, now.playing ? "❚❚" : "▶"),
          el("button", { class: "ic", title: "Next", onclick: () => cmd("next") }, "⏭"),
          el("button", { class: `ic${now.repeat !== "off" ? " on" : ""}`, title: `Repeat: ${now.repeat}`, onclick: () => cmd("repeat", { off: "context", context: "track", track: "off" }[now.repeat] || "context") }, now.repeat === "track" ? "🔂" : "🔁"),
          el("button", { class: `ic heart${liked ? " on" : ""}`, title: liked ? "Remove from Liked Songs" : "Save to Liked Songs", onclick: async () => { await cmd("like", !liked); liked = !liked; draw(); } }, liked ? "♥" : "♡"),
          el("button", { class: "ic", title: "More like this: play similar songs", "aria-label": "Play songs like this one", onclick: async (e) => {
            e.target.disabled = true;
            try { const r = await api.spotify_like_this(); toast(r.message || r.error, 5000); } finally { e.target.disabled = false; }
          } }, "✨")),
        el("label", { class: "sp-vol" }, "🔊", vol)));
  }

  // ---------- lists ----------
  function trackRow(t) {
    return el("li", { class: "sp-row" },
      t.small_image || t.image ? el("img", { src: t.small_image || t.image, alt: "" }) : el("span", { class: "sp-ph" }),
      el("div", { class: "what" }, el("b", {}, t.title), el("small", {}, t.artist)),
      el("button", { class: "ic", title: "Play", "aria-label": `Play ${t.title}`, onclick: () => cmd("play_uri", t.uri) }, "▶"),
      el("button", { class: "ic", title: "Add to queue", "aria-label": `Queue ${t.title}`, onclick: async () => { const r = await api.spotify_cmd("queue_uri", t.uri); toast(r.error || r.message); } }, "＋"));
  }
  function itemRow(x, sub) {
    return el("li", { class: "sp-row" },
      x.image ? el("img", { src: x.image, alt: "" }) : el("span", { class: "sp-ph" }),
      el("div", { class: "what" }, el("b", {}, x.name), el("small", {}, sub)),
      el("button", { class: "ic", title: "Play", "aria-label": `Play ${x.name}`, onclick: () => cmd("play_uri", x.uri) }, "▶"));
  }

  // ---------- Playlist Lab: import + analyse a playlist, then make a new one in its style ----------
  let labOpen = null;          // the analysis being shown
  async function drawLab(box) {
    const ref = el("input", { placeholder: "Playlist name or Spotify link (Share → Copy link)", "aria-label": "Playlist to analyse" });
    const out = el("div", { class: "pl-out" });
    const go = async (value) => {
      const v = (value ?? ref.value).trim(); if (!v) return toast("Type a playlist name or paste its link.");
      out.replaceChildren(el("p", { class: "note" }, "Reading the playlist and analysing it… (~10-30 s)"));
      const r = await api.playlab_analyse(v);
      if (r.error) return out.replaceChildren(el("p", { class: "warn" }, r.error));
      labOpen = r; showAnalysis(out, r);
    };
    ref.addEventListener("keydown", (e) => e.key === "Enter" && go());
    const [mine, done] = await Promise.all([api.spotify_library("playlists"), api.playlab_list()]);
    const pick = el("select", { "aria-label": "Your playlists" }, el("option", { value: "" }, "…or pick one of yours"),
      (mine.items || []).map((p) => el("option", { value: p.uri }, `${p.name}${p.count != null ? ` (${p.count})` : ""}`)));
    pick.addEventListener("change", () => pick.value && go(pick.value));
    box.replaceChildren(...[
      el("p", { class: "note" }, "Import a playlist, see what it's made of, then let Vermeil make a new playlist in the same style."),
      el("div", { class: "row" }, ref, el("button", { onclick: () => go() }, "Analyse")), pick,
      (done.items || []).length ? el("div", { class: "row chips pl-prev" }, el("small", {}, "Analysed before:"),
        done.items.slice(0, 8).map((a) => el("button", { class: "chip", onclick: async () => { const r = await api.playlab_get(a.id); if (!r.error) { labOpen = r; showAnalysis(out, r); } } }, a.name))) : null,
      out].filter(Boolean));
    if (labOpen) showAnalysis(out, labOpen);
  }

  function bars(rows) {
    return el("div", { class: "pl-bars" }, rows.map(([label, pct, extra]) => el("div", { class: "pl-bar" },
      el("span", {}, label), el("i", {}, el("b", { style: `width:${Math.max(2, Math.min(100, pct))}%` })), el("small", {}, extra ?? `${pct}%`))));
  }

  function showAnalysis(out, a) {
    const s = a.stats, ai = a.ai || {};
    const tile = (n, l) => el("div", { class: "pl-tile" }, el("b", {}, String(n ?? "–")), el("small", {}, l));
    const style = el("select", { "aria-label": "Style of the new playlist" }, STYLES.map(([v, l]) => el("option", { value: v }, l)));
    const size = el("input", { type: "number", min: 5, max: 100, value: 25, "aria-label": "Number of songs" });
    const keep = el("input", { type: "number", min: 0, max: 50, value: 0, "aria-label": "Songs to keep from the original" });
    const name = el("input", { placeholder: (ai.name_ideas || [])[0] || "Name (optional)", "aria-label": "New playlist name" });
    const extra = el("input", { placeholder: "Anything else? e.g. “more OPM”, “no songs before 2015”", "aria-label": "Extra wishes" });
    const pub = el("input", { type: "checkbox" });
    const result = el("div");
    const make = el("button", { class: "primary", onclick: async () => {
      busy(make, true, "Picking songs…");
      result.replaceChildren(el("p", { class: "note" }, "Vermeil is picking songs and finding them on Spotify… (~20-40 s)"));
      const r = await api.playlab_make(a.id, +size.value, style.value, name.value, extra.value, pub.checked, +keep.value);
      busy(make, false);
      if (r.error) return result.replaceChildren(el("p", { class: "warn" }, r.error));
      toast(r.message, 5000);
      result.replaceChildren(...[el("h4", {}, `✅ ${r.name}`),
        el("div", { class: "row" }, el("button", { onclick: () => cmd("play_uri", r.uri) }, "▶ Play it"),
          r.url ? el("button", { class: "ghost", onclick: () => api.open_url(r.url) }, "Open in Spotify") : null),
        el("ol", { class: "pl-songs" }, r.added.map((t) => el("li", {}, `${t.title} — ${t.artist}`))),
        r.not_found.length ? el("details", {}, el("summary", {}, `${r.not_found.length} picks weren't on Spotify`), el("ul", { class: "note" }, r.not_found.map((x) => el("li", {}, x)))) : null].filter(Boolean));
    } }, "✨ Create on Spotify");
    const yt = el("button", { class: "ghost", onclick: async () => { busy(yt, true, "Picking…"); const r = await api.playlab_youtube(a.id, +size.value, style.value); busy(yt, false); toast(r.error || r.message, 5000); } }, "Play on YouTube instead");
    out.replaceChildren(...[
      el("div", { class: "row pl-head" }, a.image ? el("img", { src: a.image, alt: "" }) : null,
        el("div", {}, el("h3", {}, a.name), el("small", { class: "note" }, `${a.owner ? `by ${a.owner} · ` : ""}analysed ${a.analysed}`))),
      el("div", { class: "pl-tiles" }, tile(s.songs, "songs"), tile(`${s.total_minutes}m`, "long"), tile(s.artists, "artists"),
        tile(s.oldest && s.newest ? `${s.oldest}–${String(s.newest).slice(2)}` : "–", "years"), tile(`${s.explicit_pct}%`, "explicit"),
        tile(`${s.variety}%`, "variety"), s.popularity != null ? tile(s.popularity, "popularity") : null, tile(ai.energy != null ? `${ai.energy}/10` : "–", "energy")),
      ai.error ? el("p", { class: "warn" }, ai.error) : null,
      ai.vibe ? el("p", { class: "pl-vibe" }, ai.vibe) : null,
      (ai.moods || []).length ? el("div", { class: "row chips" }, ai.moods.map((m) => el("span", { class: "chip" }, m)), ai.tempo ? el("span", { class: "chip" }, `tempo: ${ai.tempo}`) : null) : null,
      (ai.genres || []).length ? el("div", {}, el("h4", {}, "Genres"), bars(ai.genres.map((g) => [g.name, +g.pct || 0]))) : null,
      s.decades.length ? el("div", {}, el("h4", {}, "Eras"), bars(s.decades.map((d) => [d.decade, d.pct, `${d.songs}`]))) : null,
      el("h4", {}, "Top artists"), bars(s.top_artists.slice(0, 6).map((x) => [x.name, Math.round(100 * x.songs / s.top_artists[0].songs), `${x.songs}`])),
      (ai.best_for || []).length ? el("p", { class: "note" }, `Good for: ${ai.best_for.join(", ")}`) : null,
      (ai.similar_artists || []).length ? el("p", { class: "note" }, `Sounds like: ${ai.similar_artists.join(", ")}`) : null,
      el("h4", {}, "Make a new playlist from it"),
      el("div", { class: "pl-form" }, el("label", {}, "Style", style), el("label", {}, "Songs", size), el("label", {}, "Keep from original", keep),
        el("label", { class: "wide" }, "Name", name), el("label", { class: "wide" }, "Extra wishes", extra),
        el("label", { class: "check wide" }, pub, " Public playlist")),
      el("div", { class: "row" }, make, yt), result].filter(Boolean));
  }

  async function drawTab(box) {
    if (tab === "lab") return drawLab(box);
    if (tab === "search") {
      const q = el("input", { type: "search", placeholder: "Songs, artists, albums, playlists…", value: lastSearch, "aria-label": "Search Spotify" });
      const res = el("div", {});
      const go = async () => {
        lastSearch = q.value.trim();
        if (!lastSearch) return;
        res.replaceChildren(el("p", { class: "note" }, "Searching…"));
        const r = await api.spotify_search(lastSearch);
        if (r.error) return res.replaceChildren(el("p", { class: "warn" }, r.error));
        res.replaceChildren(
          ...[r.tracks.length ? el("h4", {}, "Songs") : null, el("ul", { class: "sp-list" }, r.tracks.map(trackRow)),
          r.artists.length ? el("h4", {}, "Artists") : null, el("ul", { class: "sp-list" }, r.artists.slice(0, 4).map((a) => itemRow(a, "Artist"))),
          r.albums.length ? el("h4", {}, "Albums") : null, el("ul", { class: "sp-list" }, r.albums.slice(0, 4).map((a) => itemRow(a, a.artist))),
          r.playlists.length ? el("h4", {}, "Playlists") : null, el("ul", { class: "sp-list" }, r.playlists.slice(0, 4).map((p) => itemRow(p, `by ${p.owner}`)))].filter(Boolean));
      };
      q.addEventListener("keydown", (e) => e.key === "Enter" && go());
      box.replaceChildren(el("div", { class: "row" }, q, el("button", { onclick: go }, "Search")), res);
      if (lastSearch) go();
      return;
    }
    box.replaceChildren(el("p", { class: "note" }, "Loading…"));
    const r = await api.spotify_library(tab);
    if (r.error) return box.replaceChildren(el("p", { class: "warn" }, r.error));
    const items = r.items || [];
    if (!items.length) return box.replaceChildren(el("p", { class: "none" }, "Nothing here yet."));
    if (tab === "playlists") box.replaceChildren(el("ul", { class: "sp-list" }, items.map((p) => itemRow(p, `${p.count ?? ""}${p.count != null ? " songs · " : ""}${p.owner}`))));
    else box.replaceChildren(...[tab === "liked" ? el("button", { class: "small", onclick: () => cmd("play_liked") }, "▶ Shuffle all") : null, el("ul", { class: "sp-list" }, items.map(trackRow))].filter(Boolean));
  }

  // ---------- connected screen ----------
  function draw() {
    if (!st) return;
    if (!st.connected) return drawSetup();
    const src = el("select", { "aria-label": "Which player 'play …' uses" },
      [["auto", "Spotify (YouTube if Spotify isn't connected)"], ["spotify", "Always Spotify"], ["youtube", "YouTube player instead"]]
        .map(([v, l]) => el("option", { value: v, selected: st.source === v }, l)));
    src.addEventListener("change", async () => { await api.save_settings({ music_source: src.value }); st = await api.spotify_status(); toast("Saved."); });
    const tabs = el("nav", { class: "tabs", role: "tablist" }, TABS.map(([k, l]) => el("button", { role: "tab", "aria-selected": String(tab === k), onclick: () => { tab = k; draw(); } }, l)));
    const box = el("div", { class: "sp-tab" });
    body.replaceChildren(
      el("div", { class: "row sp-head" }, el("span", { class: "sp-dot", "aria-hidden": "true" }), el("span", {}, `Connected${st.user ? ` as ${st.user}` : ""}`),
        el("button", { class: "ghost small", onclick: async () => { st = await api.spotify_logout(); draw(); } }, "Disconnect")),
      nowCard(),
      el("label", { class: "sp-src" }, "When I say “play …”, use", src),
      tabs, box);
    drawTab(box);
  }

  async function cmd(action, value) {
    const r = await api.spotify_cmd(action, value);
    if (r.error) toast(r.error, 6000);
    setTimeout(refresh, 450);
    return r;
  }

  async function refresh() {
    if (!st?.connected) return;
    const r = await api.spotify_now();
    if (r.error) { now = null; onState(null); return; }
    const changed = r.track?.uri !== now?.track?.uri;
    now = r; fetchedAt = Date.now();
    if (changed && r.track) liked = !!(await api.spotify_is_liked(r.track.uri));
    onState(now);
    if (body.isConnected && body.offsetParent !== null) {          // only redraw while it's on screen (Music -> Spotify)
      const tabBox = body.querySelector(".sp-tab");
      const card = body.querySelector(".sp-now");
      if (card && tabBox) card.replaceWith(nowCard()); else draw();
    }
  }

  // progress ticks between fetches (no extra calls)
  setInterval(() => {
    if (!now?.playing || !body.isConnected || body.offsetParent === null) return;
    const t = now.track, pos = Math.min(t.duration, now.progress + (Date.now() - fetchedAt) / 1000);
    const p = body.querySelector('[data-sp="pos"]'), bar = body.querySelector(".sp-bar span");
    if (p) p.textContent = fmt(pos);
    if (bar && t.duration) bar.style.width = `${(pos / t.duration) * 100}%`;
  }, 1000);

  function schedule() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => { await refresh().catch(() => {}); schedule(); }, !body.isConnected || body.offsetParent === null ? 10000 : 4000);
  }

  async function load() {
    st = await api.spotify_status();
    draw();
    await refresh();
    schedule();
  }

  return {
    load,
    status: () => (now?.active && now.track ? now : null),
    cmd,
    onEvent(e) {
      if (e.type !== "spotify_login") return;
      st = e.status;
      toast(e.ok ? "🎵 Spotify connected!" : `Spotify: ${e.error}`, 6000);
      draw(); refresh();
    },
  };
}
