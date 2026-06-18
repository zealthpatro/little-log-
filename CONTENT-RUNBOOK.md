# Cubby content runbook (for a scheduled agent or /loop)

> **Status (June 2026):** This workflow is current and live; it publishes baby and pregnancy articles to little-cubby.com (~180 articles live so far) by pushing to `main`, which auto-deploys via Cloudflare Workers Builds. Full current state + go-live plan: HANDOFF.md.

This is the full, self-contained workflow to research, write, self-review and **publish** one sourced baby-care article per run. It is YMYL (health) content: accuracy and sourcing are mandatory, fabrication is forbidden.

Point a schedule or loop at the **Master prompt** below. Everything it needs is here and in `CONTENT-QUEUE.md`.

---

## Environment / facts the agent needs
- Repo: this working directory. Branch: **main**.
- **Pushing to `main` auto-deploys** to Cloudflare. Live site: **https://little-cubby.com** (also https://cubby.saurav-918.workers.dev).
- Marketing/article pages are static and **not** service-worker cached, so a push goes live within ~1 minute; no cache bump needed for `/articles/*`.
- Shared styles: `/vax.css` + `/site.css`. Article template lives in any `articles/<slug>/index.html` (copy one, e.g. `articles/starting-solids-around-6-months/index.html`).
- Drafts that are NOT ready to publish go in `articles-drafts/` (git-tracked, never deployed).

## Hard rules (do not break)
1. **No fabrication.** Every health/timing/safety claim must be supported by an official source you actually fetched this run (NHS `nhs.uk/baby`, CDC `cdc.gov` act-early & infant-toddler-nutrition, WHO, AAP HealthyChildren, womenshealth.gov, national authorities).
2. **No copying.** Original wording only. Never reproduce any third-party blog/article. Match depth/structure, not text.
3. **Cite with deep links** in a "Trusted sources" list (`rel="nofollow noopener" target="_blank"`), and verify each URL returns HTTP 200 before citing. If a source URL is dead, find the current official page on the same domain; never cite a 404.
4. **Disclaimer on every article**: "Reviewed <today's date> · informational only and not medical advice, follow your doctor, midwife or health visitor."
5. **No diagnosis/treatment instructions** beyond what the source says; prefer "seek care if…".
6. **No em-dashes** in copy (use commas/colons).
7. If a claim cannot be sourced, reword or remove it. If a whole topic can't be safely sourced, save to `articles-drafts/` and stop (report it), do not publish.
8. **Article naming policy**: use the practice's actual name (maalish, zuo yuezi, ofuro) or a plain universal topic (safe sleep, starting solids, heatwave safety). Never prefix/suffix with a country or region ("Indian baby massage", "Starting solids in Australia", "for German parents"). The content body can and should reference the relevant country, authority, and cultural context; the `<title>`, `<h1>`, `og:title`, and JSON-LD headline must not use a country as a label.

## Steps per run
1. **Pick the topic.** Open `CONTENT-QUEUE.md`, take the first item marked `[ ]` (top = highest priority). Note its slug, age bracket(s), theme, and listed sources.
2. **Research.** WebFetch each listed source (and any current official page you find). Extract only what they actually say. Confirm each URL is live (200).
3. **Write** `articles/<slug>/index.html` by copying the template structure exactly:
   - `<head>`: title `"<Title> | Cubby"`, meta description, `<link rel="canonical" href="https://little-cubby.com/articles/<slug>/">`, robots index, Open Graph + Twitter (image `https://little-cubby.com/og/cubby-home.png`), fonts, `/vax.css` + `/site.css`, and a `BlogPosting` JSON-LD (headline, description, datePublished+dateModified = today ISO, author/publisher Cubby, mainEntityOfPage = the canonical, image = og).
   - `<nav>`: the standard nav with Articles active (copy from template).
   - `<main class="wrap article">`: `<h1>`, then `<p class="art-meta"><AGE> · <THEME> · Reviewed <today> · <a href="/articles/">All articles</a></p>`, then the body: intro, "why it matters", 3-6 sourced sections, an age/serving TABLE where useful, an FAQ (4-6 Qs), a `.cta` block (Start free -> /app/), a "Trusted sources" `<ul>` of deep links, and the `footer.src` disclaimer.
   - Long-form: aim ~1,500-2,500 words of genuinely useful, sourced content.
