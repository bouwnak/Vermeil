// app.js - connects the window to Python (app.py) and drives the room.
import { Room } from "./room.js";
import { CATALOG, CozyRoom, THEMES, TIME_PRESETS, WALLPAPERS, REWARD_WALLPAPERS } from "./cozyroom.js";
import { initQuest, passLock } from "./quest.js";
import { initGym } from "./gym.js";
import { initStudy } from "./study.js";

import { el, busy } from "./util.js";
import * as fx from "./fx.js";
import { openRigger, rigEvent } from "./rigger.js";
import { initDropdowns } from "./dropdown.js";
import * as psp from "./psp.js";
import { initLife } from "./life.js";
import { initChat } from "./chat.js";
import { initPlugins } from "./plugins.js";
import { initMyMusic } from "./mymusic.js";
// features whose code can be uninstalled (Settings -> Plugins deletes their files; Install gets them from Drive):
// a missing file gives a do-nothing panel instead of breaking the whole app
const notInstalled = new Proxy({}, { get: (_, k) => k === "then" ? undefined : k === "status" ? () => null : () => Promise.resolve() });
async function optional(file, name) {
  try { return (await import(file))[name]; }
  catch (e) { console.warn(`${file} isn't installed`, e); return () => notInstalled; }
}
const [initMind, initBaking, initFocus, initCode, initMissions, initSpotify, initElectronics, initPlanner, initGenerator] = await Promise.all([
  optional("./mind.js", "initMind"), optional("./baking.js", "initBaking"), optional("./focus.js", "initFocus"),
  optional("./code.js", "initCode"), optional("./missions.js", "initMissions"), optional("./spotify.js", "initSpotify"),
  optional("./electronics.js", "initElectronics"), optional("./planner.js", "initPlanner"), optional("./generator.js", "initGenerator")]);
const $ = (id) => document.getElementById(id);
const room = new Room($("scene"));
if (new URLSearchParams(location.search).has("mock")) window.__room = room;   // browser preview only: lets checks drive the 3D room
let api = null;
let state = null;
let editingId = null;
let bubbleTimer = null;
let asking = false;
let voices = [];
let viewTimer = null;

// ---------------- planner, study, code (their own files) ----------------
let musicPanel = null, elecPanel = null, genPanel = null, planner = null, study = null, codePanel = null, mind = null, gym = null, baking = null, cooking = null, focusPanel = null, chat = null, missionsPanel = null, spotifyPanel = null;
const renderPlanner = () => planner?.render();

function showHistory(history) {
  if (chat) return chat.renderMessages(history);
  $("log").replaceChildren();
  if (!history?.length) { addLog("empty", "Nothing yet. Say hi!"); return; }
  for (const m of history) addLog(m.who, m.text);
}

const prettyPref = (k, v) => k.startsWith("likes: ") ? `${v}s ${k.slice(7)}` : k.startsWith("dislikes: ") ? `doesn't like ${k.slice(10)}` : `${k}: ${v}`;
async function renderPrefs() {
  const prefs = await api.get_preferences();
  const list = $("prefList");
  list.replaceChildren();
  const entries = Object.entries(prefs || {});
  if (!entries.length) {
    const li = document.createElement("li"); li.className = "empty"; li.textContent = "Nothing yet."; list.append(li);
  }
  for (const [k, v] of entries) {
    const li = document.createElement("li");
    li.append(prettyPref(k, v));
    const x = document.createElement("button");
    x.textContent = "×"; x.setAttribute("aria-label", `Forget: ${prettyPref(k, v)}`);
    x.addEventListener("click", async () => { await api.forget_preference(k); renderPrefs(); });
    li.append(x); list.append(li);
  }
}

// ---------------- voices ----------------
const num = (v) => parseInt(String(v || "0").replace(/[^-\d]/g, ""), 10) || 0;

let onlineVoices = { voices: [], status: {} };
async function loadOnlineVoices(selected) {
  try { onlineVoices = await api.list_online_voices(); } catch { onlineVoices = { voices: [], status: {} }; }
  const sel = $("voiceOnlineSelect");
  if (!sel) return;
  const groups = {};
  for (const v of onlineVoices.voices) (groups[v.language] ||= []).push(v);
  const opts = [new Option("Off — always use the voice above", "")];
  for (const [lang, list] of Object.entries(groups)) {
    const g = document.createElement("optgroup"); g.label = lang;
    g.append(...list.map((v) => new Option(`${v.name.replace(" · Kokoro", "")} (${v.gender.toLowerCase()})`, v.id)));
    opts.push(g);
  }
  sel.replaceChildren(...opts);
  sel.value = selected ?? sel.value;
  const st = onlineVoices.status || {};
  $("kokoroNote").textContent = !st.installed ? (st.files ? "Kokoro's Python package is missing: run  python -m pip install kokoro-onnx" : "Kokoro isn't set up yet: double-click scripts\\setup_kokoro.bat once (see README).") + " Until then the voice above is used."
    : st.ready ? `Kokoro is running on your PC.${onlineVoices.online ? " The AI is online, so this voice is used now." : " The AI is offline right now, so the voice above is used."}`
    : st.starting ? "Kokoro is loading inside the app…" : `Kokoro is set up but not loaded${st.error ? ` (${st.error})` : ""}.`;
}

async function loadVoices() {
  try { voices = await api.list_voices(); } catch { voices = []; }
  loadOnlineVoices();
  const langs = [...new Set(voices.map((v) => v.language))].sort((a, b) =>
    (a.startsWith("English") ? 0 : 1) - (b.startsWith("English") ? 0 : 1) || a.localeCompare(b));
  $("langSelect").replaceChildren(...langs.map((l) => new Option(l, l)));
}

function fillVoices(language, selected) {
  const list = voices.filter((v) => v.language === language);
  $("voiceSelect").replaceChildren(...list.map((v) => new Option(v.gender ? `${v.name} (${v.gender.toLowerCase()})` : v.name, v.id)));
  if (selected && list.some((v) => v.id === selected)) $("voiceSelect").value = selected;
}

function showVoice(voiceId) {
  const v = voices.find((x) => x.id === voiceId) || voices.find((x) => x.locale === "en-US") || voices[0];
  if (!v) return;
  $("langSelect").value = v.language;
  fillVoices(v.language, v.id);
}
$("langSelect").addEventListener("change", () => fillVoices($("langSelect").value));
// picking what she speaks also shows the voices for that language
const LANG_WORD = { en: "English", ja: "Japanese", ko: "Korean", tl: "Filipino", zh: "Chinese", es: "Spanish", fr: "French", de: "German",
  it: "Italian", pt: "Portuguese", ru: "Russian", th: "Thai", vi: "Vietnamese", id: "Indonesian" };
$("charLanguage").addEventListener("change", (e) => {
  const word = LANG_WORD[e.target.value];
  if (!word) return;
  const opt = [...$("langSelect").options].find((o) => o.value.startsWith(word));
  if (opt && !$("langSelect").value.startsWith(word)) { $("langSelect").value = opt.value; fillVoices(opt.value); toast(`Showing ${word} voices — pick one, then Save.`, 3500); }
});
for (const [name, out, unit] of [["rate", "rateOut", "%"], ["pitch", "pitchOut", " Hz"]]) {
  const input = $("editor")[name];
  input.addEventListener("input", () => ($(out).textContent = `${input.value > 0 ? "+" : ""}${input.value}${unit}`));
}
$("editor").volume.addEventListener("input", (e) => ($("volumeOut").textContent = `${e.target.value}%`));
$("editor").emotion.addEventListener("input", (e) => ($("emotionOut").textContent = `${e.target.value}%`));
$("previewOnlineVoice").addEventListener("click", async () => {
  const f = $("editor");
  if (!f.voice_online.value) { toast("Pick an online voice first.", 2500); return; }
  const st = (onlineVoices.status || {});
  if (!st.ready) { api.kokoro_start(); toast(st.installed ? "Kokoro is loading — try again in a few seconds." : "Kokoro isn't set up yet (double-click scripts\\setup_kokoro.bat).", 4000); setTimeout(() => loadOnlineVoices(), 8000); return; }
  api.preview_voice(f.voice_online.value, f.rate.value, f.pitch.value, f.name.value, f.volume.value);
  toast("Playing a sample…", 2000);
});
$("previewVoice").addEventListener("click", () => {
  const f = $("editor");
  const clone = rvcValue();
  if (clone.model && !rvcState.status?.ready) { toast(rvcState.status?.hint || "Voice clones aren't set up yet (double-click scripts\\setup_rvc.bat).", 5000); return; }
  api.preview_voice(f.voice.value, f.rate.value, f.pitch.value, f.name.value, f.volume.value, clone, f.language.value, f.emotional.checked);
  toast(clone.model ? `Playing a sample as ${clone.model} (the first one takes a few seconds)…` : "Playing a sample…", 3000);
});

// ---------------- Emotional voice (Chatterbox) ----------------
async function showChatterNote() {
  const note = $("chatterNote"), on = $("editor").emotional.checked;
  note.hidden = !on;
  if (!on) return;
  let st = null;
  try { st = await api.chatter_status(); } catch {}
  note.textContent = st?.hint || "";
  note.hidden = !st?.hint;
}
$("editor").emotional.addEventListener("change", showChatterNote);

// ---------------- voice clone (RVC) ----------------
let rvcState = { voices: [], status: {} };
function rvcValue() {
  const model = $("rvcSelect").value;
  if (!model) return {};
  return { model, pitch: Number($("rvcPitch").value), index_rate: Number($("rvcIndex").value) / 100, base: $("rvcBase").value };
}
function showRvcOutputs() {
  const p = Number($("rvcPitch").value);
  $("rvcPitchOut").textContent = `${p > 0 ? "+" : ""}${p}`;
  $("rvcIndexOut").textContent = `${$("rvcIndex").value}%`;
}
async function loadRvc(cfg) {
  try { rvcState = await api.rvc_list(); } catch { rvcState = { voices: [], status: {} }; }
  const sel = $("rvcSelect");
  const keep = cfg ? cfg.model || "" : sel.value;
  sel.replaceChildren(new Option("Off — no clone", ""), ...rvcState.voices.map((v) =>
    new Option(`${v.name}${v.has_index ? "" : " (no index)"} · ${Math.round((v.sr || 0) / 1000)}k`, v.name)));
  sel.value = rvcState.voices.some((v) => v.name === keep) ? keep : "";
  if (cfg) {
    $("rvcPitch").value = cfg.pitch ?? 0;
    $("rvcIndex").value = Math.round((cfg.index_rate ?? 0.5) * 100);
    $("rvcBase").value = cfg.base || "own";
  }
  showRvcOutputs();
  $("rvcDelete").hidden = !sel.value;
  const st = rvcState.status || {};
  $("rvcNote").textContent = st.ready
    ? `Changes the voice into the clone. Works in English, Tagalog, Japanese and Korean. Female voice → male clone: try pitch −12; male → female: +12.${st.faiss ? "" : " (Tip: python -m pip install faiss-cpu makes clones closer using their .index.)"}`
    : (st.hint || "Voice clones aren't set up yet: double-click scripts\\setup_rvc.bat once.");
}
for (const id of ["rvcPitch", "rvcIndex"]) $(id).addEventListener("input", showRvcOutputs);
$("rvcSelect").addEventListener("change", () => { $("rvcDelete").hidden = !$("rvcSelect").value; });
// the loading bar while a voice clone is copied in (events from app.rvc_import)
function rvcBar(e) {
  const bar = $("rvcBar");
  clearTimeout(bar._hide);
  bar.hidden = false;
  bar.classList.toggle("bad", !!e.error);
  const pct = e.error ? 1 : Math.max(0, Math.min(1, e.pct || 0));
  bar.querySelector("i").style.width = `${Math.round(pct * 100)}%`;
  bar.querySelector("span").textContent = e.error ? "Couldn't import it" : e.text || "";
  bar.querySelector("b").textContent = e.error ? "" : `${Math.round(pct * 100)}%`;
  bar.setAttribute("aria-valuenow", Math.round(pct * 100));
  if (e.error || pct >= 1) bar._hide = setTimeout(() => { bar.hidden = true; }, e.error ? 4000 : 1500);
}
$("rvcImport").addEventListener("click", async () => {
  toast("Pick the voice's .pth file (and its .index file too, if it has one).", 4000);
  const btn = $("rvcImport");
  btn.disabled = true;
  const res = await api.rvc_import().finally(() => { btn.disabled = false; });
  if (!res) return;
  if (res.error) { toast(res.error, 5000); return; }
  rvcState = res;
  await loadRvc({ ...rvcValue(), model: res.imported.name });
  toast(`Imported ${res.imported.name}. Press Save character to use it.`, 4000);
});
$("rvcDelete").addEventListener("click", async () => {
  const name = $("rvcSelect").value;
  if (!name || !confirm(`Remove the voice clone “${name}”? (Your original files in Downloads stay.)`)) return;
  await api.rvc_delete(name);
  await loadRvc({ ...rvcValue(), model: "" });
  toast("Removed.");
});

// ---------------- Python connection ----------------
function getApi() {
  return new Promise((resolve) => {
    if (window.pywebview?.api) return resolve(window.pywebview.api);
    window.addEventListener("pywebviewready", () => resolve(window.pywebview.api), { once: true });
    if (new URLSearchParams(location.search).has("mock")) {
      import("./mock.js").then((m) => resolve(m.mockApi));          // browser preview without Python
      window.__room = room;                                            // handy for checking things in the preview
    }
  });
}

