# Firestore rules — cross-account emulator test

Run this **before publishing** `firestore.rules`. It is the executable proof behind
every privacy promise on the marketing site — **105 cross-account assertions** covering household
access, invite/join role integrity (SEC-3), event/photo authorship immutability (SEC-4), pre-join
read exposure (PRIV-4), note audience privacy, **maternal `mhealth` with mood NEVER shareable**,
the owner-owned pregnancy journey, server-only Pro entitlement, and the top-level collections.
It also verifies the **memberInfo lock** and **app-blob maternal-data guard** don't break a normal
save or a household whose stored blob still carries a legacy `pregnancy` key.

It also covers **A6 account deletion** (added 2026-07-19): the `departingSelf()` branch that lets a
caregiver remove themselves — required, because the `isMember()` branch freezes the members map, so
without it a caregiver could not delete their own account at all — and the 15 assertions proving it
cannot become a privilege-escalation path (leaving while promoting yourself, removing someone else
on the way out, writing another member's tombstone, smuggling `deleteAfter`, granting yourself Pro,
a stranger using the same write shape).

> Expanded 2026-07-12 (see `design/RULES-REVIEW.md` and `design/RED-TEAM-REVIEW.md`), and again
> 2026-07-19 for A6.
>
> **⚠ The A6 rules were published on 2026-07-19 WITHOUT this suite having been run.** It has never
> executed on any machine: it needs a JRE (`brew install temurin`) and the session that wrote it had
> neither Java nor Homebrew. The rules are reasoned and syntax-clean, not proven. Running this is now
> a verification rather than a gate — and if it fails, the fix is urgent, because those rules are
> already serving live traffic.

## What it checks
Two accounts (an owner + a caregiver) plus a stranger, against `../firestore.rules`:

**Must succeed** — caregiver saves the app blob (normal persist); caregiver edits their own
memberInfo; owner saves the app blob; owner edits another member's memberInfo (remove/rename);
caregiver edits their own memberInfo on a legacy-blob household; caregiver writes a clean blob over a
legacy one.

**Must fail** — caregiver edits *another* member's memberInfo; anyone injects `pregnancy`/`mhealth`
into the circle-shared app blob; caregiver promotes self to owner / changes `ownerId` / sets `pro`;
stranger reads or writes the household.

## Prereqs
- **Java** — the Firestore emulator needs a JRE (e.g. `brew install temurin`).
- Node 18+.

## Run
```
cd test
npm install
npm run test:rules
```
This boots the Firestore emulator, loads `../firestore.rules`, runs the checks, and prints
`N passed, 0 failed`. Exit code 0 = all green.

## Publish (only after green)
Firestore rules live in Firebase, separate from the Cloudflare deploy. Publish with:
```
npx firebase deploy --only firestore:rules --project little-log-a9caa
```
…or paste `firestore.rules` into Firebase Console → Firestore Database → Rules → Publish.

## Note
`appBlobClean()` in the rules whitelists against the maternal keys; the `cleanApp()` helper in
`rules-test.js` mirrors `appBlobFromState()` in `app/store-firebase.js`. If you add a new key to the
app blob there, no rule change is needed (the guard is a denylist of maternal keys), but keep this
test's `cleanApp()` representative.
