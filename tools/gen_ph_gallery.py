#!/usr/bin/env python3
"""Generate Product Hunt gallery images for Cubby (1270x760), on-brand, no auth needed.
Each card: text column on the left, a drawn phone mock of the relevant app screen on the right."""
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1270, 760
BG_TOP, BG_BOT = (252, 238, 217), (243, 215, 176)
BEAR_BG, BEAR_IN, BEAR_DK = (196, 134, 68), (246, 230, 206), (71, 51, 39)
INK, INK_SOFT, INK_FAINT = (44, 37, 33), (110, 99, 91), (168, 156, 144)
WHITE = (255, 255, 255)
LINE = (231, 222, 207)
PINK = (201, 127, 160)
# category colors (match the app)
CAT = {
    "feed": ((226, 154, 59), (251, 234, 208)),
    "sleep": ((94, 106, 168), (227, 228, 244)),
    "diaper": ((86, 160, 142), (221, 240, 234)),
    "pump": ((201, 127, 160), (247, 227, 236)),
    "star": ((217, 162, 27), (246, 236, 203)),
}
FD = "/System/Library/Fonts/Supplemental"
def font(name, sz):
    for p in (os.path.join(FD, name), os.path.join("/Library/Fonts", name)):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()
SERIF = lambda s: font("Georgia Bold.ttf", s)
SANS = lambda s: font("Arial.ttf", s)
SANSB = lambda s: font("Arial Bold.ttf", s)

def grad(d):
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))

def dots(d):
    for gx in range(0, W, 38):
        for gy in range(0, H, 38):
            d.ellipse([gx - 2, gy - 2, gx + 2, gy + 2], fill=(196, 134, 68, 0))

def bear(img, cx, cy, r):
    d = ImageDraw.Draw(img)
    def circ(x, y, rr, f): d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=f)
    for ex in (cx - r * 0.62, cx + r * 0.62):
        circ(ex, cy - r * 0.72, r * 0.34, BEAR_BG); circ(ex, cy - r * 0.72, r * 0.20, BEAR_IN)
    circ(cx, cy, r, BEAR_BG); circ(cx, cy + r * 0.22, r * 0.44, BEAR_IN)
    for ex in (cx - r * 0.26, cx + r * 0.26): circ(ex, cy - r * 0.12, r * 0.10, BEAR_DK)
    circ(cx, cy + r * 0.10, r * 0.085, BEAR_DK)

def wrap(d, text, fnt, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textbbox((0, 0), t, font=fnt)[2] <= maxw: cur = t
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def rrect(d, box, r, **kw): d.rounded_rectangle(box, radius=r, **kw)

def phone(img, x, y, w, h, screen_fn):
    d = ImageDraw.Draw(img)
    rrect(d, [x, y, x + w, y + h], 46, fill=(28, 23, 20))
    sx, sy, sw, sh = x + 12, y + 12, w - 24, h - 24
    # screen background (warm light gradient)
    scr = Image.new("RGB", (sw, sh), (251, 245, 233))
    sd = ImageDraw.Draw(scr)
    for yy in range(sh):
        t = yy / sh
        sd.line([(0, yy), (sw, yy)], fill=tuple(int((251, 245, 233)[i] + ((239, 224, 200)[i] - (251, 245, 233)[i]) * t) for i in range(3)))
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, sw, sh], radius=34, fill=255)
    img.paste(scr, (sx, sy), mask)
    # notch
    d.rounded_rectangle([x + w / 2 - 32, y + 7, x + w / 2 + 32, y + 12], radius=3, fill=(255, 255, 255, 60))
    screen_fn(d, sx, sy, sw, sh)

def card(d, x, y, w, h, lines, accent=None):
    rrect(d, [x, y, x + w, y + h], 22, fill=WHITE, outline=LINE, width=2)
    tx = x + 22
    if accent:
        d.ellipse([x + 18, y + 20, x + 32, y + 34], fill=accent)
        tx = x + 44
    cy = y + 16
    for i, (txt, fnt, col) in enumerate(lines):
        d.text((tx, cy), txt, font=fnt, fill=col); cy += fnt.size + 8

def header(d, sx, sy, sw, title):
    d.rounded_rectangle([sx + 22, sy + 24, sx + 50, sy + 52], radius=9, fill=(247, 224, 198))
    d.text((sx + 60, sy + 28), title, font=SERIF(22), fill=INK)

# ---- screen renderers ----
def scr_home(d, sx, sy, sw, sh):
    header(d, sx, sy, sw, "Good evening, Papa Bear")
    card(d, sx + 22, sy + 74, sw - 44, 150,
         [("Nap in progress", SANSB(22), INK), ("1h 12m", SERIF(46), CAT["sleep"][0]),
          ("started 7:48 PM · by Mama Bear", SANS(19), INK_SOFT)], accent=CAT["sleep"][0])
    rrect(d, [sx + 22, sy + 238, sx + sw - 22, sy + 300], 18, fill=CAT["sleep"][0])
    d.text((sx + sw/2 - 44, sy + 257), "Wake up", font=SANSB(24), fill=WHITE)
    card(d, sx + 22, sy + 318, sw - 44, 96,
         [("Bottle · 120 ml", SANSB(22), INK), ("5:30 PM · by Nanny", SANS(19), INK_SOFT)], accent=CAT["feed"][0])

