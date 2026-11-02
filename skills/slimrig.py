"""
slimrig.py - makes a copy of a .glb with fewer bones, so UniMate can animate it.

UniMate's model takes at most 70 bones. Game rips often have hundreds (Source / SFM rigs have arm and leg
"driver" bones, lips, brows, eyes, tongue, cape...). This removes end bones one at a time - helper and face
bones first, then the ones that move the least skin - and gives each removed bone's skin weights to its parent,
so the mesh still moves with the body. Only the .glb's skin data changes; meshes, materials and textures stay.
"""
import json
import re
import struct

import numpy as np

MAX_BONES = 70
# bones that only help the look (drivers, twist, face, hair, cloth): removed before real body bones
HELPER = re.compile(r"drv|twist|helper|jiggle|corrective|_end\b|nub|lip|brow|eye|lid|tongue|teeth|cheek|nose|"
                    r"mandible|jaw|mouth|face|cape|hair|skirt|cloth|breast|tail_?tip|^bone", re.I)

# bones UniMate should never get: it's trained on bodies, so on fingers, hair, skirts, capes and helper bones it makes
# twitching fingers and stiff floating cloth. The app moves those itself (ui/rigparts.js: hand poses + springs).
# Same words as rigparts.js (short words only as whole words: "elbow" isn't a bow, "calf_l" isn't a finger).
NOT_BODY = re.compile(
    r"drv|driver|twist|helper|corrective|roll\b|^bk_|_ex$|^ex_|_ex_|nub$|end$|^end|_end_|tip$|_top$|target|pole|^ik_|_ik$|"
    r"weapon|grab|prop\b|socket|attach|offset|"
    r"brow|eye|lid|lash|lip|teeth|tooth|tongue|cheek|nose|forehead|face|mouth|chin|jaw|pupil|turban|scale_me|"
    r"^unused|_adj(_|$)|_adj[lr]$|_sub$|_mesh|^lod|lod\d|skin$|^pointlight|_def$|_mnt|^c_|ctrl|control|_(ik|fk)[lrx]?$|^deform_|scale_fix|"
    r"finger|thumb|index|(?<!spine_)middle|(^|_|hand)ring|pinky|little|digit|claw|^f_|knuckle|handsub|"
    r"hair|capillary|skirt|cloth|cape|cloak|dress|feeler|ribbon|tail|(^|_)ears?(_|[lr]?$)|coat|scarf|bust|breast|chain|string|"
    r"(^|_)tie(_|$)|sleeve|hood|jiggle|phys|dyn|spring|accessor|(^|_)belt|antenna|tentacle|frill|(^|_)bow(_|$)|braid|"
    r"ponytail|fringe|veil|wing|apron|robe|gown", re.I)


def body_name(name):
    """the cleaned name of a bone ("L_hand_084" -> "l_hand"), as rigparts.js compares them"""
    return re.sub(r"([_.]?\d+)+$", "", re.sub(r"\s+", "_", re.sub(r"^mixamorig:?", "", name or "", flags=re.I))).lower()


NAME_WORDS = ("hips", "hip", "hair", "head", "hand", "neck", "arm", "leg", "left", "right", "spine", "foot", "toe", "shoulder", "chest", "thigh",
              "tail", "wing", "finger", "root")


def name_prefix(names):
    """what most names start with, when that's a name and not a body part: "NarutoLeftArm" -> "naruto" (as rigparts.js)"""
    names = [n for n in names if n]
    if not names:
        return ""
    first = names[len(names) // 2]
    for n in range(min(len(first), 16), 2, -1):
        pre = first[:n]
        if sum(x.startswith(pre) for x in names) >= len(names) * 0.85:
            if re.match(r"left|right|spine|bone|joint|root|mixamo|bip|def|l_|r_", pre):
                return ""
            for w in NAME_WORDS:                           # "narutoHips", "narutoHair": the letter they share belongs to the body part
                for k in range(len(w) - 1, 0, -1):
                    cut = pre[:-k]
                    if pre.endswith(w[:k]) and any(x.startswith(cut + w) for x in names):
                        return cut
            return pre
    return ""


TRUNK = re.compile(r"spine|neck|waist|pelvis|hip|chest|torso")
SIMPLE_KEEP_SOFT = 2         # hair, cloth and the like: this many bones per chain stay (they swing; more adds little)


_CTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + n])
    off = 20 + n + (-n % 4)
    binary = b""
    if off + 8 <= len(data):
        bn = struct.unpack_from("<I", data, off)[0]
        binary = data[off + 8:off + 8 + bn]
    return js, bytearray(binary)


