# Vermeil Ã¢â‚¬â€ feature checklist

Checked against every feature screenshot you sent (updated 21 Oct 2026, after batches 1Ã¢â‚¬â€œ9).
Ã¢Å“â€¦ done Ã‚Â· Ã°Å¸Å¸Â¡ partly done Ã‚Â· Ã¢ÂÅ’ not built yet

**Totals: 146 Ã¢Å“â€¦ done Ã‚Â· 0 Ã°Å¸Å¸Â¡ partly Ã‚Â· 0 Ã¢ÂÅ’ not yet (146 features)**

## Where things run
| Part | Where it runs |
|---|---|
| AI brain (chat, tools, study, think, coding helper) | Groq online first (fast); switches **by itself** to Ollama on your PC when Groq's free tokens run out. Settings Ã¢â€ â€™ AI can force "local only". |
| Seeing (camera questions, screen questions, OCR, gestures) | Groq vision online, or Ollama (qwen2.5-VL) locally |
| Face recognition, attention, object spotting | Ã¢Å“â€¦ Local Ã¢â‚¬â€ OpenCV |
| Wake word (trained on your voice), noise filter | Ã¢Å“â€¦ Local Ã¢â‚¬â€ numpy |
| Speech recognition | Ã¢Å“â€¦ Local Ã¢â‚¬â€ Whisper (faster-whisper), GPU or CPU |
| Voice | Ã¢Å“â€¦ Local Ã¢â‚¬â€ Piper |
| 3D room, characters, outfits, font | Ã¢Å“â€¦ Local files |
| Needs the internet | Groq, music (YouTube / Spotify), paper search (OpenAlex/Crossref), web search, news, prices, weather, email, Google Calendar sync, downloading new voices |

## Ã°Å¸Â§Â© Side apps, AI models, agents and services she uses
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
| **edge-tts** | Voices for Japanese, Korean, Filipino, ThaiÃ¢â‚¬Â¦ | Online | Microsoft's online voices |
| **faster-whisper** (Whisper) | Speech recognition | Local | GPU if you have one, otherwise CPU |
| **SpeechRecognition + PyAudio** | Microphone recording, pause detection | Local | |
| **Wake word** (`senses/wakeword.py`) | "Vermi" trained on your own voice | Local | numpy only |
| **Noise filter** (`senses/denoise.py`) | Removes fan/aircon/street noise | Local | |
| **Audio ducking** (`senses/ducking.py`, pycaw) | Lowers music and other apps while you give a command and while she answers | Local | Settings Ã¢â€ â€™ Voice. Uses Windows' per-app volume |

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

## Ã°Å¸Â§Â  Intelligence and Memory
| # | Feature | Status | Notes |
|---|---|---|---|
| 1 | Long-term memory | Ã¢Å“â€¦ | Chats, preferences, older chats archived |
| 2 | Memory search, editing, deletion | Ã¢Å“â€¦ | Chat Ã¢â€ â€™ hover a message: Ã¢Å“Å½ edit / Ãƒâ€” delete; search box searches everything; forget preferences |
| 3 | Remembers previous topics | Ã¢Å“â€¦ | Last 20 messages + automatic recall of old chats |
| 4 | Multi-step reasoning and planning | Ã¢Å“â€¦ | Up to 8 tool steps per message + Missions for bigger goals |
| 5 | Picks tools automatically | Ã¢Å“â€¦ | |
| 6 | Self-checks answers before replying | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ "Double-check answers" (slower) |
| 7 | Responses based on mood and preferences | Ã¢Å“â€¦ | Mood from your words **and** your voice tone |
| 8 | Different AI models for different jobs | Ã¢Å“â€¦ | chat / smart / vision |
| 9 | Local LLM, offline | Ã¢Å“â€¦ | Ollama; automatic fallback from Groq |
| 10 | Knowledge base from your documents | Ã¢Å“â€¦ | Study library (PDF, Word, PowerPoint, text, **photos of notes**) |

## Ã°Å¸Å½â„¢ Voice and Communication
| # | Feature | Status | Notes |
|---|---|---|---|
| 11 | Real-time streaming speech | Ã¢Å“â€¦ | Starts speaking the first sentence while the rest is still being written; words appear in the bubble live |
| 12 | Interrupt her by talking | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ "Let me interrupt her" (best with headphones) |
| 13 | Multiple voice personalities | Ã¢Å“â€¦ | Voice per character + voice styles (whisper, energetic, storyteller, calm, cute) |
| 14 | Voice speed, pitch, volume | Ã¢Å“â€¦ | Per character, in the Characters panel |
| 15 | Better wake-word detection | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ My wake word: record yourself 4Ãƒâ€”, she then matches the SOUND of your voice (offline, fast). Falls back to fuzzy matching if not trained |
| 16 | Mic noise filtering | Ã¢Å“â€¦ | Noise reduction (fan, aircon, street) before Whisper + calibration + silence filter |
| 17 | Auto language detection | Ã¢Å“â€¦ | Replies in your language; downloads a Piper voice for it automatically. Japanese/Korean/Filipino/ThaiÃ¢â‚¬Â¦ use online Microsoft voices (need internet + edge-tts) |
| 18 | Knows when you finished talking | Ã¢Å“â€¦ | Pause detection + Whisper silence filter |
| 19 | Recovers when speech recognition fails | Ã¢Å“â€¦ | GPU problem Ã¢â€ â€™ switches to CPU by itself; otherwise listens again |
| 20 | Whisper speech recognition | Ã¢Å“â€¦ | |

## Ã°Å¸â€˜Â¤ Personality and Emotions
| # | Feature | Status | Notes |
|---|---|---|---|
| 21 | Emotional responses | Ã¢Å“â€¦ | Her face changes with what she says |
| 22 | Personality modes | Ã¢Å“â€¦ | Characters + "How she talks" |
| 23 | Mood from voice tone | Ã¢Å“â€¦ | Loudness, speed, pitch vs **your** normal voice (rough guess, learns after ~5 sentences) |
| 24 | Adaptive humor and sarcasm | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ Humor level; tones down when you sound sad/stressed/tired |
| 25 | Greetings by time and context | Ã¢Å“â€¦ | Greets you (and people she knows) when the camera sees them; morning briefing |
| 26 | Relationship history | Ã¢Å“â€¦ | Chat Ã¢â€ â€™ Our story: days together, streaks, milestones, memorable moments she picks out |
| 27 | Customizable personality | Ã¢Å“â€¦ | |
| 28 | Speaking styles per situation | Ã¢Å“â€¦ | Companion, tutor, strategist, assistant, coach |

