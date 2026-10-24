# Handover: Vermeil assistant + "AI Dungeon Adventure" game

Paste this whole file into a new Claude conversation, together with the project folder, to continue the work.
Last updated: 2026-10-24.

---

## 1. Who I am and how I like to work (standing rules)

- **Always beginner-friendly.** Use simple explanations and give step-by-step instructions that say exactly where each file goes.
- **Use the available skills** whenever they apply.
- **Never print, show or send secrets.** The project's `env` file holds GROQ_API_KEY, the Spotify keys and WEATHER_API_KEY. You may count its lines, but never output its contents.
- **pip can't be run for me on my PC.** Give me the exact `python -m pip install ...` command to run myself instead.
- **The `dnd` folder is my asset library. Never modify it.** All copies, conversions and fixes go into `ui/game/assets/`.
- **The RVC voice folders in my Downloads are references** (`Rick%20Sanchez`, `SatoruGojo_JP`, `MJThrillerEraV2`, `Ash Ketchum (Pokémon Masters EX) - Weights Model`, `Hiccup`, `Bubbles`, `Mickey%20Mouse`). Never change them; importing copies them.
- **Always update this handover** at the end of every session.
- I prefer testing on the dev server (see section 4, the 23 Oct entry).
- I'm in the Philippines (Asia/Manila time zone). I work on Windows, and the project is synced by OneDrive.

## 2. Project location

- **On my PC:** `C:\Users\jpant\OneDrive\Desktop\coding\2025\2025\`
  - `app.py` starts the main app (pywebview window, Vermeil the 3D anime-girl companion, Groq AI online, Ollama offline).
  - `dnd\` is the asset library: 81 folders from Quaternius packs. The game uses 72 packs, 3,355 models.
  - `tools\kokoro\` holds the Kokoro TTS model files (`kokoro-v1.0.onnx`, 325 MB, and `voices-v1.0.bin`).
  - `tools\rvc\` holds the 2 RVC helper models (`vec-768-layer-12.onnx` and `rmvpe.pt`) once `scripts\setup_rvc.bat` has run. Imported voice clones go in `data\rvc_voices\<name>\` (`model.pth`, `model.index`, `info.json`).
  - `env` is the secrets file. **Never read it out.**
- **Python:** the app runs on Windows Python 3.13 (some old 3.10 caches exist too).
- **Tests:** `python -m unittest discover -s tests`. The last run (24 Oct 2026) passed 439 tests (3 skipped). The game tests alone (`tests.test_game`) are 44.

## 3. Main parts

### Vermeil assistant (app)
- **Text-to-speech, `senses/tts.py`:** Piper voices are the offline default (`data/piper_voices`). Voices starting with `kokoro:` go to `senses/kokoro.py` and fall back to Piper if Kokoro fails.
- **`senses/kokoro.py`:** Kokoro now runs **inside the app** with the `kokoro-onnx` package. There is no Docker and no server.
  - The model loads in a background thread at startup (about 3–5 seconds); until then Vermeil uses Piper.
  - It's used **only while the AI is online** (`llm.which()["now"] == "groq"`, see `brain/pinakamain.py` `online_now()` / `active_voice()`).
  - Optional `.env` settings: `KOKORO_MODEL_DIR`, `KOKORO_AUTOSTART=0`, `ONNX_PROVIDER=CUDAExecutionProvider`, and `KOKORO_URL` (an advanced fallback to a Kokoro-FastAPI server).
  - The voice is chosen in the character settings ("Online voice (Kokoro)"); Vermeil's default is `kokoro:af_heart`.
  - **Setup:** run `scripts\setup_kokoro.bat` once. It runs `python -m pip install kokoro-onnx` and downloads the model files only if they're missing; they're already in `tools\kokoro`.
  - **Status:** I tested it here with the real model and it works. **It hasn't been run on my PC yet.**
- **RVC voice clones, `senses/rvc.py` + `senses/rvc_models.py`:** makes a character sound like an imported RVC voice (.pth + .index).
  - How it works: a normal voice (Piper / Edge / Kokoro) says the sentence first, then RVC changes it into the clone. ContentVec (ONNX) hears *what* is said, RMVPE hears the *pitch*, and the voice's own network (rewritten in `rvc_models.py`, inference only, MIT credit to the RVC project) makes the new sound. No fairseq or librosa needed, so it works on Python 3.13.
  - Languages: the clone keeps whatever language the base voice speaks, so English, Tagalog, Japanese and Korean all work. "Speak with" = the voice picked above, or a female / male voice in her language (`rvc.BASE_VOICES`), each **high / normal / low** (`rvc.BASE_CHOICES`, `female_high` … `male_low`; high/low = ±4 semitones, `BASE_SHIFT`, added in `convert()`). Japanese/Korean are spotted from the text itself.
  - Where it's wired: `brain/pinakamain.py` `synth_voice()` (falls back to the normal voice if RVC fails), `VOICE_RVC`; `app.py` `_rvc_settings`, `rvc_list/rvc_import/rvc_delete`, `preview_voice(..., rvc, language)`; the character's `rvc` setting (`model, pitch, index_rate, protect, base`).
  - UI: Characters → "Voice clone (RVC)" box (`ui/index.html` `#rvcBox`, `ui/app.js` "voice clone (RVC)").
  - Test from a terminal: `python senses\rvc.py` (status + voices) or `python senses\rvc.py "Rick Sanchez" "Hello there" 0` (writes `rvc_test.wav`).
  - All 7 reference voices are RVC v2 with pitch (32k/40k/48k); they load with no missing parts.
  - **Speed (measured 23 Oct 2026, CPU, 6 threads, Rick):** about 1.5 s of work per 1 s of speech once warmed up (it was 2–2.8 s before `convert()` stopped making the 1 s of padding on each side). The first sentence after startup is much slower (loading RMVPE took ~34 s the first time while OneDrive was busy). The voice network's decoder is most of the time; an ONNX version of it was not faster, so it stays in torch.
