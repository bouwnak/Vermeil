"""inventory.py - the party backpack, equipment and loot.

Items in the backpack are instances: {uid, base, name, slot, rarity, bonus, dice, element, qty, model, value, quest}.
Equipment slots on an actor point at item uids. Bonuses really change stats (see actors.stats).
"""
from .actors import item_of, new_uid, stats
from .actors import power
from .content import content

EQUIP_SLOTS = ("weapon", "offhand", "armor", "accessory")


def make_item(camp, base_id, dice=None, rarity=None, qty=1, name=None, quest_id=None):
    C = content()
    b = C.item(base_id)
    if rarity is None:
        rarity = "common"
        if b["slot"] in EQUIP_SLOTS and dice:
            rarity = dice.weighted({k: r["weight"] for k, r in C.rarities.items()}, "rarity")
    rar = C.rarities[rarity]
    bonus = {k: round(v * rar["mult"]) if isinstance(v, (int, float)) else v for k, v in b.get("bonus", {}).items()}
    element = b.get("element")
    words = []
    if b["slot"] in EQUIP_SLOTS and rar["affixes"] and dice:
        keys = sorted(C.affixes)
        chosen = []
        for _ in range(rar["affixes"]):
            k = dice.pick([x for x in keys if x not in chosen], "affix")
            if k: chosen.append(k)
        for k in chosen:
            af = C.affixes[k]
            for s, v in af.get("bonus", {}).items():
                bonus[s] = bonus.get(s, 0) + v
            if af.get("element") and b["slot"] == "weapon" and not element:
                element = af["element"]
            words.append(af)
    nm = name or b["name"]
    pre = [w["prefix"] for w in words if w.get("prefix")][:1]
    suf = [w["suffix"] for w in words if w.get("suffix")][:1]
    nm = " ".join(pre + [nm] + suf)
    it = {"uid": new_uid(camp, "i"), "base": base_id, "name": nm, "slot": b["slot"], "kind": b.get("kind"),
          "rarity": rarity, "bonus": bonus, "dice": b.get("dice"), "element": element, "ranged": b.get("ranged", False),
          "qty": qty, "model": b.get("model") if C.has_model(b.get("model")) else None,
          "value": int(b.get("value", 0) * rar["value"]), "stack": b.get("stack", 1), "quest": b.get("quest", False),
          "level": b.get("level", 1), "use": b.get("use"), "target": b.get("target")}
    if quest_id: it["quest_id"] = quest_id
    return it


def add(camp, it):
    """put an item in the backpack (stacks with same base+rarity when stackable). Returns the stored item."""
    inv = camp.setdefault("inventory", [])
    if it["base"] == "gold":
        camp["gold"] = camp.get("gold", 0) + it["qty"]
        camp.setdefault("stats", {}).setdefault("gold_earned", 0)
        camp["stats"]["gold_earned"] += it["qty"]
        return it
    if it["stack"] > 1:
        for x in inv:
            if x["base"] == it["base"] and x["rarity"] == it["rarity"] and x["qty"] < x["stack"]:
                x["qty"] = min(x["stack"], x["qty"] + it["qty"])
                return x
    inv.append(it)
    return it


def remove(camp, uid, qty=1, force=False):
    inv = camp.get("inventory", [])
    for x in inv:
        if x["uid"] == uid:
            if x.get("quest") and not force:
                raise ValueError("Quest items can't be thrown away.")
            x["qty"] -= qty
            if x["qty"] <= 0:
                inv.remove(x)
                for a in camp.get("party", []):         # un-equip it everywhere
                    for s, u in list((a.get("equipment") or {}).items()):
                        if u == uid: a["equipment"][s] = None
            return True
    raise ValueError("You don't have that item.")


def find_actor(camp, uid):
    for a in camp.get("party", []):
        if a["uid"] == uid: return a
    raise ValueError("No such party member.")


