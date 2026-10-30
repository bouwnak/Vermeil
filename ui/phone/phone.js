// Vermeil on your phone. Talks to the Vermeil running on your computer (brain/phone.py) through a private key.
"use strict";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("vermeil." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("vermeil." + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem("vermeil." + k); } catch { /* */ } },
};

// ---------------------------------------------------------------- the key (from the QR code's link)
(function takeKey() {
  const m = location.hash.match(/key=([A-Za-z0-9_-]{20,})/);
  if (m) {
    store.set("key", m[1]);
    history.replaceState(null, "", location.pathname);     // the key never stays in the address bar
  }
})();
let KEY = store.get("key", "");
let hello = null;

async function api(name, body, raw) {
  const opts = { method: "POST", headers: { "X-Vermeil-Key": KEY } };
  if (body instanceof Blob) { opts.body = body; opts.headers["Content-Type"] = body.type || "application/octet-stream"; }
  else { opts.body = JSON.stringify(body || {}); opts.headers["Content-Type"] = "application/json"; }
  let r;
  try { r = await fetch("/api/" + name, opts); }
  catch { setOnline(false); throw new Error("Can't reach your computer. Is Vermeil open and Phone access on?"); }
  setOnline(true);
  if (r.status === 401) { showConnect("This phone isn't connected (or the key was changed). Scan the QR code again."); throw new Error("not connected"); }
  if (raw && r.ok && !(r.headers.get("Content-Type") || "").includes("json")) return r.blob();
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || "Something went wrong (" + r.status + ").");
  return data;
}

function setOnline(on) { $("statusDot").className = "dot " + (on ? "on" : "off"); }
let toastTimer;
function toast(text, ms = 3500) {
  const t = $("toast"); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}

// ---------------------------------------------------------------- screens & tabs
function showConnect(why) {
  $("app").hidden = true; $("connect").hidden = false; $("connectWhy").textContent = why || "";
  stopHandsFree();
}
function showTab(name) {
  document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + name));
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  store.set("tab", name);
  if (name === "chat") scrollEnd($("msgs"));
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => { unlockAudio(); showTab(b.dataset.tab); }));

// ---------------------------------------------------------------- messages
function scrollEnd(box) { requestAnimationFrame(() => { const tab = box.closest(".tab"); tab.scrollTop = tab.scrollHeight; }); }
function addMsg(box, who, text, extra) {
  const d = document.createElement("div");
  d.className = "msg " + who;
  d.textContent = text;
  if (extra) d.append(extra);
  box.append(d); scrollEnd(box);
  return d;
}
function saveChat() {
  const items = [...$("msgs").children].filter((d) => !d.classList.contains("typing")).slice(-60)
    .map((d) => [d.classList.contains("me") ? "me" : d.classList.contains("sys") ? "sys" : "her", d.firstChild ? d.firstChild.textContent : ""]);
  store.set("chat", items);
}

// ---------------------------------------------------------------- audio out (her voice from the PC, or the phone's voice)
const player = new Audio();
let audioUnlocked = false;
function unlockAudio() {           // phones only play sound that started from a tap: unlock once on the first tap
  if (audioUnlocked) return;
  audioUnlocked = true;
  player.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
  player.play().catch(() => {});
  if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
}
let speaking = false;
function phoneVoice(text, lang) {
  return new Promise((res) => {
    if (!("speechSynthesis" in window)) return res();
    const u = new SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    u.onend = u.onerror = () => res();
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  });
}
async function playBlob(blob) {
  const url = URL.createObjectURL(blob);
  player.src = url;
  await new Promise((res) => { player.onended = player.onerror = res; player.play().catch(res); });
  URL.revokeObjectURL(url);
}
async function say(text, opts = {}) {
  if (!text || !$("speakReplies").checked) return;
  speaking = true; pauseEars();
  setOrb("speaking");
  try {
    if ($("pcVoice").checked) {
      try { await playBlob(await api(opts.language ? "speak_lang" : "speak", { text, language: opts.language }, true)); }
      catch { await phoneVoice(text, opts.bcp47); }
    } else await phoneVoice(text, opts.bcp47);
  } finally { speaking = false; setOrb(""); resumeEars(); }
}
function stopTalking() { player.pause(); if ("speechSynthesis" in window) speechSynthesis.cancel(); }

// ---------------------------------------------------------------- speech in
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LANG_BCP = { ja: "ja-JP", ko: "ko-KR", es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-BR", zh: "zh-CN",
  tl: "fil-PH", th: "th-TH", vi: "vi-VN", id: "id-ID", ru: "ru-RU", ar: "ar-SA", hi: "hi-IN", nl: "nl-NL", tr: "tr-TR", en: "en-US" };