// ---------------- small helpers ----------------
function toast(text, ms = 3500) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), ms);
}

function activeChar() {
  return state.characters.find((c) => c.id === state.active) || state.characters[0];
}

function say(text, { ask = false } = {}) {
  if (!text) return;
  $("bubbleText").textContent = text;
  $("bubble").classList.add("subtitle");                 // shown as a subtitle just above the message box
  $("bubble").style.left = ""; $("bubble").style.top = "";
  $("bubble").classList.toggle("ask", ask);
  $("bubble").hidden = false;
  clearTimeout(bubbleTimer);
  if (!ask) bubbleTimer = setTimeout(() => ($("bubble").hidden = true), Math.max(5000, text.length * 80));
}

function addLog(who, text) {
  const log = $("log");
  log.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  li.className = who;
  li.append(el("span", { class: "who" }, who === "you" ? "You" : activeChar()?.name || "Her"), el("span", { class: "msg-text" }, text));
  log.append(li);
  li.scrollIntoView({ block: "end", behavior: "smooth" });
  if (who === "her") refreshGuide(text);
}

// ---------------- talk guide: little "try saying…" chips above the message box ----------------
const GUIDE = {
  start: ["How was your day?", "What can you do?", "Play some music", "Remind me at 8 to drink water", "What's on my schedule?"],
  music: ["Skip this song", "Turn it down a bit", "Play something calm"],
  study: ["Quiz me on my lecture", "Explain it simpler", "Make me flashcards"],
  gym: ["Log my workout", "What should I train today?", "Calculate my BMI"],
  sad: ["I just need to vent", "Tell me something nice", "Let's breathe together"],
  question: ["Yes", "No", "Tell me more"],
};
function refreshGuide(lastReply = "") {
  const box = $("talkGuide");
  if (!box) return;
  const t = (lastReply || "").toLowerCase();
  const kind = /\?\s*$/.test(lastReply) ? "question" : /song|music|playing/.test(t) ? "music" : /study|lecture|quiz|exam/.test(t) ? "study"
    : /gym|workout|lift|reps|bmi/.test(t) ? "gym" : /sorry|sad|tough|hard day|rough/.test(t) ? "sad" : "start";
  const picks = [...GUIDE[kind]].sort(() => Math.random() - 0.5).slice(0, 3);
  box.replaceChildren(el("span", { class: "guide-label" }, "Try saying"), ...picks.map((p, i) => el("button", {
    type: "button", class: "guide-chip", style: `animation-delay:${i * 70}ms`,
    onclick: () => { $("talkInput").value = p; $("talkForm").requestSubmit(); } }, p)));
  box.hidden = false;
}

function placeBubble() {
  // only while the bubble is showing (measuring it every frame for nothing made the whole app slower)
  const bb = $("bubble");
  const p = bb.hidden || document.hidden || bb.classList.contains("subtitle") ? null : room.headScreenPosition();   // subtitles stay put
  if (p) {
    const b = $("bubble");
    const x = Math.min(Math.max(p.x, 12), b.parentElement.clientWidth - b.offsetWidth * 0.9 - 12);
    b.style.left = `${x}px`;
    b.style.top = `${Math.max(p.y, b.offsetHeight + 12)}px`;
  }
  requestAnimationFrame(placeBubble);
}
requestAnimationFrame(placeBubble);

// ---------------- rendering state ----------------
async function loadCharacter() {
  const c = activeChar();
  $("charName").textContent = c.name;
  $("talkInput").placeholder = `Talk to ${c.name}…`;
  document.title = c.name;
  room.setScreenName(c.name);
  $("loading").hidden = !c.model;
  try {
    await room.setModel(c.model, { flip: !!c.flip, outfit: c.outfit || "", hair: c.hair || "" });
  } catch (e) {
    console.error(e);
    toast(c.model.toLowerCase().endsWith(".vrm")
      ? "Couldn't load the VRM model. VRM support is missing — run: python scripts/setup_local.py"
      : `Couldn't load ${c.model}. Try exporting it again as .glb.`, 6000);
    await room.setModel("");
  } finally {
    $("loading").hidden = true;
  }
}

function renderStatus() {
  const s = state;
  $("voiceBtn").setAttribute("aria-pressed", s.listening);
  $("voiceSub").textContent = s.listening ? "Say “vermi” to talk" : "Off";
  $("cameraBtn").setAttribute("aria-pressed", s.camera);
  if (!s.camera) $("cameraSub").textContent = "Off";
  $("charStatus").textContent = s.tts === "starting" ? "Warming up her voice…" : s.tts ? "Ready" : "Ready (text only)";
  $("faceNote").textContent = s.owner
    ? `She knows your face, ${s.owner}. Teach it again if she stops recognising you.`
    : "Teach the AI your face so it knows when it's you.";
  if (s.owner && !$("ownerName").value) $("ownerName").value = s.owner;
  for (const box of document.querySelectorAll("input[data-setting]")) box.checked = !!s.settings[box.dataset.setting];
  $("styleSelect").value = s.settings.style || "companion";
  $("humorSelect").value = String(s.settings.humor ?? 2);
  $("voiceStyleSelect").value = s.settings.voice_style || "normal";
  room.setMirror(s.settings.mirror_look);
}

function renderCharacters() {
  const list = $("charList");
  list.replaceChildren();
  for (const c of state.characters) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.setAttribute("aria-current", c.id === editingId);
    const left = document.createElement("span");
    left.innerHTML = `<strong></strong><br><span class="model"></span>`;
    left.querySelector("strong").textContent = c.name;
    left.querySelector(".model").textContent = c.model === "builtin:penguin" ? "Pip the penguin" : c.model || "Sketch figure";
    b.append(left);
    if (c.id === state.active) {
      const tag = document.createElement("span");
      tag.className = "active-tag";
      tag.textContent = "Talking";
      b.append(tag);
    }
    b.addEventListener("click", () => openEditor(c.id));
    li.append(b);
    list.append(li);
  }
}

function fillModelSelect(selected = "") {
  const sel = $("modelSelect");
  sel.replaceChildren(new Option("None (sketch figure)", ""), new Option("Pip the penguin (built in)", "builtin:penguin"));
  for (const m of state.models) sel.append(new Option(m, m));
  sel.value = selected;
}

// Outfit / hair pickers - only for models that come with outfits (like the anime girl)
const LOOK_NAMES = { mech: "Mech gear", city: "City clothes", school: "School uniform", base: "Basic", original: "Original",
  cute_1: "Cute 1", cute_2: "Cute 2", short: "Short" };
function fillLook(c) {
  const L = room.char?.looks;
  const show = !!L && c.model && c.model === activeChar().model;
  $("lookRow").hidden = !show;
  if (!show) return;
  const fill = (sel, keys, val) => { sel.replaceChildren(...keys.map((k) => new Option(LOOK_NAMES[k] || k, k))); sel.value = val; };
  fill($("outfitSelect"), Object.keys(L.outfit), room.char.look?.outfit);
  fill($("hairSelect"), Object.keys(L.hair), room.char.look?.hair);
}
for (const id of ["outfitSelect", "hairSelect"]) {
  $(id).addEventListener("change", () => room.setLook({ outfit: $("outfitSelect").value, hair: $("hairSelect").value }));   // live preview
}

function openEditor(id) {
  editingId = id;
  const c = state.characters.find((x) => x.id === id) || { name: "", prompt: "", voice: "", model: "", rate: "+0%", pitch: "+0Hz" };
  const f = $("editor");
  f.name.value = c.name;
  f.prompt.value = c.prompt;
  showVoice(c.voice);
  if ($("voiceOnlineSelect")) loadOnlineVoices(c.voice_online || "");
  loadRvc(c.rvc || {});
  f.rate.value = num(c.rate); f.pitch.value = num(c.pitch);
  f.volume.value = c.volume ?? 100;
  f.emotion.value = c.emotion ?? 100;
  for (const n of ["rate", "pitch", "volume", "emotion"]) f[n].dispatchEvent(new Event("input"));
  f.natural.checked = c.natural ?? true;
  f.emotional.checked = !!c.emotional;
  showChatterNote();
  f.flip.checked = !!c.flip;
  f.language.value = c.language || "auto";
  f.translate.checked = !!c.translate;
  fillModelSelect(c.model);
  fillLook(c);
  $("deleteChar").hidden = !id;
  $("useChar").hidden = !id || id === state.active;
  f.hidden = false;
  renderCharacters();
  f.name.focus();
}

// ---------------- drawers ----------------
function openPanel(name) {
  for (const p of document.querySelectorAll(".panel")) p.hidden = p.id !== `panel-${name}` || !p.hidden;
  for (const b of document.querySelectorAll("[data-panel]")) b.classList.toggle("open", !$(`panel-${b.dataset.panel}`).hidden);
  const open = !$(`panel-${name}`).hidden;
  if (name === "characters" && open) {
    renderCharacters();
    if (!voices.length) loadVoices().then(() => openEditor(state.active)); else openEditor(state.active);
  }
  api?.set_preview(name === "settings" && open && state?.camera);
  if (name === "settings" && open) { renderDevices(); renderGcal(); renderWake(); renderPeople(); renderOutfit(); renderPrefs(); renderAi(); renderPc(); renderProd(); }
  if (name === "planner" && open) renderPlanner();
  if (name === "study" && open) study.load(state.ui?.study_tab);
  if (name === "code" && open) codePanel.load();
  if (name === "mind" && open) mind.load();
  if (name === "gym" && open) gym.load();
  if (name === "electronics" && open) elecPanel.load();
  if (name === "generator" && open) genPanel.load();
  if (name === "music" && open) musicPanel.load();
  if (name === "kitchen" && open) kitchenTab(state.ui?.kitchen_tab);
  if (name === "focus" && open) focusPanel.load();
  if (name === "chat" && open) chat.load();
  if (name === "missions" && open) missionsPanel.load();
  if (name === "spotify" && open) spotifyPanel.load();
  if (!open || name !== "settings") $("preview").hidden = true;
}
for (const b of document.querySelectorAll("[data-panel]")) b.addEventListener("click", () => openPanel(b.dataset.panel));
for (const c of document.querySelectorAll(".panel .close")) {
  c.addEventListener("click", () => openPanel(c.closest(".panel").id.replace("panel-", "")));
}
document.addEventListener("keydown", (e) => {
  const open = document.querySelector(".panel:not([hidden])");
  if (e.key === "Escape" && open) openPanel(open.id.replace("panel-", ""));
});

