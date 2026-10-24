// psp.js - PSP-style menu sound, shared by the main room and the Games hub: a calm background tune and little
// UI sounds (a tick when you point at something, a click, a chime when something opens).
// Everything is made in the browser - no music files. Each page gets its own copy of this module.

let ac = null, master = null, musicBus = null, duckBus = null, sfxBus = null;
let musicVol = 0.6, sfxVol = 0.5, duckLevel = 1, muted = false;

function audio() {
  if (ac) return ac;
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return null;
  ac = new C();
  // a gentle compressor so the soft tune is still heard on laptop speakers, without ever getting harsh
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -22; comp.knee.value = 18; comp.ratio.value = 3.5; comp.attack.value = 0.02; comp.release.value = 0.4;
  master = ac.createGain(); master.gain.value = muted ? 0 : 1;
  master.connect(comp); comp.connect(ac.destination);
  duckBus = ac.createGain(); duckBus.gain.value = duckLevel; duckBus.connect(master);
  musicBus = ac.createGain(); musicBus.gain.value = 0; musicBus.connect(duckBus);
  sfxBus = ac.createGain(); sfxBus.gain.value = sfxVol; sfxBus.connect(master);
  return ac;
}

/** browsers only allow sound after you've touched the page; the first click or key press wakes the sound up */
export function unlock() {
  if (!audio()) return;
  if (ac.state === "suspended") ac.resume().catch(() => {});
}
for (const ev of ["pointerdown", "keydown", "touchstart"]) addEventListener(ev, unlock, { capture: true, passive: true });

// ---------------- instruments ----------------
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** a soft pad: a triangle plus a quiet octave, slow attack, long fade */
function pad(bus, freq, when, dur, vol) {
  const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), g2 = ac.createGain();
  o.type = "triangle"; o.frequency.value = freq;
  o2.type = "sine"; o2.frequency.value = freq * 2.003; g2.gain.value = 0.22;
  o.connect(g); o2.connect(g2); g2.connect(g); g.connect(bus);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + Math.min(1.2, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.start(when); o2.start(when); o.stop(when + dur + 0.05); o2.stop(when + dur + 0.05);
}

/** a bell / electric piano: a sine with a little FM shimmer that fades away (the PSP "glass" sound) */
function bell(bus, freq, when, dur, vol, bright = 1) {
  const o = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
  o.type = "sine"; o.frequency.value = freq;
  mod.type = "sine"; mod.frequency.value = freq * 3.5;
  mg.gain.setValueAtTime(freq * 1.2 * bright, when);
  mg.gain.exponentialRampToValueAtTime(freq * 0.02 + 0.01, when + Math.min(dur, 0.8));
  mod.connect(mg); mg.connect(o.frequency); o.connect(g); g.connect(bus);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.start(when); mod.start(when); o.stop(when + dur + 0.05); mod.stop(when + dur + 0.05);
}

/** a plain sine, for the low root and for the UI ticks */
function sine(bus, freq, when, dur, vol, attack = 0.01) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "sine"; o.frequency.value = freq;
  o.connect(g); g.connect(bus);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.start(when); o.stop(when + dur + 0.05);
}

/** a soft pluck (kalimba / lo-fi guitar): a triangle that dies away quickly */
function pluck(bus, freq, when, dur, vol) {
  const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o.type = "sawtooth"; o.frequency.value = freq;
  f.type = "lowpass"; f.Q.value = 0.7;
  f.frequency.setValueAtTime(freq * 6, when); f.frequency.exponentialRampToValueAtTime(freq * 1.2, when + 0.25);
  o.connect(f); f.connect(g); g.connect(bus);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol * 0.8, when + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, when + Math.min(dur, 0.9));
  o.start(when); o.stop(when + dur + 0.05);
}

/** a marimba: a sine plus its 4th harmonic that fades fast (wooden "tok") */
function marimba(bus, freq, when, dur, vol) {
  sine(bus, freq, when, Math.min(dur, 0.9), vol, 0.004);
  sine(bus, freq * 4, when, 0.12, vol * 0.35, 0.002);
}

