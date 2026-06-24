# Cubby — 90-day SEO roadmap

> **Baseline (verified 2026-06-22, current HEAD).** little-cubby.com: **415 sitemap URLs**, **~402 articles**, 4 vaccine-schedule pages (uk/us/uae + de/impfkalender), 5 crawlable topic hubs (sleep/feeding/health/pregnancy/baby), 4-level breadcrumbs, ~100% JSON-LD coverage, fresh technical hygiene (per-URL `<lastmod>` on 414/415, schema dedup, hreflang reciprocity, IndexNow key hosted). On-page is **near-maxed**. Domain authority / referring domains sit **near zero** — that is the real ceiling.
>
> Built from a multi-agent research pass (competitor gaps, real backlink targets, cluster structure, privacy-safe measurement). Operationalizes `SEO.md` + `SEO-BACKLINKS.md`; does not duplicate them.

## The thesis: NOT more articles
With ~402 articles already live and the content queue spent, the marginal new article has low ROI and risks the Helpful-Content "thin volume" trap. The next 90 days are **authority + structure + conversion**, in that order of leverage:
1. **Authority** — earn the first 6-12 referring domains (the bottleneck; human + time-bound).
2. **Structure** — money-page pillars + a few high-intent templated pages that don't exist yet.
3. **Conversion** — every article routes to `/app/` or `/features/`, measured first-party.

## The honest agent-vs-human split (your actual question)
An agent compresses the **building**, never the **results**.

**An agent can ship in hours (do-now):**
- 3 conversion pillars: `/private-baby-tracker/`, `/care-circle/`, `/pregnancy-to-baby/` (none exist today)
- +6-7 vaccine-country pages (au/in/ca/ie/nz/sg/sa) — schedule data already in `app/index.html` `VAX_SCHEDULES`
- +6-8 `cubby-vs-X` comparison pages (only 5 exist), honest privacy-led tables
- `/tools/` calculators + `/glossary/`, a branded `404.html`, self-hosted fonts (LCP + closes the last third-party request)
- Draft **all** outreach emails, build the real target lists, write the linkable assets, write the GSC/Bing runbook

**Only a human / Google can do (takes the 90 days):**
- Verify Google Search Console + Bing Webmaster (needs your Google account + Cloudflare DNS) — the hard gate on all measurement
- Toggle Cloudflare Crawler Hints ON (activates the hosted IndexNow key)
- **Earn the links** — send the drafted emails as the founder, work HARO/Featured/Qwoted, pitch editors. Editorial replies run on human timelines.
- Wait out Google's crawl → index → rank → trust cycle. Weeks 1-4 look flat; that is normal, not failure.

> **Already done by other sessions (do NOT redo):** 5 topic hubs, 4-level breadcrumbs, related-articles rewrite across 393 pages, and the technical hygiene batch (lastmod / schema dedup / hero images / hreflang / IndexNow key).

## North star (90 days)
Move from near-zero authority to a **structured, conversion-ready site with its first 6-12 earned referring domains and a measurable GSC/Bing baseline**, so the 415+ indexed URLs start ranking for high-intent privacy, vaccine, comparison and care-circle queries.

## Hard constraints
- **GA4 is forbidden.** It is a Google third-party script and would break the no-third-party-tracker promise that *is* the privacy wedge. Measure via **GSC + Bing Webmaster** (off-site webmaster tools, allowed) + the existing **first-party** `utm → localStorage cubby-acq → Firestore` stack (`tools/analytics.js`).
- YMYL: every vaccine/health claim cites its official body (NHS/CDC/WHO/MOHAP/STIKO/national NIPs). No fabrication.
- Outreach is honest: always disclose "maker of Cubby." No fake reviews, no link swaps, no spam.
- No em-dashes in user-facing copy. Run the Anxiety Test on every new surface.

---

## Month 1 — Structure + measurement backbone
*Theme: light up GSC/Bing, ship the money pillars and vaccine-country pages, fix the last perf/privacy leak.*

**Week 1**
- 👤 **founder** — Verify little-cubby.com in **Google Search Console** via DNS TXT at Cloudflare; add **Bing Webmaster** (import from GSC); submit `sitemap.xml` in both; request indexing on the 10 highest-value URLs (home, 3 vaccine pages, de/impfkalender, vaccine-comparison, best-baby-tracker-app, top hubs).
- 👤 **founder** — Toggle **Cloudflare → Caching → Crawler Hints (IndexNow)** ON so the hosted key actually pings.
- 🤖 **agent** — Write the GSC/Bing verification runbook (exact DNS record, priority URLs, IndexNow ping command) so the founder acts in minutes.