def write_glb(path, js, binary):
    j = json.dumps(js, separators=(",", ":")).encode()
    j += b" " * (-len(j) % 4)
    binary = bytes(binary) + b"\0" * (-len(binary) % 4)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 28 + len(j) + len(binary)))
        f.write(struct.pack("<I", len(j)) + b"JSON" + j)
        f.write(struct.pack("<I", len(binary)) + b"BIN\0" + binary)


def bone_count(path):
    """how many bones the .glb's skins use (0 for no skin, or a file that isn't a readable .glb)"""
    try:
        js, _ = read_glb(path)
    except (OSError, ValueError, struct.error):
        return 0
    return len({j for s in js.get("skins", []) for j in s.get("joints", [])})


def _read(js, binary, i):
    acc = js["accessors"][i]
    dt, comps = np.dtype(_CTYPE[acc["componentType"]]), _COUNT[acc["type"]]
    count = acc["count"]
    if "bufferView" not in acc:
        return np.zeros((count, comps), dt)
    bv = js["bufferViews"][acc["bufferView"]]
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = bv.get("byteStride") or dt.itemsize * comps
    rows = np.ndarray((count, comps), dt, buffer=binary, offset=start, strides=(stride, dt.itemsize)).copy()
    if acc.get("normalized") and dt.kind in "ui":
        rows = rows.astype(np.float32) / np.iinfo(dt).max
    return rows


def _add(js, binary, arr, ctype, kind):
    """append an array to the binary chunk as a new accessor; returns its index"""
    while len(binary) % 4:
        binary.append(0)
    raw = np.ascontiguousarray(arr, _CTYPE[ctype]).tobytes()
    js.setdefault("bufferViews", []).append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(raw)})
    binary.extend(raw)
    acc = {"bufferView": len(js["bufferViews"]) - 1, "componentType": ctype, "count": int(len(arr)), "type": kind}
    js.setdefault("accessors", []).append(acc)
    return len(js["accessors"]) - 1


def _path(parent, i):
    out = []
    while i is not None:
        out.append(i)
        i = parent.get(i)
    return out


def _matrix(n):
    """a node's own transform as a 4x4 (glTF stores them column first)"""
    if "matrix" in n:
        return np.array(n["matrix"], float).reshape(4, 4).T
    x, y, z, w = n.get("rotation", (0, 0, 0, 1))
    r = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    m = np.eye(4)
    m[:3, :3] = r * np.array(n.get("scale", (1, 1, 1)), float)
    m[:3, 3] = n.get("translation", (0, 0, 0))
    return m


def _bake(parent_node, child):
    """the child takes over its parent's transform too, so it stays exactly where it was when the parent goes"""
    child["matrix"] = (_matrix(parent_node) @ _matrix(child)).T.ravel().tolist()
    for key in ("translation", "rotation", "scale"):
        child.pop(key, None)


def _worlds(nodes, parent, joints):
    """each bone's place in the world at rest: {bone: 4x4}"""
    known = {}

    def world(i):
        if i not in known:
            up = parent.get(i)
            known[i] = _matrix(nodes[i]) if up is None else world(up) @ _matrix(nodes[i])
        return known[i]
    return {j: world(j) for j in joints}


def _binds(js, binary, world):
    """what each skin does to a vertex at rest: {skin number: {bone: 4x4}} (the identity on a clean rig)"""
    out = {}
    for si, s in enumerate(js.get("skins", [])):
        n = len(s["joints"])
        ibm = _read(js, binary, s["inverseBindMatrices"]).reshape(n, 4, 4).transpose(0, 2, 1) if "inverseBindMatrices" in s else np.tile(np.eye(4), (n, 1, 1))
        out[si] = {j: world[j] @ ibm[i] for i, j in enumerate(s["joints"])}
    return out


