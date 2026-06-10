# Cubby Pro — monetization research & roadmap

Status: **payment loop BUILT (June 2026), awaiting Stripe + Worker deploy to go live.**
Everything client-side is in place: entitlement (`households/{hid}.pro`, written only by the
billing Worker, rules-protected), `isPro()` gating, the upgrade sheet with 7-day-trial checkout
(falls back to the waitlist until configured), the gated Base feature set (premium studio,
watermark-free shares, doctor PDF report), and the Cloudflare Worker for Stripe checkout /
webhook / portal.

**Launch checklist (the only remaining steps, ~20 min):** follow `workers/pro-billing/README.md`:
create the Stripe product/price ($59/yr), deploy the Worker, set its four secrets, add the
Stripe webhook, **publish the updated `firestore.rules` in the Firebase console**, then set
`PRO_CFG.checkoutUrl/portalUrl` in `app/index.html` and bump the SW cache. Test with Stripe
test mode (card 4242...) before flipping live keys. Dev preview of Pro:
`localStorage['cubby-pro-dev']='1'`.

## Positioning
**Free forever for the essentials** (logging, sharing with family, growth charts, health nudges,
keepsakes basics). Pro adds power-user + cost-heavy extras. Never paywall safety/basics.

## Competitor benchmarks (2026)
- **Huckleberry** — Plus $11.99/mo (~$69/yr): sleep predictions ("SweetSpot" nap timing),
  unlimited tracking, growth charts. Premium $14.99/mo (~$120/yr): + 1:1 sleep consultations.
- **Glow Baby** — free with ads; Premium ~$9.99/mo: ad-free + extras.
- **Nara Baby** — strong med tracking; freemium.

**What actually converts:** data-driven **sleep guidance** is the clearest paid winner. What
rarely justifies cost: community feeds, gamification, elaborate charts, shopping integrations.
Implication: lead Pro with **smart sleep/feed insights**, not gimmicks.

## Cubby Pro — candidate features
**On the waitlist now (advertised):**
0. **Smart routines (Routine Manager)** — flagship. Age-aware, adaptive daily rhythms (feeds,
   naps, tummy time, skin-to-skin, fresh air) across day 0→365 that re-flow when life changes.
   Cue-first and gentle, never a rigid alarm. Full spec in **ROUTINES.md**. This is Cubby's answer
   to the sleep/routine guidance that research shows parents actually pay for.
1. **HD photos & cloud backup** — full-res photos, safely backed up (free keeps ~560px
   thumbnails). NOT "unlimited" (cost trap); generous fair-use quota. **Architecture: Cloudflare
   R2** (zero egress fees, ~$0.015/GB/mo) rather than Firebase Storage (egress ~$0.12/GB makes
   "unlimited viewing" expensive). See "Image storage" below.
2. **Push notifications** — medicine / "time to log" / fever / appointment alerts even when the
   app is closed. The deferred Blaze feature.
3. **Doctor reports & export** — polished PDF visit reports + full CSV/PDF data export.
4. **Smart insights & keepsakes** — sleep & feed pattern insights and gentle nap-time
   suggestions (our answer to SweetSpot), premium memory-card templates, a monthly video montage.

