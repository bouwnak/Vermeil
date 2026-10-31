// night.js - Game Night with Vermeil: the game library, chess, card games (Color Clash, Go Fish), trivia night,
// word games (five letters, hangman), the drawing game, puzzle of the day (sudoku, nonogram), a typing race,
// a rhythm game with your songs, escape rooms from your study topics and the weekly tournament.
// Scores, puzzles, questions and words come from Python (skills/gamenight.py through Api.gn_*); in a normal
// browser (testing) add ?bridge.
const $ = (id) => document.getElementById(id);
const isTest = new URLSearchParams(location.search).has("bridge");
const keep = isTest ? "?bridge" : "";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
    if (!api?.[name]) return { error: "Game Night needs the Vermeil app (open it from Games)." };
    return await api[name](...args);
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// your theme from Vermeil (the same as the Games hub)
(function theme() {
  let t = null;
  try { t = JSON.parse(localStorage.getItem("vermeil_theme") || "null"); } catch { /* ignore */ }
  if (!t?.accent) return;
  const n = parseInt(t.accent.slice(1), 16);
  document.documentElement.style.setProperty("--blue", t.accent);
  document.documentElement.style.setProperty("--accent-rgb", `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`);
})();

// ---------------- Vermeil talks ----------------
const LINES = {
  hello: ["Game night! Pick something and I'll play with you.", "I've been waiting for this all day~", "Ready to lose? Just kidding. Maybe."],
  chess_start: { 1: ["I'll go easy on you. Promise!", "Let's just have fun, okay?"], 2: ["A real game then. Good luck~", "Don't blunder your queen!"], 3: ["No mercy tonight.", "I've been studying openings. Be careful."] },
  chess_you_take: ["Hey! I liked that piece.", "Ouch. Nice one.", "Okay, okay, I saw that coming… kind of."],
  chess_she_takes: ["Thank you very much~", "Mine now!", "You left that one hanging."],
  chess_check: ["Check! Watch your king.", "Check~"],
  chess_in_check: ["Eek, check. Hold on.", "Okay that's scary."],
  win: ["You win! I'll get you next time.", "Fine, you're good. Really good.", "Ugh, you won. Rematch?"],
  lose: ["I win! Want a rematch?", "Hehe, my point~", "Better luck next round!"],
  draw: ["A draw! We're both too good.", "Nobody wins… so we both do?"],
  think: ["Hmm…", "Let me think…", "Ooh, tricky."],
  uno_forgot: ["You forgot to say Uno! Draw two~"],
  uno_her: ["Uno!"],
  fish: ["Go fish!", "Nope. Go fish~"],
  trivia_right_both: ["We both got it!", "Easy one."],
  trivia_you_only: ["How did you know that?", "Okay, you got me there."],
  trivia_her_only: ["Hehe, I knew that one.", "That's a point for me!"],
  trivia_neither: ["Neither of us! That was hard.", "Wow, okay, nobody knew."],
  word_win: ["You got it!", "Nice guessing!"],
  word_lose: ["So close!", "Next one you'll get."],
  draw_good: ["Is it… yes it is! Good drawing!"],
  draw_bad: ["Hmm, I have no idea. Is that art?", "I give up, what is it?"],
  puzzle: ["Puzzle of the day! A new one every day.", "Keep your streak going~"],
  typing: ["Type fast! I'm racing you.", "Ready, set…"],
  escape: ["You're locked in! Answer to get out~", "I hid the keys well this time."],
};
function say(key, extra) {
  const pool = typeof key === "string" ? (LINES[key] ?? [key]) : key;
  const text = (Array.isArray(pool) ? pick(pool) : pool) + (extra ? ` ${extra}` : "");
  const p = $("gnSay");
  p.textContent = text;
  $("gnHer").classList.remove("pop"); void $("gnHer").offsetWidth; $("gnHer").classList.add("pop");
}

// ---------------- play time + results (the library and the tournament) ----------------
let session = null;
function startSession(game) {
  endSession();
  session = { game, t0: Date.now() };
}
async function endSession(result = null, detail = "") {
  if (!session) return;
  const secs = Math.round((Date.now() - session.t0) / 1000);
  const game = session.game;
  session = result ? { game, t0: Date.now() } : null;            // a finished game keeps the clock for the next round
  if (!result && secs < 20) return;
  const r = await call("gn_record", game, secs, result, detail);
  if (r?.tournament) paintCup(r.tournament);
}
function finish(result, detail = "") {
  say(result === "win" ? "win" : result === "loss" ? "lose" : "draw");
  endSession(result, detail);
}
window.addEventListener("beforeunload", () => endSession());
function paintCup(t) {
  $("gnCupText").textContent = `${t.you} – ${t.her}`;
  $("gnCup").classList.toggle("lead", t.leader === "you");
}

// ---------------- tabs ----------------
const stage = $("gnStage");
let tab = "library", keyHandler = null, stopTab = null;
const TABS = { library, chess, cards, trivia, words, draw, puzzles, typing, rhythm, escape, tournament };
function open(name, opt) {
  if (!TABS[name]) return;
  stopTab?.(); stopTab = null; keyHandler = null;
  tab = name;
  for (const b of document.querySelectorAll("#gnTabs button")) b.classList.toggle("on", b.dataset.tab === name);
  stage.innerHTML = "";
  stage.className = `gn-stage tab-${name}`;
  TABS[name](opt);
}
$("gnTabs").onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) open(b.dataset.tab); };
$("gnCup").onclick = () => open("tournament");
$("gnBack").onclick = () => { endSession(); location.href = `index.html${keep}`; };
document.addEventListener("keydown", (e) => {
  if (e.target.matches?.("input, textarea, select")) return;
  keyHandler?.(e);
});

// ================================================================= Library
const PLAY = { chess: ["chess"], uno: ["cards", "uno"], gofish: ["cards", "gofish"], trivia: ["trivia"], wordle: ["words", "wordle"],
  hangman: ["words", "hangman"], draw: ["draw"], sudoku: ["puzzles", "sudoku"], nonogram: ["puzzles", "nonogram"], typing: ["typing"],
  rhythm: ["rhythm"], escape: ["escape"] };
async function library() {
  stage.innerHTML = `<div class="gn-card"><h2>Your games</h2><p class="muted" id="libTotal">Loading…</p><div class="lib-grid" id="libGrid"></div></div>`;
  const r = await call("gn_library");
  if (r.error) { $("libTotal").textContent = r.error; return; }
  if (r.tournament) paintCup(r.tournament);
  paintLibrary(r);
}
function paintLibrary(r) {
  $("libTotal").textContent = `${r.total_hours} hours played in all. ★ = favourite (they stay at the top).`;
  $("libGrid").innerHTML = r.games.map((g) => `
    <div class="lib-game${g.fav ? " fav" : ""}" data-id="${esc(g.id)}">
      <button class="lib-star" type="button" title="Favourite" aria-label="Favourite">${g.fav ? "★" : "☆"}</button>
      <span class="lib-icon">${esc(g.icon)}</span>
      <b>${esc(g.name)}</b>
      <small>${g.minutes >= 60 ? `${g.hours} h` : `${g.minutes} min`} · ${g.sessions} time${g.sessions === 1 ? "" : "s"}</small>
      ${g.win + g.loss + g.draw ? `<small class="wl">${g.win}W ${g.loss}L${g.draw ? ` ${g.draw}D` : ""}</small>` : "<small class='wl'>&nbsp;</small>"}
      <button class="btn small" type="button" data-play="${esc(g.id)}">Play</button>
    </div>`).join("");
  $("libGrid").onclick = async (e) => {
    const card = e.target.closest(".lib-game");
    if (!card) return;
    if (e.target.closest(".lib-star")) { const r2 = await call("gn_fav", card.dataset.id); if (!r2.error) paintLibrary(r2); return; }
    if (e.target.closest("[data-play]")) {
      const id = card.dataset.id;
      if (id === "adventure") location.href = `../game/index.html${keep}`;
      else if (id === "retro") location.href = `index.html${keep ? keep + "&" : "?"}retro`;
      else if (PLAY[id]) open(PLAY[id][0], PLAY[id][1]);
    }
  };
}

