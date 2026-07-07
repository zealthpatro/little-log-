# Cubby web SEO audit — 2026-07-07

Method: 17-agent workflow (8 dimension auditors against live prod + repo, adversarial
verification of every finding, ranked synthesis). 48 findings survived verification.
False positives (e.g. wrong `/vaccine-schedule/` path) were refuted and dropped.

## State of play

On-page foundations are genuinely strong: self-referential HTTPS canonicals on every
page type, clean hard-404 status codes (no soft-200s), sound per-article `lastmod`,
robots permits all AI crawlers, and **zero third-party trackers and zero fake-review
schema** (a real, compliant differentiator). But three classes of defect bleed value:

1. **Code-owned integrity bugs that ship wrong today** — 61 broken internal links, ~325
   articles (74%) with 404 og:images, 2 articles canonicalizing to a dead domain.
2. **Near-total off-site / AI-answer-engine absence** — worsened by a severe "Cubby"
   entity collision (Cubtale, The Baby Cubby, a daycare SaaS all outrank it); no sameAs,
   no Wikidata, no roundup presence.
3. **A YMYL trust cap** — no named human author or clinical reviewer, an unfilled
   "[Legal entity to be confirmed]" on the live privacy page, no About/Contact page.

Plus: the entire tool/calculator acquisition surface every competitor funnels through is
un-built, despite being specced in the repo's own roadmap.

## Scorecard

| Area | Grade | Note |
|---|---|---|
| Crawlability & indexation | ok | Canonicals correct, hard-404 clean, AI crawlers allowed. But http:// serves 200 (no forced HTTPS 301), IndexNow live-but-dormant, 404 body is 0 bytes. |
| Structured data / schema | weak | Two conflicting SoftwareApplication nodes, no `@id`; bare Organization (no sameAs/founder/contactPoint); no featureList; inconsistent BlogPosting templates. |
| On-page meta | weak | ~325 articles → 404 og:images; 2 dead-domain canonicals; country variants ship identical titles/H1; 107 over-long titles, 202 over-long descriptions. |
| Internal linking | weak | 61 broken related-links across 23 articles; 7 vaccine pages stranded at depth 3; no vaccine/editorial link in nav/footer. |
| Hreflang / i18n | weak | Vaccine hreflang split into 2 disjoint non-reciprocal clusters; sitemap xhtml:link covers only 4 of 11. |
| Content gaps (tools/comparisons) | missing | Zero calculator/tool pages; kick-counter prose-only; 5 of 8 cubby-vs competitors (incl. Flo, BabyCenter) missing; no glossary hub. |
| E-E-A-T / YMYL trust | weak | No named author/reviewer on 295 medical articles; "[Legal entity to be confirmed]" live; no About/Contact; ~40 articles cite sources with no clickable link. |
| AI-answer-engine / off-site | missing | Absent from every "best baby tracker 2026" roundup; entity collision; no sameAs/Wikidata/llms.txt. Privacy wedge credited to competitors. |
| No-tracker / anti-fake-review | strong | Fully compliant. Genuine differentiator. |

## Ranked gaps

### Code-owned (an agent can ship now)
1. **P0 — IL-01: 61 broken internal links** across 23 YMYL articles into 404s. Remap to live
   slugs (breastfeeding-basics→breastfeeding-latch-and-positioning, newborn-sleep-guide→
   newborn-sleep-what-is-normal, colic-remedies→colic-what-it-is-and-what-helps,
   vaccines→catching-up-on-missed-vaccines), fix malformed `/articles/vaccination-schedule/uk/`,
   add a build-time href-vs-slug grep.
2. **P1 — META-01: ~325 articles → 404 og:images (74%).** Stopgap: repoint to existing
   `og/articles.png` (200) so no share card breaks; then batch-regenerate the 1200×630 PNGs.
3. **P1 — META-02: 2 dead-domain canonicals** (japanese-infant-formula,
   ikuji-kyugyou-paternity-leave point at `www.littlecubby.app`, NXDOMAIN). Risk: de-indexing.
4. **P1 — IL-03/IL-02: vaccine cluster has no sitewide link**; 7 pages at depth 3. Add a
   footer "Vaccine schedules" link + link all 11 from the /articles/ hub.
5. **P1 — HRF-1/HRF-2: vaccine hreflang split + sitemap covers 4 of 11.** Emit one identical
   12-alternate block in every vaccine head + de/impfkalender; make sitemap match.
6. **P0 — CG-1: build /tools/ hub + calculators** (due-date, ovulation, week-by-week, feeding,
   sleep, vaccine-due reusing vax.js). WebApplication + HowTo schema, first-party UTM CTAs.
7. **P1 — SCHEMA-01/03: unify the two SoftwareApplication nodes** under a shared `@id`, one
   name, Pro as an Offer; add featureList + screenshot.
8. **P1 — CG-3: write missing cubby-vs pages** (Flo, BabyCenter, Ovia, What-to-Expect,
   Baby Tracker) leading with the privacy wedge; mesh the comparison cluster.
9. **P1 — CG-2: interactive /tools/kick-counter/** (loss-safe, charter-aligned).
10. **P2 batch** — META-03 (differentiate country-variant titles), META-05/06/07 (trim long
    titles/descriptions, strip em-dashes), EEAT-04/05 (make source citations clickable deep
    links), CI-3 (branded 404.html), GEO-05 (/llms.txt), META-04/IL-05 (hub og:images +
    /editorial/ footer link), SCHEMA-04 (ItemList on comparison pages).

### Founder-gated (needs a human)
- **CI-1: Cloudflare → Caching → Crawler Hints (IndexNow) ON** (~2 min). Wakes the hosted key.
- **CI-2: Cloudflare → SSL/TLS → Always Use HTTPS ON** (~1 toggle). 301s all http.
- **EEAT-02: confirm the legal entity + jurisdiction** so the privacy placeholder and the
  un-deployed /terms/ can be filled; then create /about/ + /contact/.
- **EEAT-01: recruit + name a real credentialed clinical reviewer.** Hard cap on how far the
  medical library can rank / be cited. Never fabricate a name.
- **SCHEMA-02/GEO-03: supply real founder name + owned profile URLs** for sameAs/founder.
- **GEO-02: fight the entity collision** — co-brand always as "Cubby, the baby & pregnancy
  app / little-cubby.com" (never bare "Cubby"); register consistent handles.
- **GEO-04: create a Wikidata item** (instance of: mobile app; official website).
- **GEO-01: earned placement** — Product Hunt, AlternativeTo/Capterra, privacy-tracker roundups.
- **EEAT-07: spot-check the AU/CA vaccine citations** resolve 200 in a real browser.

Full 48-finding detail with per-finding evidence: workflow run `wh2bmbp0w`.
