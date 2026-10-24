"""Try the 3D Build Lab designer from the command line:  python game_tools/try_builder.py "a robot giraffe" "smart glasses" """
import json, os, sys, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [ROOT] + [os.path.join(ROOT, d) for d in ("brain", "skills", "senses")]
import folders  # noqa: F401,E402
import pinakamain  # noqa: F401,E402  (loads the env file - the AI keys - like the app does)
import llm  # noqa: E402
print('AI now:', llm.which())
import builder  # noqa: E402

for p in sys.argv[1:] or ["create me a robot giraffe"]:
    t = time.time()
    s = builder.design(p)
    geo = s.get("geometry")
    print(f"== {p}: {s['name']} · {s['template']} · {s['motion']} · {s.get('source')} · {time.time() - t:.0f}s")
    if geo:
        print(f"   {len(geo['parts'])} 3D parts, {sum(1 for x in geo['parts'] if x.get('joint'))} joints, {len(geo['wires'])} wires, motion {geo['motion']['type']}")
        for x in geo["parts"][:8]:
            print("   ", x["id"], x["shape"], x["size"], x["pos"], "parent", x["parent"], "joint" if x.get("joint") else "")
    for r in s["analysis"]["rows"]:
        print("   ", r)
    if len(sys.argv) > 2 and sys.argv[-1] == "--json":
        print(json.dumps(s)[:3000])
