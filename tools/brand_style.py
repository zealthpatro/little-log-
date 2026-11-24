#!/usr/bin/env python3
"""How the logo is dressed: the frame around every tile, and the version every logo URL carries.

WHY THIS EXISTS
On 2026-11-15 the founder found the W2+ teddy too low in contrast (fur 2.40:1 against its own wash; the
June flat bear was 5.16:1) and asked for "effects like a bezel" so it stands out. From a mockup of eight
treatments he picked "A + rim + light/shade": a deeper chocolate-caramel teddy, framed by a warm honey rim
about 3% of the tile wide that follows the tile's rounded shape, with a soft light across the top and a soft
shade across the bottom. He also asked that a change like this be ONE command. So the frame is a SETTING,
stored in tools/brand-images.json beside the master, and every generator draws it from there:

    "frame": {"style": "rim-shade", "rim": 0.03, "colour": "#D6A058", "highlight": 0.22, "shade": 0.18}

    python3 tools/brand.py set NEW.png --frame rim-shade --yes     a new master, framed
    python3 tools/brand.py set icons/icon-master-1024.png --frame none --yes      the frame alone, off

THE STYLES (FRAMES below; a style named on the command line starts from its preset)
    none        the tile as painted
    rim         a rim of `colour`, `rim` x the tile's width, along the tile's own rounded edge
    rim-shade   the rim, then light over the top (white, `highlight` at the top edge, fading out by 32% of
                the height) and shade over the bottom (dark, rising from 69% of the height to `shade` x 0.84
                at the bottom edge). Fitted to the mockup the founder picked, drawn at its 110px and measured
                row by row on the middle of the tile: within 0.035 of its light and 0.025 of its shade at every
                height, and the rim within 2 levels of its colour at the top, the middle and the bottom
                (2026-11-15).
    ring        a thin cocoa ring (the mockup's "A + thin cocoa ring")

WHERE IT GOES
Every TILE: the logo PNGs, the favicon, the apple-touch and manifest "any" icons, the iOS AppIcon set, the
legacy Android launcher square, cap-web/logo.png and the logo on every card. Never the maskable icon, the
Android adaptive foreground or the round icon (the launcher cuts those to its own shape, so a rim would be cut
through; the face stays on its ground inside the safe zone), and never the splash (the face alone on cream).
Below FRAME_MIN px no frame is drawn: at 16px a 3% rim is half a pixel, which reads as a dirty edge.

HOW IT IS DRAWN (framed())
The inner edge of the rim is a rounded square inset by the rim's width, its corner radius the tile's minus the
rim's (the exact inward offset of a rounded square), drawn on a 4x grid and averaged down. EVERYTHING outside
that inner edge is rim. On our own rounded tiles the rounded corners then cut the outside away. On a square
icon the system masks itself (iOS, the apple-touch icon), the inner edge follows the iOS corner (0.2237 of the
width) and the square's corners are rim too, so whatever the system's mask is, its edge falls on rim and never
on a sliver of wash: no double edge.

THE VERSION (version_for())
Returning visitors kept the OLD logo for up to 30 days after 2026-11-14, because /icons/* is cached for a
month (_headers) and the files kept their names. Every reference to a file made from the master now carries
?v=<version>: the first 8 hex of sha256(master sha256 | the frame, as canonical JSON). A new master or a new
frame is a new URL, which no cache can answer with the old bytes. tools/brand.py set writes it into the registry
as "url_version" and onto every reference; tools/brand_image_check.js recomputes it and fails a reference that
carries any other.

Pillow and the standard library only: tools/brand.py, tools/gen_brand_icons.py and tools/card_logo.py all
draw with this one function.
"""
import hashlib
import json
import os
import posixpath
import re
from collections import OrderedDict

from PIL import Image, ImageDraw

