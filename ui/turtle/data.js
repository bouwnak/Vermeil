// data.js - everything the game is made of, as plain data: new crops, fish, dinosaurs, buildings, people and islands go here, not into code.
export const A = "../game/assets/";

export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
export const DAYS_IN_SEASON = 14;
export const SECONDS_PER_MINUTE = 0.8;      // one game day is about 19 minutes

// young plants come from the nature packs; ripe is what you pick, from the Ultimate Food Pack (or the plant itself for corn and wheat)
const FOOD = "conv_ultimate_food_pack/", GROWN = "conv_ultimate_nature_pack/", MEGA = "stylized_nature_megakit/", B = "conv_farm_buildings/", TREE = "conv_textured_stylized_trees/", SIMPLE = "conv_simple_nature_pack/";
const CP = "conv_nature_crops_pack/";
const stages = (n) => ({ grow: [1, 2, 3, 4].map((i) => `${CP}${n}_${i}.glb`), ripe: `${CP}${n}_Crop.glb` });
export const CROPS = {
  carrot: { name: "Carrot", icon: "🥕", ...stages("Carrot"), ripeSize: 0.8, seasons: [0, 2], days: 3, seed: 8, sell: 20, yield: 1, from: "tilly" },
  lettuce: { name: "Lettuce", icon: "🥬", ...stages("Lettuce"), ripeSize: 0.7, seasons: [0], days: 4, seed: 10, sell: 28, yield: 1, from: "tilly" },
  turnip: { name: "Turnip", icon: "🟣", ...stages("Beet"), ripeSize: 0.7, seasons: [2, 3], days: 5, seed: 14, sell: 40, yield: 1, from: "tilly" },
  tomato: { name: "Tomato", icon: "🍅", ...stages("Tomato"), ripeSize: 1.2, seasons: [1], days: 5, seed: 16, sell: 22, yield: 3, from: "seeds" },
  corn: { name: "Corn", icon: "🌽", ...stages("Corn"), ripeSize: 2, seasons: [1, 2], days: 6, seed: 20, sell: 54, yield: 1, from: "seeds" },
  wheat: { name: "Wheat", icon: "🌾", ...stages("Wheat"), ripeSize: 1.2, seasons: [1, 2], days: 4, seed: 9, sell: 26, yield: 1, from: "seeds" },
  pumpkin: { name: "Pumpkin", icon: "🎃", ...stages("Pumpkin"), ripeSize: 1, seasons: [2], days: 8, seed: 34, sell: 120, yield: 1, from: "seeds" },
  pepper: { name: "Sun Pepper", icon: "🌶", grow: [1, 2, 3, 4].map((i) => `${CP}Tomato_${i}.glb`), ripe: `${FOOD}Pepper_Red.glb`, ripeSize: 0.55, seasons: [1], days: 6, seed: 28, sell: 42, yield: 2, from: "dust" },
  eggplant: { name: "Eggplant", icon: "🍆", grow: [1, 2, 3, 4].map((i) => `${CP}Tomato_${i}.glb`), ripe: `${FOOD}Eggplant.glb`, ripeSize: 0.7, seasons: [1, 2], days: 7, seed: 26, sell: 70, yield: 1, from: "dust" },
  broccoli: { name: "Frost Broccoli", icon: "🥦", grow: [1, 2, 3, 4].map((i) => `${CP}Lettuce_${i}.glb`), ripe: `${FOOD}Broccoli.glb`, ripeSize: 0.7, seasons: [3], days: 6, seed: 30, sell: 90, yield: 1, from: "frost" },
  mushroom: { name: "Marsh Cap", icon: "🍄", ...stages("Mushroom"), ripeSize: 0.7, seasons: [2, 3], days: 5, seed: 24, sell: 66, yield: 1, from: "mire" },
  apple: { name: "Apple", icon: "🍎", ...stages("Apple"), ripeSize: 3.6, tree: true, cut: `${CP}Apple_Harvested.glb`, seasons: [0, 1, 2], days: 9, regrow: 4, seed: 120, sell: 30, yield: 3, from: "seeds" },
  orange: { name: "Orange", icon: "🍊", ...stages("Orange"), ripeSize: 3.6, tree: true, cut: `${CP}Orange_Harvested.glb`, seasons: [1, 2], days: 10, regrow: 4, seed: 150, sell: 36, yield: 3, from: "palm" },
  watermelon: { name: "Watermelon", icon: "🍉", ...stages("Watermelon"), ripeSize: 0.9, seasons: [1], days: 7, seed: 30, sell: 110, yield: 1, from: "seeds" },
  rice: { name: "Rice", icon: "🍚", ...stages("Rice"), ripeSize: 1, seasons: [0, 1], days: 5, seed: 12, sell: 34, yield: 2, from: "seeds" },
  berries: { name: "Bushberries", icon: "🍇", ...stages("BushBerries"), ripeSize: 1.1, seasons: [0, 1, 2], days: 6, regrow: 3, cut: `${CP}BushBerries_Harvested.glb`, seed: 40, sell: 24, yield: 2, from: "seeds" },
  flowers: { name: "Sunflowers", icon: "🌻", grow: [1, 2, 3, 4].map((i) => `${CP}Flower_${i}.glb`), ripe: `${CP}Flowers_Crop.glb`, ripeSize: 1, seasons: [0, 1], days: 4, seed: 12, sell: 30, yield: 1, from: "tilly" },
  bamboo: { name: "Bamboo", icon: "🎋", ...stages("Bamboo"), ripeSize: 2.4, seasons: [0, 1, 2], days: 7, seed: 26, sell: 44, yield: 2, from: "palm" },
  cactus: { name: "Prickly Pear", icon: "🌵", ...stages("Cactus"), ripeSize: 1.2, seasons: [1, 2], days: 8, regrow: 4, cut: `${CP}Cactus_Harvested.glb`, seed: 44, sell: 56, yield: 1, from: "dust" },
  banana: { name: "Banana", icon: "🍌", ...stages("PalmTree"), ripeSize: 5, tree: true, fruit: `${FOOD}Banana.glb`, seasons: [1], days: 8, regrow: 3, seed: 170, sell: 42, yield: 3, from: "palm" },
  coconut: { name: "Coconut", icon: "🥥", ...stages("PalmTree"), ripeSize: 5, tree: true, cut: `${CP}PalmTree_Harvested.glb`, seasons: [0, 1, 2, 3], days: 12, regrow: 5, seed: 220, sell: 60, yield: 2, from: "palm" },
  heartseed: { name: "Heartbloom", icon: "💠", grow: [1, 2, 3, 4].map((i) => `${CP}Flower_${i}.glb`), ripe: `${MEGA}Flower_4_Group.gltf`, ripeSize: 1.3, seasons: [0, 1, 2, 3], days: 7, seed: 0, sell: 0, yield: 1, story: true },
  // wild: never sold. A dinosaur sniffs the seed out on one turtle, and nowhere else (RARE_FINDS)
  moonmelon: { name: "Moonmelon", icon: "🌕", ...stages("Watermelon"), ripeSize: 1, seasons: [0, 1, 2, 3], days: 6, seed: 300, sell: 600, yield: 1, wild: true },
  emberroot: { name: "Emberroot", icon: "🔥", ...stages("Beet"), ripeSize: 0.8, seasons: [0, 1, 2, 3], days: 5, seed: 200, sell: 420, yield: 2, wild: true },
  prismbloom: { name: "Prismbloom", icon: "🌈", grow: [1, 2, 3, 4].map((i) => `${CP}Flower_${i}.glb`), ripe: `${MEGA}Flower_3_Group.gltf`, ripeSize: 1.3, seasons: [0, 1, 2, 3], days: 4, seed: 180, sell: 380, yield: 1, wild: true },
  starfruit: { name: "Starfruit", icon: "⭐", ...stages("Orange"), ripeSize: 3.6, tree: true, cut: `${CP}Orange_Harvested.glb`, seasons: [0, 1, 2, 3], days: 8, regrow: 3, seed: 400, sell: 160, yield: 3, wild: true },
};
export const YOUNG = [`${GROWN}Plant_1.glb`, `${GROWN}Plant_2.glb`, `${GROWN}Plant_3.glb`];
export const WEED = `${GROWN}Grass_Short.glb`;

// when: which hours it bites, seasons: which seasons, rain: only in the rain
// Every fish of the Animated Cute Fish Pack. [id, name, model, rarity, what it needs]
export const FISH_PACK = "conv_cute_fish_pack/";
const NIGHT = { when: [20, 26] }, DUSK = { when: [17, 23] }, DAWN = { when: [5, 9] }, RAIN = { rain: true };
const spring = { seasons: [0] }, summer = { seasons: [1] }, autumn = { seasons: [2] }, winter = { seasons: [3] }, warm = { seasons: [0, 1] }, cold = { seasons: [2, 3] };
export const FISH = [
  ["clownfish", "Reef Clown", "Clownfish", 1], ["bluetang", "Blue Drifter", "BlueTang", 1, warm], ["tang", "Sand Tang", "Tang", 1], ["yellowtang", "Sun Tang", "YellowTang", 1, summer], ["tetra", "Bright Tetra", "Tetra", 1],
  ["goldfish", "Pond Gold", "Goldfish", 1], ["bluegold", "Blue Gold", "BlueGoldfish", 1, spring], ["cardinal", "Cardinal", "CardinalFish", 1, cold], ["gramma", "Royal Gramma", "RoyalGramma", 1, DAWN], ["zebraclown", "Zebra Clown", "ZebraClownFish", 1],
  ["butterfly", "Shell Butterfly", "ButterflyFish", 2], ["idol", "Moorish Idol", "MoorishIdol", 2, summer], ["parrot", "Parrot Fish", "ParrotFish", 2], ["turbot", "Turbot", "Turbot", 2, cold], ["flatfish", "Flat Sleeper", "Flatfish", 2, NIGHT],
  ["snapper", "Red Snapper", "RedSnapper", 2, autumn], ["koi", "Spring Koi", "Koi", 2, spring], ["puffer", "Puffer", "Puffer", 2], ["sunfish", "Sunfish", "Sunfish", 2, summer],
  ["betta", "Dusk Betta", "Betta", 3, DUSK], ["cowfish", "Rain Cowfish", "Cowfish", 3, RAIN], ["lionfish", "Lionfish", "Lionfish", 3], ["blacklion", "Black Lionfish", "BlackLionFish", 3, NIGHT], ["mandarin", "Mandarin", "MandarinFish", 3, DAWN],
  ["catfish", "Armoured Catfish", "ArmoredCatfish", 3, RAIN], ["grouper", "Coral Grouper", "CoralGrouper", 3, warm], ["flowerhorn", "Flower Horn", "FlowerHorn", 3, spring], ["humphead", "Humphead", "Humphead", 3], ["piranha", "Piranha", "Piranha", 3, summer],
  ["tuna", "Great Tuna", "Tuna", 3, autumn], ["blobfish", "Blobfish", "Blobfish", 3, winter],
  ["angler", "Deep Lantern", "Anglerfish", 4, NIGHT], ["swordfish", "Swordfish", "Swordfish", 4, summer], ["shark", "Shell Shark", "Shark", 4, { rain: true, rod: 3 }], ["goblinshark", "Goblin Shark", "GoblinShark", 4, { ...NIGHT, ...winter, rod: 4 }],
].map(([id, name, model, rarity, needs = {}]) => ({ id, name, model, rarity, sell: [0, 30, 60, 120, 320][rarity], power: 0.8 + rarity * 0.4, ...needs }));

// each better rod makes the green part wider, and reaches the fish that need it
export const RODS = [1, 2, 3, 4, 5].map((level) => ({ level, model: `FishingRod_Lvl${level}`, lure: `Lure_${level}`, name: ["Driftwood Rod", "Willow Rod", "Keeper's Rod", "Deepwater Rod", "Turtle-Shell Rod"][level - 1], price: [0, 300, 900, 2400, 6000][level - 1] }));

