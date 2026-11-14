#!/usr/bin/env python3
"""Change Cubby's logo in a handful of commands. docs/BRAND.md is the one-page version of this.

WHY THIS EXISTS
On 2026-11-14 the logo changed from the white cub to the W2+ teddy. It took a dozen manual steps and three
restarts: generate candidates, render them at 180/60/40/29/16px on light and dark wallpaper, on a home
screen, in the site's top bar and a browser tab, measure fur against background and small-size detail, pick,
crop, then regenerate every icon, card and native asset and re-pin the registry. The founder: "next time if
I want to do something like this it should be simpler... let's try and make such things modular please."
This file is that flow, one subcommand per step:

    python3 tools/brand.py propose --ref REF.png --variants v.json [--dry-run]   candidates (gpt-image-2)
    python3 tools/brand.py compare a.png b.png [--names A B] [--out DIR]           look and measure
    python3 tools/brand.py zoom b.png --subject-width 87 --out b87.png            optional: make it bigger
    python3 tools/brand.py set b87.png --provenance "..."                         what WOULD change
    python3 tools/brand.py set b87.png --provenance "..." --yes                   change it, with a proof
    python3 tools/brand.py --self-test                                            tools/gates.js runs this

compare   sizes.png (512 to 16px on light and dark), homescreen.png (60px between neutral app tiles on a
          blue-grey and a dark wallpaper), web.png (the top bar beside the real wordmark at 1x, 2x and 3x, and
          the browser-tab favicon at 16 and 32px), context-light.png (white and the site's cream), metrics.json
          and compare.html, which shows them with the numbers in one table. The current master is the first
          column unless --no-current. Same inputs, same bytes. Every number is defined in METRICS below.
propose   writes a jobs file for tools/gen_art.js (gpt-image-2 by default, the reference image attached) and
          runs it, then compares what came back. --dry-run prints the requests and sends nothing.
zoom      the centred square crop that makes the subject PCT wide, resized back to the input's size. It only
          crops in, and refuses when the subject would come within 1/128 of an edge (the cut in
          tools/gen_brand_icons.py needs clear wash all round).
set       the one command for a logo change. Validates the file (square, at least 1024, RGB, no alpha), asks
          the generators whether they can cut it, and shows what will change. With --yes it copies it to
          icons/icon-master-1024.png and runs every generator: the web icons and the small nav logos, the
          native set into native-build/brand-native (gitignored, outside what the site serves), the splash,
          every card's logo (tools/card_logo.py --swap --force), then re-pins tools/brand-images.json (the
          master's sha256, provenance and date; the two families made from the master re-hashed; the card
          digests re-approved), moves the old master and everything made from it into a retired set (and takes
          a set OUT of retirement when its master comes back), runs the brand gate's static half, card_logo
          --check and gen_brand_icons --check, and draws a before/after proof sheet for the founder.

Python 3 and Pillow, the standard library otherwise. The generators it drives use numpy; they run as their
own processes. Nothing here draws a bear: every picture in a proof is made from the files themselves.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from collections import OrderedDict

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageStat

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER_REL = 'icons/icon-master-1024.png'
REG_REL = 'tools/brand-images.json'
PREP_REL = os.path.join('native-build', 'brand-native')   # gitignored and in .assetsignore
FONTS = os.path.join(ROOT, 'app', 'fonts')

# The production recipe, from tools/gen_brand_icons.py (the self-test proves they still agree).
SHARPEN_MAX = 64
LOGO_RADIUS = 0.24
IOS_RADIUS = 0.2237
SAFE = 0.96
# Safe circles, as a fraction of the HALF-size, the way gen_brand_icons.scale_for_circle() reads them.
MASKS = [
    ('maskable', 0.80, 'manifest maskable icon: only the centred 80% circle is guaranteed'),
    ('android_round', 0.88, 'Android round launcher icon (ic_launcher_round, a 92% tile cut to a circle)'),
    ('adaptive', 66.0 / 108.0, 'Android adaptive foreground: the 66dp circle of a 108dp canvas'),
]
SITE_CREAM = (0xFB, 0xF5, 0xE9)      # vax.css --bg1: the site's page and top-bar cream
APP_CREAM = (0xF4, 0xEE, 0xE3)       # the app's --bg
INK = (0x2C, 0x25, 0x21)
SOFT = (0x6E, 0x63, 0x5B)
PINK = (0xC9, 0x7F, 0xA0)
LIGHT_WALL = (242, 242, 247)
DARK_WALL = (28, 28, 30)

METRICS = OrderedDict([
    ('contrast_fur', 'Fur vs background: WCAG contrast of the median colour of the subject\'s outer ring (its '
                     'outermost ~1.6%) against the tile\'s own edge colour (the mean of its outer 4% band). '
                     'This is what separates the silhouette from its ground at 29px. Higher reads better.'),
    ('contrast_subject', 'Subject vs background: the same, with the median colour of the whole subject.'),
    ('edge_29', 'Edge energy at 29px: mean luminance gradient (levels per pixel) of the tile resized exactly '
                'as production does (Lanczos, the light unsharp mask at 64px and below). More is more visible '
                'detail at Settings-icon size.'),
    ('edge_16', 'Edge energy at 16px, the favicon size.'),
    ('width_pct', 'Subject width as % of the tile. The subject is everything not reachable from the tile\'s '
                  'border through background-coloured pixels, keeping the one shape nearest the centre.'),
    ('reach', 'How far the subject reaches from the centre, as a fraction of the half-size (ears in the '
              'corners can pass 1.0).'),
    ('maskable', MASKS[0][2]),
    ('android_round', MASKS[1][2]),
    ('adaptive', MASKS[2][2]),
    ('cut', 'Whether tools/gen_brand_icons.py can cut the subject from its ground (its --preflight). If not, '
            'set refuses the file.'),
])


# ---------------------------------------------------------------- small helpers

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def rel(p, base=None):
    return os.path.relpath(p, base or ROOT).replace(os.sep, '/')


def font(name, size, opsz=None):
    """A font from the app's own self-hosted files (the real wordmark face), else Pillow's default. The files
    are variable fonts (Fraunces defaults to weight 900, Nunito Sans to 200), so the weight the CSS asks for is
    set on the Weight axis, and Fraunces' optical size follows the CSS pixel size the way a browser's
    font-optical-sizing:auto does (`opsz`, for a font drawn at 2x or 3x)."""
    files = {'serif': ('fraunces-600-latin.woff2', 600), 'sans': ('nunitosans-700-latin.woff2', 700),
             'sans-semi': ('nunitosans-600-latin.woff2', 600), 'sans-bold': ('nunitosans-800-latin.woff2', 800)}
    fname, weight = files[name]
    try:
        f = ImageFont.truetype(os.path.join(FONTS, fname), size)
    except (OSError, IOError):
        return ImageFont.load_default(size)
    try:
        vals = []
        for ax in f.get_variation_axes():
            n = ax['name'].decode() if isinstance(ax['name'], bytes) else ax['name']
            v = weight if n == 'Weight' else (opsz or size) if n == 'Optical Size' else ax['default']
            vals.append(max(ax['minimum'], min(ax['maximum'], v)))
        f.set_variation_by_axes(vals)
    except (OSError, AttributeError):
        pass                                    # a static font, or a FreeType without variations
    return f


def prod_resize(img, size):
    """Exactly tools/gen_brand_icons.resize()."""
    out = img.resize((size, size), Image.LANCZOS)
    if size <= SHARPEN_MAX:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.5, percent=40, threshold=1))
    return out


def rounded(img, frac, ss=4):
    """Exactly tools/gen_brand_icons.rounded(): corners cut on a 4x supersampled mask."""
    n = img.size[0]
    mask = Image.new('L', (n * ss, n * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n * ss - 1, n * ss - 1], radius=int(n * ss * frac), fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask.resize((n, n), Image.LANCZOS))
    return out


def circle_mask(n, ss=4):
    m = Image.new('L', (n * ss, n * ss), 0)
    ImageDraw.Draw(m).ellipse([0, 0, n * ss - 1, n * ss - 1], fill=255)
    return m.resize((n, n), Image.LANCZOS)


def squared(img):
    """A centred square crop (a 1536x1024 candidate becomes 1024x1024), and whether one was needed."""
    w, h = img.size
    if w == h:
        return img, False
    s = min(w, h)
    x, y = (w - s) // 2, (h - s) // 2
    return img.crop((x, y, x + s, y + s)), True


def load_candidate(path):
    im = Image.open(path)
    im.load()
    info = {'file': os.path.basename(path), 'sha256': sha256_file(path), 'size': list(im.size), 'mode': im.mode,
            'alpha': im.mode in ('RGBA', 'LA', 'PA') or 'transparency' in im.info}
    rgb = im.convert('RGBA').convert('RGB') if info['alpha'] else im.convert('RGB')
    sq, cropped = squared(rgb)
    info['square'] = not cropped
    return sq, info


def lum(rgb):
    def lin(v):
        v = v / 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def hexc(rgb):
    return '#%02X%02X%02X' % tuple(int(round(v)) for v in rgb[:3])


def wallpaper(w, h, dark):
    """A soft vertical gradient: blue-grey by day, deep blue-black by night."""
    bg = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(bg)
    for y in range(h):
        t = y / max(1, h - 1)
        c = (int(28 + 20 * t), int(30 + 22 * t), int(48 + 30 * t)) if dark else (int(172 + 30 * t), int(186 + 26 * t), int(204 + 18 * t))
        d.line([(0, y), (w, y)], fill=c)
    return bg


# ---------------------------------------------------------------- measuring a candidate

A = 512   # analysis size


def _chebyshev(img, rgb):
    d = ImageChops.difference(img, Image.new('RGB', img.size, tuple(rgb)))
    r, g, b = d.split()
    return ImageChops.lighter(ImageChops.lighter(r, g), b)


def _percentile(hist, q):
    total, acc = sum(hist), 0
    for v, n in enumerate(hist):
        acc += n
        if acc >= q * total:
            return v
    return 255


def _keep_connected(mask, seed):
    """The pixels of a 0/255 mask 4-connected to `seed`, as a 0/255 mask."""
    m = mask.copy()
    ImageDraw.floodfill(m, seed, 128, thresh=0)
    return m.point(lambda v: 255 if v == 128 else 0)


def measure(img):
    """The subject cut from its ground at 512px, and the numbers compare and set report (METRICS)."""
    a = img.convert('RGB')
    if a.size != (A, A):
        a = a.resize((A, A), Image.LANCZOS)
    b = A // 25
    band = Image.new('L', (A, A), 255)
    ImageDraw.Draw(band).rectangle([b, b, A - 1 - b, A - 1 - b], fill=0)
    bg = tuple(int(round(v)) for v in ImageStat.Stat(a, band).mean)
    dist = _chebyshev(a, bg)
    thresh = min(96, max(14, _percentile(dist.histogram(band), 0.99) + 10))
    pale = dist.point(lambda v: 255 if v <= thresh else 0)
    pad = Image.new('L', (A + 2, A + 2), 255)
    pad.paste(pale, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128, thresh=0)
    subj = pad.crop((1, 1, A + 1, A + 1)).point(lambda v: 0 if v == 128 else 255)
    out = OrderedDict([('background', hexc(bg)), ('threshold', thresh)])
    data = subj.getdata()
    c = (A - 1) / 2.0
    best, seed = None, None
    for i, v in enumerate(data):
        if v:
            dd = (i % A - c) ** 2 + (i // A - c) ** 2
            if best is None or dd < best:
                best, seed = dd, (i % A, i // A)
    if seed is None:
        out.update(empty=True, width_pct=0.0, height_pct=0.0, area_pct=0.0, reach=0.0, touches_edge=False,
                   contrast_fur=1.0, contrast_subject=1.0, fur=hexc(bg), subject=hexc(bg))
        return out
    core = _keep_connected(subj, seed)
    x0, y0, x1, y1 = core.getbbox()
    edge = ImageChops.subtract(core, core.filter(ImageFilter.MinFilter(3)))
    reach = 0.0
    for i, v in enumerate(edge.getdata()):
        if v:
            reach = max(reach, (i % A - c) ** 2 + (i // A - c) ** 2)
    reach = math.sqrt(reach) / (A / 2.0)
    inner = core
    for _ in range(max(2, A // 64)):
        inner = inner.filter(ImageFilter.MinFilter(3))
    ring = ImageChops.subtract(core, inner)
    fur = ImageStat.Stat(a, ring).median if ring.getbbox() else ImageStat.Stat(a, core).median
    whole = ImageStat.Stat(a, core).median
    area = sum(1 for v in core.getdata() if v) / float(A * A)
    out.update([
        ('empty', False),
        ('width_pct', round(100.0 * (x1 - x0) / A, 1)),
        ('height_pct', round(100.0 * (y1 - y0) / A, 1)),
        ('area_pct', round(100.0 * area, 1)),
        ('bbox', [round(x0 / A, 4), round(y0 / A, 4), round(x1 / A, 4), round(y1 / A, 4)]),
        ('reach', round(reach, 3)),
        ('touches_edge', x0 <= 0 or y0 <= 0 or x1 >= A or y1 >= A),
        ('fur', hexc(fur)), ('subject', hexc(whole)),
        ('contrast_fur', round(contrast(fur, bg), 2)),
        ('contrast_subject', round(contrast(whole, bg), 2)),
    ])
    return out


def edge_energy(img, size):
    """Mean luminance gradient of the production-resized tile (see METRICS)."""
    g = prod_resize(img.convert('RGB'), size).convert('L')
    p = list(g.getdata())
    tot, n = 0.0, 0
    for y in range(1, size - 1):
        for x in range(1, size - 1):
            i = y * size + x
            gx = (p[i + 1] - p[i - 1]) / 2.0
            gy = (p[i + size] - p[i - size]) / 2.0
            tot += math.sqrt(gx * gx + gy * gy)
            n += 1
    return round(tot / max(1, n), 2)


_PREFLIGHT = {}


def preflight(path):
    """Ask the generators themselves whether they can cut this file (tools/gen_brand_icons.py --preflight).
    Remembered per file content for the life of the process: the answer depends only on the bytes."""
    key = sha256_file(path)
    if key not in _PREFLIGHT:
        r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'gen_brand_icons.py'), '--preflight', path],
                           capture_output=True, text=True)
        lines = ((r.stdout or '') + (r.stderr or '')).strip().split('\n')
        _PREFLIGHT[key] = (r.returncode == 0, (lines[0] if r.returncode == 0 else lines[-1]).strip())
    ok_, why = _PREFLIGHT[key]
    return ok_, why.replace('preflight %s: ' % os.path.basename(path), '') if ok_ else why


def candidate_metrics(img, info, path=None):
    m = measure(img)
    out = OrderedDict([('name', info.get('name')), ('file', info['file']), ('sha256', info['sha256']),
                       ('size', info['size']), ('mode', info['mode']), ('square', info['square']), ('alpha', info['alpha'])])
    out['subject'] = m
    out['edge_energy'] = OrderedDict([('29', edge_energy(img, 29)), ('16', edge_energy(img, 16))])
    masks = OrderedDict()
    for key, r, label in MASKS:
        scale = min(1.0, SAFE * r / m['reach']) if m['reach'] else 1.0
        masks[key] = OrderedDict([('safe_radius', round(r, 4)), ('fits_as_is', bool(m['reach'] and m['reach'] <= r)),
                                  ('generator_scale', round(scale, 3)), ('subject_width_after_pct', round(m['width_pct'] * scale, 1))])
    out['masks'] = masks
    ok_file = info['square'] and info['size'][0] >= 1024 and info['mode'] == 'RGB' and not info['alpha']
    if path and info['square']:
        cut, why = preflight(path)
    else:
        cut, why = False, 'not square'
    out['cut'] = OrderedDict([('ok', cut), ('detail', why)])
    out['set_accepts'] = bool(ok_file and cut)
    return out


# ---------------------------------------------------------------- compare: the pictures

SIZES = [512, 180, 120, 60, 40, 32, 29, 16]


def _label(d, xy, text, size=20, fill=INK, kind='sans'):
    d.text(xy, text, fill=fill, font=font(kind, size))


def _stack(blocks, bg=(255, 255, 255), gap=0):
    w = max(b.width for b in blocks)
    h = sum(b.height for b in blocks) + gap * (len(blocks) - 1)
    out = Image.new('RGB', (w, h), bg)
    y = 0
    for b in blocks:
        out.paste(b, (0, y))
        y += b.height + gap
    return out


def render_sizes(img, name):
    pad = 24
    w = pad + sum(s + pad for s in SIZES)
    row = max(SIZES) + 2 * pad
    block = Image.new('RGB', (w, 44 + 2 * row + 26), (255, 255, 255))
    d = ImageDraw.Draw(block)
    _label(d, (pad, 10), name, 22)
    for r, wall in enumerate((LIGHT_WALL, DARK_WALL)):
        y0 = 44 + r * row
        d.rectangle([0, y0, w, y0 + row - 1], fill=wall)
        x = pad
        for s in SIZES:
            ic = rounded(prod_resize(img, s), IOS_RADIUS)
            block.paste(ic, (x, y0 + pad + (max(SIZES) - s) // 2), ic)
            x += s + pad
    x = pad
    for s in SIZES:
        _label(d, (x, 44 + 2 * row + 4), '%dpx' % s, 14, SOFT)
        x += s + pad
    return block


APP_TILES = [  # neutral stand-ins for other apps: a flat colour and a white glyph, no pictures
    ((92, 132, 186), 'circle', 'Mail'), ((96, 168, 120), 'bars', 'Health'), ((228, 176, 72), 'square', 'Notes'),
    ((150, 150, 158), 'ring', 'Settings'), ((206, 110, 92), 'triangle', 'Music'), ((110, 116, 200), 'circle', 'Books'),
    ((80, 170, 190), 'bars', 'Weather'), (None, None, None), ((176, 120, 176), 'square', 'Photos'),
    ((70, 70, 84), 'ring', 'Clock'), ((214, 140, 160), 'triangle', 'Podcasts'), ((120, 140, 96), 'circle', 'Maps'),
]


def _tile(colour, glyph, s):
    t = Image.new('RGB', (s, s), colour)
    d = ImageDraw.Draw(t)
    w = (255, 255, 255)
    q = s // 4
    if glyph == 'circle':
        d.ellipse([q, q, s - q, s - q], fill=w)
    elif glyph == 'square':
        d.rounded_rectangle([q, q, s - q, s - q], radius=s // 10, fill=w)
    elif glyph == 'ring':
        d.ellipse([q, q, s - q, s - q], outline=w, width=max(2, s // 14))
    elif glyph == 'triangle':
        d.polygon([(s // 2, q), (s - q, s - q), (q, s - q)], fill=w)
    elif glyph == 'bars':
        for i in range(3):
            x = q + i * (s - 2 * q) // 3
            d.rectangle([x + 2, s - q - (i + 1) * s // 8, x + (s - 2 * q) // 3 - 2, s - q], fill=w)
    return rounded(t, IOS_RADIUS)


def render_homescreen(img, name, s=60):
    cols, rows, gx, gy = 4, 3, 28, 30
    pw = cols * s + (cols + 1) * gx
    ph = rows * (s + 18) + (rows + 1) * gy
    block = Image.new('RGB', (2 * pw + 20, ph + 40), (255, 255, 255))
    d = ImageDraw.Draw(block)
    _label(d, (0, 8), name, 22)
    me = rounded(prod_resize(img, s), IOS_RADIUS)
    for p, dark in enumerate((False, True)):
        panel = wallpaper(pw, ph, dark)
        pd = ImageDraw.Draw(panel)
        for i, (colour, glyph, label) in enumerate(APP_TILES):
            cx, cy = i % cols, i // cols
            x, y = gx + cx * (s + gx), gy + cy * (s + 18 + gy)
            ic = me if colour is None else _tile(colour, glyph, s)
            panel.paste(ic, (x, y), ic)
            text = 'Cubby' if colour is None else label
            f = font('sans-semi', 11)
            tw = pd.textlength(text, font=f)
            pd.text((x + (s - tw) / 2, y + s + 3), text, fill=(255, 255, 255), font=f)
        block.paste(panel, (p * (pw + 20), 40))
    return block


def nav_bar(logo_src, dpr, width=640):
    """The site's top bar (site.css .nav-in / .nav-brand) at `dpr`: the 34px logo, 9px gap, the Fraunces
    600 21px wordmark, the tabs and the pink button, on the bar's cream. `logo_src` is what the page loads."""
    k = dpr
    h = int(56 * k)
    bar = Image.new('RGB', (int(width * k), h), SITE_CREAM)
    d = ImageDraw.Draw(bar)
    d.line([(0, h - 1), (bar.width, h - 1)], fill=(0xE7, 0xDE, 0xCF), width=max(1, k))
    n = int(34 * k)
    lg = logo_src.convert('RGBA').resize((n, n), Image.LANCZOS)
    mask = Image.new('L', (n * 4, n * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n * 4 - 1, n * 4 - 1], radius=int(10 * k * 4), fill=255)
    lg.putalpha(ImageChops.multiply(lg.getchannel('A'), mask.resize((n, n), Image.LANCZOS)))
    x = int(20 * k)
    bar.paste(lg, (x, (h - n) // 2), lg)
    x += n + int(9 * k)
    f = font('serif', int(21 * k), opsz=21)
    d.text((x, h // 2), 'Cubby', fill=INK, font=f, anchor='lm')
    x += int(d.textlength('Cubby', font=f)) + int(26 * k)
    ft = font('sans', int(15 * k), opsz=15)
    for t in ('Pregnancy', 'Baby', 'Articles', 'Pricing'):
        d.text((x, h // 2), t, fill=SOFT, font=ft, anchor='lm')
        x += int(d.textlength(t, font=ft)) + int(24 * k)
    fb = font('sans-bold', int(15 * k), opsz=15)
    bw = int(d.textlength('Open app', font=fb)) + int(36 * k)
    bx = bar.width - bw - int(20 * k)
    d.rounded_rectangle([bx, int(10 * k), bx + bw, h - int(11 * k)], radius=int(12 * k), fill=PINK)
    d.text((bx + bw // 2, h // 2), 'Open app', fill=(255, 255, 255), font=fb, anchor='mm')
    return bar


def browser_tabs(fav48, dark):
    """A browser tab strip with the favicon at 16px (1x) and 32px (2x), as the browser draws favicon.png."""
    out = []
    for k in (1, 2):
        h = 34 * k
        strip = Image.new('RGB', (260 * k, h), (32, 33, 36) if dark else (222, 225, 230))
        d = ImageDraw.Draw(strip)
        tab = (53, 54, 58) if dark else (255, 255, 255)
        d.rounded_rectangle([8 * k, 4 * k, 230 * k, h + 8 * k], radius=8 * k, fill=tab)
        s = 16 * k
        fv = fav48.resize((s, s), Image.LANCZOS)
        strip.paste(fv, (18 * k, (h - s) // 2 + 2 * k), fv)
        d.text((18 * k + s + 8 * k, h // 2 + 2 * k), 'Cubby: the calm baby log', fill=(232, 234, 237) if dark else (32, 33, 36),
               font=font('sans-semi', 12 * k), anchor='lm')
        out.append(strip)
    return out


def render_web(img, name):
    logo96 = rounded(prod_resize(img, 96), LOGO_RADIUS)
    logo192 = rounded(prod_resize(img, 192), LOGO_RADIUS)
    fav48 = rounded(prod_resize(img, 48), LOGO_RADIUS)
    bars = [nav_bar(logo96, 1), nav_bar(logo96, 2), nav_bar(logo192, 3)]
    tabs_l, tabs_d = browser_tabs(fav48, False), browser_tabs(fav48, True)
    w = max(b.width for b in bars)
    h = 40 + sum(b.height + 48 for b in bars) + 20 + max(t.height for t in tabs_l + tabs_d) + 12
    block = Image.new('RGB', (w, h), (255, 255, 255))
    d = ImageDraw.Draw(block)
    _label(d, (0, 8), name, 22)
    y = 40
    for b, label in zip(bars, ('top bar at 1x (34px logo from logo-96)', 'at 2x (68px, logo-96)', 'at 3x (102px, logo-192)')):
        _label(d, (0, y), label, 14, SOFT)
        block.paste(b, (0, y + 18))
        y += b.height + 48
    _label(d, (0, y), 'browser tab: favicon at 16px and 32px, light and dark', 14, SOFT)
    y += 20
    x = 0
    for t in tabs_l + tabs_d:
        block.paste(t, (x, y))
        x += t.width + 16
    return block


def render_context(img, name):
    sizes = [(34, 'nav'), (56, 'email'), (96, ''), (180, '')]
    pad = 28
    w = pad + sum(s + pad for s, _ in sizes)
    row = 180 + 2 * pad
    block = Image.new('RGB', (2 * w + 20, 40 + row + 24), (255, 255, 255))
    d = ImageDraw.Draw(block)
    _label(d, (0, 8), name, 22)
    for p, (bg, label) in enumerate((((255, 255, 255), 'white'), (SITE_CREAM, 'the site\'s cream #FBF5E9'))):
        panel = Image.new('RGB', (w, row), bg)
        pd = ImageDraw.Draw(panel)
        pd.rectangle([0, 0, w - 1, row - 1], outline=(230, 226, 220))
        x = pad
        for s, what in sizes:
            ic = rounded(prod_resize(img, s), LOGO_RADIUS)
            panel.paste(ic, (x, (row - s) // 2), ic)
            x += s + pad
        block.paste(panel, (p * (w + 20), 40))
        _label(d, (p * (w + 20), 40 + row + 4), label + ': ' + ', '.join('%dpx%s' % (s, ' ' + wh if wh else '') for s, wh in sizes), 13, SOFT)
    return block


def _fmt(v):
    return ('%.2f' % v).rstrip('0').rstrip('.') if isinstance(v, float) else str(v)


def compare_html(cands):
    def row(key, title, values, best=None, unit=''):
        cells = []
        nums = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
        top = (max(nums) if best == 'max' else min(nums)) if (best and nums) else None
        for v in values:
            s = (_fmt(v) + unit) if not isinstance(v, str) else v
            cells.append('<td%s>%s</td>' % (' class="best"' if (top is not None and v == top and len(nums) > 1) else '', s))
        return '<tr><th title="%s">%s</th>%s</tr>' % (METRICS.get(key, '').replace('"', '&quot;'), title, ''.join(cells))

    def mask_cell(c, key):
        m = c['masks'][key]
        return ('fits as is' if m['fits_as_is'] else 'shrunk to %d%%' % round(100 * m['generator_scale'])) + ', %s%% wide' % _fmt(m['subject_width_after_pct'])

    head = ''.join('<th>%s</th>' % c['name'] for c in cands)
    rows = [
        row('contrast_fur', 'Fur vs background', [c['subject']['contrast_fur'] for c in cands], 'max', ':1'),
        row('contrast_subject', 'Subject vs background', [c['subject']['contrast_subject'] for c in cands], 'max', ':1'),
        row('edge_29', 'Edge energy at 29px', [c['edge_energy']['29'] for c in cands], 'max'),
        row('edge_16', 'Edge energy at 16px', [c['edge_energy']['16'] for c in cands], 'max'),
        row('width_pct', 'Subject width', [c['subject']['width_pct'] for c in cands], None, '%'),
        row('reach', 'Reach from the centre', [c['subject']['reach'] for c in cands]),
        row('maskable', 'Maskable icon', [mask_cell(c, 'maskable') for c in cands]),
        row('android_round', 'Android round', [mask_cell(c, 'android_round') for c in cands]),
        row('adaptive', 'Android adaptive', [mask_cell(c, 'adaptive') for c in cands]),
        row('cut', 'The generators can cut it', [('yes' if c['cut']['ok'] else 'no: ' + c['cut']['detail']) for c in cands]),
        row('', 'brand.py set would accept it', [('yes' if c['set_accepts'] else 'no') for c in cands]),
        row('', 'Background, fur', ['%s, %s' % (c['subject']['background'], c['subject']['fur']) for c in cands]),
        row('', 'File', ['%s<br><small>%dx%d %s, sha256 %s</small>' % (c['file'], c['size'][0], c['size'][1], c['mode'], c['sha256'][:12]) for c in cands]),
    ]
    defs = ''.join('<dt>%s</dt><dd>%s</dd>' % (k, v) for k, v in METRICS.items())
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Logo candidates</title>
<style>
:root{--ink:#2C2521;--soft:#6E635B;--line:#E7DECF;--bg:#FBF7EF;--card:#fff;--best:#E6F2E8}
@media (prefers-color-scheme:dark){:root{--ink:#F1E9DF;--soft:#B8AC9F;--line:#3A332D;--bg:#1E1A17;--card:#28231F;--best:#23402B}}
body{margin:0;padding:24px 16px 60px;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,system-ui,sans-serif}
main{max-width:1240px;margin:0 auto}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:34px 0 10px}
p{color:var(--soft);margin:0 0 16px}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%%}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
thead th{font-size:14px}tbody th{font-weight:600;white-space:nowrap;cursor:help}
td.best{background:var(--best);font-weight:700}
small{color:var(--soft)}
img{max-width:100%%;height:auto;border-radius:8px;border:1px solid var(--line);background:#fff}
dt{font-weight:700;margin-top:10px}dd{margin:2px 0 0;color:var(--soft)}
</style></head><body><main>
<h1>Logo candidates</h1>
<p>Made by <code>python3 tools/brand.py compare</code>. Same inputs, same bytes. Hover a row name for what it measures; the best of each measured row is shaded.</p>
<div class="wrap"><table><thead><tr><th></th>%s</tr></thead><tbody>
%s
</tbody></table></div>
<h2>Sizes, 512 to 16px, light and dark</h2><img src="sizes.png" alt="Each candidate at eight sizes on light and dark wallpaper">
<h2>Home screen, 60px between other apps</h2><img src="homescreen.png" alt="Each candidate on a home screen">
<h2>The site's top bar and a browser tab</h2><img src="web.png" alt="Each candidate in the top bar and as a favicon">
<h2>On white and on the site's cream</h2><img src="context-light.png" alt="Each candidate on white and cream">
<h2>What each number means</h2><dl>%s</dl>
<p>Pick one, then: <code>python3 tools/brand.py set FILE --provenance "..."</code> shows what would change; add <code>--yes</code> to do it.</p>
</main></body></html>
""" % (head, '\n'.join(rows), defs)


def compare(paths, names=None, out=None, current=True, quiet=False):
    names = list(names or [])
    if names and len(names) != len(paths):
        raise SystemExit('compare: %d names for %d images' % (len(names), len(paths)))
    out = os.path.abspath(out or os.path.join(tempfile.gettempdir(), 'cubby-brand-compare'))
    items = []
    if current and os.path.exists(os.path.join(ROOT, MASTER_REL)):
        reg = load_registry()
        items.append((os.path.join(ROOT, MASTER_REL), 'now: ' + reg.get('master', {}).get('name', 'the current master')))
    for i, p in enumerate(paths):
        if not os.path.exists(p):
            raise SystemExit('compare: no file %s' % p)
        items.append((p, names[i] if names else os.path.splitext(os.path.basename(p))[0]))
    os.makedirs(out, exist_ok=True)
    cands, blocks = [], {'sizes': [], 'homescreen': [], 'web': [], 'context-light': []}
    for p, name in items:
        img, info = load_candidate(p)
        info['name'] = name
        if not quiet:
            print('  measuring %s' % name)
        cands.append(candidate_metrics(img, info, p))
        blocks['sizes'].append(render_sizes(img, name))
        blocks['homescreen'].append(render_homescreen(img, name))
        blocks['web'].append(render_web(img, name))
        blocks['context-light'].append(render_context(img, name))
    for k, bl in blocks.items():
        _stack(bl, gap=24).save(os.path.join(out, k + '.png'), 'PNG', optimize=True)
    doc = OrderedDict([('tool', 'tools/brand.py compare'), ('metrics', METRICS), ('candidates', cands)])
    with open(os.path.join(out, 'metrics.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(doc, indent=1, ensure_ascii=False) + '\n')
    with open(os.path.join(out, 'compare.html'), 'w', encoding='utf-8') as f:
        f.write(compare_html(cands))
    if not quiet:
        print('\n  %-28s %8s %8s %7s %7s %7s  %s' % ('', 'fur', 'subject', 'e29', 'e16', 'width', 'set accepts'))
        for c in cands:
            print('  %-28s %7.2f: %7.2f: %7.2f %7.2f %6.1f%%  %s' % (c['name'][:28], c['subject']['contrast_fur'], c['subject']['contrast_subject'],
                                                              c['edge_energy']['29'], c['edge_energy']['16'], c['subject']['width_pct'],
                                                              'yes' if c['set_accepts'] else 'no (' + c['cut']['detail'][:60] + ')'))
        print('\n  open %s' % os.path.join(out, 'compare.html'))
    return out, cands


# ---------------------------------------------------------------- zoom

def zoom(src, pct, out):
    img = Image.open(src)
    img.load()
    if img.size[0] != img.size[1]:
        raise SystemExit('zoom: %s is %dx%d; it must be square' % ((src,) + img.size))
    if not 1 <= pct <= 100:
        raise SystemExit('zoom: --subject-width is a percentage of the tile, 1 to 100')
    rgb = img.convert('RGB')
    n = rgb.size[0]
    m = measure(rgb)
    if m['empty']:
        raise SystemExit('zoom: found no subject in %s' % src)
    cur = m['width_pct']
    if pct <= cur + 0.05:
        raise SystemExit('zoom: the subject is already %.1f%% wide; zoom only crops in (it never pads the ground out)' % cur)
    side = n * cur / pct
    x0 = y0 = (n - side) / 2.0
    bx0, by0, bx1, by1 = (v * n for v in m['bbox'])
    margin = min(bx0 - x0, by0 - y0, x0 + side - bx1, y0 + side - by1) * n / side
    need = n / 128.0
    if margin < need:
        raise SystemExit('zoom: at %.1f%% the subject would come within %.1fpx of the edge (it needs %.0fpx of clear '
                         'ground for the cut in tools/gen_brand_icons.py); nothing written' % (pct, max(0.0, margin), need))
    res = rgb.resize((n, n), Image.LANCZOS, box=(x0, y0, x0 + side, y0 + side))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    res.save(out, 'PNG', optimize=True)
    got = measure(res)
    print('zoom: subject %.1f%% -> %.1f%% wide (asked %.1f%%), a centred %.1fpx crop of %dpx, resized back to %dpx: %s'
          % (cur, got['width_pct'], pct, side, n, n, out))
    return out, cur, got['width_pct']


# ---------------------------------------------------------------- propose

def propose(ref, variants_path, out=None, dry_run=False, engine='openai', run_compare=True, env=None):
    if not os.path.exists(ref):
        raise SystemExit('propose: no reference image %s' % ref)
    try:
        spec = json.load(open(variants_path, encoding='utf-8'))
    except (OSError, ValueError) as e:
        raise SystemExit('propose: cannot read %s: %s' % (variants_path, e))
    base = ''
    if isinstance(spec, dict):
        base, spec = spec.get('base', ''), spec.get('variants')
    if not isinstance(spec, list) or not spec:
        raise SystemExit('propose: %s must be a list of {"name", "prompt"} (or {"base", "variants": [...]})' % variants_path)
    out = os.path.abspath(out or os.path.join(tempfile.gettempdir(), 'cubby-brand-candidates'))
    seen, jobs = set(), []
    for v in spec:
        name, prompt = (v or {}).get('name', ''), (v or {}).get('prompt', '')
        if not re.match(r'^[a-z0-9][a-z0-9-]{0,40}$', name):
            raise SystemExit('propose: variant name %r must be a short slug (a-z, 0-9, -)' % name)
        if name in seen:
            raise SystemExit('propose: two variants are called %s' % name)
        if not prompt.strip():
            raise SystemExit('propose: variant %s has no prompt' % name)
        vref = os.path.abspath(v.get('ref', ref))
        if not os.path.exists(vref):
            raise SystemExit('propose: variant %s: no reference image %s' % (name, vref))
        seen.add(name)
        jobs.append({'out': os.path.join(out, name + '.png'), 'prompt': (base + ' ' + prompt).strip(), 'ref': vref, 'aspect': '1:1'})
    fd, jobs_path = tempfile.mkstemp(prefix='cubby-brand-jobs-', suffix='.json')
    with os.fdopen(fd, 'w') as f:
        json.dump(jobs, f, indent=1)
    cmd = ['node', os.path.join(ROOT, 'tools', 'gen_art.js'), '--jobs', jobs_path, '--engine', engine]
    if dry_run:
        cmd.append('--dry-run')
    else:
        os.makedirs(out, exist_ok=True)
    print('propose: %d variant%s with %s, reference %s%s' % (len(jobs), '' if len(jobs) == 1 else 's', engine, os.path.basename(ref),
                                                            ' (dry run: nothing is sent, nothing is written)' if dry_run else ''))
    try:
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env=env)
    finally:
        os.unlink(jobs_path)
    sys.stdout.write(r.stdout + r.stderr)
    if r.returncode != 0:
        raise SystemExit('propose: tools/gen_art.js failed (exit %d)' % r.returncode)
    if dry_run:
        return r.stdout, []
    made = [j['out'] for j in jobs if os.path.exists(j['out'])]
    if made and run_compare:
        compare(made, out=os.path.join(out, 'compare'))
    return r.stdout, made


# ---------------------------------------------------------------- the registry

def load_registry(root=None):
    with open(os.path.join(root or ROOT, REG_REL), encoding='utf-8') as f:
        return json.load(f, object_pairs_hook=OrderedDict)


def write_registry(reg, root=None):
    # The same bytes JSON.stringify(REG, null, 1) + '\n' gives (tools/brand_image_check.js --approve-cards).
    with open(os.path.join(root or ROOT, REG_REL), 'w', encoding='utf-8') as f:
        f.write(json.dumps(reg, indent=1, ensure_ascii=False) + '\n')


def from_master_files(reg):
    """Every file the registry pins that is made from the master (families marked from_master), with its pin."""
    out = OrderedDict()
    for fam in reg.get('families', []):
        if fam.get('from_master'):
            for p, h in fam.get('files', {}).items():
                out[p] = h
    return out


def next_registry(reg, before, after, new_master, today, blobs):
    """The registry after a master change. Pure, so the self-test can drive it with made-up hashes.
      before/after  {path: sha256} of the master and every from_master file, read from disk
      new_master    {'sha256', 'name', 'provenance'}
      blobs         {path: git blob id} of the OLD files, for the gate's self-test plants
    Returns (registry, notes). The old master and each from_master file whose bytes changed go into a new
    retired set; a retired set whose master comes back is taken out of retirement; and no hash that is now
    approved stays retired."""
    reg = json.loads(json.dumps(reg), object_pairs_hook=OrderedDict)
    notes = []
    old = reg.get('master', {})
    old_sha = old.get('sha256')
    changed = OrderedDict((p, h) for p, h in before.items() if after.get(p) != h)
    master_path = old.get('path', MASTER_REL)
    retired = list(reg.get('retired') or [])
    keep = []
    for s in retired:
        if new_master['sha256'] in (s.get('sha256') or {}).values():
            notes.append('taken out of retirement: %s (its master is the master again)' % s.get('name'))
            continue
        keep.append(s)
    if old_sha and old_sha != new_master['sha256'] and changed:
        rs = OrderedDict()
        rs['name'] = old.get('name') or ('the master pinned %s' % old_sha[:8])
        rs['why'] = ('The master from %s, retired %s by tools/brand.py set when %s replaced it: its master and every icon '
                     'and text card made from it, hashed before the change. The share cards and heroes that carried it are '
                     'held by tools/card_logo.py --check (any logo box that is not the current master\'s fails) and their '
                     'pinned digests.' % (old.get('date', 'an earlier date'), today, new_master.get('name') or 'a new master'))
        rs['retired_on'] = today
        rs['sha256'] = OrderedDict(sorted(changed.items()))
        rs['git_blob'] = OrderedDict((p, b) for p, b in sorted(blobs.items()) if p in changed)
        keep.append(rs)
        notes.append('retired: %s (%d hashes)' % (rs['name'], len(rs['sha256'])))
    now = set(after.values()) | {new_master['sha256']}
    for s in keep:
        gone = [p for p, h in (s.get('sha256') or {}).items() if h in now]
        for p in gone:
            del s['sha256'][p]
            if p in (s.get('git_blob') or {}):
                del s['git_blob'][p]
        if gone:
            notes.append('%s: %d hash%s now approved again, no longer retired' % (s.get('name'), len(gone), '' if len(gone) == 1 else 'es'))
    reg['retired'] = [s for s in keep if s.get('sha256')]
    m = OrderedDict()
    m['path'] = master_path
    m['sha256'] = new_master['sha256']
    m['name'] = new_master.get('name') or ''
    m['date'] = today
    m['provenance'] = new_master.get('provenance') or ''
    reg['master'] = m
    for fam in reg.get('families', []):
        if fam.get('from_master'):
            for p in list(fam.get('files', {})):
                if p in after:
                    fam['files'][p] = after[p]
    return reg, notes


# ---------------------------------------------------------------- set

class SetFailed(Exception):
    pass


def _git(args, root):
    r = subprocess.run(['git'] + args, cwd=root, capture_output=True, text=True)
    return r.returncode, r.stdout.strip()


def validate_master_file(path):
    """The rules for a master (refuses otherwise): square, at least 1024px, RGB, no alpha of any kind."""
    if not os.path.exists(path):
        return ['no file %s' % path]
    try:
        im = Image.open(path)
        im.load()
    except Exception as e:
        return ['%s is not an image Pillow can read (%s)' % (path, e)]
    bad = []
    if im.size[0] != im.size[1]:
        bad.append('it is %dx%d: a master is square' % im.size)
    if min(im.size) < 1024:
        bad.append('it is %dx%d: a master is at least 1024px (the App Store icon is 1024)' % im.size)
    if im.mode != 'RGB':
        bad.append('its mode is %s: a master is RGB%s' % (im.mode, ' with no alpha (Apple rejects an icon with an alpha channel)' if 'A' in im.mode or im.mode == 'P' else ''))
    elif 'transparency' in im.info:
        bad.append('it carries a transparent colour (tRNS): a master has no alpha of any kind')
    return bad


def prepared_master_bytes(path):
    """The bytes icons/icon-master-1024.png will hold: the file itself when it is already a 1024 PNG, else a
    Lanczos resize to 1024 saved as PNG."""
    im = Image.open(path)
    if im.format == 'PNG' and im.size == (1024, 1024):
        return open(path, 'rb').read(), None
    out = im.convert('RGB').resize((1024, 1024), Image.LANCZOS)
    import io
    buf = io.BytesIO()
    out.save(buf, 'PNG', optimize=True)
    return buf.getvalue(), '%dx%d %s resized to 1024x1024 PNG' % (im.size[0], im.size[1], im.format)


def _cards(root):
    r = subprocess.run([sys.executable, os.path.join(root, 'tools', 'card_logo.py'), '--list'], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        raise SetFailed('tools/card_logo.py --list failed: ' + (r.stdout + r.stderr).strip()[-300:])
    return [l for l in r.stdout.split('\n') if l.strip()]


def _hash_all(root, paths):
    return OrderedDict((p, sha256_file(os.path.join(root, p)) if os.path.exists(os.path.join(root, p)) else None) for p in paths)


def _tree_hashes(d):
    out = OrderedDict()
    if not os.path.isdir(d):
        return out
    for base, _, files in sorted(os.walk(d)):
        for f in sorted(files):
            p = os.path.join(base, f)
            out[rel(p, d)] = sha256_file(p)
    return out


def _step(label, cmd, root, log):
    t = time.time()
    r = subprocess.run(cmd, cwd=root, capture_output=True, text=True)
    out = ((r.stdout or '') + (r.stderr or '')).strip()
    log.append((label, r.returncode, out))
    last = out.split('\n')[-1] if out else ''
    print('  %s %-46s %5.1fs  %s' % ('ok  ' if r.returncode == 0 else 'FAIL', label, time.time() - t, last[:90]))
    if r.returncode != 0:
        raise SetFailed('%s failed:\n%s' % (label, out[-1500:]))
    return out


def set_master(src, provenance=None, name=None, yes=False, native_out=None, proof=None, tree_gate=True, today=None, root=None):
    root = root or ROOT
    today = today or datetime.date.today().isoformat()
    src = os.path.abspath(src)
    print('brand.py set: %s' % src)
    bad = validate_master_file(src)
    if bad:
        for b in bad:
            print('  REFUSED: ' + b)
        print('Nothing was written.')
        return 2
    print('  the file: %s, square, RGB, no alpha: ok' % ('x'.join(map(str, Image.open(src).size))))
    data, resized = prepared_master_bytes(src)
    tmpd = tempfile.mkdtemp(prefix='cubby-brand-set-')
    cand = os.path.join(tmpd, 'master-1024.png')
    with open(cand, 'wb') as f:
        f.write(data)
    new_sha = hashlib.sha256(data).hexdigest()
    cut, why = preflight(cand)
    if not cut:
        print('  REFUSED: the generators cannot cut the subject from its ground: %s' % why)
        print('  (tools/gen_brand_icons.py cuts the bear by a flood fill from the border through pale wash: the subject must be')
        print('  darker than its ground and clear of every edge. compare shows this as "the generators can cut it".)')
        print('Nothing was written.')
        return 2
    print('  the generators can cut it: %s' % why)
    reg = load_registry(root)
    old = reg.get('master', {})
    master_abs = os.path.join(root, old.get('path', MASTER_REL))
    if old.get('sha256') == new_sha and os.path.exists(master_abs) and sha256_file(master_abs) == new_sha:
        print('  that is already the master (%s, sha256 %s). Nothing to change.' % (old.get('name') or '', new_sha[:12]))
        return 0
    name = name or os.path.splitext(os.path.basename(src))[0]
    prov = provenance or ('Set by tools/brand.py set on %s from %s (sha256 %s). No provenance was given: add where it came '
                          'from with --provenance.' % (today, os.path.basename(src), new_sha[:12]))
    if resized:
        prov += ' (%s by tools/brand.py set)' % resized

    # What will change.
    old_img = Image.open(master_abs).convert('RGB') if os.path.exists(master_abs) else None
    new_img = Image.open(cand).convert('RGB')
    mo = measure(old_img) if old_img else None
    mn = measure(new_img)
    print('\n  %-26s %-26s %s' % ('', 'now: ' + (old.get('name') or 'the master')[:20], 'new: ' + name[:30]))
    rows = [('fur vs background', 'contrast_fur', ':1'), ('subject vs background', 'contrast_subject', ':1'), ('subject width', 'width_pct', '%'),
            ('reach from the centre', 'reach', '')]
    for label, k, u in rows:
        print('  %-26s %-26s %s' % (label, (_fmt(mo[k]) + u) if mo else '-', _fmt(mn[k]) + u))
    for s in (29, 16):
        print('  %-26s %-26s %s' % ('edge energy at %dpx' % s, _fmt(edge_energy(old_img, s)) if old_img else '-', _fmt(edge_energy(new_img, s))))
    fm = from_master_files(reg)
    cards = _cards(root)
    prep = os.path.abspath(native_out or os.path.join(root, PREP_REL))
    retiring = old.get('name') or 'the old master'
    comes_back = [s.get('name') for s in reg.get('retired') or [] if new_sha in (s.get('sha256') or {}).values()]
    print('\n  What `set --yes` changes:')
    print('    %-34s %s -> %s' % (MASTER_REL, (old.get('sha256') or '?')[:12], new_sha[:12]))
    print('    %-34s %d icons and text cards made from the master (tools/gen_brand_icons.py, tools/card_logo.py)' % ('', len([p for p in fm if p != MASTER_REL])))
    print('    %-34s %d cards: every share card, hero, og, Product Hunt, promo and social card (card_logo.py --swap --force)' % ('', len(cards)))
    print('    %-34s the native set: iOS AppIcon and Splash, Android mipmaps and splash (prepared, not built)' % rel(prep, root))
    print('    %-34s the master pin, %d hashes re-pinned, the card digests re-approved;' % (REG_REL, len(fm)))
    print('    %-34s retired: + %s (the old master and what changed with it)%s' % ('', retiring, ('; back from retirement: ' + ', '.join(comes_back)) if comes_back else ''))
    print('    then: the brand gate\'s static half, card_logo.py --check, gen_brand_icons.py --check, and a before/after proof sheet')

    # Can it be undone with git? Only if everything it writes is committed now.
    touched = [old.get('path', MASTER_REL), REG_REL] + list(fm) + cards
    dirty = []
    for i in range(0, len(touched), 400):
        code, outp = _git(['status', '--porcelain', '--untracked-files=no', '--'] + touched[i:i + 400], root)
        if code != 0:
            dirty.append('git status failed: ' + outp)
            break
        dirty += [l for l in outp.split('\n') if l.strip()]
    code, head_blob = _git(['rev-parse', 'HEAD:' + old.get('path', MASTER_REL)], root)
    code2, work_blob = _git(['hash-object', old.get('path', MASTER_REL)], root)
    if code != 0 or code2 != 0 or head_blob != work_blob:
        dirty.append('the current master is not the committed one (an earlier set not yet committed?)')
    if dirty:
        print('\n  %s: these are not committed, so git could not undo the change:' % ('REFUSED' if yes else 'NOTE'))
        for l in dirty[:12]:
            print('    ' + l)
        print('  Commit them, or put them back (git restore -- <path>) first.')
        if yes:
            print('Nothing was written.')
            return 3
    if not yes:
        print('\nNothing was written. Run the same command with --yes to make the change.')
        return 0

    # ---- --yes from here on.
    log = []
    before_dir = os.path.join(tmpd, 'before')
    proof = os.path.abspath(proof or os.path.join(tempfile.gettempdir(), 'cubby-brand-proof-%s' % new_sha[:12]))
    print('\n  Before: snapshot of the current derivatives, and the current native set, in %s' % before_dir)
    fm_before = _hash_all(root, list(fm))
    cards_before = _hash_all(root, cards)
    for p in list(fm) + [c for c in cards if c.endswith(('baby-blues-explained.png',))]:
        s = os.path.join(root, p)
        if os.path.exists(s):
            os.makedirs(os.path.dirname(os.path.join(before_dir, p)), exist_ok=True)
            shutil.copy2(s, os.path.join(before_dir, p))
    native_before = os.path.join(before_dir, 'native')
    blobs = OrderedDict()
    for p in (old.get('path', MASTER_REL), 'icons/logo-512.png'):
        c, b = _git(['rev-parse', 'HEAD:' + p], root)
        if c == 0 and b:
            blobs[p] = b
    try:
        _step('the current native set (for BEFORE)', [sys.executable, 'tools/gen_brand_icons.py', '--native-out', native_before, '--no-web'], root, log)
        _step('the current splash (for BEFORE)', [sys.executable, 'tools/gen_splash.py', '--out', native_before], root, log)
        prep_before = _tree_hashes(prep)
        print('\n  Change:')
        with open(master_abs, 'wb') as f:
            f.write(data)
        pin = json.loads(json.dumps(reg), object_pairs_hook=OrderedDict)
        pin['master']['sha256'] = new_sha            # the generators refuse a master that is not pinned
        write_registry(pin, root)
        print('  ok   %-46s        %s' % ('wrote ' + MASTER_REL, new_sha[:12]))
        _step('web icons, nav logos, native set', [sys.executable, 'tools/gen_brand_icons.py', '--native-out', prep], root, log)
        _step('the native splash', [sys.executable, 'tools/gen_splash.py', '--out', prep], root, log)
        _step('every card\'s logo (card_logo.py --swap --force)', [sys.executable, 'tools/card_logo.py', '--swap', '--force'], root, log)
        fm_after = _hash_all(root, list(fm))
        reg2, notes = next_registry(reg, OrderedDict([(p, h) for p, h in fm_before.items() if h]), fm_after,
                                    {'sha256': new_sha, 'name': name, 'provenance': prov}, today, blobs)
        write_registry(reg2, root)
        print('  ok   %-46s        %s' % ('re-pinned ' + REG_REL, '; '.join(notes) or 'nothing retired'))
        _step('card digests (brand_image_check --approve-cards)', ['node', 'tools/brand_image_check.js', '--approve-cards'], root, log)
        print('\n  Check:')
        if tree_gate:
            _step('brand gate, static half', ['node', 'tools/brand_image_check.js', '--static-only'], root, log)
        _step('card_logo.py --check', [sys.executable, 'tools/card_logo.py', '--check'], root, log)
        _step('gen_brand_icons.py --check', [sys.executable, 'tools/gen_brand_icons.py', '--check'], root, log)
    except SetFailed as e:
        print('\nFAILED: %s' % e)
        print('\nTo put the tree back as it was (set only writes files that were committed when it started):')
        print('  git restore -- %s %s icons cap-web og articles social' % (MASTER_REL, REG_REL))
        return 1
    cards_after = _hash_all(root, cards)
    prep_after = _tree_hashes(prep)
    native_b = _tree_hashes(native_before)
    changed = OrderedDict([
        ('master and icons', [sum(1 for p in fm_before if fm_before[p] != fm_after.get(p) and not p.startswith(('og/', 'social/', 'icons/screenshots/'))),
                              sum(1 for p in fm_before if not p.startswith(('og/', 'social/', 'icons/screenshots/')))]),
        ('text cards', [sum(1 for p in fm_before if fm_before[p] != fm_after.get(p) and p.startswith(('og/', 'social/', 'icons/screenshots/'))),
                        sum(1 for p in fm_before if p.startswith(('og/', 'social/', 'icons/screenshots/')))]),
        ('cards', [sum(1 for p in cards if cards_before[p] != cards_after[p]), len(cards)]),
        # images only: Contents.json and the adaptive XML do not depend on the master, and the background
        # colour XML changes only when the wash colour does
        ('native set', [sum(1 for p in prep_after if p.endswith('.png') and native_b.get(p) != prep_after[p]),
                        sum(1 for p in prep_after if p.endswith('.png'))]),
    ])
    os.makedirs(proof, exist_ok=True)
    sheet = proof_sheet(before_dir, native_before, root, prep, proof, old.get('name') or 'the old master', name, mo, mn, today)
    summary = OrderedDict([('date', today), ('old', OrderedDict([('name', old.get('name')), ('sha256', old.get('sha256'))])),
                           ('new', OrderedDict([('name', name), ('sha256', new_sha), ('source', os.path.basename(src))])),
                           ('changed', changed), ('metrics', OrderedDict([('old', mo), ('new', mn)])), ('native_out', prep),
                           ('prep_was_current', bool(prep_before) and prep_before == native_b)])
    with open(os.path.join(proof, 'summary.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(summary, indent=1, ensure_ascii=False) + '\n')
    print('\n  Changed (of each kind, how many differ from before):')
    for k, (a, b) in changed.items():
        print('    %-18s %d of %d' % (k, a, b))
    print('\nDone. The proof for the founder: %s' % sheet)
    print('Next: look at it; node tools/gates.js; then commit icons/ cap-web/ og/ articles/ social/ %s and push (push = deploy).' % REG_REL)
    print('The native set for the next app build is in %s (tools/cap_ios_build.sh regenerates ios/ from the master anyway).' % prep)
    return 0


# ---------------------------------------------------------------- the proof sheet

CW, CH, BOXW, BOXH = 780, 470, 360, 380


def _fit(im, w=BOXW, h=BOXH, bg=(246, 244, 240)):
    im = im.convert('RGBA')
    s = min(w / float(im.width), h / float(im.height))
    im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
    c = Image.new('RGB', (w, h), bg)
    c.paste(im, ((w - im.width) // 2, (h - im.height) // 2), im)
    return c


def _ios(path, size):
    im = Image.open(path).convert('RGB').resize((size, size), Image.LANCZOS)
    return rounded(im, IOS_RADIUS)


def _open(*cands):
    for p in cands:
        if p and os.path.exists(p):
            return p
    return None


def _home_cell(icon):
    c = Image.new('RGB', (BOXW, BOXH), (255, 255, 255))
    for i, dark in enumerate((False, True)):
        wp = wallpaper(BOXW, BOXH // 2, dark)
        if icon:
            ic = _ios(icon, 130)
            wp.paste(ic, ((BOXW - 130) // 2, 25), ic)
        c.paste(wp, (0, i * BOXH // 2))
    return c


def _masks_cell(maskable, rnd, fg, wash_xml):
    c = Image.new('RGB', (BOXW, BOXH), (255, 255, 255))
    wash = (0xFC, 0xEF, 0xCB)
    try:
        m = re.search(r'#([0-9A-Fa-f]{6})', open(wash_xml).read())
        wash = tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4))
    except (OSError, AttributeError, TypeError):
        pass
    for r, bg in enumerate((LIGHT_WALL, DARK_WALL)):
        panel = Image.new('RGB', (BOXW, BOXH // 2), bg)
        s, x = 100, 15
        if maskable:
            im = Image.open(maskable).convert('RGB').resize((s, s), Image.LANCZOS).convert('RGBA')
            im.putalpha(circle_mask(s))
            panel.paste(im, (x, 45), im)
        if rnd:
            im = Image.open(rnd).convert('RGBA').resize((s, s), Image.LANCZOS)
            panel.paste(im, (x + s + 15, 45), im)
        if fg:
            f = Image.open(fg).convert('RGBA')
            n = f.width
            base = Image.new('RGBA', (n, n), wash + (255,))
            base.alpha_composite(f)
            k = int(round(n * 72 / 108.0))
            o = (n - k) // 2
            im = base.crop((o, o, o + k, o + k)).resize((s, s), Image.LANCZOS)
            im = rounded(im.convert('RGB'), 0.30)
            panel.paste(im, (x + 2 * (s + 15), 45), im)
        c.paste(panel, (0, r * BOXH // 2))
    d = ImageDraw.Draw(c)
    for i, t in enumerate(('maskable', 'Android round', 'adaptive')):
        d.text((15 + i * 115 + 50, 165), t, fill=(120, 116, 110), font=font('sans-semi', 12), anchor='mm')
    return c


def _nav_cell(logo96, logo512, fav):
    """The left end of the top bar at 2x, unscaled (the logo the page loads, at 68px, beside the wordmark), and
    the favicon in a light and a dark tab at 2x."""
    src = logo96 or logo512
    c = Image.new('RGB', (BOXW, BOXH), (246, 244, 240))
    d = ImageDraw.Draw(c)
    d.text((12, 22), 'top bar at 2x (%s)' % ('logo-96' if logo96 else 'logo-512'), fill=SOFT, font=font('sans-semi', 13))
    if src:
        bar = nav_bar(Image.open(src), 2, width=360)
        c.paste(bar.crop((0, 0, BOXW, bar.height)), (0, 46))
    d.text((12, 182), 'favicon in a tab at 2x, light and dark', fill=SOFT, font=font('sans-semi', 13))
    if fav:
        for i, dark in enumerate((False, True)):
            tabs = browser_tabs(Image.open(fav).convert('RGBA'), dark)[1]
            c.paste(tabs.crop((0, 0, BOXW, tabs.height)), (0, 206 + i * (tabs.height + 14)))
    return c


def _card_cell(logo512):
    c = Image.new('RGB', (BOXW, BOXH), APP_CREAM)
    d = ImageDraw.Draw(c)
    d.rounded_rectangle([40, 40, BOXW - 40, BOXH - 40], radius=22, fill=(255, 255, 255))
    if logo512:
        lg = Image.open(logo512).convert('RGBA').resize((104, 104), Image.LANCZOS)
        mask = Image.new('L', (104 * 4, 104 * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, 104 * 4 - 1, 104 * 4 - 1], radius=26 * 4, fill=255)
        lg.putalpha(ImageChops.multiply(lg.getchannel('A'), mask.resize((104, 104), Image.LANCZOS)))
        c.paste(lg, ((BOXW - 104) // 2, 80), lg)
    d.text((BOXW // 2, 222), 'Cubby', fill=INK, font=font('serif', 34), anchor='mm')
    d.text((BOXW // 2, 262), 'the 52px logo of the sign-in card,', fill=SOFT, font=font('sans-semi', 13), anchor='mm')
    d.text((BOXW // 2, 280), 'at 2x (the email draws it at 56px)', fill=SOFT, font=font('sans-semi', 13), anchor='mm')
    return c


def _promo_cell(ph, track):
    c = Image.new('RGB', (BOXW, BOXH), (246, 244, 240))
    if ph:
        im = Image.open(ph).convert('RGB').crop((10, 6, 102, 98)).resize((168, 168), Image.LANCZOS)
        c.paste(im, (8, 100))
    if track:
        im = Image.open(track).convert('RGB').crop((34, 84, 164, 214)).resize((168, 168), Image.LANCZOS)
        c.paste(im, (184, 100))
    d = ImageDraw.Draw(c)
    d.text((8, 76), 'Product Hunt card', fill=SOFT, font=font('sans-semi', 13))
    d.text((184, 76), 'PWA promo card', fill=SOFT, font=font('sans-semi', 13))
    return c


def _phone(splash):
    if not splash:
        return Image.new('RGB', (BOXW, BOXH), (246, 244, 240))
    im = Image.open(splash).convert('RGB')
    n = im.width
    w = int(n * 390 / 844)
    x0 = (n - w) // 2
    return _fit(im.crop((x0, 0, x0 + w, n)))


def _minis(native, fav):
    c = Image.new('RGB', (BOXW, BOXH), (255, 255, 255))
    ios = os.path.join(native or '', 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset')
    picks = [(16, ('fav', fav)), (20, ('ios', 'AppIcon-ipad-20x20@1x.png')), (29, ('ios', 'AppIcon-ipad-29x29@1x.png')),
             (32, ('fav', fav)), (40, ('ios', 'AppIcon-ipad-40x40@1x.png')), (48, ('fav', fav)),
             (58, ('ios', 'AppIcon-iphone-29x29@2x.png')), (60, ('ios', 'AppIcon-iphone-20x20@3x.png'))]
    for r, dark in enumerate((False, True)):
        bg = Image.new('RGB', (BOXW, BOXH // 2), DARK_WALL if dark else LIGHT_WALL)
        x = 10
        for s, (kind, f) in picks:
            p = f if kind == 'fav' else os.path.join(ios, f)
            if p and os.path.exists(p):
                ic = Image.open(p).convert('RGBA').resize((s, s), Image.LANCZOS) if kind == 'fav' else _ios(p, s)
                bg.paste(ic, (x, 125 - s), ic)
            x += s + 4
        c.paste(bg, (0, r * BOXH // 2))
    return c


def proof_sheet(before, native_before, after_root, native_after, out_dir, old_name, new_name, mo, mn, today):
    """The founder's before/after sheet, in the layout of the W2+ proof (scratchpad brand-proof-teddy,
    2026-11-14): eight pairs in two columns, BEFORE left, AFTER right. Every panel is made from the files."""
    def side(tree, native):
        j = lambda p: os.path.join(tree, p)
        ios = os.path.join(native, 'ios', 'App', 'App', 'Assets.xcassets')
        res = os.path.join(native, 'android', 'app', 'src', 'main', 'res')
        return [
            _home_cell(_open(os.path.join(ios, 'AppIcon.appiconset', 'AppIcon-iphone-60x60@3x.png'), j('icons/apple-touch-icon.png'))),
            _masks_cell(_open(j('icons/icon-maskable-512.png')), _open(os.path.join(res, 'mipmap-xxxhdpi', 'ic_launcher_round.png')),
                        _open(os.path.join(res, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png')), os.path.join(res, 'values', 'ic_launcher_background.xml')),
            _nav_cell(_open(j('icons/logo-96.png')), _open(j('icons/logo-512.png')), _open(j('icons/favicon.png'))),
            _card_cell(_open(j('icons/logo-512.png'))),
            _fit(Image.open(_open(j('og/articles/baby-blues-explained.png'), j('og/articles.png')) or j('icons/logo-512.png'))),
            _promo_cell(_open(j('og/producthunt/ph-hero.png')), _open(j('icons/screenshots/track.png'))),
            _phone(_open(os.path.join(ios, 'Splash.imageset', 'splash-2732x2732.png'))),
            _minis(native, _open(j('icons/favicon.png'))),
        ]
    titles = ['Home-screen icon (iOS app, 60pt@3x)', 'Masked shapes (maskable, Android round, adaptive)', 'Website top bar and browser tab',
              'Sign-in card logo (52px)', 'Share card', 'Promo cards, the logo corner at 2x', 'iOS launch splash', 'Icon sizes 16 to 60px, light and dark']
    b, a = side(before, native_before), side(after_root, native_after)
    rows = (len(titles) + 1) // 2
    W, H = 2 * CW + 20, 132 + rows * CH
    can = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(can)
    d.text((20, 14), 'Cubby logo: before (%s) and after (%s)' % (old_name, new_name), fill=(30, 30, 30), font=font('sans-bold', 26))
    d.text((20, 54), 'Each pair: BEFORE on the left, AFTER on the right. Made by tools/brand.py set on %s from the files themselves; '
                     'look before you commit.' % today, fill=(110, 110, 110), font=font('sans-semi', 17))
    if mo and mn:
        d.text((20, 84), 'Fur vs background %s:1 -> %s:1.  Subject width %s%% -> %s%%.  Reach %s -> %s.' % (
            _fmt(mo['contrast_fur']), _fmt(mn['contrast_fur']), _fmt(mo['width_pct']), _fmt(mn['width_pct']), _fmt(mo['reach']), _fmt(mn['reach'])),
            fill=(60, 60, 60), font=font('sans-semi', 17))
    for i, t in enumerate(titles):
        x, y = 20 + (i % 2) * CW, 132 + (i // 2) * CH
        d.text((x, y + 6), t, fill=(30, 30, 30), font=font('sans-bold', 21))
        d.text((x, y + 36), 'BEFORE', fill=(150, 60, 50), font=font('sans-bold', 15))
        d.text((x + BOXW + 20, y + 36), 'AFTER', fill=(40, 110, 60), font=font('sans-bold', 15))
        can.paste(b[i], (x, y + 58))
        can.paste(a[i], (x + BOXW + 20, y + 58))
    out = os.path.join(out_dir, 'before-after.png')
    can.save(out, 'PNG', optimize=True)
    return out


# ---------------------------------------------------------------- self-test

def _fixture(path, n=1024, bg=(250, 238, 210), fg=(196, 128, 64), width=0.70, grain=True, dy=0.0):
    """A test subject for the self-test: one disc and two smaller discs above it, on a pale ground with a
    deterministic grain. Its width is 2.2 x the disc radius, so `width` is known exactly. (Not a picture: it
    lives in a temp folder for a few seconds and is never anywhere near the tree.)"""
    im = Image.new('RGB', (n, n), bg)
    d = ImageDraw.Draw(im)
    if grain:
        seed = 12345
        for _ in range(140):
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            x, y = seed % n, (seed >> 8) % n
            r = 8 + (seed >> 4) % 40
            k = -6 + (seed >> 12) % 12
            d.ellipse([x - r, y - r, x + r, y + r], fill=tuple(max(0, min(255, c + k)) for c in bg))
    r = width * n / 2.2
    cx, cy = n / 2.0, n / 2.0 + 0.05 * r + dy * n
    for ox in (-0.72 * r, 0.72 * r):
        rr = 0.38 * r
        d.ellipse([cx + ox - rr, cy - 0.72 * r - rr, cx + ox + rr, cy - 0.72 * r + rr], fill=fg)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fg)
    im.save(path, 'PNG')
    return path


def self_test():
    passed, failed = [0], [0]

    def ok(name, cond, extra=None):
        if cond:
            passed[0] += 1
            print('  ok   ' + name)
        else:
            failed[0] += 1
            print('  FAIL ' + name + ('\n         ' + str(extra)[:900] if extra is not None else ''))

    t0 = time.time()
    tmp = tempfile.mkdtemp(prefix='cubby-brandpy-selftest-')
    print('\nbrand.py self-test (scratch: %s)' % tmp)
    tracked = [MASTER_REL, REG_REL] + list(from_master_files(load_registry()))
    tree_before = _hash_all(ROOT, tracked)

    # -- the production recipe: brand.py draws sizes exactly as gen_brand_icons.py makes them.
    print('\nthe recipe brand.py renders with is the one the generators use')
    probe = os.path.join(tmp, 'probe')
    os.makedirs(probe)
    code = ('import sys; sys.path.insert(0, %r); import gen_brand_icons as g\nfrom PIL import Image\n'
            'm = Image.open(%r).convert("RGB")\nfor s in (16, 29, 60, 180):\n'
            '    g.rounded(g.resize(m, s), g.LOGO_RADIUS).save(%r %% s)\n') % (os.path.join(ROOT, 'tools'), os.path.join(ROOT, MASTER_REL), os.path.join(probe, 'gen-%d.png'))
    r = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True)
    master = Image.open(os.path.join(ROOT, MASTER_REL)).convert('RGB')
    same = r.returncode == 0 and all(
        list(Image.open(os.path.join(probe, 'gen-%d.png' % s)).getdata()) == list(rounded(prod_resize(master, s), LOGO_RADIUS).getdata()) for s in (16, 29, 60, 180))
    ok('16, 29, 60 and 180px come out pixel for pixel as tools/gen_brand_icons.py draws them', same, r.stdout + r.stderr)

    # -- measuring
    print('\ncompare: the numbers')
    good = _fixture(os.path.join(tmp, 'good.png'), width=0.70)
    faint = _fixture(os.path.join(tmp, 'faint.png'), bg=(250, 248, 244), fg=(242, 238, 230), width=0.70)
    wide = _fixture(os.path.join(tmp, 'wide.png'), width=1.0)
    small = _fixture(os.path.join(tmp, 'small.png'), width=0.40)
    flat = os.path.join(tmp, 'flat.png')
    Image.new('RGB', (1024, 1024), (250, 238, 210)).save(flat)
    mg = measure(Image.open(good))
    ok('measures a 70%%-wide subject as 70%% wide (got %.1f%%)' % mg['width_pct'], abs(mg['width_pct'] - 70.0) <= 1.5, mg)
    mf = measure(Image.open(faint))
    ok('scores a near-white subject on near-white below 1.2:1 (got %.2f:1), the good one above 2.5:1 (got %.2f:1)'
       % (mf['contrast_fur'], mg['contrast_fur']), mf['contrast_fur'] < 1.2 and mg['contrast_fur'] > 2.5, (mf, mg))
    mw = measure(Image.open(wide))
    ok('flags a subject that runs off the tile', mw['touches_edge'] and not mg['touches_edge'], mw)
    e_flat, e_good = edge_energy(Image.open(flat), 16), edge_energy(Image.open(good), 16)
    ok('edge energy is 0 on a flat tile and more on a subject (%.2f, %.2f)' % (e_flat, e_good), e_flat == 0 and e_good > 2, (e_flat, e_good))
    real = measure(master)
    cut, why = preflight(os.path.join(ROOT, MASTER_REL))
    m = re.search(r'reaches ([0-9.]+) of the half-size', why)
    gen_reach = float(m.group(1)) if m else -1
    ok('on the real master its reach agrees with the generators\' own cut (%.3f here, %.3f there)' % (real['reach'], gen_reach),
       cut and abs(real['reach'] - gen_reach) <= 0.03, why)

    print('\ncompare: the files')
    o1, o2 = os.path.join(tmp, 'cmp1'), os.path.join(tmp, 'cmp2')
    _, c1 = compare([good, faint, small], ['good', 'faint', 'small'], o1, current=True, quiet=True)
    compare([good, faint, small], ['good', 'faint', 'small'], o2, current=True, quiet=True)
    want = ['compare.html', 'context-light.png', 'homescreen.png', 'metrics.json', 'sizes.png', 'web.png']
    ok('writes %s' % ', '.join(want), sorted(os.listdir(o1)) == want, os.listdir(o1))
    ok('same inputs, same bytes (every file, two runs)', all(open(os.path.join(o1, f), 'rb').read() == open(os.path.join(o2, f), 'rb').read() for f in want))
    html = open(os.path.join(o1, 'compare.html'), encoding='utf-8').read()
    ok('compare.html shows all four pictures and a column per candidate, the current master first',
       all('src="%s"' % f in html for f in want if f.endswith('.png')) and html.index('now: ') < html.index('>good<') < html.index('>faint<'), html[:400])
    by = {c['name']: c for c in c1}
    ok('the faint one is the one the generators cannot cut, and set would refuse it', not by['faint']['cut']['ok'] and not by['faint']['set_accepts'], by['faint']['cut'])
    ok('and the good one they can, and set would take it', by['good']['cut']['ok'] and by['good']['set_accepts'], by['good']['cut'])
    ok('a 40%%-wide subject fits the maskable safe circle as it is, a 70%%-wide one is shrunk (%s, %s)'
       % (by['small']['masks']['maskable']['fits_as_is'], by['good']['masks']['maskable']['generator_scale']),
       by['small']['masks']['maskable']['fits_as_is'] and not by['good']['masks']['maskable']['fits_as_is'], (by['small']['masks'], by['good']['masks']))
    sz = Image.open(os.path.join(o1, 'sizes.png'))
    ok('sizes.png holds every candidate at %s on light and dark (%dx%d)' % ('/'.join(map(str, SIZES)), sz.width, sz.height),
       sz.width == 24 + sum(s + 24 for s in SIZES) and sz.height >= 4 * (2 * (512 + 48)), sz.size)
    try:
        compare([good], ['a', 'b'], os.path.join(tmp, 'cmp3'), quiet=True)
        ok('refuses two names for one image', False)
    except SystemExit as e:
        ok('refuses two names for one image', 'names' in str(e), e)

    # -- zoom
    print('\nzoom')
    z = os.path.join(tmp, 'z80.png')
    zoom(good, 80, z)
    mz = measure(Image.open(z))
    ok('zooms a 70%%-wide subject to 80%% (got %.1f%%), same size, RGB' % mz['width_pct'],
       abs(mz['width_pct'] - 80) <= 1.5 and Image.open(z).size == (1024, 1024) and Image.open(z).mode == 'RGB', mz)
    for pct, why, word in ((99, 'a crop that would bring the subject to the edge', 'edge'), (60, 'zooming out', 'only crops in')):
        dst = os.path.join(tmp, 'z%d.png' % pct)
        try:
            zoom(good, pct, dst)
            ok('refuses %s (%d%%)' % (why, pct), False)
        except SystemExit as e:
            ok('refuses %s (%d%%), and writes nothing' % (why, pct), word in str(e) and not os.path.exists(dst), e)

    # -- propose: a dry run only, with the network cut off underneath it
    print('\npropose (dry run only; fetch is replaced by a refusal for the whole node process)')
    block = os.path.join(tmp, 'no-network.js')
    open(block, 'w').write("globalThis.fetch = () => { throw new Error('brand.py self-test: no network'); };\n")
    env = dict(os.environ, NODE_OPTIONS=(os.environ.get('NODE_OPTIONS', '') + ' --require ' + block).strip(), OPENAI_API_KEY='', GEMINI_API_KEY='')
    vf = os.path.join(tmp, 'variants.json')
    json.dump({'base': 'App icon of this painted cub, face and ears only, centred.', 'variants': [
        {'name': 'honey', 'prompt': 'Light honey wash.'}, {'name': 'cream', 'prompt': 'Light cream wash.'}]}, open(vf, 'w'))
    pout = os.path.join(tmp, 'cands')
    ran_art = os.path.isdir(os.path.join(ROOT, 'art-src'))
    stdout, made = propose(os.path.join(ROOT, MASTER_REL), vf, pout, dry_run=True, env=env)
    reqs = re.findall(r'\[dry-run\] POST openai gpt-image-2  size=1024x1024  edit\(ref=[^)]*icon-master-1024\.png\)', stdout)
    ok('hands tools/gen_art.js one gpt-image-2 edit per variant, 1024x1024, the reference attached (%d)' % len(reqs), len(reqs) == 2, stdout)
    ok('a dry run writes nothing (no candidates folder, no art-src/)', not os.path.exists(pout) and os.path.isdir(os.path.join(ROOT, 'art-src')) == ran_art)
    for bad_spec, why in (([{'name': 'a b', 'prompt': 'x'}], 'a name that is not a slug'), ([{'name': 'a', 'prompt': ''}], 'an empty prompt'),
                          ([{'name': 'a', 'prompt': 'x'}, {'name': 'a', 'prompt': 'y'}], 'two variants with one name')):
        json.dump(bad_spec, open(vf, 'w'))
        try:
            propose(os.path.join(ROOT, MASTER_REL), vf, pout, dry_run=True, env=env)
            ok('refuses ' + why, False)
        except SystemExit as e:
            ok('refuses ' + why, 'propose:' in str(e), e)

    # -- set: the rules for a master, and a plan that writes nothing
    print('\nset: what it refuses, and the plan')
    big = os.path.join(tmp, 'big.png')
    Image.open(good).resize((2048, 2048)).save(big)
    cases = [('an RGBA file', lambda p: Image.open(good).convert('RGBA').save(p)),
             ('a non-square file', lambda p: Image.open(good).resize((1024, 1000)).save(p)),
             ('a file under 1024px', lambda p: Image.open(good).resize((1000, 1000)).save(p)),
             ('a palette file with a transparent colour', lambda p: Image.open(good).convert('P').save(p, transparency=0)),
             ('a greyscale file', lambda p: Image.open(good).convert('L').save(p)),
             ('an RGB file with a transparent colour', lambda p: Image.open(good).save(p, transparency=(250, 238, 210)))]
    for why, make in cases:
        p = os.path.join(tmp, 'bad-%d.png' % cases.index((why, make)))
        make(p)
        ok('refuses %s' % why, bool(validate_master_file(p)), validate_master_file(p))
    ok('takes a 2048px RGB file (it is resized to the 1024 master)', not validate_master_file(big) and prepared_master_bytes(big)[1] is not None)
    ok('takes a 1024 RGB PNG byte for byte', prepared_master_bytes(good) == (open(good, 'rb').read(), None))
    mirror = os.path.join(tmp, 'mirror.png')
    ImageOps.mirror(master).save(mirror, 'PNG', optimize=True)
    import io
    import contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc_faint = set_master(faint)
        rc_plan = set_master(mirror, provenance='self-test')
    out = buf.getvalue()
    ok('refuses a file the generators cannot cut, before writing anything', rc_faint == 2 and 'cannot cut' in out, out[:600])
    ok('without --yes it shows what would change and writes nothing', rc_plan == 0 and 'Nothing was written. Run the same command with --yes' in out
       and 'What `set --yes` changes' in out, out[-1500:])
    ok('the real tree is untouched by all of the above', _hash_all(ROOT, tracked) == tree_before)

    # -- the registry change, as a pure function
    print('\nset: the registry change')
    reg0 = OrderedDict([('master', OrderedDict([('path', MASTER_REL), ('sha256', 'M1'), ('name', 'one'), ('date', '2026-01-01'), ('provenance', 'p1')])),
                        ('families', [OrderedDict([('name', 'F'), ('from_master', True), ('files', OrderedDict([(MASTER_REL, 'M1'), ('icons/a.png', 'A1'), ('icons/b.png', 'B0')]))])]),
                        ('retired', [OrderedDict([('name', 'June'), ('sha256', OrderedDict([('icons/a.png', 'J1')])), ('git_blob', OrderedDict())])])])
    before = OrderedDict([(MASTER_REL, 'M1'), ('icons/a.png', 'A1'), ('icons/b.png', 'B0')])
    after = OrderedDict([(MASTER_REL, 'M2'), ('icons/a.png', 'A2'), ('icons/b.png', 'B0')])
    reg1, notes1 = next_registry(reg0, before, after, {'sha256': 'M2', 'name': 'two', 'provenance': 'p2'}, '2026-02-02',
                                 {MASTER_REL: 'blobM1', 'icons/logo-512.png': 'blobL1'})
    rs = reg1['retired'][-1]
    ok('retires the old master and what changed with it, not what did not (%s)' % dict(rs['sha256']),
       len(reg1['retired']) == 2 and dict(rs['sha256']) == {MASTER_REL: 'M1', 'icons/a.png': 'A1'} and rs['name'] == 'one' and rs['retired_on'] == '2026-02-02')
    ok('keeps the git blob of the old master for the gate\'s plants, and only blobs whose bytes it retired', dict(rs['git_blob']) == {MASTER_REL: 'blobM1'}, rs['git_blob'])
    ok('pins the new master and re-hashes the family', reg1['master']['sha256'] == 'M2' and reg1['master']['name'] == 'two'
       and dict(reg1['families'][0]['files']) == dict(after), reg1['master'])
    reg2, notes2 = next_registry(reg1, after, before, {'sha256': 'M1', 'name': 'one again', 'provenance': 'p1'}, '2026-03-03', {MASTER_REL: 'blobM2'})
    names = [s['name'] for s in reg2['retired']]
    ok('and when the old master comes back, its set leaves retirement and the one it replaces goes in (%s)' % names,
       names == ['June', 'two'] and any('taken out of retirement: one' in n for n in notes2), notes2)
    reg3, _ = next_registry(reg0, before, OrderedDict([(MASTER_REL, 'M2'), ('icons/a.png', 'J1'), ('icons/b.png', 'B0')]),
                            {'sha256': 'M2', 'name': 'two'}, '2026-02-02', {})
    ok('never leaves a hash retired that is approved again (the June set goes when its last hash comes back)',
       [s['name'] for s in reg3['retired']] == ['one'], [s['name'] for s in reg3['retired']])

    # -- set --yes, end to end, on a miniature copy of the tree
    print('\nset --yes, end to end, on a miniature tree (a git repo in the scratch folder)')
    mini = os.path.join(tmp, 'mini')
    reg = load_registry()
    keep = [MASTER_REL, REG_REL, '.assetsignore'] + ['tools/' + f for f in ('brand.py', 'gen_brand_icons.py', 'gen_splash.py', 'card_logo.py', 'brand_image_check.js')]
    keep += ['app/fonts/' + f for f in ('fraunces-600-latin.woff2', 'nunitosans-600-latin.woff2', 'nunitosans-700-latin.woff2', 'nunitosans-800-latin.woff2')]
    keep += list(from_master_files(reg))
    cards = _cards(ROOT)
    keep += [c for c in cards if c.startswith(('og/producthunt/', 'icons/screenshots/', 'social/'))]
    keep += [c for c in cards if c.startswith('og/articles/')][:2] + [c for c in cards if c.startswith('articles/')][:1]
    keep += [c for c in cards if c.endswith('baby-blues-explained.png')]
    for p in sorted(set(keep)):
        s = os.path.join(ROOT, p)
        if os.path.exists(s):
            os.makedirs(os.path.dirname(os.path.join(mini, p)), exist_ok=True)
            shutil.copy2(s, os.path.join(mini, p))
    gitc = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=brand-selftest', '-c', 'user.email=brand-selftest@localhost', '-c', 'commit.gpgsign=false']
    subprocess.run(['git', 'init', '-q'], cwd=mini, check=True)
    subprocess.run(gitc + ['add', '-A'], cwd=mini, check=True)
    subprocess.run(gitc + ['commit', '-q', '-m', 'mini tree'], cwd=mini, check=True)
    mini_set = os.path.join(mini, 'tools', 'brand.py')
    fm = list(from_master_files(reg))
    mcards = [l for l in subprocess.run([sys.executable, os.path.join(mini, 'tools', 'card_logo.py'), '--list'], cwd=mini, capture_output=True, text=True).stdout.split('\n') if l]
    h0 = _hash_all(mini, fm + mcards)
    nret0 = len(reg.get('retired') or [])
    proof = os.path.join(tmp, 'proof')
    t1 = time.time()
    r = subprocess.run([sys.executable, mini_set, 'set', mirror, '--name', 'the mirrored master', '--provenance', 'brand.py self-test',
                        '--yes', '--no-tree-gate', '--proof', proof], cwd=mini, capture_output=True, text=True)
    out = r.stdout + r.stderr
    ok('set --yes finishes, its checks green (%.0fs)' % (time.time() - t1), r.returncode == 0 and 'CARD LOGO: PASS' in out and 'BRAND ICONS: PASS' in out, out[-2500:])
    h1 = _hash_all(mini, fm + mcards)
    same = [p for p in h0 if h0[p] == h1[p]]
    ok('every icon and card made from the master changed (%d of %d)' % (len(h0) - len(same), len(h0)), not same, same)
    regm = load_registry(mini)
    ok('the master is the new file, pinned with its name, date and provenance', regm['master']['sha256'] == sha256_file(mirror) == sha256_file(os.path.join(mini, MASTER_REL))
       and regm['master']['name'] == 'the mirrored master' and regm['master']['provenance'] == 'brand.py self-test', regm['master'])
    new_set = (regm.get('retired') or [])[-1:] or [{}]
    ok('the retired list grew by one: %s, %d hashes, with the old master\'s git blob' % (new_set[0].get('name'), len(new_set[0].get('sha256', {}))),
       len(regm['retired']) == nret0 + 1 and new_set[0].get('sha256', {}).get(MASTER_REL) == reg['master']['sha256']
       and len(new_set[0]['sha256']) == len(fm) and MASTER_REL in new_set[0].get('git_blob', {}), new_set[0])
    ok('every from_master file is pinned at its new bytes', all(regm_h == h1[p] for fam in regm['families'] if fam.get('from_master') for p, regm_h in fam['files'].items()))
    summ = json.load(open(os.path.join(proof, 'summary.json')))
    nat = summ['changed']['native set']
    ok('the native set was regenerated into native-build/brand-native, every image changed (%d of %d)' % tuple(nat), nat[0] == nat[1] > 40, summ['changed'])
    sheet = Image.open(os.path.join(proof, 'before-after.png'))
    ok('and it drew the before/after proof (%dx%d)' % sheet.size, sheet.size == (2 * CW + 20, 132 + 4 * CH), sheet.size)
    r = subprocess.run([sys.executable, mini_set, 'set', os.path.join(ROOT, MASTER_REL), '--yes', '--no-tree-gate', '--proof', proof], cwd=mini, capture_output=True, text=True)
    ok('refuses to run again over its own uncommitted change (git could not undo it)', r.returncode == 3 and 'REFUSED' in r.stdout, r.stdout[-800:])
    ok('the real tree is still untouched', _hash_all(ROOT, tracked) == tree_before)

    shutil.rmtree(tmp, ignore_errors=True)
    print('\n%d passed, %d failed  (%.0fs)' % (passed[0], failed[0], time.time() - t0))
    print('BRAND-PY: ' + ('FAIL' if failed[0] else 'PASS') + '\n')
    return 1 if failed[0] else 0


# ---------------------------------------------------------------- command line

def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    if argv[:1] == ['--self-test']:
        return self_test()
    ap = argparse.ArgumentParser(prog='brand.py', description='Change Cubby\'s logo. docs/BRAND.md is the one-page flow.')
    sub = ap.add_subparsers(dest='cmd')
    c = sub.add_parser('compare', help='render and measure candidates side by side')
    c.add_argument('images', nargs='+')
    c.add_argument('--names', nargs='+')
    c.add_argument('--out')
    c.add_argument('--no-current', action='store_true', help='leave the current master out')
    p = sub.add_parser('propose', help='generate candidates with tools/gen_art.js')
    p.add_argument('--ref', required=True)
    p.add_argument('--variants', required=True)
    p.add_argument('--out')
    p.add_argument('--engine', default='openai', choices=['openai', 'gemini'])
    p.add_argument('--dry-run', action='store_true')
    p.add_argument('--no-compare', action='store_true')
    z = sub.add_parser('zoom', help='the centred crop that makes the subject PCT wide')
    z.add_argument('image')
    z.add_argument('--subject-width', type=float, required=True)
    z.add_argument('--out', required=True)
    s = sub.add_parser('set', help='make a file the master and regenerate everything from it')
    s.add_argument('image')
    s.add_argument('--provenance')
    s.add_argument('--name', help='a short name for it in the registry and the proof ("the W2+ painted teddy")')
    s.add_argument('--yes', action='store_true')
    s.add_argument('--native-out', help='where the native set goes (default native-build/brand-native, gitignored)')
    s.add_argument('--proof', help='where the before/after proof goes (default: a folder in the system temp)')
    s.add_argument('--date', help=argparse.SUPPRESS)
    s.add_argument('--no-tree-gate', action='store_true', help=argparse.SUPPRESS)   # the self-test's miniature tree only
    a = ap.parse_args(argv)
    if a.cmd == 'compare':
        compare(a.images, a.names, a.out, current=not a.no_current)
        return 0
    if a.cmd == 'propose':
        propose(a.ref, a.variants, a.out, a.dry_run, a.engine, run_compare=not a.no_compare)
        return 0
    if a.cmd == 'zoom':
        zoom(a.image, a.subject_width, a.out)
        return 0
    if a.cmd == 'set':
        return set_master(a.image, a.provenance, a.name, a.yes, a.native_out, a.proof, tree_gate=not a.no_tree_gate, today=a.date)
    ap.print_help()
    return 2


if __name__ == '__main__':
    sys.exit(main())
