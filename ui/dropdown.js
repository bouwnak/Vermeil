// dropdown.js - every dropdown (<select>) opens DOWNWARD.
// The browser's own list flips upward when the box is near the bottom of the window. This shows our own list right
// under the box instead: if there isn't enough room below, the panel the box is in scrolls up first.
// The real <select> stays (its value, "change" events and the keyboard all work as before); only the click opens ours.

const MIN_ROOM = 220;      // px the list wants below the box
let open = null;           // { sel, list }

function close() {
  if (!open) return;
  open.list.remove();
  open.sel.classList.remove("dd-open");
  open = null;
}

function scroller(n) {
  for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement;
}

function show(sel) {
  close();
  const below = innerHeight - sel.getBoundingClientRect().bottom - 8;
  if (below < MIN_ROOM) {                                   // make room under it by scrolling its panel
    const box = scroller(sel);
    if (box) box.scrollTop += MIN_ROOM - below;
  }
  const list = document.createElement("div");
  list.className = "dd-list";
  list.setAttribute("role", "listbox");
  const add = (opt) => {
    const item = document.createElement("div");
    item.className = "dd-item" + (opt.selected ? " on" : "") + (opt.disabled ? " off" : "");
    item.textContent = opt.textContent;
    item.setAttribute("role", "option");
    if (!opt.disabled) item.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (sel.value !== opt.value) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      close();
      sel.focus();
    });
    return item;
  };
  for (const child of sel.children) {
    if (child.tagName === "OPTGROUP") {
      const h = document.createElement("div");
      h.className = "dd-group";
      h.textContent = child.label;
      list.append(h, ...[...child.children].map(add));
    } else if (child.tagName === "OPTION" && !child.hidden) list.append(add(child));
  }
  document.body.append(list);
  sel.classList.add("dd-open");
  open = { sel, list };
  place();
  list.querySelector(".on")?.scrollIntoView({ block: "nearest" });
}

/** put the list right under its box (again after the panel scrolls) */
function place() {
  const { sel, list } = open, r = sel.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return close();
  Object.assign(list.style, { left: `${Math.max(4, Math.min(r.left, innerWidth - 4 - list.offsetWidth))}px`, top: `${r.bottom + 2}px`,
    minWidth: `${r.width}px`, maxHeight: `${Math.min(360, Math.max(120, innerHeight - r.bottom - 10))}px` });
}

export function initDropdowns() {
  document.addEventListener("mousedown", (e) => {
    const sel = e.target.closest?.("select");
    if (open && !e.target.closest(".dd-list")) {
      const same = open.sel === sel;
      close();
      if (same) { e.preventDefault(); return; }             // a 2nd click on the box closes it
    }
    if (!sel || sel.multiple || sel.size > 1 || sel.disabled || e.button !== 0) return;
    e.preventDefault();                                      // no browser list (it might open upward)
    sel.focus();
    show(sel);
  }, true);
  document.addEventListener("keydown", (e) => { if (open && (e.key === "Escape" || e.key === "Tab")) close(); }, true);
  addEventListener("resize", close);
  document.addEventListener("scroll", (e) => { if (open && !open.list.contains(e.target)) place(); }, true);
}