// ---------------- events from Python ----------------
window.onPyEvent = async (e) => {
  life?.onEvent(e);
  switch (e.type) {
    case "lip": room.setLip(e.levels, e.step); break;
    case "speaking": fx.speaking(e.on); room.setSpeaking(e.on); bgm.speaking = !!e.on; updateBgm(); if (e.on && e.text) say(e.text); break;
    case "heard": addLog("you", e.text); break;
    case "partial": say(e.text); break;
    case "gcal": renderGcal(e); break;
    case "spotify_login": spotifyPanel?.onEvent(e); break;
    case "objects": seenObjects = e.labels || []; if (!$("sees").hidden && state.camera) $("sees").dataset.objects = seenObjects.length ? `· ${seenObjects.slice(0, 4).join(", ")}` : ""; break;
    case "reply": say(e.text); addLog("her", e.text); break;
    case "ask":
      asking = true;
      say(e.text, { ask: true });
      addLog("her", e.text);
      $("talkInput").placeholder = "Type your answer…";
      $("talkInput").focus();
      break;
    case "listening":
      state.listening = e.state !== "off";
      bgm.awake = e.state === "awake"; updateBgm();
      renderStatus();
      if (e.state === "awake") $("voiceSub").textContent = "Listening…";
      break;
    case "tts": state.tts = e.status === "ready" ? true : e.status === "starting" ? "starting" : false; renderStatus(); break;
    case "camera":
      state.camera = e.status === "on";
      renderStatus();
      if (e.status === "on") $("cameraSub").textContent = "On · looking for you";
      if (e.status === "error") { toast(e.message, 8000); state.camera = false; renderStatus(); }
      if (e.status === "downloading") { $("cameraSub").textContent = "Downloading face files…"; toast(e.message, 8000); }
      if (!state.camera) { $("sees").hidden = true; room.lookAt(null); }
      break;
    case "presence": {
      const sees = $("sees");
      if (!e.present) {
        sees.hidden = true;
        $("cameraSub").textContent = "On · nobody here";
        room.lookAt(null);
      } else {
        sees.hidden = false;
        sees.textContent = e.who === "owner" ? `Sees you, ${e.name}` : e.who === "known" ? `Sees ${e.name}` : "Sees someone";
        $("cameraSub").textContent = e.who === "owner" ? `On · sees ${e.name}` : e.who === "known" ? `On · sees ${e.name}` : "On · sees someone";
        room.lookAt(e.x, e.y);
      }
      break;
    }
    case "look": room.lookAt(e.x, e.y); break;
    case "preview": if (!$("panel-settings").hidden) { $("preview").src = `data:image/jpeg;base64,${e.jpg}`; $("preview").hidden = false; } break;
    case "enroll": {
      const bar = $("enrollBar");
      bar.hidden = e.status === "done";
      bar.firstElementChild.style.width = `${Math.round((e.progress || 0) * 100)}%`;
      if (e.status === "started") toast("Look at the camera for a few seconds…");
      if (e.status === "done" && e.owner === false) { renderPeople(); toast(`Got it — I'll recognise ${e.name} now.`); }
      else if (e.status === "done") { state.owner = e.name; renderStatus(); toast(`Got it — I'll recognise you now, ${e.name}.`); }
      break;
    }
    case "error": toast(e.text, 5000); break;
    case "toast": toast(e.text); break;
    case "animate_progress": rigEvent(e); break;
    case "rvc_progress": rvcBar(e); break;
    case "setup_progress": setupEvent(e); break;
    case "tool": renderPlanner(); if (e.name?.startsWith("gym_log")) gym?.load(); break;
    case "ai_switch":
      aiNow = e.now; toast(e.text, 6000); renderHud();
      if (!$("panel-settings").hidden) renderAi();
      break;
    case "meeting":
      if (e.on && !meeting.on) meeting = { on: true, since: Date.now(), busy: false };
      if (!e.on) meeting = { on: false, since: 0, busy: !!e.busy };
      renderHud(); break;
    case "settings": state.settings = e.settings; renderStatus(); break;
    case "interrupted": toast("Okay — I'm listening.", 2000); break;
    case "focus_started": focusPanel?.startFromVoice(e); break;
    case "focus_distracted": focusPanel?.distracted(e); break;
    case "focus_input": setCollapsed(false); $("talkInput").focus(); break;
    case "gym_cmd": gym?.command(e.action, e.seconds); renderHud(); break;
    case "plugin": pluginsUI?.onEvent(e); break;
    case "gen": genPanel?.onEvent(e); break;
    case "music": music = e; renderHud(); break;
    case "character":
      state = await api.get_state();
      renderCharacters(); renderStatus(); await loadCharacter();
      toast(`Switched to ${activeChar().name}.`);
      break;
    case "code_step": case "code_approve": case "code_workspace": case "code_user": case "code_reply": codePanel?.onEvent(e); break;
    case "open_panel":                                       // a voice command ("open the gym", "what can I say?")
      if (e.panel === "adventure") { $("adventureBtn")?.click(); break; }
      setCollapsed(false);
      if ($(`panel-${e.panel}`)?.hidden) openPanel(e.panel);
      if (e.tab && e.panel === "settings") window.showSettingsTab?.(e.tab);
      if (e.tab && e.panel === "study") window.showStudyTab?.(e.tab);
      break;
    case "performance": renderPerformance(e); break;
    case "phone": renderPhone(e); break;
    case "phone_chat": addLog("you", `📱 ${e.you}`); addLog("her", e.reply); break;
    case "partner": window.dispatchEvent(new CustomEvent("partner", { detail: e })); break;
    case "app_update": showAppUpdate(e); break;
    case "quest": window.dispatchEvent(new CustomEvent("quest", { detail: e })); break;
    case "study_media": window.dispatchEvent(new CustomEvent("study-media", { detail: e })); break;
    case "characters_changed":
      state = await api.get_state();
      renderCharacters(); renderStatus(); await loadCharacter();
      break;
    case "alert": fx.play("notify"); toast(`⏰ ${e.text}`, 10000); renderPlanner(); break;
    case "group_line": say(`${e.speaker}: ${e.text}`); addLog("her", `${e.speaker}: ${e.text}`); break;
    case "mission": missionsPanel?.update(e.mission); renderHud(); break;
    case "approval": showApproval(e); break;
    case "approval_done": document.querySelector(`#approvals [data-id="${e.id}"]`)?.remove(); break;
    case "milestone": toast(`🎉 ${e.text}`, 7000); room.playEmote("celebrate"); chat?.refreshStory(); break;
    case "story": chat?.refreshStory(); break;
    case "group_done": toast("The group chat ended.", 2500); break;
    case "gesture": toast({ thumbs_up: "👍", thumbs_down: "👎", peace: "✌", wave: "👋", stop: "✋ Stopped", ok: "👌", heart: "🫶" }[e.gesture] || e.gesture, 1800); break;
  }
};

async function renderAi(given) {
  const box = $("aiStatus");
  try {
    const s = given || await api.ai_status();
    $("aiProvider").value = s.provider;
    const now = s.now_now === "groq"
      ? el("div", { class: "ai-now groq" }, `Answering now: Groq (${s.groq_models.chat})`)
      : el("div", { class: "ai-now local" }, `Answering now: local AI (${s.models.chat})${s.now_reason ? ` — ${s.now_reason}` : ""}`);
    box.replaceChildren(...[
      now,
      s.provider !== "local" && !s.has_groq_key ? el("div", { class: "warn" }, "No GROQ_API_KEY in your .env file.") : null,
      el("div", {}, s.running ? "Local AI (Ollama): running" : "Local AI (Ollama): not running — open the Ollama app"),
      el("div", {}, `Local models: ${s.models.chat} · ${s.models.smart} · camera ${s.models.vision}`),
      el("div", {}, `Listening: Whisper (${s.whisper}) · Voices installed: ${s.voices.length}`),
      s.missing.length ? el("div", { class: "warn" }, `Not downloaded yet: ${s.missing.join(", ")} — run: python scripts/setup_local.py`) : null].filter(Boolean));
  } catch (e) { box.textContent = "Couldn't check the AI."; }
}
$("aiProvider").addEventListener("change", async (e) => {
  const s = await api.set_ai_provider(e.target.value);
  if (s.error) return toast(s.error);
  renderAi(s);
  toast({ auto: "Auto: Groq first, local AI as backup.", groq: "Using Groq only.", local: "Using the local AI only." }[e.target.value]);
});

// ---------------- internet & calendar settings ----------------
async function renderProd(given) {
  const p = given || await api.productivity_settings();
  if (document.activeElement !== $("homeCity")) $("homeCity").value = p.home_city || "";
  if (document.activeElement !== $("newsTopics")) $("newsTopics").value = (p.news_topics || []).join(", ");
  if (document.activeElement !== $("icalUrl")) $("icalUrl").value = p.ical_url || "";
  $("icalStatus").textContent = p.ical_url ? (p.ical_synced ? `Last synced ${p.ical_synced}.` : "Not synced yet.") : "";
}
for (const [id, key, parse] of [["homeCity", "home_city", (v) => v], ["icalUrl", "ical_url", (v) => v],
  ["newsTopics", "news_topics", (v) => v.split(",").map((x) => x.trim()).filter(Boolean)]]) {
  $(id).addEventListener("change", async (e) => { renderProd(await api.save_productivity({ [key]: parse(e.target.value) })); toast("Saved."); });
}
$("icalSync").addEventListener("click", async (e) => {
  busy(e.target, true, "Syncing…");
  try { const r = await api.calendar_sync_now(); toast(r.error || r.message, 6000); renderProd(); renderPlanner(); }
  finally { busy(e.target, false); }
});
$("icalExport").addEventListener("click", async () => { const r = await api.calendar_export(); toast(r.message, 9000); });

// ---------------- meeting notes ----------------
let meeting = { on: false, since: 0, busy: false };
window.addEventListener("vermeil:meeting", () => toggleMeeting());
async function toggleMeeting() {
  if (meeting.on) {
    meeting = { on: false, since: 0, busy: true }; renderHud();
    const r = await api.meeting(false); meeting.busy = false; renderHud();
    say(r.message); addLog("her", r.message); renderPlanner();
  } else {
    const r = await api.meeting(true, "");
    toast(r.message, 6000);
  }
}

// ---------------- this PC (status, crashes, macros) ----------------
async function renderPc() {
  const box = $("pcBox");
  try {
    const o = await api.pc_overview();
    if (o.stats_error) box.textContent = `Couldn't read PC stats: ${o.stats_error}`;
    else {
      const s = o.stats, bar = (pct) => el("span", { class: `meter${pct > 85 ? " hot" : ""}` }, el("i", { style: `width:${Math.min(100, pct)}%` }));
      box.replaceChildren(...[
        el("div", { class: "stat" }, el("span", {}, `CPU ${Math.round(s.cpu_percent)}%${s.cpu_temp_c ? ` · ${s.cpu_temp_c}°C` : ""}`), bar(s.cpu_percent)),
        el("div", { class: "stat" }, el("span", {}, `RAM ${s.ram_used_gb}/${s.ram_total_gb} GB`), bar(s.ram_percent)),
        s.gpu ? el("div", { class: "stat" }, el("span", {}, `GPU ${Math.round(s.gpu.use_percent)}% · ${s.gpu.temp_c}°C · ${s.gpu.memory_used_gb}/${s.gpu.memory_total_gb} GB`), bar(s.gpu.use_percent)) : null,
        ...s.disks.map((d) => el("div", { class: "stat" }, el("span", {}, `Disk ${d.drive} · ${d.free_gb} GB free`), bar(d.used_percent))),
        s.battery ? el("div", {}, `Battery ${Math.round(s.battery.percent)}%${s.battery.plugged_in ? " (charging)" : ""}`) : null].filter(Boolean));
    }
    const names = Object.keys(o.macros);
    $("macroList").replaceChildren(...(names.length ? names.map((n) => el("li", {}, el("span", { title: o.macros[n].steps.map((x) => x.tool).join(" → ") }, n),
      el("button", { "aria-label": `Delete macro ${n}`, onclick: async () => { await api.pc_delete_macro(n); renderPc(); } }, "×")))
      : [el("li", { class: "empty" }, "No macros yet.")]));
  } catch (e) { box.textContent = "Couldn't read this PC's status."; }
}
$("pcRefresh").addEventListener("click", renderPc);
$("pcCrashes").addEventListener("click", async () => {
  const c = await api.pc_crashes();
  $("pcCrashList").replaceChildren(...(c.length ? c.map((x) => el("div", {}, `${x.when} · ${x.app} ${x.kind}${x.module ? ` (${x.module})` : ""}`))
    : [el("div", {}, "No app crashes in the last 2 days.")]),
    c.length ? el("div", {}, "Ask her “why did it crash?” for fixes.") : "");
});

// ---------------- sounds & effects settings ----------------
function syncFxControls() {
  const o = fx.settings();
  $("sfxOn").checked = o.sfx; $("fxOn").checked = o.fx;
  $("sfxVol").value = Math.round(o.volume * 100); $("sfxVolOut").textContent = `${$("sfxVol").value}%`;
}
function saveFx(change) {
  fx.configure(change);
  const o = fx.settings();
  api.save_ui({ sfx: o.sfx, sfx_volume: o.volume, fx: o.fx });
  syncFxControls();
}
$("sfxOn").addEventListener("change", (e) => { saveFx({ sfx: e.target.checked }); fx.play("on"); });
$("fxOn").addEventListener("change", (e) => saveFx({ fx: e.target.checked }));
$("sfxVol").addEventListener("input", (e) => { $("sfxVolOut").textContent = `${e.target.value}%`; fx.configure({ volume: e.target.value / 100 }); });
$("sfxVol").addEventListener("change", (e) => { saveFx({ volume: e.target.value / 100 }); fx.play("toast"); });

// ---------------- background music in the room (a PSP-style tune made in code, psp.js) ----------------
// It rests while your own music (My Music / Spotify) plays, while a meeting is recorded and while the window is hidden,
// and it goes quiet while she talks or while you give a voice command.
const bgm = { on: true, volume: 0.5, theme: "room", speaking: false, awake: false };
function updateBgm() {
  const own = (music.playing && !music.paused) || !!spotifyPanel?.status()?.playing;
  if (bgm.on && bgm.volume > 0 && !document.hidden && !own && !meeting.on) psp.musicStart(bgm.theme); else psp.musicStop(1.2);
  psp.duck(bgm.speaking ? 0.3 : bgm.awake ? 0.35 : 1);
}
function syncBgmControls() {
  $("bgmOn").checked = bgm.on;
  $("bgmVol").value = Math.round(bgm.volume * 100); $("bgmVolOut").textContent = `${$("bgmVol").value}%`;
  psp.setMusicVolume(bgm.volume * 0.9);
  $("bgmTheme").value = bgm.theme;
}
$("bgmTheme").replaceChildren(new Option("Shuffle (changes every few minutes)", "shuffle"), ...psp.THEME_LIST.map(([k, l]) => new Option(l, k)));
$("sfxStyle").replaceChildren(...psp.SFX_LIST.map(([k, l]) => new Option(l, k)));
$("bgmTheme").addEventListener("change", (e) => { bgm.theme = e.target.value; api.save_ui({ bgm_theme: bgm.theme }); updateBgm(); });
$("sfxStyle").addEventListener("change", (e) => { psp.setSfxStyle(e.target.value); api.save_ui({ sfx_style: e.target.value }); fx.play("tap"); });
$("sfxPitch").replaceChildren(...psp.PITCH_LIST.map(([k, l]) => new Option(l, k)));
$("sfxPitch").value = "normal";
$("sfxPitch").addEventListener("change", (e) => { psp.setSfxPitch(e.target.value); api.save_ui({ sfx_pitch: e.target.value }); fx.play("tap"); });
$("bgmOn").addEventListener("change", (e) => { bgm.on = e.target.checked; api.save_ui({ bgm: bgm.on }); updateBgm(); });
$("bgmVol").addEventListener("input", (e) => { bgm.volume = e.target.value / 100; syncBgmControls(); updateBgm(); });
$("bgmVol").addEventListener("change", () => api.save_ui({ bgm_volume: bgm.volume }));
document.addEventListener("visibilitychange", updateBgm);
$("alarmVol").addEventListener("input", (e) => { $("alarmVolOut").textContent = `${e.target.value}%`; fx.setAlarmVolume(e.target.value / 100); });
$("alarmVol").addEventListener("change", (e) => { api.save_ui({ alarm_volume: e.target.value / 100 }); fx.alarm({ bursts: 1 }); });
$("alarmTest").addEventListener("click", () => fx.alarm());

