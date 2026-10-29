# Vermeil

## New (30 Oct 2026): use her on your phone anywhere, Mac/Linux, low-end PCs, share characters, talk-live practice
- **Phone app (Android and iPhone), also on mobile data:** in the app open **Settings → 📱 Phone**, turn it on, keep
  "Anywhere (Cloudflare)" and scan the QR code with your phone's camera. It opens Vermeil in the phone's browser; tap
  **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android). The PC must stay on with Vermeil open.
  The phone app has big tabs at the bottom: **Chat, Talk, Practice, Characters, Settings**.
  - **Hands-free + wake word:** Talk tab → **Hands-free**, then say "Vermeil, what's the weather?" (or her name / your own wake word).
  - **"Hey Siri" instead of replacing Siri:** Apple doesn't let any app replace Siri. Phone → Settings → *Siri Shortcut*
    shows the 5 steps to make "Hey Siri, Vermeil" ask her. On Android you can pick the browser app as the assistant.
  - **Honest limit:** a phone web app can't listen while the phone is locked or the app is closed (that needs a native app).
  - The link holds a secret key; "New key" in Settings disconnects every phone. Prefer a fixed address? Install
    Tailscale on the PC and phone and pick "Tailscale".
- **Mac and Linux:** Mac: double-click **INSTALL Mac.command**. Linux: in a terminal in the folder run `bash "INSTALL Linux.sh"`.
  It makes its own Python folder, installs the core, her voice and a "Start Vermeil" launcher. (Not tested on a real Mac yet.)
- **Low-end PCs:** Settings → AI → **This computer**: Auto (scans RAM, graphics card and battery and switches by itself),
  Low power or Full power. Low power turns off the heavy voices and uses lighter graphics. Say "low power mode" / "full power".
- **Share characters:** Characters → ✏ → **Share** saves a `.vermeil` file (tick "include voice" to add it);
  your friend clicks **📥 Import a character**.
- **Talk live in another language:** Study → Language → **🎙 Talk live** (or say "let's practice Japanese"):
  she talks with you in that language, corrects you, and gives a score when you say "stop".

## First-time setup (runs fully on your PC)
1. Install **Ollama** (free, runs the AI on your PC): https://ollama.com/download
2. In the VS Code terminal, inside this folder:
   - `python -m pip install -r requirements.txt`
   - Optional, for RVC voices: `python -m pip install -r requirements-ai.txt` (about 3 GB;
     no NVIDIA card? delete the `--extra-index-url` line in that file first)
   - `python scripts/setup_local.py` — picks AI models that fit your PC and downloads everything once (a few GB)
3. Start: `python app.py`

On a **Mac or Linux** laptop use `INSTALL Mac.command` / `INSTALL Linux.sh` instead (see below).

The main AI is **Groq** (online, fast — put `GROQ_API_KEY=...` in your `.env` file). When Groq's free tokens run out,
she switches **by herself** to Ollama on your PC, and back again later. Voice, listening, faces and the room are always local.
Internet is used for: Groq, music, paper search, weather, web search, news, prices, email, calendar sync, and new voices.
Check what's installed: `python scripts/setup_local.py --check`. Use smaller/bigger models: `python scripts/setup_local.py --size small` (tiny / small / medium / large).

See **FEATURES.md** for every feature (all 143 done, with honest notes on limits).

### Quick things to try
- "dance", "take a bow", "look surprised" — she acts it out
- "have Vermeil and Pip talk about pizza" — two characters chat, each in their own voice
- Settings → **People she knows**: teach her a family member's face, she greets them by name
- Settings → **Camera privacy mode**: camera fully off, red 🔒 pill at the top
- Settings → **Outfit**: automatic (Santa hat in December, party hat on your birthday, headband in gym mode) or pick one
- Study → Add files: you can now add **photos of your notes** — she reads the text
- **Missions** (sidebar): "find 3 laptops under ₱50k and compare them" — she plans it and works in the background
- Chat → **Our story / For you / Screenshots**; hover a message to edit or delete it
- Settings → **My wake word**: record "vermi" 4 times so she wakes up to YOUR voice
- "Fill in the form on this site…" — she uses her own browser window (never types passwords/cards)
- Study → Research → **Compare web sources** — shows where websites agree and conflict
- Say or type **"vermi"** → switches to Vermeil instantly ("hey Pip" → Pip, "vermi, what's the weather?" works too)
- "Make me a Python calculator" → the coding helper builds a new project, tests it, and tells you how to run it
- "Play Sunrise by Rex Orange County" plays it **right away**; say "add … to the queue" if you want it after the current song

# Vermeil - your AI companion