// one sentence: the phone's own speech recognition if it has one, else record and let Whisper on the PC listen
function hearOnce(lang = "en-US") {
  if (SR) {
    return new Promise((res, rej) => {
      const r = new SR(); r.lang = lang; r.interimResults = false; r.maxAlternatives = 1;
      let got = "";
      r.onresult = (e) => { got = e.results[0][0].transcript; };
      r.onerror = (e) => (e.error === "no-speech" ? res("") : rej(new Error(micError(e.error))));
      r.onend = () => res(got);
      r.start();
    });
  }
  return recordAndTranscribe();
}
function micError(code) {
  return code === "not-allowed" || code === "service-not-allowed"
    ? "Allow the microphone for this page (in the browser's site settings)." : "Couldn't hear you (" + code + ").";
}
async function recordAndTranscribe(seconds = 6) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream); const parts = [];
  rec.ondataavailable = (e) => parts.push(e.data);
  const done = new Promise((res) => (rec.onstop = res));
  rec.start(); setTimeout(() => rec.state !== "inactive" && rec.stop(), seconds * 1000);
  await done; stream.getTracks().forEach((t) => t.stop());
  const out = await api("hear", new Blob(parts, { type: rec.mimeType || "audio/webm" }));
  return out.text || "";
}

// ---------------------------------------------------------------- chat
async function send(text, from = "chat") {
  text = (text || "").trim();
  if (!text) return;
  addMsg($("msgs"), "me", text);
  const wait = addMsg($("msgs"), "her typing", "");
  if (from === "talk") { $("talkHeard").textContent = "“" + text + "”"; $("talkReply").textContent = ""; setOrb("thinking"); }
  try {
    const out = await api("chat", { text });
    wait.remove();
    addMsg($("msgs"), "her", out.reply);
    if (from === "talk") $("talkReply").textContent = out.reply;
    saveChat();
    await say(out.reply);
  } catch (e) {
    wait.remove(); addMsg($("msgs"), "sys", e.message);
    if (from === "talk") $("talkReply").textContent = e.message;
  } finally { if (from === "talk") setOrb(""); }
}
$("chatForm").addEventListener("submit", (e) => {
  e.preventDefault(); unlockAudio();
  const t = $("chatInput").value; $("chatInput").value = ""; send(t);
});
$("chatMic").addEventListener("click", async () => {
  unlockAudio(); stopTalking();
  const b = $("chatMic"); b.classList.add("rec");
  try { const t = await hearOnce(); if (t) send(t); else toast("I didn't hear anything."); }
  catch (e) { toast(e.message); } finally { b.classList.remove("rec"); }
});

// ---------------------------------------------------------------- talk + hands-free wake word
function setOrb(state) {
  const o = $("orb"); o.classList.remove("listening", "thinking", "speaking"); if (state) o.classList.add(state);
  $("talkState").textContent = {
    listening: "Listening…", thinking: "Thinking…", speaking: "Speaking… (tap to stop)",
  }[state] || (handsFree ? "Say “" + wakeWord() + "” and then your question" : "Tap the circle and talk");
}
$("orb").addEventListener("click", async () => {
  unlockAudio();
  if (speaking) { stopTalking(); return; }
  if (handsFree) { awaitingCommand = true; beep(); setOrb("listening"); return; }
  setOrb("listening");
  try { const t = await hearOnce(); setOrb(""); if (t) send(t, "talk"); else $("talkState").textContent = "I didn't hear anything. Tap and try again."; }
  catch (e) { setOrb(""); toast(e.message); }
});

function wakeWord() { return ($("wakeWord").value || "Vermeil").trim(); }
function wakeWords() {
  const w = [wakeWord(), "vermeil", "hey vermeil"];
  if (hello && hello.name) w.push(hello.name, "hey " + hello.name);
  return [...new Set(w.map((x) => x.toLowerCase()))].sort((a, b) => b.length - a.length);
}
const SOUNDS_LIKE = { vermeil: ["vermeil", "vermail", "vermeille", "ver meil", "vermel", "vermeer", "for mail", "fair mail"] };
function findWake(text) {
  const t = " " + text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ") + " ";
  for (const w of wakeWords()) {
    for (const v of SOUNDS_LIKE[w] || [w]) {
      const i = t.indexOf(" " + v + " ");
      if (i >= 0) return t.slice(i + v.length + 2).trim();
    }
  }
  return null;
}

