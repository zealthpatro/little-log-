#!/usr/bin/env python3
"""The painted Cubby face on every Pillow-made card: the CURRENT master, and nothing else on them changed.

WHY THIS EXISTS
Four generators drew the same little bear out of Pillow circles in the top-left corner of everything they
made: tools/gen_article_img.py (660 og/articles/*.png share cards, 571 articles/*/hero.png heroes, and the
og/{faq,features,pricing,articles}.png cards), tools/gen_ph_gallery.py (og/producthunt/*), and
tools/gen_pwa_screenshots.py (icons/screenshots/{track,circle,vaccines}.png). og/cubby-home.png carried the
flat June logo as a tile. The social quote cards (social/out/*-quote.png, rendered from social/card-quote.html
by a browser at 2x) carry it in the footer on flat #F4EEE3, so they are a family here too (2026-11-14): a
change of master now reaches them without a browser. On 2026-11-13 the founder retired every drawn bear for the painted master,
icons/icon-master-1024.png, and on 2026-11-14 changed the master itself (the white cub on honey became the
W2+ teddy on a watercolour wash). The generators call paste_logo(); this file also repairs the cards that
already exist, so a change of logo is ONLY the logo: not one other pixel of those cards is re-rendered.

HOW THE REPAIR STAYS HONEST
Each card family is rebuilt from its own generator's recipe (gradient, dot grid, wash) over the logo's box
only. A card is current when its box is what that recipe plus the current master gives (within a rounding
error: fewer than 2% of the box's pixels off by more than 12 levels, so a card freshly drawn by the
generator itself counts too). Anything else in the box (the drawn bear, the June tile, the November white
cub) is stale. Before a stale card is touched, the rebuilt background is compared with the card's real
pixels in a ring around the box; if they differ by more than a rounding error the card is left alone and
named, because then the recipe is not the one that drew it. Then the box is painted with the rebuilt
background and the painted logo is composited at the same centre and size.

Usage:
    python3 tools/card_logo.py --swap            repair every card whose logo is not the current master's
    python3 tools/card_logo.py --swap --force    repaint EVERY card's logo box from the current master, current
                                                 or not (tools/brand.py set: a new master that differs from the
                                                 old one by less than the tolerance still reaches every card)
    python3 tools/card_logo.py --check           fail if any card's logo is not the current master's (no writes)
    python3 tools/card_logo.py --list            print every card this file looks after, one path per line
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


def paste_logo(img, cx, cy, size, radius=0.24):
    """Composite the painted logo centred on (cx, cy). Works on RGB and RGBA images."""
    lg = logo(int(size), radius)
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


def bg_flat(rgb):
    """social/card-quote.html: the footer sits on the card's flat --bg."""
    def recipe(w, h):
        return Image.new('RGB', (w, h), rgb)
    recipe.__name__ = 'bg_flat_%02x%02x%02x' % rgb
    return recipe


SOCIAL_BG = bg_flat((0xF4, 0xEE, 0xE3))


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
        # 88px .sq at left 96 / bottom 92 of a 1080x1350 card, rendered at 2x: the logo is (192,2338)-(367,2513),
        # measured on social/out/w1-mon-quote.png. Its baked 0.24 corner is wider than the 26px CSS clip, so the
        # visible corner is the logo's own.
        ('social quote cards (social/card-quote.html)', sorted(glob.glob(os.path.join(ROOT, 'social', 'out', '*-quote.png'))),
         SOCIAL_BG, (280, 2426), 176, (184, 2330, 376, 2522)),
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


def stale(box_px, want_px):
    """True when a card's logo box is not what the recipe plus the current master gives."""
    d = np.abs(np.asarray(box_px, dtype=int) - np.asarray(want_px, dtype=int)).max(axis=2)
    return (d > 12).mean() > 0.02


def expected_box(bg, box, centre, size):
    """The logo box as the current master draws it on this recipe's background."""
    x0, y0, x1, y1 = box
    tile = bg.crop(box).copy()
    paste_logo(tile, centre[0] - x0, centre[1] - y0, size)
    return tile


def all_cards():
    """Every card this file looks after, as paths relative to the tree (tools/brand.py counts and hashes them)."""
    out = [f for _, files, _, _, _, _ in families() for f in files if os.path.exists(f)]
    if os.path.exists(HOME):
        out.append(HOME)
    return [os.path.relpath(f, ROOT) for f in out]


def run(swap, force=False):
    bad, done, refused, current = [], 0, [], 0
    cache = {}
    for name, files, recipe, (cx, cy), size, box in families():
        for f in files:
            if not os.path.exists(f):
                continue
            im = Image.open(f).convert('RGB')
            key = (recipe, im.size)
            if key not in cache:
                bg = recipe(*im.size)
                cache[key] = (bg, expected_box(bg, box, (cx, cy), size))
            bg, want = cache[key]
            if not stale(im.crop(box), want) and not (force and swap):
                current += 1
                continue
            if not swap:
                bad.append(f)
                continue
            x0, y0, x1, y1 = box
            ring = (x0 - 6, y0 - 6, x1 + 6, y1 + 6)
            real = np.asarray(im.crop(ring)).astype(int)
            wantr = np.asarray(bg.crop(ring)).astype(int)
            m = np.ones(real.shape[:2], bool)
            m[6:-6, 6:-6] = False              # compare only the 6px ring OUTSIDE the box,
            m[:, -6:] = False                  # minus its right side, where the "Cubby" wordmark starts
            diff = np.abs(real - wantr)[m].max()
            if diff > 2:
                refused.append('%s (ring differs by %d: not drawn by this recipe)' % (os.path.relpath(f, ROOT), diff))
                continue
            im.paste(want, box[:2])
            im.save(f, 'PNG', optimize=True)
            done += 1
    if os.path.exists(HOME):
        im = Image.open(HOME).convert('RGB')
        want = repair_home(im)
        x0, y0, x1, y1 = HOME_TILE
        if stale(im.crop(HOME_TILE), want.crop(HOME_TILE)) or (force and swap):
            if swap:
                want.save(HOME, 'PNG', optimize=True)
                done += 1
            else:
                bad.append(HOME)
        else:
            current += 1
    return bad, done, refused, current


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--swap', action='store_true')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--list', action='store_true')
    a = ap.parse_args()
    if a.list:
        print('\n'.join(all_cards()))
        return
    if a.swap:
        _, done, refused, _ = run(True, a.force)
        print('swapped in the current master\'s logo on %d cards' % done)
        for r in refused:
            print('  LEFT ALONE %s' % r)
        if refused:
            sys.exit(1)
    bad, _, _, current = run(False)
    for f in bad[:20]:
        print('  OLD LOGO still on %s' % os.path.relpath(f, ROOT))
    print('CARD LOGO: ' + ('FAIL (%d cards carry a logo that is not the current master\'s)' % len(bad) if bad
                           else 'PASS (%d cards, every one carries the current master\'s logo)' % current))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