/** a soft square wave, filtered so it sounds like an old handheld rather than a buzzer */
function chip(bus, freq, when, dur, vol) {
  const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o.type = "square"; o.frequency.value = freq;
  f.type = "lowpass"; f.frequency.value = Math.min(5000, freq * 4);
  o.connect(f); f.connect(g); g.connect(bus);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol * 0.45, when + 0.005);
  g.gain.setTargetAtTime(0.0001, when + Math.min(dur, 0.35) * 0.6, 0.06);
  o.start(when); o.stop(when + dur + 0.1);
}

let noiseBuf = null;
/** a tiny drum kit for the themes with a beat: a soft kick and a shaker */
function kick(bus, when, vol) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(110, when); o.frequency.exponentialRampToValueAtTime(42, when + 0.18);
  o.connect(g); g.connect(bus);
  g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
  o.start(when); o.stop(when + 0.35);
}
function noise() {
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function shaker(bus, when, vol) {
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noise(); f.type = "highpass"; f.frequency.value = 7000;
  s.connect(f); f.connect(g); g.connect(bus);
  g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
  s.start(when); s.stop(when + 0.1);
}

/** a warm low string (like a cello): a filtered sawtooth that swells in slowly */
function cello(bus, freq, when, dur, vol) {
  const o = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o.type = "sawtooth"; o.frequency.value = freq; o2.type = "sawtooth"; o2.frequency.value = freq * 1.004;
  f.type = "lowpass"; f.frequency.value = Math.min(1400, freq * 5); f.Q.value = 0.8;
  o.connect(f); o2.connect(f); f.connect(g); g.connect(bus);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol * 0.5, when + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur * 1.4);
  o.start(when); o2.start(when); o.stop(when + dur * 1.4 + 0.05); o2.stop(when + dur * 1.4 + 0.05);
}

/** a soft low "felt piano": a sine with a quiet 2nd harmonic and a muffled attack */
function felt(bus, freq, when, dur, vol) {
  sine(bus, freq, when, Math.min(dur, 1.6), vol, 0.008);
  sine(bus, freq * 2, when, 0.5, vol * 0.3, 0.006);
  sine(bus, freq * 3, when, 0.18, vol * 0.1, 0.004);
}

const LEADS = { bell, pluck, marimba, chip, cello, felt, box: (bus, f, w, d, v) => bell(bus, f, w, Math.min(d, 1.1), v, 1.8) };

