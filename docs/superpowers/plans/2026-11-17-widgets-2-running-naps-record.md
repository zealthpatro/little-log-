# Running naps in their own record (C4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every family's running nap moves out of the shared household blob into `households/{hid}/timers/{babyId}`, written only by transaction, so a stale phone can never resurrect or erase a nap and an app stop and a widget stop of one nap are one event.

**Architecture:** store-firebase.js gains a timers listener, a small in-memory model (`napDocs` from the record, `legacyNaps` from older blobs) that it lays over `state.timers[bid].sleep`, and five transactional writers (`LL.napStart`, `napStop`, `napAck`, `napDiscard`, `napMove`) that resolve a `NapResult` and never write blind. index.html's six sleep write paths call them when the page has a household and keep today's synchronous local code when it does not. A fold moves a nap an older cached build left in `app.timers` into the record once, and clears any timer whose start already has a logged sleep.

**Tech Stack:** Firebase compat SDK transactions (app), Firestore rules + `@firebase/rules-unit-testing`, the Firestore and Auth emulators, puppeteer-core against `tools/serve.js`, node `vm` lifts of the real functions, worker.js purge over Firestore REST.

**Spec:** /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/specs/2026-11-16-home-screen-widgets-design.md (C4; 6.6 `nap.ack`; 6.7 first paragraph, "the app's own Start and Stop" and "server-aligned time" (Contract note 6); 6.12 race test; 7 Phase B first bullet; 9 items 5 and 6), and the roadmap /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/plans/2026-11-17-widgets-0-roadmap.md (P2; 2.2 NapResult, LL.nap*, napMove, napCloud; 2.4 running nap, sleep event, revive, fold rule, stampAuthor; 2.10 gates).

## Contract notes

Notes 1 to 5 are accepted into the roadmap (17 Nov); this plan builds to them. Note 6 is a deviation from spec 6.7 for the founder to see in roadmap 2.4.

1. **Fold rule (roadmap 2.4, replacing "(exists:false)").** A legacy `app.timers.<bid>.sleep` moves into the doc only when the doc has no `sleep` (missing or empty). The doc wins when it holds one, and the legacy key is removed in the same transaction. Why: clearing is an `update` whose mask names `sleep`, so a stopped nap leaves an empty `timers/{bid}` document behind for good, and `exists:false` would silently drop every nap an older cached build starts for that baby after its first new-build stop.
2. **NapResult gains `already?: true`** (roadmap 2.2). `{ ok: true, already: true }`: nothing was written because the nap was already in the state the call asked for (a start that found one running, a stop whose `sleep-<bid>-<start>` event is live). It mirrors the nap route's `already` (2.8). Without it the app cannot tell "Sleep logged" from "someone else just stopped it", and would offer Undo on another member's entry.
3. **Two additions to 2.2, no renames.** `LL.napMove(babyId, expectStart: number, newStart: number) -> Promise<NapResult>`: setTimerStart (index.html:5113-5137) moves a running nap's start. `LL.napCloud() -> boolean`: true when this page writes a household's record (`hhRef` set). The local path stays synchronous: sleep-timer, timer-banner, undo-away, first-entry and wake-window call `stopSleep('b1')` and read `state` on the next line.
4. **`napStart` with two babies omits `state`** (roadmap 2.2): one `{start, ack}` cannot describe two; every baby's state arrives through the listener.
5. **A stop revives a soft-deleted event and never answers `already` for it** (roadmap 2.4 and 2.8). P4's Undo of a stop restores start S and soft-deletes `sleep-<bid>-<S>`; the next stop of that nap finds a `deleted:true` event. P2's app stop revives it in its transaction (author or owner, as firestore.rules:523-525 allow); P4's Worker revives it with an update under `exists:true` (P4 implements that half).
6. **Server-aligned start: deviation, the phone's clock (spec 6.7 "The app writes start from server-aligned time where it has it").** The app stamps a nap's start and its stop's end with `now()` (index.html:2096), as it stamps every other entry. Why not an offset: the Firebase web SDK exposes no document `updateTime`, and the record's shape (2.4) leaves no room for a server timestamp, so a nap write gives the app no server time; and a nap shifted by an offset while the same phone's feeds and nappies are not would sit out of order on her own timeline. The bound: the app never writes a start ahead of its own clock (startSleepFrom takes a day off a future pick, index.html:6228; setTimerStart refuses one, :5123), and P4's Worker answers needsApp and writes nothing for a stored start more than `futureStartMs` 300000 ahead of the server or an end at or before the start. So a skewed phone can send a widget Stop to the app, never make a wrong write; a nap the app starts and the widget stops is off by the phone's skew, seconds on a phone that sets its time from the network. Proposed line for roadmap 2.4 (the roadmap fixer adds it): "App clock (deviation from spec 6.7, founder to see): the app stamps nap starts and ends with the phone's clock, as every entry; P4's futureStartMs and end-after-start checks send a skewed nap to the app instead of writing." Task 4 Step 1a B2 pins it.

## Preconditions (before Task 1)

- Rebased on P1 (2026-11-17-widgets-1-web-foundations.md): `window.CubbySince.sleepEventId`, `window.CubbyWidgetCopy`, `stampAuthor`, `node tools/widget_gen.js` and the `widget-parity` gate exist. Check: `grep -n "sleepEventId" app/since-rules.js && grep -n "CubbyWidgetCopy" app/since-rules.js`.
- Every line number below is for 58733b16. P1 moves index.html and store-firebase.js; re-find each anchor by the function name cited before editing.
- `tools/node_modules` is linked (`ls tools/node_modules/puppeteer-core`). Print the served version before any browser verdict: `grep -o "little-log-v[0-9]*" app/sw.js`.

## Global Constraints

