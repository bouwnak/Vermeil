"""companion.py - Vermeil as a character inside the adventure (not the assistant).

She has her own prompt (separate from the DM and from the assistant's normal personality), remembers a few
recent important moments, reacts to situations, and gives tactical advice. She never narrates the world,
never acts outside her combat turn, and never touches the inventory - she only talks here.
Lines are rate-limited so she doesn't comment on everything, and repeated lines are avoided.
"""
import json
import random

from . import ai
from .content import content

VERMEIL_SYSTEM = """You are Vermeil, the player's companion on a fantasy adventure (you are a character IN the story,
not an assistant). Personality: confident, mischievous, clever, protective, playful, occasionally teasing; loyal to the player;
you have your own opinions and you will disagree (in character) with reckless ideas. You get curious about strange places,
excited about treasure, worried when the player is hurt. Speak casually in 1-2 short sentences. Never narrate the world or other
characters' actions - only say what YOU say. Never use pet names or terms of endearment (no "darling", "sweetie", "dear", "love").
No emojis. Answer with JSON: {"line": "<what you say>", "mood": "happy|smug|worried|excited|annoyed|curious|determined|sad"}"""

# situation -> lines she can fall back on (no AI needed)
BANK = {
    "arrive": ["Ooh, new place. Let's poke at everything.", "Smells like adventure. And moss. Mostly moss.", "Stay close - I don't like the look of those shadows.",
               "This place has a story. I want to hear it.", "Pretty. Suspiciously pretty."],
    "portal": ["Well. That was a ride. You alright?", "Different sky, different rules. I like it already.", "Note to self: portals are rude."],
    "combat_start": ["Finally, something to hit!", "Behind me - or beside me. Your call.", "They picked the wrong pair to bother.",
                     "I'll take the ugly one. Wait - they're all ugly."],
    "boss": ["That's... big. Okay. We can do big.", "Remember the plan? Me neither. Let's improvise.", "Whatever happens, don't you dare fall."],
    "player_hurt": ["Hey! Hands off - that one's mine to protect.", "You're bleeding. Drink something, now.", "Don't make me carry you out of here."],
    "victory": ["Hah! Too easy.", "Not bad. Not bad at all.", "And that's how it's done.", "I'd call that a warm-up."],
    "level_up": ["Look at you, getting stronger.", "Feel that? That's growth. Don't let it go to your head.", "You're catching up to me. Cute."],
    "loot": ["Shiny! Mine. ...Fine, ours.", "Ooh, check what they dropped.", "Treasure is the best part. Don't tell anyone."],
    "discovery": ["See? Poking at things pays off.", "Now *that's* interesting.", "I knew there was something here."],
    "reckless": ["That's a terrible idea. I love it. Let's be careful though.", "Are you sure? ...You're sure. Okay.", "One day your luck runs out. Not today, apparently."],
    "recruit": ["A new friend? Fine. But I'm still your favourite.", "More hands, more fun.", "Welcome aboard. Keep up."],
    "defeat": ["Ow. Okay. We regroup and try again.", "That... did not go to plan.", "Up you get. We're not done."],
    "rest": ["Finally, a breather.", "Wake me if something tries to eat us.", "This is nice. Don't get used to it."],
    "npc": ["They seem nice. Probably hiding something.", "I like them. Don't tell them I said that.", "Hmm. Watch your purse around that one."],
    "low_hp_self": ["I'm fine. Mostly. Okay, a potion wouldn't hurt.", "Ugh, that stung."],
    "ending": ["We did it. We actually did it.", "Told you we'd win. Well, I thought it very loudly."],
}

COOLDOWN = {"arrive": 0, "combat_start": 1, "player_hurt": 2, "loot": 2, "npc": 2, "low_hp_self": 3}

OTHER_SYSTEM = """You are {name}, the player's companion on a fantasy adventure (you are a character IN the story, not an assistant).
Who you are (from the player's assistant app): {persona}
Stay true to that personality, but you are now adventuring: loyal to the player, with your own opinions; curious about strange places,
excited about treasure, worried when the player is hurt. Speak casually in 1-2 short sentences. Never narrate the world or other
characters' actions - only say what YOU say. No emojis. Answer with JSON: {{"line": "<what you say>", "mood": "happy|smug|worried|excited|annoyed|curious|determined|sad"}}"""


