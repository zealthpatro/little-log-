# Post-mortem: entries authored 'local' never sync

- **Date:** 2026-11-19
- **Severity:** P1 (data stays on one phone and the app says it could not save; nothing is lost, nothing reaches the family)
- **Duration:** from 2026-07-09 (the rule that refuses it) for any parent who logged anything while signed out or before sign-in restored; found 2026-11-19
- **Status:** RESOLVED (commit: the fix commit on fix/local-author-sync, folded into v371 by the release owner)
- **Author:** Claude session (hotfix lane)

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
Some writers stamp an entry's `authorId` themselves with `myUid()` (app/index.html), which returns the
literal string `'local'` when nobody is signed in or auth has not restored yet. The sync layer let an
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
- Writers that stamp `'local'`: `importCommit` (the import from another app, 2026-08-25, 922c4cdf) and
  `setBirthWeight` (2026-08-21, 96a7319b), both via `myUid()` (introduced 2026-06-10, 7828c0b6). Anything
  else that sets `authorId: myUid()` is the same.
- Exposure: a signed-out parent can do everything the local mode allows before signing in: log entries,
  set a birth weight, run the import. Anything of those that went through `setBirthWeight` or the import
  while signed out blocked her first sign-in entirely (new family) or sat unsynced for ever (existing
  family, auth not yet restored). Ordinary `addEvent` entries carry no `authorId` and were fine.
- An owner editing a caregiver's entry was NOT broken as long as the local copy kept the caregiver's
  `authorId`. It was broken for a copy that had lost the field (B2 in the test): the push wrote the
  editor's uid and the immutable-author rule refused it. Whether a real UI path drops the field is not
  proven; the hardening is cheap and is in the fix.
- Not affected: the server rules, other families, data already on the server.
- How many parents hit it is not measured (inferred: few, since both writers are rare moments).

## Root cause
The sync layer trusted a client-supplied `authorId` that can be a placeholder, while the rules (correctly)
require the real uid. Confirmed by the red test run.

## 5 Whys
1. **Why did the entry never reach the server?** The create was refused by the rules: `authorId` was
   `'local'`, not her uid.
2. **Why was `'local'` sent?** `pushNow` and the sign-in migration both let the entry's own `authorId` win
   over the signed-in uid (`cur[id].authorId || uidNow`; `Object.assign({ authorId: user.uid }, ev)`).
3. **Why did an entry carry `'local'`?** `myUid()` returns `'local'` whenever nobody is signed in, and
   `setBirthWeight` and `importCommit` stamp `authorId` themselves instead of leaving it to the push.
4. **Why did that survive?** The sync code was written (2026-06-06) before the rule (2026-07-09) made the
   author load-bearing, and the rule change added a retry-instead-of-silent path but no test for a
   placeholder author. The writers arrived later (August) and were tested signed in, where `myUid()` is
   right.
5. **Why did no gate say so?** The tests stubbed the write or ran with a signed-in user, so the one input
   the rules refuse, an author that is not a uid, was never sent through the real client and the real
   rules together. → **Root cause.**

## Contributing factors (blameless)
- The denial toast points at her circle membership, so the parent had no way to tell it was the entry.
- A denial retries every 5 minutes for ever and one bad doc fails the batch's `Promise.all`; at sign-in
  that stops the whole migration.
- `stripMeta` removes `authorId` from the diff key, so the client never kept the server's author.

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
| 2 | Real-client emulator test for A1, A2, B, B2, C, D, E, wired and watched red | Prevent | DONE |
| 3 | Reword the permission-denied toasts so they do not blame her circle when the entry is the problem | Fix | TODO (copy, founder) |
| 4 | Stop `setBirthWeight` and `importCommit` stamping `authorId` at all; let the push do it | Prevent | TODO |
| 5 | Check production for events authored `'local'` already on the server (the pre-rule era, before 2026-07-09) | Process | TODO |

## Lessons
- A rule that makes a field load-bearing needs a test that sends the field's worst legal-looking value
  through the real client.
- A client-supplied identity is a hint; the signed-in uid is the fact.
