#!/usr/bin/env python3
"""The painted Cubby face on every Pillow-made card, in place of the drawn bear.

WHY THIS EXISTS
Four generators drew the same little bear out of Pillow circles in the top-left corner of everything they
made: tools/gen_article_img.py (660 og/articles/*.png share cards, 571 articles/*/hero.png heroes, and the
og/{faq,features,pricing,articles}.png cards), tools/gen_ph_gallery.py (og/producthunt/*), and
tools/gen_pwa_screenshots.py (icons/screenshots/{track,circle,vaccines}.png). og/cubby-home.png carried the
flat June logo as a tile. On 2026-11-13 the founder retired every drawn bear for the painted master,
icons/icon-master-1024.png. The generators now call paste_logo(); this file also repairs the cards that
already exist, so the change is ONLY the logo: not one other pixel of those cards is re-rendered.

HOW THE REPAIR STAYS HONEST
Each card family is rebuilt from its own generator's recipe (gradient, dot grid, wash) over the bear's box
only. Before a card is touched, that rebuilt background is compared with the card's real pixels in a ring
around the box; if they differ by more than a rounding error the card is left alone and named, because
then the recipe is not the one that drew it. Then the box is painted with the rebuilt background and the
painted logo is composited where the bear was, at the same size.

Usage:
    python3 tools/card_logo.py --swap            repair every card that still has a drawn bear
    python3 tools/card_logo.py --check           fail if any card still has one (no writes)
"""
import argparse
import glob
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, 'icons', 'icon-master-1024.png')
CARAMEL = np.array([196, 134, 68])      # the drawn bear's fur, and the flat June logo's: #C48644
_cache = {}


def logo(size, radius=0.24):
    """The master, resized to `size`, corners rounded like icons/logo-512.png."""
    key = (size, radius)
    if key not in _cache:
        m = Image.open(MASTER).convert('RGB').resize((size, size), Image.LANCZOS)
        if size <= 64:
            m = m.filter(ImageFilter.UnsharpMask(radius=0.5, percent=40, threshold=1))
        ss = 4
        mask = Image.new('L', (size * ss, size * ss), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius=int(size * ss * radius), fill=255)
        out = m.convert('RGBA')
        out.putalpha(mask.resize((size, size), Image.LANCZOS))
        _cache[key] = out
    return _cache[key]


def paste_logo(img, cx, cy, size):
    """Composite the painted logo centred on (cx, cy). Works on RGB and RGBA images."""
    lg = logo(int(size))
    x, y = int(round(cx - lg.width / 2)), int(round(cy - lg.height / 2))
    if img.mode == 'RGBA':
        img.alpha_composite(lg, (x, y))
    else:
        img.paste(lg, (x, y), lg)
    return img


def caramel_count(img, box=None):
    a = np.asarray(img.convert('RGB').crop(box) if box else img.convert('RGB')).astype(int)
    return int((np.abs(a - CARAMEL).max(axis=2) <= 10).sum())


# ---------- the generators' own backgrounds ----------

