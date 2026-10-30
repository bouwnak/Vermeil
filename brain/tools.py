"""
tools.py - lets the AI use every feature in f1.py by itself.

The AI is told what each tool does (TOOLS). When it decides to use one, run_tool()
calls the matching f1 function and the result goes back to the AI, which then
answers you in character. Risky tools (shutdown, sending email, clearing a whole
list) always ask you to confirm first.
"""
import json
import re

import f1


def _fn(name, description, properties=None, required=None):
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties or {}, "required": required or []},
    }}


S = {"type": "string"}
DATE = {"type": "string", "description": "Date as YYYY-MM-DD (work it out from today's date)."}
TIME = {"type": "string", "description": "24-hour time as HH:MM, e.g. 17:30."}

TOOLS = [
    # calendar
    _fn("add_event", "Put an event/appointment on the user's calendar.",
        {"title": S, "date": DATE, "time": TIME, "end_time": TIME, "notes": S}, ["title", "date"]),
    _fn("list_events", "List calendar events, from a start date for a number of days.",
        {"start_date": DATE, "days": {"type": "integer", "description": "How many days to show (default 7)."}}),
    _fn("remove_event", "Delete a calendar event by (part of) its title, optionally on a date.",
        {"title": S, "date": DATE}, ["title"]),
    _fn("daily_agenda", "Today's agenda: events, reminders, tasks, schedule and birthdays."),
    # reminders
    _fn("add_reminder", "Set a reminder. The app alerts the user when it's due. Can repeat.",
        {"event": {"type": "string", "description": "What to remind about."},
         "date_time": {"type": "string", "description": "When (first time), as 'YYYY-MM-DD HH:MM'."},
         "repeat": {"type": "string", "enum": list(f1.REPEATS), "description": "Default none."}}, ["event", "date_time"]),
    _fn("get_reminders", "List the user's reminders."),
    _fn("add_smart_reminder", "A reminder for a situation instead of a clock time: 'when I get home / when I'm back' "
        "(on=home) or 'before my 2 pm class' (on=before, match='2 pm class').",
        {"event": {"type": "string", "description": "What to remind about."},
         "on": {"type": "string", "enum": ["home", "before"]},
         "match": {"type": "string", "description": "For on=before: the event/class name and/or its time."},
         "minutes": {"type": "integer", "description": "For on=before: how many minutes before (default 30)."}},
        ["event", "on"]),
    _fn("log_habit", "Tick one of the user's habits for today ('I drank water', 'I slept 8 hours', 'I read today').",
        {"habit": {"type": "string", "description": "What they did, in their words."},
         "count": {"type": "integer", "description": "How many (default 1), e.g. 2 glasses."}}, ["habit"]),
    _fn("remove_reminder", "Delete one reminder by its text.", {"event": S}, ["event"]),
    _fn("clear_reminders", "Delete ALL reminders."),
    # tasks
    _fn("add_task", "Add a to-do task.",
        {"task": S, "time": TIME, "priority": {"type": "string", "enum": ["low", "normal", "high"]}, "deadline": DATE},
        ["task"]),
    _fn("get_tasks", "List the to-do tasks (high priority first)."),
    _fn("complete_task", "Mark a task as done (or not done again).", {"task": S, "done": {"type": "boolean"}}, ["task"]),
    _fn("remove_task", "Delete a task completely.", {"task": S}, ["task"]),
    _fn("clear_tasks", "Delete ALL tasks."),
    # weekly schedule
    _fn("add_schedule", "Add a repeating weekly activity, e.g. gym every Monday.",
        {"day": {"type": "string", "description": "Weekday name like Monday."}, "activity": S, "time": TIME},
        ["day", "activity"]),
    _fn("get_schedule", "Show the weekly schedule."),
    _fn("remove_schedule", "Remove an activity from a weekday.", {"day": S, "activity": S}, ["day", "activity"]),
    _fn("clear_schedule", "Delete the WHOLE weekly schedule."),
    # notes
    _fn("add_note", "Save a note ('make a note', 'jot this down', 'write that down', 'remember this: ...').", {"note": S}, ["note"]),
    _fn("view_notes", "Read the saved notes."),
    _fn("remove_note", "Delete notes containing some text.", {"text": S}, ["text"]),
    _fn("clear_notes", "Delete ALL notes."),
    # birthdays
    _fn("add_birthday", "Remember someone's birthday.", {"name": S, "date": {"type": "string", "description": "e.g. 'March 5' or 2001-03-05"}},
        ["name", "date"]),
    _fn("get_birthdays", "List saved birthdays."),
    _fn("upcoming_birthdays", "Birthdays in the next 7 days."),
    # shopping
    _fn("add_shopping_items", "Add items to the shopping list.", {"items": {"type": "string", "description": "Comma-separated items."}},
        ["items"]),
    _fn("get_shopping_list", "Show the shopping list."),
    _fn("remove_shopping_item", "Remove one item from the shopping list.", {"item": S}, ["item"]),
    _fn("clear_shopping_list", "Empty the WHOLE shopping list."),
    # info
    _fn("get_weather", "Current weather for a city.", {"city": S}, ["city"]),
    _fn("solve_math", "Calculate or solve math, e.g. '12*8' or '2x+3=7'.", {"equation": S}, ["equation"]),
    _fn("web_search", "Open a Google search in the browser for the user.", {"query": S}, ["query"]),
    # studying
    _fn("search_my_files", "Search the user's own study files (lectures, problems, solutions) and return matching "
        "excerpts with file and page, so you can answer from their notes and cite them.", {"query": S}, ["query"]),
    _fn("research_web", "Search the internet and get a sourced answer (use for current facts, news, or anything you "
        "aren't sure about). Slow - only when needed.", {"question": S}, ["question"]),
    # journal & thinking
    _fn("add_journal", "Save a journal entry: a decision (what they chose and why), an idea to grow later, a goal "
        "with small steps, or a story/memory/lesson to keep.",
        {"kind": {"type": "string", "enum": ["decision", "idea", "goal", "story"]}, "title": S, "text": S,
         "steps": {"type": "array", "items": S, "description": "Milestones for a goal."},
         "review_in_days": {"type": "integer", "description": "For decisions: when to look back (default 30)."}},
        ["kind", "title"]),
    _fn("view_journal", "Read the journal (decisions, ideas, goals, stories).",
        {"kind": {"type": "string", "enum": ["decision", "idea", "goal", "story"]}}),
    _fn("update_journal", "Change a journal entry: write a decision's outcome, add a goal step, tick a step, mark done.",
        {"entry_id": S, "outcome": S, "status": {"type": "string", "enum": ["open", "done"]}, "add_step": S,
         "toggle_step": {"type": "integer", "description": "Index (0-based) of the step to tick/untick."}}, ["entry_id"]),
    _fn("recall", "Search everything the user said or saved before (past chats, journal, notes, study files). Use when they "
        "refer to an earlier conversation or ask 'what did I say about...'.", {"query": S}, ["query"]),
    # missions, our story, recommendations, screenshot archive
    _fn("start_mission", "Start a multi-step mission for a bigger goal that needs several steps or must continue over "
        "hours/days (e.g. 'research laptops under 50k and compare them', 'check this price every morning for a week'). "
        "The app plans it and works through it in the background.", {"goal": S}, ["goal"]),
    _fn("mission_status", "How the user's missions are going (progress, results)."),
    _fn("control_mission", "Pause, resume, run the next step now, skip a step, or cancel a mission.",
        {"mission": {"type": "string", "description": "Mission title or part of it."},
         "action": {"type": "string", "enum": ["pause", "resume", "run_now", "skip", "cancel"]}}, ["mission", "action"]),
    _fn("our_story", "Your shared history with the user: when you first talked, days together, streak, memorable moments."),
    _fn("remember_moment", "Save a meaningful moment to your shared story (big news, achievement, inside joke).",
        {"moment": {"type": "string", "description": "One warm sentence, e.g. 'You passed your thesis defense!'"}}, ["moment"]),
    _fn("recommend", "Personal recommendations based on what the user likes: movies, shows, anime, books, games, music, "
        "food, recipes, activities, places, youtube, podcasts.",
        {"category": S, "mood": {"type": "string", "description": "Optional mood/occasion."}}),
    _fn("find_screenshot", "Find a screenshot you looked at before (e.g. 'the error I showed you last week') and open it.",
        {"query": S}, ["query"]),
    _fn("think", "Deep thinking with a bigger model (slow): council = several expert views + a combined answer; "
        "what_if; simulate (a schedule/plan/budget); foresight; fusion (combine ideas); reverse (break down a "
        "success); patterns (find patterns in the user's own data); ritual (design a routine); grow (develop an idea); "
        "hypothesis (possible explanations + tests); contradiction (conflicts in their plans/notes/decisions); causal "
        "(cause vs correlation); blindspot (hidden assumptions/risks); evolve (improve a solution over rounds); "
        "feasibility (is a goal realistic); procrastination (tiny first step); habit (habit experiment); challenge "
        "(personal challenge); prototype (idea to prototype plan); modeling (Blender 3D coaching); drift (routines "
        "being missed).",
        {"mode": {"type": "string", "enum": ["council", "what_if", "simulate", "foresight", "fusion", "reverse",
                                             "patterns", "ritual", "grow", "hypothesis", "contradiction", "causal",
                                             "blindspot", "evolve", "feasibility", "procrastination", "habit",
                                             "challenge", "prototype", "modeling", "drift"]}, "question": S}, ["mode"]),
    # gym
    _fn("gym_plan", "Show a gym day's workout (exercises, sets, target reps, weight, progress tips). Default: the "
        "next day in their routine.", {"day": {"type": "integer", "description": "Routine day number 1-7."}}),
    _fn("gym_log_set", "Log one finished set at the gym.", {"exercise": S, "set_no": {"type": "integer"},
        "kg": {"type": "number"}, "reps": S}, ["exercise", "set_no"]),
    _fn("gym_history", "Recent workouts, streak and volume."),
    _fn("gym_timer", "Control the Gym panel timer: start (with seconds), pause, resume, restart, skip, or "
        "restart_workout (clear today's sets so the training starts fresh).",
        {"action": {"type": "string", "enum": ["start", "pause", "resume", "restart", "skip", "restart_workout"]},
         "seconds": {"type": "integer"}}, ["action"]),
    _fn("my_music", "The user's own music library in Vermeil Music (their playlists + Liked Songs, songs from YouTube): "
        "play / shuffle a playlist, like the song playing now, add_current (the playing song) to a playlist, create a playlist, "
        "list playlists, analyse a playlist (genres, moods, energy), make a NEW playlist in a playlist's style "
        "(style: similar, discover, mix, chill, hype).",
        {"action": {"type": "string", "enum": ["play", "shuffle", "like", "add_current", "create", "list", "analyse", "make"]},
         "playlist": S, "style": {"type": "string", "enum": ["similar", "discover", "mix", "chill", "hype"]}, "size": {"type": "integer"}},
        ["action"]),
    _fn("playlist_lab", "Spotify playlists: 'analyse' one (genres, moods, energy, eras, top artists) or 'make' a NEW playlist "
        "in its style (style: similar, discover = new artists, mix, chill, hype). playlist = its name or Spotify link.",
        {"action": {"type": "string", "enum": ["analyse", "make"]}, "playlist": S,
         "style": {"type": "string", "enum": ["similar", "discover", "mix", "chill", "hype"]}, "size": {"type": "integer"}},
        ["action", "playlist"]),
    _fn("exercise_alternatives", "Exercises that can replace a gym exercise (or every exercise for a muscle), rated 0-5 stars "
        "by how much well-known coaches use them, with who uses them (Jeff Nippard, Mike Israetel, Smart Fit...).",
        {"exercise": {"type": "string", "description": "e.g. 'bench press' or a muscle like 'chest'."}}, ["exercise"]),
    _fn("electronics_calc", "Electronics calculator: ohm (V,I,R,P - any two), led (Vs,Vf,I mA,n), divider (Vin,R1,R2,Vout), "
        "series_parallel (list), rc (R,C,Vs), timer555 (R1,R2,C), battery (mAh,mA,V), cap_energy (C,V), reactance (f,C,L), ac (Vrms|Vpeak), "
        "wire (length,awg,I,V), colors (value | bands), gear (rpm,torque,ratio,eff), wheel (rpm,d), power_budget (items,mAh). "
        "Values may use k/M/m/u/n, e.g. '4.7k'.",
        {"kind": {"type": "string"}, "values": {"type": "object"}}, ["kind", "values"]),
    _fn("electronics_help", "Robotics & electronics expert: fix old/broken electronics (repair), turn old devices into new projects "
        "(repurpose), plan a robot from start to finish (robot), or answer a question (general).",
        {"mode": {"type": "string", "enum": ["repair", "repurpose", "robot", "general"]}, "question": S}, ["mode", "question"]),
    _fn("switch_character", "Switch to another character (the one the user names).", {"name": S}, ["name"]),
    # computer
    _fn("open_app", "Open an app (anything in the Start menu or desktop) or a website URL.", {"name": S}, ["name"]),
    _fn("close_app", "Close an app.", {"name": S}, ["name"]),
    _fn("running_apps", "List the windows that are open right now."),
    _fn("read_clipboard", "Read the text the user copied (to summarise, explain, translate or fix it)."),
    _fn("look_at_screen", "Take a screenshot and look at it to answer a question about what's on the user's screen "
        "(an error, code, a page, a game).", {"question": S}, ["question"]),
    _fn("system_status", "CPU, RAM, GPU, disk space, temperatures, battery and the apps using the most memory."),
    _fn("recent_crashes", "App crashes/hangs from the last 2 days (to suggest fixes)."),
    _fn("media_control", "Control any app that's playing media (Spotify, YouTube...).",
        {"action": {"type": "string", "enum": ["play/pause", "next", "previous", "mute"]}}, ["action"]),
    _fn("type_text", "Type text into the active window for the user.", {"text": S}, ["text"]),
    _fn("press_keys", "Press a key or shortcut in the active window, e.g. 'ctrl+s', 'alt+tab', 'enter'.", {"keys": S}, ["keys"]),
    _fn("mouse_click", "Click the mouse at screen coordinates (use look_at_screen first to find them).",
        {"x": {"type": "integer"}, "y": {"type": "integer"}, "button": {"type": "string", "enum": ["left", "right"]},
         "double": {"type": "boolean"}}, ["x", "y"]),
    _fn("find_files", "Find files in Desktop, Documents, Downloads, Pictures, Videos and Music.",
        {"words": {"type": "string", "description": "Words in the file name."},
         "kind": {"type": "string", "description": "pdf, word, excel, powerpoint, image, video, music, code, zip, 3d"},
         "days": {"type": "integer", "description": "Only files changed in the last N days."}}),
    _fn("open_file", "Open a file or folder.", {"path": S}, ["path"]),
    _fn("move_file", "Move a file into a folder.", {"path": S, "to_folder": S}, ["path", "to_folder"]),
    _fn("rename_file", "Rename a file.", {"path": S, "new_name": S}, ["path", "new_name"]),
    _fn("make_folder", "Create a folder.", {"path": S}, ["path"]),
    _fn("save_macro", "Save a repeatable list of steps (tool calls) under a name, e.g. 'study mode' = open notes, "
        "play lofi, set volume 30.", {"name": S, "steps": {"type": "array", "items": {"type": "object", "properties": {
            "tool": S, "args": {"type": "object"}}, "required": ["tool"]}}}, ["name", "steps"]),
    _fn("run_macro", "Run a saved macro.", {"name": S}, ["name"]),
    _fn("list_macros", "List saved macros."),
    _fn("emergency_stop", "Stop everything running right now (speech, music, timers, macros, automation)."),
    # internet
    _fn("web_answer", "Search the web (several search engines + Wikipedia), read the pages, and answer with numbered "
        "sources: people, characters, facts, current info, how-tos. Use research_web instead for academic research.",
        {"question": {"type": "string", "description": "A COMPLETE standalone question with the real names from the "
                      "conversation, e.g. 'How old are Hiccup and Toothless in How to Train Your Dragon?' - never "
                      "'how old are them'."},
         "deep": {"type": "boolean", "description": "true when the user says search more / harder / again, or the "
                  "last search found nothing: tries many more searches and reads more pages."}}, ["question"]),
    _fn("summarize_url", "Read a web page or online PDF and summarise it.", {"url": S, "focus": S}, ["url"]),
    _fn("news_briefing", "Latest news headlines (for the user's saved topics, or one topic).", {"topic": S}),
    _fn("set_news_topics", "Save the topics the user wants news about.", {"topics": {"type": "array", "items": S}}, ["topics"]),
    _fn("youtube_search", "Find YouTube videos.", {"query": S}, ["query"]),
    _fn("youtube_summary", "Summarise a YouTube video from its captions.", {"url": S}, ["url"]),
    _fn("save_pdf", "Download a PDF from a link into the Study library and summarise it.", {"url": S}, ["url"]),
    _fn("track_price", "Watch a product's price from its web page; alerts when it drops or reaches the target.",
        {"url": S, "target": {"type": "number"}}, ["url"]),
    _fn("tracked_prices", "List the prices being tracked."),
    _fn("weather_forecast", "3-day forecast and weather alerts for a city.", {"city": S, "days": {"type": "integer"}}, ["city"]),
    _fn("set_home_city", "Remember the user's city (for weather in the morning briefing and alerts).", {"city": S}, ["city"]),
    # productivity
    _fn("inbox_summary", "Read and summarise the user's newest Gmail emails (read-only).",
        {"count": {"type": "integer"}, "unread_only": {"type": "boolean"}}),
    _fn("start_meeting_notes", "Start recording a meeting with the microphone to make notes.", {"title": S}),
    _fn("stop_meeting_notes", "Stop recording the meeting and make notes + action items."),
    _fn("find_free_time", "Free time slots on a day (between events, schedule and timed tasks).",
        {"date": {"type": "string", "description": "YYYY-MM-DD"}, "minutes": {"type": "integer"}}),
    _fn("schedule_in_free_time", "Put a task on the calendar in the first free slot.",
        {"title": S, "minutes": {"type": "integer"}, "date": S}, ["title"]),
    _fn("morning_briefing", "The day's briefing: weather, agenda, news, goals, gym day."),
    _fn("sync_google_calendar", "Copy events from the user's Google Calendar (secret iCal link) into the planner."),
    _fn("export_calendar", "Save the planner's events as a .ics file to import into Google Calendar."),
    _fn("edit_document", "Change one of the user's existing Word/text documents: fix grammar, rewrite a part, add a "
        "section, replace names... A backup copy is kept. 'document' can be a full path or just its name.",
        {"document": S, "instruction": {"type": "string", "description": "What to change, in the user's words."}},
        ["document", "instruction"]),
    _fn("read_document", "Read one of the user's Word/text documents (full path or name).", {"document": S}, ["document"]),
    # browser helper (a separate browser window she controls)
    _fn("browser_open", "Open a website in her own browser window to read it or use it (forms, clicking through pages). "
        "Returns the page text and a numbered list of links, buttons and form fields.", {"url": S}, ["url"]),
    _fn("browser_read", "Read the current page again (after it changed)."),
    _fn("browser_fill", "Type into form fields on the current page. Use the [numbers] or labels from the page list. "
        "Password, card, PIN and ID fields are never filled - the user types those.",
        {"fields": {"type": "object", "description": "e.g. {\"3\": \"Juan Dela Cruz\", \"Email\": \"me@x.com\"}"}}, ["fields"]),
    _fn("browser_click", "Click a link or button on the current page (number or label). Submitting/buying/sending asks the user first.",
        {"target": S}, ["target"]),
    _fn("browser_close", "Close her browser window."),
    _fn("create_code", "Build working code/projects for the user with the coding helper: apps, scripts, games, websites, "
        "bots, Roblox scripts, fixing their project... It writes the files, tests them and explains how to run them.",
        {"request": {"type": "string", "description": "What to build, with every detail the user gave (language, features)."}},
        ["request"]),
    _fn("compare_sources", "Read several websites on a question side by side: what they agree on, where they CONFLICT, "
        "which is more reliable, and the best answer. Use for 'compare sources', 'is this true?', 'sites say different things'.",
        {"question": S, "urls": {"type": "array", "items": S, "description": "Optional specific pages to compare."},
         "claim": {"type": "string", "description": "Optional: a statement to fact-check instead of a question."}}, ["question"]),
    _fn("create_document", "Write a Word document (or txt/md) and open it - reports, letters, notes, plans. Write the "
        "full content yourself in markdown (# headings, - bullets, **bold**).",
        {"title": S, "content": S, "kind": {"type": "string", "enum": ["docx", "txt", "md"]}}, ["title", "content"]),
    # study, language & focus
    _fn("study_due", "Study reviews that are due today (spaced repetition) and the user's weak topics."),
    _fn("language_lesson", "Teach a language lesson (Japanese, Chinese, Korean, Spanish, French...), including scripts "
        "like hiragana, kanji or hangul.", {"topic": S, "language": {"type": "string", "description": "ja, zh, ko, es, fr, de, it, pt, tl..."}},
        ["topic"]),
    _fn("language_quiz", "Make a vocabulary/grammar quiz or flashcards for a language (saved with spaced repetition).",
        {"topic": S, "language": S, "kind": {"type": "string", "enum": ["flashcards", "mcq", "fill_blanks"]}}, ["topic"]),
    _fn("start_focus", "Start a focus session (work/break rounds) on a task.",
        {"task": S, "work_minutes": {"type": "integer"}, "break_minutes": {"type": "integer"}, "rounds": {"type": "integer"}}, ["task"]),
    _fn("my_progress", "The user's progress over the last 2 weeks: quiz scores, focus time, gym, language practice, weak topics."),
    # living character & camera
    _fn("character_action", "Make the 3D character do something: an emote or a facial expression. Use it naturally, e.g. "
        "celebrate when the user shares good news, wave hello.",
        {"action": {"type": "string", "enum": ["wave", "dance", "jump", "spin", "nod", "shake", "bow", "celebrate", "think",
                                               "clap", "laugh", "shrug", "stretch", "yawn", "shy", "point",
                                               "happy", "sad", "surprised", "angry", "sleepy", "thinking"]}}, ["action"]),
    _fn("group_conversation", "Have two or more of the user's characters talk to each other about a topic (or role-play).",
        {"topic": S, "characters": {"type": "array", "items": S, "description": "Character names; empty = the first two."},
         "turns": {"type": "integer"}}, ["topic"]),
    _fn("read_text_in_image", "Read (OCR) the text in an image file on the user's computer, e.g. a photo of notes.",
        {"path": S}, ["path"]),
    _fn("objects_in_view", "Quick list of everyday things the camera sees right now (cup, phone, book, laptop...). "
        "Instant and offline; for details or reading text use the camera look instead."),
    _fn("check_gesture", "Look at the camera and see what hand gesture the user is making."),
    # music & volume
    _fn("play_music", "Play a song or artist ('play X', 'put on X', 'blast X'; if no song is named use 'something I like'). By default it plays RIGHT NOW (stops the current song). "
        "Use when='next' or 'later' only if the user says to queue it / play it after this one.",
        {"song": S, "when": {"type": "string", "enum": ["now", "next", "later"]}}, ["song"]),
    _fn("spotify", "Spotify actions. ALWAYS use play_playlist when the user says 'my ... playlist' or names one of their "
        "playlists (fuzzy names are fine, e.g. 'geym'); never make up a playlist. Also: play a playlist "
        "by name, play their liked songs, what's playing, like/save the current song, previous song, set Spotify volume, "
        "play a specific album/artist/playlist.",
        {"action": {"type": "string", "enum": ["play_playlist", "play_liked", "now_playing", "like", "previous",
                                               "volume", "play_album", "play_artist", "list_playlists"]},
         "name": {"type": "string", "description": "Playlist / album / artist name, or volume 0-100."}}, ["action"]),
    _fn("music_control", "Control music: stop, skip, pause, resume, replay (start the song again), shuffle, show "
        "queue, clear queue, 'play queued now' (jump to a song that's waiting in the queue), play the saved playlist, "
        "resume the saved queue, add the current song to favorites.",
        {"action": {"type": "string", "enum": ["stop", "skip", "pause", "resume", "replay", "shuffle", "queue", "play queued now",
                                               "clear queue", "playlist", "show playlist", "resume queue", "favorite"]}},
        ["action"]),
    _fn("music_seek", "Jump in the current song: '+30' forward, '-10' back, or a time like '1:20'.", {"to": S}, ["to"]),
    _fn("play_favorites", "Play the user's favorite songs."),
    _fn("play_mood_playlist", "Make a NEW playlist for a mood or activity (studying, gym, sad, chill...). NOT for the "
        "user's own saved playlists ('my gym playlist') - use the spotify tool with play_playlist for those.", {"mood": S}, ["mood"]),
    _fn("recommend_music", "Recommend songs from the user's listening history (and play them if asked).",
        {"play": {"type": "boolean"}}),
    _fn("find_song", "Identify a song from lyrics the user remembers or a description, and play it.",
        {"description": S, "play": {"type": "boolean"}}, ["description"]),
    _fn("set_volume", "Set the volume (Spotify's volume while Spotify is playing, otherwise the computer's).",
        {"percent": {"type": "integer", "minimum": 0, "maximum": 100}}, ["percent"]),
    # camera
    _fn("camera_on", "Turn on the camera so you can see the user."),
    _fn("camera_off", "Turn off the camera."),
    # messages & computer
    _fn("send_email", "Send an email from the user's Gmail. Write the full message yourself from what the user asked.",
        {"recipient": {"type": "string", "description": "Email address."}, "subject": S, "message": S},
        ["recipient", "message"]),
    _fn("system_control", "Shut down, restart or log off the computer.",
        {"command": {"type": "string", "enum": ["shutdown", "restart", "log off"]}}, ["command"]),
]


