# Vermeil — feature checklist

Checked against every feature screenshot you sent (updated 21 Oct 2026, after batches 1–9).
✅ done · 🟡 partly done · ❌ not built yet

**Totals: 137 ✅ done · 0 🟡 partly · 0 ❌ not yet (137 features)**

## Where things run
| Part | Where it runs |
|---|---|
| AI brain (chat, tools, study, think, coding helper) | Groq online first (fast); switches **by itself** to Ollama on your PC when Groq's free tokens run out. Settings → AI can force "local only". |
| Seeing (camera questions, screen questions, OCR, gestures) | Groq vision online, or Ollama (qwen2.5-VL) locally |
| Face recognition, attention, object spotting | ✅ Local — OpenCV |
| Wake word (trained on your voice), noise filter | ✅ Local — numpy |
| Speech recognition | ✅ Local — Whisper (faster-whisper), GPU or CPU |
| Voice | ✅ Local — Piper |
| 3D room, characters, outfits, font | ✅ Local files |
| Needs the internet | Groq, music (YouTube / Spotify), paper search (OpenAlex/Crossref), web search, news, prices, weather, email, Google Calendar sync, downloading new voices |

## 🧩 Side apps, AI models, agents and services she uses
Everything Vermeil runs or talks to besides her own Python code. "Local" = runs on your PC, "Online" = needs the internet.

### AI brains (language models)
| Name | What it does | Where | Notes |
|---|---|---|---|
| **Groq** (API) | Main AI: chat, tools, study, coding helper, Dungeon Master | Online | Models: `openai/gpt-oss-20b` (chat), `openai/gpt-oss-120b` (smart), `qwen/qwen3.8-27b` (vision). Key: `GROQ_API_KEY` in `env` |
| **Ollama** | Backup AI when Groq is out of tokens or offline | Local | Lives in `tools/ollama/` (put there by `scripts\setup_ollama.bat`); Vermeil starts it hidden when needed and closes it on exit - no app to open. Models `qwen3:8b` (chat/smart), `qwen2.5vl:7b` (vision); `scripts/setup_local.py` picks sizes for your PC |
| **llama.cpp server** (optional) | Another local backup engine | Local | Only if you set `LLAMA_URL` |

### Voice (speaking and listening)
| Name | What it does | Where | Notes |
|---|---|---|---|
| **Kokoro TTS** (`kokoro-onnx`) | Her voice while the AI is online (e.g. `af_heart`), and the game's voices | Local | Model files in `tools/kokoro/` (325 MB). Setup: `scripts\setup_kokoro.bat` |
| **Piper TTS** (`piper-tts`) | Her offline voice (default) | Local | Voices in `data/piper_voices/`, downloaded from Hugging Face |
| **edge-tts** | Voices for Japanese, Korean, Filipino, Thai… | Online | Microsoft's online voices |
| **faster-whisper** (Whisper) | Speech recognition | Local | GPU if you have one, otherwise CPU |
| **SpeechRecognition + PyAudio** | Microphone recording, pause detection | Local | |
| **Wake word** (`senses/wakeword.py`) | "Vermi" trained on your own voice | Local | numpy only |
| **Noise filter** (`senses/denoise.py`) | Removes fan/aircon/street noise | Local | |
| **Audio ducking** (`senses/ducking.py`, pycaw) | Lowers music and other apps while you give a command and while she answers | Local | Settings → Voice. Uses Windows' per-app volume |

### Seeing (camera and screen)
| Name | What it does | Where | Notes |
|---|---|---|---|
| **OpenCV** | Camera, face detection and recognition | Local | Models: YuNet (`face_detection_yunet_2023mar.onnx`), SFace (`face_recognition_sface_2021dec.onnx`) |
| **NanoDet** (OpenCV model zoo) | Spots 80 everyday objects | Local | `object_detection_nanodet_2022nov.onnx` |
| **Vision AI** (Groq or Ollama qwen2.5-VL) | Describes what the camera/screen shows, reads text, gestures | Online / Local | |

