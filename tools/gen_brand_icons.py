#!/usr/bin/env python3
"""Every Cubby icon, from ONE painted master.

WHY THIS EXISTS
Until 2026-11-13 two bears competed. The app icon, favicon, apple-touch icon, manifest icons, the
sign-in card, the landing page and the nav of ~680 marketing pages all showed a FLAT brown face that
generate_icons.py drew with Pillow circles in June (55e166ca), while every illustration inside the app
was painted (ChatGPT / gpt-image). The founder: "we should never have such horrible drawings, let's
ensure we have the standard logo everywhere". He picked the master below from six candidates: the
painted hero cub's FACE ONLY on a honey ground, made from app/journey-art/ov_hero-cub.webp
(art-src/hero-cub.png) with gpt-image-2. Nothing here draws a bear. Every file is a resize of it.

    icons/icon-master-1024.png    the master, committed as-is (sha256 pinned in tools/brand-images.json)

WHAT IT WRITES (web, committed)
    icons/logo-512.png            512, rounded corners baked in (alpha), the filename ~680 pages use
    icons/favicon.png             48, rounded like the logo
    icons/apple-touch-icon.png    180, square and opaque (iOS rounds it itself)
    icons/icon-192.png            manifest "any": square, opaque
    icons/icon-512.png            manifest "any": square, opaque
    icons/icon-maskable-512.png   manifest "maskable": the face shrunk into the 80% safe circle
    cap-web/logo.png              192, for the native wrapper's offline fallback page (cap-web/index.html)

WHAT IT WRITES (native, with --native or --native-out; ios/ and android/ are gitignored)
    ios/App/App/Assets.xcassets/AppIcon.appiconset/   every size, 1024 App Store icon, NO alpha
    android/app/src/main/res/mipmap-*/                ic_launcher, ic_launcher_round, ic_launcher_foreground
    android/app/src/main/res/values/ic_launcher_background.xml   the master's own honey

THE MASKED SHAPES
A maskable icon is cut to whatever the launcher likes, guaranteed only inside a centred circle of 80%
diameter; an Android adaptive foreground is 108dp of which a 66dp circle is safe. The master's ears
reach the corners, so for those the face is SHRUNK onto a fill of the master's own honey (sampled from
its border, never invented), with the master's edge feathered into the fill so no seam shows. The
scale is computed from the face's measured extent, so a new master cannot quietly clip an ear.

SMALL SIZES
At 64px and below a light unsharp mask (radius 0.5, 40%, threshold 1) is applied. Measured on this
master (re-measured 2026-11-13 on the square resize): local contrast (Laplacian variance) +27 to +30% at
16-64px, the darkest pixel (the eyes) 8-18 levels darker, clipped channels from 0.4-1.5% to 1.8-3.0%.
Above 64px it does nothing visible, so it is not applied.

Usage:
    python3 tools/gen_brand_icons.py                     web icons into icons/
    python3 tools/gen_brand_icons.py --native            also ios/ and android/ of this tree (if present)
    python3 tools/gen_brand_icons.py --native-out DIR    write the native sets under DIR instead
    python3 tools/gen_brand_icons.py --check             write nothing; fail if a committed web icon
                                                         differs from what the master gives
    python3 tools/gen_brand_icons.py --strip OUT.png     also render the size strip (light + dark)
"""
import argparse
import hashlib
import io
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, 'icons', 'icon-master-1024.png')
REGISTRY = os.path.join(ROOT, 'tools', 'brand-images.json')

LOGO_RADIUS = 0.24      # same corner as the June logo, so every CSS border-radius over it still wins
SHARPEN_MAX = 64        # px; see SMALL SIZES above
SS = 4                  # supersampling for the alpha masks

IOS_SET = [  # (idiom, size in points, scale)
    ('iphone', 20, 2), ('iphone', 20, 3), ('iphone', 29, 2), ('iphone', 29, 3),
    ('iphone', 40, 2), ('iphone', 40, 3), ('iphone', 60, 2), ('iphone', 60, 3),
    ('ipad', 20, 1), ('ipad', 20, 2), ('ipad', 29, 1), ('ipad', 29, 2),
    ('ipad', 40, 1), ('ipad', 40, 2), ('ipad', 76, 2), ('ipad', 83.5, 2),   # 76@1x: iOS 9 and older only (actool says so)
    ('ios-marketing', 1024, 1),
]
ANDROID_DPI = [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]


def load_master():
    if not os.path.exists(MASTER):
        sys.exit('No master at %s' % MASTER)
    im = Image.open(MASTER).convert('RGB')
    if im.size != (1024, 1024):
        sys.exit('The master must be 1024x1024, got %dx%d' % im.size)
    try:
        pinned = json.load(open(REGISTRY))['master']['sha256']
        got = hashlib.sha256(open(MASTER, 'rb').read()).hexdigest()
        if pinned != got:
            sys.exit('icons/icon-master-1024.png is not the master the founder chose (sha256 %s, pinned %s).\n'
                     'A new master is a founder decision: update tools/brand-images.json on purpose.' % (got, pinned))
    except FileNotFoundError:
        pass
    return im


