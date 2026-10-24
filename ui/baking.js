// baking.js - Baking mode: recipe cards, a recipe page (ingredients with Convert / Alternative / edit, steps,
// nutrition facts per serving), importing a recipe from a website, and kitchen timers.
import { el, toast } from "./util.js";
import { alarm, stopAlarm } from "./fx.js";

const mmss = (s) => { s = Math.max(0, Math.ceil(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`; };

export function initBaking(api, kind = "baking") {
  const root = document.getElementById(kind === "cooking" ? "cookingBody" : "bakingBody");
  const word = kind === "cooking" ? "cook" : "bake";
  // every call names which recipe book it's for
  const A = {
    list: () => api.baking_list(kind), get: (id) => api.baking_get(id, kind), save: (r) => api.baking_save(r, kind),
    del: (id) => api.baking_delete(id, kind), imp: (u) => api.baking_import(u, kind), nutrition: (id) => api.baking_nutrition(id, kind),
    star: (id) => api.baking_star(id, kind), search: (q) => api.baking_search(q, kind),
  };
  let results = null, lastQuery = "", filter = "all";
  let tab = "recipes", openId = null, editing = false, recipe = null;
  const timers = [];                                   // {label, total, left, running, id}
  const checked = new Set();                           // ticked ingredients (just while you bake)

  // ---------------- tabs ----------------
  const tabs = el("nav", { class: "tabs", role: "tablist" });
  const show = (...nodes) => view.replaceChildren(...nodes.filter((n) => n != null && n !== false));
  const view = el("div", { class: "bake" });
  root.replaceChildren(tabs, view);
  function drawTabs() {
    const running = timers.filter((t) => t.running).length;
    tabs.replaceChildren(...[["recipes", "Recipes"], ["timer", running ? `Timer (${running})` : "Timer"]].map(([k, l]) =>
      el("button", { role: "tab", "aria-selected": String(k === tab), onclick: () => { tab = k; openId = null; load(); } }, l)));
  }

  async function load() {
    drawTabs();
    if (tab === "timer") return drawTimers();
    if (openId) return drawRecipe();
    return drawList();
  }

  // ---------------- recipe list (wide cards, like the sketch) ----------------
  async function drawList() {
    const list = await A.list();
    const url = el("input", { type: "url", placeholder: "…or paste a recipe link (website, YouTube, TikTok)", "aria-label": "Recipe link" });
    const importBtn = el("button", { class: "primary", type: "button" }, "Import");
    importBtn.addEventListener("click", async () => {
      if (!url.value.trim()) return url.focus();
      importBtn.disabled = true; importBtn.textContent = "Reading the page…";
      const r = await A.imp(url.value.trim());
      importBtn.disabled = false; importBtn.textContent = "Import";
      if (r.error) return toast(r.error, 6000);
      toast(`Imported: ${r.title}`); openId = r.id; load();
    });
    url.addEventListener("keydown", (e) => { if (e.key === "Enter") importBtn.click(); });
    const newBtn = el("button", { class: "ghost", type: "button", onclick: async () => {
      const r = await A.save({ title: "New recipe", ingredients: [], steps: [] });
      openId = r.id; editing = true; load();
    } }, "+ New recipe");
    // search the internet (recipe sites, YouTube, TikTok, Instagram)
    const q = el("input", { type: "search", placeholder: kind === "cooking" ? "Search recipes & videos (YouTube, TikTok, websites), e.g. adobo…" : "Search recipes & videos (YouTube, TikTok, websites), e.g. cookie…",
      "aria-label": "Search recipes online", value: lastQuery });
    const go = el("button", { class: "primary", type: "button" }, "Search");
    const doSearch = async () => {
      if (!q.value.trim()) return q.focus();
      lastQuery = q.value.trim(); go.disabled = true; go.textContent = "Searching…";
      const r = await A.search(lastQuery);
      go.disabled = false; go.textContent = "Search";
      if (r.error) return toast(r.error, 5000);
      results = r; filter = "all"; drawList();
    };
    go.addEventListener("click", doSearch);
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
    const ICON = { YouTube: "▶", TikTok: "♪", Instagram: "◎", Facebook: "f", Website: "🌐" };
    const FILTERS = [["all", "All"], ["video", "Videos"], ["YouTube", "YouTube"], ["TikTok", "TikTok"], ["Instagram", "Instagram"], ["Website", "Websites"]];
    const shown = (results || []).filter((r) => filter === "all" || (filter === "video" ? r.type !== "Website" : r.type === filter));
    const found = results ? el("div", { class: "search-results" },
      el("div", { class: "row sr-head" }, el("strong", {}, `${shown.length} recipes for "${lastQuery}"`),
        el("button", { class: "ghost small", type: "button", onclick: () => { results = null; drawList(); } }, "Clear")),
      el("div", { class: "chips sr-filters" }, ...FILTERS.filter(([k]) => k === "all" || k === "video" ? results.some((r) => k === "all" || r.type !== "Website") : results.some((r) => r.type === k))
        .map(([k, l]) => el("button", { class: "chip" + (filter === k ? " on" : ""), type: "button", onclick: () => { filter = k; drawList(); } },
          l, k === "all" ? "" : ` (${results.filter((r) => k === "video" ? r.type !== "Website" : r.type === k).length})`))),
      ...(shown.length ? shown.map((r) => {
        const saveBtn = el("button", { class: "primary small", type: "button" }, "★ Save recipe");
        saveBtn.addEventListener("click", async () => {
          saveBtn.disabled = true; saveBtn.textContent = "Reading it…";
          const res = await A.imp(r.url);
          if (res.error) { saveBtn.disabled = false; saveBtn.textContent = "★ Save recipe"; return toast(res.error, 6000); }
          if (!res.saved) await A.star(res.id);
          saveBtn.textContent = "✓ Saved"; toast(`Saved: ${res.title}`);
        });
        const thumb = r.thumb ? el("button", { class: "sr-thumb", type: "button", title: "Watch", style: `background-image:url("${r.thumb.replace(/"/g, "%22")}")`, onclick: () => api.open_url(r.url) },
          r.type !== "Website" ? el("span", { class: "sr-play" }, "▶") : null) : null;
        return el("div", { class: "sr" },
          thumb || el("span", { class: "sr-type t-" + r.type.toLowerCase() }, ICON[r.type] || "•", " ", r.type),
          el("div", { class: "sr-main" }, el("strong", {}, r.title), el("small", {}, thumb ? el("span", { class: "sr-type t-" + r.type.toLowerCase() }, ICON[r.type] || "•", " ", r.type) : null, " ", r.site),
            r.snippet ? el("p", {}, r.snippet) : null),
          el("div", { class: "sr-btns" }, el("button", { class: "ghost small", type: "button", onclick: () => api.open_url(r.url) }, r.type === "Website" ? "Open" : "▶ Watch"), saveBtn));
      }) : [el("p", { class: "note" }, "Nothing found - try other words.")])) : null;

    show(
      el("div", { class: "bake-import" }, q, go),
      found,
      el("h4", { class: "bake-h" }, "My recipes"),
      el("div", { class: "bake-import" }, url, importBtn),
      el("div", { class: "recipe-cards" }, ...list.map((r) => {
        const pic = el("span", { class: "rc-pic" + (r.image ? "" : " empty") });
        if (r.image) pic.style.backgroundImage = `url("${r.image.replace(/"/g, "%22")}")`;
        else if (!r.image_tried && api.baking_find_image) {            // look for a photo once, in the background
          pic.classList.add("loading");
          api.baking_find_image(r.id, kind).then((x) => { pic.classList.remove("loading"); if (x?.image) { pic.classList.remove("empty"); pic.style.backgroundImage = `url("${x.image.replace(/"/g, "%22")}")`; } });
        }
        const del = el("button", { class: "rc-del", type: "button", title: "Delete this recipe", "aria-label": `Delete ${r.title}`, onclick: async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete "${r.title}"?`)) return;
          await A.del(r.id); toast(`Deleted: ${r.title}`); drawList();
        } }, "🗑");
        return el("div", { class: "recipe-card", role: "button", tabindex: 0, onclick: () => { openId = r.id; editing = false; checked.clear(); load(); },
          onkeydown: (e) => { if (e.key === "Enter") e.currentTarget.click(); } }, del,
          el("span", { class: "rc-text" },
            el("span", { class: "rc-title" }, r.saved ? "★ " : "", r.title),
            el("span", { class: "rc-meta" }, [r.count + " ingredients", r.servings ? r.servings + " servings" : "", r.source ? new URL(r.source).hostname.replace("www.", "") : ""].filter(Boolean).join(" · "))),
          pic);
      })),
      list.length ? null : el("p", { class: "note" }, "No recipes yet - paste a link above or make a new one."),
      newBtn);
  }

  // ---------------- one recipe ----------------
  async function drawRecipe() {
    recipe = await A.get(openId);
    if (recipe.error) { openId = null; return load(); }
    const save = async () => { recipe = await A.save(recipe); };
    const head = el("div", { class: "bake-head" },
      el("button", { class: "ghost small", type: "button", onclick: () => { openId = null; load(); } }, "← Recipes"),
      editing
        ? el("input", { class: "bake-title-input", value: recipe.title, onchange: async (e) => { recipe.title = e.target.value; await save(); } })
        : el("h3", { class: "bake-title" }, recipe.title),
      el("button", { class: recipe.saved ? "primary small" : "ghost small", type: "button", title: "Saved recipes stay at the top",
        onclick: async () => { recipe = await A.star(recipe.id); toast(recipe.saved ? "Recipe saved ★" : "Removed from saved"); drawRecipe(); } }, recipe.saved ? "★ Saved" : "☆ Save recipe"),
      el("button", { class: editing ? "primary small" : "ghost small", type: "button", onclick: () => { editing = !editing; drawRecipe(); } }, editing ? "Done editing" : "Edit"),
      el("button", { class: "danger small", type: "button", title: "Delete this recipe", onclick: async () => {
        if (!confirm(`Delete "${recipe.title}"?`)) return;
        await A.del(recipe.id); toast(`Deleted: ${recipe.title}`); openId = null; load();
      } }, "Delete"));
    const meta = el("p", { class: "note" }, [recipe.servings ? `${recipe.servings} servings` : "", recipe.source ? "from " + new URL(recipe.source).hostname.replace("www.", "") : ""].filter(Boolean).join(" · "));

    // ingredients
    const ing = el("ul", { class: "ingredients" });
    for (const it of recipe.ingredients) ing.append(ingredientRow(it, save));
    if (editing) {
      const add = el("input", { placeholder: "Add an ingredient, e.g. 1 cup milk", "aria-label": "New ingredient" });
      const addIt = async () => {
        if (!add.value.trim()) return;
        recipe.ingredients.push(await api.baking_parse(add.value.trim())); add.value = "";
        await save(); drawRecipe();
      };
      add.addEventListener("keydown", (e) => { if (e.key === "Enter") addIt(); });
      ing.append(el("li", { class: "ing-add" }, add, el("button", { class: "ghost small", type: "button", onclick: addIt }, "+ Add")));
    }

    // instructions
    const steps = el("ol", { class: "steps" });
    recipe.steps.forEach((st, i) => {
      steps.append(el("li", {},
        el("span", { class: "step-no" }, String(i + 1)),
        editing ? el("textarea", { rows: 2, onchange: async (e) => { recipe.steps[i] = e.target.value; await save(); } }, st) : el("span", {}, st),
        editing ? el("button", { class: "ing-x", type: "button", title: "Remove step", onclick: async () => { recipe.steps.splice(i, 1); await save(); drawRecipe(); } }, "×") : null,
        !editing && /(\d+)\s*(?:to\s*\d+\s*)?min/i.test(st) ? el("button", { class: "ghost small", type: "button", onclick: () => {
          const m = st.match(/(\d+)\s*(?:to\s*(\d+)\s*)?min/i); startTimer(Number(m[2] || m[1]) * 60, `Step ${i + 1}`); toast(`Timer started: ${m[2] || m[1]} min`);
        } }, "⏱ Start timer") : null));
    });
    if (editing) {
      const add = el("textarea", { rows: 2, placeholder: "Add a step…" });
      steps.append(el("li", { class: "ing-add" }, add, el("button", { class: "ghost small", type: "button", onclick: async () => {
        if (add.value.trim()) { recipe.steps.push(add.value.trim()); await save(); drawRecipe(); } } }, "+ Add step")));
    }

    // nutrition facts per serving (last)
    const n = recipe.nutrition;
    const nut = el("div", { class: "nutrition" },
      el("div", { class: "nut-head" }, el("strong", {}, "Nutrition Facts"), el("span", { class: "note" }, n ? `per serving${n.servings ? ` (${n.servings} servings)` : ""} · ${n.source || ""}` : "")),
      n?.rows?.length ? el("table", {}, ...n.rows.map((r) => el("tr", {}, el("td", {}, r.label), el("td", {}, r.value))))
        : el("p", { class: "note" }, "Not worked out yet."),
      el("button", { class: "ghost small", type: "button", onclick: async (e) => {
        e.target.disabled = true; e.target.textContent = "Working it out…";
        const r = await A.nutrition(recipe.id);
        if (r.error) toast(r.error, 5000); else recipe = r;
        drawRecipe();
      } }, n ? "Recalculate" : "Work out nutrition"));

    const photo = recipe.image ? el("div", { class: "bake-photo", style: `background-image:url("${recipe.image.replace(/"/g, "%22")}")` }) : null;
    let photoEdit = null;
    if (editing) {
      const file = el("input", { type: "file", accept: "image/*", hidden: true });
      file.addEventListener("change", () => {
        const f = file.files[0]; if (!f) return;
        const img = new Image();
        img.onload = async () => {                                   // shrink it so it's quick to save and load
          const k = Math.min(1, 640 / Math.max(img.width, img.height)), c = document.createElement("canvas");
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          recipe.image = c.toDataURL("image/jpeg", 0.82); await save(); drawRecipe();
        };
        img.src = URL.createObjectURL(f);
      });
      const link = el("input", { type: "url", placeholder: "…or paste an image link" });
      link.addEventListener("change", async () => { if (/^https?:\/\//.test(link.value)) { recipe.image = link.value.trim(); await save(); drawRecipe(); } });
      photoEdit = el("div", { class: "bake-import" }, el("button", { class: "ghost small", type: "button", onclick: () => file.click() }, "Change photo"), link, file,
        recipe.image ? el("button", { class: "ghost small", type: "button", onclick: async () => { recipe.image = ""; recipe.image_tried = true; await save(); drawRecipe(); } }, "Remove photo") : null);
    }
    const src = recipe.source ? el("button", { class: "ghost small", type: "button", onclick: () => api.open_url(recipe.source) }, "Open the original ↗") : null;
    show(head, photo, photoEdit, meta, src, recipe.notes ? el("p", { class: "note" }, recipe.notes) : null,
      el("h4", { class: "bake-h" }, "Ingredients"), ing,
      el("h4", { class: "bake-h" }, "Instructions"), steps,
      nut,
      editing ? el("button", { class: "danger", type: "button", onclick: async () => {
        if (!confirm(`Delete "${recipe.title}"?`)) return;
        await A.del(recipe.id); openId = null; load();
      } }, "Delete this recipe") : null);
  }

  function ingredientRow(it, save) {
    const li = el("li", { class: "ing" });
    const info = el("div", { class: "ing-info" });
    const draw = () => {
      const box = el("input", { type: "checkbox", "aria-label": `Got ${it.name}` });
      box.checked = checked.has(it.id);
      box.addEventListener("change", () => { box.checked ? checked.add(it.id) : checked.delete(it.id); li.classList.toggle("done", box.checked); });
      li.classList.toggle("done", checked.has(it.id));
      const text = editing
        ? el("input", { class: "ing-edit", value: it.text, onchange: async (e) => {
            const p = await api.baking_parse(e.target.value); Object.assign(it, p, { id: it.id }); await save(); } })
        : el("span", { class: "ing-text" }, it.text);
      const convert = el("button", { class: "ghost tiny", type: "button", onclick: async () => {
        const list = await api.baking_convert(it.qty, it.unit, it.name);
        info.replaceChildren(list.length ? el("div", { class: "conv" }, el("small", {}, "Same as:"), ...list.map((c) => el("span", { class: "chip" }, c.label)))
          : el("small", { class: "note" }, "No conversion for this one (no amount or unit)."));
        info.hidden = false;
      } }, "Convert");
      const alt = el("button", { class: "ghost tiny", type: "button", onclick: async () => {
        info.replaceChildren(el("small", { class: "note" }, "Looking for substitutes…")); info.hidden = false;
        const r = await api.baking_alternatives(it.name);
        info.replaceChildren(r.options.length ? el("ul", { class: "alts" }, el("small", {}, "Instead you can use:"), ...r.options.map((o) => el("li", {}, o)))
          : el("small", { class: "note" }, "I don't know a good substitute for this one."));
      } }, "Alternative");
      const del = editing ? el("button", { class: "ing-x", type: "button", title: "Remove", onclick: async () => {
        recipe.ingredients = recipe.ingredients.filter((x) => x.id !== it.id); await save(); drawRecipe(); } }, "×") : null;
      li.replaceChildren(el("div", { class: "ing-row" }, box, text, el("span", { class: "ing-btns" }, convert, alt, del)), info);
    };
    info.hidden = true;
    draw();
    return li;
  }

  // ---------------- kitchen timers ----------------
  function startTimer(seconds, label = "Timer") {
    const t = { label, total: seconds, left: seconds, running: true, id: null, end: Date.now() + seconds * 1000 };
    tick(t); timers.push(t); drawTabs(); if (tab === "timer") drawTimers();
  }
  function tick(t) {
    clearInterval(t.id);
    t.id = setInterval(() => {
      t.left = (t.end - Date.now()) / 1000;
      if (t.left <= 0) {
        clearInterval(t.id); t.running = false; t.left = 0;
        alarm(); toast(`⏰ ${t.label} is done! (tap anywhere to stop the alarm)`, 8000);
      }
      if (tab === "timer") drawTimers(true); else drawTabs();
    }, 250);
  }
  function drawTimers(quick = false) {
    if (quick && view.querySelector(".timer-list")) {
      view.querySelectorAll(".bt-time").forEach((n, i) => { n.textContent = mmss(timers[i]?.left ?? 0); });
      view.querySelectorAll(".bt-bar i").forEach((n, i) => { const t = timers[i]; if (t) n.style.width = `${100 - (t.left / t.total) * 100}%`; });
      return;
    }
    const name = el("input", { placeholder: kind === "cooking" ? "What is it? (e.g. Rice, Adobo simmering)" : "What is it? (e.g. Cookies in the oven)", "aria-label": "Timer name" });
    const min = el("input", { type: "number", min: 0, max: 600, value: 12, "aria-label": "Minutes", style: "width:80px" });
    const sec = el("input", { type: "number", min: 0, max: 59, value: 0, "aria-label": "Seconds", style: "width:70px" });
    const quick5 = [5, 10, 12, 15, 20, 30, 45, 60].map((m) => el("button", { class: "chip", type: "button", onclick: () => startTimer(m * 60, name.value.trim() || `${m} min`) }, `${m} min`));
    show(
      el("div", { class: "row" }, name),
      el("div", { class: "row" }, min, el("span", {}, "min"), sec, el("span", {}, "sec"),
        el("button", { class: "primary", type: "button", onclick: () => { const s = Number(min.value) * 60 + Number(sec.value); if (s > 0) startTimer(s, name.value.trim() || "Timer"); } }, "Start")),
      el("div", { class: "chips" }, ...quick5),
      el("div", { class: "timer-list" }, ...timers.map((t, i) => el("div", { class: "bake-timer" + (t.left <= 0 ? " done" : "") },
        el("div", { class: "row" }, el("strong", {}, t.label), el("span", { class: "bt-time" }, mmss(t.left))),
        el("div", { class: "bt-bar meter" }, el("i", { style: `width:${100 - (t.left / t.total) * 100}%` })),
        el("div", { class: "row" },
          t.left > 0 ? el("button", { class: "ghost small", type: "button", onclick: () => {
            if (t.running) { clearInterval(t.id); t.running = false; } else { t.end = Date.now() + t.left * 1000; t.running = true; tick(t); }
            drawTimers(); drawTabs();
          } }, t.running ? "Pause" : "Resume") : null,
          el("button", { class: "ghost small", type: "button", onclick: () => { t.end += 60000; t.left += 60; t.total += 60; if (!t.running && t.left > 0) { t.running = true; tick(t); } drawTimers(); } }, "+1 min"),
          el("button", { class: "ghost small", type: "button", onclick: () => { clearInterval(t.id); timers.splice(i, 1); stopAlarm(); drawTimers(); drawTabs(); } }, "Remove"))))),
      timers.length ? null : el("p", { class: "note" }, "You can run several timers at once. Steps that mention minutes also get a ⏱ button."));
  }

  return { load, status: () => ({ timers: timers.filter((t) => t.running).length }), startTimer };
}