# TEST ONLY: CUBBY_BRAND_SIM_ENCODER=rle makes every PNG any brand tool writes deflate with Z_RLE, so the
# same pixels come out as other bytes, as the same pinned Pillow on CI's Linux writes other bytes than the Mac
# that made the committed icons (brand-py red there since 16 Nov 2026). tools/brand.py --self-test is run with
# it to prove its pixel mode without a Linux box (docs/TESTING.md). Every brand writer imports this module,
# so one switch reaches them all, the self-test's subprocesses included. Never set it for a real `set`.
SIM_ENCODER_ENV = 'CUBBY_BRAND_SIM_ENCODER'


def simulate_other_encoder():
    """Make every PNG this process saves deflate with Z_RLE (same pixels, other bytes). Returns the save
    handler it replaced, so a caller can put it back with Image.register_save('PNG', it)."""
    from PIL import PngImagePlugin
    Image.preinit()
    before = Image.SAVE['PNG']

    def _rle_png_save(im, fp, filename):
        im.encoderinfo = dict(im.encoderinfo, compress_type=3)        # zlib's Z_RLE strategy
        return PngImagePlugin._save(im, fp, filename)
    Image.register_save('PNG', _rle_png_save)
    return before


if os.environ.get(SIM_ENCODER_ENV):
    if os.environ[SIM_ENCODER_ENV] != 'rle':
        raise SystemExit('%s=%r: the only simulated encoder is "rle"' % (SIM_ENCODER_ENV, os.environ[SIM_ENCODER_ENV]))
    simulate_other_encoder()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG_REL = 'tools/brand-images.json'

FRAME_MIN = 32          # px: below this a frame is not drawn (see WHERE IT GOES)
SS = 4                  # supersampling for the rim's inner edge
HIGHLIGHT_TO = 0.32     # the light fades out by this fraction of the height
SHADE_FROM = 0.69       # the shade starts here...
SHADE_SPAN = 0.37       # ...and would reach `shade` this far below it (0.84 of it at the bottom edge)

FRAMES = OrderedDict([
    ('none', OrderedDict([('style', 'none')])),
    ('rim', OrderedDict([('style', 'rim'), ('rim', 0.03), ('colour', '#D6A058')])),
    ('rim-shade', OrderedDict([('style', 'rim-shade'), ('rim', 0.03), ('colour', '#D6A058'), ('highlight', 0.22), ('shade', 0.18)])),
    ('ring', OrderedDict([('style', 'ring'), ('rim', 0.012), ('colour', '#6B4226')])),
])
NEEDS = {'none': (), 'rim': ('rim', 'colour'), 'rim-shade': ('rim', 'colour', 'highlight', 'shade'), 'ring': ('rim', 'colour')}


def load_registry(root=None):
    with open(os.path.join(root or ROOT, REG_REL), encoding='utf-8') as f:
        return json.load(f, object_pairs_hook=OrderedDict)


def frame_of(reg):
    """The registry's frame, checked; a registry without one is unframed."""
    f = reg.get('frame') if isinstance(reg, dict) else None
    f = OrderedDict(f) if f else OrderedDict(FRAMES['none'])
    problems = check_frame(f)
    if problems:
        raise ValueError('tools/brand-images.json "frame": ' + '; '.join(problems))
    return f


def check_frame(f):
    style = f.get('style')
    if style not in FRAMES:
        return ['style %r is not one of %s' % (style, ', '.join(FRAMES))]
    bad = ['%s is missing' % k for k in NEEDS[style] if k not in f]
    for k in ('rim', 'highlight', 'shade'):
        if k in f and not (isinstance(f[k], (int, float)) and not isinstance(f[k], bool) and 0 <= f[k] <= 0.5):
            bad.append('%s must be a number from 0 to 0.5, got %r' % (k, f[k]))
    if 'colour' in f:
        try:
            rgb(f['colour'])
        except (ValueError, TypeError, AttributeError):
            bad.append('colour must be #RRGGBB, got %r' % (f['colour'],))
    return bad