## Start it
```
python app.py          # the window with the 3D room (recommended)
python terminal.py     # the terminal-only version (voice + typing, no window)
```
First time on a new PC: `python -m pip install -r requirements.txt` (and `python -m pip install -r requirements-ai.txt` for cloned voices)

## What's in this folder
| File / folder | What it is |
|---|---|
| `app.py` | **Start here.** Opens the window and connects everything |
| `terminal.py` | Vermeil without the window |
| `folders.py` | Tells Python where the code folders are (app.py loads it first) |
| `brain/` | Thinking: `pinakamain.py` (chat, memory, voice loop), `llm.py` (Groq ⇄ Ollama), `tools.py` (everything the AI can do), `mind.py` (journal, think tools, recall), `missions.py`, `relationship.py` (our story), `coder.py` (coding helper), `paths.py`, `Vprompt.py` |
| `senses/` | Hearing, speaking, seeing: `stt.py` (Whisper), `tts.py` (Piper voices), `wakeword.py`, `denoise.py`, `voicemood.py`, `presence.py` (faces), `objects.py` (things the camera sees) |
| `skills/` | Things she does: `f1.py` (planner + music player), `music.py`, `spotify.py`, `gym.py`, `focus.py`, `sensei.py` (languages), `academic.py` + `scholar.py` (study, research), `productivity.py` (email, meetings, documents, calendar sync), `web.py`, `pc.py` (control your PC), `browser.py` (fills forms), `gcal.py` (Google Calendar) |
| `scripts/` | Run them yourself: `setup_local.py` (downloads the local AI), `setup_unimate.bat` (3D animations), `cleanup_packages.py` |
| `ui/` | The window: sidebar, panels, 3D room, characters |
| `data/` | Everything Vermeil saves: memory, characters, room, planner, gym, settings, voices, AI/face/object models |
| `tests/` | Automatic checks: `python -m unittest discover -s tests -v` |
| `env` | Your API keys - keep it private |
| `requirements.txt` | Python packages to install |
| `requirements-ai.txt` | The heavy AI voice packages (PyTorch, RVC extras, Chatterbox emotional voice) |
| `Packages/` | ffmpeg / ffplay, used to play music |
| `_archive/` | Old things kept just in case (not used by the app) |

