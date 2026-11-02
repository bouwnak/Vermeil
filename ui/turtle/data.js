// data.js - everything the game is made of, as plain data: new crops, fish, dinosaurs, buildings, people and islands go here, not into code.
export const A = "../game/assets/";

export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"];
export const DAYS_IN_SEASON = 14;
export const SECONDS_PER_MINUTE = 0.8;      // one game day is about 19 minutes

// young plants come from the nature packs; ripe is what you pick, from the Ultimate Food Pack (or the plant itself for corn and wheat)
const FOOD = "conv_ultimate_food_pack/", GROWN = "conv_ultimate_nature_pack/", MEGA = "stylized_nature_megakit/", B = "conv_farm_buildings/", TREE = "conv_textured_stylized_trees/", SIMPLE = "conv_simple_nature_pack/";
export const CROPS = {
  carrot: { name: "Carrot", icon: "🥕", ripe: `${FOOD}Carrot.glb`, ripeSize: 0.7, seasons: [0, 2], days: 3, seed: 8, sell: 20, yield: 1, from: "tilly" },
  lettuce: { name: "Lettuce", icon: "🥬", ripe: `${FOOD}Lettuce_Whole.glb`, ripeSize: 0.6, seasons: [0], days: 4, seed: 10, sell: 28, yield: 1, from: "tilly" },
  turnip: { name: "Turnip", icon: "🟣", ripe: `${FOOD}Turnip.glb`, ripeSize: 0.6, seasons: [2, 3], days: 5, seed: 14, sell: 40, yield: 1, from: "tilly" },
  tomato: { name: "Tomato", icon: "🍅", ripe: `${FOOD}Tomato.glb`, ripeSize: 0.55, seasons: [1], days: 5, seed: 16, sell: 22, yield: 3, from: "seeds" },
  corn: { name: "Corn", icon: "🌽", ripe: `${GROWN}Corn_1.glb`, ripeSize: 1.9, seasons: [1, 2], days: 6, seed: 20, sell: 54, yield: 1, from: "seeds" },
  wheat: { name: "Wheat", icon: "🌾", ripe: `${GROWN}Wheat.glb`, ripeSize: 1.2, seasons: [1, 2], days: 4, seed: 9, sell: 26, yield: 1, from: "seeds" },
  pumpkin: { name: "Pumpkin", icon: "🎃", ripe: `${FOOD}Pumpkin.glb`, ripeSize: 0.95, seasons: [2], days: 8, seed: 34, sell: 120, yield: 1, from: "seeds" },
  pepper: { name: "Sun Pepper", icon: "🌶", ripe: `${FOOD}Pepper_Red.glb`, ripeSize: 0.55, seasons: [1], days: 6, seed: 28, sell: 42, yield: 2, from: "dust" },
  eggplant: { name: "Eggplant", icon: "🍆", ripe: `${FOOD}Eggplant.glb`, ripeSize: 0.7, seasons: [1, 2], days: 7, seed: 26, sell: 70, yield: 1, from: "dust" },
  broccoli: { name: "Frost Broccoli", icon: "🥦", ripe: `${FOOD}Broccoli.glb`, ripeSize: 0.7, seasons: [3], days: 6, seed: 30, sell: 90, yield: 1, from: "frost" },
  mushroom: { name: "Marsh Cap", icon: "🍄", ripe: `${FOOD}Mushroom.glb`, ripeSize: 0.55, seasons: [2, 3], days: 5, seed: 24, sell: 66, yield: 1, from: "mire" },
  apple: { name: "Apple", icon: "🍎", ripe: `${FOOD}Apple.glb`, ripeSize: 0.36, tree: `${GROWN}CommonTree_1.glb`, seasons: [0, 1, 2], days: 9, regrow: 4, seed: 120, sell: 30, yield: 3, from: "seeds" },
  orange: { name: "Orange", icon: "🍊", ripe: `${FOOD}Orange.glb`, ripeSize: 0.36, tree: `${GROWN}CommonTree_2.glb`, seasons: [1, 2], days: 10, regrow: 4, seed: 150, sell: 36, yield: 3, from: "palm" },
  banana: { name: "Banana", icon: "🍌", ripe: `${FOOD}Banana.glb`, ripeSize: 0.5, tree: `${GROWN}PalmTree_1.glb`, seasons: [1], days: 8, regrow: 3, seed: 170, sell: 42, yield: 3, from: "palm" },
  coconut: { name: "Coconut", icon: "🥥", ripe: `${FOOD}Coconut.glb`, ripeSize: 0.42, tree: `${GROWN}PalmTree_2.glb`, seasons: [0, 1, 2, 3], days: 12, regrow: 5, seed: 220, sell: 60, yield: 2, from: "palm" },
  heartseed: { name: "Heartbloom", icon: "💠", ripe: `${MEGA}Flower_4_Group.gltf`, ripeSize: 1.3, seasons: [0, 1, 2, 3], days: 7, seed: 0, sell: 0, yield: 1, story: true },
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
export const SKILLS = { water: "Watering", weed: "Weeding", harvest: "Harvesting", plant: "Planting", chop: "Chopping", mine: "Smashing rock", dig: "Digging", scout: "Scouting", carry: "Carrying" };
export const DINOS = {
  sprig: { line: "Crestback", icon: "🦕", forms: ["Crestling", "Crestback", "Grand Crestback"], sizes: [2.3, 3.6, 5.2], speed: [8.5, 10, 11.5], food: "carrot", ride: 0,
    skills: [["water"], ["water", "weed"], ["water", "weed", "plant"]], traits: { smash: 0 }, blurb: "Gentle and curious. Its crest sprays water over a field, and its head can crack a loose boulder.",
    shape: { hide: 0x86cf8f, belly: 0xfbeec1, accent: 0xf08a6e, legs: 4, crest: "fan", tail: 3 } },
  pebble: { line: "Pebblehorn", icon: "🦏", forms: ["Pebblehorn", "Cragbrow", "Mountainmaw"], sizes: [1.7, 3.4, 5.4], speed: [6, 7, 8], food: "turnip", ride: 1,
    skills: [["mine"], ["mine", "dig"], ["mine", "dig", "carry"]], traits: { smash: 0, heavy: 2 }, blurb: "Stubborn and warm-hearted. Walks through most things and apologises afterwards.",
    shape: { hide: 0xb08d6c, belly: 0xe9d7b5, accent: 0x6f5a4a, legs: 4, crest: "frill", horns: true, tail: 2 } },
  dash: { line: "Dashling", icon: "🦖", forms: ["Dashling", "Sprintail", "Galeclaw"], sizes: [1.5, 2.8, 3.8], speed: [11, 15, 19], food: "corn", ride: 1,
    skills: [["scout"], ["scout", "harvest"], ["scout", "harvest", "carry"]], traits: { fast: 1 }, blurb: "Always three steps ahead of the conversation. The fastest thing on land.",
    shape: { hide: 0x7ec7e8, belly: 0xf4f0da, accent: 0xf4b64a, legs: 2, crest: "feather", tail: 3 } },
  ripple: { line: "Ripplet", icon: "🐬", forms: ["Ripplet", "Wavecrest", "Tidecaller"], sizes: [1.6, 3.2, 4.8], speed: [9, 13, 16], food: "fish", ride: 1,
    skills: [["water"], ["water", "harvest"], ["water", "harvest", "carry"]], traits: { swim: 1 }, blurb: "Happier in the sea than out of it. Carries you across open water.",
    shape: { hide: 0x5fb6c9, belly: 0xdff4ef, accent: 0xf2a2b8, legs: 0, flippers: true, neck: 2, crest: "fin", tail: 2 } },
  feather: { line: "Featherkin", icon: "🦅", forms: ["Featherkin", "Skimwing", "Cloudsail"], sizes: [1.5, 3.2, 5], speed: [10, 15, 21], food: "tomato", ride: 1,
    skills: [["scout"], ["scout", "carry"], ["scout", "carry", "harvest"]], traits: { fly: 1 }, blurb: "Light as a kite and twice as nosy. Reaches what nothing else can.",
    shape: { hide: 0xe6a06c, belly: 0xfbe7c4, accent: 0x9a5fb0, legs: 2, wings: true, crest: "beak", tail: 1 } },
  nib: { line: "Nibbler", icon: "🐊", forms: ["Nibbler", "Sawback", "Timberjaw"], sizes: [1.5, 3, 4.6], speed: [6, 7.5, 9], food: "lettuce", ride: 1,
    skills: [["chop"], ["chop", "weed"], ["chop", "weed", "carry"]], traits: { chop: 0 }, blurb: "Eats saplings, trims hedges, feels no shame.",
    shape: { hide: 0xc3d36a, belly: 0xf3ecc0, accent: 0xd8573f, legs: 4, crest: "plates", tail: 3 } },
  burrow: { line: "Burrowlet", icon: "🦔", forms: ["Burrowlet", "Deepclaw", "Tunnelmaw"], sizes: [1.3, 2.8, 4.4], speed: [6, 7, 8.5], food: "mushroom", ride: 1,
    skills: [["dig"], ["dig", "mine"], ["dig", "mine", "scout"]], traits: { dig: 0 }, blurb: "Knows what's under everything, and will not stop telling you.",
    shape: { hide: 0x8f8fb8, belly: 0xdcd6ea, accent: 0x4f4f78, legs: 4, crest: "dome", club: true, tail: 2, armor: true } },
  hop: { line: "Hopling", icon: "🐐", forms: ["Hopling", "Ledgeram", "Cliffking"], sizes: [1.4, 2.8, 4], speed: [8, 10, 12], food: "wheat", ride: 1,
    skills: [["carry"], ["carry", "mine"], ["carry", "mine", "scout"]], traits: { climb: 1, jump: 1 }, blurb: "Treats a cliff as a suggestion. Takes you straight up rock faces.",
    shape: { hide: 0xe2d5c0, belly: 0xfff6e4, accent: 0x7a6a9c, legs: 4, crest: "dome", horns: true, tail: 1 } },
  neck: { line: "Stretchlet", icon: "🦒", forms: ["Stretchlet", "Longreach", "Skyneck"], sizes: [2, 4.4, 7], speed: [5, 6.5, 8], food: "apple", ride: 1,
    skills: [["harvest"], ["harvest", "plant"], ["harvest", "plant", "carry"]], traits: {}, blurb: "A very slow thinker with a very long view. The best orchard hand there is.",
    shape: { hide: 0xa9c6e6, belly: 0xeef2fb, accent: 0x5e86b8, legs: 4, neck: 3, crest: "none", tail: 3 } },
  star: { line: "Glimmerling", icon: "🌟", forms: ["Glimmerling", "Auroraback", "Dawnbringer"], sizes: [1.6, 3.6, 5.6], speed: [10, 14, 20], food: "heartseed_any", rare: true, ride: 1,
    skills: [["water", "harvest"], ["water", "harvest", "weed"], ["water", "harvest", "weed", "plant", "scout"]], traits: { fly: 2, swim: 2 }, blurb: "Nobody has seen one in a thousand years. It hums the same note the turtles do.",
    shape: { hide: 0xe9e2ff, belly: 0xfff6c8, accent: 0x7fe0d0, legs: 4, wings: true, crest: "fan", tail: 3 } },
};
export const WILD = [
  { species: "nib", land: "home", x: -44, z: -72, tames: 3 }, { species: "ripple", land: "home", x: -120, z: 42, tames: 3 }, { species: "hop", land: "home", x: 94, z: -48, tames: 3 },
  { species: "dash", land: "willowmere", x: 38, z: 38, tames: 3 }, { species: "pebble", land: "dune", x: -30, z: 20, tames: 3 }, { species: "feather", land: "frost", x: 20, z: -24, tames: 3 },
  { species: "burrow", land: "mire", x: 30, z: 16, tames: 3 }, { species: "neck", land: "palm", x: -30, z: -12, tames: 3 }, { species: "star", land: "elder", x: 0, z: 26, tames: 3, after: "finale" },
];
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
  ...Object.fromEntries(Object.entries(CROPS).filter(([, c]) => !c.story).flatMap(([k, c]) => [[k, { name: c.name, icon: c.icon, sell: c.sell, crop: true }], [`${k}_gold`, { name: `Golden ${c.name}`, icon: "✨", sell: c.sell * 4, crop: true, gold: true }], [`${k}_seed`, { name: `${c.name} ${c.tree ? "Sapling" : "Seeds"}`, icon: "🌰", seed: k }]])),
  heartseed: { name: "Heartbloom", icon: "💠", sell: 0 },
  ...Object.fromEntries(FISH.map((f) => [f.id, { name: f.name, icon: "🐟", sell: f.sell, fish: true }])),
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
export const BUILD_CATS = [["farm", "🌾 Farm"], ["buildings", "🏠 Buildings"], ["machines", "⚙ Machines"], ["fences", "🚧 Fences"], ["paths", "⛰ Paths"], ["plants", "🌸 Plants"], ["decor", "✨ Decor"], ["props", "🧺 Farm props"], ["vehicles", "🚜 Vehicles"]];
const cost = (money = 0, more = {}) => ({ money, ...more });
const P1 = "../games/asset_packs/lowpoly_farm_01/", V = "../games/asset_packs/farm_vehicles/";
const pack = (root, entries) => Object.fromEntries(entries.map(([k, label, cat, file, r, money, more = {}]) => [k, { label, cat, model: `${root}${file}.gltf`, r, cost: cost(money, more.cost), ...more, cost: cost(money, more.cost) }]));
export const CATALOG = {
  ...pack(P1, [["farmhouse", "Big Farmhouse", "buildings", "farmhouse_a01", 9, 3200, { cost: { plank: 60, brick: 40 } }], ["farmhouse2", "Country House", "buildings", "farmhouse_a02", 9, 3200, { cost: { plank: 60, brick: 40 } }], ["bigbuild", "Farm Hall", "buildings", "farmbuilding_a", 9, 2600, { room: 6, cost: { plank: 50, brick: 30 } }], ["garage", "Garage", "buildings", "garage_a01", 6.5, 900, { cost: { plank: 30, ore: 6 } }], ["littlehouse", "Guest Cottage", "buildings", "littlehouse_a", 3, 700, { cost: { plank: 24 } }], ["packcoop", "Hen House", "buildings", "coop_a", 1.9, 300, { use: "coop", cost: { plank: 12 } }], ["tower", "Grain Tower", "buildings", "farmstructure_a", 2.4, 900, { cost: { brick: 24 } }],
    ["longhouse", "Long Greenhouse", "farm", "greenhouse_a01", 0, 1200, { greenhouse: 5, cost: { plank: 20, crystal: 1 } }], ["straw", "Straw Bales", "farm", "strawpack_a", 0.9, 12, { cost: { fiber: 4 } }], ["feeder", "Feed Rack", "farm", "littlefoodholder_a", 1, 90, { use: "trough", cost: { plank: 5 } }], ["waterdish", "Water Trough", "farm", "waterdish_a", 0.9, 60, { cost: { plank: 4 } }], ["sprinklerb", "Field Sprinkler", "farm", "watersprinkler_a", 0.3, 180, { sprinkle: 5, cost: { ore: 2 } }], ["milktank", "Milk Churn", "farm", "milktank_a", 0.4, 40, { cost: { ore: 1 } }], ["bucket", "Bucket", "farm", "bucket_a", 0, 6, {}],
    ["gate", "Farm Gate", "fences", "gate_a", 0, 0, { flat: true, snap: 1, cost: { wood: 4 } }], ["pfence1", "Picket Fence", "fences", "fence_a", 0, 0, { snap: 1, wall2: true, cost: { wood: 1 } }], ["pfence2", "Rail Fence, Low", "fences", "fence_b", 0, 0, { snap: 1, wall2: true, cost: { wood: 1 } }], ["pfence3", "Stone Wall Fence", "fences", "fence_c", 0, 0, { snap: 1, wall2: true, cost: { wood: 1, stone: 1 } }],
    ["road", "Stone Road", "paths", "Stoneroad_a", 0, 0, { flat: true, snap: 1, cost: { stone: 2 } }], ["road2", "Worn Stone Road", "paths", "Stoneroad_b", 0, 0, { flat: true, snap: 1, cost: { stone: 2 } }],
    ["fbarrel", "Barrel", "props", "barrel_a", 0.45, 0, { cost: { wood: 3 } }], ["fcrate", "Big Crate", "props", "cratebox_a", 0.8, 0, { cost: { wood: 4 } }], ["bonfire", "Fire Pit", "props", "bonfire_a", 0.9, 0, { cost: { wood: 3, stone: 3 } }], ["fbench", "Porch Bench", "props", "bench_a", 0.8, 0, { cost: { plank: 4 } }], ["fbench2", "Plank Seat", "props", "bench_c", 0.7, 0, { cost: { plank: 2 } }], ["fchair", "Chair", "props", "chair_a", 0.6, 0, { cost: { plank: 2 } }], ["ftable", "Table", "props", "table_a", 0.7, 0, { cost: { plank: 3 } }], ["fcart", "Hand Cart", "props", "cart_a", 0.7, 20, { cost: { plank: 3 } }], ["flogs", "Log Pile", "props", "logs_a", 1.8, 0, { cost: { wood: 6 } }], ["timber", "Timber Stack", "props", "timber_a", 0.7, 0, { cost: { wood: 4 } }], ["streetlamp", "Street Lamp", "props", "streetlight_a", 0.2, 60, { light: true, cost: { ore: 1 } }], ["streetsign", "Street Sign", "props", "streetsign_a", 0.2, 10, {}], ["mailbox", "Mailbox", "props", "mailbox_a", 0.2, 30, {}], ["farmsign", "Farm Sign", "props", "farmsign_a", 0.3, 40, { cost: { plank: 2 } }], ["ladder", "Ladder", "props", "laddertriangle_a", 0.8, 0, { cost: { wood: 3 } }], ["mower", "Push Mower", "props", "lawn_mower_a", 0.4, 90, {}], ["shovel", "Shovel", "props", "shovel_a", 0.1, 10, {}]]),
  ...pack(V, [["tractor_r", "Red Tractor", "vehicles", "TractorR", 2.2, 2400, {}], ["tractor_y", "Yellow Tractor", "vehicles", "TractorY", 2.6, 2600, {}], ["combine", "Combine Harvester", "vehicles", "CombineHarvester", 6, 9000, {}], ["harvester", "Harvester", "vehicles", "Harvester", 6, 8000, {}], ["seeddrill", "Seed Drill", "vehicles", "SeedDrill", 5.6, 4200, {}], ["baler", "Square Baler", "vehicles", "SquareBaler", 4, 3200, {}], ["plow", "Plowshare", "vehicles", "Plowshare", 1.6, 900, {}], ["pickup", "Pickup Truck", "vehicles", "Pickup", 3, 2400, {}], ["truck_s", "Small Truck", "vehicles", "TruckS", 2.4, 2600, {}], ["truck_m", "Farm Truck", "vehicles", "TruckM", 3.2, 3000, {}], ["truck_b", "Big Truck", "vehicles", "TruckB", 3.4, 3400, {}], ["tanker", "Water Tanker", "vehicles", "TtankerB", 3.2, 2800, {}], ["tanker_s", "Small Tanker", "vehicles", "TtankerS", 1.5, 1200, {}], ["forklift", "Forklift", "vehicles", "Forklift", 1.5, 1400, {}], ["bulldozer", "Bulldozer", "vehicles", "Bulldozer", 3.2, 3800, {}], ["binc", "Bin Car", "vehicles", "BinCar", 2.2, 1800, {}], ["container", "Shipping Container", "vehicles", "Container", 3.2, 1200, {}], ["handcart", "Big Hand Cart", "vehicles", "HandCart_01", 1.6, 300, {}], ["barrow", "Wheelbarrow", "vehicles", "WheelbarrowG", 0.9, 120, {}], ["barrow2", "Blue Wheelbarrow", "vehicles", "WheelbarrowB", 0.9, 120, {}], ["mower_b", "Ride-on Mower", "vehicles", "LawnMower_B", 1.4, 900, {}], ["pontoon", "Pontoon Boat", "vehicles", "PontoonBoat", 1.8, 900, {}]]),
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
  watertower: { label: "Water Tower", cat: "buildings", model: `${B}WaterTower.glb`, height: 9, cost: cost(800, { plank: 20, ore: 6 }), r: 1.8, sprinkle: 16 },
  well: { label: "Well", cat: "buildings", model: `${B}Well.glb`, height: 2.6, cost: cost(150, { stone: 15 }), r: 1.2 },
  greenhouse: { label: "Greenhouse", cat: "farm", made: "greenhouse", cost: cost(1400, { plank: 30, crystal: 2 }), r: 0, greenhouse: 9 },
  sprinkler: { label: "Sprinkler", cat: "farm", made: "sprinkler", cost: cost(220, { ore: 2 }), r: 0.4, sprinkle: 5 },
  trough: { label: "Feeding Trough", cat: "farm", made: "trough", cost: cost(120, { plank: 8 }), r: 1, use: "trough" },
  bin: { label: "Shipping Bin", cat: "farm", made: "bin", cost: cost(60, { plank: 6 }), r: 1, use: "bin", free: true },
  stall: { label: "Market Stall", cat: "farm", made: "stall", cost: cost(300, { plank: 16, wool: 2 }), r: 2.2, use: "stall", unique: true },
  bench_work: { label: "Workbench", cat: "machines", made: "workbench", cost: cost(0, { wood: 12, stone: 6 }), r: 1.2, use: "craft", free: true },
  keg: { label: "Press", cat: "machines", made: "keg", cost: cost(180, { plank: 10, rope: 2 }), r: 0.9, use: "machine", machine: "press" },
  jars: { label: "Preserving Shelf", cat: "machines", made: "jars", cost: cost(220, { plank: 10, brick: 4 }), r: 1.1, use: "machine", machine: "jars" },
  mill: { label: "Hand Mill", cat: "machines", made: "mill", cost: cost(240, { brick: 10 }), r: 1, use: "machine", machine: "mill" },
  oven: { label: "Stone Oven", cat: "machines", made: "oven", cost: cost(320, { brick: 16 }), r: 1.2, use: "machine", machine: "oven" },
  smoker: { label: "Smoke Hut", cat: "machines", made: "smoker", cost: cost(260, { plank: 12, brick: 6 }), r: 1.2, use: "machine", machine: "smoker" },
  cellar: { label: "Cheese Cellar", cat: "machines", made: "cellar", cost: cost(300, { brick: 12, plank: 6 }), r: 1.3, use: "machine", machine: "cellar" },
  kitchen: { label: "Cooking Pot", cat: "machines", model: `${FOOD}CookingPot_Soup.glb`, height: 0.8, stand: true, cost: cost(280, { ore: 4 }), r: 0.8, use: "machine", machine: "kitchen" },
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
  fountain: { label: "Fountain", cat: "decor", made: "fountain", cost: cost(500, { brick: 20 }), r: 2 },
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
  rare: { title: "The Wandering Merchant", sells: ["pearl", "relic", "crystal"], prices: { pearl: 200, relic: 420, crystal: 90 }, rareSeeds: ["apple_seed", "orange_seed", "banana_seed", "coconut_seed"], buys: (i) => i.gold || i.made, pay: 1.5 },
};
export const WEEK = 7;
// regional demand: every week each place wants some kinds of thing more, some less
export const DEMAND = ["crop", "fish", "made", "mat"];

// wandering about your farm. milk, wool and eggs come from a friendly word
export const ANIMALS = [["Cow", 1.6, 44, 22, "milk"], ["Cow", 1.6, 50, 24, "milk"], ["Sheep", 1.1, 42, 16, "wool"], ["Sheep", 1.1, 38, 20, "wool"], ["Pig", 0.9, 30, 16, null], ["Pug", 0.6, 20, 18, null]];

// ---------------- the world: a turtle is one entry ----------------
// route: how it wanders; moves only until you tie up alongside. flora: what grows; town: buildings on its first flat. nodes: what can be gathered
const homeFlora = (sfx) => [[`${GROWN}CommonTree${sfx}_`, 5, 130, 1.5, 0.75], [`${GROWN}PineTree${sfx}_`, 5, 70, 1.7, 0.7], [`${GROWN}BirchTree${sfx}_`, 5, 60, 1.4, 0.6], [`${GROWN}Willow${sfx}_`, 3, 16, 1.5, 0.8]];
const house = (m, x, z, h, ry) => [`${B}${m}.glb`, x, z, h, ry];
export const ISLANDS = {
  home: { name: "Your Turtle", biome: "Meadow", clear: [0, 1, 6], a: 150, b: 112, seed: 3, deep: 34, palette: { sand: 0xf6e6bb, low: 0xa9e07a, mid: 0x8fd16b, high: 0xb7b3a3, snow: 0xf0f5f7 },
    peaks: [[120, -12, 34, 18]],
    flats: [{ x: -42, z: 14, r: 46, h: 9.8 }, { x: 34, z: -6, r: 40, h: 13 }, { x: -38, z: -68, r: 30, h: 17, wall: true }, { x: 92, z: -46, r: 25, h: 30, wall: true }, { x: 112, z: 26, r: 9, h: 39, wall: true }, { x: -6, z: -92, r: 7, h: 46, wall: true }, { x: 36, z: 98, r: 10, h: 6, pier: true }],
    roads: [{ from: [36, 30, 13], to: [36, 92, 6], w: 4.5 }, { from: [-108, 4, 3.6], to: [-84, 8, 9.8], w: 4.5 }, { from: [-46, -22, 9.8], to: [-40, -44, 17], w: 4 }, { from: [50, -26, 13], to: [76, -50, 30], w: 4 }, { from: [-140, 0, 2.4], to: [-108, 4, 3.6], w: 3.2 }],
    flora: homeFlora },
  willowmere: { name: "Willowmere", biome: "Golden plains", a: 104, b: 82, seed: 11, deep: 26, palette: { sand: 0xf3e2b5, low: 0xf0c060, mid: 0xe3a24f, high: 0xb7b3a3, snow: 0xf0f5f7, path: 0xcfa876 },
    peaks: [[-34, -40, 14, 22]], flats: [{ x: 8, z: 12, r: 42, h: 9.8 }, { x: 0, z: -70, r: 10, h: 6, pier: true }], roads: [{ from: [0, -28, 9.8], to: [0, -62, 6], w: 4.5 }], town: true, dock: { off: [36, 208] },
    density: 0.6, flora: () => [[`${TREE}Tree_`, 10, 110, 1, 0.7], [`${TREE}Pine_`, 5, 50, 1, 0.6], [`${TREE}Birch_`, 10, 60, 1, 0.5]],
    houses: [house("BigBarn", 26, 22, 10, 2.9), house("Barn", -16, -4, 9, 0.4), house("SmallBarn", -12, -12, 7, 0.2), house("SmallBarn", 32, -2, 7, -0.4), house("Silo_House", -28, 6, 10, 1.2), house("TowerWindmill", 42, 34, 13, -2.2), house("ChickenCoop", -22, 28, 3, 1.8), house("OpenBarn", 8, 2, 5, 0), house("OpenBarn", -14, 20, 5, 1.6), house("Well", 0, 12, 2.6, 0)],
    places: { seeds: [8, 8], fish: [-14, 26], square: [12, 16], inn: [24, 26], well: [2, 16], home1: [-10, 2], home2: [32, 6], home3: [-24, 14], board: [18, 8] } },
  dune: { name: "Sunback", biome: "Desert", a: 120, b: 92, seed: 21, deep: 28, route: { r: 800, speed: 0.0042, phase: 1 }, palette: { sand: 0xf1d596, low: 0xe9c777, mid: 0xdcb565, high: 0xc98f5a, snow: 0xf0d9a8, path: 0xd4ad72 },
    peaks: [[40, -30, 22, 26]], flats: [{ x: -14, z: 8, r: 36, h: 9.8 }], flora: () => [[`${GROWN}Cactus_`, 5, 60, 1.6, 0.6], [`${GROWN}CactusFlowers_`, 2, 16, 1.4, 0.6], [`${GROWN}PalmTree_`, 3, 18, 1.5, 0.6]], stones: `${GROWN}Rock_`, density: 0.5, nodes: [["sandstone", 16], ["ore", 8]],
    houses: [house("OpenBarn", 8, -4, 5, 0.4), house("Silo_House", -18, -12, 10, 0.6), house("SmallBarn", -30, 8, 7, 1.2), house("Silo", 18, 16, 8, 0), house("Well", 0, 8, 2.6, 0)], tint: 0xf2cf9a, places: { forge: [-6, 10], well: [2, 12], home: [-22, -6] }, carving: [40, -30, 34] },
  frost: { name: "Hoarshell", biome: "Frozen", a: 112, b: 88, seed: 29, deep: 28, route: { r: 1280, speed: 0.0031, phase: 3.6 }, palette: { sand: 0xdfe8ee, low: 0xeaf2f6, mid: 0xdbe7ee, high: 0xbfd2de, snow: 0xffffff, path: 0xcdd9e2 },
    peaks: [[-30, -30, 26, 26]], flats: [{ x: 16, z: 12, r: 34, h: 9.8 }], flora: () => [[`${GROWN}PineTree_Snow_`, 5, 70, 1.7, 0.6], [`${GROWN}CommonTree_Snow_`, 5, 20, 1.5, 0.6]], stones: `${GROWN}Rock_Snow_`, density: 0.5, nodes: [["crystal", 10], ["stone", 10]],
    houses: [house("SmallBarn", 4, -8, 7, 0.2), house("Barn", 30, -6, 9, -0.5), house("Silo", -4, 10, 8, 0), house("Well", 14, 6, 2.6, 0)], tint: 0xe6eff8, places: { cellar: [10, 2], well: [14, 10], home: [24, 2] }, carving: [-30, -30, 30] },
  mire: { name: "Mirewalk", biome: "Swamp", a: 100, b: 80, seed: 37, deep: 26, route: { r: 1040, speed: 0.0036, phase: 5.2 }, palette: { sand: 0xbfb582, low: 0x7f9a5e, mid: 0x6d8a57, high: 0x7c7a64, snow: 0xa8b090, path: 0x8f8560 },
    peaks: [[30, -26, 12, 20]], flats: [{ x: -12, z: 10, r: 32, h: 7 }], flora: () => [[`${GROWN}Willow_`, 5, 60, 1.6, 0.7], [`${GROWN}Willow_Dead_`, 5, 24, 1.5, 0.6], [`${MEGA}TwistedTree_`, 5, 20, 1.1, 0.6]], stones: `${GROWN}Rock_Moss_`, density: 0.5, nodes: [["wildcap", 18], ["herb", 14]], flower: "Mushroom_Laetiporus",
    houses: [house("SmallBarn", -6, -8, 7, 0.4), house("OpenBarn", -22, 6, 5, 1), house("Well", 0, 8, 2.6, 0)], tint: 0xb9c79c, places: { herbal: [-2, 2], well: [2, 12], home: [-16, -4] }, carving: [30, -26, 20] },
  palm: { name: "Coralcrest", biome: "Tropical", a: 106, b: 84, seed: 43, deep: 26, route: { r: 560, speed: 0.0049, phase: 2.4 }, palette: { sand: 0xfff0c8, low: 0x72d98a, mid: 0x54c47e, high: 0xb59a7a, snow: 0xcff5d0, path: 0xe8d6a4 },
    peaks: [[26, 30, 26, 26]], flats: [{ x: -20, z: -10, r: 34, h: 8 }], flora: () => [[`${GROWN}PalmTree_`, 4, 90, 1.8, 0.6], [`${MEGA}CommonTree_`, 5, 30, 1.2, 0.7]], stones: `${GROWN}Rock_`, density: 0.6, nodes: [["berry", 14], ["pearl", 3], ["fiber", 10]],
    houses: [house("OpenBarn", -12, -18, 5, 0.4), house("SmallBarn", -30, -6, 7, 1), house("ChickenCoop", -2, -2, 3, 0.6), house("Well", -20, 2, 2.6, 0)], tint: 0xfff0d0, places: { stand: [-16, -8], well: [-18, 6], home: [-26, -14] } },
  ember: { name: "Emberback", biome: "Volcanic", a: 110, b: 88, seed: 53, deep: 30, route: { r: 1520, speed: 0.0026, phase: 0.2 }, palette: { sand: 0x4a4348, low: 0x5c5258, mid: 0x4c444c, high: 0x8e3e2c, snow: 0xe2703a, path: 0x6d6066 },
    peaks: [[0, -20, 46, 30]], flats: [{ x: -30, z: 24, r: 28, h: 8 }], flora: () => [[`${GROWN}CommonTree_Dead_`, 5, 40, 1.4, 0.6], [`${GROWN}BirchTree_Dead_`, 5, 20, 1.3, 0.5]], stones: `${GROWN}Rock_`, density: 0.5, nodes: [["cinder", 12], ["ore", 12]],
    houses: [house("SmallBarn", -22, 16, 7, 0.4), house("Silo", -42, 24, 8, 0)], tint: 0xc7a79a, places: { yard: [-28, 26], well: [-24, 32], home: [-36, 16] } },
  elder: { name: "The Elder", biome: "Ancient", a: 170, b: 130, seed: 61, deep: 44, hidden: true, route: { r: 1800, speed: 0.0015, phase: 4.2 }, palette: { sand: 0xd8d2bf, low: 0x8fb09a, mid: 0x7da08c, high: 0x8a8d8a, snow: 0xc9d2c8, path: 0xb8b2a0 },
    peaks: [[60, -30, 30, 40]], flats: [{ x: 0, z: 20, r: 54, h: 12 }], flora: () => [[`${GROWN}Willow_Dead_`, 5, 30, 1.8, 0.7], [`${TREE}DeadTree_`, 10, 40, 1.2, 0.6]], stones: `${GROWN}Rock_Moss_`, density: 0.5, nodes: [["relic", 6], ["stone", 12]],
    ruins: true, places: {} },
};
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
// the carvings. Each is in a place you have to reach
export const CARVINGS = [
  { id: "c1", land: "home", x: 92, z: -46, needs: "boulder", text: "A line of turtles, all swimming one way." },
  { id: "c2", land: "dune", x: 40, z: -30, text: "Small figures setting soil on a shell." },
  { id: "c3", land: "frost", x: -30, z: -30, text: "The sea rising over a shape that may be a continent." },
  { id: "c4", land: "mire", x: 30, z: -26, text: "One huge turtle, going down. The others watching." },
  { id: "c5", land: "elder", x: 0, z: -6, text: "The same huge turtle, asleep, at the bottom of everything." },
];

// where people stand: named places on an island, in its own space. schedule: [hour, place]
export const NPCS = {
  tilly: { name: "Tilly", role: "Runs the supply cart", land: "home", model: "ultimate_modular_women/Casual.gltf", shop: "tilly", at: [6, -4], schedule: [[0, "cart"]], places: { cart: [6, -4] },
    talk: ["Seeds, feed, fertiliser. If it grows, I've got something for it.", "Anything you drop in the bin by the house, I'll pick up overnight.", "Better prices across the bridge, I admit. If it ever opens."] },
  wren: { name: "Wren", role: "Seed seller", model: "ultimate_modular_women/Worker.gltf", shop: "seeds", schedule: [[6, "home1"], [8, "seeds"], [12, "square"], [13, "seeds"], [18, "square"], [21, "home1"]],
    talk: ["Morning! Fresh seed came in on the tide.", "Rain's good for the plots. Less hauling for you.", "Your turtle's looking well. Does it ever sleep?"] },
  bram: { name: "Bram", role: "Fish buyer", model: "ultimate_modular_men/Beach.gltf", shop: "fish", schedule: [[5, "fish"], [12, "well"], [13, "fish"], [19, "inn"], [22, "home2"]],
    talk: ["Tail shore's the place to fish, if you've patience.", "There's a lantern fish that only bites past dark.", "Saw something huge go under us last night. Not a turtle."] },
  moss: { name: "Old Moss", role: "Keeper of stories", model: "ultimate_modular_women/Formal.gltf", schedule: [[7, "well"], [11, "square"], [16, "inn"], [20, "home3"]],
    talk: ["My grandmother swore the turtles remember every shore they've passed.", "Nobody built these turtles a road. So who are they following?", "If you find old carvings, bring them to me. They all point the same way."] },
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
  idle: ["This turtle's breathing is the calmest thing I've ever stood on.", "Do you think it knows we're here?", "I've been counting the birds. Lost count. Twice.", "My theory: they're not lost. They're late for something.", "If the turtles sing, I wonder who they're singing to."],
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
    carving: { once: true, lines: ["This isn't just old. It's older than any town we've visited.", "It looks like a map of turtles... all swimming the same way."] },
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
  },
};