def _log_habit(habit, count=1):
    import habits
    hid = habits.find(habit)
    if not hid:
        return "There's no habit like that yet - add it in Battle Pass -> Habits."
    view, reached = habits.tick(hid, int(count or 1))
    try:
        import quest
        quest.award("habit", xp=15 if reached else 2)
    except Exception:  # noqa: BLE001
        pass
    return f"{view['icon']} {view['name']}: {view['today']}/{view['goal']} today" + (", goal reached!" if reached else ".") +         (f" Streak: {view['streak']} days." if view["streak"] else "")

# tool name -> (function, how to describe it when asking "are you sure?")
_ACTIONS = {
    "add_event": (lambda title, date, time=None, end_time=None, notes="": _add_event(title, date, time, end_time, notes), None),
    "list_events": (f1.list_events, None),
    "remove_event": (lambda title, date=None: _remove_event(title, date), None),
    "daily_agenda": (f1.daily_agenda, None),
    "add_reminder": (f1.add_reminder, None),
    "get_reminders": (f1.get_reminders, None),
    "add_smart_reminder": (lambda event, on="home", match="", minutes=30: __import__("smartremind").add(event, on, match, minutes), None),
    "log_habit": (lambda habit, count=1: _log_habit(habit, count), None),
    "remove_reminder": (f1.remove_reminder, None),
    "clear_reminders": (f1.clear_reminders, "delete all your reminders"),
    "add_task": (f1.add_task, None),
    "get_tasks": (f1.get_tasks, None),
    "remove_task": (f1.remove_task, None),
    "complete_task": (f1.complete_task, None),
    "search_my_files": (lambda query: __import__("academic").search_my_files(query), None),
    "research_web": (lambda question: _research_text(question), None),
    "clear_tasks": (f1.clear_tasks, "delete all your tasks"),
    "add_schedule": (f1.add_schedule, None),
    "get_schedule": (f1.get_schedule, None),
    "remove_schedule": (f1.remove_schedule, None),
    "clear_schedule": (f1.clear_schedule, "delete your whole weekly schedule"),
    "add_note": (lambda note: f1.manage_notes("add", note), None),
    "view_notes": (lambda: f1.manage_notes("view"), None),
    "remove_note": (lambda text: f1.manage_notes("remove", text), None),
    "clear_notes": (lambda: f1.manage_notes("clear"), "delete all your notes"),
    "add_birthday": (f1.add_birthday, None),
    "get_birthdays": (f1.get_birthdays, None),
    "upcoming_birthdays": (f1.check_upcoming_birthdays, None),
    "add_shopping_items": (f1.add_shopping_items, None),
    "get_shopping_list": (f1.get_shopping_list, None),
    "remove_shopping_item": (f1.remove_shopping_item, None),
    "clear_shopping_list": (f1.clear_shopping_list, "empty your whole shopping list"),
    "get_weather": (f1.get_weather, None),
    "solve_math": (f1.solve_math, None),
    "web_search": (f1.web_search, None),
    "play_music": (lambda song="", when="now": _app("play_something") if not song or re.fullmatch(r"(?i)\s*(something|anything|music|a song|some music|something i like)\s*", song) else f1.music_control("play", song, when or "now"), None),
    "music_control": (lambda action: f1.music_control(action), None),
    "spotify": (lambda action, name="": _spotify(action, name), None),
    "set_volume": (lambda percent: _app("set_volume", percent) if __import__("pinakamain").app_actions.get("set_volume") else f1.set_volume(percent), None),
    "camera_on": (f1.camera_on, None),
    "camera_off": (f1.camera_off, None),
    "send_email": (f1.send_email, "send this email"),
    "system_control": (f1.system_control, "{command} the computer"),
    "study_due": (lambda: _study_due(), None),
    "language_lesson": (lambda topic, language=None: __import__("sensei").lesson(language, topic)["lesson"], None),
    "language_quiz": (lambda topic, language=None, kind="flashcards": "Made '" + __import__("sensei").make_quiz(language, topic, kind)["title"]
                      + "' - it's in Study → Review.", None),
    "start_focus": (lambda task, work_minutes=25, break_minutes=5, rounds=4: _app("focus_start_ui", task, work_minutes, break_minutes, rounds), None),
    "my_progress": (lambda: __import__("focus").progress_text(), None),
    "music_seek": (lambda to: _music().seek(to), None),
    "play_favorites": (lambda: _music().play_favorites(), None),
    "play_mood_playlist": (lambda mood: _music().play_mood(mood), None),
    "recommend_music": (lambda play=False: _music().recommend(play=play), None),
    "find_song": (lambda description, play=True: _music().find_song(description, play), None),
    "character_action": (lambda action: _app("character_action", action), None),
    "group_conversation": (lambda topic, characters=None, turns=6: _app("group_chat", topic, characters, turns), None),
    "check_gesture": (lambda: _app("check_gesture"), None),
    "objects_in_view": (lambda: _app("objects_in_view"), None),
    "read_text_in_image": (lambda path: _ocr(path), None),
    "web_answer": (lambda question, deep=False: _web().web_answer_text(question, bool(deep)), None),
    "summarize_url": (lambda url, focus="": _web().summarize_url(url, focus), None),
    "news_briefing": (lambda topic=None: _web().news_text(topic), None),
    "set_news_topics": (lambda topics: _web().set_news_topics(topics), None),
    "youtube_search": (lambda query: _web().youtube_search_text(query), None),
    "youtube_summary": (lambda url: _web().youtube_summary(url), None),
    "save_pdf": (lambda url: _web().save_pdf(url), None),
    "track_price": (lambda url, target=None: _web().track_price(url, target), None),
    "tracked_prices": (lambda: _web().prices_text(), None),
    "weather_forecast": (lambda city, days=3: _web().forecast_text(city, days), None),
    "set_home_city": (lambda city: _prod().set_home_city(city), None),
    "inbox_summary": (lambda count=10, unread_only=True: _prod().inbox_summary(count, unread_only), None),
    "start_meeting_notes": (lambda title="": _app("meeting_on", title), None),
    "stop_meeting_notes": (lambda: _app("meeting_off"), None),
    "find_free_time": (lambda date=None, minutes=60: _prod().free_slots_text(date, minutes), None),
    "schedule_in_free_time": (lambda title, minutes=60, date=None: _prod().schedule_task(title, minutes, date), None),
    "morning_briefing": (lambda: _prod().morning_briefing(), None),
    "sync_google_calendar": (lambda: _prod().sync_ical(), None),
    "export_calendar": (lambda: _prod().export_ical(), None),
    "browser_open": (lambda url: __import__("browser").get().open(url), None),
    "browser_read": (lambda: __import__("browser").get().read(), None),
    "browser_fill": (lambda fields: __import__("browser").get().fill(fields), None),
    "browser_click": (lambda target, confirm=None: __import__("browser").get().click(target, confirm), None),
    "browser_close": (lambda: __import__("browser").close(), None),
    "create_code": (lambda request: _app("build_code", request), None),
    "compare_sources": (lambda question, urls=None, claim=None: _web().compare_sources_text(question, urls, claim), None),
    "edit_document": (lambda document, instruction: _prod().edit_document(document, instruction),
                      "change the document '{document}' ({instruction})"),
    "read_document": (lambda document: "\n".join(_prod().read_document(document)), None),
    "create_document": (lambda title, content, kind="docx": _prod().create_document(title, content, kind), None),
    "open_app": (lambda name: _pc().open_app(name), None),
    "close_app": (lambda name: _pc().close_app(name), "close {name}"),
    "running_apps": (lambda: "\n".join(_pc().running_apps()) or "No windows open.", None),
    "read_clipboard": (lambda: (_pc().clipboard_text() or "The clipboard is empty.")[:6000], None),
    "look_at_screen": (lambda question: _app("look_at_screen", question), None),
    "system_status": (lambda: _pc().stats_text(), None),
    "recent_crashes": (lambda: _pc().crashes_text(), None),
    "media_control": (lambda action: _pc().media_key(action), None),
    "type_text": (lambda text: _pc().type_text(text), "type this into the active window: \"{text}\""),
    "press_keys": (lambda keys: _pc().press_keys(keys), "press {keys}"),
    "mouse_click": (lambda x, y, button="left", double=False: _pc().mouse_click(x, y, button, double), "click the mouse at {x}, {y}"),
    "find_files": (lambda words="", kind="", days=None: _pc().find_files_text(words, kind, days), None),
    "open_file": (lambda path: _pc().open_path(path), None),
    "move_file": (lambda path, to_folder: _pc().move_file(path, to_folder), "move {path} to {to_folder}"),
    "rename_file": (lambda path, new_name: _pc().rename_file(path, new_name), "rename {path} to {new_name}"),
    "make_folder": (lambda path: _pc().make_folder(path), None),
    "save_macro": (lambda name, steps: _pc().save_macro(name, steps), None),
    "run_macro": (lambda name, confirm=None: _pc().run_macro(name, confirm), None),
    "list_macros": (lambda: _pc().list_macros(), None),
    "emergency_stop": (lambda: _pc().emergency_stop(), None),
    "gym_plan": (lambda day=None: _gym().plan_text(day), None),
    "gym_log_set": (lambda exercise, set_no, kg=None, reps=None: _gym().log_text(exercise, set_no, kg, reps), None),
    "gym_history": (lambda: _gym().history_text(), None),
    "gym_timer": (lambda action, seconds=None: _app("gym_command", action, seconds), None),
    "my_music": (lambda action, playlist="", style="similar", size=25: __import__("mymusic").voice(action, playlist, style, size), None),
    "playlist_lab": (lambda action, playlist, style="similar", size=25: __import__("playlist_lab").voice(action, playlist, style, size), None),
    "exercise_alternatives": (lambda exercise: _gym().alternatives_text(exercise), None),
    "electronics_calc": (lambda kind, values: __import__("electronics").calc_text(kind, values or {}), None),
    "electronics_help": (lambda mode, question: (lambda r: r.get("answer") or r.get("error"))(__import__("electronics").ask(mode, question)), None),
    "switch_character": (lambda name: _app("switch_character", name), None),
    "add_journal": (lambda **a: _mind().add_journal(**a), None),
    "view_journal": (lambda kind=None: _mind().journal_text(kind), None),
    "update_journal": (lambda entry_id, **a: _mind().update_journal(entry_id, **a), None),
    "start_mission": (lambda goal: _mission_start(goal), None),
    "mission_status": (lambda: __import__("missions").status_text(), None),
    "control_mission": (lambda mission, action: _mission_control(mission, action), None),
    "our_story": (lambda: __import__("relationship").text(), None),
    "remember_moment": (lambda moment: (__import__("relationship").add_moment(moment), "Saved to our story.")[1], None),
    "recommend": (lambda category="anything", mood="": _mind().recommend_text(category or "anything", mood or "", _prefs()), None),
    "find_screenshot": (lambda query: _find_screen(query), None),
    "recall": (lambda query: _mind().recall_text(query), None),
    "think": (lambda mode, question="": _mind().think_text(mode, question), None),
}


