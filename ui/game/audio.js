// audio.js - all game sound is made in code (your asset library has no sound files):
//  - MUSIC: a small composer plays a different theme for every biome and place (town, forest, swamp, desert,
//    sci-fi city, the boss lair...), with chords, a bass line, arpeggios, a melody that repeats and varies like a
//    real tune, and percussion. Battles switch (cross-fade) to driving combat music; bosses get their own theme.
//  - AMBIENCE for every biome: wind, rivers, birds, crickets, frogs, cave drips, lava, waves, city hum, machines...
//  - CREATURE SOUNDS: every monster type and every playable species has its own idle noises, attack, hurt and death
//    sounds (mechs whirr and clang, slimes squelch, insects buzz, skeletons rattle, dinosaurs roar...).
//  - sound effects for actions, elements, dice, UI and the portal; footsteps that match the ground.
//  - voices: narration / dialogue audio with separate volumes for the narrator, Vermeil and everyone else;
//    music dips a little while someone speaks.
const MIDI = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], lydian: [0, 2, 4, 6, 7, 9, 11], pentatonic: [0, 2, 4, 7, 9, 12, 14],
  minor_penta: [0, 3, 5, 7, 10, 12, 15], hijaz: [0, 1, 4, 5, 7, 8, 10], wholetone: [0, 2, 4, 6, 8, 10] };

// every place's tune. chords = scale degrees (one per `bars` bars). Layers are optional.
const okv = (x) => Number.isFinite(x) && x > 0;            // a sound with no volume / a broken number is skipped, never thrown
const THEMES = {
  title:     { bpm: 72, key: 62, scale: "dorian", chords: [0, 5, 3, 4], bars: 2, pad: "pad", arp: { inst: "harp", pat: [0, 1, 2, 3, 2, 1, 2, 1], oct: 0 }, melody: { inst: "flute", oct: 1, density: 0.45 }, bass: "drone", bells: 0.15, verb: 0.55 },
  forest:    { bpm: 84, key: 62, scale: "dorian", chords: [0, 6, 3, 4], bars: 2, pad: "strings", arp: { inst: "harp", pat: [0, 2, 1, 2, 3, 2, 1, 2], oct: 0 }, melody: { inst: "flute", oct: 1, density: 0.5 }, bass: "root4", perc: "frame", bells: 0.08, verb: 0.45 },
  meadow:    { bpm: 96, key: 67, scale: "major", chords: [0, 4, 5, 3], bars: 2, pad: "strings", arp: { inst: "lute", pat: [0, 2, 1, 2, 0, 2, 1, 2], oct: -1 }, melody: { inst: "flute", oct: 1, density: 0.55 }, bass: "root4", perc: "shaker", verb: 0.35 },
  village:   { bpm: 104, key: 65, scale: "major", chords: [0, 3, 4, 0, 5, 3, 4, 4], bars: 1, pad: null, arp: { inst: "lute", pat: [0, 2, 1, 2, 0, 2, 1, 2], oct: -1 }, melody: { inst: "fiddle", oct: 1, density: 0.6 }, bass: "oompah", perc: "tavern", verb: 0.3 },
  swamp:     { bpm: 66, key: 57, scale: "phrygian", chords: [0, 1, 0, 6], bars: 2, pad: "pad", arp: { inst: "marimba", pat: [0, -1, 2, -1, 1, -1, 3, -1], oct: -1 }, melody: { inst: "clarinet", oct: 0, density: 0.3 }, bass: "drone", perc: "slowhand", verb: 0.55 },
  cave:      { bpm: 60, key: 57, scale: "minor", chords: [0, 5, 6, 0], bars: 2, pad: "pad", arp: null, melody: { inst: "bell", oct: 1, density: 0.22 }, bass: "drone", perc: null, bells: 0.25, verb: 0.75 },
  dungeon:   { bpm: 64, key: 55, scale: "harmonic", chords: [0, 5, 3, 4], bars: 2, pad: "choir", arp: { inst: "harp", pat: [0, -1, 1, -1, 2, -1, 1, -1], oct: -1 }, melody: { inst: "bell", oct: 1, density: 0.25 }, bass: "drone", perc: "heartbeat", verb: 0.7 },
  ruins:     { bpm: 70, key: 62, scale: "lydian", chords: [0, 1, 4, 0], bars: 2, pad: "choir", arp: { inst: "harp", pat: [0, 1, 2, 3, 4, 3, 2, 1], oct: 0 }, melody: { inst: "flute", oct: 1, density: 0.35 }, bass: "drone", bells: 0.2, verb: 0.65 },
  graveyard: { bpm: 62, key: 57, scale: "minor", chords: [0, 3, 5, 4], bars: 2, pad: "choir", arp: { inst: "musicbox", pat: [0, 2, 1, 2, 3, 2, 1, -1], oct: 1 }, melody: null, bass: "drone", perc: null, verb: 0.7 },
  mountain:  { bpm: 76, key: 60, scale: "mixolydian", chords: [0, 6, 3, 0], bars: 2, pad: "strings", arp: null, melody: { inst: "horn", oct: 0, density: 0.35 }, bass: "root2", perc: "toms", verb: 0.6 },
  snow:      { bpm: 70, key: 64, scale: "major", chords: [0, 5, 3, 4], bars: 2, pad: "pad", arp: { inst: "bell", pat: [0, 2, 3, 2, 1, 2, 3, 4], oct: 1 }, melody: { inst: "flute", oct: 1, density: 0.3 }, bass: "drone", bells: 0.3, verb: 0.7 },
  desert:    { bpm: 92, key: 62, scale: "hijaz", chords: [0, 1, 0, 6], bars: 2, pad: "pad", arp: { inst: "oud", pat: [0, 1, 2, 1, 0, 1, 3, 2], oct: -1 }, melody: { inst: "ney", oct: 1, density: 0.55 }, bass: "drone", perc: "darbuka", verb: 0.4 },
  beach:     { bpm: 108, key: 65, scale: "major", chords: [0, 3, 4, 3], bars: 2, pad: null, arp: { inst: "marimba", pat: [0, 2, 1, 2, 0, 3, 1, 2], oct: 0 }, melody: { inst: "steel", oct: 1, density: 0.5 }, bass: "calypso", perc: "shaker", verb: 0.3 },
  volcano:   { bpm: 88, key: 52, scale: "phrygian", chords: [0, 1, 6, 0], bars: 2, pad: "choir", arp: null, melody: { inst: "horn", oct: 0, density: 0.3 }, bass: "root8", perc: "taiko", verb: 0.5 },
  jungle:    { bpm: 100, key: 60, scale: "pentatonic", chords: [0, 3, 4, 3], bars: 2, pad: "pad", arp: { inst: "marimba", pat: [0, 2, 1, 3, 0, 2, 4, 2], oct: 0 }, melody: { inst: "flute", oct: 1, density: 0.45 }, bass: "root4", perc: "jungle", verb: 0.4 },
  city:      { bpm: 90, key: 57, scale: "minor", chords: [0, 5, 2, 6], bars: 2, pad: "synthpad", arp: { inst: "synth", pat: [0, 1, 2, 1, 3, 1, 2, 1], oct: 0 }, melody: { inst: "lead", oct: 1, density: 0.3 }, bass: "synth8", perc: "electro", verb: 0.4 },
  scifi:     { bpm: 96, key: 59, scale: "dorian", chords: [0, 3, 6, 4], bars: 2, pad: "synthpad", arp: { inst: "synth", pat: [0, 2, 4, 2, 1, 3, 4, 3], oct: 0 }, melody: { inst: "lead", oct: 1, density: 0.35 }, bass: "synth8", perc: "electro", verb: 0.45 },
  space:     { bpm: 64, key: 57, scale: "lydian", chords: [0, 1, 4, 5], bars: 2, pad: "synthpad", arp: { inst: "bell", pat: [0, -1, 2, -1, 4, -1, 2, -1], oct: 1 }, melody: null, bass: "drone", bells: 0.3, verb: 0.8 },
  castle:    { bpm: 80, key: 60, scale: "minor", chords: [0, 5, 3, 4], bars: 2, pad: "strings", arp: { inst: "harpsichord", pat: [0, 1, 2, 1, 3, 2, 1, 2], oct: 0 }, melody: { inst: "horn", oct: 0, density: 0.35 }, bass: "root4", perc: "march", verb: 0.55 },
  sakura:    { bpm: 78, key: 62, scale: "pentatonic", chords: [0, 3, 1, 4], bars: 2, pad: "pad", arp: { inst: "harp", pat: [0, 2, 4, 2, 1, 3, 2, -1], oct: 0 }, melody: { inst: "ney", oct: 1, density: 0.4 }, bass: "drone", perc: "frame", bells: 0.12, verb: 0.6 },
  sky:       { bpm: 116, key: 67, scale: "major", chords: [0, 4, 5, 3], bars: 1, pad: "strings", arp: { inst: "marimba", pat: [0, 2, 4, 2, 1, 3, 4, 3], oct: 0 }, melody: { inst: "bell", oct: 1, density: 0.55 }, bass: "walk", perc: "shaker", bells: 0.15, verb: 0.35 },
  manor:     { bpm: 84, key: 57, scale: "harmonic", chords: [0, 3, 4, 0], bars: 2, pad: "choir", arp: { inst: "harpsichord", pat: [0, 2, 1, 2, 0, 2, 1, 2], oct: -1 }, melody: { inst: "musicbox", oct: 1, density: 0.35 }, bass: "oompah", perc: null, verb: 0.75 },
  lair:      { bpm: 70, key: 50, scale: "harmonic", chords: [0, 1, 0, 4], bars: 2, pad: "choir", arp: { inst: "harp", pat: [0, -1, 1, -1, 2, -1, 1, -1], oct: -1 }, melody: null, bass: "drone", perc: "heartbeat", verb: 0.7 },
  combat:    { bpm: 140, key: 57, scale: "minor", chords: [0, 5, 3, 4], bars: 1, pad: "strings", arp: { inst: "stacc", pat: [0, 0, 1, 0, 2, 0, 1, 0], oct: 0, step: 16 }, melody: { inst: "horn", oct: 0, density: 0.45 }, bass: "drive", perc: "combat", verb: 0.25, stabs: true },
  boss:      { bpm: 150, key: 50, scale: "harmonic", chords: [0, 1, 5, 4], bars: 1, pad: "choir", arp: { inst: "stacc", pat: [0, 0, 2, 0, 1, 0, 3, 0], oct: 0, step: 16 }, melody: { inst: "horn", oct: -1, density: 0.5 }, bass: "drive", perc: "boss", verb: 0.35, stabs: true },
};
export const MUSIC_THEMES = Object.keys(THEMES);

// rhythm templates (16 sixteenth-notes per bar) for melodies
const RHYTHMS = [[1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0], [1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0], [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0], [1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]];
const PERC = {   // k kick, s snare, h hat, t tom, b taiko, d darbuka doum, e tek, x shaker, f frame drum, c clap, l low heartbeat
  frame: ["f...........f...", "....x.......x..."], shaker: ["................", "x.x.x.x.x.x.x.x."], tavern: ["k.......k.......", "....c.......c...", "..x...x...x...x."],
  slowhand: ["d.......e...e...", "................"], heartbeat: ["l..l............", "................"], toms: ["t.......t...t...", "................"],
  darbuka: ["d..e..e.d...e...", "......x.......x."], taiko: ["b.......b...b...", "....t.......t..t"], jungle: ["d.e.e.d.d.e.e.e.", "x.x.x.x.x.x.x.x."],
  electro: ["k...k...k...k...", "....s.......s...", "..h...h...h...h."], march: ["s.ss....s.ss....", "k.......k......."],
  combat: ["k.......k.k.....", "....s.......s...", "hhhhhhhhhhhhhhhh", "..............t."], boss: ["b..b....b.b.....", "....s.......s.s.", "hhhhhhhhhhhhhhhh", "k.k.k.k.k.k.k.k."],
};

