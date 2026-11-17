# Partner Freshness (F2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A partner's 3am log reaches this phone's widget. The widget pulls the family's latest times from the Worker with its token, and after every log the Worker sends the other members' phones a content-free silent push so their widgets pull now.

**Architecture:** workers/widget/snapshot.mjs builds a PullSnapshot from one bounded set of Firestore reads, with the since-rules module the app exports with. workers/widget/push.mjs sends section 2.9's FCM message to every other current member's token row; the app pokes after its own saved logs and the nap route after every write. On iOS a background push records `pokedAt` and reloads timelines; the widget's Provider pulls, then the model merges app, pull and nap state field by field by newest (2.5), so "Updated" stays honest. Month days (F10) ride in the pull as `moments`, from the same `monthMoments`; glass draws the app's own (the parent's midnight), and a newer pull can only hide them, while loss holding applies.

**Tech Stack:** Cloudflare Worker ES modules, Firestore REST (get, list, runQuery, documents:commit), FCM HTTP v1, the Firestore and Auth emulators; app JS (app/store-firebase.js); Swift (WidgetKit, URLSession, FirebaseMessaging) with XCTest; Node gate scripts.

**Spec:** /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/specs/2026-11-16-home-screen-widgets-design.md (and the roadmap /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/plans/2026-11-17-widgets-0-roadmap.md).

Lines are for 58733b16. Files marked (P1), (P2), (P3), (P4) are created by those plans and are not in this tree yet; read them (and their plans in docs/superpowers/plans/) before editing. Build after P4; P5 ships in the same iOS update as Phases A and B (F1).

## Contract notes

Every contract name is kept. Notes 1 to 7 were accepted into roadmap section 2 on 17 Nov (2.2, 2.3, 2.5 and the Swift type ownership line); they stay here as the reasons. Note 8 carries F10's fixed contract (17 Nov) into the pull; what it chooses here is marked.

1. **`buildPullSnapshot` needs `timers` and `since` (2.2).** Running naps live in `households/{hid}/timers/{babyId}` (P2, 2.4), which is in neither `hhFields` nor `events`. The builder also has to know which stretch of events it was given. Accepted: `buildPullSnapshot({ hhFields, events, timers, since, viewerUid, memberInfo, formerMemberInfo, now })`, with `timers = { [babyId]: { start, ack: ms|null } | null }`.
2. **PullSnapshot gains `since`, and a pull's `healthOpen` may be null (2.5).** The app holds every event. The Worker cannot read them all on each pull, because Spark allows 50,000 reads a day for every family together (OPERATIONS.md:152-155). So it reads the last 26 hours. Without `since`, a kind last logged before that window (a nappy three days ago) falls back to the app's older `at`, and every pulled widget turns to "Open Cubby to catch up." six hours after the app last ran. Without a null, an illness open over 14 days whose last entry is outside the window would switch Health off. Accepted: `PullSnapshot.since: ms` (the earliest event `time` the pull saw completely); `healthOpen: bool | null` in a pull only; Task 7's table as 2.5's merge rule. `since` bounds an event's `time`, never its anchor (a sleep's `end`, a feed's `time + dur`). A sleep or a timed feed that starts before `since` and ends after it is not in the pull, so the pull reads null for it, and the merge keeps the app's anchor with `asOf` app.at (Tasks 1, 2 and 7 stage it). In Swift, P3 declares none of the pull types: P5 creates `PullSnapshot` (with `since`), `PullBaby` (SnapshotBaby with `healthOpen: Bool?`), `SnapshotDecode.pull` and `FixtureInput.pull` in Snapshot.swift, and the merge in WidgetModel.swift (Task 8).
3. **One label rule (2.2).** `widgetByLabel` lives in app/widget-snapshot.js, a browser script on `window`, which the Worker cannot import. Accepted: the rule moves to workers/shared/since-rules.mjs as `byLabel(authorId, viewerUid, memberInfo, formerMemberInfo) -> string|null`, so the generated app/since-rules.js carries it on `window.CubbySince`. `widgetByLabel` keeps its name and signature and returns `CubbySince.byLabel(...)`.
4. **`deps.waitUntil` and the scopes (2.2).** The nap route's poke and the snapshot route's usage row must not hold a reply inside NapIntent's 10-second budget, so `deps` carries `waitUntil`, bound per request to `(p) => ctx.waitUntil(p)`; P4 builds it (P4 note 9). `pokeHousehold` sends FCM with the access token it is handed, so `tokenGate` (nap, snapshot) and the poke route mint theirs with `datastore` and `firebase.messaging` (the pair at worker.js:1803). Mint is not a `tokenGate` route and keeps P4's `cloud-platform` token, which its Identity Toolkit `accounts:lookup` needs (Task 5).
5. **The token preamble takes a mask.** The pull needs `memberInfo, formerMemberInfo, app.illnesses` beside nap's `members, deleteAfter, app.babies`, and a second household read would double its cost. P4 builds the preamble as `tokenGate(request, env, deps, { ipKey, mask })` in routes.mjs (P4 note 9); roadmap 2.2 adds `token` (the Google access token it minted) to its ok result: `{ ok: true, row, docId, hh, token } | { ok: false, response, row: Row|null }`. P5 calls it with its own mask and changes nothing else in it but the scope (Task 5).
6. **Two shared-container keys and two rules (2.3, 2.5, 2.6).** The widget must know that a poke arrived and when it last tried a pull. Accepted keys: `pokedAt` (written by the app's push handler) and `pullTriedAt` (written by the widget), each a JSON number. P3's `WidgetStore.clearAll()` and the plugin's `clear()` remove them with the other three. Accepted rules (chosen here): `pullMinMs: 600000` and `pullEveryMs: 3600000` in widget-copy.json, so Swift and Kotlin share one cadence.
7. **The FCM token is read in the App target.** P4's `WidgetTokenService.mint(idToken:hid:)` lives in native-ios/Shared/, which the extension also compiles, and the extension does not link FirebaseMessaging. Accepted: the plugin (App target) reads the token and calls `mint(idToken:hid:push:)`, where `push: String?` is sent only when non-nil.
8. **Month days in the pull (F10, 17 Nov).** The fixed contract gives every AppSnapshot and PullSnapshot baby `moments: [{ at, unit, n }]` (at most 2) from since-rules `monthMoments(birthTs, now, count = 2)` (P1). The list is [] when the baby has no birth, or while the household's loss holding applies to the viewer as the app decides it (`myLossHolding()`, index.html:9253-9255). Three things follow, chosen here:
   - **The pull can know the holding.** It lives in the household doc the pull already reads: `app.lossHolding`, a per-uid map `{ uid: { at } }`, or a legacy flat `{ at }` that belongs to the owner alone (store-firebase.js:1504). `SNAPSHOT_MASK` gains `app.lossHolding` (no extra read). snapshot.mjs's `pullLossHolding` ports myLossHolding line for line, so a pull's [] beside a birth means holding, never "unknown". The contract's fallback for a pull that cannot know (return [], keep the app's moments) therefore never arises. The map is read, never sent.
   - **Glass draws the app's month days.** The Worker runs in UTC (worker.js:1445 falls back to it); the app runs in the parent's zone, and `at` is the local midnight of the mark's day. A UTC `at` would light "3 months today" at 4 am in Dubai and at 7 pm the evening before in New York, and a birth near midnight can fall on another date in UTC. The pull never reads `users/{uid}.push.tz` (2e). So the merge keeps the app's list whichever source is newer, and the pull's own list speaks only when the pull is the newer source and it is [] (Task 7's `moments` row). count = 2 is what lets an app snapshot from the eve of one month day still carry the next.
   - **A newer pull's [] wins.** lossHolding is seeded for the carrier and everyone her journey was shared with, from her phone (index.html:13677-13683). The partner's app snapshot keeps the living child's month days until his app runs, and F10 says nothing while holding is active. So a newer pull's [] hides them. An app list that is [] (the app decided holding) is never brought back by a pull.

## Global Constraints

- Widget extension floor iOS 17.0; the host app stays at 15.0 (spec 3).
- Shared container suite `group.com.littlecubby.app`: `appSnapshot` app only, `napState` widget only, `pullSnapshot` widget only (2.5).
- Token read only from `Authorization: Bearer <t>`, regex `^w1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$`; a forged one answers 401 with zero reads (2.8).
- Token route order: per-IP limit, format and HMAC, per-token limit, token row, then the household by fsGetStrict. A failed read answers 503; a non-member's row is deleted and answers 401 (2.8).
- Limiters: `WIDGET_RATE_LIMITER` (namespace 1008, 30/60 s per IP, keys `wsnap:` and `wpoke:` + clientIpKey) and `WIDGET_TOKEN_RATE_LIMITER` (1009, 12/60 s, keys `wt:<docId>` and `wph:<hid>`). Both fail open through rateLimited (worker.js:50).
- Access tokens: `tokenGate` (nap, snapshot) and the poke route ask for `https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging`; mint keeps `https://www.googleapis.com/auth/cloud-platform` for Identity Toolkit `accounts:lookup` (roadmap 2.2).
- `PullSnapshot.since` bounds event `time`, never an anchor (`end`, `time + dur`); `healthOpen` may be null in a pull only (2.5).
- `GET /api/widget/snapshot`: header only; 200 `{ snapshot: PullSnapshot, at }`; 401, 429, 503 (2.8).
- `POST /api/widget/poke`: `{ idToken, hid }`; 200 `{ ok:true, sent: n }`; 401; 403 `{error:'not_member'}`; 429; 503 (2.8).
- The silent push is exactly 2.9's message: no `notification` block and no family data, ever. Reminder tokens (users/{uid}.push) are never used, and nothing here turns reminders on.
- Push targets: each token row with `push`, `hid` equal, `uid` a current member and not the logger (2.9).
- The app pokes after a pushed log, debounced 30 s; the nap route pokes after every write; the FCM token goes up at mint with no permission prompt (roadmap P5).
- Merge (2.5):
  - a baby's `nap` comes from the newest of appSnapshot.at, pullSnapshot.at and napState.babies[bid].at;
  - `last`, `by` and `healthOpen` come from the newer of app and pull, and a null never erases an older anchor;
  - `lockScreen`, `shortcuts`, `activeBabyId` and `state` come only from appSnapshot, and the pull is ignored unless appSnapshot.state is 'ok' and its `v` is in `SNAPSHOT_VERSIONS`;
  - a baby's `moments` are the app's, and [] when the newer source is the pull and its list is [] (F10, contract note 8);
  - "Updated" is the oldest `asOf` shown.

  Task 7 refines this field by field.
- Stale: over `staleMs` 21600000 the statuses hide and the widget reads "Open Cubby to catch up."; nothing claims to be live (6.9).
- `healthReturnMs` 1209600000; `byMax` 12; `by` never on the lock screen and never an email (6.6, F7).
- Every pull has `pregnancy: null` and `activeBabyId: null`. No Pro field, photo, illness detail, mood, notes or medicine leaves, ever (6.6).
- F10 (founder, 17 Nov, fixed): month days on the widget, nothing else.
  - A pull baby carries `moments` from since-rules `monthMoments(birth, now)` (P1): at most 2, `{ at, unit: 'month'|'year', n }`. It is [] with no birth, and [] while `pullLossHolding` (myLossHolding's port, index.html:9253-9255) says the household's loss holding applies to the viewer; times and Sleep stay (F3).
  - `SNAPSHOT_MASK` reads `app.lossHolding` for this alone; the map never leaves, and only an empty `moments` reflects it.
  - Glass draws the app's month days (the parent's local midnight; the Worker computes in UTC), and a newer pull's [] hides them (contract note 8).
  - M15, `header.moment`, the `monthcard` route and `m` key, `widget.opened` target 'moment', the moment copy and its honey-ink styling are P1's, P3's and P6's. Not built: the 6 October takeover card ("Robin is 3 months old today" and "Make a card"), marked firsts, comparisons, streaks.