**Week 2**
- 🤖 **agent** — Ship 7 vaccine-country pages (au/in/ca/ie/nz/sg/sa) from `VAX_SCHEDULES`: `MedicalWebPage` + `FAQPage`, birthday calculator, official-body citations; show the track-in-Cubby CTA only for app-supported countries; extend hreflang; add to sitemap (`gen_sitemap.py` stamps lastmod).
- 🤖 **agent** — Self-host fonts on the public site (drop `fonts.googleapis.com`/`gstatic` from root, features and the article template; serve Fraunces + Nunito Sans same-origin, `font-display:swap`; update the article generators). Verify a real mobile-width render before shipping.

**Week 3**
- 🤖 **agent** — Build `/private-baby-tracker/` pillar (claiming only what is actually rules-enforced per the privacy-enforcement note), linking down to comparison pages and across to `/features/`, `/pricing/`, `/app/`.
- 🤖 **agent** — Ship a branded on-charter `404.html`; fix the one missing sitemap lastmod (`/editorial/`); add long-cache immutable `_headers` for `/fonts/`, `/og/`, `/icons/`, hero images.
- 👤 **founder** — Run PageSpeed (mobile) on the top 10 ranking-target pages + read Cloudflare Web Vitals; paste LCP/INP/CLS back for concrete fixes.

**Week 4**
- 🤖 **agent** — Sharpen the vaccine-comparison page into the lead **linkable asset**: dated "what changed in 2026" callout (the UK MMRV/varicella switch), expand to all in-repo schedules, add an embeddable comparison table.
- 🤖 **agent** — Document the privacy-safe KPI dashboard + install-attribution loop in `SEO.md` / `ANALYTICS.md`; add a per-`utm_campaign` signup tally to `analytics.js`; standardize the utm taxonomy.
- 👤 **founder** — First weekly GSC read: indexed-vs-discovered trend, which pages are crawled, any "discovered, not indexed" warnings.

**Exit:** GSC + Bing verified and reading data; 7 new vaccine-country pages live; privacy pillar live; fonts self-hosted (LCP + privacy fixed); 404 + IndexNow live. The clock has started and indexation is observable.

---

## Month 2 — Conversion surfaces + linkable assets + start outreach
*Theme: build the remaining money surfaces, create things worth citing, fire the first outreach wave.*

**Week 5**
- 🤖 **agent** — Build `/care-circle/` and `/pregnancy-to-baby/` pillars; wire the full cluster → pillar → `/features/` + `/app/` link graph (preserve `?c=country` capture). Verify nav renders at mobile width.