// creature sound profiles: what each kind of monster / character sounds like
const CREATURE = {
  mech: { idle: "servo", attack: "clang", hit: "metalhit", death: "explode", step: "metalstep", alert: "servo_up" },
  robot: { idle: "beeps", attack: "zap", hit: "metalhit", death: "powerdown", step: "metalstep", alert: "beeps_alarm" },
  slime: { idle: "squelch", attack: "splat", hit: "squelch", death: "splat_big", step: "squelch_soft", alert: "bubble" },
  insect: { idle: "buzz", attack: "sting", hit: "chitter", death: "chitter_fall", step: "skitter", alert: "buzz_loud" },
  bat: { idle: "squeak", attack: "screech", hit: "squeak", death: "squeak_fall", step: "flap", alert: "screech" },
  rodent: { idle: "squeak", attack: "hiss", hit: "squeak", death: "squeak_fall", step: "skitter", alert: "hiss" },
  reptile: { idle: "hiss", attack: "hiss_strike", hit: "hiss", death: "hiss_fade", step: "slither", alert: "rattle_tail" },
  frog: { idle: "croak", attack: "tongue", hit: "croak", death: "croak_fall", step: "squelch_soft", alert: "croak" },
  skeleton: { idle: "rattle", attack: "bones_swing", hit: "bones_hit", death: "bones_fall", step: "bone_step", alert: "rattle" },
  zombie: { idle: "moan", attack: "groan_attack", hit: "groan", death: "moan_fade", step: "shamble", alert: "moan" },
  ghost: { idle: "wail", attack: "wail_attack", hit: "wail", death: "wail_fade", step: null, alert: "wail" },
  goblin: { idle: "cackle", attack: "yell_high", hit: "yelp", death: "yelp_fall", step: "step_light", alert: "cackle" },
  brute: { idle: "grunt_low", attack: "roar_short", hit: "grunt_low", death: "groan_fall", step: "stomp", alert: "roar_short" },
  humanoid: { idle: "mutter", attack: "yell", hit: "oof", death: "yelp_fall", step: "step", alert: "yell" },
  cultist: { idle: "chant", attack: "chant_cast", hit: "oof", death: "yelp_fall", step: "step", alert: "chant" },
  demon: { idle: "growl_deep", attack: "roar_fire", hit: "growl", death: "roar_fade", step: "stomp", alert: "roar_fire" },
  stone: { idle: "grind", attack: "rock_slam", hit: "rock_hit", death: "rockslide", step: "rock_step", alert: "grind" },
  plant: { idle: "creak", attack: "whip", hit: "creak", death: "crack_fall", step: "rustle", alert: "rustle" },
  crab: { idle: "click", attack: "snip", hit: "click", death: "click_fall", step: "skitter", alert: "snip" },
  water: { idle: "bubble", attack: "splash", hit: "bubble", death: "bubble_fall", step: "squelch_soft", alert: "splash" },
  dino: { idle: "chirp_growl", attack: "roar_mid", hit: "growl", death: "roar_fade", step: "stomp", alert: "roar_mid" },
  dino_big: { idle: "rumble", attack: "roar_big", hit: "growl_deep", death: "roar_fade", step: "stomp_big", alert: "roar_big" },
  alien: { idle: "warble", attack: "zap", hit: "warble", death: "warble_fade", step: "step_light", alert: "warble" },
  dragon: { idle: "snort_fire", attack: "roar_fire", hit: "growl", death: "roar_fade", step: "flap", alert: "roar_big" },
  beast: { idle: "growl", attack: "snarl", hit: "yelp_dog", death: "whine", step: "paws", alert: "howl" },
  // farm animals
  cow: { idle: "moo", step: "paws" }, horse: { idle: "neigh", step: "hoof" }, sheep: { idle: "baa", step: "paws" }, pig: { idle: "oink", step: "paws" },
  chicken: { idle: "cluck", step: null }, duck: { idle: "quack", step: null },
  // the party (by species / Vermeil)
  human: { idle: null, attack: "yell", hit: "oof", death: "yelp_fall", step: "step", victory: "cheer" },
  human_f: { idle: null, attack: "yell_f", hit: "oof_f", death: "yelp_fall_f", step: "step", victory: "cheer_f" },
  elf: { idle: null, attack: "yell_f", hit: "oof_f", death: "yelp_fall_f", step: "step_light", victory: "cheer_f" },
  dwarf: { idle: null, attack: "yell_low", hit: "grunt_low", death: "groan_fall", step: "stomp", victory: "cheer_low" },
  orc: { idle: null, attack: "roar_short", hit: "grunt_low", death: "groan_fall", step: "stomp", victory: "roar_short" },
  undead: { idle: null, attack: "bones_swing", hit: "bones_hit", death: "bones_fall", step: "bone_step", victory: "rattle" },
  beastfolk: { idle: null, attack: "snarl", hit: "yelp_dog", death: "whine", step: "paws", victory: "howl" },
  dragonkin: { idle: null, attack: "roar_mid", hit: "growl", death: "roar_fade", step: "stomp", victory: "roar_mid" },
  demonkin: { idle: null, attack: "growl", hit: "growl", death: "roar_fade", step: "step", victory: "growl_deep" },
  vermeil: { idle: null, attack: "yell_v", hit: "oof_v", death: "yelp_fall_v", step: "step_light", victory: "cheer_v" },
};
export const CREATURE_PROFILES = Object.keys(CREATURE);

export class Audio {
  constructor() {
    this.ctx = null;
    this.vol = { music_volume: 0.5, sfx_volume: 0.8, ambient_volume: 0.6, voice_volume: 1.0, voice_dm_volume: 1.0, voice_vermeil_volume: 1.0, voice_npc_volume: 1.0 };
    try { Object.assign(this.vol, JSON.parse(localStorage.getItem("vda_audio") || "{}")); } catch {}
    this.voiceSrc = null;
    this.ksCache = new Map();
    this.cooldown = {};
  }