**Researched, to consider later:**
- Sleep schedule predictions / wake-window guidance (the #1 paid feature elsewhere).
- Unlimited caregivers / multiple babies beyond a free cap.
- Pediatric content / curated guidance (allergen-intro plans, milestone tips).
- Apple Health / Google Fit sync; web + large-screen access.
- Ad-free (only relevant if we ever add ads to free — current plan: no ads).

**Avoid:** community feed, gamification, shopping/affiliate clutter.

## Image storage (today + Pro)
- **Today:** ~560px JPEG thumbnails stored as base64 **inside Firestore** (`photos` subcollection,
  ~40-80 KB each). No Firebase Storage → no Blaze. ~15-20k photos fit in the 1 GB free tier.
  Trade-off: soft on a large hero.
- **Pro (HD):** full-res can't live in Firestore (1 MB/doc cap + per-read cost). Use object storage.
  - **Cloudflare R2 (recommended):** ~$0.015/GB/mo storage, **$0 egress**. 100 families × 2 GB ≈
    ~$3/mo total, free viewing. We're already on Cloudflare.
  - Firebase Storage: simpler SDK but **egress ~$0.12/GB** (charged every view) → "unlimited" gets
    pricey. Avoid for view-heavy galleries.
- Therefore advertise **"HD photos & cloud backup"** with a fair-use quota, not literal "unlimited".

## Pricing hypothesis (validate, don't commit)
- Undercut Huckleberry: **~$4.99/mo or ~$39/yr**, family-friendly (covers the whole household).
- Possibly a one-time "lifetime/keepsake" option for photo storage.
- Keep the free tier genuinely good so Pro is a delight, not a hostage.

## Launch pricing — v1 "Base" plan (next venture, design-only for now)
The first paid version ships **one cheap entry tier**, priced to maximise first conversions, with
a free trial so there is no risk to try. Full Stripe/paywall build is deferred to the next venture;
this is the plan to build against. (Beta stays 100% free.)

- **Base** — headline **"from $5/mo"**, i.e. **billed annually at ~$59/year** (effective $4.92/mo).
  - **7-day free trial**, card required, cancel anytime before day 7 = no charge.
  - Monthly option can exist later (e.g. ~$7/mo) but the annual $5/mo is the hero; annual also
    improves retention and cash flow and suits a yearly product (one baby-year).
  - Localised like the existing Pro widget (USD/GBP/EUR/AED/INR) — reuse that currency table.
- **What Base unlocks (v1):** pick the cheapest-to-serve, highest-pull perks so margin is safe at $5:
  the **Moments/keepsakes** upgrades (premium templates, fonts, formats, watermark removal,
  sticker pack, Then & Now) plus **doctor PDF report + data export**. These are on-device or
  generated client-side, so they cost us nothing per user. See PAYWALL.md.
- **Held back for a later, higher tier (not Base):** anything with real per-user infra cost —
  **HD photos & cloud backup (R2)**, **push notifications (Blaze)**, **smart routines/insights**.
  Those justify a future "Pro/Plus" tier above Base once demand + costs are proven.

### Tier ladder (target)
| Tier | Price | Who | Includes |
|---|---|---|---|
| **Free** | $0 forever | everyone | All logging, sharing, vaccines, growth, health nudges, basic keepsakes. Never paywall safety/basics. |
| **Base** (v1 launch) | from $5/mo (annual ~$59/yr), 7-day trial | most paying parents | Free + premium keepsakes/moments, watermark-free shares, doctor PDF + export. Zero-marginal-cost features. |
| **Pro/Plus** (later) | ~$15/mo annual / $19/mo | power users | Base + HD photos & cloud backup, push notifications, smart routines & insights. Cost-heavy features. |

> The marketing site already shows the higher Pro price (~$15/mo annual / $19/mo). When the Base
> plan goes live, surface it as the entry point ("from $5/mo, 7-day free trial") above Pro on the
> pricing page and reuse the existing `CUR` currency table + monthly/annual toggle in `pricing/`.

## Validation plan
1. **Waitlist** (built): Settings → Cubby Pro → Join; landing teaser. Stored in Firestore
   `waitlist/{uid}` with the user's email. Read counts in the console.
2. Watch which features testers ask about most (feedback) → prioritize.
3. Before building Pro: a short in-app survey to waitlisted users on must-haves + willingness to pay.
4. Only then build (push + storage both require Firebase Blaze — see EMAIL.md/README for the
   billing implications).

## Sources
- Pebbi: Best Baby Tracker Apps 2026 / Huckleberry pricing comparison
- Huckleberry (Google Play listing)
- Glow Baby vs Huckleberry comparisons
