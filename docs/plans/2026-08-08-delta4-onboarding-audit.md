# Delta-4 onboarding audit — 2026-08-08

Founder goal: map the best full onboarding journey (before sign-in and signed in), list every
painkiller and vitamin, find where we have a Delta 4, and choose stage candidates.

Method: five read-only mapping lanes (pre-sign-in surfaces, signed-in journey, full feature
inventory, what parents actually use today with outside research, prior art on aha/activation),
then three personas scoring every feature old-way-vs-Cubby-way independently, then reconciliation
against the code. Delta 4 = Kunal Shah: score the old way out of 10, score ours, a gap of 4+ makes
the behaviour irreversible.

Shipped from this audit on the day: sw v256 (carrier fallback, joinedAt, feedback sort),
v257 (per-member pins), v258 (S1-S7, S10 below), plus the Pro date move to October (v255).

# CUBBY: WHAT LANDS, AND WHY IT DOESN'T YET

Planner's reconciliation. I re-read the code myself where the lanes disagreed. **Three dossier findings are stale and I have corrected them** (marked ⚠ below). Line numbers in the dossier run ~50 low in the 7000+ range of `app/index.html`; every citation here is re-verified against HEAD `159c11f`.

**Corrections to the dossier**
- ⚠ **The vaccine plan IS announced on the add-a-baby path.** `vaxProofLine()` is rendered inside `openOnboardInvite` at `app/index.html:3966`, definition at `:7133`: *"Their vaccine plan is already waiting in Health: N visits, on the UK schedule."* The prior-art lane's "F3(a) NOT BUILT" is wrong. What is still broken is the destination: it is a sentence, not a button, and `healthTab` still defaults to `'meds'` (`app/index.html:7947`).
- ⚠ **Get started no longer sends a first-timer to a timer.** `renderGetStarted` row 3 is now `openDiaper()` with the copy "A nappy change is two taps", and the code comment records exactly why (`app/index.html:2040-2044`). The signed-in lane's B11 is fixed.
- ⚠ **The sign-in friction fixes from the UX audit have shipped.** Busy state on every `.ll-cta` (`app/store-firebase.js:547-553`), `auth/popup-closed-by-user` silenced on both web paths (`:567`, `:581`). Do not redo them.

---

## 1. THE DELTA 4 LIST

Personas: **P6** = six days postpartum, alone all day. **WP** = the working partner, invited caregiver, 20-second sessions. **M** = Maya, 22 weeks after a loss.

Reconciled Δ = the highest honest score among the personas that feature is *for*, capped by **status**. Dark or unpayable features score 0 regardless of design quality.

