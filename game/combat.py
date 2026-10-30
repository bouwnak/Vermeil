"""combat.py - turn-based battles (the rules engine is the only thing that changes HP).

State machine (camp["combat"]["phase"]):
    start -> (initiative) -> next turn -> AI acts / waits for the player ("player_input") -> resolve -> ... -> ended

Formulas (numbers live in data/rules.json):
    hit:     d20 + accuracy (+ability bonus)  >=  10 + target evasion        natural 20 = critical, natural 1 = miss
    crit:    natural 20, or a hit with d100 <= crit%  -> damage x2 (+ Brutal Criticals card)
    damage:  dice + stat x power  -  defence x 0.5   (min 1)    x element (weak 1.5 / resist 0.5 / immune 0)
    heal:    dice + stat x power  (x Healing Hands card)
    initiative: d20 + speed      flee: d20 + speed >= 10 + fastest enemy speed (bosses block fleeing)
Every die rolled is sent to the client in order, so the 3D dice show the real numbers.
"""
from .actors import make_summon, passive, power, public, stats, weapon_dice
from .content import content
from .inventory import add, item_of, remove, roll_loot
from .progression import award_xp, offer_cards

HUMAN = ("player",)


class ActionError(ValueError):
    pass


# ------------------------------------------------------------------ helpers
def _cb(camp):
    cb = camp.get("combat")
    if not cb or cb.get("phase") == "ended":
        raise ActionError("There's no battle going on.")
    return cb


def actors(camp):
    """every actor in the fight (party members are the real party dicts)."""
    cb = camp["combat"]
    party = {a["uid"]: a for a in camp["party"]}
    out = {}
    for uid in cb["order_all"]:
        out[uid] = party.get(uid) or cb["enemies"].get(uid) or cb["summons"].get(uid)
    return {k: v for k, v in out.items() if v}


def get(camp, uid):
    a = actors(camp).get(uid)
    if not a: raise ActionError("That target isn't in this fight.")
    return a


def side(camp, team, alive=True):
    return [a for a in actors(camp).values() if a["team"] == team and (a["alive"] or not alive)]


def is_human(camp, a):
    if a.get("kind") == "player": return True
    if a.get("uid") == "vermeil" and camp["settings"].get("vermeil_control") == "direct": return True
    if a.get("kind") == "ally" and camp["settings"].get("ally_control") == "direct": return True
    return False


def has_status(a, sid):
    return any(s["id"] == sid for s in a.get("statuses", []))


def status_val(a, sid):
    return sum(s.get("value", 0) for s in a.get("statuses", []) if s["id"] == sid)


def add_status(a, sid, turns, value, src, events):
    if sid in ("poison", "burn") and sid in a.get("immune", []): return
    for s in a["statuses"]:
        if s["id"] == sid:
            s["turns"] = max(s["turns"], turns)
            s["value"] = max(s.get("value", 0), value or 0)
            break
    else:
        a["statuses"].append({"id": sid, "turns": turns, "value": value or 0, "src": src})
    nm = content().status.get(sid, {}).get("name", sid)
    events.append({"type": "status", "target": a["uid"], "id": sid, "on": True, "name": nm})


def elem_mult(target, element):
    R = content().rules["elements"]
    if not element: return 1.0, ""
    if element in target.get("immune", []): return R["immune"], "immune"
    if element in target.get("weak", []): return R["weak"], "weak"
    if element in target.get("resist", []): return R["resist"], "resist"
    return 1.0, ""


def dice_expr(spec, a, camp):
    """'weapon+1d6' -> ['1d8', '1d6'] (weapon dice first)."""
    out, element, ranged = [], None, False
    for part in str(spec).split("+"):
        part = part.strip()
        if part == "weapon":
            d, element, ranged = weapon_dice(a, camp)
            out.append(d)
        elif part:
            out.append(part)
    return out, element, ranged


# ------------------------------------------------------------------ start
def start(camp, enemies, dice, encounter_id=None, boss=False, surprise=None, flee_allowed=True):
    """begin a battle. enemies = list of actor dicts made with actors.make_enemy."""
    C = content()
    if camp.get("combat") and camp["combat"].get("phase") != "ended":
        raise ActionError("Already in a battle.")
    party = [a for a in camp["party"] if a["alive"]]
    for a in camp["party"]:
        a["statuses"] = [s for s in a.get("statuses", []) if s["id"] not in ("defending", "taunted")]
        a["cooldowns"] = {}
        a.pop("revived_once", None)
    cb = {"id": f"c{camp.get('battles', 0) + 1}", "enemies": {e["uid"]: e for e in enemies}, "summons": {},
          "order_all": [a["uid"] for a in party] + [e["uid"] for e in enemies], "round": 0, "order": [], "idx": -1,
          "phase": "start", "result": None, "boss": boss or any(e["kind"] == "boss" for e in enemies),
          "flee_allowed": flee_allowed and not boss, "encounter": encounter_id, "defeated": [], "log": [],
          "hit_this_round": {}, "rewards_paid": False}
    camp["combat"] = cb
    camp["battles"] = camp.get("battles", 0) + 1
    events = [{"type": "combat_start", "id": cb["id"], "boss": cb["boss"],
               "party": [public(a, camp) for a in party], "enemies": [public(e, camp) for e in enemies]}]
    # opening ward card
    for a in party:
        bar = passive(a, camp, "start_barrier")
        if bar: add_status(a, "barrier", 99, bar, a["uid"], events)
    roll_initiative(camp, dice, events, surprise)
    events += advance(camp, dice)
    return events