let handsFree = false, rec = null, awaitingCommand = false, awaitTimer = null, wakeLock = null, earsPaused = false;
function beep() {
  try {
    const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.12);
  } catch { /* no sound - fine */ }
}
function startEars() {
  if (!SR) return;
  rec = new SR(); rec.lang = "en-US"; rec.continuous = true; rec.interimResults = false;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      const heard = e.results[i][0].transcript.trim();
      if (awaitingCommand) { endAwait(); if (heard) send(heard, "talk"); continue; }
      const rest = findWake(heard);
      if (rest === null) continue;
      if (rest.length > 2) send(rest, "talk");
      else { awaitingCommand = true; beep(); setOrb("listening"); awaitTimer = setTimeout(endAwait, 8000); }
    }
  };
  rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { toast(micError(e.error)); stopHandsFree(); } };
  rec.onend = () => { if (handsFree && !earsPaused) setTimeout(() => { try { rec && rec.start(); } catch { /* already on */ } }, 250); };
  try { rec.start(); } catch { /* */ }
}
function endAwait() { awaitingCommand = false; clearTimeout(awaitTimer); if (!speaking) setOrb(""); }
function pauseEars() { if (rec) { earsPaused = true; try { rec.stop(); } catch { /* */ } } }   // she doesn't hear herself
function resumeEars() { if (rec && handsFree) { earsPaused = false; try { rec.start(); } catch { /* */ } } }

async function startHandsFree() {
  unlockAudio();
  if (!SR) { toast("This browser can't listen hands-free. Use Chrome on Android or Safari on iPhone, or tap the circle to talk."); return; }
  handsFree = true; startEars(); updateHandsFree();
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch { /* not allowed - fine */ }
  toast("Hands-free on. Say “" + wakeWord() + "” and then what you want.");
}
function stopHandsFree() {
  handsFree = false; endAwait();
  if (rec) { const r = rec; rec = null; try { r.stop(); } catch { /* */ } }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  updateHandsFree();
}
function updateHandsFree() {
  $("handsFreeChip").setAttribute("aria-pressed", String(handsFree));
  $("handsFreeChip").textContent = handsFree ? "👂 Hands-free on" : "👂 Hands-free off";
  $("handsFreeBtn").textContent = handsFree ? "■ Stop hands-free" : "👂 Start hands-free";
  setOrb("");
}
const toggleHandsFree = () => (handsFree ? stopHandsFree() : startHandsFree());
$("handsFreeBtn").addEventListener("click", toggleHandsFree);
$("handsFreeChip").addEventListener("click", toggleHandsFree);
document.addEventListener("visibilitychange", async () => {     // the screen lock lets go when you leave the page
  if (document.visibilityState === "visible" && handsFree) {
    try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch { /* */ }
    if (rec && !earsPaused) { try { rec.start(); } catch { /* */ } }
  }
});

// ---------------------------------------------------------------- practice partner
let practicing = null;
function bcp(lang) { return LANG_BCP[lang] || lang; }
$("pStart").addEventListener("click", async () => {
  unlockAudio();
  const b = $("pStart"); b.disabled = true; b.textContent = "Starting…";
  try {
    const out = await api("partner_start", { language: $("pLang").value, level: +$("pLevel").value, topic: $("pTopic").value });
    practicing = out.language;
    store.set("practice", { language: $("pLang").value, level: $("pLevel").value });
    $("practiceSetup").hidden = true; $("practiceLive").hidden = false; $("pMsgs").textContent = "";
    addMsg($("pMsgs"), "sys", "Practicing " + out.name + ". Tap 🎙 and answer out loud.");
    const first = (out.session.messages || []).slice(-1)[0];
    if (first) await partnerSays(first.content, "");
  } catch (e) { toast(e.message); }
  finally { b.disabled = false; b.textContent = "▶ Start talking"; }
});
function playBtn(text) {
  const p = document.createElement("button"); p.className = "play"; p.textContent = "🔊"; p.ariaLabel = "Play again";
  p.onclick = () => say(text, { language: practicing, bcp47: bcp(practicing) });
  return p;
}
async function partnerSays(talk, correction) {
  if (correction) addMsg($("pMsgs"), "fix", "✏️ " + correction);
  if (talk) { addMsg($("pMsgs"), "her", talk, playBtn(talk)); await say(talk, { language: practicing, bcp47: bcp(practicing) }); }
}
async function practiceAnswer(text) {
  text = (text || "").trim(); if (!text) return;
  addMsg($("pMsgs"), "me", text);
  const wait = addMsg($("pMsgs"), "her typing", "");
  try {
    const out = await api("partner_reply", { text });
    wait.remove();
    if (out.score !== undefined || out.message) return practiceDone(out);
    await partnerSays(out.talk, out.correction);
  } catch (e) { wait.remove(); addMsg($("pMsgs"), "sys", e.message); }
}
function practiceDone(out) {
  addMsg($("pMsgs"), "sys", (out.score ? "Score: " + out.score + "\n" : "") + (out.message || "Practice finished."));
  practicing = null;
  setTimeout(() => { $("practiceLive").hidden = true; $("practiceSetup").hidden = false; }, 4000);
}
$("pMic").addEventListener("click", async () => {
  unlockAudio(); stopTalking();
  const b = $("pMic"); b.classList.add("listening");
  try { const t = await hearOnce(bcp(practicing)); if (t) practiceAnswer(t); else toast("I didn't hear anything."); }
  catch (e) { toast(e.message); } finally { b.classList.remove("listening"); }
});
$("pType").addEventListener("click", () => { $("pForm").hidden = !$("pForm").hidden; if (!$("pForm").hidden) $("pInput").focus(); });
$("pForm").addEventListener("submit", (e) => { e.preventDefault(); const t = $("pInput").value; $("pInput").value = ""; practiceAnswer(t); });
$("pStop").addEventListener("click", async () => {
  stopTalking();
  try { practiceDone(await api("partner_stop")); } catch (e) { toast(e.message); }
});

