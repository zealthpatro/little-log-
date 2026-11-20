# iOS Widgets Phase A Implementation Plan

> **Contract note (F12, roadmap 2.3):** the small widget renders `row.whose` where `by` would go (after the ago line: "1 hr, 5 min ago · Robin"). Native `WCopy.fill` substitutes placeholders in ONE pass (baby names are free text; a baby named "{age}" must not be re-substituted), with a fixture named "{age}" in the golden tests (`small-both-name-is-a-placeholder`).
> Row gains `whose: String?` and `label` becomes optional (`String?` in Swift and Kotlin). When `label` is null the label line is `row.baby` alone, never "Robin and Wren · ". `whose` is a baby's name, not the logger, so `WidgetPrivacy.located` keeps it (it strips only `by` and `header.moment`); `wordmarkOnly` still hides the whole widget. On iOS `whose` follows the ago line ("1 hr, 5 min ago · Robin"). The generated `WCopy.fill` is ONE left-to-right scan (a value is never rescanned; an unknown {key} stays literal), so a baby named "{age}" or "{time}" is safe: the goldens must run `moment-small-name-is-age`, `small-both-name-is-time` and `small-both-name-is-a-placeholder`. Swift Dictionary order is random, so a golden over those cases cannot rely on order to catch a key-by-key fill: P3 must also assert the generated `fill` is a scan: a unit test: `fill("{name} · {age}", ["name": "{age}", "age": "{name}"])` must equal "{age} · {name}" (a key-by-key fill gives "{name} · {name}" or "{age} · {age}" whichever key it visits first, so this pair bites in either order). On a small widget on Both for twins, M15 runs over the selection with `twins.moment.*` (roadmap 2.3); the label line draws `moment.text`; the line under the clock is the ago line + `sepDot` + `whose`, with no type word on iOS; Android keeps "last feed · Robin".

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Cubby's medium, small and lock-screen widgets on testers' iPhones through TestFlight, where every tap opens Cubby on the right sheet with the right baby (or Both), fed only by the snapshot the app writes.

**Architecture:** Native source is tracked in `native-ios/` and copied into the gitignored `ios/` by `tools/cap_ios_configure.rb`, which also creates the `CubbyWidget` extension target, a hostless `CubbyWidgetTests` target and scheme, per-target entitlements, and the `CubbyBridgeViewController` that registers the `CubbyWidget` Capacitor plugin. One pure Swift function, `WidgetModel.render`, ports P1's `tools/widget_model.js` and is held to P1's golden fixtures by XCTest; SwiftUI views only draw its `ViewModel`, and every button is a `Link` to the roadmap 2.7 router URL. Mac-only checks (`tools/ios_widget_check.sh`, `tools/ios_launch_smoke.sh`) run inside `tools/cap_ios_build.sh`; the web side adds `widget.installed`, the illness line and the stack helper behind tree gates.

**Tech Stack:** Swift 5, SwiftUI, WidgetKit, AppIntents (extension floor iOS 17.0, host 15.0); Capacitor 8.4 (`CAPBridgedPlugin`); Ruby `xcodeproj` 1.28.1; Xcode 27.2 (iOS 26.5 and 27.0 simulators, iPhone Duo device type); bash; Node (`vm`, puppeteer-core) for tree gates.

**Spec:** /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/specs/2026-11-16-home-screen-widgets-design.md (and the roadmap /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c/docs/superpowers/plans/2026-11-17-widgets-0-roadmap.md; its section 2 is the contract, every name below is copied from it).

## Before you start

- P1 is in this branch: `ls docs/widgets/widget-copy.json docs/widgets/widget-fixtures.json tools/widget_gen.js tools/widget_model.js native-ios/CubbyWidget/Generated.swift app/widget-snapshot.js app/since-rules.js` lists all seven, and `node tools/gates.js --only=widget-parity,widget-snapshot,widget-deeplink` passes. If not, stop. Those files are P1's; this plan cites no line numbers inside them.
- `grep -o "little-log-v[0-9]*" app/sw.js` before any browser gate, and curl the changed string from the server the gate starts (CLAUDE.md, "Verify against THIS tree").
- Lines below are for 58733b16. P1 and lane L edit some of the same files first; re-find each anchor by its quoted text before editing.
- P1 carries the accepted contract changes this plan reads: `grep -c '"tz"' docs/widgets/widget-fixtures.json` is at least 1; every fixture's `expect` has a top-level `url` and each row an `a11y`; widget-copy.json has `app.stackHelp` and `app.healthSwitched` (both `on: ["app"]`); and `window.__cubbyHasWidgets` caches the whole `{ value, kinds }` answer (`grep -n "__cubbyHasWidgets" app/native-bridge.js`). If any is missing, stop and raise it against P1; do not work around it here.
- P1 carries F10 (month days): `grep -c "monthMoments" app/since-rules.js` is at least 1; `grep -c '"moments"' docs/widgets/widget-fixtures.json` is at least 1 and at least one fixture's `expect.header.moment` is non-null; widget-copy.json has the sixteen keys `moment.*`, `small.moment.*`, `twins.moment.*`, `a11y.moment.*` (each `month1`, `months`, `year1`, `years`); `grep -n "monthcard" app/native-bridge.js app/index.html` finds the router target. If any is missing, stop and raise it against P1.

## Contract notes

The roadmap accepted each of these on 17 Nov (2.3, 2.5, 2.7, 2.10 and its Swift type ownership now say them). They stay here so each task's choice keeps its reason.

