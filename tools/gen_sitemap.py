#!/usr/bin/env python3
"""Stamp accurate <lastmod> on every /articles/<slug>/ entry in sitemap.xml.

Source of truth = each article's BlogPosting JSON-LD "dateModified". Those dates
are genuinely varied (editorially set per article), so they are a real freshness
signal for crawlers. We deliberately do NOT use git/file mtime: the article set
was bulk-committed on a couple of dates, which would emit a fake uniform signal.

Non-article URLs (home, vaccine schedules, pricing, faq, hubs, etc.) keep their
hand-maintained <lastmod> and hreflang blocks untouched. Idempotent: re-running
refreshes article lastmods in place.

Run from the repo root after editing or adding articles:
    python3 tools/gen_sitemap.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARTICLES = ROOT / 'articles'
SITEMAP = ROOT / 'sitemap.xml'

LDJSON = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
DATE = re.compile(r'"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})"')


def article_date(html: str):
    """Return the dateModified from the BlogPosting block, else any dateModified."""
    blocks = LDJSON.findall(html)
    for b in blocks:
        if 'BlogPosting' in b:
            m = DATE.search(b)
            if m:
                return m.group(1)
    for b in blocks:
        m = DATE.search(b)
        if m:
            return m.group(1)
    return None


def main():
    slug_date = {}
    missing = []
    for idx in sorted(ARTICLES.glob('*/index.html')):
        slug = idx.parent.name
        d = article_date(idx.read_text(encoding='utf-8'))
        if d:
            slug_date[slug] = d
        else:
            missing.append(slug)

    sm = SITEMAP.read_text(encoding='utf-8')

    # 1. Strip any existing lastmod immediately following an article <loc> (idempotency).
    sm = re.sub(
        r'(<loc>https://little-cubby\.com/articles/[^/]+/</loc>)(\s*)<lastmod>\d{4}-\d{2}-\d{2}</lastmod>',
        r'\1\2', sm,
    )

    # 2. Insert fresh <lastmod> right after each article <loc>.
    stamped = {'n': 0}

    def repl(m):
        slug = m.group(1)
        d = slug_date.get(slug)
        if not d:
            return m.group(0)
        stamped['n'] += 1
        return m.group(0) + f'<lastmod>{d}</lastmod>'

    sm = re.sub(r'<loc>https://little-cubby\.com/articles/([^/]+)/</loc>', repl, sm)

    SITEMAP.write_text(sm, encoding='utf-8')
    print(f'Articles found: {len(slug_date)}   lastmod stamped: {stamped["n"]}')
    if missing:
        print(f'WARNING: {len(missing)} article(s) had no dateModified: {missing}', file=sys.stderr)


if __name__ == '__main__':
    main()