- Record: `households/{hid}/timers/{babyId}` = `{ sleep?: { start: int ms, ack?: int ms, by: uid } }`, no other field (roadmap 2.4).
- App writes are transactions; clearing is an `update` whose mask names `sleep`; no client deletes the document (roadmap 2.4).
- Sleep event id `sleepEventId(babyId, start)` = `'sleep-' + babyId + '-' + start` for app stops and corrections (2.2, 2.4; today uid(), index.html:6240, :6287).
- App event fields `{ id, authorId, babyId, type: 'sleep', time: start, end }`; `authorId` is the writer's uid (firestore.rules:517-525); no `via` (that is the Worker's).
- Feed timers stay in the blob as `app.timers.<bid>.feed` (spec 6.7 "Feed timers stay put").
- Fold rule: a timer whose start S has a live sleep event for that baby with `time == S` (any id) is stopped and any client clears it; a legacy `app.timers.<bid>.sleep` moves into the doc only when the doc has no `sleep` (missing or empty), the doc wins when it holds one, and the legacy key is removed in the same transaction (roadmap 2.4).
- A stop whose `sleep-<bid>-<start>` event exists with `deleted: true` revives it in the same transaction and never answers `already` (roadmap 2.4, 2.8).
- Clock: nap starts and ends are the phone's `now()`, as every entry; no offset (Contract note 6; bounded by P4's `futureStartMs` 300000).
- Offline: say so, never a blind write, nothing queued (C3; spec 9 "say so plainly, never a blind write").
- Long naps unchanged: `SLEEP_NUDGE_MS = 12*3600000`, `SLEEP_MAX_MS = 24*3600000` (index.html:2128); the snooze counts while `now - ack < 21600000` (index.html:5012; `ackFreshMs`).
- Budget: one nap write settles within 10 000 ms (spec 6.7 "a 10-second budget"); `NAP_BUDGET_MS = 10000`.
- Baby ids can start with a digit (uid(), index.html:2097); every path, id and field path is proven with one (spec 6.12).
- Local-only users (no household) keep local timers exactly as today (roadmap P2).
- Copy: DESIGN.md §A1/§A7, warm, brief, second person, sentence case, no em-dashes, one sentence each; new strings live in docs/widgets/widget-copy.json with `on: ["app"]` only.
- Live for a release before P4 (roadmap section 4, step 2).

## Review Focus

1. A household blob snapshot (a partner adds a medicine, or moves a feed timer) lands while a nap runs: the nap must stay on screen and must never ride back into, or be erased from, the blob. Test: Task 3 Step 1b (blob-merge section 7) and Task 4 Step 1b (section 8).
2. An older cached build on the partner's phone writes `app.timers.<bid>.sleep`: a stale copy must never resurrect a stopped nap, and a nap it starts after any earlier stop must not be lost. Test: Task 5 Step 1 (race section "older builds").
3. A nap restarted at the same whole minute as one that was stopped and then deleted (startSleepFrom and setTimerStart pick minutes): its event must not land on the deleted event's id. Test: Task 4 Step 1a (nap-offline section B7).
4. Sign-out or a household switch while a nap runs: the next account must never see, or write to, the previous family's timer. Test: Task 3 Step 1c (race section 11).
5. Stop past 24 hours on the household path must ask and never write, exactly as the local path does. Test: Task 4 Step 1a (nap-offline section B6).

---

### Task 1: The timers rules

**Files:**
- Modify: firestore.rules (insert after the events block, :515-528, inside `match /households/{hid}`, using `pm()` at :513)
- Modify: tools/fuzz_rules.js (household seed :96-126, subcollection-write templates :182-207, collection-group loop :180)
- Modify: tools/gates.js (EMU_GATES, after `links-leave-rules` at :330)
- Create: test/timers-rules.test.js
- Test: `node tools/gates.js --emulator --only=timers-rules`, `node tools/gates.js --emulator --only=fuzz-rules`

**Interfaces:**
- Consumes: `pm()` (firestore.rules:513).
- Produces: `match /timers/{babyId}` with read for members, create/update for members within the pinned shape, delete for nobody; EMU gate `timers-rules` = `{ name: 'timers-rules', emu: 'node timers-rules.test.js' }`.

- [ ] **Step 1: Write the failing test.** test/timers-rules.test.js, the pattern of test/links-leave-rules.test.js (`initializeTestEnvironment({ projectId: 'demo-cubby', firestore: { rules } })`; rules from `process.env.RULES_FILE`, else `--rules=<file>`, else ../firestore.rules; prints `TIMERS-RULES: PASS|FAIL`). Seed (rules disabled) households/H with `members { O: 'owner', C: 'caregiver' }`, `formerMemberInfo { R }`, `app.timers {}`, and `timers/1a2b3c = { sleep: { start: 1700000000000, by: 'O' } }`. Every write in the exact shape store-firebase.js will send:
  - MUST SUCCEED: C starts a nap on a new doc `timers/42x` with `set({ sleep: { start: 1700000100000, by: 'C' } })`; C acks O's nap `update({ 'sleep.ack': 1700000200000 })`; C clears it `update({ sleep: FieldValue.delete() })` (the doc stays, empty); C stops it in one batch: the clear plus `events/sleep-1a2b3c-1700000000000` set with `authorId: 'C'`; C moves O's nap `update({ sleep: { start: 1699999000000, by: 'C' } })`; O and C read; the fold's two writes in one batch by C: `set` of `timers/1a2b3c` and `update(households/H, new FieldPath('app','timers','1a2b3c','sleep'), FieldValue.delete())`; the 866851ac client's blob write `update({ 'app.timers': { '1a2b3c': { sleep: { start: 1 } } }, updatedAt })` still passes (old client shape against the new rules).
  - MUST FAIL: R, a signed-in stranger and anonymous read or write; C starts signed `by: 'O'`; C acks while changing `by`; C moves O's nap keeping `by: 'O'`; a top-level field beside `sleep`; `sleep.note`; `start` as a string, as `1.5`, as `0`; `ack` as a string; `sleep: { ack }` with no `start` (an ack-only timer); `sleep` with no `by`; delete the doc; `collectionGroup('timers')`.