| # | Feature | P6 | WP | M | **Δ** | Kind | Status | Note |
|---|---|---|---|---|---|---|---|---|
| 1 | Ending a pregnancy without cruelty + loss holding screen (`app/index.html:6991-7071`, `5118-5158`) | – | 7 | 7 | **7** | painkiller | shipped | Largest raw delta in the product. Converts trust and referral, never a signup. |
| 2 | Away recap / "Today so far" (`app/index.html:2058-2078`) | 3 | **7** | 3 | **7** | painkiller | shipped, gated | Returns `''` unless a second person logged **today**. Δ0 for a solo owner. |
| 3 | Since cards, live ticking (`app/index.html:2820-2827`) | 3 | **7** | 1 | **7** | painkiller | shipped | Δ7 only for the person who cannot ask. Free trackers already do this for the mother. |
| 4 | Live timer banners across phones (`app/index.html:2800-2812`, rendered `:2508`) | 3 | **6** | 3 | **6** | painkiller | shipped | The clearest proof two phones share one truth. |
| 5 | Medicine: last dose, who gave it, next due (`app/index.html:7586-7807`) | 1 | **6** | -5 | **6 / 0** | painkiller | shipped, **baby-scoped** | `babyMeds()` filters by `state.activeBabyId` (`:7586`). Best-evidenced pain in the category, unreachable for the two adults who need it. |
| 6 | Gentle mode: pregnancy after loss (`app/index.html:7184-7198`) | – | 5 | 4 | **5** | painkiller | shipped | |
| 7 | Illness episode + shared temperature trend (`app/index.html:7913-8033`) | 1 | **4** | 2 | **4** | painkiller | shipped | Episodic, ~8 days a year. |
| 8 | Doctor visit summary, free (`app/index.html:8139`) | **4** | 3 | 3 | **4** | painkiller | shipped, **buried** | See §2. |
| 9 | Pregnancy visibility review (`app/index.html:6901-6960`) | 0 | 0 | **4** | **4** | painkiller | shipped, **skipped for solo** (`:6893-6897`) | The sharpest disagreement on the panel. |
| 10 | Author attribution, kept after removal (`app/index.html:2990`, `store-firebase.js:2299`) | 2 | **4** | 2 | **4** | painkiller | shipped | Structurally uncopyable under a shared login. |
| 11 | Time strip / retroactive logging (`app/index.html:1632-1643`) | 3 | **4** | – | **4** | painkiller | shipped | The only way WP ever logs anything. |
| 12 | Offline shell + queued writes (`app/sw.js`, `firebase-init.js:75`) | 1 | **4** | 2 | **4** | painkiller | shipped | Δ4 for a commuter, Δ1 for everyone else. |
| 13 | Refusing to forecast in TTC (`app/index.html:5656-5666`, `5522-5538`) | – | – | **4** | **4** | painkiller | shipped | Only after a wrong forecast has already hurt. 29.7% of users name ovulation timing as their app's *best* feature. |
| 14 | Two-week-wait card, no day count (`app/index.html:5591-5607`) | – | – | **4** | **4** | painkiller | shipped | Trying only. |
| 15 | Trying-since, 12-month referral (`app/index.html:5539-5557`) | – | – | **4** | **4** | painkiller | shipped | Fires once, at month twelve. |
| 16 | Week hero with no countdown (`app/index.html:6288-6296`) | – | – | **4** | **4** | painkiller | shipped | Quiet mode drops the week but keeps the fruit (`:6294`). |
| 17 | Urgent warning signs, CDC (`app/index.html:6961-6968`) | – | 4 | 3 | **4** | painkiller | shipped | |
| 18 | Baby has arrived, one continuous journey (`app/index.html:7142-7160`) | – | 4 | 3 | **4** | painkiller | shipped | Once in a lifetime. |
| 19 | Day surface, three lanes (`app/index.html:2231-2308`) | 1 | **4** | – | **4** | painkiller | shipped | Mostly the away recap's landing page. |
| 20 | Feed logging by the second caregiver (`app/index.html:3330-3568`) | 1 | **4** | – | **4** | painkiller | shipped | |
| 21 | Real per-person accounts, roles, revocation (`store-firebase.js:2032-2166`) | 3 | 3 | 3 | **3** | painkiller | shipped | Better than the whole category. Being commoditised free by 2026 entrants. |
| 22 | Nappy, past feed, past nap, edit-with-history, stats with honest divisors | 3 | 2-3 | – | **3** | painkiller | shipped | The honest arithmetic. Free apps score 5-6 here. |
| 23 | Glucose tracker with target bands (`app/index.html:7245-7296`) | – | – | 3 | **3** | painkiller | shipped | Paper diary is the clinic's own tool. |
| 24 | Antenatal schedule + visit prep + SFH trend (`app/index.html:6457-6545`, `5321-5410`) | – | 3 | 3 | **3** | painkiller | shipped | The gap is the *record*, not the content. |
| 25 | Per-category health sharing, off by default (`app/index.html:6849-6882`) | 0 | 0 | 3 | **3** | painkiller | shipped | |
| 26 | Export everything, JSON with photo bytes; unilateral account delete | 1 | 1 | 3 | **3** | painkiller | shipped | The reason to type anything in. Never used. |
| 27 | Quiet mode, condition manager, no third-party analytics | – | 1 | 3 | **3** | painkiller | shipped | |
| 28 | Vaccine schedules, 13 countries, dated (`app/index.html:8437-8720`) | 2 | 2 | 3 | **3** | vitamin | shipped, **silent** | Painkiller only for expats and India private. Never addressed in copy. |
| 29 | Guide, "What to log, and why" (`app/log-guide.js`) | 2 | 1 | 2 | **2** | vitamin | shipped | Never offered on pregnancy or trying homes. |
| 30 | Night theme, today strip, care team, growth charts, milestones, moments library, rituals, heatmap, keepsake outputs, bear avatars, deep links, install, native wrapper, perf | 0-2 | 0-2 | 0-1 | **0-2** | vitamin | shipped | The floor. Real, pleasant, not a reason to switch. |
| 31 | Printable doctor PDF (`app/index.html:8151`) | 2 | 1 | 2 | **1** | painkiller, **taste-gated** | 1 free use, `PRO_TASTE.pdf:1` (`:4130`) | Capped by an empty `checkoutUrl` (`:4118`). |
| 32 | Notes with per-recipient audience (`app/index.html:2309-2399`) | -1 | -1 | -2 | **-1** | vitamin | shipped | Unanimous negative. WhatsApp reaches the lock screen; this does not. |
| 33 | Reading room, good read card, 116 reads | -1 | -2 | -1 | **-1** | vitamin | shipped | Unanimous negative. Google is the incumbent and it wins. |
| 34 | Photo album and storage (base64 in Firestore, `store-firebase.js:1460-1474`) | -2 | -2 | -3 | **-2** | vitamin | shipped, ceilinged | Unanimous negative. Second-best camera roll with a silent quota. |
| 35 | Voice logging (`app/voice-log.js`) | -3 | -1 | -1 | **-2** | vitamin | Pro after 5 (`:202`) | P6: "should be the best thing in the app for me." Gated behind a wall with no door. |
| 36 | Photo studio: cutout, enhance, formats, fonts, stickers, decor, video | -3 | -1 | -2 | **-2** | vitamin | 3 free tastes, then Pro | Cutout also fails offline (model not in `app/sw.js` precache). |
| 37 | Scoped delete with "both guardians must agree" (`app/index.html:4882-4976`) | -1 | 0 | 0 | **-2** | vitamin | **client-only** | No consent rule in `firestore.rules`. A promise the database does not keep. |
| 38 | In-app-only dose alerts (`app/index.html:7587-7648`, `checkMedReminders`) | 0 | **-3** | – | **-3** | vitamin | shipped | Three beautifully honest exits on an alert nobody is awake to see. |
| 39 | Pro sheet, tastes, waitlist (`app/index.html:4144-4221`, `checkoutUrl:''` at `:4118`) | -3 | -1 | -5 | **-3** | vitamin | **cannot sell** | Unanimous negative. Today is August 2026 and the copy says August 2026. |
| 40 | Sign-in wall before the first log (`store-firebase.js:2537`) | **-4** | 0 | – | **-4** | – | shipped | Nara is eleven seconds and no email. |
| 41 | Push reminders (`app/index.html:4479-4606`) | -6 | -6 | -5 | **-6** | painkiller | **`REMINDERS_LIVE=false`** (`:4462`) | Worst score on the panel, unanimous. The only feature that could reach WP during the 11.5 hours where his whole problem lives. |
| 42 | Our Den (`app/index.html:7378-7568`) | -6 | -5 | -6 | **-6** | vitamin | **`FEATURES.den=false`** (`:1369`) | WP: "the one thing in this repo I would have opened every single day." |

