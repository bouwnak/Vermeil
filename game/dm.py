"""dm.py - the AI Dungeon Master.

The DM is creative (it describes, invents names, histories, dialogue, and decides what kind of check an idea
needs) but it is NOT the rules: it can only *propose* an action as structured JSON, and the engine validates
every field (ids must exist, DCs are clamped, effects must be on the allowed list). Nothing it writes can
change HP, levels or items directly.

When the AI is unavailable, a rules-based DM (keyword parser + templates) keeps the game playable.
"""
import difflib
import json
import re

from . import ai
from .content import content

INTENTS = ("move", "talk", "inspect", "search", "attack", "ability", "item", "defend", "flee", "rest", "interact",
           "maneuver", "recruit", "shop", "quest", "equip", "unclear", "other")
STATS = ("str", "dex", "int", "wis", "con", "cha")
EFFECTS = ("damage", "stun", "weaken", "dazed", "slow", "marked", "evasive", "fortify", "blessed", "might", "heal", "discover", "none")

DM_SYSTEM = """You are the Dungeon Master of a tabletop-style fantasy RPG played in 3D.
Voice: vivid, warm, a little theatrical, never long-winded (2-4 sentences). Second person ("you").
You narrate the world, play every non-player character except the player's companion (party id "vermeil"), and judge what the player's free-text action needs.
HARD RULES:
- You never decide numbers. Damage, hits, levels, XP and loot come from the game engine and dice.
- If an action is uncertain, ask for a check: pick a stat (str,dex,int,wis,con,cha) and a DC 5-25 (10 easy, 15 hard, 20 heroic).
- Only use ids that appear in the STATE (targets, abilities, items, exits, npcs). Never invent ids.
- Reward creativity, but impossible or "I instantly win" actions get a hard check or a polite no.
- The companion (party id "vermeil", see its name in STATE) is a separate character with their own voice - do not speak for them.
- Stay consistent with the established FACTS.
Always answer with ONE JSON object and nothing else."""

INTERPRET_SCHEMA = """Return JSON:
{"intent": one of move|talk|inspect|search|attack|ability|item|defend|flee|rest|interact|maneuver|recruit|shop|quest|equip|unclear|other,
 "target": "<an id from STATE or null>",
 "ability": "<ability id from STATE or null>",
 "item": "<item uid from STATE or null>",
 "destination": "<exit location id or null>",
 "check": {"stat": "dex", "dc": 13} or null,
 "effect": one of damage|stun|weaken|dazed|slow|marked|evasive|fortify|blessed|might|heal|discover|none,
 "name": "<2-4 word name for a creative maneuver, or null>",
 "on_success": "<1-2 sentences if the check succeeds>",
 "on_fail": "<1-2 sentences if it fails>",
 "narration": "<1-3 sentences describing the attempt (no results)>",
 "clarify": "<a short question if the intent is unclear, else null>",
 "fact": "<a new lasting world fact you established, or null>"}"""


# ------------------------------------------------------------------ state for prompts
def state_for_prompt(camp, extra=None):
    C = content()
    loc = camp["locations"][camp["location"]]
    party = []
    for p in camp["party"]:
        if not p.get("alive", True) and p.get("kind") != "player": continue
        party.append({"id": p["uid"], "name": p["name"], "class": C.classes.get(p.get("cls"), {}).get("name"), "hp": p["hp"],
                      "abilities": {a: C.abilities[a]["name"] for a in p.get("abilities", []) if a in C.abilities}})
    s = {
        "world": {"genre": camp["world"]["genre_name"], "mix": camp["world"].get("mix_name"), "premise": camp["world"]["premise"]},
        "quest": current_objective(camp),
        "location": {"id": loc["id"], "name": loc["name"], "biome": C.biomes[loc["biome"]]["name"], "safe": loc["safe"]},
        "exits": [{"id": x, "name": camp["locations"][x]["name"] if camp["locations"][x]["discovered"] else "an unexplored path"} for x in loc["links"]],
        "npcs": [{"id": n, "name": camp["npcs"][n]["name"], "role": camp["npcs"][n]["role"], "personality": camp["npcs"][n]["personality"]}
                 for n in loc["npcs"] if camp["npcs"][n].get("alive") and not camp["npcs"][n].get("joined")],
        "party": party,
        "items": [{"uid": i["uid"], "name": i["name"], "qty": i["qty"]} for i in camp.get("inventory", []) if i["slot"] in ("consumable", "quest")][:14],
        "facts": camp["world"].get("facts", [])[-12:],
        "recent": [f"{h['who']}: {h['text']}" for h in camp.get("history", [])[-8:]],
    }
    cb = camp.get("combat")
    if cb and cb.get("phase") not in (None, "ended"):
        from .combat import side
        s["combat"] = {"enemies": [{"id": e["uid"], "name": e["name"], "hp": e["hp"], "weak": e.get("weak", [])} for e in side(camp, "enemy")],
                       "whose_turn": cb.get("waiting_for")}
    if extra: s.update(extra)
    return s


