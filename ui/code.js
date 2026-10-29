// code.js - the coding helper panel.
import { $, el, setMd, busy, toast, setupDropZone, loadingCard } from "./util.js";

export function initCode(api) {
  const root = $("codeBody");
  const folder = el("code", { class: "ws" });
  const log = el("div", { class: "code-log", "aria-live": "polite" });
  const input = el("textarea", { rows: 3, placeholder: "e.g. “Make me a Python calculator with buttons” or “Why does my music skip songs?”", "aria-label": "Message to the coding helper" });
  const IDEAS = ["Make a Python calculator with a window", "Build a to-do list website", "Write a Roblox script for a coin that gives points",
    "Make a Discord-style quiz game in the terminal", "Create a script that renames all photos in a folder by date"];
  const send = el("button", { class: "primary" }, "Send");

  root.replaceChildren(
    el("div", { class: "row ws-bar" }, el("span", {}, "Project: "), folder,
      el("button", { class: "ghost small", onclick: async (e) => { busy(e.target, true, "Choose a folder…"); try { render(await api.code_choose_folder()); } finally { busy(e.target, false); } } }, "Use my folder…"),
      el("button", { class: "ghost small", title: "Paste a folder path instead of browsing", onclick: async () => {
        const p = prompt("Paste the folder path (e.g. C:\\Users\\you\\Desktop\\my-app):"); if (p) render(await api.code_set_folder(p)); } }, "Paste a path…"),
      el("button", { class: "ghost small", onclick: newProject }, "＋ New project"),
      el("button", { class: "ghost small", onclick: async () => toast(await api.code_open_editor()) }, "Open in VS Code"),
      el("button", { class: "ghost small", onclick: async () => render(await api.code_clear()) }, "New chat")),
    el("p", { class: "note" }, "Ask it to BUILD something (it makes a new project, writes the files, tests them) or to help with your own folder. "
      + "In your folders every change and command waits for your OK; in projects it made itself it writes files freely, but still asks before running anything."),
    el("div", { class: "chips" }, IDEAS.map((x) => el("button", { class: "chip", onclick: () => { input.value = x; input.focus(); } }, x))),
    log,
    el("form", { class: "code-input", onsubmit: (e) => { e.preventDefault(); ask(); } }, input, send));

  setupDropZone(root, async (files) => {
    if (!files.length) return;
    const f = files[0];
    const path = f.pywebviewFullPath || f.path || f.name;
    toast(`Opening project folder: ${f.name}…`);
    render(await api.code_set_folder(path));
  });

  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(); } });

  function bubble(role, text) {
    const b = el("div", { class: `msg ${role}` });
    if (role === "assistant") setMd(b, text, api); else b.textContent = text;
    log.append(b);
    b.scrollIntoView({ block: "end" });
    return b;
  }

  async function newProject() {
    const name = prompt("Name for the new project (e.g. Calculator):");
    if (!name) return;
    render(await api.code_new_project(name));
  }

  function render(state) {
    folder.textContent = state.workspace || "none yet — ask it to build something";
    log.replaceChildren();
    if (state.error) toast(state.error, 5000);
    if (!state.workspace) log.append(el("p", { class: "none" }, "Ask it to build something, or click “Use my folder…” to get help with your own project."));
    for (const m of state.history) bubble(m.role, m.content);
  }

  async function ask() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    bubble("user", text);
    busy(send, true, "Working…");
    const loader = el("div", { class: "msg assistant" }, loadingCard("Writing code and reasoning…"));
    log.append(loader);
    loader.scrollIntoView({ block: "end" });
    try {
      const r = await api.code_ask(text);
      loader.remove();
      bubble("assistant", r.error ? `Something went wrong: ${r.error}` : r.reply);
    } catch (err) {
      loader.remove();
      bubble("assistant", `Error: ${err}`);
    } finally { busy(send, false); }
  }

  // live events from Python
  function onEvent(e) {
    if (e.type === "code_workspace") folder.textContent = e.workspace;
    if (e.type === "code_user") bubble("user", e.text);
    if (e.type === "code_reply") bubble("assistant", e.text);
    if (e.type === "code_step") {
      const names = { list_files: "Looked at the files", read_file: "Read", search_code: "Searched the code", edit_file: "Edit", write_file: "Write",
        write_files: "Wrote", run_command: "Ran", new_project: "New project", open_in_editor: "Opened", delete_file: "Deleted",
        project_map: "Mapped the project", remember: "Remembered", docs_lookup: "Checked the docs", review: "Review" };
      log.append(el("p", { class: "step" }, `${names[e.tool] || e.tool}: ${e.summary}`));
    }
    if (e.type === "code_approve") {
      const title = e.kind === "run" ? `Run this command in ${e.folder}?` : e.kind === "delete" ? `Delete ${e.path}?` : e.kind === "write" && e.new ? `Create ${e.path}?` : `Change ${e.path}?`;
      const pre = el("pre", { class: "diff" });
      const text = e.kind === "run" ? `> ${e.command}` : (e.diff || "(no changes)");
      for (const line of text.split("\n")) {
        pre.append(el("span", { class: line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : "" }, line + "\n"));
      }
      const card = el("div", { class: "approve" },
        el("strong", {}, title), e.reason ? el("p", {}, e.reason) : null, pre);
      const decide = async (yes) => {
        await api.code_decide(e.id, yes);
        card.classList.add(yes ? "yes" : "no");
        btns.replaceChildren(el("span", {}, yes ? "Approved" : "Rejected"));
      };
      const btns = el("div", { class: "row" },
        el("button", { class: "primary", onclick: () => decide(true) }, e.kind === "run" ? "Run it" : e.kind === "delete" ? "Delete it" : "Apply change"),
        el("button", { class: "ghost", onclick: () => decide(false) }, "Don't"));
      card.append(btns);
      log.append(card);
      card.scrollIntoView({ block: "end" });
    }
  }

  return { load: async () => render(await api.code_state()), onEvent };
}