def _gym():
    import gym
    return gym


def _emit(event):
    import pinakamain
    pinakamain.emit(event.pop("type"), **event)


def _ocr(path):
    import academic, pc
    p = pc._safe_path(path) if hasattr(pc, "_safe_path") else path
    return academic.read_image_text(p) or "I couldn't find any text in that image."


def _app(name, *args):
    import pinakamain
    fn = pinakamain.app_actions.get(name)
    return fn(*args) if fn else "That only works while the app window is open."


def _study_due():
    import academic
    due = academic.due_reviews()
    weak = academic.weak_topics()
    return ((f"Due today: {', '.join(r['title'] for r in due)}." if due else "No reviews due today.") +
            (f" Weak topics: {', '.join(w['topic'] + ' (' + str(w['pct']) + '%)' for w in weak[:6])}." if weak else ""))


def _music():
    import music
    return music


def _web():
    import web
    return web


def _prod():
    import productivity
    return productivity


def _pc():
    import pc
    return pc


def _add_event(title, date, time=None, end_time=None, notes=""):
    """Add to the planner, and to the real Google Calendar too when it's connected."""
    result = f1.add_event(title, date, time, end_time, notes)
    if not result.startswith("Added"):
        return result
    try:
        import gcal
        if gcal.connected():
            gid, _link = gcal.add_event(title.strip(), date, time, end_time, notes)
            ev = next((e for e in reversed(f1.user_data["events"]) if e["title"] == title.strip() and e["date"] == date), None)
            if ev is not None:
                ev["google_id"] = gid
                f1.save_data(f1.user_data)
            result += " Also added to your Google Calendar."
    except Exception as e:
        result += f" (Couldn't add it to Google Calendar: {e})"
    return result