// ---------------- the tunes ----------------
// chords are MIDI notes (60 = middle C). `scale` is what the melody picks from (a pentatonic, so it always sounds nice).
// lead = the melody instrument, beat = a soft kick + shaker, tone = how bright (the lowpass), padVol = how thick the chords are
const THEMES = {
  // the Games hub: bright and dreamy (Cmaj7, Am7, Fmaj7, G6)
  hub: { label: "Dreamy menu", bar: 4.4, chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 64]],
         scale: [72, 74, 76, 79, 81, 84, 86, 88], swing: 0.5, melody: 0.75 },
  // the room: warm and slow, like the PSP home screen at night (Dmaj9, Bm9, Gmaj9, A6/9)
  room: { label: "Night room", bar: 5.6, chords: [[62, 66, 69, 73, 76], [59, 62, 66, 69, 73], [55, 59, 62, 66, 69], [57, 61, 64, 66, 71]],
          scale: [74, 76, 78, 81, 83, 86, 88], swing: 0.35, melody: 0.55 },
  // rainy café: lo-fi plucks over a lazy beat (Ebmaj9, Cm9, Abmaj7, Bb6)
  lofi: { label: "Rainy café (lo-fi)", bar: 4.8, chords: [[63, 67, 70, 74], [60, 63, 67, 70, 74], [56, 60, 63, 67], [58, 62, 65, 67]],
          scale: [75, 77, 79, 82, 84, 87, 89], swing: 0.6, melody: 0.6, lead: "pluck", beat: true, tone: 1700, padVol: 0.06 },
  // sunrise: light and happy marimba (Gmaj7, Em7, Cmaj7, D6)
  sunrise: { label: "Sunrise (marimba)", bar: 4.0, chords: [[55, 59, 62, 66], [52, 55, 59, 62], [60, 64, 67, 71], [57, 62, 66, 69]],
             scale: [79, 81, 83, 86, 88, 91, 93], swing: 0.3, melody: 0.8, lead: "marimba", tone: 4200, padVol: 0.05 },
  // deep sea: very slow and spacious, mostly pads (Am9, Fmaj9, Dm9, Em7)
  ocean: { label: "Deep sea (ambient)", bar: 7.2, chords: [[57, 60, 64, 67, 71], [53, 57, 60, 64, 67], [50, 53, 57, 60, 64], [52, 55, 59, 62]],
           scale: [69, 72, 74, 76, 79, 81, 84], swing: 0, melody: 0.28, tone: 1500, padVol: 0.085 },
  // retro arcade: a cheerful handheld-game loop (C, F, Am, G)
  arcade: { label: "Retro arcade (chiptune)", bar: 3.2, chords: [[60, 64, 67], [53, 57, 60, 65], [57, 60, 64], [55, 59, 62, 67]],
            scale: [72, 74, 76, 79, 81, 84, 86], swing: 0, melody: 0.85, lead: "chip", beat: true, tone: 3600, padVol: 0.045 },
  // starlit garden: a little music box (Em9, Cmaj9, Am9, Bsus4)
  starlit: { label: "Starlit garden (music box)", bar: 5.0, chords: [[52, 55, 59, 62, 66], [48, 52, 55, 59, 62], [57, 60, 64, 67, 71], [59, 64, 66, 71]],
             scale: [76, 79, 81, 83, 86, 88, 91], swing: 0.4, melody: 0.65, lead: "box", tone: 3800, padVol: 0.055 },
  // --- three low, deep tunes ---
  // midnight drive: dark, slow synth with a low beat (Am9, Fmaj7, Dm9, E7sus4), one octave down
  midnight: { label: "Midnight drive (low)", bar: 4.8, chords: [[45, 48, 52, 55, 59], [41, 45, 48, 52], [38, 41, 45, 48, 52], [40, 45, 47, 50]],
              scale: [57, 60, 62, 64, 67, 69, 72], swing: 0.2, melody: 0.5, lead: "pluck", beat: true, tone: 1100, padVol: 0.075 },
  // cello room: slow low strings (Dm, Bbmaj7, Gm7, A7sus4)
  cello: { label: "Cello room (low)", bar: 6.4, chords: [[38, 45, 50, 53], [34, 41, 46, 50, 53], [43, 46, 50, 53], [33, 45, 50, 52]],
           scale: [50, 53, 55, 57, 60, 62, 65], swing: 0, melody: 0.4, lead: "cello", tone: 1000, padVol: 0.06 },
  // deep night piano: a soft felt piano, low and close (Cm9, Abmaj7, Ebmaj7, Bb6)
  felt: { label: "Deep night piano (low)", bar: 5.6, chords: [[48, 51, 55, 58, 62], [44, 48, 51, 55], [39, 46, 50, 55], [46, 50, 53, 55]],
          scale: [60, 63, 65, 67, 70, 72, 75], swing: 0.35, melody: 0.55, lead: "felt", tone: 1300, padVol: 0.065 },
};
/** the tunes you can pick in Settings: [[key, label], ...] */
export const THEME_LIST = Object.entries(THEMES).map(([k, t]) => [k, t.label]);
const SHUFFLE_BARS = 32;                                                   // "shuffle" picks a new tune about every 2-4 minutes

