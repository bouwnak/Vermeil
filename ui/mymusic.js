// mymusic.js - "Vermeil Music": your own Spotify-style app. Songs come from YouTube and play in Vermeil's player;
// playlists, Liked Songs and analyses are yours (data/my_music.json). Python side: skills/mymusic.py via api.mm(...).
import { $, el, toast, busy } from "./util.js";

const fmt = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
const TABS = [["library", "Your Library"], ["search", "Search"], ["queue", "Queue"], ["recent", "Recent"], ["import", "Import"], ["lab", "Playlist Lab"]];
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
    p.cover ? el("div", { class: cls }, el("img", { src: p.cover, alt: "" })) :
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
    if (tab === "queue") return drawQueue();
    if (tab === "recent") return drawRecent();
    if (tab === "import") return drawImport();
    if (tab === "lab") return drawLab();
    drawLibrary();
  }

  // ---------------- Queue: view, skip, clear ----------------
  async function drawQueue() {
    view.replaceChildren(el("p", { class: "note" }, "Loading queue…"));
    now = await mm("now");
    const s = now?.song;
    const qList = now?.queue || [];

    const nowCard = el("div", { class: "mm-now-card", style: "background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:16px;margin-bottom:16px;display:flex;gap:16px;align-items:center;" },
      s?.thumb
        ? el("img", { src: s.thumb, alt: "", style: "width:64px;height:64px;border-radius:8px;object-fit:cover;flex-shrink:0;" })
        : el("div", { style: "width:64px;height:64px;border-radius:8px;background:var(--accent,#3e8eff);display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;flex-shrink:0;" }, "♪"),
      el("div", { style: "flex:1;min-width:0;" },
        el("span", { style: "font-size:11px;font-weight:700;text-transform:uppercase;color:var(--accent,#3e8eff);letter-spacing:.06em;" }, now?.playing && !now?.paused ? "● NOW PLAYING" : "NOW PLAYING"),
        el("h3", { style: "margin:4px 0 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:16px;" }, s ? s.title : "Nothing playing"),
        el("small", { style: "color:rgba(255,255,255,0.7);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" }, s ? s.artist : "Choose a song to start listening")
      ),
      el("div", { style: "display:flex;gap:6px;align-items:center;flex-shrink:0;" },
        el("button", { class: "ic", title: "Play / Pause", onclick: async () => { await cmd(now?.paused ? "resume" : now?.playing ? "pause" : "resume"); drawQueue(); } }, now?.playing && !now?.paused ? "⏸" : "▶"),
        el("button", { class: "ic", title: "Next song", onclick: async () => { await cmd("skip"); toast("Skipped to next song."); setTimeout(drawQueue, 800); } }, "⏭")
      )
    );

    const actionRow = el("div", { class: "row mm-actions", style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px;" },
      el("button", { class: "primary small", style: "font-weight:600;", onclick: async () => { await cmd("skip"); toast("Skipped to next song."); setTimeout(drawQueue, 800); } }, "⏭ Next song"),
      el("button", { class: "ghost small", onclick: async () => { await cmd("shuffle"); toast("Queue shuffled."); drawQueue(); } }, "🔀 Shuffle"),
      el("button", { class: "danger small", onclick: async () => { if (confirm("Clear all upcoming songs from the queue?")) { await mm("clear_queue"); toast("Queue cleared."); drawQueue(); } } }, "🗑 Clear Queue"),
      el("button", { class: "ghost small", onclick: () => drawQueue() }, "🔄 Refresh")
    );

    const listContainer = el("div", {});
    if (qList.length) {
      listContainer.append(
        el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin:12px 0 8px;" },
          el("h4", { style: "margin:0;font-size:14px;" }, `Up Next (${qList.length} track${qList.length > 1 ? "s" : ""})`),
          el("small", { class: "muted" }, "Tracks play in order")
        ),
        el("ol", { class: "mm-queue-list", style: "list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;" },
          qList.map((item, idx) => {
            const row = el("li", { style: "display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px 12px;transition:background .15s;" },
              el("span", { style: "font-size:12px;font-weight:700;color:rgba(255,255,255,0.5);min-width:20px;text-align:center;" }, String(idx + 1).padStart(2, "0")),
              el("div", { style: "width:32px;height:32px;border-radius:6px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;font-size:14px;color:rgba(255,255,255,0.7);flex-shrink:0;" }, "♪"),
              el("div", { style: "flex:1;min-width:0;" },
                el("b", { style: "display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;" }, String(item)),
                el("small", { class: "muted", style: "font-size:11px;" }, "Queued song")
              ),
              el("div", { style: "display:flex;gap:4px;flex-shrink:0;" },
                el("button", { class: "ghost small", title: "Play this song right now", style: "padding:2px 8px;font-size:11px;", onclick: async () => {
                  const r = await mm("play_queued_index", idx);
                  toast(r.message || "Playing now");
                  setTimeout(drawQueue, 1000);
                } }, "▶ Play"),
                el("button", { class: "ic x", title: "Remove from queue", "aria-label": "Remove", style: "font-size:14px;width:26px;height:26px;", onclick: async () => {
                  await mm("remove_from_queue", idx);
                  toast("Removed track from queue.");
                  drawQueue();
                } }, "×")
              )
            );
            row.addEventListener("mouseenter", () => { row.style.background = "rgba(255,255,255,0.08)"; });
            row.addEventListener("mouseleave", () => { row.style.background = "rgba(255,255,255,0.03)"; });
            return row;
          })
        )
      );
    } else {
      listContainer.append(
        el("div", { style: "text-align:center;padding:32px 16px;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.12);border-radius:12px;margin-top:12px;" },
          el("div", { style: "font-size:36px;margin-bottom:8px;opacity:0.6;" }, "🎵"),
          el("h4", { style: "margin:0 0 6px;" }, "The queue is empty"),
          el("p", { class: "muted small", style: "margin:0 0 16px;" }, "Use Search, Liked Songs, or any playlist to queue up tracks!"),
          el("button", { class: "ghost small", onclick: () => { tab = "library"; load(); } }, "Browse Library")
        )
      );
    }

    view.replaceChildren(nowCard, actionRow, listContainer);
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
        editable ? el("button", { class: "ghost small", onclick: () => editDetails(p) }, "✎ Edit details") : null,
        editable ? el("button", { class: "ghost small", onclick: () => { tab = "lab"; labPick = p.id; openPl = null; load(); } }, "🧪 Analyse / make similar") : null,
        editable ? el("button", { class: "danger small", onclick: async () => { if (!confirm(`Delete “${p.name}”?`)) return; await mm("delete", p.id); openPl = null; load(); } }, "🗑 Delete") : null,
        p.count ? el("button", { class: "ghost small", title: "Swaps music videos for lyric videos: no skits or long intros, and songs play to the end", onclick: async (e) => {
          busy(e.target, true, "Finding lyric videos…");
          try { const r = await mm("to_lyrics", p.id); if (r.error) return toast(r.error, 6000); toast(r.message, 5000); openPl = r; drawPlaylist(); }
          finally { busy(e.target, false); }
        } }, "🎤 Use lyric videos") : null,
        el("button", { class: "ghost small", onclick: () => { openPl = null; load(); } }, "← Back")),
      p.songs.length ? el("ol", { class: "mm-list" }, p.songs.map((s, i) => songRow(s, i, p.songs, { pid: p.id })))
        : el("p", { class: "none" }, "No songs yet. Use Search and press “＋ Playlist” on a song."));
  }

  function editDetails(p) {
    const titleIn = el("input", { value: p.name, style: "width:100%;font-size:16px;font-weight:700;", "aria-label": "Playlist title" });
    const descIn = el("textarea", { rows: 3, style: "width:100%;", placeholder: "Description (optional)", "aria-label": "Description" });
    descIn.value = p.description || "";
    const coverUrlIn = el("input", { type: "text", style: "width:100%;", placeholder: "Image URL (https://...) or choose a file below", value: p.cover || "" });
    const fileIn = el("input", { type: "file", accept: "image/*" });
    let coverVal = p.cover || "";
    fileIn.addEventListener("change", () => {
      const f = fileIn.files?.[0];
      if (f) {
        const reader = new FileReader();
        reader.onload = (e) => {
          coverVal = e.target.result;
          coverUrlIn.value = coverVal.slice(0, 50) + "…";
          previewImg.src = coverVal;
          previewImg.hidden = false;
        };
        reader.readAsDataURL(f);
      }
    });
    const previewImg = el("img", { src: p.cover || "", style: "width:80px;height:80px;object-fit:cover;border-radius:8px;border:1.5px solid var(--line);", hidden: !p.cover });
    coverUrlIn.addEventListener("input", () => {
      coverVal = coverUrlIn.value.trim();
      previewImg.src = coverVal;
      previewImg.hidden = !coverVal;
    });

    const saveBtn = el("button", { class: "primary", onclick: async () => {
      busy(saveBtn, true, "Saving…");
      try {
        const name = titleIn.value.trim() || p.name;
        const desc = descIn.value.trim();
        openPl = await mm("update", p.id, name, desc, coverVal);
        toast("Playlist updated!");
        drawTabs();
        drawPlaylist();
      } finally {
        busy(saveBtn, false);
      }
    } }, "Save details");

    view.replaceChildren(
      el("div", { class: "mm-head" }, el("div", {}, el("h3", {}, `Edit: ${p.name}`), el("p", { class: "note" }, "Change the cover image, title, and description."))),
      el("div", { style: "max-width:500px;display:grid;gap:12px;margin:12px 0;" },
        el("label", {}, el("b", {}, "Title"), titleIn),
        el("label", {}, el("b", {}, "Description"), descIn),
        el("label", {}, el("b", {}, "Cover Image"), coverUrlIn, fileIn),
        previewImg,
        el("div", { class: "row" },
          saveBtn,
          el("button", { class: "ghost", onclick: () => drawPlaylist() }, "Cancel")
        )
      )
    );
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
      if (!r.connected) return spBox.replaceChildren(el("p", { class: "note" }, "Connect Spotify and all your playlists show up here to import into Vermeil Music."),
        el("button", { class: "primary small", onclick: async () => {
          toast("Connecting to Spotify in browser…");
          await api.spotify_connect();
          setTimeout(drawImport, 3500);
        } }, "Connect Spotify"));
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