## Ã°Å¸â€˜Â Vision and Awareness
| # | Feature | Status | Notes |
|---|---|---|---|
| 29 | Owner face recognition | Ã¢Å“â€¦ | |
| 30 | Profiles for several people | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ People she knows (name + who they are); greets them by name |
| 31 | Object detection | Ã¢Å“â€¦ | Continuous and offline: 80 everyday things (phone, cup, book, laptopÃ¢â‚¬Â¦). Details/reading still use the vision AI |
| 32 | Scene description / visual questions | Ã¢Å“â€¦ | |
| 33 | Reading text (OCR) | Ã¢Å“â€¦ | Camera, screen, and image files (add a photo to the study library or ask her to read one) |
| 34 | Gesture recognition | Ã¢Å“â€¦ | Opt-in: Ã°Å¸â€˜Â yes, Ã°Å¸â€˜Å½ no, Ã¢Å“â€¹ stop/pause, Ã°Å¸â€˜â€¹ wave. Uses the vision AI every few seconds, so it's slow-ish |
| 35 | Attention detection | Ã¢Å“â€¦ | Knows if you're facing the screen; looking away ~1 min counts as a focus distraction |
| 36 | Camera presence detection | Ã¢Å“â€¦ | |
| 37 | Avatar reacts to the conversation | Ã¢Å“â€¦ | Expressions, emotes, looks at you |
| 38 | Camera privacy indicator | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ Camera privacy mode (blocks the camera + red Ã°Å¸â€â€™ pill) |

## Ã°Å¸â€“Â¥ Computer Control and Automation
| # | Feature | Status | Notes |
|---|---|---|---|
| 39 | Open/close apps by voice | Ã¢Å“â€¦ | Close asks first; system apps are protected |
| 40 | Control mouse and keyboard | Ã¢Å“â€¦ | Type text, press keys, click Ã¢â‚¬â€ asks first |
| 41 | Automate repetitive tasks | Ã¢Å“â€¦ | Macros: save a list of steps, run it by name |
| 42 | Navigate websites, fill forms | Ã¢Å“â€¦ | Her own browser window: reads, clicks, fills forms. Never types passwords/card/ID numbers; asks before submit/buy/send |
| 43 | Manage files and folders | Ã¢Å“â€¦ | Move, rename, make folders Ã¢â‚¬â€ inside your user folder only |
| 44 | Search files in plain language | Ã¢Å“â€¦ | |
| 45 | Read and summarize the clipboard | Ã¢Å“â€¦ | |
| 46 | Screenshots + analysis | Ã¢Å“â€¦ | "What's on my screen?" or Ctrl+Alt+S |
| 47 | System volume and media | Ã¢Å“â€¦ | Volume + play/pause/next for any app |
| 48 | Monitor CPU, RAM, GPU, temperatures | Ã¢Å“â€¦ | GPU temperature needs an NVIDIA card |
| 49 | Detect app crashes | Ã¢Å“â€¦ | Reads Windows' crash log |
| 50 | Multi-step commands | Ã¢Å“â€¦ | Tool chains, macros, and Missions that wait hours/days between steps |
| 51 | Custom hotkeys | Ã¢Å“â€¦ | Ctrl+Alt+V/H/Space/S/Esc, work in the background |
| 52 | Emergency stop for automation | Ã¢Å“â€¦ | Ctrl+Alt+Esc or say "stop everything" |

## Ã°Å¸â€œâ€¦ Productivity and Organization
| # | Feature | Status | Notes |
|---|---|---|---|
| 53 | Reminders that go off by themselves | Ã¢Å“â€¦ | Including ones missed while the PC was off |
| 54 | Desktop notifications | Ã¢Å“â€¦ | Windows notifications |
| 55 | Google Calendar | Ã¢Å“â€¦ | Reads it every 30 min, and adds/removes events in Google directly after a one-time 5-minute setup (Settings) |
| 56 | Daily agenda / morning briefing | Ã¢Å“â€¦ | Automatic the first time you open her each day |
| 57 | Task completion | Ã¢Å“â€¦ | |
| 58 | Recurring reminders and routines | Ã¢Å“â€¦ | |
| 59 | Task priorities | Ã¢Å“â€¦ | |
| 60 | Smart scheduling by free time | Ã¢Å“â€¦ | Finds free slots and books the task |
| 61 | Birthday notifications | Ã¢Å“â€¦ | |
| 62 | Email summarize, draft, send | Ã¢Å“â€¦ | Reads your inbox (read-only), drafts, sends (Gmail) |
| 63 | Create and edit documents | Ã¢Å“â€¦ | Creates and edits Word/text/Markdown (keeps formatting, saves a backup first). Not PDFs |
| 64 | Meeting notes and summaries | Ã¢Å“â€¦ | Records, transcribes locally, writes notes + action items |
| 65 | Shopping list saved | Ã¢Å“â€¦ | |

## Ã°Å¸Å’Â Internet and Research
| # | Feature | Status | Notes |
|---|---|---|---|
| 66 | Web search with cited sources | Ã¢Å“â€¦ | Web answers with links; papers in APA 7th edition |
| 67 | Summarize websites | Ã¢Å“â€¦ | |
| 68 | Compare sources | Ã¢Å“â€¦ | Study Ã¢â€ â€™ Research Ã¢â€ â€™ Compare web sources: agree / conflict / reliability per site |
| 69 | Research mode | Ã¢Å“â€¦ | |
| 70 | Price tracking | Ã¢Å“â€¦ | Checks every 6 hours, tells you when it drops |
| 71 | Weather and alerts | Ã¢Å“â€¦ | Forecast + weather alerts every hour |
| 72 | News briefings | Ã¢Å“â€¦ | |
| 73 | YouTube search and summary | Ã¢Å“â€¦ | Summary from the video's captions |
| 74 | Download and summarize PDFs | Ã¢Å“â€¦ | |
| 75 | Spot conflicting information | Ã¢Å“â€¦ | Shows each conflict side by side and which is more likely right; fact-check a claim |

## Ã°Å¸Å½Âµ Music and Entertainment
| # | Feature | Status | Notes |
|---|---|---|---|
| 76 | Music queue, saved | Ã¢Å“â€¦ | "Resume my queue" after a restart |
| 77 | Pause, resume, seek, replay | Ã¢Å“â€¦ | |
| 78 | Favorite songs and artists | Ã¢Å“â€¦ | |
| 79 | Mood playlists | Ã¢Å“â€¦ | Mixes your taste with the mood |
| 80 | Control music by talking | Ã¢Å“â€¦ | |
| 81 | Auto volume between songs | Ã¢Å“â€¦ | Loudness levelling |
| 82 | Find songs by lyrics/description | Ã¢Å“â€¦ | |
| 83 | Avatar moves to the music | Ã¢Å“â€¦ | She bops along; headphones in auto outfit |
| 84 | Recommendations from history | Ã¢Å“â€¦ | |

