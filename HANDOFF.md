# Cubby — handoff / resume notes

Quick orientation for picking this project back up (read `README.md` for the full picture).
Last refreshed: 2026-06-14.

## Current status (June 2026): what's live + how we go live

**Everything below is LIVE on https://little-cubby.com** (one repo, one branch `main`, Cloudflare
Workers Builds auto-deploys on every push to `main`). The pregnancy track is no longer a side branch —
it has been **merged into `main` and shipped**. `pregnancy-tracker` is now redundant (kept until retired).

### Accomplished this cycle
- **One Cubby, four lifecycle stages** — Trying → Expecting → Baby → Child. The old "Mommy To Be" name
  is **retired**; the household-OS "Den" is **parked** (`FEATURES.den=false`). See `ECOSYSTEM.md`.
- **Pregnancy tracker merged + live** — week-by-week, antenatal schedules (**170-country coverage**:
  verified UK/US/DE/UAE/CA/AU/NZ/IE, WHO-aligned fallback elsewhere + a custom plan), opt-in health
  trackers (GDM/BP/supplements/nausea), kick counter, contraction timer, birth plan, hospital bag,
  Moments album, the birth transition, and a compassionate pregnancy-loss flow.
- **Privacy Max 1.0 (gate G1) live** — maternal health is **off the circle-shared blob**, now in
  `households/{hid}/mhealth/{ownerUid}/cat/{category}`: mother-owned, **per-category consent**, mood
  owner-only and never shareable. Rules **published in the Firebase console** (the runtime source of
  truth). Containment verified; cross-account *sharing* path still wants an emulator test. See
  `PRIVACY-MAX-1.0.md`.
- **Expecting/Baby audience framework across the marketing site** — a pre-paint lifecycle-stage engine
  (URL `?stage=` > page `data-page-stage` > localStorage > default baby), two-tab Features, a Home
  "Expecting" section, an Articles strip, and a Pregnancy nav link. Arriving from `/pregnancy/` marks
  the visitor "expecting" everywhere.
- **~180 articles live** (baby + pregnancy clusters), searchable hub.
- **Magic-link email FIXED + verified** — own Cloudflare Worker endpoint `POST /api/send-signin-link`
  mints the Firebase sign-in link (service-account JWT → OAuth → Identity Toolkit `returnOobLink`) and
  sends a branded email via **Resend** from `mail.little-cubby.com`. Confirmed delivering to the **Gmail
  inbox** (Firebase's built-in sender was being silently dropped). Endpoint hardened (same-origin via
  Origin/Referer, normalized cooldown). Sign-in **deeplinks rebranded to `little-cubby.com`** (no more
  `little-log-a9caa.firebaseapp.com`). See `EMAIL.md`.
- **Vaccine catch-up (Phase 0.3)** — calm 5-state badges, no red "OVERDUE wall"; estimated catch-up
  dates tagged.
- **Pricing unified** — Cubby Pro **$9/mo or $90/yr** (save 17%, 7-day trial), gated to an Aug 2026 launch.
- **Lifecycle marketing close** — "the only app you'll ever need, from two lines to big kid" on the home
  page and reinforced in the sign-in email footer.

### How it goes live (mechanism)
`git push origin main` → **Cloudflare Workers Builds** rebuilds + deploys `little-cubby.com`. No wrangler
needed locally; secrets/vars live in the Cloudflare dashboard (Workers&Pages → `cubby` → Settings →
Variables and Secrets: `RESEND_API_KEY`, `FIREBASE_SERVICE_ACCOUNT` secrets; `MAIL_FROM` var). Firestore
rules must be **published in the Firebase console** to take effect.

### Remaining to fully harden / launch
- **Rate-limit rule** on `POST /api/send-signin-link` (Cloudflare → `little-cubby.com` zone → Security →
  WAF → Rate limiting; ~5–10/IP/min). The in-Worker cooldown is not the volume defense. **Pending.**
- **Pro billing go-live** — Worker is built (`workers/pro-billing/`); needs Stripe product/secrets/webhook
  + checkout URLs in the app; targeted Aug 2026. See `MONETIZATION-HANDOFF.md`.