// pronunciations: "word = how to say it", one per line (senses/expressive.py)
async function loadPronunciations() {
  try { $("pronunciations").value = (await api.get_pronunciations()) || ""; } catch { /* older backend */ }
}
$("savePronunciations").addEventListener("click", async () => {
  const n = await api.save_pronunciations($("pronunciations").value);
  toast(n ? `Saved ${n} pronunciation${n === 1 ? "" : "s"}.` : "Pronunciations cleared.");
});
document.addEventListener("pointerdown", () => fx.stopAlarm(), true);     // any click stops a ringing alarm

// ---------------- status bar (top-left, shown when the menu is hidden) ----------------
let music = { playing: false, title: "" }, thinking = false, aiNow = "";
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
function chip(cls, icon, text, buttons = [], onclick = null) {
  return el("div", { class: `hud-chip ${cls}`, "data-key": cls.split(" ")[0], onclick, role: onclick ? "button" : null, tabindex: onclick ? 0 : null },
    el("span", { class: "hud-icon", "aria-hidden": "true" }, icon), el("span", { class: "hud-text" }, text),
    ...buttons.map(([label, aria, fn]) => el("button", { class: "hud-btn", "aria-label": aria, title: aria,
      onclick: (ev) => { ev.stopPropagation(); fn(); } }, label)));
}
function renderHud() {
  const hud = $("hud");
  const chips = [];
  if (meeting.on) chips.push(chip("rec", "🔴", `Recording meeting ${fmt(Math.floor((Date.now() - meeting.since) / 1000))}`,
    [["■", "Stop and make notes", toggleMeeting]]));
  if (meeting.busy) chips.push(chip("thinking", "📝", "Writing meeting notes…"));
  const f = focusPanel?.status();
  if (f) {
    $("focusSub").textContent = `${f.phase === "work" ? "Focusing" : "Break"} · ${fmt(f.left)}`;
    if (document.body.classList.contains("collapsed") || $("panel-focus").hidden)
      chips.push(chip(`focus ${f.phase}`, f.phase === "work" ? "🎯" : "☕", `${f.phase === "work" ? "Focus" : "Break"} ${fmt(f.left)} · ${f.round}/${f.rounds}`,
        [], () => { setCollapsed(false); if ($("panel-focus").hidden) openPanel("focus"); }));
  } else if ($("focusSub")) $("focusSub").textContent = "Focus sessions, your trends";
  const ms = missionsPanel?.status();
  if (ms) {
    $("missionsSub").textContent = `${ms.count} running · ${ms.done}/${ms.total} steps`;
    if (document.body.classList.contains("collapsed"))
      chips.push(chip(ms.busy ? "thinking" : "mission", "🚀", `${ms.title.length > 26 ? ms.title.slice(0, 25) + "…" : ms.title} ${ms.done}/${ms.total}`, [],
        () => { setCollapsed(false); openPanel("missions"); }));
  } else if ($("missionsSub")) $("missionsSub").textContent = "Bigger goals, done step by step";
  if (state?.settings?.privacy_mode) chips.push(chip("privacy", "🔒", "Camera privacy on", [], () => { setCollapsed(false); openPanel("settings"); }));
  if (!document.body.classList.contains("collapsed")) { setHud(hud, chips); return; }
  const g = gym?.status();
  if (g?.timer) chips.push(chip(`timer${g.timer.left <= 5 && g.timer.running ? " ending" : ""}`, "⏱", `${fmt(g.timer.left)} · ${g.timer.label}`, [
    [g.timer.running ? "❚❚" : "▶", g.timer.running ? "Pause timer" : "Resume timer", () => gym.command(g.timer.running ? "pause" : "resume")],
    ["↺", "Restart timer", () => gym.command("restart")], ["⏭", "Skip", () => gym.command("skip")]]));
  if (g?.workout != null) chips.push(chip("workout", "🏋", `Workout ${fmt(g.workout)}`, [], () => { setCollapsed(false); openPanel("gym"); }));
  const sp = spotifyPanel?.status();
  if (sp && !music.playing) chips.push(chip("music spotify", "🟢", `${sp.track.title} · ${sp.track.artist}`, [
    [sp.playing ? "❚❚" : "▶", sp.playing ? "Pause" : "Play", () => spotifyPanel.cmd(sp.playing ? "pause" : "resume")],
    ["⏭", "Next song", () => spotifyPanel.cmd("next")], ["♥", "Save to Liked Songs", () => spotifyPanel.cmd("like", true)]],
    () => { setCollapsed(false); if ($("panel-music").hidden) openPanel("music"); musicPanel.openTab("spotify"); }));
  if (music.playing) chips.push(chip("music", "🎵", music.title || "Music playing", [
    [music.paused ? "▶" : "❚❚", music.paused ? "Resume" : "Pause", async () => { await api.music(music.paused ? "resume" : "pause"); music.paused = !music.paused; renderHud(); }],
     ["⏭", "Next song", () => api.music("skip")], ["♥", "Add to favorites", async () => toast(await api.music("favorite"))], ["■", "Stop music", () => api.music("stop")]]));
  if (state?.listening) chips.push(chip("voice", "🎙", "Listening"));
  if (thinking) chips.push(chip("thinking", "💭", `${activeChar().name} is thinking…`));
  if (aiNow === "local") chips.push(chip("ai-local", "💻", "Local AI (Groq ran out)", [], () => { setCollapsed(false); openPanel("settings"); }));
  if (state?.camera) chips.push(chip("camera", "📷", "Camera on"));
  setHud(hud, chips);
}
// update pills in place (no flicker); only brand-new pills fade in
function setHud(hud, chips) {
  const old = new Map([...hud.children].map((c) => [c.dataset.key, c]));
  const out = chips.map((c) => {
    const prev = old.get(c.dataset.key);
    if (!prev) return c;
    prev.className = c.className;
    prev.replaceChildren(...c.childNodes);
    return prev;
  });
  const same = out.length === hud.children.length && out.every((c, i) => hud.children[i] === c);
  if (!same) hud.replaceChildren(...out);
}
setInterval(renderHud, 500);

// ---------------- controls ----------------
// Screen helper: she looks at what's behind the window and explains it (the text box = your question)
$("screenHelp").addEventListener("click", async (e) => {
  const q = $("talkInput").value.trim(), btn = e.currentTarget;
  $("talkInput").value = "";
  busy(btn, true, "…");
  toast("Looking at your screen… (Vermeil hides for a moment)", 4000);
  try {
    const r = await api.screen_help(q);
    if (r.error) toast(r.error, 7000);
  } finally { busy(btn, false); }
});

$("talkForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const input = $("talkInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  addLog("you", text);
  if (asking) { asking = false; input.placeholder = `Talk to ${activeChar().name}…`; $("bubble").hidden = true; }
  thinking = true; renderHud(); fx.thinking(true);
  let reply;
  try { reply = await api.chat(text); } finally { thinking = false; renderHud(); fx.thinking(false); }
  if (reply) { say(reply); addLog("her", reply); }
});

$("voiceBtn").addEventListener("click", async () => {
  state.listening = await api.set_listening(!state.listening);
  renderStatus();
});

$("cameraBtn").addEventListener("click", async () => {
  const on = !state.camera;
  $("cameraSub").textContent = on ? "Opening…" : "Off";
  await api.set_camera(on);
  if (!on) { state.camera = false; renderStatus(); }
});

$("enrollBtn").addEventListener("click", async () => {
  const name = $("ownerName").value.trim();
  if (!name) { $("ownerName").focus(); toast("Type your name first."); return; }
  await api.enroll_face(name);
  api.set_preview(true);
});
$("forgetBtn").addEventListener("click", async () => {
  await api.forget_face();
  state.owner = null;
  renderStatus();
  toast("Your face was forgotten.");
});
// ---------------- approvals (missions etc. ask before risky things) ----------------
function showApproval(e) {
  const card = el("div", { class: "approval", "data-id": e.id, role: "alertdialog", "aria-label": "Needs your OK" },
    el("p", {}, e.text));
  const decide = (yes) => async () => { await api.approve(e.id, yes); card.remove(); toast(yes ? "Okay, going ahead." : "Okay, I won't."); };
  card.append(el("div", { class: "row" }, el("button", { class: "primary", onclick: decide(true) }, "Yes"), el("button", { class: "ghost", onclick: decide(false) }, "No")));
  $("approvals").append(card);
  fx.play("alert");
}

// ---------------- Google Calendar (adding events) ----------------
function renderGcal(st) {
  if (!st) return api.gcal_status().then(renderGcal);
  $("gcalStatus").textContent = !st.libs ? "Install the Google packages first (see the steps above), then restart Vermeil."
    : st.connected ? "✅ Connected — events she adds also go into your Google Calendar."
    : st.has_credentials ? "File saved. Click Connect — a Google page will open in your browser."
    : "Not set up yet.";
  $("gcalConnect").hidden = st.connected; $("gcalOff").hidden = !st.connected;
  $("gcalConnect").disabled = !st.has_credentials || !st.libs;
  if (st.error) toast(st.error, 6000);
}
$("gcalFile").addEventListener("click", async () => renderGcal(await api.gcal_choose_file()));
$("gcalConnect").addEventListener("click", async () => { await api.gcal_connect(); toast("Finish in the Google page that opened in your browser.", 6000); });
$("gcalOff").addEventListener("click", async () => renderGcal(await api.gcal_disconnect()));
for (const a of document.querySelectorAll("a[data-open]")) a.addEventListener("click", (e) => { e.preventDefault(); api.open_url(a.dataset.open); });

// ---------------- your own wake word ----------------
async function renderWake(st) {
  st = st || await api.wake_status();
  const dots = [...$("wakeDots").children];
  dots.forEach((d, i) => d.classList.toggle("on", i < st.samples));
  $("wakeSave").disabled = st.samples < 3;
  $("wakeTest").disabled = !st.trained;
  $("wakeSens").value = String(st.sensitivity || 2);
  $("wakeNote").textContent = st.trained
    ? `✅ Trained${st.when ? ` (${st.when})` : ""}. She wakes up to your own “vermi”. Record 4 again + Save to retrain.`
    : "Teach her how YOU say “vermi”: click Record and say it — 4 times. Then she wakes up to your voice instantly, offline.";
}
$("wakeRecord").addEventListener("click", async (e) => {
  busy(e.target, true, "Listening… say “vermi”");
  const r = await api.wake_record();
  busy(e.target, false);
  if (r.error) return toast(r.error, 5000);
  fx.play("success");
  renderWake({ ...(await api.wake_status()), samples: r.samples });
});
$("wakeSave").addEventListener("click", async () => {
  const r = await api.wake_train();
  if (r.error) return toast(r.error, 6000);
  toast(`Saved! Learned from ${r.samples} recordings.`);
  renderWake(r);
});
$("wakeTest").addEventListener("click", async (e) => {
  busy(e.target, true, "Say “vermi”…");
  const r = await api.wake_test();
  busy(e.target, false);
  if (r.error) return toast(r.error, 5000);
  toast(r.match ? "✅ Yes — that woke me up." : `❌ Didn't match (${r.score ?? "no sound"} vs ${r.threshold}). Try again, or set it to Easy.`, 5000);
});
$("wakeClear").addEventListener("click", async () => { renderWake(await api.wake_clear()); toast("Back to the normal wake word."); });
$("wakeSens").addEventListener("change", async (e) => { state.settings = await api.save_settings({ wake_sensitivity: Number(e.target.value) }); });

// ---------------- people she knows ----------------
async function renderPeople() {
  const list = $("peopleList");
  const people = (await api.known_people?.()) || [];
  list.replaceChildren(...(people.length ? people.map((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><button class="x" aria-label="Forget">×</button>`;
    li.firstChild.textContent = p.relation ? `${p.name} · ${p.relation}` : p.name;
    li.querySelector("button").addEventListener("click", async () => { await api.forget_person(p.name); toast(`Forgot ${p.name}'s face.`); renderPeople(); });
    return li;
  }) : [Object.assign(document.createElement("li"), { className: "none", textContent: "Nobody yet." })]));
}
$("personEnroll").addEventListener("click", async () => {
  const name = $("personName").value.trim();
  if (!name) { $("personName").focus(); toast("Type their name first."); return; }
  if (state.settings.privacy_mode) { toast("Turn off camera privacy mode first."); return; }
  if (!state.camera) await api.set_camera(true);
  await api.enroll_face(name, false, $("personRelation").value.trim());
  api.set_preview(true);
  toast(`Ask ${name} to look at the camera for a few seconds…`, 5000);
});

