# Sleep in Place (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Phase B iPhone widget starts, stops and undoes a running nap in one tap, through one Worker route that checks a revocable widget token and the family's membership on every use and writes the nap under the same preconditions the app uses.

**Architecture:** Three Worker modules (`workers/widget/token.mjs`, `nap.mjs`, `routes.mjs`) sit behind one `/api/widget/` dispatch in worker.js. The token is both an HMAC'd string (a forged one costs zero reads) and a `widgetTokens` row (revocable, re-checked against `members` on every use); `decideNap` is pure, and its Writes reach Firestore in one `documents:commit` with every precondition in the body. The app mints through the native plugin on every foreground while a widget exists; iOS keeps the token in the shared Keychain, NapIntent sends the tap and folds the reply into `napState` through P3's `WidgetStore` by the shared `napCases` table, and the Phase B views are proven against fixtures and goldens the JS model generates.

**Tech Stack:** Cloudflare Worker (ES modules, WebCrypto), Firestore REST (`documents:commit`, `:beginTransaction`, `:batchGet`, `:runQuery`), Identity Toolkit `accounts:lookup`, the Firestore and Auth emulators, D1 through `workers/admin/dev/d1-sqlite.mjs` in tests, puppeteer, Capacitor plugin, Swift (WidgetKit, AppIntents, Security), XCTest.

**Spec:** /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/specs/2026-11-16-home-screen-widgets-design.md (6.7, 6.8, 6.12, 8), and the roadmap /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/plans/2026-11-17-widgets-0-roadmap.md (section 2 is binding).

Work in /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c. Lines are for 58733b16; P1, P2 and P3 land first and move them, so re-find each anchor with the quoted text before editing. Depends on P2 (timer documents, `LL.napStart` and friends, `test/widget-timer-race-emulator.test.js`) and P3 (native-ios/, the `CubbyWidget` plugin, `WidgetStore`, the golden test and `RenderTests`, the `CubbyWidgetTests` scheme, `tools/ios_widget_check.sh`, `test/widget-gen-ios.test.js`).

## Contract notes

