# UX simplification plan — synthesis of the 2026-08-03 flow audits

Inputs: six read-only flow audits (first-run, logging, moments, pregnancy, care, circle) plus the
Flo trying-stage competitive research. Overlapping findings are deduped into themes; every claim
keeps its file:line citation (paths relative to repo root; line numbers as of the audit snapshot —
re-verify before editing, `app/index.html` moves often). Ranking is pain-per-effort under the
Experience Charter's Anxiety Test.

---

## 1. Top 10 simplifications (ranked by pain-per-effort)

### 1. Medicine tells the truth (care #1 + #2 + #5)
Highest absolute pain in the app, mostly small fixes, all in one subsystem.
- **Reminder storm:** `medNextDue` returns `now()` for a never-dosed "Every X hrs" medicine
  (app/index.html:6279), so `checkMedReminders` (6405-6417) on the 1s tick (2440, 2450) re-fires
  forever: toast pinned permanently (1235-1237), an OS notification per second (6412), a
  `persist()` per second (6416). Remind defaults on and everyX is the default pattern (6335) —
  this is the happy path ("add tomorrow's antibiotic tonight → nagged all night").
  **Change:** with no dose logged, render "Log the first dose to start the schedule" instead of a
  due time; guard `checkMedReminders` for that state; notify at most once per due event.
- **Vanishing missed dose:** the "Set times" branch only reports a slot within 60s of passing
  (6289), then rolls to the next slot (6292-6294); the card then reads "Next 8:00 AM · in 11h"
  (6316) as if tonight's dose was handled, while everyX meds show red "overdue" indefinitely
  (6315, 1934). **Change:** show a calm "8:00 dose not logged yet" line — a quiet fact, not a red
  nag (see do-not-do list).
- **Broken PDF schedule:** the doctor report reads `m.everyH` (6640), a field that doesn't exist
  (schema is `m.pattern.hours`, 6277, 6335) — the Pro-anchor artifact prints medicines with no
  schedule. **Change:** use the existing `medScheduleText` (6302); same for the plain visit
  summary (6605). One line.