def _needs_rebind(binds, used):
    """Do the bones disagree at rest? Game rips can bind every bone differently (Piccolo's head is 100 times the size of his eyelids, and
    unused helpers even out the difference). Skin moved from one such bone to another jumps away."""
    all_ = np.array([m for skin in binds.values() for j, m in skin.items() if j in used])
    return len(all_) > 1 and float(np.abs(all_ - all_[0]).max()) > 1e-3 * (float(np.abs(all_).max()) or 1)


def _rebind(js, binary, prims, binds):
    """Bake the mesh into its shape at rest, so all bones agree (each one's rest matrix becomes the identity): it looks the same, and now any
    bone can take over from another. Bones moved by animations move the same part of the mesh the same way."""
    for p, skin, jj, ww, _ in prims:
        lookup = {j: i for i, j in enumerate(binds[skin])}
        stack = np.array(list(binds[skin].values()))
        ids = np.vectorize(lambda j: lookup.get(int(j), 0))(jj)
        w = ww / np.maximum(ww.sum(1, keepdims=True), 1e-9)
        m = (stack[ids] * w[:, :, None, None]).sum(1)              # vertices x 4 x 4
        rot = m[:, :3, :3]
        attrs = p["attributes"]
        pos = _read(js, binary, attrs["POSITION"]).astype(np.float64)
        moved = (rot @ pos[:, :, None])[:, :, 0] + m[:, :3, 3]
        attrs["POSITION"] = _add(js, binary, moved, 5126, "VEC3")
        js["accessors"][attrs["POSITION"]].update(min=moved.min(0).tolist(), max=moved.max(0).tolist())
        if "NORMAL" in attrs:
            n = (rot @ _read(js, binary, attrs["NORMAL"]).astype(np.float64)[:, :, None])[:, :, 0]
            attrs["NORMAL"] = _add(js, binary, n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9), 5126, "VEC3")
        attrs.pop("TANGENT", None)
        for target in p.get("targets", []):                        # shape keys turn with the skin
            for key in ("POSITION", "NORMAL"):
                if key in target:
                    d = (rot @ _read(js, binary, target[key]).astype(np.float64)[:, :, None])[:, :, 0]
                    target[key] = _add(js, binary, d, 5126, "VEC3")
                    if key == "POSITION":
                        js["accessors"][target[key]].update(min=d.min(0).tolist(), max=d.max(0).tolist())


