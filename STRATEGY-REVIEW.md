# Cubby / Den: strategy review brief (for an external evaluator)

**Prepared 2026-06-13. Audience: a fresh reviewer agent (or advisor) asked to pressure-test the
direction and answer one question bluntly: is this on a sound path to a real business on near-zero
infra, or do we need to raise capital ("more dough") to make it work?**

Please be critical, not encouraging. Challenge the assumptions, name the riskiest bets, and give a
clear verdict with reasoning. A list of explicit questions for you is in section 9.

---

## 1. What this is (honest snapshot)
A **warm, private, multi-caregiver family app**, currently shipped as **Cubby** (a baby tracker
PWA + marketing/SEO site) and expanding into an **ecosystem** under a planned master brand,
**Den** (a household OS):

- **Cubby** (live): feeds, sleep, nappies, pumping, growth (WHO/CDC), vaccines (12 country
  schedules), medicine, illness, photos, keepsakes, real-time family sharing. Web PWA.
- **Mommy To Be** (built, unmerged branch): full pregnancy journey, trying -> positive test ->
  week-by-week -> birth, antenatal schedules, gestational-diabetes/BP/nausea trackers, kick &
  contraction tools, an ultrasound "Moments" album, and a one-tap conversion into Cubby at birth.
- **Our Den** (built, dark behind a flag): household hub, chores, shopping, meals, home staff,
  expenses, adult weights.
- **Consent governance** (built): the data belongs to the household; bulk delete/export needs
  dual-guardian approval; removed members keep their log attribution.

**The strategic wedge:** family-organizer apps (Cozi, FamilyWall, Maple, Homsy) are calendars +
lists. None owns the **family health spine** (pregnancy -> birth -> baby -> vaccines -> growth).
Cubby starts from that trusted spine and expands outward into home management, the reverse of how
competitors would have to move.

## 2. Stage and honest status
- **Pre-revenue. Beta. Effectively a solo builder + AI agents.** No paid users yet (free beta).
- **We have NO validated metrics**: no real user count we are quoting, no retention, no
  conversion, no CAC, no LTV. Treat any number below as an *assumption to challenge*, not data.
- Built and shipping cadence is unusually fast because the stack is deliberately simple (see §5)
  and most "premium" features were already built before being monetized.

## 3. Business model
- **Free forever** for the trust/safety core (logging, sharing, vaccines, growth, danger signs,
  basic keepsakes). This is the acquisition + word-of-mouth engine; gating it would kill growth.
- **Base plan (built, not switched on):** "from $5/mo, billed annually ~$59/yr", 7-day free
  trial, one sub per household, localized (USD/GBP/EUR/AED/INR). Unlocks **zero-marginal-cost**
  delights: the full keepsake studio, watermark-free shares, premium fonts/palettes/formats/
  stickers, auto-enhance, background cutout, Then & Now, and a doctor PDF report.
- **Pro/Plus tier (future, ~$15/mo annual / $19/mo):** the cost-heavy features, HD photo backup,
  push notifications, smart adaptive routines, sleep/feed insights. Held back until demand + costs
  are proven.
- **Ecosystem cross-sell:** Mommy To Be acquires users ~9 months earlier than a baby app and
  converts to Cubby at birth in-product (a screen transition, not a re-acquisition). Den (home
  management) widens share-of-wallet later.

## 4. Competitive context (researched, 2026)
- **Huckleberry**, Plus ~$11.99/mo (~$69/yr), Premium ~$14.99/mo; data-driven sleep guidance is
  the clearest thing parents pay for.
- **Glow Baby**, free w/ ads, Premium ~$9.99/mo. **Nara Baby**, freemium, strong meds.
- **Family orgs**, Cozi (incumbent), FamilyWall (~$4.99/mo, 5M+ installs), Maple, Homsy, Nori.
- **Pregnancy**, Pregnancy+/BabyCenter/What to Expect dominate content; thinner on the
  health-tracking + lifecycle-continuity angle.
- Takeaway used here: **lead paid tiers with genuine utility (sleep/health), not gimmicks**; we
  intentionally deferred the cost-heavy sleep/insights to the higher tier and launch Base on
  cheap-to-serve keepsakes to prove willingness-to-pay first.

## 5. Cost structure (the crux of the funding question)
Deliberately near-zero, by design:
- **Hosting:** Cloudflare Workers static assets, effectively free at this scale.
- **Backend:** Firebase **Spark (free)**, Google auth + Firestore. Photos are ~560px base64
  thumbnails stored *in Firestore* (no Firebase Storage, no Blaze). Free-tier ceilings: 1 GiB
  stored, 50k reads/day, 20k writes/day.
- **Payments:** the billing Worker runs on Cloudflare's free tier. Stripe takes ~2.9% + $0.30
  per charge (≈ $2 on a $59 annual sub -> ~$57 net).
- **Base Pro features cost us $0 per user** (all client-side / on-device).

**Where real costs appear (and only then):**
1. **Firestore free-tier ceilings.** At some active-user count, reads/writes/storage exceed Spark
   and you must move to **Blaze (pay-as-you-go)** or optimize. Blaze is cheap per unit but it is
   no longer $0, and it requires a card on file.
2. **HD photo backup (future Pro/Plus):** needs object storage. Plan = **Cloudflare R2**
   (~$0.015/GB/mo, $0 egress), e.g. 100 families x 2 GB ≈ ~$3/mo. Cheap, but non-zero.