### 2. No one-tap permanent deletes, anywhere (moments #1, pregnancy #1, logging #5, care #3)
The single biggest deduped theme: the irreplaceable things have the least protection, while feed
events already have the right pattern (confirm sheet + recoverable soft-delete,
app/index.html:2932-2943, 2959-2971; `confirmSheet` at 2485/2512).
One tap, no confirm, no undo today: keepsake photos (8920 → deletePhoto 8987), monthly photos
(9113, 9126), journey moments + their photo (7532 → 7575), milestones (7675 → 7704), Together
photos (3193), **a lost pregnancy's kept scan photos** (`removeKeptMemories` 5743-5746, fired
straight from the ghost button at 5741), notes (1868-1869 → 1876-1879 → hard Firestore delete
app/store-firebase.js:1157-1164), medicines (6369 → 6391-6394), vaccines incl. given-date history
(7195 → 7227), illness (6511 → 6514), rituals + done-history (8217 → 8298-8306).
**Change (phase 1, cheap):** route every destructive tap through the shared `confirmSheet` — the
kept-memories-after-loss case ships first. **Phase 2:** extend soft-delete / "Recently deleted"
to photos and notes; and give "Recently deleted" a door near the timeline (today it hides inside
the baby switcher, 2974-2977, while renderLogTab 8280-8289 never mentions it — logging #8).

### 3. Voice logging never loses what she said (logging #4 + #3 + #11)
- **Silent nothing-logged:** `parseVoice` always offers "End the nap · now"
  (app/voice-log.js:57-58); on save `stopSleep` early-returns when no timer exists
  (app/index.html:2783) and the sheet closes with no toast (voice-log.js:117). A
  believed-logged-but-lost health entry is the worst failure class in a shared log.
  **Change:** only offer the option when a timer exists (else offer a plain "log a nap"); always
  toast the outcome.
- **"Not right? Edit" starts over blank:** `voiceEditManually` routes to
  openFeed/openDiaper/openPump/openSleep (voice-log.js:205-212), which reset drafts to defaults
  (app/index.html:2545, 2830) — parsed amount/side/duration all dropped, and the parser misreads
  times as amounts ("fed her at 3" → "Bottle · 3ml", voice-log.js:24, 77-88), making this the
  likely path. **Change:** pass the parsed draft in as prefill.
- **Copy:** "Saved as a note?" reads as already done — "Save it as a note?" (voice-log.js:235).

### 4. Sign-in first touch: quiet cancels, visible progress (first-run #1 + #4)
- Backing out of the Google/Apple popup on web shows "Sign-in failed: The popup has been
  closed…" on the very first screen — `auth/popup-closed-by-user` is missing from the silenced
  list on the web paths (app/store-firebase.js:426-432 Google, 439-445 Apple) though native
  silences cancels carefully (398-410). **Change:** add it to the silenced set.
- Tapping the primary sign-in button gives zero feedback: `signInGoogle` only disables
  `#llGoogleBtn` (423-424), which exists solely on the fallback auth-card (266-272); every
  production landing uses id-less `.ll-cta` buttons (app/landing.js:33). Tap → nothing for 1-3s →
  second tap → `auth/cancelled-popup-request` → surprise full-page redirect (427-429).
  **Change:** disable + spinner on the tapped button itself.

### 5. Charter-critical leaks: gentle modes, loss exits, the mood deep link (pregnancy #2, #3, #4, #9; first-run #6)
- **Moments ignores both gentle modes:** `renderPregMoments` shows "N weeks to go"
  unconditionally (app/index.html:4696-4700) and `renderPregLibrary` repeats it (7599-7600, 7614)
  against quiet mode's "Hide week counts" promise (5870) and the deliberate no-countdown decision
  (4974-4975); after-loss mode still gets "on the way to meeting them" (4700) and the party-emoji
  games card (4702). **Change:** gate week counts and happy-ending copy on both modes, as home
  already does (4986, 4897).
- **Loss-holding exit is an unlabeled one-way door:** "When you're ready" (4201);
  `endLossHolding` (4213/4240) clears instantly, no confirm, no way back, and lands on the upbeat
  chooser (4157-4161). **Change:** say the destination and confirm ("Ready for a new chapter? You
  can't come back to this screen").
- **Mistaken close forces the bereavement screen:** `endPregnancy` seeds `lossHolding` for every
  non-planning close with no babies (5717-5724) and the confirm sheet (5684-5691) has no "I set
  this up by mistake" path. **Change:** add that option; it skips the grief framing (4195-4196).
- **Mood deep-link privacy gate:** `?go=mood` maps straight to `openMoodNote` (1413) with no
  carrier/owner gate (5255-5266) while the home card is gated (5003) — any member can write into
  the owner-only "never shared" category. One-line gate on the most protected data.

### 6. Pro tastes: charge on delivery, never strand (pregnancy #5, moments #3, logging #2)
The taste system's rule should be: never spend a taste before value is delivered; always leave a
free door — especially pre-launch, when the Pro sheet can only say "arrives August 2026"
(checkoutUrl:'' app/index.html:3205; 3263-3266).
- Doctor report calls `useTaste('pdf')` on open, before rendering (5425; `pdf:1` at 3223) — one
  peek-and-close burns it, then visit-prep dead-ends mid-appointment (4401, 5479).
  **Change:** consume on Print/Share; `refundTaste` (3235) on failure.
- Then & Now charges the taste (9300), then waits on two Image loads with **no onerror** behind
  the no-timeout, no-dismiss loader (9301-9304; showLoader 1243-1251; hideLoader only inside
  drawThenNow 9333) — a missing-bytes tile freezes the app with the free try spent
  (`thennow:1`, 3250). **Change:** onerror → hideLoader + refund; fix makeCollage's silent-no-op
  cousin (9352-9357).
- Voice save at the taste wall confiscates a successful parse (voice-log.js:189-196;
  app/index.html:3223-3228): the free "Save as note" path only appears on parse *failure*
  (voice-log.js:234-239). **Change:** offer it alongside the Pro sheet on success too.

### 7. Edit can fix the mistakes people actually make (logging #1 + #7)
The edit sheet exposes only time-of-day (app/index.html:2913) plus amount/notes for a few types
(2904-2908). Wrong date, a sleep's wake time/duration (`saveEdit` shifts `end` by the same delta,
preserving the wrong duration, 2924-2925), nursing duration, diaper kind, bottle content — every
one ends in delete + re-log. **Change:** use the shared `openWhenPicker`
(app/cubby-extras.js:235) for date+time and add per-type fields (sleep end, diaper kind, feed
method/duration). Sibling: past nursing feeds are only 5/10/15/20/30/45 min instant-commit chips
(2667-2670) — add the standard stepper/free entry and stop committing on the first tap.

### 8. Saves that never hang, errors that speak human (circle #2; first-run #8, #3; circle #10; logging #10)
- **Adopt the 6s optimistic-exit** the codebase already invented for openFirstRun
  (app/store-firebase.js:1696-1708) in `submitInvite` (1807-1813), `saveMyRelationship`
  (1751-1757), and `savePick`'s unguarded await (app/cubby-extras.js:154) — which also never
  refreshes the `#llFrBear` preview in the still-open identity modal (store-firebase.js:1648,
  1671; cubby-extras.js:147-166).
- **Translate raw errors:** boot shows Firestore's "client is offline" jargon
  (store-firebase.js:1914); email-link (225, 234-235 — a bare `window.prompt`, cancel = silent
  dead end, 245) and invite errors (1835, 1863, 1757) surface `e.message` verbatim.
  `doDeleteAccount` already shows the house style (app/index.html:3911-3916). Detect offline →
  "You look offline — Cubby will pick up when you're back."
- **permission-denied is not offline:** `pushNow` retries a rules-denied write forever with
  "we'll try again" (store-firebase.js:1229-1241) — untrue for a removed member; give the entry
  an honest state and a door.

### 9. The invite loop: visible, revocable, honest (circle #1, #3, #12)
- Pending invites are invisible and irrevocable: `submitInvite` writes `invites/{email}`
  (app/store-firebase.js:1809-1813) but `openFamily` renders only joined members (1537-1544) —
  after inviting Nana the modal still says "Just you so far" (1544); no cancel; the doc grants
  join rights forever (only removed when deleting a joined member, 1729). `_lastInviteEmail` is
  page-session-only (1772), so after relaunch Share refuses with "Create an invite first"
  (1779-1784). **Change:** render pending invites with a cancel action; persist the last invite
  for re-share.
- `inviteText` promises "feeds, naps and nappies… You'll see everything, live" (1764-1770) even
  for an owner-private pregnancy circle whose recipient lands on "There's nothing for you to set
  up" (app/index.html:4209). **Change:** stage-aware invite text.
- Placeholder "their-google-email@gmail.com" (1559) implies Google-only at the exact field where
  Apple Hide-My-Email mismatches are born (846-879). Neutral placeholder + one-line hint.

### 10. Right defaults, honest numbers in the everyday surfaces (logging #6; care #6; moments #8)
- `openFeed` hardcodes `amount:120` whatever the unit — an oz household opens every bottle at
  "120 oz" (app/index.html:2545); post-6-months the sheet defaults to Solids and demotes milk
  below Water (2542-2544, 2563-2564); pump resets to 60 (2830). **Change:** default to last-used
  method/amount/unit — a tap-plus-correction off the most frequent flow in the app.
- Stats averages divide by a fixed 7 days (2405-2407) — a day-2 family reads "underfed,
  underslept baby". **Change:** divide by days-with-data or label "this week so far".
- The memory card proudly prints "0.0 feeds per day · 0 nappies" for an unlogged month
  (monthStats 9003-9013 → 9217-9219; explicit all-zeros fallback 7953). **Change:** suppress or
  soften empty stats — a keepsake must never read as a report card of failure.

### Next tier (deduped, kept for later batches)
- Unsynced photos (>990KB kept local, app/store-firebase.js:1470-1474, metadata still syncs 629)
  render as permanent blank tiles for other caregivers (app/index.html:8321-8322 vs the filtering
  list at 8323; also 9049, 9164) with dead-end share (8912-8915, 8973-8985) — needs a "still on
  Mama's phone" placeholder, then a real sync path. (moments #2)
- Caregiver waiting screen has no door — no Settings, no account deletion (App Store 5.1.1(v)
  risk) (app/index.html:4197-4213, gated 1450). (circle #4)
- Focused invite sheet instead of the Family & sharing mega-modal (app/index.html:3077, 3084,
  3751 → app/store-firebase.js:1531-1591). (circle #5)
- Searchable-picker standard: relationships ×3 (app/store-firebase.js:1507, 1550, 1560, 1674) and
  solids units (app/index.html:2628-2630, 2711) vs `searchPickerHtml` (4330). (first-run #10,
  logging #12, circle #11)
- Studio calm-down: pin Save/Share above the ~13 chip sections (app/index.html:8361-8400), a top
  close affordance + confirm on "Discard & start over" (8911, 8393-8400, 7994), stop silently
  baking filter/frame/stamp into gallery saves (8412-8415, 8894-8899), `img.onerror` in the four
  silent loaders (8408-8421, 8950-8962, 9168-9171, 9420-9423), keepsake bridge from viewPhoto
  (8916-8920). (moments #4, #5, #6, #7, #10)
- Backdate temperature/symptoms via the shared `timeStrip` (app/index.html:6540, 6707, 6522-6534,
  6692-6704; growth already has it, 6795); the two one-off native time inputs (6348, 8268).
  (care #7, #8)
- Labour tools: persist `kickSession`/`contractionRunning` (app/index.html:5318, 5336) and tick
  the frozen timer lines (5355, 5325). (pregnancy #7)
- Reminder copy alignment on the honest Settings wording until REMINDERS_LIVE flips
  (app/index.html:6366, 6371-6374 vs 3580-3581 vs 8224; Settings over-promise 3766 vs 3688-3690);
  quiet hours editable (3577, 3584); denied-path copy (3634, 3642); consent "Asked X to agree"
  honesty (4032, 4100-4128). (care #4; circle #6, #7, #8, #9)
- Mic should not start hot on open — make the big mic button the explicit first start
  (app/voice-log.js:152-156, 243). (logging #9)
- Small first-run batch: positive test demands LMP with no one-door alternatives
  (app/index.html:4630-4643 vs 4564-4565); "Back" on We're-trying lands on "You're expecting"
  (4620, 4589); "Congratulations 🎉" on the LMP mode (4584); add-baby "just a name" vs required
  birthday (3027, 3030, 3053, 3055); invite CTA silent no-op guard (3077, 3084).
  (first-run #2, #5, #7, #11; pregnancy #6)
- Misc: guess-game offline placeholder + non-owner share button (app/index.html:5128, 5100, 5072;
  5144, 5055); growth sex normalisation (6841 vs 6818); openPrintable popup-blocked → saveFile
  fallback (6674-6675, 6668-6672); Growth link from Health (2418, 6439, 6798-6807); flowsheet and
  vaccine-sheet plain-word glosses (4424-4431, 5168, 5652, 5159; 7218, 7219, 7231);
  Instagram-ese in share CTAs (8397, 9260, 9336, 7768, 8372); timerBanner stray `()` nit
  (1910-1911, 2245).

---

## 2. Trying-stage additions (from the Flo research)

Cubby today: optional LMP + cycle length, one soft fertile-window card, preconception checklist,
positive-test conversion, weekly reads (`openPlanningSetup` / `fertileEstimate` /
`renderPlanningHome`, app/index.html:4602-4702); `savePeriodUpdate` overwrites the single LMP.
The wedge stays: refuse to predict; private-within-shared.

1. **Cycle history, not one overwritten date.** Keep the one-tap "My period started" but append
   each date (today `savePeriodUpdate` loses history). Show an honest range card: "Your last 5
   cycles ran 26 to 31 days." A range, never a dated forecast.
2. **Fertile window: opt-in, hideable on the card itself, always a rough range.** No "high
   chance" daily banners, never colour calendar days by chance; keep the honest-uncertainty copy
   ("even the best apps pick the wrong day most of the time").
3. **"Trying since" as a private doctor-compass.** Optional month, carrier-private; drives
   exactly one thing — surfacing the existing kind referral guidance (over a year, or six months
   if 35+) at the right time. No percentages, no peer comparisons, no "optimize".
4. **A tiny observation diary, not a prediction engine.** Optional "Today I noticed" for the
   carrier only (`viewerIsCarrier` guard exists): test results, body signs, free note. Never
   changes a prediction, never prompts, never shows empty-day gaps, never pushes.
5. **Honest look-back instead of forecast graphs.** One quiet retrospective card when a cycle
   completes: "That cycle was 29 days. You noted 2 things." Statements only about the past.
6. **TTC doctor report as the Pro anchor.** Extend the doctor-report muscle: cycle-length history
   and range, trying-since, observation log, checklist status, meds/conditions — worded to make a
   first GP or fertility appointment better. Gives the diary a purpose, not a habit loop.
7. **Two-week-wait care, never a countdown.** No test countdown, ever. One calm read at the right
   moment, and only when a period is later than her own longest recorded cycle, the soft line
   "a test might tell you more." No push.
8. **A real trying-stage home for the partner, without the carrier's data.** Use the existing
   circle: shared preconception checklist items a partner can own, "how to support" reads —
   while periods, window, and observations stay carrier-private with an explicit share choice.

---

## 3. Do not do (charter / loss-safety guardrails on this plan)

- **No predictions, ever, in trying:** no dated period forecasts, no "test in N days" countdown,
  no daily "high chance" banner, no chance-coloured calendar days, no peer percentages.
  Refusing to predict is the stated market position.
- **No streaks, prompts, or guilt** in the observation diary or anywhere else — no empty-day
  gaps, no "log your symptoms" nags, no engagement loops. Rituals' no-streak rhythm
  (app/index.html:8131-8146) is the template.
- **Do not remove the pregnancy library's deliberately hidden keepsake/share paths**
  (app/index.html:7534-7537, 7620-7624) or the look-back "show only what she kept" logic (7631)
  while touching moments — both are charter-aligned privacy by design.
- **Do not "fix" the set-times missed dose by copying everyX's infinite red "overdue" nag**
  (app/index.html:6315, 1934) — the truthful state must stay calm ("not logged yet"), and the
  reminder-storm fix must not become aggressive push (push = critical-only policy).
- **Do not make mood/wellbeing shareable** — owner-only forever; the deep-link fix (top-10 #5)
  tightens the gate, nothing loosens it.
- **Voice never auto-commits health entries** — the confirmation preview stays even as drafts
  get prefilled (top-10 #3).
- **No prod removals without founder OK:** the Photos/Memories/Moments naming consolidation
  (moments #9, app/index.html:7995-7998) is a nav/naming change — propose, get a yes, then ship.
  Same for trimming the Solids unit list (logging #12 option B).
- **Protect the verified-good states** during any refactor: the vaccine 5-state model where red
  is only parent-confirmed (7094-7103), the no-guilt catch-up card (7150-7163), uncoloured
  growth deltas (6893-6898), the caregiver un-tick guard (8166-8169), "Everyone's well"
  (6472-6473), the honest reminders hold (3568-3585), delete-account copy (3885-3932),
  invite-mismatch and access-lost recovery (app/store-firebase.js:846-901), diaper's 2-tap flow,
  and the mic-denied fallback copy (app/voice-log.js:247-249).
- **Do not ship new pixels/analytics** to "measure" any of this — first-party only.

---

## 4. Suggested first batch (one session, ship to live)

1. **Medicine truth** (top-10 #1): `medNextDue` never-dosed guard + notify-once in
   `checkMedReminders` (app/index.html:6279, 6405-6417) + the one-line PDF fix
   (`m.everyH` → `medScheduleText`, 6640, 6302). Kills the worst live behaviour in the app.
2. **Confirm the deletes, phase 1** (top-10 #2): wrap `removeKeptMemories` (5743-5746),
   `deleteNote` (1876-1879), `deleteMed` (6369), `deleteVaccine` (7195), `deleteIllness` (6511),
   and `removeRoutine` (8217) in the existing `confirmSheet` (2485). Soft-delete extension is a
   later batch.
3. **Silent failures** (top-10 #3 + #4): stopSleep no-timer guard + outcome toast in the voice
   flow (app/voice-log.js:57-58, 117; app/index.html:2783); silence `auth/popup-closed-by-user`
   on web (app/store-firebase.js:426-432, 439-445); busy state on the `.ll-cta` sign-in buttons
   (app/landing.js:33).
4. **Loss/privacy one-liners** (from top-10 #5): carrier gate on the `?go=mood` deep link
   (app/index.html:1413, 5255-5266) + labeled, confirmed loss-holding exit (4201, 4213).

Each is small, isolated, and testable; bump the SW, verify on real mobile width per
`feedback_verify_before_done`, then commit → main → confirm live.