### Music and media
| Name | What it does | Where | Notes |
|---|---|---|---|
| **yt-dlp** | Finds and streams songs from YouTube | Online | |
| **ffplay** (FFmpeg) | Plays the music stream (with loudness levelling) | Local | |
| **Spotify Web API** | Spotify panel and voice control | Online | Your own Client ID/Secret in Settings |
| **pycaw + comtypes** | PC volume, mute, ducking | Local | |

### Internet services (agents/tools she calls)
| Name | What it's for |
|---|---|
| DuckDuckGo, Bing, Mojeek, Brave Search, Wikipedia | Web search with sources |
| Google News | News briefings |
| YouTube | Video search and caption summaries |
| WeatherAPI.com, Open-Meteo | Weather and alerts (`WEATHER_API_KEY` optional) |
| OpenAlex, Crossref, doi.org | Research papers and APA citations |
| Google Calendar API, Gmail | Calendar sync, email (one-time setup in Settings) |
| Hugging Face | Downloading Piper voices |
| GitHub (OpenCV zoo) | Downloading the face/object models once |

### Inside the app (her own agents)
| Agent | What it does |
|---|---|
| Tool-picking agent (`brain/pinakamain.py`) | Chooses tools for each message, up to 8 steps |
| Mission Control (`brain/missions.py`) | Long background missions over hours/days |
| Coding agent (`brain/coder.py`) | Writes and edits code in your project folder |
| Multi-Agent Council (`brain/mind.py`) | Several viewpoints argue a decision |
| Dungeon Master (`game/dm.py`) + companion (`game/companion.py`) | Run the adventure game |
| Robotics & Electronics assistant (`skills/electronics.py`) | Repairs, repurposing, formulas, robot plans, circuit lab |
| Browser helper (Playwright) | Her own browser window for reading and filling forms |

### Other programs and libraries
| Name | What it's for |
|---|---|
| **pywebview** (+ Microsoft Edge WebView2) | The app window |
| **three.js** | 3D room, characters, the adventure game, the circuit lab's 3D view |
| **Blender** | Making/converting models (`blender/`, `game_tools/blender_convert.py`) |
| pypdf, python-docx, python-pptx, openpyxl | Reading study files, gym Excel import |
| psutil, pillow, winotify, keyboard | PC status, screenshots, Windows notifications, hotkeys |
| sympy | Solving math |
| vaderSentiment, rapidfuzz | Mood from your words, fuzzy matching of commands |

---

## 🧠 Intelligence and Memory
| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Long-term memory | ✅ | Chats, preferences, older chats archived |
| 2 | Memory search, editing, deletion | ✅ | Chat → hover a message: ✎ edit / × delete; search box searches everything; forget preferences |
| 3 | Remembers previous topics | ✅ | Last 20 messages + automatic recall of old chats |
| 4 | Multi-step reasoning and planning | ✅ | Up to 8 tool steps per message + Missions for bigger goals |
| 5 | Picks tools automatically | ✅ | |
| 6 | Self-checks answers before replying | ✅ | Settings → "Double-check answers" (slower) |
| 7 | Responses based on mood and preferences | ✅ | Mood from your words **and** your voice tone |
| 8 | Different AI models for different jobs | ✅ | chat / smart / vision |
| 9 | Local LLM, offline | ✅ | Ollama; automatic fallback from Groq |
| 10 | Knowledge base from your documents | ✅ | Study library (PDF, Word, PowerPoint, text, **photos of notes**) |

