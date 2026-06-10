#!/usr/bin/env python3
"""
Generate branded article images for Cubby.

Usage:
  python3 tools/gen_article_img.py \
      --slug baby-sleep-by-age \
      --title "Baby sleep by age and wakeful phases" \
      --age "0-12 months" \
      --theme "Sleep"

Outputs:
  og/articles/<slug>.png       1200x630  (Open Graph / social sharing)
  articles/<slug>/hero.png     1200x480  (in-article hero image)
"""

import argparse
import os
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Palette (matches Cubby's warm honey theme)
# ---------------------------------------------------------------------------
BG_TOP   = (252, 238, 217)   # #FCEED9 warm cream
BG_BOT   = (243, 215, 176)   # #F3D7B0 honey
OVERLAY  = (48,  33,  18, 210)  # near-black with alpha (for text stripe)
BEAR_BG  = (196, 134,  68)   # #C48644 caramel
BEAR_IN  = (246, 230, 206)   # muzzle/inner ear
BEAR_DK  = ( 71,  51,  39)   # eyes/nose
TEXT_W   = (255, 255, 255)
TEXT_D   = ( 55,  38,  24)   # dark brown for light areas
BADGE_BG = (255, 255, 255, 60)   # translucent white pill
ACCENT   = (220, 105,  50)   # warm terracotta

# ---------------------------------------------------------------------------
# Font paths (macOS system fonts; all confirmed present)
# ---------------------------------------------------------------------------
FONT_DIR   = "/System/Library/Fonts/Supplemental"
GEORGIA_B  = os.path.join(FONT_DIR, "Georgia Bold.ttf")
GEORGIA    = os.path.join(FONT_DIR, "Georgia.ttf")
ARIAL_B    = os.path.join(FONT_DIR, "Arial Bold.ttf")
ARIAL      = os.path.join(FONT_DIR, "Arial.ttf")


def _grad(draw, width, height, top, bot):
    """Vertical linear gradient."""
    for y in range(height):
        t = y / max(height - 1, 1)
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        draw.line([(0, y), (width, y)], fill=(r, g, b))


def _bear(img, cx, cy, radius):
    """Draw a Cubby bear-head icon (simplified from generate_icons.py)."""
    d = ImageDraw.Draw(img)

    def circ(x, y, r, fill):
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)

    # ears
    for ex in [cx - radius * 0.62, cx + radius * 0.62]:
        circ(ex, cy - radius * 0.72, radius * 0.34, BEAR_BG)
        circ(ex, cy - radius * 0.72, radius * 0.20, BEAR_IN)

    # head
    circ(cx, cy, radius, BEAR_BG)

    # muzzle
    circ(cx, cy + radius * 0.22, radius * 0.44, BEAR_IN)

    # eyes
    for ex in [cx - radius * 0.26, cx + radius * 0.26]:
        circ(ex, cy - radius * 0.12, radius * 0.10, BEAR_DK)

    # nose
    circ(cx, cy + radius * 0.10, radius * 0.08, BEAR_DK)


def _wrap_title(title, font, max_w, draw):
    """Word-wrap title to fit max_w pixels. Returns list of lines."""
    words = title.split()
    lines, cur = [], ""
    for w in words:
        test = (cur + " " + w).strip()
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _pill(img, x, y, text, font, padding=(18, 8), bg=(255, 255, 255, 55), fg=TEXT_W):
    """Draw a rounded-rectangle pill badge with text."""
    tmp = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d   = ImageDraw.Draw(tmp)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    px, py = padding
    rx0, ry0 = x, y
    rx1, ry1 = x + tw + px * 2, y + th + py * 2
    d.rounded_rectangle([rx0, ry0, rx1, ry1], radius=min(th, 14), fill=bg)
    d.text((rx0 + px - bbox[0], ry0 + py - bbox[1]), text, font=font, fill=fg)
    img.alpha_composite(tmp)
    return rx1  # right edge (for chaining badges)


