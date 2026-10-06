# Post-mortem: a genuine dose ticket for the wrong person

- **Date:** 2026-10-06
- **Severity:** P1 (security). A signed-in stranger could write a medicine event into another family's
  record, and a removed caregiver kept being told that family's medicines. Found by reading `main` at
  952a7496. Not exploited by us and not tested against production. Whether anyone else used it is
  **not yet known**: see corrective action 6.
- **Duration:** 2026-08-14 (d8337da0, "Log a dose from the notification: the server half") until the
  fix reaches production. Fifty-three days and counting at the time of writing.
- **Status:** FIX READY, NOT DEPLOYED. Waiting on the founder's OK to push `main`.
- **Author:** Claude (Opus 5.5), for the founder

> Policy: **every breakage gets a documented, blameless 5-Whys post-mortem.** Blameless = focus on
> systems and decisions, not people. Be honest, including our own contributing actions. If a "why"
> is inferred rather than proven, say so.

## What happened
The "Log it" button on a medicine reminder works by a ticket. The cron (`sendPushReminders`) signs a
small statement, "log this medicine for this child in this household as this person", and puts it in
the push. Tapping the button sends the ticket to `POST /api/dose`, which checks the signature and
writes the event with the service account.

Two facts made that unsafe together:

1. The cron took the household from `users/{uid}.householdId` and the medicine's name, dose, unit and
   child from `users/{uid}.push.due`. `firestore.rules` lets a signed-in user write their own
   `users/{uid}` doc freely, so every one of those values is the user's own claim.
2. `/api/dose` checked only the signature. It never read `households/{hid}.members`. Because the
   service account writes past `firestore.rules`, the events rule (`uid in members && authorId == uid`)
   never ran either.

So anyone signed in who learned a household id could set their own `householdId` to it, add a push
token and a `push.due` entry naming any medicine, receive a genuine ticket on the next 15-minute tick,
and post a medicine event into that family's record as themselves. Household ids are not secret to
everyone: a removed caregiver has one, and anyone who ever held an invite link can `get`
`inviteLinks/{token}`, which carries the `householdId`.

Three smaller gaps rode along: a removed member kept receiving reminders (and the morning digest) that
named the child's medicines; a dose logged in the app and then again from the button produced two
medicine events, because the plan's already-logged check (§2.5 step 4) was never built; and
`/api/dose` had no rate limit (§2.5 step 1).

## Impact
- **Integrity of the medicine record.** A forged entry would sit in a family's timeline, and in the
  doctor report built from it, as a dose of whatever the attacker named. A removed caregiver's entry
  would even carry their old name (`loggerName` reads `formerMemberInfo`). The medicine log is the one
  record in Cubby someone may act on clinically, and the already-logged rule means a forged recent dose
  can make the app question the real one.
- **Disclosure to removed members.** Their next reminders kept naming the child's medicines until the
  due list they last wrote ran out (48 hours of doses, up to three mornings of digest).
- **Not affected:** reading the family's record. Nothing here let an outsider read events, photos or
  the app blob; the hole was write-only plus the reminder text a removed member already had.
- **Unknown:** whether it was ever used. That needs a read-only query of production (action 6).

## Root cause
A privileged write path was designed as "trust the signature", without listing which rule checks the
service account bypasses and putting each one back in code. The signature proved who the ticket was
for. Nothing proved that person belonged to the household the ticket named. Confirmed by reading the
code; reproduced against the real `worker.js` in `test/dose-membership.test.js` (47 failures on the
unfixed `worker.js`).

## 5 Whys
1. **Why could a stranger write a medicine event into another family's record?** `/api/dose` wrote
   whatever a validly signed ticket named, with the service account, which `firestore.rules` does not
   govern.
2. **Why would a valid ticket name a family its holder does not belong to?** The cron minted tickets
   for whatever household `users/{uid}.householdId` named. That field is the user's to write, so it is
   a claim; the cron treated it as a membership.
3. **Why did neither half check membership?** The design (docs/plans/2026-08-13-dose-from-notification.md
   §2.5) argued the provenance trade-off as "the nonce proves the write was authorised by a notification
   we sent to a token registered to that uid". That proves the uid. It never asked where `hid` came
   from. The server half shipped on 2026-08-14 with signature checks only; §2.5 steps 1, 4, 6 and 7
   were never built and nothing tracked that they were missing.
4. **Why did the gate stay green?** `test/dose-ticket.test.js` was written against the threat the
   design named: a stolen or edited ticket. It mirrors the two ticket functions and asserts source
   strings. It had no world with a stranger in it, so it could not go red for a genuine ticket held by
   the wrong person. A gate can only fail for a threat someone thought to stage.