def _remove_event(title, date=None):
    before = [e for e in f1.user_data["events"] if e.get("google_id")]
    result = f1.remove_event(title, date)
    gone = [e for e in before if e not in f1.user_data["events"]]
    if gone:
        try:
            import gcal
            for e in gone:
                gcal.delete_event(e["google_id"])
            result += " Removed from Google Calendar too."
        except Exception as e:
            result += f" (Couldn't remove it from Google Calendar: {e})"
    return result


def _spotify(action, name=""):
    import spotify
    try:
        return {"play_playlist": lambda: spotify.play_playlist(name), "play_liked": spotify.play_liked,
                "now_playing": spotify.now_text, "like": spotify.like_current, "previous": spotify.previous_track,
                "volume": lambda: spotify.set_volume(int(re.sub(r"\D", "", str(name)) or 50)),
                "play_album": lambda: spotify.play(name, "album"), "play_artist": lambda: spotify.play(name, "artist"),
                "list_playlists": lambda: "Your playlists: " + ", ".join(p["name"] for p in spotify.playlists()[:25]),
                }.get(action, lambda: "Unknown Spotify action.")()
    except spotify.SpotifyError as e:
        return str(e)


def _prefs():
    import pinakamain
    return pinakamain.shared_preferences()


def _mission_start(goal):
    import missions
    m = missions.create(goal)
    steps = "; ".join(f"{i + 1}. {x['text']}" for i, x in enumerate(m["steps"]))
    return f"Mission '{m['title']}' started with {len(m['steps'])} steps: {steps}. It runs in the background (Missions panel)."


