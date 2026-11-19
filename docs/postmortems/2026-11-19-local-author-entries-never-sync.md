# Post-mortem: entries authored 'local' never sync

- **Date:** 2026-11-19
- **Severity:** P0 for the signed-in push path (SILENT DATA LOSS: the refused entry disappears from the parent's own phone); P1 for the first sign-in path (she cannot get in)
- **Duration:** from 2026-07-09 (the rule that refuses it) until the fix; found 2026-11-19
- **Status:** RESOLVED (commit ____)  (fix on fix/local-author-sync as 4eaa425f; the fold-in commit number is filled in by the release owner)
- **Author:** Claude session (hotfix lane)

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
Some writers stamp an entry's `authorId` themselves with `myUid()` (app/index.html), which returns the
literal string `'local'` when nobody is signed in OR when Firebase has not loaded yet (the chain is deferred,
so this is true on the first paint for a signed-in parent too, as the comment at app/index.html:3342 says). The sync layer let an
entry's own `authorId` win, so `'local'` was sent to Firestore. `firestore.rules` accepts an event create
only when `authorId == request.auth.uid`, so the write was refused. Two places sent it:

- the first sign-in into a new family (the migration in `resolveHousehold`) wrote
  `Object.assign({ authorId: user.uid }, ev)`, so the entry's `'local'` replaced her uid. The whole
  `Promise.all` rejected and the parent stayed on the sign-in screen with a toast.
- every later push (`pushNow`) wrote `cur[id].authorId || uidNow`, so a `'local'` entry was refused on
  every retry.

Reproduced on the emulators with the real client (`test/local-author-sync-emulator.test.js`): the
sign-in did not complete, and a signed-in push of a `'local'` entry never reached the server.

## What the parent saw
- Signing in to a new family with a `'local'` entry on the phone: the sign-in screen stayed up with
  "Cubby wasn’t allowed to save that. If this keeps happening, sign out and back in." (`errText`,
  app/store-firebase.js, code `permission-denied`).
- Pushing from a signed-in phone: "Cubby wasn’t allowed to save that. If you’ve been removed from this
  circle, sign out and back in." (the denied branch of `pushNow`'s catch). At most one per 2 minutes, and
  a denial goes straight to the 5 minute retry ceiling, so it will not heal by itself. Both strings blame
  her circle or her sign-in; neither is true.

## Impact
- Writers that stamp `'local'` through `myUid()` (found with `git log -S"authorId:myUid()"`, no space):
  rituals (`routinePayload`, ticking a ritual, pushes straight to `state.events`; f05697b4, 2026-06-14,
  probably the most common one, and for a parent who set rituals up in the wizard often her first entry),
  `setBirthWeight` (2026-08-21, 96a7319b) and `importCommit` (2026-08-25, 922c4cdf). `myUid()` itself dates
  from 7828c0b6 (2026-06-10). Anything else that sets `authorId: myUid()` is the same. Ordinary `addEvent`
  entries carry no `authorId` and were fine.
- Exposure: any parent whose `myUid()` still says `'local'` when she logs: signed out, or signed in on the
  first paint before Firebase has loaded. The ritual is a one-tap action, so this is not a rare moment.
  Signed out it blocked her first sign-in (new family) or sat unsynced; signed in it was refused at once.
- An owner editing a caregiver's entry was NOT broken as long as the local copy kept the caregiver's
  `authorId`. It was broken for a copy that had lost the field (B2 in the test): the push wrote the
  editor's uid and the immutable-author rule refused it. Whether a real UI path drops the field is not
  proven; the hardening is cheap and is in the fix.
- Not affected: the server rules, other families, data already on the server.
- Silent data loss, measured: case A2 on a clean 58733b16 checkout, entry stamped 'local' on a signed-in
  phone. After the refusal settled, the entry was NOT in `state.events` (`{"inState":false,"inStore":false}`
  after 9 s; little-log-v1 is not written once signed in, so the store reading is not evidence). The rolled-back
  write reaches the listener as a `removed` change (app/store-firebase.js, the removed branch drops it from
  `state.events`), so the entry leaves the parent's own phone, and with it any chance of a retry. The ritual
  case R shows the same on the tree: the parent saw "Bottle done" and then the denial toast, and the entry
  never reached the server. So "nothing is lost" was wrong: a refused entry is gone from the phone and from
  the server.
- Orphan households: in the first-sign-in migration `newRef.set(...)` lands first (the household exists with
  her babies), the events follow, and `users/{uid}.householdId` is written only after `Promise.all`. A refused
  event aborted before that, so each failed first sign-in, and each relaunch after it, created another
  household holding her babies and whatever events landed, with nothing pointing at it. Clients cannot
  delete households (rules `allow delete: if false`), so they stay.
- How many parents hit it is not measured.

## Root cause
The sync layer trusted a client-supplied `authorId` that can be a placeholder, while the rules (correctly)
require the real uid. Confirmed by the red test run.

## 5 Whys
1. **Why did the entry never reach the server?** The create was refused by the rules: `authorId` was
   `'local'`, not her uid.
2. **Why was `'local'` sent?** `pushNow` and the sign-in migration both let the entry's own `authorId` win
   over the signed-in uid (`cur[id].authorId || uidNow`; `Object.assign({ authorId: user.uid }, ev)`).
3. **Why did an entry carry `'local'`?** `myUid()` returns `'local'` whenever nobody is signed in or Firebase
   has not loaded, and rituals, `setBirthWeight` and `importCommit` stamp `authorId` themselves instead of
   leaving it to the push.
4. **Why did that survive?** `myUid()` and the ritual stamp (2026-06-10 and 06-14) PRE-DATE the rule
   (2026-07-09) that made the author load-bearing: the rule tightened what the clients already did and no one
   re-read the writers. The rule change added a retry-instead-of-silent path but no test for a placeholder
   author, and the later writers (August) copied the pattern. Tests ran signed in, where `myUid()` is right.
5. **Why did no gate say so?** The tests stubbed the write or ran with a signed-in user, so the one input
   the rules refuse, an author that is not a uid, was never sent through the real client and the real
   rules together. → **Root cause.**

## Contributing factors (blameless)
- The denial toast points at her circle membership, so the parent had no way to tell it was the entry.
- A denial retries every 5 minutes for ever and one bad doc fails the batch's `Promise.all`; at sign-in
  that stops the whole migration.
- `stripMeta` removes `authorId` from the diff key, so the client never kept the server's author.
- The migration writes the household before the user pointer, so a failure part-way leaves a household
  nobody points at, and a relaunch makes another.
- The "no denial toast" assertion for A1 was dropped from the test because it passed on the broken tree: that
  error shows on the sign-in screen (`errText`), not through `window.toast`, so the assertion could not go red.
  A1 asserts the sign-in boots and the server holds the entries instead.

## What fixed it
app/store-firebase.js only; rules unchanged.
- `serverAuthor[id]` remembers the author the server holds for each event (set where events are read, before
  `stripMeta`). An update writes that author (an edit never back-fills the editor's uid).
- A create writes the entry's `authorId` unless it is missing or `'local'`, then the signed-in uid.
- The sign-in migration does the same with `user.uid`.
- `test/local-author-sync-emulator.test.js` (wired into tools/gates.js, emulator tier) drives the real
  client and rules and checks the server document.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Sync layer never sends a placeholder author; edits keep the server's author | Fix | DONE |
| 2 | Real-client emulator test for A1, A2, R (ritual), B, B2, C, D, E, wired and watched red | Prevent | DONE |
| 3 | Reword the permission-denied toasts so they do not blame her circle when the entry is the problem | Fix | TODO (copy, founder) |
| 4 | Stop `routinePayload`, `setBirthWeight` and `importCommit` stamping `authorId` at all; let the push do it | Prevent | TODO |
| 5 | Hunt for lost entries and orphan households in production (founder-run, read-only, not run here): see below | Process | TODO |
| 6 | Make the migration write `users/{uid}.householdId` with, or before, the household, so a failure leaves no orphan | Prevent | TODO |

Action 5, the queries (read-only; aggregate counts only, no content):
- Orphan households: list `households` (ids, `ownerId`, `createdAt`) and `users` (`householdId`); a household
  is an orphan when no `users` doc points at it and it has a single member equal to `ownerId`. Count them and
  group by `ownerId` (more than one household per owner is the signature of the relaunch loop).
  `node tools/` has the admin helper pattern used by the funnel report; use it, not a new script.
- Entries authored `'local'` already on the server: collection-group query
  `db.collectionGroup('events').where('authorId','==','local')`, count only. Rules did not exist before
  2026-07-09, so older rows may exist.
- Lost entries cannot be found on the server by construction (they were removed from the phone and never
  written). The only evidence is client side: `save.failed` with `error: permission_denied` events in the
  first-party usage log; count those per day since 2026-07-09 as the exposure estimate.

## Lessons
- A rule that makes a field load-bearing needs a test that sends the field's worst legal-looking value
  through the real client.
- A client-supplied identity is a hint; the signed-in uid is the fact.
