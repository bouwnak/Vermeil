# Handover: Vermeil assistant + "AI Dungeon Adventure" game

Paste this whole file into a new Claude conversation, together with the project folder, to continue the work.
Last updated: 2026-10-28.

---

## 1. Who I am and how I like to work (standing rules)

- **Always beginner-friendly.** Use simple explanations and give step-by-step instructions that say exactly where each file goes.
- **Use the available skills** whenever they apply.
- **Never print, show or send secrets.** The project's `env` file holds GROQ_API_KEY, the Spotify keys and WEATHER_API_KEY. You may count its lines, but never output its contents.
- **pip:** normally give me the exact `python -m pip install ...` command to run myself. (In PowerShell a command that starts with a quoted path needs `&` in front.) If I ask you to install something, you may run it.
- **The `dnd` folder is my asset library. Never modify it.** All copies, conversions and fixes go into `ui/game/assets/`.
- **The RVC voice folders in my Downloads are references** (`Rick%20Sanchez`, `SatoruGojo_JP`, `MJThrillerEraV2`, `Ash Ketchum (Pokémon Masters EX) - Weights Model`, `Hiccup`, `Bubbles`, `Mickey%20Mouse`). Never change them; importing copies them.
- **ALWAYS UPDATE THIS HANDOVER.** Every session, every AI (Claude, Gemini, Antigravity…), no exceptions: before finishing, add what was changed (newest first in section 4), the files touched, the test count, and what's still not done or not tested. Also keep this rule itself in the handover.
- I prefer testing on the dev server (see section 4, the 23 Oct entry).
- I'm in the Philippines (Asia/Manila time zone). I work on Windows, and the project is synced by OneDrive.

## 2. Project location

