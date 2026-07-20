# Firestore rules — cross-account emulator test

Run this **before publishing** `firestore.rules`. It is the executable proof behind
every privacy promise on the marketing site — **109 cross-account assertions** covering household
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
> **Last run: 2026-07-19 against the published rules — 109 passed, 0 failed.** The A6 rules had
> already gone live at that point, so this was a verification rather than a gate. It confirmed every
> escalation attempt `departingSelf()` must refuse, and that the four legitimate paths still work.

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
- **Java** — the Firestore emulator needs a JRE. `brew install temurin` if you have Homebrew.
  If you don't, you do NOT need to install anything system-wide; a JRE in a scratch folder works:

  ```sh
  curl -sL "https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jre/hotspot/normal/eclipse" -o jre.tar.gz
  # verify against the checksum at https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=aarch64&image_type=jre&os=mac
  mkdir -p /tmp/jre && tar xzf jre.tar.gz -C /tmp/jre
  export JAVA_HOME="$(find /tmp/jre -maxdepth 3 -name Home -type d | head -1)"
  export PATH="$JAVA_HOME/bin:$PATH"
  ```
- Node 18+.
- **Port 8080 must be free.** `tools/serve.js` uses the same port, so stop it first
  (`pkill -f "node serve.js"`) or the emulator refuses to start.

The emulator config lives in `firebase.json` at the REPO ROOT, not here, and the npm script `cd ..`
before running: firebase-tools rejects a rules path that escapes the project directory, so a
`test/firebase.json` pointing at `../firestore.rules` cannot work. Running from the root also means
the suite tests the real file rather than a copy that can drift.

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

## App behaviour tests (no emulator, real Chrome)
Separate from the rules suite: these drive the real app in headless Chrome via `puppeteer-core`,
so they catch what DOM assertions alone miss.
```
node tools/serve.js &      # must be running: the tests load http://localhost:8080/app/?e2e=1
cd test && npm install && npm run test:app
```
- `fab-quicklog.test.js` — the quick-log FAB: on every view, session-dismissible, customisable,
  and per-user rather than in the shared household blob.
- `duedate-cycle.test.js` — the due date follows the cycle length she gave us, an unknown or
  28-day cycle stays byte-identical to the classic calculation, and the weeks-along door is
  deliberately NOT shifted.

**The trap both files exist to stop repeating:** top-level `let` declarations (`pregDraft`, `view`,
`pregView`) are lexical bindings, NOT window properties. `window.pregDraft = x` silently creates a
second object the app never reads, and the test then asserts against a code path that never ran.
Assign them bare. Four "failures" in these suites have been the harness, not the app.
