#!/usr/bin/env python3
"""Cubby SEO guard — static checks over the built site so broken SEO can't ship.

This is the seatbelt for "seamless, always-fresh SEO": run it in the pre-commit hook and
in CI so the regressions the July 2026 audit found (61 broken internal links, 402 dead
og:images, dead-domain canonicals) can never reach production again.

Usage:
  python3 tools/seo_check.py            # check whole site; exit 1 on any HARD failure
  python3 tools/seo_check.py --fix      # auto-fix the safe ones, then re-check
  python3 tools/seo_check.py --staged   # only inspect git-staged pages (fast; for pre-commit)
  python3 tools/seo_check.py --quiet    # only print failures

HARD failures (block the commit / fail CI):
  - internal link to a page/file that does not exist on disk (broken link, would 404)
  - og:image / twitter:image that does not resolve to a real image file
  - any reference to the dead domain littlecubby.app
  - a JSON-LD block that does not parse
  - a sitemap <loc> whose path has no file on disk (sitemap -> 404)

WARN (printed, non-blocking):
  - page missing <title> or meta description
  - a canonical that is not self-referential

--fix repoints unresolved og/twitter images to /og/articles.png and re-stamps the sitemap
(via gen_sitemap.py); it never guesses a broken link's target (that needs a human).
"""
import os, re, sys, json, glob, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
DOMAIN = "https://little-cubby.com"
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg")
# Worker-handled / client-routed prefixes that legitimately have no static file.
DYNAMIC = re.compile(r'^/(api|__|g)(/|$)')

FIX   = "--fix" in sys.argv
STAGED = "--staged" in sys.argv
QUIET = "--quiet" in sys.argv

# Not public marketing/content pages, so out of scope for the page scan: build drafts,
# dev/app templates, the PWA shell (client-routed, noindex), and internal asset sources.
# (The valid-path index below is still built from ALL files, so links to these still resolve.)
SKIP = ("node_modules/", "/.git/", "articles-drafts/", "tools/", "mockups/",
        "test/", "social/", "art-src/", "docs/", "app/", "g/")


def public(f):
    f = f.replace("\\", "/")
    return not any(s in ("/" + f) for s in SKIP)


def build_index():
    """Every file path and every directory that has an index.html, as site-absolute paths."""
    files, dirs = set(), {"/"}
    for dp, dn, fn in os.walk("."):
        if "/node_modules" in dp or "/.git" in dp:
            dn[:] = [d for d in dn if d not in ("node_modules", ".git")]
            continue
        rel = os.path.relpath(dp, ".").replace("\\", "/")
        prefix = "/" if rel == "." else "/" + rel + "/"
        for f in fn:
            files.add((prefix + f) if prefix != "/" else "/" + f)
            if f == "index.html":
                dirs.add(prefix)
    return files, dirs


def resolves(path, files, dirs):
    path = path.split("?")[0].split("#")[0]
    if not path.startswith("/"):
        return True                      # external / relative — out of scope here
    if DYNAMIC.match(path):
        return True                      # /api /__ /g are worker routes
    if path.endswith("/"):
        return path in dirs
    if path in files:
        return True
    if (path + "/") in dirs:
        return True
    if (path + ".html") in files:
        return True
    return False


def strip_domain(u):
    return u[len(DOMAIN):] if u.startswith(DOMAIN) else u


def staged_html():
    out = subprocess.run(["git", "diff", "--cached", "--name-only"],
                         capture_output=True, text=True).stdout.split()
    return [f for f in out if f.endswith(".html") and os.path.exists(f)]


HREF = re.compile(r'href="([^"]+)"')
OGIMG = re.compile(r'<meta (?:property|name)="(?:og:image|twitter:image)" content="([^"]+)"\s*/?>')
CANON = re.compile(r'<link rel="canonical" href="([^"]+)"')
LD = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