## Ã¢Â­Â Big feature cards
| Feature | Status | Notes |
|---|---|---|
| Multilingual Sensei (language teacher) | Ã¢Å“â€¦ | Lessons, quizzes with spaced repetition, conversation practice, pronunciation check, mistakes, streak |
| Autonomous Mission Control | Ã¢Å“â€¦ | Missions panel: she plans, works in the background for hours/days, asks before risky steps |
| Living Character System | Ã¢Å“â€¦ | Expressions, emotes, idle activities, outfits, scenes. Full faces on Pip, the sketch figure and VRM models; plain GLB models only get the body moves |
| Interactive Study Companion | Ã¢Å“â€¦ | Weak-topic tracking, auto difficulty, timed mock exams, spaced repetition |
| AI Debate Partner | Ã¢Å“â€¦ | Practice tab |
| Screen Awareness | Ã¢Å“â€¦ | Screenshot + vision AI |
| Daily Life Simulator | Ã¢Å“â€¦ | Think Ã¢â€ â€™ Simulate my plan |
| Contextual Companion | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ Notice what I'm doing |
| Multi-Agent Council | Ã¢Å“â€¦ | |
| Strategic Foresight | Ã¢Å“â€¦ | |
| Idea Incubator | Ã¢Å“â€¦ | |
| Idea Fusion | Ã¢Å“â€¦ | |
| Pattern Detective | Ã¢Å“â€¦ | |
| What-If Simulator | Ã¢Å“â€¦ | |
| Reverse Engineer | Ã¢Å“â€¦ | |

## Ã°Å¸Â§Â© Thinking skills
| # | Feature | Status |
|---|---|---|
| 1 | Hypothesis Generator | Ã¢Å“â€¦ |
| 2 | Contradiction Detector | Ã¢Å“â€¦ |
| 3 | Causal Reasoning Assistant | Ã¢Å“â€¦ |
| 4 | Blind-Spot Finder | Ã¢Å“â€¦ |
| 5 | Solution Evolution | Ã¢Å“â€¦ |

## Ã°Å¸Å½Â­ Skills for an AI that feels alive
| # | Feature | Status | Notes |
|---|---|---|---|
| 17 | Dynamic idle behavior | Ã¢Å“â€¦ | Wanders to furniture and does little things |
| 18 | Expression sequencer | Ã¢Å“â€¦ | Face follows each sentence she says |
| 19 | Character wardrobe | Ã¢Å“â€¦ | Hats, glasses, colour; auto by season, birthday, gym, study, music |
| 20 | Companion room interaction | Ã¢Å“â€¦ | Click things in the room |
| 21 | Character activity schedule | Ã¢Å“â€¦ | Morning window/plant, day desk/books, evening couch, night bed |
| 22 | Memory-based reactions | Ã¢Å“â€¦ | |
| 23 | Voice acting mode | Ã¢Å“â€¦ | Voice styles incl. dramatic storyteller (story lighting too) |
| 24 | Scene transitions | Ã¢Å“â€¦ | Study, focus, story, birthday lighting; your room comes back after |
| 25 | Expressions by voice command | Ã¢Å“â€¦ | "Dance", "wave", "take a bow", "look surprised"Ã¢â‚¬Â¦ |
| 26 | Several characters talking together | Ã¢Å“â€¦ | "Have Vermeil and Pip talk about pizza" Ã¢â‚¬â€ each in their own voice |

## Ã°Å¸Å’Â± Personal development skills
| # | Feature | Status | Notes |
|---|---|---|---|
| 27 | Habit Experiment Designer | Ã¢Å“â€¦ | Think |
| 28 | Focus Session Director | Ã¢Å“â€¦ | Focus panel: timer, distractions, tips |
| 29 | Procrastination Breaker | Ã¢Å“â€¦ | Think |
| 30 | Goal Feasibility Checker | Ã¢Å“â€¦ | Think |
| 31 | Practice Performance Tracker | Ã¢Å“â€¦ | Progress tab: quizzes, focus, gym, language |
| 32 | Reflection Interviewer | Ã¢Å“â€¦ | Practice tab |
| 33 | Confidence Rehearsal | Ã¢Å“â€¦ | Practice tab, gets harder each level |
| 34 | Personal Knowledge Exams | Ã¢Å“â€¦ | Spaced repetition, due-today list |
| 35 | Routine Drift Detector | Ã¢Å“â€¦ | Think (uses your planner, gym and focus data) |
| 36 | Personal Challenge Generator | Ã¢Å“â€¦ | Think |
| 37 | Concept-to-Prototype Planner | Ã¢Å“â€¦ | Think |
| 38 | 3D Modeling Coach | Ã¢Å“â€¦ | Think |

## Ã°Å¸â€™â€º Personal companion skills
| # | Feature | Status | Notes |
|---|---|---|---|
| 17 | Contextual Recall | Ã¢Å“â€¦ | |
| 18 | Personal Ritual Designer | Ã¢Å“â€¦ | Think Ã¢â€ â€™ Design a routine |
| 19 | Social Rehearsal | Ã¢Å“â€¦ | Practice tab |
| 20 | Decision Journal | Ã¢Å“â€¦ | |
| 21 | Personal Archivist | Ã¢Å“â€¦ | Searches chats, journal, notes, study files and screenshots she looked at (Chat Ã¢â€ â€™ Screenshots) |
| 22 | Milestone Guardian | Ã¢Å“â€¦ | |
| 23 | Conversation Style Shifter | Ã¢Å“â€¦ | |
| 24 | Quiet Companion Mode | Ã¢Å“â€¦ | |
| 25 | Personalized Recommendations | Ã¢Å“â€¦ | Chat Ã¢â€ â€™ For you: movies, anime, books, food, placesÃ¢â‚¬Â¦ Ã°Å¸â€˜Â/Ã°Å¸â€˜Å½ teaches her |
| 26 | Digital Legacy Journal | Ã¢Å“â€¦ | |
| 50 | Emergency Information Guide | Ã¢Å“â€¦ | Tells you to call 911 first |

## Ã¢Å¾â€¢ Extra features you asked for in chat
Ã¢Å“â€¦ 3D cozy room (themes, furniture editor, day/night by your clock, brightness) Ã‚Â· Ã¢Å“â€¦ characters (Vermeil, Pip, Robo, your own GLB/VRM) Ã‚Â· Ã¢Å“â€¦ planner (calendar, tasks, reminders, birthdays, shopping, notes) Ã‚Â· Ã¢Å“â€¦ study (library, review sets, research, assignment help) Ã‚Â· Ã¢Å“â€¦ coding helper Ã‚Â· Ã¢Å“â€¦ gym mode (your routine, timer, editor, history, best reps, +2.5 kg upgrade, sessions) Ã‚Â· Ã¢Å“â€¦ journal & think Ã‚Â· Ã¢Å“â€¦ voice commands Ã‚Â· Ã¢Å“â€¦ top-left status pills Ã‚Â· Ã¢Å“â€¦ night theme with sounds and effects Ã‚Â· Ã¢Å“â€¦ Groq Ã¢â€ â€™ Ollama automatic switch Ã‚Â· Ã¢Å“â€¦ saved preferences Ã‚Â· Ã¢Å“â€¦ package cleanup script Ã‚Â· Ã¢Å“â€¦ smaller AI requests: only the tools that fit each message are sent (~1Ã¢â‚¬â€œ2k tokens instead of ~9k), so Groq lasts longer and the local AI isn't overloaded