- **Maternal-surface gates** — emulator cross-account denial test for the consent *sharing* path; a
  source-accuracy pass on the GDM/BP thresholds (no credentialed reviewer required, per founder ruling —
  cited summaries + passive logging; keep copy non-diagnostic).
- **Branch cleanup** — retire the fully-merged `pregnancy-tracker` branch.
- Apple Sign-In (deferred, $99/yr).

## What this is
**Cubby** 🐻 — a shared baby-tracker PWA, **live and in real use** by the owner + family,
plus a public **marketing + SEO site** in front of it.
Don't break production. Make a change → verify → push (auto-deploys).

- Live: https://little-cubby.com (custom domain) · https://cubby.saurav-918.workers.dev (fallback)
- Repo: https://github.com/zealthpatro/little-log- (branch `main`)
- Backend: Firebase `little-log-a9caa` (auth + Firestore, free Spark plan)
- Hosting: Cloudflare Workers static assets, auto-deploys on push to `main`

## The 30-second model (two halves)
**1. The marketing/SEO site lives at the root `/`** (static, indexable, no service worker):
- `index.html` = marketing **home** (5-tab nav, hero carousel, proof, testimonials, pricing).
  Returning members are detected via `localStorage.cubby-member` → CTAs swap "Start free" →
  "Open Cubby" + a welcome-back strip (no forced redirect).
- `features/`, `pricing/`, `faq/`, `articles/` = the other marketing tabs.
- `vaccination-schedule/{uk,us,uae}/` + `de/impfkalender/` = programmatic SEO vaccine pages.
- `articles/<slug>/` = the sourced content library — **180+ articles** live (baby + pregnancy), each with its own
  folder, per-page OG image (`og/articles/<slug>.png`), BlogPosting + BreadcrumbList JSON-LD.
  The hub at `articles/` has **live search + topic/age filters** (URL-hash persistence,
  scroll-on-mobile / wrap-on-desktop chips). See content engine below.
- Shared styles: `/site.css` (marketing) + `/vax.css` (articles/vaccine pages, also holds the
  shared design tokens). `sitemap.xml`, `robots.txt`, `og/*.png` round out SEO.
- JSON-LD coverage: SoftwareApplication+Organization (home), FAQPage (40+ Q&A), CollectionPage
  +SearchAction (hub), BlogPosting (articles), BreadcrumbList everywhere.

**2. The app lives at `/app/`** (the PWA, behind sign-in, service-worker cached):
- `app/index.html` = the whole app (vanilla JS, single global `state`, `render()` re-renders all).
  Also holds Pro feature gating (`isPro()`) and the `?ref=` referral capture.
- `app/store-firebase.js` = auth + cloud sync (overrides `persist()`/`PhotoStore`; real-time
  listeners; family/sharing + first-run UI). App code never calls Firestore directly.
- `app/firebase-init.js` = Firebase web config. `authDomain: "little-cubby.com"` — auth runs on
  our **own domain** (see same-domain auth below), not the Firebase domain.
- `app/cubby-extras.js` = bear avatars + custom time/date pickers + the unified "When" time strip.
- `app/landing.js` = signed-out landing inside the app + Pro/paywall copy.
- `app/growth-data.js` = WHO/CDC percentile tables.
- `app/pregnancy-data.js` = `window.PREG` week-by-week + antenatal schedule data (170-country
  coverage). The full pregnancy product is **merged into `main` and live** (one Cubby; the old
  "Mommy To Be" name is retired). History/spec: `PREGNANCY-HANDOFF-V2.md`.
- `app/sw.js` = service worker (`CACHE = little-log-vNN`, currently **v65**; bump on app asset change).
- Data lives in `households/{hid}` (see README §3). Events are a subcollection; rest is the `app` blob.
- Edge worker: root `worker.js` (`wrangler.toml` → `main = "worker.js"`) reverse-proxies `/__/*`
  to the Firebase auth backend so sign-in stays on `little-cubby.com`.

> Migration note: the app used to be at root. Root `/sw.js` is now a self-unregister stub and root
> `index.html` redirects installed/standalone clients to `/app/`, so existing testers move over cleanly.