def check():
    files, dirs = build_index()
    if STAGED:
        pages = [f for f in staged_html() if public(f)]
    else:
        pages = [f for f in glob.glob("**/*.html", recursive=True) if public(f)]

    hard, warn = [], []
    og_to_fix = []

    for f in pages:
        t = open(f, encoding="utf-8").read()
        page_path = "/" + os.path.relpath(f, ".").replace("\\", "/")

        # dead domain anywhere
        if "littlecubby.app" in t:
            hard.append((f, "references dead domain littlecubby.app"))

        # internal links resolve
        for href in HREF.findall(t):
            p = strip_domain(href)
            if p.startswith(("/", DOMAIN)) and not resolves(p, files, dirs):
                hard.append((f, f"broken link -> {p}"))

        # og/twitter images resolve to a real image
        for u in OGIMG.findall(t):
            p = strip_domain(u)
            ok = p.startswith("/") and p.lower().endswith(IMG_EXT) and (p in files)
            if not ok:
                hard.append((f, f"unresolved social image -> {u}"))
                og_to_fix.append(f)

        # JSON-LD parses
        for m in LD.finditer(t):
            try:
                json.loads(m.group(1))
            except Exception as e:
                hard.append((f, f"invalid JSON-LD ({e})"))

        # title + description present
        if "<title>" not in t:
            warn.append((f, "no <title>"))
        if '<meta name="description"' not in t:
            warn.append((f, "no meta description"))

        # canonical self-referential (dir pages only; files/app excluded)
        cm = CANON.search(t)
        if cm and f.endswith("index.html") and "/app/" not in page_path:
            expect = DOMAIN + page_path.rsplit("index.html", 1)[0]
            if strip_domain(cm.group(1)) != strip_domain(expect):
                warn.append((f, f"canonical not self-referential ({cm.group(1)})"))

    # sitemap <loc> all resolve to a file (whole-site check, always)
    if os.path.exists("sitemap.xml"):
        sm = open("sitemap.xml", encoding="utf-8").read()
        for loc in re.findall(r'<loc>([^<]+)</loc>', sm):
            p = strip_domain(loc.strip())
            if not resolves(p, files, dirs):
                hard.append(("sitemap.xml", f"loc has no file -> {loc.strip()}"))

    return hard, warn, sorted(set(og_to_fix))


def do_fix(og_files):
    n = 0
    for f in og_files:
        t = open(f, encoding="utf-8").read(); o = t
        def repl(m):
            u = strip_domain(m.group(1))
            ok = u.startswith("/") and u.lower().endswith(IMG_EXT) and os.path.exists("." + u)
            return m.group(0) if ok else m.group(0).split('content="')[0] + 'content="https://little-cubby.com/og/articles.png">'
        t = OGIMG.sub(repl, t)
        if t != o:
            open(f, "w", encoding="utf-8").write(t); n += 1
    subprocess.run([sys.executable, "tools/gen_sitemap.py"], capture_output=True)
    return n


def main():
    hard, warn, og_fix = check()
    if FIX and (og_fix or True):
        fixed = do_fix(og_fix)
        if fixed and not QUIET:
            print(f"  fixed {fixed} pages' social images; re-stamped sitemap")
        hard, warn, _ = check()

    if warn and not QUIET:
        print(f"⚠  {len(warn)} warning(s):")
        for f, m in warn[:40]:
            print(f"     {f}: {m}")
        if len(warn) > 40:
            print(f"     ... and {len(warn)-40} more")

    if hard:
        print(f"✋ SEO guard: {len(hard)} HARD failure(s) — fix before shipping"
              + (" (try --fix for social images)" if any('social image' in m for _, m in hard) else "") + ":")
        for f, m in hard[:60]:
            print(f"     {f}: {m}")
        if len(hard) > 60:
            print(f"     ... and {len(hard)-60} more")
        sys.exit(1)

    if not QUIET:
        scope = "staged pages" if STAGED else "whole site"
        print(f"✓ SEO guard passed ({scope}): no broken links, social images resolve, JSON-LD valid, sitemap clean.")


if __name__ == "__main__":
    main()