## 🆕 3 Nov 2026: Turtle Island

Where: Games hub, between Adventure and Retro Games. Files: `ui/turtle/`, save in `skills/turtlesave.py`. Details and gaps: `ui/turtle/DEVLOG.md`.

| Feature | Where | What it does |
|---|---|---|
| 🌾 Farming | Tools 1 to 4 | Flat ground only. Five crop stages, a ! bubble when ripe, weeds, fertiliser, golden crops, tool tiers |
| 🌳 Orchards and greenhouses | Tools, Build | Fruit trees regrow; plots under glass grow in any season |
| 🚫 Water and cliffs | Everywhere | You and your companions can't enter water or walk up cliffs |
| 🌉 Drawbridge | South shore | Unlocks by mending the winch; lowers on chains when Willowmere moors |
| 🦕 Dinosaurs | Journal → Dinos | Ten lines, three forms; friendship levels; evolve by level and days together |
| 🧑‍🌾 Dinosaur work | Journal → Dinos | Off, Low, Medium or High per skill; they choose by priority, distance and energy |
| 🧭 Dinosaur abilities | Riding | Smash, chop, dig, climb, swim and fly open locked places |
| 🔨 Build mode | B | Same as Edit room without paint: categories, drag, turn, remove, undo |
| ⚙ Crafting | Build → Machines | Workbench and machines that work through game hours |
| 💰 Selling | Bin, stall, shops | Shipping bin, your own stall, regional weekly demand, festivals |
| ⛵ Boats and ferry | Dock, map | Mend and sail a boat, land anywhere, ferry to turtles you've visited |
| 🐢 Seven turtles | The ocean | Meadow, Golden plains, Desert, Frozen, Swamp, Tropical, Volcanic, plus The Elder, a hidden ancient turtle (and drifting isles after the story) |
| 🐟 Fishing | Tool 7 | 35 fish by season, hour and rain, five rods |
| 📜 Story | Journal → Story | Ten arcs, five carvings, ruins, an ending, then weekly orders |
| 💬 Vermeil | Follows you | Written lines that react to moments; no generated voice |
| 🧪 Test tools | Journal → Settings | Fly, shells, instant crops, days, weather, dinosaurs, teleport |
| 🧺 Asset packs | `ui/games/asset_packs` | 452 farm models split out with Blender, about 60 in the build menu |

| 🐢 The turtles' story | Journal → Story | Oma and Tarn, husband and wife, searching for their lost child Pell |
| 🦖 Living dinosaurs | Everywhere | Rigged models with jaws added in Blender; blink, yawn, wag; three truly different forms |
| 🤗 Touching | E beside a dinosaur | Pet, chin scratch, belly rub, play, feed, each with its own reaction |
| 🌍 Wild herds | Every turtle | Roam freely; tameable once unlocked; tamed ones go to your island |
| 🐦 Birds and pterosaurs | The sky | Fly between islands, rest in trees and on the ground |
| 🏘 Willowmere | Second turtle | Fountain, stalls, crowd, stalls to rent, Mara's market selling everything |
| 🚜 Driving | E beside a vehicle | Every vehicle drives, with turning wheels; work vehicles till, plant, water, harvest |
| 🌱 Crop models | Farm | The Nature Crops pack's real growth stages, plus new crops |
| 🌀 Moving world | Everywhere | Windmills, running machines, fountains, fires, animal legs, waves, foam, boat |
| 🧍 Poses | You | Sitting, kneeling, pouring and reaching on top of the pack's clips |
| 🎨 New interface | Everywhere | Animated loading screen, drawn tool icons, animated panels and rows |
| 🧪 Next stage | Test tools | Level up all dinos to the next stage only |

Limits: not played by hand start to finish; no control remapping, level-of-detail models, scored tournaments or aquarium yet; the two LowPoly Farm packs use stand-in colours; garden tools have no colour and aren't used.

## Ã°Å¸â€ â€¢ 31 Oct 2026: Fixes and a livelier Game Night

| Feature | Where | How |
|---|---|---|
| Ã°Å¸â€™Å“ Vermeil up close | Game Night, right side | Her 3D model: follows your mouse, blinks, talks, reacts to each game; click her |
| Ã°Å¸â€Å  Sounds and effects | Every Game Night game | Synth sounds, confetti, emoji bursts, shake on a mistake; Ã°Å¸â€Å  mutes |
| Ã°Å¸Å½Â® Adventure and Retro on their own | Games hub | Not in the Game Night library any more |
| Ã°Å¸ÂÆ’ GPS runs on the phone | Phone Ã¢â€ â€™ Ã°Å¸ÂÆ’ Run | Moved from the PC's Gym page |
| Ã°Å¸â€œÂ Formulas by course | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Formulas | AI groups lessons into courses (e.g. Engineering Economics) |
| Ã°Å¸â€œÅ¡ Citations | Study Ã¢â€ â€™ Research | Moved from My study |
| Ã°Å¸Â§Â¾ Fair review XP | Study Ã¢â€ â€™ Review | XP once a day per review, only for right answers |
| Ã¢â€ â€Ã¯Â¸Â Scrolling tab bars | Every page with tabs | One line with a scroll bar; one click is enough |
| Ã°Å¸Â¦Â´ Clear UniMate errors | Kitchen Ã¢â€ â€™ UniMate | Says why a model was skipped; stands up a lying model and tries again; no bones Ã¢â€ â€™ "Rig it first"; rigs over 70 bones slimmed automatically |

## Ã°Å¸â€ â€¢ 31 Oct 2026: Music, media and wrap-up round

| Feature | Where | How |
|---|---|---|
| Ã°Å¸Å½Â¤ Synced lyrics | Music Ã¢â€ â€™ Ã°Å¸Å½Â¤ Lyrics | LRCLIB (synced) or lyrics.ovh (words only); click a line to jump |
| Ã¢Å“Â¨ More like this | Music Ã¢â€ â€™ Ã¢Å“Â¨ More like this; Spotify card Ã¢â€ â€™ Ã¢Å“Â¨ | About 12 similar songs queued |
| Ã°Å¸Å’Ë† Music visualizer | Music Ã¢â€ â€™ Ã°Å¸Å’Ë† Visualizer | Bars on the room's Smart TV, lamps pulse to the tempo |
| Ã°Å¸Å½Â¬ Watchlist | Music Ã¢â€ â€™ Ã°Å¸Å½Â¬ Watchlist | Where to watch in your country, watched + stars, suggestions by genre |
| Ã°Å¸Å½Â¨ Album covers | Music Ã¢â€ â€™ a playlist Ã¢â€ â€™ Ã°Å¸Å½Â¨ Make a cover | 6 styles, the name written on it if you want |
| Ã°Å¸â€˜â€š What song is this? | Music Ã¢â€ â€™ Ã°Å¸â€˜â€š | Listens 8 s through the mic (needs `shazamio`) |
| Ã°Å¸Â§Â¹ Clean-up wizard | Settings Ã¢â€ â€™ General | Big files, old downloads, duplicates Ã¢â€ â€™ Recycle Bin, only what you tick |
| Ã°Å¸Å½Â Your year | Battle Pass Ã¢â€ â€™ Ã°Å¸Å½Â Your year | Year-in-review cards and a story view |
| Ã°Å¸Å½Â Surprise gift | Battle Pass | After a hard week: VCash, a note and a treat |

