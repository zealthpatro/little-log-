# Home-screen widgets: roadmap and cross-plan contract

17 Nov 2026, nothing built. Spec: docs/superpowers/specs/2026-11-16-home-screen-widgets-design.md (D1-D8, C1-C7, F1-F10
fixed; nothing here reopens them). Lines are for 58733b16 (origin/main when written); re-check before editing. Every plan
copies section 2 verbatim; a change lands here first, then in every plan. "Chosen here" marks a value the spec left open.

## 1. The six plans, in build order

**P1, web foundations** (docs/superpowers/plans/2026-11-17-widgets-1-web-foundations.md). Web app and Worker copy,
shippable alone: F7 author stamping (2.4); targets pump, activity, measure, milestone, health, voice, sleepfix with
`baby` and `from`, quickOwnerOnlyOk() on kicks, contractions, symptom, the bridge whitelist and launch-URL-once (2.7);
the per-person "Hide details on the lock screen" setting (shown only on an iOS binary with widgets); QUICK_ACTIONS
`widget` fields and Health; widget-copy.json, generator, model, fixtures, widget-parity; the snapshot export and the
shortcuts list (inert on the web); C6 in syncReminderIndex (index.html:8232) and sendPushReminders (worker.js:1800),
which rewrites every `med-` and `digest-` title and body itself (chosen here: no cached client can put a name back);
its 2.11 events; F10 month days and `monthcard` (2.2-2.11); DESIGN.md's night strokes and `--on-sleep`; native-ios/ and
native-android/ fenced from deploy; sw.js ASSETS and CACHE. Depends on nothing, but rebases on lane L (fix7-L, v371, the
native sign-in link loop), which also clears the launch URL: one rule, not two. Visible on the web: C6 only.

**P2, running naps in their own record** (2026-11-17-widgets-2-running-naps-record.md). C4 for every family, nothing on
glass: a timers listener; 2.2's transactions in startSleep, startSleepFrom, stopSleep, saveSleepCorrect,
keepSleepRunning, discardRunningNap (index.html:6219-6305); appBlobFromState (store-firebase.js:1470) drops
`timers.*.sleep`; sleepEventId; fold rule; timers rules; purgeDeletedHouseholds (worker.js:2050) deletes timers; offline
Start and Stop say so, never a blind write; local-only users keep local timers. Depends on P1; live a release before P4.

**P3, iOS Phase A** (2026-11-17-widgets-3-ios-phase-a.md). Every tap opens Cubby. native-ios/; cap_ios_configure.rb
adds the target after :288 with per-target entitlements (not :317), App Group and keychain group (:149-166), matching
versions, CubbyBridgeViewController and SceneDelegate shortcuts (:88-115); cap_ios_build.sh signs the appex before :92;
ios_launch_smoke.sh renders the widget. TestFlight: medium, small (F9), twins, lock screen, Edit Widget, Link taps, the
illness switch and its in-app line, dynamic shortcuts, wipes, before-first-unlock, renders and goldens (321x148,
148x148; day, night, accented, xxLarge; F10 moment days at both floor sizes, day and night, and at xxLarge), its 2.11
event, the SPEC note; change_test_check learns native-ios/. No pregnancy kind (F4). Device proofs: Link delivery,
small-widget Links on iOS 17, `.relative` without seconds. Needs P1.

**P4, Sleep in place** (2026-11-17-widgets-4-sleep-in-place.md). Phase B: token.mjs, nap.mjs, routes.mjs; mint (one
transaction, LRU at 5 per uid, 90-day sliding expiry), revoke, nap (start, stop, undo, state; 409; needsApp); limiters;
widgetTokens deny-all and TTL; tokens deleted by the account purge (worker.js:2167), the household purge and a removed
member's next use, failed purges retried (store-firebase.js:3841-3851); mint on each foreground while a widget exists,
revoke on sign-out and switch; NapIntent, pending, Undo, Checking, failure lines, the long-nap `sleepfix` button, Phase B
labels; Keychain token and deviceId; its 2.11 event; emulator suite (emulator-issued Auth tokens). Depends on P2, P3.

**P5, partner freshness** (2026-11-17-widgets-5-partner-freshness.md). F2: snapshot.mjs and push.mjs; GET
/api/widget/snapshot on the since-rules module the app also runs, F10 `moments` too (2.2); POST /api/widget/poke after a
pushed log (debounced 30 s) and every nap-route write; silent pushes (2.9); the native FCM token sent at mint, with no
permission prompt; `pullSnapshot` merged by 2.5; UIBackgroundModes remote-notification and a reload handler; its 2.11
event. Founder: the Apple push key (C5). Depends on P1 and P4's token. Then A + B + F2 go to App Review (F1).

**P6, Android** (2026-11-17-widgets-6-android.md). The shell made shippable: native-android/ copied in by
tools/cap_android_configure.js; tools/cap_android_build.sh (AAB, ~/.android-keys/ signing, 2.6 versions, Mac-only
gates); key-file patterns in .gitignore and a pre-commit guard before its `exit 0` (:55); the Firebase auth, messaging,
browser, share, filesystem and haptics plugins; App Links; backup exclusions; JDK 21 and the SDK. Then Glance widgets
mirroring P3 and P4 (F10: the Kotlin port of M15 on the shared fixtures), SizeMode.Responsive by width and height (F8),
the configuration activity, ACTION_VIEW intents, NapActionCallback, shortcuts, CubbyPokeService, the Keystore token,
Glance and Kotlin goldens, tree gate android-parity (android_parity_check's :80-81 false pass fixed; `--release` in
cap_android_build.sh), `platforms.android` "on". Founder: Play account, upload keystore, Firebase Android app. Depends
on P1, P3 (parity) and P4; P5 for freshness.

