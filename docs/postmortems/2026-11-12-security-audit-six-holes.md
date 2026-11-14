# Post-mortem: six security holes found by the November 2026 audit

- **Date:** 2026-11-12
- **Severity:** P1 (latent; no sign any was used)
- **Duration:** first hole 2026-06-10; the last ones from 2026-08-20; found 2026-11-11; fixed at commit 866851ac (live 2026-11-13 07:28 UTC, sw little-log-v365) and rules published 2026-11-13 05:34 UTC
- **Status:** CLOSED 2026-11-13: rules published, client live, invite cleanup applied (3 leftover invites deleted, 1 pending row cleared, 1 genuine invite kept; a re-run found nothing left)
- **Author:** Claude, for the founder

> Blameless. Each "why" was checked against `git log` and the code; anything inferred says so.

## What happened
The founder asked for "extremely tight" security across the app, iOS and the PWA. A five-lane audit of live main (1a6df125) ran on 2026-11-11, with a separate skeptic per lane. I then re-checked six findings by hand. All six were open on live:

1. **A caregiver could erase a family.** The household rule let a caregiver, or anyone joining, set `deleteAfter`. The purge cron deleted every flagged household without checking whether anyone was still in it. PITR is off, so nothing could be recovered. (Since 2026-07-18, b6272a86.)
2. **A removed member could walk back in.** Link joins had no single-use check on the join itself, and the `inviteLinks` doc outlived the join. A lingering email invite also let a removed person rejoin, as owner if it was a co-owner invite. (Links since 2026-08-09, ecf883be.)
3. **Invite squatting and silent joins.** Anyone could write an invite for any address, and a new user whose address matched was joined with no prompt. A stranger could pull a new parent into the stranger's family. (Silent join since at least 2026-07-19, 6d89b20d.)
4. **Stored XSS.** One member's relationship label, and an event id, reached `innerHTML` and `onclick` unescaped. The CSP allows inline script, so a caregiver's code ran as the owner. (The label path since 2026-06-10, 7828c0b6.)
5. **Sign-in code race.** The tries counter was read and then patched, with no precondition. Reissuing a code reset the budget, and per-IP limiters keyed on a full IPv6 address. (Since 2026-08-19, 6dc7d800.)
6. **Page views spent the family database.** Every HTML GET, a 404 included, made a Firestore write with the master key. A loop of requests could use up the day's free writes and stop every family's sync. (Since 2026-08-20, 12bdb65d.)

## Impact
No sign of use. These are read-only counts over production on 2026-11-12, printing aggregates only:
- No family has a stray deletion flag.
- No removed member has a leftover invite.
- Of 4 invites, 3 are leftovers from people who already joined, and 1 is genuinely pending.
- 2,286 stored strings were scanned and none looks like markup or script. The matcher was tested to catch seven payload shapes.
- Run over every shared log, journey, health doc, event and note, the new ingest changes no stored field.

The repo is public, so the live rules were readable by anyone the whole time.

## Root cause
Rules said **who** may write a document, but not **which fields** and **what values**. The server code trusted whatever the rules let through. Each hole is a field that one role could write and another role, or the cron, then acted on.

## 5 Whys (the erase-a-family hole; the others share whys 3 to 5)
1. **Why could a caregiver erase a family?** The caregiver branch of the household rule did not pin `deleteAfter`, and the purge deleted anything flagged.
2. **Why was it not pinned?** The rule listed what a caregiver may not touch, instead of the few keys they may touch. `deleteAfter` arrived later (2026-07-18), and the list was never revisited.
3. **Why did no test catch it?** The rules suites checked that legitimate writes succeed and that a handful of named attacks fail. Nothing enumerated every top-level key against every role. Two-caregiver-journey ran with open rules.
4. **Why did the purge trust the flag?** It was written as the second half of Delete account. Its author knew the only legitimate writer was the last member out, but the code never checked that.
5. **Why was there no second lock?** We had no rule that a destructive cron re-checks its own premise before acting. Each layer assumed the other was the guard. → **Root cause:** deny-list rules plus servers that trust them.

## Contributing factors (blameless)
- Several test layers stubbed `fetch`. One round of the sign-in fix was "green" against a stub while real Firestore refused the write shape, and the purge's first unflag had the same trap. Both were caught by emulator runs before shipping.
- The CSP allows `unsafe-inline` because of about 926 inline handlers, so escaping was the only XSS defence.
- PITR is off, so an erase would have been permanent.

