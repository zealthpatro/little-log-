# Seamless SEO — how it stays healthy on its own

Cubby's SEO is kept correct and fresh by three small, dependency-free pieces. You do not
have to remember any of it; it runs on commit, on push, and in CI. This doc is just so the
next person (or agent) knows what is watching.

## 1. The guard — `tools/seo_check.py`

A static check over the built site. It fails (exit 1) on the exact regressions the July 2026
audit found, so they can never come back:

- an internal link to a page or file that does not exist (broken link → 404)
- an `og:image` / `twitter:image` that does not resolve to a real image
- any reference to the dead domain `littlecubby.app`
- a JSON-LD block that does not parse
- a `sitemap.xml` `<loc>` whose path has no file on disk

It warns (non-blocking) on a missing `<title>` / meta description or a non-self-referential
canonical. It only scans public marketing/content pages (drafts, dev templates, the PWA
shell and internal asset dirs are skipped).

```sh
python3 tools/seo_check.py            # whole site
python3 tools/seo_check.py --fix      # auto-repoint broken social images + re-stamp sitemap
python3 tools/seo_check.py --staged   # only staged pages (what the git hook runs)
```

`--fix` never guesses a broken link's target (that needs a human); it only repoints
unresolved social images to `/og/articles.png` and re-runs `gen_sitemap.py`.

## 2. Freshness — `tools/gen_sitemap.py` + `tools/indexnow_ping.py`

- **`gen_sitemap.py`** stamps every `/articles/<slug>/` `<lastmod>` from that article's
  `BlogPosting` `dateModified` (never git/file mtime). Idempotent; leaves hand-maintained
  entries and their hreflang alone.
- **`indexnow_ping.py`** tells Bing / Yandex / Seznam / Naver to recrawl. IndexNow is a
  crawl protocol, not a tracker, so it is fine under the no-third-party-tracker promise, and
  it does not affect Google (Google uses the sitemap `<lastmod>` + Search Console).

```sh
python3 tools/indexnow_ping.py --changed    # URLs changed vs origin/main (used by CI)
python3 tools/indexnow_ping.py --all        # every URL in the sitemap
python3 tools/indexnow_ping.py --dry-run …  # print the payload, don't send
```

## 3. Where it runs automatically

- **Local pre-commit** (`.githooks/pre-commit`, wired via `git config core.hooksPath .githooks`):
  when you stage any public page or the sitemap, it re-stamps `sitemap.xml`, stages it, then
  runs the guard on the staged pages. A broken-SEO commit is blocked. Bypass with
  `git commit --no-verify` only when you really mean it.
- **CI** (`.github/workflows/seo.yml`): every push and PR runs the full guard (so a local
  bypass can't ship broken SEO), and every push to `main` pings IndexNow for the changed pages.

## The one thing a human still owns

IndexNow only fully "wakes up" for the whole site when Cloudflare Crawler Hints is on:
**Cloudflare dashboard → the little-cubby.com zone → Caching → Configuration → Crawler Hints
(IndexNow) → on** (~2 minutes). The CI ping above already covers changed pages without it;
the toggle is the zero-maintenance, whole-site version. Also turn on **SSL/TLS → Edge
Certificates → Always Use HTTPS** so `http://` 301s to `https://`.
