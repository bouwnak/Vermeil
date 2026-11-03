// audio.js - everything you hear is made here, with no sound files: the sea, wind and rain, music that changes with the place and the hour, tool sounds, and the blips people talk in.
let ctx = null, master = null, music = null, sfx = null, sea = null, wind = null, rain = null, noise = null;
export const levels = { music: 0.5, sfx: 0.8 };
const mood = { night: false, place: "home", weather: "sunny", sea: 1 };

function makeNoise() {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  return buf;
}
function bed(gain, filter) {
  const n = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  n.buffer = noise; n.loop = true; f.type = filter[0]; f.frequency.value = filter[1]; g.gain.value = gain;
  n.connect(f).connect(g).connect(sfx); n.start();
  return g;
}

export function startAudio() {
  if (ctx) { ctx.resume(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  master = ctx.createGain(); master.connect(ctx.destination);
  music = ctx.createGain(); music.gain.value = levels.music * 0.35; music.connect(master);
  sfx = ctx.createGain(); sfx.gain.value = levels.sfx; sfx.connect(master);
  noise = makeNoise();
  sea = bed(0.32, ["lowpass", 900]);                      // the sea: soft noise rising and falling
  const lfo = ctx.createOscillator(), depth = ctx.createGain(); lfo.frequency.value = 0.11; depth.gain.value = 0.12;
  lfo.connect(depth).connect(sea.gain); lfo.start();
  wind = bed(0.02, ["bandpass", 500]);
  rain = bed(0, ["highpass", 2400]);
  tune();
  birds();
}

const pluck = (freq, when, vol = 0.2, len = 1.6, type = "triangle", to = music) => {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, when + len);
  o.connect(g).connect(to); o.start(when); o.stop(when + len + 0.05);
};
/** a short burst of filtered noise: thuds, scrapes, splashes */
const hiss = (when, len, vol, freq, type = "lowpass") => {
  if (!ctx) return;
  const n = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  n.buffer = noise; f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0008, when + len);
  n.connect(f).connect(g).connect(sfx); n.start(when, Math.random() * 2); n.stop(when + len + 0.05);
};