def honey_of(master):
    """The master's own background: the mean of a 40px border band (std ~2-3 per channel)."""
    a = np.asarray(master).astype(np.float64)
    b = 40
    band = np.concatenate([a[:b].reshape(-1, 3), a[-b:].reshape(-1, 3), a[:, :b].reshape(-1, 3), a[:, -b:].reshape(-1, 3)])
    return tuple(int(round(v)) for v in band.mean(0))


def face_radius(master, honey):
    """How far the face reaches from the centre, as a fraction of the half-size (1.0 = touches an edge midpoint)."""
    a = np.asarray(master).astype(np.float64)
    d = np.abs(a - np.array(honey)).max(axis=2)
    ys, xs = np.nonzero(d > 25)
    r = np.sqrt((xs - 511.5) ** 2 + (ys - 511.5) ** 2).max()
    return r / 512.0


def resize(img, size):
    out = img.resize((size, size), Image.LANCZOS)
    if size <= SHARPEN_MAX:
        out = out.filter(ImageFilter.UnsharpMask(radius=0.5, percent=40, threshold=1))
    return out


def rounded(img, frac):
    n = img.size[0]
    mask = Image.new('L', (n * SS, n * SS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n * SS - 1, n * SS - 1], radius=int(n * SS * frac), fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask.resize((n, n), Image.LANCZOS))
    return out


def circled(img):
    n = img.size[0]
    mask = Image.new('L', (n * SS, n * SS), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, n * SS - 1, n * SS - 1], fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask.resize((n, n), Image.LANCZOS))
    return out


def inset(master, honey, scale, work=1024):
    """The whole master shrunk to `scale` and centred on its own honey, edges feathered into the fill."""
    inner = int(round(work * scale))
    small = master.resize((inner, inner), Image.LANCZOS)
    feather = max(2, int(inner * 0.05))
    ramp = np.minimum.reduce([
        np.arange(inner)[None, :].repeat(inner, 0), np.arange(inner)[::-1][None, :].repeat(inner, 0),
        np.arange(inner)[:, None].repeat(inner, 1), np.arange(inner)[::-1][:, None].repeat(inner, 1),
    ]).astype(np.float64)
    alpha = Image.fromarray((np.clip(ramp / feather, 0, 1) * 255).astype(np.uint8))
    canvas = Image.new('RGB', (work, work), honey)
    off = (work - inner) // 2
    canvas.paste(small, (off, off), alpha)
    return canvas


def scale_for_circle(radius_frac, face_r):
    """Scale that puts the face's furthest point at `radius_frac` of the canvas from the centre."""
    return min(1.0, radius_frac / (0.5 * face_r))


def png_bytes(img, honey=None):
    """PNG bytes. With `honey`, a 240-colour median-cut palette (43-45 dB PSNR against full colour,
    indistinguishable at any size it is shown) plus 16 alpha levels of honey for the anti-aliased
    rounded corners. Full colour would be ~380KB for the 512 logo; Pillow's octree palette is 50KB
    but visibly posterises the muzzle and erases the paper grain, which is the painting."""
    buf = io.BytesIO()
    if honey is None:
        img.save(buf, 'PNG', optimize=True)
        return buf.getvalue()
    a = np.asarray(img.convert('RGBA'))
    al = a[:, :, 3]
    q = Image.fromarray(np.ascontiguousarray(a[:, :, :3])).quantize(colors=240, method=Image.Quantize.MEDIANCUT)
    idx = np.asarray(q).copy()
    edge = al < 255
    idx[edge] = 240 + np.round(al[edge] / 255.0 * 15).astype(np.uint8)
    out = Image.frombytes('P', (idx.shape[1], idx.shape[0]), idx.astype(np.uint8).tobytes())
    out.putpalette(q.getpalette()[:240 * 3] + list(honey) * 16)
    if edge.any():
        out.save(buf, 'PNG', optimize=True, transparency=bytes([255] * 240 + [int(round(k * 255 / 15.0)) for k in range(16)]))
    else:
        out.save(buf, 'PNG', optimize=True)
    return buf.getvalue()


def web_set(master, honey, face_r):
    maskable = inset(master, honey, scale_for_circle(0.40, face_r))
    return {
        # The two 512s are on ~680 pages and in the app's precache: palette PNGs (see png_bytes).
        'icons/logo-512.png': png_bytes(rounded(resize(master, 512), LOGO_RADIUS), honey),
        'icons/favicon.png': png_bytes(rounded(resize(master, 48), LOGO_RADIUS)),
        'icons/apple-touch-icon.png': png_bytes(resize(master, 180)),
        'icons/icon-192.png': png_bytes(resize(master, 192)),
        'icons/icon-512.png': png_bytes(resize(master, 512), honey),
        'icons/icon-maskable-512.png': png_bytes(resize(maskable, 512)),
        # The Capacitor webDir fallback page is bundled into the native app and shown offline, so it
        # cannot reach /icons/: it gets its own small copy, beside it.
        'cap-web/logo.png': png_bytes(rounded(resize(master, 192), LOGO_RADIUS)),
    }