def _mission_control(name, action):
    import missions
    m = missions.find(name)
    if not m:
        return "I couldn't find that mission."
    fn = {"pause": missions.pause, "resume": missions.resume, "run_now": missions.run_now,
          "skip": missions.skip_step, "cancel": missions.cancel}.get(action)
    if not fn:
        return "Unknown action."
    fn(m["id"])
    return f"{action.replace('_', ' ').title()}: {m['title']}."


def _find_screen(query):
    import mind
    hits = mind.find_screens(query)
    if not hits:
        return "I don't have a screenshot like that saved."
    try:
        import pc
        pc.open_path(mind.screen_path(hits[0]["file"]))
    except Exception:
        pass
    return "\n".join(f"{h['date']} ({h['file']}): {h['text'][:250]}" for h in hits) + "\n(Opened the best match.)"


def _mind():
    import mind
    return mind


def _research_text(question):
    import academic
    r = academic.research(question)
    src = "\n".join(s["apa"] for s in r["sources"])
    return r["answer"] + (f"\n\nReferences (APA 7th edition):\n{src}" if src else "")


def run_tool(name, arguments, confirm=None):
    """Run one tool the AI asked for. `confirm(question) -> bool` is used for risky tools."""
    if name not in _ACTIONS:
        return f"Unknown tool {name}."
    fn, risky = _ACTIONS[name]
    try:
        args = json.loads(arguments) if isinstance(arguments, str) and arguments.strip() else (arguments or {})
        if not isinstance(args, dict):
            args = {}
    except json.JSONDecodeError:
        return "The tool arguments were not valid JSON."
    if risky:
        question = risky.format(**args) if "{" in risky else risky
        if name == "send_email":
            question = f"send an email to {args.get('recipient')} saying: \"{args.get('message', '')[:200]}\""
        if confirm is None or not confirm(question):
            return "The user said no, so nothing was done."
    if name in ("run_macro", "browser_click"):
        args["confirm"] = confirm                      # each risky step still asks
    try:
        result = fn(**args)
    except TypeError as e:
        return f"Wrong arguments for {name}: {e}"
    except ModuleNotFoundError as e:
        import plugins
        p = next((q for q in plugins.PLUGINS if any(c.endswith(f"/{e.name}.py") for c in q.get("code", []))), None)
        return f"{p['name'] if p else e.name} isn't installed - install it in Settings → Plugins first."
    except Exception as e:
        return f"{name} failed: {e}"
    return str(result) if result is not None else "Done."


