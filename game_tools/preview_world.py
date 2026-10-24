"""Print the road of a few generated worlds (steps, forks, towns, levels, quest steps):  python game_tools/preview_world.py [seeds...]"""
import os, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [ROOT] + [os.path.join(ROOT, d) for d in ("brain", "skills", "senses")]
from game import campaign, ai  # noqa: E402

ai.disable(True)
campaign.SAVE_DIR = tempfile.mkdtemp()
for seed in [int(s) for s in sys.argv[1:]] or (1, 2, 3, 77):
    g = campaign.Game.new(name="T", species="human", cls_id="warrior", genre="fantasy", seed=seed, use_ai=False)
    L = g.camp["locations"]
    cols = {}
    for l in L.values():
        cols.setdefault(l["col"], []).append(l)
    print(seed, " -> ".join("/".join(f"{x['name'][:12]}({x['kind'][0]} L{x['level']})" for x in cols[c]) for c in sorted(cols)))
    print("   quest steps at", [L[s["location"]]["col"] for s in g.camp["quest"]["stages"]], "| boss level", g.camp["quest"]["boss"]["level"])