def slim(src, dest, max_bones=MAX_BONES, body_only=False, drop=None, interior=False):
    """Write a copy of `src` with at most `max_bones` bones to `dest`. Returns (bones before, bones after).
    body_only: also take off every finger, hair, cloth, face and helper bone (NOT_BODY), even when it fits.
    drop: bones (node numbers) to take off as well, wherever they can go (an end bone at a time).
    interior: those can be mid-chain too: what hung from them keeps its place. Only without animations, which would break it."""
    js, binary = read_glb(src)
    skins = js.get("skins", [])
    joints = sorted({j for s in skins for j in s["joints"]})
    before = len(joints)
    names = {j: js["nodes"][j].get("name", "") for j in joints}
    plain = [body_name(names[j]) for j in joints]
    pre = name_prefix(plain)
    short = dict(zip(joints, (n[len(pre):] if pre and n.startswith(pre) else n for n in plain)))
    extra = [j for j in joints if NOT_BODY.search(short[j])] if body_only else []
    extra = list(set(extra) | set(drop or ()))
    if before <= max_bones and not extra:
        write_glb(dest, js, binary)
        return before, before
    nodes = js["nodes"]
    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    is_joint = set(joints)

    def joint_parent(j):                                  # the nearest ancestor that is a bone too
        p = parent.get(j)
        while p is not None and p not in is_joint:
            p = parent.get(p)
        return p

    jparent = {j: joint_parent(j) for j in joints}

    # how much skin each bone moves (sum of its weights over every skinned vertex)
    weight = dict.fromkeys(joints, 0.0)
    prims = []
    for ni, n in enumerate(nodes):
        if "mesh" not in n or "skin" not in n:
            continue
        skin_joints = skins[n["skin"]]["joints"]
        for p in js["meshes"][n["mesh"]]["primitives"]:
            sets = []
            k = 0
            while f"JOINTS_{k}" in p["attributes"] and f"WEIGHTS_{k}" in p["attributes"]:
                jj = _read(js, binary, p["attributes"][f"JOINTS_{k}"]).astype(np.int64)
                ww = _read(js, binary, p["attributes"][f"WEIGHTS_{k}"]).astype(np.float32)
                sets.append((jj, ww))
                k += 1
            if not sets:
                continue
            nodes_of = np.array(skin_joints)
            jj = np.concatenate([s[0] for s in sets], 1)
            ww = np.concatenate([s[1] for s in sets], 1)
            jj = nodes_of[np.clip(jj, 0, len(nodes_of) - 1)]       # skin slot -> node index
            for node, w in zip(jj.ravel(), ww.ravel()):
                if w > 0:
                    weight[int(node)] += float(w)
            prims.append((p, n["skin"], jj, ww, k))

    # remove end bones until it fits: non-body bones first (all of them with body_only), then helpers, then the ones
    # that move the least skin
    keep = set(joints)
    roots = [j for j in joints if jparent[j] is None]
    extra = set(extra)
    name = lambda j: re.sub(r"[._]\d+$", "", nodes[j].get("name", ""))

    def drop_bone(drop):
        keep.discard(drop)
        weight[jparent[drop]] += weight[drop]
        for j in joints:                                  # bones under it now hang from its parent
            if jparent[j] == drop:
                jparent[j] = jparent[drop]

    if interior:
        for j in [j for j in joints if j in extra and j not in roots]:
            drop_bone(j)
    while True:
        has_child = {jparent[j] for j in keep if jparent[j] is not None}
        leaves = [j for j in keep if j not in has_child and j not in roots]
        loose = [j for j in leaves if j in extra]
        if loose:
            drop_bone(loose[0])
            continue
        if len(keep) <= max_bones or not leaves:
            break
        drop_bone(min(leaves, key=lambda j: (j not in extra and not HELPER.search(name(j)), weight[j])))

    def kept(j):
        while j not in keep:
            j = jparent[j]
        return j

    world = _worlds(nodes, parent, joints)
    binds = _binds(js, binary, world)
    moved_skin = {int(x) for _, _, jj, ww, _ in prims for x in np.unique(jj[ww > 0])}
    rebind = _needs_rebind(binds, moved_skin | keep)
    if rebind:
        _rebind(js, binary, prims, binds)

    # each skin keeps its own surviving bones; inverse bind matrices follow them
    new_slots = []
    for s in skins:
        old = s["joints"]
        ibm = _read(js, binary, s["inverseBindMatrices"]) if "inverseBindMatrices" in s else None
        now = [j for j in old if j in keep]
        if rebind:
            inv = np.linalg.inv(np.array([world[j] for j in now])).transpose(0, 2, 1).reshape(len(now), 16)
            s["inverseBindMatrices"] = _add(js, binary, inv, 5126, "MAT4")
        elif ibm is not None:
            s["inverseBindMatrices"] = _add(js, binary, ibm[[old.index(j) for j in now]], 5126, "MAT4")
        s["joints"] = now
        new_slots.append({j: i for i, j in enumerate(now)})

    # every vertex: weights of removed bones go to their kept ancestor, best 4 kept, summing to 1
    for p, skin, jj, ww, k in prims:
        slot = new_slots[skin]
        mapped = np.vectorize(lambda j: slot.get(kept(int(j)), 0))(jj)
        out_j = np.zeros((len(jj), 4), np.uint16)
        out_w = np.zeros((len(jj), 4), np.float32)
        for v in range(len(jj)):
            acc = {}
            for j, w in zip(mapped[v], ww[v]):
                if w > 0:
                    acc[int(j)] = acc.get(int(j), 0.0) + float(w)
            best = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
            total = sum(w for _, w in best) or 1.0
            for c, (j, w) in enumerate(best):
                out_j[v, c], out_w[v, c] = j, w / total
            if not best:
                out_w[v, 0] = 1.0
        for i in range(k):
            p["attributes"].pop(f"JOINTS_{i}", None)
            p["attributes"].pop(f"WEIGHTS_{i}", None)
        p["attributes"]["JOINTS_0"] = _add(js, binary, out_j, 5123, "VEC4")
        p["attributes"]["WEIGHTS_0"] = _add(js, binary, out_w, 5126, "VEC4")

    # removed bones leave the node tree (UniMate's Blender import would turn them into bones again)
    gone = set(joints) - keep
    for g in sorted(gone, key=lambda g: -len(_path(parent, g))):        # deepest first
        orphans = [c for c in nodes[g].get("children", []) if c not in gone]
        if orphans and parent.get(g) is not None:         # something else hangs on it (a prop, a mesh, a bone): keep it
            nodes[parent[g]].setdefault("children", []).extend(orphans)
            for c in orphans:
                _bake(nodes[g], nodes[c])
                parent[c] = parent[g]
            nodes[g]["children"] = []
    for n in nodes:
        if "children" in n:
            n["children"] = [c for c in n["children"] if c not in gone]
            if not n["children"]:
                del n["children"]
    for anim in js.get("animations", []):
        anim["channels"] = [c for c in anim["channels"] if c.get("target", {}).get("node") not in gone]
    js["buffers"] = [{"byteLength": len(binary)}]
    write_glb(dest, js, binary)
    return before, len(keep)