**Week 6**
- 🤖 **agent** — Build ~6 new `cubby-vs-X` pages (validate each rival's *current* pricing/policy first — truthful-copy rule; pick real, active competitors), privacy-led, `BreadcrumbList` on all, linking to `/private-baby-tracker/`. Generate per-slug OG + hero images so there are no broken refs.
- 🤖 **agent** — Write a sourced children's-data-privacy parent guide (FTC/EDPB/ICO; `Article` + `FAQPage`), linked from the privacy pillar — the second linkable asset.

**Week 7**
- 🤖 **agent** — Build the Tier-1 target list (best-baby-tracker / alternative listicles) and draft 8-12 personalised pitches + a paste-ready honest blurb.
- 👤 **founder** — Send the first 10-12 listicle pitches from the founder address, disclosing maker of Cubby; log replies.
- 🧑‍💻 **va** — Register Featured.com + Qwoted + SourceBottle; monitor daily.

**Week 8**
- 🤖 **agent** — Build the 40-60 row resource-page/.org target sheet (via the `SEO-BACKLINKS.md` search operators) + draft each personalised add-request (lead with the free resource, never the app); pre-write 6-8 reusable HARO answer snippets.
- 👤 **founder** — Submit AlternativeTo / BetaList, open the awesome-pwa PR, post to IndieHackers (under founder identity).

**Exit:** 3 pillars + ~11 comparison pages live and interlinked; two strong linkable assets exist; target lists + drafted emails ready; first outreach wave (~20 contacts) sent. First impressions appearing in GSC for long-tail queries.

---

## Month 3 — Authority push + iterate on real GSC data
*Theme: sustained outreach cadence, build the last link magnets, refresh striking-distance winners.*

**Week 9**
- 🧑‍💻 **va** — Send resource-page add-requests (~10/week) + directory submissions; log placements.
- 👤 **founder** — Pitch the vaccine-comparison + privacy guide to parenting/expat/health editors riding the 2026 news wave; answer 3-5 HARO/Featured/Qwoted queries/week citing the sourced assets.

**Week 10**
- 🤖 **agent** — Build `/tools/` calculators (due-date, vaccine-due-date reusing `vax.js` + `VAX_SCHEDULES`, feed/nap) with `WebApplication`/`HowTo` schema + UTM'd soft CTAs; add to sitemap.
- 👤 **founder** — Seed community shares (Mumsnet, ExpatWoman for the UAE page, BabyChakra for India, on-topic Reddit threads), disclosed, one link per on-topic thread.

**Week 11**
- 🤖 **agent** — Build `/glossary/` from terms already defined across the corpus (colostrum, centile, cluster feeding, fourth trimester, latch) with `DefinedTerm` schema + `#term` anchors into articles.
- 🤖 **agent** — Refresh the striking-distance set: pull GSC position 11-20 queries, update matching articles + `best-baby-tracker-app` with a 2026 comparison table, request re-indexing.
- 🧑‍💻 **va** — Continue outreach; follow up non-responders once.

**Week 12**
- 🤖 **agent** — Add context-matched UTM'd end-of-article CTAs (vaccine articles → "never miss a dose"; sleep → "spot the pattern with your partner"). Run the Anxiety Test.
- 🤖 **agent** — Tighten CSP (font-src/style-src/script-src/connect-src allowlists) now fonts are self-hosted; verify the app still loads against Firebase origins.
- 👤 **founder** — 90-day review against the KPI dashboard; decide month 4-8 priorities.

**Exit:** Outreach is a sustained weekly cadence; first 6-12 referring domains landing; content refresh driven by GSC data, not guesswork. Foundation complete; momentum compounding into months 4-8.

---

## KPIs (privacy-safe only — never GA4)
| Metric | 90-day target | Measured via |
|---|---|---|
| **Indexation** — valid-indexed URLs | ~380+ of ~440 indexed | GSC Coverage |
| **Visibility** — impressions + striking-distance queries | first sustained impressions; 20+ queries reaching positions 11-20 | GSC Performance → Queries |
| **Authority** — new referring domains (the bottleneck) | 6-12 of ~40-60 contacted, several dofollow | GSC Links + Bing Webmaster |
| **Conversion** — organic-attributed sign-ups by slug | first measurable organic signups; vaccine/comparison/privacy slugs identifiable | first-party `utm → cubby-acq → Firestore` (`analytics.js`) |
| **Performance** — CWV on top 10 pages post-font-fix | LCP/INP/CLS green on mobile | PageSpeed Insights + Cloudflare Web Vitals (cookieless RUM) |
| **UAE slice** (home market) | UAE vaccine page indexed + surfacing | Bing Webmaster |

## Risks
- **Authority is the true ceiling and it is human-paced.** The agent drafts every email and list, but earned links depend on editorial replies; expect only 6-12 of ~40-60 contacts to convert in 90 days. Weeks 1-4 look flat.
- **Founder-only unlocks are hard gates.** Nothing is measurable until GSC/Bing are DNS-verified; IndexNow stays dormant until Crawler Hints is toggled.
- **Solo-founder bandwidth.** Outreach + HARO is the highest-leverage but most time-hungry work; without a VA it stalls.
- **YMYL + truthful-copy accuracy** on new vaccine-country and comparison pages: every dose cites its official body; every competitor claim matches the rival's *current* policy.
- **Google latency can't be compressed.** 415+ URLs on a near-zero-authority domain may take 4-8 months to rank meaningfully. The 90-day result is foundation + first traction, not traffic at scale.
- **Concurrency.** Multiple agents push `main`; the page-build tasks above should be sequenced to avoid colliding with other in-flight work.
- **Font/CSP changes touch the shared header + the app's Firebase connect-src.** Ship behind a mobile-width render check and confirm the app still loads.

## Realistic 90-day outcome
90 days buys a **complete, conversion-ready foundation and the first signs of traction — not traffic at scale.** By day 90: the agent has shipped essentially all the structural/on-site work (3 money pillars, 7 vaccine-country pages, ~11 comparisons, tools, glossary, self-hosted fonts, tightened CSP, 404, full schema); GSC/Bing show a healthy indexed count and the first impressions on long-tail privacy/vaccine/comparison queries; and the outreach engine has earned its **first 6-12 referring domains**. Most rankings will sit in striking distance (positions 11-20), because near-zero authority + Google's trust cycle is the gating reality. **The compounding starts here; the visible traffic arrives in months 4-8** as links accrue against the now fully-interlinked structure.