// ---------------- outfit ----------------
function outfit() { return { auto: false, hat: "none", glasses: false }; }   // no hats or glasses
function renderOutfit() {}                                    // (hats & glasses were removed)
// ---------------- living character ----------------
let life = null;
let seenObjects = [];
let birthdayToday = false;
async function checkBirthday() {
  try {
    const p = await api.get_planner();
    const d = new Date();
    const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const me = new Set(["me", "my", "myself", "my birthday", "mine", (state.owner || "").toLowerCase()].filter(Boolean));
    birthdayToday = (p.birthdays || []).some((b) => me.has(String(b.name).toLowerCase()) && String(b.date).endsWith(md));
  } catch { birthdayToday = false; }
}
function lifeContext() {
  const s = state?.settings || {};
  const g = gym?.status?.();
  const f = focusPanel?.status?.();
  return {
    date: new Date(), idle: s.idle_activities !== false, scenes: s.scene_transitions !== false, editing: room.editMode,
    outfit: outfit(), birthday: birthdayToday,
    gym: !$("panel-gym").hidden || g?.workout != null, study: !$("panel-study").hidden,
    focus: !!f && f.phase === "work", music: (!!music.playing && !music.paused) || !!spotifyPanel?.status()?.playing,
    style: s.style, voiceStyle: s.voice_style,
  };
}
function startLife() {
  life = initLife(room, {
    getContext: lifeContext,
    onActivity: (label) => { const t = $("activityTag"); t.hidden = !label; if (label) t.textContent = `${activeChar().name} is ${label}`; },
  });
  checkBirthday();
  setInterval(checkBirthday, 3600 * 1000);
}

$("voiceStyleSelect").addEventListener("change", async (e) => {
  state.settings = await api.save_settings({ voice_style: e.target.value });
  toast(`Voice style: ${e.target.selectedOptions[0].textContent}.`);
});
$("humorSelect").addEventListener("change", async (e) => {
  state.settings = await api.save_settings({ humor: Number(e.target.value) });
});
$("styleSelect").addEventListener("change", async (e) => {
  state.settings = await api.save_settings({ style: e.target.value });
  toast(`She'll talk like a ${e.target.selectedOptions[0].textContent.split(" (")[0].toLowerCase()} now.`);
});
for (const box of document.querySelectorAll("input[data-setting]")) {
  box.addEventListener("change", async () => {
    state.settings = await api.save_settings({ [box.dataset.setting]: box.checked });
    renderStatus();
  });
}

$("newChar").addEventListener("click", () => openEditor(null));
$("importModel").addEventListener("click", async () => {
  const name = await api.import_model();
  if (!name) return;
  if (!state.models.includes(name)) state.models.push(name);
  fillModelSelect(name);
  toast(`Imported ${name}. Save the character to use it.`);
  if (/\.(glb|gltf)$/i.test(name)) rig(name, true);      // asks about the rig (keep it / look / rig it yourself)
});
function rig(name, fromImport = false) {
  openRigger(name, {
    api, toast, fromImport,
    onSaved: (saved, animated) => {
      if (!state.models.includes(saved)) state.models.push(saved);
      fillModelSelect(saved);
      if (animated && !$("editor").hidden) $("editor").requestSubmit();   // UniMate's animations: use them right away
    },
  });
}
$("rigModel").addEventListener("click", () => {
  const name = $("modelSelect").value;
  if (!name || name.startsWith("builtin:")) return toast("Pick an imported model first.");
  if (/\.vrm$/i.test(name)) return toast("VRM models already come with a rig.");
  rig(name);
});
// "copy a character": type a name (Rick Sanchez, Jake the Dog…), press ✓ (or Enter) -> the AI writes how they talk
async function makePersonality() {
  const who = $("personaFrom").value.trim();
  if (!who) { $("personaFrom").focus(); return toast("Type a character first, like Rick Sanchez."); }
  const f = $("editor"), btn = $("personaGo");
  btn.disabled = true; btn.textContent = "…";
  try {
    const res = await api.make_personality(who, f.name.value.trim());
    if (res?.error) return toast(res.error, 6000);
    f.prompt.value = res.prompt;
    if (!f.name.value.trim()) f.name.value = res.name;
    toast(`Personality written like ${who}. Press Save to keep it.`);
  } catch (e) {
    toast(`Couldn't write it: ${e?.message || e}`, 6000);
  } finally {
    btn.disabled = false; btn.textContent = "✓";
  }
}
$("personaGo").addEventListener("click", makePersonality);
$("personaFrom").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); makePersonality(); } });
$("editor").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const prev = state.characters.find((c) => c.id === editingId);
  const res = await api.save_character({
    id: editingId, name: f.name.value, prompt: f.prompt.value, voice: f.voice.value, model: f.model.value, flip: f.flip.checked,
    voice_online: f.voice_online ? f.voice_online.value : "",
    rate: f.rate.value, pitch: f.pitch.value, volume: Number(f.volume.value), emotion: Number(f.emotion.value),
    natural: f.natural.checked, emotional: f.emotional.checked, language: f.language.value, translate: f.translate.checked, rvc: rvcValue(),
    outfit: $("lookRow").hidden ? prev?.outfit || "" : f.outfit.value, hair: $("lookRow").hidden ? prev?.hair || "" : f.hair.value,
  });
  state = res.state;
  editingId = res.id;
  renderCharacters();
  toast("Character saved.");
  if (res.id === state.active && (!prev || prev.model !== f.model.value || prev.name !== f.name.value || !!prev.flip !== f.flip.checked)) loadCharacter();
  $("useChar").hidden = res.id === state.active;
  $("deleteChar").hidden = false;
});
$("forgetAll").addEventListener("click", async () => {
  if (!confirm("Forget everything she learned about you? Your chats stay.")) return;
  await api.forget_preference(null); renderPrefs(); toast("Forgotten.");
});
$("useChar").addEventListener("click", async () => {
  state = await api.set_active(editingId);
  showHistory(state.history);
  renderCharacters();
  $("useChar").hidden = true;
  await loadCharacter();
  say(`Hi, I'm ${activeChar().name}.`);
});
$("deleteChar").addEventListener("click", async () => {
  const c = state.characters.find((x) => x.id === editingId);
  if (!c || !confirm(`Delete ${c.name}? Their chat memory file stays on disk.`)) return;
  const res = await api.delete_character(editingId);
  if (res.error) return toast(res.error);
  const changedActive = res.state.active !== state.active;
  state = res.state;
  openEditor(state.active);
  if (changedActive) loadCharacter();
});

// ---------------- share characters: one .vermeil file with the personality, 3D model and voice clone ----------------
$("shareChar").addEventListener("click", async (e) => {
  if (!editingId) return;
  busy(e.target, true, "Saving…");
  try {
    const r = await api.character_export(editingId, $("shareVoice").checked);
    if (r) toast(r.error || r.message, 8000);
  } finally { busy(e.target, false); }
});
$("importChar").addEventListener("click", async (e) => {
  busy(e.target, true, "Importing…");
  try {
    const r = await api.character_import();
    if (!r) return;
    if (r.error) return toast(r.error, 7000);
    state = r.state; renderCharacters(); openEditor(r.id); toast(r.message, 6000);
  } finally { busy(e.target, false); }
});

// ---------------- Settings > This computer: low-end PC mode ----------------
function renderPerformance(p = state.performance) {
  if (!p) return;
  state.performance = p;
  $("perfMode").value = p.setting;
  const m = p.machine || {};
  const bits = [m.system, m.cores && `${m.cores} cores`, m.ram_gb && `${m.ram_gb} GB memory`, m.gpu || "no separate graphics card",
    m.battery != null && `battery ${m.battery}%${m.plugged ? " (charging)" : ""}`].filter(Boolean);
  $("perfWhy").textContent = `Now: ${p.mode === "low" ? "🐢 Low-end PC" : p.mode === "high" ? "⚡ High" : "Normal"}. ${p.why || ""} (${bits.join(" · ")})`;
  room.setLowPower?.(p.mode === "low");
}
$("perfMode").addEventListener("change", async () => {
  await api.save_settings({ performance: $("perfMode").value });
  renderPerformance(await api.performance_status());
});
$("perfScan").addEventListener("click", async (e) => {
  busy(e.target, true, "Scanning…");
  try { renderPerformance(await api.performance_rescan()); } finally { busy(e.target, false); }
});

// ---------------- Settings > Phone: QR code to use Vermeil on your phone (also on mobile data) ----------------
function renderPhone(p) {
  if (!p) return;
  $("phoneOn").checked = p.on;
  $("phoneMethod").value = p.method;
  $("phoneBox").hidden = !p.on;
  const qr = $("phoneQr");
  qr.replaceChildren();
  if (p.pair && window.qrcode) {
    const q = window.qrcode(0, "M"); q.addData(p.pair); q.make();
    qr.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }
  $("phoneState").textContent = p.error ? `⚠ ${p.error}` : p.url ? `Ready: ${p.url}` : p.on ? (p.progress || "Starting…") : "";
  $("phoneCopy").dataset.link = p.pair || "";
}
$("phoneOn").addEventListener("change", async () => renderPhone(await api.phone_set($("phoneOn").checked, $("phoneMethod").value)));
$("phoneMethod").addEventListener("change", async () => {
  if ($("phoneOn").checked) renderPhone(await api.phone_set(true, $("phoneMethod").value));
});
$("phoneCopy").addEventListener("click", async () => {
  const link = $("phoneCopy").dataset.link;
  if (!link) return toast("The link isn't ready yet.");
  try { await navigator.clipboard.writeText(link); toast("Link copied. Open it on your phone - keep it private, it's your key."); }
  catch { prompt("Your phone link (keep it private):", link); }
});
$("phoneNewKey").addEventListener("click", async () => {
  if (!confirm("Make a new key? Every connected phone has to scan the new QR code.")) return;
  renderPhone(await api.phone_new_key()); toast("New key made. Scan the new code with your phone.");
});
window.addEventListener("settings-phone", async () => renderPhone(await api.phone_status()));

room.onHover = (label, x, y) => {
  const tip = $("tip");
  if (!label) { tip.hidden = true; return; }
  tip.textContent = label;
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  tip.hidden = false;
};
room.onInteract = (thing, result) => api.interact(thing, result);
// ---------------- room customising ----------------
const WALL_COLOURS = { "Warm white": "#e9e1d4", "Oat": "#d8c8b0", "Sage": "#b7c2a8", "Night plum": "#2c2034", "Midnight": "#1d2338", "Forest": "#22332b", "Cocoa": "#3a2a24",
                       "Blush": "#6e4a5a", "Cream": "#c9bba8", "Sky": "#5d7896", "Charcoal": "#26252b" };
let saveTimer = null;
function saveLayoutSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.save_room(room.layout()), 600);
}
let gymSaveTimer = null;
room.onLayoutChange = () => {
  if (room.gym) {                                                   // editing the gym: save the gym's own layout
    clearTimeout(gymSaveTimer);
    gymSaveTimer = setTimeout(async () => { state.ui = await api.save_ui({ gym_layout: room.gymLayout() }); }, 600);
    return;
  }
  saveLayoutSoon(); syncRoomControls();
};

function syncRoomControls() {
  const L = room.layout().shell;
  for (const b of $("wallSwatches").children) b.setAttribute("aria-pressed", b.dataset.colour === L.wall);
  $("wallColor").value = L.wall;
  $("floorSelect").value = L.floor;
  $("skySelect").value = L.sky;
  $("autoTime").checked = L.sky === "auto";
  $("skySelect").disabled = L.sky === "auto";
  updateClockNote();
  $("brightness").value = Math.round((L.brightness ?? 1) * 100);
  $("brightOut").textContent = `${$("brightness").value}%`;
}

// ---------- Edit room (like "Make Room"): the menu hides, a scrollable bar of categories sits on top ----------
function setEditing(on) {
  room.setEditMode(on);
  document.body.classList.toggle("editing", on);
  $("editBar").hidden = !on;
  $("editBtn").hidden = on;
  $("editBtn").setAttribute("aria-pressed", on);
  if (on) { for (const p of document.querySelectorAll(".panel")) p.hidden = true; renderCatalog(); syncRoomControls(); }
  else saveLayoutSoon();
}