def equip(camp, actor_uid, item_uid):
    a = find_actor(camp, actor_uid)
    it = item_of(camp, item_uid)
    if not it: raise ValueError("You don't have that item.")
    if it["slot"] not in EQUIP_SLOTS: raise ValueError(f"{it['name']} can't be equipped.")
    for p in camp["party"]:                        # one item, one wearer
        for s, u in (p.get("equipment") or {}).items():
            if u == item_uid: p["equipment"][s] = None
    old = a["equipment"].get(it["slot"])
    a["equipment"][it["slot"]] = item_uid
    clamp(a, camp)
    return old


def unequip(camp, actor_uid, slot):
    a = find_actor(camp, actor_uid)
    if slot not in EQUIP_SLOTS: raise ValueError("bad slot")
    a["equipment"][slot] = None
    clamp(a, camp)


def clamp(a, camp):
    st = stats(a, camp)
    a["hp"] = min(a["hp"], st["hp"])
    a["mana"] = min(a.get("mana", 0), st["mana"])


def compare(camp, actor_uid, item_uid):
    """stat differences if this actor equipped the item: {'patk': +2, 'spd': -1}"""
    a = find_actor(camp, actor_uid)
    it = item_of(camp, item_uid)
    if not it or it["slot"] not in EQUIP_SLOTS: return {}
    before = stats(a, camp)
    saved = dict(a["equipment"])
    a["equipment"][it["slot"]] = item_uid
    after = stats(a, camp)
    a["equipment"] = saved
    return {k: after[k] - before[k] for k in after if after[k] != before[k]}


def starting_gear(camp, actor, dice):
    C = content()
    for base in C.classes[actor["cls"]]["start_items"]:
        it = add(camp, make_item(camp, base, rarity="common"))
        if it["slot"] in EQUIP_SLOTS and not actor["equipment"].get(it["slot"]):
            actor["equipment"][it["slot"]] = it["uid"]
    st = stats(actor, camp)
    actor["hp"], actor["mana"] = st["hp"], st["mana"]


def roll_loot(camp, enemy, dice, bonus=0.0, extra_drop=0.0):
    """items + gold from a defeated enemy (only called once per enemy - see combat rewards)."""
    C = content()
    out = []
    lo, hi = enemy.get("gold", [0, 0])
    if hi > 0:
        g = dice.between(lo, hi, "gold")
        g = int(g * (1 + bonus) * gold_scale(enemy.get("level", 1)))
        if g > 0: out.append(make_item(camp, "gold", qty=g))
    drops = list(enemy.get("loot", []))
    for base, chance, mn, mx in drops:
        if base not in C.items: continue
        if dice.chance(min(1.0, chance * (1 + bonus)), "drop"):
            qty = dice.between(mn, mx, "qty")
            if base == "gold":
                out.append(make_item(camp, "gold", qty=int(qty * (1 + bonus))))
            else:
                out.append(make_item(camp, base, dice=dice, qty=qty))
    if extra_drop and dice.chance(extra_drop, "extra"):
        lvl = power(enemy.get("level", 1))
        pool = [k for k, b in C.items.items() if b["slot"] in ("consumable",) + EQUIP_SLOTS and b.get("level", 1) <= lvl + 2
                and k != "rapier" and not b.get("trader_only")]
        out.append(make_item(camp, dice.pick(sorted(pool), "extra_item"), dice=dice))
    return out


SHOP_MARKUP = 1.8          # shops sell for value x1.8 and buy back for half the value
TRADER_MARKUP = 2.2        # the wandering trader's rare gear costs a bit more


def gold_scale(level):
    """stronger monsters carry more gold, so shop prices (which rise with your level) stay about 2-3 fights per item"""
    return 1 + 0.3 * (power(level) - 1)


def shop_price(it, markup=SHOP_MARKUP):
    return max(2, int(it["value"] * markup))


