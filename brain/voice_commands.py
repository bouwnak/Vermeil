"""voice_commands.py - what you can say to her, one group per sidebar feature (Settings -> Help lists them).

Every feature can be opened by voice ("open the gym", "show me my planner", "go to settings"): open_command()
answers those instantly, without waiting for the AI. The other sentences in SAY are done by the AI with its
tools, so you can word them your own way - the examples are just ideas.
"""
import re

# id = the sidebar's panel (data-panel in ui/index.html); plugin = the feature in brain/plugins.py (None: always there)
FEATURES = [
    {"id": "chat", "name": "Chat", "icon": "💬", "plugin": None, "words": ["chat", "conversation", "messages"],
     "say": [("open chat", "shows your conversation"),
             ("stop / be quiet", "she stops talking"),
             ("wave · dance · jump · spin · clap · bow", "she does it in her room"),
             ("look happy · look sad · look surprised", "her face changes"),
             ("whisper mode · storyteller mode · normal voice", "how she talks"),
             ("switch to Rick Sanchez", "another character takes over (or just say their name)")]},
    {"id": "planner", "name": "Planner", "icon": "🗓", "plugin": "planner",
     "words": ["planner", "calendar", "planner page"],   # not "schedule": "show my schedule" is answered out loud
     "say": [("open my planner", "shows the Planner"),
             ("what's on my schedule today?", "your day: events, reminders, tasks"),
             ("remind me at 8 to drink water", "adds a reminder"),
             ("add a task: finish the essay by Friday", "adds a task"),
             ("add dentist on Monday at 3 pm to my calendar", "adds an event"),
             ("add eggs and milk to my shopping list", "adds to the shopping list"),
             ("jot this down: call grandma", "adds a note"),
             ("when am I free tomorrow?", "finds free time"),
             ("good morning briefing", "weather, agenda and news")]},
    {"id": "study", "name": "Study", "icon": "📚", "plugin": "study", "words": ["study", "studies", "school", "homework", "flashcards"],
     "say": [("open study", "shows Study"),
             ("what should I review today?", "the cards that are due"),
             ("give me a Spanish lesson · quiz me in Japanese", "a short language lesson or quiz"),
             ("let's practice Japanese · talk to me in Korean", "a spoken conversation partner: she corrects you as you go"),
             ("stop practice", "ends it and gives you your score"),
             ("research black holes and compare sources", "looks it up on the web"),
             ("solve 2x + 5 = 13", "solves the maths step by step"),
             ("read the text in this picture", "reads text from an image")]},
    {"id": "gym", "name": "Gym", "icon": "🏋", "plugin": "gym", "words": ["gym", "workout", "training", "exercise"],
     "say": [("open the gym", "shows the Gym"),
             ("make me a push day plan", "a workout plan"),
             ("I did 3 sets of 10 squats at 60 kg", "logs your sets"),
             ("start a 90 second timer · pause the timer · skip rest", "the rest timer"),
             ("restart the workout", "starts the session again"),
             ("what can I do instead of bench press?", "other exercises for the same muscles")]},
    {"id": "adventure", "name": "Games", "icon": "🎮", "plugin": "adventure", "words": ["games", "game", "adventure", "retro games", "arcade"],
     "say": [("open games", "opens the Games hub (Adventure + retro games)")]},
    {"id": "electronics", "name": "Electronics", "icon": "🔌", "plugin": "electronics",
     "words": ["electronics", "electronics lab", "circuit lab", "circuits", "robotics", "robots"],
     "say": [("open electronics", "shows the Electronics lab"),
             ("what resistor do I need for a red LED on 5 volts?", "electronics maths"),
             ("how do I fix a phone that won't charge?", "repair help")]},
    {"id": "generator", "name": "Generator", "icon": "🎨", "plugin": "generator",
     "words": ["generator", "slides maker", "picture maker", "video maker"],
     "say": [("open the generator", "shows the Generator"),
             ("make slides about the water cycle", "makes a slide deck"),
             ("write a document about my trip", "makes a document")]},
    {"id": "kitchen", "name": "Cooking & Baking", "icon": "🍳", "plugin": "kitchen",
     "words": ["kitchen", "cooking", "baking", "recipes", "recipe", "cooking and baking"],
     "say": [("open the kitchen", "shows Cooking & Baking"),
             ("start a 10 minute timer", "a kitchen timer")]},
    {"id": "music", "name": "Music", "icon": "🎵", "plugin": "music", "words": ["music", "my music", "playlists", "songs", "music player"],
     "say": [("open music", "shows your music"),
             ("play some music · play Blinding Lights", "plays a song"),
             ("skip · pause the music · resume the music · stop the music", "controls the song"),
             ("play it again · i love this song", "replays it / adds it to favourites"),
             ("play something calm", "a playlist for your mood"),
             ("turn it up · set the volume to 40", "the volume")]},
    {"id": "spotify", "name": "Spotify", "icon": "🟢", "plugin": "spotify", "words": ["spotify"],
     "say": [("open spotify", "shows Spotify"),
             ("play my Discover Weekly on Spotify", "plays it on Spotify")]},
    {"id": "missions", "name": "Missions", "icon": "🎯", "plugin": "missions", "words": ["missions", "mission", "goals"],
     "say": [("open missions", "shows Missions"),
             ("start a mission: plan my birthday party", "she works on it step by step"),
             ("how's my mission going? · pause the mission", "checks or controls it")]},
    {"id": "focus", "name": "Focus & Progress", "icon": "⏱", "plugin": "focus", "words": ["focus", "progress", "focus and progress", "stats", "trends"],
     "say": [("open focus", "shows Focus & Progress"),
             ("start a 25 minute focus session", "a focus session"),
             ("how am I doing this week?", "your progress")]},
    {"id": "mind", "name": "Journal & Think", "icon": "💭", "plugin": "mind",
     "words": ["journal", "think", "journal and think", "ideas", "decisions", "mind"],
     "say": [("open my journal", "shows Journal & Think"),
             ("add to my journal: I decided to learn guitar", "saves it"),
             ("help me think: should I change schools?", "pros, cons and questions")]},
    {"id": "code", "name": "Code", "icon": "💻", "plugin": "code", "words": ["code", "coding", "coding helper", "programming"],
     "say": [("open code", "shows the Coding helper"),
             ("write a python script that renames my photos", "writes the code")]},
    {"id": "voice", "name": "Voice", "icon": "🎙", "plugin": None, "words": ["voice", "microphone", "mic", "listening"],
     "say": [("vermi", "the wake word: then say what you want"),
             ("stop listening · turn off the mic", "voice off (press Voice in the sidebar to turn it back on)")]},
    {"id": "camera", "name": "Camera", "icon": "📷", "plugin": None, "words": ["camera", "webcam", "vision"],
     "say": [("camera on · camera off", "she can see you (or not)"),
             ("what do you see? · how many fingers am I holding up?", "she looks through the camera"),
             ("look at my screen", "she explains what's on your screen")]},
    {"id": "characters", "name": "Characters", "icon": "🎭", "plugin": None, "words": ["characters", "character", "characters page"],
     "say": [("open characters", "shows Characters"),
             ("switch to Omniman", "changes who you talk to"),
             ("share this character", "saves her as one file to send to a friend"),
             ("import a character", "adds a character a friend sent you")]},
    {"id": "phone", "name": "Phone", "icon": "📱", "plugin": None, "words": ["phone", "phone app", "mobile"],
     "say": [("turn on phone access · connect my phone", "use her from your phone, at home or on mobile data"),
             ("show my phone link", "the link and QR code to open on your phone"),
             ("turn off phone access", "your phone can't reach her any more")]},
    {"id": "performance", "name": "This computer", "icon": "🐢", "plugin": None, "words": ["performance", "speed"],
     "say": [("low power mode on", "lighter voice and 3D for an old or slow laptop"),
             ("full power mode · automatic power mode", "back to full, or let her decide from the scan"),
             ("scan my computer", "checks this computer again and picks the best mode")]},
    {"id": "settings", "name": "Settings", "icon": "⚙", "plugin": None, "words": ["settings", "options", "preferences", "plugins"],
     "say": [("open settings", "shows Settings"),
             ("what can I say? · voice commands · help", "opens this list"),
             ("stop everything", "stops her voice, the music and the timers")]},
    {"id": "pc", "name": "Your PC", "icon": "🖥", "plugin": None, "words": [],
     "say": [("open Notepad · close Chrome", "opens or closes an app"),
             ("find my resume file", "searches your files"),
             ("what's the weather in Manila?", "the weather"),
             ("search the web for cheap flights", "a web search"),
             ("summarize this YouTube video", "sums up a video")]},
]
BY_ID = {f["id"]: f for f in FEATURES}