// ---------- furniture catalog, sorted into categories ----------
const CATEGORIES = [
  ["rewards", "🏆 Battle Pass", null],
  ["tables", "🪑 Tables & desks", /table|desk/i],
  ["seating", "🛋️ Chairs & sofas", /chair|sofa|couch|bean|stool|ottoman|armchair/i],
  ["beds", "🛏️ Beds", /bed/i],
  ["lights", "💡 Lights", /lamp|light|candle|neon|hex|lantern|fan/i],
  ["shelves", "📚 Shelves", /shelf|shelves|bookcase|bookshelf|cubby|cube|dresser|cabinet|storage/i],
  ["plants", "🪴 Plants", /plant|cact|tree|vine|leaf|flower/i],
  ["tech", "🖥️ Tech", /tv|monitor|radio|speaker|record|laptop|computer|console/i],
  ["kitchen", "🍳 Kitchen", /kitchen|fridge|oven|stove|sink/i],
  ["bathroom", "🛁 Bathroom", /bath|shower|toilet|mirror|washing/i],
  ["walls", "🖼️ Wall decor", /window|panel|stripe|board|poster|clock|frame|sign|beam/i],
  ["gym", "🏋️ Gym", /^gym/],
  ["decor", "✨ Decor", /./],
  ["pets", "🐾 Pets", null],
];
const ROOM_PANES = [["house", "🏠 Rooms"], ["style", "🎨 Room style"], ["wallcolour", "🧱 Wall colour"], ["floor", "🟫 Floor"], ["time", "🌙 Time of day"], ["reset", "↺ Reset"]];
function categoryOf(type, def) {
  if (def.category) return def.category;
  const text = `${type} ${def.label}`;
  return CATEGORIES.find(([, , re]) => re?.test(text))[0];
}
let catalogTab = "tables";
try { catalogTab = localStorage.getItem("catalogTab") || catalogTab; } catch { /* ignore */ }
function renderCatalog() {
  const items = Object.entries(CATALOG).map(([type, def]) => ({ type, def, cat: categoryOf(type, def) }));
  const used = [...CATEGORIES.filter(([k]) => items.some((i) => i.cat === k)), ...ROOM_PANES];
  if (!used.some(([k]) => k === catalogTab)) catalogTab = used[0]?.[0];
  $("catalogTabs").replaceChildren(...used.map(([k, label]) => {
    const b = document.createElement("button");
    b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(k === catalogTab));
    b.textContent = label;
    b.addEventListener("click", () => {
      catalogTab = k;
      try { localStorage.setItem("catalogTab", k); } catch { /* ignore */ }
      renderCatalog();
      $("catalogTabs").querySelector('[aria-selected="true"]')?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    });
    return b;
  }));
  const pane = ROOM_PANES.some(([k]) => k === catalogTab) ? (catalogTab === "wallcolour" ? "walls" : catalogTab) : null;
  for (const p of document.querySelectorAll(".edit-pane")) p.hidden = p.dataset.pane !== pane;
  $("catalog").hidden = !!pane;
  if (pane === "house") renderHousePane();
  if (pane) return;
  const wallpapers = catalogTab === "walls" ? [Object.assign(document.createElement("p"), { className: "edit-sub", textContent: "Wallpaper (the wall colour tints it)" }),
    ...Object.entries(WALLPAPERS).map(([k, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "edit-card wallpaper"; b.textContent = label;
      const lockW = REWARD_WALLPAPERS.has(k) && passLock(k);
      if (lockW) { b.classList.add("locked"); b.textContent = `🔒 ${label} · tier ${lockW}`; b.addEventListener("click", () => toast(`Unlock ${label} at Battle Pass tier ${lockW}.`)); return b; }
      b.setAttribute("aria-pressed", String((room.cozy.wallpaper || "none") === k));
      b.addEventListener("click", () => { room.setWallpaper(k); renderCatalog(); toast(k === "none" ? "Plain painted walls." : `Wallpaper: ${label}`); });
      return b;
    }), Object.assign(document.createElement("p"), { className: "edit-sub", textContent: "Things for the walls" })] : [];
  $("catalog").replaceChildren(...wallpapers, ...items.filter((i) => i.cat === catalogTab).sort((a, b) => a.def.label.localeCompare(b.def.label)).map(({ type, def }, n) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "edit-card"; b.textContent = def.label;
    b.style.animationDelay = `${Math.min(n, 14) * 22}ms`;
    const lock = def.reward && passLock(type);
    if (lock) {
      b.classList.add("locked"); b.textContent = `🔒 ${def.label} · tier ${lock}`;
      b.addEventListener("click", () => toast(`Unlock it at Battle Pass tier ${lock}: earn XP in Study, Language, Gym and Habits.`));
      return b;
    }
    b.addEventListener("click", () => {
      room.addItem(type);
      b.classList.remove("added"); void b.offsetWidth; b.classList.add("added");
      toast(def.pet ? `${def.label} joined the room!` : `Added: ${def.label}. Drag it where you like.`);
    });
    return b;
  }));
}
// ---------- Rooms: extra rooms on the left and right of the main room ----------
function renderHousePane() {
  const H = JSON.parse(JSON.stringify(room.cozy.house.cfg));
  const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const apply = (redraw = false) => { room.setHouse(H); if (redraw) renderHousePane(); };
  const slider = (label, value, min, max, step, unit, set) => {
    const out = el("output", { textContent: `${value}${unit}` });
    const input = el("input", { type: "range", min, max, step, value });
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => { set(Number(input.value)); out.textContent = `${input.value}${unit}`; apply(); });
    return el("label", { className: "house-row" }, [label, input, out]);
  };
  const btn = (text, click, extra = {}) => { const b = el("button", { type: "button", textContent: text, ...extra }); b.addEventListener("click", click); return b; };

  // the add buttons come first so they're always in view; the rooms are cards side by side (left ones first)
  const full = H.rooms.length >= 4;
  const add = (side) => btn(`+ Room on the ${side}`, () => { H.rooms.push({ side, w: 5, d: 6 }); apply(true); },
    { className: "primary", disabled: full, title: full ? "Up to 4 extra rooms" : "" });
  const head = el("div", { className: "house-box" }, [el("h4", { textContent: "🚪 Rooms" }),
    el("div", { className: "house-btns" }, [add("left"), add("right")]),
    el("p", { className: "note", textContent: `The main room is 10 × 8.5 m. Up to 4 extra rooms, on either side, join it through a doorway${full ? " (that's 4 now)" : ""}. When she walks into a room the camera follows her there. The big window is furniture: click it to move or delete it.` })]);
  const order = H.rooms.map((r, i) => i).sort((a, b) => (H.rooms[a].side === "left" ? 0 : 1) - (H.rooms[b].side === "left" ? 0 : 1));
  const cards = order.map((i) => {
    const r = H.rooms[i], n = H.rooms.slice(0, i + 1).filter((o) => o.side === r.side).length;
    return el("div", { className: "house-box house-room" }, [
      el("div", { className: "house-row" }, [el("strong", { textContent: `${r.side === "left" ? "⬅ Left" : "Right ➡"} room ${n}` }),
        btn("✕ Remove", () => { H.rooms.splice(i, 1); apply(true); }, { className: "danger" })]),
      slider("Width", r.w, 3, 8, 0.1, " m", (v) => { r.w = v; }),
      slider("Depth", r.d, 3, 8.5, 0.1, " m", (v) => { r.d = v; })]);
  });
  $("housePane").replaceChildren(head, ...cards);
}

$("wallSwatches").replaceChildren(...Object.entries(WALL_COLOURS).map(([name, hex]) => {
  const b = document.createElement("button");
  b.style.background = hex; b.title = name; b.dataset.colour = hex; b.setAttribute("aria-label", name);
  b.addEventListener("click", () => room.setWallColor(hex));
  return b;
}));
$("skySelect").replaceChildren(...Object.entries(TIME_PRESETS).map(([k, p]) => new Option(p.label, k)));
$("themes").replaceChildren(...Object.entries(THEMES).map(([key, t]) => {
  const b = document.createElement("button");
  b.textContent = t.label;
  b.addEventListener("click", () => {
    if (!confirm(`Switch to "${t.label}"? Your current furniture layout will be replaced.`)) return;
    const L = JSON.parse(JSON.stringify(t.layout));
    L.shell = { ...(L.shell || {}), house: room.cozy.house.cfg };     // a theme changes the furniture, not your rooms
    room.loadLayout(L);
    saveLayoutSoon(); syncRoomControls();
    toast(`Room style: ${t.label}`);
  });
  return b;
}));
$("floorSelect").replaceChildren(...CozyRoom.floorStyles().map((f) => new Option(f[0].toUpperCase() + f.slice(1), f)));
$("wallColor").addEventListener("input", (e) => room.setWallColor(e.target.value));
$("floorSelect").addEventListener("change", (e) => room.setFloor(e.target.value));
$("skySelect").addEventListener("change", (e) => room.setSky(e.target.value));

// automatic daylight cycle based on the computer's clock
function partOfDay(h) {
  if (h < 5) return "night"; if (h < 7) return "dawn"; if (h < 11) return "morning"; if (h < 15.5) return "midday";
  if (h < 18) return "golden hour"; if (h < 19) return "sunset"; if (h < 20.5) return "dusk"; return "night";
}
function updateClockNote() {
  const d = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("clockNote").textContent = $("autoTime").checked
    ? `It's ${time} for you, so the room shows ${partOfDay(d.getHours() + d.getMinutes() / 60)}. It changes by itself through the day.`
    : `Turn this on and the sky and lighting follow your clock (it's ${time} now).`;
}
$("autoTime").addEventListener("change", (e) => {
  room.setSky(e.target.checked ? "auto" : "night");
  syncRoomControls();
});
setInterval(updateClockNote, 30000);
$("brightness").addEventListener("input", (e) => {
  $("brightOut").textContent = `${e.target.value}%`;
  room.setBrightness(e.target.value / 100);
});

// hide / show the sidebar and chat (remembered for next time)
function setCollapsed(on) {
  document.body.classList.toggle("collapsed", on);
  $("collapseBtn").setAttribute("aria-pressed", on);
  $("collapseBtn").setAttribute("aria-label", on ? "Show the menu and chat" : "Hide the menu and chat");
  $("collapseBtn").title = on ? "Show the menu and chat (H)" : "Hide the menu and chat (H)";
  if (api) api.save_ui({ collapsed: on });
  renderHud();
}
$("collapseBtn").addEventListener("click", () => setCollapsed(!document.body.classList.contains("collapsed")));
document.addEventListener("keydown", (e) => {
  if ((e.key === "h" || e.key === "H") && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
    setCollapsed(!document.body.classList.contains("collapsed"));
  }
});

