# The Cubby ecosystem (vision)

One family account, one continuous lifecycle, sold as distinct services that hand off to each
other. A family should never leave Cubby from the first positive test to the toddler years.

```
  CUBBY DEN              ──birth──▶   CUBBY                    ──later──▶  (future services)
  the pregnancy service               the baby tracker                     toddler, family health,
  week view, antenatal                feeds, sleep, vaccines,              school-age...
  schedule, GDM/BP/health             growth, keepsakes, care
  trackers, kick/contraction          circle
  tools, birth plan
```

## The two services today

### 1. Cubby Den (pregnancy)
- **Positioning:** "The den is where the cub grows." Pregnancy tracking, week by week to birth.
- **Status:** fully built in-app (branch `pregnancy-tracker`): pregnancy mode + week view,
  antenatal schedules by country (NHS/ACOG/G-BA/WHO), danger signs (CDC), logging (appointments,
  symptoms, weight, BP, care team), opt-in condition trackers (gestational diabetes glucose with
  NICE/ACOG targets, BP/pre-eclampsia watch, supplements, nausea/hydration), tools (kick counter,
  contraction timer with 5-1-1, birth plan, hospital bag), and the birth transition.
- **Marketing:** public sales page at `/pregnancy/`.
- **The hinge:** "Baby has arrived" converts the pregnancy into a baby profile (country and sex
  carry over, pregnancy kept as history). Den graduates into Cubby; that continuity IS the moat.

### 2. Cubby (baby, the existing product)
- Logging, multi-caregiver sync, vaccines, growth, medicine, keepsakes; newborn to toddler.
- Monetised per PRO.md / PAYWALL.md (v1 Base plan $5/yr-annual, 7-day trial).

## Why an ecosystem
- **Acquisition earlier in the funnel:** parents search for pregnancy apps months before baby
  apps. Den acquires them at week 6, Cubby retains them to year 3+. Lifetime starts ~9 months
  sooner and conversion at birth is built into the product, not a re-acquisition.
- **Two storefront listings, one codebase:** Den and Cubby can be marketed (and later listed)
  separately while sharing the same app, account, household and sync (see DISTRIBUTION notes
  below). Cross-sell is a screen transition, not a new signup.
- **Trust compounding:** the family's data history (pregnancy -> birth -> growth) makes leaving
  costly in the best way: the product holds their story.

## Naming decisions (June 2026)
- **"Ember" was considered and REJECTED:** Ember Technologies (ember.com, the smart-mug company)
  ships an "Ember Baby Bottle System" with an **"Ember Baby" app** that tracks feedings and baby
  growth, plus "Ember Cycle Train" (pregnancy/postpartum) already exists on the App Store. Direct
  likelihood-of-confusion risk in our exact category; also an ASO dead end.
- **"Cubby Den" chosen:** a bear's den is where cubs are born; derivative of our own mark
  (defensible), unique in the stores, and the lifecycle story stays in the bear world.
- Avoid for future sub-brands: Glow, Bump, Nest, Hatch (all major existing baby/pregnancy brands).

## Distribution (summary; the full review was discussed June 2026)
- Web/PWA stays the source of truth and the web funnel. Stores are the discovery funnel.
- Path: Play Store first via TWA/Capacitor (~1-2 wks), then iOS via Capacitor (~3-5 wks).
- iOS requirements to plan for: native Google sign-in plugin (webview OAuth is blocked), **Sign in
  with Apple** (mandatory alongside Google), in-app **account deletion**, push notifications as the
  guideline 4.2 "native value" justification (FCM + a Cloudflare Worker cron, no Blaze), IAP for
  any in-app purchase (or web-purchase Netflix model), health-app review scrutiny (our cited
  sources + "informational, not medical advice" framing is the review armor), privacy labels
  (pregnancy data = sensitive category).
- Costs: Apple $99/yr, Google Play $25 one-time. Apple Small Business Program = 15% IAP cut.

## Ground rules that apply ecosystem-wide
- Free tier infra only (no Blaze/Functions/Storage); one Firestore household blob syncs everything.
- YMYL discipline everywhere: cited official sources, "seek care" never "diagnose", visible
  disclaimers, no fabricated reviewers or stats.
- No em-dashes in user-facing copy. Warm, no-guilt tone.
- Pregnancy core stays free (trust/safety); Pro candidates listed in PAYWALL.md.