// ================================================================= Chess (you are white)
const GL = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const side = (c) => (c === "." ? null : c === c.toUpperCase() ? "w" : "b");
const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOKD = [[-1, 0], [1, 0], [0, -1], [0, 1]], BISD = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const PV = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function attacked(b, sq, by) {
  const r = sq >> 3, c = sq & 7;
  const pr = by === "w" ? r + 1 : r - 1;
  for (const dc of [-1, 1]) if (inside(pr, c + dc) && b[pr * 8 + c + dc] === (by === "w" ? "P" : "p")) return true;
  for (const [dr, dc] of KN) if (inside(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === (by === "w" ? "N" : "n")) return true;
  for (const [dr, dc] of KG) if (inside(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === (by === "w" ? "K" : "k")) return true;
  const slide = (dirs, kinds) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc)) {
        const p = b[rr * 8 + cc];
        if (p !== ".") { if (side(p) === by && kinds.includes(p.toLowerCase())) return true; break; }
        rr += dr; cc += dc;
      }
    }
    return false;
  };
  return slide(ROOKD, "rq") || slide(BISD, "bq");
}
function pseudo(s) {
  const { b, turn } = s, out = [], foe = turn === "w" ? "b" : "w";
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (side(p) !== turn) continue;
    const r = i >> 3, c = i & 7, t = p.toLowerCase();
    const add = (to, extra) => out.push({ from: i, to, ...extra });
    if (t === "p") {
      const d = turn === "w" ? -1 : 1, start = turn === "w" ? 6 : 1, last = turn === "w" ? 0 : 7, r1 = r + d;
      if (inside(r1, c) && b[r1 * 8 + c] === ".") {
        add(r1 * 8 + c, r1 === last ? { promo: true } : {});
        if (r === start && b[(r + 2 * d) * 8 + c] === ".") add((r + 2 * d) * 8 + c, { double: true });
      }
      for (const dc of [-1, 1]) {
        if (!inside(r1, c + dc)) continue;
        const to = r1 * 8 + c + dc;
        if (side(b[to]) === foe) add(to, r1 === last ? { promo: true } : {});
        else if (to === s.ep) add(to, { ep: true });
      }
    } else if (t === "n" || t === "k") {
      for (const [dr, dc] of t === "n" ? KN : KG) if (inside(r + dr, c + dc) && side(b[(r + dr) * 8 + c + dc]) !== turn) add((r + dr) * 8 + c + dc, {});
      if (t === "k" && i === (turn === "w" ? 60 : 4) && !attacked(b, i, foe)) {
        const R = turn === "w" ? "R" : "r", [kS, qS] = turn === "w" ? ["K", "Q"] : ["k", "q"];
        if (s.cr.includes(kS) && b[i + 1] === "." && b[i + 2] === "." && b[i + 3] === R && !attacked(b, i + 1, foe) && !attacked(b, i + 2, foe)) add(i + 2, { castle: i + 3 });
        if (s.cr.includes(qS) && b[i - 1] === "." && b[i - 2] === "." && b[i - 3] === "." && b[i - 4] === R && !attacked(b, i - 1, foe) && !attacked(b, i - 2, foe)) add(i - 2, { castle: i - 4 });
      }
    } else {
      for (const [dr, dc] of t === "r" ? ROOKD : t === "b" ? BISD : [...ROOKD, ...BISD]) {
        let rr = r + dr, cc = c + dc;
        while (inside(rr, cc)) {
          const to = rr * 8 + cc;
          if (b[to] === ".") add(to, {});
          else { if (side(b[to]) === foe) add(to, {}); break; }
          rr += dr; cc += dc;
        }
      }
    }
  }
  return out;
}
function make(s, m) {
  const b = s.b.slice(), p = b[m.from];
  b[m.to] = m.promo ? (s.turn === "w" ? "Q" : "q") : p;
  b[m.from] = ".";
  if (m.ep) b[m.to + (s.turn === "w" ? 8 : -8)] = ".";
  if (m.castle !== undefined) { const rt = m.to > m.from ? m.to - 1 : m.to + 1; b[rt] = b[m.castle]; b[m.castle] = "."; }
  let cr = s.cr;
  if (p === "K") cr = cr.replace(/[KQ]/g, "");
  if (p === "k") cr = cr.replace(/[kq]/g, "");
  for (const [sq, f] of [[63, "K"], [56, "Q"], [7, "k"], [0, "q"]]) if (m.from === sq || m.to === sq) cr = cr.replace(f, "");
  return { b, turn: s.turn === "w" ? "b" : "w", cr, ep: m.double ? (m.from + m.to) / 2 : -1, ply: s.ply + 1 };
}
const kingSafe = (n, mover) => !attacked(n.b, n.b.indexOf(mover === "w" ? "K" : "k"), n.turn);
const legal = (s) => pseudo(s).filter((m) => kingSafe(make(s, m), s.turn));
const inCheck = (s) => attacked(s.b, s.b.indexOf(s.turn === "w" ? "K" : "k"), s.turn === "w" ? "b" : "w");
function evalBoard(b) {
  let v = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (p === ".") continue;
    const t = p.toLowerCase(), white = p !== t, r = i >> 3, c = i & 7;
    const center = 7 - Math.abs(3.5 - c) - Math.abs(3.5 - r);
    let x = PV[t];
    if (t === "n" || t === "b") x += center * 5;
    else if (t === "p") x += (white ? 6 - r : r - 1) * 8 + (c >= 2 && c <= 5 ? 4 : 0);
    else if (t === "q") x += center * 2;
    v += white ? x : -x;
  }
  return v;
}
const order = (ms, b) => ms.sort((x, y) => (b[y.to] === "." ? 0 : PV[b[y.to].toLowerCase()]) - (b[x.to] === "." ? 0 : PV[b[x.to].toLowerCase()]));
function quiet(s, a, bt, qd) {
  const stand = (s.turn === "w" ? 1 : -1) * evalBoard(s.b);
  if (stand >= bt || qd === 0) return stand;
  if (stand > a) a = stand;
  for (const m of order(pseudo(s).filter((m) => s.b[m.to] !== "."), s.b)) {
    const n = make(s, m);
    if (!kingSafe(n, s.turn)) continue;
    const v = -quiet(n, -bt, -a, qd - 1);
    if (v >= bt) return v;
    if (v > a) a = v;
  }
  return a;
}
function negamax(s, depth, a, bt) {
  if (depth === 0) return quiet(s, a, bt, 3);
  const ms = legal(s);
  if (!ms.length) return inCheck(s) ? -100000 - depth : 0;
  let best = -Infinity;
  for (const m of order(ms, s.b)) {
    const v = -negamax(make(s, m), depth - 1, -bt, -a);
    if (v > best) best = v;
    if (v > a) a = v;
    if (a >= bt) break;
  }
  return best;
}
const LEVELS = { 1: { depth: 1, noise: 90, name: "Easy" }, 2: { depth: 2, noise: 25, name: "Medium" }, 3: { depth: 3, noise: 0, name: "Hard" } };
function herMove(s, level) {
  const L = LEVELS[level];
  let best = null, bestV = -Infinity;
  for (const m of order(legal(s), s.b)) {
    const v = -negamax(make(s, m), L.depth - 1, -Infinity, Infinity) + (Math.random() - 0.5) * 2 * L.noise;
    if (v > bestV) { bestV = v; best = m; }
  }
  return best;
}
const sqName = (i) => "abcdefgh"[i & 7] + (8 - (i >> 3));

