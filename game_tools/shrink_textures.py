"""
shrink_textures.py - makes the game's texture copies smaller so loading every model at the start fits in memory.

Big 2048x2048 / 4096x4096 texture sheets (shared by hundreds of megakit models) are resized to at most 1024
pixels. Only the copies in ui/game/assets are changed - your original dnd folder is never touched.
A 1024 texture uses 4x less memory than a 2048 one; on these stylized models you can't see the difference.

Run:  python game_tools/shrink_textures.py          (needs Pillow: pip install pillow)
      python game_tools/shrink_textures.py --check  (only report)
"""
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "ui", "game", "assets")
MAX = 1024


def main():
    from PIL import Image
    check = "--check" in sys.argv
    n = saved = 0
    for d, _, names in os.walk(ROOT):
        for name in names:
            if not name.lower().endswith((".png", ".jpg", ".jpeg")):
                continue
            p = os.path.join(d, name)
            with Image.open(p) as im:
                w, h = im.size
                if max(w, h) <= MAX:
                    continue
                n += 1
                saved += (w * h - (MAX * MAX)) * 4
                if check:
                    print(f"would shrink {name} {w}x{h}")
                    continue
                k = MAX / max(w, h)
                small = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
                small.load()
            tmp = p + ".tmp" + os.path.splitext(p)[1]
            if name.lower().endswith(".png"):
                small.save(tmp, optimize=True)
            else:
                small.save(tmp, quality=90)
            os.replace(tmp, p)
    print(f"{'Would shrink' if check else 'Shrank'} {n} textures (about {saved / 1e6:.0f} MB less memory when loaded).")


if __name__ == "__main__":
    main()
