# Cubby Pro: paywall candidates (living list)

> **Status (June 2026):** Cubby Pro is ONE tier ($9/mo or $90/yr); the v1 paywall is built and wired with try-before-buy tasters, currently behind a "Register for Pro" gate until the Oct 2026 billing go-live. Full current state + go-live plan: HANDOFF.md.

> ## ⚑ CURRENT PRICING (authoritative, 2026-06-13)
> Cubby Pro is **ONE tier: $9/month or $90/year** (save 17%, ~$7.50/mo effective), 7-day free trial.
> Localized: USD 9/90 · GBP 7/70 · EUR 8/80 · AED 33/330 · INR 749/7490. This **supersedes** any
> "Base"/"Pro-Plus"/$5/$15/$19/$59 wording below (historical). The gated feature set below still
> applies; only the price/tier-name is unified. Numbers live in `pricing/index.html` `CUR`.

> **June 2026: the v1 Base paywall is BUILT and wired** (see PRO.md status + the launch
> checklist in `workers/pro-billing/README.md`). Live gates: portrait/story formats, premium
> fonts (all but Fraunces), premium palettes (Sage/Sky/Ink), Big-milestone + Monthly-stats
> templates, stickers beyond the first six, auto-enhance, background cutout, Then & Now,
> the "made with Cubby" watermark (Pro removes it), and the new doctor PDF report. Free keeps
> a generous taster: Original+Square, Fraunces, two palettes, Classic, six stickers, the text
> visit summary, JSON export.
>
> **Pro tasters (June 2026): try-before-buy is live.** Premium styles apply freely on the
> studio canvas (golden ✨ chips, no interrupt) and saving keepsakes in-app is unlimited;
> the gate sits at *export*. Free quotas (`PRO_TASTE` in `app/index.html`, counts synced in
> `state.settings.proTaste`): 3 premium-styled downloads/shares (one charge covers a whole
> editing session), 3 auto-enhances, 3 background cutouts (refunded on failure), 1 Then & Now,
> 1 doctor PDF. All free exports keep the watermark, now "made with Cubby 🐻 · little-cubby.com"
> (the viral lever). When a quota runs out the Pro sheet opens with "You've enjoyed your free
> tastes of X". Studio + memory cards have a "Share · Instagram-ready" button (native share
> sheet with the image file → IG Stories/Feed); the Story format chip is labelled "Story · Insta".

> **Pre-launch gate (2026-06-13): "Register for Pro", launching October 2026.** Payments are not
> open yet (needs a UAE trade/freelancer license + Lemon Squeezy (MoR) setup, weeks out). So the Pro
> sheet, with `PRO_CFG.checkoutUrl` empty, presents a **"Register for Pro"** button (writes the
> `waitlist` collection + `localStorage.cubby-pro-waitlist`) and shows the **October 2026** launch
> window. The free tasters stay live as the hook: users try a treat a few times, hit the wall,
> and register. Single source of truth for the date is `const PRO_LAUNCH` in `app/index.html`;
> the "soon" badges on `/`, `/pricing/` and the in-app landing now read "Oct 2026". To go live:
> set `PRO_CFG.checkoutUrl`/`portalUrl` (Lemon Squeezy MoR worker; the legacy Stripe worker is the alternate), and the
> sheet flips from register to sell automatically.

A running list of what we *could* put behind Cubby Pro, updated as we build. This is a menu to choose from later, not a commitment. Pricing/flow is designed separately (see PRO.md when we get there). Competitor signal: Precious charges ~$4.99/mo for AI photo art and parents pay, so keepsakes/AI are proven willingness-to-pay.

## Guardrails (free forever, never paywall)
These are the trust + word-of-mouth core. Gating them would kill adoption.
- Logging feeds, sleep, nappies, pumping (unlimited)
- Multi-caregiver real-time sync + invites + handoff notes
- Vaccine schedule + due dates + in-app reminders
- Growth charts (WHO/CDC)
- Pregnancy core: week-by-week view, antenatal schedule + appointment reminders, danger signs, basic logging (symptoms/weight/BP), kick counter, contraction timer, birth plan + hospital bag, and the birth → baby transition. This is trust/safety and the front of the lifecycle, so it stays free. [built]
- Basic photo save + at least one free share format/template
- Privacy (no ads, no third-party trackers) stays true regardless of tier

## Pro candidates (grouped)

