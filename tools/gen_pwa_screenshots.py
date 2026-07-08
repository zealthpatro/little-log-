#!/usr/bin/env python3
"""Generate branded PWA install-card screenshots (phone, 1080x1920) for the
   web manifest. These show in Chrome/Edge's richer install UI and PWA
   directories (the PWA equivalent of app-store screenshots). On-brand promo
   cards (warm gradient + bear + a clean faux log card), not real auth'd UI."""
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

BG_TOP = (252, 238, 217)
BG_BOT = (243, 215, 176)
BEAR_BG = (196, 134, 68)
BEAR_IN = (246, 230, 206)
BEAR_DK = (71, 51, 39)
INK = (55, 38, 24)
SOFT = (122, 98, 74)
CARD = (255, 252, 247)
PINK = (214, 122, 122)
STAR = (210, 150, 60)

FONT_DIR = "/System/Library/Fonts/Supplemental"
SERIF_B = os.path.join(FONT_DIR, "Georgia Bold.ttf")
SANS_B = os.path.join(FONT_DIR, "Arial Bold.ttf")
SANS = os.path.join(FONT_DIR, "Arial.ttf")

W, H = 1080, 1920

SCREENS = [
    dict(file="track.png", head="One calm place for your baby",
         sub="Feeds, naps, nappies and growth, all in one warm log.",
         rows=[("🍼", "Feed", "left side, 12 min"), ("😴", "Nap", "1 hr 40 min"), ("🧷", "Nappy", "wet, just now")]),
    dict(file="vaccines.png", head="Your country's vaccine schedule",
         sub="UK, US, UAE, Germany and more, with gentle reminders.",
         rows=[("💉", "6-in-1 (1st dose)", "due in 4 days"), ("💉", "Rotavirus (1st)", "due in 4 days"), ("✅", "Hepatitis B", "done")]),
    dict(file="circle.png", head="Share with your whole circle",
         sub="Partner, grandparents and nanny, always in sync.",
         rows=[("🐻", "Mama Bear", "logged a feed"), ("🧸", "Papa Bear", "logged a nap"), ("👵", "Nana Bear", "added a photo")]),
]


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def grad(draw, top, bot):
    for y in range(H):
        t = y / (H - 1)
        draw.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))


def bear(img, cx, cy, r):
    d = ImageDraw.Draw(img)
    def circ(x, y, rr, fill):
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=fill)
    for ex in (cx - r * 0.62, cx + r * 0.62):
        circ(ex, cy - r * 0.72, r * 0.34, BEAR_BG)
        circ(ex, cy - r * 0.72, r * 0.20, BEAR_IN)
    circ(cx, cy, r, BEAR_BG)
    circ(cx, cy + r * 0.22, r * 0.44, BEAR_IN)
    for ex in (cx - r * 0.26, cx + r * 0.26):
        circ(ex, cy - r * 0.12, r * 0.10, BEAR_DK)
    circ(cx, cy + r * 0.10, r * 0.08, BEAR_DK)


def wrap(draw, text, ft, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textbbox((0, 0), test, font=ft)[2] <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def make(spec):
    img = Image.new("RGB", (W, H), BG_TOP)
    d = ImageDraw.Draw(img)
    grad(d, BG_TOP, BG_BOT)
    # dot grid
    for gx in range(0, W, 54):
        for gy in range(0, H, 54):
            d.ellipse([gx - 3, gy - 3, gx + 3, gy + 3], fill=(196, 134, 68))
    # soft wash over dots
    wash = Image.new("RGBA", (W, H), (252, 238, 217, 150))
    img = Image.alpha_composite(img.convert("RGBA"), wash).convert("RGB")
    d = ImageDraw.Draw(img)

    # brand row
    bear(img, 96, 150, 48)
    d.text((170, 116), "Cubby", font=font(SANS_B, 60), fill=INK)

    # headline
    fh = font(SERIF_B, 86)
    lines = wrap(d, spec["head"], fh, W - 160)
    y = 320
    for ln in lines:
        d.text((80, y), ln, font=fh, fill=INK)
        y += 104
    # sub
    fs = font(SANS, 42)
    for ln in wrap(d, spec["sub"], fs, W - 170):
        d.text((82, y + 16), ln, font=fs, fill=SOFT)
        y += 58

    # faux app card
    cx0, cy0, cx1 = 80, y + 90, W - 80
    card_h = 120 + len(spec["rows"]) * 150
    d.rounded_rectangle([cx0, cy0, cx1, cy0 + card_h], radius=44, fill=CARD)
    d.text((cx0 + 56, cy0 + 44), "Today", font=font(SANS_B, 40), fill=INK)
    ry = cy0 + 130
    for emoji, title, meta in spec["rows"]:
        # minimalist warm icon dot (PIL can't render colour emoji, so keep it clean)
        d.ellipse([cx0 + 48, ry, cx0 + 48 + 84, ry + 84], fill=(247, 226, 198))
        d.ellipse([cx0 + 74, ry + 26, cx0 + 74 + 32, ry + 26 + 32], fill=BEAR_BG)
        d.text((cx0 + 168, ry + 6), title, font=font(SANS_B, 40), fill=INK)
        d.text((cx0 + 168, ry + 56), meta, font=font(SANS, 34), fill=SOFT)
        ry += 150

    # footer wordmark
    fu = font(SANS, 34)
    url = "little-cubby.com  ·  no ads  ·  private to your family"
    ub = d.textbbox((0, 0), url, font=fu)
    d.text(((W - (ub[2] - ub[0])) // 2, H - 96), url, font=fu, fill=SOFT)

    out = OUT / spec["file"]
    img.save(out, "PNG", optimize=True)
    print(f"  wrote {out.relative_to(ROOT)}  ({W}x{H})")


def main():
    for s in SCREENS:
        make(s)
    print("Done.")


if __name__ == "__main__":
    main()