def current_objective(camp):
    q = camp.get("quest") or {}
    st = q.get("stages", [])
    i = q.get("current", 0)
    if i < len(st):
        return {"title": q.get("title"), "objective": st[i]["objective"]}
    return {"title": q.get("title"), "objective": "The adventure is complete."}


# ------------------------------------------------------------------ campaign intro
def intro(camp):
    C = content()
    w = camp["world"]
    start = camp["locations"][camp["location"]]
    hub = next(l for l in camp["locations"].values() if l["kind"] == "hub")
    boss = camp["quest"]["boss"]
    prompt = (f"Create the opening of a new campaign.\nGENRE: {w['genre_name']}{' mixed with ' + w['mix_name'] if w.get('mix_name') else ''}\n"
              f"PREMISE: {w['premise']}\nThe party (the player and their companion {(camp.get('companion') or {}).get('name') or 'Vermeil'}) just stepped out of a magic portal into {start['name']} "
              f"({C.biomes[start['biome']]['name']}). The nearest settlement is {hub['name']}. The final villain is {boss['name']}, waiting at "
              f"{camp['locations'][boss['location']]['name']}. Quest steps: {[s['objective'] for s in camp['quest']['stages']]}.\n"
              'Return JSON: {"title": "<campaign title, 2-5 words>", "intro": "<3-4 sentences of narration as they arrive>", '
              '"hook": "<1-2 sentences: the first thing they notice that pulls them into the quest>", "facts": ["<2-3 short world facts>"]}')
    d = ai.ask(DM_SYSTEM, prompt, timeout=25)
    if d and isinstance(d.get("intro"), str):
        title = ai.clean_text(d.get("title") or "", 60) or fallback_title(camp)
        facts = [ai.clean_text(f, 160) for f in (d.get("facts") or []) if isinstance(f, str)][:3]
        return {"title": title, "intro": ai.clean_text(d["intro"], 700), "hook": ai.clean_text(d.get("hook") or "", 300), "facts": facts, "ai": True}
    return {"title": fallback_title(camp), "intro": f"The portal spits you out onto soft ground. {C.biomes[start['biome']]['name']} stretches around you - "
            f"{start['name']}. Somewhere beyond lies {hub['name']}, and further still, a darkness everyone here fears.",
            "hook": f"{w['premise']} The trail ahead leads toward {hub['name']}.", "facts": [w["premise"]], "ai": False}


def fallback_title(camp):
    boss = camp["quest"]["boss"]["name"].split(" the ")[0].split(" ")[-1]
    return f"The Shadow of {boss}"


