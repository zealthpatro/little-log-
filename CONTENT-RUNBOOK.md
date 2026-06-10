# Cubby content runbook (for a scheduled agent or /loop)

Full, self-contained workflow to research, write, self-review and **publish two sourced baby-care articles per run**. YMYL (health) content: accuracy and sourcing are mandatory, fabrication is forbidden.

Point a schedule or loop at the **Master prompt** in `CONTENT-QUEUE.md`. Everything the agent needs is here.

---

## Environment

- Repo: this working directory. Branch: **main**.
- **Push to `main` auto-deploys** to Cloudflare. Live site: **https://little-cubby.com**.
- Marketing/article pages are NOT service-worker cached — go live ~1 min after push, no cache bump.
- Shared styles: `/vax.css` + `/site.css`. Copy template from any `articles/<slug>/index.html`.
- Drafts not ready to publish: `articles-drafts/<slug>/index.html` (git-tracked, never deployed).
- Image generator: `python3 tools/gen_article_img.py --slug <slug> --title "<title>" --age "<age>" --theme "<theme>" --out .`
  - Outputs: `og/articles/<slug>.png` (1200x630 OG) and `articles/<slug>/hero.png` (1200x480 hero).

---

## Hard rules (do not break)

1. **No fabrication.** Every health/timing/safety claim must be sourced from an official source fetched this run: NHS (`nhs.uk/baby`), CDC (`cdc.gov`), WHO, AAP HealthyChildren, womenshealth.gov, or national authority.
2. **No copying.** Original wording only. Never reproduce third-party blog text.
3. **Cite with deep links** in a "Trusted sources" list (`rel="nofollow noopener" target="_blank"`). Verify each URL is HTTP 200 before citing. Find the live page if a URL has moved; never cite a 404.
4. **Disclaimer on every article**: "Reviewed <today's date> · informational only and not medical advice, follow your doctor, midwife or health visitor."
5. **No diagnosis/treatment instructions** beyond what the source says. Prefer "seek care if...".
6. **No em-dashes** in copy (use commas or colons instead).
7. If a claim cannot be sourced, remove it. If a whole topic cannot be safely sourced, save to `articles-drafts/` and stop; do not publish.

---

## Steps per article (run twice per session: Article 1, then Article 2)

### Step 0 — Keyword research (new)
Before writing, identify 8-10 keywords parents actually search for on this topic. Think:
- Primary keyword (exact query, e.g. "when do babies start teething"): goes in `<title>`, first 100 words of body, and one H2.
- Secondary keywords (e.g. "teething signs", "soothe teething baby"): woven into H2/H3 headings and body naturally.
- Long-tail FAQ keywords (e.g. "does teething cause fever"): become FAQ question headings — these capture featured snippets.
Write down your keyword list before writing. Use them purposefully; do not keyword-stuff.

### Step 1 — Pick the topic
Open `CONTENT-QUEUE.md`, take the first item marked `[ ]`. Note slug, age bracket(s), theme, listed sources.

### Step 2 — Research
WebFetch each listed source and any official page you find. Extract only what they actually say. Confirm each URL is 200 before citing.

### Step 3 — Write `articles/<slug>/index.html`

**`<head>` section — copy exactly:**
```html
<title><Primary keyword phrase / Title> | Cubby</title>
<meta name="description" content="<150-char description with primary keyword>">
<link rel="canonical" href="https://little-cubby.com/articles/<slug>/">
<meta name="robots" content="index,follow">
<meta property="og:type" content="article"><meta property="og:site_name" content="Cubby">
<meta property="og:title" content="<Title>">
<meta property="og:description" content="<description>">
<meta property="og:url" content="https://little-cubby.com/articles/<slug>/">
<meta property="og:image" content="https://little-cubby.com/og/articles/<slug>.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://little-cubby.com/og/articles/<slug>.png">
<meta name="keywords" content="<8-10 comma-separated keywords from Step 0>">
```

**Two JSON-LD blocks:**

Block 1 — BlogPosting:
```json
{"@context":"https://schema.org","@type":"BlogPosting","headline":"<Title>","description":"<desc>","datePublished":"<YYYY-MM-DD>","dateModified":"<YYYY-MM-DD>","inLanguage":"en","keywords":[<array of keyword strings>],"author":{"@type":"Organization","name":"Cubby"},"publisher":{"@type":"Organization","name":"Cubby","url":"https://little-cubby.com/","logo":{"@type":"ImageObject","url":"https://little-cubby.com/icons/logo-512.png"}},"mainEntityOfPage":"https://little-cubby.com/articles/<slug>/","image":{"@type":"ImageObject","url":"https://little-cubby.com/og/articles/<slug>.png","width":1200,"height":630}}
```

Block 2 — FAQPage (use the actual FAQ Q&A pairs from the article body):
```json
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"<Q>","acceptedAnswer":{"@type":"Answer","text":"<A>"}},…]}
```