$("editBtn").addEventListener("click", () => setEditing(!room.editMode));
$("editDone").addEventListener("click", () => setEditing(false));
$("editUndo").addEventListener("click", () => { if (room.undo()) { syncRoomControls(); toast("Undone."); } });
room.onUndoChange = (n) => { $("editUndo").disabled = !n; };
document.addEventListener("keydown", (e) => {
  if (!room.editMode || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (room.undo()) syncRoomControls(); }
  else if (e.key === "Escape") { if (room.selectedId != null) room.select(null); else setEditing(false); }
});
$("resetRoom").addEventListener("click", () => {
  if (!confirm("Put every piece of furniture back where it started?")) return;
  room.loadLayout(null); saveLayoutSoon(); syncRoomControls(); toast("Room reset. (Undo brings it back.)");
});
room.onSelect = (item) => { $("toolRotate").hidden = item?.mount === "wall"; };
document.addEventListener("keydown", (e) => {
  if (!room.editMode || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (e.key === "Delete" || e.key === "Backspace") room.removeSelected();
  if (e.key === "q" || e.key === "Q") room.rotateSelected(Math.PI / 8);
  if (e.key === "e" || e.key === "E") room.rotateSelected(-Math.PI / 8);
});

room.onPoke = () => say(["Hey! That tickles!", "Yes?", "Careful!"][Math.floor(Math.random() * 3)]);

// ---------------- start ----------------
(async () => {
  api = await getApi();
  state = await api.get_state();
  renderStatus();
  // restore remembered preferences
  if (state.ui?.collapsed) setCollapsed(true);
  fx.init({ sfx: state.ui?.sfx ?? true, volume: state.ui?.sfx_volume ?? 0.5, fx: state.ui?.fx ?? true });
  syncFxControls();
  bgm.on = state.ui?.bgm ?? true; bgm.volume = state.ui?.bgm_volume ?? 0.5; bgm.theme = state.ui?.bgm_theme || "room";
  if (state.ui?.sfx_style) { psp.setSfxStyle(state.ui.sfx_style); $("sfxStyle").value = state.ui.sfx_style; }
  if (state.ui?.sfx_pitch) { psp.setSfxPitch(state.ui.sfx_pitch); $("sfxPitch").value = state.ui.sfx_pitch; }
  syncBgmControls(); updateBgm(); setInterval(updateBgm, 1000);
  loadPronunciations();
  applySidebar(); renderSidebarToggles(); applyTheme(state.ui?.theme); renderThemes();
  initDropdowns();
  pluginsUI = initPlugins(api, { onChange: syncPlugins });
  if (state.plugins?.fresh) { openPanel("settings"); pluginsUI.show("plugins"); }      // first start after installing: pick your features
  fx.setAlarmVolume(state.ui?.alarm_volume ?? 0.9);
  $("alarmVol").value = Math.round((state.ui?.alarm_volume ?? 0.9) * 100); $("alarmVolOut").textContent = `${$("alarmVol").value}%`;
  room.setView?.(state.ui?.view);
  room.onViewChange = (view) => { clearTimeout(viewTimer); viewTimer = setTimeout(() => api.save_ui({ view }), 800); };
  showHistory(state.history);
  renderPerformance();
  try {
    const saved = await api.load_room();
    if (saved) room.loadLayout(saved);
    if (!state.ui?.den_v1) {                      // one-time switch to the new warm den look (the old room is kept)
      const before = room.layout();
      room.loadLayout(JSON.parse(JSON.stringify(THEMES.den.layout)));
      saveLayoutSoon();
      state.ui = await api.save_ui({ den_v1: true, room_before_den: before });
      toast("New room look: the Warm den. Your old room is kept in Settings → room themes ('My room before the update').", 8000);
    }
    if (state.ui?.room_before_den) {
      const b = document.createElement("button");
      b.textContent = "My room before the update";
      b.addEventListener("click", () => {
        if (!confirm("Switch back to your room from before the Warm den update?")) return;
        room.loadLayout(JSON.parse(JSON.stringify(state.ui.room_before_den))); saveLayoutSoon(); syncRoomControls();
      });
      $("themes").append(b);
    }
  } catch (e) { console.warn("room layout", e); }
  syncRoomControls();
  planner = initPlanner(api);
  study = initStudy(api);
  initQuest(api);
  codePanel = initCode(api);
  mind = initMind(api);
  gym = initGym(api);
  elecPanel = initElectronics(api);
  genPanel = initGenerator(api);
  musicPanel = initMyMusic(api);
  baking = initBaking(api, "baking");
  cooking = initBaking(api, "cooking");
  $("kitchenTabs").addEventListener("click", (e) => {
    const kind = e.target.closest("[data-kind]")?.dataset.kind;
    if (kind) { kitchenTab(kind); api.save_ui({ kitchen_tab: kind }).then((u) => { if (u) state.ui = u; }); }
  });
  focusPanel = initFocus(api);
  chat = initChat(api, () => activeChar()?.name);
  refreshGuide();
  missionsPanel = initMissions(api);
  chat.renderMessages(state.history);
  missionsPanel.load().then(renderHud).catch(() => {});
  spotifyPanel = window.__spotifyPanel = initSpotify(api, { onState: (n) => {
    $("spotifySub").textContent = n?.track ? `${n.playing ? "▶" : "❚❚"} ${n.track.title}` : "Your music";
    renderHud();
  } });
  spotifyPanel.load().catch(() => {});
  startLife();
  renderPlanner();
  await loadCharacter();
  api.boot();
  loadVoices();
})();

// ---------- gym room: shows while a gym session (workout) is running ----------
window.addEventListener("gym-session", (e) => {
  const { on, startedAt } = e.detail || {};
  if (state?.settings?.gym_room === false) return;
  room.setGymRoom(on, startedAt, state?.ui?.gym_layout);
});

// ---------------- Settings: split into tabs like the other panels ----------------
(function settingsTabs() {
  const panel = $("panel-settings");
  const header = panel.querySelector("header");
  const TABS = [
    ["general", "General", ["Behaviour", "Theme colours", "Voice & camera", "Sounds & effects", "Sidebar"]],
    ["her", "Her", ["Her little life", "My wake word"]],
    ["you", "You", ["Your face", "People she knows", "What she remembers about you"]],
    ["ai", "AI & online", ["AI", "Internet & calendar", "This computer", "This PC", "Macros"]],
    ["phone", "📱 Phone", ["Phone"]],
    ["test", "Test", ["Animation test"]],
    ["plugins", "Plugins", ["Plugins"]],
    ["help", "Help", ["Voice commands"]],
  ];
  const tabOf = (title) => (TABS.find(([, , list]) => list.includes(title)) || TABS[0])[0];
  const panes = Object.fromEntries(TABS.map(([k]) => [k, Object.assign(document.createElement("div"), { className: "settings-pane" })]));
  let cur = null;
  for (const node of [...panel.children]) {
    if (node === header) continue;
    if (node.tagName === "H3") cur = tabOf(node.textContent.trim());
    panes[cur || "general"].append(node);
  }
  const nav = Object.assign(document.createElement("nav"), { className: "tabs settings-tabs" });
  nav.setAttribute("role", "tablist");
  let tab = "general";
  try { tab = localStorage.getItem("settingsTab") || tab; } catch { /* ignore */ }
  const show = (k) => {
    tab = k;
    try { localStorage.setItem("settingsTab", k); } catch { /* ignore */ }
    for (const b of nav.children) b.setAttribute("aria-selected", String(b.dataset.tab === k));
    for (const [key, pane] of Object.entries(panes)) pane.hidden = key !== k;
    if (k === "test") renderAnimTest();
    if (k === "plugins") window.dispatchEvent(new Event("plugins-tab"));
    if (k === "help") renderVoiceHelp();
    if (k === "phone") window.dispatchEvent(new Event("settings-phone"));
  };
  window.showSettingsTab = show;
  nav.append(...TABS.map(([k, label]) => {
    const b = Object.assign(document.createElement("button"), { type: "button", textContent: label });
    b.dataset.tab = k; b.setAttribute("role", "tab");
    b.addEventListener("click", () => show(k));
    return b;
  }));
  header.after(nav, ...Object.values(panes));
  show(panes[tab] ? tab : "general");
})();

// ---------------- Settings > Help: what you can say, one card per sidebar feature (brain/voice_commands.py) ----------------
async function renderVoiceHelp() {
  const box = $("voiceHelp");
  if (!box || !api?.voice_commands) return;
  const { features = [] } = await api.voice_commands();
  const q = ($("voiceHelpFind")?.value || "").trim().toLowerCase();
  const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const cards = features.map((f) => {
    const rows = f.say.filter((c) => !q || f.name.toLowerCase().includes(q) || `${c.say} ${c.does}`.toLowerCase().includes(q));
    if (!rows.length) return null;
    return el("article", { className: `help-card${f.installed ? "" : " off"}` }, [
      el("h4", {}, [el("span", { className: "help-icon", textContent: f.icon, ariaHidden: "true" }), f.name,
        f.installed ? "" : el("span", { className: "pill off", textContent: "Not installed" })]),
      el("ul", {}, rows.map((c) => el("li", {}, [el("q", { textContent: c.say }), el("span", { className: "note", textContent: ` ${c.does}` })])))]);
  }).filter(Boolean);
  box.replaceChildren(...(cards.length ? cards : [el("p", { className: "note", textContent: "Nothing matches that." })]));
}
$("voiceHelpFind")?.addEventListener("input", renderVoiceHelp);

// ---------------- Settings > Test: a button for every animation ----------------
const ANIM_LABELS = { idle: "Idle", walk: "Walk", wave: "Wave", talk: "Talk", happy: "Happy", sad: "Sad", surprised: "Surprised",
  angry: "Angry", think: "Think", sleepy: "Sleepy", dance: "Dance", sit: "Sit (chair)", type: "Type (desk)", lounge: "Lounge (sofa)",
  lie: "Lie down (bed)", crouch: "Crouch (plant)", lookout: "Look out (window)", book_take: "Take a book", book_read: "Read a book",
  book_put: "Put a book back", dance_hiphop: "Dance: hip-hop", dance_idol: "Dance: idol", dance_twirl: "Dance: twirl", dance_sway: "Dance: slow sway",
  cheer: "Cheer", jump: "Jump", stretch: "Stretch", yawn: "Yawn", laugh: "Laugh", shy: "Shy", clap: "Clap", shrug: "Shrug", bow: "Bow",
  nod: "Nod", shake: "Shake head", point: "Point", look_around: "Look around" };
function renderAnimTest() {
  const box = $("animTest");
  const group = (title, buttons) => {
    if (!buttons.length) return null;
    const wrap = document.createElement("div"); wrap.className = "anim-group";
    const h = document.createElement("p"); h.className = "anim-title"; h.textContent = title;
    const grid = document.createElement("div"); grid.className = "catalog";
    grid.append(...buttons.map(([label, fn]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label;
      b.addEventListener("click", () => { fn(); toast(`Playing: ${label}`, 1500); });
      return b;
    }));
    wrap.append(h, grid);
    return wrap;
  };
  const names = room.animationNames();
  const clips = names.map((n) => [ANIM_LABELS[n] || n, () => room.testAnimation(n, 8)]);
  const spots = room.spots?.() || [];
  const go = (kind, label) => {                                // looked up when you press it, so moved furniture counts
    if (!spots.some((x) => x.kind === kind)) return [];
    return [[label, () => { const now = room.spots?.() || []; const s = now.find((x) => x.kind === kind && x.use) || now.find((x) => x.kind === kind); if (s) room.useSpot(s); }]];
  };
  const uses = [...go("desk", "Go sit at the desk"), ...go("couch", "Go to the sofa"), ...go("bed", "Go lie in bed"),
    ...go("books", "Go read a book (full)"), ...go("plant", "Go to the plant"), ...go("window", "Go to the window")];
  const faces = ["happy", "sad", "surprised", "angry", "thinking", "sleepy", "neutral"].map((e) => [e[0].toUpperCase() + e.slice(1), () => room.setExpression(e, 6)]);
  const emotes = ["wave", "dance", "jump", "spin", "nod", "shake", "bow", "think", "celebrate", "clap", "laugh", "shrug", "stretch", "yawn", "shy", "point"].map((e) => [e[0].toUpperCase() + e.slice(1), () => room.playEmote(e)]);
  const talk = [["Talk for 5 s", () => { room.speaking = true; setTimeout(() => (room.speaking = false), 5000); }]];
  box.replaceChildren(...[
    names.length ? null : Object.assign(document.createElement("p"), { className: "note", textContent: "This character has no animations of its own - try Kit, or the face / emote buttons." }),
    group("Animations (from the 3D model)", clips),
    group("Use the room", uses),
    group("Faces / moods", faces),
    group("Emotes", emotes),
    group("Other", [...talk, ["Stop test", () => { room.stopTest(); room.setExpression("neutral"); }]]),
  ].filter(Boolean));
}

// ---------------- floating buttons under the selected furniture: turn, paint, remove ----------------
const PAINTS = ["#d9843f", "#b0602c", "#f4e3c2", "#a7b03c", "#5f8a3e", "#7e9cc6", "#3e5a8a", "#e58fa0", "#c46a43", "#f2c24f", "#5d5560", "#2b2730", "#ffffff"];
(function itemTools() {
  const tools = $("itemTools"), pop = $("paintPop");
  pop.append(...PAINTS.map((hex) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "paint"; b.style.background = hex; b.title = hex;
    b.addEventListener("click", () => room.recolorSelected(hex));
    return b;
  }));
  const custom = Object.assign(document.createElement("input"), { type: "color", title: "Any colour", value: "#d9843f" });
  custom.addEventListener("input", () => room.recolorSelected(custom.value));
  const reset = Object.assign(document.createElement("button"), { type: "button", className: "paint reset", textContent: "↺", title: "Original colour" });
  reset.addEventListener("click", () => room.recolorSelected(null));
  pop.append(custom, reset);
  $("toolRotate").addEventListener("click", () => room.rotateSelected(-Math.PI / 4));
  $("toolPaint").addEventListener("click", () => { pop.hidden = !pop.hidden; });
  $("toolDelete").addEventListener("click", () => { pop.hidden = true; room.removeSelected(); });
  let lastSel = null;
  (function follow() {
    const p = room.editMode && room.selectedId != null ? room.selectedScreenPosition() : null;
    tools.hidden = !p;
    if (p) {
      const w = tools.parentElement.clientWidth, h = tools.parentElement.clientHeight;
      tools.style.left = `${Math.min(Math.max(p.x, 90), w - 90)}px`;
      tools.style.top = `${Math.min(Math.max(p.y + 18, 60), h - 70)}px`;
    }
    if (room.selectedId !== lastSel) { pop.hidden = true; lastSel = room.selectedId; }
    requestAnimationFrame(follow);
  })();
  document.addEventListener("keydown", (e) => {
    if (!room.editMode || room.selectedId == null || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    if (e.key === "r" || e.key === "R") room.rotateSelected(-Math.PI / 4);
  });
})();

// ---------------- Settings > General > Update: newest version from GitHub (skills/updater.py) ----------------
function showAppUpdate(e) {
  const bar = $("appUpdateBar"), note = $("appUpdateNote"), btn = $("appUpdate");
  if (!bar) return;
  bar.hidden = false;
  bar.classList.toggle("bad", !!e.error);
  if (e.done) {
    btn.disabled = false;
    bar.querySelector("i").style.width = "100%";
    bar.querySelector("span").textContent = e.error ? "Didn't update" : "100%";
    note.textContent = e.error || e.message || "Updated.";
    $("appRestart").hidden = !!e.error || e.changed === 0;
    toast(e.error || e.message, 9000);
    return;
  }
  const pct = Math.round((e.pct || 0) * 100);
  bar.querySelector("i").style.width = `${pct}%`;
  bar.querySelector("span").textContent = `${pct}%  ${e.text || ""}`;
}
$("appUpdate")?.addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  btn.disabled = true;
  $("appRestart").hidden = true;
  $("appUpdateNote").textContent = "";
  showAppUpdate({ pct: 0, text: "Starting…" });
  const r = await api.app_update();
  if (!r?.started) showAppUpdate({ done: true, error: r?.error || "Couldn't start the update." });
});
$("appRestart")?.addEventListener("click", () => { toast("Restarting Vermeil…"); api.app_restart(); });
// a dot on Settings when GitHub has a newer Vermeil (checked at start and every 6 hours)
async function checkForUpdate() {
  try {
    const r = await api.app_update_check();
    const has = !!r?.new && !r.error;
    document.querySelector('.menu [data-panel="settings"]')?.classList.toggle("has-update", has);
    $("updDotTitle").hidden = !has;
    if (has && !$("appUpdateNote").textContent) $("appUpdateNote").textContent = `A new version is ready${r.message ? `: ${r.message}` : ""}. Tap Update Vermeil.`;
  } catch { /* offline */ }
}
setTimeout(checkForUpdate, 15000);
setInterval(checkForUpdate, 6 * 3600 * 1000);