## What fixed it
Four lanes, each fixed and then attacked by a fresh skeptic, for three rounds. They were merged at 2bc142f0, a11c0d88, f5c34546 and 973c7bdf, plus 6657c075.
- **Rules.** Each role gets an allow-list of keys. Joins and invite consumption are one atomic batch (`getAfter`/`existsAfter`). Leaving requires the tombstone. A household is never born flagged.
- **Worker.** The purge refuses any household that still has members, and clears the flag with a JSON-precondition commit. Sign-in spends are conditional, with a per-address hourly ceiling that a reissue cannot reset. Limiters key on the IPv6 /64, or the /48 for page views. Page views moved to D1 with a daily cap.
- **Client.** A newcomer is asked before joining, naming who invited them. Everything another member writes passes through `cubbyIngest` before it reaches state, and the remaining raw sinks are escaped.
- **One-off.** `tools/invite_cleanup.js` deletes lingering invites. Dry run first, counts only.

Then two more rounds of review on the merged tree, each fix attacked by a fresh skeptic (859de3e5, 028526cc, 5e6d0d54):
- **The fixes' own side effects.** A per-address sign-in ceiling let one laptop lock a parent out of code sign-in, so the ceilings are now split per network. An older cached app under the new rules could spend a link and strand it, so a link claim now lands only in the same batch as the join. A squatter could write the consent sheet's reassurance, so an invite now carries the sender's own proven address and the sheet shows it as data.
- **Older holes the review found.** Rules trusted an unproven sign-in address; they now require `email_verified` wherever an address decides access, and code sign-in claims an unproven account for the person who proved the inbox. A removal now closes every live link. Account deletion erases maternal health records and pregnancy photos. Invite emails have a per-account day ceiling, and no client can delete a family document.
- **Caught on real emulators, not stubs.** The first claim call (`deleteProvider`) erased the account's email, which would have split a parent into two accounts. A removal made offline was never issued.

## Corrective actions
| # | Action | Type | Status |
|---|--------|------|--------|
| 1 | Allow-list household rule per role, gated by household-guard (emulator) | Fix | Done |
| 2 | Purge re-checks members; purge-guard and purge-unflag-emu | Fix | Done |
| 3 | Atomic join/consume, consent sheet; invite-consent, invite-join | Fix | Done |
| 4 | Ingest plus escaping; xss-sink and xss-leaf, with mutants | Fix | Done |
| 5 | Conditional spend, hourly ceilings; signin-code-emu, signin-budget, a canary that spends | Fix | Done |
| 6 | Page views off Firestore; page-stats | Fix | Done |
| 7 | Publish firestore.rules; run invite_cleanup dry run, then --apply | Fix | Done 2026-11-13 |
| 8 | Any Firestore REST write is tested against the emulator, never only a stub | Prevent | Rule in ways-of-working |
| 9 | Remove CSP unsafe-inline (move ~926 inline handlers to delegated listeners) | Prevent | TODO |
| 10 | Turn on PITR and delete protection | Prevent | Founder decision |
| 11 | Identity Toolkit writes tested against the Auth emulator (signin-claim-auth) | Prevent | Done, rule in ways-of-working |
| 12 | Rules require email_verified wherever an address decides access | Fix | Done |
| 13 | Owner-only link tokens; a removed mother erases her own maternal records; one invite per family per address | Fix | Queued |

## Shipping notes (2026-11-13)
- The rules were published at 05:34 UTC, from a scratch copy of the exact tested file (identical to 5e6d0d54's). The client push began at once.
- The first push, with the full pre-push check, stopped after 56 minutes. Two browser checks, fab-quicklog and duedate-cycle, could not load puppeteer-core: this worktree had no test/node_modules link. The hook guards only tools/node_modules. With the link added, both passed (20/20 and 17/17).
- The same code (5e6d0d54, plus a docs-only commit) had passed all 133 checks, emulator tier included, in a clean clone two hours earlier. With the founder's yes, the release was pushed with --no-verify. The project hook allows only a person to do that, so the founder ran the push himself. The fallback push's full pre-push suite then passed 116/116; it was rejected only because his push had already landed.
- Follow-ups: the hook must refuse up front when any node_modules the suite needs is missing (queue Q6). Never pipe a push through tail: the first failure list was cut off.

## Lessons
- A rule that lists what is forbidden ages badly. A rule that lists what is allowed fails closed when a field is added.
- A destructive job re-checks its own premise, whatever the layer above promises.
- A green test against a stubbed `fetch` proves the stub. Firestore's REST shapes bit us twice, and Identity Toolkit once.
- The repo is public. Push a rules-side fix and publish the rules in the same sitting.