# ====================================================================== sending only the tools that fit
# All 120 tool descriptions are ~9,000 tokens - more than the local AI can even read, and it uses up Groq's
# per-minute allowance fast. So each message gets a small core set + the groups its words point to, and the
# AI can ask for more with more_tools(...) if it needs something that wasn't included.
import re as _re

CORE = ["add_event", "list_events", "daily_agenda", "add_reminder", "get_reminders", "add_task", "get_tasks",
        "add_note", "web_answer", "recall", "play_music", "music_control", "get_weather", "more_tools"]
GROUPS = [
    (r"calendar|event|meeting|appointment|schedule|routine|class(es)?\b|tomorrow|today|tonight|week|monday|tuesday|"
     r"wednesday|thursday|friday|saturday|sunday|deadline|remind|task|to-?do|birthday|note|shopping|grocer|free time|"
     r"agenda|busy|plan\b|google|when i get home|when i'?m back|before my|habit|water|drank|slept|i read", [
        "add_smart_reminder", "log_habit", "remove_event", "remove_reminder", "clear_reminders", "complete_task", "remove_task", "clear_tasks", "add_schedule",
        "get_schedule", "remove_schedule", "clear_schedule", "view_notes", "remove_note", "clear_notes", "add_birthday",
        "get_birthdays", "upcoming_birthdays", "add_shopping_items", "get_shopping_list", "remove_shopping_item",
        "clear_shopping_list", "find_free_time", "schedule_in_free_time", "sync_google_calendar", "export_calendar",
        "morning_briefing"]),
    (r"search|look up|google|news|website|\bsite\b|link|https?://|www\.|\.com|url|youtube|video|price|cost|cheap|"
     r"pdf|source|is (it|this|that) true|fact|compare|article|weather|forecast|rain|typhoon|storm", [
        "web_search", "summarize_url", "news_briefing", "set_news_topics", "youtube_search", "youtube_summary", "save_pdf",
        "track_price", "tracked_prices", "weather_forecast", "set_home_city", "compare_sources", "research_web", "browser_open"]),
    (r"form|fill|sign ?up|register|click|page|browser|website|\bbook\b|order|apply|login|log in", [
        "browser_open", "browser_read", "browser_fill", "browser_click", "browser_close"]),
    (r"\bopen\b|close|\bapps?\b|program|window|screen|clipboard|copied|paste|\btype\b|press|mouse|keyboard|\bfiles?\b|"
     r"folder|move|rename|cpu|\bram\b|gpu|temperature|\bpc\b|computer|laptop|crash|macro|volume|mute|shut ?down|"
     r"restart|\block\b|sleep mode|stop everything", [
        "open_app", "close_app", "running_apps", "read_clipboard", "look_at_screen", "system_status", "recent_crashes",
        "media_control", "type_text", "press_keys", "mouse_click", "find_files", "open_file", "move_file", "rename_file",
        "make_folder", "save_macro", "run_macro", "list_macros", "emergency_stop", "set_volume", "system_control"]),
    (r"document|\bword\b|docx|essay|report|letter|write|edit|rewrite|fix|grammar|thesis|chapter|resume|paragraph", [
        "create_document", "edit_document", "read_document", "search_my_files", "find_files"]),
    (r"stud(y|ying)|exam|quiz|review|flashcard|lecture|research|paper|journal article|cite|citation|apa|thesis|learn|"
     r"language|spanish|japanese|korean|french|lesson|sensei|progress|focus|pomodoro|homework|assignment", [
        "study_due", "language_lesson", "language_quiz", "start_focus", "my_progress", "research_web", "search_my_files",
        "solve_math"]),
    (r"\d\s*[-+*/^=x×÷]\s*\d|solve|equation|calculat|math|integral|derivative|percent", ["solve_math"]),
    (r"journal|decision|decide|idea|goal|story|think|council|what if|simulat|pattern|habit|procrastinat|routine|"
     r"challenge|brainstorm|remember when|last time|moment|milestone|together|our story|first met", [
        "add_journal", "view_journal", "update_journal", "think", "our_story", "remember_moment"]),
    (r"mission|every (day|morning|night)|for a week|step by step|in the background|keep (checking|track)|and then|"
     r"research .{3,40} and |compare .{3,40} and ", ["start_mission", "mission_status", "control_mission"]),
    (r"gym|workout|\bsets?\b|reps|\bkg\b|bench|squat|deadlift|\brest\b|timer|exercise|lift|cardio", [
        "gym_plan", "gym_log_set", "gym_history", "gym_timer", "exercise_alternatives"]),
    (r"alternative|instead of|replace|swap|substitut", ["exercise_alternatives"]),
    (r"resistor|\bled\b|voltage|volts?\b|current|ohm|capacitor|circuit|arduino|esp32|breadboard|solder|electronic|robot|motor|"
     r"servo|sensor|battery|transistor|mosfet|\b555\b|multimeter|repair|broken|fix (my|the|an?) |repurpose|salvage|wiring",
     ["electronics_calc", "electronics_help"]),
    (r"song|music|\bplay\b|playlist|favou?rite|skip|next|lyrics|artist|album|mood|vibe|volume|spotify|liked|previous", [
        "my_music", "spotify", "playlist_lab",
        "music_seek", "play_favorites", "play_mood_playlist", "recommend_music", "find_song", "set_volume"]),
    (r"camera|\bsee\b|look|holding|wearing|gesture|dance|wave|bow|jump|spin|character|switch|each other|group|pip\b|"
     r"robo\b|image|photo|picture|read (this|the|that) text|in front of", [
        "switch_character", "character_action", "group_conversation", "read_text_in_image", "objects_in_view",
        "check_gesture", "camera_on", "camera_off", "look_at_screen"]),
    (r"e-?mail|\bmail\b|inbox|gmail|send", ["inbox_summary", "send_email"]),
    (r"meeting|record|transcri|minutes", ["start_meeting_notes", "stop_meeting_notes"]),
    (r"recommend|suggest|what should i (watch|read|eat|play|listen)|bored|movie|anime|\bbooks?\b|\bshows?\b|"
     r"\bgames?\b|food|\beat\b|restaurant", ["recommend", "recommend_music"]),
    (r"screenshot|that error|showed you|on my screen", ["find_screenshot", "look_at_screen"]),
    (r"\bcode\b|coding|script|program|\bapp\b|website|web ?page|\bgame\b|\bbot\b|python|javascript|\bhtml\b|"
     r"roblox|luau|calculator|build me|make me|create (a|an|me)|write (a|an|me) (program|script|function)", ["create_code"]),
]
MAX_PICK = 34