## 🎙 Voice and Communication
| # | Feature | Status | Notes |
|---|---|---|---|
| 11 | Real-time streaming speech | ✅ | Starts speaking the first sentence while the rest is still being written; words appear in the bubble live |
| 12 | Interrupt her by talking | ✅ | Settings → "Let me interrupt her" (best with headphones) |
| 13 | Multiple voice personalities | ✅ | Voice per character + voice styles (whisper, energetic, storyteller, calm, cute) |
| 14 | Voice speed, pitch, volume | ✅ | Per character, in the Characters panel |
| 15 | Better wake-word detection | ✅ | Settings → My wake word: record yourself 4×, she then matches the SOUND of your voice (offline, fast). Falls back to fuzzy matching if not trained |
| 16 | Mic noise filtering | ✅ | Noise reduction (fan, aircon, street) before Whisper + calibration + silence filter |
| 17 | Auto language detection | ✅ | Replies in your language; downloads a Piper voice for it automatically. Japanese/Korean/Filipino/Thai… use online Microsoft voices (need internet + edge-tts) |
| 18 | Knows when you finished talking | ✅ | Pause detection + Whisper silence filter |
| 19 | Recovers when speech recognition fails | ✅ | GPU problem → switches to CPU by itself; otherwise listens again |
| 20 | Whisper speech recognition | ✅ | |

## 👤 Personality and Emotions
| # | Feature | Status | Notes |
|---|---|---|---|
| 21 | Emotional responses | ✅ | Her face changes with what she says |
| 22 | Personality modes | ✅ | Characters + "How she talks" |
| 23 | Mood from voice tone | ✅ | Loudness, speed, pitch vs **your** normal voice (rough guess, learns after ~5 sentences) |
| 24 | Adaptive humor and sarcasm | ✅ | Settings → Humor level; tones down when you sound sad/stressed/tired |
| 25 | Greetings by time and context | ✅ | Greets you (and people she knows) when the camera sees them; morning briefing |
| 26 | Relationship history | ✅ | Chat → Our story: days together, streaks, milestones, memorable moments she picks out |
| 27 | Customizable personality | ✅ | |
| 28 | Speaking styles per situation | ✅ | Companion, tutor, strategist, assistant, coach |

## 👁 Vision and Awareness
| # | Feature | Status | Notes |
|---|---|---|---|
| 29 | Owner face recognition | ✅ | |
| 30 | Profiles for several people | ✅ | Settings → People she knows (name + who they are); greets them by name |
| 31 | Object detection | ✅ | Continuous and offline: 80 everyday things (phone, cup, book, laptop…). Details/reading still use the vision AI |
| 32 | Scene description / visual questions | ✅ | |
| 33 | Reading text (OCR) | ✅ | Camera, screen, and image files (add a photo to the study library or ask her to read one) |
| 34 | Gesture recognition | ✅ | Opt-in: 👍 yes, 👎 no, ✋ stop/pause, 👋 wave. Uses the vision AI every few seconds, so it's slow-ish |
| 35 | Attention detection | ✅ | Knows if you're facing the screen; looking away ~1 min counts as a focus distraction |
| 36 | Camera presence detection | ✅ | |
| 37 | Avatar reacts to the conversation | ✅ | Expressions, emotes, looks at you |
| 38 | Camera privacy indicator | ✅ | Settings → Camera privacy mode (blocks the camera + red 🔒 pill) |

## 🖥 Computer Control and Automation
| # | Feature | Status | Notes |
|---|---|---|---|
| 39 | Open/close apps by voice | ✅ | Close asks first; system apps are protected |
| 40 | Control mouse and keyboard | ✅ | Type text, press keys, click — asks first |
| 41 | Automate repetitive tasks | ✅ | Macros: save a list of steps, run it by name |
| 42 | Navigate websites, fill forms | ✅ | Her own browser window: reads, clicks, fills forms. Never types passwords/card/ID numbers; asks before submit/buy/send |
| 43 | Manage files and folders | ✅ | Move, rename, make folders — inside your user folder only |
| 44 | Search files in plain language | ✅ | |
| 45 | Read and summarize the clipboard | ✅ | |
| 46 | Screenshots + analysis | ✅ | "What's on my screen?" or Ctrl+Alt+S |
| 47 | System volume and media | ✅ | Volume + play/pause/next for any app |
| 48 | Monitor CPU, RAM, GPU, temperatures | ✅ | GPU temperature needs an NVIDIA card |
| 49 | Detect app crashes | ✅ | Reads Windows' crash log |
| 50 | Multi-step commands | ✅ | Tool chains, macros, and Missions that wait hours/days between steps |
| 51 | Custom hotkeys | ✅ | Ctrl+Alt+V/H/Space/S/Esc, work in the background |
| 52 | Emergency stop for automation | ✅ | Ctrl+Alt+Esc or say "stop everything" |