def preset(style, current=None):
    """The frame for `style` on the command line: the registry's own when it already has that style (its
    numbers may have been tuned), else the style's preset."""
    if style not in FRAMES:
        raise ValueError('no frame style %r (one of %s)' % (style, ', '.join(FRAMES)))
    if current and current.get('style') == style:
        return OrderedDict(current)
    return OrderedDict(FRAMES[style])


def describe(f):
    s = f.get('style', 'none')
    if s == 'none':
        return 'no frame'
    out = '%s: rim %g%% %s' % (s, 100 * f['rim'], f['colour'])
    if s == 'rim-shade':
        out += ', light %g, shade %g' % (f['highlight'], f['shade'])
    return out


def rgb(h):
    h = h.strip().lstrip('#')
    if len(h) != 6:
        raise ValueError(h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def framed(img, frame, radius):
    """`img` (square, already at the size it is shown) with `frame` drawn on it along a rounded square of
    corner `radius` (a fraction of the width). RGB in, RGB out; the caller cuts the tile's own corners."""
    style = (frame or {}).get('style', 'none')
    base = img.convert('RGB')
    n = base.size[0]
    if style == 'none' or n < FRAME_MIN:
        return base
    w = max(1.0, float(frame['rim']) * n)
    k = int(round(w * SS))
    big = n * SS
    m = Image.new('L', (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle([k, k, big - 1 - k, big - 1 - k], radius=max(0, int(round((radius * n - w) * SS))), fill=255)
    inner = m.resize((n, n), Image.BOX)
    out = Image.composite(base, Image.new('RGB', (n, n), rgb(frame['colour'])), inner)
    if style == 'rim-shade':
        light, dark = Image.new('L', (1, n)), Image.new('L', (1, n))
        for y in range(n):
            t = (y + 0.5) / n
            light.putpixel((0, y), int(round(255 * float(frame['highlight']) * max(0.0, 1 - t / HIGHLIGHT_TO))))
            dark.putpixel((0, y), int(round(255 * float(frame['shade']) * min(1.0, max(0.0, (t - SHADE_FROM) / SHADE_SPAN)))))
        out = Image.composite(Image.new('RGB', (n, n), (255, 255, 255)), out, light.resize((n, n), Image.NEAREST))
        out = Image.composite(Image.new('RGB', (n, n), (0, 0, 0)), out, dark.resize((n, n), Image.NEAREST))
    return out


def rounded(img, frac, ss=4):
    """Corners cut on a 4x supersampled mask (the same cut every logo tile has always had)."""
    n = img.size[0]
    mask = Image.new('L', (n * ss, n * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n * ss - 1, n * ss - 1], radius=int(n * ss * frac), fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask.resize((n, n), Image.LANCZOS))
    return out


# ---------------------------------------------------------------- the version on every logo URL

def canonical(frame):
    """The frame as JSON with sorted keys and no spaces, whole numbers written without '.0': the same text
    JSON.stringify gives in tools/brand_image_check.js, so both compute one version."""
    def norm(v):
        return int(v) if isinstance(v, float) and v.is_integer() else v
    f = frame or FRAMES['none']
    return json.dumps(OrderedDict((k, norm(f[k])) for k in sorted(f)), separators=(',', ':'), ensure_ascii=True)


def version_for(master_sha, frame):
    return hashlib.sha256((master_sha + '|' + canonical(frame)).encode('utf-8')).hexdigest()[:8]


def versioned_paths(reg):
    """Every file the registry marks as made from the master: the logo, icons and text cards. Each reference
    to one of them carries ?v=<url_version>."""
    out = []
    for fam in reg.get('families', []):
        if fam.get('from_master'):
            out += list(fam.get('files', {}))
    return sorted(set(out))


# The brand gate's REF_RE (tools/brand_image_check.js), character for character: an image path in quotes,
# url(), an attribute or a JSON value. Stamping finds references exactly where the gate grades them.
REF_RE = re.compile(r'''(["'(\s=,])((?:https?://[^"'()\s<>]+?)|(?:[^"'()\s<>`]*?))\.(png|jpe?g|webp|gif|svg|ico|avif)(?=[?#"')\s,;\\]|$)''', re.I | re.M)
VER_RE = re.compile(r'\?v=([0-9a-f]*)')


def approved_names(reg):
    """{file name: {tree paths}} of every file the registry approves or holds pending (the gate's bare-name rule)."""
    names = {}
    for fam in reg.get('families', []):
        for p in fam.get('files', {}):
            names.setdefault(p.split('/')[-1], set()).add(p)
    if reg.get('master'):
        names.setdefault(reg['master']['path'].split('/')[-1], set()).add(reg['master']['path'])
    for d in reg.get('needs_founder_decision') or []:
        for p in d.get('files') or []:
            names.setdefault(p.split('/')[-1], set()).add(p)
    return names


def resolve_ref(f, raw, root, names):
    """The gate's resolveRef(): the tree path an image reference in file `f` (tree-relative) points at, or None."""
    u = raw.replace('\\/', '/')
    if re.match(r'^https?://', u, re.I):
        m = re.match(r'^https?://(?:www\.)?little-cubby\.com/(.*)$', u, re.I)
        return m.group(1) if m else None
    if '${' in u or '+' in u or '*' in u or u == '' or re.match(r'^[.]+$', u):
        return None
    if u.startswith('/'):
        return u[1:]
    d = posixpath.dirname(f)
    cands = [posixpath.normpath(posixpath.join(d, u)), posixpath.normpath(posixpath.join('app', u)), posixpath.normpath(u)]
    for c in cands:
        if os.path.exists(os.path.join(root, c)):
            return c
    if '/' not in u:
        named = names.get(u, set())
        return next(iter(named)) if len(named) == 1 else None
    return cands[0]


def refs_in(text, f, root, names):
    """(match, tree path) for every image reference in `text` that resolves to a file in this site."""
    for m in REF_RE.finditer(text):
        if not m.group(2) or m.group(2).endswith('/') or m.group(2).lower().startswith('data:'):
            continue
        p = resolve_ref(f, m.group(2) + '.' + m.group(3), root, names)
        if p is not None:
            yield m, p.split('?')[0].split('#')[0]


def carries(text, end, version):
    """Whether the reference ending at `end` carries exactly ?v=<version>."""
    vm = VER_RE.match(text, end)
    return bool(vm and vm.group(1) == version and not re.match(r'[0-9a-f]', text[vm.end():vm.end() + 1]))


def stamp_text(text, f, root, versioned, version, names):
    """(new text, references to versioned files, of them already carrying `version`). Each reference gets
    ?v=<version> in place of any ?v= it had; one followed by another query string is left as it is (the
    checks then name it)."""
    out, last, refs, current = [], 0, 0, 0
    for m, p in refs_in(text, f, root, names):
        if p not in versioned:
            continue
        refs += 1
        end = m.end()
        if carries(text, end, version):
            current += 1
            continue
        vm = VER_RE.match(text, end)
        if text[end:end + 1] == '?' and not vm:
            continue
        out.append(text[last:end])
        out.append('?v=' + version)
        last = vm.end() if vm else end
    out.append(text[last:])
    return ''.join(out), refs, current


def stamp_page(text, rel, root=None):
    """`text` (the file at tree path `rel`) with every logo reference carrying the registry's url_version: for
    a page generator, so what it writes is current (tools/gen_category_hub.py, tools/gen_vax_country.py)."""
    root = root or ROOT
    reg = load_registry(root)
    v = reg.get('url_version')
    if not v:
        return text
    return stamp_text(text, rel, root, set(versioned_paths(reg)), v, approved_names(reg))[0]
