// dnd_furniture.js - imports all converted furniture and interior models from the Quaternius asset library
// (ui/game/assets/conv_furniture_pack/, conv_furniture_pack_2017/, conv_ultimate_house_interior_pack/)
// into Vermeil's main room catalog with full color customization.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Mirror } from "./mirror.js";

const loader = new GLTFLoader();
const modelCache = new Map();

function loadGLB(url) {
  if (modelCache.has(url)) return Promise.resolve(modelCache.get(url));
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        modelCache.set(url, gltf.scene);
        resolve(gltf.scene);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

export function makeGLBItem(label, url, scale = 1.0, mount = "floor", defaultY = 0, { mirror = false } = {}) {
  return {
    label,
    mount,
    defaultY,
    isGLB: true,
    build(ctx) {
      const g = new THREE.Group();
      g.userData.isGLB = true;
      if (ctx?._itemId != null) g.userData.itemId = ctx._itemId;

      loadGLB(url).then((template) => {
        const clone = template.clone(true);
        // compute bounding box to sit flat on the floor
        const box = new THREE.Box3().setFromObject(clone);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        // Auto-scale to real room dimensions (roughly 1.0-2.2 units)
        const maxDim = Math.max(size.x, size.y, size.z);
        const s = maxDim > 0 ? (scale * 1.6) / maxDim : scale;
        clone.scale.set(s, s, s);
        
        // Center on X and Z, place bottom at Y=0
        clone.position.set(-center.x * s, -box.min.y * s, mount === "wall" ? -box.min.z * s : -center.z * s);   // wall things: back flat on the wall
        
        const itemId = g.userData.itemId ?? ctx?._itemId;
        clone.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (itemId != null) o.userData.itemId = itemId;
            if (o.material) {
              const cloneMat = (m) => {
                const c = m.clone();
                if (m.map) c.map = m.map;
                return c;
              };
              o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
              o.userData._origMat = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
            }
          }
        });
        if (mirror) {                                   // the glass part becomes a real mirror that reflects the room
          const glass = [];
          clone.traverse((o) => { if (o.isMesh && [].concat(o.material).some((m) => /mirror/i.test(m?.name || ""))) glass.push(o); });
          for (const o of glass) {
            const m = new Mirror(o.geometry, { tint: 0xdfe4ea, resolution: 512 });
            m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
            m.position.z += 0.004;                      // a hair in front of the frame
            if (itemId != null) m.userData.itemId = itemId;
            o.parent.add(m); o.parent.remove(o);
          }
        }
        g.add(clone);

        if (ctx?._room && itemId != null) {
          ctx._room.onGLBLoaded?.(itemId);
        }
      }).catch((err) => {
        console.warn("Failed to load furniture model:", url, err);
      });
      return { group: g };
    },
  };
}

export const DND_FURNITURE_CATALOG = {};

// Furniture Pack
const FP = "game/assets/conv_furniture_pack/";
const FP17 = "game/assets/conv_furniture_pack_2017/";
const UHIP = "game/assets/conv_ultimate_house_interior_pack/";