- [ ] **Step 2: Run it and see it fail.** Wire the gate first, then `node tools/gates.js --emulator --only=timers-rules`. Expected: `FAIL timers-rules`, every MUST SUCCEED line `FAIL` (no rule matches `timers`, so everything is denied), `TIMERS-RULES: FAIL`.
- [ ] **Step 3: Implement.** In firestore.rules after :528:
  ```
  match /timers/{babyId} {
    function napShapeOk(n) {
      return n is map && n.keys().hasAll(['start', 'by']) && n.keys().hasOnly(['start', 'ack', 'by'])
        && n.start is int && n.start > 0 && n.by is string && (!('ack' in n) || n.ack is int);
    }
    function napSignedOk() {   // a new or moved start is signed by its writer; an ack keeps the signature
      return !('sleep' in request.resource.data) || request.resource.data.sleep.by == request.auth.uid
        || ( resource != null && 'sleep' in resource.data
             && resource.data.sleep.start == request.resource.data.sleep.start
             && resource.data.sleep.by == request.resource.data.sleep.by );
    }
    allow read: if request.auth != null && request.auth.uid in pm();
    allow create, update: if request.auth != null && request.auth.uid in pm()
      && request.resource.data.keys().hasOnly(['sleep'])
      && ( !('sleep' in request.resource.data) || napShapeOk(request.resource.data.sleep) )
      && napSignedOk();
    allow delete: if false;   // clearing is an update; the purge uses the service account
  }
  ```
  The rules do not check that `babyId` is in `app.babies` (a list of maps cannot be searched in rules); the app writes only ids from `state.babies` and P4's Worker checks its own.
  In tools/fuzz_rules.js: seed `docs[P + 'timers/1a2b3c'] = { sleep: { start: 1, by: 'O' } }`; templates `read a running nap` (MEMBERS), `LIST running naps` (MEMBERS), `start a nap as yourself` (MEMBERS, `set timers/new { sleep: { start: 3, by: a } }`), `start a nap signed as the owner` (['O']), `say the nap is still going` (MEMBERS, `sleep.ack`), `clear the nap` (MEMBERS), `move the nap, signed as yourself` (MEMBERS), `put another field on a nap` ([]), `delete a nap record` ([]); add `'timers'` to the collection-group loop at :180.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --emulator --only=timers-rules` then `--emulator --only=fuzz-rules`. Expected: both rows `ok`, `TIMERS-RULES: PASS`, `GATES: PASS`. The MUST FAIL lines also pass with no rule at all, so see them red on a staged hole: copy firestore.rules to `$(mktemp -d)/open.rules` with `request.auth.uid in pm()` removed from the timers `create, update` line, then `RULES_FILE=<that file> node tools/gates.js --emulator --only=timers-rules` (the test reads `RULES_FILE`, then `--rules=`, then ../firestore.rules; gates.js passes the environment through): `FAIL` on the stranger and removed-member writes. The same file through the fuzzer, on a port you checked is free: `FS_PORT=7747 node tools/fuzz_rules.js --rules=<that file> --seed=777 --seconds=20`: a disagreement naming a nap template, non-zero exit.
- [ ] **Step 5: Commit.**
  `git add test/timers-rules.test.js && git commit -o firestore.rules tools/fuzz_rules.js tools/gates.js test/timers-rules.test.js -m "A running nap gets its own record in the rules: members only, one nap per baby, signed by whoever starts it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

FOUNDER STEP: publish firestore.rules in the same sitting as the push of this plan, rules first (a new client writing `timers` against the old rules is refused for every family).

---

### Task 2: The household purge erases running naps

**Files:**
- Modify: worker.js:1962 (`HH_SUBCOLLECTIONS`)
- Modify: test/purge-erase-emulator.test.js (`RECORDS`, :66-81; the per-kind check at :122)
- Test: `node tools/gates.js --emulator --only=purge-erase-emu`

**Interfaces:**
- Consumes: `__purge.purgeDeletedHouseholds(env)` (worker.js:2138).
- Produces: `HH_SUBCOLLECTIONS = ['events', 'photos', 'notes', 'memberEmails', 'ownerLinks', 'timers']`.

