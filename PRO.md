# Cubby Pro — monetization research & roadmap

Status: **waitlist only.** Nothing is built or charged. This captures the research behind the
Pro waitlist so we validate demand before building.

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
1. **HD photos & unlimited storage** — full-res photos + unlimited album (free keeps light
   thumbnails). Maps to the Firebase Storage cost we deferred.
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

## Pricing hypothesis (validate, don't commit)
- Undercut Huckleberry: **~$4.99/mo or ~$39/yr**, family-friendly (covers the whole household).
- Possibly a one-time "lifetime/keepsake" option for photo storage.
- Keep the free tier genuinely good so Pro is a delight, not a hostage.

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
