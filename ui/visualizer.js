// visualizer.js - the music visualizer: bars on the room's Smart TV and lamps that pulse to the beat.
// The players tell it what's playing (beat.set), it asks Python once per song for the tempo (gamenight.song_bpm)
// and makes a beat from that. It doesn't hear the real sound, so it's a show that keeps time, not an analyser.

let api = null;
const bpmCache = new Map();
const on = (() => { try { return localStorage.getItem("vermeil.viz") !== "0"; } catch { return true; } })();

export const beat = {
  enabled: on,
  sources: {},                     // "vermeil" / "spotify" -> { title, artist, since }
  bpm: 110,
  t0: performance.now() / 1000,

  useApi(a) { api = a; },
  setEnabled(v) {
    this.enabled = !!v;
    try { localStorage.setItem("vermeil.viz", v ? "1" : "0"); } catch { /* private mode */ }
  },
  /** a player says what it plays now (null = stopped / paused) */
  set(source, info) {
    const was = this.sources[source];
    if (!info) { delete this.sources[source]; return; }
    const key = `${info.title}|${info.artist || ""}`;
    if (was?.key === key) return;
    this.sources[source] = { ...info, key };
    this.t0 = performance.now() / 1000 - (info.pos || 0);
    this._tempo(info.title, info.artist || "");
  },
  async _tempo(title, artist) {
    const key = `${title}|${artist}`;
    if (bpmCache.has(key)) { this.bpm = bpmCache.get(key); return; }
    try {
      const r = await api?.gn_bpm(title, artist);
      if (r?.bpm) { bpmCache.set(key, r.bpm); this.bpm = r.bpm; }
    } catch { /* keep the last tempo */ }
  },
  get playing() { return Object.keys(this.sources).length > 0; },
  get active() { return this.enabled && this.playing; },
  get now() { return Object.values(this.sources)[0] || null; },
  /** 0..1: high right on the beat, falls off before the next one */
  level(t = performance.now() / 1000) {
    const ph = ((t - this.t0) * this.bpm / 60) % 1;
    return Math.exp(-ph * 5);
  },
  /** n bar heights 0..1 (bass on the left follows the beat, the rest wobbles) */
  bands(n, t = performance.now() / 1000) {
    const b = this.level(t), out = [];
    for (let i = 0; i < n; i++) {
      const f = i / n;
      const wob = 0.5 + 0.5 * Math.sin(t * (3 + i * 1.7) + i * 2.3) * Math.sin(t * (1.3 + f * 4) + i);
      out.push(Math.max(0.04, Math.min(1, (1 - f) * b * 0.9 + wob * (0.25 + f * 0.45) + 0.05)));
    }
    return out;
  },
};