let theme = THEMES.hub, musicOn = false, nextBar = 0, bar = 0, timer = 0, chain = null, lastNote = 3, shuffle = false, wanted = "hub";

function makeChain() {
  // warm (lowpass) with a soft echo, so it sounds far away and calm
  const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200; lp.Q.value = 0.4;
  const dl = ac.createDelay(1.5); dl.delayTime.value = 0.38;
  const fb = ac.createGain(); fb.gain.value = 0.32;
  const wet = ac.createGain(); wet.gain.value = 0.35;
  const tone = ac.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 2400;
  lp.connect(musicBus); lp.connect(dl); dl.connect(tone); tone.connect(fb); fb.connect(dl); tone.connect(wet); wet.connect(musicBus);
  return lp;
}

function useTheme(t) {
  if (t === theme) return;
  theme = t; bar = 0; lastNote = 3;
  if (chain) chain.frequency.setTargetAtTime(t.tone || 3200, ac.currentTime, 0.8);
}

function scheduleBar(t0) {
  if (shuffle && bar >= SHUFFLE_BARS) {                                    // shuffle: move on to another tune
    const others = Object.values(THEMES).filter((t) => t !== theme && t !== THEMES.hub);
    useTheme(others[Math.floor(Math.random() * others.length)]);
  }
  const { bar: len, chords, scale, swing, melody } = theme;
  const lead = LEADS[theme.lead || "bell"], padVol = theme.padVol ?? 0.07;
  const ch = chords[bar % chords.length];
  for (const m of ch) pad(chain, hz(m), t0, len * 1.2, padVol);
  let root = ch[0] - 24;
  while (root < 31) root += 12;                                            // never below what speakers can play (~50 Hz)
  sine(chain, hz(root), t0, len * 1.05, 0.16, 0.4);                        // the low root
  bell(chain, hz(root + 12), t0, 2.2, 0.08, 0.6);                          // a soft "piano" hit on each new chord
  // a little melody: wanders step by step through the scale, on an 8-note grid, with space between phrases
  const steps = 8, quiet = bar % 4 === 3;                                  // every 4th bar breathes
  for (let i = 0; i < steps; i++) {
    if (quiet ? Math.random() > 0.2 : Math.random() > melody * (i % 2 ? 0.7 : 1)) continue;
    lastNote = Math.max(0, Math.min(scale.length - 1, lastNote + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
    const at = t0 + (i + (i % 2 ? swing * 0.25 : 0)) * (len / steps);
    lead(chain, hz(scale[lastNote]), at, 1.8, 0.075);
  }
  if (theme.beat && bar % 8 !== 7) {                                       // soft beat (it drops out every 8th bar)
    for (let i = 0; i < 4; i++) {
      const at = t0 + i * (len / 4);
      if (i % 2 === 0) kick(chain, at, 0.22);
      shaker(chain, at + (len / 8) * (1 + swing * 0.3), 0.05);
    }
  }
  // a high sparkle now and then
  if (Math.random() < 0.5) bell(chain, hz(ch[Math.floor(Math.random() * ch.length)] + 24), t0 + len * (0.5 + Math.random() * 0.4), 2.4, 0.03, 1.4);
}

function schedule() {
  if (!musicOn || !ac) return;
  while (nextBar < ac.currentTime + 1.5) { scheduleBar(nextBar); nextBar += theme.bar; bar++; }
}

/** start the background tune: "hub", "room", any THEME_LIST key, or "shuffle". If the page hasn't been touched yet
 *  it starts on the first click. Calling it again with another name switches tune at the next bar. */
export function musicStart(name) {
  if (!audio()) return;
  if (name && name !== wanted) {
    wanted = name;
    shuffle = name === "shuffle";
    if (shuffle) { const list = Object.values(THEMES).filter((t) => t !== THEMES.hub); useTheme(list[Math.floor(Math.random() * list.length)]); }
    else if (THEMES[name]) useTheme(THEMES[name]);
  }
  unlock();
  if (musicOn) return;
  if (!chain) { chain = makeChain(); chain.frequency.value = theme.tone || 3200; }
  musicOn = true;
  nextBar = Math.max(nextBar, ac.currentTime + 0.15);
  musicBus.gain.cancelScheduledValues(ac.currentTime);
  musicBus.gain.setTargetAtTime(musicVol, ac.currentTime, 1.0);           // fade in
  clearInterval(timer); timer = setInterval(schedule, 400); schedule();
}

export function musicStop(fade = 0.6) {
  if (!ac || !musicOn) return;
  musicOn = false;
  clearInterval(timer);
  musicBus.gain.cancelScheduledValues(ac.currentTime);
  musicBus.gain.setTargetAtTime(0, ac.currentTime, fade / 3);
}
export const musicPlaying = () => musicOn;

/** 0..1 */
export function setMusicVolume(v) {
  musicVol = Math.max(0, Math.min(1, Number(v) || 0));
  if (ac && musicOn) musicBus.gain.setTargetAtTime(musicVol, ac.currentTime, 0.1);
}
export function setSfxVolume(v) {
  sfxVol = Math.max(0, Math.min(1, Number(v) || 0));
  if (sfxBus) sfxBus.gain.setTargetAtTime(sfxVol, ac.currentTime, 0.05);
}
/** lower the music for a while (e.g. while she talks): 1 = normal, 0.25 = quiet */
export function duck(level = 1) {
  duckLevel = level;
  if (duckBus) duckBus.gain.setTargetAtTime(level, ac.currentTime, level < 1 ? 0.12 : 0.6);
}
export function setMuted(on) {
  muted = !!on;
  if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ac.currentTime, 0.05);
}
export const isMuted = () => muted;

// ---------------- UI sounds ----------------
// Five button-sound styles. Each press also lands on a slightly different note of a pentatonic scale, so clicking
// around sounds like a little tune instead of the same beep over and over. "mix" picks a style per press.
const STEP = [0, 2, 4, 7, 9];                                              // pentatonic offsets (semitones)
const up = (f, s) => f * Math.pow(2, s / 12);
function bubble(bus, f, t, dur, vol) {                                     // a rising "bloop"
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(f * 0.6, t); o.frequency.exponentialRampToValueAtTime(f * 1.25, t + dur * 0.6);
  o.connect(g); g.connect(bus);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.05);
}
const SFX_STYLES = {
  crystal: { label: "Crystal (PSP)", tone: (f, t, d, v) => bell(sfxBus, f, t, d, v, 0.5) },
  bubble: { label: "Bubbles", tone: (f, t, d, v) => bubble(sfxBus, f * 0.75, t, Math.min(d, 0.18), v * 1.2) },
  wood: { label: "Wood (marimba)", tone: (f, t, d, v) => marimba(sfxBus, f * 0.5, t, Math.min(d, 0.4), v * 1.3) },
  retro: { label: "Retro game", tone: (f, t, d, v) => chip(sfxBus, f * 0.5, t, Math.min(d, 0.12), v * 1.1) },
  chime: { label: "Wind chime", tone: (f, t, d, v) => bell(sfxBus, f * 1.5, t, d * 1.8, v * 0.7, 1.6) },
  // --- three low, soft ones ---
  lowwood: { label: "Deep wood (low)", tone: (f, t, d, v) => marimba(sfxBus, f * 0.25, t, Math.min(d, 0.45), v * 1.6) },
  thud: { label: "Soft thud (low)", tone: (f, t, d, v) => thud(sfxBus, f * 0.2, t, Math.min(d, 0.25), v * 1.8) },
  lowbell: { label: "Deep bell (low)", tone: (f, t, d, v) => bell(sfxBus, f * 0.25, t, d * 1.6, v * 1.3, 0.35) },
  // --- plain clicks, like a real button ---
  clickhigh: { label: "Click (high)", tone: (f, t, d, v) => click(sfxBus, f * 2.5, t, v * 1.4) },
  clicklow: { label: "Click (low)", tone: (f, t, d, v) => click(sfxBus, f * 0.35, t, v * 1.8) },
};
/** a short mechanical "tick": a burst of filtered noise with a tiny tone under it */
function click(bus, f, t, vol) {
  const s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noise(); bp.type = "bandpass"; bp.frequency.value = Math.min(9000, f * 2); bp.Q.value = 2.5;
  s.connect(bp); bp.connect(g); g.connect(bus);
  g.gain.setValueAtTime(vol * 1.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  s.start(t); s.stop(t + 0.04);
  sine(bus, f, t, 0.045, vol * 0.6, 0.001);
}
/** a soft low "boop" that drops in pitch, with a quiet overtone so it's still heard on small speakers */
function thud(bus, f, t, dur, vol) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + dur * 0.5);
  o.connect(g); g.connect(bus);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.05);
  sine(bus, f * 3, t, dur * 0.5, vol * 0.18, 0.003);
}
export const SFX_LIST = [["mix", "Mix (a different one each time)"], ...Object.entries(SFX_STYLES).map(([k, s]) => [k, s.label])];
let sfxStyle = "crystal", lastStep = 0;
const STYLE_KEY = "psp_sfx_style";                                         // remembered here too, so the Games hub uses it
export function setSfxStyle(name) {
  sfxStyle = name === "mix" || SFX_STYLES[name] ? name : "crystal";
  try { localStorage.setItem(STYLE_KEY, sfxStyle); } catch { /* private window */ }
}
try { const s = localStorage.getItem(STYLE_KEY); if (s === "mix" || SFX_STYLES[s]) sfxStyle = s; } catch { /* private window */ }