4. **Self-review (the gate).** Verify: every claim maps to a fetched source; all source links are 200; disclaimer + date present; JSON-LD parses; no em-dashes; original wording; canonical/og/slug consistent. Fix anything that fails. List any residual unsourced claim, if any remain, remove them.
5. **Publish wiring.**
   - Add a hub card in `articles/index.html` under the matching age `<h2>` section's `<div class="art-grid">`:
     `<a class="art-card" href="/articles/<slug>/"><div class="k"><THEME> · <AGE></div><div class="t"><Short title></div><div class="d"><one-line summary></div></a>`
     (If a needed age section heading doesn't exist, add it in the right order.)
   - Add to `sitemap.xml` before `</urlset>`:
     `<url><loc>https://little-cubby.com/articles/<slug>/</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`
     (no `<lastmod>` by hand: step 6 runs `tools/gen_sitemap.py`, which stamps it from the article's `dateModified`).
6. **Validate.**
   - **Stamp the sitemap `<lastmod>` from the article's `dateModified`:** `python3 tools/gen_sitemap.py` (idempotent; touches only `/articles/` entries, leaves hand-maintained pages alone).
   - **The file is real HTML (do this FIRST — never commit an agent's notes/verification report as the article):**
     `python3 -c "s=open('articles/<slug>/index.html').read();assert s.lstrip().startswith('<!DOCTYPE'),'not HTML';assert '<h1>' in s and s.rstrip().endswith('</html>'),'incomplete';print('HTML OK')"`
   - JSON-LD: `python3 -c "import re,json;[json.loads(x) for x in re.findall(r'<script type=\"application/ld\\+json\">(.*?)</script>', open('articles/<slug>/index.html').read(), re.S)];print('LD OK')"`
   - Sitemap: `python3 -c "import xml.dom.minidom as m;m.parse('sitemap.xml');print('sitemap OK')"`
   - Every article needs: `<!DOCTYPE>`, `<title>`, meta description, canonical, BreadcrumbList **and** BlogPosting JSON-LD, an h1, a Related-articles list, and ends with `</html>`. If any are missing, fix before commit.
7. **Mark done** in `CONTENT-QUEUE.md`: change that item's `[ ]` to `[x]` and append ` (published <today>)`.
8. **Commit & push:**
   `git add -A && git commit -m "Article: <Title> (sourced, <age>/<theme>)" && git push origin main`
9. **Verify live** (wait ~60s): `curl -s -o /dev/null -w "%{http_code}" https://little-cubby.com/articles/<slug>/` must be 200, and the page must contain the `<h1>`. If not, report.
10. **Report (short):** title, slug, live URL, sources used, and anything a human should double-check. Do not paste the whole article.

## Modes
- **Publish mode (default):** do all steps, push live.
- **Draft mode:** if invoked with "DRAFT ONLY", write to `articles-drafts/<slug>/index.html` instead of `articles/`, skip steps 5-9, and just report. Use this if you want a human to review first.

## Recommended cadence
1 article per run; schedule 2-3 runs/week. Skim the live pages weekly. If any run reports an unsourced claim it couldn't resolve, it should have used Draft mode for that one.

## SEO automation: sitemap lastmod + IndexNow
- **Sitemap freshness:** `tools/gen_sitemap.py` rewrites every `/articles/<slug>/` `<lastmod>` from that article's `BlogPosting` `dateModified`. Run it after any article add/edit (step 6 above already does). It never touches hand-maintained entries (home, vaccine schedules, pricing, hubs) or their hreflang blocks. Do **not** source lastmod from git/file mtime: the article set shares a couple of bulk-commit dates and that would emit a fake uniform signal.
- **IndexNow (instant Bing / Yandex / Seznam / Naver discovery).** Our key is hosted at the repo root: `960a9783b1c530262ca0538b140439a8.txt` (served at `https://little-cubby.com/960a9783b1c530262ca0538b140439a8.txt`). It is a crawl protocol, not a tracker, so it is compatible with the no-third-party-tracker promise, and it does not affect Google (Google uses the sitemap `<lastmod>` + Search Console).
  - **After a content push goes live**, submit the new/changed URL(s) (low-stakes, just asks the Bing-family engines to crawl public URLs):
    ```sh
    curl -s "https://api.indexnow.org/indexnow" -H "Content-Type: application/json" -d '{
      "host": "little-cubby.com",
      "key": "960a9783b1c530262ca0538b140439a8",
      "keyLocation": "https://little-cubby.com/960a9783b1c530262ca0538b140439a8.txt",
      "urlList": ["https://little-cubby.com/articles/<slug>/"]
    }'
    ```
    A `200`/`202` means accepted. `urlList` can hold up to 10,000 URLs (submit the whole sitemap after a big batch).
  - **Zero-maintenance alternative (owner, ~2 min):** Cloudflare dashboard → the zone → Caching → Configuration → enable **Crawler Hints (IndexNow)**. Cloudflare then generates/hosts its own key and auto-submits changed URLs on every deploy, so the manual `curl` above is no longer needed. If you enable this, the manual key file can stay (harmless) or be removed.
