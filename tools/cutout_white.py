#!/usr/bin/env python3
"""Turn art painted on a white ground into a cut-out with a soft, honest edge.

Why this exists. gpt-image-2 refuses transparent output, so every piece in art-src/ is painted on
pure white (see docs/poster-art-brief.md). On the birth poster that is a feature: the canvas
composites with 'multiply', which drops white for free. In the APP it is a trap. The spot
illustrations sit on `--spot-paper`, which is a cream disc in Light and **transparent in Night**, so a
piece that still carries its white ground renders as a glaring white circle on a dark screen -- the
exact "headlight" the .es-bear comment in app/index.html warns about.

How it works, and why not a simple threshold. A threshold on whiteness eats the pale interior of
anything painted in cream. So the background is found by a flood fill inwards from the border through
near-white pixels only: enclosed pale areas (the inside of a balloon, the belly of a cub) are never
reached, and non-white islands (scattered stars) stop the fill and survive.

Edge pixels then get un-multiplied. A soft watercolour edge on white is the subject BLENDED with
white, so keeping it as-is leaves a pale halo that is invisible on cream and obvious on dark. Solving
C_src = a*C_out + (1-a)*255 for C_out gives back the paint and the edge reads correctly on any ground.

  python3 tools/cutout_white.py art-src/poster_hotair.png app/spot-art/offline_balloon.webp [--size 512]
"""
import sys
import numpy as np
from PIL import Image
from collections import deque

# A pixel is a background CANDIDATE at or above HI (essentially white) and gets a partial alpha
# between LO and HI. Below LO it is paint and is never touched. Measured against the generator's
# output, whose ground is a clean 255 and whose palest paint sits near 240.
HI, LO = 252, 236


def cutout(src, dst, size=512, report=True):
    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    h, w, _ = a.shape
    mn = a.min(axis=2)                     # min channel: 255 only for true white

    if report:
        print(f'  {src}  {w}x{h}')
        for t in (255, 252, 248, 244, 240, 236):
            print(f'    pixels with min channel >= {t}: {100.0 * (mn >= t).sum() / mn.size:5.1f}%')

    # Flood fill inwards from the border, through candidate pixels only.
    cand = mn >= LO
    bg = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not bg[y, x]:
                bg[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not bg[y, x]:
                bg[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True; q.append((ny, nx))

    # Alpha: opaque paint, transparent white, a ramp across the soft edge in between.
    alpha = np.full((h, w), 255.0)
    ramp = np.clip((HI - mn) / float(HI - LO), 0.0, 1.0) * 255.0
    alpha[bg] = ramp[bg]

    # Un-multiply the partially transparent edge so it is paint, not paint mixed with paper.
    out = a.astype(np.float32)
    soft = bg & (alpha > 0) & (alpha < 255)
    if soft.any():
        af = (alpha[soft] / 255.0)[:, None]
        out[soft] = np.clip((out[soft] - (1.0 - af) * 255.0) / af, 0, 255)

    rgba = np.dstack([out.astype(np.uint8), alpha.astype(np.uint8)])
    img = Image.fromarray(rgba, 'RGBA')
    if size and size != w:
        img = img.resize((size, size), Image.LANCZOS)
    img.save(dst, 'WEBP', quality=88, method=6, exact=True)
    if report:
        op = (np.asarray(img)[:, :, 3] > 250).mean() * 100
        print(f'  -> {dst}  {img.size}  opaque {op:.1f}%  transparent '
              f'{(np.asarray(img)[:, :, 3] < 5).mean() * 100:.1f}%')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(2)
    n = 512
    if '--size' in sys.argv:
        n = int(sys.argv[sys.argv.index('--size') + 1])
    cutout(sys.argv[1], sys.argv[2], n)
