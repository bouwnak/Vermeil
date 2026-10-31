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


def slim(src, dest, max_bones=MAX_BONES):
    """Write a copy of `src` with at most `max_bones` bones to `dest`. Returns (bones before, bones after)."""
    js, binary = read_glb(src)
    skins = js.get("skins", [])
    joints = sorted({j for s in skins for j in s["joints"]})
    before = len(joints)
    if before <= max_bones:
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

    # remove end bones until it fits: helpers first, then the ones that move the least skin
    keep = set(joints)
    roots = [j for j in joints if jparent[j] is None]
    while len(keep) > max_bones:
        has_child = {jparent[j] for j in keep if jparent[j] is not None}
        leaves = [j for j in keep if j not in has_child and j not in roots]
        if not leaves:
            break
        name = lambda j: re.sub(r"[._]\d+$", "", nodes[j].get("name", ""))
        drop = min(leaves, key=lambda j: (not HELPER.search(name(j)), weight[j]))
        keep.discard(drop)
        weight[jparent[drop]] += weight[drop]
        for j in joints:                                  # bones under it now hang from its parent
            if jparent[j] == drop:
                jparent[j] = jparent[drop]

    def kept(j):
        while j not in keep:
            j = jparent[j]
        return j

    # each skin keeps its own surviving bones; inverse bind matrices follow them
    new_slots = []
    for s in skins:
        old = s["joints"]
        ibm = _read(js, binary, s["inverseBindMatrices"]) if "inverseBindMatrices" in s else None
        now = [j for j in old if j in keep]
        if ibm is not None:
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
        if orphans and parent.get(g) is not None:         # something else hangs on it (a prop, a mesh): keep it
            nodes[parent[g]].setdefault("children", []).extend(orphans)
            for c in orphans:
                parent[c] = parent[g]
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
