// mock.js - fake Python for previewing the window in a normal browser: open index.html?mock
const bakeParse = (t) => { const m = /^([\d\s/.]+)\s*(cups?|teaspoons?|tablespoons?|pieces?)?\s*(.*)$/.exec(t.trim()); const q = m ? m[1].trim().split(/\s+/).reduce((a, p) => a + (p.includes("/") ? p.split("/")[0] / p.split("/")[1] : Number(p)), 0) : null; const u = m?.[2] ? ({ cup: "cup", cups: "cup", teaspoon: "tsp", teaspoons: "tsp", tablespoon: "tbsp", tablespoons: "tbsp", piece: "pc", pieces: "pc" })[m[2]] : ""; return { id: Math.random().toString(36).slice(2, 8), qty: q || null, unit: u, name: m ? m[3] : t, text: t.trim() }; };
const bakeStore = [{ id: "cookies", title: "Chocolate Chip Cookies", source: "", servings: 24, ingredients: ["2 1/2 cups all-purpose flour", "1 cup softened butter", "1/2 cup white sugar", "1 cup brown sugar", "2 pieces raw eggs", "1 teaspoons vanilla extract", "1 teaspoon baking soda", "1 teaspoon salt", "2 cups semisweet chocolate chips", "3/4 cup chopped walnuts"].map(bakeParse),
  steps: ["Preheat oven to 350 degrees Fahrenheit.", "In a mixing bowl, combine all-purpose flour, salt, and baking soda. Mix well and set aside.", "On a separate mixing bowl, put in butter and beat. Gradually add both sugars while beating.", "Add-in the vanilla extract and eggs (one piece at a time) while beating.", "Bake for 10 to 12 minutes."],
  nutrition: { per: "serving", servings: 24, source: "estimated", rows: [{ label: "Calories", value: "260 kcal" }, { label: "Total fat", value: "14 g" }, { label: "Saturated fat", value: "7 g" }, { label: "Sodium", value: "190 mg" }, { label: "Carbohydrates", value: "33 g" }, { label: "Sugar", value: "21 g" }, { label: "Protein", value: "3 g" }] } },
  { id: "brownies", title: "Fudgy Brownies", source: "https://www.example.com/brownies", servings: 16, ingredients: ["1/2 cup butter", "1 cup sugar", "2 eggs"].map(bakeParse), steps: ["Bake 25 minutes."], nutrition: null }];
const st = {
  plugins: { hidden_panels: ["missions"], owner: { missions: { id: "missions", name: "Missions" } }, fresh: false },
  characters: [
    { id: "vermeil", name: "Vermeil", prompt: "Playful devil.", voice: "en-US-AriaNeural", rate: "+0%", pitch: "+5Hz", model: "anime_girl.glb", outfit: "mech", hair: "original" },
    { id: "pip", name: "Pip", prompt: "Cheerful penguin.", voice: "en-US-AnaNeural", rate: "+5%", pitch: "+20Hz", model: "builtin:penguin" },
    { id: "robot", name: "Robo", prompt: "Cheerful robot.", voice: "en-US-GuyNeural", rate: "+10%", pitch: "+0Hz", model: "Robot.glb" },
  ],
  active: "vermeil",
  settings: { always_look: false, speak_replies: true, greet_on_sight: true, mirror_look: false, camera_on_start: false, listen_on_start: false, quiet_mode: false, context_aware: false, style: "companion", humor: 2, self_check: false, voice_style: "normal", barge_in: false, hotkeys: true, desktop_notifications: true, morning_briefing: true,
    privacy_mode: false, gesture_mode: false, scene_transitions: true, gym_room: true, idle_activities: true, keep_screens: true, stream_speech: true, noise_filter: true, wake_sensitivity: 2, watch_objects: true, code_auto_write: true, music_source: "auto",
    clap_wake: false, my_birthday: "", outfit_auto: true, sleep_at_night: true, call_reminders: true },
  people: [{ name: "Mia", relation: "sister", samples: 8 }],
  missions: [],
  ui: {}, prefs: { name: "JP", "likes: matcha": "love", "favourite color": "purple" },
  history: [{ who: "you", text: "hello" }, { who: "her", text: "Hi~" }],
  models: ["Robot.glb"], owner: null, camera: false, listening: false, tts: true,
};
const ev = (e) => window.onPyEvent(e);
const mockPerf = { setting: "auto", mode: "high", why: "6 cores, 15.7 GB memory, NVIDIA GeForce RTX 3050: high fits this computer.",
  machine: { system: "Windows", cores: 6, ram_gb: 15.7, gpu: "NVIDIA GeForce RTX 3050 Laptop GPU", vram_gb: 4, battery: 100, plugged: true, tier: "high" } };
const mockPhone = { on: false, running: false, method: "quick", url: null, pair: null, progress: null, error: null };
const journal = [
  { id: "a1", kind: "decision", title: "Take the thesis topic on solar dryers", text: "Lab access is easier.", created: "2026-09-01T10:00:00", status: "open", outcome: "", steps: [], review_on: "2026-10-01" },
  { id: "a2", kind: "goal", title: "Finish thesis chapter 2", text: "", created: "2026-10-01T10:00:00", status: "open", outcome: "", steps: [{ text: "Outline", done: true }, { text: "Draft", done: false }] },
  { id: "a3", kind: "idea", title: "Study timer that the room reacts to", text: "Lights dim while focusing.", created: "2026-10-10T10:00:00", status: "open", outcome: "", steps: [] },
];
const gymLog = [];
const gymPlan = { day: 1, title: "PUSH", exercises: [
  { name: "Incline Bench", sets: 3, target: "6-12", kg: 20, rest: 90, notes: "Controlled negatives", link: "https://youtube.com", timed: false,
    last: { date: "2026-10-14", sets: [{ set: 1, kg: 20, reps: "12" }, { set: 2, kg: 20, reps: "12" }, { set: 3, kg: 20, reps: "12" }] },
    best: { 1: { reps: "12", kg: 20, date: "2026-10-14", value: 12 }, 2: { reps: "11", kg: 20, date: "2026-10-10", value: 11 }, 3: { reps: "10", kg: 20, date: "2026-10-10", value: 10 } }, tip: "You hit 12 reps on every set last time - try 22.5 kg." },
  { name: "Handstand Hold (against wall)", sets: 2, target: "30 sec", kg: null, rest: 90, notes: "Build shoulder stability", link: "", timed: true, last: null, best: { 1: { reps: "40s", kg: null, date: "2026-10-16", value: 40 } }, tip: "" }] };
