# Monetization handoff: Cubby Pro payment loop

> **Status (June 2026):** The Cubby Pro payment loop (Lemon Squeezy + Worker + tamper-proof entitlement) is built on `main` but NOT yet charging; Pro is $9/mo or $90/yr, gated to an Aug 2026 launch. Full current state + go-live plan: HANDOFF.md.

**Version 1 · 2026-06-13.** Operational handoff for the Pro / payments work. Read this cold and
you can take the payment loop from "built" to "charging real money".

> **Provider note (2026-07):** the chosen processor is now **Lemon Squeezy (merchant of record)** —
> see `workers/pro-billing/LEMONSQUEEZY.md` and `worker-lemonsqueezy.js` for the live path. The
> Stripe-specific steps below (webhook event names, `STRIPE_PRICE_ID`, test card `4242…`) describe
> the **legacy Stripe worker** (`worker.js`), kept as the alternate; do not follow them verbatim for
> the Lemon Squeezy go-live.

> **Scope:** this doc owns the **monetization track** (entitlement, gates, billing). It is on
> `main`, which is the production branch (push = live via Cloudflare Workers Builds). The pregnancy
> product is now **merged into `main` and live** (`PREGNANCY-HANDOFF-V2.md`; the old
> `pregnancy-tracker` branch is redundant, kept until retired, and is NOT a deploy branch).
> Business-strategy review lives in `STRATEGY-REVIEW.md`.

---

## 1. Status in one line
The Pro payment loop is **built and committed to `main`** (commit `6aae432`, plus the gated
features), but is **NOT live**: no Stripe account is wired and `PRO_CFG` URLs are empty. (The
tamper-proof Firestore rule that locks the `pro` entitlement is now **published** in the Firebase
console, as of 2026-06-14, as part of the full ruleset.) Until Stripe is wired, the Pro sheet
safely falls back to the existing waitlist, so nothing changed for current users.

## 2. The model (how a dollar flows)
```
  app: Settings > Cubby Pro > "Start 7-day free trial"
        │  POST /checkout {hid,email}
        ▼
  workers/pro-billing  ──create Checkout (trial sub)──▶  Stripe Checkout (card)
        ▲                                                      │ pays / trial starts
        │  POST /webhook (signed)  ◀───────────────────────────┘
        ▼  service-account JWT, Firestore REST
  households/{hid}.pro = { active, plan, status, until, customer }
        │  real-time snapshot
        ▼
  every device in the household: window.LL.pro -> isPro() -> features unlock live
```
- **One subscription covers the whole household** (family-friendly by design).
- **Entitlement is server-authoritative.** `households/{hid}.pro` is written ONLY by the Worker
  (Admin creds bypass rules). `firestore.rules` `proUnchanged()` rejects every client write to
  that field, owner included. No client can self-grant Pro.
- `isPro()` is true for Stripe status `trialing | active | past_due`, with a **3-day grace** past
  `current_period_end` so a renewal hiccup never yanks features mid-day.

## 3. What is gated (the "lucrative" set, all zero marginal cost)
The premium keepsake studio (already-built, on-device/client-generated) is what Base sells:

| Gated (Pro) | Free taster (kept generous) |
|---|---|
| Portrait & Story formats | Original + Square |
| Premium fonts (Playfair, Poppins, Caveat) | Fraunces |
| Premium palettes (Sage, Sky, Ink) | Cream, Blush |
| Templates: Big milestone, Monthly stats | Classic |
| Full sticker set | First 6 stickers |
| Auto-enhance, Background cutout | (manual adjusts free) |
| Then & Now keepsake | none |
| **Watermark-free** shares | "made with Cubby 🐻" footer (free advertising) |
| **Doctor PDF report** (print/save, on-device) | Text visit summary, JSON export |

Locked options render as gentle `🔒` chips that open the Pro sheet naming the exact feature.
**Held back for a future higher tier (real infra cost): HD photo backup (R2), push (Blaze),
smart routines/insights.** See `PAYWALL.md` / `PRO.md`.

## 4. Code map (all on `main`)
- `app/index.html`, `PRO_CFG`, `isPro()`, `requirePro()`, `openPro()`, `startProCheckout()`,
  `openProPortal()`, `PRO_LOCK` + `proLocked()`, the `?pro=success` return toast, gated setters
  (`setFormat/setMomentFont/setPalette/setTemplate/selectSticker/autoEnhance/cutoutBackground/
  openThenNow`), watermark `if(!isPro())` in `composeShareCard` + `drawThenNow`, and
  `openDoctorReport()` (off the visit-summary sheet). Grep banner: `CUBBY PRO (Base plan)`.