_OPEN = re.compile(r"^(?:open|show me|show|go to|take me to|bring up|pull up|let me see)\s+"      # not "start": "start music" plays
                   r"(?:up\s+)?(?:the\s+|my\s+|our\s+)?(.+?)(?:\s+(?:panel|tab|page|screen|menu|section|app))?$")
_HELP = re.compile(r"^(?:help|voice commands|commands|what can i (?:say|ask)|what can you do|"
                   r"(?:show|open|list)(?: me)?(?: the| my)? (?:voice )?(?:commands|help))$")
_MIC_OFF = re.compile(r"^(?:stop listening|turn off (?:the )?(?:mic|microphone|voice)|(?:mic|microphone|voice) off|mute (?:the )?mic)$")
_PARTNER_STOP = re.compile(r"^(?:stop|end|finish|quit) (?:the )?(?:language )?(?:practi[cs]e|practi[cs]ing|lesson|conversation partner)$")
_PARTNER = re.compile(r"^(?:let'?s |let us |can we |i want to |i'?d like to )?(?:start )?(?:practi[cs]e|talk|speak|chat|have a conversation)"
                      r"(?: (?:in|my))? ([a-z ()]+?)(?: with me| together| now| please)?$")
_PARTNER_PLAIN = re.compile(r"^(?:start |begin )?(?:a |the )?(?:language )?(?:practi[cs]e partner|conversation practi[cs]e|speaking practi[cs]e|language practi[cs]e)$")
_LOW = re.compile(r"^(?:turn on |switch to |use |go to )?(?:low|low power|low-power|low end|low-end|power saving|battery saver|eco) mode(?: on)?$|^save power$")
_FULL = re.compile(r"^(?:turn off (?:low|low power|low end|power saving) mode|(?:low|low power) mode off|(?:switch to |use )?(?:full power|full|normal|high) mode|(?:switch to |use |go )?full power)$")
_AUTO = re.compile(r"^(?:switch to |use |set )?(?:automatic|auto) (?:power |performance )?mode$")
_SCAN = re.compile(r"^(?:scan|check) (?:my |this )?(?:computer|pc|laptop|machine)(?: again)?$")
_PHONE_ON = re.compile(r"^(?:turn on|enable|start|open up) (?:the )?phone(?: access| app| link)?$|^phone (?:access )?on$|^connect (?:to )?my phone$")
_PHONE_OFF = re.compile(r"^(?:turn off|disable|stop) (?:the )?phone(?: access| app| link)?$|^phone (?:access )?off$|^disconnect my phone$")
_PHONE_LINK = re.compile(r"^(?:show|what'?s|what is|give me|open) (?:me )?(?:my |the )?phone (?:link|address|qr(?: code)?)$")
_SHARE = re.compile(r"^(?:share|export|save) (?:this|my|the current|her|him) character(?: as a file)?$|^share (?:her|him)$")
_IMPORT = re.compile(r"^(?:import|add|load) (?:a |the )?(?:shared |friend'?s )?character(?: file)?$")
_CAM = re.compile(r"^(?:(?:turn|switch) (on|off) (?:the )?(?:camera|webcam)|(?:camera|webcam) (on|off)|(?:open|start) (?:the )?(camera|webcam))$")