3. **Push notifications (future):** FCM is free to send, but scheduled server-side sends need a
   tiny always-on sender (a Cloudflare cron Worker, still ~$0) and Blaze if done via Firebase.
4. **Growth, not infra, is the real spend:** ASO, content/SEO (already a strength, ~$0 in cash),
   and any paid acquisition. App Store ($99/yr) + Play ($25 once) for native distribution.

**Rough unit economics (ASSUMPTIONS, challenge these):**
- Net revenue per paying household ≈ **$57/yr** (annual Base after Stripe).
- Marginal serving cost per free user ≈ **$0** today; per Base-Pro user ≈ **$0**.
- Therefore gross margin on Base is ~100% minus payment fees until Firestore tips into Blaze.
- Implication: the model is **structurally cheap to run**; the binding constraints are
  **distribution (can we acquire users cheaply?)** and **conversion (will free users pay $59/yr
  for keepsakes + reports, or only for the deferred sleep/insights?)**.

## 6. The "do we need more dough?" framing
Three honest paths for the reviewer to weigh:

- **(A) Bootstrap on free tiers + organic.** Keep infra at ~$0, grow via SEO/content (12 vaccine
  schedules, a large article library, a Product Hunt kit are already built) and ecosystem
  cross-sell. Capital need: ~$0 + the founder's time. Risk: slow; organic may not reach the scale
  where $59/yr x conversion is meaningful income; founder time is the real cost.
- **(B) Light spend to de-risk.** Small budget for ASO, a designer pass, maybe modest paid
  acquisition tests to measure CAC vs the $57 net LTV. Capital need: low-thousands. Buys data on
  whether paid growth is viable before committing.
- **(C) Raise to accelerate.** Fund native apps, the cost-heavy Pro/Plus tier (sleep insights,
  HD/R2, push), and real marketing. Capital need: meaningful. Only justified if the wedge +
  ecosystem can plausibly become venture-scale, and if early conversion data supports it.

The build is engineered so **(A) and (B) cost almost nothing in infra**, the question is whether
the *outcome* (revenue, reach) justifies staying lean or warrants (C).

## 7. Key assumptions to test (we believe these; we have not proven them)
1. Parents will pay **$59/yr for keepsakes + watermark-free + a doctor PDF** (Base), not only for
   sleep guidance (the proven paid feature, which we deferred to Pro/Plus).
2. The **pregnancy -> baby lifecycle** meaningfully lifts LTV and lowers re-acquisition.
3. The **health spine -> home management** expansion is a real moat, not scope creep that dilutes
   focus.
4. **SEO/content + ecosystem cross-sell** can drive enough cheap acquisition to matter.
5. Staying on **free/cheap infra** is sustainable through early growth (no forced Blaze cliff that
   breaks the $0 story at an awkward moment).

## 8. Risks / open concerns (be harsh here)
- **Conversion risk:** Base sells cheap-to-serve perks; the feature parents most reliably pay for
  (sleep/insights) is *not* in Base. Are we monetizing the wrong tier first?
- **Focus risk:** one builder spanning baby + pregnancy + home + payments. Is the ecosystem
  ambition spreading effort too thin vs nailing one wedge?
- **Brand risk:** "Mommy To Be" is a generic, weakly-protectable phrase; "Den"/"Cubby" hold the
  defensible equity. Naming is settled but trademark depth is shallow.
- **Platform risk:** PWA-first; iOS distribution needs a Capacitor wrap + Apple requirements
  (Sign in with Apple, IAP cut, health-app review). Not yet built.
- **Enforcement gap:** consent + Pro entitlement are server-checked via rules, but deeper
  tamper-resistance (and any server-side consent) would need Cloud Functions/Blaze later.
- **Single-maintainer / bus-factor**, and no validated demand signal yet beyond a waitlist.

## 9. Questions for you, the evaluator
1. Given the cost structure, is **(A) bootstrap, (B) light spend, or (C) raise** the right call,
   and what specific evidence would move you between them?
2. Is launching **Base on keepsakes** (cheap to serve) before **Pro/Plus on sleep/insights** the
   right monetization order, or should we lead with the proven-to-pay feature even at higher cost?
3. Is the **ecosystem (baby + pregnancy + home)** a genuine moat, or should we concentrate on one
   wedge until it has traction? Which wedge?
4. What is the **single most important number to measure first** to validate or kill this, and how
   would you instrument it cheaply?
5. At what scale does the **free-tier infra story break**, and does that timing create a funding
   need we are underestimating?
6. Is **$59/yr** right for this audience and feature set, or is there a better price/packaging?
7. What would you **cut** to go faster?

## 10. Pointers (if the reviewer wants the source of truth)
- `README.md` (architecture) · `ECOSYSTEM.md` (the Den vision, naming decisions; on branch
  `pregnancy-tracker`) · `PRO.md` + `PAYWALL.md` (monetization) · `MONETIZATION-HANDOFF.md`
  (payment loop) · `PREGNANCY-HANDOFF-V2.md` (pregnancy track) · `CONTENT*.md` / `SEO*.md`
  (the organic-growth engine) · `PRODUCTHUNT.md` (launch kit).
- All revenue/cost figures above are **planning assumptions**, not measured results. There is no
  live revenue and no quoted user base. Please treat them accordingly.
