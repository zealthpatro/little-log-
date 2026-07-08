# Cubby UX Roadmap (from the 2026-06-22 multi-agent audit)

6 dimensions audited, findings adversarially verified. Severity: P1 = feels broken / a basic that can't be missing; P2 = clarity/polish/leak. Effort S/M/L. **Nothing is a true blocker (no P0)** — the "feels broken" items are the P1s.

## Founder's 3 flagged areas — all confirmed
1. **Gate / first-run is disordered** → G1, G2, G3
2. **Cramped multi-step flows** → F1 (+ F2–F5)
3. **Weak sharing** → S1, S2 (+ S3–S6). Native share exists for keepsakes but is missing on the 3 highest-intent surfaces: family invite, guess-game link, guest game page.

## P1 — ship next
- **G1 (L)** First-run name/relationship modal fires *over* the "where are you on the journey?" question (`maybeFirstRun` right after `render()`). → one ordered wizard: stage → member setup → install. `store-firebase.js` ~585-600/1019-1070, `index.html` ~1195. **The "nonsensical gate" you felt.**
- **G2 (S)** No privacy line at the sign-in moment (privacy is the wedge, absent at the decision). → one trusted line under the buttons + a caregiver-scoped variant. `store-firebase.js` 206-214, `landing.js`.
- **G3 (M)** Apple/email sign-in injected via `insertAdjacentHTML` after Google → feels hidden. → render all three upfront in `cubbyLanding()`. `landing.js`.
- **F1 (M)** "We're trying" setup crams LMP + cycle + 6-task checklist + fertile estimate on one screen. → split into entry → preview; skip fertile-window if no LMP. `index.html` 3607-3691.
- **S1 (S)** Guess-game link is clipboard-only → add `navigator.share`. `index.html` 3901.
- **S2 (M)** Guest page `/g/` has no share button → loop dead-ends. Add native share. `g/index.html`.
- **C1 (S)** Tapping a nav tab leaves the open sheet on top (`go(v)` never `closeSheet()`). `index.html` 2021.
- **C2 (M)** Tapping the scrim discards an unsaved draft, no warning (3am case). `index.html` 897.
- **A1 (M)** No `:focus-visible` anywhere; `.field input:focus{outline:none}` strips it (WCAG 2.4.7). `index.html` 362, `site.css`.
- **A2 (S)** Date-picker disabled dates ~3.2:1 contrast. `index.html` 344/356.
- **A3 (S)** Sheet close/back buttons <44px + faded. `index.html` 309-312.
- **L1 (L)** **Pregnancy loss flow** (`endPregnancy`, 4422) just toasts + drops back into the live app — a direct loss-safety (charter) violation. → gentle holding screen, suppress pregnancy view/tips, mute notifications, support link. **Most important morally.**
- **M1 (M)** Marketing home speaks only to babies; pregnant visitors routed via fine print + no "what happens next." → hero + stage bridge, micro "what's next" on /how-it-works + /pregnancy.

## P1+ — founder-flagged pregnancy-view items (caught directly, audit under-weighted)
- **PV1 (M)** **Moments is a permanent bottom-nav tab** (Week/Log/**Moments**/Tools/Care) but empty most of pregnancy → tapping it = a blank "Nothing here yet" page = unwarranted prime real estate. → demote from a tab to a card on the Week home (populated strip / gentle prompt, never blank); 4-tab nav. `index.html` 3828-3834, 3696, 3865.
- **PV2 (S)** **"Family games" card sits 3rd on the pregnancy home from week 0, always** — a confetti games card pushed at an anxious parent reads as random. → move off the prime home into the Tools tab. `index.html` 3865.

## P2 — clarity / polish / leak-plugging
**Flows:** F2 equal-weight 3-way onboarding cards (3393) · F3 split expecting LMP/due flows (3580) · F4 positive-test as a real prominent step, prefill (3647) · F5 add-baby shouldn't force invite first (2562) · N1 make pregnancy⇄baby switch first-class + loss-safe (2536).
**Sharing:** S3 native share on family invite (store-firebase copyAppLink) · S4 email invite missing `?ref=` · S5 keepsake Share hidden on desktop — always render + fall to download (index 6586/7382/7458) · S6 explain "made with Cubby" before first share.
**Core:** C3 Undo toast on soft-delete (2503) · C4 cache per-tab scroll (6191) · C5 "view only" for other-author entries (2470) · C6 quick-log (+) on all views (1219) · C7 empty-state primary CTAs (1854/6516).
**States/a11y/marketing:** A4 loading/disabled states on sign-in/upload/sync · A5 plain-language errors + offline · A6 cycle the "setting up…" copy · M2 standardize CTA wording · M3 promote Why/How-it-works out of the soft About dropdown · M4 single Free-vs-Pro source of truth · M5 a "built with care" trust block near CTAs.

## Already done / dropped
- `switchBaby()` already calls `closeSheet()` (2547) — drop that finding.
- The audit's lone "P0" (onboarding gate ambiguous) = clarity, tracked as F2.

## DO FIRST (audit's pick)
**G1** — collapse first-run into one ordered wizard (stage → member → install). It's the first thing every user hits, the most visibly "nonsensical," and unblocks G4/F4/M1 for free. Batch the S-effort wins alongside (S1, S2, C1, A2, A3 + PV2) — under a day, each removes a "basic that can't be missing."
