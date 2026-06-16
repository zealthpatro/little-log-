# Cubby — Changelog

## v0.13.0 — 2026-06-16 — contextual "why we ask" help, Sign in with Apple, brand-mark fix

A calmer data-entry experience with inline reasons for every sensitive field, Apple sign-in for the App Store, and a corrected brand wordmark on the sign-in surfaces. All live on little-cubby.com (deploys from `main` via Cloudflare Workers Builds).

**Contextual "Why we ask" help**
- New reusable inline expander in `app/index.html`: a `wwa(key)` helper, a WWA copy map, and `.wwa`/`.wwa-t`/`.wwa-n` styles. One calm tap reveals the reason under a field; it never navigates or opens a sheet.
- Wired into 22 fields where parents seek clarity: baby birthday (add + onboarding), baby name (onboarding), birth details (one consolidated note), blood group, doctor contacts (one note), pregnancy dating (due date / last period / cycle length / care country, across setup, positive-test, period-update and edit flows), maternal weight, glucose, blood pressure, growth weight + height (one note), and the boy/girl chart toggle.
- Allergies and the family-list email use an always-visible note instead of a hidden expander, because those facts should not be tucked away.
- Every privacy line was adversarially verified against `firestore.rules` so the claims are true. The family list now states plainly that everyone in the circle can see each other's name and email.
- Shipped commit `3365e4d`, service worker `little-log-v80`.

**Sign in with Apple (live)**
- Apple sign-in is live (App Store guideline 4.8). `app/firebase-init.js` adds `window.LL.appleProvider` (`OAuthProvider('apple.com')` with email + name scopes); `app/store-firebase.js` adds `appleBtnHtml()` + `signInApple()` using `signInWithPopup` with a `signInWithRedirect` fallback for webviews and blocked popups. A "Continue with Apple" button now appears on both the landing and auth-card sign-in screens.
- Apple config: App ID `com.littlecubby.app`, Services ID `com.littlecubby.web`, Team ID `F5NVQV7NVB`, Key ID `78HP3BF2S5` (the `.p8` lives only in the Firebase console, never in the repo). Firebase project `little-log-a9caa`; the edge worker already forwards Apple's POST callback on `/__/auth/*`, and no `.well-known` domain-association file was needed (Firebase does the server-side token exchange).
- Sign-in methods are now Google + Apple + email magic-link.
- Shipped commit `04ec7a7`, service worker `little-log-v81`.

**Brand-mark fix**
- The app sign-in/landing top-left nav now shows the "Cubby" wordmark instead of the bare domain "little-cubby.com", matching the marketing site (`app/landing.js`). The footer link to little-cubby.com is kept on purpose.
- Shipped commit `862df25`, service worker `little-log-v82`.

**Privacy-enforcement findings (known gaps)**
- The dual-guardian consent gate for export/delete is enforced only in client code (`index.html`), not in `firestore.rules`: any household member can write the shared app blob, and an owner can delete without a second approval. "Both guardians must agree" is a UI convention, not a security guarantee; help copy was softened to "Cubby asks both guardians to agree". To make it a real guarantee it must move into `firestore.rules`.
- Email is not private: it is written to `households/{hid}.memberInfo`, readable by every member and shown on the family list. Copy was corrected accordingly.

**Parked for later (not built)**
- A merchandise revenue stream: physical keepsakes printed from a baby's "moments" via print-on-demand (Printful/Gelato/Prodigi). Shipping address would come from checkout (Apple Pay payment sheet, or Stripe/Shopify), never from sign-in (Apple/Google return only name + email). Physical goods do not owe Apple's 15-30% cut, so it is a cleaner iOS revenue stream than the Pro subscription. Gating constraint: baby photos leaving to a third-party printer must be per-order explicit opt-in and disclosed.

**Platform**
- Service worker cache progressed `little-log-v78` -> `little-log-v82` over the session.

---

## v0.12.0 — 2026-06-14 — home day-surface, pregnancy privacy, routines, hardened sign-in

A warmer home screen, two more things moved off the circle-shared blob into owner-owned storage, gentle daily routines, and a tougher sign-in endpoint. All live on little-cubby.com (deploys from `main` via Cloudflare Workers Builds).

**Home day-surface (item 5)**
- The home screen now shows a per-day surface: today's notes, a gentle quote, and recent photos as polaroids. The old single shared "handoff" note was replaced by **per-day notes**.
- Notes are stored one-per-doc in `households/{hid}/notes/{noteId}` (no longer in the circle-shared app blob), each with an `audience`: `circle` (everyone in the household), a specific member uid (private to that one person), or the author. `firestore.rules` enforce read by audience/author; only the author can edit or delete. A one-time migration folds any legacy handoff note into a single `circle` note.

