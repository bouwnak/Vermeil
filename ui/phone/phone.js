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

// ---------------------------------------------------------------- Study: offline flashcards, send a file, notifications
// The cards are saved on the phone, so they work with no signal; answers wait on the phone and go to your
// computer the next time it can be reached.
let cards = store.get("cards", []);
let cardAt = 0;
function cardInfo() {
  const waiting = store.get("cardAnswers", []).length;
  const left = cards.length - cardAt;
  $("cardInfo").textContent = `${left} card${left === 1 ? "" : "s"} left` +
    (waiting ? ` · ${waiting} answer${waiting === 1 ? "" : "s"} waiting to sync` : "") + (store.get("cardsDay", "") ? ` · saved ${store.get("cardsDay", "")}` : "");
}
function drawCard() {
  const box = $("cardBox");
  box.replaceChildren();
  cardInfo();
  const c = cards[cardAt];
  const p = (cls, text) => { const e = document.createElement("div"); e.className = cls; e.textContent = text; return e; };
  if (!c) { box.append(p("front", cards.length ? "Deck done! 🎉" : "No cards saved yet."), p("muted", "Tap \"Get today's cards\" when you have signal.")); return; }
  const back = p("back", c.back);
  back.hidden = true;
  const row = document.createElement("div"); row.className = "row";
  const btn = (text, cls, fn) => { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = text; b.onclick = fn; return b; };
  const answer = (knew) => {
    store.set("cardAnswers", [...store.get("cardAnswers", []), { id: c.id, knew }]);
    cardAt += 1; store.set("cardAt", cardAt); drawCard(); syncAnswers();
  };
  const show = btn("Show answer", "primary", () => { back.hidden = false; show.hidden = true; row.hidden = false; });
  row.hidden = true;
  row.append(btn("✗ Missed", "", () => answer(false)), btn("✓ Knew it", "primary", () => answer(true)));
  box.append(p("muted", c.deck || ""), p("front", c.front), back, show, row);
}
async function syncAnswers() {
  const answers = store.get("cardAnswers", []);
  if (!answers.length || !KEY) return;
  try { await api("card_answers", { answers }); store.set("cardAnswers", []); } catch { /* offline: try again later */ }
  cardInfo();
}
$("cardSync").addEventListener("click", async () => {
  await syncAnswers();
  try {
    const d = await api("cards", { limit: 60 });
    cards = d.cards; cardAt = 0;
    store.set("cards", cards); store.set("cardAt", 0); store.set("cardsDay", new Date().toLocaleDateString());
    toast(cards.length ? `${cards.length} cards saved on this phone. They work offline.` : "All caught up for today!");
    drawCard();
  } catch (e) { toast(e.message); }
});
cardAt = Math.min(store.get("cardAt", 0), cards.length);
drawCard();
window.addEventListener("online", syncAnswers);

$("upBtn").addEventListener("click", () => $("upFile").click());
$("upFile").addEventListener("change", async () => {
  const f = $("upFile").files[0];
  if (!f) return;
  if (f.size > 300 * 1024 * 1024) return toast("That file is too big (300 MB at most).");
  $("upInfo").textContent = `Sending ${f.name} (${(f.size / 1048576).toFixed(1)} MB)…`;
  $("upBtn").disabled = true;
  try {
    const r = await fetch("/api/upload", { method: "POST", body: f, headers: { "X-Vermeil-Key": KEY, "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(f.name) } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.error) throw new Error(d.error || "Couldn't send it (" + r.status + ").");
    $("upInfo").textContent = d.message;
  } catch (e) { $("upInfo").textContent = e.message; }
  finally { $("upBtn").disabled = false; $("upFile").value = ""; }
});

// reminder notifications: ask the computer every minute while the app is open
async function checkNotices() {
  if (!KEY || !store.get("notify", false)) return;
  try {
    const d = await api("notices", { after: store.get("noticeAfter", 0) });
    for (const n of d.notes) {
      store.set("noticeAfter", n.id);
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg && Notification.permission === "granted") reg.showNotification(n.title, { body: n.body, icon: "/phone/icon.png", tag: "vermeil-" + n.id });
      else toast("🔔 " + n.body, 8000);
    }
  } catch { /* offline */ }
}
function notifyLabel() { $("notifyBtn").textContent = store.get("notify", false) ? "🔕 Turn off reminder notifications" : "🔔 Turn on reminder notifications"; }
$("notifyBtn").addEventListener("click", async () => {
  if (store.get("notify", false)) { store.set("notify", false); return notifyLabel(); }
  if (!("Notification" in window)) return toast("This browser can't show notifications. Add the app to your home screen first.");
  const ok = (await Notification.requestPermission()) === "granted";
  store.set("notify", ok);
  notifyLabel();
  toast(ok ? "Reminders will pop up on this phone." : "Notifications are blocked. Allow them in your browser settings.");
  if (ok) { try { store.set("noticeAfter", Math.max(0, ...(await api("notices", { after: 0 })).notes.map((n) => n.id))); } catch { /* */ } }
});
notifyLabel();
setInterval(checkNotices, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkNotices(); syncAnswers(); } });

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