const ASSETS = [
  // Beds
  ["dnd_bed_double", "Bed (Double)", FP + "BedDouble.glb", 1.8, "beds"],
  ["dnd_bed_twin", "Bed (Twin)", FP + "BedTwin.glb", 1.6, "beds"],
  ["dnd_bed_king", "Bed (King Luxury)", UHIP + "Bed_King.glb", 2.0, "beds"],
  ["dnd_bed_bunk", "Bed (Bunk Bed)", UHIP + "Bed_Bunk.glb", 2.2, "beds"],
  ["dnd_bed_single", "Bed (Modern Single)", UHIP + "Bed_Single.glb", 1.6, "beds"],

  // Seating
  ["dnd_sofa_1", "Sofa (Classic)", FP + "Sofa.glb", 1.8, "seating"],
  ["dnd_sofa_2", "Sofa (Cushioned)", FP + "Sofa2.glb", 1.8, "seating"],
  ["dnd_sofa_3", "Sofa (Modern 3-Seat)", FP + "Sofa3.glb", 2.0, "seating"],
  ["dnd_sofa_ind", "Armchair (Single)", FP + "Sofa_individual.glb", 1.2, "seating"],
  ["dnd_couch_l", "Couch (L-Shape Sectional)", UHIP + "Couch_L.glb", 2.4, "seating"],
  ["dnd_couch_lg1", "Couch (Large)", UHIP + "Couch_Large1.glb", 2.1, "seating"],
  ["dnd_couch_med", "Couch (Medium)", UHIP + "Couch_Medium1.glb", 1.8, "seating"],
  ["dnd_couch_sm", "Couch (Loveseat)", UHIP + "Couch_Small1.glb", 1.5, "seating"],
  ["dnd_chair_1", "Dining Chair", FP + "Chair.glb", 1.0, "seating"],
  ["dnd_chair_cushion", "Chair (Padded)", FP17 + "ChairCushioned.glb", 1.0, "seating"],
  ["dnd_chair_office", "Office Chair (Swivel)", FP + "OfficeChair.glb", 1.1, "seating"],
  ["dnd_chair_mod1", "Chair (Modern)", UHIP + "Chair_1.glb", 1.0, "seating"],
  ["dnd_chair_mod2", "Chair (Lounge)", UHIP + "Chair_2.glb", 1.1, "seating"],
  ["dnd_stool", "Wooden Stool", FP + "Stool.glb", 0.7, "seating"],

  // Tables & Desks
  ["dnd_desk", "Study Desk", FP + "Desk.glb", 1.5, "tables"],
  ["dnd_table_dining", "Dining Table", FP + "Table.glb", 1.6, "tables"],
  ["dnd_table_dining2", "Dining Table (Long)", FP + "Table2.glb", 1.8, "tables"],
  ["dnd_table_coffee", "Coffee Table", FP17 + "CoffeeTable.glb", 1.1, "tables"],
  ["dnd_table_coffee2", "Coffee Table (Glass Top)", FP17 + "CoffeeTable2.glb", 1.1, "tables"],
  ["dnd_table_round_lg", "Round Dining Table", UHIP + "Table_RoundLarge.glb", 1.6, "tables"],
  ["dnd_table_round_sm", "Round Side Table", UHIP + "Table_RoundSmall.glb", 1.0, "tables"],

  // Shelves & Storage
  ["dnd_bookcase", "Bookcase (Empty)", FP + "Bookcase.glb", 1.8, "shelves"],
  ["dnd_bookcase_books", "Bookcase (Full of Books)", FP + "Bookcase_Books.glb", 1.8, "shelves"],
  ["dnd_bookshelf_large", "Bookshelf (Large)", UHIP + "Shelf_Large.glb", 2.0, "shelves"],
  ["dnd_shelf_small", "Wall Shelf", UHIP + "Shelf_Small1.glb", 1.0, "shelves"],
  ["dnd_closet", "Wardrobe Closet", FP + "Closet.glb", 2.0, "shelves"],
  ["dnd_closet_short", "Short Closet", FP + "ShortCloset.glb", 1.3, "shelves"],
  ["dnd_nightstand", "Nightstand", FP + "NightStand.glb", 0.8, "shelves"],
  ["dnd_nightstand_mod", "Nightstand (Modern)", UHIP + "NightStand_1.glb", 0.8, "shelves"],
  ["dnd_drawer_1", "Chest of Drawers (3-Drawer)", UHIP + "Drawer_1.glb", 1.2, "shelves"],
  ["dnd_drawer_tall", "Tall Dresser (5-Drawer)", UHIP + "Drawer_5.glb", 1.6, "shelves"],

  // Kitchen
  ["dnd_fridge", "Kitchen Refrigerator", UHIP + "Kitchen_Fridge.glb", 1.9, "kitchen"],
  ["dnd_oven", "Kitchen Stove & Oven", UHIP + "Kitchen_Oven.glb", 1.4, "kitchen"],
  ["dnd_kitchen_sink", "Kitchen Counter with Sink", UHIP + "Kitchen_Sink.glb", 1.5, "kitchen"],
  ["dnd_kitchen_cabinet", "Kitchen Counter Cabinet", UHIP + "Kitchen_Cabinet1.glb", 1.3, "kitchen"],
  ["dnd_kitchen_drawers", "Kitchen Drawers Counter", UHIP + "Kitchen_3Drawers.glb", 1.3, "kitchen"],

  // Bathroom
  ["dnd_bathtub", "Bathtub", UHIP + "Bathroom_Bathtub.glb", 1.6, "bathroom"],
  ["dnd_shower", "Shower Stall", UHIP + "Bathroom_Shower1.glb", 2.0, "bathroom"],
  ["dnd_toilet", "Bathroom Toilet", UHIP + "Bathroom_Toilet.glb", 1.0, "bathroom"],
  ["dnd_bathroom_sink", "Bathroom Vanity Sink", UHIP + "Bathroom_Sink.glb", 1.3, "bathroom"],
  ["dnd_mirror_round", "Bathroom Mirror (Round)", UHIP + "Bathroom_Mirror1.glb", 0.9, "bathroom", 1.2],   // on the wall, real glass
  ["dnd_mirror_rect", "Bathroom Mirror (Tall)", UHIP + "Bathroom_Mirror2.glb", 1.2, "bathroom", 1.0],
  ["dnd_washing_machine", "Washing Machine", UHIP + "Bathroom_WashingMachine.glb", 1.2, "bathroom"],

  // Plants & Decor
  ["dnd_plant_monstera", "Houseplant (Potted Monstera)", UHIP + "Houseplant_1.glb", 1.2, "plants"],
  ["dnd_plant_palm", "Houseplant (Potted Palm)", UHIP + "Houseplant_2.glb", 1.4, "plants"],
  ["dnd_plant_ficus", "Houseplant (Ficus Tree)", UHIP + "Houseplant_3.glb", 1.5, "plants"],
  ["dnd_plant_succulent", "Houseplant (Potted Succulent)", UHIP + "Houseplant_4.glb", 0.7, "plants"],
  ["dnd_plant_fern", "Houseplant (Fern in Pot)", UHIP + "Houseplant_5.glb", 0.9, "plants"],
  ["dnd_plant_cactus", "Houseplant (Tall Cactus)", UHIP + "Houseplant_6.glb", 1.3, "plants"],
  ["dnd_plant_desk", "Desk Plant", FP + "Plant.glb", 0.6, "plants"],
  ["dnd_carpet_1", "Area Rug (Rectangular)", UHIP + "Carpet_1.glb", 2.2, "decor"],
  ["dnd_carpet_round", "Area Rug (Round)", UHIP + "Carpet_Round.glb", 2.0, "decor"],
  ["dnd_fireplace", "Brick Fireplace", UHIP + "Fireplace.glb", 1.8, "decor"],
  ["dnd_vase_flower", "Flower Vase", FP17 + "Vase.glb", 0.6, "decor"],
  ["dnd_trashcan", "Trash Can", UHIP + "Trashcan_Small1.glb", 0.6, "decor"],

  // Lighting
  ["dnd_light_floor", "Floor Lamp (Standing Arc)", UHIP + "Light_Floor1.glb", 1.8, "lights"],
  ["dnd_light_floor2", "Floor Lamp (Tripod)", UHIP + "Light_Floor2.glb", 1.7, "lights"],
  ["dnd_light_desk", "Desk Lamp (Adjustable)", UHIP + "Light_Desk.glb", 0.7, "lights"],
  ["dnd_light_stand", "Bedside Table Lamp", UHIP + "Light_Stand1.glb", 0.8, "lights"],
  ["dnd_light_ceiling", "Ceiling Pendant Light", UHIP + "Light_Ceiling1.glb", 1.2, "lights", 2.8],
  ["dnd_chandelier", "Ceiling Chandelier", UHIP + "Light_Chandelier.glb", 1.5, "lights", 2.6],
];

for (const [key, label, url, scale, cat, defaultY] of ASSETS) {
  DND_FURNITURE_CATALOG[key] = {
    ...makeGLBItem(label, url, scale, defaultY ? "wall" : "floor", defaultY || 0, { mirror: key.startsWith("dnd_mirror") }),
    category: cat,
  };
}
