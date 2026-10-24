# Vermeil

## First-time setup (runs fully on your PC)
1. Install **Ollama** (free, runs the AI on your PC): https://ollama.com/download
2. In the VS Code terminal, inside this folder:
   - `python -m pip install -r requirements.txt`
   - `python scripts/setup_local.py` — picks AI models that fit your PC and downloads everything once (a few GB)
3. Start: `python app.py`

The main AI is **Groq** (online, fast — put `GROQ_API_KEY=...` in your `.env` file). When Groq's free tokens run out,
she switches **by herself** to Ollama on your PC, and back again later. Voice, listening, faces and the room are always local.
Internet is used for: Groq, music, paper search, weather, web search, news, prices, email, calendar sync, and new voices.
Check what's installed: `python scripts/setup_local.py --check`. Use smaller/bigger models: `python scripts/setup_local.py --size small` (tiny / small / medium / large).

See **FEATURES.md** for every feature (all 137 done, with honest notes on limits).

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
First time on a new PC: `pip install -r requirements.txt`

## What's in this folder
| File / folder | What it is |
|---|---|
| `app.py` | **Start here.** Opens the window and connects everything |
| `terminal.py` | Vermeil without the window |
| `folders.py` | Tells Python where the code folders are (app.py loads it first) |
| `brain/` | Thinking: `pinakamain.py` (chat, memory, voice loop), `llm.py` (Groq ⇄ Ollama), `tools.py` (everything the AI can do), `mind.py` (journal, think tools, recall), `missions.py`, `relationship.py` (our story), `coder.py` (coding helper), `paths.py`, `Vprompt.py` |
| `senses/` | Hearing, speaking, seeing: `stt.py` (Whisper), `tts.py` (Piper voices), `wakeword.py`, `denoise.py`, `voicemood.py`, `presence.py` (faces), `objects.py` (things the camera sees) |
| `skills/` | Things she does: `f1.py` (planner + music player), `music.py`, `spotify.py`, `gym.py`, `focus.py`, `sensei.py` (languages), `academic.py` + `scholar.py` (study, research), `productivity.py` (email, meetings, documents, calendar sync), `web.py`, `pc.py` (control your PC), `browser.py` (fills forms), `gcal.py` (Google Calendar) |
| `scripts/` | Run them yourself: `setup_local.py` (downloads the local AI), `cleanup_packages.py` |
| `ui/` | The window: sidebar, panels, 3D room, characters |
| `data/` | Everything Vermeil saves: memory, characters, room, planner, gym, settings, voices, AI/face/object models |
| `tests/` | Automatic checks: `python -m unittest discover -s tests -v` |
| `env` | Your API keys - keep it private |
| `requirements.txt` | Python packages to install |
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
startup), `ONNX_PROVIDER=CUDAExecutionProvider` (use an NVIDIA GPU after `pip install onnxruntime-gpu`; the CPU is
already fast enough). Advanced: `KOKORO_URL=http://127.0.0.1:8880` uses a Kokoro-FastAPI server you run yourself instead.
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
You can also say: “what's my workout today?”, “log incline bench set 2, 22.5 kg, 10 reps”, “start a 2 minute timer”.