def roll_initiative(camp, dice, events, surprise=None):
    cb = camp["combat"]
    rolls = []
    for uid, a in actors(camp).items():
        if not a["alive"]: continue
        st = stats(a, camp)
        r = dice.d20(f"{a['name']} initiative", st["spd"])
        bonus = passive(a, camp, "first_strike") if cb["round"] == 0 else 0
        if surprise == a["team"]: bonus += 10
        rolls.append((r["total"] + bonus, st["spd"], a["uid"]))
        events.append({"type": "dice", "die": 20, "rolls": r["rolls"], "mod": r["mod"], "total": r["total"] + bonus,
                       "who": a["uid"], "reason": "initiative", "quiet": True})
    rolls.sort(key=lambda x: (-x[0], -x[1], x[2]))
    cb["order"] = [u for _, _, u in rolls]
    cb["idx"] = -1
    events.append({"type": "initiative", "order": cb["order"]})


# ------------------------------------------------------------------ the turn loop
def current(camp):
    cb = camp["combat"]
    return cb["order"][cb["idx"]] if 0 <= cb["idx"] < len(cb["order"]) else None


def advance(camp, dice):
    """run turns until a human must choose, or the battle ends."""
    C = content()
    cb = camp["combat"]
    events = []
    guard = 0
    while True:
        guard += 1
        if guard > 400: break
        end = check_end(camp, dice, events)
        if end: return events
        cb["idx"] += 1
        if cb["idx"] >= len(cb["order"]):
            cb["round"] += 1
            cb["hit_this_round"] = {}
            if cb["round"] > C.rules["combat_round_limit"]:
                events.append({"type": "log", "text": "The fight drags on too long - both sides fall back."})
                finish(camp, "fled", dice, events)
                return events
            # new arrivals (summons) join the order at the end of the round
            alive = [u for u in cb["order_all"] if actors(camp).get(u, {}).get("alive")]
            cb["order"] = [u for u in cb["order"] if u in alive] + [u for u in alive if u not in cb["order"]]
            cb["idx"] = 0
            events.append({"type": "round", "round": cb["round"] + 1})
        uid = current(camp)
        a = actors(camp).get(uid)
        if not a or not a["alive"]: continue
        events.append({"type": "turn", "uid": uid, "name": a["name"], "round": cb["round"] + 1})
        if not start_of_turn(camp, a, dice, events):
            continue                                      # stunned/frozen/burned to death/summon expired
        if is_human(camp, a):
            cb["phase"] = "player_input"
            cb["waiting_for"] = uid
            events.append({"type": "your_turn", "uid": uid, "options": options(camp, a)})
            return events
        cb["phase"] = "resolving"
        act = choose_ai(camp, a, dice)
        try:
            events += resolve(camp, a, act, dice)
        except ActionError as e:                          # AI picked something invalid: just attack
            events.append({"type": "log", "text": f"({a['name']}: {e})"})
            events += resolve(camp, a, {"type": "ability", "ability": a["abilities"][0] if a["team"] == "enemy" else "basic_attack",
                                        "target": first_enemy(camp, a)["uid"]}, dice)
    return events


def start_of_turn(camp, a, dice, events):
    """damage/heal over time, ticking effects. Returns False if the actor loses this turn."""
    C = content()
    st = stats(a, camp)
    for s in list(a["statuses"]):
        d = C.status.get(s["id"], {})
        if d.get("dot") and a["alive"]:
            mult, note = elem_mult(a, d.get("element"))
            dmg = max(1, int(s["value"] * mult)) if mult > 0 else 0
            if dmg:
                deal(camp, a, dmg, events, src=s.get("src"), element=d.get("element"), note=d["name"])
        if d.get("hot") and a["alive"]:
            heal(camp, a, s["value"], events, note=d["name"])
    # Rebirth card: rally below half HP
    r = passive(a, camp, "rally")
    if r and a["alive"] and a["hp"] < st["hp"] / 2:
        heal(camp, a, int(st["hp"] * r), events, note="Rebirth")
    for k in list(a.get("cooldowns", {})):
        a["cooldowns"][k] -= 1
        if a["cooldowns"][k] <= 0: del a["cooldowns"][k]
    skip = None
    for s in list(a["statuses"]):
        d = C.status.get(s["id"], {})
        if d.get("skip") and not skip: skip = d["name"]
        if s["id"] == "defending" or s["turns"] < 99:
            s["turns"] -= 1
        if s["turns"] <= 0:
            a["statuses"].remove(s)
            events.append({"type": "status", "target": a["uid"], "id": s["id"], "on": False})
    if a.get("kind") == "summon":
        a["lasts"] = a.get("lasts", 3) - 1
        if a["lasts"] < 0:
            a["alive"] = False
            events.append({"type": "vanish", "uid": a["uid"], "text": f"{a['name']} fades away."})
            return False
    if a.get("kind") == "boss": boss_phase(camp, a, dice, events)
    if not a["alive"]: return False
    if skip:
        events.append({"type": "log", "uid": a["uid"], "text": f"{a['name']} is {skip.lower()} and loses the turn!"})
        return False
    return True


def boss_phase(camp, a, dice, events):
    st = stats(a, camp)
    ph = a.get("phases", [])
    while a.get("phase", 0) < len(ph) and a["hp"] <= st["hp"] * ph[a["phase"]]["below"]:
        p = ph[a["phase"]]
        a["phase"] += 1
        for ab in p.get("add", []):
            if ab not in a["abilities"]: a["abilities"].append(ab)
        if p.get("summon"): a["minion"] = p["summon"]
        events.append({"type": "boss_phase", "uid": a["uid"], "phase": a["phase"] + 1, "line": p.get("line", "")})


# ------------------------------------------------------------------ options & validation
def usable(camp, a, aid):
    C = content()
    ab = C.abilities.get(aid)
    if not ab: return False, "unknown ability"
    if aid not in a["abilities"] and aid not in ("basic_attack", "basic_shot", "basic_spell"): return False, "not learned"
    cost = max(0, ab.get("cost", 0) - int(passive(a, camp, "cost_reduction")))
    if a.get("mana", 0) < cost: return False, f"needs {cost} {resource(a)}"
    if a.get("cooldowns", {}).get(aid): return False, f"ready in {a['cooldowns'][aid]} turn(s)"
    return True, ""