  init() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();            // keeps loud moments from clipping
    comp.threshold.value = -10; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    this.bus = {};
    for (const k of ["music_volume", "sfx_volume", "ambient_volume", "voice_volume"]) {
      const g = c.createGain(); g.gain.value = this.vol[k]; g.connect(this.master); this.bus[k] = g;
    }
    this.duck = c.createGain(); this.duck.connect(this.bus.music_volume);      // music dips under speech
    // reverb (generated room) for music / magic
    this.verb = c.createConvolver();
    const len = c.sampleRate * 2.6, buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8); }
    this.verb.buffer = buf;
    this.verbGain = c.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.musicVerb = c.createGain(); this.musicVerb.gain.value = 0.4; this.musicVerb.connect(this.verb);
    this.bus.music_volume.connect(this.musicVerb);          // (so the music's echo follows the music volume)
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.brownBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const bd = this.brownBuf.getChannelData(0); let last = 0; for (let i = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    this.shaper = c.createWaveShaper();
    const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.5); }
    this.shaper.curve = curve;
    this.voiceGroups = {};
    for (const k of ["dm", "vermeil", "npc"]) { const g = c.createGain(); g.gain.value = this.vol[`voice_${k}_volume`] ?? 1; g.connect(this.bus.voice_volume); this.voiceGroups[k] = g; }
    this.startWatchdog();
  }

  /** keeps the sound alive: Windows/the browser can pause audio (headphones/Bluetooth switching, the mic turning on,
      the window losing focus). Every second: wake it up again, un-duck the music when nobody speaks, and if the
      sound clock is frozen for several seconds, rebuild the whole sound system and continue the same music. */
  startWatchdog() {
    clearInterval(this.watchdog);
    let lastT = -1, frozen = 0;
    const kick = () => { try { this.ctx.resume(); } catch {} };
    this.ctx.onstatechange = () => { if (this.ctx && this.ctx.state !== "running" && this.ctx.state !== "closed" && this.wanted) kick(); };
    window.addEventListener?.("pointerdown", () => { if (this.ctx && this.ctx.state !== "running") kick(); }, { capture: true });
    this.watchdog = setInterval(() => {
      const c = this.ctx; if (!c || !this.wanted) return;
      if (c.state === "closed") { this.rebuild(); return; }
      if (c.state !== "running") { kick(); if (++this.stuck >= 5) { this.stuck = 0; this.rebuild(); } return; }
      this.stuck = 0;
      if (!this.voiceSrc || c.currentTime > (this.voiceEnds || 0) + 0.5) {      // nobody speaks: music back to full
        if (this.duck.gain.value < 0.95) this.duck.gain.setTargetAtTime(1, c.currentTime, 0.4);
      }
      frozen = c.currentTime === lastT ? frozen + 1 : 0;
      lastT = c.currentTime;
      if (frozen >= 4) { frozen = 0; console.warn("sound stopped - restarting it"); this.rebuild(); return; }
      this.musicGuard();
    }, 1000);
  }

  /** the music must never just stop (long battles!): if the theme we want isn't playing, isn't being scheduled,
      or its volume got stuck at zero, start it again */
  musicGuard() {
    const c = this.ctx, want = this.wantTheme;
    if (!c || !want) return;
    if (!this.musicTimer) this.musicTimer = setInterval(() => this.tick(), 90);
    const S = this.song;
    const dead = !S || S.stopped || S.name !== want || S.next < c.currentTime - 2 || (S.gain.gain.value < 0.02 && c.currentTime - S.started > 4);
    if (dead) {
      console.warn("music stopped - starting", want, "again");
      if (S) { try { S.gain.disconnect(); } catch {} }
      this.song = null;
      this.music(want, { fade: 1.2 });
    }
    if (this.bus.music_volume.gain.value < 0.01 && (this.vol.music_volume ?? 0.5) > 0.02) this.bus.music_volume.gain.setTargetAtTime(this.vol.music_volume, c.currentTime, 0.2);
  }

  rebuild() {
    const theme = this.wantTheme || this.song?.name, scene = this.sceneArgs, battle = this.inBattle;
    try { clearInterval(this.musicTimer); } catch {}
    this.musicTimer = null; this.song = null; this.amb = null; this.hum = null;
    this.voiceSrc = null; this.voiceEnds = 0; this._voiceDone?.();
    try { this.ctx.close(); } catch {}
    this.ctx = null; this.ksCache.clear();
    this.init();
    if (!this.ctx) return;
    if (scene) this.setScene(...scene);
    if (theme) this.music(theme, { fade: 1 });
    this.inBattle = battle;
  }

  setVolumes(v) {
    Object.assign(this.vol, v || {});
    try { localStorage.setItem("vda_audio", JSON.stringify(this.vol)); } catch {}
    if (!this.ctx) return;
    for (const [k, g] of Object.entries(this.bus)) g.gain.setTargetAtTime(this.vol[k] ?? 0.7, this.ctx.currentTime, 0.1);
    for (const [k, g] of Object.entries(this.voiceGroups)) g.gain.setTargetAtTime(this.vol[`voice_${k}_volume`] ?? 1, this.ctx.currentTime, 0.1);
  }

  resume() { this.init(); this.wanted = true; if (this.ctx && this.ctx.state !== "running") this.ctx.resume(); }

  // ================================================================ building blocks
  out(bus, pan) {
    const dest = typeof bus === "string" ? this.bus[bus] : bus;
    if (pan == null || !this.ctx.createStereoPanner) return dest;
    const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(dest);
    return p;
  }

  tone({ f = 440, f2 = null, type = "sine", dur = 0.3, vol = 0.3, bus = "sfx_volume", attack = 0.005, verb = false, delay = 0, pan = null, curve = "exp", detune = 0, t = null } = {}) {
    if (!this.ctx || !okv(vol) || !okv(f) || !okv(dur) || (f2 != null && !okv(f2))) return;
    if (pan != null && !Number.isFinite(pan)) pan = null;
    const c = this.ctx, t0 = t ?? c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
    if (curve === "exp") g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); else { g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur - 0.08)); g.gain.linearRampToValueAtTime(0.0001, t0 + dur); }
    o.connect(g); g.connect(this.out(bus, pan)); if (verb) g.connect(this.verb);
    o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }

  noise({ dur = 0.2, vol = 0.3, filter = "bandpass", f = 1200, f2 = null, q = 1, bus = "sfx_volume", delay = 0, verb = false, pan = null, attack = 0.01, brown = false, t = null } = {}) {
    if (!this.ctx || !okv(vol) || !okv(f) || !okv(dur) || (f2 != null && !okv(f2))) return;
    if (pan != null && !Number.isFinite(pan)) pan = null;
    const c = this.ctx, t0 = t ?? c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = brown ? this.brownBuf : this.noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = filter; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(this.out(bus, pan)); if (verb) g.connect(this.verb);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }

  /** a voice-like sound: a buzzy source through vowel formants with a pitch contour (grunts, yells, moans, roars) */
  vocal({ f = 180, f2 = null, dur = 0.3, vol = 0.25, vowel = "a", type = "sawtooth", rough = 0, vib = 0, bus = "sfx_volume", pan = null, delay = 0, verb = false, breath = 0.15 } = {}) {
    if (!this.ctx || !okv(vol) || !okv(f) || !okv(dur) || (f2 != null && !okv(f2))) return;
    if (pan != null && !Number.isFinite(pan)) pan = null;
    const c = this.ctx, t0 = c.currentTime + delay;
    const F = { a: [800, 1150, 2900], e: [500, 1700, 2500], i: [320, 2200, 3000], o: [450, 800, 2830], u: [325, 700, 2530], ah: [700, 1220, 2600], uh: [600, 1040, 2250] }[vowel] || [700, 1200, 2600];
    const src = c.createOscillator(); src.type = type; src.frequency.setValueAtTime(f, t0);
    if (f2) src.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t0 + dur);
    if (vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 5.5; lg.gain.value = f * vib; l.connect(lg); lg.connect(src.frequency); l.start(t0); l.stop(t0 + dur + 0.1); }
    const env = c.createGain(); env.gain.setValueAtTime(0.0001, t0); env.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.04, dur * 0.2)); env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const dest = this.out(bus, pan);
    let head = src;
    if (rough) {          // growl: amplitude wobble + distortion
      const am = c.createGain(); const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 28 + rough * 20; lg.gain.value = 0.5 * rough;
      am.gain.value = 1 - 0.5 * rough; lfo.connect(lg); lg.connect(am.gain); lfo.start(t0); lfo.stop(t0 + dur + 0.1);
      head.connect(am); head = am;
      const sh = c.createWaveShaper(); sh.curve = this.shaper.curve; head.connect(sh); head = sh;
    }
    for (let i = 0; i < 3; i++) {
      const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = F[i]; bp.Q.value = 6 + i * 2;
      const g = c.createGain(); g.gain.value = [1, 0.6, 0.25][i];
      head.connect(bp); bp.connect(g); g.connect(env);
    }
    env.connect(dest); if (verb) env.connect(this.verb);
    src.start(t0); src.stop(t0 + dur + 0.05);
    if (breath) this.noise({ dur: dur * 0.9, vol: vol * breath, filter: "bandpass", f: F[1], q: 1.5, bus, pan, delay });
  }

  /** a plucked string (Karplus-Strong), cached per pitch */
  pluck(freq, t, vol = 0.2, dest, damp = 0.996, bright = 0.5, dur = 1.6) {
    const c = this.ctx, key = `${Math.round(freq)}|${damp}|${bright}`;
    let buf = this.ksCache.get(key);
    if (!buf) {
      const sr = c.sampleRate, n = Math.floor(sr * dur), N = Math.max(2, Math.round(sr / freq));
      buf = c.createBuffer(1, n, sr);
      const d = buf.getChannelData(0), ring = new Float32Array(N);
      for (let i = 0; i < N; i++) ring[i] = (Math.random() * 2 - 1) * (1 - bright * 0.5) + (Math.random() * 2 - 1) * bright * 0.5;
      let idx = 0;
      for (let i = 0; i < n; i++) { const nxt = (idx + 1) % N; const v = ring[idx]; ring[idx] = damp * 0.5 * (v + ring[nxt]); d[i] = v; idx = nxt; }
      if (this.ksCache.size > 160) this.ksCache.delete(this.ksCache.keys().next().value);
      this.ksCache.set(key, buf);
    }
    const s = c.createBufferSource(); s.buffer = buf;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(g); g.connect(dest); s.start(t);
    return g;
  }

  // ================================================================ instruments (for the music)
  play(inst, midi, t, dur, vel, dest) {
    const c = this.ctx, f = MIDI(midi), v = vel;
    const env = (g, a, peak, rel, hold = dur) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + Math.max(a, hold)); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, hold) + rel); return t + Math.max(a, hold) + rel; };
    const osc = (type, freq, det = 0) => { const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det; return o; };
    const lp = (fr, q = 0.7) => { const x = c.createBiquadFilter(); x.type = "lowpass"; x.frequency.value = fr; x.Q.value = q; return x; };
    const go = (nodes, end) => { for (const n of nodes) { n.start(t); n.stop(end + 0.05); } };
    switch (inst) {
      case "pad": case "synthpad": case "strings": case "choir": {
        const g = c.createGain(); const fl = lp(inst === "strings" ? 2400 : inst === "choir" ? 1600 : inst === "synthpad" ? 1800 : 1100, 0.8);
        const oscs = [osc("sawtooth", f, -9), osc("sawtooth", f, 9), osc(inst === "synthpad" ? "square" : "sawtooth", f / 2, 0)];
        if (inst === "choir") { const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 900; bp.Q.value = 1.2; oscs.forEach((o) => o.connect(bp)); bp.connect(fl); }
        else oscs.forEach((o) => o.connect(fl));
        fl.connect(g); g.connect(dest);
        const end = env(g, inst === "strings" ? 0.35 : 0.9, v * (inst === "choir" ? 0.12 : 0.07), inst === "strings" ? 0.6 : 1.4);
        go(oscs, end); break;
      }
      case "harp": case "lute": case "oud": case "harpsichord": case "musicbox": {
        if (inst === "musicbox") { this.tone({ f: f * 2, type: "sine", dur: 1.4, vol: v * 0.14, bus: dest, t }); this.tone({ f: f * 6, type: "sine", dur: 0.4, vol: v * 0.03, bus: dest, t }); break; }
        const damp = inst === "harp" ? 0.997 : inst === "harpsichord" ? 0.994 : 0.995, bright = inst === "harpsichord" ? 0.9 : inst === "oud" ? 0.7 : 0.4;
        this.pluck(f, t, v * (inst === "harp" ? 0.5 : 0.42), dest, damp, bright); break;
      }
      case "marimba": case "steel": {
        this.tone({ f, type: "sine", dur: inst === "steel" ? 0.9 : 0.5, vol: v * 0.22, bus: dest, t });
        this.tone({ f: f * (inst === "steel" ? 2.01 : 4), type: "sine", dur: 0.12, vol: v * 0.08, bus: dest, t }); break;
      }
      case "bell": {
        const car = osc("sine", f), mod = osc("sine", f * 3.5), mg = c.createGain(), g = c.createGain();
        mg.gain.setValueAtTime(f * 2.5, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.5);
        mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(dest);
        const end = env(g, 0.005, v * 0.1, 2.2, 0.01); go([car, mod], end); break;
      }
      case "flute": case "ney": case "clarinet": {
        const o = osc(inst === "clarinet" ? "square" : "triangle", f), g = c.createGain(), fl = lp(inst === "clarinet" ? 1400 : 3000);
        const vib = osc("sine", 5.2), vg = c.createGain(); vg.gain.value = f * 0.008; vib.connect(vg); vg.connect(o.frequency);
        o.connect(fl); fl.connect(g); g.connect(dest);
        const end = env(g, 0.08, v * (inst === "clarinet" ? 0.05 : 0.11), 0.25);
        go([o, vib], end);
        this.noise({ dur: Math.min(dur, 0.3) + 0.1, vol: v * (inst === "ney" ? 0.05 : 0.025), filter: "bandpass", f: f * 2, q: 3, bus: dest, t }); break;
      }
      case "fiddle": {
        const o = osc("sawtooth", f), g = c.createGain(), fl = lp(3200, 1.5);
        const vib = osc("sine", 6), vg = c.createGain(); vg.gain.value = f * 0.01; vib.connect(vg); vg.connect(o.frequency);
        o.connect(fl); fl.connect(g); g.connect(dest); const end = env(g, 0.05, v * 0.07, 0.15); go([o, vib], end); break;
      }
      case "horn": {
        const o = osc("sawtooth", f), o2 = osc("sawtooth", f, 6), g = c.createGain(), fl = lp(300, 1.2);
        fl.frequency.setValueAtTime(300, t); fl.frequency.linearRampToValueAtTime(1600, t + 0.15);
        o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(dest); const end = env(g, 0.06, v * 0.08, 0.3); go([o, o2], end); break;
      }
      case "stacc": {
        const o = osc("sawtooth", f), o2 = osc("sawtooth", f, -8), g = c.createGain(), fl = lp(2600);
        o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(dest); const end = env(g, 0.005, v * 0.07, 0.08, 0.04); go([o, o2], end); break;
      }
      case "synth": case "lead": {
        const o = osc(inst === "lead" ? "square" : "sawtooth", f), g = c.createGain(), fl = lp(800, 6);
        fl.frequency.setValueAtTime(3500, t); fl.frequency.exponentialRampToValueAtTime(500, t + 0.25);
        o.connect(fl); fl.connect(g); g.connect(dest); const end = env(g, 0.005, v * (inst === "lead" ? 0.05 : 0.06), 0.2, inst === "lead" ? dur : 0.05); go([o], end); break;
      }
      case "bass": case "synthbass": {
        const o = osc(inst === "synthbass" ? "sawtooth" : "triangle", f), g = c.createGain(), fl = lp(inst === "synthbass" ? 600 : 900);
        o.connect(fl); fl.connect(g); g.connect(dest); const end = env(g, 0.01, v * 0.2, 0.12, Math.max(0.05, dur * 0.8)); go([o], end); break;
      }
      case "drone": {
        const o = osc("sawtooth", f), o2 = osc("sine", f * 1.5), g = c.createGain(), fl = lp(400);
        o.connect(fl); o2.connect(fl); fl.connect(g); g.connect(dest); const end = env(g, 1.5, v * 0.06, 1.5); go([o, o2], end); break;
      }
    }
  }

  drum(kind, t, vel, dest) {
    const T = (o) => this.tone({ ...o, bus: dest, t }), N = (o) => this.noise({ ...o, bus: dest, t });
    switch (kind) {
      case "k": T({ f: 120, f2: 42, dur: 0.28, vol: 0.5 * vel }); break;
      case "s": N({ dur: 0.16, filter: "highpass", f: 1500, vol: 0.18 * vel }); T({ f: 210, f2: 140, type: "triangle", dur: 0.1, vol: 0.12 * vel }); break;
      case "h": N({ dur: 0.04, filter: "highpass", f: 7000, vol: 0.05 * vel }); break;
      case "c": N({ dur: 0.12, filter: "bandpass", f: 1800, q: 1.2, vol: 0.18 * vel }); break;
      case "x": N({ dur: 0.06, filter: "highpass", f: 5500, vol: 0.05 * vel, attack: 0.02 }); break;
      case "t": T({ f: 160, f2: 90, dur: 0.3, vol: 0.28 * vel }); break;
      case "b": T({ f: 70, f2: 38, dur: 0.6, vol: 0.55 * vel }); N({ dur: 0.18, filter: "lowpass", f: 500, vol: 0.2 * vel }); break;
      case "d": T({ f: 110, f2: 70, dur: 0.25, vol: 0.32 * vel }); break;
      case "e": N({ dur: 0.05, filter: "bandpass", f: 3200, q: 3, vol: 0.14 * vel }); T({ f: 650, f2: 500, dur: 0.05, vol: 0.06 * vel }); break;
      case "f": T({ f: 95, f2: 65, dur: 0.4, vol: 0.22 * vel }); N({ dur: 0.08, filter: "bandpass", f: 900, vol: 0.06 * vel }); break;
      case "l": T({ f: 58, f2: 40, dur: 0.22, vol: 0.32 * vel }); break;
    }
  }

  // ================================================================ the composer
  /** cross-fade to a theme ("forest", "combat", "boss", ...). Same theme again = nothing changes. */
  music(name, { fade = 2.5 } = {}) {
    if (!this.ctx) return;
    if (!THEMES[name]) name = "forest";
    this.wantTheme = name;
    if (this.song?.name === name && !this.song.stopped) return;
    const c = this.ctx, now = c.currentTime;
    if (this.song) { const old = this.song; old.gain.gain.cancelScheduledValues(now); old.gain.gain.setValueAtTime(old.gain.gain.value, now); old.gain.gain.linearRampToValueAtTime(0.0001, now + fade); setTimeout(() => old.gain.disconnect(), (fade + 4) * 1000); old.stopped = true; }
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.6, now + fade); g.connect(this.duck);
    const th = THEMES[name];
    this.musicVerb.gain.setTargetAtTime(th.verb ?? 0.4, now, 0.5);
    this.song = { name, th, gain: g, step: 0, next: now + 0.15, seed: hashStr(name), started: now };
    if (!this.musicTimer) this.musicTimer = setInterval(() => this.tick(), 90);
  }

  stopMusic(fade = 1.5) { this.wantTheme = null; if (!this.song || !this.ctx) return; const g = this.song.gain, now = this.ctx.currentTime; g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0.0001, now + fade); this.song.stopped = true; this.song = null; }

  tick() {
    const S = this.song; if (!S || !this.ctx) return;
    const c = this.ctx, th = S.th, sixteenth = 60 / th.bpm / 4;
    if (S.next < c.currentTime - 0.5) S.next = c.currentTime + 0.05;            // tab was asleep: don't burst
    // schedule 1.2 s ahead: even when Windows slows the page's timers to once a second, the music keeps going
    while (S.next < c.currentTime + 1.2) {
      try { this.musicStep(S, S.next, sixteenth); } catch (e) { if (!this.warned) { this.warned = true; console.warn("music note skipped", e); } }
      S.next += sixteenth; S.step++;            // always move on - one bad note must never stop the music
    }
  }

  musicStep(S, t, len) {
    const th = S.th, dest = S.gain, i = S.step % 16, bar = Math.floor(S.step / 16);
    const scale = SCALES[th.scale] || SCALES.minor;
    const chordIdx = Math.floor(bar / (th.bars || 2)) % th.chords.length;
    const deg = th.chords[chordIdx];
    const noteOf = (d, oct = 0) => { const n = scale.length; const o = Math.floor(d / n); return th.key + scale[((d % n) + n) % n] + 12 * (o + oct); };
    const chord = [noteOf(deg), noteOf(deg + 2), noteOf(deg + 4), noteOf(deg + 7)];
    const swing = th.swing && i % 2 ? len * th.swing : 0;
    t += swing;
    const firstOfChord = i === 0 && bar % (th.bars || 2) === 0;
    // pad: hold the chord
    if (th.pad && firstOfChord) for (const n of chord.slice(0, 3)) this.play(th.pad, n - 12, t, len * 16 * (th.bars || 2) * 0.95, 1, dest);
    // bass
    const root = noteOf(deg, -2);
    switch (th.bass) {
      case "drone": if (firstOfChord) this.play("drone", root, t, len * 16 * (th.bars || 2), 1, dest); break;
      case "root4": if (i % 4 === 0) this.play("bass", i === 8 ? root + 7 : root, t, len * 3, 0.9, dest); break;
      case "root2": if (i % 8 === 0) this.play("bass", root, t, len * 7, 0.9, dest); break;
      case "root8": if (i % 2 === 0) this.play("bass", root, t, len * 1.6, 0.7, dest); break;
      case "oompah": if (i % 4 === 0) this.play("bass", i % 8 === 0 ? root : root + 7, t, len * 2, 0.9, dest); if (i % 4 === 2) for (const n of chord.slice(0, 3)) this.play("stacc", n - 12, t, len, 0.5, dest); break;
      case "calypso": if ([0, 3, 6, 8, 11, 14].includes(i)) this.play("bass", i === 6 || i === 14 ? root + 7 : root, t, len * 1.5, 0.9, dest); break;
      case "walk": if (i % 4 === 0) this.play("bass", noteOf(deg + i / 4, -2), t, len * 3, 0.9, dest); break;
      case "synth8": if (i % 2 === 0) this.play("synthbass", i % 8 === 6 ? root + 12 : root, t, len * 1.5, 0.8, dest); break;
      case "drive": this.play("synthbass", i % 4 === 3 ? root + 12 : root, t, len * 0.8, i % 4 === 0 ? 1 : 0.7, dest); break;
    }
    // arpeggio
    const A = th.arp;
    if (A) {
      const every = A.step === 16 ? 1 : 2;
      if (i % every === 0) {
        const k = A.pat[(i / every) % A.pat.length];
        if (k >= 0) this.play(A.inst, chord[k % 4] + 12 * (A.oct || 0) + (k >= 4 ? 12 : 0), t, len * every * 1.5, i % 4 === 0 ? 0.9 : 0.65, dest);
      }
    }
    // melody: phrases of 2 bars, A A' B A shape so it sounds like a tune
    const M = th.melody;
    if (M) {
      const phrase = Math.floor(bar / 2), shape = [0, 0, 1, 0][phrase % 4], varied = phrase % 4 === 1;
      const rng = mulberry(S.seed + shape * 97 + (Math.floor(phrase / 4) % 2) * 13);
      const rhythm = RHYTHMS[Math.floor(rng() * RHYTHMS.length)];
      const half = bar % 2;
      if (rhythm[i] && rng.at(half * 16 + i) < M.density + (i % 4 === 0 ? 0.3 : 0)) {
        let d = deg + [0, 2, 4][Math.floor(rng.at(64 + half * 16 + i) * 3)];
        if (i % 4 !== 0) d += Math.floor(rng.at(128 + half * 16 + i) * 3) - 1;
        if (varied && half === 1) d += 1;
        let dur = 1; while (i + dur < 16 && !rhythm[i + dur]) dur++;
        this.play(M.inst, noteOf(d, M.oct || 0), t, len * dur * 0.9, 0.8, dest);
      }
    }
    if (th.bells && i % 8 === 4 && Math.random() < th.bells) this.play("bell", chord[Math.floor(Math.random() * 3)] + 24, t, 1, 0.6, dest);
    if (th.stabs && i === 0 && bar % 2 === 1) for (const n of chord.slice(0, 3)) this.play("horn", n - 12, t, len * 2, 0.8, dest);
    // percussion
    const P = PERC[th.perc];
    if (P) for (const row of P) { const ch = row[i]; if (ch && ch !== ".") this.drum(ch, t, i % 4 === 0 ? 1 : 0.7, dest); }
  }

  // ================================================================ ambience for each biome
  setScene(biome, music, time, { kind = null, water = false } = {}) {
    if (!this.ctx) return;
    this.sceneArgs = [biome, music, time, { kind, water }];
    this.stopAmbience();
    const c = this.ctx, A = this.bus.ambient_volume;
    const night = time === "night" || time === "dark";
    this.amb = { nodes: [], timers: [] };
    const bed = (f, vol, type = "lowpass", lfoRate = 0.07, lfoAmt = 0.4, brown = false, q = 0.7) => {
      const s = c.createBufferSource(); s.buffer = brown ? this.brownBuf : this.noiseBuf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = c.createGain(); g.gain.value = vol;
      const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = lfoRate; lg.gain.value = vol * lfoAmt; l.connect(lg); lg.connect(g.gain);
      const l2 = c.createOscillator(), l2g = c.createGain(); l2.frequency.value = lfoRate * 1.7; l2g.gain.value = f * 0.25; l2.connect(l2g); l2g.connect(fl.frequency);
      s.connect(fl); fl.connect(g); g.connect(A); s.start(); l.start(); l2.start();
      this.amb.nodes.push(s, l, l2);
    };
    const hum = (f, vol) => { const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = f * 3; const g = c.createGain(); g.gain.value = vol; o.connect(fl); fl.connect(g); g.connect(A); o.start(); this.amb.nodes.push(o); };
    const every = (ms, fn) => this.amb.timers.push(setInterval(() => { if (Math.random() < 0.999) fn(); }, ms));
    const T = (o) => this.tone({ bus: "ambient_volume", pan: Math.random() * 1.6 - 0.8, ...o }), N = (o) => this.noise({ bus: "ambient_volume", pan: Math.random() * 1.6 - 0.8, ...o });
    const bird = (kind = 0) => { const b = 2200 + Math.random() * 1800; const n = 2 + Math.floor(Math.random() * 4); const pan = Math.random() * 1.6 - 0.8;
      for (let i = 0; i < n; i++) this.tone({ f: b * (kind ? 0.7 : 1), f2: b * (kind ? 1.6 : 1.15 + Math.random() * 0.3), dur: kind ? 0.18 : 0.08, vol: 0.025, bus: "ambient_volume", delay: i * (kind ? 0.22 : 0.11), pan }); };
    const cricket = () => { const pan = Math.random() * 1.6 - 0.8; for (let i = 0; i < 6; i++) this.tone({ f: 4300, type: "square", dur: 0.025, vol: 0.006, bus: "ambient_volume", delay: i * 0.05, pan }); };
    const owl = () => { const pan = Math.random() * 1.6 - 0.8; this.tone({ f: 420, f2: 380, dur: 0.35, vol: 0.03, bus: "ambient_volume", pan, verb: true }); this.tone({ f: 400, f2: 360, dur: 0.5, vol: 0.03, bus: "ambient_volume", delay: 0.5, pan, verb: true }); };
    const drip = () => this.tone({ f: 1400 + Math.random() * 900, f2: 700, dur: 0.12, vol: 0.035, bus: "ambient_volume", verb: true, pan: Math.random() * 1.6 - 0.8 });
    const frog = () => { const pan = Math.random() * 1.6 - 0.8; const f = 90 + Math.random() * 60; for (let i = 0; i < 2 + Math.random() * 3; i++) this.vocal({ f, dur: 0.14, vol: 0.05, vowel: "o", type: "square", bus: "ambient_volume", pan, delay: i * 0.22, breath: 0 }); };
    const crow = () => this.vocal({ f: 520, f2: 380, dur: 0.3, vol: 0.04, vowel: "a", rough: 0.6, bus: "ambient_volume", pan: Math.random() * 1.6 - 0.8, verb: true });
    const gull = () => this.vocal({ f: 900, f2: 1300, dur: 0.35, vol: 0.03, vowel: "e", bus: "ambient_volume", pan: Math.random() * 1.6 - 0.8, breath: 0 });
    const clink = () => { this.tone({ f: 2400 + Math.random() * 600, type: "triangle", dur: 0.3, vol: 0.02, bus: "ambient_volume", pan: Math.random() - 0.5 }); };
    const chatter = () => { for (let i = 0; i < 3; i++) this.vocal({ f: 140 + Math.random() * 120, dur: 0.18, vol: 0.012, vowel: ["a", "e", "o", "u"][i % 4], bus: "ambient_volume", delay: i * 0.2, pan: Math.random() - 0.5 }); };
    const beep = () => { for (let i = 0; i < 2; i++) this.tone({ f: 1200 + Math.random() * 1500, type: "square", dur: 0.06, vol: 0.012, bus: "ambient_volume", delay: i * 0.1, pan: Math.random() - 0.5 }); };
    const crackle = () => { for (let i = 0; i < 4; i++) N({ dur: 0.03, filter: "highpass", f: 2500, vol: 0.03, delay: Math.random() * 0.4 }); };
    const chain = () => { for (let i = 0; i < 5; i++) this.tone({ f: 1800 + Math.random() * 1200, type: "triangle", dur: 0.08, vol: 0.012, bus: "ambient_volume", delay: i * 0.07, verb: true }); };
    const wind = (f, vol) => bed(f, vol, "bandpass", 0.05, 0.6, false, 1.2);
    switch (biome) {
      case "forest": wind(500, 0.035); every(2600, () => { if (!night && Math.random() < 0.6) bird(Math.random() < 0.3 ? 1 : 0); if (night && Math.random() < 0.5) cricket(); if (night && Math.random() < 0.08) owl(); }); break;
      case "meadow": wind(700, 0.03); every(2200, () => { if (!night && Math.random() < 0.6) bird(); if (Math.random() < 0.3) N({ dur: 1.2, f: 900, q: 0.8, vol: 0.02 }); if (night && Math.random() < 0.6) cricket(); }); break;
      case "village": wind(600, 0.02); every(2400, () => { if (!night && Math.random() < 0.5) bird(); if (Math.random() < 0.35) chatter(); if (Math.random() < 0.18) clink(); if (night && Math.random() < 0.5) cricket(); }); break;
      case "swamp": bed(400, 0.04, "lowpass", 0.05); every(1600, () => { if (Math.random() < 0.55) frog(); if (Math.random() < 0.3) this.tone({ f: 300 + Math.random() * 300, f2: 700, dur: 0.1, vol: 0.02, bus: "ambient_volume" }); if (Math.random() < 0.5) cricket(); }); break;
      case "cave": bed(220, 0.05, "lowpass", 0.04, 0.5, true); hum(55, 0.01); every(1500, () => { if (Math.random() < 0.6) drip(); }); break;
      case "dungeon": bed(200, 0.05, "lowpass", 0.04, 0.5, true); every(2000, () => { if (Math.random() < 0.5) drip(); if (Math.random() < 0.12) chain(); if (Math.random() < 0.06) this.vocal({ f: 120, f2: 90, dur: 1.4, vol: 0.02, vowel: "o", bus: "ambient_volume", verb: true, vib: 0.02 }); }); break;
      case "ruins": wind(700, 0.04); every(3000, () => { if (Math.random() < 0.25) this.tone({ f: 1600 + Math.random() * 800, dur: 2, vol: 0.012, bus: "ambient_volume", verb: true }); if (!night && Math.random() < 0.3) bird(1); }); break;
      case "graveyard": wind(450, 0.05); every(2500, () => { if (Math.random() < 0.2) crow(); if (Math.random() < 0.15) owl(); if (Math.random() < 0.4) cricket(); }); break;
      case "mountain": wind(900, 0.07); every(3500, () => { if (Math.random() < 0.25) this.vocal({ f: 1400, f2: 1100, dur: 0.6, vol: 0.02, vowel: "i", bus: "ambient_volume", verb: true, breath: 0 }); }); break;
      case "snow": wind(1100, 0.07); bed(2400, 0.015, "bandpass", 0.03, 0.8, false, 6); every(3000, () => { if (Math.random() < 0.3) N({ dur: 1.5, f: 1600, f2: 3000, q: 4, vol: 0.02 }); }); break;
      case "desert": wind(800, 0.06); every(3500, () => { if (Math.random() < 0.35) N({ dur: 2, f: 500, f2: 1400, q: 1.5, vol: 0.03 }); if (night && Math.random() < 0.4) cricket(); }); break;
      case "beach": bed(650, 0.09, "lowpass", 0.11, 0.85); every(2600, () => { if (!night && Math.random() < 0.3) gull(); }); break;
      case "volcano": bed(180, 0.08, "lowpass", 0.06, 0.4, true); every(900, () => { if (Math.random() < 0.6) crackle(); if (Math.random() < 0.05) this.tone({ f: 50, f2: 30, dur: 1.4, vol: 0.06, bus: "ambient_volume" }); }); break;
      case "jungle": bed(1800, 0.012, "bandpass", 0.2, 0.6, false, 3); wind(500, 0.025); every(1700, () => { if (Math.random() < 0.55) bird(Math.random() < 0.5 ? 1 : 0); if (Math.random() < 0.15) this.vocal({ f: 600, f2: 1100, dur: 0.25, vol: 0.02, vowel: "u", bus: "ambient_volume", delay: 0, breath: 0 }); if (Math.random() < 0.4) cricket(); }); break;
      case "city": hum(60, 0.012); bed(300, 0.04, "lowpass", 0.05); every(2800, () => { if (Math.random() < 0.2) N({ dur: 2.5, f: 600, f2: 300, q: 0.7, vol: 0.02 }); if (Math.random() < 0.08) this.tone({ f: 700, f2: 950, dur: 1.2, vol: 0.008, bus: "ambient_volume", type: "triangle" }); }); break;
      case "scifi": hum(50, 0.02); hum(100.5, 0.008); every(1900, () => { if (Math.random() < 0.45) beep(); if (Math.random() < 0.15) N({ dur: 0.6, f: 2000, f2: 600, q: 2, vol: 0.02 }); }); break;
      case "space": hum(40, 0.02); bed(150, 0.03, "lowpass", 0.02); every(3200, () => { if (Math.random() < 0.3) this.tone({ f: 800 + Math.random() * 400, f2: 300, dur: 1.5, vol: 0.01, bus: "ambient_volume", verb: true }); if (Math.random() < 0.25) beep(); }); break;
      case "castle": wind(500, 0.035); every(1300, () => { if (Math.random() < 0.5) crackle(); if (Math.random() < 0.08) chain(); }); break;
      case "farmland": wind(700, 0.03); every(2300, () => { if (!night && Math.random() < 0.55) bird(); if (Math.random() < 0.12) this.vocal({ f: 160, f2: 120, dur: 0.9, vol: 0.02, vowel: "o", bus: "ambient_volume", breath: 0.1 }); if (Math.random() < 0.1) this.vocal({ f: 700, f2: 900, dur: 0.18, vol: 0.015, vowel: "e", bus: "ambient_volume", breath: 0 }); if (night && Math.random() < 0.6) cricket(); }); break;
      case "harbor": bed(650, 0.07, "lowpass", 0.11, 0.85); every(2400, () => { if (!night && Math.random() < 0.35) gull(); if (Math.random() < 0.3) chatter(); if (Math.random() < 0.15) this.tone({ f: 880, dur: 1.6, vol: 0.012, bus: "ambient_volume", verb: true, type: "triangle" }); }); break;
      case "sakura": wind(800, 0.025); every(2400, () => { if (!night && Math.random() < 0.5) bird(1); if (Math.random() < 0.18) this.tone({ f: 1760 + Math.random() * 600, dur: 2.2, vol: 0.012, bus: "ambient_volume", verb: true }); if (Math.random() < 0.1) N({ dur: 1.4, f: 1200, f2: 2400, q: 1, vol: 0.015 }); if (night && Math.random() < 0.5) cricket(); }); break;
      case "sky_isles": wind(1000, 0.05); every(2600, () => { if (Math.random() < 0.35) bird(); if (Math.random() < 0.15) for (let i = 0; i < 3; i++) this.tone({ f: 1568 * [1, 1.25, 1.5][i], dur: 0.25, vol: 0.012, bus: "ambient_volume", delay: i * 0.08, verb: true }); }); break;
      case "blockland": wind(600, 0.03); every(2500, () => { if (!night && Math.random() < 0.45) bird(); if (Math.random() < 0.12) N({ dur: 0.1, filter: "lowpass", f: 400, vol: 0.03 }); if (night && Math.random() < 0.4) cricket(); }); break;
      case "manor": bed(220, 0.045, "lowpass", 0.04, 0.5, true); every(2200, () => { if (Math.random() < 0.3) this.tone({ f: 90 + Math.random() * 40, f2: 70, dur: 0.6, vol: 0.02, bus: "ambient_volume", verb: true }); if (Math.random() < 0.12) chain(); if (Math.random() < 0.08) this.vocal({ f: 520, f2: 700, dur: 1.6, vol: 0.015, vowel: "u", type: "triangle", bus: "ambient_volume", verb: true, vib: 0.04, breath: 0.3 }); if (Math.random() < 0.2) this.tone({ f: 1000, type: "triangle", dur: 0.05, vol: 0.01, bus: "ambient_volume" }); }); break;
      case "outpost": wind(700, 0.04); hum(55, 0.01); every(2100, () => { if (Math.random() < 0.35) beep(); if (Math.random() < 0.15) N({ dur: 0.5, f: 300, f2: 900, q: 1, vol: 0.02 }); if (Math.random() < 0.15) chatter(); }); break;
      case "crypt": bed(200, 0.05, "lowpass", 0.04, 0.5, true); every(2000, () => { if (Math.random() < 0.4) drip(); if (Math.random() < 0.1) chain(); if (Math.random() < 0.08) this.vocal({ f: 110, f2: 80, dur: 1.6, vol: 0.02, vowel: "o", bus: "ambient_volume", verb: true, vib: 0.03 }); }); break;
      case "mines": bed(220, 0.05, "lowpass", 0.04, 0.5, true); hum(55, 0.01); every(1400, () => { if (Math.random() < 0.5) drip(); if (Math.random() < 0.15) for (let i = 0; i < 3; i++) this.tone({ f: 2000 + Math.random() * 800, type: "triangle", dur: 0.08, vol: 0.015, bus: "ambient_volume", delay: i * 0.5, verb: true }); }); break;
      case "space_station": hum(45, 0.02); hum(90.5, 0.008); every(1800, () => { if (Math.random() < 0.4) beep(); if (Math.random() < 0.15) N({ dur: 0.8, f: 3000, f2: 800, q: 2, vol: 0.02 }); if (Math.random() < 0.1) for (let i = 0; i < 3; i++) this.tone({ f: 200, type: "square", dur: 0.04, vol: 0.01, bus: "ambient_volume", delay: i * 0.12 }); }); break;
      case "pirate_cove": bed(500, 0.07, "lowpass", 0.1, 0.8); every(1600, () => { if (Math.random() < 0.5) drip(); if (Math.random() < 0.12) chatter(); }); break;
      default: wind(500, 0.035); every(2600, () => { if (!night && Math.random() < 0.4) bird(); if (night && Math.random() < 0.4) cricket(); });
    }
    if (water) bed(1500, 0.025, "bandpass", 0.9, 0.7, false, 0.9);         // a river / stream nearby
    const theme = kind === "boss" ? "lair" : (THEMES[music] ? music : THEMES[biome] ? biome : "forest");
    this.areaTheme = theme;
    if (!this.inBattle) this.music(theme);
  }

  stopAmbience() {
    if (!this.amb) return;
    for (const t of this.amb.timers) clearInterval(t);
    for (const n of this.amb.nodes) { try { n.stop(); } catch {} }
    this.amb = null;
  }

  stopScene() { this.stopAmbience(); this.stopMusic(); }

  /** battle music on/off (boss = the boss theme) */
  battle(on, boss) {
    if (!this.ctx) return;
    this.inBattle = on;
    if (on) this.music(boss ? "boss" : "combat", { fade: 1.0 });
    else this.music(this.areaTheme || "forest", { fade: 3 });
  }

  // ================================================================ creature sounds
  /** profile = enemy 'sound' / species / 'vermeil'; event = idle|attack|hit|death|alert|step|victory */
  creature(profile, event, { pan = null, vol = 1, size = 1 } = {}) {
    if (!this.ctx || !profile) return;
    const P = CREATURE[profile] || CREATURE.humanoid;
    const name = P[event];
    if (!name) return;
    const key = profile + event;
    const now = performance.now();
    if (event !== "step" && this.cooldown[key] && now - this.cooldown[key] < 120) return;
    this.cooldown[key] = now;
    try { this.voiceFx(name, { pan, vol, size }); } catch (e) { console.warn("creature sound failed", name, e); }
  }

  voiceFx(name, { pan = null, vol = 1, size = 1 } = {}) {
    const p = pan, v = vol, low = 1 / Math.max(0.6, Math.min(2.2, size));
    const V = (o) => this.vocal({ pan: p, ...o, vol: (o.vol || 0.2) * v, f: (o.f || 180) * low, f2: o.f2 ? o.f2 * low : null });
    const T = (o) => this.tone({ pan: p, ...o, vol: (o.vol || 0.2) * v }), N = (o) => this.noise({ pan: p, ...o, vol: (o.vol || 0.2) * v });
    switch (name) {
      // machines
      case "servo": N({ dur: 0.5, filter: "bandpass", f: 900, f2: 1600, q: 6, vol: 0.06 }); T({ f: 140, f2: 210, type: "sawtooth", dur: 0.5, vol: 0.03 }); break;
      case "servo_up": T({ f: 120, f2: 420, type: "sawtooth", dur: 0.6, vol: 0.05 }); N({ dur: 0.6, filter: "bandpass", f: 700, f2: 2400, q: 5, vol: 0.06 }); break;
      case "clang": T({ f: 520, type: "square", dur: 0.6, vol: 0.06 }); T({ f: 1310, type: "sine", dur: 0.9, vol: 0.05, verb: true }); T({ f: 2210, type: "sine", dur: 0.5, vol: 0.03 }); N({ dur: 0.1, filter: "highpass", f: 2500, vol: 0.12 }); break;
      case "metalhit": T({ f: 780, type: "triangle", dur: 0.4, vol: 0.06 }); T({ f: 1890, dur: 0.3, vol: 0.04 }); N({ dur: 0.08, filter: "bandpass", f: 3000, vol: 0.1 }); this.voiceFx("sparks", { pan, vol }); break;
      case "sparks": for (let i = 0; i < 6; i++) N({ dur: 0.02, filter: "highpass", f: 5000, vol: 0.06, delay: Math.random() * 0.25 }); break;
      case "explode": N({ dur: 1.2, filter: "lowpass", f: 900, f2: 120, vol: 0.4, brown: true }); T({ f: 80, f2: 30, dur: 0.9, vol: 0.3 }); this.voiceFx("sparks", { pan, vol }); break;
      case "metalstep": T({ f: 90, f2: 60, dur: 0.12, vol: 0.06 }); N({ dur: 0.05, filter: "bandpass", f: 1400, q: 4, vol: 0.04 }); break;
      case "beeps": for (let i = 0; i < 3; i++) T({ f: [1200, 1600, 900][i] + Math.random() * 200, type: "square", dur: 0.05, vol: 0.025, delay: i * 0.08 }); break;
      case "beeps_alarm": for (let i = 0; i < 4; i++) T({ f: i % 2 ? 1800 : 1200, type: "square", dur: 0.09, vol: 0.035, delay: i * 0.1 }); break;
      case "zap": T({ f: 2400, f2: 200, type: "sawtooth", dur: 0.25, vol: 0.06 }); N({ dur: 0.2, filter: "highpass", f: 3000, vol: 0.08 }); break;
      case "powerdown": T({ f: 900, f2: 40, type: "square", dur: 1.0, vol: 0.05 }); this.voiceFx("sparks", { pan, vol }); break;
      // slime / water
      case "squelch": N({ dur: 0.25, filter: "lowpass", f: 600, f2: 200, vol: 0.12 }); T({ f: 180, f2: 90, dur: 0.2, vol: 0.06 }); break;
      case "squelch_soft": N({ dur: 0.12, filter: "lowpass", f: 500, vol: 0.05 }); break;
      case "splat": N({ dur: 0.3, filter: "lowpass", f: 1200, f2: 250, vol: 0.2 }); T({ f: 300, f2: 80, dur: 0.25, vol: 0.08 }); break;
      case "splat_big": this.voiceFx("splat", { pan, vol: vol * 1.4 }); for (let i = 0; i < 5; i++) T({ f: 300 + Math.random() * 500, f2: 900, dur: 0.06, vol: 0.03, delay: 0.1 + i * 0.07 }); break;
      case "bubble": for (let i = 0; i < 4; i++) T({ f: 300 + Math.random() * 400, f2: 900 + Math.random() * 400, dur: 0.07, vol: 0.04, delay: i * 0.09 }); break;
      case "bubble_fall": for (let i = 0; i < 8; i++) T({ f: 600 - i * 50, f2: 1200 - i * 80, dur: 0.07, vol: 0.04, delay: i * 0.08 }); break;
      case "splash": N({ dur: 0.5, filter: "bandpass", f: 1200, f2: 400, q: 0.8, vol: 0.2 }); break;
      // insects, bats, rodents
      case "buzz": T({ f: 175, type: "sawtooth", dur: 0.9, vol: 0.03, attack: 0.2, curve: "lin" }); T({ f: 178, type: "sawtooth", dur: 0.9, vol: 0.02, attack: 0.2, curve: "lin" }); break;
      case "buzz_loud": T({ f: 210, type: "sawtooth", dur: 1.2, vol: 0.06, attack: 0.1, curve: "lin" }); break;
      case "sting": T({ f: 400, f2: 1200, type: "sawtooth", dur: 0.18, vol: 0.06 }); N({ dur: 0.08, filter: "highpass", f: 4000, vol: 0.08 }); break;
      case "chitter": case "skitter": for (let i = 0; i < 7; i++) N({ dur: 0.02, filter: "bandpass", f: 3500 + Math.random() * 1500, q: 6, vol: name === "skitter" ? 0.03 : 0.07, delay: i * 0.035 }); break;
      case "chitter_fall": this.voiceFx("chitter", { pan, vol }); T({ f: 600, f2: 120, type: "sawtooth", dur: 0.5, vol: 0.03, delay: 0.2 }); break;
      case "squeak": T({ f: 2600, f2: 3400, dur: 0.08, vol: 0.05 }); T({ f: 2900, f2: 2400, dur: 0.07, vol: 0.04, delay: 0.1 }); break;
      case "screech": T({ f: 3200, f2: 1800, type: "sawtooth", dur: 0.35, vol: 0.05 }); break;
      case "squeak_fall": T({ f: 3000, f2: 900, dur: 0.4, vol: 0.05 }); break;
      case "flap": for (let i = 0; i < 3; i++) N({ dur: 0.07, filter: "lowpass", f: 700, vol: 0.06, delay: i * 0.13 }); break;
      case "hiss": N({ dur: 0.6, filter: "highpass", f: 3500, vol: 0.08, attack: 0.05 }); break;
      case "hiss_strike": N({ dur: 0.25, filter: "highpass", f: 3000, vol: 0.12 }); break;
      case "hiss_fade": N({ dur: 1.2, filter: "highpass", f: 3000, f2: 1500, vol: 0.08 }); break;
      case "rattle_tail": for (let i = 0; i < 14; i++) N({ dur: 0.02, filter: "bandpass", f: 5000, q: 5, vol: 0.05, delay: i * 0.035 }); break;
      case "slither": N({ dur: 0.3, filter: "highpass", f: 2000, vol: 0.02, attack: 0.1 }); break;
      case "croak": V({ f: 85, dur: 0.22, vol: 0.12, vowel: "o", type: "square", breath: 0 }); V({ f: 80, dur: 0.18, vol: 0.1, vowel: "o", type: "square", delay: 0.25, breath: 0 }); break;
      case "croak_fall": V({ f: 90, f2: 50, dur: 0.6, vol: 0.12, vowel: "u", type: "square", breath: 0 }); break;
      case "tongue": T({ f: 900, f2: 200, dur: 0.15, vol: 0.06 }); N({ dur: 0.1, filter: "lowpass", f: 800, vol: 0.06, delay: 0.1 }); break;
      // undead
      case "rattle": for (let i = 0; i < 9; i++) N({ dur: 0.025, filter: "bandpass", f: 1800 + Math.random() * 1200, q: 5, vol: 0.07, delay: i * 0.045 + Math.random() * 0.02 }); break;
      case "bones_swing": N({ dur: 0.18, f: 900, f2: 3000, q: 0.7, vol: 0.1 }); this.voiceFx("rattle", { pan, vol: vol * 0.6 }); break;
      case "bones_hit": for (let i = 0; i < 5; i++) N({ dur: 0.03, filter: "bandpass", f: 1400 + Math.random() * 900, q: 4, vol: 0.09, delay: i * 0.03 }); break;
      case "bones_fall": for (let i = 0; i < 16; i++) N({ dur: 0.03, filter: "bandpass", f: 1000 + Math.random() * 1500, q: 4, vol: 0.08, delay: i * 0.05 + Math.random() * 0.04 }); break;
      case "bone_step": N({ dur: 0.03, filter: "bandpass", f: 1500, q: 4, vol: 0.03 }); break;
      case "moan": V({ f: 110, f2: 85, dur: 1.4, vol: 0.12, vowel: "o", vib: 0.03, rough: 0.2 }); break;
      case "groan": V({ f: 130, f2: 90, dur: 0.5, vol: 0.13, vowel: "uh", rough: 0.4 }); break;
      case "groan_attack": V({ f: 150, f2: 100, dur: 0.6, vol: 0.16, vowel: "a", rough: 0.6 }); break;
      case "moan_fade": V({ f: 120, f2: 60, dur: 1.8, vol: 0.12, vowel: "o", vib: 0.04 }); break;
      case "shamble": N({ dur: 0.25, filter: "lowpass", f: 400, vol: 0.04, attack: 0.08 }); break;
      case "wail": V({ f: 520, f2: 700, dur: 1.4, vol: 0.06, vowel: "u", type: "triangle", vib: 0.04, verb: true, breath: 0.4 }); break;
      case "wail_attack": V({ f: 700, f2: 1100, dur: 0.7, vol: 0.08, vowel: "o", type: "sawtooth", vib: 0.05, verb: true }); break;
      case "wail_fade": V({ f: 700, f2: 200, dur: 1.8, vol: 0.07, vowel: "u", type: "triangle", vib: 0.05, verb: true, breath: 0.4 }); break;
      // humanoid voices
      case "cackle": for (let i = 0; i < 5; i++) V({ f: 330 + i * 10, dur: 0.1, vol: 0.08, vowel: i % 2 ? "e" : "a", delay: i * 0.12, breath: 0.3 }); break;
      case "yell_high": V({ f: 320, f2: 420, dur: 0.3, vol: 0.13, vowel: "a" }); break;
      case "yelp": V({ f: 420, f2: 300, dur: 0.18, vol: 0.12, vowel: "e" }); break;
      case "yelp_fall": V({ f: 260, f2: 120, dur: 0.6, vol: 0.12, vowel: "a" }); break;
      case "grunt_low": V({ f: 95, f2: 75, dur: 0.3, vol: 0.15, vowel: "uh", rough: 0.4 }); break;
      case "roar_short": V({ f: 120, f2: 90, dur: 0.6, vol: 0.2, vowel: "a", rough: 0.9 }); break;
      case "groan_fall": V({ f: 110, f2: 55, dur: 1.0, vol: 0.16, vowel: "o", rough: 0.4 }); break;
      case "mutter": for (let i = 0; i < 3; i++) V({ f: 150 + Math.random() * 30, dur: 0.15, vol: 0.05, vowel: ["a", "e", "o"][i], delay: i * 0.16 }); break;
      case "yell": V({ f: 190, f2: 230, dur: 0.3, vol: 0.14, vowel: "a" }); break;
      case "oof": V({ f: 170, f2: 120, dur: 0.18, vol: 0.13, vowel: "u" }); break;
      case "yell_f": V({ f: 330, f2: 400, dur: 0.28, vol: 0.12, vowel: "a" }); break;
      case "oof_f": V({ f: 320, f2: 240, dur: 0.18, vol: 0.12, vowel: "u" }); break;
      case "yelp_fall_f": V({ f: 380, f2: 180, dur: 0.6, vol: 0.12, vowel: "a" }); break;
      case "yell_low": V({ f: 120, f2: 140, dur: 0.35, vol: 0.16, vowel: "a", rough: 0.2 }); break;
      case "cheer": V({ f: 200, f2: 300, dur: 0.5, vol: 0.12, vowel: "e" }); break;
      case "cheer_f": V({ f: 360, f2: 520, dur: 0.5, vol: 0.11, vowel: "e" }); break;
      case "cheer_low": V({ f: 120, f2: 170, dur: 0.6, vol: 0.15, vowel: "o", rough: 0.2 }); break;
      case "yell_v": V({ f: 400, f2: 480, dur: 0.22, vol: 0.11, vowel: "a", type: "triangle", breath: 0.3 }); break;
      case "oof_v": V({ f: 420, f2: 300, dur: 0.17, vol: 0.11, vowel: "u", type: "triangle", breath: 0.3 }); break;
      case "yelp_fall_v": V({ f: 440, f2: 200, dur: 0.6, vol: 0.11, vowel: "a", type: "triangle" }); break;
      case "cheer_v": V({ f: 450, f2: 650, dur: 0.4, vol: 0.11, vowel: "e", type: "triangle" }); V({ f: 520, f2: 700, dur: 0.3, vol: 0.09, vowel: "i", type: "triangle", delay: 0.45 }); break;
      case "chant": for (let i = 0; i < 4; i++) V({ f: [147, 156, 147, 131][i], dur: 0.35, vol: 0.06, vowel: ["o", "u", "o", "a"][i], delay: i * 0.38, verb: true }); break;
      case "chant_cast": V({ f: 160, f2: 320, dur: 0.8, vol: 0.1, vowel: "a", verb: true }); break;
      // beasts and monsters
      case "growl": V({ f: 85, f2: 70, dur: 0.7, vol: 0.14, vowel: "uh", rough: 0.9, breath: 0.3 }); break;
      case "growl_deep": V({ f: 60, f2: 50, dur: 1.0, vol: 0.18, vowel: "o", rough: 1, breath: 0.3 }); break;
      case "snarl": V({ f: 140, f2: 110, dur: 0.4, vol: 0.16, vowel: "a", rough: 1 }); break;
      case "yelp_dog": V({ f: 520, f2: 380, dur: 0.15, vol: 0.12, vowel: "i" }); break;
      case "whine": V({ f: 600, f2: 300, dur: 0.9, vol: 0.09, vowel: "u", type: "triangle", vib: 0.03 }); break;
      case "howl": V({ f: 380, f2: 620, dur: 1.6, vol: 0.1, vowel: "u", type: "triangle", vib: 0.02, verb: true }); break;
      case "paws": N({ dur: 0.05, filter: "lowpass", f: 600, vol: 0.03 }); break;
      case "roar_mid": V({ f: 140, f2: 80, dur: 0.9, vol: 0.2, vowel: "a", rough: 1 }); N({ dur: 0.8, filter: "bandpass", f: 900, vol: 0.06 }); break;
      case "roar_big": V({ f: 80, f2: 45, dur: 1.5, vol: 0.28, vowel: "a", rough: 1, verb: true }); N({ dur: 1.4, filter: "lowpass", f: 700, vol: 0.12, brown: true }); break;
      case "roar_fire": V({ f: 95, f2: 60, dur: 1.1, vol: 0.22, vowel: "a", rough: 1 }); N({ dur: 1.0, filter: "lowpass", f: 600, f2: 2400, vol: 0.12 }); break;
      case "roar_fade": V({ f: 100, f2: 40, dur: 1.8, vol: 0.2, vowel: "o", rough: 0.8, verb: true }); break;
      case "rumble": V({ f: 50, f2: 45, dur: 1.4, vol: 0.14, vowel: "u", rough: 0.7 }); break;
      case "chirp_growl": V({ f: 380, f2: 260, dur: 0.25, vol: 0.08, vowel: "i", rough: 0.4 }); V({ f: 160, dur: 0.4, vol: 0.08, vowel: "uh", rough: 0.8, delay: 0.3 }); break;
      case "stomp": T({ f: 70, f2: 40, dur: 0.25, vol: 0.12 }); N({ dur: 0.1, filter: "lowpass", f: 300, vol: 0.06 }); break;
      case "stomp_big": T({ f: 50, f2: 28, dur: 0.5, vol: 0.25 }); N({ dur: 0.25, filter: "lowpass", f: 250, vol: 0.12, brown: true }); break;
      case "snort_fire": N({ dur: 0.35, filter: "bandpass", f: 700, q: 1, vol: 0.1 }); N({ dur: 0.6, filter: "lowpass", f: 400, f2: 1500, vol: 0.05, delay: 0.2 }); break;
      case "grind": N({ dur: 1.0, filter: "lowpass", f: 300, vol: 0.1, brown: true, attack: 0.2 }); break;
      case "rock_slam": T({ f: 60, f2: 30, dur: 0.6, vol: 0.3 }); N({ dur: 0.5, filter: "lowpass", f: 600, vol: 0.2, brown: true }); break;
      case "rock_hit": N({ dur: 0.15, filter: "bandpass", f: 900, vol: 0.15 }); break;
      case "rockslide": for (let i = 0; i < 10; i++) N({ dur: 0.12, filter: "lowpass", f: 500 + Math.random() * 600, vol: 0.1, delay: i * 0.07, brown: true }); break;
      case "rock_step": N({ dur: 0.1, filter: "lowpass", f: 300, vol: 0.06, brown: true }); break;
      case "creak": T({ f: 110, f2: 160, type: "sawtooth", dur: 0.8, vol: 0.03, attack: 0.2 }); N({ dur: 0.8, filter: "bandpass", f: 400, q: 8, vol: 0.04 }); break;
      case "whip": N({ dur: 0.2, f: 600, f2: 4000, q: 1, vol: 0.14 }); N({ dur: 0.05, filter: "highpass", f: 3000, vol: 0.1, delay: 0.17 }); break;
      case "crack_fall": for (let i = 0; i < 6; i++) N({ dur: 0.06, filter: "bandpass", f: 1500 + Math.random() * 800, vol: 0.08, delay: i * 0.08 }); N({ dur: 0.4, filter: "lowpass", f: 400, vol: 0.1, delay: 0.5 }); break;
      case "rustle": N({ dur: 0.35, filter: "highpass", f: 2500, vol: 0.04, attack: 0.08 }); break;
      case "click": for (let i = 0; i < 3; i++) N({ dur: 0.015, filter: "highpass", f: 4500, vol: 0.06, delay: i * 0.08 }); break;
      case "snip": N({ dur: 0.04, filter: "highpass", f: 4000, vol: 0.12 }); N({ dur: 0.04, filter: "highpass", f: 3600, vol: 0.1, delay: 0.09 }); break;
      case "click_fall": for (let i = 0; i < 6; i++) N({ dur: 0.015, filter: "highpass", f: 4000, vol: 0.05, delay: i * 0.12 }); break;
      case "warble": { const o = this.tone({ f: 600, type: "sine", dur: 0.7, vol: 0.05 * v, pan }); if (o) { const l = this.ctx.createOscillator(), g = this.ctx.createGain(); l.frequency.value = 9; g.gain.value = 180; l.connect(g); g.connect(o.frequency); l.start(); l.stop(this.ctx.currentTime + 0.8); } break; }
      case "warble_fade": T({ f: 800, f2: 150, type: "triangle", dur: 1.2, vol: 0.05 }); break;
      case "moo": V({ f: 120, f2: 95, dur: 1.3, vol: 0.12, vowel: "o", vib: 0.02, rough: 0.15 }); break;
      case "neigh": V({ f: 620, f2: 900, dur: 0.8, vol: 0.09, vowel: "e", vib: 0.12, rough: 0.3 }); V({ f: 500, f2: 300, dur: 0.4, vol: 0.06, vowel: "a", delay: 0.75 }); break;
      case "baa": V({ f: 360, dur: 0.7, vol: 0.08, vowel: "a", vib: 0.12 }); break;
      case "oink": for (let i = 0; i < 2; i++) V({ f: 260, f2: 220, dur: 0.14, vol: 0.08, vowel: "o", rough: 0.7, delay: i * 0.2 }); break;
      case "cluck": for (let i = 0; i < 3; i++) V({ f: 700, f2: 500, dur: 0.07, vol: 0.05, vowel: "a", delay: i * 0.12, breath: 0 }); break;
      case "quack": for (let i = 0; i < 2; i++) V({ f: 380, f2: 300, dur: 0.15, vol: 0.07, vowel: "a", type: "square", delay: i * 0.22, breath: 0 }); break;
      case "hoof": T({ f: 300, f2: 200, dur: 0.05, vol: 0.04 }); N({ dur: 0.04, filter: "bandpass", f: 1200, vol: 0.03 }); break;
      case "step": N({ dur: 0.05, filter: "lowpass", f: 700, vol: 0.03 }); break;
      case "step_light": N({ dur: 0.04, filter: "lowpass", f: 900, vol: 0.02 }); break;
      default: N({ dur: 0.12, filter: "lowpass", f: 900, vol: 0.06 });
    }
  }

  /** footsteps that match the ground */
  step(surface = "grass", { pan = null, vol = 1 } = {}) {
    if (!this.ctx) return;
    const N = (o) => this.noise({ pan, ...o, vol: o.vol * vol });
    switch (surface) {
      case "snow": N({ dur: 0.12, filter: "bandpass", f: 2500, q: 1, vol: 0.035 }); break;
      case "sand": N({ dur: 0.1, filter: "highpass", f: 3000, vol: 0.02 }); break;
      case "stone": N({ dur: 0.05, filter: "bandpass", f: 1800, q: 2, vol: 0.03 }); this.tone({ f: 140, f2: 90, dur: 0.05, vol: 0.02 * vol, pan }); break;
      case "metal": this.voiceFx("metalstep", { pan, vol: vol * 0.5 }); break;
      case "water": N({ dur: 0.15, filter: "bandpass", f: 1200, q: 0.8, vol: 0.04 }); break;
      default: N({ dur: 0.07, filter: "lowpass", f: 800, vol: 0.025 });
    }
  }

  // ================================================================ named sound effects
  sfx(name) {
    if (!this.ctx) return;
    try { this._sfx(name); } catch (e) { console.warn("sfx failed", name, e); }
  }

  _sfx(name) {
    const N = (o) => this.noise(o), T = (o) => this.tone(o);
    switch (name) {
      case "swing": case "slash": case "slash_red": N({ dur: 0.18, f: 900, f2: 3500, q: 0.7, vol: 0.25 }); break;
      case "slash_heavy": case "slash_wide": N({ dur: 0.3, f: 500, f2: 2500, q: 0.6, vol: 0.35 }); break;
      case "hit": case "impact": N({ dur: 0.12, filter: "lowpass", f: 900, vol: 0.5 }); T({ f: 140, f2: 60, type: "triangle", dur: 0.15, vol: 0.4 }); break;
      case "crit": N({ dur: 0.2, filter: "lowpass", f: 1400, vol: 0.6 }); T({ f: 220, f2: 50, type: "square", dur: 0.25, vol: 0.25 }); T({ f: 1200, f2: 1800, dur: 0.15, vol: 0.12, delay: 0.03 }); break;
      case "impact_big": N({ dur: 0.35, filter: "lowpass", f: 500, vol: 0.7 }); T({ f: 90, f2: 35, type: "sine", dur: 0.45, vol: 0.6 }); break;
      case "miss": N({ dur: 0.22, f: 2500, f2: 800, q: 0.5, vol: 0.15 }); break;
      case "block": case "shield": T({ f: 900, type: "triangle", dur: 0.4, vol: 0.2, verb: true }); T({ f: 1350, type: "sine", dur: 0.5, vol: 0.12, verb: true }); break;
      case "fire": case "meteor": N({ dur: 0.7, filter: "lowpass", f: 600, f2: 2400, vol: 0.45, verb: true }); N({ dur: 0.5, f: 3000, q: 2, vol: 0.12, delay: 0.1 }); break;
      case "ice": [1568, 2093, 2637].forEach((f, i) => T({ f, type: "sine", dur: 0.7, vol: 0.12, delay: i * 0.05, verb: true })); N({ dur: 0.3, f: 6000, q: 3, vol: 0.1 }); break;
      case "lightning": case "storm": N({ dur: 0.25, filter: "highpass", f: 2000, vol: 0.5 }); T({ f: 80, f2: 40, type: "sawtooth", dur: 0.5, vol: 0.25, delay: 0.05 }); break;
      case "light": [523, 659, 784, 1047].forEach((f, i) => T({ f, dur: 0.9, vol: 0.1, delay: i * 0.06, verb: true })); break;
      case "shadow": T({ f: 180, f2: 70, type: "sawtooth", dur: 0.8, vol: 0.15, verb: true }); N({ dur: 0.6, filter: "lowpass", f: 400, vol: 0.25 }); break;
      case "arcane": T({ f: 660, f2: 1320, type: "triangle", dur: 0.4, vol: 0.15, verb: true }); T({ f: 990, f2: 495, dur: 0.4, vol: 0.1, delay: 0.08, verb: true }); break;
      case "poison": N({ dur: 0.5, f: 700, q: 5, vol: 0.2 }); T({ f: 300, f2: 200, type: "sine", dur: 0.4, vol: 0.1, delay: 0.1 }); break;
      case "earth": N({ dur: 0.5, filter: "lowpass", f: 300, vol: 0.6 }); T({ f: 60, f2: 30, dur: 0.6, vol: 0.5 }); break;
      case "wind": N({ dur: 0.8, f: 800, f2: 1600, q: 1.5, vol: 0.2 }); break;
      case "heal": case "potion": [784, 988, 1175, 1568].forEach((f, i) => T({ f, dur: 0.6, vol: 0.09, delay: i * 0.07, verb: true })); break;
      case "buff_red": case "buff_gold": case "mark": T({ f: 392, f2: 784, type: "triangle", dur: 0.5, vol: 0.15, verb: true }); break;
      case "summon": T({ f: 220, f2: 880, type: "triangle", dur: 1.0, vol: 0.18, verb: true }); N({ dur: 0.9, f: 1500, f2: 400, vol: 0.12, verb: true }); break;
      case "smoke": N({ dur: 0.6, filter: "lowpass", f: 900, vol: 0.3 }); break;
      case "arrow": case "bow": N({ dur: 0.15, f: 3000, f2: 1200, q: 2, vol: 0.2 }); break;
      case "bullet": case "laser": T({ f: 1800, f2: 300, type: "square", dur: 0.12, vol: 0.12 }); break;
      case "dice": for (let i = 0; i < 6; i++) N({ dur: 0.05, f: 2500 + Math.random() * 2000, q: 4, vol: 0.25 - i * 0.03, delay: i * 0.09 + Math.random() * 0.04 }); break;
      case "dice_land": N({ dur: 0.08, f: 1800, q: 3, vol: 0.3 }); break;
      case "nat20": {                // NATURAL 20: a bright brass fanfare, a choir "aah", sparkles and a cymbal swell
        [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]].forEach(([f, d]) => { T({ f, type: "sawtooth", dur: d < 0.3 ? 0.18 : 1.3, vol: 0.05, delay: d, verb: true }); T({ f: f * 2, type: "triangle", dur: d < 0.3 ? 0.18 : 1.2, vol: 0.04, delay: d, verb: true }); });
        [523, 659, 784].forEach((f) => this.vocal({ f: f / 2, dur: 1.5, vol: 0.06, vowel: "a", vib: 0.012, delay: 0.32, verb: true, breath: 0.05 }));
        N({ dur: 1.6, filter: "highpass", f: 6000, vol: 0.12, attack: 0.5, delay: 0.1, verb: true });
        for (let i = 0; i < 10; i++) T({ f: 2000 + Math.random() * 3000, dur: 0.25, vol: 0.025, delay: 0.35 + i * 0.07, verb: true });
        T({ f: 65, f2: 45, dur: 0.6, vol: 0.3, delay: 0.32 }); break;
      }
      case "nat1": [311, 293, 277, 262].forEach((f, i) => T({ f, f2: i === 3 ? 220 : null, type: "sawtooth", dur: i === 3 ? 0.9 : 0.32, vol: 0.06, delay: i * 0.3, curve: "lin" })); break;
      case "coin": case "loot": [1319, 1760, 2093].forEach((f, i) => T({ f, type: "square", dur: 0.12, vol: 0.06, delay: i * 0.06 })); break;
      case "levelup": [523, 659, 784, 1047, 1319].forEach((f, i) => T({ f, type: "triangle", dur: 0.5, vol: 0.12, delay: i * 0.09, verb: true })); break;
      case "click": T({ f: 900, type: "triangle", dur: 0.05, vol: 0.08 }); break;
      case "hover": T({ f: 1400, type: "sine", dur: 0.04, vol: 0.025 }); break;
      case "open": N({ dur: 0.18, f: 600, f2: 2400, q: 1, vol: 0.06 }); T({ f: 660, f2: 990, type: "triangle", dur: 0.12, vol: 0.04 }); break;
      case "close": N({ dur: 0.15, f: 2000, f2: 500, q: 1, vol: 0.05 }); break;
      case "chest": N({ dur: 0.3, filter: "lowpass", f: 500, vol: 0.3 }); this.sfx("loot"); break;
      case "step": N({ dur: 0.06, filter: "lowpass", f: 400, vol: 0.06 }); break;
      case "death": T({ f: 300, f2: 80, type: "sawtooth", dur: 0.6, vol: 0.12 }); N({ dur: 0.4, filter: "lowpass", f: 500, vol: 0.2 }); break;
      case "victory": [523, 659, 784, 1047, 784, 1047].forEach((f, i) => T({ f, type: "triangle", dur: 0.35, vol: 0.12, delay: i * 0.12, verb: true })); break;
      case "defeat": [392, 349, 311, 262].forEach((f, i) => T({ f, type: "sine", dur: 0.6, vol: 0.12, delay: i * 0.25, verb: true })); break;
      case "battle_start": T({ f: 110, f2: 55, type: "sawtooth", dur: 0.6, vol: 0.18 }); N({ dur: 0.5, filter: "lowpass", f: 800, vol: 0.3 }); [220, 277, 330].forEach((f) => T({ f, type: "sawtooth", dur: 0.5, vol: 0.05, delay: 0.15 })); break;
      case "your_turn": T({ f: 880, type: "triangle", dur: 0.12, vol: 0.06 }); T({ f: 1320, type: "triangle", dur: 0.18, vol: 0.06, delay: 0.1 }); break;
      case "whoosh_small": N({ dur: 0.25, f: 400, f2: 2500, q: 0.8, vol: 0.12 }); break;
      // the portal
      case "portal": T({ f: 55, f2: 220, type: "sawtooth", dur: 4, vol: 0.12, attack: 2, verb: true }); N({ dur: 4, f: 300, f2: 3000, q: 1, vol: 0.2, verb: true }); break;
      case "portal_hum": this.portalHum(true); break;
      case "portal_enter": {          // stepping through: a rising shimmer, a deep woosh and a bright chime
        N({ dur: 1.4, f: 300, f2: 5000, q: 1.2, vol: 0.35, verb: true, attack: 0.3 });
        T({ f: 110, f2: 880, type: "sawtooth", dur: 1.2, vol: 0.08, verb: true, attack: 0.2 });
        [1047, 1319, 1568, 2093, 2637].forEach((f, i) => T({ f, dur: 1.2, vol: 0.05, delay: 0.5 + i * 0.07, verb: true }));
        T({ f: 60, f2: 30, dur: 1.4, vol: 0.3, delay: 0.3 }); break;
      }
      case "whoosh": N({ dur: 1.2, f: 200, f2: 4000, q: 0.8, vol: 0.4, verb: true }); break;
      case "arrive": [392, 523, 659, 784].forEach((f, i) => T({ f, type: "triangle", dur: 1.4, vol: 0.06, delay: i * 0.08, verb: true })); N({ dur: 1.2, f: 3000, f2: 600, q: 1, vol: 0.12, verb: true }); break;
      default: N({ dur: 0.12, filter: "lowpass", f: 1200, vol: 0.25 });
    }
  }

  /** the portal's ongoing hum (on/off) */
  portalHum(on) {
    if (!this.ctx) return;
    if (!on) { if (this.hum) { const { g, nodes } = this.hum; g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4); setTimeout(() => nodes.forEach((n) => { try { n.stop(); } catch {} }), 2000); this.hum = null; } return; }
    if (this.hum) return;
    const c = this.ctx, g = c.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.08, c.currentTime, 0.8); g.connect(this.bus.sfx_volume); g.connect(this.verb);
    const o1 = c.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 55;
    const o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = 110.6;
    const fl = c.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 500;
    const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 0.4; lg.gain.value = 250; l.connect(lg); lg.connect(fl.frequency);
    o1.connect(fl); o2.connect(fl); fl.connect(g); o1.start(); o2.start(); l.start();
    this.hum = { g, nodes: [o1, o2, l] };
  }

  // ================================================================ voices
  async playVoice(b64, group = "npc") {
    this.resume();
    if (!this.ctx || !b64) return 0;
    this.stopVoice();
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    let buf;
    try { buf = await this.ctx.decodeAudioData(arr.buffer); } catch (e) { console.warn("voice couldn't be decoded", e); return 0; }
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(this.voiceGroups[group] || this.voiceGroups.npc); s.start();
    this.voiceSrc = s; this.voiceEnds = ctx.currentTime + buf.duration;
    this.duck.gain.setTargetAtTime(0.45, ctx.currentTime, 0.15);
    // finishes when the line ends - or, if the sound system was restarted meanwhile, after its length anyway
    return new Promise((res) => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); if (this.voiceSrc === s) { this.voiceSrc = null; if (this.ctx === ctx) this.duck.gain.setTargetAtTime(1, ctx.currentTime, 0.5); } res(buf.duration); };
      const timer = setTimeout(finish, buf.duration * 1000 + 1500);
      this._voiceDone = finish;
      s.onended = finish;
    });
  }

  stopVoice() { try { this.voiceSrc?.stop(); } catch {} this.voiceSrc = null; if (this.ctx) this.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4); }
}

function hashStr(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(seed) {
  const f = (n) => { let t = (seed + n * 0x6D2B79F5) >>> 0; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let i = 0;
  const r = () => f(i++);
  r.at = f;
  return r;
}
