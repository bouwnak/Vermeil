# Turtle Island development log

A cozy farming game on the back of a giant living turtle. Spec: `Turtle_Island_Master_Game_Development_Prompt.md`.

## Technical assessment

| | |
|---|---|
| Engine | three.js in a web view, Python (pywebview) behind it |
| Existing game | `ui/game` + `game/*.py` (Adventure). Left untouched |
| Assets | `ui/game/assets` (ten chosen packs, shared with Adventure) and `ui/games/asset_packs` (the farm packs split with Blender). A test checks every model the game names exists |
| Saves | `skills/turtlesave.py` writes `data/turtle_island.json` safely, with a backup. Version 2; version 1 saves are upgraded on load |
| Testing | Fixed-step `G.run(seconds)` runs the game with no drawing, so checks work with the window hidden |

## Asset packs

`ui/games/asset_packs/`: `lowpoly_farm_01` (172 models), `lowpoly_farm_02` (237), `farm_vehicles` (28), `garden_tools` (15), and `_originals` with the source files. Each model is one glTF, centred, feet at y=0, duplicates removed; `models.json` in each folder lists names, sizes and polygons.

**Stand-in textures.** The two LowPoly Farm .blend files expect `textures/color_1024x1024.jpg`, which was not in the download. `textures/pack1.jpg` and `pack2.jpg` are stand-ins painted by what each model is. Replace them with the real atlas, same name, and the true colours return with no re-export.
**Garden tools** export without colour: their .blend wires its texture through nodes the exporter doesn't follow. The game draws its own held tools, so they aren't used yet.

## Milestones (section 88)

| # | Milestone | State | What's in |
|---|---|---|---|
| 1 | Playable farm | Done | Player, camera with collision, large turtle, ocean, flat-ground farming, inventory, day and night |
| 2 | Dinosaurs | Done | Ten lines, three forms each, following, friendship levels, feeding, mounting, assigned farm work by priority, world abilities |
| 3 | Fishing | Done | Shore, dock, pond, five rods, 35 fish, reel bar, journal |
| 4 | First town | Done | Willowmere, people, shops by specialty, selling, weekly demand |
| 5 | Bridge | Done | Drawbridge, repair unlock, turtle mooring, walkable, Pip crosses on foot |
| 6 | AI companion | Done, with limits | Model, follow, context lines, wave. No lip-sync or expressions in-game |
| 7 | Seasons | Done | Four seasons, seasonal crops, fish and weather, festivals |
| 8 | World expansion | Done, small | Seven turtles, six biomes, five towns or outposts, ten dinosaur lines, new resources |
| 9 | Story | Done | Ten arcs, carvings, ruins on The Elder, ending |
| 10 | Endgame | Done, small | Weekly orders, a new drifting island weekly, rotating demand, rare merchant, rare dinosaur, tool tiers |

## Tested in the running game

Farm loop through all stages and the bubble; slope refused; walking stops at the shore; cliff stops you; flood fill of the island (roads connect, gates block, ledge and shrine need a dinosaur); bridge stays up until mended, lowers, walkable to Willowmere; evolution; all 30 forms build; a dinosaur assigned to water does it; placing, turning, undo, removing; boat mended and boarded; ferry to Sunback and its people arriving.

## Known gaps

- Not played by hand start to finish. The story chain past the ferry was checked by its conditions, not walked through.
- Riding a swimmer over the sea, a flyer upward and a climber up a cliff are tested by simulated keys, not by hand.
- Stall sales, machines over time and festivals: written, lightly tested.
- Spec items not attempted: control remapping screen, level-of-detail models, tournaments as an event with scoring, aquarium, facial animation, a `DND/` folder.
- Sound can't be checked from here.

## Technical debt

- Town layouts on far turtles are placed by numbers, not walked around by eye.
- `G.run` skips drawing, so anything that needs the camera must be checked by eye.