// each kind of place has its own scale, pace and instrument: a gentle five-note wander, always a little different
const PLACES = {
  home: { scale: [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3], beat: 0.62, type: "triangle" }, town: { scale: [293.7, 329.6, 370, 440, 493.9, 587.3, 659.3, 740], beat: 0.42, type: "triangle" },
  forest: { scale: [220, 261.6, 293.7, 329.6, 392, 440, 523.3, 587.3], beat: 0.8, type: "sine" }, ruins: { scale: [196, 233, 261.6, 277, 349, 392, 466, 523], beat: 1.1, type: "sine" }, sea: { scale: [246.9, 293.7, 329.6, 370, 440, 493.9, 587.3, 659.3], beat: 0.72, type: "sine" },
};
function tune() {
  let i = 3;
  const bar = () => {
    if (!ctx) return;
    const P = PLACES[mood.place] || PLACES.home, t = ctx.currentTime + 0.05, storm = mood.weather === "storm", beat = P.beat * (mood.night ? 1.3 : 1);
    for (let k = 0; k < 4; k++) {
      i = Math.max(0, Math.min(P.scale.length - 1, i + Math.floor(Math.random() * 5) - 2));
      if (Math.random() < (mood.night ? 0.42 : 0.72)) pluck(P.scale[i] * (mood.night ? 0.75 : 1) * (storm ? 0.9 : 1), t + k * beat, 0.16, 1.6, P.type);
    }
    pluck(P.scale[[0, 3, 4, 0][Math.floor(Math.random() * 4)]] / 2, t, 0.14, 2.6, "sine");
    if (storm) pluck(55, t, 0.2, 3, "sawtooth");
    setTimeout(bar, beat * 4000);
  };
  bar();
}
function birds() {
  const sing = () => {
    if (!ctx) return;
    if (!mood.night && mood.place !== "sea" && mood.weather !== "storm") { const t = ctx.currentTime, f = 1800 + Math.random() * 1400; for (let n = 0; n < 3; n++) pluck(f * (1 + n * 0.08), t + n * 0.09, 0.025, 0.09, "sine", sfx); }
    setTimeout(sing, 3000 + Math.random() * 7000);
  };
  sing();
}
/** while the game loads: slow open chords over the sea */
let song = 0;
export function loadingSong(on) {
  clearTimeout(song);
  if (!on) return;
  const chords = [[261.6, 329.6, 392], [220, 293.7, 349.2], [246.9, 293.7, 392], [196, 261.6, 329.6]];
  let n = 0;
  const next = () => { if (ctx) { const t = ctx.currentTime + 0.05; chords[n++ % 4].forEach((f, i) => pluck(f, t + i * 0.32, 0.17, 3.4, "sine")); } song = setTimeout(next, 2800); };
  next();
}
/** the world tells the sound where you are */
export function setScene(o) {
  Object.assign(mood, o);
  if (!ctx) return;
  const t = ctx.currentTime, w = mood.weather;
  rain.gain.setTargetAtTime(w === "storm" || w === "heavy" ? 0.34 : w === "rain" ? 0.18 : 0, t, 1);
  wind.gain.setTargetAtTime(w === "wind" ? 0.24 : w === "storm" ? 0.2 : w === "snow" ? 0.09 : mood.place === "sea" ? 0.08 : 0.025, t, 1);
  if (!weatherLoop) weatherLoop = setInterval(weatherSounds, 120);
}
/** what the weather sounds like close by, on top of its steady bed: drops pattering on leaves and roofs, gusts that come and go, snow muffling everything */
let weatherLoop = 0;
function weatherSounds() {
  if (!ctx) return;
  const w = mood.weather, t = now(), wet = w === "rain" ? 1 : w === "heavy" || w === "storm" ? 2.6 : 0;
  for (let i = 0; i < wet * 2; i++) if (Math.random() < 0.6) knock(t + Math.random() * 0.12, 2600 + Math.random() * 3000, 0.03, 0.06 + Math.random() * 0.06, 20);
  if ((w === "wind" || w === "storm") && Math.random() < 0.012) { wind.gain.setTargetAtTime(0.42, t, 0.6); setTimeout(() => wind?.gain.setTargetAtTime(w === "wind" ? 0.24 : 0.2, now(), 1.2), 1800); }
  if (w === "snow" && Math.random() < 0.05) hiss(t, 1.2, 0.03, 300);
}
export const setNight = (on) => { mood.night = on; };
export function setLevels(m, s) {
  levels.music = m; levels.sfx = s;
  if (music) { music.gain.value = m * 0.35; sfx.gain.value = s; }
}

/** a tone that slides from one pitch to another: knocks, creaks and every dinosaur voice */
const glide = (f0, f1, when, len, vol, type = "sine", vib = 0) => {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), when + len);
  if (vib) { const l = ctx.createOscillator(), d = ctx.createGain(); l.frequency.value = 18; d.gain.value = f0 * vib; l.connect(d).connect(o.frequency); l.start(when); l.stop(when + len + 0.05); }
  g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol, when + Math.min(0.02, len * 0.2)); g.gain.exponentialRampToValueAtTime(0.0008, when + len);
  o.connect(g).connect(sfx); o.start(when); o.stop(when + len + 0.05);
};
/** a noise burst through a ringing filter: wood and stone ring at their own pitch when struck */
const knock = (when, freq, len, vol, q = 8) => {
  if (!ctx) return;
  const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  n.buffer = noise; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0008, when + len);
  n.connect(f).connect(g).connect(sfx); n.start(when, Math.random() * 2); n.stop(when + len + 0.05);
};
/** a dinosaur's voice: little ones coo and chirp high, big ones rumble low; each has its own pitch */
export function dinoVoice(size = 2, mood = "happy", pitch = 1) {
  if (!ctx) return;
  const t = now(), base = (900 / Math.sqrt(Math.max(0.6, size))) * pitch;
  if (mood === "happy") { glide(base, base * 1.5, t, 0.12, 0.13, "sine", 0.02); glide(base * 1.2, base * 1.8, t + 0.13, 0.14, 0.12, "sine", 0.03); }
  else if (mood === "sniff") for (let i = 0; i < 3; i++) hiss(t + i * 0.11, 0.07, 0.12, 2400, "bandpass");
  else if (mood === "yawn") glide(base * 0.8, base * 0.45, t, 0.7, 0.12, "triangle", 0.01);
  else if (mood === "call") { glide(base * 0.6, base * 1.1, t, 0.3, 0.14, "triangle", 0.04); glide(base * 1.1, base * 0.7, t + 0.3, 0.35, 0.12, "triangle", 0.04); }
  else if (mood === "dig") for (let i = 0; i < 4; i++) { hiss(t + i * 0.14, 0.1, 0.22, 600); knock(t + i * 0.14, 300, 0.06, 0.15); }
  else glide(base, base * 0.8, t, 0.2, 0.12, "sine", 0.02);
}