// Settings > General > Backup
$("backupMake")?.addEventListener("click", async (ev) => {
  const btn = ev.currentTarget;
  busy(btn, true, "Packing…");
  try {
    const r = await api.backup_make($("backupBig").checked);
    if (r) { $("backupNote").textContent = r.error || r.message; toast(r.error || r.message, 7000); }
  } finally { busy(btn, false); }
});
$("backupRestore")?.addEventListener("click", async (ev) => {
  if (!confirm("Restore a backup? Your saved data gets replaced by the backup's (a safety copy of the current data is made first).")) return;
  const btn = ev.currentTarget;
  busy(btn, true, "Restoring…");
  try {
    const r = await api.backup_restore();
    if (!r) return;
    $("backupNote").textContent = r.error || r.message;
    toast(r.error || r.message, 9000);
    if (!r.error) $("appRestart").hidden = false;
  } finally { busy(btn, false); }
});

// ---------------- Settings > General > Sidebar: show / hide features in the menu ----------------
let pluginsUI = null;
const OPTIONAL_PANELS = ["adventure", "electronics", "music", "planner", "study", "kitchen", "gym", "missions", "focus", "mind", "code", "generator"];
const menuBtn = (k) => k === "voice" ? $("voiceBtn") : k === "camera" ? $("cameraBtn") : k === "adventure" ? $("adventureBtn") : document.querySelector(`.menu [data-panel="${k}"]`);
// the Games hub (Adventure + Retro Games) is its own page; your chat and room are safe while you play (they're saved by the app)
$("adventureBtn")?.addEventListener("click", () => {
  try { localStorage.setItem("vermeil_theme", JSON.stringify(state?.ui?.theme || null)); } catch { /* ignore */ }   // the hub wears your colours
  fx.play("start"); bgm.on = false; psp.musicStop(0.3);       // the hub has its own tune (bgm.on comes back on the next start)
  if (music.playing && !music.paused) { music.paused = true; api.music("pause"); }      // your song waits while you play
  if (spotifyPanel?.status()?.playing) spotifyPanel.cmd("pause");
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;z-index:9999;display:grid;place-content:center;justify-items:center;gap:14px;" +
    "background:var(--black);color:var(--ink);font:800 20px Nunito,system-ui,sans-serif;opacity:0;transition:opacity .25s";
  ov.innerHTML = '<div style="width:76px;height:76px;border-radius:50%;border:4px solid var(--blue-soft);border-top-color:var(--blue);animation:advspin 1s linear infinite"></div>' +
    "<div>Opening Games…</div><style>@keyframes advspin{to{transform:rotate(360deg)}}</style>";
  document.body.append(ov);
  requestAnimationFrame(() => (ov.style.opacity = "1"));
  setTimeout(() => { location.href = "games/index.html"; }, 250);
});
// Cooking & Baking share one panel: a tab picks which recipe book you see (and is remembered)
function kitchenTab(kind) {
  kind = kind === "baking" ? "baking" : "cooking";
  for (const b of $("kitchenTabs").querySelectorAll("[data-kind]")) b.setAttribute("aria-selected", String(b.dataset.kind === kind));
  $("cookingBody").hidden = kind !== "cooking";
  $("bakingBody").hidden = kind !== "baking";
  (kind === "baking" ? baking : cooking).load();
}
function applySidebar() {
  const hidden = new Set([...(state?.ui?.hidden_panels || []), ...(state?.plugins?.hidden_panels || [])]);   // + features not installed (Plugins)
  $("voiceBtn").hidden = true; $("cameraBtn").hidden = true;       // these live in Settings > General now
  for (const k of OPTIONAL_PANELS) {
    const btn = menuBtn(k);
    if (!btn) continue;
    btn.hidden = hidden.has(k);
    const panel = $(`panel-${k}`);
    if (hidden.has(k) && panel && !panel.hidden) openPanel(k);    // close it if it was open
  }
}
// Plugins and the "Show X in the menu" ticks stay in step: uninstalling a feature unticks it, installing it
// puts it back in the menu, and ticking a feature that isn't installed offers to install it.
async function syncPlugins() {
  const before = new Set(state?.plugins?.hidden_panels || []);
  state = await api.get_state();
  const nowHidden = new Set(state.plugins?.hidden_panels || []);
  const back = [...before].filter((k) => !nowHidden.has(k));          // just installed
  if (back.length && (state.ui?.hidden_panels || []).some((k) => back.includes(k)))
    state.ui = await api.save_ui({ hidden_panels: state.ui.hidden_panels.filter((k) => !back.includes(k)) });
  applySidebar(); renderSidebarToggles();
  for (const k of back) menuBtn(k)?.classList.add("menu-new");
  setTimeout(() => document.querySelectorAll(".menu-new").forEach((b) => b.classList.remove("menu-new")), 2600);
}
function renderSidebarToggles() {
  const box = $("sidebarToggles");
  if (!box) return;
  const hidden = new Set(state?.ui?.hidden_panels || []);
  const owner = state?.plugins?.owner || {};
  // features that aren't installed aren't listed at all (install them in Settings → Plugins)
  box.replaceChildren(...OPTIONAL_PANELS.filter((k) => !owner[k]).map((k) => {
    const btn = menuBtn(k);
    const name = btn?.querySelector(".item-title")?.textContent || k;
    const label = document.createElement("label"); label.className = "check";
    const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: !hidden.has(k) });
    cb.addEventListener("change", async () => {
      const h = new Set(state.ui?.hidden_panels || []);
      if (cb.checked) h.delete(k); else h.add(k);
      state.ui = await api.save_ui({ hidden_panels: [...h] });
      applySidebar();
      toast(cb.checked ? `${name} added back to the menu.` : `${name} removed from the menu.`, 2500);
    });
    label.append(cb, ` Show ${name} in the menu`);
    return label;
  }));
}

// Voice & camera switches in Settings (they do the same as the menu buttons)
$("setVoiceBtn").addEventListener("click", () => $("voiceBtn").click());
$("setCameraBtn").addEventListener("click", () => $("cameraBtn").click());

// ---------------- which camera / microphone (only working ones are listed) ----------------
let devicesLoaded = false;
async function renderDevices(fresh = false) {
  if (devicesLoaded && !fresh) return;
  const cam = $("camSelect"), mic = $("micSelect"), note = $("devNote"), box = $("devicePick");
  box.classList.add("scanning");
  note.textContent = fresh ? "Checking every camera and microphone…" : "Looking for cameras and microphones…";
  try {
    const d = await api.list_devices(fresh);
    const fill = (sel, items, auto, chosen, label) => {
      sel.replaceChildren(el("option", { value: -1 }, auto), ...items.map((x) => el("option", { value: x.index }, label(x))));
      sel.value = String(items.some((x) => x.index === chosen) ? chosen : -1);
    };
    fill(cam, d.cameras || [], "Automatic", d.camera, (c) => c.name);
    fill(mic, d.mics || [], "Automatic (Windows default)", d.mic, (m) => m.name + (m.default ? " — default" : ""));
    note.textContent = `${(d.cameras || []).length} working camera${(d.cameras || []).length === 1 ? "" : "s"} · ${(d.mics || []).length} microphone${(d.mics || []).length === 1 ? "" : "s"} found.`
      + ((d.cameras || []).length ? "" : " No camera gave a picture: check it's plugged in and not used by another app.");
    devicesLoaded = true;
  } catch (e) {
    note.textContent = `Couldn't list devices: ${e}`;
  } finally { box.classList.remove("scanning"); }
}
$("findDevices").addEventListener("click", () => renderDevices(true));
$("camSelect").addEventListener("change", async (e) => {
  await api.set_devices(+e.target.value, null);
  toast(+e.target.value < 0 ? "Camera: automatic." : `Camera: ${e.target.selectedOptions[0].textContent}.`, 2500);
});
$("micSelect").addEventListener("change", async (e) => {
  await api.set_devices(null, +e.target.value);
  toast(+e.target.value < 0 ? "Microphone: Windows default." : `Microphone: ${e.target.selectedOptions[0].textContent}.`, 2500);
});
(function syncVC() {
  const on = (id) => $(id).getAttribute("aria-pressed") === "true";
  $("setVoiceBtn").textContent = `Voice: ${on("voiceBtn") ? "on" : "off"}`;
  $("setCameraBtn").textContent = `Camera: ${on("cameraBtn") ? "on" : "off"}`;
  $("setVoiceBtn").classList.toggle("primary", on("voiceBtn")); $("setCameraBtn").classList.toggle("primary", on("cameraBtn"));
  setTimeout(syncVC, 500);
})();

// ---------------- Settings > General > Theme colours ----------------
const THEMES_UI = {
  "Midnight blue": { accent: "#3e8eff", bg: "#000000", panel: "#16191e" },
  "Sakura": { accent: "#ff7aa8", bg: "#120a0e", panel: "#1f1418" },
  "Forest": { accent: "#5fcf80", bg: "#070d09", panel: "#121a15" },
  "Sunset": { accent: "#ff9a3c", bg: "#0f0905", panel: "#1d1510" },
  "Lavender": { accent: "#a78bfa", bg: "#0b0912", panel: "#18152a" },
  "Crimson": { accent: "#ff4d5e", bg: "#0d0507", panel: "#1c1012" },
  "Ocean": { accent: "#22d3ee", bg: "#03090c", panel: "#0f1a20" },
  "Light": { accent: "#2f6fe0", bg: "#e9ecf2", panel: "#ffffff", light: true },
};
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixHex = (h, k) => { const [r, g, b] = hexRgb(h).map((v) => Math.round(Math.min(255, Math.max(0, v + (k > 0 ? (255 - v) * k : v * k))))); return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`; };
function applyTheme(t) {
  t = t || THEMES_UI["Midnight blue"];
  const light = t.light || hexRgb(t.bg).reduce((a, b) => a + b, 0) > 384;
  const r = document.documentElement.style, [ar, ag, ab] = hexRgb(t.accent);
  r.setProperty("--blue", t.accent); r.setProperty("--accent-rgb", `${ar}, ${ag}, ${ab}`);
  r.setProperty("--blue-soft", `rgba(${ar},${ag},${ab},0.14)`); r.setProperty("--blue-glow", `rgba(${ar},${ag},${ab},0.45)`);
  r.setProperty("--black", t.bg); r.setProperty("--plum", t.bg); r.setProperty("--plum-2", mixHex(t.bg, light ? -0.06 : 0.08));
  r.setProperty("--paper", t.panel); r.setProperty("--raised", mixHex(t.panel, light ? -0.05 : 0.07));
  r.setProperty("--line", mixHex(t.panel, light ? -0.15 : 0.16)); r.setProperty("--line-2", mixHex(t.panel, light ? -0.25 : 0.26));
  const ink = light ? "#1b1f27" : "#e6e9ee";
  r.setProperty("--ink", ink); r.setProperty("--on-plum", ink); r.setProperty("--strong", light ? "#0d1117" : "#ffffff"); r.setProperty("--muted", light ? "#5b6472" : "#8b929d");
  document.documentElement.style.colorScheme = light ? "light" : "dark";
}
function renderThemes() {
  const cur = state.ui?.theme || THEMES_UI["Midnight blue"];
  $("themeSwatches").replaceChildren(...Object.entries(THEMES_UI).map(([name, t]) => {
    const b = document.createElement("button"); b.type = "button";
    b.setAttribute("aria-pressed", String(t.accent === cur.accent && t.bg === cur.bg && t.panel === cur.panel));
    const dot = document.createElement("i"); dot.style.background = `linear-gradient(135deg, ${t.accent} 50%, ${t.panel} 50%)`;
    b.append(dot, name);
    b.addEventListener("click", () => saveTheme({ ...t }));
    return b;
  }));
  $("themeAccent").value = cur.accent; $("themeBg").value = cur.bg; $("themePanel").value = cur.panel;
}
async function saveTheme(t) {
  applyTheme(t);
  state.ui = await api.save_ui({ theme: t });
  renderThemes();
}
for (const id of ["themeAccent", "themeBg", "themePanel"]) {
  $(id).addEventListener("input", () => applyTheme({ accent: $("themeAccent").value, bg: $("themeBg").value, panel: $("themePanel").value }));
  $(id).addEventListener("change", () => saveTheme({ accent: $("themeAccent").value, bg: $("themeBg").value, panel: $("themePanel").value }));
}

// UniMate sets itself up in the background the first time (skills/autosetup.py)
const SETUP_NAMES = { unimate: "UniMate (Rig & animate)", builtins: "Vermeil's voices, camera and AI" };
// one themed progress bar (bottom right) instead of a toast per step
function setupEvent(e) {
  const name = SETUP_NAMES[e.part] || e.part;
  let box = $("setupBar");
  if (e.error || e.done) {
    box?.remove();
    return toast(e.error ? `${name}: automatic setup failed - ${e.error}` : e.text || `${name} is ready.`, 6000);
  }
  if (!box) {
    box = el("div", { id: "setupBar", class: "setup-float", role: "status" }, el("strong", {}, `Setting up ${name}`),
      el("div", { class: "load-bar" }, el("i"), el("span")));
    document.body.append(box);
  }
  box.querySelector("i").style.width = `${Math.max(2, e.pct || 0)}%`;
  box.querySelector("span").textContent = `${e.pct || 0}% · ${e.text}`;
}
