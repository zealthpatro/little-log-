# Product: Cubby

**Last updated:** 2026-09-24
**Method:** codebase scan + recorded founder decisions (product board, Delta-4 audit, market position)

## Product Identity
- **One-liner:** A parent at 3am taps "feed" and everyone looking after the baby can see when the last feed was, and the same app carries them from trying to conceive through pregnancy to the baby's first years.
- **Category:** consumer health and family care tracker
- **Product type:** B2C, with a small shared group (the household) at its centre
- **Collaboration:** multiplayer. The product is built on a second person joining the household and logging.

## Business Model
- **Monetization:** free today. Pro is a waitlist.
- **Pricing tiers:** Free; Pro at $9/month or $90/year with a 7-day trial, target launch October 2026.
- **Billing integration:** Lemon Squeezy as merchant of record, built in `workers/pro-billing/worker-lemonsqueezy.js` and NOT live. A Stripe worker is kept for reference. No money moves today.

## Tech Stack
- **Primary language:** JavaScript, no build step
- **Framework:** none. One SPA in `app/index.html` (~19.5k lines, inline script) plus `app/store-firebase.js`.
- **Database:** Firestore (per-household blob plus subcollections); Cloudflare D1 for newsletter and the gender game.
- **Background jobs:** Cloudflare Worker cron every 15 minutes (`scheduled()` in `worker.js`): push reminders, erasure purge, the sign-in canary.
- **HTTP client patterns:** `fetch`, Firestore REST from the Worker with a service-account token.
- **Module organization:** global functions in the SPA; `window.LL` is the store bridge.
- **Native:** Capacitor iOS and Android wrappers that REMOTE-LOAD `little-cubby.com/app/`. The shipped binary contains only a redirect, so a push to `main` changes the installed apps.

## Value Mapping

### Primary Value Action
**Logging a care entry** — a feed, sleep, nappy, pump, growth reading, symptom or milestone for a baby, or the equivalent record in pregnancy (kicks, contractions, blood pressure, weight, appointments) and trying (periods, observations, a positive test). If this drops to zero, the product has failed.

### Core Features (directly deliver value)
1. **The shared log** — one timeline everyone in the household reads and writes. The last-feed answer at 3am is the product.
2. **A second caregiver** — the wedge. A household where two different people log is the outcome everything else serves. Historically 0 of 11 households reached it.
3. **Stage journeys** — trying (cycle, observations, positive test), pregnancy (weeks, appointments, kicks, contractions, BP), baby (feeds, sleep, nappies, growth, vaccines, milestones).
4. **Care-critical safety surfaces** — fever and illness tracking, BP and contraction concern prompts, the doctor report a parent hands a clinician.

### Supporting Features (enable core actions)
1. **First-run wizard and first log** — gets a new household to its first entry.
2. **Invites** — email invite and invite links, which bring the second caregiver.
3. **Reminders and calendar export** — `.ics` into the parent's own calendar, native push.
4. **Keepsakes** — photos, moments, the journey book, the gender guessing game.
5. **Reading room and ask box** — articles and answers.
6. **Pro waitlist** — registers intent before billing exists.
7. **Loss path** — ending a pregnancy with care (`endPregnancy`, `renderLossHolding`), owner-only.
8. **Account deletion and data export** — always unilateral.

## Entity Model

### Users
- **ID format:** Firebase Auth uid, an opaque 28-character string.
- **Roles:** `owner` (created the household; owns pregnancy and mental-health records) and `caregiver` (joined by invite).
- **Multi-account:** one household per user in practice. The household is chosen at sign-in.

### Accounts (the household)
- **ID format:** Firestore auto-id, 20 characters, `households/{hid}`.
- **Hierarchy:** nested. The household holds babies or one pregnancy journey, and one care log.

## Group Hierarchy

```
Household  (the group; ownerId, members map with roles)
└── Baby   (households.app.babies[], by id)   — or a Pregnancy journey (households/{hid}/pregnancy/{owner}), or Trying
```

| Group Type | Parent | Where Actions Happen |
|---|---|---|
| household | none | invites, membership, stage changes, Pro, settings, deletion |
| baby | household | every baby care log, growth, vaccines, milestones |
| pregnancy | household (owned by one user) | weeks, appointments, kicks, contractions, BP, loss |

**Default event level:** household. Baby and pregnancy are carried as properties rather than separate group calls, because a household rarely holds more than two babies and the owner-owned pregnancy record must not become visible to caregivers through analytics.
**Admin actions at:** household (owner).

## Current State
- **Existing tracking:** first-party only, no SDK. Anonymous page counts, first-touch UTM, referral code, Pro waitlist, operational health. The funnel is derived by hand from care-log timestamps. Full census in `.telemetry/current-state.yaml`.
- **Documentation:** partial. `tools/funnel.js` and `tools/analytics.js` are commented; there is no tracking plan.
- **Known issues:** pregnancy and trying households are invisible to the funnel; actions that leave no stored record leave no trace; the scheduled weekly report has been dead since 2026-08-30.

## Integration Targets
| Destination | Purpose | Priority |
|---|---|---|
| Cubby's own Firestore | the only store for any new signal | required |
| Scheduled first-party report | weekly funnel, delivered to the founder | required |
| Any third-party analytics tool | none, by design | excluded |

**Destination constraint that shapes the design:** no third party, ever. `tools/thirdparty_gate.js` enforces the no-trackers promise, the App Store privacy label is about to declare Usage Data as not collected, and privacy is the product's positioning. So there is no CDP, no SDK and no event-volume billing; the constraint is legibility and the privacy label rather than cost.

## Codebase Observations
- **Feature areas inferred:** four tabs (home, log, album, health) and 147 sheets, including FirstLog, AddBaby, OnboardInvite, AddSomeone, Pro, StartPregnancy, ExpectingSetup, PlanningSetup, PositiveTest, KickCounter, Contraction, LogBP, DeleteAccount, GuessGame.
- **Entity model inferred:** stages `planning`, `pregnancy`, `child` in code; roles `owner`, `caregiver`; care-log types feed, sleep, diaper, pump, growth, activity, symptom, milestone.