# ------------------------------------------------------------------ describing places
def describe(camp, loc, first):
    C = content()
    b = C.biomes[loc["biome"]]
    npcs = [camp["npcs"][n] for n in loc["npcs"] if not camp["npcs"][n].get("joined")]
    danger = [e for e in loc["encounters"] if not e["done"]]
    q = camp["quest"]
    stage = q["stages"][q["current"]] if q["current"] < len(q["stages"]) else None
    here = stage and stage["location"] == loc["id"]
    if first:
        prompt = (f"STATE: {json.dumps(state_for_prompt(camp), ensure_ascii=False)}\n"
                  f"The party arrives at {loc['name']} ({b['name']}{', a river runs through it' if loc.get('river') else ''}) for the first time. "
                  f"People here: {[n['name'] + ' the ' + n['role'] for n in npcs][:6]}. {'You sense danger here.' if danger else 'It feels calm.'} "
                  f"{'This place matters to the quest: ' + stage['objective'] if here else ''}\n"
                  'Return JSON: {"narration": "<2-3 vivid sentences>", "fact": "<one lasting fact about this place or null>"}')
        d = ai.ask(DM_SYSTEM, prompt, timeout=18)
        if d and isinstance(d.get("narration"), str):
            return ai.clean_text(d["narration"], 600), ai.clean_text(d.get("fact") or "", 160) or None
    txt = {"forest": "Sunlight spills through red and gold leaves; the air smells of moss.",
           "meadow": "Wildflowers sway in a warm breeze across rolling green.",
           "village": "Smoke curls from chimneys and the square hums with chatter.",
           "swamp": "Mist clings to black water, and something croaks in the reeds.",
           "cave": "Crystals glitter in the dark, and water drips somewhere deep below.",
           "dungeon": "Torches gutter along cold stone walls. The silence is heavy.",
           "ruins": "Broken arches of white stone rise from the grass, older than any kingdom.",
           "graveyard": "Crooked headstones lean in the fog. A crow watches you.",
           "mountain": "Wind howls through the pass between towering cliffs.",
           "snow": "Snow crunches underfoot; your breath fogs in the frozen air.",
           "desert": "Heat shimmers over endless golden dunes.",
           "beach": "Waves roll onto pale sand and gulls cry over the cove.",
           "volcano": "The ground is warm and cracked, glowing with rivers of lava.",
           "jungle": "Giant ferns drip with dew, and something huge moves in the trees.",
           "city": "Broken streets, abandoned cars - and enormous footprints in the asphalt.",
           "scifi": "Steel domes hum with machinery under an alien sky.",
           "space": "Violet grass glows beneath a sky full of strange stars.",
           "castle": "Banners snap above stone walls as guards watch the gate.",
           "farmland": "Golden fields roll to the horizon; a windmill creaks and cows low nearby.",
           "harbor": "Ropes creak, gulls wheel over the masts, and the quay smells of salt and fish.",
           "sakura": "Pink petals drift past red torii gates; somewhere a temple bell hums.",
           "sky_isles": "Islands of grass float among the clouds, and coins glitter along the path.",
           "blockland": "Everything here is made of blocks - even the trees, even the sheep.",
           "manor": "Dust sheets cover the furniture, candles burn on their own, and floorboards creak.",
           "outpost": "Sandbags, crates and humming antennas - a frontier outpost under an orange sky.",
           "crypt": "Stone coffins line the walls and candles that nobody lit flicker in the dark.",
           "mines": "Lanterns sway over rails and glittering ore; the tunnels groan around you.",
           "space_station": "Emergency lights pulse red down empty corridors; something taps inside the vents.",
           "pirate_cove": "Waves echo through a sea cave stacked with crates, cannons and stolen gold."}.get(loc["biome"], "You look around.")
    lead = f"You arrive at {loc['name']}. " if first else f"Back at {loc['name']}. "
    return lead + txt + (" You sense danger here." if danger and first else ""), None


# ------------------------------------------------------------------ interpreting the player's text
def interpret(camp, text, req_id=None):
    """free text -> a validated intent dict (never raises; falls back to the keyword parser)."""
    C = content()
    max_len = C.rules["max_action_length"]
    text = (text or "").strip()[:max_len]
    if not text:
        return {"intent": "unclear", "clarify": "What do you do?", "source": "rules"}
    st = state_for_prompt(camp)
    prompt = f"STATE: {json.dumps(st, ensure_ascii=False)}\nPLAYER ACTION: {text}\n{INTERPRET_SCHEMA}"
    d = ai.ask(DM_SYSTEM, prompt, timeout=20, temperature=0.6, req_id=req_id)
    if d:
        v = validate_intent(camp, d)
        if v:
            v["source"] = "ai"
            return v
    v = rule_parse(camp, text)
    v["source"] = "rules"
    return v


def _ids(camp):
    from .combat import actors
    out = set(camp["npcs"].keys()) | {p["uid"] for p in camp["party"]}
    cb = camp.get("combat")
    if cb and cb.get("phase") not in (None, "ended"): out |= set(actors(camp).keys())
    loc = camp["locations"][camp["location"]]
    out |= {t["id"] for t in loc.get("treasure", [])}
    return out


