# Cubby Critique — Code-Verified Verdicts

**Verified: July 2, 2026 · Method: full source walk of the repo (`app/index.html`, `app/store-firebase.js`, `app/growth-data.js`, `vax.js`) — not memory, not old audits.**
Scope: every "gap/missing" claim from CUBBY-MEH-WOO-AHA-CRITIQUE plus the two §5 product-verify items. Each verdict cites file:line. What code can't prove (feel, pacing, deliverability) is flagged for a live walk.

---

## Verdict summary

| # | Claim | Verdict |
|---|---|---|
| 1 | No solo value before a 2nd caregiver joins | **REFUTED** |
| 2 | Care-circle invite buried, not at the aha | **REFUTED** (with a real friction finding) |
| 3 | Keepsakes are effortful, not auto-magic | **REFUTED** |
| 4 | No prediction/insight layer | **CONFIRMED** (+ a copy/product mismatch) |
| 5 | Growth chart missing head circumference | **CONFIRMED** |
| 6 | Vaccine schedule defaults to US/CDC | **REFUTED** (one edge case) |

---

## 1. Solo first-run aha — REFUTED

First run is stage-aware and lands on a home surface with immediate single-player value:

- Onboarding: "Where are you on the journey?" chooser (expecting / baby / trying) over a blurred preview of the real app — `index.html:3588-3601`. Loss-safe holding state exists too (`:3606`).
- Add-baby: name + optional birthday, optional sex (growth curves), country prefilled from pregnancy or auto-detect — `:2665-2705`.
- Home, solo, day one: "Get started 🐻" checklist (add baby → photo → first log → invite) that auto-hides when done (`:1385-1405`); one-tap log tiles; rotating tips ticker (`:1336`); time-aware greeting + nudge lines incl. the 3am line (`:1365-1376`); quote-of-the-day (`:1501`); localized vaccine plan generated instantly from birthday + country (`:5884-5891`).

**Code can't prove:** whether this *feels* like an aha in the first 60 seconds. That still needs the live walk. But "no value before a 2nd caregiver" is false in the current build.

## 2. Invite surfacing — REFUTED, but with the real finding

Invite is the **climax of onboarding**, not buried: the post-setup sheet's primary CTA is "Invite someone" for both baby and pregnancy paths — `:2709-2725`. It's also a Get-started checklist row (`:1403`), a recurring tip (`:1340`), a pregnancy hero card "Who's coming with you?" (`:4260-4262`), and Profile → Family & sharing (`:2963`).

**The actual friction (this is the Priority-B lever):** the invite is *email-bound*. Inviter types the invitee's email; a Firestore invite doc keyed to that email is created; invitee must sign in with Google/email-link using **that exact address** — `store-firebase.js:1228-1250, :380-387`. Delivery is mailto or manual copy ("Or use Copy above for WhatsApp/text"). There is **no wa.me deep link anywhere in the repo** and no email-agnostic invite link. For an India/UAE WhatsApp-first audience, "guess which Gmail nana uses" is the loop-killer — not invite placement.

Referral (distinct from circle invite, and the code comments distinguish them — `store-firebase.js:408`): `shareCubby()` builds a `?ref=` link from a deterministic uid hash and uses `navigator.share` (`index.html:3350-3368`); attribution is stored pre-sign-in and read at first sign-in (`:5839-5840`). A referral loop with attribution **already exists**.

## 3. Keepsakes — REFUTED (auto-magic is built)

- `memoryCandidates()` assembles **finished** cards from already-logged data — the code's own comment: "hand the parent a finished card built from data already logged" (`:7564-7590`).
- "Ready for you" rail of finished cards in Album (`:7593-7594`, CSS `:669`).
- Milestone reached → tap-to-keepsake nudge on home (`:1918`); monthiversary card prompts (`:1790`, `:1378`); birth poster (`:7586`); 289-card gentle moments catalogue (`:6078`).
- **Share loop already shipped:** free keepsake shares carry a "made with Cubby" watermark; Pro removes it (`:2848`, `:2889`). That's the viral stamp the critique asked to *design* — it exists.

## 4. Insight/prediction layer — CONFIRMED missing

Stats = descriptive only: 7-day averages + bar charts for feeds/sleep/nappies + growth curves (`renderStats`, `:2051-2085`). No nap-window prediction, no pattern inference, nothing Huckleberry-SweetSpot-shaped anywhere in the repo.

**Bonus catch — copy/product mismatch:** the FAQ schema on the app shell says "Pro adds extras like **insights** and exports" (`:43`), but the Pro perk list (`:2887-2890`) contains no insights (voice logging, doctor PDF, Then&Now, keepsake studio). Either build the insight layer or cut the word before launch — it's a promise-vs-delivery drift on a YMYL surface.

## 5. Head circumference — CONFIRMED missing

`GROWTH_REF` contains only `weight` and `height` for WHO and CDC (`growth-data.js:4`). Growth events log only weight/height (`index.html:2007`); the Measure action is labelled "Weight & height" (`:1899`, `:2211`). No HC anywhere. Pediatric visits in year one track HC at every checkup — this materially weakens the doctor-report Pro perk (`:2888`) too.

## 6. Vaccine country default — REFUTED

- 12 curated national schedules incl. India (IAP) + WHO general, each with cited official sources — `:5790-5835`.
- `baby.country` is set at add-baby with a country picker, prefilled from the pregnancy country or `detectCountry()` (`:2671`, `:2695`).
- `detectCountry()`: stored hint → `?c=` from the marketing vaccine pages (`:5838`) → browser locale → timezone → only then `'us'` (`:5844-5871`).
- Unknown/other countries resolve to **WHO, "never a US fallback"** (comment at `:5872`, `vaxCountryKey` `:5874`).
- Missing country triggers a tip nudging the user to set it (`:1343`).

**Edge case (one line, not a blocker):** a user whose locale/timezone match none of the 12 (e.g. `fr-FR`, Europe/Paris) with no stored hint bottoms out at `'us'` at `:5870` rather than `'who'`. Swapping that last-resort return to `'who'` is a one-word fix and makes the "never a US fallback" comment fully true.

---

## What still needs the live walk (auth-gated, founder drives)

Code proves structure, not experience: (a) first-60-seconds feel and pacing of onboarding; (b) invite acceptance end-to-end on a real second account (does nana survive the "sign in with THIS email" step?); (c) whether the Ready-for-you rail actually fires on a young account (candidates depend on logged data + baby age); (d) sign-in email deliverability via `/api/send-signin-link`.

## Direct implications for Priority B (referral-factor-5)

The critique's proposed capabilities are mostly **built**: invite-at-the-aha ✓, watermark share loop ✓, auto-magic memories ✓, solo first-run value ✓, referral attribution ✓. The two real gaps are the two the code confirms: **(1) email-bound invites with no WhatsApp-native path** — the single highest-leverage growth fix — and **(2) no insight layer**, which is also the only place the marketing copy outruns the product.
