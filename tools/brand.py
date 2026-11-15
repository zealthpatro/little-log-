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
    python3 tools/brand.py set b87.png --frame rim-shade --yes                    ...framed (none, rim, rim-shade, ring)
    python3 tools/brand.py native [--check]                                       ios/ and android/ from the master
    python3 tools/brand.py stamp [--check]                                        ?v= on every logo URL, from the registry
    python3 tools/brand.py --self-test                                            tools/gates.js runs this

compare   sizes.png (512 to 16px on light and dark), homescreen.png (60px between neutral app tiles on a
          blue-grey and a dark wallpaper), web.png (the top bar beside the real wordmark at 1x, 2x and 3x, and
          the browser-tab favicon at 16 and 32px), context-light.png (white and the site's cream), metrics.json
          and compare.html, which shows them with the numbers in one table. The current master is the first
          column unless --no-current. Each candidate is drawn twice, as painted and framed (--frame STYLE, else
          the registry's frame, else rim-shade), with the tile's edge measured against the site's cream and a
          dark ground both ways. Same inputs, same bytes. Every number is defined in METRICS below.
propose   writes a jobs file for tools/gen_art.js (gpt-image-2 by default, the reference image attached) and
          runs it, then compares what came back. --dry-run prints the requests and sends nothing.
zoom      the square crop, centred on the subject, that makes it PCT wide, resized back to the input's size.
          That is the W2+ step: from its source (icon4-cream-honey) at 87.1% it gives W2+ back at 30.7 dB PSNR,
          where a crop centred on the image gives 18 dB. It only crops in, and refuses when the subject would
          come within 1/128 of an edge (the cut in tools/gen_brand_icons.py needs clear wash all round).
set       the one command for a logo change. Validates the file (square, at least 1024, RGB, no alpha), asks
          the generators whether they can cut it, and shows what will change. --frame STYLE changes the frame
          every tile is drawn with (tools/brand_style.py; default: keep the registry's), on a new master or on
          the same one. With --yes it copies it to
          icons/icon-master-1024.png and runs every generator: the web icons and the small nav logos, the
          native set into native-build/brand-native (gitignored, outside what the site serves), the splash,
          every card's logo (tools/card_logo.py --swap --force), then re-pins tools/brand-images.json (the
          master's sha256, provenance and date; the two families made from the master re-hashed; the card
          digests re-approved), moves the old master and everything made from it into a retired set (and takes
          a set OUT of retirement when its master comes back), puts the new ?v=<version> on every reference to
          a file made from the master (pages, manifests, both service workers' lists, worker.js's emails,
          cap-web/) and bumps app/sw.js's CACHE so installed apps fetch them, runs the brand gate's static
          half, card_logo --check and gen_brand_icons --check, and draws a before/after proof sheet.
          When this tree has ios/ or android/ (gitignored; any checkout that has built the app), set remakes
          their icons, splash and the offline logo in public/ in place and checks them, because the brand
          gate reads them with every file git tracks and would find the old master's bytes there (verifier
          M1, 2026-11-14). It never reads a nested checkout or gitignored scratch (tree_files; verifier M1b).
native    remakes ios/ and android/ from the master as set does (the undo after git restore, which cannot
          reach them); --check writes nothing and fails on any file that is not what the master gives.
stamp     puts the registry's url_version on every reference to a file made from the master (a page copied
          from an older one, a new generator template); --check writes nothing and lists the stale ones.
          /icons/* is cached for 30 days (_headers), so a reference without the current version can show a
          visitor the previous logo for a month (founder, 2026-11-15).

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
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from collections import OrderedDict

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps, ImageStat

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brand_style  # noqa: E402  the frame and the URL version, one implementation for every generator

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER_REL = 'icons/icon-master-1024.png'
REG_REL = 'tools/brand-images.json'
PREP_REL = os.path.join('native-build', 'brand-native')   # gitignored and in .assetsignore
FONTS = os.path.join(ROOT, 'app', 'fonts')
# This tree's own native projects (gitignored; `npx cap add` makes them). tools/cap_ios_build.sh writes the
# master's icons and splash into ios/ (gen_app_icon.py, gen_splash.py) and `cap copy` puts cap-web/logo.png
# in each public/ folder, so after any build they hold the master's bytes. The brand gate reads the whole
# tree for retired bytes, so a set that left them alone failed its own last check in any checkout that had
# built the app (brand verifier M1, 2026-11-14). set refreshes them in place; `brand.py native` does it alone.
NATIVE_TOPS = ('ios', 'android')
NATIVE_PUBLIC = ('ios/App/App/public/logo.png', 'android/app/src/main/assets/public/logo.png')
CAP_LOGO = 'cap-web/logo.png'
SW_REL = 'app/sw.js'

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
    ('edge_cream', 'Tile edge vs the site\'s cream: WCAG contrast of the mean colour of the 512px tile\'s outer 2% '
                   '(inside its rounded corner) against #FBF5E9, as painted and with the frame. This is what makes the '
                   'tile stand out in the top bar: the painted wash is nearly the page\'s own colour.'),
    ('edge_dark', 'Tile edge vs a dark ground (#1C1C1E, the dark wallpaper and the app\'s Night landing): the same, '
                  'as painted and framed.'),
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
    return brand_style.rounded(img, frac, ss)


NO_FRAME = brand_style.FRAMES['none']


def tile(img, size, frame=None, radius=LOGO_RADIUS):
    """Exactly tools/gen_brand_icons.tile(): resized, framed along its own corner, corners cut."""
    return rounded(brand_style.framed(prod_resize(img, size), frame or NO_FRAME, radius), radius)


def ios_icon(img, size, frame=None):
    """A square icon as iOS shows it: tools/gen_brand_icons.square() (framed along the iOS corner, its
    corners rim), then cut by the iOS corner."""
    return rounded(brand_style.framed(prod_resize(img, size), frame or NO_FRAME, IOS_RADIUS), IOS_RADIUS)


def tile_edge(t):
    """The mean colour of a tile's outer 2% band, inside its rounded corner (alpha 255)."""
    a = t.getchannel('A').point(lambda v: 255 if v == 255 else 0)
    inner = a
    for _ in range(max(1, int(round(t.size[0] * 0.02)))):
        inner = inner.filter(ImageFilter.MinFilter(3))
    band = ImageChops.subtract(a, inner)
    return tuple(ImageStat.Stat(t.convert('RGB'), band).mean)


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


def frame_metrics(img, frame):
    """The tile's edge against the site's cream and a dark ground, as painted and framed (METRICS)."""
    plain, framed_ = tile_edge(tile(img, 512)), tile_edge(tile(img, 512, frame))
    return OrderedDict([('style', frame.get('style')), ('frame', brand_style.describe(frame)),
                        ('edge_plain', hexc(plain)), ('edge_framed', hexc(framed_)),
                        ('edge_cream_plain', round(contrast(plain, SITE_CREAM), 2)), ('edge_cream_framed', round(contrast(framed_, SITE_CREAM), 2)),
                        ('edge_dark_plain', round(contrast(plain, DARK_WALL), 2)), ('edge_dark_framed', round(contrast(framed_, DARK_WALL), 2))])


def candidate_metrics(img, info, path=None, frame=None):
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
    if frame:
        out['frame'] = frame_metrics(img, frame)
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


def render_sizes(img, name, frame=None):
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
            ic = ios_icon(img, s, frame)
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


def render_homescreen(img, name, s=60, frame=None):
    cols, rows, gx, gy = 4, 3, 28, 30
    pw = cols * s + (cols + 1) * gx
    ph = rows * (s + 18) + (rows + 1) * gy
    block = Image.new('RGB', (2 * pw + 20, ph + 40), (255, 255, 255))
    d = ImageDraw.Draw(block)
    _label(d, (0, 8), name, 22)
    me = ios_icon(img, s, frame)
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


# site.css .nav-brand img: filter: drop-shadow(0 2px 6px rgba(60,40,25,.18)) (founder, 2026-11-15). A CSS
# shadow's blur is twice the Gaussian's standard deviation.
NAV_SHADOW = (0, 2, 6, (60, 40, 25), 0.18)


def drop_shadow(canvas, logo, xy, k, shadow=NAV_SHADOW):
    """Paint `logo`'s CSS drop-shadow onto `canvas` under where it will sit, at device pixel ratio k."""
    dx, dy, blur, rgb_, alpha = shadow
    pad = int(3 * blur * k) + 2
    a = Image.new('L', (logo.width + 2 * pad, logo.height + 2 * pad), 0)
    a.paste(logo.getchannel('A'), (pad, pad))
    a = a.filter(ImageFilter.GaussianBlur(blur * k / 2.0)).point(lambda v: int(round(v * alpha)))
    canvas.paste(Image.new('RGB', a.size, rgb_), (xy[0] - pad + int(round(dx * k)), xy[1] - pad + int(round(dy * k))), a)


def nav_bar(logo_src, dpr, width=640):
    """The site's top bar (site.css .nav-in / .nav-brand) at `dpr`: the 34px logo with its drop shadow, 9px
    gap, the Fraunces 600 21px wordmark, the tabs and the pink button, on the bar's cream. `logo_src` is what
    the page loads."""
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
    drop_shadow(bar, lg, (x, (h - n) // 2), k)
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


def render_web(img, name, frame=None):
    logo96 = tile(img, 96, frame)
    logo192 = tile(img, 192, frame)
    fav48 = tile(img, 48, frame)
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


def render_context(img, name, frame=None):
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
            ic = tile(img, s, frame)
            panel.paste(ic, (x, (row - s) // 2), ic)
            x += s + pad
        block.paste(panel, (p * (w + 20), 40))
        _label(d, (p * (w + 20), 40 + row + 4), label + ': ' + ', '.join('%dpx%s' % (s, ' ' + wh if wh else '') for s, wh in sizes), 13, SOFT)
    return block


def _fmt(v):
    return ('%.2f' % v).rstrip('0').rstrip('.') if isinstance(v, float) else str(v)


def compare_html(cands, frame=None):
    usable = [c['set_accepts'] for c in cands]

    def row(key, title, values, best=None, unit=''):
        # The best value is shaded among the candidates set would accept: a file the generators cannot cut
        # is not a choice, however well it scores.
        cells = []
        nums = [v for v, u in zip(values, usable) if u and isinstance(v, (int, float)) and not isinstance(v, bool)]
        top = (max(nums) if best == 'max' else min(nums)) if (best and nums) else None
        for v, u in zip(values, usable):
            s = (_fmt(v) + unit) if not isinstance(v, str) else v
            cells.append('<td%s>%s</td>' % (' class="best"' if (u and top is not None and v == top and len(nums) > 1) else '', s))
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
        row('edge_cream', 'Tile edge vs the site\'s cream, as painted', [c['frame']['edge_cream_plain'] for c in cands], 'max', ':1'),
        row('edge_cream', 'Tile edge vs the site\'s cream, framed', [c['frame']['edge_cream_framed'] for c in cands], 'max', ':1'),
        row('edge_dark', 'Tile edge vs a dark ground, as painted', [c['frame']['edge_dark_plain'] for c in cands], 'max', ':1'),
        row('edge_dark', 'Tile edge vs a dark ground, framed', [c['frame']['edge_dark_framed'] for c in cands], 'max', ':1'),
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
<p>Made by <code>python3 tools/brand.py compare</code>. Same inputs, same bytes. Hover a row name for what it measures; the best of each measured row is shaded, among the candidates set would accept. Every picture shows each candidate as painted, then framed (%s).</p>
<div class="wrap"><table><thead><tr><th></th>%s</tr></thead><tbody>
%s
</tbody></table></div>
<h2>Sizes, 512 to 16px, light and dark</h2><img src="sizes.png" alt="Each candidate at eight sizes on light and dark wallpaper">
<h2>Home screen, 60px between other apps</h2><img src="homescreen.png" alt="Each candidate on a home screen">
<h2>The site's top bar and a browser tab</h2><img src="web.png" alt="Each candidate in the top bar and as a favicon">
<h2>On white and on the site's cream</h2><img src="context-light.png" alt="Each candidate on white and cream">
<h2>What each number means</h2><dl>%s</dl>
<p>Pick one, then: <code>python3 tools/brand.py set FILE --frame %s --provenance "..."</code> shows what would change; add <code>--yes</code> to do it.</p>
</main></body></html>
""" % (brand_style.describe(frame or NO_FRAME), head, '\n'.join(rows), defs, (frame or NO_FRAME)['style'])


def compare_frame(frame=None, root=None):
    """The frame compare draws: the one asked for, else the registry's, else rim-shade (so the framed column
    always shows a frame)."""
    if frame:
        return frame
    try:
        f = brand_style.frame_of(load_registry(root))
    except (OSError, ValueError):
        f = NO_FRAME
    return f if f.get('style') != 'none' else brand_style.FRAMES['rim-shade']


def compare(paths, names=None, out=None, current=True, quiet=False, frame=None):
    names = list(names or [])
    frame = compare_frame(frame)
    framed_name = lambda nm: nm + ' + ' + frame['style']
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
        cands.append(candidate_metrics(img, info, p, frame))
        blocks['sizes'] += [render_sizes(img, name), render_sizes(img, framed_name(name), frame)]
        blocks['homescreen'] += [render_homescreen(img, name), render_homescreen(img, framed_name(name), frame=frame)]
        blocks['web'] += [render_web(img, name), render_web(img, framed_name(name), frame)]
        blocks['context-light'] += [render_context(img, name), render_context(img, framed_name(name), frame)]
    for k, bl in blocks.items():
        _stack(bl, gap=24).save(os.path.join(out, k + '.png'), 'PNG', optimize=True)
    doc = OrderedDict([('tool', 'tools/brand.py compare'), ('metrics', METRICS), ('frame', frame), ('candidates', cands)])
    with open(os.path.join(out, 'metrics.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(doc, indent=1, ensure_ascii=False) + '\n')
    with open(os.path.join(out, 'compare.html'), 'w', encoding='utf-8') as f:
        f.write(compare_html(cands, frame))
    if not quiet:
        print('\n  framed as %s' % brand_style.describe(frame))
        print('\n  %-28s %8s %8s %7s %7s %7s %15s  %s' % ('', 'fur', 'subject', 'e29', 'e16', 'width', 'edge on cream', 'set accepts'))
        for c in cands:
            print('  %-28s %7.2f: %7.2f: %7.2f %7.2f %6.1f%% %5.2f -> %5.2f:  %s' % (c['name'][:28], c['subject']['contrast_fur'], c['subject']['contrast_subject'],
                                                              c['edge_energy']['29'], c['edge_energy']['16'], c['subject']['width_pct'],
                                                              c['frame']['edge_cream_plain'], c['frame']['edge_cream_framed'],
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
    bx0, by0, bx1, by1 = (v * n for v in m['bbox'])
    # centred on the subject (its bounding box), kept inside the image
    x0 = min(max((bx0 + bx1) / 2.0 - side / 2.0, 0.0), n - side)
    y0 = min(max((by0 + by1) / 2.0 - side / 2.0, 0.0), n - side)
    margin = min(bx0 - x0, by0 - y0, x0 + side - bx1, y0 + side - by1) * n / side
    need = n / 128.0
    if margin < need:
        raise SystemExit('zoom: at %.1f%% the subject would come within %.1fpx of the edge (it needs %.0fpx of clear '
                         'ground for the cut in tools/gen_brand_icons.py); nothing written' % (pct, max(0.0, margin), need))
    res = rgb.resize((n, n), Image.LANCZOS, box=(x0, y0, x0 + side, y0 + side))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    res.save(out, 'PNG', optimize=True)
    got = measure(res)
    print('zoom: subject %.1f%% -> %.1f%% wide (asked %.1f%%), a %.1fpx crop at (%.1f, %.1f) centred on it, resized back to %dpx: %s'
          % (cur, got['width_pct'], pct, side, x0, y0, n, out))
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


def with_style(reg, frame, version):
    """The registry with its "frame" and "url_version" set, both right after "master"."""
    out = OrderedDict()
    for k, v in reg.items():
        if k in ('frame', 'url_version'):
            continue
        out[k] = v
        if k == 'master':
            out['frame'] = OrderedDict(frame)
            out['url_version'] = version
    if 'frame' not in out:
        out['frame'] = OrderedDict(frame)
        out['url_version'] = version
    return out


def from_master_files(reg):
    """Every file the registry pins that is made from the master (families marked from_master), with its pin."""
    out = OrderedDict()
    for fam in reg.get('families', []):
        if fam.get('from_master'):
            for p, h in fam.get('files', {}).items():
                out[p] = h
    return out


def next_registry(reg, before, after, new_master, today, blobs):
    """The registry after a master or frame change. Pure, so the self-test can drive it with made-up hashes.
      before/after  {path: sha256} of the master and every from_master file, read from disk
      new_master    {'sha256', 'name', 'provenance'} and, when the frame is set, 'frame' and 'url_version'
      blobs         {path: git blob id} of the OLD files, for the gate's self-test plants
    Returns (registry, notes). The old master and each from_master file whose bytes changed go into a new
    retired set (a new frame alone retires the old frame's icons and cards: the master stays); no hash that
    is now approved stays retired, so a set whose files are all approved again (its master back, in its
    frame) leaves retirement, and one whose master is back in another frame keeps only the other frame's
    files."""
    reg = json.loads(json.dumps(reg), object_pairs_hook=OrderedDict)
    notes = []
    old = reg.get('master', {})
    old_sha = old.get('sha256')
    old_frame = reg.get('frame') or brand_style.FRAMES['none']
    new_frame = new_master.get('frame', old_frame)
    frame_changed = brand_style.canonical(old_frame) != brand_style.canonical(new_frame)
    changed = OrderedDict((p, h) for p, h in before.items() if after.get(p) != h)
    master_path = old.get('path', MASTER_REL)
    keep = list(reg.get('retired') or [])
    back = set(s.get('name') for s in keep if new_master['sha256'] in (s.get('sha256') or {}).values())
    if old_sha and (old_sha != new_master['sha256'] or frame_changed) and changed:
        rs = OrderedDict()
        rs['name'] = old.get('name') or ('the master pinned %s' % old_sha[:8])
        if old_sha == new_master['sha256']:
            rs['name'] += ', ' + ('unframed' if old_frame.get('style', 'none') == 'none' else 'with the %s frame' % old_frame.get('style'))
        if old_sha == new_master['sha256']:
            rs['why'] = ('The icons and text cards of the master from %s as they were framed (%s), retired %s by tools/brand.py '
                         'set when the frame became %s: the master stays, these bytes of it go. The share cards and heroes are '
                         'held by tools/card_logo.py --check and their pinned digests.'
                         % (old.get('date', 'an earlier date'), brand_style.describe(old_frame), today, brand_style.describe(new_frame)))
        else:
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
        if not s.get('sha256') and s.get('name') in back:
            notes.append('taken out of retirement: %s (its master is the master again)' % s.get('name'))
        elif gone:
            notes.append('%s: %d hash%s now approved again, no longer retired' % (s.get('name'), len(gone), '' if len(gone) == 1 else 'es'))
    reg['retired'] = [s for s in keep if s.get('sha256')]
    m = OrderedDict()
    m['path'] = master_path
    m['sha256'] = new_master['sha256']
    m['name'] = new_master.get('name') or ''
    m['date'] = today
    m['provenance'] = new_master.get('provenance') or ''
    reg['master'] = m
    if 'frame' in new_master or 'url_version' in new_master:
        reg = with_style(reg, new_frame, new_master.get('url_version') or brand_style.version_for(new_master['sha256'], new_frame))
    for fam in reg.get('families', []):
        if fam.get('from_master'):
            for p in list(fam.get('files', {})):
                if p in after:
                    fam['files'][p] = after[p]
    return reg, notes


# ---------------------------------------------------------------- versioned logo URLs

# What the brand gate reads for image references (tools/brand_image_check.js staticScan): the tree's text
# files outside these folders, never app/vendor/ or tools/. stamp writes exactly where the gate looks.
SKIP_DIRS = {'.git', 'node_modules', 'tools', 'test', 'docs', 'art-src', '.claude', '.githooks', '_local', 'native-build', 'ios',
             'android', 'credentials', 'App'}
TEXT_EXT = ('.html', '.htm', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.xml', '.txt')


def ref_text_files(root):
    """The text files the brand gate reads for image references (tools/brand_image_check.js staticScan): the
    tree's (tree_files), outside SKIP_DIRS, never app/vendor/ or tools/. stamp writes exactly where it looks."""
    out = []
    for p in tree_files(root)[1]:
        parts = p.split('/')
        low = p.lower()
        if any(d in SKIP_DIRS for d in parts[:-1]) or not low.endswith(TEXT_EXT) or low.endswith('.md'):
            continue
        if '/app/vendor/' in '/' + p or '/tools/' in '/' + p or p.endswith('brand-images.json'):
            continue
        out.append(p)
    return out


def logo_refs(root, version, reg=None):
    """{file: (references to a file made from the master, of them carrying `version`)} for every text file
    the brand gate reads that has any."""
    reg = reg or load_registry(root)
    versioned, names = set(brand_style.versioned_paths(reg)), brand_style.approved_names(reg)
    out = OrderedDict()
    for f in ref_text_files(root):
        try:
            text = open(os.path.join(root, f), encoding='utf-8').read()
        except (OSError, UnicodeDecodeError):
            continue
        _, refs, current = brand_style.stamp_text(text, f, root, versioned, version, names)
        if refs:
            out[f] = (refs, current)
    return out


def stamp_tree(root, version, reg=None):
    """Put ?v=<version> on every reference to a file made from the master. Returns the files it rewrote."""
    reg = reg or load_registry(root)
    versioned, names = set(brand_style.versioned_paths(reg)), brand_style.approved_names(reg)
    done = []
    for f in ref_text_files(root):
        fp = os.path.join(root, f)
        try:
            text = open(fp, encoding='utf-8').read()
        except (OSError, UnicodeDecodeError):
            continue
        new, refs, _ = brand_style.stamp_text(text, f, root, versioned, version, names)
        if refs and new != text:
            with open(fp, 'w', encoding='utf-8', newline='') as fh:
                fh.write(new)
            done.append(f)
    return done


def stale_refs(root, version, reg=None):
    """Every reference to a file made from the master that does not carry ?v=<version>, as 'file:line  text'."""
    reg = reg or load_registry(root)
    versioned, names = set(brand_style.versioned_paths(reg)), brand_style.approved_names(reg)
    out = []
    for f in ref_text_files(root):
        try:
            text = open(os.path.join(root, f), encoding='utf-8').read()
        except (OSError, UnicodeDecodeError):
            continue
        for m, p in brand_style.refs_in(text, f, root, names):
            if p not in versioned:
                continue
            if brand_style.carries(text, m.end(), version):
                continue
            vm = brand_style.VER_RE.match(text, m.end())
            line = text.count('\n', 0, m.start()) + 1
            out.append('%s:%d  %s%s' % (f, line, (m.group(2) + '.' + m.group(3)).strip(), ('?v=' + vm.group(1)) if vm else ' (no version)'))
    return out


def bump_sw(root):
    """app/sw.js CACHE little-log-vN -> vN+1, so an installed app precaches the new logo URLs. Returns (N, N+1)."""
    fp = os.path.join(root, SW_REL)
    text = open(fp, encoding='utf-8').read()
    m = re.search(r"(const CACHE = 'little-log-v)(\d+)(';)", text)
    if not m:
        raise SetFailed('cannot find "const CACHE = \'little-log-vN\';" in %s' % SW_REL)
    n = int(m.group(2))
    with open(fp, 'w', encoding='utf-8', newline='') as fh:
        fh.write(text[:m.start()] + m.group(1) + str(n + 1) + m.group(3) + text[m.end():])
    return n, n + 1


def stamp(check=False, root=None):
    """`brand.py stamp`: every logo URL to the registry's url_version (written first if it is missing or not
    what the master and frame give). --check writes nothing and fails on a stale one."""
    root = root or ROOT
    reg = load_registry(root)
    want = brand_style.version_for(reg['master']['sha256'], brand_style.frame_of(reg))
    print('brand.py stamp%s: url_version %s (the master %s, %s)' % (' --check' if check else '', want, reg['master']['sha256'][:12],
                                                                   brand_style.describe(brand_style.frame_of(reg))))
    if check:
        bad = stale_refs(root, want, reg)
        if reg.get('url_version') != want:
            bad.insert(0, '%s url_version is %r' % (REG_REL, reg.get('url_version')))
        for b in bad[:25]:
            print('  STALE ' + b)
        refs = logo_refs(root, want, reg)
        print('STAMP: ' + ('FAIL (%d stale; python3 tools/brand.py stamp rewrites them)' % len(bad) if bad
                           else 'PASS (%d references in %d files carry ?v=%s)' % (sum(r for r, _ in refs.values()), len(refs), want)))
        return 1 if bad else 0
    if reg.get('url_version') != want:
        write_registry(with_style(reg, brand_style.frame_of(reg), want), root)
        print('  wrote url_version %s into %s' % (want, REG_REL))
    done = stamp_tree(root, want, reg)
    print('  rewrote %d file%s' % (len(done), '' if len(done) == 1 else 's'))
    left = stale_refs(root, want, reg)
    for b in left[:10]:
        print('  LEFT ' + b)
    return 1 if left else 0


# ---------------------------------------------------------------- set

class SetFailed(Exception):
    pass


# A pre-push hook in a worktree exports GIT_DIR (and git may set others), and every git below inherits them:
# run in a scratch folder, `git init; git add -A; git commit` then commits that folder onto the branch being
# pushed (shown 2026-11-14). So git here always finds its repo from the folder it runs in.
GIT_LOCAL_VARS = ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
                  'GIT_PREFIX', 'GIT_IMPLICIT_WORK_TREE', 'GIT_NAMESPACE', 'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_NO_REPLACE_OBJECTS')


def git_env():
    return {k: v for k, v in os.environ.items() if k not in GIT_LOCAL_VARS}


def _git(args, root):
    r = subprocess.run(['git'] + args, cwd=root, capture_output=True, text=True, env=git_env())
    return r.returncode, r.stdout.strip()


# Paths go to git as pathspecs, where '*', '?' and '[' are patterns: a card named og/articles/q*.png also
# matched og/articles/qa/notes.png, so the dirty check reported a file set never writes, and the printed undo
# (git restore --pathspec-from-file) would have thrown away an edit to it. Every path set hands git is literal.
LITERAL = '--literal-pathspecs'


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


NEVER_DIRS = ('.git', 'node_modules', '.wrangler', '_local', 'native-build')


def _is_checkout(d):
    return os.path.exists(os.path.join(d, '.git'))


def _walk_files(d, root):
    """Files under d on disk, never inside NEVER_DIRS or a folder that is its own checkout (a .git file or folder)."""
    out = []
    for base, dirs, files in os.walk(d):
        dirs[:] = sorted(x for x in dirs if x not in NEVER_DIRS and not _is_checkout(os.path.join(base, x)))
        out += [rel(os.path.join(base, f), root) for f in sorted(files) if os.path.isfile(os.path.join(base, f)) and not os.path.islink(os.path.join(base, f))]
    return out


def tree_files(root):
    """What this repo ships or builds, the brand gate's rule (tools/brand_image_check.js treeFiles): in a git
    checkout's top folder, the files git tracks (the index) plus ios/ and android/ (gitignored, built from this
    checkout); in any other folder, every file on disk; never a nested checkout (the ~67 worktrees under
    .claude/worktrees/ in the main checkout: verifier M1b), node_modules, .wrangler, _local/ or native-build/.
    Returns (how, [paths])."""
    code, top = _git(['rev-parse', '--show-toplevel'], root)
    if code != 0 or not top or os.path.realpath(top) != os.path.realpath(root):
        return 'disk', _walk_files(root, root)
    r = subprocess.run(['git', 'ls-files', '-z', '--cached'], cwd=root, capture_output=True, env=git_env())
    if r.returncode != 0:
        raise SetFailed('git ls-files failed in %s: %s' % (root, r.stderr.decode('utf-8', 'replace')))
    ok_dir = {'': True}

    def dir_ok(d):
        if d not in ok_dir:
            parent, name = (d.rsplit('/', 1) if '/' in d else ('', d))
            ok_dir[d] = dir_ok(parent) and name not in NEVER_DIRS and not _is_checkout(os.path.join(root, d))
        return ok_dir[d]
    files, seen = [], set()
    for p in r.stdout.decode('utf-8', 'surrogateescape').split('\0'):
        if not p or p in seen:
            continue
        seen.add(p)
        full = os.path.join(root, p)
        if dir_ok(p.rsplit('/', 1)[0] if '/' in p else '') and os.path.isfile(full) and not os.path.islink(full):
            files.append(p)
    for t in NATIVE_TOPS:
        d = os.path.join(root, t)
        if os.path.isdir(d) and not _is_checkout(d):
            files += [p for p in _walk_files(d, root) if p not in seen]
    return 'git', sorted(files)


def retired_in_tree(root, hashes):
    """The files of this tree (tree_files) that are images whose bytes are in `hashes`: the brand gate's
    retired-bytes check (tools/brand_image_check.js staticScan), for trees too small for the whole gate."""
    out = []
    for p in tree_files(root)[1]:
        f = os.path.join(root, p)
        if re.search(r'\.(png|jpe?g|webp|gif|ico|avif)$', p, re.I) and os.path.getsize(f) <= 20 * 1024 * 1024 and sha256_file(f) in hashes:
            out.append(p)
    return out


def native_tops(root):
    """The native projects this tree has (ios/, android/), the ones set refreshes in place."""
    return [t for t in NATIVE_TOPS if os.path.isdir(os.path.join(root, t))]


def native_targets(root, fresh):
    """{path in the tree: the file it should hold} for this tree's native projects. `fresh` is a native set and
    splash just made from the master (gen_brand_icons.py --native-out, gen_splash.py --out), laid out as ios/
    and android/. A project that is not here is not created; the offline logo in a public/ folder is refreshed
    only where `cap copy` has already put one (cap copy owns that folder)."""
    out = OrderedDict()
    for top in native_tops(root):
        for p, _ in _tree_hashes(os.path.join(fresh, top)).items():
            out[top + '/' + p] = os.path.join(fresh, top, p)
    for p in NATIVE_PUBLIC:
        if os.path.exists(os.path.join(root, p)):
            out[p] = os.path.join(root, CAP_LOGO)
    return out


def native_drift(root, fresh):
    """The native files in this tree that are not what the master gives (missing or different)."""
    bad = []
    for p, src in native_targets(root, fresh).items():
        dst = os.path.join(root, p)
        if not os.path.exists(dst) or sha256_file(dst) != sha256_file(src):
            bad.append(p)
    return bad


def refresh_native(root, fresh):
    """Write the master's native set into this tree's ios/ and android/ (only those that exist). Returns the paths."""
    done = []
    for p, src in native_targets(root, fresh).items():
        dst = os.path.join(root, p)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(src, dst)
        done.append(p)
    return done


def make_native(root, out, log):
    """The native set and splash from the CURRENT master, into `out` (nothing in the tree is written)."""
    _step('the native set from the master', [sys.executable, 'tools/gen_brand_icons.py', '--native-out', out, '--no-web'], root, log)
    _step('the native splash from the master', [sys.executable, 'tools/gen_splash.py', '--out', out], root, log)


def native(check=False, root=None):
    """`brand.py native`: bring this tree's ios/ and android/ in step with the master (after an undo of set with
    git restore, which cannot reach these gitignored folders). --check writes nothing and fails on any drift."""
    root = root or ROOT
    tops = native_tops(root)
    print('brand.py native%s: %s' % (' --check' if check else '', ', '.join(t + '/' for t in tops) or 'no ios/ or android/ in this tree'))
    if not tops:
        print('Nothing to do: there is no native project here (`npx cap add ios` makes one).')
        return 0
    tmpd = tempfile.mkdtemp(prefix='cubby-brand-native-')
    try:
        make_native(root, tmpd, [])
    except SetFailed as e:
        print('\nFAILED: %s' % e)
        return 1
    if check:
        drift = native_drift(root, tmpd)
        for p in drift[:20]:
            print('  DIFFERS %s' % p)
        print('NATIVE: ' + ('FAIL (%d of %d files are not what the master gives; python3 tools/brand.py native remakes them)' % (len(drift), len(native_targets(root, tmpd)))
                            if drift else 'PASS (%d files in %s match the master)' % (len(native_targets(root, tmpd)), ' and '.join(t + '/' for t in tops))))
        return 1 if drift else 0
    done = refresh_native(root, tmpd)
    drift = native_drift(root, tmpd)
    print('  wrote %d files in %s from the master%s' % (len(done), ' and '.join(t + '/' for t in tops), '' if not drift else '; still different: ' + ', '.join(drift[:5])))
    return 1 if drift else 0


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


def set_master(src, provenance=None, name=None, yes=False, native_out=None, proof=None, tree_gate=True, today=None, root=None, frame_style=None):
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
    try:
        old_frame = brand_style.frame_of(reg)
        new_frame = brand_style.preset(frame_style, old_frame) if frame_style else old_frame
    except ValueError as e:
        print('  REFUSED: %s' % e)
        print('Nothing was written.')
        return 2
    frame_changed = brand_style.canonical(old_frame) != brand_style.canonical(new_frame)
    version = brand_style.version_for(new_sha, new_frame)
    same_master = old.get('sha256') == new_sha and os.path.exists(master_abs) and sha256_file(master_abs) == new_sha
    if same_master and not frame_changed:
        print('  that is already the master (%s, sha256 %s), framed as %s. Nothing to change.' % (old.get('name') or '', new_sha[:12], brand_style.describe(old_frame)))
        if reg.get('url_version') != version:
            print('  (its url_version is not written yet: python3 tools/brand.py stamp writes it and every URL)')
        return 0
    name = name or (old.get('name') if same_master else None) or os.path.splitext(os.path.basename(src))[0]
    prov = provenance or (old.get('provenance') if same_master else None) or (
        'Set by tools/brand.py set on %s from %s (sha256 %s). No provenance was given: add where it came '
        'from with --provenance.' % (today, os.path.basename(src), new_sha[:12]))
    if resized:
        prov += ' (%s by tools/brand.py set)' % resized

    # What will change.
    old_img = Image.open(master_abs).convert('RGB') if os.path.exists(master_abs) else None
    new_img = Image.open(cand).convert('RGB')
    mo = measure(old_img) if old_img else None
    mn = measure(new_img)
    print('\n  %-26s %-36s %s' % ('', 'now: ' + (old.get('name') or 'the master')[:30], 'new: ' + name[:30]))
    rows = [('fur vs background', 'contrast_fur', ':1'), ('subject vs background', 'contrast_subject', ':1'), ('subject width', 'width_pct', '%'),
            ('reach from the centre', 'reach', '')]
    for label, k, u in rows:
        print('  %-26s %-36s %s' % (label, (_fmt(mo[k]) + u) if mo else '-', _fmt(mn[k]) + u))
    for s in (29, 16):
        print('  %-26s %-36s %s' % ('edge energy at %dpx' % s, _fmt(edge_energy(old_img, s)) if old_img else '-', _fmt(edge_energy(new_img, s))))
    fo = frame_metrics(old_img, old_frame) if old_img else None
    fn = frame_metrics(new_img, new_frame)
    print('  %-26s %-36s %s' % ('frame', brand_style.describe(old_frame)[:36], brand_style.describe(new_frame)))
    print('  %-26s %-36s %s' % ('tile edge vs the cream', (_fmt(fo['edge_cream_framed']) + ':1') if fo else '-', _fmt(fn['edge_cream_framed']) + ':1'))
    print('  %-26s %-36s %s' % ('tile edge vs a dark ground', (_fmt(fo['edge_dark_framed']) + ':1') if fo else '-', _fmt(fn['edge_dark_framed']) + ':1'))
    fm = from_master_files(reg)
    cards = _cards(root)
    refs = logo_refs(root, version, reg)
    nrefs = sum(r for r, _ in refs.values())
    prep = os.path.abspath(native_out or os.path.join(root, PREP_REL))
    retiring = old.get('name') or 'the old master'
    comes_back = [s.get('name') for s in reg.get('retired') or [] if new_sha in (s.get('sha256') or {}).values()]
    print('\n  What `set --yes` changes:')
    print('    %-34s %s -> %s' % (MASTER_REL, (old.get('sha256') or '?')[:12], new_sha[:12]))
    print('    %-34s %d icons and text cards made from the master (tools/gen_brand_icons.py, tools/card_logo.py)' % ('', len([p for p in fm if p != MASTER_REL])))
    print('    %-34s %d cards: every share card, hero, og, Product Hunt, promo and social card (card_logo.py --swap --force)' % ('', len(cards)))
    print('    %-34s the native set: iOS AppIcon and Splash, Android mipmaps and splash (prepared, not built)' % rel(prep, root))
    tops = native_tops(root)
    if tops:
        print('    %-34s this tree\'s native project%s (gitignored): icons, splash and offline logo remade in place'
              % (' and '.join(t + '/' for t in tops), 's' if len(tops) > 1 else ''))
    print('    %-34s %d references in %d files carry ?v=%s (was %s): pages, manifests, service workers, emails, cap-web/'
          % ('', nrefs, len(refs), version, reg.get('url_version') or 'none'))
    if SW_REL in refs:
        print('    %-34s CACHE bumped, so an installed app precaches the new URLs' % SW_REL)
    print('    %-34s the master pin and frame, %d hashes re-pinned, the card digests re-approved;' % (REG_REL, len(fm)))
    print('    %-34s retired: + %s (the old %s and what changed with it)%s' % ('', retiring + ('' if not same_master else ' as framed now'),
                                                                         'frame' if same_master else 'master',
                                                                         ('; back from retirement: ' + ', '.join(comes_back)) if comes_back else ''))
    print('    then: the brand gate\'s static half, card_logo.py --check, gen_brand_icons.py --check, %sand a before/after proof sheet'
          % ('ios/ and android/ against the master, ' if tops else ''))

    # Can it be undone with git? Only if everything it writes is committed now.
    touched = [old.get('path', MASTER_REL), REG_REL] + list(fm) + cards + list(refs)
    dirty = []
    for i in range(0, len(touched), 400):
        code, outp = _git([LITERAL, 'status', '--porcelain', '--untracked-files=no', '--'] + touched[i:i + 400], root)
        if code != 0:
            dirty.append('git status failed: ' + outp)
            break
        dirty += [l for l in outp.split('\n') if l.strip()]
    # A file git does not know (a new article's card not yet committed, which card_logo.py --list returns)
    # would be overwritten with no way back, and its name in touched.txt makes `git restore` and `git commit
    # --pathspec-from-file` abort outright (verifier, 2026-11-14). So every path set writes must be in git.
    known = set()
    for i in range(0, len(touched), 400):
        code, outp = _git([LITERAL, 'ls-files', '-z', '--'] + touched[i:i + 400], root)
        if code != 0:
            dirty.append('git ls-files failed: ' + outp)
            break
        known.update(p for p in outp.split('\0') if p)
    untracked = sorted(set(p for p in touched if p not in known))
    dirty += ['?? %s   (not in git%s)' % (p, '' if os.path.exists(os.path.join(root, p)) else ', and not on disk') for p in untracked]
    code, head_blob = _git(['rev-parse', 'HEAD:' + old.get('path', MASTER_REL)], root)
    code2, work_blob = _git(['hash-object', old.get('path', MASTER_REL)], root)
    if code != 0 or code2 != 0 or head_blob != work_blob:
        dirty.append('the current master is not the committed one (an earlier set not yet committed?)')
    if dirty:
        print('\n  %s: these are not committed, so git could not undo the change:' % ('REFUSED' if yes else 'NOTE'))
        for l in dirty[:12]:
            print('    ' + l)
        if len(dirty) > 12:
            print('    ... and %d more' % (len(dirty) - 12))
        print('  Commit them, or put them back (git restore -- <path>) first.')
        if untracked:
            print('  A file marked ?? is not in git at all: commit it first (git add, then git commit), so set can be undone.')
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
    os.makedirs(proof, exist_ok=True)
    touched_list = os.path.join(proof, 'touched.txt')
    with open(touched_list, 'w') as f:                # exactly what set writes in the tree, for git restore
        f.write('\n'.join(sorted(set(touched))) + '\n')
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
        pin = with_style(pin, new_frame, version)    # ...and draw the frame the registry names
        write_registry(pin, root)
        print('  ok   %-46s        %s, %s' % ('wrote ' + MASTER_REL, new_sha[:12], brand_style.describe(new_frame)))
        # The native set goes to a fresh folder first, so what is copied on is exactly this run's set.
        native_new = os.path.join(tmpd, 'native-new')
        _step('web icons, nav logos, native set', [sys.executable, 'tools/gen_brand_icons.py', '--native-out', native_new], root, log)
        _step('the native splash', [sys.executable, 'tools/gen_splash.py', '--out', native_new], root, log)
        for p in _tree_hashes(native_new):
            os.makedirs(os.path.dirname(os.path.join(prep, p)), exist_ok=True)
            shutil.copyfile(os.path.join(native_new, p), os.path.join(prep, p))
        if tops:
            done = refresh_native(root, native_new)
            print('  ok   %-46s        %d files' % ('remade ' + ' and '.join(t + '/' for t in tops) + ' in place', len(done)))
        _step('every card\'s logo (card_logo.py --swap --force)', [sys.executable, 'tools/card_logo.py', '--swap', '--force'], root, log)
        stamped = stamp_tree(root, version, reg)
        print('  ok   %-46s        %d files, ?v=%s' % ('stamped every logo URL', len(stamped), version))
        if SW_REL in refs:
            a, b = bump_sw(root)
            print('  ok   %-46s        little-log-v%d -> v%d' % ('bumped ' + SW_REL + ' CACHE', a, b))
        fm_after = _hash_all(root, list(fm))
        reg2, notes = next_registry(reg, OrderedDict([(p, h) for p, h in fm_before.items() if h]), fm_after,
                                    {'sha256': new_sha, 'name': name, 'provenance': prov, 'frame': new_frame, 'url_version': version}, today, blobs)
        write_registry(reg2, root)
        print('  ok   %-46s        %s' % ('re-pinned ' + REG_REL, '; '.join(notes) or 'nothing retired'))
        _step('card digests (brand_image_check --approve-cards)', ['node', 'tools/brand_image_check.js', '--approve-cards'], root, log)
        print('\n  Check:')
        if tree_gate:
            _step('brand gate, static half', ['node', 'tools/brand_image_check.js', '--static-only'], root, log)
        _step('card_logo.py --check', [sys.executable, 'tools/card_logo.py', '--check'], root, log)
        _step('gen_brand_icons.py --check', [sys.executable, 'tools/gen_brand_icons.py', '--check'], root, log)
        stale = stale_refs(root, version)
        print('  %s %-46s        %s' % ('ok  ' if not stale else 'FAIL', 'every logo URL carries ?v=' + version, '; '.join(stale[:3]) or '%d references' % nrefs))
        if stale:
            raise SetFailed('%d logo references do not carry ?v=%s: %s' % (len(stale), version, '; '.join(stale[:8])))
        if tops:
            drift = native_drift(root, native_new)
            print('  %s %-46s        %s' % ('ok  ' if not drift else 'FAIL', ' and '.join(t + '/' for t in tops) + ' match the master',
                                           '%d files' % len(native_targets(root, native_new)) if not drift else ', '.join(drift[:4])))
            if drift:
                raise SetFailed('%d native files are not what the master gives: %s' % (len(drift), ', '.join(drift[:8])))
    except SetFailed as e:
        print('\nFAILED: %s' % e)
        print('\nTo put the tree back as it was (every file set writes was committed when it started):')
        print('  git %s restore --pathspec-from-file=%s' % (LITERAL, touched_list))
        if tops:
            print('  python3 tools/brand.py native      (%s: not in git, so this remakes them from the restored master)' % ' and '.join(t + '/' for t in tops))
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
        ('logo URLs', [len(stamped), len(refs)]),
        # images only: Contents.json and the adaptive XML do not depend on the master, and the background
        # colour XML changes only when the wash colour does
        ('native set', [sum(1 for p in prep_after if p.endswith('.png') and native_b.get(p) != prep_after[p]),
                        sum(1 for p in prep_after if p.endswith('.png'))]),
    ])
    os.makedirs(proof, exist_ok=True)
    sheet = proof_sheet(before_dir, native_before, root, prep, proof, (old.get('name') or 'the old master') + ', ' + old_frame.get('style', 'none'),
                        name + ', ' + new_frame.get('style', 'none'), mo, mn, today, fo, fn)
    summary = OrderedDict([('date', today), ('old', OrderedDict([('name', old.get('name')), ('sha256', old.get('sha256')), ('frame', old_frame),
                                                                  ('url_version', reg.get('url_version'))])),
                           ('new', OrderedDict([('name', name), ('sha256', new_sha), ('source', os.path.basename(src)), ('frame', new_frame),
                                                ('url_version', version)])),
                           ('changed', changed), ('metrics', OrderedDict([('old', mo), ('new', mn)])), ('native_out', prep),
                           ('prep_was_current', bool(prep_before) and prep_before == native_b),
                           ('native_in_tree', OrderedDict([('folders', tops), ('files', len(native_targets(root, native_new)) if tops else 0)]))])
    with open(os.path.join(proof, 'summary.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(summary, indent=1, ensure_ascii=False) + '\n')
    print('\n  Changed (of each kind, how many differ from before):')
    for k, (a, b) in changed.items():
        print('    %-18s %d of %d' % (k, a, b))
    print('\nDone. The proof for the founder: %s' % sheet)
    print('Next: look at it; node tools/gates.js; then commit the files it wrote and push (push = deploy):')
    print('  git %s commit --pathspec-from-file=%s -m "The logo is ..."' % (LITERAL, touched_list))
    print('Changed your mind before committing? git %s restore --pathspec-from-file=%s' % (LITERAL, touched_list))
    if tops:
        print('  and then python3 tools/brand.py native   (%s are not in git: this remakes them from the restored master)' % ' and '.join(t + '/' for t in tops))
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


def proof_sheet(before, native_before, after_root, native_after, out_dir, old_name, new_name, mo, mn, today, fo=None, fn=None):
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
              'Sign-in card logo (52px)', 'Share card', 'Promo cards, the logo corner zoomed', 'iOS launch splash', 'Icon sizes 16 to 60px, light and dark']
    b, a = side(before, native_before), side(after_root, native_after)
    rows = (len(titles) + 1) // 2
    W, H = 2 * CW + 20, 132 + rows * CH
    can = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(can)
    d.text((20, 14), 'Cubby logo: before (%s) and after (%s)' % (old_name, new_name), fill=(30, 30, 30), font=font('sans-bold', 26))
    d.text((20, 54), 'Each pair: BEFORE on the left, AFTER on the right. Made by tools/brand.py set on %s from the files themselves; '
                     'look before you commit.' % today, fill=(110, 110, 110), font=font('sans-semi', 17))
    if mo and mn:
        d.text((20, 84), 'Fur vs background %s:1 -> %s:1.  Subject width %s%% -> %s%%.  Reach %s -> %s.%s' % (
            _fmt(mo['contrast_fur']), _fmt(mn['contrast_fur']), _fmt(mo['width_pct']), _fmt(mn['width_pct']), _fmt(mo['reach']), _fmt(mn['reach']),
            ('  Tile edge on the cream %s:1 -> %s:1.' % (_fmt(fo['edge_cream_framed']), _fmt(fn['edge_cream_framed']))) if fo and fn else ''),
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
    FR = brand_style.FRAMES
    styles = ['none', 'rim-shade', 'ring']
    code = ('import sys; sys.path.insert(0, %r); import gen_brand_icons as g, brand_style as bs\nfrom PIL import Image\n'
            'm = Image.open(%r).convert("RGB")\nfor k in %r:\n    for s in (16, 29, 60, 180):\n'
            '        g.tile(m, s, bs.FRAMES[k]).save(%r %% (k, s))\n        g.square(m, s, bs.FRAMES[k]).save(%r %% (k, s))\n') % (
        os.path.join(ROOT, 'tools'), os.path.join(ROOT, MASTER_REL), styles, os.path.join(probe, 'tile-%s-%d.png'), os.path.join(probe, 'square-%s-%d.png'))
    r = subprocess.run([sys.executable, '-c', code], capture_output=True, text=True)
    master = Image.open(os.path.join(ROOT, MASTER_REL)).convert('RGB')
    same = r.returncode == 0 and all(
        list(Image.open(os.path.join(probe, 'tile-%s-%d.png' % (k, s))).getdata()) == list(tile(master, s, FR[k]).getdata())
        and list(Image.open(os.path.join(probe, 'square-%s-%d.png' % (k, s))).getdata()) == list(brand_style.framed(prod_resize(master, s), FR[k], IOS_RADIUS).getdata())
        for k in styles for s in (16, 29, 60, 180))
    ok('16, 29, 60 and 180px tiles and square icons, unframed, rim-shade and ring, come out pixel for pixel as tools/gen_brand_icons.py draws them', same, r.stdout + r.stderr)

    # -- the frame: a setting, drawn one way (tools/brand_style.py)
    print('\nthe frame (tools/brand_style.py)')
    plain = prod_resize(master, 512)
    col = brand_style.rgb(FR['rim']['colour'])
    ok('no frame draws nothing, and nor does any frame below 32px (16 and 31px)',
       list(brand_style.framed(plain, FR['none'], LOGO_RADIUS).getdata()) == list(plain.getdata())
       and all(list(brand_style.framed(prod_resize(master, k), FR['rim-shade'], LOGO_RADIUS).getdata()) == list(prod_resize(master, k).getdata()) for k in (16, 31)))
    rim = brand_style.framed(plain, FR['rim'], LOGO_RADIUS)
    edges = [rim.getpixel(xy) for xy in ((2, 256), (509, 256), (256, 2), (256, 509))]
    ok('a rim is its colour %s at the middle of every edge, and the face inside it is untouched' % FR['rim']['colour'],
       edges == [col] * 4 and rim.getpixel((20, 256)) == plain.getpixel((20, 256)) and rim.getpixel((256, 256)) == plain.getpixel((256, 256)), edges)
    rs = brand_style.framed(plain, FR['rim-shade'], LOGO_RADIUS)
    top, mid, bot = rs.getpixel((256, 2)), rs.getpixel((2, 256)), rs.getpixel((256, 509))
    ok('rim-shade: light on the rim at the top %s, the plain rim halfway down %s, shade at the bottom %s' % (hexc(top), hexc(mid), hexc(bot)),
       sum(top) > sum(col) + 30 and mid == col and sum(bot) < sum(col) - 30, (top, mid, bot))
    sq = brand_style.framed(plain, FR['rim'], IOS_RADIUS)
    corner = [sq.getpixel(xy) for xy in ((0, 0), (511, 0), (0, 511), (511, 511), (20, 20), (491, 491))]
    ok('a square icon the system rounds itself is rim right into its corners, so the iOS mask meets rim and never a sliver of wash (no double edge)',
       corner == [col] * 6, corner)
    tr = tile(master, 512, FR['rim'])
    ok('a tile cuts its own corners: framed, its corner pixel is transparent and the middle of its edge is rim',
       tr.getpixel((0, 0))[3] == 0 and tr.getpixel((2, 256))[:3] == col, (tr.getpixel((0, 0)), tr.getpixel((2, 256))))
    bad_frames = [{'style': 'bezel'}, {'style': 'rim', 'rim': 0.03, 'colour': 'honey'}, {'style': 'rim', 'rim': 0.9, 'colour': '#D6A058'},
                  {'style': 'rim-shade', 'rim': 0.03, 'colour': '#D6A058'}]
    ok('a frame is checked: an unknown style, a colour that is not #RRGGBB, a rim wider than half the tile and a missing light are refused',
       all(brand_style.check_frame(f) for f in bad_frames) and not any(brand_style.check_frame(f) for f in FR.values()), [brand_style.check_frame(f) for f in bad_frames])
    va, vb, vc = brand_style.version_for('a' * 64, FR['none']), brand_style.version_for('b' * 64, FR['none']), brand_style.version_for('a' * 64, FR['rim-shade'])
    ok('the URL version is 8 hex that change with the master and with the frame, not with key order (%s %s %s)' % (va, vb, vc),
       len({va, vb, vc}) == 3 and all(re.match(r'^[0-9a-f]{8}$', v) for v in (va, vb, vc))
       and va == brand_style.version_for('a' * 64, OrderedDict(reversed(list(FR['none'].items()))))
       and brand_style.canonical({'style': 'rim', 'rim': 1.0, 'colour': '#000000'}) == '{"colour":"#000000","rim":1,"style":"rim"}')

    # -- versioned logo URLs, on a scratch folder (not a checkout: every file on disk, as the gate reads one)
    print('\nversioned logo URLs (stamp and stale_refs on a scratch folder, and the brand gate on the same folder)')
    reg_real = load_registry()
    V = brand_style.version_for(reg_real['master']['sha256'], brand_style.frame_of(reg_real))
    OLD = 'ffffffff' if V != 'ffffffff' else '00000000'
    sd = os.path.join(tmp, 'stamp')
    scratch = OrderedDict([
        ('index.html', '<link rel="icon" type="image/png" href="/icons/favicon.png">\n<a class="nav-brand" href="/"><img src="/icons/logo-96.png" '
                       'srcset="/icons/logo-96.png 96w, /icons/logo-192.png 192w" sizes="34px" alt="Cubby"></a>\n'
                       '<meta property="og:image" content="https://little-cubby.com/og/cubby-home.png">\n'
                       '<script type="application/ld+json">{"logo":"https://little-cubby.com/icons/logo-512.png?v=' + OLD + '"}</script>\n'
                       '<img src="/app/spot-art/x.webp"><img src="https://example.com/icons/logo-512.png"><img src="/icons/screenshots/01-two-names.png">\n'),
        ('app/sw.js', "const CACHE = 'little-log-v41';\nconst ASSETS = [\n  '/app/',\n  '/icons/icon-192.png',\n  '/icons/logo-512.png'\n];\n"),
        ('app/manifest.webmanifest', '{"icons": [{"src": "/icons/icon-192.png"}, {"src": "/icons/icon-maskable-512.png", "purpose": "maskable"}]}\n'),
        ('cap-web/index.html', '<img src="logo.png" alt="" width="64" height="64">\n'),
        ('worker.js', "const mail = '<img src=\"https://little-cubby.com/icons/logo-512.png\" width=\"56\">';\n"),
        ('tools/page.html', '<img src="/icons/logo-96.png">\n'),
        ('docs/page.html', '<img src="/icons/logo-96.png">\n'),
    ])
    for f, text in scratch.items():
        os.makedirs(os.path.dirname(os.path.join(sd, f)), exist_ok=True)
        with open(os.path.join(sd, f), 'w') as fh:
            fh.write(text)
    shutil.copyfile(os.path.join(ROOT, CAP_LOGO), os.path.join(sd, CAP_LOGO))
    before_stale = stale_refs(sd, V, reg_real)
    done = stamp_tree(sd, V, reg_real)
    got = OrderedDict((f, open(os.path.join(sd, f)).read()) for f in scratch)
    want_n = OrderedDict([('index.html', 6), ('app/sw.js', 2), ('app/manifest.webmanifest', 2), ('cap-web/index.html', 1), ('worker.js', 1)])
    ok('finds every logo reference before (%d: a favicon link, a srcset, og:image, JSON-LD with an old ?v=, a service worker list, a manifest, '
       'a relative cap-web/ logo, an email) and none in tools/ or docs/' % len(before_stale),
       len(before_stale) == sum(want_n.values()) and sum(1 for b in before_stale if b.endswith('?v=' + OLD)) == 1
       and not any(b.startswith(('tools/', 'docs/')) for b in before_stale), before_stale)
    ok('stamp puts ?v=%s on each of them, replacing the old one, and rewrites exactly those files' % V,
       sorted(done) == sorted(want_n) and all(got[f].count('?v=' + V) == n for f, n in want_n.items()) and OLD not in got['index.html']
       and 'logo.png?v=' + V in got['cap-web/index.html'], (done, got))
    ok('and leaves alone a picture not made from the master, another host\'s URL, tools/ and docs/',
       '"/app/spot-art/x.webp"' in got['index.html'] and '"https://example.com/icons/logo-512.png"' in got['index.html']
       and '"/icons/screenshots/01-two-names.png"' in got['index.html'] and got['tools/page.html'] == scratch['tools/page.html']
       and got['docs/page.html'] == scratch['docs/page.html'], got['index.html'])
    ok('a second stamp rewrites nothing, and nothing is stale', stamp_tree(sd, V, reg_real) == [] and stale_refs(sd, V, reg_real) == [])

    def gate_version_line(root_dir):
        g = subprocess.run(['node', os.path.join(ROOT, 'tools', 'brand_image_check.js'), '--static-only', '--root=' + root_dir], cwd=ROOT,
                           capture_output=True, text=True, env=git_env())
        lines = (g.stdout + g.stderr).split('\n')
        i = next((n for n, l in enumerate(lines) if 'every reference to a logo file made from the master' in l), None)
        return '\n'.join(lines[i:i + 3]) if i is not None else (g.stdout + g.stderr)[-400:]
    line_ok = gate_version_line(sd)
    with open(os.path.join(sd, 'app', 'landing.js'), 'w') as fh:
        fh.write("var a = '<img src=\"/icons/logo-512.png?v=" + OLD + "\">';\n")
    line_bad, stale_bad = gate_version_line(sd), stale_refs(sd, V, reg_real)
    ok('the brand gate reads that folder the same way: green on it, and red on a script with an old ?v=, as stale_refs is',
       line_ok.lstrip().startswith('ok ') and line_bad.lstrip().startswith('FAIL') and 'app/landing.js:1 -> /icons/logo-512.png?v=' + OLD in line_bad
       and stale_bad == ['app/landing.js:1  /icons/logo-512.png?v=' + OLD], (line_ok, line_bad, stale_bad))
    ok('bump_sw takes the app service worker\'s CACHE up by one (v41 -> v42)',
       bump_sw(sd) == (41, 42) and "const CACHE = 'little-log-v42';" in open(os.path.join(sd, 'app', 'sw.js')).read())

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

    # Two masters, two frames: each is drawn as painted and framed, and the frame is the only difference.
    mirror_fx = os.path.join(tmp, 'mirror-fx.png')
    ImageOps.mirror(Image.open(good)).save(mirror_fx, 'PNG')
    oa, ob = os.path.join(tmp, 'cmp-ring'), os.path.join(tmp, 'cmp-rimshade')
    _, ca = compare([good, mirror_fx], ['good', 'mirrored'], oa, current=False, quiet=True, frame=brand_style.FRAMES['ring'])
    _, cb = compare([good, mirror_fx], ['good', 'mirrored'], ob, current=False, quiet=True, frame=brand_style.FRAMES['rim-shade'])
    sa, sb = Image.open(os.path.join(oa, 'sizes.png')).convert('RGB'), Image.open(os.path.join(ob, 'sizes.png')).convert('RGB')
    bh = (sa.height + 24) // 4                                  # four blocks: good, good + frame, mirrored, mirrored + frame
    crop = lambda im, k: im.crop((0, 44 + k * bh, im.width, k * bh + bh - 24))
    same_plain = all(ImageChops.difference(crop(sa, k), crop(sb, k)).getbbox() is None for k in (0, 2))
    diff_framed = all(ImageChops.difference(crop(sa, k), crop(sb, k)).getbbox() is not None for k in (1, 3))
    htm = open(os.path.join(oa, 'compare.html'), encoding='utf-8').read()
    ok('compare draws two masters as painted and framed: with two frames the painted rows are pixel for pixel the same and the framed rows differ',
       sa.size == sb.size and same_plain and diff_framed and 'good + ring' not in htm and 'ring: rim 1.2% #6B4226' in htm, (sa.size, sb.size, same_plain, diff_framed))
    gb = {c['name']: c['frame'] for c in cb}['good']
    ok('and measures what the frame is for: the tile edge against the site\'s cream, as painted %s:1 and framed %s:1' % (_fmt(gb['edge_cream_plain']), _fmt(gb['edge_cream_framed'])),
       gb['edge_cream_framed'] > gb['edge_cream_plain'] + 0.5 and json.load(open(os.path.join(ob, 'metrics.json')))['frame']['style'] == 'rim-shade'
       and all(c['frame']['style'] == 'ring' for c in ca), gb)

    # -- zoom
    print('\nzoom')
    z = os.path.join(tmp, 'z80.png')
    zoom(good, 80, z)
    mz = measure(Image.open(z))
    ok('zooms a 70%%-wide subject to 80%% (got %.1f%%), same size, RGB' % mz['width_pct'],
       abs(mz['width_pct'] - 80) <= 1.5 and Image.open(z).size == (1024, 1024) and Image.open(z).mode == 'RGB', mz)
    low = _fixture(os.path.join(tmp, 'low.png'), width=0.60, dy=0.08)
    zl = os.path.join(tmp, 'zlow.png')
    zoom(low, 75, zl)
    ml = measure(Image.open(low))
    mzl = measure(Image.open(zl))
    centre = lambda b: ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)
    ok('centres the crop on the subject: one sitting %.0f%% low comes out centred (%.3f, %.3f)' % (((centre(ml['bbox'])[1] - 0.5) * 100,) + centre(mzl['bbox'])),
       abs(centre(mzl['bbox'])[0] - 0.5) < 0.01 and abs(centre(mzl['bbox'])[1] - 0.5) < 0.01, (ml['bbox'], mzl['bbox']))
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
    keep = [MASTER_REL, REG_REL, '.assetsignore'] + ['tools/' + f for f in ('brand.py', 'brand_style.py', 'gen_brand_icons.py', 'gen_splash.py', 'card_logo.py',
                                                                          'brand_image_check.js', 'gen_app_icon.py')]
    # Files that point at the logo (a page, the 404, the app's service worker and manifest, the sign-in email,
    # the native offline page): set puts the new ?v= on them and bumps the service worker.
    REF_SAMPLE = [SW_REL, 'app/manifest.webmanifest', 'index.html', '404.html', 'cap-web/index.html', 'worker.js', 'articles/baby-blues-explained/index.html']
    keep += REF_SAMPLE
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
    with open(os.path.join(mini, '.gitignore'), 'w') as f:      # as the real tree: the native projects are not in git
        f.write('/ios/\n/android/\n/native-build/\n')
    gitc = ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=brand-selftest', '-c', 'user.email=brand-selftest@localhost', '-c', 'commit.gpgsign=false']
    genv = git_env()       # never the GIT_DIR a pre-push hook exports: that would commit the mini tree onto the branch
    # A card whose name git reads as a pattern, and a tracked file that pattern matches, edited and not
    # committed: set must neither refuse over that edit nor let its printed undo or commit touch it.
    art0 = sorted(p for p in os.listdir(os.path.join(mini, 'og', 'articles')) if p.endswith('.png'))[0]
    GLOB_CARD, GLOB_BYSTANDER = 'og/articles/q*.png', 'og/articles/qa/notes.png'
    os.makedirs(os.path.join(mini, 'og', 'articles', 'qa'))
    for p in (GLOB_CARD, GLOB_BYSTANDER):
        shutil.copyfile(os.path.join(mini, 'og', 'articles', art0), os.path.join(mini, p))
    subprocess.run(['git', 'init', '-q'], cwd=mini, check=True, env=genv)
    subprocess.run(gitc + ['add', '-A'], cwd=mini, check=True, env=genv)
    subprocess.run(gitc + ['commit', '-q', '-m', 'mini tree'], cwd=mini, check=True, env=genv)
    with open(os.path.join(mini, GLOB_BYSTANDER), 'ab') as f:
        f.write(b'an edit set must not touch')
    bystander = sha256_file(os.path.join(mini, GLOB_BYSTANDER))
    mini_set = os.path.join(mini, 'tools', 'brand.py')
    # A checkout that has built the app (verifier M1): ios/ with the AppIcon set tools/cap_ios_build.sh writes
    # (gen_app_icon.py) and its splash, android/ res with the launcher icons and splash, and the offline logo
    # `cap copy` puts in each public/ folder. Before the fix, set left all of it on the old master, and the
    # brand gate's whole-tree walk failed set's own last check on the retired bytes in ios/ and public/.
    os.makedirs(os.path.join(mini, 'ios'))
    os.makedirs(os.path.join(mini, 'android', 'app', 'src', 'main', 'res'))
    seed = os.path.join(tmp, 'native-seed')
    seeded = [subprocess.run([sys.executable, 'tools/gen_app_icon.py'], cwd=mini, capture_output=True, text=True),
              subprocess.run([sys.executable, 'tools/gen_brand_icons.py', '--native-out', seed, '--no-web'], cwd=mini, capture_output=True, text=True)]
    if os.path.isdir(os.path.join(seed, 'android')):
        shutil.copytree(os.path.join(seed, 'android'), os.path.join(mini, 'android'), dirs_exist_ok=True)
    seeded.append(subprocess.run([sys.executable, 'tools/gen_splash.py'], cwd=mini, capture_output=True, text=True))
    for p in NATIVE_PUBLIC:
        os.makedirs(os.path.dirname(os.path.join(mini, p)), exist_ok=True)
        shutil.copyfile(os.path.join(mini, CAP_LOGO), os.path.join(mini, p))
    nat0 = OrderedDict((t + '/' + p, h) for t in NATIVE_TOPS for p, h in _tree_hashes(os.path.join(mini, t)).items())
    ok('the miniature tree has built-app native folders: ios/ from gen_app_icon.py and gen_splash.py, android/ res, both public/ logos (%d files)' % len(nat0),
       all(r.returncode == 0 for r in seeded) and len(nat0) > 50 and 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-iphone-60x60@3x.png' in nat0
       and all(p in nat0 for p in NATIVE_PUBLIC) and nat0['ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-iphone-60x60@3x.png'] == sha256_file(os.path.join(mini, 'icons/apple-touch-icon.png')),
       [(r.stdout + r.stderr)[-300:] for r in seeded])
    fm = list(from_master_files(reg))
    mcards = [l for l in subprocess.run([sys.executable, os.path.join(mini, 'tools', 'card_logo.py'), '--list'], cwd=mini, capture_output=True, text=True).stdout.split('\n') if l]
    h0 = _hash_all(mini, fm + mcards)
    mrefs = list(logo_refs(mini, 'none', reg))
    hr0 = _hash_all(mini, mrefs)
    sw_n = lambda: int(re.search(r"const CACHE = 'little-log-v(\d+)';", open(os.path.join(mini, SW_REL)).read()).group(1))
    sw0 = sw_n()
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
    v_mirror = brand_style.version_for(sha256_file(mirror), brand_style.frame_of(load_registry(mini)))
    hr1 = _hash_all(mini, mrefs)

    def mini_gate(*keys):          # the brand gate's own lines, run on the mini tree (the rest of its static half needs the whole site)
        g = subprocess.run(['node', os.path.join(mini, 'tools', 'brand_image_check.js'), '--static-only'], cwd=mini, capture_output=True, text=True, env=genv)
        lines = (g.stdout + g.stderr).split('\n')
        return [next((l.strip() for l in lines if k in l), 'no line with ' + k) for k in keys]
    vlines = mini_gate("the registry's url_version is the one its master and frame give", 'every reference to a logo file made from the master')
    ok('every logo URL in it (%d files: %s) now carries ?v=%s, the registry names that version, the brand gate agrees, and app/sw.js CACHE went up by one (v%d -> v%d)'
       % (len(mrefs), ', '.join(mrefs), v_mirror, sw0, sw_n()),
       sorted(mrefs) == sorted(REF_SAMPLE) and all(hr0[p] != hr1[p] for p in mrefs) and not stale_refs(mini, v_mirror)
       and load_registry(mini).get('url_version') == v_mirror and sw_n() == sw0 + 1 and all(l.startswith('ok ') for l in vlines), (vlines, stale_refs(mini, v_mirror)[:5]))
    regm = load_registry(mini)
    ok('the master is the new file, pinned with its name, date and provenance', regm['master']['sha256'] == sha256_file(mirror) == sha256_file(os.path.join(mini, MASTER_REL))
       and regm['master']['name'] == 'the mirrored master' and regm['master']['provenance'] == 'brand.py self-test', regm['master'])
    new_set = (regm.get('retired') or [])[-1:] or [{}]
    ok('the retired list grew by one: %s, %d hashes, with the old master\'s git blob' % (new_set[0].get('name'), len(new_set[0].get('sha256', {}))),
       len(regm['retired']) == nret0 + 1 and new_set[0].get('sha256', {}).get(MASTER_REL) == reg['master']['sha256']
       and len(new_set[0]['sha256']) == len(fm) and MASTER_REL in new_set[0].get('git_blob', {}), new_set[0])
    ok('every from_master file is pinned at its new bytes', all(regm_h == h1[p] for fam in regm['families'] if fam.get('from_master') for p, regm_h in fam['files'].items()))
    nat1 = OrderedDict((t + '/' + p, h) for t in NATIVE_TOPS for p, h in _tree_hashes(os.path.join(mini, t)).items())
    drift = native_drift(mini, os.path.join(mini, PREP_REL))
    unchanged = [p for p in nat0 if p.endswith('.png') and nat1.get(p) == nat0[p]]
    ok('set remade ios/ and android/ in place: every icon, splash and public/ logo is what the new master gives, every image changed (%d files), and its undo names brand.py native'
       % len(nat1), not drift and not unchanged and list(nat1) == list(nat0) and 'tools/brand.py native' in out, drift[:5] or unchanged[:5] or out[-600:])
    retired_now = set(h for s in regm.get('retired') or [] for h in (s.get('sha256') or {}).values())
    stale = retired_in_tree(mini, retired_now)
    ok('no retired logo\'s bytes anywhere in the miniature tree, ios/ and android/ included (the brand gate\'s walk; verifier M1)',
       not stale and len(retired_now) >= len(fm), stale[:6])
    ok('a card named %s was swapped, and the uncommitted edit to %s, which that name matches as a pattern, was neither refused over nor touched'
       % (GLOB_CARD, GLOB_BYSTANDER), r.returncode == 0 and GLOB_CARD in mcards and h1.get(GLOB_CARD) != h0.get(GLOB_CARD)
       and sha256_file(os.path.join(mini, GLOB_BYSTANDER)) == bystander and GLOB_BYSTANDER not in out, out[-1200:])
    # The commit it prints, run on a copy: exactly the files set wrote go in, the bystander's edit stays out.
    mcopy = os.path.join(tmp, 'mini-commit')
    shutil.copytree(mini, mcopy, symlinks=True)
    m = re.search(r'^\s*(git .*\bcommit --pathspec-from-file=.*)$', out, re.M)
    cmd = shlex.split(m.group(1)) if m else ['false']
    rc = subprocess.run(gitc + cmd[1:], cwd=mcopy, capture_output=True, text=True, env=genv) if m else None
    st = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=mcopy, capture_output=True, text=True, env=genv).stdout
    shown = subprocess.run(['git', '-c', 'core.quotePath=false', 'show', '--name-only', '--format=', 'HEAD'], cwd=mcopy, capture_output=True, text=True, env=genv).stdout.split('\n')
    ok('the commit it prints (%s) commits what set wrote, %s included, and leaves the edit to %s uncommitted'
       % (' '.join(cmd[:3]), GLOB_CARD, GLOB_BYSTANDER), rc is not None and rc.returncode == 0 and st.strip() == 'M ' + GLOB_BYSTANDER
       and GLOB_CARD in shown and MASTER_REL in shown and GLOB_BYSTANDER not in shown, (m and m.group(1), rc and (rc.stdout + rc.stderr)[-300:], st[-300:]))
    shutil.rmtree(mcopy, ignore_errors=True)
    # The founder's main checkout holds ~67 worktrees under .claude/worktrees/ (verifier M1b): a real one made
    # from the mini tree's first commit (every file in it is now retired), one whose admin folder is gone (a
    # .git file), gitignored scratch, an untracked folder and an SPM checkout inside ios/. None is this tree.
    old_bytes = open(os.path.join(ROOT, MASTER_REL), 'rb').read()
    subprocess.run(gitc + ['worktree', 'add', '-q', '--detach', '.claude/worktrees/old-desk', 'HEAD'], cwd=mini, check=True, env=genv, capture_output=True)
    not_tree = ['.claude/worktrees/fake-desk/icons/logo-512.png', 'native-build/old-export/AppIcon.png', '_local/old.png', 'loose/old.png',
                'ios/App/CapApp-SPM/.build/checkouts/dep/res/old.png']
    for p in not_tree:
        os.makedirs(os.path.dirname(os.path.join(mini, p)), exist_ok=True)
        open(os.path.join(mini, p), 'wb').write(old_bytes)
    open(os.path.join(mini, '.claude/worktrees/fake-desk/.git'), 'w').write('gitdir: /nonexistent/.git/worktrees/fake-desk\n')
    os.makedirs(os.path.join(mini, 'ios/App/CapApp-SPM/.build/checkouts/dep/.git'))

    def gate_line():       # the brand gate's own retired-bytes line, run on the mini tree (the rest of its static half needs the whole site)
        g = subprocess.run(['node', os.path.join(mini, 'tools', 'brand_image_check.js'), '--static-only'], cwd=mini, capture_output=True, text=True, env=genv)
        lines = (g.stdout + g.stderr).split('\n')
        i = next((n for n, l in enumerate(lines) if 'no retired logo' in l and 'appear anywhere' in l), None)
        return '\n'.join(lines[i:i + 3]) if i is not None else (g.stdout + g.stderr)[-400:]
    nested_old = sha256_file(os.path.join(mini, '.claude/worktrees/old-desk', MASTER_REL)) in retired_now
    stale_nested, line_nested = retired_in_tree(mini, retired_now), gate_line()
    ok('neither brand.py nor the brand gate reads a nested worktree (made by git worktree add, every file retired), one with a .git file, gitignored scratch, an untracked folder or an SPM checkout in ios/ (verifier M1b)',
       nested_old and tree_files(mini)[0] == 'git' and not stale_nested and line_nested.lstrip().startswith('ok '), (nested_old, stale_nested[:6], line_nested))
    # and the same bytes where they ship or build: staged in git, and under ios/
    caught = ['icons/planted-old.png', 'ios/App/App/planted-old.png']
    for p in caught:
        open(os.path.join(mini, p), 'wb').write(old_bytes)
    subprocess.run(gitc + ['add', caught[0]], cwd=mini, check=True, env=genv)
    stale_caught, line_caught = retired_in_tree(mini, retired_now), gate_line()
    ok('while the same bytes staged in git and under ios/ are caught by both', sorted(stale_caught) == sorted(caught)
       and line_caught.lstrip().startswith('FAIL') and all(p in line_caught for p in caught), (stale_caught, line_caught))
    subprocess.run(gitc + ['rm', '-q', '--cached', caught[0]], cwd=mini, check=True, env=genv)
    for p in caught:
        os.remove(os.path.join(mini, p))
    shutil.rmtree(os.path.join(mini, 'ios/App/CapApp-SPM'))      # the plant inside ios/ goes, so ios/ is as set left it
    try:
        summ = json.load(open(os.path.join(proof, 'summary.json')))
    except (OSError, ValueError):
        summ = {'changed': {'native set': [0, 0]}}
    nat = summ['changed']['native set']
    ok('the native set was regenerated into native-build/brand-native, every image changed (%d of %d)' % tuple(nat), nat[0] == nat[1] > 40, summ['changed'])
    try:
        size = Image.open(os.path.join(proof, 'before-after.png')).size
    except OSError:
        size = (0, 0)
    ok('and it drew the before/after proof (%dx%d)' % size, size == (2 * CW + 20, 132 + 4 * CH), size)
    r = subprocess.run([sys.executable, mini_set, 'set', os.path.join(ROOT, MASTER_REL), '--yes', '--no-tree-gate', '--proof', proof], cwd=mini, capture_output=True, text=True)
    ok('refuses to run again over its own uncommitted change (git could not undo it)', r.returncode == 3 and 'REFUSED' in r.stdout, r.stdout[-800:])
    touched = os.path.join(proof, 'touched.txt')
    listed = [l for l in open(touched).read().split('\n') if l] if os.path.exists(touched) else []
    m = re.search(r'Changed your mind before committing\? (git .*)$', out, re.M)
    undo = shlex.split(m.group(1)) if m else ['false']
    r = subprocess.run(undo, cwd=mini, capture_output=True, text=True, env=genv)
    back = _hash_all(mini, fm + mcards)
    ok('and the undo it prints (%s) puts every file back, %s included, and leaves the edit to %s (%d paths)' % (' '.join(undo[:3]), GLOB_CARD, GLOB_BYSTANDER, len(listed)),
       r.returncode == 0 and back == h0 and _hash_all(mini, mrefs) == hr0 and load_registry(mini) == reg and MASTER_REL in listed and REG_REL in listed and GLOB_CARD in listed
       and all(p in listed for p in mrefs)
       and sha256_file(os.path.join(mini, GLOB_BYSTANDER)) == bystander,
       (r.stdout + r.stderr)[-400:] or [p for p in h0 if h0[p] != back.get(p)][:5] or 'the edit to %s is gone' % GLOB_BYSTANDER)
    r = subprocess.run([sys.executable, mini_set, 'native', '--check'], cwd=mini, capture_output=True, text=True)
    ok('git restore cannot reach ios/ and android/, and native --check says so (they are still on the abandoned master)',
       r.returncode == 1 and 'NATIVE: FAIL' in r.stdout, (r.stdout + r.stderr)[-600:])
    r = subprocess.run([sys.executable, mini_set, 'native'], cwd=mini, capture_output=True, text=True)
    nat2 = OrderedDict((t + '/' + p, h) for t in NATIVE_TOPS for p, h in _tree_hashes(os.path.join(mini, t)).items())
    ok('and brand.py native, the undo\'s second line, puts them back byte for byte (%d files)' % len(nat2), r.returncode == 0 and nat2 == nat0,
       (r.stdout + r.stderr)[-600:] or [p for p in nat0 if nat0[p] != nat2.get(p)][:5])
    # A card git does not know yet (a new article's og card, not committed): card_logo.py --list returns it, so
    # set would overwrite it with no way back and put it in touched.txt, where it makes git restore abort.
    arts = [c for c in mcards if c.startswith('og/articles/')]
    plant = os.path.dirname(arts[0]) + '/planted-untracked-card.png'
    shutil.copyfile(os.path.join(mini, arts[0]), os.path.join(mini, plant))
    listed_now = [l for l in subprocess.run([sys.executable, os.path.join(mini, 'tools', 'card_logo.py'), '--list'], cwd=mini, capture_output=True, text=True).stdout.split('\n') if l]
    hp = _hash_all(mini, fm + mcards + [plant])
    proof2 = os.path.join(tmp, 'proof-untracked')
    r = subprocess.run([sys.executable, mini_set, 'set', mirror, '--yes', '--no-tree-gate', '--proof', proof2], cwd=mini, capture_output=True, text=True)
    ok('refuses an untracked card that card_logo.py --list returns (git could not undo it), naming it, and writes nothing',
       plant in listed_now and r.returncode == 3 and ('?? ' + plant) in r.stdout and 'Nothing was written' in r.stdout
       and _hash_all(mini, fm + mcards + [plant]) == hp and not os.path.exists(os.path.join(proof2, 'touched.txt')), (r.returncode, r.stdout[-900:]))
    # The card digests cover what git tracks, so approving them over a card git does not know would leave it out
    # and the gate would fail after the commit: the approval names it and changes nothing.
    reg_bytes = open(os.path.join(mini, REG_REL), 'rb').read()
    r = subprocess.run(['node', 'tools/brand_image_check.js', '--approve-cards'], cwd=mini, capture_output=True, text=True, env=genv)
    ok('brand_image_check --approve-cards refuses while a card is not in git, naming it, and leaves the registry as it was',
       r.returncode == 1 and plant in r.stdout and 'git add' in r.stdout and open(os.path.join(mini, REG_REL), 'rb').read() == reg_bytes, (r.stdout + r.stderr)[-600:])

    # -- two masters and two frames, there and back (the founder's frame is a setting: one command each way)
    print('\nset --frame: two masters and two frames, there and back, byte for byte')
    os.remove(os.path.join(mini, plant))
    reg0 = load_registry(mini)
    F0 = brand_style.frame_of(reg0)
    F1 = 'ring' if F0['style'] != 'ring' else 'rim'
    track = fm + mcards + mrefs
    s0, nat_s0 = _hash_all(mini, track), OrderedDict((t + '/' + p, h) for t in NATIVE_TOPS for p, h in _tree_hashes(os.path.join(mini, t)).items())
    swn0, sw_text = sw_n(), lambda: re.sub(r"little-log-v\d+", 'little-log-vN', open(os.path.join(mini, SW_REL)).read())
    sw_t0 = sw_text()

    def run_set(src, style, label, *extra):
        pr = os.path.join(tmp, 'proof-' + label)
        rr = subprocess.run([sys.executable, mini_set, 'set', src, '--frame', style, '--yes', '--no-tree-gate', '--proof', pr] + list(extra), cwd=mini,
                            capture_output=True, text=True)
        o = rr.stdout + rr.stderr
        mm = re.search(r'^\s*(git .*\bcommit --pathspec-from-file=.*)$', o, re.M)
        cc = subprocess.run(gitc + shlex.split(mm.group(1))[1:], cwd=mini, capture_output=True, text=True, env=genv) if (rr.returncode == 0 and mm) else None
        return rr.returncode == 0 and cc is not None and cc.returncode == 0, o
    ok1, o1 = run_set(mirror, F1, 'b')
    s1 = _hash_all(mini, track)
    ok('a second master in a second frame (%s): every icon, card and logo URL changes, and the commit it prints commits it (%d files)' % (F1, len(track)),
       ok1 and all(s0[p] != s1[p] for p in track), (o1[-1500:], [p for p in track if s0[p] == s1[p]][:6]))
    ok2, o2 = run_set(mirror, F0['style'], 'c')
    s2 = _hash_all(mini, track)
    still = sorted(p for p in track if s1[p] == s2[p])
    last = (load_registry(mini).get('retired') or [{}])[-1]
    ok('the same master back in the first frame (%s): only the master and the maskable icon stay, every framed icon, card and logo URL changes, '
       'and the %s frame\'s bytes are retired without the master (%d hashes)' % (F0['style'], F1, len(last.get('sha256', {}))),
       ok2 and still == sorted({MASTER_REL, 'icons/icon-maskable-512.png'}) and MASTER_REL not in last.get('sha256', {})
       and len(last.get('sha256', {})) == len(fm) - 2 and F1 in last.get('name', ''), (o2[-1500:], still, last.get('name')))
    if brand_style.canonical(F0) == brand_style.canonical(brand_style.FRAMES[F0['style']]):
        ok3, o3 = run_set(os.path.join(ROOT, MASTER_REL), F0['style'], 'd', '--name', reg0['master'].get('name', ''), '--provenance', reg0['master'].get('provenance', ''))
        s3 = _hash_all(mini, track)
        reg3 = load_registry(mini)
        nat_s3 = OrderedDict((t + '/' + p, h) for t in NATIVE_TOPS for p, h in _tree_hashes(os.path.join(mini, t)).items())
        diff = [p for p in track if s3[p] != s0[p] and p != SW_REL]
        ok('and the first master in the first frame again: every icon, card, logo URL and native file is back byte for byte (%d + %d files; app/sw.js but for its '
           'CACHE, v%d -> v%d), the registry pins what it pinned, and no approved hash is left retired' % (len(track), len(nat_s3), swn0, sw_n()),
           ok3 and not diff and sw_text() == sw_t0 and sw_n() == swn0 + 3 and nat_s3 == nat_s0
           and [reg3['master']['sha256'], brand_style.canonical(brand_style.frame_of(reg3)), reg3.get('url_version'), from_master_files(reg3)]
           == [reg0['master']['sha256'], brand_style.canonical(F0), brand_style.version_for(reg0['master']['sha256'], F0), from_master_files(reg0)]
           and not any(h in set(s0.values()) for st in reg3.get('retired') or [] for h in (st.get('sha256') or {}).values()),
           {'set ok': ok3, 'files not back': diff[:6], 'sw back': sw_text() == sw_t0, 'cache': (swn0, sw_n()), 'native back': nat_s3 == nat_s0,
            'registry': [reg3['master']['sha256'][:12], reg3.get('frame'), reg3.get('url_version')], 'out': o3[-600:]})
    else:
        print('  note the registry\'s frame is tuned by hand (%s), so --frame cannot name it: the way back is not checked' % brand_style.canonical(F0))
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
    s.add_argument('--frame', choices=list(brand_style.FRAMES), help='the frame every tile is drawn with (default: keep the registry\'s)')
    s.add_argument('--native-out', help='where the native set goes (default native-build/brand-native, gitignored)')
    s.add_argument('--proof', help='where the before/after proof goes (default: a folder in the system temp)')
    s.add_argument('--date', help=argparse.SUPPRESS)
    s.add_argument('--no-tree-gate', action='store_true', help=argparse.SUPPRESS)   # the self-test's miniature tree only
    n = sub.add_parser('native', help='remake this tree\'s ios/ and android/ icons, splash and offline logo from the master')
    n.add_argument('--check', action='store_true', help='write nothing; fail if any of them is not what the master gives')
    st = sub.add_parser('stamp', help='put the registry\'s url_version on every logo URL')
    st.add_argument('--check', action='store_true', help='write nothing; fail on a reference that does not carry it')
    c.add_argument('--frame', choices=list(brand_style.FRAMES), help='the frame for the framed column (default: the registry\'s, else rim-shade)')
    a = ap.parse_args(argv)
    if a.cmd == 'native':
        return native(a.check)
    if a.cmd == 'stamp':
        return stamp(a.check)
    if a.cmd == 'compare':
        compare(a.images, a.names, a.out, current=not a.no_current,
                frame=brand_style.preset(a.frame, brand_style.frame_of(load_registry())) if a.frame else None)
        return 0
    if a.cmd == 'propose':
        propose(a.ref, a.variants, a.out, a.dry_run, a.engine, run_compare=not a.no_compare)
        return 0
    if a.cmd == 'zoom':
        zoom(a.image, a.subject_width, a.out)
        return 0
    if a.cmd == 'set':
        return set_master(a.image, a.provenance, a.name, a.yes, a.native_out, a.proof, tree_gate=not a.no_tree_gate, today=a.date, frame_style=a.frame)
    ap.print_help()
    return 2


if __name__ == '__main__':
    sys.exit(main())
