// cleanup.js - Settings > General > 🧹 Clean-up wizard: finds big files, old downloads and duplicate files.
// Nothing goes on its own: you tick what to remove, confirm, and it moves to the Recycle Bin (skills/cleanup.py).
import { $, el, toast, busy } from "./util.js";

export function initCleanup(api) {
  const box = $("cleanupBox");
  if (!box) return;
  const bigMb = el("input", { type: "number", min: "50", max: "20000", value: "500", class: "tiny", "aria-label": "Big file size in MB" });
  const oldDays = el("input", { type: "number", min: "7", max: "3650", value: "90", class: "tiny", "aria-label": "Old download age in days" });
  const out = el("div", { class: "cleanup-out" });
  const scanBtn = el("button", { type: "button", class: "primary", onclick: scan }, "🔍 Scan my folders");
  box.replaceChildren(
    el("p", { class: "note" }, "Looks in Downloads, Desktop, Documents, Videos, Pictures and Music. It skips Vermeil's own folder, your dnd folder, voice models and system folders. You choose what goes; it goes to the Recycle Bin, so you can still restore it."),
    el("div", { class: "row" }, el("label", {}, "Big files from ", bigMb, " MB"), el("label", {}, "Downloads older than ", oldDays, " days"), scanBtn),
    out);

  let last = null;
  async function scan() {
    busy(scanBtn, true, "Scanning… (can take a minute)");
    try {
      const r = await api.cleanup_scan(+bigMb.value || 500, +oldDays.value || 90);
      if (r.error) return toast(r.error, 6000);
      last = r; draw();
    } finally { busy(scanBtn, false); }
  }

  function draw() {
    const r = last;
    const picked = new Set();
    const sum = el("b", {});
    const go = el("button", { type: "button", class: "danger", disabled: true }, "🗑 Move to the Recycle Bin");
    const count = () => {
      const all = [...r.big, ...r.old, ...r.dups.flatMap((g) => g.extra)];
      const mb = [...new Set(all.filter((f) => picked.has(f.id)).map((f) => f.id))].reduce((a, id) => a + all.find((f) => f.id === id).mb, 0);
      sum.textContent = picked.size ? `${picked.size} files · ${mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`}` : "Nothing ticked";
      go.disabled = !picked.size;
    };
    const size = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
    const row = (f, extra = "") => {
      const cb = el("input", { type: "checkbox", "aria-label": `Remove ${f.name}`, "data-id": f.id, onchange: () => {
        box.querySelectorAll(`input[data-id="${f.id}"]`).forEach((x) => { x.checked = cb.checked; });
        if (cb.checked) picked.add(f.id); else picked.delete(f.id);
        count();
      } });
      return el("li", {}, el("label", { class: "check" }, cb, el("span", {}, el("b", {}, f.name), el("small", { class: "note" }, ` ${size(f.mb)} · ${f.days} days old${extra}`),
        el("small", { class: "path", title: f.folder }, f.folder))));
    };
    const section = (title, list, empty, rows) => el("details", { open: list.length > 0 && list.length < 15 },
      el("summary", {}, `${title} (${list.length})`), list.length ? el("ul", { class: "cleanup-list" }, rows) : el("p", { class: "note" }, empty));
    const tickAll = (list) => el("button", { type: "button", class: "ghost small", onclick: () => {
      for (const f of list) { picked.add(f.id); box.querySelectorAll(`input[data-id="${f.id}"]`).forEach((x) => { x.checked = true; }); }
      count();
    } }, "Tick all");
    go.onclick = async () => {
      if (!confirm(`Move ${sum.textContent} to the Recycle Bin? You can restore them from there.`)) return;
      busy(go, true, "Moving…");
      try {
        const res = await api.cleanup_trash([...picked]);
        if (res.error) return toast(res.error, 6000);
        toast(`🧹 Moved ${res.moved} files (${size(res.mb)}) to the Recycle Bin.` + (res.failed.length ? ` ${res.failed.length} stayed: ${res.failed[0].why}` : ""), 7000);
        const gone = new Set([...picked].filter((id) => !res.failed.some((f) => f.id === id)));
        r.big = r.big.filter((f) => !gone.has(f.id)); r.old = r.old.filter((f) => !gone.has(f.id));
        r.dups = r.dups.map((g) => ({ ...g, extra: g.extra.filter((f) => !gone.has(f.id)) })).filter((g) => g.extra.length);
        draw();
      } finally { busy(go, false); }
    };
    const dupFiles = r.dups.flatMap((g) => g.extra);
    out.replaceChildren(
      el("p", { class: "note" }, `Looked at ${r.files.toLocaleString()} files in ${r.seconds}s. Up to ${size(r.total_mb)} could be freed.`),
      section(`📦 Big files (over ${r.big_mb} MB)`, r.big, "No big files.", r.big.map((f) => row(f))),
      section(`⏳ Old downloads (over ${r.old_days} days)`, r.old, "No old downloads.", [el("li", {}, tickAll(r.old)), ...r.old.map((f) => row(f))]),
      section("👯 Duplicates (the oldest copy stays)", dupFiles, "No duplicate files.", [el("li", {}, tickAll(dupFiles)),
        ...r.dups.flatMap((g) => [el("li", { class: "keep" }, el("small", { class: "note" }, `✅ Keeping ${g.keep.name} in ${g.keep.folder}`)), ...g.extra.map((f) => row(f, " · copy"))])]),
      el("div", { class: "row cleanup-go" }, sum, go));
    count();
  }
}