1. **Mac-only tests in ALLOW (2.10).** `tools/test_wiring_check.js` only lists `test/*.js` and `tools/*_{check,gate,test}.js` as candidates (:46-61), and an ALLOW entry for any other file is red ("ALLOW names X, which is not a test file", :125). Task 1 widens the candidates to 2.10's four shapes: `tools/*_check.sh`, `tools/*_smoke.sh`, `native-ios/Tests/*Tests.swift` and `native-android/app/src/test/java/com/littlecubby/app/widget/*Test.kt` (P6 then adds only its ALLOW entries). `ranBy` is a basename text match (:121), so the `CubbyWidgetTests` scheme is represented by its Swift files, each `ranBy: 'tools/ios_widget_check.sh'` (which names every file and runs the scheme); `tools/ios_widget_check.sh` and `tools/ios_launch_smoke.sh` are `ranBy: 'tools/cap_ios_build.sh'`.
2. **AppIntents needs literal titles (2.3).** The AppIntents metadata processor reads `static let title`, `IntentDescription`, `@Parameter(title:)` and `typeDisplayRepresentation` as compile-time constants, so they cannot be `WCopy` references in hand-written code. `tools/widget_gen.js` emits `MediumConfig`, `SmallConfig`, `LockConfig` and the two entities' `typeDisplayRepresentation` into `Generated.swift` as literals from widget-copy.json, inside `#if CUBBY_WIDGET_EXT` (set only on the extension and test targets, so the App target compiles the rest of `Generated.swift` without them). P4 adds NapIntent's title and parameter titles to the same block, as rows of the same emitter table. P1's parity gate treats these generated `WidgetConfigurationIntent`s as generated (they write nothing).
3. **Generated colours and key lookups (2.3).** The widget needs the app's day and night tokens ("the app wins", spec 6.1), so Task 2 adds `WColor`/`WColors` to both Generated.swift and Generated.kt, resolved from app/index.html's `:root{` (:101) and `[data-theme="night"]{` (:343) blocks, and the two key lookups 2.3 names: Swift `WCopy.text(_ key:) -> String?` and Kotlin `WCopy.byKey: Map<String, Int>` (P6 note 3).
4. **Fixture time zone (2.3).** `fmtClock` (index.html:2189-2194) reads the machine's zone. widget-fixtures.json is `{ source, tz: "UTC", fixtures }` and `renderModel` formats in UTC (P1 note 5); the XCTest sets `NSTimeZone.default` from `tz` (a missing `tz` reads as `"UTC"`). Production draws in the phone's zone.
5. **Copy keys: P1 is the producer.** P3 uses P1's keys by name: `gallery.mediumTitle`, `gallery.mediumDescA`, `gallery.smallTitle`, `gallery.smallDesc`, `gallery.lockTitle`, `gallery.lockDesc`, `config.baby`, `config.both`, `config.yourButton`, `config.firstButton`, `config.secondButton`, `config.description`, `word.cubby`, `time.am`, `time.pm`, `sep.dot`, `app.stackHelp`, `app.healthSwitched`, and F10's sixteen month-day keys (`moment.*`, `small.moment.*`, `twins.moment.*`, `a11y.moment.*`, each `month1`, `months`, `year1`, `years`; the model fills them, the views only draw `header.moment`). It adds only `config.smallDesc` and `config.buttonType` (Task 2). P1's model returns final display text (only `message` holds a key), so no join or format key exists: the views put `sep.dot` between a row's label and its `by`, between the header's name and age (or the month day that replaces the age), and, on a small month day, between the type and the ago line.
6. **Widget body URL (2.3, 2.7).** The ViewModel's top-level `url` is the body link, built by P1's model and ported in Task 4: `https://little-cubby.com/app/?baby=<id>&from=widget` for one baby, `?from=widget` otherwise, `?go=sleep&baby=<id|both>&from=widget` while a noConnection or notSaved line shows, and `?go=monthcard&baby=<id>&m=<total months>&from=widget` on a month day with no such line (F10, note 11). P1's router applies `baby` before the open (applyDeepLinkBaby), and a link with `baby` and no `go` sets the active baby and stays on Home, so a sibling's widget never opens the other child's Home. P6 draws the same field.
7. **Three new tree gates (2.10):** `widget-gen-ios` (Task 2), `widget-ios-app` and `widget-ios-app-ui` (Task 7).
8. **`window.__cubbyHasWidgets` (2.2, 2.6)** caches the plugin's whole answer, `{ value, kinds: { medium, small, lock } }`, and is `false` on the web. Task 7 reads that answer and nothing else. P1's lock-screen switch shows only when `value` is true on iOS.
9. **Swift `WActions` is per platform.** 2.3 lists no `platforms` field, so P3 assumes the Swift `WActions.all` already omits Android-only actions (`voice`); Task 2's test asserts it.
10. **Who declares which Swift type (roadmap, Swift type ownership).** P3 declares `AppSnapshot` and its parts, `FixtureInput` without `nap` or `pull`, `ViewModel`, `SnapshotDecode.app` and `WidgetModel.render`, whose anchor-reading lives in one function, `WidgetModel.babyView(_:at:)`. P4 declares `NapState` and adds `FixtureInput.nap`. P5 declares `PullSnapshot`, `PullBaby`, `SnapshotDecode.pull` and `FixtureInput.pull`, and writes the 2.5 merge (its Task 7 table) into native-ios/Shared/WidgetModel.swift, feeding `babyView(_:at:)`; there is no separate merge file. P3's golden test runs the Phase A fixtures whose `nap` and `pull` are null. `WidgetStore` (P3) knows all five 2.5 keys and `clearAll()` removes all five from the first build; P4 and P5 add their writers.
11. **Month days (F10, roadmap 2.3 and 2.5).** The app writes each baby's next two month days into the snapshot (`moments: [{ at, unit, n }]`, from P1's `monthMoments`; `[]` with no birth, during loss holding or when state is not `ok`), so Swift never does month arithmetic: the birth on the 31st, month 12, month 24 and the skipped month 25 are P1's since-rules cases, not ported. P3 ports only M15 (a moment is active when `m.at <= now < m.at + 86400000`), `header.moment: { text, a11y } | null`, and M12's month-card branch of the body `url` (`?go=monthcard&baby=<id>&m=<total months>&from=widget`, m = 12 for "1 year today", twins: the first baby with the day; a noConnection or notSaved line still wins, which is P4's to test because Phase A fixtures carry no `nap`). The views draw `header.moment` and the `url` they are given; they add no link logic. Lock families carry no moment. P5's PullSnapshot babies carry the same `moments`, and its merge feeds them to `babyView(_:at:)`.

## Global Constraints

- Extension `CubbyWidget`, bundle id `com.littlecubby.app.widget`, floor iOS 17.0; host stays 15.0 (pbxproj:243, 294, 313, 339).
- App Group `group.com.littlecubby.app` on both targets; keychain access group `F5NVQV7NVB.com.littlecubby.app.shared` written with the literal prefix (cap_ios_build.sh:92 signs the file as written); Team `F5NVQV7NVB`.
- Kinds `cubby.medium` (systemMedium), `cubby.small` (systemSmall), `cubby.lock` (accessoryRectangular, accessoryInline). No pregnancy kind is compiled (F4).
- Configuration intents `MediumConfig` (baby, button), `SmallConfig` (baby, first, second), `LockConfig` (baby: each baby, no Both); AppEntity `BabyEntity`. Edit Widget holds which baby and the button(s), nothing else (D7, F9).
- Phase A: every tap opens Cubby through `Link(url)`. No AppIntent that writes; `NapIntent` does not exist yet. `versions().inPlace` is `false`.
- URLs: `https://little-cubby.com/app/?go=<go>&baby=<babyId|both>&from=widget`; long-press `?go=<go>&from=shortcut` (no baby); the widget body opens the ViewModel's `url` (`?baby=<id>&from=widget` for one baby, `?from=widget` otherwise, `?go=monthcard&baby=<id>&m=<total months>&from=widget` on a month day, F10).
- Shared container keys `appSnapshot` (app only), `napState`, `pullSnapshot` (each a JSON string), `pokedAt`, `pullTriedAt` (JSON numbers, P5 writes them), in `UserDefaults(suiteName: "group.com.littlecubby.app")`; every clear removes all five; none of it backed up.
- Who logged it ("· Dad") shows on the home screen only. Never on the lock screen, in StandBy, in iPhone widgets on a Mac or on the iPad lock screen, whatever "Hide details on the lock screen" says (F7).
- Rules from WRules: staleMs 21600000, dayRuleMs 72000000, healthReturnMs 1209600000, twinsToleranceMs 86400000, nameMax 20, byMax 12, shortcutsMax 4, asleepNowMinWidth 84. Defaults: medium4 `activity`, small `["sleep", "feed"]`.
- Layout floor: medium 321x148pt, small 148x148pt; every hit frame at least 44pt tall and wide; medium margins 14pt, small 12pt (`contentMarginsDisabled`); button columns Sleep 1.3fr, the other three 0.9fr.
- Type: name 15pt display (Fraunces 600), number 15pt body weight 800 (Nunito Sans), labels and ago lines 11pt, button labels 12pt; `lineLimit(1)` and `minimumScaleFactor(0.85)` on every text; Dynamic Type capped at `.xxLarge`. Small: clock digits 28 to 34pt display face, AM or PM 13pt body.
- Colour: opens-Cubby buttons wear their category's soft fill and ink; at night (and in accented rendering) every opens-Cubby button gets a 1pt stroke in its category hue; the fourth slot always wears the quiet (note) kind; "not yet" is `--ink-soft`. Lock screen uses the system's vibrant primary and secondary only, never hex.
- The arrow is a drawn symbol, 11pt, stroke 2, at the button's top right, on every button that opens Cubby.
- Header truncation: the freshness text never truncates; the age (or the month day in its place, whole, F10) goes first, then the name tail-truncates.
- The ago line never shows seconds. Every time on glass is fmtClock's 12-hour form ("2:10 AM"), Latin digits, whatever the device's locale.
- Copy lives in docs/widgets/widget-copy.json only; hand-written Swift holds no user-facing literal (no string literal inside `Text`, `Button`, `Label`, `DisplayRepresentation`, `.configurationDisplayName`, `.description`). Sentence case, no em-dash, none of "don't forget", "last chance", "time for", "streak", "goal", "Pro", "total"; no question mark on the lock screen.
- Never write the plural plist key `UIApplicationShortcutItems` in native-ios/ or tools/cap_ios_configure.rb, not even in a comment (P1's parity gate fails on it; shortcuts are dynamic only). The class `UIApplicationShortcutItem` and the `shortcutItems` property are fine.
- Text only on glass: no photos, avatars, illness detail, mood, notes, medicine or Pro, ever.
- Month days (F10, fixed 17 Nov): month days on the widget, nothing else. On a baby's month day the model's `header.moment.text` takes one place only: the medium header's age slot ("3 months today"), the small widget's label line ("Robin · 3 months today", with the type "last feed" moving to the line under the clock time, before the ago line and F7's `by`), or the twins header ("Robin and Wren · 3 months today"; one twin's name when only one has the day). It is drawn in the honey ink `WColors.feedInk` (#895D24 day, #E0A655 night) after a small star glyph that VoiceOver skips (the element reads `header.moment.a11y`); it is drawn whole or not at all. Times, statuses and buttons never move. Home screen only: `header.moment` is hidden wherever `by` is hidden (StandBy, a Mac, the iPad lock screen) and never drawn by the lock views. The body opens the ViewModel's `url`, which the model points at the month card that day; no view builds a link. Nothing during loss holding (the snapshot's `moments` is `[]`). Not built: the 6 October takeover card ("Robin is 3 months old today" + "Make a card"), marked firsts, comparisons, streaks.
- No push in this plan; TestFlight uploads and portal changes are the founder's.

## Review Focus

1. The phone changes time zone, a DST night has 25 hours, or the phone is set to 24-hour time or another region (en_GB, de_DE, ar_AE): clock times and day labels follow the zone the phone is in now, the next local midnight is a real midnight, not now + 24h, and glass still reads "2:10 AM" in Latin digits, as Home does (Task 4, `ClockTests`, `BoundaryTests` and the formatter guard in `ios_widget_check.sh`).
2. A home-screen widget shown somewhere that is not the home screen, with "Hide details" off: StandBy on the nightstand, iPhone widgets on a Mac, the iPad lock screen. The times show; the logger's name never does (F7) (Task 6, `testPrivacyTable`).
3. A 20-character or non-Latin baby name ("Alexandria Catherine", "نور الهدى", a name with an emoji) at xxLarge on the 321pt floor: "Updated 3:14 AM" stays whole and the name tail-truncates (Task 6, `RenderTests`).
4. A snapshot written by a different web build: extra fields, a null anchor, a `v` this binary does not read, a wrong type, malformed JSON, a shortcut key this binary does not know (or a pregnancy one): wordmark or skip, never a crash, never old data (Task 4 `SnapshotDecodeTests`, Task 5 `PluginTests`).
5. Edit Widget picks that went stale: the configured baby left or the household changed, a button key this binary does not offer, the same button picked twice in a restored configuration, which falls back to the next default (P1 M9) (Task 6, `EntityTests`; fixture `small-repeat-pick`).
6. A baby's month day (F10): the day before and the day after read the age; the line turns on at the snapshot's `at` and off at `at + 86400000` without the app opening (a DST day included); month 12 reads "1 year today" and opens the 12-month card; twins share one line only when both have the same day; a long name at xxLarge drops the line whole rather than cutting "3 months to"; StandBy, a Mac and the iPad lock screen read the age with no star; loss holding draws nothing (Task 4 month-day tests and `BoundaryTests`, Task 6 `testPrivacyTable` and goldens, Task 9 walk).

## File map

| Path | Task | Holds |
|---|---|---|
| native-ios/App/CubbyBridgeViewController.swift, CubbyWidgetPlugin.swift | 3, 5 | App target only: plugin registration, the four Phase A plugin methods |
| native-ios/Shared/*.swift | 3-5 | App, extension and tests: kinds, snapshot types, model, clock, links, timeline boundaries, store, shortcuts |
| native-ios/CubbyWidget/*.swift, Info.plist | 3, 6 | Extension: bundle, providers, entities, layout, views (Generated.swift is P1's, extended in Task 2) |
| native-ios/Tests/*Tests.swift, Tests/Goldens/*.png | 3-6 | XCTest, run by tools/ios_widget_check.sh |
| tools/cap_ios_configure.rb, cap_ios_build.sh, ios_launch_smoke.sh, ios_widget_check.sh | 3, 5, 8 | Project, signing, Mac-only gates |
| tools/widget_gen.js, docs/widgets/widget-copy.json, test/widget-gen-ios.test.js | 2 | Colours, key lookups, literal intents, two config keys, the `small-repeat-pick` case |
| app/native-bridge.js, app/widget-snapshot.js, app/index.html, workers/usage/core.mjs, .telemetry/tracking-plan.yaml, test/widget-ios-app.test.js | 7 | `widget.installed`, the Health line, the stack helper |

## Founder steps (not tasks)

- FOUNDER STEP: yes to install `fonttools` and `brotli` for python3 (Task 6 converts the app's woff2 fonts) and, if no tester has an iOS 17 iPhone, to download the iOS 17.5 simulator runtime (Task 9 proofs).
- FOUNDER STEP: Apple portal: App ID `com.littlecubby.app.widget`; App Group `group.com.littlecubby.app` on both App IDs (permanent); profiles refreshed. Blocks Task 8's export and Task 9.
- FOUNDER STEP: register a device or add internal TestFlight testers (zero devices, cap_ios_build.sh:7-10). Blocks Task 9.
- FOUNDER STEP: look approved for the two-line toast and the settings helper (Task 7 mockup).
- FOUNDER STEP: yes to each TestFlight upload (`bash tools/cap_ios_build.sh`, Task 9).
- FOUNDER STEP: Task 7's web changes go live with whichever push to main the founder next approves; they are inert on the web.

---

### Task 1: Native code counts as product code, and Mac-only native tests are named

**Files:**
- Modify: `tools/change_test_check.js:38-40` (PRODUCT, TESTISH), self-test after `:189`
- Modify: `tools/test_wiring_check.js:34-44` (ALLOW), `:46` (CANDIDATE_RES), `:50` (listCandidates dirs), self-test after `:164`
- Modify: `docs/TESTING.md:58-79` ("Adding a test so the wiring gate is happy")
- Test: both files' `--self-test` (gates `change-test`, `test-wiring`)

**Interfaces:**
- Produces: `PRODUCT` gains `/^native-ios\//`; `TESTISH` gains `/^native-ios\/Tests\//`; `CANDIDATE_RES` gains `/^tools\/[^/]+_(check|smoke)\.sh$/`, `/^native-ios\/Tests\/[^/]+Tests\.swift$/` and `/^native-android\/app\/src\/test\/java\/com\/littlecubby\/app\/widget\/[^/]+Test\.kt$/` (2.10's four shapes, contract note 1); `listCandidates` reads `['test', 'tools', 'native-ios/Tests', 'native-android/app/src/test/java/com/littlecubby/app/widget']` (a missing directory reads as empty, as today). Every later task that creates a Mac-only test file adds its ALLOW entry in the same commit; P6 adds its Kotlin files' entries (`ranBy: 'tools/android_widget_check.sh'`).

- [ ] **Step 1: Write the failing self-test cases**

In `tools/change_test_check.js`, after `:189`:
```js
w('native-ios/CubbyWidget/MediumView.swift', 'v\n'); const nativeOnly = commit('a widget view');
r = judge(t, rangesFromStdin(t, stdin(nativeOnly, plainTest)));
ok('a native-ios-only push is RED (the widget ships in the binary)', r.ok === false && r.product.includes('native-ios/CubbyWidget/MediumView.swift'), r);
ok('and it stays on the tree tier', r.tier === 'tree', r.tier);
w('native-ios/Tests/WidgetGoldenTests.swift', 't\n'); const nativeTest = commit('and its XCTest');
r = judge(t, rangesFromStdin(t, stdin(nativeTest, plainTest)));
ok('native-ios code with a native-ios/Tests change is GREEN', r.ok === true && r.tests.includes('native-ios/Tests/WidgetGoldenTests.swift'), r);
```
In `tools/test_wiring_check.js`, after `:164` (re-plant the fully wired gates.js of `:140` first):
```js
const base = { 'test/new-incident.test.js': { reason: 'one-off probe kept for the postmortem' }, 'tools/ghost_check.js': { reason: 'run from the runbook by hand' } };
const KT = 'native-android/app/src/test/java/com/littlecubby/app/widget';
fs.mkdirSync(path.join(t, 'native-ios', 'Tests'), { recursive: true }); fs.mkdirSync(path.join(t, KT), { recursive: true });
w('tools/ios_x_check.sh', ''); w('native-ios/Tests/FooTests.swift', ''); w('native-ios/Tests/Helper.swift', ''); w(KT + '/FooTest.kt', '');
f = check(t, base, false);
ok('an unexcused Mac-only shell gate is caught by name', f.some((x) => /tools\/ios_x_check\.sh is run by nothing/.test(x)), f);
ok('an unexcused XCTest file is caught by name', f.some((x) => /native-ios\/Tests\/FooTests\.swift is run by nothing/.test(x)), f);
ok('an unexcused Kotlin widget test is caught by name', f.some((x) => /widget\/FooTest\.kt is run by nothing/.test(x)), f);
ok('a Swift helper that is not *Tests.swift is not a candidate', !f.some((x) => /Helper\.swift/.test(x)), f);
w('tools/runner.sh', 'bash tools/ios_x_check.sh  # runs FooTests.swift and FooTest.kt\n');
f = check(t, Object.assign({}, base, { 'tools/ios_x_check.sh': { reason: 'needs Xcode and a simulator', ranBy: 'tools/runner.sh' },
  'native-ios/Tests/FooTests.swift': { reason: 'XCTest, needs a simulator', ranBy: 'tools/runner.sh' },
  [KT + '/FooTest.kt']: { reason: 'JVM unit test, needs the Android SDK', ranBy: 'tools/runner.sh' } }), false);
ok('all three are green once excused by a ranBy that names them', f.length === 0, f);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node tools/gates.js --only=change-test,test-wiring`
Expected: FAIL, with `FAIL a native-ios-only push is RED` and `FAIL an unexcused Mac-only shell gate is caught by name` in the output.

- [ ] **Step 3: Implement the regex and directory changes listed under Interfaces, and the ALLOW entry the wider net now needs**

`tools/ios_launch_smoke.sh` becomes a candidate the moment `_smoke.sh` matches, so add:
```js
'tools/ios_launch_smoke.sh': { reason: 'needs Xcode and an iOS simulator, which CI and the tree runner do not have; the build stops on red before archiving', ranBy: 'tools/cap_ios_build.sh' },
```
`docs/TESTING.md:58-79`: the candidate list names the four new shapes, and step 4 says a Mac-only file is excused with `ranBy` the script that runs it.

- [ ] **Step 4: Run and pass**

Run: `node tools/gates.js --only=change-test,test-wiring`
Expected: `CHANGE-TEST SELF-TEST: PASS` and `TEST-WIRING: PASS`, and the real-tree line counts one more excused file than before.

- [ ] **Step 5: Commit**

```bash
git commit -o tools/change_test_check.js tools/test_wiring_check.js docs/TESTING.md \
  -m "Native widget code counts as product code, and its Mac-only tests must be named" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The generator writes Cubby's colours and the Edit Widget wording into native code

**Files:**
- Modify: `tools/widget_gen.js` (P1; its Swift and Kotlin emitters)
- Modify: `docs/widgets/widget-copy.json` (P1's file: two `strings`, one `differences` entry, one `cases` entry, all listed below)
- Regenerate: `native-ios/CubbyWidget/Generated.swift`, `native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt`, `native-android/app/src/main/res/values/widget_strings.xml`, `docs/widgets/widget-fixtures.json` (its `source` hash follows widget-copy.json)
- Create: `test/widget-gen-ios.test.js`
- Modify: `tools/gates.js`, a new `TREE.push(...)` block after `:279`

**Interfaces:**
- Consumes (P1): `generate(root) -> { [relPath]: string }`; `node tools/widget_gen.js [--check]`; the 2.3 naming rule (`status.lastFeed` -> `WCopy.statusLastFeed`).
- Produces in Generated.swift:
```swift
struct WColor { let day: UInt32; let night: UInt32 }
enum WColors { static let surface2, ink, inkSoft, line, feed, feedSoft, feedInk, sleep, sleepSoft, sleepInk,
               diaper, diaperSoft, diaperInk, pump, pumpSoft, pumpInk, note, noteSoft, noteInk, onSleep: WColor }
extension WCopy { static func text(_ key: String) -> String? }   // dot key -> text, every key whose platforms include ios
#if CUBBY_WIDGET_EXT
struct MediumConfig: WidgetConfigurationIntent   // @Parameter baby: BabyEntity? (optionsProvider: BabyOptions()), button: ButtonEntity? (MediumButtonOptions())
struct SmallConfig: WidgetConfigurationIntent    // baby (BabyOptions()), first (SmallFirstOptions()), second (SmallSecondOptions())
struct LockConfig: WidgetConfigurationIntent     // baby (LockBabyOptions())
extension BabyEntity { static let typeDisplayRepresentation: TypeDisplayRepresentation = "Baby" }     // config.baby
extension ButtonEntity { static let typeDisplayRepresentation: TypeDisplayRepresentation = "Button" } // config.buttonType
#endif
```
  and in Generated.kt `data class WColor(val day: Long, val night: Long)`, `object WColors` with the same names (`0xFF` alpha prefix), and `WCopy.byKey: Map<String, Int>` (every key whose platforms include android, dot key -> `R.string.w_<snake>`). The entities and option providers are Task 6's; only these generated lines name them. P4 adds NapIntent's rows to the same intents table (contract note 2).
- Copy keys (contract note 5). Used by name from P1, never added here: `gallery.mediumTitle`, `gallery.mediumDescA` (Phase A; P4 moves the medium to `mediumDescB`), `gallery.smallTitle`, `gallery.smallDesc`, `gallery.lockTitle`, `gallery.lockDesc`, `config.baby`, `config.both`, `config.yourButton`, `config.firstButton`, `config.secondButton`, `config.description`, `word.cubby`, `time.am`, `time.pm`, `sep.dot`, `app.stackHelp`, `app.healthSwitched`, and F10's sixteen month-day keys (contract note 11). Added here, and nothing else:

| Key | Text | on | platforms |
|---|---|---|---|
| config.smallDesc (chosen here) | "While your baby is unwell, your second button shows Health, then goes back." | config | ios, android (P6's `configSmallDesc`) |
| config.buttonType (chosen here) | "Button" | config | ios, with a `differences` entry: "ButtonEntity's type name in Edit Widget; Android's configuration screen has no entity type" |

Intent titles: MediumConfig `gallery.mediumTitle`, SmallConfig `gallery.smallTitle`, LockConfig `gallery.lockTitle`; descriptions `config.description` (MediumConfig), `config.smallDesc` (SmallConfig), none for LockConfig. Parameter titles: baby `config.baby`, button `config.yourButton`, first `config.firstButton`, second `config.secondButton`.
- One case added to P1's `cases` (Review Focus 5): `small-repeat-pick` (ios, phase A, family small): medium-a-basic's `app` and `now`, config `{ baby: null, first: "feed", second: "feed" }`; hand-written `expect` pins the buttons' `k` as `feed`, `sleep` and labels `Feed`, `Sleep` (P1 M9: a repeated pick falls back to the next default; the second slot's own default, `feed`, is already the first pick, so `sleep` takes the slot). Task 4's golden runs it; Task 6's `testStalePicksFallBack` names it.

- [ ] **Step 1: Write the failing test `test/widget-gen-ios.test.js`**

It exports `checkIosGenerated(swift, kotlin, copy) -> string[]` (failure lines) and runs four sections, printing `WIDGET-GEN-IOS: PASS|FAIL`:
1. Resolution, on a temp root holding copies of every input `generate` reads: change `--feed:#E29A3B` in `:root` to `#123456` and night `--feed:#E0A655` to `#ABCDEF`; assert Swift has `feed = WColor(day: 0x123456, night: 0xABCDEF)`, `feedInk` night `0xABCDEF` (night `--feed-ink:var(--feed)` followed), and Kotlin `0xFF123456`; change night `--on-accent` and assert `onSleep.night` follows (`--on-sleep:var(--on-accent)`, index.html:408).
2. The real tree: all 20 tokens have a 6-digit hex in both modes and no `var(` survives; `WCopy.text` has a case for every key whose platforms include ios (and none for `a11y.sayItFor`, android only), and `byKey` an entry for every android key, each `R.string.w_<snake>`; `config.smallDesc` and `config.buttonType` read as the table above. F10's honey ink: Swift has `feedInk = WColor(day: 0x895D24, night: 0xE0A655)` and Kotlin `0xFF895D24` / `0xFFE0A655`. F10's sixteen keys each have a `WCopy.text` case (and a `byKey` entry) whose text is exactly: `moment.month1` "1 month today", `moment.months` "{age} months today", `moment.year1` "1 year today", `moment.years` "{age} years today"; `small.moment.month1` "{name} · 1 month today", `small.moment.months` "{name} · {age} months today", `small.moment.year1` "{name} · 1 year today", `small.moment.years` "{name} · {age} years today"; `twins.moment.month1` "{names} · 1 month today", `twins.moment.months` "{names} · {age} months today", `twins.moment.year1` "{names} · 1 year today", `twins.moment.years` "{names} · {age} years today"; `a11y.moment.month1` "{name} is 1 month old today", `a11y.moment.months` "{name} is {age} months old today", `a11y.moment.year1` "{name} is 1 year old today", `a11y.moment.years` "{name} is {age} years old today". None holds `—` or a placeholder outside the six.
3. The intents block sits between `#if CUBBY_WIDGET_EXT` and `#endif`; `/@Parameter\(title: "([^"]+)"/g` finds exactly 6 matches, each equal to its key's text; the three `static let title` literals are "Feed, sleep, nappy", "Last feed", "At a glance", the two `IntentDescription(` literals equal `config.description` and `config.smallDesc`, and the two `typeDisplayRepresentation` literals are "Baby" and "Button".
4. `/key: "voice"/` is absent from Generated.swift and present in Generated.kt (the companion that proves the matcher reads a key that is there).

`--self-test` plants five defects into the real output strings (a night hex changed, one `@Parameter(title: WCopy.configBaby)`, a `voice` action in Swift, `config.smallDesc` dropped from `byKey`, `moment.months` reading "{age} months old today" in Swift) and requires `checkIosGenerated` to name each.

Register in a new block after `tools/gates.js:279`:
```js
/* iOS widgets, Phase A (docs/superpowers/plans/2026-11-17-widgets-3-ios-phase-a.md). The XCTest suites are
   Mac-only and run inside tools/cap_ios_build.sh; these judge the tree. */
TREE.push(
  { name: 'widget-gen-ios', cmd: ['node', 'test/widget-gen-ios.test.js', '--self-test'] },
);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node tools/gates.js --only=widget-gen-ios`
Expected: FAIL, naming `WColors` missing (so `feedInk` too), `byKey` missing, the intents block missing, `config.smallDesc` absent and no `WCopy.text` case for the `moment` keys.

- [ ] **Step 3: Implement `resolveTokens(css: string) -> { day: {[token]: string}, night: {[token]: string} }`, the colour, key-lookup and intents emitters in `tools/widget_gen.js`; add the two keys, the `differences` entry and the `small-repeat-pick` case; run `node tools/widget_gen.js`**

`resolveTokens` reads the first `:root{` block and the `[data-theme="night"]{` block, follows `var()` within night then falls back to root, and ignores the `@media print` block (:1779-1796). The intents emitter reads one table (intent, title key, description key, parameters with title keys and option providers) so P4's NapIntent rows are data, not new code.

- [ ] **Step 4: Run and pass**

Run: `node tools/gates.js --only=widget-gen-ios,widget-parity`
Expected: `WIDGET-GEN-IOS: PASS` and P1's parity gate PASS (committed generated files equal the generator's output, and `small-repeat-pick`'s hand-written `expect` agrees with `renderModel`; if it does not, P1's M9 port is wrong: raise it against P1, never edit the expect to match).

- [ ] **Step 5: Commit**

```bash
git add test/widget-gen-ios.test.js
git commit -o tools/widget_gen.js docs/widgets/widget-copy.json docs/widgets/widget-fixtures.json \
  native-ios/CubbyWidget/Generated.swift native-android/app/src/main/java/com/littlecubby/app/widget/Generated.kt \
  native-android/app/src/main/res/values/widget_strings.xml test/widget-gen-ios.test.js tools/gates.js \
  -m "The widget generator writes Cubby's colours and the Edit Widget wording into the native code" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Xcode project gains the CubbyWidget extension, its test target and the plugin's view controller

**Files:**
- Modify: `.gitignore:29-36` (add `/node_modules` and `/native-build` without a trailing slash: the worktree links them as symlinks, which `node_modules/` and `native-build/` never match)
- Modify: `tools/cap_ios_configure.rb`: constants `:44-57`; the App.entitlements heredoc `:149-166`; after `:241` (copy native-ios, write the extension's entitlements and both privacy manifests, patch Main.storyboard, copy the fixtures); after `:288` (create or find `CubbyWidget` and `CubbyWidgetTests`); `:311-336` (per-target entitlements); before `:338` (save the shared scheme)
- Modify: `tools/cap_ios_build.sh:65` (run `bash tools/ios_widget_check.sh` right after the launch smoke)
- Create: `native-ios/CubbyWidget/Info.plist`, `native-ios/CubbyWidget/CubbyWidgetBundle.swift`, `native-ios/Shared/Kinds.swift`, `native-ios/App/CubbyBridgeViewController.swift`, `native-ios/App/CubbyWidgetPlugin.swift`, `native-ios/Tests/BundleTests.swift`, `tools/ios_widget_check.sh`
- Modify: `tools/test_wiring_check.js` ALLOW (`tools/ios_widget_check.sh`, `native-ios/Tests/BundleTests.swift`)

**Interfaces:**
- Consumes: `WSnapshot.versions`, `WActions.all`, `WCopy.wordCubby` (P1's `word.cubby`).
- Produces:
```swift
enum CubbyWidgetKinds { static let medium = "cubby.medium", small = "cubby.small", lock = "cubby.lock"; static let all = [medium, small, lock] }
enum WidgetVersions { static func answer() -> (snapshot: [Int], shortcuts: [String], inPlace: Bool) }   // Shared
class CubbyBridgeViewController: CAPBridgeViewController   // capacitorDidLoad(): bridge?.registerPluginInstance(CubbyWidgetPlugin())
@objc(CubbyWidgetPlugin) class CubbyWidgetPlugin: CAPPlugin, CAPBridgedPlugin  // identifier "CubbyWidgetPlugin", jsName "CubbyWidget"; versions() now, three more in Task 5
```
  `bash tools/ios_widget_check.sh` (repo root, after configure): prints `IOS-WIDGET: PASS|FAIL`; `--self-test` plants the guards' targets (below) in a temp dir and requires each to fire. Its `TESTS` array lists `native-ios/Tests/<Name>Tests.swift` paths; every later task appends its files.
- Project shape: copy `native-ios/App/*.swift` to `ios/App/App/`, `native-ios/Shared` to `ios/App/Shared`, `native-ios/CubbyWidget` to `ios/App/CubbyWidget`, `native-ios/Tests` to `ios/App/CubbyWidgetTests`, overwriting and never deleting (a stray `.swift` left by a rename fails the check, by name). Shared and Generated.swift compile into App, CubbyWidget and CubbyWidgetTests; `CubbyWidgetBundle.swift` into CubbyWidget only; native-ios/App into App only. CubbyWidget: `new_target(:app_extension, 'CubbyWidget', :ios, '17.0')`, `INFOPLIST_FILE = CubbyWidget/Info.plist`, `APPLICATION_EXTENSION_API_ONLY = YES`, `SKIP_INSTALL = YES`, `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` copied from App, team and signing as App's (`:323-334`), embedded by an "Embed Foundation Extensions" phase (`dst_subfolder_spec` 13) with a target dependency. CubbyWidgetTests: hostless `:unit_test_bundle`, iOS 17.0, shared scheme `CubbyWidgetTests`. `CUBBY_WIDGET_EXT` stays off until Task 6: the generated intents name Task 6's entities and option providers, so they compile only from then. Entitlements: App.entitlements keeps its three keys and gains `com.apple.security.application-groups` [`group.com.littlecubby.app`] and `keychain-access-groups` [`F5NVQV7NVB.com.littlecubby.app.shared`]; `ios/App/CubbyWidget/CubbyWidget.entitlements` holds those two only; `CODE_SIGN_ENTITLEMENTS` is `App/App.entitlements` and `CubbyWidget/CubbyWidget.entitlements`. PrivacyInfo.xcprivacy in both bundles: `NSPrivacyAccessedAPICategoryUserDefaults` with reason `1C8F.1` (App Group defaults); the extension's also `NSPrivacyTracking` false and an empty `NSPrivacyCollectedDataTypes`. Main.storyboard:14 `customClass="CAPBridgeViewController" customModule="Capacitor"` becomes `customClass="CubbyBridgeViewController" customModule="App" customModuleProvider="target"` (abort if neither string is there). The extension's Info.plist: `NSExtension.NSExtensionPointIdentifier = com.apple.widgetkit-extension`, bundle keys as `$(...)` variables.

- [ ] **Step 1: Make the native shell in this worktree**

Add the two `.gitignore` lines first, then:
```bash
cd /Users/m1promax/Downloads/little-log-pwa/.claude/worktrees/android-feature-sync-strategy-33e94c
M=/Users/m1promax/Downloads/little-log-pwa
for f in package.json package-lock.json node_modules native-build; do [ -e "$f" ] || ln -s "$M/$f" "$f"; done
node tools/cap_strip_facebook.js && npx cap add ios && npx cap sync ios
git status --short    # no package.json, node_modules, native-build or ios/ rows
```
`cap_strip_facebook.js` writes through the symlink into the main checkout's `node_modules`; it is idempotent there (already stripped), so expect no change. Archives and DerivedData stay in `/tmp` and `$TMPDIR` as the scripts already put them.

- [ ] **Step 2: Write the failing checks**

`native-ios/Tests/BundleTests.swift`:
```swift
func testExactlyThreeKindsAndNoPregnancyKind() { XCTAssertEqual(CubbyWidgetKinds.all, ["cubby.medium", "cubby.small", "cubby.lock"]) }
func testVersionsAnswerForPhaseA() {
  let a = WidgetVersions.answer()
  XCTAssertEqual(a.snapshot, WSnapshot.versions)
  XCTAssertEqual(a.shortcuts, ["feed", "sleep", "diaper", "pump", "measure", "activity", "milestone"])
  XCTAssertFalse(a.inPlace)
}
```
`tools/ios_widget_check.sh` asserts, each a `FAIL <what>` line: the two targets exist with the settings above (read with `xcodebuild -showBuildSettings -target <t> -configuration Release`); App still at 15.0; both entitlements files hold the App Group and the literal keychain group and neither holds `$(AppIdentifierPrefix)`; App.entitlements still holds applesignin, `aps-environment` production and `applinks:little-cubby.com`; the storyboard class; no stray copied `.swift`; a second `ruby tools/cap_ios_configure.rb` leaves `shasum ios/App/App.xcodeproj/project.pbxproj` unchanged; `grep -rnE 'DateFormatter|\.formatted\(|Date\.FormatStyle' native-ios/Shared native-ios/CubbyWidget --exclude=Generated.swift` is empty (its `--self-test` plants one); then `xcodebuild test -scheme CubbyWidgetTests -destination id=<newest iPhone, as ios_launch_smoke.sh:28-41> CODE_SIGNING_ALLOWED=NO` passes and its log shows `Test Suite '<Name>' passed` for every TESTS entry; then a simulator build of scheme App holds `App.app/PlugIns/CubbyWidget.appex` whose Info.plist says `com.apple.widgetkit-extension` and `com.littlecubby.app.widget`, both bundles hold PrivacyInfo.xcprivacy, and the built App Info.plist has no static shortcut items key.

- [ ] **Step 3: Run the check against the unchanged configure and watch it fail**

Run: `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh`
Expected: `FAIL no CubbyWidget target`, `FAIL App.entitlements lacks group.com.littlecubby.app`, `IOS-WIDGET: FAIL`.

- [ ] **Step 4: Implement the configure changes, the six native files and the ALLOW entries**

`CubbyWidgetBundle.swift` declares the three kinds with their families as placeholder `StaticConfiguration`s whose one provider returns one entry drawing `WCopy.wordCubby`; Task 6 replaces them with `AppIntentConfiguration`s. `WidgetVersions.answer()` is `(WSnapshot.versions, WActions.all.filter { $0.places.contains("shortcut") }.map(\.key), false)`.

- [ ] **Step 5: Run and pass**

Run: `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh && bash tools/ios_launch_smoke.sh && node tools/gates.js --only=test-wiring`
Expected: `IOS-WIDGET: PASS`, `✓ alive after 12s`, `TEST-WIRING: PASS`.

- [ ] **Step 6: Commit**

```bash
git add native-ios/CubbyWidget/Info.plist native-ios/CubbyWidget/CubbyWidgetBundle.swift native-ios/Shared/Kinds.swift \
  native-ios/App native-ios/Tests/BundleTests.swift tools/ios_widget_check.sh
git commit -o .gitignore tools/cap_ios_configure.rb tools/cap_ios_build.sh tools/test_wiring_check.js tools/ios_widget_check.sh \
  native-ios/CubbyWidget/Info.plist native-ios/CubbyWidget/CubbyWidgetBundle.swift native-ios/Shared/Kinds.swift native-ios/App \
  native-ios/Tests/BundleTests.swift \
  -m "The iOS project builds a Cubby widget extension beside the app, with its own entitlements and tests" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: One Swift model renders every iOS Phase A golden fixture

**Files:**
- Create: `native-ios/Shared/Snapshot.swift`, `WidgetModel.swift`, `Clock.swift`, `CubbyLink.swift`, `Timeline.swift`
- Create: `native-ios/Tests/WidgetGoldenTests.swift`, `ClockTests.swift`, `SnapshotDecodeTests.swift`, `BoundaryTests.swift`
- Modify: `tools/cap_ios_configure.rb` (copy `docs/widgets/widget-fixtures.json` into `ios/App/CubbyWidgetTests/` as a test resource), `tools/ios_widget_check.sh` (TESTS; `cmp` the copied fixtures against `docs/widgets/widget-fixtures.json` before testing), `tools/test_wiring_check.js` ALLOW (four files)

**Interfaces:**
- Consumes: `WCopy`, `WCopy.text(_:)`, `WRules`, `WDefaults`, `WActions`, `WSnapshot` (P1, Task 2); widget-fixtures.json `{ source, tz, fixtures: [{ name, input, expect }] }` (2.3, contract note 4); `tools/widget_model.js` `renderModel` as the reference to port, including the ViewModel's `url` and each row's `a11y` (contract note 6).
- Produces (JSON keys exactly 2.3 and 2.5; `pregnancy` is not declared, so it is ignored, F4). Phase A reads `appSnapshot` only. `NapState` and `FixtureInput.nap` are P4's; `PullSnapshot`, `PullBaby`, `SnapshotDecode.pull`, `FixtureInput.pull` and the 2.5 merge are P5's (contract note 10), so none is declared here and Codable skips those keys:
```swift
struct AppSnapshot: Codable, Equatable { let v: Int; let state: String; let at: Int; let twins: Bool; let lockScreen: LockScreen
  let activeBabyId: String?; let shortcuts: [String]; let babies: [SnapshotBaby] }
struct SnapshotBaby: Codable, Equatable { let id: String; let name: String; let age: Age?; let last: Anchors; let by: ByLabels; let nap: Nap?; let healthOpen: Bool
  let moments: [SnapshotMoment] }                                                    // F10, at most 2; a missing key decodes as [] (chosen here)
struct SnapshotMoment: Codable, Equatable { let at: Int; let unit: String; let n: Int } // F10: at = local midnight of the month day; unit "month"|"year"
struct HeaderMoment: Codable, Equatable { let text: String; let a11y: String }         // F10: ViewModel header.moment, final text
struct FixtureInput: Codable, Equatable { let platform: String; let phase: String; let family: String; let config: Config
  var cellWidth: Double; let now: Int; let token: Bool; let app: AppSnapshot? }    // P4 adds `nap`, P5 adds `pull`
struct Row: Codable, Equatable { let baby: String?; let label: String; let by: String?; let value: String?; let agoAt: Int?
  let day: String?; let a11y: String }                                               // day: any fixed second line ("Yesterday", "since 2:40 AM")
struct ViewModel: Codable, Equatable { let mode: String; let message: String?; let header: Header?; let rows: [Row]; let buttons: [ButtonModel]
  let line: String?; let url: String }                                               // url: the widget body link (contract note 6)
enum WidgetModel { static func render(_ input: FixtureInput) -> ViewModel           // pure; zone = TimeZone.current
                   static func babyView(_ baby: SnapshotBaby, at: Int) -> BabyView }  // the one anchor-reader; P5's merge feeds it
enum SnapshotDecode { static func app(_ json: String?) -> AppSnapshot? }             // nil: absent, malformed, or v not in WSnapshot.versions
enum Clock { static func fmtClock(_ ms: Int, in tz: TimeZone = .current) -> String } // index.html:2189-2194; gregorian calendar, Latin digits, WCopy AM/PM
enum CubbyLink { static let base = "https://little-cubby.com/app/"
  static func widget(go: String, baby: String?) -> String; static func shortcut(go: String) -> String
  static func deliverable(_ s: String) -> URL? }                                     // deliverable: the scheme Task 9 proves; never builds a query
enum WidgetTimeline { static func boundaries(_ input: FixtureInput, horizonMs: Int = 86_400_000) -> [Int] }  // ascending, all > input.now
```
  `Header`, `ButtonModel` (JSON `buttons`; its `intent` is `{ action, babyIds, starts?, undo? }`, and a start intent omits `starts`), `Config`, `Age`, `Anchors`, `ByLabels`, `Nap`, `LockScreen` carry exactly the fields 2.3/2.5 name, optional where the contract says `| null`; `Header` gains `let moment: HeaderMoment?` (F10, M15). `BabyView` is internal: the per-baby fields the header, rows and buttons read (`name`, `age`, `last`, `by`, `nap`, `healthOpen`, `moments`) plus the `at` they are as of.
- Month days (contract note 11), ported from P1's M15 and M12 and nothing more: a baby's moment is active when `m.at <= now < m.at + 86_400_000`. `header.moment` (medium single: `moment.*` filled with `{age}` = n; small: `small.moment.*` with `{name}`; twins: `twins.moment.*` with `{names}` when both babies have an active moment of the same unit and n, that baby's name alone when only one does, else nil; `a11y` from `a11y.moment.*`, and for both twins each baby's `a11y.moment.*` joined by `names.and` (P1 note 18d); nil in every mode but `full` (a stale message) and while `ask` is set (P1 note 18a, b, fixtures `moment-stale` and `moment-long-nap`); month n=1 `month1`, month n>1 `months`, year n=1 `year1`, year n>1 `years`; any other unit: nil). Lock families: always nil. `header.age` is kept on a month day, so a hidden moment falls back to the age (if a P1 fixture nulls it, raise it against P1). Body `url` with an active moment and no noConnection or notSaved line: `https://little-cubby.com/app/?go=monthcard&baby=<id>&m=<n for months, 12 × n for years>&from=widget`, twins: the first baby with the day. Rows and buttons never read `moments`. (A small widget on Both for twins runs this over the selection with `twins.moment.*`: see the F12 contract note at the top.)

- [ ] **Step 1: Write the failing tests**

```swift
// WidgetGoldenTests
func testEveryIOSPhaseAFixtureMatchesTheJSModel() throws {
  let set = try Fixtures.load()                                  // test-bundle widget-fixtures.json
  NSTimeZone.default = TimeZone(identifier: set.tz ?? "UTC")!
  for f in set.fixtures where f.input.platform == "ios" && f.input.phase == "A" && f.rawNapIsNull && f.rawPullIsNull {  // the rest are P4's and P5's
    let got = WidgetModel.render(f.input)
    XCTAssertEqual(got.withoutAgoAt, f.expect.withoutAgoAt, f.name)                 // 2.3: every field but agoAt, exactly
    XCTAssertEqual(got.rows.map(\.agoAt), f.expect.rows.map(\.agoAt), f.name)       // and on iOS agoAt too: the live line counts from it
  }
}
func testThePhaseASetCoversEveryFamilyAndFallback() throws  // at least one ios/A fixture each: family medium, small, lockRect,
  // lockInline; app nil; app.state "signedOut"; "quiet"; twins with config.baby "both"; a healthOpen baby on medium and on small;
  // now - oldest at > WRules.staleMs; a config.baby absent from app.babies; a running nap; a row with a `by`; a repeated small
  // pick (small-repeat-pick); an `expect.url` with `baby=` and one without; F10: a non-null `expect.header.moment` on medium,
  // on small and on twins, and an `expect.url` with `go=monthcard`. A gap fails by name.
// F10 month days (M15, M12), hand-built from medium-a-basic (Robin, b1) in the fixtures' zone (UTC); day = now - now % 86_400_000
func testMonthDayIsActiveForItsOwnDayOnly() throws {
  let f = try Fixtures.named("medium-a-basic"); let now = f.input.now; let day = now - now % 86_400_000
  func moment(_ at: Int) -> HeaderMoment? {
    WidgetModel.render(f.input.withMoments(["b1": [SnapshotMoment(at: at, unit: "month", n: 3)]])).header?.moment }
  XCTAssertEqual(moment(day), HeaderMoment(text: "3 months today", a11y: "Robin is 3 months old today"))  // the day itself
  XCTAssertNotNil(moment(now)); XCTAssertNil(moment(now + 1))                                // at <= now
  XCTAssertNotNil(moment(now - 86_399_999)); XCTAssertNil(moment(now - 86_400_000))          // now < at + 86400000
  XCTAssertNil(moment(day + 86_400_000))                                                     // the day before (the day is tomorrow)
  XCTAssertNil(moment(day - 86_400_000))                                                     // the day after (it was yesterday)
  XCTAssertNil(WidgetModel.render(f.input.withMoments(["b1": []])).header?.moment)          // no birth, loss holding, state not ok
  XCTAssertEqual(WidgetModel.render(f.input.withMoments(["b1": []])).url, "https://little-cubby.com/app/?baby=b1&from=widget")
}
func testMonthDayWordsLinkAndA11y() throws {
  let f = try Fixtures.named("medium-a-basic"); let day = f.input.now - f.input.now % 86_400_000
  let cases: [(String, Int, String, String, String, Int)] = [      // unit, n, medium, small, a11y, m
    ("month", 1, "1 month today", "Robin · 1 month today", "Robin is 1 month old today", 1),
    ("month", 3, "3 months today", "Robin · 3 months today", "Robin is 3 months old today", 3),
    ("month", 23, "23 months today", "Robin · 23 months today", "Robin is 23 months old today", 23),
    ("year", 1, "1 year today", "Robin · 1 year today", "Robin is 1 year old today", 12),
    ("year", 2, "2 years today", "Robin · 2 years today", "Robin is 2 years old today", 24)]
  let plain = WidgetModel.render(f.input.withMoments(["b1": []]))
  for (unit, n, medium, small, a11y, m) in cases {
    let input = f.input.withMoments(["b1": [SnapshotMoment(at: day, unit: unit, n: n)]])
    let got = WidgetModel.render(input), gotSmall = WidgetModel.render(input.withFamily("small"))
    XCTAssertEqual(got.header?.moment, HeaderMoment(text: medium, a11y: a11y), medium)
    XCTAssertEqual(gotSmall.header?.moment, HeaderMoment(text: small, a11y: a11y), small)
    XCTAssertEqual(got.url, "https://little-cubby.com/app/?go=monthcard&baby=b1&m=\(m)&from=widget", medium)
    XCTAssertEqual(gotSmall.url, got.url, small)
    XCTAssertEqual(got.header?.age, plain.header?.age, medium)                              // the age is kept for the hidden case
    XCTAssertEqual(got.rows, plain.rows, medium); XCTAssertEqual(got.buttons, plain.buttons, medium)  // nothing else moves
  }
}
func testTwinsShareOneMonthDayLine() throws {
  let t = twinsOf(try Fixtures.named("medium-a-basic").input); let day = t.now - t.now % 86_400_000  // Robin b1, Wren b2, config.baby "both"
  let m3 = SnapshotMoment(at: day, unit: "month", n: 3), m4 = SnapshotMoment(at: day, unit: "month", n: 4)
  let both = WidgetModel.render(t.withMoments(["b1": [m3], "b2": [m3]]))
  XCTAssertEqual(both.header?.moment, HeaderMoment(text: "Robin and Wren · 3 months today",
                                                a11y: "Robin is 3 months old today and Wren is 3 months old today"))  // P1 note 18d
  XCTAssertEqual(both.url, "https://little-cubby.com/app/?go=monthcard&baby=b1&m=3&from=widget")
  let wren = WidgetModel.render(t.withMoments(["b1": [], "b2": [m3]]))
  XCTAssertEqual(wren.header?.moment, HeaderMoment(text: "Wren · 3 months today", a11y: "Wren is 3 months old today"))
  XCTAssertEqual(wren.url, "https://little-cubby.com/app/?go=monthcard&baby=b2&m=3&from=widget")
  let differ = WidgetModel.render(t.withMoments(["b1": [m3], "b2": [m4]]))
  XCTAssertNil(differ.header?.moment); XCTAssertEqual(differ.url, "https://little-cubby.com/app/?from=widget")
}
func testLockFamiliesNeverCarryAMonthDay() throws {
  let f = try Fixtures.named("medium-a-basic"); let day = f.input.now - f.input.now % 86_400_000
  for fam in ["lockRect", "lockInline"] {
    let got = WidgetModel.render(f.input.withMoments(["b1": [SnapshotMoment(at: day, unit: "month", n: 3)]]).withFamily(fam))
    XCTAssertNil(got.header?.moment, fam); XCTAssertFalse(got.url.contains("go=monthcard"), fam)
  }
}
// ClockTests (Review Focus 1, 2)
func testClockFollowsTheZoneThePhoneIsIn() {
  XCTAssertEqual(Clock.fmtClock(1_794_867_000_000, in: TimeZone(identifier: "Asia/Dubai")!), "2:10 AM")
  XCTAssertEqual(Clock.fmtClock(1_794_867_000_000, in: TimeZone(identifier: "America/New_York")!), "5:10 PM")
}
func testTheRepeatedDSTHourReadsTheSameAndNeverCrashes() {
  let ny = TimeZone(identifier: "America/New_York")!
  XCTAssertEqual(Clock.fmtClock(1_793_511_000_000, in: ny), "1:30 AM"); XCTAssertEqual(Clock.fmtClock(1_793_514_600_000, in: ny), "1:30 AM")
}
func testTwelveHourEdges() { /* 00:00 "12:00 AM", 00:59 "12:59 AM", 12:00 "12:00 PM", 23:05 "11:05 PM" in UTC */ }
// BoundaryTests (Review Focus 1)
func testTheNextMidnightsOnA25HourDay() {
  NSTimeZone.default = TimeZone(identifier: "America/New_York")!
  let b = WidgetTimeline.boundaries(inputAt(1_793_498_400_000))   // Sat 31 Oct 2026 22:00 EDT
  XCTAssertTrue(b.contains(1_793_505_600_000)); XCTAssertTrue(b.contains(1_793_595_600_000))   // the two local midnights, 25h apart
}
func testEveryChangeInTheNext24HoursHappensAtABoundary() // for each ios/A fixture: render at every minute from now to now+24h;
  // every minute whose ViewModel differs from the minute before is in boundaries (and the stale boundary is oldest at + 21600000)
func testAMonthDayEndsAtItsOwnBoundaryOnA25HourDay() {          // F10, Review Focus 6: the end is at + 86400000, not a midnight
  NSTimeZone.default = TimeZone(identifier: "America/New_York")!
  let i = inputAt(1_793_520_000_000)                              // Sun 1 Nov 2026 3:00 AM EST, the 25-hour day
  let b = WidgetTimeline.boundaries(i.withMoments([i.app!.babies[0].id: [SnapshotMoment(at: 1_793_505_600_000, unit: "month", n: 3)]]))
  XCTAssertTrue(b.contains(1_793_592_000_000))                    // 11:00 PM EST: the month day ends; no midnight is there
  XCTAssertTrue(b.contains(1_793_595_600_000))                    // and the local midnight stays
}
// SnapshotDecodeTests (Review Focus 4)
func testOddSnapshotsFallBackAndNeverCrash() {
  XCTAssertNil(SnapshotDecode.app(nil)); XCTAssertNil(SnapshotDecode.app("")); XCTAssertNil(SnapshotDecode.app("{"))
  XCTAssertNil(SnapshotDecode.app(sample(v: 99)))                       // a version this binary does not read
  XCTAssertNil(SnapshotDecode.app(sample(lastFeed: "\"2:10\"")))        // a wrong type
  XCTAssertNotNil(SnapshotDecode.app(sample(extra: "\"future\":{\"x\":1}")))  // unknown fields are ignored
  XCTAssertNotNil(SnapshotDecode.app(sample(lastFeed: "null")))         // "not yet"
  XCTAssertEqual(WidgetModel.render(input(app: SnapshotDecode.app("{"))).mode, "wordmark")
  // F10: sample(moments:) takes the raw JSON, default "[]"; nil drops the key
  XCTAssertEqual(SnapshotDecode.app(sample(moments: nil))?.babies.first?.moments, [])   // no key: no month day, never a failure
  XCTAssertNil(SnapshotDecode.app(sample(moments: "\"soon\"")))                        // a wrong type
  let week = SnapshotDecode.app(sample(moments: "[{\"at\":1794873600000,\"unit\":\"week\",\"n\":3}]"))
  XCTAssertNotNil(week)                                                                 // a unit this binary does not know
  XCTAssertNil(WidgetModel.render(input(app: week, now: 1_794_880_000_000)).header?.moment)  // draws nothing that day
}
```
`Fixtures.named(_:)` and the input helpers `withMoments(_:)` (sets the named babies' `moments`, leaving the rest), `withFamily(_:)` and `twinsOf(_:)` (adds Wren, `b2`, with Robin's anchors and `by`, sets `twins: true` and `config.baby: "both"`) live in the test target beside `Fixtures.load()`. The month arithmetic itself (a birth on the 31st, month 12, month 24, month 25 skipped, no birth) is P1's since-rules cases; Swift has nothing of it to test (contract note 11).

- [ ] **Step 2: Run them and watch them fail**

Run: `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh`
Expected: build errors naming `WidgetModel`, `Clock`, `SnapshotDecode`, `SnapshotMoment`; `IOS-WIDGET: FAIL`.

- [ ] **Step 3: Implement the five Shared files**

Port `renderModel` function by function for `platform: 'ios'`, phase A, from `input.app` alone ("Updated" is the oldest `at` shown, which in Phase A is `app.at`), the body `url` and row `a11y` included, and F10's M15 and month-card `url` branch exactly as the Interfaces' month-day bullet says (built where the port builds the other body urls; `CubbyLink` gains nothing); keep the anchor-reading in one function, `babyView(_:at:)`, which also carries the baby's `moments`. P5 later writes the 2.5 merge into this same file and feeds `babyView` from it (contract note 10); declare no merge type and no other file for it here. `rawNapIsNull`/`rawPullIsNull` are read with `JSONSerialization` beside the Codable decode. `boundaries` returns, within the horizon: the stale boundary, each shown anchor + `dayRuleMs`, each local midnight (from `Calendar` in `TimeZone.current`, never `+ 86400000`), and, for each baby's `nap` in the app snapshot, `start + napAskMs`, `start + napMaxMs`, `ack + ackFreshMs`, and for each baby's `moments` entry, `at` and `at + 86_400_000` (F10; on a DST day the end is not a midnight) (P4 adds `line.until` and `undo.until`). Add the four ALLOW entries (`ranBy: 'tools/ios_widget_check.sh'`).

- [ ] **Step 4: Run and pass, then see two mutations go red**

Run: `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh`
Expected: `IOS-WIDGET: PASS`. Then, one at a time and reverted by hand: make the stale test `>=` where the JS has `>` (or the reverse); drop the Health switch from the fourth button; let a repeated small pick stand; put `baby=` on the body `url` for Both. Each run must FAIL naming a fixture (`small-repeat-pick` for the third, a twins fixture for the fourth). Then the F10 halves, each on its own: make M15's `now < at + 86_400_000` a `<=`, and `testMonthDayIsActiveForItsOwnDayOnly` FAILs; build the month-card `m` from `n` alone (year 1 gives `m=1`), and `testMonthDayWordsLinkAndA11y` FAILs on "1 year today"; let one twin's day stand for both, and `testTwinsShareOneMonthDayLine` FAILs; fill the twins' `a11y` from one `a11y.moment.*` with `{name}` = both names ("Robin and Wren is 3 months old today"), and it FAILs again; drop `at + 86_400_000` from `boundaries`, and `testAMonthDayEndsAtItsOwnBoundaryOnA25HourDay` FAILs.

- [ ] **Step 5: Commit**

```bash
git add native-ios/Shared/Snapshot.swift native-ios/Shared/WidgetModel.swift native-ios/Shared/Clock.swift \
  native-ios/Shared/CubbyLink.swift native-ios/Shared/Timeline.swift native-ios/Tests/WidgetGoldenTests.swift \
  native-ios/Tests/ClockTests.swift native-ios/Tests/SnapshotDecodeTests.swift native-ios/Tests/BoundaryTests.swift
git commit -o native-ios/Shared native-ios/Tests tools/cap_ios_configure.rb tools/ios_widget_check.sh tools/test_wiring_check.js \
  -m "The iPhone widget reads the same times as the app: one Swift model, held to the shared fixtures" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The plugin writes the snapshot, sets the long-press shortcuts and wipes everything

**Files:**
- Modify: `native-ios/App/CubbyWidgetPlugin.swift` (adds `hasWidgets`, `setSnapshot`, `clear`)
- Create: `native-ios/Shared/WidgetStore.swift`, `native-ios/Shared/Shortcuts.swift`, `native-ios/Tests/PluginTests.swift`
- Modify: `tools/cap_ios_configure.rb` SCENEDELEGATE_SRC `:58-121`: `scene(_:willConnectTo:options:)` (`:72-85`) also routes `connectionOptions.shortcutItem`; a new `windowScene(_:performActionFor:completionHandler:)` after `:97`
- Modify: `tools/ios_widget_check.sh` (TESTS; the written SceneDelegate.swift holds `performActionFor` and `shortcutItem`), `tools/test_wiring_check.js` ALLOW

**Interfaces:**
- Consumes: `SnapshotDecode.app`, `CubbyLink.shortcut(go:)` (Task 4); `CubbyWidgetKinds` (Task 3); `WActions.all`, `WRules.shortcutsMax`, `WSnapshot.versions` (P1).
- Produces:
```swift
struct WidgetStore { static let suite = "group.com.littlecubby.app"
  enum Key: String { case appSnapshot, napState, pullSnapshot, pokedAt, pullTriedAt }   // all five 2.5 keys (contract note 10)
  init(defaults: UserDefaults); static func shared() -> WidgetStore?
  func read(_ k: Key) -> String?                  // the three JSON-string keys; P5 reads its two numbers itself
  func writeApp(v: Int, json: String) -> Bool    // false and nothing written unless v ∈ WSnapshot.versions and SnapshotDecode.app(json) != nil
  func clearAll() }                               // all five keys
enum WidgetShortcuts { static let type = "cubby.go"
  static func items(for keys: [String]) -> [(title: String, url: String)] }   // order kept, unknown or non-shortcut keys skipped, at most shortcutsMax
enum WidgetCount { static func kinds(_ kinds: [String]) -> [String: Int] }   // keys "medium", "small", "lock", always all three
enum BackupFence { static func exclude(_ dir: URL) throws }                   // isExcludedFromBackup = true
```
  Plugin answers (2.6), all work on one serial queue so a `clear()` sent after a `setSnapshot()` lands after it: `hasWidgets()` -> `{ value, kinds: { medium, small, lock } }` from `WidgetCenter.shared.getCurrentConfigurations` (an error answers `value: false`, zeros); `setSnapshot({ v, json })` -> `{ ok }`: `writeApp`, then on the main thread `UIApplication.shared.shortcutItems` from the snapshot's `shortcuts` (type `cubby.go`, `userInfo["url"]`, no icon), `BackupFence.exclude` on the App Group container, `WidgetCenter.shared.reloadAllTimelines()`; `clear()` -> `{ ok: true }`: `clearAll`, `shortcutItems = []`, `SecItemDelete` for service `com.littlecubby.app.widget`, account `token`, group `F5NVQV7NVB.com.littlecubby.app.shared` (none exists until P4), reload. P4 adds the `/api/widget/revoke` send for the token `clear()` removes (2.6); nothing here talks to the network. SceneDelegate turns a `cubby.go` item into `URL(string: userInfo["url"])`, refuses one not starting with `CubbyLink.base`, and hands it to `ApplicationDelegateProxy.shared.application(_:open:options:)`, as `open(_:)` (`:99-115`) does, so it reaches `appUrlOpen` running and `getLaunchUrl` cold.

- [ ] **Step 1: Write the failing tests (`PluginTests`)**

```swift
func testShortcutsAreLabelledFromWActionsAndCappedAtFour() {
  let s = WidgetShortcuts.items(for: ["feed", "sleep", "diaper", "measure", "activity"])
  XCTAssertEqual(s.map(\.title), ["Feed", "Sleep", "Nappy", "Measure"])
  XCTAssertEqual(s.map(\.url), ["https://little-cubby.com/app/?go=feed&from=shortcut", "https://little-cubby.com/app/?go=sleep&from=shortcut",
                                "https://little-cubby.com/app/?go=diaper&from=shortcut", "https://little-cubby.com/app/?go=measure&from=shortcut"])
}
func testUnknownPregnancyAndNonShortcutKeysAreSkipped() {   // Review Focus 4; F4 holds pregnancy shortcuts back
  XCTAssertEqual(WidgetShortcuts.items(for: ["kicks", "voice", "health", "nope", "feed"]).map(\.title), ["Feed"])
}
func testAWriteWithAnUnreadableVersionOrBadJSONWritesNothing() { /* writeApp(v: 99, ...) false; writeApp(v: 1, json: "{") false; read(.appSnapshot) nil */ }
func testClearRemovesEveryKey() { /* writeApp ok; set napState, pullSnapshot raw strings and pokedAt, pullTriedAt as numbers;
                                     each of the five is non-nil (defaults.object(forKey:)); clearAll(); all five nil */ }
func testKindCounts() { XCTAssertEqual(WidgetCount.kinds(["cubby.medium", "cubby.medium", "cubby.lock", "other"]), ["medium": 2, "small": 0, "lock": 1]) }
func testBackupFenceMarksTheDirectory() throws { /* temp dir; exclude; resourceValues isExcludedFromBackup == true */ }
```
Each store test uses `WidgetStore(defaults: UserDefaults(suiteName: "test-" + UUID().uuidString)!)`.

- [ ] **Step 2: Run them and watch them fail**

Run: `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh`
Expected: build errors naming `WidgetStore`, `WidgetShortcuts`; `FAIL SceneDelegate.swift has no performActionFor`.

- [ ] **Step 3: Implement the three Shared types, the plugin methods and the SceneDelegate heredoc; add the ALLOW entry**

- [ ] **Step 4: Run and pass, then a mutation**

Run: `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh && bash tools/ios_launch_smoke.sh`
Expected: `IOS-WIDGET: PASS`, `✓ alive`. Then, reverted by hand each time: cap at 5 instead of `shortcutsMax`, and `testShortcutsAreLabelledFromWActionsAndCappedAtFour` FAILs; leave `pullTriedAt` out of `clearAll`, and `testClearRemovesEveryKey` FAILs.

- [ ] **Step 5: Commit**

```bash
git add native-ios/Shared/WidgetStore.swift native-ios/Shared/Shortcuts.swift native-ios/Tests/PluginTests.swift
git commit -o native-ios/App native-ios/Shared native-ios/Tests tools/cap_ios_configure.rb tools/ios_widget_check.sh tools/test_wiring_check.js \
  -m "The app hands the widget its snapshot and long-press shortcuts, and takes both away on every wipe" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The extension draws the medium, small and lock-screen widgets, and Edit Widget offers baby and buttons

**Files:**
- Modify: `native-ios/CubbyWidget/CubbyWidgetBundle.swift`, `native-ios/CubbyWidget/Info.plist` (`UIAppFonts`)
- Create: `native-ios/CubbyWidget/Provider.swift`, `Entities.swift`, `Layout.swift`, `Views/MediumView.swift`, `Views/TwinsView.swift`, `Views/SmallView.swift`, `Views/LockViews.swift`, `Views/Parts.swift`
- Create: `native-ios/Tests/RenderTests.swift`, `ProviderTests.swift`, `EntityTests.swift`, `native-ios/Tests/Goldens/*.png`
- Modify: `tools/cap_ios_configure.rb` (set `SWIFT_ACTIVE_COMPILATION_CONDITIONS = $(inherited) CUBBY_WIDGET_EXT` on CubbyWidget and CubbyWidgetTests, never App; convert `app/fonts/fraunces-600-latin.woff2` and `app/fonts/nunitosans-800-latin.woff2`, both variable fonts (every weight file is the same bytes), to `ios/App/CubbyWidget/Fonts/*.ttf` with fontTools and abort if it is missing; copy `icons/logo-96.png` to `ios/App/CubbyWidget/CubbyMark.png`; add both as resources of CubbyWidget and CubbyWidgetTests), `tools/ios_widget_check.sh` (TESTS; the flag is on the two targets and off on App; the built appex holds each `UIAppFonts` file; F10's star guard: every `Image(systemName: "star.fill")` under native-ios/CubbyWidget carries `.accessibilityHidden(true)` on the same line, and its `--self-test` plants one without), `tools/test_wiring_check.js` ALLOW

**Interfaces:**
- Consumes: `WidgetModel.render`, `ViewModel` (its `url`, rows' `a11y` and `header.moment`), `HeaderMoment`, `WidgetTimeline.boundaries`, `SnapshotDecode`, `CubbyLink.deliverable` (Task 4); `WidgetStore` (Task 5); the generated intents and `typeDisplayRepresentation` (Task 2); `WColors`, `WCopy.text`, `WCopy.sepDot`, `WCopy.configBoth`, `WDefaults`, `WActions`, `WRules` (P1, Task 2); fixtures `medium-a-basic` and `small-repeat-pick` (P1, Task 2).
- Produces:
```swift
struct CubbyEntry: TimelineEntry { let date: Date; let input: FixtureInput }       // the view fills cellWidth, then renders
struct BabyEntity: AppEntity { let id: String; let name: String }                  // id "both" is Both
struct ButtonEntity: AppEntity { let id: String }                                   // a WActions key
struct BabyOptions, LockBabyOptions, MediumButtonOptions, SmallFirstOptions, SmallSecondOptions: DynamicOptionsProvider
enum WidgetInputs { static func config(baby: String?, button: String?, first: String?, second: String?) -> FixtureInput.Config  // drops keys not in WActions.all
                    static func make(family: String, config: FixtureInput.Config, now: Int, store: WidgetStore?) -> FixtureInput } // platform "ios", phase "A", token false
enum WidgetTimelineBuilder { static func build(family: String, config: FixtureInput.Config, now: Int, store: WidgetStore?) -> (entries: [CubbyEntry], reloadAfterMs: Int?) }
enum WidgetLayout { static let mediumMargin: CGFloat = 14, smallMargin: CGFloat = 12, statusGap: CGFloat = 16, minTap: CGFloat = 44
                    static func effectiveCellWidth(familyWidth: CGFloat, typeScale: CGFloat) -> Double }   // ((w - 2*14 - 2*16) / 3) / typeScale
enum WidgetPrivacy { static func wordmarkOnly(hide: Bool, family: String, location: String) -> Bool
                     static func located(_ m: ViewModel, location: String) -> ViewModel   // "home": unchanged; anywhere else: every row's `by` nil (F7)
                                                                                         // and `header.moment` nil (F10); `url`, `age` and every time untouched
                     static func name(_ l: WidgetLocation) -> String }                 // .homeScreen "home", .lockScreen "lock", .standBy "standby",
                                                                                         // .iPhoneWidgetsOnMac "mac", anything else "other"
struct WidgetBody: View { init(model: ViewModel, family: String, accented: Bool, location: String)  // pure: all four passed in, never read from the environment
                          let shown: ViewModel }                                        // WidgetPrivacy.located(model, location:), the only model it draws
enum WidgetFlags { static var smallLinksOnIOS17 = true; static var relativeOnIOS17 = false }   // Task 9's proofs may flip them
```
- Behaviour pinned here:
  - Timeline: entries at `now` and at every `boundaries` value; policy `.atEnd`. With `app == nil` (container unreadable before first unlock, or nothing written): one wordmark entry and `.after(now + 900_000)`.
  - Families: `systemMedium` -> `"medium"` (twins layout when the model's rows are per baby), `systemSmall` -> `"small"`, `accessoryRectangular` -> `"lockRect"`, `accessoryInline` -> `"lockInline"`.
  - `cellWidth` = `effectiveCellWidth(context width, UIFontMetrics(forTextStyle: .body).scaledValue(for: 1) at the entry's dynamicTypeSize)`: 87.0 at `.large` on 321pt (so "Asleep now", 83.7pt, fits against asleepNowMinWidth 84), below 84 at `.xxLarge`.
  - Every button is `Link(destination: CubbyLink.deliverable(button.url))`; the body is `.widgetURL(CubbyLink.deliverable(shown.url))`, the ViewModel's top-level `url` (contract note 6). The view never builds a query: `deliverable` only picks the scheme. On iOS 17 with `smallLinksOnIOS17 == false` the small widget drops its button row and keeps only the body link (spec 6.1).
  - Ago line: iOS 18 and later, a live `SystemFormatStyle.DateReference` from `row.agoAt` with no seconds field; iOS 17, none unless `relativeOnIOS17` (spec 6.9). Twins rows drop it first (`ViewThatFits`).
  - Location: the entry view reads `@Environment(\.widgetLocation)` once, names it with `WidgetPrivacy.name`, and passes the name down. `WidgetPrivacy.wordmarkOnly`: true iff `hide && family ∈ {medium, small} && location != "home"`. Whatever `hide` says, `WidgetBody` draws `WidgetPrivacy.located(model, location:)`, so a row's `by` ("· Dad", and the small widget's ago-line name) and the month day (F10) show on the home screen only: never in StandBy, in iPhone widgets on a Mac, or on the iPad lock screen, which reports `.lockScreen` (F7). There the age comes back in the medium's slot and the small reads its ordinary lines; the body link stays the model's `url` (no new link logic).
  - Month day (F10), drawn only from `shown.header?.moment`, never from `moments` or a date: medium single, the age slot draws the star and `moment.text` ("Robin · ★ 3 months today") instead of `age`; small, the label line draws the star and `moment.text` ("★ Robin · 3 months today") instead of `row.baby` + `sepDot` + `row.label`, and the line under the clock time draws `row.label` ("last feed") + `sepDot` + the ago line (or `row.day`) + `sepDot` + `by` (home only, F7; on a small widget on Both for twins the type word is dropped and the line is the ago line + `sepDot` + `whose`, see the F12 note at the top); twins, the header's leading slot (which otherwise holds only the mark) draws the star and `moment.text` beside the freshness. The star is `Image(systemName: "star.fill")` (chosen here: 9pt, the text's colour, never a `Text` literal) with `.accessibilityHidden(true)`; the star and text form one element whose label is `moment.a11y`. Colour: `WColors.feedInk` (day 0x895D24, night 0xE0A655); in accented rendering both are `.widgetAccentable()`. The month day takes the age's font and size on the medium and twins, the label line's on the small. Fitting (chosen here): `ViewThatFits` draws the line whole or the ordinary layout, never "3 months to…" (the freshness still never truncates, the name still tail-truncates in the ordinary layout); on the small's line under the clock the ago drops first, then `by` tail-truncates, never the type. Lock views never read `header.moment`. Times, statuses and buttons keep their frames.
  - Joins: the view puts `WCopy.sepDot` between a row's `label` and its `by`, between the header's `name` and `age` (or the month day in its place), and on a small month day between the type, the ago line and `by`; every other string is the model's final text.
  - Colour scheme follows the system appearance (chosen here: the snapshot carries no theme). Accented rendering draws every opens-Cubby button with the 1pt stroke and `.widgetAccentable()` labels.
  - Every configuration uses `.contentMarginsDisabled()` and `.containerBackground(for: .widget)` in `WColors.surface2`; the root view caps Dynamic Type with `.dynamicTypeSize(...DynamicTypeSize.xxLarge)`; the header mark is `CubbyMark.png` at 16pt.
  - Gallery: `.configurationDisplayName` and `.description` from P1's `gallery.mediumTitle`/`mediumDescA`, `gallery.smallTitle`/`smallDesc`, `gallery.lockTitle`/`lockDesc`; `placeholder` draws the family's layout from a model with an empty name and no times under `.redacted(reason: .placeholder)`; a preview snapshot draws the real model when a snapshot exists, else the wordmark.
  - Accessibility: each button's label is `button.a11y`; each status cell's label is `row.a11y` ("Robin's last feed, 2:10 AM", 2.3); a month day's label is `header.moment.a11y` ("Robin is 3 months old today") and its star is never read; no hand-written words.
  - Options: `BabyOptions` lists each baby from the snapshot, then Both (text `WCopy.configBoth`) only with exactly two babies; `LockBabyOptions` never Both; `MediumButtonOptions` the `medium4` actions, default `WDefaults.medium4`; `SmallFirstOptions` / `SmallSecondOptions` the `small` actions minus the other pick (`@IntentParameterDependency<SmallConfig>`), defaults `WDefaults.small[0]` and `[1]`. A `defaultResult` of nil for babies: the model's default (Both for twins, else the active baby).

- [ ] **Step 1: Write the failing tests**

```swift
// EntityTests (D7, F9, Review Focus 5)
func testBothOnlyForExactlyTwoBabiesAndNeverOnTheLockScreen()   // 1 baby: [Robin]; 2: [Robin, Wren, Both]; 3: three, no Both; LockBabyOptions with 2: no Both
func testMediumButtonChoicesAndDefault() { /* Set(ids) == ["pump", "activity", "health"]; default "activity" */ }
func testSmallSecondNeverOffersTheFirstPick() { /* first "sleep": second's ids exclude "sleep" and equal small actions minus it; defaults "sleep", "feed" */ }
func testStalePicksFallBack() throws {
  XCTAssertNil(WidgetInputs.config(baby: nil, button: "voice", first: nil, second: nil).button)    // Android-only on iOS
  XCTAssertNil(WidgetInputs.config(baby: nil, button: "kicks", first: nil, second: nil).button)
  XCTAssertEqual(WidgetInputs.config(baby: "gone-id", button: nil, first: nil, second: nil).baby, "gone-id")  // the model says "Open Cubby to pick a baby."
  // P1 M9: a repeated pick falls back to the next default. A restored config keeps both picks; the model decides.
  let f = try Fixtures.named("small-repeat-pick")                                   // ios/A, Task 2
  let c = WidgetInputs.config(baby: nil, button: nil, first: "feed", second: "feed")
  XCTAssertEqual([c.first, c.second], ["feed", "feed"])
  let m = WidgetModel.render(WidgetInputs.make(family: "small", config: c, now: f.input.now, store: storeHolding(f.input.app)))
  XCTAssertEqual(m.buttons.map(\.k), ["feed", "sleep"]); XCTAssertEqual(m.buttons, f.expect.buttons)
}
// ProviderTests
func testUnreadableContainerGivesTheWordmarkAndRetriesIn15Minutes() { /* build(store: nil): one entry, mode "wordmark", reloadAfterMs 900_000 */ }
func testEntriesSitAtNowAndEveryBoundary() { /* for a fixture's app: entries' dates == [now] + boundaries, reloadAfterMs nil */ }
// RenderTests (layout floor, Review Focus 3)
func testEveryFamilyRendersAtTheFloor()   // every ios/A fixture × {light, dark} × {accented false, true} × {.large, .xxLarge}:
  // ImageRenderer image non-nil at exactly medium 321x148, small 148x148, lockRect 160x72, lockInline 230x22
func testGoldens()   // 17 PNGs in Tests/Goldens: medium-day, medium-night, medium-xxl, twins-day, small-day, small-night, lockrect-accented,
  // medium-longname-xxl ("Alexandria Catherine"), medium-arabic-xxl ("نور الهدى"); F10 month days, from medium-a-basic (and withFamily("small"),
  // twinsOf) with moments [{ at: day, unit: "month", n: 3 }] for Robin (and Wren): medium-moment-day, medium-moment-night, twins-moment-day,
  // twins-moment-night, small-moment-day, small-moment-night, and with n: 23 (the longest month text): medium-moment-xxl, small-moment-xxl;
  // at most 0.5% of pixels differ by more than 8/255 in any channel; CUBBY_RECORD_GOLDENS=1 writes them to $CUBBY_RENDER_OUT instead
func testHoneyInkReadsOnTheWidgetGround() {   // F10: the month day's ink, WCAG against WColors.surface2 (#FBF7EF day, #2E2722 night)
  XCTAssertEqual(WColors.feedInk.day, 0x895D24); XCTAssertEqual(WColors.feedInk.night, 0xE0A655)
  XCTAssertEqual(contrast(WColors.feedInk.day, WColors.surface2.day), 5.38, accuracy: 0.01)
  XCTAssertEqual(contrast(WColors.feedInk.night, WColors.surface2.night), 6.82, accuracy: 0.01)
}
func testAMonthDayMovesNothingBelowTheHeader() throws {
  /* F10: medium and twins at the floor, light and dark: every pixel below the header band (y >= mediumMargin + the header's height)
     is identical with and without the month day; small: the clock line's band and the button band are identical. Bands come from
     WidgetLayout's constants, never hard-coded pixels. */
}
func testAHiddenMonthDayDrawsTheOrdinaryWidget() throws {
  /* F10: for "standby", "mac", "lock": the image of WidgetBody(model rendered from the month-day input, location) equals, pixel for
     pixel, the image of WidgetBody(model rendered from the same input with moments [], location), on medium, small and twins */
}
func testFreshnessFitsBesideTheMarkAtXXLarge() { /* width of "Updated yesterday 11:50 PM" at 11pt × xxLarge scale + 16pt mark + 6pt <= 321 - 28 */ }
func testAsleepNowFitsAtLargeAndNotAtXXLarge() { /* effectiveCellWidth(321, 1.0) == 87.0 >= 84; at the xxLarge scale < 84 */ }
func testVariableWeightApplies() { /* "2:10 AM" in Nunito Sans weight 800 measures wider than at 400 */ }
func testPrivacyTable() throws {
  /* wordmarkOnly: (true, medium, standby) true; (true, medium, home) false; (false, small, mac) false; (true, small, other) true */
  // F7, Review Focus 2: with hide off, who logged it shows on the home screen only
  let m = try Fixtures.named("medium-a-basic").expect                             // feed row by "Dad"
  XCTAssertEqual([.homeScreen, .lockScreen, .standBy, .iPhoneWidgetsOnMac].map(WidgetPrivacy.name), ["home", "lock", "standby", "mac"])
  XCTAssertFalse(WidgetPrivacy.wordmarkOnly(hide: false, family: "medium", location: "standby"))
  XCTAssertEqual(WidgetBody(model: m, family: "medium", accented: false, location: "home").shown.rows.first?.by, "Dad")  // the companion: a by that is there is seen
  for loc in ["standby", "mac", "lock", "other"] {                                 // (hide false, medium, standby) -> no by row; Mac; iPad lock screen
    XCTAssertTrue(WidgetBody(model: m, family: "medium", accented: false, location: loc).shown.rows.allSatisfy { $0.by == nil }, loc)
    XCTAssertEqual(WidgetBody(model: m, family: "medium", accented: false, location: loc).shown.rows.map(\.value), m.rows.map(\.value), loc)  // times stay
  }
  // whose is a baby's name, not the logger: located keeps it where it strips by (this goes red if located starts stripping whose)
  XCTAssertEqual(WidgetBody(model: try Fixtures.named("small-both-a").expect, family: "small", accented: false, location: "standby").shown.rows.first?.whose, "Wren")
  // F10, Review Focus 6: the month day is hidden exactly where `by` is; the age comes back and the link is the model's
  let f = try Fixtures.named("medium-a-basic"); let day = f.input.now - f.input.now % 86_400_000
  let md = WidgetModel.render(f.input.withMoments(["b1": [SnapshotMoment(at: day, unit: "month", n: 3)]]))
  XCTAssertEqual(WidgetBody(model: md, family: "medium", accented: false, location: "home").shown.header?.moment,
                 HeaderMoment(text: "3 months today", a11y: "Robin is 3 months old today"))      // the companion: a day that is there is seen
  for loc in ["standby", "mac", "lock", "other"] {
    let s = WidgetBody(model: md, family: "medium", accented: false, location: loc).shown
    XCTAssertNil(s.header?.moment, loc); XCTAssertEqual(s.header?.age, md.header?.age, loc)
    XCTAssertEqual(s.url, "https://little-cubby.com/app/?go=monthcard&baby=b1&m=3&from=widget", loc)  // no new link logic
  }
}
```
`storeHolding(_ app: AppSnapshot?) -> WidgetStore` (a `test-<UUID>` suite holding the snapshot re-encoded) and `contrast(_:_:) -> Double` (the WCAG ratio of two `0xRRGGBB` values) live in the test target beside `Fixtures.load()` and Task 4's `Fixtures.named(_:)`, `withMoments`, `withFamily` and `twinsOf`.

- [ ] **Step 2: Run them and watch them fail**

Run: `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh`
Expected: build errors naming `BabyOptions`, `WidgetTimelineBuilder`, `WidgetBody`; `IOS-WIDGET: FAIL`.

- [ ] **Step 3: Implement the views to spec 6.1's sketches within the Global Constraints, the providers, entities and options; record the goldens**

Run with `CUBBY_RECORD_GOLDENS=1 CUBBY_RENDER_OUT=$TMPDIR/cubby-goldens`, Read every PNG (day, night, accented, xxLarge, both names, and the eight month days: star and honey ink in the age slot, on the small's label line with "last feed" under the clock time, one shared twins line beside an unbroken "Updated"; at xxLarge, whole or the ordinary layout, never cut), and only then copy them into `native-ios/Tests/Goldens/`. Add the ALLOW entries.

- [ ] **Step 4: Run and pass, then two mutations**

Run: `ruby tools/cap_ios_configure.rb && bash tools/ios_widget_check.sh && bash tools/ios_launch_smoke.sh`
Expected: `IOS-WIDGET: PASS`. Then, reverted by hand each time: medium margin 16 makes `testGoldens` FAIL on the medium PNGs; Both offered with three babies makes `testBothOnlyForExactlyTwoBabiesAndNeverOnTheLockScreen` FAIL; `located` keeping `by` when `location == "standby"` makes `testPrivacyTable` FAIL naming `standby`; `WidgetInputs.config` dropping a repeated second pick makes `testStalePicksFallBack` FAIL. F10, each on its own: `located` keeping `header.moment` when `location == "mac"` makes `testPrivacyTable` FAIL naming `mac`; the month day drawn in `WColors.feed` instead of `feedInk` makes `testGoldens` FAIL on medium-moment-day; the star without `.accessibilityHidden(true)` makes `ios_widget_check.sh` print `FAIL star.fill without accessibilityHidden` naming the file; the small's line under the clock dropping "last feed" makes `testGoldens` FAIL on small-moment-day.

- [ ] **Step 5: Commit**

```bash
git add native-ios/CubbyWidget/Provider.swift native-ios/CubbyWidget/Entities.swift native-ios/CubbyWidget/Layout.swift \
  native-ios/CubbyWidget/Views native-ios/Tests/RenderTests.swift native-ios/Tests/ProviderTests.swift \
  native-ios/Tests/EntityTests.swift native-ios/Tests/Goldens
git commit -o native-ios/CubbyWidget native-ios/Tests tools/cap_ios_configure.rb tools/ios_widget_check.sh tools/test_wiring_check.js \
  -m "The iPhone widgets: when your baby last fed, slept and had a nappy, and a tap that opens Cubby on the right sheet" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The app says when the widget switches to Health, offers the stack helper, and counts installed widgets

**Files:**
- Modify: `app/native-bridge.js` (P1's `window.cubbyWidget` block inside `boot()`, `:99-259`; the `appStateChange` listener `:184`)
- Modify: `app/widget-snapshot.js` (P1; two pure functions)
- Modify: `app/index.html`: `.toast` CSS `:1134-1135`; `toast()` `:2260-2289`; `startIllness` `:15295-15303`; `resumeIllness`'s `onConfirm` `:15424-15428`; the Settings row P1 added for `setLockHidePref` (find it with `grep -n setLockHidePref app/index.html`)
- Modify: `workers/usage/core.mjs:48-60`; `.telemetry/tracking-plan.yaml` header `:4-6` and a new entry after `:583` (after install.prompted); `app/usage-allowlist.js` (regenerated); `app/sw.js:3`
- Create: `test/widget-ios-app.test.js`; Modify: `tools/gates.js` (Task 2's block)

**Interfaces:**
- Consumes: `window.cubbyWidget.hasWidgets()` and `window.__cubbyHasWidgets`, the plugin's whole answer `{ value, kinds: { medium, small, lock } }`, `false` on the web (P1, 2.2, 2.6, contract note 8); `CubbyWidgetCopy['app.healthSwitched']` and `CubbyWidgetCopy['app.stackHelp']` (P1); `window.CubbySince.healthOpen(illnesses, events, babyId, now)` and `window.CubbyWidgetCopy` (P1, 2.2); `window.cubbyTrack(name, props)` (app/cubby-track.js:180, :391).
- Produces:
```js
// app/widget-snapshot.js (also on module.exports)
widgetHealthLine({ answer, wasOpen, isOpen, name, text }) -> string|null   // text: CubbyWidgetCopy['app.healthSwitched'];
  // non-null only when answer.value && kinds.medium + kinds.small > 0 && !wasOpen && isOpen
widgetStackHelper({ answer, platform, babyCount, text }) -> string|null      // text: CubbyWidgetCopy['app.stackHelp']; platform 'ios', answer.value, babyCount >= 2
// app/native-bridge.js (on window for the test)
reportWidgetKinds(answer, today /* 'YYYY-MM-DD', local */) -> number          // events sent; localStorage 'cubby-widget-day' = today once sent
  // no platform check: it reads only the answer, so P6 Task 6 proves the Android plugin's kinds reach it
// app/index.html
toast(msg, { sub?: string, ms?: number, ... })   // sub: a second line in .toast-sub; the toast keeps its other options
```
  `core.mjs`: `'widget.installed': { anon: false, props: { kind: e('medium', 'small', 'lock'), count: int(1, 20) } }`. One event per kind with a count of 1 or more, count capped at 20, at most once per local day per device, after any `hasWidgets()` answer at boot and on each `appStateChange` to active. startIllness and the reopen read `healthOpen` for that baby before and after the change, and pass `widgetHealthLine`'s result as `sub` with `ms: 4000`.
  Tracking-plan entry:
```yaml
    - name: widget.installed
      source: new
      before_sign_in: false
      fires_when: Once a day on a phone with any Cubby widget, one event for each kind it has.
      how: "apps only: the CubbyWidget plugin's hasWidgets(), at launch and on each return to the app."
      properties:
        - { name: kind, type: string, enum: [medium, small, lock] }
        - { name: count, type: integer, min: 1, max: 20 }
```

- [ ] **Step 1: Mockup before the UI**

Screenshot (tools/shot.js against `PORT=8123 node tools/serve.js` from this tree) the two-line toast and the Settings helper at 320px and 390px, day and night, with the line forced on in the page. FOUNDER STEP: look approved before Step 4.

- [ ] **Step 2: Write the failing test `test/widget-ios-app.test.js`**

Sections 1 and 2 always run; section 3 only with a `url` argument. Prints `WIDGET-IOS-APP: PASS|FAIL`.
1. vm (the pattern of test/native-deeplink.test.js): boot app/native-bridge.js with `Capacitor.getPlatform() === 'ios'`, `Plugins.CubbyWidget.hasWidgets` answering `{ value: true, kinds: { medium: 2, small: 0, lock: 25 } }`, a stub `cubbyTrack` and a Map localStorage. Assert `window.__cubbyHasWidgets` deep-equals that answer (P1's cache of the whole answer; a boolean cache is red here); tracked equals `[['widget.installed', { kind: 'medium', count: 2 }], ['widget.installed', { kind: 'lock', count: 20 }]]`; a second boot the same day tracks nothing; the next day tracks the two again; `value: false` tracks nothing and stamps no day; a plugin with no `hasWidgets` (an older binary) tracks nothing and throws nothing.
2. node: `widgetHealthLine` with `{ value: true, kinds: { medium: 1, small: 0, lock: 0 } }`, `wasOpen: false`, `isOpen: true`, name `'Robin'` returns `"Your widget now shows Health until Robin is better."`; lock-only kinds, `wasOpen: true`, `answer: null` and `value: false` each return null. `widgetStackHelper` on ios with 2 babies returns `"One widget per baby? Turn off Smart Rotate so the stack stays where you left it."`; android, 1 baby, or `value: false` return null.
3. puppeteer (downloadBehavior from tools/gate_downloads.js; clock pinned to the 15th at 13:00; no service worker; a native iOS `Capacitor` stub with a `CubbyWidget` plugin set via `evaluateOnNewDocument`): Robin, no illness, `startIllness('Cold')`: `#toast` reads "Logged Cold · hope it passes soon" and `#toast .toast-sub` reads the Health line. With a cold already open, a second start shows no `.toast-sub`. Reopening an ended illness through `resumeIllness` and its confirm shows it. A lock-only phone shows none. Settings with two babies shows the stack helper (count 1); with one baby, count 0.

Add to the P3 block in `tools/gates.js`:
```js
  { name: 'widget-ios-app',    cmd: ['node', 'test/widget-ios-app.test.js'] },          // vm + node: runs in CI's --no-browser too
  { name: 'widget-ios-app-ui', cmd: ['node', 'test/widget-ios-app.test.js', 'url'] },
```

- [ ] **Step 3: Run it and watch it fail; then see the tracking-plan gate refuse a half-added event**

Run: `node tools/gates.js --only=widget-ios-app`
Expected: FAIL (nothing tracked, no `.toast-sub`). Then add only the `core.mjs` entry and run `node tools/gates.js --only=tracking-plan`: FAIL, the plan and core.mjs differ.

- [ ] **Step 4: Implement**

The tracking-plan entry above; bump both numbers in the header's "N of the M linked events are sent by a device" line by one; `node tools/gen_usage_allowlist.js`; the two pure functions; `reportWidgetKinds`; `toast()`'s `opts.sub` with `.toast-sub{display:block;font-weight:700;font-size:var(--fs-sm);margin-top:2px}` and a rounder corner when it has one; the two illness call sites; the helper under P1's lock-screen row. Re-read `app/sw.js:3` and set CACHE one above what it says now.

- [ ] **Step 5: Run and pass**

Run: `node tools/gates.js --only=widget-ios-app,tracking-plan,native-deeplink,illness-start,sleep-timer`
Expected: `WIDGET-IOS-APP: PASS` for both gates, tracking-plan PASS, and the three existing gates still PASS.

- [ ] **Step 6: Commit**

```bash
git add test/widget-ios-app.test.js
git commit -o app/native-bridge.js app/widget-snapshot.js app/index.html app/usage-allowlist.js app/sw.js \
  workers/usage/core.mjs .telemetry/tracking-plan.yaml test/widget-ios-app.test.js tools/gates.js \
  -m "When an illness switches your widget's button to Health, Cubby says so, and installed widgets are counted first-party" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The build signs and checks the extension, and the launch smoke renders it

**Files:**
- Modify: `tools/cap_ios_build.sh`: `:37` (add `WIDGET_ENTITLEMENTS="ios/App/CubbyWidget/CubbyWidget.entitlements"`); before `:92` (sign the appex first); after `:108` (assertions); after `:139` (the `--local` IPA)
- Modify: `tools/ios_launch_smoke.sh`: after `:60` (the appex is in the simulator build); after `:64` (and in the installed app); before `:76` (render one test)
- Modify: `docs/TESTING.md` (a new section, "Mac-only native gates (iOS widgets)", before "## Known intermittent" at `:211`)

**Interfaces:**
- Consumes: the targets, entitlements and scheme of Task 3; `RenderTests/testEveryFamilyRendersAtTheFloor` (Task 6).
- Produces: `cap_ios_build.sh` stops, with a `✖` line naming what is wrong, unless: `App.app/PlugIns/CubbyWidget.appex` exists; the appex was signed with `codesign --force --sign "$IDENTITY" --entitlements "$WIDGET_ENTITLEMENTS" --generate-entitlement-der` before the app's own `:92` signature; both signatures carry `group.com.littlecubby.app` and `F5NVQV7NVB.com.littlecubby.app.shared` and neither carries `$(AppIdentifierPrefix)`; the app still carries applesignin and `aps-environment` production (`:95-108`); `CFBundleShortVersionString` and `CFBundleVersion` of the appex equal the app's; the appex's `NSExtensionPointIdentifier` is `com.apple.widgetkit-extension`; the app's Info.plist has no static shortcut items key; both bundles hold PrivacyInfo.xcprivacy. With `--local`, the exported IPA holds `Payload/App.app/PlugIns/CubbyWidget.appex/` and its re-signed appex still carries the App Group. The smoke stops unless the simulator build and `xcrun simctl get_app_container "$UDID" com.littlecubby.app` both hold `PlugIns/CubbyWidget.appex`, and `xcodebuild test -scheme CubbyWidgetTests -only-testing:CubbyWidgetTests/RenderTests/testEveryFamilyRendersAtTheFloor -destination id="$UDID"` passes.

- [ ] **Step 1: Write the assertions into both scripts (they are the test)**

- [ ] **Step 2: See each go red**

FOUNDER STEP first: the portal App ID and App Group (they let the export run). Then, one at a time and reverted by hand:
- Comment out the appex `codesign` line. Run: `bash tools/cap_ios_build.sh --local`. Expected: it stops with `✖ CubbyWidget.appex is not signed with group.com.littlecubby.app`.
- In `cap_ios_configure.rb`, write `CURRENT_PROJECT_VERSION = 2` on CubbyWidget. Run the same. Expected: `✖ CubbyWidget.appex CFBundleVersion 2 is not the app's 1`.
- In `cap_ios_configure.rb`, skip the embed phase. Run: `bash tools/ios_launch_smoke.sh`. Expected: `✖ No PlugIns/CubbyWidget.appex in the simulator build`.

- [ ] **Step 3: Run green**

Run: `bash tools/cap_ios_build.sh --local`
Expected: `✓ ... alive`, `IOS-WIDGET: PASS`, `✓ appex signed: App Group + keychain group, versions equal`, `EXPORT SUCCEEDED`, `✓ IPA holds CubbyWidget.appex`. No upload happens with `--local`.

- [ ] **Step 4: docs/TESTING.md**

The new section: what `tools/ios_widget_check.sh`, the `CubbyWidgetTests` scheme and `tools/ios_launch_smoke.sh` prove, that `cap_ios_build.sh` runs them and stops on red, how to record goldens, and the date each was seen red.

- [ ] **Step 5: Commit**

```bash
git commit -o tools/cap_ios_build.sh tools/ios_launch_smoke.sh tools/cap_ios_configure.rb docs/TESTING.md \
  -m "An iOS build that ships the widget without its App Group, its keychain group or the app's version number stops before upload" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Phase A on testers' iPhones: device proofs, foldables, and the SPEC note

**Files:**
- Modify (only as the proofs decide): `native-ios/Shared/CubbyLink.swift` (`deliverable`'s scheme), `tools/cap_ios_configure.rb:183-187` (a second `CFBundleURLTypes` entry, scheme `cubby`), `native-ios/CubbyWidget/Layout.swift` (`WidgetFlags`), `native-ios/Tests/RenderTests.swift` (iPhone Duo sizes, any proof-driven golden)
- Modify: `docs/TESTING.md` (a "Device proofs" table in Task 8's section, with the F10 month-day walk's rows), `design/components/cubby-components.html` (a revision note after the lede at `:134`)

**Interfaces:**
- Consumes: everything above. Produces: the recorded proofs and the values of `WidgetFlags.smallLinksOnIOS17`, `WidgetFlags.relativeOnIOS17` and `CubbyLink.deliverable`'s scheme, each with a test pinning it.

- [ ] **Step 1: Upload**

FOUNDER STEP: testers or a registered device, and a yes. Then `bash tools/cap_ios_build.sh` and `node tools/asc.js builds` until the build reads processed.

- [ ] **Step 2: The three device proofs, recorded in docs/TESTING.md with date, device, iOS version and result**

On an iOS 17 iPhone (or the iOS 17.5 simulator if no tester has one, marked as such) and on iOS 26 or 27:
- Link delivery: a medium "Feed ↗" tap, cold and warm, lands on the feed sheet with that baby picked; a later pull-to-reload of the webview does not reopen it. If https never reaches the app, set `deliverable` to `cubby://app/?<same query>`, add the `cubby` URL type at `:183-187`, and add `testDeliverableUsesTheProvenScheme`.
- Small-widget Links on iOS 17: each of the two buttons opens its own sheet. If not, `WidgetFlags.smallLinksOnIOS17 = false` and a golden `small-ios17` of the single-target layout.
- `.relative` on iOS 17 under an hour: if it shows seconds, `relativeOnIOS17` stays false; on iOS 18 and later the DateReference line shows no seconds and reads in the system's words ("1 hr, 5 min ago").

- [ ] **Step 3: The TestFlight walk (each line: what you did, what glass and Cubby showed)**

- Gallery: the three kinds with their names and descriptions; no pregnancy kind.
- Medium, small (Sleep, then Feed by default), twins set to Both ("Start both" is Phase B: here every button reads with the arrow and opens its sheet with Both picked), siblings set to Both (buttons open on the active baby), lock rectangular and inline.
- Edit Widget: Baby with Both only in a two-baby family; Your button: Activity, Health, Pump; small First and Second never the same; the description sentence.
- The illness switch: open an illness for Robin; the medium's fourth and the small's second button read Health and open Robin's illness sheet; the in-app line appears once; marking better puts Pump back.
- Hide details on the lock screen: lock widgets read Cubby alone; a home-screen widget in StandBy reads Cubby alone; on the home screen, details stay.
- Who logged it, with Hide details off (F7): after another member logs a feed and Cubby on this phone opens once, the home-screen medium reads "Last feed · Dad"; the same medium in StandBy, in iPhone widgets on a Mac and (if a tester has one) on an iPad lock screen shows the times and no name. Record `WidgetPrivacy.name`'s value seen in each place.
- Long-press: Feed, Sleep, Nappy and the first chosen quick action; each opens its sheet.
- Every wipe (sign out, switch account, delete account, access lost, loss holding with no living child): glass reads the signed-out line or Cubby alone, and long-press shows nothing.
- Before first unlock: restart, look before unlocking: Cubby alone, never zeros; after unlock, filled within 15 minutes without opening the app.
- Month day (F10), in a test household where Robin's birth date is three months ago today, Wren's (or a sibling's) the same, and a third test baby's three months ago tomorrow; open Cubby once so the snapshot is written: the home-screen medium reads "Robin · ★ 3 months today" in honey ink where "2 months old" was, every time and button where it was before; the small reads "★ Robin · 3 months today", the clock time, then "last feed" before the ago line; twins set to Both read one line "Robin and Wren · 3 months today" beside "Updated", and after moving Wren's birth date by a day, "Robin · 3 months today". VoiceOver reads "Robin is 3 months old today" and never the star. A tap on the widget body opens Robin's month card with no Pro mark; a tap on Feed still opens the feed sheet. The same medium in StandBy, in iPhone widgets on a Mac and (if a tester has one) on an iPad lock screen reads the age with no star; lock widgets never show it. The baby whose day is tomorrow reads its age today. The next morning, without opening Cubby, Robin's widget reads the age again. A birth date one year ago today reads "1 year today" and opens the 12-month card. With loss holding active and a living child on her month day: the times, and no month day. Record what each place showed.
- F8: on the iPhone Duo simulator, folded and unfolded, add medium and small; log `context.displaySize` once, add both sizes to `testEveryFamilyRendersAtTheFloor` (its moment-day fixtures included), and Read each screenshot, on an ordinary day and on Robin's month day (the line whole beside an unbroken "Updated", or the ordinary layout, never "3 months to…"; times and buttons where they were).

- [ ] **Step 4: The SPEC revision note**

In `design/components/cubby-components.html` after `:134`: the 16 Nov spec supersedes button heights of 30px (`:119`, `:224`) and 34px (`:342`) with the 44pt and 48dp floor; "iOS 16 opens, iOS 17 logs in place" (`:219`, `:322`) with "every tap opens Cubby, except Sleep in place from Phase B, floor iOS 17"; three ActionButtons (`:313`) with Feed, Sleep, Nappy and the parent's pick, Health while a baby is unwell; the "1h 05" headline (`:340`) with the clock time; the lock-screen ring (`:351`) dropped; "not yet" in `--ink-soft`, not `--ink-dim` (`:293`); Sleep reads "Sleep ↗" in Phase A, "Start sleep" and "Stop sleep" in Phase B. Point to the spec path.

- [ ] **Step 5: Run every gate once more**

Run: `node tools/gates.js` and `bash tools/ios_widget_check.sh`
Expected: both PASS (with any proof-driven test added in Step 2 seen red first: run it before changing the flag).

- [ ] **Step 6: Commit**

```bash
git commit -o docs/TESTING.md design/components/cubby-components.html native-ios tools/cap_ios_configure.rb \
  -m "The iPhone widgets on testers' phones: what each proof showed, and the component spec brought up to date" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

FOUNDER STEP: none to push. Phase A stays on TestFlight; App Review waits for P4 and P5 (F1).