### Moments / keepsakes  ← strongest paid pull (Precious's territory, but private)
- [built] **Share-card templates**: Big milestone, Monthly stats (real data) — keep Classic free, gate advanced
- [built] **Instagram formats**: Story (9:16), Portrait — could keep Square free, gate Story/Portrait
- [built] **Premium fonts & palettes** — keep 1–2 free, gate the rest
- [built] **Auto-enhance** (one-tap, on-device) — could be a free taster or a Pro perk
- [built] **Activity-photo "Make a moment"** — free to capture; gate premium output (formats/templates)
- **"made with Cubby" watermark**: free cards carry it (free advertising); Pro removes it ← clean, gentle lever
- **Free-tier volume cap**: e.g. N premium share cards / month free, unlimited on Pro
- [built] **Background cutout / "sticker-me"** (on-device MediaPipe, lazy-loaded, nothing uploaded) — Pro
- [built] **Then & Now** card (share + download) — could keep free or gate
- [built] **Sticker pack** (tap-to-place emoji stickers, all formats) — keep a few free, gate the full set
- High-res export of birth poster / growth collage / monthly cards — Pro
- Monthly video montage — Pro (heavier; later)

### Pregnancy (core is free; these are later Pro candidates)
- PDF antenatal/birth summary for the doctor (the pregnancy record as a clean export) — Pro
- Premium birth-plan export / shareable birth announcement card — Pro
- Advanced pregnancy insights (weight/BP trends, kick/contraction history views) — Pro

### Health / data
- PDF doctor visit reports + full data export — Pro
- HD photos & cloud backup (beyond the free base64 thumbnails) — Pro (has real storage cost; see EMAIL.md/R2 notes)

### Routines (flagship Pro, see ROUTINES.md)
- Smart adaptive routines, day 0 to 365 — Pro

### Notifications
- Push notifications / reminders when the app is closed — Pro (needs infra; currently in-app only)

### Insights
- Sleep & feed pattern insights, trends, predictions — Pro
- **Nutrition tracker** — turn logged meals + meal photos into a nutrition view over time (what was offered vs eaten). Free: log meals + photos. Pro: the nutrition analysis. [meal photos shipped]

## Levers (how to gate, not just what)
1. **Feature gate** — whole feature is Pro (routines, PDF export, push).
2. **Watermark** — free output is marked; Pro is clean. (Great for moments: free posts market Cubby.)
3. **Volume cap** — free gets N/month; Pro unlimited.
4. **Quality/format gate** — free gets standard; Pro gets HD / extra formats.

## v1 "Base" plan mapping (next venture)
The first paid tier is a single cheap entry plan with a 7-day free trial (pricing now unified to
**Cubby Pro $9/mo or $90/yr** per the banner above; the "$5/$59" figures below are the historical
rationale, kept for the tier ladder in PRO.md). To protect margin, the
v1 plan gates only **zero-marginal-cost** features (on-device or client-generated):
- **In Base v1:** premium share-card templates, premium fonts & palettes, Instagram Story/Portrait
  formats, "made with Cubby" watermark removal, full sticker pack, Then & Now, Auto-enhance,
  background cutout, plus doctor **PDF report + data export**.
- **NOT in Base (hold for a later higher tier):** HD photos & cloud backup (R2), push
  notifications (Blaze), smart routines, sleep/feed insights, nutrition analysis, video montage —
  i.e. anything with per-user infra cost.

## Referral rewards (designed 12 June 2026, plumbing shipped, rewards NOT live)
What exists in code: each member has a deterministic short code (djb2 of uid, base36, 6 chars,
shown via Settings "Share Cubby"); `?ref=` on the marketing home or /app/ is stored in
localStorage; on a brand-new family's first sign-in (fresh-household path only, never invited
caregivers) the code is written to `users/{uid}.referredBy`. No reward is promised anywhere yet.
At Base-plan launch: count `referredBy` per code (offline via tools/analytics.js, codes are
recomputable from uids), grant retroactive credit, suggested: **1 free month of Base per referred
family that's still active at launch, capped at 6**. Announce only when redeemable.

## Notes
- Keep anything requiring paid cloud infra (push, HD storage, generative AI) clearly on the Pro side, since that's where the cost is, and it justifies the price.
- Do NOT add generative AI art that uploads baby photos to a third-party API; it breaks the privacy promise. On-device AI (auto-enhance, cutout) is fine.
