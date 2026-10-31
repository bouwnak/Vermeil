// herlife.js - the little things that make her feel like she lives with you (skills/herlife.py on the Python side):
// what she wears today (time, weather, season, holidays, your birthday) and your 👗 wardrobe of saved outfits,
// birthday mode, a holiday greeting, asking how your exam went, and reminders that ring like a 📞 phone call.
// app.js calls initHerLife() and forwards Python events to onEvent().
const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
const btn = (text, click, props = {}) => { const b = el("button", { type: "button", textContent: text, ...props }); b.addEventListener("click", click); return b; };

const HAT_NAMES = { none: "No hat", beanie: "Beanie", party: "Party hat", crown: "Crown", santa: "Santa hat", witch: "Witch hat",
  headband: "Headband", headphones: "Headphones", cap: "Cap" };

// a phone ringtone made on the computer (two-tone ring, like a real phone)
function ringtone() {
  let ctx = null, timer = null;
  const ring = () => {
    const t = ctx.currentTime, gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);
    for (const f of [440, 480]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(gain); o.start(t); o.stop(t + 1.6); }
    for (let i = 0; i < 2; i++) {                    // ring-ring
      gain.gain.setValueAtTime(0.0001, t + i * 0.8);
      gain.gain.exponentialRampToValueAtTime(0.15, t + i * 0.8 + 0.03);
      gain.gain.setValueAtTime(0.15, t + i * 0.8 + 0.55);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.8 + 0.6);
    }
  };
  return {
    start() { try { ctx ||= new AudioContext(); ring(); timer = setInterval(ring, 3000); } catch { /* no sound */ } },
    stop() { clearInterval(timer); timer = null; },
  };
}

export function initHerLife({ api, room, toast, getName = () => "Vermeil" }) {
  const her = { outfit: null, birthday: false, sleep: false };
  const ring = ringtone();

  // ---------- 📞 reminders ring like a phone call ----------
  const call = el("div", { className: "her-call", hidden: true });
  call.setAttribute("role", "alertdialog");
  document.body.append(call);
  let queue = [];
  function incoming(text) {
    queue.push(text);
    if (!call.hidden) return;
    showCall();
  }
  function showCall() {
    const text = queue.shift();
    if (!text) return;
    const end = () => { ring.stop(); call.hidden = true; call.replaceChildren(); setTimeout(showCall, 400); };
    call.replaceChildren(el("div", { className: "her-call-card" }, [
      el("div", { className: "her-call-avatar", textContent: "💜" }),
      el("strong", { textContent: `${getName()} is calling…` }),
      el("small", { textContent: "📞 Reminder" }),
      el("div", { className: "her-call-btns" }, [
        btn("📵 Snooze 10 min", () => { end(); setTimeout(() => incoming(text), 10 * 60 * 1000); toast("I'll call again in 10 minutes."); }, { className: "danger" }),
        btn("📞 Answer", () => { end(); api.her_say(text); }, { className: "primary" }),
      ]),
    ]));
    call.hidden = false;
    ring.start();
    setTimeout(() => { if (!call.hidden) { end(); toast(`⏰ Missed call: ${text}`, 10000); } }, 45000);
  }

  // ---------- today: outfit, birthday, sleeping, a greeting, a question ----------
  let confettiDone = false;
  async function today() {
    let t;
    try { t = await api.her_today(); } catch { return; }
    Object.assign(her, t);
    if (t.birthday && !confettiDone) {
      confettiDone = true;
      confetti();
      room.playEmote?.("celebrate");
      api.her_say("Happy birthday!! 🎂🎉 Today is all about you. Make a wish!");
    }
    if (t.greeting) setTimeout(() => api.her_say(t.greeting), 6000);
    if (t.ask) setTimeout(async () => { await api.her_say(t.ask.question); api.her_asked(t.ask.id); }, t.greeting ? 25000 : 9000);
  }
  today();
  setInterval(today, 10 * 60 * 1000);

  function confetti() {
    const box = el("div", { className: "confetti" });
    const colors = ["#ff5fa0", "#ffd24d", "#5fd08a", "#3e8eff", "#b07bff"];
    for (let i = 0; i < 90; i++) {
      const p = el("i");
      p.style.left = `${Math.random() * 100}%`;
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = `${Math.random() * 1.5}s`;
      p.style.animationDuration = `${2.5 + Math.random() * 2}s`;
      box.append(p);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 6000);
  }

  // ---------- 👗 wardrobe (Settings → Her) ----------
  async function renderWardrobe(box) {
    const w = await api.wardrobe();
    const wear = el("select", {}, [el("option", { value: "auto", textContent: "✨ Auto (time, weather, season, holidays)" }),
      ...w.outfits.map((o) => el("option", { value: o.name, textContent: `${o.name} (${HAT_NAMES[o.hat] || o.hat}${o.glasses ? ", glasses" : ""})` }))]);
    wear.value = w.wearing;
    wear.setAttribute("aria-label", "What she wears");
    wear.addEventListener("change", async () => { await api.wardrobe_wear(wear.value); toast(wear.value === "auto" ? "She dresses for the day by herself." : `She's wearing ${wear.value}.`); });
    const name = el("input", { placeholder: "Outfit name", maxLength: 30 });
    const hat = el("select", {}, w.hats.map((h) => el("option", { value: h, textContent: HAT_NAMES[h] || h })));
    hat.setAttribute("aria-label", "Hat");
    const glasses = el("input", { type: "checkbox" });
    const color = el("input", { type: "color", value: "#3e8eff" });
    color.setAttribute("aria-label", "Colour");
    const preview = () => room.setOutfit({ hat: hat.value, glasses: glasses.checked, color: color.value });
    [hat, glasses, color].forEach((x) => x.addEventListener("input", preview));
    box.replaceChildren(
      el("label", { className: "inline" }, ["Wearing ", wear]),
      el("div", { className: "live-row" }, [name, hat, el("label", { className: "inline" }, [glasses, " Glasses"]), color,
        btn("💾 Save outfit", async () => {
          const r = await api.wardrobe_save({ name: name.value, hat: hat.value, glasses: glasses.checked, color: color.value });
          if (r.error) return toast(r.error);
          toast(`Saved ${name.value}.`); renderWardrobe(box);
        }, { className: "primary" })]),
      ...w.outfits.map((o) => el("div", { className: "edit-card" }, [el("b", { textContent: o.name }), ` ${HAT_NAMES[o.hat] || o.hat}${o.glasses ? " + glasses" : ""} `,
        el("span", { className: "swatch", style: `background:${o.color}` }),
        btn("✕", async () => { await api.wardrobe_remove(o.name); renderWardrobe(box); }, { className: "danger", ariaLabel: `Remove ${o.name}` })])),
      el("p", { className: "note", textContent: "Change the hat or colour to try it on her, then save it. Auto picks a Santa hat in December, a beanie when it's cold or raining, a cap on sunny days, a party hat on your birthday." }));
  }

  return {
    her,
    renderWardrobe,
    redress: today,
    onEvent(e) {
      if (e.type === "alert") incoming(e.text);
      if (e.type === "outfit") { her.outfit = e.outfit; }
      if (e.type === "routine") room.playEmote?.(e.kind === "night" ? "yawn" : "stretch");
    },
  };
}