# what Simplify takes off for good: helpers, unused bones, face detail, the last links of fingers and the extra links of hair and
# cloth. The body, the jaw, the tail and the wings stay, and each bone's skin goes to the bone it hung from, so the model moves the same.
SIMPLE_DROP = re.compile(
    r"drv|driver|twist|helper|corrective|roll\b|^bk_|_ex$|^ex_|_ex_|nub$|end$|^end|_end_|tip$|_top$|target|pole|^ik_|_ik$|"
    r"weapon|grab|prop\b|socket|attach|offset|^unused|_adj(_|$)|_adj[lr]$|_sub$|_mesh|^lod|lod\d|skin$|^pointlight|_def$|_mnt|scale_me|"
    r"^c_|ctrl|control|_(ik|fk)[lrx]?$|^deform_|scale_fix|"
    r"brow|eye|lid|lash|lip|teeth|tooth|tongue|cheek|nose|forehead|face|mouth|chin|frown|siwa|pupil|turban|groin|"
    r"(left|right|^l|^r)_?(upper|lower)_?jaw", re.I)
SIMPLE_SOFT = re.compile(r"hair|capillary|skirt|cloth|cape|cloak|dress|feeler|ribbon|coat|scarf|bust|breast|chain|string|sleeve|hood|jiggle|"
                         r"phys|dyn|spring|accessor|frill|braid|ponytail|fringe|veil|apron|robe|gown", re.I)
SIMPLE_FINGER = re.compile(r"finger|thumb|index|(?<!spine_)middle|(^|_|hand)ring|pinky|little|digit", re.I)
SIMPLE_KEEP = {"soft": 2, "finger": 2}      # links that stay per chain: they bend well enough, more adds little
SIMPLE_MAX = 100                            # the names don't always tell: past this, the end bones moving the least skin go too


def simplify_plan(names, parent):
    """names: {bone: name}, parent: {bone: its parent bone or None} -> the bones to take off"""
    plain = {j: body_name(n) for j, n in names.items()}
    pre = name_prefix(list(plain.values()))
    short = {j: (n[len(pre):] if pre and n.startswith(pre) else n) for j, n in plain.items()}
    drop = {j for j, n in short.items() if SIMPLE_DROP.search(n)}
    for kind, words in (("soft", SIMPLE_SOFT), ("finger", SIMPLE_FINGER)):
        for j in names:                                    # chains: the first few links stay
            if j in drop or not words.search(short[j]) or TRUNK.search(short[j]):
                continue
            depth, p = 0, parent.get(j)
            while p is not None and words.search(short.get(p, "")):
                depth += 1
                p = parent.get(p)
            if depth >= SIMPLE_KEEP[kind]:
                drop.add(j)
    return drop


def simplify(src, dest):
    """Write a copy of `src` with only the bones that matter. -> (bones before, bones after). Its own animations still play:
    a model that has some only loses end bones, since taking a bone out of the middle of a chain would make its children jump."""
    js, _ = read_glb(src)
    joints = sorted({j for s in js.get("skins", []) for j in s["joints"]})
    nodes = js["nodes"]
    node_parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    is_joint = set(joints)

    def up(j):
        p = node_parent.get(j)
        while p is not None and p not in is_joint:
            p = node_parent.get(p)
        return p
    drop = simplify_plan({j: nodes[j].get("name", "") for j in joints}, {j: up(j) for j in joints})
    return slim(src, dest, max_bones=SIMPLE_MAX, drop=drop, interior=not js.get("animations"))
