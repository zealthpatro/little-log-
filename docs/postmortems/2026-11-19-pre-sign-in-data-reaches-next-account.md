# Post-mortem: what one person logged before signing in reaches the next account on that phone

- **Date:** 2026-11-19
- **Severity:** P1 (one parent's babies, entries and photos written into ANOTHER account's family on the server)
- **Duration:** from 2026-06-06 (320f617a) for a phone holding a pre-Firebase record, widened on 2026-08-23
  (5554c2e6) to anyone who logged with no family attached; found 2026-11-19; fixed in a5799200 (not yet live)
- **Status:** RESOLVED in code (a5799200 on claude/admiring-mirzakhani-30b4f6, built on v370 909bd480), waiting
  for the release owner to fold it into v371
- **Author:** Claude session (pre-sign-in leak lane)

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
While no family is attached, `persist()` keeps the whole state in the phone's own record, `little-log-v1`
(`Store.save` in app/index.html), beside a pre-Firebase build's photo bytes in `little-log-photos-v1`. The
first sign-in that makes a brand-new family copies both into it (`buildMigrationPayload` in
`resolveHousehold`). Nothing let go of the record after that copy. Sign-out also left the family's babies and
entries in memory, where the next save with no family attached wrote them back into the record. So the next
account to sign in on that phone with no family of its own was given the first person's data again.

Found by the reviewer of the local-author hotfix, reading the code, on 2026-11-19. Reproduced the same day on
the Firestore and Auth emulators with the real client (`test/next-account-cache-emulator.test.js`), both on
fix/local-author-sync (b3236bab) and on v370 (909bd480):

- **R, after a reload.** Ann logs signed out, signs in (her data reaches her family), signs out. The page
  reloads. Bea, a new account, signs in on the same browser profile. Bea's brand-new family held Ann's baby,
  Ann's entry and Ann's photo, and Bea's screen showed Ann's baby and entry.
- **T, the same tab with no reload.** The same result, from the same frozen record.
- **U, the next person logs first.** Hana signs in and out. Gail logs her own entry signed out, so `persist()`
  writes the record from memory, which still held Hana's family including entries Hana logged signed in.
  Gail's migration then tried to create Hana's entries under Gail's uid. The rules refused them (`authorId`
  is Hana's), so Gail's sign-in never finished: no `users/{uid}` doc, nothing to boot into. A household she
  owns was left behind holding Hana's baby, and Gail's screen showed Hana's baby and both entries.
- **V, a sign-out from elsewhere** (found while proving the fix: mutation M2 below). Ivy logs, and 350 ms later,
  before her push, she is signed out by another tab or a revoked session. Jo signs in on that tab and logs. Jo's
  first push carried Ivy's unsent entry into Jo's family, authored by Jo, and Jo's screen showed it. Ivy's own
  family never got it.

## Impact
- **What crossed:** babies (name, birth date, sex, routines, doctors, allergies), entries (feeds, nappies,
  sleep, notes), legacy photo bytes, and the copied shared blob (shared settings, milestones, medicines,
  vaccines, illnesses, the photo list). They landed in the second account's family, readable by that account
  and by anyone it later invited.
- **Who:** only phones where two accounts signed in on one browser profile. That means a shared family phone
  or tablet, a parent who signed in with the wrong account first, or a second account on the same phone.
  It needs the phone itself. Nobody can trigger it from another device.
