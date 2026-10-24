"""Blender: convert the FBX-only packs from the dnd library into .glb files the game can load.

Run inside Blender (Scripting tab, or the Blender MCP):
    exec(open(r"C:\\Users\\jpant\\OneDrive\\Desktop\\coding\\2025\\2025\\game_tools\\blender_convert.py").read())
Each run converts for ~45 seconds and stops; run again until it prints "all done".
Or set g={"BACKGROUND": True} to convert everything in the background while Blender stays usable
(progress goes to data/game/convert_progress.json).
It never saves your open .blend and it never touches the original FBX files.
Jobs come from data/game/convert_jobs.json (made by build_game_assets.py jobs).
"""
import bpy, json, os, time

PROJECT = r"C:\Users\jpant\OneDrive\Desktop\coding\2025\2025"
DND = os.path.join(PROJECT, "dnd")             # the asset library inside the app folder
OUT = os.path.join(PROJECT, "ui", "game", "assets")
JOBS = os.path.join(PROJECT, "data", "game", "convert_jobs.json")
LOG = os.path.join(PROJECT, "data", "game", "convert_log.txt")
BUDGET = globals().get("BUDGET", 45)

COLLS = ("meshes", "materials", "actions", "armatures", "images", "textures", "objects", "curves", "node_groups", "cameras", "lights")


def snapshot():
    return {c: set(getattr(bpy.data, c)[:]) for c in COLLS}


def remove_new(before):
    for c in ("objects",) + tuple(x for x in COLLS if x != "objects"):
        col = getattr(bpy.data, c)
        for idb in list(col):
            if idb not in before[c]:
                try: col.remove(idb)
                except Exception: pass


def convert(job, scene):
    src = os.path.join(DND, job["src"].lstrip(".\\/"))
    dst = os.path.join(OUT, job["out"].replace("/", os.sep))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    before = snapshot()
    try:
        bpy.ops.import_scene.fbx(filepath=src, use_anim=True, automatic_bone_orientation=True, ignore_leaf_bones=True)
        new_objs = [o for o in scene.objects if o not in before["objects"]]
        for o in bpy.data.objects:          # only the new model - never the default cube etc. of other scenes
            try: o.select_set(o in new_objs)
            except Exception: pass
        arm = next((o for o in new_objs if o.type == "ARMATURE"), None)
        if arm:
            bpy.context.view_layer.objects.active = arm
            if arm.animation_data is None: arm.animation_data_create()
            acts = [a for a in bpy.data.actions if a not in before["actions"]]
            for a in acts:  # keep every clip: one NLA track each so the exporter writes them all
                a.use_fake_user = False
                tr = arm.animation_data.nla_tracks.new(); tr.name = a.name.split("|")[-1]
                tr.strips.new(a.name.split("|")[-1], 0, a)
            arm.animation_data.action = None
        for o in new_objs:                  # FBX 'transparency' imports as alpha 0 -> invisible in the game: make opaque
            for slot in getattr(o, "material_slots", []):
                m = slot.material
                if not (m and m.use_nodes): continue
                for n in m.node_tree.nodes:
                    if n.type == "BSDF_PRINCIPLED" and not n.inputs["Alpha"].is_linked: n.inputs["Alpha"].default_value = 1.0
                try: m.blend_method = "OPAQUE"
                except Exception: pass
        bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", use_selection=True, use_active_scene=True, export_apply=not arm,
                                  export_animations=bool(arm), export_animation_mode="NLA_TRACKS" if arm else "ACTIONS",
                                  export_yup=True)
        return "ok"
    except Exception as e:
        return "error: " + str(e)[:200]
    finally:
        remove_new(before)


def run():
    jobs = json.load(open(JOBS))["jobs"]
    todo = [j for j in jobs if not os.path.exists(os.path.join(OUT, j["out"].replace("/", os.sep)))]
    done_log = set()
    if os.path.exists(LOG):
        done_log = {l.split("\t")[0] for l in open(LOG, encoding="utf-8") if "\terror" in l}
    todo = [j for j in todo if j["out"] not in done_log]   # don't retry ones that failed
    old = bpy.context.window.scene
    scene = bpy.data.scenes.get("game_convert") or bpy.data.scenes.new("game_convert")
    bpy.context.window.scene = scene
    t0, n = time.time(), 0
    try:
        with open(LOG, "a", encoding="utf-8") as log:
            for j in todo:
                if time.time() - t0 > BUDGET: break
                r = convert(j, scene)
                log.write(f"{j['out']}\t{r}\n"); log.flush()
                n += 1
    finally:
        bpy.context.window.scene = old
    left = len(todo) - n
    return {"converted_now": n, "left": left, "status": "all done" if left == 0 else "run again"}


def run_background():
    """convert one model per timer tick so Blender (and its MCP connection) stays responsive."""
    jobs = json.load(open(JOBS))["jobs"]
    failed = set()
    if os.path.exists(LOG):
        failed = {l.split("\t")[0] for l in open(LOG, encoding="utf-8") if "\terror" in l}
    todo = [j for j in jobs if not os.path.exists(os.path.join(OUT, j["out"].replace("/", os.sep))) and j["out"] not in failed]
    state = {"total": len(todo), "done": 0, "errors": 0, "status": "running", "started": time.time()}
    prog = os.path.join(PROJECT, "data", "game", "convert_progress.json")
    scene = bpy.data.scenes.get("game_convert") or bpy.data.scenes.new("game_convert")

    def tick():
        if not todo:
            state["status"] = "all done"; json.dump(state, open(prog, "w")); return None
        j = todo.pop(0)
        old = bpy.context.window.scene
        bpy.context.window.scene = scene
        try:
            r = convert(j, scene)
        finally:
            bpy.context.window.scene = old
        with open(LOG, "a", encoding="utf-8") as log:
            log.write(f"{j['out']}\t{r}\n")
        state["done"] += 1
        if r != "ok": state["errors"] += 1
        state["last"] = j["out"]
        json.dump(state, open(prog, "w"))
        return 0.05

    bpy.app.timers.register(tick, first_interval=0.2)
    return {"queued": len(todo), "progress_file": prog}


result = run_background() if globals().get("BACKGROUND") else run()