def validate_intent(camp, d):
    """keep only valid, allowed values. Returns None if the answer is unusable."""
    if not isinstance(d, dict): return None
    C = content()
    intent = d.get("intent")
    if intent not in INTENTS: return None
    v = {"intent": intent}
    ids = _ids(camp)
    tgt = d.get("target")
    v["target"] = tgt if isinstance(tgt, str) and tgt in ids else None
    ab = d.get("ability")
    player = next(p for p in camp["party"] if p.get("kind") == "player")
    v["ability"] = ab if isinstance(ab, str) and (ab in player["abilities"] or ab in ("basic_attack",)) else None
    it = d.get("item")
    v["item"] = it if isinstance(it, str) and any(x["uid"] == it for x in camp.get("inventory", [])) else None
    dest = d.get("destination")
    v["destination"] = dest if isinstance(dest, str) and dest in camp["locations"][camp["location"]]["links"] else None
    chk = d.get("check")
    if isinstance(chk, dict) and chk.get("stat") in STATS:
        try:
            dc = int(chk.get("dc", 12))
        except (TypeError, ValueError):
            dc = 12
        R = C.rules["skill_check"]
        v["check"] = {"stat": chk["stat"], "dc": max(R["min_dc"], min(R["max_dc"], dc))}
    else:
        v["check"] = None
    v["effect"] = d.get("effect") if d.get("effect") in EFFECTS else "none"
    for k, lim in (("name", 40), ("on_success", 400), ("on_fail", 400), ("narration", 500), ("clarify", 200), ("fact", 160)):
        v[k] = ai.clean_text(d.get(k), lim) if isinstance(d.get(k), str) else None
    return v


def _best(name, options):
    """fuzzy-find a name in [(id, name)]."""
    name = name.lower()
    for i, n in options:
        if n.lower() in name or (len(name) > 3 and name in n.lower()): return i
    words = re.findall(r"[a-z']+", name)
    best, score = None, 0.0
    for i, n in options:
        for w in words:
            for part in n.lower().split():
                s = difflib.SequenceMatcher(None, w, part).ratio()
                if s > score and s > 0.78: best, score = i, s
    return best