function chess() {
  const level = Number(localStorage.getItem("gn_chess_level") || 1);
  stage.innerHTML = `
    <div class="gn-card chess-wrap">
      <div class="chess-side">
        <h2>Chess vs Vermeil</h2>
        <label>Difficulty <select id="chLevel">${[1, 2, 3].map((l) => `<option value="${l}"${l === level ? " selected" : ""}>${LEVELS[l].name}</option>`).join("")}</select></label>
        <p class="muted">You are white. Click a piece, then where it goes.</p>
        <div class="taken" id="chTaken"></div>
        <ol class="moves" id="chMoves"></ol>
        <div class="row"><button class="btn primary" id="chNew" type="button">New game</button><button class="btn ghost" id="chResign" type="button">Resign</button></div>
      </div>
      <div class="chess-board" id="chBoard"></div>
    </div>`;
  let s, sel = null, targets = [], last = null, over = false, busy = false, moves = [], taken = { w: [], b: [] };
  const lvl = () => Number($("chLevel").value);
  $("chLevel").onchange = () => { localStorage.setItem("gn_chess_level", $("chLevel").value); reset(); };
  $("chNew").onclick = reset;
  $("chResign").onclick = () => { if (!over) { over = true; finish("loss", `chess ${LEVELS[lvl()].name} (resigned)`); paint(); } };
  function reset() {
    s = { b: "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR".split(""), turn: "w", cr: "KQkq", ep: -1, ply: 0 };
    sel = null; targets = []; last = null; over = false; busy = false; moves = []; taken = { w: [], b: [] };
    startSession("chess");
    say(LINES.chess_start[lvl()]);
    paint();
  }
  function paint() {
    const check = !over && inCheck(s) ? s.b.indexOf(s.turn === "w" ? "K" : "k") : -1;
    $("chBoard").innerHTML = s.b.map((p, i) => {
      const dark = ((i >> 3) + (i & 7)) % 2 === 1;
      const cls = ["sq", dark ? "d" : "l", i === sel ? "sel" : "", targets.some((m) => m.to === i) ? (p === "." ? "dot" : "hit") : "",
        last && (i === last.from || i === last.to) ? "last" : "", i === check ? "check" : ""].join(" ");
      return `<button type="button" class="${cls}" data-i="${i}" aria-label="${sqName(i)}">${p === "." ? "" : `<span class="pc ${side(p)}">${GL[p.toLowerCase()]}</span>`}</button>`;
    }).join("");
    $("chTaken").innerHTML = `<span>You took: ${taken.w.map((p) => GL[p]).join(" ") || "—"}</span><span>She took: ${taken.b.map((p) => GL[p]).join(" ") || "—"}</span>`;
    $("chMoves").innerHTML = moves.reduce((a, m, i) => (i % 2 ? a.slice(0, -5) + ` &nbsp; ${m}</li>` : a + `<li>${m}</li>`), "");
    $("chMoves").scrollTop = 1e6;
  }
  function play(m) {
    const cap = s.b[m.to] !== "." ? s.b[m.to].toLowerCase() : m.ep ? "p" : null;
    if (cap) taken[s.turn].push(cap);
    moves.push(`${GL[s.b[m.from].toLowerCase()]}${sqName(m.to)}`);
    const mover = s.turn;
    s = make(s, m);
    last = m;
    const ms = legal(s);
    if (!ms.length) {
      over = true;
      if (inCheck(s)) finish(mover === "w" ? "win" : "loss", `chess ${LEVELS[lvl()].name}`);
      else finish("draw", "chess (stalemate)");
    } else if (s.b.filter((p) => p !== ".").length === 2 || s.ply >= 300) {
      over = true; finish("draw", "chess");
    } else if (inCheck(s)) say(mover === "w" ? "chess_in_check" : "chess_check");
    else if (cap && Math.random() < 0.6) say(mover === "w" ? "chess_you_take" : "chess_she_takes");
    return cap;
  }
  $("chBoard").onclick = async (e) => {
    const b = e.target.closest(".sq");
    if (!b || over || busy || s.turn !== "w") return;
    const i = Number(b.dataset.i), m = targets.find((t) => t.to === i);
    if (m) {
      sel = null; targets = [];
      play(m); paint();
      if (over) return;
      busy = true;
      if (Math.random() < 0.25) say("think");
      await wait(350);
      const reply = herMove(s, lvl());
      if (reply) play(reply);
      busy = false; paint();
      return;
    }
    if (side(s.b[i]) === "w") { sel = i; targets = legal(s).filter((t) => t.from === i); }
    else { sel = null; targets = []; }
    paint();
  };
  reset();
  stopTab = () => endSession();
}

// ================================================================= Cards: Color Clash (Uno-style) and Go Fish
function cards(which) {
  stage.innerHTML = `
    <div class="gn-card">
      <div class="row"><h2>Cards</h2>
        <button class="btn small" id="cdUno" type="button">🃏 Color Clash (Uno-style)</button>
        <button class="btn small" id="cdFish" type="button">🐟 Go Fish</button></div>
      <div id="cdTable" class="table"></div>
    </div>`;
  $("cdUno").onclick = () => uno();
  $("cdFish").onclick = () => goFish();
  (which === "gofish" ? goFish : uno)();
}

