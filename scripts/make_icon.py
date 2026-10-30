"""make_icon.py - draws Vermeil's icon: a glowing cyan V with one small star on a dark rounded square.
A simpler take on the detailed V icon (no rings, marks or text), so it still reads at 16 px on the desktop.

    python scripts/make_icon.py

Writes ui/vermeil.ico (desktop shortcut + window), ui/vermeil.png (512), ui/vermeil_1024.png, and the phone
app icons: android/.../mipmap-*/ic_launcher.png and phone-ios/.../icon-1024.png (full square, no see-through).
"""
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 2048                                   # drawn at 2x, then made smaller (smooth edges)
BG_TOP, BG_BOTTOM = (14, 26, 40), (4, 9, 16)
EDGE = (34, 211, 238)
V_TOP, V_BOTTOM = (165, 243, 252), (14, 165, 233)


def _gradient(size, top, bottom):
    g = Image.new("RGB", (1, 256))
    for y in range(256):
        t = y / 255
        g.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return g.resize(size, Image.BICUBIC)


def _v(scale, dx=0, dy=0):
    """the V: two blades meeting at the bottom tip, with a notch between them"""
    pts = [(540, 500), (760, 500), (1024, 1300), (1288, 500), (1508, 500), (1024, 1600)]
    return [(dx + (x - 1024) * scale + 1024, dy + (y - 1024) * scale + 1024) for x, y in pts]


def _star(cx, cy, r, inner):
    pts = []
    for i in range(8):
        rr = r if i % 2 == 0 else inner
        dx, dy = [(0, -1), (0.7, -0.7), (1, 0), (0.7, 0.7), (0, 1), (-0.7, 0.7), (-1, 0), (-0.7, -0.7)][i]
        pts.append((cx + dx * rr, cy + dy * rr))
    return pts


def draw(full_bleed=False, scale=1.0):
    """full_bleed: the whole square is background (phones round the corners themselves)"""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    box = (0, 0, S, S) if full_bleed else (128, 128, S - 128, S - 128)
    tile = Image.new("L", (S, S), 0)
    if full_bleed:
        tile.paste(255, box)
    else:
        ImageDraw.Draw(tile).rounded_rectangle(box, radius=400, fill=255)
    img.paste(_gradient((S, S), BG_TOP, BG_BOTTOM), (0, 0), tile)
    if not full_bleed:                                         # thin glowing edge
        edge = Image.new("L", (S, S), 0)
        ImageDraw.Draw(edge).rounded_rectangle(box, radius=400, outline=255, width=14)
        img.paste(Image.new("RGB", (S, S), EDGE), (0, 0), edge.point(lambda a: a * 0.75))

    v = Image.new("L", (S, S), 0)
    ImageDraw.Draw(v).polygon(_v(scale), fill=255)
    glow = v.filter(ImageFilter.GaussianBlur(70)).point(lambda a: a * 0.55)
    img.paste(Image.new("RGB", (S, S), EDGE), (0, 0), ImageChops.multiply(glow, tile))
    img.paste(_gradient((S, S), V_TOP, V_BOTTOM), (0, 0), v)
    right = Image.new("L", (S, S), 0)                          # the right blade a little lighter: a soft fold
    p = _v(scale)
    ImageDraw.Draw(right).polygon([p[2], p[3], p[4], p[5]], fill=70)
    img.paste((255, 255, 255), (0, 0), ImageChops.multiply(right, v))

    star = Image.new("L", (S, S), 0)
    cy = 1024 + (930 - 1024) * scale
    ImageDraw.Draw(star).polygon(_star(1024, cy, 120 * scale, 26 * scale), fill=255)
    img.paste((220, 250, 255), (0, 0), star.filter(ImageFilter.GaussianBlur(28)))
    img.paste((255, 255, 255), (0, 0), star)
    return img.resize((S // 2, S // 2), Image.LANCZOS)


def main():
    icon = draw()
    ui = os.path.join(ROOT, "ui")
    icon.save(os.path.join(ui, "vermeil_1024.png"))
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(ui, "vermeil.png"))
    icon.save(os.path.join(ui, "vermeil.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    phone = draw(full_bleed=True, scale=0.9)
    phone.convert("RGB").save(os.path.join(ROOT, "phone-ios", "Vermeil", "Assets.xcassets", "AppIcon.appiconset", "icon-1024.png"))
    res = os.path.join(ROOT, "android", "app", "src", "main", "res")
    for d, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        os.makedirs(os.path.join(res, f"mipmap-{d}"), exist_ok=True)
        icon.resize((px, px), Image.LANCZOS).save(os.path.join(res, f"mipmap-{d}", "ic_launcher.png"))
    print("Icons made: ui/vermeil.ico, ui/vermeil.png, ui/vermeil_1024.png, Android and iPhone app icons.")


if __name__ == "__main__":
    main()
