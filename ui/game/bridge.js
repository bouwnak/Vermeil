// bridge.js - talks to the Python game engine.
// Inside Vermeil: window.pywebview.api.game_<name>(...).  In a normal browser (testing): ?bridge -> POST /api/<name>
const params = new URLSearchParams(location.search);
const useHttp = params.has("bridge");

function pywebview() {
  return new Promise((resolve) => {
    if (window.pywebview?.api) return resolve(window.pywebview.api);
    window.addEventListener("pywebviewready", () => resolve(window.pywebview.api), { once: true });
    setTimeout(() => resolve(window.pywebview?.api || null), 4000);
  });
}

let apiP = null;
export async function call(name, ...args) {
  if (useHttp) {
    const r = await fetch(`/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });
    if (!r.ok) return { error: `server error ${r.status}` };
    return r.json();
  }
  apiP ||= pywebview();
  const api = await apiP;
  const fn = api && api[`game_${name}`];
  if (!fn) return { error: "The game engine isn't connected (open the game from Vermeil)." };
  try {
    return await fn(...args);
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

/** assistant-side calls (go back to the main app, read the look Vermeil wears) */
export async function appCall(name, ...args) {
  if (useHttp) return null;
  apiP ||= pywebview();
  const api = await apiP;
  try { return api?.[name] ? await api[name](...args) : null; } catch { return null; }
}

export const isTest = useHttp;