// ---------------------------------------------------------------- retro games (the computer's player, emulator and saves)
// The emulator loads its own files and can't send the key header, so the key goes in a cookie for /phone/retro/ only.
window.retroHost = {
  async call(name, ...args) { try { return await api(name, { args }); } catch (e) { return { error: e.message }; } },
  accent: () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#3e8eff",
  started(msg) { $("retroInfo").textContent = typeof msg === "string" ? msg : ""; },
  saved() { toast("Saved — it's on your computer too."); },
  failed(text) { toast(text); closeRetro(); },
  poke() {},
};
async function loadRetro() {
  const box = $("retroList");
  box.textContent = "Loading…";
  let lib;
  try { lib = await api("retro_library", { args: [] }); } catch (e) { box.textContent = e.message; return; }
  const seen = new Set(), games = [];
  for (const g of [...(lib.favorites || []), ...(lib.recent || [])]) if (g.url && !seen.has(g.url)) { seen.add(g.url); games.push(g); }
  box.textContent = games.length ? "" : "No games yet. Play one in Games → Retro Games on your computer first.";
  for (const g of games) {
    const b = document.createElement("button");
    b.textContent = g.title || g.name || "Game";
    b.append(Object.assign(document.createElement("small"), { textContent: [g.platform, g.saved ? "💾 saved" : ""].filter(Boolean).join(" · ") }));
    b.onclick = () => playRetro(g);
    box.append(b);
  }
}
async function playRetro(g) {
  document.cookie = "vk=" + KEY + "; path=/phone/retro; SameSite=Strict; max-age=86400";
  $("retroInfo").textContent = "Getting " + (g.title || "the game") + " ready…";
  try {
    const info = await api("retro_prepare", { args: [g] });
    for (let i = 0; i < 600; i++) {                     // the computer downloads the game first (if it's new)
      const p = await api("retro_progress", { args: [info.id, info.bios || "", info.parent || ""] });
      if (p.error) throw new Error(p.error);
      if (p.done) break;
      $("retroInfo").textContent = "Downloading… " + (p.total ? Math.round(p.got / p.total * 100) : 0) + "%";
      await new Promise((r) => setTimeout(r, 1000));
    }
    const q = new URLSearchParams({ core: info.core, rom: info.rom, bios: info.bios || "", parent: info.parent || "", id: info.id, name: g.title || "", image: g.image || "" });
    const f = document.createElement("iframe");
    f.allow = "autoplay; fullscreen; gamepad"; f.src = "/phone/retro/player.html?" + q;
    $("retroFrame").replaceChildren(f);
    $("retroTitle").textContent = g.title || "";
    $("retroPlay").hidden = false;
  } catch (e) { $("retroInfo").textContent = e.message; }
}
async function closeRetro() {
  const f = $("retroFrame").querySelector("iframe");
  try { if (f) await Promise.race([f.contentWindow.backupSram?.(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* not started */ }
  $("retroFrame").replaceChildren(); $("retroPlay").hidden = true;
  loadRetro();
}
$("retroClose").onclick = closeRetro;
document.querySelector('.tabs button[data-tab="games"]').addEventListener("click", loadRetro);

// ---------------------------------------------------------------- Run: GPS like Strava (saved on the computer's Gym)
let runWatch = null, runPts = [], runTick = null, runLock = null;
const runDist = (a, b) => {
  const R = 6371000, r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const runKm = () => runPts.reduce((s, p, i) => (i ? s + runDist(runPts[i - 1], p) : 0), 0) / 1000;
const runPace = (secs, km) => (km >= 0.05 ? Math.floor(secs / 60 / km) + ":" + String(Math.round(((secs / 60 / km) % 1) * 60)).padStart(2, "0") + " /km" : "-");
function routeSvg(route, w = 160, h = 110) {
  if (!route || route.length < 2) return "";
  const lats = route.map((p) => p[0]), lons = route.map((p) => p[1]);
  const a = Math.min(...lats), b = Math.max(...lats), c = Math.min(...lons), d = Math.max(...lons);
  const span = Math.max(b - a, d - c, 1e-5);
  const pts = route.map(([la, lo]) => (((lo - c) / span) * (w - 10) + 5).toFixed(1) + "," + (h - ((la - a) / span) * (h - 10) - 5).toFixed(1)).join(" ");
  return '<svg viewBox="0 0 ' + w + " " + h + '" role="img" aria-label="Route map"><polyline points="' + pts +
    '" fill="none" stroke="#ff7a59" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}
function drawRunLive() {
  const secs = runPts.length > 1 ? (runPts[runPts.length - 1][2] - runPts[0][2]) / 1000 : 0, km = runKm();
  const cell = (label, value) => { const d = document.createElement("div"); d.append(Object.assign(document.createElement("small"), { textContent: label }), Object.assign(document.createElement("b"), { textContent: value })); return d; };
  $("runStats").replaceChildren(cell("Distance", km.toFixed(2) + " km"),
    cell("Time", Math.floor(secs / 60) + ":" + String(Math.floor(secs % 60)).padStart(2, "0")),
    cell("Pace", runPace(secs, km)), cell("Steps", String(Math.round((km * 1000) / 0.78))));
  $("runMap").innerHTML = routeSvg(runPts.map((p) => [p[0], p[1]]), 240, 140);
}
async function loadRuns() {
  let r;
  try { r = await api("gym_runs"); } catch (e) { $("runWeek").textContent = e.message; return; }
  $("runWeek").textContent = "This week: " + r.week_km + " km · " + r.week_count + " activit" + (r.week_count === 1 ? "y" : "ies") +
    " · " + r.week_steps.toLocaleString() + " steps" + (r.best_pace ? " · best pace " + r.best_pace : "") + (r.longest ? " · longest " + r.longest + " km" : "");
  const box = $("runList");
  box.textContent = r.runs.length ? "" : "No runs yet. Press ▶ Start and go!";
  for (const x of r.runs) {
    const row = document.createElement("div");
    row.className = "run-item";
    const map = document.createElement("div"); map.className = "route"; map.innerHTML = routeSvg(x.route);
    const info = document.createElement("div");
    info.append(Object.assign(document.createElement("b"), { textContent: ({ run: "🏃", walk: "🚶", ride: "🚴" }[x.kind] || "🏃") + " " + x.km + " km" }),
      Object.assign(document.createElement("small"), { textContent: x.date.replace("T", " ") + " · " + Math.round(x.seconds / 60) + " min · " + x.pace_text + " · ~" + x.kcal + " kcal" }));
    const del = Object.assign(document.createElement("button"), { className: "x", textContent: "×", ariaLabel: "Delete this activity" });
    del.onclick = async () => { if (!confirm("Delete this activity?")) return; try { await api("gym_run_remove", { args: [x.id] }); } catch (e) { toast(e.message); } loadRuns(); };
    row.append(map, info, del);
    box.append(row);
  }
}
$("runBtn").onclick = async () => {
  const btn = $("runBtn");
  if (!runWatch) {
    if (!navigator.geolocation) return toast("This phone has no location.");
    runPts = [];
    runWatch = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords;
      runPts.push([c.latitude, c.longitude, pos.timestamp || Date.now(), c.accuracy ?? null]);
    }, (e) => toast("Location: " + e.message), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    runTick = setInterval(drawRunLive, 1000);
    try { runLock = await navigator.wakeLock?.request("screen"); } catch { /* the screen may sleep */ }
    btn.textContent = "■ Stop & save"; $("runKind").disabled = true;
    drawRunLive();
    return;
  }
  navigator.geolocation.clearWatch(runWatch); clearInterval(runTick); runWatch = null;
  try { runLock?.release(); } catch { /* */ } runLock = null;
  btn.textContent = "▶ Start"; $("runKind").disabled = false;
  try { await api("gym_run_save", { args: [runPts, "", $("runKind").value] }); toast("Saved. Nice work!"); }
  catch (e) { toast(e.message); }
  loadRuns();
};
document.querySelector('.tabs button[data-tab="run"]').addEventListener("click", loadRuns);
if (store.get("tab", "chat") === "run") loadRuns();