5. **Why did nobody stage that threat?** There is no rule in this repo that says a service-account
   write must re-establish the rule it bypasses. Review checked what the ticket guaranteed rather than
   what the events rule guaranteed. **Root cause:** privileged write paths are designed and reviewed
   against their own credential, not against the access rule they replace.

## Contributing factors (blameless)
- `fsGet` returns `null` for both 404 and 5xx. Any membership check written with it would have read
  "Firestore is down" as "no such household", which is one edit away from writing anyway.
- The plan's already-logged query (`time >= t - i`) would have matched the previous dose of every
  every-X medicine and refused every tap. The client's own rule (`now - last.time < iv`, `logDose`) is
  the right one and is what shipped here.
- The plan (2fe16608) and the code with its gate (d8337da0) were written together, both co-authored by
  Claude Opus 5, so the gate inherited the plan's threat model rather than testing it.

## What fixed it
One commit, server only, ships by deploying `main`:
- **Mint (cron).** Before anything in a user's due list is sent, one masked read of
  `households/{hid}` (`members`, `deleteAfter`). Sent only to an owner or caregiver of a household that
  is not flagged for deletion. A non-member's entries are refused for good (the cursor moves, so they
  are not re-read every tick). A failed read sends nothing and holds the cursor, so the next tick asks
  again. A `householdId` that is not a plain document id is refused without a read. The digest is
  gated too, because it names the medicines.
- **Redeem (`/api/dose`).** Rate limited per IP (`DOSE_RATE_LIMITER`, 10/60s, falls back to
  `SIGNIN_RATE_LIMITER`). Then a masked read of `members`, `deleteAfter`, `app.meds`, `app.babies`
  through the new `fsGetStrict`, which keeps 404 and 5xx apart. Requires an owner or caregiver, no
  `deleteAfter`, the medicine in `app.meds`, the child in `app.babies`, and the medicine's own child if
  it is pinned to one. Name, dose and unit come from `app.meds`, never the ticket. Every refusal is the
  same 401; any read failure is a 503 and writes nothing.
- **Already logged.** A medicine event for the same medicine and child, not deleted, not in the
  future, less than one interval ago returns `{ok:true, already:true}` and writes nothing. The interval
  is `medIntervalMs` ported to the Firestore shape. The query is a single-field range on `time`, so no
  composite index is needed.
- **Gate.** `test/dose-membership.test.js` imports the real `worker.js` and drives the real cron and the
  real fetch handler against a fake Firestore that honours field masks. 72 behavioural and config
  checks: on the unfixed `worker.js` 47 failed and 25 passed (the passes are the delivery controls, the
  near-miss companions and the config lines, which live outside `worker.js`); on the fix all 72 pass.
  `--self-test` then re-breaks the fix 14 ways in temp copies and requires each to go red, for 86 in
  all. Wired into `tools/gates.js` as `dose-membership`.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Cron checks membership and `deleteAfter` before sending anything | Fix | DONE (deploy pending) |
| 2 | `/api/dose` re-checks membership, household, medicine and child; fields from `app.meds`; fail closed | Fix | DONE (deploy pending) |
| 3 | Already-logged check inside the medicine's interval | Fix | DONE (deploy pending) |
| 4 | `DOSE_RATE_LIMITER` binding in `wrangler.toml` | Fix | DONE (deploy pending) |
| 5 | `test/dose-membership.test.js`, real worker, 14-mutant self-test, wired into `tools/gates.js` | Prevent | DONE |
| 6 | Read-only production audit: every event with `via == 'notification'` whose `authorId` is not, and was not, a member of that household (check `members` and `formerMemberInfo`) | Process | TODO (founder: needs the service account) |
| 7 | §2.5 step 6 (drop now-wrong `push.due` entries after a dose logged from the button) and step 7 (ticket ledger) | Fix | TODO |
| 8 | The web button says "Dose logged" for `already:true`; it should say it was already logged, and by whom. Needs an `app/sw.js` CACHE bump | Fix | TODO |
| 9 | Audit every other service-account write in `worker.js` for a rule it bypasses without re-checking | Prevent | TODO |
| 10 | Tighten the `users/{uid}` write rule so `householdId` must match a real membership, only with emulator coverage of every sign-in path (store-firebase.js resolveHousehold and the join paths) | Prevent | TODO, deliberately not in this fix |

## Lessons
- A signature proves who a statement is for, not that they are allowed. When the service account
  writes past a rule, write down the rule's checks and put every one back in code, fresh, at the moment
  of the write.
- A value the user can write is a claim. `users/{uid}` is the user's; anything read from it that grants
  access to someone else's data has to be checked against data the user cannot write.
- A security gate has to stage the attacker. Testing that the credential cannot be forged says nothing
  about a genuine credential in the wrong hands.
- Distinguish "not there" from "could not look". A getter that returns null for both turns an outage
  into a decision.