## Auth, onboarding & referral
- **Sign-in (two paths):** Google OAuth (`signInGoogle()` → popup, redirect fallback) **and** email
  magic-link. The magic-link **send** goes through our **own Worker + Resend** (`POST /api/send-signin-link`
  in `worker.js`), not Firebase's built-in sender (which Gmail silently dropped); the client posts there
  and completes with `signInWithEmailLink`. Falls back to Firebase's sender if the endpoint is down.
  Sign-in links are rewritten onto `little-cubby.com`. Both paths in `app/store-firebase.js`.
- **Same-domain auth:** `worker.js` proxies `/__/*` to `little-log-a9caa.firebaseapp.com`, and
  `authDomain` is set to `little-cubby.com`, so the Google popup shows our domain, not Firebase's.
  A new live domain still needs adding to Firebase Authorized domains.
- **First-run onboarding:** `maybeFirstRun()` fires for members with no `setupDone`/`relationship`,
  opening a **locked, non-dismissible modal** (`{locked:true, blur:true}`, no close button) over a
  blurred app-preview backdrop (`.ll-blur`). Requires baby name; birthday/country/relationship are
  optional (country defaults to `detectCountry()`, sets the vaccine schedule). Only "Save" or
  "Log out". Sets `memberInfo.{uid}.setupDone=true` so it never re-triggers.
- **Self-graduating beta copy:** `openFirstRun()` switches "An early beta…" → "Thanks for trying
  Cubby!" automatically after **2026-07-27** (inline date check, no cron/edit needed).
