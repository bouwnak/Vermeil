"""Plays whole campaigns automatically (no AI, no graphics) to check balance and that every campaign can be finished.
    python game_tools/simulate.py 20      -> plays 20 seeds, prints a summary"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from game import ai
ai.disable(True)
from game.campaign import Game, GameError
from game import combat, world


def autoplay(seed, cls="warrior", species="human", verbose=False, max_steps=4000):
    g = Game.new(name="Bot", species=species, cls_id=cls, seed=seed, use_ai=False)
    camp = g.camp
    steps = 0
    log = []

    def cards():
        while camp.get("pending_cards"):
            o = camp["pending_cards"][0]
            g.choose_card(o["id"], o["cards"][0])

    def fight(enc_id):
        g.engage(enc_id)
        n = 0
        while g.in_combat() and n < 300:
            n += 1
            cb = camp["combat"]
            who = cb.get("waiting_for")
            a = combat.get(camp, who)
            opts = combat.options(camp, a)
            usable = [x for x in opts["abilities"] if x["ok"]]
            heal = [x for x in usable if x["target"] in ("ally", "all_allies") and "heal" in x["id"]]
            pots = [i for i in opts["items"] if "Potion" in i["name"]]
            from game.actors import stats
            if a["hp"] < stats(a, camp)["hp"] * 0.35 and pots:
                g.combat_act(who, {"type": "item", "item": pots[0]["uid"], "target": who}); continue
            dmg = [x for x in usable if x["target"] in ("enemy", "all_enemies")]
            pick = dmg[-1] if dmg else usable[0]
            g.combat_act(who, {"type": "ability", "ability": pick["id"]})
        cards()
        return camp["combat"]["result"] if camp.get("combat") else "defeat/flee"

    q = camp["quest"]
    defeats = 0
    while camp["status"] == "active" and steps < max_steps:
        steps += 1
        cards()
        loc = g.loc()
        open_enc = [e for e in loc["encounters"] if not e["done"]]
        boss_enc = [e for e in open_enc if e.get("boss")]
        normal = [e for e in open_enc if not e.get("boss")]
        target = q["stages"][q["current"]]["location"] if q["current"] < len(q["stages"]) else None
        p = g.player()
        from game.actors import stats
        if p["hp"] < stats(p, camp)["hp"] * 0.6 and not open_enc:
            g.rest(); continue
        if normal:
            r = fight(normal[0]["id"]); log.append(r)
            if r == "defeat/flee" and camp["location"] != loc["id"]: defeats += 1
            continue
        for t in loc["treasure"]:
            if not t["found"]:
                g.open_treasure(t["id"]); cards()
        if q["current"] < len(q["stages"]) and q["stages"][q["current"]]["kind"] == "explore" and target == loc["id"]:
            g.search(); cards(); continue
        if boss_enc:
            # grind a bit before the boss: go back if under-levelled
            r = fight(boss_enc[0]["id"]); log.append("BOSS " + r)
            if camp["location"] != loc["id"]: defeats += 1
            continue
        if not target: break
        # train when the next area is too dangerous: go back to a cleared wild place (monsters wander back)
        tl = g.loc(target)["level"]
        if (p["level"] + 1 < tl or (g.loc(target)["kind"] == "boss" and p["level"] < tl)) and steps % 2 == 0:
            back = [x for x in loc["links"] if g.loc(x)["level"] <= p["level"] + 1 and x != target]
            if back:
                g.travel(back[0]); continue
        path = world.main_path(camp, loc["id"], target)
        nxt = path[1] if len(path) > 1 else None
        if nxt is None:
            # at the objective with nothing to do: explore neighbours
            cand = [x for x in loc["links"] if not g.loc(x)["visited"]] or loc["links"]
            nxt = cand[0]
        try:
            g.travel(nxt)
        except GameError as e:
            log.append(str(e)); break
    return {"seed": seed, "status": camp["status"], "level": g.player()["level"], "steps": steps, "battles": len(log),
            "defeats": camp["stats"].get("defeats", 0), "cards": len(camp.get("card_history", [])), "genre": camp["world"]["genre"],
            "boss": q["boss"]["name"], "monsters": camp["stats"].get("monsters_defeated"), "dice_rolls": camp["dice"]["n"]}


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    classes = ["warrior", "mage", "rogue", "cleric", "ranger", "knight", "paladin", "monk", "elementalist", "summoner"]
    t = time.time()
    res = [autoplay(s, classes[s % len(classes)]) for s in range(n)]
    for r in res: print(r)
    done = sum(1 for r in res if r["status"] == "complete")
    print(f"{done}/{n} campaigns finished in {time.time() - t:.1f}s")