def name(camp):
    """the companion's name: whichever character was chosen in the assistant app when the adventure began (Vermeil by default)"""
    return (camp.get("companion") or {}).get("name") or "Vermeil"


def system_prompt(camp):
    c = camp.get("companion") or {}
    if not c.get("id") or c.get("id") == "vermeil":
        return VERMEIL_SYSTEM
    return OTHER_SYSTEM.format(name=c["name"], persona=(c.get("persona") or f"You are {c['name']}.")[:900])


def remember(camp, text):
    m = camp.setdefault("vermeil_memory", [])
    m.append(text[:160])
    del m[:-12]


def should_speak(camp, situation):
    cd = camp.setdefault("vermeil_cd", {})
    turn = camp.get("turn", 0)
    if situation in COOLDOWN and turn - cd.get(situation, -99) <= COOLDOWN[situation]:
        return False
    cd[situation] = turn
    return True


def react(camp, situation, detail="", force=False, use_ai=True):
    """-> {'line', 'mood', 'ai'} or None when she stays quiet."""
    if not force and not should_speak(camp, situation):
        return None
    said = camp.setdefault("vermeil_said", [])
    if use_ai:
        st = {"location": camp["locations"][camp["location"]]["name"], "quest": camp.get("quest", {}).get("stages", [{}])[min(
                camp.get("quest", {}).get("current", 0), len(camp.get("quest", {}).get("stages", [{}])) - 1)].get("objective"),
              "party": [{"name": p["name"], "hp": p["hp"]} for p in camp["party"]],
              "your_memories": camp.get("vermeil_memory", [])[-6:], "things_you_said_recently": said[-5:]}
        prompt = f"STATE: {json.dumps(st, ensure_ascii=False)}\nSITUATION: {situation}. {detail}\nSay something new (don't repeat yourself)."
        d = ai.ask(system_prompt(camp), prompt, timeout=12, temperature=0.95, max_tokens=150)
        if d and isinstance(d.get("line"), str) and d["line"].strip():
            line = ai.clean_text(d["line"], 220)
            line = scrub(line)
            said.append(line); del said[:-20]
            return {"line": line, "mood": d.get("mood") if d.get("mood") in ("happy", "smug", "worried", "excited", "annoyed", "curious", "determined", "sad") else "happy", "ai": True}
    opts = [l for l in BANK.get(situation, BANK["arrive"]) if l not in said[-6:]] or BANK.get(situation, BANK["arrive"])
    line = random.Random(f"{camp['seed']}{camp.get('turn', 0)}{situation}").choice(opts)
    said.append(line); del said[:-20]
    mood = {"combat_start": "determined", "boss": "determined", "player_hurt": "worried", "victory": "smug", "loot": "excited",
            "defeat": "sad", "level_up": "happy", "discovery": "excited", "reckless": "annoyed"}.get(situation, "happy")
    return {"line": line, "mood": mood, "ai": False}


def scrub(line):
    import re
    return re.sub(r",?\s*\b(darling|sweetie|sweetheart|honey|dear|love|babe|baby)\b", "", line, flags=re.I).strip()


def tactical_advice(camp):
    """a rule-based combat tip (used in 'tactical' and 'advice' modes)."""
    from .combat import side
    from .actors import stats
    C = content()
    foes = side(camp, "enemy")
    if not foes: return None
    player = next(p for p in camp["party"] if p.get("kind") == "player")
    pst = stats(player, camp)
    if player["hp"] < pst["hp"] * 0.35:
        return "You're hurt - heal up or defend this turn, I'll cover you."
    for f in foes:
        for a in player["abilities"]:
            el = C.abilities.get(a, {}).get("element")
            if el and el in f.get("weak", []):
                return f"{f['name']} hates {el} - hit it with {C.abilities[a]['name']}!"
        if f.get("immune"):
            return f"Careful, {f['name']} is immune to {', '.join(f['immune'])}."
    if len(foes) >= 3:
        aoe = [C.abilities[a]["name"] for a in player["abilities"] if C.abilities.get(a, {}).get("target") == "all_enemies"]
        if aoe: return f"They're bunched up - {aoe[0]} would hit all of them."
    weakest = min(foes, key=lambda f: f["hp"])
    return f"Let's focus {weakest['name']} - it's almost down."
