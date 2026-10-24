"""
baking.py - Baking mode: your recipes, importing a recipe from any website, converting each ingredient
(cups -> ml / g, etc.), substitutes ("alternative") for each ingredient, and nutrition facts per serving.

Recipes are saved in data/baking.json:
  {"recipes": [{"id", "title", "source", "servings", "image", "ingredients": [{"id", "qty", "unit", "name", "text"}],
                "steps": ["..."], "nutrition": {...} or null, "notes"}]}
"""
import json
import re
import time
import uuid
from fractions import Fraction

import requests

from paths import data_file

KINDS = ("baking", "cooking")             # two separate recipe books, same tools


def _file(kind):
    return data_file(f"{kind if kind in KINDS else 'baking'}.json")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}


# ------------------------------------------------------------------ storage
def _load(kind="baking"):
    try:
        with open(_file(kind), encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {"recipes": []}
    except (OSError, json.JSONDecodeError):
        return {"recipes": []}


def _save(d, kind="baking"):
    with open(_file(kind), "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)


def list_recipes(kind="baking"):
    return [{"id": r["id"], "title": r["title"], "source": r.get("source", ""), "servings": r.get("servings"),
             "count": len(r.get("ingredients", [])), "saved": bool(r.get("saved")), "image": r.get("image", "") if r.get("image_v") or not any(h in r.get("source", "") for h in SOCIAL) else "",
             "image_tried": bool(r.get("image_v"))}
            for r in sorted(_load(kind)["recipes"], key=lambda r: (not r.get("saved"), r.get("title", "").lower()))]


def get_recipe(rid, kind="baking"):
    return next((r for r in _load(kind)["recipes"] if r["id"] == rid), None)


def save_recipe(recipe, kind="baking"):
    """Add or update a recipe (ingredients may be given as text lines or dicts)."""
    d = _load(kind)
    r = dict(recipe or {})
    r["id"] = r.get("id") or uuid.uuid4().hex[:8]
    r["title"] = (r.get("title") or "My recipe").strip()[:120]
    r["ingredients"] = [ingredient(i) for i in r.get("ingredients", []) if (i if isinstance(i, str) else i.get("text") or i.get("name"))]
    r["steps"] = [s.strip() for s in r.get("steps", []) if str(s).strip()]
    r.setdefault("servings", None)
    r.setdefault("nutrition", None)
    r["updated"] = time.strftime("%Y-%m-%d %H:%M")
    if any(x["id"] == r["id"] for x in d["recipes"]):
        d["recipes"] = [r if x["id"] == r["id"] else x for x in d["recipes"]]
    else:
        d["recipes"].append(r)
    _save(d, kind)
    return r


def delete_recipe(rid, kind="baking"):
    d = _load(kind)
    d["recipes"] = [r for r in d["recipes"] if r["id"] != rid]
    _save(d, kind)
    return {"ok": True}


def toggle_saved(rid, kind="baking"):
    """The ★ Save button: saved recipes stay at the top of your list."""
    r = get_recipe(rid, kind)
    if not r:
        return {"error": "Recipe not found."}
    r["saved"] = not r.get("saved")
    return save_recipe(r, kind)


# ------------------------------------------------------------------ reading an ingredient line
UNITS = {  # spelling -> standard unit
    "cup": "cup", "cups": "cup", "c": "cup", "tablespoon": "tbsp", "tablespoons": "tbsp", "tbsp": "tbsp", "tbs": "tbsp", "tbsps": "tbsp", "T": "tbsp",
    "teaspoon": "tsp", "teaspoons": "tsp", "tsp": "tsp", "tsps": "tsp", "t": "tsp", "ml": "ml", "milliliter": "ml", "milliliters": "ml",
    "millilitre": "ml", "l": "l", "liter": "l", "liters": "l", "litre": "l", "g": "g", "gram": "g", "grams": "g", "gr": "g",
    "kg": "kg", "kilogram": "kg", "kilograms": "kg", "oz": "oz", "ounce": "oz", "ounces": "oz", "lb": "lb", "lbs": "lb",
    "pound": "lb", "pounds": "lb", "fl oz": "fl oz", "pinch": "pinch", "pinches": "pinch", "stick": "stick", "sticks": "stick",
    "piece": "pc", "pieces": "pc", "pc": "pc", "pcs": "pc", "clove": "clove", "cloves": "clove", "can": "can", "cans": "can",
}
_VULGAR = {"½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8"}


def _num(s):
    """'2 1/2' -> 2.5, '1/2' -> 0.5, '1.5' -> 1.5, '2-3' -> 2.5"""
    s = s.strip()
    if "-" in s and not s.startswith("-"):
        a, b = s.split("-", 1)
        return (_num(a) + _num(b)) / 2
    total = 0.0
    for part in s.split():
        total += float(Fraction(part))
    return total


def parse_line(text):
    """'2 1/2 cups all-purpose flour' -> {qty: 2.5, unit: 'cup', name: 'all-purpose flour'}"""
    t = (text or "").strip()
    for k, v in _VULGAR.items():
        t = re.sub(rf"(\d){k}", rf"\1 {v}", t).replace(k, v)
    t = re.sub(r"^[•\-*•]\s*", "", t)
    m = re.match(r"^((?:\d+(?:\.\d+)?\s+)?\d+(?:[./]\d+)?(?:\s*-\s*\d+(?:[./]\d+)?)?)\s*(.*)$", t)
    qty, rest = (None, t)
    if m:
        try:
            qty, rest = _num(m.group(1)), m.group(2)
        except (ValueError, ZeroDivisionError):
            qty, rest = None, t
    unit = ""
    mu = re.match(r"^(fl\.?\s?oz|[A-Za-z]+)\.?\b\s*(?:of\s+)?(.*)$", rest)
    if mu:
        key = mu.group(1).replace(".", "").replace("  ", " ")
        if key in UNITS or key.lower() in UNITS:
            unit = UNITS.get(key, UNITS.get(key.lower()))
            rest = mu.group(2)
    return {"qty": round(qty, 3) if qty is not None else None, "unit": unit, "name": rest.strip(" ,") or t}


def ingredient(i):
    """Normalise an ingredient (text line or dict) -> {id, qty, unit, name, text}."""
    if isinstance(i, str):
        p = parse_line(i)
        p["text"] = i.strip()
    else:
        p = {"qty": i.get("qty"), "unit": i.get("unit") or "", "name": (i.get("name") or "").strip()}
        if (p["qty"] is None and not p["unit"]) and i.get("text") and not i.get("name"):
            p = parse_line(i["text"])
        p["text"] = i.get("text") or format_amount(p["qty"], p["unit"], p["name"])
    p["id"] = (i.get("id") if isinstance(i, dict) else None) or uuid.uuid4().hex[:6]
    return p


def nice(n):
    """2.5 -> '2 1/2', 0.333 -> '1/3', 3.0 -> '3'"""
    if n is None:
        return ""
    whole = int(n)
    frac = Fraction(n - whole).limit_denominator(8)
    if frac.numerator == 0 or abs(float(frac) - (n - whole)) > 0.02:
        return f"{whole}" if abs(n - whole) < 0.02 else f"{n:g}"
    if frac == 1:
        return f"{whole + 1}"
    return f"{whole} {frac}" if whole else f"{frac}"


def format_amount(qty, unit, name):
    u = {"cup": "cup" if (qty or 0) <= 1 else "cups", "tsp": "teaspoon" if (qty or 0) <= 1 else "teaspoons",
         "tbsp": "tablespoon" if (qty or 0) <= 1 else "tablespoons", "pc": "pieces" if (qty or 0) != 1 else "piece"}.get(unit, unit)
    return " ".join(x for x in (nice(qty), u, name) if x)


# ------------------------------------------------------------------ converting
ML = {"cup": 236.588, "tbsp": 14.787, "tsp": 4.929, "ml": 1, "l": 1000, "fl oz": 29.574}
G = {"g": 1, "kg": 1000, "oz": 28.3495, "lb": 453.592}
# grams per cup of common baking ingredients (so cups can become grams)
DENSITY = [("all-purpose flour", 125), ("bread flour", 127), ("cake flour", 114), ("whole wheat flour", 120), ("almond flour", 96),
           ("flour", 125), ("brown sugar", 213), ("powdered sugar", 120), ("icing sugar", 120), ("confectioners", 120),
           ("white sugar", 200), ("granulated sugar", 200), ("caster sugar", 200), ("sugar", 200), ("butter", 227), ("cocoa", 85),
           ("chocolate chip", 170), ("oats", 90), ("rolled oats", 90), ("walnut", 117), ("pecan", 109), ("almond", 143),
           ("nuts", 120), ("milk", 245), ("buttermilk", 245), ("cream", 238), ("water", 237), ("oil", 218), ("honey", 340),
           ("maple syrup", 312), ("yogurt", 245), ("sour cream", 230), ("cream cheese", 232), ("rice", 185), ("salt", 292),
           ("baking soda", 230), ("baking powder", 230), ("vanilla", 208), ("cornstarch", 128), ("shredded coconut", 85),
           ("raisins", 165), ("peanut butter", 258), ("cheese", 113),
           ("soy sauce", 255), ("fish sauce", 288), ("oyster sauce", 288), ("vinegar", 240), ("broth", 240), ("stock", 240),
           ("coconut milk", 240), ("tomato sauce", 245), ("ketchup", 270), ("onion", 160), ("garlic", 136), ("carrot", 128),
           ("potato", 150), ("peas", 145), ("corn", 154), ("pasta", 100), ("breadcrumbs", 108)]
EACH = [("clove", 5), ("onion", 110), ("potato", 170), ("tomato", 120), ("carrot", 60), ("bay lea", 0.2), ("egg", 50), ("egg yolk", 18), ("egg white", 33), ("banana", 118), ("stick", 113)]


def grams_per_cup(name):
    n = (name or "").lower()
    for key, g in DENSITY:
        if key in n:
            return g
    return None


def convert(qty, unit, name):
    """Every sensible way to write this amount: [{label, qty, unit}]"""
    if qty is None:
        if unit != "pinch":
            return []
        qty = 1
    out = []
    unit = unit or ""
    n = (name or "").lower()
    if unit == "stick" and "butter" in n:
        qty, unit = qty * 0.5, "cup"
    if unit in ML:
        ml = qty * ML[unit]
        out.append(("ml", ml))
        if ml >= 1000:
            out.append(("l", ml / 1000))
        for u in ("cup", "tbsp", "tsp", "fl oz"):
            if u != unit:
                out.append((u, ml / ML[u]))
        gpc = grams_per_cup(n)
        if gpc:
            g = ml / ML["cup"] * gpc
            out.insert(0, ("g", g))
            out.append(("oz", g / G["oz"]))
    elif unit in G:
        g = qty * G[unit]
        out.append(("g", g))
        if g >= 1000:
            out.append(("kg", g / 1000))
        out.append(("oz", g / G["oz"]))
        if g >= 200:
            out.append(("lb", g / G["lb"]))
        gpc = grams_per_cup(n)
        if gpc:
            cups = g / gpc
            out.append(("cup", cups))
            out.append(("tbsp", cups * 16))
            out.append(("ml", cups * ML["cup"]))
    elif unit in ("", "pc"):
        for key, g in sorted(EACH, key=lambda e: -len(e[0])):
            if key in n:
                out.append(("g", qty * g))
                break
    elif unit == "pinch":
        out.append(("tsp", qty / 16)); out.append(("g", qty * 0.36))

    def rnd(u, v):
        return round(v) if u in ("g", "ml") and v >= 10 else round(v, 1) if u in ("g", "ml", "oz", "kg", "l", "lb") else round(v, 2)
    seen, res = set(), []
    for u, v in out:
        if u == unit or u in seen or v <= 0:
            continue
        if (u == "cup" and v < 0.0625) or (u == "tbsp" and (v < 0.25 or v > 32)) or (u == "tsp" and (v < 0.125 or v > 24)) \
                or (u == "fl oz" and v < 0.5) or (u == "lb" and v < 0.25):
            continue                                          # skip silly ones like "0.02 cup" or "120 tsp"
        seen.add(u)
        res.append({"unit": u, "qty": rnd(u, v), "label": f"{nice(rnd(u, v)) if u in ('cup', 'tbsp', 'tsp') else f'{rnd(u, v):g}'} {u}"})
    return res


# ------------------------------------------------------------------ alternatives
SUBS = {
    "butter": ["Same amount of margarine", "3/4 the amount of vegetable or coconut oil", "Half butter, half unsweetened applesauce (less fat)"],
    "egg": ["1 tbsp ground flaxseed + 3 tbsp water per egg (let it sit 5 min)", "1/4 cup unsweetened applesauce per egg",
            "1/4 cup mashed banana per egg", "3 tbsp aquafaba (chickpea water) per egg"],
    "all-purpose flour": ["Same amount of bread flour (chewier)", "1 cup + 2 tbsp cake flour per cup", "Gluten-free 1:1 baking flour"],
    "flour": ["Gluten-free 1:1 baking flour", "Half whole wheat flour + half all-purpose"],
    "brown sugar": ["1 cup white sugar + 1 tbsp molasses per cup", "Coconut sugar, same amount", "White sugar, same amount (less chewy)"],
    "white sugar": ["Same amount of caster sugar", "3/4 cup honey per cup (use 3 tbsp less liquid)", "Coconut sugar, same amount"],
    "sugar": ["Coconut sugar, same amount", "3/4 cup honey or maple syrup per cup (reduce liquid a little)"],
    "baking soda": ["3x the amount of baking powder", "Self-rising flour instead of plain flour (leave out salt too)"],
    "baking powder": ["1/4 tsp baking soda + 1/2 tsp cream of tartar per 1 tsp", "Self-rising flour instead of plain flour"],
    "vanilla extract": ["Same amount of vanilla paste", "Seeds of 1/2 vanilla bean per tsp", "Maple syrup, same amount"],
    "milk": ["Same amount of almond, oat or soy milk", "1/2 evaporated milk + 1/2 water", "Water + 1 tbsp butter per cup"],
    "buttermilk": ["1 cup milk + 1 tbsp lemon juice or vinegar (wait 5 min)", "Plain yogurt thinned with a little milk"],
    "heavy cream": ["3/4 cup milk + 1/4 cup melted butter per cup", "Same amount of coconut cream"],
    "sour cream": ["Same amount of plain Greek yogurt"],
    "chocolate chips": ["Same amount of chopped chocolate bar", "Carob chips", "M&Ms or dried fruit"],
    "walnut": ["Pecans, same amount", "Almonds, chopped", "Leave out (or add more chocolate chips)"],
    "salt": ["Use salted butter and skip the salt", "Half the amount of table salt if the recipe says kosher salt"],
    "cocoa": ["3 tbsp cocoa + 1 tbsp butter = 1 oz unsweetened chocolate", "Carob powder, same amount"],
    "oil": ["Same amount of melted butter", "Same amount of unsweetened applesauce (less fat)"],
    "cream cheese": ["Mascarpone, same amount", "Strained Greek yogurt (tangier)"],
    "honey": ["Maple syrup, same amount", "1 1/4 cup sugar + 1/4 cup more liquid per cup"],
    "soy sauce": ["Same amount of tamari (gluten-free)", "Coconut aminos (less salty, a bit sweeter)", "Liquid aminos, same amount"],
    "fish sauce": ["Soy sauce + a squeeze of lime", "Same amount of patis or anchovy paste mixed with water"],
    "vinegar": ["Calamansi or lemon juice, same amount", "Apple cider vinegar, same amount", "Rice vinegar, same amount (milder)"],
    "oyster sauce": ["Hoisin sauce, same amount", "Soy sauce + a pinch of sugar"],
    "chicken": ["Pork shoulder (cook a bit longer)", "Firm tofu (vegetarian)", "Turkey thighs"],
    "pork": ["Chicken thighs", "Beef chuck (cook longer)", "Jackfruit or mushrooms (vegetarian)"],
    "beef": ["Pork shoulder", "Portobello mushrooms (vegetarian)", "Lamb, same amount"],
    "garlic": ["1/8 tsp garlic powder per clove", "Shallots (milder)"],
    "onion": ["Shallots or leeks", "1 tbsp onion powder per medium onion"],
    "coconut milk": ["Evaporated milk", "Heavy cream (not dairy-free)", "Cashew cream"],
    "rice": ["Cauliflower rice (low carb)", "Quinoa", "Brown rice (cook longer)"],
    "cooking oil": ["Butter or ghee", "Coconut oil", "Olive oil (lower heat)"],
}


def alternatives(name):
    n = (name or "").lower()
    for key in sorted(SUBS, key=len, reverse=True):
        if key in n or (key.endswith("s") and key[:-1] in n):
            return {"name": name, "options": SUBS[key], "source": "built-in"}
    try:
        import llm
        d = llm.ask(f"Give 3 practical baking substitutes for '{name}', each with the amount to use. "
                    f'JSON: {{"options": ["..."]}}', model="chat", json_mode=True)
        opts = [str(x) for x in d.get("options", [])][:4]
        if opts:
            return {"name": name, "options": opts, "source": "ai"}
    except Exception:
        pass
    return {"name": name, "options": [], "source": "none"}


# ------------------------------------------------------------------ importing from a website
def _flatten_steps(x):
    out = []
    for s in x if isinstance(x, list) else [x]:
        if isinstance(s, str):
            out += [p.strip() for p in re.split(r"\n+", s) if p.strip()]
        elif isinstance(s, dict):
            if s.get("@type") == "HowToSection":
                out += _flatten_steps(s.get("itemListElement", []))
            elif s.get("text"):
                out.append(s["text"].strip())
    return [re.sub(r"<[^>]+>", "", s).strip() for s in out if s]


def _find_recipe_ld(page):
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', page, flags=re.S | re.I):
        try:
            data = json.loads(block.strip())
        except json.JSONDecodeError:
            continue
        stack = [data]
        while stack:
            d = stack.pop()
            if isinstance(d, list):
                stack += d
            elif isinstance(d, dict):
                t = d.get("@type")
                if t == "Recipe" or (isinstance(t, list) and "Recipe" in t):
                    return d
                stack += [v for v in d.values() if isinstance(v, (list, dict))]
    return None


def _nutrition_from_ld(n):
    if not isinstance(n, dict):
        return None
    keys = {"calories": "Calories", "fatContent": "Total fat", "saturatedFatContent": "Saturated fat", "cholesterolContent": "Cholesterol",
            "sodiumContent": "Sodium", "carbohydrateContent": "Carbohydrates", "fiberContent": "Fiber", "sugarContent": "Sugar",
            "proteinContent": "Protein"}
    rows = [{"label": lab, "value": str(n[k])} for k, lab in keys.items() if n.get(k)]
    return {"per": "serving", "rows": rows, "source": "the website"} if rows else None


def import_url(url, kind="baking"):
    """Read a recipe from a web page: uses the page's recipe data when it has it, otherwise the AI reads the page."""
    import html as H
    r = requests.get(url, headers=UA, timeout=20)
    r.raise_for_status()
    page = r.text
    ld = _find_recipe_ld(page)
    if ld and ld.get("recipeIngredient"):
        y = ld.get("recipeYield")
        y = y[0] if isinstance(y, list) and y else y
        servings = int(re.search(r"\d+", str(y)).group()) if y and re.search(r"\d+", str(y)) else None
        recipe = {"title": H.unescape(ld.get("name") or "Recipe"), "source": url, "servings": servings,
                  "ingredients": [H.unescape(re.sub(r"<[^>]+>", "", i)) for i in ld["recipeIngredient"]],
                  "steps": [H.unescape(s) for s in _flatten_steps(ld.get("recipeInstructions", []))],
                  "nutrition": _nutrition_from_ld(ld.get("nutrition"))}
    else:
        import web
        title, text = web.html_to_text(page)
        meta = " ".join(re.findall(r'<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]*)"', page))
        text = (H.unescape(meta) + "\n\n" + text) if meta else text
        import llm
        d = llm.ask("Extract the recipe from this web page. JSON: {\"title\": str, \"servings\": int or null, "
                    "\"ingredients\": [\"one line each, with amount\"], \"steps\": [\"...\"]}. Only what the page says.\n\n"
                    f"TITLE: {title}\n\n{text[:14000]}", model="chat", json_mode=True)
        if not d.get("ingredients"):
            if any(h in url for h in ("tiktok.com", "youtube.com", "youtu.be", "instagram.com", "facebook.com")):
                # a video with no written recipe: keep the link so you can watch it, the AI fills in a likely recipe
                d = llm.ask("This is a cooking/baking video. Based on its title and description, write the most likely recipe. "
                            'JSON: {"title": str, "servings": int, "ingredients": ["..."], "steps": ["..."]}\n\n'
                            f"TITLE: {title}\n\n{text[:4000]}", model="chat", json_mode=True)
                if d.get("ingredients"):
                    d["notes"] = "From a video - the written recipe was worked out by the AI, so check it against the video."
            if not d.get("ingredients"):
                return {"error": "I couldn't find a recipe on that page."}
        recipe = {"title": d.get("title") or title or "Recipe", "source": url, "servings": d.get("servings"),
                  "ingredients": d["ingredients"], "steps": d.get("steps", []), "nutrition": None, "notes": d.get("notes", "")}
    img = (ld or {}).get("image", "") if ld else ""
    if isinstance(img, list): img = img[0] if img else ""
    if isinstance(img, dict): img = img.get("url", "")
    recipe["image"] = video_thumb(url) if any(h in url for h in SOCIAL) else (img or _og_image(page))
    recipe["image_v"] = 2
    saved = save_recipe(recipe, kind)
    if not saved.get("nutrition"):
        try:
            saved["nutrition"] = estimate_nutrition(saved)
            saved = save_recipe(saved, kind)
        except Exception:
            pass
    return saved


# ------------------------------------------------------------------ nutrition
def estimate_nutrition(recipe):
    """Nutrition facts per serving, estimated by the AI from the ingredient list."""
    import llm
    lines = "\n".join(i["text"] for i in recipe.get("ingredients", []))
    d = llm.ask("Estimate the nutrition facts PER SERVING for this recipe. If servings is unknown, choose a sensible number. "
                'JSON: {"servings": int, "rows": [{"label": "Calories", "value": "210 kcal"}, {"label": "Total fat", "value": "11 g"}, '
                '... Saturated fat, Cholesterol, Sodium, Carbohydrates, Fiber, Sugar, Protein]}\n\n'
                f"Servings: {recipe.get('servings') or 'unknown'}\nIngredients:\n{lines}", model="chat", json_mode=True)
    rows = [{"label": str(r.get("label")), "value": str(r.get("value"))} for r in d.get("rows", []) if r.get("label")]
    return {"per": "serving", "servings": d.get("servings") or recipe.get("servings"), "rows": rows, "source": "estimated by AI"}


def refresh_nutrition(rid, kind="baking"):
    r = get_recipe(rid, kind)
    if not r:
        return {"error": "Recipe not found."}
    r["nutrition"] = estimate_nutrition(r)
    return save_recipe(r, kind)


SAMPLE = {"title": "Chocolate Chip Cookies", "servings": 24, "source": "",
          "ingredients": ["2 1/2 cups all-purpose flour", "1 cup softened butter", "1/2 cup white sugar", "1 cup brown sugar",
                          "2 pieces raw eggs", "1 teaspoon vanilla extract", "1 teaspoon baking soda", "1 teaspoon salt",
                          "2 cups semisweet chocolate chips", "3/4 cup chopped walnuts"],
          "steps": ["Preheat oven to 350 degrees Fahrenheit.", "In a mixing bowl, combine all-purpose flour, salt, and baking soda. Mix well and set aside.",
                    "On a separate mixing bowl, put in butter and beat. Gradually add both sugars while beating.",
                    "Add-in the vanilla extract and eggs (one piece at a time) while beating.",
                    "Gradually add the flour, salt, and baking soda mixture and beat until all the ingredients are well mixed.",
                    "Put-in the chocolate chips and chopped nuts. Fold until the chips and nuts are evenly distributed.",
                    "Scoop about a tablespoon of dough onto a baking sheet lined with parchment paper.",
                    "Bake for 10 to 12 minutes, until the edges are golden."],
          "nutrition": {"per": "serving", "servings": 24, "source": "estimated", "rows": [
              {"label": "Calories", "value": "260 kcal"}, {"label": "Total fat", "value": "14 g"}, {"label": "Saturated fat", "value": "7 g"},
              {"label": "Cholesterol", "value": "36 mg"}, {"label": "Sodium", "value": "190 mg"}, {"label": "Carbohydrates", "value": "33 g"},
              {"label": "Fiber", "value": "1.5 g"}, {"label": "Sugar", "value": "21 g"}, {"label": "Protein", "value": "3 g"}]}}


COOK_SAMPLE = {"title": "Chicken Adobo", "servings": 4, "source": "",
               "ingredients": ["1 kg chicken thighs and drumsticks", "1/2 cup soy sauce", "1/3 cup cane vinegar", "1 cup water",
                               "8 cloves garlic, crushed", "3 pieces bay leaves", "1 teaspoon whole black peppercorns", "1 tablespoon brown sugar",
                               "2 tablespoons cooking oil"],
               "steps": ["Marinate the chicken in soy sauce and garlic for at least 30 minutes.",
                         "Heat oil in a pan and brown the chicken on all sides, about 5 minutes.",
                         "Add the marinade, water, bay leaves and peppercorns. Bring to a boil.",
                         "Pour in the vinegar and let it boil for 2 minutes without stirring.",
                         "Cover and simmer for 30 minutes until the chicken is tender.",
                         "Add the brown sugar and simmer uncovered for 10 minutes until the sauce thickens. Serve with rice."],
               "nutrition": {"per": "serving", "servings": 4, "source": "estimated", "rows": [
                   {"label": "Calories", "value": "480 kcal"}, {"label": "Total fat", "value": "30 g"}, {"label": "Saturated fat", "value": "8 g"},
                   {"label": "Cholesterol", "value": "190 mg"}, {"label": "Sodium", "value": "1900 mg"}, {"label": "Carbohydrates", "value": "8 g"},
                   {"label": "Fiber", "value": "0.5 g"}, {"label": "Sugar", "value": "4 g"}, {"label": "Protein", "value": "42 g"}]}}


def ensure_sample(kind="baking"):
    if not _load(kind)["recipes"]:
        save_recipe(COOK_SAMPLE if kind == "cooking" else SAMPLE, kind)


# ------------------------------------------------------------------ searching online (websites, YouTube, TikTok...)
def _kind_of(url):
    u = url.lower()
    return "YouTube" if ("youtube.com" in u or "youtu.be" in u) else "TikTok" if "tiktok.com" in u else \
        "Instagram" if "instagram.com" in u else "Facebook" if "facebook.com" in u else "Website"


def search_online(query, kind="baking", n=30):
    """Find recipes for `query` everywhere: YouTube videos, TikTok videos, Instagram posts and recipe websites.
    Returns [{title, url, site, type, snippet, thumb, channel, minutes}] - mixed so you see different places."""
    import web
    from concurrent.futures import ThreadPoolExecutor
    q = f"{query} recipe"

    def youtube():
        try:
            return [{"title": v["title"], "url": v["url"], "site": "youtube.com", "type": "YouTube", "channel": v.get("channel") or "",
                     "minutes": v.get("minutes"), "snippet": " · ".join(x for x in (v.get("channel"), f"{v['minutes']:g} min" if v.get("minutes") else "") if x),
                     "thumb": video_thumb(v["url"])} for v in web.youtube_search(q, 10)]
        except Exception:
            return []

    def site(where, kind_, must=None):
        out = []
        for extra in ("", " video"):
            try:
                for r in web.search(f"{q}{extra} site:{where}", n=10) or []:
                    url = r.get("url") or ""
                    if where in url and (not must or re.search(must, url)) and all(o["url"] != url for o in out):
                        out.append({"title": re.sub(r"\s+[|\-–]\s+[^|\-–]+$", "", r.get("title") or url)[:110], "url": url,
                                    "site": where, "type": kind_, "snippet": (r.get("snippet") or "")[:160], "thumb": ""})
            except Exception:
                pass
            if len(out) >= 6:
                break
        return out

    def websites():
        out = []
        for r in (web.search(q, n=12) or []) + (web.search(f"easy {q}", n=8) or []):
            url = r.get("url") or ""
            if not url or any(h in url for h in SOCIAL + ("pinterest.",)) or any(o["url"] == url for o in out):
                continue
            out.append({"title": re.sub(r"\s+[|\-–]\s+[^|\-–]+$", "", r.get("title") or url)[:110], "url": url,
                        "site": re.sub(r"^www\.", "", re.sub(r"^https?://([^/]+).*$", r"\1", url)), "type": "Website",
                        "snippet": (r.get("snippet") or "")[:180], "thumb": ""})
        return out

    with ThreadPoolExecutor(4) as pool:
        yt, tt, ig, ws = pool.map(lambda f: f(), [youtube, lambda: site("tiktok.com", "TikTok", r"/video/|/photo/|vm\.tiktok"),
                                                  lambda: site("instagram.com", "Instagram", r"/(?:p|reel)/"), websites])
    with ThreadPoolExecutor(6) as pool:                   # TikTok thumbnails (so you see the food)
        for item, th in zip(tt, pool.map(lambda x: video_thumb(x["url"]), tt)):
            item["thumb"] = th
    buckets, out = [yt, tt, ws, ig], []
    while any(buckets) and len(out) < n:
        for b in buckets:
            if b:
                out.append(b.pop(0))
    return out


# ------------------------------------------------------------------ pictures for the recipe cards
def _og_image(page):
    m = re.search(r'<meta[^>]+(?:property|name)="(?:og:image|twitter:image)(?::src)?"[^>]+content="([^"]+)"', page or "") \
        or re.search(r'<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="og:image"', page or "")
    import html as H
    return H.unescape(m.group(1)) if m else ""


def find_image(rid, kind="baking"):
    """A photo for a recipe that has none: the original page's picture, or the first recipe page found for its name."""
    r = get_recipe(rid, kind)
    if not r:
        return {"error": "Recipe not found."}
    if r.get("image") and (r.get("image_v") or not any(h in r.get("source", "") for h in SOCIAL)):
        r["image_v"] = 2
        return save_recipe(r, kind)
    r["image"] = ""
    src = r.get("source") or ""
    if any(h in src for h in SOCIAL):
        r["image"] = video_thumb(src)
    urls = [] if r["image"] or any(h in src for h in SOCIAL) else ([src] if src else [])
    try:
        import web
        urls += [x.get("url") for x in web.search(f"{r['title']} recipe", n=6)
                 if x.get("url") and not any(h in x["url"] for h in ("youtube.", "tiktok.", "instagram.", "facebook."))]
    except Exception:
        pass
    for u in ([] if r["image"] else urls[:5]):
        try:
            page = requests.get(u, headers=UA, timeout=10).text
            img = _og_image(page)
            if img.startswith("http"):
                r["image"] = img
                break
        except Exception:
            continue
    r["image_tried"] = True
    r["image_v"] = 2
    return save_recipe(r, kind)


# ------------------------------------------------------------------ video thumbnails (the real picture of the food)
SOCIAL = ("tiktok.com", "youtube.com", "youtu.be", "instagram.com", "facebook.com")


def _yt_id(url):
    m = re.search(r"(?:v=|youtu\.be/|/shorts/|/embed/)([\w-]{11})", url or "")
    return m.group(1) if m else None


def video_thumb(url):
    """The video's own thumbnail (TikTok/YouTube pages share a generic logo picture, not the food)."""
    vid = _yt_id(url)
    if vid:
        return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    if "tiktok.com" in (url or ""):
        try:
            d = requests.get("https://www.tiktok.com/oembed", params={"url": url}, headers=UA, timeout=10).json()
            return d.get("thumbnail_url", "")
        except Exception:
            return ""
    return ""