### Which clear Delta 4, and for whom

**Clears ≥4 for at least one persona (19 features, rows 1-20).** By persona:
- **WP alone**: away recap, since cards, live timers, medicine coordination, illness trend, attribution, time strip, offline, day surface, partner feed logging. **Ten of the nineteen belong to one persona, and that persona is the one who did not install the app.**
- **Maya alone**: visibility review, no-countdown week, after-loss mode, refusal to forecast, two-week-wait, 12-month referral.
- **P6 alone**: the free doctor visit summary. **One.**
- **Shared**: the loss flow (WP and M), warning signs, arrival continuity.

**Clears ≥4 for everyone: nothing. Not one feature.**

### Where the panel disagreed, and what it reveals

**Privacy.** M scores the visibility review 4, P6 scores it 0 ("I want him to see more, not less. I have nothing to hide from my husband on day six"), WP scores it 0 ("a list of things I have been excluded from, presented to me by an app"). Same feature, three-way split. **Private-within-shared is a carrier-stage painkiller: trying and expecting, sharpest after a loss. In the baby stage it is a tax on the second caregiver.** The Δ6 the docs assert is real for exactly one person at exactly one time. It is the reason to *trust* the shared parts, not the reason to arrive.

**Medicine.** WP 6, Maya -5. Identical feature, opposite verdict, caused by one line: `babyMeds()` filters by `state.activeBabyId` (`app/index.html:7586`). P6 is on painkillers after a difficult birth; Maya is on low-dose aspirin at 22 weeks. Both are the adult at risk of the double dose the evidence actually documents, and neither has anywhere to put it.

**The structural answer.** Sort rows 1-20 and a pattern falls out: **every reconciled Δ≥4 requires a second person already logging, a loss or pregnancy-privacy situation, or an appointment.** Cubby's Delta 4 is not a feature. It is a second person. A solo owner in her first week has nothing above Δ4 except a free doctor summary she cannot find.

---

## 2. WHAT IS A PAINKILLER THAT WE ARE BURYING

**1. The free doctor visit summary. Δ4 for the exhausted mother, and she cannot find it.**
Verified: `openVisitSummary()` (`app/index.html:8139`) is reachable from exactly four places: the fever nudge sheet (`:8085`), the active-illness alert pill (`:2460`), the fever alert pill (`:2467`), and the Care team sheet (`:4354`). Every one of them requires a *sick* baby or a manually entered doctor record with a `nextVisit` date (`upcomingVisit()` at `:8090`). A mother with a well baby and a routine Friday check has no path to it. It is not on the Health tab. It is not in the get-started card. It is not in the guide's home offer. P6 named it her single best feature in the app.

