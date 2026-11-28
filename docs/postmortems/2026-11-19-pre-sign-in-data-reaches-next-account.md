# Post-mortem: what one person logged before signing in reaches the next account on that phone

- **Date:** 2026-11-19
- **Severity:** P1 (one parent's babies, entries and photos written into ANOTHER account's family on the server)
- **Duration:** from 2026-06-06 (320f617a) for a phone holding a pre-Firebase record, widened on 2026-08-23
  (5554c2e6) to anyone who logged with no family attached; found 2026-11-19; fixed in 1a488e43 and 3da1bdef on the
  release branch (not yet live)
- **Status:** RESOLVED in code: 1a488e43 (cherry-picked from f9ee6699), and 3da1bdef for a history read that lands Shipped in the release whose service worker is little-log-v379 (one CACHE bump for the whole release, not v372).
  after a sign-out, on the release branch built on v370 909bd480. The release ships as CACHE v379.
- **Author:** Claude session (pre-sign-in leak lane); the review round's conditions folded in by its own lane

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
- **H, a history read that lands late** (found by the review of the fix, 2026-11-20). The full history read
  (`hydrateFullHistory`) can still be out when she signs out. With only the first fix, Nora's older entries came
  back into memory when it landed, a moment after the sign-out had emptied it. The next save with no family
  attached wrote them into the record with Nora's uid, and Pam's sign-in after that was refused and never
  finished. A late failure of the same read also cleared the next family's `cubbyHistoryPending` (H2). The same
  read landing after the NEXT family is attached (H3, added 2026-11-24) put the first family's older entries into
  memory under the next account and told her family its history was in while her own read was still out.

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
| 2026-11-19 | (emulator run) | Reproduced red on 909bd480 and b3236bab. |
| 2026-11-20 | f9ee6699 | Fixed and gated (`next-account-cache-emu`), built on v370. |
| 2026-11-20 | 1a488e43 | f9ee6699 cherry-picked onto the release branch. Its review finds H (P2), and J and X (see Residual risk). |
| 2026-11-20 | 3da1bdef | The full history read drops an answer, or a failure, that lands after a sign-out (probes H and H2). S22's companions see deletion step 4 run. CACHE v379. |

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
  names. (Reset with the rest of the family's snapshot fields since 4efa86d7, action 7; the harness keeps the
  server check.)
- The record is written whole from memory (`JSON(state)`), so it mixes whatever memory holds: the previous
  family's synced entries beside the next person's own.
- Nothing ever reads the record back on screen (index.html does not load it at boot), so the leftover was
  invisible everywhere except in the next migration.
- The migration writes the household before the `users` pointer, so a refused entry leaves a family nobody
  points at (also in the local-author post-mortem).

## What fixed it (1a488e43, and 3da1bdef for part 4)
Four parts in app/store-firebase.js, each seen red on its own:
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
4. **For a history read that lands after a sign-out** (`hydrateFullHistory`, 3da1bdef): the read keeps the
   events collection it was asked of and drops its answer once that is not the attached family's: none of it
   goes into memory, `knownEvents` or `serverAuthor`. Its failure clears `cubbyHistoryPending` only for the family
   it belongs to. Without it, part 2's "every sign-out empties memory" held only until that read landed (H, H2, H3).

### A gate whose premise changed
`tools/usage_tracker_check.js` S22 (door-kept, native-kept) proved that a deletion stopped at the reauth door
deleted nothing local by reading `little-log-v1`. With this fix a phone signed in to a family no longer keeps a
copy of what that family holds, so the key was gone whether or not a deletion ran: both went red on the fix's
first run, for that reason only. The probe now reads `cubby-member`, which every sign-in writes and only
deletion step 4 removes. Seen red: a one-off mutant that clears `cubby-member` before the door turned both red,
with every other S22 check green. The `family-kept-in-memory` mutant edited the line this fix moved into
`dropFamilyFromMemory`, so it no longer applied; it now edits that function.
The review then found that deletion step 4 itself could be skipped with every gate green: the door checks see the
keys kept, and nothing saw them go (review mutant mut-s4skip: S22 and S23 38 ok, 0 failed). Since 3da1bdef both
companions (door-companion, native-companion) also read the same key gone once the deletion has run to the end.
The self-test's new `local-traces-kept` mutant skips step 4: S22 is 14 passed, 2 failed (the two companions,
nothing else), where the checker before 3da1bdef gave 16 passed, 0 failed on the same mutant.

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
Re-measured on 2026-11-20 with the test as it stood then (89 checks: R, T, U, V, O, D, K, N, H, H2), real client and
real rules, each `app/store-firebase.js` served from a tree of its own beside the release branch's other files
(the store is the only app file besides `sw.js` that differs from 909bd480):
- Red on v370 (909bd480): 59 passed, 30 failed. R (reload): Bea's family held `Baby-of-Ann`, `Ann-before-sign-in`
  and photo `pann`, and her screen showed them. T (same tab): Dana's family held Cleo's baby and pre-sign-in
  entry. U: Gail never booted (`users/{uid}` null); a household she owns held `Baby-of-Hana`; her screen showed
  Hana's baby and both entries. V: Ivy's unsent entry landed in Jo's family and never in Ivy's. O: Lia's family
  got Kim's baby and entry. H: Nora's baby stayed in memory and went into a household Pam owns; her older entries
  went into the record with her uid, and Pam's sign-in never finished. H2 red. D, K and N green.