- `app/store-firebase.js`, exposes `window.LL.pro` from the household doc; `pro` change is in
  the sync signature so it re-renders live.
- `firestore.rules`, `proUnchanged()` guard on household create + update.
- `workers/pro-billing/`, `worker.js` (/checkout, /webhook, /portal; Stripe REST + Google SA
  JWT, no SDKs), `wrangler.toml`, `README.md` (the deploy checklist). Excluded from the static
  deploy via `.assetsignore`.
- `pricing/index.html`, `CUR` currency table (USD 9/90, plus localized GBP/EUR/AED/INR rows),
  annual/monthly toggle. Reuse for any in-app price display.

## 5. Go-live checklist (~20 min, full version in `workers/pro-billing/README.md`)
1. Stripe (test mode first): product "Cubby Pro", two recurring prices **$9/month and $90/year** -> `price_...` each (set STRIPE_PRICE_ID to the $90 annual).
2. `cd workers/pro-billing && npx wrangler deploy`.
3. Secrets: `wrangler secret put` for `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `FIREBASE_SA_KEY`
   (service-account JSON one line, same key as the gitignored `tools/serviceAccountKey.json`).
4. Stripe webhook -> `https://<worker>/webhook`, events `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`; then
   `wrangler secret put STRIPE_WEBHOOK_SECRET`.
5. Activate the Stripe customer billing portal (for "Manage subscription").
6. **Publish the updated `firestore.rules` in the Firebase console.** DONE 2026-06-14: the full
   ruleset (including the `pro` entitlement lock) is published. The console copy is the runtime
   source of truth, so re-publish whenever the rules change.
7. In `app/index.html` set `PRO_CFG.checkoutUrl` and `PRO_CFG.portalUrl` to the Worker URLs,
   bump `app/sw.js` CACHE, push to `main` (Cloudflare Workers Builds deploys on push, ~1 min;
   `main` is the production branch, push = live).
8. Test with Stripe test card `4242 4242 4242 4242` -> confirm `households/{hid}.pro` flips and
   a second device unlocks live -> cancel from portal -> confirm it flips back.

## 6. Testing without Stripe
- Dev-preview Pro on any device: `localStorage['cubby-pro-dev']='1'` (then reload). `isPro()`
  returns true; remove the key to go back. Used throughout verification.
- Verified states: trialing ✓, 2-days-late (grace) ✓, 5-days-late ✗, canceled ✗, none ✗;
  every studio gate flips both ways; sell-sheet vs active-sheet copy; settings status line.

## 7. Known limitations / next steps
- **Beta is still free** per PRO.md. The waitlist fallback means YOU pick the switch-on moment.
- Pricing is unified to one Cubby Pro tier ($9/mo or $90/yr, save 17%) on the pricing page `CUR` table + toggle. No separate Base tier.
- No dunning UI beyond the 3-day grace; Stripe emails handle failed payments.
- One Cubby Pro tier ($9/mo or $90/yr); no multi-tier proration needed.
- Refunds/disputes are handled in the Stripe dashboard (the webhook flips entitlement on
  `subscription.deleted`).
- Analytics: no conversion tracking wired. Consider counting checkout starts vs completes
  (Stripe dashboard covers this initially).

## 7b. Parked: merchandise revenue stream (future, not built)

**Status: PARKED. Not built, no code, no commit.** A second revenue stream considered on
2026-06-16 and recorded here so it is not lost.

- **What:** physical keepsakes printed on demand from a baby's "moments" (the same content the
  studio already composes), via a print-on-demand vendor (Printful / Gelato / Prodigi).
- **Why it is a cleaner iOS stream than Pro:** physical goods do NOT owe Apple's 15-30% in-app
  cut (that applies to digital goods only), so margins are better than the Pro subscription on iOS.
- **Shipping address comes from checkout, never from sign-in.** Apple/Google sign-in return only
  name and email, so the address is collected at the payment step (Apple Pay payment sheet, or
  Stripe / Shopify checkout), not from the account.
- **Hard gating constraint:** any baby photo leaving Cubby to a third-party printer must be a
  per-order explicit opt-in and clearly disclosed (whose photos, which vendor, this order only).
  Run this against the Anxiety Test and the privacy promise before any build.

## 8. Cross-references
`PRO.md` (positioning, tier ladder, status) · `PAYWALL.md` (gate-by-gate list) ·
`workers/pro-billing/README.md` (deploy) · `STRATEGY-REVIEW.md` (is the direction sound /
do we need capital) · `ECOSYSTEM.md` (the one-Cubby lifecycle vision; the "Den" household-OS is
parked, `FEATURES.den=false`).