def bg_article(w, h):
    """tools/gen_article_img.py: gradient, then a dot grid drawn at alpha 35 into an RGBA layer that is
    finally flattened onto BG_TOP (so the dots blend with BG_TOP, not with the gradient row)."""
    top, bot = (252, 238, 217), (243, 215, 176)
    img = Image.new('RGBA', (w, h))
    base = Image.new('RGBA', (w, h))
    d = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(h - 1, 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    for gx in range(0, w, 36):
        for gy in range(0, h, 36):
            d.ellipse([gx - 2, gy - 2, gx + 2, gy + 2], fill=(196, 134, 68, 35))
    img.alpha_composite(base)
    final = Image.new('RGB', (w, h), top)
    final.paste(img, mask=img.split()[3])
    return final


def bg_ph(w, h):
    top, bot = (252, 238, 217), (243, 215, 176)
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return img


def bg_pwa(w, h):
    top, bot = (252, 238, 217), (243, 215, 176)
    img = Image.new('RGB', (w, h), top)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    for gx in range(0, w, 54):
        for gy in range(0, h, 54):
            d.ellipse([gx - 3, gy - 3, gx + 3, gy + 3], fill=(196, 134, 68))
    wash = Image.new('RGBA', (w, h), (252, 238, 217, 150))
    return Image.alpha_composite(img.convert('RGBA'), wash).convert('RGB')


# family -> (files, background recipe, bear centre, logo size, box to rebuild)
def families():
    art = sorted(glob.glob(os.path.join(ROOT, 'og', 'articles', '*.png'))) \
        + sorted(glob.glob(os.path.join(ROOT, 'articles', '*', 'hero.png'))) \
        + [os.path.join(ROOT, 'og', n + '.png') for n in ('faq', 'features', 'pricing', 'articles')]
    return [
        ('article cards (gen_article_img.py)', art, bg_article, (52, 48), 56, (18, 12, 88, 84)),
        ('Product Hunt gallery (gen_ph_gallery.py)', sorted(glob.glob(os.path.join(ROOT, 'og', 'producthunt', '*.png'))),
         bg_ph, (56, 52), 54, (22, 16, 90, 88)),
        ('PWA promo cards (gen_pwa_screenshots.py)', [os.path.join(ROOT, 'icons', 'screenshots', n + '.png') for n in ('track', 'circle', 'vaccines')],
         bg_pwa, (96, 150), 100, (40, 90, 158, 206)),
    ]


HOME = os.path.join(ROOT, 'og', 'cubby-home.png')
HOME_TILE = (96, 92, 246, 242)   # the flat logo tile on the home share card, measured (150px)


def repair_home(img):
    """og/cubby-home.png has no generator in the tree. The tile sits on a smooth vertical gradient, so each
    row of the box is rebuilt by interpolating between the 6px just left and right of it."""
    a = np.asarray(img.convert('RGB')).astype(np.float64)
    x0, y0, x1, y1 = HOME_TILE
    pad = 3
    for y in range(y0 - pad, y1 + pad):
        left = a[y, x0 - pad - 6:x0 - pad].mean(0)
        right = a[y, x1 + pad:x1 + pad + 6].mean(0)
        n = (x1 + pad) - (x0 - pad)
        t = np.linspace(0, 1, n)[:, None]
        a[y, x0 - pad:x1 + pad] = left * (1 - t) + right * t
    out = Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8))
    return paste_logo(out, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0)


def run(swap):
    bad, done, refused = [], 0, []
    cache = {}
    for name, files, recipe, (cx, cy), size, box in families():
        for f in files:
            if not os.path.exists(f):
                continue
            im = Image.open(f)
            if caramel_count(im, box) < 150:
                continue                       # no drawn bear left in the box
            if not swap:
                bad.append(f)
                continue
            key = (recipe, im.size)
            if key not in cache:
                cache[key] = recipe(*im.size)
            bg = cache[key]
            x0, y0, x1, y1 = box
            ring = (x0 - 6, y0 - 6, x1 + 6, y1 + 6)
            real = np.asarray(im.convert('RGB').crop(ring)).astype(int)
            want = np.asarray(bg.crop(ring)).astype(int)
            m = np.ones(real.shape[:2], bool)
            m[6:-6, 6:-6] = False              # compare only the 6px ring OUTSIDE the box,
            m[:, -6:] = False                  # minus its right side, where the "Cubby" wordmark starts
            diff = np.abs(real - want)[m].max()
            if diff > 2:
                refused.append('%s (ring differs by %d: not drawn by this recipe)' % (os.path.relpath(f, ROOT), diff))
                continue
            out = im.convert('RGB')
            out.paste(bg.crop(box), box[:2])
            paste_logo(out, cx, cy, size)
            out.save(f, 'PNG', optimize=True)
            done += 1
    if os.path.exists(HOME):
        im = Image.open(HOME)
        if caramel_count(im, HOME_TILE) >= 150:
            if swap:
                repair_home(im).save(HOME, 'PNG', optimize=True)
                done += 1
            else:
                bad.append(HOME)
    return bad, done, refused


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--swap', action='store_true')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    if a.swap:
        _, done, refused = run(True)
        print('swapped the drawn bear for the painted logo on %d cards' % done)
        for r in refused:
            print('  LEFT ALONE %s' % r)
        if refused:
            sys.exit(1)
    bad, _, _ = run(False)
    for f in bad[:20]:
        print('  DRAWN BEAR still on %s' % os.path.relpath(f, ROOT))
    print('CARD LOGO: ' + ('FAIL (%d cards)' % len(bad) if bad else 'PASS (no drawn bear on any card)'))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
