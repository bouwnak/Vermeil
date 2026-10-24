# Rules and formulas

Every number below lives in `game/data/rules.json` (and the other files in `game/data/`), so you can tune
the game without touching code. The server (Python) is the only place rules run; the 3D page only shows
the results. The AI Dungeon Master can suggest an action and a difficulty, but never sets numbers.

## Dice
- All rolls come from a seeded generator (campaign seed + roll counter), so the same save always replays the
  same way and the 3D dice show exactly the official result.
- Skill checks: d20 + stat bonus vs a DC from 5 to 25 (the DM's DC is clamped into this range).

## Attacks
- Defense to beat = 10 + target evasion (+4 while the target is Defending).
- Attack roll = d20 + accuracy (+ ability bonus). Natural 20 always hits, natural 1 always misses.
- Damage = ability dice (e.g. weapon dice) + stat × ability power − target defense × 0.5, minimum 1.
  Spells use magic defense, everything else physical defense.
- Critical hit = natural 20 or a crit-chance roll; damage × 2 (+ card bonuses).
- Elements: weakness × 1.5, resistance × 0.5, immunity × 0.
- Defending halves damage taken that round.
- Flee: d20 + speed vs 10 + the fastest enemy's speed. Boss fights can't be fled.

## Turns
- Initiative is rolled at the start of a fight; the order bar shows who is next.
- On your turn: an ability, Defend, an item, Flee, or a free-text action (the DM turns it into a maneuver
  the rules can resolve). Invalid actions (no mana, dead target, not your turn) are rejected with a reason.
- Vermeil acts by herself according to her autonomy setting: *advice* (she suggests, you choose),
  *auto*, *tactical* or *direct* (you choose her move).
- Fallen allies get back up with 1 HP after a victory. If the whole party falls, you wake at the last safe
  place and lose 15% of your gold.

## Experience and levels
- XP to next level = 60 × 1.35^(level − 1). Max level 20.
- Enemy XP grows with its level; each reward has a unique key so it can never be paid twice.
- Every level up offers 3 upgrade cards (pick 1). Milestones at levels 3, 5, 8, 10, 15, 20 give better
  cards and unlock a specialization (5) and an ultimate (10). Vermeil gets cards at milestones.

## World
- A seed builds 6–7 columns of places (hub towns, wilderness, dungeons, boss lair). Place level ≈ 1 + column × 1.05.
- Encounters use a difficulty budget that grows with level, so groups are fair for your level.
- Every 3D layout is checked: all exits, the spawn, NPCs and chests must be reachable on foot. If not, the
  builder removes blockers; if that fails it uses a simple safe layout.
- Roaming monsters reappear in cleared wilderness so you can grind if the next area is too hard.
- Recruiting: 18% base chance, +10% after every 4 failed asks (max 60%). Party size up to 4.
- Bosses have 2× HP and phase changes.