def shop_stock(camp, level, dice, role):
    level = power(level)                 # item tiers follow the 1-100 level scale's power
    """a merchant's goods (made once per merchant and saved; restocked after a while - see campaign.open_shop)."""
    if role == "wandering_trader":
        return trader_stock(camp, level, dice)
    C = content()
    pool = sorted(k for k, b in C.items.items()
                  if b["slot"] in ("consumable",) + EQUIP_SLOTS and b.get("level", 1) <= level + 3 and k not in ("rapier",)
                  and not b.get("trader_only"))
    if role == "blacksmith": pool = [k for k in pool if C.items[k]["slot"] in EQUIP_SLOTS] or pool
    if role in ("innkeeper", "witch"): pool = [k for k in pool if C.items[k]["slot"] == "consumable"] or pool
    goods = []
    n = 8 if role in ("merchant", "blacksmith") else 6
    for _ in range(n):
        b = dice.pick(pool, "shop")
        it = make_item(camp, b, dice=dice, qty=3 if C.items[b]["slot"] == "consumable" else 1)
        it["price"] = shop_price(it)
        goods.append(it)
    # every merchant keeps the basics in stock
    if role in ("merchant", "innkeeper", "witch", "engineer"):
        for base, q in (("potion_small", 5), ("ether_small", 3)):
            if not any(g["base"] == base for g in goods):
                it = make_item(camp, base, qty=q); it["price"] = shop_price(it); goods.insert(0, it)
    return goods


def trader_stock(camp, level, dice):
    level = power(level)
    """a wandering trader's goods: fewer, pricier, but GOOD - rare or better gear above your level,
    permanent tonics, a Tome of Insight, and strong potions."""
    C = content()
    gear = sorted(k for k, b in C.items.items() if b["slot"] in EQUIP_SLOTS and k != "rapier" and b.get("level", 1) <= level + 5)
    gear_hi = [k for k in gear if C.items[k].get("level", 1) >= max(1, level - 1)] or gear
    goods = []
    for i in range(4):
        rar = dice.weighted({"rare": 55, "epic": 35, "legendary": 10}, "trader_rarity")
        it = make_item(camp, dice.pick(gear_hi, "trader_gear"), dice=dice, rarity=rar)
        it["price"] = max(20, shop_price(it, TRADER_MARKUP))
        goods.append(it)
    specials = sorted(k for k, b in C.items.items() if b.get("trader_only"))
    for i in range(2):
        b = dice.pick(specials, "trader_special")
        if any(g["base"] == b for g in goods): continue
        it = make_item(camp, b, qty=2 if b != "tome_insight" else 1)
        it["price"] = int(it["value"] * (1 + 0.04 * level))
        goods.append(it)
    for base in ("potion_big", "phoenix_feather", "elixir"):
        if C.items[base].get("level", 1) <= level + 4:
            it = make_item(camp, base, qty=2); it["price"] = shop_price(it, TRADER_MARKUP); goods.append(it)
    return goods


REFORGE_MAX = 5


def reforge_cost(it):
    """gold to improve an equipment item by one step (+1 .. +5)."""
    n = it.get("plus", 0)
    return int(30 + it.get("value", 10) * 0.5 * (n + 1) + 25 * n * n)


def reforge(camp, it):
    """make an item one step stronger: every bonus +15% (at least +1 on its best stat), value up, name +N."""
    n = it.get("plus", 0)
    if n >= REFORGE_MAX: raise ValueError(f"{it['name']} can't be improved any further.")
    bonus = it.get("bonus") or {}
    if bonus:
        best = max(bonus, key=lambda k: bonus[k] if isinstance(bonus[k], (int, float)) else -99)
        for k, v in list(bonus.items()):
            if isinstance(v, (int, float)) and v > 0:
                bonus[k] = v + max(1 if k == best else 0, round(v * 0.15))
    else:
        it["bonus"] = {"pdef" if it["slot"] in ("armor", "offhand") else "patk": 1}
    it["plus"] = n + 1
    it["value"] = int(it.get("value", 10) * 1.3 + 10)
    it["name"] = (it["name"].rsplit(" +", 1)[0] if n else it["name"]) + f" +{n + 1}"
    return it
