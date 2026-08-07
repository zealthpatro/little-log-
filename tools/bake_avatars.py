#!/usr/bin/env python3
"""Bakes the painted avatar portraits (and the four repainted spot-art cubs) from the
1024px Layer-1 sources in art-src/ down to the sizes the app actually renders.

  python3 tools/bake_avatars.py

Two different treatments, and the difference is deliberate:

* AVATARS keep their painted paper (opaque WebP). An avatar is a disc-framed portrait,
  so the disc has to be filled in both themes -- unlike the spot-art empty states, where
  a 132px cream disc floating on a dark page was the bug that commit 5a13dd9 fixed by
  cutting the paper out. This is the same call already made for welcome_cub and
  invite_bears: where the art IS the tile, the baked paper stays. Keeping it also keeps
  the paper grain and the bear's soft cast shadow, which a flat CSS fill throws away,
  and it matches what the app does today (the old SVG bear drew its own opaque
  lighten(fur,.74) disc in both themes, and photo avatars are full-brightness in night).
  Cutting these was tried and measured first: cream fur on cream paper mattes badly, and
  at 40px the cutout speckled on cream and cocoa and lost its disc entirely in night.

* SPOT ART stays cut out, because --spot-paper puts the cream back in light and night
  deliberately leaves the cub with no tile at all. Those three are re-cut here with the
  matte below so the repaints drop straight into the treatment already shipped.

The matte is texture-aware, which is the only reason it works on a cream cub painted on
cream paper: a plain colour threshold cannot separate them (their values overlap), so a
max-filter over the distance-from-paper map is used instead. Any pixel with ink anywhere
in its neighbourhood counts as art, which turns the fur's pencil hatching into a solid
silhouette; the paper, being smooth, stays under the threshold. The dilation that costs
is given back by an equal erosion, then the edge is feathered.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art-src')
AV_OUT = os.path.join(ROOT, 'app', 'avatars')
SPOT_OUT = os.path.join(ROOT, 'app', 'spot-art')

# 12 adults x (6 fur tones x 2 poses) + 6 cubs, one per tone. Slugs are the contract with
# app/cubby-extras.js -- renaming one here silently breaks every avatar that resolves to it.
ADULTS = ['av-cream-a', 'av-cream-b', 'av-oat-a', 'av-oat-b', 'av-honey-a', 'av-honey-b',
          'av-cinnamon-a', 'av-cinnamon-b', 'av-cocoa-a', 'av-cocoa-b', 'av-ash-a', 'av-ash-b']
CUBS = ['cub-cream', 'cub-oat', 'cub-honey', 'cub-cinnamon', 'cub-cocoa', 'cub-ash']

AV_SIZE = 384      # covers the 110px picker at 3x with room for the 240px keepsake raster
AV_QUALITY = 82
SPOT_SIZE = 512    # matches the spot-art cubs already shipped
SPOT_QUALITY = 82

# The four cubs repainted into the library hand. welcome_cub is the sign-in logo: it is
# presented as a shadowed tile on a hardcoded-light screen, so its paper IS the tile and
# it is NOT cut (same as invite_bears).
SPOTS = [('spot_welcome_cub', 'welcome_cub', False),
         ('spot_moments_cub', 'moments_cub', True),
         ('spot_reading_cub', 'reading_cub', True),
         ('spot_caughtup_cub', 'caughtup_cub', True)]


def cut_paper(im, tol=7, win=11, feather=1.8, despeckle=0.00008):
    """Alpha-matte the painted paper away. See the module docstring for why this is
    morphological rather than a colour threshold."""
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32)
    h, w, _ = a.shape
    ring = np.concatenate([a[0:6].reshape(-1, 3), a[-6:].reshape(-1, 3),
                           a[:, 0:6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    paper = np.median(ring, axis=0)
    dist = np.abs(a - paper).max(axis=2)
    near = ndimage.maximum_filter(dist, size=win) <= tol

    # Only paper that reaches the frame edge is background; an enclosed cream shape (the
    # inside of the picture frame, a gap under a paw) is part of the picture and stays.
    border = np.zeros((h, w), bool)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    lab, _ = ndimage.label(near)
    ids = np.unique(lab[border & near])
    ids = ids[ids > 0]
    filled = ndimage.binary_erosion(np.isin(lab, ids), iterations=win // 2)

    keep = ~filled
    # Paper grain occasionally spikes past the threshold and survives as confetti.
    lab2, n2 = ndimage.label(keep)
    if n2:
        sizes = ndimage.sum(keep, lab2, range(1, n2 + 1))
        tiny = [i + 1 for i, s in enumerate(sizes) if s < despeckle * h * w]
        if tiny:
            keep = keep & ~np.isin(lab2, tiny)

    alpha = Image.fromarray(keep.astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(feather))
    out = im.copy()
    out.putalpha(alpha)
    return out


def load(name):
    path = os.path.join(SRC, name + '.png')
    if not os.path.exists(path):
        return None
    return Image.open(path).convert('RGB')


def main():
    os.makedirs(AV_OUT, exist_ok=True)
    missing = []
    done = 0

    for slug in ADULTS + CUBS:
        im = load(os.path.join('avatars', slug))
        if im is None:
            missing.append(slug)
            continue
        im = im.resize((AV_SIZE, AV_SIZE), Image.LANCZOS)
        im.save(os.path.join(AV_OUT, slug + '.webp'), 'WEBP', quality=AV_QUALITY, method=6)
        done += 1

    spots = 0
    for src, out, cut in SPOTS:
        im = load(src)
        if im is None:
            missing.append(src)
            continue
        im = cut_paper(im) if cut else im
        im = im.resize((SPOT_SIZE, SPOT_SIZE), Image.LANCZOS)
        im.save(os.path.join(SPOT_OUT, out + '.webp'), 'WEBP', quality=SPOT_QUALITY, method=6)
        spots += 1

    print('baked %d avatars -> app/avatars/*.webp' % done)
    print('baked %d spot cubs -> app/spot-art/*.webp' % spots)
    if missing:
        print('MISSING art-src: ' + ', '.join(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
