# Firestore rules — cross-account emulator test

Run this **before publishing** the tightened `firestore.rules`. It verifies that the new
**memberInfo lock** and **app-blob maternal-data guard** block tampering, without breaking a normal
save or a household whose stored blob still carries a legacy `pregnancy` key.

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