- **Referral loop:** each user has a deterministic short code (`refCode()`, djb2 of uid → base36,
  6 chars), shared via Settings → "Share Cubby" (`?ref=` link). On any landing the `?ref=` value is
  validated and stored in `localStorage.cubby-ref`; at sign-in, `resolveHousehold()` writes it to
  `users/{uid}.referredBy` **only for a brand-new household owner** (invited caregivers don't get it),
  then clears the key. Rewards (1 free month of Base per still-active referral, capped at 6) are
  designed but **not yet live** — see `PAYWALL.md`.

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
- Read `DESIGN.md` Part A (the design anchor) before adding or restyling any UI.

## Content engine (sourced articles)
Articles are produced by a **dedicated Sonnet writer agent**, not the main build thread.
- `CONTENT-RUNBOOK.md` = the full publish pipeline (research → write → self-review gate → wire hub
  card + sitemap → validate → commit/push → verify live). Point a `/schedule` or `/loop` at it.
- `CONTENT-QUEUE.md` = prioritized `[ ]`/`[x]` backlog; agent takes the top `[ ]` each run.
- `CONTENT.md` = the rules + theme/age matrix.
- YMYL safety is mandatory: no fabrication, no copying, deep-link + verify-200 official sources
  (NHS/CDC/WHO/AAP), dated disclaimer, no diagnosis, no em-dashes. Unsourceable → `articles-drafts/`.

## Monetization (Stripe Pro billing)
- **Worker is BUILT and launch-ready:** `workers/pro-billing/worker.js` implements the full loop —
  `/checkout` (Stripe session, 7-day trial), `/webhook` (signature-verified), `/portal`. It is the
  only writer of `households/{hid}.pro = {active, plan, status, until, customer, updatedAt}`
  (rules-protected). Client gates ~9 feature classes behind `isPro()` in `app/index.html`.
- **Cubby Pro:** $9/month or $90/year (save 17%, ~$7.50/mo effective), 7-day trial. Localized via the
  `pricing/` currency table (USD/GBP/EUR/AED/INR).
- **To go live (~20 min, see `workers/pro-billing/README.md`):** create Stripe product/price, deploy
  Worker, set the four secrets, add the Stripe webhook, **publish `firestore.rules` in the console**,
  set `PRO_CFG.checkoutUrl/portalUrl` in `app/index.html`, bump `app/sw.js`, test with card 4242.
- Future Pro/Plus tier (~$15/mo annual, $19/mo monthly: HD photos+R2 backup, push, routines) is
  design-only and held until demand + per-user infra costs are proven.
- Full operational handoff for this track: **`MONETIZATION-HANDOFF.md`**. A business-direction /
  fundraising review brief for an outside evaluator: **`STRATEGY-REVIEW.md`**.

## Gotchas
- Editing JS strings: watch for accidental literal newlines inside `'...'` (broke a build once).
- Bump `app/sw.js` `CACHE` or app clients keep old assets (marketing pages don't need it).
- New live domain → add it to Firebase Authorized domains or sign-in fails.
- Firestore rules live in `firestore.rules` **and** must be published in the Firebase console
  (the console copy is the source of truth at runtime) — required before Pro billing goes live.
- `tools/serviceAccountKey.json` (for `tools/analytics.js`) is **gitignored and never deployed** —
  never commit it. `.assetsignore` keeps `tools/`, docs, drafts and node_modules out of the deploy.
- No em-dashes anywhere in user-facing copy; no GA4/third-party trackers (keep the privacy promise).
- Pregnancy work lives on `pregnancy-tracker`; on merge, watch conflicts in shared marketing files
  (root `index.html`, `sitemap.xml`, nav) and take the highest `app/sw.js` CACHE + 1.

## Decisions on record
- Free tiers only for core infra: in-app notifications (no Blaze/card); photos as base64 in Firestore
  (no Storage); no Cloud Functions; analytics via Firestore export + Cloudflare RUM (no GA4).
- Auth: Google sign-in + email magic-link, both on our own domain (`authDomain = little-cubby.com`,
  `/__/*` proxied through `worker.js`).
- Onboarding: mandatory locked first-run modal (blurred backdrop, baby name required), guarded by a
  `setupDone` flag; beta framing auto-graduates 2026-07-27 (no manual edit).
- Referral: `?ref=` codes (hashed uid, base36) captured to `localStorage.cubby-ref`, written to
  `users/{uid}.referredBy` only for new household owners; rewards designed, not yet live.
- Growth: WHO default; CDC toggle; IAP n/a for under-5.
- One shared household per family.
- Pricing: Cubby Pro $9/mo or $90/yr (save 17%, 7-day trial), one unified tier; localized
  monthly, localized (USD/GBP/EUR/AED/INR).
- Generative-AI photo editing deferred to post-beta (on-device only for now) — see `AI-EDITING.md`.
- No fabricated testimonials/reviews/user counts; visuals are original illustrations + initial avatars
  (no copyrighted stock photos).

## Next planned (see the docs for detail)
- **Pregnancy tracker**: MERGED into `main` and live (one Cubby; "Mommy To Be" retired; 170-country
  schedules; Privacy Max 1.0). History + spec: `PREGNANCY-HANDOFF-V2.md`. (Our Den household hub
  remains dark behind `FEATURES.den = false`.)
- **Stripe Pro billing**: Worker BUILT and launch-ready — just needs Stripe secrets + webhook + rules
  publish (`workers/pro-billing/README.md`). Referral rewards announce once redeemable. `PAYWALL.md`,
  `PRO.md` for design.
- **Content cadence**: run the queue 2-3×/week via the runbook agent — `CONTENT-RUNBOOK.md`.
- **Send-email flow** for invites/digests (server-sent, deferred to Blaze phase) — `EMAIL.md`.
- **Post-beta on-VM image AI** (Qwen/Seedream) — `AI-EDITING.md`.

## Doc index
`README.md` (full) · `HANDOFF.md` (this) · `DESIGN.md` (**design anchor**: system + audit, follow
Part A for any UI) · `CHANGELOG.md` · `SEO.md` · `CONTENT.md` /
`CONTENT-RUNBOOK.md` / `CONTENT-QUEUE.md` · `PRO.md` / `PAYWALL.md` (Stripe billing built,
launch checklist in `workers/pro-billing/README.md`) · `PREGNANCY.md` /
`PREGNANCY-HANDOFF.md` (v1, superseded) / **`PREGNANCY-HANDOFF-V2.md` (the pregnancy track:
built on branch `pregnancy-tracker`, rollout + next steps)** · `ROUTINES.md` · `ONBOARDING.md` ·
`EMAIL.md` · `ANALYTICS.md` · `AI-EDITING.md`