**2. The away recap. Δ7, and it is locked behind the worst screen in the product.**
`awayRecap()` returns `''` unless another author logged **today** (`app/index.html:2062`). Its precondition is an invite. The invite CTA at the peak emotional moment (`openOnboardInvite`, `app/index.html:3963`) opens `openFamily`, whose body order I verified at `store-firebase.js:2104-2109`: member rows, pending invites, a privacy paragraph, **your own profile form**, then the invite form, then share, then Sign out. She must scroll past her own account settings to do the thing the sheet just asked her to do.

**3. The vaccine plan's destination.** The announcement now exists (`app/index.html:3966`) but it is a `<div class="sub">`, not a button, and `healthTab` initialises to `'meds'` (`:7947`). A parent who reads "your vaccine plan is already waiting in Health" and taps Health lands on an empty Medicine list.

**4. Adult medicines. The best-evidenced painkiller in the category, absent by schema.** `babyMeds()` at `app/index.html:7586`.

**5. The circle's whole payoff is invisible to the person deciding.** Since cards, attribution, live timers and the recap all score 4-7 for WP and are 100% behind an OAuth wall (`store-firebase.js:2537`, overlay `position:fixed;inset:0;z-index:99999` at `:126`). No demo, no guest mode, no screenshot. The three files declared as screenshots to Google (`index.html:35`) and to the PWA install sheet (`app/manifest.webmanifest:21-23`) are cream marketing posters, not app UI.

**6. Nothing the app does can reach anyone.** `REMINDERS_LIVE=false` (`app/index.html:4462`), no lifecycle email, no `lastOpen` timestamp anywhere. Every alert pill is a note the parent leaves for herself, findable only by opening the app.

---

## 3. THE PRE-SIGN-IN JOURNEY

### The single promise the first fold should make

> **You will not be the only one who knows what happened today.**

Justified from the scoring, not taste: the four highest reconciled deltas a stranger can be *sold* on are away recap (7), since cards (7), live timers (6) and attribution (4), and all four are the same promise. The privacy claim scores 4 for one persona out of three and **0** for the other two, one of whom actively said she wants the opposite. Cubby's own testimonials already prove this: two of four (`index.html:219`, `:221`) describe the nanny logging and the mother seeing the day, unprompted, in better words than the h1.

The current h1 (`index.html:55`) is already close: *"Every feed, nap and vaccine, shared with everyone who helps."* It does not need replacing. It needs **evidence underneath it**, and the CTA needs to stop hiding the wall.

### What a stranger must experience before being asked for anything

Three things, in this order, none of which is a fake demo:

1. **See the real product.** Six real captures from a seeded demo family, per the existing shot list at `docs/plans/2026-08-04-app-store-listing.md:177-186` (checklist unticked). Use them in four places at once: beside the CSS phone mock on `index.html` (additive, mock stays), the JSON-LD `screenshot` at `index.html:35` and `pricing/index.html:26`, and `app/manifest.webmanifest:21-23`. The one capture that must exist is a timeline showing `by Mama Bear` and `by Nanny` in the same day.
2. **Hold one testimonial in the first fold.** Fatima's line already at `index.html:221` is a better articulation of the wedge than the h1 and sits at ~70% scroll. Move a copy up. Additive.
3. **Get one real artefact with no account.** The only honest hands-on surface available today is the boy-or-girl game (`g/index.html`), which Cubby's own copy labels "a bit of fun, just guesses" (`:78`). Replace that as the entry experience with the schedule generator: on the ten existing `/vaccination-schedule/<cc>/` pages and on `/pregnancy/`, a client-side field where a stranger enters a birthday or due date and gets their country's real dated schedule, printable. All client-side, nothing leaves the device, no prediction, no account. It is the same data the app generates at `saveBaby` (`app/index.html:3934`) and `savePregnancy`. This is LATER, not now.

**Can anything be experienced pre-sign-in without weakening privacy or faking?** Yes, exactly the above. A fake logged-in playground is ruled out: it would teach a lie about a health log and it breaks the charter's one rule.

### Sign-in friction: reuse, do not reinvent

`docs/plans/2026-08-03-ux-simplify-audit.md:61-70` is the sign-in section. **Both of its fixes have shipped** and I verified them: busy state now applies to every `.ll-cta` (`app/store-firebase.js:547-553`), and `auth/popup-closed-by-user` is silenced on both web paths (`:567`, `:581`). Do not redo this work.

What remains is not friction, it is honesty and ordering:

- **No CTA anywhere says an account is required.** `index.html:57-58`, `pregnancy/index.html:44-45`, `features/`, `pricing/index.html:41` all read "Start free 🐻" with fineprint about ads and app stores. Sign-in is disclosed only at `how-it-works/index.html:86` and `faq/index.html:179`, both two taps deep behind the "About" dropdown (`index.html:44`).
- **The value strip is built for the wrong screen.** `ONBOARDING.md:71-72` asked for three bullets above the buttons. The native/standalone screen has them as a five-tile carousel (`app/landing.js:60-66`, rendered `:85-88`). The web acquisition screen puts the Google button straight after a three-line tagline with the trust line *after* it (`app/landing.js:206-212`). The literal recommended `.ll-values` block exists at `store-firebase.js:394` but is dead code, reachable only when `window.cubbyLanding` is undefined, and `app/index.html:11106` loads `landing.js` synchronously first.