def native_set(master, honey, face_r):
    files = {}
    ios_dir = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/'
    images = []
    for idiom, pt, sc in IOS_SET:
        px = int(round(pt * sc))
        # The 1024 keeps the name Capacitor's template gave it (AppIcon-512@2x.png), so a regen OVERWRITES the
        # old icon instead of leaving it beside the new set as an unassigned child (an actool warning), and
        # nothing ever has to be deleted.
        name = 'AppIcon-%s-%gx%g@%dx.png' % (idiom, pt, pt, sc) if idiom != 'ios-marketing' else 'AppIcon-512@2x.png'
        img = resize(master, px).convert('RGB')          # Apple rejects an alpha channel outright
        files[ios_dir + name] = png_bytes(img)
        images.append({'filename': name, 'idiom': idiom, 'scale': '%dx' % sc, 'size': '%gx%g' % (pt, pt)})
    files[ios_dir + 'Contents.json'] = (json.dumps({'images': images, 'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n').encode()

    res = 'android/app/src/main/res/'
    round_face = inset(master, honey, scale_for_circle(0.44, face_r))      # inside a 92% circle
    fg = inset(master, honey, scale_for_circle(33.0 / 108.0, face_r))       # adaptive: 66dp safe circle of 108dp
    for dpi, mul in ANDROID_DPI:
        n, nf = int(48 * mul), int(108 * mul)
        tile = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        sq = int(round(n * 0.92)); off = (n - sq) // 2
        tile.alpha_composite(rounded(resize(master, sq), 0.20), (off, off))
        files[res + 'mipmap-%s/ic_launcher.png' % dpi] = png_bytes(tile)
        rt = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        rt.alpha_composite(circled(resize(round_face, sq)), (off, off))
        files[res + 'mipmap-%s/ic_launcher_round.png' % dpi] = png_bytes(rt)
        files[res + 'mipmap-%s/ic_launcher_foreground.png' % dpi] = png_bytes(resize(fg, nf).convert('RGBA'))
    hexc = '#%02X%02X%02X' % honey
    files[res + 'values/ic_launcher_background.xml'] = (
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        '    <color name="ic_launcher_background">%s</color>\n</resources>\n' % hexc).encode()
    adaptive = ('<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@color/ic_launcher_background"/>\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
                '</adaptive-icon>\n').encode()
    files[res + 'mipmap-anydpi-v26/ic_launcher.xml'] = adaptive
    files[res + 'mipmap-anydpi-v26/ic_launcher_round.xml'] = adaptive
    return files


def write(files, base):
    for rel, data in sorted(files.items()):
        p = os.path.join(base, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(data)
        print('  wrote %s (%d KB)' % (rel, (len(data) + 1023) // 1024))


def strip(master, out):
    """Every size on light and dark wallpaper, at 1:1 pixels, iOS-style squircle-ish rounding."""
    sizes = [16, 29, 32, 40, 60, 180, 512]
    pad = 24
    w = sum(sizes) + pad * (len(sizes) + 1)
    h = (max(sizes) + pad * 2) * 2 + 40
    canvas = Image.new('RGB', (w, h), (255, 255, 255))
    for row, wall in enumerate([(236, 236, 240), (28, 28, 32)]):
        y0 = row * (max(sizes) + pad * 2 + 20)
        ImageDraw.Draw(canvas).rectangle([0, y0, w, y0 + max(sizes) + pad * 2], fill=wall)
        x = pad
        for s in sizes:
            ic = rounded(resize(master, s), 0.2237)
            canvas.paste(ic, (x, y0 + pad + (max(sizes) - s) // 2), ic)
            x += s + pad
    canvas.save(out, 'PNG', optimize=True)
    print('  strip %s (%dx%d)' % (out, w, h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--native', action='store_true')
    ap.add_argument('--native-out')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--strip')
    a = ap.parse_args()

    master = load_master()
    honey = honey_of(master)
    face_r = face_radius(master, honey)
    print('master %s  honey #%02X%02X%02X  face reaches %.3f of the half-size' % (os.path.relpath(MASTER, ROOT), *honey, face_r))
    web = web_set(master, honey, face_r)

    if a.check:
        bad = [rel for rel, data in web.items()
               if not os.path.exists(os.path.join(ROOT, rel)) or open(os.path.join(ROOT, rel), 'rb').read() != data]
        for rel in bad:
            print('  DIFFERS %s: not what the master gives; run python3 tools/gen_brand_icons.py' % rel)
        print('BRAND ICONS: ' + ('FAIL' if bad else 'PASS (%d web icons match the master)' % len(web)))
        sys.exit(1 if bad else 0)

    write(web, ROOT)
    if a.native or a.native_out:
        nat = native_set(master, honey, face_r)
        if a.native_out:
            write(nat, a.native_out)
        else:
            for top in ('ios', 'android'):
                if os.path.isdir(os.path.join(ROOT, top)):
                    write({k: v for k, v in nat.items() if k.startswith(top + '/')}, ROOT)
                else:
                    print('  (no %s/ here: run `npx cap add %s` first, or use --native-out)' % (top, top))
    if a.strip:
        strip(master, a.strip)


if __name__ == '__main__':
    main()
