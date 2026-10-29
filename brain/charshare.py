"""charshare.py - share a character with friends as ONE file (<name>.vermeil, a zip inside).

  export_character(char, out_path, models_dir, include_voice=True)
        writes the personality + voice settings, the 3D model file (when it's your own, not a built-in one) and
        the RVC voice clone (when it has one and include_voice is on - that part can be 50-200 MB)
  import_character(path, models_dir)
        reads such a file and returns the character's settings, ready for Api.save_character. The 3D model goes
        into ui/models and the voice clone into data/rvc_voices (renamed if a different one has the same name).

Safe to open files from other people: only the expected files are read (nothing is unpacked by its own path),
sizes are capped, the model must really be a .glb/.gltf/.vrm and the voice is loaded with torch's safe loader.
"""
import json
import os
import re
import shutil
import tempfile
import zipfile

FORMAT = 1
EXT = ".vermeil"
MANIFEST = "vermeil-character.json"
MODEL_TYPES = (".glb", ".gltf", ".vrm")
SIDE_TYPES = (".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2")      # extra files a .gltf can point to
MAX_FILE = 600 * 1024 ** 2                                              # 600 MB per file
MAX_TOTAL = 1500 * 1024 ** 2
KEEP = ("name", "prompt", "voice", "voice_online", "rate", "pitch", "volume", "emotion", "natural", "emotional",
        "flip", "language", "translate", "outfit", "hair", "rvc")


def _safe_name(name, fallback="file"):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", os.path.basename(str(name or ""))).strip(" .")
    return name[:80] or fallback


def file_name(char):
    return _safe_name(char.get("name"), "character") + EXT


