"""content.py - loads the game's data files (game/data/*.json) and the 3D asset catalog.

Everything the rules use (classes, enemies, items, cards, biomes...) is plain JSON so it can be
changed or extended without touching code. The asset catalog (ui/game/assets/catalog.json) says
which 3D models really exist - the world builder and the Dungeon Master can only use those.
"""
import json
import os
import re
from functools import lru_cache

GAME_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(GAME_DIR)
DATA = os.path.join(GAME_DIR, "data")
CATALOG = os.path.join(PROJECT, "ui", "game", "assets", "catalog.json")


def _load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        d = json.load(f)
    d.pop("_doc", None)
    return d


class Content:
    """All game data in one place. Use content() to get the shared copy."""

    def __init__(self, catalog_path=CATALOG):
        self.rules = _load("rules.json")
        self.classes = _load("classes.json")
        self.species = _load("species.json")
        self.abilities = _load("abilities.json")
        self.status = _load("status.json")
        items = _load("items.json")
        self.items, self.rarities, self.affixes = items["bases"], items["rarities"], items["affixes"]
        en = _load("enemies.json")
        self.enemies, self.bosses, self.summons = en["enemies"], en["bosses"], en.get("summons", {})
        cards = _load("cards.json")
        self.cards, self.card_weights = cards["cards"], cards["rarity_weights"]
        self.biomes = _load("biomes.json")
        self.setpieces = _load("setpieces.json") if os.path.exists(os.path.join(DATA, "setpieces.json")) else {}
        self.world = _load("world.json")
        self.catalog = {}
        if os.path.exists(catalog_path):
            with open(catalog_path, encoding="utf-8") as f:
                for m in json.load(f).get("models", []):
                    self.catalog[m["id"]] = m
        self._pool_cache = {}

    # ---------------- models ----------------
    def has_model(self, mid):
        return bool(mid) and mid in self.catalog

    def model(self, mid):
        return self.catalog.get(mid)

    def match(self, pattern):
        """catalog ids matching a regular expression (sorted, cached)."""
        if pattern not in self._pool_cache:
            rx = re.compile(pattern)
            self._pool_cache[pattern] = sorted(i for i in self.catalog if rx.search(i))
        return self._pool_cache[pattern]

    def used_models(self, scenery=False):
        """the catalog models to load on the first loading screen: everything that can MOVE or be carried - species,
        classes, enemies, bosses, NPCs, items, cards, the modular body parts, hand-made pieces and the title scene.
        Scenery (each place's trees, buildings, props: well over a thousand models) is loaded by that place's own
        loading screen instead, so memory stays small. scenery=True also lists all scenery (for checks)."""
        key = "_used_all" if scenery else "_used"
        if getattr(self, key, None) is not None:
            return getattr(self, key)
        out = set()

        def walk(v):
            if isinstance(v, dict):
                for x in v.values(): walk(x)
            elif isinstance(v, list):
                for x in v: walk(x)
            elif isinstance(v, str) and v:
                if v in self.catalog:
                    out.add(v)
                elif any(ch in v for ch in "^$|(["):
                    try:
                        out.update(self.match(v))
                    except re.error:
                        pass
        names = ["species", "classes", "abilities", "items", "enemies", "cards", "world"] + (["biomes", "setpieces"] if scenery else [])
        for name in names:
            walk(getattr(self, name, None))
        if not scenery:                                  # animals that walk around in places are actors too
            for b in self.biomes.values():
                if isinstance(b, dict) and b.get("animals"): walk(b["animals"])
        for pat in (r"^ultimate_modular_(men|women)_", r"^made_",
                    r"^(stylized_nature_megakit_(commontree_\d|pine_\d|bush_common|rock_medium_\d|grass_common_tall|flower_3_group)|ultimate_stylized_nature_mapletree_\d)$"):
            out.update(self.match(pat))
        setattr(self, key, sorted(out))
        return getattr(self, key)

    def available_models(self, ids):
        """only the model ids that really exist in the asset library."""
        return [i for i in ids if i in self.catalog]

    # ---------------- lookups with friendly errors ----------------
    def ability(self, aid):
        a = self.abilities.get(aid)
        if not a:
            raise KeyError(f"unknown ability {aid}")
        return a

    def item(self, iid):
        b = self.items.get(iid)
        if not b:
            raise KeyError(f"unknown item {iid}")
        return b

    def enemy(self, eid):
        return self.enemies.get(eid) or self.bosses.get(eid) or self.summons.get(eid)

    def playable_species(self):
        """species list with a flag for whether a model exists for it (shown in character creation)."""
        out = []
        for sid, s in self.species.items():
            models = self.available_models(s.get("models", []))
            ok = sid == "human" or bool(models)
            out.append({"id": sid, "name": s["name"], "desc": s["desc"], "trait": s.get("trait", ""),
                        "available": ok, "models": models,
                        "reason": "" if ok else "No compatible 3D model in the asset library"})
        return out

    def class_list(self):
        return [{"id": cid, "name": c["name"], "desc": c["desc"], "role": c["role"],
                 "abilities": [self.abilities[a]["name"] for a, lvl in c["abilities"] if lvl <= 1],
                 "model": c.get("human_model") if self.has_model(c.get("human_model")) else None,
                 "base": c["base"]} for cid, c in self.classes.items()]


@lru_cache(maxsize=1)
def content():
    return Content()


def reload():
    content.cache_clear()
    return content()