## Ã°Å¸â€ â€¢ 31 Oct 2026: Adventure round

| Feature | Where | How |
|---|---|---|
| Ã°Å¸ÂÂ·Ã¯Â¸Â Hero name over the log | Dungeon Adventure Ã¢â€ â€™ camp | Your name floats over your seat |
| Ã°Å¸â€™Â¾ 3 save slots | Dungeon Adventure Ã¢â€ â€™ start | Pick a slot for each adventure |
| Ã°Å¸Å’â„¢ Day and night | Dungeon Adventure | A clock; night monsters outside after dark |
| Ã°Å¸ÂÂº Pets and mounts | Dungeon Adventure Ã¢â€ â€™ after a win | Tame with food; gold/heal perks; ride for faster travel |
| Ã¢Å¡â€™Ã¯Â¸Â Crafting + appraisal | Dungeon Adventure Ã¢â€ â€™ blacksmith | One rarity up; stats roll inside a lowÃ¢â‚¬â€œhigh range, top rolls are boosted |
| Ã¢â„¢Å¸Ã¯Â¸Â Chess vs Vermeil | Games Ã¢â€ â€™ Game Night Ã¢â€ â€™ Chess | 3 levels |
| Ã°Å¸Æ’Â Color Clash and Go Fish | Game Night Ã¢â€ â€™ Cards | Uno-style call; she remembers your asks |
| Ã°Å¸â€¢Â¹ Retro games on the phone | Phone Ã¢â€ â€™ Ã°Å¸â€¢Â¹ Games | Save states synced with the PC |
| Ã¢Ââ€œ Trivia with categories | Game Night Ã¢â€ â€™ Trivia | AI questions; you both answer |
| Ã°Å¸Â¥Â Rhythm game | Game Night Ã¢â€ â€™ Rhythm | Your playlist songs, D F J K |
| Ã°Å¸Å¸Â© Words in several languages | Game Night Ã¢â€ â€™ Words | Five letters and hangman |
| Ã°Å¸Å½Â¨ Drawing game | Game Night Ã¢â€ â€™ Draw | She guesses yours, you guess hers |
| Ã°Å¸â€”Â£Ã¯Â¸Â More Talk live scenes | Study Ã¢â€ â€™ Language Ã¢â€ â€™ Ã°Å¸Å½â„¢ Talk live | 8 new everyday scenes |
| Ã°Å¸â€Â¢ Puzzle of the day | Game Night Ã¢â€ â€™ Puzzle of the day | Sudoku + nonogram, streak |
| Ã¢Å’Â¨Ã¯Â¸Â Typing with study words | Game Night Ã¢â€ â€™ Typing | Words from your cards |
| Ã°Å¸â€”ÂÃ¯Â¸Â Escape room | Game Night Ã¢â€ â€™ Escape room | Doors from your study topics |
| Ã°Å¸â€œÅ¡ Library | Game Night Ã¢â€ â€™ Library | Hours played and favourites |
| Ã°Å¸Ââ€  Weekly tournament | Game Night Ã¢â€ â€™ Tournament | Points all week, a trophy for the winner |

## Ã°Å¸â€ â€¢ 31 Oct 2026: Gym & health

| Feature | Where | How |
|---|---|---|
| Ã°Å¸â€˜Â¯ Exercise demo | Gym Ã¢â€ â€™ Workout Ã¢â€ â€™ Ã°Å¸â€˜Â¯ Demo | She does the move next to you; UniMate can make real gym clips (Ã°Å¸Ââ€¹ Gym exercises) |
| Ã°Å¸â€œË† Progressive overload | Gym Ã¢â€ â€™ Coach & PRs | Heavier only when every set hit the top reps |
| Ã°Å¸Â¥Â© Protein bar | Gym Ã¢â€ â€™ Calories | Today's protein vs your goal |
| Ã°Å¸â€ºâ€™ Grocery list with prices | Gym Ã¢â€ â€™ Sleep & health | A week of food from the meal plan; SM Supermarket (PH) or Walmart (US) prices |
| Ã°Å¸â€ºÅ’ Sleep goal | Gym Ã¢â€ â€™ Sleep & health, Focus Ã¢â€ â€™ My progress | Hours needed, sleep debt, make-up tips, wind-down reminder |
| Ã°Å¸Â§Â­ Coach plan that adapts | Gym Ã¢â€ â€™ Workout | Missed days Ã¢â€ â€™ catch-up lifts; long break Ã¢â€ â€™ comeback week |
| Ã°Å¸Ââ€  Personal records wall | Gym Ã¢â€ â€™ Coach & PRs | Best lifts with trophies |
| Ã°Å¸ÂÆ’ GPS runs | Phone Ã¢â€ â€™ Ã°Å¸ÂÆ’ Run | Distance, pace, steps and route (like Strava) |
| Ã°Å¸Â«â‚¬ Muscles this week | Gym Ã¢â€ â€™ Coach & PRs | Body map that fades over 7 days |
| Ã°Å¸â€™Å  Supplement reminders | Gym Ã¢â€ â€™ Sleep & health | Times, reminders and a "taken" button |

## Ã°Å¸â€ â€¢ 31 Oct 2026: Study round

| Feature | Where | How |
|---|---|---|
| Ã°Å¸â€œâ€¹ What to review today | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Today | Due reviews (spaced repetition), flashcards, mistakes and weak topics, with minutes |
| Ã°Å¸â€œÂ Practice exam report | Study Ã¢â€ â€™ Review (timed) | Score by file, grade, and what to study again |
| Ã°Å¸â€œÂ Formula sheet by subject | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Formulas | Hydrology, RCD, Steel... from that subject's files plus your handwritten notes |
| Ã°Å¸â€œÂ¸ Handwriting to notes | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Notes | Photo Ã¢â€ â€™ clean notes; the same topic is merged, not duplicated |
| Ã°Å¸Å½Â¬ Lecture chapters | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Chapters | Video lectures split into chapters with times |
| Ã°Å¸â€œâ€¢ Mistake notebook | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Mistakes | Every wrong answer saved with the right answer |
| Ã°Å¸Å½â€œ Grade tracker | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Grades | "What do I need on the final?" |
| Ã°Å¸â€”Â£ Pronunciation coach | Study Ã¢â€ â€™ Language Ã¢â€ â€™ Say it | How to say the words you got wrong |
| Ã°Å¸â€œÅ¡ Citation helper | Study Ã¢â€ â€™ Research | APA 7 / MLA 9 from a link or a book title |
| Ã¢Å“ÂÃ¯Â¸Â Essay coach | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Essay | Outline, then feedback on your draft |
| Ã°Å¸â€Å’ USB auto-import | Study Ã¢â€ â€™ Library (plug in a drive) | New files sorted by subject |
| Ã°Å¸Å½Â¯ Exam-week mode | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Exam week | Daily plan, bedtime reminder, lighter chat |
| Ã°Å¸â€™Â¡ Curiosity corner | Study Ã¢â€ â€™ My study | One fact a day about your subjects |