TOOLS.append(_fn("more_tools", "Get more tools when the ones you have don't fit the request (e.g. browser, files, gym, "
                               "study, missions, email). Describe what you need to do.", {"need": S}, ["need"]))
_ACTIONS["more_tools"] = (lambda need: "Ok - matching tools were added; use them now.", None)
_BY_NAME = {t["function"]["name"]: t for t in TOOLS}


def pick(text, context="", limit=MAX_PICK):
    """The tools for this message: core + every group its words (or the last message) point to.
    If several groups match, they take turns, so no group is cut off completely."""
    words = f"{text or ''} {context or ''}".lower()
    names = list(CORE)
    matched = [list(group) for pattern, group in GROUPS if _re.search(pattern, words)]
    while matched and len(names) < limit:
        for group in matched:
            while group and group[0] in names:
                group.pop(0)
            if group and len(names) < limit:
                names.append(group.pop(0))
        matched = [g for g in matched if g]
    if "more_tools" not in names:
        names.append("more_tools")
    return [_BY_NAME[n] for n in names if n in _BY_NAME]


def more(need, have=()):
    """Tools matching a description (for more_tools), not already given."""
    need_l = (need or "").lower()
    found = [t for t in pick(need_l, limit=200) if t["function"]["name"] not in CORE]
    if len(found) < 3:                                   # fall back to plain word matching on the descriptions
        words = set(_re.findall(r"[a-z]{3,}", need_l))
        scored = sorted(TOOLS, key=lambda t: -len(words & set(_re.findall(r"[a-z]{3,}", (t["function"]["name"].replace("_", " ") + " " + t["function"]["description"]).lower()))))
        found += scored[:8]
    out, seen = [], set(have)
    for t in found:
        n = t["function"]["name"]
        if n not in seen:
            seen.add(n)
            out.append(t)
    return out[:16]