---

## 4. THE SIGNED-IN JOURNEY, STAGE BY STAGE

**Teaching surfaces today.** A new solo baby owner meets **seven at once** on the first home paint: tips ticker (`:2502`), day-surface empty hint plus a pulsing "Leave a note" (`:2246`), hero "Add a photo" (`renderHero`), the Get started card with five rows (`:2514`), `renderNudge`'s photo line (`:2519`), the install coach (`alerts`), and the good-read card. Two are already suppressed correctly (`coachMark('home')` and `CubbyGuide.homeCard` both stand down while Get started is up, `:2505`, `:2515`) which proves the team knows the fix. Across a session, add four tab coach marks and two heatmap/growth tip lines: **~13**.

**"Add a photo" is asked three times simultaneously**: `renderHero` empty state, Get started row 5 (`:2049`), and `renderNudge` (`:2791`).

**The number should be: one on the home screen, one per tab on first visit. Five in a session, never two at once.**

---

### BABY

**Aha (reachable in under 2 minutes):** *Their whole vaccine plan is already made, with real dates, on your country's schedule.*
It exists the instant `saveBaby` returns (`app/index.html:3934`) and the copy is already written (`vaxProofLine`, `:7133`).

**Lead with:** the free doctor visit summary is the only Δ4 P6 named, but it needs a week of data. So lead the *setup climax* with the vaccine plan (Δ3 as a vitamin for most, but it is the only payoff available at minute two and it costs nothing), and lead the *first week* with the doctor summary door.

**Defer:** photos, keepsakes, moments library, milestones, rituals, growth charts, stats.
**Never show a first-timer:** the 299-card moments library or the 225-milestone age bands. P6: "299 things I have not captured, presented to someone who is frightened she is already failing."

**Taps.** Today, verified: stage card → date "Change" → day cell → "Done" → *type name* → "Add baby" → relationship select → option → "Continue" → "Maybe later" → Diaper tile → Wet = **11 taps + 1 typed field** (the Get started card now points at the two-tap nappy, so this is the honest count, not the 15-16 the pre-sign-in lane traced through the feed sheet).
With a "Born today / this week" shortcut on the birthday strip and the relationship select left blank in one tap: **8 taps. Three fewer.**

---

### EXPECTING

**Aha:** *Your antenatal visits are already scheduled, with the source, and your questions are ready for the next one.*
`savePregnancy` builds the whole national list at `app/index.html:6070`; `renderPregHome` already renders "Next: X, in about N weeks, N questions ready".

**Lead with:** the next appointment card, not the fruit. It is the one thing on that screen that is about her week rather than about the baby's size.

**Defer:** kick counter (already week-gated), contractions (already week-36 gated), keepsakes, games.
**Never show a first-timer:** the family games hub. Maya: "a feature built on telling everyone, sitting in an app I chose for not telling anyone." And never show days-to-go, which the code already refuses.

**Taps.** Today: stage card → due-date "Change" → **one `›` per month** between now and the due date → day cell → "Done" → "Start tracking" → *type name* → "Continue" → "Maybe later". Eight if she is due this month, **~13 typical** (a second-trimester signup steps five months forward on `_dpMove`, `app/index.html:1685`). With a year/month jump in `_dpGrid`: **8 taps. Five fewer.**

**The wedge break to fix here:** `startPregnancyAudit` early-returns for a solo household (`app/index.html:6893-6897`), so the privacy review, the one Δ4 Maya scored, never runs for the flow where it is the entire differentiator. And when she later invites her partner, `sharedWith` is empty, he lands on the one-button waiting screen, and nothing prompts either of them.

---

### TRYING

**Aha:** *Cubby will not guess your ovulation date, and here is what your body actually did.*
The refusal is the position, and it is the only Δ4 in this stage. `renderPlanningHome` already leads with the honest look-back and the range card (`app/index.html:5957-5962`).

**Lead with:** the look-back and the doctor report (`:5742`). **Never the fertile window.**

**Defer:** everything else. This is the emptiest landing in the app and it should stay quiet.
**Never show a first-timer:** a dated forecast, a countdown, a "log your symptoms" prompt, or an empty-day grid. All already refused in code.

**Taps.** Four: stage card → "Start" (everything blank) → "Continue" → "Maybe later". Cannot be reduced. **The destination is the problem, not the count.**