## Ã°Å¸â€ â€¢ 31 Oct 2026: Focus & planning

| Feature | Where | How |
|---|---|---|
| Ã°Å¸â€â€™ Hard lock | Focus Ã¢â€ â€™ Lock to Vermeil | No pause or skip. To stop early you type a long sentence (no pasting) |
| Ã°Å¸Å¡Â« Website blocking | Focus Ã¢â€ â€™ Lock to Vermeil | YouTube, TikTok and similar windows are hidden during work rounds; you can edit the list |
| Ã°Å¸â€â€¢ Mute all notifications | Focus Ã¢â€ â€™ Lock to Vermeil | Windows pop-ups are off while you focus and turned back on afterwards; her reminders wait for the break |
| Ã°Å¸Å’Â Her own browser | Focus Ã¢â€ â€™ Open inside, or say "search inside for Ã¢â‚¬Â¦" | Opens a window inside the app instead of Chrome |
| Ã°Å¸Â§Ëœ Break ideas | Focus breaks | Stretch, water, 20-20-20, box breathingÃ¢â‚¬Â¦ |
| Ã°Å¸â€œâ€¦ Week calendar | Focus Ã¢â€ â€™ Week | Drag tasks between days to change their deadline |
| Ã¢ÂÂ³ Countdowns | Focus session tab | Days left until each deadline or event |
| Ã°Å¸Å¸Â© Habit heatmap | Focus Ã¢â€ â€™ Habits | 12 weeks, one row per habit |
| Ã°Å¸Å’Â³ Goal tree | Focus Ã¢â€ â€™ Goals | Goal Ã¢â€ â€™ sub-goals Ã¢â€ â€™ steps, with progress bars |
| Ã¢ÂÂ±Ã¯Â¸Â Screen time | Focus Ã¢â€ â€™ Screen time | Minutes per app, today and this week (not counted while you're away) |
| Ã¢Å“Ë†Ã¯Â¸Â Travel planner | Focus Ã¢â€ â€™ Travel | Airfare, stays, and day-by-day commute Ã¢â€ â€™ spot Ã¢â€ â€™ food with fares; a 1Ã¢â‚¬â€œ5 price slider; swap or edit any stop |

## Ã°Å¸â€ â€¢ 31 Oct 2026: Vermeil's little life
| Feature | Status | Where |
|---|---|---|
| She remembers small things you mention and asks about them later | Ã¢Å“â€¦ | Chat / voice |
| Outfit changes by time of day, weather, season, holidays, birthday | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ Her little life |
| Wardrobe of saved outfits (hat, glasses, colour) | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ Her little life Ã¢â€ â€™ Ã°Å¸â€˜â€” Wardrobe |
| More idle moves | Ã¢Å“â€¦ | Room |
| Sleeps in bed late at night (can turn off) | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ Her little life |
| Birthday mode: confetti, party hat, greeting | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ Her little life Ã¢â€ â€™ Ã°Å¸Å½â€š |
| Reminders ring like a phone call (Answer / Snooze) | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ Her little life |
| Good-morning and good-night routines | Ã¢Å“â€¦ | Say "good morning" / "good night" |
| Holiday greetings once a year | Ã¢Å“â€¦ | App start |
| Mouth shapes follow the sounds (visemes) | Ã¢Å“â€¦ | Room |
| Double clap wakes her | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ My wake word |
| Voice tone matches the message | Ã¢Å“â€¦ (already) | Settings Ã¢â€ â€™ Voice Ã¢â€ â€™ Emotion |

## Ã°Å¸â€ â€¢ 31 Oct 2026: VCash shop and the living room
| Feature | Status | Where |
|---|---|---|
| VCash money (half of every XP) and a furniture shop with monthly themed sets | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸â€ºâ€™ Shop |
| Themed furniture: levitating moon chair, UFO light, jellyfish lamp, floating candles, dragon egg... (18 pieces) | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸â€ºâ€™ Shop |
| Photo frames: 6 styles Ãƒâ€” 3 sizes, pictures from your folder | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸â€“Â¼Ã¯Â¸Â Photo frames |
| Smart TV that plays YouTube or video links inside the app | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸â€“Â¥Ã¯Â¸Â Tech |
| Weather clock on the wall, click for the 5-day forecast | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸â€“Â¼Ã¯Â¸Â Wall decor |
| Rain, snow and storms on the window from the real weather | Ã¢Å“â€¦ | Big window |
| Focus plant that grows with focus and wilts when you skip | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸ÂªÂ´ Plants |
| Optional top-3 tasks board | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸â€“Â¼Ã¯Â¸Â Wall decor |
| Seasonal decorations that turn on by themselves | Ã¢Å“â€¦ | Room |
| Several saved room designs | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸â€™Â¾ Designs |
| Ambient sounds per room with a volume | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸â€Å  Sounds |
| Room achievements and loading-screen tips | Ã¢Å“â€¦ | Shop tab, start-up |
| Adventure companion uses the main-room voice pipeline | Ã¢Å“â€¦ | Adventure |

## Ã°Å¸â€ â€¢ 31 Oct 2026: Loading screen and gym room switch
| Feature | Status | Where |
|---|---|---|
| Full-screen loading screen with steps and a progress bar while she starts | Ã¢Å“â€¦ | App start |
| Switch between your room and the gym room while editing | Ã¢Å“â€¦ | Edit room Ã¢â€ â€™ Ã°Å¸Ââ€¹ Gym room / Ã°Å¸ÂÂ  My room |
| 500 numbered feature ideas to pick from | Ã°Å¸â€œÂ | FEATURE_IDEAS.md |

## Ã°Å¸â€ â€¢ 30 Oct 2026: Adventure camp and black-hole portal
| Feature | Status | Where |
|---|---|---|
| Two logs only: Vermeil on hers, the hero you pick sits on the other (only one at a time, no overlapping) | Ã¢Å“â€¦ | Adventure Ã¢â€ â€™ Start new campaign |
| The portal turns into a black hole and pulls in the camp, Vermeil and your hero (not the trees) | Ã¢Å“â€¦ | Adventure Ã¢â€ â€™ Open the portal |
| Summons stand beside you; groups of enemies are spread evenly | Ã¢Å“â€¦ | Adventure battles |
| "+N XP" over each fallen enemy, "+N gold" after the battle, with sounds | Ã¢Å“â€¦ | Adventure battles |
| Companion voice clone warmed up when the adventure starts or loads | Ã¢Å“â€¦ | Adventure voice |
| No painted eyes on any hero model | Ã¢Å“â€¦ | Adventure |

## Ã°Å¸â€ â€¢ 30 Oct 2026: Battle Pass round (study games, language trainers, gym coach, phone, backups)
| Feature | Status | Where |
|---|---|---|
| XP, levels, streak, 3 daily quests, badges, Battle Pass of room items / wallpapers / titles | Ã¢Å“â€¦ | Battle Pass (menu) |
| Habit tracker (Ã¢Ë†â€™/+, 7 days, streaks, by voice: "I drank water") | Ã¢Å“â€¦ | Battle Pass Ã¢â€ â€™ Habits |
| Spaced flashcards (Leitner boxes 1Ã¢â‚¬â€œ16 days) with combos | Ã¢Å“â€¦ | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Flashcards |
| Jump to the moment in a video lecture from a review question | Ã¢Å“â€¦ | Study Ã¢â€ â€™ Review / Play (Ã¢â€“Â¶ Watch where this was said) |
| Ask my library with file/page (and video time) sources | Ã¢Å“â€¦ | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Ask my library |
| Printable formula sheet | Ã¢Å“â€¦ | Study Ã¢â€ â€™ My study Ã¢â€ â€™ Formulas |
| 25-minute study timer, quiet work, spoken cheer at breaks, XP per block | Ã¢Å“â€¦ | Focus |
| Accent score per word (tap red words to hear them) | Ã¢Å“â€¦ | Study Ã¢â€ â€™ Language Ã¢â€ â€™ Pronunciation |
| Role-play scenes, shadowing, slow/normal speed, word bank (auto-saved, quizzed), weekly report | Ã¢Å“â€¦ | Study Ã¢â€ â€™ Language |
| Kana/kanji/alphabet writing trainer (shape check; very similar characters can pass) | Ã¢Å“â€¦ | Study Ã¢â€ â€™ Language Ã¢â€ â€™ Ã¢Å“Â Writing trainer |
| Make the animations: time left + Cancel | Ã¢Å“â€¦ | Characters Ã¢â€ â€™ Rig Ã¢â€ â€™ Animate |
| Lip-sync from her real voice (loudness every 50 ms) | Ã¢Å“â€¦ | the room, while she talks |
| Mood-based idle moves (needs clips like yawn, stretch, dance_sway on the model) | Ã¢Å“â€¦ | the room |
| Morning brief with a review question and habits | Ã¢Å“â€¦ | morning brief |
| Situation reminders ("when I get home", "before my 2 pm class") | Ã¢Å“â€¦ | Planner Ã¢â€ â€™ Reminders for a situation, or say it |
| Screen helper | Ã¢Å“â€¦ | Ã°Å¸â€“Â¥ next to Send |
| Focus lock: while you work every window except Vermeil (and an optional allow list) gets minimized | Ã¢Å“â€¦ | Focus Ã¢â€ â€™ Ã°Å¸â€â€™ Lock to Vermeil |
| Meal log from a photo (vision model estimate) | Ã¢Å“â€¦ | Gym Ã¢â€ â€™ Calories Ã¢â€ â€™ Ã°Å¸â€œÂ· |
| Rest-day and sleep suggestions | Ã¢Å“â€¦ | Gym Ã¢â€ â€™ Calories |
| Phone: offline flashcards, reminder notifications (while the app is open), send a file to the library | Ã¢Å“â€¦ | phone app Ã¢â€ â€™ Ã°Å¸Æ’Â Study |
| Update-available dot | Ã¢Å“â€¦ | Settings (menu) |
| Backup / restore in one .zip (no keys or sign-ins) | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ General Ã¢â€ â€™ Backup |

## Ã°Å¸â€ â€¢ 30 Oct 2026: Update, video lectures, USB, Talk live game
| Feature | Status | Where |
|---|---|---|
| Update Vermeil from GitHub with a loading bar, keeps your keys, settings, data and `dnd` | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ General Ã¢â€ â€™ Update |
| Video/audio lectures written down with times and used as reviewers | Ã¢Å“â€¦ | Study Ã¢â€ â€™ Library Ã¢â€ â€™ Add filesÃ¢â‚¬Â¦ / drag in (needs the Voice plugin) |
| USB drive / folder: lists all PDFs, slides, docs, photos and videos to add | Ã¢Å“â€¦ | Study Ã¢â€ â€™ Library Ã¢â€ â€™ Ã°Å¸â€Å’ USB drive Ã‚Â· Ã°Å¸â€œÂ FolderÃ¢â‚¬Â¦ (banner when plugged in) |
| Talk live game: points, combo, best, short fixes, only her next line | Ã¢Å“â€¦ | Study Ã¢â€ â€™ Language Ã¢â€ â€™ Ã°Å¸Å½â„¢ Talk live |
| Animate: buttons work once per press; a missing UniMate library reinstalls by itself | Ã¢Å“â€¦ | Characters Ã¢â€ â€™ Rig Ã¢â€ â€™ Animate |

## Ã°Å¸â€ â€¢ Batch 11 (22 Oct 2026)
| Feature | Status | Where |
|---|---|---|
| Music ducking: music and other apps get quieter while you give a command and while she answers, then come back | Ã¢Å“â€¦ | Automatic Ã‚Â· Settings Ã¢â€ â€™ General Ã¢â€ â€™ Behaviour to turn off |
| Adventure companion = the character chosen in the app (Pip, Robo, VermeilÃ¢â‚¬Â¦): name, model, voice and personality | Ã¢Å“â€¦ | Switch character, then start a **new** adventure |
| Gym Ã¢â€ â€™ Alternatives: exercises that can replace one, 0-5 Ã¢Ëœâ€¦ (5 = most used by big coaches, 0 = weakest swap), "Used by" Jeff Nippard, Mike Israetel, CBum, Jeremy Ethier, Athlean-X, Smart FitÃ¢â‚¬Â¦, "Use instead" swaps it in your routine | Ã¢Å“â€¦ | Gym Ã¢â€ â€™ Alternatives, or Ã¢â€¡â€ž on an exercise Ã‚Â· voice: "what can I do instead of bench press?" |
| Installer: one command packs the app into a zip for another PC (`python scripts/package_app.py`), INSTALL.bat sets it up | Ã¢Å“â€¦ | Never packs your env keys or login tokens |
| Settings Ã¢â€ â€™ Plugins: install only the features you want, uninstall to free space (shows MB used) | Ã¢Å“â€¦ | Opens by itself on the first start after installing |
| Robotics & Electronics assistant: fix old electronics, repurpose them, plan a robot start to finish, 16 formula calculators | Ã¢Å“â€¦ | Sidebar Ã¢â€ â€™ Electronics |
| Circuit Lab: Tinkercad-style simulator, 2D editor + 3D view, breadboards, Arduino Uno/Nano/Mega/Leonardo/Micro/Pro Mini + ESP32, LEDs, buttons, pots, sensors, motors, servos, L293D, multimeterÃ¢â‚¬Â¦; runs Arduino code; LEDs burn out, shorts warned; 9 examples; "Check my circuit" by Vermeil | Ã¢Å“â€¦ | Electronics Ã¢â€ â€™ Circuit Lab |
| Ollama inside the project folder, started/stopped by Vermeil | Ã¢Å“â€¦ | Run `scripts\setup_ollama.bat` once |
| **Vermeil Music** - your own Spotify-style app, no Spotify account: search (YouTube), your playlists (make, rename, reorder, delete), Liked Songs Ã¢â„¢Â¥, Recent, queue, now-playing bar with cover/seek, import a YouTube/YouTube Music playlist or a pasted song list, Playlist Lab (analyse + make a new playlist in its style). The real Spotify is switched off (Settings Ã¢â€ â€™ Sidebar can show it again) | Ã¢Å“â€¦ | Sidebar Ã¢â€ â€™ Music Ã‚Â· voice: "play my gym playlist", "shuffle my liked songs", "like this song", "add this song to my study playlist", "make a discover playlist from Gym Hype" |
| Spotify Playlist Lab: import any playlist (yours or a link), analyse it (genres, moods, energy, eras, top artists, explicit %, variety), then make a NEW playlist in its style (similar / discover / mix / chill / hype) right in your Spotify, or play it on YouTube | Ã¢Å“â€¦ | Spotify Ã¢â€ â€™ Playlist Lab Ã‚Â· voice: "analyse my gym playlist", "make a discover playlist from Geym". First time: Disconnect + Connect once (Spotify needs the "create playlists" permission) |

| Phone app (Android + iPhone) that works on mobile data too: chat, hands-free wake word, her PC voice, practice, switch characters | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ Ã°Å¸â€œÂ± Phone Ã¢â€ â€™ scan the QR Ã‚Â· Cloudflare tunnel (or Tailscale), secret key, lockout after wrong keys |
| "Hey Siri, Vermeil" (Siri Shortcut) and Android assistant setup | Ã¢Å“â€¦ | Phone app Ã¢â€ â€™ Settings Ã‚Â· Siri itself can't be replaced |
| iPhone app: wake word with the phone locked, her PC voice, "Hey Siri, ask Vermeil", Practice inside | Ã¢Å“â€¦ | `phone-ios/` Ã‚Â· install from a Mac (phone-ios/README.md) Ã‚Â· not tried on a real iPhone yet |
| Android app: wake word with the screen off, her PC voice, the phone's assistant button, Practice inside | Ã¢Å“â€¦ | `android/` Ã‚Â· APK from the android-app release page (GitHub builds it) Ã‚Â· not tried on a real phone yet |
| One-click install on Mac and Linux | Ã¢Å“â€¦ | INSTALL Mac.command / INSTALL Linux.sh Ã‚Â· not yet tried on a real Mac |
| One-click install on Windows from a GitHub download, Rig & animate (UniMate) included | Ã¢Å“â€¦ | INSTALL Windows.bat Ã‚Â· UniMate's libraries also install themselves from the Animate box |
| Low-end PC mode with automatic switching after scanning the machine (RAM, graphics card, battery) | Ã¢Å“â€¦ | Settings Ã¢â€ â€™ AI Ã¢â€ â€™ This computer Ã‚Â· voice: "low power mode", "full power", "scan my computer" |
| Share characters as a file (with or without the voice) and import a friend's | Ã¢Å“â€¦ | Characters Ã¢â€ â€™ Ã¢Å“Â Ã¢â€ â€™ Share Ã‚Â· Ã°Å¸â€œÂ¥ Import a character Ã‚Â· voice: "share this character" |
| Live language practice partner (spoken conversation, corrections, score) | Ã¢Å“â€¦ | Study Ã¢â€ â€™ Language Ã¢â€ â€™ Ã°Å¸Å½â„¢ Talk live Ã‚Â· phone Practice tab Ã‚Â· voice: "let's practice Japanese" |

## Limits worth knowing (honest)
- Phone: the web app can't listen while the phone is locked (the Android and iPhone apps can), and the PC must be on with Vermeil open. Siri can't be replaced - the Shortcut asks Vermeil for you.
- Circuit Lab runs a **subset** of Arduino C++ (no real compiler; integer division isn't truncated; only the Servo library). Its electrical model is simplified (good for learning, not for exact analog design).
- Exercise "Used by" lists come from those coaches' public videos/programs as I know them - not a complete or official list. Unknown exercises are answered by the AI and marked "AI suggestion".
- Gestures and "look at me" use the vision AI, so they're slower than face/object spotting and use Groq tokens.
- Online-only parts: Groq, music, web, news, prices, weather, email, Google Calendar, and voices for Japanese/Korean/Filipino.
- Google Calendar adding needs the one-time setup in Settings; the browser helper needs `pip install playwright`.
- Everything was tested with automated tests and fake devices; the first real run with your mic, camera and Google account is the real test. Ã‚Â· Ã¢Å“â€¦ Spotify (own panel: now playing with cover, controls, search, playlists, liked, recent, top; voice + AI control)

## Models and rigs (work on any model, nothing is per-model)
- **Scan**: names and tree shape sort every bone (body, hands, face, jaw, hair, cloth, tail, wings, helpers and animators' controls). The rigger says what it found, with a colour for each.
- **Simplify**: a copy with at most 100 bones that looks exactly the same. Rigs whose bones disagree at rest (game rips) are baked first.
- **Own animations** play untouched and keep their proper names; UniMate's are cleaned, walk the right way and keep their arms out of the body.
- **Faces**: sprite sheets in the textures are found from the picture itself, so the model blinks and talks with them. Talking uses shape keys, else the jaw bone, else mouth pictures, else a nod. No face in the files: it stays the plain model.
- **Body type Monster** with flying, hovering, floating, roaring and 12 more moves.
- **Hat** per character in Characters. **Close-up** measures the head and frames all of it.
- **Photo frames** take any picture type (jpg, jfif, png, psd, tiff, webp, heic...), and moving ones (.gif, animated .webp) move.
- **Floating video player**: a video playing when the Browser panel closes carries on in a small window you can drag and resize.
- **Installed games** finds games anywhere on the PC: Steam, Epic, GOG, Ubisoft, Riot, what Windows lists as installed, and folders called Games.
- **Retro games play inside the app**: no separate window, with restart, pause, save, load, speed and sound on a bar above the game.
- **Import**: a .glb, .fbx or .vrm, a .zip (zips inside zips) or a folder; an FBX too old for Blender uses the .dae beside it.
- **Bodies decide the moves**: shape finds the wings; wings and legs can walk or fly, wings alone fly, neither floats. Every monster move is made on load and is in Settings -> Test.
- **Texture faces** blink, talk and show moods like Vermeil's, and come before a rigged mouth.
- **Rigger**: Snap X, Y, Z (or press the key). **Characters**: Delete animated models.
- **Hovering**: any rigged body can hover (Characters -> Gets around by): upright, legs hanging, arms loose, its lowest point clear of the floor.
