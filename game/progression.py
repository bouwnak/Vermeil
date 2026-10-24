"""progression.py - experience, levels, milestones and the roguelike upgrade cards.

XP needed for the next level = base x growth^(level-1)  (rules.json -> xp_curve).
award_xp() takes a unique key (e.g. the defeated enemy's uid), so the same reward can never be paid twice -
not after a reload, not if the AI repeats itself, not if a death event fires twice.
"""
from .actors import level_up, stats
from .content import content


def xp_to_next(level):
    c = content().rules["xp_curve"]
    if c.get("type") == "linear":                 # levels 1-100: every level costs a little more
        return int(c["base"] + c["per_level"] * level)
    return int(c["base"] * c["growth"] ** (level - 1))


def award_xp(camp, key, amount, dice, events, src_level=None):
    """give XP to every living party member (the player gets the species bonus). Returns True if paid.
    src_level (the defeated monster's level): fighting above your level gives more XP, below it less - so the party
    keeps pace with the places it reaches and grinding weak monsters doesn't race you to 100."""
    C = content()
    paid = camp.setdefault("awarded", [])
    if key in paid:
        return False
    paid.append(key)
    camp.setdefault("stats", {}).setdefault("xp_earned", 0)
    camp["stats"]["xp_earned"] += amount
    for a in camp["party"]:
        if a.get("kind") == "summon": continue
        gain = amount
        if src_level:
            gain = int(gain * max(0.25, min(3.0, 1 + (src_level - a["level"]) / 12)))
        if a.get("kind") == "player":
            gain = int(amount * (1 + C.species.get(a.get("species"), {}).get("xp_bonus", 0)))
        a["xp"] = a.get("xp", 0) + gain
        while a["level"] < C.rules["max_level"] and a["xp"] >= xp_to_next(a["level"]):
            a["xp"] -= xp_to_next(a["level"])
            new = level_up(a, camp)
            events.append({"type": "level_up", "uid": a["uid"], "name": a["name"], "level": a["level"],
                           "new_abilities": [C.abilities[x]["name"] for x in new], "stats": stats(a, camp)})
            if a.get("kind") == "player":
                camp.setdefault("stats", {}).setdefault("level_ups", []).append(a["level"])
                ms = C.rules["milestones"].get(str(a["level"]))
                if ms:
                    events.append({"type": "milestone", "level": a["level"], "reward": ms["reward"], "unlock": ms.get("unlock")})
                    offer_cards(camp, ms["reward"], dice, events, reason=f"Level {a['level']} milestone")
                elif C.rules.get("card_on_level_up") and a["level"] % C.rules.get("card_every", 1) == 0:
                    offer_cards(camp, "card", dice, events, reason=f"Level {a['level']}")
            elif a.get("uid") == "vermeil" and camp["settings"].get("vermeil_cards") and str(a["level"]) in C.rules["milestones"]:
                offer_cards(camp, "card", dice, events, reason=f"{a['name']} levelled up", target="vermeil")
    return True


# ---------------------------------------------------------------- cards
def card_eligible(camp, actor, cid, card):
    if actor.get("cards", []).count(cid) >= card.get("max", 1):
        return False
    req = card.get("requires", {})
    C = content()
    cl = C.classes.get(actor.get("cls"), {})
    if "stat_focus" in req:
        b = cl.get("base", {})
        if req["stat_focus"] == "patk" and b.get("patk", 0) < b.get("matk", 0): return False
        if req["stat_focus"] == "matk" and b.get("matk", 0) < b.get("patk", 0): return False
    if "element" in req:
        els = {C.abilities[a].get("element") for a in actor.get("abilities", []) if a in C.abilities}
        for slot in ("weapon",):
            from .actors import item_of
            it = item_of(camp, (actor.get("equipment") or {}).get(slot))
            if it and it.get("element"): els.add(it["element"])
        if req["element"] not in els: return False
    if req.get("heals"):
        if not any(C.abilities[a]["kind"] in ("heal",) for a in actor.get("abilities", []) if a in C.abilities): return False
    if "missing_ability" in req and req["missing_ability"] in actor.get("abilities", []):
        return False
    if card["effect"].get("passive") == "synergy" and not any(p["uid"] == "vermeil" for p in camp["party"]):
        return False
    return True