def rule_parse(camp, text):
    """the offline Dungeon Master: understands common actions by keywords."""
    C = content()
    t = text.lower()
    loc = camp["locations"][camp["location"]]
    player = next(p for p in camp["party"] if p.get("kind") == "player")
    in_combat = camp.get("combat") and camp["combat"].get("phase") not in (None, "ended")
    v = {"intent": "other", "target": None, "ability": None, "item": None, "destination": None, "check": None, "effect": "none",
         "name": None, "on_success": None, "on_fail": None, "narration": None, "clarify": None, "fact": None}
    enemies = []
    if in_combat:
        from .combat import side
        enemies = [(e["uid"], e["name"]) for e in side(camp, "enemy")]
    allies = [(p["uid"], p["name"]) for p in camp["party"]]
    npcs = [(n, camp["npcs"][n]["name"]) for n in loc["npcs"] if not camp["npcs"][n].get("joined")]
    abil = [(a, C.abilities[a]["name"]) for a in player["abilities"] if a in C.abilities]
    items = [(i["uid"], i["name"]) for i in camp.get("inventory", []) if i["slot"] == "consumable"]
    exits = [(x, camp["locations"][x]["name"]) for x in loc["links"]]

    a = _best(t, abil)
    if a and in_combat:
        v.update(intent="ability", ability=a)
        ab = C.abilities[a]
        v["target"] = _best(t, enemies if ab["target"] in ("enemy",) else allies) if ab["target"] in ("enemy", "ally") else None
        return v
    if re.search(r"\b(drink|use|throw|quaff|eat|potion|elixir|ether|bomb|feather|antidote)\b", t):
        it = _best(t, items) or (next((i for i, n in items if "potion" in n.lower()), None) if "potion" in t or "heal" in t else None)
        if it:
            v.update(intent="item", item=it, target=_best(t, allies))
            return v
    if re.search(r"\b(defend|block|guard|brace|shield up)\b", t) and in_combat:
        v["intent"] = "defend"; return v
    if re.search(r"\b(flee|run away|escape|retreat)\b", t):
        v["intent"] = "flee" if in_combat else "other"; return v
    if re.search(r"\b(attack|hit|strike|slash|stab|shoot|punch|kick|smash|fight|charge)\b", t):
        tgt = _best(t, enemies) if enemies else None
        if in_combat:
            v.update(intent="attack", target=tgt)
            return v
        v.update(intent="attack", target=_best(t, npcs))
        return v
    if re.search(r"\b(go|travel|head|walk|move|leave|enter|follow the path)\b", t):
        dest = _best(t, exits)
        if dest:
            v.update(intent="move", destination=dest); return v
        if re.search(r"\b(leave|onward|next|deeper|continue)\b", t) and exits:
            undiscovered = [x for x, _ in exits if not camp["locations"][x]["visited"]]
            v.update(intent="move", destination=(undiscovered or [exits[0][0]])[0]); return v
    if re.search(r"\b(recruit|join (us|me|the party)|come with (us|me))\b", t):
        v.update(intent="recruit", target=_best(t, npcs)); return v
    if re.search(r"\b(buy|sell|shop|trade|wares)\b", t):
        v.update(intent="shop", target=_best(t, npcs)); return v
    if re.search(r"\b(talk|ask|speak|say|tell|greet|hello|hi)\b", t) or _best(t, npcs):
        tgt = _best(t, npcs)
        if tgt:
            v.update(intent="talk", target=tgt); return v
    if re.search(r"\b(open|loot|chest|treasure)\b", t):
        v["intent"] = "interact"; return v
    if re.search(r"\b(search|look|inspect|examine|investigate|check)\b", t):
        v.update(intent="search", check={"stat": "wis", "dc": 12}); return v
    if re.search(r"\b(rest|sleep|camp|nap)\b", t):
        v["intent"] = "rest"; return v
    if re.search(r"\b(quest|objective|what now|where (do|should) (we|i) go)\b", t):
        v["intent"] = "quest"; return v
    # something creative: give it a fair check on the most fitting stat
    stat = "dex"
    if re.search(r"\b(lift|push|break|climb|force|smash|throw)\b", t): stat = "str"
    elif re.search(r"\b(sneak|hide|dodge|jump|steal|pick)\b", t): stat = "dex"
    elif re.search(r"\b(convince|persuade|charm|lie|bluff|intimidate|sing|dance)\b", t): stat = "cha"
    elif re.search(r"\b(remember|recall|read|decipher|study|analy[sz]e)\b", t): stat = "int"
    elif re.search(r"\b(listen|sense|track|pray|feel)\b", t): stat = "wis"
    v.update(intent="maneuver" if in_combat else "other", check={"stat": stat, "dc": 13},
             effect="dazed" if in_combat else "discover", name="Bold Move",
             on_success="It works - better than you hoped!", on_fail="It doesn't quite go to plan.",
             narration=f"You try it: {text[:120]}")
    return v


# ------------------------------------------------------------------ NPC dialogue
def npc_reply(camp, npc, player_text, req_id=None):
    C = content()
    loc = camp["locations"][npc["location"]]
    mem = npc.get("memory", [])[-6:]
    prompt = (f"STATE: {json.dumps(state_for_prompt(camp), ensure_ascii=False)}\n"
              f"You now speak as {npc['name']}, a {npc['personality']} {npc['role']} at {loc['name']}. "
              f"Relationship with the party: {npc.get('relationship', 0)} (-3 hostile .. +3 friendly). "
              f"What they've said before: {mem}.\n"
              f"{'They might be willing to join an adventuring party. ' if npc.get('recruitable') else ''}"
              f"{'They run a shop. ' if npc.get('shop') else ''}"
              f"The player says: \"{player_text[:300]}\"\n"
              'Return JSON: {"reply": "<their spoken words, 1-3 sentences, in character>", "mood": "happy|neutral|angry|sad|scared|flirty|suspicious", '
              '"relationship_change": -1|0|1, "offers_quest": true|false, "quest_hint": "<if they offer help/quest: what they need, else null>", '
              '"wants_to_join": true|false, "fact": "<a lasting fact they revealed or null>"}')
    d = ai.ask(DM_SYSTEM, prompt, timeout=18, req_id=req_id)
    if d and isinstance(d.get("reply"), str):
        rc = d.get("relationship_change", 0)
        rc = rc if rc in (-1, 0, 1) else 0
        return {"reply": ai.clean_text(d["reply"], 500), "mood": d.get("mood") if d.get("mood") in
                ("happy", "neutral", "angry", "sad", "scared", "flirty", "suspicious") else "neutral",
                "relationship_change": rc, "offers_quest": bool(d.get("offers_quest")),
                "quest_hint": ai.clean_text(d.get("quest_hint") or "", 200) or None,
                "wants_to_join": bool(d.get("wants_to_join")), "fact": ai.clean_text(d.get("fact") or "", 160) or None, "ai": True}
    return fallback_npc(camp, npc, player_text)


