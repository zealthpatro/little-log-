#!/usr/bin/env python3
"""Generate branded article images for Cubby (OG 1200x630 + hero 1200x480)."""

import argparse
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BG_TOP  = (252, 238, 217)
BG_BOT  = (243, 215, 176)
BEAR_BG = (196, 134,  68)
BEAR_IN = (246, 230, 206)
BEAR_DK = ( 71,  51,  39)
TEXT_W  = (255, 255, 255)
TEXT_D  = ( 55,  38,  24)

FONT_DIR = "/System/Library/Fonts/Supplemental"
GEORGIA_B = os.path.join(FONT_DIR, "Georgia Bold.ttf")
ARIAL_B   = os.path.join(FONT_DIR, "Arial Bold.ttf")
ARIAL     = os.path.join(FONT_DIR, "Arial.ttf")


def _grad(draw, W, H, top, bot):
    for y in range(H):
        t = y / max(H - 1, 1)
        draw.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))


def _bear(img, cx, cy, r):
    d = ImageDraw.Draw(img)
    def circ(x, y, rr, fill):
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=fill)
    for ex in [cx - r * 0.62, cx + r * 0.62]:
        circ(ex, cy - r * 0.72, r * 0.34, BEAR_BG)
        circ(ex, cy - r * 0.72, r * 0.20, BEAR_IN)
    circ(cx, cy, r, BEAR_BG)
    circ(cx, cy + r * 0.22, r * 0.44, BEAR_IN)
    for ex in [cx - r * 0.26, cx + r * 0.26]:
        circ(ex, cy - r * 0.12, r * 0.10, BEAR_DK)
    circ(cx, cy + r * 0.10, r * 0.08, BEAR_DK)


def _pill(img, x, y, text, font, bg=(220, 105, 50, 200), fg=TEXT_W, pad=(18, 8)):
    tmp = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    bb = d.textbbox((0, 0), text, font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    px, py = pad
    d.rounded_rectangle([x, y, x + tw + px*2, y + th + py*2], radius=min(th, 14), fill=bg)
    d.text((x + px - bb[0], y + py - bb[1]), text, font=font, fill=fg)
    img.alpha_composite(tmp)
    return x + tw + px * 2


def generate(slug, title, age, theme, out_dir):
    out = Path(out_dir)
    og_path   = out / "og" / "articles" / f"{slug}.png"
    hero_path = out / "articles" / slug / "hero.png"
    og_path.parent.mkdir(parents=True, exist_ok=True)
    hero_path.parent.mkdir(parents=True, exist_ok=True)

    for W, H, path in [(1200, 630, og_path), (1200, 480, hero_path)]:
        img  = Image.new("RGBA", (W, H))
        base = Image.new("RGBA", (W, H))
        draw = ImageDraw.Draw(base)
        _grad(draw, W, H, BG_TOP, BG_BOT)

        # dot grid
        for gx in range(0, W, 36):
            for gy in range(0, H, 36):
                draw.ellipse([gx-2, gy-2, gx+2, gy+2], fill=(196, 134, 68, 35))
        img.alpha_composite(base)

        # dark title band
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(ov).rectangle([0, int(H*.28), W, int(H*.82)], fill=(35, 22, 12, 195))
        img.alpha_composite(ov)

        draw = ImageDraw.Draw(img)
        _bear(img, 52, 48, 28)
        try:
            font_brand = ImageFont.truetype(ARIAL_B, 26)
        except Exception:
            font_brand = ImageFont.load_default()
        draw.text((92, 35), "Cubby", font=font_brand, fill=TEXT_D)

        try:
            font_url = ImageFont.truetype(ARIAL, 20)
        except Exception:
            font_url = ImageFont.load_default()
        url = "little-cubby.com"
        ub = draw.textbbox((0, 0), url, font=font_url)
        draw.text((W - (ub[2]-ub[0]) - 36, H - 38), url, font=font_url, fill=(200, 180, 155))

        # title
        band_top, band_bot = int(H * .28), int(H * .82)
        title_max_w = int(W * .80)
        for fs in [68, 58, 48, 38]:
            try:
                ft = ImageFont.truetype(GEORGIA_B, fs if H >= 600 else max(fs-10, 30))
            except Exception:
                ft = ImageFont.load_default()
            words, lines, cur = title.split(), [], ""
            for w in words:
                test = (cur + " " + w).strip()
                if draw.textbbox((0,0), test, font=ft)[2] <= title_max_w:
                    cur = test
                else:
                    if cur: lines.append(cur)
                    cur = w
            if cur: lines.append(cur)
            if len(lines) <= 3:
                break

        lh = fs + 10
        ty = (band_top + band_bot) // 2 - len(lines) * lh // 2
        for i, line in enumerate(lines):
            lb = draw.textbbox((0, 0), line, font=ft)
            draw.text(((W - (lb[2]-lb[0])) // 2 - lb[0], ty + i*lh - lb[1]), line, font=ft, fill=TEXT_W)

        try:
            fb = ImageFont.truetype(ARIAL_B, 20)
        except Exception:
            fb = ImageFont.load_default()
        bx = 48
        bx = _pill(img, bx, band_bot + 16, age,   fb, bg=(220, 105, 50, 200)) + 12
        _pill(img, bx, band_bot + 16, theme, fb, bg=(196, 134, 68, 200))

        final = Image.new("RGB", (W, H), BG_TOP)
        final.paste(img, mask=img.split()[3])
        final.save(path, "PNG", optimize=True)
        print(f"  {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug",  required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--age",   required=True)
    ap.add_argument("--theme", required=True)
    ap.add_argument("--out",   default=".")
    args = ap.parse_args()
    generate(args.slug, args.title, args.age, args.theme, args.out)
    print("Done.")

if __name__ == "__main__":
    main()
