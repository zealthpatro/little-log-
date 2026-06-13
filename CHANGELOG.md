# Cubby — Changelog

## v0.10.1 — 2026-06-12 — global content expansion + article naming policy

**Content**
- 15 new articles: India (5), Australia (5), Chinese parenting (3), global comparisons (2). Hub at 119 cards; sitemap at 125 URLs.
- **Article naming policy enforced**: titles use the practice name (maalish, zuo yuezi) or a universal topic (safe sleep, heatwave safety). No country qualifiers in h1/title/og:title. 12 existing articles renamed in place (slugs unchanged).
- Global expansion plan designed: 4 clusters (Common Ground, India+China, Australia+Japan, USA+Germany+Italy) covering ~125 more articles. Full queue in CONTENT-QUEUE.md.
- Cluster A (10 cross-cultural universals) established as the mandatory starting point so that all regional articles have a universal article to link up to.
- Deployment cadence design: pre-write full cluster, deploy at 4-hour intervals via cron; cron agent queue approach documented.

**Docs**
- CONTENT.md, CONTENT-QUEUE.md, CONTENT-RUNBOOK.md, SEO.md updated with current inventory, naming policy, global expansion plan, and international source hubs.

---

## v0.10.0 — early access (2026-06) — same-domain auth, growth loops, design system, content & Pro billing
Everything since the first close-group test build: a polished front door, a way to grow, a unified design language, a content engine, and the first paid tier wired end to end.

**Auth & accounts**
- Sign-in now runs on our **own domain**: `authDomain` to `little-cubby.com` via a `/__/auth` edge proxy (`worker.js` reverse-proxies the reserved Firebase `/__/*` namespace), so the Google popup says little-cubby.com, not firebaseapp.com.
- **Email magic-link sign-in** alongside Google (passwordless); auth-email domain state recorded in `EMAIL.md` (branded auth emails deferred to the ESP/Worker phase).

**Onboarding & first run**
- First-run polish: blurred home-preview backdrop behind a frosted setup card; **Log out** on onboarding + welcome modal; welcome modal is **non-dismissible** (no skipping setup); baby remains **mandatory**.
- **Welcome back**: returning members get Open Cubby CTAs + a welcome strip on the marketing home (no forced redirect).
- **Self-graduating copy**: welcome note + settings tag drop "beta" for "early access" automatically after 2026-07-27 (date-conditional, no manual edit).

**Growth**
- **Referral loop v1**: "Share Cubby" in Settings (native share + personal `?ref` link), ref capture on home + app, `referredBy` attribution on first sign-in (fresh households only); reward design lives in `PAYWALL.md`, no public promises.

**Design**
- Full **design pass** per `DESIGN.md` (the new design anchor): mobile nav fix (P0), unified SVG iconography, bottle-feed icon, type/breakpoint/token normalization, app framed on wide screens.
- **Wide-screen pass**: carousel v2 (consistent height, cropped in-use phone, slide bullets), mock glyphs emoji to house SVGs, wider containers at large widths, articles hub at 1060px; feature hierarchy + emoji policy documented.

**Content**
- **Articles hub** with search + topic/age filters, section headers, chip counts (chips wrap on desktop); **100+ articles** published (now 104+), plus editorial page, comparison rewrites (lead with Cubby's wins), and related links.

**SEO & accessibility**
- **BreadcrumbList** structured data everywhere, **per-page OG images**, and an a11y pass (focus rings, reduced-motion, `aria-hidden` mocks, contrast); E-E-A-T footer; iOS/Android install guide.

**Pro & billing**
- **Cubby Pro payment loop**: v1 Base pricing, entitlement + gated Base features, and a **Stripe billing Worker** (`workers/pro-billing`). Free-tier guardrails documented in `PAYWALL.md`/`PRO.md`.

**Docs**
- New `DESIGN.md` (design source of truth), refreshed `README.md`/`HANDOFF.md`, plus `PAYWALL.md`, `PRO.md`, and `EMAIL.md` updates.

## v0.9.0 — beta (2026-06) — first close-group test build
The full journey from a single-file local app to a shared, cloud-synced product.

**Platform**
- Cloud backend: Firebase Auth (Google sign-in) + Cloud Firestore real-time sync.
- One shared "household" per family; owner vs caregiver roles enforced by security rules.
- Hosted on Cloudflare (auto-deploys on push); installable PWA, offline-capable.

**Sharing & people**
- Invite by email (Copy link / mailto email button / relationship + co-owner).
- Remove member; first-run setup (pick your bear + relationship).
- Per-person and per-baby **bear avatars** (fur + accessory), changeable.
- Entry attribution — "logged by <relationship>" with the person's mini bear.

**Logging**
- Unified **time strip** across all flows (feed, diaper, sleep, pump, activity): one tap to set
  date + time via a custom warm picker.
- Sleep: live timer + past nap with "still sleeping (ongoing)" toggle; shared live timers.

**Health**
- Fever → see-doctor nudge (age-aware) + 24h home banner.
- Doctor-visit summary (last 7 days, copyable/shareable) + upcoming-appointment banner.
- **Growth charts**: WHO (0–24mo) + CDC (0–36mo) percentile bands with Boy/Girl selector and
  "latest ~Nth percentile" readout (data sourced from official CDC/WHO files).

**Beta**
- In-app **Send feedback** (Settings + 👨‍👩‍👧 menu) → Firestore `feedback` (read in console).
- New-user welcome/expectations note; version stamp (this file).

**Docs**
- `README.md` (architecture/data model/deploy), `HANDOFF.md` (resume guide), `EMAIL.md`
  (email scaling plan).

---
_Conventions: bump this file + `sw.js` CACHE on each release; see README §10._
