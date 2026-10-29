"""api.py - the bridge between the 3D game page (ui/game/) and the Python game engine.

app.py exposes these as window.pywebview.api.game_* . Every call returns a JSON-safe dict;
mistakes come back as {"error": "..."} instead of crashing. AI calls run in pywebview's worker threads,
so a slow Dungeon Master never freezes the game window, and requests can be cancelled.
"""
import json
import os
import traceback

from . import ai, voices
from . import campaign as _campaign
from .campaign import Game, GameError, list_saves
from .content import content, reload

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read_json(path):
    if not os.path.exists(path): return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _safe(fn):
    def wrap(self, *a, **k):
        try:
            return fn(self, *a, **k)
        except GameError as e:
            return {"error": str(e)}
        except Exception as e:
            traceback.print_exc()
            return {"error": f"Something went wrong ({type(e).__name__}). The game is still safe - try again."}
    wrap.__name__ = fn.__name__
    return wrap


class GameAPI:
    def __init__(self, vermeil_voice=None, vermeil_voice_online=None, companion=None):
        self.game = None
        self.vermeil_voice = vermeil_voice
        self.companion = companion       # () -> the character chosen in the assistant app (it becomes the companion)
        from . import voices as _voices
        _voices.VERMEIL_ONLINE = vermeil_voice_online

    def _sync_clone(self):
        """the companion's voice clone follows the character chosen in the assistant"""
        try:
            prof = self.companion() if callable(self.companion) else None
            voices.COMPANION_CLONE = (prof or {}).get("rvc") or None
        except Exception:
            voices.COMPANION_CLONE = None

    def _g(self):
        if not self.game: raise GameError("No adventure is running - start or load one.")
        return self.game

    # ---------------- menus
    @_safe
    def info(self):
        C = content()
        faces = os.path.join(PROJECT, "ui", "game", "assets", "made", "dice_faces.json")
        abil = {k: {f: a.get(f) for f in ("name", "desc", "kind", "target", "cost", "cooldown", "element")} for k, a in C.abilities.items()}
        cards = {k: {f: c.get(f) for f in ("name", "desc", "rarity", "category", "art", "max")} for k, c in C.cards.items()}
        return {"species": C.playable_species(), "classes": C.class_list(), "genres": {k: g["name"] for k, g in C.world["genres"].items()},
                "abilities": abil, "cards": cards, "class_abilities": {k: c["abilities"] for k, c in C.classes.items()},
                "saves": list_saves(), "running": bool(self.game and self.game.camp["status"] == "active"),
                "dice_faces": _read_json(faces), "catalog_models": len(C.catalog),
                "voices": voices.registry(), "ai": ai.stats}

    @_safe
    def new(self, opts):
        opts = opts or {}
        self.game = Game.new(name=opts.get("name") or "Hero", species=opts.get("species") or "human", cls_id=opts.get("cls") or "warrior",
                             genre=opts.get("genre") or None, premise=(opts.get("premise") or "").strip()[:300] or None, seed=opts.get("seed"),
                             settings={k: v for k, v in (opts.get("settings") or {}).items()}, vermeil_voice=self.vermeil_voice,
                             companion_profile=self.companion() if callable(self.companion) else None)
        self.game.save("auto")
        g = self.game
        return {"intro": g.camp["intro"], "state": g.state()}

    @_safe
    def load(self, slot):
        self.game = Game.load(str(slot))
        return {"state": self.game.state()}

    @_safe
    def save(self, slot):
        return {"meta": self._g().save(str(slot)), "saves": list_saves()}

    @_safe
    def saves(self):
        return {"saves": list_saves()}

    @_safe
    def delete_save(self, slot):
        p = os.path.join(_campaign.SAVE_DIR, f"slot_{slot}.json")
        if os.path.exists(p): os.remove(p)
        return {"saves": list_saves()}

    @_safe
    def state(self):
        return {"state": self._g().state()}

    # ---------------- playing
    @_safe
    def action(self, text, action_id=None, req_id=None):
        return self._g().action(text, action_id, req_id)

    @_safe
    def cancel(self, req_id):
        ai.cancel(req_id)
        return {"ok": True}

    @_safe
    def combat_act(self, uid, act):
        g = self._g()
        ev = g.combat_act(uid, act or {})
        return {"events": ev, "state": g.state()}

    @_safe
    def engage(self, enc_id):
        g = self._g()
        return {"events": g.engage(enc_id), "state": g.state()}

    @_safe
    def travel(self, dest):
        g = self._g()
        return {"events": g.travel(dest), "state": g.state()}

    @_safe
    def talk(self, npc_id, text):
        g = self._g()
        return {"events": g.talk(npc_id, text or "Hello."), "state": g.state(full=False)}

    @_safe
    def open_treasure(self, tid):
        g = self._g()
        return {"events": g.open_treasure(tid), "state": g.state()}

    @_safe
    def rest(self):
        g = self._g()
        return {"events": g.rest(), "state": g.state()}

    @_safe
    def search(self):
        g = self._g()
        return {"events": g.search(), "state": g.state()}

    @_safe
    def use_item(self, item_uid, target_uid):
        g = self._g()
        return {"events": g.use_item(item_uid, target_uid), "state": g.state()}

    @_safe
    def equip(self, actor_uid, item_uid):
        g = self._g()
        g.equip(actor_uid, item_uid)
        return {"state": g.state()}

    @_safe
    def unequip(self, actor_uid, slot):
        g = self._g()
        g.unequip(actor_uid, slot)
        return {"state": g.state()}

    @_safe
    def discard(self, item_uid):
        g = self._g()
        g.discard(item_uid)
        return {"state": g.state()}

    @_safe
    def compare(self, actor_uid, item_uid):
        return {"diff": self._g().compare(actor_uid, item_uid)}

    @_safe
    def choose_card(self, offer_id, card_id):
        g = self._g()
        r = g.choose_card(offer_id, card_id)
        return {"result": r, "state": g.state()}

    @_safe
    def shop(self, npc_id):
        return {"events": self._g().open_shop(npc_id)}

    @_safe
    def buy(self, npc_id, item_uid):
        g = self._g()
        r = g.buy(npc_id, item_uid)
        return {"result": r, "goods": g.camp["shops"].get(npc_id, []), "state": g.state()}

    @_safe
    def reforge(self, npc_id, item_uid):
        g = self._g()
        r = g.reforge_item(npc_id, item_uid)
        return {"result": r, "services": g.services(npc_id), "state": g.state()}

    @_safe
    def inn(self, npc_id):
        g = self._g()
        return {"events": g.inn_rest(npc_id), "state": g.state()}

    @_safe
    def preload_list(self):
        """every model the game can show (the loading screen loads them all before the menu)."""
        return {"models": content().used_models()}

    @_safe
    def sell(self, item_uid):
        g = self._g()
        return {"result": g.sell(item_uid), "state": g.state()}

    @_safe
    def recruit(self, npc_id, accept, replace_uid=None):
        g = self._g()
        return {"events": g.recruit_answer(npc_id, bool(accept), replace_uid), "state": g.state()}

    @_safe
    def monster_recruit(self, accept):
        g = self._g()
        return {"events": g.monster_recruit(bool(accept)), "state": g.state()}

    @_safe
    def dismiss(self, uid):
        g = self._g()
        return {"events": g.dismiss(uid), "state": g.state()}

    @_safe
    def settings(self, changes):
        return {"settings": self._g().set_settings(changes or {})}

    @_safe
    def test(self, cmd, arg=None):
        """Settings -> Experimental test mode: teleport, unlock, skip quest steps, edit the party, level, gold, heal, win."""
        g = self._g()
        ev = g.test_tool(cmd, arg)
        return {"events": ev, "state": g.state()}

    @_safe
    def results(self):
        return {"results": self._g().results()}

    @_safe
    def export(self, fmt="json"):
        g = self._g()
        txt = g.export_report("json" if fmt == "json" else "text")
        name = f"{(g.camp['quest'].get('title') or 'adventure').replace(' ', '_')}_report.{'json' if fmt == 'json' else 'md'}"
        out = os.path.join(PROJECT, "data", "game", name)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(txt)
        return {"path": out, "text": txt, "name": name}

    @_safe
    def speak(self, speaker, text):
        g = self._g()
        if not g.camp["settings"].get("voice", True): return {"error": "voice is off"}
        if speaker == "vermeil":
            self._sync_clone()
        return voices.speak(g.camp, speaker, text)

    @_safe
    def vermeil_say(self, situation, detail=""):
        from . import companion
        g = self._g()
        with g.lock:
            r = companion.react(g.camp, situation, detail)
            if r: g.say("vermeil", r["line"], companion.name(g.camp))
        return {"line": r}

    @_safe
    def reload_content(self):
        reload()
        return {"ok": True}