let routine = { name: "HYBRID", days: [{ day: 1, title: "PUSH", exercises: gymPlan.exercises.map(({ last, tip, ...e }) => e) }, { day: 2, title: "PULL", exercises: [] }] };
const practices = {};
let prodSet = { home_city: "Manila", ical_url: "", ical_synced: "", news_topics: ["Philippines", "AI"] };
let focusCur = null;
let mockMeals = { meals: [{ id: "m1", name: "Oats + eggs", kcal: 520, protein: 32, carbs: 55, fat: 18, photo: false }], total: { kcal: 520, protein: 32, carbs: 55, fat: 18 } };
let mockSmart = [{ event: "take out the trash", on: "home", match: "", minutes: 30 }, { event: "print my notes", on: "before", match: "2 pm class", minutes: 30 }];
export const mockApi = {
  study_progress: async () => ({ due: [{ id: "r1", title: "Fill in the blanks: Lecture 5 - Beams.pdf", best: 67 }],
    topics: [], weak: [{ topic: "Structural Analysis · shear diagrams", right: 1, total: 4, pct: 25 }, { topic: "Structural Analysis · moment of inertia", right: 3, total: 5, pct: 60 }] }),
  study_weak_review: async () => ({ error: "Demo only." }),
  sensei_settings: async () => ({ language: "ja", level: 2, streak: 4, languages: { ja: "Japanese", zh: "Chinese (Mandarin)", ko: "Korean", es: "Spanish" },
    levels: { 1: "absolute beginner", 2: "beginner", 3: "intermediate", 4: "upper intermediate", 5: "advanced" } }),
  sensei_set: async (l, v) => ({ language: l, level: v, streak: 4 }),
  sensei_lesson: async (t) => ({ lesson: `## ${t || "Greetings"}\n| Kana | Romaji | Meaning |\n|---|---|---|\n| こんにちは | konnichiwa | hello |`, streak: 5 }),
  sensei_mistakes_lesson: async () => ({ lesson: "## Your mistakes\n- は vs が" }),
  sensei_quiz: async () => ({ error: "Demo only." }),
  sensei_talk_start: async (t) => ({ id: "s1", kind: "sensei", topic: t, created: "2026-10-21", score: "", messages: [{ role: "assistant", content: "こんにちは！(konnichiwa) お名前は？ (What's your name?)" }] }),
  sensei_talks: async () => [],
  sensei_pronounce: async (x) => ({ expected: x, heard: "はじめまして", score: 92, verdict: "Nice try", tip: "", coach: { tips: [{ word: "じめ", syllables: "ji-me", how: "Short, flat vowels; don't stretch the e.", sounds_like: "gee-meh" }], encourage: "Almost there!" }, words: [...x].map((c, i) => ({ text: c, ok: i !== 1 })) }),
  sensei_say: async (t) => ({ ok: true, said: t }),
  focus_state: async () => ({ current: focusCur, week: { sessions: 3, minutes: 140, distractions: 2 } }),
  focus_start: async (task, w, b, r) => (focusCur = { task, work: w, break: b, rounds: r }),
  focus_round: async () => focusCur,
  focus_distraction: async () => 1,
  focus_finish: async (m) => { focusCur = null; return { summary: `Focused ${m} min, 1 distraction.`, tips: "- Put your phone in another room.\n- Start with the hardest part." }; },
  progress: async () => { const d = [...Array(30)].map((_, i) => i); return { days: d, quiz: d.map((i) => (i % 4 ? null : 55 + i)), focus: d.map((i) => (i % 3 ? 0 : 25 + i)),
    gym: d.map((i) => (i % 2 ? 0 : 3000 + i * 40)), language: d.map((i) => (i > 25 ? 1 : 0)), totals: { focus_minutes: 400, gym_sessions: 15, language_days: 4, language_streak: 4, quizzes: 8 },
    weak_topics: [{ topic: "Structural Analysis · shear diagrams", pct: 25 }], sleep: await mockApi.gym_sleep_report() }; },
  productivity_settings: async () => ({ ...prodSet }),
  save_productivity: async (d) => Object.assign(prodSet, d),
  calendar_sync_now: async () => ({ message: "Synced 12 Google Calendar events (next 90 days)." }),
  calendar_export: async () => ({ message: "Saved C:/Users/you/Documents/Vermeil/vermeil_calendar.ics." }),
  find_free_time_ui: async () => "Free on 2026-10-20: 08:00-10:00, 13:00-15:00, 19:00-22:00",
  meeting: async (on) => { ev({ type: "meeting", on }); return { message: on ? "Recording 'Meeting'." : "Meeting notes saved (12 min). Action items: send survey." }; },
  pc_overview: async () => ({ macros: { "study mode": { steps: [{ tool: "open_app" }, { tool: "play_music" }] } }, stats: { cpu_percent: 23, cpu_temp_c: 61, ram_used_gb: 11.2, ram_total_gb: 16, ram_percent: 70,
    gpu: { name: "RTX 3050", use_percent: 12, memory_used_gb: 1.1, memory_total_gb: 4, temp_c: 48 }, disks: [{ drive: "C:\\", used_percent: 91, free_gb: 42 }], battery: null, biggest_apps: [] } }),
  pc_crashes: async () => [{ when: "2026-10-20 21:10", app: "RobloxStudioBeta.exe", kind: "crash", module: "d3d11.dll" }],
  pc_delete_macro: async () => "Deleted.",
  practice_list: async () => Object.values(practices),
  practice_start: async (kind, topic, level) => { const p = { id: "p" + Date.now(), kind, topic, level, created: new Date().toISOString(), score: "",
    messages: [{ role: "assistant", content: kind === "debate" ? `State your position on: ${topic}. I'll argue the other side.` : "Tell me what happened, from the start." }] }; practices[p.id] = p; return structuredClone(p); },
  practice_reply: async (id, t) => { const p = practices[id]; p.messages.push({ role: "user", content: t }, { role: "assistant", content: "Interesting — but what about the **cost**?" }); return structuredClone(p); },
  practice_finish: async (id) => { const p = practices[id]; p.score = "### Score: 34/50\n- Clarity 8\n- Evidence 6"; return structuredClone(p); },
  set_ai_provider: async (m) => ({ ...(await mockApi.ai_status()), provider: m }),
  ai_status: async () => ({ provider: "auto", has_groq_key: true, groq_models: { chat: "openai/gpt-oss-20b" }, now_now: "local", now_reason: "Groq's tokens ran out - switching back at 10:43 PM", running: true, models: { chat: "qwen3:8b", smart: "qwen3:14b", vision: "qwen2.5vl:7b" }, missing: [], whisper: "small", voices: ["en_US-amy-medium", "en_US-ryan-medium"] }),
  baking_find_image: async (id) => { const r = bakeStore.find((x) => x.id === id); r.image_tried = true; r.image = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 100'><rect width='160' height='100' fill='%23e9c79b'/><circle cx='80' cy='50' r='34' fill='%23c98a4b'/><circle cx='68' cy='40' r='5' fill='%233b2416'/><circle cx='92' cy='55' r='5' fill='%233b2416'/><circle cx='75' cy='64' r='4' fill='%233b2416'/></svg>"; return structuredClone(r); },
  baking_star: async (id) => { const r = bakeStore.find((x) => x.id === id); r.saved = !r.saved; return structuredClone(r); },
  baking_search: async (q) => [{ title: `Best ${q} recipe`, url: "https://www.allrecipes.com/x", site: "allrecipes.com", type: "Website", snippet: `Soft and chewy ${q}s, ready in 30 minutes.` },
    { title: `Easy ${q} in 10 minutes`, url: "https://www.youtube.com/watch?v=x", site: "youtube.com", type: "YouTube", snippet: "Tasty · 8.5 min", thumb: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 100'><rect width='160' height='100' fill='%23d9a066'/><circle cx='80' cy='50' r='30' fill='%238a5a2b'/></svg>" },
    { title: `Viral ${q} hack`, url: "https://www.tiktok.com/@a/video/1", site: "tiktok.com", type: "TikTok", snippet: "", thumb: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 100'><rect width='160' height='100' fill='%23f2d1a8'/><circle cx='80' cy='50' r='26' fill='%23b06c34'/></svg>" },
    { title: `${q} like grandma's`, url: "https://www.instagram.com/p/x", site: "instagram.com", type: "Instagram", snippet: "" }],
  baking_list: async () => bakeStore.map((r) => ({ id: r.id, title: r.title, source: r.source, servings: r.servings, count: r.ingredients.length, saved: !!r.saved, image: r.image || "", image_tried: !!r.image_tried })),
  baking_get: async (id) => structuredClone(bakeStore.find((r) => r.id === id)) || { error: "Recipe not found." },
  baking_save: async (r) => { r = structuredClone(r); r.id ||= "r" + Math.random().toString(36).slice(2, 7); r.ingredients = (r.ingredients || []).map((i) => (typeof i === "string" ? bakeParse(i) : i)); r.steps ||= []; const k = bakeStore.findIndex((x) => x.id === r.id); if (k >= 0) bakeStore[k] = r; else bakeStore.push(r); return structuredClone(r); },
  baking_delete: async (id) => { const k = bakeStore.findIndex((x) => x.id === id); if (k >= 0) bakeStore.splice(k, 1); return { ok: true }; },
  baking_import: async (url) => { const r = { id: "imp" + bakeStore.length, title: "Banana Bread", source: url, servings: 10, ingredients: ["3 ripe bananas", "1/3 cup melted butter", "3/4 cup sugar", "1 egg", "1 teaspoon baking soda", "1 1/2 cups all-purpose flour"].map(bakeParse), steps: ["Preheat the oven to 350 F.", "Mash the bananas and mix with the butter.", "Stir in everything else.", "Bake for 55 to 60 minutes."], nutrition: null }; bakeStore.push(r); return structuredClone(r); },
  baking_convert: async (qty, unit, name) => (unit === "cup" ? [{ label: `${Math.round(qty * 125)} g` }, { label: `${Math.round(qty * 237)} ml` }] : unit === "tsp" ? [{ label: `${(qty * 4.9).toFixed(1)} ml` }] : []),
  baking_alternatives: async (name) => ({ name, options: /egg/.test(name) ? ["1 tbsp ground flaxseed + 3 tbsp water per egg", "1/4 cup applesauce per egg"] : /butter/.test(name) ? ["Same amount of margarine", "3/4 the amount of oil"] : ["Ask me in the real app"] }),
  baking_parse: async (line) => bakeParse(line),
  baking_nutrition: async (id) => { const r = bakeStore.find((x) => x.id === id); r.nutrition = { per: "serving", servings: r.servings || 8, source: "estimated by AI", rows: [{ label: "Calories", value: "210 kcal" }, { label: "Total fat", value: "8 g" }, { label: "Carbohydrates", value: "32 g" }, { label: "Sugar", value: "18 g" }, { label: "Protein", value: "3 g" }] }; return structuredClone(r); },
  gym_routine: async () => structuredClone(routine),
  gym_save_routine: async (r) => { routine = r; return { message: "Routine saved." }; },
  gym_reset_day: async () => { const n = gymLog.length; gymLog.length = 0; return { message: `Fresh start - cleared ${n} sets from today.` }; },
  music: async () => ev({ type: "music", playing: false }),
  gym_state: async (d) => ({ days: [{ day: 1, title: "PUSH" }, { day: 2, title: "PULL" }], day: d || 1, plan: gymPlan, today: { sets: gymLog }, streak: 3, profile: {} }),
  gym_log_set: async (exercise, set, kg, reps) => { gymLog.push({ exercise, set, kg, reps }); return {}; },
  gym_unlog_set: async (e, n) => { gymLog.splice(gymLog.findIndex((s) => s.exercise === e && s.set === n), 1); },
  gym_finish: async () => { const n = gymLog.length; gymLog.length = 0; return n ? { saved: true, message: `Session saved: 0 min, ${n} sets. Nice work!` } : { saved: false, message: "Nothing ticked in this session, so there's nothing to save." }; },
  gym_upgrade_weight: async (name, kg) => { gymPlan.exercises.find((e) => e.name === name).kg = kg; return { kg, message: `${name}: ${kg} kg from now on.` }; },
  gym_import: async () => ({ message: "Imported 7 days." }),
  gym_history: async () => st.gymHist === 0 ? [] : [{ date: "2026-10-19", day: 6, title: "Pull", exercises: 6, sets: 20, volume: 4210, minutes: 72, detail: [{ exercise: "Weighted Chin-Ups", set: 1, kg: 37.5, reps: "12" }] }],
  gym_body: async (p) => {
    const q = p || st.gymProfile || {};
    if (p) st.gymProfile = p;
    const h = +q.height, w = +q.weight, a = +q.age;
    const out = { profile: q, activity: [["none", "No training (desk job)", 1.2], ["light", "Light: 1-3 workouts a week", 1.375], ["moderate", "Moderate: 3-5 workouts a week", 1.55], ["hard", "Hard: 6-7 workouts a week", 1.725], ["athlete", "Very hard: twice a day / physical job", 1.9]] };
    if (!h || !w || !a) return p ? { error: "Type your height (cm), weight (kg) and age." } : out;
    const bmr = 10 * w + 6.25 * h - 5 * a + (q.gender === "female" ? -161 : 5);
    const keep = bmr * ({ none: 1.2, light: 1.375, moderate: 1.55, hard: 1.725, athlete: 1.9 }[q.activity] || 1.55);
    const bmi = Math.round((w / (h / 100) ** 2) * 10) / 10;
    const plan = (key, label, d) => { const wk = (d * 7) / 7700; return { key, label, kcal: Math.round((keep + d) / 10) * 10, kg_week: Math.round(wk * 100) / 100, kg_month: Math.round(wk * 30 / 7 * 10) / 10, weight_in_3_months: Math.round((w + wk * 13) * 10) / 10 }; };
    return { ...out, bmi, category: bmi < 18.5 ? "Underweight" : bmi < 25 ? "Healthy" : bmi < 30 ? "Overweight" : "Obese", bmr: Math.round(bmr), maintenance: Math.round(keep / 10) * 10,
      healthy_weight: [Math.round(18.5 * (h / 100) ** 2 * 10) / 10, Math.round(24.9 * (h / 100) ** 2 * 10) / 10], protein_g: [Math.round(w * 1.6), Math.round(w * 2.2)],
      plans: [plan("cut", "Deficit (lose fat)", -500), plan("mild_cut", "Small deficit", -250), plan("keep", "Maintenance", 0), plan("lean_bulk", "Lean bulk", 250), plan("bulk", "Bulk (gain)", 500)] };
  },
  gym_monthly: async () => {
    const ms = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const ex = (base, step) => ms.map((m, i) => ({ month: m, best: base + i * step, reps: 8 + (i % 3), e1rm: Math.round((base + i * step) * 1.27), volume: Math.round((base + i * step) * 30 * (3 + (i % 2))), sets: 9 + i * 2, days: 4 + i }));
    return { exercises: { "Bench press": ex(50, 2.5), "Squat": ex(70, 5), "Lat pulldown": ex(45, 2.5) }, body: ms.map((m, i) => ({ month: m, weight: 72 + i * 0.4 })),
      stat_fields: ["weight", "biceps_r", "biceps_l", "thigh_r", "thigh_l", "chest", "waist"],
      stats: [{ label: "Week 1", weight: 87.2, biceps_r: 34.5 }, { label: "Week 2", weight: 88.5, biceps_r: 35, chest: 105.5 }, { label: "2026-10-27", weight: 87.9, biceps_r: 35.4, chest: 106 }] };
  },
  gym_meals: async (goal = "recomp", meals = 4, dishes = []) => {
    if (!st.gymProfile) return { error: "Fill in the Calories tab first (height, weight, age) - the meal plan is made from it." };
    const w = +st.gymProfile.weight, k = { bulk: 2900, cut: 2100, recomp: 2600 }[goal];
    const names = { 2: ["Lunch", "Dinner"], 3: ["Breakfast", "Lunch", "Dinner"], 4: ["Breakfast", "Lunch", "Snack", "Dinner"],
      5: ["Breakfast", "Morning snack", "Lunch", "Afternoon snack", "Dinner"], 6: ["Breakfast", "Morning snack", "Lunch", "Afternoon snack", "Dinner", "Evening snack"] }[meals] || [];
    const dishList = ["Chicken rice bowl", "Overnight oats", "Beef stir-fry", "Protein shake"];
    const meal = (name, i) => { const pick = (dishes[i] ?? i) % 4, f = 1 / names.length * 4;
      return { name, dish: dishList[pick], how: "Mock: cook it, eat it.", pick, choices: 4,
        items: [{ food: "Chicken breast", grams: Math.round(150 * f) }, { food: "Rice", grams: Math.round(200 * f) }, { food: "Vegetables", grams: 150 }],
        kcal: Math.round(k / names.length), protein: Math.round(50 * f), fat: Math.round(20 * f), carbs: Math.round(80 * f) }; };
    return { goal, label: goal, note: "Mock meal plan.", kcal: k, protein: Math.round(w * 2), fat: Math.round(w * 0.9), carbs: 250, maintenance: 2600,
      meals: names.map(meal), meal_count: meals, meal_options: [2, 3, 4, 5, 6], totals: { kcal: k, protein: Math.round(w * 2), fat: Math.round(w * 0.9), carbs: 250 },
      goals: [["bulk", "Bulk"], ["cut", "Cut"], ["recomp", "Recomposition"]] };
  },
  gym_muscles: async (names) => Object.fromEntries((names || []).map((n) => [n, ["chest", "triceps"]])),
  gym_stats: async () => ({ fields: ["weight", "biceps_r", "biceps_l", "thigh_r", "thigh_l", "chest", "waist"], stats: [{ date: "Week 1", weight: 87.2, biceps_r: 34.5 }, { date: "Week 2", weight: 88.5, chest: 105.5 }] }),
  gym_add_stats: async (v) => v,
  gym_alternatives: async (q) => ({ query: q, kind: "exercise", title: `Alternatives to ${q}`, people: { "Jeff Nippard": "Science-based coach" },
    match: { name: q, stars: 5, used_by: ["Jeff Nippard"], equipment: "barbell", why: "Classic.", source: "built-in" },
    alternatives: [{ name: "Incline Dumbbell Press", stars: 5, used_by: ["Jeff Nippard"], equipment: "dumbbells", why: "Upper chest.", source: "built-in" },
      { name: "Band Chest Press", stars: 0, used_by: [], equipment: "band", why: "Weakest swap.", source: "built-in" }] }),
  plugins_status: async () => ({ fresh: false, hidden_panels: [], plugins: [
    { id: "gym", name: "Gym", icon: "🏋", group: "Features", desc: "Workout and timer.", size: "~10 MB", installed: true, used_mb: 0, missing_pip: [], pip_command: "python -m pip install openpyxl", pack: false, pack_mb: 0, restorable: true, busy: false, log: [] },
    { id: "kitchen", name: "Kitchen", icon: "🍳", group: "Features", desc: "Recipes and baking.", size: "~5 MB", installed: false, used_mb: 0, missing_pip: [], pip_command: "", zip: "kitchen", on_drive: true, pack: false, pack_mb: 0, restorable: true, busy: true, pct: 42, step: "Downloading kitchen.zip… 68%", log: [] },
    { id: "adventure", name: "Adventure", icon: "🗺", group: "Features", desc: "The story game.", size: "~400 MB", installed: false, used_mb: 0, missing_pip: [], pip_command: "", zip: "adventure", on_drive: true, pack: false, pack_mb: 0, restorable: true, busy: false, error: "❌ Couldn't reach Google Drive - check your internet and press Install again.", log: [] }] }),
  plugins_install_many: async () => ({ started: 0, errors: ["(preview) nothing installed"], status: await mockApi.plugins_status() }),
  plugin_uninstall: async () => ({ message: "(preview) uninstalled", status: await mockApi.plugins_status() }),
  plugin_install: async (id) => { setTimeout(() => { st.plugins = { hidden_panels: [], owner: {}, fresh: false }; ev({ type: "plugin", id, state: "done", text: `Installed ${id}.` }); }, 800); return { message: `(preview) installing ${id}…`, started: true }; },
  plugins_first_run_done: async () => mockApi.plugins_status(),
  plugin_set_link: async (id, url) => { st.pluginLink = (url || "").trim(); return { ok: true }; },
  elec_formulas: async () => ({ ohm: { name: "Ohm's law & power", help: "Fill in any two.", fields: [["V", "Voltage", "V"], ["R", "Resistance", "Ω"]] } }),
  elec_calc: async () => ({ results: [["Current", "22.7 mA"]], steps: ["I = V / R"], notes: [] }),
  elec_ask: async () => ({ answer: "**(preview)** Vermeil's answer appears here.", lab: null }),
  elec_projects: async () => [],
  elec_pending: async () => null,
  elec_chat: async (m) => ({ reply: `**(preview)** Let's measure first: set the multimeter to DC V and check the servo rail while it moves. *(you said: ${m})*`, build: /robot|dog/i.test(m) ? "a robot dog with 8 MG996R servos" : null,
    log: { measured: ["servo rail 4.1 V under load"], ruled_out: ["bad servo"], worked: [], open: "servo jitter" } }),
  elec_chat_state: async () => ({ history: [], log: { measured: [], ruled_out: [], worked: [], open: "" } }),
  elec_chat_clear: async () => ({ history: [], log: { measured: [], ruled_out: [], worked: [], open: "" } }),
  build_pending: async () => true,
  gen_start: async (kind, o) => { const job = "g" + Date.now(); let p = 0; const t = setInterval(() => { p += 0.25; ev({ type: "gen", job, progress: Math.min(1, p), text: p < 1 ? `(preview) working… ${Math.round(p * 100)}%` : "Done!", ...(p >= 1 ? { state: "done", result: kind === "presentation" ? { file: "C:/x.pptx", slides: [{ title: "a" }], ai: true } : { files: ["C:/x.png"] } } : {}) }); if (p >= 1) clearInterval(t); }, 400); return { job }; },
  gen_pick_pdfs: async () => ["C:/Users/you/Documents/notes.pdf"],
  gen_recent: async () => ({ files: [{ path: "C:/a.png", name: "a cozy cabin 1.png", kind: "png", size_kb: 812, saved: "2026-10-23 10:00" }, { path: "C:/b.pptx", name: "The water cycle.pptx", kind: "pptx", size_kb: 2400, saved: "2026-10-23 10:05" }, { path: "C:/c.mp4", name: "Volcanoes.mp4", kind: "mp4", size_kb: 3600, saved: "2026-10-23 10:09" }], folder: "C:/Users/you/Documents/Vermeil Creations" }),
  gen_open: async () => ({ ok: true }),
  gen_preview: async () => ({ error: "preview" }),
  journal_list: async (k) => ({ items: journal.filter((e) => !k || e.kind === k), review: ["a1"] }),
  journal_add: async (i) => { const e = { id: String(Math.random()).slice(2, 8), created: new Date().toISOString(), status: "open", outcome: "", steps: (i.steps || "").split("\n").filter(Boolean).map((t) => ({ text: t, done: false })), ...i }; journal.push(e); return e; },
  journal_update: async (id, c) => { const e = journal.find((x) => x.id === id); if (c.toggle_step != null) e.steps[c.toggle_step].done ^= 1; if (c.add_step) e.steps.push({ text: c.add_step, done: false }); Object.assign(e, { outcome: c.outcome ?? e.outcome, status: c.status ?? e.status }); return e; },
  journal_remove: async (id) => { journal.splice(journal.findIndex((x) => x.id === id), 1); return true; },
  think: async (m, q) => new Promise((r) => setTimeout(() => r({ answer: `## ${m}\n- Thought about **${q}**\n- Next step: start small.`,
    parts: m === "council" ? [{ role: "Researcher", text: "Facts..." }, { role: "Critic", text: "Risks..." }] : [] }), 600)),
  recall: async (q) => [{ source: "chat", date: "", text: `user: something about ${q} / assistant: yes` }],
  get_state: async () => structuredClone({ ...st, performance: mockPerf }),
  performance_status: async () => structuredClone(mockPerf),
  performance_rescan: async () => structuredClone(mockPerf),
  phone_status: async () => structuredClone(mockPhone),
  phone_set: async (on, method) => { Object.assign(mockPhone, { on, method: method || mockPhone.method, url: on ? "https://example-words.trycloudflare.com" : null });
    mockPhone.pair = on ? mockPhone.url + "/#key=mock-key-not-real" : null; return structuredClone(mockPhone); },
  phone_new_key: async () => structuredClone(mockPhone),
  partner_start: async (language) => { setTimeout(() => ev({ type: "partner", event: "start", language, name: "Japanese", session: { messages: [{ content: "こんにちは！今日はどうでしたか？" }] } }), 200); return { ok: true }; },
  partner_stop: async () => { ev({ type: "partner", event: "stop", score: "8/10" }); return { ok: true, message: "Practice finished." }; },
  character_export: async () => ({ message: "Saved Vermeil (12.3 MB, with 3D model). Send the file to a friend." }),
  character_import: async () => null,
  list_devices: async (fresh) => { await new Promise((r) => setTimeout(r, fresh ? 900 : 300)); return { cameras: [{ index: 0, name: "Integrated Webcam", ok: true }, { index: 1, name: "OBS Virtual Camera", ok: true }],
    mics: [{ index: 1, name: "Microphone Array (Realtek)", default: true }, { index: 3, name: "Headset Microphone (USB)", default: false }], camera: st.camIdx ?? -1, mic: st.micIdx ?? -1 }; },
  set_devices: async (c, m) => { if (c != null) st.camIdx = c; if (m != null) st.micIdx = m; return mockApi.list_devices(); },
  boot: async () => true,
  chat: async (t) => {
    if (/weather/i.test(t)) { ev({ type: "ask", text: "Which city?" }); return null; }
    ev({ type: "speaking", on: true }); setTimeout(() => ev({ type: "speaking", on: false }), 2500);
    return `Mmm~ you said “${t}”.`;
  },
  set_listening: async (on) => (st.listening = on),
  set_camera: async (on) => { st.camera = on; ev({ type: "camera", status: on ? "on" : "off" });
    if (on) setTimeout(() => ev({ type: "presence", present: true, who: st.owner ? "owner" : "someone", name: st.owner, x: 0.3, y: 0.4 }), 300); return on; },
  set_preview: async () => true,
  enroll_face: async (n, owner = true, relation = "") => { ev({ type: "enroll", status: "started", progress: 0 });
    if (owner) st.owner = n; else st.people.push({ name: n, relation, samples: 8 });
    setTimeout(() => ev({ type: "enroll", status: "done", name: n, owner }), 800); return true; },
  known_people: async () => structuredClone(st.people),
  chat_history: async () => st.history.map((m, i) => ({ ...m, i })),
  chat_edit: async (i, t) => { st.history[i].text = t; return st.history.map((m, j) => ({ ...m, i: j })); },
  chat_delete: async (i) => { st.history.splice(i, st.history[i]?.who === "you" ? 2 : 1); return st.history.map((m, j) => ({ ...m, i: j })); },
  chat_search: async (q) => [{ source: "chat", date: "", text: `user: I love ${q} / assistant: Me too~` }, { source: "file bio.pdf p.2", date: "2026-10-01", text: `Notes about ${q}…` }],
  our_story: async () => ({ first_met: "2026-08-02", days_known: 81, days_talked: 54, messages: 1210, streak: 6, timeline: [
    { type: "milestone", date: "2026-10-12", text: "50 days of talking together" },
    { type: "moment", date: "2026-10-05", text: "You told me you hit a new bench PR — 80 kg!" },
    { type: "milestone", date: "2026-09-01", text: "1000 messages exchanged" },
    { type: "milestone", date: "2026-08-02", text: "The day we first talked 💬" }] }),
  story_add: async () => mockApi.our_story(), story_remove: async () => mockApi.our_story(),
  recommend_ui: async (c) => ({ items: [{ title: "Your Name (2016)", why: "You love anime with great music." }, { title: "Atomic Habits", why: "Fits your gym and study goals." }, { title: "Tonkotsu ramen in Malate", why: "You said ramen is your comfort food." }] }),
  rate_recommendation: async () => true,
  screens_list: async () => [{ file: "a.jpg", at: "2026-10-20 21:14", question: "why is this error happening?", text: "A Python ModuleNotFoundError: No module named 'psutil'. Run pip install psutil." }],
  screen_image: async () => null, screen_delete: async () => [],
  missions_list: async () => structuredClone(st.missions),
  mission_create: async (goal) => { const m = { id: "m" + st.missions.length, goal, title: goal.slice(0, 40), status: "active", created: Date.now() / 1000,
    steps: [{ text: "Search the web for options", status: "running", result: "", wait_hours: 0, at: Date.now() / 1000 }, { text: "Compare them in a table", status: "pending", result: "", wait_hours: 0, at: null }, { text: "Tell the user the best pick", status: "pending", result: "", wait_hours: 2, at: null }], log: [] };
    st.missions.unshift(m); setTimeout(() => { m.steps[0].status = "done"; m.steps[0].result = "Found 5 laptops: Acer Swift Go 14, ASUS Vivobook S14…"; m.steps[1].status = "running"; ev({ type: "mission", mission: structuredClone(m) }); }, 1200); return { mission: structuredClone(m) }; },
  mission_action: async (id, a) => { const m = st.missions.find((x) => x.id === id); if (a === "delete") st.missions = st.missions.filter((x) => x.id !== id);
    else if (m) m.status = { pause: "paused", resume: "active", cancel: "cancelled" }[a] || m.status; return { missions: structuredClone(st.missions) }; },
  approve: async () => true,
  spotify_status: async () => ({ has_keys: !!st.spKeys, connected: !!st.spOn, redirect_uri: "http://127.0.0.1:8888/callback", env_file: "env",
    client_id_hint: st.spKeys ? "1a2b…9f0e" : "", user: st.spOn ? "JP" : null, source: st.settings.music_source || "auto", using: !!st.spOn }),
  spotify_save_keys: async () => { st.spKeys = true; return mockApi.spotify_status(); },
  spotify_connect: async () => { setTimeout(() => { st.spOn = true; mockApi.spotify_status().then((s2) => ev({ type: "spotify_login", ok: true, status: s2 })); }, 900); return { started: true }; },
  spotify_logout: async () => { st.spOn = false; return mockApi.spotify_status(); },
  spotify_now: async () => st.spOn ? { active: true, playing: st.spPlaying ?? true, progress: 74, shuffle: false, repeat: "off", volume: 62, device: "JP-PC",
    track: { title: "Sunrise", artist: "Rex Orange County", album: "Pony", uri: "spotify:track:1", duration: 211, image: "", small_image: "" } } : { error: "Spotify isn't connected yet." },
  spotify_cmd: async (a) => { if (a === "pause") st.spPlaying = false; if (a === "resume") st.spPlaying = true; return { message: "ok" }; },
  spotify_is_liked: async () => false,
  mm: async (action, ...a) => {
    const t = (n) => `https://i.ytimg.com/vi/${["xFYQQPAOz7Y", "PsO6ZnUZI0g", "ytQ5CYE1VZw", "L53gjP-TtGE"][n % 4]}/hqdefault.jpg`;
    const songs = [["Lose Yourself", "Eminem", 326], ["Stronger", "Kanye West", 267], ["Till I Collapse", "Eminem", 297], ["Power", "Kanye West", 292]]
      .map(([title, artist, duration], i) => ({ title, artist, duration, yt: `v${i}`, thumb: t(i) }));
    const pl = { id: "p1", name: "Gym Hype", description: "Heavy sets only.", color: "#e8115b", created: "2026-10-22", count: 4, minutes: 20, covers: songs.map((s) => s.thumb), songs };
    return { library: { playlists: [pl], liked: 12 }, playlist: pl, search: songs, recent: songs.map((s) => ({ ...s, played: "2026-10-22 20:10" })),
      now: { playing: true, paused: false, song: songs[0], liked: true, position: 74, length: 326, queue: ["Stronger — Kanye West", "Power — Kanye West"] },
      create: { ...pl, id: "p2", name: a[0] || "New", songs: a[2] || [], count: (a[2] || []).length },
      analysis: null, analyse: { id: "p1", name: "Gym Hype", analysed: "now", stats: { songs: 4, total_minutes: 20, artists: 2, variety: 50, top_artists: [{ name: "Eminem", songs: 2 }, { name: "Kanye West", songs: 2 }] },
        ai: { genres: [{ name: "hip hop", pct: 80 }, { name: "rap rock", pct: 20 }], eras: [{ decade: "2000s", pct: 100 }], moods: ["intense"], energy: 9, tempo: "fast", vibe: "Loud gym rap.", name_ideas: ["Beast Mode"] } },
      make: { ...pl, id: "p3", name: "Beast Mode", message: "(preview) Made 'Beast Mode'." },
      to_lyrics: { ...pl, songs: songs.map((x) => ({ ...x, lyric: true })), changed: 4, message: "Switched 4 songs to lyric videos." },
      lyrics: { source: "LRCLIB (synced to the song, free)", title: "Lose Yourself", artist: "Eminem", plain: "",
        synced: Array.from({ length: 40 }, (_, i) => ({ t: 60 + i * 3.5, line: `(preview) line ${i + 1} of the song` })) },
      like_this: { message: "Songs like Lose Yourself: Playing 12 songs." },
      listen: { title: "Blinding Lights", artist: "The Weeknd", cover: "", link: "", at: "2026-10-31 20:15" },
      heard: { heard: [{ title: "Blinding Lights", artist: "The Weeknd", cover: "", link: "", at: "2026-10-31 20:15" }] },
      make_cover: { ...pl, cover: "" },
      watch_list: { items: st.watch ||= [
        { id: "w1", title: "Spirited Away", kind: "movie", year: "2001", genres: ["Animation", "Fantasy"], where: ["Netflix"], about: "A girl in a spirit world.", checked: "2026-10-31", country: "PH", watched: false },
        { id: "w2", title: "Arcane", kind: "show", year: "2021", genres: ["Animation", "Action"], where: ["Netflix"], about: "", watched: true, rating: 5 }],
        genres: ["Action", "Comedy", "Drama", "Horror", "Romance", "Sci-fi", "Fantasy", "Animation", "Thriller", "Documentary"], kinds: ["movie", "show", "anime"] },
      watch_suggest: { picks: [{ title: "Your Name", year: "2016", kind: "movie", genres: ["Romance", "Animation"], why: "Like Spirited Away: beautiful and emotional.", where: ["Netflix"] }] },
    }[action] ?? { message: `(preview) ${action}` };
  },
  playlab_list: async () => ({ items: [{ id: "p1", name: "Gym Hype", songs: 42, analysed: "2026-10-22 21:00" }] }),
  playlab_analyse: async () => mockApi.playlab_get("p1"),
  playlab_get: async () => ({ id: "p1", name: "Gym Hype", owner: "JP", image: "", analysed: "2026-10-22 21:00",
    stats: { songs: 42, total_minutes: 151, artists: 23, oldest: 1999, newest: 2025, explicit_pct: 64, variety: 55, popularity: 71,
      decades: [{ decade: "1990s", songs: 3, pct: 7 }, { decade: "2000s", songs: 14, pct: 33 }, { decade: "2010s", songs: 17, pct: 40 }, { decade: "2020s", songs: 8, pct: 20 }],
      top_artists: [{ name: "Eminem", songs: 6 }, { name: "Kanye West", songs: 4 }, { name: "Travis Scott", songs: 3 }] },
    ai: { genres: [{ name: "hip hop", pct: 55 }, { name: "trap", pct: 25 }, { name: "rap rock", pct: 20 }], moods: ["intense", "confident", "aggressive"], energy: 9,
      tempo: "fast", vibe: "Loud, hard-hitting rap for heavy sets.", best_for: ["lifting", "running"], similar_artists: ["DMX", "Run The Jewels"], name_ideas: ["Beast Mode"] } }),
  playlab_make: async () => ({ name: "Beast Mode", uri: "spotify:playlist:x", url: "", message: "(preview) Made 'Beast Mode' with 2 songs.",
    added: [{ title: "X Gon' Give It to Ya", artist: "DMX" }, { title: "Power", artist: "Kanye West" }], not_found: [] }),
  playlab_youtube: async () => ({ message: "(preview) queued on YouTube" }),
  spotify_search: async (q) => ({ tracks: [{ title: "Feel It Still", artist: "Portugal. The Man", uri: "spotify:track:2" }, { title: q, artist: "Someone", uri: "spotify:track:3" }],
    artists: [{ name: "Rex Orange County", uri: "spotify:artist:1", image: "" }], albums: [{ name: "Pony", artist: "Rex Orange County", uri: "spotify:album:1", image: "" }],
    playlists: [{ name: "Chill Vibes", owner: "Spotify", uri: "spotify:playlist:1", image: "" }] }),
  spotify_library: async (w) => ({ items: w === "playlists" ? [{ name: "Gym Hype", uri: "p1", owner: "JP", count: 42 }, { name: "Study Lofi", uri: "p2", owner: "JP", count: 120 }]
    : [{ title: "Loving Is Easy", artist: "Rex Orange County", uri: "t9" }, { title: "Best Friend", artist: "Rex Orange County", uri: "t8" }] }),
  code_new_project: async (n) => ({ workspace: `C:\\Users\\jpant\\Documents\\Vermeil Projects\\${n}`, history: [] }),
  code_open_editor: async () => "Opened it in VS Code.",
  gym_clear_history: async () => { const n = (st.gymHist ||= 3); st.gymHistCleared = n; st.gymHist = 0; return { cleared: n }; },
  gym_undo_clear: async () => { st.gymHist = st.gymHistCleared || 0; return { restored: st.gymHist }; },
  compare_sources: async () => ({ verdict: "Mostly true — most sources say 7-9 hours for adults.", agree: ["Adults need at least 7 hours (1,2,3)"],
    conflicts: [{ topic: "Teenagers", sides: ["Source 1 says 8-10 hours", "Source 3 says 9-11 hours"], likely_right: "Source 1 — it's the official sleep foundation guideline." }],
    reliability: [{ source: 1, rating: "high", why: "official body" }, { source: 2, rating: "medium" }, { source: 3, rating: "low", why: "blog" }],
    sources: [{ n: 1, site: "sleepfoundation.org", title: "How much sleep do we need?", url: "https://x" }, { n: 2, site: "healthline.com", title: "Sleep needs", url: "https://y" }, { n: 3, site: "someblog.net", title: "Sleep tips", url: "https://z" }] }),
  gcal_status: async () => ({ libs: true, has_credentials: false, connected: false }),
  gcal_choose_file: async () => ({ libs: true, has_credentials: true, connected: false }),
  gcal_connect: async () => { setTimeout(() => ev({ type: "gcal", libs: true, has_credentials: true, connected: true }), 800); return { started: true }; },
  gcal_disconnect: async () => ({ libs: true, has_credentials: true, connected: false }),
  wake_status: async () => ({ trained: !!st.wakeTrained, samples: st.wakeClips || 0, when: st.wakeTrained ? "2026-10-21 01:40" : null, sensitivity: st.settings.wake_sensitivity }),
  wake_record: async () => { await new Promise((r) => setTimeout(r, 400)); st.wakeClips = (st.wakeClips || 0) + 1; return { ok: true, samples: st.wakeClips, seconds: 0.6 }; },
  wake_train: async () => { st.wakeTrained = true; st.wakeClips = 0; return { ok: true, samples: 4, spread: 0.7, length: 0.6, trained: true, when: "2026-10-21 01:40", sensitivity: 2 }; },
  wake_test: async () => ({ match: true, score: 0.62, threshold: 0.83 }),
  wake_clear: async () => { st.wakeTrained = false; st.wakeClips = 0; return mockApi.wake_status(); },
  forget_person: async (n) => { st.people = st.people.filter((p) => p.name !== n); return true; },
  emote: async (n) => { ev({ type: "emote", name: n }); return true; },
  check_gesture: async () => { ev({ type: "gesture", gesture: "thumbs_up" }); return { gesture: "thumbs_up" }; },
  group_chat: async (topic) => { const lines = [["Vermeil", "So, " + topic + "? I have opinions!"], ["Pip", "Of course you do. Mine are better."], ["Vermeil", "Hmm… let me think. No."]];
    lines.forEach(([sp, t], i) => setTimeout(() => ev({ type: "group_line", speaker: sp, id: sp, text: t }), 900 * (i + 1)));
    setTimeout(() => ev({ type: "group_done" }), 900 * 4); return { message: "Talking." }; },
  forget_face: async () => { st.owner = null; return true; },
  save_settings: async (d) => Object.assign(st.settings, d),
  set_active: async (id) => { st.active = id; return structuredClone(st); },
  chatter_status: async () => ({ ready: true, hint: "Ready (runs on your PC)." }),
  make_personality: async (who, name) => { await new Promise((r) => setTimeout(r, 600));
    return { name: who, prompt: `You are ${name || who}. You talk exactly like ${who}: same words, same attitude, same catchphrases. (preview text)` }; },
  save_character: async (d) => { let c = st.characters.find((x) => x.id === d.id);
    if (!c) { c = { id: Math.random().toString(16).slice(2, 8) }; st.characters.push(c); }
    Object.assign(c, d, { id: c.id }); return { id: c.id, state: structuredClone(st) }; },
  delete_character: async (id) => { st.characters = st.characters.filter((c) => c.id !== id);
    if (st.active === id) st.active = st.characters[0].id; return { state: structuredClone(st) }; },
  import_model: async () => null,
  save_rigged_model: async (name) => ({ name }),            // the dev page can't write files; pretend it saved
  unimate_status: async () => ({ ready: false, hint: "UniMate isn't set up yet. Double-click scripts\\setup_unimate.bat (mock)." }),
  unimate_animate: async () => ({ error: "UniMate isn't set up (mock)." }),
  unimate_cancel: async () => true,
  app_update: async () => {
    let pct = 0;
    const tick = setInterval(() => {
      pct += 0.2;
      window.onPyEvent?.(pct >= 1 ? { type: "app_update", done: true, ok: true, changed: 12, message: "Updated to the newest version (12 files changed) (mock). Restart Vermeil to use it." }
        : { type: "app_update", pct, text: `Downloading the new version… ${Math.round(pct * 60)} of 60 MB` });
      if (pct >= 1) clearInterval(tick);
    }, 400);
    return { started: true };
  },
  app_update_check: async () => ({ branch: "main", new: true }),
  app_restart: async () => ({ ok: true }),
  unimate_setup: async () => ({ started: true, hint: "Getting UniMate ready in the background (mock)." }),
  voice_commands: async () => ({ features: [
    { id: "chat", name: "Chat", icon: "💬", installed: true, say: [{ say: "open chat", does: "shows your conversation" }, { say: "wave · dance · jump", does: "she does it in her room" }] },
    { id: "gym", name: "Gym", icon: "🏋", installed: true, say: [{ say: "open the gym", does: "shows the Gym" }, { say: "start a 90 second timer", does: "the rest timer" }] },
    { id: "generator", name: "Generator", icon: "🎨", installed: false, say: [{ say: "open the generator", does: "shows the Generator" }] }] }),
  planner_month: async () => { const t = new Date(); const k = (d) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return { [k(t.getDate())]: { event: 1, task: 1, reminder: 1 }, [k(Math.min(28, t.getDate() + 2))]: { birthday: 1 }, [k(Math.min(28, t.getDate() + 5))]: { weekly: 1, event: 2 } }; },
  planner_day: async () => [
    { kind: "reminder", title: "Water plants", time: "08:00", detail: "repeats daily", key: "Water plants" },
    { kind: "task", title: "Finish lab report", time: "10:00", detail: "priority high", done: false, key: "Finish lab report" },
    { kind: "event", title: "Dentist", time: "15:00", detail: "bring card", key: "Dentist" }],
  planner_add: async (i) => ({ message: `Added ${i.title}.` }),
  planner_toggle_task: async () => "ok",
  study_drives: async () => ({ drives: [{ path: "E:\\", label: "KINGSTON (E:)" }] }),
  study_scan: async (path) => ({ path: path || "E:\\", files: [
    { path: "E:\\Lectures\\Week 1 - Beams.mp4", name: "Week 1 - Beams.mp4", folder: "Lectures", size: 412e6, video: true },
    { path: "E:\\Slides\\Shear and moment.pdf", name: "Shear and moment.pdf", folder: "Slides", size: 2.4e6, video: false },
    { path: "E:\\Problem set 2.docx", name: "Problem set 2.docx", folder: ".", size: 0.3e6, video: false }] }),
  study_add_paths: async (paths) => {
    const vids = paths.filter((p) => /\.mp4$/i.test(p));
    let pct = 0;
    if (vids.length) {
      const t = setInterval(() => {
        pct += 0.25;
        window.onPyEvent?.(pct >= 1 ? { type: "study_media", name: "Week 1 - Beams.mp4", done: true, entry: { id: "mockvid" } }
          : { type: "study_media", name: "Week 1 - Beams.mp4", pct, text: `Writing down what's said… ${Math.round(pct * 50)}:00 of 50:00` });
        if (pct >= 1) clearInterval(t);
      }, 500);
    }
    return { added: [], errors: [], videos: vids, files: [], reviews: [], review_types: {}, kinds: [] };
  },
  study_files: async () => ({ files: [
      { id: "a1", name: "Lecture 5 - Beams.pdf", kind: "lecture", subject: "Structural Analysis", pages: 34, added: "2026-10-20 18:00" },
      { id: "a2", name: "Problem Set 3.pdf", kind: "problems", subject: "Structural Analysis", pages: 6, added: "2026-10-20 18:01" },
      { id: "a3", name: "Scanned notes.pdf", kind: "lecture", subject: "Hydraulics", pages: 12, added: "2026-10-20 18:02", scanned: true }],
    reviews: [{ id: "r1", title: "Fill in the blanks: Lecture 5 - Beams.pdf", type: "fill_blanks", count: 3, difficulty: "medium", created: "2026-10-20 18:10", best: 67 }],
    review_types: { fill_blanks: "Fill in the blanks", mcq: "Multiple choice quiz", flashcards: "Flashcards", problems: "Practice problems with worked solutions", true_false: "True or false", summary: "Summary reviewer (key points)" },
    kinds: ["lecture", "problems", "solutions", "other"] }),
  study_review: async () => ({ id: "r1", type: "fill_blanks", title: "Fill in the blanks: Lecture 5 - Beams.pdf", items: [
    { sentence: "For a simply supported beam with a midspan point load, M_max = ____.", answer: "PL/4", source: "Lecture 5 - Beams.pdf, p. 12" },
    { sentence: "The ____ force acts parallel to the cross-section.", answer: "shear", source: "Lecture 5 - Beams.pdf, p. 3" },
    { sentence: "Concrete cover protects steel from ____.", answer: "corrosion", source: "Lecture 5 - Beams.pdf, p. 30" }] }),
  study_check_blank: async (g, it) => g.trim().toLowerCase() === String(it.answer).toLowerCase(),
  study_save_score: async () => 100,
  study_research: async () => ({ answer: "Concrete reaches about **70%** of its design strength after 7 days of moist curing (Neville & Brooks, 2010), while low temperatures slow strength gain (Kim et al., 2002).", dropped: 1, sources: [
    { apa: "Kim, J. K., Han, S. H., & Song, Y. C. (2002). Effect of temperature and aging on the mechanical properties of concrete. Cement and Concrete Research, 32(7), 1087-1094. https://doi.org/10.1016/S0008-8846(02)00744-9", url: "https://doi.org/10.1016/S0008-8846(02)00744-9", scholarly: true },
    { apa: "Neville, A. M., & Brooks, J. J. (2010). Concrete technology (2nd ed.). Pearson Education.", url: "", scholarly: false }] }),
  study_assignment: async () => ({ answer: "## Step 1\nDraw the free-body diagram.\n\n## Step 2\nTake moments about A: `R_B = P/2`.", used: ["Lecture 5 - Beams.pdf, p. 12"] }),
  study_ai_detect: async (text) => {
    const sents = text.split(/(?<=[.!?])\s+/).filter((x) => x.trim());
    const hits = ["moreover", "furthermore", "delve", "crucial", "it is important to note"].filter((p) => text.toLowerCase().includes(p));
    const score = Math.min(95, 20 + hits.length * 15);
    return { score, stats_score: score, model_score: null, verdict: score >= 70 ? "Likely AI-written" : score >= 45 ? "Mixed: parts read like AI" : "Reads human-written",
      words: text.split(/\s+/).length, sentences: sents.length,
      parts: { "Even sentence lengths": 60, "Stock AI phrases": Math.min(100, hits.length * 30), "Same sentence openers": 20, "No personal voice": 80, "No contractions": 90 },
      flagged: sents.filter((x) => hits.some((p) => x.toLowerCase().includes(p))).map((x) => ({ sentence: x.trim(), why: hits.filter((p) => x.toLowerCase().includes(p)).join(", ") })) };
  },
  study_humanize: async (text) => ({ text: `(Rewritten in a human voice) ${text}`, before: 78, after: 22, after_verdict: "Reads human-written", changes: [{}] }),
  study_paraphrase: async (text, style) => ({ paraphrase: `(Paraphrased in ${style || "standard"} style):\n${text}` }),
  study_grammar_check: async (text, tone) => ({
    corrected: `(Polished in ${tone || "academic"} tone):\n${text}`,
    summary: "Fixed grammar, subject-verb agreement, and polished sentence flow.",
    score: 96,
    changes: [
      { original: "sample typo", corrected: "polished text", type: "grammar", explanation: "Corrected grammar structure." },
    ],
  }),
  study_import_file_data: async (filename, b64, kind, subject) => ({
    added: [{ id: "mock_" + Date.now(), name: filename, kind: kind || "lecture", subject: subject || "General", pages: 10, added: "Just now" }],
    errors: [],
    files: [
      { id: "mock_" + Date.now(), name: filename, kind: kind || "lecture", subject: subject || "General", pages: 10, added: "Just now" },
      { id: "a1", name: "Lecture 5 - Beams.pdf", kind: "lecture", subject: "Structural Analysis", pages: 34, added: "2026-10-20 18:00" },
    ],
    reviews: [],
    review_types: {},
    kinds: ["lecture", "problems", "solutions", "other"],
  }),
  code_state: async () => ({ workspace: "C:\\Users\\jpant\\Desktop\\coding\\2025\\2025", history: [{ role: "user", content: "my add function is wrong" }, { role: "assistant", content: "Found it: `add()` used **minus**. I fixed it." }] }),
  code_ask: async () => { setTimeout(() => window.onPyEvent({ type: "code_approve", id: "x", kind: "edit", path: "calc.py", reason: "fix add", diff: "--- a/calc.py\n+++ b/calc.py\n@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n" }), 200); return { reply: "I've proposed a fix. Approve it above." }; },
  code_decide: async () => true, code_clear: async () => ({ workspace: null, history: [] }), code_choose_folder: async () => ({ workspace: "C:\\proj", history: [] }),
  open_url: async () => true, study_open_file: async () => true,
  get_planner: async () => ({
    events: [{ title: "Dentist", date: new Date().toISOString().slice(0, 10), time: "15:00", notes: "bring card" },
             { title: "Thesis meeting with Engr. Marcos", date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), time: "10:00" },
             { title: "Mom's birthday dinner", date: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), time: null }],
    reminders: [{ event: "Call mom", date_time: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + " 17:00" }],
    tasks: [{ task: "Finish chapter 4 revisions", priority: "high", deadline: "2026-10-25" }, { task: "Laundry", priority: "low" }],
    schedule: { Monday: [{ activity: "Gym", time: "17:00" }] },
    shopping: { other: ["eggs", "milk"], grains: ["rice"] },
    birthdays: [{ name: "Mia", date: "10-22" }],
    notes: ["buy batteries"],
  }),
  planner_remove: async () => mockApi.get_planner(),
  save_ui: async (u) => Object.assign(st.ui, u),
  get_preferences: async () => ({ ...st.prefs }),
  forget_preference: async (k) => { if (k == null) st.prefs = {}; else delete st.prefs[k]; return { ...st.prefs }; },
  load_room: async () => JSON.parse(localStorage.getItem("room") || "null"),
  save_room: async (l) => { localStorage.setItem("room", JSON.stringify(l)); return true; },
  list_voices: async () => [
    { id: "en-US-AriaNeural", name: "Aria", gender: "Female", locale: "en-US", language: "English (US)" },
    { id: "en-US-GuyNeural", name: "Guy", gender: "Male", locale: "en-US", language: "English (US)" },
    { id: "fil-PH-BlessicaNeural", name: "Blessica", gender: "Female", locale: "fil-PH", language: "Filipino (PH)" },
    { id: "ja-JP-NanamiNeural", name: "Nanami", gender: "Female", locale: "ja-JP", language: "Japanese (JP)" },
  ],
  preview_voice: async () => true,
  get_pronunciations: async () => st.pron || "",
  save_pronunciations: async (t) => { st.pron = t; return t.split("\n").filter((l) => l.includes("=")).length; },
  rvc_list: async () => ({ voices: st.rvc ||= [{ name: "Rick Sanchez", has_index: true, sr: 40000, version: "v2" }, { name: "SatoruGojo JP", has_index: true, sr: 32000, version: "v2" }],
    status: { ready: true, faiss: false, missing_files: [], missing_packages: [] } }),
  rvc_import: async () => {
    for (const [pct, text] of [[0.01, "Getting the voice ready…"], [0.03, "Reading the voice…"], [0.3, "Copying the voice (16 / 53 MB)"], [0.5, "Copying the voice (53 / 53 MB)"], [0.75, "Copying its index (the likeness) (90 / 180 MB)"], [1, "Done"]]) {
      window.onPyEvent?.({ type: "rvc_progress", pct, text });
      await new Promise((r) => setTimeout(r, 450));
    }
    (st.rvc ||= []).push({ name: "Hiccup", has_index: true, sr: 40000, version: "v2" }); return { imported: { name: "Hiccup", has_index: true }, ...(await mockApi.rvc_list()) }; },
  rvc_delete: async (n) => { st.rvc = (st.rvc || []).filter((v) => v.name !== n); return mockApi.rvc_list(); },
  interact: async (t, r) => { console.log("interact", t, r); return true; },
  cards_deck: async () => ({ due: 2, new: 3, total: 5, cards: [
    { id: "r1:0", front: "What is the maximum moment of a simply supported beam with a uniform load?", back: "M = wL²/8 at midspan", source: "Week 3 - Beams.mp4, part 2", deck: "Beams flashcards", box: 1 },
    { id: "r1:1", front: "Units of the moment of inertia I?", back: "mm⁴ (length to the 4th power)", source: "Beams.pdf, p. 4", deck: "Beams flashcards", box: 0 },
    { id: "w:ja:駅", front: "駅  (eki)", back: "train station", source: "", deck: "Word bank (Japanese)", say: "駅", lang: "ja", box: 0 }] }),
  cards_answer: async (id, knew, combo) => { const xp = knew ? 5 + 2 * Math.min(combo, 5) : 1; ev({ type: "quest", xp, why: knew && combo > 1 ? `Combo x${combo}` : "", rewards: [], quests_done: [] }); return { box: { box: knew ? 2 : 1 }, xp: {} }; },
  study_moment: async () => ({ file_id: "abc123", name: "Week 3 - Beams.mp4", seconds: 754, clock: "12:34",
    url: "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQ==" }),
  study_ask: async (q) => ({ answer: `From your notes: the moment-area method is used for **deflections and slopes** of beams [Beams.pdf, p. 7]. (You asked: ${q})`,
    sources: [{ label: "Beams.pdf, p. 7", file_id: "f1", page: 7 }, { label: "Week 3 - Beams.mp4, part 2", file_id: "abc123", page: 2,
      moment: { file_id: "abc123", name: "Week 3 - Beams.mp4", seconds: 754, clock: "12:34", url: "data:video/mp4;base64,AAAA" } }] }),
  study_formulas: async () => ({ title: "Formula sheet: Beams.pdf", count: 3, topics: [{ topic: "Bending", formulas: [
    { name: "Max moment (UDL)", formula: "M = w*L^2/8", symbols: "w = load (kN/m), L = span (m)", source: "Beams.pdf, p. 3" },
    { name: "Bending stress", formula: "sigma = M*c/I", symbols: "c = distance to fibre (mm), I = inertia (mm^4)", source: "Beams.pdf, p. 5" }] },
    { topic: "Deflection", formulas: [{ name: "Max deflection (UDL)", formula: "d = 5*w*L^4/(384*E*I)", symbols: "E = modulus (MPa)", source: "Beams.pdf, p. 8" }] }] }),
  // ---- Study -> My study (skills/studylife.py)
  study_today: async () => ({ minutes: 43, items: [
    { icon: "🔁", text: "Review: Multiple choice: Beams.pdf (2 days late)", minutes: 10, action: "review", id: "r1" },
    { icon: "🃏", text: "12 flashcards", minutes: 4, action: "cards" },
    { icon: "📕", text: `Redo ${Math.min(10, (st.mistakes ||= mockMistakes()).length)} past mistakes`, minutes: 8, action: "mistakes" },
    { icon: "💪", text: "Weak topic: Hardy Cross (45%)", minutes: 15, action: "weak" }] }),
  study_fact: async () => ({ date: "2026-10-31", subject: "Hydrology", fact: "The Rational Method (Q = CiA) was first published by Thomas Mulvaney in 1851, and engineers still use it to size storm drains." }),
  study_mistakes: async () => (st.mistakes ||= mockMistakes()),
  study_mistake_done: async (id) => (st.mistakes = (st.mistakes || []).filter((m) => m.id !== id)),
  study_exam_report: async (id, results) => {
    const parts = [["Beams.pdf", results.slice(0, 2)], ["Hydrology notes.pdf", results.slice(2)]].filter(([, r]) => r.length)
      .map(([part, r]) => ({ part, right: r.filter(Boolean).length, total: r.length, pct: Math.round(100 * r.filter(Boolean).length / r.length) }));
    const right = results.filter(Boolean).length, pct = Math.round(100 * right / results.length);
    return { pct, grade: pct >= 90 ? "A" : pct >= 80 ? "B" : pct >= 70 ? "C" : pct >= 60 ? "D" : "F", right, total: results.length, parts, redo: parts.filter((p) => p.pct < 70).map((p) => p.part) };
  },
  study_grades: async () => (st.grades ||= [{ id: "g1", name: "Hydrology", target: 75, parts: [{ name: "Quizzes", weight: 20, score: 82 }, { name: "Midterm", weight: 30, score: 70 }, { name: "Final exam", weight: 50, score: null }],
    current: 74.4, needed: 76.2, message: "You need an average of 76.2% on Final exam to finish with 75%." }]),
  study_grade_save: async (c) => {
    const parts = c.parts.map((p) => ({ name: p.name, weight: +p.weight || 0, score: p.score === "" || p.score == null ? null : +p.score }));
    const w = parts.reduce((a, p) => a + p.weight, 0);
    if (Math.abs(w - 100) > 0.5) return { error: `The weights add up to ${w}%, they should add up to 100%.` };
    const done = parts.filter((p) => p.score != null), left = parts.filter((p) => p.score == null);
    const earned = done.reduce((a, p) => a + p.weight * p.score / 100, 0), wl = left.reduce((a, p) => a + p.weight, 0);
    const target = +c.target || 75, needed = wl ? Math.round(1000 * (target - earned) / wl) / 10 : null;
    const g = { id: c.id || "g" + Date.now(), name: c.name, target, parts, current: done.length ? Math.round(1000 * earned / done.reduce((a, p) => a + p.weight, 0)) / 10 : null, needed,
      message: !wl ? `Final grade: ${earned.toFixed(1)}%.` : needed > 100 ? `Even 100% gets you ${(earned + wl).toFixed(1)}%.` : `You need an average of ${needed}% on ${left.map((p) => p.name).join(", ")} to finish with ${target}%.` };
    st.grades = [...(st.grades || []).filter((x) => x.id !== g.id), g];
    return { grades: st.grades };
  },
  study_grade_remove: async (id) => ({ grades: (st.grades = (st.grades || []).filter((g) => g.id !== id)) }),
  study_cite: async (t) => (/^https?:/.test(t)
    ? { apa: "Chow, V. T. (2024, May 3). *Unit hydrographs explained*. Water Journal. " + t, mla: `Chow, Ven Te. "Unit Hydrographs Explained." *Water Journal*, 2024-05-03, ${t.replace(/^https?:\/\//, "")}. Accessed 31 Oct. 2026.` }
    : { apa: "Chow, V. T., Maidment, D. R., & Mays, L. W. (1988). *Applied hydrology*. McGraw-Hill.", mla: "Chow, Ven Te, et al. *Applied Hydrology*. McGraw-Hill, 1988." }),
  study_essay_outline: async (topic) => (topic.trim() ? { thesis: `${topic} should be a priority because it saves lives and money.`,
    points: [{ point: "Flood damage costs", evidence: ["Government disaster reports", "Insurance data"] }, { point: "Health effects", evidence: ["WHO reports", "Local hospital data"] }, { point: "Cheaper than rebuilding", evidence: ["Cost-benefit studies", "Case study: Marikina"] }],
    counter: { argument: "It's too expensive up front.", reply: "Prevention costs less than repeated repairs." }, conclusion: "Tie it back to your city." } : { error: "Type the essay topic or question." }),
  study_essay_feedback: async (o, d) => (d.trim().split(/\s+/).length < 40 ? { error: "Paste at least a paragraph of your draft (40+ words)." }
    : { score: 7, thesis_clear: true, strengths: ["Clear thesis.", "Good use of a local example."], fixes: [{ quote: d.split(".")[0], why: "Too general for an opening line.", better: "Every rainy season, Marikina loses millions to floods that drainage could prevent." }], next_step: "Add a source for your second point." }),
  study_photo_notes: async () => { (st.notebook ||= []).push({ id: "n" + Date.now(), topic: "Hardy Cross method", subject: "Hydrology", text: "- Assume flows in each loop\n- Correct: dQ = -Σh / (n Σ h/Q)", formulas: ["h = kQ^n"], sources: ["IMG_2041.jpg"], updated: "2026-10-31" });
    return { done: [{ topic: "Hardy Cross method", merged: false }], errors: [], notes: st.notebook }; },
  study_notebook: async () => (st.notebook ||= [{ id: "n1", topic: "Unit hydrograph", subject: "Hydrology", text: "- Runoff from 1 unit of rain\n- S-curve method", formulas: ["Q = CiA"], sources: ["IMG_2001.jpg", "IMG_2002.jpg"], updated: "2026-10-30" },
    { id: "n2", topic: "Unit hydrographs", subject: "Hydrology", text: "- S-curve method\n- Lag time", formulas: [], sources: ["IMG_2010.jpg"], updated: "2026-10-31" }]),
  study_merge_notes: async () => { const n = st.notebook || []; const merged = n.length > 1 ? 1 : 0; if (merged) { n[0].text += "\n- Lag time"; n[0].sources.push(...n[1].sources); n.splice(1, 1); } return { merged, notes: n }; },
  study_note_remove: async (id) => (st.notebook = (st.notebook || []).filter((n) => n.id !== id)),
  study_chapters: async () => ({ chapters: [{ time: "0:00", seconds: 0, title: "Intro", url: "#" }, { time: "4:10", seconds: 250, title: "Bending moment diagrams", url: "#" }, { time: "12:34", seconds: 754, title: "Deflection", url: "#" }] }),
  study_subjects: async () => ({ subjects: [{ name: "Engineering Economics", files: 4 }, { name: "Hydrology", files: 3 }, { name: "Steel Design", files: 2 }, { name: "Other", files: 1 }], sheets: st.sheets ||= {} }),
  study_subject_formulas: async (s) => (s === "Steel" ? { error: "No Steel files yet. In Library, set a file's subject to Steel (or add handwritten notes)." }
    : (st.sheets[s] = { title: `${s} formula sheet`, subject: s, count: 2, topics: [{ topic: "Runoff", formulas: [{ name: "Rational method", formula: "Q = CiA", symbols: "C = runoff coeff., i = intensity, A = area", source: "Hydro.pdf, p. 4" }] },
      { topic: "From your handwritten notes", formulas: [{ name: "", formula: "h = kQ^n", symbols: "", source: "Notebook" }] }] })),
  study_usb_new: async () => (st.usbDone ? { files: [] } : { files: [{ path: "E:\\Hydrology\\Week 9.pdf", name: "Week 9.pdf", folder: "Hydrology", size: 2e6, subject: "Hydrology" },
    { path: "E:\\RCD lecture 4.pptx", name: "RCD lecture 4.pptx", folder: ".", size: 5e6, subject: "RCD" }] }),
  study_usb_import: async () => { st.usbDone = true; return mockApi.study_files(); },
  study_usb_skip: async () => { st.usbDone = true; return { ok: true }; },
  study_exam: async () => { const ex = st.exam ||= { on: true, sleep: "22:30", exams: [{ subject: "Hydrology", date: "2026-11-03" }, { subject: "RCD", date: "2026-11-05" }] };
    return { ...ex, active: ex.on, plan: ex.exams.length ? [{ date: "2026-10-31", weekday: "Sat", focus: "Hydrology in 3 days", blocks: ["📖 Morning: Hydrology, hardest topics first", "📝 Afternoon: Hydrology practice exam (timed)", "🃏 Evening: flashcards + mistakes", `🛌 Bed by ${ex.sleep}`] },
      { date: "2026-11-02", weekday: "Mon", focus: "Hydrology tomorrow, so light review and early sleep", blocks: ["📐 Hydrology: formula sheet + mistake notebook", `🛌 Bed by ${ex.sleep}`] }] : [] }; },
  study_exam_save: async (s) => { st.exam = s; return mockApi.study_exam(); },
  sensei_scenes: async () => [{ id: "cafe", label: "☕ Ordering at a café" }, { id: "hotel", label: "🏨 Hotel check-in" }],
  sensei_speed: async (v) => (v ? (st.speed = v) : st.speed || "normal"),
  sensei_shadow: async () => ({ language: "ja", lines: [{ text: "おはようございます", roman: "ohayou gozaimasu", meaning: "Good morning" }, { text: "駅はどこですか", roman: "eki wa doko desu ka", meaning: "Where is the station?" }] }),
  sensei_words: async () => (st.words ||= [{ lang: "ja", word: "駅", reading: "eki", meaning: "station", added: "2026-10-28" }, { lang: "ja", word: "美味しい", reading: "oishii", meaning: "delicious", added: "2026-10-29" }]),
  sensei_word_remove: async (l, w) => (st.words = st.words.filter((x) => x.word !== w)),
  sensei_report: async () => ({ language: "ja", name: "Japanese", from: "2026-10-24", to: "2026-10-30", words: 12, new_words: ["駅", "美味しい"], talks: 4, turns: 38, right: 29, grammar_pct: 76, best_combo: 6, days: 5, streak: 5, shadowed: 14, drawn: 22 }),
  sensei_draw_sets: async () => ({ Hiragana: "あいうえおかきくけこ", Katakana: "アイウエオ" }),
  gym_advice: async () => ({ rest: true, title: "Take a rest day", last_sleep: 5.5, avg_sleep: 6.4, tips: ["You've trained 4 days in a row. Take today off (or just walk and stretch): muscles grow while you rest.",
    "Only 5.5 h of sleep last night. Keep today lighter and aim for bed 30 min earlier.", "You average 6.4 h of sleep. 7-9 h helps recovery more than any supplement."] }),
  gym_sleep: async (h) => { (st.sleepNights ||= {})[new Date().toISOString().slice(0, 10)] = +h; return { ok: true }; },
  gym_sleep_report: async () => {
    const need = st.sleepNeed || 8, nights = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10);
      const h = st.sleepNights?.[d] ?? [7, 6, null, 8.5, 5.5, 7.5, 6.5][i]; return { date: d, hours: h, met: h != null && h >= need }; });
    const debt = nights.reduce((s, n) => s + (n.hours != null ? Math.max(0, need - n.hours) : 0), 0), met = nights.filter((n) => n.met).length;
    return { need, bedtime: st.bedtime || "23:00", wind_down: 45, nights, debt, met, avg: 6.8, streak: nights.at(-1).met ? 1 : 0, pct: Math.round(met / 7 * 100),
      tips: [`You owe ${debt} h this week. Go to bed 60 min earlier (22:00) for the next 4 nights.`, "A 20-minute nap before 3 pm helps. Longer than 90 min makes it harder to sleep tonight."],
      summary: `${met}/7 nights with ${need} h · ${debt} h sleep debt` }; },
  gym_sleep_save: async (need, bed) => { st.sleepNeed = +need || 8; st.bedtime = bed || "23:00"; return mockApi.gym_sleep_report(); },
  gym_next_weights: async () => [
    { name: "Incline Bench", day: 1, target: "8-10", sets: 3, status: "up", kg: 60, next: 62.5, why: "All 3 sets hit 10 reps. Go to 62.5 kg." },
    { name: "Barbell squat", day: 1, target: "6-8", sets: 4, status: "keep", kg: 80, next: 80, why: "Same weight until every set reaches 8 (set 3: 7/8, set 4: 6/8)." },
    { name: "Lat pulldown", day: 2, target: "10-12", sets: 3, status: "keep", kg: 45, next: 45, why: "Only 2 of 3 sets done last time. Same weight: do all 3 sets." },
    { name: "Bicep curl", day: 2, target: "12", sets: 3, status: "new", kg: null, next: null, why: "No log yet: do it once first." }],
  gym_coach_plan: async () => ({ day: 1, done: 1, per_week: 4, days_left: 2, left: 3, gap: 3, deload: false,
    message: "You missed some days: 3 workouts left but only 2 days this week. Today adds the 2 main lifts from Day 2 (3 sets each) so nothing big is skipped.",
    extra: [{ name: "Lat pulldown", from_day: 2, sets: 3, target: "10-12" }, { name: "Seated row", from_day: 2, sets: 3, target: "10-12" }] }),
  gym_prs: async () => [
    { name: "Barbell squat", e1rm: 101.3, e1rm_set: "80 kg × 8", kg: 80, reps: 8, trophy: "🥇", new: true },
    { name: "Bench press", e1rm: 80, e1rm_set: "60 kg × 10", kg: 60, reps: 10, trophy: "🥈", new: false },
    { name: "Lat pulldown", e1rm: 60, e1rm_set: "45 kg × 10", kg: 45, reps: 12, trophy: "🥉", new: false },
    { name: "Plank", e1rm: 0, kg: 0, reps: 60, trophy: "", new: false }],
  gym_week_muscles: async () => ({ quads: 1, glutes: 0.9, "upper chest": 0.71, triceps: 0.6, lats: 0.43, biceps: 0.3 }),
  gym_protein: async () => { const target = 150, have = mockMeals.total.protein; return { have, target, pct: Math.min(100, Math.round(have / target * 100)), text: `${have} / ${target} g protein · ${Math.max(0, target - have)} g to go` }; },
  gym_grocery: async (c) => { const ph = c !== "US"; const cur = ph ? "₱" : "$", f = ph ? 1 : 0.02;
    const items = [["Chicken breast", "1.5 kg", 420], ["Rice", "2 kg", 110], ["Eggs", "24 eggs", 220], ["Oats", "750 g", 160], ["Vegetables", "1.75 kg", 260], ["Greek yogurt", "1 kg", 380]]
      .map(([food, qty, p]) => ({ food, qty, grams: 0, price: Math.round(p * f * 100) / 100, link: "https://www.walmart.com/search?q=" + food }));
    return { store: ph ? "SM Supermarket" : "Walmart", currency: cur, country: ph ? "PH" : "US", items, total: Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100, note: "Prices are estimates. Check the store before you go." }; },
  gym_supplements: async () => { const now = new Date().toTimeString().slice(0, 5); st.supps ||= [{ id: "a1", name: "Creatine", dose: "5 g", times: ["08:00"] }, { id: "b2", name: "Vitamin D", dose: "1000 IU", times: ["08:00", "20:00"] }];
    st.taken ||= new Set(); return { items: st.supps.map((x) => ({ ...x, slots: x.times.map((t) => ({ time: t, taken: st.taken.has(x.id + "@" + t), due: t <= now && !st.taken.has(x.id + "@" + t) })) })),
      week: [...Array(7)].map((_, i) => ({ date: "", taken: i === 6 ? st.taken.size : 3, want: 3 })) }; },
  gym_supp_save: async (x) => { if (!x.name) return { error: "Name it first (e.g. Creatine, Vitamin D)." }; if (!x.times?.length) return { error: "Add at least one time like 08:00." }; st.supps.push({ id: String(Date.now()), ...x }); return mockApi.gym_supplements(); },
  gym_supp_remove: async (id) => { st.supps = st.supps.filter((x) => x.id !== id); return mockApi.gym_supplements(); },
  gym_supp_take: async (id, t, undo) => { undo ? st.taken.delete(id + "@" + t) : st.taken.add(id + "@" + t); return mockApi.gym_supplements(); },
  gym_runs: async () => { st.runs ||= [{ id: "r1", date: "2026-10-30T06:10", kind: "run", km: 5.02, seconds: 1740, pace: 5.78, pace_text: "5:47 /km", steps: 6436, kcal: 301,
      route: [[14.6, 121.0], [14.602, 121.003], [14.605, 121.004], [14.607, 121.008], [14.604, 121.011], [14.601, 121.007], [14.6, 121.0]] }];
    return { runs: st.runs, week_km: st.runs.reduce((s, r) => s + r.km, 0), week_steps: st.runs.reduce((s, r) => s + r.steps, 0), week_count: st.runs.length, best_pace: "5:47 /km", longest: 5.02 }; },
  gym_run_save: async (pts, note, kind) => { if (!pts || pts.length < 2) return { error: "Too short to save (under 20 m). Was location allowed?" }; st.runs.unshift({ id: String(Date.now()), date: new Date().toISOString().slice(0, 16), kind, km: 0.5, seconds: 180, pace: 6, pace_text: "6:00 /km", steps: 641, kcal: 30, route: pts.map((p) => [p[0], p[1]]) }); return mockApi.gym_runs(); },
  gym_run_remove: async (id) => { st.runs = st.runs.filter((r) => r.id !== id); return mockApi.gym_runs(); },
  gym_meal_today: async () => structuredClone(mockMeals),
  gym_meal_photo: async () => ({ name: "Chicken adobo with rice", kcal: 650, protein: 38, carbs: 70, fat: 22, note: "A bowl of adobo over white rice, fairly sure." }),
  gym_meal_add: async (m) => { mockMeals.meals.push({ id: String(Date.now()), ...m, kcal: +m.kcal || 0, protein: +m.protein || 0 }); for (const k of ["kcal", "protein", "carbs", "fat"]) mockMeals.total[k] += +m[k] || 0; ev({ type: "quest", xp: 5, why: "Meal logged", rewards: [], quests_done: [] }); return structuredClone(mockMeals); },
  gym_meal_remove: async (id) => { mockMeals.meals = mockMeals.meals.filter((m) => m.id !== id); return structuredClone(mockMeals); },
  backup_make: async (big) => ({ files: big ? 2140 : 312, mb: big ? 1290 : 18.4, message: `Backup saved: vermeil_backup.zip (${big ? 2140 : 312} files).` }),
  backup_restore: async () => ({ files: 312, message: "Restored 312 files. Restart Vermeil to load them." }),
  smart_reminders: async () => structuredClone(mockSmart),
  smart_reminder_add: async (event, on, match, minutes) => { mockSmart.push({ event, on, match, minutes }); return { message: `Okay, I'll remind you to ${event}.`, items: structuredClone(mockSmart) }; },
  smart_reminder_remove: async (t) => { mockSmart = mockSmart.filter((r) => r.event !== t); return structuredClone(mockSmart); },
  screen_help: async (q) => { const answer = `That's a Python error: **ModuleNotFoundError**. Run \`python -m pip install requests\` and try again. (mock${q ? `, you asked: ${q}` : ""})`; ev({ type: "reply", text: answer }); return { answer }; },
  recap_year: async () => ({ year: 2026, note: "(preview) Look at you: 12,450 XP this year. Same time next year? 💜", slides: [
    { icon: "✨", title: "Your 2026 with Vermeil", big: "12,450 XP", sub: "Level 14 · 41 active days lately · best streak 23 days" },
    { icon: "🎯", title: "Time in focus", big: "86.5 hours", sub: "142 sessions · best day 2026-05-12 (240 min)", list: ["Calculus", "Essay", "Coding"] },
    { icon: "🏋", title: "In the gym", big: "96 workouts", sub: "1,840 sets · 212.4 tonnes lifted", list: ["Bench press", "Squat", "Deadlift"] },
    { icon: "🎵", title: "Your music", big: "2,310 songs played", sub: "Top artist: Eminem", list: ["Lose Yourself", "Till I Collapse", "Stronger"] }] }),
  gifts: async () => ({ waiting: st.giftOpen ? [] : [{ id: "g1", why: ["1240 XP this week (you usually get about 600)", "11.5 hours of focus"], vcash: 162 }], opened: [] }),
  gift_open: async () => { st.giftOpen = true; return { gift: { vcash: 162, note: "(preview) I noticed how hard you worked. Rest a bit. 💜", treat: "Take tonight off." }, waiting: [], opened: [] }; },
  spotify_like_this: async () => ({ message: "(preview) Playing 12 songs like Sunrise on Spotify." }),
  gn_bpm: async () => ({ bpm: 120 }),
  cleanup_scan: async () => ({ files: 18234, seconds: 4.2, big_mb: 500, old_days: 90, total_mb: 5310, roots: [],
    big: [{ id: "b1", name: "movie.mkv", folder: "C:\\Users\\you\\Videos", mb: 3900, days: 400 }],
    old: [{ id: "o1", name: "setup.exe", folder: "C:\\Users\\you\\Downloads", mb: 120, days: 300 }, { id: "o2", name: "notes.pdf", folder: "C:\\Users\\you\\Downloads", mb: 2, days: 120 }],
    dups: [{ keep: { id: "k1", name: "song.mp3", folder: "C:\\Users\\you\\Music", mb: 8, days: 900 }, extra: [{ id: "d1", name: "song (1).mp3", folder: "C:\\Users\\you\\Downloads", mb: 8, days: 30 }] }] }),
  cleanup_trash: async (ids) => ({ moved: ids.length, mb: 128, failed: [] }),
  quest_state: async () => {
    const q = st.quest ||= { xp: 1240 };
    const tier = Math.min(30, Math.floor(q.xp / 300));
    const pass = [[1, "title", "Rookie Scholar", "🎓"], [2, "item", "rwPlushie", "🧸"], [3, "wallpaper", "sakura", "🌸"], [4, "item", "rwLavaLamp", "🫧"],
      [5, "title", "Night Owl", "🦉"], [6, "item", "rwGlobe", "🌍"], [7, "item", "rwTrophyBronze", "🥉"], [8, "wallpaper", "galaxy", "🌌"]]
      .map(([t, kind, key, icon]) => ({ tier: t, kind, key, icon, name: key.replace(/^rw/, ""), got: t <= tier }));
    return { xp: q.xp, level: 5, level_xp: q.xp - 1000, level_need: 500, season: "Season 1: Cozy Scholar", tier, tiers: 30, tier_xp: q.xp % 300, tier_need: 300,
      streak: 4, best_streak: 6, title: "Rookie Scholar", today_xp: 85, pass, items: pass.filter((p) => p.got && p.kind === "item").map((p) => p.key),
      wallpapers: pass.filter((p) => p.got && p.kind === "wallpaper").map((p) => p.key),
      quests: [{ kind: "card", text: "Answer 20 flashcards", goal: 20, xp: 40, have: 12, done: false }, { kind: "focus_block", text: "Finish 2 focus blocks", goal: 2, xp: 50, have: 2, done: true },
        { kind: "habit", text: "Tick 3 habits", goal: 3, xp: 30, have: 1, done: false }],
      badges: [{ id: "streak3", name: "🔥 3-day streak", got: true }, { id: "cards100", name: "🃏 100 flashcards", got: false }],
      vcash: q.vcash ??= 900, owned: q.owned ||= [], season_now: { theme: "space", name: "🚀 Space Season · October 2026", month: "2026-10" } };
  },
  her_today: async () => ({ outfit: { hat: "witch", glasses: false, color: "#6b3fbf", why: "Halloween 🎃" }, birthday: false, sleep: false, hour: new Date().getHours(),
    greeting: st.greeted ? null : (st.greeted = "Happy Halloween! 🎃 Trick or treat?"), ask: st.asked ? null : (st.asked = { id: "f1", question: "How did your exam go?" }) }),
  her_say: async (text) => { window.onPyEvent?.({ type: "reply", text }); return true; },
  her_asked: async () => true,
  wardrobe: async () => ({ outfits: st.wardrobe ||= [], wearing: st.wearing || "auto", hats: ["none", "beanie", "party", "crown", "santa", "witch", "headband", "headphones", "cap"] }),
  wardrobe_save: async (o) => { if (!o.name) return { error: "Name the outfit." }; st.wardrobe = [...(st.wardrobe || []).filter((w) => w.name !== o.name), o]; return mockApi.wardrobe(); },
  wardrobe_remove: async (n) => { st.wardrobe = (st.wardrobe || []).filter((w) => w.name !== n); return mockApi.wardrobe(); },
  wardrobe_wear: async (n) => { st.wearing = n; return mockApi.wardrobe(); },
  focus_extras: async () => ({ break: { icon: "👀", text: "20-20-20: look at something 20 feet away for 20 seconds." },
    countdowns: [{ title: "Hydrology exam", kind: "event", date: "2026-11-02", days: 2 }, { title: "Steel design plate", kind: "task", date: "2026-11-09", days: 9 }],
    unlock_sentence: "I am choosing to give up on this focus session even though I promised myself I would finish it", sites: ["youtube", "tiktok"],
    screen: { date: "2026-10-31", total: 214, apps: [{ app: "VS Code", minutes: 96 }, { app: "Chrome", minutes: 71 }, { app: "Vermeil", minutes: 47 }] },
    screen_week: [180, 240, 95, 300, 210, 120, 214].map((m, i) => ({ date: `2026-10-${25 + i}`, minutes: m })) }),
  focus_unlock: async (t) => ({ ok: t.trim().toLowerCase().startsWith("i am choosing to give up") }),
  week_view: async (start) => {
    const s = start || "2026-10-26";
    st.week ||= { "2026-10-27": [{ title: "RCD beam problems", priority: "high" }], "2026-10-30": [{ title: "Read hydrology ch. 4", priority: "normal" }], none: [{ title: "Clean desk", priority: "low" }] };
    const days = [...Array(7)].map((_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); const k = d.toISOString().slice(0, 10);
      return { date: k, weekday: d.toLocaleDateString("en", { weekday: "short" }), tasks: st.week[k] || [], events: k === "2026-11-01" ? [{ title: "Gym", time: "17:00" }] : [] }; });
    return { start: s, days, undated: st.week.none };
  },
  week_move: async (kind, title, old, nw) => { const from = st.week[old || "none"] || []; const i = from.findIndex((t) => t.title === title);
    if (i < 0) return { ok: false }; (st.week[nw || "none"] ||= []).push(from.splice(i, 1)[0]); return { ok: true }; },
  habit_heatmap: async () => ({ days: [...Array(84)].map((_, i) => `d${i}`), habits: [{ name: "Water", icon: "💧", cells: [...Array(84)].map((_, i) => ((i * 37) % 10) / 10) },
    { name: "Read", icon: "📖", cells: [...Array(84)].map((_, i) => (i % 3 ? 1 : 0)) }] }),
  goal_tree: async () => { st.goals ||= [{ id: "g1", title: "Pass the CE board exam", parent: null, done: false }, { id: "g2", title: "Finish hydrology review", parent: "g1", done: true }, { id: "g3", title: "Steel design problems", parent: "g1", done: false }];
    const node = (g) => { const ch = st.goals.filter((c) => c.parent === g.id).map(node); return { ...g, children: ch, progress: ch.length ? ch.reduce((a, c) => a + c.progress, 0) / ch.length : g.done ? 1 : 0 }; };
    return { goals: st.goals.filter((g) => !g.parent).map(node) }; },
  goal_add: async (title, parent) => { if (!title.trim()) return { error: "Type the goal first." }; st.goals.push({ id: "g" + Date.now(), title, parent, done: false }); return mockApi.goal_tree(); },
  goal_toggle: async (id) => { const g = st.goals.find((x) => x.id === id); if (g) g.done = !g.done; return mockApi.goal_tree(); },
  goal_remove: async (id) => { st.goals = st.goals.filter((g) => g.id !== id && g.parent !== id); return mockApi.goal_tree(); },
  travel_plan: async (req) => ({ request: { ...req, days: +req.days, stars: +req.stars, currency: req.currency || "PHP" }, summary: `${req.days} easy days in ${req.place}.`, estimate: 8450,
    airfare: { route: "MNL → CEB", low: 1800, high: 3500, airlines: "Cebu Pacific, PAL", tip: "Book 3–6 weeks ahead." },
    stays: [{ name: "Sample Inn", type: "hotel", area: "IT Park", per_night: 1600, why: "Near the food spots" }],
    links: { flights: "https://www.google.com/travel/flights", maps: "https://www.google.com/maps" }, tips: ["Carry small bills for jeepneys."],
    days: [...Array(+req.days || 1)].map((_, i) => ({ day: i + 1, title: "Around the city", total: 900, stops: [
      { time: "08:00", kind: "commute", name: "Jeepney to the city centre", cost: 15 }, { time: "09:00", kind: "spot", name: "Magellan's Cross", area: "Downtown", cost: 0 },
      { time: "12:00", kind: "food", name: "Local lechon place", area: "Downtown", cost: 350, note: "Try the lechon." }] })) }),
  travel_swap: async (plan, day, i) => { plan.days[day - 1].stops[i] = { ...plan.days[day - 1].stops[i], name: "A different place", note: "New suggestion" }; return plan; },
  travel_edit: async (plan, day, i, stop) => { plan.days[day - 1].stops[i] = { ...stop, cost: +stop.cost || 0 }; return plan; },
  travel_saved: async () => [],
  browse_inside: async (t) => (t ? { ok: true, url: t } : { error: "Type what to search or a link." }),
  quest_buy: async (key, price, name) => { const q = st.quest; if (q.owned.includes(key)) return { ok: true, already: true, vcash: q.vcash, owned: q.owned };
    if (q.vcash < price) return { error: `You need ${price - q.vcash} more VCash.`, vcash: q.vcash };
    q.vcash -= price; q.owned.push(key); ev({ type: "toast", text: `Bought ${name} for ${price} VCash 🛒` }); return { ok: true, vcash: q.vcash, owned: q.owned }; },
  room_presets: async () => Object.entries(st.presets ||= {}).map(([name, p]) => ({ name, saved: p.saved, items: p.layout.items.length })),
  room_preset_save: async (name, layout) => { (st.presets ||= {})[name] = { saved: "today", layout }; return { ok: true, presets: await mockApi.room_presets() }; },
  room_preset_load: async (name) => (st.presets?.[name] ? { layout: structuredClone(st.presets[name].layout) } : { error: "That design isn't saved." }),
  room_preset_delete: async (name) => { delete st.presets?.[name]; return { ok: true, presets: await mockApi.room_presets() }; },
  photo_list: async () => ({ folder: "C:/Users/me/Pictures", photos: [] }),
  photo_folder_pick: async () => ({ folder: "C:/Users/me/Pictures", photos: [] }),
  photo_data: async () => ({ error: "No pictures in the preview." }),
  room_weather: async () => ({ place: "Manila, Philippines", temp_c: 29, text: "Light rain shower", kind: "rain", alerts: [],
    days: ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"].map((date, i) => ({ date, text: ["Light rain", "Sunny", "Partly cloudy", "Thunderstorm", "Sunny"][i], min_c: 24 + i % 2, max_c: 31 - i % 3, rain_chance: [80, 10, 30, 90, 5][i] })) }),
  room_plant: async () => ({ stage: 3, wilt: 0, minutes: 250, skipped_days: 0, message: "It's getting bushy." }),
  room_tasks: async () => ({ tasks: [{ task: "Finish hydrology plate", priority: "high", deadline: "2026-11-02" }, { task: "Read steel design ch. 4", priority: "normal" }, { task: "Buy groceries", priority: "low" }] }),
  room_extras: async () => ({ decor: "halloween", holiday: "Halloween", tip: "Tip: press ✏️ Edit room, then 🛒 Shop to spend your VCash on furniture.",
    season: { theme: "space", name: "🚀 Space Season · October 2026" }, vcash: st.quest?.vcash ?? 900, owned: st.quest?.owned || [],
    achievements: [{ id: "decorator", name: "Decorator: 10 things in your room", got: true }, { id: "shopper", name: "First purchase in the shop", got: !!st.quest?.owned?.length }] }),
  quest_award: async (kind, n = 1) => { st.quest.xp += 5 * n; const r = { xp: 5 * n, total: st.quest.xp, level: 5, level_up: false, tier: 4, rewards: [], quests_done: [], streak: 4 }; ev({ type: "quest", ...r }); return r; },
  habits_list: async () => (st.habits ||= [{ id: "h1", name: "Water", icon: "💧", goal: 8, today: 3, streak: 5, done: false },
    { id: "h2", name: "Sleep 8 hours", icon: "😴", goal: 1, today: 1, streak: 2, done: true }, { id: "h3", name: "Reading", icon: "📖", goal: 1, today: 0, streak: 0, done: false }])
    .map((h) => ({ ...h, week: [6, 5, 4, 3, 2, 1, 0].map((i) => ({ day: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), count: i ? (i % 3 ? h.goal : 0) : h.today })) })),
  habit_add: async (name, icon, goal) => { st.habits.push({ id: "h" + Date.now(), name, icon, goal: +goal, today: 0, streak: 0, done: false }); return mockApi.habits_list(); },
  habit_remove: async (id) => { st.habits = st.habits.filter((h) => h.id !== id); return mockApi.habits_list(); },
  habit_tick: async (id, n) => { const h = st.habits.find((x) => x.id === id); h.today = Math.max(0, h.today + n); h.done = h.today >= h.goal;
    if (n > 0) ev({ type: "quest", xp: 2, why: `${h.icon} ${h.name}`, rewards: [], quests_done: [] }); return h; },
};

function mockMistakes() {
  return [{ id: "m1", q: "What does C stand for in Q = CiA?", right: "The runoff coefficient", why: "C is the fraction of rain that runs off.", source: "Hydro.pdf, p. 4", subject: "Hydrology", added: "2026-10-30" },
    { id: "m2", q: "Minimum concrete cover for beams (ACI)?", right: "40 mm", why: "", source: "RCD lecture 2.pptx", subject: "RCD", added: "2026-10-31" }];
}