- `widget.refresh`: anon, a `server: true` core event with a `source: server` plan entry (P4 contract note 4); `kind` pull or poke; `outcome` ok, token or unavailable; no uid, hid or baby id in a prop; stored only while modeOf(env) is 'on' (2.11).
- worker.js imports every module the widget routes reach directly, so snapshot.mjs and push.mjs too (P4 contract note 3; widget-nap-decide asserts it).
- One Worker request stays inside Workers Free's 50 subrequests (the feedback-purge-emu precedent).
- P5 adds no glass string. Any copy lives in docs/widgets/widget-copy.json only (DESIGN.md §A1, §A7).
- Firestore REST writes are proven on the emulator; preconditions go in a documents:commit body, never a query string.
- Commits: `git commit -o <paths>` (`git add` new files first), message ending in a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Any staged app/ asset bumps `CACHE` in app/sw.js by one from what `grep -o "little-log-v[0-9]*" app/sw.js` prints now.
- Push to main (deploy), any rules publish and App Review are the founder's. No step here pushes.

## Review Focus

1. **RF1.** A kind last logged before the pull window (a nappy three days ago; a family that logs only feeds) must not send a freshly pulled widget to "Open Cubby to catch up.". Tested in Task 7 (`pull.sparseConfirmed`, `pull.staleRescued`) and Task 8 (goldens).
2. **RF2.** A pull older than the app's snapshot never rolls glass back; a sleep that started before the pull window and ended inside it keeps the app's time and the app's age; and an entry the partner deleted leaves glass. Tested in Task 1 (F1's baby k), Task 2 (2n) and Task 7 (`pull.olderThanApp`, `pull.straddleKept`, the since-parity merge section, `pull.deletedEntry`).
3. **RF3.** A caregiver removed from the circle is never poked, her pull is refused, and her widget drops the pulled data and the token at once. Tested in Task 2 (2h), Task 4 (3b) and Task 8 (the 401 test).
4. **RF4.** A family with months of history and twins costs one bounded pull, so widgets cannot spend the project's daily read quota. Tested in Task 2 (2f, 2g).
5. **RF5.** A bad answer never blanks, corrupts or freezes the widget: a captive portal's 200 HTML page, truncated JSON, an unknown version, or a hang past 8 s. Tested in Task 8.
6. **RF6.** A parent in loss holding never sees a month day on glass, even when the holding was seeded from another member's phone and this phone's app has not run since; and a month day lights at the parent's own midnight, never at the Worker's UTC one. Tested in Task 1 (F5, the `LOSS` rows), Task 2 (2o), Task 7 (`pull.momentHolding`, `pull.momentLocalDay`, `pull.momentLocalDayAfter`, the F5 merge lines) and Task 8 (goldens).

---

### Task 1: One label rule and the pure pull builder

**Files:**
- Modify: workers/shared/since-rules.mjs (P1): add `byLabel`.
- Modify: app/widget-snapshot.js (P1): `widgetByLabel` returns `window.CubbySince.byLabel(...)`.
- Regenerate: app/since-rules.js (`node tools/widget_gen.js`).
- Create: workers/widget/snapshot.mjs
- Create: test/widget-since-parity.test.js
- Modify: tools/gates.js:253-279 (the `TREE.push(` list): register `widget-since-parity`.
- Modify: app/sw.js:3 (CACHE).

**Interfaces:**
- Consumes (P1, 2.2):
  - from workers/shared/since-rules.mjs: `sinceAnchor`, `babyAnchors` (the newest event by `time`, as Home picks at index.html:4087-4089, anchored by `sinceAnchor`; roadmap 2.2), `healthOpen`, `isTwins`, `ageOf`, `snapshotBaby({ baby, events, illnesses, nap, now, label })`, `monthMoments(birthTs: number, now: number, count = 2) -> Array<{ at: number, unit: 'month'|'year', n: number }>` (P1, F10) and `RULES`;
  - from workers/shared/widget-rules.mjs: `SNAPSHOT_VERSIONS` (roadmap 2.2);
  - `window.CubbySince`;
  - `window.CubbyWidgetSnapshot.buildWidgetSnapshot(ctx: SnapshotCtx)` and `widgetByLabel(...)`; AppSnapshot babies carry `moments` (P1, F10);
  - `myLossHolding()` (app/index.html:9253-9255), lifted by the test only;
  - P2's fold rule (2.4);
  - `fromFs` (workers/shared/fs-values.mjs:8).
- Produces:
  - since-rules.mjs: `byLabel(authorId, viewerUid, memberInfo, formerMemberInfo) -> string|null`.
  - snapshot.mjs constants: `PULL_VERSION = 1`, `PULL_WINDOW_MS = 93600000` (26 h, chosen here) and `PULL_EVENTS_MAX = 200` (chosen here).
  - snapshot.mjs functions:
    - `pullHealthOpen(illnesses, events, babyId, now, since) -> boolean|null`;
    - `foldTimer(timer, events, babyId) -> { start, ack } | null`;
    - `pullLossHolding(lossHolding, members, viewerUid) -> boolean` (chosen here, contract note 8): myLossHolding line for line, with the decoded `app.lossHolding` for `state.lossHolding`, the decoded `members` for `LL.members` and `viewerUid` for `myUid()`;
    - `buildPullSnapshot({ hhFields, events, timers, since, viewerUid, memberInfo, formerMemberInfo, now }) -> PullSnapshot`.
  - Argument and result shapes:
    - `hhFields` is the REST `fields` map;
    - `events` are plain `{ id, babyId, type, time, end, dur, deleted, authorId }`;
    - PullSnapshot is `{ v, state: 'ok', at, since, twins, activeBabyId: null, pregnancy: null, babies: [SnapshotBaby with healthOpen: bool|null and moments] }`;
    - a pull baby's `moments` is `monthMoments(birth, now)`, or [] with no birth or while `pullLossHolding` is true (F10);
    - `since` is the earliest event `time` the builder was given completely; it bounds `time`, never an anchor.

- [ ] **Step 1: Write the failing test** test/widget-since-parity.test.js.
  - **Clock.** `NOW = Date.UTC(2026, 10, 17, 3, 0)` (day and hour pinned) and `since = NOW - PULL_WINDOW_MS`. The file sets `process.env.TZ = 'UTC'` before its first Date: the Worker's zone, so both paths compute month days in one zone and compare exactly (roadmap 2.3).
  - **The app path** loads app/since-rules.js, then app/widget-snapshot.js, into one vm context whose `window` is the context. It calls `buildWidgetSnapshot` with `{ now: NOW, state, viewerUid, userLoaded: true, live: true, liveAt: NOW, memberInfo, formerMemberInfo, lossHolding: appHolding(state.lossHolding, members, viewerUid), lockHide: false, stage: 'baby', chosen: [], quickActions: [], binary: { snapshot: [1], shortcuts: [] } }`.
  - **appHolding** is the app's own answer: `myLossHolding`, lifted from app/index.html with `lift()` from test/quick-close.test.js:29-38 (copied, not exported), run in a vm context whose `state.lossHolding`, `window.LL.members` and `myUid()` are the family's and the viewer's, then `!!`. F1 to F4 have no lossHolding, so it is false there.
  - **The Worker path** calls `buildPullSnapshot` with the events whose `time >= since` and the stored timers; `hhFields` carries `members` and `app.lossHolding` as the household read would.

  The families:
  - **F1, night.** u1 is owner ('Priya Shah', relationship 'Mum') and u2 is caregiver ('Sam', 'Dad'); baby r was born NOW-60 d. Entries:
    - a feed by u2 at 02:10 with dur 15 min;
    - a deleted feed by u2 at 02:50;
    - an open sleep (no end) by u1 at 02:40;
    - a sleep 22:00 to 01:30 by u1;
    - a nappy by u1 at 01:40;
    - a feed 30 h back.

    F1 also holds baby k, a sibling born NOW-400 d (not twins), whose only entries straddle `since`: a sleep by u2 from since - 2 h to since + 1 h, and a feed by u2 at since - 10 min with dur 20 min. The app anchors both after `since` (`end`, `time + dur`); the pull, which reads events by `time`, holds neither. Viewers u1 and u2.
  - **F2, twins.** r and w, born 23:50 and 00:20 (isTwins true). Timers `{ w: { start: 02:40 }, r: { start: 00:30 } }`. A live sleep for r with `time` 00:30, so r folds to null. A deleted sleep for w at 02:40, so w does not fold.
  - **F3, illness.**
    - r: an open illness since NOW-3 d.
    - w: an open illness since NOW-20 d with a symptom 2 days back.
    - The same, but with a temperature 3 h back.
    - An ended illness.
    - An open illness since NOW-20 d with no entries.
  - **F4, labels.** The rows of `LABELS` below.
  - **F5, month days and loss holding (F10).** u1 owner and u2 caregiver, as F1. Baby d was born `Date.UTC(2025, 10, 17, 21, 40)`, so NOW is its first birthday, at an hour before the birth's own; d has a feed by u1 at 02:00. Baby e has no birth. Three households, viewers u1 and u2:
    - F5a: `app.lossHolding = { u2: { at: NOW - 86400000 } }`, seeded for u2 alone, as a carrier's phone seeds it (index.html:13677-13683);
    - F5b: the legacy flat `app.lossHolding = { at: NOW - 86400000 }`, the owner's alone;
    - F5c: no lossHolding.
  - **LOSS.** The rows below, with `MEMBERS = { u1: 'owner', u2: 'caregiver' }`, each through `pullLossHolding` and `appHolding`.