// ---------------------------------------------------------------- characters
function renderChars() {
  const box = $("charList"); box.textContent = "";
  for (const c of hello.characters) {
    const b = document.createElement("button");
    b.textContent = c.name; if (c.id === hello.active) { b.className = "active"; b.append(Object.assign(document.createElement("span"), { textContent: "✓" })); }
    b.onclick = async () => {
      try { hello = await api("switch", { id: c.id }); applyHello(); toast("Now talking to " + hello.name + "."); showTab("chat"); }
      catch (e) { toast(e.message); }
    };
    box.append(b);
  }
}

// ---------------------------------------------------------------- settings
for (const [id, def] of [["speakReplies", true], ["pcVoice", true]]) {
  $(id).checked = store.get(id, def);
  $(id).addEventListener("change", () => store.set(id, $(id).checked));
}
$("wakeWord").value = store.get("wake", "");
$("wakeWord").addEventListener("input", () => {
  store.set("wake", $("wakeWord").value);
  document.querySelectorAll(".wakeWord").forEach((b) => (b.textContent = wakeWord()));
});
$("copyKey").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(KEY); toast("Key copied. Paste it as the header's value."); }
  catch { prompt("Copy your key:", KEY); }
});
$("openNative").addEventListener("click", (e) => {   // hands the address + key to the phone app (phone-ios/, android/)
  e.preventDefault();
  location.href = `vermeil://pair?u=${encodeURIComponent(location.origin)}&k=${encodeURIComponent(KEY)}`;
});
$("nativeCard").hidden = !/iPhone|iPad|iPod|Android/.test(navigator.userAgent);   // iPhone: phone-ios/, Android: android/
if (/Android/.test(navigator.userAgent)) {
  $("nativeExtra").textContent = ", and can be your phone's assistant button";
  $("nativeHow").innerHTML = 'Install it first: <a href="https://github.com/bouwnak/Vermeil/releases/tag/android-app" target="_blank" rel="noopener">download Vermeil.apk</a> on this phone.';
}
$("forget").addEventListener("click", () => {
  if (!confirm("Disconnect this phone? You'll need to scan the QR code again.")) return;
  store.del("key"); store.del("chat"); KEY = ""; showConnect("Disconnected.");
});

function applyHello() {
  $("charName").textContent = hello.name;
  document.title = hello.name === "Vermeil" ? "Vermeil" : hello.name + " · Vermeil";
  const sel = $("pLang"), saved = store.get("practice", {});
  if (!sel.options.length) {
    for (const [code, name] of Object.entries(hello.languages || {})) sel.append(new Option(name, code));
  }
  sel.value = saved.language || hello.language; $("pLevel").value = saved.level || hello.level;
  if (hello.partner && hello.partner.active && !practicing) {
    practicing = hello.partner.language; $("practiceSetup").hidden = true; $("practiceLive").hidden = false;
  }
  renderChars();
  document.querySelectorAll(".wakeWord").forEach((b) => (b.textContent = wakeWord()));
}

// ---------------------------------------------------------------- start
async function start() {
  if (!KEY) return showConnect("");
  $("connect").hidden = true; $("app").hidden = false;
  $("hostName").textContent = location.host;
  $("shortcutUrl").textContent = location.origin + "/api/shortcut";
  for (const [who, text] of store.get("chat", [])) addMsg($("msgs"), who, text);
  showTab(store.get("tab", "chat"));
  try { hello = await api("hello"); applyHello(); }
  catch (e) { if (e.message !== "not connected") addMsg($("msgs"), "sys", e.message); }
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
start();
