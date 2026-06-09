# Cubby — handoff / resume notes

Quick orientation for picking this project back up (read `README.md` for the full picture).
Last refreshed: 2026-06-09.

## What this is
**Cubby** 🐻 — a shared baby-tracker PWA, **live and in real use** by the owner + family,
plus a public **marketing + SEO site** in front of it.
Don't break production. Make a change → verify → push (auto-deploys).

- Live: https://little-cubby.com (custom domain) · https://cubby.saurav-918.workers.dev (fallback)
- Repo: https://github.com/zealthpatro/little-log- (branch `main`)
- Backend: Firebase `little-log-a9caa` (Google auth + Firestore, free Spark plan)
- Hosting: Cloudflare Workers static assets, auto-deploys on push to `main`

## The 30-second model (two halves)
**1. The marketing/SEO site lives at the root `/`** (static, indexable, no service worker):
- `index.html` = marketing **home** (5-tab nav, hero carousel, proof, testimonials, pricing).
- `features/`, `pricing/`, `faq/`, `articles/` = the other marketing tabs.
- `vaccination-schedule/{uk,us,uae}/` + `de/impfkalender/` = programmatic SEO vaccine pages.
- `articles/<slug>/` = the sourced content library (see content engine below).
- Shared styles: `/site.css` (marketing) + `/vax.css` (articles/vaccine pages). `sitemap.xml`,
  `robots.txt`, `og/*.png` round out SEO.

**2. The app lives at `/app/`** (the PWA, behind Google sign-in, service-worker cached):
- `app/index.html` = the whole app (vanilla JS, single global `state`, `render()` re-renders all).
- `app/store-firebase.js` = auth + cloud sync (overrides `persist()`/`PhotoStore`; real-time
  listeners; family/sharing UI). App code never calls Firestore directly.
- `app/cubby-extras.js` = bear avatars + custom time/date pickers + the unified "When" time strip.
- `app/landing.js` = signed-out landing inside the app + Pro/paywall copy.
- `app/growth-data.js` = WHO/CDC percentile tables.
- `app/pregnancy-data.js` = `window.PREG` week-by-week + antenatal schedule data (Phase 1 data only;
  in-app UI not built yet — see `PREGNANCY.md`).
- `app/sw.js` = service worker (`CACHE = little-log-vNN`, currently **v47**; bump on app asset change).
- Data lives in `households/{hid}` (see README §3). Events are a subcollection; rest is the `app` blob.

> Migration note: the app used to be at root. Root `/sw.js` is now a self-unregister stub and root
> `index.html` redirects installed/standalone clients to `/app/`, so existing testers move over cleanly.

## Dev loop
```bash
node tools/serve.js                 # static server on http://localhost:8080 (python http.server
                                    # broke in the sandbox; this replaces it). Google sign-in
                                    # works on localhost.
# edit files...
node --check app/store-firebase.js app/cubby-extras.js app/growth-data.js app/pregnancy-data.js
# verify in browser; then, IF you changed app assets:
#   bump CACHE in app/sw.js (little-log-vN)
git add -A && git commit -m "..." && git push     # Cloudflare auto-deploys in ~1 min
```
- Marketing/article pages are **not** SW-cached → go live ~1 min after push, no cache bump needed.
- App assets **are** SW-cached → bump `app/sw.js` `CACHE` or clients keep stale files.
- Verify a deploy: `curl -s "https://little-cubby.com/<path>?cb=$RANDOM" | grep <marker>`.

## Content engine (sourced articles)
Articles are produced by a **dedicated Sonnet writer agent**, not the main build thread.
- `CONTENT-RUNBOOK.md` = the full publish pipeline (research → write → self-review gate → wire hub
  card + sitemap → validate → commit/push → verify live). Point a `/schedule` or `/loop` at it.
- `CONTENT-QUEUE.md` = prioritized `[ ]`/`[x]` backlog; agent takes the top `[ ]` each run.
- `CONTENT.md` = the rules + theme/age matrix.
- YMYL safety is mandatory: no fabrication, no copying, deep-link + verify-200 official sources
  (NHS/CDC/WHO/AAP), dated disclaimer, no diagnosis, no em-dashes. Unsourceable → `articles-drafts/`.

## Gotchas
- Editing JS strings: watch for accidental literal newlines inside `'...'` (broke a build once).
- Bump `app/sw.js` `CACHE` or app clients keep old assets (marketing pages don't need it).
- New live domain → add it to Firebase Authorized domains or Google sign-in fails.
- Firestore rules live in `firestore.rules` **and** must be published in the Firebase console
  (the console copy is the source of truth at runtime).
- `tools/serviceAccountKey.json` (for `tools/analytics.js`) is **gitignored and never deployed** —
  never commit it. `.assetsignore` keeps `tools/`, docs, drafts and node_modules out of the deploy.
- No em-dashes anywhere in user-facing copy; no GA4/third-party trackers (keep the privacy promise).

## Decisions on record
- Free tiers only: in-app notifications (no Blaze/card); photos as base64 in Firestore (no Storage);
  no Cloud Functions; analytics via Firestore export + Cloudflare RUM (no GA4).
- Growth: WHO default; CDC toggle; IAP n/a for under-5.
- One shared household; Google sign-in.
- Pricing: Pro from ~$15/mo effective (annual), $19/mo monthly, localized (USD/GBP/EUR/AED/INR).
- Generative-AI photo editing deferred to post-beta (on-device only for now) — see `AI-EDITING.md`.
- No fabricated testimonials/reviews/user counts; visuals are original illustrations + initial avatars
  (no copyrighted stock photos).

## Next planned (see the docs for detail)
- **Pregnancy module UI** Phases 2-5 (data exists in `app/pregnancy-data.js`) — `PREGNANCY.md`.
- **Pro paywall / Stripe** design — `PAYWALL.md`, `PRO.md` (design-only until beta closes).
- **Content cadence**: run the queue 2-3×/week via the runbook agent — `CONTENT-RUNBOOK.md`.
- **Send-email flow** for invites (server-sent) — `EMAIL.md`.
- **Post-beta on-VM image AI** (Qwen/Seedream) — `AI-EDITING.md`.

## Doc index
`README.md` (full) · `HANDOFF.md` (this) · `CHANGELOG.md` · `SEO.md` · `CONTENT.md` /
`CONTENT-RUNBOOK.md` / `CONTENT-QUEUE.md` · `PRO.md` / `PAYWALL.md` · `PREGNANCY.md` /
`PREGNANCY-HANDOFF.md` (build it) · `ROUTINES.md` · `ONBOARDING.md` · `EMAIL.md` ·
`ANALYTICS.md` · `AI-EDITING.md`