- **How many:** not measured. Corrective action 4 proposes an aggregate count that reads no content.
- **Not affected:** other families on the server; the rules; the pregnancy journey and private health (sign-out
  already cleared `state.pregnancy` from memory, and the migration never copies the record's pregnancy);
  notes; a single person on a single phone.
- Orphan households: as in U, each refused migration leaves a family nobody points at. Clients cannot delete
  households (`allow delete: if false`), so any made in production are still there.

## Timeline (from `git log`)
| Date | Commit | What changed |
|---|---|---|
| 2026-06-06 | 320f617a | Firebase sync. The first sign-in that makes a family copies `little-log-v1` in: "one-time local->cloud migration". Nothing enforces "one-time". |
| 2026-06-13/14 | 72ed5d76, f05697b4 | Privacy Max: `teardown` clears the pregnancy and maternal health from memory on sign-out ("no leftover"). Babies and entries are not included. |
| 2026-07-18 | b6272a86 | Account deletion removes `little-log-v1` and `little-log-photos-v1`: the only place either was ever removed. |
| 2026-08-23 | 5554c2e6 | `persist()` writes `little-log-v1` again whenever no family is attached, so solo parents stop losing every write on reload. The record is live again, and is written from whatever memory holds, the previous family included. |
| 2026-11-17 | 86928b51 (v370) | A deletion that stopped at the login signs her out and empties memory first (`signOutAfterStop`, keeps `UNIT_KEYS`). Its comment names this mechanism, for that one door only. |
| 2026-11-19 | (review) | The local-author hotfix's reviewer reads the migration and suspects the leak. |
| 2026-11-19 | a5799200 | Reproduced red on 909bd480 and b3236bab. Fixed and gated (`next-account-cache-emu`). |

## Root cause
The phone's record had no owner and no end of life: it was copied into whichever account first made a family
there, kept, and refilled from memory after a sign-out. The tests modelled one person per phone. Confirmed by
the red runs below.

## 5 Whys
1. **Why did Bea's new family hold Ann's baby and entries?** Bea's first sign-in made a family and copied the
   phone's record into it, and the record still held Ann's copy.
2. **Why did the record still hold it?** Nothing let go of the record after a migration. The only removal was
   account deletion (b6272a86). From 2026-08-23 `persist()` also rewrote the record from memory whenever no
   family was attached, and sign-out left babies and entries in memory, so a sign-out refilled it with the
   family just left.
3. **Why was there no release?** The migration was written on 2026-06-06 for a record left by the
   single-device build: one phone, one person, no sign-out. "One-time" described that world and was never
   made true in code. When 5554c2e6 brought the record back as the live signed-out store, the migration
   became a reader of an unowned, refilling record. Nobody re-read it with two people on one phone in mind.
   (Inferred from the commit history and messages, not from anyone's notes.)
4. **Why was the memory half not caught when it was seen?** The same mechanism was found and closed on
   2026-11-17 for the deletion stop. The comment in `signOutAfterStop` says exactly this: the next Cubby is
   built from the local copy and from memory, "which is emptied here". The fix stayed at that door. `teardown`
   has three callers (Log out, the deletion stop, a sign-out from elsewhere), and only one emptied memory.
5. **Why did no gate say so?** Every sign-in test gives each person a fresh browser context, a phone of her
   own, so two accounts never shared one localStorage or one page's memory. The migration tests (local-author
   E, and the migration in every sign-in suite) asserted that data arrives, never that it arrives only once.
   → **Root cause.**

## Contributing factors (blameless)
- `window.LL.householdId` is never reset on sign-out. This repro's own harness was fooled by it: its first
  `booted` check passed on the previous family's id. It now requires the family the server's `users/{uid}`
  names.
- The record is written whole from memory (`JSON(state)`), so it mixes whatever memory holds: the previous
  family's synced entries beside the next person's own.
- Nothing ever reads the record back on screen (index.html does not load it at boot), so the leftover was
  invisible everywhere except in the next migration.
- The migration writes the household before the `users` pointer, so a refused entry leaves a family nobody
  points at (also in the local-author post-mortem).

## What fixed it (a5799200)
Three parts in app/store-firebase.js, each seen red on its own:
1. **At the migration** (`letGoOfRecord(heldFromMigration(m))`, after `users/{uid}` lands): the record lets go
   of exactly what the new family was given. Entries and babies go by id and photos by id. Each copied blob
   part goes only while it still equals what was given. Anything else stays; with nothing left, the key goes.
2. **At every sign-out** (`leaveFamily`, from `teardown` whenever a family is attached): memory is emptied the
   way the deletion stop already did, keeping only the units. A sign-out from elsewhere lands after auth has
   gone, when `LL.signOut`'s flush never ran. So what was still owed goes into HER outbox first, keyed by her
   uid and that family, and `startSync` replays it to her alone.
3. **For a copy an older build kept** (`letGoOfHeldHere`, once the family's whole history is read): whatever
   the signed-in family already holds leaves the record. Its blob parts go only when every entry and baby in
   the record is that family's. An entry no family holds is never let go.

### A gate whose premise changed
`tools/usage_tracker_check.js` S22 (door-kept, native-kept) proved that a deletion stopped at the reauth door
deleted nothing local by reading `little-log-v1`. With this fix a phone signed in to a family no longer keeps a
copy of what that family holds, so the key was gone whether or not a deletion ran: both went red on a5799200's
first run, for that reason only. The probe now reads `cubby-member`, which every sign-in writes and only
deletion step 4 removes. Seen red: a one-off mutant that clears `cubby-member` before the door turned both red,
with every other S22 check green. The `family-kept-in-memory` mutant edited the line this fix moved into
`dropFamilyFromMemory`, so it no longer applied; it now edits that function.

### Keys let go, checked against the deletion purge list and `UNIT_KEYS`
- `little-log-v1`: only the parts a family holds; the whole key only when nothing else remains. Account
  deletion step 4 removes it whole already.
- `little-log-photos-v1`: only photo ids the family holds. Also in the purge list.
- Units (`unit`, `wUnit`, `hUnit`, `hcUnit`, `tempUnit`) stay in memory through every sign-out
  (`dropFamilyFromMemory`, as `signOutAfterStop` did), so the next save writes them back. In the record they go
  only with a `settings` part equal to the family's, which holds them.
- Theme and reminders are per-device and `applyAppBlob` keeps them. Nothing else is touched: `cubby-member`,
  `cubby-acq`, `cubby-ref`, `cubby-country`, `cubby-email-signin`, the Pro keys, the per-device prefs, the per-uid
  pregnancy-archive cache. The outbox is only ever written for the leaving account's own uid.

### Old-client shape
- **A copy an older build left.** Every phone that migrated before this fix still holds its record. That copy
  is let go the next time its owner opens this build signed in (case O). Until then the next account would
  still get it: see Residual risk.
- **An older build running after this one** (a stale tab or service worker). The record keeps its format, so
  it reads what is left as before. It does not let go itself, and its sign-out does not empty memory. The next
  signed-in boot of this build cleans whatever that family holds.

## Measurements
- Red on v370 (909bd480), real client and real rules: 24 passed, 13 failed. R (reload): Bea's family held
  `Baby-of-Ann`, `Ann-before-sign-in` and photo `pann`. T (same tab): Dana's family held Cleo's baby and
  pre-sign-in entry. U: Gail never booted (`users/{uid}` null); a household she owns held `Baby-of-Hana`; her
  screen showed Hana's baby and both entries.
- The same red on b3236bab (the local-author hotfix stack).
- Green on a5799200: 68 passed, 0 failed, including Ann signing back in to all of hers (family and screen),
  N (a refused migration lets go of nothing) and D (a deletion leaves no outbox of hers).
- Each part reverted on its own turns its own assertions red, on the real client against the emulators:

| Mutation of a5799200 | Red |
|---|---|
| M1 no release at the migration | R: at her family's first snapshot the record still held Ann's baby, entry and photo (63 of 64). Everything else stays green because the later cleanup catches it once her history is read, which is why R asks at the first snapshot |
| M2 sign-out keeps the family in memory | T: Dana's screen showed Cleo's two entries. U: Gail never booted, a household she owns held Hana's baby, and her screen showed Hana's. V: Ivy's unsent entry landed in Jo's family and on Jo's screen, and never in Ivy's (53 of 64) |
| M3 no outbox for a sign-out from elsewhere | V: Ivy's unsent entry never reached her family (62 of 64) |
| M4 an older build's copy is never let go | O: the record kept Kim's copy, and Lia's family and screen got Kim's baby and entry (61 of 64) |
| M5 an older build's copy is let go whole | O: the entry no family holds was deleted from the phone (63 of 64) |
| M6 let go before the migration lands | N: after a refused migration the phone held none of her entries and not her baby (62 of 64) |
| M7 a deletion's own sign-out saves an outbox | D: `cubby-outbox:<her uid>:<family>` was left on the phone after her account was deleted (67 of 68) |

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Release the record at the migration, empty memory at every sign-out, release an older build's copy | Fix | DONE a5799200 (unpushed; v371 via the release owner) |
| 2 | `next-account-cache-emu` gate in the emulator tier: reload, same tab, next person logs first, sign-out from elsewhere, older build's copy, migration still works, refused migration keeps all | Prevent | DONE a5799200 |
| 3 | A fix to one sign-out path lists every `teardown` caller (the `leaveFamily` comment names all three) | Process | DONE (this doc + comment) |
| 4 | Aggregate count of households that share a baby id or entry id with another household, no content read, to size who was hit | Measure | TODO, founder's call |
| 5 | Decide what happens to data already copied into another family, and to orphan households (removals from production need the founder's explicit OK) | Decide | TODO, founder |
| 6 | A parent who JOINS a family never has her pre-sign-in record migrated; it stays on the phone for the next account that makes one | Fix | TODO, separate lane |
| 7 | Reset `window.LL.householdId` on sign-out | Fix | TODO, small |
| 8 | Account deletion leaves `cubby-seen-<uid>` on the phone (seen in case D; coach-mark flags, no health data, but it names her uid). Not in the purge list | Fix | TODO, small |

## Residual risk (known, not closed by this fix)
- A phone that migrated under an older build keeps that copy until its owner opens this build signed in.
- What someone logs signed out and never signs in with goes to the next account that makes a family on that
  phone. The app cannot know who logged it. This is the migration working as designed (case K, and U's Gail).
- Data already copied into another family before this fix stays there until action 5 is decided.

## Lessons
- "One-time" in a design note is a claim, not a mechanism. Write the code that makes it true, or a gate that
  fails when it runs twice.
- When a fix closes one door, list every caller of the same path before calling it done.
- A suite that gives every person her own browser profile cannot see a shared phone. Model the shared device
  on purpose.
- Assert identity. "Booted" must mean booted as this account, into the family the server names.