def scr_circle(d, sx, sy, sw, sh):
    header(d, sx, sy, sw, "Family & sharing")
    people = [("M", CAT["pump"][0], "Mama Bear", "Mother"),
              ("P", CAT["sleep"][0], "Papa Bear", "Father · you"),
              ("N", CAT["diaper"][0], "Nanny", "Nanny"),
              ("G", CAT["feed"][0], "Grandma", "Grandparent")]
    yy = sy + 80
    for ini, col, nm, role in people:
        d.ellipse([sx + 24, yy, sx + 66, yy + 42], fill=col)
        d.text((sx + 38, yy + 8), ini, font=SANSB(22), fill=WHITE)
        d.text((sx + 80, yy + 2), nm, font=SANSB(21), fill=INK)
        d.text((sx + 80, yy + 26), role, font=SANS(18), fill=INK_SOFT)
        yy += 62
    d.text((sx + 24, yy + 8), "Everyone sees the same log, the moment it happens", font=SANS(18), fill=INK_FAINT)

def scr_vax(d, sx, sy, sw, sh):
    header(d, sx, sy, sw, "Vaccines")
    rows = [("6-in-1 · 1st dose", "8 weeks", True),
            ("Rotavirus · 1st dose", "8 weeks", True),
            ("MenB · 1st dose", "12 weeks", False),
            ("PCV · 1st dose", "16 weeks", False),
            ("MMR · 1st dose", "1 year", False)]
    yy = sy + 80
    for nm, age, done in rows:
        rrect(d, [sx + 22, yy, sx + sw - 22, yy + 58], 16, fill=WHITE, outline=LINE, width=2)
        col = CAT["diaper"][0] if done else CAT["feed"][0]
        d.ellipse([sx + 36, yy + 20, sx + 56, yy + 40], fill=col)
        if done: d.line([(sx + 40, yy + 30), (sx + 44, yy + 35), (sx + 52, yy + 24)], fill=WHITE, width=3)
        d.text((sx + 70, yy + 9), nm, font=SANSB(20), fill=INK)
        d.text((sx + 70, yy + 32), age, font=SANS(17), fill=INK_SOFT)
        yy += 68

def scr_log(d, sx, sy, sw, sh):
    header(d, sx, sy, sw, "Add to the day")
    tiles = [("Feed", "feed"), ("Sleep", "sleep"), ("Nappy", "diaper"), ("Pump", "pump")]
    tw, th, gap = (sw - 66) // 2, 150, 22
    for i, (lbl, c) in enumerate(tiles):
        col, soft = CAT[c]
        tx = sx + 22 + (i % 2) * (tw + gap)
        ty = sy + 80 + (i // 2) * (th + gap)
        rrect(d, [tx, ty, tx + tw, ty + th], 26, fill=WHITE, outline=LINE, width=2)
        rrect(d, [tx + 24, ty + 26, tx + 70, ty + 72], 15, fill=soft)
        d.ellipse([tx + 38, ty + 40, tx + 56, ty + 58], fill=col)
        d.text((tx + 26, ty + 96), lbl, font=SANSB(26), fill=INK)

def scr_moments(d, sx, sy, sw, sh):
    header(d, sx, sy, sw, "This month")
    # a soft "photo" block (rounded), then a memory caption card
    d.rounded_rectangle([sx + 24, sy + 78, sx + sw - 24, sy + 300], radius=24, fill=(214, 188, 224))
    cap = "3 months"
    bb = d.textbbox((0, 0), cap, font=SERIF(40))
    d.text((sx + sw / 2 - (bb[2] - bb[0]) / 2, sy + 168), cap, font=SERIF(40), fill=WHITE)
    card(d, sx + 22, sy + 318, sw - 44, 96,
         [("Mira · 3 months today", SANSB(21), INK), ("first giggle · rolled over", SANS(18), INK_SOFT)], accent=CAT["star"][0])

SLIDES = [
    ("hero", "BABY TRACKER", "Every feed, nap and vaccine, in one calm place.",
     "A warm, private baby log the whole family shares in real time. Free, no ads.", scr_home),
    ("care-circle", "SHARED, LIVE", "Everyone caring for your baby, in sync.",
     "Parents, grandparents and the nanny see the same live log, with who did what on every entry.", scr_circle),
    ("vaccines", "NEVER MISS A DOSE", "Your country's vaccine schedule, with reminders.",
     "12 countries plus a WHO default, each from the official source, with the dates worked out from your baby's birthday.", scr_vax),
    ("logging", "ONE-THUMB LOGGING", "Log the whole day in a single thumb.",
     "Feeds, sleep, nappies and pumping in a couple of taps, even half-asleep at 3am.", scr_log),
    ("keepsakes", "KEEPSAKES", "Turn the everyday into something to keep.",
     "Monthly memory cards and milestones from your real moments, on-device and private.", scr_moments),
]

def make(slug, eyebrow, headline, sub, screen_fn, outdir):
    img = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(img)
    grad(d)
    # brand top-left
    bear(img, 56, 52, 26)
    d = ImageDraw.Draw(img)
    d.text((92, 36), "Cubby", font=SERIF(30), fill=INK)
    d.text((W - 248, H - 44), "little-cubby.com", font=SANS(22), fill=INK_FAINT)
    # text column
    tx, tw = 70, 600
    d.text((tx, 180), eyebrow, font=SANSB(22), fill=PINK)
    y = 224
    for ln in wrap(d, headline, SERIF(58), tw):
        d.text((tx, y), ln, font=SERIF(58), fill=INK); y += 70
    y += 16
    for ln in wrap(d, sub, SANS(27), tw - 20):
        d.text((tx, y), ln, font=SANS(27), fill=INK_SOFT); y += 40
    # phone on the right
    phone(img, 770, 70, 420, 660, screen_fn)
    p = Path(outdir) / f"ph-{slug}.png"
    img.save(p)
    return p

if __name__ == "__main__":
    out = Path("og/producthunt"); out.mkdir(parents=True, exist_ok=True)
    for slug, eb, hl, sb, fn in SLIDES:
        print(make(slug, eb, hl, sb, fn, out))