// button pitch: every style can sound higher or lower
const PITCHES = { high: 1.5, normal: 1, low: 0.6 };
export const PITCH_LIST = [["high", "High"], ["normal", "Normal"], ["low", "Low"]];
let sfxPitch = 1;
const PITCH_KEY = "psp_sfx_pitch";
export function setSfxPitch(name) {
  const key = PITCHES[name] ? name : "normal";
  sfxPitch = PITCHES[key];
  try { localStorage.setItem(PITCH_KEY, key); } catch { /* private window */ }
}
try { const p = localStorage.getItem(PITCH_KEY); if (PITCHES[p]) sfxPitch = PITCHES[p]; } catch { /* private window */ }

let lastHover = 0;
export function sfx(kind) {
  if (!audio() || muted || sfxVol <= 0) return;
  unlock();
  const t = ac.currentTime + 0.01;
  if (kind === "hover") {                                                 // the soft "tik" when the cursor moves to an item
    if (performance.now() - lastHover < 55) return;
    lastHover = performance.now();
    const f = up(2093, STEP[Math.floor(Math.random() * 3)] - 2);
    sine(sfxBus, f, t, 0.06, 0.07, 0.003); sine(sfxBus, f * 1.5, t, 0.04, 0.025, 0.003);
    return;
  }
  const keys = Object.keys(SFX_STYLES);
  const style = SFX_STYLES[sfxStyle === "mix" ? keys[Math.floor(Math.random() * keys.length)] : sfxStyle] || SFX_STYLES.crystal;
  const tone = (f, at, d, v) => style.tone(f * sfxPitch, at, d, v);
  if (kind === "click") {
    lastStep = (lastStep + 1 + Math.floor(Math.random() * 3)) % STEP.length;   // never the same note twice in a row
    const f = up(1046.5, STEP[lastStep] - 4);
    tone(f, t, 0.22, 0.16); tone(f * 1.5, t + 0.045, 0.28, 0.1);
  } else if (kind === "open") {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.05, 0.45, 0.1));
  } else if (kind === "back" || kind === "close") {
    [1175, 880, 659].forEach((f, i) => tone(f, t + i * 0.05, 0.3, 0.09));
  } else if (kind === "start") {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.07, 0.9, 0.11));
  }
}