No plan yet: the pregnancy widget (F4: its own phase after CA3 and F2 are live; until then its kind is not compiled and
`pregnancy` is always null) and the large foldable "night's story" widget (F8, later). Nor the PWA manifest follow-up
(spec 6.10), which needs the founder's OK. F10: no 6 Oct takeover card, marked firsts, comparisons or streaks.

## 2. The cross-plan contract (final; plans copy it, never rename)

### 2.1 New files

| Path | Plan | Role |
|---|---|---|
| workers/shared/since-rules.mjs (imports GENERATED ./widget-rules.mjs: `export const RULES, DEFAULTS, SNAPSHOT_VERSIONS`); app/since-rules.js (GENERATED browser copy, 2.2) | P1 | anchors, health switch, twins, age, month days, sleep ids, by-label |
| app/widget-snapshot.js | P1 | snapshot builder, shortcuts, by-label: `window.CubbyWidgetSnapshot` (+ module.exports) |
| docs/widgets/widget-copy.json; docs/widgets/widget-fixtures.json | P1 | every glass string, rules, cases (2.3); GENERATED fixtures |
| tools/widget_gen.js, tools/widget_model.js, tools/widget_parity_check.js | P1 | generator, JS reference model, gate |
| native-ios/CubbyWidget/Generated.swift; native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt; native-android/app/src/main/res/values/widget_strings.xml (never Capacitor's strings.xml) | P1 | GENERATED |
| native-ios/{CubbyWidget,Shared,App,Tests}/; tools/ios_widget_check.sh | P3 | extension, code in both targets, plugin, XCTest. Swift types: P3 declares AppSnapshot and its parts; P4 NapState and FixtureInput.nap; P5 PullSnapshot, PullBaby, SnapshotDecode.pull, FixtureInput.pull and the merge in WidgetModel.swift |
| workers/widget/token.mjs, nap.mjs, routes.mjs (P4); snapshot.mjs, push.mjs (P5) | P4, P5 | token, pure nap decision, routes; pull, poke. worker.js imports, directly, every module the widget routes reach (these five, workers/shared/since-rules, widget-rules, fs-values): six worker tests copy only its `./` imports. widget-nap-decide asserts it |
| native-android/app/src/{main,test}/...; tools/cap_android_configure.js, cap_android_build.sh, android_widget_check.sh | P6 | shell, widgets, Mac-only check |

### 2.2 Functions

workers/shared/since-rules.mjs; generated app/since-rules.js defines the same names on `window.CubbySince` with `RULES`,
`DEFAULTS` and `SNAPSHOT_VERSIONS`, and `window.CubbyWidgetCopy = { [key]: text }` for every key whose `on` has "app":
```
sinceAnchor(type: 'feed'|'sleep'|'diaper', ev: Event) -> number   // index.html:5151: sleep end; feed dur>0 time+dur; else time
babyAnchors(events: Event[], babyId: string) -> { feed: Event|null, sleep: Event|null, nappy: Event|null }
    // drops e.deleted (babyEvents, :2099); a sleep counts only with an end; newest by `time` (babyEvents' order, as
    // Home does at :4087-4089), anchored by sinceAnchor
healthOpen(illnesses: Illness[], events: Event[], babyId: string, now: number) -> boolean  // an illness with no
    // endedAt AND max(its startedAt, the baby's temperature/symptom/medicine event times) > now - RULES.healthReturnMs
isTwins(babies: Baby[]) -> boolean  // exactly two, |a.birth - b.birth| <= RULES.twinsToleranceMs
ageOf(birth: number|null, now: number) -> { unit: 'day'|'week'|'month'|'year', n: number } | null   // ageString, :2221
monthMoments(birthTs: number, now: number, count = 2) -> Array<{ at: number, unit: 'month'|'year', n: number }>
    // F10: next `count` month days at or after now's local midnight (today counts); :3309's setMonth arithmetic, at =
    // the mark day's local midnight; m 1-11, 13-23 -> month m; m % 12 === 0 -> year m/12 (12 is 1 year); others skipped
sleepEventId(babyId: string, start: number) -> string  // 'sleep-' + babyId + '-' + start
snapshotBaby({ baby, events, illnesses, nap, now, label }) -> SnapshotBaby  // label: (authorId) -> string|null
byLabel(authorId, viewerUid, memberInfo, formerMemberInfo) -> string|null  // loggerName (:3441), <= RULES.byMax chars;
    // null for the viewer's own entry, no author or ''; never an email
```
app/widget-snapshot.js:
```
buildWidgetSnapshot(ctx: SnapshotCtx) -> AppSnapshot | null   // null: write nothing (boot paint, user not loaded, no shared version)
widgetShortcuts(ctx: SnapshotCtx) -> string[]                  // QUICK_ACTIONS keys, at most RULES.shortcutsMax (spec 6.10)
widgetByLabel(authorId, viewerUid, memberInfo, formerMemberInfo) -> string|null  // returns CubbySince.byLabel(...)
widgetVersion(web: number[], binary: number[]) -> number|null  // highest version both read (web: SNAPSHOT_VERSIONS)
SnapshotCtx = { now, state, viewerUid, userLoaded, live: bool, liveAt, memberInfo, formerMemberInfo, lossHolding: bool,
                lockHide: bool, stage: 'baby'|'child'|'pregnancy', chosen: string[],
                quickActions, binary: { snapshot: number[], shortcuts: string[] } | null }
```
`at` = ctx.now while `live`, else `liveAt` (chosen here); `chosen` = QUICK_DEFAULTS.child in the child stage, else
quickChosen(stage). app/index.html (P1): `stampAuthor(ev) -> ev` (2.4); `exportWidgetSnapshot() -> void` (debounced
400 ms; end of render(), the persist override, every RULES.restampMs while `LL.live`); `widgetWipe(reason: 'signout'|
'switch'|'delete'|'loss'|'endPregnancy'|'accessLost'|'unauthorized') -> void` (synchronous, before the action
continues); `applyDeepLinkBaby(baby: string|null) -> void` (2.7); `openWidgetWhoFor(go: string) -> void`;
`lockHidePref() -> boolean`; `setLockHidePref(on: boolean) -> void`.

app/store-firebase.js: P1 `LL.liveAt: number` (ms of the last household or events snapshot with fromCache false) and
`LL.live: boolean` (the newest household snapshot had fromCache false, and navigator.onLine). P2:
```
NapResult = { ok: boolean, already?: true, reason?: 'offline'|'moved'|'denied'|'error', state?: { start, ack: number|null } | null }
LL.napStart(babyIds: string[], start: number) -> Promise<NapResult>  // running: ok + already, no write; two babies: no state
LL.napStop(babyId, expectStart: number, end: number) -> Promise<NapResult>  // clear + create (or revive) event, one tx
LL.napAck(babyId, expectStart: number, at: number) -> Promise<NapResult>
LL.napDiscard(babyId, expectStart: number) -> Promise<NapResult>
LL.napMove(babyId, expectStart: number, newStart: number) -> Promise<NapResult>  // setTimerStart (index.html:5113-5137)
LL.napCloud() -> boolean   // true when this page writes a household's record (hhRef set); else local timers, synchronous
```
app/native-bridge.js: `window.cubbyWidget = { versions(), hasWidgets(), setSnapshot(json), clear(), mintToken(args),
revokeToken() }`, each a Promise resolving null or false on the web or a binary without the method; P1 ships the first
four, P4 the token pair. `window.__cubbyHasWidgets` caches the plugin's whole last hasWidgets() answer `{ value, kinds }`
(false on the web); the lock-screen switch shows only when `value` is true on iOS.

| Worker and tools | Contract |
|---|---|
| workers/widget/token.mjs (P4) | `mintWidgetToken(sa) -> Promise<string>`, `checkWidgetToken(sa, t) -> Promise<boolean>` (format and HMAC, zero reads), `widgetTokenDocId(t) -> Promise<string>` (sha256 hex) |
| workers/widget/nap.mjs (P4) | `decideNap(req, current, events, now, uid) -> { status, body, writes }`, pure: `current` = `{ [bid]: { sleep: {start, ack, by}\|null, updateTime: string\|null } }`, `events` = `{ [eventId]: { exists, deleted } }`, `writes` = Firestore REST Writes on household-relative documents (`timers/<bid>`, `events/<id>`) that widgetRoute qualifies |
| workers/widget/routes.mjs (P4) | `widgetRoute(request, env, url, deps) -> Promise<Response>`, deps = `{ json, rateLimited, clientIpKey, getAccessToken, fsGetStrict, isCarer, verifyFirebaseToken, FS_PROJECT, waitUntil }` (worker.js's `__widget.deps`; waitUntil = ctx.waitUntil, bound per request; verifyFirebaseToken returns `{ uid, email, iat }`; the emulator suites swap only it and FS_PROJECT). `tokenGate(request, env, deps, { ipKey, mask }) -> { ok: true, row, docId, hh, token } \| { ok: false, response, row }`, 2.8's preamble; `token` is the Google access token, datastore + firebase.messaging scopes for nap, snapshot and poke (mint keeps cloud-platform for Identity Toolkit). worker.js dispatches `url.pathname.startsWith('/api/widget/')` |
| workers/widget/snapshot.mjs (P5) | `buildPullSnapshot({ hhFields, events, timers, since, viewerUid, memberInfo, formerMemberInfo, now }) -> PullSnapshot` (`timers` = `{ [bid]: { start, ack } \| null }`; `since` = the earliest event time read completely); each baby's `moments` (F10) = monthMoments(birth, now) from app.babies, [] while the household's loss holding applies to the viewer as the app would decide: `pullLossHolding(lossHolding, members, viewerUid) -> boolean`, myLossHolding line for line over `app.lossHolding`, which the route's mask reads and never sends. The pull always knows the holding, so the contract's fallback (a pull that cannot know returns [] and the merge keeps the app's) never arises (P5 note 8) |
| workers/widget/push.mjs (P5) | `widgetPokePayload(fcmToken) -> object`, `pokeHousehold(env, base, token, hid, exceptUid) -> Promise<number>` |
| workers/usage/core.mjs (P4) | `recordServerEvent(env, name, props, platform: 'ios_app'\|'android_app') -> Promise<void>` |
| tools/widget_gen.js, tools/widget_model.js (P1) | `node tools/widget_gen.js` writes every GENERATED file of 2.1 (`--check`: exit 1 naming each differing path), exports `generate(root) -> { [relPath]: string }`; `renderModel(input: FixtureInput) -> ViewModel` |

### 2.3 widget-copy.json and fixtures

```
{ "schema": 1,
  "snapshot": { "versions": [1] },
  "platforms": { "ios": "on", "android": "pending" },          // "pending" = the declared iOS-only window
  "strings": { "<key>": { "text": "...", "on": ["home"|"small"|"lock"|"config"|"gallery"|"a11y"|"line"|"app"],
                          "platforms": ["ios","android"] } },
  "rules": { "staleMs": 21600000, "napAskMs": 43200000, "napMaxMs": 86400000, "ackFreshMs": 21600000,
             "dayRuleMs": 72000000, "healthReturnMs": 1209600000, "twinsToleranceMs": 86400000, "nameMax": 20,
             "undoMs": 10000, "lineMs": 900000, "restampMs": 600000, "futureStartMs": 300000, "byMax": 12,
             "shortcutsMax": 4, "asleepNowMinWidth": 84, "pullMinMs": 600000, "pullEveryMs": 3600000,
             "pendingMs": 10000 },   // a pending younger than pendingMs only dims the button; older shows "Checking"
  "defaults": { "medium4": "activity", "small": ["sleep", "feed"] },
  "differences": [ { "key": "<key or rule>", "platforms": [...], "why": "..." } ],  // ago line, Say it, lock, app.stackHelp
  "banned": ["don't forget", "last chance", "time for", "streak", "goal", "total", "Pro"],
  "properNouns": ["Cubby", "Smart Rotate", "AM", "PM"],          // plus every QUICK_ACTIONS label, read at gate time
  "cases": [ { "name": "...", "input": FixtureInput, "expect": <partial ViewModel, hand-written, optional> } ],
  "napCases": [ ... ] }   // nap reply -> napState (P4 Task 9's rows) as data with fixtures
```
`app.stackHelp` (on app, ios only) is the iOS stack helper; Swift NapReducerTests and Kotlin NapReducerTest read `napCases`.
Keys are dot-joined lowerCamel (`status.lastFeed`, `button.startSleep`, `line.noConnection`, `a11y.startSleepFor`);
placeholders `{name}`, `{names}`, `{time}`, `{day}`, `{by}`, `{age}`. Swift and Kotlin drop the dots and capitalise the
next letter (`WCopy.statusLastFeed`); Android resources are `w_` plus snake case (`w_status_last_feed`). `line.*` keys
are 2.5's napState line keys. Generated Swift `enum` and Kotlin `object`: `WCopy` (Swift `text(_ key:) -> String?`,
Kotlin `byKey: Map<String, Int>`), `WRules`, `WDefaults`, `WActions` (`all`: key, go, label, inPlace, perBaby, places),
`WSnapshot` (`versions`), `WColor`/`WColors` (from app/index.html's `:root` and night tokens). In `#if CUBBY_WIDGET_EXT`
(extension and test targets) Generated.swift holds the literal AppIntent metadata: MediumConfig, SmallConfig,
LockConfig, the entities' typeDisplayRepresentation, NapIntent's title and parameter titles. Chosen here, with no spec
source: lineMs, restampMs, asleepNowMinWidth, pullMinMs, pullEveryMs, `defaults`.

FixtureInput: `{ platform: 'ios'|'android', phase: 'A'|'B', family: 'medium'|'small'|'lockRect'|'lockInline', config:
{ baby: id|'both'|null, button?: k, first?: k, second?: k }, cellWidth: number (fractional; Double in Swift and Kotlin),
now: ms, token: bool, app: AppSnapshot|null, nap: NapState|null, pull: PullSnapshot|null }`. ViewModel: `{ mode:
'full'|'wordmark'|'message', message: key|null, url: string, header: { name, age, fresh, ask, moment }, rows: [ { baby, label,
by, value, agoAt: ms|null, day: string|null, a11y: string } ], buttons: [ { k, label, style: 'solid'|'soft', arrow:
bool, url: string|null, intent: { action, babyIds, starts?, undo? } | null, a11y, dim: bool } ], line: string|null }`.
`agoAt` is the anchor the live iOS ago line counts from (null on Android); native tests assert every other field exactly.
`row.day` carries any fixed second line (the day word over 20 h, "since 2:40 AM" under a running nap). A start intent
omits `starts`. `url` is the widget body link on 2.7's base: `?baby=<id>&from=widget` for one baby, `?from=widget`
otherwise, `?go=sleep&baby=<id|both>&from=widget` while a noConnection or notSaved line shows. widget-fixtures.json =
`{ "source": "<sha256 of widget-copy.json>", "tz": "UTC", "fixtures": [ { name, input, expect } ] }`; renderModel
formats in UTC and the Swift and Kotlin goldens set their zone from `tz`. A hand-written `expect` that disagrees fails.

F10, rule M15 (P1). ViewModel `header` gains `moment: { text: string, a11y: string } | null`; a moment is active when
`m.at <= now < m.at + 86400000`. Medium: moment.text replaces the age. Twins: both active with the same unit and n, one
line "{names} · 3 months today"; only one, that baby's name with it; else null. Small: the label line reads
"{name} · 3 months today" instead of "{name} · last feed", and the line under the clock gains the type ("last feed",
plus " · {by}" per F7). Lock and pregnancy kinds: always null; natives hide it off the home screen (StandBy, Mac, iPad
lock screen) as they hide `by`. M12: with no noConnection or notSaved line (that sleep link wins), an active day's `url`
is `?go=monthcard&baby=<id>&m=<total months>&from=widget` (m = 12 for "1 year today"; twins: the first baby with it).
Glass (P3, P6): WColors' feed ink (#895D24 day, #E0A655 night) after a small star that VoiceOver and TalkBack skip (they
read `a11y`). Copy (whole strings, the number in {age}; keys month1, months, year1, years): `moment.*` "1 month today",
"{age} months today", "1 year today", "{age} years today"; `small.moment.*` the same after "{name} · "; `twins.moment.*`
after "{names} · "; `a11y.moment.*` "{name} is 1 month old today", "{name} is {age} months old today",
"{name} is 1 year old today", "{name} is {age} years old today". monthMoments cases (UTC): a 31st birth (setMonth
overflow, as the app), month 12, month 24, month 25 skipped, the day before, the day itself, the day after, no birth.
Where F10 is silent, P1 chose (its note 18; fixtures `moment-*`): M15 runs only in mode `full`; a long nap's `ask` keeps
the age slot, so `moment` is null then; the body `url` is monthcard only while `header.moment` is non-null (never on lock,
during the ask, or for twins whose days differ); with both twins, `a11y` is each baby's `a11y.moment.*` joined by
`names.and`; `header.age` keeps the age text, drawn wherever the natives hide `moment`; small's `moment.text` is the
whole label line and its row is unchanged.

QUICK_ACTIONS (index.html:4596) sits between `/* WIDGET-QUICK-ACTIONS-BEGIN */` and `/* WIDGET-QUICK-ACTIONS-END */`;
tools/shortcuts_check.js's row parser (:42-45) must still read every row. Field: `widget: { go, inPlace?: true, perBaby?:
true, platforms?: ['ios'|'android'], places: ('medium4'|'small'|'shortcut')[] }`. feed, sleep (inPlace), diaper: small,
shortcut; pump, activity: medium4, small, shortcut; measure, milestone: shortcut; voice: platforms ['android'], all
three; new `{k:'health', s:[], label:'Health', ..., widget:{go:'health', perBaby:true, places:['medium4','small']}}`
(chosen here: `s:[]` keeps it off every in-app quick surface). The fourth slot always draws the quiet (note) kind.

### 2.4 Stored data

- F7 author. Chosen here: F7's `by` is the event's existing `authorId` (firestore.rules:517-525 pin it to the writer
  on create and keep it immutable; loggerName and the timeline read it). `stampAuthor` (signed-in uid only, never 'local')
  covers eight doors: addEvent, commitEvent (the targets path), stopFeed, saveFeedCorrect, stopSleep, saveSleepCorrect,
  toggleRoutine, setBirthWeight; pushNow (store-firebase.js:3340) adds an author only on create. The timer keeps `sleep.by`.
- Running nap: `households/{hid}/timers/{babyId}` = `{ sleep?: { start: int ms, ack?: int ms, by: uid } }`, no other
  field (chosen here over `timers/{hid}_{bid}`: membership via the household's pm()). Writes are transactions (app) or
  one documents:commit with an updateTime precondition (Worker); clearing is an `update` whose mask names `sleep`.
- Sleep event: id `sleepEventId(babyId, start)` for app stops, corrections and the widget. Worker fields `{ id,
  authorId, babyId, type:'sleep', time:start, end, via:'widget' }`; undo marks `{ deleted:true, deletedAt, deletedBy }`.
  A stop meeting a deleted one revives it (app transaction; Worker update under exists:true), never answering `already`.
- Fold rule (chosen here): a timer whose start S has a live sleep event for that baby with `time == S` (any id) is
  stopped; any client clears it. A legacy `app.timers.<bid>.sleep` moves into the doc only when the doc has no `sleep`
  (missing or empty), else the doc wins; the legacy key is removed in the same transaction, blob merged.
- `widgetTokens/{sha256hex(t)}` = `{ uid, hid, deviceId, platform: 'ios'|'android', createdAt: int ms, lastUsedAt: int
  ms, expireAt: timestamp (90 days, sliding; the TTL field, section 3), push?: string (P5, FCM registration token) }`.
- `users/{uid}.widget` = `{ lockHide: bool }`; localStorage `cubby-lockhide:<uid>`. `showWeek` is reserved for F4.

### 2.5 Shared-container contract

Keys (iOS UserDefaults suite `group.com.littlecubby.app`; Android SharedPreferences `cubby_widget`): `appSnapshot`
(app only), `napState` (widget only), `pullSnapshot` (widget only, P5), each a JSON string; P5's `pokedAt` (the app's
push handler) and `pullTriedAt` (the widget), each a JSON number. Every clear removes all five keys.
```
AppSnapshot  { v, state: 'ok'|'quiet'|'signedOut', at, twins, lockScreen: { hide }, activeBabyId,
               shortcuts: [k...], pregnancy: null, babies: [ SnapshotBaby ] }
SnapshotBaby { id, name (<= 20), age: { unit, n } | null, last: { feed, sleep, nappy }: ms|null,
               by: { feed, sleep, nappy }: label|null, nap: { start, ack: ms|null } | null, healthOpen: bool,
               moments: [ { at, unit, n } ] }  // F10: <= 2; [] with no birth, in myLossHolding(), state not 'ok'
NapState     { babies: { <bid>: { nap: { start, ack } | null, at } },
               line: { key: 'noConnection'|'notSaved'|'alreadyStarted'|'alreadyStopped'|'pickBaby', until } | null,
               undo: { of: 'start'|'stop', babyIds, starts: { <bid>: ms }, until } | null,
               pending: { babyIds, sentAt } | null }
PullSnapshot = AppSnapshot without lockScreen and shortcuts, with activeBabyId null and pregnancy null, plus `since: ms`
               (the earliest event time the pull saw completely); a pull baby's `healthOpen` may be null
```
`undo`, `pending`, `pickBaby` are chosen here (Undo needs what the tap made, Checking an unknown outcome, 403 "Open Cubby
to pick a baby."). Merge at render is P5 Task 7's field-by-field table, each field with its own asOf: the newer source's
value unless null (a pull's `since` confirms an older anchor), `nap` from the newest of the three `at`s, `moments` (F10)
the app's list whichever source is newer (the Worker's are UTC midnights) but [] when the pull is the newer source, has
the baby and its list is [] (a holding seeded from another phone), all else from appSnapshot only; the pull is ignored
unless appSnapshot.state is 'ok'. "Updated" and stale = the oldest asOf shown.

### 2.6 Native identifiers

- Capacitor plugin `CubbyWidget` (JS `Capacitor.Plugins.CubbyWidget`), both platforms: `versions() -> { snapshot:
  number[], shortcuts: string[], inPlace: boolean }`; `hasWidgets() -> { value: boolean, kinds: { medium, small, lock:
  number } }`; `setSnapshot({ v: number, json: string }) -> { ok: boolean }` (also sets `shortcuts`, labelled from
  WActions, then reloadAllTimelines or updateAll); `clear() -> { ok: true }` (all five keys, token, shortcuts; from P4 it
  also revokes that token via /api/widget/revoke). P4: `mintToken({ idToken, hid }) -> { ok: boolean, status:
  number }` (native adds deviceId, platform and, from P5, `push`, read on iOS in the App target for
  `WidgetTokenService.mint(idToken:hid:push:)`; keeps the token, JS never sees it); `revokeToken() -> { ok: boolean }`
  (local clear first); `hasToken() -> { value: boolean }`.
- iOS: appex `com.littlecubby.app.widget`, target `CubbyWidget`, floor iOS 17.0 (host stays 15.0); App Group
  `group.com.littlecubby.app` on both; keychain access group `F5NVQV7NVB.com.littlecubby.app.shared` (literal prefix),
  service `com.littlecubby.app.widget`, accounts `token` and `deviceId`, AfterFirstUnlockThisDeviceOnly; reinstall marker
  `UserDefaults.standard` key `cubbyKeychainSeen`. Kinds `cubby.medium` (systemMedium), `cubby.small` (systemSmall),
  `cubby.lock` (accessoryRectangular, accessoryInline). Configuration intents `MediumConfig` (baby, button),
  `SmallConfig` (baby, first, second), `LockConfig` (baby: each baby, no Both; chosen here); AppEntity `BabyEntity`. The
  only writing intent: `NapIntent(action: String, babyIds: [String], starts: [Int] (index-aligned with babyIds), undo:
  String)`, isDiscoverable false, unlocked device required. `CubbyBridgeViewController: CAPBridgeViewController`
  registers the plugin in capacitorDidLoad, as Main.storyboard's custom class. Shortcut items: type `cubby.go`, userInfo
  `url`.
- Android: applicationId `com.littlecubby.app`; package `com.littlecubby.app.widget`: `CubbyMediumWidget` +
  `CubbyMediumReceiver`, `CubbySmallWidget` + `CubbySmallReceiver`, `CubbyWidgetConfigActivity`, `NapActionCallback`
  (the only ActionCallback that writes), `CubbyPokeService` (extends the Firebase messaging plugin's service, replacing
  it by manifest merge); `com.littlecubby.app.CubbyWidgetPlugin` registered in MainActivity before super.onCreate;
  provider XML `res/xml/cubby_medium_info.xml`, `res/xml/cubby_small_info.xml` (home_screen,
  `reconfigurable|configuration_optional`); token in `cubby_widget_secure` under Keystore alias `cubby_widget_key`;
  deviceId in `noBackupFilesDir/cubby_device_id`; dynamic shortcut ids `go-<go>`. versionName = the iOS CalVer
  `YYYY.W.R` (cap_ios_build.sh:69); versionCode = `YYYY*10000 + W*100 + R` (chosen here); ~/.android-keys/cubby-upload.jks,
  keystore.properties, alias `cubby-upload`.

### 2.7 Router

URL `https://little-cubby.com/app/?go=<go>&baby=<babyId|both>&from=<widget|shortcut>` (`from=shortcut` chosen here for
long-press items, which carry no `baby`); if P3 proves a scheme is needed, `cubby://app/?<same query>` routes the same.
`cubby-dl` gains `baby`, `from` and `m` (F10); native-bridge's routeUrl and routeDeepLink whitelist all three;
stashDeepLink strips them. `baby` matches `^[A-Za-z0-9_-]{1,64}$` or is `both`; unknown falls back to the active baby
silently. getLaunchUrl routes once per webview process (sessionStorage `cubby-launch-done` = the URL, or lane L's
equivalent if it landed first); appUrlOpen always routes. applyDeepLinkBaby runs BEFORE the open, setting activeBabyId
and arming a one-shot target list that initTargets() consumes (Both survives, no redraw); `baby` with no `go` sets the
active baby and stays on Home. New BABY_GO: `pump` openPump, `activity` openActivity, `measure` openGrowth, `milestone`
openCustomMilestone, `voice` openVoiceLog (Home instead whenever the open would show Pro), `health` (one open illness:
that baby, `healthTab='illness'`, go('health'); `both`, or several babies none open: openWidgetWhoFor('health'); one
baby, none open: its health view), `sleepfix` (openSleepCorrect(bid) while a nap runs, else openSleep). `monthcard`
(F10): `m` an integer 1..600 (sits between `baby` and `from`; kept as a number, which openMemoryCard needs), else ignored
and Home stays; applyDeepLinkBaby, then openMonthCard(m, memCandPhoto(m)) (:3077), no Pro mark; swallowed whenever
myLossHolding() is set, a living child or not, before widget.opened counts it (chosen in P1). kicks, contractions,
symptom take quickOwnerOnlyOk(), swallowed silently as mood is (:2802); the loss swallow (:2757) and hasBaby gate stay;
no target a shipped table emits is ever removed.

