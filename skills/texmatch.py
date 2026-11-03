"""
texmatch.py - which picture belongs to which material, when the model never says.
Downloads often keep the textures in a folder beside the model under names that only partly match the materials:
M_ch0004_00_toko_body -> ch0004_00_toko_co.ktx.png, Body_mt -> Shibahu_body_dif.png. Names are split into words, and the colour picture sharing the
most words with the material wins (a picture named for the exact part beats one for the whole model; light, mask and normal maps never count).
Plain Python, so both the Blender converters and the .glb importer use it.
"""
import os
import re

NOT_COLOUR = re.compile(r"(^|[_. -])(lgt|light|msk|mask|normal|nrm|nor|n|spec|specular|rough|roughness|metal|metallic|ao|occl|occlusion|emiss|emission|bump|height|shadow|shiny|alpha|opacity|id)([_. -]|$)", re.I)
COLOUR = re.compile(r"(^|[_. -])(dif|diff|diffuse|albedo|basecolou?r|base|col|colou?r|co|tex|d)([_. -]|$)", re.I)
GENERIC = {"mat", "mtl", "material", "materials", "tex", "texture", "textures", "png", "jpg", "jpeg", "ktx", "tga", "dds", "instance", "mesh", "lambert", "phong", "standard", "shader", "sg", "co", "dif", "diff", "col", "d"}


def words(name):
    out = set()
    for w in re.split(r"[^a-z0-9]+", os.path.splitext(os.path.basename(name.lower()))[0].replace(".ktx", "")):
        if not w or w in GENERIC or w.isdigit() and len(w) < 3:
            continue
        out.add(w)
        out.update(re.findall(r"[a-z]+|\d+", w) if len(w) > 6 else [])          # cosA -> cosa, and "body2" also reads as body
    return out


def best_picture(material, pictures):
    """the colour picture for a material, or None. pictures: {lower-case file name: path}"""
    mine = words(material)
    if not mine:
        return None
    best, score = None, (0, 0, 0)
    for name, path in pictures.items():
        stem = os.path.splitext(name)[0]
        if NOT_COLOUR.search(stem):
            continue
        theirs = words(name)
        shared = mine & theirs
        if not shared or max(len(w) for w in shared) < 3:
            continue
        s = (len(shared), 1 if COLOUR.search(stem) else 0, -len(stem))
        if s > score:
            best, score = path, s
    return best
