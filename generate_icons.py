#!/usr/bin/env python3
"""Generate Cubby's bear-cub app icons with Pillow (drawn, no external assets)."""
from PIL import Image, ImageDraw

SS = 4  # supersample for smooth edges

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# Warm honey palette pulled from the app's theme.
BG_TOP = (0xFC, 0xEE, 0xD9)
BG_BOT = (0xF3, 0xD7, 0xB0)
BODY   = (0xC4, 0x86, 0x44)   # caramel
INNER  = (0xF6, 0xE6, 0xCE)   # muzzle / inner ear
DARK   = (0x47, 0x33, 0x27)   # eyes / nose
CHEEK  = (0xE8, 0xA8, 0x92)   # faint blush

def make_icon(size, bear_scale=0.72, radius_frac=0.0):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # gradient background
    bg = Image.new('RGBA', (S, S))
    bd = ImageDraw.Draw(bg)
    for y in range(S):
        bd.line([(0, y), (S, y)], fill=lerp(BG_TOP, BG_BOT, y / (S - 1)) + (255,))
    if radius_frac > 0:
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius_frac), fill=255)
        img.paste(bg, (0, 0), mask)
    else:
        img.paste(bg, (0, 0))

    d = ImageDraw.Draw(img)
    cx, cy = S * 0.5, S * 0.545
    R = S * 0.5 * bear_scale * 0.64  # head radius

    def circle(x, y, r, fill):
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)

    # ears
    er = R * 0.46
    for sx in (-1, 1):
        ex, ey = cx + sx * R * 0.76, cy - R * 0.80
        circle(ex, ey, er, BODY)
        circle(ex, ey, er * 0.48, INNER)

    # head
    circle(cx, cy, R, BODY)

    # blush
    for sx in (-1, 1):
        circle(cx + sx * R * 0.66, cy + R * 0.30, R * 0.17, CHEEK)

    # muzzle
    mw, mh, my = R * 1.18, R * 0.94, cy + R * 0.32
    d.ellipse([cx - mw / 2, my - mh / 2, cx + mw / 2, my + mh / 2], fill=INNER)

    # eyes (+ highlight)
    ew = R * 0.12
    for sx in (-1, 1):
        ex, ey = cx + sx * R * 0.40, cy - R * 0.04
        circle(ex, ey, ew, DARK)
        circle(ex - ew * 0.32, ey - ew * 0.32, ew * 0.34, (255, 255, 255))

    # nose
    nw, nh, ny = R * 0.32, R * 0.24, cy + R * 0.12
    d.ellipse([cx - nw / 2, ny - nh / 2, cx + nw / 2, ny + nh / 2], fill=DARK)

    # mouth: little vertical drop + two soft curves
    lw = max(2, int(S * 0.014))
    d.line([cx, ny + nh / 2, cx, ny + R * 0.30], fill=DARK, width=lw)
    d.arc([cx - R * 0.26, ny + nh * 0.1, cx + 0, ny + R * 0.50], start=25, end=150, fill=DARK, width=lw)
    d.arc([cx + 0, ny + nh * 0.1, cx + R * 0.26, ny + R * 0.50], start=30, end=155, fill=DARK, width=lw)

    return img.resize((size, size), Image.LANCZOS)

jobs = [
    ('icons/icon-192.png', 192, 0.72, 0.0),
    ('icons/icon-512.png', 512, 0.72, 0.0),
    ('icons/icon-maskable-512.png', 512, 0.58, 0.0),
    ('icons/apple-touch-icon.png', 180, 0.72, 0.0),
    ('icons/favicon.png', 48, 0.78, 0.24),
    ('icons/logo-512.png', 512, 0.74, 0.24),  # rounded badge for the sign-in screen
]
for path, size, scale, rad in jobs:
    make_icon(size, scale, rad).save(path)
    print('wrote', path)
