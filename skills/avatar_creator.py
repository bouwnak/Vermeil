"""
avatar_creator.py - AI-powered and procedural PS1-style anime avatar creator.
Transforms reference photos into low-poly retro anime avatars with Y2K, grunge,
and fairycore aesthetics.
"""
import base64
import io
import json
import os
import re
import time
import uuid
from datetime import datetime

import cv2
import numpy as np
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from paths import data_file

PRESETS_FILE = data_file("avatar_presets.json")
EXPORTS_DIR = os.path.join(os.path.expanduser("~"), "Documents", "Vermeil Creations", "Avatars")

MAX_FILE_BYTES = 15 * 1024 * 1024  # 15 MB
ALLOWED_FORMATS = {"JPEG", "JPG", "PNG", "WEBP"}

DEFAULT_PRESETS = {
    "y2k_grunge_shaman": {
        "id": "y2k_grunge_shaman",
        "name": "Y2K Grunge Shaman (Picture Match)",
        "description": "Sleepy eyes with spiked lower lashes, cat-ear wolf cut, asymmetrical floral bell-sleeve crop top, baggy skater pants & golden back spear.",
        "gender": "female",
        "skin_tone": "#b89582",
        "hair_style": "cat_wolf_cut",
        "hair_color": "#14151b",
        "eye_color": "#1b1c24",
        "eye_style": "sleepy_grunge",
        "makeup": ["goth_eyeliner", "blush"],
        "top": "asym_bell_sleeve",
        "top_color": "#c5aee0",
        "top_accent": "#6e3d5c",
        "bottom": "baggy_skater_pants",
        "bottom_color": "#13141a",
        "shoes": "platform_boots",
        "shoes_color": "#0a0b0e",
        "shoes_accent": "#14151b",
        "wings": False,
        "wing_style": "none",
        "wing_color": "#ffd700",
        "accessories": ["golden_spear"],
        "jewelry_color": "#ffd700",
        "lighting": "ps1_street",
        "wobble": True,
    },
    "y2k_cyber_fairy": {
        "id": "y2k_cyber_fairy",
        "name": "Y2K Cyber Fairy",
        "description": "Iridescent gossamer wings, neon space buns, sporty track jacket & chrome accessories.",
        "gender": "female",
        "skin_tone": "#f5d0c5",
        "hair_style": "twin_buns",
        "hair_color": "#ff77aa",
        "eye_color": "#00f0ff",
        "eye_style": "sparkle",
        "makeup": ["blush", "goth_eyeliner", "cyber_markings"],
        "top": "track_jacket",
        "top_color": "#1a1a2e",
        "top_accent": "#00f0ff",
        "bottom": "pleated_skirt",
        "bottom_color": "#2d1b4e",
        "shoes": "cyber_sneakers",
        "shoes_color": "#ffffff",
        "shoes_accent": "#00f0ff",
        "wings": True,
        "wing_style": "cyber_wings",
        "wing_color": "#00ffee",
        "accessories": ["butterfly_clips", "headphones", "chain_belt"],
        "jewelry_color": "#c0c0c0",
        "lighting": "cyber_void",
        "wobble": True,
    },
    "grunge_fairycore": {
        "id": "grunge_fairycore",
        "name": "Grunge Fairycore",
        "description": "Layered distressed textures, wolf cut, earth moss tones, butterfly clips & platform boots.",
        "gender": "female",
        "skin_tone": "#f4d6c6",
        "hair_style": "wolf_cut",
        "hair_color": "#3b261d",
        "eye_color": "#5b7c52",
        "eye_style": "grunge_dark",
        "makeup": ["freckles", "goth_eyeliner", "dark_lips"],
        "top": "layered_baby_tee",
        "top_color": "#222222",
        "top_accent": "#5b7c52",
        "bottom": "cargo_pants",
        "bottom_color": "#383f34",
        "shoes": "platform_boots",
        "shoes_color": "#111111",
        "shoes_accent": "#888888",
        "wings": True,
        "wing_style": "fairy_moth",
        "wing_color": "#6e8b74",
        "accessories": ["butterfly_clips", "choker", "chain_belt"],
        "jewelry_color": "#a8a8a8",
        "lighting": "fairy_garden",
        "wobble": True,
    },
    "dark_fairy": {
        "id": "dark_fairy",
        "name": "Dark Fairy",
        "description": "Obsidian silhouette, gossamer gothic bat wings, lace corset & velvet choker.",
        "gender": "female",
        "skin_tone": "#f8e2da",
        "hair_style": "hime_cut",
        "hair_color": "#121217",
        "eye_color": "#9d4edd",
        "eye_style": "fairy_mystic",
        "makeup": ["goth_eyeliner", "dark_lips"],
        "top": "corset_cami",
        "top_color": "#0f0f14",
        "top_accent": "#7b2cbf",
        "bottom": "tulle_skirt",
        "bottom_color": "#181822",
        "shoes": "platform_boots",
        "shoes_color": "#0a0a0f",
        "shoes_accent": "#9d4edd",
        "wings": True,
        "wing_style": "bat_fairy",
        "wing_color": "#7b2cbf",
        "accessories": ["choker", "star_pins", "chain_belt"],
        "jewelry_color": "#d4af37",
        "lighting": "dark_fairy",
        "wobble": True,
    },
    "pastel_dream": {
        "id": "pastel_dream",
        "name": "Pastel Dream",
        "description": "Fluffy spiky twin tails, candy lavender hues, delicate tulle, ribbons & star hairpins.",
        "gender": "female",
        "skin_tone": "#ffe3dc",
        "hair_style": "pigtails",
        "hair_color": "#c8b6ff",
        "eye_color": "#ff9ebb",
        "eye_style": "sparkle",
        "makeup": ["blush", "freckles", "fairy_glitter"],
        "top": "oversized_tee",
        "top_color": "#ffd6e0",
        "top_accent": "#bbd0ff",
        "bottom": "tulle_skirt",
        "bottom_color": "#c8b6ff",
        "shoes": "ballet_flats",
        "shoes_color": "#ffd6e0",
        "shoes_accent": "#ffffff",
        "wings": True,
        "wing_style": "butterfly",
        "wing_color": "#ffcbf2",
        "accessories": ["butterfly_clips", "star_pins"],
        "jewelry_color": "#ffffff",
        "lighting": "fairy_garden",
        "wobble": False,
    },
    "retro_anime_protagonist": {
        "id": "retro_anime_protagonist",
        "name": "Retro Anime Protagonist",
        "description": "Classic 90s/Y2K hero hair, oversized graphic tee, loose leg warmers & signature headphones.",
        "gender": "androgynous",
        "skin_tone": "#fae0d4",
        "hair_style": "short_spiky",
        "hair_color": "#2b3a67",
        "eye_color": "#48cae4",
        "eye_style": "retro_game",
        "makeup": ["blush"],
        "top": "oversized_tee",
        "top_color": "#202028",
        "top_accent": "#e63946",
        "bottom": "denim_shorts",
        "bottom_color": "#3f5e78",
        "shoes": "leg_warmers",
        "shoes_color": "#1e1e24",
        "shoes_accent": "#ffffff",
        "wings": False,
        "wing_style": "none",
        "wing_color": "#ffffff",
        "accessories": ["headphones", "chain_belt"],
        "jewelry_color": "#b8c0cc",
        "lighting": "ps1_bios",
        "wobble": True,
    },
}