## 📅 Productivity and Organization
| # | Feature | Status | Notes |
|---|---|---|---|
| 53 | Reminders that go off by themselves | ✅ | Including ones missed while the PC was off |
| 54 | Desktop notifications | ✅ | Windows notifications |
| 55 | Google Calendar | ✅ | Reads it every 30 min, and adds/removes events in Google directly after a one-time 5-minute setup (Settings) |
| 56 | Daily agenda / morning briefing | ✅ | Automatic the first time you open her each day |
| 57 | Task completion | ✅ | |
| 58 | Recurring reminders and routines | ✅ | |
| 59 | Task priorities | ✅ | |
| 60 | Smart scheduling by free time | ✅ | Finds free slots and books the task |
| 61 | Birthday notifications | ✅ | |
| 62 | Email summarize, draft, send | ✅ | Reads your inbox (read-only), drafts, sends (Gmail) |
| 63 | Create and edit documents | ✅ | Creates and edits Word/text/Markdown (keeps formatting, saves a backup first). Not PDFs |
| 64 | Meeting notes and summaries | ✅ | Records, transcribes locally, writes notes + action items |
| 65 | Shopping list saved | ✅ | |

## 🌐 Internet and Research
| # | Feature | Status | Notes |
|---|---|---|---|
| 66 | Web search with cited sources | ✅ | Web answers with links; papers in APA 7th edition |
| 67 | Summarize websites | ✅ | |
| 68 | Compare sources | ✅ | Study → Research → Compare web sources: agree / conflict / reliability per site |
| 69 | Research mode | ✅ | |
| 70 | Price tracking | ✅ | Checks every 6 hours, tells you when it drops |
| 71 | Weather and alerts | ✅ | Forecast + weather alerts every hour |
| 72 | News briefings | ✅ | |
| 73 | YouTube search and summary | ✅ | Summary from the video's captions |
| 74 | Download and summarize PDFs | ✅ | |
| 75 | Spot conflicting information | ✅ | Shows each conflict side by side and which is more likely right; fact-check a claim |

## 🎵 Music and Entertainment
| # | Feature | Status | Notes |
|---|---|---|---|
| 76 | Music queue, saved | ✅ | "Resume my queue" after a restart |
| 77 | Pause, resume, seek, replay | ✅ | |
| 78 | Favorite songs and artists | ✅ | |
| 79 | Mood playlists | ✅ | Mixes your taste with the mood |
| 80 | Control music by talking | ✅ | |
| 81 | Auto volume between songs | ✅ | Loudness levelling |
| 82 | Find songs by lyrics/description | ✅ | |
| 83 | Avatar moves to the music | ✅ | She bops along; headphones in auto outfit |
| 84 | Recommendations from history | ✅ | |

## ⭐ Big feature cards
| Feature | Status | Notes |
|---|---|---|
| Multilingual Sensei (language teacher) | ✅ | Lessons, quizzes with spaced repetition, conversation practice, pronunciation check, mistakes, streak |
| Autonomous Mission Control | ✅ | Missions panel: she plans, works in the background for hours/days, asks before risky steps |
| Living Character System | ✅ | Expressions, emotes, idle activities, outfits, scenes. Full faces on Pip, the sketch figure and VRM models; plain GLB models only get the body moves |
| Interactive Study Companion | ✅ | Weak-topic tracking, auto difficulty, timed mock exams, spaced repetition |
| AI Debate Partner | ✅ | Practice tab |
| Screen Awareness | ✅ | Screenshot + vision AI |
| Daily Life Simulator | ✅ | Think → Simulate my plan |
| Contextual Companion | ✅ | Settings → Notice what I'm doing |
| Multi-Agent Council | ✅ | |
| Strategic Foresight | ✅ | |
| Idea Incubator | ✅ | |
| Idea Fusion | ✅ | |
| Pattern Detective | ✅ | |
| What-If Simulator | ✅ | |
| Reverse Engineer | ✅ | |