def generate(slug, title, age, theme, out_dir):
    """Generate OG (1200x630) and hero (1200x480) images."""
    out_dir = Path(out_dir)

    og_path   = out_dir / "og" / "articles" / f"{slug}.png"
    hero_path = out_dir / "articles" / slug / "hero.png"
    og_path.parent.mkdir(parents=True, exist_ok=True)
    hero_path.parent.mkdir(parents=True, exist_ok=True)

    for (W, H, path) in [(1200, 630, og_path), (1200, 480, hero_path)]:
        img  = Image.new("RGBA", (W, H))
        base = Image.new("RGBA", (W, H))
        draw = ImageDraw.Draw(base)

        # --- gradient background ---
        _grad(draw, W, H, BG_TOP, BG_BOT)

        # --- subtle dot grid (decorative) ---
        dot_col = (196, 134, 68, 35)
        for gx in range(0, W, 36):
            for gy in range(0, H, 36):
                draw.ellipse([gx - 2, gy - 2, gx + 2, gy + 2], fill=dot_col)

        img.alpha_composite(base)

        # --- dark overlay band for title area ---
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        band_top = int(H * 0.28)
        band_bot = int(H * 0.82)
        od.rectangle([0, band_top, W, band_bot], fill=(35, 22, 12, 195))
        img.alpha_composite(overlay)

        draw = ImageDraw.Draw(img)

        # --- bear icon + wordmark top-left ---
        bear_r = 28
        bear_cx, bear_cy = 52, 48
        _bear(img, bear_cx, bear_cy, bear_r)

        try:
            font_brand = ImageFont.truetype(ARIAL_B, 26)
        except Exception:
            font_brand = ImageFont.load_default()
        draw.text((bear_cx + bear_r + 12, bear_cy - 13), "Cubby", font=font_brand, fill=TEXT_D)

        # --- URL bottom-right ---
        try:
            font_url = ImageFont.truetype(ARIAL, 20)
        except Exception:
            font_url = ImageFont.load_default()
        url_txt = "little-cubby.com"
        ub = draw.textbbox((0, 0), url_txt, font=font_url)
        draw.text((W - (ub[2] - ub[0]) - 36, H - 38), url_txt, font=font_url, fill=(200, 180, 155))

        # --- title ---
        title_max_w = int(W * 0.80)
        title_font_size = 68 if H >= 600 else 54
        try:
            font_title = ImageFont.truetype(GEORGIA_B, title_font_size)
        except Exception:
            font_title = ImageFont.load_default()

        # auto-shrink if too wide
        for fs in [title_font_size, title_font_size - 8, title_font_size - 16, 36]:
            try:
                font_title = ImageFont.truetype(GEORGIA_B, fs)
            except Exception:
                font_title = ImageFont.load_default()
            lines = _wrap_title(title, font_title, title_max_w, draw)
            if len(lines) <= 3:
                break

        line_h = fs + 10
        total_h = len(lines) * line_h
        ty = (band_top + band_bot) // 2 - total_h // 2

        for i, line in enumerate(lines):
            lb = draw.textbbox((0, 0), line, font=font_title)
            lw = lb[2] - lb[0]
            draw.text(((W - lw) // 2 - lb[0], ty + i * line_h - lb[1]),
                      line, font=font_title, fill=TEXT_W)

        # --- age + theme badges bottom of overlay ---
        try:
            font_badge = ImageFont.truetype(ARIAL_B, 20)
        except Exception:
            font_badge = ImageFont.load_default()

        badge_y = band_bot + 16
        bx = 48
        bx = _pill(img, bx, badge_y, age,   font_badge, bg=(220, 105, 50, 200),  fg=TEXT_W) + 12
        _pill(img,  bx, badge_y, theme, font_badge, bg=(196, 134, 68, 200), fg=TEXT_W)

        # --- save as RGB PNG ---
        final = Image.new("RGB", (W, H), (252, 238, 217))
        final.paste(img, mask=img.split()[3])
        final.save(path, "PNG", optimize=True)
        print(f"  wrote {path}")


def main():
    ap = argparse.ArgumentParser(description="Generate Cubby article images")
    ap.add_argument("--slug",  required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--age",   required=True)
    ap.add_argument("--theme", required=True)
    ap.add_argument("--out",   default=".", help="Repo root directory")
    args = ap.parse_args()
    generate(args.slug, args.title, args.age, args.theme, args.out)
    print("Done.")


if __name__ == "__main__":
    main()