// ---------------- dinosaurs: a line is three forms; friendship levels them, time and friendship evolve them ----------------
export const LEVEL_XP = 16, MAX_LEVEL = 20;                 // one level of friendship
export const EVOLVE = [null, { level: 5, days: 7 }, { level: 10, days: 21 }];
export const SKILLS = { water: "Watering", weed: "Weeding", harvest: "Harvesting", plant: "Planting", till: "Tilling", chop: "Chopping", mine: "Smashing rock", dig: "Digging", scout: "Scouting", carry: "Carrying", sniff: "Sniffing", dive: "Diving", reach: "Reaching high", slash: "Slashing brush", sprint: "Sprinting" };
// farm work is given out in the journal, three dinosaurs at most to a job. Everything else a dinosaur only does with you on its back
export const FARM_SKILLS = ["water", "weed", "plant", "harvest", "till", "carry"];
export const JOB_SLOTS = 3;
// each kind is born with one gift. The first ten have a small one; the ones you find later have it stronger. [what, how strong 1-3]
export const PERKS = {
  quick: ["Quick hands", "works faster"], tireless: ["Tireless", "tires more slowly"], green: ["Green thumb", "crops it tends can turn golden"], lucky: ["Lucky", "finds a little extra"],
  strong: ["Strong", "clears more in one go"], swift: ["Swift", "runs faster"], gentle: ["Gentle", "makes friends faster"], keen: ["Keen nose", "smells rare finds from further off"],
};
export const perkText = (D) => { const [k, n] = D.perk || ["gentle", 1]; return `${PERKS[k][0]} ${"★".repeat(n)}: ${PERKS[k][1]}`; };
export const perkOf = (D, kind) => (D.perk?.[0] === kind ? D.perk[1] : 0);
export const DINOS = {
  sprig: { base: "Parasaurolophus", parts: ["ridge"], line: "Crestback", icon: "🦕", forms: ["Crestling", "Crestback", "Grand Crestback"], sizes: [2.4, 4.4, 6.6], speed: [8.5, 10, 11.5], food: "carrot", ride: 0,
    skills: [["water"], ["water", "weed"], ["water", "weed", "plant"]], traits: { smash: 0 }, blurb: "Gentle and curious. Its crest sprays water over a field, and its head can crack a loose boulder.",
    shape: { hide: 0x86cf8f, belly: 0xfbeec1, accent: 0xf08a6e, legs: 4, crest: "fan", tail: 3 } },
  pebble: { base: "Triceratops", parts: ["scutes"], line: "Pebblehorn", icon: "🦏", forms: ["Pebblehorn", "Cragbrow", "Mountainmaw"], sizes: [2.2, 4, 6.2], speed: [6, 7, 8], food: "turnip", ride: 1,
    skills: [["mine"], ["mine", "dig"], ["mine", "dig", "carry"]], traits: { smash: 0, heavy: 2 }, blurb: "Stubborn and warm-hearted. Walks through most things and apologises afterwards.",
    shape: { hide: 0xb08d6c, belly: 0xe9d7b5, accent: 0x6f5a4a, legs: 4, crest: "frill", horns: true, tail: 2 } },
  dash: { bite: "sharp", base: ["Velociraptor", "Velociraptor", "Trex"], parts: ["crest", "mane"], line: "Dashling", icon: "🦖", forms: ["Dashling", "Sprintail", "Galeclaw"], sizes: [2, 3.6, 5.6], speed: [11, 15, 19], food: "corn", ride: 1,
    skills: [["scout"], ["scout", "harvest"], ["scout", "harvest", "carry"]], traits: { fast: 1 }, blurb: "Always three steps ahead of the conversation. The fastest thing on land.",
    shape: { hide: 0x7ec7e8, belly: 0xf4f0da, accent: 0xf4b64a, legs: 2, crest: "feather", tail: 3 } },
  ripple: { bite: "sharp", line: "Ripplet", icon: "🐬", forms: ["Ripplet", "Wavecrest", "Tidecaller"], sizes: [2.2, 4, 6], speed: [9, 13, 16], food: "fish", ride: 1,
    skills: [["water"], ["water", "harvest"], ["water", "harvest", "carry"]], traits: { swim: 1 }, blurb: "Happier in the sea than out of it. Carries you across open water.",
    shape: { kind: "plesio", hide: 0x5fb6c9, belly: 0xdff4ef, accent: 0xf2a2b8 } },
  feather: { bite: "sharp", line: "Featherkin", icon: "🦅", forms: ["Featherkin", "Skimwing", "Cloudsail"], sizes: [2, 3.6, 5.4], speed: [10, 15, 21], food: "tomato", ride: 1,
    skills: [["scout"], ["scout", "carry"], ["scout", "carry", "harvest"]], traits: { fly: 1 }, blurb: "Light as a kite and twice as nosy. Reaches what nothing else can.",
    shape: { kind: "ptero", hide: 0xe6a06c, belly: 0xfbe7c4, accent: 0x9a5fb0 } },
  nib: { base: "Stegosaurus", parts: [], line: "Nibbler", icon: "🐊", forms: ["Nibbler", "Sawback", "Timberjaw"], sizes: [2.2, 4, 6], speed: [6, 7.5, 9], food: "lettuce", ride: 1,
    skills: [["chop"], ["chop", "weed"], ["chop", "weed", "carry"]], traits: { chop: 0 }, blurb: "Eats saplings, trims hedges, feels no shame.",
    shape: { hide: 0xc3d36a, belly: 0xf3ecc0, accent: 0xd8573f, legs: 4, crest: "plates", tail: 3 } },
  burrow: { line: "Burrowlet", icon: "🦔", forms: ["Burrowlet", "Deepclaw", "Tunnelmaw"], sizes: [2, 3.6, 5.4], speed: [6, 7, 8.5], food: "mushroom", ride: 1,
    skills: [["dig"], ["dig", "mine"], ["dig", "mine", "scout"]], traits: { dig: 0 }, blurb: "Knows what's under everything, and will not stop telling you.",
    shape: { kind: "anky", hide: 0x8f8fb8, belly: 0xdcd6ea, accent: 0x4f4f78 } },
  hop: { base: "Velociraptor", parts: ["dome", "horns"], line: "Hopling", icon: "🐐", forms: ["Hopling", "Ledgeram", "Cliffking"], sizes: [2, 3.4, 4.8], speed: [8, 10, 12], food: "wheat", ride: 1,
    skills: [["carry"], ["carry", "mine"], ["carry", "mine", "scout"]], traits: { climb: 1, jump: 1 }, blurb: "Treats a cliff as a suggestion. Takes you straight up rock faces.",
    shape: { hide: 0xe2d5c0, belly: 0xfff6e4, accent: 0x7a6a9c, legs: 4, crest: "dome", horns: true, tail: 1 } },
  neck: { base: "Apatosaurus", parts: ["ridge"], line: "Stretchlet", icon: "🦒", forms: ["Stretchlet", "Longreach", "Skyneck"], sizes: [3, 6.5, 9.5], speed: [5, 6.5, 8], food: "apple", ride: 1,
    skills: [["harvest"], ["harvest", "plant"], ["harvest", "plant", "carry"]], traits: {}, blurb: "A very slow thinker with a very long view. The best orchard hand there is.",
    shape: { hide: 0xa9c6e6, belly: 0xeef2fb, accent: 0x5e86b8, legs: 4, neck: 3, crest: "none", tail: 3 } },
  star: { bite: "sharp", base: ["Velociraptor", "Trex", "Trex"], parts: ["sail", "crest"], line: "Glimmerling", icon: "🌟", forms: ["Glimmerling", "Auroraback", "Dawnbringer"], sizes: [2.2, 4.8, 7.4], speed: [10, 14, 20], food: "heartseed_any", rare: true, ride: 1,
    skills: [["water", "harvest"], ["water", "harvest", "weed"], ["water", "harvest", "weed", "plant", "scout"]], traits: { fly: 2, swim: 2 }, blurb: "Nobody has seen one in a thousand years. It hums the same note the turtles do.",
    shape: { hide: 0xe9e2ff, belly: 0xfff6c8, accent: 0x7fe0d0, legs: 4, wings: true, crest: "fan", tail: 3 } },

  // ---------- found later, each on its own turtle: rarer gifts than the first ten. `travel`: the two fastest, one on land and one in the sky ----------
  galli: { base: "Velociraptor", parts: ["mane"], line: "Strider", icon: "🦤", forms: ["Striderling", "Strider", "Galestrider"], sizes: [2.2, 3.8, 5.2], speed: [24, 30, 36], food: "wheat", ride: 0, travel: "land", home: "willowmere", perk: ["swift", 3],
    skills: [["water", "sprint"], ["water", "sprint", "carry"], ["water", "sprint", "carry", "sniff"]], traits: { fast: 0 }, blurb: "Built like a sprinter and twice as restless. The fastest way across any turtle, and it carries water in its throat for your plots.",
    shape: { hide: 0xf2c84a, belly: 0xfff4d8, accent: 0xe0703a, legs: 2, crest: "feather", tail: 3 } },
  quetz: { bite: "sharp", line: "Galewing", icon: "🪽", forms: ["Galeling", "Galewing", "Stormsail"], sizes: [3, 6, 8.5], speed: [26, 34, 42], food: "fish", ride: 0, travel: "sky", home: "dune", perk: ["swift", 3],
    skills: [["scout", "sniff"], ["scout", "sniff", "carry"], ["scout", "sniff", "carry", "harvest"]], traits: { fly: 0 }, blurb: "A wingspan like a sail and the patience of a cat. Nothing crosses the open sea faster.",
    shape: { kind: "ptero", hide: 0xe8e0d0, belly: 0xfff8ee, accent: 0xd84a3a } },
  spino: { bite: "sharp", base: "Trex", parts: ["sail"], line: "Sailjaw", icon: "⛵", forms: ["Sailpup", "Sailjaw", "Tidesail"], sizes: [2.4, 4.6, 7], speed: [8, 10, 13], food: "fish", ride: 1, home: "reef", perk: ["lucky", 2],
    skills: [["harvest", "dive"], ["harvest", "dive", "carry"], ["harvest", "dive", "carry", "sniff"]], traits: { swim: 1 }, blurb: "Wades into the lagoon up to its sail and comes back with something every time.",
    shape: { hide: 0x3f7a6a, belly: 0xe8e0c0, accent: 0xd86a3a, legs: 2, crest: "none", tail: 3 } },
  pachy: { base: "Velociraptor", parts: ["dome", "scutes"], line: "Thumpdome", icon: "🐏", forms: ["Bonklet", "Thumpdome", "Crownbreaker"], sizes: [1.8, 3.2, 4.6], speed: [9, 11, 13], food: "turnip", ride: 1, home: "hollow", perk: ["strong", 2],
    skills: [["mine"], ["mine", "carry"], ["mine", "carry", "dig"]], traits: { smash: 0 }, blurb: "Solves every problem with its head. Rocks, mostly. Sometimes doors.",
    shape: { hide: 0x8a6ab0, belly: 0xece0f4, accent: 0xf0c040, legs: 2, crest: "dome", tail: 2 } },
  styra: { base: "Triceratops", parts: ["horns", "scutes"], line: "Furrowhorn", icon: "🦏", forms: ["Furrowling", "Furrowhorn", "Ploughcrown"], sizes: [2.2, 4.2, 6.4], speed: [7, 8.5, 10], food: "carrot", ride: 0, home: "bloom", perk: ["quick", 2],
    skills: [["till"], ["till", "weed"], ["till", "weed", "plant"]], traits: { smash: 1, heavy: 1 }, blurb: "Its frill is a plough. Ride it across open ground and the soil turns behind you in rows.",
    shape: { hide: 0xd08a4a, belly: 0xf6e4c4, accent: 0x7a3a2a, legs: 4, crest: "frill", horns: true, tail: 2 } },
  anky2: { line: "Clubtail", icon: "🛡", forms: ["Clublet", "Clubtail", "Bastionback"], sizes: [2.2, 4, 6], speed: [5.5, 6.5, 8], food: "pumpkin", ride: 1, home: "hollow", perk: ["tireless", 2],
    skills: [["mine"], ["mine", "dig"], ["mine", "dig", "carry"]], traits: { smash: 0, heavy: 1 }, blurb: "Armoured like a castle wall, and about as easy to argue with. Its tail club cracks stone like toffee.",
    shape: { kind: "anky", hide: 0xc9a24a, belly: 0xf4e8c0, accent: 0x5a4a2a } },
  brachio: { base: "Apatosaurus", parts: ["crest"], line: "Cloudneck", icon: "🦕", forms: ["Necklet", "Cloudneck", "Skyreacher"], sizes: [3.4, 7.5, 11], speed: [5.5, 7, 8.5], food: "apple", ride: 1, home: "fernwood", perk: ["green", 2],
    skills: [["harvest", "reach"], ["harvest", "reach", "plant"], ["harvest", "reach", "plant", "carry"]], traits: { reach: 0 }, blurb: "Eats from the tops of the giant ferns, and will lift you up there too if you ask nicely.",
    shape: { hide: 0x8ec89a, belly: 0xf0f4e0, accent: 0xe0583a, legs: 4, neck: 3, crest: "none", tail: 3 } },
  diplo: { base: "Apatosaurus", parts: ["ridge", "scutes"], line: "Whiplash", icon: "🦕", forms: ["Whiplet", "Whiplash", "Thunderwhip"], sizes: [3, 6.8, 10], speed: [6, 7.5, 9], food: "bamboo", ride: 1, home: "fernwood", perk: ["strong", 2],
    skills: [["chop"], ["chop", "carry"], ["chop", "carry", "weed"]], traits: { chop: 0 }, blurb: "One crack of that tail and a log becomes kindling. It finds this very funny.",
    shape: { hide: 0xc84a4a, belly: 0xf4d8c8, accent: 0x8a2a4a, legs: 4, neck: 2, tail: 3 } },
  kentro: { base: "Stegosaurus", parts: ["plates", "scutes"], line: "Spikeback", icon: "🌵", forms: ["Spiklet", "Spikeback", "Thornwarden"], sizes: [2.2, 4, 5.8], speed: [6.5, 8, 9.5], food: "lettuce", ride: 1, home: "thorn", perk: ["quick", 2],
    skills: [["harvest"], ["harvest", "slash"], ["harvest", "slash", "carry"]], traits: {}, blurb: "Swishes its spiked tail through a ripe row and the whole lot is picked. Mind your shins.",
    shape: { hide: 0x5aa86a, belly: 0xf0ecc8, accent: 0xf08a2a, legs: 4, crest: "plates", tail: 3 } },
  theri: { base: "Trex", parts: ["mane"], line: "Sicklehand", icon: "✂", forms: ["Sicklet", "Sicklehand", "Scytheking"], sizes: [2.4, 4.6, 6.8], speed: [7, 8.5, 10], food: "berries", ride: 1, home: "thorn", perk: ["green", 2],
    skills: [["slash", "harvest"], ["slash", "harvest", "weed"], ["slash", "harvest", "weed", "chop"]], traits: {}, blurb: "Long claws, soft heart. Cuts a path through thorn and bramble, then stops to sniff the flowers.",
    shape: { hide: 0x6a5a8a, belly: 0xece4f0, accent: 0xe8d24a, legs: 2, crest: "feather", tail: 3 } },
  dilo: { bite: "sharp", base: "Velociraptor", parts: ["crest"], line: "Frillcrest", icon: "🦎", forms: ["Frilling", "Frillcrest", "Twincrest"], sizes: [2, 3.6, 5], speed: [11, 14, 16], food: "fish", ride: 1, home: "thorn", perk: ["keen", 2],
    skills: [["scout", "sniff"], ["scout", "sniff", "harvest"], ["scout", "sniff", "harvest", "slash"]], traits: {}, blurb: "Twin crests that flush pink when it smells something interesting. They flush a lot.",
    shape: { hide: 0x4ab8a8, belly: 0xf4f0d8, accent: 0xf04a6a, legs: 2, crest: "fan", tail: 3 } },
  compy: { base: "Velociraptor", parts: [], line: "Nibbit", icon: "🐁", forms: ["Nibbit", "Scurrit", "Swiftnib"], sizes: [1.2, 2, 3], speed: [12, 15, 18], food: "berries", ride: 2, home: "pillar", perk: ["keen", 3],
    skills: [["sniff"], ["sniff", "scout"], ["sniff", "scout", "carry"]], traits: {}, blurb: "Small enough to fit through any crack, and nosy enough to try. Has found every coin the Shellwrights ever dropped.",
    shape: { hide: 0xa8d84a, belly: 0xfaf4d8, accent: 0x3a6a2a, legs: 2, crest: "none", tail: 3 } },
  ovi: { base: "Velociraptor", parts: ["crest", "mane"], line: "Eggkeeper", icon: "🥚", forms: ["Eggling", "Eggkeeper", "Nestmother"], sizes: [1.8, 3.2, 4.6], speed: [10, 12, 14], food: "corn", ride: 1, home: "pillar", perk: ["gentle", 2],
    skills: [["plant", "carry"], ["plant", "carry", "sniff"], ["plant", "carry", "sniff", "harvest"]], traits: {}, blurb: "Tucks seeds into the soil the way it tucks in its eggs: carefully, and with a little song.",
    shape: { hide: 0x4a6ad8, belly: 0xf0f0ff, accent: 0xf0a83a, legs: 2, crest: "fan", tail: 2 } },
  cory: { base: "Parasaurolophus", parts: ["dome"], line: "Bellcrest", icon: "🔔", forms: ["Bellchick", "Bellcrest", "Choirhorn"], sizes: [2.4, 4.6, 6.8], speed: [8, 10, 12], food: "flowers", ride: 0, home: "mist", perk: ["gentle", 3],
    skills: [["water", "weed"], ["water", "weed", "plant"], ["water", "weed", "plant", "harvest"]], traits: { climb: 2 }, blurb: "Its hollow crest rings like a bell. The old keepers say its kind once sang with the turtles.",
    shape: { hide: 0xe07a9a, belly: 0xfff0f0, accent: 0x7a4ab8, legs: 4, crest: "dome", tail: 3 } },
  ptera: { bite: "sharp", line: "Duskwing", icon: "🦇", forms: ["Dusklet", "Duskwing", "Nightglider"], sizes: [1.8, 3.4, 5], speed: [12, 17, 23], food: "fish", ride: 1, home: "mist", perk: ["keen", 2],
    skills: [["scout"], ["scout", "sniff"], ["scout", "sniff", "carry"]], traits: { fly: 1 }, blurb: "Sleeps in caves by day and glides the cloud tops at dusk. Sees in the dark, and smells even better.",
    shape: { kind: "ptero", hide: 0x4a4a6a, belly: 0xd8d0e8, accent: 0xf0d04a } },
  mosa: { bite: "sharp", line: "Deepmaw", icon: "🐋", forms: ["Deeplet", "Deepmaw", "Abyssal King"], sizes: [2.6, 5, 8], speed: [11, 15, 19], food: "fish", ride: 1, home: "reef", perk: ["lucky", 3],
    skills: [["dive"], ["dive", "harvest"], ["dive", "harvest", "carry"]], traits: { swim: 1 }, blurb: "Dives deeper than anything that breathes air. Brings up pearls and grins about it.",
    shape: { kind: "plesio", hide: 0x3a5a9a, belly: 0xe0eaf4, accent: 0x8ad8e8 } },
  ichthy: { line: "Glimfin", icon: "🐬", forms: ["Glimlet", "Glimfin", "Aurorafin"], sizes: [2, 3.6, 5.2], speed: [13, 18, 24], food: "fish", ride: 0, home: "frost", perk: ["swift", 2],
    skills: [["dive"], ["dive", "scout"], ["dive", "scout", "sniff"]], traits: { swim: 0 }, blurb: "Rides the cold currents like a skater. The quickest thing in the water, and it knows it.",
    shape: { kind: "plesio", hide: 0x9ac8f0, belly: 0xf4faff, accent: 0x4a8ad8 } },
  iguan: { base: "Parasaurolophus", parts: ["scutes"], line: "Thumbspur", icon: "🌿", forms: ["Spurling", "Thumbspur", "Grovewarden"], sizes: [2.4, 4.4, 6.4], speed: [7.5, 9, 10.5], food: "lettuce", ride: 1, home: "bloom", perk: ["green", 3],
    skills: [["plant"], ["plant", "water"], ["plant", "water", "harvest"]], traits: {}, blurb: "Plants with its thumb spike, one seed per poke. Whatever it plants grows a little better.",
    shape: { hide: 0x7aa84a, belly: 0xf0eccc, accent: 0xc8a24a, legs: 4, crest: "none", tail: 3 } },
  carno: { bite: "sharp", base: "Trex", parts: ["horns"], line: "Hornrunner", icon: "🐂", forms: ["Hornpup", "Hornrunner", "Dunebreaker"], sizes: [2.2, 4.2, 6.2], speed: [13, 17, 21], food: "fish", ride: 1, home: "salt", perk: ["strong", 3],
    skills: [["sprint", "mine"], ["sprint", "mine", "dig"], ["sprint", "mine", "dig", "sniff"]], traits: { smash: 1, fast: 1 }, blurb: "Charges the salt crust just to hear it crack. Short arms, big plans.",
    shape: { hide: 0xd84a3a, belly: 0xf8e0c8, accent: 0x2a2a3a, legs: 2, crest: "none", horns: true, tail: 3 } },
  dimetro: { base: "Stegosaurus", parts: ["sail"], line: "Sunsail", icon: "☀", forms: ["Sunlet", "Sunsail", "Solarch"], sizes: [2, 3.6, 5.2], speed: [6.5, 8, 9.5], food: "pepper", ride: 1, home: "salt", perk: ["tireless", 3],
    skills: [["dig"], ["dig", "water"], ["dig", "water", "sniff"]], traits: { dig: 0 }, blurb: "Basks with its sail to the sun all morning, then digs all afternoon on the warmth it saved.",
    shape: { hide: 0xe89a3a, belly: 0xfff0d0, accent: 0xc83a6a, legs: 4, crest: "plates", tail: 3 } },
};
// the first ten: where they're from and their (smaller) gifts
for (const [k, home, perk] of [["sprig", "home", ["gentle", 1]], ["pebble", "dune", ["strong", 1]], ["dash", "willowmere", ["swift", 1]], ["ripple", "palm", ["lucky", 1]], ["feather", "frost", ["keen", 1]], ["nib", "home", ["quick", 1]], ["burrow", "mire", ["lucky", 1]], ["hop", "home", ["tireless", 1]], ["neck", "palm", ["green", 1]], ["star", "elder", ["gentle", 2]]]) Object.assign(DINOS[k], { home, perk, basic: true });
// ---------- looks: every dinosaur is born with a pattern and colours, and some are rarer than others ----------
// [tier, chance, how far its colours stray from its kind's, a colour of its own or none]. Wild herds are born again each morning, so a rare one can turn up any day
export const DINO_TIERS = [["Common", 0.62, 0.04, null], ["Uncommon", 0.25, 0.12, null], ["Rare", 0.09, 0.3, null], ["Legendary", 0.035, 0, [[0xe8c25a, 0x8a5a1a], [0xd8dde6, 0x5a6478], [0x2a2730, 0xd84a2a]]], ["Mythic", 0.005, 0, [[0x9ff3e6, 0xd86ad8], [0xfff0a0, 0x6ad8ff], [0xf4f0ff, 0xff6aa0]]]];
export const DINO_PATTERNS = ["Plain", "Striped", "Spotted", "Banded", "Speckled", "Saddled", "Mottled"];
/** a look for one dinosaur: rnd() gives 0-1. -> { tier, pattern, hide, accent, id } */
export function rollLook(species, rnd = Math.random) {
  const D = DINOS[species];
  let r = rnd(), tier = DINO_TIERS[0];
  for (const t of DINO_TIERS) { if (r < t[1]) { tier = t; break; } r -= t[1]; }
  const pattern = tier[0] === "Common" ? DINO_PATTERNS[1 + Math.floor(rnd() * 2)] : DINO_PATTERNS[Math.floor(rnd() * DINO_PATTERNS.length)];
  const shift = (hex, by) => { const h = (hex >> 16 & 255) / 255, g = (hex >> 8 & 255) / 255, b = (hex & 255) / 255, mx = Math.max(h, g, b), mn = Math.min(h, g, b), l = (mx + mn) / 2, d = mx - mn, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    let hue = !d ? 0 : mx === h ? ((g - b) / d) % 6 : mx === g ? (b - h) / d + 2 : (h - g) / d + 4; hue = (hue * 60 + 360) % 360 / 360;
    const nh = (hue + (rnd() - 0.5) * 2 * by + 1) % 1, f = (n) => { const k = (n + nh * 12) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return Math.round(f(0) * 255) << 16 | Math.round(f(8) * 255) << 8 | Math.round(f(4) * 255); };
  const own = tier[3] ? tier[3][Math.floor(rnd() * tier[3].length)] : null, hide = own ? own[0] : shift(D.shape.hide, tier[2]), accent = own ? own[1] : shift(D.shape.accent, tier[2] * 1.5);
  return { tier: tier[0], pattern, hide, accent, id: `${tier[0]}-${pattern}-${hide.toString(16)}-${accent.toString(16)}` };
}

// roaming everywhere. after: what has to have happened before they'll trust you; until then they only watch. [species, how many, x, z, spread]
// the ones born on the far turtles need no unlocking: reaching their turtle at all is the test
export const UNLOCK = { sprig: null, nib: null, ripple: "town", hop: "boulder", dash: "town", pebble: "boat", feather: "boat", burrow: "boat", neck: "boat", star: "finale", galli: "town", quetz: "boat" };
export const UNLOCK_TEXT = { town: "after you've reached Willowmere", boulder: "after you've broken through the high road", boat: "once you have a boat", finale: "after the end of the story" };
export const HERDS = {
  home: [["sprig", 3, 60, 40, 24], ["nib", 4, -40, -70, 22], ["ripple", 2, -116, 44, 10], ["hop", 3, 92, -46, 18], ["dash", 2, -80, 50, 22], ["neck", 2, -96, -40, 18]],
  willowmere: [["dash", 4, 34, 40, 20], ["pebble", 2, -40, 30, 18], ["sprig", 2, 40, -30, 18], ["galli", 3, -34, -20, 16]],
  dune: [["pebble", 5, -30, 20, 34], ["dash", 3, 40, 10, 30], ["hop", 2, 30, -40, 20], ["quetz", 2, -46, -30, 20]],
  frost: [["feather", 3, 20, -24, 26], ["pebble", 3, -20, 30, 26], ["hop", 3, 40, 10, 24], ["ichthy", 2, 70, 40, 12]],
  // the far turtles: each has its own kinds, born nowhere else
  bloom: [["styra", 3, 20, 20, 24], ["iguan", 3, -30, -10, 22], ["sprig", 2, 40, -30, 18]],
  pillar: [["compy", 4, 10, 10, 26], ["ovi", 3, -30, 30, 20], ["neck", 2, 40, -40, 20]],
  hollow: [["pachy", 3, -20, 50, 16], ["anky2", 2, 40, 50, 18], ["burrow", 2, -50, 30, 14]],
  fernwood: [["brachio", 2, 10, -10, 30], ["diplo", 2, -50, 30, 30], ["nib", 3, 40, 40, 24]],
  mist: [["cory", 3, -50, 30, 16], ["ptera", 3, -30, 50, 20], ["feather", 2, -60, 10, 14]],
  reef: [["spino", 2, -30, -20, 20], ["mosa", 2, 90, 40, 12], ["ripple", 2, -100, 40, 12]],
  thorn: [["kentro", 3, 0, 20, 24], ["theri", 2, -40, -20, 20], ["dilo", 3, 30, -30, 22]],
  salt: [["carno", 2, 0, 0, 30], ["dimetro", 3, -30, 20, 24], ["pebble", 2, 40, -30, 20]],
  mire: [["burrow", 4, 30, 16, 26], ["nib", 4, -30, -20, 24], ["sprig", 2, 10, 40, 20]],
  palm: [["neck", 3, -30, -12, 28], ["ripple", 2, 50, -20, 16], ["dash", 3, 20, 30, 24], ["feather", 2, 40, 40, 18]],
  ember: [["star", 1, 30, 30, 18], ["pebble", 3, -10, 44, 24], ["burrow", 3, 40, 0, 20]],
  elder: [["star", 2, 0, 26, 30], ["neck", 3, 40, 50, 30], ["nib", 3, -50, 40, 28]],
};
export const WILD_TAME = 3;                                  // how many offerings before one comes round to you
export const DINO_ROOM = 3;                                  // how many friends you can keep before a barn gives you more

// ---------------- things you can own ----------------
const mats = {
  wood: ["Wood", "🌲", 3], stone: ["Stone", "⛰", 3], fiber: ["Fibre", "🌿", 2], berry: ["Wild Berries", "🍇", 8], herb: ["Sea Herb", "🌱", 10], wildcap: ["Wild Mushroom", "🍄", 12], plank: ["Plank", "🟫", 8], brick: ["Stone Brick", "🧱", 8], rope: ["Rope", "🧵", 7],
  ore: ["Iron Ore", "⛏", 18], sandstone: ["Sandstone", "🟧", 14], crystal: ["Ice Crystal", "💎", 40], cinder: ["Fire Cinder", "🔥", 46], pearl: ["Pearl", "⚪", 90], relic: ["Old Relic", "🏺", 140], milk: ["Milk", "🥛", 18], wool: ["Wool", "🐑", 16], egg: ["Egg", "🥚", 12],
  fertilizer: ["Fertiliser", "💩", 0], feed: ["Dino Feed", "🥣", 0],
};
const goods = { juice: ["Fruit Juice", "🧃", 70], jam: ["Jam", "🍯", 95], preserve: ["Premium Preserve", "🍯", 190], sauce: ["Tomato Sauce", "🥫", 80], premium_sauce: ["Premium Sauce", "🥫", 150], dish: ["Restaurant Dish", "🍝", 320], flour: ["Flour", "🌾", 48], bread: ["Bread", "🍞", 96], cheese: ["Cheese", "🧀", 60], aged_cheese: ["Aged Cheese", "🧀", 160], fillet: ["Fish Fillet", "🍣", 60], smoked: ["Smoked Fish", "🐟", 120], gourmet: ["Gourmet Platter", "🍱", 300], soup: ["Harvest Soup", "🍲", 140], pickle: ["Pickles", "🥒", 90] };
export const ITEMS = {
  carving: { name: "Old Carving", icon: "⛰", sell: 0 }, heartseed_seed: { name: "Heartseed", icon: "💠", seed: "heartseed" },
  ...Object.fromEntries(Object.entries(mats).map(([k, [name, icon, sell]]) => [k, { name, icon, sell, mat: true }])),
  ...Object.fromEntries(Object.entries(goods).map(([k, [name, icon, sell]]) => [k, { name, icon, sell, made: true }])),
  ...Object.fromEntries(Object.entries(CROPS).filter(([, c]) => !c.story).flatMap(([k, c]) => [[k, { name: c.name, icon: c.icon, sell: c.sell, crop: true }], [`${k}_gold`, { name: `Golden ${c.name}`, icon: "✨", sell: c.sell * 4, crop: true, gold: true }], [`${k}_seed`, { name: `${c.name} ${c.tree ? "Sapling" : "Seeds"}`, icon: c.icon, packet: true, seed: k }]])),
  heartseed: { name: "Heartbloom", icon: "💠", sell: 0 },
  ...Object.fromEntries(FISH.map((f) => [f.id, { name: f.name, icon: "🐟", sell: f.sell, fish: true }])),
  ...Object.fromEntries(Object.entries({ shellclover: ["Shellclover", "🍀", 140], brassbell: ["Old Brass Bell", "🔔", 300], sunstone: ["Sunstone", "🌞", 400], frostfeather: ["Frost Feather", "🪶", 350], bogpearl: ["Bog Pearl", "🟢", 380], coralbloom: ["Coral Bloom", "🪸", 360],
    shellcoin: ["Shellwright Coin", "🪙", 500], glowstone: ["Glowstone", "💡", 450], amber: ["Ancient Amber", "🟠", 600], cloudpearl: ["Cloud Pearl", "☁", 700], thornberry: ["Thornheart Berry", "💗", 260], mirrorcrystal: ["Mirror Crystal", "🔮", 650] })
    .map(([k, [name, icon, sell]]) => [k, { name, icon, sell, rare: true }])),
};
ITEMS.moonmelon_seed.name = "Unknown Seed"; ITEMS.moonmelon_seed.icon = "❔";
for (const k of ["moonmelon_seed", "emberroot_seed", "prismbloom_seed", "starfruit_seed"]) ITEMS[k].rare = true;
ITEMS.thornberry.treat = true;                                 // a dinosaur's favourite: three times the friendship of a meal
// every turtle hides one rare thing, and only one kind of dinosaur can smell it. Ride that one there and let it sniff: three spots a week, each found once
export const RARE_FINDS = {
  home: { item: "shellclover", by: "sprig" }, willowmere: { item: "brassbell", by: "galli" }, dune: { item: "sunstone", by: "pebble" }, frost: { item: "frostfeather", by: "feather" },
  mire: { item: "bogpearl", by: "dilo" }, palm: { item: "coralbloom", by: "ripple" }, ember: { item: "emberroot_seed", by: "anky2" }, elder: { item: "moonmelon_seed", by: "burrow" },
  bloom: { item: "prismbloom_seed", by: "iguan" }, pillar: { item: "shellcoin", by: "compy" }, hollow: { item: "glowstone", by: "ptera" }, fernwood: { item: "amber", by: "diplo" },
  mist: { item: "cloudpearl", by: "quetz" }, reef: { item: "starfruit_seed", by: "spino" }, thorn: { item: "thornberry", by: "kentro" }, salt: { item: "mirrorcrystal", by: "carno" },
};
export const itemName = (k) => ITEMS[k]?.name || k;

export const TOOLS = [
  { id: "hand", name: "Hands", icon: "✋", hint: "Pick up and harvest" }, { id: "hoe", name: "Hoe", icon: "🪓", svg: "hoe", hint: "Turn flat ground into soil, pull weeds" }, { id: "can", name: "Watering Can", icon: "💧", hint: "Water a plot" },
  { id: "seeds", name: "Seeds", icon: "🌱", hint: "Plant (Q changes the seed)" }, { id: "axe", name: "Axe", icon: "🪓", hint: "Chop trees and logjams" }, { id: "pick", name: "Pickaxe", icon: "⛏", hint: "Break rocks" }, { id: "rod", name: "Fishing Rod", icon: "🎣", hint: "Cast into the water" },
];
export const TIERS = ["Basic", "Improved", "Advanced", "Master"];
// each better tool works faster and wider. cost[i] is the step up to tier i
export const TOOL_UP = { hoe: { area: [1, 3, 5, 9] }, can: { area: [1, 3, 5, 9] }, axe: { hits: [3, 2, 1, 1] }, pick: { hits: [3, 2, 1, 1] } };
export const TOOL_COST = [null, { money: 500, ore: 5, wood: 10 }, { money: 1800, ore: 15, sandstone: 10 }, { money: 6000, ore: 30, crystal: 6, cinder: 6 }];

// the farmer is who you play; the rest of the two packs are outfits to pick
export const SKINS = {
  male: [["Farmer", "Farmer"], ["Worker", "Worker"], ["Casual_2", "Casual"], ["Casual_Hoodie", "Hoodie"], ["Adventurer", "Adventurer"], ["Beach", "Beach"], ["Suit", "Suit"], ["Punk", "Punk"], ["King", "King"], ["Swat", "Swat"], ["Spacesuit", "Spacesuit"]],
  female: [["Medieval", "Farmer"], ["Worker", "Worker"], ["Casual", "Casual"], ["Adventurer", "Adventurer"], ["Formal", "Formal"], ["Suit", "Suit"], ["Punk", "Punk"], ["Witch", "Witch"], ["Soldier", "Soldier"], ["SciFi", "Sci-Fi"]],
};
export const modelOf = (body, skin) => `${A}ultimate_modular_${body === "female" ? "women" : "men"}/${skin}.gltf`;

// ---------------- places, buildings, machines ----------------
// the room for fences, decorations and buildings to be placed, like Edit room in the app. use: what E does there
export const BUILD_CATS = [["farm", "🌾 Farm"], ["buildings", "🏠 Buildings"], ["machines", "⚙ Machines"], ["fences", "🚧 Fences"], ["paths", "⛰ Paths"], ["plants", "🌸 Plants"], ["decor", "✨ Decor"], ["props", "🧺 Farm props"], ["vehicles", "🚜 Vehicles"], ["more", "📦 Everything else"]];
const cost = (money = 0, more = {}) => ({ money, ...more });
const P1 = "../games/asset_packs/lowpoly_farm_01/", V = "../games/asset_packs/farm_vehicles/";
const pack = (root, entries) => Object.fromEntries(entries.map(([k, label, cat, file, r, money, more = {}]) => [k, { label, cat, model: `${root}${file}.gltf`, r, cost: cost(money, more.cost), ...more, cost: cost(money, more.cost) }]));
export const CATALOG = {
  ...pack(P1, [["farmhouse", "Big Farmhouse", "buildings", "farmhouse_a01", 9, 3200, { cost: { plank: 60, brick: 40 } }], ["farmhouse2", "Country House", "buildings", "farmhouse_a02", 9, 3200, { cost: { plank: 60, brick: 40 } }], ["bigbuild", "Farm Hall", "buildings", "farmbuilding_a", 9, 2600, { room: 6, cost: { plank: 50, brick: 30 } }], ["garage", "Garage", "buildings", "garage_a01", 6.5, 900, { cost: { plank: 30, ore: 6 } }], ["littlehouse", "Guest Cottage", "buildings", "littlehouse_a", 3, 700, { cost: { plank: 24 } }], ["packcoop", "Hen House", "buildings", "coop_a", 1.9, 300, { use: "coop", cost: { plank: 12 } }], ["tower", "Grain Tower", "buildings", "farmstructure_a", 2.4, 900, { cost: { brick: 24 } }],
    ["longhouse", "Long Greenhouse", "farm", "greenhouse_a01", 0, 1200, { greenhouse: 5, cost: { plank: 20, crystal: 1 } }], ["straw", "Straw Bales", "farm", "strawpack_a", 0.9, 12, { cost: { fiber: 4 } }], ["feeder", "Feed Rack", "farm", "littlefoodholder_a", 1, 90, { use: "trough", cost: { plank: 5 } }], ["waterdish", "Water Trough", "farm", "waterdish_a", 0.9, 60, { cost: { plank: 4 } }], ["sprinklerb", "Field Sprinkler", "farm", "watersprinkler_a", 0.3, 180, { sprinkle: 5, cost: { ore: 2 } }], ["milktank", "Milk Churn", "farm", "milktank_a", 0.4, 40, { cost: { ore: 1 } }], ["bucket", "Bucket", "farm", "bucket_a", 0, 6, {}],
    ["gate", "Farm Gate", "fences", "gate_a", 0, 0, { flat: true, snap: 1, cost: { wood: 4 } }], ["pfence1", "Picket Fence", "fences", "fence_a", 0, 0, { snap: 1, wall2: true, cost: { wood: 1 } }], ["pfence2", "Rail Fence, Low", "fences", "fence_b", 0, 0, { snap: 1, wall2: true, cost: { wood: 1 } }], ["pfence3", "Stone Wall Fence", "fences", "fence_c", 0, 0, { snap: 1, wall2: true, cost: { wood: 1, stone: 1 } }],
    ["road", "Stone Road", "paths", "Stoneroad_a", 0, 0, { flat: true, snap: 1, cost: { stone: 2 } }], ["road2", "Worn Stone Road", "paths", "Stoneroad_b", 0, 0, { flat: true, snap: 1, cost: { stone: 2 } }],
    ["fbarrel", "Barrel", "props", "barrel_a", 0.45, 0, { cost: { wood: 3 } }], ["fcrate", "Big Crate", "props", "cratebox_a", 0.8, 0, { cost: { wood: 4 } }], ["bonfire", "Fire Pit", "props", "bonfire_a", 0.9, 0, { cost: { wood: 3, stone: 3 } }], ["fbench", "Porch Bench", "props", "bench_a", 0.8, 0, { cost: { plank: 4 } }], ["fbench2", "Plank Seat", "props", "bench_c", 0.7, 0, { cost: { plank: 2 } }], ["fchair", "Chair", "props", "chair_a", 0.6, 0, { cost: { plank: 2 } }], ["ftable", "Table", "props", "table_a", 0.7, 0, { cost: { plank: 3 } }], ["fcart", "Hand Cart", "props", "cart_a", 0.7, 20, { cost: { plank: 3 } }], ["flogs", "Log Pile", "props", "logs_a", 1.8, 0, { cost: { wood: 6 } }], ["timber", "Timber Stack", "props", "timber_a", 0.7, 0, { cost: { wood: 4 } }], ["streetlamp", "Street Lamp", "props", "streetlight_a", 0.2, 60, { light: true, cost: { ore: 1 } }], ["streetsign", "Street Sign", "props", "streetsign_a", 0.2, 10, {}], ["mailbox", "Mailbox", "props", "mailbox_a", 0.2, 30, {}], ["farmsign", "Farm Sign", "props", "farmsign_a", 0.3, 40, { cost: { plank: 2 } }], ["ladder", "Ladder", "props", "laddertriangle_a", 0.8, 0, { cost: { wood: 3 } }], ["mower", "Push Mower", "props", "lawn_mower_a", 0.4, 90, {}], ["shovel", "Shovel", "props", "shovel_a", 0.1, 10, {}]]),
  ...pack(V, [["tractor_r", "Red Tractor (tills)", "vehicles", "TractorR", 2.2, 2400, { work: "till" }], ["tractor_y", "Yellow Tractor (tills)", "vehicles", "TractorY", 2.6, 2600, { work: "till" }], ["combine", "Combine Harvester (harvests)", "vehicles", "CombineHarvester", 6, 9000, { work: "harvest" }], ["harvester", "Harvester (harvests)", "vehicles", "Harvester", 6, 8000, { work: "harvest" }], ["seeddrill", "Seed Drill (plants)", "vehicles", "SeedDrill", 5.6, 4200, { work: "plant" }], ["baler", "Square Baler", "vehicles", "SquareBaler", 4, 3200, { work: "weed" }], ["plow", "Plowshare (tills)", "vehicles", "Plowshare", 1.6, 900, { work: "till" }], ["pickup", "Pickup Truck", "vehicles", "Pickup", 3, 2400, {}], ["truck_s", "Small Truck", "vehicles", "TruckS", 2.4, 2600, {}], ["truck_m", "Farm Truck", "vehicles", "TruckM", 3.2, 3000, {}], ["truck_b", "Big Truck", "vehicles", "TruckB", 3.4, 3400, {}], ["tanker", "Water Tanker (waters)", "vehicles", "TtankerB", 3.2, 2800, { work: "water" }], ["tanker_s", "Small Tanker (waters)", "vehicles", "TtankerS", 1.5, 1200, { work: "water" }], ["forklift", "Forklift", "vehicles", "Forklift", 1.5, 1400, {}], ["bulldozer", "Bulldozer", "vehicles", "Bulldozer", 3.2, 3800, {}], ["binc", "Bin Car", "vehicles", "BinCar", 2.2, 1800, {}], ["container", "Shipping Container", "vehicles", "Container", 3.2, 1200, {}], ["handcart", "Big Hand Cart", "vehicles", "HandCart_01", 1.6, 300, {}], ["barrow", "Wheelbarrow", "vehicles", "WheelbarrowG", 0.9, 120, {}], ["barrow2", "Blue Wheelbarrow", "vehicles", "WheelbarrowB", 0.9, 120, {}], ["mower_b", "Ride-on Mower", "vehicles", "LawnMower_B", 1.4, 900, {}], ["pontoon", "Pontoon Boat", "vehicles", "PontoonBoat", 1.8, 900, {}]]),
  // what's standing on your turtle from the first day is the same as what you can build; each can be moved
  house: { label: "Farmhouse", cat: "buildings", model: `${P1}farmhouse_a01.gltf`, cost: cost(2000, { plank: 40, brick: 30 }), r: 9, use: "bed", unique: true },
  silohouse: { label: "Silo Cottage", cat: "buildings", model: `${B}Silo_House.glb`, height: 12, cost: cost(1400, { plank: 30, brick: 20 }), r: 6.2 },
  barn: { label: "Dino Barn", cat: "buildings", model: `${B}Barn.glb`, height: 10, cost: cost(900, { plank: 30, stone: 20 }), r: 6.4, room: 3 },
  bigbarn: { label: "Great Barn", cat: "buildings", model: `${B}BigBarn.glb`, height: 12, cost: cost(2400, { plank: 60, brick: 30 }), r: 7.4, room: 6 },
  smallbarn: { label: "Shed", cat: "buildings", model: `${B}SmallBarn.glb`, height: 6.5, cost: cost(400, { plank: 16 }), r: 4.4, room: 1 },
  openbarn: { label: "Open Barn", cat: "buildings", model: `${B}OpenBarn.glb`, height: 5.2, cost: cost(350, { plank: 18 }), r: 3.8, room: 1 },
  silo: { label: "Silo", cat: "buildings", model: `${B}Silo.glb`, height: 11, cost: cost(500, { brick: 20 }), r: 3 },
  coop: { label: "Chicken Coop", cat: "buildings", model: `${B}ChickenCoop.glb`, height: 3, cost: cost(250, { plank: 12 }), r: 1.9, use: "coop" },
  windmill: { label: "Windmill", cat: "buildings", model: `${B}Windmill.glb`, height: 14, cost: cost(1200, { plank: 40, rope: 10 }), r: 2.6 },
  towermill: { label: "Tower Windmill", cat: "buildings", model: `${B}TowerWindmill.glb`, height: 13, cost: cost(1600, { plank: 40, brick: 20 }), r: 4.6 },
  watertower: { label: "Water Tower", cat: "buildings", model: `${B}WaterTower.glb`, height: 9, cost: cost(800, { plank: 20, ore: 6 }), r: 1.8, tower: true },
  waterbarrel: { label: "Water Barrel", cat: "farm", made: "waterbarrel", cost: cost(80, { plank: 6, ore: 1 }), r: 0.9, use: "barrel" },
  well: { label: "Well", cat: "buildings", model: `${B}Well.glb`, height: 2.6, cost: cost(150, { stone: 15 }), r: 1.2 },
  greenhouse: { label: "Greenhouse", cat: "farm", made: "greenhouse", cost: cost(1400, { plank: 30, crystal: 2 }), r: 0, greenhouse: 9 },
  sprinkler: { label: "Sprinkler", cat: "farm", made: "sprinkler", cost: cost(220, { ore: 2 }), r: 0.4, sprinkle: 5 },
  trough: { label: "Feeding Trough", cat: "farm", made: "trough", cost: cost(120, { plank: 8 }), r: 1, use: "trough" },
  bin: { label: "Shipping Bin", cat: "farm", made: "bin", cost: cost(60, { plank: 6 }), r: 1, use: "bin", free: true },
  pen: { label: "Animal Pen", cat: "farm", made: "pen", cost: cost(150, { wood: 24 }), r: 9, use: "pen", room: 3 },
  stall: { label: "Market Stall", cat: "farm", made: "stall", cost: cost(300, { plank: 16, wool: 2 }), r: 2.2, use: "stall", unique: true },
  bench_work: { label: "Workbench", cat: "machines", made: "workbench", cost: cost(0, { wood: 12, stone: 6 }), r: 1.2, use: "craft", free: true },
  keg: { label: "Press", cat: "machines", made: "keg", cost: cost(180, { plank: 10, rope: 2 }), r: 0.9, use: "machine", machine: "press" },
  jars: { label: "Preserving Shelf", cat: "machines", made: "jars", cost: cost(220, { plank: 10, brick: 4 }), r: 1.1, use: "machine", machine: "jars" },
  mill: { label: "Hand Mill", cat: "machines", made: "mill", cost: cost(240, { brick: 10 }), r: 1, use: "machine", machine: "mill" },
  oven: { label: "Stone Oven", cat: "machines", made: "oven", cost: cost(320, { brick: 16 }), r: 1.2, use: "machine", machine: "oven" },
  smoker: { label: "Smoke Hut", cat: "machines", made: "smoker", cost: cost(260, { plank: 12, brick: 6 }), r: 1.2, use: "machine", machine: "smoker" },
  cellar: { label: "Cheese Cellar", cat: "machines", made: "cellar", cost: cost(300, { brick: 12, plank: 6 }), r: 2.6, use: "machine", machine: "cellar" },
  kitchen: { label: "Cooking Pot", cat: "machines", made: "pot", cost: cost(280, { ore: 4 }), r: 0.9, use: "machine", machine: "kitchen" },
  fence: { label: "Fence", cat: "fences", model: `${B}Fence.glb`, length: 4, cost: cost(0, { wood: 2 }), wall: 2.1, snap: 2 },
  fence2: { label: "Rail Fence", cat: "fences", model: `${B}Fence2.glb`, length: 4, cost: cost(0, { wood: 2 }), wall: 2.1, snap: 2 },
  path_round: { label: "Stepping Stones", cat: "paths", model: `${MEGA}RockPath_Round_Wide.gltf`, width: 3, cost: cost(0, { stone: 1 }), flat: true, snap: 1 },
  path_square: { label: "Flagstones", cat: "paths", model: `${MEGA}RockPath_Square_Wide.gltf`, width: 3, cost: cost(0, { stone: 1 }), flat: true, snap: 1 },
  path_thin: { label: "Narrow Path", cat: "paths", model: `${MEGA}RockPath_Round_Thin.gltf`, width: 3, cost: cost(0, { stone: 1 }), flat: true, snap: 1 },
  flowers_a: { label: "Pink Flowers", cat: "plants", model: `${MEGA}Flower_3_Group.gltf`, height: 0.9, cost: cost(6), flat: true },
  flowers_b: { label: "Yellow Flowers", cat: "plants", model: `${MEGA}Flower_4_Group.gltf`, height: 0.9, cost: cost(6), flat: true },
  flowers_c: { label: "Wildflowers", cat: "plants", model: `${GROWN}Flowers.glb`, height: 0.8, cost: cost(6), flat: true },
  fern: { label: "Fern", cat: "plants", model: `${MEGA}Fern_1.gltf`, height: 1, cost: cost(5), flat: true },
  bush: { label: "Bush", cat: "plants", model: `${MEGA}Bush_Common_Flowers.gltf`, height: 1.5, cost: cost(10), r: 0.7 },
  tree_a: { label: "Oak", cat: "plants", model: `${GROWN}CommonTree_3.glb`, height: 7, cost: cost(40), r: 0.7 },
  tree_b: { label: "Birch", cat: "plants", model: `${GROWN}BirchTree_2.glb`, height: 7, cost: cost(40), r: 0.6 },
  tree_c: { label: "Pine", cat: "plants", model: `${GROWN}PineTree_2.glb`, height: 8, cost: cost(40), r: 0.6 },
  tree_d: { label: "Willow", cat: "plants", model: `${GROWN}Willow_2.glb`, height: 7, cost: cost(60), r: 0.8 },
  tree_e: { label: "Twisted Tree", cat: "plants", model: `${MEGA}TwistedTree_2.gltf`, height: 6, cost: cost(70), r: 0.7 },
  bench: { label: "Bench", cat: "decor", made: "bench", cost: cost(0, { plank: 4 }), r: 0.9 },
  lamp: { label: "Lantern Post", cat: "decor", made: "lamp", cost: cost(30, { wood: 2, ore: 1 }), r: 0.3, light: true },
  sign: { label: "Signpost", cat: "decor", made: "sign", cost: cost(0, { wood: 3 }), r: 0.3 },
  statue: { label: "Turtle Statue", cat: "decor", made: "statue", cost: cost(300, { brick: 12 }), r: 1.2 },
  fountain: { label: "Fountain", cat: "decor", model: "../games/asset_packs/town/Fountain.glb", height: 3.8, cost: cost(500, { brick: 20 }), r: 3.1 },
  rock_a: { label: "Mossy Rock", cat: "decor", model: `${GROWN}Rock_Moss_2.glb`, height: 1.6, cost: cost(8), r: 1 },
  barrel: { label: "Storage Crate", cat: "decor", made: "crate", cost: cost(0, { wood: 4 }), r: 0.7, store: 20 },
  log: { label: "Log Seat", cat: "decor", model: `${GROWN}WoodLog.glb`, height: 0.8, cost: cost(0, { wood: 2 }), r: 0.8 },
  stump: { label: "Mossy Stump", cat: "decor", model: `${GROWN}TreeStump_Moss.glb`, height: 1, cost: cost(0, { wood: 1 }), r: 0.7 },
};
// where it all stands the first morning: on the central plateau and the lowland farm, never on a slope
export const LAYOUT = [["house", 30, -29, 0], ["barn", 58, -6, -1.4], ["silo", 62, -20, 0], ["coop", 14, 12, 1], ["watertower", 52, 12, 0], ["windmill", -24, -12, 0.5], ["well", -12, 12, 0], ["bin", 22, -14, 0], ["bench_work", 32, -13, 0.3], ["stall", 2, -2, 1.2]];

// what machines and the workbench turn things into. hours: how long a machine takes
const fruit = ["apple", "orange", "banana", "berry", "coconut"];
export const RECIPES = [
  ...[["plank", 2, { wood: 3 }], ["brick", 2, { stone: 3 }], ["rope", 1, { fiber: 4 }], ["fertilizer", 2, { fiber: 2, berry: 1 }], ["feed", 2, { wheat: 1, fiber: 2 }]].map(([out, n, input]) => ({ out, n, in: input, machine: "bench" })),
  ...fruit.map((f) => ({ out: "juice", in: { [f]: 2 }, machine: "press", hours: 6 })), { out: "sauce", in: { tomato: 3 }, machine: "press", hours: 6 }, { out: "cheese", in: { milk: 2 }, machine: "cellar", hours: 12 },
  { out: "aged_cheese", in: { cheese: 2 }, machine: "cellar", hours: 48 }, { out: "flour", in: { wheat: 2 }, machine: "mill", hours: 3 }, { out: "bread", in: { flour: 2, egg: 1 }, machine: "oven", hours: 4 },
  ...fruit.map((f) => ({ out: "jam", in: { [f]: 2 }, machine: "jars", hours: 12 })), { out: "preserve", in: { jam: 2 }, machine: "jars", hours: 36 }, { out: "premium_sauce", in: { sauce: 2, pepper: 1 }, machine: "jars", hours: 24 }, { out: "pickle", in: { turnip: 3 }, machine: "jars", hours: 18 },
  ...["clownfish", "tang", "goldfish", "tetra"].map((f) => ({ out: "fillet", in: { [f]: 1 }, machine: "smoker", hours: 2 })), { out: "smoked", in: { fillet: 2 }, machine: "smoker", hours: 8 }, { out: "gourmet", in: { smoked: 1, premium_sauce: 1 }, machine: "kitchen", hours: 6 },
  { out: "dish", in: { premium_sauce: 1, bread: 1, carrot: 2 }, machine: "kitchen", hours: 6 }, { out: "soup", in: { carrot: 2, turnip: 1, lettuce: 1 }, machine: "kitchen", hours: 4 },
];
export const MACHINES = { bench: "Workbench", press: "Press", jars: "Preserving Shelf", mill: "Hand Mill", oven: "Stone Oven", smoker: "Smoke Hut", cellar: "Cheese Cellar", kitchen: "Cooking Pot" };

// stores: what they sell, and what they pay well for. `pay` multiplies the worth of things it likes
export const SHOPS = {
  tilly: { title: "Tilly's supply cart", sells: ["fertilizer", "feed", "wood", "stone", "fiber"], prices: { fertilizer: 18, feed: 14, wood: 8, stone: 8, fiber: 6 }, seeds: true, buys: () => true, pay: 0.8 },
  seeds: { title: "Wren's seed counter", sells: ["fertilizer"], prices: { fertilizer: 16 }, seeds: true, buys: (i) => i.crop || i.made, pay: 1.1, upgrades: ["hoe", "can", "axe", "pick"] },
  fish: { title: "Bram's fish counter", sells: [], rods: true, buys: (i) => i.fish, pay: 1.2 },
  dust: { title: "Ferra's forge", sells: ["ore", "sandstone"], prices: { ore: 40, sandstone: 30 }, seeds: true, buys: (i) => i.mat, pay: 1.3, upgrades: ["hoe", "can", "axe", "pick"] },
  frost: { title: "Ona's ice cellar", sells: ["crystal"], prices: { crystal: 110 }, seeds: true, buys: (i) => i.fish || i.made, pay: 1.25 },
  mire: { title: "Fen's herbal", sells: ["herb", "wildcap"], prices: { herb: 30, wildcap: 34 }, seeds: true, buys: (i) => i.crop, pay: 1.25 },
  palm: { title: "Luma's fruit stand", sells: ["pearl"], prices: { pearl: 260 }, seeds: true, buys: (i) => i.crop && !i.gold, pay: 1.3 },
  ember: { title: "Cole's cinder yard", sells: ["cinder"], prices: { cinder: 120 }, buys: (i) => i.mat || i.fish, pay: 1.2 },
  market: { title: "Mara's Grand Market", sells: ["fertilizer", "feed", "wood", "stone", "plank", "brick", "rope", "fiber", "ore", "milk", "egg", "wool"], prices: { fertilizer: 20, feed: 16, wood: 10, stone: 10, plank: 22, brick: 22, rope: 18, fiber: 8, ore: 50, milk: 30, egg: 20, wool: 30 }, seeds: "all", goods: true, buys: () => true, pay: 1 },
  rare: { title: "The Wandering Merchant", sells: ["pearl", "relic", "crystal"], prices: { pearl: 200, relic: 420, crystal: 90 }, rareSeeds: ["apple_seed", "orange_seed", "banana_seed", "coconut_seed"], buys: (i) => i.gold || i.made, pay: 1.5 },
};
export const WEEK = 7;
// regional demand: every week each place wants some kinds of thing more, some less
export const DEMAND = ["crop", "fish", "made", "mat"];

// wandering about your farm. milk, wool and eggs come from a friendly word
// where the driver sits, as fractions of the model: [across, height of the footrest, along], from its middle
export const SEATS = { TractorR: [0, 0.37, -0.19], TractorY: [0, 0.38, -0.17], CombineHarvester: [0, 0.56, 0.13], Harvester: [0, 0.56, 0.13], SeedDrill: [0, 0.56, 0.17], SquareBaler: [0, 0.37, 0.28], Plowshare: [0, 0.35, -0.1], Pickup: [0.17, 0.31, 0.04], TruckS: [0.18, 0.36, 0.27], TruckM: [0.18, 0.36, 0.3], TruckB: [0.18, 0.34, 0.33], TtankerB: [0, 0.38, 0.28], TtankerS: [0, 0.38, 0], Bulldozer: [0, 0.34, -0.1], Forklift: [0, 0.25, 0], BinCar: [0, 0.3, 0], LawnMower_B: [0, 0.3, -0.1], LawnMower_M: [0, 0.3, -0.1] };
export const ANIMALS = [["Cow", 1.6, 44, 22, "milk"], ["Cow", 1.6, 50, 24, "milk"], ["Sheep", 1.1, 42, 16, "wool"], ["Sheep", 1.1, 38, 20, "wool"], ["Pig", 0.9, 30, 16, null], ["Pug", 0.34, 20, 18, null], ["Pig", 0.9, 36, 26, null], ["Llama", 1.5, 46, 16, "wool"], ["Horse", 1.7, 54, 22, null], ["Horse", 1.7, 58, 26, null], ["Zebra", 1.6, 62, 30, null]];

// ---------------- the world: a turtle is one entry ----------------
// route: how it wanders; moves only until you tie up alongside. flora: what grows; town: buildings on its first flat. nodes: what can be gathered
const homeFlora = (sfx) => [[`${GROWN}CommonTree${sfx}_`, 5, 130, 1.5, 0.75], [`${GROWN}PineTree${sfx}_`, 5, 70, 1.7, 0.7], [`${GROWN}BirchTree${sfx}_`, 5, 60, 1.4, 0.6], [`${GROWN}Willow${sfx}_`, 3, 16, 1.5, 0.8]];
const house = (m, x, z, h, ry) => [`${B}${m}.glb`, x, z, h, ry];
const P2 = "../games/asset_packs/lowpoly_farm_02/", home2 = (n, x, z, h, ry) => [`${P2}house_${String(n).padStart(2, "0")}.gltf`, x, z, h, ry];
// a street of homes around a place: on a ring, doors facing in
// `gap`: the angle of the way in, kept clear of houses
const ring = (first, n, r, h, cx = 0, cz = 0, gap = null) => [...Array(n)].map((_, i) => { const a = gap == null ? i / n * Math.PI * 2 + 0.3 : gap + 0.55 + i / (n - 1) * (Math.PI * 2 - 1.1); return home2((first + i) % 16 + 1, cx + Math.cos(a) * r, cz + Math.sin(a) * r, h, Math.PI / 2 - a + Math.PI); });
// every other town is laid out its own way, not round like Willowmere. A house's door faces where it's turned to: `face` turns it toward a point
const face = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
const homeAt = (n, h) => ([x, z, tx, tz]) => home2(n++ % 16 + 1, x, z, h, face(x, z, tx, tz));
const stallAt = (who) => ([x, z, tx, tz]) => [x, z, face(x, z, tx, tz), who];
/** a bazaar: two rows of houses facing each other across one long street, the stalls down the middle of it */
const street = (first, h) => ({ houses: [-27, -9, 9, 27].flatMap((x) => [[x, -14, x, 0], [x, 14, x, 0]]).map(homeAt(first, h)), stalls: [[-18, -4, -18, 0, "food"], [0, -4, 0, 0, "rent"], [18, -4, 18, 0, "food"], [-9, 4, -9, 0, "rent"], [9, 4, 9, 0, "food"]].map(([x, z, tx, tz, w]) => stallAt(w)([x, z, tx, tz])) });
/** a huddle against the cold: houses close together round a little yard, set square to each other rather than in a ring */
const huddle = (first, h) => ({ houses: [[-15, -11, -15, 0], [0, -15, 0, 0], [15, -11, 15, 0], [-17, 7, 0, 7], [17, 7, 0, 7], [0, 18, 0, 0]].map(homeAt(first, h)), stalls: [[-9, -3, 0, 0, "food"], [9, -3, 0, 0, "rent"], [-9, 9, 0, 3, "rent"], [10, 9, 0, 3, "food"]].map(([x, z, tx, tz, w]) => stallAt(w)([x, z, tx, tz])) });
/** a winding lane: houses on either side of a path that bends one way and back, the stalls along it */
const lane = (first, h) => { const bend = (z) => Math.sin(z / 11) * 7; return { houses: [-22, -13, -4, 5, 14, 23].map((z, i) => { const s = i % 2 ? 1 : -1, x = bend(z) + s * 11; return [x, z, bend(z), z]; }).map(homeAt(first, h)), stalls: [[-17, 1, "food"], [-8, -1, "rent"], [10, 1, "food"], [19, -1, "rent"]].map(([z, s, w]) => stallAt(w)([bend(z) + s * 4, z, bend(z), z])) }; };
/** along the beach: one gently curved row of houses all looking out to sea, their stalls in a row in front */
const beachRow = (first, h) => ({ houses: [-24, -12, 0, 12, 24].map((x) => [x, -14 + x * x / 90, x, 30]).map(homeAt(first, h)), stalls: [[-18, 1, "food"], [-6, 3, "rent"], [6, 3, "food"], [18, 1, "rent"]].map(([x, z, w]) => stallAt(w)([x, z, x, 30])) });
/** a working yard: two staggered rows of houses on the slope, and stalls out in the open between them */
const terrace = (first, h) => ({ houses: [[-15, -13, -15, 0], [0, -15, 0, 0], [15, -13, 15, 0], [-9, 13, -9, 0], [9, 13, 9, 0]].map(homeAt(first, h)), stalls: [[-14, -2, -14, 4, "food"], [0, -4, 0, 4, "rent"], [14, -2, 14, 4, "food"]].map(([x, z, tx, tz, w]) => stallAt(w)([x, z, tx, tz])) });
export const ISLANDS = {
  home: { name: "Your Turtle", biome: "Meadow", clear: [0, 1, 6], a: 150, b: 112, seed: 3, deep: 34, palette: { sand: 0xf6e6bb, low: 0xa9e07a, mid: 0x8fd16b, high: 0xb7b3a3, snow: 0xf0f5f7 },
    peaks: [[120, -12, 34, 18]],
    flats: [{ x: -42, z: 14, r: 46, h: 9.8 }, { x: 34, z: -6, r: 40, h: 13 }, { x: -38, z: -68, r: 30, h: 17, wall: true }, { x: 92, z: -46, r: 25, h: 30, wall: true }, { x: 112, z: 26, r: 9, h: 39, wall: true }, { x: -6, z: -92, r: 7, h: 46, wall: true }, { x: 36, z: 98, r: 10, h: 6, pier: true }],
    roads: [{ from: [36, 30, 13], to: [36, 92, 6], w: 4.5 }, { from: [-108, 4, 3.6], to: [-84, 8, 9.8], w: 4.5 }, { from: [-46, -22, 9.8], to: [-40, -44, 17], w: 4 }, { from: [50, -26, 13], to: [76, -50, 30], w: 4 }, { from: [-140, 0, 2.4], to: [-108, 4, 3.6], w: 3.2 }],
    flora: homeFlora },
  willowmere: { name: "Willowmere", biome: "Golden plains", a: 104, b: 82, seed: 11, deep: 26, palette: { sand: 0xf3e2b5, low: 0xf0c060, mid: 0xe3a24f, high: 0xb7b3a3, snow: 0xf0f5f7, path: 0xcfa876 },
    peaks: [[-34, -40, 14, 22]], flats: [{ x: 8, z: 12, r: 42, h: 9.8 }, { x: 0, z: -70, r: 10, h: 6, pier: true }], roads: [{ from: [6, -8, 9.8], to: [0, -28, 9.8], w: 4.5 }, { from: [0, -28, 9.8], to: [0, -62, 6], w: 4.5 }], town: true, dock: { off: [36, 208] },
    density: 1, flora: () => [[`${TREE}Tree_`, 10, 110, 1, 0.7], [`${TREE}Pine_`, 5, 50, 1, 0.6], [`${TREE}Birch_`, 10, 60, 1, 0.5]],
    houses: [...ring(0, 11, 34, 7.5, 0, 0, -Math.PI / 2), house("TowerWindmill", 40, 40, 13, -2.2), house("Well", 18, -14, 2.6, 0)],
    places: { seeds: [-2, 12], fish: [-4, 0], square: [18, 6], inn: [24, 22], well: [8, 24], home1: [-14, 6], home2: [26, 4], home3: [-12, 22], board: [-6, 30], market: [18, 4] },
    plaza: [0, 0], stalls: [[-12, 0, 1.57, "wren"], [12, -8, -1.57, "market"], [-12, 14, 1.57, "rent"], [14, 8, -1.57, "rent"], [-2, -14, 3.14, "rent"], [4, 26, 0, "rent"], [-14, -12, 0.8, "bram"]] },
  dune: { name: "Sunback", biome: "Desert", a: 120, b: 92, seed: 21, deep: 28, route: { r: 800, speed: 0.0042, phase: 1 }, palette: { sand: 0xf1d596, low: 0xe9c777, mid: 0xdcb565, high: 0xc98f5a, snow: 0xf0d9a8, path: 0xd4ad72 },
    peaks: [[40, -30, 22, 26]], flats: [{ x: -14, z: 8, r: 36, h: 9.8 }], flora: () => [[`${GROWN}Cactus_`, 5, 60, 1.6, 0.6], [`${GROWN}CactusFlowers_`, 2, 16, 1.4, 0.6], [`${GROWN}PalmTree_`, 3, 18, 1.5, 0.6]], stones: `${GROWN}Rock_`, density: 1.3, nodes: [["sandstone", 16], ["ore", 8]],
    houses: [...street(2, 6.5).houses, house("Well", 34, 0, 2.6, 0)], stalls: street(2, 6.5).stalls, tint: 0xf2cf9a, folk: 18, places: { forge: [-8, 6], well: [4, 10], home: [-16, -8] }, carving: [40, -30, 34] },
  frost: { name: "Hoarshell", biome: "Frozen", a: 112, b: 88, seed: 29, deep: 28, route: { r: 1280, speed: 0.0031, phase: 3.6 }, palette: { sand: 0xdfe8ee, low: 0xeaf2f6, mid: 0xdbe7ee, high: 0xbfd2de, snow: 0xffffff, path: 0xcdd9e2 },
    peaks: [[-30, -30, 26, 26]], flats: [{ x: 16, z: 12, r: 34, h: 9.8 }], flora: () => [[`${GROWN}PineTree_Snow_`, 5, 70, 1.7, 0.6], [`${GROWN}CommonTree_Snow_`, 5, 20, 1.5, 0.6]], stones: `${GROWN}Rock_Snow_`, density: 1.4, nodes: [["crystal", 10], ["stone", 10]],
    houses: [...huddle(5, 6.5).houses, house("Well", 0, 2, 2.6, 0)], stalls: huddle(5, 6.5).stalls, tint: 0xe6eff8, folk: 18, places: { cellar: [-6, -4], well: [4, 8], home: [-12, 6] }, carving: [-30, -30, 30] },
  mire: { name: "Mirewalk", biome: "Swamp", a: 100, b: 80, seed: 37, deep: 26, route: { r: 1040, speed: 0.0036, phase: 5.2 }, palette: { sand: 0xbfb582, low: 0x7f9a5e, mid: 0x6d8a57, high: 0x7c7a64, snow: 0xa8b090, path: 0x8f8560 },
    peaks: [[30, -26, 12, 20]], flats: [{ x: -12, z: 10, r: 32, h: 7 }], flora: () => [[`${GROWN}Willow_`, 5, 60, 1.6, 0.7], [`${GROWN}Willow_Dead_`, 5, 24, 1.5, 0.6], [`${MEGA}TwistedTree_`, 5, 20, 1.1, 0.6]], stones: `${GROWN}Rock_Moss_`, density: 1.4, nodes: [["wildcap", 18], ["herb", 14]], flower: "Mushroom_Laetiporus",
    houses: [...lane(8, 6).houses, house("Well", -1, -16, 2.6, 0)], stalls: lane(8, 6).stalls, tint: 0xb9c79c, folk: 18, places: { herbal: [-6, -2], well: [4, 10], home: [-10, 8] }, carving: [30, -26, 20] },
  palm: { name: "Coralcrest", biome: "Tropical", a: 106, b: 84, seed: 43, deep: 26, route: { r: 560, speed: 0.0049, phase: 2.4 }, palette: { sand: 0xfff0c8, low: 0x72d98a, mid: 0x54c47e, high: 0xb59a7a, snow: 0xcff5d0, path: 0xe8d6a4 },
    peaks: [[26, 30, 26, 26]], flats: [{ x: -20, z: -10, r: 34, h: 8 }], flora: () => [[`${GROWN}PalmTree_`, 4, 90, 1.8, 0.6], [`${MEGA}CommonTree_`, 5, 30, 1.2, 0.7]], stones: `${GROWN}Rock_`, density: 1.6, nodes: [["berry", 14], ["pearl", 3], ["fiber", 10]],
    houses: [...beachRow(11, 6.5).houses, house("Well", 0, 12, 2.6, 0)], stalls: beachRow(11, 6.5).stalls, tint: 0xfff0d0, folk: 18, places: { stand: [-6, -6], well: [4, 6], home: [-10, 8] } },
  ember: { name: "Emberback", biome: "Volcanic", a: 110, b: 88, seed: 53, deep: 30, route: { r: 1520, speed: 0.0026, phase: 0.2 }, palette: { sand: 0x4a4348, low: 0x5c5258, mid: 0x4c444c, high: 0x8e3e2c, snow: 0xe2703a, path: 0x6d6066 },
    peaks: [[0, -20, 46, 30]], flats: [{ x: -30, z: 24, r: 28, h: 8 }], flora: () => [[`${GROWN}CommonTree_Dead_`, 5, 40, 1.4, 0.6], [`${GROWN}BirchTree_Dead_`, 5, 20, 1.3, 0.5]], stones: `${GROWN}Rock_`, density: 1.3, nodes: [["cinder", 12], ["ore", 12]],
    houses: [...terrace(1, 6).houses, house("Silo", 22, 12, 8, 0)], stalls: terrace(1, 6).stalls, tint: 0xc7a79a, folk: 18, places: { yard: [-6, 6], well: [4, 8], home: [-8, -6] } },
  elder: { name: "The Elder", biome: "Ancient", a: 170, b: 130, seed: 61, deep: 44, hidden: true, route: { r: 1800, speed: 0.0015, phase: 4.2 }, palette: { sand: 0xd8d2bf, low: 0x8fb09a, mid: 0x7da08c, high: 0x8a8d8a, snow: 0xc9d2c8, path: 0xb8b2a0 },
    peaks: [[60, -30, 30, 40]], flats: [{ x: 0, z: 20, r: 54, h: 12 }], flora: () => [[`${GROWN}Willow_Dead_`, 5, 30, 1.8, 0.7], [`${TREE}DeadTree_`, 10, 40, 1.2, 0.6]], stones: `${GROWN}Rock_Moss_`, density: 0.5, nodes: [["relic", 6], ["stone", 12]],
    ruins: true, places: {}, folk: 0 },

  // ---------- the far turtles: no towns, only what the Shellwrights left and the dinosaurs born there. Each keeps one verse of the Waking Song (VERSES).
  // reveal: the flag that puts it on your map. feature: what explore.js builds on it ----------
  bloom: { name: "Bloomdrift", biome: "Wildflower meadow", a: 130, b: 100, seed: 71, deep: 28, hidden: true, reveal: "boat", feature: "meadow", route: { r: 2350, speed: 0.0021, phase: 0.8 }, palette: { sand: 0xf7ecc8, low: 0xb8e88a, mid: 0x9ad877, high: 0xc9c2b0, snow: 0xf6f2ff, path: 0xd9c79a },
    peaks: [[40, -30, 18, 20]], flats: [{ x: -10, z: 10, r: 44, h: 8 }], flora: () => [[`${TREE}Birch_`, 10, 40, 1.2, 0.5], [`${MEGA}CommonTree_`, 5, 30, 1.1, 0.6]], stones: `${GROWN}Rock_`, density: 1, nodes: [["berry", 20], ["fiber", 14], ["herb", 10]], flower: "Flower_4_Group", places: {}, folk: 0 },
  thorn: { name: "Thornwild", biome: "Raptor jungle", a: 150, b: 116, seed: 79, deep: 30, hidden: true, reveal: "verses", feature: "jungle", route: { r: 2600, speed: 0.0019, phase: 2.1 }, palette: { sand: 0xd8c890, low: 0x4f9a48, mid: 0x3f8a40, high: 0x6a7a5a, snow: 0xa8d0a0, path: 0x9a8a5a },
    peaks: [[-50, -40, 24, 22]], flats: [{ x: 0, z: 20, r: 34, h: 9 }], flora: () => [[`${MEGA}TwistedTree_`, 5, 90, 1.6, 0.8], [`${GROWN}Willow_`, 5, 50, 1.5, 0.7], [`${MEGA}CommonTree_`, 5, 40, 1.4, 0.6]], stones: `${GROWN}Rock_Moss_`, density: 1.5, nodes: [["berry", 16], ["wildcap", 10], ["herb", 10]], flower: "Mushroom_Laetiporus", places: {}, folk: 0 },
  pillar: { name: "Pillarback", biome: "Ancient city", a: 150, b: 118, seed: 83, deep: 32, hidden: true, reveal: "verses", feature: "city", route: { r: 2850, speed: 0.0017, phase: 3.9 }, palette: { sand: 0xe8dcc0, low: 0xbfc49a, mid: 0xaab08c, high: 0xc8bca0, snow: 0xe8e2d0, path: 0xd6c8a6 },
    peaks: [[70, -50, 20, 22]], flats: [{ x: 0, z: 0, r: 62, h: 11 }], flora: () => [[`${MEGA}TwistedTree_`, 5, 24, 1.3, 0.6], [`${TREE}DeadTree_`, 10, 16, 1.1, 0.5]], stones: `${GROWN}Rock_`, density: 0.6, nodes: [["relic", 8], ["stone", 14], ["sandstone", 8]], places: {}, folk: 0 },
  hollow: { name: "Hollowshell", biome: "Caverns", a: 140, b: 110, seed: 89, deep: 34, hidden: true, reveal: "verses", feature: "caves", route: { r: 3100, speed: 0.0016, phase: 5.4 }, palette: { sand: 0x9a948c, low: 0x7d8a6e, mid: 0x6e7466, high: 0x6a6870, snow: 0x9fd8e8, path: 0x8a8478 },
    peaks: [[0, -20, 46, 34], [56, 6, 26, 24], [-56, 0, 28, 26]], flats: [{ x: -10, z: 50, r: 28, h: 8 }], flora: () => [[`${GROWN}PineTree_`, 5, 30, 1.5, 0.6]], stones: `${GROWN}Rock_Moss_`, density: 0.8, nodes: [["ore", 14], ["crystal", 10], ["stone", 12]], places: {}, folk: 0 },
  fernwood: { name: "Fernhold", biome: "Dino forest", a: 170, b: 130, seed: 97, deep: 34, hidden: true, reveal: "verses", feature: "forest", route: { r: 3350, speed: 0.0015, phase: 1.3 }, palette: { sand: 0xe4d9a8, low: 0x5fb85a, mid: 0x4aa64e, high: 0x8a9a7a, snow: 0xd8f0c8, path: 0x9a8a5a },
    peaks: [[80, 40, 22, 22]], flats: [{ x: 10, z: -10, r: 40, h: 9 }], flora: () => [[`${TREE}Tree_`, 10, 150, 2.4, 1.2], [`${MEGA}CommonTree_`, 5, 60, 2, 0.8]], stones: `${GROWN}Rock_Moss_`, density: 1.3, nodes: [["herb", 16], ["wildcap", 12], ["fiber", 12]], places: {}, folk: 0 },
  reef: { name: "Lagoonback", biome: "Lagoon and reef", a: 150, b: 120, seed: 101, deep: 20, hidden: true, reveal: "verses", feature: "lagoon", route: { r: 3600, speed: 0.0014, phase: 4.6 }, palette: { sand: 0xfff4d0, low: 0x7fe0a0, mid: 0x60c88a, high: 0xc8b08a, snow: 0xe8fff0, path: 0xe8d6a4 },
    peaks: [[50, 40, 14, 16]], flats: [{ x: -30, z: -20, r: 36, h: 5 }], flora: () => [[`${GROWN}PalmTree_`, 4, 70, 1.8, 0.6]], stones: `${GROWN}Rock_`, density: 1.2, nodes: [["pearl", 6], ["berry", 10], ["fiber", 8]], places: {}, folk: 0 },
  mist: { name: "Mistcrown", biome: "Cloud peaks", a: 124, b: 98, seed: 107, deep: 34, hidden: true, reveal: "verses", feature: "peaks", route: { r: 3850, speed: 0.0013, phase: 0.2 }, palette: { sand: 0xd8dce6, low: 0x9cc4a8, mid: 0x8ab494, high: 0xb0b4c4, snow: 0xffffff, path: 0xb8bcc8 },
    peaks: [[10, -10, 64, 40], [50, -40, 36, 24]], flats: [{ x: -50, z: 34, r: 24, h: 7 }], flora: () => [[`${MEGA}Pine_`, 5, 60, 1.5, 0.6]], stones: `${GROWN}Rock_Snow_`, density: 0.9, nodes: [["crystal", 8], ["stone", 10]], places: {}, folk: 0 },
  salt: { name: "Glassflat", biome: "Salt flats", a: 160, b: 120, seed: 113, deep: 28, hidden: true, reveal: "verses", feature: "saltflat", route: { r: 4100, speed: 0.0012, phase: 2.9 }, palette: { sand: 0xf4f0e6, low: 0xece6da, mid: 0xe2dccf, high: 0xc9c0b4, snow: 0xffffff, path: 0xd8d0c0 },
    peaks: [[60, -50, 20, 18]], flats: [{ x: 0, z: 0, r: 70, h: 6 }], flora: () => [[`${GROWN}Cactus_`, 5, 20, 1.4, 0.6]], stones: `${GROWN}Rock_`, density: 0.5, nodes: [["crystal", 12], ["sandstone", 14], ["ore", 6]], places: {}, folk: 0 },
};
// the Waking Song, broken in eight by the Shellwrights after the storm so no single storm could take it again. One verse to a far turtle, and a talent to reach it.
// needs: what a dinosaur near you (or under you) must be able to do; any one of them will do
export const VERSES = [
  { id: "v1", land: "bloom", x: -10, z: 30, needs: null, where: "in the flower ring", text: "Little shell, the sea is wide, / but every wave comes home." },
  { id: "v2", land: "pillar", x: 0, z: -6, needs: ["sniff"], where: "under the old plaza", hint: "There's a door under these flagstones. Something with a good nose could find the seam.", text: "We built you streets of sun and stone, / so you would never sleep alone." },
  { id: "v3", land: "hollow", x: -10, z: 30, needs: ["smash"], where: "behind the fallen rock", hint: "The cave's blocked. We'd need a dinosaur that breaks rock with its head or tail.", text: "When storms came down we kept the light / in hollow places, through the night." },
  { id: "v4", land: "fernwood", x: 10, z: -10, needs: ["reach", "fly"], where: "high in the giant ferns", hint: "It's up in the canopy. A long neck could lift us, or wings.", text: "The tall ones bow to hear your name; / the old green forest says the same." },
  { id: "v5", land: "mist", x: 10, z: -10, needs: ["fly"], where: "on the highest peak", hint: "Only wings get up here. We should come back flying.", text: "Above the cloud, the wind will learn / the way you swam, and your return." },
  { id: "v6", land: "reef", x: -30, z: -50, needs: ["dive", "swim"], where: "under the lagoon", hint: "It's on the lagoon floor. We need a dinosaur that dives.", text: "Under the water, slow and deep, / your mother's heartbeat guards your sleep." },
  { id: "v7", land: "thorn", x: 0, z: 20, needs: ["slash"], where: "inside the thorn wall", hint: "Thorns, all the way round. Something with claws or a spiked tail could cut us in.", text: "The sharp and small, the quick and bold, / will clear the way, as they were told." },
  { id: "v8", land: "salt", x: 0, z: 10, needs: ["dig"], where: "under the salt crust", hint: "It's buried in the salt. We'd need a digger.", text: "And when the eight are sung as one, / wake, little Pell. The night is done." },
];
export const BRIDGE = { open: 9, close: 20, arrive: 7, repair: { wood: 30, stone: 15, money: 200 } };   // hours Willowmere stays moored, and what the winches cost to mend
export const BOAT = { speed: 15, cost: { plank: 30, rope: 6, money: 400 } };
export const FERRY = 150;                                    // the bell at the dock calls a ferry to any turtle you've landed on
// things in the way, and what gets past them. Each is one obstacle on your turtle
export const GATES = [
  { id: "logs", name: "Logjam", land: "home", x: -41, z: -40, r: 7, needs: "chop", tool: ["axe", 1], lines: "A jam of fallen trunks. An Improved Axe would do it, or a dinosaur that chops." },
  { id: "boulder", name: "Boulder", land: "home", x: 63, z: -38, r: 5.6, needs: "smash", lines: "That boulder won't move for us. Maybe if we rode a strong dinosaur into it?" },
];
export const SECRETS = [
  { id: "ledge", name: "The Climbers' Ledge", land: "home", x: 112, z: 26, needs: "climb", gives: { relic: 1, money: 300 }, lines: ["Someone left a cairn up here, long before any of us."] },
  { id: "skyshrine", name: "The Sky Shrine", land: "home", x: -6, z: -92, needs: "fly", flag: "shrine", lines: ["A shrine. It faces the same way as every carving."] },
  { id: "tunnel", name: "Soft Ground", land: "home", x: -24, z: -56, needs: "dig", gives: { ore: 6, relic: 1 }, lines: ["There's a tunnel! Somebody stored this here."] },
  { id: "wreck", name: "Sunken Wreck", land: null, x: -300, z: 170, needs: "swim", gives: { pearl: 2, money: 500 }, lines: ["A wreck, down in the green. The name on it has been worn away."] },
];
// the carvings tell the turtles' story. Each is in a place you have to reach
export const CARVINGS = [
  { id: "c1", land: "home", x: 92, z: -46, needs: "boulder", text: "Two great turtles side by side, and between them, a very small one." },
  { id: "c2", land: "dune", x: 40, z: -30, text: "The small turtle alone. A storm. The two great ones turning back." },
  { id: "c3", land: "frost", x: -30, z: -30, text: "The great pair searching the cold seas, year after year." },
  { id: "c4", land: "mire", x: 30, z: -26, text: "People on their shells, tending soil, watching the water for them." },
  { id: "c5", land: "elder", x: 0, z: -6, text: "An ancient turtle, and the little one asleep under her shell, safe." },
];

// where people stand: named places on an island, in its own space. schedule: [hour, place]
export const NPCS = {
  tilly: { name: "Tilly", role: "Runs the supply cart", land: "home", model: "ultimate_modular_women/Casual.gltf", shop: "tilly", at: [6, -4], schedule: [[0, "cart"]], places: { cart: [6, -4] },
    talk: ["Seeds, feed, fertiliser. If it grows, I've got something for it.", "Anything you drop in the bin by the house, I'll pick up overnight.", "Better prices across the bridge, I admit. If it ever opens."] },
  wren: { name: "Wren", role: "Seed seller", model: "ultimate_modular_women/Worker.gltf", shop: "seeds", schedule: [[6, "home1"], [8, "seeds"], [12, "square"], [13, "seeds"], [18, "square"], [21, "home1"]],
    talk: ["Morning! Fresh seed came in on the tide.", "Rain's good for the plots. Less hauling for you.", "Your turtle's looking well. Does it ever sleep?"] },
  mara: { name: "Mara", role: "Runs the Grand Market", model: "ultimate_modular_women/Suit.gltf", shop: "market", schedule: [[0, "market"]],
    talk: ["Seeds, timber, tractors. If you can name it, I can sell it.", "Rent a stall by the fountain! Good foot traffic.", "They say the two turtles have been married longer than this town has stood."] },
  bram: { name: "Bram", role: "Fish buyer", model: "ultimate_modular_men/Beach.gltf", shop: "fish", schedule: [[5, "fish"], [12, "well"], [13, "fish"], [19, "inn"], [22, "home2"]],
    talk: ["Tail shore's the place to fish, if you've patience.", "There's a lantern fish that only bites past dark.", "Saw something huge go under us last night. Not a turtle."] },
  moss: { name: "Old Moss", role: "Keeper of the turtles' story", model: "ultimate_modular_women/Formal.gltf", schedule: [[7, "well"], [11, "square"], [16, "inn"], [20, "home3"]],
    talk: ["Oma and Tarn have never once moored more than a day's swim apart.", "They call for someone at night. Listen for it.", "If you find old carvings, bring them to me. They tell a family's story."] },
  ferra: { name: "Ferra", role: "Blacksmith of Dustwick", land: "dune", model: "ultimate_modular_women/Soldier.gltf", shop: "dust", schedule: [[6, "home"], [8, "forge"], [19, "well"], [22, "home"]],
    talk: ["Bring me ore and I'll make that tool of yours worth carrying.", "Sand gets in everything. You'll find it in your boots for a year.", "Old stones turn up when the dunes shift. Nobody here reads them."] },
  ona: { name: "Ona", role: "Ice cutter of Rimewatch", land: "frost", model: "ultimate_modular_women/Adventurer.gltf", shop: "frost", schedule: [[7, "home"], [9, "cellar"], [18, "well"], [21, "home"]],
    talk: ["Crystals grow where the shell stays coldest. Don't ask me why.", "This turtle goes further north every year.", "Winter broccoli. Don't laugh. It keeps us alive."] },
  fen: { name: "Fen", role: "Herbalist of Mirewalk", land: "mire", model: "ultimate_modular_men/Worker.gltf", shop: "mire", schedule: [[6, "home"], [8, "herbal"], [17, "well"], [21, "home"]],
    talk: ["Mind the soft ground. It remembers things.", "This one sings at night. A long low note. Yours too, I expect.", "If you've got something that digs, the marsh is full of secrets."] },
  luma: { name: "Luma", role: "Fruit trader of Coralcrest", land: "palm", model: "ultimate_modular_women/Casual.gltf", shop: "palm", schedule: [[7, "home"], [9, "stand"], [18, "well"], [22, "home"]],
    talk: ["Fruit trees take patience, but then they don't stop.", "Pearls wash up after storms. Lucky for me, it storms a lot.", "A sapling from here will grow anywhere. Mostly."] },
  cole: { name: "Cole", role: "Cinder gatherer", land: "ember", model: "ultimate_modular_men/Worker.gltf", shop: "ember", schedule: [[7, "home"], [9, "yard"], [18, "well"], [22, "home"]],
    talk: ["It's warm. I'll give it that.", "She's the oldest of the working turtles, this one.", "The heat comes from inside the shell. Think about that a while."] },
  drift: { name: "Sable", role: "The Wandering Merchant", land: "home", model: "ultimate_modular_men/Adventurer.gltf", shop: "rare", visiting: true, schedule: [[0, "dock"]], places: { dock: [-136, 10] },
    talk: ["I go where the turtles go. Hard to keep a shop still out here.", "I've seen a turtle with a whole city on it. Maybe you will too.", "Rare goods, fair prices, no questions."] },
};
export const NPC_MODELS_SEEN = Object.keys(NPCS);

// what your companion says, and when. once: only the first time; cool: seconds before it can come again
export const COMPANION = {
  name: "Vermeil", model: "../models/anime_girl.glb",
  idle: ["This turtle's breathing is the calmest thing I've ever stood on.", "Do you think it knows we're here?", "I've been counting the birds. Lost count. Twice.", "Every morning those two turtles swim back to each other. I find that very sweet.", "Listen tonight. They sing to someone."],
  moments: {
    start: { once: true, lines: ["We're really standing on a living turtle.", "Let's start with the farm. Find flat ground, turn some soil with the hoe, then plant and water."] },
    first_till: { once: true, lines: ["Nice soil. Whatever this turtle eats, it's good for carrots."] },
    first_harvest: { once: true, lines: ["Your first harvest! Put some in the bin by the house and Tilly will pay you overnight."] },
    bridge: { once: true, lines: ["Look! The bridges are coming down.", "I think we're actually going to another island."] },
    bridge_broke: { once: true, lines: ["That big drawbridge has been stuck up for years. The winch is rusted through.", "If we brought wood, stone and a few shells, we could mend it."] },
    town: { once: true, lines: ["A whole town. On a turtle. And they hang their washing out like it's nothing."] },
    rain: { cool: 240, lines: ["Rain. The plots water themselves today. I'm keeping dry."] },
    fish: { cool: 120, lines: ["That's a good catch. Very wiggly."] },
    dino: { once: true, lines: ["It likes you already. That crest is ridiculous, and I love it."] },
    carving: { once: true, lines: ["This isn't just old. It's older than any town we've visited.", "Two big turtles and one tiny one. That looks like a family."] },
    night: { cool: 300, lines: ["It's late. The bed's in the house whenever you're ready."] },
    evolve: { cool: 30, lines: ["Look at that. Same eyes, whole new dinosaur."] },
    evolve_ready: { cool: 200, lines: ["Something's changing in your dinosaur. Go and see it."] },
    new_dino: { cool: 30, lines: ["You've made a friend. I saw that coming about two carrots ago."] },
    boat: { once: true, lines: ["A boat of our own. That's every turtle out there within reach."] },
    new_isle: { cool: 20, lines: ["Look at it all. I wonder what they grow here."] },
    sea: { cool: 400, lines: ["No land in sight. Only turtles. I love how normal that sounds now."] },
    home_again: { cool: 400, lines: ["Home. You can feel it breathing again."] },
    big_harvest: { cool: 300, lines: ["That's a proper harvest. Whoever thought a turtle could feed this many?"] },
    ruins: { once: true, lines: ["This isn't a turtle town. Somebody built this before there were towns."] },
    storm: { cool: 300, lines: ["Hold on to something. The turtle's chin just went up. It's enjoying this."] },
    rare: { cool: 60, lines: ["Oh, that one's special. Don't sell it too quickly."] },
    festival: { cool: 600, lines: ["There's music coming from somewhere. It's festival day!"] },
    scent: { cool: 90, lines: ["Look at its nose going. It's caught something.", "Warmer... it's definitely after something round here."] },
    rare_find: { cool: 30, lines: ["Nobody else could have found that. Good nose!"] },
    verse: { cool: 10, lines: ["Another verse. It sounds like a lullaby, doesn't it?"] },
    far_isle: { cool: 60, lines: ["No town, no people. Just the Shellwrights' old stones, and dinosaurs nobody's named yet."] },
    travel: { once: true, lines: ["Now that's fast. The far turtles don't feel so far any more."] },
  },
};

// ---------------- the story: ten arcs, each step a check against what has happened ----------------
export const ARCS = ["Start the farm", "The first neighbour", "The old couple", "Why they keep moving", "What the desert remembers", "Their lost child", "The Elder", "The truth", "The broken song", "The keepers' verses", "The long search", "Home"];
const carvings = (s) => Object.keys(s.carved || {}).length;
export const versesOf = (s) => Object.keys(s.verses || {}).length;
const tamedFrom = (s, isles) => (s.dinos || []).some((r) => isles.includes(DINOS[r.species]?.home));
export const STORY = [
  { id: "plant", arc: 0, text: "Till flat ground, plant and water a crop", done: (s) => s.flags.planted },
  { id: "harvest", arc: 0, text: "Wait for the ! bubble, then harvest your first crop", done: (s) => s.flags.harvested },
  { id: "ship", arc: 0, text: "Put something in the shipping bin by the house", done: (s) => s.flags.shipped },
  { id: "friend", arc: 0, text: "Feed Sprig a carrot", done: (s) => s.flags.fed },
  { id: "bridge", arc: 1, text: "Mend the winch by the south drawbridge", done: (s) => s.flags.bridgeFixed },
  { id: "town", arc: 1, text: "Cross when Willowmere moors (9:00 to 20:00)", done: (s) => s.flags.town },
  { id: "moss", arc: 2, text: "Meet Old Moss in Willowmere", done: (s) => s.met["Old Moss"] },
  { id: "boulder", arc: 2, text: "Ride Sprig and smash the boulder on the high road", done: (s) => s.flags.boulder },
  { id: "c1", arc: 3, text: "Find what's up in the High Meadow", done: (s) => s.carved?.c1 },
  { id: "show", arc: 3, text: "Ask Old Moss what the carving means", done: (s) => s.flags.moss },
  { id: "boat", arc: 3, text: "Mend the old boat at your dock", done: (s) => s.flags.boat },
  { id: "bloom", arc: 3, text: "Sail out to Bloomdrift, the wildflower turtle now on your map, and read the stone in its flower ring", done: (s) => s.verses?.v1 },
  { id: "dune", arc: 4, text: "Sail to Sunback, the desert turtle", done: (s) => s.seenIsles.dune },
  { id: "travel", arc: 4, text: "Befriend a fast traveller: a Strider on Willowmere, or a Galewing on Sunback", done: (s) => (s.dinos || []).some((r) => DINOS[r.species]?.travel) },
  { id: "c2", arc: 4, text: "Find the carving on Sunback's high rock", done: (s) => s.carved?.c2 },
  { id: "sniff", arc: 4, text: "Ride the right dinosaur on its own turtle and let it sniff out something rare", done: (s) => Object.keys(s.rare || {}).length > 0 },
  { id: "c3", arc: 5, text: "Find the carving on Hoarshell, the frozen turtle", done: (s) => s.carved?.c3 },
  { id: "c4", arc: 5, text: "Find the carving on Mirewalk, the swamp turtle", done: (s) => s.carved?.c4 },
  { id: "chart", arc: 5, text: "Bring your findings to Old Moss", done: (s) => s.flags.chart },
  { id: "elder", arc: 6, text: "Find The Elder, now marked on your map", done: (s) => s.seenIsles.elder },
  { id: "c5", arc: 6, text: "Read the deepest carving in the ruins", done: (s) => s.carved?.c5 },
  { id: "truth", arc: 7, text: "Tell Old Moss what you found", done: (s) => s.flags.truth },
  { id: "portal", arc: 7, text: "Stand on the stone dais in the heart of the Elder's ruins and open the way to Pell", done: (s) => s.flags.portal },
  { id: "verses", arc: 8, text: "Ask Old Moss why the Elder's song is too quiet to reach", done: (s) => s.flags.verses },
  { id: "v2", arc: 8, text: "Pillarback, the ancient city: let a sniffer find the door under the plaza", done: (s) => s.verses?.v2 },
  { id: "v3", arc: 8, text: "Hollowshell, the caverns: break through to the deep cave with a rock-smasher", done: (s) => s.verses?.v3 },
  { id: "v7", arc: 8, text: "Thornwild, the raptor jungle: cut through the thorn wall with a slasher", done: (s) => s.verses?.v7 },
  { id: "native", arc: 8, text: "Befriend a dinosaur born on one of the far turtles", done: (s) => tamedFrom(s, ["bloom", "pillar", "hollow", "fernwood", "mist", "reef", "thorn", "salt"]) },
  { id: "v4", arc: 9, text: "Fernhold, the dino forest: reach the verse high in the giant ferns (a long neck, or wings)", done: (s) => s.verses?.v4 },
  { id: "v6", arc: 9, text: "Lagoonback: dive for the verse on the lagoon floor", done: (s) => s.verses?.v6 },
  { id: "v8", arc: 9, text: "Glassflat, the salt flats: dig the verse out of the crust with a digger", done: (s) => s.verses?.v8 },
  { id: "v5", arc: 9, text: "Mistcrown: fly to the highest peak for the final verse", done: (s) => s.verses?.v5 },
  { id: "whole", arc: 9, text: "Bring all eight verses to Old Moss", done: (s) => s.flags.whole },
  { id: "grow", arc: 10, text: "Grow the Heartseed on your turtle", done: (s) => s.flags.bloomed },
  { id: "shrine", arc: 11, text: "Carry the Heartbloom to the Sky Shrine and call Pell home (a flyer can reach it)", done: (s) => s.flags.finale },
  { id: "free", arc: 11, text: "Pell is coming home. Your farm, your turtle, what next?", done: () => false },
];
// who says what, once, when the story says so: the deeper tale
export const TALES = [
  { who: "moss", need: (s) => s.carved?.c1 && !s.flags.moss, set: "moss", gives: { money: 200 }, lines: ["Oh... you found the first one. Then it's time you knew.", "Your turtle is Oma. Willowmere rides on Tarn. They are husband and wife, and they've been together longer than there have been towns.", "See the small one between them? That's their child. Pell.", "A storm took Pell centuries ago. Every migration, every mooring, every morning they meet by your bridge... they are still looking.", "That's why we live on their backs, dear. Our people swore to keep watch. You'll want a boat."] },
  { who: "moss", need: (s) => Object.keys(s.carved || {}).length >= 4 && !s.flags.chart, set: "chart", lines: ["So they turned back, and searched the cold seas, and our grandmothers watched the water.", "But this last one says something new. Somebody has been sheltering Pell.", "There's a turtle older than all my charts. The Elder. I've marked where she should be. Go gently."] },
  { who: "moss", need: (s) => s.carved?.c5 && !s.flags.truth, set: "truth", lines: ["The Elder took Pell in. All this time the child has been asleep, safe under her shell, too small to swim home alone.", "A turtle wakes to the song of its mother. That's what Oma and Tarn have been calling, every night, across the whole ocean.", "They just can't sing loud enough to reach so far.", "Go back to the Elder. There's a stone dais in the heart of her ruins. Stand on it and see for yourself."] },
  { who: "moss", need: (s) => s.flags.truth && s.flags.portal && !s.flags.verses, set: "verses", lines: ["You saw Pell. Asleep, and so small... Oh, my dear.", "Then you'll want the rest of it. Oma and Tarn's song isn't only quiet. It's broken.", "The night of the storm, the Shellwrights, the first people who ever lived on a turtle's back, sang the Waking Song to call Pell home. It didn't carry.", "So they did something clever and something sad. They split the song into eight verses and carried each one to a different young turtle, so no single storm could ever take the whole of it again.", "Then they let the creatures of each turtle keep their verse. Only a dinosaur with the right gift can reach one.", "You found the first already, on Bloomdrift. I've marked the other seven on your map. Bring me every verse, and I'll give you what the Elder gave me to keep."] },
  { who: "moss", need: (s) => versesOf(s) >= 8 && !s.flags.whole, set: "whole", gives: { heartseed_seed: 1, money: 1500 }, lines: ["All eight. Let me hear them together... yes. Yes, that's it. I'd only ever had the first line.", "This seed was in the Elder's ruin. I've kept it for forty years, waiting for someone to bring the song.", "A Heartbloom holds a song. Grow it on Oma's back with all eight verses in your head, and carry it to the Sky Shrine. Then sing."] },
  // the towns help: each one has heard of a far turtle, once the song is out
  { who: "ferra", need: (s) => s.flags.verses && !s.flags.h_salt, set: "h_salt", gives: { ore: 6 }, lines: ["A song in eight pieces, is it? My grandmother sang one bit while she worked the forge.", "She said it came from Glassflat, a turtle crusted white with salt, way out past the deep water. Take a digger. And ore, for the road."] },
  { who: "ona", need: (s) => s.flags.verses && !s.flags.h_mist, set: "h_mist", gives: { crystal: 3 }, lines: ["On clear nights you can see Mistcrown from the ice. A turtle with mountains on its back, higher than the clouds.", "Nobody's ever climbed it. You'd need wings. Big ones. The Galewings nest on Sunback, if you're brave."] },
  { who: "fen", need: (s) => s.flags.verses && !s.flags.h_thorn, set: "h_thorn", gives: { herb: 6 }, lines: ["Thornwild. I've seen it pass. A jungle so thick it rustles from here.", "The raptors there are kind, mostly, but the thorns aren't. Something with claws will cut you a way. And Fernhold beyond it: ferns as tall as towers."] },
  { who: "luma", need: (s) => s.flags.verses && !s.flags.h_reef, set: "h_reef", gives: { pearl: 1 }, lines: ["Lagoonback! The prettiest turtle in the sea. Her shell holds a whole lagoon.", "Pearl divers swear there's a carved stone on the lagoon floor. Ride a diver down to it. Here, for luck."] },
  { who: "cole", need: (s) => s.flags.verses && !s.flags.h_hollow, set: "h_hollow", gives: { cinder: 2 }, lines: ["Hollowshell. All caves. The Shellwrights hid there through the storm years, they say, and kept lamps burning in the rock.", "There's a cave mouth nobody's opened since. Rockfall. You'd need a head like a hammer."] },
  { who: "drift", need: (s) => s.flags.verses && !s.flags.h_pillar, set: "h_pillar", gives: { relic: 1 }, lines: ["Pillarback. I told you I'd seen a turtle with a whole city on it. Empty streets, pillars, a plaza.", "The Shellwrights' coins still turn up there, if you have the nose for it. Small dinosaurs do. Take this. It came from there."] },
  { who: "moss", need: (s) => s.flags.finale && !s.flags.after, set: "after", gives: { money: 1000 }, lines: ["I heard it. The whole town stood up and went to the rail.", "Little Pell is awake, and swimming home. Look out past the far turtles.", "Centuries, and it took one farmer. Go and say hello. And then, dear, keep farming. They'll all be hungry."] },
];

export const FESTIVALS = [
  { season: 0, day: 7, name: "Planting Fair", kind: "crop", text: "Crops sell for half as much again today." },
  { season: 1, day: 10, name: "Fishing Tournament", kind: "fish", text: "Fish sell for double today, and bite twice as often." },
  { season: 2, day: 12, name: "Harvest Feast", kind: "made", text: "Anything you've made sells for half as much again." },
  { season: 3, day: 7, name: "Lantern Night", kind: "all", text: "All the turtles are lit tonight. Everything sells a little better." },
];

// a world's weather has more moods than rain; each is a line of what it changes
export const WEATHER = {
  sunny: { icon: "☀", dull: 1 }, cloudy: { icon: "⛅", dull: 0.8 }, rain: { icon: "🌧", dull: 0.55, wet: true }, heavy: { icon: "🌧", dull: 0.45, wet: true }, storm: { icon: "⛈", dull: 0.4, wet: true }, fog: { icon: "🌫", dull: 0.7, fog: 0.3 }, wind: { icon: "🍃", dull: 0.95 }, heat: { icon: "🥵", dull: 1.05 }, snow: { icon: "❄", dull: 0.8 }, aurora: { icon: "🌌", dull: 1 },
};
