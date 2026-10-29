// life.js - makes the character feel alive.
//
//  - faces:    her face follows what she says (happy "!", thinking "?", sad "sorry", surprised "wow")
//  - idle:     when nothing is happening she wanders to furniture and does little things
//              (reads at the bookshelf in the day, sits on the couch in the evening, gets sleepy at night)
//  - outfits:  auto mode dresses her for the moment (Santa hat in December, witch hat at Halloween,
//              party hat on your birthday, headband for the gym, glasses for study, headphones for music)
//  - scenes:   the room lighting changes with what you're doing (study, focus, story time)
//  - music:    she bops along when a song plays
//
// app.js calls:  life.onEvent(e)  for every event from Python, and gives a getContext() function.

const MOODS = [
  [/\b(sorry|unfortunately|sad|miss you|that's rough|oh no)\b|😢|😞|💔/i, "sad"],
  [/\b(wow|whoa|no way|really\?!|what\?!|omg)\b|😮|😲|!\?/i, "surprised"],
  [/\b(grr|hmph|annoying|ugh)\b|😠|😤/i, "angry"],
  [/\b(yawn|sleepy|tired|good ?night)\b|😪|😴|💤/i, "sleepy"],
  [/\b(hmm+|let me think|let's see|i wonder)\b|🤔/i, "thinking"],
  [/\b(haha|hehe|lol|yay|great|awesome|congrat\w*|love|nice|amazing|proud)\b|!|😊|😄|🎉|💖|❤/i, "happy"],
];

/** Which face goes with a sentence. Exported so it can be tested. */
export function moodOf(sentence) {
  for (const [re, mood] of MOODS) if (re.test(sentence)) return mood;
  return /\?\s*$/.test(sentence) ? "thinking" : "neutral";
}

/** What to do right now when idle, by hour of the day: [kind, label, mood, weight, minutes she stays].
 *  At night she mostly sleeps in bed or curls up on the sofa; in the evening she rests a lot. */
export function idlePlan(hour) {
  if (hour >= 23 || hour < 6) return [["bed", "sleeping 😴", "sleepy", 8, 6], ["couch", "dozing on the sofa 💤", "sleepy", 2, 3]];
  if (hour < 11) return [["window", "looking outside ☀", "happy", 2, 1], ["plant", "watering the plant 🌱", "happy", 2, 1],
    ["desk", "planning the day 📝", "thinking", 3, 2], ["books", "reading 📚", "thinking", 2, 1.5], ["couch", "resting a bit 🛋", "neutral", 1, 1.5]];
  if (hour < 18) return [["desk", "working 💻", "thinking", 4, 2.5], ["books", "reading 📚", "thinking", 3, 1.5],
    ["plant", "checking the plant 🌱", "happy", 1, 1], ["couch", "taking a break 🛋", "neutral", 2, 2], ["bed", "a little nap 😪", "sleepy", 0.5, 2]];
  return [["couch", "relaxing 🛋", "happy", 5, 3], ["bed", "resting in bed 🛌", "sleepy", 2.5, 3], ["books", "reading 📚", "thinking", 2, 1.5],
    ["music", "picking a song 🎵", "happy", 1, 1], ["window", "watching the night 🌙", "neutral", 1, 1]];
}

function pickWeighted(list) {
  let r = Math.random() * list.reduce((a, p) => a + (p[3] ?? 1), 0);
  for (const p of list) if ((r -= p[3] ?? 1) <= 0) return p;
  return list[list.length - 1];
}

/** Auto outfit for today / what you're doing. ctx = {date, birthday, gym, study, focus, music} */
export function autoOutfit(ctx) {
  const d = ctx.date || new Date();
  const m = d.getMonth() + 1, day = d.getDate();
  if (ctx.birthday) return { hat: "party", glasses: false, color: "#ff5fa2", why: "🎂 Happy birthday!" };
  if (ctx.gym) return { hat: "headband", glasses: false, color: "#3e8eff", why: "Gym mode" };
  if (ctx.study || ctx.focus) return { hat: m === 12 ? "santa" : "none", glasses: true, color: "#3e8eff", why: "Study mode" };
  if (ctx.music) return { hat: "headphones", glasses: false, color: "#3e8eff", why: "Music" };
  if (m === 10 && day >= 24) return { hat: "witch", glasses: false, color: "#9a7bff", why: "Halloween" };
  if (m === 12 && day >= 1) return { hat: "santa", glasses: false, color: "#d62839", why: "Christmas season" };
  if ((m === 12 && day === 31) || (m === 1 && day === 1)) return { hat: "party", glasses: false, color: "#f5c542", why: "New Year" };
  if (m >= 11 || m <= 2) return { hat: "beanie", glasses: false, color: "#3e8eff", why: "Cold season" };
  return { hat: "none", glasses: false, color: "#3e8eff", why: "" };
}

/** Lighting scene for what you're doing, or null = your own room settings. */
export function sceneFor(ctx) {
  if (ctx.birthday) return "party";
  if (ctx.focus) return "focus";
  if (ctx.style === "tutor") return "study";             // just opening the Study panel leaves your lights alone
  if (ctx.voiceStyle === "storyteller") return "story";
  return null;
}

export function initLife(room, { getContext, onActivity = () => {} }) {
  let faceTimers = [];
  let lastBusy = performance.now();
  let nextIdle = performance.now() + 30000;
  let activity = null;
  let outfitKey = "";

  // ---------- faces that follow what she says ----------
  function react(text) {
    faceTimers.forEach(clearTimeout);
    faceTimers = [];
    const parts = String(text || "").match(/[^.!?…]+[.!?…]*\s*/g) || [];
    let at = 0;
    for (const p of parts.slice(0, 12)) {
      const mood = moodOf(p);
      const secs = Math.min(4, Math.max(1.2, p.length / 15));        // roughly how long it takes to say
      faceTimers.push(setTimeout(() => room.setExpression(mood, secs + 0.3), at * 1000));
      at += secs;
    }
    faceTimers.push(setTimeout(() => room.setExpression("neutral"), at * 1000 + 400));
    busy();
  }

  function busy() {
    lastBusy = performance.now();
    if (activity) { activity = null; onActivity(null); }
    nextIdle = lastBusy + 35000 + Math.random() * 25000;
  }

  // ---------- idle activities ----------
  function idleStep(ctx) {
    if (!ctx.idle || ctx.editing || room.speaking || room.walkTarget || room.emote) return;
    if (performance.now() < nextIdle) return;
    nextIdle = performance.now() + 40000 + Math.random() * 40000;
    const spots = room.spots?.() || [];
    const hour = (ctx.date || new Date()).getHours();
    const plan = spots.some((s) => s.kind === "gym") ? [["gym", "working out 💪", "happy", 1, 1]]          // in the gym room
      : idlePlan((ctx.date || new Date()).getHours()).filter(([kind]) => spots.some((s) => s.kind === kind));
    if (!plan.length) {                                                  // no matching furniture: stretch in place
      room.playEmote(Math.random() < 0.5 ? "think" : "nod");
      return;
    }
    const [kind, label, mood, , stay] = pickWeighted(plan);
    if (stay) nextIdle = performance.now() + stay * 60000 * (0.75 + Math.random() * 0.5);   // rests / sleeps stay longer
    const options = spots.filter((s) => s.kind === kind);
    const s = options[Math.floor(Math.random() * options.length)];
    if (s.use && room.useSpot) room.useSpot(s); else room.walkTo(s.x, s.z);
    activity = label;
    onActivity(label);
    setTimeout(() => { if (activity === label) room.setExpression(mood, 8); }, 2500);
  }

  // ---------- outfit, scene, music ----------
  function dress(ctx) {
    const o = ctx.outfit || { auto: true };
    const want = o.auto === false ? { hat: o.hat || "none", glasses: !!o.glasses, color: o.color || "#3e8eff" } : autoOutfit(ctx);
    const key = JSON.stringify([want.hat, want.glasses, want.color]);
    if (key !== outfitKey) { outfitKey = key; room.setOutfit(want); }
  }

  function tick() {
    const ctx = getContext();
    try {
      dress(ctx);
      const scene = ctx.scenes ? sceneFor(ctx) : null;
      if (scene !== (room.scene_ || null)) room.setScene(scene);
      room.setMusic(!!ctx.music);
      idleStep(ctx);
    } catch (e) { console.error("[life]", e); }
  }
  setInterval(tick, 2000);
  setTimeout(tick, 500);

  return {
    react,
    busy,
    redress: () => { outfitKey = ""; tick(); },
    onEvent(e) {
      switch (e.type) {
        case "reply": case "ask": react(e.text); break;
        case "group_line": react(e.text); break;
        case "speaking": if (e.on) busy(); break;
        case "heard": busy(); room.setExpression("thinking", 1.5); break;
        case "emote": busy(); room.playEmote(e.name); break;
        case "expression": busy(); room.setExpression(e.name, e.seconds || 4); break;
        case "gesture": if (e.gesture === "heart" || e.gesture === "peace") room.setExpression("happy", 3); break;
      }
    },
    get activity() { return activity; },
  };
}
