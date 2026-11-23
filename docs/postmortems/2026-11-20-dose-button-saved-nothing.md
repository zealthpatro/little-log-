# Post-mortem: "Log it" said "Dose logged" and saved nothing

- **Date:** 2026-11-20
- **Severity:** P1 (medicine safety). A parent who tapped "Log it" on a reminder, at the time the reminder
  is built to be tapped, was told the dose was logged and nothing was saved. A partner who then opened
  Cubby saw no dose and could give a second one.
- **Duration:** 2026-10-26 16:07Z (Worker version d1855c05, which carried 6ea571dd) until this fix is
  live. The words that hid it ("Dose logged" for any 200) date from d8337da0 (2026-08-14), but until
  2026-10-26 the route said `already` only for a genuine repeat.
- **Status:** RESOLVED in 55876b99 and 344f8725, shipped in the release whose service worker is little-log-v379.
- **Author:** Claude (Opus 5.5), for the founder. The rule that failed was written by the same author.

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
A medicine reminder fires about 30 minutes before the dose is due and, on Chromium web push, carries a
"Log it" button. The 2026-10-06 security fix (6ea571dd) added a check to `/api/dose`: refuse the write,
answering `{ok:true, already:true}`, when a dose of the same medicine for the same child was logged less
than one interval ago, counted from the tap. The previous dose of a medicine taken on schedule is
always one interval before the due time, so a tap 30 to 15 minutes early always fell inside it. The
service worker read every 200 as a save and showed "Dose logged / Calpol is on the record."

Found by an audit re-check from the widgets session on 2026-11-20; reproduced the same day on main
58733b16 by driving the real route (every 6 hours, last dose 5h40m ago: `already`, 0 writes; twice daily,
last dose 11h40m ago: `already`, 0 writes).

## Impact
- Every "Log it" tap for a medicine taken on schedule saved nothing, from 2026-10-26. Only a first-ever
  dose, or one long overdue, was written.
- **How many families: unknown, and not measurable after the fact.** A refused tap wrote nothing and
  logged nothing. It needed push enabled and a Chromium browser; the iPhone button was never built
  (`CUBBY_DOSE` appears only in worker.js), so iOS was not affected.
- Not affected: doses logged inside the app.

## Root cause
A medicine-safety behaviour, refusing a dose the parent says she gave, was decided inside a security
fix without being put to the founder. It was tested only on convenient timelines, never the one the
reminder actually produces.

## 5 Whys
1. **Why did an on-schedule tap save nothing?** The route refused any dose within one interval of the
   last, measured from the tap, and the reminder fires before the due time, inside that interval.
2. **Why was it measured from the tap?** It ported the app's `logDose` rule (`now - last < interval`).
   In the app that rule asks a question with a "Log another" button; in the route it became a refusal.
   The plan's own version (`time >= due - interval`) had the opposite defect (it matches the dose that
   set the schedule), and the "fix" replaced one wrong window with another without modelling when the
   reminder fires.
3. **Why did the parent read "Dose logged"?** `app/sw.js` treated any 200 as a save. `already` was a 200
   by design, for idempotency, and had been a rare and truthful case until 2026-10-26.
4. **Why did the gate not catch it?** `test/dose-membership.test.js` put the earlier dose "an hour ago"
   and its companions beyond the interval. None placed the previous dose on schedule with the tap before
   the due time. `test/push-delivery.test.js` had already paid for this exact lesson in August ("Fire
   times are relative to NOW so the fixtures are REALISTIC"), and it was not applied. The service
   worker's words had source-string checks only, never a behaviour test.
5. **Why did review not catch it?** One author wrote the rule, its fixtures and the review, and the
   choice between refusing and saving was never surfaced as the product decision it is. **Root cause:**
   a rule that can refuse or alter a parent's medicine record was decided silently in code, and proven
   on timelines chosen for convenience rather than the one the product creates.

## What fixed it
- **Always save.** `/api/dose` writes every tap by a current owner or caregiver. The founder's call
  (2026-11-20): "if the parent has given the medicine we should log it".
- **One document per dose time and per person** (`dose-<medId>-<due>-<uid>`). One person's double tap is
  one dose (Firestore's ALREADY_EXISTS, answered as `already`); a second person's tap is a second dose.
- **A second dose in the same slot is reported as facts**, never refused: `earlier: <ms>` in the reply,
  shown as "Two doses logged / One at 1:55 AM and one now. Tap to check them." The founder chose facts
  only, no spacing advice, matching the app's "one question, made of facts". The slot: a dose belongs to
  the slot it is nearer, after due minus half the interval, for every-X and daily alike. A failed read
  only loses the note.
- **Caught in release review, before shipping:** the first version anchored an every-X slot just after
  "the dose that set the due time", assumed to be exactly one interval back. It is not: a phone's
  `push.due` is projected from the last dose that phone synced, and a Worker write never re-syncs it, so
  the previous slot's dose sits wherever it was really logged, usually minutes after its due. Every
  reminder after a late tap would have said "Two doses logged" falsely, at night, teaching parents to
  ignore the real one. Both release reviewers found it independently (correctness C1, safety MS-1). The
  convenient-timeline mistake again: the fixture put the previous dose at exactly due minus six hours.
- **Honest words.** `app/sw.js` holds every confirmation in one `DOSE_COPY` block, says "Dose logged" only
  for a dose written, "Already logged" for a repeat, "Could not log that dose" for anything it cannot
  read, and names no medicine and no person on the lock screen (C6). Cache v379.
- **Gates**, each seen red on the release tip's code first:
  - `test/dose-membership.test.js` section 10 rebuilt on real schedules, 9 new mutants: 17 of 75 failed
    on the old route; the stale-schedule fixtures added after review failed 2 of 78 on the first fix;
    96/96 with `--self-test` on the final one.
  - `test/dose-button.test.js` (new, gate `dose-button`): the real sw.js in a sandbox for every answer
    the route gives: 20 of 39 failed on the old sw.js; 44/44 with 5 mutants on the fix.
  - `test/dose-slot-emulator.test.js` (new, gate `dose-emu`): the real route on the Firestore emulator.
    On the old route 7 of 9 failed and Firestore saw zero writes; the stale-schedule case failed on the
    first fix; on the final one 11/11, five real creates and one real ALREADY_EXISTS.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Always save; per-person id; second dose reported as facts | Fix | DONE (not live) |
| 2 | One honest `DOSE_COPY` block in sw.js, nothing named on the lock screen | Fix | DONE (not live) |
| 3 | Real-schedule fixtures, a sandboxed sw.js test, an emulator test, all wired with self-tests | Prevent | DONE |
| 4 | Any rule that refuses or changes a parent's medicine record is put to the founder before it ships | Process | DONE (this document; ways-of-working candidate) |
| 5 | Skip a reminder whose slot already has a dose recorded, failing open on a read error | Fix | OPEN, separate change in the audit |
| 6 | Tap lands on that medicine (needs widgets Task 7's `go=medicine`; a `?tab=` link would miss the offline cache, see usage_tracker_check S15) | Fix | OPEN |
| 7 | The iPhone "Log it" button, when built, uses the same words (widgets Task 10 moves DOSE_COPY to docs/widgets/widget-copy.json) | Fix | OPEN |

## Lessons
- A test timeline is a claim about the product. Build it from when things really happen (the reminder
  fires 30 minutes early; the parent taps a few minutes after giving the dose; the phone's schedule is
  stale), not from round numbers. This fix repeated the original mistake once, and review caught it.
- "Refuse" and "save" are not implementation details for a medicine record. Ask.
- Words that confirm an action read the server's answer, not its status code.