// ---------------- the story: ten arcs, each step a check against what has happened ----------------
export const ARCS = ["Start the farm", "The first neighbour", "Friends across the water", "The migration", "Ancient records", "The lost turtles", "The Shellwrights", "The truth", "The Long Swim", "The song"];
const carvings = (s) => Object.keys(s.carved || {}).length;
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
  { id: "show", arc: 3, text: "Show the Old Carving to Old Moss", done: (s) => s.flags.moss },
  { id: "boat", arc: 3, text: "Mend the old boat at your dock", done: (s) => s.flags.boat },
  { id: "dune", arc: 4, text: "Sail to Sunback, the desert turtle", done: (s) => s.seenIsles.dune },
  { id: "c2", arc: 4, text: "Find the carving on Sunback's high rock", done: (s) => s.carved?.c2 },
  { id: "c3", arc: 5, text: "Find the carving on Hoarshell, the frozen turtle", done: (s) => s.carved?.c3 },
  { id: "c4", arc: 5, text: "Find the carving on Mirewalk, the swamp turtle", done: (s) => s.carved?.c4 },
  { id: "chart", arc: 5, text: "Bring your findings to Old Moss", done: (s) => s.flags.chart },
  { id: "elder", arc: 6, text: "Find The Elder, now marked on your map", done: (s) => s.seenIsles.elder },
  { id: "c5", arc: 6, text: "Read the deepest carving in the ruins", done: (s) => s.carved?.c5 },
  { id: "truth", arc: 7, text: "Tell Old Moss what you found", done: (s) => s.flags.truth },
  { id: "grow", arc: 8, text: "Grow the Heartseed on your turtle", done: (s) => s.flags.bloomed },
  { id: "shrine", arc: 9, text: "Carry the Heartbloom to the Sky Shrine (a flyer can reach it)", done: (s) => s.flags.finale },
  { id: "free", arc: 9, text: "Your farm, your turtle. What's on the next one?", done: () => false },
];
// who says what, once, when the story says so: the deeper tale
export const TALES = [
  { who: "moss", need: (s) => s.carved?.c1 && !s.flags.moss, set: "moss", gives: { money: 200 }, lines: ["Oh... where did you find this?", "Every carving I've seen shows the same thing: all the turtles, all heading to one place.", "Nobody builds roads for a turtle. So who are they following? You'll need a boat to find out. And take this for your trouble."] },
  { who: "moss", need: (s) => carvings(s) >= 4 && !s.flags.chart, set: "chart", lines: ["Soil on shells. The sea rising. One great turtle going down...", "Dear, this isn't a legend. It's a record.", "There's an older turtle than any on my charts. Here, I've marked where she should be. She only surfaces in the deep of the ocean."] },
  { who: "moss", need: (s) => s.carved?.c5 && !s.flags.truth, set: "truth", gives: { heartseed_seed: 1 }, lines: ["So. There was land, once. All of it, one great land, and the sea came for it.", "The Shellwrights, they called themselves. They couldn't save the land, so they carried it. Soil and seeds on the back of every young turtle that would have them.", "And the mother of those turtles went down to hold back the deep. She's still there. That's what the turtles swim to. Every year they go back to her, and every year fewer come home.", "Some of them simply went down to join her. That's where the missing ones are.", "This seed was in the last chest in the Elder's ruin. It hasn't woken in a thousand years. Grow it on your turtle. Let's see what she does."] },
  { who: "moss", need: (s) => s.flags.finale && !s.flags.after, set: "after", gives: { money: 1000 }, lines: ["I felt it. Every turtle in the ocean turned its head at once.", "You've done what nobody's done since the Shellwrights. And there's still all that sea out there.", "Sailors are talking about little islands, drifting where none ever were. Go and look. You always do."] },
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