```js
const RULE_FN = /\bfunction\s+(sinceAnchor|babyAnchors|healthOpen|isTwins|ageOf|snapshotBaby|byLabel|monthMoments)\b/;
ok('snapshot.mjs takes its rules from ../shared/since-rules.mjs', /from '\.\.\/shared\/since-rules\.mjs'/.test(SNAP));
ok('snapshot.mjs defines no rule of its own', !RULE_FN.test(stripComments(SNAP)));
ok('companion: the matcher finds a planted copy', RULE_FN.test('function babyAnchors(evs) {}'));
// per family, per viewer, per baby (a = app export, p = pull); ev = CubbySince.babyAnchors(allEvents, id)[k], the app's pick.
// The window bounds the picked event's `time`, never its anchor.
ok(id + ' ' + k + ' picked inside the window', !ev || ev.time < since || (p.last[k] === a.last[k] && p.by[k] === a.by[k]));
ok(id + ' ' + k + ' picked before the window reads null', (ev && ev.time >= since) || (p.last[k] === null && p.by[k] === null));
ok('F1 k straddles since: the app anchors after it, the pull reads null', kSleep.time < since && ak.last.sleep >= since
  && ak.last.feed >= since && ak.by.sleep === (viewer === 'u1' ? 'Dad' : null)
  && pk.last.sleep === null && pk.by.sleep === null && pk.last.feed === null && pk.by.feed === null);
ok(id + ' nap, name, age', eq(p.nap, a.nap) && p.name === a.name && eq(p.age, a.age));
ok(id + ' healthOpen', p.healthOpen === a.healthOpen || (p.healthOpen === null && openOver14d(family, id)));
ok('pull shape', pull.v === 1 && SNAPSHOT_VERSIONS.includes(PULL_VERSION) && pull.state === 'ok' && pull.at === NOW && pull.since === since
  && pull.activeBabyId === null && pull.pregnancy === null && !('lockScreen' in pull) && !('shortcuts' in pull)
  && pull.twins === app.twins);
const LABELS = [['u2', 'u1', 'Dad'], ['u1', 'u1', null], [undefined, 'u1', null], ['local', 'u1', null],
  ['u3' /* formerMemberInfo: Nanny */, 'u1', 'Nanny'], ['u5' /* name 'dad@example.com', no relationship */, 'u1', null],
  ['__proto__', 'u1', null], ['u6' /* relationship 'Grandma Josephine' */, 'u1', undefined /* equal both ways only */]];
ok(label + ' agrees', byLabel(...row) === CubbySince.byLabel(...row) && widgetByLabel(...row) === byLabel(...row)
  && (want === undefined || byLabel(...row) === want));
// Month days (F10): every family, viewer and baby, one monthMoments and one holding rule on both paths
ok(id + ' moments', eq(p.moments, a.moments));
ok('F1 r: the next two month days, neither today', eq(pr.moments,
  [{ at: Date.UTC(2026, 10, 18), unit: 'month', n: 2 }, { at: Date.UTC(2026, 11, 18), unit: 'month', n: 3 }]));
ok('F1 k: months 14 and 15, past the first year', eq(pk.moments,
  [{ at: Date.UTC(2026, 11, 13), unit: 'month', n: 14 }, { at: Date.UTC(2027, 0, 13), unit: 'month', n: 15 }]));
ok('F5c d: 1 year today counts from midnight, before the birth hour; then month 13', eq(p5c.u1.d.moments,
  [{ at: Date.UTC(2026, 10, 17), unit: 'year', n: 1 }, { at: Date.UTC(2026, 11, 17), unit: 'month', n: 13 }]));
ok('F5 e has no birth: [] on both paths', eq(p5c.u1.e.moments, []) && eq(a5c.u1.e.moments, []));
ok("F5a holding seeded for u2: u2's d is [] on both paths, u1's is not, u2's times stay (F3)",
  eq(p5a.u2.d.moments, []) && eq(a5a.u2.d.moments, []) && eq(p5a.u1.d.moments, p5c.u1.d.moments)
  && p5a.u2.d.last.feed === Date.UTC(2026, 10, 17, 2, 0));
ok("F5b the legacy flat holding is the owner's alone", eq(p5b.u1.d.moments, []) && eq(p5b.u2.d.moments, p5c.u2.d.moments));
ok('the pull never carries the holding map', !/lossHolding/.test(JSON.stringify([p5a, p5b])));
const LOSS = [[null, 'u1'], [{ u2: { at: 1 } }, 'u2'], [{ u2: { at: 1 } }, 'u1'], [{ at: 1 }, 'u1' /* owner */],
  [{ at: 1 }, 'u2' /* caregiver */], [{ u1: null }, 'u1'], [{ u1: {} }, 'u1'], [{}, 'u1']];
for (const [lh, v] of LOSS) ok(JSON.stringify([lh, v]) + ' holding agrees with myLossHolding',
  pullLossHolding(lh, MEMBERS, v) === appHolding(lh, MEMBERS, v));
ok('LOSS companion: the rows hold both answers', LOSS.some(([lh, v]) => appHolding(lh, MEMBERS, v))
  && LOSS.some(([lh, v]) => !appHolding(lh, MEMBERS, v)));
```
  The straddle's other half, that the merge keeps k's app anchor with `asOf` app.at, is asserted in Task 7, once `mergeSources` exists; so is F5's, that glass draws the app's month days and a newer pull's [] hides them.

- [ ] **Step 2: Run it and see it fail.** Run `node test/widget-since-parity.test.js`. Expected: FAIL, because workers/widget/snapshot.mjs cannot be imported (so neither `buildPullSnapshot` nor `pullLossHolding` exists) and since-rules.mjs has no `byLabel`.

- [ ] **Step 3: Implement.**
  - **byLabel.** Move widgetByLabel's body into since-rules.mjs as `byLabel`, unchanged; `widgetByLabel` now returns `window.CubbySince.byLabel(authorId, viewerUid, memberInfo, formerMemberInfo)`.
  - **buildPullSnapshot.** Decode `app.babies`, `app.illnesses`, `app.lossHolding` and `members` with `fromFs`, and set `holding = pullLossHolding(lossHolding, members, viewerUid)` once. For each baby, call `snapshotBaby` with `nap: foldTimer(timers[b.id], events, b.id)` and `label: (a) => byLabel(a, viewerUid, memberInfo, formerMemberInfo)`, then overwrite `healthOpen` with `pullHealthOpen`, and `moments` with `holding ? [] : monthMoments(b.birth ?? null, now)`, whatever snapshotBaby carried (F10).
  - **pullLossHolding** is myLossHolding (index.html:9253-9255) line for line:
    - false when `lossHolding` is falsy;
    - when `lossHolding.at` is truthy (the legacy flat form), `members[viewerUid] === 'owner'`;
    - otherwise `!!lossHolding[viewerUid]`.
  - **pullHealthOpen** answers, in order:
    - true when `healthOpen(...)` is true;
    - false when the baby has no illness without `endedAt`;
    - false when `since <= now - RULES.healthReturnMs`;
    - null otherwise.
  - **foldTimer** answers:
    - null for no timer, or a start that is not finite;
    - null when `events` hold a sleep for that baby, not deleted, with `time === start`;
    - `{ start, ack: ack ?? null }` otherwise.
  - **Then** run `node tools/widget_gen.js` and bump app/sw.js.