def ensure_presets():
    """Ensure data/avatar_presets.json exists with defaults."""
    if not os.path.exists(PRESETS_FILE):
        os.makedirs(os.path.dirname(PRESETS_FILE), exist_ok=True)
        try:
            with open(PRESETS_FILE, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_PRESETS, f, indent=2)
        except Exception as e:
            print(f"[avatar_creator] save presets: {e}")
    else:
        # Merge any missing defaults
        try:
            with open(PRESETS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            changed = False
            for k, v in DEFAULT_PRESETS.items():
                if k not in saved:
                    saved[k] = v
                    changed = True
            if changed:
                with open(PRESETS_FILE, "w", encoding="utf-8") as f:
                    json.dump(saved, f, indent=2)
        except Exception:
            pass


def list_presets():
    ensure_presets()
    try:
        with open(PRESETS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return DEFAULT_PRESETS


def save_preset(preset_id, config):
    ensure_presets()
    presets = list_presets()
    clean_id = re.sub(r"[^a-zA-Z0-9_\-]", "_", preset_id).lower()
    config["id"] = clean_id
    if not config.get("name"):
        config["name"] = preset_id.replace("_", " ").title()
    presets[clean_id] = config
    with open(PRESETS_FILE, "w", encoding="utf-8") as f:
        json.dump(presets, f, indent=2)
    return presets


def delete_preset(preset_id):
    presets = list_presets()
    if preset_id in presets and preset_id not in DEFAULT_PRESETS:
        del presets[preset_id]
        with open(PRESETS_FILE, "w", encoding="utf-8") as f:
            json.dump(presets, f, indent=2)
    return presets


# ---------------- Image Input Decoding & Validation ----------------
def decode_image(image_input):
    """
    Decodes a base64 data URL or raw path into a PIL Image.
    Returns (PIL.Image, error_string).
    """
    if not image_input or not isinstance(image_input, str):
        return None, "No image data received."

    try:
        if image_input.startswith("data:"):
            # Format: data:image/png;base64,xxxx
            header, b64data = image_input.split(",", 1)
            raw = base64.b64decode(b64data)
        elif os.path.isfile(image_input):
            with open(image_input, "rb") as f:
                raw = f.read()
        else:
            raw = base64.b64decode(image_input)

        if len(raw) > MAX_FILE_BYTES:
            return None, f"Image is too large ({round(len(raw)/(1024*1024), 1)} MB). Max limit is 15 MB."

        img = Image.open(io.BytesIO(raw))
        fmt = (img.format or "").upper()
        if fmt not in ALLOWED_FORMATS:
            return None, f"Unsupported image format: {fmt}. Please use JPG, PNG, or WebP."

        # Convert to standard RGB
        if img.mode != "RGB":
            img = img.convert("RGB")

        # Resize large reference images to reasonable dimensions for analysis (e.g. max 1024x1024)
        img.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        return img, None
    except Exception as e:
        return None, f"Could not read the uploaded image: {e}"


def _rgb_to_hex(rgb):
    return "#%02x%02x%02x" % (max(0, min(255, int(rgb[0]))),
                               max(0, min(255, int(rgb[1]))),
                               max(0, min(255, int(rgb[2]))))


# ---------------- Offline Procedural Computer Vision ----------------
def analyze_offline_cv(img, aesthetic="y2k_cyber_fairy"):
    """
    Offline fallback analysis using OpenCV & PIL:
    - Face location & skin tone sampling
    - Hair color sampling
    - Eye color & brightness
    - Palette mapping to the selected Y2K/grunge/fairycore aesthetic.
    """
    cv_img = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
    h, w, _ = cv_img.shape

    # 1. Face detection
    face_rect = None
    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        if os.path.exists(cascade_path):
            face_cascade = cv2.CascadeClassifier(cascade_path)
            gray = cv2.cvtColor(cv_img, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(60, 60))
            if len(faces) > 0:
                # pick largest face
                face_rect = max(faces, key=lambda r: r[2] * r[3])
    except Exception:
        pass

    if face_rect is not None:
        fx, fy, fw, fh = face_rect
        # Cheek / forehead skin patch
        skin_patch = cv_img[int(fy + fh * 0.45):int(fy + fh * 0.65), int(fx + fw * 0.3):int(fx + fw * 0.7)]
        # Hair patch (above forehead)
        hair_y_start = max(0, int(fy - fh * 0.15))
        hair_y_end = int(fy + fh * 0.15)
        hair_patch = cv_img[hair_y_start:hair_y_end, int(fx + fw * 0.2):int(fx + fw * 0.8)]
        # Eye patch
        eye_patch = cv_img[int(fy + fh * 0.3):int(fy + fh * 0.45), int(fx + fw * 0.2):int(fx + fw * 0.8)]
    else:
        # Fallback zones
        skin_patch = cv_img[int(h * 0.35):int(h * 0.55), int(w * 0.35):int(w * 0.65)]
        hair_patch = cv_img[int(h * 0.05):int(h * 0.25), int(w * 0.25):int(w * 0.75)]
        eye_patch = cv_img[int(h * 0.3):int(h * 0.4), int(w * 0.3):int(w * 0.7)]

    # Compute median skin tone
    if skin_patch.size > 0:
        skin_rgb = np.median(cv2.cvtColor(skin_patch, cv2.COLOR_BGR2RGB), axis=(0, 1))
        # Ensure tone is in healthy skin range
        r, g, b = skin_rgb
        r = max(180, min(255, int(r)))
        g = max(130, min(r - 10, int(g)))
        b = max(110, min(g - 5, int(b)))
        skin_hex = _rgb_to_hex((r, g, b))
    else:
        skin_hex = "#f5d0c5"

    # Compute median hair color
    if hair_patch.size > 0:
        hair_rgb = np.median(cv2.cvtColor(hair_patch, cv2.COLOR_BGR2RGB), axis=(0, 1))
        hair_hex = _rgb_to_hex(hair_rgb)
    else:
        hair_hex = "#2b221e"

    # Compute eye brightness / color
    if eye_patch.size > 0:
        eye_rgb = np.mean(cv2.cvtColor(eye_patch, cv2.COLOR_BGR2RGB), axis=(0, 1))
        eye_hex = _rgb_to_hex(eye_rgb)
    else:
        eye_hex = "#483d8b"

    # Overall image brightness / warmth
    avg_rgb = np.mean(cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB), axis=(0, 1))
    is_dark = (avg_rgb[0] * 0.299 + avg_rgb[1] * 0.587 + avg_rgb[2] * 0.114) < 110

    # Pick hairstyle based on image aspect & hair tone
    presets = list_presets()
    base_preset = presets.get(aesthetic, DEFAULT_PRESETS.get("y2k_cyber_fairy")).copy()

    # Apply extracted values
    base_preset["skin_tone"] = skin_hex
    base_preset["hair_color"] = hair_hex

    # If the user has dark hair, add aesthetic highlights
    if is_dark and aesthetic == "grunge_fairycore":
        base_preset["makeup"] = ["goth_eyeliner", "freckles", "dark_lips"]
    elif aesthetic == "y2k_cyber_fairy":
        # Keep cyber tint with a touch of reference
        base_preset["eye_color"] = "#00f0ff" if eye_hex in ("#000000", "#ffffff") else eye_hex

    return {
        "source": "procedural_fallback",
        "provider": "OpenCV & PIL Offline Computer Vision",
        "detected_face": face_rect is not None,
        "attributes": base_preset,
        "summary": (
            f"Detected {'face landmarks' if face_rect is not None else 'portrait colors'}: "
            f"skin tone {skin_hex}, hair tone {hair_hex}. Transformed into PS1-style low-poly anime model."
        ),
        "note": (
            "Analyzed using offline color segmentation and facial feature extraction. "
            "To use multimodal AI vision generation, configure GROQ_API_KEY or OPENAI_API_KEY in your env file."
        ),
    }


STYLE_REF_PATH = os.path.join(os.path.dirname(__file__), "assets", "ps1_style_reference.png")


def get_style_reference_b64():
    """Returns base64 data URL of the target PS1 anime style reference image."""
    if os.path.exists(STYLE_REF_PATH):
        try:
            with open(STYLE_REF_PATH, "rb") as f:
                raw = f.read()
            return f"data:image/png;base64,{base64.b64encode(raw).decode('ascii')}"
        except Exception as e:
            print(f"[avatar_creator] read style reference: {e}")
    return None


# ---------------- Multimodal AI Vision Integration ----------------
def analyze_with_ai(img, aesthetic="y2k_grunge_shaman"):
    """
    Uses OpenAI or Groq Vision API to inspect the reference photo and return
    a structured character profile matching the low-poly Y2K/grunge/fairycore aesthetic.
    Supports dual-reference input (Style Reference + User Identity Reference).
    """
    groq_key = os.environ.get("GROQ_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")

    if not groq_key and not openai_key:
        return None

    # Convert img to base64 jpeg
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    img_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    data_url = f"data:image/jpeg;base64,{img_b64}"

    style_ref_data_url = get_style_reference_b64()

    system_prompt = (
        "You are an expert 3D character artist and PS1-era retro game designer.\n"
        "Your task is to transform the user's uploaded photo into a low-poly PS1-era 3D anime game avatar.\n\n"
        "TARGET ART STYLE RULES:\n"
        "- PS1-era 3D graphics: Low-polygon geometry, angular silhouettes, simplified anatomy, visibly limited polygon counts.\n"
        "- Retro textures: Low-resolution, blurry/pixelated texture maps, subtle dithering, slight texture distortion.\n"
        "- Anime face: Large expressive white eyes with dark pupils and spiky clumped lower eyelashes, minimal facial details, small nose/mouth, slightly shadowed face.\n"
        "- Hair: Long, messy hair with chunky, separated polygonal strands, uneven bangs, and a deliberately jagged silhouette.\n"
        "- Slim Body Proportions: Create a slim, slender anime female character with a narrow waist and torso. Narrow shoulder line (avoid broad, square torso). Small, defined waist with a gentle transition from chest to hips. Slender arms with narrow forearms and simplified dainty hands. Long, slim legs with loose baggy skater pants that drape naturally over a slender frame (never bulky, wide, or rectangular).\n"
        "- Clothing: Cropped lavender or faded-purple floral top with loose asymmetrical sleeves, paired with oversized black baggy pants.\n"
        "- Accessories: Understated alternative-fashion details (e.g. golden back spear, choker, chain belt) without clutter.\n"
        "- Lighting and environment: Muted blue-gray background, soft low-resolution shading, minimal lighting, and a nostalgic retro game atmosphere.\n"
        "- Avoid modern high-poly illustration, photorealism, glossy PBR materials, or smooth curves.\n\n"
        "Return ONLY a valid JSON object matching this schema:\n"
        "{\n"
        '  "gender": "female" | "male" | "androgynous",\n'
        '  "skin_tone": "#hex",\n'
        '  "hair_style": "cat_wolf_cut" | "wolf_cut" | "twin_buns" | "pigtails" | "hime_cut" | "messy_bob" | "fairy_locs" | "short_spiky",\n'
        '  "hair_color": "#hex",\n'
        '  "eye_color": "#hex",\n'
        '  "eye_style": "sleepy_grunge" | "sparkle" | "grunge_dark" | "fairy_mystic" | "retro_game",\n'
        '  "makeup": ["blush", "freckles", "goth_eyeliner", "fairy_glitter", "cyber_markings", "dark_lips"],\n'
        '  "top": "asym_bell_sleeve" | "layered_baby_tee" | "oversized_tee" | "corset_cami" | "track_jacket" | "fishnet_knit",\n'
        '  "top_color": "#hex",\n'
        '  "top_accent": "#hex",\n'
        '  "bottom": "baggy_skater_pants" | "cargo_pants" | "pleated_skirt" | "tulle_skirt" | "denim_shorts",\n'
        '  "bottom_color": "#hex",\n'
        '  "shoes": "platform_boots" | "cyber_sneakers" | "ballet_flats" | "leg_warmers",\n'
        '  "shoes_color": "#hex",\n'
        '  "shoes_accent": "#hex",\n'
        '  "wings": true | false,\n'
        '  "wing_style": "cyber_wings" | "fairy_moth" | "bat_fairy" | "butterfly" | "none",\n'
        '  "wing_color": "#hex",\n'
        '  "accessories": ["golden_spear", "butterfly_clips", "headphones", "choker", "chain_belt", "star_pins"],\n'
        '  "jewelry_color": "#hex",\n'
        '  "lighting": "ps1_street" | "ps1_bios" | "grunge_room" | "cyber_void" | "dark_fairy",\n'
        '  "wobble": true | false,\n'
        '  "reasoning": "brief 1-2 sentence description explaining how identity traits were mapped into PS1 anime style"\n'
        "}"
    )

    # Build dual-reference content if style reference image is present
    if style_ref_data_url:
        user_content = [
            {
                "type": "text",
                "text": (
                    "Please transform the person from the Identity Reference into a PS1-era low-poly 3D anime game avatar.\n"
                    "- Image 1 is the STYLE & BODY PROPORTION REFERENCE: defines the target low-poly 3D game aesthetic, slender narrow-waisted anime proportions, slender arms and long legs, chunky polygonal hair strands, large eyes with spiky lower lashes, retro textures, and muted alternative palette.\n"
                    "- Image 2 is the IDENTITY REFERENCE: extract the person's recognizable skin tone, hair color/style, eye color, and vibe, translating them into the exact slim PS1 3D anime style shown in Image 1."
                ),
            },
            {"type": "image_url", "image_url": {"url": style_ref_data_url}},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]
    else:
        user_content = [
            {
                "type": "text",
                "text": (
                    f"Transform this photo into a low-poly PS1-era 3D anime game avatar with the '{aesthetic}' aesthetic. "
                    "Follow the exact style of late-1990s retro games: angular low-poly geometry, slender narrow-waisted silhouette, long slim legs, chunky hair strands, "
                    "expressive white eyes with dark pupils and spiky lower lashes, cropped lavender floral top, baggy skater pants, and muted retro lighting."
                ),
            },
            {"type": "image_url", "image_url": {"url": data_url}},
        ]

    headers = {"Content-Type": "application/json"}
    payload = None

    if groq_key:
        api_url = "https://api.groq.com/openai/v1/chat/completions"
        headers["Authorization"] = f"Bearer {groq_key}"
        try:
            import llm
            model = llm.groq_models().get("vision", "meta-llama/llama-4-sc-preview")
        except Exception:
            model = "meta-llama/llama-4-sc-preview"
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.3,
            "max_tokens": 800,
            "response_format": {"type": "json_object"},
        }
    elif openai_key:
        api_url = "https://api.openai.com/v1/chat/completions"
        headers["Authorization"] = f"Bearer {openai_key}"
        model = "gpt-4o-mini"
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.3,
            "max_tokens": 800,
            "response_format": {"type": "json_object"},
        }

    try:
        import requests
        r = requests.post(api_url, headers=headers, json=payload, timeout=25)
        # If dual-image was rejected, retry with single identity image
        if r.status_code != 200 and style_ref_data_url:
            single_content = [
                {
                    "type": "text",
                    "text": (
                        "Transform this photo into a low-poly PS1 anime 3D game avatar: angular low-polygon geometry, "
                        "chunky separated hair strands, large eyes with spiky lower lashes, cropped floral top, oversized black pants, "
                        "and muted retro game lighting."
                    ),
                },
                {"type": "image_url", "image_url": {"url": data_url}},
            ]
            payload["messages"][1]["content"] = single_content
            r = requests.post(api_url, headers=headers, json=payload, timeout=25)

        if r.status_code == 200:
            res = r.json()
            content = res["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            reasoning = parsed.pop("reasoning", "AI Vision matched facial features, hair color, and style.")
            return {
                "source": "ai_vision",
                "provider": f"Multimodal AI Vision ({model})",
                "attributes": parsed,
                "summary": reasoning,
            }
        else:
            print(f"[avatar_creator AI] error {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"[avatar_creator AI exception] {e}")

    return None


# ---------------- Main Generation Entry Point ----------------
def process_reference_image(image_input, aesthetic="y2k_cyber_fairy"):
    """
    Validates the input, runs AI vision or offline CV fallback,
    and returns the complete avatar configuration.
    """
    img, err = decode_image(image_input)
    if err:
        return {"ok": False, "error": err}

    # Try AI Vision first if API key configured
    ai_result = analyze_with_ai(img, aesthetic)
    if ai_result:
        return {
            "ok": True,
            "source": ai_result["source"],
            "provider": ai_result["provider"],
            "attributes": ai_result["attributes"],
            "summary": ai_result["summary"],
        }

    # Offline Computer Vision Fallback
    cv_result = analyze_offline_cv(img, aesthetic)
    return {
        "ok": True,
        "source": cv_result["source"],
        "provider": cv_result["provider"],
        "detected_face": cv_result["detected_face"],
        "attributes": cv_result["attributes"],
        "summary": cv_result["summary"],
        "note": cv_result.get("note", ""),
    }


def save_export_file(name, data_bytes_or_b64, ext="png"):
    """
    Saves an exported avatar model or portrait to Documents/Vermeil Creations/Avatars/
    """
    os.makedirs(EXPORTS_DIR, exist_ok=True)
    clean_name = re.sub(r"[^a-zA-Z0-9_\-]", "_", name) or f"avatar_{int(time.time())}"
    filename = f"{clean_name}.{ext.lstrip('.')}"
    filepath = os.path.join(EXPORTS_DIR, filename)

    try:
        if isinstance(data_bytes_or_b64, str):
            if data_bytes_or_b64.startswith("data:"):
                data_bytes_or_b64 = data_bytes_or_b64.split(",", 1)[1]
            raw = base64.b64decode(data_bytes_or_b64)
        else:
            raw = data_bytes_or_b64

        with open(filepath, "wb") as f:
            f.write(raw)
        return {"ok": True, "path": filepath, "filename": filename}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def apply_as_character(name, glb_data_b64, persona_prompt="", voice=""):
    """
    Saves the 3D avatar (.glb) directly into ui/models/ and registers the character in data/characters.json.
    Sets it as active so Vermeil immediately switches to this new 3D model!
    """
    clean_name = re.sub(r"[^a-zA-Z0-9_\- ]", "", name).strip() or "PS1 Avatar"
    short_id = uuid.uuid4().hex[:6]
    char_id = f"avatar_{short_id}"
    model_filename = f"avatar_{short_id}.glb"

    models_dir = os.path.join(BASE_DIR, "ui", "models")
    os.makedirs(models_dir, exist_ok=True)
    model_path = os.path.join(models_dir, model_filename)

    if isinstance(glb_data_b64, str):
        if glb_data_b64.startswith("data:"):
            glb_data_b64 = glb_data_b64.split(",", 1)[1]
        raw_bytes = base64.b64decode(glb_data_b64)
    else:
        raw_bytes = glb_data_b64

    with open(model_path, "wb") as f:
        f.write(raw_bytes)

    chars_file = data_file("characters.json")
    try:
        with open(chars_file, "r", encoding="utf-8") as f:
            chars_data = json.load(f)
    except Exception:
        chars_data = {"active": char_id, "characters": []}

    prompt = persona_prompt.strip() if persona_prompt else (
        f"You are {clean_name}, a stylish low-poly anime companion with a Y2K grunge aesthetic. "
        "You are cool, slightly sleepy, observant, and loyal. Keep replies under 45 words and speak in dialogue."
    )

    new_char = {
        "id": char_id,
        "name": clean_name,
        "prompt": prompt,
        "voice": voice or "piper:en_US-amy-medium",
        "model": model_filename,
        "memory_key": char_id,
        "rate": "+0%",
        "pitch": "+0Hz",
        "volume": 100,
        "emotion": 100,
        "flip": False,
        "language": "auto",
        "translate": False,
        "outfit": "",
        "hair": "",
    }

    chars_data.setdefault("characters", []).append(new_char)
    chars_data["active"] = char_id

    with open(chars_file, "w", encoding="utf-8") as f:
        json.dump(chars_data, f, indent=2)

    return {
        "ok": True,
        "id": char_id,
        "name": clean_name,
        "model": model_filename,
    }