**Pregnancy journey privacy (item 7)**
- The pregnancy **journey** (stage, due date, weeks, appointments, kicks, contractions, birth plan, hospital bag, moments) moved out of the circle-shared app blob into an owner-owned doc `households/{hid}/pregnancy/{ownerUid}`, mirroring the maternal-health (mhealth) pattern. Readable by the owner plus the uids she lists in `sharedWith[]`, writable only by the owner; server-enforced in `firestore.rules` (`match /pregnancy/{owner}`).
- Maternal-private health stays separately owner-only in mhealth and is never swept into the journey. A legacy in-blob journey self-heals: the owner's client relocates it to the owner doc, then strips the blob on the next owner login. (The legacy blob journey was already circle-visible under the old design, so this is retroactive privatization, not a fresh leak.)

**Routines (item 8)**
- A gentle, per-baby, age-appropriate **routine list in the Log tab**. Tapping "done" writes a real log event (so it appears in the timeline/recap), authored by the person who taps it. No notifications, no server cron, no Blaze/Storage/Functions dependency: stays on the free tier.

**Sign-in & secrets**
- **Magic-link rate limiting in the Worker**: `POST /api/send-signin-link` is now rate-limited per IP (5 requests / 60s) via a Cloudflare Workers rate-limiting binding (`SIGNIN_RATE_LIMITER`), enforced right after the same-origin check, before any body or token work. Returns 429 + `Retry-After` when over budget, fails open if the binding is missing. Verified live. This replaces the previously-pending Cloudflare dashboard rate-limit TODO (now done in code, deploys on push) and complements the same-origin gate and per-email cooldown.
- **Resend API key rotated**; the new key lives only as the `RESEND_API_KEY` Worker secret, never in the repo.

**Rules & platform**
- `firestore.rules` published in the Firebase console, including the new notes + pregnancy blocks (mhealth + pro-lock rules unchanged).
- Service worker cache bumped to `little-log-v73`.

**Hardening**
- An adversarial review caught and fixed 4 defects before ship: (a) sign-out/teardown clears in-memory pregnancy + maternal-private health so it can't survive into the next account on an in-tab switch; (b) routine events are authored by the tapper and the un-tick is permission-guarded (no server-rejected "zombie" events); (c) the handoff->note migration is idempotent and authored by the writing owner.

**Still to do:** the founder's two-account cross-account privacy test; the deferred `app.pregnancy` rules guard (waiting ~a week for old v72 clients to drain); the deferred notes audience-immutability rule tweak.

---

## v0.11.0 — 2026-06-14 — one Cubby: pregnancy merged, mother-owned privacy, working email sign-in

The pregnancy track shipped into `main`, the brand consolidated to one lifecycle app, maternal health went private-by-design, and email sign-in actually delivers now. All live on little-cubby.com (deploys from `main` via Cloudflare Workers Builds).

**Lifecycle & brand**
- One Cubby across four stages (Trying -> Expecting -> Baby -> Child). "Mommy To Be" retired; the "Den" household hub parked (`FEATURES.den=false`).
- **Pregnancy tracker merged into `main` and live**: week-by-week, antenatal schedules (170-country coverage, verified UK/US/DE/UAE/CA/AU/NZ/IE + WHO-aligned fallback + a custom plan), opt-in health trackers (GDM/BP/supplements/nausea), kick counter, contraction timer, birth plan, hospital bag, Moments album, the birth transition, and a compassionate pregnancy-loss flow.
- Marketing: **Expecting/Baby audience framework** (pre-paint lifecycle-stage engine with entry-context routing, two-tab Features, Home "Expecting" section, Articles strip, Pregnancy nav). Lifecycle close "the only app you'll ever need, from two lines to big kid" on the home page and in the sign-in email.

**Privacy (Privacy Max 1.0, gate G1)**
- Maternal health moved **off the circle-shared blob** into `households/{hid}/mhealth/{ownerUid}/cat/{category}`: mother-owned, per-category consent, mood owner-only and never shareable. `firestore.rules` published in the Firebase console.

**Email sign-in (fixed)**
- Own Cloudflare Worker `POST /api/send-signin-link` mints the Firebase sign-in link (service-account JWT -> OAuth -> Identity Toolkit `returnOobLink`) and sends a branded email via **Resend** from `mail.little-cubby.com`. **Verified delivering to the Gmail inbox** (Firebase's built-in sender was being silently dropped). Hardened (same-origin Origin/Referer guard, normalized cooldown set after send); sign-in deeplinks rebranded to `little-cubby.com`.

**Vaccines & content**
- Vaccine catch-up (Phase 0.3): calm 5-state badges, no red "OVERDUE wall"; estimated catch-up dates tagged.
- ~180 articles live (baby + pregnancy clusters).

**Docs**
- `HANDOFF.md` now leads with a current-status + go-live section; `EMAIL.md`, `PRIVACY-MAX-1.0.md` updated.

**Still to do for full launch:** Cloudflare rate-limit rule on the sign-in endpoint; Pro billing go-live (Stripe, targeted Aug 2026); emulator cross-account test for the consent-sharing path; retire the merged `pregnancy-tracker` branch.

---

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