1. **Emulator ID tokens.** The Auth emulator issues unsigned tokens (`alg: none`), so the real `verifyFirebaseToken` (worker.js:2439-2460, RS256 against Google's keys) refuses every one. Both emulator suites call `widgetRoute(request, env, url, deps)` with worker.js's own `deps` (exported as `__widget.deps`) except `verifyFirebaseToken`, swapped for the emulator decoder in `test/helpers/widget-emu.js`, and `FS_PROJECT`. Identity, disabled and validSince checks still go to the real Auth emulator; the dispatch and the forged-token path are driven through worker.js's own `fetch`. `verifyFirebaseToken` also starts returning `iat` (needed for validSince).
2. **`decideNap` has no household.** Its signature carries no hid, so its Writes name documents relative to the household (`timers/<bid>`, `events/<eventId>`); `widgetRoute` qualifies them before the commit.
3. **Module closure.** Six worker tests (test/signin-claim-auth-emu.test.js:135-141, signin-flow, signin-code-budget, signin-code-emulator, worker-routes, tools/fuzz_worker.js:279-287) copy only worker.js's direct `./` imports into a temp dir, so a module that only routes.mjs imports vanishes there and every one of them fails to load. worker.js therefore imports every module the widget routes reach, directly, and widget-nap-decide asserts it. P5's snapshot.mjs and push.mjs fall under the same rule.
4. **widget.nap in the usage tables.** 2.11 puts it in USAGE_EVENTS and app/usage-allowlist.js, but tools/tracking_plan_check.js:267-269 requires every USAGE_EVENTS key to be a device-sent (`source: new`) plan event, and /api/usage would store a phone-sent widget.nap linked to a uid. P4 marks the core entry `server: true`, refuses it at /api/usage, and teaches the gate that `source: server` events with properties are core's server events. P5's widget.refresh uses the same rule.
5. **TTL.** Spec 6.8 says the TTL policy is deployed via firebase.json. The repo has no firestore.indexes.json, and a `firestore:indexes` deploy from a file that lists none offers to delete indexes made in the console. firebase.json stays as it is; the TTL is one `gcloud` command (FOUNDER STEP), and the nap route refuses and deletes an expired row itself, so TTL lag never extends a token's life.
6. **NapIntent parameters (2.6).** An AppIntent parameter cannot be a dictionary, so `NapIntent(action: String, babyIds: [String], starts: [Int], undo: String)` takes `starts` aligned index for index with `babyIds`. A start intent omits `starts` in the ViewModel (2.3), so its NapIntent carries `starts: []`; no undo is `undo: ""`.
7. **Revoke path.** 2.6's `clear()` empties every shared-container key (five once P5 lands), the token and the shortcuts. P4 makes the native `clear()` also send `/api/widget/revoke` for the token it removes (iOS: `WidgetWipe.run`, Task 8), so every `widgetWipe` reason (sign-out, switch, delete, accessLost, unauthorized, loss) revokes server side with no new JS call site. `hasToken()` (2.6) is built natively but the web never needs it: when no widget exists, `widgetTokenSync` calls `revokeToken()`, which sends nothing when there is no token.
8. **The reply mapping is data (accepted, 2.3).** How a nap reply becomes `napState` is the `napCases` list in widget-copy.json: Task 9's table, one named case per row, checked and copied into widget-fixtures.json by widget_gen.js, read case by case by Swift NapReducerTests (Task 9) and Kotlin NapReducerTest (P6 Task 7). Each row pins its line key and that line's lifetime (`now + lineMs`), as spec 6.11 asks. P4 uses only `wt:<docId>`; `wph:<hid>` is P5's.
9. **tokenGate (2.2, with P5's notes 4 and 5).** routes.mjs exports `tokenGate(request, env, deps, { ipKey, mask }) -> { ok: true, row, docId, hh, token } | { ok: false, response, row: Row|null }`. `token` is the Google access token the gate minted once with `WIDGET_SCOPE` (`datastore` plus `firebase.messaging`, the pair at worker.js:1803), so the nap handler and P5's snapshot and `pokeHousehold` reuse it and never mint a second; mint keeps `cloud-platform` for Identity Toolkit. Every route gets `deps.waitUntil` (bound per request to the dispatch's `ctx.waitUntil`) so the usage row never holds a reply; a caller without it (the emulator suites) awaits instead.
10. **NapIntent's metadata is generated (2.3, P3 note 2).** AppIntents reads `static let title` and `@Parameter(title:)` as compile-time literals, and P1's literal ban forbids hand-written ones, so a hand-written title cannot name the Sleep label. widget_gen.js emits the `NapIntent` struct (title = the WActions sleep label; parameter titles from `intent.action`, `intent.babies`, `intent.starts`, `intent.undo`; `isDiscoverable`, `authenticationPolicy`) into Generated.swift inside `#if CUBBY_WIDGET_EXT`, once per `inPlace: true` action, so only for sleep. The hand-written native-ios/CubbyWidget/NapIntent.swift is an `extension NapIntent` (its init and `perform()`) and declares no intent. P3's widget-gen-ios counts `@Parameter` per intent.
11. **One store (2.5, Swift ownership).** P4 declares `NapState` and adds `FixtureInput.nap`; napState is read and written only through P3's `WidgetStore` (`Key.napState`), never a second store, so `clearAll()` and its tests cover it. P5 adds `pokedAt` and `pullTriedAt`; every clear removes all five keys.
12. **Mac-only wiring (2.10).** Each new `native-ios/Tests/*Tests.swift` joins tools/ios_widget_check.sh's TESTS and gets an ALLOW entry `ranBy: 'tools/ios_widget_check.sh'` in tools/test_wiring_check.js; `node tools/gates.js --only=test-wiring` passes after each iOS task.
13. **Hostless Keychain.** CubbyWidgetTests is hostless (P3 Task 3), where SecItem calls can fail with errSecMissingEntitlement (-34018). WidgetKeychain therefore reaches the Security framework through a `KeychainBackend` seam: the XCTests assert the exact query dictionaries through a recording backend, and the real Keychain is proven on a device (Task 10 Step 6).

## Global Constraints

- Token: `w1.<b64url(24 random bytes)>.<b64url(HMAC-SHA256(key, 'w1.' + middle))>`, regex `^w1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$`, key HKDF-SHA256 over the service-account private key, info `cubby-widget-token-v1`; read only from `Authorization: Bearer <t>`.
- Row: `widgetTokens/{sha256hex(t)}` = `{ uid, hid, deviceId, platform: 'ios'|'android', createdAt: int ms, lastUsedAt: int ms, expireAt: timestamp }`, 90 days (7776000000 ms) sliding on use; one row per (uid, deviceId); at 5 per uid the least recently used goes.
- Rules: `match /widgetTokens/{id} { allow read, write: if false; }` beside signinCodes and pushLedger (firestore.rules:162-165).
- Order on a token route: per-IP limit, format and HMAC (forged: 401, zero reads), per-token limit, token row, then the household (fsGetStrict, mask `members, deleteAfter, app.babies`; failed read 503; non-member: row deleted, 401).
- Access tokens: tokenGate (nap; P5's snapshot and poke) mints `https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging` once per request and returns it as `token`; mint asks for `https://www.googleapis.com/auth/cloud-platform` (Identity Toolkit).
- Limiters: `WIDGET_RATE_LIMITER` namespace 1008, 30/60 s per IP, keys `wmint:|wrev:|wnap:` + clientIpKey; `WIDGET_TOKEN_RATE_LIMITER` namespace 1009, 12/60 s, key `wt:<docId>`; both fail open (rateLimited, worker.js:50).
- Answers: mint 200 `{ t, expireAt }`, 401 `{error:'unauthorized'}`, 403 `{error:'not_member'}`, 400, 429, 503; revoke 200 `{ ok:true }` for any token; nap 200 `{ ok:true, already, state, at }`, 200 `{ ok:false, needsApp:true, state, at }`, 409 `{ error:'moved', state, at }`, 403 `{ error:'baby' }`, 401 `{ error:'token' }`, 400, 429, 503 `{ error:'unavailable' }`. `state` = `{ <bid>: { start, ack } | null }`, `at` = server ms.
- Nap rules (RULES from widget-copy.json): Stop writes nothing and answers needsApp past `napAskMs` 43200000 unless `ack` is less than `ackFreshMs` 21600000 old, or past `napMaxMs` 86400000 at all; a stored start must be a finite integer at most `futureStartMs` 300000 in the future, and end must exceed start. The Worker writes start and end from its own clock.
- Writes: every Write is an `update`; clearing names `sleep` in the updateMask and leaves it out of the fields; no `{delete}` Write ever names a household, timer or event; preconditions only in the `documents:commit` body; Both is one commit, any mismatch refuses all of it with 409; one raced-precondition retry after 300 ms, inside 10 s; only precondition failures count as raced.
- Documents: timer `households/{hid}/timers/{babyId}` = `{ sleep?: { start, ack?, by } }`; event id `sleep-<bid>-<start>` with `{ id, authorId: uid, babyId, type:'sleep', time:start, end, via:'widget' }`; undo marks `{ deleted:true, deletedAt, deletedBy }`.
- iOS: keychain group `F5NVQV7NVB.com.littlecubby.app.shared`, service `com.littlecubby.app.widget`, accounts `token` and `deviceId`, AfterFirstUnlockThisDeviceOnly; reinstall marker `UserDefaults.standard` key `cubbyKeychainSeen`; `NapIntent` isDiscoverable false, unlocked device required, 10-second perform budget (8 s on the wire), its title and four parameter titles generated into Generated.swift inside `#if CUBBY_WIDGET_EXT`.
- Copy (section 8, from widget-copy.json only): "Start sleep", "Stop sleep", "Start both", "Stop both", "Sleep" with the arrow, "Undo" (10 s, `undoMs` 10000; read aloud "Undo sleep for Robin", `a11y.undoFor`), "Checking", "No connection, so that didn't save.", "That didn't save. Open Cubby to log it.", "Already started in Cubby.", "Already stopped in Cubby.", "Open Cubby to pick a baby.", "Did it end earlier?"; a line lives `lineMs` 900000; a pending younger than `pendingMs` 10000 only dims the button, an older one shows "Checking". No "Saving", no "Tap to try again", nothing queued (C3).
- Widget body (ViewModel `url`, 2.3; spec 6.5, 6.7 step 6): `https://little-cubby.com/app/?baby=<id>&from=widget` for one baby, `?from=widget` otherwise, and `https://little-cubby.com/app/?go=sleep&baby=<id|both>&from=widget` while a noConnection or notSaved line shows.
- Phase B glass (spec 6.1, 6.12): the in-place Sleep button is solid in the 1.3fr column, no arrow; in accented rendering its fill is `.widgetAccentable()`; on the small widget it reads "Sleep" with a play or stop glyph; renders and goldens at 321x148 and 148x148, day, night, accented and xxLarge.
- widget.nap: anon, props `action` (start, stop, undo, state) and `outcome` (ok, already, moved, needs_app, baby, token, unavailable); no uid, hid or baby id; stored only while `modeOf(env)` is 'on'.
- Repo: tests in test/ and wired in tools/gates.js; each new assertion seen red first; commits `git commit -o <paths>` (new files `git add` first), message ending in a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; any staged app/ asset bumps `CACHE` in app/sw.js (re-read it first; v369 at 58733b16). No step pushes.

## Review Focus

1. A second tap on the same widget while the first is still in flight (3am impatience, inside `pendingMs`) sends nothing and never shows "Already started in Cubby." for her own tap. Owner: Task 9.
2. Both parents tap Stop on their own phones in the same second: exactly one sleep event, and the phone that lost reads "Already stopped in Cubby." Owner: Task 4 (Worker), Task 9 (reply row).
3. The commit lands but the reply never arrives (intent killed at 10 s, a lift): the widget says "Checking", asks `state`, and never says it did not save. Owner: Task 9, Task 10.
4. A parent who only ever uses the widget: each tap slides the row 90 days, and a row past `expireAt` that the TTL has not removed yet is refused and deleted. Owner: Task 4.
5. A hotel or café captive portal answers the nap POST with a 200 HTML page: never read as saved; "That didn't save. Open Cubby to log it." Owner: Task 9.

---

### Task 1: The widget token

**Files:**
- Create: `workers/widget/token.mjs`
- Create: `test/widget-nap-decide.test.js` (section 1; Task 2 adds the rest)
- Modify: `tools/gates.js:253-279` (TREE.push block)

**Interfaces:**
- Consumes: nothing.
- Produces (token.mjs): `WIDGET_TOKEN_RE: RegExp`; `WIDGET_TOKEN_TTL_MS = 7776000000`; `MAX_TOKENS_PER_UID = 5`; `mintWidgetToken(sa) -> Promise<string>`; `checkWidgetToken(sa, t) -> Promise<boolean>` (format and constant-time HMAC verify, zero reads, never throws); `widgetTokenDocId(t) -> Promise<string>` (64 lowercase hex, SHA-256 of the whole token); `deleteWidgetTokensWhere(base, accessToken, field: 'uid'|'hid', value: string) -> Promise<number|null>` (Task 5 fills it in; null on any failure).

- [ ] **Step 1: Write the failing test.** `test/widget-nap-decide.test.js` is a plain node script in the house style (`ok(name, cond, detail)`, last line `WIDGET-NAP-DECIDE: PASS|FAIL`, exit 1 on any fail), loading modules with `import(pathToFileURL(...))`. Two service accounts are made with `crypto.generateKeyPairSync('rsa', ...)`.

```js
// 1. token
const t = await mintWidgetToken(SA), t2 = await mintWidgetToken(SA);
ok('a token has the w1 shape', /^w1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$/.test(t), t);
ok('two mints differ', t !== t2);
ok('its own key accepts it', await checkWidgetToken(SA, t) === true);
ok('another service account refuses it', await checkWidgetToken(SA_OTHER, t) === false);
ok('one changed character in the middle is refused', await checkWidgetToken(SA, flipChar(t, 10)) === false);
ok('the dose ticket key cannot sign one', await checkWidgetToken(SA, await signedWithInfo(SA, 'cubby-dose-ticket-v1')) === false);
for (const bad of ['', 'w1..', 'w1.' + 'A'.repeat(32) + '.' + '!'.repeat(43), 'v1.' + t.slice(3), 'x'.repeat(5000), null, 42, {}])
  ok('garbage is refused, never thrown: ' + String(bad).slice(0, 12), await checkWidgetToken(SA, bad) === false);
ok('the row id is sha256 hex of the whole token', await widgetTokenDocId(t) === createHash('sha256').update(t).digest('hex'));
ok('the key is derived with its own info string', /'cubby-widget-token-v1'/.test(read('workers/widget/token.mjs')));
// wiring
ok('gates.js runs this file as widget-nap-decide', /name: 'widget-nap-decide',\s*cmd: \['node', 'test\/widget-nap-decide\.test\.js'\]/.test(read('tools/gates.js')));
```

`signedWithInfo` builds a `w1.` token whose HMAC key used the dose ticket's info string (the test's own HKDF), so the info string is proven load-bearing.

- [ ] **Step 2: Run it and see it fail.** `node test/widget-nap-decide.test.js` → `Cannot find module .../workers/widget/token.mjs` (exit 1).
- [ ] **Step 3: Implement** `token.mjs` with the signatures above, using doseTicketKey's HKDF pattern (worker.js:2392-2399) with info `cubby-widget-token-v1`, `crypto.getRandomValues` for the 24 bytes, `crypto.subtle.verify` for the check, and `crypto.subtle.digest('SHA-256')` for the id. `deleteWidgetTokensWhere` may be a stub that returns 0 until Task 5. Register `{ name: 'widget-nap-decide', cmd: ['node', 'test/widget-nap-decide.test.js'] }` in the TREE.push block.
- [ ] **Step 4: Run it and pass.** `node tools/gates.js --only=widget-nap-decide` → `widget-nap-decide ... PASS`.
- [ ] **Step 5: Commit.**
```bash
git add workers/widget/token.mjs test/widget-nap-decide.test.js
git commit -o workers/widget/token.mjs test/widget-nap-decide.test.js tools/gates.js -m "Widget tokens: a signed format that is refused with zero reads, and a hashed row id" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The nap decision

**Files:**
- Create: `workers/widget/nap.mjs`
- Modify: `test/widget-nap-decide.test.js` (sections 2-3 and `--self-test`)

**Interfaces:**
- Consumes: `sleepEventId(babyId, start)` and `RULES` from `workers/shared/since-rules.mjs` (P1).
- Produces (nap.mjs): `parseNapRequest(body) -> { action: 'start'|'stop'|'undo'|'state', babyIds: string[], starts: {[bid]: number}, undo: 'start'|'stop'|null } | null`; `napEventIds(req) -> string[]` (the event docs the route must read: `sleepEventId(bid, req.starts[bid])` for stop and undo-of-stop); `decideNap(req, current, events, now, uid) -> { status: number, body: object, writes: Write[] }` with `current = { [bid]: { sleep: {start, ack, by}|null, updateTime: string|null } }` (null updateTime: no timer document), `events = { [eventId]: { exists, deleted } }`, Write names relative (Contract note 2); `napOutcome(status, body) -> 'ok'|'already'|'moved'|'needs_app'|'baby'|'token'|'unavailable'`.

- [ ] **Step 1: Write the failing tests.** Pinned clock `N = 1794970800000` (18 Nov 2026 03:00 UTC), uid `U = 'uidMum'`, babies `robin`, `wren`, `S = N - 3600000`.

```js
// 2. the rules are the spec's
ok('RULES pin the nap limits', RULES.napAskMs === 43200000 && RULES.napMaxMs === 86400000 && RULES.ackFreshMs === 21600000 && RULES.futureStartMs === 300000);
// parseNapRequest
ok('a start for one baby parses', same(parseNapRequest({ action: 'start', babyIds: ['robin'] }), { action: 'start', babyIds: ['robin'], starts: {}, undo: null }));
ok('a hid in the body is dropped', !('hid' in parseNapRequest({ action: 'state', babyIds: ['robin'], hid: 'H2' })));
for (const bad of [{ action: 'nap', babyIds: ['robin'] }, { action: 'start', babyIds: [] }, { action: 'start', babyIds: ['a', 'b', 'c'] },
  { action: 'start', babyIds: ['robin', 'robin'] }, { action: 'start', babyIds: ['ro/bin'] }, { action: 'stop', babyIds: ['robin'] },
  { action: 'stop', babyIds: ['robin'], starts: { robin: 1.5 } }, { action: 'stop', babyIds: ['robin'], starts: { robin: '1' } },
  { action: 'undo', babyIds: ['robin'], starts: { robin: S } }, null, [], 'x'])
  ok('refused: ' + JSON.stringify(bad), parseNapRequest(bad) === null);
// 3. decideNap
const none = { robin: { sleep: null, updateTime: null } }, idle = { robin: { sleep: null, updateTime: 'T1' } };
const run = (start, ack) => ({ robin: { sleep: { start, ack: ack == null ? null : ack, by: 'uidDad' }, updateTime: 'T1' } });
let d = decideNap(P({ action: 'start', babyIds: ['robin'] }), none, {}, N, U);
ok('start with no timer document: create under exists:false, by the token uid', d.status === 200 && same(d.body, { ok: true, already: false, state: { robin: { start: N, ack: null } }, at: N })
  && same(d.writes, [{ update: { name: 'timers/robin', fields: { sleep: { mapValue: { fields: { start: { integerValue: String(N) }, by: { stringValue: U } } } } } }, updateMask: { fieldPaths: ['sleep'] }, currentDocument: { exists: false } }]));
ok('start on an idle timer: precondition is its updateTime', decideNap(P({ action: 'start', babyIds: ['robin'] }), idle, {}, N, U).writes[0].currentDocument.updateTime === 'T1');
d = decideNap(P({ action: 'start', babyIds: ['robin'] }), run(S), {}, N, U);
ok('start while running: already, nothing written', d.status === 200 && d.body.already === true && d.writes.length === 0 && d.body.state.robin.start === S);
ok('start while a corrupt start runs 5 min + 1 ms ahead: needsApp', decideNap(P({ action: 'start', babyIds: ['robin'] }), run(N + 300001), {}, N, U).body.needsApp === true);
const E = 'sleep-robin-' + S;
d = decideNap(P({ action: 'stop', babyIds: ['robin'], starts: { robin: S } }), run(S), { [E]: { exists: false, deleted: false } }, N, U);
ok('stop: clear under updateTime and create the event under exists:false', d.status === 200 && d.body.already === false && d.body.state.robin === null && same(d.writes, [
  { update: { name: 'timers/robin', fields: {} }, updateMask: { fieldPaths: ['sleep'] }, currentDocument: { updateTime: 'T1' } },
  { update: { name: 'events/' + E, fields: F({ id: E, authorId: U, babyId: 'robin', type: 'sleep', time: S, end: N, via: 'widget' }) }, currentDocument: { exists: false } }]));
ok('no write is ever a delete', allCases.every((c) => c.writes.every((w) => w.update && !('delete' in w))));
ok('stop with a start the timer no longer has: 409 moved with the current state, nothing written', (d = decideNap(P({ action: 'stop', babyIds: ['robin'], starts: { robin: S - 1 } }), run(S), {}, N, U)).status === 409 && d.body.error === 'moved' && d.writes.length === 0 && d.body.state.robin.start === S);
ok('stop when nothing runs: 409 with robin null', decideNap(P({ action: 'stop', babyIds: ['robin'], starts: { robin: S } }), idle, {}, N, U).body.state.robin === null);
ok('stop whose event is already logged: only the clear, already:true', (d = decideNap(Pstop, run(S), { [E]: { exists: true, deleted: false } }, N, U)).body.already === true && d.writes.length === 1);
ok('stop again after an undone stop: the event is brought back, not created, and never answered already', (d = decideNap(Pstop, run(S), { [E]: { exists: true, deleted: true } }, N, U)).writes[1].currentDocument.exists === true && d.body.already === false);
// the long-nap and clock rules (stop, S chosen per row)
ok('12 h exactly, no ack: writes', decideNap(stopAt(N - 43200000), run(N - 43200000), ev0(N - 43200000), N, U).writes.length === 2);
ok('12 h + 1 ms, no ack: needsApp, nothing written', (d = decideNap(stopAt(N - 43200001), run(N - 43200001), ev0(N - 43200001), N, U)).status === 200 && d.body.ok === false && d.body.needsApp === true && d.writes.length === 0);
ok('14 h with an ack 6 h - 1 ms old: writes', decideNap(stopAt(N - 50400000), run(N - 50400000, N - 21599999), ev0(N - 50400000), N, U).writes.length === 2);
ok('14 h with an ack exactly 6 h old: needsApp', decideNap(stopAt(N - 50400000), run(N - 50400000, N - 21600000), ev0(N - 50400000), N, U).body.needsApp === true);
ok('24 h + 1 ms with a fresh ack: needsApp', decideNap(stopAt(N - 86400001), run(N - 86400001, N - 1000), ev0(N - 86400001), N, U).body.needsApp === true);
ok('a start 1 ms ago stops; a start equal to now does not (end must exceed start)', decideNap(stopAt(N - 1), run(N - 1), ev0(N - 1), N, U).writes.length === 2 && decideNap(stopAt(N), run(N), ev0(N), N, U).body.needsApp === true);
ok('start while a stored start is not an integer: needsApp, not already', decideNap(P({ action: 'start', babyIds: ['robin'] }), run(S + 0.5), {}, N, U).body.needsApp === true);
// undo
ok('undo of a start clears only that start', same(decideNap(P({ action: 'undo', undo: 'start', babyIds: ['robin'], starts: { robin: S } }), run(S), {}, N, U).writes, [CLEAR_T1]));
ok('undo of a start that changed: 409', decideNap(P({ action: 'undo', undo: 'start', babyIds: ['robin'], starts: { robin: S } }), run(S + 5), {}, N, U).status === 409);
d = decideNap(P({ action: 'undo', undo: 'stop', babyIds: ['robin'], starts: { robin: S } }), idle, { [E]: { exists: true, deleted: false } }, N, U);
ok('undo of a stop restores the timer and soft-deletes the event, one decision', d.status === 200 && d.writes.length === 2
  && same(d.writes[1], { update: { name: 'events/' + E, fields: F({ deleted: true, deletedAt: N, deletedBy: U }) }, updateMask: { fieldPaths: ['deleted', 'deletedAt', 'deletedBy'] }, currentDocument: { exists: true } }));
ok('undo of a stop after a partner started a new nap: 409, nothing written', decideNap(Pundo, run(N - 2000), { [E]: { exists: true, deleted: false } }, N, U).status === 409);
// Both
const twins = (a, b) => ({ robin: a, wren: b });
ok('start both: two writes in one decision', decideNap(P({ action: 'start', babyIds: ['robin', 'wren'] }), twins(IDLE, IDLE), {}, N, U).writes.length === 2);
ok('start both with one running: 409, nothing written', decideNap(P({ action: 'start', babyIds: ['robin', 'wren'] }), twins(RUN(S), IDLE), {}, N, U).status === 409);
ok('stop both with one start stale: 409, neither written', (d = decideNap(P({ action: 'stop', babyIds: ['robin', 'wren'], starts: { robin: S, wren: S - 9 } }), twins(RUN(S), RUN(S)), EV_BOTH, N, U)).status === 409 && d.writes.length === 0);
// state and odd ids
ok('state: the requested timers, nothing written', same((d = decideNap(P({ action: 'state', babyIds: ['robin'] }), run(S, N - 5), {}, N, U)).body, { ok: true, already: false, state: { robin: { start: S, ack: N - 5 } }, at: N }) && d.writes.length === 0);
ok('a baby id of constructor reads as no timer, never a prototype', decideNap(P({ action: 'state', babyIds: ['constructor'] }), {}, {}, N, U).body.state.constructor === null);
ok('napOutcome names each answer', ['ok', 'already', 'moved', 'needs_app'].every((o, i) => napOutcome(...ANSWERS[i]) === o));
```

`P` is `parseNapRequest`, `F` turns plain values into Firestore fields (integers as `integerValue` strings), `same` is deep equality. `Pstop` is `P({ action: 'stop', babyIds: ['robin'], starts: { robin: S } })` and `Pundo` the same with `action: 'undo', undo: 'stop'`; `stopAt(x)` is `Pstop` with start x and `ev0(x)` is `{ ['sleep-robin-' + x]: { exists: false, deleted: false } }`; `IDLE` and `RUN(s)` are one baby's entries of `idle` and `run(s)`; `EV_BOTH` holds both babies' unlogged events for S; `CLEAR_T1` is the first Write of the stop case; `allCases` collects every `decideNap` result in the file; `ANSWERS` are the (status, body) pairs of the stop, already, stale-stop and 12 h cases. `--self-test` loads a temp copy of nap.mjs (its `../shared/` import rewritten to the tree's absolute `file://` path, as test/dose-membership.test.js:460-462 does) with the start-running check removed, and must turn "start while running" red; a missing anchor counts as a failure.

- [ ] **Step 2: Run them and see them fail.** `node test/widget-nap-decide.test.js` → `Cannot find module .../workers/widget/nap.mjs`.
- [ ] **Step 3: Implement** nap.mjs with the signatures above. Ids match `^[A-Za-z0-9_-]{1,64}$`; every lookup into `current`, `events` and `starts` is own-property only. With `valid(s) = Number.isInteger(s) && s <= now + RULES.futureStartMs` and `el = now - start`: Start on a running timer whose start is not valid answers needsApp instead of already; Stop first requires the sent start to equal the stored one (else 409), then answers needsApp when `!valid(start) || now <= start || el > RULES.napMaxMs || (el > RULES.napAskMs && !(Number.isInteger(ack) && now - ack < RULES.ackFreshMs))`. `napOutcome`: 200 ok is `ok`, 200 already `already`, 409 `moved`, needsApp `needs_app`, 403 `baby`, 401 `token`, anything else `unavailable`. A restored timer (undo of a stop) is `{ start, by: uid }`: the old `ack` and starter are not known, so a snoozed long nap comes back unsnoozed and the widget then opens Cubby for it, the stricter of the two. A brought-back event's update names `end, via, deleted, deletedAt, deletedBy` in its mask with only `end` and `via` in the fields.
- [ ] **Step 4: Run and pass.** `node test/widget-nap-decide.test.js` → `WIDGET-NAP-DECIDE: PASS`; `node test/widget-nap-decide.test.js --self-test` → the start mutant is caught (`FAIL start while running` inside the mutant run, `self-test: 1 of 1 caught`).
- [ ] **Step 5: Commit.**
```bash
git add workers/widget/nap.mjs
git commit -o workers/widget/nap.mjs test/widget-nap-decide.test.js -m "The nap decision: start, stop, undo and state as Firestore writes with their preconditions, never a delete" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Mint and revoke, wired into the Worker

**Files:**
- Create: `workers/widget/routes.mjs`; `test/helpers/widget-emu.js`; `test/widget-nap-emulator.test.js`
- Modify: `worker.js:16-17` (imports), `worker.js:2459` (return `iat`), after `worker.js:2460` (`WIDGET_DEPS`, `__widget`), before `worker.js:3437` (dispatch); `wrangler.toml` after `:123` (two limiter blocks); `firestore.rules:162-165`; `test/widget-nap-decide.test.js` (section 4, wiring); `test/ratelimit.test.js:48-59`; `tools/fuzz_worker.js:110-122, 128-135, 165`; `tools/gates.js:339-340` (EMU_GATES)

**Interfaces:**
- Consumes: Task 1's token.mjs; `isTwins`, `sleepEventId`, `RULES` (P1, since-rules.mjs); `fromFs` (workers/shared/fs-values.mjs:8).
- Produces: `widgetRoute(request, env, url, deps) -> Promise<Response>` with `deps = { json, rateLimited, clientIpKey, getAccessToken, fsGetStrict, isCarer, verifyFirebaseToken, FS_PROJECT, waitUntil? }`; routes.mjs `MINT_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'`; worker.js `export const __widget = { deps: WIDGET_DEPS, decideNap, parseNapRequest, mintWidgetToken, checkWidgetToken, widgetTokenDocId }` (test hook, like `__dose`); `verifyFirebaseToken(idToken) -> { uid, email, iat }`; test/helpers/widget-emu.js `startEmulators(project, rulesPath)`, `emuVerify(project) -> (idToken) => Promise<{uid, email, iat}>`, `rewriteFetch({ fs, auth, project, faults })`, `signUp(email)`, `seedHousehold(hid, fields)`, `callRoute(path, init, envExtra)`.

- [ ] **Step 1: Write the failing tests.** Wiring, in widget-nap-decide section 4:

```js
const W = read('worker.js'), closure = importClosure('workers/widget/routes.mjs');   // every relative import, followed
ok('worker.js imports every module the widget routes reach, directly', closure.every((p) => W.includes("from './" + p + "'")), closure.filter((p) => !W.includes("from './" + p + "'")));
ok('worker.js sends /api/widget/ to widgetRoute', /url\.pathname\.startsWith\('\/api\/widget\/'\)\)\s*return widgetRoute\(request, env, url, widgetDeps\(ctx\)\)/.test(W));
ok('wrangler: WIDGET_RATE_LIMITER is 1008, 30 a minute', limiter('WIDGET_RATE_LIMITER') === '1008:30:60');
ok('wrangler: WIDGET_TOKEN_RATE_LIMITER is 1009, 12 a minute', limiter('WIDGET_TOKEN_RATE_LIMITER') === '1009:12:60');
ok('wrangler: no namespace_id is used twice', uniqueNamespaces(read('wrangler.toml')));
ok('rules: widgetTokens is closed to every client', /match \/widgetTokens\/\{id\}\s*\{ allow read, write: if false; \}/.test(read('firestore.rules')));
ok('no widget module puts a precondition in a URL', !/currentDocument\./.test(read('workers/widget/routes.mjs') + read('workers/widget/nap.mjs')));
```

`test/widget-nap-emulator.test.js` (self-hosting like test/signin-claim-auth-emu.test.js:40-62: outer phase runs `firebase emulators:exec --only firestore,auth --project demo-cubby-widget` on FS_PORT/AUTH_PORT/HUB_PORT/LOG_PORT/WS_PORT, with a scratch firebase.json whose rules are a copy of this tree's firestore.rules). Every token comes from the Auth emulator (`accounts:signUp`), never hand-made. Section 1, mint and revoke:

```js
const mum = await signUp('mum@example.com'), dad = await signUp('dad@example.com'), stranger = await signUp('s@example.com');
await seedHousehold('H', { members: { [mum.uid]: 'owner', [dad.uid]: 'caregiver' }, app: { babies: [ROBIN, WREN] } });
const m1 = await mint(mum, OK_BODY);            // OK_BODY = { hid: 'H', deviceId: 'dev-mum-iphone-0001', platform: 'ios' }
ok('mint: 200 with a w1 token and expireAt 90 days on', m1.status === 200 && WIDGET_TOKEN_RE.test(m1.body.t) && Math.abs(m1.body.expireAt - (Date.now() + 7776000000)) < 60000);
const row = await getDoc('widgetTokens/' + sha256(m1.body.t));
ok('the row holds exactly uid, hid, deviceId, platform, createdAt, lastUsedAt, expireAt (a timestamp)', same(Object.keys(row.fields).sort(), ['createdAt', 'deviceId', 'expireAt', 'hid', 'lastUsedAt', 'platform', 'uid']) && !!row.fields.expireAt.timestampValue);
ok('mint again from the same phone replaces its row', (await rowsOf(mum.uid)).length === 1 && (await mintAgain()).status === 200 && (await rowsOf(mum.uid)).length === 1);
ok('a sixth phone evicts the least recently used row; five stay', await sixDevicesKeepFive(mum));
await disable(dad); const rd = await mint(dad, OK_BODY);
ok('disabled account: 401 unauthorized, no row', rd.status === 401 && rd.body.error === 'unauthorized' && (await rowsOf(dad.uid)).length === 0);
ok('a token issued before validSince: 401', await revokedSessionRefused(mum));
ok('not a member: 403 not_member', (await mint(stranger, OK_BODY)).body.error === 'not_member');
ok('a household flagged deleteAfter: 403 not_member', (await mint(mum, { ...OK_BODY, hid: 'HDEL' })).status === 403);
for (const b of [{ ...OK_BODY, hid: 'H/x' }, { ...OK_BODY, deviceId: 'short' }, { ...OK_BODY, platform: 'web' }, { ...OK_BODY, idToken: 7 }])
  ok('bad body is 400: ' + JSON.stringify(b).slice(0, 40), (await mintRaw(b)).status === 400);
ok('Identity Toolkit unavailable: 503 unavailable, no row', (await withFault('accounts:lookup', 503, () => mint(mum, OK_BODY))).body.error === 'unavailable');
ok('rules: a signed-in member reading her own widgetTokens row over REST is refused', (await asUser(mum, 'GET', 'widgetTokens/' + sha256(m1.body.t))).status === 403);
ok('revoke: 200 and the row is gone', (await revoke(m1.body.t)).status === 200 && !(await getDoc('widgetTokens/' + sha256(m1.body.t))));
ok('revoke of a forged token: 200 ok and zero Firestore calls', await countedCalls(() => revoke('w1.' + 'A'.repeat(32) + '.' + 'B'.repeat(43))) === 0);
ok('rules: and writing one', (await asUser(mum, 'PATCH', 'widgetTokens/x', { uid: mum.uid })).status === 403);
ok('through worker.js itself: the real verifier refuses an emulator token (401 unauthorized)', (await viaWorkerFetch('/api/widget/mint', OK_BODY_MUM)).status === 401);
```

`--self-test` (by hand, not in the gate command) re-loads the rules through the emulator's `PUT /emulator/v1/projects/demo-cubby-widget:securityRules` with `allow read: if request.auth != null` on widgetTokens, and the rules check must go red (the companion to an assertion that otherwise only sees an absence). Add `{ tag: 'widget_mint', binding: 'WIDGET_RATE_LIMITER', ... }` and `widget_revoke` rows to test/ratelimit.test.js, and `['POST', '/api/widget/mint'], ['POST', '/api/widget/revoke'], ['POST', '/api/widget/nap']` plus fields `hid, deviceId, platform, action, babyIds, starts, undo` to tools/fuzz_worker.js, whose stub gains `:beginTransaction` (`{ transaction: 'dHg=' }`) and `:batchGet` (every name `missing`).

- [ ] **Step 2: Run them and see them fail.** `node tools/gates.js --only=widget-nap-decide` → FAIL on the five wiring checks; `node test/widget-nap-emulator.test.js` → `Cannot find module .../workers/widget/routes.mjs`; `node test/ratelimit.test.js` → FAIL `widget_mint answers 429`.
- [ ] **Step 3: Implement.**
  - worker.js imports, directly: `widgetRoute` (routes.mjs), the token.mjs exports, `decideNap, parseNapRequest` (nap.mjs), `isTwins, sleepEventId` (`./workers/shared/since-rules.mjs`), `RULES as WIDGET_RULES` (`./workers/shared/widget-rules.mjs`), `fromFs` (`./workers/shared/fs-values.mjs`). Dispatch: `if (url.pathname.startsWith('/api/widget/')) return widgetRoute(request, env, url, widgetDeps(ctx));` before `/api/account/purge`, where `widgetDeps(ctx)` is `WIDGET_DEPS` plus `waitUntil: (p) => ctx.waitUntil(p)` (Contract note 9).
  - routes.mjs: a table of `{ path, method, handler }`; unknown path 404 `{error:'not_found'}`, wrong method 405 `{error:'method'}`; bodies over 4096 bytes or not JSON are 400 `{error:'bad_request'}`; a missing or unparsable service account is 500 `{error:'server_config'}` (after the per-IP limit); every Google failure is 503 `{error:'unavailable'}`, the code tools/fuzz_worker.js declares.
  - Mint, in order: `wmint:` limit; body (idToken string up to 4096, hid `^[A-Za-z0-9_-]{1,128}$`, deviceId `^[A-Za-z0-9_-]{16,64}$`, platform `ios|android`; `push` is accepted and ignored until P5); `deps.verifyFirebaseToken` (throw: 401); one access token with `MINT_SCOPE` (`https://www.googleapis.com/auth/cloud-platform`); `POST https://identitytoolkit.googleapis.com/v1/projects/{FS_PROJECT}/accounts:lookup {localId:[uid]}` (not ok: 503; no user, `disabled`, or `iat < Number(validSince)`: 401); household `fsGetStrict(..., ['members', 'deleteAfter'])` (404, `deleteAfter`, not `isCarer`: 403; other failure: 503); then one transaction: `:beginTransaction`, `:runQuery` on widgetTokens `uid == uid` (select deviceId, lastUsedAt, limit 50) inside it, `:commit` with deletes for this deviceId's rows and the oldest `lastUsedAt` rows beyond four, plus the new row under `currentDocument: {exists:false}`. ABORTED or a precondition failure: one retry after 300 ms, then 503.
  - Revoke: `wrev:` limit; a token failing `checkWidgetToken` answers 200 `{ok:true}` with no read; else `DELETE widgetTokens/<id>` (404 is fine; any other failure is logged as `widget_revoke_fail` and still answers 200, since the phone has already forgotten it).
  - wrangler.toml: `WIDGET_RATE_LIMITER` (1008, `simple = { limit = 30, period = 60 }`) and `WIDGET_TOKEN_RATE_LIMITER` (1009, 12/60) after DOSE_RATE_LIMITER, with the approximate-limit note the file already carries.
  - firestore.rules: `match /widgetTokens/{id} { allow read, write: if false; }` after `:165`, with a comment in the style of :147-160 (server-only; a client that could write it could mint itself a capability).
  - Register `{ name: 'widget-nap-emu', self: ['node', 'test/widget-nap-emulator.test.js'] }` after `admin-read-emu`.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --only=widget-nap-decide` → PASS; `node tools/gates.js --emulator --only=widget-nap-emu` → `WIDGET-NAP-EMU: PASS`; `node test/widget-nap-emulator.test.js --self-test` → the planted rules hole is caught; `node tools/gates.js --only=ratelimit,fuzz-worker,worker-routes,signin-flow,signin-budget` → all PASS (the import closure loads in every temp-dir loader); `node tools/gates.js --emulator --only=signin-claim-auth,signin-code-emu` → PASS.
- [ ] **Step 5: Commit.**
```bash
git add workers/widget/routes.mjs test/helpers/widget-emu.js test/widget-nap-emulator.test.js
git commit -o workers/widget/routes.mjs test/helpers/widget-emu.js test/widget-nap-emulator.test.js worker.js wrangler.toml firestore.rules test/widget-nap-decide.test.js test/ratelimit.test.js tools/fuzz_worker.js tools/gates.js -m "Widget tokens are minted for a current member only, one per phone and five per person, and revoked by the token itself" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: The nap route

**Files:**
- Modify: `workers/widget/routes.mjs` (nap handler); `test/widget-nap-emulator.test.js` (section 2 and its mutants); `test/ratelimit.test.js` (a `widget_nap` row and a `widget_token` row); `docs/TESTING.md:222-235` (red-run rows)

**Interfaces:**
- Consumes: Tasks 1-3; P2's timer documents.
- Produces: `POST /api/widget/nap` per Global Constraints; routes.mjs exports `tokenGate(request, env, deps, { ipKey, mask }) -> Promise<{ ok: true, row, docId, hh, token } | { ok: false, response, row: Row|null }>` (Contract note 9; `token` is the Google access token; P5 reuses the gate with its own mask) and `WIDGET_SCOPE = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging'`; analytics hook `onNap(deps, { action, outcome, platform })` inside routes.mjs (Task 6 makes it `recordServerEvent` through `deps.waitUntil`).

- [ ] **Step 1: Write the failing tests** (section 2 of the emulator suite; tokens minted in section 1's way; `twinsH` holds robin and wren born 2026-09-01, `sibH` holds ivy born 2025-01-02 and oak born 2026-08-10):

```js
ok('start writes timers/robin {sleep:{start: server now, by: mum}} and answers ok', okStart(await nap(MUM, { action: 'start', babyIds: ['robin'] })));
ok('a second start answers already:true and changes nothing', (r = await nap(MUM, START_R)).body.already === true && (await timer('robin')).updateTime === before);
ok('stop with the shown start: sleep cleared, the timer document kept, one event sleep-robin-S by mum via widget', await stopWritesOneEvent(MUM, 'robin'));
ok('stop: the clear and the event land in one commit (one commitTime)', lastCommit().writes.length === 3 && lastCommit().count === 1);
ok('stop with a stale start: 409 moved with the current state, nothing written', (r = await nap(MUM, staleStop)).status === 409 && r.body.error === 'moved' && unchanged());
ok('undo of that stop restores the timer and marks the event deleted by mum; a second undo is 409', await undoStopRoundTrip(MUM));
ok('undo of a start clears only that start', await undoStartClears(MUM));
ok('start both twins: one commit, both timers', await bothStartOneCommit(MUM));
ok('stop both with one stale start: 409 and neither changes', await bothStaleRefused(MUM));
ok('siblings sent as Both: 403 baby, nothing written', (await nap(SIB, { action: 'start', babyIds: ['ivy', 'oak'] })).body.error === 'baby');
ok('a baby not in the token\'s household: 403 baby', (await nap(MUM, { action: 'start', babyIds: ['ivy'] })).status === 403);
ok('12 h without a snooze: needsApp, nothing written', await longNap(MUM, { age: 43200001, ack: null, expect: 'needsApp' }));
ok('14 h with a snooze 2 h old: stop writes', await longNap(MUM, { age: 50400000, ack: 7200000, expect: 'stopped' }));
ok('24 h + 1 minute with a snooze a minute old: needsApp', await longNap(MUM, { age: 86460000, ack: 60000, expect: 'needsApp' }));
ok('a stored start 6 minutes ahead (a fast phone wrote it): needsApp', await longNap(MUM, { age: -360000, ack: null, expect: 'needsApp' }));
ok('state: the requested timers, nothing written', await stateReadsOnly(MUM));
ok('a hid in the body is ignored: the token\'s household is used', await bodyHidIgnored(MUM, 'sibH'));
ok('forged token, through worker.js: 401 token and zero Firestore or Identity Toolkit calls', await forgedCostsNothing());
ok('a removed caregiver: next tap 401, his row gone, nothing written', await removedCaregiver(DAD));
ok('a household flagged deleteAfter: 401, row gone', await flaggedHousehold(MUM));
ok('household read fails: 503 unavailable, row kept', await withFault('households/', 503, async () => (await nap(MUM, START_R)).status === 503) && await rowExists(MUM));
ok('a row past expireAt the TTL has not removed: 401, row deleted (Review Focus 4)', await expiredRowRefused(MUM));
ok('a tap slides expireAt to now + 90 days and lastUsedAt to now (Review Focus 4)', await slides(MUM));
ok('both parents stop at once: one event, one ok, the other 409 with robin null (Review Focus 2)', await bothParentsStop(MUM, DAD));
ok('a timer changed between read and commit: one retry 300 ms later, then the right answer', await racedRetriesOnce(MUM));
ok('no commit ever names the household document', commits.every((c) => c.writes.every((w) => !/\/households\/[^/]+$/.test(nameOf(w)))));
ok('every precondition rides in the commit body; no URL carries currentDocument', urls.every((u) => !/currentDocument/.test(u)));
ok('tokenGate answers ok, row, docId, hh and the access token it minted', same(Object.keys(g = await gate(MUM)).sort(), ['docId', 'hh', 'ok', 'row', 'token']) && typeof g.token === 'string' && g.token.length > 0);
ok('one tap mints one Google access token, datastore and firebase.messaging, and the handler reuses the gate\'s', same(await scopesOf(() => nap(MUM, STATE_R)), [WIDGET_SCOPE]));
ok('mint keeps cloud-platform for Identity Toolkit', same(await scopesOf(() => mint(MUM, OK_BODY)), ['https://www.googleapis.com/auth/cloud-platform']));
```

`gate(user)` calls the exported `tokenGate` with a fresh request carrying that user's minted token, `ipKey: 'wnap:'` and the nap mask. `scopesOf(fn)` collects the `scope` claim of every JWT assertion posted to `https://oauth2.googleapis.com/token` while `fn` runs (rewriteFetch sees each one), so it reads what worker.js's real `getAccessToken` (worker.js:96-111) asked for. `STATE_R` is `{ action: 'state', babyIds: ['robin'] }`.

`--self-test` adds the five mutants of spec 6.12, each in temp copies of workers/widget/*.mjs, each turning its named check red: the precondition moved into a query string ("every precondition rides in the commit body", and the real emulator then refuses the write); the `isCarer` check removed ("a removed caregiver"); the clear sent as a `{delete}` Write ("the timer document kept"); the start-running check removed ("a second start answers already"); stop sent as two commits ("one commit"). A mutant whose anchor text is missing fails the self-test.

- [ ] **Step 2: Run them and see them fail.** `node test/widget-nap-emulator.test.js` → section 2 FAILs with 404 `not_found` from widgetRoute, and the gate check with `tokenGate is not a function`.
- [ ] **Step 3: Implement the nap handler**, in order (everything from the per-IP limit to the household read is `tokenGate` with `ipKey: 'wnap:'` and mask `['members','deleteAfter','app.babies']`; the body is parsed after it): `wnap:` limit; service account; bearer and `checkWidgetToken` (401 `{error:'token'}`); `wt:<docId>` limit; one access token with `WIDGET_SCOPE`, which the gate returns as `token` and every later read, commit and delete of the request uses; token row `fsGetStrict(widgetTokens/<id>, ['uid','hid','platform','expireAt','lastUsedAt'])` (404: 401; other failure: 503; `expireAt` past: delete the row, 401); household `fsGetStrict(households/<hid>, ['members','deleteAfter','app.babies'])` (failure: 503; 404, `deleteAfter` or not `isCarer(fields, row.uid)`: delete the row, 401); body and `parseNapRequest` (400); babies from `fromFs(app.babies)`: any id missing, or two ids that are not `isTwins`, is 403 `{error:'baby'}`; one `:batchGet` for the timers and `napEventIds(req)`; `decideNap(..., Date.now(), row.uid)`; when it has writes, qualify the names and commit them together with the row slide (`lastUsedAt` now, `expireAt` now + 90 days, under `currentDocument: {exists:true}`, so a row revoked mid-tap is never recreated). A raced commit (FAILED_PRECONDITION, ALREADY_EXISTS, NOT_FOUND, ABORTED) re-runs from the token row once after 300 ms if under 7 s have passed, else 503. With no nap writes, the slide is its own best-effort commit only when `lastUsedAt` is over a day old. `onNap` fires only once the row is read (platform known), so a stranger's forged or unknown token never reaches D1.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --emulator --only=widget-nap-emu` → PASS; `node test/widget-nap-emulator.test.js --self-test` → `self-test: 6 of 6 caught` (five code mutants and the rules hole); `node tools/gates.js --only=ratelimit,fuzz-worker` → PASS. Add the widget-nap-decide and widget-nap-emu rows to docs/TESTING.md's red-run table.
- [ ] **Step 5: Commit.**
```bash
git commit -o workers/widget/routes.mjs test/widget-nap-emulator.test.js test/ratelimit.test.js docs/TESTING.md -m "Sleep from the widget: one commit per tap under the timer's precondition, refused for anyone no longer in the family" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Tokens leave with the account and the family

**Files:**
- Modify: `workers/widget/token.mjs` (`deleteWidgetTokensWhere`); `worker.js:2181-2188` (purgeAccountData), `worker.js:2104-2109` (household purge); `app/store-firebase.js:3841-3851` (the purge call), app/sw.js (CACHE); `test/purge-guard.test.js:58-66`; `test/widget-nap-emulator.test.js` (section 3)

**Interfaces:**
- Consumes: Task 1 `deleteWidgetTokensWhere`.
- Produces: store-firebase.js `async function purgeAccountServer(idToken, fetchImpl, wait) -> Promise<void>` (IIFE scope; resolves on a 2xx, rejects `Error('purge_unavailable')` after three failed attempts at 0, 1 s and 3 s).

- [ ] **Step 1: Write the failing tests** (section 3; the account purge is driven through worker.js's fetch with a JWK stub and RS256 tokens signed in the test, as test/feedback-purge-emulator.test.js:42-61 does, because that route's verifier is the real one):

```js
ok('account purge deletes every widgetTokens row of that uid', (await purgeAccount(MUM)).status === 200 && (await rowsOf(MUM.uid)).length === 0);
ok('companion: another person\'s rows stay', (await rowsOf(DAD.uid)).length === 1);
ok('no rows, no commit (the feedback commit count is unchanged)', await purgeWithNoRows() === 0);
ok('the household purge deletes that household\'s rows before the household document', await cronPurgeOrder('HGONE'));
ok('a failed token query keeps the household for the next tick', await withFault('widgetTokens', 503, () => cronKeeps('HGONE2')));
ok('a query hit outside widgetTokens is never deleted', await strayNameIgnored());
const P = extractFn(read('app/store-firebase.js'), 'purgeAccountServer');      // the app's own function, run in node
ok('the app retries a failed purge: 503, 503, 200 is three calls and resolves', await retries(P, [503, 503, 200]) === 3);
ok('three failures reject purge_unavailable', await rejects(P, [503, 503, 503], 'purge_unavailable'));
ok('a network throw counts as a failure', await rejects(P, ['throw', 'throw', 'throw'], 'purge_unavailable'));
ok('deleteAccount awaits it before the local traces and the login, and nothing swallows it',
   /await purgeAccountServer\(/.test(deleteAccountSrc) && deleteAccountSrc.indexOf('await purgeAccountServer(') < deleteAccountSrc.indexOf('// 4. Local traces.') && !/console\.warn\('purge d1'/.test(deleteAccountSrc));
```

The retry checks drive the extracted function against the real Worker in this process (its `fetchImpl` answers from the in-process `/api/account/purge`, with the planted 503s in front).

- [ ] **Step 2: Run them and see them fail.** `node test/widget-nap-emulator.test.js` → FAIL on all section 3 checks (rows remain; `purgeAccountServer not found in app/store-firebase.js`).
- [ ] **Step 3: Implement.** `deleteWidgetTokensWhere`: one `:runQuery` on widgetTokens `field == value`, `select __name__`, limit 50; no commit when nothing came back; one `:commit` of `{delete}` Writes for names matching `/documents/widgetTokens/[0-9a-f]{64}$` only; a full page of 50 or any failure returns null. purgeAccountData: after the usage erase and before feedback, `if ((await deleteWidgetTokensWhere(...'uid', auth.uid)) === null) { failed = true; console.error('purge_widget_fail'); }`, updating the subrequest comment (+3). Household purge: after the HH_NESTED loop, `'hid', hid`; null sets `complete = false`. store-firebase.js: replace the swallowed fetch at `:3841-3851` with `await purgeAccountServer(await u.getIdToken(), fetch, (ms) => new Promise((r) => setTimeout(r, ms)))`, keeping `usagePurgeAsked = true` before it; a rejection reaches the existing catch, so the login is kept and doDeleteAccount's own toast (app/index.html:8871, "Could not finish deleting. Please try again") is what she sees. test/purge-guard.test.js answers a widgetTokens query with `[]`. Bump CACHE in app/sw.js.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --emulator --only=widget-nap-emu,feedback-purge-emu,purge-erase-emu,purge-unflag-emu` → PASS; `node tools/gates.js --only=purge-guard,usage-erasure,usage-erasure-mut` → PASS.
- [ ] **Step 5: Commit.**
```bash
git commit -o workers/widget/token.mjs worker.js app/store-firebase.js app/sw.js test/purge-guard.test.js test/widget-nap-emulator.test.js -m "Widget tokens go with the account and with the family, and a deletion retries its server purge instead of shrugging" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> FOUNDER STEP: yes to push main (routes go live, unused until a Phase B binary mints), and in the same sitting publish the widgetTokens rule: `npx firebase deploy --only firestore:rules --project little-log-a9caa`.
>
> FOUNDER STEP: the TTL policy: `gcloud firestore fields ttls update expireAt --collection-group=widgetTokens --enable-ttl --project=little-log-a9caa` (recorded in OPERATIONS.md by Task 10). If the console refuses TTL on the current plan, nothing breaks: the route refuses and deletes expired rows itself.

### Task 6: The widget.nap event

**Files:**
- Modify: `workers/usage/core.mjs:48-62` (USAGE_EVENTS), `:97-114` (checkEvent), `:257-345` (ingest), new `recordServerEvent`; `test/usage-ingest.test.js` (a server-events section before `:473`, two BREAKS rows in `:480-512`); `.telemetry/tracking-plan.yaml:3-6` (header counts) and the linked list near `:553`; `tools/tracking_plan_check.js:260-269` and its mutants; `app/usage-allowlist.js` (regenerated), app/sw.js; `workers/widget/routes.mjs` (`onNap`)

**Interfaces:**
- Consumes: Task 4's `onNap`.
- Produces: `recordServerEvent(env, name, props, platform: 'ios_app'|'android_app') -> Promise<void>` (never throws); `USAGE_EVENTS['widget.nap'] = { anon: true, server: true, props: { action: enum, outcome: enum } }`; `checkEvent(raw, now, signedIn, server = false)`; `ingest(body, ctx)` honours `ctx.server`.

- [ ] **Step 1: Write the failing tests** (usage-ingest, against the real schema/usage.sql through `makeD1`):

```js
await recordServerEvent({ USAGE_DB: db, USAGE_MODE: 'on' }, 'widget.nap', { action: 'stop', outcome: 'ok' }, 'ios_app');
const rows = db.raw.prepare('SELECT uid, hid, platform, name, props FROM usage_events').all();
ok('mode on: one anon widget.nap row', rows.length === 1 && rows[0].uid === null && rows[0].hid === null && rows[0].platform === 'ios_app' && rows[0].props === '{"action":"stop","outcome":"ok"}');
ok('a server event writes no devices row', db.raw.prepare('SELECT COUNT(*) AS c FROM devices').get().c === 0);
ok('mode off and internal store nothing', await storedIn('off') === 0 && await storedIn('internal') === 0);
ok('an outcome outside the list is refused, never thrown', await storedWith({ action: 'stop', outcome: 'saved' }) === 0);
ok('a phone may not send widget.nap, even signed in (bad_event)', (await ingest(phoneBatch('widget.nap'), ctxSignedIn)).body.refused === 1);
```

Two BREAKS rows: the server check in checkEvent removed ("a phone may not send widget.nap"), and the devices skip removed ("no devices row"). tracking_plan_check gains a mutant: a `server: true` event in core.mjs with no `source: server` plan entry must go red.

- [ ] **Step 2: Run and fail.** `node test/usage-ingest.test.js` → `recordServerEvent is not a function`; `node tools/tracking_plan_check.js --self-test` → the new mutant is not caught.
- [ ] **Step 3: Implement.** `recordServerEvent` returns at once unless `env.USAGE_DB` and `modeOf(env) === 'on'`, then calls `ingest` with `{ v: SCHEMA_VERSION, device: 'd_widgetserver', platform, app_version: 'v0', tz: 'UTC', events: [{ id: crypto.randomUUID(), visit: 'v_' + 8 random [a-z0-9], t: now, name, props }] }` and `{ db, env, uid: null, now, isolate, server: true }`; ingest passes `server` to checkEvent and skips the devices upsert when `ctx.server`; core.mjs still imports nothing. The plan gets a `widget.nap` entry (`source: server`, `before_sign_in: true`, `fires_when: A tap on Sleep in a home-screen widget is answered by the Worker.`, both properties) and its header's server count and total each go up by one. The gate compares core's keys with plan events that are `source: new`, or `source: server` with properties, and checks each server one carries `server: true`. `node tools/gen_usage_allowlist.js` regenerates the allowlist. routes.mjs: `onNap` maps the token row's platform (`ios` to `ios_app`, `android` to `android_app`) and hands `recordServerEvent(...)` to `deps.waitUntil`, awaiting it only when `deps.waitUntil` is absent. Bump CACHE.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --only=usage-ingest,usage-ingest-mut,usage-route,tracking-plan` → PASS; `node tools/gates.js --emulator --only=widget-nap-emu` → PASS with a new check, "one anon widget.nap row per answered tap, none for a forged token" (USAGE_MODE 'on', `makeD1` as env.USAGE_DB).
- [ ] **Step 5: Commit.**
```bash
git commit -o workers/usage/core.mjs workers/widget/routes.mjs test/usage-ingest.test.js test/widget-nap-emulator.test.js .telemetry/tracking-plan.yaml tools/tracking_plan_check.js app/usage-allowlist.js app/sw.js -m "Usage: the Worker records each widget sleep tap as an anonymous count, and no phone can send one" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The app mints and the race holds

**Files:**
- Modify: `app/native-bridge.js` (P1's `window.cubbyWidget` block: `mintToken`, `revokeToken`; `:184` appStateChange), `app/store-firebase.js:2897-2901` (new `LL.widgetTokenSync` beside householdSeen) and `:3051` (call at boot), app/sw.js; `test/widget-timer-race-emulator.test.js` (P2's; two P4 sections and one mutant)

**Interfaces:**
- Consumes: P1 `window.cubbyWidget.versions()`, `hasWidgets()`, `widgetWipe(reason)`; P2 `LL.napStart/napStop/napAck`; Tasks 3-4 routes; test/helpers/widget-emu.js.
- Produces: `window.cubbyWidget.mintToken({ idToken, hid }) -> Promise<{ok, status}|null>`, `window.cubbyWidget.revokeToken() -> Promise<{ok}|null>` (null on the web or a binary without the method); `LL.widgetTokenSync(why: 'boot'|'foreground') -> Promise<'minted'|'revoked'|'skipped'|'refused'|'failed'>`.

- [ ] **Step 1: Write the failing tests.** In P2's harness (Olive owns the family, Nina joined by link, babies `1a2b3c` Robin and `42x` Wren), P2's `workerStop` helper is replaced by the real route: `widgetRoute` called in-process with `__widget.deps` and the emulator verifier, using a token minted through `/api/widget/mint` with Olive's emulator-issued ID token; P2's sections 5 to 7 then race the real Worker. Olive's page gets, through `evaluateOnNewDocument`, a Capacitor stub (`isNativePlatform: () => true`, `getPlatform: () => 'ios'`) whose `CubbyWidget` reports `{ inPlace: true }` and one medium widget, and whose `mintToken` forwards through `page.exposeFunction` to the in-process Worker's `/api/widget/mint` with deviceId `dev-race-ipad-00001`, keeping the returned token in node:

```js
ok('boot, once the family is seen from the server: one mint with her own idToken and household', mints.length === 1 && uidOfJwt(mints[0].idToken) === OLIVE.uid && mints[0].hid === OLIVE_HID);
ok('the mint went through the real route: one row for (Olive, this device)', (await rowsOf(OLIVE.uid)).filter((r) => r.deviceId === 'dev-race-ipad-00001').length === 1);
ok('a foreground mints again and still leaves one row', (await fireAppState(true), mints.length === 2) && (await rowsOf(OLIVE.uid)).length === 1);
ok('no widget on the phone: revokeToken, no mint', (await setWidgets(0), await page.evaluate(() => LL.widgetTokenSync('foreground'))) === 'revoked' && mints.length === 2);
ok('a Phase A binary (inPlace false) never mints', await withInPlace(false, () => page.evaluate(() => LL.widgetTokenSync('foreground'))) === 'skipped');
ok('on the plain web, mintToken resolves null', await webPage.evaluate(() => window.cubbyWidget.mintToken({ idToken: 'x', hid: 'H' })) === null);
// the race: the real Worker against the real client, on the same timer
ok('widget stop and app stop of one nap: one event sleep-1a2b3c-S, timer cleared, no nap resurrected', await raceStop('1a2b3c'));
ok('widget start against the app\'s keep-running: never a timer with ack and no start', await raceStartVsAck());
ok('app start then widget stop in the same second: one nap, one event', await raceStartThenStop());
```

Mutant, in P2's convention: `RACE_MUTANT=worker-noprecondition` loads a temp copy of workers/widget/ whose clear carries no updateTime precondition, and must turn "no nap resurrected" red.

- [ ] **Step 2: Run and fail.** `node test/widget-timer-race-emulator.test.js` → FAIL `boot ... one mint` (`LL.widgetTokenSync is not a function`).
- [ ] **Step 3: Implement.** native-bridge: `mintToken` and `revokeToken` wrap `Capacitor.Plugins.CubbyWidget` the way P1's four methods do; the appStateChange listener also calls `window.LL.widgetTokenSync('foreground')` when `s.isActive`. store-firebase: `widgetTokenSync` returns 'skipped' without `window.cubbyWidget`, when `versions()` lacks `inPlace: true`, while `deletingAccount` or `accessLostShown`, or without `auth.currentUser` and `hhRef`; reads `await window.cubbyWidget.hasWidgets()`, the plugin's whole answer `{ value, kinds }` (false on the web; 2.2, 2.6), as `!!(h && h.value === true)` and calls `revokeToken()` when false; otherwise `mintToken({ idToken: await user.getIdToken(), hid: hhRef.id })`; 401 calls `widgetWipe('unauthorized')` and returns 'refused', 403 returns 'refused' (native already dropped the token; access-lost handles the rest). One call in flight at a time. Called after `householdSeen(user.uid)` at `:3051`. Bump CACHE.
- [ ] **Step 4: Run and pass.** `node tools/gates.js --emulator --only=widget-timer-race-emu` → PASS; `RACE_MUTANT=worker-noprecondition node tools/gates.js --emulator --only=widget-timer-race-emu` → FAIL "no nap resurrected"; `node tools/gates.js --only=widget-snapshot,widget-deeplink,native-deeplink` → PASS.
- [ ] **Step 5: Commit.**
```bash
git commit -o app/native-bridge.js app/store-firebase.js app/sw.js test/widget-timer-race-emulator.test.js -m "The app keeps its widget signed in on each open while a widget exists, and the widget's sleep holds up against the app's own" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: iOS: the token in the Keychain

**Files:**
- Create: `native-ios/Shared/WidgetKeychain.swift` (with `KeychainBackend`, `SecItemBackend`), `native-ios/Shared/WidgetTokenService.swift` (with `WidgetWipe`, `WidgetAPI`), `native-ios/Tests/WidgetKeychainTests.swift`, `native-ios/Tests/WidgetTokenServiceTests.swift`
- Modify: P3's `native-ios/App/CubbyWidgetPlugin.swift` (`mintToken`, `revokeToken`, `hasToken`; `clear()` runs `WidgetWipe.run`; `load()` runs the reinstall purge); P3's `WidgetVersions` in native-ios/Shared/ (`inPlace` true); `tools/ios_widget_check.sh` (TESTS gains the two files; a guard that the plugin's `clear()` calls `WidgetWipe.run`); `tools/test_wiring_check.js` ALLOW (two entries, `ranBy: 'tools/ios_widget_check.sh'`)

**Interfaces:**
- Consumes: P3's plugin, targets, entitlements (keychain group on both targets), `WidgetStore` and `clearAll()` (P3 Task 5), `WidgetVersions` (P3 Task 3), the CubbyWidgetTests scheme run by `tools/ios_widget_check.sh`.
- Produces:
```swift
protocol KeychainBackend { func add(_ q: [String: Any]) -> OSStatus; func copy(_ q: [String: Any]) -> (OSStatus, Data?); func delete(_ q: [String: Any]) -> OSStatus }
struct SecItemBackend: KeychainBackend                    // SecItemAdd, SecItemCopyMatching, SecItemDelete; nothing else
final class WidgetKeychain { init(accessGroup: String?, backend: KeychainBackend = SecItemBackend())
  static let shared: WidgetKeychain                       // accessGroup "F5NVQV7NVB.com.littlecubby.app.shared"
  func token() -> String?; func setToken(_ t: String) -> Bool; func takeToken() -> String?   // take: read, then delete
  func deviceId() -> String                               // created once, UUID().uuidString
  func purgeAll(); static func purgeIfReinstalled(defaults: UserDefaults, keychain: WidgetKeychain) }
final class WidgetTokenService { init(keychain: WidgetKeychain, session: URLSession)
  func mint(idToken: String, hid: String, push: String? = nil) async -> (ok: Bool, status: Int)   // push sent only when non-nil; P5 passes it
  func revoke() async -> Bool; func hasToken() -> Bool }
enum WidgetWipe { static func run(store: WidgetStore?, tokens: WidgetTokenService) async }   // revoke (local clear first), then store.clearAll()
enum WidgetAPI { static let base = "https://little-cubby.com" }
```

- [ ] **Step 1: Write the failing XCTests.** Network goes through a `URLProtocol` stub. Keychain tests use `RecordingBackend`, an in-memory `KeychainBackend` that keeps every query dictionary it is handed (Contract note 13).
  - `testTokenRoundTrip`: `setToken(T)`; `token() == T`; `takeToken() == T`; then `token() == nil`.
  - `testItemsAreAfterFirstUnlockThisDeviceOnly`: every `add` query for both items has `kSecAttrAccessible` equal to `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, `kSecClass` `kSecClassGenericPassword`, service `com.littlecubby.app.widget`, accounts `token` and `deviceId`; a keychain made with the shared group carries `kSecAttrAccessGroup` `F5NVQV7NVB.com.littlecubby.app.shared`, and `accessGroup: nil` carries none.
  - `testDeviceIdIsStable`: two calls equal and match `^[A-Za-z0-9_-]{16,64}$`.
  - `testReinstallPurge`: no `cubbyKeychainSeen` plus a stored token and deviceId: both gone and the marker set; a second call with a new token keeps it.
  - `testMint200StoresToken`: with `push` nil the body has exactly `idToken, hid, deviceId, platform: "ios"`; the token is stored; the result is `(true, 200)` and carries no token.
  - `testMint401And403DropToken` and `testMint503KeepsToken`.
  - `testRevokeClearsLocallyFirst`: with the network failing, `token() == nil` and the result is true; the request was POST `/api/widget/revoke` with `Authorization: Bearer <T>` and no body token.
  - `testWipeRevokesAndClearsEveryKey`: a stored token and every `WidgetStore.Key` case written: `WidgetWipe.run` sends one revoke carrying `Bearer <T>`, then no token and no key remain; deviceId stays.
  - `testWipeWithNoTokenSendsNothing`: the companion to the test above, which staged the token this one lacks.
  - `testVersionsReportsInPlace`: `WidgetVersions.answer().inPlace == true`.
- [ ] **Step 2: Run and fail.** `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh` → build fails, `cannot find 'WidgetKeychain' in scope`, `IOS-WIDGET: FAIL`.
- [ ] **Step 3: Implement** with the Security framework against the Global Constraints' identifiers; 10-second request timeout. The plugin resolves only `{ ok, status }`, `{ ok }` and `{ value }`, never the token; `mintToken` reloads all timelines after storing or dropping a token; `clear()` awaits `WidgetWipe.run(store: WidgetStore.shared(), tokens:)` and then keeps P3's order (shortcut items emptied, timelines reloaded); `load()` runs `purgeIfReinstalled` before anything reads the Keychain. No user-facing literal in hand-written Swift. Append both files to TESTS, add their ALLOW entries, and add the `clear()` guard to ios_widget_check.sh.
- [ ] **Step 4: Run and pass, then see two mutations go red.** `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh` → `IOS-WIDGET: PASS` with every test above; `node tools/gates.js --only=test-wiring` → PASS. Then, one at a time and reverted by hand: change `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` to `kSecAttrAccessibleAfterFirstUnlock` in WidgetKeychain.swift → `testItemsAreAfterFirstUnlockThisDeviceOnly` FAIL (the token would ride an encrypted backup to a new phone); delete the `WidgetWipe.run` call from `clear()` → `IOS-WIDGET: FAIL` naming the guard.
- [ ] **Step 5: Commit.**
```bash
git add native-ios/Shared/WidgetKeychain.swift native-ios/Shared/WidgetTokenService.swift native-ios/Tests/WidgetKeychainTests.swift native-ios/Tests/WidgetTokenServiceTests.swift
git commit -o native-ios/Shared native-ios/Tests native-ios/App tools/ios_widget_check.sh tools/test_wiring_check.js -m "iPhone: the widget's sign-in lives in this device's Keychain only, and any wipe revokes it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: iOS: the tap and its reply

**Files:**
- Create: `native-ios/Shared/NapState.swift` (`NapState` Codable per 2.5, `SnapshotDecode.nap(_:)`, and `WidgetStore.nap()` / `writeNap(_:)` over `Key.napState`), `native-ios/Shared/NapClient.swift` (NapRequest, NapReply, NapOutcome, NapClient), `native-ios/Shared/NapReducer.swift`, `native-ios/Shared/NapRunner.swift`, `native-ios/CubbyWidget/NapIntent.swift` (the `extension NapIntent` only; it compiles into CubbyWidget and CubbyWidgetTests, as P3's views do); tests `native-ios/Tests/NapClientTests.swift`, `NapReducerTests.swift`, `NapRunnerTests.swift`
- Modify: `docs/widgets/widget-copy.json` (`napCases`; keys `intent.action`, `intent.babies`, `intent.starts`, `intent.undo` with `on: ["config"]`, `platforms: ["ios"]`, and one `differences` entry per key, each `why` "AppIntent parameter titles; Android's NapActionCallback carries no metadata"); `tools/widget_gen.js` (checks `napCases` and copies them into widget-fixtures.json; emits NapIntent's metadata); `tools/widget_parity_check.js` (two plants); `test/widget-gen-ios.test.js` (P3: `@Parameter` counted per intent, one plant); regenerated `docs/widgets/widget-fixtures.json` and `native-ios/CubbyWidget/Generated.swift`; `tools/ios_widget_check.sh` (TESTS); `tools/test_wiring_check.js` ALLOW (three entries)

**Interfaces:**
- Consumes: Task 8's keychain and token service; P3's `WidgetStore` (`Key.napState`, `clearAll()`) and `Fixtures.load()`; generated `WRules` (`undoMs`, `lineMs`, `pendingMs`) and `WActions`.
- Produces:
```swift
struct NapState: Codable, Equatable { var babies: [String: NapBaby]; var line: NapLine?; var undo: NapUndo?; var pending: NapPending?; static let empty }  // JSON keys exactly 2.5
struct NapRequest: Equatable { let action: String; let babyIds: [String]; let starts: [String: Int]?; let undo: String? }
enum NapOutcome: Equatable { case replied(status: Int, reply: NapReply?), offline, unknown }
enum NapClient { static func send(_ r: NapRequest, token: String, timeout: TimeInterval = 8, session: URLSession = .shared) async -> NapOutcome }
enum NapReducer { static func apply(_ s: NapState, request: NapRequest, outcome: NapOutcome, now: Int) -> (state: NapState, clearToken: Bool) }
final class NapRunner { init(store: WidgetStore, keychain: WidgetKeychain, send: @escaping (NapRequest, String) async -> NapOutcome = { await NapClient.send($0, token: $1) })
  func run(_ r: NapRequest, now: Int) async -> NapState }
extension NapIntent { init(action: String, babyIds: [String], starts: [Int], undo: String); func perform() async throws -> some IntentResult }
```
  Generated (Generated.swift, inside `#if CUBBY_WIDGET_EXT`, once per `inPlace: true` action; Contract note 10):
```swift
struct NapIntent: AppIntent {
  static let title: LocalizedStringResource = "Sleep"                 // the WActions sleep label
  static let isDiscoverable = false
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Action") var action: String                      // intent.action
  @Parameter(title: "Babies") var babyIds: [String]                   // intent.babies
  @Parameter(title: "Start times") var starts: [Int]                  // intent.starts
  @Parameter(title: "Undo") var undo: String                          // intent.undo
  init() {} }
```
  `napCases` (widget-copy.json; copied verbatim to widget-fixtures.json's top-level `napCases`): `[{ name, prev: NapState, request: { action, babyIds, starts?, undo? }, outcome: { status, reply: object|null } | { offline: true } | { unknown: true }, now, expect: { state: NapState, clearToken: boolean } }]`, read by NapReducerTests here and Kotlin NapReducerTest (P6 Task 7).

The reply table, the source of `napCases` (L = `now + WRules.lineMs`, U = `now + WRules.undoMs`; every row clears `pending` except where it says kept; `clearToken` false except where it says removed):

| Outcome | babies | line | undo | `napCases` |
|---|---|---|---|---|
| 200 ok, start or stop | from `reply.state`, `at` = `reply.at` | none | `{ of: action, babyIds, starts: start's from reply.state / stop's from the request, until: U }` | `ok-start`, `ok-start-both`, `ok-stop` |
| 200 ok, undo or state | from reply | none | none | `ok-undo`, `ok-state` |
| 200 already, start / stop | from reply | `alreadyStarted` / `alreadyStopped` until L | none | `already-start`, `already-stop` |
| 200 needsApp | from reply | `notSaved` until L | none | `needs-app` |
| 409 moved | from reply | `alreadyStopped` when every requested baby is now null (stop, undo of a start); `alreadyStarted` when every one now runs (start); else none (Review Focus 2) | none | `moved-stop-gone`, `moved-start-running`, `moved-mixed` |
| 403 | unchanged | `pickBaby` until L | none | `baby` |
| 401 | unchanged | `notSaved` until L; token removed | none | `token` |
| 400, 429, 5xx, `.replied(200, nil)` | unchanged | `notSaved` until L (Review Focus 5) | none | `bad-request`, `rate-limited`, `unavailable`, `html-200` |
| `.offline` | unchanged | `noConnection` until L | none | `offline` |
| `.unknown` | unchanged | none; `pending` kept (Review Focus 3) | none | `unknown` |
| `state` re-ask: 401 / `.offline` / `.unknown` / other failure | unchanged | none | none; pending dropped and token removed / kept / kept / kept | `state-token`, `state-offline`, `state-unknown`, `state-unavailable` |

- [ ] **Step 1: Write the failing tests.**
  - widget_gen.js refuses to write (exit 1, naming the case) when a `napCases` name repeats, an `outcome` has none of the three shapes, a `line.key` is not one of 2.5's five, an `until` is neither `now + lineMs` nor `now + undoMs`, or one of the 23 names above is missing. widget_parity_check.js gains plants (i) a `napCases` line key `saved` and (j) the `unknown` case removed; each must go red.
  - test/widget-gen-ios.test.js (P3) counts `@Parameter` per intent, `{ MediumConfig: 2, SmallConfig: 3, LockConfig: 1, NapIntent: 4 }`, each title equal to its key's text; NapIntent's `static let title` equals QUICK_ACTIONS' sleep label (index.html:4598) and NapIntent is declared exactly once. Its `--self-test` gains a plant that moves one `@Parameter` from NapIntent into MediumConfig: the total stays 10, so only the per-intent count catches it.
  - NapClientTests: POST `https://little-cubby.com/api/widget/nap`, `Authorization: Bearer <t>`, JSON body with `action, babyIds` (and `starts`, `undo` when set), never `t` or `hid`; timeout at most 8 s. A 200 JSON reply decodes; a 200 `text/html` body is `.replied(200, nil)` (Review Focus 5); `URLError.notConnectedToInternet`, `.cannotFindHost`, `.cannotConnectToHost`, `.dnsLookupFailed`, `.dataNotAllowed` are `.offline`; `.timedOut`, `.networkConnectionLost`, `.cancelled` are `.unknown`.
  - NapReducerTests: `testEveryNapCase` reads `napCases` from the bundled widget-fixtures.json and, case by case, asserts `NapReducer.apply(prev, request, outcome, now)` equals `expect.state` and `expect.clearToken`, the case name in each message; `testTheNapCasesCoverEveryRow` asserts the 23 names are present (a gap fails by name).
  - NapRunnerTests: `testASecondTapInFlightSendsNothing`: a `pending` for robin younger than `WRules.pendingMs` sends nothing and leaves napState as it was (Review Focus 1); no token: `notSaved`, no request; an undo whose `until` has passed sends nothing; a normal tap writes `pending { babyIds, sentAt }` before the request (the stub reads the store mid-request) and clears it after; a 401 removes the Keychain token; `testNapStateLivesInWidgetStore`: after a tap, `store.read(.napState)` decodes to the returned state, and after `clearAll()` `store.nap() == .empty`; `testAStartSendsNoStarts`: `NapIntent(action: "start", babyIds: ["robin"], starts: [], undo: "")` builds a request with `starts` and `undo` nil; `NapIntent.isDiscoverable == false` and `authenticationPolicy == .requiresAuthentication`.
- [ ] **Step 2: Run and fail.** `node tools/gates.js --only=widget-gen-ios,widget-parity` → FAIL `NapIntent: 0 @Parameter, expected 4`, and plants (i) and (j) not caught; `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh` → build fails, `cannot find 'NapReducer' in scope`.
- [ ] **Step 3: Implement.** Write the 23 `napCases` from the table, then `node tools/widget_gen.js`. widget_gen.js emits the NapIntent struct above from the `inPlace` actions; P1's parity gate already treats generated intents as generated, and the hand-written file declares none, so "only inPlace entries write from glass" (D6) still holds. `NapRunner.run`, in order: an undo whose `until` has passed sends nothing; a `pending` sharing a baby and younger than `WRules.pendingMs` returns the state unchanged; no token sets `notSaved` until L and sends nothing; write `pending { babyIds, sentAt: now }`; send; `NapReducer.apply`; `clearToken` calls `keychain.takeToken()`; write; return. Every read and write goes through `WidgetStore`. `NapIntent.perform()` builds a `NapRequest` (`starts` zipped from `babyIds` when the counts match and are non-zero, else nil; `undo` nil when ""), awaits `NapRunner(store:keychain: .shared).run` on `WidgetStore.shared()`, then `WidgetCenter.shared.reloadAllTimelines()`; when `WidgetStore.shared()` is nil (the container unreadable) it sends nothing and returns. Append the three tests to TESTS and ALLOW.
- [ ] **Step 4: Run and pass, then see two mutations go red.** `node tools/gates.js --only=widget-gen-ios,widget-parity,test-wiring` → PASS; `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh` → `IOS-WIDGET: PASS`. Then, one at a time and reverted by hand: map `.unknown` to `notSaved` in NapReducer.swift → `testEveryNapCase` FAIL naming `unknown`; drop the `pendingMs` check in NapRunner → `testASecondTapInFlightSendsNothing` FAIL.
- [ ] **Step 5: Commit.**
```bash
git add native-ios/Shared/NapState.swift native-ios/Shared/NapClient.swift native-ios/Shared/NapReducer.swift native-ios/Shared/NapRunner.swift native-ios/CubbyWidget/NapIntent.swift native-ios/Tests/NapClientTests.swift native-ios/Tests/NapReducerTests.swift native-ios/Tests/NapRunnerTests.swift
git commit -o native-ios/Shared native-ios/CubbyWidget native-ios/Tests docs/widgets/widget-copy.json docs/widgets/widget-fixtures.json tools/widget_gen.js tools/widget_parity_check.js test/widget-gen-ios.test.js tools/ios_widget_check.sh tools/test_wiring_check.js -m "iPhone: a Sleep tap is sent once, and its answer becomes exactly one honest line, from one table both phones read" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: iOS: Phase B on glass

**Files:**
- Modify: `docs/widgets/widget-copy.json` (`cases`), regenerated `docs/widgets/widget-fixtures.json` and `native-ios/CubbyWidget/Generated.swift`, `tools/widget_model.js` (Phase B branches only, if a case below disagrees)
- Modify, P3's Swift: `native-ios/Shared/Snapshot.swift` (`FixtureInput` gains `nap: NapState?`), `native-ios/Shared/WidgetModel.swift` (Phase B branches, `url`), `native-ios/Shared/Timeline.swift` (`boundaries` adds `line.until`, `undo.until`, `pending.sentAt + pendingMs`), `native-ios/CubbyWidget/Provider.swift` (`WidgetInputs.make`: phase "B" when `WidgetVersions.answer().inPlace`, token = `WidgetKeychain.shared.token() != nil`, nap = `store.nap()`; `PendingResolver` runs before the entries are built), `native-ios/CubbyWidget/Views/` (medium, small, twins and `Parts.swift`: NapIntent buttons, the small glyph, `.invalidatableContent()`, the solid fill's `.widgetAccentable()`, the body link), the medium kind's gallery description
- Modify, P3's tests: `native-ios/Tests/WidgetGoldenTests.swift` (filter widened to phase B and nap fixtures), `native-ios/Tests/BoundaryTests.swift` (its every-change test also walks the ios/B fixtures), `native-ios/Tests/RenderTests.swift` (Phase B renders and goldens)
- Create: `native-ios/Shared/PendingResolver.swift`, `native-ios/Tests/PendingResolveTests.swift`, `native-ios/Tests/Goldens/b-*.png`
- Modify: `tools/ios_widget_check.sh` (TESTS gains PendingResolveTests; a guard that the solid Sleep fill carries `.widgetAccentable()`), `tools/test_wiring_check.js` ALLOW (one entry), `OPERATIONS.md:151-160` (the TTL founder step and the token ops note), `docs/TESTING.md:222-235` (the CubbyWidgetTests Phase B rows)

**Interfaces:**
- Consumes: P1 `renderModel` with the ViewModel's top-level `url` and row `a11y` (2.3), widget_gen.js, `WRules.pendingMs`; P3's golden test (every field exactly but `agoAt`), `Fixtures.load()` with `tz` (UTC), `WidgetBody(model:family:accented:)`, `WidgetInputs.make`, and the `RenderTests` harness (ImageRenderer, `CUBBY_RECORD_GOLDENS`, at most 0.5% of pixels off by more than 8/255); Tasks 8-9.
- Produces: Phase B fixtures; `PendingResolver.resolve(store: WidgetStore, runner: NapRunner, now: Int) async -> NapState`; `WidgetBody.bodyLink(_ m: ViewModel) -> URL?` (`CubbyLink.deliverable(m.url)`, the body's `.widgetURL`); `SleepGlyph.name(for b: ButtonModel) -> String?` ("play.fill" for a start intent, "stop.fill" for a stop intent, nil otherwise; small family only).

- [ ] **Step 1: Write the failing cases.** Add these to `cases` (base: ios, phase B, medium, config `{ baby: 'robin', button: 'activity' }`, `now` N = 1794970800000 (18 Nov 2026 03:00 UTC, formatted in the fixtures' `tz` UTC), token true, Robin alone, no nap; S = N - 3600000). Each `expect` is partial: the Sleep button (`buttons[k='sleep']`), `line`, `url` and `header.ask` where named. `→ app` means `{ style: 'soft', arrow: true, intent: null, url: 'https://little-cubby.com/app/?go=<go>&baby=<id>&from=widget' }`; `body(x)` means url `https://little-cubby.com/app/?baby=x&from=widget`, and `body→sleep(x)` means url `https://little-cubby.com/app/?go=sleep&baby=x&from=widget`. A start intent carries no `starts` (2.3).

| name | input change | expect |
|---|---|---|
| p4-b-idle | none | `Start sleep`, solid, no arrow, url null, intent `{start, [robin]}`, a11y "Start sleep for Robin", dim false; body(robin) |
| p4-b-running | nap `{start: S}` | `Stop sleep`, solid, intent `{stop, [robin], starts {robin: S}}`, a11y "Stop sleep for Robin" |
| p4-b-no-token | token false | `Sleep` → app go=sleep, a11y "Sleep for Robin, opens Cubby" |
| p4-b-long-nap | nap `{start: N - 46800000}` | `Stop sleep` → app go=sleepfix, a11y "Stop sleep for Robin, opens Cubby"; ask "Did it end earlier?" |
| p4-b-long-snoozed | as above, ack N - 7200000 | `Stop sleep` solid with intent; ask null |
| p4-b-over-24h | nap `{start: N - 90000000, ack: N - 60000}` | → app go=sleepfix; ask "Did it end earlier?" |
| p4-b-undo | napState undo `{of: start, [robin], starts {robin: S}, until: N + 5000}`, robin nap S at N - 5000 | `Undo`, solid, intent `{undo, [robin], starts {robin: S}, undo: start}`, a11y "Undo sleep for Robin" |
| p4-b-undo-expired | undo until N - 1 | `Stop sleep` solid |
| p4-b-pending | pending `{[robin], sentAt: N - 2000}` | `Start sleep`, dim true; line null |
| p4-b-checking | pending sentAt N - 15000 | dim true; line "Checking" |
| p4-b-no-connection | line `{noConnection, until N + 60000}` | line "No connection, so that didn't save."; `Sleep` → app go=sleep; body→sleep(robin) |
| p4-b-not-saved | line notSaved | line "That didn't save. Open Cubby to log it."; `Sleep` → app go=sleep; body→sleep(robin) |
| p4-b-already | line alreadyStarted, robin nap S at N - 1000 | line "Already started in Cubby."; `Stop sleep` solid; body(robin) |
| p4-b-pick-baby | line pickBaby | line "Open Cubby to pick a baby."; `Sleep` → app go=sleep; body(robin) (only noConnection and notSaved move the body) |
| p4-b-line-expired | line notSaved until N - 1 | line null; `Start sleep`; body(robin) |
| p4-b-twins-none | twins, Robin and Wren, baby both | `Start both`, intent `{start, [robin, wren]}`, a11y "Start sleep for Robin and Wren" |
| p4-b-twins-one | Wren nap S | `Stop sleep`, intent `{stop, [wren], starts {wren: S}}`, a11y "Stop sleep for Wren" |
| p4-b-twins-both | both naps S | `Stop both`, intent `{stop, [robin, wren], starts both S}`, a11y "Stop sleep for Robin and Wren" |
| p4-b-twins-no-connection | twins, baby both, line noConnection | `Sleep` → app go=sleep&baby=both; body→sleep(both) |
| p4-b-siblings-both | Ivy and Oak not twins, baby both, active ivy | `Sleep` → app go=sleep&baby=ivy |
| p4-b-small | family small, `{ first: sleep, second: feed }` | first button `Sleep`, solid, intent `{start, [robin]}`, a11y "Start sleep for Robin" |
| p4-b-small-running | as p4-b-small, nap `{start: S}` | first button `Sleep`, solid, intent `{stop, [robin], starts {robin: S}}`, a11y "Stop sleep for Robin" |
| p4-b-napstate-newer | app nap null at N - 600000, napState robin nap S at N - 1000 | `Stop sleep` |
| p4-b-napstate-older | napState robin nap S at N - 900000, app nap null at N - 60000 | `Start sleep` |
| p4-a-stays-a | phase A, nap S | `Sleep` → app go=sleep (Phase A never acts in place) |

  Swift, in P3's suites:
```swift
// WidgetGoldenTests: the filter becomes f.input.platform == "ios" && f.rawPullIsNull (phase A and B, nap or not; pull stays P5's)
func testThePhaseBSetCoversEveryState() throws  // at least one ios/B fixture each: idle, running, no token, long nap, snoozed, undo, pending,
  // checking, each line key, expired line, twins none/one/both, twins with a failure line, siblings both, small start, small stop,
  // napState newer and older. A gap fails by name.
// RenderTests (Phase B, spec 6.1 and 6.12)
func testPhaseBRendersAtTheFloor()   // every ios/B fixture × {light, dark} × {accented false, true} × {.large, .xxLarge}:
  // ImageRenderer image non-nil at exactly medium 321x148, small 148x148
func testPhaseBGoldens()   // 27 PNGs b-<state>-<family>-<mode>: state start (p4-b-idle), undo (p4-b-undo), checking (p4-b-checking),
  // noconn (p4-b-no-connection); family medium, or small (the same fixture re-rendered through WidgetModel.render with family small and
  // { first: sleep, second: feed }); mode day, night, xxl: 24. Plus b-stop-small-day (p4-b-small-running, the stop glyph),
  // b-start-medium-accented and b-start-small-accented (the solid fill accented). P3's 0.5% / 8-of-255 rule and CUBBY_RECORD_GOLDENS.
func testSleepGlyphs() { /* p4-b-small → "play.fill"; p4-b-small-running → "stop.fill"; p4-b-no-token as small → nil (the arrow instead) */ }
func testBodyLinkFollowsTheFailureLine() { /* every ios fixture: bodyLink == deliverable(expect.url);
  p4-b-no-connection → ...?go=sleep&baby=robin&from=widget; p4-b-pick-baby → ...?baby=robin&from=widget */ }
```
  PendingResolveTests: a pending older than `WRules.pendingMs` sends exactly one `action: "state"` for `pending.babyIds` and applies the reply; `.unknown` keeps pending; a pending older than `WRules.lineMs` is dropped with no line and no request; a pending younger than `pendingMs` sends nothing; the timeline holds entries at `undo.until`, `line.until` and `pending.sentAt + pendingMs`.
- [ ] **Step 2: Run and fail.** `node tools/widget_parity_check.js --self-test` → FAIL `stale generated file docs/widgets/widget-fixtures.json`; after `node tools/widget_gen.js`, `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh` → the golden test fails on the `p4-b-*` fixtures (Phase A labels drawn), `cannot find 'PendingResolver' in scope`, and `testPhaseBGoldens` fails with no recorded `b-*.png`.
- [ ] **Step 3: Implement.** If `node tools/widget_gen.js` refuses a hand-written `expect`, the expect is the spec's: fix that Phase B branch in tools/widget_model.js. In Swift, the Phase B branches of P3's model produce exactly these ViewModels from `WCopy` and `WRules`. Views: `Button(intent: NapIntent(...))` for an `intent`, `Link` for a `url`; the solid Sleep button sits in the 1.3fr column and its fill carries `.widgetAccentable()`, and with `accented: true` it stays filled while soft buttons drop to their 1pt stroke, so solid and soft still differ; on the small widget the solid button reads "Sleep" beside `Image(systemName: SleepGlyph.name(for:))`; `.invalidatableContent()` on the Sleep button and the sleep status; the body's `.widgetURL` is `WidgetBody.bodyLink(model)`, never P3's `CubbyLink.body(baby:)`. The TimelineProvider runs `PendingResolver` before building entries and adds the three boundaries; the medium kind's gallery description is `gallery.mediumDescB`. Record the goldens with `CUBBY_RECORD_GOLDENS=1 CUBBY_RENDER_OUT=$TMPDIR/cubby-goldens-b`, Read every PNG (day, night, xxLarge, accented, both glyphs), and only then copy them into `native-ios/Tests/Goldens/`. OPERATIONS.md gains the TTL command and what a revoked or expired token looks like on a phone (Sleep with the arrow until the next open). Append PendingResolveTests to TESTS and ALLOW; add the accentable guard.
- [ ] **Step 4: Run and pass, then see five mutations go red.** `node tools/gates.js --only=widget-parity,test-wiring` → PASS; `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh` → `IOS-WIDGET: PASS` with every p4 fixture, every Phase B render and golden; `bash tools/ios_launch_smoke.sh` → the widget renders. Then, one at a time and reverted by hand: the Sleep column 0.9fr → `b-start-medium-day` FAIL; the two glyphs swapped → `testSleepGlyphs` and `b-start-small-day` FAIL; the solid button drawn soft when accented → `b-start-medium-accented` FAIL; `.widgetAccentable()` removed from the solid fill → `IOS-WIDGET: FAIL` naming the guard; the body back on `CubbyLink.body(baby:)` → `testBodyLinkFollowsTheFailureLine` FAIL on `p4-b-no-connection`. Add the Phase B rows to docs/TESTING.md's red-run table.
- [ ] **Step 5: Commit.**
```bash
git add native-ios/Shared/PendingResolver.swift native-ios/Tests/PendingResolveTests.swift native-ios/Tests/Goldens
git commit -o docs/widgets/widget-copy.json docs/widgets/widget-fixtures.json native-ios tools/widget_model.js tools/ios_widget_check.sh tools/test_wiring_check.js OPERATIONS.md docs/TESTING.md -m "iPhone widgets: Start sleep and Stop sleep in place, with Undo, Checking and an honest line when a tap did not save" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> FOUNDER STEP: register a device or add internal TestFlight testers (zero registered devices, tools/cap_ios_build.sh:7-10). Blocks Step 6.
>
> FOUNDER STEP: yes to the Phase B TestFlight upload (`bash tools/cap_ios_build.sh`, then `node tools/asc.js builds` until the build reads processed), as in P3 Task 9. App Review waits for P5 (F1, F2).

- [ ] **Step 6: On-device proof** (after both FOUNDER STEPs; the build goes through `tools/cap_ios_build.sh` only). On a real iPhone: Start, Stop and Undo each write what the app then shows; a tap with the phone locked asks for Face ID or the code and writes nothing until then; airplane mode then a tap reads "No connection, so that didn't save.", and both the Sleep button and the widget body open the sleep sheet; airplane mode switched on mid-request shows "Checking", then the right state after reconnecting; Mum's and Dad's phones tapping Stop together leave one nap; the token survives an app relaunch, and after a restart, before first unlock, Sleep reads with the arrow (the real Keychain, Contract note 13); in the tinted home screen the solid Sleep button still stands apart from the soft ones. Record each result in docs/TESTING.md's device-proof table and the PR body.
