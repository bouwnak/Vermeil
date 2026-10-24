"""dice.py - the one and only source of random numbers for the game rules.

Every roll comes from the campaign seed + a counter, so a saved campaign rolls the same way after loading,
and the 3D dice on screen always show exactly the number the rules used (the client gets the result first
and animates the die to land on it).
"""
import hashlib
import random
import re

DICE_RX = re.compile(r"^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$")
VALID_DIE = {4, 6, 8, 10, 12, 20, 100}


def stream(seed, *keys):
    """an independent, reproducible random generator for (seed, keys...)."""
    h = hashlib.sha256(("|".join([str(seed)] + [str(k) for k in keys])).encode()).hexdigest()
    return random.Random(int(h[:16], 16))


def parse(expr):
    """'2d6+3' -> (2, 6, 3). Raises ValueError for anything else."""
    m = DICE_RX.match(str(expr))
    if not m:
        raise ValueError(f"bad dice: {expr}")
    n, sides, mod = int(m.group(1) or 1), int(m.group(2)), int((m.group(3) or "0").replace(" ", ""))
    if sides not in VALID_DIE or not 1 <= n <= 20:
        raise ValueError(f"bad dice: {expr}")
    return n, sides, mod


class Dice:
    """Seeded dice. state = {'seed':..., 'n': how many rolls so far}. log keeps the last rolls for the UI."""

    def __init__(self, seed, n=0):
        self.seed, self.n = seed, n
        self.log = []

    def _next(self, sides):
        r = stream(self.seed, "dice", self.n).randint(1, sides)
        self.n += 1
        return r

    def roll(self, expr, reason="", show=True):
        """roll '2d6+3' -> {'expr', 'rolls':[..], 'mod', 'total', 'die', 'reason'}"""
        n, sides, mod = parse(expr)
        rolls = [self._next(sides) for _ in range(n)]
        r = {"expr": expr, "die": sides, "rolls": rolls, "mod": mod, "total": sum(rolls) + mod, "reason": reason, "show": show}
        self.log.append(r)
        self.log = self.log[-200:]
        return r

    def d20(self, reason="", mod=0):
        r = self.roll("1d20" + (f"{mod:+d}" if mod else ""), reason)
        r["natural"] = r["rolls"][0]
        return r

    def between(self, lo, hi, reason=""):
        """a hidden whole number from lo to hi (gold amounts, quantities) - not a real die."""
        if hi <= lo: return lo
        r = stream(self.seed, "between", self.n, reason).randint(lo, hi)
        self.n += 1
        return r

    def chance(self, p, reason=""):
        """True with probability p (uses a hidden d100)."""
        if p >= 1: return True
        if p <= 0: return False
        return self.roll("1d100", reason, show=False)["total"] <= round(p * 100)

    def pick(self, seq, reason=""):
        if not seq: return None
        i = stream(self.seed, "pick", self.n, reason).randrange(len(seq))
        self.n += 1
        return seq[i]

    def weighted(self, weights, reason=""):
        """{'a': 3, 'b': 1} -> 'a' 75% of the time."""
        items = [(k, w) for k, w in weights.items() if w > 0]
        if not items: return None
        total = sum(w for _, w in items)
        x = stream(self.seed, "w", self.n, reason).random() * total
        self.n += 1
        for k, w in items:
            x -= w
            if x <= 0: return k
        return items[-1][0]

    def state(self):
        return {"seed": self.seed, "n": self.n}