def offer_cards(camp, kind, dice, events, reason="", target=None):
    C = content()
    target = target or next(a["uid"] for a in camp["party"] if a.get("kind") == "player")
    actor = next(a for a in camp["party"] if a["uid"] == target)
    weights = C.card_weights.get(kind, C.card_weights["card"])
    eligible = {cid: c for cid, c in C.cards.items() if card_eligible(camp, actor, cid, c)}
    picks = []
    for _ in range(C.rules["cards_offered"]):
        left = {cid: c for cid, c in eligible.items() if cid not in picks}
        if not left: break
        by_rar = {}
        for cid, c in left.items(): by_rar.setdefault(c["rarity"], []).append(cid)
        rar = dice.weighted({r: w for r, w in weights.items() if r in by_rar}, "card_rarity")
        if rar is None: rar = sorted(by_rar)[0]
        picks.append(dice.pick(sorted(by_rar[rar]), "card"))
    if not picks: return None
    camp["offer_counter"] = camp.get("offer_counter", 0) + 1
    offer = {"id": f"o{camp['offer_counter']}", "target": target, "cards": picks, "reason": reason, "kind": kind}
    camp.setdefault("pending_cards", []).append(offer)
    events.append({"type": "card_offer", "offer": card_offer_public(offer)})
    return offer


def card_offer_public(offer):
    C = content()
    return {"id": offer["id"], "target": offer["target"], "reason": offer["reason"],
            "cards": [dict(C.cards[c], id=c) for c in offer["cards"]]}


def choose_card(camp, offer_id, card_id):
    """apply the chosen card. Validates the offer exists and the card was in it."""
    C = content()
    pend = camp.get("pending_cards", [])
    offer = next((o for o in pend if o["id"] == offer_id), None)
    if not offer: raise ValueError("That card offer is gone.")
    if card_id not in offer["cards"]: raise ValueError("That card wasn't offered.")
    actor = next(a for a in camp["party"] if a["uid"] == offer["target"])
    card = C.cards[card_id]
    if not card_eligible(camp, actor, card_id, card): raise ValueError("That card can't be taken any more.")
    before = stats(actor, camp)
    actor.setdefault("cards", []).append(card_id)
    eff = card["effect"]
    if eff.get("learn") and eff["learn"] not in actor["abilities"]:
        actor["abilities"].append(eff["learn"])
    if eff.get("gold"):
        camp["gold"] = camp.get("gold", 0) + eff["gold"]
    after = stats(actor, camp)
    actor["hp"] = min(after["hp"], actor["hp"] + max(0, after["hp"] - before["hp"]))   # new max HP is filled too
    actor["mana"] = min(after["mana"], actor.get("mana", 0) + max(0, after["mana"] - before["mana"]))
    pend.remove(offer)
    for o in list(pend):                      # other open offers can't contain cards that are now maxed out
        tgt = next((a for a in camp["party"] if a["uid"] == o["target"]), None)
        o["cards"] = [c for c in o["cards"] if tgt and card_eligible(camp, tgt, c, C.cards[c])]
        if not o["cards"]: pend.remove(o)
    camp.setdefault("card_history", []).append({"card": card_id, "name": card["name"], "rarity": card["rarity"],
                                                "target": actor["name"], "reason": offer["reason"],
                                                "stage": camp.get("quest_stage", 0), "location": camp.get("location"),
                                                "turn": camp.get("turn", 0)})
    return {"card": card["name"], "target": actor["name"], "before": before, "after": after}