def _gltf_parts(path):
    """The files a .gltf model points to (buffers, textures) that sit next to it."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    folder = os.path.dirname(path)
    out = []
    for item in (data.get("buffers") or []) + (data.get("images") or []):
        uri = item.get("uri") or ""
        if uri and not uri.startswith("data:") and "/" not in uri and "\\" not in uri:
            p = os.path.join(folder, uri)
            if os.path.isfile(p) and uri.lower().endswith(SIDE_TYPES):
                out.append(p)
    return out


def export_character(char, out_path, models_dir, include_voice=True):
    """-> {"path", "size", "has_model", "has_voice"}"""
    data = {k: char[k] for k in KEEP if k in char}
    model = char.get("model") or ""
    has_model = has_voice = False
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        if model and not model.startswith("builtin:"):
            path = os.path.join(models_dir, _safe_name(model))
            if os.path.isfile(path):
                z.write(path, "model/" + _safe_name(model))
                for part in _gltf_parts(path) if path.lower().endswith(".gltf") else []:
                    z.write(part, "model/" + os.path.basename(part))
                has_model = True
        clone = (char.get("rvc") or {}).get("model")
        if include_voice and clone:
            import rvc
            folder = os.path.join(rvc.VOICES_DIR, _safe_name(clone))
            pth = os.path.join(folder, "model.pth")
            if os.path.isfile(pth):
                z.write(pth, "voice/model.pth", zipfile.ZIP_STORED)          # already compressed - zipping is slow
                if os.path.isfile(os.path.join(folder, "model.index")):
                    z.write(os.path.join(folder, "model.index"), "voice/model.index", zipfile.ZIP_STORED)
                has_voice = True
        if not has_model and model and not model.startswith("builtin:"):
            data["model"] = ""                                               # the file is gone: use the default
        elif model.startswith("builtin:"):
            data["model"] = model
        else:
            data["model"] = _safe_name(model) if has_model else ""
        if clone and not has_voice:
            data["rvc"] = None
        z.writestr(MANIFEST, json.dumps({"format": FORMAT, "app": "Vermeil", "character": data,
                                         "has_model": has_model, "has_voice": has_voice}, indent=1, ensure_ascii=False))
    return {"path": out_path, "size": os.path.getsize(out_path), "has_model": has_model, "has_voice": has_voice}


def _extract(z, info, dest):
    """copy one zip member to dest (a path WE chose), with the size checked while copying"""
    left = MAX_FILE
    with z.open(info) as src, open(dest, "wb") as out:
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk:
                break
            left -= len(chunk)
            if left < 0:
                raise ValueError("A file inside is too big.")
            out.write(chunk)


def _free_name(folder, name, same_as=None):
    """name, or 'name (2)', 'name (3)'... if a different file/folder already uses it"""
    stem, ext = os.path.splitext(name)
    n, cand = 1, name
    while os.path.exists(os.path.join(folder, cand)):
        if same_as and os.path.isfile(os.path.join(folder, cand)) and \
                os.path.getsize(os.path.join(folder, cand)) == os.path.getsize(same_as):
            return cand                                                      # the same file is already here
        n += 1
        cand = f"{stem} ({n}){ext}"
    return cand


def import_character(path, models_dir):
    """-> the character's settings (dict, no id yet) + "notes" (what came with it)"""
    if not zipfile.is_zipfile(path):
        raise ValueError("That isn't a Vermeil character file.")
    with zipfile.ZipFile(path) as z:
        members = {i.filename: i for i in z.infolist() if not i.is_dir()}
        if MANIFEST not in members:
            raise ValueError("That isn't a Vermeil character file.")
        if sum(i.file_size for i in members.values()) > MAX_TOTAL:
            raise ValueError("That character file is too big.")
        try:
            manifest = json.loads(z.read(members[MANIFEST]).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ValueError("The character file is damaged.")
        if not isinstance(manifest, dict) or not isinstance(manifest.get("character"), dict):
            raise ValueError("The character file is damaged.")
        if int(manifest.get("format") or 0) > FORMAT:
            raise ValueError("This character was made with a newer Vermeil. Update the app first.")
        char = {k: v for k, v in manifest["character"].items() if k in KEEP or k == "model"}
        char["name"] = str(char.get("name") or "Shared character")[:40]
        char["prompt"] = str(char.get("prompt") or "")[:8000]
        notes = []

        # the 3D model
        model = str(char.get("model") or "")
        if model and not model.startswith("builtin:"):
            want = _safe_name(model)
            main = members.get("model/" + want)
            if main and want.lower().endswith(MODEL_TYPES):
                os.makedirs(models_dir, exist_ok=True)
                tmp = tempfile.mkdtemp(prefix="vermeil_share_")
                try:
                    staged = os.path.join(tmp, want)
                    _extract(z, main, staged)
                    with open(staged, "rb") as f:
                        head = f.read(64)
                    if want.lower().endswith((".glb", ".vrm")) and head[:4] != b"glTF":
                        raise ValueError("The 3D model inside isn't a real .glb/.vrm file.")
                    if want.lower().endswith(".gltf") and not head.lstrip().startswith(b"{"):
                        raise ValueError("The 3D model inside isn't a real .gltf file.")
                    final = _free_name(models_dir, want, staged)
                    if not os.path.exists(os.path.join(models_dir, final)):
                        shutil.copyfile(staged, os.path.join(models_dir, final))
                    for name, info in members.items():                       # .gltf side files (textures, .bin)
                        side = name[len("model/"):]
                        if name.startswith("model/") and side != want and side == _safe_name(side) \
                                and side.lower().endswith(SIDE_TYPES) and not os.path.exists(os.path.join(models_dir, side)):
                            _extract(z, info, os.path.join(models_dir, side))
                    char["model"] = final
                    notes.append("3D model")
                finally:
                    shutil.rmtree(tmp, ignore_errors=True)
            else:
                char["model"] = ""

        # the voice clone
        rvc_cfg = char.get("rvc") if isinstance(char.get("rvc"), dict) else None
        if rvc_cfg and rvc_cfg.get("model") and "voice/model.pth" in members:
            import rvc
            tmp = tempfile.mkdtemp(prefix="vermeil_share_")
            try:
                pth = os.path.join(tmp, "model.pth")
                _extract(z, members["voice/model.pth"], pth)
                index = None
                if "voice/model.index" in members:
                    index = os.path.join(tmp, "model.index")
                    _extract(z, members["voice/model.index"], index)
                name = _safe_name(rvc_cfg["model"], "Shared voice")
                existing = os.path.join(rvc.VOICES_DIR, name, "model.pth")
                if os.path.isfile(existing) and os.path.getsize(existing) != os.path.getsize(pth):
                    name = _free_name(rvc.VOICES_DIR, name)
                if not os.path.isfile(os.path.join(rvc.VOICES_DIR, name, "model.pth")):
                    name = rvc.import_voice(pth, index, name=name)["name"]      # checks it's a real RVC voice
                rvc_cfg["model"] = name
                notes.append("voice clone")
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        elif rvc_cfg and rvc_cfg.get("model"):
            import rvc
            if not os.path.isfile(os.path.join(rvc.VOICES_DIR, _safe_name(rvc_cfg["model"]), "model.pth")):
                char["rvc"] = None                                           # not included and not on this PC
        char["notes"] = notes
        return char
