# Cubby SEO & CRO

What is live, how it works, and how to keep the vaccine pages accurate. Pair this with the strategy doc the founder pasted (markets: UK / UAE / US / Germany; primary conversion = sign-up).

## What ships today

### Foundation (free, on the existing Cloudflare static-assets setup, no SSR)
- **`index.html` `<head>`**: meta description, canonical, Open Graph + Twitter cards, and JSON-LD (`SoftwareApplication`, `Organization`, `FAQPage`). Shared links now unfurl with a real preview.
- **Crawlable landing**: static HTML inside `#app` (the `#seo-fallback` block). The app's first `render()` replaces it for real users; no-JS crawlers and link unfurlers read it. Keep it roughly in sync with `landing.js`.
- **`og/cubby-home.png`** (1200x630): branded share image, generated with PIL (see the script history; uses macOS Georgia + Arial). Re-run if branding changes.
- **`robots.txt`** + **`sitemap.xml`** (home + the four vaccine routes). Submit the sitemap in Google Search Console and Bing Webmaster once the custom domain is live.

### The wedge: vaccine-schedule pages (programmatic SEO)
Pre-rendered static HTML, fully crawlable, one folder per market:

| URL | Lang | Source of truth |
|---|---|---|
| `/vaccination-schedule/uk/` | en-GB | GOV.UK / UKHSA complete routine immunisation schedule (from 1 Jan 2026) |
| `/vaccination-schedule/us/` | en-US | CDC child immunization schedule (easy-read) |
| `/vaccination-schedule/uae/` | en-AE | UAE MOHAP National Immunization Program + Emirates Health Services |
| `/de/impfkalender/` | de-DE | RKI / STIKO Impfkalender 2026 (Epi. Bulletin 4/2026) |

Each page has: per-page meta + OG + hreflang (cross-linked cluster), `MedicalWebPage` + `FAQPage` JSON-LD, a static age-by-age table, a "what changed" block where relevant, a "Track this in Cubby" CTA, an FAQ, and a sources/disclaimer footer.

- **Shared assets**: `vax.css` (styling) and `vax.js` (the birthday calculator).
- **Birthday calculator**: progressive enhancement only. The table is fully rendered in static HTML (so it is crawlable); `vax.js` fills the "Your date" column when a parent picks a birthday. Rows carry `data-weeks` or `data-months`; dates = birth + that offset. Localised via the page `lang`.

## E-E-A-T / YMYL rules (do not skip)
Vaccine content is "Your Money or Your Life" to Google and a trust/liability matter for a baby-health app.
- Every page cites its **official source** with links, shows a **"Last reviewed" date**, and carries a **"informational only, follow your provider"** disclaimer.
- We do **not** invent a medical-reviewer name. Current positioning is "summarised from the official source." If a real clinician agrees to be named, add a byline (e.g. "Reviewed by [Name], [credentials]") and update `reviewedBy` in the page's `MedicalWebPage` JSON-LD.

## Maintenance cadence
Schedules change. Check the official sources and update the table, the "last reviewed" date (visible text **and** `lastReviewed` in JSON-LD), and the "what changed" block.
- **UK**: UKHSA announces changes (the Jan 2026 update added MMRV + an 18-month visit). Check each January.
- **Germany (STIKO)**: updates yearly, published in the Epidemiologisches Bulletin (usually January). Check each January.
- **US (CDC/ACIP)**: schedule reviewed roughly annually. Note COVID-19/RSV guidance shifts; we keep those in a note, not the dated table.
- **UAE (MOHAP)**: less predictable; re-check ~twice a year. The schedule varies by emirate, so the page says "confirm with your clinic."

When a country page changes, also bump the in-app `DEFAULT_VACCINES` in `index.html` if the change affects the default (currently CDC/ACIP-based and editable).

## Constraints kept
- No new infra, no paid tier. All static files on Cloudflare Workers static assets.
- **No third-party analytics** (e.g. GA4). The landing claims "no third-party trackers / never sell your data"; adding GA would break that. Use Cloudflare's first-party RUM only.
- No em-dashes in user-facing copy.

## Not built yet (from the strategy doc)
- Apple sign-in; demo-with-sample-data before the auth wall; first-party funnel events.
- Onboarding birthdate + country gate that seeds a localized in-app schedule (closes the loop with these pages).
- Expansion to more EU markets; the solids/milestones content cluster.
- A proper named medical reviewer.
