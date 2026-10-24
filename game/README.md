# Vermeil — AI Dungeon Adventure

A 3D fantasy adventure that runs inside the Vermeil assistant. You step through a portal, make a hero,
and explore a procedurally generated world with Vermeil as your companion. An AI Dungeon Master narrates
the story, but every roll, every point of damage and every reward is decided by the game's own rules.

## How to play (beginner version)

1. Start Vermeil the usual way (`python app.py`).
2. Open the left sidebar and click **Adventure**.
3. Click **New adventure**, watch the portal open (or press *Skip*), then pick a species, class, name and
   world genre. Vermeil's settings (how independent she is, how chatty, random look) are on the same screen.
4. Walk with **WASD** or by clicking the ground. Drag with the right mouse button to turn the camera,
   scroll to zoom.
5. Type anything into the action box ("I search the old well", "I ask the smith about the knight") or use
   the quick buttons above it. The Dungeon Master answers and the dice tray shows every roll.
6. Walk into a monster (or press *Fight*) to start a turn-based battle. On your turn pick an ability, an
   item, or type a free action. The highlighted portrait at the top shows whose turn it is.
7. Level up, pick upgrade cards, collect loot, recruit allies, and reach the final boss at the end of the
   main quest. The results screen lets you export a summary of your run.

**Newest update: bigger, fuller worlds from the whole library**
- **All 72 packs are in the game** (3,355 models). Every biome now draws from many packs at once, and each place
  picks its own mix of models (so two forests don't look the same).
- **50 set pieces**: little scenes placed around the world, such as campsites, crop fields, orchards, farmsteads,
  woodcutters, old mines, market rows, forge yards, tavern tables, fishing docks, shipwrecks, ruined shrines, fairy rings,
  bamboo groves, crash sites, supply depots, bus stops, torii gates, tea stalls, coin trails, block towers, parlours,
  libraries and dining halls.
- **7 new biomes**: Golden Farmlands, Harbor Town, Sakura Valley, Sky Islands (the platformer packs), Blocklands
  (Cube World), Haunted Manor (house interior and furniture packs) and Frontier Outpost (toon shooter and sci-fi kits).
  Each has its own music, ambience and particles (petals, sparkles).
- Places have about 1.5 to 4 times more things in them: groves, flower patches, giant old trees and boulders, and
  fallen logs.
- **Real monster sizes**: rats are knee-high, a T-rex is 5 m, and a Brontosaur is 7 m. Every monster varies a little,
  and about 1 in 12 is a big **Alpha** (tougher, more XP). Bosses are as big as a house (6 to 9.5 m), for example
  *Grukk the Ogre Warlord*. Battles spread out and the camera pulls back for big monsters.
- **24 new enemies and 4 new bosses** use models that were never used before: mimics, eye drones, xeno horrors, mech
  pilots, war tanks, blocky mobs, pandas, penguins, Alpakings, Brontosaurs, Ul'thoth the Elder Horror, the Block
  Colossus, the Alpaking Sovereign and Overlord Mk-IV. The "Rock Golem" is now called Goleling, its real model name.
- **More NPCs**: cowboys, chefs, soldiers, hazmat scientists, rabbit folk in Sakura Valley, blockfolk, and posed
  crowds in towns.
- **Loading**: the first loading screen loads every character, monster and item. Each place's scenery is loaded by
  that place's loading screen, and places you've left are unloaded again, so memory stays low.
- **Subtitles**: a line now stays until its voice has completely finished, and lines are spoken one at a time
  (a new voice no longer cuts off the narrator). Long narration is no longer cut at 600 characters.
- **Sound**: a watchdog brings the sound back if Windows or the browser pauses it (for example when headphones switch).
  A natural 20 gets a fanfare and a golden dice tray, and a natural 1 gets a sad "wah-wah".
- Rebuilding the catalog (`python game_tools/build_game_assets.py catalog`) can now be stopped and run again; it
  continues where it stopped.

**New in the previous version**
- **Loading screens**: clicking Adventure first loads *every* model the game can show (with a progress bar),
  so nothing pops in later; travelling and stepping out of the portal show a loading screen too.
- **The portal**: Vermeil and your hero really *walk* into it (no more sliding), with its own sounds.
- **Species animations**: every species has its own posture, walk, idle habits, talking gestures, greeting
  and victory (an orc beats its chest, an elf bows, a goblin cackles and hops, a dwarf strokes his beard...).
  Hands are placed with arm IK and feet stay planted with leg IK; fingers, tails and ears move too.
- **Music and sound**: a composed theme for every biome and place, combat and boss music, biome ambience,
  footsteps that match the ground, and creature sounds for every monster type (mechs whirr and clang, slimes
  squelch, skeletons rattle, dinosaurs roar...) and for every playable species.
- **Battles**: BATTLE / YOUR TURN / VICTORY banners, hit-stop, knock-back, hit flashes, camera moves, a ring
  under whoever acts, monsters sink away when defeated. Menus, cards, toasts and subtitles are animated.
- **Gold to spend**: every town has a shop; blacksmiths reforge gear (+1 … +5); innkeepers sell a safe rest;
  a **wandering trader** sometimes camps in the wild with rare/epic/legendary gear, permanent stat tonics and
  Tomes of Insight (a new upgrade card). The trader packs up when you leave.
- **Settings**: separate volumes for all voices, the narrator, Vermeil and everyone else (up to 150%).
- **Low-poly water**: rivers, lakes and the sea are made of uneven triangles that rise and fall with the waves,
  each facet catching the light on its own (teal, darker where deep, foam at the shore). Lava works the same way.
- **Character creation**: 🎲 Randomize picks a name, species, class and world for you.
- Fixed: 424 converted models were invisible (see `game_tools/fix_materials.py`); the warrior and ranger
  models get painted faces.

The icons on the left open: inventory, equipment, quests, abilities, cards, objectives, party, map,
journal (all story lines and subtitles) and the event log. `Esc` pauses; the pause menu has settings and
saves (auto + 3 slots — you can't save in the middle of a battle).

## Files

| Where | What |
|---|---|
| `game/` | Python rules engine: `campaign.py` (the game), `combat.py`, `world.py` (world generation), `layout.py` (3D place layout + path check/repair), `actors.py`, `inventory.py`, `progression.py`, `dm.py` (AI Dungeon Master + offline fallback), `companion.py` (Vermeil), `voices.py`, `ai.py`, `api.py` (what the page calls) |
| `game/data/*.json` | All game content: species, classes, abilities, items, enemies, bosses, cards, biomes, names. Add content here, no code changes needed |
| `ui/game/` | The 3D page (three.js): `main.js` (game loop), `world.js`, `characters.js`, `anim.js` (universal animations), `dice3d.js`, `vfx.js`, `audio.js`, `ui.js`, `game.css` |
| `ui/game/assets/` | Game-ready copies of models from your `dnd` folder plus `catalog.json` (the asset manifest) and `made/` (models built in Blender for gaps) |
| `ui/game/viewer.html` | Model and animation checker (`viewer.html?ids=a,b&species=orc,elf`) with buttons for every state and emote |
| `ui/game/modelcheck.html` | Loads every model and lists any that fail, are missing textures or come out invisible |
| `game_tools/` | Asset pipeline, dev server and balance simulator |
| `tests/test_game.py` | 40 automated tests (rules, world, shops/trader, sounds, models) |

## Rebuilding the assets (only needed if you add packs to `dnd`)

Your original `dnd` folder is never changed — everything is copied.

1. `python game_tools/scan_assets.py` — scans `dnd` and writes the full manifest.
2. `python game_tools/build_game_assets.py jobs` — lists the FBX packs that need converting.
3. In Blender's Python console:
   `g={"BUDGET":52}; exec(open(r"C:\...\game_tools\blender_convert.py").read(), g)`
   (repeat until it reports nothing left). This turns FBX models into `.glb` files.
4. Optional: run `game_tools/blender_missing.py` in Blender the same way to rebuild the hand-made
   pieces (lamp posts, signpost, ruins, gravestones, fountain, bridge, campfire, portal base, dice).
5. `python game_tools/build_game_assets.py copy` then `python game_tools/build_game_assets.py catalog`
   (this also runs `fix_materials.py`, which makes see-through converted models solid again).

## Testing

- Automated: `python -m unittest tests.test_game` (set `GAME_NO_AI=1` to force the offline Dungeon Master).
- Balance: `python game_tools/simulate.py` plays whole campaigns with a bot and prints levels/results.
- In a normal browser without the app: `python game_tools/dev_server.py 8770`, then open
  `http://localhost:8770/game/index.html?bridge`.

## AI and voices

- The Dungeon Master and Vermeil use the same Groq key as the rest of the app (from your `.env`). If the
  key is missing, the network is down or a reply takes too long, a built-in rules parser and line bank take
  over, so the game always keeps working.
- The AI never decides numbers: its reply is checked (`validate_intent`) and anything invalid is dropped.
- Voices: while the AI is online (Groq) and Kokoro is running on your PC, everyone speaks with Kokoro voices
  (Vermeil with the one chosen in her character settings, the narrator with a deep British voice, every NPC
  with their own). Offline, the Piper voices you already have are used as before. See the main README for
  the one-time Kokoro setup (no Docker). Subtitles always show and appear word by word with the voice.