- **On my PC:** `C:\Users\jpant\OneDrive\Desktop\coding\2025\2025\`
  - `app.py` starts the main app (pywebview window, Vermeil the 3D anime-girl companion, Groq AI online, Ollama offline).
  - `dnd\` is the asset library: 81 folders from Quaternius packs. The game uses 72 packs, 3,355 models.
  - `tools\kokoro\` holds the Kokoro TTS model files (`kokoro-v1.0.onnx`, 325 MB, and `voices-v1.0.bin`).
  - `tools\rvc\` holds the 2 RVC helper models (`vec-768-layer-12.onnx` and `rmvpe.pt`) once `scripts\setup_rvc.bat` has run. Imported voice clones go in `data\rvc_voices\<name>\` (`model.pth`, `model.index`, `info.json`).
  - `env` is the secrets file. **Never read it out.**
- **The Unity game:** `C:\Users\jpant\My project\` (Unity 6000.6.7f1). The finished game is `Build\Vermeil.exe`. Rebuild with the command in README ("adventure rebuilt in Unity 6"). The game's art is copied into `Assets\Vermeil\Resources\Art\` (never edit `dnd\`).
- **Python:** the app runs on Windows Python 3.13 (some old 3.10 caches exist too).
- **Tests:** `python -m unittest discover -s tests`. The last run (28 Oct 2026) passed all 481 tests (3 skipped). The game tests alone (`tests.test_game`) are 44.

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

0000000000000000000000. **Every feature installs from one Google Drive folder link (29 Oct 2026, newest)**
   - **Remove completely / reinstall from Drive (29 Oct 2026, latest):** `plugins.own_packages(p)` = the feature's pip packages + everything they pull in (`importlib.metadata` Requires-Dist, extras ignored) minus `keep_pip()` (CORE_PIP + `ALSO_KEEP` scipy/huggingface_hub/onnxruntime, which the app's own code uses + every requirements.txt line that isn't a feature's) minus what other installed features need. `uninstall()` pip-uninstalls that whole set, deletes the local zip when it's on Drive, and `freed` counts the packages (sizes from each package's RECORD, cached in `_pkg_mb`; installed packages cached in `_dist_cache`, cleared by `_pip`). `status()` `used_mb` includes packages (~2.6 s, mostly folder sizes). `_install_now`: zip from Drive -> wheels -> `pip install --no-index --find-links` (+ `SHARED` zips like `pytorch.zip` via `_fetch_shared`), then the downloaded zip is deleted. Packager: `feature_wheels(p, tmp)` pins `name==version` from this PC (`--no-deps`; torch with the `--extra-index-url` from requirements-ai.txt), not-installed packages download with their deps; `make_drive` writes `00 pytorch (shared)/pytorch.zip`. Tests: `RemoveCompletelyTests`, `test_wheel_names`. **Uploaded 29 Oct 2026:** the `--with-wheels` build (6.0 GB, every feature zip + `pytorch.zip`) was copied to `G:\My Drive\Vermeil` with robocopy; gym.zip checked with `pip install --dry-run --no-index` (openpyxl 3.1.5 + et_xmlfile 2.0.0, nothing installed). The 6 `test_gym` errors only mean Gym is uninstalled on this PC (no openpyxl) - press Install on Gym.
   - **Built in:** `plugins.DRIVE_FOLDER` = the owner's Vermeil folder (`https://drive.google.com/drive/folders/1J3qV6WX3p_DCdKtG_b0H8rUB6LYcaZtk`). `folder_link()` (pasted `_folder` first, else DRIVE_FOLDER), `folder_files()` (cached 10 min, [] when offline), `_cached_zip`, `_link_for(p)` (saved link, else finds `<zip_name>.zip` in the folder and saves it), `warm_folder()` (background read when Settings -> Plugins opens, then a `_folder` plugin event redraws). `install()` / `_install_now` / `_fetch_pack` use `_link_for`. Games hub: an empty link box = every game in that folder (`mygames.add_url("")`).
   - `brain/gdrive.py`: `folder_id`, `parse_folder_page`, `list_folder(url, depth=3)` - reads a shared folder through Drive's plain list page (`embeddedfolderview?id=`), walks sub-folders, returns `{name, id, path, url}`. A private folder (sign-in page) raises a clear error.
   - `brain/plugins.py`: `zip_name(p)` (= `pack` or the feature id; every feature can have a zip now), `use_folder(url)` (finds `<zip_name>.zip` for every feature, saves the links + `_folder` in `data/plugin_links.json`), `set_link` works for every feature, `_fetch_pack`, `_files_missing`. `_install_now`: 1) zip (local `plugin_packs/` or downloaded from Drive) -> unpacked, 2) pip from the zip's `plugin_packs/wheels/<id>/` with `--no-index` (falls back to the internet, then deletes the wheels), 3) anything still missing from the internet. `status()` gives `folder` and `zip`.
   - `app.py`: `plugins_use_folder(url)` (kept for code use only). UI: a card says "downloads <zip>.zip from the Vermeil Drive folder".
   - **Voice speed (29 Oct 2026, newest):** `senses/gpu.py`: `cuda()` (once: imports torch, `ort.preload_dlls()`; False with
     `VOICE_DEVICE=cpu`, CPU-only onnxruntime or no CUDA), `providers()`, `session(path, so)` (CUDA, falls back to CPU),
     `on_gpu()`. Used by `tts._voice` (`PiperVoice.load(use_cuda=gpu.cuda())`), `rvc._contentvec` (when `_device()` is cuda;
     `_use_cpu()` clears `_cache["vec"]`), `kokoro._session`. `rvc._convert` runs `net.infer` under `torch.autocast` fp16 on cuda.
     Before, onnxruntime-gpu silently used the CPU (no CUDA DLLs found). Measured (RTX 3050, Bubbles): long sentence 3.2 s -> 1.1 s
     (ContentVec 1.28 s -> 0.14 s, Piper 0.58 -> 0.28 s, RVC net ~25% faster); SpeechStream first audio 1.9 s -> 0.9-1.1 s, no gaps.
     onnxruntime-gpu 1.31 is built for CUDA 13 (nvidia-*-cu13 pip packages) while torch is cu124; both load fine together. Tests: `test_gpu.py`.
     **DirectML (newest):** `gpu.kind()` = "cuda" / "directml" (onnxruntime-directml installed: `DmlExecutionProvider`) / None.
     `providers()` gives `gpu.DML` (`performance_preference: high_performance`); `session()` sets `enable_mem_pattern=False` +
     `ORT_SEQUENTIAL` for DML and wraps the session in `_OneAtATime`: ALL DirectML sessions share one lock `_dml_lock`, because two
     DML sessions running at once on different threads crash Python (access violation, seen with Piper + ContentVec side by side).
     `tts._voice` builds `PiperVoice(session=gpu.session(path), config=PiperConfig.from_dict(json))` for DML (Piper's own loader
     only knows CUDA). Checked with onnxruntime-directml 1.24.4 unpacked into scratch (not installed): Piper 0.25 s, RVC 0.9 s,
     3 sentences at once OK, Kokoro on DML. Test: `test_directml_for_any_card`.
   - **Setup bar on every start - fixed (29 Oct 2026, newest):** `builtins_missing()` wrongly listed Chatterbox and RVC every
     time: `has_module()` guessed the import names `chatterbox_tts` / `faiss_cpu`. Now `IMPORT_NAME` has `faiss-cpu: faiss`,
     `chatterbox-tts: chatterbox`, and `has_module()` falls back to `importlib.metadata.version(pip_name)`. `_files_missing()`
     for the offline AI uses `_ollama()` (= `llm.ollama_exe()`: tools/ollama or a normal Ollama install), not only
     tools/ollama/ollama.exe. On this PC `builtins_missing()` is now `[]`. Tests: `test_installed_packages_with_other_import_names_count`,
     `test_a_normal_ollama_install_counts`.
   - **Built-ins + progress bars (29 Oct 2026):** `"builtin": True` on voice_commands, kokoro, emotional_voice (Chatterbox),
     voice_clone (RVC), unimate, online_voices, camera, local_ai, calendar, browser. `FEATURES` = the non-builtins (= the sidebar
     features); `status()` lists only those; `is_installed` is True for built-ins; install/uninstall/install_many refuse them;
     `keep_pip()` keeps their packages. `builtins_missing()` + `setup_builtins(step)` (skips local_ai under `OLLAMA_MIN_FREE` 20 GB;
     one failure doesn't stop the rest; raises listing what failed) run from `skills/autosetup.py` part `builtins` before `unimate`.
     Progress: `_log(pid, text, pct, step)` stores `pct`/`step`/`error` in `_jobs` (sent in `status()` and the plugin event) and calls
     `_progress_hook` (setup_builtins maps it to overall %). `ui/plugins.js` shows `.load-bar.plugin-progress` + `.plugin-error`
     instead of log lines; `ui/app.js` shows the setup as a floating `#setupBar`. `ui/style.css`: every bar (`.load-bar`, `.clone-bar`,
     `.progress`, gym/mission/music bars) uses the accent gradient (Spotify's green bar kept). "Load links.txt" button removed
     (`plugins.import_links` / `app.plugins_import_links` still exist, unused by the UI). Tests: `BuiltInPartTests`.
     Rebuilt `Vermeil-App.zip` copied to the Drive folder. Not checked: a real first start downloading Chatterbox on a clean PC.
     **Planner + Generator plugins (29 Oct 2026):** `planner` (code `ui/planner.js`; the planner API in app.py and
     reminders stay in the app) and `generator` (code `skills/generator.py ui/generator.js`, pip `python-pptx moviepy`;
     `IMPORT_NAME` has moviepy). app.js loads planner.js / generator.js with `optional()`; `app.gen_start` / `gen_recent`
     answer "isn't installed" when skills/generator.py is gone. Checked in `?mock` with both files removed (only 404s).
     planner.zip (8 KB) and generator.zip (~36 MB with wheels) are in the Drive folder.
   - **Code-only features are Drive zips too (29 Oct 2026, newest):** these entries have a `"code"` list of their own files:
     spotify `ui/spotify.js` (skills/spotify.py stays in the app, Music's Playlist Lab imports it), kitchen `skills/baking.py ui/baking.js`,
     electronics `skills/electronics.py ui/electronics.js ui/electronics/{lab.html,lab.js,lab.css,parts.js,sim.js,view2d.js,view3d.js}`
     (gizmo3d.js stays, the Builder uses it), missions `brain/missions.py ui/missions.js`, focus `skills/focus.py ui/focus.js`,
     mind `ui/mind.js` (brain/mind.py stays, the chat uses it), code `brain/coder.py ui/code.js`. plugins.py: `_code`, `_needs_zip`
     (folders or code) is used where `folders` was; uninstall deletes the code (`_backup_code` to `_archive/plugin_code/<id>/` first,
     only when `BASE/_archive` exists = the project folder), and `_install_now` runs `_restore_code` (the backup wins if it differs, then it's removed).
     `_amount()` prints KB for small amounts. `brain/optional.py`: `load(name)` gives the module or a do-nothing `Missing` stand-in;
     app.py uses it for `missions` and `coder.CodingAgent`. `ui/app.js` loads the 7 UIs with `optional()` dynamic imports
     (a missing file -> a `notInstalled` proxy panel). `tools.run_tool`: ModuleNotFoundError -> "<feature> isn't installed - install it in Settings → Plugins".
     Packager: `code_files()` keeps them out of the app zip, `feature_files` puts them in the feature zip, `--only app,kitchen` remakes just those.
     Checked: all 7 uninstalled + reinstalled from the real Drive folder in a temp copy (files identical to the project); the UI loaded
     with baking.js/missions.js/code.js removed (only warnings); app.py imported with those modules hidden. Tests: `CodeFeatureTests`.
   - **The link is hidden (29 Oct 2026, owner's friends use the app):** the "Use folder link" box was removed from Settings -> Plugins; `status()` sends no `folder` and no per-feature `link`, only `on_drive` (yes/no); the per-feature link box only shows for a feature whose zip isn't in the folder, and starts empty; `gdrive.hide_links()` strips Google links from every plugin log line (`plugins._log`) and the Games hub errors. Note: it's hidden from the screens, not secret - it's still in `brain/plugins.py` and the folder is "Anyone with the link". The rebuilt `Vermeil-App.zip` (495 MB) with this change is in the Drive folder (downloaded back and checked byte-identical). `package_app.py` now never packs the project's `plugin_packs/` folder into the app zip (those are zips this PC downloaded; each has its own Drive copy).
   - `skills/mygames.py`: `add_url` with a folder link -> `add_folder` adds every game .zip under "Games" (skips ones already in the hub). `ui/games/games.js` shows all added names.
   - `scripts/package_app.py --drive`: `feature_files(p, a, tmp)` makes a zip for every feature that has something (folders, model files, `tools/ollama` without models, and with `--with-wheels` its packages via `pip download`). HOW TO INSTALL.txt now says to paste the folder link.
   - Tests: `tests/test_drive_folder.py` (folder parsing, private folder, folder -> links, install from a zip with offline wheels and no writing outside the app, games from a folder, feature zips).

000000000000000000000. **Side-view fights, Blender monsters, design decisions, Drive packaging, 3 s first sound (29 Oct 2026)**
   - **Unity game (`C:\Users\jpant\My project`), side view on the z = 0 plane:**
     - `Forest/Forest.cs`: floor slab + 3 one-way ledges (`ledges`, `SurfaceBelow`, `Clamp`/`ClampAir`), trees/props in front of the camera are removed (they are children of `w.root`), side hazards (acorn `Column`s, lanes at your height...), `Flat`/`Closest`/`Reach` measure to a foe's body (feet to head) in XY, drops (`Drop`/`Take`/`Pickups`/`CollectAll`: coins, honey, and potion/bomb/ether from elites and bosses), camera `side = true`.
     - `Forest/Fighter.cs` rewritten: gravity 32 (x1.35 falling, x2.2 when Space is let go), jump 14.5, air jump 12, coyote 0.1 s, S+Space drops through ledges, Shift dash 0.18 s / 4.5 m / 0.28 s i-frames (counts for Perfect Dodge), Q bubble 2 s (cooldown 8 s x 0.8^firefly cards; blocks Normal + Hazard, not Unavoidable), R ultimate, E pickup, W/S aim up/down, down-hit pogo. AutoPlay has 11 outputs.
     - `Forest/Foe.cs`: walkers fall, hop up to ledges and drop off them; fliers hover 2.5-4 above you (`bob`). Moves redone for the side view (bite/sweep cones, charge line, aimed spit, rain columns, lane band, leap circle, purple nova).
     - `Forest/Telegraph.cs`, `Forest/Bolt.cs`, `Core/Vfx.cs` (`Ring(..., upright)`), `Actors/Player.cs` (`CameraRig.side`, FOV 30, pitch 5, dist 30), `Core/Keys.cs` (Dash, Bubble, Ultimate, Pickup, UpHeld, DownHeld).
     - **Monsters:** `Tools/blender_monsters.py` builds 25 new low-poly "Beasts" (per biome + fliers + the Thornwyrm), roster in `Core/Data.cs`, import rules in `Editor/ImportRules.cs` / `Core/Art.cs`. The `dnd` assets are only used for the card frames.
     - Autotest (`Vermeil.exe -autotest`) runs with 0 exceptions; screenshots in `Build\shots` (e.g. `12_fight_glade_5`, `16_fight_heartwood_1`).
   - **Design doc:** `Downloads\roguelite_action_platformer_game_design.txt` got section **19a. DECISIONS MADE IN THE PLAYABLE PROTOTYPE** (engine/art pipeline, controls, class stats, EXP 14 + 10 x level, rarity odds, Mythics/Legendaries, shards, biome rosters, shops, solo only).
   - **App (this folder):**
     - Chatterbox: memory fix, token cap (`_max_tokens`), slow guard (`_slow_until`), early cuts at commas -> first sound of a short paragraph in **2.47 s** on the GPU.
     - RVC import loading bar; per-room floor slab; Games hub launches the Unity game; plugin Google Drive links.
     - `scripts/package_app.py --drive` -> `dist/Vermeil-Drive/` (a folder per feature/plugin + games, each with install/uninstall). `scripts/install.ps1` / `scripts/uninstall.ps1`. Portable-files check fixed (DoNotShip list).

00000000000000000000. **Forest runs, real-time combat and level-up cards in Unity (28 Oct 2026)**
   - **Cards (Blender):** `blender/cards/` has `make_cards.py` (builds every card as a little 3D diorama in a frame and renders it), `Cards.blend`, `cards.json` (the 30 cards: 3 Mythic per hero = 18, plus 12 Legendary) and `renders/`. Copies are in the Unity project at `Assets\Vermeil\Resources\Art\Cards\<id>.png` and `Resources\Cards\cards.json`. The card frames reuse the look of the card assets in `dnd\` (not modified).
   - **Heroes:** the six animal heroes (`Heroes/Animals/<Name>`) replace the old humans. `HeroDef` (Core/Data.cs) gained `resource`, `counter`, `counterInfo`, `skillCost` (0 = spends it all), `ranged`, `attackGap`.
   - **New scripts (`Assets\Vermeil\Scripts\`):**
     - `Cards.cs`: loads `cards.json`, `Offer()` (3 cards; your hero's Mythics are rarer and come once, Legendaries stack), `Pick()` (the pick screen; time stops while it is up), `Has`/`Count`.
     - `Forest/Forest.cs`: the run (6 stages x 5 rounds, round 5 = mini-boss, then the Thornwyrm), the arena (WorldGen clearing), spawning, forest hazards, hit tests (`Impact`: Perfect Dodge = dodge pressed within `PerfectWindow` before the hit), damage, XP / level ups, rewards, the boss bar.
     - `Forest/Telegraph.cs`: the ground warnings (circle, cone, line/lane). Drawing and hit test use the same math. Red = normal, purple = can't be countered, amber = hazard.
     - `Forest/Foe.cs`: enemy AI (chase or keep distance, moves bite/slam/sweep/charge/spit/rain/lane/leap/nova), stagger (bosses max 0.5 s), boss phases.
     - `Forest/Fighter.cs`: the hero (move, dodge with 1-2 charges, attack, skill, satchel, the six counters, every card effect, autotest autopilot). `Forest/Bolt.cs`: hero shots.
   - `Game.RunFlow` now calls `Forest.Run`. `RunState.cards` holds the cards taken. New keys in `Core/Keys.cs`: `Attack`, `Dodge`, `Skill`, `Satchel`.
   - `Explore.cs` and `Battle.cs` were moved (not deleted) to `C:\Users\jpant\My project\OldCode\`.

000000000000000000. **The adventure rebuilt in Unity 6 as a 3D roguelite (28 Oct 2026, newest)**
   - **Where:** `C:\Users\jpant\My project` (Unity 6000.6.7f1, URP 17, new Input System only, uGUI). Build: `Build\Vermeil.exe`. The art in `Assets\Vermeil\Resources\Art\` is *copied* from `dnd\` (never edit `dnd\`). Everything is built in code from one empty scene (`Assets\Vermeil\Boot.unity`); `Game` boots itself (`RuntimeInitializeOnLoadMethod`).
   - **Scripts (`Assets\Vermeil\Scripts\`):**
     - `Game.cs`: the big loop (campfire → black hole → village → run → village...), `RunState`/`Member`, banking shards/gold, lighting, `MakeHero`/`Dress`/`MakeVermeil`, autotest screenshots.
     - `Cutscenes.cs`: `Campfire` (hero select on the logs), `BlackHole` (props wobble, `Breaker.Shatter` cuts real mesh chunks with physics, `Sucked` pulls them in), `Eject` (everything flies out of the portal with gravity, hero lands on their back, Vermeil's `help_up`), `Ending`, the `Portal` class.
     - `Village.cs`: ring of buildings facing the well, NPC stations (smith = skill tree, trader, tailor = cosmetics, bell tower = Eclipse), hero swap by the inn.
     - `Explore.cs`: one run area (coins, gems on platforms, chests on mountain tops, the caged ally → jar, wandering enemies `Wander`, exit portal; the lair's portal opens after the boss).
     - `Battle.cs`: turn-based timed-press combat (rings, Perfect bonus, blocks, skills per hero, items, Vermeil's turn, boss stomp), evenly spaced rows (`Line`), allies pop out of jars, +EXP/+Gold popups and sounds per enemy.
     - `World/WorldGen.cs`: path (Catmull-Rom), clearings, flat-topped mountains, flat-shaded vertex-color ground, placement that never overlaps or sits on the path (`Free`/`Take`), groves, stepping-stone platforms.
     - `Core/`: `Art` (spawn + fit + footprint), `Rig` (Playables, clip aliases), `Sfx`, `Vfx`, `Keys`, `UI`, `Data` (heroes, allies, enemies, biomes, skill tree, shops, save in `Application.persistentDataPath`), `VoiceBridge`.
     - `Editor/Builder.cs` (`VermeilBuilder.Build`: materials, boot scene, `StreamingAssets/vermeil.json` with the app + Python paths, then the exe), `Editor/ImportRules.cs` (Generic rigs, looping clips, Vermeil's cut-out eyes/hair).
   - **Blender (`Tools/`):** `blender_make_assets.py` makes `Art/Vermeil/Vermeil.fbx` (from `ui/models/anime_girl.glb`, only the mech outfit + original hair, textures saved to `Art/Vermeil/Textures`, new `help_up` clip), `Made/Jar.fbx`, `Made/BlackHole.fbx`; `blender_heroes.py` adds Sit/Lie/GetUp to the heroes; `make_sfx.py` makes the sounds.
   - **Voice:** `game_tools/unity_voice_server.py` (port 8790, `/ping`, `/say?speaker=&text=`). Only speaker `vermeil` (the companion = the app's active character) uses the RVC clone; NPCs use Piper. New `tests/test_unity_voice.py` (8 checks).
   - **Web game:** `ui/game/characters.js` `PAINT_FACE` matches nothing now (no painted eyes on the warrior/ranger).
   - **Fixes after the first self-tests:**
     - Size: `Art.Measure` now uses Unity's own renderer boxes (`updateWhenOffscreen` on skinned meshes); baking the skin by hand came out 100x off for Vermeil and the Quaternius monsters. `Art.Spawn` falls back to the bind-pose box when a rigged fit looks wrong, and `Actor.Start` re-checks the animated size two frames later and rescales. Do NOT drop the clips' scale keys at import: the heroes need them (tried, it broke them).
     - Textures: `Art.FindTexture` finds a material's map by name (spaces, case and ".001" ignored), then `<Model>_Texture`, then the pack atlas (only for `Monsters`/`Cute`). `Art/Monsters/Textures/Atlas_Monsters.png` was copied from `dnd\Ultimate Monsters...` (the monsters were white). Vermeil's glb materials glowed pure white: her emission is now a soft glow of her own texture.
     - Ground: `Shaders/VertexLit.shader` uses its own sky/ground ambient (`_VSky`/`_VLow`, set in `Game.Light`) and caps the light, so the slopes are no longer blown-out white.
     - Particles: `Art.Dot` is premultiplied, so fire and sparkles are round, not squares.
     - `Actor.WalkTo` stops when the actor is removed (that was the NullReference in the village).
   - **Tests:** 481 tests, all OK (3 skipped).
   - **Self-test:** `Build\Vermeil.exe -autotest` plays campfire → black hole → eject → village → first area → first battle, saves `Build\shots\*.png`, logs to the player log, then quits.

00000000000000000000. **Animal heroes remade from the concept art (28 Oct 2026, newest)**
   - **Why:** the user said the earlier heroes looked like "a stickman with skin". They asked for:
     - heroes true to the concept art: animals on two legs, not humans;
     - a fighting stance;
     - face animation when attacking or dodging.
     The user also said to disregard the earlier versions.
   - **Where:** `blender/heroes/` (13 MB), built by the new script `make_heroes.py`. It replaces `blender/pixel_heroes/` and `blender/megabonk_heroes/`. Both old folders (and `make_pixel_heroes.py`) were deleted on 28 Oct 2026 at the user's request.
   - **Body:** a chibi skeleton.
     - Hips at 0.5 m, shoulders at 0.86 m, the head from 0.99 to about 1.45 m: a big head and short thick legs.
     - Big paws and feet with toes (claws on the paladin, gecko and hawk).
     - Each hero is modelled from the concept art. Examples: the frog's headband tails and rope wraps, the platypus's bent wizard hat, staff and water orb, the armadillo's banded shell, ears and kite shield, the fox's hood, quiver, bushy tail and bow, the gecko's slit eyes, spots, hood and daggers, the hawk's crest, beak and wings.
   - **Look:** the same as the Megabonk versions (low-poly, facet-jittered vertex colors, `lit()` sun materials, chunky pixels).
   - **Rig:** the same IK controls as before, plus face bones `jaw`, `eye.L/R` and `brow.L/R` (bone collection "Face"). 31 to 36 bones and 1750 to 2420 faces per hero. IK reach error 0.02 mm.
   - **Animations:** four actions, 8 frames each.
     - **Idle:** the per-hero fighting stance from `STANCES`, with breathing and a blink.
     - **Walk.**
     - **Attack:** from `attacks()`.
     - **Dodge:** a hop back, from `dodge()`.
     - **Face keys:** `key_face()` takes `eye` (scale), `brow` (degrees), `lift` and `jaw` (degrees). The presets are ANGRY, SHOUT, GRIN, WIDE and BLINK.
   - **Previews:** `previews/` has `<Hero>.png`, `_idle`, `_walk`, `_attack` (side view), `_dodge`, `_face` (head close-ups of the expressions) and `AllHeroes_lineup.png`.
   - **Command options:** `-- frog` builds one hero; `-- lineup` remakes only `AllHeroes.blend` and the lineup.
   - **Checked:** all six build; I looked at the lineup, the frog's and hawk's attacks, and the frog and gecko face strips.
   - **Not done:** not imported into Unity. The mouth opening is small at this render size (the eyes and brows read best).

0000000000000000000. **Megabonk-style heroes (28 Oct 2026, replaced by the entry above; folder deleted)**
   - **Where:** `blender/megabonk_heroes/` (6 MB): the six heroes again, in the look of the user's Megabonk screenshots. The 2D pixel versions in `blender/pixel_heroes/` are kept.
   - **How:** the same script with `-- megabonk` (`make_pixel_heroes.py`, flag `MB`). Same shapes, rig, IK and Idle/Walk actions. Differences:
     - Low-poly: spheres 8x6, tubes at most 7 sides, flat shading. Each facet's vertex color is randomly 0.86-1.06x bright (hand-painted look).
     - `thicken()` makes the body and limbs 1.25x fatter around their bone line (clothes too); heads 1.15x.
     - `lit()` materials: Principled BSDF, base color from the `Col` vertex colors (stored linear), roughness 0.85. No outline modifier.
     - `stage_mb()`: perspective 50 mm camera from the front-right and above, warm sun (energy 4, hard shadows), blue sky light 1.1, a faceted grass disc (collection `Stage`). Renders 170x170 (lineup 320x150), 1 sample, filter 0, enlarged 4x.
     - Refinements (MB only): torso thickens 1.1x and limbs 1.3x (`THICK`), so the arms stay visible; gloves 1.45x, bigger boots with cuffs, knee pads, glove cuffs (in `body()`); `brighten()` lifts dark colors.
   - **Attack animations (all heroes, both styles in the script):** an `Attack` action (8 frames) per hero from `ATTACKS` / `posed()` (eased poses of the IK controls). `key_controls` now also keys turns (`rotation_quaternion`, world axes around the control). The hands' Copy Rotation is now WORLD/REPLACE, so the hand takes the control's own turn (weapons aim where `hand_ik` points; the feet are unchanged). The attack previews are rendered from the side (`_attack.png`); the camera saved in the files stays in front. The 2D pixel files were NOT rebuilt with this yet.
   - **Files:** a `.blend` and an `.fbx` per hero (Idle, Walk, Attack clips), `AllHeroes.blend`, and `previews/` (`<Hero>.png`, `_idle`, `_walk`, `_attack`, `_ik`, `AllHeroes_lineup.png`). No sprite sheets (it's a 3D look). 8 MB.
   - **Checked:** all six build, IK within 0.06 mm, the lineup and every attack strip look right. One build hung once before rendering (likely shader compiling while the user's Blender window was busy); rerunning worked. **Not done:** not imported into Unity; no jump animation; small face details (frog mouth) are rough at this size.

000000000000000000. **Pixel-art animal heroes in Blender (28 Oct 2026; replaced and deleted, see the newest entry)**
   - **Where:** `blender/pixel_heroes/`. It has the six heroes from the user's concept art (FrogBrawler, PlatypusMage, ArmadilloPaladin, FoxRanger, GeckoRogue, HawkSwordsman).
   - **The look:** like the user's references (Astral Ascent / Torch of Shadows style): 2D side-view pixel art, NOT voxels. The first voxel version was rejected as "minecraft looking".
     - Slim smooth 3D bodies (tapered tubes and ellipsoids) with 1.3x heads.
     - Toon materials: Diffuse > Shader to RGB > constant ColorRamp with 3 shades (cool shadow, color, highlight) > Emission. The sun has no shadows.
     - Outline: the `Outline` Solidify modifier (flipped normals, material_offset 999 = the last `Outline` material, backface culling).
     - `PixelCamera`: orthographic, side view turned 32° to the front. The hero faces right on screen. Renders at 128 px (2.6 m), 1 TAA sample, filter 0, 'Standard' view transform.
     - The sprites are then upscaled 3x/4x with nearest-neighbour (numpy inside Blender).
   - **Files:**
     - A `.blend` and an `.fbx` per hero. The FBX has deform bones, the Idle and Walk clips baked from the IK, and vertex colors, but no outline or toon shading.
     - `AllHeroes.blend` has all six in a row.
     - `sprites/<Hero>_idle.png` and `_walk.png`: 8 frames each, transparent, 3x.
     - `previews/<Hero>.png`, `<Hero>_ik.png` and `AllHeroes_lineup.png`.
   - **How it's built:** one script, `make_pixel_heroes.py` (Blender CLI, about 2 min; `-- frog` builds just one hero). Each shape is rigid on its bone (one vertex group per bone).
   - **The rig:**
     - Bones: root > hips > spine > chest > neck > head, thigh/shin/foot and upper_arm/forearm/hand, and tail bones for the platypus, fox and gecko.
     - IK: 2-bone IK on the shins and forearms, with `foot_ik`/`hand_ik` targets and `knee_pole`/`elbow_pole` poles (pole angles auto-picked so the rest pose doesn't move). `tail_ik` drives the tail.
     - The feet and hands copy their control's rotation.
     - The controls have wire shapes (hidden `WGT` collection) and sit in the bone collections "Deform" and "IK Controls".
     - The actions `Idle` and `Walk` (in place, 8 frames, 10 fps) key only the IK controls and the hips.
   - **Checked:**
     - The IK reaches its targets within 0.06 mm on every rig.
     - The lineup, the IK test pose and the walk sheets look right.
   - **Known / not done yet:**
     - On some walk frames, the swords of the hawk and paladin cross the face.
     - Small faces (the frog's mouth, the gecko's eyes) lose detail at 128 px.
     - No attack or jump animations yet.
     - The heroes are not in the Unity game yet.

00000000000000000. **Voice speed, UniMate without Blender, rooms on both sides, downward dropdowns, one Cooking & Baking panel (28 Oct 2026, newest)**
   - **Voice:**
     - `brain/pinakamain.py`: `WHOLE_REPLY = True` again (whole reply in one go). New `warm_voice()` makes one silent line in a background thread ("voice-warm") with the active voice + RVC + an emotion, so the first real reply is fast. Called from `app.py` `_apply_character`; it only runs again when the voice/clone changes.
     - `senses/rvc.py`: runs on the GPU (`_device()`, `RVC_DEVICE=cpu` forces CPU). `convert()` falls back to the CPU for good on a GPU error. 7 s of audio: ~10 s → ~1.5 s.
     - `senses/kokoro.py`: `_session()` builds the onnxruntime session (all optimisations, CUDA if the GPU build is installed, else CPU; `KOKORO_DEVICE=cpu`). The main app still has the CPU build of onnxruntime; the user swaps it themselves (command in README / kokoro.py docstring).
     - `senses/voice_emotion.py`: `detect()` reads a reply sentence by sentence and keeps the strongest feeling; a sad sentence beats a plain "happy" one; new `_SAD_WORDS` ("oh no", "I'm so sorry", "I wish I could"…).
   - **UniMate without Blender (`skills/animate.py`):** step 3 runs with `tools/unimate_bin/blender`, a bash stand-in written by `_blender_shim()` that runs the script with the unimate env's Python + bpy 4.0. Full real run on `ui/models/pikachu.glb` (idle + walk, ~9 min) made `ui/models/_unimate/pikachu/{idle,walk}.glb`. `ui/rigger.js` calls `onSaved(name, true)` when done and `ui/app.js` saves the character with the new `-animated.glb`, so the clips are used straight away (walk while moving, idle otherwise).
   - **Rooms:** `renderHousePane` (`ui/app.js`) has both **+ Room on the left/right** buttons at the top; room cards sit side by side (CSS `.house-pane`). The right-room button used to be hidden below the drawer.
   - **Dropdowns:** new `ui/dropdown.js` (`initDropdowns()`): every single `<select>` opens our own list *below* the box (the panel scrolls first if there's no room). Styles `.dd-list/.dd-item/.dd-group`.
   - **Cooking & Baking:** one menu item `data-panel="kitchen"` → `#panel-kitchen` with tabs `#kitchenTabs` holding `cookingBody` and `bakingBody` (`kitchenTab()` in `ui/app.js`, remembered as `ui.kitchen_tab`). `OPTIONAL_PANELS` and the `kitchen` plugin (`brain/plugins.py`, now "Cooking & Baking") use `"kitchen"`. `app.py` turns old hidden `baking`/`cooking` into `kitchen` on start. Recipe data and the `baking_*` API are unchanged.
   - **Tests:** 473 tests, all OK (3 skipped). New `tests/test_kitchen_unimate.py` (7 checks); `tests/test_rvc.py` real-model test now feeds the model on its own device.

0000000000000000. **Undo round: Qwen3-TTS removed, RVC import back, no floors/stairs, window as furniture, camera per room, UniMate installed (27 Oct 2026, newest)**
   - **Qwen3-TTS removed completely, back to Kokoro + RVC:**
     - Deleted `senses/qwenvoice.py`, `scripts/setup_qwen_tts.*`, `data/qwen_voices/`, the `qwen-tts` package and the 6.7 GB of Qwen models in the Hugging Face cache.
     - `app.py`: no `qwen_*` API, no `voice_engine`; applying a character warms its RVC model again. `brain/pinakamain.py`: no Qwen branch, replies are voiced **sentence by sentence** again (`WHOLE_REPLY = False`). `skills/autosetup.py` only sets up UniMate.
     - Settings → character: the old **Voice clone (RVC)** box is back (`#rvcBox` in `ui/index.html`): dropdown, **Import a voice (.pth + .index)…**, Remove, **Speak with** (`rvcBase`), pitch and index sliders.
     - `data/characters.json`: `qwen_voice` / `voice_engine` removed; the RVC settings (Bubbles, Rick Sanchez, Mickey Mouse) are kept.
   - **Floors and stairs removed:** `ui/house.js` is rooms only (`shell.house = {rooms:[{side,w,d}]}`; old `floors`/`stairs` keys are ignored). Gone: `FH`, `STAIR_STYLES`, `climbPath`, `room.goToFloor/viewFloor/level`, `cozy.setViewLevel`, `spec.level`, the floor buttons (`#floorBar`), the up/downstairs idle trips in `ui/life.js`. Edit room → **🏠 Rooms** only has the rooms box.
   - **The big window is a furniture item (`CATALOG.bigWindow` in `ui/cozyroom.js`):** select it in Edit room to move or delete it, and add it again from Wall decor. It uses the shared sky picture (`cozy.skyMat`, marked `userData.keepLook` so paint and delete leave it alone) and has its own glow (`ctx.glow`, set by `applyHour` via `_lightWindow`). Hidden in the gym room (`withShell`). Old layouts get it once at its old place (back wall, u 2, y 1.75) unless `shell.window` was false or a den window is on the back wall; new saves have `shell.windowItem: true`, so a deleted window stays deleted. The Window box and `setShowWindow` are gone.
   - **Camera follows her between rooms (`ui/room.js` `_roomAt`, `_followRoom`):** when she walks into a left or right room, the camera glides to a view of that room from its open front (like the main room's); back in the main room it returns to your main-room view. Only the main-room view is saved (`onViewChange`). Starting a workout while she's in a side room puts her back in the main room.
   - **UniMate libraries installed** into `~/miniconda3/envs/unimate` (setuptools<81, then `tools/unimate/requirements.txt` with `--no-build-isolation`; torch 2.5.1 CUDA 12.4). `animate.libraries_installed()` is now True.
   - **Tests:** 466 tests, all OK (3 skipped). `tests/test_house_music.py` has 4 new checks (no floors/stairs, window is furniture, camera follow, RVC box back).

000000000000000. **House round: rooms, floors & stairs instead of yards, Kokoro back as default, meal planner options, music & mirror fixes (27 Oct 2026)** (floors, stairs, the Window box and Qwen were removed again in the round above)
   - **Yards removed, house added (`ui/house.js` new, `ui/yard.js` deleted, pets moved to `ui/pets.js`):** Edit room → **🏠 Rooms & floors**:
     - **Floors:** 1-4. Every floor above has the same rooms as the ground floor. A removed floor's furniture moves down.
     - **Rooms:** add rooms to the left/right of the main room (up to 4). Width 3-8 m, depth 3-8.5 m. Each joins through a doorway.
     - **Stairs (main room only):** style (`STAIR_STYLES`), position, turn, width, step depth, colour, railing.
     - **Window:** ✕ Remove window / + Put the window back. Its glow goes with it; saved as `shell.window`; Undo works.
     - Saved in the room layout as `shell.house = {rooms:[{side,w,d}], floors, stairs:{...}}`.
     - Floor buttons above the room (`#floorBar`): she **climbs the stairs** to that floor (`room.goToFloor`). In edit mode they only change the floor you look at (`room.viewFloor`). Floors above the one you look at are hidden.
     - Her floor is `room.level`, furniture has `spec.level`, and `FH = 3.4` m per floor. By herself she sometimes goes up/downstairs (`ui/life.js`).
     - Old yard things in a saved layout are skipped (they're not in the catalog any more).
   - **Voices:**
     - Qwen3-TTS 1.7B and 0.6B both ran at under 0.1x real time on the RTX 3050, too slow for talking. So **Kokoro + RVC ("classic") is the default again** (`app.py` `voice_engine`); Qwen stays as an option marked "natural but slow".
     - Cloning a Qwen voice from an RVC model uses the RVC voice picked in *Speak with emotion*; the clone isn't the character's voice.
     - UniMate and Qwen3-TTS aren't installable features in Plugins any more. Cloned voices are always listed.
     - UniMate's libraries are installed by you with pip: the Animate box shows the two commands (`animate.pip_commands()`).
   - **Gym → Meal planner:** choose **2-6 meals a day**; each meal has an **Other dish** button that cycles through dishes (`gym.meal_plan(goal, profile, meals, dishes)`).
   - **Music UI out of sync - fixed (`skills/f1.py`):** ffplay is its own program, so a song kept playing after Vermeil closed. The next Vermeil then showed 0:00 and ▶.
     - The player's process id is now saved in `data/music_player.pid`.
     - On start, `f1.stop_leftover_player()` stops that leftover ffplay (only if the process really is ffplay).
     - On close, `atexit` stops the music.
   - **Study no longer changes the room lights:** opening the Study panel kept switching to the "study" lighting scene. Now only the tutor talk style does (`ui/life.js` `sceneFor`).
   - **Games pause your music:** opening Games pauses Vermeil Music and Spotify (`ui/app.js`, `#adventureBtn`).
   - **Bathroom mirrors are real mirrors on the wall (`ui/dnd_furniture.js`):** the glass part of the model (material "Mirror") is swapped for the reflective `Mirror` from `ui/mirror.js`. Both mirrors are wall pieces now; ones placed on the floor in older saves move onto the back wall (`cozyroom.addItem`). Paint skips the glass.
   - **Tests:** 462 tests, all OK (3 skipped). New `tests/test_house_music.py`: meals per day, other dish, UniMate pip commands, the leftover-player check.

00000000000000. **Clean-up + yard round: music cut-off fix, walk outside, wallpapers, meal planner, auto-setup (27 Oct 2026)**
   - **Music stopped ~15 s early - fixed (`skills/f1.py`):** the volume-levelling filter (`dynaudnorm`) holds back the last ~15 s of audio by default, and `ffplay -autoexit` quit before playing them. Now `NORM_FILTER = "dynaudnorm=f=200:g=5"` (tiny look-ahead), so songs play to the very end.
   - **Settings:** the RVC section is hidden, the "(not installed)" sidebar toggles are gone, **Room** is removed from the sidebar. "Speak with" moved into the Qwen box.
   - **Yard (`ui/yard.js`, `ui/room.js`, `ui/life.js`):** white picket fence round the plot with a front gate, stepping-stone path to a sidewalk and road, ~2600 grass tufts and flowers, default trees / bushes / flowers that you can delete in edit mode (seeded once, `yardSeeded`). She **walks out of the door** (`goOutside("back"|"front")`, `goInside()`), the **camera follows her outside**, and she **uses yard things** (`useYardItem`: walks up, faces it, plays with it). New buttons above the room: 🌳 Back yard / 🏡 Front yard / 🚪 Go inside (`#outsideBar`). By herself she goes out sometimes between 8:00 and 20:00 and comes back in at night.
   - **Wallpapers (`ui/cozyroom.js` `WALLPAPERS`):** 12 patterns (stripes, damask, floral, brick, stars…) at the top of Edit → **Wall decor**; they take the wall colour. Saved in the room layout (`shell.wallpaper`).
   - **Gym:** *Meal planner* (Bulk / Cut / Recomp: calories, protein, fat, carbs for the day and 4 meals with grams, `gym.meal_plan`, made from the Calories tab). *Progress* charts now show only **weight and reps** per lift (two charts side by side), with **My stats** (weight, arms, thighs, chest, waist) at the bottom.
   - **Qwen3-TTS:** the loading bar shows an ETA; a clone is saved straight into the **Speak with** dropdown; **no more silent replies**: if Qwen is still loading or takes longer than `QWEN_TIME_LIMIT` (20 s + a bit per letter) for a sentence, the normal voice says it instead (`brain/pinakamain.py` `_qwen_voice`).
   - **Auto-setup (`skills/autosetup.py`, new):** when the app opens it gets Qwen3-TTS (pip install of `requirements-ai.txt` + the ~4.5 GB model) and UniMate (Miniconda silent install to `~/miniconda3`, git clone, the `unimate` env from conda-forge, its libraries, the ~2 GB checkpoint) ready in the background, with toasts showing progress. Ready parts are skipped; a failed part waits 24 h before retrying. Log: `data/auto_setup.log`, state: `data/auto_setup.json`. **Not run on my PC yet** (UniMate will download Miniconda the next time the app starts).
   - **AI detector (`skills/academic.py`):** better scoring (sentence-length variety, AI words, "one remains", triplets, semicolons…), and *Make it sound human* uses a stronger rewrite prompt and checks again.
   - **Tests:** 456 tests, all OK. Updated 5 old tests (whole-reply speaking is the default now, fillers like "Hehe" are stripped, the new humanize prompt) and added `test_meal_plan_for_each_goal`.
   - Not done: a quick check whether the smaller Qwen3-TTS 0.6B model is faster on the RTX 3050 (4 GB) - the timing run gave no output, so 1.7B is still used.

0000000000000. **Big feature round: rigging + UniMate, Qwen3-TTS voices, gym calories, AI detector, lyric videos, devices, size clean-up (27 Oct 2026)**
   - **3D rigging (`ui/rigger.js`, new):** after importing a .glb/.gltf (or with the 🦴 *Rig & animate* button under the model picker) a full-screen rigger opens.
     - Model already has a rig → asks "see it, or is it okay as it is?". Seeing it shows the bones; then "delete it and rig it yourself?".
     - New rig: *Auto* (guesses biped / quadruped / creature from the shape), the three presets, or *Place bones myself* (click point to point, joints chain; click a dot to branch; Exit or Esc to stop). Joints can be dragged, renamed, deleted, mirrored L↔R.
     - Skin weights are made automatically; IK chains (arms, legs) are saved in the GLB (`userData.ik`), and *Test pose* lets you drag hands/feet.
     - Save → `ui/models/<name>-rigged.glb` (`app.save_rigged_model`). Then "Animate it?" → UniMate.
     - Fingers and ears are animated by hand in `room.js` (`_moveFingers`: relaxed curl, small twitch while talking, grip when holding a book).
   - **UniMate animations (`skills/animate.py`, `scripts/setup_unimate.bat`, new):** idle, walk, wave, talk, happy, dance, cheer, jump, sad, sit. Needs a one-time setup: **Miniconda + Git for Windows**, then run `scripts\setup_unimate.bat` (clones into `tools\unimate`, makes the `unimate` conda env, downloads the checkpoint). The app runs it through `conda run` + Git Bash and merges all clips into `<name>-animated.glb`. **Not tested on my PC yet.** The UniMate checkpoints are CC BY-NC (non-commercial).
   - **Qwen3-TTS 1.7B Base voice (`senses/qwenvoice.py`, `scripts/setup_qwen_tts.*`, new):** voice cloning from an RVC model (it says a line, the best 3 s are kept, with a loading bar), an audio file, or a 3-second recording. Always uses reference text (auto-transcribed by Whisper, hidden), never x-vector. Emotion control via mood versions of the clip. Many languages. A reply is voiced in one go. Setup: `python -m pip install -r requirements-ai.txt`, then `scripts\setup_qwen_tts.bat` (~4.5 GB model into `tools\qwen3tts`).
   - **Personality box:** *Write a personality like…* (`make_personality`) keeps the character's personality and adds how to write so Qwen3-TTS reads it naturally.
   - **No filler sounds:** "hm, ahh~, hmph, mmm~, uhm" are banned in the prompt (`brain/Vprompt.py`) and stripped from replies (`brain/pinakamain.py`, `_FILLER*`).
   - **Room:** yards (front/back) and pets that wander and can be petted (`ui/yard.js`), undo (40 steps), DnD furniture paint now applies a colour theme like the built-in furniture (`cozyroom.recolorItem`), talk guide under the chat box.
   - **Gym:** *Calories* tab: BMI, BMR, maintenance, deficit / small deficit / lean bulk / bulk with kg per week/month and weight in 3 months (Mifflin-St Jeor, saved in `data/gym_profile.json`). *Progress* tab: monthly line charts per lift (est. 1RM, heaviest set, volume, sets) + body weight.
   - **Study:** the drop zone glows and bounces when you drag files over it; each file flies in as a chip with a spinner → ✓/✗, and new files glow in the list.
   - **Research → AI Detector + Humanizer:** 0-100% "AI-like" score from text statistics (sentence-length variety, stock AI phrases, repeated openers, personal voice, contractions) blended 60/40 with your AI's opinion; flagged sentences are highlighted. *Make it sound human* = paraphraser (human voice) → grammar fixer → re-check, shows before/after %. (`academic.detect_ai`, `academic.humanize`.)
   - **Music:** songs stopping early fixed: the player sends YouTube's browser headers, saves a full copy of the song in the background (`data/music_cache`, last 40 songs) and, if the stream drops, resumes from that copy (max 6 retries). Song search now prefers **lyric videos**; a playlist's *🎤 Use lyric videos* button converts an existing playlist (`mm("to_lyrics", id)`).
   - **Plugins ↔ menu ticks:** Settings → Sidebar shows uninstalled features as "(not installed)"; ticking one offers to install it; installing a feature brings its menu button back (it glows once).
   - **Devices:** Settings → Voice & camera has Camera and Microphone pickers listing only devices that work (🔄 *Find devices* re-checks). Cameras open with DirectShow first, which stops the "MSMF can't grab frame" errors.
   - **Errors fixed:** pywebview `OPEN_DIALOG` deprecation (`_OPEN_DIALOG` uses `FileDialog.OPEN`), "No module named torch" on RVC import (now a clear message + torch is in `requirements-ai.txt`).
   - **Animations everywhere:** a shared motion layer in `style.css` (tabs, lists, cards, answers, folding sections, button press/hover) + sparks on success messages; all of it is turned off by Windows' "reduce motion".
   - **Install on another PC:** `requirements.txt` (everything) + `requirements-ai.txt` (torch CUDA 12.4, qwen-tts, RVC extras). A code-only copy with no `data/` and no `env` starts fine and passes the tests.

000000000000. **Major 8-Fix Update: Study Drag & Drop, Grammarly-style Corrector, Open Voice, Math Formulas, Music Queue & Cutoff Fix, 3D Gizmo & DnD Asset Interaction (24 Oct 2026, newest)**
   - **1. Drag-and-Drop Lecture Imports in Study:**
     - Added `study_import_file_data(filename, base64_data, kind, subject)` in `app.py` and `ui/mock.js` to decode base64 file payloads from webview/browser drag-and-drop and safely save/process them via `academic.add_file()`.
     - In `ui/study.js`, built a dedicated drag-and-drop zone in Library that reads dropped files asynchronously via `FileReader.readAsDataURL` and automatically imports them into the user's lecture library.
   - **2. Grammarly-style Grammar Corrector in Research:**
     - Added `academic.correct_grammar(text, tone)` in `skills/academic.py`, backend `study_grammar_check()` in `app.py`, and mock in `ui/mock.js`.
     - Added interactive "Grammar Corrector (like Grammarly)" card in Study -> Research with tone selector (Academic, Formal, Concise, Casual), quality score badge (0-100), issue category breakdown chips with before/after comparisons, and 1-click "Copy Corrected" and "Use in Box".
   - **3. Real-Life Open Voice Conversation & Live Guide:**
     - Upgraded language conversation practice in `ui/study.js` (`openTalk()`) with an "Open Voice Mode (Hands-free)" toggle.
     - Vermeil automatically speaks her responses aloud using native speech synthesis (`api.sensei_say()`), and the system automatically opens real-time microphone listening for your voice reply upon turn completion.
     - Added an interactive "Conversation Guide (Real-Life Prompts & Hints)" cheat sheet providing dynamic situational phrases (with English meanings and 🔊 pronunciation audio buttons) that can be clicked to practice or speak directly.
   - **4. Complete Math Formula KaTeX Rendering in Assignments:**
     - Updated tutor prompt in `skills/academic.py` (`assignment_help`) to strictly require LaTeX delimiters (`$..$` inline, `$$..$$` display) and valid braces.
     - In `ui/util.js`, rewritten `setMd()` to protect math blocks from HTML escaping/markdown processing, auto-detect bare LaTeX formulas without delimiters, and sanitize legacy shorthand (`\mathbfr'`, `\mathbf T`) into valid KaTeX syntax. KaTeX formulas render directly via `window.katex.renderToString()`.
   - **5. Music Player Next Buttons & Modern Queue UI:**
     - Fixed "⏭ Next song" button in `ui/mymusic.js` by standardizing commands to `f1.music_control` (`skip` / `next`).
     - Added `remove_from_queue(idx)` and `play_queued_index(idx)` in `skills/mymusic.py` and `app.py`.
     - Completely redesigned `drawQueue()` into a modern card-based music queue with a "Now Playing" cover banner with playback controls, queue management action bar (Skip, Shuffle, Clear Queue, Refresh), numbered track cards, and individual "Play Now" and "Remove" buttons.
   - **6. Fix Music Playback Stalling, Silence & Premature Cutoff:**
     - In `skills/f1.py` (`_play_worker`), fixed variable scoping bug: declared `global user_stopped` in both `_play_worker()` and `_stop_current_song()`, preventing skips from triggering recovery loops on the same song.
     - Removed `-reconnect_at_eof 1` from ffplay arguments to eliminate the trailing silence and stall when tracks end.
     - Switched default yt-dlp format to `bestaudio[ext=m4a]/bestaudio/best` for fast, bufferless playback without throttling.
   - **7. 3D Builder Gizmo Improvements (Image 1):**
     - Scaled down gizmo arrows and planar handles by ~50% in `ui/electronics/gizmo3d.js` (`shaftLen: 0.52`, scale `dist * 0.075`) for a sleek, Blender-like appearance.
     - Fixed arrow drag movement: `_applyWorldPosition` now directly updates `target.position` in its parent local space, properly translating the object as the arrow is dragged.
     - Added an interactive `🗑 Delete` button to the gizmo HUD overlay when parts are selected, connected to `removeSelected()`, and added `Delete` / `Backspace` key handling in `ui/builder/builder.js`.
   - **8. DnD Room Furniture Interaction & Color Customization (Image 2):**
     - In `ui/dnd_furniture.js`, when GLB models finish loading asynchronously, properly assigned `o.userData.itemId` across all internal meshes, cloned materials independently, and triggered room update callbacks.
     - In `ui/room.js`, updated pointer picking to recursively search parent hierarchies for `itemId` if clicking submeshes, enabling immediate selection, dragging, and moving of all DnD furniture across the room.
     - In `ui/cozyroom.js` (`recolorItem`), fixed GLB recoloring so that dark materials and low-saturation fabrics on Quaternius models are no longer rejected as neutrals, allowing full color customization across sofas, beds, and furniture.
   - **Files touched:**
     - `skills/academic.py`, `skills/f1.py`, `skills/mymusic.py`, `app.py`
     - `ui/electronics/gizmo3d.js`, `ui/builder/builder.js`
     - `ui/dnd_furniture.js`, `ui/cozyroom.js`, `ui/room.js`
     - `ui/study.js`, `ui/mymusic.js`, `ui/util.js`, `ui/mock.js`
     - `tests/test_study.py`, `HANDOVER.md`

00000000000. **Major 19-Feature Vermeil Assistant & UI Upgrade (24 Oct 2026, newest)**
   - **1. Retro Games Cover Faded Backdrop:** When loading into a retro game, the game's box cover art is now displayed as a faded, ambient blurred background layer behind the emulator canvas with smooth transitions (`ui/games/games.js`, `ui/games/player.html`, `ui/games/games.css`).
   - **2. Planner Notification Sounds:** Added an audible notification sound sequence (`notify`) generated via Web Audio API in `ui/psp.js` and `ui/fx.js`. Connected to periodic due task checks in `skills/f1.py` and `ui/planner.js` to alert the user when schedule items are due.
   - **3. File Drag-and-Drop Across the App:** Built universal drag-and-drop support (`ui/util.js`: `setupDropZone`) with visual `.drop-active` highlights. Enabled in:
     - Study Library (`ui/study.js`): drag & drop documents, PDFs, or lecture files to import them directly.
     - Code Workspace (`ui/code.js`): drop files to open or import.
     - Circuit Lab (`ui/electronics/lab.js`, `ui/electronics/view2d.js`): drag parts from the palette and drop them directly onto the breadboard.
   - **4. Paraphraser in Study -> Research:** Added academic paraphrasing capability (`skills/academic.py`: `paraphrase()`, `app.py`: `study_paraphrase()`, `ui/mock.js`). Added an interactive Paraphraser card in Study -> Research (`ui/study.js`) with styles (Standard, Fluent, Formal, Simple, Creative) and length controls (Same, Shorter, Longer) with one-click copy and replacement.
   - **5. Study & Language Speaker Labeling:** In study chat discussions (`ui/study.js`: `openTalk()`), dialogue clearly distinguishes speakers with formatted `<span class="msg-speaker">You:</span>` vs `<span class="msg-speaker">Vermeil:</span>` badges.
   - **6. Mathematical Formula Rendering (KaTeX):** Connected KaTeX (`ui/vendor/katex/katex.min.css`, `katex.min.js`, `ui/index.html`) into markdown parsing (`ui/util.js`: `setMd()` / `renderMath()`). Assignments and study materials now render proper mathematical typesetting for inline `$..$`, display `$$..$$`, and bare LaTeX expressions (e.g., `\mathbf T(t)=\frac{\mathbf r'}`) instead of unformatted raw code.
   - **7. Step-by-Step Video Recipes & Synchronized Cooking/Baking:**
     - Split clumped text and video transcripts into numbered steps (`skills/baking.py`: `_split_clumped_text()`, `_flatten_steps()`).
     - Added cross-synchronization between `baking.json` and `cooking.json` so additions, edits, and deletions in either recipe book keep both synchronized. Verified with unit tests in `tests/test_baking.py`.
   - **8. Generator Toggle in Settings:** Added `"generator"` to `OPTIONAL_PANELS` in `ui/app.js`, providing an on/off toggle for the Generator panel in Settings.
   - **9. Removed Spotify Toggle in Settings:** Removed `"spotify"` panel toggle from `OPTIONAL_PANELS` in `ui/app.js`.
   - **10. Fixed Code Folder Picker Freeze:** In `app.py` (`code_choose_folder`), wrapped pywebview's Windows folder dialog invocation in a detached background worker thread to prevent WebView2 message-loop deadlocks.
   - **11. Editable Playlist Details in Music:** Added playlist metadata editing in `ui/mymusic.js` (`editDetails()`) and `skills/mymusic.py` (`update_playlist()`), enabling users to change playlist title, description, and cover image (via file picker or URL).
   - **12. Fixed Early Music Cut-Off:** In `skills/f1.py` (`_play_worker`), added reconnect options to ffmpeg/mpv and an early-cutoff recovery loop that refreshes streaming URLs from yt-dlp and seamlessly resumes playback from the exact elapsed timestamp when streams drop unexpectedly.
   - **13. Queue Tab in Music:** Added a dedicated "Queue" tab in `ui/mymusic.js` (`TABS`, `drawQueue()`) displaying all queued songs with track lengths, skip buttons, and a "Clear Queue" button (`app.py`: `mm("clear_queue")`, `skills/mymusic.py`: `clear_queue()`).
   - **14. Removed Spotify Player Tab in Music:** Cleaned up the Music tabs in `ui/mymusic.js` by removing the dedicated Spotify player tab while retaining Spotify playlist importing in the Import tab.
   - **15. Removed "Save to Ideas" Prompt in Mind:** In `ui/mind.js`, removed the unnecessary post-growth confirmation prompt after clicking "Grow it", streamlining idea generation.
   - **16. Loading Animations on Long Operations:** Created a universal `.loading-card` component with spinning indicator in `ui/util.js` and `ui/style.css`. Integrated into Study research & assignments (`ui/study.js`), Mind thinking/growth (`ui/mind.js`), and Code AI queries (`ui/code.js`).
   - **17. Blender-Style 3D Axis Gizmo in Electronics:** Created `ui/electronics/gizmo3d.js` providing an interactive RGB axis gizmo (Red X, Green Y, Blue Z arrows, planar quad handles, infinite guide lines, corner orientation cube, and G/X/Y/Z hotkeys) and integrated it into the 3D Build Lab (`ui/builder/builder.js`).
   - **18. Interactive Circuit Lab & New Components:**
     - Enabled drag-and-drop of electronic parts from the palette to the breadboard (`ui/electronics/lab.js`, `view2d.js`).
     - Added new interactive components in `ui/electronics/parts.js` and `ui/electronics/view3d.js`: 7-Segment LED display (`seg7`), Slide Switch SPDT (`slide_switch`), and 5V Relay module (`relay`).
   - **19. Full Room Furniture Catalog from `dnd` Assets with Universal Recoloring:**
     - Created `ui/dnd_furniture.js` importing over 50 3D furniture models from the Quaternius asset library (`ui/game/assets/conv_furniture_pack/`, `conv_furniture_pack_2017/`, and `conv_ultimate_house_interior_pack/`) spanning beds, sofas, chairs, dining/coffee tables, bookshelves, kitchen appliances, bathroom fixtures, plants, and lamps.
     - Integrated into `ui/cozyroom.js` (`CATALOG`), refactored `recolorItem()` to universally recolor materials on both procedural and GLB meshes, and updated `CATEGORIES` in `ui/app.js` with dedicated "kitchen" and "bathroom" tabs.
   - **Files touched:**
     - `HANDOVER.md`, `app.py`, `skills/academic.py`, `skills/baking.py`, `skills/f1.py`, `skills/mymusic.py`
     - `tests/test_baking.py`, `data/baking.json`, `data/cooking.json`, `data/my_music.json`, `data/app_settings.json`
     - `ui/app.js`, `ui/cozyroom.js`, `ui/dnd_furniture.js` (new), `ui/code.js`, `ui/style.css`, `ui/util.js`, `ui/index.html`
     - `ui/mymusic.js`, `ui/mind.js`, `ui/study.js`, `ui/mock.js`, `ui/planner.js`, `ui/psp.js`, `ui/fx.js`
     - `ui/games/games.js`, `ui/games/player.html`, `ui/games/games.css`
     - `ui/builder/builder.js`, `ui/electronics/gizmo3d.js` (new), `ui/electronics/lab.js`, `ui/electronics/parts.js`, `ui/electronics/view2d.js`, `ui/electronics/view3d.js`
   - **Tests:** 446 passed, 3 skipped, 0 failures, 0 errors across 449 unit tests (`python -m unittest discover -s tests`).

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

### 24 Oct 2026: App Inspection & Windows cp1252 Output Fix
- **Windows console Unicode fix:** Windows default console encoding (`cp1252`) crashed when printing status emojis (`✅`, `⚠️`, `🗑`, `❌`) in `brain/pinakamain.py` and `brain/plugins.py`. Added safe stdout/stderr reconfigure in [folders.py](file:///c:/Users/jpant/OneDrive/Desktop/coding/2025/2025/folders.py) (`errors="replace"`), resolving the `UnicodeEncodeError` in the test suite without altering console environments.
- **Test verification:** Ran `tests.test_vermeil` (60 passed), `tests.test_batch11` (27 passed), `tests.test_game` (44 passed), and `tests.test_spotify` (13 passed).
- Created [`env.example`](file:///c:/Users/jpant/OneDrive/Desktop/coding/2025/2025/env.example) documenting configuration keys with safe placeholder values.

## 5. Status / things to check next

- **29 Oct 2026 Drive folder round:** the folder link is built in; reading your real shared folder works; `dist\Vermeil-Drive` was copied into `G:\My Drive\Vermeil` with Google Drive for desktop (robocopy, 32 files, 3.2 GB) on 29 Oct 2026 and `plugins.folder_files(refresh=True)` sees the uploaded zips (re-run `package_app.py --drive` and copy again to update them); the Settings box was checked in `?mock`; the new Drive tests pass. **Real round trip checked (29 Oct 2026):** Camera uninstalled (3 models deleted), then Install downloaded `camera.zip` (43 MB) from the Drive folder, unpacked it, the 3 models came back byte-identical and OpenCV loads them (pip was stubbed in that test so `opencv-python` stayed installed). **Not checked yet:** the same for the other zips (Drive's list page layout is parsed from its HTML, so if Google changes it, `parse_folder_page` needs updating); `--with-wheels` on a real run.
- **29 Oct 2026 side-view round:** the autotest (`Build\Vermeil.exe -autotest`) plays the side-view fights with 0 exceptions (bubble, Perfect counter, a flier and the flying Thornwyrm in phase 2 are in the screenshots in `Build\shots`). Chatterbox first sound measured at 2.47 s on the GPU. **Not checked yet:** playing the side view yourself with the keyboard; ledge hopping on every biome; uploading the `--drive` folders to Google Drive and installing from them on another PC.
- **Forest + cards round:** the self-test (`Build\Vermeil.exe -autotest`) played the first forest stage (5 rounds, mini-boss), then the Thornwyrm through all 3 phases to the win, with 11 level-up card picks and no errors in `Tools\play.log`. The autotest plays only stage 1 and the boss, with weaker enemies, and its hero can't die. **Not checked yet:** playing it yourself with keyboard/mouse/pad; stages 2-5; heroes other than the Frog (their skills and counters only compiled, the autotest always picks the Frog); balance. The red warnings are faint on the Heartwood's brown ground.
- **28 Oct 2026 Unity round:** the self-test (`Build\Vermeil.exe -autotest`) runs the whole flow with no errors: campfire (everyone sitting, Vermeil on her own log), black hole, eject into the village, first Greenwood area, a 3-enemy battle and the victory popups. Sizes and textures checked in the screenshots; all 481 Python tests pass. **Not done / not checked yet:** playing it yourself with keyboard (only the autotest drove it); the torn tent pieces still look spiky; the voice clone in the game needs the app's voice server running (`game_tools/unity_voice_server.py`, not tested end-to-end from inside the exe); later biomes, the boss, the ending and the Eclipse unlock were not reached by the autotest.
- **28 Oct 2026 round:** UniMate ran for real on pikachu without Blender; Kokoro, RVC and every emotion made good audio; rooms, dropdowns and the Cooking & Baking tabs were checked in `?mock`; all 473 tests pass. **Not tested yet:** UniMate on a model you rigged yourself with Auto rig, Kokoro on the GPU (needs the onnxruntime-gpu swap).
- **27 Oct 2026 undo round:** rooms on both sides, the camera following her into each room and back, the window item (delete, reload, re-add, glow) and the RVC box were checked in the test page (`?mock`); all 466 tests pass. **Not tested on my real PC yet:** importing an RVC model again in the real app, a UniMate animation now that its libraries are installed.
- **27 Oct 2026 house round:** rooms, the window toggle and the wall mirrors were checked in the test page (`?mock`); all 462 tests pass. **Not tested on my real PC yet:** the leftover-song stop after a restart, Games pausing Spotify, UniMate after the two pip commands.
- **27 Oct 2026 clean-up round:** yard walking, wallpapers, meal planner and progress charts checked in the test page (`?mock`); all 456 tests pass. **Not tested on my real PC yet:** the auto-setup (Qwen + UniMate downloads, see `data/auto_setup.log`), the Qwen fallback to the normal voice, songs playing to the end.
- **27 Oct 2026 round (rigging, Qwen3-TTS, gym calories, AI detector, lyric videos, devices):** checked in the test page (`?mock`) and by the tests; a code-only copy on a "fresh PC" passed everything. **Not tested on my real PC yet:** Qwen3-TTS cloning (run `python -m pip install -r requirements-ai.txt`, then `scripts\setup_qwen_tts.bat`), UniMate (needs Miniconda + Git, then `scripts\setup_unimate.bat`), the camera/mic pickers with real devices, and songs resuming after a dropped stream.
- **New PC install:** `python -m pip install -r requirements.txt`, then (for cloned voices / RVC and the Chatterbox emotional voice) `python -m pip install -r requirements-ai.txt`. Every package in a plugin's `pip` list (brain/plugins.py) is in one of these two files (checked 29 Oct 2026; `chatterbox-tts==0.1.7` was the one missing, now in requirements-ai.txt because it pins torch 2.6.0). Copy `env` and `data/` across yourself. The Music plugin pack brings ffmpeg/ffplay.
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

## 7. Current app size (28 Oct 2026)

**Cards round:** `blender/cards/` (20 MB) is new, so the project folder is still **about 11.9 GB**. The Unity project gained 13 MB of card pictures.

**Unity game (outside this folder):** `C:\Users\jpant\My project` is the Unity project; its finished build (`Build\`) is about 312 MB. The hero models (`blender/heroes/`, 13 MB) are small, so the totals below don't change. The app folder only gained the small voice server (`game_tools/unity_voice_server.py`) and one test file, so the numbers below are unchanged.

Total project folder: **about 11.9 GB** (measured per top-level folder), the same as after the undo round: this round's code is tiny and UniMate's test outputs (`ui/models/_unimate/`) are only 5 MB.

| Folder | Size | What it is |
|---|---|---|
| `dnd/` | 7.1 GB | the asset library (never modify) |
| `tools/` | 2.3 GB | UniMate 1.2 GB, RVC helpers 0.5 GB, Kokoro 0.4 GB, downloads 0.15 GB |
| `data/` | 1.07 GB | your saved data, songs, voices (Qwen voices removed) |
| `ui/` | 0.98 GB | the app pages, 3D models, game assets |
| `Packages/` | 0.57 GB | ffmpeg and other bundled programs |
| `blender/` | 0.16 GB | Blender files (incl. `heroes/` 13 MB, `cards/` 20 MB) |
| code (`brain`, `senses`, `skills`, `game`, `tests`, `app.py`) | ~7 MB | the actual program |

Outside the project folder: Miniconda + the `unimate` environment, now with its libraries installed (PyTorch 2.5.1 CUDA 12.4 and the rest): **6.4 GB**, and **7.5 GB** for all of Miniconda together. The Qwen3-TTS models (6.7 GB) were deleted from the Hugging Face cache; what is left there (other AI models) is 10.7 GB.