const COLORS = { r: "Red", g: "Green", b: "Blue", y: "Yellow" };
function uno() {
  startSession("uno");
  let id = 0;
  const deck = [];
  for (const c of "rgby") {
    deck.push({ c, v: "0", id: id++ });
    for (const v of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "rev", "+2"]) deck.push({ c, v, id: id++ }, { c, v, id: id++ });
  }
  for (let k = 0; k < 4; k++) deck.push({ c: "w", v: "wild", id: id++ }, { c: "w", v: "+4", id: id++ });
  shuffle(deck);
  const you = deck.splice(0, 7), her = deck.splice(0, 7), pile = [];
  let top = deck.findIndex((x) => x.c !== "w" && /^\d$/.test(x.v));
  pile.push(deck.splice(top, 1)[0]);
  let color = pile[0].c, turn = "you", drew = false, unoCalled = false, over = false, choosing = null;
  const T = $("cdTable");
  const label = (x) => ({ skip: "⦸", rev: "⇄", "+2": "+2", wild: "★", "+4": "+4" }[x.v] ?? x.v);
  const cardHtml = (x, extra = "") => `<button type="button" class="uc ${x.c}${extra}" data-id="${x.id}">${label(x)}</button>`;
  const ok = (x) => x.c === "w" || x.c === color || x.v === pile[pile.length - 1].v;
  const draw = (hand, n) => {
    for (let k = 0; k < n; k++) {
      if (!deck.length) { const keepTop = pile.pop(); deck.push(...shuffle(pile.splice(0))); pile.push(keepTop); }
      if (deck.length) hand.push(deck.pop());
    }
  };
  function paint(msg = "") {
    const t = pile[pile.length - 1];
    T.innerHTML = `
      <div class="her-hand">${her.map(() => `<span class="uc back"></span>`).join("")}<small>${her.length} card${her.length === 1 ? "" : "s"}</small></div>
      <div class="mid">
        <button type="button" class="uc back pile" id="unoDraw" title="Draw a card">Draw</button>
        ${cardHtml(t, " top")}
        <span class="now-color ${color}">${COLORS[color]}</span>
        <span class="msg">${esc(msg || (over ? "" : turn === "you" ? "Your turn" : "Vermeil's turn…"))}</span>
      </div>
      ${choosing ? `<div class="pick-color">Pick a colour: ${Object.entries(COLORS).map(([k, n]) => `<button type="button" class="uc ${k}" data-color="${k}">${n}</button>`).join("")}</div>` : ""}
      <div class="my-hand">${you.map((x) => cardHtml(x, turn === "you" && !over && ok(x) ? " ok" : "")).join("")}</div>
      <div class="row">
        <button class="btn${you.length === 2 ? " primary" : ""}" id="unoCall" type="button"${unoCalled ? " disabled" : ""}>Uno!</button>
        ${drew && turn === "you" ? `<button class="btn" id="unoPass" type="button">Keep it and pass</button>` : ""}
        ${over ? `<button class="btn primary" id="unoAgain" type="button">Play again</button>` : ""}
      </div>`;
  }
  function effect(x, by) {
    const other = by === "you" ? her : you;
    if (x.v === "+2") draw(other, 2);
    if (x.v === "+4") draw(other, 4);
    return ["skip", "rev", "+2", "+4"].includes(x.v);          // two players: these all mean "go again"
  }
  function done(by) {
    if (by === "you" ? you.length : her.length) return false;
    over = true;
    finish(by === "you" ? "win" : "loss", "Color Clash");
    paint(by === "you" ? "You won! 🎉" : "Vermeil won!");
    return true;
  }
  async function herTurn() {
    turn = "her"; paint();
    while (!over) {
      await wait(800);
      let opts = her.filter(ok);
      if (!opts.length) { draw(her, 1); opts = her.filter(ok); paint("She draws a card."); await wait(500); }
      if (!opts.length) break;
      const actionFirst = you.length <= 2;
      opts.sort((a, b) => (actionFirst ? ["skip", "rev", "+2", "+4"].includes(b.v) - ["skip", "rev", "+2", "+4"].includes(a.v) : 0) || (a.c === "w") - (b.c === "w"));
      const x = opts[0];
      her.splice(her.indexOf(x), 1);
      pile.push(x);
      if (x.c === "w") {
        const counts = { r: 0, g: 0, b: 0, y: 0 };
        for (const h of her) if (h.c !== "w") counts[h.c]++;
        color = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      } else color = x.c;
      if (her.length === 1) say("uno_her");
      const again = effect(x, "her");
      if (done("her")) return;
      paint(again ? `She played ${label(x)} — she goes again.` : "");
      if (!again) break;
    }
    if (!over) { turn = "you"; drew = false; paint(); }
  }
  function youPlay(x) {
    you.splice(you.indexOf(x), 1);
    pile.push(x);
    if (x.c !== "w") color = x.c;
    let forgot = false;
    if (you.length === 1 && !unoCalled) { forgot = true; draw(you, 2); say("uno_forgot"); }
    unoCalled = false;
    const again = effect(x, "you");
    if (done("you")) return;
    drew = false;
    if (again) { paint(forgot ? "Draw two for forgetting Uno! Your turn again." : "Your turn again!"); return; }
    herTurn();
  }
  T.onclick = (e) => {
    if (e.target.id === "unoAgain") return uno();
    if (over) return;
    if (e.target.id === "unoCall") { unoCalled = true; say("Uno? Okay, I heard you~"); paint(); return; }
    if (turn !== "you") return;
    const pc = e.target.closest("[data-color]");
    if (pc && choosing) { color = pc.dataset.color; const x = choosing; choosing = null; youPlay(x); return; }
    if (e.target.id === "unoDraw" && !drew) { draw(you, 1); drew = true; paint(ok(you[you.length - 1]) ? "You can play the card you drew." : "No luck — pass."); return; }
    if (e.target.id === "unoPass") { drew = false; herTurn(); return; }
    const b = e.target.closest(".my-hand .uc");
    if (!b) return;
    const x = you.find((y) => y.id === Number(b.dataset.id));
    if (!x || !ok(x)) { paint("That card doesn't match."); return; }
    if (drew && x !== you[you.length - 1]) { paint("After drawing you can only play the card you drew."); return; }
    if (x.c === "w") { choosing = x; paint("Pick a colour."); return; }
    youPlay(x);
  };
  paint();
  say("Color Clash! Match the colour or the number.");
  stopTab = () => endSession();
}

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
function goFish() {
  startSession("gofish");
  const deck = shuffle(RANKS.flatMap((r) => ["♠", "♥", "♦", "♣"].map((s) => ({ r, s }))));
  const hand = { you: deck.splice(0, 7), her: deck.splice(0, 7) }, books = { you: [], her: [] };
  const asked = new Set();                      // ranks you asked for: she remembers them
  let turn = "you", over = false, log = [];
  const T = $("cdTable");
  const note = (t) => { log = [t, ...log].slice(0, 6); };
  function makeBooks(who) {
    for (const r of RANKS) {
      if (hand[who].filter((c) => c.r === r).length === 4) {
        hand[who] = hand[who].filter((c) => c.r !== r); books[who].push(r);
        note(`${who === "you" ? "You" : "Vermeil"} made a book of ${r}s!`);
      }
    }
  }
  const refill = (who) => { if (!hand[who].length && deck.length) hand[who].push(deck.pop()); };
  function end() {
    if (books.you.length + books.her.length < 13) return false;
    over = true;
    const r = books.you.length > books.her.length ? "win" : books.you.length < books.her.length ? "loss" : "draw";
    finish(r, "Go Fish");
    return true;
  }
  function paint() {
    const groups = RANKS.filter((r) => hand.you.some((c) => c.r === r));
    T.innerHTML = `
      <div class="her-hand">${hand.her.map(() => `<span class="pc-card back"></span>`).join("")}<small>Vermeil: ${hand.her.length} cards · books ${books.her.join(" ") || "—"}</small></div>
      <div class="mid"><span class="pc-card back pile">${deck.length}</span><div class="fish-log">${log.map((l) => `<p>${esc(l)}</p>`).join("")}</div></div>
      <p class="muted">${over ? "" : turn === "you" ? "Click a rank to ask Vermeil for it." : "Vermeil is asking…"}</p>
      <div class="my-hand">${groups.map((r) => `<button type="button" class="fish-group" data-r="${r}">${hand.you.filter((c) => c.r === r).map((c) => `<span class="pc-card ${"♥♦".includes(c.s) ? "red" : ""}">${r}${c.s}</span>`).join("")}</button>`).join("")}</div>
      <p>Your books: ${books.you.join(" ") || "—"}</p>
      ${over ? `<button class="btn primary" id="fishAgain" type="button">Play again</button>` : ""}`;
  }
  function ask(who, r) {
    const other = who === "you" ? "her" : "you";
    const got = hand[other].filter((c) => c.r === r);
    if (got.length) {
      hand[other] = hand[other].filter((c) => c.r !== r);
      hand[who].push(...got);
      note(who === "you" ? `Vermeil gave you ${got.length} × ${r}.` : `Vermeil asked for ${r}s — you gave ${got.length}.`);
      makeBooks(who); refill(who); refill(other);
      return true;
    }
    note(who === "you" ? `You asked for ${r}s. "Go fish!"` : `Vermeil asked for ${r}s. Go fish!`);
    if (who === "you") say("fish");
    if (!deck.length) return false;
    const c = deck.pop();
    hand[who].push(c);
    makeBooks(who); refill(who);
    if (c.r === r) { note(`${who === "you" ? "You" : "She"} fished a ${r}! Go again.`); return true; }
    return false;
  }
  async function herTurn() {
    turn = "her"; paint();
    while (!over) {
      await wait(900);
      refill("her");
      if (!hand.her.length) break;
      const mine = [...new Set(hand.her.map((c) => c.r))];
      const r = mine.find((x) => asked.has(x)) || pick(mine);
      const again = ask("her", r);
      if (r && !again) asked.delete(r);
      if (end()) break;
      paint();
      if (!again) break;
    }
    turn = "you"; refill("you");
    if (!hand.you.length && !deck.length && !over) return herTurn();
    paint();
  }
  T.onclick = (e) => {
    if (e.target.id === "fishAgain") return goFish();
    const g = e.target.closest(".fish-group");
    if (!g || over || turn !== "you") return;
    asked.add(g.dataset.r);
    const again = ask("you", g.dataset.r);
    if (end()) return paint();
    refill("you");
    if (again && hand.you.length) paint(); else herTurn();
  };
  makeBooks("you"); makeBooks("her");
  paint();
  say("Go Fish! Ask me for cards you already have.");
  stopTab = () => endSession();
}