- [ ] **Step 1: Write the failing test.** Add to `RECORDS(hid)`: `['households/' + hid + '/timers/1a2b3c', { sleep: { mapValue: { fields: { start: { integerValue: '1700000000000' }, by: str('u1') } } } }]` and an emptied one `['households/' + hid + '/timers/bWren', {}]` (a stopped nap leaves an empty document). Extend the regex at :122 to `/mhealth|memberEmails|ownerLinks|timers|pregnancy\/u\d\/photos/` so each timer line is named.
- [ ] **Step 2: Run it and see it fail.** `node tools/gates.js --emulator --only=purge-erase-emu`. Expected: `FAIL not one record survives it` listing both timers paths, `FAIL timers/1a2b3c is gone`, and section 3's "nothing at all is left under it" naming `timers`.
- [ ] **Step 3: Implement.** Append `'timers'` to `HH_SUBCOLLECTIONS` (worker.js:1962) and add one line to the comment above it: running naps (C4) are flat documents and go the same way. Nothing else changes: `fsDeleteAll` already pages any flat collection and returns null on any failure.
- [ ] **Step 4: Run and pass.** Same command. Expected: `ok` for every line, `PURGE-ERASE-EMU: PASS`; section 4 still shows the unflagged family untouched, timers included.
- [ ] **Step 5: Commit.**
  `git commit -o worker.js test/purge-erase-emulator.test.js -m "The household purge erases running naps too" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 3: The record client: listener, overlay and transactional writers (store-firebase.js)

Nothing calls the writers yet and the blob still carries `sleep`, so the app behaves as today after this commit; Task 4 switches the callers.

**Files:**
- Modify: app/store-firebase.js: refs at :65; new "running naps" block after `snapshotBlobBase` (:1548-1552); `applyAppBlob` :1507-1538 (after `normalizeLoadedState(state)` at :1537); the snapshot handler after `var keptBase = ...` (:3002); `startSync` refs (:2905-2908) and listener after the events subscription (:3110); `teardown` (:972-1018, beside `hhRef = ... = null` at :1004); `window.LL` exports beside `LL.signOut` (:965).
- Modify: app/sw.js:3 (CACHE +1)
- Modify: test/blob-merge.test.js (NAMES :33-34, sandbox :59-62, `snapshot()` :114-120, section 5 :200-215, new section 7)
- Modify: tools/gates.js (TREE after `quick-close` :163; EMU after `blob-sync` :326)
- Create: test/nap-offline.test.js (section A, the vm half), test/widget-timer-race-emulator.test.js
- Test: `node tools/gates.js --only=nap-offline`, `--only=blob-merge`, `--emulator --only=widget-timer-race-emu`, `--emulator --only=blob-sync`

**Interfaces:**
- Consumes: `window.CubbySince.sleepEventId(babyId, start) -> string` (P1, 2.2); `window.cubbyTrack('save.failed', { error, retries, offline })` (.telemetry/tracking-plan.yaml:504-511); `ingestId`, `stripMeta`, `knownEvents`, `hhRef`, `eventsRef`, `auth`, `db` (store-firebase.js).
- Produces (roadmap 2.2, with Contract notes 2 to 4):
  ```
  NapResult = { ok: boolean, already?: true, reason?: 'offline'|'moved'|'denied'|'error', state?: { start, ack: number|null } | null }
  LL.napCloud() -> boolean
  LL.napStart(babyIds: string[], start: number) -> Promise<NapResult>
  LL.napStop(babyId, expectStart: number, end: number) -> Promise<NapResult>
  LL.napAck(babyId, expectStart: number, at: number) -> Promise<NapResult>
  LL.napDiscard(babyId, expectStart: number) -> Promise<NapResult>
  LL.napMove(babyId, expectStart: number, newStart: number) -> Promise<NapResult>
  ```
  Internal, by these names (the tests lift them): `var timersRef, napDocs = {}, legacyNaps = {}`, `var NAP_BUDGET_MS = 10000`; `napFromDoc(v) -> { start, ack, by } | null`; `napStopped(babyId, start) -> boolean`; `takeLegacyNaps() -> void`; `overlayNaps() -> void`; `applyTimersSnap(snap) -> void`; `napOffline() -> Promise<NapResult>`; `napResultOf(err) -> NapResult`; `napTx(run) -> Promise<NapResult>`; `napStart`, `napStop`, `napAck`, `napDiscard`, `napMove` as named `function` declarations assigned to `window.LL`. Gates `nap-offline` (TREE, `['node', 'test/nap-offline.test.js', 'url']`) and `widget-timer-race-emu` (EMU, `self: ['node', 'test/widget-timer-race-emulator.test.js']`).

- [ ] **Step 1a: Write the failing test, test/nap-offline.test.js section A.** Lift the internal names above from app/store-firebase.js by brace matching (test/blob-merge.test.js:23-32's `lift`), read `NAP_BUDGET_MS` from the source and assert it is `10000`, and run them in a `vm` with a recording fake: `db.runTransaction(fn)` (scripted per case: run `fn` against a fake `tx` whose `get` answers scripted snapshots and whose `set`/`update` are recorded, or reject with a code, or never settle), refs whose `set`/`update`/`delete` are recorded as direct writes, `navigator.onLine`, `auth.currentUser = { uid: 'olive' }`, `window.CubbySince.sleepEventId`, `window.cubbyTrack` recorder, a fake `setTimeout` that records its delay and fires at once. Cases, each for all five writers where it applies:
  - A1 offline (`navigator.onLine = false`): `{ ok: false, reason: 'offline' }`; `runTransaction` called 0 times; direct writes 0; tx writes 0; `state.timers` and `state.events` byte-identical; one `save.failed` `{ error: 'unavailable', retries: 0, offline: 'yes' }` per call.
  - A2 the companion that stages what A1 looks for: online, `timers/1a2b3c` holds `sleep { start: S }`, no event: `napStop('1a2b3c', S, E)` is `{ ok: true }` and the recorder saw exactly `tx.update(timers/1a2b3c, { sleep: <delete> })` and `tx.set(events/sleep-1a2b3c-S, { id, authorId: 'olive', babyId: '1a2b3c', type: 'sleep', time: S, end: E })`; the event is in `state.events` and `knownEvents['sleep-1a2b3c-' + S] === JSON.stringify(stripMeta(ev))`; `napDocs['1a2b3c'].sleep === null`.
  - A3 `runTransaction` rejects `{ code: 'unavailable' }`: `reason: 'offline'`, `save.failed` `{ error: 'unavailable', offline: 'no' }`, direct writes 0.
  - A4 rejects `{ code: 'permission-denied' }`: `reason: 'denied'`, `save.failed` error `permission_denied`.
  - A5 never settles: resolves `{ ok: false, reason: 'error' }`, the recorded delay is exactly 10000, `save.failed` error `deadline`.
  - A6 moved: stored `sleep { start: S2 }`, `napStop(bid, S, E)` is `{ ok: false, reason: 'moved', state: { start: S2, ack: null } }`, tx writes 0, no `save.failed`.
  - A7 already: no `sleep`, live event `sleep-<bid>-<S>`: `{ ok: true, already: true }`, tx writes 0. With `sleep { start: S }` still there and the event live: one `tx.update` clearing `sleep`, no `tx.set`, `already: true`.
  - A8 revive (Contract note 5): event exists with `deleted: true, authorId: 'olive'`: `{ ok: true }` with no `already` key, the timer cleared, and one `tx.update` of the event with `time`, `end` and `deleted`, `deletedAt`, `deletedBy` removed, `authorId` untouched; with `authorId: 'nina'` and `window.LL.role = 'caregiver'`: `{ ok: false, reason: 'error' }`, tx writes 0.
  - A9 no ack-only timer: `napAck`, `napDiscard`, `napMove` with no stored `sleep` are `moved`, tx writes 0.
  - A10 twins: `napStart(['1a2b3c', '42x'], T)` with `1a2b3c` running T0: one `tx.set` (`42x`, `{ sleep: { start: T, by: 'olive' } }`), `{ ok: true }` without `already`; with both running: `{ ok: true, already: true }`, tx writes 0; `napStart(['1a2b3c'], T)` with it running: `{ ok: true, already: true, state: { start: T0, ack: null } }`.
  - A11 local: with `hhRef = null`, `napCloud()` is false.
  - Mutant `NAP_OFFLINE_MUTANT=blind`: replace, in the lifted napStop only, the exact statement `if (navigator.onLine === false) return napOffline();` with `if (navigator.onLine === false) { timersRef.doc(String(babyId)).update({ sleep: firebase.firestore.FieldValue.delete() }); return Promise.resolve({ ok: true }); }`; the test fails `mutant did not apply` if the statement is not found exactly once in napStop. Ends `NAP-OFFLINE: PASS|FAIL`; takes `url` (for Task 4's section B).
- [ ] **Step 1b: Write the failing test, test/blob-merge.test.js.** Add `'napFromDoc', 'napStopped', 'takeLegacyNaps', 'overlayNaps'` to NAMES; give the sandbox `napDocs: {}, legacyNaps: {}`; `snapshot()` calls `sb.takeLegacyNaps(); sb.overlayNaps();` right after the reapply, as the handler will. New section 7 "a running nap lives in its own record": `sb.napDocs = { bpip: { sleep: { start: 5, ack: null, by: 'olive' } } }`, then a server snapshot with no `sleep` and a medicine added: `state.timers.bpip.sleep.start === 5` (red today: applyAppBlob replaces `state.timers`); a record with `{ sleep: null }` beside a blob `bpip.sleep { start: 9 }`: no nap on screen (the record wins); no record and blob `start: 9`: the legacy nap shows; blob `start: 9` with a live sleep event `time: 9` (id `'r4nd0m'`): no nap (fold rule); a deleted one does not count; the feed timer in the blob is untouched throughout. Also: a phone whose own unsent legacy nap is held across a snapshot that does not carry it still shows it and still has `timers` dirty (today's write path, which Task 4 retires; blob-sync 1B proves the same end to end). Section 5 gains: `takeLegacyNaps(); overlayNaps();` sits within 120 characters after `var keptBase = held ? reapplyPendingBlobEdits(held) : null;`.
- [ ] **Step 1c: Write the failing test, test/widget-timer-race-emulator.test.js.** Harness of test/blob-sync.test.js (outer `emulators:exec --only firestore,auth` on FS_PORT/AUTH_PORT/HUB_PORT/LOG_PORT/WS_PORT; inner phase serves THIS tree with tools/serve.js on WEB_PORT and asserts the served store-firebase.js and index.html are byte-identical to the tree unless a mutant is set; Chrome launched with `downloadBehavior` from tools/gate_downloads.js on the browser and on every context; `?fsemu&authemu` pages; admin REST as `Bearer owner`). Setup as blob-sync.test.js:304-335: Olive makes a family, Nina joins by link; Olive writes babies `1a2b3c` (Robin) and `42x` (Wren) through `state.babies` + `persist()`. Helper `workerStop(bid, start, end, uid)`: the Worker's commit shape (2.4, 6.7) against the emulator, never a stub: GET `timers/<bid>` for `updateTime`, then POST `documents:commit` with `[{ update: { name: timers/<bid>, fields: {} }, updateMask: { fieldPaths: ['sleep'] }, currentDocument: { updateTime } }, { update: { name: events/sleep-<bid>-<start>, fields: { id, authorId: uid, babyId, type: 'sleep', time: start, end, via: 'widget' } }, currentDocument: { exists: false } }]`, preconditions in the body; one re-read and retry on a refused precondition; returns `'ok'|'already'|'moved'`. P4 replaces it with the real route. Sections:
  1. Olive `LL.napStart(['1a2b3c'], S)`: the server doc is exactly `{ sleep: { start: S, by: <olive uid> } }`; Nina's `state.timers['1a2b3c'].sleep.start === S` within 5 s.
  2. Nina `LL.napAck('1a2b3c', S, A)`: server `{ start: S, ack: A, by: <olive> }`; Olive sees `ack === A`.
  3. Both phones `napStop('1a2b3c', S, E)` at once: exactly one live event with `babyId '1a2b3c'` and `time S` on the server, id `sleep-1a2b3c-S`; the doc exists with no `sleep`; results are one `{ ok: true }` and one `{ ok: true, already: true }`; neither phone shows a nap.
  4. Stale phone: Olive starts S1, stops it, starts S2; Nina's view is set to `{ start: S1 }` by hand; Nina `napStop('1a2b3c', S1, E)` is `{ ok: false, reason: 'moved', state: { start: S2, ack: null } }`; the server still runs S2; one event at S1.
  5. Five rounds of `workerStop` against `napStop` on a fresh nap, 0 to 30 ms apart, alternating which leaves first: one event per nap, at `sleep-<bid>-<S>`, no `sleep` left; in every round the Worker shape won (the event has `via: 'widget'`), the app's answer is `{ ok: true, already: true }`.
  6. Three rounds of `napAck` against `workerStop`: after each, the server holds no `sleep` without `start`; the ack answers `ok` or `moved`.
  7. A correction against `workerStop`: `napStop(bid, S, S + 1800000)` and `workerStop(bid, S, now)`: one event.
  8. Twins: `napStart(['1a2b3c'], T1)`, then `napStart(['1a2b3c', '42x'], T2)`: `1a2b3c` keeps T1, `42x` gets T2 (doc id exactly `42x`), the second answer is `{ ok: true }`.
  9. `napDiscard('42x', T2)`: no `sleep`, no event.
  10. `napMove('1a2b3c', T1, T1 - 600000)`: `start === T1 - 600000`, `by` is the mover; a stop with the old start is `moved`.
  11. Sign-out (Review Focus 4): a nap runs on `1a2b3c`; Olive `LL.signOut()`; Ruth (new account, her own family) signs in on that page: Ruth's `state.timers` has no `1a2b3c`; `LL.napStop('1a2b3c', T1 - 600000, now)` is not `ok`; Olive's family's timer doc keeps its `updateTime`; Ruth's family has no `timers` documents.
  Mutants by `RACE_MUTANT`, applied with puppeteer request interception on `/app/store-firebase.js` (the test fails `mutant did not apply` unless each target string occurs exactly once): `blind` replaces `db.runTransaction(run)` with `run(napBlindTx())` and appends a `napBlindTx` whose `get` answers from the page's own `state` (the screen) and whose writes go straight to the refs; `randomid` replaces `var evId = window.CubbySince.sleepEventId(babyId, expectStart);` with `var evId = 'r' + Math.random().toString(36).slice(2, 12);`. Ends `WIDGET-TIMER-RACE-EMU: PASS|FAIL`.
- [ ] **Step 2: Run them and see them fail.** Wire both gates, then `node tools/gates.js --only=nap-offline,blob-merge` and `node tools/gates.js --emulator --only=widget-timer-race-emu`. Expected: `FAIL app/store-firebase.js has every function this judges` (nap-offline, blob-merge); race: `FAIL LL.napStart is a function` and every section after it.
- [ ] **Step 3: Implement (app/store-firebase.js).**
  - Refs and model: `timersRef = hhRef.collection('timers')` in startSync; `unsub.push(timersRef.onSnapshot({ includeMetadataChanges: true }, applyTimersSnap, warn))` after the events subscription (:3110). applyTimersSnap: each docChange sets `napDocs[ingestId(id)] = { sleep: napFromDoc(data.sleep) }` (removed: delete the key), records whether a server copy has been seen (`fromCache === false` and nothing pending; Task 5 reads it), then `overlayNaps(); rerender();`.
  - `napFromDoc`: `start` a positive integer, `ack` an integer or null, `by` through `ing().id` or null; anything else, or no `start`, is null (no nap, so an ack-only document never draws).
  - `napStopped(bid, start)`: a sleep event in `state.events` for `bid` with `time === start` and no `deleted`.
  - `takeLegacyNaps()`: after `normalizeLoadedState(state)` in applyAppBlob, moves every `state.timers[bid].sleep` into `legacyNaps[bid]` (through napFromDoc, `by` null) and deletes it from `state.timers`. `overlayNaps()`: for every baby in `state.babies`, `sleep` is `napDocs[bid].sleep` when `bid in napDocs`, else `legacyNaps[bid]`, else none; dropped when `napStopped`; written as a copy (`{ start }` plus `ack` when set). It is authoritative for `state.timers[*].sleep` and never touches `feed`. applyAppBlob ends `takeLegacyNaps(); overlayNaps();`, and so does the snapshot handler right after the reapply at :3002 (a held `timers` value carries this phone's unsent nap until Task 4, and only overlay copies after it, which the record outranks).
  - Writers: each begins `if (navigator.onLine === false) return napOffline();` and needs `hhRef` and `auth.currentUser` (else `{ ok: false, reason: 'denied' }`); each runs its reads and writes inside `napTx(function (tx) {...})`, reads first (`tx.get` of the timer doc, and for napStop the event doc), decides, writes, returns the NapResult. Decisions are 2.2's and Step 1a's cases: start writes `tx.set(ref, { sleep: { start, by: uid } })` only for babies with no `sleep`; stop requires `sleep.start === expectStart`, clears with `tx.update(ref, { sleep: FieldValue.delete() })` and creates the event at `var evId = window.CubbySince.sleepEventId(babyId, expectStart);` (revive a deleted one per A8); ack writes `{ 'sleep.ack': at }`; move writes `{ sleep: { start: newStart, by: uid } }` plus the old `ack`; discard clears. Local effects only after an `ok` answer: `napDocs` updated, the stop's event pushed into `state.events` with its `knownEvents` entry (so pushNow never re-sends it), `overlayNaps()`.
  - `napTx(run)`: the only place `db.runTransaction(run)` appears; raced against `NAP_BUDGET_MS`; errors through `napResultOf` (`permission-denied` to `denied`, `unavailable` to `offline`, the budget to `error`, anything else to `error`); every `offline`, `denied` or `error` answer sends one `save.failed` with `retries: 0`, `error` `unavailable|permission_denied|deadline|other` and `offline` from `navigator.onLine`; `moved` and `already` send nothing.
  - Exports: `window.LL.napCloud = function () { return !!hhRef; }` and the five writers. Teardown: `timersRef = null; napDocs = {}; legacyNaps = {};` beside :1004.
  - app/sw.js: re-read it, then bump `CACHE` by one from what `grep -o "little-log-v[0-9]*" app/sw.js` prints.
- [ ] **Step 4: Run and pass, then see each mutant red.** `node tools/gates.js --only=nap-offline,blob-merge,quick-close,test-wiring` and `node tools/gates.js --emulator --only=widget-timer-race-emu,blob-sync`. Expected: all rows `ok`, `GATES: PASS`. Then the mutants, through gates.js so ports and tree are its own (it passes the environment through): `NAP_OFFLINE_MUTANT=blind node tools/gates.js --only=nap-offline` fails A1 (`direct writes 0`); `RACE_MUTANT=blind node tools/gates.js --emulator --only=widget-timer-race-emu` fails section 4 (`the stale stop erased the newer nap`); `RACE_MUTANT=randomid node tools/gates.js --emulator --only=widget-timer-race-emu` fails sections 3 and 5 on the event id and the `already` answer.
- [ ] **Step 5: Commit.**
  `git add test/nap-offline.test.js test/widget-timer-race-emulator.test.js && git commit -o app/store-firebase.js app/sw.js test/blob-merge.test.js test/nap-offline.test.js test/widget-timer-race-emulator.test.js tools/gates.js -m "Running naps can be written to their own record, by transaction only, and every phone listens to it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 4: The app's sleep paths write the record, and the blob stops carrying naps