## 🧩 Thinking skills
| # | Feature | Status |
|---|---|---|
| 1 | Hypothesis Generator | ✅ |
| 2 | Contradiction Detector | ✅ |
| 3 | Causal Reasoning Assistant | ✅ |
| 4 | Blind-Spot Finder | ✅ |
| 5 | Solution Evolution | ✅ |

## 🎭 Skills for an AI that feels alive
| # | Feature | Status | Notes |
|---|---|---|---|
| 17 | Dynamic idle behavior | ✅ | Wanders to furniture and does little things |
| 18 | Expression sequencer | ✅ | Face follows each sentence she says |
| 19 | Character wardrobe | ✅ | Hats, glasses, colour; auto by season, birthday, gym, study, music |
| 20 | Companion room interaction | ✅ | Click things in the room |
| 21 | Character activity schedule | ✅ | Morning window/plant, day desk/books, evening couch, night bed |
| 22 | Memory-based reactions | ✅ | |
| 23 | Voice acting mode | ✅ | Voice styles incl. dramatic storyteller (story lighting too) |
| 24 | Scene transitions | ✅ | Study, focus, story, birthday lighting; your room comes back after |
| 25 | Expressions by voice command | ✅ | "Dance", "wave", "take a bow", "look surprised"… |
| 26 | Several characters talking together | ✅ | "Have Vermeil and Pip talk about pizza" — each in their own voice |

## 🌱 Personal development skills
| # | Feature | Status | Notes |
|---|---|---|---|
| 27 | Habit Experiment Designer | ✅ | Think |
| 28 | Focus Session Director | ✅ | Focus panel: timer, distractions, tips |
| 29 | Procrastination Breaker | ✅ | Think |
| 30 | Goal Feasibility Checker | ✅ | Think |
| 31 | Practice Performance Tracker | ✅ | Progress tab: quizzes, focus, gym, language |
| 32 | Reflection Interviewer | ✅ | Practice tab |
| 33 | Confidence Rehearsal | ✅ | Practice tab, gets harder each level |
| 34 | Personal Knowledge Exams | ✅ | Spaced repetition, due-today list |
| 35 | Routine Drift Detector | ✅ | Think (uses your planner, gym and focus data) |
| 36 | Personal Challenge Generator | ✅ | Think |
| 37 | Concept-to-Prototype Planner | ✅ | Think |
| 38 | 3D Modeling Coach | ✅ | Think |

## 💛 Personal companion skills
| # | Feature | Status | Notes |
|---|---|---|---|
| 17 | Contextual Recall | ✅ | |
| 18 | Personal Ritual Designer | ✅ | Think → Design a routine |
| 19 | Social Rehearsal | ✅ | Practice tab |
| 20 | Decision Journal | ✅ | |
| 21 | Personal Archivist | ✅ | Searches chats, journal, notes, study files and screenshots she looked at (Chat → Screenshots) |
| 22 | Milestone Guardian | ✅ | |
| 23 | Conversation Style Shifter | ✅ | |
| 24 | Quiet Companion Mode | ✅ | |
| 25 | Personalized Recommendations | ✅ | Chat → For you: movies, anime, books, food, places… 👍/👎 teaches her |
| 26 | Digital Legacy Journal | ✅ | |
| 50 | Emergency Information Guide | ✅ | Tells you to call 911 first |

## ➕ Extra features you asked for in chat
✅ 3D cozy room (themes, furniture editor, day/night by your clock, brightness) · ✅ characters (Vermeil, Pip, Robo, your own GLB/VRM) · ✅ planner (calendar, tasks, reminders, birthdays, shopping, notes) · ✅ study (library, review sets, research, assignment help) · ✅ coding helper · ✅ gym mode (your routine, timer, editor, history, best reps, +2.5 kg upgrade, sessions) · ✅ journal & think · ✅ voice commands · ✅ top-left status pills · ✅ night theme with sounds and effects · ✅ Groq → Ollama automatic switch · ✅ saved preferences · ✅ package cleanup script · ✅ smaller AI requests: only the tools that fit each message are sent (~1–2k tokens instead of ~9k), so Groq lasts longer and the local AI isn't overloaded