## Spotify
Sidebar → **Spotify**. One-time setup (needs Spotify **Premium** — Spotify's rule for apps that control playback):
1. Go to https://developer.spotify.com/dashboard → **Create app** (any name).
2. **Redirect URI**: exactly `http://127.0.0.1:8888/callback` (Spotify no longer accepts "localhost").
3. Tick **Web API** → Save → open the app's **Settings** → copy the **Client ID** and **Client secret**.
4. Put them in the `env` file next to app.py (same file as your Groq key):
   ```
   SPOTIFY_CLIENT_ID=paste_your_client_id_here
   SPOTIFY_CLIENT_SECRET=paste_your_client_secret_here
   ```
   …or paste them into the Spotify panel and click **Save keys to my env file**.
5. Click **Connect Spotify** and allow it in the page that opens. Your login is kept in `data/spotify_token.json`.

Then: “play Sunrise”, “play my Gym playlist”, “play my liked songs”, “skip”, “pause”, “save this song”, “what's playing?”.
The panel shows the album cover, progress, controls, volume, search, your playlists, liked songs, recent and top tracks.
Spotify must be open somewhere (PC app, phone…); if it isn't, she opens the Spotify app on your PC.
To use the old YouTube player instead: Spotify panel → “When I say play…, use” → YouTube.

## Talking naturally
You don't need exact command words: "can you put on a song", "blast some tunes", "jot this down: …", "crank it up",
"don't let me forget to …", "what's on my plate tomorrow" all work (brain/intent.py turns casual wording into the plain meaning).

## Faster voice: everything on the graphics card (29 Oct 2026)
Her voice used to make Piper and RVC's ContentVec on the CPU, because onnxruntime couldn't find the CUDA files.
`senses/gpu.py` now loads them, so Piper, Kokoro and ContentVec run on the NVIDIA card, and the RVC voice network runs
in half precision. Nothing new to install or download. Measured on this PC (RTX 3050, Bubbles RVC clone):

| | before | now |
|---|---|---|
| a 12-second sentence (Piper + RVC) | ~3.2 s | ~1.1 s |
| first words of a 24-second reply | ~1.9 s | ~0.9-1.1 s |
| pauses waiting for the next sentence | none | none |

Put `VOICE_DEVICE=cpu` in `.env` to keep the voices on the CPU (`RVC_DEVICE=cpu` does the same for RVC's torch parts).

**Friends' PCs (any graphics card).** The app picks the fastest thing that's installed, by itself:

| onnxruntime installed | card | used for Piper / Kokoro / ContentVec |
|---|---|---|
| `onnxruntime-gpu` | NVIDIA | CUDA (fastest) |
| `onnxruntime-directml` | any Windows card: AMD, Intel, NVIDIA | DirectML (about as fast: Piper 0.54 -> 0.25 s, ContentVec 0.93 -> 0.18 s) |
| `onnxruntime` (the normal one) | - | the CPU |

Only one of the three can be installed. To switch, close Vermeil and run these two commands yourself.
AMD, Intel or any other card:

    python -m pip uninstall -y onnxruntime onnxruntime-gpu
    python -m pip install onnxruntime-directml

NVIDIA card (bigger download, ~1.5 GB):

    python -m pip uninstall -y onnxruntime onnxruntime-directml
    python -m pip install "onnxruntime-gpu[cuda,cudnn]"

To go back to the normal one: uninstall the one you added, then `python -m pip install onnxruntime`.
(RVC's voice network itself uses torch, which only uses NVIDIA cards; on other cards that part stays on the CPU.)

## Vermeil's online voice: Kokoro (inside the app - no Docker, no server)
While the AI is **online** (Groq answers), Vermeil speaks with a **Kokoro** voice; when it's **offline** (local Ollama)
she uses her normal Piper voice exactly as before. Kokoro now runs *inside* the app itself: the model sits in
`tools\kokoro\` in this project and is loaded in the background when the app starts (about 3-5 seconds). Nothing waits
for it - until it's loaded Vermeil just uses Piper. No Docker, no separate server, nothing else to start.

**One-time setup:** double-click `scripts\setup_kokoro.bat`. It runs `python -m pip install kokoro-onnx` and downloads
the two model files (`kokoro-v1.0.onnx`, `voices-v1.0.bin`) into `tools\kokoro` if they aren't there yet.
1. Start Vermeil normally. Characters panel → **Online voice (Kokoro)** lists all 54 Kokoro voices (af_heart is the
   default for Vermeil); the ▶ button previews one.
2. Optional test: `python senses\kokoro.py` loads Kokoro and says one line out loud.
Options for `.env`: `KOKORO_MODEL_DIR=` (another folder with the model files), `KOKORO_AUTOSTART=0` (don't load it at
startup), `KOKORO_DEVICE=cpu` (stay on the CPU). Kokoro uses an NVIDIA graphics card by itself once the GPU build of
onnxruntime is installed: `python -m pip uninstall -y onnxruntime`, then `python -m pip install "onnxruntime-gpu[cuda,cudnn]"`. Advanced: `KOKORO_URL=http://127.0.0.1:8880` uses a Kokoro-FastAPI server you run yourself instead.
The adventure game uses the same rule: Kokoro voices (a different one for every character) when online, Piper offline.

## Offline AI: Ollama inside the app folder (no Ollama app to open)
Double-click `scripts\setup_ollama.bat` once. It copies your installed Ollama into `tools\ollama` (or downloads it) and
asks whether to move your models into `tools\ollama\models` too (they're several GB, and this folder is in OneDrive, so
pause OneDrive or keep them where they are - both work). After that Vermeil starts Ollama hidden when she needs it and
closes it when you close her. You can then uninstall the Ollama app and turn it off in Task Manager → Startup apps.
Advanced `.env` settings: `OLLAMA_EXE` (another ollama.exe), `OLLAMA_MODELS` (another models folder).

## Moving Vermeil to another PC (installer) and Plugins
- `python scripts/package_app.py` makes `dist\Vermeil-Installer-<date>.zip`. Options: `--with-my-data` (chats, memory,
  characters, room, gym…), `--offline` (Kokoro + all voices), `--with-ollama`, `--with-blender`, `--with-library`, `--list`
  (just show what would be packed). Your `env` keys and login tokens are **never** packed.
- On the other PC: unzip, open the Vermeil folder, double-click `INSTALL.bat`. It installs Python packages, makes a
  desktop shortcut and opens Settings → **Plugins**, where you tick the features you want. Uninstall there to free space.

## Robotics & Electronics
Sidebar → **Electronics**: an assistant that fixes and repurposes old electronics and plans robots from start to finish,
16 formula calculators, and the **Circuit Lab** (Tinkercad-style 2D/3D simulator that runs Arduino code; 9 examples).

## Characters in other languages
Characters panel → **She speaks** (Japanese, Korean, Filipino, Spanish…) → she always replies in that language; tick
"Add an English translation" to get [the translation] on screen (it isn't read aloud). Pick a voice in that language —
Japanese, Korean, Filipino, Chinese, Thai, Hindi, Indonesian, Malay and Vietnamese voices are online (need `pip install edge-tts`).
In Study → Language, every line in the language you're learning has a 🔊 button to hear it.

## Riolu's animations
`blender/riolu_rig.blend` has the skeleton and the animations (idle, walk, wave, talk). Edit them in Blender, then
File → Export → glTF (.glb) → `ui/models/riolu_3d_model_fbx.glb` with "Animation → Actions" ticked.
The original model is kept in `_archive/riolu_3d_model_fbx_ORIGINAL.glb`.

## Animal heroes (Blender)
`blender/heroes/` has the six animal heroes from the concept art: Frog Brawler, Platypus Mage, Armadillo Paladin,
Fox Ranger, Gecko Rogue and Hawk Swordsman. They are chunky chibi animals that walk on two legs, not humans:
- **Body:** big heads and eyes, short thick legs, big paws and animal feet, tails, ears and crests.
- **Gear:** each hero has its own costume and weapon from the concept art.
- **Look:** Megabonk-like low-poly 3D with flat facets, a warm sun with hard shadows, and big chunky pixels.
- **Stance:** they all stand in a **fighting stance** (knees bent, guard up).

**What's in the folder:**
- `AllHeroes.blend`: all six in a row.
- One `.blend` and one `.fbx` per hero.
- `previews/`: pictures of each hero and of every animation (`<Hero>_attack.png`, `_dodge.png`, `_face.png` ...).

**Animations** (8 frames each, in the Action editor): **Idle** (the stance, breathing, one blink), **Walk**, **Attack**
and **Dodge** (a quick hop backwards).
- The attacks: frog punch, platypus water spell, paladin sword chop, fox bow shot, gecko double dagger stab, hawk
  sword slash.
- **Face animation:** on Attack the eyes narrow, the brows go angry and the mouth shouts. On Dodge the eyes go wide
  and the mouth gasps.

**To pose them:** select the rig, go to Pose Mode and move the controls:
- **Rings** at the feet and hands (`foot_ik`, `hand_ik`): the knees and elbows bend on their own. Turning a hand
  ring turns the hand, which aims a sword, bow or shield.
- **Diamonds** (`knee_pole`, `elbow_pole`): point the knees and elbows.
- **`tail_ik`**: swings the tail.
- **Face bones:**
  - scale `eye.L/R` up or down to squint or widen;
  - turn `brow.L/R` to look angry or surprised;
  - turn `jaw` to open the mouth.

**For Unity:** the `.fbx` files have the skin, the face bones, the four clips and the real colors (vertex colors).

**To rebuild or change them:** edit `make_heroes.py` and run this (about 3 minutes):
`"C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe" -b --python blender\heroes\make_heroes.py`
- Add `-- frog` (or another hero) at the end to build only that hero.
- Add `-- lineup` to remake only the group picture.

These replace the older hero versions, which were deleted.

## Searching the web
She tries several search engines (DuckDuckGo, Bing, Mojeek) plus Wikipedia, and searches again with better wording when results are weak.
Say “search more” to make her dig deeper. Optional, most reliable: a Brave Search API key in `env` → `BRAVE_SEARCH_API_KEY=...`

## New: Journal & Think
- **Journal** (sidebar → Journal & Think): Decisions (she reminds you to look back), Ideas (“Grow it”), Goals with steps, Stories.
- **Think**: Council of experts, What if…, Simulate my plan, Look ahead, Mix ideas, Break down a success, Find my patterns, Design a routine.
- **Search everything**: finds things from old chats, the journal and notes. She also does this by herself when you say “remember when…”.
- **Settings → How she talks**: companion, tutor, strategist, professional assistant, rehearsal coach.
- **Quiet mode** and **Notice what I'm doing** are in Settings → Behaviour.

## Removing Python packages Vermeil doesn't use
1. `python -m pip install -r requirements.txt`
2. `python scripts/cleanup_packages.py` — it lists what it would remove and only continues if you type `YES`.
3. If another project needs a package: `python scripts/cleanup_packages.py --keep pandas matplotlib`
4. To undo: `python -m pip install -r data/removed_packages.txt`

## Gym mode
Sidebar → **Gym**. Pick the day (it suggests the next one in your routine), tick ✓ after each set and the rest timer starts.
Timed exercises (holds, planks, mobility) have a ▶ Start button. History and Body stats are in the tabs.
To load a new version of your routine: **Re-import Excel**, or run `python skills/gym.py "path\to\HYBRID.xlsx"`.
To start History fresh: History tab → **🗑 Clear history** (you can Undo right after; your routine and weights stay).
**Calories** tab: BMI, maintenance calories and how much to eat to lose or gain weight (with kg per week/month).
**Progress** tab: monthly graphs for each lift and your body weight.
You can also say: “what's my workout today?”, “log incline bench set 2, 22.5 kg, 10 reps”, “start a 2 minute timer”.

## New (29 Oct 2026, latest): voice commands, Help tab, room camera, fixes for a fresh copy
- **Voice commands for every sidebar feature:** say "open the gym", "show me my journal", "go to settings", "open games"…
  and it opens right away. Say **"what can I say?"** (or open **Settings → Help**) to see every command, with a search box.
  Features that aren't installed are marked, and asking for one opens Settings → Plugins.
- **Room camera:** in **Edit room**, adding a room or dragging its Width/Depth zooms the camera so the whole house fits.
- **RVC voices on a new PC:** the voice-clone helper files and the character voices now download with the voice-clone
  setup (from the Drive pack, or Hugging Face), instead of "RVC isn't set up yet".
- **UniMate on a PC without Git:** UniMate's scripts need Git's `bash`. If Git for Windows isn't installed, Vermeil now
  downloads the official **portable Git** (about 60 MB, no installer, checked against its official checksum) into
  `%LOCALAPPDATA%\Vermeil\PortableGit` and uses that. The button always says **Make the animations**; if UniMate isn't
  ready yet, pressing it starts the setup right away (or shows the two pip commands you run yourself). If it fails,
  the message says what went wrong and where the log is.

## New (29 Oct 2026, newest): every feature installs from your one Google Drive folder
**Plugins = only the features in the sidebar (29 Oct 2026).** Voices (Kokoro, online voices, other languages),
Chatterbox, RVC voice clones, voice commands, UniMate, the camera, offline AI (Ollama) and online AI are **built in**:
they're not in Plugins, can't be uninstalled, and set themselves up on start (Settings shows a loading bar at the bottom).
That only happens the first time (or when something is really missing): once they're there, Vermeil opens without the setup bar.
They download from the Vermeil Drive folder, the same way features do. Offline AI (Ollama) is only set up when the PC has 20 GB free.
**Planner** (`planner.zip`, just its page; reminders still work in the chat) and **Generator** (`generator.zip`: its code
plus python-pptx and moviepy) are plugins too now, so every sidebar feature can be installed and uninstalled.
Installing or uninstalling a feature shows a **loading bar** (percent + what it's doing) instead of pip text.
All loading bars use your UI theme's colour. The "Load links.txt" button is gone (the app finds the zips by itself).

*Already uploaded: all feature zips and `pytorch.zip` are in the Vermeil Drive folder. If Gym says it's missing, press **Install** on it in Settings → Plugins and it downloads `gym.zip` from Drive.*

**Now every feature is a Drive download, even the small ones.** Spotify, Cooking & Baking, Robotics & Electronics lab,
Missions, Focus & Progress, Journal & Think and the Coding helper each have their own zip (`spotify.zip`, `kitchen.zip`,
`electronics.zip`, `missions.zip`, `focus.zip`, `mind.zip`, `code.zip`) with just that feature's code files. They're not
in `Vermeil-App.zip` any more: a friend presses **Install** and the feature downloads from Drive. **Uninstall** deletes the
files (it says e.g. "freed about 56 KB"), and Install downloads them again.
- Your saved things (journal, recipes, missions, projects in `data/`) are never deleted.
- The app still starts with a feature missing: that panel is just empty until you install it.
- On your own PC (the project folder with `_archive/`), Uninstall first copies the code to `_archive/plugin_code/<feature>/`.
  If that copy is different from the one on Drive, Install keeps your copy, so your newest code is never lost.
- After changing a feature's code, remake just that zip (and the app zip):
  `python scripts/package_app.py --drive --only app,kitchen`, then copy `dist\Vermeil-Drive` to `G:\My Drive\Vermeil` again.

1. Make the folders: `python scripts/package_app.py --drive --with-wheels`. `--with-wheels` puts each feature's
   Python packages (and what they pull in) inside its zip, pinned to the versions on your PC, so **every feature with
   packages has its own zip** and Install needs no internet for them. PyTorch (shared by Voice clones and the Emotional
   voice) goes once into `00 pytorch (shared)/pytorch.zip`.
   - **Uninstall removes a feature completely:** its files, its zip copy on this PC, its Python packages and the
     packages they pulled in (never the ones the core app or another installed feature still needs), and says how much
     space that freed. **Install** downloads its zip from the Drive folder again and installs the packages from it
     offline (a friend's PC with a different Python gets them from the internet instead).
   - Spotify, Cooking, Electronics, Missions, Focus, Journal and Coding: their code is in their own small zip (see above).
2. Upload everything in `dist\Vermeil-Drive\` into your Drive folder and share it as **"Anyone with the link"**.
   Easiest way for big files: install **Google Drive for desktop**, then copy it with
   `robocopy "dist\Vermeil-Drive" "G:\My Drive\Vermeil" /E` (Drive uploads it in the background).
3. That's it: **your folder's link is built into the app** (`DRIVE_FOLDER` in `brain/plugins.py`), so on any PC,
   **Settings -> Plugins -> Install** downloads that feature's zip from your Drive folder by itself (models, files,
   the Ollama program, packages) and unpacks it. **Uninstall** removes it again; Install brings it back from Drive.
   The link is **never shown in the app** (no link box, no link in messages), so friends can install without seeing it.
   To use a different folder, change `DRIVE_FOLDER` in `brain/plugins.py`.
4. Games: in the Games hub (the up/down arrows button) leave the link box **empty** and press Download -> every
   game in `3 - Games` is added.

Features that are only screens of the app (Spotify, Cooking & Baking, Missions, Focus, Journal, Coding helper,
Electronics) have nothing to download: Install just turns them on. Offline AI's models (5-11 GB) still come from
Ollama's own site.

## New (29 Oct 2026, earlier): side-view fights, new monsters, Drive folders, faster first sound
**The forest fights are now a side view** (like a 2D action platformer, but in low-poly 3D): you run left/right on a
floor with ledges above it, jump, and enemies come at you from the sides and from the air.

**Controls in the forest (new)**
| Key | What it does |
|---|---|
| A / D | move left / right |
| W (hold) | aim your attack up |
| S (hold, in the air) | aim your attack down (hitting something bounces you up) |
| S + Space | drop down through a ledge |
| Space | jump (press again in the air for a double jump; let go early for a short hop) |
| Shift | dash (quick, you can't be hurt during it; dashing right before a hit is a **Perfect Dodge**) |
| Q | bubble: a see-through shield for 2 seconds (it blinks before it pops), then a cooldown. It stops red and amber hits, not purple ones. You move slower and can't attack inside it |
| R | your hero's ultimate |
| E | pick up coins, honey, potions, bombs and ether that enemies drop |
| J / left mouse | attack |

**New monsters:** every forest area has its own monsters, made in Blender (`Tools/blender_monsters.py` in the Unity
project), plus flying ones. Only the card frames still come from the `dnd` assets.

**The game design file** (`Downloads\roguelite_action_platformer_game_design.txt`) has a new part **19a** with every
open question answered (controls, hero stats, EXP, card rarity, shards, biomes, shops, solo only...).

**Google Drive folders:** `python scripts/package_app.py --drive` makes `dist/Vermeil-Drive/` with one folder per
feature (plugin) plus your games. Upload the folders to Drive; each has its own install and uninstall script.
`scripts/install.ps1` / `scripts/uninstall.ps1` install or fully remove the app.

**Faster talking:** with Chatterbox on the GPU, the first sound of a short paragraph now comes in about **2.5 s**
(measured 2.47 s).

## New (28 Oct 2026, earlier): forest runs, real-time fights and level-up cards (Unity)
The run is now a **forest** and the fights are **real time** (the old turn-based battles were moved to
`C:\Users\jpant\My project\OldCode`, outside the game). The heroes are the six animal heroes.

**Controls in the forest**
| Key | What it does |
|---|---|
| WASD / left stick | move |
| J / left mouse (hold) | attack |
| Space / Shift / L | dodge (a quick dash, you can't be hurt during it) |
| K / Q | your hero's skill (costs your hero's resource) |
| Tab | use something from the satchel (potion, bomb or ether, whatever fits) |

**Red, purple and amber warnings.** Before an enemy attack lands, its shape is drawn on the ground and fills up.
The shape is exactly what gets hit: a line (charge or shot), a cone, a circle, a wide lane, several circles (rain),
or a line then a circle (a leap).
- **Red** = a normal attack. Dodge it **right before** it fills up for a **Perfect Dodge**: time slows for a moment and
  your hero's **counterattack** fires (it then cools down for 3 seconds, and only once per attack, even attacks that
  hit several times). Counters knock enemies off balance; bosses recover faster.
- **Purple** = can't be dodged through or countered. Get out of it.
- **Amber** = the forest itself (falling acorns, spores, bees, bubbles, branches, thorns).

**The heroes**
| Hero | Resource | Skill (K) | Counter (Perfect Dodge) |
|---|---|---|---|
| Frog Brawler | Croak (from punching) | Bog Slam | Tongue Uppercut: pulls the enemy in |
| Platypus Mage | Mana (fills by itself) | Tidal Orb | Ripple Blink: blinks behind it |
| Armadillo Paladin | Faith (hitting and being hit) | Holy Roll | Shell Riposte: bash and a shield |
| Fox Ranger | Focus (every 3 hits) | Charged Shot | Foxfire Volley: hops back and shoots 3 arrows |
| Gecko Rogue | Venom (every 2 hits) | Envenom | Tail Decoy: appears behind it, sure critical hit |
| Hawk Swordsman | Gale (hitting and running) | Wind Cutter | Talon Iaido: cuts straight through it |

**A run:** 6 forest stages (Mossy Glade, Mushroom Hollow, Bloom Meadow, Twisted Bog, Ancient Grove, Withered Wood)
with **5 rounds each**. Round 5 is a **mini-boss**. Then the final boss, the **Thornwyrm**, in the Heartwood. It has
3 phases: at 2/3 and 1/3 of its health it learns new moves, calls more enemies and its warnings get faster.

**Level-up cards.** Enemies give experience. Every level up stops the fight and offers **3 cards**: pick one with
**<- ->** and **Enter**, or click it. Mini-bosses give a free extra pick with a better chance of a Mythic.
- **Mythic** (green): 3 per hero, made for that hero, each only once per run.
- **Legendary** (gold): for every hero, and they can stack.

| Hero | Mythic cards |
|---|---|
| Frog | Bullfrog Chorus, Lilypad Rebound, Monsoon Fists |
| Platypus | Riverheart Torrent, Clutch of Storms, Duckbill Sonar |
| Armadillo | Shell of the Old Oak, Sanctified Roll, Dawnplate Judgement |
| Fox | Ninefold Foxfire, Hunter's Mark, Fox Spirit Twin |
| Gecko | Regrowing Tail, Venom Kiss, Wallcrawler Ambush |
| Hawk | Skybreaker Iaido, Feathered Gale, Eye of the Storm |

Legendary cards: Heart of the Oak, Thornbark Mail, Fairy Ring, Firefly Lantern, Moonpetal Bloom, Acorn of Plenty,
Stag's Crown, Wind Through Leaves, Honeycomb Hoard, Spore Burst, Owl's Vigil, Root Snare.

**The card pictures** are made in Blender: `blender/cards/Cards.blend` (all 30 cards), `make_cards.py` (makes them
again), `cards.json` (names and texts) and `renders/` (the pictures). The game uses copies in
`Assets\Vermeil\Resources\Art\Cards\` and `Resources\Cards\cards.json`. To remake the pictures (a few minutes):
```bash
"C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe" -b --python blender\cards\make_cards.py
```

## New (28 Oct 2026, later): the adventure rebuilt in Unity 6 as a 3D roguelite
The game now lives in its own Unity project: **`C:\Users\jpant\My project`** (Unity 6000.6.7f1, URP). The finished game
is **`C:\Users\jpant\My project\Build\Vermeil.exe`** - double-click it to play. The old three.js adventure in the app
is still there and unchanged (except the warrior and ranger no longer get painted eyes).

**How it plays**
- **First time:** a night campfire. Vermeil sits on her log, the six heroes sit side by side on the long log. Press
  **← / →** to pick a hero (they stand up and wave), **Enter** to choose. The portal becomes a **black hole** and
  swallows the camp: the pot and backpack fly in, the logs, tent and campfire **break into pieces** and get sucked in,
  then the other heroes, then Vermeil and your hero (the trees stay). Everyone is **thrown out into the village**:
  pieces of the camp land with real gravity, your hero lands on their back and **Vermeil helps them stand up**.
- **The village (your home base):** walk with **WASD**, jump with **Space**, talk with **E**.
  - **Smith** - the skill tree (spend **shards**: more HP/attack, a wider timing window, double jump, healing, a revive...).
  - **Trader** - potions, ethers, bombs, feathers for your next run (paid with banked gold).
  - **Tailor** - cosmetics: a crown, dyes, a stardust trail.
  - **Bell tower** - the **Eclipse** difficulty (unlocked after beating the final boss; harder enemies, more shards).
  - The other heroes hang around by the inn: talk to one to swap heroes. Walk into the **portal** to start a run.
- **A run:** 4 biomes (Greenwood, Frostpeak, Ember Wastes, the Spire), 3 areas each; the third is the boss's lair.
  Each area is generated fresh: a winding path, mountains you can climb, stepping-stone platforms with gems on top,
  chests on the mountain tops, coins along the path. Nothing is placed on the path or on top of something else.
  In the 2nd area of each biome a friend is locked in a **cage**: free them (E) and they **shrink into a jar** that
  Vermeil carries. In battle they pop out of the jar and grow back to full size.
- **Battles** (replaced: see the forest section above). Before: turn-based, timed presses: touch a monster to fight. Pick Attack / Skill / Item, then press **Space**
  when the shrinking ring hits the circle (Perfect = bonus hit). When enemies attack, press Space on time to block.
  Party and enemies stand **evenly spaced in rows**. Every defeated enemy pops **+EXP** and **+Gold** with a sound.
- **Death or victory:** you're kicked back out of the portal into the village. You keep all shards and a quarter of
  your gold (all of it if you win). Beating the final boss plays the ending.

**Voices:** only your companion (the character active in the Vermeil app) uses the **voice clone (RVC)**; every
other voice in the game is the fast offline Piper voice. The game starts `game_tools/unity_voice_server.py`
(port 8790) by itself; if it can't, the game plays silently with subtitles.

**Rebuilding the game** after changing its code (Unity must be closed):
```bash
"C:\Program Files\Unity\Hub\Editor\6000.6.7f1\Editor\Unity.exe" -batchmode -quit -projectPath "C:\Users\jpant\My project" -executeMethod VermeilBuilder.Build -logFile "C:\Users\jpant\My project\Tools\build.log"
```
Self-test (plays itself and saves screenshots in `Build\shots`; your save isn't touched):
```bash
"C:\Users\jpant\My project\Build\Vermeil.exe" -autotest
```
If a model ever shows up tiny, huge or plain white, check `Tools\play.log` for lines starting with `[art]` or
`[actor]`: the game fixes sizes by itself and logs what it changed.

## New (28 Oct 2026)
- **Voice:** the whole reply is spoken in one go again (not sentence by sentence). The voice warms up in the background
  when a character is picked, so the first reply isn't slow. RVC voice clones now run on the graphics card (about 7x
  faster; `RVC_DEVICE=cpu` in `.env` keeps them on the CPU). A sad reply with a kind word in it now sounds sad.
- **UniMate no longer needs the Blender program:** its last step runs with the `bpy` library inside its own Python
  (a small stand-in, `tools/unimate_bin/blender`). After **Animate it** finishes, the character switches to the new
  `<name>-animated.glb` with the clips (idle, walk…); try them in **Test animations**.
- **Rooms on both sides:** Edit room → 🏠 Rooms has **+ Room on the left** and **+ Room on the right** (up to 4 rooms).
- **Dropdowns always open downward** (`ui/dropdown.js`).
- **Cooking & Baking** are one menu item with two tabs (🍳 Cooking / 🧁 Baking). Your recipes are unchanged; the tab
  you used last is remembered. One tick in Settings and one plugin ("Cooking & Baking") cover both.

## New (27 Oct 2026)
- **Voice:** **Kokoro + RVC** again. Qwen3-TTS is gone (too slow on a 4 GB GPU). In Settings → character → **Voice clone
  (RVC)** you **import an RVC model** (.pth + .index), pick it in the dropdown, and choose the base voice in **Speak with**.
- **Rig & animate 3D models:** import a .glb/.gltf (or press 🦴 **Rig & animate**). Rig it automatically or place the bones
  yourself. Animations (idle, walk, wave, dance…) come from UniMate. Its code and Python set themselves up in the
  background (Miniconda; needs Git for Windows). Its libraries are already installed on my PC; on another PC run the two
  commands shown in the Animate box:
  `"%USERPROFILE%\miniconda3\envs\unimate\python.exe" -m pip install "setuptools<81"` and
  `"%USERPROFILE%\miniconda3\envs\unimate\python.exe" -m pip install -r tools\unimate\requirements.txt --no-build-isolation`.
  UniMate's models are for non-commercial use only.
- **Music:** closing Vermeil stops the song (it used to keep playing while the app showed nothing playing), and opening
  **Games** pauses your music.
- **Study → Research → AI Detector:** shows how "AI-like" a text is; **Make it sound human** rewrites it and checks again.
- **Music:** songs play to the very end (the volume levelling used to drop the last 15 s), search prefers lyric videos, and a playlist's **🎤 Use lyric videos** button converts it.
- **Settings → Voice & camera:** pick your camera and microphone (only working ones are listed).
- **Room:** pets you can pet, Undo, and DnD furniture paint colours.
- **Rooms:** Edit room → **🏠 Rooms**. Add up to 4 rooms on the **left and right** of the main room (width and depth
  adjustable). When she walks into a room, **the camera switches to that room** (a view like the main room's) and comes
  back when she returns. (Extra floors and stairs were removed.)
- **The big window is furniture:** in Edit room click it to move it or delete it; add it again from **Wall decor →
  Big window (time of day)**. Clicking it outside Edit room still changes the time of day.
- **Bathroom mirrors** hang on the wall and really reflect the room.
- **Wallpapers:** Edit → **Wall decor** → pick a pattern at the top (it uses your wall colour).
- **Gym → Meal planner:** Bulk / Cut / Recomp with calories, protein, fat, carbs and grams per meal. Pick **2-6 meals a day**,
  and press **Other dish** on a meal to swap it.
  **Progress** shows weight and reps per lift, with **My stats** at the bottom.