def resource(a):
    return content().classes.get(a.get("cls"), {}).get("resource", "mana")


def options(camp, a):
    """what the player can do this turn (shown as hints; free text still works)."""
    C = content()
    abil = []
    basic = "basic_shot" if weapon_dice(a, camp)[2] else "basic_attack"
    for aid in [basic] + [x for x in a["abilities"] if x not in ("basic_attack",)]:
        ok, why = usable(camp, a, aid)
        ab = C.abilities[aid]
        abil.append({"id": aid, "name": ab["name"], "desc": ab.get("desc", ""), "ok": ok, "why": why,
                     "target": ab["target"], "cost": ab.get("cost", 0), "element": ab.get("element")})
    items = [{"uid": it["uid"], "name": it["name"], "qty": it["qty"], "target": it.get("target") or "ally"}
             for it in camp.get("inventory", []) if it["slot"] == "consumable"]
    return {"abilities": abil, "items": items, "can_flee": camp["combat"]["flee_allowed"],
            "enemies": [{"uid": e["uid"], "name": e["name"]} for e in side(camp, "enemy")],
            "allies": [{"uid": p["uid"], "name": p["name"], "alive": p["alive"]} for p in side(camp, a["team"], alive=False)]}


def first_enemy(camp, a):
    foes = side(camp, "enemy" if a["team"] == "party" else "party")
    taunter = next((f for f in foes if f.get("taunts") or has_status(a, "taunted") and f["uid"] == taunt_src(a)), None)
    return taunter or (foes[0] if foes else None)


def taunt_src(a):
    for s in a.get("statuses", []):
        if s["id"] == "taunted": return s.get("src")
    return None


def targets_for(camp, a, ab, target_uid):
    """resolve the target list for an ability, validating the choice."""
    kind = ab["target"]
    foes_team = "enemy" if a["team"] == "party" else "party"
    if kind == "self": return [a]
    if kind == "all_enemies": return side(camp, foes_team)
    if kind == "all_allies": return side(camp, a["team"])
    if kind == "ally_dead":
        t = get(camp, target_uid) if target_uid else next((x for x in side(camp, a["team"], alive=False) if not x["alive"]), None)
        if not t or t["team"] != a["team"] or t["alive"]: raise ActionError("Choose a fallen ally.")
        return [t]
    if kind == "ally":
        t = get(camp, target_uid) if target_uid else a
        if t["team"] != a["team"] or not t["alive"]: raise ActionError("Choose a living ally.")
        return [t]
    # enemy
    t = get(camp, target_uid) if target_uid else first_enemy(camp, a)
    if not t: raise ActionError("No enemy to target.")
    if t["team"] == a["team"]: raise ActionError("That's an ally!")
    if not t["alive"]: raise ActionError(f"{t['name']} is already down.")
    src = taunt_src(a)
    if src and src != t["uid"] and any(x["uid"] == src and x["alive"] for x in side(camp, foes_team)):
        t = get(camp, src)                              # taunted: must hit the taunter
    return [t]


def submit(camp, uid, action, dice):
    """a human-controlled actor acts. action = {'type': 'ability'|'item'|'defend'|'flee'|'maneuver', ...}"""
    cb = _cb(camp)
    if cb["phase"] != "player_input":
        raise ActionError("Wait - it's not time to choose an action.")
    if cb.get("waiting_for") != uid:
        who = get(camp, cb.get("waiting_for"))["name"] if cb.get("waiting_for") else "someone else"
        raise ActionError(f"It's {who}'s turn.")
    a = get(camp, uid)
    cb["phase"] = "resolving"
    try:
        events = resolve(camp, a, action, dice)
    except ActionError:
        cb["phase"] = "player_input"                    # invalid: nothing happened, still your turn
        raise
    cb["waiting_for"] = None
    events += advance(camp, dice)
    return events


