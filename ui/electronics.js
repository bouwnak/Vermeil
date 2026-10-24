// electronics.js - Robotics & Electronics panel: the AI helper (fix / repurpose / build a robot / ask),
// the formula calculators, and the door to the Circuit Lab (ui/electronics/lab.html, a full-window 2D/3D simulator).
import { $, el, toast, setMd, busy } from "./util.js";

const MODES = [
  ["repair", "🔧 Fix it", "What's broken? e.g. “My old electric fan hums but the blades don't spin”"],
  ["repurpose", "♻ Repurpose", "What do you have? e.g. “An old printer and a dead laptop - what can I build?”"],
  ["robot", "🤖 Build a robot", "What should it do? e.g. “A 2-wheel robot that avoids walls”"],
  ["general", "❓ Ask", "Any question, e.g. “Why does my LED need a resistor?”"],
];

export function initElectronics(api) {
  let tab = "chat", mode = "repair", formulas = null, lastLab = null;
  const root = $("elecBody");
  const tabs = el("div", { class: "tabs", role: "tablist" });
  const view = el("div");
  root.replaceChildren(tabs, view);

  function drawTabs() {
    tabs.replaceChildren(...[["chat", "Chat"], ["assistant", "Planner"], ["builder", "3D Builder"], ["lab", "Circuit Lab"]].map(([k, l]) =>
      el("button", { role: "tab", "aria-selected": String(k === tab), onclick: () => { tab = k; load(); } }, l)));
  }

  function load() {
    drawTabs();
    if (tab === "chat") return drawChat();
    if (tab === "builder") return drawBuilder();
    if (tab === "formulas") return drawFormulas();
    if (tab === "lab") return drawLab();
    drawAssistant();
  }

  // ---------------- chat: the engineering brain, remembers your measurements and what was ruled out ----------------
  const chatLog = el("div", { class: "code-log", "aria-live": "polite" });
  const chatIn = el("textarea", { rows: 3, placeholder: "e.g. “My servo jitters when the motor starts” or “Is a 2S LiPo enough for 8 MG996R servos?”", "aria-label": "Message to the electronics engineer" });
  const logBox = el("details", { class: "elec-log" });
  function bubble(role, text, build) {
    const b = el("div", { class: `msg ${role}` });
    if (role === "assistant") setMd(b, text, api); else b.textContent = text;
    if (build) b.append(el("div", { class: "row" }, el("button", { class: "primary small", onclick: () => openBuilder(build) }, `🤖 See it in 3D: ${build.slice(0, 50)}`)));
    chatLog.append(b);
    b.scrollIntoView({ block: "end" });
  }
  function drawLog(L) {
    const n = (L.measured.length + L.ruled_out.length + L.worked.length);
    logBox.replaceChildren(el("summary", {}, `🧾 Troubleshooting log (${n})${L.open ? " · open: " + L.open : ""}`),
      ...[["Measured", L.measured], ["Ruled out", L.ruled_out], ["Worked", L.worked]].filter(([, v]) => v.length)
        .map(([k, v]) => el("p", { class: "note" }, el("b", {}, k + ": "), v.slice(-10).join(" · "))));
  }
  async function drawChat() {
    const send = el("button", { class: "primary" }, "Send");
    const ask = async () => {
      const text = chatIn.value.trim(); if (!text) return;
      chatIn.value = ""; bubble("user", text);
      busy(send, true, "Thinking…");
      try { const r = await api.elec_chat(text); if (r.error) bubble("assistant", r.error); else { bubble("assistant", r.reply, r.build); drawLog(r.log); } }
      finally { busy(send, false); }
    };
    chatIn.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } };
    view.replaceChildren(
      el("div", { class: "row" }, el("p", { class: "note", style: "flex:1" }, "An engineer that reasons with real numbers, datasheets and your measurements - and remembers what you already tried."),
        el("button", { class: "ghost small", onclick: async () => { const s = await api.elec_chat_clear(true); chatLog.replaceChildren(); drawLog(s.log); } }, "New chat"),
        el("button", { class: "ghost small", onclick: async () => { if (confirm("Forget the troubleshooting log too?")) { const s = await api.elec_chat_clear(false); chatLog.replaceChildren(); drawLog(s.log); } } }, "Clear log")),
      logBox, chatLog,
      el("form", { class: "code-input", onsubmit: (e) => { e.preventDefault(); ask(); } }, chatIn, send));
    if (!chatLog.children.length) {
      const s = await api.elec_chat_state();
      for (const m of s.history || []) bubble(m.role, m.content);
      drawLog(s.log);
    }
  }

  // ---------------- 3D builder: prompt -> robot/device in 3D (ui/builder/) ----------------
  function drawBuilder() {
    const inp = el("input", { placeholder: "e.g. “create a robot dog” or “build a smart TV”", "aria-label": "What to build", style: "flex:1" });
    const go = () => openBuilder(inp.value.trim());
    inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
    view.replaceChildren(
      el("p", {}, "Describe any robot or electronic device. The 3D Build Lab designs it with real parts - the exoskeleton, motors and servos, ",
        "electronics, power and every wire, each one labelled - assembles it in front of you and simulates it (walking, driving, flying, switching on)."),
      el("div", { class: "row" }, inp, el("button", { class: "primary", onclick: go }, "✨ Build it in 3D")),
      el("div", { class: "chips" }, ["create a robot dog", "a hexapod spider", "a humanoid animatronic", "a robot arm", "a camera drone", "build a smart TV", "a smartwatch"]
        .map((x) => el("button", { class: "chip", onclick: () => openBuilder(x) }, x))),
      el("div", { class: "row" }, el("button", { class: "ghost", onclick: () => openBuilder("") }, "Open the 3D Build Lab")));
  }
  async function openBuilder(prompt) {
    if (prompt) await api.build_pending({ prompt });
    document.body.append(el("div", { class: "lab-opening" }, "Opening the 3D Build Lab…"));
    setTimeout(() => { location.href = "builder/index.html"; }, 200);
  }

  // ---------------- AI assistant ----------------
  const question = el("textarea", { rows: 4, class: "elec-q", "aria-label": "Your question" });
  const answer = el("div", { class: "elec-answer md" });
  function drawAssistant() {
    const m = MODES.find((x) => x[0] === mode);
    question.placeholder = m[2];
    const ask = el("button", { class: "primary", onclick: async () => {
      busy(ask, true, "Thinking…");
      answer.replaceChildren(el("p", { class: "note" }, "Working it out… (big plans take ~20-40 s)"));
      const r = await api.elec_ask(mode, question.value, null);
      busy(ask, false);
      if (r.error) { answer.replaceChildren(el("p", { class: "none" }, r.error)); return; }
      setMd(answer, r.answer, api);
      lastLab = r.lab || null;
      if (lastLab) answer.append(el("div", { class: "row" }, el("button", { class: "primary", onclick: () => openLab(lastLab) }, "⚡ Open in Circuit Lab")));
    } }, "Ask");
    view.replaceChildren(
      el("div", { class: "row chips" }, MODES.map(([k, label]) => el("button", { class: `chip${k === mode ? " on" : ""}`, onclick: () => { mode = k; drawAssistant(); } }, label))),
      el("p", { class: "note" }, mode === "repair" ? "⚠ Unplug first. Mains (230 V), microwave ovens, CRT TVs and camera flashes can kill even when unplugged - she'll tell you how to make them safe."
        : mode === "robot" ? "She plans it from start to finish: parts and prices, power, wiring, Arduino code, build and testing - and can load the circuit into the Circuit Lab."
          : mode === "repurpose" ? "Salvage motors, LEDs, speakers, power supplies and sensors from old stuff and turn them into new projects."
            : "Formulas, parts, Arduino, soldering, sensors… anything."),
      question, el("div", { class: "row" }, ask), answer);
  }

  // ---------------- formulas ----------------
  async function drawFormulas() {
    formulas ||= await api.elec_formulas();
    const sel = el("select", { "aria-label": "Calculator" }, Object.entries(formulas).map(([k, f]) => el("option", { value: k }, f.name)));
    const box = el("div");
    const show = () => {
      const f = formulas[sel.value];
      const inputs = {};
      const out = el("div", { class: "elec-results" });
      const form = el("form", { class: "elec-form", onsubmit: async (e) => {
        e.preventDefault();
        const values = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
        const r = await api.elec_calc(sel.value, values);
        if (r.error) { out.replaceChildren(el("p", { class: "none" }, r.error)); return; }
        out.replaceChildren(
          el("table", { class: "stats" }, el("tbody", {}, r.results.map(([a, b]) => el("tr", {}, el("td", {}, a), el("td", {}, el("b", {}, b)))))),
          r.steps.length ? el("details", { open: true }, el("summary", {}, "How it's worked out"), el("ul", { class: "note" }, r.steps.map((s) => el("li", {}, s)))) : null,
          ...r.notes.map((n) => el("p", { class: "tip-line" }, n)));
      } },
        f.fields.map(([k, label, unit, def]) => {
          const i = k === "items" ? el("textarea", { rows: 4 }) : el("input", { inputmode: "decimal", placeholder: def || "", autocomplete: "off" });
          if (def) i.value = def;
          inputs[k] = i;
          return el("label", {}, `${label}${unit ? ` (${unit})` : ""}`, i);
        }),
        el("button", { class: "primary", type: "submit" }, "Calculate"));
      box.replaceChildren(el("p", { class: "note" }, f.help, " You can type 4.7k, 100n, 2.2u, 1M…"), form, out);
    };
    sel.addEventListener("change", show);
    view.replaceChildren(sel, box);
    show();
  }

  // ---------------- circuit lab ----------------
  async function drawLab() {
    const projects = await api.elec_projects();
    view.replaceChildren(
      el("p", {}, "A Tinkercad-style simulator: breadboards, Arduino Uno/Nano/Mega/Leonardo/Micro/Pro Mini and ESP32, LEDs, resistors, buttons, ",
        "potentiometers, sensors, motors, servos, buzzers, transistors… Wire them up in 2D, look at it in 3D, write Arduino code and press Start."),
      el("div", { class: "row" }, el("button", { class: "primary", onclick: () => openLab(null) }, "⚡ Open the Circuit Lab"),
        lastLab ? el("button", { class: "ghost", onclick: () => openLab(lastLab) }, "Open the circuit from the assistant") : null),
      el("h3", {}, "Your projects"),
      projects.length ? el("ul", { class: "prefs" }, projects.map((p) => el("li", {},
        el("span", {}, `${p.name} `, el("small", { class: "note" }, p.saved)),
        el("button", { class: "ghost small", onclick: () => openLab({ project: p.name }) }, "Open"),
        el("button", { class: "x", "aria-label": `Delete ${p.name}`, onclick: async () => { if (confirm(`Delete “${p.name}”?`)) { await api.elec_delete(p.name); drawLab(); } } }, "×"))))
        : el("p", { class: "none" }, "No saved circuits yet - the Lab has examples to start from (Blink, traffic light, servo sweep, night light, robot car…)."));
  }

  async function openLab(circuit) {
    if (circuit) await api.elec_pending(circuit);
    const ov = el("div", { class: "lab-opening" }, "Opening the Circuit Lab…");
    document.body.append(ov);
    setTimeout(() => { location.href = "electronics/lab.html"; }, 200);
  }

  return { load };
}