## 🆕 Batch 11 (22 Oct 2026)
| Feature | Status | Where |
|---|---|---|
| Music ducking: music and other apps get quieter while you give a command and while she answers, then come back | ✅ | Automatic · Settings → General → Behaviour to turn off |
| Adventure companion = the character chosen in the app (Pip, Robo, Vermeil…): name, model, voice and personality | ✅ | Switch character, then start a **new** adventure |
| Gym → Alternatives: exercises that can replace one, 0-5 ★ (5 = most used by big coaches, 0 = weakest swap), "Used by" Jeff Nippard, Mike Israetel, CBum, Jeremy Ethier, Athlean-X, Smart Fit…, "Use instead" swaps it in your routine | ✅ | Gym → Alternatives, or ⇄ on an exercise · voice: "what can I do instead of bench press?" |
| Installer: one command packs the app into a zip for another PC (`python scripts/package_app.py`), INSTALL.bat sets it up | ✅ | Never packs your env keys or login tokens |
| Settings → Plugins: install only the features you want, uninstall to free space (shows MB used) | ✅ | Opens by itself on the first start after installing |
| Robotics & Electronics assistant: fix old electronics, repurpose them, plan a robot start to finish, 16 formula calculators | ✅ | Sidebar → Electronics |
| Circuit Lab: Tinkercad-style simulator, 2D editor + 3D view, breadboards, Arduino Uno/Nano/Mega/Leonardo/Micro/Pro Mini + ESP32, LEDs, buttons, pots, sensors, motors, servos, L293D, multimeter…; runs Arduino code; LEDs burn out, shorts warned; 9 examples; "Check my circuit" by Vermeil | ✅ | Electronics → Circuit Lab |
| Ollama inside the project folder, started/stopped by Vermeil | ✅ | Run `scripts\setup_ollama.bat` once |
| **Vermeil Music** - your own Spotify-style app, no Spotify account: search (YouTube), your playlists (make, rename, reorder, delete), Liked Songs ♥, Recent, queue, now-playing bar with cover/seek, import a YouTube/YouTube Music playlist or a pasted song list, Playlist Lab (analyse + make a new playlist in its style). The real Spotify is switched off (Settings → Sidebar can show it again) | ✅ | Sidebar → Music · voice: "play my gym playlist", "shuffle my liked songs", "like this song", "add this song to my study playlist", "make a discover playlist from Gym Hype" |
| Spotify Playlist Lab: import any playlist (yours or a link), analyse it (genres, moods, energy, eras, top artists, explicit %, variety), then make a NEW playlist in its style (similar / discover / mix / chill / hype) right in your Spotify, or play it on YouTube | ✅ | Spotify → Playlist Lab · voice: "analyse my gym playlist", "make a discover playlist from Geym". First time: Disconnect + Connect once (Spotify needs the "create playlists" permission) |

## Limits worth knowing (honest)
- Circuit Lab runs a **subset** of Arduino C++ (no real compiler; integer division isn't truncated; only the Servo library). Its electrical model is simplified (good for learning, not for exact analog design).
- Exercise "Used by" lists come from those coaches' public videos/programs as I know them - not a complete or official list. Unknown exercises are answered by the AI and marked "AI suggestion".
- Gestures and "look at me" use the vision AI, so they're slower than face/object spotting and use Groq tokens.
- Online-only parts: Groq, music, web, news, prices, weather, email, Google Calendar, and voices for Japanese/Korean/Filipino.
- Google Calendar adding needs the one-time setup in Settings; the browser helper needs `pip install playwright`.
- Everything was tested with automated tests and fake devices; the first real run with your mic, camera and Google account is the real test. · ✅ Spotify (own panel: now playing with cover, controls, search, playlists, liked, recent, top; voice + AI control)