- **Emotion in the voice, `senses/voice_emotion.py`:** each sentence gets a mood (happy, excited, sad, angry, surprised, soft, scared or neutral) from `*actions*`, emojis, `!`/`?!`, laughing ("haha"), `~`, a few keywords and VADER sentiment. A mood lasts into the next 1–2 sentences, fading. The mood sets the speed and loudness (`EMOTIONS` table) and sends an `expression` event so her face matches while that sentence plays.
- **Human-sounding speech, `senses/expressive.py`** (the pitch part of emotion lives here now, it used to be a tiny "+Hz" that you couldn't hear):
  - **Melody:** `plan()` turns the mood into a pitch curve (`STYLES`: mean, slope, bounce, tremble, tone, drive). Questions rise, statements fall, happy bounces, sad sinks, scared shakes, surprised starts high. `shape()` moves the pitch with WSOLA + variable-speed playback (length stays the same), BEFORE RVC, so clones follow it. Measured: happy ≈ +13 %, excited ≈ +25 %, surprised starts ≈ +30 %.
  - **Sound:** `finish()` (after RVC) makes it brighter / darker, adds a bit of edge for angry, puts a breath before it and a pause after it (longer after `...` and `?`).
  - **Pauses inside a sentence:** `split_pauses()` voices the pieces around `...` and dashes separately with real silence between them.
  - **Breaths and sounds:** a soft breath before her first sentence (70 %) and before long ones. `vocalize()`: `*sighs*` / `*gasps*` become a real sigh / gasp, and `*giggles*` / `*laughs*` / `*chuckles*` are said ("Hehe!", "Haha!", "Heh.").
  - **Pronunciations:** `pronounce()` uses a built-in English list (`BUILT_IN`: idk, btw, AI, °C…) plus your own in `data/pronunciations.json` (Settings → Voice & camera → **Pronunciations**, `app.py` `get_pronunciations` / `save_pronunciations`). Yours win.
  - The AI is also told (system notes in `pinakamain.py`) to show feelings with short *actions*, `...` and `!`/`?`.
  - Wired in `brain/pinakamain.py` `SpeechStream._push` → `synth_voice(..., style)` (`VOICE_EMOTION`, `VOICE_NATURAL`). Any error falls back to the plain voice.
  - UI: Characters → **Emotion in voice** slider (0 = flat, 100 = normal, 150 = very expressive, saved as `emotion`) and the **Natural speech** checkbox (breaths, pauses, melody; saved as `natural`).
  - Tests: `tests/test_voice_emotion.py`, `tests/test_expressive.py`.
  - It's rule-based, not a trained model: training a real emotional TTS needs a GPU and hours of recorded emotional speech.

### The game (`game/` Python rules engine + `ui/game/` three.js page)
- **How to play:** in the sidebar, click **Adventure** → loading screen → title → portal cinematic → character creation (it has a 🎲 Randomize button) → the world.
- **Python side (`game/`):**
  - `campaign.py` is the game itself, plus `combat.py` and `world.py` (world map/genres).
  - `layout.py` builds each 3D place: biome pools, per-place palettes, set pieces, and a navigation grid with validation and repair.
  - Also `actors.py`, `inventory.py` (shops, wandering trader, reforge), `dm.py` (AI Dungeon Master with offline fallback), `voices.py` (Kokoro online / Piper offline per speaker) and `api.py`.
- **Data (`game/data/*.json`):** all content.
  - `biomes.json`: 29 biomes.
  - `setpieces.json`: 53 little scenes.
  - `enemies.json`: 62 enemies, 12 bosses, plus summons.
  - `world.json`: genres, NPC roles, place names.
  - Also items, abilities, classes, species and cards.
- **Client (`ui/game/`):**
  - `main.js`: the game loop, loading screens, portal cinematic, battle director, shops, settings.
  - `world.js`: ground, paths, faceted low-poly water, scenery drawn in batches.
  - `characters.js` (actors), `anim.js` (procedural and species animation), `retarget.js` (puts the Universal Animation Library clips on any humanoid).
  - `assets.js`: loading with texture sharing, `preloadAll`, and `release()` to unload models from places you've left.
  - `audio.js`: generated music themes, ambience, creature sounds, voice ducking and a **watchdog** that brings sound back.
  - Also `vfx.js`, `dice3d.js` and `ui.js`.
- **Asset pipeline (`game_tools/`):**
  - `build_game_assets.py` with `jobs`, `copy` and `catalog`. The catalog step is **resumable**: it remembers finished files, so use e.g. `CATALOG_BUDGET=140` and re-run until it's done.
  - Also `blender_convert.py` (FBX→GLB in Blender), `fix_materials.py` (repairs invisible converted models), `shrink_textures.py`, and `dev_server.py` (browser testing: `python game_tools/dev_server.py 8770`, then open `http://localhost:8770/game/index.html?bridge`).

## 4. What was done in the last sessions (newest first)

0000000000. **Emotional voice: Chatterbox Turbo (24 Oct 2026, newest)**
   - **What it is:** a new tick box in Characters, "Emotional voice (Chatterbox)". When it's on, English lines are spoken by Chatterbox Turbo (Resemble AI, MIT licence, runs on the PC) instead of Piper. Chatterbox acts the line out itself: it really laughs, chuckles, sighs and gasps.
   - **How it works:**
     - The AI's `*giggles*`, `*laughs*`, `*chuckles*`, `*sighs*` and `*gasps*` become Chatterbox tags (`[laugh]`, `[chuckle]`, `[sigh]`, `[gasp]`). When the box is on, the AI is told to use them.
     - Chatterbox copies the timbre of the character's normal voice. The first time, the normal voice reads ~8 s of text, saved in `data/chatterbox_refs/`.
     - With an RVC clone, Chatterbox speaks first and RVC turns it into the clone.
     - Breaths and pauses (`expressive.finish`) are still added. The pitch melody isn't, because Chatterbox makes its own.
   - **English only:** non-English lines (or a non-English character) keep the normal voice. If Chatterbox fails, the normal voice is used and the [tags] aren't read out.
   - **Files:**
     - `senses/chatter.py` (new)
     - `brain/pinakamain.py`: `VOICE_CHATTER`, `_use_chatter`, `_chatter_base`, `warm_chatter`, and the start of `synth_voice`
     - `app.py`: `chatter_status`, the `emotional` character setting, `preview_voice(emotional)`
     - `ui/index.html`, `ui/app.js`, `ui/mock.js`
     - `tests/test_chatter.py`
   - **Setup:**
     - `python -m pip install chatterbox-tts` (done).
     - The model (~3 GB, Turbo files only) is in the Hugging Face cache. `chatter.py` loads it with `from_local` so the bigger files aren't downloaded.
   - **Watch out:** installing chatterbox-tts changed torch from 2.14 to 2.6.0. That broke torchvision 0.29, which crashes `transformers` when it imports models. `chatter._no_torchvision()` hides torchvision from transformers, so nothing else needs it. RVC still works on torch 2.6.
   - **Emotion tags:** the model also knows "how it's said" tags: `[happy] [angry] [fear] [surprised] [sarcastic] [crying] [whispering] [dramatic]`. Each sentence's detected feeling (`voice_emotion.detect`) adds one when it's clear: `chatter.with_mood`. Sad and soft need a very clear feeling.
   - **Fixes for your package versions** (all inside `chatter.py`, nothing installed):
     - torchvision is hidden from transformers.
     - With numpy 2, librosa returns float64 audio, which Chatterbox can't take, so `_Librosa32` makes it float32.
     - The watermark (`perth`) needs `pkg_resources`. Without it, a no-watermark stand-in is used. To get the watermark back: `python -m pip install "setuptools<81"`.
   - **Speed on the processor (i5-11400H)** is too slow for real time:

     | | Time |
     |---|---|
     | Model load | ~40–80 s |
     | Copying a new voice | ~15 s, once |
     | Work per 1 s of speech, Chatterbox alone | ~3.1–3.5 s |
     | Work per 1 s of speech, with Rick RVC | ~4 s |

     A 3–5 s line takes ~12 s before she starts. int8 quantization didn't help (3.25 s).
   - **The PC has an NVIDIA RTX 3050 laptop GPU (4 GB), but torch is the CPU version.** `chatter.py` uses the graphics card automatically when it can (falling back to the processor). Graphics-card torch for the version Chatterbox needs, which also fixes torchvision:
     `python -m pip install torch==2.6.0 torchaudio==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124`
     Not measured yet on the GPU. The model is ~3 GB, so it's tight in 4 GB.
   - **Not done:** RVC (`senses/rvc.py`) is processor-only and could also use the graphics card later.
   - Tests: 447 OK, 3 skipped.

000000000. **"Copy a character" personality box (24 Oct 2026)**
   - In Characters → edit a character, there's a new text box under **Personality** with a **✓** button on its right.
   - Type any character (e.g. "Rick Sanchez" or "Jake the Dog") and press ✓ or Enter. The AI writes a Personality text describing how that character talks: attitude, slang, verbal tics, catchphrases and how they treat you. The text goes into the Personality box. Press **Save** to keep it.
   - If the Name box is filled (e.g. "Pip"), it writes "You are Pip, talking exactly like Rick Sanchez…". If the Name box is empty, it fills in the character's name.
   - It uses the normal AI: Groq when online, the local model offline. Every text ends with "Keep replies under 40 words and speak only in dialogue, never actions."
   - Files:
     - `app.py`: `make_personality(who, name)`
     - `ui/index.html`: `.persona-gen` row
     - `ui/app.js`: `makePersonality()`
     - `ui/style.css`
     - `ui/mock.js`: the preview fake
     - `tests/test_personality.py`
   - Tests: 442 OK, 3 skipped.

00000000. **Faster, real-time speech + console list removed (24 Oct 2026)**
   - **She starts talking sooner:** a reply is now voiced in small pieces. The first few pieces are cut at commas (at least 12 letters and 3 words), so she starts after about 2 seconds instead of waiting for a whole sentence. Later pieces are cut at full sentences, or at commas when they get long (40+ letters). Very tiny pieces are avoided because each piece has a small extra cost. (`brain/pinakamain.py`: `SpeechStream._cut`.)
   - **Clone voices (RVC) can convert several pieces at the same time.** Only loading a voice waits its turn now (`senses/rvc.py`: `convert()`).
   - **Pieces are made in order, two at a time.** The first piece gets the computer to itself, then each piece waits for the one two places before it. That way the next piece she needs is always ready first (`SpeechStream._submit`).
   - A piece that ends at a comma keeps the voice up at the end instead of dropping it like the end of a sentence (`senses/expressive.py`).
   - Measured on a long reply with Rick's voice (the PC was busy with OneDrive, so times vary):

     | | Before | Now |
     |---|---|---|
     | First sound | ~2.2 s | ~2.1 s |
     | Silence in the middle | ~9 s, in one long pause | ~4–8 s, split into short pauses |
     | Finished after | ~40 s | ~34–38 s |

     Voicing every piece at once made the first sound much slower (5–8 s), so that wasn't used.
   - **The console tiles on the Retro home page were removed** (`ui/games/games.js`, `games.css`, `index.html`).
   - Tests: 439 (3 skipped). New test: cutting long sentences at commas (`tests/test_batch8.py`).

0000000. **Retro Games update (23 Oct 2026)**
   - **No "Exit Emulation" button** in the game's menu (it only left a frozen "EmulatorJS has exited" screen). Leave with "← Back to games". (`ui/games/player.html`: `EJS_Buttons = { exitEmulation: false }`.)
   - **Emulator engines are on this PC:** EmulatorJS 4.2.3 (free, open source) is in `ui/games/emulatorjs/data/` (about 155 MB, with all its cores; the duplicate "-thread" cores and the `src` folder were removed). The player loads it from there and only uses the internet copy (cdn.emulatorjs.org) as a backup. To reinstall it, download `4.2.3.7z` from github.com/EmulatorJS/EmulatorJS/releases and extract its `data` folder there.
   - **English games only:** every list and search only shows (USA), (Europe), (World), (En,…) and English-translated games, plus names with no country. Japanese, Korean, French and other versions are hidden (`retrogames.is_english`).
   - **Console tiles** on the Retro home page (24 consoles, in the style of the website's console list), above Most Popular Games.
   - **⬇ Downloaded:** a new list (top bar + sidebar) of the games saved on this PC, with their size, **Play**, **Delete**, and **Delete all**. You press Delete twice to confirm. Your saves are kept. (`retrogames.downloads()` / `delete_download()`, API `retro_downloads` / `retro_delete`, and in `dev_server.py` too.)
   - **Not done:** downloading every game from romsgames.net. Copying a whole website of commercial games is piracy, and it would be many terabytes. Games still download one at a time from RetroGames.cc when you play them. PS2, GameCube, Wii, Xbox, Dreamcast and 3DS can't run in this browser emulator anyway.
   - Tests: 438 (3 skipped). New tests: English-only filter and deleting downloaded games.

000000. **Human-sounding voice, high/low clone voices, low tunes and button sounds (23 Oct 2026)**
   - **Speak with** now has 7 choices: the voice picked above, or Female / Male · high / normal / low.
   - **Emotion you can hear** + **natural speech** (`senses/expressive.py`, see section 3): melody per feeling, questions rising, real pauses at "…", breaths, sighs and gasps, laughs said out loud, and a **Pronunciations** box in Settings → Voice & camera.
   - Characters → new **Natural speech** checkbox under the Emotion slider.
   - **3 low tunes** (`ui/psp.js`): Midnight drive (low synth + beat), Cello room (low strings), Deep night piano (low felt piano). New instruments `cello` and `felt`. The low root note never goes below ~50 Hz.
   - **3 low button sounds:** Deep wood, Soft thud, Deep bell.
   - **High and low clicks:** two plain button clicks, **Click (high)** and **Click (low)** (`click()` in `psp.js`: a tiny noise tick + tone). Plus Settings → Sounds & effects → **Button pitch** (High / Normal / Low), which works with every button sound (`setSfxPitch`, saved as `sfx_pitch` and in the browser's storage so the Games hub uses it too).
   - Samples to listen to in `rvc_samples\`: `emo_N_<feeling>.wav` (new) next to `emo_N_<feeling>_plain.wav` (before), and `emo_rick_male_high/male/male_low.wav` (the Rick clone, surprised, ≈257 / 212 / 177 Hz).
   - Checked on the dev server: the 7 Speak-with choices, the Natural speech box, saving pronunciations, and all 3 low tunes + 3 low button sounds play with no errors.
   - Tests: 436 OK (3 skipped). New: `tests/test_expressive.py` (8), plus tests for the mood that lasts, a lone *sighs*, and high/low voices.
   - **Not heard yet on my PC** — please listen and say if a feeling is too strong or too weak (the numbers are in `expressive.STYLES`).

00000. **Real voice clone test with Rick and Gojo + emotion in the voice (23 Oct 2026)**
   - Downloaded the 2 RVC helper models into `tools\rvc\` (`rmvpe.pt` 173 MB, `vec-768-layer-12.onnx` 360 MB). `setup_rvc.ps1` now downloads with `curl.exe` (resumes, retries 3 times; much faster than Invoke-WebRequest).
   - **End-to-end test:** real TTS → real RVC, 6 cases: Rick in English (twice) and Tagalog, Gojo in Japanese, Korean and English. All gave clean audio of the right length, with the pitch kept (pitch −12 halves it: 196 → 97 Hz). Listen in the project's **`rvc_samples\`** folder (`N_Voice_lang.wav` = clone, `_before.wav` = the normal voice). You can delete that folder when you're done.
   - Faster conversion: `rvc.convert()` no longer makes the padding audio it throws away (`MARGIN`), about 1.5× real time instead of 2–2.8×.
   - **Emotion in the voice** (see section 3): Characters → **Emotion in voice** slider.
   - faiss is still not installed, so the `.index` "likeness" isn't used yet (optional: `python -m pip install faiss-cpu`).
   - Tests: 426 OK (3 skipped).

0000. **5 new tunes, button-sound styles, RVC voice clones (23 Oct 2026)**
   - **Music (`ui/psp.js`):** 5 new background tunes: Rainy café (lo-fi plucks + soft beat), Sunrise (marimba), Deep sea (slow ambient), Retro arcade (chiptune + beat), Starlit garden (music box). With "Dreamy menu" (hub) and "Night room" that's 7, plus **Shuffle** (a new tune about every 32 bars). Settings → General → Sounds & effects → **Room music** (saved as `bgm_theme`).
   - **Button sounds:** 5 styles (Crystal/PSP, Bubbles, Wood/marimba, Retro game, Wind chime) plus **Mix** (a different one each press). Every click also lands on a different note of a pentatonic scale, so repeated clicks don't sound the same. Settings → **Button sound** (saved as `sfx_style`, and in the browser's storage so the Games hub uses it too).
   - **RVC voice clones** (see section 3): Characters → Voice clone (RVC) → **Import a voice** → pick the `.pth` (and the `.index`) → choose it → pitch / likeness → **Save character**.
   - **New files:** `senses/rvc.py`, `senses/rvc_models.py`, `scripts/setup_rvc.bat` + `setup_rvc.ps1`, `tests/test_rvc.py` (10 tests; one loads the real Rick voice from Downloads if it's there).
   - Tests: 421 OK (3 skipped). Checked on the dev server: the voice clone box (import/select/delete in the mock), all 7 tunes and 5 button styles play with no errors.
   - The full conversion with real speech was done in the next session (see 00000). **Not heard yet on my PC:** the new tunes and button sounds.
   - **How to set up voice clones (step by step):**
     1. In the project folder, open `scripts` and double-click **`setup_rvc.bat`**. It downloads 2 helper models (~530 MB) into `tools\rvc\` and tries to install faiss.
     2. If faiss didn't install, run this yourself (optional, makes clones sound closer):
        ```
        python -m pip install faiss-cpu
        ```
     3. Start the app → **Characters** → your character → **Voice clone (RVC)** → **Import a voice (.pth + .index)…** → go to e.g. `Downloads\Rick%20Sanchez` → select `model.pth` **and** the `.index` file (hold Ctrl) → Open. The copy goes to `data\rvc_voices\Rick Sanchez\`.
     4. Pick it in **Clone voice**. If her normal voice is female and the clone is male, set **Clone pitch** to about −12 (or choose "Speak with: A male voice in her language" and keep pitch 0).
     5. Press **Hear this voice** (the first time takes a few seconds), then **Save character**.

000. **PSP sound in the room + livelier sidebar (23 Oct 2026, later)**
   - **New `ui/psp.js`:** one shared sound engine (background tunes "hub" and "room", plus hover/click/open/close/start sounds) with a soft compressor so it's heard on laptop speakers. `ui/games/hubfx.js` now uses it.
   - **Hub music fix:** it used to wait for your first click and was very quiet and low-pitched. Now it starts as soon as the hub opens (in a normal browser it still waits for the first click).
   - **Main room (`ui/app.js` "background music in the room"):** plays the "room" tune. It rests while My Music or Spotify plays, during meeting recording and while the window is hidden. It goes quiet while she talks or while you give a voice command. Settings → General → Sounds & effects has "Background music" and "Music volume" (saved as `bgm` / `bgm_volume` in `save_ui`).
   - **`ui/fx.js`:** tap/open/close now use the PSP sounds, plus a hover tick on menu items and buttons.
   - **Sidebar (`ui/index.html` `.side-bg`, end of `ui/style.css`):** a faded glow in the theme colour drifts slowly behind the menu, with soft wave lines and a dark layer so the text stays readable. Hovered items slide right with a light bar and a shine, the open item breathes, and the name shimmers. Turned off by "Animations and visual effects" off or reduced motion.
   - Tests: 411 OK (3 skipped). **Not heard on the real PC yet:** music volume and how it mixes with her voice.

00. **Hub, title scene, collision, camera and speed (23 Oct 2026)**
   - **Games hub (`ui/games/`):** `hubfx.js` adds an animated waves background, PSP-style background music and UI sounds (hover, click, open) in Vermeil's theme. It's wired into `games.js`, `index.html` and `games.css`, and the music starts after the first click because browsers block autoplay.
   - **Title screen (`ui/game/main.js` `titleScene`):** it's now a night campfire. A character sits on a log by the fire, with the portal glowing in the background. Positions are set by `TITLE_SEAT`, `TITLE_FIRE` and `TITLE_SHOT`. `ui/games/img/adventure.jpg` was re-rendered to match.
   - **Weapons (`ui/game/characters.js`, `anim.js`):**
     - Hand grips are measured in the standing pose, and staffs are held at their middle. Every species was checked.
     - `anim.js` forces the three.js mixer to re-apply the pose so the hands are in place before a weapon is attached.
     - The Ranger has a quiver full of arrows on its back.
   - **Collision:**
     - `game/layout.py` `_solidity()` decides how solid each scenery piece is by its name. Bushes, plants, grass and flowers can be walked through. Trees are solid at the trunk (0.3 of the radius), and rocks, boulders, logs, pillars and so on at 0.75.
     - `ui/game/world.js` `collide()` pushes the hero out of solid pieces, so they slide along them. It's used in the player movement in `main.js`.
     - This only applies to **newly generated places**. Places already in a save keep their old layout.
   - **Camera:**
     - `engine3d.js` `updateCamera` raycasts from the hero to the camera about every 0.12 s against `main.js` `solidMeshes()`. If something blocks the view, it swings up or sideways, or pulls in, then eases back out.
     - In battles, `clearView()` and `fighterPoints()` pick a wide shot and an enemy intro shot from which every fighter and the boss can be seen.
   - **Speed:**
     - `ui/room.js` `_frameDue()` stops drawing while the window is hidden and draws at most 30 fps when nothing is moving. It lowers the render resolution by itself when frames get slow, and raises it back when they're fast.
     - `ui/app.js` `placeBubble` skips its layout work when the speech bubble is hidden.
   - **Faster text-to-speech:**
     - `brain/pinakamain.py` `SpeechStream.feed` cuts a long first sentence at a comma, so speaking starts sooner.
     - The game (`main.js` `speak()`) asks for the next line's audio while the current one is still playing (up to 2 ahead).
   - **Tests:** 411 ran, all OK (3 skipped).
   - **Dev server for testing:**
     ```
     $env:GAME_SAVE_DIR=(Resolve-Path data\game\test_saves).Path; $env:GAME_NO_AI='1'; python game_tools/dev_server.py 8771
     ```
     Then open `http://127.0.0.1:8771/game/index.html?bridge&quickload`. The hub is at `/games/index.html?bridge` and the main app at `/index.html`.
   - **Not checked on my real PC yet:** how much smoother the room feels, and the hub music volume.

0. **Batch 11 (22 Oct 2026)** - see FEATURES.md "Batch 11" and README:
   - `senses/ducking.py`: other apps' volume lowered while giving a command / while she speaks (pycaw per-app volume).
   - Game companion = the app's active character (`app.py _game_companion`, `camp["companion"]`, `game/companion.py name()/system_prompt()`); uid stays "vermeil" internally; client model ids `app:<file>` load from ui/models.
   - Gym Alternatives tab (`skills/exercise_db.json`, `gym.find_alternatives`).
   - `scripts/package_app.py` + `scripts/install.ps1` (installer zip), `brain/plugins.py` + `ui/plugins.js` (Settings → Plugins).
   - Electronics: `skills/electronics.py`, `ui/electronics.js` panel, Circuit Lab page `ui/electronics/` (parts.js, sim.js, view2d.js, view3d.js, lab.js).
   - Ollama bundled in `tools/ollama` via `scripts/setup_ollama.bat`; `llm.start_ollama/stop_ollama` start it hidden and stop it on exit.
   - Tests: `tests/test_batch11.py`. Not yet run on the real PC: ducking with real music, setup_ollama, the installer on a second PC.

1. **More dungeons:**
   - The existing dungeon is richer.
   - New enclosed biomes: **Forgotten Crypt, Deep Mines, Derelict Space Station** and **Smugglers' Cove**.
   - New set pieces: torture chamber, sarcophagus hall, mine-cart line.
2. **The whole library is used:**
   - The catalog was rebuilt to 3,355 models (it was 1,346).
   - Biome pools now draw from many packs, and each place picks its own palette of at most about 6 kinds per pool.
   - 50+ set pieces; the "giant" trees and rocks option; footprints capped so flat models aren't scaled huge.
   - Places have 1.5 to 4 times more objects.
3. **New biomes:** Golden Farmlands, Harbor Town, Sakura Valley, Sky Islands (platformer packs), Blocklands (Cube World), Haunted Manor (interior and furniture packs) and Frontier Outpost.
   - Each has its own music (new themes: sakura, sky, manor), ambience, particles (petals, sparkles) and NPC roles (rabbit folk, blockfolk, monk, butler, ghost hunter).
4. **Monster sizes:**
   - Every enemy has a real height in metres, varies ±10%, and about 1 in 12 is an "Alpha" (×1.4–1.75, tougher).
   - Bosses are house-sized (6–9.5 m), e.g. "Grukk the Ogre Warlord" at 6.5 m.
   - Battle spacing and the camera scale with the biggest monster.
   - 24 new enemies and 4 new bosses (mimic, eye drone, xeno horror, war tank, blocky mobs, Brontosaur, Ul'thoth the Elder Horror, the Block Colossus, the Alpaking Sovereign, Overlord Mk-IV).
   - "Rock Golem" was renamed **Goleling**, after its real model.
5. **Loading and memory:**
   - The first loading screen loads characters, monsters and items (387 models).
   - Each place's loading screen loads that place's scenery; models from older places are unloaded.
6. **Subtitles:**
   - Speech goes through one queue, so a new voice never cuts off the narrator.
   - The text stays up until the whole recording has played.
   - The voice limit went from 600 to 3,000 characters.
7. **Sound:**
   - The audio watchdog resumes or rebuilds the audio if Windows pauses it (this was the "sound cut for 2 minutes in battle" bug).
   - Silent and invalid sounds are skipped safely.
   - A natural 20 plays a fanfare with a gold dice tray glow; a natural 1 plays "wah-wah".
8. **Earlier work:**
   - Low-poly faceted water.
   - Kokoro inside the app.
   - Loading screens, portal walk-in, species animations, music and creature sounds, shops, wandering trader, reforge, inn, voice volume sliders, randomize button.
   - Fixed 424 invisible converted models.

### 24 Oct 2026: App Inspection, Windows cp1252 Output Fix & GitHub Preparation
- **Windows console Unicode fix:** Windows default console encoding (`cp1252`) crashed when printing status emojis (`✅`, `⚠️`, `🗑`, `❌`) in `brain/pinakamain.py` and `brain/plugins.py`. Added safe stdout/stderr reconfigure in [folders.py](file:///c:/Users/jpant/OneDrive/Desktop/coding/2025/2025/folders.py) (`errors="replace"`), resolving the `UnicodeEncodeError` in the test suite without altering console environments.
- **Test verification:** Ran `tests.test_vermeil` (60 passed), `tests.test_batch11` (27 passed), `tests.test_game` (44 passed), and `tests.test_spotify` (13 passed).
- **GitHub Preparation:**
  - Created [`.gitignore`](file:///c:/Users/jpant/OneDrive/Desktop/coding/2025/2025/.gitignore) covering secrets (`env`), massive binaries (`Packages/` with ffmpeg >185MB), large AI models (`tools/kokoro/*.onnx`, `tools/rvc/*.pt`, `data/piper_voices/`, `data/rvc_voices/`), raw asset library (`dnd/` 7GB), user conversation memories/journal, retro saves, and ROMs.
  - Added [`.gitkeep`](file:///c:/Users/jpant/OneDrive/Desktop/coding/2025/2025/tools/kokoro/.gitkeep) in `tools/kokoro` and `tools/rvc`.
  - Created [`env.example`](file:///c:/Users/jpant/OneDrive/Desktop/coding/2025/2025/env.example) documenting configuration keys with safe placeholder values.
  - Cleaned git staging from 24,719 files down to 4,792 clean repository files with zero secrets and zero files over GitHub's 100MB limit.

## 5. Status / things to check next

- All of this session's changes have been copied straight into the project folder on my PC (no manual install needed).
- **Not yet tested on my real PC:** Kokoro (run `scripts\setup_kokoro.bat` first), RVC voice clones inside the app (the helper models are already in `tools\rvc\`; only the samples in `rvc_samples\` were made), emotion in the voice, the new tunes and button sounds, the new biomes, and memory use over a long session.
- **RVC on CPU is slower than plain TTS** (each sentence waits for its conversion). About 1.5 s of work per 1 s of speech after warm-up, with a slow first sentence. If it's too slow: pause OneDrive sync, use a shorter reply style, or later try onnxruntime-directml / a GPU build of torch.
- **Ideas not done yet:**
  - Assemble buildings from the modular megakit pieces (walls and floors are currently only used for dungeon rings and floors).
  - Use the headless "Modular Character Outfits" on a base body.
  - Fish swimming in water.
- **OneDrive slows big file writes.** Pausing sync, or moving the project out of OneDrive, makes it faster.

## 6. Notes for the next Claude

- Read `game/README.md` (game overview and latest changes) and the main `README.md` (app setup, the Kokoro section).
- Run the tests before and after changes. `tests/test_game.py` checks that every biome builds a valid, full place, that every pool and set piece finds models, monster sizes, the preload list, and invisible models.
- Change the game by editing the JSON in `game/data/` first; the layout builder and client read everything from there.
- **Never** output the contents of `env`.