**Files:**
- Modify: app/index.html: helpers beside `runningNap` (:2129) and `timersFor` (:2468); `setTimerStart` :5113-5137 (sleep half); `startSleep` :6219; `startSleepFrom` :6227-6231; `stopSleep` :6232-6247; `saveSleepCorrect` :6280-6290; `keepSleepRunning` :6293-6296; `discardRunningNap` :6297-6304
- Modify: app/store-firebase.js:1502 (`timers: blobTimers(state.timers)`), new `blobTimers` in the running-naps block
- Modify: docs/widgets/widget-copy.json (eight `app.*` keys), then every file `node tools/widget_gen.js` rewrites (app/since-rules.js, docs/widgets/widget-fixtures.json, native-ios/CubbyWidget/Generated.swift, native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt, native-android/app/src/main/res/values/widget_strings.xml; roadmap 2.1)
- Modify: app/sw.js:3 (CACHE +1)
- Modify: test/nap-offline.test.js (section B), test/blob-merge.test.js (NAMES + section 8), test/quick-close.test.js (NAMES :39-41), test/blob-sync.test.js (case 1B, :363-383), tools/chaos.js (`timerStart` :469-476, `timerStop` :477-490, server read :623), test/widget-timer-race-emulator.test.js (section 12)
- Test: `node tools/gates.js --only=nap-offline,...` and `--emulator --only=...` (Step 4)