- Red on 1a488e43 (the release branch before 3da1bdef): 83 passed, 6 failed, all in H and H2. When the read
  landed after Nora's sign-out, her two older entries came back into memory, the next signed-out save wrote them
  into the record with her uid, Pam's sign-in was refused (no `users/{uid}`, so her own entry never reached a
  family), and both entries were still in memory under Pam. The late failure set `cubbyHistoryPending` false
  while Sue's own history read was still out.
- Green on 3da1bdef: 89 passed, 0 failed, including Ann signing back in to all of hers (family and screen), N (a
  refused migration lets go of nothing), D (a deletion leaves no outbox of hers) and Pam's own entry reaching
  her family in H.
- First measured on 2026-11-19 with shorter versions of the test: 24 passed, 13 failed on 909bd480, the same red
  on b3236bab (the local-author hotfix stack), and 68 passed, 0 failed with the fix.
- Re-measured on 2026-11-24 with H3 added (106 checks): 73 passed, 33 failed on v370 (909bd480); 97 passed,
  9 failed on 1a488e43, all in H, H2 and H3; 106 passed, 0 failed on 3da1bdef. The three new red lines on both
  are H3's: Olive's two older entries in memory under Quinn, and Quinn's family told its history was in while her
  own read was still held. H3's "no family Quinn owns" line stays green on both, because the entries that read
  brings are marked as already on the server; its matcher finds them in Olive's own family first.
- Each part reverted on its own turns its own assertions red. Re-run on 2026-11-20 against 3da1bdef with the
  89-check test; M1 to M7 rebuilt from the 2026-11-19 descriptions, M8 and M9 new for part 4:

| Mutation of 3da1bdef | Red (failed of 89; M10 and M11 of 106) |
|---|---|
| M1 no release at the migration | R: at her family's first snapshot the record still held Ann's baby, entry and photo (1). Everything else stays green because the later cleanup catches it once her history is read, which is why R asks at the first snapshot |
| M2 sign-out keeps the family in memory (`leaveFamily` without `dropFamilyFromMemory`) | T: Dana's screen showed Cleo's two entries. U: Gail never booted, a household she owns held Hana's baby, and her screen showed Hana's. V: Ivy's unsent entry stayed in memory and landed in Jo's family and on Jo's screen. H: Nora's baby stayed in memory and went into a household Pam owns (13) |
| M3 no outbox for a sign-out from elsewhere | V: Ivy's unsent entry never reached her family (2) |
| M4 an older build's copy is never let go | O: the record kept Kim's copy, and Lia's family and screen got Kim's baby and entry (3) |
| M5 an older build's copy is let go whole | O: the entry no family holds was deleted from the phone (1) |
| M6 let go before the migration lands | N: after a refused migration the phone held none of her entries and not her baby (2) |
| M7 a deletion's own sign-out saves an outbox | D: `cubby-outbox:<her uid>:<family>` was left on the phone after her account was deleted (1) |
| M8 the history read's answer taken after a sign-out (no `histRef !== eventsRef` return) | H: Nora's older entries came back into memory and into the record with her uid, Pam's sign-in was refused, and both entries were in memory under Pam (5). H2 green |
| M9 the history read's failure clears the flag whoever is signed in | H2: Sue's family was told its history was in while her own read was still out (1). H green |
| M10 (2026-11-24, 106 checks) the answer taken whenever a family is attached (`if (!eventsRef) return`) | H3: Olive's two older entries came into memory under Quinn and stayed there, and Quinn's family was told its history was in while her own read was still out (3). H and H2 green, which is why H3 exists |
| M11 (2026-11-24, 106 checks) the answer taken whenever anyone is signed in (`if (!auth.currentUser) return`) | The same three H3 lines (3). H and H2 green |

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Release the record at the migration, empty memory at every sign-out, release an older build's copy, drop a history read that lands after a sign-out | Fix | DONE 1a488e43 and 3da1bdef (not yet live; the release ships as CACHE v379) |
| 2 | `next-account-cache-emu` gate in the emulator tier: reload, same tab, next person logs first, sign-out from elsewhere, older build's copy, migration still works, refused migration keeps all, a history read that lands or fails after a sign-out | Prevent | DONE 1a488e43 (H and H2 in 3da1bdef, H3 2026-11-24) |
| 3 | A fix to one sign-out path lists every `teardown` caller (the `leaveFamily` comment names all three) | Process | DONE (this doc + comment) |
| 4 | Aggregate count of households that share a baby id or entry id with another household, no content read, to size who was hit | Measure | TODO, founder's call |
| 5 | Decide what happens to data already copied into another family, and to orphan households (removals from production need the founder's explicit OK) | Decide | TODO, founder |
| 6 | J: a record still on the phone can still reach the next new account on that phone after its owner JOINS a family. Fix: stamp the record with its owner's uid when she is placed in a family without a migration, and copy only a record with no stamp or her own | Fix | TODO, own lane |
| 7 | Reset `window.LL.householdId` on sign-out | Fix | DONE 4efa86d7 (sign-in state in 055c594a, late invite answers in bdbf4023): teardown clears it with the seven other fields only the household snapshot writes (members, memberInfo, formerMemberInfo, hhPending, hhPendingLinks, pro, role). Left behind, the next account's feedback was stamped with the previous family's id and its family sheet listed that family's people, invites and Pro until its own snapshot landed. Gate: `stale-family-emu` |
| 8 | Account deletion leaves keys naming her uid on the phone: `cubby-seen-<uid>`, `cubby-teach:<uid>` and `cubby-teach-since-<uid>` (all three seen in case D), and any `cubby-outbox:<uid>:*` written outside the deletion's own sign-out. None is in the purge list. Only her own uid's sign-in ever reads them, so this is leftover data, not a leak. Fix: step 4 removes every key that names her uid | Fix | TODO, own lane |
| 9 | X: the same as 6 after its owner RETURNS to the family she already has. Same fix and lane as 6 | Fix | TODO, own lane |
| 10 | The next sign-in in a tab can stay on the loader after a sign-out in one of two open tabs, or with the history read still out (see Residual risk). Find why the first-boot failsafe misses after a change of account | Fix | TODO, own lane |

## Residual risk (known, not closed by this fix)
- A phone that migrated under an older build keeps that copy until its owner opens this build signed in.
- J and X: a record still on the phone can still reach the next new account on that phone after a join (J)
  or a return to an existing family (X). Both were reproduced with a record this build wrote, not only with one
  an older build left. Both behave the same on v370 (909bd480), so this release does not make them worse.
  Actions 6 and 9.
- The next sign-in can stay on the loader after a sign-out in one of two open tabs, or with the full history read
  still out. Seen on 909bd480 too. Nothing crosses to the next account in either (the review's two-tab probe, and
  H, H2 and H3 here), and H, H2 and H3 assert where the data goes, not that the screen boots. Action 10.
- What someone logs signed out and never signs in with goes to the next account that makes a family on that
  phone. The app cannot know who logged it. This is the migration working as designed (case K, and U's Gail).
- Data already copied into another family before this fix stays there until action 5 is decided.

## Lessons
- "One-time" in a design note is a claim, not a mechanism. Write the code that makes it true, or a gate that
  fails when it runs twice.
- When a fix closes one door, list every caller of the same path before calling it done.
- A suite that gives every person her own browser profile cannot see a shared phone. Model the shared device
  on purpose.
- A probe has to separate the right guard from the weaker ones next to it. H let its late read land with nobody
  signed in, so "is anyone signed in" passed it as well as "is this the family that asked"; H3 lands it with the
  next family attached.
- "Every sign-out empties memory" is only true until a read that was already out lands. Each async answer that
  writes into memory checks it is still for the family that asked.
- Assert identity. "Booted" must mean booted as this account, into the family the server names.
