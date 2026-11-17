# Home-screen widgets, P1 web foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the web app's and the Worker's half of the home-screen widgets, inert on the web except C6: every new log carries its author, widget links open the right sheet for the right baby, one copy and rules source feeds a generator, a reference model and a parity gate, the app exports a typed snapshot (each baby's next two month days included, F10) and wipes it on every exit from a family, a month-day link opens the month card the app already has, and dose reminders stop naming the medicine.

**Architecture:** One hand-written rules module (`workers/shared/since-rules.mjs`) and one copy and rules file (`docs/widgets/widget-copy.json`) feed `tools/widget_gen.js`, which writes every derived file (browser copy, Worker rules, Swift, Kotlin, Android strings, golden fixtures); `tools/widget_model.js` turns a fixture input into the exact view model P3 and P6 must draw. The app builds the snapshot in `app/widget-snapshot.js`, hands it to a Capacitor bridge that resolves null on the web, and routes `?go=&baby=&from=` through the existing deep-link router. The Worker rewrites dose reminder copy itself, so no cached client can put a medicine name back.

**Tech Stack:** vanilla JS (inline script in `app/index.html`, `app/*.js`, Firebase compat SDK in `app/store-firebase.js`), Cloudflare Worker ESM (`worker.js`, `workers/**/*.mjs`), Node test scripts with `puppeteer-core` from `tools/node_modules`, Ruby YAML (the tracking-plan gate), `tools/gates.js`.

**Spec:** /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/specs/2026-11-16-home-screen-widgets-design.md (and the roadmap /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/plans/2026-11-17-widgets-0-roadmap.md, whose section 2 names are binding).

## Contract notes

Notes 1-9 and 11-16 are accepted into roadmap section 2 (17 Nov); each keeps the roadmap's names and signatures and records a rule or an addition the real code needs. Note 10 is a reading of the contract, not a change. Note 17 lists accepted changes another plan carries out. Note 18 is F10's fixed contract (roadmap 2.2, 2.3, 2.5, 2.7, 2.11) and this plan's readings where it is silent.