def find(name):
    """the feature a spoken name means ("the gym", "cooking", "my journal"), or None"""
    n = re.sub(r"[^a-z ]", "", (name or "").lower().replace("&", " and ")).strip()
    n = re.sub(r"^(?:the|my|our) ", "", n)
    for f in FEATURES:
        if n in f["words"] or n == f["name"].lower():
            return f
    return None


LANGUAGE_WORDS = {"japanese": "ja", "nihongo": "ja", "chinese": "zh", "mandarin": "zh", "korean": "ko", "spanish": "es",
                  "french": "fr", "german": "de", "italian": "it", "portuguese": "pt", "english": "en", "filipino": "tl",
                  "tagalog": "tl", "russian": "ru", "vietnamese": "vi", "thai": "th", "indonesian": "id", "bahasa": "id"}


def language_in(text):
    """the language code a sentence names ("let's practice Japanese" -> "ja"), or None"""
    for word in re.findall(r"[a-z]+", (text or "").lower()):
        if word in LANGUAGE_WORDS:
            return LANGUAGE_WORDS[word]
    return None


def parse(text):
    """(action, feature) for an instant command, else None. action: "help" | "mic_off" | "camera_on" | "camera_off" |
    "open" | "partner_start" | "partner_stop" | "power_low" | "power_full" | "power_auto" | "scan" | "phone_on" |
    "phone_off" | "phone_link" | "share_character" | "import_character" """
    t = (text or "").lower().strip(" .!?")
    if _PARTNER_STOP.match(t):
        return "partner_stop", BY_ID["study"]
    m = _PARTNER.match(t)
    if (m and language_in(m.group(1))) or _PARTNER_PLAIN.match(t):
        return "partner_start", BY_ID["study"]
    for rx, what, fid in ((_LOW, "power_low", "performance"), (_FULL, "power_full", "performance"),
                          (_AUTO, "power_auto", "performance"), (_SCAN, "scan", "performance"),
                          (_PHONE_ON, "phone_on", "phone"), (_PHONE_OFF, "phone_off", "phone"), (_PHONE_LINK, "phone_link", "phone"),
                          (_SHARE, "share_character", "characters"), (_IMPORT, "import_character", "characters")):
        if rx.match(t):
            return what, BY_ID[fid]
    if _HELP.match(t):
        return "help", BY_ID["settings"]
    if _MIC_OFF.match(t):
        return "mic_off", BY_ID["voice"]
    m = _CAM.match(t)
    if m:
        return ("camera_off" if (m.group(1) or m.group(2)) == "off" else "camera_on"), BY_ID["camera"]
    m = _OPEN.match(t)
    if m:
        f = find(m.group(1))
        if f and f["id"] not in ("pc", "performance", "phone"):
            if f["id"] == "camera":
                return "camera_on", f
            return "open", f
    return None


def catalogue(installed=lambda pid: True):
    """everything for Settings -> Help, with whether each feature is installed"""
    return [{"id": f["id"], "name": f["name"], "icon": f["icon"],
             "installed": f["plugin"] is None or installed(f["plugin"]),
             "say": [{"say": s, "does": d} for s, d in f["say"]]} for f in FEATURES]