- [ ] **Step 4: Add `--self-test` and wire the gate.** The self-test copies workers/shared/, workers/widget/, app/since-rules.js and app/widget-snapshot.js into a temp root. It runs every section there against five mutants, and each must fail:
  - (a) in since-rules.mjs only, the sleep anchor is read from `ev.time` instead of `ev.end`;
  - (b) snapshot.mjs passes `viewerUid: null` to the label, so the viewer's own entries get named;
  - (c) snapshot.mjs gains a local `function babyAnchors`;
  - (d) in since-rules.mjs only, monthMoments starts from tomorrow's midnight instead of today's, so a month day no longer counts on the day itself (F5's `moments` parity and the `F5c d` line go red);
  - (e) snapshot.mjs's `pullLossHolding` drops the legacy flat `{ at }` branch (the `LOSS` rows and `F5b` go red).

  Then it judges this tree. Register `{ name: 'widget-since-parity', cmd: ['node', 'test/widget-since-parity.test.js', '--self-test'] }`.

- [ ] **Step 5: Run and pass.**
  - `node tools/gates.js --only=widget-since-parity` → PASS, "5 of 5 mutants caught".
  - `--only=widget-logger,widget-parity,widget-snapshot` → PASS (moving the label rule changes nothing the app exports).
  - `--only=test-wiring` → PASS.

- [ ] **Step 6: Commit.**
```bash
git add workers/widget/snapshot.mjs test/widget-since-parity.test.js
git commit -o workers/shared/since-rules.mjs app/widget-snapshot.js app/since-rules.js app/sw.js \
  workers/widget/snapshot.mjs test/widget-since-parity.test.js tools/gates.js \
  -m "A partner's widget pull is computed by the same rules the app exports with" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: GET /api/widget/snapshot, in one bounded read

**Files:**
- Modify: workers/widget/snapshot.mjs (Task 1): `SNAPSHOT_MASK`, `readPullInputs`.
- Modify: workers/widget/routes.mjs (P4): the snapshot route on P4's `tokenGate` (contract note 5), `refresh` usage.
- Modify: worker.js:16-17 (imports: snapshot.mjs directly, P4 contract note 3). `waitUntil` in the deps and dispatch is P4's (P4 note 9).
- Modify: workers/usage/core.mjs:48-63 (`USAGE_EVENTS`); .telemetry/tracking-plan.yaml (beside P4's `widget.nap`, and the header's server count and total); regenerate app/usage-allowlist.js (`node tools/gen_usage_allowlist.js`); app/sw.js:3.
- Create: test/widget-snapshot-emulator.test.js
- Modify: tools/gates.js:303-341 (`EMU_GATES`): register `widget-snapshot-emu` after P4's `widget-nap-emu`.

**Interfaces:**
- Consumes:
  - from Task 1: `buildPullSnapshot` and the `PULL_*` constants;
  - from P4: `mintWidgetToken(sa)`, `widgetTokenDocId(t)`, `widgetRoute(request, env, url, deps)`, `__widget.deps` (with `waitUntil`) and `tokenGate(request, env, deps, { ipKey, mask }) -> { ok: true, row, docId, hh, token } | { ok: false, response, row }`;
  - P4's test/helpers/widget-emu.js: `startEmulators`, `emuVerify`, `rewriteFetch`, `signUp`, `seedHousehold`, `callRoute`;
  - from P4: `recordServerEvent(env, name, props, platform)`;
  - from P1: `monthMoments` (workers/shared/since-rules.mjs), for 2o's expected values.
- Produces:
  - `SNAPSHOT_MASK = ['members', 'deleteAfter', 'memberInfo', 'formerMemberInfo', 'app.babies', 'app.illnesses', 'app.lossHolding']` (`app.lossHolding` for F10's month days alone, contract note 8; read, never sent);
  - `readPullInputs(base, token, hid, now) -> Promise<{ ok: true, events, timers, since } | { ok: false }>`;
  - `GET /api/widget/snapshot` with `cache-control: no-store`, answering 401 `{error:'token'}`, 429 `{error:'rate'}` or 503 `{error:'unavailable'}` when it refuses;
  - `USAGE_EVENTS['widget.refresh'] = { anon: true, server: true, props: { kind: e('pull', 'poke'), outcome: e('ok', 'token', 'unavailable') } }`.

- [ ] **Step 1: Write the failing test.** test/widget-snapshot-emulator.test.js starts its emulators with P4's `startEmulators('demo-cubby-widget-pull', firestore.rules)`, so FS_PORT and the other ports come from gates.js.
  - **Routes.** It calls `widgetRoute` through `callRoute` with deps `{ ...__widget.deps, verifyFirebaseToken: emuVerify(project), waitUntil: (p) => pending.push(p) }`, and settles `pending` before each assertion.
  - **Forged tokens** go through worker.js's own `fetch`.
  - **The fetch spy** is `rewriteFetch`, recording every Firestore request, its body and the documents each answer carried. fcm.googleapis.com goes to a recorder (Task 4).
  - **Usage.** `env.USAGE_DB` is `makeD1` over schema/usage.sql, with `USAGE_MODE: 'on'` (test/usage-route.test.js:67-72).

  Seed:
  - **Household hhA.**
    - People: Mum (owner) and Dad (caregiver), both from `signUp`; formerMemberInfo holds u3 as 'Nanny'. Dad's memberInfo carries `email: 'sam@example.com'` and a `photoURL`.
    - Babies: twins r and w, births `BIRTH.r` and `BIRTH.w`. r has an open illness named 'PLANTED-ILLNESS' with notes 'PLANTED-NOTE'.
    - Entries: 30 days of 40 a day across both babies, among them medicine entries with `medName: 'PLANTED-MED'`.
    - Timer w: `{ sleep: { start, by: Dad } }`.
    - `app.lossHolding: { [Dad's uid]: { at: seedNow - 86400000 } }`: holding seeded for Dad from another phone (F10, RF6). Mum has none.
  - **Households hhB and hhC.** hhB has its own row and one baby whose only entry is a sleep from `seedNow - 93600000 - 2 h` to `seedNow - 93600000 + 1 h`: it starts before the pull's `since` and ends after it. hhC has `deleteAfter` set.
  - **Token rows.** `widgetTokens/{widgetTokenDocId(t)}`, written straight to the emulator from `mintWidgetToken(SA)`, each with `expireAt` 90 days on:

    | Row | Owner | Platform | Push |
    |---|---|---|---|
    | tM | Mum | ios | PM |
    | tD | Dad | ios | PD |
    | t3 | u3 | ios | P3 |
    | tB | hhB | | |
    | tC | hhC | | |

```js
// 2a-2e: GET as tM
ok('2a 200, no-store, pull shape', r.status === 200 && r.headers.get('cache-control') === 'no-store'
  && s.v === 1 && s.state === 'ok' && s.activeBabyId === null && s.pregnancy === null
  && !('lockScreen' in s) && !('shortcuts' in s) && s.since === body.at - 93600000 && s.at === body.at);
ok("2b Dad's feed reads 'Dad' for Mum and nothing for Dad", byFor(tM).feed === 'Dad' && byFor(tD).feed === null);
ok('2c w carries its running nap, r none', s.babies.find(b => b.id === 'w').nap.start === W_START && rBaby.nap === null);
ok('2d r healthOpen true', rBaby.healthOpen === true);
ok('2e nothing private leaves', !/PLANTED-|@|photoURL|lossHolding/.test(JSON.stringify(body))
  && eq(selectOf(eventsQuery), ['babyId', 'type', 'time', 'end', 'dur', 'deleted', 'authorId'])
  && eq(maskOf(householdGet), SNAPSHOT_MASK) && !requests.some(q => /\/users\//.test(q.url)));
// 2f-2g: the read budget (RF4)
ok('2f one pull reads 1 row + 1 household + timer docs + the window', docsRead <= 2 + timerDocs + eventsInWindow
  && returnedEvents.every(e => e.time >= s.since));
ok('2g a 260-entry burst returns 200 and since = oldest returned + 1', n === 200 && s.since === oldestReturned + 1);
// 2h-2m: refusals and the slide
ok('2h removed caregiver (RF3): 401 token, row deleted', r.status === 401 && body.error === 'token' && !(await rowExists(tD)));
ok('2i forged or malformed, through worker.js fetch: 401 and zero Firestore requests', r.status === 401 && firestoreRequests === 0);
ok('2j household read fails: 503, row kept', r.status === 503 && body.error === 'unavailable' && await rowExists(tM));
ok('2k deleteAfter set: 401, row deleted', r.status === 401 && !(await rowExists(tC)));
ok('2l the row slides at most once a day', lastUsedAfterTwoPulls === lastUsedAfterFirst && (await slideAfterADay()) === true);
ok('2m usage: pull ok per 200, token for 2h, nothing for 2i', usage('pull', 'ok') === n200
  && usage('pull', 'token') === 1 && rowsAfterForged === rowsBefore && allPlatforms('ios_app'));
// 2n: since bounds event time, never the anchor (GET as tB)
ok('2n a sleep that starts before since and ends after it reads null', sB.since > STRADDLE_START && STRADDLE_END > sB.since
  && sB.babies[0].last.sleep === null && sB.babies[0].by.sleep === null);
// 2o: month days (F10, RF6), from the 2a (tM) and 2b (tD) answers, before 2h removes Dad
ok("2o Mum's babies carry monthMoments(birth, at); Dad's holding gives him [] and keeps his times (F3)",
  sM.babies.every(b => b.moments.length === 2 && eq(b.moments, monthMoments(BIRTH[b.id], bodyM.at)))
  && sD.babies.every(b => eq(b.moments, [])) && sD.babies.some(b => b.last.feed !== null)
  && !/lossHolding/.test(JSON.stringify(bodyD)));
```

- [ ] **Step 2: Run it and see it fail.** Register the gate first: `{ name: 'widget-snapshot-emu', self: ['node', 'test/widget-snapshot-emulator.test.js'] }`. Run `node tools/gates.js --emulator --only=widget-snapshot-emu`. Expected: FAIL at 2a, a 404 `not_found` from widgetRoute.

- [ ] **Step 3: Implement.**
  - **readPullInputs** sends two requests. The first is `GET {base}/households/{hid}/timers?mask.fieldPaths=sleep&pageSize=20`. The second is this runQuery on `{base}/households/{hid}:runQuery`:
```json
{ "structuredQuery": { "from": [{ "collectionId": "events" }],
  "select": { "fields": [{"fieldPath":"babyId"},{"fieldPath":"type"},{"fieldPath":"time"},{"fieldPath":"end"},
                         {"fieldPath":"dur"},{"fieldPath":"deleted"},{"fieldPath":"authorId"}] },
  "where": { "fieldFilter": { "field": {"fieldPath":"time"}, "op": "GREATER_THAN_OR_EQUAL",
                              "value": {"integerValue": "<now - PULL_WINDOW_MS>"} } },
  "orderBy": [{ "field": {"fieldPath":"time"}, "direction": "DESCENDING" }], "limit": 200 } }
```
    `since` is `now - PULL_WINDOW_MS`, or the oldest returned `time + 1` when 200 came back. It bounds `time` only: an entry that starts before it is not read, whatever its `end` or `dur` (2n). An entry's `id` is the last segment of its document name. Any answer that is not OK makes the result `{ ok: false }`.
  - **tokenGate** is P4's, called as it is. If P4's build returns no `token`, add it to the ok result here (the access token it already minted), so the route never mints a second.
  - **The snapshot route:**
    1. Accept GET only; any other method answers 405 `{error:'method'}`.
    2. Run `tokenGate` with `ipKey: 'wsnap:'` and `SNAPSHOT_MASK`.
    3. Run `readPullInputs`; a failure answers 503.
    4. Call `buildPullSnapshot` with `viewerUid = row.uid`.
    5. Slide the row as P4 does when nothing else is written: a best-effort commit only when `lastUsedAt` is over a day old.
    6. Answer 200 `{ snapshot, at: snapshot.at }`.
  - **Usage.** Record through `deps.waitUntil(recordServerEvent(env, 'widget.refresh', { kind: 'pull', outcome }, row.platform === 'android' ? 'android_app' : 'ios_app'))`. Outcome ok goes with a 200. Token (401) and unavailable (503) are recorded only when `tokenGate` found a row, so a forged token never reaches D1.
  - **Registry and wiring.**
    - Add `widget.refresh` to `USAGE_EVENTS`, and to the plan as `source: server`, `before_sign_in: true`, with `fires_when` "A widget's pull or poke is answered by the Worker."
    - Regenerate the allowlist.
    - Import snapshot.mjs in worker.js.
    - Bump app/sw.js.

- [ ] **Step 4: Run and pass, then watch the roadmap's red.**
  - `node tools/gates.js --emulator --only=widget-snapshot-emu,widget-nap-emu` → PASS (the nap route shares `tokenGate`).
  - In a scratch edit, make readPullInputs query from `since - 3 h` while still answering `since` → FAIL at 2n (the straddling sleep reaches the pull). Restore.
  - In a scratch edit, drop `'app.lossHolding'` from `SNAPSHOT_MASK` → FAIL at 2o (Dad's pull carries month days through his holding). Restore.
  - Remove the membership check from `tokenGate` in a scratch edit and rerun widget-snapshot-emu → FAIL at 2h. Restore it and rerun → PASS.
  - `node tools/gates.js --only=tracking-plan,usage-ingest,widget-nap-decide,ratelimit,fuzz-worker,worker-routes,signin-flow,signin-budget,test-wiring` → PASS (the import closure loads in every temp-dir loader).

- [ ] **Step 5: Commit.**
```bash
git add test/widget-snapshot-emulator.test.js
git commit -o workers/widget/snapshot.mjs workers/widget/routes.mjs worker.js workers/usage/core.mjs \
  .telemetry/tracking-plan.yaml app/usage-allowlist.js app/sw.js test/widget-snapshot-emulator.test.js tools/gates.js \
  -m "Widgets can pull the family's latest times with their token, in one bounded read" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: The refresh push carries one word and no family data

**Files:**
- Create: workers/widget/push.mjs
- Create: test/widget-poke-payload.test.js (section 1 here; section 2 in Task 6)
- Modify: tools/gates.js:253-279: register `widget-poke-payload`.

**Interfaces:**
- Produces:
  - `widgetPokePayload(fcmToken: string) -> object`, exactly 2.9's message;
  - `PUSH_RE = /^[A-Za-z0-9_:-]{32,4096}$/`, an FCM registration token (chosen here).

- [ ] **Step 1: Write the failing test.**
```js
const P = 'f'.repeat(40) + ':APA91b' + 'x'.repeat(100);
ok('1a exactly section 2.9', eq(widgetPokePayload(P), { message: { token: P, data: { cubby: 'widget-refresh' },
  apns: { headers: { 'apns-push-type': 'background', 'apns-priority': '5', 'apns-collapse-id': 'cubby-widget' },
          payload: { aps: { 'content-available': 1 } } },
  android: { priority: 'NORMAL', collapse_key: 'cubby-widget', ttl: '600s' } } }));
ok('1b no notification block at any depth', !hasKeyDeep(widgetPokePayload(P), /^notification$|^alert$|^sound$|^badge$/));
ok('1c data is one string key', eq(Object.keys(msg.data), ['cubby']) && typeof msg.data.cubby === 'string');
ok('1d two tokens differ only in token', eq(stripToken(widgetPokePayload(P)), stripToken(widgetPokePayload(P + 'y'))));
ok('1e PUSH_RE takes a token, refuses junk', PUSH_RE.test(P) && !PUSH_RE.test('x') && !PUSH_RE.test(P + ' ') && !PUSH_RE.test('a'.repeat(4097)));
```

- [ ] **Step 2: Run it and see it fail.** Run `node test/widget-poke-payload.test.js`. Expected: FAIL, because workers/widget/push.mjs cannot be imported.

- [ ] **Step 3: Implement** `widgetPokePayload` and `PUSH_RE` in push.mjs, and register `{ name: 'widget-poke-payload', cmd: ['node', 'test/widget-poke-payload.test.js'] }`.

- [ ] **Step 4: Run and pass, then the roadmap's red.**
  - `node tools/gates.js --only=widget-poke-payload` → PASS.
  - In a scratch edit, add `notification: { title: 'Cubby' }` → FAIL at 1a and 1b.
  - In a scratch edit, add `data.baby = 'Robin'` → FAIL at 1a and 1c.
  - Restore → PASS.

- [ ] **Step 5: Commit.**
```bash
git add workers/widget/push.mjs test/widget-poke-payload.test.js
git commit -o workers/widget/push.mjs test/widget-poke-payload.test.js tools/gates.js \
  -m "The widget refresh push carries one word and no family data" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: A log pokes the other members' phones

**Files:**
- Modify: workers/widget/push.mjs (Task 3): `POKE_TARGETS_MAX`, `pokeHousehold`.
- Modify: workers/widget/routes.mjs (P4): `POST /api/widget/poke`.
- Modify: worker.js:16-17 (imports push.mjs directly).
- Modify: tools/fuzz_worker.js:128-136 (`ROUTES`): add `['GET', '/api/widget/snapshot'], ['POST', '/api/widget/poke']`.
- Test: test/widget-snapshot-emulator.test.js (section 3).

**Interfaces:**
- Consumes:
  - from Task 3: `widgetPokePayload` and `PUSH_RE`;
  - from P4's deps: `verifyFirebaseToken`, `fsGetStrict`, `isCarer`, `rateLimited`, `clientIpKey` and `getAccessToken`;
  - `recordServerEvent`.
- Produces:
  - `POKE_TARGETS_MAX = 10`, chosen here: 10 sends, 10 clears and 4 reads stay under 50 subrequests.
  - `pokeHousehold(env, base, token, hid, exceptUid) -> Promise<number>`: the number of sends made; never throws; `token` must carry `firebase.messaging`.
  - The poke answers of 2.8, plus:
    - 401 `{error:'unauthorized'}`;
    - 400 `{error:'bad_request'}`;
    - 429 `{error:'rate'}`;
    - 503 `{error:'unavailable'}`.

- [ ] **Step 1: Write the failing tests** (section 3 of the emulator file). ID tokens come from `signUp`, checked by `emuVerify` (P4 contract note 1).
```js
ok('3a Dad logs: one push, to Mum, exactly the payload', r.status === 200 && body.sent === 1
  && fcm.length === 1 && eq(fcm[0].body, widgetPokePayload(PM)));
ok('3b never the logger, another family, a row without push, an expired row, or u3 who left (RF3)',
  !fcm.some(m => [PD, PB, P3, PEXP].includes(m.body.message.token)));
ok('3c reminder tokens untouched', !requests.some(q => /\/users\//.test(q.url)) && eq(await getUser(MUM), userBefore));
ok('3d non-member 403, bad token 401, household 503', s403 === 403 && b403.error === 'not_member'
  && s401 === 401 && s503 === 503 && fcmAfter === fcmBefore);
ok('3e UNREGISTERED for PM clears tM.push; on a fresh seed a 503 for PM keeps it', afterUnregistered.push === undefined
  && after503.push === PM);
ok('3f a re-mint between query and clear survives', (await row(tM)).push === PM_NEW);   // spy writes PM_NEW before :commit
ok('3g twelve rows: ten sends, under 50 subrequests', body.sent === 10 && workerFetches <= 50);
ok('3h usage: poke ok per send, token for 3e, unavailable for FCM 503',
  usage('poke', 'ok') === sends && usage('poke', 'token') === 1 && usage('poke', 'unavailable') === 1);
```

- [ ] **Step 2: Run it and see it fail.** Run `node tools/gates.js --emulator --only=widget-snapshot-emu`. Expected: FAIL at 3a, because there is no poke route.

- [ ] **Step 3: Implement `pokeHousehold`, in this order:**
  1. Run a runQuery on `widgetTokens`: `where hid EQUAL <hid>`, select `uid, push, platform, expireAt`, limit 50.
  2. Keep the rows whose `push` matches `PUSH_RE`, whose `expireAt` is in the future, and whose `uid !== exceptUid`. If none are left, return 0 before any household read.
  3. Read the household with `fsGetStrict` and mask `members, deleteAfter`. Return 0 if the read fails or `deleteAfter` is set.
  4. Keep the rows whose `uid` is owner or caregiver (own property only, as `_isCarer` does, worker.js:1499-1504), and take the first `POKE_TARGETS_MAX`.
  5. Send to each one in turn: `POST https://fcm.googleapis.com/v1/projects/little-log-a9caa/messages:send` with `widgetPokePayload(row.push)`.
  6. Read each FCM answer:
     - 200 counts as sent, outcome ok.
     - 404 whose `errorCode` is `UNREGISTERED` is outcome token. Clear that row's push with one documents:commit: `{ update: { name, fields: {} }, updateMask: { fieldPaths: ['push'] }, currentDocument: { updateTime: <the row's updateTime from step 1> } }`. If the precondition is refused, ignore it.
     - Anything else, 400 included, is outcome unavailable. A payload bug therefore never erases a token.
  7. Record one usage row per target, kind poke, with that target's platform. Logs carry reason words only, never an id or a token.

  **The poke route:**
  1. Run the per-IP limit on `wpoke:`. Answer 429 if limited.
  2. Read the JSON body. `idToken` must be a string and `hid` must match `^[A-Za-z0-9_-]{1,128}$`, else answer 400.
  3. Run `deps.verifyFirebaseToken(idToken)`. A `jwk_fetch_` throw answers 503; any other throw answers 401.
  4. Run the per-hid limit on `wph:<hid>`. Answer 429 if limited.
  5. Get an access token with the `datastore` and `firebase.messaging` scopes.
  6. Read the household with mask `members, deleteAfter`. A 404 answers 403; any other failure answers 503. If `deleteAfter` is set, or `!isCarer(fields, uid)`, answer 403.
  7. Answer 200 `{ ok: true, sent: await pokeHousehold(env, base, token, hid, uid) }`.

  Finally, import push.mjs directly in worker.js.

- [ ] **Step 4: Run and pass.**
  - `node tools/gates.js --emulator --only=widget-snapshot-emu` → PASS.
  - In a scratch edit, remove the current-member filter in step 4 → FAIL at 3b. Restore.
  - `node tools/gates.js --only=fuzz-worker,widget-nap-decide,worker-routes` → PASS (no throw, no undeclared 5xx, and the import closure holds).

- [ ] **Step 5: Commit.**
```bash
git commit -o workers/widget/push.mjs workers/widget/routes.mjs worker.js tools/fuzz_worker.js test/widget-snapshot-emulator.test.js \
  -m "A log pokes the other members' widgets, never the logger's and never a member who left" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The token carries its phone's push address, and every in-place nap pokes

**Files:**
- Modify: workers/widget/routes.mjs (P4): mint stores `push`; the nap handler pokes; `tokenGate`'s access-token scope (contract note 4). Mint's own token is left as P4 built it.
- Test: test/widget-snapshot-emulator.test.js (section 4).

**Interfaces:**
- Consumes:
  - `pokeHousehold` and `PUSH_RE`;
  - P4's mint, which accepts `push` and ignores it (P4 Task 3);
  - P4's nap handler, which commits `decideNap`'s writes;
  - P4's `tokenGate`, whose ok result carries `token`.
- Produces:
  - `widgetTokens/{id}.push`, set only from a `push` that matches `PUSH_RE` and absent otherwise;
  - one `deps.waitUntil(pokeHousehold(env, base, token, row.hid, row.uid))` after every nap answer that committed writes, with `token` from `tokenGate`;
  - scopes: `tokenGate` (so nap and snapshot) asks for `DS_FCM = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging'`; mint keeps `CLOUD = 'https://www.googleapis.com/auth/cloud-platform'`.

- [ ] **Step 1: Write the failing tests** (section 4; mint as P4's suite does it, through `callRoute` with `signUp` tokens):
```js
ok('4a mint keeps a valid push, users/{uid} untouched', (await rowOf(mintedT)).push === PX && eq(await getUser(MUM), userBefore));
ok('4b mint drops a bad push and still answers 200', bad.every(x => x.status === 200 && !x.row.push));   // 'x', 'a'.repeat(5000), 42, {}
ok('4c a widget start by Dad pokes Mum only', fcm.length === 1 && fcm[0].body.message.token === PM);
ok('4d state, already:true, needsApp and a 409 poke nobody', fcmAfterState + fcmAfterAlready + fcmAfterNeedsApp + fcmAfter409 === 0);
// deps.getAccessToken is wrapped to record [route, scope] before it calls the real one
ok('4e nap, snapshot and poke ask for DS_FCM; mint keeps CLOUD', eq(scopesBy(), { nap: [DS_FCM], snapshot: [DS_FCM], poke: [DS_FCM], mint: [CLOUD] }));
```

- [ ] **Step 2: Run it and see it fail.** Run `node tools/gates.js --emulator --only=widget-snapshot-emu`. Expected: FAIL at 4a (the push is not stored), 4c (no poke) and 4e (P4's `tokenGate` asks for datastore only).

- [ ] **Step 3: Implement.**
  - **Mint.** Put `push` into the transaction's row write only when `typeof push === 'string' && PUSH_RE.test(push)`.
  - **Nap.** Poke only after a 200 whose writes were committed: not `state`, not `already:true`, not 409, not `needsApp`. When that happens, call `deps.waitUntil(pokeHousehold(...))`, or `.catch(() => {})` when `deps.waitUntil` is absent.
  - **Scope.** Only `tokenGate` changes: its access token asks for `DS_FCM` (the pair at worker.js:1803), so the nap route can hand it to `pokeHousehold`, and snapshot shares it. The poke route already asks for `DS_FCM` (Task 4). Mint is untouched: its Identity Toolkit `accounts:lookup` needs `cloud-platform`, and with `DS_FCM` every mint would answer 503.
  - A stop that revives a deleted event (roadmap 2.4, 2.8) commits writes, so it pokes.

- [ ] **Step 4: Run and pass.**
  - `node tools/gates.js --emulator --only=widget-snapshot-emu` → PASS.
  - In a scratch edit, remove the `PUSH_RE` check → FAIL at 4b. Restore.
  - In a scratch edit, give mint `DS_FCM` → FAIL at 4e. Restore.
  - `node tools/gates.js --emulator --only=widget-nap-emu,widget-timer-race-emu` → PASS (P4's and P2's suites stay green with the pokes in place).
  - `node tools/gates.js --only=fuzz-worker` → PASS.

- [ ] **Step 5: Commit.**
```bash
git commit -o workers/widget/routes.mjs test/widget-snapshot-emulator.test.js \
  -m "A widget token carries its phone's push address, and every in-place nap pokes the family" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The app pokes after its own saved log

**Files:**
- Modify: app/store-firebase.js:3302-3312 (beside `scheduledPush`): `POKE_GAP_MS`, `widgetPokeSoon`, `widgetPokeSend`.
- Modify: app/store-firebase.js:3313-3416 (`pushNow`): poke after `await Promise.all(writes)` (:3386) when the push was worth one.
- Modify: app/store-firebase.js (P2's `napTx`, the one place `db.runTransaction` appears): poke after a committed write.
- Modify: app/sw.js:3 (CACHE).
- Test: test/widget-poke-payload.test.js (section 2).

**Interfaces:**
- Consumes:
  - `POST /api/widget/poke` (Task 4);
  - `auth.currentUser.getIdToken()`;
  - `window.LL.householdId` (store-firebase.js:2966);
  - P2's `napTx(run) -> Promise<NapResult>`, where `NapResult` carries `already?: true` (P2 contract note 2).
- Produces:
  - `POKE_GAP_MS = 30000`.
  - `widgetPokeSoon() -> void`:
    - it does nothing without `hhRef`, a signed-in user and `LL.householdId`;
    - it sends at once when the last poke is 30 s old or more;
    - otherwise it arms one timer for last + 30 s, and further calls add nothing.

    "Debounced 30 s" is read here as first at once, then at most one more per 30 s (chosen here, for the 3am latency).
  - `widgetPokeSend() -> void`: `fetch('/api/widget/poke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken, hid }), keepalive: true })`. Every failure is swallowed: never retried, never a toast.

- [ ] **Step 1: Write the failing test** (section 2). Lift `pushNow` and its helpers with the brace matcher and NAMES list of test/quick-close.test.js:26-40 (copy them; they are not exported), plus `widgetPokeSoon`, `widgetPokeSend` and `napTx`. Stub the household, entries, auth and clock the way its `phone()` does (:52 onward), with a fake `setTimeout`, `Date.now` and `db.runTransaction`.
```js
ok('2a one saved feed pokes at once with exactly {idToken, hid}', pokes.length === 1
  && eq(Object.keys(JSON.parse(pokes[0].body)).sort(), ['hid', 'idToken']) && pokes[0].keepalive === true);
ok('2b nine more inside 30 s make one more poke, at +30 s', pokesAt(29999) === 1 && pokesAt(30000) === 2);
ok('2c settings alone: none; app.illnesses or app.babies: one', settingsOnly === 0 && illnesses === 1 && babies === 1);
ok('2d a refused write pokes nobody; a pending one waits until it lands', refused === 0 && beforeLand === 0 && afterLand === 1);
ok('2e no household, no user or no hid: no fetch ever', noHh === 0 && noUser === 0 && noHid === 0);
ok('2f a failed poke is swallowed: no retry, no toast', fetchesAfterReject === 1 && toasts === 0);
ok('2g napTx pokes on {ok:true}, never on already, moved, offline or denied', napOk === 1 && napOthers === 0);
```

- [ ] **Step 2: Run it and see it fail.** Run `node tools/gates.js --only=widget-poke-payload`. Expected: FAIL on "app/store-firebase.js has every function this judges", because `widgetPokeSoon` is missing.

- [ ] **Step 3: Implement.**
  - In `pushNow`, a local `pokeWorthy` turns true for any entry set or delete, and for a dirty blob key `babies` or `illnesses`. After `pushNow._retryDelay = 0; pushNow._fails = 0;`, add `if (pokeWorthy) widgetPokeSoon();`.
  - In `napTx`, after its result `r` resolves with `r.ok && !r.already`, call `widgetPokeSoon()`.
  - Bump app/sw.js.

- [ ] **Step 4: Run and pass.**
  - `node tools/gates.js --only=widget-poke-payload` → PASS.
  - In a scratch edit, remove the `pokeWorthy` guard → FAIL at 2c. Restore.
  - `--only=quick-close,blob-merge,nap-offline` → PASS.
  - `node tools/gates.js --emulator --only=quick-close-emu,widget-timer-race-emu` → PASS (store-firebase.js is an emulator trigger).

- [ ] **Step 5: Commit.**
```bash
git commit -o app/store-firebase.js app/sw.js test/widget-poke-payload.test.js \
  -m "The app pokes the family's widgets after its own saved log, at most once more in 30 seconds" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The reference model merges the pull by newest, field by field

**Files:**
- Modify: tools/widget_model.js (P1): replace its 2.5 merge with `mergeSources`; `renderModel` reads it.
- Modify: docs/widgets/widget-copy.json (P1): rules `pullMinMs`, `pullEveryMs` (unless P1 already wrote them from roadmap 2.3); `cases` named `pull.*`; P1's `merge-nap-newer` and `merge-pull-null` cases, whose pull inputs gain `since`.
- Modify: test/widget-since-parity.test.js (Task 1): a merge section for F1's straddling baby k and F5's month days.
- Regenerate: `node tools/widget_gen.js` (docs/widgets/widget-fixtures.json, workers/shared/widget-rules.mjs, app/since-rules.js, Generated.swift, Generated.kt, widget_strings.xml).
- Modify: app/sw.js:3 (app/since-rules.js changes).

**Interfaces:**
- Consumes: FixtureInput `{ app, nap, pull, now, token, phase, ... }` (2.3); `SNAPSHOT_VERSIONS` (workers/shared/widget-rules.mjs, roadmap 2.2; `WSnapshot.versions` natively); `RULES.staleMs`, `RULES.dayRuleMs`; fixture `tz` "UTC" (roadmap 2.3); P1's message keys `fallback.stale`, `fallback.signedOut`, `fallback.pickBaby`; P1's F10 pieces, which read each baby's `moments`: M15 (a moment is active when `m.at <= now < m.at + 86400000`; `header.moment: { text, a11y } | null`), the M12 extension (`?go=monthcard&baby=<id>&m=<total months>&from=widget` on a day with an active moment and no noConnection or notSaved line) and the copy keys `moment.months` ("{age} months today") and `a11y.moment.months` ("{name} is {age} months old today").
- Produces:
  - `mergeSources({ app, pull, nap, now }) -> Merged`, where `Merged = { state, twins, lockScreen, shortcuts, activeBabyId, babies: [{ id, name, age, moments, last, by, healthOpen, nap, asOf: { feed, sleep, nappy, nap } }] }`;
  - `RULES.pullMinMs = 600000` and `RULES.pullEveryMs = 3600000`.

  This table is the merge rule for Swift (Task 8) and for Kotlin (P6):

| Field | Rule (N = the newer of app and pull by `at`, O = the older) |
|---|---|
| everything but the rows below; the list and order of babies | App only. The pull is ignored unless `app.state === 'ok'` and `pull.v` is in `SNAPSHOT_VERSIONS`. |
| `name`, `age` | N's, when N has the baby. |
| `moments` (F10) | The app's list, whichever source is newer: the app computes the parent's local midnights, the Worker UTC ones (contract note 8). [] instead when the pull is N, has the baby, and its list is [] (the household's loss holding applies to this viewer, or the baby has no birth). M15 and the monthcard link read this list. |
| `last[k]`, `by[k]` (feed, sleep, nappy) | When `N.last[k]` is non-null: N's pair, `asOf` N.at. When it is null and `O.last[k]` is non-null: O's pair, with `asOf` pull.at if N is the pull and `O.last[k] < pull.since`, else O.at. When both are null: null, `asOf` N.at. |
| `healthOpen` | N's when non-null, else O's. |
| `nap` | From the newest of app.at, pull.at and `napState.babies[b].at`; `asOf` that `at`. |
| "Updated", stale | The oldest `asOf` among the fields the layout shows. |

- [ ] **Step 1: Write the failing cases and the merge section.** Add these to `cases`. Each has a hand-written partial `expect`, and the inputs are `platform: 'ios'`, `phase: 'B'`, `token: true`, with times in UTC. Every pull input carries `since` = pull.at - 93600000 unless its row gives one (a pull without `since` does not decode in Swift or Kotlin).

| Case | Input | Expect |
|---|---|---|
| `pull.partnerFeed` | app.at 01:00, feed 00:10; pull.at 03:00, feed 02:10 by 'Dad' | feed row `value` '2:10 AM', `by` 'Dad'; `header.fresh` 'Updated 3:00 AM' |
| `pull.olderThanApp` (RF2) | app.at 03:05, feed 03:01; pull.at 03:00, feed 02:10 | feed row '3:01 AM'; 'Updated 3:05 AM' |
| `pull.deletedEntry` (RF2) | app.at 01:00, feed 00:55 by 'Dad'; pull.at 01:30, feed 22:10 | feed row '10:10 PM' |
| `pull.sparseConfirmed` (RF1) | app.at 22:00, nappy three days back; pull.at 03:00 with feed and sleep, nappy null | the nappy row shows the app's anchor with its `day`; 'Updated 3:00 AM' |
| `pull.sparseUnconfirmed` | app.at 22:00, nappy 20:00; pull.at 03:00, nappy null | nappy '8:00 PM'; 'Updated 10:00 PM' |
| `pull.straddleKept` (RF2) | app.at 01:30, sleep 23:00 to 01:20 by 'Dad', feed 01:00; pull.at 03:00 with `since` 23:30 (the 200-entry cap), feed 02:10, nappy 02:30, sleep null | sleep row '1:20 AM', `by` 'Dad'; 'Updated 1:30 AM' |
| `pull.staleRescued` (RF1) | now 06:30; app.at 22:00 with feed 21:40, sleep 19:30, nappy 2026-11-14 09:00; pull.at 06:00, `since` 04:00 the day before, feed 05:10 by 'Dad', sleep 04:50, nappy null (the app's nappy is before `since`, so the pull confirms it); nap null and healthOpen false in both | `mode` 'full'; `header.fresh` 'Updated 6:00 AM' |
| `pull.staleNoPull` | as `pull.staleRescued`, with pull null | `mode` 'message', `message` 'fallback.stale' |
| `pull.quietIgnored` | app.state 'quiet'; a fresh pull | `mode` 'wordmark' |
| `pull.signedOutIgnored` | app.state 'signedOut'; a fresh pull | `mode` 'message', `message` 'fallback.signedOut', `buttons` [] |
| `pull.unknownVersion` | pull.v 2 | identical to pull null |
| `pull.healthNull` | the pick is Pump; app healthOpen true; a newer pull with healthOpen null | `buttons[3].k` 'health' |
| `pull.healthFalse` | as `pull.healthNull`, with the pull's healthOpen false | `buttons[3].k` 'pump' |
| `pull.napNewest` | napState.at 02:59, nap from 02:40; pull.at 03:00, nap null | the sleep cell reads "Last sleep" |
| `pull.babyOnlyInPull` | the configured baby is only in the pull | `message` 'fallback.pickBaby' |
| `pull.twinsLabels` | twins set to Both; Dad logged r's feed | r's row `by` 'Dad' |
| `pull.momentKept` (F10) | Robin (r) born 2026-08-18 02:00; app.at 18 Nov 01:00, feed 00:10, moments `[{ at: 18 Nov 00:00, unit: 'month', n: 3 }, { at: 18 Dec 00:00, unit: 'month', n: 4 }]`; pull.at 18 Nov 03:00, the same moments, feed 02:10 by 'Dad'; now 03:05 | `header.moment` `{ text: '3 months today', a11y: 'Robin is 3 months old today' }`; feed row '2:10 AM', `by` 'Dad'; `url` 'https://little-cubby.com/app/?go=monthcard&baby=r&m=3&from=widget' |
| `pull.momentHolding` (RF6) | as `pull.momentKept`, with the pull's moments [] beside its non-null `age` (holding seeded from another phone after the app ran) | `header.moment` null; feed row '2:10 AM', `by` 'Dad'; `url` 'https://little-cubby.com/app/?baby=r&from=widget' |
| `pull.momentAppHolding` (RF6) | as `pull.momentKept`, with the app's moments [] (the app decided holding) | `header.moment` null |
| `pull.momentPullOlder` | as `pull.momentHolding`, with app.at 03:04, so the pull is O | `header.moment.text` '3 months today' |
| `pull.momentLocalDay` (RF6) | a parent in Dubai (UTC+4), Robin as above; app.at 17 Nov 20:30, feed 20:10, moments `[{ at: 17 Nov 20:00, unit: 'month', n: 3 }, { at: 17 Dec 20:00, unit: 'month', n: 4 }]` (her midnights); pull.at 17 Nov 20:55, feed 20:40 by 'Dad', the Worker's UTC moments `[{ at: 18 Nov 00:00, unit: 'month', n: 3 }, { at: 18 Dec 00:00, unit: 'month', n: 4 }]`; now 17 Nov 21:00 | `header.moment.text` '3 months today' |
| `pull.momentLocalDayAfter` (RF6) | the same parent a day on: app.at 18 Nov 19:30, feed 19:10, the same app moments; pull.at 18 Nov 20:55, feed 20:40 by 'Dad', the same pull moments; now 18 Nov 21:00 | `header.moment` null |

  P1's `merge-nap-newer` and `merge-pull-null`: give each pull input `since: pull.at - 93600000` and keep the hand-written `expect` as P1 wrote it. If the app anchor either case relies on is older than that `since`, move it inside the window, so the case still pins "a null never erases" and confirmation stays `pull.sparseConfirmed`'s.

  The merge section of test/widget-since-parity.test.js rebuilds F1's app export for viewer u1 with `live: false, liveAt: NOW - 2 h`, so the pull (at NOW) is N. It does the same for F5a's viewers, and for u2 it builds the app export with `lossHolding: false`: the app ran before the holding was seeded. `shiftMoments(s, ms)` copies a snapshot with every moment's `at` moved by `ms`, a Worker in another zone than the parent's. It loads tools/widget_model.js from this tree in every run (the five mutants live in the rule modules):
```js
const m = mergeSources({ app, pull, nap: null, now: NOW }), mk = byId(m, 'k'), mr = byId(m, 'r');
ok("merge keeps k's straddling anchors from the app, as of app.at", mk.last.sleep === ak.last.sleep && mk.asOf.sleep === app.at
  && mk.by.sleep === 'Dad' && mk.last.feed === ak.last.feed && mk.asOf.feed === app.at);
ok("companion: r's sleep inside the window is the pull's, as of pull.at", mr.last.sleep === pr.last.sleep && mr.asOf.sleep === pull.at);
// F10: F5a, NOW is d's first birthday
const m5 = mergeSources({ app: app5aU2Before, pull: pull5aU2, nap: null, now: NOW }), md = byId(m5, 'd');
ok("F5a a newer pull's [] hides d's 1 year today (RF6); d's age still shows", eq(md.moments, []) && md.age !== null
  && byId(app5aU2Before, 'd').moments.length === 2);
const m5u1 = mergeSources({ app: app5aU1, pull: shiftMoments(pull5aU1, -4 * 3600000), nap: null, now: NOW });
ok("companion: for u1 glass draws the app's month days, not the pull's moved ones", byId(m5u1, 'd').moments.length === 2
  && eq(byId(m5u1, 'd').moments, byId(app5aU1, 'd').moments));
```

- [ ] **Step 2: Run it and see it fail.** Run `node tools/widget_gen.js && node tools/gates.js --only=widget-parity`. Expected: FAIL, naming the `pull.*` cases whose hand-written `expect` disagrees with the model. Run `node test/widget-since-parity.test.js`. Expected: FAIL, "tools/widget_model.js exports mergeSources".

- [ ] **Step 3: Implement** `mergeSources` per the table and export it. `renderModel` takes rows, Health, nap and month days (M15's `header.moment`, M12's monthcard `url`) from `Merged`, and computes `header.fresh` and the stale test from the oldest `asOf` shown. Add the two rules if P1 has not, regenerate, and bump app/sw.js.

- [ ] **Step 4: Run and pass.**
  - `node tools/gates.js --only=widget-parity,widget-since-parity` → PASS.
  - In a scratch edit, make the `pull.since` comparison always use O.at → FAIL at `pull.sparseConfirmed` and `pull.staleRescued`. Restore.
  - In a scratch edit, make it always use pull.at when N is the pull → FAIL at `pull.straddleKept`, `pull.sparseUnconfirmed` and "merge keeps k's straddling anchors". Restore.
  - In a scratch edit, take `moments` from N, as `age` is → FAIL at `pull.momentLocalDay`, `pull.momentLocalDayAfter` and the F5 companion line. Restore.
  - In a scratch edit, let a newer pull's [] keep the app's list, as a null that never erases → FAIL at `pull.momentHolding` and the F5a line. Restore.

- [ ] **Step 5: Commit.**
```bash
git commit -o tools/widget_model.js docs/widgets/widget-copy.json docs/widgets/widget-fixtures.json test/widget-since-parity.test.js \
  workers/shared/widget-rules.mjs app/since-rules.js app/sw.js native-ios/CubbyWidget/Generated.swift \
  native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt native-android/app/src/main/res/values/widget_strings.xml \
  -m "The widget model merges the server pull by newest, and a pull can rescue a stale widget" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: iPhone widgets pull on their own and merge by newest

**Files:**
- Modify: native-ios/Shared/Snapshot.swift (P3): create `PullBaby`, `PullSnapshot`, `SnapshotDecode.pull` and `FixtureInput.pull`. P3 declares none of them (P3 note 10; roadmap Swift type ownership).
- Modify: native-ios/Shared/WidgetModel.swift (P3): create the merge, `WidgetModel.merge`, per Task 7's table; `render` reads it.
- Modify: native-ios/Shared/WidgetStore.swift (P3): keys `pokedAt`, `pullTriedAt`; `writePull(json:)`; `clearAll()` removes all five.
- Create: native-ios/Shared/WidgetPull.swift
- Modify: native-ios/CubbyWidget/Provider.swift (P3): pull before `WidgetTimelineBuilder.build`; `WidgetInputs.make` fills `pull` from the store; the reload policy.
- Create: native-ios/Tests/WidgetPullTests.swift
- Modify: tools/ios_widget_check.sh (P3): `TESTS` gains WidgetPullTests.swift; tools/test_wiring_check.js ALLOW gains it (`ranBy: 'tools/ios_widget_check.sh'`, P3 contract note 1).

**Interfaces:**
- Consumes:
  - from Generated.swift: `WRules.pullMinMs`, `WRules.pullEveryMs`, `WSnapshot.versions`;
  - from P3: `AppSnapshot`, `SnapshotBaby` and its parts (`Age`, `Anchors`, `ByLabels`, `Nap`, and `SnapshotMoment`, P3's Swift form of F10's `{ at, unit, n }`), `FixtureInput`, `SnapshotDecode.app`, `WidgetModel.render` and its `babyView` (with P3's port of M15 and the monthcard `url`), `WidgetStore`, `WidgetInputs.make`, and `WidgetTimelineBuilder.build(family:config:now:store:) -> (entries, reloadAfterMs)`;
  - from P4: `NapState`, `FixtureInput.nap`, `WidgetKeychain.shared` (`token()`, `takeToken()`) and `WidgetAPI.base`;
  - Task 7's table.
- Produces, in Snapshot.swift:
```swift
struct PullBaby: Codable, Equatable { let id: String; let name: String; let age: Age?; let moments: [SnapshotMoment]
  let last: Anchors; let by: ByLabels; let nap: Nap?; let healthOpen: Bool? }   // SnapshotBaby, but Health may be unknown
struct PullSnapshot: Codable, Equatable { let v: Int; let state: String; let at: Int; let since: Int; let twins: Bool
  let activeBabyId: String?; let babies: [PullBaby] }                     // no lockScreen, no shortcuts
// SnapshotDecode gains: static func pull(_ json: String?) -> PullSnapshot?   nil: absent, malformed, no since, a baby
//                       without moments, or v not in WSnapshot.versions
// FixtureInput gains:   let pull: PullSnapshot?                             decoded as given; the merge ignores a v outside WSnapshot.versions
```
- Produces, in WidgetModel.swift: `WidgetModel.merge(app: AppSnapshot?, pull: PullSnapshot?, nap: NapState?, now: Int) -> Merged?` (nil: no app), with `Merged` and `MergedBaby` carrying exactly the fields of Task 7's `Merged` (`moments: [SnapshotMoment]` among them), and `asOf` as `[String: Int]` keyed feed, sleep, nappy, nap. `babyView` reads a `MergedBaby` in place of `(SnapshotBaby, at)`.
- Produces, in WidgetPull.swift:
  - `WidgetPull.shouldPull(now: Int, appAt: Int?, triedAt: Int?, pokedAt: Int?, hasToken: Bool) -> Bool`. It is true when there is a token and either `pokedAt > triedAt` or `now - max(appAt, triedAt) >= pullMinMs`;
  - `WidgetPull.fetch(token: String, session: URLSession, timeout: TimeInterval = 8) async -> PullOutcome`;
  - `enum PullOutcome { case ok(json: String, snapshot: PullSnapshot), refused, unavailable }`;
  - `WidgetPull.refresh(store: WidgetStore, keychain: WidgetKeychain, session: URLSession, now: Int) async`.

- [ ] **Step 1: Write the failing tests.**
  - **Goldens.** Every `pull.*` fixture runs through P3's golden test with `pull` decoded, the six `pull.moment*` month-day cases among them (`header.moment` and `url` asserted exactly). Widen its filter to phases A and B if it still reads phase A only.
  - **WidgetPullTests**, with a URLProtocol stub and `WidgetStore(defaults: UserDefaults(suiteName: "test-" + UUID().uuidString)!)`:
```swift
XCTAssertEqual(req.url?.absoluteString, WidgetAPI.base + "/api/widget/snapshot")
XCTAssertEqual(req.httpMethod, "GET"); XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer \(t)")
XCTAssertNil(req.httpBody)
// 200 valid -> .ok; store.read(.pullSnapshot) == the reply's `snapshot` object
// 401 -> .refused; pullSnapshot gone, token gone, deviceId kept, appSnapshot untouched          (RF3)
// 503; no answer within 8 s; 200 text/html "<html>"; truncated JSON; v 2; a body over 64 KB
//   -> .unavailable; the previous pullSnapshot and appSnapshot are byte-identical               (RF5)
// pullTriedAt is written before the request leaves; clearAll() leaves none of the five keys
XCTAssertFalse(WidgetPull.shouldPull(now: n, appAt: nil, triedAt: nil, pokedAt: nil, hasToken: false))
XCTAssertTrue (WidgetPull.shouldPull(now: n, appAt: n, triedAt: n - 1, pokedAt: n, hasToken: true))       // poked
XCTAssertFalse(WidgetPull.shouldPull(now: n, appAt: n - 300_000, triedAt: nil, pokedAt: nil, hasToken: true))  // app live
XCTAssertTrue (WidgetPull.shouldPull(now: n, appAt: n - 660_000, triedAt: n - 660_000, pokedAt: nil, hasToken: true))
XCTAssertNotNil(SnapshotDecode.pull(samplePull(healthOpen: "null")))    // a pull may not know Health
XCTAssertNil(SnapshotDecode.pull(samplePull(since: nil)))               // no since, no pull
XCTAssertNotNil(SnapshotDecode.pull(samplePull(moments: "[]")))         // F10: holding or no birth
XCTAssertEqual(SnapshotDecode.pull(samplePull(moments: #"[{"at":1794873600000,"unit":"year","n":1}]"#))?.babies[0].moments,
               [SnapshotMoment(at: 1794873600000, unit: "year", n: 1)])         // 17 Nov 2026 00:00 UTC, 1 year
XCTAssertNil(SnapshotDecode.pull(samplePull(moments: nil)))             // a baby without moments, no pull
XCTAssertNil(SnapshotDecode.pull(samplePull(v: 2))); XCTAssertNil(SnapshotDecode.pull("{"))
```

- [ ] **Step 2: Run them and see them fail.** Run `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh`. Expected: build errors naming `WidgetPull`, `PullBaby`, `PullSnapshot` and `SnapshotDecode.pull`; `IOS-WIDGET: FAIL`. Once those four exist as empty shells, the `pull.*` goldens fail (FixtureInput still drops `pull`). Before adding the ALLOW entry, `node tools/gates.js --only=test-wiring` → FAIL naming native-ios/Tests/WidgetPullTests.swift.

- [ ] **Step 3: Implement.**
  - **fetch** accepts only a 200 with content-type application/json, a body of 64 KB or less, and a `snapshot.v` in `WSnapshot.versions`. A 401 is `.refused`; everything else is `.unavailable`.
  - **refresh** writes `pullTriedAt` first, then acts on the outcome:
    - `.ok` stores the snapshot JSON through `writePull`. If that JSON differs from the stored one, it reloads the other kinds.
    - `.refused` drops `pullSnapshot` and calls `keychain.takeToken()`.
    - `.unavailable` keeps everything as it was.
  - **Provider.** Before `build`, the Provider awaits `refresh` when `shouldPull` says so. `WidgetInputs.make` sets `pull` to `SnapshotDecode.pull(store.read(.pullSnapshot))`. While a token exists, `reloadAfterMs` becomes `min(reloadAfterMs ?? pullEveryMs, pullEveryMs)`, and it is drawn as `.after`.
  - **WidgetModel.merge** follows Task 7's table line for line, the `moments` row included, and `render` takes rows, Health, nap, month days (`header.moment`, the monthcard `url`) and "Updated" from it, as `renderModel` does.

- [ ] **Step 4: Run and pass.**
  - `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh` → `IOS-WIDGET: PASS`.
  - In a scratch edit, make the merge take `last` from the app only → the `pull.partnerFeed` and `pull.sparseConfirmed` goldens FAIL. Restore.
  - In a scratch edit, give a null-in-the-pull field `asOf` pull.at whatever its anchor → the `pull.straddleKept` golden FAILS. Restore.
  - In a scratch edit, take `moments` from the newer source → the `pull.momentLocalDay` and `pull.momentLocalDayAfter` goldens FAIL. Restore.
  - In a scratch edit, keep the app's `moments` when a newer pull's are [] → the `pull.momentHolding` golden FAILS (RF6). Restore.
  - `node tools/gates.js --only=test-wiring` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add native-ios/Shared/WidgetPull.swift native-ios/Tests/WidgetPullTests.swift
git commit -o native-ios/Shared native-ios/CubbyWidget/Provider.swift native-ios/Tests tools/ios_widget_check.sh tools/test_wiring_check.js \
  -m "iPhone widgets pull the family's times on their own and merge them by newest" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: A silent push wakes Cubby to refresh its widgets, with no prompt

**Files:**
- Create: native-ios/App/CubbyPoke.swift; native-ios/Tests/CubbyPokeTests.swift
- Modify tools/cap_ios_configure.rb in three places:
  - the Info.plist block at :168-238: `UIBackgroundModes` gains `remote-notification`;
  - the AppDelegate.swift block at :244-285: add the forwarder;
  - the needles at :282: add `CubbyPoke.handle(`.
- Modify: native-ios/App/CubbyWidgetPlugin.swift (P3, P4): `mintToken` reads the FCM token and passes `push`; native-ios/Shared/WidgetTokenService.swift (P4): `mint(idToken:hid:push:)`; P4's `testMint200StoresToken`: the body is exactly the four keys, plus `push` when one is given.
- Modify: tools/widget_parity_check.js (P1): the no-prompt and configure checks, with a self-test plant.
- Modify: tools/ios_widget_check.sh (P3): built-artifact checks; `TESTS` gains CubbyPokeTests.swift; tools/test_wiring_check.js ALLOW gains it.

**Interfaces:**
- Consumes: 2.9's payload (FCM puts `cubby` at the top of `userInfo`); `WidgetStore` key `pokedAt` (contract note 6).
- Produces:
  - `CubbyPoke.isRefresh(_ userInfo: [AnyHashable: Any]) -> Bool`, true when `userInfo["cubby"] as? String == "widget-refresh"`.
  - `CubbyPoke.handle(_ userInfo: [AnyHashable: Any], store: WidgetStore? = .shared(), reload: () -> Void = { WidgetCenter.shared.reloadAllTimelines() }, completion: @escaping (UIBackgroundFetchResult) -> Void) -> Bool`.
  - In the plugin, `pushToken(timeout: TimeInterval = 3) async -> String?`: it reads `Messaging.messaging().token`, answers nil on an error or timeout, and never asks for permission.

- [ ] **Step 1: Write the failing tests.**
  - **CubbyPokeTests:**
    - `["cubby": "widget-refresh"]` returns true, calls `reload` once, writes `pokedAt`, and completes with `.newData`.
    - `["cubby": "other"]`, `[:]` and a reminder's `["tag": "med-1", "aps": [...]]` return false, call nothing and write nothing.
  - **widget_parity_check:**
    - native-ios/ calls no `requestAuthorization(` (checked statically, comments stripped);
    - tools/cap_ios_configure.rb contains `remote-notification` and `CubbyPoke.handle(`;
    - `--self-test` plants `UNUserNotificationCenter.current().requestAuthorization(` in a fixture, which must go red.
  - **ios_widget_check.sh:**
    - the built App Info.plist's `UIBackgroundModes` contains `remote-notification`;
    - the patched AppDelegate.swift contains `CubbyPoke.handle(`.

- [ ] **Step 2: Run them and see them fail.**
  - `node tools/gates.js --only=widget-parity` → FAIL, "cap_ios_configure.rb never adds remote-notification".
  - `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh` → FAIL: CubbyPoke is undefined and there is no background mode.

- [ ] **Step 3: Implement.**
  - **Info.plist.** Read `Print :UIBackgroundModes`. Add the array if it is missing, and append `remote-notification` only if it is absent; never delete another mode. Verify with `Print`, or abort.
  - **AppDelegate.** Insert this before the class's closing brace, unless it is already present:
```swift
    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                     fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        if CubbyPoke.handle(userInfo, completion: completionHandler) { return }
        completionHandler(.noData)
    }
```
  - **Mint.** `mintToken` awaits `pushToken()` and passes it to `WidgetTokenService.mint(idToken:hid:push:)`, which sends `push` only when it is non-nil.

- [ ] **Step 4: Run and pass.**
  - `node tools/gates.js --only=widget-parity` → PASS, with the self-test plants caught.
  - Run `ruby tools/cap_ios_configure.rb` twice. The second run reports already patched, and `plutil -p` on the shell's App/Info.plist lists `remote-notification` once.
  - `bash tools/ios_widget_check.sh` → `IOS-WIDGET: PASS`.
  - In a scratch edit, drop the plist lines → ios_widget_check.sh FAIL. Restore.

- [ ] **Step 5: Commit.**
```bash
git add native-ios/App/CubbyPoke.swift native-ios/Tests/CubbyPokeTests.swift
git commit -o native-ios/App native-ios/Shared/WidgetTokenService.swift native-ios/Tests tools/cap_ios_configure.rb \
  tools/widget_parity_check.js tools/ios_widget_check.sh tools/test_wiring_check.js \
  -m "A silent push wakes Cubby to refresh its widgets, and asks the parent for nothing" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Two phones, one night (device proof)

> FOUNDER STEP: yes to pushing Tasks 1-7 to main (push = deploy; P5 has no rules publish of its own). Then `curl -s -o /dev/null -w '%{http_code}' https://little-cubby.com/api/widget/snapshot` answers 401.
>
> Already done (C5): the APNs auth key CBHXDD5RK6 (Sandbox and Production, team F5NVQV7NVB) has been in Firebase Cloud Messaging since 2026-08-07, so FCM can deliver background pushes to iOS. Check it is still listed under Project settings > Cloud Messaging > Apple app configuration before Step 1; no new key.
>
> FOUNDER STEP (advisory, RF4): Spark allows 50,000 reads a day across every family. A widget phone costs about 1,500 to 2,000 reads a day: at most 24 hourly pulls and about 20 poked ones, each about 35 documents. A poke costs 2 to 3 reads. Decide Spark or Blaze (OPERATIONS.md:152) before the update leaves TestFlight.

**Files:**
- Create or append: docs/widgets/device-proofs.md (the build number, devices, iOS versions, and each result).

- [ ] **Step 1: Build and install.**

  FOUNDER STEP: a yes to this TestFlight upload (`bash tools/cap_ios_build.sh` builds and uploads, as in P3 Task 9).

  Then run `bash tools/cap_ios_build.sh`, carrying A, B and F2, and `node tools/asc.js builds` until the build reads processed. Install it from TestFlight on phone A (Mum) and phone B (Dad). Both are in one family. B has a medium widget and has never been asked about notifications.
- [ ] **Step 2: The poke path.** With B's app in the background (not swiped away), log a feed on A. Expected: within 60 s, B's widget shows it with "· Mum", and "Updated" moves to now.
- [ ] **Step 3: The pull path.** Swipe B's app away, then log on A. Expected: B updates at its next hourly pull at the latest, and until then "Updated" states its age.
- [ ] **Step 4: The nap path.** Tap Start sleep on B's widget. Expected: A's widget shows "Asleep now" within 60 s.
- [ ] **Step 5: Removal (RF3).** On A, remove B from the circle. Expected: B's next pull drops the pulled data, Sleep reads "Sleep ↗", and no further poke reaches B.
- [ ] **Step 6: Commit the record.**
```bash
git add docs/widgets/device-proofs.md
git commit -o docs/widgets/device-proofs.md -m "Two-phone proof of partner freshness on TestFlight, recorded" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

> FOUNDER STEP: submit Phases A and B, with F2, to App Review (F1).

## Not in this plan

- Android, which is P6: it receives the poke (CubbyPokeService), pulls in Glance, and mirrors Task 7's table in Kotlin. The new `pull.*` fixtures are its spec.
- Clearing a pregnancy widget through the pull and push after a loss recorded elsewhere (F4): that gets its own phase. Until then every pull carries `pregnancy: null`.
- F10's glass and door (P1, P3, P6): `monthMoments` itself, the AppSnapshot's `moments`, M15 and `header.moment`, the monthcard link and route (`m`, the native-bridge whitelist, widget-deeplink), `widget.opened` target 'moment', the moment copy, the honey ink and star, the home-screen-only rule (StandBy, Mac, iPad lock screen) and the Android port. P5 carries `moments` in the pull and merges them. Never built: the 6 October takeover card, marked firsts, comparisons, streaks.