# ------------------------------------------------------------------ resolving actions
def resolve(camp, a, action, dice):
    C = content()
    t = action.get("type", "ability")
    events = []
    if t == "defend":
        add_status(a, "defending", 1, 0, a["uid"], events)
        events.insert(0, {"type": "action", "uid": a["uid"], "name": "Defend", "anim": "block", "vfx": "shield", "targets": [a["uid"]]})
        events.append({"type": "log", "uid": a["uid"], "text": f"{a['name']} takes a defensive stance (harder to hit, half damage)."})
        return events
    if t == "wait":
        events.append({"type": "log", "uid": a["uid"], "text": f"{a['name']} waits."})
        return events
    if t == "flee" and a["team"] == "enemy":          # a cowardly monster runs off (no reward for it)
        a["alive"] = False
        a["fled"] = True
        return [{"type": "enemy_flee", "uid": a["uid"], "text": f"{a['name']} panics and runs away!"}]
    if t == "flee":
        return try_flee(camp, a, dice, action.get("bonus", 0))
    if t == "item":
        return use_item(camp, a, action.get("item"), action.get("target"), dice)
    if t == "maneuver":
        return maneuver(camp, a, action, dice)
    aid = action.get("ability") or "basic_attack"
    ok, why = usable(camp, a, aid)
    if not ok: raise ActionError(f"Can't use {C.abilities.get(aid, {}).get('name', aid)}: {why}.")
    ab = C.abilities[aid]
    tgts = targets_for(camp, a, ab, action.get("target"))
    cost = max(0, ab.get("cost", 0) - int(passive(a, camp, "cost_reduction")))
    a["mana"] = a.get("mana", 0) - cost
    if ab.get("cooldown"): a.setdefault("cooldowns", {})[aid] = ab["cooldown"] + 1
    _, w_el, w_ranged = weapon_dice(a, camp)
    vfx = ab.get("vfx")
    if aid == "basic_attack" and w_ranged: vfx = "arrow"
    events.append({"type": "action", "uid": a["uid"], "ability": aid, "name": ab["name"], "anim": ab.get("anim", "attack"),
                   "vfx": vfx, "element": ab.get("element") or (w_el if "weapon" in str(ab.get("dice", "")) else None),
                   "ranged": ab.get("ranged", False) or (w_ranged and "weapon" in str(ab.get("dice", ""))),
                   "targets": [x["uid"] for x in tgts], "cost": cost})
    kind = ab["kind"]
    if kind in ("attack", "spell"):
        for tg in tgts:
            for _ in range(ab.get("hits", 1)):
                if not tg["alive"]: break
                strike(camp, a, tg, ab, dice, events)
        if ab.get("heal_allies"):
            for al in side(camp, a["team"]):
                r = dice.roll(ab["heal_allies"], "consecrate heal")
                events.append(dice_event(r, a["uid"], "heal"))
                heal(camp, al, r["total"], events)
    elif kind == "heal":
        for tg in tgts: do_heal(camp, a, tg, ab, dice, events)
    elif kind in ("buff", "debuff"):
        for tg in tgts:
            s = ab["status"]
            if kind == "debuff" and tg["team"] != a["team"]:
                if not dice.chance(s.get("chance", 1), "debuff"):
                    events.append({"type": "resist", "target": tg["uid"], "text": f"{tg['name']} resists {ab['name']}."})
                    continue
            add_status(tg, s["id"], s.get("turns", 2), s.get("value", 0), a["uid"], events)
        if aid == "taunt":
            pass
    elif kind == "summon":
        summon(camp, a, ab.get("summon") if ab.get("summon") != "minion" else a.get("minion", "skeleton"), dice, events)
    elif kind == "revive":
        for tg in tgts:
            tg["alive"] = True
            tg["hp"] = max(1, int(stats(tg, camp)["hp"] * ab.get("revive_pct", 0.3)))
            events.append({"type": "revive", "target": tg["uid"], "hp": tg["hp"], "text": f"{tg['name']} gets back up!"})
    elif kind == "special" and ab.get("special") == "steal":
        tg = tgts[0]
        r = dice.d20("steal", stats(a, camp)["spd"] // 2)
        events.append(dice_event(r, a["uid"], "steal"))
        if r["total"] >= 12 and tg.get("loot"):
            base = dice.pick([l[0] for l in tg["loot"] if l[0] in C.items and l[0] != "gold"] or ["potion_small"], "steal")
            from .inventory import make_item
            it = add(camp, make_item(camp, base, dice=dice))
            events.append({"type": "loot", "items": [{"name": it["name"], "rarity": it["rarity"], "model": it.get("model")}], "text": f"Stole {it['name']}!"})
        else:
            events.append({"type": "log", "uid": a["uid"], "text": f"{a['name']} fumbles the steal."})
    return events


def dice_event(r, who, reason, vs=None):
    e = {"type": "dice", "die": r["die"], "rolls": r["rolls"], "mod": r["mod"], "total": r["total"], "who": who, "reason": reason}
    if vs is not None: e["vs"] = vs
    if "natural" in r: e["natural"] = r["natural"]
    return e


def strike(camp, a, tg, ab, dice, events):
    """one attack roll + damage."""
    C = content()
    R = C.rules
    sa, st = stats(a, camp), stats(tg, camp)
    ac = R["hit"]["base_ac"] + st["eva"] + (R["defend"]["evasion_bonus"] if has_status(tg, "defending") else 0)
    acc = sa["acc"] + ab.get("acc_bonus", 0)
    r = dice.d20(f"{a['name']} attacks {tg['name']}", acc)
    nat = r["natural"]
    events.append(dice_event(r, a["uid"], "attack", vs=ac))
    hit = nat == R["hit"]["nat_crit"] or (nat != R["hit"]["nat_fail"] and r["total"] >= ac)
    if not hit:
        why = "a natural 1" if nat == 1 else f"{r['total']} vs defense {ac}"
        events.append({"type": "miss", "uid": a["uid"], "target": tg["uid"], "text": f"{a['name']} misses {tg['name']} ({why})."})
        camp.setdefault("stats", {}).setdefault("misses", 0)
        if a["team"] == "party": camp["stats"]["misses"] += 1
        return
    crit = nat == R["hit"]["nat_crit"] or dice.chance((sa["crit"] + ab.get("crit_bonus", 0)) / 100, "crit")
    parts, w_el, _ = dice_expr(ab.get("dice", "1d4"), a, camp)
    total, roll_txt = 0, []
    for p in parts:
        dr = dice.roll(p, "damage")
        events.append(dice_event(dr, a["uid"], "damage"))
        total += dr["total"]; roll_txt.append(f"{p}={dr['total']}")
    stat = sa.get(ab.get("stat", "patk"), 0)
    raw = total + round(stat * ab.get("power", 1.0))
    defense = st["mdef"] if ab["kind"] == "spell" else st["pdef"]
    dmg = max(R["damage"]["min_damage"], int(raw - defense * R["damage"]["defense_factor"]))
    notes = []
    if crit:
        mult = R["damage"]["crit_multiplier"] + passive(a, camp, "crit_damage")
        dmg = int(dmg * mult); notes.append("CRITICAL")
    element = ab.get("element") or (w_el if "weapon" in str(ab.get("dice", "")) else None)
    m, note = elem_mult(tg, element)
    if element and m != 1.0:
        dmg = int(dmg * m); notes.append({"weak": "weak spot!", "resist": "resisted", "immune": "immune"}[note])
    if element: dmg = int(dmg * (1 + passive(a, camp, f"element_{element}")))
    dmg = int(dmg * (1 + passive(a, camp, "damage_bonus")))
    cb = camp["combat"]
    if a["team"] == "party":       # Partners in Crime: player + Vermeil hit the same enemy
        hitters = cb["hit_this_round"].setdefault(tg["uid"], [])
        partner = "vermeil" if a.get("kind") == "player" else ("player" if a["uid"] == "vermeil" else None)
        if partner and any((x == "vermeil") if partner == "vermeil" else get(camp, x).get("kind") == "player" for x in hitters):
            syn = max((passive(p, camp, "synergy") for p in camp["party"] if p.get("kind") == "player"), default=0)
            if syn: dmg += int(syn); notes.append("teamwork!")
        hitters.append(a["uid"])
    expl = f"{a['name']} rolls {nat}{r['mod']:+d} = {r['total']} vs defense {ac} -> {'CRIT' if crit else 'hit'}. " \
           f"{' + '.join(roll_txt)} + {round(stat * ab.get('power', 1.0))} power - {int(defense * R['damage']['defense_factor'])} armour"
    dealt = deal(camp, tg, dmg, events, src=a["uid"], element=element, crit=crit, note=", ".join(notes), explain=expl)
    if a["team"] == "party": camp["stats"]["damage_dealt"] = camp["stats"].get("damage_dealt", 0) + dealt
    if crit and a["team"] == "party": camp["stats"]["crits"] = camp["stats"].get("crits", 0) + 1
    # on-hit effects
    s = ab.get("status")
    if s and tg["alive"] and ab["kind"] in ("attack", "spell") and dice.chance(s.get("chance", 1), "status"):
        add_status(tg, s["id"], s.get("turns", 2), s.get("value", 0), a["uid"], events)
    pp = passive(a, camp, "poison_on_hit")
    if pp and tg["alive"] and dice.chance(pp, "stink"):
        add_status(tg, "poison", 3, 3, a["uid"], events)
    ls = passive(a, camp, "lifesteal")
    if ls and dealt: heal(camp, a, max(1, int(dealt * ls)), events, note="Blood Ring")
    th = passive(tg, camp, "thorns")
    if th and not ab.get("ranged") and a["alive"]: deal(camp, a, int(th), events, src=tg["uid"], note="Thorns")
    if element == "fire" and has_status(tg, "freeze"):
        tg["statuses"] = [x for x in tg["statuses"] if x["id"] != "freeze"]
        events.append({"type": "status", "target": tg["uid"], "id": "freeze", "on": False})


def deal(camp, tg, dmg, events, src=None, element=None, crit=False, note="", explain=""):
    """reduce HP (after defend / guard / mark / barrier). Returns damage actually dealt."""
    C = content()
    if has_status(tg, "defending"): dmg = int(dmg * C.rules["defend"]["damage_taken"])
    if has_status(tg, "guarded"): dmg = int(dmg * (1 - min(0.8, status_val(tg, "guarded"))))
    if has_status(tg, "marked"): dmg = int(dmg * (1 + status_val(tg, "marked")))
    absorbed = 0
    for s in tg["statuses"]:
        if s["id"] == "barrier" and dmg > 0:
            take = min(s["value"], dmg)
            s["value"] -= take; dmg -= take; absorbed += take
    tg["statuses"] = [s for s in tg["statuses"] if not (s["id"] == "barrier" and s["value"] <= 0)]
    dmg = max(0, int(dmg))
    tg["hp"] = max(0, tg["hp"] - dmg)
    mx = stats(tg, camp)["hp"]
    events.append({"type": "hit", "source": src, "target": tg["uid"], "amount": dmg, "absorbed": absorbed, "crit": crit,
                   "element": element, "note": note, "hp": tg["hp"], "max_hp": mx, "explain": explain})
    if tg["team"] == "party": camp["stats"]["damage_taken"] = camp["stats"].get("damage_taken", 0) + dmg
    if tg["hp"] <= 0 and tg["alive"]:
        av = passive(tg, camp, "auto_revive")
        if av and not tg.get("revived_once"):
            tg["revived_once"] = True
            tg["hp"] = max(1, int(mx * av))
            events.append({"type": "revive", "target": tg["uid"], "hp": tg["hp"], "text": f"King's Favour! {tg['name']} refuses to fall!"})
        else:
            die(camp, tg, src, events)
    return dmg


def die(camp, tg, src, events):
    tg["alive"] = False
    tg["statuses"] = []
    ev = {"type": "death", "uid": tg["uid"], "name": tg["name"], "by": src}
    if tg["team"] == "enemy":
        ev["xp"] = tg.get("xp_value", 10)                 # the game shows "+N XP" over each enemy as it falls
    events.append(ev)
    cb = camp["combat"]
    if tg["team"] == "enemy" and tg["uid"] not in cb["defeated"]:
        cb["defeated"].append(tg["uid"])


def heal(camp, tg, amount, events, note=""):
    if not tg["alive"]: return 0
    mx = stats(tg, camp)["hp"]
    before = tg["hp"]
    tg["hp"] = min(mx, tg["hp"] + max(0, int(amount)))
    events.append({"type": "heal", "target": tg["uid"], "amount": tg["hp"] - before, "hp": tg["hp"], "max_hp": mx, "note": note})
    return tg["hp"] - before


def do_heal(camp, a, tg, ab, dice, events):
    if not tg["alive"]: return
    r = dice.roll(ab["dice"], "heal")
    events.append(dice_event(r, a["uid"], "heal"))
    amt = (r["total"] + round(stats(a, camp).get(ab.get("stat", "matk"), 0) * ab.get("power", 1.0))) * (1 + passive(a, camp, "heal_bonus"))
    heal(camp, tg, amt, events)
    if ab.get("cleanse"):
        bad = [s for s in tg["statuses"] if content().status.get(s["id"], {}).get("bad")]
        for s in bad:
            tg["statuses"].remove(s)
            events.append({"type": "status", "target": tg["uid"], "id": s["id"], "on": False})


def summon(camp, owner, sid, dice, events):
    cb = camp["combat"]
    if sum(1 for s in cb["summons"].values() if s["alive"] and s.get("owner") == owner["uid"]) >= 2:
        events.append({"type": "log", "text": f"{owner['name']} can't hold more summons."})
        return
    s = make_summon(camp, sid, owner, max(1, owner["level"] - (0 if owner["team"] == "party" else 1)))
    if owner["team"] == "enemy": s["team"] = "enemy"
    cb["summons"][s["uid"]] = s
    cb["order_all"].append(s["uid"])
    events.append({"type": "summon", "owner": owner["uid"], "actor": public(s, camp), "text": f"{s['name']} appears!"})


def try_flee(camp, a, dice, bonus=0):
    cb = camp["combat"]
    if not cb["flee_allowed"]:
        raise ActionError("You can't run from this fight!")
    dc = content().rules["flee"]["base_dc"] + max((stats(e, camp)["spd"] for e in side(camp, "enemy")), default=0)
    r = dice.d20("flee", stats(a, camp)["spd"] + bonus)
    events = [{"type": "action", "uid": a["uid"], "name": "Flee", "anim": "run", "targets": []}, dice_event(r, a["uid"], "flee", vs=dc)]
    if r["total"] >= dc:
        events.append({"type": "log", "text": f"Escaped! ({r['total']} vs {dc})"})
        finish(camp, "fled", dice, events)
    else:
        events.append({"type": "log", "text": f"Couldn't get away ({r['total']} vs {dc})."})
    return events


def use_item(camp, a, item_uid, target_uid, dice):
    it = item_of(camp, item_uid)
    if not it or it["slot"] != "consumable": raise ActionError("You don't have that item.")
    u = it.get("use") or {}
    if u.get("card"): raise ActionError("Read that after the battle.")
    events = [{"type": "action", "uid": a["uid"], "name": it["name"], "anim": "item", "vfx": "potion", "targets": [], "item_model": it.get("model")}]
    if u.get("damage"):
        foes = side(camp, "enemy" if a["team"] == "party" else "party")
        for f in foes:
            r = dice.roll(u["damage"], it["name"])
            events.append(dice_event(r, a["uid"], "damage"))
            m, note = elem_mult(f, u.get("element"))
            deal(camp, f, int(r["total"] * m), events, src=a["uid"], element=u.get("element"), note=note)
        events[0]["targets"] = [f["uid"] for f in foes]; events[0]["vfx"] = u.get("element", "fire")
    elif u.get("flee_bonus"):
        remove(camp, item_uid)
        return events + try_flee(camp, a, dice, u["flee_bonus"])
    else:
        tg = get(camp, target_uid) if target_uid else a
        if tg["team"] != a["team"]: raise ActionError("Use that on an ally.")
        if u.get("revive_pct"):
            if tg["alive"]: raise ActionError(f"{tg['name']} isn't down.")
            tg["alive"] = True
            tg["hp"] = max(1, int(stats(tg, camp)["hp"] * u["revive_pct"]))
            events.append({"type": "revive", "target": tg["uid"], "hp": tg["hp"], "text": f"{tg['name']} is back!"})
        else:
            if not tg["alive"]: raise ActionError(f"{tg['name']} is down - use a Phoenix Feather.")
            apply_consumable(camp, tg, u, dice, events)
        events[0]["targets"] = [tg["uid"]]
    remove(camp, item_uid)
    camp["stats"]["items_used"] = camp["stats"].get("items_used", 0) + 1
    return events


def apply_consumable(camp, tg, u, dice, events):
    st = stats(tg, camp)
    if u.get("heal"):
        r = dice.roll(u["heal"], "potion"); events.append(dice_event(r, tg["uid"], "heal"))
        heal(camp, tg, r["total"], events)
    if u.get("heal_pct"): heal(camp, tg, int(st["hp"] * u["heal_pct"]), events)
    if u.get("mana"):
        r = dice.roll(u["mana"], "ether"); events.append(dice_event(r, tg["uid"], "mana"))
        tg["mana"] = min(st["mana"], tg.get("mana", 0) + r["total"])
        events.append({"type": "mana", "target": tg["uid"], "mana": tg["mana"], "max_mana": st["mana"]})
    if u.get("mana_pct"):
        tg["mana"] = st["mana"]
        events.append({"type": "mana", "target": tg["uid"], "mana": tg["mana"], "max_mana": st["mana"]})
    if u.get("perm"):                                  # tonics: permanent stat boosts
        perm = tg.setdefault("perm", {})
        for k, v in u["perm"].items():
            perm[k] = perm.get(k, 0) + v
        if u["perm"].get("hp"): tg["hp"] = tg["hp"] + u["perm"]["hp"]
        if u["perm"].get("mana"): tg["mana"] = tg.get("mana", 0) + u["perm"]["mana"]
        nice = ", ".join(f"+{v} {k.upper()}" for k, v in u["perm"].items())
        events.append({"type": "log", "text": f"{tg['name']} feels stronger for good: {nice}."})
        events.append({"type": "heal", "target": tg["uid"], "amount": 0, "hp": tg["hp"], "max_hp": stats(tg, camp)["hp"]})
    if u.get("cleanse"):
        for s in [s for s in tg["statuses"] if content().status.get(s["id"], {}).get("bad")]:
            tg["statuses"].remove(s)
            events.append({"type": "status", "target": tg["uid"], "id": s["id"], "on": False})


def maneuver(camp, a, action, dice):
    """a creative move the DM described: a skill check, then a validated, limited effect."""
    C = content()
    R = C.rules["skill_check"]
    stat = action.get("stat", "dex")
    dc = max(R["min_dc"], min(R["max_dc"], int(action.get("dc", 13))))
    attrs = C.classes.get(a.get("cls"), {}).get("attrs", {})
    mod = (attrs.get(stat, 10) - 10) // 2 + C.species.get(a.get("species"), {}).get("check_bonus", 0) + int(power(a["level"])) // 3
    r = dice.d20(f"{action.get('name', 'maneuver')}", mod)
    events = [{"type": "action", "uid": a["uid"], "name": action.get("name", "Maneuver"), "anim": action.get("anim", "attack"),
               "vfx": action.get("vfx"), "targets": [action.get("target")] if action.get("target") else []},
              dice_event(r, a["uid"], f"{stat.upper()} check", vs=dc)]
    ok = r["natural"] == 20 or (r["natural"] != 1 and r["total"] >= dc)
    events.append({"type": "check", "uid": a["uid"], "success": ok, "stat": stat, "dc": dc, "total": r["total"],
                   "text": action.get("on_success" if ok else "on_fail") or ("It works!" if ok else "It doesn't work.")})
    if not ok: return events
    eff = action.get("effect", "damage")
    tgt = None
    if action.get("target"):
        try: tgt = get(camp, action["target"])
        except ActionError: tgt = None
    if eff == "damage":
        tgt = tgt if tgt and tgt["team"] != a["team"] and tgt["alive"] else first_enemy(camp, a)
        if tgt:
            dr = dice.roll("2d6", "maneuver damage"); events.append(dice_event(dr, a["uid"], "damage"))
            deal(camp, tgt, dr["total"] + stats(a, camp)["patk"] // 2, events, src=a["uid"], note="clever move")
    elif eff in ("stun", "weaken", "dazed", "slow", "marked") :
        tgt = tgt if tgt and tgt["team"] != a["team"] and tgt["alive"] else first_enemy(camp, a)
        if tgt: add_status(tgt, eff, 1 if eff == "stun" else 2, {"weaken": 3, "dazed": 4, "slow": 3, "marked": 0.25}.get(eff, 0), a["uid"], events)
    elif eff in ("evasive", "fortify", "blessed", "might"):
        add_status(a, eff, 2, 4, a["uid"], events)
    elif eff == "heal":
        heal(camp, a, dice.roll("2d6", "maneuver heal")["total"], events)
    return events


# ------------------------------------------------------------------ AI
def choose_ai(camp, a, dice):
    """pick an action for an enemy, summon or AI-controlled companion."""
    C = content()
    if a["team"] == "party":
        return companion_ai(camp, a, dice)
    foes = side(camp, "party")
    me = stats(a, camp)
    hp_pct = a["hp"] / max(1, me["hp"])
    if a.get("ai") == "coward" and hp_pct < 0.25 and a.get("kind") != "boss":
        return {"type": "flee"}
    usable_ab = [x for x in a["abilities"] if usable(camp, a, x)[0]]
    heals = [x for x in usable_ab if C.abilities[x]["kind"] == "heal"]
    if heals and hp_pct < (0.5 if a.get("ai") in ("support", "boss") else 0.3):
        return {"type": "ability", "ability": heals[0], "target": a["uid"]}
    if a.get("kind") == "boss" and "e_summon_minions" in usable_ab and len(side(camp, "enemy")) < 3:
        return {"type": "ability", "ability": "e_summon_minions"}
    buffs = [x for x in usable_ab if C.abilities[x]["kind"] in ("buff", "debuff")]
    if buffs and dice.chance(0.3, "ai_buff"):
        return {"type": "ability", "ability": buffs[0]}
    offense = [x for x in usable_ab if C.abilities[x]["kind"] in ("attack", "spell")]
    if not offense: return {"type": "defend"}
    aoe = [x for x in offense if C.abilities[x]["target"] == "all_enemies"]
    if aoe and len(foes) >= 2 and (a.get("ai") in ("caster", "boss") or dice.chance(0.5, "ai_aoe")):
        return {"type": "ability", "ability": aoe[0]}
    single = [x for x in offense if C.abilities[x]["target"] == "enemy"] or offense
    ab = dice.pick(single, "ai_ability")
    # target choice: taunter > (skirmisher: weakest) > (brute: closest = random) > (caster: lowest magic defence)
    src = taunt_src(a)
    tg = next((f for f in foes if f["uid"] == src), None)
    if not tg:
        if a.get("ai") in ("skirmisher", "boss"):
            tg = min(foes, key=lambda f: (f["hp"] / max(1, stats(f, camp)["hp"]), f["uid"]))
        elif a.get("ai") == "caster":
            tg = min(foes, key=lambda f: (stats(f, camp)["mdef"], f["uid"]))
        else:
            tg = dice.pick(sorted(foes, key=lambda f: f["uid"]), "ai_target")
    return {"type": "ability", "ability": ab, "target": tg["uid"] if tg else None}


def companion_ai(camp, a, dice):
    """Vermeil and allies: heal who needs it, exploit weaknesses, spread damage, save resources."""
    C = content()
    mode = camp["settings"].get("vermeil_control", "auto") if a["uid"] == "vermeil" else "auto"
    allies = side(camp, "party")
    foes = side(camp, "enemy")
    if not foes: return {"type": "wait"}
    usable_ab = [x for x in a["abilities"] if usable(camp, a, x)[0]]
    basic = "basic_shot" if weapon_dice(a, camp)[2] else "basic_attack"
    if mode == "advice":
        return {"type": "ability", "ability": "v_rapier" if "v_rapier" in usable_ab else basic,
                "target": min(foes, key=lambda f: f["hp"])["uid"]}
    hurt = sorted(allies, key=lambda x: x["hp"] / max(1, stats(x, camp)["hp"]))
    heals = [x for x in usable_ab if C.abilities[x]["kind"] == "heal"]
    if heals and hurt and hurt[0]["hp"] / max(1, stats(hurt[0], camp)["hp"]) < 0.45:
        h = next((x for x in heals if C.abilities[x]["target"] in ("ally", "all_allies") or hurt[0]["uid"] == a["uid"]), None)
        if h: return {"type": "ability", "ability": h, "target": hurt[0]["uid"]}
    dead = [x for x in side(camp, "party", alive=False) if not x["alive"]]
    rev = [x for x in usable_ab if C.abilities[x]["kind"] == "revive"]
    if dead and rev: return {"type": "ability", "ability": rev[0], "target": dead[0]["uid"]}
    offense = [x for x in usable_ab if C.abilities[x]["kind"] in ("attack", "spell")]
    # weakness first
    for x in offense:
        el = C.abilities[x].get("element")
        weak = [f for f in foes if el and el in f.get("weak", [])]
        if weak and C.abilities[x]["target"] == "enemy":
            return {"type": "ability", "ability": x, "target": min(weak, key=lambda f: f["hp"])["uid"]}
    aoe = [x for x in offense if C.abilities[x]["target"] == "all_enemies"
           and not any(C.abilities[x].get("element") in f.get("immune", []) for f in foes)]
    if aoe and len(foes) >= 3: return {"type": "ability", "ability": aoe[0]}
    support = [x for x in usable_ab if C.abilities[x]["kind"] in ("buff", "debuff", "summon")]
    if support and dice.chance(0.25, "comp_support"):
        x = support[0]
        tgt = min(foes, key=lambda f: -stats(f, camp)["patk"])["uid"] if C.abilities[x]["target"] == "enemy" else \
            (hurt[0]["uid"] if C.abilities[x]["target"] == "ally" else None)
        return {"type": "ability", "ability": x, "target": tgt}
    st = stats(a, camp)
    single = [x for x in offense if C.abilities[x]["target"] == "enemy" and C.abilities[x].get("cost", 0) <= a.get("mana", 0) - st["mana"] * 0.25]
    pick = single[-1] if single else basic
    # focus the enemy the player is hitting (teamwork) or the weakest one
    focus = None
    for f in foes:
        if any(get(camp, h).get("kind") == "player" for h in camp["combat"]["hit_this_round"].get(f["uid"], [])):
            focus = f
    focus = focus or min(foes, key=lambda f: (f["hp"], f["uid"]))
    if any(C.abilities[pick].get("element") in focus.get("immune", []) for _ in [0]): pick = basic
    return {"type": "ability", "ability": pick, "target": focus["uid"]}


# ------------------------------------------------------------------ the end of a battle
def check_end(camp, dice, events):
    cb = camp["combat"]
    if cb["phase"] == "ended": return True
    if not side(camp, "enemy"):
        finish(camp, "victory", dice, events); return True
    if not [a for a in side(camp, "party") if a.get("kind") != "summon"]:
        finish(camp, "defeat", dice, events); return True
    return False


def finish(camp, result, dice, events):
    C = content()
    cb = camp["combat"]
    cb["phase"] = "ended"
    cb["result"] = result
    st = camp.setdefault("stats", {})
    rewards = {"xp": 0, "items": [], "gold": 0, "each": []}      # each: [{uid, xp, gold}] per defeated enemy
    if result == "victory" and not cb.get("rewards_paid"):
        cb["rewards_paid"] = True
        player = next((p for p in camp["party"] if p.get("kind") == "player"), camp["party"][0])
        bonus = passive(player, camp, "loot_bonus")
        extra = passive(player, camp, "extra_drop")
        boss_down = False
        for uid in cb["defeated"]:
            e = cb["enemies"].get(uid) or cb["summons"].get(uid)
            if not e: continue
            key = f"{camp['id']}:{uid}"
            if award_xp(camp, key, e.get("xp_value", 10), dice, events, src_level=e.get("level")):
                rewards["xp"] += e.get("xp_value", 10)
                one = {"uid": uid, "xp": e.get("xp_value", 10), "gold": 0}
                rewards["each"].append(one)
                st["monsters_defeated"] = st.get("monsters_defeated", 0) + 1
                st.setdefault("kills_by_type", {})
                st["kills_by_type"][e["name"]] = st["kills_by_type"].get(e["name"], 0) + 1
                if e.get("kind") == "boss":
                    boss_down = True
                    st.setdefault("bosses_defeated", []).append(e["name"])
                lk = f"loot:{key}"
                if lk not in camp["awarded"]:
                    camp["awarded"].append(lk)
                    for it in roll_loot(camp, e, dice, bonus, extra):
                        stored = add(camp, it)
                        if it["base"] == "gold": rewards["gold"] += it["qty"]; one["gold"] += it["qty"]
                        else:
                            rewards["items"].append({"name": it["name"], "rarity": it["rarity"], "model": it.get("model"), "qty": it["qty"]})
                            if it["rarity"] in ("rare", "epic", "legendary") or it["slot"] in ("weapon", "armor", "offhand", "accessory"):
                                st.setdefault("major_items", []).append({"name": it["name"], "rarity": it["rarity"]})
        for p in camp["party"]:                  # fallen allies get up after a win
            if not p["alive"]:
                p["alive"] = True; p["hp"] = 1
        if boss_down:
            offer_cards(camp, "boss", dice, events, reason="Boss defeated")
        st["battles_won"] = st.get("battles_won", 0) + 1
    elif result == "defeat":
        st["defeats"] = st.get("defeats", 0) + 1
    elif result == "fled":
        st["fled"] = st.get("fled", 0) + 1
    for p in camp["party"]:
        p["statuses"] = [s for s in p.get("statuses", []) if s["id"] in ("poison",)]
        p["cooldowns"] = {}
    events.append({"type": "combat_end", "result": result, "rewards": rewards,
                   "party": [public(p, camp) for p in camp["party"]]})