**`<body>` structure:**
- Standard `<nav>` (Articles tab active).
- `<main class="wrap article">`:
  - `<h1>` — contains the primary keyword.
  - `<p class="art-meta">` — age · theme · Reviewed <date> · All articles link.
  - **Hero image** (immediately after art-meta):
    `<img src="/articles/<slug>/hero.png" alt="<title>" width="1200" height="480" style="width:100%;height:auto;border-radius:12px;margin:1rem 0 1.5rem;" loading="eager">`
  - **Intro paragraph** — contains the primary keyword naturally within the first 100 words.
  - **3-6 content sections** — H2s phrased as search queries where natural (e.g. "How much sleep does a newborn need?"). Each section backed by a fetched source.
  - **Data table** where useful (sleep totals by age, teething timeline, etc.).
  - **Internal links** — at least 2 links to existing articles in the body (not just nav). Pick the most topically related from the published list.
  - **FAQ section** — 5-6 questions using long-tail keyword phrases as headings. These must match the FAQPage JSON-LD above.
  - **CTA block**: `<div class="cta">…<a class="btn" href="/app/?utm_source=article&utm_medium=organic&utm_campaign=<slug>">Start free</a></div>`
  - **Trusted sources** `<ul>` — deep links with `rel="nofollow noopener" target="_blank"`.
  - `<footer class="src">` — disclaimer with reviewed date.
- Long-form: 1,500-2,500 words of genuinely useful, sourced content.

### Step 4 — Generate images
```bash
python3 tools/gen_article_img.py \
  --slug <slug> \
  --title "<Title>" \
  --age "<age bracket>" \
  --theme "<theme>" \
  --out .
```
Confirm the two output files exist: `og/articles/<slug>.png` and `articles/<slug>/hero.png`.

### Step 5 — Self-review gate
Verify all of the following before proceeding. Fix anything that fails:
- [ ] Every health/timing/safety claim maps to a fetched source.
- [ ] All cited source URLs return 200.
- [ ] Disclaimer and reviewed date present in footer.
- [ ] JSON-LD parses (run validation in Step 6).
- [ ] No em-dashes.
- [ ] Original wording — no text copied from sources.
- [ ] Primary keyword in `<title>`, meta description, first 100 words, and at least one H2.
- [ ] `<meta name="keywords">` present with 8-10 terms.
- [ ] FAQPage JSON-LD matches the FAQ questions in the body.
- [ ] Hero image tag present and pointing to the generated file.
- [ ] OG image tag points to `og/articles/<slug>.png` (NOT `og/cubby-home.png`).
- [ ] CTA link contains `utm_source=article&utm_medium=organic&utm_campaign=<slug>`.
- [ ] At least 2 internal links to existing articles in the body.
- [ ] Canonical URL and slug are consistent.

### Step 6 — Validate
```bash
python3 -c "import re,json;[json.loads(x) for x in re.findall(r'<script type=\"application/ld\+json\">(.*?)</script>', open('articles/<slug>/index.html').read(), re.S)];print('LD OK')"
python3 -c "import xml.dom.minidom as m;m.parse('sitemap.xml');print('sitemap OK')"
```

### Step 7 — Publish wiring
1. Add hub card to `articles/index.html` under the matching age `<h2>` section:
   ```html
   <a class="art-card" href="/articles/<slug>/"><div class="k"><THEME> · <AGE></div><div class="t"><Short title></div><div class="d"><one-line summary></div></a>
   ```
   (Add a new `<h2>` section if the age bracket doesn't exist yet, in chronological order.)
2. Add to `sitemap.xml` before `</urlset>`:
   ```xml
   <url><loc>https://little-cubby.com/articles/<slug>/</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
   ```

### Step 8 — Mark done
In `CONTENT-QUEUE.md`: change `[ ]` to `[x]` and append ` (published <today>)`.

### Step 9 — Commit & push (after BOTH articles are done)
```bash
git add articles/<slug1>/ articles/<slug2>/ og/articles/ articles/index.html sitemap.xml CONTENT-QUEUE.md
git commit -m "Articles: <Title1> + <Title2> (sourced, <ages>/<themes>)"
git push origin main
```
One commit for both articles. Do not push after each article — batch them.

### Step 10 — Verify live (for each slug)
Wait ~60 seconds, then:
```bash
until curl -s -o /dev/null -w "%{http_code}" "https://little-cubby.com/articles/<slug>/" | grep -q "200"; do sleep 5; done && echo "LIVE" && curl -s "https://little-cubby.com/articles/<slug>/" | grep -o '<h1>[^<]*</h1>'
```
Both articles must return 200 and show their `<h1>`.

### Step 11 — Report
For each article: title, slug, live URL, keywords targeted, sources used, anything a human should double-check.

---

## Modes
- **Publish mode (default):** complete all steps, push live.
- **Draft mode:** if invoked with "DRAFT ONLY", write to `articles-drafts/<slug>/` instead of `articles/`, skip Steps 7-10, report only. Use when a topic cannot be fully sourced.

---

## Cadence
2 articles per run. Schedule 2 runs/day (9am and 3pm daily). The article engine should publish ~14 articles/week, draining the queue in ~6 weeks at current depth.