GREET = {"cheerful": "Well hello there, travellers!", "grumpy": "What do you want?", "shy": "Oh! Um... hello.",
         "boastful": "You're lucky to meet me, you know.", "wise": "Welcome. The road brought you here for a reason.",
         "nervous": "D-did you see anything out there?", "flirty": "Well, aren't you a pleasant surprise.",
         "suspicious": "Strangers. Hm. State your business.", "kind": "You look tired - be welcome here.",
         "greedy": "Got coin? Then we can talk.", "brave": "Need a hand with something dangerous?",
         "lazy": "*yawns* ...Yeah?", "curious": "Ooh, where did you come from? Tell me everything!",
         "melancholy": "Another day under these grey skies...", "sarcastic": "Oh great, more heroes.",
         "honest": "I'll tell you straight - things are bad around here.", "dramatic": "At last! Destiny arrives!",
         "pious": "Blessings upon you, wanderers.", "mysterious": "...I knew you would come.", "chatty": "Hi hi! Did you hear the news?"}


def fallback_npc(camp, npc, text):
    q = current_objective(camp)
    t = text.lower()
    if re.search(r"\b(join|come with|recruit)\b", t):
        reply = "Join you? Hmm... let me think about it." if npc.get("recruitable") else "Me? No, my place is here."
    elif re.search(r"\b(quest|help|need|problem|monster|danger)\b", t):
        reply = f"If you want to help, people say: {q['objective'].lower()}."
    elif re.search(r"\b(buy|sell|shop|trade)\b", t) and npc.get("shop"):
        reply = "Take a look at my wares."
    else:
        reply = GREET.get(npc.get("personality"), "Hello.")
    return {"reply": reply, "mood": "neutral", "relationship_change": 0, "offers_quest": False, "quest_hint": None,
            "wants_to_join": bool(npc.get("recruitable")) and "join" in t, "fact": None, "ai": False}


# ------------------------------------------------------------------ narration of results / endings
def narrate_outcome(camp, what, req_id=None, timeout=14):
    """short flavour narration for an engine result (e.g. victory, discovery). Optional - falls back to None."""
    prompt = (f"STATE: {json.dumps(state_for_prompt(camp), ensure_ascii=False)}\nWHAT JUST HAPPENED (engine result, don't change it): {what}\n"
              'Return JSON: {"narration": "<1-2 sentences of narration>"}')
    d = ai.ask(DM_SYSTEM, prompt, timeout=timeout, req_id=req_id)
    if d and isinstance(d.get("narration"), str):
        return ai.clean_text(d["narration"], 400)
    return None


def ending(camp):
    q = camp["quest"]
    st = camp.get("stats", {})
    prompt = (f"STATE: {json.dumps(state_for_prompt(camp), ensure_ascii=False)}\nThe party defeated {q['boss']['name']}. "
              f"Key choices they made: {camp.get('choices', [])[-8:]}. Monsters defeated: {st.get('monsters_defeated', 0)}.\n"
              'Write the campaign ending. Return JSON: {"ending": "<4-6 sentences: what the victory means for this world and its people>", '
              '"epilogue": "<1-2 sentences, a hint of what comes next>"}')
    d = ai.ask(DM_SYSTEM, prompt, timeout=25)
    if d and isinstance(d.get("ending"), str):
        return {"ending": ai.clean_text(d["ending"], 900), "epilogue": ai.clean_text(d.get("epilogue") or "", 300)}
    hub = next(l for l in camp["locations"].values() if l["kind"] == "hub")
    return {"ending": f"With {q['boss']['name']} defeated, the shadow over this land lifts. In {hub['name']} the bells ring until dawn, "
                      f"and travellers tell the tale of the stranger from the portal and the crimson-eyed girl beside them.",
            "epilogue": "But portals, once opened, rarely close for good..."}
