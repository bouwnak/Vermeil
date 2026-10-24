// plugins.js - Settings -> Plugins: install the features you want, uninstall the ones you don't (frees space).
// The work happens in brain/plugins.py; progress comes back as {type: "plugin"} events.
import { $, el, toast } from "./util.js";

export function initPlugins(api, { onChange } = {}) {
  let data = null;
  const picked = new Set();
  const logs = {};                       // plugin id -> last lines of its install log

  // ---- Plugins is one of the Settings tabs (General · Her · You · AI & online · Test · Plugins)
  window.addEventListener("plugins-tab", () => refresh());
  function show(which) {
    window.showSettingsTab?.(which);
    if (which === "plugins") refresh();
  }
  const visible = () => !$("setPlugins").closest(".settings-pane")?.hidden;

  async function refresh() {
    data = await api.plugins_status();
    draw();
  }

  function draw() {
    if (!data) return;
    const groups = {};
    for (const p of data.plugins) (groups[p.group] ||= []).push(p);
    const used = data.plugins.reduce((n, p) => n + (p.installed ? p.used_mb : 0), 0);
    $("pluginsTotal").textContent = `Installed features use about ${used >= 1000 ? `${(used / 1000).toFixed(1)} GB` : `${Math.round(used)} MB`}.`;
    $("pluginsIntro").textContent = data.fresh
      ? "Welcome! Tick the features you want and press “Install selected”. Everything else stays off and takes no space. You can come back here any time."
      : "Pick the features you want. Install adds what a feature needs (packages, models, files); Uninstall removes them to free space.";
    $("pluginList").replaceChildren(...Object.entries(groups).map(([g, list]) => el("div", { class: "plugin-group" },
      el("h4", {}, g), ...list.map(card))));
  }

  function card(p) {
    const cb = el("input", { type: "checkbox", checked: picked.has(p.id), disabled: p.installed || p.busy, "aria-label": `Select ${p.name}`,
      onchange: () => { cb.checked ? picked.add(p.id) : picked.delete(p.id); } });
    const state = p.busy ? el("span", { class: "pill busy" }, "Working…") : p.installed ? el("span", { class: "pill ok" }, "Installed") : el("span", { class: "pill off" }, "Not installed");
    const btn = p.installed
      ? el("button", { class: "ghost small", disabled: p.busy, onclick: () => remove(p) }, "Uninstall")
      : el("button", { class: "small", disabled: p.busy, onclick: () => add([p.id]) }, "Install");
    const lines = (logs[p.id] || p.log || []).slice(-3);
    return el("article", { class: `plugin${p.installed ? " on" : ""}` },
      el("label", { class: "plugin-head" }, p.installed ? null : cb, el("span", { class: "plugin-icon", "aria-hidden": "true" }, p.icon),
        el("strong", {}, p.name), state),
      el("p", { class: "note" }, p.desc),
      el("p", { class: "note small" }, `Size: ${p.size}${p.installed && p.used_mb ? ` · using ${p.used_mb} MB now` : ""}` +
        `${p.pack ? ` · installer copy: ${p.pack_mb} MB` : ""}${p.needs_ollama ? " · needs the Ollama app (ollama.com)" : ""}`),
      p.installed && p.missing_pip.length ? el("p", { class: "note warn" }, `Missing packages: ${p.missing_pip.join(", ")} - press Install again or run: `, el("code", {}, p.pip_command)) : null,
      lines.length ? el("pre", { class: "plugin-log" }, lines.join("\n")) : null,
      el("div", { class: "row" }, btn, !p.installed && p.pip_command ? el("button", { class: "ghost small", title: "Copy the pip command to run it yourself",
        onclick: () => { navigator.clipboard?.writeText(p.pip_command); toast(`Copied: ${p.pip_command}`, 3500); } }, "Copy pip command") : null));
  }

  async function add(ids) {
    if (!ids.length) return toast("Tick at least one feature first.");
    const r = await api.plugins_install_many(ids);
    for (const e of r.errors || []) toast(e, 6000);
    if (r.started) toast(`Installing ${r.started} feature${r.started > 1 ? "s" : ""}… you can keep using Vermeil.`, 4000);
    ids.forEach((i) => picked.delete(i));
    data = r.status; draw();
    if (data.fresh) { data = await api.plugins_first_run_done(); draw(); }
  }

  async function remove(p, force = false) {
    if (!force && !confirm(`Uninstall ${p.name}?\n\nIts files${p.used_mb ? ` (about ${Math.round(p.used_mb)} MB)` : ""} and the packages only it uses will be removed, and it disappears from the menu. You can install it again later.`)) return;
    let removePack = false;
    if (p.pack && !force) removePack = confirm(`Also delete the installer copy (${p.pack_mb} MB in plugin_packs)?\n\nOK = free that space too (to reinstall you'll need the installer package again).\nCancel = keep it so you can reinstall offline.`);
    const r = await api.plugin_uninstall(p.id, force, removePack);
    if (r.confirm) { if (confirm(r.confirm)) return remove(p, true); return; }
    toast(r.error || r.message, 5000);
    data = r.status || data; draw(); onChange?.();
  }

  $("pluginsInstallSel").addEventListener("click", () => add([...picked]));
  $("pluginsSelAll").addEventListener("click", () => { for (const p of data?.plugins || []) if (!p.installed) picked.add(p.id); draw(); });
  $("pluginsRefresh").addEventListener("click", refresh);

  return {
    show,
    /** a {type: "plugin"} event from Python */
    onEvent(e) {
      (logs[e.id] ||= []).push(e.text); logs[e.id] = logs[e.id].slice(-6);
      if (e.state !== "running") { toast(e.text.split("\n")[0], 5000); refresh().then(() => onChange?.()); }
      else if (visible()) refresh();
    },
  };
}
