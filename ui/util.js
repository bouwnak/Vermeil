// util.js - small helpers shared by the panels.

export const $ = (id) => document.getElementById(id);

// A missing optional piece (cond ? el(...) : null) must never show up as the word "null" on screen:
// append / replaceChildren / prepend / before / after simply skip null, undefined and false everywhere.
if (!Element.prototype.__nullSafe) {
  for (const P of [Element.prototype, DocumentFragment.prototype]) {
    for (const m of ["append", "prepend", "replaceChildren", "before", "after"]) {
      const orig = P[m];
      if (orig) P[m] = function (...a) { return orig.apply(this, a.filter((x) => x != null && x !== false)); };
    }
  }
  Element.prototype.__nullSafe = true;
}

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) n.append(c);
  return n;
}

export function toast(text, ms = 3500) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.hidden = true), ms);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Tiny, safe Markdown -> HTML for AI answers: headings, bold, italics, lists, code, tables, links. */
export function md(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  let list = null, code = null, table = null;
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" data-url="$2">$1</a>');
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeTable = () => { if (table) { out.push("</tbody></table>"); table = null; } };
  for (const line of lines) {
    if (code !== null) {
      if (line.startsWith("```")) { out.push(`<pre><code>${esc(code)}</code></pre>`); code = null; } else code += line + "\n";
      continue;
    }
    if (line.startsWith("```")) { closeList(); closeTable(); code = ""; continue; }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      if (!table) { out.push("<table><tbody>"); table = true; }
      out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`);
      continue;
    }
    closeTable();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    const ul = line.match(/^\s*[-*•]\s+(.*)/);
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)/);
    if (h) { closeList(); out.push(`<h4>${inline(h[2])}</h4>`); }
    else if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) { closeList(); out.push(ol && ol[1] !== "1" ? `<ol start="${+ol[1]}">` : `<${kind}>`); list = kind; }   // keep "2." "3." when the AI splits a list
      out.push(`<li>${inline(ul ? ul[1] : ol[2])}</li>`);
    } else if (!line.trim()) { closeList(); }
    else { closeList(); out.push(`<p>${inline(line)}</p>`); }
  }
  if (code !== null) out.push(`<pre><code>${esc(code)}</code></pre>`);
  closeList(); closeTable();
  return out.join("");
}

function sanitizeLatex(str) {
  return String(str || "")
    .replace(/\\mathbfr'/g, "\\mathbf{r}'")
    .replace(/\\mathbfr(?![a-zA-Z])/g, "\\mathbf{r}")
    .replace(/\\mathbf\s+([a-zA-Z])(?![a-zA-Z])/g, "\\mathbf{$1}")
    .replace(/\\vec\s+([a-zA-Z])(?![a-zA-Z])/g, "\\vec{$1}")
    .replace(/\\hat\s+([a-zA-Z])(?![a-zA-Z])/g, "\\hat{$1}")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Put Markdown into an element; links open in the real browser; LaTeX math is rendered via KaTeX. */
export function setMd(node, text, api) {
  if (!node) return;
  if (!text) { node.innerHTML = ""; return; }
  let raw = String(text).replace(/\r/g, "");

  // Extract and protect math equations before Markdown escaping
  const mathTokens = [];
  const tokenFor = (math, display) => {
    const idx = mathTokens.length;
    mathTokens.push({ math: sanitizeLatex(math), display });
    return `%%%KATEX_BLOCK_${idx}%%%`;
  };

  // 1. Display math $$...$$ and \[...\]
  raw = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => tokenFor(m, true));
  raw = raw.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => tokenFor(m, true));

  // 2. Inline math $...$ and \(...\)
  raw = raw.replace(/\$([^\$\n]+?)\$/g, (_, m) => tokenFor(m, false));
  raw = raw.replace(/\\\(([^\n]+?)\\\)/g, (_, m) => tokenFor(m, false));

  // 3. Standalone bare equations (lines with \mathbf, \frac, \sqrt without delimiters)
  raw = raw.replace(/(?:^|\n)\s*([^\n]*?\\(?:mathbf|frac|sqrt|vec|int|sum|partial|nabla|lim)\b[^\n]*)(?=\n|$)/g, (full, line) => {
    if (line.includes("%%%KATEX_BLOCK_")) return full;
    return "\n" + tokenFor(line.trim(), true) + "\n";
  });

  let html = md(raw);

  // Restore and render math tokens
  for (let i = 0; i < mathTokens.length; i++) {
    const { math, display } = mathTokens[i];
    let rendered = "";
    if (typeof window !== "undefined" && window.katex) {
      try {
        rendered = window.katex.renderToString(math.trim(), {
          displayMode: display,
          throwOnError: false,
        });
        if (display) rendered = `<div class="katex-display-wrap">${rendered}</div>`;
        else rendered = `<span class="katex-inline-wrap">${rendered}</span>`;
      } catch {
        rendered = display ? `<pre class="katex-fallback">${esc(math)}</pre>` : `<code>${esc(math)}</code>`;
      }
    } else {
      rendered = display ? `<pre class="katex-fallback">${esc(math)}</pre>` : `<code>${esc(math)}</code>`;
    }
    html = html.split(`%%%KATEX_BLOCK_${i}%%%`).join(rendered);
  }

  node.innerHTML = html;
  for (const a of node.querySelectorAll("a[data-url]")) {
    a.addEventListener("click", (e) => { e.preventDefault(); api?.open_url(a.dataset.url); });
  }
}

export function renderMath(node) {
  // Backwards compatibility hook
  if (!node || typeof window === "undefined" || !window.katex) return;
}

export function loadingCard(message = "Working…") {
  const c = document.createElement("div");
  c.className = "loading-card";
  c.innerHTML = `<div class="loading-spin"></div><p>${message}</p>`;
  return c;
}

export function setupDropZone(el, onDropFiles) {
  if (!el) return;
  el.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("drop-active"); });
  // Only clear when the pointer really leaves the box, not when it moves over a child (stops the flicker).
  el.addEventListener("dragleave", (e) => { e.preventDefault(); e.stopPropagation(); if (!el.contains(e.relatedTarget)) el.classList.remove("drop-active"); });
  el.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation(); el.classList.remove("drop-active");
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length && onDropFiles) onDropFiles(files, e);
  });
}

export function busy(button, on, label = "Working…") {
  if (on) { button.dataset.label = button.textContent; button.textContent = label; button.disabled = true; }
  else { button.textContent = button.dataset.label || button.textContent; button.disabled = false; }
}