**Bug to fix first:** every new owner including a father is asked for the first day of their last period. `viewerIsCarrier()` (`app/index.html:5514-5518`, verified) returns `true` unless the relationship string is 'papa bear', 'grandpa bear' or 'uncle bear', and a brand-new owner's relationship is `''`. `openPlanningSetup` branches on it during first run, before identity exists. The expecting door already fixed this exact ordering problem with neutral wording (comment at `:5469-5473`); the trying door did not.

---

### CHILD

**There is no door.** `obStage` routes three cards (`app/index.html:5967-5971`); child is derived from age (`stageOf`, `:8229`). The only entrance is "Our baby's here" plus back-dating a birthday, and `_dpGrid` has **no year control** (verified: header is `‹`, month name, `›`, plus a "Today" button, `app/index.html:1668-1683`; `_dpMove` steps one month, `:1685`). A three-year-old costs **36 taps on `‹`**.

**Aha:** none exists honestly. **Either give the stage a door and an aha, or say out loud that Cubby starts at birth.** With a year control: 36 taps → 3.

---

### INVITED CAREGIVER

**This is the best first-run in the product and the highest-leverage persona on the panel.** WP scored ten of the nineteen Δ4 features.

**Aha:** *Someone else's day, already logged, on your phone, before you have done anything.*
It fires on the first screen because `renderGetStarted` auto-hides when the family already has baby + log + photo (`app/index.html:2037`), so he lands on a working app with no checklist.

**Lead with:** the away recap. It is the whole reason the app is on his phone.

**Defer / never:** the get-started checklist (it already hides), the guide's home card (correctly still fires for him, `log-guide.js:376-378`), and anything about setup. He will abandon anything requiring setup.

**Taps.** Sign in → invitee welcome (*type name*) → "Save" → home. **3 taps + 1 typed field.** Already right. Do not touch it.

**Two dead ends to close.** (a) `justJoined` is session-only (`store-firebase.js:752-754`); reload before finishing first-run and, if the family has no visible baby, he lands permanently on `renderCaregiverWaiting` (`app/index.html:5098-5114`) whose only control is Log out, with `needsIdentity` stuck true, which also permanently blocks the deep-link router (`:1848`). (b) That screen has no Settings and no account deletion, which is App Store 5.1.1(v) exposure, already logged in the audit's next tier.

---

## 5. THE PLAN: RANKED, WITH EFFORT

### SHIP NOW