### 2.8 Worker routes and token

Token `w1.<b64url(24 random bytes)>.<b64url(HMAC-SHA256(key, 'w1.' + middle))>`, regex
`^w1\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{43}$`; key = HKDF-SHA256 over the service-account private key, info
`cubby-widget-token-v1` (doseTicketKey's pattern, worker.js:2393). Chosen here: every token route reads it from
`Authorization: Bearer <t>`, never a body (replaces spec 6.7's body `t`). Order (tokenGate): per-IP limit, format and
HMAC (forged: 401, zero reads), per-token limit, token row (expired: deleted, 401), then the household (fsGetStrict, mask
`members, deleteAfter, app.babies` plus the route's; failed read 503; non-member: row deleted, 401). Limiters (chosen
here): `WIDGET_RATE_LIMITER` namespace 1008, 30/60 s per IP, keys `wmint:|wrev:|wnap:|wsnap:|wpoke:` + clientIpKey;
`WIDGET_TOKEN_RATE_LIMITER` namespace 1009, 12/60 s, keys `wt:<docId>`, `wph:<hid>`; both fail open (rateLimited,
worker.js:50). One raced-precondition retry after 300 ms, in 10 s.

| Route | Request | Answers |
|---|---|---|
| POST /api/widget/mint (P4) | `{ idToken, hid, deviceId, platform, push? }` | 200 `{ t, expireAt }`; 401 `{error:'unauthorized'}`; 403 `{error:'not_member'}`; 400, 429, 503 |
| POST /api/widget/revoke (P4) | header only | 200 `{ ok:true }` for any token, even unknown; 429 |
| POST /api/widget/nap (P4) | `{ action: 'start'|'stop'|'undo'|'state', babyIds: [1 or 2], starts?: {bid: ms}, undo?: 'start'|'stop' }` | 200 `{ ok:true, already: bool, state, at }`; 200 `{ ok:false, needsApp:true, state, at }`; 409 `{ error:'moved', state, at }`; 403 `{ error:'baby' }`; 401 `{ error:'token' }`; 400, 429, 503 |
| GET /api/widget/snapshot (P5) | header only | 200 `{ snapshot: PullSnapshot, at }`; 401, 429, 503 |
| POST /api/widget/poke (P5) | `{ idToken, hid }` | 200 `{ ok:true, sent: n }`; 401; 403 `{error:'not_member'}`; 429; 503 |

`state` = `{ <bid>: { start, ack } | null }`; `at` = server ms; errors use `error` (403 `{error:'baby'}` replaces spec
6.7's `reason`, chosen here). Every other spec 6.7 and 6.8 rule (server clock, 12 h and 24 h with the 6 h snooze, one
commit for Both, exists:false event create or 2.4's revive, no delete Write, mint transaction) holds.

### 2.9 Silent push (P5)

FCM v1 to each token row with `push`, `hid` equal, `uid` a current member and not the logger:
```
{ "message": { "token": "<push>", "data": { "cubby": "widget-refresh" },
  "apns": { "headers": { "apns-push-type": "background", "apns-priority": "5", "apns-collapse-id": "cubby-widget" },
            "payload": { "aps": { "content-available": 1 } } },
  "android": { "priority": "NORMAL", "collapse_key": "cubby-widget", "ttl": "600s" } } }
```
No `notification` block and no family data, ever. The receiver reloads timelines (iOS) or calls updateAll (Android).
Reminder tokens (users/{uid}.push) are never used, and nothing here turns reminders on.

### 2.10 Gates (names as registered in tools/gates.js)

| Name | Tier and command | Plan | Red run |
|---|---|---|---|
| widget-parity | TREE `node tools/widget_parity_check.js --self-test` | P1 | stale generated file; plants of spec 6.11 |
| widget-snapshot | TREE `node test/widget-snapshot.test.js url` | P1 | an illness name exported; pregnancy to a caregiver; month days during loss holding |
| widget-deeplink | TREE `node test/widget-deeplink.test.js url` | P1 | drop `baby` from the whitelist; initTargets ignores the one-shot list; voice to the paywall; drop `m`; a Pro mark on the month card |
| widget-logger | TREE `node test/widget-logger.test.js url` | P1 | drop stampAuthor in addEvent; name the viewer |
| dose-push-copy | TREE `node test/dose-push-copy.test.js --self-test` | P1 | a medicine name back in one payload |
| nap-offline | TREE `node test/nap-offline.test.js url` | P2 | a blind write while offline |
| timers-rules | EMU `emu: 'node timers-rules.test.js'` | P2 | a non-member write allowed |
| widget-timer-race-emu | EMU `self: ['node', 'test/widget-timer-race-emulator.test.js']` | P2, P4 | blind write; random stop id |
| widget-gen-ios | TREE `node test/widget-gen-ios.test.js --self-test` | P3 | a night hex changed; an intent title as a `WCopy` reference; `voice` in Swift |
| widget-ios-app | TREE `node test/widget-ios-app.test.js` | P3 | nothing tracked; no Health line |
| widget-ios-app-ui | TREE `node test/widget-ios-app.test.js url` | P3 | no `.toast-sub` after an illness starts |
| widget-nap-decide | TREE `node test/widget-nap-decide.test.js` | P4 | start check removed in decideNap; a widget module worker.js does not import directly |
| widget-nap-emu | EMU `self: ['node', 'test/widget-nap-emulator.test.js']` | P4 | the five mutations of spec 6.12 |
| widget-since-parity | TREE `node test/widget-since-parity.test.js --self-test` | P5 | one rule changed in the Worker path; today's month day not counted; the legacy holding branch dropped |
| widget-poke-payload | TREE `node test/widget-poke-payload.test.js` | P5 | a notification block or a baby name added |
| widget-snapshot-emu | EMU `self: ['node', 'test/widget-snapshot-emulator.test.js']` | P5 | membership check removed |
| android-configure | TREE `node test/android-configure.test.js` | P6 | a Capacitor strings.xml in native-android/ not refused |
| android-parity | TREE `node tools/android_parity_check.js --self-test` (out of ALLOW; `--release` runs only inside cap_android_build.sh) | P6 | the :80-81 empty-versions false pass |

Existing gates extended: deploy-excl (P1, native-ios and native-android; red: drop the .assetsignore line),
tracking-plan (P1, P3-P5, every 2.11 event; red: emit one not in the plan), hooks (P6, the key-file guard; red: stage a
dummy .jks), test-wiring (P3, P6; red: a Kotlin test it cannot see). Mac-only (docs/TESTING.md): test_wiring_check
candidates gain `tools/*_check.sh`, `tools/*_smoke.sh`, `native-ios/Tests/*Tests.swift` and
`native-android/app/src/test/java/com/littlecubby/app/widget/*Test.kt`, each ALLOWed with a `ranBy`: each XCTest file
(the `CubbyWidgetTests` scheme) by tools/ios_widget_check.sh, each Kotlin test by tools/android_widget_check.sh;
ios_widget_check.sh and ios_launch_smoke.sh by tools/cap_ios_build.sh, android_widget_check.sh by
tools/cap_android_build.sh. Each is seen red once first.

### 2.11 Instrumentation (chosen here, per the founder's 17 Nov "analytics for everything")

Each event goes into USAGE_EVENTS (workers/usage/core.mjs), .telemetry/tracking-plan.yaml and app/usage-allowlist.js
(tools/gen_usage_allowlist.js). No uid, hid or baby id in a prop; no health, pregnancy or medicine target; nothing in
her own loss holding; platform from the envelope. Worker rows are anon, only while modeOf(env) is 'on'.

| Event | Emitted by | anon | Props | Plan |
|---|---|---|---|---|
| widget.opened | the app's router on a `from` link | false | `from`: widget, shortcut; `target`: feed, sleep, nappy, moment (monthcard, F10), other, none (Home, health, non-log) | P1 |
| widget.setting | the lock-screen switch | false | `setting`: lock_hide; `value`: on, off | P1 |
| widget.installed | the app, once a day per device with any widget | false | `kind`: medium, small, lock; `count`: int 1-20 | P3 |
| widget.nap | the nap route (recordServerEvent, no devices row; core `server: true`, plan `source: server`; /api/usage refuses it from a phone) | true | `action`: start, stop, undo, state; `outcome`: ok, already, moved, needs_app, baby, token, unavailable | P4 |
| widget.refresh | the snapshot and poke routes (server, as widget.nap) | true | `kind`: pull, poke; `outcome`: ok, token, unavailable | P5 |

## 3. Founder steps

| Step | Blocks |
|---|---|
| Submit the current app to App Review without widgets (F1) | nothing here; the widgets ride the next update |
| Yes to each push to main (push = deploy), with any rules publish in the same sitting | P1, P2 (timers rules), P4 (widgetTokens rules), P5 |
| C6: keep or drop the dose notification's "Log it" button once the alert no longer names the medicine | P1 (the C6 change) |
| Apple portal: App ID `com.littlecubby.app.widget`; App Group `group.com.littlecubby.app` on both App IDs (permanent); profiles refreshed | P3 build and export |
| Register a device or add internal TestFlight testers (zero devices, cap_ios_build.sh:7-10) | P3 and P4 on-device proofs |
| Firestore TTL on `widgetTokens.expireAt`: `gcloud firestore fields ttls update expireAt --collection-group=widgetTokens --enable-ttl` (not firebase.json; the nap route refuses and deletes an expired row itself) | P4 live |
| Apple push key (APNs .p8) uploaded to Firebase Cloud Messaging for the iOS app (C5) | P5, so the iOS update |
| Read the br5 flag: Say it stays off iOS; Android only once widget-deeplink proves it never reaches Pro | P6 (Say it only) |
| USAGE_MODE switched on (off since 7ae0fd66) | reading any 2.11 event; no plan's ship |
| Android: a Play developer account (made after Nov 2023: a 12-tester, 14-day closed test); the upload keystore and keystore.properties in ~/.android-keys/; a Firebase Android app `com.littlecubby.app` with upload and Play-signing SHA fingerprints, google-services.json in ~/.android-keys/ (DONE 17 Nov for the upload key; Play-signing fingerprints still to add after the first upload) | P6 sign-in, signing, assetlinks.json, release |

## 4. Ship order, and what is live after each

1. P1, push. Live: every new log carries its author; the new targets work from any link; C6 on the lock screen.
2. P2, push with its rules. Live: running naps in their own record, for every family. Soaks a release; P3 builds alongside.
3. P3, TestFlight only: Phase A on testers' iPhones, nothing in the App Store.
4. P4, push (routes live, unused until a Phase B binary mints), rules and the TTL command. TestFlight Phase B.
5. P5, push and the push key. TestFlight A + B + F2, then App Review; on approval, iPhone widgets are live.
6. P6, after the Android founder steps: closed test, then production; the iOS-only window ends at `platforms.android` "on".
