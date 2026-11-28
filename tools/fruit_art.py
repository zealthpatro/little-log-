#!/usr/bin/env python3
"""Bake the week's fruit paintings: art-src/fruit/<slug>.png -> app/fruit-art/<slug>.webp.

The paintings (founder, 28 Nov 2026: "vibrant and better than the emojis") come from gpt-image-2,
which refuses transparent output, so each is painted on pure white with a soft contact shadow
beneath it. The app shows them on the pink Home card in Light and on a near-black card in Night,
so both have to go:

- The white ground is found by growing inwards from the border through pale, low-colour pixels
  only, so a fruit's own highlight (the glint on a lime) is never reached. tools/cutout_white.py
  does the same for the spot art but keeps the shadow, which is fine on cream and a beige smear on
  dark.
- The shadow is the part of that grown region that is not pure white, plus anything pale and
  low-colour in the bottom quarter of the subject. It is repainted as a dark, translucent shadow,
  so it reads as a shadow on either ground instead of as a patch of paper.

Then the subject is cropped square with a small margin and saved as a 320 px WebP: sharp at the
size sheet's 148 points on a 2x phone. Quality starts at 80 and steps down until the file is at most
24 KB, inside tools/preg_fruit_check.js's 28 KB budget.

  /usr/bin/python3 tools/fruit_art.py art-src/fruit app/fruit-art [slug ...]
"""
import os
import sys
import numpy as np
from PIL import Image, ImageFilter

SIZE, QUALITY, MIN_QUALITY = 320, 80, 40
BUDGET = 24 * 1024   # under tools/preg_fruit_check.js's 28 KB per painting, with room to spare


def _grow(region, allowed):
    while True:
        g = region.copy()
        g[1:] |= region[:-1]; g[:-1] |= region[1:]; g[:, 1:] |= region[:, :-1]; g[:, :-1] |= region[:, 1:]
        g &= allowed
        if g.sum() == region.sum():
            return g
        region = g


# Subjects painted in white or cream: see the strict branch in bake().
STRICT = {'cauliflower', 'leek'}


def bake(src, dst, strict=False):
    a = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255
    mx, mn = a.max(2), a.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    lum = a @ np.array([.299, .587, .114], np.float32)
    white = mn > 0.93
    ys = np.where((~white).any(1))[0]
    y0, y1 = ys.min(), ys.max()
    low = np.arange(a.shape[0])[:, None] > y0 + 0.72 * (y1 - y0)
    if strict:
        # A white or cream subject (cauliflower florets, a leek's base) touches the
        # ground with no outline, so growing through "pale" walks straight into it. Grow through true
        # white only, and treat only the darker, low-colour band under the subject as shadow.
        white = mn > 0.975
        allowed = white | (low & (sat < 0.42) & (lum > 0.35) & (lum < 0.90))
    else:
        allowed = ((sat < 0.45) & (lum > 0.72)) | white | (low & (sat < 0.42) & (lum > 0.35))
    seed = np.zeros_like(white)
    seed[0, :] = seed[-1, :] = seed[:, 0] = seed[:, -1] = True
    ground = _grow(seed & white, allowed)
    shadow = ground & ~white

    alpha = np.ones(white.shape, np.float32)
    alpha[ground] = 0
    rgb = a.copy()
    rgb[shadow] = np.array([50, 38, 30]) / 255
    alpha[shadow] = (np.clip((1 - lum) / 0.30, 0, 1) * 0.38)[shadow]

    A = Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    im = Image.fromarray((rgb * 255).astype(np.uint8))
    im.putalpha(A)
    box = A.point(lambda v: 255 if v > 6 else 0).getbbox()
    im = im.crop(box)
    side = max(im.size)
    pad = int(side * 0.04)
    sq = Image.new('RGBA', (side + 2 * pad,) * 2, (0, 0, 0, 0))
    sq.paste(im, ((sq.size[0] - im.size[0]) // 2, (sq.size[1] - im.size[1]) // 2), im)
    out = sq.resize((SIZE, SIZE), Image.LANCZOS)
    # Busy paintings (a cauliflower's florets) compress worse: step the quality down until it fits.
    for q in range(QUALITY, MIN_QUALITY - 1, -4):
        out.save(dst, 'WEBP', quality=q, method=6)
        if os.path.getsize(dst) <= BUDGET:
            break
    return os.path.getsize(dst)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    slugs = sys.argv[3:] or sorted(f[:-4] for f in os.listdir(src_dir) if f.endswith('.png'))
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for s in slugs:
        n = bake(os.path.join(src_dir, s + '.png'), os.path.join(out_dir, s + '.webp'), s in STRICT)
        total += n
        print(f'  {s:18s} {n:6d} bytes')
    print(f'{len(slugs)} paintings, {total} bytes')


if __name__ == '__main__':
    main()