1. **`babyAnchors` picks the newest by `time`, not by `sinceAnchor`** (2.2). Home picks `evs.find(...)` over `babyEvents()`, which is sorted by `time` descending (index.html:2099, :4087-4089), and only then takes `sinceAnchor`. "Newest by sinceAnchor" disagrees with Home whenever a long feed overlaps a later short one (a 40-minute breastfeed from 1:00 and a bottle at 1:30: Home shows 1:30, the old rule 1:40). Rule: newest by time (babyEvents' order), anchored by sinceAnchor.
2. **`applyDeepLinkBaby(baby)` runs before the open, not after** (2.7). Every open reads `activeBaby()` for its defaults (openFeed's last method and amount, openPump's last unit, index.html:5745-5750, :6535-6539) and calls `initTargets()`. It sets `activeBabyId` (one known id) and arms a one-shot target list that `initTargets()` (index.html:2323) consumes, so Both survives every open with no redraw; the red run is "initTargets ignores the one-shot list". A link with `baby` and no `go` (the widget body, P3 note 6) sets the active baby, disarms the list and stays on Home. Signature unchanged: `applyDeepLinkBaby(baby: string|null) -> void`.
3. **ViewModel `row.day` carries any fixed second line** (2.3): the day word over 20 hours, and "since 2:40 AM" under a running nap.
4. **ViewModel rows gain `a11y: string`** (2.3). Spec 6.11 makes the VoiceOver and TalkBack status labels fixture data ("Robin's last feed, 2:10 AM").
5. **Fixtures are in UTC** (2.3). widget-fixtures.json = `{ source, tz: "UTC", fixtures, napCases }`; `renderModel` formats every clock, day and date in UTC whatever the machine's zone, and P3's XCTest and P6's Kotlin goldens set their zone from `tz` (production draws in the device zone).
6. **`workers/shared/widget-rules.mjs` and `window.CubbySince` also export `SNAPSHOT_VERSIONS`** (2.2, from `snapshot.versions`): `buildWidgetSnapshot` needs the web's versions for `widgetVersion(web, binary)`.
7. **`stampAuthor` covers eight doors** (2.4): addEvent, commitEvent (the targets path), stopFeed, saveFeedCorrect, stopSleep, saveSleepCorrect, toggleRoutine and setBirthWeight (which today stamps `myUid()`, so `'local'` when signed out). pushNow adds an author only on create.
8. **`SnapshotCtx.chosen` is `QUICK_DEFAULTS.child` in the child stage** (2.2, spec 6.10), `quickChosen(stage)` otherwise.
9. **The iOS stack helper is a declared difference, and "total" is banned** (2.3). Key `app.stackHelp`, `on: ["app"]`, platforms `["ios"]` (Smart Rotate exists only on iOS; P3 shows it in Settings and reads it from `CubbyWidgetCopy`, which holds only `app` keys). `banned` gains "total" (spec 6.11 "no streak or total words").
10. **Placeholders stay the contract's six.** The age number uses `{age}` ("{age} months old") and a date uses `{day}` as the day of the month inside one key per month ("{day} Oct"), so no `{n}` or `{month}` is needed.
11. **`rules.pendingMs: 10000`** (2.3; spec 6.7 steps 2 and 7). A pending younger than it only dims the button; from 10 s on the line reads "Checking". 10 s is perform()'s budget.
12. **ViewModel gains a top-level `url: string`, the widget body link** (2.3; spec 6.5, 6.7 step 6): `?baby=<id>&from=widget` when the widget shows one baby, `?from=widget` otherwise, and `?go=sleep&baby=<id|both>&from=widget` while a noConnection or notSaved line shows. P3 and P6 draw it; P4 Task 10 owns the iOS failure-line case through it.
13. **Intents and widths** (2.3). A start intent is `{ action: 'start', babyIds }` with no `starts` key; `FixtureInput.cellWidth` is fractional (87.5; Double in Swift and Kotlin).
14. **`window.__cubbyHasWidgets` caches the plugin's whole answer** (2.2, 2.6): `{ value, kinds: { medium, small, lock } }`, `false` on the web. The lock-screen switch shows only when `value === true` on iOS, since Android has no lock-screen widget (P3 note 8, P6 note 4 adjusted).
15. **`napCases`** (2.3; P4 note 8, P6 note 6). widget-copy.json reserves `napCases: []`, the nap reply to napState table that P4 Task 9 fills; the generator copies it into widget-fixtures.json so Swift NapReducerTests and Kotlin NapReducerTest read one file.
16. **Kotlin `WCopy.byKey: Map<String, Int>`** (2.3; P6 note 3) is emitted here (Task 6). `WColor`/`WColors`, Swift `WCopy.text(_ key:) -> String?` and the `#if CUBBY_WIDGET_EXT` AppIntent metadata are P3 Task 2's additions to the same generator; Generated.swift stays exempt from parity section 5 as a generated file.
17. **Carried out by other plans, so P1 leaves room for them.** P5 moves `widgetByLabel`'s body into since-rules.mjs as `byLabel` and makes `widgetByLabel` delegate (write it here as a pure function of its four arguments); P5 adds `pullMinMs: 600000` and `pullEveryMs: 3600000` to `rules`, and replaces M3 with `mergeSources` (its Task 7 table, per-field `asOf`). P5 also fills PullSnapshot babies' `moments` through `monthMoments` (F10, note 18); P3 and P6 draw `header.moment` in the honey ink with its star.
18. **F10 month days (founder, 17 Nov, fixed).** P1 builds `monthMoments` (Task 3), SnapshotBaby `moments` (Tasks 3, 8), M15 and `header.moment` (Task 5), the monthcard body `url` (Task 5), the sixteen `moment` keys (Task 4), the `monthcard` target and the bridge's `m` (Task 7), and widget.opened's `moment` target (Task 2), with the names and values of Global Constraints. Readings chosen here where the contract is silent: (a) M15 runs only in mode `full` (a stale message keeps M4's header as it is; small has no label line to put it in); (b) a long nap's `ask` keeps the medium's age slot (M6), so `header.moment` is null while `ask` is set; (c) the body `url` follows `header.moment`: monthcard only when it is non-null, so never on a lock family, during the ask or for twins whose days differ, and the failure-line sleep link still comes first; (d) twins with both: `a11y` is each baby's `a11y.moment.*` joined by `names.and` ("Robin is 3 months old today and Wren is 3 months old today"), since "{names} is" would not be English; (e) `header.age` keeps the age text, which the natives draw wherever they hide `moment` (StandBy, Mac, iPad lock screen); (f) small's `header.moment.text` is the whole label line and its row is unchanged; (g) since-rules may not name lossHolding (A9), so `snapshotBaby` always fills `moments` and `buildWidgetSnapshot` empties them under `ctx.lossHolding`; (h) the router swallows `monthcard` whenever `myLossHolding()` is set, a living child or not, before widget.opened counts it (the general swallow at :2757 covers only a family with no baby); (i) `m` reaches openMonthCard as a number, because openMemoryCard (index.html:19160) falls back to the baby's age for anything else.

## Global Constraints

- Rules, exactly: `staleMs 21600000, napAskMs 43200000, napMaxMs 86400000, ackFreshMs 21600000, dayRuleMs 72000000, healthReturnMs 1209600000, twinsToleranceMs 86400000, undoMs 10000, lineMs 900000, restampMs 600000, futureStartMs 300000, pendingMs 10000, nameMax 20, byMax 12, shortcutsMax 4, asleepNowMinWidth 84` (P5 later adds `pullMinMs 600000, pullEveryMs 3600000`).
- Defaults: `{ "medium4": "activity", "small": ["sleep", "feed"] }`. Snapshot `versions: [1]`. Platforms `{ "ios": "on", "android": "pending" }`.
- `banned: ["don't forget", "last chance", "time for", "streak", "goal", "total", "Pro"]`; `properNouns: ["Cubby", "Smart Rotate", "AM", "PM"]` plus every QUICK_ACTIONS label; placeholders only `{name} {names} {time} {day} {by} {age}`.
- Link: `https://little-cubby.com/app/?go=<go>&baby=<babyId|both>&m=<1..600>&from=<widget|shortcut>`, keys in that order, `m` only with `go=monthcard`; `baby` matches `^[A-Za-z0-9_-]{1,64}$` or is `both`; `m` is an integer 1..600 (`^[1-9][0-9]{0,2}$`, at most 600); anything else is dropped silently. Widget body: `?baby=<id>&from=widget` for one baby, `?from=widget` otherwise, `?go=sleep&baby=<id|both>&from=widget` while a noConnection or notSaved line shows (spec 6.5), and on a month day with no such line `?go=monthcard&baby=<id>&m=<total months>&from=widget` (F10).
- F10 month days, fixed (spec "Founder decisions", 17 Nov): month days on the widget, nothing else.
  - `monthMoments(birthTs: number, now: number, count = 2) -> Array<{ at: number, unit: 'month'|'year', n: number }>` in workers/shared/since-rules.mjs and app/since-rules.js: the next `count` month days whose day starts at or after the local midnight of `now`'s day (today's counts); app/index.html:3309's arithmetic (months since birth with the day-of-month rule; `mark = new Date(birth); mark.setMonth(birth month + m)`), `at` = local midnight of the mark's day; m 1-11 and 13-23 → `{ unit: 'month', n: m }`, m 12 → `{ unit: 'year', n: 1 }`, m ≥ 24 only when `m % 12 === 0` → `{ unit: 'year', n: m / 12 }`, every other m skipped; `[]` with no birth.
  - SnapshotBaby `moments: [{ at, unit, n }]`, at most 2; `[]` when the baby has no birth, during loss holding (`myLossHolding()`), or when `state` is not `ok`.
  - M15: a moment is active when `m.at <= now < m.at + 86400000`; ViewModel `header.moment: { text: string, a11y: string } | null`; medium shows `moment.text` in the age slot; twins: one line "{names} · 3 months today" when both have an active moment with the same unit and n, that baby's name with it when only one does, otherwise null; small's label line reads "{name} · 3 months today" instead of "{name} · last feed", and the line under the clock gains the type ("last feed", plus " · {by}" per F7); lock families always null. Natives hide it off the home screen (StandBy, Mac, iPad lock screen) as they hide `by`.
  - Copy, whole strings, `{age}` for the number: `moment.month1` "1 month today", `moment.months` "{age} months today", `moment.year1` "1 year today", `moment.years` "{age} years today"; `small.moment.*` and `twins.moment.*` the same after "{name} · " and "{names} · "; `a11y.moment.month1` "{name} is 1 month old today", `.months` "{name} is {age} months old today", `.year1` "{name} is 1 year old today", `.years` "{name} is {age} years old today".
  - Router `monthcard` + `m`: applyDeepLinkBaby, then openMonthCard(m, memCandPhoto(m)) (index.html:3077), no Pro mark; swallowed during loss holding; native-bridge whitelist gains `m`. widget.opened `target` gains `moment`.
  - Not built: the 6 October takeover card ("Robin is 3 months old today" with "Make a card"), marked firsts, comparisons, streaks.
- widget-fixtures.json is `{ "source": <sha256 of widget-copy.json>, "tz": "UTC", "fixtures": [...], "napCases": [...] }`, the same bytes whatever the machine's zone.
- `window.__cubbyHasWidgets` is the plugin's whole `hasWidgets()` answer `{ value, kinds: { medium, small, lock } }`, or `false` on the web, with no plugin or no method.
- Customer copy: DESIGN.md §A1 and §A7, warm, brief, second person, sentence case, no em-dashes. Widget copy lives in `docs/widgets/widget-copy.json` only; generated files are the only other place it appears.
- The snapshot carries typed fields only; a baby's display name is its only free text. No Pro field, photo, illness detail, mood, notes or medicine, ever. `pregnancy` is always `null` (F4). No pregnancy shortcut (F4).
- An author is the signed-in uid or nothing, never `'local'`. No uid, hid or baby id in any usage event property. First-party events only (D8).
- `workers/shared/` is scanned by test/admin-no-content.test.js:171-182: no file there may contain the word `lossHolding` or a Firestore write call.
- Every clock-pinned test pins the day and the zone: `page.emulateTimezone('UTC')` plus a `Date` shim on a fixed instant (the shim at tools/getstarted_author_check.js:132-137), never "today at 13:00".
- Every browser test takes the base URL from tools/gates.js, then fetches the served `app/index.html` (and any changed `app/*.js`) and asserts the change's marker is there before grading (tools/getstarted_author_check.js:123-126).
- Commits: `git add <new files>` then `git commit -o <every path> -m "<subject>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Never `git add -A`. A commit that stages any file in app/sw.js `ASSETS` (app/index.html, app/*.js listed there) also bumps `CACHE` in app/sw.js:3: re-read app/sw.js and set one above what it says at that moment.
- No step pushes and none publishes rules: those are FOUNDER STEP lines. Nothing is deleted (tests remove only the temp folders they made under `os.tmpdir()`).

## Review Focus

1. **A wipe followed by a late export.** The 400 ms debounce fires after a sign-out, a family switch or a deletion and writes the previous family's babies back onto glass. Expected: after `widgetWipe`, nothing is written until a fresh household boot. Test: Task 8, Section C3.
2. **A render storm.** A running feed or nap timer repaints every second; if each paint writes, iOS's daily reload budget is gone by 3am and the widget stops moving. Expected: one write per real change, plus one re-stamp per `restampMs` while live. Test: Task 8, Section C1-C2.
3. **Names that are long, emoji, non-Latin, or an email.** A cut through a surrogate pair draws a broken glyph; an email in memberInfo lands on a home screen. Expected: 20 whole code points for a baby, 12 for a circle label, never an `@`. Tests: Task 3 Section A6 (baby name), Task 8 Section A2 (circle label).
4. **A link naming a baby this family does not have.** A deleted baby, a twin id from the account that was signed in before, `both` in a one- or three-baby family, or junk. Expected: the active baby, silently, never All, never an error. Test: Task 7, Section B5.
5. **An owner edits an older entry that has no author.** pushNow's fallback (store-firebase.js:3340) stamps the editor, so Dad's widget then reads "Last feed · Mum" on a feed Dad logged. Expected: only a create is stamped. Test: Task 1, Section 2.
6. **A month day during a loss, or on the wrong day.** A "3 months today" on glass the week a twin was lost, or a birth on the 31st celebrated on a day the app does not (F10). Expected: no `moments` while `myLossHolding()` is set, even beside a living child, a monthcard link swallowed then, and the day the app's own setMonth arithmetic gives. Tests: Task 8 Section B6, Task 7 B11, Task 3 A10.

## File map

| Path | Task | Role |
|---|---|---|
| app/index.html | 1, 3, 4, 7, 8, 9, 10 | stampAuthor; QUICK_ACTIONS widget fields; router targets (`monthcard` included); export, wipes; lock-hide; C6 client copy |
| app/store-firebase.js | 1, 8, 9 | eventForPush; LL.live, LL.liveAt, LL.hhBooted; wipe hooks; users/{uid}.widget read |
| app/native-bridge.js | 7 | window.cubbyWidget (`__cubbyHasWidgets` = the whole answer); `baby`/`from`/`m` whitelist; launch URL once |
| app/since-rules.js, workers/shared/widget-rules.mjs | 3 (GENERATED) | browser and Worker copies of the rules |
| workers/shared/since-rules.mjs | 3 | anchors, health switch, twins, age, month days (`monthMoments`), sleep ids |
| app/widget-snapshot.js | 8 | snapshot builder (`moments` emptied in loss holding), shortcuts, by-label, version |
| docs/widgets/widget-copy.json, widget-fixtures.json | 3, 4, 5 | source (rules, strings, cases, `napCases`); GENERATED fixtures `{ source, tz, fixtures, napCases }` |
| tools/widget_gen.js, tools/widget_model.js, tools/widget_parity_check.js | 3-6 | generator, model, gate |
| native-ios/CubbyWidget/Generated.swift, native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt, native-android/app/src/main/res/values/widget_strings.xml | 6 (GENERATED) | native constants |
| worker.js, app/sw.js | 10 | C6 copy |
| workers/usage/core.mjs, .telemetry/tracking-plan.yaml, app/usage-allowlist.js, tools/tracking_plan_check.js | 2 | widget.opened (target `moment` included), widget.setting |
| DESIGN.md, .assetsignore, tools/deploy_exclusion_check.js | 6 | night pairs; deploy fence |
| test/widget-logger.test.js, test/widget-snapshot.test.js, test/widget-deeplink.test.js, test/dose-push-copy.test.js, test/blob-sync.test.js, tools/gates.js | 1-10 | gates |

## Before Task 1 (once, not a task)

- [ ] In `/Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c`: `git fetch origin && git status --short` shows only untracked docs under docs/superpowers/. If origin/main moved, `git rebase origin/main` (this branch has no commits of its own yet). Line numbers below are for 58733b16; after a rebase, find each by the function or text it names.
- [ ] Lane L (fix7-L, v371, the native sign-in link loop) also clears the launch URL. `grep -n "getLaunchUrl" app/native-bridge.js`: if a once-per-process guard is already there, Task 7 reuses its key; otherwise Task 7 adds `cubby-launch-done`.
- [ ] `ls tools/node_modules/puppeteer-core >/dev/null && echo linked` prints `linked`; `grep -o "little-log-v[0-9]*" app/sw.js` prints the CACHE every bump below counts up from.

---

### Task 1: Every new log carries its author (F7)

**Files:**
- Modify: `app/index.html:2308-2319` (addEvent; add `stampAuthor` just above it), `:2451` (commitEvent's per-target push), `:5893` (stopFeed), `:5970` (saveFeedCorrect), `:6242` (stopSleep), `:6287` (saveSleepCorrect), `:16192` (setBirthWeight), `:17996` (toggleRoutine)
- Modify: `app/store-firebase.js:3313-3345` (pushNow; add `eventForPush` above it at :3312, call it at :3340)
- Modify: `app/sw.js:3`, `tools/gates.js` (new `TREE.push(` block after :279)
- Create: `test/widget-logger.test.js`

**Interfaces:**
- Produces: `stampAuthor(ev: Event) -> Event` (index.html global). Sets `ev.authorId = window.LL.auth.currentUser.uid` when someone is signed in and `ev.authorId` is falsy; otherwise leaves `ev` untouched. Never writes `'local'`.
- Produces: `eventForPush(ev: Event, isCreate: boolean, uidNow: string|null) -> object` (store-firebase.js, IIFE scope, lifted by tests). Create: `Object.assign({ authorId: ev.authorId || uidNow }, ev)` (today's line 3340). Update: a shallow copy of `ev` with nothing added. pushNow computes `isCreate = knownEvents[id] === undefined` before `knownEvents[id] = ser`.
- Consumed by: Task 8 (`by` labels read `authorId`), P4 (the Worker stamps its own).

- [ ] **Step 1: Write the failing test `test/widget-logger.test.js`**

Section 1 (browser, `node test/widget-logger.test.js <base>`): seed the ?e2e=1 app with babies b1, b2, a sleep timer and a breast-feed timer on b1 started 40 minutes earlier, and a ritual; assign `window.LL.auth = { currentUser: { uid: 'uMum' } }` onto the existing LL (as `asMember` at tools/getstarted_author_check.js:160-167 does). Drive each door through its global and read the newest matching event:

```js
ok('addEvent stamps the signed-in uid', ev.authorId === 'uMum');
ok('commitEvent stamps every target (Both)', two.length === 2 && two.every((e) => e.authorId === 'uMum'));
ok('stopSleep stamps', sleepEv.authorId === 'uMum');
ok('saveSleepCorrect stamps', correctedEv.authorId === 'uMum');
ok('stopFeed and saveFeedCorrect stamp', feedA.authorId === 'uMum' && feedB.authorId === 'uMum');
ok('toggleRoutine stamps', ritualEv.authorId === 'uMum');
ok('setBirthWeight stamps the uid, not local', bw.authorId === 'uMum');
ok('an existing author is kept', kept.authorId === 'uDad');
// window.LL.auth = null, then addEvent and setBirthWeight:
ok('signed out: no authorId key at all, never local', !('authorId' in a) && !('authorId' in b));
```

Section 2 (Node): lift `eventForPush` and `pushNow` from app/store-firebase.js with the brace-matching `lift()` of test/blob-merge.test.js:23-32 and run `eventForPush` in a `vm` context:

```js
ok('create without author: the writer', f({ id: 'e1' }, true, 'uMum').authorId === 'uMum');
ok('update without author: still none (no back-fill, Review Focus 5)', !('authorId' in f({ id: 'e2' }, false, 'uMum')));
ok('update keeps an author', f({ id: 'e3', authorId: 'uDad' }, false, 'uMum').authorId === 'uDad');
ok('create keeps an author', f({ id: 'e4', authorId: 'uDad' }, true, 'uMum').authorId === 'uDad');
ok('pushNow decides create before it records the write',
   push.indexOf('isCreate') > -1 && push.indexOf('isCreate') < push.indexOf('knownEvents[id] = ser'));
```

End with `WIDGET-LOGGER: PASS|FAIL` and exit 1 on any failure. Register `{ name: 'widget-logger', cmd: ['node', 'test/widget-logger.test.js', 'url'] }` in a new `TREE.push(` block after tools/gates.js:279, headed `/* Home-screen widgets, P1 (docs/superpowers/plans/2026-11-17-widgets-1-web-foundations.md). */`.

- [ ] **Step 2: Run it and see it fail**

Run: `node tools/gates.js --only=widget-logger`
Expected: FAIL; Section 1 fails on every door but "an existing author is kept" (today only pushNow stamps, on the server copy), and the signed-out setBirthWeight carries `'local'`; Section 2 fails "app/store-firebase.js has eventForPush".

- [ ] **Step 3: Implement `stampAuthor` and `eventForPush`**

Wrap each of the eight pushes in `stampAuthor(...)` (addEvent stamps before `state.events.push`; commitEvent stamps each copy). setBirthWeight drops `authorId:myUid()` for `stampAuthor`. Bump CACHE.

- [ ] **Step 4: Run it and see it pass**

Run: `node tools/gates.js --only=widget-logger` then `node tools/gates.js --only=getstarted,blob-merge,quick-close,sleep-timer,ritual-flow,birth-weight`
Expected: `WIDGET-LOGGER: PASS`; the others PASS (getstarted's "unstamped counts as mine" rule still holds for older entries).

- [ ] **Step 5: See the roadmap's red run**

Remove `stampAuthor(` from addEvent only, rerun `--only=widget-logger`: FAIL "addEvent stamps the signed-in uid". Restore.

- [ ] **Step 6: Commit**

```bash
git add test/widget-logger.test.js
git commit -o app/index.html app/store-firebase.js app/sw.js tools/gates.js test/widget-logger.test.js -m "Every new log carries who made it, stamped at write and never as local, and an edit names no new author" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The two P1 usage events, and the app may only emit what the plan lists

**Files:**
- Modify: `workers/usage/core.mjs:48-63` (USAGE_EVENTS), `.telemetry/tracking-plan.yaml:4-6` (header counts) and `:575-583` (append after install.prompted), `app/usage-allowlist.js` (regenerate), `tools/tracking_plan_check.js:58-59` (INPUTS), `:453` (STAGES), a new section 13 at the end of `judge()`, `app/sw.js:3`

**Interfaces:**
- Produces: `widget.opened { anon: false, props: { from: e('widget', 'shortcut'), target: e('feed', 'sleep', 'nappy', 'other', 'none', 'moment') } }` and `widget.setting { anon: false, props: { setting: e('lock_hide'), value: e('on', 'off') } }`. Emitted by Task 7 (router) and Task 9 (the switch) through `window.cubbyTrack(name, props)`. `moment` is the `monthcard` target (F10); in the plan it is `{ name: target, type: string, enum: [feed, sleep, nappy, other, none, moment] }`.

- [ ] **Step 1: Write the failing stagings**

Add to STAGES: `['the app emits an event the plan does not list', 'every event the app emits is planned', [[I, "window.cubbyTrack('feature.used',{feature:'report',action:'opened'})", "window.cubbyTrack('widget.unplanned',{feature:'report',action:'opened'})"]]]` with `I = 'app/index.html'`, and `['the plan drops widget.opened\'s moment target', 'widget.opened.target: same values in plan and core.mjs', [[P, 'enum: [feed, sleep, nappy, other, none, moment]', 'enum: [feed, sleep, nappy, other, none]']]]` (F10: the month-day value held equal in plan and core.mjs), and add `app/index.html`, `app/native-bridge.js`, `app/store-firebase.js`, `app/cubby-track.js`, `app/voice-log.js` to INPUTS.

- [ ] **Step 2: Run it and see it fail**

Run: `node tools/gates.js --only=tracking-plan`
Expected: FAIL "not caught: the app emits an event the plan does not list (the gate passed)" and "not caught: the plan drops widget.opened's moment target" (its search text is not in the plan yet).

- [ ] **Step 3: Implement section 13 and the events**

Section 13 reads every INPUTS file under `app/` except usage-allowlist.js, collects `cubbyTrack\(\s*'([a-z_.]+)'` (and `\btrack\(\s*'([a-z_.]+)'` inside cubby-track.js), and fails `every event the app emits is planned` naming any name outside `core.USAGE_EVENTS`. A companion fails `every emitting file is read` if a real `app/*.js` containing `cubbyTrack(` is missing from INPUTS. Add both events to core.mjs and to the plan's `linked_usage.events` (`source: new`, `before_sign_in: false`, `fires_when` and `how` in one sentence each, widget.opened's `how` naming `moment` as the month-card link of F10; quote the values `enum: ['on', 'off']`, because Ruby's YAML reads bare on/off as booleans). Header: "13 of the 18 linked events are sent by a device, 4 are derived and 1 is written by the server". `node tools/gen_usage_allowlist.js`. Bump CACHE.

- [ ] **Step 4: Run it and see it pass**

Run: `node tools/gates.js --only=tracking-plan,usage-` 
Expected: `TRACKING-PLAN SELF-TEST: PASS` with "caught: the app emits an event the plan does not list" and "caught: the plan drops widget.opened's moment target", `grep -c '"moment"' app/usage-allowlist.js` prints 1 (the screen `"moments"` does not match), and every usage gate PASS.

- [ ] **Step 5: Commit**

```bash
git commit -o workers/usage/core.mjs .telemetry/tracking-plan.yaml app/usage-allowlist.js tools/tracking_plan_check.js app/sw.js -m "Usage events widget.opened and widget.setting, planned and allowlisted, with the month-day target, and the app may emit only what the plan lists" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One since-rules module for the app and the Worker

**Files:**
- Create: `docs/widgets/widget-copy.json` (schema, snapshot, platforms, the sixteen rules, defaults; `strings: {}`, `differences: []`, `banned` with "total", `properNouns`, `cases: []`, `napCases: []` for P4 Task 9), `workers/shared/since-rules.mjs`, `tools/widget_gen.js`, generated `workers/shared/widget-rules.mjs` and `app/since-rules.js`, `test/widget-snapshot.test.js` (Section A)
- Modify: `app/index.html:19897` (add `<script defer src="since-rules.js"></script>` before native-bridge.js), `app/sw.js:3` and `:27` (add `'/app/since-rules.js',` after native-bridge), `tools/gates.js` (P1 block)

**Interfaces:**
- Produces (roadmap 2.2, exact): `sinceAnchor(type, ev) -> number`, `babyAnchors(events, babyId) -> {feed, sleep, nappy}`, `healthOpen(illnesses, events, babyId, now) -> boolean`, `isTwins(babies) -> boolean`, `ageOf(birth, now) -> {unit, n}|null`, `monthMoments(birthTs: number, now: number, count = 2) -> Array<{ at: number, unit: 'month'|'year', n: number }>` (F10), `sleepEventId(babyId, start) -> string`, `snapshotBaby({ baby, events, illnesses, nap, now, label }) -> SnapshotBaby`; `RULES`, `DEFAULTS`, `SNAPSHOT_VERSIONS` from `./widget-rules.mjs`.
- Produces: `window.CubbySince = { the eight functions, RULES, DEFAULTS, SNAPSHOT_VERSIONS }`, `window.CubbyWidgetCopy = { [key]: text }` for every string whose `on` includes `"app"`.
- Produces: `tools/widget_gen.js`: `generate(root: string) -> { [relPath]: string }` (module.exports); CLI `node tools/widget_gen.js` writes, `--check` exits 1 printing each differing path. This task generates the two JS files; Tasks 5 and 6 extend the map.
- Consumed by: Task 8, P2 (`sleepEventId`), P5 (the Worker imports since-rules.mjs; buildPullSnapshot fills PullSnapshot `moments` through `monthMoments`).

Rules the code must follow:
- `sinceAnchor` is index.html:5151-5156 to the letter.
- `babyAnchors`: events with `babyId` equal and not `deleted`, ordered by `time` descending; feed = first `type 'feed'`, sleep = first `type 'sleep'` with `end`, nappy = first `type 'diaper'` (contract note 1).
- `healthOpen`: some illness of that baby with no `endedAt` whose newest entry, `max(startedAt, time of that baby's non-deleted 'temperature' | 'symptom' | 'medicine' events)`, is newer than `now - RULES.healthReturnMs` (F5).
- `isTwins`: exactly two babies, both `birth` finite, `|a.birth - b.birth| <= RULES.twinsToleranceMs`.
- `ageOf` mirrors ageString (index.html:2221-2232): null for no birth or negative days; `<14` day, `<60` week `floor(d/7)`, `<730` month `floor(d/30.44)`, else year `floor(d/365)`.
- `monthMoments` (F10) is monthiversary's arithmetic (index.html:3309-3320) in local time: `[]` when `birthTs` is not finite or `count < 1`; `m0` = `(now year - birth year) * 12 + (now month - birth month)`, minus 1 when `now`'s day of month is below the birth's (index.html:3314-3315); for m from `max(1, m0 - 1)` upward, `mark = new Date(birthTs); mark.setMonth(new Date(birthTs).getMonth() + m)` (so a 31 January birth's month 1 is 3 March in a common year, as the app's own card), `at = new Date(mark.getFullYear(), mark.getMonth(), mark.getDate()).getTime()`; keep it when `at >= ` the local midnight of `now`'s day and m maps (1-11 and 13-23 `{ unit: 'month', n: m }`, 12 `{ unit: 'year', n: 1 }`, at least 24 with `m % 12 === 0` `{ unit: 'year', n: m / 12 }`, every other m skipped); stop at `count`. Marks rise strictly with m, so the scan never misses one. It never names lossHolding (A9); the snapshot builder empties `moments` (Task 8).
- `snapshotBaby`: key order of roadmap 2.5, `moments` last; `name` = first `RULES.nameMax` code points of the trimmed name (`Array.from`); `by.<k>` = `label(anchor.authorId)` or null; `nap` = `{ start, ack: finite ack or null }` when `nap.start` is finite, else null; `moments` = `monthMoments(baby.birth, now)`.
- The generator writes `app/since-rules.js` as a header line ("GENERATED by tools/widget_gen.js from workers/shared/since-rules.mjs and docs/widgets/widget-copy.json. Do not edit."), one IIFE holding the three constants as literals and the module body with its import line removed and `export ` stripped, then the two `window` assignments. Output is byte-stable: sorted keys, no dates.

- [ ] **Step 1: Write the failing test, Section A of `test/widget-snapshot.test.js`**

Section A runs in Node (`await import()` of since-rules.mjs; app/since-rules.js run in a `vm` with a `window` object) and asserts every case twice, once per copy, plus `deepEqual` between them. Helpers: `DAY = 86400000`, `NOW = Date.UTC(2026, 10, 17, 3, 14)`; `ill(d, x)` is `[{ id: 'i1', babyId: 'b1', startedAt: NOW - d * DAY, ...x }]`; `temp(d, x)` is `{ id: 't' + d, type: 'temperature', babyId: 'b1', time: NOW - d * DAY, ...x }`; `H(ills, evs, bid = 'b1')` is `mod.healthOpen(ills, evs, bid, NOW)`; `kid(id, birth)` is `{ id, name: id, birth }`; `T(a, b)` is `isTwins` of two babies born at hh:mm `a` on 16 Nov and hh:mm `b` on 17 Nov (UTC). For F10: the file's first statement is `process.env.TZ = 'UTC'` (fixtures are in UTC, roadmap 2.3, and monthMoments works in local time; Node re-reads TZ on assignment); `U = Date.UTC`; `MM(birth, now = NOW, count)` is `mod.monthMoments(birth, now, count)`; `ROBIN = U(2026, 7, 17, 9, 0)` (born 17 Aug, a later hour than NOW's 03:14); `mo(y, m, d, unit, n)` is `{ at: U(y, m, d), unit, n }`; `appMv(birth, at)` lifts `monthiversary` from app/index.html into a `vm` whose `activeBaby()` returns `{ birth }` and whose `Date` with no arguments is `at` (the shim of tools/getstarted_author_check.js:132-137):

```js
ok('A1 sinceAnchor equals Home (lifted index.html:5151)', cases.every((c) => mod.sinceAnchor(c.t, c.ev) === home(c.t, c.ev)));
ok('A2 a deleted newer feed is ignored', a.feed.id === 'f-old');
ok('A2 an open sleep is ignored; the ended one counts', a.sleep.id === 's-ended');
ok('A2 newest by time, as Home: bottle at 1:30 beats a feed from 1:00 lasting 40 min', b.feed.id === 'bottle-130');
ok('A3 open, started 3 days ago', H(ill(3), []) === true);
ok('A3 open, started 20 days ago, no entries since: Health goes back (F5)', H(ill(20), []) === false);
ok('A3 the same with a temperature 2 days ago', H(ill(20), [temp(2)]) === true);
ok('A3 a deleted temperature does not count', H(ill(20), [temp(2, { deleted: true })]) === false);
ok('A3 an ended illness: false', H(ill(3, { endedAt: NOW - DAY }), []) === false);
ok('A3 another baby: her illness is not his, her temperature does not reopen his',
   H(ill(3, { babyId: 'b2' }), []) === false && H(ill(20), [temp(2, { babyId: 'b2' })]) === false);
ok('A3 the 14-day edge: 1 ms inside is open, exactly 14 days is closed',
   H(ill(0, { startedAt: NOW - 1209600000 + 1 }), []) === true && H(ill(0, { startedAt: NOW - 1209600000 }), []) === false);
ok('A4 twins born 23:50 and 00:10', T(2350, 10) === true);
ok('A4 exactly 24h apart: twins; 24h + 1ms: siblings', T24 === true && T24p1 === false);
ok('A4 three babies born together: never twins', mod.isTwins([kid('b1', NOW), kid('b2', NOW), kid('b3', NOW)]) === false);
ok('A4 a missing or non-finite birth: never twins', mod.isTwins([kid('b1', NOW), kid('b2', null)]) === false
   && mod.isTwins([kid('b1', NOW), kid('b2', undefined)]) === false && mod.isTwins([kid('b1', NOW), kid('b2', NaN)]) === false);
ok('A4 one baby: never twins', mod.isTwins([kid('b1', NOW)]) === false);
ok('A5 ageOf at days 0,1,13,14,59,60,729,730 reads as ageString does', words.every((w) => w.ours === w.home));
ok('A6 25 emoji become 20 whole code points (Review Focus 3)', Array.from(n).length === 20 && !LONE_SURROGATE.test(n));
ok('A6 an Arabic name is kept', s.name === 'ريم');
ok('A7 sleepEventId', mod.sleepEventId('b1', 1700000000000) === 'sleep-b1-1700000000000');
ok('A8 RULES equal widget-copy.json, pendingMs included', deepEqual(mod.RULES, copy.rules) && mod.RULES.pendingMs === 10000);
ok('A9 since-rules.mjs and widget-rules.mjs never mention lossHolding or fetch(', clean);
// F10 month days. NOW is 17 Nov 2026 03:14 UTC.
ok('A10 the day itself: month 3 today (before the birth hour), then month 4',
   same(MM(ROBIN), [mo(2026, 10, 17, 'month', 3), mo(2026, 11, 17, 'month', 4)]));
ok('A10 the day before: tomorrow\'s month 3 comes first',
   same(MM(ROBIN, U(2026, 10, 16, 23, 59, 59, 999)), [mo(2026, 10, 17, 'month', 3), mo(2026, 11, 17, 'month', 4)]));
ok('A10 the day after: month 3 is gone, months 4 and 5',
   same(MM(ROBIN, U(2026, 10, 18, 0, 0)), [mo(2026, 11, 17, 'month', 4), mo(2027, 0, 17, 'month', 5)]));
ok('A10 a birth on 31 Jan: month 1 is 3 Mar (setMonth overflow), month 2 is 31 Mar',
   same(MM(U(2026, 0, 31, 9, 0), U(2026, 2, 1, 12, 0)), [mo(2026, 2, 3, 'month', 1), mo(2026, 2, 31, 'month', 2)]));
ok('A10 a birth on 31 Jan matches the app: monthiversary() says 1 on 3 Mar and null on 2 Mar',
   appMv(U(2026, 0, 31, 9, 0), U(2026, 2, 3, 12, 0)) === 1 && appMv(U(2026, 0, 31, 9, 0), U(2026, 2, 2, 12, 0)) === null);
ok('A10 month 12 reads as 1 year, then month 13',
   same(MM(U(2025, 10, 17, 9, 0)), [mo(2026, 10, 17, 'year', 1), mo(2026, 11, 17, 'month', 13)]));
ok('A10 month 23, then month 24 as 2 years',
   same(MM(U(2024, 11, 17, 9, 0)), [mo(2026, 10, 17, 'month', 23), mo(2026, 11, 17, 'year', 2)]));
ok('A10 month 24 is 2 years; 25 to 35 are skipped, so 3 years comes next',
   same(MM(U(2024, 10, 17, 9, 0)), [mo(2026, 10, 17, 'year', 2), mo(2027, 10, 17, 'year', 3)]));
ok('A10 month 25 is skipped: nothing today, 3 and 4 years next',
   same(MM(U(2024, 9, 17, 9, 0)), [mo(2027, 9, 17, 'year', 3), mo(2028, 9, 17, 'year', 4)]));
ok('A10 born today: the birth day is never a moment; month 1 is 17 Dec',
   same(MM(U(2026, 10, 17, 1, 0)), [mo(2026, 11, 17, 'month', 1), mo(2027, 0, 17, 'month', 2)]));
ok('A10 no birth date: [] for null, undefined and NaN', [null, undefined, NaN].every((b) => same(MM(b), [])));
ok('A10 count: 1 gives one, the default gives two', MM(ROBIN, NOW, 1).length === 1 && MM(ROBIN).length === 2);
ok('A10 snapshotBaby carries moments: monthMoments of its birth, [] with none',
   same(mod.snapshotBaby({ baby: kid('b1', ROBIN), events: [], illnesses: [], nap: null, now: NOW, label: () => null }).moments, MM(ROBIN))
   && same(mod.snapshotBaby({ baby: kid('b2', null), events: [], illnesses: [], nap: null, now: NOW, label: () => null }).moments, []));
```

`home()` and the ageString comparison lift `sinceAnchor` and `ageString` from app/index.html (stub `now`); `same` is a JSON deep-equal. Register `{ name: 'widget-snapshot', cmd: ['node', 'test/widget-snapshot.test.js', 'url'] }`.

- [ ] **Step 2: Run it and see it fail**

Run: `node tools/gates.js --only=widget-snapshot`
Expected: FAIL "Cannot find module .../workers/shared/since-rules.mjs".

- [ ] **Step 3: Implement since-rules.mjs, widget-copy.json and the generator; run `node tools/widget_gen.js`; add the script tag, ASSETS line and CACHE bump**

- [ ] **Step 4: Run it and see it pass**

Run: `node tools/gates.js --only=widget-snapshot,admin-no-content` and `node tools/widget_gen.js --check`
Expected: `WIDGET-SNAPSHOT: PASS`, admin-no-content PASS, `--check` exits 0.

- [ ] **Step 5: See it go red**

Drop `!e.deleted` from babyAnchors: FAIL "A2 a deleted newer feed is ignored" (the spec's red run "a deleted feed counts"). Restore. Add a space to app/since-rules.js: `--check` exits 1 printing `app/since-rules.js`. Regenerate. F10, each restored and regenerated after: clamp the mark to the month's last day instead of setMonth's overflow (`Math.min(birthDay, daysInMonth)`, so 28 Feb): FAIL "A10 a birth on 31 Jan: month 1 is 3 Mar"; drop the `m % 12 === 0` test: FAIL "A10 month 25 is skipped"; compare `at` with `now` instead of `now`'s midnight: FAIL "A10 the day itself" (03:14 is past 00:00, so today is lost).

- [ ] **Step 6: Commit**

```bash
git add docs/widgets/widget-copy.json workers/shared/since-rules.mjs workers/shared/widget-rules.mjs tools/widget_gen.js app/since-rules.js test/widget-snapshot.test.js
git commit -o docs/widgets/widget-copy.json workers/shared/since-rules.mjs workers/shared/widget-rules.mjs tools/widget_gen.js app/since-rules.js test/widget-snapshot.test.js app/index.html app/sw.js tools/gates.js -m "One since-rules module for the widgets, shared by the app and the Worker, month days included, with its browser copy generated and held equal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Every widget string and button from one file, and the parity gate's copy half

**Files:**
- Modify: `docs/widgets/widget-copy.json` (strings, differences), `app/index.html:4596-4632` (markers, `widget` fields, the Health row), `tools/widget_gen.js` (add `readQuickActions`), `app/since-rules.js` (regenerated: CubbyWidgetCopy now holds the app strings), `app/sw.js:3`, `tools/gates.js`
- Create: `tools/widget_parity_check.js`

**Interfaces:**
- Produces: `readQuickActions(root: string) -> [{ key, go, label, inPlace: boolean, perBaby: boolean, platforms: string[]|null, places: string[] }]` (widget_gen.js export; evaluates the array between the markers in a `vm`, never calling its functions).
- Produces: the string keys below (P3, P6 and Tasks 5, 7, 9 use them by name).
- Produces: `node tools/widget_parity_check.js [--root=<dir>] [--self-test]`; `--self-test` copies INPUTS into a temp tree, applies one edit per plant, runs `--root` on it and requires exit 1 with a `FAIL <check>` line for that plant, after an unaltered copy passes (the mechanism of tools/tracking_plan_check.js:544-608).

QUICK_ACTIONS: `/* WIDGET-QUICK-ACTIONS-BEGIN */` on its own line before `const QUICK_ACTIONS=[` (:4596), `/* WIDGET-QUICK-ACTIONS-END */` after its `];` (:4632). Fields (roadmap 2.3): feed `{go:'feed', places:['small','shortcut']}`, sleep `{go:'sleep', inPlace:true, places:['small','shortcut']}`, diaper `{go:'diaper', places:['small','shortcut']}`, pump and activity `{go:<k>, places:['medium4','small','shortcut']}`, measure and milestone `{go:<k>, places:['shortcut']}`, voice `{go:'voice', platforms:['android'], places:['medium4','small','shortcut']}`. New last row: `{k:'health', s:[], label:'Health', hint:'While your baby is unwell', fn:"go('health')", soft:'--note-soft', tone:'--note', ico:()=>I.thermo, widget:{go:'health', perBaby:true, places:['medium4','small']}}`. `s:[]` keeps it off every in-app surface (quickCatalog filters on stage, index.html:4651).

Strings (`on` in brackets; platforms both unless marked). Every text below is final copy:

| Keys | Text | on |
|---|---|---|
| gallery.mediumTitle / mediumDescA / mediumDescB | Feed, sleep, nappy / When your baby last fed, slept and had a nappy, and a tap to log the next. / When your baby last fed, slept and had a nappy. Start and stop sleep right here. | gallery |
| gallery.smallTitle / smallDesc | Last feed / When your baby last fed, and a tap to log the next one. | gallery |
| gallery.lockTitle / lockDesc (ios) | At a glance / When your baby last fed and slept. | gallery |
| header.updated / updatedYesterday / updatedDay | Updated {time} / Updated yesterday {time} / Updated {day} {time} | home, small |
| header.ask | Did it end earlier? | home |
| age.day / days / week / weeks / month / months / year / years | {age} day old / {age} days old / {age} week old / {age} weeks old / {age} month old / {age} months old / {age} year old / {age} years old (singular when the number is 1, as ageString) | home |
| status.lastFeed / lastSleep / sleep / lastNappy | Last feed / Last sleep / Sleep / Last nappy | home |
| status.asleepNow / asleep / since / asleepSince | Asleep now / Asleep / since {time} / Asleep since | home |
| status.notYet | not yet | home, small, lock |
| status.ago (ios) | ago | home, small, lock |
| small.lastFeed | last feed | small |
| sep.dot / names.and | " · " / " and " | home, small, lock / a11y, home (the twins month-day line joins names with it) |
| day.yesterday; weekday.sun, mon, tue, wed, thu, fri, sat; date.jan to date.dec; time.am, time.pm | Yesterday; Sun, Mon, Tue, Wed, Thu, Fri, Sat; {day} Jan, {day} Feb, {day} Mar, {day} Apr, {day} May, {day} Jun, {day} Jul, {day} Aug, {day} Sep, {day} Oct, {day} Nov, {day} Dec; AM, PM | home, small, lock |
| lock.lastFeed / asleepSince / woke (ios) | Last feed {time} / asleep since {time} / woke {time} | lock |
| button.startSleep / stopSleep / startBoth / stopBoth | Start sleep / Stop sleep / Start both / Stop both | home |
| button.undo | Undo | home, small |
| state.checking | Checking | line |
| line.noConnection / notSaved / alreadyStarted / alreadyStopped / pickBaby | No connection, so that didn't save. / That didn't save. Open Cubby to log it. / Already started in Cubby. / Already stopped in Cubby. / Open Cubby to pick a baby. | line |
| fallback.stale / signedOut / pickBaby | Open Cubby to catch up. / Open Cubby to sign in. / Open Cubby to pick a baby. | home, small, lock (signedOut: home, small) |
| word.cubby | Cubby | home, small, lock, gallery |
| a11y.feedFor / nappyFor / pumpFor / activityFor / healthFor / sleepFor | Feed for {names}, opens Cubby / Nappy for {names}, opens Cubby / Pump for {names}, opens Cubby / Activity for {names}, opens Cubby / Health for {names}, opens Cubby / Sleep for {names}, opens Cubby | a11y |
| a11y.sayItFor (android) | Say it for {names}, opens Cubby | a11y |
| a11y.startSleepFor / stopSleepFor / stopSleepOpensFor / undoFor | Start sleep for {names} / Stop sleep for {names} / Stop sleep for {names}, opens Cubby / Undo sleep for {names} | a11y |
| a11y.lastFeed / lastSleep / lastNappy / asleepSince | {name}'s last feed, {time} / {name}'s last sleep, {time} / {name}'s last nappy, {time} / {name}, asleep since {time} | a11y |
| moment.month1 / months / year1 / years (F10) | 1 month today / {age} months today / 1 year today / {age} years today | home |
| small.moment.month1 / months / year1 / years (F10) | {name} · 1 month today / {name} · {age} months today / {name} · 1 year today / {name} · {age} years today | small |
| twins.moment.month1 / months / year1 / years (F10) | {names} · 1 month today / {names} · {age} months today / {names} · 1 year today / {names} · {age} years today | home |
| a11y.moment.month1 / months / year1 / years (F10) | {name} is 1 month old today / {name} is {age} months old today / {name} is 1 year old today / {name} is {age} years old today | a11y |
| config.baby / both / yourButton / firstButton / secondButton | Baby / Both / Your button / First button / Second button | config |
| config.description | Feed, Sleep and Nappy are always on your widget. While your baby is unwell, your button shows Health, then goes back. | config |
| app.whoFor / healthSwitched / lockHide / lockHideHelp | Who is this for? / Your widget now shows Health until {name} is better. / Hide details on the lock screen / The widget will show Cubby and nothing else. | app |
| app.stackHelp (ios) | One widget per baby? Turn off Smart Rotate so the stack stays where you left it. | app |

`differences`: one entry per ios-only or android-only key above (`app.stackHelp` among them), plus `actions.voice` (android), each with a `why` of at least 20 characters (the ago line: spec 6.9; lock screen: iOS only; Say it: br5; stack helper: Smart Rotate exists only on iOS, contract note 9).

- [ ] **Step 1: Write `tools/widget_parity_check.js`, sections 1-3, and its plants**

Section 1 `generated files are fresh`: every `[rel, text]` of `generate(root)` equals the file at `root/rel`. Section 2 `QUICK_ACTIONS`: both markers once; `readQuickActions` equals the field table above exactly; health has `s:[]`; kicks, contractions, symptom, mood carry no `widget`; the row regex copied from tools/shortcuts_check.js:45 (asserted byte-equal to that file's line, so it cannot drift) matches as many rows as there are `{k:'` openings. Section 3 `copy rules`: `banned` and `properNouns` equal the Global Constraints lists exactly (so "total" cannot quietly leave); keys match `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$`; `on` non-empty within the eight; platforms within ios, android; only the six placeholders; no `—`; no banned phrase (case-insensitive substring; `Pro` as a whole, case-sensitive word); after removing placeholders, no capitalised word except the first word, a word after `. ? !`, a properNouns word or a QUICK_ACTIONS label word; no `?` in a string whose `on` has `lock`; every one-platform key and `actions.voice` declared in `differences`, every `differences` key real; every action with a widget button (places include `medium4` or `small`) has its `a11y.<k>For` key (diaper: `a11y.nappyFor`, voice: `a11y.sayItFor`), and each starts with that action's label; `moment keys` (F10): each of the prefixes `moment`, `small.moment`, `twins.moment`, `a11y.moment` has exactly the four keys `month1`, `months`, `year1`, `years`, on both platforms, where `months` and `years` contain `{age}` and `month1` and `year1` do not, the `small` and `a11y` ones contain `{name}` and the `twins` ones `{names}`. Plants (each its own temp tree): (a) a space appended to app/since-rules.js; (b) an em-dash in `status.lastFeed`; (c) "Last Feed"; (d) "Time for a nap" in `line.notSaved`; (e) `?` in `lock.woke`; (f) `platforms: ['ios']` on `status.lastFeed`; (g) `perBaby:true` removed from the Health row; (h) `{baby}` in `header.updated`; (i) "total" removed from `banned`; (m, lettered after Task 5's three) `twins.moment.year1` deleted, caught by `moment keys`. Register `{ name: 'widget-parity', cmd: ['node', 'tools/widget_parity_check.js', '--self-test'] }`.

- [ ] **Step 2: Run it and see it fail**

Run: `node tools/gates.js --only=widget-parity`
Expected: FAIL in section 2, "the QUICK_ACTIONS markers appear once each".

- [ ] **Step 3: Implement the markers, fields, Health row, strings, differences and `readQuickActions`; regenerate; bump CACHE**

- [ ] **Step 4: Run it and see it pass**

Run: `node tools/gates.js --only=widget-parity,widget-snapshot,shortcuts,fab-quicklog,quick-minweek,preg-canwrite`
Expected: `WIDGET-PARITY SELF-TEST: PASS` (10 of 10 plants caught) then `WIDGET-PARITY: PASS`, its `copy rules` lines passing on the sixteen `moment` keys too; the rest PASS (Health appears on no in-app surface).

- [ ] **Step 5: Commit**

```bash
git add tools/widget_parity_check.js
git commit -o docs/widgets/widget-copy.json app/index.html tools/widget_gen.js app/since-rules.js tools/widget_parity_check.js app/sw.js tools/gates.js -m "Every widget string, rule and button comes from one file, and a parity gate holds the copy rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The reference model and its golden fixtures

**Files:**
- Create: `tools/widget_model.js`, generated `docs/widgets/widget-fixtures.json`
- Modify: `docs/widgets/widget-copy.json` (`cases`), `tools/widget_gen.js` (adds the fixtures path to `generate`), `tools/widget_parity_check.js` (section 4 and three plants)

**Interfaces:**
- Produces: `renderModel(input: FixtureInput) -> ViewModel` (roadmap 2.3 with contract notes 3, 4, 12, 13 and 18) and `createModel(copy, actions) -> renderModel` (what `generate(root)` uses with that root's inputs). ViewModel = 2.3's shape plus top-level `url: string` (the body link), row `a11y: string` and `header.moment: { text: string, a11y: string } | null` (F10, M15); `message` holds a key; every other string is final display text. `FixtureInput.cellWidth` is fractional. Every case's `app.babies[]` carries `moments` (`[]` unless the case is about a month day), since the field is part of snapshot v1.
- Produces: `widget-fixtures.json = { "source": "<sha256 hex of widget-copy.json bytes>", "tz": "UTC", "fixtures": [{ name, input, expect }], "napCases": <copy.napCases, verbatim> }`, `expect` being the full ViewModel. Every clock, day and date is computed in UTC (`getUTC*`), so the bytes do not depend on the machine's zone.
- Consumed by: P3 XCTest and P6 Kotlin goldens (field-for-field, `agoAt` aside; zone from `tz`; the `moment-*` cases are their month day, the Kotlin port of M15 reading the same fixtures), P3 and P6 views (`url` is the body link; `header.moment` in the honey ink with its star, hidden off the home screen), P4 Task 10 (the iOS failure-line body link through `url`), Task 7 (every `go=` its buttons emit and every body `url`, monthcard included).

Model rules (M1-M15), from spec 6.1-6.9, F10 and roadmap 2.5:
- M1 Source: `app`, and `pull` only beside an `app` whose `state` is `ok` (2.5); no `app` → `wordmark`, whatever the pull holds. `app.v` not in `SNAPSHOT_VERSIONS` → `wordmark`. `state` `quiet`, or `babies` empty → `wordmark`. `signedOut` → `message: 'fallback.signedOut'` (lock families: `wordmark`), `buttons: []`. Lock families with `lockScreen.hide` → `wordmark`.
- M2 Selection: `config.baby` id → that baby (absent: `message 'fallback.pickBaby'`, `buttons: []`); `both` → both when exactly two babies, else pickBaby; null → both for twins, else `activeBabyId`'s baby, else the first. Lock never takes `both` (treated as null minus the twins default).
- M3 Merge (2.5): per baby, `nap` from the newest of app, pull and `nap.babies[bid]` by `at`; `last`, `by`, `healthOpen` from the newer of app and pull, a null never erasing the older value; `moments` from app only (P5's merge decides when a pull's count). Updated `U` = the oldest `at` among the sources whose fields are on screen. P5 replaces this rule with `mergeSources` (contract note 17); the merge cases below must still agree after it.
- M4 Stale: `now - U > staleMs` → `mode 'message'`, `message 'fallback.stale'`, `rows: []`, header and buttons kept; `lockInline` → `wordmark`.
- M5 Clock and days (UTC, contract note 5): clock is fmtClock's form (index.html:2189-2194) with `time.am`/`time.pm`. A time older than `dayRuleMs` on an earlier calendar day gets a day: the day before → `day.yesterday` (header: `header.updatedYesterday`), 2-6 days → `weekday.*`, else `date.*` with `{day}`. Same calendar day: never a day.
- M6 Header: medium single `{ name, age (age.* with {age}), fresh, ask, moment (M15) }`; a long nap (M10) sets `ask` to `header.ask` and `age` to null; twins and small `{ name: null, age: null, fresh, ask: null, moment (M15) }`; lock all null.
- M7 Rows, medium single: feed, sleep, nappy. Value = clock or `status.notYet`; `agoAt` = the anchor on iOS when the row has no day, else null; `by` from the snapshot (never on lock). Running nap: label `status.sleep`, value `status.asleepNow` when `cellWidth >= asleepNowMinWidth` else `status.asleep`, `day` = `status.since`, `agoAt` null. Row `a11y` from `a11y.last*` / `a11y.asleepSince`.
- M8 Rows, twins: one per baby, `baby` = name; running → label `status.asleepSince`, value the start clock; else label `status.lastFeed`. Small: one row `{ baby, label: small.lastFeed }` for the selected baby, or with `both` the baby whose feed is newest (chosen here). Lock rect: row 1 label = `lock.lastFeed` filled, value null; row 2 (only with sleep data) label = name + `sep.dot` + `lock.asleepSince` or `lock.woke` filled. Inline: row 1 only.
- M9 Medium buttons: Feed, Sleep, Nappy, then the fourth: `config.button` when it is a `medium4` action on this platform, else `DEFAULTS.medium4`; Health while any selected baby has `healthOpen`. Small: `config.first`/`second` from `small` actions (a repeat or unknown falls back to the next default); while ill, the second becomes Health unless Health is a pick. Lock: none.
- M10 Long nap: running and (`now - start > napMaxMs`, or `now - start > napAskMs` without an `ack` newer than `now - ackFreshMs`).
- M11 Sleep button, Phase A: label `Sleep` (its WActions label), soft, arrow, `url` go=sleep. Long nap: label `button.stopSleep`, soft, arrow, go=sleepfix with that baby. Phase B, `token` true, no active failure line (noConnection, notSaved, pickBaby): single → `button.startSleep` or `button.stopSleep`, solid, no arrow; twins → `startBoth` (none running), `stopSleep` (one, stops it), `stopBoth` (both); siblings set to both → Phase A's button on the active baby. Intents: start `{ action: 'start', babyIds }` with no `starts` key; stop `{ action: 'stop', babyIds, starts: { <bid>: start } }`. Undo while `nap.undo.until > now` → `button.undo`, solid, intent `{ action: 'undo', babyIds, starts, undo: nap.undo.of }`. Any `nap.pending` → `dim: true`, label kept. Small: label always `Sleep`. Otherwise Phase A's button.
- M12 URLs. Buttons: `go` from WActions; `baby` = the one id; `both` for twins; the active baby for siblings; Health names the ill twin when exactly one is ill. Body `url`, never null: while M13 shows `line.noConnection` or `line.notSaved`, `https://little-cubby.com/app/?go=sleep&baby=<b>&from=widget` with `<b>` the Sleep button's `baby` (spec 6.5, 6.7 step 6); else, when M15 gives a non-null `header.moment` (F10, contract note 18c), `https://little-cubby.com/app/?go=monthcard&baby=<id>&m=<total months>&from=widget`, `<id>` the baby whose moment it is (twins: the first selected baby with an active moment) and total months `n` for `month`, `12 * n` for `year` (`m=12` for "1 year today", `m=24` for "2 years today"); else, when M2 selected exactly one baby and the mode is not `wordmark`, `https://little-cubby.com/app/?baby=<id>&from=widget`; else `https://little-cubby.com/app/?from=widget`.
- M13 Line: a `nap.pending` with `now - pending.sentAt >= pendingMs` → `state.checking`; a younger pending → null (M11 only dims, spec 6.7 step 2); else `nap.line` with `until > now` → `line.<key>`; else null. Lock: null.
- M14 Button `a11y`: `<k>For` with `{names}` = the target names joined by `names.and`; in-place uses `startSleepFor`/`stopSleepFor`/`undoFor` for the babies the intent names; long nap `stopSleepOpensFor`.
- M15 Month days (F10): a baby's moment is active when some `m` in its `moments` has `m.at <= now < m.at + 86400000`. `header.moment` is null in every mode but `full`, on both lock families and while `ask` is set (contract note 18 a, b). The key suffix `<s>` is `month1` (month, n 1), `months` (month, n > 1), `year1` (year, n 1) or `years` (year, n > 1), and `{age}` is n. Medium, one baby: `{ text: moment.<s>, a11y: a11y.moment.<s> with {name} }`; `header.age` keeps the age text (note 18e). Two babies selected (the twins layout): both active with the same unit and n → `{ text: twins.moment.<s> with {names} = the two names joined by names.and, a11y: each baby's a11y.moment.<s> joined by names.and }` (note 18d); only one active → `twins.moment.<s>` with `{names}` = that baby's name and its `a11y.moment.<s>`; otherwise null. Small: the shown baby's (M8) moment → `{ text: small.moment.<s> with {name}, a11y: a11y.moment.<s> }`, the whole label line; its row keeps `small.lastFeed` and `by`, which P3 and P6 draw on the line under the clock that day. Rows, buttons, line and `fresh` never change.

Cases (in `widget-copy.json`; Robin is b1, Wren b2; `now` N = 2026-11-17T03:14Z unless said; S = N - 3600000; hand-written `expect` = the fields listed; `/app/?` stands for `https://little-cubby.com/app/?`):

| Case | Pins |
|---|---|
| medium-a-basic (ios) | header `Robin` / `2 months old` / `Updated 3:14 AM`; feed row `Last feed`, by `Dad`, `2:10 AM`, agoAt 02:10Z, a11y `Robin's last feed, 2:10 AM`; four soft arrowed buttons, Sleep url `/app/?go=sleep&baby=b1&from=widget`; url `/app/?baby=b1&from=widget` |
| medium-a-notyet | every value `not yet`, agoAt null |
| medium-a-asleep-now / android-asleep-short | `Sleep`, `Asleep now`, day `since 2:40 AM` at cellWidth 87.5; `Asleep` at 71 on Android, every agoAt null |
| day-yesterday / day-weekday / day-date | feed 2026-11-16T01:00Z → `Yesterday`; 2026-11-14T09:00Z → `Sat`; 2026-10-14T09:00Z → `14 Oct`; agoAt null |
| clock-midnight | `12:00 AM`, `12:59 AM` |
| stale / updated-yesterday | app.at 7h old → message `fallback.stale`, url `/app/?baby=b1&from=widget`; now 2026-11-17T22:00Z, at 2026-11-16T23:50Z → fresh `Updated yesterday 11:50 PM` |
| signed-out / quiet / unknown-version / no-data / no-babies | message `fallback.signedOut`; four `wordmark`s; every url `/app/?from=widget` |
| pull-without-app | app null, a pull with Robin's feed → `wordmark`, url `/app/?from=widget` |
| missing-baby | message `fallback.pickBaby`, buttons [], url `/app/?from=widget` |
| health-switch-medium / health-switch-twin | pick pump + healthOpen → fourth `Health`, `baby=b1`; twins, Wren ill → `baby=b2` |
| twins-a / twins-b-none / twins-b-one / twins-b-both / siblings-b | rows per baby, url `/app/?from=widget`; `Start both` intent exactly `{ action: 'start', babyIds: ['b1','b2'] }`, a11y `Start sleep for Robin and Wren`; `Stop sleep` intent `{ action: 'stop', babyIds: ['b2'], starts: { b2: S } }`; `Stop both`; siblings: `Sleep` arrowed, every button url `baby=b1` |
| b-start / b-stop / b-no-token | `Start sleep` solid, intent exactly `{ action: 'start', babyIds: ['b1'] }` (no `starts` key); `Stop sleep` intent `{ action: 'stop', babyIds: ['b1'], starts: { b1: S } }`; `Sleep` arrowed |
| b-line-noconn / b-line-notsaved / twins-b-line-noconn | line `No connection, so that didn't save.`, `Sleep` arrowed, url `/app/?go=sleep&baby=b1&from=widget`; line `That didn't save. Open Cubby to log it.`, the same url; twins: url `/app/?go=sleep&baby=both&from=widget` |
| b-line-expired / b-already / b-pickbaby | line null, url `/app/?baby=b1&from=widget`; `Already started in Cubby.` with `Stop sleep`, url `/app/?baby=b1&from=widget`; `Open Cubby to pick a baby.` and `Sleep` arrowed, url `/app/?baby=b1&from=widget` |
| b-undo | `Undo`, intent `{ action: 'undo', babyIds: ['b1'], starts: { b1: S }, undo: 'start' }` |
| b-pending / b-checking / b-checking-edge | pending sentAt N - 2000 → `Start sleep`, dim true, line null; sentAt N - 15000 → dim true, line `Checking`; sentAt exactly N - 10000 → line `Checking` |
| long-nap-13h / long-nap-acked / long-nap-25h-acked | ask `Did it end earlier?`, age null, `Stop sleep` soft arrow `go=sleepfix&baby=b1`; ack 2h old → no ask, solid; 25h → ask despite the ack |
| merge-nap-newer / merge-pull-null | napState newer says stopped → no nap, fresh = app.at; pull newer with nappy null keeps app's nappy |
| small-default / small-health / small-health-picked / small-b | buttons Sleep, Feed; row `Robin`, `last feed`, by `Dad`; picks pump, feed + ill → pump, Health; picks health, feed + ill → unchanged; B Sleep solid, a11y `Start sleep for Robin` |
| lock-rect / lock-hide / lock-inline / lock-long-nap | `Last feed 2:10 AM`, `Robin · asleep since 2:40 AM`, by absent, url `/app/?baby=b1&from=widget`; `wordmark`, url `/app/?from=widget`; one row; long nap shows only `Robin · asleep since 7:10 PM` |
| voice-android / voice-ios | `Say it` fourth on Android; the same config on iOS → `Activity` |
| moment-today / moment-android | F10. medium-a-basic's input with Robin's `moments` = A10's `[{ at: 2026-11-17T00:00Z, unit: 'month', n: 3 }, { at: 2026-12-17T00:00Z, unit: 'month', n: 4 }]` (call it D3): header `Robin` / age `2 months old` / moment exactly `{ text: '3 months today', a11y: 'Robin is 3 months old today' }`; feed row `Last feed`, by `Dad`, `2:10 AM` as medium-a-basic; Sleep url `/app/?go=sleep&baby=b1&from=widget`; url `/app/?go=monthcard&baby=b1&m=3&from=widget`; the same on Android, every agoAt null |
| moment-day-before / moment-midnight / moment-last-ms / moment-day-after | D3 at now (and `app.at`) 2026-11-16T23:59:59.999Z, 2026-11-17T00:00Z, 2026-11-17T23:59:59.999Z, 2026-11-18T00:00Z: moment null, moment-today's moment, moment-today's moment, null; url `/app/?baby=b1&from=widget`, monthcard `m=3`, monthcard `m=3`, `/app/?baby=b1&from=widget` |
| moment-month1 / moment-year1 / moment-years | today's moment `{ month, 1 }`, `{ year, 1 }` (month 12), `{ year, 2 }` (month 24): `{ text: '1 month today', a11y: 'Robin is 1 month old today' }`, url `m=1`; `{ text: '1 year today', a11y: 'Robin is 1 year old today' }`, url `m=12`; `{ text: '2 years today', a11y: 'Robin is 2 years old today' }`, url `m=24` (each url `/app/?go=monthcard&baby=b1&m=<m>&from=widget`) |
| moment-no-birth | Robin with age null and `moments` [] (no birth date): moment null, age null, url `/app/?baby=b1&from=widget` |
| moment-twins-month1 / moment-twins-both / moment-twins-year1 / moment-twins-years | twins, both with today's `{ month, 1 }`, `{ month, 3 }`, `{ year, 1 }`, `{ year, 2 }`: texts `Robin and Wren · 1 month today`, `Robin and Wren · 3 months today`, `Robin and Wren · 1 year today`, `Robin and Wren · 2 years today`; a11y `Robin is 1 month old today and Wren is 1 month old today`, `Robin is 3 months old today and Wren is 3 months old today`, `Robin is 1 year old today and Wren is 1 year old today`, `Robin is 2 years old today and Wren is 2 years old today`; urls `/app/?go=monthcard&baby=b1&m=<1, 3, 12, 24>&from=widget`; rows per baby unchanged |
| moment-twins-one / moment-twins-differ | only Wren's `{ month, 3 }` today: `{ text: 'Wren · 3 months today', a11y: 'Wren is 3 months old today' }`, url `/app/?go=monthcard&baby=b2&m=3&from=widget`; Robin `{ month, 3 }` and Wren `{ month, 2 }` both today: moment null, url `/app/?from=widget` |
| moment-small-month1 / moment-small / moment-small-year1 / moment-small-years | small, Robin's feed by Dad, today's `{ month, 1 }`, `{ month, 3 }`, `{ year, 1 }`, `{ year, 2 }`: texts `Robin · 1 month today`, `Robin · 3 months today`, `Robin · 1 year today`, `Robin · 2 years today`; a11y `Robin is 1 month old today`, `Robin is 3 months old today`, `Robin is 1 year old today`, `Robin is 2 years old today`; row `Robin` / `last feed` / by `Dad` unchanged; urls `/app/?go=monthcard&baby=b1&m=<1, 3, 12, 24>&from=widget` |
| moment-lock-rect / moment-lock-inline | D3 on lockRect and lockInline: moment null, rows as lock-rect and lock-inline, url `/app/?baby=b1&from=widget` |
| moment-long-nap | D3 with long-nap-13h's nap: ask `Did it end earlier?`, age null, moment null (note 18b), `Stop sleep` soft arrow, url `/app/?baby=b1&from=widget` |
| moment-line-noconn / moment-line-expired | D3, phase B, token: line `No connection, so that didn't save.` with moment `{ text: '3 months today', a11y: 'Robin is 3 months old today' }` kept and url `/app/?go=sleep&baby=b1&from=widget` (the failure link wins); an expired line: line null, url `/app/?go=monthcard&baby=b1&m=3&from=widget` |
| moment-stale | D3 with `app.at` 7h old: message `fallback.stale`, moment null (note 18a), url `/app/?baby=b1&from=widget` |

- [ ] **Step 1: Write the cases and section 4 `fixtures`**: `source` equals sha256 of widget-copy.json; `tz === 'UTC'`; `napCases` deep-equals widget-copy.json's; fixtures equal `renderModel` over `cases` in order; each hand-written `expect` matches the model as a deep partial, except that a hand-written `intent`, `url` and `header.moment` are compared whole (`case <name> agrees`), so a stray `starts` on a start, or a moment where the case says null, fails; `zone-free`: `generate(root)` run in a child process with `TZ=Pacific/Chatham` returns the same fixtures bytes as with `TZ=UTC`. Plants: (j) `staleMs` 21600001 in the temp copy's widget-copy.json without regenerating; (k) one hand-written `expect` value changed (`Asleep now` to `Asleep`); (l) the temp tree's widget-fixtures.json with `"tz": "Europe/London"`.
- [ ] **Step 2: Run and see it fail**: `node tools/gates.js --only=widget-parity`; Expected: FAIL in section 4, "fixtures: widget-fixtures.json exists and its source is widget-copy.json's sha256".
- [ ] **Step 3: Implement `tools/widget_model.js`; extend `generate`; `node tools/widget_gen.js`.**
- [ ] **Step 4: Run and see it pass**: `node tools/gates.js --only=widget-parity`; Expected: 13 of 13 plants caught, `WIDGET-PARITY: PASS`, every case agrees (the 26 `moment-*` cases included), zone-free PASS.
- [ ] **Step 5: See the model go red**, each restored and regenerated after: M13 without the `pendingMs` test (a fresh pending says Checking): `case b-pending agrees` FAILS; `>=` made `>` in M13: `case b-checking-edge agrees` FAILS; `starts: {}` added to the start intent: `case b-start agrees` FAILS; the failure-line branch of the body `url` removed: `case b-line-noconn agrees` FAILS; one `getUTCHours` made `getHours`: `zone-free` FAILS. F10: M15's `now < m.at + 86400000` made `<=`: `case moment-day-after agrees` FAILS; M15 without the `ask` test: `case moment-long-nap agrees` FAILS; the monthcard branch of the body `url` moved above the failure-line branch: `case moment-line-noconn agrees` FAILS; the twins line without the same unit and n test: `case moment-twins-differ agrees` FAILS; M15 run on lock families: `case moment-lock-rect agrees` FAILS; `m` written as `n` for years: `case moment-year1 agrees` FAILS (`m=1`, not `m=12`).
- [ ] **Step 6: Commit**

```bash
git add tools/widget_model.js docs/widgets/widget-fixtures.json
git commit -o tools/widget_model.js docs/widgets/widget-fixtures.json docs/widgets/widget-copy.json tools/widget_gen.js tools/widget_parity_check.js -m "A reference model renders every widget state from the shared rules, a baby's month day included, with golden fixtures for the native tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Generated native constants, native guards, the deploy fence and the night colour pairs

**Files:**
- Create (generated): `native-ios/CubbyWidget/Generated.swift`, `native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt`, `native-android/app/src/main/res/values/widget_strings.xml`
- Modify: `tools/widget_gen.js`, `tools/widget_parity_check.js` (sections 5, 6), `DESIGN.md` (new section after :374, before the `---` at :376), `.assetsignore` (after `android`), `tools/deploy_exclusion_check.js:33-49` (INTERNAL) and `:51-58` (MUST_404)

**Interfaces:**
- Produces (roadmap 2.3): Swift `enum` and Kotlin `object` `WCopy`, `WRules`, `WDefaults`, `WActions` (`all`: key, go, label, inPlace, perBaby, places), `WSnapshot` (`versions`). Names drop the dots and capitalise the next letter (`WCopy.statusLastFeed`); Android resources are `w_` plus snake case (`w_status_last_feed`). Each platform's file holds only that platform's strings and actions (iOS has no `voice`). Swift `WCopy.fill(_ s: String, _ args: [String: String]) -> String` and Kotlin `WCopy.fill(s: String, args: Map<String, String>): String` replace `{key}`. Kotlin `WCopy` members are resource ids (`val statusLastFeed: Int get() = R.string.w_status_last_feed`), and `WCopy.byKey: Map<String, Int>` maps every dot key whose platforms include android to its id (`"status.lastFeed" to R.string.w_status_last_feed`), so P6 resolves the ViewModel's `message` and line keys without `getIdentifier` (contract note 16); widget_strings.xml escapes `'` `"` `&` `<` and a leading `@` or `?`.
- Not here (contract note 16): `WColor`/`WColors`, Swift `WCopy.text(_ key:) -> String?` and the `#if CUBBY_WIDGET_EXT` intents block are P3 Task 2's emitters in this generator.
- Consumed by: P3 (Swift), P6 (Kotlin, XML).

DESIGN.md section "Home-screen widgets: colour pairs" between `<!-- WIDGET-PAIRS-BEGIN -->` and `<!-- WIDGET-PAIRS-END -->`, rows `| theme | role | token | fg | bg | ratio |`, values measured from app/index.html's `:root` (:101) and `[data-theme="night"]` (:343) blocks against the widget ground `--surface-2`: day soft fills 1.11-1.13:1 (feed `#FBEAD0`, nappy `#DDF0EA`, note `#EFE9DA` on `#FBF7EF`); night soft fills 1.00-1.11:1 (note `#2C281D` on `#2E2722` is 1.00); night 1pt strokes `--feed #E0A655` 6.82, `--diaper #6FBBA8` 6.54, `--note #B6A985` 6.30 on `#2E2722`; solid sleep text `--on-sleep` day `#FFFFFF` on `#5E6AA8` 5.12, night `#1A1614` on `#8E97D4` 6.44 (white there is 2.79, a fail); "not yet" `--ink-soft` day `#6E635B` on `#FBF7EF` 5.46, night `#C4B8AB` on `#2E2722` 7.55. Prose under it: the fourth slot always wears the quiet (note) kind; the opens-Cubby arrow is 11pt with stroke 2 (§A6); hit frames at least 44pt and 48dp.

- [ ] **Step 1: Write sections 5 and 6 and their plants.** Section 1 gains `kotlin byKey`: Generated.kt's `byKey` has exactly one entry per key whose platforms include android, each `"<dot key>" to R.string.w_<snake>`, and no other. Section 5 `native source`: in every non-generated `.swift` under native-ios/ (Generated.swift, P3's intents block included, is generated and exempt) and `.kt` / `res/xml/*.xml` under native-android/, no string literal in `Text(`, `Text(verbatim:`, `Button(`, `Label(`, `.configurationDisplayName(`, `.description(`, `title: LocalizedStringResource =`, `@Parameter(title:`, `DisplayRepresentation(title:`, Glance `Text(` positional or `text =`, `android:label="` or `android:description="` not starting `@string/`; no type conforming to `AppIntent`, `OpenIntent`, `LiveActivityIntent` or `AudioPlaybackIntent` except `NapIntent`, and no `ActionCallback` except `NapActionCallback` (the names allowed for `inPlace` entries; sleep is the only one); no `UIApplicationShortcutItems` in native-ios/ or tools/cap_ios_configure.rb; no `shortcuts.xml` and no `android.app.shortcuts` in native-android/. Section 6 `design pairs`: each row's hexes equal its token in the named theme block, and its ratio equals the WCAG ratio rounded to two places. Plants, each in its own temp tree: `WCopy.statusLastFeed`'s value edited in Generated.swift; `w_status_last_feed` edited in widget_strings.xml; the `"status.lastFeed"` entry removed from Generated.kt's `byKey` (caught by `kotlin byKey`); one plant file per literal matcher above (thirteen, each caught by its own matcher); a `struct LogFeedIntent: AppIntent`; a `class LogFeedCallback : ActionCallback`; `UIApplicationShortcutItems` in a native-ios plist; native-android/app/src/main/res/xml/shortcuts.xml; one DESIGN.md hex changed.
- [ ] **Step 2: Run and see it fail**: `node tools/gates.js --only=widget-parity`; Expected: FAIL `generated files are fresh` (the three native paths missing) and `design pairs` (markers missing).
- [ ] **Step 3: Implement the native generators, regenerate, write the DESIGN.md section; add `native-ios` and `native-android` to .assetsignore and INTERNAL, and `native-ios/CubbyWidget/Generated.swift`, `native-android/app/src/main/res/values/widget_strings.xml` to MUST_404.** On a Mac, `xcrun swiftc -parse native-ios/CubbyWidget/Generated.swift` exits 0 (a local check; P3 compiles it).
- [ ] **Step 4: Run and see it pass**: `node tools/gates.js --only=widget-parity,deploy-excl`; Expected: every plant caught, `WIDGET-PARITY: PASS`, deploy-excl PASS.
- [ ] **Step 5: See the fence go red**: remove the `native-ios` line from .assetsignore; `node tools/gates.js --only=deploy-excl` FAILS "every internal path is named in .assetsignore". Restore.
- [ ] **Step 6: Commit**

```bash
git add native-ios/CubbyWidget/Generated.swift native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt native-android/app/src/main/res/values/widget_strings.xml
git commit -o native-ios/CubbyWidget/Generated.swift native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt native-android/app/src/main/res/values/widget_strings.xml tools/widget_gen.js tools/widget_parity_check.js DESIGN.md .assetsignore tools/deploy_exclusion_check.js -m "Generated Swift, Kotlin and Android strings for the widgets, fenced from deploy, with the night colour pairs in DESIGN.md" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Widget links open the right sheet for the right baby

**Files:**
- Modify: `app/native-bridge.js:15-40` (routeDeepLink), `:161-173` (routeUrl), `:179-184` (getLaunchUrl, appStateChange), new `window.cubbyWidget` block after `:261`
- Modify: `app/index.html:2323` (initTargets), `:2719-2738` (stashDeepLink), `:2750-2806` (runDeepLink, its `monthcard` target included; new helpers right after it), `app/sw.js:3`, `tools/gates.js`
- Create: `test/widget-deeplink.test.js`

**Interfaces:**
- Produces (F10): the `monthcard` target with query key `m`, an integer 1..600, and `dlM(v) -> number|null` (index.html global beside `dlBaby`: `/^[1-9][0-9]{0,2}$/` and at most 600 → the number, else null). Consumes the app's `UI_ACTIONS.openMonthCard(month, photoId)` (index.html:3077: openMemoryCard, no Pro gate, then `dismissTip('bday'+month)` as Home's "See it" does) and `memCandPhoto(month)` (:19005).
- Produces: `window.cubbyWidget = { versions(), hasWidgets(), setSnapshot(json: string), clear() }`, each a Promise resolving `null` (versions, setSnapshot) or `false` (hasWidgets, clear) when not native or the binary lacks `Capacitor.Plugins.CubbyWidget` or the method. `setSnapshot(json)` calls the plugin with `{ v: JSON.parse(json).v, json }`. `hasWidgets()` resolves and caches on `window.__cubbyHasWidgets` the plugin's whole answer `{ value, kinds: { medium, small, lock } }` (contract note 14), or `false` on the web, with no plugin, no method or a thrown call; `versions()` caches `window.__cubbyWidgetBinary` (`{ snapshot, shortcuts, inPlace }` or null). Native boot asks both once; `appStateChange` to active asks again and, when either answer changed, calls `window.renderSoon` and `window.exportWidgetSnapshot` if present.
- Produces: `applyDeepLinkBaby(baby: string|null) -> void` (contract note 2) and `openWidgetWhoFor(go: string) -> void` (index.html globals).
- Consumes: `CubbyWidgetCopy['app.whoFor']` (Task 4), `widget.opened` (Task 2), WActions `go` values and fixture button and body URLs (Tasks 4, 5).
- Consumed by: P3 (`__cubbyHasWidgets` for widget.installed and the stack helper), P4 (`hasWidgets()` in widgetTokenSync), Task 9 (the lock-hide row).

Router rules:
- Bridge: `routeUrl` passes `baby`, `from` and `m`; `routeDeepLink` keeps `baby` only if it matches the baby rule, `from` only if `widget` or `shortcut`, and `m` only as `dlM`'s number (the same rule inline, since native-bridge.js is its own IIFE), and stashes `{ go, stage, read, tab, baby, from, m }` when any of go, stage, read, tab or from is present. `getLaunchUrl` routes once per webview process: skip when `sessionStorage['cubby-launch-done'] === url`, else set it, then route (lane L's key if it landed). `appUrlOpen` always routes. stashDeepLink reads and strips `baby`, `from` and `m` too, through the same rules (`dlBaby(v) -> string|null`, `dlM(v) -> number|null`), and stashes when `from` is present even with no `go`, so a body link survives sign-in.
- runDeepLink, right after the loss swallow (:2757): `if(dl.go==='monthcard' && myLossHolding()) return;` (F10: nothing while loss holding is active, even beside a living child, whose feed links still route; contract note 18h). Then, with `from`, `cubbyTrack('widget.opened', { from, target })`, target = feed for feed; sleep for sleep and sleepfix; nappy for diaper; other for pump, activity, measure, milestone, voice; moment for monthcard; none for everything else (Home, the body link, health, pregnancy targets).
- `monthcard` (F10), beside the baby targets: with `hasBaby` and a number `dl.m`, `applyDeepLinkBaby(dl.baby)`, disarm the one-shot list (the card consumes none), then `UI_ACTIONS.openMonthCard(dl.m, memCandPhoto(dl.m))` (memCandPhoto reads `state.activeBabyId`, so the baby is applied first; `m` stays a number, note 18i). No `m`, or one `dlM` refused: nothing changes, the active baby included, and Home stays (`go('home')`).
- A `from` link with no go, stage, read or tab (the widget body, contract note 2), after the tab branch: `applyDeepLinkBaby(dl.baby)` when `dl.baby` is set, disarm the one-shot list (no sheet will consume it), then `go('home')`.
- `kicks`, `contractions`, `symptom` return silently when `!quickOwnerOnlyOk()`, beside mood's check (:2802).
- BABY_GO (:2798) gains `pump:'openPump', activity:'openActivity', measure:'openGrowth', milestone:'openCustomMilestone'`; every baby target calls `applyDeepLinkBaby(dl.baby)` first and clears the one-shot list after the open.
- `applyDeepLinkBaby`: a known id → `viewingPreg=false`, `activeBabyId` = it (persist only when it changed), one-shot `[id]`; `both` with exactly two babies → one-shot both ids; anything else → nothing (Review Focus 4). `initTargets()` takes the one-shot list once, else `[activeBabyId]`.
- `health`: targets = both ids, the one id, or the active baby; ill = targets with an open illness (no `endedAt`). One ill → that baby, `healthTab='illness'`, `go('health')`. Two ill, or two targets none ill → `openWidgetWhoFor('health')`. One target none ill → that baby, `healthTab=null`, `go('health')`.
- `sleepfix`: `openSleepCorrect(bid)` for the first target with `runningNap(bid)`; none → `openSleep()` with the targets.
- `voice`: `openVoiceLog()` only when `isPro() || tasteLeft('voice') > 0`; else `go('home')`, so a widget never leads to the Pro sheet.
- `openWidgetWhoFor(go)`: a sheet titled `app.whoFor`, one button per baby (`escapeHtml` names, `hArg` ids), each `closeSheet(); runDeepLink({ go, baby: id })`.

- [ ] **Step 1: Write the failing test `test/widget-deeplink.test.js`**

Section A (Node, `vm` like the `run()` harness at test/native-deeplink.test.js:26-62, its context unchanged): `baby` and `from` survive `appUrlOpen` into `cubby-dl`, and so does `?baby=b2&from=widget` with no `go`; `baby=../users/x` and `from=email` are dropped; `?go=monthcard&baby=b2&m=3&from=widget` stashes `m` as the number `3` (`typeof` number), `m=600` as `600`, and `m=0`, `m=601`, `m=3.5`, `m=-1`, `m=abc` stash `m: null` (F10); a second boot with the same launch URL and the same sessionStorage stashes nothing; `appUrlOpen` with that URL still stashes; `cubbyWidget` resolves null/false on the web and with no plugin, and passes through with a fake plugin; with that plugin answering `{ value: true, kinds: { medium: 1, small: 0, lock: 2 } }`, `__cubbyHasWidgets` deep-equals the answer (not `true`), and on the web, with no plugin and with no `hasWidgets` method it is `false`; an `appStateChange` whose answer changed calls `renderSoon` once, an unchanged one not at all.
Section B (browser): `evaluateOnNewDocument` installs a fake `Capacitor` (native, `App.addListener` capturing callbacks, `getLaunchUrl` from a test-set value, `CubbyWidget` recorder), a `cubbyTrack` recorder and wraps `openPro` to count calls; `pageerror` events are collected into `errors`. Seed twins b1 Robin and b2 Wren, active b1. `open(q)` fires the captured `appUrlOpen` with `'https://little-cubby.com/app/' + q`, waits until `cubby-dl` is consumed plus 500 ms, and returns `{ view, sheet, active, targets, buttons, tab, month, text, proPill }`: `view`, the open sheet's first `h2` text or null, `state.activeBabyId`, `logTargets`, the sheet's button texts, `healthTab`, `cardDraft.month` read by name (a script-level `let`, index.html:19156; `open` sets `cardDraft = null` before it fires) or null, the sheet's `innerText`, and whether the sheet holds a `.pro-pill`; it then closes any sheet and goes Home.

```js
for (const go of everyGo) // WActions go values, every go= in widget-fixtures.json button urls, and the shortcut keys
  ok(go + ' lands on its sheet or view, not Home', landed(go));
for (const url of bodyUrls) // every distinct top-level `url` in widget-fixtures.json, the moment-* monthcard urls included
  ok(url + ' lands as M12 means it', landedBody(url)); // go=sleep: the Sleep sheet for that baby or Both; go=monthcard: Memory card for that baby, month m; else Home, that baby active
ok('B1 baby=b2 opens Pump for Wren', r1.sheet === 'Pump' && r1.active === 'b2' && same(r1.targets, ['b2']));
ok('B2 baby=both survives initTargets: Feed with Both on', same(r2.targets, ['b1', 'b2']) && bothChipOn);
// m = open('?go=measure&baby=b1&from=shortcut'), n = open('?go=milestone&from=shortcut')
ok('B3 measure and milestone land on Measurement and New moment', m.sheet === 'Measurement' && n.sheet === 'New moment');
// Wren ill since 2 days ago, Robin well: h1 = open('?go=health&baby=both&from=widget'), h2 = open('?go=health&baby=b1&from=widget');
// then Robin ill too: h3 = open('?go=health&baby=both&from=widget')
ok('B4 health, one ill twin: her illness tab', h1.view === 'health' && h1.active === 'b2' && h1.tab === 'illness');
ok('B4 health, one target not ill: his health view', h2.view === 'health' && h2.active === 'b1' && h2.tab === null);
ok('B4 health, both ill: Who is this for?, one button per baby', h3.sheet === 'Who is this for?' && same(h3.buttons, ['Robin', 'Wren']));
// active b1: u = open('?go=feed&baby=gone1&from=widget'), j = open('?go=feed&baby=../users/x&from=widget');
// reseeded with b1 alone: o = open('?go=feed&baby=both&from=widget'); with b1, b2, b3 (not twins), active b1: t = open(the same)
ok('B5 unknown baby, junk, both with one baby, both with three: Feed for the active baby, no error (Review Focus 4)',
   [u, j, o, t].every((r) => r.sheet === 'Feed' && r.active === 'b1' && same(r.targets, ['b1'])) && errors.length === 0);
ok('B6 voice with no tastes left goes Home; no target ever calls openPro or shows "Pro"', proCalls === 0 && !proText);
ok('B7 a caregiver tapping kicks gets nothing', noSheet);
// launch URL '?go=pump&baby=b2&from=widget'; l1 = the first boot, l2 = after page.reload() (sessionStorage kept)
ok('B8 the launch URL routes once: a reload with the same launch URL opens nothing', l1.sheet === 'Pump' && l2.sheet === null && l2.view === 'home');
// recorder cleared, then these five opens in order:
ok('B9 widget.opened carries from and the coarse target only', same(tracked('widget.opened'), [
   { from: 'widget', target: 'other' },   // ?go=pump&baby=b2&from=widget
   { from: 'widget', target: 'none' },    // ?go=health&baby=both&from=widget
   { from: 'widget', target: 'none' },    // ?baby=b2&from=widget
   { from: 'shortcut', target: 'feed' },  // ?go=feed&from=shortcut
   { from: 'widget', target: 'moment' }])); // ?go=monthcard&baby=b2&m=3&from=widget (F10)
// active b1: w = open('?baby=b2&from=widget'); x = open('?from=widget'); then open('?baby=both&from=widget') and openFeed() by hand
ok('B10 the widget body ?baby=b2&from=widget lands on Wren\'s Home, no sheet', w.view === 'home' && w.sheet === null && w.active === 'b2');
ok('B10 ?from=widget alone: Home, the active baby unchanged', x.view === 'home' && x.sheet === null && x.active === 'b2');
ok('B10 a body link arms nothing: Feed opened by hand afterwards is for the active baby only', same(handFeedTargets, ['b2']));
// F10. Active b1, Robin and Wren seeded 40 days old (their own month is 1, so a month of 3 or 12 can only come from m):
// mc = open('?go=monthcard&baby=b2&m=3&from=widget');
// my = open('?go=monthcard&baby=b1&m=12&from=widget'); mx = open('?go=monthcard&baby=b2&m=601&from=widget') after resetting active to b1
ok('B11 monthcard opens Wren\'s month 3 card, as Home\'s "See it" does', mc.sheet === 'Memory card' && mc.active === 'b2' && mc.month === 3);
ok('B11 m=12 opens the 1-year card, the month kept as a number', my.sheet === 'Memory card' && my.month === 12);
ok('B11 the month card shows no Pro mark and never calls openPro', !/\bPro\b/.test(mc.text) && !mc.proPill && proCalls === 0);
ok('B11 m outside 1..600: Home, nothing opened, the active baby unchanged', mx.sheet === null && mx.view === 'home' && mx.active === 'b1');
// reseeded: Robin alone with lossHolding for the viewer, recorder cleared: ml = open('?go=monthcard&baby=b1&m=3&from=widget'),
// then lf = open('?go=feed&baby=b1&from=widget') (the recorder stands in for cubbyTrack, which itself sends nothing in her holding, cubby-track.js:141)
ok('B11 during loss holding, even with a living child: monthcard opens nothing and returns before widget.opened; a feed link still routes',
   ml.sheet === null && lf.sheet === 'Feed' && !tracked('widget.opened').some((e) => e.target === 'moment'));
```

Register `{ name: 'widget-deeplink', cmd: ['node', 'test/widget-deeplink.test.js', 'url'] }`.

- [ ] **Step 2: Run and see it fail**: `node tools/gates.js --only=widget-deeplink`; Expected: FAIL on A (baby and `m` dropped by the whitelist, `__cubbyHasWidgets` undefined) and B1-B11 (the monthcard body urls of the `moment-*` fixtures land on Home).
- [ ] **Step 3: Implement the bridge, the router rules, `dlM`, the `monthcard` target and the helpers; bump CACHE.**
- [ ] **Step 4: Run and see it pass**: `node tools/gates.js --only=widget-deeplink,native-deeplink,shortcuts,preg-deeplink,invite-arrival,alert-pill,poster-beat,loss-keepsake`; Expected: all PASS (alert-pill still sees openMonthCard dismiss after it opens; the Home month pill is untouched).
- [ ] **Step 5: See the roadmap's red runs**, each restored after: drop `baby` from the bridge's whitelist (A fails); make `initTargets` ignore the one-shot list (B2 fails); route `voice` straight to `openVoiceLog` (B6 fails); remove `measure` from BABY_GO (B3 fails). And this plan's: cache `answer.value` instead of the answer (A fails "`__cubbyHasWidgets` deep-equals the answer"); drop the no-go branch (B10 fails: the active baby stays Robin); skip the disarm in it (B10 "arms nothing" fails). F10: drop `m` from the bridge's whitelist (A fails "`m` stashed as the number 3"); keep `m` as the query string (B11 "Wren's month 3 card" fails: openMemoryCard falls back to her own month, 1); open the card before `applyDeepLinkBaby` (B11 fails: the active baby stays Robin); swallow `monthcard` only when there is no baby, as the general swallow does (B11 "during loss holding" fails).
- [ ] **Step 6: Commit**

```bash
git add test/widget-deeplink.test.js
git commit -o app/native-bridge.js app/index.html app/sw.js tools/gates.js test/widget-deeplink.test.js -m "Widget links open the right sheet for the right baby, from the native app's link path, once per launch, and a month-day link opens the month card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The snapshot export, the wipes and the live flags

**Files:**
- Create: `app/widget-snapshot.js`
- Modify: `app/index.html:2693-2708` (render: `widgetCheckLoss(); exportWidgetSnapshot();` after `maybeRunDeepLink()`), new export block after `usageScreen` (:2711), `:13632` (endPregnancy: `widgetWipe('endPregnancy')` after the owner check), script tag before native-bridge (:19897)
- Modify: `app/store-firebase.js:965-969` (signOut: `widgetWipe('signout')` first), `:971-1019` (teardown: `LL.hhBooted = 0; LL.live = false; LL.liveAt = 0`), `:2678` (showAccessLost: `widgetWipe('accessLost')` after `accessLostShown = true;`), `:2849-2887` (joinPendingInvite: `widgetWipe('switch')` before each reload timer), `:2941` (maybeBoot: `window.LL.hhBooted = ++hhBootSeq` after `booted = true;`), after `:3052` (a metadata listener setting `LL.live`, `LL.liveAt`), `:3086-3105` (events: `LL.liveAt` on a server snapshot), `:3536-3539` (persist override: `window.exportWidgetSnapshot && window.exportWidgetSnapshot()` after scheduledPush), `:3671` (deleteAccount: `widgetWipe('delete')` after `window.__cubbyDeleting = true;`)
- Modify: `app/sw.js:3` and ASSETS (`'/app/widget-snapshot.js',`), `test/widget-snapshot.test.js` (Sections A2, B, C, D), `test/widget-logger.test.js` (Section 3), `test/blob-sync.test.js` (one section)

**Interfaces:**
- Produces (roadmap 2.2): `buildWidgetSnapshot(ctx) -> AppSnapshot|null`, `widgetShortcuts(ctx) -> string[]`, `widgetByLabel(authorId, viewerUid, memberInfo, formerMemberInfo) -> string|null`, `widgetVersion(web, binary) -> number|null` on `window.CubbyWidgetSnapshot` and `module.exports`, plus `buildSignedOutSnapshot(v, now) -> AppSnapshot`. It reads `globalThis.CubbySince`.
- Produces: `exportWidgetSnapshot() -> void`, `widgetWipe(reason) -> void` (index.html globals; P4 calls `widgetWipe('unauthorized')`), `LL.live`, `LL.liveAt` (roadmap), `LL.hhBooted: number` (P1-local: 0 until a household boots, then a count that only rises).
- Consumes: Task 3 since-rules, Task 7 `window.cubbyWidget`, `__cubbyWidgetBinary`.

Rules:
- `buildWidgetSnapshot` returns null when `!ctx.userLoaded`, no `ctx.binary`, `widgetVersion(SNAPSHOT_VERSIONS, ctx.binary.snapshot)` is null, or `!ctx.live && !ctx.liveAt` (never live this session: the glass keeps the last session's snapshot). Else 2.5's key order: `state` `quiet` when there are no babies (loss holding with no living child, pregnancy only), else `ok` (F3 keeps a living child's times); `at` = `ctx.now` while live, else `ctx.liveAt`; `twins` = `isTwins`; `lockScreen: { hide: ctx.lockHide }`; `activeBabyId`; `shortcuts`; `pregnancy: null`; `babies` via `snapshotBaby` with `label = (a) => widgetByLabel(a, ctx.viewerUid, ctx.memberInfo, ctx.formerMemberInfo)`, each baby's `moments` (at most 2, from `monthMoments(baby.birth, ctx.now)` in snapshotBaby) set to `[]` while `ctx.lossHolding` (F10: no month day on glass during her loss holding, even beside a living child; since-rules may not name it, contract note 18g). A `quiet` or `signedOut` snapshot has no babies, so no moments.
- `widgetShortcuts`: `[]` in pregnancy or with no babies; keys allowed = QUICK_ACTIONS with `widget.places` including `shortcut` and in `ctx.binary.shortcuts`; baby stage → feed, sleep, diaper, then the first of `ctx.chosen` allowed and not already in; child → `ctx.chosen` (QUICK_DEFAULTS.child, contract note 8) allowed; at most `shortcutsMax`.
- `widgetByLabel`: null for no author, `'local'` or the viewer; else memberInfo's then formerMemberInfo's relationship, else the name's first word; null if empty or containing `@`; over `byMax` code points → its first word if that fits, else the first `byMax` code points.
- index.html builds ctx from `state`, `window.LL` (`userLoaded = !!(LL.auth && LL.auth.currentUser && LL.hhBooted)`, `viewerUid`, `live`, `liveAt`, memberInfo, formerMemberInfo), `myLossHolding()`, `lockHidePref()` (false until Task 9), `quickStage()`, `QUICK_ACTIONS`, `__cubbyWidgetBinary`.
- `exportWidgetSnapshot`: returns at once with no binary (the web), no CubbyWidgetSnapshot, or while blocked; else debounces 400 ms, builds, and calls `cubbyWidget.setSnapshot(JSON.stringify(snap))` only when `JSON.stringify` of the snapshot with `at: 0` differs from the last write or `snap.at - lastAt >= restampMs`. A 60-second interval calls it while `LL.live`.
- `widgetWipe(reason)`, synchronous: cancel the pending export and forget the last write; `cubbyWidget.clear()`; for `signout`, `delete`, `accessLost`, `unauthorized` then `setSnapshot(buildSignedOutSnapshot(v, Date.now()))`; for those and `switch`, block exports until `LL.hhBooted` passes its value at the wipe; for `loss` and `endPregnancy`, call `exportWidgetSnapshot()` again (the quiet state, or a living child's times). `widgetCheckLoss()` in render calls `widgetWipe('loss')` when `myLossHolding()` turns on (the receiving device too).
- Live flags: a second `hhRef.onSnapshot({ includeMetadataChanges: true }, ...)` (shares the watch, as the PRIV-4 listener at :3034-3052 says) sets `LL.live = !fromCache && navigator.onLine !== false` and stamps `LL.liveAt` when not from cache; the events listener stamps `LL.liveAt` on a server snapshot; `window` `offline` sets `LL.live = false`.

- [ ] **Step 1: Write the failing tests**

widget-snapshot Section A2 (Node): `widgetByLabel` with memberInfo `{ uMum: { relationship: 'Mum' }, uDad: { relationship: 'Dad' }, uGran: { name: 'Grandma Priya' }, uMail: { name: 'priya@example.com' }, uLong: { name: 'Abcdefghijklmnop' } }`, formerMemberInfo `{ uEx: { name: 'Sam Lee' } }`, viewer uMum: `Dad`; null for uMum, `'local'`, undefined; `Grandma`; null for uMail (Review Focus 3); `Abcdefghijkl`; `Sam` for a member who left. `widgetVersion([1], [1,2]) === 1`, `([1], [2]) === null`, `([1], null) === null`. `widgetShortcuts`: default baby → `['feed','sleep','diaper','measure']`; chosen starting with voice on an iOS binary list → voice skipped; child → `['sleep','measure','milestone','activity']`; pregnancy and no babies → `[]`.
Section B (browser, fake Capacitor as Task 7 with versions `{ snapshot: [1], shortcuts: [feed, sleep, diaper, pump, activity, measure, milestone] }`):

```js
ok('B1 the boot paint writes nothing (hhBooted 0)', sets() === 0);
ok('B2 one write after boot, v 1', sets() === 1 && snap.v === 1);
// four boots, each with Robin: the viewer owns an expecting record (dueDate set); the same household seen by a
// caregiver; a trying record (stage 'planning'); a record with bornBabyId 'b1'. PREG = /dueDate|bornBabyId|planning|careTeam|kicks/
for (const who of ['owner', 'caregiver', 'trying', 'born'])
  ok('B2 pregnancy is null and no pregnancy field leaks: ' + who, snapOf[who].pregnancy === null && !PREG.test(jsonOf[who]));
ok('B3 anchors equal Home: deleted feed and open sleep present', same(snap.babies[0].last, homeAnchors));
ok('B4 illness gives only healthOpen: no illness name, temperature, medicine name or "pro" key in the JSON', !/Bronchiolitis|39\.2|Calpol/.test(json) && !/"pro/i.test(json));
// q: the viewer's own lossHolding and no baby; k: the same holding beside a living Robin
ok('B5 loss with no living child: state quiet, babies [], shortcuts []', q.state === 'quiet' && q.babies.length === 0 && q.shortcuts.length === 0);
ok('B5 loss with a living child: ok, and only that child', k.state === 'ok' && same(k.babies.map((b) => b.id), ['b1']) && k.pregnancy === null);
// F10. Every Section B boot pins the clock at N = 2026-11-17T03:14Z in UTC (Global Constraints) and seeds Robin born
// 2026-08-17T09:00Z, so k's Robin is on her month day too. s6: a boot with Robin and Wren, Wren with no birth.
ok('B6 moments: Robin\'s month 3 today, then month 4; Wren with no birth has none',
   same(s6.babies[0].moments, [{ at: Date.UTC(2026, 10, 17), unit: 'month', n: 3 }, { at: Date.UTC(2026, 11, 17), unit: 'month', n: 4 }])
   && same(s6.babies[1].moments, []));
ok('B6 loss with a living child: no moments, even on her month day', same(k.babies[0].moments, []));
ok('B6 moments are the last key of each baby, typed only', Object.keys(s6.babies[0]).pop() === 'moments'
   && s6.babies[0].moments.every((m) => Object.keys(m).join() === 'at,unit,n'));
```

Section C (Review Focus 1, 2): C1 30 renders in 2 s with nothing changed → at most 1 write; a new feed → exactly one more. C2 clock +10 min with `LL.live` → one re-stamp with the new `at`; `LL.live=false`, `liveAt=T0` → `at === T0`. C3 a render, then `widgetWipe('signout')` 100 ms later, wait 600 ms → the last call is `set` of a `signedOut` snapshot after `clear`, no write carries `Robin`, and another render writes nothing until `LL.hhBooted` rises.
Section D, every wipe trigger: `endPregnancy(true)` with a seeded owner pregnancy, a `lossHolding` arriving for the viewer then `render()`, and `LL.signOut()` each record `clear`. `deleteAccount`, `showAccessLost` and `joinPendingInvite` are closure functions that cannot run in ?e2e=1 without an account, so they are lifted from app/store-firebase.js and asserted to call `widgetWipe('delete')` after `window.__cubbyDeleting = true;`, `widgetWipe('accessLost')` after `accessLostShown = true;` and `widgetWipe('switch')` before each `location.reload`.
widget-logger Section 3: viewer uMum, last feed by uDad, nappy by uMum → `by` `{ feed: 'Dad', sleep: null, nappy: null }`; `lockScreen` is exactly `{ hide }`.
blob-sync, new section "LL.live follows the server": after sign-in, `LL.live === true` and `LL.liveAt` within 10 s; after `firebase.firestore().disableNetwork()`, `LL.live === false` and `liveAt` unchanged; after `enableNetwork()`, true again and `liveAt` later.

- [ ] **Step 2: Run and see it fail**: `node tools/gates.js --only=widget-snapshot,widget-logger`; Expected: FAIL from A2 on ("Cannot find module .../app/widget-snapshot.js"). `node tools/gates.js --emulator --only=blob-sync`; Expected: FAIL "LL.live follows the server".
- [ ] **Step 3: Implement app/widget-snapshot.js, the index.html block and hooks, the store-firebase hooks and flags; script tag, ASSETS, CACHE.**
- [ ] **Step 4: Run and see it pass**: `node tools/gates.js --only=widget-snapshot,widget-logger,usage-tracker,sleep-timer,offline,perf,rerender` and `node tools/gates.js --emulator --only=blob-sync`; Expected: all PASS.
- [ ] **Step 5: See the red runs**, each restored: plant `pregnancy: { week: 30 }` in the builder (B2 fails, the spec's "pregnancy to a caregiver"); drop the `at: 0` comparison (C1 fails); remove the debounce cancel from `widgetWipe` (C3 fails); drop `ctx.viewerUid` from widgetByLabel's null test (Section 3 fails, "name the viewer"); comment out the metadata listener (blob-sync fails); drop the `ctx.lossHolding` emptying of `moments` (B6 "no moments, even on her month day" fails, F10).
- [ ] **Step 6: Commit**

```bash
git add app/widget-snapshot.js
git commit -o app/widget-snapshot.js app/index.html app/store-firebase.js app/sw.js test/widget-snapshot.test.js test/widget-logger.test.js test/blob-sync.test.js -m "The app writes a typed widget snapshot after every paint, month days included and none during a loss, and wipes it before any exit from a family" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Hide details on the lock screen, per person

**Files:**
- Modify: `app/index.html` (after `saveQuickPrefs` at :4718: `lockHidePref`, `setLockHidePref`, `window.cubbyApplyWidgetPrefs`; `:8282` openSettings: a `.toggle-row` after the "What you log" row, the markup of :8347-8348 with `role="switch"` and `aria-checked` as at :10616; the export ctx's `lockHide`), `app/store-firebase.js:1252-1257` (resolveHousehold), `app/sw.js:3`, `test/widget-snapshot.test.js` (Section E)

**Interfaces:**
- Produces (roadmap 2.2, 2.4): `lockHidePref() -> boolean` reads localStorage `cubby-lockhide:<uid>` (`'1'` is on) for the signed-in uid; `setLockHidePref(on: boolean) -> void` writes it, mirrors `users/{uid}` with `set({ widget: { lockHide: on } }, { merge: true })` through `window.LL.db` when signed in, emits `widget.setting { setting: 'lock_hide', value: on ? 'on' : 'off' }`, re-renders the sheet and calls `exportWidgetSnapshot()`. `window.cubbyApplyWidgetPrefs(uid, widget)` sets the local key from a boolean `widget.lockHide` (the person's latest choice, from any phone); resolveHousehold calls it with the users doc it already reads at :1254.
- The row: title `app.lockHide`, helper `app.lockHideHelp`, shown only when `window.__cubbyHasWidgets && window.__cubbyHasWidgets.value === true` and `Capacitor.getPlatform() === 'ios'` (contract note 14: Android has no lock-screen widget, so its parents never see a switch that does nothing). No rules change: users/{uid} is the owner's to write (firestore.rules:11-13).
- Consumes: `window.__cubbyHasWidgets` (Task 7, the plugin's whole answer).

- [ ] **Step 1: Write the failing Section E**: E1 no row on the web (`__cubbyHasWidgets === false`); E2 the row on iOS (fake Capacitor `getPlatform() === 'ios'`, plugin answering `{ value: true, kinds: { medium: 1, small: 0, lock: 0 } }`); E2b no row on iOS when it answers `{ value: false, kinds: { medium: 0, small: 0, lock: 0 } }`; E2c no row on Android with the same `value: true` answer as E2 (E2 is the companion that proves the matcher finds the row when only the platform differs); E3 uMum turns it on, uDad on the same phone stays off, and each export carries that person's `lockScreen.hide`; the users-doc stub records `{ widget: { lockHide: true } }` with merge; `cubbyApplyWidgetPrefs('uMum', { lockHide: false })` turns her local key off; the tracker stub records `widget.setting` with `{ setting: 'lock_hide', value: 'on' }`; the row's title and helper equal widget-copy.json's text.
- [ ] **Step 2: Run and see it fail**: `node tools/gates.js --only=widget-snapshot`; Expected: FAIL from E2 (no row yet). E1, E2b and E2c pass for free until then; they count only once E2 finds the row.
- [ ] **Step 3: Implement; bump CACHE.**
- [ ] **Step 4: Run and see it pass**: `node tools/gates.js --only=widget-snapshot,set-item,touch-target,contrast,sideways-320`; Expected: all PASS.
- [ ] **Step 5: See it go red**, each restored: key the preference without the uid (one shared key): E3 "each person's own" fails; drop the iOS test from the row's condition: E2c fails; test `__cubbyHasWidgets === true` as before: E2 fails (the cached answer is an object).
- [ ] **Step 6: Commit**

```bash
git commit -o app/index.html app/store-firebase.js app/sw.js test/widget-snapshot.test.js -m "Hide details on the lock screen, a setting for each person, shown only on an iPhone with widgets" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

FOUNDER STEP (before Task 10's commit): keep or drop the dose notification's "Log it" button once the alert no longer names the medicine. Task 10 ships "keep": the button stays and its confirmation no longer names the medicine. If the answer is drop, stop after Task 10 Step 4 and raise it with the main session; dropping is not planned here.

### Task 10: Dose reminders stop naming the medicine on the lock screen (C6)

**Files:**
- Modify: `worker.js` (`DOSE_PUSH_COPY` and `dosePushCopy` above sendPushReminders at :1800; the plan entry at :1867; FCM `data` at :1899; `__dose` at :2437), `app/index.html:8211-8242` (`DOSE_PUSH_COPY` above syncReminderIndex; the med entry :8232 and the digest entry :8242 take its title and body), `app/sw.js:126-142` (the "Dose logged" body) and `:3`, `tools/gates.js`
- Create: `test/dose-push-copy.test.js`

**Interfaces:**
- Produces: `DOSE_PUSH_COPY = { med: { title: 'Medicine due soon', body: 'You have a dose to give in the next half hour.' }, digest: { title: 'Medicines today', body: "Open Cubby to see what's due today." } }` (chosen here; a pre-dose reminder fires 15 to 30 minutes before its dose and is dropped once the dose is due, index.html:8222-8225 and worker.js:1866, so "half hour" is always true, and the Worker needs no time zone) and `dosePushCopy(tag: string) -> { title, body } | null` (`med-` and `digest-` tags), on `__dose`. The plan entry becomes `const copy = dosePushCopy(_fsStr(f.tag));` with `title: copy ? copy.title : (_fsStr(f.title) || 'Cubby'), body: copy ? copy.body : _fsStr(f.body),`. FCM `data` drops `medName` (its one reader was the sw.js confirmation); the ticket and the `CUBBY_DOSE` category stay. sw.js success body: `It's on the record.`

- [ ] **Step 1: Write the failing test `test/dose-push-copy.test.js`**

Section 1 drives the real `__dose.sendPushReminders` against a fake Google built like test/dose-membership.test.js:96-157 (token, the users query, the household read for the membership gate, the cursor PATCH, FCM capture), with stored entries naming `Calpol 5ml` and a digest `Today with Ada` / `Medicines today: Calpol, Ibuprofen`:

```js
ok('1a the reminder reads the fixed copy', same(med.notification, COPY.med));
ok('1b the digest reads the fixed copy', same(dig.notification, COPY.digest));
ok('1c no medicine, dose or baby name in any notification or data value but the ticket',
   !/Calpol|Ibuprofen|Ada|5ml/.test(JSON.stringify([med.notification, dig.notification, strip(med.data, 'nonce'), dig.data])));
ok('1d the Log it ticket and category stay', !!med.data.nonce && med.apns.payload.aps.category === 'CUBBY_DOSE');
ok('2 the client writes the same copy, never a name', entries.every((e) => same({ title: e.title, body: e.body }, COPY[kind(e)])));
ok('3 the sw.js confirmation names no medicine', shown.body === "It's on the record.");
```

Section 2 lifts syncReminderIndex and `DOSE_PUSH_COPY` from app/index.html into a `vm` with stubs (`state.meds`, `medFireTimes`, `medIntervalMs`, `activeBaby`, `myUid`, `LL.db` recording `set`, `firebase.firestore.FieldValue.delete`) and checks `DOSE_PUSH_COPY` deep-equals the Worker's. Section 3 runs app/sw.js's `notificationclick` in a `vm` (`self` stub, `fetch` resolving ok) with `data.medName: 'Calpol'`. `--self-test` re-runs the suite on mutants (temp copies of worker.js with workers imports rewritten to `file://` paths, as test/dose-membership.test.js:458-493): the stored title used again (`copy ? copy.title : ` removed), `medName` back in `data`, the client title back to `(m.name||'Medicine')+' soon'`, the sw.js body back to the `d.medName` prefix; each must turn it red. Register `{ name: 'dose-push-copy', cmd: ['node', 'test/dose-push-copy.test.js', '--self-test'] }`.

- [ ] **Step 2: Run and see it fail**: `node tools/gates.js --only=dose-push-copy`; Expected: FAIL 1a, 1b, 1c (the stored names reach the notification), 2 and 3.
- [ ] **Step 3: Implement; bump CACHE.**
- [ ] **Step 4: Run and see it pass**: `node tools/gates.js --only=dose-push-copy,dose-membership,dose-ticket,push-delivery,push-caps,push-daily,medalarm,dosecal,fuzz-worker`; Expected: `DOSE-PUSH-COPY: PASS` with every mutant caught; the rest PASS.
- [ ] **Step 5: Commit**

```bash
git add test/dose-push-copy.test.js
git commit -o worker.js app/index.html app/sw.js tools/gates.js test/dose-push-copy.test.js -m "Dose reminders no longer name the medicine on the lock screen, and the Worker rewrites the copy for every phone" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After Task 10

- [ ] `node tools/gates.js` and `node tools/gates.js --emulator` both PASS on this tree (the pushed range touches worker.js, workers/ and store-firebase.js, so pre-push runs the emulator tier too).
- [ ] `node tools/claudemd_check.js` PASS (no path in CLAUDE.md moved).

FOUNDER STEP: yes to the push to main (push = deploy). No rules publish is needed for P1. After the push, confirm on the live site in about 3 minutes: `curl -s https://little-cubby.com/app/sw.js | grep -o "little-log-v[0-9]*"` prints the last CACHE of this plan, and `curl -s -o /dev/null -w "%{http_code}" https://little-cubby.com/native-ios/CubbyWidget/Generated.swift` prints 404.
