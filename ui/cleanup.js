// cleanup.js - Settings > General > 🧹 Clean-up wizard: big files, files you haven't used in a long time, hidden leftovers,
// big unused folders and duplicates, on every drive or only in your own folders.
// Nothing goes on its own: you tick what to remove, confirm, and it moves to the Recycle Bin (skills/cleanup.py).
import { $, el, toast, busy } from "./util.js";

export function initCleanup(api) {
  const box = $("cleanupBox");
  if (!box) return null;
  const bigGb = el("input", { type: "number", min: "0.1", max: "2000", step: "0.5", value: "1", class: "tiny", "aria-label": "Big file size in GB" });
  const unusedDays = el("input", { type: "number", min: "1", max: "3650", value: "30", class: "tiny", "aria-label": "Not used for this many days" });
  const everything = el("input", { type: "checkbox", checked: true });
  const out = el("div", { class: "cleanup-out" });
  const live = el("p", { class: "note", hidden: true, "aria-live": "polite" });
  const stopBtn = el("button", { type: "button", class: "ghost", hidden: true, onclick: () => api.cleanup_stop() }, "⏹ Stop");
  const scanBtn = el("button", { type: "button", class: "primary", onclick: scan }, "🔍 Scan");
  box.replaceChildren(
    el("p", { class: "note" }, "Finds big files, files you haven't used in a long time, hidden leftovers and big unused folders. You choose what goes; it goes to the Recycle Bin, so you can still restore it. Windows, Vermeil's own folder, your dnd folder and voice models are never listed. Files inside installed apps and games are only pointed out: uninstall those instead."),
    el("div", { class: "row" }, el("label", {}, "Big files from ", bigGb, " GB"), el("label", {}, "Not used for ", unusedDays, " days")),
    el("label", { class: "check" }, everything, el("span", {}, "All my hard drives and USB sticks ", el("small", { class: "note" }, "(takes minutes; otherwise only Downloads, Desktop, Documents, Videos, Pictures and Music)"))),
    el("div", { class: "row" }, scanBtn, stopBtn),
    live, out);

  let last = null;
  async function scan() {
    busy(scanBtn, true, "Scanning…");
    stopBtn.hidden = false; live.hidden = false; live.textContent = "Starting…";
    try {
      const r = await api.cleanup_scan(Math.max(50, Math.round((+bigGb.value || 1) * 1024)), 90, everything.checked, +unusedDays.value || 30);
      if (r.error) return toast(r.error, 6000);
      last = r; draw();
    } finally { busy(scanBtn, false); stopBtn.hidden = true; live.hidden = true; }
  }

  const size = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
  function draw() {
    const r = last;
    const lists = ["big", "unused", "hidden", "folders", "old"].map((k) => r[k] ||= []);
    r.apps ||= [];
    const picked = new Set();
    const sum = el("b", {});
    const go = el("button", { type: "button", class: "danger", disabled: true }, "🗑 Remove what's ticked");
    const allRows = () => [...lists.flat(), ...r.dups.flatMap((g) => g.extra)];
    const count = () => {
      const all = allRows();
      const mb = [...picked].reduce((a, id) => a + (all.find((f) => f.id === id)?.mb || 0), 0);
      sum.textContent = picked.size ? `${picked.size} ticked · ${size(mb)}` : "Nothing ticked";
      go.disabled = !picked.size;
    };
    const row = (f, extra = "") => {
      const cb = el("input", { type: "checkbox", "aria-label": `Remove ${f.name}`, "data-id": f.id, onchange: () => {
        box.querySelectorAll(`input[data-id="${f.id}"]`).forEach((x) => { x.checked = cb.checked; });
        if (cb.checked) picked.add(f.id); else picked.delete(f.id);
        count();
      } });
      return el("li", {}, el("label", { class: "check" }, cb, el("span", {}, el("b", {}, (f.is_folder ? "📁 " : "") + f.name),
        el("small", { class: "note" }, ` ${size(f.mb)} · last used ${f.unused_days ?? f.days} days ago${extra}`),
        f.for_good ? el("small", { class: "warn" }, " · USB: deleted for good") : null,
        el("small", { class: "path", title: f.folder }, f.folder))));
    };
    const section = (title, list, empty, rows) => el("details", { open: list.length > 0 && list.length < 15 },
      el("summary", {}, `${title} (${list.length})`), list.length ? el("ul", { class: "cleanup-list" }, rows) : el("p", { class: "note" }, empty));
    const tickAll = (list) => el("button", { type: "button", class: "ghost small", onclick: () => {
      for (const f of list) { picked.add(f.id); box.querySelectorAll(`input[data-id="${f.id}"]`).forEach((x) => { x.checked = true; }); }
      count();
    } }, "Tick all");
    const withTick = (list) => [el("li", {}, tickAll(list)), ...list.map((f) => row(f))];
    go.onclick = async () => {
      const all = allRows().filter((f) => picked.has(f.id));
      const uniq = [...new Map(all.map((f) => [f.id, f])).values()];
      const forGood = uniq.filter((f) => f.for_good).length;
      const biggest = [...uniq].sort((a, b) => b.mb - a.mb).slice(0, 5).map((f) => `• ${f.name} (${size(f.mb)})`).join("\n");
      if (!confirm(`Remove ${sum.textContent}?\n\n${biggest}\n\nThey go to the Recycle Bin, so you can restore them.${forGood ? `\n\n⚠ ${forGood} on a USB stick will be DELETED FOR GOOD: USB sticks have no Recycle Bin.` : ""}\nIf one is too big for the Recycle Bin, Windows asks you first.`)) return;
      busy(go, true, "Removing…");
      try {
        const res = await api.cleanup_trash([...picked]);
        if (res.error) return toast(res.error, 6000);
        toast(`🧹 Removed ${res.moved}${res.mb ? ` (${size(res.mb)} in files)` : ""}.` + (res.failed.length ? ` ${res.failed.length} stayed: ${res.failed[0].why}` : ""), 7000);
        const gone = new Set([...picked].filter((id) => !res.failed.some((f) => f.id === id)));
        for (const k of ["big", "unused", "hidden", "folders", "old"]) r[k] = r[k].filter((f) => !gone.has(f.id));
        r.dups = r.dups.map((g) => ({ ...g, extra: g.extra.filter((f) => !gone.has(f.id)) })).filter((g) => g.extra.length);
        draw();
      } finally { busy(go, false); }
    };
    const dupFiles = r.dups.flatMap((g) => g.extra);
    out.replaceChildren(
      el("p", { class: "note" }, `${r.stopped ? "Stopped early. " : ""}Looked at ${r.files.toLocaleString()} files in ${Math.round(r.seconds)}s${r.drives?.length ? ` on ${r.drives.map((d) => `${d.path} (${d.free_gb} of ${d.total_gb} GB free${d.kind === "usb" ? ", USB" : ""})`).join(", ")}` : ""}. Up to ${size(r.total_mb)} could be freed.`),
      r.everything ? el("p", { class: "note" }, "“Last used” is a best guess: Windows doesn't always record when a file was opened. Look before you tick.") : null,
      section(`📦 Big files (over ${size(r.big_mb)})`, r.big, "No big files.", r.big.map((f) => row(f))),
      section(`🕸 Not used for over ${r.unused_days} days`, r.unused, "Nothing unused.", withTick(r.unused)),
      section("👻 Hidden and not used", r.hidden, "No hidden leftovers.", withTick(r.hidden)),
      section("📁 Big folders nobody has used", r.folders, "No big unused folders.", withTick(r.folders)),
      section(`⏳ Old downloads (over ${r.old_days} days)`, r.old, "No old downloads.", withTick(r.old)),
      section("👯 Duplicates (the oldest copy stays)", dupFiles, "No duplicate files.", [el("li", {}, tickAll(dupFiles)),
        ...r.dups.flatMap((g) => [el("li", { class: "keep" }, el("small", { class: "note" }, `✅ Keeping ${g.keep.name} in ${g.keep.folder}`)), ...g.extra.map((f) => row(f, " · copy"))])]),
      r.apps.length ? el("details", {}, el("summary", {}, `🔒 Inside installed apps and games (${r.apps.length})`),
        el("p", { class: "note" }, "Removing these would break the app or game, so there's nothing to tick. To get the space back, uninstall it."),
        el("ul", { class: "cleanup-list" }, r.apps.map((f) => el("li", {}, el("b", {}, f.name), el("small", { class: "note" }, ` ${size(f.mb)} · last used ${f.unused_days} days ago`), el("small", { class: "path", title: f.folder }, f.folder))))) : null,
      el("div", { class: "row cleanup-go" }, sum, go));
    count();
  }
  return {
    progress(e) { live.textContent = `${e.files.toLocaleString()} files so far… ${e.folder}`; },
  };
}
