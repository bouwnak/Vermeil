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

## Second round

Done: Oma and Tarn's story; rigged dinosaurs with jaws, blinking and touch reactions; forms that change shape; wild herds with unlocks; birds and pterosaurs; town with fountain, crowd, rentable stalls and a market for everything; driving with farm work; crop pack stages; moving sails, machines, sea, foam and boat; animal legs; poses; new interface and loading screen; the active character as companion; next-stage test button.

Checked in the running game: boot with no missing files, all forms built, town, tractor tilling 42 plots, boat, crops, the start on the ground. Checked by the data test: crop files and jaws.

Not looked at closely: rented stall sales, far island crowds and buildings, windmill sails turning by eye, the companion with a real app character (needs the app), belly rub by eye. Vermeil's face in the game is not animated.

## Third round

Done: head spin, dinosaur bodies and parts, belly rub, held tools and swings, moving machines, getting out of vehicles, the active character as companion, wooden interface, the picture loading screen, scenery patches. Details in `HANDOVER.md`.

Checked in the running game: every form builds, no form sinks through the ground on a belly rub (rigged forms stay at or above it; flyers and swimmers were tuned by number), head stays within 32 degrees over 60 seconds, ten dinosaurs at full form running about with no errors, tractor in and out, a tree felled after the split.

## Fourth round

Done: seats, crouch, town way in, fountain, crowds, roaming and drinking, pens, companion jobs, stall goods and walking customers, test floor, restart, mouths and teeth, one-skin swimmer and armoured dinosaur, new pterosaur. Details in `HANDOVER.md`.

## Fifth round

Done: dinosaurs bigger, long necks carried high, Crestback mouth, eyes set ahead of the jaw hinge, real legs for the armoured one and the pterosaur, swimmers kept to beach and sea, saddles and a rider who moves with the back, a rowing boat, the swordfish showing, fire and smoke on machines, a walk-in cheese cellar, a stirring pot, wheels that roll by distance, hens living in coops, smooth roads, a town layout and stalls for every island, and clearable debris on the farm. Details in `HANDOVER.md`.

## Sixth round

Done: felling and breaking with gravity, pieces and dust; synthesized wood, stone, grass and weather sounds; visible rain, storms with lightning, snow and wind; lamps at night and fireflies; island life on Hoarshell, Coralcrest and Emberback; the Elder's dais and portal step; bridge crossings; dino personalities, voices, idle habits, reins, ride-to-clear; rarity tiers and patterns re-rolled daily; wheels on every vehicle; rigger roles, undo and test poses. Not yet: 20 new dinosaurs, new exploration turtles, deeper story, farm work slots, rare items by sniffing. Details in `HANDOVER.md`.

## Seventh round

Done: 20 new dinosaurs with home turtles and stronger gifts, two travel mounts (Strider on land, Galewing in the sky), eight far turtles for exploration (ancient city, caverns, dino forest, wildflower meadow, cloud peaks, lagoon, raptor jungle, salt flats), the Waking Song split into eight verses with two new story arcs, a rare find per turtle that only one kind can sniff out, farm work done from the saddle, three dinosaurs per farm job, no cap on dinosaurs kept. Details in `HANDOVER.md`.

## Known gaps

- Not played by hand start to finish. The story chain past the ferry was checked by its conditions, not walked through.
- Riding a swimmer over the sea, a flyer upward and a climber up a cliff are tested by simulated keys, not by hand.
- Stall sales, machines over time and festivals: written, lightly tested.
- Spec items not attempted: control remapping screen, level-of-detail models, tournaments as an event with scoring, aquarium, facial animation, a `DND/` folder.
- Sound can't be checked from here.

## Technical debt

- Town layouts on far turtles are placed by numbers, not walked around by eye.
- `G.run` skips drawing, so anything that needs the camera must be checked by eye.