const SOUND = {
  /** an axe in wood: a hollow knock that drops in pitch, and the bite of the blade */
  woodhit() { const t = now(); knock(t, 420 + Math.random() * 60, 0.22, 0.9, 6); glide(190, 120, t, 0.16, 0.22, "triangle"); hiss(t, 0.05, 0.25, 2600, "bandpass"); },
  /** a tree going over: a crack, a long creak, the rush of leaves, then it lands */
  woodfall() { const t = now(); hiss(t, 0.25, 0.5, 2200, "bandpass"); glide(140, 60, t + 0.15, 1.1, 0.12, "sawtooth"); hiss(t + 0.4, 0.9, 0.25, 3000, "highpass"); knock(t + 1.15, 110, 0.6, 1.2, 3); glide(70, 40, t + 1.15, 0.5, 0.3, "sine"); },
  /** a stump or a log split into pieces */
  woodsplit() { const t = now(); for (let i = 0; i < 3; i++) knock(t + i * 0.07, 500 - i * 90, 0.15, 0.7, 5); hiss(t, 0.3, 0.3, 1800, "bandpass"); },
  /** a pick on stone: a sharp clack with a ringing edge */
  stonehit() { const t = now(); hiss(t, 0.04, 0.6, 4000, "highpass"); knock(t, 1700 + Math.random() * 300, 0.18, 0.5, 14); knock(t, 260, 0.14, 0.5, 4); },
  /** the last blow: the rock cracks through, then the pieces tumble */
  stonebreak() { const t = now(); hiss(t, 0.35, 0.8, 1500); knock(t, 180, 0.5, 1, 3); glide(90, 45, t, 0.5, 0.25, "sine"); for (let i = 0; i < 9; i++) knock(t + 0.12 + Math.random() * 0.6, 900 + Math.random() * 1800, 0.07, 0.35, 10); },
  /** pulling up grass and fibre: a long, soft rustle */
  rustle() { const t = now(); for (let i = 0; i < 10; i++) hiss(t + i * 0.18 + Math.random() * 0.06, 0.22, 0.14 + Math.random() * 0.06, 2600 + Math.random() * 1500, "bandpass"); },
  /** a puff of dust as something disappears */
  poof() { const t = now(); hiss(t, 0.4, 0.3, 900); glide(700, 1400, t, 0.18, 0.06, "sine"); },
  water() { hiss(now(), 0.3, 0.16, 2600, "bandpass"); pluck(520, now(), 0.08, 0.2, "sine", sfx); }, dig() { hiss(now(), 0.18, 0.4, 500); pluck(120, now(), 0.16, 0.14, "triangle", sfx); }, plant() { hiss(now(), 0.09, 0.2, 900); pluck(660, now() + 0.06, 0.12, 0.2, "triangle", sfx); },
  pick() { pluck(880, now(), 0.16, 0.18, "triangle", sfx); pluck(1320, now() + 0.08, 0.14, 0.2, "triangle", sfx); }, hop() { pluck(420, now(), 0.1, 0.12, "sine", sfx); }, buy() { pluck(990, now(), 0.14, 0.2, "triangle", sfx); pluck(1480, now() + 0.08, 0.14, 0.25, "triangle", sfx); },
  splash() { hiss(now(), 0.5, 0.34, 1400); }, bite() { pluck(1200, now(), 0.16, 0.12, "square", sfx); }, open() { pluck(600, now(), 0.1, 0.1, "triangle", sfx); }, smash() { hiss(now(), 0.6, 0.6, 320); pluck(70, now(), 0.3, 0.5, "sawtooth", sfx); },
  chop() { hiss(now(), 0.08, 0.5, 1500, "bandpass"); pluck(190, now(), 0.2, 0.09, "square", sfx); }, tink() { pluck(2000, now(), 0.1, 0.1, "square", sfx); hiss(now(), 0.1, 0.3, 2400, "bandpass"); }, fall() { hiss(now(), 0.6, 0.4, 400); pluck(90, now() + 0.2, 0.2, 0.3, "triangle", sfx); },
  step() { hiss(now(), 0.05, 0.05, 500); }, stepwood() { pluck(160, now(), 0.06, 0.05, "triangle", sfx); }, stepsand() { hiss(now(), 0.07, 0.05, 1500); }, place() { pluck(200, now(), 0.16, 0.1, "triangle", sfx); hiss(now(), 0.08, 0.16, 700); },
  remove() { pluck(320, now(), 0.1, 0.14, "triangle", sfx); pluck(220, now() + 0.07, 0.1, 0.14, "triangle", sfx); }, deny() { pluck(170, now(), 0.1, 0.16, "square", sfx); }, grunt() { pluck(130 + Math.random() * 90, now(), 0.16, 0.3, "sawtooth", sfx); pluck(260, now() + 0.13, 0.08, 0.14, "triangle", sfx); },
  chirp() { pluck(900 + Math.random() * 400, now(), 0.12, 0.09, "sine", sfx); pluck(1300 + Math.random() * 300, now() + 0.09, 0.12, 0.1, "sine", sfx); }, roar() { pluck(90, now(), 0.24, 0.9, "sawtooth", sfx); pluck(140, now() + 0.1, 0.16, 0.8, "sawtooth", sfx); hiss(now(), 0.7, 0.2, 800); },
  chain() { for (let i = 0; i < 6; i++) { pluck(700 + (i % 2) * 300, now() + i * 0.09, 0.05, 0.05, "square", sfx); hiss(now() + i * 0.09, 0.05, 0.1, 2000, "bandpass"); } }, thud() { pluck(60, now(), 0.34, 0.5, "sine", sfx); hiss(now(), 0.3, 0.3, 300); },
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => pluck(f, now() + i * 0.13, 0.16, 0.6, "triangle", sfx)); }, rare() { [880, 1109, 1319, 1760].forEach((f, i) => pluck(f, now() + i * 0.09, 0.12, 0.7, "sine", sfx)); }, evolve() { for (let i = 0; i < 9; i++) pluck(261.6 * 2 ** (i / 4), now() + i * 0.16, 0.14, 0.7, "triangle", sfx); hiss(now(), 1.6, 0.14, 3000, "highpass"); },
  engine() { pluck(58, now(), 0.1, 0.3, "sawtooth", sfx); pluck(88, now() + 0.06, 0.06, 0.2, "square", sfx); }, idlee() { pluck(46, now(), 0.05, 0.4, "sawtooth", sfx); },
  horn() { pluck(164, now(), 0.2, 1.1, "sawtooth", sfx); pluck(247, now() + 0.05, 0.14, 1, "triangle", sfx); }, thunder() { hiss(now(), 1.8, 0.6, 180); }, milk() { hiss(now(), 0.2, 0.1, 1800, "bandpass"); pluck(300, now(), 0.1, 0.14, "sine", sfx); },
};
const now = () => ctx.currentTime;
export function play(name) { if (ctx && SOUND[name]) SOUND[name](); }

/** one spoken letter: every speaker has a voice pitch, and each letter nudges it, so talk sounds like a tiny language */
export function blip(letter, pitch = 1) {
  if (!ctx || !/[a-z0-9]/i.test(letter)) return;
  const code = letter.toLowerCase().charCodeAt(0);
  pluck((230 + (code % 9) * 26) * pitch, ctx.currentTime, 0.1, 0.075, "square", sfx);
}