**S1. Health opens on Vaccines until a medicine exists.** `app/index.html:7947`.
Serves: the minute-two aha (rows 28, and it is the destination for row 8's neighbour).
Change `let healthTab='meds';` to `let healthTab=null;` and in `renderHealth` (`:7951`) resolve it lazily:
```js
const tab = healthTab || (babyMeds().length ? 'meds' : 'vaccines');
```
then read `tab` at `:7952-7955` instead of `healthTab`. Size: one-liner.
Breaks if done wrong: a parent mid-course of antibiotics must still land on Medicine. The `babyMeds().length` guard is what protects that. Do not change `setHealthTab`.

**S2. The vaccine line becomes a door.** `app/index.html:3966`, inside `openOnboardInvite`.
Today it is a `<div class="sub">`. Make it tappable:
```js
${vaxProofLine()?`<button class="btn-ghost" onclick="closeSheet();go('health');healthTab='vaccines';render()">💉 See their vaccine plan</button>`:''}
```
Size: one-liner. Serves the same aha. Breaks if done wrong: it must sit *below* the invite button, not above it. The invite is the higher-delta action.

**S3. Give the free doctor summary a permanent door.** `app/index.html`, foot of `renderHealth` (`:7955`), on every tab.
Copy: `Going to the doctor?` / `A one-tap summary of the last week, ready to read out.` → `openVisitSummary()`.
Size: one-liner. Serves row 8, the only Δ4 P6 named. Breaks if done wrong: it must not be a Pro taste. `openVisitSummary` is free; only `openDoctorReport` (`:8151`) spends a taste. Keep them separate.

**S4. Stop asking for a photo three times.** `app/index.html:2519`.
`renderNudge()` returns the photo line when `!heroPhotos().length`. Suppress it while the checklist is up, the same pattern already used two lines above:
```js
${gsCard ? '' : renderNudge()}
```
Size: one-liner. Serves the teaching-surface count. Breaks if done wrong: `renderNudge` also carries the milestone-keepsake and "N things logged today" branches; suppressing the whole call while the checklist is up is acceptable because the checklist owns that moment, but do not suppress it after the checklist retires.

**S5. Suppress the tips ticker while the checklist is up.** `app/index.html:2502`.
`${away ? '' : tipsTicker()}` → `${(away||gsCard) ? '' : tipsTicker()}`. Size: one-liner. Same reason.

**S6. The tips ticker retires on the person's own logs, not the household's.** `app/index.html:1971`.
`(state.events||[]).length>=TIPS_RETIRE_AFTER` counts the *family's* events, against a comment at `:1960-1966` claiming it measures whether she has learned to log. Count events where `e.authorId === myUid()`. Size: one-liner. Serves the invited caregiver. This is the same class as the shared-`seen` bug already fixed at `:2569-2605`.

**S7. Offer the guide on the pregnancy and trying homes.** `app/index.html`, `renderPregHome` and `renderPlanningHome`.
Add `${(window.CubbyGuide&&CubbyGuide.homeCard)?CubbyGuide.homeCard(false):''}`. The pregnancy branch is already written (`app/log-guide.js:388`) and unreachable. Size: one-liner. Breaks if done wrong: `homeCard` already returns `''` on the loss holding screen and for the planning stage (`log-guide.js:302-306`); do not bypass those gates.

**S8. Neutral wording on the trying door.** `app/index.html:5613-5618`.
Do not branch on `viewerIsCarrier()` during first run. Use the same fix `openExpectingSetup` already made (comment at `:5469-5473`): write the fields neutrally until identity exists.
Copy: `If you are tracking cycles, when did your last period start?` and `About how long is a usual cycle for you?`
Size: half a day. Breaks if done wrong: `viewerIsCarrier` is load-bearing on the *home* screens after identity exists. Change only the first-run branch.

**S9. Year control in the date picker.** `app/index.html:1668-1683` (`_dpGrid` header) and `:1685` (`_dpMove`).
Add `«` / `»` year steps beside the month arrows, honouring the existing `s.min` / `s.max`. Size: half a day. Serves the child stage and cuts five taps off a typical expecting signup. Breaks if done wrong: the disabled-cell logic at `:1678` compares ISO strings; a year jump past `max` must still render, with cells disabled, not throw.

**S10. Deep links must survive a slow first run.** `app/index.html:1848`, `:1890-1895`.
`maybeRunDeepLink` returns while `needsIdentity` is true and `scheduleDeepLink` gives up after 80 × 250ms. Re-arm the poll when `needsIdentity` clears instead of racing a 20-second clock. Size: one-liner. Serves every invite and share link.

**S11. A focused invite sheet.** `app/index.html:3959` and `:3951` currently call `window.openFamily`.
Add a small sheet: one email field, one "Send the invite" button, and a link to Family and sharing for everything else. **Additive. Do not remove or reorder `openFamily`,** which is the only door to cancelling invites and signing out.
Copy: `Who should see the day?` / `Add their email and we will send them the link. They see everything you log, live.` Button: `Send the invite`. Ghost: `Family and sharing`.
Size: a day. Serves rows 2, 3, 4, 10, the ten Δ4 features that need a second person. This is the single highest-leverage change in the plan, because it unblocks the precondition of everything above Δ6.

### NEEDS A YES

**N1. Say the sign-in out loud at every CTA.** Live marketing copy. `index.html:58`, `pregnancy/index.html:45`, `features/index.html`, `pricing/index.html:41`.
Proposed line for the existing fineprint slot: `You sign in with Apple, Google or an email link. About ten seconds, no password to invent.` It is already true and already written at `faq/index.html:179`.

**N2. Name the operator.** `privacy/index.html:50-51` and `terms/index.html:46`, `:145` still read `[Legal entity — to be confirmed]`, under the vow at `why/index.html:145` that invites verification. Founder decision, not a build. It blocks the one thing Maya scored 3-4 on across five different features.

**N3. Fix or retire the newsletter promise.** `news-widget.js:64` says "Get the guide", `:81` says "watch your inbox in a couple of weeks". `worker.js` routes `/api/newsletter` at `:854-857` to `newsletterSignup` at `:166`, which hashes and writes to D1. **There is no send path in the file.** Either ship the send or change the two strings. This is the first promise Cubby makes to a stranger.

**N4. The three "vaccine reminders" claims.** `index.html:10` (meta description), `index.html:234` (free-tier bullet), `how-it-works/index.html:160`. What exists is `vaccineOverdue()` rendering an alert pill (`app/index.html:2439-2444`). The FAQ is already honest (`faq/index.html:97-101`), so these three are the outliers. Same class: `PRO.md:41-53` still advertises push including "time to log" alerts, which would violate the medicine-only policy even if push were live, and `app/landing.js:239` says push is "on the Pro roadmap". Commit `0cafe1e` already walked back the same claims elsewhere; this is finishing that job.

**N5. Adult medicines.** `babyMeds()` at `app/index.html:7586` is baby-scoped. Two of three personas independently found the best-evidenced painkiller in the category unreachable for the adult who needs it. This is a schema decision (a `babyId: null` medicine, or a `who` field) plus a privacy decision (whose medicine list is it, and does the circle see it). It touches the shared blob. Needs a yes before design.

**N6. Pro.** `checkoutUrl: ''` (`app/index.html:4118`), `PRO_LAUNCH = 'August 2026'` (`:4127`), and today is 2026-08-08. All three personas scored the taste wall negative and one scored it -5. Either open checkout or move the date on all four surfaces. Being shown a price nobody can pay is worse than being shown no price.

### LATER

- **L1.** Real product screenshots, six captures, four destinations (§3).
- **L2.** The vaccine/antenatal schedule generator on the ten country pages and `/pregnancy/`. No account, client-side, real dated output.
- **L3.** `awayRecap` past same-day, which needs a `lastOpen` timestamp that does not exist anywhere in the app.
- **L4.** Tokenised invite links. The stated blocker (an unpublished A6 rules change, commit `b7f804a`) has expired; A6 published and verified 109/109.
- **L5.** The locked-door demo on `/why/` and `/pregnancy/`, ranked #1 in `docs/plans/2026-07-20-market-position-and-aha.md:136-138`. Ranked LATER here on the evidence: it demonstrates the claim that scored 4 for one persona and 0 for two.
- **L6.** A child-stage door and an honest child-stage aha, or a public statement that Cubby starts at birth.

---

## 6. WHAT THIS PLAN MUST NOT BECOME

This plan is about activation, which is precisely the work that historically reaches for the rejected mechanics. The rejections are on the record with the reason preserved so they can be caught.

> *"If a future version of this plan reintroduces any of them, that is the regression to catch."* — `docs/plans/2026-07-18-onboarding-and-virality-design.md:606-610`, on streaks, scarcity, FOMO, comparison, engagement push, "we missed you", badge counts, and any re-engagement surface for a solo parent.

> *"Streaks are guilt with a progress bar; scarcity manufactures urgency at an anxious parent."* — same doc, `:65-70`.

> *"do NOT optimise for time-in-app or compulsive checking… If a metric rewards anxiety, it is the wrong metric."* — `CUBBY-GUARDRAILS-AND-GOVERNANCE.md:42-43`.

> *"If nobody else logged, show nothing at all… That silence is the feature. Explicitly: no 'we missed you', no re-engagement push, ever."* — `docs/plans/2026-07-18…:391-393`. **S4 and S5 must not become a reveal queue that fills the space they clear.**

> *"Pull, never push. If anything ever makes it open on its own, it has become the tour this line rules out."* — `ONBOARDING.md:77-86`. **S7 adds the guide to two more screens. It must stay the same card: no auto-open, no progress meter, no completion count.**

> *"If a flow needs explaining, it has already failed."* — `CUBBY-EXPERIENCE-CHARTER.md:24-25`. The answer to a confusing screen in S1-S3 is a better screen, not another coach mark.

> *"No prod removals without founder OK."* — `docs/plans/2026-08-03-ux-simplify-audit.md:248-250`. **S11 adds a focused invite sheet. It does not remove `openFamily`.**

> *"Do not ship new pixels/analytics to 'measure' any of this — first-party only."* — same doc, `:257`.

Push stays medicine-critical and stays off until `/api/health` reports `cronHealthy:true` and the APNs key is uploaded (`app/index.html:4455-4461`). Nothing in this plan promises a notification. **No new clinical claim anywhere:** S3 surfaces an existing summary of logged facts, it does not interpret them.

---

## 7. THE FOUNDER'S DECISIONS

**D1. Does the marketing site say "you sign in" at the CTA, or not?**
Live copy on five pages. Saying it costs a small conversion at the click and removes a bait-and-switch at the wall. Not saying it keeps the click and spends the trust at the worst moment. My read: say it. But it is your copy and your funnel.

**D2. Adult medicines: whose list is it?**
Two of three personas found the best-evidenced painkiller in the product unreachable, purely because `babyMeds()` filters by `activeBabyId` (`app/index.html:7586`). The fork is not whether, it is whose: a household medicine list the circle can see (which is where the double-dose evidence points, and which breaks the private-within-shared instinct for a woman on aspirin at 22 weeks), or a private-by-default one (which is safer for her and useless for the coordination it exists to solve). Materially different work either way.

**D3. Pro: open checkout in August, or move the date?**
`checkoutUrl` is empty (`app/index.html:4118`), the copy says August 2026 on four surfaces, and today is the eighth. The panel scored the taste wall negative unanimously, worst at -5. The fork is legal and out of repo, but the copy decision is yours and it is due now.

**D4. Does the child stage get a door, or do we say Cubby starts at birth?**
Four stages in the model, three cards in the chooser (`app/index.html:5967-5971`), and the only entrance costs 36 date-picker taps. S9 makes the back-dating survivable but does not make the stage honest. Building a real child-stage aha is a project. Saying "Cubby starts when you are trying, expecting, or newly arrived" is a sentence. Either is defensible; drifting is not.