**Interfaces:**
- Consumes: Task 3's `LL.napCloud`, `LL.napStart`, `LL.napStop`, `LL.napAck`, `LL.napDiscard`, `LL.napMove`, `NapResult`; P1's `window.CubbySince.sleepEventId`, `window.CubbyWidgetCopy`, `stampAuthor(ev) -> ev` (2.4: eight doors, stopSleep and saveSleepCorrect among them; it stays on their local branch, while the household branch's napStop writes `authorId: uid` itself; pushNow adds an author only on create).
- Produces: index.html `napCloud() -> boolean`; `napFreeStart(babyIds: string[], s: number) -> number` (the smallest `s' >= s` with no event, live or deleted, at `sleepEventId(bid, s')` for any of `babyIds`); `napFail(r: NapResult, kind: 'start'|'stop'|'change', babyId) -> NapResult`; `napBusy` (per-baby in-flight set); on the household path `startSleep`, `startSleepFrom`, `stopSleep`, `saveSleepCorrect`, `keepSleepRunning` and `setTimerStart('sleep', ...)` return the Promise of their write, resolving after the screen is updated (undefined on the local path). store-firebase.js `blobTimers(timers) -> object` (a copy without any `sleep`).

- [ ] **Step 1a: Write the failing test, test/nap-offline.test.js section B (the browser half).** Boot `url + '/app/?e2e=1'` with the clock pinned to the day and hour, `new Date(2026, 10, 18, 13, 0, 0, 0)` (tools/sleep_timer_check.js:25-27 and :43-48, its `evaluateOnNewDocument` shift), a local seed with baby `b1` (Robin), and before each case replace `LL.napCloud` with `() => true` and the five writers with recorders that resolve `window.__napReply`. Toasts recorded. `C = (k) => CubbyWidgetCopy[k]`.
  - B1 Stop from the banner's real Stop button, reply `{ ok: false, reason: 'offline' }`: `napStop('b1', start, end)` recorded once with `end` within 2 s of now; the nap is still in `state.timers.b1.sleep`; no sleep event; `little-log-v1` in localStorage unchanged; the last toast is `C('app.napOfflineStop')`.
  - B2 Start from the sheet (`openSleep(); startSleep()`), offline: `napStart(['b1'], s)` recorded; no nap in state; the sheet is still open; toast `C('app.napOfflineStart')`. Same for `startSleepFrom`. Contract note 6, the phone's clock: `startSleep`'s `s` is within 2000 of the page's own `Date.now()` at the tap (the pinned clock, not the machine's), and `startSleepFrom`'s is the picked minute exactly.
  - B3 `keepSleepRunning`, Forget (`discardRunningNap` then the sheet's confirm), `setTimerStart('sleep','b1', start - 600000)`, offline: state unchanged, toast `C('app.napOfflineChange')`; `saveSleepCorrect` offline: toast `C('app.napOfflineStop')`, its sheet still open.
  - B4 Stop answered `moved`, `denied`, `error`: toasts `C('app.napMoved')`, `C('app.napDenied')`, `C('app.napError')`; `already`: `C('app.napAlreadyStopped')`, no "Sleep logged", no Undo. Start answered `{ ok: true, already: true }`: `C('app.napAlreadyStarted')`.
  - B5 Stop answered `ok` (the recorder does what napStop does: pushes `{ id: sleepEventId('b1', start), ... }` and clears the nap): toast starts `Sleep logged · `, `_undo.ids[0] === CubbySince.sleepEventId('b1', start)`; the first-entry line appears on Home for a first log.
  - B6 Review Focus 5: a 30-hour nap; `stopSleep('b1')` records zero napStop calls and opens "When did this nap end?".
  - B7 Review Focus 3: a soft-deleted sleep event at `sleepEventId('b1', S)` where S is 12:30 that day; "Already napping" at 12:30: `napStart` receives `S + 1`; on the local path (`napCloud` false) the nap starts at `S + 1` and its stop writes `sleepEventId('b1', S + 1)`.
  - B8 A pending Stop (a reply that never settles) and a second tap: one napStop call.
  - B9 Local path untouched (`napCloud` false): `stopSleep('b1')` writes the event synchronously at `sleepEventId('b1', start)`, falling back to uid() only when that id is already in `state.events`.
  - Mutant `NAP_OFFLINE_MUTANT=pretend`: request interception on `/app/index.html` replaces `if(!r.ok) return napFail(r,'stop',babyId);` with `if(!r.ok){ delete timersFor(babyId).sleep; render(); return r; }`; B1 must fail.
- [ ] **Step 1b: Write the other failing tests.** blob-merge: NAMES `+ 'blobTimers'`; section 8: `appBlobFromState().timers` for `{ bpip: { sleep: { start: 5 }, feed: { start: 6, side: 'left' } } }` is exactly `{ bpip: { feed: { start: 6, side: 'left' } } }`, and a phone whose only change is a nap from the record has no dirty key (Review Focus 1). quick-close: NAMES `+ 'blobTimers'`. blob-sync case 1B (:363-383): Olive's timer becomes a feed timer (`{ feed: { start, side: 'both' } }`, still a blob key), so the case keeps proving its lost update. chaos.js: `timerStart` calls `initTargets(); return startSleep()` and counts the timer only when it resolves `ok`; `timerStop` awaits `stopSleep(bid)` before reading the new event; `sTimer` reads `households/<hid>/timers/<babyId>` and its `sleep`. Race section 12 "the app's own buttons": Olive's `startSleep()` leaves `app.timers['1a2b3c']` on the server with no `sleep` key; Nina's `stopSleep('1a2b3c')` writes `sleep-1a2b3c-<start>` with Nina's `authorId`; Nina's `keepSleepRunning` on an over-12-hour nap writes `ack`, and Olive's Home shows no "Did it end earlier?" line.
- [ ] **Step 2: Run them and see them fail.** `node tools/gates.js --only=nap-offline,blob-merge,quick-close` and `node tools/gates.js --emulator --only=widget-timer-race-emu,blob-sync,chaos`. Expected: nap-offline B1 to B8 `FAIL` (index.html still writes locally), blob-merge `FAIL app/store-firebase.js has every function this judges` (`blobTimers`), race section 12 `FAIL ... no sleep key`, chaos fails on the timer model.
- [ ] **Step 3: Implement.**
  - index.html: `napCloud()` guards `window.LL && typeof LL.napCloud === 'function' && LL.napCloud()`. Each sleep path keeps every check it has today, in order (the 24-hour diversion in stopSleep, the end checks in saveSleepCorrect, setTimerStart's no-op, future and 24-hour refusals), then branches: local, today's body (with `napFreeStart` on starts and the B9 id on stops); household, `napBusy` guard, then the writer. On `ok`: the same toasts, `closeSheet`, `go('home')`, `render`, `armFirstEntryLine` (armed before the call, cleared on any other answer), `cubbyTrackEntry('sleep','logged')`, `wwNotYetArm`, `loggedToast` with `[sleepEventId(babyId, start)]` as today. Otherwise `napFail`: clears the first-entry arm, closes the sheet only for `moved` and `already`, renders, toasts. In stopSleep the failure line is exactly `if(!r.ok) return napFail(r,'stop',babyId);`.
  - Copy, in docs/widgets/widget-copy.json, each `{ "text": ..., "on": ["app"], "platforms": ["ios","android"] }` (both platforms, so none needs a `differences` entry):

    | Key | Text |
    |---|---|
    | app.napOfflineStart | No connection, so the timer did not start. |
    | app.napOfflineStop | No connection, so the nap was not saved and the timer is still running. |
    | app.napOfflineChange | No connection, so nothing changed. |
    | app.napMoved | This nap changed a moment ago, so nothing was saved. |
    | app.napAlreadyStopped | That nap was already stopped. |
    | app.napAlreadyStarted | That nap was already running. |
    | app.napDenied | Cubby was not allowed to save that, so sign out and back in to check your circle. |
    | app.napError | Cubby could not confirm that just now, so check the timer before you try again. |

    Then `node tools/widget_gen.js` and `node tools/widget_gen.js --check` (exit 0).
  - store-firebase.js:1502 `timers: blobTimers(state.timers)`; the comment says naps live in `timers/{babyId}` now and feed timers stay here.
  - app/sw.js: re-read, bump CACHE by one.
- [ ] **Step 4: Run and pass, then see the mutant red.** `node tools/gates.js --only=nap-offline,blob-merge,quick-close,blob-clobber,sleep-timer,timer-banner,undo-away,first-entry,wake-window,feed-tile,home-truth,night-home,flow-walk,widget-parity,widget-snapshot,widget-logger,test-wiring` and `node tools/gates.js --emulator --only=widget-timer-race-emu,blob-sync,chaos,quick-close-emu,timers-rules`. Expected: every row `ok`, `GATES: PASS`. Then `NAP_OFFLINE_MUTANT=pretend node tools/gates.js --only=nap-offline` fails B1 (the test first checks the index.html it was served holds `napFail(r,'stop',babyId)` exactly once).
- [ ] **Step 5: Commit.**
  `git commit -o app/index.html app/store-firebase.js app/sw.js app/since-rules.js docs/widgets/widget-copy.json docs/widgets/widget-fixtures.json native-ios/CubbyWidget/Generated.swift native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt native-android/app/src/main/res/values/widget_strings.xml test/nap-offline.test.js test/blob-merge.test.js test/quick-close.test.js test/blob-sync.test.js test/widget-timer-race-emulator.test.js tools/chaos.js -m "Start, stop, snooze, move and forget write the nap's own record, and say so when there is no connection" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

### Task 5: The fold: a nap an older Cubby left in the blob moves in once, a stopped one never comes back

**Files:**
- Modify: app/store-firebase.js (running-naps block; calls at the end of `applyTimersSnap` and after the household snapshot's `overlayNaps()` at :3002)
- Modify: app/sw.js:3 (CACHE +1)
- Modify: test/widget-timer-race-emulator.test.js (section 13 "older builds")
- Test: `node tools/gates.js --emulator --only=widget-timer-race-emu`

**Interfaces:**
- Consumes: Task 3's `napDocs`, `legacyNaps`, `napStopped`, `overlayNaps`, `napTx`, `timersRef`; `householdSeen` state (`window.__cubbyHouseholdSeen`, store-firebase.js:2897-2901).
- Produces: `maybeFoldNaps() -> Promise<void>` (one run in flight; only after this session has seen the household doc and the timers collection from the server); `foldNap(babyId: string, legacy: { start, ack }) -> Promise<'moved'|'kept'|'cleared'|'skipped'>`; `clearStoppedNap(babyId: string, start: number) -> Promise<NapResult>`.

- [ ] **Step 1: Write the failing test, race section 13.** Every legacy write is the 866851ac client's shape, made by admin REST (`app.timers` field path, as `adminSetAppField` at test/blob-sync.test.js:130-134 writes it), with both phones open:
  - 13a legacy `{ '1a2b3c': { sleep: { start: L1 } } }`, no doc: within 5 s the doc is `{ sleep: { start: L1, by: <a member> } }`, the blob's `1a2b3c` has no `sleep`, both phones show one nap at L1.
  - 13b legacy L2 with a live event `time: L2`, random id `'r8k2q'`, as the old build writes it: no `sleep` in the doc, the blob key gone, no nap on either phone (Review Focus 2, the stale half).
  - 13c legacy L3 while the doc runs D: the doc keeps D; the blob key gone.
  - 13d the doc is empty after an earlier stop, legacy L4 not stopped: L4 moves in (Contract note 1; Review Focus 2, the fresh half).
  - 13e a doc nap D2 with a live event `time: D2` from an old build's stop: cleared by the first phone that sees it; one event remains.
  - 13f legacy for digit-led `42x`: folded, field path and doc id exact.
- [ ] **Step 2: Run it and see it fail.** `node tools/gates.js --emulator --only=widget-timer-race-emu`. Expected: 13a `FAIL ... no sleep in timers/1a2b3c`, 13b `FAIL the blob still holds 1a2b3c.sleep`, 13c, 13d, 13e, 13f `FAIL`.
- [ ] **Step 3: Implement.** foldNap runs one `napTx`: reads the household doc and `timers/<bid>`; if the blob no longer holds that start, `skipped`; if `napStopped(bid, start)`, removes the key with `tx.update(hhRef, new firebase.firestore.FieldPath('app', 'timers', bid, 'sleep'), firebase.firestore.FieldValue.delete())`, `cleared`; if the doc holds a `sleep`, removes the key, `kept`; else `tx.set(timerRef, { sleep: { start, by: uid } })` (plus `ack` when the legacy one had it) and removes the key, `moved`. clearStoppedNap clears a doc nap only if its stored start is still `start`. maybeFoldNaps walks `legacyNaps`, then every `napDocs` nap the fold rule calls stopped, one at a time; a refused write (a household whose blob still holds a legacy `app.pregnancy` is refused by appBlobClean, firestore.rules:295-298) is left for the next snapshot. No fold runs offline or from a cached view. app/sw.js: re-read, bump CACHE by one.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --emulator --only=widget-timer-race-emu,blob-sync,chaos,timers-rules` and `node tools/gates.js --only=blob-merge,nap-offline`. Expected: every row `ok`, `GATES: PASS`; section 13 all `ok`.
- [ ] **Step 5: Commit.**
  `git commit -o app/store-firebase.js app/sw.js test/widget-timer-race-emulator.test.js -m "A nap an older Cubby left in the shared record moves into its own, once, and a stopped one never comes back" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

---

## Before the founder's push

- [ ] `node tools/gates.js --emulator` (the whole default and emulator tiers). Expected `GATES: PASS`.
- [ ] Note in the hand-off that an older cached build cannot see a nap in its own record; it updates on its next load (HTML and JS are network-first), which is why this ships a release before P4.

FOUNDER STEP: publish firestore.rules (Task 1's timers block), then push main, in one sitting (push = deploy; the purge change in worker.js deploys with it).
FOUNDER STEP: let this run live for a release before P4's push (roadmap section 4, step 2).

## Spec map (self-review)

| Requirement | Task |
|---|---|
| C4: running naps move to `timers/{bid}` for every family; feed timers stay | 3, 4 |
| 6.7: app writes by transaction only; clearing names `sleep`; `sleep-<bid>-<start>` for stops and corrections | 3, 4 |
| 6.6: `nap.ack` is the shared snooze | 3 (napAck), 4 (keepSleepRunning, race 12) |
| 6.12 race test: start, stop, keep running, correct; no resurrected or erased nap; no ack-only timer; one event per nap; digit-led ids; red on blind write and random id | 3, 4, 5 |
| 9: offline Start and Stop say so, never a blind write | 3 (A), 4 (B) |
| 9 and 2.4: which document path, and the fold of older builds' `app.timers` | 1, 3, 5 |
| Roadmap P2: timers rules; purge deletes timers; local-only users keep local timers | 1, 2, 4 (B9) |
| 6.7 "the app writes start from server-aligned time where it has it" | Deviation, owned here: Contract note 6 (the phone's clock, bounded by P4's `futureStartMs` 300000 and end-after-start checks), pinned by 4 (B2); proposed line for roadmap 2.4 so the founder sees it |
| Roadmap 2.4 and 2.8: a stop revives a soft-deleted `sleep-<bid>-<start>` and never answers `already` | 3 (A8) |