// ================================================================= Trivia night
async function trivia() {
  const chosen = new Set(JSON.parse(localStorage.getItem("gn_trivia_cats") || '["General","Science","Geography"]'));
  stage.innerHTML = `<div class="gn-card"><h2>Trivia night</h2><p class="muted">Pick categories. We both answer — whoever knows more wins.</p>
    <div class="chips" id="tvCats"></div>
    <div class="row"><label>Questions <select id="tvN"><option>5</option><option selected>10</option><option>15</option></select></label>
    <button class="btn primary" id="tvGo" type="button">Start</button></div><div id="tvBox"></div></div>`;
  const cats = ["General", "Science", "History", "Geography", "Movies & TV", "Music", "Games", "Anime", "Sports", "Food", "Animals", "Language"];
  const paintCats = () => { $("tvCats").innerHTML = cats.map((c) => `<button type="button" class="chip${chosen.has(c) ? " on" : ""}">${esc(c)}</button>`).join(""); };
  paintCats();
  $("tvCats").onclick = (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    chosen.has(b.textContent) ? chosen.delete(b.textContent) : chosen.add(b.textContent);
    localStorage.setItem("gn_trivia_cats", JSON.stringify([...chosen])); paintCats();
  };
  $("tvGo").onclick = async () => {
    $("tvBox").innerHTML = `<p class="muted">Vermeil is writing the questions…</p>`;
    $("tvGo").disabled = true;
    const r = await call("gn_trivia", [...chosen], Number($("tvN").value));
    if (!$("tvGo")) return;
    $("tvGo").disabled = false;
    if (r.error) { $("tvBox").innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
    startSession("trivia");
    let i = 0, you = 0, her = 0;
    const Q = r.questions;
    const show = () => {
      if (!$("tvBox")) return;                                   // you left the tab mid-round
      if (i >= Q.length) {
        const res = you > her ? "win" : you < her ? "loss" : "draw";
        $("tvBox").innerHTML = `<div class="result"><h3>You ${you} – ${her} Vermeil</h3><button class="btn primary" id="tvAgain" type="button">Another round</button></div>`;
        $("tvAgain").onclick = () => $("tvGo").click();
        finish(res, `trivia ${you}-${her}`);
        return;
      }
      const q = Q[i];
      $("tvBox").innerHTML = `<div class="tv-q"><small>${esc(q.category)} · ${i + 1}/${Q.length} · You ${you} – ${her} Vermeil</small>
        <h3>${esc(q.question)}</h3><div class="tv-choices">${q.choices.map((c, k) => `<button type="button" class="btn" data-k="${k}">${esc(c)}</button>`).join("")}</div><p id="tvFact" class="muted"></p></div>`;
      $("tvBox").querySelector(".tv-choices").onclick = async (e) => {
        const b = e.target.closest("[data-k]");
        if (!b || b.disabled) return;
        const k = Number(b.dataset.k), herK = Math.random() < 0.62 ? q.answer : pick([0, 1, 2, 3].filter((x) => x !== q.answer));
        const youRight = k === q.answer, herRight = herK === q.answer;
        you += youRight; her += herRight;
        for (const btn of $("tvBox").querySelectorAll("[data-k]")) {
          btn.disabled = true;
          const bk = Number(btn.dataset.k);
          btn.classList.toggle("right", bk === q.answer);
          btn.classList.toggle("wrong", bk === k && !youRight);
          if (bk === herK) btn.insertAdjacentHTML("beforeend", " <span class='her-pick'>💜</span>");
        }
        say(youRight && herRight ? "trivia_right_both" : youRight ? "trivia_you_only" : herRight ? "trivia_her_only" : "trivia_neither");
        $("tvFact").textContent = q.fact || "";
        await wait(q.fact ? 2600 : 1600);
        i++; show();
      };
    };
    show();
  };
  stopTab = () => endSession();
}

// ================================================================= Word games
async function words(which) {
  const lang = localStorage.getItem("gn_lang") || "en";
  stage.innerHTML = `<div class="gn-card"><div class="row"><h2>Word games</h2>
    <button class="btn small" id="wdWordle" type="button">🟩 Five letters</button><button class="btn small" id="wdHang" type="button">🪢 Hangman</button>
    <label>Language <select id="wdLang"></select></label></div><p class="muted" id="wdNote"></p><div id="wdBox"><p class="muted">Loading words…</p></div></div>`;
  let data = await call("gn_words", lang);
  if (!$("wdBox")) return;
  if (data.error) { $("wdBox").innerHTML = `<p class="err">${esc(data.error)}</p>`; return; }
  $("wdLang").innerHTML = Object.entries(data.langs).map(([k, n]) => `<option value="${k}"${k === lang ? " selected" : ""}>${esc(n)}</option>`).join("");
  $("wdNote").textContent = data.note || "";
  $("wdLang").onchange = () => { localStorage.setItem("gn_lang", $("wdLang").value); words(which); };
  $("wdWordle").onclick = () => wordle(data);
  $("wdHang").onclick = () => hangman(data);
  (which === "hangman" ? hangman : wordle)(data);
  stopTab = () => endSession();
}
function wordle(data) {
  startSession("wordle");
  const target = pick(data.five).toLowerCase();
  const rows = [];
  let cur = "", over = false;
  const box = $("wdBox");
  const score = (g) => {
    const res = Array(5).fill("no"), left = target.split("");
    for (let k = 0; k < 5; k++) if (g[k] === target[k]) { res[k] = "yes"; left[k] = null; }
    for (let k = 0; k < 5; k++) if (res[k] !== "yes") { const j = left.indexOf(g[k]); if (j >= 0) { res[k] = "near"; left[j] = null; } }
    return res;
  };
  const keyState = {};
  function paint(msg = "") {
    const all = [...rows.map((r) => ({ g: r.g, s: r.s })), ...(over ? [] : [{ g: cur.padEnd(5), s: null }])];
    while (all.length < 6) all.push({ g: "     ", s: null });
    box.innerHTML = `<div class="wd-grid">${all.slice(0, 6).map((r) => `<div class="wd-row">${[...r.g].map((ch, k) => `<span class="wd-cell ${r.s ? r.s[k] : ""}">${esc(ch.trim())}</span>`).join("")}</div>`).join("")}</div>
      <p class="msg">${esc(msg)}</p>
      <div class="kb">${["qwertyuiop", "asdfghjkl", "↵zxcvbnm⌫"].map((row) => `<div>${[...row].map((k) => `<button type="button" data-k="${k}" class="${keyState[k] || ""}">${k}</button>`).join("")}</div>`).join("")}</div>
      ${over ? `<button class="btn primary" id="wdAgain" type="button">New word</button>` : ""}`;
  }
  function key(k) {
    if (over) return;
    if (k === "⌫" || k === "Backspace") cur = cur.slice(0, -1);
    else if (k === "↵" || k === "Enter") {
      if (cur.length < 5) return paint("Five letters, please.");
      const s = score(cur);
      rows.push({ g: cur, s });
      [...cur].forEach((ch, k2) => { const rank = { yes: 3, near: 2, no: 1 }; if ((rank[s[k2]] || 0) > (rank[keyState[ch]] || 0)) keyState[ch] = s[k2]; });
      const won = cur === target;
      cur = "";
      if (won || rows.length === 6) {
        over = true;
        say(won ? "word_win" : "word_lose");
        endSession(won ? "win" : "loss", "five letters");
        return paint(won ? `Got it in ${rows.length}!` : `It was "${target.toUpperCase()}".`);
      }
    } else if (/^[a-z]$/i.test(k) && cur.length < 5) cur += k.toLowerCase();
    paint();
  }
  box.onclick = (e) => {
    if (e.target.id === "wdAgain") return wordle(data);
    const b = e.target.closest("[data-k]"); if (b) key(b.dataset.k);
  };
  keyHandler = (e) => { if (e.ctrlKey || e.metaKey || e.altKey) return; if (/^[a-zA-Z]$/.test(e.key) || e.key === "Enter" || e.key === "Backspace") { e.preventDefault(); key(e.key); } };
  paint();
  say("Guess my five-letter word! Green = right spot, yellow = in the word.");
}
function hangman(data) {
  startSession("hangman");
  const { word, hint } = pick(data.hangman);
  const W = word.toLowerCase(), guessed = new Set();
  let wrong = 0, over = false, showHint = false;
  const box = $("wdBox");
  const parts = ['<line x1="10" y1="140" x2="90" y2="140"/>', '<line x1="30" y1="140" x2="30" y2="10"/><line x1="30" y1="10" x2="80" y2="10"/><line x1="80" y1="10" x2="80" y2="25"/>',
    '<circle cx="80" cy="37" r="12"/>', '<line x1="80" y1="49" x2="80" y2="90"/>', '<line x1="80" y1="60" x2="65" y2="75"/><line x1="80" y1="60" x2="95" y2="75"/>',
    '<line x1="80" y1="90" x2="68" y2="115"/>', '<line x1="80" y1="90" x2="92" y2="115"/>'];
  function paint(msg = "") {
    box.innerHTML = `<div class="hang"><svg viewBox="0 0 110 150" class="hang-pic">${parts.slice(0, wrong).join("")}</svg>
      <div><p class="hang-word">${[...W].map((ch) => (guessed.has(ch) || over ? ch : "_")).join(" ")}</p>
      <p class="muted">${showHint ? `Hint: ${esc(hint)}` : `<button class="btn small" id="hgHint" type="button">Show a hint</button>`} · ${7 - wrong} misses left</p>
      <div class="kb">${[..."abcdefghijklmnopqrstuvwxyz"].map((k) => `<button type="button" data-k="${k}" ${guessed.has(k) ? `disabled class="${W.includes(k) ? "yes" : "no"}"` : ""}>${k}</button>`).join("")}</div>
      <p class="msg">${esc(msg)}</p>${over ? `<button class="btn primary" id="hgAgain" type="button">New word</button>` : ""}</div></div>`;
  }
  function key(k) {
    if (over || guessed.has(k)) return;
    guessed.add(k);
    if (!W.includes(k)) wrong++;
    const won = [...W].every((ch) => guessed.has(ch));
    if (won || wrong >= 7) {
      over = true; say(won ? "word_win" : "word_lose");
      endSession(won ? "win" : "loss", "hangman");
      return paint(won ? "You saved him! 🎉" : `The word was "${W}".`);
    }
    paint();
  }
  box.onclick = (e) => {
    if (e.target.id === "hgAgain") return hangman(data);
    if (e.target.id === "hgHint") { showHint = true; return paint(); }
    const b = e.target.closest("[data-k]"); if (b) key(b.dataset.k);
  };
  keyHandler = (e) => { if (/^[a-zA-Z]$/.test(e.key) && !e.ctrlKey) key(e.key.toLowerCase()); };
  paint();
  say("Hangman! Guess the letters before he's drawn.");
}

// ================================================================= Draw & guess
function draw() {
  stage.innerHTML = `<div class="gn-card"><div class="row"><h2>Draw & guess</h2>
    <button class="btn small" id="dwYou" type="button">✏️ You draw, she guesses</button><button class="btn small" id="dwHer" type="button">👀 She draws, you guess</button></div>
    <div id="dwBox"></div></div>`;
  $("dwYou").onclick = youDraw;
  $("dwHer").onclick = herDraw;
  youDraw();
  stopTab = () => endSession();
}
async function youDraw() {
  startSession("draw");
  const p = await call("gn_draw_prompt");
  const word = p.word || "cat";
  $("dwBox").innerHTML = `<p>Draw: <b class="secret">${esc(word)}</b> <span class="muted">(she can't see this)</span></p>
    <div class="draw-row"><canvas id="dwCan" width="420" height="420" class="canvas"></canvas>
    <div class="draw-tools">${["#111111", "#e5484d", "#3e8eff", "#30a46c", "#f5a524", "#8e4ec6"].map((c, k) => `<button type="button" class="swatch${k === 0 ? " on" : ""}" data-c="${c}" style="background:${c}" aria-label="colour"></button>`).join("")}
    <label>Size <input type="range" id="dwSize" min="2" max="24" value="6"></label>
    <button class="btn" id="dwClear" type="button">Clear</button><button class="btn primary" id="dwDone" type="button">Done — guess!</button>
    <div id="dwGuess" class="guess"></div><button class="btn ghost" id="dwNext" type="button">Next word</button></div></div>`;
  const cv = $("dwCan"), ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  let color = "#111111", drawing = false, lastPt = null;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = (e) => { drawing = true; lastPt = pt(e); cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => {
    if (!drawing) return;
    const q = pt(e);
    ctx.strokeStyle = color; ctx.lineWidth = Number($("dwSize").value); ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(...lastPt); ctx.lineTo(...q); ctx.stroke();
    lastPt = q;
  };
  cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
  $("dwBox").querySelector(".draw-tools").onclick = (e) => {
    const s = e.target.closest(".swatch");
    if (s) { color = s.dataset.c; for (const x of $("dwBox").querySelectorAll(".swatch")) x.classList.toggle("on", x === s); }
  };
  $("dwClear").onclick = () => { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); };
  $("dwNext").onclick = youDraw;
  $("dwDone").onclick = async () => {
    $("dwDone").disabled = true;
    $("dwGuess").innerHTML = `<p class="muted">She's looking at it…</p>`;
    const r = await call("gn_guess_drawing", cv.toDataURL("image/jpeg", 0.8), word);
    if (!$("dwDone")) return;
    $("dwDone").disabled = false;
    if (r.error) { $("dwGuess").innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
    $("dwGuess").innerHTML = `<p>She guesses: <b>${r.guesses.map(esc).join("</b>, <b>") || "?"}</b></p><p class="muted">${esc(r.comment)}</p>`;
    say(r.right ? "draw_good" : "draw_bad");
    endSession(r.right ? "win" : "loss", `drew ${word}`);
  };
}
async function herDraw() {
  startSession("draw");
  const d = await call("gn_doodle", []);
  if (d.error) { $("dwBox").innerHTML = `<p class="err">${esc(d.error)}</p>`; return; }
  $("dwBox").innerHTML = `<div class="draw-row"><canvas id="dwCan" width="420" height="420" class="canvas"></canvas>
    <div class="draw-tools"><p>What is she drawing? <span class="muted">(${d.letters} letters)</span></p>
    <input id="dwIn" class="input" placeholder="Your guess" autocomplete="off"><button class="btn primary" id="dwTry" type="button">Guess</button>
    <button class="btn ghost" id="dwGive" type="button">I give up</button><div id="dwGuess" class="guess"></div>
    <button class="btn ghost" id="dwNext" type="button">Another</button></div></div>`;
  const cv = $("dwCan"), ctx = cv.getContext("2d"), k = cv.width / 100;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.strokeStyle = "#222"; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  let over = false, tries = 0;
  (async () => {
    for (const stroke of d.strokes) {
      for (let j = 1; j < stroke.length && !over; j++) {
        ctx.beginPath(); ctx.moveTo(stroke[j - 1][0] * k, stroke[j - 1][1] * k); ctx.lineTo(stroke[j][0] * k, stroke[j][1] * k); ctx.stroke();
        await wait(120);
      }
      if (over) return;
      await wait(350);
    }
  })();
  const end = (won) => {
    over = true;
    $("dwGuess").innerHTML = `<p>${won ? "Yes! It's" : "It was"} <b>${esc(d.id)}</b>.</p>`;
    say(won ? "word_win" : ["Aww, it was a " + d.id + "!"]);
    endSession(won ? "win" : "loss", `guessed ${d.id}`);
  };
  $("dwTry").onclick = async () => {
    if (over || !$("dwIn").value.trim()) return;
    const r = await call("gn_doodle_check", d.id, $("dwIn").value);
    tries++;
    if (r.right) end(true);
    else { $("dwGuess").innerHTML = `<p class="muted">Nope! (${tries} tr${tries === 1 ? "y" : "ies"})</p>`; $("dwIn").select(); }
  };
  $("dwIn").onkeydown = (e) => { if (e.key === "Enter") $("dwTry").click(); };
  $("dwGive").onclick = () => { if (!over) end(false); };
  $("dwNext").onclick = herDraw;
  $("dwIn").focus();
  say("Watch me draw… guess as early as you can!");
}

// ================================================================= Puzzle of the day
function puzzles(which) {
  stage.innerHTML = `<div class="gn-card"><div class="row"><h2>Puzzle of the day</h2>
    <button class="btn small" id="pzSud" type="button">🔢 Sudoku</button><button class="btn small" id="pzNono" type="button">🧩 Nonogram</button></div>
    <p class="muted" id="pzInfo"></p><div id="pzBox"></div></div>`;
  $("pzSud").onclick = sudoku;
  $("pzNono").onclick = nonogram;
  (which === "nonogram" ? nonogram : sudoku)();
  say("puzzle");
  stopTab = () => endSession();
}
const streakText = (p) => `${p.day} · streak ${p.streak} day${p.streak === 1 ? "" : "s"} (best ${p.best})${p.done_today ? " · ✅ solved today" : ""}`;
async function sudoku() {
  const p = await call("gn_puzzle", "sudoku");
  if (p.error) { $("pzBox").innerHTML = `<p class="err">${esc(p.error)}</p>`; return; }
  startSession("sudoku");
  $("pzInfo").textContent = streakText(p);
  const key = `gn_sud_${p.day}`;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* ignore */ }
  $("pzBox").innerHTML = `<div class="sudoku">${p.grid.map((v, i) => v
    ? `<span class="sd fixed">${v}</span>`
    : `<input class="sd" data-i="${i}" inputmode="numeric" maxlength="1" value="${saved?.[i] || ""}" aria-label="row ${(i / 9 | 0) + 1} column ${i % 9 + 1}">`).join("")}</div>
    <div class="row"><button class="btn primary" id="sdCheck" type="button">Check</button><span class="msg" id="sdMsg"></span></div>`;
  const grid = () => p.grid.map((v, i) => v || Number($("pzBox").querySelector(`[data-i="${i}"]`)?.value || 0));
  $("pzBox").querySelector(".sudoku").oninput = (e) => {
    e.target.value = e.target.value.replace(/[^1-9]/g, "");
    e.target.classList.remove("bad");
    try { localStorage.setItem(key, JSON.stringify(grid().map((v, i) => (p.grid[i] ? 0 : v)))); } catch { /* ignore */ }
  };
  $("sdCheck").onclick = async () => {
    const r = await call("gn_puzzle_check", "sudoku", grid(), Math.round((Date.now() - (session?.t0 || Date.now())) / 1000));
    for (const i of r.wrong || []) $("pzBox").querySelector(`[data-i="${i}"]`)?.classList.add("bad");
    if (r.solved) { $("sdMsg").textContent = `Solved! Streak: ${r.streak} 🔥`; say("You solved it! See you tomorrow for the next one~"); session = null; }
    else $("sdMsg").textContent = r.wrong?.length ? `${r.wrong.length} wrong (in red).` : "Not finished yet — no mistakes so far!";
  };
}
async function nonogram() {
  const p = await call("gn_puzzle", "nonogram");
  if (p.error) { $("pzBox").innerHTML = `<p class="err">${esc(p.error)}</p>`; return; }
  startSession("nonogram");
  $("pzInfo").textContent = streakText(p) + " · click = fill, right-click = mark ✕";
  const n = p.size, cells = Array.from({ length: n }, () => Array(n).fill(0));
  const box = $("pzBox");
  box.innerHTML = `<div class="nono" style="--n:${n}">
    <span></span>${p.cols.map((c) => `<span class="clue col">${c.join("<br>")}</span>`).join("")}
    ${p.rows.map((r, y) => `<span class="clue row">${r.join(" ")}</span>${Array.from({ length: n }, (_, x) => `<button type="button" class="nc" data-x="${x}" data-y="${y}"></button>`).join("")}`).join("")}
  </div><div class="row"><button class="btn primary" id="nnCheck" type="button">Check</button><button class="btn ghost" id="nnClear" type="button">Clear</button><span class="msg" id="nnMsg"></span></div>`;
  const nono = box.querySelector(".nono");
  const set = (b, v) => { cells[b.dataset.y][b.dataset.x] = v; b.className = `nc${v === 1 ? " on" : v === 2 ? " x" : ""}`; };
  nono.onclick = (e) => { const b = e.target.closest(".nc"); if (b) set(b, cells[b.dataset.y][b.dataset.x] === 1 ? 0 : 1); };
  nono.oncontextmenu = (e) => { const b = e.target.closest(".nc"); if (!b) return; e.preventDefault(); set(b, cells[b.dataset.y][b.dataset.x] === 2 ? 0 : 2); };
  $("nnClear").onclick = () => { for (const b of nono.querySelectorAll(".nc")) set(b, 0); };
  $("nnCheck").onclick = async () => {
    const r = await call("gn_puzzle_check", "nonogram", cells.map((row) => row.map((v) => (v === 1 ? 1 : 0))), Math.round((Date.now() - (session?.t0 || Date.now())) / 1000));
    if (r.solved) { $("nnMsg").textContent = `Solved! Streak: ${r.streak} 🔥`; say("A perfect picture! Same time tomorrow?"); session = null; }
    else $("nnMsg").textContent = "Not yet — some rows or columns don't match their numbers.";
  };
}

// ================================================================= Typing race
async function typing() {
  const diff = localStorage.getItem("gn_type_her") || "45";
  stage.innerHTML = `<div class="gn-card"><div class="row"><h2>Typing race</h2>
    <label>Words from <select id="tpDeck"><option value="">All my cards</option></select></label>
    <label>Vermeil types <select id="tpHer">${[30, 45, 60, 80].map((w) => `<option value="${w}"${String(w) === diff ? " selected" : ""}>${w} WPM</option>`).join("")}</select></label>
    <button class="btn primary" id="tpGo" type="button">New race</button></div>
    <p class="muted" id="tpSrc"></p><div class="tp-words" id="tpWords"></div>
    <input class="input tp-in" id="tpIn" placeholder="Start typing to begin (60 seconds)" autocomplete="off" spellcheck="false">
    <div class="tp-bar"><span id="tpYou">You: 0 WPM</span><div class="race"><i id="tpYouBar"></i><i id="tpHerBar" class="her"></i></div><span id="tpTime">60 s</span></div></div>`;
  let timer = null;
  stopTab = () => { clearInterval(timer); endSession(); };
  const decks = await call("gn_typing", 1);
  for (const dk of decks.decks || []) $("tpDeck").insertAdjacentHTML("beforeend", `<option>${esc(dk)}</option>`);
  $("tpHer").onchange = () => localStorage.setItem("gn_type_her", $("tpHer").value);
  async function race() {
    clearInterval(timer);
    const r = await call("gn_typing", 120, $("tpDeck").value);
    if (r.error) { $("tpSrc").textContent = r.error; return; }
    $("tpSrc").textContent = `Words from ${r.source}.`;
    const W = r.words;
    let i = 0, right = 0, chars = 0, typed = 0, t0 = 0, done = false;
    const her = Number($("tpHer").value);
    $("tpWords").innerHTML = W.map((w, k) => `<span data-k="${k}"${k === 0 ? ' class="cur"' : ""}>${esc(w)}</span>`).join(" ");
    $("tpIn").value = ""; $("tpIn").disabled = false; $("tpIn").focus();
    $("tpYouBar").style.width = $("tpHerBar").style.width = "0%";
    const wpm = () => Math.round(chars / 5 / Math.max(1 / 60, (Date.now() - t0) / 60000));
    const end = () => {
      done = true; clearInterval(timer); $("tpIn").disabled = true;
      const you = Math.round(chars / 5), acc = typed ? Math.round(right / typed * 100) : 0;
      $("tpYou").textContent = `You: ${you} WPM · ${acc}% right`;
      finish(you > her ? "win" : you < her ? "loss" : "draw", `typing ${you} vs ${her} WPM`);
    };
    $("tpIn").oninput = () => {
      if (done) return;
      if (!t0) {
        t0 = Date.now(); startSession("typing"); say("typing");
        timer = setInterval(() => {
          const left = 60 - Math.floor((Date.now() - t0) / 1000);
          $("tpTime").textContent = `${Math.max(0, left)} s`;
          $("tpYou").textContent = `You: ${wpm()} WPM`;
          const goal = Math.max(her, 1) * 5;            // the characters she types in a minute
          $("tpYouBar").style.width = `${Math.min(100, chars / goal * 100)}%`;
          $("tpHerBar").style.width = `${Math.min(100, (Date.now() - t0) / 600)}%`;
          if (left <= 0) end();
        }, 200);
      }
      const v = $("tpIn").value;
      const span = $("tpWords").querySelector(`[data-k="${i}"]`);
      span?.classList.toggle("typo", !W[i].startsWith(v.trimEnd()));
      if (v.endsWith(" ")) {
        const ok = v.trim() === W[i];
        typed++; if (ok) { right++; chars += W[i].length + 1; }
        span.className = ok ? "ok" : "bad";
        i++;
        const nx = $("tpWords").querySelector(`[data-k="${i}"]`);
        if (nx) { nx.className = "cur"; nx.scrollIntoView({ block: "nearest" }); } else end();
        $("tpIn").value = "";
      }
    };
  }
  $("tpGo").onclick = race;
  race();
}

// ================================================================= Rhythm (your songs)
async function rhythm() {
  stage.innerHTML = `<div class="gn-card"><div class="row"><h2>Rhythm</h2>
    <label>Playlist <select id="rmList"><option value="">Loading…</option></select></label>
    <label>Song <select id="rmSong"></select></label></div>
    <div class="row"><label><input type="checkbox" id="rmMusic" checked> Play the song</label><label><input type="checkbox" id="rmClick"> Click track</label>
    <label>Sync <input type="range" id="rmOff" min="-800" max="800" step="50" value="${localStorage.getItem("gn_rm_off") || 0}"></label>
    <button class="btn primary" id="rmGo" type="button">Start</button></div>
    <p class="muted" id="rmInfo">Keys: D F J K (or tap the lanes). Hit the notes on the line.</p>
    <canvas id="rmCan" width="480" height="520" class="canvas rhythm"></canvas></div>`;
  let raf = 0, actx = null;
  stopTab = () => { cancelAnimationFrame(raf); actx?.close?.(); endSession(); };
  const lib = await call("mm", "library");
  const lists = lib.error ? [] : [...(lib.liked ? [{ id: "liked", name: "Liked Songs" }] : []), ...(lib.playlists || [])];
  $("rmList").innerHTML = lists.length ? lists.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("") : `<option value="">(no playlists — just the beat)</option>`;
  let songs = [];
  async function loadSongs() {
    songs = [];
    if ($("rmList").value) { const p = await call("mm", "playlist", $("rmList").value); songs = p.songs || []; }
    $("rmSong").innerHTML = songs.length ? songs.map((s, k) => `<option value="${k}">${esc(s.title)}${s.artist ? ` — ${esc(s.artist)}` : ""}</option>`).join("") : `<option value="">A simple beat (100 BPM)</option>`;
  }
  $("rmList").onchange = loadSongs;
  await loadSongs();
  $("rmOff").onchange = () => localStorage.setItem("gn_rm_off", $("rmOff").value);
  const cv = $("rmCan"), ctx = cv.getContext("2d"), H = cv.height, LW = cv.width / 4, HITY = H - 70, FALL = 1500;
  const LANE_C = ["#e5484d", "#f5a524", "#30a46c", "#3e8eff"], KEYS = ["d", "f", "j", "k"];
  $("rmGo").onclick = async () => {
    cancelAnimationFrame(raf);
    const song = songs[Number($("rmSong").value)] || null;
    let bpm = 100;
    if (song) { $("rmInfo").textContent = "Finding the tempo…"; const r = await call("gn_bpm", song.title, song.artist || ""); bpm = r.bpm || 104; }
    if (song && $("rmMusic").checked) call("mm", "play_songs", [song]);
    $("rmInfo").textContent = `${song ? song.title : "Beat"} · ${bpm} BPM · D F J K`;
    let seed = [...(song?.title || "beat")].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const beat = 60000 / bpm, notes = [];
    for (let t = 3000; t < 63000; t += beat) {
      if (rnd() < 0.18) continue;
      notes.push({ t, lane: Math.floor(rnd() * 4) });
      if (rnd() < 0.22) notes.push({ t: t + beat / 2, lane: Math.floor(rnd() * 4) });
    }
    const off = Number($("rmOff").value);
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const tick = () => { if (!$("rmClick").checked) return; const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 1200; g.gain.value = 0.15; g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.05); o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.06); };
    let score = 0, combo = 0, best = 0, hits = 0, flash = [];
    const t0 = performance.now() + off;
    let nextTick = 3000;
    startSession("rhythm");
    say("Feel the beat~");
    const hit = (lane) => {
      const now = performance.now() - t0;
      const n = notes.find((x) => !x.done && x.lane === lane && Math.abs(x.t - now) < 150);
      if (!n) { combo = 0; return; }
      n.done = true;
      const dt = Math.abs(n.t - now), pts = dt < 50 ? 300 : dt < 100 ? 200 : 100;
      score += pts * (1 + Math.min(combo, 50) / 50); combo++; best = Math.max(best, combo); hits++;
      flash.push({ lane, txt: pts === 300 ? "Perfect" : pts === 200 ? "Great" : "OK", at: now });
    };
    keyHandler = (e) => { const l = KEYS.indexOf(e.key.toLowerCase()); if (l >= 0 && !e.repeat) { e.preventDefault(); hit(l); } };
    cv.onpointerdown = (e) => { const r = cv.getBoundingClientRect(); hit(Math.min(3, Math.floor((e.clientX - r.left) / r.width * 4))); };
    const frame = () => {
      const now = performance.now() - t0;
      if (now >= nextTick) { tick(); nextTick += beat; }
      ctx.fillStyle = "#0c0e12"; ctx.fillRect(0, 0, cv.width, H);
      for (let l = 0; l < 4; l++) {
        ctx.fillStyle = l % 2 ? "#12151b" : "#151922"; ctx.fillRect(l * LW, 0, LW, H);
        ctx.fillStyle = LANE_C[l]; ctx.globalAlpha = 0.35; ctx.fillRect(l * LW + 6, HITY - 4, LW - 12, 8); ctx.globalAlpha = 1;
        ctx.fillStyle = "#8b929d"; ctx.font = "bold 18px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.fillText(KEYS[l].toUpperCase(), l * LW + LW / 2, H - 25);
      }
      for (const n of notes) {
        if (!n.done && now - n.t > 150) { n.done = n.missed = true; combo = 0; }
        if (n.done) continue;
        const y = HITY - (n.t - now) / FALL * HITY;
        if (y < -20) continue;
        ctx.fillStyle = LANE_C[n.lane]; ctx.fillRect(n.lane * LW + 10, y - 10, LW - 20, 20);
      }
      flash = flash.filter((f) => now - f.at < 400);
      for (const f of flash) { ctx.fillStyle = "#fff"; ctx.font = "bold 16px Nunito, sans-serif"; ctx.fillText(f.txt, f.lane * LW + LW / 2, HITY - 30); }
      ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = "bold 16px Nunito, sans-serif";
      ctx.fillText(`Score ${Math.round(score)}   Combo ${combo}`, 12, 24);
      if (now < 3000) { ctx.textAlign = "center"; ctx.font = "bold 48px Nunito, sans-serif"; ctx.fillText(String(Math.ceil((3000 - now) / 1000)), cv.width / 2, H / 2); }
      if (now > notes[notes.length - 1].t + 1000) {
        const acc = Math.round(hits / notes.length * 100), herAcc = 75 + Math.floor(Math.random() * 15);
        $("rmInfo").textContent = `Done! ${acc}% hit, best combo ${best}. Vermeil hit ${herAcc}%.`;
        keyHandler = null; cv.onpointerdown = null;
        finish(acc > herAcc ? "win" : acc < herAcc ? "loss" : "draw", `rhythm ${acc}% vs ${herAcc}%`);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  };
}

// ================================================================= Escape room (from your study topics)
async function escape() {
  stage.innerHTML = `<div class="gn-card"><h2>Escape room</h2><p class="muted">Vermeil locks you in. Each door opens with an answer about your topic.</p>
    <div class="row"><input class="input" id="erTopic" list="erTopics" placeholder="A study topic (e.g. Photosynthesis)"><datalist id="erTopics"></datalist>
    <button class="btn primary" id="erGo" type="button">Lock me in</button></div><div id="erBox"></div></div>`;
  let clock = null;
  stopTab = () => { clearInterval(clock); endSession(); };
  const t = await call("gn_escape_topics");
  $("erTopics").innerHTML = (t.topics || []).map((x) => `<option value="${esc(x)}">`).join("");
  if (t.topics?.length) $("erTopic").value = t.topics[0];
  $("erGo").onclick = async () => {
    clearInterval(clock);
    $("erBox").innerHTML = `<p class="muted">Building the rooms…</p>`;
    $("erGo").disabled = true;
    const r = await call("gn_escape", $("erTopic").value);
    if (!$("erGo")) return;
    $("erGo").disabled = false;
    if (r.error) { $("erBox").innerHTML = `<p class="err">${esc(r.error)}</p>`; return; }
    startSession("escape");
    say("escape");
    let i = 0, hints = 0, wrong = 0;
    const t0 = Date.now();
    const show = () => {
      if (i >= r.rooms.length) {
        clearInterval(clock);
        const secs = Math.round((Date.now() - t0) / 1000);
        $("erBox").innerHTML = `<div class="result"><h3>🚪 You escaped in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}!</h3><p class="muted">${hints} hint${hints === 1 ? "" : "s"}, ${wrong} wrong tr${wrong === 1 ? "y" : "ies"}.</p></div>`;
        finish("win", `escape ${r.topic}`);
        return;
      }
      const room = r.rooms[i];
      $("erBox").innerHTML = `<div class="er-room"><small>${esc(r.title)} · room ${i + 1}/${r.rooms.length} · <span id="erClock">0:00</span></small>
        ${i === 0 && r.story ? `<p><i>${esc(r.story)}</i></p>` : ""}<h3>🔒 ${esc(room.name)}</h3><p>${esc(room.scene)}</p><p class="er-q">${esc(room.question)}</p>
        <div class="row"><input class="input" id="erAns" placeholder="Your answer" autocomplete="off"><button class="btn primary" id="erTry" type="button">Try the lock</button>
        <button class="btn ghost" id="erHint" type="button">Hint</button><button class="btn ghost" id="erGive" type="button">Give up</button></div><p class="msg" id="erMsg"></p></div>`;
      $("erAns").focus();
      $("erTry").onclick = async () => {
        const c = await call("gn_escape_check", $("erAns").value, room);
        if (c.right) { say(["Click! The door opens.", "Correct~ next room!"]); i++; show(); }
        else { wrong++; $("erMsg").textContent = "The lock doesn't move."; $("erAns").select(); }
      };
      $("erAns").onkeydown = (e) => { if (e.key === "Enter") $("erTry").click(); };
      $("erHint").onclick = () => { hints++; $("erMsg").textContent = `Hint: ${room.hint || "think about the topic!"}`; };
      $("erGive").onclick = () => { clearInterval(clock); $("erMsg").textContent = `The answer was: ${room.answer}`; finish("loss", `escape ${r.topic}`); $("erTry").disabled = true; };
    };
    clock = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); if ($("erClock")) $("erClock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 1000);
    show();
  };
}

// ================================================================= Tournament
async function tournament() {
  stage.innerHTML = `<div class="gn-card"><h2>Weekly tournament</h2><p class="muted">Every game you finish counts: a win = 3 points, a draw = 1. On Monday the winner gets the trophy.</p><div id="tnBox">Loading…</div></div>`;
  const r = await call("gn_library");
  if (r.error) { $("tnBox").textContent = r.error; return; }
  const t = r.tournament;
  paintCup(t);
  $("tnBox").innerHTML = `
    <div class="tn-score"><div><b>${t.you}</b><small>You</small></div><span>vs</span><div><b>${t.her}</b><small>Vermeil</small></div></div>
    <p class="muted">${t.week} · ${t.days_left} day${t.days_left === 1 ? "" : "s"} left · ${t.leader === "you" ? "You're winning!" : t.leader === "her" ? "She's ahead — catch up!" : "It's a tie."}</p>
    <h3>This week</h3><ul class="tn-games">${(t.games || []).map((g) => `<li class="${g.result}">${g.result === "win" ? "✅" : g.result === "loss" ? "❌" : "➖"} ${esc(g.detail || g.game)} <small>${esc(g.day)}</small></li>`).join("") || "<li class='muted'>No games yet this week.</li>"}</ul>
    <h3>Trophy shelf (${t.won} won)</h3><div class="shelf">${(t.trophies || []).map((x) => `<span class="trophy ${x.winner}" title="${esc(x.week)}: ${x.you}–${x.her}">${x.winner === "you" ? "🏆" : x.winner === "her" ? "💜" : "🤝"}<small>${esc(x.week.slice(5))}</small></span>`).join("") || "<span class='muted'>Win a week to get your first trophy.</span>"}</div>`;
  say(t.leader === "you" ? "You're ahead this week… not for long!" : t.leader === "her" ? "I'm winning this week~" : "Tied! Let's settle it.");
}

// ---------------- start ----------------
const start = new URLSearchParams(location.search).get("tab");
open(TABS[start] ? start : "library");
say("hello");
