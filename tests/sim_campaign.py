"""sim_campaign.py - plays whole adventures with the real game engine (no window, no AI) to check balance and
progression: does the party reach the boss in quest order, how strong is it there, can it win?

    python tests/sim_campaign.py            # 6 campaigns, one line each + a summary
    python tests/sim_campaign.py 20 scifi   # 20 sci-fi campaigns
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [ROOT] + [os.path.join(ROOT, d) for d in ("brain", "senses", "skills")]
from game import ai, campaign, world  # noqa: E402

ai.disable(True)
campaign.SAVE_DIR = tempfile.mkdtemp(prefix="vda_sim_")          # never touch the real saves


def fight(g):
    for _ in range(400):
        cb = g.camp.get("combat")
        if not g.in_combat():
            return cb.get("result") if cb else None
        who = cb.get("waiting_for")
        if not who:
            return None
        p = next(a for a in g.camp["party"] if a["uid"] == who)
        foes = campaign.combat.side(g.camp, "enemy")
        if not foes:
            return None
        pots = [i for i in g.camp["inventory"] if i.get("base", "").startswith("potion")]
        if pots and p["hp"] < 0.35 * campaign.stats(p, g.camp)["hp"]:
            g.combat_act(who, {"type": "item", "item": pots[0]["uid"], "target": who})
        else:
            abil = next((x for x in p["abilities"] if x not in ("basic_attack", "basic_shot") and campaign.combat.usable(g.camp, p, x)[0]
                         and campaign.content().abilities[x]["target"] == "enemy"), "basic_attack")
            g.combat_act(who, {"type": "ability", "ability": abil, "target": min(foes, key=lambda e: e["hp"])["uid"]})
    return "stuck"


def clear_here(g):
    for _ in range(12):
        enc = next((e for e in g.loc()["encounters"] if not e["done"]), None)
        if not enc:
            return True
        g.engage(enc["id"])
        r = fight(g)
        while g.camp.get("pending_cards"):
            o = g.camp["pending_cards"][0]
            g.choose_card(o["id"], o["cards"][0]["id"] if isinstance(o["cards"][0], dict) else o["cards"][0])
        g.camp.pop("monster_offer", None)
        if r != "victory":
            return False
    return True


def train(g, rounds=3):
    """what a player does when the next fight is too hard: walk back and forth through cleared places, where
    monsters wander back in (roaming encounters), and fight them."""
    here = g.camp["location"]
    for _ in range(rounds):
        back = [x for x in g.loc()["links"] if not g.blocked(x) and g.loc(x)["kind"] != "boss"]
        if not back:
            return
        g.travel(sorted(back, key=lambda x: -g.loc(x)["level"])[0])
        clear_here(g); g.rest()
        if here in g.loc()["links"] and not g.blocked(here):
            g.travel(here); g.rest()
            if g.camp["location"] != here:
                return


def play(seed, genre=None, max_steps=160):
    g = campaign.Game.new(name="Sim", species="human", cls_id="warrior", genre=genre, seed=seed, use_ai=False)
    order, defeats, log = [], 0, []
    for _ in range(max_steps):
        if g.camp["status"] != "active":
            break
        q = g.camp["quest"]
        st = q["stages"][q["current"]]
        goal = st["location"]
        if g.camp["location"] != goal:
            path = world.main_path(g.camp, g.camp["location"], goal)
            nxt = path[1] if len(path) > 1 else None
            if not nxt or g.blocked(nxt):
                log.append(f"blocked toward {goal}")
                break
            g.travel(nxt)
            if g.camp["location"] != goal and not clear_here(g):
                defeats += 1; g.rest(); continue
            continue
        if not clear_here(g):
            defeats += 1
            g.rest()
            train(g)
            continue
        for t in g.loc()["treasure"]:
            if not t["found"]:
                g.open_treasure(t["id"])
        for _ in range(6):
            if q["current"] >= len(q["stages"]) or q["stages"][q["current"]]["location"] != goal:
                break
            g.search()
        if q["current"] < len(q["stages"]) and q["stages"][q["current"]] is st and not st["done"]:
            g.rest()                             # still not done: train a bit (roaming monsters come back)
        else:
            order.append(st["id"])
        g.rest()
    p = g.player()
    return {"seed": seed, "status": g.camp["status"], "stages": order, "player_level": p["level"], "boss_level": g.camp["quest"]["boss"]["level"],
            "defeats": defeats, "party": len(g.camp["party"]), "places": len(g.camp["locations"]), "log": log[-2:]}


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 6
    genre = sys.argv[2] if len(sys.argv) > 2 else None
    res = []
    for s in range(1, n + 1):
        try:
            r = play(1000 + s, genre)
        except Exception as e:
            import traceback; traceback.print_exc()
            r = {"seed": 1000 + s, "status": f"CRASH {e}"}
        res.append(r)
        print(r)
    won = sum(1 for r in res if r.get("status") == "complete")
    print(f"\n{won}/{len(res)} campaigns finished.")
